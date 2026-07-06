'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, toPlain } = require('./helpers/gasSandbox');

const TODOS_LOS_TRIGGERS = [
  'enviarReporteMensualTrigger', 'enviarResumenSemanalTrigger', 'procesarColaCorreoTrigger',
  'procesarColaDocumentosTrigger', 'refrescarCacheTrigger', 'suspenderInactivosTrigger', 'verificarSLAsTrigger'
];

test('configurarTriggers instala los 7 triggers de tiempo de §13/§16.3 (Fase 4 + Fase 7)', () => {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  const creados = toPlain(ctx.configurarTriggers());

  assert.deepEqual(creados.sort(), TODOS_LOS_TRIGGERS);

  const nombres = ctx.ScriptApp.getProjectTriggers().map((t) => t.getHandlerFunction()).sort();
  assert.deepEqual(nombres, TODOS_LOS_TRIGGERS);
});

test('configurarTriggers es idempotente: correrla dos veces no duplica triggers', () => {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  ctx.configurarTriggers();
  const segundaCorrida = toPlain(ctx.configurarTriggers());

  assert.deepEqual(segundaCorrida, []);
  assert.equal(ctx.ScriptApp.getProjectTriggers().length, TODOS_LOS_TRIGGERS.length);
});
