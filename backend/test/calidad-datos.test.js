'use strict';

/**
 * Arreglos de datos al arrancar (2026-10-03, etapa 1 de la reportabilidad):
 * montos y RUT que Excel entregó en notación científica, y feriados de Chile.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const C = require('../logica/calidadDatos');
const P = require('../logica/controlInternoPlanillas');
const Cumplimiento = require('../logica/cumplimiento');

function crear() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  return db;
}
function fila(db, matriz, datos) {
  agregarFila_(db, 'CI_REGISTROS', { registro_id: 'R' + Math.random(), depto: 'CONTABILIDAD', matriz, periodo: '2026-M08', cliente_id: '', cliente_nombre: 'X', datos, estado: 'TERMINADO', activa: true });
}

test('el importador lee la notación científica de Excel', () => {
  assert.equal(P.numero_('1.3256668E7'), 13256668);
  assert.equal(P.valor_('monto', '1.3256668E7'), 13256668);
  assert.equal(P.valor_('texto', '1.2345678E7'), '12345678', 'un RUT que Excel volvió número queda en dígitos');
  assert.equal(P.valor_('texto', 'Juan Pérez'), 'Juan Pérez');
  assert.equal(P.numero_('1.234.567'), 1234567, 'lo de siempre sigue igual');
});

test('lo ya cargado se corrige una sola vez: montos a número, RUT a dígitos, el resto intacto', () => {
  const db = crear();
  fila(db, 'IVA', { monto_pago: '1.3256668E7', rut: '7.6111111E7', obs: 'Pagó 1E3 en efectivo', monto_ppm: 'NA' });
  fila(db, 'CONVENIOS', { monto_total_deuda_4: '2.5E7' });
  fila(db, 'IVA', { monto_pago: 15000 });
  assert.equal(C.normalizarNotacionCientifica_(db), 2);
  assert.equal(C.normalizarNotacionCientifica_(db), 0, 'idempotente');
  const datos = leerFilas_(db, 'CI_REGISTROS', COLUMNAS.CI_REGISTROS).map((r) => (typeof r.datos === 'string' ? JSON.parse(r.datos) : r.datos));
  assert.deepEqual(datos[0], { monto_pago: 13256668, rut: '76111111', obs: 'Pagó 1E3 en efectivo', monto_ppm: 'NA' });
  assert.equal(datos[1].monto_total_deuda_4, 25000000, 'la deuda de los convenios 4 a 9 es monto aunque la planilla la traiga como texto');
});

test('se cargan los feriados de Chile que falten, sin tocar los que ya están', () => {
  const db = crear();
  agregarFila_(db, 'CONFIG_FERIADOS', { fecha: '2026-09-18', nombre: 'Fiestas Patrias (cargado a mano)', anio: 2026 });
  const n = C.asegurarFeriados_(db);
  assert.equal(n, C.FERIADOS_CHILE.length - 1);
  assert.equal(C.asegurarFeriados_(db), 0);
  const f = Cumplimiento.obtenerFeriados(db);
  assert.ok(f.includes('2026-09-19') && f.includes('2025-12-25'));
  assert.equal(leerFilas_(db, 'CONFIG_FERIADOS', COLUMNAS.CONFIG_FERIADOS).find((x) => x.fecha === '2026-09-18').nombre, 'Fiestas Patrias (cargado a mano)');
});
