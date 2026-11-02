'use strict';

/**
 * finanzasPanorama.js — Todos los clientes en una sola lista (Finanzas v5.8, 02-11-2026; reunión con gerencia).
 *
 * Gerencia pidió saber «quiénes son y cuánto deben» para empezar a negociar: los activos, los de antes (HomePymes
 * 2025), los de 2026 y los que se fueron. Hoy eso estaba repartido (maestro de clientes, fichas, facturas, deudas
 * anteriores y la planilla). Aquí se junta por cliente:
 *   - su ESTADO: activo (pagó en los últimos meses con planilla o tiene un servicio vigente), sin movimiento, se fue
 *     (ficha «Terminado», deuda anterior «se fue» o inactivo en el maestro), suspendido o prospecto (de la ficha);
 *   - de qué empresa es (la que le factura según la ficha, o el origen de su deuda anterior);
 *   - cuánto DEBE: facturas por cobrar (y cuánto de eso está vencido) + deudas anteriores;
 *   - su último pago en la planilla y lo que pagó en los últimos 3 meses.
 * Los nombres que deben y no están en el maestro también aparecen («sin ficha»), para que nadie se pierda.
 */

const B = require('./finanzasBoveda');
const F = require('./finanzasBancos');

const I = F.interno;
const N = (s) => I.normalizar_(s);
const MESES_ACTIVO = 3;

function maestro_(db) {
  try {
    const { leerFilas_ } = require('../db/sqliteRepo');
    const { COLUMNAS } = require('../db/schema');
    return leerFilas_(db, 'CAT_CLIENTES', COLUMNAS.CAT_CLIENTES).filter((c) => c.cliente_id && c.razon_social)
      .map((c) => ({ id: String(c.cliente_id), nombre: String(c.razon_social).trim(), rut: String(c.rut || ''), activo: !(c.activo === false || c.activo === 'FALSE') }));
  } catch (e) { return []; }
}
function hoyMes_() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()).slice(0, 7); }

const panorama = B.conBoveda('', function (db) {
  const H = require('./finanzasHoja');
  const ctx = H.contexto_(db);
  const lista = new Map();
  const nodo = (clave, base) => { let x = lista.get(clave); if (!x) { x = Object.assign({ cliente_id: '', cliente: '', rut: '', en_maestro: false, activo_maestro: true, ficha_estado: '', empresa: '', mensual: 0, por_cobrar: 0, vencido: 0, facturas_abiertas: 0, deuda_anterior: 0, deuda_codigos: [], deuda_se_fue: false, ultimo_pago: '', pagado_3m: 0 }, base); lista.set(clave, x); } return x; };
  const porNombre = new Map();
  maestro_(db).forEach((c) => { const x = nodo(c.id, { cliente_id: c.id, cliente: c.nombre, rut: c.rut, en_maestro: true, activo_maestro: c.activo }); porNombre.set(N(c.nombre), x); });
  const claveDe = (id, nombre) => (id && lista.has(id) ? id : porNombre.has(N(nombre)) ? porNombre.get(N(nombre)).cliente_id || 'n:' + N(nombre) : id || 'n:' + N(nombre));
  // Fichas: estado comercial, empresa que factura y lo mensual de sus servicios vigentes.
  try {
    const Cl = require('./finanzasClientes');
    Cl.fichas_().forEach((f, id) => { if (lista.has(id)) { const x = lista.get(id); x.ficha_estado = f.estado || ''; x.empresa = f.empresa_facturadora || x.empresa; } });
    I.db_().prepare("SELECT datos FROM FIN_SERVICIOS WHERE estado = 'VIGENTE'").all().forEach((r) => { const s = I.des_(r.datos); if (lista.has(s.cliente_id) && s.modalidad === 'MENSUAL') lista.get(s.cliente_id).mensual += s.monto_neto || 0; });
  } catch (e) { /* sin fichas */ }
  // Facturas por cobrar (a hoy).
  try {
    H.facturas_(db, null).forEach((f) => {
      if (!(f.saldo > 0) || f.estado === 'Incobrable') return;
      const x = nodo(claveDe(f.cliente_id, f.cliente), { cliente: f.cliente });
      x.por_cobrar += f.saldo; x.facturas_abiertas++; if (f.estado === 'Vencida') x.vencido += f.saldo; if (!x.empresa) x.empresa = f.empresa;
    });
  } catch (e) { /* sin facturas */ }
  // Deudas anteriores (clientes de antes o que se fueron).
  try {
    require('./finanzasDeudas').lista_().deudas.forEach((d) => {
      if (!(d.saldo > 0)) return;
      const x = nodo(claveDe(d.cliente_id, d.cliente), { cliente: d.cliente, rut: d.rut_visible || '' });
      x.deuda_anterior += d.saldo; x.deuda_codigos.push(d.codigo); if (d.estado_cliente === 'SE_FUE') x.deuda_se_fue = true; if (!x.empresa && d.origen) x.empresa = d.origen;
    });
  } catch (e) { /* sin deudas */ }
  // Pagos en la planilla: los últimos meses con datos (honorarios de cada cliente y su último pago).
  const meses = I.db_().prepare('SELECT DISTINCT periodo FROM FIN_MOVIMIENTOS WHERE periodo <= ? ORDER BY periodo DESC LIMIT ?').all(hoyMes_(), MESES_ACTIVO).map((r) => r.periodo);
  meses.forEach((mes) => [...ctx.cuentas.values()].forEach((cu) => {
    H.construir_(db, cu, mes, ctx).filas.forEach((f) => {
      if (!(f.monto > 0) || !f.que || (f.que.k !== 'ing' && f.que.k !== 'fon')) return;
      if (!f.cliente_id && !porNombre.has(N(f.nombre))) return;
      const x = lista.get(claveDe(f.cliente_id, f.nombre)); if (!x) return;
      if (f.que.k === 'ing') x.pagado_3m += f.monto;
      if (!x.ultimo_pago || f.fecha > x.ultimo_pago) x.ultimo_pago = f.fecha;
    });
  }));
  const out = [...lista.values()].map((x) => {
    const debe = x.por_cobrar + x.deuda_anterior;
    let estado;
    if (x.ficha_estado === 'Terminado' || x.deuda_se_fue || !x.activo_maestro) estado = 'SE_FUE';
    else if (x.ficha_estado === 'Suspendido') estado = 'SUSPENDIDO';
    else if (x.ficha_estado === 'Prospecto' && !x.ultimo_pago) estado = 'PROSPECTO';
    else if (x.ultimo_pago || x.mensual > 0 || x.ficha_estado === 'Activo') estado = 'ACTIVO';
    else estado = 'SIN_MOVIMIENTO';
    return Object.assign(x, { debe, estado, sin_ficha: !x.en_maestro });
  }).filter((x) => x.en_maestro || x.debe > 0);
  out.sort((a, b) => b.debe - a.debe || a.cliente.localeCompare(b.cliente, 'es'));
  const T = { clientes: out.length, activos: 0, se_fueron: 0, sin_movimiento: 0, deben: 0, total_debe: 0, debe_se_fueron: 0, vencido: 0, anterior: 0 };
  out.forEach((x) => {
    if (x.estado === 'ACTIVO') T.activos++; else if (x.estado === 'SE_FUE') T.se_fueron++; else if (x.estado === 'SIN_MOVIMIENTO') T.sin_movimiento++;
    if (x.debe > 0) { T.deben++; T.total_debe += x.debe; T.vencido += x.vencido; T.anterior += x.deuda_anterior; if (x.estado === 'SE_FUE') T.debe_se_fueron += x.debe; }
  });
  const empresas = [...new Set(out.map((x) => x.empresa).filter(Boolean))].sort();
  return { clientes: out, totales: T, empresas, meses_actividad: meses.slice().reverse(), estados: { ACTIVO: 'Activo', SIN_MOVIMIENTO: 'Sin movimiento', SE_FUE: 'Se fue', SUSPENDIDO: 'Suspendido', PROSPECTO: 'Prospecto' } };
});

module.exports = { panorama };
