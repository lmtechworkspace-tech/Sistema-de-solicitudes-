'use strict';

/**
 * avisosControl.js — AVISOS DE CONTROL PROGRAMADOS (Plan de control y
 * certificación, pieza P8; aprobado 13-11-2026).
 *
 * Las «preguntas programadas» de la reunión de cierre de año: «el día 9,
 * cuántas imposiciones están declaradas y cuántas faltan; aviso cuando se
 * llegue al 100 %; lo mismo para IVA, convenios…». Gerencia deja de tener que
 * preguntar: la respuesta le llega sola el día que corresponde.
 *
 * Sin inteligencia artificial y sin costo: cada aviso sale de las matrices de
 * Control interno con los MISMOS criterios del informe de indicadores:
 *  - COTIZACIONES: remuneraciones del mes anterior (mes de la remuneración)
 *    con la fecha de declaración en Previred; vencen el día 10 hábil.
 *  - IVA_F29: F29 del mes anterior con fecha de declaración; vence el 20 hábil.
 *  - CONTABILIZACION: contabilización del mes anterior terminada.
 *  - CONVENIOS: clientes de la matriz Convenios del mes con cuotas vencidas.
 *
 * Gerencia elige en el Panel de gerencia qué avisos activar, qué día del mes
 * y quién los recibe. El día elegido (a las 9:00) llega el estado con la
 * lista de lo que falta y su responsable; con «avisar al 100 %», los días
 * siguientes llega un aviso cuando se completa. Todo deduplicado por período.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');

const TZ = 'America/Santiago';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MAX_LINEAS = 15;

const CATALOGO = [
  { clave: 'COTIZACIONES', titulo: 'Cotizaciones previsionales (Previred)', depto: 'RRHH', dia: 9, avisar_100: true,
    descripcion: 'Empresas con las cotizaciones del mes anterior declaradas en Previred y las que faltan. Vencen el día 10.' },
  { clave: 'IVA_F29', titulo: 'F29 (IVA)', depto: 'CONTABILIDAD', dia: 18, avisar_100: true,
    descripcion: 'Clientes con el F29 del mes anterior declarado y los que faltan. Vence el día 20.' },
  { clave: 'CONTABILIZACION', titulo: 'Contabilización mensual', depto: 'CONTABILIDAD', dia: 25, avisar_100: true,
    descripcion: 'Clientes con la contabilidad del mes anterior terminada y los que faltan.' },
  { clave: 'CONVENIOS', titulo: 'Convenios TGR con cuotas vencidas', depto: 'CONTABILIDAD', dia: 5, avisar_100: false,
    descripcion: 'Clientes con alguna cuota de convenio vencida en la matriz del mes: un convenio impago puede caducar.' }
];
const NO_DISPONIBLES = [
  { titulo: 'Prebalances', motivo: 'No hay una matriz de prebalances en SIGSO: para avisarlo hay que empezar a registrarlos.' },
  { titulo: 'Cotizaciones comerciales de la semana', motivo: 'Las cotizaciones a clientes no se registran en SIGSO todavía.' }
];

function leer_(db, t) { try { return leerFilas_(db, t, COLUMNAS[t]); } catch (e) { return []; } }
function norm_(e) { return String(e || '').trim().toLowerCase(); }
function verdadero_(v) { return v === true || v === 'TRUE' || v === 1 || v === 'true'; }
function activa_(f) { return f.activa === undefined || f.activa === '' || verdadero_(f.activa); }
function hoy_() { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); }
function esFecha_(v) { return /^\d{4}-\d{2}-\d{2}/.test(String(v || '')); }
function errorValidacion_(campo, message) { return { _validationError: true, campo, message }; }
function periodoCi_(dia, k) {
  let a = Number(dia.slice(0, 4)), m = Number(dia.slice(5, 7)) + (k || 0);
  while (m < 1) { m += 12; a--; }
  while (m > 12) { m -= 12; a++; }
  return a + '-M' + String(m).padStart(2, '0');
}
function periodoTxt_(p) { return MESES[Number(p.slice(6)) - 1] + ' ' + p.slice(0, 4); }
function fechaTxt_(d) { return d ? Number(d.slice(8, 10)) + ' ' + MES_CORTO[Number(d.slice(5, 7)) - 1] : ''; }
function nombres_(db) {
  const m = {};
  leer_(db, 'USUARIOS').forEach((u) => { if (u.email) m[norm_(u.email)] = u.nombre || u.email; });
  return m;
}
function feriados_(db) { try { return new Set(require('./cumplimiento').obtenerFeriados(db).map((f) => String(f).slice(0, 10))); } catch (e) { return new Set(); } }
function registros_(db, matriz, periodos) {
  const CI = require('./controlInterno');
  let filas = [];
  periodos.forEach((p) => { try { filas = filas.concat(CI.consultar_(db, 'CI_REGISTROS', { matriz, periodo: p, activa: true })); } catch (e) { /* */ } });
  return filas.filter((r) => !/^ANULAD/.test(String(r.estado || '')) && r.estado !== 'NO_APLICA');
}

/** El estado de un aviso hoy: qué período mide, cuántos hay, cuántos listos y qué falta. */
function estado(db, clave, hoy) {
  const def = CATALOGO.find((c) => c.clave === clave);
  if (!def) return null;
  const nombres = nombres_(db);
  const quien = (e) => (e ? nombres[norm_(e)] || e : 'sin responsable');
  const Ind = require('./indicadoresDepto');
  let periodo, filas, listo, vence = '';
  if (clave === 'COTIZACIONES') {
    periodo = periodoCi_(hoy, -1);
    const { periodoRemuneracion_ } = require('./controlInternoMatrices');
    filas = registros_(db, 'REMUNERACIONES', [periodo, periodoCi_(hoy, 0)]).filter((r) => periodoRemuneracion_(r) === periodo);
    listo = (r) => esFecha_((r.datos || {}).fecha_declaracion) || esFecha_((r.datos || {}).fecha_envio_imposiciones_planillas_declaradas);
    vence = Ind.vencimiento_(periodo, 10, feriados_(db));
  } else if (clave === 'IVA_F29') {
    periodo = periodoCi_(hoy, -1);
    filas = registros_(db, 'IVA', [periodo]);
    listo = (r) => esFecha_((r.datos || {}).fecha_declaracion);
    vence = Ind.vencimiento_(periodo, 20, feriados_(db));
  } else if (clave === 'CONTABILIZACION') {
    periodo = periodoCi_(hoy, -1);
    filas = registros_(db, 'CONTABILIZACION', [periodo]);
    listo = (r) => r.estado === 'TERMINADO';
  } else {
    periodo = periodoCi_(hoy, 0);
    filas = registros_(db, 'CONVENIOS', [periodo]).filter((r) => r.estado !== 'SIN_CONVENIO');
    listo = (r) => r.estado !== 'CON_VENCIDAS';
  }
  const faltan = filas.filter((r) => !listo(r)).map((r) => ({ cliente: r.cliente_nombre || 'sin cliente', responsable: quien(r.responsable_email) }))
    .sort((a, b) => a.cliente.localeCompare(b.cliente, 'es'));
  const total = filas.length, hechos = total - faltan.length;
  return { clave, titulo: def.titulo, periodo, periodo_txt: periodoTxt_(periodo), vence, total, hechos, faltan,
    pct: total ? Math.round(hechos * 1000 / total) / 10 : null, completo: total > 0 && !faltan.length };
}

function textoEstado_(e, hoy) {
  const conv = e.clave === 'CONVENIOS';
  const partes = [];
  if (!e.total) {
    partes.push(e.titulo + ' de ' + e.periodo_txt + ': la matriz todavía no tiene registros de ese período en SIGSO.');
  } else if (conv) {
    partes.push(e.titulo + ' (' + e.periodo_txt + '): ' + (e.faltan.length ? e.faltan.length + ' de ' + e.total + ' clientes con convenio tienen cuotas vencidas.' : 'ningún cliente con cuotas vencidas.'));
  } else {
    partes.push(e.titulo + ' de ' + e.periodo_txt + ': ' + e.hechos + ' de ' + e.total + ' listos (' + String(e.pct).replace('.', ',') + ' %).' +
      (e.vence ? ' ' + (hoy > e.vence ? 'Venció' : 'Vence') + ' el ' + fechaTxt_(e.vence) + '.' : ''));
  }
  if (e.faltan.length) {
    partes.push('', conv ? 'Con cuotas vencidas:' : 'Faltan:');
    e.faltan.slice(0, MAX_LINEAS).forEach((f) => partes.push('  • ' + f.cliente + ' — ' + f.responsable));
    if (e.faltan.length > MAX_LINEAS) partes.push('  … y ' + (e.faltan.length - MAX_LINEAS) + ' más en SIGSO.');
  }
  return partes.join('\n');
}

// --- configuración --------------------------------------------------------------------------
function permiso_(contexto) { return !!contexto && (contexto.rol === 'ADM' || contexto.rol === 'GERENCIA'); }
function config_(db) {
  const filas = leer_(db, 'AVISOS_CONTROL').filter(activa_);
  return CATALOGO.map((c) => {
    const f = filas.find((x) => x.clave === c.clave);
    return { clave: c.clave, activo: f ? verdadero_(f.encendido) : false, dia: f ? Number(f.dia) || c.dia : c.dia,
      destinatarios: f && Array.isArray(f.destinatarios) ? f.destinatarios : null, avisar_100: f ? verdadero_(f.avisar_100) : c.avisar_100, aviso_id: f ? f.aviso_id : '' };
  });
}
/** Por defecto: gerencia y la jefatura del área del aviso. */
function destinatariosPorDefecto_(db, depto) {
  const set = {};
  try { require('./avisoCumplimiento').destinatariosGerencia_(db).forEach((e) => { set[e] = true; }); } catch (e) { /* */ }
  leer_(db, 'CI_MIEMBROS').filter((m) => activa_(m) && m.depto === depto && m.rol === 'JEFATURA').forEach((m) => { set[norm_(m.usuario_email)] = true; });
  return Object.keys(set).filter(Boolean);
}

function listar(db, data, contexto) {
  if (!permiso_(contexto)) return { _forbidden: true, message: 'Los avisos de control los configura gerencia.' };
  const hoy = hoy_();
  const nombres = nombres_(db);
  const avisos = config_(db).map((c) => {
    const def = CATALOGO.find((x) => x.clave === c.clave);
    const dest = c.destinatarios || destinatariosPorDefecto_(db, def.depto);
    const e = estado(db, c.clave, hoy);
    return Object.assign({}, def, c, { destinatarios: dest.map((x) => ({ email: x, nombre: nombres[x] || x })), destinatarios_por_defecto: !c.destinatarios,
      estado_hoy: e, vista_previa: textoEstado_(e, hoy) });
  });
  return { avisos, no_disponibles: NO_DISPONIBLES, personas: Object.keys(nombres).sort().map((e) => ({ email: e, nombre: nombres[e] })) };
}

function guardar(db, data, contexto) {
  if (!permiso_(contexto)) return { _forbidden: true, message: 'Los avisos de control los configura gerencia.' };
  const d = data || {};
  const def = CATALOGO.find((c) => c.clave === d.clave);
  if (!def) return errorValidacion_('clave', 'Ese aviso no existe.');
  const dia = Number(d.dia);
  if (!(dia >= 1 && dia <= 28)) return errorValidacion_('dia', 'Elige un día entre el 1 y el 28.');
  const destinatarios = (Array.isArray(d.destinatarios) ? d.destinatarios : []).map(norm_).filter((e) => /^[^\s@]+@[^\s@]+$/.test(e)).filter((e, i, t) => t.indexOf(e) === i);
  if (verdadero_(d.activo) && !destinatarios.length) return errorValidacion_('destinatarios', 'Elige al menos a una persona que lo reciba.');
  const fila = { clave: def.clave, encendido: verdadero_(d.activo), dia, destinatarios, avisar_100: verdadero_(d.avisar_100),
    actualizado_por: norm_(contexto.email), fecha_actualizacion: new Date().toISOString(), activa: true };
  const previa = leer_(db, 'AVISOS_CONTROL').find((x) => activa_(x) && x.clave === def.clave);
  if (previa) actualizarFilaPorId_(db, 'AVISOS_CONTROL', 'aviso_id', previa.aviso_id, fila);
  else agregarFila_(db, 'AVISOS_CONTROL', Object.assign({ aviso_id: crypto.randomUUID() }, fila));
  return Object.assign({}, fila);
}

// --- envío ---------------------------------------------------------------------------------------
async function enviar_(db, destinatarios, clave, sufijo, asunto, cuerpo, titulo) {
  const Notificaciones = require('./notificaciones');
  const res = [];
  for (const e of destinatarios) {
    const r = await Notificaciones.enviarCorreoModulo(db, { solicitudId: 'AVISO_CONTROL:' + clave + ':' + sufijo, destinatario: e, evento: 'CUMPLIMIENTO_AVISO_CONTROL',
      asunto, cuerpo: cuerpo + '\n\n--------------------------------------------------\nAviso de control programado en SIGSO (Panel de gerencia › Avisos de control).', ventanaMinutos: 60 * 24 * 40 });
    res.push({ destinatario: e, enviado: !!r.enviado, motivo: r.motivo || '' });
  }
  const nuevos = res.filter((x) => x.motivo !== 'deduplicado').map((x) => x.destinatario);
  require('./notificacionesApp').encolarLote(db, nuevos.map((e) => ({ destinatario: e, tipo: 'CUMPLIMIENTO_AVISO_CONTROL', titulo, mensaje: cuerpo.split('\n')[0].slice(0, 200),
    modulo_id: 'gerencia', texto_accion: 'Ver avisos de control', vidaHoras: 96 })));
  return res;
}

/**
 * Pase diario (9:00): el día elegido manda el estado; después, si está
 * «avisar al 100 %», manda una vez cuando se completa el período.
 */
async function revisarDiario(db, opciones) {
  const hoy = (opciones && opciones.hoy) || hoy_();
  const diaHoy = Number(hoy.slice(8, 10));
  const salida = [];
  for (const c of config_(db)) {
    if (!c.activo) continue;
    const def = CATALOGO.find((x) => x.clave === c.clave);
    const dest = c.destinatarios || destinatariosPorDefecto_(db, def.depto);
    if (!dest.length) continue;
    const e = estado(db, c.clave, hoy);
    if (diaHoy === c.dia) {
      const r = await enviar_(db, dest, c.clave, e.periodo + ':DIA', 'SIGSO — ' + def.titulo + ': ' + (e.clave === 'CONVENIOS' ? e.faltan.length + ' con cuotas vencidas' : e.hechos + ' de ' + e.total + ' listos'),
        textoEstado_(e, hoy), def.titulo + ' de ' + e.periodo_txt);
      salida.push({ clave: c.clave, tipo: 'DIA', enviados: r.filter((x) => x.enviado).length });
    } else if (c.avisar_100 && diaHoy > c.dia && e.completo) {
      const r = await enviar_(db, dest, c.clave, e.periodo + ':100', 'SIGSO — ' + def.titulo + ': ¡listo al 100 %!',
        def.titulo + ' de ' + e.periodo_txt + ': los ' + e.total + ' están listos (100 %).', def.titulo + ': 100 %');
      salida.push({ clave: c.clave, tipo: '100', enviados: r.filter((x) => x.enviado).length });
    }
  }
  return salida;
}

module.exports = { listar, guardar, estado, revisarDiario, textoEstado_, CATALOGO };
