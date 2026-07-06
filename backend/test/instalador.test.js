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
