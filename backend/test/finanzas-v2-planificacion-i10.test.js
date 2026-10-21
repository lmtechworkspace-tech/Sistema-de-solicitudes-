'use strict';

/**
 * Finanzas · corrección v2, I10 (2026-10-20): planificación y funciones
 * heredadas. Presupuesto heredado sin aprobación inventada y acumulado por
 * cobertura; préstamos por evidencia (planificado, desembolsado, devuelto,
 * reconocido) con devoluciones validadas; 0 % no es 100 %; la foto del cierre
 * sale del contrato del informe; gastos compartidos pendientes a la vista.
 * Datos inventados.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparar, cartola } = require('./_finanzasPrueba');
const F = require('../logica/finanzasBancos');
const Op = require('../logica/finanzasOperaciones');
const Pl = require('../logica/finanzasPlanificacion');
const P = require('../logica/finanzasPresupuesto');
const T = require('../logica/finanzasTablero');
const H = require('../logica/finanzasHechos');
const R = require('../logica/finanzasReportes');
const Ci = require('../logica/finanzasCierre');
const Pe = require('../logica/finanzasPendientes');
const B = require('../logica/finanzasBoveda');

const x = { nombre: 'Persona Uno', registrar: () => {} };
const lineas = [{ tipo: 'INGRESO', cuenta: 'Servicio Mensual', meses: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100] }];

test('I10.1 · presupuesto heredado: se compara por compatibilidad, sin aprobador ni fecha inventados, y queda en la historia como HEREDADO', (t) => {
  const { db, ctx, D } = preparar(t);
  P.guardar_(db, { anio: 2026, empresa: 'HomePymes', lineas }, x);
  // Simula un presupuesto de la Etapa 5: sin historia de versiones.
  B.dbFin().prepare('DELETE FROM FIN_PRESUPUESTO_VERSIONES').run();
  const h = P.aprobada_(2026, 'HomePymes');
  assert.equal(h.heredado, true);
  assert.equal(h.por, null, 'nadie lo aprobó');
  assert.equal(h.en, null);
  assert.equal(h.cargado_por, 'Persona Uno');
  assert.match(h.procedencia, /no hay aprobación registrada/);
  // Una nueva versión deja la anterior como HEREDADA (no como APROBADA) y la comparación sigue con la heredada.
  P.guardar_(db, { anio: 2026, empresa: 'HomePymes', lineas, expected_version: 1 }, x);
  const hist = B.dbFin().prepare('SELECT version, estado, por FROM FIN_PRESUPUESTO_VERSIONES ORDER BY version').all();
  assert.deepEqual(hist.map((r) => [r.version, r.estado, r.por]), [[1, 'HEREDADO', ''], [2, 'BORRADOR', 'Persona Uno']]);
  assert.equal(P.aprobada_(2026, 'HomePymes').heredado, true);
  const v = P.ver(db, D({ anio: 2026, empresa: 'HomePymes' }), ctx);
  assert.equal(v.versiones[0].heredado, true);
});

test('I10.1 · el acumulado del año compara solo los meses con cartolas', (t) => {
  const { db, ctx, D } = preparar(t);
  F.importarCartola(db, D({ filas: cartola([['05/08/2026', 'TRANSFER DE CLIENTE', 0, 1000, '1']]), empresa: 'HomePymes' }), ctx);
  const v = P.ver(db, D({ anio: 2026, empresa: 'HomePymes' }), ctx);
  assert.deepEqual(v.meses_con_datos, [7]);
});

test('I10.2 · préstamo sin desembolso: planificado, no deuda reconocida ni «ficticio»; con evidencia se reconoce; una devolución no supera lo desembolsado', (t) => {
  const { db, ctx, D } = preparar(t);
  const p = Pl.guardarPrestamo(db, D({ origen: 'HomePymes', destino: 'GDE', monto: '1.000.000', fecha: '2026-08-03' }), ctx);
  let sp = Pl.prestamos(db, D({}), ctx);
  assert.deepEqual([sp.prestamos[0].estado_real, sp.prestamos[0].saldo_reconocido, sp.total_reconocido, sp.total_sin_desembolso], ['SIN_DESEMBOLSO', null, 0, 1000000]);
  assert.deepEqual(T.deudasEntreEmpresas_(H.todos_()), [], 'sin desembolso no hay deuda reconocida');
  assert.equal(R.reporte_(db, { periodo: '2026-08' }).breakdowns.prestamos_sin_desembolso.length, 1, 'el informe lo dice aparte');
  // Las dos piernas del banco: una sola deuda.
  F.importarCartola(db, D({ filas: cartola([['03/08/2026', 'TRANSFERENCIA A GDE', 1000000, 0, '1']], { numero: '1111' }), empresa: 'HomePymes' }), ctx);
  F.importarCartola(db, D({ filas: cartola([['03/08/2026', 'TRANSFER DE HOMEPYMES', 0, 1000000, '2']], { numero: '2222' }), empresa: 'GDE' }), ctx);
  const ms = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos;
  F.clasificar(db, D({ items: ms.map((m) => ({ id: m.id, tipo: 'PRESTAMO', empresa: m.cuenta.empresa === 'HomePymes' ? 'GDE' : 'HomePymes' })) }), ctx);
  H.todos_().filter((h) => h.clasif && h.clasif.tipo === 'PRESTAMO').forEach((h) => Pl.vincularPrestamo(db, D({ prestamo_id: p.id, ref: h.ref, rol: 'DESEMBOLSO' }), ctx));
  sp = Pl.prestamos(db, D({}), ctx).prestamos[0];
  assert.deepEqual([sp.estado_real, sp.desembolsado, sp.saldo_reconocido, sp.evidencias.length], ['DESEMBOLSADO', 1000000, 1000000, 2]);
  assert.deepEqual(T.deudasEntreEmpresas_(H.todos_()), [{ debe: 'GDE', a: 'HomePymes', monto: 1000000 }]);
  // Una devolución mayor a lo que queda se rechaza; una válida, devuelve en parte.
  Op.guardar(db, D({ empresa: 'GDE', medio: 'EFECTIVO', confirmar: true, fecha: '2026-08-20', sentido: 'SALIDA', monto: 1500000, tipo: 'PRESTAMO', empresa_contraparte: 'HomePymes' }), ctx);
  const grande = H.todos_().find((h) => h.fuente === 'REGISTRO' && h.cargo === 1500000);
  assert.ok(Pl.vincularPrestamo(db, D({ prestamo_id: p.id, ref: grande.ref, rol: 'DEVOLUCION' }), ctx)._validationError);
  Op.guardar(db, D({ empresa: 'GDE', medio: 'EFECTIVO', confirmar: true, fecha: '2026-08-21', sentido: 'SALIDA', monto: 300000, tipo: 'PRESTAMO', empresa_contraparte: 'HomePymes' }), ctx);
  const chica = H.todos_().find((h) => h.fuente === 'REGISTRO' && h.cargo === 300000);
  assert.ok(!Pl.vincularPrestamo(db, D({ prestamo_id: p.id, ref: chica.ref, rol: 'DEVOLUCION' }), ctx)._validationError);
  sp = Pl.prestamos(db, D({}), ctx).prestamos[0];
  assert.deepEqual([sp.estado_real, sp.devuelto, sp.saldo_reconocido], ['DEVUELTO_EN_PARTE', 300000, 700000]);
});

test('I10.3 · 0 % de cobranza es 0 % aunque llegue como texto', (t) => {
  const { db, ctx, D } = preparar(t);
  assert.equal(Pl.proyeccion(db, D({ pct_cobranza: '0' }), ctx).pct_cobranza, 0);
  assert.equal(Pl.proyeccion(db, D({ pct_cobranza: 0 }), ctx).pct_cobranza, 0);
  assert.equal(Pl.proyeccion(db, D({}), ctx).pct_cobranza, 100);
});

test('I10.4 · la foto del cierre sale del contrato del informe (no de otro cálculo)', (t) => {
  const { db, ctx, D } = preparar(t);
  Op.guardar(db, D({ empresa: 'HomePymes', medio: 'EFECTIVO', confirmar: true, fecha: '2026-08-05', sentido: 'ENTRADA', monto: 500000, tipo: 'INGRESO', cuenta: 'Servicio Mensual' }), ctx);
  Op.guardar(db, D({ empresa: 'HomePymes', medio: 'EFECTIVO', confirmar: true, fecha: '2026-08-06', sentido: 'SALIDA', monto: 120000, tipo: 'EGRESO', cuenta: 'Sueldos' }), ctx);
  const c = R.reporte_(db, { periodo: '2026-08' });
  const f = Ci.foto_(db, '2026-08');
  assert.deepEqual([f.ingresos, f.egresos, f.resultado, f.caja, f.revision], [c.metrics.ingresos, c.metrics.egresos, c.metrics.flujo_propio, c.metrics.caja, c.data_revision]);
  assert.equal(f.resultado, 380000);
});

test('I10.2 · gastos compartidos sin vincular o con PAZ por decidir aparecen en Pendientes', (t) => {
  const { db, ctx, D } = preparar(t);
  const g = Pl.guardarGastoCompartido(db, D({ periodo: '2026-08', pagadora: 'HomePymes', monto: '90.000', concepto: 'Internet oficina', reparto: { modo: 'IGUALES', partes: [{ empresa: 'HomePymes' }, { empresa: 'GDE' }] }, paz: { pendiente: true } }), ctx);
  assert.ok(g.id, g.message);
  const it = Pe.pendientes(db, D({ tipo: 'GASTO_COMPARTIDO' }), ctx).items;
  assert.equal(it.length, 1);
  assert.match(it[0].motivo, /falta vincularlo a su pago.*PAZ/);
  assert.equal(it[0].accion.vista, 'gastos');
});
