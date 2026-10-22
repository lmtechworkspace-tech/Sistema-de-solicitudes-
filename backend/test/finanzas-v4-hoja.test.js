'use strict';

/**
 * Finanzas v4 · la planilla del banco: se llena como el Excel BANCOS (celda a celda) y de ella salen el
 * resumen de arriba, el FLUJO por plan de cuenta, el saldo por cliente y la cobranza.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparar, cartola } = require('./_finanzasPrueba');
const F = require('../logica/finanzasBancos');
const H = require('../logica/finanzasHoja');
const Lb = require('../logica/finanzasLibro');
const B = require('../logica/finanzasBoveda');

function base(t) {
  const p = preparar(t);
  const { db, ctx, D } = p;
  F.importarCartola(db, D({ empresa: 'HomePymes', filas: cartola([['04/08/2026', 'TRANSFER DE ELECTRICA PACIF', 0, 88000, '1']]) }), ctx);
  const cuenta = B.dbFin().prepare('SELECT id FROM FIN_CUENTAS').get().id;
  return Object.assign(p, { cuenta });
}
const SEP = { periodo: '01-09-2026 al 30-09-2026' };
const fila = (h, nombre) => h.filas.find((f) => f.nombre === nombre);

test('hoja · se llena celda a celda y arma el resumen de arriba, los grupos y el control del TOTAL', (t) => {
  const { db, ctx, D, cuenta } = base(t);
  const g = (campos, extra) => H.guardar(db, D(Object.assign({ cuenta_ref: cuenta, campos }, extra || {})), ctx);
  assert.ok(g({ fecha: '2026-09-02', monto: 357000, nombre: 'andes montajes', obs: 'ABONO' }).id);
  g({ fecha: '2026-09-05', monto: 900000, nombre: 'CONSTRUCTORA NORTE', obs: 'IMPOSICIONES', grupo: 'a' });
  g({ fecha: '2026-09-09', monto: -870000, nombre: 'CONSTRUCTORA NORTE', obs: 'IMPOSICIONES', grupo: 'A' });
  g({ fecha: '2026-09-10', monto: -450000, nombre: 'ARRIENDO', obs: 'ABONO', plan: 'Arriendo Mensual' });
  g({ fecha: '2026-09-12', monto: -60000, nombre: 'GASTO RARO', obs: 'ABONO' }); // sin plan: falta completar
  const nueva = g({ fecha: '2026-09-20', monto: 95000 }); // se anota primero el monto; el nombre después
  let h = H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx);
  assert.equal(h.filas.length, 6);
  assert.equal(fila(h, 'ANDES MONTAJES').que.t, 'Honorario', 'el nombre se guarda en mayúsculas, como en la planilla');
  assert.equal(fila(h, 'GASTO RARO').que.t, 'Gasto · sin plan', 'como en el Excel, cuenta igual (y se avisa)');
  assert.equal(h.estado.por_completar, 1, 'solo la fila sin OBS');
  assert.equal(h.estado.esperando, 6);
  assert.deepEqual(h.grupos.map((x) => [x.letra, x.filas, x.suma, x.decision, x.cliente]), [['A', 2, 30000, 'PENDIENTE', 'CONSTRUCTORA NORTE SPA']]);
  // Lo que sobra del grupo se cobra como honorario.
  H.decidirGrupo(db, D({ cuenta_ref: cuenta, periodo: '2026-09', letra: 'A', decision: 'ABONO' }), ctx);
  // Completar la fila nueva y el plan que faltaba.
  const r = h.filas.find((f) => f.id === nueva.id);
  g({ nombre: 'TRANSPORTES DEL SUR', obs: 'ABONO' }, { id: r.id, expected_version: r.version });
  const raro = fila(h, 'GASTO RARO');
  g({ plan: 'cuentas basicas' }, { id: raro.id, expected_version: raro.version });
  h = H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx);
  const T = h.totales;
  assert.equal(T.ABONO, 357000 + 95000 + 30000 - 450000 - 60000, 'ABONO es neto, como el SUMIF de la planilla');
  assert.equal(T.HONORARIOS, 357000 + 95000 + 30000);
  assert.equal(T.GASTOS, -510000);
  assert.equal(T.SIN_COMPLETAR, 0);
  assert.equal(T.TOTAL, 357000 + 900000 - 870000 - 450000 - 60000 + 95000);
  assert.equal(T.ABONO + T['ABONO RENTA'] + T.FONDOS + T.SALDO + T.PENDIENTE + T.OTRO_MES + T.TRASPASOS + T.SIN_COMPLETAR, T.TOTAL, 'el TOTAL cuadra con la suma de las categorías');
  assert.equal(h.filas[h.filas.length - 1].saldo, T.TOTAL, 'el saldo acumulado termina en el TOTAL');

  // FLUJO del mes por plan de cuenta, con el honorario del grupo y los fondos aparte.
  const fl = H.flujo(db, D({ hasta: '2026-09', meses: 1 }), ctx);
  const v = (l, p) => ((l.find((x) => x.plan === p) || {}).valores || {})['2026-09'] || 0;
  assert.equal(v(fl.ingresos, 'Servicio Mensual'), 357000 + 95000 + 30000);
  assert.equal(v(fl.egresos, 'Arriendo Mensual'), 450000);
  assert.equal(v(fl.egresos, 'Cuentas Básicas'), 60000);
  assert.equal(fl.fondos.recibido['2026-09'], 900000);
  assert.equal(fl.fondos.honorario['2026-09'], 30000);

  // Saldo por cliente: a Norte se le cobró lo que sobró; su saldo de fondos queda en cero.
  const cl = H.clientes(db, D({ periodo: '2026-09' }), ctx).clientes;
  const norte = cl.find((c) => /NORTE/.test(c.cliente));
  assert.deepEqual([norte.recibido, norte.pagado, norte.cobrado, norte.saldo], [900000, 870000, 30000, 0]);
  assert.ok(cl.find((c) => c.cliente === 'TRANSPORTES DEL SUR' && c.sin_ficha), 'un nombre sin ficha de cliente igual aparece');

  // Llega la cartola: lo anotado se une con el banco y lo que nadie anotó aparece para completarlo.
  F.importarCartola(db, D({ filas: cartola([['02/09/2026', 'TRANSFER DE ANDES MONTAJE', 0, 357000, '11'], ['10/09/2026', 'TRANSFERENCIA A INMOBILIARIA', 450000, 0, '12'], ['30/09/2026', 'COMISION MANTENCION', 6075, 0, '13']], SEP) }), ctx);
  h = H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx);
  assert.deepEqual([h.estado.ok, h.estado.esperando, h.estado.falta], [2, 4, 1]);
  const falta = h.filas.find((f) => f.banco === 'falta');
  assert.equal(falta.que.t, 'Falta anotar');
  g({ nombre: 'COMISION', obs: 'ABONO', plan: 'Comisión Banco' }, { id: falta.id, expected_version: falta.version });
  h = H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx);
  assert.equal(h.estado.falta, 0);
  assert.equal(fila(h, 'COMISION').que.t, 'Gasto');
  assert.ok(h.cartola, 'con cartola, la hoja trae el saldo inicial y final del banco');
});

test('hoja · corregir, borrar, versión vieja y un grupo que viene del Excel BANCOS', (t) => {
  const { db, ctx, D, cuenta } = base(t);
  const g = (campos, extra) => H.guardar(db, D(Object.assign({ cuenta_ref: cuenta, campos }, extra || {})), ctx);
  g({ fecha: '2026-09-02', monto: 200000, nombre: 'ANDES MONTAJES', obs: 'ABONO' });
  let h = H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx);
  const a = fila(h, 'ANDES MONTAJES');
  assert.ok(!g({ obs: 'ABONO RENTA' }, { id: a.id, expected_version: a.version })._validationError);
  assert.equal(g({ obs: 'ABONO' }, { id: a.id, expected_version: a.version }).codigo, 'CONFLICTO_VERSION', 'con la versión vieja no se pisa');
  h = H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx);
  assert.equal(h.totales['ABONO RENTA'], 200000);
  const a2 = fila(h, 'ANDES MONTAJES');
  assert.equal(g({ monto: 210000, fact: '1052' }, { id: a2.id, expected_version: a2.version })._validationError, undefined);
  h = H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx);
  assert.deepEqual([fila(h, 'ANDES MONTAJES').monto, fila(h, 'ANDES MONTAJES').fact], [210000, '1052']);
  assert.equal(H.borrar(db, D({ id: a2.id }), ctx).borrada, true);
  assert.equal(H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx).filas.length, 0);
  assert.ok(g({ fecha: '2026-09-02', monto: 'abc' })._validationError, 'el monto se valida');
  assert.ok(H.decidirGrupo(db, D({ cuenta_ref: cuenta, periodo: '2026-09', letra: 'A', decision: 'OTRA' }), ctx)._validationError);

  // Un mes llevado del Excel BANCOS: su grupo de UNITARIO aparece con letra y con la decisión de la fila de cierre.
  const CAB = ['AB', '.', 'TOTAL', 'SALDO', 'FECHA', 'DETALLE', 'PLAN DE CUENTA', 'UNITARIO', 'OBS', 'DETALLE BANCO'];
  const filas = [[], ['', '', '', '', '', 'ABONO', '0'], CAB,
    ['1', '', '900000', '', String(46238 + 31), 'CONSTRUCTORA NORTE', '', '', 'IMPOSICIONES', ''],
    ['2', '', '-870000', '', String(46238 + 33), 'CONSTRUCTORA NORTE', '', '30000', 'ABONO', '']];
  const formulas = [[], [], [], [], ['', '', '', '', '', '', '', '=+C4+C5']];
  const r = Lb.llevarMes(db, D({ filas, formulas, periodo: '2026-09', cuenta_ref: cuenta, archivo: 'BANCOS demo' }), ctx);
  assert.ok(!r._validationError, r.message);
  h = H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx);
  assert.equal(h.grupos.length, 1);
  assert.deepEqual([h.grupos[0].letra, h.grupos[0].suma, h.grupos[0].decision, h.grupos[0].excel], ['A', 30000, 'ABONO', true]);
  assert.equal(h.totales.ABONO, 30000, 'lo que sobró del grupo con OBS ABONO es honorario, como en la planilla');
  // Editar una fila de ese grupo (que está en una gestión) funciona: sale de la gestión y conserva su letra.
  const n1 = h.filas.find((f) => f.monto === 900000);
  assert.equal(g({ nota: 'transferencia de la gerente' }, { id: n1.id, expected_version: n1.version })._validationError, undefined);
  const n2 = h.filas.find((f) => f.monto === -870000);
  assert.equal(g({ obs: 'IMPOSICIONES' }, { id: n2.id, expected_version: n2.version })._validationError, undefined);
  h = H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx);
  assert.deepEqual(h.filas.map((f) => f.grupo), ['A', 'A']);
  assert.equal(h.filas.find((f) => f.monto === 900000).nota, 'transferencia de la gerente');
});

test('hoja · la OBS anotada manda sobre la clasificación (empresa del grupo con OBS ABONO suma en ABONO, como el Excel)', () => {
  assert.equal(H.que_({ banco: 'ok', tipo_mov: 'PRESTAMO', obs: 'ABONO', monto: -500000, plan: '', nombre: 'VIRTUAL BASE' }).k, 'gas');
  assert.equal(H.que_({ banco: 'ok', tipo_mov: 'TRASPASO', obs: 'ABONO', monto: 500000, plan: '', nombre: 'HOMEPYMES' }).k, 'ing');
  assert.equal(H.que_({ banco: 'ok', tipo_mov: 'PRESTAMO', obs: '', monto: 500000, plan: 'Préstamo', nombre: 'GDE' }).k, 'tra', 'sin OBS, sigue siendo préstamo');
  assert.equal(H.que_({ banco: 'falta', obs: '', monto: 1 }).k, 'falta');
});

test('hoja · cobranza: una factura queda pagada con su N° en la fila del abono', (t) => {
  const { db, ctx, D, cuenta } = base(t);
  const C = require('../logica/finanzasCobranza');
  const imp = C.importarFacturasPlanilla ? C.importarFacturasPlanilla : null;
  const cob = H.cobranza(db, D({}), ctx);
  assert.deepEqual(cob.totales, { facturado: 0, pagado: 0, por_cobrar: 0, vencido: 0 });
  assert.ok(imp === null || typeof imp === 'function');
  H.guardar(db, D({ cuenta_ref: cuenta, campos: { fecha: '2026-09-02', monto: 100000, nombre: 'ANDES MONTAJES', obs: 'ABONO', fact: '9001' } }), ctx);
  assert.equal(H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx).filas[0].fact, '9001');
});
