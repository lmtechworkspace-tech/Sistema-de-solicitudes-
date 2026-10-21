'use strict';

/**
 * Finanzas · corrección v2, I09 (2026-10-20): informes y lectura automática
 * verificable. Fichas de métricas, cascada que cuadra, cuentas con apertura y
 * cierre, informe comercial con «sin dato» a la vista, comentarios sin
 * repetir la misma falta de datos y con acciones que tienen contenido,
 * revisión estable (no cambia con sesiones ni bitácora) y exportación acotada
 * al contexto. Datos inventados.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparar, cartola } = require('./_finanzasPrueba');
const F = require('../logica/finanzasBancos');
const Op = require('../logica/finanzasOperaciones');
const R = require('../logica/finanzasReportes');
const X = require('../logica/finanzasExportar');
const Cl = require('../logica/finanzasClientes');
const Base = require('../logica/finanzasBase');

const op = (db, D, ctx, o) => Op.guardar(db, D(Object.assign({ empresa: 'HomePymes', medio: 'EFECTIVO', confirmar: true }, o)), ctx);

test('I09.1 · cada métrica trae su ficha: fuentes, exclusiones, fecha, moneda y calidad requerida', (t) => {
  const { db, ctx, D } = preparar(t);
  op(db, D, ctx, { fecha: '2026-08-10', sentido: 'ENTRADA', monto: 1000, tipo: 'INGRESO', cuenta: 'Servicio Mensual' });
  const c = R.reporte(db, D({ periodo: '2026-08' }), ctx);
  ['ingresos', 'egresos', 'flujo_propio', 'caja', 'custodia', 'caja_libre', 'ventas_netas'].forEach((k) => {
    const d = c.definiciones[k];
    assert.ok(d.fuentes && d.excluye && d.fecha && d.moneda === 'CLP' && d.calidad, 'ficha completa de ' + k);
  });
  assert.match(c.definiciones.caja_libre.calidad, /No se determina con: .*APERTURA/);
  assert.match(c.definiciones.ventas_netas.excluye, /no se calcula utilidad/);
  assert.equal(c.contract_version, 2);
  assert.ok(c.reglas.find((r) => r.rule_id === 'FLUJO_PROPIO'));
});

test('I09.2 · cascada que cuadra con el flujo, cuentas con apertura/entradas/salidas/cierre y empresas que suman el grupo', (t) => {
  const { db, ctx, D } = preparar(t);
  op(db, D, ctx, { fecha: '2026-08-05', sentido: 'ENTRADA', monto: 500000, tipo: 'INGRESO', cuenta: 'Servicio Mensual' });
  op(db, D, ctx, { fecha: '2026-08-06', sentido: 'SALIDA', monto: 120000, tipo: 'EGRESO', cuenta: 'Arriendo Mensual' });
  op(db, D, ctx, { fecha: '2026-08-07', sentido: 'SALIDA', monto: 30000, tipo: 'EGRESO', cuenta: 'Cuentas Básicas' });
  F.importarCartola(db, D({ filas: cartola([['10/08/2026', 'TRANSFER DE CLIENTE', 0, 200000, '1'], ['12/08/2026', 'PAGO PROVEEDOR', 50000, 0, '2']]), empresa: 'HomePymes' }), ctx);
  const c = R.reporte(db, D({ periodo: '2026-08' }), ctx);
  const k = c.breakdowns.cascada;
  assert.equal(k.total, c.metrics.flujo_propio);
  assert.equal(k.cuadra, true);
  assert.deepEqual(k.pasos.map((x) => [x.concepto, x.signo * x.monto]), [['Servicio Mensual', 500000], ['Arriendo Mensual', -120000], ['Cuentas Básicas', -30000]]);
  // Lo que no es flujo propio (los movimientos sin clasificar) se declara aparte, no se mezcla.
  assert.ok(k.fuera.find((x) => x.nombre === 'Sin clasificar' && x.monto === 250000));
  const cta = c.breakdowns.cuentas_periodo[0];
  assert.deepEqual([cta.entradas, cta.salidas], [200000, 50000]);
  // Sin cartola del mes anterior la apertura no se inventa.
  assert.equal(cta.apertura, null);
  assert.equal(cta.diferencia, null);
  assert.match(cta.nota, /apertura no se conoce/);
  assert.deepEqual(c.breakdowns.cuadre_empresas, { suma_empresas: c.metrics.flujo_propio, grupo: c.metrics.flujo_propio, diferencia: 0 });
});

test('I09.2 · servicios/canales/vendedores: lo que no tiene dato queda a la vista, con su cobertura', (t) => {
  const { db, ctx, D } = preparar(t);
  const g = Cl.guardarFicha(db, D({ cliente_id: 'CL-1', canal: 'Referido', vendedor: 'Ana' }), ctx);
  assert.ok(!g._validationError, g.message);
  op(db, D, ctx, { fecha: '2026-08-05', sentido: 'ENTRADA', monto: 300000, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' });
  op(db, D, ctx, { fecha: '2026-08-06', sentido: 'ENTRADA', monto: 100000, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-2' });
  const k = R.reporte(db, D({ periodo: '2026-08' }), ctx).breakdowns.comercial;
  assert.deepEqual(k.por_canal.map((x) => [x.valor, x.monto, x.desconocido]), [['Referido', 300000, false], ['(sin dato en la ficha)', 100000, true]]);
  assert.deepEqual([k.cobertura.clientes, k.cobertura.con_canal, k.cobertura.con_vendedor], [2, 1, 1]);
  assert.match(k.metrica, /No es venta facturada/);
});

test('I09.4 · comentarios: la falta de datos se dice una vez y primero, con importes del momento; acciones solo con contenido; hasta 4 principales', (t) => {
  const { db, ctx, D } = preparar(t);
  op(db, D, ctx, { fecha: '2026-07-10', sentido: 'ENTRADA', monto: 900000, tipo: 'INGRESO', cuenta: 'Servicio Mensual' });
  op(db, D, ctx, { fecha: '2026-07-11', sentido: 'SALIDA', monto: 400000, tipo: 'EGRESO', cuenta: 'Sueldos' });
  op(db, D, ctx, { fecha: '2026-08-10', sentido: 'ENTRADA', monto: 1000000, tipo: 'INGRESO', cuenta: 'Servicio Mensual' });
  op(db, D, ctx, { fecha: '2026-08-11', sentido: 'SALIDA', monto: 450000, tipo: 'EGRESO', cuenta: 'Sueldos' });
  F.importarCartola(db, D({ filas: cartola([['20/08/2026', 'TRANSFER DE CLIENTE X', 0, 180000, '1']]), empresa: 'HomePymes' }), ctx);
  const c = R.reporte(db, D({ periodo: '2026-08' }), ctx);
  const ins = c.insights;
  assert.equal(ins[0].rule_id, 'DATOS_INCOMPLETOS');
  assert.match(ins[0].texto, /^Agosto 2026 aún no permite evaluar una mejora: hay \$180\.000 por revisar en 1 movimiento\(s\)\. Completa esas revisiones antes de comparar el flujo\.$/);
  assert.deepEqual(ins[0].acciones, ['REVISAR_PENDIENTES'], 'sin «Cómo se calculó» decorativo');
  assert.ok(ins[0].hechos && ins[0].hechos.falta.length === 1);
  // La misma falta de datos no se repite en «meses de caja».
  assert.equal(ins.filter((i) => i.rule_id === 'MESES_CAJA').length, 0);
  // «Ver qué cambió» solo donde hay conceptos que compararon.
  ins.forEach((i) => { if (i.acciones.indexOf('VER_QUE_CAMBIO') !== -1) assert.ok(i.que_cambio || i.rule_id === 'GASTOS_VS_PPTO', i.rule_id); });
  assert.ok(ins.filter((i) => i.principal).length <= 4);
  const flujo = ins.find((i) => i.rule_id === 'FLUJO_PROPIO');
  assert.equal(flujo.severidad, 'info', 'con datos provisorios no se califica');
  assert.deepEqual(flujo.contribuciones.map((x) => [x.nombre, x.diferencia]), [['Servicio Mensual', 100000], ['Sueldos', -50000]]);
});

test('I09.5 · la revisión de datos no cambia con sesiones ni bitácora, sí con un dato; el PDF lleva todas sus secciones', (t) => {
  const { db, ctx, D } = preparar(t);
  op(db, D, ctx, { fecha: '2026-08-10', sentido: 'ENTRADA', monto: 1000, tipo: 'INGRESO', cuenta: 'Servicio Mensual' });
  const a = R.reporte(db, D({ periodo: '2026-08' }), ctx).data_revision;
  const b = R.reporte(db, D({ periodo: '2026-08' }), ctx).data_revision;
  assert.equal(a, b, 'leer dos veces no cambia la revisión');
  op(db, D, ctx, { fecha: '2026-08-11', sentido: 'SALIDA', monto: 300, tipo: 'EGRESO', cuenta: 'Sueldos' });
  assert.notEqual(R.reporte(db, D({ periodo: '2026-08' }), ctx).data_revision, a);
  const html = R.informeHtml_(R.reporte_(db, { periodo: '2026-08' }), 'Persona Uno', 'hoy');
  ['Lectura del mes', 'Indicadores', 'Comparaciones', 'Cascada del flujo propio', 'Calidad del dato', 'Cómo se calcula', 'Reglas de los comentarios', 'Confidencial'].forEach((sec) => assert.ok(html.indexOf(sec) !== -1, 'el PDF trae ' + sec));
});

test('I09.5 · exportar: el mes es obligatorio salvo «todo el historial»; el informe lleva los metadatos de su contrato y números como números', (t) => {
  const { db, ctx, D } = preparar(t);
  op(db, D, ctx, { fecha: '2026-08-05', sentido: 'ENTRADA', monto: 500000, tipo: 'INGRESO', cuenta: 'Servicio Mensual' });
  op(db, D, ctx, { fecha: '2026-08-06', sentido: 'SALIDA', monto: 120000, tipo: 'EGRESO', cuenta: 'Sueldos', tercero: '=HYPERLINK("x")' });
  assert.ok(X.exportar(db, D({ tipo: 'operaciones', formato: 'csv', filtros: {} }), ctx)._validationError);
  const todas = X.exportar(db, D({ tipo: 'operaciones', formato: 'csv', filtros: { todo: true } }), ctx);
  assert.equal(todas.filas, 2);
  assert.ok(Buffer.from(todas.base64, 'base64').toString('utf8').indexOf(";\"'=HYPERLINK(\"\"x\"\")\";") !== -1, 'texto que parece fórmula, neutralizado');
  const r = X.exportar(db, D({ tipo: 'informe', formato: 'csv', filtros: { periodo: '2026-08' } }), ctx);
  const csv = Buffer.from(r.base64, 'base64').toString('utf8');
  const c = R.reporte_(db, { periodo: '2026-08' });
  assert.ok(csv.indexOf('Revisión de datos;' + c.data_revision) !== -1, 'misma revisión que el contrato');
  assert.ok(csv.indexOf('Moneda;CLP') !== -1);
  assert.match(csv, /\r\nCascada;Sueldos;-120000;pago;;\r\n/, 'un negativo sigue siendo número (sin apóstrofo)');
  assert.equal(Base.revision_(), c.data_revision);
});
