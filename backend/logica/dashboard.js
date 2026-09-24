'use strict';

/**
 * dashboard.js — puerto de backend/backoffice/Dashboard.gs: la Bandeja de
 * trabajo (Dashboard.getData) y la pauta de trabajo por lote
 * (getPautaDesarrollador). La pantalla principal del staff.
 *
 * NO se porta la capa de CacheService (C-13, TTL 300s): esa cache existia
 * para evitar recalcular sobre Sheets (I/O caro) en cada peticion. En
 * SQLite local recalcular es barato -- se sigue el mismo criterio que
 * sesiones.js: se porta la logica real, no una optimizacion que ya no
 * aplica. `refrescarCache` (A-10, solo forzaba el recalculo) no tiene
 * sentido sin cache que refrescar: no se porta.
 *
 * `contexto` = { email, rol }. El auto-scope por rol (aplicarAmbitoRol_) es
 * el mismo criterio ya usado en Solicitudes.gs: solo ADM ve la bandeja
 * completa por defecto; cualquier otro rol queda acotado a su propio correo.
 */

const { leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { errorValidacion } = require('./errores');
const { ESTADOS, ESTADOS_CERRADOS, ESTADOS_EXCLUIDOS_DERIVACION } = require('./constantesSolicitudes');
const Utils = require('./utils');
const Cumplimiento = require('./cumplimiento');

const ESTADOS_TRABAJO_DEV = [ESTADOS.S04, ESTADOS.S05, ESTADOS.S06, ESTADOS.S07];
const TOP_MODULOS_CANTIDAD = 5;
const MESES_TENDENCIA = 6;
const RECIENTES_LIMITE = 50;

// P7: umbral de "patron" -- conservador a proposito (mejor perder algun
// patron real al principio que saturar con falsos positivos).
const PATRON_VENTANA_DIAS = 7;
const PATRON_CANTIDAD_MINIMA = 3;
const PATRON_SOLICITANTES_MINIMOS = 2;

function leerFilasSeguro_(db, hoja) {
  try { return leerFilas_(db, hoja, COLUMNAS[hoja]); } catch (err) { return []; }
}

function aplicarAmbitoRol_(filtros, contexto) {
  if (!contexto) return filtros;
  if (contexto.rol !== 'ADM') {
    const filtrosAcotados = Object.assign({}, filtros, { vistaDev: contexto.email });
    // El respaldo de "huerfanas activas sin asignar" es SOLO para el DEV
    // (§4.2): para cualquier otro rol auto-acotado (GERENCIA, ANA...), sin
    // asignacion real no hay nada que mostrar -- si no, verian el trabajo
    // huerfano de todo el mundo.
    if (contexto.rol !== 'DEV') filtrosAcotados.sinRespaldoHuerfanas = true;
    return filtrosAcotados;
  }
  // ADM ve todo por defecto; si elige una bandeja puntual (verBandeja), se
  // acota a esa persona con el mismo mecanismo (vistaDev).
  if (filtros.verBandeja) {
    return Object.assign({}, filtros, { vistaDev: filtros.verBandeja });
  }
  return filtros;
}

// Solo ADM ve el selector de bandeja -- el unico perfil que puede mirar la
// bandeja de otra persona.
function agregarResponsablesSiCorresponde_(db, datos, contexto) {
  if (contexto && contexto.rol === 'ADM') {
    datos.responsables = obtenerResponsablesActivos_(db);
  }
}

// Personas que pueden tener una bandeja propia (Gestor/Analista o Gestor
// tecnico, activos) -- a quien CAT_AREAS.responsable_email puede apuntar.
function obtenerResponsablesActivos_(db) {
  return leerFilasSeguro_(db, 'USUARIOS')
    .filter((u) => {
      const activo = u.activo === true || u.activo === 'TRUE' || u.activo === 1;
      return activo && (u.rol === 'DEV' || u.rol === 'ANA');
    })
    .map((u) => ({ email: u.email, nombre: u.nombre || u.email }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

function esAtencionDirecta_(solicitud) {
  const valor = solicitud && solicitud.atencion_directa;
  return valor === true || valor === 'TRUE' || valor === 1;
}

// UNICA definicion de "que texto es buscable en una solicitud" (v6.3): la
// usan coincideFiltros_ (servidor) Y recientes[].texto_busqueda (para que
// el filtrado en vivo del navegador compare contra la MISMA cadena).
function textoBusquedaSolicitud_(solicitud, titulosPorSolicitud) {
  const titulos = (titulosPorSolicitud && titulosPorSolicitud[solicitud.solicitud_id]) || [];
  return [
    solicitud.solicitud_id, titulos.join(' '), solicitud.solicitante_nombre, solicitud.solicitante_email,
    solicitud.empresa_id, solicitud.empresa_nombre, solicitud.plataforma, solicitud.plataforma_nombre, solicitud.modulo
  ].join(' ').toLowerCase();
}

function coincideFiltros_(solicitud, filtros, idsAsignadosPorItem, titulosPorSolicitud) {
  if (filtros.empresa_id && solicitud.empresa_id !== filtros.empresa_id) return false;
  if (filtros.estado && solicitud.estado_derivado !== filtros.estado) return false;
  if (filtros.prioridad && solicitud.prioridad_derivada !== filtros.prioridad) return false;
  if (filtros.plataforma && solicitud.plataforma !== filtros.plataforma) return false;
  if (filtros.busqueda) {
    const termino = String(filtros.busqueda).trim().toLowerCase();
    if (termino && textoBusquedaSolicitud_(solicitud, titulosPorSolicitud).indexOf(termino) === -1) return false;
  }
  // Filtro por solicitante (P6): coincidencia parcial contra nombre O
  // correo. Distinto de `busqueda` a proposito: el Panel de Gerencia tiene
  // un campo rotulado "Solicitante" y no debe ensancharse a titulos/modulos.
  if (filtros.solicitante) {
    const buscado = String(filtros.solicitante).trim().toLowerCase();
    const nombre = String(solicitud.solicitante_nombre || '').toLowerCase();
    const email = String(solicitud.solicitante_email || '').toLowerCase();
    if (nombre.indexOf(buscado) === -1 && email.indexOf(buscado) === -1) return false;
  }
  if (filtros.vistaDev) {
    const asignadaAMi = solicitud.desarrollador_asignado === filtros.vistaDev ||
      (idsAsignadosPorItem && idsAsignadosPorItem[solicitud.solicitud_id]);
    const activaSinAsignar = !filtros.sinRespaldoHuerfanas &&
      !solicitud.desarrollador_asignado && ESTADOS_TRABAJO_DEV.indexOf(solicitud.estado_derivado) !== -1;
    if (!asignadaAMi && !activaSinAsignar) return false;
  }
  return true;
}

function agruparYContar_(filas, campo) {
  const contadores = {};
  filas.forEach((fila) => {
    const clave = fila[campo] || '(sin dato)';
    contadores[clave] = (contadores[clave] || 0) + 1;
  });
  return Object.keys(contadores).map((clave) => ({ clave: clave, total: contadores[clave] }));
}

function topN_(agrupado, n) {
  return agrupado.slice().sort((a, b) => b.total - a.total).slice(0, n);
}

// P5: true si el item sigue "esperando informacion" (S06) Y ya existe un
// comentario publico posterior a la ULTIMA vez que entro a S06 -- el
// solicitante ya respondio y el gestor todavia no movio el estado.
function respuestaPendienteLectura_(subsolicitud, historial, comentariosPublicos) {
  if (subsolicitud.estado !== ESTADOS.S06) return false;
  const entradasS06 = historial.filter((h) => h.subsolicitud_id === subsolicitud.subsolicitud_id && h.estado_nuevo === ESTADOS.S06);
  if (entradasS06.length === 0) return false;
  const ultimaEntradaS06 = entradasS06.reduce((masReciente, h) => (new Date(h.timestamp) > new Date(masReciente.timestamp) ? h : masReciente));
  return comentariosPublicos.some((c) =>
    (c.subsolicitud_id === subsolicitud.subsolicitud_id || !c.subsolicitud_id) &&
    c.solicitud_id === subsolicitud.solicitud_id &&
    new Date(c.timestamp) > new Date(ultimaEntradaS06.timestamp));
}

// Minimo (mas urgente) de horas habiles restantes de SLA entre los items
// activos de la solicitud; null si ninguno tiene SLA vigente.
function slaRestanteHoras_(items, feriados, medicionPorSub) {
  const restantes = items
    .map((sub) => {
      const medicion = medicionPorSub && medicionPorSub[sub.subsolicitud_id] !== undefined
        ? medicionPorSub[sub.subsolicitud_id]
        : Cumplimiento.medir(sub, { feriados: feriados });
      return medicion ? medicion.restantes_horas : null;
    })
    .filter((h) => h !== null);
  if (restantes.length === 0) return null;
  return Math.round(Math.min.apply(null, restantes) * 10) / 10;
}

// Tiempo promedio (horas habiles) entre creacion y cierre (S09), tomado de
// HISTORIAL_ESTADOS. Excluye atenciones directas: se crean y cierran en el
// mismo instante, hundirian el promedio con una lectura falsa.
function tiempoPromedioResolucion_(solicitudes, historial, feriados) {
  const tiempos = [];
  solicitudes.forEach((solicitud) => {
    if (solicitud.estado_derivado !== ESTADOS.S09) return;
    if (esAtencionDirecta_(solicitud)) return;
    const cierres = historial.filter((h) => h.solicitud_id === solicitud.solicitud_id && h.estado_nuevo === ESTADOS.S09);
    if (cierres.length === 0) return;
    const fechaCierre = cierres.reduce((masReciente, h) => (new Date(h.timestamp) > new Date(masReciente) ? h.timestamp : masReciente), cierres[0].timestamp);
    tiempos.push(Utils.horasHabilesEntre(solicitud.fecha_creacion, fechaCierre, { feriados: feriados }));
  });
  if (tiempos.length === 0) return 0;
  const suma = tiempos.reduce((acc, t) => acc + t, 0);
  return Math.round((suma / tiempos.length) * 10) / 10;
}

function claveMes_(fechaIso) {
  const fecha = new Date(fechaIso);
  return fecha.getFullYear() + '-' + ('0' + (fecha.getMonth() + 1)).slice(-2);
}

function tendenciaMensual_(solicitudes, historial, meses) {
  const ahora = new Date();
  const claves = [];
  for (let i = meses - 1; i >= 0; i--) {
    const fecha = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
    claves.push(fecha.getFullYear() + '-' + ('0' + (fecha.getMonth() + 1)).slice(-2));
  }
  const ingresadasPorMes = {};
  solicitudes.forEach((s) => { const c = claveMes_(s.fecha_creacion); ingresadasPorMes[c] = (ingresadasPorMes[c] || 0) + 1; });
  const resueltasPorMes = {};
  historial.filter((h) => h.estado_nuevo === ESTADOS.S09).forEach((h) => { const c = claveMes_(h.timestamp); resueltasPorMes[c] = (resueltasPorMes[c] || 0) + 1; });
  return claves.map((clave) => ({ mes: clave, ingresadas: ingresadasPorMes[clave] || 0, resueltas: resueltasPorMes[clave] || 0 }));
}

// P7: agrupa subsolicitudes recientes (ultimos PATRON_VENTANA_DIAS, sin
// rechazadas/canceladas) por (modulo, tipo) y devuelve solo los grupos que
// superan el umbral.
function calcularAlertasPatron_(db) {
  const ahora = Date.now();
  const ventanaMs = PATRON_VENTANA_DIAS * 24 * 60 * 60 * 1000;
  const solicitudPorId = {};
  leerFilas_(db, 'SOLICITUDES', COLUMNAS.SOLICITUDES).forEach((s) => { solicitudPorId[s.solicitud_id] = s; });

  const grupos = {};
  leerFilas_(db, 'SUBSOLICITUDES', COLUMNAS.SUBSOLICITUDES).forEach((sub) => {
    if (!sub.modulo || !sub.tipo) return;
    if (ESTADOS_EXCLUIDOS_DERIVACION.indexOf(sub.estado) !== -1) return;
    if (ahora - new Date(sub.fecha_creacion).getTime() > ventanaMs) return;
    const solicitud = solicitudPorId[sub.solicitud_id];
    if (!solicitud) return;

    const clave = sub.modulo + '||' + sub.tipo;
    if (!grupos[clave]) grupos[clave] = { modulo: sub.modulo_nombre || sub.modulo, tipo: sub.tipo_nombre || sub.tipo, cantidad: 0, solicitantes: {} };
    grupos[clave].cantidad++;
    grupos[clave].solicitantes[solicitud.solicitante_email] = true;
  });

  return Object.keys(grupos)
    .map((clave) => {
      const g = grupos[clave];
      return { modulo: g.modulo, tipo: g.tipo, cantidad: g.cantidad, solicitantes_distintos: Object.keys(g.solicitantes).length };
    })
    .filter((g) => g.cantidad >= PATRON_CANTIDAD_MINIMA && g.solicitantes_distintos >= PATRON_SOLICITANTES_MINIMOS)
    .sort((a, b) => b.cantidad - a.cantidad);
}

// v6.1: clave de orden de la bandeja. Menor = mas arriba. Es una COLA DE
// TRABAJO, no un registro cronologico: "cuanto corre" decide el orden, no
// "cuando entro". Garantiza la coherencia KPI -> lista: al recortar a
// RECIENTES_LIMITE, lo vencido/en riesgo siempre queda dentro de la ventana.
const ORDEN_SITUACION_SLA = { FUERA_DE_PLAZO: 0, EN_RIESGO: 1, EN_PLAZO: 2 };

function ordenUrgencia_(fila) {
  const cerrada = ESTADOS_CERRADOS.indexOf(fila.estado_derivado) !== -1;
  const nivel = cerrada ? 9 : (fila.situacion_sla ? ORDEN_SITUACION_SLA[fila.situacion_sla] : 3);
  const restantes = fila.sla_restante_horas === null || fila.sla_restante_horas === undefined ? Number.MAX_SAFE_INTEGER : fila.sla_restante_horas;
  return nivel * 1e15 + restantes * 1e6 - new Date(fila.fecha_creacion).getTime() / 1e6;
}

function calcularKpis_(db, filtros) {
  const feriados = Cumplimiento.obtenerFeriados(db);
  const todasSubsolicitudes = leerFilas_(db, 'SUBSOLICITUDES', COLUMNAS.SUBSOLICITUDES);

  // Para la vista del DEV: si alguna subsolicitud (no solo la solicitud
  // completa) esta asignada a el (§13.3 v1.0).
  const idsAsignadosPorItem = {};
  if (filtros.vistaDev) {
    todasSubsolicitudes.forEach((sub) => { if (sub.desarrollador_asignado === filtros.vistaDev) idsAsignadosPorItem[sub.solicitud_id] = true; });
  }

  const titulosPorSolicitud = {};
  todasSubsolicitudes.forEach((sub) => {
    if (!titulosPorSolicitud[sub.solicitud_id]) titulosPorSolicitud[sub.solicitud_id] = [];
    if (sub.titulo) titulosPorSolicitud[sub.solicitud_id].push(sub.titulo);
  });

  const solicitudes = leerFilas_(db, 'SOLICITUDES', COLUMNAS.SOLICITUDES)
    .filter((s) => coincideFiltros_(s, filtros, idsAsignadosPorItem, titulosPorSolicitud));
  const idsSolicitudes = {};
  solicitudes.forEach((s) => { idsSolicitudes[s.solicitud_id] = true; });

  const subsolicitudes = todasSubsolicitudes.filter((sub) => idsSolicitudes[sub.solicitud_id]);
  const historial = leerFilas_(db, 'HISTORIAL_ESTADOS', COLUMNAS.HISTORIAL_ESTADOS).filter((h) => idsSolicitudes[h.solicitud_id]);
  const comentariosPublicos = leerFilas_(db, 'COMENTARIOS', COLUMNAS.COMENTARIOS).filter((c) => idsSolicitudes[c.solicitud_id] && !c.es_interno);

  const abiertas = solicitudes.filter((s) => ESTADOS_CERRADOS.indexOf(s.estado_derivado) === -1);
  const hoy = Utils.claveDia_(new Date(), 'America/Santiago');

  const nombrePorEmail = {};
  leerFilasSeguro_(db, 'USUARIOS').forEach((u) => { nombrePorEmail[u.email] = u.nombre || u.email; });

  const ultimoMovimientoPorSolicitud = {};
  historial.forEach((h) => {
    const actual = ultimoMovimientoPorSolicitud[h.solicitud_id];
    if (!actual || new Date(h.timestamp) > new Date(actual)) ultimoMovimientoPorSolicitud[h.solicitud_id] = h.timestamp;
  });

  const medicionPorSub = {};
  const situacionesPorSolicitud = {};
  const itemsPorSolicitud = {};
  subsolicitudes.forEach((sub) => {
    const medicion = Cumplimiento.medir(sub, { feriados: feriados });
    medicionPorSub[sub.subsolicitud_id] = medicion;
    if (!itemsPorSolicitud[sub.solicitud_id]) { itemsPorSolicitud[sub.solicitud_id] = []; situacionesPorSolicitud[sub.solicitud_id] = []; }
    itemsPorSolicitud[sub.solicitud_id].push(sub);
    situacionesPorSolicitud[sub.solicitud_id].push(medicion ? medicion.situacion : null);
  });
  function situacionSlaDe_(solicitudId) {
    return Cumplimiento.peorSituacion(situacionesPorSolicitud[solicitudId] || []);
  }

  const recientesTodas = solicitudes.map((s) => {
    const itemsDeEstaSolicitud = itemsPorSolicitud[s.solicitud_id] || [];
    const ultimoMovimiento = ultimoMovimientoPorSolicitud[s.solicitud_id] || s.fecha_creacion;
    return {
      solicitud_id: s.solicitud_id, empresa_id: s.empresa_id, plataforma: s.plataforma,
      modulo: s.modulo, estado_derivado: s.estado_derivado, prioridad_derivada: s.prioridad_derivada,
      fecha_creacion: s.fecha_creacion, asignado_a: asignadoDeSolicitud_(s, itemsDeEstaSolicitud),
      asignado_nombre: nombreAsignado_(asignadoDeSolicitud_(s, itemsDeEstaSolicitud), nombrePorEmail),
      titulo_item: itemsDeEstaSolicitud.length ? itemsDeEstaSolicitud[0].titulo : '',
      fecha_comprometida: itemsDeEstaSolicitud.length === 1 ? (itemsDeEstaSolicitud[0].fecha_comprometida || '') : '',
      dias_sin_movimiento: Math.floor((Date.now() - new Date(ultimoMovimiento).getTime()) / (24 * 3600 * 1000)),
      cantidad_items: itemsDeEstaSolicitud.length,
      sla_restante_horas: slaRestanteHoras_(itemsDeEstaSolicitud, feriados, medicionPorSub),
      situacion_sla: situacionSlaDe_(s.solicitud_id),
      solicitante_nombre: s.solicitante_nombre || '', solicitante_email: s.solicitante_email || '',
      texto_busqueda: textoBusquedaSolicitud_(s, titulosPorSolicitud),
      respuesta_pendiente: itemsDeEstaSolicitud.some((sub) => respuestaPendienteLectura_(sub, historial, comentariosPublicos))
    };
  });

  return {
    resumen: {
      total_abiertas: abiertas.length,
      criticas_activas: abiertas.filter((s) => s.prioridad_derivada === 'P1').length,
      sla_vencido: subsolicitudes.filter((sub) => { const m = medicionPorSub[sub.subsolicitud_id]; return !!m && m.situacion === 'FUERA_DE_PLAZO'; }).length,
      en_riesgo: subsolicitudes.filter((sub) => { const m = medicionPorSub[sub.subsolicitud_id]; return !!m && m.situacion === 'EN_RIESGO'; }).length,
      del_dia: solicitudes.filter((s) => Utils.claveDia_(new Date(s.fecha_creacion), 'America/Santiago') === hoy).length,
      // Se asigna POR ÍTEM: una solicitud está sin asignar solo si tiene algún
      // ítem abierto sin responsable propio ni de la solicitud (SIGSO v2, M3:
      // antes contaba el campo de la solicitud, que nadie actualiza al asignar
      // ítems, y marcaba 24 cuando la realidad era 1).
      sin_asignar: abiertas.filter((s) => solicitudSinAsignar_(s, itemsPorSolicitud[s.solicitud_id] || [])).length,
      atenciones_directas: solicitudes.filter(esAtencionDirecta_).length
    },
    por_empresa: agruparYContar_(solicitudes, 'empresa_id'),
    por_plataforma: agruparYContar_(solicitudes, 'plataforma'),
    por_tipo: agruparYContar_(solicitudes, 'tipo'),
    por_estado: agruparYContar_(solicitudes, 'estado_derivado'),
    por_prioridad: agruparYContar_(solicitudes, 'prioridad_derivada'),
    top_modulos: topN_(agruparYContar_(solicitudes, 'modulo'), TOP_MODULOS_CANTIDAD),
    tiempo_promedio_resolucion_horas: tiempoPromedioResolucion_(solicitudes, historial, feriados),
    tendencia_mensual: tendenciaMensual_(solicitudes, historial, MESES_TENDENCIA),
    // Siempre globales (todas las empresas/modulos), sin importar los
    // filtros activos: el valor esta en ver un patron que CRUZA empresas.
    alertas_patron: calcularAlertasPatron_(db),
    recientes: recientesTodas.slice().sort((a, b) => ordenUrgencia_(a) - ordenUrgencia_(b)).slice(0, RECIENTES_LIMITE),
    total_solicitudes: recientesTodas.length,
    recientes_truncado: recientesTodas.length > RECIENTES_LIMITE
  };
}

// Responsable de una solicitud para mostrar en la lista: el de la cabecera
// o, si no hay, el de sus ítems (se asigna por ítem).
// Un responsable que no es un correo (p. ej. el texto de plantilla
// "[CORREO_LEO]" que quedó en producción) no le llega a nadie: cuenta como
// sin asignar.
function responsableValido_(v) {
  const t = String(v || '').trim();
  return /^[^\s@[\]]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : '';
}
function asignadoDeSolicitud_(solicitud, items) {
  if (responsableValido_(solicitud.desarrollador_asignado)) return responsableValido_(solicitud.desarrollador_asignado);
  const asignados = items.map((i) => responsableValido_(i.desarrollador_asignado)).filter(Boolean);
  return asignados.length ? asignados[0] : '';
}
function nombreAsignado_(email, nombrePorEmail) { return email ? (nombrePorEmail[email] || email) : ''; }
function solicitudSinAsignar_(solicitud, items) {
  if (responsableValido_(solicitud.desarrollador_asignado)) return false;
  const abiertos = items.filter((i) => ESTADOS_CERRADOS.indexOf(i.estado) === -1 && i.estado !== ESTADOS.S08);
  if (!abiertos.length) return false;
  return abiertos.some((i) => !responsableValido_(i.desarrollador_asignado));
}

function getData(db, filtros, contexto) {
  const filtrosEfectivos = aplicarAmbitoRol_(filtros || {}, contexto);
  const datos = calcularKpis_(db, filtrosEfectivos);
  datos.rol_actual = contexto ? contexto.rol : '';
  agregarResponsablesSiCorresponde_(db, datos, contexto);
  return datos;
}

// v5.2 (Fase B, §3.4): pauta de trabajo por lote -- TODOS los items abiertos
// de un desarrollador, a nivel de ITEM (no de solicitud como `recientes`).
function getPautaDesarrollador(db, data, contexto) {
  const desarrollador = data && data.desarrollador;
  if (!desarrollador) return errorValidacion('desarrollador', 'Falta indicar el desarrollador.');

  const solicitudPorId = {};
  leerFilas_(db, 'SOLICITUDES', COLUMNAS.SOLICITUDES).forEach((s) => { solicitudPorId[s.solicitud_id] = s; });

  const items = leerFilas_(db, 'SUBSOLICITUDES', COLUMNAS.SUBSOLICITUDES)
    .filter((sub) => {
      const solicitud = solicitudPorId[sub.solicitud_id];
      if (!solicitud) return false;
      const asignado = sub.desarrollador_asignado || solicitud.desarrollador_asignado || '';
      return asignado === desarrollador && ESTADOS_CERRADOS.indexOf(sub.estado) === -1;
    })
    .map((sub) => {
      const solicitud = solicitudPorId[sub.solicitud_id];
      return {
        subsolicitud_id: sub.subsolicitud_id, solicitud_id: sub.solicitud_id, numero_item: sub.numero_item,
        titulo: sub.titulo, descripcion: sub.descripcion, resultado_esperado: sub.resultado_esperado || '',
        prioridad: sub.prioridad, estado: sub.estado, fecha_comprometida: sub.fecha_comprometida || '',
        url_modulo: sub.url_modulo || '', usuario_prueba: sub.usuario_prueba || '', ref_credencial: sub.ref_credencial || '',
        empresa_nombre: solicitud.empresa_nombre || solicitud.empresa_id, solicitante_nombre: solicitud.solicitante_nombre
      };
    })
    // P1 primero; a igual prioridad, fecha comprometida mas proxima primero
    // (sin fecha, al final del grupo).
    .sort((a, b) => {
      if (a.prioridad !== b.prioridad) return a.prioridad.localeCompare(b.prioridad);
      if (!a.fecha_comprometida) return 1;
      if (!b.fecha_comprometida) return -1;
      return new Date(a.fecha_comprometida) - new Date(b.fecha_comprometida);
    });

  return { desarrollador: desarrollador, items: items };
}

// SIGSO v2, Módulo 3A — cola de la Bandeja POR ÍTEM (la unidad que se asigna
// y se trabaja). Mismo alcance por rol que getData, llevado al ítem:
//  - ADM ve todo (o la bandeja de una persona con verBandeja);
//  - el resto ve los ítems asignados a sí (al ítem o, si el ítem no tiene
//    responsable propio, a su solicitud) y, solo DEV, los huérfanos activos
//    en estados de trabajo -- el mismo respaldo que la bandeja clásica.
// Los KPIs se cuentan sobre ítems: no dependen de campos de cabecera.
const ESTADOS_POR_REVISAR = [ESTADOS.S01, ESTADOS.S02];
function getCola(db, filtros, contexto) {
  filtros = filtros || {};
  const rol = contexto ? contexto.rol : '';
  const email = String((contexto && contexto.email) || '').toLowerCase();
  const verBandeja = rol === 'ADM' ? String(filtros.verBandeja || '').toLowerCase() : email;
  const feriados = Cumplimiento.obtenerFeriados(db);
  const solicitudes = {};
  leerFilas_(db, 'SOLICITUDES', COLUMNAS.SOLICITUDES).forEach((s) => { solicitudes[s.solicitud_id] = s; });
  const todas = leerFilas_(db, 'SUBSOLICITUDES', COLUMNAS.SUBSOLICITUDES).filter((i) => solicitudes[i.solicitud_id]);
  const itemsPorSolicitud = {};
  todas.forEach((i) => { (itemsPorSolicitud[i.solicitud_id] = itemsPorSolicitud[i.solicitud_id] || []).push(i); });
  const historial = leerFilas_(db, 'HISTORIAL_ESTADOS', COLUMNAS.HISTORIAL_ESTADOS);
  const comentariosPublicos = leerFilas_(db, 'COMENTARIOS', COLUMNAS.COMENTARIOS).filter((c) => !c.es_interno);
  const nombrePorEmail = {};
  leerFilasSeguro_(db, 'USUARIOS').forEach((u) => { nombrePorEmail[String(u.email || '').toLowerCase()] = u.nombre || u.email; });
  const ultimoMovimiento = {};
  historial.forEach((h) => {
    const k = h.subsolicitud_id || h.solicitud_id;
    if (!ultimoMovimiento[k] || new Date(h.timestamp) > new Date(ultimoMovimiento[k])) ultimoMovimiento[k] = h.timestamp;
  });

  const visibles = todas.filter((i) => {
    const s = solicitudes[i.solicitud_id];
    const asignado = (responsableValido_(i.desarrollador_asignado) || responsableValido_(s.desarrollador_asignado)).toLowerCase();
    if (!verBandeja) return true; // ADM sin acotar
    if (asignado === verBandeja) return true;
    return rol === 'DEV' && !filtros.verBandeja && !asignado && ESTADOS_TRABAJO_DEV.indexOf(i.estado) !== -1;
  });

  const hoy = Utils.claveDia_(new Date(), 'America/Santiago');
  const items = visibles.map((i) => {
    const s = solicitudes[i.solicitud_id];
    const medicion = Cumplimiento.medir(i, { feriados: feriados });
    const propio = responsableValido_(i.desarrollador_asignado).toLowerCase();
    const asignado = propio || responsableValido_(s.desarrollador_asignado).toLowerCase();
    const mov = ultimoMovimiento[i.subsolicitud_id] || ultimoMovimiento[i.solicitud_id] || i.fecha_creacion || s.fecha_creacion;
    return {
      subsolicitud_id: i.subsolicitud_id, solicitud_id: i.solicitud_id, numero_item: i.numero_item,
      cantidad_items: (itemsPorSolicitud[i.solicitud_id] || []).length,
      titulo: i.titulo, tipo: i.tipo, tipo_nombre: i.tipo_nombre, modulo_nombre: i.modulo_nombre || s.modulo_nombre || '',
      estado: i.estado, prioridad: i.prioridad, estado_solicitud: s.estado_derivado,
      asignado: asignado, asignado_nombre: asignado ? (nombrePorEmail[asignado] || asignado) : '', asignado_heredado: !propio && !!asignado,
      fecha_creacion: i.fecha_creacion || s.fecha_creacion, fecha_comprometida: i.fecha_comprometida || '',
      fecha_propuesta: i.fecha_propuesta || '',
      dias_sin_movimiento: Math.floor((Date.now() - new Date(mov).getTime()) / 86400000),
      situacion_sla: medicion ? medicion.situacion : null,
      sla_restante_horas: medicion ? Math.round(medicion.restantes_horas * 10) / 10 : null,
      respuesta_pendiente: respuestaPendienteLectura_(i, historial, comentariosPublicos),
      empresa_id: s.empresa_id, empresa_nombre: s.empresa_nombre || s.empresa_id, plataforma_nombre: s.plataforma_nombre || s.plataforma || '',
      solicitante_nombre: s.solicitante_nombre || '', solicitante_email: s.solicitante_email || '',
      es_cliente: s.es_cliente === true || s.es_cliente === 'TRUE', empresa_cliente: s.empresa_cliente || ''
    };
  });

  const abiertos = items.filter((i) => ESTADOS_CERRADOS.indexOf(i.estado) === -1 && i.estado !== ESTADOS.S08);
  const soloLectura = rol === 'GERENCIA' || rol === 'JEFATURA';
  return {
    items: items,
    resumen: {
      abiertos: abiertos.length,
      por_revisar: abiertos.filter((i) => ESTADOS_POR_REVISAR.indexOf(i.estado) !== -1).length,
      sin_asignar: abiertos.filter((i) => !i.asignado).length,
      fuera_de_plazo: abiertos.filter((i) => i.situacion_sla === 'FUERA_DE_PLAZO').length,
      en_riesgo: abiertos.filter((i) => i.situacion_sla === 'EN_RIESGO').length,
      sin_fecha: abiertos.filter((i) => !i.fecha_comprometida).length,
      esperando_info: abiertos.filter((i) => i.estado === ESTADOS.S06).length,
      criticos: abiertos.filter((i) => i.prioridad === 'P1').length,
      por_validar: items.filter((i) => i.estado === ESTADOS.S08).length,
      ingresados_hoy: items.filter((i) => Utils.claveDia_(new Date(i.fecha_creacion), 'America/Santiago') === hoy).length
    },
    rol_actual: rol,
    solo_lectura: soloLectura,
    ver_bandeja: rol === 'ADM' ? (filtros.verBandeja || '') : email,
    responsables: soloLectura ? [] : obtenerResponsablesActivos_(db)
  };
}

module.exports = {
  getData, getPautaDesarrollador, getCola, obtenerResponsablesActivos_, RECIENTES_LIMITE,
  // Reutilizadas por gerencia.js (mismo criterio que el .gs: Gerencia.getPanel
  // reusa coincideFiltros_/esAtencionDirecta_ de Dashboard.gs en vez de
  // reimplementarlas -- todo vive en el mismo scope global en Apps Script).
  coincideFiltros_, esAtencionDirecta_,
  // Reutilizada por notificaciones.js (detectarPatrones, P7) -- mismo
  // calculo que ya usa getData para el campo alertas_patron.
  calcularAlertasPatron_, PATRON_VENTANA_DIAS
};
