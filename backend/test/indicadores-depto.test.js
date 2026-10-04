'use strict';

/**
 * Motor de indicadores de la reportabilidad (2026-10-03): vencimientos
 * hábiles, puntualidad del F29 con reincidentes, avance contable que empeora,
 * registros de la DT pendientes, dependencia de una persona, el reporte
 * ejecutivo con lo malo primero, y permisos.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const CI = require('../logica/controlInterno');
const I = require('../logica/indicadoresDepto');
const C = require('../logica/calidadDatos');

const ADM = { email: 'admin@homepymes.cl', rol: 'ADM', modulos: [] };
const FRANCISCA = { email: 'francisca@homepymes.cl', rol: 'DEV', modulos: [] };
const VANESSA = { email: 'vanessa@homepymes.cl', rol: 'DEV', modulos: [] };
const PER = '2026-M08';

function crear() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  C.asegurarFeriados_(db);
  CI.guardarMiembros(db, { depto: 'CONTABILIDAD', miembros: [{ email: FRANCISCA.email, rol: 'REGISTRA' }] }, ADM);
  CI.guardarMiembros(db, { depto: 'RRHH', miembros: [{ email: VANESSA.email, rol: 'REGISTRA' }] }, ADM);
  return db;
}
let n = 0;
function fila(db, matriz, periodo, cliente, datos, estado, resp) {
  agregarFila_(db, 'CI_REGISTROS', { registro_id: 'R' + (++n), depto: matriz === 'IVA' || matriz === 'CONTABILIZACION' || matriz === 'FACTURACION' ? 'CONTABILIDAD' : 'RRHH', matriz, periodo,
    cliente_id: 'CLI-' + cliente, cliente_nombre: 'Cliente ' + cliente, datos: datos || {}, estado: estado || 'TERMINADO', responsable_email: resp || '', activa: true });
}
const meses = (hasta, k) => { const o = []; for (let i = k - 1; i >= 0; i--) o.push(CI.moverPeriodo_(hasta, -i)); return o; };

test('el vencimiento hábil corre al lunes y salta los feriados', () => {
  const db = crear();
  const fer = new Set(require('../logica/cumplimiento').obtenerFeriados(db));
  assert.equal(I.vencimiento_('2026-M08', 20, fer), '2026-09-21', 'el 20-09-2026 fue domingo');
  assert.equal(I.vencimiento_('2026-M04', 20, fer), '2026-05-20');
  assert.equal(I.vencimiento_('2026-M11', 10, fer), '2026-12-10');
  assert.equal(I.diasHabiles_('2026-09-17', '2026-09-21', fer), 1, '18 y 19 son feriado, 19-20 fin de semana');
  assert.equal(I.num_('1.3256668E7'), 13256668);
  assert.equal(I.num_('1.234.567'), 1234567);
});

test('F29: puntualidad, al límite y clientes que se atrasan casi siempre', () => {
  const db = crear();
  // El cliente A se atrasa 4 de 12 meses; B siempre a tiempo; C sin declaración en agosto.
  meses(PER, 12).forEach((p, i) => {
    const venc = I.vencimiento_(p, 20, new Set(require('../logica/cumplimiento').obtenerFeriados(db)));
    const tarde = new Date(new Date(venc).getTime() + 3 * 864e5).toISOString().slice(0, 10);
    fila(db, 'IVA', p, 'A', { fecha_declaracion: i % 3 === 2 ? tarde : venc.slice(0, 8) + '05', monto_pago: 1000000 });
    fila(db, 'IVA', p, 'B', { fecha_declaracion: venc.slice(0, 8) + '10', monto_pago: '1.5E7' });
    if (p === PER) fila(db, 'IVA', p, 'C', {}, 'PENDIENTE');
  });
  const r = I.calcularArea_(db, 'CONTABILIDAD', PER);
  const k = (c) => r.kpis.find((x) => x.clave === c);
  assert.equal(k('f29_a_tiempo').valor, 50, 'en agosto A se atrasó: 1 de 2');
  assert.equal(k('f29_a_tiempo').estado, 'critico');
  assert.match(k('f29_a_tiempo').explicacion, /clientes que se atrasan 3 meses o más/);
  assert.deepEqual(r.detalle.f29_reincidentes, [{ cliente: 'Cliente A', meses_tarde: 4 }]);
  assert.equal(k('f29_sin_registro').valor, 1);
  assert.equal(k('iva_pagado').valor, 16000000, 'el monto en notación científica también suma');
  assert.equal(k('f29_a_tiempo').serie.length, 12);
  assert.ok(r.alertas.some((a) => a.clave === 'f29_reincidentes'));
});

test('avance contable que empeora 3 meses seguidos es alerta aunque esté sobre la meta', () => {
  const db = crear();
  // 20 clientes por mes; los últimos 4 meses dejan 0, 0, 0 → 1, 1 → … pendientes crecientes pero sobre 90 %.
  meses(PER, 12).forEach((p, i) => {
    const pend = i >= 9 ? i - 8 : 0; // jun 1, jul 2, ago 3
    for (let c = 0; c < 40; c++) fila(db, 'CONTABILIZACION', p, 'K' + c, {}, c < pend ? 'PENDIENTE' : 'TERMINADO');
  });
  const r = I.calcularArea_(db, 'CONTABILIDAD', PER);
  const k = r.kpis.find((x) => x.clave === 'avance_contable');
  assert.equal(k.valor, 92.5);
  assert.equal(k.racha_empeora, 3);
  assert.equal(k.estado, 'alerta');
  assert.match(k.explicacion, /Bajó 3 meses seguidos/);
  assert.ok(r.kpis.find((x) => x.clave === 'atraso_contable').valor >= 2, 'K0 y K1 acumulan meses');
});

test('RR.HH.: registros de la DT pendientes, salidas por entrada y lo que no se puede medir', () => {
  const db = crear();
  fila(db, 'RLE_FINIQUITOS', '2025-M10', 'A', {}, 'PENDIENTE');
  fila(db, 'RLE_CONTRATOS', '2024-M02', 'B', {}, 'PENDIENTE');
  fila(db, 'RLE_CONTRATOS', PER, 'B', {}, 'PENDIENTE'); // del mes: todavía en plazo
  meses(PER, 12).forEach((p) => {
    fila(db, 'CONTRATOS', p, 'A', { cantidad_trabajadores_contratos: 2 });
    fila(db, 'FINIQUITOS', p, 'A', { n_trabajadores: 4, causal_finiquito: '159-1 ACUERDO ENTRE LAS PARTES' });
    fila(db, 'REMUNERACIONES', p, 'A', { cantidad: 30 }, 'TERMINADO', VANESSA.email);
  });
  const r = I.calcularArea_(db, 'RRHH', PER);
  const k = (c) => r.kpis.find((x) => x.clave === c);
  assert.equal(k('rle_pendiente').valor, 2, 'un pendiente de hace dos años también cuenta; el del mes no');
  assert.equal(k('rle_pendiente').estado, 'critico');
  assert.equal(r.alertas[0].clave, 'rle_pendiente', 'lo crítico va primero');
  assert.equal(k('salidas_por_entrada').valor, 2);
  assert.ok(r.alertas.some((a) => a.clave === 'salidas_por_entrada'));
  assert.equal(k('cotizaciones_a_tiempo').estado, 'sin_dato');
  assert.match(k('cotizaciones_a_tiempo').explicacion, /No se puede medir/);
  assert.equal(k('liquidaciones').valor, 30);
  assert.equal(r.detalle.causales[0].participacion, 100);
});

test('dependencia de una persona: cuenta también a quien aparece solo por su nombre', () => {
  const db = crear();
  for (let i = 0; i < 7; i++) fila(db, 'FACTURACION', PER, 'A' + i, { monto_total: 1000 }, 'TERMINADO', FRANCISCA.email);
  for (let i = 0; i < 3; i++) fila(db, 'FACTURACION', PER, 'B' + i, { monto_total: 1000, quien_realiza: 'Krishna' });
  const k = I.calcularArea_(db, 'CONTABILIDAD', PER).kpis.find((x) => x.clave === 'dependencia');
  assert.equal(k.valor, 70);
  assert.equal(k.estado, 'alerta');
});

test('ejecutivo: las cuatro áreas, lo crítico primero, 6 indicadores; permisos del área', () => {
  const db = crear();
  fila(db, 'RLE_FINIQUITOS', '2025-M10', 'A', {}, 'PENDIENTE');
  fila(db, 'REMUNERACIONES', PER, 'A', { cantidad: 30 }, 'TERMINADO', VANESSA.email);
  fila(db, 'FACTURACION', PER, 'A', { monto_total: 1000 }, 'TERMINADO', FRANCISCA.email);
  const e = I.ejecutivo_(db, PER);
  assert.deepEqual(e.semaforo.map((s) => [s.depto, s.nivel]).slice(2), [['PREVENCION', 'sin_datos'], ['MARKETING', 'sin_datos'], ['COBRANZAS', 'sin_datos']]);
  assert.equal(e.semaforo.find((s) => s.depto === 'RRHH').nivel, 'critico');
  assert.equal(e.alertas[0].nivel, 'critico');
  assert.ok(e.indicadores.length >= 3 && e.indicadores.every((k) => k.gerencia && k.valor !== null), 'solo los indicadores de gerencia que tienen valor');
  // Permisos: cada área ve lo suyo; Administración ve todo.
  assert.equal(I.area(db, { depto: 'RRHH', periodo: PER }, FRANCISCA)._forbidden, true);
  assert.equal(I.area(db, { depto: 'RRHH', periodo: PER }, VANESSA).depto, 'RRHH');
  assert.equal(I.area(db, { depto: 'PREVENCION', periodo: PER }, ADM).con_indicadores, false);
});

test('Facturación y Cobranzas: cartera vencida, morosos y días de cobro', () => {
  const db = crear();
  const fac = (cliente, emision, vence, monto, pagado, fechaPago) => agregarFila_(db, 'CI_REGISTROS', { registro_id: 'C' + (++n), depto: 'COBRANZAS', matriz: 'COBRANZA', periodo: emision.slice(0, 4) + '-M' + emision.slice(5, 7),
    cliente_id: 'CLI-' + cliente, cliente_nombre: 'Cliente ' + cliente, datos: { fecha_emision: emision, fecha_vencimiento: vence, monto, monto_pagado: pagado || '', fecha_pago: fechaPago || '' },
    estado: pagado >= monto ? 'PAGADA' : (pagado ? 'ABONADA' : 'POR_COBRAR'), activa: true });
  fac('A', '2026-04-01', '2026-04-30', 500000);                 // vencida hace más de 90 días al 31-08
  fac('B', '2026-08-01', '2026-08-15', 300000, 100000);         // abonada y vencida
  fac('C', '2026-08-10', '2026-09-10', 200000);                 // por vencer
  fac('D', '2026-07-01', '2026-07-31', 400000, 400000, '2026-07-21'); // pagada a tiempo (20 días)
  const r = I.calcularArea_(db, 'COBRANZAS', PER);
  const k = (c) => r.kpis.find((x) => x.clave === c);
  assert.equal(k('cartera_vencida').valor, 700000, '500.000 de A + 200.000 de saldo de B');
  assert.equal(k('cartera_vencida').estado, 'critico', 'A lleva más de 90 días');
  assert.deepEqual(r.detalle.morosos.map((x) => x.cliente), ['Cliente A', 'Cliente B']);
  assert.equal(k('dias_cobro').valor, 20);
  assert.equal(r.alertas[0].clave, 'cartera_vencida');
  assert.equal(I.ejecutivo_(db, PER).semaforo.find((s) => s.depto === 'COBRANZAS').nivel, 'critico');
});
