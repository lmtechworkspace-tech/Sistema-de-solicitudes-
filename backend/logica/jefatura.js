'use strict';

/**
 * jefatura.js — puerto de backend/backoffice/Jefatura.gs: el CRUD de la
 * relacion jefe->subordinado (solo ADM), las funciones de guardia que
 * Solicitudes.getDetalle usa para acotar el rol JEFATURA a su equipo, y
 * getPanel -- "Mi departamento": un "Gerencia acotado" siempre al equipo
 * del jefe (nunca al sistema completo), en solo lectura.
 *
 * getPanel reusa el criterio de gerencia.js (coincideFiltroItem_,
 * mapaNombresUsuarios_, diasHabilesRedondeado_, promedio_, lineaBasePorItem_,
 * contarPorSubsolicitud_, contarReaperturasPorSubsolicitud_) en vez de
 * reimplementarlo -- mismo motivo que el .gs: si un jefe y Gerencia
 * cortaran "de quien es este item" distinto, verian numeros distintos del
 * mismo equipo.
 */

const crypto = require('node:crypto');
const { agregarFila_, actualizarFilaPorId_, eliminarFilasPorId_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { errorValidacion, errorForbidden } = require('./errores');
const { ESTADOS, ESTADOS_CERRADOS } = require('./constantesSolicitudes');
const Utils = require('./utils');
const Cumplimiento = require('./cumplimiento');
const {
  coincideFiltroItem_, mapaNombresUsuarios_, diasHabilesRedondeado_, promedio_,
  lineaBasePorItem_, contarPorSubsolicitud_, contarReaperturasPorSubsolicitud_
} = require('./gerencia');
const { esAtencionDirecta_ } = require('./dashboard');

function leerFilasSeguro_(db, hoja) {
  try { return leerFilas_(db, hoja, COLUMNAS[hoja]); } catch (err) { return []; }
}

// Equipo ACTIVO de un jefe -- lista de correos (sin el propio). [] si el
// jefe no tiene a nadie a cargo (tolerante a instalaciones sin la hoja).
function obtenerEquipoJefe_(db, jefeEmail) {
  if (!jefeEmail) return [];
  return leerFilasSeguro_(db, 'JEFATURAS')
    .filter((j) => {
      const activo = j.activo === true || j.activo === 'TRUE' || j.activo === 1;
      return activo && j.jefe_email === jefeEmail;
    })
    .map((j) => j.subordinado_email)
    .filter((email, i, todos) => email && todos.indexOf(email) === i);
}

// Inverso de obtenerEquipoJefe_: el jefe ACTIVO de un subordinado (o '' si
// no tiene). Lo usa Novedades.gs (aprobacion controlada por la jefatura del
// autor); mismo criterio de igualdad exacta que obtenerEquipoJefe_.
function jefeDeSubordinado_(db, subordinadoEmail) {
  if (!subordinadoEmail) return '';
  const fila = leerFilasSeguro_(db, 'JEFATURAS').find((j) => {
    const activo = j.activo === true || j.activo === 'TRUE' || j.activo === 1;
    return activo && j.subordinado_email === subordinadoEmail;
  });
  return fila ? fila.jefe_email : '';
}

/**
 * Una solicitud/subsolicitud es "de mi equipo" si el SOLICITANTE o el
 * RESOLUTOR (del item puntual, o el de la cabecera como respaldo) esta en
 * el equipo. Reusada por getDetalle (el guardia de acceso al detalle
 * individual) -- si Jefatura.getPanel se porta despues, debe reusar esta
 * MISMA funcion, no reimplementar el criterio (ver la nota real en el .gs
 * sobre por que dos implementaciones divergieron una vez).
 */
function esDelEquipoJefatura_(solicitud, subsolicitud, equipoSet) {
  if (equipoSet[solicitud.solicitante_email]) return true;
  const responsable = (subsolicitud && subsolicitud.desarrollador_asignado) || solicitud.desarrollador_asignado;
  return !!(responsable && equipoSet[responsable]);
}

// Igual que esDelEquipoJefatura_ pero evaluando TODAS las subsolicitudes de
// la solicitud (el guardia de getDetalle no recibe una subsolicitud
// puntual sino el id de la solicitud completa).
function esDelEquipoJefaturaSolicitud_(solicitud, subsolicitudes, equipoSet) {
  if (esDelEquipoJefatura_(solicitud, null, equipoSet)) return true;
  return (subsolicitudes || []).some((sub) => equipoSet[sub.desarrollador_asignado]);
}

function listar(db, data, contexto) {
  if (contexto.rol !== 'ADM') {
    return errorForbidden('Solo un Administrador puede ver las jefaturas.');
  }
  return leerFilasSeguro_(db, 'JEFATURAS');
}

function crearJefatura_(db, data) {
  const jefeEmail = String(data.jefe_email || '').trim().toLowerCase();
  const subordinadoEmail = String(data.subordinado_email || '').trim().toLowerCase();
  if (!jefeEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(jefeEmail)) {
    return errorValidacion('jefe_email', 'Correo del jefe invalido.');
  }
  if (!subordinadoEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(subordinadoEmail)) {
    return errorValidacion('subordinado_email', 'Correo de la persona a cargo invalido.');
  }
  if (jefeEmail === subordinadoEmail) {
    return errorValidacion('subordinado_email', 'Una persona no puede ser su propio jefe.');
  }
  const existente = leerFilasSeguro_(db, 'JEFATURAS').find((j) => {
    const activo = j.activo === true || j.activo === 'TRUE' || j.activo === 1;
    return activo && j.jefe_email === jefeEmail && j.subordinado_email === subordinadoEmail;
  });
  if (existente) {
    return errorValidacion('subordinado_email', 'Esa persona ya esta a cargo de ese jefe.');
  }
  const fila = { jefatura_id: crypto.randomUUID(), jefe_email: jefeEmail, subordinado_email: subordinadoEmail, activo: true };
  agregarFila_(db, 'JEFATURAS', fila);
  return fila;
}

function activarJefatura_(db, data) {
  if (!data.jefatura_id) return errorValidacion('jefatura_id', 'Falta indicar la relacion a modificar.');
  actualizarFilaPorId_(db, 'JEFATURAS', 'jefatura_id', data.jefatura_id, { activo: data.activo !== false });
  return { jefatura_id: data.jefatura_id, activo: data.activo !== false };
}

function eliminarJefatura_(db, data) {
  if (!data.jefatura_id) return errorValidacion('jefatura_id', 'Falta indicar la relacion a eliminar.');
  eliminarFilasPorId_(db, 'JEFATURAS', 'jefatura_id', data.jefatura_id);
  return { jefatura_id: data.jefatura_id, eliminada: true };
}

function gestionar(db, data, contexto) {
  if (contexto.rol !== 'ADM') {
    return errorForbidden('Solo un Administrador puede gestionar jefaturas.');
  }
  switch (data.operacion) {
    case 'crear': return crearJefatura_(db, data);
    case 'activar': return activarJefatura_(db, data);
    case 'eliminar': return eliminarJefatura_(db, data);
    default:
      return errorValidacion('operacion', 'Operacion invalida: ' + data.operacion);
  }
}

// Banda de KPIs del equipo -- mismo espiritu que Gerencia.calcularKpisGerencia_
// pero sin el comparativo de periodo (no forma parte de lo aprobado para
// Jefatura, que prioriza "hoy" sobre "tendencia de 30 dias").
function calcularKpisJefatura_(items) {
  const abiertas = items.filter((i) => ESTADOS_CERRADOS.indexOf(i.estado) === -1);
  const enRiesgoOAtrasadas = items.filter((i) => i.cumplimiento.codigo === 'EN_RIESGO' || i.cumplimiento.codigo === 'ATRASADA_DESARROLLADOR');
  const esperandoValidacion = items.filter((i) => i.cumplimiento.codigo === 'ESPERANDO_VALIDACION');
  const entregados = items.filter((i) => !!i.fecha_terminada && !!i.fecha_comprometida);
  const entregadosATiempo = entregados.filter((i) => new Date(i.fecha_terminada) <= new Date(i.fecha_comprometida));
  const diasResolucion = items.filter((i) => ESTADOS_CERRADOS.indexOf(i.estado) !== -1 && i.fecha_terminada).map((i) => i.dias_abierta);

  return {
    total_equipo: items.length,
    abiertas: abiertas.length,
    en_riesgo_o_atrasadas: enRiesgoOAtrasadas.length,
    esperando_validacion: esperandoValidacion.length,
    pct_cumplimiento: entregados.length === 0 ? null : Math.round((entregadosATiempo.length / entregados.length) * 1000) / 10,
    dias_promedio_resolucion: promedio_(diasResolucion)
  };
}

// Version compacta de un item para las listas de "hoy".
function resumirItem_(i) {
  return {
    subsolicitud_id: i.subsolicitud_id, solicitud_id: i.solicitud_id, numero_item: i.numero_item,
    titulo: i.titulo, estado: i.estado, prioridad: i.prioridad,
    solicitante_nombre: i.solicitante_nombre, desarrollador_nombre: i.desarrollador_nombre,
    semaforo: i.cumplimiento.emoji + ' ' + i.cumplimiento.etiqueta
  };
}

// "Hoy en mi departamento" -- el cierre del dia que Jefatura pidio
// explicitamente (§4). "Hoy" se calcula en America/Santiago.
function calcularHoyJefatura_(items, historialEstados, equipoSet) {
  const hoy = Utils.claveDia_(new Date(), 'America/Santiago');
  const idsEquipo = {};
  items.forEach((i) => { idsEquipo[i.subsolicitud_id] = true; });

  const nuevas = items.filter((i) => Utils.claveDia_(new Date(i.fecha_creacion), 'America/Santiago') === hoy);

  const transicionesHoy = historialEstados.filter((h) =>
    idsEquipo[h.subsolicitud_id] && h.estado_nuevo !== ESTADOS.S01 &&
    Utils.claveDia_(new Date(h.timestamp), 'America/Santiago') === hoy);
  // Un item puede tener varias transiciones el mismo dia -- se cuenta UNA
  // vez como "avanzo", no una por transicion.
  const avanzaronIds = {};
  transicionesHoy.forEach((h) => { avanzaronIds[h.subsolicitud_id] = true; });
  const cerradasHoy = transicionesHoy.filter((h) => ESTADOS_CERRADOS.indexOf(h.estado_nuevo) !== -1);
  const cerradasIds = {};
  cerradasHoy.forEach((h) => { cerradasIds[h.subsolicitud_id] = true; });

  const enRiesgoOVencidas = items.filter((i) => i.cumplimiento.codigo === 'EN_RIESGO' || i.cumplimiento.codigo === 'ATRASADA_DESARROLLADOR');
  // "Requieren accion de mi gente": alguien de mi equipo (como solicitante)
  // tiene algo entregado esperando que lo valide.
  const requierenAccion = items.filter((i) => i.cumplimiento.codigo === 'ESPERANDO_VALIDACION' && i.persona_solicitante);

  return {
    nuevas: nuevas.map(resumirItem_),
    avanzaron: items.filter((i) => avanzaronIds[i.subsolicitud_id]).map(resumirItem_),
    cerradas: items.filter((i) => cerradasIds[i.subsolicitud_id]).map(resumirItem_),
    en_riesgo_o_vencidas: enRiesgoOVencidas.map(resumirItem_),
    requieren_accion: requierenAccion.map(resumirItem_),
    resumen: {
      nuevas: nuevas.length, avanzaron: Object.keys(avanzaronIds).length, cerradas: Object.keys(cerradasIds).length,
      en_riesgo: enRiesgoOVencidas.length, requieren_accion: requierenAccion.length
    }
  };
}

// Desglose por persona (§5): una persona puede aparecer como solicitante y
// como resolutor a la vez -- se cuenta cada dimension por separado.
function calcularPorPersonaJefatura_(items, equipo, nombrePorEmail) {
  return equipo.map((email) => {
    const comoSolicitante = items.filter((i) => i.persona_solicitante === email);
    const comoResolutor = items.filter((i) => i.persona_resolutor === email);
    const abiertas_ = (lista) => lista.filter((i) => ESTADOS_CERRADOS.indexOf(i.estado) === -1);
    const enRiesgo_ = (lista) => lista.filter((i) => i.cumplimiento.codigo === 'EN_RIESGO' || i.cumplimiento.codigo === 'ATRASADA_DESARROLLADOR');
    return {
      email: email, nombre: nombrePorEmail[email] || email,
      solicitadas_total: comoSolicitante.length, solicitadas_abiertas: abiertas_(comoSolicitante).length,
      solicitadas_esperando_validacion: comoSolicitante.filter((i) => i.cumplimiento.codigo === 'ESPERANDO_VALIDACION').length,
      asignadas_total: comoResolutor.length, asignadas_abiertas: abiertas_(comoResolutor).length,
      asignadas_en_riesgo: enRiesgo_(comoResolutor).length
    };
  });
}

// Que modulo/tipo se repite en mi equipo (§6) -- version acotada de
// Gerencia.calcularRecurrencia_ (sin tendencia vs periodo anterior: para un
// equipo chico esa comparacion es ruidosa).
function calcularCargaJefatura_(items) {
  function agrupar_(campo, etiquetaVacia) {
    const conteo = {};
    items.forEach((i) => { const c = i[campo] || etiquetaVacia; conteo[c] = (conteo[c] || 0) + 1; });
    return Object.keys(conteo).map((clave) => ({ etiqueta: clave, cantidad: conteo[clave] })).sort((a, b) => b.cantidad - a.cantidad);
  }
  return { por_modulo: agrupar_('modulo_nombre', '(sin módulo)'), por_tipo: agrupar_('tipo_nombre', '(sin tipo)') };
}

// Tendencia de 6 meses del equipo (§7) -- mismo bucket mensual que
// Gerencia.calcularTendenciaTemporal_, sin el % de cumplimiento (ya vive en
// los KPIs de arriba).
function calcularTendenciaJefatura_(items) {
  const MESES_VENTANA = 6;
  const ahora = new Date();
  const buckets = [];
  for (let i = MESES_VENTANA - 1; i >= 0; i--) {
    const fechaBucket = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
    buckets.push({ anio: fechaBucket.getFullYear(), mes: fechaBucket.getMonth(), etiqueta: fechaBucket.toLocaleDateString('es-CL', { month: 'short', year: '2-digit' }), creadas: 0, cerradas: 0 });
  }
  function bucketDe_(fechaIso) {
    const f = new Date(fechaIso);
    for (const b of buckets) { if (b.anio === f.getFullYear() && b.mes === f.getMonth()) return b; }
    return null;
  }
  items.forEach((i) => {
    const bCreacion = bucketDe_(i.fecha_creacion);
    if (bCreacion) bCreacion.creadas++;
    if (i.fecha_terminada) { const bCierre = bucketDe_(i.fecha_terminada); if (bCierre) bCierre.cerradas++; }
  });
  return buckets.map((b) => ({ etiqueta: b.etiqueta, creadas: b.creadas, cerradas: b.cerradas }));
}

/**
 * getPanel(filtros, contexto): "Mi departamento". El aislamiento por
 * equipo va PRIMERO y no depende de `filtros` -- es una regla de acceso,
 * no un corte que la persona elige. Los filtros solo pueden QUITAR de lo
 * que el jefe ya podia ver, nunca agregar.
 */
function getPanel(db, filtros, contexto) {
  const jefeEmail = contexto && contexto.email;
  const equipo = obtenerEquipoJefe_(db, jefeEmail);
  const equipoSet = {};
  equipo.forEach((email) => { equipoSet[email] = true; });

  if (equipo.length === 0) {
    return {
      equipo: [], items: [], kpis: calcularKpisJefatura_([]),
      hoy: calcularHoyJefatura_([], [], equipoSet), por_persona: [],
      carga: { por_modulo: [], por_tipo: [] }, tendencia: calcularTendenciaJefatura_([])
    };
  }

  const nombrePorEmail = mapaNombresUsuarios_(db);
  const historialEstados = leerFilasSeguro_(db, 'HISTORIAL_ESTADOS');
  // El "resbalon" y las reaperturas: mismos ayudantes que usa Gerencia.
  const historialCompromiso = leerFilasSeguro_(db, 'HISTORIAL_COMPROMISO');
  const lineasBaseJef = lineaBasePorItem_(historialCompromiso);
  const reCompromisosJef = contarPorSubsolicitud_(historialCompromiso);
  const reaperturasJef = contarReaperturasPorSubsolicitud_(historialEstados);

  const solicitudes = leerFilas_(db, 'SOLICITUDES', COLUMNAS.SOLICITUDES).filter((s) => !esAtencionDirecta_(s));
  const solicitudPorId = {};
  solicitudes.forEach((s) => { solicitudPorId[s.solicitud_id] = s; });

  const todasSubsolicitudes = leerFilas_(db, 'SUBSOLICITUDES', COLUMNAS.SUBSOLICITUDES);
  const ahora = new Date();

  const filtrosPanel = filtros || {};
  const items = todasSubsolicitudes
    .filter((sub) => {
      const solicitud = solicitudPorId[sub.solicitud_id];
      if (!solicitud || !esDelEquipoJefatura_(solicitud, sub, equipoSet)) return false;
      // Se reusa el criterio de Gerencia: si un jefe y Gerencia cortaran
      // distinto, verian numeros distintos del mismo equipo.
      return coincideFiltroItem_(sub, solicitud, filtrosPanel);
    })
    .map((sub) => {
      const solicitud = solicitudPorId[sub.solicitud_id];
      const cumplimiento = Cumplimiento.clasificar(sub, ahora);
      const personaSolicitante = equipoSet[solicitud.solicitante_email] ? solicitud.solicitante_email : '';
      const responsable = sub.desarrollador_asignado || solicitud.desarrollador_asignado || '';
      const personaResolutor = equipoSet[responsable] ? responsable : '';
      return {
        subsolicitud_id: sub.subsolicitud_id, solicitud_id: sub.solicitud_id, numero_item: sub.numero_item,
        titulo: sub.titulo, descripcion: sub.descripcion || '', resultado_esperado: sub.resultado_esperado || '',
        tipo_nombre: sub.tipo_nombre || sub.tipo || '', modulo_nombre: sub.modulo_nombre || sub.modulo || '',
        empresa_id: solicitud.empresa_id, plataforma_nombre: solicitud.plataforma_nombre || solicitud.plataforma || '',
        estado: sub.estado, prioridad: sub.prioridad,
        solicitante_nombre: solicitud.solicitante_nombre, solicitante_email: solicitud.solicitante_email,
        desarrollador_asignado: responsable, desarrollador_nombre: nombrePorEmail[responsable] || '',
        // De que lado de mi equipo aparece este item -- puede ser de ambos.
        persona_solicitante: personaSolicitante, persona_resolutor: personaResolutor,
        fecha_creacion: sub.fecha_creacion, fecha_comprometida: sub.fecha_comprometida || '', fecha_terminada: sub.fecha_terminada || '',
        cumplimiento: cumplimiento,
        dias_abierta: diasHabilesRedondeado_(sub.fecha_creacion, ESTADOS_CERRADOS.indexOf(sub.estado) !== -1 ? (sub.fecha_terminada || sub.fecha_creacion) : ahora),
        // La fecha ORIGINAL (antes del primer re-compromiso) hace visible
        // el resbalon: sin ella solo se ve la fecha vigente, que ya
        // incorpora el atraso.
        fecha_original: lineasBaseJef[sub.subsolicitud_id] || sub.fecha_comprometida || '',
        re_compromisos: reCompromisosJef[sub.subsolicitud_id] || 0,
        reaperturas: reaperturasJef[sub.subsolicitud_id] || 0
      };
    });

  const kpis = calcularKpisJefatura_(items);

  return {
    equipo: equipo,
    items: items,
    kpis: kpis,
    hoy: calcularHoyJefatura_(items, historialEstados, equipoSet),
    por_persona: calcularPorPersonaJefatura_(items, equipo, nombrePorEmail),
    carga: calcularCargaJefatura_(items),
    tendencia: calcularTendenciaJefatura_(items)
  };
}

module.exports = { listar, gestionar, getPanel, obtenerEquipoJefe_, jefeDeSubordinado_, esDelEquipoJefatura_, esDelEquipoJefaturaSolicitud_ };
