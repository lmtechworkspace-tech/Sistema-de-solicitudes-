'use strict';

/**
 * reunionCoordinacion.js — la REUNIÓN SEMANAL DE COORDINACIÓN de responsables
 * (Plan de control y certificación, pieza P5; aprobado 13-11-2026).
 *
 * Pedido de gerencia: «reuniones semanales de coordinación entre
 * responsables; ante un hito no cumplido, saber por qué y cómo se cubre
 * (falta un practicante, un contador…)». Recomendado y aprobado: lunes 9:00,
 * 30 minutos, la dirige Control de Gestión, con todas las jefaturas.
 *
 * Al ABRIR la reunión SIGSO arma la agenda sola y la guarda (no se mueve
 * mientras se conversa):
 *  - ATRASO: tareas que vencieron y siguen sin entregar (contra la fecha
 *    ORIGINAL, la misma regla del índice), obligaciones de la Agenda de las
 *    áreas sin hacer y no conformidades con una etapa vencida;
 *  - COMPROMISO: lo que se comprometió en la reunión anterior con nueva fecha
 *    y volvió a vencer sin cumplirse;
 *  - SEMANA: lo que vence esta semana (para mirar, no se explica);
 *  - DORMIDA: tareas sin movimiento en 14 días.
 * Cada ATRASO y COMPROMISO exige dos respuestas antes de cerrar: POR QUÉ no se
 * cumplió (catálogo de causas) y CÓMO se cubre (texto, nueva fecha y, si
 * cambia, otro responsable). Los ACUERDOS se convierten en tareas con fecha
 * (entran al índice). Se registra la asistencia. Al CERRAR, el acta llega por
 * correo y a la campana de los participantes y de gerencia.
 *
 * Las causas se acumulan: «por qué no se cumple» por semana, para que gerencia
 * decida recursos con datos (ISO 9001 §7.4, §9.1.3, §10.2).
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');

const TZ = 'America/Santiago';
const CAUSAS = [
  { clave: 'FALTA_PERSONAL', nombre: 'Falta de personal' },
  { clave: 'FALTA_INFO_CLIENTE', nombre: 'Falta información del cliente' },
  { clave: 'SOBRECARGA', nombre: 'Sobrecarga de trabajo' },
  { clave: 'DEPENDE_OTRA_AREA', nombre: 'Depende de otra área' },
  { clave: 'CAMBIO_PRIORIDAD', nombre: 'Cambió la prioridad' },
  { clave: 'OLVIDO', nombre: 'Se olvidó' },
  { clave: 'OTRA', nombre: 'Otra' }
];
const TIPOS_A_EXPLICAR = ['ATRASO', 'COMPROMISO'];
const ESTADOS = { ABIERTA: 'ABIERTA', CERRADA: 'CERRADA' };
const EVENTO_ACTA = 'CUMPLIMIENTO_REUNION';
const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function leer_(db, t) { try { return leerFilas_(db, t, COLUMNAS[t]); } catch (e) { return []; } }
function norm_(e) { return String(e || '').trim().toLowerCase(); }
function verdadero_(v) { return v === true || v === 'TRUE' || v === 1 || v === 'true'; }
function activa_(f) { return f.activa === undefined || f.activa === '' || verdadero_(f.activa); }
function hoy_() { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); }
function ahora_() { return new Date().toISOString(); }
function uuid_() { return crypto.randomUUID(); }
function texto_(v, tope) { return String(v == null ? '' : v).trim().slice(0, tope || 1500); }
function errorValidacion_(campo, message) { return { _validationError: true, campo, message }; }
function diasEntre_(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }
function sumarDias_(dia, n) { return new Date(Date.parse(dia + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
function lunesDe_(dia) { const d = new Date(dia + 'T00:00:00Z'); return sumarDias_(dia, -((d.getUTCDay() + 6) % 7)); }
function fechaTxt_(d) { return d ? Number(d.slice(8, 10)) + ' ' + MESES_CORTO[Number(d.slice(5, 7)) - 1] : '—'; }
function nombres_(db) {
  const m = {};
  leer_(db, 'USUARIOS').forEach((u) => { if (u.email) m[norm_(u.email)] = u.nombre || u.email; });
  return m;
}

function permisos_(db, contexto) {
  if (!contexto) return { gestiona: false, ve: false };
  const C = require('./calidadSgc');
  const gestiona = contexto.rol === 'ADM' || contexto.rol === 'GERENCIA' || C.gobiernaSgc_(db, contexto);
  const jefe = require('./avisoCumplimiento').jefaturas_(db).indexOf(norm_(contexto.email)) !== -1;
  return { gestiona, ve: gestiona || jefe || C.veTodoSgc_(db, contexto, C.rolSgc_(db, contexto), false) };
}

// --- la agenda ---------------------------------------------------------------------------
function armarAgenda_(db, hoy) {
  const R = require('./cumplimientoResponsables');
  const datos = R.cargarDatos_(db);
  const personas = R.personasEmpresa_(db, datos);
  const lunes = lunesDe_(hoy), domingo = sumarDias_(lunes, 6);
  const items = [];
  const vistosAgenda = {};
  // Tareas: vencidas sin entregar (fecha original), de la semana y dormidas.
  datos.tareas.forEach((a) => {
    if (['TERMINADA', 'CANCELADA', 'EN_REVISION'].indexOf(a.estado) !== -1) return;
    const ev = datos.eventosPor[a.actividad_id] || [];
    const meta = R.metaDeTarea_(a, ev).meta;
    if (!meta) return;
    const base = { origen: 'ACTIVIDAD', ref_id: a.actividad_id, titulo: a.titulo, responsable_email: norm_(a.responsable_email), meta };
    if (meta < hoy) items.push(Object.assign({ tipo: 'ATRASO', dias: diasEntre_(meta, hoy), detalle: a.estado === 'BLOQUEADA' ? 'Bloqueada: ' + (a.bloqueo_motivo || '') : '' }, base));
    else if (meta <= domingo) items.push(Object.assign({ tipo: 'SEMANA', dias: diasEntre_(hoy, meta) }, base));
  });
  personas.forEach((e) => {
    const r = R.calcularPersona_(db, e, hoy.slice(0, 7), { datos, hoy });
    r.senales.detalle_dormidas.forEach((d) => {
      if (items.some((x) => x.ref_id === d.actividad_id && x.tipo === 'ATRASO')) return;
      items.push({ tipo: 'DORMIDA', origen: 'ACTIVIDAD', ref_id: d.actividad_id, titulo: d.titulo, responsable_email: e, meta: d.sin_movimiento_desde, dias: diasEntre_(d.sin_movimiento_desde, hoy) });
    });
    // Obligaciones de la Agenda del área sin hacer (una vez por área, aunque la vean varias personas).
    const B = r.componentes.find((c) => c.clave === 'B');
    (B ? B.detalle : []).filter((x) => x.estado === 'Sin hacer').forEach((x) => {
      const k = x.area + '|' + x.tarea + '|' + x.fecha;
      if (vistosAgenda[k]) return;
      vistosAgenda[k] = true;
      items.push({ tipo: 'ATRASO', origen: 'AGENDA', ref_id: k, titulo: x.tarea, area: x.area, responsable_email: '', meta: x.fecha, dias: diasEntre_(x.fecha, hoy) });
    });
  });
  // No conformidades con la etapa en curso vencida.
  datos.nc.filter((n) => ['CERRADA', 'ANULADA'].indexOf(n.estado) === -1).forEach((n) => {
    const et = n.estado === 'EN_VERIFICACION' ? ['eficacia_plazo', 'eficacia_fecha', 'Verificación de eficacia'] : (n.estado === 'EN_ACCION' ? ['accion_plazo', 'accion_fecha_cierre', 'Acción correctiva'] : ['correccion_plazo', 'correccion_fecha_cierre', 'Corrección']);
    const plazo = String(n[et[0]] || '').slice(0, 10);
    if (!plazo || plazo >= hoy || n[et[1]]) return;
    items.push({ tipo: 'ATRASO', origen: 'NC', ref_id: n.nc_id, titulo: (n.correlativo || 'No conformidad') + ' · ' + et[2], detalle: String(n.descripcion || '').slice(0, 160),
      responsable_email: norm_(n.responsable_email), meta: plazo, dias: diasEntre_(plazo, hoy) });
  });
  // Compromisos de la última reunión cerrada que volvieron a vencer y siguen abiertos.
  const ultima = leer_(db, 'REUNIONES_COORD').filter((r) => activa_(r) && r.estado === ESTADOS.CERRADA).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0];
  if (ultima) {
    const abiertos = {};
    items.filter((x) => x.tipo === 'ATRASO').forEach((x) => { abiertos[x.origen + '|' + x.ref_id] = x; });
    leer_(db, 'REUNION_COORD_ITEMS').filter((i) => activa_(i) && i.reunion_id === ultima.reunion_id && i.nueva_fecha && i.nueva_fecha < hoy).forEach((i) => {
      const sigue = abiertos[i.origen + '|' + i.ref_id];
      if (!sigue) return;
      sigue.tipo = 'COMPROMISO';
      sigue.detalle = 'En la reunión del ' + fechaTxt_(ultima.fecha) + ' se comprometió para el ' + fechaTxt_(i.nueva_fecha) + ' (' + (i.como_se_cubre || 'sin detalle') + ').';
    });
  }
  const orden = { COMPROMISO: 0, ATRASO: 1, SEMANA: 2, DORMIDA: 3 };
  return items.sort((a, b) => (orden[a.tipo] - orden[b.tipo]) || (b.dias - a.dias));
}

function participantesPorDefecto_(db) {
  const A = require('./avisoCumplimiento');
  const nombres = nombres_(db);
  const set = {};
  A.jefaturas_(db).forEach((e) => { set[e] = true; });
  leer_(db, 'SGC_ROLES').filter((r) => verdadero_(r.activo) && r.rol_sgc === 'ENCARGADO_SGC').forEach((r) => { set[norm_(r.usuario_email)] = true; });
  return Object.keys(set).filter(Boolean).sort().map((e) => ({ email: e, nombre: nombres[e] || e, asistio: false }));
}

// --- lectura ------------------------------------------------------------------------------
function resumenReunion_(r) {
  return { reunion_id: r.reunion_id, correlativo: r.correlativo, fecha: r.fecha, titulo: r.titulo, estado: r.estado,
    participantes: Array.isArray(r.participantes) ? r.participantes : [], minuta: r.minuta || '',
    creado_por: r.creado_por, cerrada_por: r.cerrada_por || '', fecha_cierre: r.fecha_cierre || '' };
}
/** Por qué no se cumple: causas de las últimas `semanas` reuniones cerradas. */
function estadisticaCausas_(db, semanas) {
  const cerradas = leer_(db, 'REUNIONES_COORD').filter((r) => activa_(r) && r.estado === ESTADOS.CERRADA)
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, semanas || 8);
  const ids = {};
  cerradas.forEach((r) => { ids[r.reunion_id] = true; });
  const cuenta = {};
  let total = 0;
  leer_(db, 'REUNION_COORD_ITEMS').filter((i) => activa_(i) && ids[i.reunion_id] && i.causa).forEach((i) => { cuenta[i.causa] = (cuenta[i.causa] || 0) + 1; total++; });
  return { reuniones: cerradas.length, total, causas: CAUSAS.map((c) => ({ clave: c.clave, nombre: c.nombre, n: cuenta[c.clave] || 0, pct: total ? Math.round((cuenta[c.clave] || 0) * 1000 / total) / 10 : 0 }))
    .filter((c) => c.n).sort((a, b) => b.n - a.n) };
}

function listar(db, data, contexto) {
  const p = permisos_(db, contexto);
  if (!p.ve) return { _forbidden: true, message: 'La reunión de coordinación es para jefaturas, Control y gerencia.' };
  const reuniones = leer_(db, 'REUNIONES_COORD').filter(activa_).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).map(resumenReunion_);
  return { reuniones, puede_gestionar: p.gestiona, causas: CAUSAS, estadistica: estadisticaCausas_(db, 8) };
}

function obtener(db, data, contexto) {
  const p = permisos_(db, contexto);
  if (!p.ve) return { _forbidden: true, message: 'La reunión de coordinación es para jefaturas, Control y gerencia.' };
  const d = data || {};
  const r = d.reunion_id ? leer_(db, 'REUNIONES_COORD').find((x) => x.reunion_id === d.reunion_id && activa_(x))
    : leer_(db, 'REUNIONES_COORD').filter(activa_).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0];
  if (!r) return { reunion: null, puede_gestionar: p.gestiona, causas: CAUSAS };
  const nombres = nombres_(db);
  const items = leer_(db, 'REUNION_COORD_ITEMS').filter((i) => activa_(i) && i.reunion_id === r.reunion_id)
    .map((i) => Object.assign({}, i, { responsable_nombre: i.responsable_email ? (nombres[i.responsable_email] || i.responsable_email) : (i.area || '') }));
  const acuerdos = leer_(db, 'REUNION_COORD_ACUERDOS').filter((a) => activa_(a) && a.reunion_id === r.reunion_id)
    .map((a) => Object.assign({}, a, { responsable_nombre: nombres[norm_(a.responsable_email)] || a.responsable_email }));
  const pendientes = items.filter((i) => TIPOS_A_EXPLICAR.indexOf(i.tipo) !== -1 && (!i.causa || !(i.como_se_cubre || i.nueva_fecha))).length;
  return { reunion: resumenReunion_(r), items, acuerdos, pendientes_de_explicar: pendientes, causas: CAUSAS,
    puede_gestionar: p.gestiona && r.estado === ESTADOS.ABIERTA, personas: Object.keys(nombres).sort().map((e) => ({ email: e, nombre: nombres[e] })) };
}

// --- escritura ------------------------------------------------------------------------------
function abierta_(db, reunionId, contexto) {
  if (!permisos_(db, contexto).gestiona) return { _forbidden: true, message: 'La reunión la conduce Control de Gestión o gerencia.' };
  const r = leer_(db, 'REUNIONES_COORD').find((x) => x.reunion_id === reunionId && activa_(x));
  if (!r) return errorValidacion_('reunion_id', 'La reunión no existe.');
  if (r.estado !== ESTADOS.ABIERTA) return errorValidacion_('reunion_id', 'La reunión ya se cerró.');
  return { r };
}

function crear(db, data, contexto) {
  if (!permisos_(db, contexto).gestiona) return { _forbidden: true, message: 'La reunión la abre Control de Gestión o gerencia.' };
  const d = data || {};
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(d.fecha || '')) ? d.fecha : hoy_();
  if (leer_(db, 'REUNIONES_COORD').some((r) => activa_(r) && r.estado === ESTADOS.ABIERTA)) return errorValidacion_('fecha', 'Ya hay una reunión abierta: ciérrala antes de abrir otra.');
  const anio = fecha.slice(0, 4);
  const n = leer_(db, 'REUNIONES_COORD').filter((r) => String(r.correlativo || '').indexOf('RC-' + anio) === 0).length + 1;
  const reunion = { reunion_id: uuid_(), correlativo: 'RC-' + anio + '-' + String(n).padStart(2, '0'), fecha, titulo: texto_(d.titulo, 160) || 'Reunión de coordinación del ' + fechaTxt_(fecha),
    estado: ESTADOS.ABIERTA, participantes: participantesPorDefecto_(db), minuta: '', creado_por: norm_(contexto.email), fecha_creacion: ahora_(), cerrada_por: '', fecha_cierre: '', activa: true };
  agregarFila_(db, 'REUNIONES_COORD', reunion);
  const items = armarAgenda_(db, fecha);
  items.forEach((i) => agregarFila_(db, 'REUNION_COORD_ITEMS', Object.assign({ item_id: uuid_(), reunion_id: reunion.reunion_id, detalle: '', area: '',
    causa: '', como_se_cubre: '', nueva_fecha: '', nuevo_responsable: '', registrado_por: '', fecha_registro: '', activa: true }, i)));
  return { reunion: resumenReunion_(reunion), items: items.length };
}

function guardarItem(db, data, contexto) {
  const d = data || {};
  const item = leer_(db, 'REUNION_COORD_ITEMS').find((i) => i.item_id === d.item_id && activa_(i));
  if (!item) return errorValidacion_('item_id', 'El punto de la agenda no existe.');
  const ok = abierta_(db, item.reunion_id, contexto);
  if (!ok.r) return ok;
  const cambios = {};
  if (d.causa !== undefined) {
    if (d.causa && !CAUSAS.some((c) => c.clave === d.causa)) return errorValidacion_('causa', 'Elige una causa de la lista.');
    cambios.causa = d.causa || '';
  }
  if (d.como_se_cubre !== undefined) cambios.como_se_cubre = texto_(d.como_se_cubre, 600);
  if (d.nueva_fecha !== undefined) {
    if (d.nueva_fecha && !/^\d{4}-\d{2}-\d{2}$/.test(d.nueva_fecha)) return errorValidacion_('nueva_fecha', 'La fecha no es válida.');
    cambios.nueva_fecha = d.nueva_fecha || '';
  }
  if (d.nuevo_responsable !== undefined) cambios.nuevo_responsable = norm_(d.nuevo_responsable);
  cambios.registrado_por = norm_(contexto.email);
  cambios.fecha_registro = ahora_();
  actualizarFilaPorId_(db, 'REUNION_COORD_ITEMS', 'item_id', item.item_id, cambios);
  return Object.assign({}, item, cambios);
}

function guardarAsistencia(db, data, contexto) {
  const d = data || {};
  const ok = abierta_(db, d.reunion_id, contexto);
  if (!ok.r) return ok;
  const nombres = nombres_(db);
  const lista = (Array.isArray(d.participantes) ? d.participantes : []).map((p) => ({ email: norm_(p.email), nombre: p.nombre || nombres[norm_(p.email)] || norm_(p.email), asistio: !!p.asistio }))
    .filter((p) => p.email).filter((p, i, t) => t.findIndex((x) => x.email === p.email) === i);
  actualizarFilaPorId_(db, 'REUNIONES_COORD', 'reunion_id', ok.r.reunion_id, { participantes: lista });
  return { participantes: lista };
}

async function agregarAcuerdo(db, data, contexto) {
  const d = data || {};
  const ok = abierta_(db, d.reunion_id, contexto);
  if (!ok.r) return ok;
  const texto = texto_(d.texto, 300);
  if (!texto) return errorValidacion_('texto', 'Escribe el acuerdo.');
  if (!norm_(d.responsable_email)) return errorValidacion_('responsable_email', 'Elige un responsable.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.fecha_compromiso || ''))) return errorValidacion_('fecha_compromiso', 'Elige la fecha.');
  const act = await require('./actividades').crear(db, {
    titulo: texto, descripcion: 'Acuerdo de la ' + ok.r.titulo + ' (' + ok.r.correlativo + ').', responsable_email: norm_(d.responsable_email),
    fecha_compromiso: d.fecha_compromiso, prioridad: 'P2', origen: 'ASIGNADA', requiere_validacion: false,
    sgc_origen_tipo: 'REUNION_COORD', sgc_origen_id: ok.r.reunion_id
  }, contexto);
  if (!act || act._validationError || act._forbidden) return act;
  const acuerdo = { acuerdo_id: uuid_(), reunion_id: ok.r.reunion_id, texto, responsable_email: norm_(d.responsable_email), fecha_compromiso: d.fecha_compromiso,
    actividad_id: act.actividad_id, creado_por: norm_(contexto.email), fecha_creacion: ahora_(), activa: true };
  agregarFila_(db, 'REUNION_COORD_ACUERDOS', acuerdo);
  return acuerdo;
}

function textoActa_(r, items, acuerdos, nombres) {
  const causa = (k) => (CAUSAS.find((c) => c.clave === k) || {}).nombre || '—';
  const presentes = r.participantes.filter((p) => p.asistio).map((p) => p.nombre);
  const ausentes = r.participantes.filter((p) => !p.asistio).map((p) => p.nombre);
  const atrasos = items.filter((i) => TIPOS_A_EXPLICAR.indexOf(i.tipo) !== -1);
  const partes = [r.titulo + ' (' + r.correlativo + ')', '',
    'Asistieron: ' + (presentes.length ? presentes.join(', ') : 'nadie registrado') + '.', ausentes.length ? 'No asistieron: ' + ausentes.join(', ') + '.' : ''];
  if (atrasos.length) {
    partes.push('', 'Atrasos revisados (' + atrasos.length + '):');
    atrasos.forEach((i) => {
      const quien = i.responsable_email ? (nombres[i.responsable_email] || i.responsable_email) : (i.area || 'Área');
      partes.push('  • ' + (i.tipo === 'COMPROMISO' ? '[compromiso no cumplido] ' : '') + i.titulo + ' — ' + quien + ' (venció el ' + fechaTxt_(i.meta) + ')',
        '      Por qué: ' + causa(i.causa) + '. Cómo se cubre: ' + (i.como_se_cubre || '—') + (i.nueva_fecha ? ' · nueva fecha ' + fechaTxt_(i.nueva_fecha) : '') +
        (i.nuevo_responsable ? ' · ahora a cargo de ' + (nombres[i.nuevo_responsable] || i.nuevo_responsable) : '') + '.');
    });
  }
  if (acuerdos.length) {
    partes.push('', 'Acuerdos (quedan como tareas en Mi trabajo):');
    acuerdos.forEach((a) => partes.push('  • ' + a.texto + ' — ' + (nombres[norm_(a.responsable_email)] || a.responsable_email) + ', para el ' + fechaTxt_(a.fecha_compromiso)));
  }
  const cuenta = {};
  atrasos.forEach((i) => { if (i.causa) cuenta[i.causa] = (cuenta[i.causa] || 0) + 1; });
  const top = Object.keys(cuenta).sort((a, b) => cuenta[b] - cuenta[a]);
  if (top.length) partes.push('', 'Causas de esta semana: ' + top.map((k) => causa(k) + ' (' + cuenta[k] + ')').join(', ') + '.');
  if (r.minuta) partes.push('', 'Notas: ' + r.minuta);
  partes.push('', '--------------------------------------------------', 'Acta generada por SIGSO al cerrar la reunión de coordinación.');
  return partes.filter((x, i, t) => !(x === '' && t[i - 1] === '')).join('\n');
}

async function cerrar(db, data, contexto) {
  const d = data || {};
  const ok = abierta_(db, d.reunion_id, contexto);
  if (!ok.r) return ok;
  const items = leer_(db, 'REUNION_COORD_ITEMS').filter((i) => activa_(i) && i.reunion_id === ok.r.reunion_id);
  const faltan = items.filter((i) => TIPOS_A_EXPLICAR.indexOf(i.tipo) !== -1 && (!i.causa || !(i.como_se_cubre || i.nueva_fecha)));
  if (faltan.length) return errorValidacion_('items', faltan.length + (faltan.length === 1 ? ' atraso no tiene' : ' atrasos no tienen') + ' su causa y cómo se cubre. Es lo que pidió gerencia: saber por qué no se cumplió y cómo se cubre.');
  const participantes = Array.isArray(ok.r.participantes) ? ok.r.participantes : [];
  if (!participantes.some((p) => p.asistio)) return errorValidacion_('participantes', 'Marca quiénes asistieron.');
  const cambios = { estado: ESTADOS.CERRADA, minuta: texto_(d.minuta, 3000), cerrada_por: norm_(contexto.email), fecha_cierre: ahora_() };
  actualizarFilaPorId_(db, 'REUNIONES_COORD', 'reunion_id', ok.r.reunion_id, cambios);
  const r = Object.assign({}, ok.r, cambios);
  // El acta: a los participantes y a gerencia, por correo y a la campana.
  const nombres = nombres_(db);
  const acuerdos = leer_(db, 'REUNION_COORD_ACUERDOS').filter((a) => activa_(a) && a.reunion_id === r.reunion_id);
  const cuerpo = textoActa_(Object.assign({}, r, { participantes }), items, acuerdos, nombres);
  const destinatarios = participantes.map((p) => p.email).concat(require('./avisoCumplimiento').destinatariosGerencia_(db))
    .filter((e, i, t) => e && t.indexOf(e) === i);
  const Notificaciones = require('./notificaciones');
  const enviados = [];
  for (const e of destinatarios) {
    const res = await Notificaciones.enviarCorreoModulo(db, { solicitudId: 'REUNION:' + r.reunion_id, destinatario: e, evento: EVENTO_ACTA,
      asunto: 'SIGSO — Acta: ' + r.titulo, cuerpo, ventanaMinutos: 60 * 24 * 30 });
    enviados.push({ destinatario: e, enviado: !!res.enviado, motivo: res.motivo || '' });
  }
  require('./notificacionesApp').encolarLote(db, destinatarios.map((e) => ({ destinatario: e, tipo: EVENTO_ACTA, titulo: 'Acta de la reunión de coordinación',
    mensaje: r.titulo + ': atrasos explicados y acuerdos con responsable y fecha.', modulo_id: 'calidad', texto_accion: 'Ver la reunión', vidaHoras: 120 })));
  return { reunion: resumenReunion_(r), acta: cuerpo, enviados };
}

module.exports = { listar, obtener, crear, guardarItem, guardarAsistencia, agregarAcuerdo, cerrar, armarAgenda_, textoActa_, CAUSAS, EVENTO_ACTA };
