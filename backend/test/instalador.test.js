'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadGasProject, toPlain } = require('./helpers/gasSandbox');

function loadInstalador(options) {
  const dir = path.join(__dirname, '..', 'setup');
  return loadGasProject([path.join(dir, 'Config.gs'), path.join(dir, 'Instalador.gs')], options);
}

test('instalarHojas crea todas las hojas del esquema con sus headers', () => {
  const ctx = loadInstalador({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  const creadas = ctx.instalarHojas();

  const nombresEsperados = Object.keys(ctx.ESQUEMA_HOJAS);
  assert.deepEqual(toPlain(creadas).sort(), nombresEsperados.sort());

  const ss = ctx.SpreadsheetApp.openById('fake-sheet-id');
  nombresEsperados.forEach((nombre) => {
    const hoja = ss.getSheetByName(nombre);
    assert.ok(hoja, 'debe existir la hoja ' + nombre);
    const headers = hoja.getRange(1, 1, 1, ctx.ESQUEMA_HOJAS[nombre].length).getValues()[0];
    assert.deepEqual(headers, toPlain(ctx.ESQUEMA_HOJAS[nombre]));
  });
});

test('instalarHojas siembra CONFIG_SLA con las horas por prioridad de §7.2', () => {
  const ctx = loadInstalador({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  ctx.instalarHojas();

  const ss = ctx.SpreadsheetApp.openById('fake-sheet-id');
  const hoja = ss.getSheetByName('CONFIG_SLA');
  const filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, 2).getValues();

  assert.deepEqual(filas, [['P1', 2], ['P2', 24], ['P3', 72], ['P4', 120], ['P5', '']]);
});

test('instalarHojas es idempotente: correrlo dos veces no duplica hojas ni pisa datos', () => {
  const ctx = loadInstalador({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  ctx.instalarHojas();

  const ss = ctx.SpreadsheetApp.openById('fake-sheet-id');
  ss.getSheetByName('COUNTERS').appendRow(['HP', 2026, 7]);

  const segundaCorrida = ctx.instalarHojas();

  assert.deepEqual(toPlain(segundaCorrida), []);
  const filasCounters = ss.getSheetByName('COUNTERS').getRange(2, 1, 1, 3).getValues();
  assert.deepEqual(filasCounters, [['HP', 2026, 7]]);
});

// --- actualizar el esquema de una planilla que ya esta en produccion -------
// Esto es lo que faltaba: instalarHojas solo CREABA hojas nuevas, asi que
// una version que agregaba una columna dejaba la hoja existente con el
// encabezado viejo. Al pegar datos con el formato nuevo quedaban corridos y
// el modulo mostraba la ficha vacia, sin ningun error visible.

test('actualizarEsquema agrega a una hoja existente las columnas que le faltan', () => {
  const ctx = loadInstalador({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  const ss = ctx.SpreadsheetApp.openById('fake-sheet-id');

  // Hoja con el esquema ANTERIOR a la Tanda A (sin los dos items_*).
  const viejo = toPlain(ctx.ESQUEMA_HOJAS.SGC_DESCRIPTORES)
    .filter((c) => c !== 'items_responsabilidades' && c !== 'items_habilidades');
  const hoja = ss.insertSheet('SGC_DESCRIPTORES');
  hoja.appendRow(viejo);
  hoja.appendRow(viejo.map((c) => (c === 'descriptor_id' ? 'SGCD-01' : 'dato-' + c)));

  const reporte = ctx.actualizarEsquema();

  assert.deepEqual(toPlain(reporte.ampliadas).SGC_DESCRIPTORES,
    ['items_responsabilidades', 'items_habilidades'],
    'debe agregar exactamente las dos que faltaban');

  const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  toPlain(ctx.ESQUEMA_HOJAS.SGC_DESCRIPTORES).forEach((col) => {
    assert.ok(headers.indexOf(col) !== -1, 'debe existir la columna ' + col);
  });
});

test('actualizarEsquema NO mueve los datos ya cargados al agregar columnas', () => {
  const ctx = loadInstalador({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  const ss = ctx.SpreadsheetApp.openById('fake-sheet-id');

  const viejo = toPlain(ctx.ESQUEMA_HOJAS.SGC_DESCRIPTORES)
    .filter((c) => c !== 'items_responsabilidades' && c !== 'items_habilidades');
  const hoja = ss.insertSheet('SGC_DESCRIPTORES');
  hoja.appendRow(viejo);
  const filaOriginal = viejo.map((c, i) => 'v' + i);
  hoja.appendRow(filaOriginal);

  ctx.actualizarEsquema();

  // La fila de datos sigue exactamente donde estaba: las columnas nuevas se
  // agregan al final, no se inserta nada en medio.
  const leida = hoja.getRange(2, 1, 1, viejo.length).getValues()[0];
  assert.deepEqual(leida, filaOriginal);
});

test('actualizarEsquema es idempotente: la segunda corrida no agrega nada', () => {
  const ctx = loadInstalador({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  ctx.actualizarEsquema();
  const segunda = ctx.actualizarEsquema();

  assert.deepEqual(toPlain(segunda.creadas), []);
  assert.deepEqual(Object.keys(toPlain(segunda.ampliadas)), []);
});

test('actualizarEsquema completa el encabezado de una hoja creada a mano y vacia', () => {
  const ctx = loadInstalador({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  const ss = ctx.SpreadsheetApp.openById('fake-sheet-id');
  ss.insertSheet('SGC_QUEJAS'); // existe pero sin encabezado

  ctx.actualizarEsquema();

  const hoja = ss.getSheetByName('SGC_QUEJAS');
  const headers = hoja.getRange(1, 1, 1, ctx.ESQUEMA_HOJAS.SGC_QUEJAS.length).getValues()[0];
  assert.deepEqual(headers, toPlain(ctx.ESQUEMA_HOJAS.SGC_QUEJAS));
});
