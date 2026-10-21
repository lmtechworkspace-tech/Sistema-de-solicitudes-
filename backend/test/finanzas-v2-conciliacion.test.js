'use strict';

/**
 * Finanzas · corrección v2, I02 (2026-10-20): conciliación con importes
 * explícitos (parcial y varios contra varios), resto pendiente, explicación de
 * la diferencia, fechas efectiva/bancaria, deshacer con dependencias y
 * candidatos con ventana ampliable. QA-R05, QA-R06. Datos ficticios.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparar, versionDe, cartola } = require('./_finanzasPrueba');
const F = require('../logica/finanzasBancos');
const Op = require('../logica/finanzasOperaciones');
const Conc = require('../logica/finanzasConciliacion');
const H = require('../logica/finanzasHechos');
const R = require('../logica/finanzasReportes');
const Fo = require('../logica/finanzasFondos');
const Ci = require('../logica/finanzasCierre');
const B = require('../logica/finanzasBoveda');

const rep = (db, p) => R.reporte_(db, { periodo: p, hoy: '2026-11-15' }).metrics;
function mov(db, D, ctx, p, glosa) { return F.movimientos(db, D({ periodo: p }), ctx).movimientos.find((m) => m.glosa === glosa); }
function cobro(db, D, ctx, fecha, monto, extra) {
  return Op.guardar(db, D(Object.assign({ empresa: 'HomePymes', fecha, sentido: 'ENTRADA', monto, tercero: 'Andes', tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1', confirmar: true }, extra || {})), ctx);
}

test('QA-R05 · vínculo parcial: el banco trae $300.000 de una operación de $500.000; el resto sigue esperando el banco', (t) => {
  const { db, ctx, D } = preparar(t);
  const op = cobro(db, D, ctx, '2026-08-04', 500000);
  F.importarCartola(db, D({ filas: cartola([['05/08/2026', 'TRANSFER DE ANDES MONTAJE', 0, 300000, '1']]), empresa: 'HomePymes' }), ctx);
  const m = mov(db, D, ctx, '2026-08', 'TRANSFER DE ANDES MONTAJE');
  // Exacto sin importes: no calza y lo explica (no inventa un ajuste).
  const e = Conc.conciliar(db, D({ movimientos: [m.id], operaciones: [op.id] }), ctx);
  assert.ok(e._validationError && /pago parcial/.test(e.message));
  // Sobreaplicar: más de lo que tiene el movimiento.
  assert.ok(Conc.conciliar(db, D({ asignaciones: [{ movimiento_id: m.id, operacion_id: op.id, monto: 300001 }] }), ctx)._validationError);
  const r = Conc.conciliar(db, D({ asignaciones: [{ movimiento_id: m.id, operacion_id: op.id, monto: 300000 }] }), ctx);
  assert.equal(r.estados[0].conciliacion, 'PARCIAL');
  assert.equal(r.estados[0].pendiente, 200000);
  assert.equal(rep(db, '2026-08').ingresos, 500000, '300.000 por el banco + 200.000 que siguen en el registro: nada doble, nada perdido');
  assert.equal(H.todos_().filter((h) => h.fuente === 'REGISTRO').reduce((s, h) => s + h.abono, 0), 200000);
  // Llega el resto: se completa con otro movimiento.
  F.importarCartola(db, D({ filas: cartola([['10/08/2026', 'TRANSFER ANDES SALDO', 0, 200000, '2']]), empresa: 'HomePymes' }), ctx);
  const m2 = mov(db, D, ctx, '2026-08', 'TRANSFER ANDES SALDO');
  const c2 = Conc.candidatos(db, D({ movimiento_id: m2.id }), ctx);
  assert.equal(c2.candidatos[0].operacion_id, op.id, 'se propone por lo que le falta (200.000)');
  const r2 = Conc.conciliar(db, D({ movimientos: [m2.id], operaciones: [op.id] }), ctx);
  assert.equal(r2.estados[0].conciliacion, 'CONCILIADA');
  assert.equal(rep(db, '2026-08').ingresos, 500000);
  assert.equal(H.todos_().filter((h) => h.fuente === 'REGISTRO').length, 0);
});

test('QA-R05 · varios contra varios con asignación explícita; un error revierte todo el grupo', (t) => {
  const { db, ctx, D } = preparar(t);
  const a = cobro(db, D, ctx, '2026-08-04', 300000);
  const b = cobro(db, D, ctx, '2026-08-04', 200000, { cliente_id: 'CL-2' });
  F.importarCartola(db, D({ filas: cartola([['05/08/2026', 'DEPOSITO 1', 0, 250000, '1'], ['05/08/2026', 'DEPOSITO 2', 0, 250000, '2']]), empresa: 'HomePymes' }), ctx);
  const m1 = mov(db, D, ctx, '2026-08', 'DEPOSITO 1'), m2 = mov(db, D, ctx, '2026-08', 'DEPOSITO 2');
  // Sin importes no se combinan sumas a ciegas.
  assert.ok(/asignación explícita/.test(Conc.conciliar(db, D({ movimientos: [m1.id, m2.id], operaciones: [a.id, b.id] }), ctx).message));
  // Una asignación de más en el grupo → no se vincula NADA.
  const malo = Conc.conciliar(db, D({ asignaciones: [{ movimiento_id: m1.id, operacion_id: a.id, monto: 250000 }, { movimiento_id: m2.id, operacion_id: a.id, monto: 60000 }, { movimiento_id: m2.id, operacion_id: b.id, monto: 190000 }] }), ctx);
  assert.ok(malo._validationError, 'a la operación de 300.000 se le asignan 310.000');
  assert.equal(Conc.linksActivos_({ movimiento_id: m1.id }).length, 0, 'todo o nada');
  const ok = Conc.conciliar(db, D({ asignaciones: [{ movimiento_id: m1.id, operacion_id: a.id, monto: 250000 }, { movimiento_id: m2.id, operacion_id: a.id, monto: 50000 }, { movimiento_id: m2.id, operacion_id: b.id, monto: 200000 }] }), ctx);
  assert.deepEqual(ok.estados.map((e) => e.conciliacion), ['CONCILIADA', 'CONCILIADA']);
  const M = rep(db, '2026-08');
  assert.equal(M.ingresos, 500000);
  const porCliente = {};
  H.todos_().forEach((h) => { if (h.clasif) porCliente[h.clasif.cliente_id] = (porCliente[h.clasif.cliente_id] || 0) + h.abono; });
  assert.deepEqual(porCliente, { 'CL-1': 300000, 'CL-2': 200000 }, 'cada cliente recibe lo suyo, sumando exacto');
});

test('Movimiento mayor que lo registrado: el resto queda pendiente y se ve; un movimiento ya clasificado se vincula completo', (t) => {
  const { db, ctx, D } = preparar(t);
  const op = cobro(db, D, ctx, '2026-08-05', 500000);
  F.importarCartola(db, D({ filas: cartola([['05/08/2026', 'TRANSFER DE PANADERIA SOL', 0, 619000, '5'], ['06/08/2026', 'OTRO ABONO', 0, 1000, '6']]), empresa: 'HomePymes' }), ctx);
  const m = mov(db, D, ctx, '2026-08', 'TRANSFER DE PANADERIA SOL');
  Conc.conciliar(db, D({ asignaciones: [{ movimiento_id: m.id, operacion_id: op.id, monto: 500000 }] }), ctx);
  const M = R.reporte_(db, { periodo: '2026-08', hoy: '2026-11-15' });
  assert.equal(M.metrics.ingresos, 500000);
  assert.ok(M.quality.reasons.some((r) => r.codigo === 'PENDIENTES' && r.monto >= 119000), 'los 119.000 sin explicar quedan como pendientes');
  // No se reclasifica por fuera un movimiento vinculado.
  const mm = mov(db, D, ctx, '2026-08', 'TRANSFER DE PANADERIA SOL');
  assert.equal(F.clasificar(db, D({ items: [{ id: mm.id, expected_version: mm.version, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-3' }] }), ctx).errores[0].codigo, 'CONCILIADO');
  // La bandeja lo muestra con lo que le falta.
  const bj = Conc.bandeja(db, D({ periodo: '2026-08' }), ctx);
  assert.equal(bj.movimientos.find((x) => x.id === m.id).disponible, 119000);
  // Un movimiento clasificado directo no se vincula a medias.
  const otro = mov(db, D, ctx, '2026-08', 'OTRO ABONO');
  F.clasificar(db, D({ items: [{ id: otro.id, tipo: 'INGRESO', cuenta: 'Otros Ingresos', recordar: false }] }), ctx);
  const op2 = cobro(db, D, ctx, '2026-08-06', 5000);
  assert.ok(/ya está clasificado/.test(Conc.conciliar(db, D({ asignaciones: [{ movimiento_id: otro.id, operacion_id: op2.id, monto: 500 }] }), ctx).message));
});

test('Explicar la diferencia con un componente comprobado (comisión): nunca un redondeo automático', (t) => {
  const { db, ctx, D } = preparar(t);
  const op = cobro(db, D, ctx, '2026-08-04', 100000);
  F.importarCartola(db, D({ filas: cartola([['05/08/2026', 'ABONO NETO', 0, 99000, '1']]), empresa: 'HomePymes' }), ctx);
  const m = mov(db, D, ctx, '2026-08', 'ABONO NETO');
  Conc.conciliar(db, D({ asignaciones: [{ movimiento_id: m.id, operacion_id: op.id, monto: 99000 }] }), ctx);
  const o = Op.porId_(op.id);
  assert.ok(Conc.explicarRemanente(db, D({ operacion_id: op.id, expected_version: o.version, cuenta: 'Comisión Banco', motivo: 'Comisión', respaldo: '' }), ctx)._validationError, 'exige respaldo');
  const r = Conc.explicarRemanente(db, D({ operacion_id: op.id, expected_version: o.version, cuenta: 'Comisión Banco', motivo: 'Comisión de la pasarela', respaldo: 'Liquidación 123' }), ctx);
  assert.equal(r.conciliacion, 'CONCILIADA');
  assert.equal(r.monto, 1000);
  const comp = Op.porId_(r.componente_id);
  assert.deepEqual([comp.medio, comp.conciliacion, comp.distribuciones[0].tipo], ['COMPENSACION', 'NO_APLICA', 'EGRESO'], 'la comisión queda registrada, sin caja');
  assert.equal(rep(db, '2026-08').ingresos, 99000, 'base de caja: entró lo que dice el banco');
});

test('QA-R06 · operación del 31-07 y banco del 03-08: el hecho sigue en julio; agosto no cambia; julio cerrado no se altera', (t) => {
  const { db, ctx, D } = preparar(t);
  const op = cobro(db, D, ctx, '2026-07-31', 357000);
  assert.equal(rep(db, '2026-07').ingresos, 357000);
  // Julio se cierra (simulado) con la operación sin banco.
  Ci.mesCerrado_('2026-07');
  B.dbFin().prepare("INSERT INTO FIN_CIERRES (periodo, estado, datos, actualizado_en, actualizado_por) VALUES ('2026-07', 'CERRADO', ?, '2026-08-02', 'prueba')").run(F.interno.cif_({}));
  F.importarCartola(db, D({ filas: cartola([['03/08/2026', 'TRANSFER DE ANDES MONTAJE', 0, 357000, '1']], { anterior: 1000000 }), empresa: 'HomePymes' }), ctx);
  const m = mov(db, D, ctx, '2026-08', 'TRANSFER DE ANDES MONTAJE');
  const c = Conc.conciliar(db, D({ movimientos: [m.id], operaciones: [op.id] }), ctx);
  assert.ok(c.grupo_id, 'vincular no cambia las cifras de julio: se permite aunque julio esté cerrado');
  assert.equal(rep(db, '2026-07').ingresos, 357000, 'julio sigue igual (fecha efectiva)');
  assert.equal(rep(db, '2026-08').ingresos || 0, 0, 'agosto no gana un cobro de julio');
  const h = H.todos_().find((x) => x.movimiento_id === m.id);
  assert.deepEqual([h.fecha, h.fecha_banco, h.periodo, h.periodo_banco], ['2026-07-31', '2026-08-03', '2026-07', '2026-08'], 'las dos fechas se conservan');
  assert.equal(R.reporte_(db, { periodo: '2026-08', hoy: '2026-11-15' }).metrics.caja, 1357000, 'la caja sigue la fecha del banco');
});

test('Deshacer con dependencias: si después de vincular se asignó la parte del banco a una gestión, se pide resolverlo', (t) => {
  const { db, ctx, D } = preparar(t);
  const op = Op.guardar(db, D({ empresa: 'HomePymes', fecha: '2026-08-05', sentido: 'ENTRADA', monto: 400000, tercero: 'Constructora', tipo: 'FONDO_RECIBIDO', subtipo: 'RECEPCION', cuenta: 'Imposiciones', cliente_id: 'CL-2', confirmar: true }), ctx);
  F.importarCartola(db, D({ filas: cartola([['05/08/2026', 'TRANSFER CONSTRUCTORA', 0, 400000, '1']]), empresa: 'HomePymes' }), ctx);
  const m = mov(db, D, ctx, '2026-08', 'TRANSFER CONSTRUCTORA');
  const g = Conc.conciliar(db, D({ movimientos: [m.id], operaciones: [op.id] }), ctx);
  const gest = Fo.guardarGestion(db, D({ cliente_id: 'CL-2', empresa: 'HomePymes', obligacion: 'Imposiciones', periodo_obligacion: '2026-07' }), ctx);
  assert.equal(Fo.asignarGestion(db, D({ refs: ['mov:' + m.id + ':0'], gestion_id: gest.id }), ctx).hechos, 1);
  const d = Conc.desconciliar(db, D({ grupo_id: g.grupo_id, motivo: 'prueba' }), ctx);
  assert.ok(d._validationError && /gestión de fondos/.test(d.message), 'no restaura a ciegas: la asignación se perdería');
  Fo.asignarGestion(db, D({ refs: ['mov:' + m.id + ':0'], gestion_id: '' }), ctx);
  assert.ok(Conc.desconciliar(db, D({ grupo_id: g.grupo_id, motivo: 'prueba' }), ctx).grupo_id);
  assert.equal(Op.porId_(op.id).conciliacion, 'SIN_BANCO');
});

test('Candidatos: la ventana de días se puede ampliar para una demora justificada', (t) => {
  const { db, ctx, D } = preparar(t);
  const op = cobro(db, D, ctx, '2026-07-10', 88000);
  F.importarCartola(db, D({ filas: cartola([['01/08/2026', 'TRANSFER TARDIA', 0, 88000, '1']]), empresa: 'HomePymes' }), ctx);
  const m = mov(db, D, ctx, '2026-08', 'TRANSFER TARDIA');
  assert.equal(Conc.candidatos(db, D({ movimiento_id: m.id }), ctx).candidatos.length, 0, '22 días: fuera de la ventana normal (10)');
  const amplia = Conc.candidatos(db, D({ movimiento_id: m.id, dias: 30 }), ctx);
  assert.equal(amplia.dias, 30);
  assert.equal(amplia.candidatos[0].operacion_id, op.id);
});
