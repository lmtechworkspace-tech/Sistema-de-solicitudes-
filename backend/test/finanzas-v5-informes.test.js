'use strict';

/**
 * Finanzas v5 · informes construidos sobre la planilla: cada cifra sale de las filas de la hoja con sus mismas reglas
 * (el resultado es el ABONO + ABONO RENTA del resumen), con comentarios explicados y la verificación con la cartola.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparar, cartola } = require('./_finanzasPrueba');
const F = require('../logica/finanzasBancos');
const H = require('../logica/finanzasHoja');
const Inf = require('../logica/finanzasInformes');
const B = require('../logica/finanzasBoveda');

function base(t) {
  const p = preparar(t);
  const { db, ctx, D } = p;
  F.importarCartola(db, D({ empresa: 'HomePymes', filas: cartola([['04/08/2026', 'TRANSFER DE ELECTRICA PACIF', 0, 88000, '1']]) }), ctx);
  const cuenta = B.dbFin().prepare('SELECT id FROM FIN_CUENTAS').get().id;
  const g = (campos) => { const r = H.guardar(db, D({ cuenta_ref: cuenta, campos }), ctx); assert.ok(!r._validationError, r.message); return r; };
  return Object.assign(p, { cuenta, g });
}
const com = (r, id) => r.comentarios.find((c) => c.id === id || c.id.indexOf(id + ':') === 0);

test('informe · un mes: las cifras salen de la planilla y el resultado es el ABONO + ABONO RENTA del resumen', (t) => {
  const { db, ctx, D, cuenta, g } = base(t);
  g({ fecha: '2026-09-02', monto: 900000, nombre: 'ANDES MONTAJES', obs: 'ABONO', plan: 'Servicio Mensual' });
  g({ fecha: '2026-09-03', monto: 300000, nombre: 'PANADERIA SOL', obs: 'ABONO RENTA' });
  g({ fecha: '2026-09-05', monto: 500000, nombre: 'CONSTRUCTORA NORTE', obs: 'IMPOSICIONES', grupo: 'A' });
  g({ fecha: '2026-09-09', monto: -450000, nombre: 'CONSTRUCTORA NORTE', obs: 'IMPOSICIONES', grupo: 'A' });
  g({ fecha: '2026-09-10', monto: -400000, nombre: 'ARRIENDO', obs: 'ABONO', plan: 'Arriendo Mensual' });
  g({ fecha: '2026-09-12', monto: -200000, nombre: 'ELECTRICA PACIFICO', obs: 'IVA' }); // se pagó por él sin que mandara: debe
  H.decidirGrupo(db, D({ cuenta_ref: cuenta, periodo: '2026-09', letra: 'A', decision: 'ABONO' }), ctx);
  const r = Inf.informe(db, D({ desde: '2026-09', hasta: '2026-09' }), ctx);
  assert.ok(!r._validationError, r.message);
  const sep = r.meses.find((m) => m.periodo === '2026-09');
  const hoja = H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx).totales;
  assert.equal(sep.honorarios, 900000 + 300000 + 50000, 'incluye lo que sobró del grupo y se cobró');
  assert.equal(sep.gastos, 400000);
  assert.equal(sep.resultado, hoja.ABONO + hoja['ABONO RENTA'], 'el resultado del informe es el de la planilla');
  assert.equal(sep.recurrentes, 900000 + 50000, 'mensual: Servicio Mensual y lo cobrado del grupo');
  assert.equal(sep.gastos_fijos, 400000, 'el arriendo es un gasto fijo');
  assert.deepEqual([sep.fondos_recibidos, sep.fondos_pagados], [500000, 650000]);
  assert.equal(sep.hon_cliente['ANDES MONTAJES INDUSTRIALES SPA'] || sep.hon_cliente['ANDES MONTAJES'], 900000);
  // Las filas de cada cifra vienen para «¿cómo se calculó?».
  assert.equal(r.filas.filter((f) => f.c === 'gas').reduce((s, f) => s - f.m, 0), sep.gastos);
  assert.ok(r.filas.find((f) => f.c === 'hon_grupo' && f.m === 50000));
  // Comentarios: resultado positivo, concentración y el cliente que debe.
  assert.equal(com(r, 'resultado').nivel, 'ok');
  assert.match(com(r, 'concentracion').titulo, /ANDES/);
  assert.equal(com(r, 'deudores').nivel, 'critico');
  assert.ok(r.clientes.deben.find((c) => /ELECTRICA/.test(c.cliente) && c.saldo === -200000));
  assert.ok(r.comentarios.every((c) => c.como), 'cada comentario dice cómo se calculó');
  assert.equal(r.calidad.estado, 'PROVISORIO', 'lo anotado todavía espera la cartola');
  assert.ok(r.calidad.razones.some((x) => /el banco no trae/.test(x)));
});

test('informe · verificación con la cartola: lo que coincide, lo que falta y un monto mal digitado', (t) => {
  const { db, ctx, D, g } = base(t);
  g({ fecha: '2026-09-07', monto: -1500000, nombre: 'VIRTUAL BAAS', obs: 'ABONO', plan: 'Otros Egresos' }); // el banco trae 1.566.958
  g({ fecha: '2026-09-02', monto: 357000, nombre: 'ANDES MONTAJES', obs: 'ABONO' });
  F.importarCartola(db, D({ filas: cartola([['02/09/2026', 'TRANSFER DE ANDES MONTAJE', 0, 357000, '11'], ['07/09/2026', 'TRANSFERENCIA A VIRTUAL BAAS', 1566958, 0, '12']], { periodo: '01-09-2026 al 30-09-2026' }) }), ctx);
  const r = Inf.informe(db, D({ desde: '2026-09', hasta: '2026-09' }), ctx);
  const sep = r.meses.find((m) => m.periodo === '2026-09');
  assert.deepEqual([sep.verif.ok, sep.verif.esperando, sep.verif.falta], [1, 1, 1]);
  assert.equal(sep.verif.diferencias.length, 1);
  assert.deepEqual([sep.verif.diferencias[0].anotada.monto, sep.verif.diferencias[0].banco.monto, sep.verif.diferencias[0].diferencia], [-1500000, -1566958, -66958]);
  assert.equal(com(r, 'digitacion').nivel, 'alerta');
  assert.ok(sep.banco.cuadra && !sep.banco.cortes, 'la cartola en sí cuadra');
});

test('informe · comparar meses: tendencia, meses con pérdida, el gasto que más creció y límites del rango', (t) => {
  const { db, ctx, D, g } = base(t);
  [['2026-06', 1000000, 300000], ['2026-07', 1100000, 400000], ['2026-08', 1200000, 900000], ['2026-09', 1300000, 1600000]].forEach(([p, h, a]) => {
    g({ fecha: p + '-05', monto: h, nombre: 'ANDES MONTAJES', obs: 'ABONO', plan: 'Servicio Mensual' });
    g({ fecha: p + '-10', monto: -a, nombre: 'SUELDOS', obs: 'ABONO', plan: 'Sueldos' });
  });
  const r = Inf.informe(db, D({ desde: '2026-06', hasta: '2026-09' }), ctx);
  assert.deepEqual(r.rango, ['2026-06', '2026-07', '2026-08', '2026-09']);
  assert.equal(com(r, 'resultado_rango').titulo.indexOf('$1.400.000') !== -1, true, 'acumulado: 4.600.000 − 3.200.000');
  assert.equal(com(r, 'meses_negativos').titulo, '1 de 4 meses cerraron con pérdida');
  assert.equal(com(r, 'tendencia_hon').nivel, 'ok');
  assert.match(com(r, 'gasto_crece').titulo, /Sueldos/);
  assert.deepEqual(Inf.tendencia_([10, 20, 30]), { por_mes: 10, pct: 50, promedio: 20 });
  assert.ok(Inf.informe(db, D({ desde: '2026-09', hasta: '2026-06' }), ctx)._validationError);
  assert.ok(Inf.informe(db, D({ desde: '2024-01', hasta: '2026-09' }), ctx)._validationError, 'máximo 24 meses');
});
