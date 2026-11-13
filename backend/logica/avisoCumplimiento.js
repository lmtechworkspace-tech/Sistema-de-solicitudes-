'use strict';

/**
 * avisoCumplimiento.js — el AVISO SEMANAL del índice de cumplimiento (Plan de
 * control y certificación, pieza P4; aprobado por el dueño 13-11-2026).
 *
 * Pedido de gerencia: «controlar sin tener que perseguir a cada persona». Cada
 * lunes a las 8:00 (hora de Chile) SIGSO manda, por correo y a la campana:
 *  - a CADA PERSONA: su índice del mes, lo que vence esta semana, lo
 *    atrasado, las tareas dormidas y las que no tienen fecha;
 *  - a CADA JEFATURA: su equipo en una lista (orden alfabético, nunca ranking)
 *    con índice, variación y atrasos;
 *  - a GERENCIA (y Dirección / Encargado del SGC): la empresa en una página,
 *    el reparto verde/amarillo/rojo y las deudas más antiguas.
 *
 * Marcha blanca (decisión del plan, «la primera semana solo lo ven la persona
 * y su jefatura»): el resumen de gerencia sale desde GERENCIA_DESDE.
 *
 * Los primeros 7 días del mes el número principal es el del MES ANTERIOR ya
 * cerrado (el mes que empieza tiene muy pocos casos para decir algo); el mes
 * en curso va al lado.
 *
 * Mismo cálculo que las pantallas (cumplimientoResponsables.js). Sin costo:
 * correo por Resend como el resto de SIGSO, deduplicado por semana.
 */

const { leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const R = require('./cumplimientoResponsables');

const TZ = 'America/Santiago';
const EVENTO = { PERSONA: 'CUMPLIMIENTO_SEMANAL', JEFATURA: 'CUMPLIMIENTO_EQUIPO', GERENCIA: 'CUMPLIMIENTO_GERENCIA' };
const GERENCIA_DESDE = '2026-11-23';
const VENTANA_SEMANA_MIN = 6 * 24 * 60;
const MAX_LINEAS = 8;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const ESTADO_TXT = { ok: 'cumple', alerta: 'en observación', critico: 'bajo lo esperado', sin_dato: 'sin datos suficientes' };
const SEMAFORO = { ok: '🟢', alerta: '🟡', critico: '🔴', sin_dato: '⚪' };

function leer_(db, t) { try { return leerFilas_(db, t, COLUMNAS[t]); } catch (e) { return []; } }
function norm_(e) { return String(e || '').trim().toLowerCase(); }
function verdadero_(v) { return v === true || v === 'TRUE' || v === 1 || v === 'true'; }
function hoyChile_(ahora) { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(ahora || new Date()); }
function sumarDias_(dia, n) { return new Date(Date.parse(dia + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
function lunesDe_(dia) { const d = new Date(dia + 'T00:00:00Z'); return sumarDias_(dia, -((d.getUTCDay() + 6) % 7)); }
function diasEntre_(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }
function fechaTxt_(dia) { return dia ? Number(dia.slice(8, 10)) + ' ' + MES_CORTO[Number(dia.slice(5, 7)) - 1] : '—'; }
function mesTxt_(periodo) { return MESES[Number(periodo.slice(5, 7)) - 1] + ' ' + periodo.slice(0, 4); }
function pct_(p) { return p === null || p === undefined ? '—' : String(p).replace('.', ',') + ' %'; }
function plural_(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
function urlSigso_() { return process.env.PORTAL_URL || 'https://lmtechworkspace-tech.github.io/Sistema-de-solicitudes-/plataforma.html'; }
function variacion_(a, b, periodoB) {
  if (a === null || a === undefined || b === null || b === undefined) return '';
  const d = Math.round((a - b) * 10) / 10;
  if (Math.abs(d) < 0.1) return ' (igual que ' + MES_CORTO[Number(periodoB.slice(5, 7)) - 1] + ')';
  return ' (' + (d > 0 ? '▲ +' : '▼ −') + String(Math.abs(d)).replace('.', ',') + ' pts vs ' + MES_CORTO[Number(periodoB.slice(5, 7)) - 1] + ')';
}
function lista_(items, fmt) {
  const lineas = items.slice(0, MAX_LINEAS).map((x) => '  • ' + fmt(x));
  if (items.length > MAX_LINEAS) lineas.push('  … y ' + (items.length - MAX_LINEAS) + ' más en SIGSO.');
  return lineas.join('\n');
}

/** Qué mes es el titular: los primeros 7 días, el mes anterior (cerrado). */
function periodos_(hoy) {
  const actual = hoy.slice(0, 7);
  const anterior = R.moverPeriodo_(actual, -1);
  const principal = Number(hoy.slice(8, 10)) <= 7 ? anterior : actual;
  return { actual, principal, comparar: R.moverPeriodo_(principal, -1), cerrado: principal !== actual };
}

function nombres_(db) {
  const m = {};
  leer_(db, 'USUARIOS').forEach((u) => { if (u.email) m[norm_(u.email)] = u.nombre || u.email; });
  return m;
}

/** Lo que la persona tiene que mirar esta semana, con los mismos datos del índice. */
function resumenPersona_(db, email, hoy, ctx) {
  const p = periodos_(hoy);
  const op = { datos: ctx.datos, hoy };
  const r = R.calcularPersona_(db, email, p.principal, op);
  const ant = R.calcularPersona_(db, email, p.comparar, op);
  const enCurso = p.cerrado ? R.calcularPersona_(db, email, p.actual, op) : r;
  const lunes = lunesDe_(hoy), domingo = sumarDias_(lunes, 6);
  // Vence esta semana: tareas abiertas con fecha comprometida entre lunes y domingo.
  const semana = ctx.datos.tareas.filter((a) => norm_(a.responsable_email) === email && ['TERMINADA', 'CANCELADA', 'EN_REVISION'].indexOf(a.estado) === -1)
    .map((a) => ({ titulo: a.titulo, fecha: R.diaPlan_(a.fecha_compromiso) }))
    .filter((a) => a.fecha && a.fecha >= lunes && a.fecha <= domingo)
    .sort((x, y) => x.fecha.localeCompare(y.fecha));
  // Atrasado (del mes en curso): lo que venció y sigue sin hacer.
  const atrasado = [];
  enCurso.componentes.forEach((c) => c.detalle.forEach((x) => {
    if (x.estado === 'Atrasada' || x.estado === 'Sin hacer') {
      const meta = x.meta || x.plazo || x.fecha || '';
      atrasado.push({ que: x.titulo || x.tarea || x.tipo || '', meta, dias: meta ? diasEntre_(meta, hoy) : 0 });
    }
  }));
  atrasado.sort((a, b) => b.dias - a.dias);
  return { email, r, ant, enCurso, p, semana, atrasado, dormidas: enCurso.senales.detalle_dormidas, sinFecha: enCurso.senales.detalle_sin_fecha };
}
function hayAlgo_(s) {
  return s.r.indice !== null || s.enCurso.indice !== null || s.semana.length || s.atrasado.length || s.dormidas.length || s.sinFecha.length;
}

function textoPersona_(s, nombre) {
  const primer = String(nombre || '').split(' ')[0] || '';
  const partes = ['Hola' + (primer && primer.indexOf('@') === -1 ? ' ' + primer : '') + ':', ''];
  partes.push((s.p.cerrado ? 'Tu índice de cumplimiento de ' + mesTxt_(s.p.principal) + ' (mes cerrado): ' : 'Tu índice de cumplimiento de ' + mesTxt_(s.p.principal) + ', hasta hoy: ') +
    pct_(s.r.indice) + ' — ' + SEMAFORO[s.r.estado] + ' ' + ESTADO_TXT[s.r.estado] + variacion_(s.r.indice, s.ant.indice, s.p.comparar) + '.');
  if (s.p.cerrado && s.enCurso.indice !== null) partes.push(mesTxt_(s.p.actual).replace(/^./, (c) => c.toUpperCase()) + ' recién empieza: ' + pct_(s.enCurso.indice) + '.');
  if (s.r.indice === null) partes.push('Este mes todavía no hay casos suficientes para un número (cada componente cuenta desde 3).');
  if (s.semana.length) partes.push('', 'Vence esta semana:', lista_(s.semana, (x) => x.titulo + ' — ' + fechaTxt_(x.fecha)));
  if (s.atrasado.length) partes.push('', 'Atrasado (resta en tu índice hasta que lo cierres):', lista_(s.atrasado, (x) => x.que + ' — venció el ' + fechaTxt_(x.meta) + (x.dias > 0 ? ' (hace ' + plural_(x.dias, 'día', 'días') + ')' : '')));
  if (s.dormidas.length) partes.push('', 'Tareas dormidas (sin movimiento en 14 días): anota un avance o ciérralas.', lista_(s.dormidas, (x) => x.titulo + ' — último movimiento ' + fechaTxt_(x.sin_movimiento_desde)));
  if (s.sinFecha.length) partes.push('', 'Tareas sin fecha: ponles una para poder cumplirlas.', lista_(s.sinFecha, (x) => x.titulo));
  if (!s.semana.length && !s.atrasado.length && !s.dormidas.length && !s.sinFecha.length) partes.push('', 'No tienes nada atrasado ni dormido. ¡Buena semana!');
  partes.push('', 'Ver el detalle: ' + urlSigso_() + '#/mi_trabajo (pestaña «Mi cumplimiento»).',
    '', '--------------------------------------------------', 'Aviso semanal automático de SIGSO (índice de cumplimiento, lunes 8:00).');
  return partes.join('\n');
}

function textoJefatura_(equipo, nombres, hoy) {
  const p = periodos_(hoy);
  const filas = equipo.map((s) => {
    const n = nombres[s.email] || s.email;
    const extras = [];
    if (s.atrasado.length) extras.push(plural_(s.atrasado.length, 'atrasada', 'atrasadas'));
    if (s.dormidas.length) extras.push(plural_(s.dormidas.length, 'dormida', 'dormidas'));
    if (s.sinFecha.length) extras.push(plural_(s.sinFecha.length, 'sin fecha', 'sin fecha'));
    return { n, linea: SEMAFORO[s.r.estado] + ' ' + n + ': ' + pct_(s.r.indice) + variacion_(s.r.indice, s.ant.indice, p.comparar) + (extras.length ? ' · ' + extras.join(', ') : '') };
  }).sort((a, b) => a.n.localeCompare(b.n, 'es'));
  const atrasos = equipo.reduce((t, s) => t + s.atrasado.length, 0);
  const dormidas = equipo.reduce((t, s) => t + s.dormidas.length, 0);
  return ['Hola:', '',
    'Así va tu equipo en ' + mesTxt_(p.principal) + (p.cerrado ? ' (mes cerrado)' : ', hasta hoy') + ' (orden alfabético):', '',
    filas.map((f) => '  ' + f.linea).join('\n'), '',
    'En total: ' + plural_(atrasos, 'compromiso atrasado', 'compromisos atrasados') + ' y ' + plural_(dormidas, 'tarea dormida', 'tareas dormidas') + '.',
    'Si un atraso no depende de la persona (falta información del cliente, otra área), reprográmalo tú antes de que venza: así no resta.', '',
    'Ver el detalle: ' + urlSigso_() + ' → tu departamento → Equipo → «Cumplimiento del equipo».',
    '', '--------------------------------------------------', 'Aviso semanal automático de SIGSO para jefaturas (lunes 8:00).'].join('\n');
}

function textoGerencia_(todos, nombres, hoy) {
  const p = periodos_(hoy);
  const con = todos.filter((s) => s.r.indice !== null);
  const prom = con.length ? Math.round(con.reduce((t, s) => t + s.r.indice, 0) / con.length * 10) / 10 : null;
  const conAnt = todos.filter((s) => s.ant.indice !== null);
  const promAnt = conAnt.length ? Math.round(conAnt.reduce((t, s) => t + s.ant.indice, 0) / conAnt.length * 10) / 10 : null;
  const rep = { ok: 0, alerta: 0, critico: 0, sin_dato: 0 };
  todos.forEach((s) => { rep[s.r.estado]++; });
  const rojos = todos.filter((s) => s.r.estado === 'critico').map((s) => nombres[s.email] || s.email).sort((a, b) => a.localeCompare(b, 'es'));
  const deudas = [];
  todos.forEach((s) => s.atrasado.forEach((x) => deudas.push(Object.assign({ quien: nombres[s.email] || s.email }, x))));
  deudas.sort((a, b) => b.dias - a.dias);
  const dormidas = todos.reduce((t, s) => t + s.dormidas.length, 0);
  const sinFecha = todos.reduce((t, s) => t + s.sinFecha.length, 0);
  const partes = ['Resumen semanal de cumplimiento — ' + mesTxt_(p.principal) + (p.cerrado ? ' (mes cerrado)' : ', hasta hoy') + '.', '',
    'Índice promedio: ' + pct_(prom) + variacion_(prom, promAnt, p.comparar) + ', con ' + con.length + ' de ' + todos.length + ' personas medidas.',
    'Reparto: 🟢 ' + rep.ok + ' cumplen · 🟡 ' + rep.alerta + ' en observación · 🔴 ' + rep.critico + ' bajo 75 % · ⚪ ' + rep.sin_dato + ' sin datos.'];
  if (rojos.length) partes.push('Bajo 75 %: ' + rojos.join(', ') + '.');
  partes.push('Señales: ' + plural_(dormidas, 'tarea dormida', 'tareas dormidas') + ' y ' + plural_(sinFecha, 'tarea sin fecha', 'tareas sin fecha') + ' en toda la empresa.');
  if (deudas.length) partes.push('', 'Las deudas más antiguas:', lista_(deudas, (x) => x.quien + ' — ' + x.que + ' (venció el ' + fechaTxt_(x.meta) + ', hace ' + plural_(x.dias, 'día', 'días') + ')'));
  partes.push('', 'Ver el detalle: ' + urlSigso_() + '#/gerencia/cumplimiento',
    '', '--------------------------------------------------', 'Aviso semanal automático de SIGSO para gerencia (lunes 8:00).');
  return partes.join('\n');
}

/** Quién recibe el resumen de gerencia: rol GERENCIA y Dirección / Encargado del SGC. */
function destinatariosGerencia_(db) {
  const set = {};
  leer_(db, 'USUARIOS').filter((u) => u.email && u.rol === 'GERENCIA' && (u.activo === undefined || u.activo === '' || verdadero_(u.activo))).forEach((u) => { set[norm_(u.email)] = true; });
  leer_(db, 'SGC_ROLES').filter((r) => verdadero_(r.activo) && ['ENCARGADO_SGC', 'DIRECCION'].indexOf(r.rol_sgc) !== -1).forEach((r) => { set[norm_(r.usuario_email)] = true; });
  return Object.keys(set).filter(Boolean);
}
function jefaturas_(db) {
  const set = {};
  leer_(db, 'JEFATURAS').filter((j) => verdadero_(j.activo)).forEach((j) => { set[norm_(j.jefe_email)] = true; });
  leer_(db, 'CI_MIEMBROS').filter((m) => m.rol === 'JEFATURA' && (m.activa === undefined || verdadero_(m.activa))).forEach((m) => { set[norm_(m.usuario_email)] = true; });
  return Object.keys(set).filter(Boolean);
}

/**
 * Arma los avisos sin enviarlos. `hoy` se puede fijar (pruebas / vista previa).
 * Devuelve [{ destinatario, evento, asunto, cuerpo, notif }].
 */
function armarAvisos(db, opciones) {
  const o = opciones || {};
  const hoy = o.hoy || hoyChile_();
  const datos = R.cargarDatos_(db);
  const ctx = { datos };
  const nombres = nombres_(db);
  const emails = R.personasEmpresa_(db, datos);
  const resumenes = {};
  emails.forEach((e) => { resumenes[e] = resumenPersona_(db, e, hoy, ctx); });
  const avisos = [];
  const lunes = lunesDe_(hoy);

  Object.keys(resumenes).forEach((e) => {
    const s = resumenes[e];
    if (!hayAlgo_(s)) return;
    const pend = s.atrasado.length + s.dormidas.length;
    avisos.push({
      destinatario: e, evento: EVENTO.PERSONA,
      asunto: 'SIGSO — Tu cumplimiento: ' + pct_(s.r.indice) + (pend ? ' · ' + plural_(pend, 'pendiente', 'pendientes') : ''),
      cuerpo: textoPersona_(s, nombres[e]),
      notif: { destinatario: e, tipo: EVENTO.PERSONA, titulo: 'Tu índice de cumplimiento: ' + pct_(s.r.indice),
        mensaje: pend ? 'Tienes ' + plural_(pend, 'cosa', 'cosas') + ' atrasadas o dormidas. Revísalas en «Mi cumplimiento».' : 'Revisa cómo vas en «Mi cumplimiento».',
        modulo_id: 'mi_trabajo', texto_accion: 'Ver mi cumplimiento', vidaHoras: 72 }
    });
  });

  let Jefatura = null;
  try { Jefatura = require('./jefatura'); } catch (e) { /* sin jefaturas */ }
  if (Jefatura) {
    jefaturas_(db).forEach((jefe) => {
      const equipo = Jefatura.obtenerEquipoJefe_(db, jefe).map(norm_).filter((e) => e !== jefe)
        .map((e) => resumenes[e] || resumenPersona_(db, e, hoy, ctx)).filter(hayAlgo_);
      if (!equipo.length) return;
      avisos.push({
        destinatario: jefe, evento: EVENTO.JEFATURA,
        asunto: 'SIGSO — Cumplimiento de tu equipo (' + plural_(equipo.length, 'persona', 'personas') + ')',
        cuerpo: textoJefatura_(equipo, nombres, hoy),
        notif: { destinatario: jefe, tipo: EVENTO.JEFATURA, titulo: 'El cumplimiento de tu equipo esta semana', mensaje: 'Revisa quién tiene atrasos o tareas dormidas.',
          modulo_id: 'jefatura', texto_accion: 'Ver mi equipo', vidaHoras: 72 }
      });
    });
  }

  if (hoy >= GERENCIA_DESDE || o.forzarGerencia) {
    const todos = Object.keys(resumenes).map((e) => resumenes[e]).filter(hayAlgo_);
    if (todos.length) {
      destinatariosGerencia_(db).forEach((g) => {
        avisos.push({
          destinatario: g, evento: EVENTO.GERENCIA,
          asunto: 'SIGSO — Resumen semanal de cumplimiento (' + fechaTxt_(lunes) + ')',
          cuerpo: textoGerencia_(todos, nombres, hoy),
          notif: { destinatario: g, tipo: EVENTO.GERENCIA, titulo: 'Resumen semanal de cumplimiento', mensaje: 'El índice de la empresa, el reparto y las deudas más antiguas.',
            modulo_id: 'gerencia', texto_accion: 'Ver cumplimiento', vidaHoras: 72 }
        });
      });
    }
  }
  return avisos;
}

/** Envía los avisos de la semana. Idempotente: una vez por persona y semana. */
async function enviarAvisoSemanal(db, opciones) {
  const o = opciones || {};
  const hoy = o.hoy || hoyChile_();
  const avisos = armarAvisos(db, Object.assign({}, o, { hoy }));
  const Notificaciones = require('./notificaciones');
  const NotificacionesApp = require('./notificacionesApp');
  const clave = 'CUMPLIMIENTO:' + lunesDe_(hoy);
  const resultados = [];
  const enviados = [];
  for (const a of avisos) {
    const r = await Notificaciones.enviarCorreoModulo(db, { solicitudId: clave, destinatario: a.destinatario, evento: a.evento,
      asunto: a.asunto, cuerpo: a.cuerpo, ventanaMinutos: VENTANA_SEMANA_MIN });
    resultados.push({ destinatario: a.destinatario, evento: a.evento, enviado: !!r.enviado, motivo: r.motivo || '' });
    if (r.motivo !== 'deduplicado') enviados.push(a.notif);
  }
  NotificacionesApp.encolarLote(db, enviados);
  return { semana: lunesDe_(hoy), avisos: resultados.length, enviados: resultados.filter((x) => x.enviado).length, resultados };
}

// --- acciones para Administración: ver antes de que salga, y mandar ahora --------------
function previsualizar(db, data, contexto) {
  if (!contexto || contexto.rol !== 'ADM') return { _forbidden: true, message: 'Solo Administración puede ver los avisos de otras personas.' };
  const d = data || {};
  const avisos = armarAvisos(db, { hoy: d.hoy, forzarGerencia: true });
  return { semana: lunesDe_(d.hoy || hoyChile_()), gerencia_desde: GERENCIA_DESDE,
    avisos: avisos.map((a) => ({ destinatario: a.destinatario, evento: a.evento, asunto: a.asunto, cuerpo: a.cuerpo })) };
}
async function enviarAhora(db, data, contexto) {
  if (!contexto || contexto.rol !== 'ADM') return { _forbidden: true, message: 'Solo Administración puede enviar el aviso semanal a mano.' };
  return enviarAvisoSemanal(db, {});
}

module.exports = { armarAvisos, enviarAvisoSemanal, previsualizar, enviarAhora, periodos_, lunesDe_, GERENCIA_DESDE, EVENTO };
