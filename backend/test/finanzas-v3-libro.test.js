'use strict';

/**
 * Finanzas v3 «banco primero»: llevar un mes del Excel BANCOS al libro del banco.
 * Datos ficticios con la misma forma del Excel real (encabezado, OBS, UNITARIO con fórmulas).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparar, cartola } = require('./_finanzasPrueba');
const F = require('../logica/finanzasBancos');
const Lb = require('../logica/finanzasLibro');
const Fo = require('../logica/finanzasFondos');
const B = require('../logica/finanzasBoveda');

const CAB = ['AB', '.', 'TOTAL', 'SALDO', 'FECHA', 'DETALLE', 'PLAN DE CUENTA', 'UNITARIO', 'OBS', 'DETALLE BANCO'];
// Serie de Excel: 46238 = 2026-08-04.
function hoja(filas) {
  const valores = [[], ['', '', '', '', '', 'ABONO', '0'], CAB].concat(filas.map((f) => f.v));
  const formulas = [[], [], []].concat(filas.map((f) => f.f || []));
  return { filas: valores, formulas };
}
const fila = (n, total, dia, alias, obs, opc) => {
  opc = opc || {};
  const v = [String(n), '', String(total), '', String(46238 + dia), alias, opc.plan || '', opc.unit === undefined ? '' : String(opc.unit), obs, opc.banco || ''];
  const f = opc.formula ? ['', '', '', '', '', '', '', opc.formula] : [];
  return { v, f };
};

function base(t) {
  const p = preparar(t);
  const { db, ctx, D } = p;
  F.importarCartola(db, D({ empresa: 'HomePymes', periodo: '01-08-2026 al 31-08-2026', filas: cartola([
    ['03/08/2026', 'TRANSFER DE ANDES MONTAJE', 0, 150000, '1'],
    ['04/08/2026', 'TRANSFER DE CONSTRUCTORA NORTE', 0, 5000000, '2'],
    ['04/08/2026', 'TRANSFER DE PANADERIA SOL', 0, 5000000, '3'],
    ['05/08/2026', 'PAGO EN LINEA PREVIRED', 4900000, 0, '4'],
    ['05/08/2026', 'PAGO EN LINEA PREVIRED', 5000000, 0, '5'],
    ['06/08/2026', 'TRANSFER DE ELECTRICA PACIF', 0, 88000, '6']
  ], { periodo: '01-08-2026 al 31-08-2026' }) }), ctx);
  const cuenta = B.dbFin().prepare('SELECT id FROM FIN_CUENTAS').get().id;
  return Object.assign(p, { cuenta });
}

test('v3 · un mes del Excel BANCOS al libro: empareja por nombre, clasifica por OBS y arma los grupos de fondos', (t) => {
  const { db, ctx, D, cuenta } = base(t);
  // Filas 4.. (la fila 3 es el encabezado): dos abonos de $5.000.000 el mismo día de clientes distintos.
  const h = hoja([
    fila(1, 150000, 0, 'ANDES', 'ABONO', { unit: 150000, banco: 'Transferencia recibida de Andes Montajes' }),
    fila(2, 5000000, 1, 'PANADERIA SOL', 'IMPOSICIONES', { banco: 'Transferencia recibida de Panaderia Sol' }),
    fila(3, 5000000, 1, 'CONSTRUCTORA NORTE', 'IMPOSICIONES', { banco: 'Transferencia recibida de Constructora Norte' }),
    fila(4, -4900000, 2, 'CONSTRUCTORA NORTE', 'ABONO', { unit: 100000, formula: '=+C6+C7', banco: 'Pago en línea previred' }),
    fila(5, -5000000, 2, 'PANADERIA SOL', 'SALDO', { unit: 0, formula: '=+C5+C8', banco: 'Pago en línea previred' }),
    fila(6, 88000, 3, 'NADIE CONOCIDO', 'ABONO', { unit: 88000 }),
    fila(7, -500000, 26, 'ARRIENDO OFICINA', 'ABONO', { unit: -500000, plan: 'ARRIENDO' }) // no está en la cartola
  ]);
  const r = Lb.llevarMes(db, D({ filas: h.filas, formulas: h.formulas, periodo: '2026-08', cuenta_ref: cuenta, archivo: 'BANCOS demo' }), ctx);
  assert.equal(r.emparejadas, 6);
  // Lo que el banco no trae queda en la planilla marcado «sin cartola» (antes se perdía y el mes no cuadraba con el Excel).
  assert.deepEqual(r.sin_banco, []);
  assert.equal(r.creadas_sin_cartola, 1);
  assert.equal(r.por_revisar.length, 1, 'el nombre que no se conoce queda por revisar');
  // Cada abono de $5.000.000 quedó con SU cliente (se emparejó por el nombre, no por el orden).
  const movs = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos;
  const norte = movs.find((m) => m.glosa === 'TRANSFER DE CONSTRUCTORA NORTE');
  assert.equal(norte.planilla.alias, 'CONSTRUCTORA NORTE');
  // Grupo de Norte: 5.000.000 − 4.900.000 = 100.000, la fila de cierre dice ABONO → honorario.
  const gN = r.grupos.find((g) => g.cierre === 7);
  assert.deepEqual([gN.filas, gN.honorario, gN.saldo_sigso], [2, 100000, 0]);
  // Grupo de Panadería: 0, cierre SALDO.
  const gP = r.grupos.find((g) => g.cierre === 8);
  assert.equal(gP.saldo_sigso, 0);
  // El libro: categorías como el Excel y saldo del mes acumulado.
  const lb = Lb.libro(db, D({ periodo: '2026-08' }), ctx);
  assert.equal(lb.lineas.length, 7, 'las 6 del banco y la del arriendo, que espera la cartola');
  assert.equal(lb.neto, 150000 + 5000000 + 5000000 - 4900000 - 5000000 + 88000 - 500000);
  assert.equal(lb.resumen.ABONO, 150000, 'el honorario por remanente no pasa por el banco: se suma aparte');
  assert.equal(lb.fuera_banco.resumen.ABONO, 100000, 'el remanente de Norte quedó como honorario sin banco');
  assert.equal(lb.fuera_banco.resumen.FONDOS, -100000, 'y salió de los fondos del cliente');
  assert.equal(lb.resumen['SIN CLASIFICAR'], 88000);
  assert.equal(lb.lineas[lb.lineas.length - 1].saldo_mes, lb.neto);
  assert.equal(lb.verificados, 6);
  // Repetir no duplica ni vuelve a clasificar lo confirmado.
  const r2 = Lb.llevarMes(db, D({ filas: h.filas, formulas: h.formulas, periodo: '2026-08', cuenta_ref: cuenta, archivo: 'BANCOS demo' }), ctx);
  assert.equal(r2.clasificadas, 0);
  assert.equal(F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos.length, 7, 'el arriendo sin cartola no se duplica');
  void Fo;
});

test('v3 · un mes sin cartola se carga desde la planilla, marcado sin verificar', (t) => {
  const { db, ctx, D, cuenta } = base(t);
  // Septiembre: no hay cartola.
  const h = hoja([
    fila(1, 150000, 31, 'ANDES', 'ABONO', { unit: 150000 }),
    fila(2, -60000, 32, 'CUENTAS BASICAS', 'ABONO', { unit: -60000, plan: 'CUENTAS BASICAS' })
  ]);
  const r = Lb.llevarMes(db, D({ filas: h.filas, formulas: h.formulas, periodo: '2026-09', cuenta_ref: cuenta, archivo: 'BANCOS sep' }), ctx);
  assert.deepEqual([r.creadas_sin_cartola, r.clasificadas], [2, 2]);
  const lb = Lb.libro(db, D({ periodo: '2026-09' }), ctx);
  assert.deepEqual([lb.sin_cartola, lb.verificados, lb.cartola], [2, 0, null]);
  assert.equal(lb.lineas.every((l) => l.verificado === false), true);
  assert.equal(lb.resumen.GASTO, -60000);
});

test('v3 · formar un grupo de fondos desde el libro: clasifica las filas como dinero del cliente y crea la gestión', (t) => {
  const { db, ctx, D } = base(t);
  const movs = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos;
  const recibe = movs.find((m) => m.glosa === 'TRANSFER DE CONSTRUCTORA NORTE');
  const paga = movs.find((m) => m.cargo === 4900000);
  const r = Lb.agrupar(db, D({ ids: [recibe.id, paga.id], cliente_id: 'CL-2', obligacion: 'Imposiciones', periodo_obligacion: '2026-07' }), ctx);
  assert.deepEqual([r.asignadas, r.saldo], [2, 100000]);
  const lb = Lb.libro(db, D({ periodo: '2026-08' }), ctx);
  const l = lb.lineas.find((x) => x.id === recibe.id);
  assert.deepEqual([l.categoria, l.cliente, l.grupo && l.grupo.obligacion], ['FONDOS', 'CONSTRUCTORA NORTE SPA', 'Imposiciones']);
  assert.ok(Lb.agrupar(db, D({ ids: [recibe.id], cliente_id: 'CL-2', obligacion: 'Cualquier cosa' }), ctx)._validationError, 'la obligación sale del catálogo');
});

test('v3 · nombres por enseñar: candidatos por parecido, enseñar y volver a aplicar sin subir de nuevo el Excel', (t) => {
  const { db, ctx, D, cuenta } = base(t);
  const h = hoja([fila(1, 88000, 3, 'ELEC PAC SUR', 'ABONO', { unit: 88000, banco: 'Transferencia recibida de Juan Perez' })]);
  const r = Lb.llevarMes(db, D({ filas: h.filas, formulas: h.formulas, periodo: '2026-08', cuenta_ref: cuenta, archivo: 'x' }), ctx);
  assert.equal(r.por_revisar.length, 1);
  const n = Lb.nombres(db, D({ periodo: '2026-08' }), ctx).nombres;
  assert.deepEqual([n.length, n[0].alias, n[0].candidatos[0].id, n[0].quien_paga[0]], [1, 'ELEC PAC SUR', 'CL-4', 'Juan Perez']);
  require('../logica/finanzasPagadores').guardarAlias(db, D({ alias: [{ alias: 'ELEC PAC SUR', clase: 'cliente', cliente_id: 'CL-4' }] }), ctx);
  const re = Lb.reaplicar(db, D({ periodo: '2026-08' }), ctx);
  assert.deepEqual([re.clasificadas, re.por_revisar.length], [1, 0]);
  assert.equal(Lb.nombres(db, D({ periodo: '2026-08' }), ctx).nombres.length, 0);
  const l = Lb.libro(db, D({ periodo: '2026-08' }), ctx).lineas.find((x) => x.monto === 88000);
  assert.deepEqual([l.categoria, l.cliente], ['ABONO', 'ELECTRICA PACIFICO LTDA']);
});

test('v3 · resumen tipo FLUJO por concepto y mes, y los clientes del mes', (t) => {
  const { db, ctx, D, cuenta } = base(t);
  const h = hoja([
    fila(1, 150000, 0, 'ANDES', 'ABONO', { unit: 150000, banco: 'Transferencia recibida de Andes Montajes' }),
    fila(2, 5000000, 1, 'CONSTRUCTORA NORTE', 'IMPOSICIONES', { banco: 'Transferencia recibida de Constructora Norte' }),
    fila(3, -4900000, 2, 'CONSTRUCTORA NORTE', 'ABONO', { unit: 100000, formula: '=+C5+C6', banco: 'Pago en línea previred' })
  ]);
  Lb.llevarMes(db, D({ filas: h.filas, formulas: h.formulas, periodo: '2026-08', cuenta_ref: cuenta, archivo: 'x' }), ctx);
  const fl = Lb.flujo(db, D({ hasta: '2026-08', meses: 2 }), ctx);
  assert.deepEqual(fl.meses, ['2026-07', '2026-08']);
  const hon = fl.filas.find((f) => f.categoria === 'ABONO' && f.cuenta === 'Servicio Mensual');
  assert.equal(hon.valores['2026-08'], 250000, 'el honorario del banco y el remanente cobrado como honorario');
  const imp = fl.filas.find((f) => f.tipo === 'FONDO_RECIBIDO' && f.cuenta === 'Imposiciones');
  assert.equal(imp.valores['2026-08'], 5000000);
  const cm = Lb.clientesMes(db, D({ periodo: '2026-08' }), ctx).clientes;
  const norte = cm.find((c) => c.cliente_id === 'CL-2');
  assert.deepEqual([norte.fondos_recibidos, norte.fondos_pagados, norte.honorarios], [5000000, -5000000, 100000]);
  assert.equal(cm.find((c) => c.cliente_id === 'CL-1').honorarios, 150000);
});
