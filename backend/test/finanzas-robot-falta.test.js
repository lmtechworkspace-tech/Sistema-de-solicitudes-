'use strict';

/**
 * «Traer lo que falta» (12-11-2026; finanzasRobotFalta.js): desde qué mes faltan cartolas del BCI y ventas del SII,
 * mirando lo ya importado; hasta el mes pasado; como mucho 12 meses. Datos inventados; «hoy» fijo en 12-11-2026.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparar, cartola } = require('./_finanzasPrueba');
const Base = require('../logica/finanzasBase');
const Falta = require('../logica/finanzasRobotFalta');
const { ACCIONES } = require('../server/router');
const ejecutar = (db, n, data, ctx) => ACCIONES[n](db, data, ctx);

const CSV = 'Nro;Tipo Doc;Tipo Venta;Rut cliente;Razon Social;Folio;Fecha Docto;Fecha Recepcion;Fecha Acuse Recibo;Fecha Reclamo;Monto Exento;Monto Neto;Monto IVA;Monto total\r\n' +
  '1;33;Del Giro;11111111-1;CLIENTE DE PRUEBA SPA;1201;15/08/2026;15/08/2026 10:00:00;;;0;100000;19000;119000\r\n';

test('ayudas: sumar meses y último día', () => {
  assert.equal(Falta.mesMas_('2026-11', 2), '2027-01');
  assert.equal(Falta.mesMas_('2026-01', -1), '2025-12');
  assert.equal(Falta.ultimoDia_('2026-02-28'), true);
  assert.equal(Falta.ultimoDia_('2026-10-30'), false);
});

test('BCI y SII: desde la última importación hasta el mes pasado; al día; sin historial; tope de 12 meses', (t) => {
  const { db, ctx, D } = preparar(t);
  const hoy = Base.hoy_;
  Base.hoy_ = () => '2026-11-12';
  try {
    let r = ejecutar(db, 'finanzasRobotFalta', D({ tipo: 'BCI' }), ctx);
    assert.equal(r.sin_historial, true, JSON.stringify(r));
    assert.match(r.motivo, /Todavía no hay cartolas/);

    const imp = ejecutar(db, 'finanzasImportarCartola', D({ empresa: 'HomePymes', filas: cartola([['05/08/2026', 'HONORARIOS', 0, 500000], ['19/08/2026', 'SUELDOS', 300000, 0]], { periodo: '01-08-2026 al 19-08-2026' }) }), ctx);
    assert.ok(imp.nuevas, JSON.stringify(imp));
    r = ejecutar(db, 'finanzasRobotFalta', D({ tipo: 'BCI' }), ctx);
    assert.deepEqual([r.al_dia, r.ultimo, r.desde, r.hasta, r.faltan_meses], [false, '2026-08-19', '2026-08', '2026-10', 3], 'agosto otra vez: faltan sus últimos días');
    assert.equal(r.cuentas[0].empresa, 'HomePymes');

    ejecutar(db, 'finanzasImportarCartola', D({ filas: cartola([['31/10/2026', 'HONORARIOS', 0, 10000]], { anterior: 1200000, periodo: '20-08-2026 al 31-10-2026' }) }), ctx);
    r = ejecutar(db, 'finanzasRobotFalta', D({ tipo: 'BCI' }), ctx);
    assert.deepEqual([r.al_dia, r.ultimo], [true, '2026-10-31'], JSON.stringify(r));

    // SII: por la empresa del RUT (la reconoce por las ventas ya importadas con ese emisor).
    r = ejecutar(db, 'finanzasRobotFalta', D({ tipo: 'SII', rut: '76.748.513-1' }), ctx);
    assert.equal(r.sin_historial, true);
    const v = ejecutar(db, 'finanzasImportarVentas', D({ texto: CSV, nombre: 'RCV_VENTA_76748513-1_202608.csv', empresa: 'HomePymes' }), ctx);
    assert.ok(v.nuevas, JSON.stringify(v));
    r = ejecutar(db, 'finanzasRobotFalta', D({ tipo: 'SII', rut: '76748513-1' }), ctx);
    assert.deepEqual([r.empresa, r.ultimo, r.desde, r.hasta], ['HomePymes', '2026-08', '2026-09', '2026-10'], JSON.stringify(r));

    // Mucho tiempo sin traer: se proponen los 12 más antiguos.
    Base.hoy_ = () => '2028-01-05';
    r = ejecutar(db, 'finanzasRobotFalta', D({ tipo: 'SII', rut: '76748513-1' }), ctx);
    assert.deepEqual([r.desde, r.hasta, r.recortado, r.faltan_meses], ['2026-09', '2027-08', true, 16]);
  } finally { Base.hoy_ = hoy; }
});
