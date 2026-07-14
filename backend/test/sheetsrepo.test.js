'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadIntakeProject, seedSheet } = require('./helpers/gasSandbox');

// Regresion del bug real de produccion: al agregar columnas al esquema
// (rut_cliente/codigo_cliente) el dashboard/consultar/gerencia dejaron de
// mostrar solicitudes. Causa: leerFilas_ leia POR POSICION un ancho fijo
// (COLUMNAS.length), asi que cualquier desalineacion entre el codigo
// desplegado y la hoja rompia la lectura. Ahora lee POR NOMBRE de encabezado.

test('leerFilas_ mapea por nombre de encabezado aunque la hoja tenga columnas EXTRA', () => {
  const ctx = loadIntakeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  // La hoja trae 2 columnas que el codigo NO conoce, al final.
  seedSheet(ctx, 'CAT_EMPRESAS', ['empresa_id', 'nombre', 'logo', 'activo', 'columna_futura_1', 'columna_futura_2'], [
    ['HP', 'HomePymes', 'logo.png', true, 'x', 'y']
  ]);
  const filas = ctx.leerFilas_('CAT_EMPRESAS');
  assert.equal(filas.length, 1);
  assert.equal(filas[0].empresa_id, 'HP');
  assert.equal(filas[0].nombre, 'HomePymes');
  assert.equal(filas[0].activo, true);
  // las columnas desconocidas quedan disponibles por su nombre real
  assert.equal(filas[0].columna_futura_1, 'x');
});

test('leerFilas_ mapea por nombre aunque las columnas esten en DISTINTO orden', () => {
  const ctx = loadIntakeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'CAT_EMPRESAS', ['activo', 'nombre', 'empresa_id', 'logo'], [
    [true, 'RLD', 'RLD', '']
  ]);
  const filas = ctx.leerFilas_('CAT_EMPRESAS');
  assert.equal(filas[0].empresa_id, 'RLD');
  assert.equal(filas[0].nombre, 'RLD');
  assert.equal(filas[0].activo, true);
});

test('leerFilas_ deja en "" (no undefined) una columna del esquema que la hoja no tiene todavia', () => {
  const ctx = loadIntakeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  // Hoja SIN la columna 'logo' (instalacion previa a que se agregara).
  seedSheet(ctx, 'CAT_EMPRESAS', ['empresa_id', 'nombre', 'activo'], [
    ['HP', 'HomePymes', true]
  ]);
  const filas = ctx.leerFilas_('CAT_EMPRESAS');
  assert.equal(filas[0].empresa_id, 'HP');
  assert.equal(filas[0].logo, ''); // presente y vacio, nunca undefined
  assert.ok('logo' in filas[0]);
});

test('leerFilas_ devuelve [] en una hoja vacia (solo headers o sin filas)', () => {
  const ctx = loadIntakeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'CAT_EMPRESAS', ['empresa_id', 'nombre', 'logo', 'activo'], []);
  assert.equal(ctx.leerFilas_('CAT_EMPRESAS').length, 0);
});
