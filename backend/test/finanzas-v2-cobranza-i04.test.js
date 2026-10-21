'use strict';

/**
 * Finanzas · corrección v2, I04 (2026-10-20): cobranza completa. Bandeja por
 * factura (emisor + tipo + folio), aplicar varios cobros a varias facturas en
 * un grupo atómico e idempotente, versión y cierre de mes, desaplicar, terceros
 * con alcance y vigencia, vencimiento por condición con historia, notas de
 * crédito una sola vez y reemplazo desde el SII sin pisar aplicaciones.
 * Datos inventados.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparar } = require('./_finanzasPrueba');
const Op = require('../logica/finanzasOperaciones');
const C = require('../logica/finanzasCobranza');
const B = require('../logica/finanzasBoveda');
const F = require('../logica/finanzasBancos');

const op = (db, D, ctx, o) => Op.guardar(db, D(Object.assign({ empresa: 'HomePymes', medio: 'EFECTIVO', confirmar: true }, o)), ctx);
const fact = (db, docs, empresa, origen) => C.guardarFacturas_(db, empresa || 'HomePymes', docs, origen || 'rcv', 'prueba');
const fila = (db, D, ctx, folio, empresa) => C.facturas(db, D({ estado: 'todas' }), ctx).facturas.find((f) => f.folio === folio && (!empresa || f.empresa === empresa));
const cerrar = (periodo) => B.dbFin().prepare("INSERT INTO FIN_CIERRES (periodo, estado, datos, actualizado_en, actualizado_por) VALUES (?, 'CERRADO', ?, '2026-10-01', 'prueba')").run(periodo, F.interno.cif_({}));

function base(t) {
  const e = preparar(t);
  const { db, ctx, D } = e;
  fact(db, [{ tipo_doc: 33, folio: '100', fecha: '2026-08-01', cliente_id: 'CL-1', rut: '76.086.428-5', total: 300000 },
    { tipo_doc: 33, folio: '101', fecha: '2026-09-01', cliente_id: 'CL-1', rut: '76.086.428-5', total: 200000 }]);
  fact(db, [{ tipo_doc: 33, folio: '100', fecha: '2026-08-01', cliente_id: 'CL-1', total: 90000 }], 'GDE');
  op(db, D, ctx, { fecha: '2026-09-05', sentido: 'ENTRADA', monto: 250000, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' });
  op(db, D, ctx, { fecha: '2026-09-20', sentido: 'ENTRADA', monto: 150000, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' });
  // Fondos del cliente: NO pagan facturas.
  op(db, D, ctx, { fecha: '2026-09-21', sentido: 'ENTRADA', monto: 999000, tipo: 'FONDO_RECIBIDO', cuenta: 'IVA', cliente_id: 'CL-1' });
  return e;
}

test('I04.2 · bandeja por factura: identidad emisor+tipo+folio, totales confirmados y lo sugerido aparte', (t) => {
  const { db, ctx, D } = base(t);
  const b = C.facturas(db, D({}), ctx);
  assert.deepEqual(b.facturas.filter((f) => f.folio === '100').map((f) => f.empresa).sort(), ['GDE', 'HomePymes'], 'el mismo folio en dos emisores son dos documentos');
  assert.equal(b.totales.saldo_confirmado, 590000, 'sin aplicaciones confirmadas, lo sugerido no reduce la deuda');
  assert.equal(b.totales.propuesto, 400000, 'la propuesta FIFO va aparte');
  assert.equal(b.facturas.find((f) => f.folio === '100' && f.empresa === 'GDE').sugerido, 0, 'FIFO no propone cobros de HomePymes para una factura de GDE');
  assert.equal(b.totales.sin_aplicar, 400000, 'abonos propios sin aplicar (los fondos del cliente no cuentan)');
  const f100 = b.facturas.find((f) => f.folio === '100' && f.empresa === 'HomePymes');
  assert.equal(f100.situacion, 'Aplicación sugerida', 'una sugerencia no es «Pagada»');
  assert.equal(C.facturas(db, D({ busca: '101' }), ctx).facturas.length, 1, 'búsqueda por folio');
  assert.equal(C.facturas(db, D({ busca: '76086428' }), ctx).facturas.length >= 2, true, 'búsqueda por RUT');
  assert.equal(C.facturas(db, D({ empresa: 'GDE' }), ctx).facturas.length, 1);
});

test('I04.3 · varios cobros a varias facturas en un grupo atómico; respuesta con los saldos del servidor; idempotente', (t) => {
  const { db, ctx, D } = base(t);
  const f100 = fila(db, D, ctx, '100', 'HomePymes'), f101 = fila(db, D, ctx, '101');
  const el = C.cobrosElegibles(db, D({ factura_ids: [f100.id, f101.id] }), ctx);
  assert.deepEqual(el.cobros.map((c) => [c.fecha, c.disponible]), [['2026-09-05', 250000], ['2026-09-20', 150000]], 'los fondos (999.000) no aparecen');
  const [r1, r2] = el.cobros;
  const grupos = [{ recepcion_ref: r1.ref, aplicaciones: [{ factura_id: f100.id, monto: 250000, expected_version: f100.version }] },
    { recepcion_ref: r2.ref, aplicaciones: [{ factura_id: f100.id, monto: 50000 }, { factura_id: f101.id, monto: 100000, expected_version: f101.version }] }];
  // Todo o nada: si una parte no calza, nada se aplica.
  const malo = C.aplicar(db, D({ idempotency_key: 'k-malo', grupos: [grupos[0], { recepcion_ref: r2.ref, aplicaciones: [{ factura_id: f101.id, monto: 999999 }] }] }), ctx);
  assert.ok(malo._validationError);
  assert.equal(C.aplicaciones_().length, 0);
  const r = C.aplicar(db, D({ idempotency_key: 'k-1', grupos, fecha_aplicacion: '2026-10-02' }), ctx);
  assert.equal(r.aplicado, 400000);
  assert.deepEqual(r.facturas.map((f) => [f.folio, f.saldo_confirmado, f.situacion]).sort(), [['100', 0, 'Pagada'], ['101', 100000, 'Pago parcial']]);
  assert.deepEqual(r.cobros.map((c) => c.disponible), [0, 0]);
  // Reintento con la misma clave: el mismo resultado, sin duplicar.
  C.aplicar(db, D({ idempotency_key: 'k-1', grupos, fecha_aplicacion: '2026-10-02' }), ctx);
  assert.equal(C.aplicaciones_().length, 3);
  // La misma clave con otro contenido: conflicto.
  assert.equal(C.aplicar(db, D({ idempotency_key: 'k-1', grupos: [grupos[0]] }), ctx).codigo, 'IDEMPOTENCIA');
  // La fecha del cobro no cambia y el banco/ingresos no se tocan.
  const ap = C.aplicaciones_()[0];
  assert.deepEqual([ap.fecha_recepcion, ap.fecha_aplicacion], ['2026-09-05', '2026-10-02']);
});

test('I04.3/I11 · versión de la factura y mes cerrado', (t) => {
  const { db, ctx, D } = base(t);
  const f101 = fila(db, D, ctx, '101');
  const rec = C.cobrosElegibles(db, D({ factura_ids: [f101.id] }), ctx).cobros[0];
  C.editarFactura(db, D({ id: f101.id, expected_version: f101.version, nota: 'otra persona la tocó' }), ctx);
  const v = C.aplicar(db, D({ recepcion_ref: rec.ref, aplicaciones: [{ factura_id: f101.id, monto: 1000, expected_version: f101.version }] }), ctx);
  assert.equal(v.codigo, 'CONFLICTO_VERSION');
  cerrar('2026-09');
  assert.equal(C.aplicar(db, D({ recepcion_ref: rec.ref, aplicaciones: [{ factura_id: f101.id, monto: 1000 }], fecha_aplicacion: '2026-09-30' }), ctx).codigo, 'PERIODO_CERRADO');
  const ok = C.aplicar(db, D({ recepcion_ref: rec.ref, aplicaciones: [{ factura_id: f101.id, monto: 1000 }], fecha_aplicacion: '2026-10-01' }), ctx);
  assert.equal(ok.aplicaciones.length, 1);
});

test('I04.4 · desaplicar: motivo y versión; la factura recupera saldo y el cobro vuelve a estar disponible', (t) => {
  const { db, ctx, D } = base(t);
  const f101 = fila(db, D, ctx, '101');
  const rec = C.cobrosElegibles(db, D({ factura_ids: [f101.id] }), ctx).cobros[1];
  C.aplicar(db, D({ recepcion_ref: rec.ref, aplicaciones: [{ factura_id: f101.id, monto: 150000 }], fecha_aplicacion: '2026-10-02' }), ctx);
  const a = C.fichaCliente(db, D({ clave: 'CL-1' }), ctx).facturas.find((f) => f.folio === '101').aplicaciones[0];
  assert.ok(C.desaplicar(db, D({ id: a.id, expected_version: a.version, motivo: '' }), ctx)._validationError, 'sin motivo no');
  const d = C.desaplicar(db, D({ id: a.id, expected_version: a.version, motivo: 'era de la factura 100' }), ctx);
  assert.deepEqual([d.facturas[0].saldo_confirmado, d.cobros[0].disponible], [200000, 150000]);
  assert.equal(C.recepciones_({ cliente_id: 'CL-1' }).length, 2, 'el cobro y su evidencia siguen ahí');
  assert.equal(C.desaplicar(db, D({ id: a.id, expected_version: a.version, motivo: 'otra vez' }), ctx)._validationError, true, 'ya deshecha');
});

test('I04.4 · terceros: pagador, beneficiario, emisor y vigencia a la vista; fuera de vigencia o anulada, no', (t) => {
  const { db, ctx, D } = base(t);
  fact(db, [{ tipo_doc: 33, folio: '500', fecha: '2026-09-01', cliente_id: 'CL-2', total: 80000 }]);
  fact(db, [{ tipo_doc: 33, folio: '501', fecha: '2026-09-01', cliente_id: 'CL-2', total: 80000 }], 'GDE');
  const f500 = fila(db, D, ctx, '500'), f501 = fila(db, D, ctx, '501');
  assert.equal(C.cobrosElegibles(db, D({ factura_ids: [f500.id] }), ctx).cobros.length, 0, 'sin relación, los cobros de otro cliente no son elegibles');
  const rel = C.guardarRelacion(db, D({ tipo: 'CLIENTE', pagador_id: 'CL-1', beneficiario_id: 'CL-2', emisor: 'HomePymes', desde: '2026-09-10', hasta: '2026-12-31', autorizado_por: 'Gerencia', motivo: 'Andes paga por Norte (contrato marco)' }), ctx);
  const el = C.cobrosElegibles(db, D({ factura_ids: [f500.id] }), ctx).cobros;
  assert.deepEqual(el.map((c) => c.fecha), ['2026-09-20'], 'el cobro del 05-09 está fuera de vigencia');
  assert.match(el[0].terceros[0], /paga por .*autorizó Gerencia/);
  assert.equal(C.cobrosElegibles(db, D({ factura_ids: [f501.id] }), ctx).cobros.length, 0, 'limitada a facturas de HomePymes: no habilita las de GDE');
  C.anularRelacion(db, D({ id: rel.id, motivo: 'terminó el contrato' }), ctx);
  assert.equal(C.cobrosElegibles(db, D({ factura_ids: [f500.id] }), ctx).cobros.length, 0);
});

test('I04.4 · vencimiento: fecha o condición comercial, con procedencia e historia', (t) => {
  const { db, ctx, D } = base(t);
  const f = fila(db, D, ctx, '101');
  assert.equal(f.vence_origen, 'parametro', 'sin acuerdo conocido: viene del plazo por defecto');
  assert.ok(C.editarFactura(db, D({ id: f.id, condicion_dias: 45 }), ctx)._validationError, 'exige versión');
  C.editarFactura(db, D({ id: f.id, expected_version: f.version, condicion_dias: 45, respaldo: 'Orden de compra 45 días' }), ctx);
  const g = fila(db, D, ctx, '101');
  assert.deepEqual([g.vence, g.vence_origen, g.condicion_dias], ['2026-10-16', 'condicion', 45]);
  const hist = C.fichaCliente(db, D({ clave: 'CL-1' }), ctx).facturas.find((x) => x.folio === '101');
  assert.ok(hist.version > f.version);
});

test('I04.4 · nota de crédito referenciada rebaja una sola vez, también al reimportar; el SII no pisa una factura con aplicaciones que no caben', (t) => {
  const { db, ctx, D } = base(t);
  const nc = { tipo_doc: 61, folio: '7', fecha: '2026-09-02', cliente_id: 'CL-1', total: 50000, referencia: '101' };
  fact(db, [nc]); fact(db, [nc]);
  assert.equal(fila(db, D, ctx, '101').creditos, 50000);
  // Factura de la planilla con aplicaciones; el SII la trae con un total menor que lo aplicado.
  fact(db, [{ tipo_doc: 33, folio: '300', fecha: '2026-09-03', cliente_id: 'CL-1', total: 120000 }], 'HomePymes', 'planilla');
  const f300 = fila(db, D, ctx, '300');
  const rec = C.cobrosElegibles(db, D({ factura_ids: [f300.id] }), ctx).cobros[0];
  C.aplicar(db, D({ recepcion_ref: rec.ref, aplicaciones: [{ factura_id: f300.id, monto: 100000 }] }), ctx);
  const r = fact(db, [{ tipo_doc: 33, folio: '300', fecha: '2026-09-03', cliente_id: 'CL-1', total: 60000 }], 'HomePymes', 'rcv');
  assert.deepEqual(r.conflictos.map((c) => [c.folio, c.total_nuevo, c.aplicado]), [['300', 60000, 100000]]);
  const g = fila(db, D, ctx, '300');
  assert.equal(g.total, 120000, 'no se sobrescribe hasta resolver');
  assert.equal(g.conflicto_fuente.total_nuevo, 60000);
});
