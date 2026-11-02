'use strict';

/**
 * Finanzas v5.5 · paso 1 de la reunión con gerencia: deudas anteriores (con código especial que se anota en la
 * planilla), N° de factura sugerido para cada abono (SIGSO propone, la persona acepta) y las ventas del mes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparar, cartola } = require('./_finanzasPrueba');
const F = require('../logica/finanzasBancos');
const H = require('../logica/finanzasHoja');
const Dd = require('../logica/finanzasDeudas');
const C = require('../logica/finanzasCobranza');
const Inf = require('../logica/finanzasInformes');
const B = require('../logica/finanzasBoveda');

function base(t) {
  const p = preparar(t);
  const { db, ctx, D } = p;
  F.importarCartola(db, D({ empresa: 'HomePymes', filas: cartola([['04/08/2026', 'TRANSFER DE ELECTRICA PACIF', 0, 88000, '1']]) }), ctx);
  const cuenta = B.dbFin().prepare('SELECT id FROM FIN_CUENTAS').get().id;
  const g = (campos, extra) => { const r = H.guardar(db, D(Object.assign({ cuenta_ref: cuenta, campos }, extra || {})), ctx); assert.ok(!r._validationError, r.message); return r; };
  const hoja = () => H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx);
  return Object.assign(p, { cuenta, g, hoja });
}

test('deudas anteriores · se cargan a mano o desde Excel, con código especial, sin duplicar y validando el RUT', (t) => {
  const { db, ctx, D } = base(t);
  const a = Dd.guardarDeuda(db, D({ cliente: 'Constructora Norte', rut: '77.123.456-1', origen: 'HomePymes 2025', anio: '2025', monto: '$1.200.000', estado_cliente: 'Sigue' }), ctx);
  assert.equal(a.codigo, 'DA001');
  const filas = [['DEUDAS 2025'], ['CLIENTE', 'RUT', 'EMPRESA', 'AÑO', 'MONTO', 'ESTADO', 'NOTA'],
    ['TRANSPORTES RIO CLARO', '', 'HomePymes 2025', '2025', '850.000', 'Se fue', 'dejó de pagar en mayo'],
    ['CONSTRUCTORA NORTE', '77.123.456-1', 'HomePymes 2025', '2025', '1.200.000', 'Sigue', ''],
    ['OBRAS DEL SUR', '11.111.111-2', 'HomePymes 2025', '2024', '300.000', 'Se fue', ''],
    ['SIN MONTO', '', 'HomePymes 2025', '2025', 'abc', '', ''],
    ['', '', '', '', '', '', ''], ['TOTAL', '', '', '', '2.350.000']];
  const rev = Dd.importarDeudas(db, D({ filas, revisar: true }), ctx);
  assert.equal(rev.nuevas.length, 2, 'Río Claro y Obras del Sur');
  assert.equal(rev.repetidas.length, 1, 'Constructora Norte ya estaba');
  assert.equal(rev.errores.length, 1, 'la fila sin monto');
  assert.equal(rev.rut_invalido, 1, 'un RUT con dígito verificador malo no bloquea: se marca');
  assert.equal(B.dbFin().prepare('SELECT COUNT(*) AS n FROM FIN_DEUDAS').get().n, 1, 'revisar no guarda');
  const imp = Dd.importarDeudas(db, D({ filas, archivo: 'deudas-2025.xlsx' }), ctx);
  assert.equal(imp.creadas, 2);
  const l = Dd.deudas(db, D({}), ctx);
  assert.deepEqual(l.deudas.map((x) => [x.codigo, x.cliente, x.estado_cliente, x.saldo]), [['DA001', 'Constructora Norte', 'ACTIVO', 1200000], ['DA002', 'TRANSPORTES RIO CLARO', 'SE_FUE', 850000], ['DA003', 'OBRAS DEL SUR', 'SE_FUE', 300000]]);
  assert.equal(l.deudas[0].cliente_id, 'CL-2', 'con el RUT se reconoce al cliente del maestro');
  assert.deepEqual([l.totales.saldo, l.totales.se_fueron, l.totales.activos, l.totales.clientes], [2350000, 1150000, 1200000, 3]);
  assert.ok(Dd.guardarDeuda(db, D({ cliente: 'X', monto: '0' }), ctx)._validationError);
  assert.ok(Dd.importarDeudas(db, D({ filas: [['A', 'B']] }), ctx)._validationError, 'sin columnas reconocibles');
});

test('deudas anteriores · el abono en la planilla (plan «Cobro deuda anterior» + código) la descuenta; SIGSO sugiere el código', (t) => {
  const { db, ctx, D, g, hoja } = base(t);
  Dd.guardarDeuda(db, D({ cliente: 'TRANSPORTES RIO CLARO', origen: 'HomePymes 2025', monto: 850000, estado_cliente: 'Se fue' }), ctx);
  g({ fecha: '2026-09-08', monto: 500000, nombre: 'TRANSPORTES RIO CLARO', obs: 'ABONO', plan: 'Cobro deuda anterior' });
  const fila = hoja().filas.find((f) => f.monto === 500000);
  assert.deepEqual([fila.sug_fact.fact, fila.sug_fact.certeza], ['DA001', 'alta'], 'propone el código de su deuda');
  assert.equal(Dd.deudas(db, D({}), ctx).sueltos.length, 1, 'mientras no lleve el código, se avisa');
  g({ fact: 'DA001' }, { id: fila.id, expected_version: fila.version });
  const x = Dd.deudas(db, D({}), ctx).deudas[0];
  assert.deepEqual([x.abonado, x.saldo, x.abonos.length], [500000, 350000, 1]);
  assert.match(Dd.borrarDeuda(db, D({ id: x.id }), ctx).message, /ya tiene abonos/);
  const inf = Inf.informe(db, D({ desde: '2026-09', hasta: '2026-09' }), ctx);
  assert.equal(inf.meses.find((m) => m.periodo === '2026-09').deuda_anterior, 500000);
  assert.ok(inf.comentarios.find((c) => c.id === 'deuda_anterior'));
  assert.equal(inf.deudas_anteriores.saldo, 350000);
});

test('factura sugerida · el abono del cliente con el monto de su factura abierta propone ese N°; aceptarla la deja pagada', (t) => {
  const { db, ctx, D, g, hoja } = base(t);
  const VENTAS = ['Nro;Tipo Doc;Tipo Venta;Rut cliente;Razon Social;Folio;Fecha Docto;Fecha Recepcion;Fecha Acuse Recibo;Fecha Reclamo;Monto Exento;Monto Neto;Monto IVA;Monto total',
    '1;33;Del Giro;76543210-3;PANADERIA SOL DE MAYO SPA;9016;01/09/2026;;;;0;1260504;239496;1500000',
    '2;33;Del Giro;77123456-1;CONSTRUCTORA NORTE SPA;9008;01/08/2026;;;;0;420168;79832;500000',
    '3;33;Del Giro;76086428-5;ANDES MONTAJES INDUSTRIALES SPA;9020;05/09/2026;;;;0;252101;47899;300000'].join('\n');
  const imp = C.importarVentas(db, D({ texto: VENTAS, nombre: 'RCV_VENTA_77000000-0_202609.csv', empresa: 'HomePymes' }), ctx);
  assert.ok(!imp._validationError, imp.message);
  g({ fecha: '2026-09-10', monto: 1500000, nombre: 'PANADERIA SOL DE MAYO SPA', obs: 'ABONO' });
  g({ fecha: '2026-09-11', monto: 300000, nombre: 'LOGISTICA SUR', obs: 'ABONO' });
  g({ fecha: '2026-09-12', monto: 777000, nombre: 'PANADERIA SOL DE MAYO SPA', obs: 'ABONO' });
  let h = hoja();
  const pan = h.filas.find((f) => f.monto === 1500000), log = h.filas.find((f) => f.monto === 300000), otro = h.filas.find((f) => f.monto === 777000);
  assert.deepEqual([pan.sug_fact.fact, pan.sug_fact.certeza], ['9016', 'alta']);
  assert.deepEqual([log.sug_fact.fact, log.sug_fact.certeza], ['9020', 'media'], 'paga otro, pero el monto calza con una sola factura: se propone para confirmar');
  assert.equal(otro.sug_fact, undefined, 'sin factura que calce, no se inventa');
  g({ fact: pan.sug_fact.fact }, { id: pan.id, expected_version: pan.version });
  h = hoja();
  assert.equal(h.filas.find((f) => f.monto === 1500000).sug_fact, undefined, 'ya tiene su N°');
  const fac = H.cobranza(db, D({ estado: 'todas' }), ctx).facturas.find((f) => f.folio === '9016');
  assert.equal(fac.estado, 'Pagada');
  // Ventas del mes en Informes: lo emitido en septiembre y cuánto ya se pagó.
  const inf = Inf.informe(db, D({ desde: '2026-09', hasta: '2026-09' }), ctx);
  assert.deepEqual([inf.ventas['2026-09'].facturado, inf.ventas['2026-09'].n, inf.ventas['2026-09'].pagado], [1800000, 2, 1500000]);
  assert.equal(inf.ventas['2026-08'].facturado, 500000, 'el mes anterior, para comparar');
});
