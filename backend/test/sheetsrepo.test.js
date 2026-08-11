'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadIntakeProject, loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

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

// v7.4b: regresion del bug real de produccion en Novedades (v6.7/v6.8) --
// agregarFila_ escribia por POSICION segun COLUMNAS[nombreHoja] (el esquema
// del CODIGO), asumiendo que coincide con el orden fisico de la hoja. Una
// hoja de instalacion vieja a la que nunca se le sincronizo un encabezado
// nuevo (el Instalador solo CREA hojas, no sincroniza las existentes) quedaba
// con cada valor nuevo UNA columna corrido respecto de lo que su encabezado
// decia -- "se publica bien" pero el ultimo campo del esquema (en el caso
// real, `activa`) queda invisible para las lecturas (por nombre). Ahora
// agregarFila_ escribe segun los encabezados REALES de la hoja, igual que
// ya hacian las lecturas y actualizarFilaPorId_.

test('agregarFila_ escribe alineado a los encabezados REALES aunque la hoja tenga columnas EXTRA sin encabezado del esquema', () => {
  const ctx = loadIntakeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'CAT_EMPRESAS', ['empresa_id', 'nombre', 'logo', 'activo', 'columna_futura'], []);
  ctx.agregarFila_('CAT_EMPRESAS', { empresa_id: 'HP', nombre: 'HomePymes', logo: '', activo: true });
  const filas = ctx.leerFilas_('CAT_EMPRESAS');
  assert.equal(filas.length, 1);
  assert.equal(filas[0].empresa_id, 'HP');
  assert.equal(filas[0].nombre, 'HomePymes');
  assert.equal(filas[0].activo, true);
  assert.equal(filas[0].columna_futura, ''); // no se toca, queda en su lugar
});

test('agregarFila_ NO corrompe columnas siguientes si a la hoja le falta un encabezado del esquema (regresion real: Novedades activa)', () => {
  const ctx = loadIntakeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  // Simula una hoja vieja: le falta 'logo' (existe en el esquema pero nunca
  // se sincronizo a esta hoja). Antes del fix, esto corria 'activo' una
  // columna y lo dejaba invisible.
  seedSheet(ctx, 'CAT_EMPRESAS', ['empresa_id', 'nombre', 'activo'], []);
  ctx.agregarFila_('CAT_EMPRESAS', { empresa_id: 'HP', nombre: 'HomePymes', logo: 'logo.png', activo: true });
  const filas = ctx.leerFilas_('CAT_EMPRESAS');
  assert.equal(filas.length, 1);
  assert.equal(filas[0].empresa_id, 'HP');
  assert.equal(filas[0].nombre, 'HomePymes');
  // 'logo' no tenia encabezado: su valor se descarta, pero NO corre a 'activo'.
  assert.equal(filas[0].activo, true);
});

test('agregarFila_ NO releega la hoja en escrituras sucesivas al mismo destino (v6.9, sin N+1)', () => {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES, []);
  ctx.leerFilas_('LOG_NOTIFICACIONES'); // fuerza la primera lectura (cachea)

  let lecturas = 0;
  const hoja = ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('LOG_NOTIFICACIONES');
  const getRangeOriginal = hoja.getRange.bind(hoja);
  hoja.getRange = function () {
    const rango = getRangeOriginal.apply(null, arguments);
    const getValuesOriginal = rango.getValues.bind(rango);
    rango.getValues = function () { lecturas++; return getValuesOriginal(); };
    return rango;
  };

  for (let i = 0; i < 5; i++) {
    ctx.agregarFila_('LOG_NOTIFICACIONES', { log_id: 'L' + i, timestamp: 't', evento: 'X' });
  }
  assert.equal(lecturas, 0, 'agregarFila_ no debe releer la hoja entre escrituras sucesivas');
  assert.equal(ctx.leerFilas_('LOG_NOTIFICACIONES').length, 5);
});
