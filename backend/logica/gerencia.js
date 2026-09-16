'use strict';

/**
 * gerencia.js — puerto de backend/backoffice/Gerencia.gs: el Panel de
 * Control de Gerencia. Es una VISTA sobre datos que ya existen (no agrega
 * columnas ni estados) -- agrupa/calcula sobre SOLICITUDES/SUBSOLICITUDES +
 * el semaforo de Cumplimiento.gs (ya portado).
 *
 * Reusa coincideFiltros_/esAtencionDirecta_ de dashboard.js -- mismo
 * criterio que el .gs (que las reusa de Dashboard.gs por scope global
 * compartido de Apps Script): una sola fuente de verdad, nunca duplicarlas.
 *
 * NO se porta la capa de CacheService (TTL 300s): mismo criterio que
 * dashboard.js/sesiones.js -- esa cache evitaba recalcular sobre Sheets: en
 * SQLite local recalcular es barato. Como consecuencia, rol_actual SIEMPRE
 * viaja fresco (nunca hay un valor cacheado del que "prestarlo" a otro rol,
 * el problema que el .gs resolvia agregandolo despues de leer/escribir el
 * cache) -- una simplificacion real, no una perdida de comportamiento.
 */

const { leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { ESTADOS_CERRADOS, ORDEN_ESTADOS } = require('./constantesSolicitudes');
const Utils = require('./utils');
const Cumplimiento = require('./cumplimiento');
const { coincideFiltros_, esAtencionDirecta_ } = require('./dashboard');

const CUMPLIMIENTO_HORAS_JORNADA = 9; // mismo valor que cumplimiento.js (jornada 09:00-18:00).
const GERENCIA_DIAS_VENTANA_DEFECTO = 30;
// Mismo umbral que el cierre automatico (RN-201, Triggers.gs -- no portado
// todavia): "cerca del cierre" debe significar lo mismo en todas partes.
const DIAS_HABILES_CIERRE_AUTOMATICO = 5;

function leerFilasSeguro_(db, hoja) {
  try { return leerFilas_(db, hoja, COLUMNAS[hoja]); } catch (err) { return []; }
}

function promedio_(numeros) {
  if (numeros.length === 0) return 0;
  const suma = numeros.reduce((acc, n) => acc + n, 0);
  return Math.round((suma / numeros.length) * 10) / 10;
}

function diasHabilesRedondeado_(inicio, fin) {
  return Math.round((Utils.horasHabilesEntre(inicio, fin) / CUMPLIMIENTO_HORAS_JORNADA) * 10) / 10;
}

// Semaforo PROPIO del solicitante -- separado del semaforo de cumplimiento
// (que mide al desarrollador). Solo aplica mientras el item esta
// ESPERANDO_VALIDACION.
function semaforoSolicitante_(cumplimiento) {
  if (cumplimiento.codigo !== 'ESPERANDO_VALIDACION') return null;
  const dias = cumplimiento.dias_esperando || 0;
  if (dias < 1) return { codigo: 'RECIEN_ENTREGADO', emoji: '🟢', texto: 'Recién entregado' };
  if (dias < DIAS_HABILES_CIERRE_AUTOMATICO) return { codigo: 'ESPERANDO', emoji: '🟡', texto: 'Esperando validación' };
  return { codigo: 'CERCA_CIERRE_AUTOMATICO', emoji: '🔴', texto: 'Cerca del cierre automático' };
}

// Primera fila (por timestamp) de HISTORIAL_COMPROMISO de cada item ->
// fecha_anterior es la linea base original (el "resbalon").
function lineaBasePorItem_(historialCompromiso) {
  const porItem = {};
  historialCompromiso.forEach((h) => {
    const actual = porItem[h.subsolicitud_id];
    if (!actual || new Date(h.timestamp) < new Date(actual.timestamp)) porItem[h.subsolicitud_id] = h;
  });
  const resultado = {};
  Object.keys(porItem).forEach((subId) => { resultado[subId] = porItem[subId].fecha_anterior; });
  return resultado;
}

function contarPorSubsolicitud_(historialCompromiso) {
  const contadores = {};
  historialCompromiso.forEach((h) => { contadores[h.subsolicitud_id] = (contadores[h.subsolicitud_id] || 0) + 1; });
  return contadores;
}

// Un item que se cerro (ESTADOS_CERRADOS) y volvio a un estado NO cerrado.
function contarReaperturasPorSubsolicitud_(historialEstados) {
  const contadores = {};
  historialEstados.forEach((h) => {
    if (!h.subsolicitud_id) return;
    const veniaDeCerrado = ESTADOS_CERRADOS.indexOf(h.estado_anterior) !== -1;
    const siguioAbierto = ESTADOS_CERRADOS.indexOf(h.estado_nuevo) === -1;
    if (veniaDeCerrado && siguioAbierto) contadores[h.subsolicitud_id] = (contadores[h.subsolicitud_id] || 0) + 1;
  });
  return contadores;
}

function mapaNombresUsuarios_(db) {
  const mapa = {};
  leerFilasSeguro_(db, 'USUARIOS').forEach((u) => { if (u.email && u.nombre) mapa[u.email] = u.nombre; });
  return mapa;
}

// Resuelve la ventana "periodo actual" (filtros.desde/hasta, o los ultimos
// 30 dias por defecto) y "periodo anterior" (misma duracion, inmediatamente antes).
function resolverVentanaPeriodo_(filtrosBase) {
  const hasta = filtrosBase.hasta ? new Date(filtrosBase.hasta) : new Date();
  const desde = filtrosBase.desde ? new Date(filtrosBase.desde) : new Date(hasta.getTime() - GERENCIA_DIAS_VENTANA_DEFECTO * 24 * 3600 * 1000);
  const duracionMs = Math.max(hasta.getTime() - desde.getTime(), 0);
  const hastaAnterior = new Date(desde.getTime());
  const desdeAnterior = new Date(desde.getTime() - duracionMs);
  return { desde, hasta, desdeAnterior, hastaAnterior };
}

function dentroDeRango_(fechaIso, desde, hasta) {
  if (!fechaIso) return false;
  const t = new Date(fechaIso).getTime();
  return t >= desde.getTime() && t <= hasta.getTime();
}

/**
 * ¿Cae esta fecha ISO dentro del rango [desde, hasta]? Compara los 10
 * primeros caracteres como TEXTO (dia calendario local), no como Date UTC
 * -- misma regla que usa el motor de reportes del navegador, para que el
 * mismo corte no de dos respuestas distintas segun donde se pida. Limites
 * inclusivos en ambos extremos.
 */
function fechaEnRango_(valor, desde, hasta) {
  const f = String(valor || '').slice(0, 10);
  if (!desde && !hasta) return true;
  if (!f) return false;
  if (desde && f < String(desde).slice(0, 10)) return false;
  if (hasta && f > String(hasta).slice(0, 10)) return false;
  return true;
}

// Filtros propios de este panel (a nivel ITEM, no SOLICITUD como
// coincideFiltros_): desarrollador, tipo, area, periodo.
function coincideFiltroItem_(sub, solicitud, filtros) {
  if (filtros.desarrollador) {
    const asignado = sub.desarrollador_asignado || solicitud.desarrollador_asignado || '';
    if (asignado !== filtros.desarrollador) return false;
  }
  if (filtros.tipo && sub.tipo !== filtros.tipo) return false;
  if (filtros.area) {
    const area = sub.area_nombre || sub.area || '';
    if (area !== filtros.area) return false;
  }
  if (!fechaEnRango_(sub.fecha_creacion, filtros.desde, filtros.hasta)) return false;
  return true;
}

// Banda de KPIs -- sobre el MISMO conjunto ya filtrado que devuelve items.
function calcularKpisGerencia_(items) {
  const entregados = items.filter((i) => !!i.fecha_terminada && !!i.fecha_comprometida);
  const entregadosATiempo = entregados.filter((i) => new Date(i.fecha_terminada) <= new Date(i.fecha_comprometida));

  const esperandoValidacion = items.filter((i) => i.cumplimiento.codigo === 'ESPERANDO_VALIDACION');
  const atrasadasActivas = items.filter((i) => i.cumplimiento.codigo === 'ATRASADA_DESARROLLADOR');
  const cerradasConAtraso = items.filter((i) => i.cumplimiento.codigo === 'CERRADA_CON_ATRASO');
  const sinComprometer = items.filter((i) => i.cumplimiento.codigo === 'SIN_COMPROMISO');

  const diasAtraso = atrasadasActivas.map((i) => Utils.horasHabilesEntre(i.fecha_comprometida, new Date()) / 9)
    .concat(cerradasConAtraso.map((i) => Utils.horasHabilesEntre(i.fecha_comprometida, i.fecha_terminada) / 9));

  return {
    pct_cumplimiento_desarrollador: entregados.length === 0 ? null : Math.round((entregadosATiempo.length / entregados.length) * 1000) / 10,
    atrasadas_activas: atrasadasActivas.length,
    esperando_validacion: esperandoValidacion.length,
    esperando_validacion_promedio_dias: promedio_(esperandoValidacion.map((i) => i.cumplimiento.dias_esperando || 0)),
    atraso_promedio_dias: promedio_(diasAtraso),
    sin_comprometer: sinComprometer.length
  };
}

// Delta simple (actual - anterior) por KPI. null si cualquiera de los dos
// lados no tiene dato -- un delta contra null no significa nada.
function calcularComparativoKpis_(itemsActuales, itemsAnteriores) {
  const actual = calcularKpisGerencia_(itemsActuales);
  const anterior = calcularKpisGerencia_(itemsAnteriores);
  function delta_(a, b) {
    if (a === null || a === undefined || b === null || b === undefined) return null;
    return Math.round((a - b) * 10) / 10;
  }
  return {
    pct_cumplimiento_desarrollador: delta_(actual.pct_cumplimiento_desarrollador, anterior.pct_cumplimiento_desarrollador),
    atrasadas_activas: delta_(actual.atrasadas_activas, anterior.atrasadas_activas),
    esperando_validacion: delta_(actual.esperando_validacion, anterior.esperando_validacion),
    atraso_promedio_dias: delta_(actual.atraso_promedio_dias, anterior.atraso_promedio_dias),
    sin_comprometer: delta_(actual.sin_comprometer, anterior.sin_comprometer)
  };
}

// Ranking Modulo x Tipo: cuenta, % del total, tendencia vs periodo anterior,
// dias promedio de resolucion, reaperturas acumuladas. Mayor a menor.
function calcularRecurrencia_(itemsActuales, itemsAnteriores) {
  function claveGrupo_(i) { return (i.modulo_nombre || '(sin módulo)') + '␟' + (i.tipo_nombre || '(sin tipo)'); }
  function agrupar_(items) {
    const grupos = {};
    items.forEach((i) => { const c = claveGrupo_(i); if (!grupos[c]) grupos[c] = []; grupos[c].push(i); });
    return grupos;
  }
  const gruposActuales = agrupar_(itemsActuales);
  const gruposAnteriores = agrupar_(itemsAnteriores);
  const total = itemsActuales.length;

  return Object.keys(gruposActuales).map((clave) => {
    const partes = clave.split('␟');
    const filas = gruposActuales[clave];
    const cerrados = filas.filter((i) => ESTADOS_CERRADOS.indexOf(i.estado) !== -1 && i.fecha_terminada);
    const diasResolucion = cerrados.map((i) => i.dias_abierta).filter((d) => d !== null && d !== undefined);
    const reaperturas = filas.reduce((acc, i) => acc + (i.reaperturas || 0), 0);
    const cantidadAnterior = (gruposAnteriores[clave] || []).length;

    return {
      modulo_nombre: partes[0], tipo_nombre: partes[1], cantidad: filas.length,
      pct_total: total === 0 ? 0 : Math.round((filas.length / total) * 1000) / 10,
      tendencia: filas.length - cantidadAnterior,
      dias_promedio_resolucion: diasResolucion.length === 0 ? null : promedio_(diasResolucion),
      reaperturas: reaperturas
    };
  }).sort((a, b) => b.cantidad - a.cantidad);
}

// Panorama mensual de los ultimos 6 meses.
function calcularTendenciaTemporal_(items) {
  const MESES_VENTANA = 6;
  const ahora = new Date();
  const buckets = [];
  for (let i = MESES_VENTANA - 1; i >= 0; i--) {
    const fechaBucket = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
    buckets.push({
      anio: fechaBucket.getFullYear(), mes: fechaBucket.getMonth(),
      etiqueta: fechaBucket.toLocaleDateString('es-CL', { month: 'short', year: '2-digit' }),
      creadas: 0, cerradas: 0, entregados: 0, entregadosATiempo: 0
    });
  }
  function bucketDe_(fechaIso) {
    const f = new Date(fechaIso);
    for (const b of buckets) { if (b.anio === f.getFullYear() && b.mes === f.getMonth()) return b; }
    return null;
  }

  items.forEach((i) => {
    const bCreacion = bucketDe_(i.fecha_creacion);
    if (bCreacion) bCreacion.creadas++;
    if (i.fecha_terminada) {
      const bCierre = bucketDe_(i.fecha_terminada);
      if (bCierre) {
        bCierre.cerradas++;
        if (i.fecha_comprometida) {
          bCierre.entregados++;
          if (new Date(i.fecha_terminada) <= new Date(i.fecha_comprometida)) bCierre.entregadosATiempo++;
        }
      }
    }
  });

  return buckets.map((b) => ({
    etiqueta: b.etiqueta, creadas: b.creadas, cerradas: b.cerradas,
    pct_cumplimiento: b.entregados === 0 ? null : Math.round((b.entregadosATiempo / b.entregados) * 1000) / 10
  }));
}

// Tiempo de ciclo promedio por cada transicion "canonica" (S01→S02, ...,
// S08→S09), usando la PRIMERA vez que cada item entro a cada estado (un
// rebote no infla el promedio).
function calcularCicloPorEtapa_(items, historialEstados) {
  const primeraVezPorSub = {};
  historialEstados.forEach((h) => {
    if (!h.subsolicitud_id || !h.estado_nuevo) return;
    if (!primeraVezPorSub[h.subsolicitud_id]) primeraVezPorSub[h.subsolicitud_id] = {};
    const actual = primeraVezPorSub[h.subsolicitud_id][h.estado_nuevo];
    if (!actual || new Date(h.timestamp) < new Date(actual)) primeraVezPorSub[h.subsolicitud_id][h.estado_nuevo] = h.timestamp;
  });

  const idsRelevantes = {};
  items.forEach((i) => { idsRelevantes[i.subsolicitud_id] = true; });

  const acumulado = {};
  for (let idx = 0; idx < ORDEN_ESTADOS.length - 1; idx++) {
    acumulado[ORDEN_ESTADOS[idx] + '_' + ORDEN_ESTADOS[idx + 1]] = { suma: 0, cuenta: 0 };
  }

  Object.keys(primeraVezPorSub).forEach((subId) => {
    if (!idsRelevantes[subId]) return;
    const porEstado = primeraVezPorSub[subId];
    for (let i = 0; i < ORDEN_ESTADOS.length - 1; i++) {
      const desde = ORDEN_ESTADOS[i];
      const hasta = ORDEN_ESTADOS[i + 1];
      if (!porEstado[desde] || !porEstado[hasta]) continue;
      const dias = diasHabilesRedondeado_(porEstado[desde], porEstado[hasta]);
      if (dias < 0) continue;
      const clave = desde + '_' + hasta;
      acumulado[clave].suma += dias;
      acumulado[clave].cuenta += 1;
    }
  });

  return ORDEN_ESTADOS.slice(0, -1).map((desde, i) => {
    const hasta = ORDEN_ESTADOS[i + 1];
    const bucket = acumulado[desde + '_' + hasta];
    return { estado_desde: desde, estado_hasta: hasta, dias_promedio: bucket.cuenta === 0 ? null : Math.round((bucket.suma / bucket.cuenta) * 10) / 10, muestras: bucket.cuenta };
  });
}

// Distribucion de carga por empresa/plataforma/area. Mayor a menor.
function calcularCarga_(items) {
  function agruparPorCampo_(campo, etiquetaVacia) {
    const conteo = {};
    items.forEach((i) => { const c = i[campo] || etiquetaVacia; conteo[c] = (conteo[c] || 0) + 1; });
    return Object.keys(conteo).map((clave) => ({ etiqueta: clave, cantidad: conteo[clave] })).sort((a, b) => b.cantidad - a.cantidad);
  }
  return {
    por_empresa: agruparPorCampo_('empresa_id', '(sin dato)'),
    por_plataforma: agruparPorCampo_('plataforma_nombre', '(sin dato)'),
    por_area: agruparPorCampo_('area_nombre', '(sin área)')
  };
}

function calcularPanelGerencia_(db, filtrosBase) {
  const feriados = Cumplimiento.obtenerFeriados(db);

  const solicitudes = leerFilas_(db, 'SOLICITUDES', COLUMNAS.SOLICITUDES).filter((s) => coincideFiltros_(s, filtrosBase, {}));
  const solicitudPorId = {};
  solicitudes.forEach((s) => { solicitudPorId[s.solicitud_id] = s; });

  const historialCompromiso = leerFilas_(db, 'HISTORIAL_COMPROMISO', COLUMNAS.HISTORIAL_COMPROMISO);
  const lineasBase = lineaBasePorItem_(historialCompromiso);
  const reCompromisosPorItem = contarPorSubsolicitud_(historialCompromiso);

  const historialEstados = leerFilasSeguro_(db, 'HISTORIAL_ESTADOS');
  const reaperturasPorSub = contarReaperturasPorSubsolicitud_(historialEstados);

  const ahora = new Date();
  const nombrePorEmail = mapaNombresUsuarios_(db);

  // Las atenciones directas quedan FUERA del semaforo: nunca tuvieron fecha
  // comprometida, medirlas inflaria SIN_COMPROMISO sin nada que corregir.
  const atencionesDirectas = solicitudes.filter(esAtencionDirecta_).length;

  const items = leerFilas_(db, 'SUBSOLICITUDES', COLUMNAS.SUBSOLICITUDES)
    .filter((sub) => {
      const solicitud = solicitudPorId[sub.solicitud_id];
      return solicitud && !esAtencionDirecta_(solicitud) && coincideFiltroItem_(sub, solicitud, filtrosBase);
    })
    .map((sub) => {
      const solicitud = solicitudPorId[sub.solicitud_id];
      const cumplimiento = Cumplimiento.clasificar(sub, ahora);
      const cerrada = ESTADOS_CERRADOS.indexOf(sub.estado) !== -1;
      return {
        subsolicitud_id: sub.subsolicitud_id, solicitud_id: sub.solicitud_id, titulo: sub.titulo, numero_item: sub.numero_item,
        empresa_id: solicitud.empresa_id,
        plataforma_nombre: solicitud.plataforma_nombre || solicitud.plataforma || '',
        area_nombre: sub.area_nombre || sub.area || '',
        tipo_nombre: sub.tipo_nombre || sub.tipo || '',
        modulo_nombre: sub.modulo_nombre || sub.modulo || '',
        descripcion: sub.descripcion || '', resultado_esperado: sub.resultado_esperado || '',
        estado: sub.estado, prioridad: sub.prioridad, es_cliente: !!solicitud.es_cliente,
        desarrollador_asignado: sub.desarrollador_asignado || solicitud.desarrollador_asignado || '',
        desarrollador_nombre: nombrePorEmail[sub.desarrollador_asignado || solicitud.desarrollador_asignado || ''] || '',
        solicitante_nombre: solicitud.solicitante_nombre, solicitante_email: solicitud.solicitante_email,
        fecha_creacion: sub.fecha_creacion, fecha_comprometida: sub.fecha_comprometida || '', fecha_terminada: sub.fecha_terminada || '',
        fecha_original: lineasBase[sub.subsolicitud_id] || sub.fecha_comprometida || '',
        re_compromisos: reCompromisosPorItem[sub.subsolicitud_id] || 0,
        reaperturas: reaperturasPorSub[sub.subsolicitud_id] || 0,
        cumplimiento: cumplimiento,
        dias_abierta: diasHabilesRedondeado_(sub.fecha_creacion, cerrada ? (sub.fecha_terminada || sub.fecha_creacion) : ahora),
        dias_desarrollador: sub.fecha_comprometida
          ? diasHabilesRedondeado_(sub.fecha_comprometida, sub.fecha_terminada || (cerrada ? sub.fecha_comprometida : ahora))
          : null,
        semaforo_solicitante: semaforoSolicitante_(cumplimiento)
      };
    });

  // Ventana de comparacion "periodo actual vs anterior", recortada del mismo
  // conjunto `items` (ya filtrado) por fecha_creacion.
  const ventana = resolverVentanaPeriodo_(filtrosBase);
  const itemsVentanaActual = items.filter((i) => dentroDeRango_(i.fecha_creacion, ventana.desde, ventana.hasta));
  const itemsVentanaAnterior = items.filter((i) => dentroDeRango_(i.fecha_creacion, ventana.desdeAnterior, ventana.hastaAnterior));

  const kpis = calcularKpisGerencia_(items);
  kpis.comparativo = calcularComparativoKpis_(itemsVentanaActual, itemsVentanaAnterior);

  return {
    kpis: kpis,
    items: items,
    atenciones_directas: atencionesDirectas,
    recurrencia: calcularRecurrencia_(itemsVentanaActual, itemsVentanaAnterior),
    tendencia: calcularTendenciaTemporal_(items),
    ciclo_por_etapa: calcularCicloPorEtapa_(items, historialEstados),
    carga: calcularCarga_(items),
    ventana: {
      desde: ventana.desde.toISOString(), hasta: ventana.hasta.toISOString(),
      desde_anterior: ventana.desdeAnterior.toISOString(), hasta_anterior: ventana.hastaAnterior.toISOString()
    }
  };
}

function getPanel(db, filtros, contexto) {
  const datos = calcularPanelGerencia_(db, filtros || {});
  datos.rol_actual = contexto ? contexto.rol : '';
  return datos;
}

module.exports = { getPanel };
