'use strict';

/**
 * actividades.js — puerto de backend/backoffice/Actividades.gs (+ el trigger
 * de alertas de backend/backoffice/Notificaciones.gs y Triggers.gs).
 *
 * Modulo de Gestion Operacional (v7.0): compromisos de trabajo con check-in
 * ligero. CRUD, maquina de estados (§4.3), bitacora unificada, permisos por
 * JEFATURAS (RN-707/708/709), panel de equipo/gerencia y motores de reporte.
 *
 * Es el MOTOR base sobre el que Proyectos.crearTarea/listarTareas son wrappers
 * finos. El acoplamiento con Proyectos (crear una tarea para un integrante de
 * un proyecto, RN-709) y con el SGC (asignar la correccion/accion de una NC)
 * se resuelve con rolEnProyecto_/gobiernaSgc_: mientras esos modulos no esten
 * portados, esos permisos solo RESTRINGEN (nunca conceden) -- una actividad
 * con proyecto_id/sgc_origen_tipo simplemente no habilita ese tercer/cuarto
 * circulo de confianza todavia. Ver la nota en `crear`.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Utils = require('./utils');
const Cumplimiento = require('./cumplimiento');
const Jefatura = require('./jefatura');
const Gerencia = require('./gerencia');
const Notificaciones = require('./notificaciones');
const NotificacionesApp = require('./notificacionesApp');

// --- constantes de dominio (Solicitudes/Constantes.gs) ----------------------
const ORDEN_PRIORIDAD = ['P1', 'P2', 'P3', 'P4'];
const PRIORIDAD_POR_DEFECTO = 'P3';

const ACTIVIDADES_ESTADOS = {
  NO_INICIADA: 'NO_INICIADA', EN_CURSO: 'EN_CURSO', BLOQUEADA: 'BLOQUEADA',
  EN_REVISION: 'EN_REVISION', TERMINADA: 'TERMINADA', CANCELADA: 'CANCELADA'
};
const ACTIVIDADES_ESTADOS_TERMINALES = [ACTIVIDADES_ESTADOS.TERMINADA, ACTIVIDADES_ESTADOS.CANCELADA];

// §4.6: umbrales de alerta, constantes de codigo (no hoja de config).
const ACTIVIDADES_UMBRAL_SIN_NOVEDAD_CERCA_DIAS = 2;
const ACTIVIDADES_UMBRAL_SIN_NOVEDAD_LEJOS_DIAS = 5;
const ACTIVIDADES_UMBRAL_COMPROMISO_CERCA_DIAS = 5;
const ACTIVIDADES_UMBRAL_SIN_CONFIRMAR_DIAS = 2;
const ACTIVIDADES_UMBRAL_COMPROMISO_PROXIMO_DIAS = 2;
const ACTIVIDADES_UMBRAL_BLOQUEO_ESTANCADO_DIAS = 2;
const VENTANA_DEDUP_SLA_VENCIDO_MINUTOS = 24 * 60;

// --- helpers de datos -------------------------------------------------------
function uuid_() { return crypto.randomUUID(); }
function errorValidacion_(campo, mensaje) { return { _validationError: true, campo, message: mensaje }; }
function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }
function normalizarEmail_(email) { return String(email || '').trim().toLowerCase(); }

function leer_(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
// Tolerante a tabla ausente (equivalente de leerFilasSeguro_ del .gs): en
// instalaciones donde aun no existe la hoja, devuelve vacio en vez de tumbar.
function leerSeguro_(db, hoja) {
  try { return leer_(db, hoja); } catch (err) { return []; }
}

function obtenerFeriados_(db) {
  try { return Cumplimiento.obtenerFeriados(db); } catch (err) { return []; }
}

// Acoplamiento gateado: rolEnProyecto_ vive en Proyectos (aun no portado).
// Mientras no exista, devuelve null -> el circulo de confianza del proyecto
// no habilita nada (solo restringe). Cuando Proyectos.js exista, se resuelve.
function rolEnProyecto_(db, proyectoId, contexto) {
  if (!proyectoId) return null;
  try {
    const Proyectos = require('./proyectos');
    if (Proyectos && typeof Proyectos.rolEnProyecto_ === 'function') {
      return Proyectos.rolEnProyecto_(db, proyectoId, contexto);
    }
  } catch (err) { /* Proyectos aun no portado */ }
  return null;
}
// gobiernaSgc_ vive en calidadSgc.js (SGC, portado desde este incremento) --
// mismo criterio de acoplamiento perezoso que rolEnProyecto_: si el modulo
// no cargara por algun motivo, este cuarto circulo simplemente no habilita
// nada (solo restringe), nunca revienta la creacion de la actividad.
function gobiernaSgc_(db, contexto) {
  try {
    const Calidad = require('./calidadSgc');
    if (Calidad && typeof Calidad.gobiernaSgc_ === 'function') {
      return Calidad.gobiernaSgc_(db, contexto);
    }
  } catch (err) { /* SGC aun no cargado */ }
  return false;
}

// --- lectura + alcance (RN-707) --------------------------------------------
function alcanceActividades_(db, contexto) {
  if (!contexto) return { todas: false, emails: {} };
  if (contexto.rol === 'ADM' || contexto.rol === 'GERENCIA') return { todas: true, emails: {} };
  const emails = {};
  emails[normalizarEmail_(contexto.email)] = true;
  Jefatura.obtenerEquipoJefe_(db, contexto.email).forEach((email) => { emails[normalizarEmail_(email)] = true; });
  return { todas: false, emails: emails };
}

function colaboradoresDeActividad_(actividad) {
  if (!actividad || !actividad.colaboradores_emails) return [];
  let lista = actividad.colaboradores_emails;
  if (typeof lista === 'string') {
    try { lista = JSON.parse(lista); } catch (e) { return []; }
  }
  if (!Array.isArray(lista)) return [];
  return lista.map(normalizarEmail_).filter((e) => !!e);
}

function trabajaLaActividad_(actividad, email) {
  const e = normalizarEmail_(email);
  if (normalizarEmail_(actividad.responsable_email) === e) return true;
  return colaboradoresDeActividad_(actividad).indexOf(e) !== -1;
}

function normalizarColaboradores_(entrada, responsableEmail) {
  let lista = entrada;
  if (typeof lista === 'string') {
    try { lista = JSON.parse(lista); } catch (e) { lista = []; }
  }
  if (!Array.isArray(lista)) return [];
  const dueno = normalizarEmail_(responsableEmail);
  const vistos = {};
  const salida = [];
  lista.map(normalizarEmail_).forEach((e) => {
    if (!e || e === dueno || vistos[e]) return;
    vistos[e] = true;
    salida.push(e);
  });
  return salida;
}

function esEstadoTerminal_(estado) { return ACTIVIDADES_ESTADOS_TERMINALES.indexOf(estado) !== -1; }

function puedeVerActividad_(db, actividad, contexto) {
  const alcance = alcanceActividades_(db, contexto);
  if (alcance.todas || alcance.emails[normalizarEmail_(actividad.responsable_email)]) return true;
  return trabajaLaActividad_(actividad, contexto && contexto.email);
}
function puedeSupervisar_(actividad, contexto) {
  if (contexto.rol === 'ADM') return true;
  return normalizarEmail_(actividad.supervisor_email) === normalizarEmail_(contexto.email);
}
function puedeGestionar_(actividad, contexto) {
  if (contexto.rol === 'ADM') return true;
  const email = normalizarEmail_(contexto.email);
  return normalizarEmail_(actividad.responsable_email) === email ||
    normalizarEmail_(actividad.supervisor_email) === email;
}
function puedeGestionarEquipo_(db, actividad, nuevoResponsableEmail, contexto) {
  if (contexto.rol === 'ADM') return true;
  const equipo = Jefatura.obtenerEquipoJefe_(db, contexto.email).map(normalizarEmail_);
  const esDeSuEquipo = (email) => equipo.indexOf(normalizarEmail_(email)) !== -1;
  return esDeSuEquipo(actividad.responsable_email) && esDeSuEquipo(nuevoResponsableEmail);
}

function buscarActividad_(db, actividadId) {
  if (!actividadId) return null;
  const filas = leerSeguro_(db, 'ACTIVIDADES');
  for (let i = 0; i < filas.length; i++) {
    if (filas[i].actividad_id === actividadId) return filas[i];
  }
  return null;
}
function reescribirActividad_(db, actividadId, cambios) {
  return actualizarFilaPorId_(db, 'ACTIVIDADES', 'actividad_id', actividadId, cambios);
}
function registrarEventoActividad_(db, actividadId, tipo, contexto, nota, datos) {
  agregarFila_(db, 'ACTIVIDADES_BITACORA', {
    bitacora_id: uuid_(),
    actividad_id: actividadId,
    tipo: tipo,
    autor_email: (contexto && contexto.email) || '',
    autor_nombre: (contexto && contexto.nombre) || '',
    nota: nota || '',
    avance_pct: (datos && datos.avance_pct !== undefined) ? datos.avance_pct : '',
    confianza: (datos && datos.confianza) || '',
    datos: datos ? JSON.stringify(datos) : '',
    timestamp: new Date().toISOString()
  });
}

// v7.0 Fase 3: clasificacion de urgencia (calendario UTC, no dias habiles).
function semaforoActividad_(a) {
  if (a.estado === 'TERMINADA') return { codigo: 'terminada', etiqueta: 'Terminada' };
  if (a.estado === 'CANCELADA') return { codigo: 'cancelada', etiqueta: 'Cancelada' };
  if (a.estado === 'BLOQUEADA') return { codigo: 'bloqueada', etiqueta: 'Bloqueada' };
  if (a.estado === 'EN_REVISION') return { codigo: 'revision', etiqueta: 'En revisión' };
  if (a.fecha_propuesta && !a.confirmada_en) return { codigo: 'pendiente', etiqueta: 'Por confirmar' };
  if (!a.fecha_compromiso) return { codigo: 'al-dia', etiqueta: 'Al día' };
  const hoyUTC = Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const f = new Date(a.fecha_compromiso);
  const venceUTC = Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate());
  const dias = Math.round((venceUTC - hoyUTC) / 86400000);
  if (dias < 0) return { codigo: 'atrasada', etiqueta: 'Atrasada' };
  if (dias <= 1) return { codigo: 'riesgo', etiqueta: dias === 0 ? 'Vence hoy' : 'Vence mañana' };
  return { codigo: 'al-dia', etiqueta: 'Al día' };
}

function correrFechaRecurrencia_(fechaBase, recurrencia) {
  if (!fechaBase) return null;
  const f = new Date(fechaBase);
  if (isNaN(f.getTime())) return null;
  if (recurrencia === 'SEMANAL') f.setUTCDate(f.getUTCDate() + 7);
  else if (recurrencia === 'MENSUAL') f.setUTCMonth(f.getUTCMonth() + 1);
  else return null;
  return f.toISOString();
}

// RN-713: al cerrar una recurrente, nace la siguiente instancia.
function crearSiguienteRecurrencia_(db, actividadCerrada) {
  try {
    const siguienteFecha = correrFechaRecurrencia_(actividadCerrada.fecha_compromiso, actividadCerrada.recurrencia);
    if (!siguienteFecha) return null;
    const ahora = new Date();
    const siguiente = {
      actividad_id: uuid_(),
      titulo: actividadCerrada.titulo,
      descripcion: actividadCerrada.descripcion || '',
      origen: actividadCerrada.origen,
      solicitud_id: actividadCerrada.solicitud_id || '',
      responsable_email: actividadCerrada.responsable_email,
      responsable_nombre: actividadCerrada.responsable_nombre || '',
      supervisor_email: actividadCerrada.supervisor_email,
      area_id: actividadCerrada.area_id || '',
      cliente_id: actividadCerrada.cliente_id || '',
      proyecto: actividadCerrada.proyecto || '',
      prioridad: actividadCerrada.prioridad,
      estado: ACTIVIDADES_ESTADOS.NO_INICIADA,
      tamano: actividadCerrada.tamano,
      fecha_propuesta: '',
      fecha_compromiso: siguienteFecha,
      confirmada_en: ahora.toISOString(),
      requiere_validacion: actividadCerrada.requiere_validacion === true,
      recurrencia: actividadCerrada.recurrencia,
      recurrencia_origen_id: actividadCerrada.actividad_id,
      fecha_inicio_plan: '',
      fecha_terminada: '',
      confianza: 'VERDE',
      avance_pct: '',
      bloqueo_motivo: '',
      bloqueo_responsable_email: '',
      bloqueo_desde: '',
      ultima_actualizacion: ahora.toISOString(),
      reprogramaciones: 0,
      fecha_creacion: ahora.toISOString(),
      creado_por: actividadCerrada.creado_por || '',
      activa: true
    };
    agregarFila_(db, 'ACTIVIDADES', siguiente);
    registrarEventoActividad_(db, siguiente.actividad_id, 'CREADA', { email: 'sistema', nombre: 'Recurrencia automatica' },
      'Generada automaticamente al cerrar ' + actividadCerrada.actividad_id + ' (RN-713).');
    return siguiente;
  } catch (err) {
    console.error('Actividades.crearSiguienteRecurrencia_', err);
    return null;
  }
}

// ===========================================================================
// API publica
// ===========================================================================
function listar(db, filtros, contexto) {
  const alcance = alcanceActividades_(db, contexto);
  // alcanceActividades_ solo mira responsable_email -- un colaborador podia
  // hacer check-in y ver el detalle de una actividad (trabajaLaActividad_
  // lo reconoce en obtenerDetalle/checkin) pero nunca la veia en "Mi
  // trabajo", salvo que alguien le pasara el enlace directo.
  const miEmail = normalizarEmail_(contexto && contexto.email);
  let filas = leerSeguro_(db, 'ACTIVIDADES').filter((a) =>
    esVerdadero_(a.activa) && (alcance.todas || alcance.emails[normalizarEmail_(a.responsable_email)] || colaboradoresDeActividad_(a).indexOf(miEmail) !== -1));
  if (filtros && filtros.estado) filas = filas.filter((a) => a.estado === filtros.estado);
  if (filtros && filtros.responsable_email) {
    const email = normalizarEmail_(filtros.responsable_email);
    filas = filas.filter((a) => normalizarEmail_(a.responsable_email) === email);
  }
  return filas.map((a) => {
    const s = semaforoActividad_(a);
    a.semaforo = s.codigo;
    a.semaforo_etiqueta = s.etiqueta;
    return a;
  });
}

function panelEquipo(db, filtros, contexto) {
  const items = listar(db, filtros, contexto).filter((a) =>
    normalizarEmail_(a.responsable_email) !== normalizarEmail_(contexto && contexto.email));
  const porPersona = {};
  items.forEach((a) => {
    const email = normalizarEmail_(a.responsable_email);
    if (!porPersona[email]) {
      porPersona[email] = { email: email, nombre: a.responsable_nombre || email, total: 0, en_riesgo: 0, bloqueadas: 0 };
    }
    porPersona[email].total++;
    if (a.semaforo === 'atrasada' || a.semaforo === 'riesgo') porPersona[email].en_riesgo++;
    if (a.semaforo === 'bloqueada') porPersona[email].bloqueadas++;
  });
  return {
    items: items,
    por_persona: Object.keys(porPersona).map((k) => porPersona[k]).sort((a, b) => b.total - a.total)
  };
}

function obtenerDetalle(db, data, contexto) {
  const actividad = buscarActividad_(db, data.actividad_id);
  if (!actividad) return errorValidacion_('actividad_id', 'Actividad no encontrada.');
  if (!puedeVerActividad_(db, actividad, contexto)) {
    return { _forbidden: true, message: 'No tienes acceso a esta actividad.' };
  }
  return {
    actividad: actividad,
    bitacora: leerSeguro_(db, 'ACTIVIDADES_BITACORA')
      .filter((b) => b.actividad_id === actividad.actividad_id)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  };
}

function crear(db, data, contexto) {
  const titulo = String(data.titulo || '').trim();
  if (!titulo) return errorValidacion_('titulo', 'El titulo es obligatorio.');
  const origen = ['ASIGNADA', 'PROPIA', 'EMERGENTE', 'SOLICITUD'].indexOf(data.origen) !== -1 ? data.origen : 'PROPIA';
  const responsableEmail = normalizarEmail_(data.responsable_email || contexto.email);
  if (!responsableEmail) return errorValidacion_('responsable_email', 'Falta el responsable.');
  const esParaSiMismo = responsableEmail === normalizarEmail_(contexto.email);

  // RN-709: quien puede crear para quien (equipo JEFATURAS + circulo del
  // proyecto + gobierno del SGC). Ver la nota de acoplamiento arriba.
  if (!esParaSiMismo && contexto.rol !== 'ADM') {
    const equipo = Jefatura.obtenerEquipoJefe_(db, contexto.email).map(normalizarEmail_);
    const esDelEquipoJefatura = equipo.indexOf(responsableEmail) !== -1;
    const esDelEquipoProyecto = !!data.proyecto_id &&
      !!rolEnProyecto_(db, data.proyecto_id, contexto) &&
      !!rolEnProyecto_(db, data.proyecto_id, { email: responsableEmail });
    const esTareaDelSgc = !!data.sgc_origen_tipo && gobiernaSgc_(db, contexto);
    if (!esDelEquipoJefatura && !esDelEquipoProyecto && !esTareaDelSgc) {
      return { _forbidden: true, message: 'Solo puedes crear actividades para tu equipo.' };
    }
  }

  const fecha = data.fecha_compromiso || data.fecha_propuesta;
  if (!fecha) return errorValidacion_('fecha_compromiso', 'La fecha de compromiso es obligatoria.');

  // Quien crea la actividad no puede simplemente NOMBRAR a un tercero
  // arbitrario como supervisor (eso le da poder permanente de validar/
  // cancelar/reprogramar/pedir actualizacion sobre la actividad de otra
  // persona, sin ninguna relacion real): solo se acepta data.supervisor_email
  // si corresponde a una fuente legitima -- el jefe real segun JEFATURAS,
  // el LIDER del proyecto (si la tarea es de un proyecto), o la propia
  // persona que crea la actividad. Cualquier otro valor se ignora y cae al
  // mismo default de siempre (el jefe real, o quien la crea).
  const jefeReal = normalizarEmail_(Jefatura.jefeDeSubordinado_(db, responsableEmail));
  const supervisorPropuesto = normalizarEmail_(data.supervisor_email);
  let supervisorEmail = '';
  if (supervisorPropuesto) {
    const esJefeReal = supervisorPropuesto === jefeReal;
    const esQuienCrea = supervisorPropuesto === normalizarEmail_(contexto.email);
    const esLiderDelProyecto = !!data.proyecto_id && rolEnProyecto_(db, data.proyecto_id, { email: supervisorPropuesto }) === 'LIDER';
    if (esJefeReal || esQuienCrea || esLiderDelProyecto) supervisorEmail = supervisorPropuesto;
  }
  if (!supervisorEmail) supervisorEmail = jefeReal;
  if (!supervisorEmail) supervisorEmail = normalizarEmail_(contexto.email);

  const ahora = new Date();
  const confirmadaDeInmediato = esParaSiMismo;

  const actividad = {
    actividad_id: uuid_(),
    titulo: titulo,
    descripcion: data.descripcion || '',
    origen: origen,
    solicitud_id: data.solicitud_id || '',
    responsable_email: responsableEmail,
    responsable_nombre: data.responsable_nombre || '',
    supervisor_email: supervisorEmail,
    area_id: data.area_id || '',
    cliente_id: data.cliente_id || '',
    proyecto: data.proyecto || '',
    prioridad: ORDEN_PRIORIDAD.indexOf(data.prioridad) !== -1 ? data.prioridad : PRIORIDAD_POR_DEFECTO,
    estado: ACTIVIDADES_ESTADOS.NO_INICIADA,
    tamano: ['S', 'M', 'L', 'XL'].indexOf(data.tamano) !== -1 ? data.tamano : 'M',
    fecha_propuesta: confirmadaDeInmediato ? '' : fecha,
    fecha_compromiso: confirmadaDeInmediato ? fecha : '',
    confirmada_en: confirmadaDeInmediato ? ahora.toISOString() : '',
    requiere_validacion: data.requiere_validacion === true,
    recurrencia: ['NINGUNA', 'SEMANAL', 'MENSUAL'].indexOf(data.recurrencia) !== -1 ? data.recurrencia : 'NINGUNA',
    recurrencia_origen_id: data.recurrencia_origen_id || '',
    fecha_inicio_plan: data.fecha_inicio_plan || '',
    fecha_terminada: '',
    confianza: 'VERDE',
    avance_pct: '',
    bloqueo_motivo: '',
    bloqueo_responsable_email: '',
    bloqueo_desde: '',
    ultima_actualizacion: ahora.toISOString(),
    reprogramaciones: 0,
    fecha_creacion: ahora.toISOString(),
    creado_por: contexto.email || '',
    activa: true,
    proyecto_id: data.proyecto_id || '',
    hito_id: data.hito_id || '',
    depende_de: data.depende_de || '',
    tarea_padre_id: data.tarea_padre_id || '',
    sgc_origen_tipo: data.sgc_origen_tipo || '',
    sgc_origen_id: data.sgc_origen_id || '',
    meta_cantidad: (data.meta_cantidad !== undefined && data.meta_cantidad !== '' && !isNaN(Number(data.meta_cantidad)))
      ? Number(data.meta_cantidad) : '',
    meta_unidad: String(data.meta_unidad || '').trim(),
    colaboradores_emails: JSON.stringify(normalizarColaboradores_(data.colaboradores_emails, responsableEmail))
  };
  agregarFila_(db, 'ACTIVIDADES', actividad);
  registrarEventoActividad_(db, actividad.actividad_id, 'CREADA', contexto, '');
  return actividad;
}

function confirmar(db, data, contexto) {
  const actividad = buscarActividad_(db, data.actividad_id);
  if (!actividad) return errorValidacion_('actividad_id', 'Actividad no encontrada.');
  if (normalizarEmail_(actividad.responsable_email) !== normalizarEmail_(contexto.email)) {
    return { _forbidden: true, message: 'Solo el responsable puede confirmar su compromiso.' };
  }
  if (actividad.confirmada_en) return errorValidacion_('actividad_id', 'Esta actividad ya fue confirmada.');
  const fechaFinal = data.fecha_compromiso || actividad.fecha_propuesta;
  if (!fechaFinal) return errorValidacion_('fecha_compromiso', 'Falta la fecha de compromiso.');
  const esContrapropuesta = data.fecha_compromiso && data.fecha_compromiso !== actividad.fecha_propuesta;
  const ahora = new Date();
  const actualizado = reescribirActividad_(db, actividad.actividad_id, {
    fecha_compromiso: fechaFinal, fecha_propuesta: '', confirmada_en: ahora.toISOString(), ultima_actualizacion: ahora.toISOString()
  });
  registrarEventoActividad_(db, actividad.actividad_id, 'CREADA', contexto,
    esContrapropuesta ? ('Confirmo con contrapropuesta: ' + (data.motivo || '')) : 'Confirmo la fecha propuesta.');
  return actualizado;
}

function checkin(db, data, contexto) {
  const actividad = buscarActividad_(db, data.actividad_id);
  if (!actividad) return errorValidacion_('actividad_id', 'Actividad no encontrada.');
  if (!trabajaLaActividad_(actividad, contexto.email)) {
    return { _forbidden: true, message: 'Solo el responsable o un colaborador pueden actualizar esta actividad.' };
  }
  if (esEstadoTerminal_(actividad.estado)) return errorValidacion_('actividad_id', 'Esta actividad ya esta cerrada.');

  const tipo = data.tipo;
  const ahora = new Date();
  const cambios = { ultima_actualizacion: ahora.toISOString() };
  let eventoBitacora, notaBitacora = data.nota || '';

  let horasHoy;
  if (data.horas !== undefined && data.horas !== null && data.horas !== '') {
    horasHoy = Number(data.horas);
    if (isNaN(horasHoy) || horasHoy < 0 || horasHoy > 24) {
      return errorValidacion_('horas', 'Las horas deben ser un numero entre 0 y 24.');
    }
  }

  switch (tipo) {
    case 'avance':
      cambios.estado = ACTIVIDADES_ESTADOS.EN_CURSO;
      if (data.confianza) cambios.confianza = data.confianza;
      if (data.avance_pct !== undefined && data.avance_pct !== '') cambios.avance_pct = data.avance_pct;
      eventoBitacora = 'CHECKIN_AVANCE';
      break;
    case 'sin_cambio':
      if (actividad.estado === ACTIVIDADES_ESTADOS.NO_INICIADA) cambios.estado = ACTIVIDADES_ESTADOS.EN_CURSO;
      eventoBitacora = 'CHECKIN_SIN_CAMBIO';
      break;
    case 'bloqueo': {
      const motivo = String(data.bloqueo_motivo || '').trim();
      if (!motivo) return errorValidacion_('bloqueo_motivo', 'Indica el motivo del bloqueo.');
      cambios.estado = ACTIVIDADES_ESTADOS.BLOQUEADA;
      cambios.bloqueo_motivo = motivo;
      cambios.bloqueo_responsable_email = normalizarEmail_(data.bloqueo_responsable_email) || '';
      cambios.bloqueo_desde = ahora.toISOString();
      eventoBitacora = 'BLOQUEO';
      notaBitacora = motivo;
      break;
    }
    case 'desbloqueo':
      if (actividad.estado !== ACTIVIDADES_ESTADOS.BLOQUEADA) return errorValidacion_('actividad_id', 'La actividad no esta bloqueada.');
      cambios.estado = ACTIVIDADES_ESTADOS.EN_CURSO;
      cambios.bloqueo_motivo = '';
      cambios.bloqueo_responsable_email = '';
      cambios.bloqueo_desde = '';
      eventoBitacora = 'DESBLOQUEO';
      break;
    case 'listo':
      cambios.estado = actividad.requiere_validacion ? ACTIVIDADES_ESTADOS.EN_REVISION : ACTIVIDADES_ESTADOS.TERMINADA;
      if (cambios.estado === ACTIVIDADES_ESTADOS.TERMINADA) cambios.fecha_terminada = ahora.toISOString();
      eventoBitacora = 'ENTREGA';
      break;
    default:
      return errorValidacion_('tipo', 'Tipo de check-in invalido: ' + tipo);
  }

  const actualizado = reescribirActividad_(db, actividad.actividad_id, cambios);
  registrarEventoActividad_(db, actividad.actividad_id, eventoBitacora, contexto, notaBitacora,
    { avance_pct: cambios.avance_pct, confianza: cambios.confianza, horas: horasHoy });

  if (cambios.estado === ACTIVIDADES_ESTADOS.TERMINADA && actividad.recurrencia && actividad.recurrencia !== 'NINGUNA') {
    crearSiguienteRecurrencia_(db, actualizado);
  }
  return actualizado;
}

function validar(db, data, contexto) {
  const actividad = buscarActividad_(db, data.actividad_id);
  if (!actividad) return errorValidacion_('actividad_id', 'Actividad no encontrada.');
  if (actividad.estado !== ACTIVIDADES_ESTADOS.EN_REVISION) return errorValidacion_('actividad_id', 'Esta actividad no esta en revision.');
  if (!puedeSupervisar_(actividad, contexto)) return { _forbidden: true, message: 'Solo el supervisor de esta actividad puede validarla.' };
  const ahora = new Date();
  if (data.aprobar === false) {
    const actualizado = reescribirActividad_(db, actividad.actividad_id, {
      estado: ACTIVIDADES_ESTADOS.EN_CURSO, ultima_actualizacion: ahora.toISOString()
    });
    registrarEventoActividad_(db, actividad.actividad_id, 'VALIDACION', contexto, 'Devuelta: ' + (data.motivo || ''));
    return actualizado;
  }
  const cerrada = reescribirActividad_(db, actividad.actividad_id, {
    estado: ACTIVIDADES_ESTADOS.TERMINADA, fecha_terminada: ahora.toISOString(), ultima_actualizacion: ahora.toISOString()
  });
  registrarEventoActividad_(db, actividad.actividad_id, 'VALIDACION', contexto, 'Aprobada.');
  if (actividad.recurrencia && actividad.recurrencia !== 'NINGUNA') crearSiguienteRecurrencia_(db, cerrada);
  return cerrada;
}

function cancelar(db, data, contexto) {
  const actividad = buscarActividad_(db, data.actividad_id);
  if (!actividad) return errorValidacion_('actividad_id', 'Actividad no encontrada.');
  if (esEstadoTerminal_(actividad.estado)) return errorValidacion_('actividad_id', 'Esta actividad ya esta cerrada.');
  const motivo = String(data.motivo || '').trim();
  if (!motivo) return errorValidacion_('motivo', 'Indica el motivo de la cancelacion.');
  if (!puedeGestionar_(actividad, contexto)) return { _forbidden: true, message: 'No puedes cancelar esta actividad.' };
  const actualizado = reescribirActividad_(db, actividad.actividad_id, {
    estado: ACTIVIDADES_ESTADOS.CANCELADA, ultima_actualizacion: new Date().toISOString()
  });
  registrarEventoActividad_(db, actividad.actividad_id, 'CAMBIO_ESTADO', contexto, 'Cancelada: ' + motivo);
  return actualizado;
}

function reprogramar(db, data, contexto) {
  const actividad = buscarActividad_(db, data.actividad_id);
  if (!actividad) return errorValidacion_('actividad_id', 'Actividad no encontrada.');
  if (esEstadoTerminal_(actividad.estado)) return errorValidacion_('actividad_id', 'Esta actividad ya esta cerrada.');
  const fechaNueva = data.fecha_compromiso;
  if (!fechaNueva) return errorValidacion_('fecha_compromiso', 'Falta la nueva fecha.');
  const motivo = String(data.motivo || '').trim();
  if (!motivo) return errorValidacion_('motivo', 'Toda reprogramacion exige un motivo.');
  if (!puedeGestionar_(actividad, contexto)) return { _forbidden: true, message: 'No puedes reprogramar esta actividad.' };
  const fechaAnterior = actividad.fecha_compromiso;
  const actualizado = reescribirActividad_(db, actividad.actividad_id, {
    fecha_compromiso: fechaNueva,
    reprogramaciones: (Number(actividad.reprogramaciones) || 0) + 1,
    ultima_actualizacion: new Date().toISOString()
  });
  registrarEventoActividad_(db, actividad.actividad_id, 'REPROGRAMACION', contexto, motivo,
    { fecha_anterior: fechaAnterior, fecha_nueva: fechaNueva });
  return actualizado;
}

function reasignar(db, data, contexto) {
  const actividad = buscarActividad_(db, data.actividad_id);
  if (!actividad) return errorValidacion_('actividad_id', 'Actividad no encontrada.');
  if (esEstadoTerminal_(actividad.estado) || actividad.estado === ACTIVIDADES_ESTADOS.EN_REVISION) {
    return errorValidacion_('actividad_id', 'Esta actividad ya esta cerrada o en revision.');
  }
  const nuevoResponsable = normalizarEmail_(data.responsable_nuevo);
  if (!nuevoResponsable) return errorValidacion_('responsable_nuevo', 'Indica a quien se reasigna.');
  if (nuevoResponsable === normalizarEmail_(actividad.responsable_email)) {
    return errorValidacion_('responsable_nuevo', 'Esa persona ya es la responsable.');
  }
  const motivo = String(data.motivo || '').trim();
  if (!motivo) return errorValidacion_('motivo', 'Indica el motivo de la reasignacion.');
  if (!puedeGestionarEquipo_(db, actividad, nuevoResponsable, contexto)) {
    return { _forbidden: true, message: 'No puedes reasignar esta actividad a esa persona.' };
  }
  const responsableAnterior = actividad.responsable_email;
  const ahora = new Date();
  const actualizado = reescribirActividad_(db, actividad.actividad_id, {
    responsable_email: nuevoResponsable,
    responsable_nombre: data.responsable_nuevo_nombre || '',
    supervisor_email: normalizarEmail_(Jefatura.jefeDeSubordinado_(db, nuevoResponsable)) || actividad.supervisor_email,
    estado: ACTIVIDADES_ESTADOS.NO_INICIADA,
    fecha_propuesta: actividad.fecha_compromiso || actividad.fecha_propuesta,
    fecha_compromiso: '',
    confirmada_en: '',
    ultima_actualizacion: ahora.toISOString()
  });
  registrarEventoActividad_(db, actividad.actividad_id, 'REASIGNACION', contexto, motivo,
    { responsable_anterior: responsableAnterior, responsable_nuevo: nuevoResponsable });
  return actualizado;
}

async function pedirActualizacion(db, data, contexto) {
  const actividad = buscarActividad_(db, data.actividad_id);
  if (!actividad) return errorValidacion_('actividad_id', 'Actividad no encontrada.');
  if (esEstadoTerminal_(actividad.estado)) return errorValidacion_('actividad_id', 'Esta actividad ya esta cerrada.');
  if (!puedeGestionar_(actividad, contexto)) {
    return { _forbidden: true, message: 'No puedes pedir una actualizacion de esta actividad.' };
  }
  const nota = String(data.nota || '').trim();
  registrarEventoActividad_(db, actividad.actividad_id, 'COMENTARIO', contexto,
    'Pidio una actualizacion.' + (nota ? ' ' + nota : ''));
  let envio = { enviado: false, motivo: 'sin_responsable' };
  if (actividad.responsable_email) {
    envio = await Notificaciones.enviarCorreoModulo(db, {
      solicitudId: actividad.actividad_id,
      destinatario: actividad.responsable_email,
      evento: 'PEDIR_ACTUALIZACION_ACTIVIDAD',
      asunto: 'Te piden una actualización: ' + actividad.titulo,
      cuerpo: ((contexto && contexto.nombre) || contexto.email) + ' pidió una actualización de tu actividad "' +
        actividad.titulo + '".' + (nota ? '\n\n' + nota : '') +
        '\n\nEntra a "Mi trabajo" para responder -- "Sin cambios" también cuenta.',
      ventanaMinutos: 1
    });
    NotificacionesApp.encolarLote(db, [{
      destinatario: actividad.responsable_email, tipo: 'PEDIR_ACTUALIZACION_ACTIVIDAD',
      titulo: 'Te piden una actualización',
      mensaje: 'Te piden una actualización de "' + actividad.titulo + '".' + (nota ? ' ' + nota : ''),
      modulo_id: 'mi_trabajo', texto_accion: 'Responder en Mi trabajo', vidaHoras: 48
    }]);
  }
  return { actividad_id: actividad.actividad_id, enviado: envio.enviado };
}

function getPanelGerencia(db, filtros, contexto) {
  return calcularPanelGerenciaActividades_(db, filtros || {});
}

function generarReporte(db, data, contexto) {
  const tipo = data && data.tipo;
  if (['estado_actual', 'cumplimiento_periodo', 'carga_capacidad'].indexOf(tipo) === -1) {
    return errorValidacion_('tipo', 'Tipo de reporte inválido.');
  }
  return construirReporteActividades_(db, tipo, data || {});
}

function generarActaReunion(db, filtros, contexto) {
  return construirActaReunion_(db, filtros || {});
}

// --- alertas (§4.6): calculo puro ------------------------------------------
function diasHabilesEntreFechas_(desde, hasta, feriados) {
  if (!desde) return 0;
  return Utils.horasHabilesEntre(desde, hasta, { feriados: feriados }) / 9;
}

function calcularAlertas(db) {
  const feriados = obtenerFeriados_(db);
  const ahora = new Date();
  const porPersona = {};
  function bucket(email) {
    const normalizado = normalizarEmail_(email);
    if (!normalizado) return null;
    if (!porPersona[normalizado]) {
      porPersona[normalizado] = { sin_novedad: [], sin_confirmar: [], compromiso_proximo: [], vencidas: [], bloqueo_estancado: [] };
    }
    return porPersona[normalizado];
  }

  leerSeguro_(db, 'ACTIVIDADES').forEach((a) => {
    if (!esVerdadero_(a.activa) || esEstadoTerminal_(a.estado)) return;
    const pendienteConfirmar = a.fecha_propuesta && !a.confirmada_en;

    if (pendienteConfirmar) {
      const diasAsignada = diasHabilesEntreFechas_(a.fecha_creacion, ahora, feriados);
      if (diasAsignada >= ACTIVIDADES_UMBRAL_SIN_CONFIRMAR_DIAS) {
        const b = bucket(a.supervisor_email);
        if (b) b.sin_confirmar.push(a);
      }
    } else if (a.estado !== ACTIVIDADES_ESTADOS.EN_REVISION) {
      const diasSinActualizar = diasHabilesEntreFechas_(a.ultima_actualizacion || a.fecha_creacion, ahora, feriados);
      const compromisoCerca = a.fecha_compromiso &&
        diasHabilesEntreFechas_(ahora, a.fecha_compromiso, feriados) <= ACTIVIDADES_UMBRAL_COMPROMISO_CERCA_DIAS;
      const umbral = (a.estado === ACTIVIDADES_ESTADOS.BLOQUEADA || compromisoCerca)
        ? ACTIVIDADES_UMBRAL_SIN_NOVEDAD_CERCA_DIAS : ACTIVIDADES_UMBRAL_SIN_NOVEDAD_LEJOS_DIAS;
      if (diasSinActualizar >= umbral * 2) {
        const bc = bucket(a.responsable_email); if (bc) bc.sin_novedad.push(a);
        const bs = bucket(a.supervisor_email); if (bs) bs.sin_novedad.push(a);
      } else if (diasSinActualizar >= umbral) {
        const bc = bucket(a.responsable_email); if (bc) bc.sin_novedad.push(a);
      }
    }

    if (a.fecha_compromiso && a.estado !== ACTIVIDADES_ESTADOS.TERMINADA) {
      const vencida = new Date(a.fecha_compromiso).getTime() < ahora.getTime();
      if (vencida) {
        const b = bucket(a.supervisor_email); if (b) b.vencidas.push(a);
      } else {
        const diasHastaVencer = diasHabilesEntreFechas_(ahora, a.fecha_compromiso, feriados);
        if (diasHastaVencer <= ACTIVIDADES_UMBRAL_COMPROMISO_PROXIMO_DIAS && a.confianza !== 'VERDE') {
          const b = bucket(a.supervisor_email); if (b) b.compromiso_proximo.push(a);
        }
      }
    }

    if (a.estado === ACTIVIDADES_ESTADOS.BLOQUEADA && a.bloqueo_desde) {
      const diasBloqueada = diasHabilesEntreFechas_(a.bloqueo_desde, ahora, feriados);
      if (diasBloqueada >= ACTIVIDADES_UMBRAL_BLOQUEO_ESTANCADO_DIAS) {
        const bs = bucket(a.supervisor_email); if (bs) bs.bloqueo_estancado.push(a);
        if (normalizarEmail_(a.bloqueo_responsable_email) &&
          normalizarEmail_(a.bloqueo_responsable_email) !== normalizarEmail_(a.supervisor_email)) {
          const bd = bucket(a.bloqueo_responsable_email); if (bd) bd.bloqueo_estancado.push(a);
        }
      }
    }
  });
  return porPersona;
}

// --- Fase 5: panel de Gerencia y motores de reporte ------------------------
function areasPorId_(db) {
  const mapa = {};
  leerSeguro_(db, 'CAT_AREAS').forEach((a) => { mapa[a.area_id] = a.nombre; });
  return mapa;
}
function actividadesActivasNoCanceladas_(db) {
  return leerSeguro_(db, 'ACTIVIDADES').filter((a) => esVerdadero_(a.activa) && a.estado !== ACTIVIDADES_ESTADOS.CANCELADA);
}
function coincideFiltroGerenciaActividad_(a, filtros) {
  if (filtros.area_id && a.area_id !== filtros.area_id) return false;
  if (filtros.prioridad && a.prioridad !== filtros.prioridad) return false;
  return true;
}
function inicioSemanaUTC_(fecha) {
  const diaSemana = fecha.getUTCDay();
  const offsetLunes = (diaSemana + 6) % 7;
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate() - offsetLunes));
}
function etiquetaSemana_(inicioLunes) {
  return ('0' + inicioLunes.getUTCDate()).slice(-2) + '/' + ('0' + (inicioLunes.getUTCMonth() + 1)).slice(-2);
}

function calcularKpisPeriodoActividades_(creadas) {
  const terminadas = creadas.filter((a) => a.estado === ACTIVIDADES_ESTADOS.TERMINADA && a.fecha_terminada && a.fecha_compromiso);
  const aTiempo = terminadas.filter((a) => new Date(a.fecha_terminada) <= new Date(a.fecha_compromiso));
  const emergentes = creadas.filter((a) => a.origen === 'EMERGENTE');
  return {
    pct_cumplidas_a_tiempo: terminadas.length === 0 ? null : Math.round((aTiempo.length / terminadas.length) * 1000) / 10,
    reprogramaciones_promedio: Gerencia.promedio_(creadas.map((a) => Number(a.reprogramaciones) || 0)),
    pct_emergente: creadas.length === 0 ? null : Math.round((emergentes.length / creadas.length) * 1000) / 10
  };
}

function calcularKpisGerenciaActividades_(db, todas, creadasVentana, creadasVentanaAnterior, ahora) {
  const feriados = obtenerFeriados_(db);
  const activasNoTerminales = todas.filter((a) => !esEstadoTerminal_(a.estado));
  const bloqueadas = todas.filter((a) => a.estado === ACTIVIDADES_ESTADOS.BLOQUEADA);
  const porPersona = {};
  todas.forEach((a) => {
    const email = a.responsable_email || '(sin responsable)';
    porPersona[email] = (porPersona[email] || 0) + 1;
  });
  const actual = calcularKpisPeriodoActividades_(creadasVentana);
  const anterior = calcularKpisPeriodoActividades_(creadasVentanaAnterior);
  function delta_(a, b) {
    if (a === null || a === undefined || b === null || b === undefined) return null;
    return Math.round((a - b) * 10) / 10;
  }
  return {
    pct_cumplidas_a_tiempo: actual.pct_cumplidas_a_tiempo,
    antiguedad_media_dias: Gerencia.promedio_(activasNoTerminales.map((a) =>
      Utils.horasHabilesEntre(a.ultima_actualizacion || a.fecha_creacion, ahora, { feriados: feriados }) / 9)),
    bloqueadas_actual: bloqueadas.length,
    bloqueo_promedio_dias: Gerencia.promedio_(bloqueadas.map((a) =>
      Utils.horasHabilesEntre(a.bloqueo_desde || a.ultima_actualizacion, ahora, { feriados: feriados }) / 9)),
    reprogramaciones_promedio: actual.reprogramaciones_promedio,
    pct_emergente: actual.pct_emergente,
    carga_por_persona: Object.keys(porPersona)
      .map((email) => ({ email: email, total: porPersona[email] }))
      .sort((x, y) => y.total - x.total),
    comparativo: {
      pct_cumplidas_a_tiempo: delta_(actual.pct_cumplidas_a_tiempo, anterior.pct_cumplidas_a_tiempo),
      reprogramaciones_promedio: delta_(actual.reprogramaciones_promedio, anterior.reprogramaciones_promedio),
      pct_emergente: delta_(actual.pct_emergente, anterior.pct_emergente)
    }
  };
}

function calcularHeatmapActividades_(todas, nombresArea) {
  const SEMANAS_HEATMAP = 6;
  const ahora = new Date();
  const lunesActual = inicioSemanaUTC_(ahora);
  const semanas = [];
  for (let i = SEMANAS_HEATMAP - 1; i >= 0; i--) {
    const inicio = new Date(lunesActual.getTime() - i * 7 * 24 * 3600 * 1000);
    semanas.push({ inicio: inicio, fin: new Date(inicio.getTime() + 7 * 24 * 3600 * 1000), etiqueta: etiquetaSemana_(inicio) });
  }
  const porArea = {};
  todas.forEach((a) => {
    if (!a.fecha_compromiso) return;
    const t = new Date(a.fecha_compromiso).getTime();
    let semana = null;
    for (let j = 0; j < semanas.length; j++) {
      if (t >= semanas[j].inicio.getTime() && t < semanas[j].fin.getTime()) { semana = semanas[j]; break; }
    }
    if (!semana) return;
    const areaNombre = nombresArea[a.area_id] || '(sin área)';
    if (!porArea[areaNombre]) {
      porArea[areaNombre] = {};
      semanas.forEach((s) => { porArea[areaNombre][s.etiqueta] = { total: 0, cumplidas: 0 }; });
    }
    const celda = porArea[areaNombre][semana.etiqueta];
    celda.total++;
    if (a.estado === ACTIVIDADES_ESTADOS.TERMINADA && a.fecha_terminada && new Date(a.fecha_terminada) <= new Date(a.fecha_compromiso)) {
      celda.cumplidas++;
    }
  });
  return Object.keys(porArea).sort().map((areaNombre) => ({
    area_nombre: areaNombre,
    semanas: semanas.map((s) => {
      const celda = porArea[areaNombre][s.etiqueta];
      return { etiqueta: s.etiqueta, total: celda.total, pct_cumplimiento: celda.total === 0 ? null : Math.round((celda.cumplidas / celda.total) * 1000) / 10 };
    })
  }));
}

function calcularPanelGerenciaActividades_(db, filtrosBase) {
  const nombresArea = areasPorId_(db);
  const todas = actividadesActivasNoCanceladas_(db).filter((a) => coincideFiltroGerenciaActividad_(a, filtrosBase));
  const ahora = new Date();
  const ventana = Gerencia.resolverVentanaPeriodo_(filtrosBase);
  const creadasVentana = todas.filter((a) => Gerencia.dentroDeRango_(a.fecha_creacion, ventana.desde, ventana.hasta));
  const creadasVentanaAnterior = todas.filter((a) => Gerencia.dentroDeRango_(a.fecha_creacion, ventana.desdeAnterior, ventana.hastaAnterior));

  const criticas = todas
    .filter((a) => {
      const s = semaforoActividad_(a);
      return ['P1', 'P2'].indexOf(a.prioridad) !== -1 && ['atrasada', 'riesgo', 'bloqueada'].indexOf(s.codigo) !== -1;
    })
    .map((a) => {
      const s = semaforoActividad_(a);
      return {
        actividad_id: a.actividad_id, titulo: a.titulo,
        responsable_nombre: a.responsable_nombre || a.responsable_email,
        area_nombre: nombresArea[a.area_id] || '(sin área)',
        prioridad: a.prioridad, semaforo: s.codigo, semaforo_etiqueta: s.etiqueta,
        fecha_compromiso: a.fecha_compromiso || ''
      };
    })
    .sort((x, y) => {
      const orden = { atrasada: 0, bloqueada: 1, riesgo: 2 };
      const porSemaforo = orden[x.semaforo] - orden[y.semaforo];
      if (porSemaforo !== 0) return porSemaforo;
      return new Date(x.fecha_compromiso || 0) - new Date(y.fecha_compromiso || 0);
    });

  return {
    kpis: calcularKpisGerenciaActividades_(db, todas, creadasVentana, creadasVentanaAnterior, ahora),
    heatmap: calcularHeatmapActividades_(todas, nombresArea),
    criticas: criticas,
    areas: Object.keys(nombresArea).map((id) => ({ area_id: id, nombre: nombresArea[id] })),
    ventana: { desde: ventana.desde.toISOString(), hasta: ventana.hasta.toISOString() }
  };
}

function construirReporteActividades_(db, tipo, filtros) {
  const nombresArea = areasPorId_(db);
  const ventana = Gerencia.resolverVentanaPeriodo_(filtros);
  const todas = actividadesActivasNoCanceladas_(db).filter((a) => coincideFiltroGerenciaActividad_(a, filtros));

  if (tipo === 'estado_actual') {
    const filasEstado = todas.map((a) => {
      const s = semaforoActividad_(a);
      return {
        titulo: a.titulo, responsable: a.responsable_nombre || a.responsable_email,
        // Fuera de `columnas` (no sale en PDF ni CSV): la pantalla agrupa por
        // persona, y el nombre solo no alcanza (unas filas traen nombre y otras correo).
        responsable_email: a.responsable_email || '',
        area: nombresArea[a.area_id] || '(sin área)', prioridad: a.prioridad,
        estado: a.estado, semaforo: s.etiqueta, fecha_compromiso: a.fecha_compromiso || ''
      };
    });
    return {
      tipo: tipo,
      columnas: [
        { campo: 'titulo', etiqueta: 'Actividad' }, { campo: 'responsable', etiqueta: 'Responsable' },
        { campo: 'area', etiqueta: 'Área' }, { campo: 'prioridad', etiqueta: 'Prioridad' },
        { campo: 'estado', etiqueta: 'Estado' }, { campo: 'semaforo', etiqueta: 'Semáforo' },
        { campo: 'fecha_compromiso', etiqueta: 'Vence' }
      ],
      filas: filasEstado, resumen: { total: filasEstado.length }
    };
  }

  if (tipo === 'cumplimiento_periodo') {
    const enPeriodo = todas.filter((a) => Gerencia.dentroDeRango_(a.fecha_compromiso, ventana.desde, ventana.hasta));
    const ahoraCump = new Date();
    const filasCump = enPeriodo.map((a) => {
      const cumplida = a.estado === ACTIVIDADES_ESTADOS.TERMINADA
        ? (a.fecha_terminada && new Date(a.fecha_terminada) <= new Date(a.fecha_compromiso) ? 'Sí' : 'No')
        : 'Pendiente';
      return {
        titulo: a.titulo, responsable: a.responsable_nombre || a.responsable_email,
        area: nombresArea[a.area_id] || '(sin área)', fecha_compromiso: a.fecha_compromiso || '',
        fecha_terminada: a.fecha_terminada || '', cumplida: cumplida, reprogramaciones: Number(a.reprogramaciones) || 0
      };
    });
    const terminadasConFecha = enPeriodo.filter((a) => a.estado === ACTIVIDADES_ESTADOS.TERMINADA && a.fecha_terminada);
    const aTiempoCump = terminadasConFecha.filter((a) => new Date(a.fecha_terminada) <= new Date(a.fecha_compromiso));
    const vencidasCump = enPeriodo.filter((a) => a.estado !== ACTIVIDADES_ESTADOS.TERMINADA && new Date(a.fecha_compromiso) < ahoraCump);
    return {
      tipo: tipo,
      columnas: [
        { campo: 'titulo', etiqueta: 'Actividad' }, { campo: 'responsable', etiqueta: 'Responsable' },
        { campo: 'area', etiqueta: 'Área' }, { campo: 'fecha_compromiso', etiqueta: 'Comprometida' },
        { campo: 'fecha_terminada', etiqueta: 'Terminada' }, { campo: 'cumplida', etiqueta: 'Cumplida a tiempo' },
        { campo: 'reprogramaciones', etiqueta: 'Reprogramaciones' }
      ],
      filas: filasCump,
      resumen: {
        comprometidas: enPeriodo.length, cumplidas_a_tiempo: aTiempoCump.length,
        pct_cumplimiento: terminadasConFecha.length === 0 ? null : Math.round((aTiempoCump.length / terminadasConFecha.length) * 1000) / 10,
        vencidas: vencidasCump.length,
        reprogramaciones_promedio: Gerencia.promedio_(enPeriodo.map((a) => Number(a.reprogramaciones) || 0))
      }
    };
  }

  // carga_capacidad
  const creadasEnPeriodo = todas.filter((a) => Gerencia.dentroDeRango_(a.fecha_creacion, ventana.desde, ventana.hasta));
  const porPersonaCarga = {};
  creadasEnPeriodo.forEach((a) => {
    const email = a.responsable_email || '(sin responsable)';
    if (!porPersonaCarga[email]) {
      porPersonaCarga[email] = { nombre: a.responsable_nombre || email, area: nombresArea[a.area_id] || '(sin área)', total: 0, emergentes: 0 };
    }
    porPersonaCarga[email].total++;
    if (a.origen === 'EMERGENTE') porPersonaCarga[email].emergentes++;
  });
  const filasCarga = Object.keys(porPersonaCarga).map((email) => {
    const p = porPersonaCarga[email];
    return {
      responsable: p.nombre, area: p.area, total: p.total,
      planificadas: p.total - p.emergentes, emergentes: p.emergentes,
      pct_emergente: p.total === 0 ? 0 : Math.round((p.emergentes / p.total) * 1000) / 10
    };
  }).sort((a, b) => b.total - a.total);
  const totalEmergentesCarga = creadasEnPeriodo.filter((a) => a.origen === 'EMERGENTE').length;
  return {
    tipo: tipo,
    columnas: [
      { campo: 'responsable', etiqueta: 'Responsable' }, { campo: 'area', etiqueta: 'Área' },
      { campo: 'total', etiqueta: 'Total' }, { campo: 'planificadas', etiqueta: 'Planificadas' },
      { campo: 'emergentes', etiqueta: 'Emergentes' }, { campo: 'pct_emergente', etiqueta: '% emergente' }
    ],
    filas: filasCarga,
    resumen: {
      total: creadasEnPeriodo.length, emergentes: totalEmergentesCarga,
      pct_emergente: creadasEnPeriodo.length === 0 ? null : Math.round((totalEmergentesCarga / creadasEnPeriodo.length) * 1000) / 10
    }
  };
}

function construirActaReunion_(db, filtros) {
  const nombresArea = areasPorId_(db);
  const todas = actividadesActivasNoCanceladas_(db).filter((a) => coincideFiltroGerenciaActividad_(a, filtros));
  const ahora = new Date();
  const inicioSemana = inicioSemanaUTC_(ahora);
  const finSemana = new Date(inicioSemana.getTime() + 7 * 24 * 3600 * 1000);
  const finSemanaEntrante = new Date(finSemana.getTime() + 7 * 24 * 3600 * 1000);

  function resumenActa_(a) {
    return {
      actividad_id: a.actividad_id, titulo: a.titulo,
      responsable: a.responsable_nombre || a.responsable_email,
      area: nombresArea[a.area_id] || '(sin área)', fecha_compromiso: a.fecha_compromiso || ''
    };
  }

  const vencidas = todas
    .filter((a) => a.estado !== ACTIVIDADES_ESTADOS.TERMINADA && a.fecha_compromiso && new Date(a.fecha_compromiso) < ahora)
    .map(resumenActa_);
  const bloqueadas = todas
    .filter((a) => a.estado === ACTIVIDADES_ESTADOS.BLOQUEADA)
    .map((a) => { const r = resumenActa_(a); r.motivo = a.bloqueo_motivo || ''; return r; });

  const idsEnAlcance = {};
  todas.forEach((a) => { idsEnAlcance[a.actividad_id] = a; });
  const vistos = {};
  const reprogramadas = [];
  leerSeguro_(db, 'ACTIVIDADES_BITACORA').forEach((b) => {
    if (b.tipo !== 'REPROGRAMACION') return;
    const t = new Date(b.timestamp);
    if (t < inicioSemana || t >= finSemana) return;
    if (vistos[b.actividad_id] || !idsEnAlcance[b.actividad_id]) return;
    vistos[b.actividad_id] = true;
    const r = resumenActa_(idsEnAlcance[b.actividad_id]);
    r.motivo = b.nota || '';
    reprogramadas.push(r);
  });

  const venceSemanaEntrante = todas
    .filter((a) => a.fecha_compromiso && a.estado !== ACTIVIDADES_ESTADOS.TERMINADA &&
      new Date(a.fecha_compromiso) >= finSemana && new Date(a.fecha_compromiso) < finSemanaEntrante)
    .map(resumenActa_);

  return {
    generado_en: ahora.toISOString(),
    vencidas: vencidas, bloqueadas: bloqueadas,
    reprogramadas_semana: reprogramadas, vence_semana_entrante: venceSemanaEntrante
  };
}

// --- trigger diario de alertas (Notificaciones.enviarAlertasActividades) ----
// §4.6: un solo correo diario por persona con TODAS sus alertas agrupadas
// (regla de oro). El correo sale via enviarCorreoModulo (texto plano; el HTML
// branded lo genera el transporte). Dedup por (evento+dia) via ventana de 24h.
const ACTIVIDADES_SECCIONES_ALERTA_ = [
  { clave: 'bloqueo_estancado', titulo: 'BLOQUEADAS HACE VARIOS DIAS' },
  { clave: 'vencidas', titulo: 'VENCIDAS' },
  { clave: 'compromiso_proximo', titulo: 'A PUNTO DE VENCER' },
  { clave: 'sin_confirmar', titulo: 'ASIGNADAS SIN CONFIRMAR' },
  { clave: 'sin_novedad', titulo: 'SIN NOVEDAD RECIENTE' }
];
function fechaCortaCorreo_(iso) {
  const f = new Date(iso);
  if (isNaN(f.getTime())) return '';
  return ('0' + f.getUTCDate()).slice(-2) + '/' + ('0' + (f.getUTCMonth() + 1)).slice(-2);
}
function resumirActividadAlerta_(a) {
  return a.titulo + ' (' + (a.responsable_nombre || a.responsable_email) +
    (a.fecha_compromiso ? ', vence ' + fechaCortaCorreo_(a.fecha_compromiso) : '') + ')';
}
function formatearAlertasActividades_(porTipo) {
  const bloques = ACTIVIDADES_SECCIONES_ALERTA_
    .filter((s) => porTipo[s.clave].length)
    .map((s) => s.titulo + '\n' + porTipo[s.clave].map((a) => '- ' + resumirActividadAlerta_(a)).join('\n'));
  return 'Tienes actividades que necesitan atencion:\n\n' + bloques.join('\n\n') + '\n\nEntra a SIGSO para verlas.';
}

async function enviarAlertasActividades(db) {
  const porPersona = calcularAlertas(db);
  const resultados = [];
  const notifs = [];
  for (const email of Object.keys(porPersona)) {
    const d = porPersona[email];
    const total = d.sin_novedad.length + d.sin_confirmar.length + d.compromiso_proximo.length + d.vencidas.length + d.bloqueo_estancado.length;
    if (!total) continue;
    const asunto = 'SIGSO — Actividades: ' + total + (total === 1 ? ' pendiente' : ' pendientes');
    const cuerpo = formatearAlertasActividades_(d);
    const claveEvento = 'ALERTAS_ACTIVIDADES:' + Utils.claveDia_(new Date(), 'America/Santiago');
    const r = await Notificaciones.enviarCorreoModulo(db, {
      solicitudId: claveEvento, destinatario: email, evento: 'ALERTAS_ACTIVIDADES',
      asunto: asunto, cuerpo: cuerpo, ventanaMinutos: VENTANA_DEDUP_SLA_VENCIDO_MINUTOS
    });
    resultados.push(Object.assign({ email: email, total: total }, r));
    notifs.push({
      destinatario: email, tipo: 'ALERTAS_ACTIVIDADES',
      titulo: 'Tienes ' + total + (total === 1 ? ' actividad pendiente' : ' actividades pendientes'),
      mensaje: 'Revisa tu digest diario: vencidas, sin confirmar, bloqueadas o sin novedad reciente.',
      modulo_id: 'mi_trabajo', texto_accion: 'Ver Mi trabajo', vidaHoras: 24
    });
  }
  NotificacionesApp.encolarLote(db, notifs);
  return resultados;
}

module.exports = {
  listar, panelEquipo, obtenerDetalle, crear, confirmar, checkin, validar, cancelar,
  reprogramar, reasignar, pedirActualizacion, getPanelGerencia, generarReporte, generarActaReunion,
  calcularAlertas, enviarAlertasActividades,
  // Exportadas para que Proyectos.js (wrappers de tarea) y sus tests reusen
  // el mismo motor y los mismos helpers, nunca duplicados.
  ACTIVIDADES_ESTADOS, esEstadoTerminal_, semaforoActividad_, normalizarEmail_,
  colaboradoresDeActividad_, trabajaLaActividad_, buscarActividad_, registrarEventoActividad_,
  // Mi trabajo v2: el registro del día de un compromiso SIN proyecto usa los
  // permisos de este módulo (ver Proyectos.resolverTareaRegistro_).
  puedeVerActividad_, puedeSupervisar_, puedeGestionar_
};
