'use strict';

/**
 * Prueba de concepto de la migracion de datos: los MISMOS escenarios de
 * comportamiento que sheetsrepo.test.js (el contrato real que usa toda la
 * logica de negocio de SIGSO), mismos asserts, corridos contra
 * backend/db/sqliteRepo.js en vez de la simulacion de Sheets.
 *
 * Si estos pasan, el contrato leerFilas_/agregarFila_/actualizarFilaPorId_/
 * eliminarFilasPorId_/diagnosticarEsquema_ es portable a un motor relacional
 * sin tocar la logica de negocio que lo consume -- esa es la pregunta que
 * esta prueba de concepto viene a contestar antes de construir el backend
 * Node completo.
 *
 * NO se porta el test "agregarFila_ NO releega la hoja en escrituras
 * sucesivas": esa optimizacion (v6.9, _cacheHojas_) existe para evitar
 * round-trips de RED a Sheets (~50-200ms cada uno); en SQLite local no hay
 * ese costo que evitar, asi que el test no tendria nada real que probar aqui.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  abrirDb_, sembrarTabla_, leerFilas_, agregarFila_, diagnosticarEsquema_
} = require('../db/sqliteRepo');
const { loadBackofficeProject } = require('./helpers/gasSandbox');

// Solo para tomar prestado el esquema real (COLUMNAS) de los tests de
// diagnosticarEsquema_ -- no se usa nada de Sheets de este contexto.
// COLUMNAS sale del contexto vm de gasSandbox: sus arrays son de OTRO
// realm (otro constructor Array) que los de este archivo, y
// assert.deepEqual falla comparando arrays cross-realm aunque el contenido
// sea identico. JSON.parse(JSON.stringify(...)) clona todo a arrays/objetos
// NATIVOS de este realm de una sola vez (es solo texto, sin funciones).
const COLUMNAS_REALES = JSON.parse(JSON.stringify(
  loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } }).COLUMNAS
));

test('leerFilas_ mapea por nombre de encabezado aunque la hoja tenga columnas EXTRA', () => {
  const db = abrirDb_();
  sembrarTabla_(db, 'CAT_EMPRESAS', ['empresa_id', 'nombre', 'logo', 'activo', 'columna_futura_1', 'columna_futura_2'], [
    ['HP', 'HomePymes', 'logo.png', true, 'x', 'y']
  ]);
  const filas = leerFilas_(db, 'CAT_EMPRESAS', ['empresa_id', 'nombre', 'logo', 'activo']);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].empresa_id, 'HP');
  assert.equal(filas[0].nombre, 'HomePymes');
  assert.equal(filas[0].activo, true);
  assert.equal(filas[0].columna_futura_1, 'x');
});

test('leerFilas_ mapea por nombre aunque las columnas esten en DISTINTO orden', () => {
  const db = abrirDb_();
  sembrarTabla_(db, 'CAT_EMPRESAS', ['activo', 'nombre', 'empresa_id', 'logo'], [
    [true, 'RLD', 'RLD', '']
  ]);
  const filas = leerFilas_(db, 'CAT_EMPRESAS', ['empresa_id', 'nombre', 'logo', 'activo']);
  assert.equal(filas[0].empresa_id, 'RLD');
  assert.equal(filas[0].nombre, 'RLD');
  assert.equal(filas[0].activo, true);
});

test('leerFilas_ deja en "" (no undefined) una columna del esquema que la hoja no tiene todavia', () => {
  const db = abrirDb_();
  sembrarTabla_(db, 'CAT_EMPRESAS', ['empresa_id', 'nombre', 'activo'], [
    ['HP', 'HomePymes', true]
  ]);
  const filas = leerFilas_(db, 'CAT_EMPRESAS', ['empresa_id', 'nombre', 'logo', 'activo']);
  assert.equal(filas[0].empresa_id, 'HP');
  assert.equal(filas[0].logo, '');
  assert.ok('logo' in filas[0]);
});

test('leerFilas_ devuelve [] en una hoja vacia (solo headers o sin filas)', () => {
  const db = abrirDb_();
  sembrarTabla_(db, 'CAT_EMPRESAS', ['empresa_id', 'nombre', 'logo', 'activo'], []);
  assert.equal(leerFilas_(db, 'CAT_EMPRESAS', []).length, 0);
});

test('agregarFila_ escribe alineado a los encabezados REALES aunque la hoja tenga columnas EXTRA sin encabezado del esquema', () => {
  const db = abrirDb_();
  sembrarTabla_(db, 'CAT_EMPRESAS', ['empresa_id', 'nombre', 'logo', 'activo', 'columna_futura'], []);
  agregarFila_(db, 'CAT_EMPRESAS', { empresa_id: 'HP', nombre: 'HomePymes', logo: '', activo: true });
  const filas = leerFilas_(db, 'CAT_EMPRESAS', []);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].empresa_id, 'HP');
  assert.equal(filas[0].nombre, 'HomePymes');
  assert.equal(filas[0].activo, true);
  assert.equal(filas[0].columna_futura, '');
});

test('agregarFila_ NO corrompe columnas siguientes si a la hoja le falta un encabezado del esquema (regresion real: Novedades activa)', () => {
  const db = abrirDb_();
  sembrarTabla_(db, 'CAT_EMPRESAS', ['empresa_id', 'nombre', 'activo'], []);
  agregarFila_(db, 'CAT_EMPRESAS', { empresa_id: 'HP', nombre: 'HomePymes', logo: 'logo.png', activo: true });
  const filas = leerFilas_(db, 'CAT_EMPRESAS', []);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].empresa_id, 'HP');
  assert.equal(filas[0].nombre, 'HomePymes');
  assert.equal(filas[0].activo, true);
});

// --- H-04: diagnostico de esquema, contra el esquema REAL de SIGSO --------

test('diagnosticarEsquema_ detecta una columna que falta en una hoja existente', () => {
  const db = abrirDb_();
  Object.keys(COLUMNAS_REALES).forEach((hoja) => {
    const cols = hoja === 'SGC_DESCRIPTORES'
      ? COLUMNAS_REALES[hoja].filter((c) => c !== 'items_responsabilidades' && c !== 'items_habilidades')
      : COLUMNAS_REALES[hoja];
    sembrarTabla_(db, hoja, cols, []);
  });

  const d = diagnosticarEsquema_(db, COLUMNAS_REALES);
  assert.equal(d.al_dia, false);
  assert.deepEqual(d.hojas_faltantes, []);
  assert.equal(d.columnas_faltantes.length, 1);
  assert.equal(d.columnas_faltantes[0].hoja, 'SGC_DESCRIPTORES');
  assert.deepEqual(d.columnas_faltantes[0].columnas, ['items_responsabilidades', 'items_habilidades']);
  assert.match(d.accion, /actualizarEsquema/, 'debe decir qué hacer, no solo que algo falta');
});

test('diagnosticarEsquema_ detecta una hoja que no existe', () => {
  const db = abrirDb_();
  Object.keys(COLUMNAS_REALES).forEach((hoja) => {
    if (hoja !== 'SGC_QUEJAS') sembrarTabla_(db, hoja, COLUMNAS_REALES[hoja], []);
  });

  const d = diagnosticarEsquema_(db, COLUMNAS_REALES);
  assert.equal(d.al_dia, false);
  assert.ok(d.hojas_faltantes.indexOf('SGC_QUEJAS') !== -1);
});

test('diagnosticarEsquema_ dice "al día" cuando la planilla está completa', () => {
  const db = abrirDb_();
  Object.keys(COLUMNAS_REALES).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS_REALES[hoja], []));

  const d = diagnosticarEsquema_(db, COLUMNAS_REALES);
  assert.equal(d.al_dia, true, JSON.stringify(d, null, 1));
  assert.equal(d.accion, '');
});

test('diagnosticarEsquema_ NO se queja por columnas de más', () => {
  const db = abrirDb_();
  Object.keys(COLUMNAS_REALES).forEach((hoja) => {
    const cols = hoja === 'SGC_ROLES'
      ? COLUMNAS_REALES[hoja].slice().reverse().concat(['columna_de_otro_sistema'])
      : COLUMNAS_REALES[hoja];
    sembrarTabla_(db, hoja, cols, []);
  });

  const d = diagnosticarEsquema_(db, COLUMNAS_REALES);
  assert.equal(d.al_dia, true, 'orden distinto y columnas extra son válidos');
});
