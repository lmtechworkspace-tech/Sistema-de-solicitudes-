'use strict';

/**
 * auditoriasSgc.js — puerto de backend/backoffice/Auditorias.gs (SGC ISO
 * 9001, Fase 3b, PRO-03, §9.2). La otra mitad del motor de mejora: la Fase
 * 3a (No conformidades) construyó qué pasa cuando algo sale mal; ésta
 * construye el mecanismo por el que la organización ENCUENTRA lo que sale
 * mal, antes de que se lo encuentre el auditor de certificación.
 *
 * Ciclo: PROGRAMADA -> PLANIFICADA -> EJECUTADA -> INFORMADA -> CERRADA.
 *
 * DOS DECISIONES QUE VALE LA PENA EXPLICAR (idénticas al .gs):
 * 1) La lista de verificación Y los hallazgos son la MISMA tabla
 *    (SGC_AUD_HALLAZGOS). Una cláusula CONFORME no es un vacío: es
 *    evidencia de que se revisó.
 * 2) Un hallazgo NO_CONFORMIDAD se convierte en una NC de la Fase 3a con un
 *    clic, y de ahí en una ACTIVIDAD real. Una auditoría no se cierra
 *    mientras un hallazgo de no conformidad siga sin NC -- es el punto
 *    donde los SGC de papel se rompen: se levantan hallazgos y nadie los
 *    convierte en nada.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('./calidadSgc');
const { CLAUSULAS_ISO9001, PREGUNTAS_VERIFICACION_ISO9001 } = require('./sgcCatalogo');
const NoConformidades = require('./noConformidadesSgc');
const Utils = require('./utils');
const Cumplimiento = require('./cumplimiento');
const Notificaciones = require('./notificaciones');
const NotificacionesApp = require('./notificacionesApp');

const RESULTADOS_HALLAZGO = ['CONFORME', 'OBSERVACION', 'NO_CONFORMIDAD', 'OPORTUNIDAD'];
const ESTADOS_AUD_ABIERTAS = ['PROGRAMADA', 'PLANIFICADA', 'EJECUTADA', 'INFORMADA'];
const DIAS_INFORME_AUDITORIA = 10;
const DIAS_REDACCION_NC_AUDITORIA = 15;
const DIAS_ANTICIPACION_PLAN = 5;
const DIAS_AVISO_AUDITORIA = 7;
const MESES_CICLO_AUDITORIA = 12;

function uuid_() { return crypto.randomUUID(); }
function errorValidacion_(campo, mensaje) { return { _validationError: true, campo, message: mensaje }; }
function normalizarEmail_(email) { return String(email || '').trim().toLowerCase(); }
function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }
function esActivo_(fila) { return esVerdadero_(fila.activa); }
function esActivoHallazgo_(fila) { return esVerdadero_(fila.activo); }
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
function inicioSemanaUTC_(fecha) {
  const diaSemana = fecha.getUTCDay();
  const offsetLunes = (diaSemana + 6) % 7;
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate() - offsetLunes));
}
function obtenerFeriados_(db) { try { return Cumplimiento.obtenerFeriados(db); } catch (err) { return []; } }
function sumarDiasHabilesSgc_(db, desde, dias) {
  return Utils.sumarDiasHabiles_(desde, dias, { feriados: obtenerFeriados_(db), timezone: 'America/Santiago' });
}
function encolarAviso_(db, destinatario, titulo, mensaje, vidaHoras) {
  if (!destinatario) return;
  NotificacionesApp.encolarLote(db, [{ destinatario, tipo: 'SGC_AUDITORIA', titulo, mensaje, modulo_id: 'calidad', texto_accion: 'Ver auditoría', vidaHoras: vidaHoras || 120 }]);
}

// --- helpers -----------------------------------------------------------------
function parsearListaSgc_(valor) {
  if (!valor) return [];
  if (Array.isArray(valor)) return valor;
  try {
    const parsed = JSON.parse(valor);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) { return []; }
}
function normalizarClausulas_(lista) {
  return parsearListaSgc_(lista).map(String).filter((c) => !!tituloClausula_(c));
}
function tituloClausula_(codigo) {
  if (!codigo) return '';
  const c = CLAUSULAS_ISO9001.find((cl) => cl.codigo === String(codigo));
  return c ? c.titulo : '';
}
function ordenClausula_(codigo) {
  const partes = String(codigo || '').split('.');
  return (Number(partes[0]) || 0) * 100 + (Number(partes[1]) || 0);
}
function siguienteCorrelativoAud_(db, anio) {
  const delAnio = leerSeguro_(db, 'SGC_AUDITORIAS').filter((a) => String(a.anio) === String(anio)).length;
  return 'AI-' + anio + '-' + ('00' + (delAnio + 1)).slice(-3);
}
function encargadosSgc_(db) {
  return leerSeguro_(db, 'SGC_ROLES').filter((r) => esVerdadero_(r.activo) && r.rol_sgc === 'ENCARGADO_SGC').map((r) => normalizarEmail_(r.usuario_email)).filter(Boolean);
}
function buscarAuditoria_(db, auditoriaId) {
  if (!auditoriaId) return null;
  return leerSeguro_(db, 'SGC_AUDITORIAS').find((a) => a.auditoria_id === auditoriaId && esActivo_(a)) || null;
}
function buscarHallazgo_(db, hallazgoId) {
  if (!hallazgoId) return null;
  return leerSeguro_(db, 'SGC_AUD_HALLAZGOS').find((h) => h.hallazgo_id === hallazgoId && esActivoHallazgo_(h)) || null;
}
function hallazgosDe_(db, auditoriaId) {
  return leerSeguro_(db, 'SGC_AUD_HALLAZGOS').filter((h) => h.auditoria_id === auditoriaId && esActivoHallazgo_(h));
}
function clausulasDe_(aud) { return parsearListaSgc_(aud && aud.clausulas); }
function auditadosDe_(aud) { return parsearListaSgc_(aud && aud.auditados).map(normalizarEmail_).filter(Boolean); }
function coauditoresDe_(aud) { return parsearListaSgc_(aud && aud.coauditores).map(normalizarEmail_).filter(Boolean); }
function personasEntrevistadasDe_(aud) { return parsearListaSgc_(aud && aud.personas_entrevistadas).map(String); }

// §9.2.2 c): "los auditores no auditarán su propio trabajo".
function conflictoDeInteres_(db, auditorEmail, areaId, auditados) {
  const auditor = normalizarEmail_(auditorEmail);
  if (!auditor) return null;
  if (areaId && Calidad.areaSgc_(db, { email: auditor }) === areaId) {
    return errorValidacion_('auditor_email', 'El auditor pertenece a esa área: nadie audita su propio trabajo (ISO 9001 §9.2.2).');
  }
  if ((auditados || []).map(normalizarEmail_).indexOf(auditor) !== -1) {
    return errorValidacion_('auditados', 'El auditor no puede estar en la lista de auditados: nadie se audita a sí mismo.');
  }
  return null;
}
function coauditoresConConflicto_(db, coauditores, areaId, auditados) {
  for (const c of coauditores) {
    const conflicto = conflictoDeInteres_(db, c, areaId, auditados);
    if (conflicto) return conflicto;
  }
  return null;
}
function puedeAuditar_(db, aud, contexto) {
  if (Calidad.gobiernaSgc_(db, contexto)) return true;
  const email = normalizarEmail_(contexto && contexto.email);
  if (normalizarEmail_(aud.auditor_email) === email) return true;
  return coauditoresDe_(aud).indexOf(email) !== -1;
}
function puedeVerAuditoria_(db, aud, contexto) {
  const rol = Calidad.rolSgc_(db, contexto);
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  if (Calidad.veTodoSgc_(db, contexto, rol, gobierna)) return true;
  const email = normalizarEmail_(contexto && contexto.email);
  if (normalizarEmail_(aud.auditor_email) === email) return true;
  if (coauditoresDe_(aud).indexOf(email) !== -1) return true;
  if (auditadosDe_(aud).indexOf(email) !== -1) return true;
  const miArea = Calidad.areaSgc_(db, contexto);
  return !!miArea && aud.area_id === miArea;
}
function anticipacionPlanAud_(db, aud) {
  if (!aud.fecha_plan || !aud.fecha_ejecucion) return null;
  const plan = new Date(aud.fecha_plan);
  const ejec = new Date(aud.fecha_ejecucion);
  if (isNaN(plan.getTime()) || isNaN(ejec.getTime())) return null;
  const limite = sumarDiasHabilesSgc_(db, plan, DIAS_ANTICIPACION_PLAN);
  return { dias_naturales: Math.round((ejec - plan) / 86400000), suficiente: !!limite && ejec >= new Date(limite) };
}
function resumenAud_(db, aud, hallazgos, ahora) {
  const mios = hallazgos.filter((h) => h.auditoria_id === aud.auditoria_id);
  function contar_(resultado) { return mios.filter((h) => h.resultado === resultado).length; }
  const informeVencido = aud.estado === 'EJECUTADA' && aud.informe_plazo && new Date(aud.informe_plazo) < ahora;
  return {
    auditoria_id: aud.auditoria_id, correlativo: aud.correlativo, anio: aud.anio, area_id: aud.area_id,
    proceso: aud.proceso, auditor_email: aud.auditor_email, estado: aud.estado,
    fecha_programada: aud.fecha_programada, fecha_ejecucion: aud.fecha_ejecucion,
    informe_plazo: aud.informe_plazo, informe_vencido: !!informeVencido,
    anticipacion_plan: anticipacionPlanAud_(db, aud),
    clausulas: clausulasDe_(aud), verificaciones: mios.length,
    conformes: contar_('CONFORME'), observaciones: contar_('OBSERVACION'),
    no_conformidades: contar_('NO_CONFORMIDAD'), oportunidades: contar_('OPORTUNIDAD'),
    nc_pendientes: mios.filter((h) => h.resultado === 'NO_CONFORMIDAD' && !h.nc_id).length
  };
}
function aniosConAuditorias_(todas) {
  const vistos = {};
  todas.forEach((a) => { if (a.anio) vistos[a.anio] = true; });
  vistos[new Date().getFullYear()] = true;
  return Object.keys(vistos).sort().reverse();
}
function procesosSinAuditar_(todas, ahora) {
  const limite = new Date(ahora);
  limite.setMonth(limite.getMonth() - MESES_CICLO_AUDITORIA);
  const ultimaPorProceso = {};
  todas.forEach((a) => {
    if (a.estado === 'ANULADA') return;
    const proceso = String(a.proceso || '').trim();
    if (!proceso) return;
    if (!(proceso in ultimaPorProceso)) ultimaPorProceso[proceso] = '';
    const ejecutada = ['EJECUTADA', 'INFORMADA', 'CERRADA'].indexOf(a.estado) !== -1;
    if (!ejecutada || !a.fecha_ejecucion) return;
    if (!ultimaPorProceso[proceso] || new Date(a.fecha_ejecucion) > new Date(ultimaPorProceso[proceso])) {
      ultimaPorProceso[proceso] = a.fecha_ejecucion;
    }
  });
  const atrasados = [];
  Object.keys(ultimaPorProceso).forEach((proceso) => {
    const ultima = ultimaPorProceso[proceso];
    const tienePlan = todas.some((a) => String(a.proceso || '').trim() === proceso &&
      ESTADOS_AUD_ABIERTAS.indexOf(a.estado) !== -1 && ['EJECUTADA', 'INFORMADA'].indexOf(a.estado) === -1);
    if (tienePlan) return;
    if (!ultima || new Date(ultima) < limite) atrasados.push({ proceso, ultima });
  });
  return atrasados;
}
function indicadoresAud_(todas, hallazgos, ahora) {
  const anio = ahora.getFullYear();
  const delAnio = todas.filter((a) => String(a.anio) === String(anio) && a.estado !== 'ANULADA');
  const ejecutadas = delAnio.filter((a) => ['EJECUTADA', 'INFORMADA', 'CERRADA'].indexOf(a.estado) !== -1);
  const idsDelAnio = {};
  delAnio.forEach((a) => { idsDelAnio[a.auditoria_id] = true; });
  const hallazgosAnio = hallazgos.filter((h) => idsDelAnio[h.auditoria_id]);
  return {
    programadas: delAnio.length, ejecutadas: ejecutadas.length,
    pct_cumplimiento: delAnio.length ? Math.round((ejecutadas.length / delAnio.length) * 1000) / 10 : null,
    informes_vencidos: delAnio.filter((a) => a.estado === 'EJECUTADA' && a.informe_plazo && new Date(a.informe_plazo) < ahora).length,
    no_conformidades: hallazgosAnio.filter((h) => h.resultado === 'NO_CONFORMIDAD').length,
    nc_pendientes: hallazgosAnio.filter((h) => h.resultado === 'NO_CONFORMIDAD' && !h.nc_id).length,
    procesos_sin_auditar: procesosSinAuditar_(todas, ahora).length
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
  const miArea = Calidad.areaSgc_(db, contexto);

  const todas = leerSeguro_(db, 'SGC_AUDITORIAS').filter(esActivo_);
  let visibles = todas.filter((a) => {
    if (Calidad.veTodoSgc_(db, contexto, rol, gobierna)) return true;
    if (normalizarEmail_(a.auditor_email) === email) return true;
    if (miArea && a.area_id === miArea) return true;
    return auditadosDe_(a).indexOf(email) !== -1;
  });
  if (filtros.anio) visibles = visibles.filter((a) => String(a.anio) === String(filtros.anio));
  if (filtros.abiertas) visibles = visibles.filter((a) => ESTADOS_AUD_ABIERTAS.indexOf(a.estado) !== -1);

  const hallazgos = leerSeguro_(db, 'SGC_AUD_HALLAZGOS').filter(esActivoHallazgo_);
  const ahora = new Date();

  return {
    puede_gestionar: gobierna,
    anios: aniosConAuditorias_(todas),
    clausulas_catalogo: CLAUSULAS_ISO9001,
    indicadores: indicadoresAud_(todas, hallazgos, ahora),
    auditorias: visibles.map((a) => resumenAud_(db, a, hallazgos, ahora))
      .sort((a, b) => new Date(a.fecha_programada || 0) - new Date(b.fecha_programada || 0))
  };
}

function getDetalle(db, data, contexto) {
  const aud = buscarAuditoria_(db, data.auditoria_id);
  if (!aud) return errorValidacion_('auditoria_id', 'Auditoría no encontrada.');
  if (!puedeVerAuditoria_(db, aud, contexto)) return { _forbidden: true, message: 'No tienes acceso a esta auditoría.' };

  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  const todos = leerSeguro_(db, 'SGC_AUD_HALLAZGOS').filter(esActivoHallazgo_);
  const mios = todos.filter((h) => h.auditoria_id === aud.auditoria_id);
  const ncs = leerSeguro_(db, 'SGC_NC');
  const ncPorId = {};
  ncs.forEach((nc) => { ncPorId[nc.nc_id] = nc; });

  const informeNc = mios.filter((h) => h.nc_id).map((h) => {
    const nc = ncPorId[h.nc_id];
    return {
      nc_correlativo: nc ? nc.correlativo : '', punto_normativo: h.clausula,
      no_conformidad: nc ? nc.descripcion : h.descripcion, evidencia_objetiva: h.evidencia
    };
  });

  return {
    auditoria: Object.assign({}, aud, { coauditores: coauditoresDe_(aud), personas_entrevistadas: personasEntrevistadasDe_(aud) }),
    puede_gestionar: gobierna,
    puede_auditar: puedeAuditar_(db, aud, contexto),
    clausulas_catalogo: CLAUSULAS_ISO9001,
    preguntas_catalogo: PREGUNTAS_VERIFICACION_ISO9001,
    clausulas_alcance: clausulasDe_(aud),
    auditados: auditadosDe_(aud),
    resumen: resumenAud_(db, aud, todos, new Date()),
    informe_resumen_nc: informeNc,
    hallazgos: mios.map((h) => {
      const nc = h.nc_id ? ncPorId[h.nc_id] : null;
      return {
        hallazgo_id: h.hallazgo_id, clausula: h.clausula, clausula_titulo: tituloClausula_(h.clausula),
        aspecto_verificado: h.aspecto_verificado, evidencia: h.evidencia, resultado: h.resultado,
        descripcion: h.descripcion, nc_id: h.nc_id, nc_correlativo: nc ? nc.correlativo : '',
        nc_estado: nc ? nc.estado : '', registrado_por: h.registrado_por, fecha_registro: h.fecha_registro
      };
    }).sort((a, b) => ordenClausula_(a.clausula) - ordenClausula_(b.clausula))
  };
}

// --- 1) Programar (plan anual) ----------------------------------------------
function programar(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden programar auditorías.' };
  const proceso = String(data.proceso || '').trim();
  if (!proceso) return errorValidacion_('proceso', 'Indica qué proceso se va a auditar.');
  if (!data.fecha_programada) return errorValidacion_('fecha_programada', 'Indica en qué fecha se planea auditar.');
  const auditor = normalizarEmail_(data.auditor_email);
  if (!auditor) return errorValidacion_('auditor_email', 'Asigna un auditor.');

  const areaId = String(data.area_id || '').trim();
  const conflicto = conflictoDeInteres_(db, auditor, areaId, []);
  if (conflicto) return conflicto;

  const clausulas = normalizarClausulas_(data.clausulas);
  if (!clausulas.length) return errorValidacion_('clausulas', 'Elige al menos una cláusula de la norma a auditar.');

  const ahora = new Date();
  const anio = new Date(data.fecha_programada).getFullYear() || ahora.getFullYear();
  const aud = {
    auditoria_id: uuid_(), correlativo: siguienteCorrelativoAud_(db, anio), anio, area_id: areaId, proceso,
    clausulas: JSON.stringify(clausulas), auditor_email: auditor, auditados: JSON.stringify([]), coauditores: JSON.stringify([]),
    objetivo: '', alcance: '', criterios: '',
    fecha_programada: data.fecha_programada, fecha_plan: '', fecha_ejecucion: '',
    estado: 'PROGRAMADA',
    informe_plazo: '', informe_fecha: '', informe_conclusion: '', personas_entrevistadas: JSON.stringify([]),
    fecha_cierre: '', cerrada_por: '',
    creada_por: normalizarEmail_(contexto.email), fecha_creacion: ahora.toISOString(), activa: true
  };
  agregarFila_(db, 'SGC_AUDITORIAS', aud);
  registrarLogSgc_(db, 'SGC_AUDITORIA_PROGRAMADA', aud.correlativo + ': ' + proceso, contexto);
  encolarAviso_(db, auditor, 'Te asignaron una auditoría interna', aud.correlativo + ': ' + proceso + '. Prepara el plan.');
  return aud;
}

// --- 2) Planificar (FO-PRO-03-02) -------------------------------------------
function planificar(db, data, contexto) {
  const aud = buscarAuditoria_(db, data.auditoria_id);
  if (!aud) return errorValidacion_('auditoria_id', 'Auditoría no encontrada.');
  if (!puedeAuditar_(db, aud, contexto)) return { _forbidden: true, message: 'Solo el auditor asignado o el Encargado SGC pueden planificar esta auditoría.' };
  if (['PROGRAMADA', 'PLANIFICADA'].indexOf(aud.estado) === -1) return errorValidacion_('auditoria_id', 'Esta auditoría ya se ejecutó: el plan no se puede cambiar.');
  const objetivo = String(data.objetivo || '').trim();
  if (!objetivo) return errorValidacion_('objetivo', 'Escribe el objetivo de la auditoría.');
  const alcance = String(data.alcance || '').trim();
  if (!alcance) return errorValidacion_('alcance', 'Define el alcance: qué queda dentro y qué no.');
  if (!data.fecha_ejecucion) return errorValidacion_('fecha_ejecucion', 'Indica en qué fecha se realizará.');

  const auditados = (data.auditados || []).map(normalizarEmail_).filter(Boolean);
  const coauditores = (data.coauditores || []).map(normalizarEmail_).filter(Boolean);
  const conflicto = conflictoDeInteres_(db, aud.auditor_email, aud.area_id, auditados) ||
    coauditoresConConflicto_(db, coauditores, aud.area_id, auditados);
  if (conflicto) return conflicto;

  const ahora = new Date();
  const actualizada = actualizarFilaPorId_(db, 'SGC_AUDITORIAS', 'auditoria_id', aud.auditoria_id, {
    objetivo, alcance, criterios: String(data.criterios || '').trim(),
    auditados: JSON.stringify(auditados), coauditores: JSON.stringify(coauditores),
    fecha_ejecucion: data.fecha_ejecucion, fecha_plan: ahora.toISOString(), estado: 'PLANIFICADA'
  });
  registrarLogSgc_(db, 'SGC_AUDITORIA_PLANIFICADA', aud.correlativo, contexto);

  auditados.forEach((email) => {
    encolarAviso_(db, email, 'Auditoría interna programada',
      aud.correlativo + ' — ' + aud.proceso + '. Se realizará el ' + String(data.fecha_ejecucion).slice(0, 10) + '.');
  });
  return actualizada;
}

// --- 3) Lista de verificacion / hallazgos ------------------------------------
function registrarHallazgo(db, data, contexto) {
  const aud = buscarAuditoria_(db, data.auditoria_id);
  if (!aud) return errorValidacion_('auditoria_id', 'Auditoría no encontrada.');
  if (!puedeAuditar_(db, aud, contexto)) return { _forbidden: true, message: 'Solo el auditor asignado o el Encargado SGC pueden registrar hallazgos.' };
  if (['PLANIFICADA', 'EJECUTADA'].indexOf(aud.estado) === -1) {
    return errorValidacion_('auditoria_id', aud.estado === 'PROGRAMADA'
      ? 'Primero planifica la auditoría (objetivo, alcance y fecha).'
      : 'El informe ya se emitió: la lista de verificación queda cerrada.');
  }
  if (!tituloClausula_(data.clausula)) return errorValidacion_('clausula', 'Indica qué cláusula de la norma se está verificando.');
  if (RESULTADOS_HALLAZGO.indexOf(data.resultado) === -1) return errorValidacion_('resultado', 'Indica el resultado de la verificación.');
  const aspecto = String(data.aspecto_verificado || '').trim();
  if (!aspecto) return errorValidacion_('aspecto_verificado', 'Escribe qué se verificó concretamente.');
  if (data.resultado !== 'CONFORME' && !String(data.descripcion || '').trim()) {
    return errorValidacion_('descripcion', 'Describe el hallazgo: es lo que después se convierte en no conformidad.');
  }

  const campos = {
    clausula: String(data.clausula), aspecto_verificado: aspecto,
    evidencia: String(data.evidencia || '').trim(), resultado: data.resultado,
    descripcion: String(data.descripcion || '').trim()
  };

  if (data.hallazgo_id) {
    const previo = buscarHallazgo_(db, data.hallazgo_id);
    if (!previo) return errorValidacion_('hallazgo_id', 'Hallazgo no encontrado.');
    if (previo.nc_id && campos.resultado !== previo.resultado) {
      return errorValidacion_('resultado', 'Este hallazgo ya generó la no conformidad; su resultado no se puede cambiar.');
    }
    const editado = actualizarFilaPorId_(db, 'SGC_AUD_HALLAZGOS', 'hallazgo_id', data.hallazgo_id, campos);
    registrarLogSgc_(db, 'SGC_HALLAZGO_EDITADO', aud.correlativo + ' / ' + campos.clausula, contexto);
    return editado;
  }

  const hallazgo = Object.assign({
    hallazgo_id: uuid_(), auditoria_id: aud.auditoria_id, nc_id: '',
    registrado_por: normalizarEmail_(contexto.email), fecha_registro: new Date().toISOString(), activo: true
  }, campos);
  agregarFila_(db, 'SGC_AUD_HALLAZGOS', hallazgo);
  registrarLogSgc_(db, 'SGC_HALLAZGO_REGISTRADO', aud.correlativo + ' / ' + campos.clausula + ': ' + campos.resultado, contexto);
  return hallazgo;
}

function eliminarHallazgo(db, data, contexto) {
  const hallazgo = buscarHallazgo_(db, data.hallazgo_id);
  if (!hallazgo) return errorValidacion_('hallazgo_id', 'Hallazgo no encontrado.');
  const aud = buscarAuditoria_(db, hallazgo.auditoria_id);
  if (!aud || !puedeAuditar_(db, aud, contexto)) return { _forbidden: true, message: 'No puedes modificar los hallazgos de esta auditoría.' };
  if (hallazgo.nc_id) return errorValidacion_('hallazgo_id', 'Este hallazgo ya generó una no conformidad. Si fue un error, anula la no conformidad.');
  if (['PLANIFICADA', 'EJECUTADA'].indexOf(aud.estado) === -1) return errorValidacion_('hallazgo_id', 'El informe ya se emitió: la lista de verificación queda cerrada.');
  const borrado = actualizarFilaPorId_(db, 'SGC_AUD_HALLAZGOS', 'hallazgo_id', hallazgo.hallazgo_id, { activo: false });
  registrarLogSgc_(db, 'SGC_HALLAZGO_ELIMINADO', aud.correlativo + ' / ' + hallazgo.clausula, contexto);
  return borrado;
}

// --- 4) Cerrar la ejecucion: arranca el reloj del informe --------------------
function cerrarEjecucion(db, data, contexto) {
  const aud = buscarAuditoria_(db, data.auditoria_id);
  if (!aud) return errorValidacion_('auditoria_id', 'Auditoría no encontrada.');
  if (!puedeAuditar_(db, aud, contexto)) return { _forbidden: true, message: 'Solo el auditor asignado o el Encargado SGC pueden cerrar la ejecución.' };
  if (aud.estado !== 'PLANIFICADA') return errorValidacion_('auditoria_id', 'La auditoría no está en ejecución.');
  const hallazgos = hallazgosDe_(db, aud.auditoria_id);
  if (!hallazgos.length) return errorValidacion_('auditoria_id', 'Registra al menos una cláusula verificada: una auditoría sin lista de verificación no es evidencia de nada.');

  const ahora = new Date();
  const ejecutada = actualizarFilaPorId_(db, 'SGC_AUDITORIAS', 'auditoria_id', aud.auditoria_id, {
    estado: 'EJECUTADA', fecha_ejecucion: aud.fecha_ejecucion || ahora.toISOString(),
    informe_plazo: sumarDiasHabilesSgc_(db, ahora, DIAS_INFORME_AUDITORIA)
  });
  registrarLogSgc_(db, 'SGC_AUDITORIA_EJECUTADA', aud.correlativo + ' (' + hallazgos.length + ' verificaciones)', contexto);
  return ejecutada;
}

// --- 5) Informe (FO-PRO-03-03) ----------------------------------------------
function emitirInforme(db, data, contexto) {
  const aud = buscarAuditoria_(db, data.auditoria_id);
  if (!aud) return errorValidacion_('auditoria_id', 'Auditoría no encontrada.');
  if (!puedeAuditar_(db, aud, contexto)) return { _forbidden: true, message: 'Solo el auditor asignado o el Encargado SGC pueden emitir el informe.' };
  if (aud.estado !== 'EJECUTADA') return errorValidacion_('auditoria_id', 'El informe se emite después de ejecutar la auditoría.');
  const conclusion = String(data.conclusion || '').trim();
  if (!conclusion) return errorValidacion_('conclusion', 'Escribe la conclusión: es el informe de auditoría.');

  const entrevistados = (data.personas_entrevistadas || []).map((s) => String(s || '').trim()).filter(Boolean);

  const ahora = new Date();
  const informada = actualizarFilaPorId_(db, 'SGC_AUDITORIAS', 'auditoria_id', aud.auditoria_id, {
    estado: 'INFORMADA', informe_fecha: ahora.toISOString(), informe_conclusion: conclusion,
    personas_entrevistadas: JSON.stringify(entrevistados)
  });
  registrarLogSgc_(db, 'SGC_AUDITORIA_INFORMADA', aud.correlativo, contexto);

  const pendientes = hallazgosDe_(db, aud.auditoria_id).filter((h) => h.resultado === 'NO_CONFORMIDAD' && !h.nc_id);
  const destinatarios = auditadosDe_(aud).concat(encargadosSgc_(db));
  destinatarios.forEach((email) => {
    encolarAviso_(db, email, 'Informe de auditoría emitido',
      aud.correlativo + ' — ' + aud.proceso + (pendientes.length ? '. Hay ' + pendientes.length + ' no conformidad(es) por levantar.' : '.'));
  });
  return informada;
}

// --- 6) Hallazgo -> no conformidad -------------------------------------------
function convertirHallazgoEnNc(db, data, contexto) {
  const hallazgo = buscarHallazgo_(db, data.hallazgo_id);
  if (!hallazgo) return errorValidacion_('hallazgo_id', 'Hallazgo no encontrado.');
  const aud = buscarAuditoria_(db, hallazgo.auditoria_id);
  if (!aud) return errorValidacion_('hallazgo_id', 'Auditoría no encontrada.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden levantar no conformidades.' };
  if (hallazgo.nc_id) return errorValidacion_('hallazgo_id', 'Este hallazgo ya tiene su no conformidad.');
  if (['NO_CONFORMIDAD', 'OBSERVACION'].indexOf(hallazgo.resultado) === -1) {
    return errorValidacion_('hallazgo_id', 'Solo un hallazgo de no conformidad u observación se convierte en no conformidad.');
  }

  const nc = NoConformidades.crear(db, {
    descripcion: hallazgo.descripcion || hallazgo.aspecto_verificado,
    fuente: 'AUDITORIA_INTERNA', origen_ref: hallazgo.hallazgo_id,
    referencia_normativa: hallazgo.clausula, area_id: aud.area_id,
    responsable_email: normalizarEmail_(data.responsable_email) || auditadosDe_(aud)[0] || aud.auditor_email,
    fecha_deteccion: aud.fecha_ejecucion || new Date().toISOString()
  }, contexto);
  if (nc && (nc._validationError || nc._forbidden)) return nc;

  actualizarFilaPorId_(db, 'SGC_AUD_HALLAZGOS', 'hallazgo_id', hallazgo.hallazgo_id, { nc_id: nc.nc_id });
  registrarLogSgc_(db, 'SGC_HALLAZGO_A_NC', aud.correlativo + ' / ' + hallazgo.clausula + ' -> ' + nc.correlativo, contexto);
  return { hallazgo_id: hallazgo.hallazgo_id, nc };
}

// --- 7) Cerrar la auditoria --------------------------------------------------
function cerrar(db, data, contexto) {
  const aud = buscarAuditoria_(db, data.auditoria_id);
  if (!aud) return errorValidacion_('auditoria_id', 'Auditoría no encontrada.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden cerrar una auditoría.' };
  if (aud.estado !== 'INFORMADA') return errorValidacion_('auditoria_id', 'Primero emite el informe de la auditoría.');

  const sinNc = hallazgosDe_(db, aud.auditoria_id).filter((h) => h.resultado === 'NO_CONFORMIDAD' && !h.nc_id);
  if (sinNc.length) {
    return errorValidacion_('auditoria_id',
      (sinNc.length === 1 ? 'Falta 1 no conformidad por levantar: ' : 'Faltan ' + sinNc.length + ' no conformidades por levantar: ') +
      sinNc.map((h) => h.clausula).join(', ') + '.');
  }

  const ahora = new Date().toISOString();
  const cerrada = actualizarFilaPorId_(db, 'SGC_AUDITORIAS', 'auditoria_id', aud.auditoria_id, {
    estado: 'CERRADA', fecha_cierre: ahora, cerrada_por: normalizarEmail_(contexto.email)
  });
  registrarLogSgc_(db, 'SGC_AUDITORIA_CERRADA', aud.correlativo, contexto);
  return cerrada;
}

function anular(db, data, contexto) {
  const aud = buscarAuditoria_(db, data.auditoria_id);
  if (!aud) return errorValidacion_('auditoria_id', 'Auditoría no encontrada.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden anular una auditoría.' };
  const motivo = String(data.motivo || '').trim();
  if (!motivo) return errorValidacion_('motivo', 'Explica por qué se anula: queda en el registro.');
  if (aud.estado === 'CERRADA') return errorValidacion_('auditoria_id', 'Una auditoría cerrada no se anula.');
  const anulada = actualizarFilaPorId_(db, 'SGC_AUDITORIAS', 'auditoria_id', aud.auditoria_id, {
    estado: 'ANULADA', fecha_cierre: new Date().toISOString(), cerrada_por: normalizarEmail_(contexto.email)
  });
  registrarLogSgc_(db, 'SGC_AUDITORIA_ANULADA', aud.correlativo + ': ' + motivo, contexto);
  return anulada;
}

// --- avisos diarios -----------------------------------------------------------
// Cuatro cosas que se pierden en silencio si nadie las mira: informe fuera
// de plazo (diario); NC sin redactar a 15 dh del informe (diario); auditoría
// que se acerca (semanal); proceso sin auditar en 12 meses (semanal). Este
// último es el que un auditor de certificación pregunta textual: "¿todos
// los procesos fueron auditados en el período?".
async function recordatorioPendientes(db) {
  const todas = leerSeguro_(db, 'SGC_AUDITORIAS').filter(esActivo_);
  const hallazgos = leerSeguro_(db, 'SGC_AUD_HALLAZGOS').filter(esActivoHallazgo_);
  const ahora = new Date();
  const hoy = ahora.toISOString().slice(0, 10);
  const semana = inicioSemanaUTC_(ahora).toISOString().slice(0, 10);
  const encargados = encargadosSgc_(db);
  let avisos = 0;

  // 1) Informe fuera del plazo de 10 dias habiles.
  for (const a of todas.filter((a) => a.estado === 'EJECUTADA' && a.informe_plazo && new Date(a.informe_plazo) < ahora)) {
    const dias = Math.floor((ahora - new Date(a.informe_plazo)) / 86400000);
    const destinos = [normalizarEmail_(a.auditor_email)].concat(encargados);
    for (const email of destinos) {
      if (!email) continue;
      const asunto = 'SIGSO — Informe de auditoría ' + a.correlativo + ' fuera de plazo';
      const cuerpo = 'La auditoría ' + a.correlativo + ' (' + a.proceso + ') se ejecutó y el informe lleva ' +
        dias + ' día(s) de atraso.\n\nEntra a SIGSO > Calidad > Auditorías.';
      const r = await Notificaciones.enviarCorreoModulo(db, { solicitudId: 'SGC_AUD_INFORME:' + a.auditoria_id + ':' + hoy, destinatario: email, evento: 'SGC_AUD_INFORME', asunto, cuerpo, ventanaMinutos: 24 * 60 });
      if (r && r.enviado) avisos++;
      encolarAviso_(db, email, 'Informe de auditoría atrasado', a.correlativo + ': ' + dias + ' día(s) de atraso.', 72);
    }
  }

  // 2) NC sin redactar dentro de los 15 dias habiles desde el informe.
  for (const a of todas.filter((a) => a.estado === 'INFORMADA' && a.informe_fecha)) {
    const plazo = sumarDiasHabilesSgc_(db, a.informe_fecha, DIAS_REDACCION_NC_AUDITORIA);
    if (!plazo || new Date(plazo) >= ahora) continue;
    const pendientes = hallazgos.filter((h) => h.auditoria_id === a.auditoria_id && h.resultado === 'NO_CONFORMIDAD' && !h.nc_id);
    if (!pendientes.length) continue;
    const dias = Math.floor((ahora - new Date(plazo)) / 86400000);
    const destinos = auditadosDe_(a).concat(encargados);
    for (const email of destinos) {
      if (!email) continue;
      const asunto = 'SIGSO — No conformidades sin redactar de la auditoría ' + a.correlativo;
      const cuerpo = 'La auditoría ' + a.correlativo + ' (' + a.proceso + ') tiene ' + pendientes.length +
        ' hallazgo(s) de no conformidad sin redactar, ' + dias + ' día(s) fuera del plazo de 15 hábiles.\n\n' +
        'Entra a SIGSO > Calidad > Auditorías.';
      const r = await Notificaciones.enviarCorreoModulo(db, { solicitudId: 'SGC_AUD_NC_PENDIENTE:' + a.auditoria_id + ':' + hoy, destinatario: email, evento: 'SGC_AUD_NC_PENDIENTE', asunto, cuerpo, ventanaMinutos: 24 * 60 });
      if (r && r.enviado) avisos++;
      encolarAviso_(db, email, 'No conformidades sin redactar', a.correlativo + ': ' + pendientes.length + ' hallazgo(s) sin NC.', 72);
    }
  }

  // 3) Auditoria planificada que se acerca. Semanal.
  let proximas = 0;
  for (const a of todas.filter((a) => a.estado === 'PLANIFICADA' && a.fecha_ejecucion &&
    (() => { const dias = Math.ceil((new Date(a.fecha_ejecucion) - ahora) / 86400000); return dias >= 0 && dias <= DIAS_AVISO_AUDITORIA; })())) {
    proximas++;
    const destinos = [normalizarEmail_(a.auditor_email)].concat(auditadosDe_(a));
    for (const email of destinos) {
      if (!email) continue;
      encolarAviso_(db, email, 'Auditoría interna próxima', a.correlativo + ' — ' + a.proceso + ', el ' + String(a.fecha_ejecucion).slice(0, 10) + '.');
      const asunto = 'SIGSO — Auditoría interna ' + a.correlativo + ' próxima';
      const cuerpo = 'La auditoría ' + a.correlativo + ' de ' + a.proceso + ' se realizará el ' +
        String(a.fecha_ejecucion).slice(0, 10) + '.\n\nObjetivo: ' + (a.objetivo || '-') + '\nAlcance: ' + (a.alcance || '-');
      const r = await Notificaciones.enviarCorreoModulo(db, { solicitudId: 'SGC_AUD_PROXIMA:' + a.auditoria_id + ':' + semana, destinatario: email, evento: 'SGC_AUD_PROXIMA', asunto, cuerpo, ventanaMinutos: 7 * 24 * 60 });
      if (r && r.enviado) avisos++;
    }
  }

  // 4) Procesos sin auditar en 12 meses.
  const atrasados = procesosSinAuditar_(todas, ahora);
  if (atrasados.length) {
    const cuerpo = 'Estos procesos llevan más de 12 meses sin auditoría interna:\n' +
      atrasados.map((p) => '- ' + p.proceso + (p.ultima ? ' (última: ' + p.ultima.slice(0, 10) + ')' : ' (nunca)')).join('\n') +
      '\n\nEs lo primero que revisa una auditoría de certificación del §9.2.';
    for (const email of encargados) {
      const asunto = 'SIGSO — ' + atrasados.length + ' proceso(s) sin auditar en 12 meses';
      const r = await Notificaciones.enviarCorreoModulo(db, { solicitudId: 'SGC_AUD_CICLO:' + semana, destinatario: email, evento: 'SGC_AUD_CICLO', asunto, cuerpo, ventanaMinutos: 7 * 24 * 60 });
      if (r && r.enviado) avisos++;
      encolarAviso_(db, email, 'Procesos sin auditar', atrasados.length + ' proceso(s) llevan más de 12 meses sin auditoría.');
    }
  }

  return { avisos, proximas, sin_auditar: atrasados.length };
}

module.exports = {
  listar, getDetalle, programar, planificar, registrarHallazgo, eliminarHallazgo,
  cerrarEjecucion, emitirInforme, convertirHallazgoEnNc, cerrar, anular, recordatorioPendientes
};
