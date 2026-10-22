'use strict';

/**
 * Finanzas v6 · cartolas del BCI tal como llegan (septiembre): la «Cartola histórica» trae los cargos en negativo, el
 * saldo diario acumulado desde cero y el resumen en blanco; dos cartolas que se traslapan no duplican movimientos; y
 * lo anotado el jueves que el banco contabiliza el lunes se une igual (días hábiles, no corridos).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparar, cartola } = require('./_finanzasPrueba');
const F = require('../logica/finanzasBancos');
const H = require('../logica/finanzasHoja');
const Base = require('../logica/finanzasBase');
const B = require('../logica/finanzasBoveda');

// «Cartola histórica»: cargos negativos, saldo diario desde 0, resumen vacío y «Saldo Disponible» al cierre.
function historica(movs, opciones) {
  opciones = opciones || {};
  const filas = [];
  filas[1] = [' Cartola de cuenta corriente'];
  filas[2] = ['Empresa', null, null, null, 'EMPRESA DEMO SPA'];
  filas[3] = ['N° de cuenta', null, null, null, '11112222', null, null, null, 'Periodo', null, opciones.periodo || '16-09-2026 al 30-09-2026'];
  filas[5] = ['Saldo Disponible'];
  filas[6] = [opciones.disponible == null ? null : String(opciones.disponible)];
  filas[8] = ['Periodo', null, null, null, 'Saldo Anterior', null, 'Total Cargos y Cheques', null, 'Total Abonos y Depósitos', null, 'Saldo Contable Final del Periodo'];
  filas[9] = [opciones.periodo || '16-09-2026 al 30-09-2026'];
  filas[17] = ['Fecha', null, 'Sucursal', null, null, 'Descripción', null, 'N° Documento', null, 'Cheques y otros cargos', 'Depósitos y Abono', 'Saldo diario'];
  let saldo = 0;
  movs.forEach((m, i) => {
    saldo = saldo - m[2] + m[3];
    filas[18 + i] = [m[0], null, 'OF', null, null, m[1], null, m[4] || String(i + 1), null, m[2] ? String(-m[2]) : null, m[3] ? String(m[3]) : null, String(saldo)];
  });
  return filas;
}

test('cartola histórica · cargos negativos son salidas y el saldo relativo se ancla con el saldo disponible', () => {
  const c = F.leerCartola(historica([['16/09/2026', 'TRANSFER DE ANDES MONTAJE', 0, 500000], ['17/09/2026', 'PAGO PREVIRED', 200000, 0], ['18/09/2026', 'TRANSFERENCIA A ARRIENDO', 100000, 0]], { disponible: 1200000 }));
  assert.ok(!c.error, c.error);
  assert.ok(c.cuadra, c.errores.join(' '));
  assert.deepEqual(c.movimientos.map((m) => [m.cargo, m.abono]), [[0, 500000], [200000, 0], [100000, 0]], 'el cargo es positivo y sale');
  assert.equal(c.saldo_relativo, true);
  assert.equal(c.saldo_inferido, true);
  assert.equal(c.saldo_anterior, 1200000 - 200000, 'disponible al cierre menos lo neto del período');
  assert.equal(c.saldo_final, 1200000);
  assert.deepEqual(c.movimientos.map((m) => m.saldo), [1500000, 1300000, 1200000]);
  assert.ok(c.avisos.some((a) => /resumen viene en blanco/.test(a)));
});

test('cartola histórica · sin saldo disponible se ve desde cero, pero igual cuadra y avisa', () => {
  const c = F.leerCartola(historica([['16/09/2026', 'TRANSFER DE ANDES MONTAJE', 0, 500000]]));
  assert.ok(c.cuadra);
  assert.equal(c.saldo_anterior, null);
  assert.ok(c.avisos.some((a) => /no trae el saldo anterior/.test(a)));
});

test('cartola · un resumen que no calza con la lista es aviso si la cadena de saldos está entera; si se rompe, error', () => {
  const filas = cartola([['02/09/2026', 'TRANSFER DE ANDES MONTAJE', 0, 357000, '11']], { periodo: '01-09-2026 al 30-09-2026' });
  filas[9][8] = '999.999'; // el banco informa otro total de abonos
  const c = F.leerCartola(filas);
  assert.ok(c.cuadra, 'la lista cuadra consigo misma');
  assert.ok(c.avisos.some((a) => /no suman lo que dice el resumen/.test(a)));
  filas[18][11] = '1'; // saldo diario que no sigue del anterior
  const roto = F.leerCartola(filas);
  assert.equal(roto.cuadra, false);
  assert.ok(roto.errores.some((e) => /no sigue del anterior/.test(e)));
});

test('cartolas que se traslapan (el 16-09 viene en las dos) no duplican movimientos, aunque el saldo diario cambie', (t) => {
  const { db, ctx, D } = preparar(t);
  const a = F.importarCartola(db, D({ empresa: 'HomePymes', filas: cartola([['15/09/2026', 'TRANSFER DE ANDES MONTAJE', 0, 357000, '11'], ['16/09/2026', 'PAGO PREVIRED', 50000, 0, '12']], { periodo: '01-09-2026 al 16-09-2026' }) }), ctx);
  assert.ok(!a._validationError, a.message);
  const filas2 = historica([['16/09/2026', 'PAGO PREVIRED', 50000, 0, '12'], ['17/09/2026', 'TRANSFER DE OSSES', 0, 80000, '13']], { disponible: 1387000 });
  const rev = F.revisarCartola(db, D({ filas: filas2 }), ctx);
  assert.deepEqual([rev.nuevas, rev.repetidas], [1, 1]);
  F.importarCartola(db, D({ filas: filas2 }), ctx);
  F.importarCartola(db, D({ filas: filas2 }), ctx); // subirla dos veces tampoco duplica
  const n = B.dbFin().prepare("SELECT COUNT(*) AS n FROM FIN_MOVIMIENTOS WHERE periodo = '2026-09'").get().n;
  assert.equal(n, 3);
});

test('días hábiles · lo anotado el jueves que el banco pasa el lunes se une con la cartola', (t) => {
  assert.equal(Base.diasHabiles_('2026-09-17', '2026-09-21'), 2, 'jueves → lunes');
  assert.equal(Base.diasHabiles_('2026-09-21', '2026-09-17'), 2);
  assert.equal(Base.diasHabiles_('2026-09-14', '2026-09-18'), 4, 'lunes → viernes');
  const { db, ctx, D } = preparar(t);
  F.importarCartola(db, D({ empresa: 'HomePymes', filas: cartola([['01/09/2026', 'TRANSFER DE ANDES MONTAJE', 0, 1000, '1']], { periodo: '01-09-2026 al 01-09-2026' }) }), ctx);
  const cuenta = B.dbFin().prepare('SELECT id FROM FIN_CUENTAS').get().id;
  const r = H.guardar(db, D({ cuenta_ref: cuenta, campos: { fecha: '2026-09-17', monto: 245000, nombre: 'OSSES', obs: 'ABONO' } }), ctx);
  assert.ok(!r._validationError, r.message);
  F.importarCartola(db, D({ filas: cartola([['21/09/2026', 'TRANSFER DE JUAN OSSES', 0, 245000, '7']], { periodo: '02-09-2026 al 30-09-2026', anterior: 1001000 }) }), ctx);
  const hoja = H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx);
  const filas = hoja.filas.filter((f) => f.monto === 245000);
  assert.equal(filas.length, 1, 'una sola fila: la anotada quedó unida al movimiento del banco');
  assert.equal(filas[0].banco, 'ok', 'ya no espera la cartola');
  assert.equal(filas[0].fecha_banco, '2026-09-21', 'conserva la fecha anotada y muestra la del banco');
});
