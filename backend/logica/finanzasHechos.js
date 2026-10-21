'use strict';

/**
 * finanzasHechos.js — la ÚNICA lectura de los hechos económicos de Finanzas
 * (2026-10-20; FIN-05, FIN-16, FIN-28/T28, FIN-34, FIN-44; corrección v2 I01).
 *
 * Un hecho es una pieza de dinero con su clasificación. Viene de dos fuentes:
 *  - BANCO: cada movimiento de la cartola (o sus partes, si se dividió). Es la
 *    evidencia bancaria; su clasificación la pone una persona.
 *  - REGISTRO: cada distribución de una operación registrada a mano o por lote
 *    (finanzasOperaciones.js) que TODAVÍA no está conciliada con el banco. Al
 *    conciliarla, su clasificación pasa al movimiento del banco y la operación
 *    deja de contarse aquí: el hecho se cuenta UNA sola vez, venga primero el
 *    registro o el banco.
 *
 * IDENTIDAD ECONÓMICA (corrección v2, I01):
 *  - Al conciliar, cada parte del movimiento guarda `origen_ref` ('op:<id>:<i>'):
 *    la parte del registro que pasó a ser. Lo que apuntaba a esa parte
 *    (aplicaciones a facturas, por ejemplo) sigue encontrándola con
 *    resolverRef_ / alias_, sin quedar huérfano.
 *  - POSIBLE DUPLICADO: una operación confirmada sin banco y un movimiento del
 *    banco YA CLASIFICADO y sin vínculo, de la misma empresa, sentido y monto
 *    exacto, a ±N días (parámetro conciliacion_dias, 10) y con cuenta
 *    compatible. Coincidir no prueba que sean el mismo cobro: no se fusionan ni
 *    se borran. Mientras una persona no decida, CUENTA EL BANCO (la evidencia)
 *    y la operación queda fuera de las cifras como «pendiente de identidad»
 *    (conflictos_), visible en calidad, Registro y Conciliación. Si la persona
 *    concilia, es un solo hecho; si marca «son distintas», cuentan las dos.
 *    Un movimiento todavía sin clasificar no cuenta, así que no hay conflicto.
 *
 * Todo cálculo (tablero, fondos, cobranza, presupuesto, avisos, reportes)
 * lee de aquí, con el mismo criterio. Se arma una vez por revisión de datos
 * (finanzasBase.revision_) y se reutiliza hasta la próxima escritura.
 */

const Base = require('./finanzasBase');
const FB = require('./finanzasBancos');

const I = FB.interno;
let cache_ = null; // { rev, hechos, conflictos, alias }
// I12.2: al cerrar la última sesión de la bóveda se olvidan los hechos descifrados.
require('./finanzasBoveda').registrarLimpieza_(() => { cache_ = null; });

function piezasMov_(m, clasif) { return require('./finanzasPagadores').piezas_(m, clasif); }
function diasConciliacion_() { try { return require('./finanzasCatalogos').param_('conciliacion_dias', 10); } catch (e) { return 10; } }
function diffDias_(a, b) { return Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 864e5)); }

function armar_() {
  const d = I.db_();
  const cuentas = I.cuentasMapa_();
  const banco = [];
  const movs = new Map(); // movimiento_id → { monto, sentido, empresa, cuenta_ref, fecha, libre }
  d.prepare('SELECT id, cuenta_ref, fecha, periodo, orden, estado, version, datos FROM FIN_MOVIMIENTOS ORDER BY fecha, orden').all().forEach((r) => {
    const m = I.des_(r.datos);
    const cu = cuentas.get(r.cuenta_ref) || {};
    const confirmado = r.estado === 'CONFIRMADO';
    const vinculado = !!(m.clasif && (m.clasif.conciliado || (m.clasif.operaciones && m.clasif.operaciones.length)));
    if (confirmado && !vinculado) movs.set(r.id, { monto: m.abono || m.cargo, sentido: m.abono > 0 ? 'ENTRADA' : 'SALIDA', empresa: cu.empresa || '', cuenta_ref: r.cuenta_ref, fecha: r.fecha,
      glosa: m.glosa || '', cuenta: cu.banco ? cu.banco + ' ···' + cu.ultimos4 : '', version: r.version || 0, clasif: m.clasif && !m.clasif.partes ? [m.clasif.tipo, m.clasif.cuenta, m.clasif.cliente].filter(Boolean).join(' · ') : 'Dividido en partes' });
    piezasMov_(m, confirmado ? m.clasif : null).forEach((p, i) => {
      // I02: el resto de un movimiento vinculado en parte queda PENDIENTE (no cuenta). La parte que viene de una
      // operación registrada se cuenta en su FECHA EFECTIVA (la de la operación); la fecha del banco se conserva aparte.
      const pend = !confirmado || !!(p.clasif && p.clasif.pendiente);
      const fe = !pend && p.clasif && p.clasif.fecha_efectiva ? p.clasif.fecha_efectiva : r.fecha;
      banco.push({
      ref: 'mov:' + r.id + ':' + i, fuente: 'BANCO', movimiento_id: r.id, parte: i, cuenta_ref: r.cuenta_ref, empresa: cu.empresa || '',
      banco: cu.banco, ultimos4: cu.ultimos4, fecha: fe, periodo: fe === r.fecha ? r.periodo : fe.slice(0, 7), fecha_banco: r.fecha, periodo_banco: r.periodo,
      orden: r.orden, estado: pend ? 'PENDIENTE' : 'CONFIRMADO',
      abono: p.abono || 0, cargo: p.cargo || 0, saldo: m.saldo, clasif: pend ? null : (p.clasif || null),
      glosa: m.glosa, pagador: (m.detalle && m.detalle.pagador) || '', medio: (m.detalle && m.detalle.medio) || 'BANCO', caja: true,
      operaciones: confirmado && m.clasif && m.clasif.operaciones ? m.clasif.operaciones : null,
      origen_ref: confirmado && p.clasif && p.clasif.origen_ref ? p.clasif.origen_ref : ''
      });
    });
  });
  let ops = [];
  try { ops = require('./finanzasOperaciones').hechosRegistro_(); } catch (e) { ops = []; }

  // Posibles duplicados: operación confirmada sin banco ↔ movimiento clasificado sin vínculo.
  const idx = new Map(); // empresa|sentido|monto → [movimiento_id]
  movs.forEach((v, id) => { const k = v.empresa + '|' + v.sentido + '|' + v.monto; if (!idx.has(k)) idx.set(k, []); idx.get(k).push(id); });
  const dias = diasConciliacion_();
  const porOp = new Map(); // operacion_id → conflicto
  ops.filter((h) => h.sin_banco).forEach((h) => {
    if (porOp.has(h.operacion_id)) { porOp.get(h.operacion_id).hechos.push(h); return; }
    const cand = (idx.get(h.empresa + '|' + h.sentido + '|' + h.operacion_monto) || []).filter((id) => {
      const v = movs.get(id);
      return diffDias_(v.fecha, h.fecha) <= dias && (!h.cuenta_ref || h.cuenta_ref === v.cuenta_ref) && (h.distintas || []).indexOf(id) === -1;
    });
    if (!cand.length) { porOp.set(h.operacion_id, null); return; }
    porOp.set(h.operacion_id, { operacion_id: h.operacion_id, empresa: h.empresa, sentido: h.sentido, monto: h.operacion_monto, fecha: h.fecha, periodo: h.periodo,
      movimientos: cand.map((id) => Object.assign({ id }, movs.get(id))), hechos: [h] });
  });
  const conflictos = [...porOp.values()].filter(Boolean);
  const enConflicto = new Set(conflictos.map((c) => c.operacion_id));
  const movConflicto = new Map();
  conflictos.forEach((c) => c.movimientos.forEach((m) => { if (!movConflicto.has(m.id)) movConflicto.set(m.id, []); movConflicto.get(m.id).push(c.operacion_id); }));
  banco.forEach((h) => { if (movConflicto.has(h.movimiento_id)) h.conflicto_identidad = movConflicto.get(h.movimiento_id); });

  const out = banco.concat(ops.filter((h) => !enConflicto.has(h.operacion_id)));
  out.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (a.orden || 0) - (b.orden || 0)));
  const alias = new Map();
  banco.forEach((h) => { if (h.origen_ref) { if (!alias.has(h.origen_ref)) alias.set(h.origen_ref, []); alias.get(h.origen_ref).push(h.ref); } });
  return { hechos: out, conflictos, alias };
}
function cache__() {
  // I12.2: la caché vale para esta revisión y, si se armó dentro de una transacción, solo dentro de ella.
  if (!Base.cacheVigente_(cache_)) cache_ = Object.assign(Base.marcaCache_(), armar_());
  return cache_;
}

/** Todos los hechos que cuentan (sin filtrar), en orden de fecha. No incluye los registros en conflicto de identidad. */
function todos_() { return cache__().hechos; }

/** Hechos filtrados: { desde, hasta (fechas), periodo, empresa (de la cuenta/operación), soloConfirmados }. */
function hechos_(f) {
  f = f || {};
  return todos_().filter((h) => (!f.periodo || h.periodo === f.periodo) && (!f.desde || h.fecha >= f.desde) && (!f.hasta || h.fecha <= f.hasta) &&
    (!f.empresa || h.empresa === f.empresa) && (!f.soloConfirmados || h.estado === 'CONFIRMADO') && (!f.fuente || h.fuente === f.fuente));
}

/**
 * Operaciones en conflicto de identidad (posible duplicado de un movimiento ya
 * clasificado). Filtro: { periodo, empresa, hasta }. Cada una trae sus hechos
 * (partes) y los movimientos candidatos.
 */
function conflictos_(f) {
  f = f || {};
  return cache__().conflictos.filter((c) => (!f.periodo || c.periodo === f.periodo) && (!f.empresa || c.empresa === f.empresa) && (!f.hasta || c.fecha <= f.hasta));
}

/**
 * Referencias vigentes de un hecho. Si la parte del registro ya se concilió,
 * la representa la parte del movimiento que la absorbió (origen_ref).
 */
function resolverRef_(ref) {
  const c = cache__();
  if (c.hechos.some((h) => h.ref === ref)) return [ref];
  return c.alias.get(ref) || [];
}
function alias_() { return cache__().alias; }

/**
 * Monto de un hecho que le toca a una empresa ('' = el grupo, todo).
 * Un gasto compartido (clasif.reparto) se reparte con partesReparto_ (FIN-25:
 * iguales, porcentaje o fijo, sin crear ni perder pesos); el pagador fuera
 * del reparto carga 0. Lo demás es 100 % de la empresa del hecho.
 */
function monto_(h) { return h.abono || h.cargo || 0; }
function parteEmpresa_(h, emp) {
  if (!emp) return monto_(h);
  const c = h.clasif;
  if (c && c.tipo === 'EGRESO' && c.reparto) {
    const partes = FB.partesReparto_(c.reparto, h.cargo);
    if (partes) { const p = partes.find((x) => x.empresa === emp); return p ? p.monto : 0; }
  }
  return h.empresa === emp ? monto_(h) : 0;
}

/**
 * Último saldo de cada cuenta al corte, por FECHA DEL BANCO y orden de la
 * cartola (la caja concilia con la cartola, no con la fecha efectiva de las
 * operaciones). Filtro: { hasta, empresa }. → [{ cuenta_ref, banco, ultimos4, empresa, saldo, al }]
 */
function saldosAl_(f) {
  f = f || {};
  const ult = new Map();
  todos_().filter((h) => h.fuente === 'BANCO' && (!f.empresa || h.empresa === f.empresa) && (!f.hasta || h.fecha_banco <= f.hasta))
    .forEach((h) => {
      const prev = ult.get(h.cuenta_ref);
      if (!prev || h.fecha_banco > prev.fecha_banco || (h.fecha_banco === prev.fecha_banco && (h.orden || 0) >= (prev.orden || 0))) ult.set(h.cuenta_ref, h);
    });
  return [...ult.values()].map((h) => ({ cuenta_ref: h.cuenta_ref, banco: h.banco, ultimos4: h.ultimos4, empresa: h.empresa, saldo: h.saldo, al: h.fecha_banco }));
}

/** Reinicio para pruebas (otra base). */
function reiniciar_() { cache_ = null; }

module.exports = { todos_, hechos_, conflictos_, saldosAl_, resolverRef_, alias_, parteEmpresa_, monto_, reiniciar_ };
