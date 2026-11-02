'use strict';

/**
 * Finanzas v5.7 · paso 3 de la reunión: el BCI como cuenta de paso (al cierre debe quedar en $0 y, si no, se dice
 * qué falta) y el FLUJO de una cuenta con lo proyectado (presupuesto) frente a lo real.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparar, cartola } = require('./_finanzasPrueba');
const F = require('../logica/finanzasBancos');
const H = require('../logica/finanzasHoja');
const CP = require('../logica/finanzasCuentaPaso');
const Pr = require('../logica/finanzasPresupuesto');
const Rv = require('../logica/finanzasRevision');
const B = require('../logica/finanzasBoveda');

const MOVS = [['02/09/2026', 'TRANSFER DE ANDES MONTAJE', 0, 900000, '1'], ['03/09/2026', 'TRANSFER DE CONSTRUCTORA', 0, 500000, '2'],
  ['04/09/2026', 'COMISION', 100000, 0, '3'], ['07/09/2026', 'PAGO CUENTAS VIA INTERNET', 450000, 0, '4'], ['10/09/2026', 'TRASPASO A OTRO BANCO', 600000, 0, '5']];

function base(t) {
  const p = preparar(t);
  const { db, ctx, D } = p;
  F.importarCartola(db, D({ empresa: 'HomePymes', filas: cartola(MOVS, { periodo: '01-09-2026 al 30-09-2026', anterior: 0 }) }), ctx);
  const cuenta = B.dbFin().prepare('SELECT id FROM FIN_CUENTAS').get().id;
  const g = (campos) => { const r = H.guardar(db, D({ cuenta_ref: cuenta, campos }), ctx); assert.ok(!r._validationError, r.message); return r; };
  const hoja = () => H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx);
  return Object.assign(p, { cuenta, g, hoja });
}
function anotar(g) {
  g({ fecha: '2026-09-02', monto: 900000, nombre: 'ANDES MONTAJES', obs: 'ABONO', plan: 'Servicio Mensual' });
  g({ fecha: '2026-09-03', monto: 500000, nombre: 'CONSTRUCTORA NORTE', obs: 'IMPOSICIONES', grupo: 'A' });
  g({ fecha: '2026-09-04', monto: -100000, nombre: 'COMISION', obs: 'ABONO', plan: 'Comisión Banco' });
  g({ fecha: '2026-09-07', monto: -450000, nombre: 'CONSTRUCTORA NORTE', obs: 'IMPOSICIONES', grupo: 'A' });
  g({ fecha: '2026-09-10', monto: -600000, nombre: 'HOMEPYMES BANCO NUEVO', obs: 'ABONO', plan: 'Traspaso a cuenta empresa' });
}

test('cuenta de paso · el traspaso no es gasto; el saldo se explica: honorarios por traspasar + dinero de clientes', (t) => {
  const { db, ctx, D, cuenta, g, hoja } = base(t);
  anotar(g);
  H.decidirGrupo(db, D({ cuenta_ref: cuenta, periodo: '2026-09', letra: 'A', decision: 'SALDO' }), ctx);
  let h = hoja();
  assert.equal(h.cuenta_paso, null, 'sin configurar no hay control');
  const tr = h.filas.find((f) => f.monto === -600000);
  assert.deepEqual([tr.que.k, tr.que.t], ['tra', 'Traspaso'], 'el traspaso a la cuenta de la empresa no es gasto');
  assert.equal(h.totales.ABONO, 800000, 'ABONO = honorarios − gastos (sin el traspaso)');
  assert.ok(CP.guardar(db, D({ cuenta_ref: cuenta, desde: 'sept' }), ctx)._validationError);
  assert.ok(!CP.guardar(db, D({ cuenta_ref: cuenta, desde: '2026-09' }), ctx)._validationError);
  h = hoja();
  const c = h.cuenta_paso;
  assert.deepEqual([c.saldo_final, c.por_traspasar, c.clientes, c.diferencia, c.en_cero], [250000, 200000, 50000, 0, false]);
  assert.deepEqual(c.pendientes.map((x) => x.id), ['traspasar', 'clientes']);
  assert.match(c.pendientes[0].como, /Traspasa \$200\.000/);
  assert.ok(Rv.revision(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx).avisos.find((a) => a.id === 'cuenta_paso'), 'la revisión del mes lo avisa');
  // Se traspasa lo que faltaba y se paga lo del cliente: la cuenta queda en $0.
  F.importarCartola(db, D({ filas: cartola(MOVS.concat([['28/09/2026', 'TRASPASO A OTRO BANCO', 200000, 0, '6'], ['29/09/2026', 'PAGO CUENTAS VIA INTERNET', 50000, 0, '7']]), { periodo: '01-09-2026 al 30-09-2026', anterior: 0 }) }), ctx);
  g({ fecha: '2026-09-28', monto: -200000, nombre: 'HOMEPYMES BANCO NUEVO', obs: 'ABONO', plan: 'Traspaso a cuenta empresa' });
  g({ fecha: '2026-09-29', monto: -50000, nombre: 'CONSTRUCTORA NORTE', obs: 'IMPOSICIONES', grupo: 'A' });
  const c2 = hoja().cuenta_paso;
  assert.deepEqual([c2.saldo_final, c2.por_traspasar, c2.clientes, c2.en_cero, c2.pendientes.length], [0, 0, 0, true, 0]);
});

test('flujo · por cuenta, préstamos aparte y lo proyectado (presupuesto) frente a lo real', (t) => {
  const { db, ctx, D, cuenta, g } = base(t);
  anotar(g);
  g({ fecha: '2026-09-15', monto: 300000, nombre: 'SOCIO', obs: 'ABONO', plan: 'Préstamo recibido' });
  const m12 = (v) => new Array(12).fill(v);
  assert.ok(!Pr.guardar(db, D({ anio: 2026, empresa: 'HomePymes', lineas: [{ tipo: 'INGRESO', cuenta: 'Servicio Mensual', meses: m12(1000000) }, { tipo: 'EGRESO', cuenta: 'Comisión Banco', meses: m12(80000) }] }), ctx)._validationError);
  const f = H.flujo(db, D({ hasta: '2026-09', meses: 3, cuenta_ref: cuenta }), ctx);
  assert.equal(f.cuenta_ref, cuenta);
  assert.equal(f.ingresos.find((x) => x.plan === 'Servicio Mensual').valores['2026-09'], 900000);
  assert.equal(f.egresos.find((x) => x.plan === 'Comisión Banco').valores['2026-09'], 100000);
  assert.equal(f.egresos.find((x) => x.plan === 'Traspaso a cuenta empresa').valores['2026-09'], undefined, 'el traspaso no es egreso');
  assert.equal(f.otros.traspasos['2026-09'], -600000);
  assert.equal(f.otros.prestamos_entran['2026-09'], 300000, 'el préstamo entra aparte: no es ingreso');
  assert.equal(f.proyectado.estado, 'BORRADOR', 'sin aprobar se dice que es borrador');
  assert.deepEqual([f.proyectado.ingresos['Servicio Mensual']['2026-09'], f.proyectado.egresos['Comisión Banco']['2026-07']], [1000000, 80000]);
});
