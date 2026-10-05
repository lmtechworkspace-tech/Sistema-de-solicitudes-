'use strict';

/**
 * informesGestion.js — el INFORME DE GESTIÓN del mes y su cadena de firmas
 * (2026-10-03, aprobado por el dueño). Es la continuación de los reportes
 * de cada área (departamentosReportes.js):
 *
 *   1. Persona operativa prepara el reporte del área         (día hábil 3)
 *   2. Jefatura del área lo valida                            (día hábil 5)
 *   3. Encargada de Administración recibe los de las áreas
 *      y envía el informe de gestión a Finanzas y Cobranzas    (día hábil 6)
 *   4. Gte. Adm. y Finanzas + Enc. Facturación y Cobranzas
 *      lo aprueban (las dos, en paralelo)                      (día hábil 8)
 *   5. Analista de Control: filtro final, conclusión y
 *      decisiones que se le piden a gerencia                   (día hábil 9)
 *   6. Gerencia lo lee y cierra con sus decisiones             (día hábil 10)
 *
 * Estados: PREPARACION → EN_FINANZAS → EN_CONTROL → EN_GERENCIA → CERRADO.
 * Cada paso puede devolverlo al anterior con una observación obligatoria y
 * dejar un comentario opcional que viaja hasta gerencia.
 *
 * Al enviarlo a Finanzas se CONGELA el snapshot (indicadores, alertas y el
 * estado de los reportes de las áreas): desde ahí todos ven las mismas
 * cifras. La Gte. de Administración y Finanzas que además es jefatura de
 * Contabilidad aprueba una sola vez en Finanzas (decisión del dueño): su
 * validación como jefatura queda indicada en el informe.
 *
 * Quién ocupa cada paso: Administración = la lista de su departamento
 * (REGISTRA/JEFATURA); FINANZAS, COBRANZAS, CONTROL y GERENCIA = DEP_CADENA,
 * que reparte el administrador.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { DEPARTAMENTOS } = require('./controlInternoMatrices');
const CI = require('./controlInterno');
const Indicadores = require('./indicadoresDepto');
const Cumplimiento = require('./cumplimiento');
const NotificacionesApp = require('./notificacionesApp');
const Notificaciones = require('./notificaciones');

const E = { PREPARACION: 'PREPARACION', EN_FINANZAS: 'EN_FINANZAS', EN_CONTROL: 'EN_CONTROL', EN_GERENCIA: 'EN_GERENCIA', CERRADO: 'CERRADO' };
const ETIQUETAS = { SIN_INICIAR: 'Sin iniciar', PREPARACION: 'En preparación (Administración)', EN_FINANZAS: 'En revisión de Finanzas y Cobranzas', EN_CONTROL: 'En revisión de Control', EN_GERENCIA: 'En Gerencia', CERRADO: 'Cerrado por Gerencia' };
const ROLES = ['FINANZAS', 'COBRANZAS', 'CONTROL', 'GERENCIA'];
const ROL_TXT = { ADMINISTRACION: 'Encargada de Administración', FINANZAS: 'Gte. Adm. y Finanzas', COBRANZAS: 'Enc. Facturación y Cobranzas', CONTROL: 'Analista de Control', GERENCIA: 'Gerencia' };
// Plazo de cada paso, en días hábiles del mes siguiente al informado.
const PLAZOS = [
  { paso: 1, clave: 'OPERATIVO', nombre: 'El área prepara su reporte', dia: 3 },
  { paso: 2, clave: 'JEFATURA', nombre: 'La jefatura lo valida', dia: 5 },
  { paso: 3, clave: 'ADMINISTRACION', nombre: 'Administración consolida y envía', dia: 6 },
  { paso: 4, clave: 'FINANZAS', nombre: 'Finanzas y Cobranzas aprueban', dia: 8 },
  { paso: 5, clave: 'CONTROL', nombre: 'Control revisa y propone decisiones', dia: 9 },
  { paso: 6, clave: 'GERENCIA', nombre: 'Gerencia decide', dia: 10 }
];
const TOPE = { texto: 2000, decisiones: 20 };

function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }
function norm_(e) { return String(e || '').trim().toLowerCase(); }
function ahora_() { return new Date().toISOString(); }
function hoy_() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
function leer_(db, t) { try { return leerFilas_(db, t, COLUMNAS[t]); } catch (e) { return []; } }
function json_(v, d) { if (v && typeof v === 'object') return v; try { return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function texto_(v, tope) { return String(v == null ? '' : v).replace(/\s+$/, '').trim().slice(0, tope || TOPE.texto); }

/** Fecha del n-ésimo día hábil del mes siguiente al período. */
function diaHabil_(periodo, n, feriados) {
  const a = Number(periodo.slice(0, 4)), m = Number(periodo.slice(6));
  let d = new Date(Date.UTC(m === 12 ? a + 1 : a, m === 12 ? 0 : m, 1)), k = 0;
  for (;;) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !feriados.has(d.toISOString().slice(0, 10))) { k++; if (k === n) return d.toISOString().slice(0, 10); }
    d = new Date(d.getTime() + 864e5);
  }
}
function plazos_(db, periodo) {
  let fer = [];
  try { fer = Cumplimiento.obtenerFeriados(db).map((f) => String(f).slice(0, 10)); } catch (e) { /* */ }
  const s = new Set(fer);
  return PLAZOS.map((p) => Object.assign({}, p, { fecha: diaHabil_(periodo, p.dia, s) }));
}

// --- quién es quién ---------------------------------------------------------------------------
function cadena_(db) {
  const filas = leer_(db, 'DEP_CADENA').filter((f) => esVerdadero_(f.activa));
  const o = {};
  ROLES.forEach((r) => { o[r] = filas.filter((f) => f.rol === r).map((f) => norm_(f.usuario_email)); });
  o.ADMINISTRACION = CI.miembros_(db).filter((m) => m.depto === 'ADMINISTRACION' && m.rol !== 'LECTURA').map((m) => norm_(m.usuario_email));
  return o;
}
function quienSoy_(db, contexto) {
  const email = norm_(contexto && contexto.email);
  const c = cadena_(db);
  const esAdmin = !!contexto && contexto.rol === 'ADM';
  const roles = Object.keys(c).filter((r) => c[r].includes(email));
  const ac = CI.acceso_(db, contexto);
  return { email, esAdmin, roles, cadena: c, ve: esAdmin || roles.length > 0 || !!(ac.deptos.ADMINISTRACION || {}).ve };
}
function tiene_(yo, rol) { return yo.esAdmin || yo.roles.includes(rol); }

// --- lectura ----------------------------------------------------------------------------------------
function informe_(db, periodo) { return leer_(db, 'DEP_INFORMES').find((r) => esVerdadero_(r.activa) && r.periodo === periodo) || null; }
function reportesAreas_(db, periodo) {
  const todos = leer_(db, 'DEP_REPORTES').filter((r) => esVerdadero_(r.activa) && r.periodo === periodo);
  return DEPARTAMENTOS.filter((d) => !d.recibe && d.reporta !== false).map((d) => {
    const r = todos.find((x) => x.depto === d.clave && x.tipo === 'MENSUAL');
    return { depto: d.clave, nombre: d.nombre, modulo: d.modulo, reporte_id: r ? r.reporte_id : '', estado: r ? r.estado : 'SIN_INICIAR',
      autor_email: r ? r.autor_email : '', validado_por: r ? r.validado_por : '', recibido_por: r ? r.recibido_por : '',
      fecha_envio: r ? r.fecha_envio : '', fecha_validacion: r ? r.fecha_validacion : '', fecha_recepcion: r ? r.fecha_recepcion : '',
      observacion_jefatura: r ? r.observacion_jefatura : '', observacion_administracion: r ? r.observacion_administracion : '',
      comentario_area: r ? texto_((json_(r.contenido, {}) || {}).resumen || '', 600) : '' };
  });
}
function acciones_(inf, yo) {
  const e = inf ? inf.estado : 'SIN_INICIAR';
  const aprob = inf ? json_(inf.aprobaciones, {}) : {};
  const puedeAprobar = (rol) => e === E.EN_FINANZAS && tiene_(yo, rol) && !aprob[rol];
  return {
    enviar_finanzas: (e === 'SIN_INICIAR' || e === E.PREPARACION) && tiene_(yo, 'ADMINISTRACION'),
    aprobar_finanzas: puedeAprobar('FINANZAS'),
    aprobar_cobranzas: puedeAprobar('COBRANZAS'),
    enviar_gerencia: e === E.EN_CONTROL && tiene_(yo, 'CONTROL'),
    editar_decisiones: (e === E.EN_CONTROL && tiene_(yo, 'CONTROL')) || (e === E.EN_GERENCIA && tiene_(yo, 'GERENCIA')),
    cerrar: e === E.EN_GERENCIA && tiene_(yo, 'GERENCIA'),
    devolver: (e === E.EN_FINANZAS && (tiene_(yo, 'FINANZAS') || tiene_(yo, 'COBRANZAS'))) || (e === E.EN_CONTROL && tiene_(yo, 'CONTROL')) || (e === E.EN_GERENCIA && tiene_(yo, 'GERENCIA')),
    comentar: !!inf && e !== E.CERRADO && yo.roles.length > 0
  };
}
/** Decisiones sugeridas a partir de las alertas (el Analista de Control las edita). */
function decisionesSugeridas_(snap) {
  return (snap.alertas || []).filter((a) => a.decision).slice(0, 8).map((a) => ({ id: crypto.randomUUID().slice(0, 8), texto: a.decision, origen: a.titulo, area: a.area, responsable: '', plazo: '', estado: 'PROPUESTA' }));
}
function snapshot_(db, periodo) {
  const ej = Indicadores.ejecutivo_(db, periodo);
  return Object.assign({ generado: ahora_(), reportes_areas: reportesAreas_(db, periodo) }, ej);
}

/** El informe del mes: congelado si ya se envió; en preparación, en vivo. */
function obtener(db, data, contexto) {
  const yo = quienSoy_(db, contexto);
  if (!yo.ve) return { _forbidden: true, message: 'No participas en la cadena de reportes.' };
  const periodo = CI.RE_PERIODO.test(String((data && data.periodo) || '')) ? data.periodo : CI.moverPeriodo_(CI.periodoActual_(), -1);
  const inf = informe_(db, periodo);
  const congelado = inf && inf.estado !== E.PREPARACION;
  const snap = congelado ? json_(inf.snapshot, {}) : snapshot_(db, periodo);
  if (congelado) snap.reportes_areas = reportesAreas_(db, periodo); // el estado de las áreas siempre al día
  const plazos = plazos_(db, periodo);
  const hoy = hoy_();
  const pasoActual = !inf ? 3 : ({ PREPARACION: 3, EN_FINANZAS: 4, EN_CONTROL: 5, EN_GERENCIA: 6, CERRADO: 7 })[inf.estado];
  return {
    periodo, estado: inf ? inf.estado : 'SIN_INICIAR', estado_texto: ETIQUETAS[inf ? inf.estado : 'SIN_INICIAR'], congelado: !!congelado,
    informe: inf ? {
      informe_id: inf.informe_id, comentarios: json_(inf.comentarios, []), aprobaciones: json_(inf.aprobaciones, {}), decisiones: json_(inf.decisiones, []),
      conclusion: inf.conclusion || '', fecha_envio_finanzas: inf.fecha_envio_finanzas, fecha_envio_control: inf.fecha_envio_control, fecha_envio_gerencia: inf.fecha_envio_gerencia,
      cerrado_por: inf.cerrado_por, fecha_cierre: inf.fecha_cierre, devuelto_por: inf.devuelto_por, fecha_devolucion: inf.fecha_devolucion, motivo_devolucion: inf.motivo_devolucion
    } : null,
    ejecutivo: snap,
    decisiones_sugeridas: inf && json_(inf.decisiones, []).length ? [] : decisionesSugeridas_(snap),
    // Seguimiento: lo que Gerencia acordó el mes pasado, con su plazo (auditoría · etapa 4).
    decisiones_anteriores: ((informe_(db, CI.moverPeriodo_(periodo, -1)) || {}).decisiones ? json_(informe_(db, CI.moverPeriodo_(periodo, -1)).decisiones, []) : [])
      .filter((x) => x.estado === 'ACORDADA').map((x) => Object.assign({}, x, { vencida: !!(x.plazo && x.plazo < hoy) })),
    plazos: plazos.map((p) => Object.assign({}, p, { vencido: hoy > p.fecha && p.paso >= pasoActual && pasoActual < 7 })),
    cadena: Object.assign({}, yo.cadena), roles_txt: ROL_TXT, yo: { email: yo.email, roles: yo.roles, es_admin: yo.esAdmin },
    acciones: acciones_(inf, yo)
  };
}

// --- escritura ----------------------------------------------------------------------------------------
function actualizar_(db, inf, cambios, contexto) {
  const c = Object.assign({ actualizado_por: norm_(contexto && contexto.email), fecha_actualizacion: ahora_() }, cambios);
  actualizarFilaPorId_(db, 'DEP_INFORMES', 'informe_id', inf.informe_id, c);
  return Object.assign({}, inf, c);
}
function crear_(db, periodo, contexto) {
  const fila = {
    informe_id: crypto.randomUUID(), periodo, estado: E.PREPARACION, snapshot: '', comentarios: '[]', aprobaciones: '{}', decisiones: '[]', conclusion: '',
    fecha_envio_finanzas: '', fecha_envio_control: '', fecha_envio_gerencia: '', cerrado_por: '', fecha_cierre: '', devuelto_por: '', fecha_devolucion: '', motivo_devolucion: '',
    creado_por: norm_(contexto && contexto.email), fecha_creacion: ahora_(), actualizado_por: '', fecha_actualizacion: '', activa: true
  };
  agregarFila_(db, 'DEP_INFORMES', fila);
  CI.historial_(db, fila.informe_id, 'INFORME_CREADO', 'Informe de gestión de ' + CI.periodoTexto_(periodo), contexto);
  return fila;
}
function avisar_(db, emails, titulo, mensaje, idAviso) {
  const unicos = emails.map(norm_).filter((e, i, a) => e && a.indexOf(e) === i);
  if (!unicos.length) return;
  NotificacionesApp.encolarLote(db, unicos.map((e) => ({ destinatario: e, tipo: 'INFORME_GESTION', titulo, mensaje, modulo_id: 'dep_administracion', texto_accion: 'Ver el informe', vidaHoras: 24 * 7 })));
  unicos.forEach((e) => {
    try { Promise.resolve(Notificaciones.enviarCorreoModulo(db, { solicitudId: 'INFORME_GESTION:' + idAviso, destinatario: e, evento: 'INFORME_GESTION', asunto: titulo, cuerpo: mensaje + '\n\nÁbrelo en SIGSO, módulo Administración › Informe de gestión.' })).catch(() => null); } catch (err) { /* el correo es un extra */ }
  });
}
function nombreMes_(periodo) { return 'Informe de gestión de ' + CI.periodoTexto_(periodo); }

/** Comentario opcional de quien participa en la cadena (uno por persona; se puede reescribir). */
function comentar(db, data, contexto) {
  const d = data || {};
  const yo = quienSoy_(db, contexto);
  const inf = informe_(db, String(d.periodo || ''));
  if (!inf) return { ok: false, message: 'El informe de ese mes todavía no se empieza.' };
  if (!yo.roles.length && !yo.esAdmin) return { _forbidden: true, message: 'Solo comenta quien participa en la cadena.' };
  if (inf.estado === E.CERRADO) return { ok: false, message: 'El informe ya está cerrado.' };
  const texto = texto_(d.texto);
  const rol = d.rol && yo.roles.includes(d.rol) ? d.rol : (yo.roles[0] || 'ADMINISTRADOR');
  const lista = json_(inf.comentarios, []).filter((c) => !(c.email === yo.email && c.rol === rol));
  if (texto) lista.push({ rol, rol_txt: ROL_TXT[rol] || 'Administrador', email: yo.email, texto, fecha: ahora_() });
  actualizar_(db, inf, { comentarios: JSON.stringify(lista) }, contexto);
  return { ok: true, message: texto ? 'Comentario guardado.' : 'Comentario quitado.' };
}

/** Decisiones: las propone Control y las acuerda Gerencia. [{ texto, responsable, plazo, estado }] */
function limpiarDecisiones_(lista) {
  return (Array.isArray(lista) ? lista : []).map((x) => ({
    id: String((x && x.id) || crypto.randomUUID().slice(0, 8)).slice(0, 12), texto: texto_(x && x.texto, 400), origen: texto_(x && x.origen, 200), area: texto_(x && x.area, 60),
    responsable: texto_(x && x.responsable, 120), plazo: /^\d{4}-\d{2}-\d{2}$/.test(String(x && x.plazo || '')) ? x.plazo : '',
    estado: ['PROPUESTA', 'ACORDADA', 'DESCARTADA'].includes(x && x.estado) ? x.estado : 'PROPUESTA'
  })).filter((x) => x.texto).slice(0, TOPE.decisiones);
}
function guardarDecisiones(db, data, contexto) {
  const d = data || {};
  const yo = quienSoy_(db, contexto);
  const inf = informe_(db, String(d.periodo || ''));
  if (!inf) return { ok: false, message: 'El informe de ese mes todavía no se empieza.' };
  if (!acciones_(inf, yo).editar_decisiones) return { _forbidden: true, message: 'Las decisiones las propone Control y las acuerda Gerencia, cada uno en su paso.' };
  const cambios = { decisiones: JSON.stringify(limpiarDecisiones_(d.decisiones)) };
  if (d.conclusion !== undefined && tiene_(yo, 'CONTROL') && inf.estado === E.EN_CONTROL) cambios.conclusion = texto_(d.conclusion);
  actualizar_(db, inf, cambios, contexto);
  return { ok: true, message: 'Guardado.' };
}

/**
 * Avanza el informe. accion: enviar_finanzas | aprobar (FINANZAS/COBRANZAS) |
 * enviar_gerencia | cerrar | devolver (con observación).
 */
function avanzar(db, data, contexto) {
  const d = data || {};
  const periodo = String(d.periodo || '');
  if (!CI.RE_PERIODO.test(periodo)) return { ok: false, message: 'Mes no válido.' };
  const yo = quienSoy_(db, contexto);
  let inf = informe_(db, periodo);
  const acc = acciones_(inf, yo);
  const c = yo.cadena;
  const nombre = nombreMes_(periodo);

  if (d.accion === 'enviar_finanzas') {
    if (!acc.enviar_finanzas) return { _forbidden: true, message: 'Solo Administración envía el informe a Finanzas, mientras está en preparación.' };
    if (!c.FINANZAS.length && !c.COBRANZAS.length) return { ok: false, message: 'Falta asignar quién es Finanzas y Cobranzas en la cadena (Administración › Cadena de reportes).' };
    const areas = reportesAreas_(db, periodo);
    const sinRecibir = areas.filter((a) => a.estado !== 'RECIBIDO');
    if (sinRecibir.length && !d.confirmar_faltantes) return { ok: false, faltan: sinRecibir.map((a) => a.nombre), message: 'Aún no recibes el reporte de: ' + sinRecibir.map((a) => a.nombre).join(', ') + '. ¿Lo envías igual? Quedará anotado.' };
    if (!inf) inf = crear_(db, periodo, contexto);
    const snap = snapshot_(db, periodo);
    snap.faltantes_al_enviar = sinRecibir.map((a) => a.nombre);
    inf = actualizar_(db, inf, { estado: E.EN_FINANZAS, snapshot: JSON.stringify(snap), aprobaciones: '{}', fecha_envio_finanzas: ahora_(), devuelto_por: '', motivo_devolucion: '', fecha_devolucion: '' }, contexto);
    CI.historial_(db, inf.informe_id, 'INFORME_A_FINANZAS', 'Administración lo envió a Finanzas y Cobranzas.' + (sinRecibir.length ? ' Sin reporte de: ' + sinRecibir.map((a) => a.nombre).join(', ') + '.' : ''), contexto);
    avisar_(db, c.FINANZAS.concat(c.COBRANZAS), 'Por aprobar: ' + nombre, 'Administración te envió el informe de gestión. Revísalo y apruébalo, o devuélvelo con una observación.', inf.informe_id + ':f:' + inf.fecha_envio_finanzas);
    return { ok: true, estado: inf.estado, message: 'Enviado a Finanzas y Cobranzas.' };
  }
  if (!inf) return { ok: false, message: 'El informe de ese mes todavía no se empieza.' };

  if (d.accion === 'aprobar') {
    const rol = ['FINANZAS', 'COBRANZAS'].find((r) => (d.rol ? d.rol === r : true) && acc['aprobar_' + r.toLowerCase()]);
    if (!rol) return { _forbidden: true, message: 'No tienes una aprobación pendiente en este informe.' };
    const aprob = json_(inf.aprobaciones, {});
    aprob[rol] = { email: yo.email, fecha: ahora_(), nota: texto_(d.observacion, 600) };
    // Cuando cada rol tiene a alguien asignado, se necesitan los dos; si uno no existe, basta el otro.
    const necesarios = ['FINANZAS', 'COBRANZAS'].filter((r) => c[r].length);
    const listo = necesarios.every((r) => aprob[r]);
    inf = actualizar_(db, inf, Object.assign({ aprobaciones: JSON.stringify(aprob) }, listo ? { estado: E.EN_CONTROL, fecha_envio_control: ahora_() } : {}), contexto);
    CI.historial_(db, inf.informe_id, 'INFORME_APROBADO_' + rol, ROL_TXT[rol] + ' lo aprobó.' + (aprob[rol].nota ? ' Nota: ' + aprob[rol].nota : ''), contexto);
    if (listo) avisar_(db, c.CONTROL, 'Por revisar: ' + nombre, 'Finanzas y Cobranzas aprobaron el informe. Revisa los datos, deja tu conclusión y las decisiones que se le piden a Gerencia.', inf.informe_id + ':c:' + inf.fecha_envio_control);
    return { ok: true, estado: inf.estado, message: listo ? 'Aprobado: pasa al Analista de Control.' : 'Aprobado. Falta la otra aprobación de Finanzas y Cobranzas.' };
  }
  if (d.accion === 'enviar_gerencia') {
    if (!acc.enviar_gerencia) return { _forbidden: true, message: 'Solo el Analista de Control envía el informe a Gerencia.' };
    if (!c.GERENCIA.length) return { ok: false, message: 'Falta asignar quién es Gerencia en la cadena (Administración › Cadena de reportes).' };
    const cambios = { estado: E.EN_GERENCIA, fecha_envio_gerencia: ahora_() };
    if (d.decisiones) cambios.decisiones = JSON.stringify(limpiarDecisiones_(d.decisiones));
    if (d.conclusion !== undefined) cambios.conclusion = texto_(d.conclusion);
    inf = actualizar_(db, inf, cambios, contexto);
    CI.historial_(db, inf.informe_id, 'INFORME_A_GERENCIA', 'El Analista de Control lo envió a Gerencia.', contexto);
    avisar_(db, c.GERENCIA, 'Para su revisión: ' + nombre, 'El informe de gestión del mes está listo: primero lo que requiere su decisión.', inf.informe_id + ':g:' + inf.fecha_envio_gerencia);
    return { ok: true, estado: inf.estado, message: 'Enviado a Gerencia.' };
  }
  if (d.accion === 'cerrar') {
    if (!acc.cerrar) return { _forbidden: true, message: 'Solo Gerencia cierra el informe.' };
    const cambios = { estado: E.CERRADO, cerrado_por: yo.email, fecha_cierre: ahora_() };
    if (d.decisiones) cambios.decisiones = JSON.stringify(limpiarDecisiones_(d.decisiones));
    inf = actualizar_(db, inf, cambios, contexto);
    const acordadas = json_(inf.decisiones, []).filter((x) => x.estado === 'ACORDADA');
    CI.historial_(db, inf.informe_id, 'INFORME_CERRADO', 'Gerencia lo cerró con ' + acordadas.length + ' decisiones acordadas.', contexto);
    const todos = [].concat(c.ADMINISTRACION, c.FINANZAS, c.COBRANZAS, c.CONTROL);
    avisar_(db, todos, 'Cerrado: ' + nombre, 'Gerencia revisó el informe' + (acordadas.length ? ' y acordó: ' + acordadas.map((x) => '• ' + x.texto + (x.responsable ? ' (' + x.responsable + ')' : '')).join('\n') : '.'), inf.informe_id + ':x:' + inf.fecha_cierre);
    return { ok: true, estado: inf.estado, message: 'Informe cerrado.' };
  }
  if (d.accion === 'devolver') {
    if (!acc.devolver) return { _forbidden: true, message: 'No puedes devolver el informe en este paso.' };
    const motivo = texto_(d.observacion, 1000);
    if (!motivo) return { ok: false, message: 'Escribe qué hay que corregir.' };
    const atras = { EN_FINANZAS: E.PREPARACION, EN_CONTROL: E.EN_FINANZAS, EN_GERENCIA: E.EN_CONTROL }[inf.estado];
    const cambios = { estado: atras, devuelto_por: yo.email, fecha_devolucion: ahora_(), motivo_devolucion: motivo };
    if (atras === E.EN_FINANZAS) cambios.aprobaciones = '{}';
    inf = actualizar_(db, inf, cambios, contexto);
    CI.historial_(db, inf.informe_id, 'INFORME_DEVUELTO', 'Devuelto a «' + ETIQUETAS[atras] + '»: ' + motivo, contexto);
    const a = { PREPARACION: c.ADMINISTRACION, EN_FINANZAS: c.FINANZAS.concat(c.COBRANZAS), EN_CONTROL: c.CONTROL }[atras] || [];
    avisar_(db, a, 'Devuelto: ' + nombre, 'Te devolvieron el informe con esta observación:\n' + motivo, inf.informe_id + ':d:' + inf.fecha_devolucion);
    return { ok: true, estado: inf.estado, message: 'Devuelto con tu observación.' };
  }
  return { ok: false, message: 'Acción no válida.' };
}

/** Historial del informe (para la pantalla). */
function historial(db, data, contexto) {
  const yo = quienSoy_(db, contexto);
  if (!yo.ve) return { _forbidden: true, message: 'No participas en la cadena de reportes.' };
  const inf = informe_(db, String((data && data.periodo) || ''));
  if (!inf) return { historial: [] };
  return { historial: leer_(db, 'CI_HISTORIAL').filter((h) => h.registro_id === inf.informe_id).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
    .map((h) => ({ accion: h.accion, detalle: h.detalle, usuario_email: h.usuario_email, fecha: h.fecha })) };
}

// --- la cadena (solo ADM) ----------------------------------------------------------------------------
function listarCadena(db, data, contexto) {
  if (!contexto || contexto.rol !== 'ADM') return { _forbidden: true, message: 'Solo el administrador ve la cadena.' };
  const c = cadena_(db);
  return { roles: ROLES.concat(['ADMINISTRACION']).map((r) => ({ rol: r, nombre: ROL_TXT[r], personas: c[r], editable: r !== 'ADMINISTRACION' })), plazos: PLAZOS };
}
function guardarCadena(db, data, contexto) {
  if (!contexto || contexto.rol !== 'ADM') return { _forbidden: true, message: 'Solo el administrador reparte la cadena.' };
  const d = data || {};
  if (!ROLES.includes(d.rol)) return { ok: false, message: 'Rol no válido.' };
  const emails = (Array.isArray(d.personas) ? d.personas : []).map(norm_).filter((e, i, a) => e && a.indexOf(e) === i);
  if (emails.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) return { ok: false, message: 'Revisa los correos.' };
  if (emails.length > 5) return { ok: false, message: 'Máximo 5 personas por rol.' };
  const actuales = leer_(db, 'DEP_CADENA').filter((f) => esVerdadero_(f.activa) && f.rol === d.rol);
  actuales.forEach((f) => { if (!emails.includes(norm_(f.usuario_email))) actualizarFilaPorId_(db, 'DEP_CADENA', 'cadena_id', f.cadena_id, { activa: false }); });
  emails.forEach((e) => {
    if (actuales.some((f) => norm_(f.usuario_email) === e)) return;
    agregarFila_(db, 'DEP_CADENA', { cadena_id: crypto.randomUUID(), rol: d.rol, usuario_email: e, creado_por: norm_(contexto.email), fecha_creacion: ahora_(), activa: true });
  });
  return { ok: true, message: ROL_TXT[d.rol] + ': guardado.' };
}

/** Lo que espera a esta persona en la cadena (para el contador del menú). */
function pendientes_(db, contexto) {
  const yo = quienSoy_(db, contexto);
  if (!yo.roles.length && !yo.esAdmin) return 0;
  return leer_(db, 'DEP_INFORMES').filter((r) => esVerdadero_(r.activa)).filter((inf) => {
    const a = acciones_(inf, Object.assign({}, yo, { esAdmin: false }));
    return a.aprobar_finanzas || a.aprobar_cobranzas || a.enviar_gerencia || a.cerrar || (inf.estado === E.PREPARACION && a.enviar_finanzas);
  }).length;
}

module.exports = { obtener, comentar, guardarDecisiones, avanzar, historial, listarCadena, guardarCadena, pendientes_, plazos_, diaHabil_, ESTADOS: E, ROL_TXT };
