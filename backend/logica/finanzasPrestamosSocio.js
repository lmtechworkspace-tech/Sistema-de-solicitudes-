'use strict';

/**
 * finanzasPrestamosSocio.js — Préstamos y aportes: la plata que entra «de afuera» (Finanzas v5.9, 02-11-2026;
 * punto 5 de la reunión con gerencia y su segunda revisión).
 *
 * Gerencia: «platas que vienen de afuera o platas que puse yo» y «que me devuelvan mi plata». No son ingresos de la
 * empresa ni dinero de clientes: entran, se usan y (si son préstamo) hay que devolverlas. Hasta hoy la planilla ya
 * las apartaba del FLUJO (plan «Préstamo recibido» / «Devolución de préstamo»), pero nadie veía cuánto se debe y a quién.
 *
 * Aquí se juntan, desde la planilla de TODAS las cuentas y meses, por quién prestó (la columna NOMBRE):
 *   - Préstamo recibido     → entró (se debe devolver)
 *   - Devolución de préstamo → se devolvió
 *   - Aporte de socio       → entró y NO se devuelve (capital)
 *   saldo por devolver = entró − devuelto
 * Cada prestamista puede tener una ficha (quién es, qué tipo, cuándo se acordó devolver), guardada cifrada.
 */

const B = require('./finanzasBoveda');
const Base = require('./finanzasBase');
const F = require('./finanzasBancos');
const { errorValidacion } = require('./errores');

const I = F.interno;
const N = (s) => I.normalizar_(s);
const TIPOS = { GERENCIA: 'Gerencia o socio', TERCERO: 'Tercero', EMPRESA: 'Empresa del grupo' };
const PLAN_APORTE = 'Aporte de socio';

function db_() { const d = I.db_(); d.exec('CREATE TABLE IF NOT EXISTS FIN_AJUSTES (clave TEXT PRIMARY KEY, datos TEXT NOT NULL, actualizado_en TEXT, actualizado_por TEXT)'); return d; }
function asegurarPlanes_() {
  try {
    const Cat = require('./finanzasCatalogos');
    Cat.asegurar_('CONCEPTO', 'Préstamo recibido', { grupo: 'INGRESO' }, 'sistema');
    Cat.asegurar_('CONCEPTO', 'Devolución de préstamo', { grupo: 'EGRESO' }, 'sistema');
    Cat.asegurar_('CONCEPTO', PLAN_APORTE, { grupo: 'INGRESO' }, 'sistema');
  } catch (e) { /* sin catálogo: quedan en la semilla */ }
}
const clave_ = (nombre) => 'prestamista|' + N(nombre);
function fichas_() {
  const m = new Map();
  db_().prepare("SELECT clave, datos, actualizado_en, actualizado_por FROM FIN_AJUSTES WHERE clave LIKE 'prestamista|%'").all()
    .forEach((r) => m.set(r.clave.slice('prestamista|'.length), Object.assign({ en: r.actualizado_en, por: r.actualizado_por }, I.des_(r.datos))));
  return m;
}
/** Qué es una fila de la planilla para este informe: 'entra' (préstamo), 'devuelve', 'aporte' o null. */
function tipoFila_(f) {
  const p = N(f.plan);
  if (/APORTE/.test(p)) return 'aporte';
  if (!/PRESTAMO/.test(p)) return null;
  if (/DEVOLUCION/.test(p) || f.monto < 0) return f.monto < 0 ? 'devuelve' : 'entra';
  return 'entra';
}

/** Las filas de préstamos y aportes de todas las cuentas y meses (o hasta un mes). */
function filas_(db, hasta) {
  const H = require('./finanzasHoja');
  const ctx = H.contexto_(db);
  const meses = I.db_().prepare('SELECT DISTINCT periodo FROM FIN_MOVIMIENTOS WHERE periodo IS NOT NULL ORDER BY periodo').all().map((r) => r.periodo)
    .filter((p) => /^\d{4}-\d{2}$/.test(p) && (!hasta || p <= hasta));
  const out = [];
  meses.forEach((mes) => [...ctx.cuentas.values()].forEach((cu) => {
    H.construir_(db, cu, mes, ctx).filas.forEach((f) => {
      const t = tipoFila_(f);
      if (!t || !f.monto) return;
      out.push({ fecha: f.fecha, periodo: mes, cuenta: cu.banco + ' ···' + cu.ultimos4, empresa: cu.empresa, nombre: Base.txt_(f.nombre) || '(sin nombre)', obs: f.obs || '', plan: f.plan || '', monto: f.monto, tipo: t, fila_id: f.id || '' });
    });
  }));
  return out;
}

const prestamos = B.conBoveda('', function (db, data) {
  asegurarPlanes_();
  const hoy = Base.hoy_();
  const fichas = fichas_();
  const filas = filas_(db, Base.txt_(data && data.hasta));
  const grupos = new Map();
  filas.forEach((f) => {
    const k = N(f.nombre);
    const g = grupos.get(k) || { clave: k, nombre: f.nombre, entro: 0, devuelto: 0, aportes: 0, movimientos: [] };
    if (f.tipo === 'entra') g.entro += Math.abs(f.monto);
    else if (f.tipo === 'devuelve') g.devuelto += Math.abs(f.monto);
    else g.aportes += Math.abs(f.monto);
    g.movimientos.push(f);
    grupos.set(k, g);
  });
  // Quien tiene ficha pero todavía no movió plata también aparece (un préstamo acordado).
  fichas.forEach((fi, k) => { if (!grupos.has(k)) grupos.set(k, { clave: k, nombre: fi.nombre || k, entro: 0, devuelto: 0, aportes: 0, movimientos: [] }); });
  const lista = [...grupos.values()].map((g) => {
    const fi = fichas.get(g.clave) || {};
    const saldo = g.entro - g.devuelto;
    g.movimientos.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
    const ult = g.movimientos[g.movimientos.length - 1];
    const vencido = saldo > 0 && fi.fecha_devolucion && fi.fecha_devolucion < hoy;
    return Object.assign(g, { nombre: fi.nombre || g.nombre, tipo: fi.tipo || '', tipo_nombre: TIPOS[fi.tipo] || 'Sin ficha', acordado: fi.acordado || 0, fecha_devolucion: fi.fecha_devolucion || '',
      nota: fi.nota || '', con_ficha: !!fichas.get(g.clave), saldo, ultimo: ult ? ult.fecha : '', vencido: !!vencido,
      estado: saldo > 0 ? (vencido ? 'VENCIDO' : 'POR_DEVOLVER') : g.entro ? 'DEVUELTO' : g.aportes ? 'APORTE' : 'SIN_MOVIMIENTO' });
  }).sort((a, b) => b.saldo - a.saldo || b.aportes - a.aportes || a.nombre.localeCompare(b.nombre, 'es'));
  const T = { por_devolver: 0, devuelto: 0, entro: 0, aportes: 0, vencido: 0, prestamistas: 0 };
  lista.forEach((g) => { T.entro += g.entro; T.devuelto += g.devuelto; T.aportes += g.aportes; if (g.saldo > 0) { T.por_devolver += g.saldo; T.prestamistas++; } if (g.vencido) T.vencido += g.saldo; });
  return { prestamistas: lista, totales: T, tipos: TIPOS, planes: { entra: 'Préstamo recibido', devuelve: 'Devolución de préstamo', aporte: PLAN_APORTE },
    como: 'Se anota en la planilla como cualquier movimiento: en NOMBRE quién prestó y en PLAN DE CUENTA «Préstamo recibido», «Devolución de préstamo» o «' + PLAN_APORTE + '». No suman como ingreso ni gasto.' };
});

/** Ficha de un prestamista. data: { nombre, tipo, acordado, fecha_devolucion, nota, borrar } */
const guardarPrestamista = Base.conCapacidad('PLANIFICAR', '', function (db, data, contexto, x) {
  const nombre = Base.txt_(data && data.nombre).slice(0, 120);
  if (!nombre) return errorValidacion('nombre', 'Escribe el nombre como va en la planilla (columna NOMBRE).');
  if (data.borrar) { db_().prepare('DELETE FROM FIN_AJUSTES WHERE clave = ?').run(clave_(nombre)); x.registrar('PRESTAMISTA_BORRAR', nombre.slice(0, 60)); return { ok: true }; }
  const tipo = Base.txt_(data.tipo).toUpperCase();
  if (tipo && !TIPOS[tipo]) return errorValidacion('tipo', 'Tipo no válido.');
  let acordado = 0;
  if (Base.txt_(data.acordado) !== '') { const m = Base.montoClp_(String(data.acordado)); if (!m.ok || m.valor < 0) return errorValidacion('acordado', m.error || 'Monto no válido.'); acordado = m.valor; }
  const fecha = Base.txt_(data.fecha_devolucion) ? Base.fechaCivil_(data.fecha_devolucion) : '';
  if (Base.txt_(data.fecha_devolucion) && !fecha) return errorValidacion('fecha_devolucion', 'Fecha no válida.');
  db_().prepare('INSERT INTO FIN_AJUSTES (clave, datos, actualizado_en, actualizado_por) VALUES (?,?,?,?) ON CONFLICT(clave) DO UPDATE SET datos = excluded.datos, actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por')
    .run(clave_(nombre), I.cif_({ nombre, tipo, acordado, fecha_devolucion: fecha, nota: Base.txt_(data.nota).slice(0, 300) }), Base.ahora_(), x.nombre);
  x.registrar('PRESTAMISTA', nombre.slice(0, 60) + (acordado ? ' · ' + Base.plata_(acordado) : ''));
  return { ok: true };
});

module.exports = { prestamos, guardarPrestamista, tipoFila_, filas_, asegurarPlanes_, PLAN_APORTE, TIPOS };
