'use strict';

/**
 * finanzasAvisos.js — Finanzas, Etapa C (2026-10-07): avisos ANTES de guardar.
 *
 * Revisa una clasificación (la misma forma que finanzasClasificar) contra lo que
 * ya se sabe y devuelve avisos; no guarda nada. Dos niveles:
 *   - alerta: probablemente está mal; se puede guardar igual, pero hay que mirarlo.
 *   - info:   está bien, pero conviene saber lo que va a pasar.
 *
 * Lo que revisa:
 *   1. El pagador nunca ha pagado por ese cliente (o es la primera vez que aparece).
 *   2. En el Excel BANCOS lo anotaron como otra cosa.
 *   3. El banco dice Previred / SII / Tesorería y se marca como otra cosa.
 *   4. Un pago por cuenta de un cliente que deja su plata en custodia en negativo.
 *   5. El mismo cliente ya tiene un pago igual ese mes (¿pago doble?).
 *   6. Ingreso que no calza con sus facturas pendientes, o sin cliente.
 */

const B = require('./finanzasBoveda');
const FB = require('./finanzasBancos');
const P = require('./finanzasPagadores');

const I = FB.interno;
const plata_ = (n) => { const v = Math.round(n || 0); return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('es-CL'); };
const ddmm_ = (iso) => String(iso || '').slice(8, 10) + '-' + String(iso || '').slice(5, 7);
const txt_ = (v) => String(v == null ? '' : v).trim();
const CUENTAS_MEDIO = { PREVIRED: ['Imposiciones'], SII: ['IVA', 'IVA Postergado', 'Renta'], TESORERIA: ['Convenios', 'IVA', 'Renta', 'Multas Clientes'] };
const NOMBRE_MEDIO = { PREVIRED: 'Previred', SII: 'el SII', TESORERIA: 'la Tesorería' };

/** Lo que se calcula una vez para revisar varios movimientos. */
function contexto_(db, excluir) {
  const d = I.db_();
  const fondos = new Map();       // cliente_id → saldo en custodia (sin los movimientos revisados)
  const ingresos = [];            // ingresos confirmados con cliente: {id, periodo, fecha, monto, cliente_id, cuenta}
  d.prepare("SELECT id, periodo, fecha, datos FROM FIN_MOVIMIENTOS WHERE estado = 'CONFIRMADO'").all().forEach((r) => {
    if (excluir.has(r.id)) return;
    P.piezas_(I.des_(r.datos)).forEach((m) => {
      const c = m.clasif;
      if (!c || !c.cliente_id) return;
      if (c.tipo === 'FONDO_RECIBIDO') fondos.set(c.cliente_id, (fondos.get(c.cliente_id) || 0) + m.abono);
      if (c.tipo === 'FONDO_PAGADO') fondos.set(c.cliente_id, (fondos.get(c.cliente_id) || 0) - m.cargo);
      if (c.tipo === 'INGRESO' && m.abono > 0) ingresos.push({ id: r.id, periodo: r.periodo, fecha: r.fecha, monto: m.abono, cliente_id: c.cliente_id, cuenta: c.cuenta });
    });
  });
  let cartera = null;
  try {
    const C = require('./finanzasCobranza');
    if (d.prepare('SELECT 1 FROM FIN_FACTURAS LIMIT 1').get()) cartera = C.cartera_(db);
  } catch (e) { cartera = null; }
  const clientes = I.clientes_(db);
  return { fondos, ingresos, cartera, clientes, nombres: new Map(clientes.map((c) => [c.id, c.nombre])) };
}

/** Las piezas que se van a guardar (una, o las partes de una división). */
function piezasDe_(it, mov, ctx) {
  const nombre = (id) => ctx.nombres.get(id) || '';
  if (Array.isArray(it.partes) && it.partes.length >= 2) {
    return it.partes.map((p) => {
      const monto = Math.round(Number(String(p.monto).replace(/[^0-9]/g, '')) || 0);
      return { abono: mov.abono ? monto : 0, cargo: mov.cargo ? monto : 0, c: { tipo: txt_(p.tipo), cuenta: txt_(p.cuenta), cliente_id: txt_(p.cliente_id), cliente: nombre(txt_(p.cliente_id)), empresa: txt_(p.empresa) } };
    });
  }
  return [{ abono: mov.abono, cargo: mov.cargo, c: { tipo: txt_(it.tipo), cuenta: txt_(it.cuenta), cliente_id: txt_(it.cliente_id), cliente: nombre(txt_(it.cliente_id)), empresa: txt_(it.empresa) } }];
}

function revisarUno_(r, mov, it, ctx) {
  const avisos = [];
  const add = (nivel, texto) => avisos.push({ nivel, texto });
  const tipoNombre = (t) => (FB.TIPOS[t] || {}).nombre || t;
  const det = mov.detalle || {};
  const piezas = piezasDe_(it, mov, ctx);

  piezas.forEach((pz) => {
    const c = pz.c;
    if (!c.tipo) return;
    const quien = piezas.length > 1 ? 'La parte de ' + plata_(pz.abono || pz.cargo) + ': ' : '';

    // 1. Quién pagó vs. de qué cliente se dice que es.
    if (pz.abono > 0 && det.pagador && c.cliente_id) {
      const p = P.pagadorDe_(det.pagador);
      const conocidos = p ? Object.keys(p.clientes) : [];
      const mismo = P.clientePorNombre_(det.pagador, ctx.clientes);
      if (mismo && mismo.id !== c.cliente_id && !conocidos.length) {
        add('alerta', quien + 'Transfirió ' + mismo.nombre + ' (es cliente) y lo estás asignando a ' + c.cliente + '. ¿Pagó por otro cliente?');
      } else if (conocidos.length && conocidos.indexOf(c.cliente_id) === -1) {
        const lista = conocidos.map((id) => p.clientes[id].cliente + ' (' + p.clientes[id].veces + ')').slice(0, 3).join(', ');
        add('alerta', quien + det.pagador + ' ha pagado antes por ' + lista + ', nunca por ' + c.cliente + '. Si es correcto, se aprende.');
      } else if (!conocidos.length && !mismo) {
        add('info', quien + 'Es la primera vez que aparece ' + det.pagador + ': quedará anotado que paga por ' + c.cliente + '.');
      }
    }
    // 2. Lo que anotaron en el Excel BANCOS.
    const ex = mov.planilla && mov.planilla.clasif;
    if (ex && piezas.length === 1) {
      if (ex.tipo && ex.tipo !== c.tipo) add('alerta', 'En el Excel BANCOS lo anotaron como «' + tipoNombre(ex.tipo) + (ex.cuenta ? ' · ' + ex.cuenta : '') + '» (' + (mov.planilla.alias || '') + (mov.planilla.obs ? ' · ' + mov.planilla.obs : '') + ') y lo estás marcando como «' + tipoNombre(c.tipo) + '».');
      else if (ex.cliente_id && c.cliente_id && ex.cliente_id !== c.cliente_id) add('alerta', 'En el Excel BANCOS anotaron otro cliente: ' + (ex.cliente || mov.planilla.alias) + '.');
    }
    // 3. El banco dice Previred / SII / Tesorería.
    if (pz.cargo > 0 && CUENTAS_MEDIO[det.medio]) {
      const okPropio = c.tipo === 'EGRESO' && CUENTAS_MEDIO[det.medio].indexOf(c.cuenta) !== -1;
      if (c.tipo !== 'FONDO_PAGADO' && !okPropio) add('alerta', quien + 'El banco dice que fue un pago a ' + NOMBRE_MEDIO[det.medio] + ' y lo estás marcando como «' + tipoNombre(c.tipo) + (c.cuenta ? ' · ' + c.cuenta : '') + '».');
    }
    // 4. Pago por cuenta de un cliente sin plata suficiente en custodia.
    if (c.tipo === 'FONDO_PAGADO' && c.cliente_id) {
      const antes = ctx.fondos.get(c.cliente_id) || 0;
      const despues = antes - pz.cargo;
      // Sin ningún registro previo del cliente (p. ej. lo mandó antes de que partiera el sistema): solo informa.
      if (despues < 0 && !ctx.fondos.has(c.cliente_id)) add('info', quien + 'No hay registro de plata de ' + c.cliente + ' en custodia: si la mandó antes de partir con el sistema, cárgala como saldo inicial; si no, la empresa está poniendo ' + plata_(-despues) + ' por el cliente.');
      else if (despues < 0) add('alerta', quien + c.cliente + ' tiene ' + plata_(antes) + ' en custodia; con este pago queda en ' + plata_(despues) + '. La empresa estaría poniendo la plata: hay que cobrársela (o falta registrar lo que mandó).');
      ctx.fondos.set(c.cliente_id, despues);   // en un lote, lo siguiente ve este pago
    }
    if (c.tipo === 'FONDO_RECIBIDO' && c.cliente_id) ctx.fondos.set(c.cliente_id, (ctx.fondos.get(c.cliente_id) || 0) + pz.abono);
    // 5. Pago doble del mismo cliente en el mes.
    if (c.tipo === 'INGRESO' && c.cliente_id && pz.abono > 0) {
      const igual = ctx.ingresos.filter((x) => x.id !== r.id && x.cliente_id === c.cliente_id && x.periodo === r.periodo && x.monto === pz.abono && (!c.cuenta || x.cuenta === c.cuenta))[0];
      if (igual) add('alerta', quien + c.cliente + ' ya tiene un pago de ' + plata_(igual.monto) + (igual.cuenta ? ' (' + igual.cuenta + ')' : '') + ' el ' + ddmm_(igual.fecha) + ' de este mes. ¿Pago doble, o es el de otro mes?');
      ctx.ingresos.push({ id: r.id, periodo: r.periodo, fecha: r.fecha, monto: pz.abono, cliente_id: c.cliente_id, cuenta: c.cuenta });
    }
    // 6. Ingreso contra las facturas pendientes.
    if (c.tipo === 'INGRESO' && pz.abono > 0) {
      if (!c.cliente_id) add('info', quien + 'Ingreso sin cliente: no se cruzará con la cobranza.');
      else if (ctx.cartera && r.estado !== 'CONFIRMADO') {
        const n = ctx.cartera.get(c.cliente_id);
        const pend = n ? n.facturas.filter((f) => f.saldo > 0 && f.estado !== 'INCOBRABLE') : [];
        if (!pend.length) add('info', quien + c.cliente + ' no tiene facturas pendientes: queda como pago a cuenta (saldo a favor).');
        else if (!pend.some((f) => f.saldo === pz.abono) && n.por_cobrar !== pz.abono) {
          add('info', quien + 'No calza con ninguna factura pendiente de ' + c.cliente + ' (' + pend.slice(0, 3).map((f) => 'folio ' + f.folio + ' ' + plata_(f.saldo)).join(', ') + (pend.length > 3 ? '…' : '') + '). Se abona a la más antigua.');
        }
      }
    }
  });
  return avisos;
}

/** Revisa sin guardar. data.items: como finanzasClasificar. */
const revisarAntes = B.conBoveda('', function (db, data) {
  const items = (Array.isArray(data && data.items) ? data.items : []).slice(0, 300);
  const d = I.db_();
  const ctx = contexto_(db, new Set(items.map((it) => txt_(it.id))));
  const resultado = items.map((it) => {
    const r = d.prepare('SELECT id, periodo, fecha, estado, datos FROM FIN_MOVIMIENTOS WHERE id = ?').get(txt_(it.id));
    if (!r) return { id: it.id, avisos: [] };
    return { id: r.id, avisos: revisarUno_(r, I.des_(r.datos), it, ctx) };
  });
  return { items: resultado, alertas: resultado.reduce((s, x) => s + x.avisos.filter((a) => a.nivel === 'alerta').length, 0) };
});

module.exports = { revisarAntes, revisarUno_, contexto_ };
