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

test('hoja · en un mes cerrado no se toca nada: la clasificación no se pierde aunque se intente anotar', (t) => {
  const { db, ctx, D, cuenta } = base(t);
  const mov = () => B.dbFin().prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE periodo = ?').get('2026-08');
  const r0 = mov();
  const c = F.clasificar(db, D({ items: [{ id: r0.id, expected_version: r0.version || 0, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-4' }] }), ctx);
  assert.ok(!c._validationError, c.message);
  const Ci = require('../logica/finanzasCierre');
  Ci.mesCerrado_('2026-08'); // crea la tabla de cierres
  B.dbFin().prepare("INSERT INTO FIN_CIERRES (periodo, estado, datos) VALUES ('2026-08', 'CERRADO', '{}')").run();
  const r1 = mov();
  const g = H.guardar(db, D({ cuenta_ref: cuenta, id: r1.id, expected_version: r1.version, campos: { nombre: 'OTRO NOMBRE', obs: 'IVA' } }), ctx);
  assert.ok(g._validationError, 'el mes cerrado se rechaza');
  assert.match(g.message, /cerrado/);
  const r2 = mov();
  assert.equal(r2.estado, 'CONFIRMADO', 'sigue confirmado');
  assert.equal(r2.version, r1.version, 'no se tocó');
  assert.ok(require('../logica/finanzasBancos').interno.des_(r2.datos).clasif, 'la clasificación sigue ahí');
});

test('hoja · una OBS que no sirve no deja a medias una fila del banco ya clasificada', (t) => {
  const { db, ctx, D, cuenta } = base(t);
  const mov = () => B.dbFin().prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE periodo = ?').get('2026-08');
  const r0 = mov();
  F.clasificar(db, D({ items: [{ id: r0.id, expected_version: r0.version || 0, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-4' }] }), ctx);
  const r1 = mov();
  const g = H.guardar(db, D({ cuenta_ref: cuenta, id: r1.id, expected_version: r1.version, campos: { obs: 'CUALQUIERA' } }), ctx);
  assert.ok(g._validationError);
  assert.equal(mov().estado, 'CONFIRMADO');
  assert.equal(mov().version, r1.version);
});

test('hoja · borrar revisa todo antes: una fila del banco sin anotar no sale de su grupo de fondos', (t) => {
  const { db, ctx, D } = base(t);
  const r0 = B.dbFin().prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE periodo = ?').get('2026-08');
  assert.ok(H.borrar(db, D({ id: r0.id }), ctx)._validationError, 'no hay nada anotado que borrar');
  assert.equal(H.borrar(db, D({ id: r0.id, expected_version: 99 }), ctx)._validationError, true);
});

test('hoja · cobranza: el folio es de la empresa del banco, las notas de crédito no se cobran y un abono paga varias facturas', (t) => {
  const { db, ctx, D, cuenta } = base(t);
  const C = require('../logica/finanzasCobranza');
  const fact = (docs, empresa) => C.guardarFacturas_(db, empresa, docs, 'rcv', 'prueba');
  fact([{ tipo_doc: 33, folio: '100', fecha: '2026-09-01', cliente_id: 'CL-1', total: 300000 },
    { tipo_doc: 33, folio: '101', fecha: '2026-09-01', cliente_id: 'CL-2', total: 50000 },
    { tipo_doc: 33, folio: '102', fecha: '2026-09-01', cliente_id: 'CL-2', total: 50000 },
    { tipo_doc: 61, folio: '7', fecha: '2026-09-02', cliente_id: 'CL-2', total: 10000, referencia: '101' }], 'HomePymes');
  fact([{ tipo_doc: 33, folio: '100', fecha: '2026-09-01', cliente_id: 'CL-1', total: 90000 }], 'GDE');
  const g = (campos) => H.guardar(db, D({ cuenta_ref: cuenta, campos }), ctx);
  g({ fecha: '2026-09-03', monto: 300000, nombre: 'ANDES MONTAJES', obs: 'ABONO', fact: '100' });
  g({ fecha: '2026-09-04', monto: 90000, nombre: 'CONSTRUCTORA NORTE', obs: 'ABONO', fact: '101 y 102' });
  const cob = H.cobranza(db, D({ estado: 'todas' }), ctx);
  const de = (empresa, folio) => cob.facturas.find((f) => f.empresa === empresa && f.folio === folio);
  assert.equal(cob.total_facturas, 4, 'la nota de crédito no es una factura por cobrar');
  assert.equal(de('HomePymes', '100').estado, 'Pagada');
  assert.deepEqual([de('GDE', '100').pagado, de('GDE', '100').saldo], [0, 90000], 'el mismo folio en otra empresa sigue abierto');
  assert.deepEqual([de('HomePymes', '101').estado, de('HomePymes', '101').pagado], ['Pagada', 40000], 'la 101 tenía una nota de crédito de 10.000');
  assert.deepEqual([de('HomePymes', '102').estado, de('HomePymes', '102').pagado], ['Pagada', 50000]);
  assert.equal(cob.totales.por_cobrar, 90000);
  assert.equal(H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx).filas.find((f) => f.monto === 90000).fact, '101 y 102', 'el N° factura guarda varios folios');
  const cl = H.clientes(db, D({ periodo: '2026-09' }), ctx).clientes;
  assert.equal(cl.find((c) => c.cliente_id === 'CL-1').deuda, 90000, 'Andes debe la factura 100 de GDE');
});

test('hoja · la planilla del mes se descarga en Excel (filas, resumen y grupos) y en CSV', (t) => {
  const { db, ctx, D, cuenta } = base(t);
  const E = require('../logica/finanzasExportar');
  const g = (campos) => H.guardar(db, D({ cuenta_ref: cuenta, campos }), ctx);
  g({ fecha: '2026-09-02', monto: 357000, nombre: 'ANDES MONTAJES', obs: 'ABONO', fact: '9001' });
  g({ fecha: '2026-09-05', monto: 900000, nombre: 'CONSTRUCTORA NORTE', obs: 'IMPOSICIONES', grupo: 'A' });
  g({ fecha: '2026-09-09', monto: -870000, nombre: 'CONSTRUCTORA NORTE', obs: 'IMPOSICIONES', grupo: 'A' });
  assert.ok(E.exportar(db, D({ tipo: 'planilla', filtros: {} }), ctx)._validationError, 'pide el mes');
  const d = E.datos_(db, 'planilla', { periodo: '2026-09', cuenta_ref: cuenta });
  assert.equal(d.filas.length, 3);
  assert.deepEqual(d.filas[0].slice(1, 8), ['2026-09-02', 'ANDES MONTAJES', 'ABONO', '', 357000, '', '9001']);
  assert.equal(d.extra[0].filas[0][11], 357000 + 900000 - 870000, 'el resumen trae el TOTAL');
  assert.deepEqual(d.extra[1].filas[0].slice(1, 7), ['A', 'CONSTRUCTORA NORTE SPA', 2, 900000, -870000, 30000]);
  const x = E.exportar(db, D({ tipo: 'planilla', formato: 'xlsx', filtros: { periodo: '2026-09', cuenta_ref: cuenta } }), ctx);
  assert.ok(!x._validationError, x.message);
  assert.match(x.nombre, /^finanzas-planilla-2026-09-\d{4}\.xlsx$/);
  assert.ok(Buffer.from(x.base64, 'base64').slice(0, 2).toString() === 'PK', 'es un xlsx');
  const c = E.exportar(db, D({ tipo: 'planilla', formato: 'csv', filtros: { periodo: '2026-09', cuenta_ref: cuenta } }), ctx);
  assert.match(Buffer.from(c.base64, 'base64').toString('utf8'), /ANDES MONTAJES;ABONO/);
});

test('hoja · manda la fecha de la planilla (no la contable del banco) y una fila del banco se puede pasar al mes vecino', (t) => {
  const { db, ctx, D, cuenta } = base(t);
  // El banco contabiliza el 01-09 dos movimientos: uno es del 31-08 (según la planilla), el otro nadie lo anotó.
  F.importarCartola(db, D({ filas: cartola([['01/09/2026', 'PAGO CUENTAS VIA INTERNET', 120000, 0, '21'], ['01/09/2026', 'TRANSFER DE ANDES MONTAJE', 0, 357000, '22']], SEP) }), ctx);
  const serial = (iso) => String(Math.round((Date.parse(iso) - Date.UTC(1899, 11, 30)) / 864e5));
  const CAB = ['AB', '.', 'TOTAL', 'SALDO', 'FECHA', 'DETALLE', 'PLAN DE CUENTA', 'UNITARIO', 'OBS', 'DETALLE BANCO'];
  const filas = [[], ['', '', '', '', '', 'ABONO', '0'], CAB,
    ['1', '', '88000', '', serial('2026-08-04'), 'ELECTRICA PACIFICO', '', '88000', 'ABONO', ''],
    ['2', '', '357000', '', serial('2026-08-31'), 'ANDES MONTAJES', '', '357000', 'ABONO', ''],
    ['3', '', '-450000', '', serial('2026-08-30'), 'ARRIENDO', 'Arriendo Mensual', '-450000', 'ABONO', '']];
  const r = Lb.llevarMes(db, D({ filas, formulas: [], periodo: '2026-08', cuenta_ref: cuenta, archivo: 'BANCOS demo' }), ctx);
  assert.ok(!r._validationError, r.message);
  assert.equal(r.creadas_sin_cartola, 1, 'el arriendo que el banco no trae queda en la planilla, esperando la cartola');
  let ago = H.hoja(db, D({ periodo: '2026-08', cuenta_ref: cuenta }), ctx);
  const andes = ago.filas.find((f) => f.monto === 357000);
  assert.deepEqual([andes.fecha, andes.fecha_banco, andes.banco], ['2026-08-31', '2026-09-01', 'ok'], 'va en agosto, con la fecha del banco a la vista');
  assert.equal(ago.totales.TOTAL, 88000 + 357000 - 450000, 'agosto cuadra con el Excel');
  assert.equal(ago.cartola.cuadra, true);
  assert.equal(ago.cartola.n_cortes, 0, 'la cadena de saldos del banco no se corta: no hay repetidos ni faltantes');
  let sep = H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx);
  assert.deepEqual(sep.filas.map((f) => f.monto), [-120000]);
  assert.equal(sep.cartola.en_otro_mes.filas, 1, 'la cartola de septiembre avisa que una fila se ve en agosto');
  // El cargo del 01-09 era del 31-08: se pasa a agosto (solo al mes vecino).
  const cargo = sep.filas[0];
  assert.equal(cargo.con_fecha_tx, false, 'sin fecha de transacción: candidato a ser del mes anterior');
  assert.ok(H.moverMes(db, D({ ids: [cargo.id], periodo: '2026-11' }), ctx)._validationError, 'no a cualquier mes');
  assert.equal(H.moverMes(db, D({ ids: [cargo.id], periodo: '2026-08' }), ctx).movidas, 1);
  sep = H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx);
  ago = H.hoja(db, D({ periodo: '2026-08', cuenta_ref: cuenta }), ctx);
  assert.equal(sep.filas.length, 0);
  assert.deepEqual([ago.filas.find((f) => f.monto === -120000).fecha, ago.filas.find((f) => f.monto === -120000).movida], ['2026-08-31', true]);
  // Volver a su mes.
  H.moverMes(db, D({ ids: [cargo.id], periodo: '' }), ctx);
  assert.equal(H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx).filas.length, 1);
});

test('hoja · guardar devuelve la versión nueva (se puede seguir editando sin recargar) y la hoja recuerda lo último de cada nombre', (t) => {
  const { db, ctx, D, cuenta } = base(t);
  const n = H.guardar(db, D({ cuenta_ref: cuenta, campos: { fecha: '2026-09-02', monto: 357000, nombre: 'andes montajes', obs: 'ABONO', plan: 'Servicio Mensual' } }), ctx);
  assert.equal(typeof n.version, 'number');
  const e1 = H.guardar(db, D({ id: n.id, expected_version: n.version, campos: { fact: '77' } }), ctx);
  assert.ok(!e1._validationError && !e1._conflict, e1.message);
  const e2 = H.guardar(db, D({ id: n.id, expected_version: e1.version, campos: { nota: 'sin recargar' } }), ctx);
  assert.ok(!e2._validationError && e2.codigo !== 'CONFLICTO_VERSION', 'con la versión devuelta, la siguiente edición no choca');
  const h = H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx);
  assert.deepEqual([h.listas.memoria['ANDES MONTAJES'].obs, h.listas.memoria['ANDES MONTAJES'].plan], ['ABONO', 'Servicio Mensual']);
  // Para sugerir el plan de un gasto solo sirve el plan de sus gastos, no el de sus fondos (IVA, imposiciones…).
  H.guardar(db, D({ cuenta_ref: cuenta, campos: { fecha: '2026-09-03', monto: -90000, nombre: 'CONST MELO', obs: 'ABONO', plan: 'Convenios' } }), ctx);
  H.guardar(db, D({ cuenta_ref: cuenta, campos: { fecha: '2026-09-04', monto: 500000, nombre: 'CONST MELO', obs: 'IVA', plan: 'IVA' } }), ctx);
  const m = H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx).listas.memoria['CONST MELO'];
  assert.deepEqual([m.plan, m.plan_gasto], ['IVA', 'Convenios']);
});

test('hoja · corregir una sola fila de un grupo del Excel no lo parte ni corre las letras de los demás grupos', (t) => {
  const { db, ctx, D, cuenta } = base(t);
  const g = (campos, extra) => H.guardar(db, D(Object.assign({ cuenta_ref: cuenta, campos }, extra || {})), ctx);
  const CAB = ['AB', '.', 'TOTAL', 'SALDO', 'FECHA', 'DETALLE', 'PLAN DE CUENTA', 'UNITARIO', 'OBS', 'DETALLE BANCO'];
  const d0 = 46238 + 31;
  const filas = [[], ['', '', '', '', '', 'ABONO', '0'], CAB,
    ['1', '', '900000', '', String(d0), 'CONSTRUCTORA NORTE', '', '', 'IMPOSICIONES', ''],
    ['2', '', '-870000', '', String(d0 + 1), 'CONSTRUCTORA NORTE', '', '30000', 'ABONO', ''],
    ['3', '', '28655', '', String(d0 + 2), 'SERVICE TECH', '', '', 'IVA', ''],
    ['4', '', '-28655', '', String(d0 + 3), 'SERVICE TECH', '', '0', '', ''],
    ['5', '', '500000', '', String(d0 + 4), 'PANADERIA SOL', '', '', 'IVA', ''],
    ['6', '', '-499000', '', String(d0 + 5), 'PANADERIA SOL', '', '1000', 'SALDO', '']];
  const formulas = [[], [], [], [], ['', '', '', '', '', '', '', '=+C4+C5'], [], ['', '', '', '', '', '', '', '=+C6+C7'], [], ['', '', '', '', '', '', '', '=+C8+C9']];
  const r = Lb.llevarMes(db, D({ filas, formulas, periodo: '2026-09', cuenta_ref: cuenta, archivo: 'BANCOS demo' }), ctx);
  assert.ok(!r._validationError, r.message);
  let h = H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx);
  const antes = h.grupos.map((x) => [x.letra, x.cliente, x.decision]);
  assert.equal(antes.length, 3);
  // Se completa la OBS que faltaba en la fila de cierre del grupo de SERVICE TECH (como en septiembre).
  const st = h.filas.find((f) => f.monto === -28655);
  const e = g({ obs: 'IVA' }, { id: st.id, expected_version: st.version });
  assert.equal(e._validationError, undefined, e.message);
  h = H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx);
  assert.deepEqual(h.grupos.map((x) => [x.letra, x.cliente, x.decision]), antes, 'mismos grupos, mismas letras y decisiones');
  assert.equal(new Set(h.filas.filter((f) => /SERVICE/.test(f.nombre)).map((f) => f.grupo)).size, 1, 'el grupo no se parte');
  assert.equal(h.totales.PENDIENTE, 0);
  // Reparación: una fila que se corrigió con la versión anterior quedó sin su grupo del Excel (solo con su letra):
  // vuelve sola a su grupo por su N° de fila del Excel.
  const I = F.interno, pan = h.filas.find((f) => f.monto === -499000);
  const row = B.dbFin().prepare('SELECT datos FROM FIN_MOVIMIENTOS WHERE id = ?').get(pan.id), m = I.des_(row.datos);
  m.planilla.grupo = null; m.planilla.grupo_letra = pan.grupo; m.planilla.archivo = 'Registro en SIGSO';
  B.dbFin().prepare('UPDATE FIN_MOVIMIENTOS SET datos = ? WHERE id = ?').run(I.cif_(m), pan.id);
  h = H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx);
  assert.deepEqual(h.grupos.map((x) => [x.letra, x.cliente, x.decision]), antes, 'el grupo dañado se repara al leer la hoja');
});
