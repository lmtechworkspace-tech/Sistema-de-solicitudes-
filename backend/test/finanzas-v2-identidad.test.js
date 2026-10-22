'use strict';

/**
 * Finanzas · corrección v2, I01 (2026-10-20): identidad económica y doble
 * conteo. QA-R01 (registro primero), QA-R02 (banco primero), QA-R03 (dos
 * cobros iguales legítimos), QA-R04 (aplicación antes de conciliar y
 * deshacer), recepción mixta, anulación, reintento y el caso del demo
 * (Andes $357.000 + $619.000). Datos ficticios.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparar, cartola } = require('./_finanzasPrueba');
const F = require('../logica/finanzasBancos');
const Op = require('../logica/finanzasOperaciones');
const Conc = require('../logica/finanzasConciliacion');
const H = require('../logica/finanzasHechos');
const C = require('../logica/finanzasCobranza');
const Fo = require('../logica/finanzasFondos');
const R = require('../logica/finanzasReportes');

const ANDES = { empresa: 'HomePymes', sentido: 'ENTRADA', medio: 'TRANSFERENCIA', monto: 357000, tercero: 'Andes Montajes', tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' };
const ingresos = (db, p) => R.reporte_(db, { periodo: p, hoy: '2026-11-15' }).metrics.ingresos;
function movDe(db, D, ctx, p, glosa) { return F.movimientos(db, D({ periodo: p }), ctx).movimientos.find((m) => m.glosa === glosa); }
function bancoClasificado(db, D, ctx, filas, glosa, clasif) {
  F.importarCartola(db, D({ filas: cartola(filas), empresa: 'HomePymes' }), ctx);
  const m = movDe(db, D, ctx, '2026-08', glosa);
  const r = F.clasificar(db, D({ items: [Object.assign({ id: m.id, expected_version: m.version, recordar: false }, clasif)] }), ctx);
  assert.equal(r.errores.length, 0, JSON.stringify(r.errores));
  return movDe(db, D, ctx, '2026-08', glosa);
}

test('QA-R01 · registro primero: el pendiente del banco no suma y, tras vincular, es una sola operación', (t) => {
  const { db, ctx, D } = preparar(t);
  const op = Op.guardar(db, D(Object.assign({ fecha: '2026-08-02', confirmar: true }, ANDES)), ctx);
  assert.deepEqual(op.coincidencias_banco, [], 'todavía no hay banco');
  F.importarCartola(db, D({ filas: cartola([['02/08/2026', 'TRANSFER DE ANDES MONTAJE', 0, 357000, '1']]), empresa: 'HomePymes' }), ctx);
  assert.equal(ingresos(db, '2026-08'), 357000, 'el movimiento pendiente no se suma');
  assert.equal(H.conflictos_({}).length, 0, 'un pendiente no es un posible duplicado');
  const m = movDe(db, D, ctx, '2026-08', 'TRANSFER DE ANDES MONTAJE');
  Conc.conciliar(db, D({ movimientos: [{ id: m.id, expected_version: m.version }], operaciones: [{ id: op.id, expected_version: op.version }] }), ctx);
  assert.equal(ingresos(db, '2026-08'), 357000);
  assert.equal(H.todos_().filter((h) => h.clasif && h.clasif.tipo === 'INGRESO').length, 1, 'un solo hecho');
});

test('QA-R02 · banco primero: registrar después el mismo dinero es un POSIBLE DUPLICADO; no se suma dos veces', (t) => {
  const { db, ctx, D } = preparar(t);
  const m = bancoClasificado(db, D, ctx, [['02/08/2026', 'TRANSFER DE ANDES MONTAJE', 0, 357000, '1']], 'TRANSFER DE ANDES MONTAJE', { tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' });
  assert.equal(ingresos(db, '2026-08'), 357000);
  const op = Op.guardar(db, D(Object.assign({ fecha: '2026-08-02', confirmar: true }, ANDES)), ctx);
  assert.equal(op.coincidencias_banco.length, 1, 'se avisa al guardar');
  assert.equal(op.coincidencias_banco[0].movimiento_id, m.id);
  const rep = R.reporte_(db, { periodo: '2026-08', hoy: '2026-11-15' });
  assert.equal(rep.metrics.ingresos, 357000, 'cuenta el banco; nunca 714.000');
  assert.equal(rep.metrics.pendiente_identidad.monto, 357000, 'lo registrado queda aparte');
  assert.ok(rep.quality.reasons.some((r) => r.codigo === 'CONFLICTO_IDENTIDAD'), 'la calidad lo dice');
  assert.notEqual(rep.quality.status, 'COMPLETO');
  // También en la lista del registro.
  const l = Op.listar(db, D({ periodo: '2026-08' }), ctx);
  assert.equal(l.operaciones[0].coincidencias_banco.length, 1);
  assert.equal(l.totales.posibles_duplicados, 1);
  // La persona confirma que es la misma: se vinculan y queda un hecho.
  const mm = movDe(db, D, ctx, '2026-08', 'TRANSFER DE ANDES MONTAJE');
  Conc.conciliar(db, D({ movimientos: [{ id: mm.id, expected_version: mm.version }], operaciones: [{ id: op.id, expected_version: op.version }] }), ctx);
  const rep2 = R.reporte_(db, { periodo: '2026-08', hoy: '2026-11-15' });
  assert.equal(rep2.metrics.ingresos, 357000);
  assert.equal(rep2.metrics.pendiente_identidad.monto, 0);
  assert.equal(H.conflictos_({}).length, 0);
});

test('Demo · Andes $357.000 (posible duplicado) + Panadería $619.000: el total no se certifica en $1.333.000', (t) => {
  const { db, ctx, D } = preparar(t);
  bancoClasificado(db, D, ctx, [['02/08/2026', 'TRANSFER DE ANDES MONTAJE', 0, 357000, '1']], 'TRANSFER DE ANDES MONTAJE', { tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' });
  Op.guardar(db, D(Object.assign({ fecha: '2026-08-02', confirmar: true }, ANDES)), ctx);
  Op.guardar(db, D({ empresa: 'HomePymes', fecha: '2026-08-14', sentido: 'ENTRADA', monto: 619000, tercero: 'Panadería', tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-3', confirmar: true }), ctx);
  const rep = R.reporte_(db, { periodo: '2026-08', hoy: '2026-11-15' });
  assert.equal(rep.metrics.ingresos, 976000, 'base explícita: banco + registro sin conflicto');
  assert.equal(rep.metrics.pendiente_identidad.ingresos, 357000, 'el posible duplicado, aparte');
});

test('QA-R03 · dos cobros distintos iguales: «son distintas» conserva los dos; reimportar no lo revierte; no se pueden conciliar entre sí', (t) => {
  const { db, ctx, D } = preparar(t);
  const filas = [['10/08/2026', 'PAGO PROVEEDOR', 120000, 0, '7']];
  const m = bancoClasificado(db, D, ctx, filas, 'PAGO PROVEEDOR', { tipo: 'EGRESO', cuenta: 'Otros Egresos' });
  const op = Op.guardar(db, D({ empresa: 'HomePymes', fecha: '2026-08-10', sentido: 'SALIDA', monto: 120000, tercero: 'Proveedor', tipo: 'EGRESO', cuenta: 'Otros Egresos', confirmar: true }), ctx);
  assert.equal(op.coincidencias_banco.length, 1);
  assert.ok(Conc.marcarDistintas(db, D({ operacion_id: op.id, movimiento_id: m.id, motivo: 'x' }), ctx)._validationError, 'exige la versión revisada');
  assert.ok(Conc.marcarDistintas(db, D({ operacion_id: op.id, movimiento_id: m.id, expected_version: op.version, motivo: '' }), ctx)._validationError, 'exige motivo');
  const r = Conc.marcarDistintas(db, D({ operacion_id: op.id, movimiento_id: m.id, expected_version: op.version, motivo: 'Dos cuotas del mismo mes' }), ctx);
  assert.equal(r.distintas, true);
  const rep = R.reporte_(db, { periodo: '2026-08', hoy: '2026-11-15' });
  assert.equal(rep.metrics.egresos, 240000, 'los dos pagos cuentan');
  assert.equal(rep.metrics.pendiente_identidad.monto, 0);
  // Reimportar la misma cartola no duplica el banco ni deshace la decisión.
  F.importarCartola(db, D({ filas: cartola(filas), empresa: 'HomePymes' }), ctx);
  assert.equal(R.reporte_(db, { periodo: '2026-08', hoy: '2026-11-15' }).metrics.egresos, 240000);
  // No se puede conciliar un par marcado como distinto.
  const o2 = Op.porId_(op.id);
  const c = Conc.conciliar(db, D({ movimientos: [{ id: m.id }], operaciones: [{ id: op.id, expected_version: o2.version }] }), ctx);
  assert.ok(c._validationError && /DISTINTOS/.test(c.message));
  assert.equal(Conc.candidatos(db, D({ operacion_id: op.id }), ctx).candidatos.length, 0, 'tampoco se propone');
});

test('QA-R04 · aplicar un cobro registrado, conciliarlo y deshacer: la factura sigue pagada y nada queda huérfano', (t) => {
  const { db, ctx, D } = preparar(t);
  C.guardarFacturas_(db, 'HomePymes', [{ tipo_doc: 33, folio: '501', fecha: '2026-08-01', rut: '76.086.428-5', cliente_id: 'CL-1', total: 357000 }], 'rcv', 'prueba');
  const op = Op.guardar(db, D(Object.assign({ fecha: '2026-08-02', confirmar: true }, ANDES)), ctx);
  const f = C.cartera_(db).get('CL-1').facturas[0];
  const a = C.aplicar(db, D({ recepcion_ref: 'op:' + op.id + ':0', aplicaciones: [{ factura_id: f.id, monto: 357000 }] }), ctx);
  assert.equal(a.aplicado, 357000);
  F.importarCartola(db, D({ filas: cartola([['03/08/2026', 'TRANSFER DE ANDES MONTAJE', 0, 357000, '1']]), empresa: 'HomePymes' }), ctx);
  const m = movDe(db, D, ctx, '2026-08', 'TRANSFER DE ANDES MONTAJE');
  const g = Conc.conciliar(db, D({ movimientos: [{ id: m.id, expected_version: m.version }], operaciones: [{ id: op.id, expected_version: op.version }] }), ctx);
  assert.ok(g.grupo_id);
  const cart = C.cartera_(db);
  const n = cart.get('CL-1');
  assert.equal(n.facturas[0].saldo_confirmado, 0, 'la aplicación sigue valiendo después de conciliar');
  assert.equal(n.sin_aplicar, 0, 'el abono no aparece dos veces ni queda libre');
  assert.equal(cart.huerfanas.length, 0);
  // Volver a aplicar el mismo abono (con la referencia antigua o la nueva) no se puede: ya está usado.
  assert.ok(C.aplicar(db, D({ recepcion_ref: 'op:' + op.id + ':0', aplicaciones: [{ factura_id: f.id, monto: 1 }] }), ctx)._validationError);
  // Deshacer la conciliación: la operación vuelve al registro y la aplicación la sigue encontrando.
  Conc.desconciliar(db, D({ grupo_id: g.grupo_id, motivo: 'prueba' }), ctx);
  const n2 = C.cartera_(db).get('CL-1');
  assert.equal(n2.facturas[0].saldo_confirmado, 0);
  assert.equal(C.cartera_(db).huerfanas.length, 0);
});

test('Recepción mixta $619.000 conciliada: $119.000 propios y $500.000 del cliente, cada parte una vez en su circuito', (t) => {
  const { db, ctx, D } = preparar(t);
  const op = Op.guardar(db, D({ empresa: 'HomePymes', fecha: '2026-08-05', sentido: 'ENTRADA', monto: 619000, tercero: 'Panadería', confirmar: true, distribuciones: [
    { monto: 119000, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-3' },
    { monto: 500000, tipo: 'FONDO_RECIBIDO', subtipo: 'RECEPCION', cuenta: 'Imposiciones', cliente_id: 'CL-3' }] }), ctx);
  F.importarCartola(db, D({ filas: cartola([['05/08/2026', 'TRANSFER DE PANADERIA SOL', 0, 619000, '5']]), empresa: 'HomePymes' }), ctx);
  const m = movDe(db, D, ctx, '2026-08', 'TRANSFER DE PANADERIA SOL');
  Conc.conciliar(db, D({ movimientos: [{ id: m.id, expected_version: m.version }], operaciones: [{ id: op.id, expected_version: op.version }] }), ctx);
  const rep = R.reporte_(db, { periodo: '2026-08', hoy: '2026-11-15' });
  assert.equal(rep.metrics.ingresos, 119000);
  assert.equal(rep.metrics.fondos_recibidos, 500000);
  assert.equal(Fo.custodiaAl_('2026-08-31', '').positivos, 500000);
  assert.deepEqual(H.alias_().get('op:' + op.id + ':1'), ['mov:' + m.id + ':1'], 'cada parte sabe de qué parte del registro viene');
});

test('Anular el registro en conflicto lo saca del pendiente; reintentar con la misma clave no duplica', (t) => {
  const { db, ctx, D } = preparar(t);
  bancoClasificado(db, D, ctx, [['02/08/2026', 'TRANSFER DE ANDES MONTAJE', 0, 357000, '1']], 'TRANSFER DE ANDES MONTAJE', { tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' });
  const datos = Object.assign({ fecha: '2026-08-02', confirmar: true, idempotency_key: 'k-andes-1' }, ANDES);
  const a = Op.guardar(db, D(datos), ctx);
  const b = Op.guardar(db, D(datos), ctx);
  assert.equal(a.id, b.id, 'mismo comando, mismo resultado');
  assert.equal(Op.listar(db, D({ periodo: '2026-08' }), ctx).operaciones.length, 1);
  Op.accionLote(db, D({ accion: 'ANULAR', ids: [a.id], motivo: 'Era el mismo cobro', versiones: { [a.id]: a.version } }), ctx);
  const rep = R.reporte_(db, { periodo: '2026-08', hoy: '2026-11-15' });
  assert.equal(rep.metrics.ingresos, 357000);
  assert.equal(rep.metrics.pendiente_identidad.monto, 0);
  assert.ok(!rep.quality.reasons.some((r) => r.codigo === 'CONFLICTO_IDENTIDAD'));
});

test('Efectivo no es posible duplicado de un movimiento del banco', (t) => {
  const { db, ctx, D } = preparar(t);
  bancoClasificado(db, D, ctx, [['02/08/2026', 'TRANSFER DE ANDES MONTAJE', 0, 357000, '1']], 'TRANSFER DE ANDES MONTAJE', { tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' });
  const op = Op.guardar(db, D(Object.assign({ fecha: '2026-08-02', confirmar: true }, ANDES, { medio: 'EFECTIVO' })), ctx);
  assert.deepEqual(op.coincidencias_banco, []);
  assert.equal(ingresos(db, '2026-08'), 714000, 'el efectivo no pasa por el banco: son dos cobros');
});
