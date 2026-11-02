'use strict';

/**
 * Finanzas v5.8 · puntos 3, 4 y 7 de la reunión: el control SEMANAL de la cuenta de paso, todos los clientes en una
 * sola lista (activos, sin movimiento, los que se fueron y cuánto debe cada uno) y los proyectos financiados por
 * clientes (meta mensual, aporte de cada cliente según su porcentaje y cumplimiento).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparar, cartola } = require('./_finanzasPrueba');
const F = require('../logica/finanzasBancos');
const H = require('../logica/finanzasHoja');
const CP = require('../logica/finanzasCuentaPaso');
const Pa = require('../logica/finanzasPanorama');
const PF = require('../logica/finanzasProyectosFin');
const Dd = require('../logica/finanzasDeudas');
const Cl = require('../logica/finanzasClientes');
const C = require('../logica/finanzasCobranza');
const B = require('../logica/finanzasBoveda');

function base(t, movs) {
  const p = preparar(t);
  const { db, ctx, D } = p;
  F.importarCartola(db, D({ empresa: 'HomePymes', filas: cartola(movs, { periodo: '01-09-2026 al 30-09-2026', anterior: 0 }) }), ctx);
  const cuenta = B.dbFin().prepare('SELECT id FROM FIN_CUENTAS').get().id;
  const g = (campos) => { const r = H.guardar(db, D({ cuenta_ref: cuenta, campos }), ctx); assert.ok(!r._validationError, r.message); return r; };
  return Object.assign(p, { cuenta, g });
}

test('cuenta de paso · corte semanal: cada domingo y el fin de mes, con el saldo de ese día y qué falta', (t) => {
  const { db, ctx, D, cuenta, g } = base(t, [['02/09/2026', 'TRANSFER DE ANDES MONTAJE', 0, 900000, '1'], ['08/09/2026', 'TRASPASO A OTRO BANCO', 900000, 0, '2'], ['15/09/2026', 'TRANSFER DE ANDES MONTAJE', 0, 400000, '3']]);
  g({ fecha: '2026-09-02', monto: 900000, nombre: 'ANDES MONTAJES', obs: 'ABONO' });
  g({ fecha: '2026-09-08', monto: -900000, nombre: 'BANCO EMPRESA', obs: 'ABONO', plan: 'Traspaso a cuenta empresa' });
  g({ fecha: '2026-09-15', monto: 400000, nombre: 'ANDES MONTAJES', obs: 'ABONO' });
  CP.guardar(db, D({ cuenta_ref: cuenta, desde: '2026-09' }), ctx);
  const s = H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx).cuenta_paso.semanas;
  assert.deepEqual(s.map((x) => x.hasta), ['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27', '2026-09-30']);
  assert.deepEqual([s[0].saldo, s[0].por_traspasar, s[0].en_cero], [900000, 900000, false], 'semana 1: entró y no se traspasó');
  assert.deepEqual([s[1].saldo, s[1].por_traspasar, s[1].en_cero], [0, 0, true], 'semana 2: se traspasó todo, en $0');
  assert.deepEqual([s[2].saldo, s[2].por_traspasar], [400000, 400000]);
  assert.deepEqual([s[4].saldo, s[4].por_traspasar, s[4].clientes], [400000, 400000, 0], 'el último corte es el cierre del mes');
});

test('clientes · una sola lista con estado, empresa, lo que debe (facturas + deudas anteriores) y su último pago', (t) => {
  const { db, ctx, D, g } = base(t, [['05/09/2026', 'TRANSFER DE ANDES MONTAJE', 0, 357000, '1']]);
  g({ fecha: '2026-09-05', monto: 357000, nombre: 'ANDES MONTAJES INDUSTRIALES SPA', obs: 'ABONO' });
  C.importarVentas(db, D({ texto: ['Nro;Tipo Doc;Tipo Venta;Rut cliente;Razon Social;Folio;Fecha Docto;Fecha Recepcion;Fecha Acuse Recibo;Fecha Reclamo;Monto Exento;Monto Neto;Monto IVA;Monto total',
    '1;33;Del Giro;76543210-3;PANADERIA SOL DE MAYO SPA;9016;01/07/2026;;;;0;1260504;239496;1500000'].join('\n'), nombre: 'RCV_VENTA_77000000-0_202607.csv', empresa: 'HomePymes' }), ctx);
  Dd.guardarDeuda(db, D({ cliente: 'CONSTRUCTORA NORTE SPA', monto: 2000000, origen: 'HomePymes 2025', estado_cliente: 'Se fue' }), ctx);
  Dd.guardarDeuda(db, D({ cliente: 'TRANSPORTES RIO CLARO', monto: 850000, origen: 'HomePymes 2025', estado_cliente: 'Se fue' }), ctx);
  const r = Pa.panorama(db, D({}), ctx);
  assert.ok(!r._validationError, r.message);
  const por = (n) => r.clientes.find((x) => x.cliente === n);
  assert.deepEqual([por('ANDES MONTAJES INDUSTRIALES SPA').estado, por('ANDES MONTAJES INDUSTRIALES SPA').ultimo_pago, por('ANDES MONTAJES INDUSTRIALES SPA').debe], ['ACTIVO', '2026-09-05', 0]);
  assert.deepEqual([por('CONSTRUCTORA NORTE SPA').estado, por('CONSTRUCTORA NORTE SPA').deuda_anterior, por('CONSTRUCTORA NORTE SPA').empresa], ['SE_FUE', 2000000, 'HomePymes 2025'], 'reconocido en el maestro por el nombre');
  assert.equal(por('PANADERIA SOL DE MAYO SPA').por_cobrar, 1500000);
  assert.equal(por('PANADERIA SOL DE MAYO SPA').vencido, 1500000, 'emitida en julio: vencida');
  assert.equal(por('TRANSPORTES RIO CLARO').sin_ficha, true, 'el que debe y no está en el maestro igual aparece');
  assert.equal(r.clientes[0].cliente, 'CONSTRUCTORA NORTE SPA', 'ordenado por lo que debe');
  assert.deepEqual([r.totales.total_debe, r.totales.debe_se_fueron, r.totales.deben], [4350000, 2850000, 3]);
});

test('proyectos · meta mensual, aporte de cada cliente según su porcentaje y quién no aportó', (t) => {
  const { db, ctx, D, g } = base(t, [['05/09/2026', 'TRANSFER DE ANDES MONTAJE', 0, 1000000, '1']]);
  g({ fecha: '2026-09-05', monto: 1000000, nombre: 'ANDES MONTAJES INDUSTRIALES SPA', obs: 'ABONO' });
  const proy = (H.contexto_(db), F.proyectosSigso_(db))[0];
  assert.ok(proy, 'hay un proyecto de SIGSO de prueba');
  assert.ok(!PF.guardarMeta(db, D({ proyecto_id: proy.id, meta_mensual: '$300.000', meta_total: '1.800.000' }), ctx)._validationError);
  assert.ok(PF.guardarMeta(db, D({ proyecto_id: 'no-existe', meta_mensual: 1 }), ctx)._validationError);
  Cl.guardarAsignacion(db, D({ cliente_id: 'CL-1', proyecto_id: proy.id, porcentaje: '20', desde: '2026-01-01' }), ctx);
  Cl.guardarAsignacion(db, D({ cliente_id: 'CL-2', proyecto_id: proy.id, porcentaje: '10', desde: '2026-01-01' }), ctx);
  const r = PF.financiamiento(db, D({ hasta: '2026-09', meses: 3 }), ctx);
  const p = r.proyectos.find((x) => x.id === proy.id);
  assert.deepEqual([p.meta_mensual, p.aporte_mes, p.cumplimiento_mes, p.avance_total], [300000, 200000, 67, 11]);
  assert.equal(p.clientes.find((c) => c.cliente_id === 'CL-1').aporte_mes, 200000, '20 % de $1.000.000');
  assert.deepEqual(p.sin_aportar, ['CONSTRUCTORA NORTE SPA'], 'quien está asignado y no pagó en el mes');
});
