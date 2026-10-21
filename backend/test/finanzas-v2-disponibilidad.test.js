'use strict';

/**
 * Finanzas · corrección v2, I03 (2026-10-20): disponibilidad propia, calidad
 * por métrica, comparaciones homogéneas y proyección sin «alcanza» falso.
 * Datos inventados; el caso base imita el PDF de revisión: $3.084.000 en el
 * banco, $2.050.000 de un cliente sin saldo inicial y compromisos por $450.000.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparar, versionDe, cartola } = require('./_finanzasPrueba');
const F = require('../logica/finanzasBancos');
const Op = require('../logica/finanzasOperaciones');
const R = require('../logica/finanzasReportes');
const Fo = require('../logica/finanzasFondos');
const Pl = require('../logica/finanzasPlanificacion');

const op = (db, D, ctx, o) => Op.guardar(db, D(Object.assign({ empresa: 'HomePymes', medio: 'EFECTIVO', confirmar: true }, o)), ctx);

function escenario(t) {
  const e = preparar(t);
  const { db, ctx, D } = e;
  // Banco: 1.034.000 + 2.050.000 de un cliente para sus imposiciones = 3.084.000.
  F.importarCartola(db, D({ filas: cartola([['05/08/2026', 'TRANSFER DE CONSTRUCTORA NORTE', 0, 2050000, '1']], { anterior: 1034000 }), empresa: 'HomePymes' }), ctx);
  const m = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos[0];
  F.clasificar(db, D({ items: [{ id: m.id, tipo: 'FONDO_RECIBIDO', cuenta: 'Imposiciones', cliente_id: 'CL-2' }] }), ctx);
  // Pagos propios de meses anteriores (base del promedio y de la estimación de sueldos).
  ['2026-06-09', '2026-07-09', '2026-08-09'].forEach((f) => op(db, D, ctx, { fecha: f, sentido: 'SALIDA', monto: 600000, tipo: 'EGRESO', cuenta: 'Sueldos' }));
  Pl.guardarCompromiso(db, D({ fecha: '2026-09-15', empresa: 'HomePymes', monto: 450000, concepto: 'Arriendo oficina', tipo: 'CONFIRMADO', sentido: 'SALIDA' }), ctx);
  return e;
}

test('I03.2 · sin saldo inicial del cliente: la disponibilidad propia no es determinable y nadie dice «alcanza»', (t) => {
  const { db } = escenario(t);
  const c = R.reporte_(db, { periodo: '2026-08', hoy: '2026-10-20' });
  assert.equal(c.metrics.caja, 3084000);
  const ev = c.evaluacion.caja_libre;
  assert.deepEqual([ev.metric, ev.status, ev.amount, ev.can_assess_sufficiency], ['OWN_AVAILABLE_CASH', 'NOT_DETERMINABLE', null, false]);
  assert.ok(ev.reasons.indexOf('APERTURA') !== -1);
  assert.equal(ev.referencial.monto, 1034000, 'la resta se ve, pero aparte y como referencia');
  assert.equal(c.metrics.caja_libre, null);
  assert.equal(c.metrics.meses_caja, null);
  // El saldo bancario sí es una cifra conocida; los cobros del mes no dependen de la apertura.
  assert.equal(c.evaluacion.caja.status, 'DETERMINED');
  const ob = c.insights.find((i) => i.rule_id === 'OBLIGACIONES');
  assert.equal(ob.suficiencia_evaluable, false);
  assert.match(ob.texto, /No se puede afirmar si alcanza/);
  assert.ok(!/(La caja|disponibilidad propia).*(alcanza|cubre)\b/.test(ob.texto.replace('No se puede afirmar si alcanza', '')), 'ni superávit ni déficit no acreditados');
  assert.equal(ob.severidad, 'info');
  assert.ok(!c.insights.some((i) => /\bNO alcanza\b|\bla caja .* alcanza\b/i.test(i.texto)));
  // Lo mismo en el PDF (se arma desde el mismo contrato).
  const html = R.informeHtml_(c, 'Prueba', '2026-10-20');
  assert.ok(!/NO alcanza|\) alcanza/.test(html));
});

test('I03.3 · con saldo inicial aprobado la disponibilidad se determina y la suficiencia se evalúa', (t) => {
  const { db, ctx, D } = escenario(t);
  const a = Fo.guardarApertura(db, D({ cliente_id: 'CL-2', empresa: 'HomePymes', fecha_corte: '2026-07-31', monto: '0', fuente: 'Planilla al 31-07 (prueba)' }), ctx);
  Fo.decidirApertura(db, D({ id: a.id, accion: 'APROBAR', expected_version: versionDe('FIN_APERTURAS', a.id) }), ctx);
  const c = R.reporte_(db, { periodo: '2026-08', hoy: '2026-10-20' });
  const ev = c.evaluacion.caja_libre;
  assert.deepEqual([ev.status, ev.amount, ev.can_assess_sufficiency], ['DETERMINED', 1034000, true]);
  assert.equal(c.metrics.meses_caja, 1.7, '1.034.000 ÷ 600.000');
  assert.equal(ev.referencial, null, 'determinada: no hace falta una referencia');
  // Imposiciones e IVA sin pagos: monto por determinar → todavía no se evalúa la suficiencia.
  let ob = c.insights.find((i) => i.rule_id === 'OBLIGACIONES');
  assert.equal(ob.suficiencia_evaluable, false);
  assert.match(ob.texto, /Obligaciones sin monto conocido: Imposiciones, IVA/);
  op(db, D, ctx, { fecha: '2026-08-10', sentido: 'SALIDA', monto: 100000, tipo: 'EGRESO', cuenta: 'Imposiciones' });
  op(db, D, ctx, { fecha: '2026-08-20', sentido: 'SALIDA', monto: 50000, tipo: 'EGRESO', cuenta: 'IVA' });
  const c2 = R.reporte_(db, { periodo: '2026-08', hoy: '2026-10-20' });
  ob = c2.insights.find((i) => i.rule_id === 'OBLIGACIONES');
  assert.equal(ob.suficiencia_evaluable, true);
  assert.match(ob.texto, /La disponibilidad propia \(\$[\d.]+\) (los cubre|NO los cubre)/);
});

test('I03.3 · null es desconocido y 0 es un importe conocido', (t) => {
  const { db } = preparar(t);
  const c = R.reporte_(db, { periodo: '2026-08', hoy: '2026-10-20' });
  assert.equal(c.evaluacion.caja.amount, null);
  assert.equal(c.evaluacion.caja.status, 'NOT_DETERMINABLE');
  assert.ok(c.evaluacion.caja.reasons.indexOf('SIN_CUENTAS') !== -1);
});

test('I03.4 · mes en curso: se compara el mismo tramo del mes anterior (día con tope) y no se califica con datos provisorios', (t) => {
  const { db, ctx, D } = preparar(t);
  op(db, D, ctx, { fecha: '2026-09-10', sentido: 'ENTRADA', monto: 500000, tipo: 'INGRESO', cuenta: 'Servicio Mensual' });
  op(db, D, ctx, { fecha: '2026-09-29', sentido: 'ENTRADA', monto: 900000, tipo: 'INGRESO', cuenta: 'Servicio Mensual' });
  op(db, D, ctx, { fecha: '2026-10-12', sentido: 'ENTRADA', monto: 600000, tipo: 'INGRESO', cuenta: 'Servicio Mensual' });
  const c = R.reporte_(db, { periodo: '2026-10', hoy: '2026-10-20' });
  const cmp = c.comparisons.ingresos.PREVIOUS_PERIOD;
  assert.equal(cmp.modalidad, 'ACUMULADO_A_LA_FECHA');
  assert.deepEqual(cmp.fechas, { actual: ['2026-10-01', '2026-10-20'], base: ['2026-09-01', '2026-09-20'] });
  assert.deepEqual([cmp.actual, cmp.base, cmp.diferencia], [600000, 500000, 100000], 'el 29-sep no entra: no es el mismo tramo');
  assert.equal(cmp.evaluable, false, 'mes en curso con datos sin cartola: se muestra sin calificar');
  assert.ok(cmp.motivo_no_evaluable);
  assert.equal(c.insights.find((i) => i.rule_id === 'FLUJO_PROPIO').severidad, 'info', 'una subida provisoria no se pinta como buena');
  // Tope por largo de mes: 31-oct contra 1–30 sep.
  const fin = R.reporte_(db, { periodo: '2026-10', hoy: '2026-10-31' });
  assert.deepEqual(fin.comparisons.ingresos.PREVIOUS_PERIOD.fechas.base, ['2026-09-01', '2026-09-30']);
  // Cada comparación lleva período, corte, base, universo y revisión.
  ['periodo', 'corte', 'basis', 'alcance', 'revision'].forEach((k) => assert.ok(k in cmp, k));
});

test('I03.5 · proyección: parte de la disponibilidad, cubre el resto del mes del corte, reemplaza estimación por compromiso y no dice «alcanza» si es parcial', (t) => {
  const { db, ctx, D } = escenario(t);
  // Un compromiso de sueldos de septiembre reemplaza a la estimación de ese mes.
  Pl.guardarCompromiso(db, D({ fecha: '2026-09-09', empresa: 'HomePymes', monto: 650000, concepto: 'Sueldos septiembre', tipo: 'CONFIRMADO', sentido: 'SALIDA' }), ctx);
  const p = Pl.proyeccion(db, D({ meses: 2 }), ctx);
  assert.equal(p.corte, '2026-08-05');
  assert.equal(p.serie[0].periodo, '2026-08', 'el horizonte empieza en el mes del corte');
  assert.equal(p.escenario, 'PARCIAL');
  assert.equal(p.inicio.determinada, false);
  assert.equal(p.inicio.monto, 1034000, 'referencia, declarada como tal');
  assert.equal(p.suficiencia.evaluable, false);
  assert.equal(p.suficiencia.alcanza, null);
  assert.match(p.suficiencia.texto, /No se evalúa si alcanza/);
  const sep = p.serie.find((s) => s.periodo === '2026-09');
  assert.ok(sep.sustituciones.some((x) => x.obligacion === 'Sueldos' && x.compromiso === 650000 && x.estimado === 600000), 'se muestra la sustitución');
  assert.equal(sep.compromisos_salida, 450000 + 650000);
  assert.ok(!sep.estimado_salida || sep.estimado_salida < 600000 || !sep.por_determinar.includes('Sueldos'));
  assert.ok(sep.por_determinar.indexOf('Imposiciones') !== -1, 'sin pagos: por determinar, no cero');
  // Agosto: ya se pagaron los sueldos del mes, no se vuelven a restar.
  const ago = p.serie[0];
  assert.equal(ago.estimado_salida, 0);
});
