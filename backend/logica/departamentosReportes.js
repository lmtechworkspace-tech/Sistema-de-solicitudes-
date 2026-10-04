'use strict';

/**
 * departamentosReportes.js — el REPORTE MENSUAL de cada departamento
 * (2026-10-03, pedido del dueño: "que cada departamento genere su reporte, lo
 * valide jefatura y jefatura lo entregue a la encargada de administración",
 * según el organigrama de HomePymes, DOC-05 y DOC-09).
 *
 * El camino de un reporte:
 *
 *   BORRADOR ──enviar──> EN_REVISION ──validar──> VALIDADO ──recibir──> RECIBIDO
 *      ^                     │                       │
 *      └──── OBSERVADO <─────┴──────devolver─────────┘
 *
 *  - El área (REGISTRA o JEFATURA en su lista) lo prepara y lo envía.
 *  - Su jefatura (JEFATURA en la lista del área) lo valida o lo devuelve con
 *    una observación. Si quien lo envía ES la jefatura (p. ej. Marketing, que
 *    es una sola persona), queda validado al enviarlo: no hay a quién más
 *    pedírselo, y queda dicho en el historial.
 *  - Administración (REGISTRA o JEFATURA en su lista: la Encargada de
 *    Administración) lo recibe, o lo devuelve al área con una observación.
 *
 * Un reporte MENSUAL por área y mes; además, los EXTRAORDINARIOS que hagan
 * falta. El contenido es una plantilla común para las cuatro áreas (resumen,
 * actividades, indicadores, dificultades, pendientes y respaldos) más lo que
 * SIGSO ya sabe del mes (`resumen_auto`: matrices, tareas y solicitudes del
 * equipo), que se congela al enviarlo para que lo validado no cambie después.
 *
 * Permisos: los de los módulos de departamento (controlInterno.acceso_). El
 * historial va a CI_HISTORIAL (registro_id = reporte_id).
 */

const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { DEPARTAMENTOS, MATRICES } = require('./controlInternoMatrices');
const CI = require('./controlInterno');
const P = require('./controlInternoPlanillas');
const NotificacionesApp = require('./notificacionesApp');
const Notificaciones = require('./notificaciones');
const { ESTADOS_CERRADOS } = require('./constantesSolicitudes');

const E = { BORRADOR: 'BORRADOR', EN_REVISION: 'EN_REVISION', OBSERVADO: 'OBSERVADO', VALIDADO: 'VALIDADO', RECIBIDO: 'RECIBIDO' };
const ETIQUETAS = {
  SIN_INICIAR: 'Sin iniciar', BORRADOR: 'En preparación', EN_REVISION: 'Por validar (jefatura)',
  OBSERVADO: 'Devuelto con observaciones', VALIDADO: 'Por recibir (Administración)', RECIBIDO: 'Recibido'
};
const TIPOS = ['MENSUAL', 'EXTRAORDINARIO'];
const TOPE = { texto: 4000, filas: 200, indicadores: 50, celda: 300, observacion: 1000 };
const LISTADO_TAREAS = 60;

// --- utilidades ------------------------------------------------------------------------------
function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }
function normalizarEmail_(e) { return String(e || '').trim().toLowerCase(); }
function ahora_() { return new Date().toISOString(); }
function hoy_() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
function leer_(db, tabla) { try { return leerFilas_(db, tabla, COLUMNAS[tabla]); } catch (e) { return []; } }
function json_(v, porDefecto) {
  if (v && typeof v === 'object') return v;
  try { return v ? JSON.parse(v) : porDefecto; } catch (e) { return porDefecto; }
}
function mesDe_(periodo) { const m = /^(\d{4})-M(\d{2})$/.exec(periodo || ''); return m ? m[1] + '-' + m[2] : ''; }
function depto_(clave) { return DEPARTAMENTOS.find((d) => d.clave === clave) || null; }
const AREAS = DEPARTAMENTOS.filter((d) => !d.recibe);
const ADMINISTRACION = DEPARTAMENTOS.find((d) => d.recibe);

/** Quiénes están en la lista de un área, por rol. */
function personas_(db, depto) {
  const ms = CI.miembros_(db).filter((m) => m.depto === depto);
  const de = (rol) => ms.filter((m) => !rol || m.rol === rol).map((m) => normalizarEmail_(m.usuario_email));
  return { todos: de(''), jefaturas: de('JEFATURA'), registran: ms.filter((m) => m.rol !== 'LECTURA').map((m) => normalizarEmail_(m.usuario_email)) };
}

// --- contenido (plantilla común) -----------------------------------------------------------------
function texto_(v, tope) { return P.sinClaves_(String(v == null ? '' : v)).trim().slice(0, tope || TOPE.texto); }
function filas_(lista, campos, tope) {
  return (Array.isArray(lista) ? lista : []).map((f) => {
    const o = {};
    campos.forEach((c) => { o[c] = texto_(f && f[c], TOPE.celda); });
    return o;
  }).filter((o) => campos.some((c) => o[c])).slice(0, tope);
}
function limpiarContenido_(c) {
  c = c || {};
  return {
    resumen: texto_(c.resumen),
    actividades: filas_(c.actividades, ['cliente', 'actividad', 'fecha', 'estado', 'observacion'], TOPE.filas),
    indicadores: filas_(c.indicadores, ['indicador', 'meta', 'resultado', 'comentario'], TOPE.indicadores),
    dificultades: texto_(c.dificultades),
    pendientes: texto_(c.pendientes),
    respaldos: texto_(c.respaldos)
  };
}

// --- lo que SIGSO ya sabe del mes ----------------------------------------------------------------
function resumenAuto_(db, depto, periodo) {
  const mes = mesDe_(periodo);
  const equipo = personas_(db, depto).todos;
  const enEquipo = (e) => equipo.indexOf(normalizarEmail_(e)) !== -1;
  // Matrices del área (Contabilidad y RR.HH.).
  const matrices = MATRICES.filter((m) => m.depto === depto && m.tipo !== 'lista' && !m.sinUso).map((m) => {
    const r = CI.resumen_(m, CI.filasDelResumen_(db, m, periodo));
    return { clave: m.clave, nombre: m.nombre, seccion: m.seccion, total: r.total, terminadas: r.finalizados, pendientes: r.pendientes, por_liberar: r.por_liberar, liberadas: r.liberados };
  }).filter((x) => x.total);
  // Tareas (Mi trabajo y Proyectos) de las personas del área.
  const hoy = hoy_();
  const tareas = leer_(db, 'ACTIVIDADES').filter((a) => esVerdadero_(a.activa) && enEquipo(a.responsable_email));
  const abierta = (a) => a.estado !== 'TERMINADA' && a.estado !== 'CANCELADA';
  const terminadasMes = tareas.filter((a) => a.estado === 'TERMINADA' && String(a.fecha_terminada || '').slice(0, 7) === mes)
    .sort((a, b) => String(a.fecha_terminada).localeCompare(String(b.fecha_terminada)));
  const abiertas = tareas.filter(abierta);
  // Solicitudes atendidas por el área.
  const subs = leer_(db, 'SUBSOLICITUDES').filter((s) => enEquipo(s.desarrollador_asignado) || enEquipo(s.atencion_resuelto_por));
  const cerrada = (s) => ESTADOS_CERRADOS.indexOf(s.estado) !== -1;
  return {
    periodo, generado: ahora_(), personas: equipo.length,
    matrices,
    tareas: {
      terminadas: terminadasMes.length,
      abiertas: abiertas.length,
      atrasadas: abiertas.filter((a) => a.fecha_compromiso && String(a.fecha_compromiso).slice(0, 10) < hoy).length,
      lista: terminadasMes.slice(0, LISTADO_TAREAS).map((a) => ({ titulo: a.titulo, responsable: normalizarEmail_(a.responsable_email), fecha: String(a.fecha_terminada || '').slice(0, 10) })),
      mas: Math.max(0, terminadasMes.length - LISTADO_TAREAS)
    },
    solicitudes: {
      cerradas: subs.filter((s) => cerrada(s) && String(s.fecha_terminada || s.atencion_fecha_resolucion || '').slice(0, 7) === mes).length,
      abiertas: subs.filter((s) => !cerrada(s)).length
    }
  };
}

// --- permisos ------------------------------------------------------------------------------------
function permisos_(db, contexto, depto) {
  const ac = CI.acceso_(db, contexto);
  const p = ac.deptos[depto] || {};
  const adm = ac.deptos[ADMINISTRACION.clave] || {};
  return {
    ve: !!p.ve || !!adm.ve,           // Administración ve los reportes de todas las áreas
    registra: !!p.registra,
    jefatura: !!p.jefatura,
    recibe: !!adm.registra,          // Encargada de Administración (o ADM)
    esAdmin: ac.esAdmin, email: ac.email
  };
}

// --- lectura -------------------------------------------------------------------------------------
function reportes_(db) { return leer_(db, 'DEP_REPORTES').filter((r) => esVerdadero_(r.activa)); }
function publico_(r) {
  return {
    reporte_id: r.reporte_id, depto: r.depto, depto_nombre: (depto_(r.depto) || {}).nombre || r.depto,
    periodo: r.periodo, tipo: r.tipo, titulo: r.titulo, estado: r.estado, estado_texto: ETIQUETAS[r.estado] || r.estado,
    autor_email: r.autor_email, fecha_envio: r.fecha_envio,
    validado_por: r.validado_por, fecha_validacion: r.fecha_validacion, observacion_jefatura: r.observacion_jefatura,
    recibido_por: r.recibido_por, fecha_recepcion: r.fecha_recepcion, observacion_administracion: r.observacion_administracion,
    devuelto_por: r.devuelto_por, fecha_devolucion: r.fecha_devolucion, motivo_devolucion: r.motivo_devolucion,
    creado_por: r.creado_por, fecha_creacion: r.fecha_creacion, fecha_actualizacion: r.fecha_actualizacion
  };
}
function historial_(db, id) {
  return leer_(db, 'CI_HISTORIAL').filter((h) => h.registro_id === id)
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
    .map((h) => ({ accion: h.accion, detalle: h.detalle, usuario_email: h.usuario_email, fecha: h.fecha }));
}
function acciones_(r, pm) {
  const editable = r.estado === E.BORRADOR || r.estado === E.OBSERVADO;
  return {
    editar: editable && pm.registra,
    enviar: editable && pm.registra,
    validar: r.estado === E.EN_REVISION && pm.jefatura,
    devolver: (r.estado === E.EN_REVISION && pm.jefatura) || (r.estado === E.VALIDADO && pm.recibe),
    recibir: r.estado === E.VALIDADO && pm.recibe
  };
}

/** Los reportes de un área (un año), o de todas las que ve si es Administración. */
function listar(db, data, contexto) {
  const d = data || {};
  const dep = depto_(d.depto);
  if (!dep || dep.recibe) return { ok: false, message: 'Elige un área.' };
  const pm = permisos_(db, contexto, dep.clave);
  if (!pm.ve) return { _forbidden: true, message: 'No tienes acceso a ' + dep.nombre + '.' };
  const anio = /^\d{4}$/.test(String(d.anio || '')) ? String(d.anio) : hoy_().slice(0, 4);
  const lista = reportes_(db).filter((r) => r.depto === dep.clave && String(r.periodo).slice(0, 4) === anio)
    .sort((a, b) => String(b.periodo).localeCompare(String(a.periodo)) || String(b.fecha_creacion).localeCompare(String(a.fecha_creacion)));
  const equipo = personas_(db, dep.clave);
  return { depto: dep.clave, anio, reportes: lista.map(publico_), puede: { registra: pm.registra, jefatura: pm.jefatura, recibe: pm.recibe }, jefaturas: equipo.jefaturas };
}

/**
 * Un reporte: por id, o el MENSUAL de un área y mes (si todavía no existe,
 * la plantilla vacía para empezarlo). Trae lo que SIGSO sabe del mes: en vivo
 * mientras se prepara, congelado desde que se envió.
 */
function obtener(db, data, contexto) {
  const d = data || {};
  let r = null;
  if (d.reporte_id) {
    r = reportes_(db).find((x) => x.reporte_id === d.reporte_id) || null;
    if (!r) return { ok: false, message: 'Ese reporte no existe.' };
  }
  const dep = depto_(r ? r.depto : d.depto);
  if (!dep || dep.recibe) return { ok: false, message: 'Elige un área.' };
  const periodo = r ? r.periodo : String(d.periodo || '');
  if (!CI.RE_PERIODO.test(periodo)) return { ok: false, message: 'Mes no válido.' };
  const pm = permisos_(db, contexto, dep.clave);
  if (!pm.ve) return { _forbidden: true, message: 'No tienes acceso a ' + dep.nombre + '.' };
  if (!r) r = reportes_(db).find((x) => x.depto === dep.clave && x.periodo === periodo && x.tipo === 'MENSUAL') || null;
  const enviado = r && r.estado !== E.BORRADOR && r.estado !== E.OBSERVADO;
  const auto = enviado && r.resumen_auto ? json_(r.resumen_auto, null) : resumenAuto_(db, dep.clave, periodo);
  const equipo = personas_(db, dep.clave);
  if (!r) {
    return {
      nuevo: true, reporte: { depto: dep.clave, depto_nombre: dep.nombre, periodo, tipo: 'MENSUAL', estado: 'SIN_INICIAR', estado_texto: ETIQUETAS.SIN_INICIAR },
      contenido: limpiarContenido_({}), auto, historial: [], jefaturas: equipo.jefaturas,
      acciones: { editar: pm.registra, enviar: pm.registra, validar: false, devolver: false, recibir: false }
    };
  }
  return {
    reporte: publico_(r), contenido: limpiarContenido_(json_(r.contenido, {})), auto, congelado: !!enviado,
    historial: historial_(db, r.reporte_id), jefaturas: equipo.jefaturas, acciones: acciones_(r, pm)
  };
}

// --- escritura -----------------------------------------------------------------------------------
function reportePara_(db, d, contexto, pm) {
  if (d.reporte_id) {
    const r = reportes_(db).find((x) => x.reporte_id === d.reporte_id);
    if (!r) return { error: { ok: false, message: 'Ese reporte no existe.' } };
    return { r };
  }
  const dep = depto_(d.depto);
  const tipo = TIPOS.indexOf(d.tipo) !== -1 ? d.tipo : 'MENSUAL';
  if (!dep || dep.recibe) return { error: { ok: false, message: 'Elige un área.' } };
  if (!CI.RE_PERIODO.test(String(d.periodo || ''))) return { error: { ok: false, message: 'Mes no válido.' } };
  if (tipo === 'MENSUAL') {
    const ya = reportes_(db).find((x) => x.depto === dep.clave && x.periodo === d.periodo && x.tipo === 'MENSUAL');
    if (ya) return { r: ya };
  }
  if (!pm.registra) return { error: { _forbidden: true, message: 'En ' + dep.nombre + ' tienes acceso de solo lectura.' } };
  const titulo = texto_(d.titulo, 120) || (tipo === 'MENSUAL' ? 'Reporte mensual' : 'Reporte extraordinario');
  const fila = {
    reporte_id: CI.uuid_(), depto: dep.clave, periodo: d.periodo, tipo, titulo, estado: E.BORRADOR,
    contenido: JSON.stringify(limpiarContenido_({})), resumen_auto: '',
    autor_email: '', fecha_envio: '', validado_por: '', fecha_validacion: '', observacion_jefatura: '',
    recibido_por: '', fecha_recepcion: '', observacion_administracion: '', devuelto_por: '', fecha_devolucion: '', motivo_devolucion: '',
    creado_por: normalizarEmail_(contexto && contexto.email), fecha_creacion: ahora_(), actualizado_por: '', fecha_actualizacion: '', activa: true
  };
  agregarFila_(db, 'DEP_REPORTES', fila);
  CI.historial_(db, fila.reporte_id, 'REPORTE_CREADO', titulo + ' de ' + dep.nombre + ' (' + CI.periodoTexto_(d.periodo) + ')', contexto);
  return { r: fila, creado: true };
}
function actualizar_(db, r, cambios, contexto) {
  const c = Object.assign({ actualizado_por: normalizarEmail_(contexto && contexto.email), fecha_actualizacion: ahora_() }, cambios);
  actualizarFilaPorId_(db, 'DEP_REPORTES', 'reporte_id', r.reporte_id, c);
  return Object.assign({}, r, c);
}

/** Guarda lo escrito (crea el reporte si no existe). Solo mientras está en preparación o devuelto. */
function guardar(db, data, contexto, interno) {
  const d = data || {};
  const depClave = d.reporte_id ? ((reportes_(db).find((x) => x.reporte_id === d.reporte_id) || {}).depto) : d.depto;
  const pm = permisos_(db, contexto, depClave);
  if (!pm.ve) return { _forbidden: true, message: 'No tienes acceso a esa área.' };
  const x = reportePara_(db, d, contexto, pm);
  if (x.error) return x.error;
  let r = x.r;
  if (!pm.registra) return { _forbidden: true, message: 'Tienes acceso de solo lectura en esta área.' };
  if (r.estado !== E.BORRADOR && r.estado !== E.OBSERVADO) return { ok: false, message: 'Este reporte ya se envió: no se puede cambiar.' };
  const contenido = limpiarContenido_(d.contenido);
  const cambios = { contenido: JSON.stringify(contenido) };
  if (d.titulo && r.tipo === 'EXTRAORDINARIO') cambios.titulo = texto_(d.titulo, 120);
  r = actualizar_(db, r, cambios, contexto);
  // Al enviar no se anota aparte: el envío ya queda en el historial.
  if (!x.creado && !interno) CI.historial_(db, r.reporte_id, 'REPORTE_EDITADO', 'Guardó el borrador.', contexto);
  return { ok: true, reporte: publico_(r), message: 'Borrador guardado.' };
}

/** Avisos en SIGSO y por correo; nunca rompen la acción principal. */
function avisar_(db, destinatarios, titulo, mensaje, moduloId, evento, idAviso) {
  const unicos = destinatarios.map(normalizarEmail_).filter((e, i, a) => e && a.indexOf(e) === i);
  if (!unicos.length) return;
  NotificacionesApp.encolarLote(db, unicos.map((e) => ({ destinatario: e, tipo: 'DEP_REPORTE', titulo, mensaje, modulo_id: moduloId, texto_accion: 'Ver el reporte', vidaHoras: 24 * 7 })));
  unicos.forEach((e) => {
    try {
      Promise.resolve(Notificaciones.enviarCorreoModulo(db, { solicitudId: 'DEP_REPORTE:' + idAviso, destinatario: e, evento, asunto: titulo, cuerpo: mensaje + '\n\nÁbrelo en SIGSO, módulo ' + ((DEPARTAMENTOS.find((d) => d.modulo === moduloId) || {}).nombre || 'del área') + '.' }))
        .catch(() => null);
    } catch (err) { /* el correo es un extra */ }
  });
}
function nombreDe_(r) { return r.titulo + ' de ' + ((depto_(r.depto) || {}).nombre || r.depto) + ' · ' + CI.periodoTexto_(r.periodo); }

/** El área lo envía a su jefatura (si lo envía la jefatura, queda validado). */
function enviar(db, data, contexto) {
  const d = data || {};
  const g = d.contenido ? guardar(db, d, contexto, true) : null;
  if (g && g.ok === false) return g;
  if (g && (g._forbidden || g._validationError)) return g;
  const id = (g && g.reporte && g.reporte.reporte_id) || d.reporte_id;
  const r = reportes_(db).find((x) => x.reporte_id === id);
  if (!r) return { ok: false, message: 'Guarda el reporte antes de enviarlo.' };
  const pm = permisos_(db, contexto, r.depto);
  if (!pm.registra) return { _forbidden: true, message: 'Tienes acceso de solo lectura en esta área.' };
  if (r.estado !== E.BORRADOR && r.estado !== E.OBSERVADO) return { ok: false, message: 'Este reporte ya se envió.' };
  const c = limpiarContenido_(json_(r.contenido, {}));
  if (!c.resumen) return { ok: false, message: 'Escribe el resumen del mes antes de enviarlo.' };
  const dep = depto_(r.depto);
  const equipo = personas_(db, r.depto);
  const yo = normalizarEmail_(contexto && contexto.email);
  const base = { autor_email: yo, fecha_envio: ahora_(), resumen_auto: JSON.stringify(resumenAuto_(db, r.depto, r.periodo)), devuelto_por: '', fecha_devolucion: '', motivo_devolucion: '' };
  // La jefatura que envía su propio reporte: no hay a quién más pedirle la validación.
  if (pm.jefatura) {
    const v = actualizar_(db, r, Object.assign(base, { estado: E.VALIDADO, validado_por: yo, fecha_validacion: ahora_(), observacion_jefatura: '' }), contexto);
    CI.historial_(db, r.reporte_id, 'REPORTE_VALIDADO', 'Lo envió la jefatura del área: queda validado y entregado a Administración.', contexto);
    avisar_(db, personas_(db, ADMINISTRACION.clave).registran, 'Reporte por recibir: ' + nombreDe_(r), 'La jefatura de ' + dep.nombre + ' entregó su reporte de ' + CI.periodoTexto_(r.periodo) + '.', ADMINISTRACION.modulo, 'DEP_REPORTE_VALIDADO', r.reporte_id + ':v:' + v.fecha_validacion);
    return { ok: true, reporte: publico_(v), message: 'Enviado y entregado a Administración (lo envió la jefatura del área).' };
  }
  if (!equipo.jefaturas.length) return { ok: false, message: dep.nombre + ' todavía no tiene jefatura asignada: pide al administrador que la marque en Accesos del área.' };
  const v = actualizar_(db, r, Object.assign(base, { estado: E.EN_REVISION, validado_por: '', fecha_validacion: '' }), contexto);
  CI.historial_(db, r.reporte_id, 'REPORTE_ENVIADO', r.estado === E.OBSERVADO ? 'Lo corrigió y lo volvió a enviar a la jefatura.' : 'Lo envió a la jefatura del área.', contexto);
  avisar_(db, equipo.jefaturas, 'Reporte por validar: ' + nombreDe_(r), 'Tu área envió su reporte de ' + CI.periodoTexto_(r.periodo) + '. Revísalo y valídalo, o devuélvelo con tus observaciones.', dep.modulo, 'DEP_REPORTE_ENVIADO', r.reporte_id + ':e:' + v.fecha_envio);
  return { ok: true, reporte: publico_(v), message: 'Enviado a la jefatura del área.' };
}

/** La jefatura del área lo valida: queda entregado a Administración. */
function validar(db, data, contexto) {
  const d = data || {};
  const r = reportes_(db).find((x) => x.reporte_id === d.reporte_id);
  if (!r) return { ok: false, message: 'Ese reporte no existe.' };
  const pm = permisos_(db, contexto, r.depto);
  if (!pm.jefatura) return { _forbidden: true, message: 'Solo la jefatura del área valida su reporte.' };
  if (r.estado !== E.EN_REVISION) return { ok: false, message: 'Este reporte no está esperando validación.' };
  const obs = texto_(d.observacion, TOPE.observacion);
  const v = actualizar_(db, r, { estado: E.VALIDADO, validado_por: pm.email, fecha_validacion: ahora_(), observacion_jefatura: obs }, contexto);
  CI.historial_(db, r.reporte_id, 'REPORTE_VALIDADO', 'Validado por la jefatura y entregado a Administración.' + (obs ? ' Nota: ' + obs : ''), contexto);
  const dep = depto_(r.depto);
  avisar_(db, personas_(db, ADMINISTRACION.clave).registran, 'Reporte por recibir: ' + nombreDe_(r), 'La jefatura de ' + dep.nombre + ' validó el reporte de ' + CI.periodoTexto_(r.periodo) + ' y te lo entregó.', ADMINISTRACION.modulo, 'DEP_REPORTE_VALIDADO', r.reporte_id + ':v:' + v.fecha_validacion);
  avisar_(db, [r.autor_email], 'Reporte validado: ' + nombreDe_(r), 'Tu jefatura validó el reporte y lo entregó a Administración.' + (obs ? '\nNota: ' + obs : ''), dep.modulo, 'DEP_REPORTE_VALIDADO_AREA', r.reporte_id + ':va:' + v.fecha_validacion);
  return { ok: true, reporte: publico_(v), message: 'Validado y entregado a Administración.' };
}

/** Lo devuelve al área con una observación: la jefatura (al revisarlo) o Administración (al recibirlo). */
function devolver(db, data, contexto) {
  const d = data || {};
  const r = reportes_(db).find((x) => x.reporte_id === d.reporte_id);
  if (!r) return { ok: false, message: 'Ese reporte no existe.' };
  const pm = permisos_(db, contexto, r.depto);
  const quien = r.estado === E.EN_REVISION && pm.jefatura ? 'la jefatura' : (r.estado === E.VALIDADO && pm.recibe ? 'Administración' : '');
  if (!quien) {
    if (r.estado !== E.EN_REVISION && r.estado !== E.VALIDADO) return { ok: false, message: 'Este reporte no se puede devolver en su estado actual.' };
    return { _forbidden: true, message: r.estado === E.EN_REVISION ? 'Solo la jefatura del área lo devuelve.' : 'Solo Administración lo devuelve.' };
  }
  const motivo = texto_(d.observacion, TOPE.observacion);
  if (!motivo) return { ok: false, message: 'Escribe qué hay que corregir.' };
  const v = actualizar_(db, r, { estado: E.OBSERVADO, devuelto_por: pm.email, fecha_devolucion: ahora_(), motivo_devolucion: motivo }, contexto);
  CI.historial_(db, r.reporte_id, 'REPORTE_DEVUELTO', 'Devuelto por ' + quien + ': ' + motivo, contexto);
  const dep = depto_(r.depto);
  const a = [r.autor_email].concat(quien === 'Administración' ? personas_(db, r.depto).jefaturas : []);
  avisar_(db, a, 'Reporte devuelto: ' + nombreDe_(r), (quien === 'Administración' ? 'Administración' : 'Tu jefatura') + ' devolvió el reporte con esta observación:\n' + motivo, dep.modulo, 'DEP_REPORTE_DEVUELTO', r.reporte_id + ':d:' + v.fecha_devolucion);
  return { ok: true, reporte: publico_(v), message: 'Devuelto al área con tu observación.' };
}

/** Administración lo recibe: el reporte queda cerrado. */
function recibir(db, data, contexto) {
  const d = data || {};
  const r = reportes_(db).find((x) => x.reporte_id === d.reporte_id);
  if (!r) return { ok: false, message: 'Ese reporte no existe.' };
  const pm = permisos_(db, contexto, r.depto);
  if (!pm.recibe) return { _forbidden: true, message: 'Solo Administración recibe los reportes.' };
  if (r.estado !== E.VALIDADO) return { ok: false, message: 'Este reporte no está esperando recepción.' };
  const obs = texto_(d.observacion, TOPE.observacion);
  const v = actualizar_(db, r, { estado: E.RECIBIDO, recibido_por: pm.email, fecha_recepcion: ahora_(), observacion_administracion: obs }, contexto);
  CI.historial_(db, r.reporte_id, 'REPORTE_RECIBIDO', 'Recibido por Administración.' + (obs ? ' Nota: ' + obs : ''), contexto);
  const dep = depto_(r.depto);
  avisar_(db, [r.autor_email].concat(personas_(db, r.depto).jefaturas), 'Reporte recibido: ' + nombreDe_(r), 'Administración recibió el reporte.' + (obs ? '\nNota: ' + obs : ''), dep.modulo, 'DEP_REPORTE_RECIBIDO', r.reporte_id + ':r:' + v.fecha_recepcion);
  return { ok: true, reporte: publico_(v), message: 'Recibido.' };
}

/**
 * Administración: cómo vienen los reportes de las cuatro áreas. El mes
 * elegido (un estado por área), los últimos 6 meses en una grilla y lo que
 * está esperando recepción, de cualquier mes.
 */
function panel(db, data, contexto) {
  const ac = CI.acceso_(db, contexto);
  if (!(ac.deptos[ADMINISTRACION.clave] || {}).ve) return { _forbidden: true, message: 'No tienes acceso a Administración.' };
  const periodo = CI.RE_PERIODO.test(String((data && data.periodo) || '')) ? data.periodo : CI.moverPeriodo_(CI.periodoActual_(), -1);
  const todos = reportes_(db);
  const meses = [];
  for (let i = 5; i >= 0; i--) meses.push(CI.moverPeriodo_(periodo, -i));
  const mensual = (dep, per) => todos.find((r) => r.depto === dep && r.periodo === per && r.tipo === 'MENSUAL') || null;
  const areas = AREAS.map((dep) => {
    const r = mensual(dep.clave, periodo);
    const eq = personas_(db, dep.clave);
    return {
      depto: dep.clave, nombre: dep.nombre, modulo: dep.modulo, icono: dep.icono,
      jefaturas: eq.jefaturas, personas: eq.todos.length,
      reporte: r ? publico_(r) : null, estado: r ? r.estado : 'SIN_INICIAR', estado_texto: ETIQUETAS[r ? r.estado : 'SIN_INICIAR'],
      extraordinarios: todos.filter((x) => x.depto === dep.clave && x.periodo === periodo && x.tipo === 'EXTRAORDINARIO').map(publico_),
      historia: meses.map((per) => { const x = mensual(dep.clave, per); return { periodo: per, estado: x ? x.estado : 'SIN_INICIAR', reporte_id: x ? x.reporte_id : '' }; })
    };
  });
  const porRecibir = todos.filter((r) => r.estado === E.VALIDADO).sort((a, b) => String(a.fecha_validacion).localeCompare(String(b.fecha_validacion))).map(publico_);
  return {
    periodo, meses, areas, por_recibir: porRecibir,
    cuenta: { recibidos: areas.filter((a) => a.estado === E.RECIBIDO).length, por_recibir: areas.filter((a) => a.estado === E.VALIDADO).length, total: areas.length },
    puede_recibir: !!(ac.deptos[ADMINISTRACION.clave] || {}).registra,
    etiquetas: ETIQUETAS
  };
}

/** Lo que espera a esta persona (para el resumen de cada área y los contadores del menú). */
function pendientes(db, data, contexto) {
  const ac = CI.acceso_(db, contexto);
  const todos = reportes_(db);
  const out = {};
  DEPARTAMENTOS.forEach((dep) => {
    const p = ac.deptos[dep.clave] || {};
    if (!p.ve) return;
    if (dep.recibe) { out[dep.modulo] = p.registra ? todos.filter((r) => r.estado === E.VALIDADO).length : 0; return; }
    out[dep.modulo] = (p.jefatura ? todos.filter((r) => r.depto === dep.clave && r.estado === E.EN_REVISION).length : 0) +
      (p.registra ? todos.filter((r) => r.depto === dep.clave && r.estado === E.OBSERVADO).length : 0);
  });
  return { pendientes: out };
}

module.exports = { listar, obtener, guardar, enviar, validar, devolver, recibir, panel, pendientes, resumenAuto_, ESTADOS: E, ETIQUETAS };
