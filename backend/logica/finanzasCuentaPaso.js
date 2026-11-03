'use strict';

/**
 * finanzasCuentaPaso.js — La cuenta de paso (Finanzas v5.7, 02-11-2026; paso 3 de la reunión con gerencia).
 *
 * Todo el dinero de los clientes entra al BCI. Desde ahí se pagan sus IVA, imposiciones y obligaciones, y los
 * honorarios de la empresa se traspasan a la cuenta nueva de la empresa (donde corre su flujo: sueldos, arriendo,
 * caja chica…). Por eso el BCI es una CUENTA DE PASO: al cierre debe quedar en $0, y si no, SIGSO dice qué falta.
 *
 * Con las mismas cifras de la planilla, desde el mes en que empieza el control:
 *   saldo al cierre = saldo con que empezó el control
 *                   + honorarios que faltan traspasar   (ABONO + ABONO RENTA − lo traspasado a la cuenta empresa)
 *                   + dinero de clientes por pagar       (SALDO + PENDIENTE + IVA/imposiciones sin grupo + de otros meses)
 *                   + préstamos                          (entraron − se devolvieron)
 *                   + lo que falta anotar o completar
 * Cada parte dice qué hacer para llevarla a cero.
 */

const B = require('./finanzasBoveda');
const Base = require('./finanzasBase');
const F = require('./finanzasBancos');
const { errorValidacion } = require('./errores');

const I = F.interno;
const N = (s) => I.normalizar_(s);
const PER_ = /^\d{4}-\d{2}$/;
const PLAN_TRASPASO = 'Traspaso a cuenta empresa';
const TOLERANCIA = 1000; // pesos: menos que esto es «en cero» (comisiones y redondeos)

let preparada_ = null;
Base.registrarEsquema_(() => { preparada_ = null; });
function db_() {
  const d = I.db_();
  if (preparada_ === d) return d;
  d.exec('CREATE TABLE IF NOT EXISTS FIN_AJUSTES (clave TEXT PRIMARY KEY, datos TEXT NOT NULL, actualizado_en TEXT, actualizado_por TEXT)');
  try {
    const Cat = require('./finanzasCatalogos');
    Cat.asegurar_('CONCEPTO', PLAN_TRASPASO, { grupo: 'EGRESO' }, 'sistema');
    Cat.asegurar_('CONCEPTO', 'Devolución de préstamo', { grupo: 'EGRESO' }, 'sistema');
    Cat.asegurar_('CONCEPTO', 'Préstamo recibido', { grupo: 'INGRESO' }, 'sistema');
    Cat.asegurar_('CONCEPTO', 'Aporte de socio', { grupo: 'INGRESO' }, 'sistema');
  } catch (e) { /* sin catálogo: quedan en la semilla */ }
  preparada_ = d;
  return d;
}
const clave_ = (id) => 'cuenta-paso|' + id;
function config_(cuentaId) {
  const r = db_().prepare('SELECT datos, actualizado_en, actualizado_por FROM FIN_AJUSTES WHERE clave = ?').get(clave_(cuentaId));
  if (!r) return null;
  const x = I.des_(r.datos);
  return x && x.activa ? Object.assign({ en: r.actualizado_en, por: r.actualizado_por }, x) : null;
}
function mesMas_(p, n) { const [a, m] = p.split('-').map(Number); return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 7); }
const esTraspaso_ = (plan) => /(^|\s)TRASPASO/.test(N(plan));
// Préstamos y aportes de socios: plata de afuera, ni honorario ni de clientes (v5.9 suma los aportes).
const esPrestamo_ = (plan) => /PRESTAMO|APORTE/.test(N(plan));

/** El control de la cuenta de paso hasta un mes (o null si la cuenta no es de paso o el mes es anterior al control). */
function control_(db, cuenta, periodo, ctx) {
  const cfg = config_(cuenta.id);
  if (!cfg || !PER_.test(periodo) || periodo < cfg.desde) return null;
  const H = require('./finanzasHoja');
  ctx = ctx || H.contexto_(db);
  const meses = []; for (let p = cfg.desde; p <= periodo && meses.length < 36; p = mesMas_(p, 1)) meses.push(p);
  const T = { honorarios: 0, traspasado: 0, clientes: 0, prestamos: 0, sin_completar: 0 };
  let inicial = null, final = null, cuadraCartola = true;
  const todas = []; // las filas del mes, para el corte semanal
  const delControl = []; // v5.9: las filas de TODO el control, para decir de qué cliente es el saldo de cada semana
  const porMes = meses.map((p) => {
    const h = H.construir_(db, cuenta, p, ctx);
    if (p === periodo) h.filas.forEach((f) => todas.push(f));
    // Un grupo decidido como honorario ya no es dinero del cliente: lo que sobró pasa a «por traspasar».
    const honorario = new Set((h.grupos || []).filter((g) => g.decision === 'ABONO' || g.decision === 'ABONO RENTA').map((g) => g.letra));
    h.filas.forEach((f) => { if (!(f.grupo && honorario.has(f.grupo))) delControl.push(f); });
    const t = h.totales || {};
    let tras = 0, pres = 0;
    h.filas.forEach((f) => { if (f.que && f.que.k === 'tra') { if (esPrestamo_(f.plan)) pres += f.monto; else tras += f.monto; } });
    const m = { periodo: p, honorarios: (t.ABONO || 0) + (t['ABONO RENTA'] || 0), traspasado: -tras, clientes: (t.SALDO || 0) + (t.PENDIENTE || 0) + (t.FONDOS || 0) + (t.OTRO_MES || 0), prestamos: pres, sin_completar: t.SIN_COMPLETAR || 0,
      saldo_final: h.cartola ? h.cartola.saldo_final : null };
    if (p === cfg.desde) inicial = h.cartola ? h.cartola.saldo_inicial : null;
    if (h.cartola) { final = h.cartola.saldo_final; if (!h.cartola.cuadra || h.cartola.n_cortes) cuadraCartola = false; } else final = null;
    Object.keys(T).forEach((k) => { T[k] += m[k]; });
    return m;
  });
  const porTraspasar = T.honorarios - T.traspasado;
  const calculado = (inicial || 0) + porTraspasar + T.clientes + T.prestamos + T.sin_completar;
  // Lo de los meses anteriores del control entra con sus cifras de cierre; las semanas del mes suman sus filas encima.
  const ant = porMes.slice(0, -1).reduce((a, m) => ({ por_traspasar: a.por_traspasar + m.honorarios - m.traspasado, prestamos: a.prestamos + m.prestamos, sin_completar: a.sin_completar + m.sin_completar }), { por_traspasar: 0, prestamos: 0, sin_completar: 0 });
  const semanas = semanas_(cuenta, periodo, todas, inicial || 0, ant, { por_traspasar: porTraspasar, saldo: final, prestamos: T.prestamos, sin_completar: T.sin_completar }, delControl);
  const enCero = final !== null && Math.abs(final) <= TOLERANCIA;
  const pendientes = [];
  if (porTraspasar > TOLERANCIA) pendientes.push({ id: 'traspasar', monto: porTraspasar, titulo: 'Honorarios por traspasar a la cuenta de la empresa', como: 'Traspasa ' + Base.plata_(porTraspasar) + ' a la cuenta de la empresa y anota ese movimiento con el plan «' + PLAN_TRASPASO + '».' });
  if (porTraspasar < -TOLERANCIA) pendientes.push({ id: 'traspaso_de_mas', monto: porTraspasar, titulo: 'Se traspasó más de lo que había de honorarios', como: 'Se pasaron ' + Base.plata_(-porTraspasar) + ' de más a la cuenta de la empresa: puede ser dinero de clientes. Revisa los traspasos.' });
  if (T.clientes > TOLERANCIA) pendientes.push({ id: 'clientes', monto: T.clientes, titulo: 'Dinero de clientes que sigue en la cuenta', como: 'Es lo que mandaron para su IVA o imposiciones y todavía no se paga, o lo que quedó a su favor (SALDO) o sin decidir (PENDIENTE). Al pagarlo, la cuenta baja.' });
  if (T.clientes < -TOLERANCIA) pendientes.push({ id: 'clientes_neg', monto: T.clientes, titulo: 'Se pagó por clientes más de lo que mandaron', como: 'La cuenta puso ' + Base.plata_(-T.clientes) + ' por clientes: hay que cobrárselo o revisar los grupos.' });
  if (Math.abs(T.prestamos) > TOLERANCIA) pendientes.push({ id: 'prestamos', monto: T.prestamos, titulo: T.prestamos > 0 ? 'Préstamos recibidos sin devolver' : 'Se devolvió más de lo recibido en préstamos', como: 'Movimientos con plan de préstamo desde que empezó el control.' });
  if (Math.abs(T.sin_completar) > 0) pendientes.push({ id: 'sin_completar', monto: T.sin_completar, titulo: 'Movimientos sin anotar o sin completar', como: 'Completa la planilla: hasta entonces no se sabe de quién es ese dinero.' });
  if (inicial && Math.abs(inicial) > TOLERANCIA) pendientes.push({ id: 'inicial', monto: inicial, titulo: 'Saldo con que empezó el control (' + Base.nombreMes_(cfg.desde) + ')', como: 'Lo que ya había en la cuenta antes de usarla como cuenta de paso: decide si es de clientes o se traspasa.' });
  let destino = null;
  if (cfg.destino_ref) { const c = I.cuentasMapa_().get(cfg.destino_ref); if (c) destino = { id: c.id, nombre: c.banco + ' ···' + c.ultimos4 + ' · ' + c.empresa }; }
  return { desde: cfg.desde, destino, periodo, saldo_final: final, saldo_inicial: inicial, por_traspasar: porTraspasar, honorarios: T.honorarios, traspasado: T.traspasado, clientes: T.clientes, prestamos: T.prestamos,
    sin_completar: T.sin_completar, diferencia: final === null ? null : final - calculado, en_cero: enCero, semanas, cuadra_cartola: cuadraCartola, pendientes, meses: porMes, tolerancia: TOLERANCIA, plan_traspaso: PLAN_TRASPASO };
}

/**
 * Corte semanal del mes (gerencia: «cada semana debe estar en cero»). Para cada semana (lunes a domingo, y el último
 * día del mes): el saldo del banco ese día y cuánto de eso son honorarios por traspasar, contando las filas por su
 * fecha del banco. Lo demás es dinero de clientes por pagar (o lo que falta anotar). La última semana usa las cifras
 * del cierre del mes (con los grupos ya decididos), así el último corte es el mismo control del mes.
 */
function saldoAl_(cuentaId, fecha) {
  const r = I.db_().prepare('SELECT datos FROM FIN_MOVIMIENTOS WHERE cuenta_ref = ? AND fecha <= ? ORDER BY fecha DESC, orden DESC LIMIT 40').all(cuentaId, fecha)
    .map((x) => I.des_(x.datos)).find((m) => !m.sin_cartola && typeof m.saldo === 'number');
  return r ? r.saldo : null;
}
function semanas_(cuenta, periodo, filas, inicial, ant, cierre, delControl) {
  const fin = Base.ultimoDia_(periodo), cortes = [];
  for (let d = periodo + '-01'; d <= fin; d = Base.sumarDias_(d, 1)) {
    if (new Date(d + 'T12:00:00Z').getUTCDay() === 0 || d === fin) cortes.push(d);
  }
  let desde = periodo + '-01';
  return cortes.map((hasta) => {
    const ultima = hasta === fin;
    const saldo = ultima && cierre.saldo !== null ? cierre.saldo : saldoAl_(cuenta.id, hasta);
    let porTraspasar = ant.por_traspasar, sinCompletar = ant.sin_completar, prestamos = ant.prestamos;
    if (ultima) { porTraspasar = cierre.por_traspasar; prestamos = cierre.prestamos; sinCompletar = cierre.sin_completar; }
    else filas.forEach((f) => {
      const fb = f.fecha_banco || f.fecha; if (!fb || fb > hasta) return;
      const k = f.que && f.que.k;
      if (!f.grupo && (k === 'ing' || k === 'gas')) porTraspasar += f.monto;
      else if (k === 'tra') { if (esPrestamo_(f.plan)) prestamos += f.monto; else porTraspasar += f.monto; }
      else if (k === 'rev' || k === 'falta') sinCompletar += f.monto;
    });
    const clientes = saldo === null ? null : saldo - inicial - porTraspasar - prestamos - sinCompletar;
    const s = { desde, hasta, saldo, por_traspasar: porTraspasar, clientes, sin_completar: sinCompletar, prestamos, en_cero: saldo !== null && Math.abs(saldo) <= TOLERANCIA };
    // v5.9 · «Me sobraron 200 mil, ¿de qué son?»: el dinero de clientes de esa semana, cliente por cliente (lo que
    // mandó − lo que se pagó por él, desde que empezó el control). Lo que no calza con ningún cliente queda «sin identificar».
    if (clientes !== null) {
      const por = new Map();
      (delControl || []).forEach((f) => {
        const fb = f.fecha_banco || f.fecha; if (!fb || fb > hasta || !f.monto) return;
        const k = f.que && f.que.k; if (!(k === 'fon' || (f.grupo && k !== 'tra'))) return;
        const clave = f.cliente_id || N(f.nombre) || '?';
        const x = por.get(clave) || { cliente: f.nombre || 'Sin nombre', cliente_id: f.cliente_id || '', monto: 0 }; x.monto += f.monto; por.set(clave, x);
      });
      s.detalle = [...por.values()].filter((x) => Math.abs(x.monto) > TOLERANCIA).sort((a, b) => b.monto - a.monto);
      s.sin_identificar = clientes - s.detalle.reduce((a, x) => a + x.monto, 0);
      if (Math.abs(s.sin_identificar) <= TOLERANCIA) s.sin_identificar = 0;
    }
    desde = Base.sumarDias_(hasta, 1);
    return s;
  });
}

const guardar = Base.conCapacidad('CONFIGURAR', '', function (db, data, contexto, x) {
  db_();
  const cuenta = I.cuentasMapa_().get(Base.txt_(data && data.cuenta_ref));
  if (!cuenta) return errorValidacion('cuenta_ref', 'Esa cuenta no existe.');
  const activa = data.activa !== false;
  const desde = Base.txt_(data.desde);
  if (activa && !PER_.test(desde)) return errorValidacion('desde', 'Elige desde qué mes la cuenta funciona como cuenta de paso.');
  const destino = Base.txt_(data.destino_ref);
  if (destino && (destino === cuenta.id || !I.cuentasMapa_().get(destino))) return errorValidacion('destino_ref', 'Elige otra cuenta como cuenta de la empresa.');
  db_().prepare('INSERT INTO FIN_AJUSTES (clave, datos, actualizado_en, actualizado_por) VALUES (?,?,?,?) ON CONFLICT(clave) DO UPDATE SET datos = excluded.datos, actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por')
    .run(clave_(cuenta.id), I.cif_({ activa, desde, destino_ref: destino }), Base.ahora_(), x.nombre);
  x.registrar('CUENTA_DE_PASO', cuenta.banco + ' ···' + cuenta.ultimos4 + (activa ? ' desde ' + desde : ' (desactivada)'));
  return { ok: true };
});

module.exports = { guardar, control_, config_, esTraspaso_, esPrestamo_, PLAN_TRASPASO, TOLERANCIA };
