'use strict';

/**
 * noConformidadesSgc.js — puerto de backend/backoffice/NoConformidades.gs
 * (SGC ISO 9001, Fase 3a, PRO-06). EL MOTOR DE MEJORA del SGC, lo que la
 * auditoría de certificación revisa con más profundidad (§10.2 de la
 * norma). Ciclo: detectar -> CORRECCIÓN (10 días hábiles) -> 5 POR QUÉ ->
 * ACCIÓN CORRECTIVA (20 días hábiles) -> EFICACIA (60 días después) ->
 * CERRADA, o REABIERTA con un ciclo nuevo si no funcionó.
 *
 * LA DECISIÓN CENTRAL DE ESTA FASE (idéntica al `.gs`): la corrección y la
 * acción correctiva NO son un campo de texto con una fecha -- son
 * ACTIVIDADES reales (actividades.js, motor v7.0), etiquetadas con
 * sgc_origen_tipo/sgc_origen_id. Así le aparecen al responsable en "Mi
 * trabajo", con check-in de un clic, semáforo y alertas, sin aprender un
 * flujo nuevo. Reusa Actividades.crear tal cual, nunca reimplementa nada
 * del ciclo de vida de una tarea.
 *
 * Plazos en DÍAS HÁBILES (Utils.sumarDiasHabiles_ + CONFIG_FERIADOS), no
 * calendario. Nada se cierra solo: cerrar una etapa es siempre una decisión
 * explícita de una persona.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('./calidadSgc');
const Actividades = require('./actividades');
const Cumplimiento = require('./cumplimiento');
const Utils = require('./utils');
const Notificaciones = require('./notificaciones');
const NotificacionesApp = require('./notificacionesApp');

const FUENTES_NC = ['AUDITORIA_INTERNA', 'AUDITORIA_EXTERNA', 'QUEJA', 'REVISION_DIRECCION', 'PROCESO', 'OTRO'];
const DIAS_ESCALADO_NC = 5;
const ESTADOS_NC_ABIERTOS = ['ABIERTA', 'EN_CORRECCION', 'EN_ACCION', 'EN_VERIFICACION'];
const DIAS_CORRECCION_NC = 10;
const DIAS_ACCION_NC = 20;
const DIAS_EFICACIA_NC = 60;

function uuid_() { return crypto.randomUUID(); }
function errorValidacion_(campo, mensaje) { return { _validationError: true, campo, message: mensaje }; }
function normalizarEmail_(email) { return String(email || '').trim().toLowerCase(); }
function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }
function esActivo_(fila) { return esVerdadero_(fila.activa); }
function leer_(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
function leerSeguro_(db, hoja) { try { return leer_(db, hoja); } catch (err) { return []; } }
function registrarLogSgc_(db, accion, detalle, contexto) {
  try {
    agregarFila_(db, 'LOG_SISTEMA', {
      log_id: uuid_(), timestamp: new Date().toISOString(), contexto: accion,
      mensaje: ((contexto && contexto.email) || '') + ' → ' + detalle, ref: 'SGC'
    });
  } catch (err) { /* trazabilidad, no el flujo principal */ }
}
function obtenerFeriados_(db) { try { return Cumplimiento.obtenerFeriados(db); } catch (err) { return []; } }
function sumarDiasHabilesSgc_(db, desde, dias) {
  return Utils.sumarDiasHabiles_(desde, dias, { feriados: obtenerFeriados_(db), timezone: 'America/Santiago' });
}

// --- helpers -----------------------------------------------------------------
function buscarNc_(db, ncId) {
  if (!ncId) return null;
  return leerSeguro_(db, 'SGC_NC').find((nc) => nc.nc_id === ncId && esActivo_(nc)) || null;
}
function siguienteCorrelativoNc_(db, fecha) {
  let anio = new Date(fecha).getFullYear();
  if (isNaN(anio)) anio = new Date().getFullYear();
  const delAnio = leerSeguro_(db, 'SGC_NC').filter((nc) => {
    const f = new Date(nc.fecha_deteccion || nc.fecha_creacion);
    return !isNaN(f.getTime()) && f.getFullYear() === anio;
  }).length;
  return 'NC-' + anio + '-' + ('00' + (delAnio + 1)).slice(-3);
}
// Delega en Actividades.crear (motor v7.0) -- cero reimplementacion del
// ciclo de vida de una tarea. SIN requiere_validacion a proposito: la
// validacion real de que la correccion/accion sirvio es el cierre de etapa
// de la NC (cerrarEtapa) / la verificacion de eficacia, no una segunda
// confirmacion del supervisor.
async function crearTareaSgc_(db, datos, contexto) {
  return Actividades.crear(db, {
    titulo: datos.titulo, descripcion: datos.descripcion, responsable_email: datos.responsable_email,
    fecha_compromiso: datos.fecha_compromiso, area_id: datos.area_id || '',
    prioridad: 'P2', origen: 'ASIGNADA', requiere_validacion: false,
    sgc_origen_tipo: datos.origen_tipo, sgc_origen_id: datos.origen_id
  }, contexto);
}
function tareaResumen_(actividad) {
  if (!actividad) return null;
  const semaforo = Actividades.semaforoActividad_(actividad);
  return {
    actividad_id: actividad.actividad_id, titulo: actividad.titulo, responsable_email: actividad.responsable_email,
    estado: actividad.estado, avance_pct: actividad.avance_pct, fecha_compromiso: actividad.fecha_compromiso,
    semaforo: semaforo.codigo, semaforo_etiqueta: semaforo.etiqueta, terminada: actividad.estado === 'TERMINADA'
  };
}
function vencimientoNc_(nc) {
  if (nc.estado === 'ABIERTA' || nc.estado === 'EN_CORRECCION') return { etapa: 'Corrección', plazo: nc.correccion_plazo };
  if (nc.estado === 'EN_ACCION') return { etapa: 'Acción correctiva', plazo: nc.accion_plazo };
  if (nc.estado === 'EN_VERIFICACION') return { etapa: 'Verificación de eficacia', plazo: nc.eficacia_plazo };
  return { etapa: '', plazo: '' };
}
function resumenNc_(nc, actividadesPorId, ahora) {
  const venc = vencimientoNc_(nc);
  const dias = venc.plazo ? Math.ceil((new Date(venc.plazo) - ahora) / 86400000) : null;
  const correccion = nc.correccion_actividad_id ? actividadesPorId[nc.correccion_actividad_id] : null;
  const accion = nc.accion_actividad_id ? actividadesPorId[nc.accion_actividad_id] : null;
  return {
    nc_id: nc.nc_id, correlativo: nc.correlativo, fuente: nc.fuente, referencia_normativa: nc.referencia_normativa || '',
    descripcion: nc.descripcion, area_id: nc.area_id, responsable_email: nc.responsable_email,
    fecha_deteccion: nc.fecha_deteccion, estado: nc.estado, ciclo: Number(nc.ciclo) || 1,
    tiene_causa: !!String(nc.causa_raiz || '').trim(), etapa_actual: venc.etapa, plazo_actual: venc.plazo,
    dias_para_plazo: dias, vencida: dias !== null && dias < 0 && ESTADOS_NC_ABIERTOS.indexOf(nc.estado) !== -1,
    correccion_terminada: !!correccion && correccion.estado === 'TERMINADA',
    accion_terminada: !!accion && accion.estado === 'TERMINADA'
  };
}
function indicadoresNc_(todas, ahora) {
  const abiertas = todas.filter((nc) => ESTADOS_NC_ABIERTOS.indexOf(nc.estado) !== -1);
  const cerradas = todas.filter((nc) => nc.estado === 'CERRADA');
  const vencidas = abiertas.filter((nc) => { const venc = vencimientoNc_(nc); return venc.plazo && new Date(venc.plazo) < ahora; });
  const dias = cerradas.map((nc) => (new Date(nc.fecha_cierre) - new Date(nc.fecha_deteccion)) / 86400000).filter((d) => !isNaN(d) && d >= 0);
  let verificadas = 0, eficaces = 0;
  todas.forEach((nc) => {
    if (!nc.eficacia_resultado) return;
    const esEficaz = nc.eficacia_resultado === 'EFICAZ';
    verificadas += (Number(nc.ciclo) || 1) - 1 + (esEficaz ? 1 : 0);
    if (esEficaz) eficaces += 1;
  });
  return {
    abiertas: abiertas.length, cerradas: cerradas.length, vencidas: vencidas.length,
    dias_promedio_resolucion: dias.length ? Math.round((dias.reduce((a, b) => a + b, 0) / dias.length) * 10) / 10 : null,
    pct_eficacia_positiva: verificadas ? Math.round((eficaces / verificadas) * 1000) / 10 : null
  };
}

// ===========================================================================
// API publica
// ===========================================================================

function listar(db, data, contexto) {
  const filtros = data || {};
  const rol = Calidad.rolSgc_(db, contexto);
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  const email = normalizarEmail_(contexto.email);
  const todas = leerSeguro_(db, 'SGC_NC').filter(esActivo_);
  let visibles = todas.filter((nc) => {
    if (Calidad.veTodoSgc_(db, contexto, rol, gobierna)) return true;
    return normalizarEmail_(nc.responsable_email) === email || normalizarEmail_(nc.detectada_por) === email;
  });
  if (filtros.estado) visibles = visibles.filter((nc) => nc.estado === filtros.estado);
  if (filtros.abiertas) visibles = visibles.filter((nc) => ESTADOS_NC_ABIERTOS.indexOf(nc.estado) !== -1);

  const actividades = leerSeguro_(db, 'ACTIVIDADES');
  const porId = {};
  actividades.forEach((a) => { porId[a.actividad_id] = a; });
  const ahora = new Date();

  return {
    puede_gestionar: gobierna,
    indicadores: indicadoresNc_(todas, ahora),
    no_conformidades: visibles.map((nc) => resumenNc_(nc, porId, ahora)).sort((a, b) => new Date(b.fecha_deteccion || 0) - new Date(a.fecha_deteccion || 0))
  };
}

function getDetalle(db, data, contexto) {
  const nc = buscarNc_(db, data.nc_id);
  if (!nc) return errorValidacion_('nc_id', 'No conformidad no encontrada.');
  const rol = Calidad.rolSgc_(db, contexto);
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  const email = normalizarEmail_(contexto.email);
  const esSuya = normalizarEmail_(nc.responsable_email) === email || normalizarEmail_(nc.detectada_por) === email;
  if (!Calidad.veTodoSgc_(db, contexto, rol, gobierna) && !esSuya) return { _forbidden: true, message: 'No tienes acceso a esta no conformidad.' };

  const actividades = leerSeguro_(db, 'ACTIVIDADES');
  const porId = {};
  actividades.forEach((a) => { porId[a.actividad_id] = a; });

  return {
    nc, puede_gestionar: gobierna, resumen: resumenNc_(nc, porId, new Date()),
    correccion_actividad: nc.correccion_actividad_id ? tareaResumen_(porId[nc.correccion_actividad_id]) : null,
    accion_actividad: nc.accion_actividad_id ? tareaResumen_(porId[nc.accion_actividad_id]) : null
  };
}

function crear(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden registrar no conformidades.' };
  const descripcion = String(data.descripcion || '').trim();
  if (!descripcion) return errorValidacion_('descripcion', 'Describe la no conformidad detectada.');
  if (FUENTES_NC.indexOf(data.fuente) === -1) return errorValidacion_('fuente', 'Indica de dónde salió la no conformidad.');
  const responsable = normalizarEmail_(data.responsable_email);
  if (!responsable) return errorValidacion_('responsable_email', 'Asigna un responsable de la no conformidad.');

  const ahora = new Date();
  const fechaDeteccion = data.fecha_deteccion || ahora.toISOString();
  const nc = {
    nc_id: uuid_(), correlativo: siguienteCorrelativoNc_(db, fechaDeteccion), fuente: data.fuente, origen_ref: data.origen_ref || '',
    referencia_normativa: String(data.referencia_normativa || '').trim(), descripcion, area_id: data.area_id || '',
    detectada_por: normalizarEmail_(contexto.email), fecha_deteccion: fechaDeteccion, responsable_email: responsable,
    estado: 'ABIERTA', ciclo: 1,
    correccion_descripcion: '', correccion_actividad_id: '', correccion_plazo: sumarDiasHabilesSgc_(db, fechaDeteccion, DIAS_CORRECCION_NC),
    correccion_fecha_cierre: '',
    porque_1: '', porque_2: '', porque_3: '', porque_4: '', porque_5: '', causa_raiz: '',
    accion_descripcion: '', accion_actividad_id: '', accion_plazo: '', accion_fecha_cierre: '',
    eficacia_plazo: '', eficacia_fecha: '', eficacia_resultado: '', eficacia_observaciones: '',
    fecha_cierre: '', cerrada_por: '', fecha_creacion: ahora.toISOString(), activa: true
  };
  agregarFila_(db, 'SGC_NC', nc);
  registrarLogSgc_(db, 'SGC_NC_ABIERTA', nc.correlativo + ': ' + descripcion.slice(0, 80), contexto);
  NotificacionesApp.encolarLote(db, [{ destinatario: responsable, tipo: 'SGC_NC', titulo: 'Te asignaron una no conformidad', mensaje: nc.correlativo + ': ' + descripcion.slice(0, 120), modulo_id: 'calidad', texto_accion: 'Ver no conformidad', vidaHoras: 72 }]);
  return nc;
}

async function registrarCorreccion(db, data, contexto) {
  const nc = buscarNc_(db, data.nc_id);
  if (!nc) return errorValidacion_('nc_id', 'No conformidad no encontrada.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden definir la corrección.' };
  const descripcion = String(data.descripcion || '').trim();
  if (!descripcion) return errorValidacion_('descripcion', 'Describe la corrección inmediata.');
  if (nc.correccion_actividad_id) return errorValidacion_('nc_id', 'Esta no conformidad ya tiene una corrección asignada.');

  const responsable = normalizarEmail_(data.responsable_email) || normalizarEmail_(nc.responsable_email);
  const plazo = data.fecha_compromiso || nc.correccion_plazo;
  const tarea = await crearTareaSgc_(db, {
    titulo: '[NC ' + nc.correlativo + '] Corrección: ' + descripcion.slice(0, 80),
    descripcion: 'Corrección de la no conformidad ' + nc.correlativo + '.\n\n' + descripcion + '\n\nNo conformidad: ' + nc.descripcion,
    responsable_email: responsable, fecha_compromiso: plazo, area_id: nc.area_id, origen_tipo: 'NC_CORRECCION', origen_id: nc.nc_id
  }, contexto);
  if (tarea && (tarea._validationError || tarea._forbidden)) return tarea;

  // Releer justo antes de escribir: el await de arriba le dio tiempo a
  // otra peticion sobre la MISMA NC de correr completa y ganar. Sin este
  // chequeo, la escritura de abajo pisaria en silencio esa corrección
  // concurrente -- dejando ademas la Actividad recien creada aqui huerfana.
  const ncFresca = buscarNc_(db, nc.nc_id);
  if (!ncFresca || ncFresca.correccion_actividad_id) {
    return errorValidacion_('nc_id', 'Esta no conformidad ya tiene una corrección asignada (se asignó mientras se procesaba tu solicitud).');
  }

  const actualizada = actualizarFilaPorId_(db, 'SGC_NC', 'nc_id', nc.nc_id, {
    correccion_descripcion: descripcion, correccion_actividad_id: tarea.actividad_id, correccion_plazo: plazo, estado: 'EN_CORRECCION'
  });
  registrarLogSgc_(db, 'SGC_NC_CORRECCION', nc.correlativo, contexto);
  return actualizada;
}

function registrarCausa(db, data, contexto) {
  const nc = buscarNc_(db, data.nc_id);
  if (!nc) return errorValidacion_('nc_id', 'No conformidad no encontrada.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden registrar el análisis de causa.' };
  if (!String(data.porque_1 || '').trim()) return errorValidacion_('porque_1', 'Empieza el análisis: ¿por qué ocurrió?');
  if (!String(data.causa_raiz || '').trim()) return errorValidacion_('causa_raiz', 'Escribe la causa raíz a la que llegaste.');
  const cambios = { causa_raiz: data.causa_raiz };
  for (let i = 1; i <= 5; i++) { if (data['porque_' + i] !== undefined) cambios['porque_' + i] = data['porque_' + i]; }
  if (data.referencia_normativa !== undefined) cambios.referencia_normativa = String(data.referencia_normativa || '').trim();
  const actualizada = actualizarFilaPorId_(db, 'SGC_NC', 'nc_id', nc.nc_id, cambios);
  registrarLogSgc_(db, 'SGC_NC_CAUSA', nc.correlativo, contexto);
  return actualizada;
}

async function registrarAccion(db, data, contexto) {
  const nc = buscarNc_(db, data.nc_id);
  if (!nc) return errorValidacion_('nc_id', 'No conformidad no encontrada.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden definir la acción correctiva.' };
  if (!String(nc.causa_raiz || '').trim()) return errorValidacion_('causa_raiz', 'Antes de definir la acción correctiva hay que registrar la causa raíz.');
  const descripcion = String(data.descripcion || '').trim();
  if (!descripcion) return errorValidacion_('descripcion', 'Describe la acción correctiva.');
  if (nc.accion_actividad_id) return errorValidacion_('nc_id', 'Esta no conformidad ya tiene una acción correctiva asignada.');

  const responsable = normalizarEmail_(data.responsable_email) || normalizarEmail_(nc.responsable_email);
  const base = nc.correccion_fecha_cierre || new Date().toISOString();
  const plazo = data.fecha_compromiso || sumarDiasHabilesSgc_(db, base, DIAS_ACCION_NC);

  const tarea = await crearTareaSgc_(db, {
    titulo: '[NC ' + nc.correlativo + '] Acción correctiva: ' + descripcion.slice(0, 80),
    descripcion: 'Acción correctiva de la no conformidad ' + nc.correlativo + '.\n\n' + descripcion + '\n\nCausa raíz: ' + nc.causa_raiz,
    responsable_email: responsable, fecha_compromiso: plazo, area_id: nc.area_id, origen_tipo: 'NC_ACCION', origen_id: nc.nc_id
  }, contexto);
  if (tarea && (tarea._validationError || tarea._forbidden)) return tarea;

  // Mismo chequeo que registrarCorreccion, ver comentario ahi.
  const ncFresca = buscarNc_(db, nc.nc_id);
  if (!ncFresca || ncFresca.accion_actividad_id) {
    return errorValidacion_('nc_id', 'Esta no conformidad ya tiene una acción correctiva asignada (se asignó mientras se procesaba tu solicitud).');
  }

  const actualizada = actualizarFilaPorId_(db, 'SGC_NC', 'nc_id', nc.nc_id, {
    accion_descripcion: descripcion, accion_actividad_id: tarea.actividad_id, accion_plazo: plazo, estado: 'EN_ACCION'
  });
  registrarLogSgc_(db, 'SGC_NC_ACCION', nc.correlativo, contexto);
  return actualizada;
}

function cerrarEtapa(db, data, contexto) {
  const nc = buscarNc_(db, data.nc_id);
  if (!nc) return errorValidacion_('nc_id', 'No conformidad no encontrada.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden cerrar etapas.' };
  const ahora = new Date().toISOString();

  if (data.etapa === 'CORRECCION') {
    if (!nc.correccion_actividad_id) return errorValidacion_('etapa', 'Todavía no hay corrección asignada.');
    return actualizarFilaPorId_(db, 'SGC_NC', 'nc_id', nc.nc_id, { correccion_fecha_cierre: data.fecha || ahora });
  }
  if (data.etapa === 'ACCION') {
    if (!nc.accion_actividad_id) return errorValidacion_('etapa', 'Todavía no hay acción correctiva asignada.');
    const cierre = data.fecha || ahora;
    return actualizarFilaPorId_(db, 'SGC_NC', 'nc_id', nc.nc_id, {
      accion_fecha_cierre: cierre, estado: 'EN_VERIFICACION', eficacia_plazo: sumarDiasHabilesSgc_(db, cierre, DIAS_EFICACIA_NC)
    });
  }
  return errorValidacion_('etapa', 'Etapa inválida.');
}

function verificarEficacia(db, data, contexto) {
  const nc = buscarNc_(db, data.nc_id);
  if (!nc) return errorValidacion_('nc_id', 'No conformidad no encontrada.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden verificar la eficacia.' };
  if (nc.estado !== 'EN_VERIFICACION') return errorValidacion_('nc_id', 'La acción correctiva todavía no está implementada.');
  if (['EFICAZ', 'NO_EFICAZ'].indexOf(data.resultado) === -1) return errorValidacion_('resultado', 'Indica si la acción correctiva fue eficaz o no.');
  if (!String(data.observaciones || '').trim()) return errorValidacion_('observaciones', 'Explica cómo verificaste la eficacia: es la evidencia de que se revisó.');
  const ahora = new Date().toISOString();

  if (data.resultado === 'EFICAZ') {
    const cerrada = actualizarFilaPorId_(db, 'SGC_NC', 'nc_id', nc.nc_id, {
      eficacia_fecha: ahora, eficacia_resultado: 'EFICAZ', eficacia_observaciones: data.observaciones,
      estado: 'CERRADA', fecha_cierre: ahora, cerrada_por: normalizarEmail_(contexto.email)
    });
    registrarLogSgc_(db, 'SGC_NC_CERRADA', nc.correlativo, contexto);
    return cerrada;
  }

  const reabierta = actualizarFilaPorId_(db, 'SGC_NC', 'nc_id', nc.nc_id, {
    eficacia_fecha: ahora, eficacia_resultado: 'NO_EFICAZ', eficacia_observaciones: data.observaciones,
    estado: 'EN_ACCION', ciclo: (Number(nc.ciclo) || 1) + 1,
    accion_descripcion: '', accion_actividad_id: '', accion_plazo: '', accion_fecha_cierre: '', eficacia_plazo: ''
  });
  registrarLogSgc_(db, 'SGC_NC_REABIERTA', nc.correlativo + ' (ciclo ' + reabierta.ciclo + ')', contexto);
  NotificacionesApp.encolarLote(db, [{ destinatario: nc.responsable_email, tipo: 'SGC_NC', titulo: 'No conformidad reabierta', mensaje: nc.correlativo + ': la acción correctiva no fue eficaz, hay que replantearla.', modulo_id: 'calidad', texto_accion: 'Ver no conformidad', vidaHoras: 72 }]);
  return reabierta;
}

function anular(db, data, contexto) {
  const nc = buscarNc_(db, data.nc_id);
  if (!nc) return errorValidacion_('nc_id', 'No conformidad no encontrada.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden anular.' };
  if (!String(data.motivo || '').trim()) return errorValidacion_('motivo', 'Anular una no conformidad exige un motivo.');
  registrarLogSgc_(db, 'SGC_NC_ANULADA', nc.correlativo + ': ' + data.motivo, contexto);
  return actualizarFilaPorId_(db, 'SGC_NC', 'nc_id', nc.nc_id, {
    estado: 'ANULADA', fecha_cierre: new Date().toISOString(), cerrada_por: normalizarEmail_(contexto.email),
    eficacia_observaciones: 'ANULADA: ' + data.motivo
  });
}

// --- avisos de NC vencidas (Fase 3a) ---------------------------------------
// Sin trigger propio: pase diario de las 09:00. ESCALADO: vencida ->
// responsable + Encargado SGC; vencida hace 5+ días -> además, Dirección.
// Cadencia diaria mientras siga vencida (a diferencia de las competencias,
// una NC vencida SÍ amerita insistir todos los días).
async function recordatorioVencidas(db) {
  const abiertas = leerSeguro_(db, 'SGC_NC').filter((nc) => esActivo_(nc) && ESTADOS_NC_ABIERTOS.indexOf(nc.estado) !== -1);
  if (!abiertas.length) return { avisos: 0, escaladas: 0 };

  const ahora = new Date();
  const hoy = ahora.toISOString().slice(0, 10);
  const vencidas = [];
  abiertas.forEach((nc) => {
    const venc = vencimientoNc_(nc);
    if (!venc.plazo) return;
    const dias = Math.floor((ahora - new Date(venc.plazo)) / 86400000);
    if (dias >= 0) vencidas.push({ nc, etapa: venc.etapa, diasVencida: dias });
  });
  if (!vencidas.length) return { avisos: 0, escaladas: 0 };

  const encargados = leerSeguro_(db, 'SGC_ROLES').filter((r) => esVerdadero_(r.activo) && r.rol_sgc === 'ENCARGADO_SGC').map((r) => normalizarEmail_(r.usuario_email));
  const direccion = leerSeguro_(db, 'SGC_ROLES').filter((r) => esVerdadero_(r.activo) && r.rol_sgc === 'DIRECCION').map((r) => normalizarEmail_(r.usuario_email));

  const porPersona = {};
  function sumar_(email, item) {
    const e = normalizarEmail_(email);
    if (!e) return;
    if (!porPersona[e]) porPersona[e] = [];
    if (porPersona[e].indexOf(item) === -1) porPersona[e].push(item);
  }
  let escaladas = 0;
  vencidas.forEach((item) => {
    sumar_(item.nc.responsable_email, item);
    encargados.forEach((e) => sumar_(e, item));
    if (item.diasVencida >= DIAS_ESCALADO_NC) {
      escaladas++;
      direccion.forEach((e) => sumar_(e, item));
    }
  });

  let avisos = 0;
  const notifs = [];
  for (const email of Object.keys(porPersona)) {
    const lista = porPersona[email];
    const items = lista.map((x) => '- ' + x.nc.correlativo + ' (' + x.etapa + ', vencida hace ' + x.diasVencida + ' día(s))').join('\n');
    const asunto = 'SIGSO — ' + lista.length + ' no conformidad(es) con plazo vencido';
    const cuerpo = 'Estas no conformidades tienen su plazo vencido:\n' + items + '\n\nEntra a SIGSO > Calidad > No conformidades.';
    const r = await Notificaciones.enviarCorreoModulo(db, { solicitudId: 'SGC_NC_VENCIDA:' + hoy, destinatario: email, evento: 'SGC_NC_VENCIDA', asunto, cuerpo, ventanaMinutos: 24 * 60 });
    if (r && r.enviado) avisos++;
    notifs.push({ destinatario: email, tipo: 'SGC_NC_VENCIDA', titulo: 'No conformidades vencidas', mensaje: lista.length + ' no conformidad(es) con plazo vencido.', modulo_id: 'calidad', texto_accion: 'Ver no conformidades', vidaHoras: 72 });
  }
  NotificacionesApp.encolarLote(db, notifs);

  return { avisos, escaladas };
}

module.exports = {
  listar, getDetalle, crear, registrarCorreccion, registrarCausa, registrarAccion,
  cerrarEtapa, verificarEficacia, anular, recordatorioVencidas,
  // Compartido: RevisionDireccion (Fase 5b) y futuros módulos del SGC crean
  // sus propias tareas ("Mi trabajo") con el mismo wrapper sobre
  // Actividades.crear, nunca reimplementado.
  crearTareaSgc_, tareaResumen_
};
