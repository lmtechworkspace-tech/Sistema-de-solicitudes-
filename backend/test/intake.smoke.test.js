'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadGasProject } = require('./helpers/gasSandbox');

function makeEvent(body) {
  return { postData: { contents: JSON.stringify(body), type: 'text/plain' } };
}

function loadIntake(options) {
  const dir = path.join(__dirname, '..', 'intake');
  return loadGasProject([path.join(dir, 'Config.gs'), path.join(dir, 'Code.gs')], options);
}

test('doPost responde ok:true a action=ping (prueba de humo del contrato text/plain)', () => {
  const ctx = loadIntake({ scriptProperties: { SIGSO_TIMEZONE: 'America/Santiago' } });
  const output = ctx.doPost(makeEvent({ action: 'ping', data: {} }));
  const parsed = JSON.parse(output.getContent());

  assert.equal(output.getMimeType(), ctx.ContentService.MimeType.JSON);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.pong, true);
  assert.equal(parsed.data.tz, 'America/Santiago');
});

test('doPost usa America/Santiago por defecto si no hay Script Properties', () => {
  const ctx = loadIntake();
  const output = ctx.doPost(makeEvent({ action: 'ping' }));
  const parsed = JSON.parse(output.getContent());
  assert.equal(parsed.data.tz, 'America/Santiago');
});

test('doPost responde error de validacion para una accion desconocida', () => {
  const ctx = loadIntake();
  const output = ctx.doPost(makeEvent({ action: 'accionInexistente' }));
  const parsed = JSON.parse(output.getContent());

  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, 'validation');
  assert.deepEqual(parsed.fields, ['action']);
});

test('doPost responde error interno con ref si el body no es JSON valido', () => {
  const ctx = loadIntake();
  const badEvent = { postData: { contents: '{ esto no es json', type: 'text/plain' } };
  const output = ctx.doPost(badEvent);
  const parsed = JSON.parse(output.getContent());

  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, 'internal');
  assert.ok(parsed.ref, 'debe incluir una referencia de log');
});

test('doPost responde error interno si falta postData (contrato de transporte roto)', () => {
  const ctx = loadIntake();
  const output = ctx.doPost({});
  const parsed = JSON.parse(output.getContent());

  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, 'internal');
});

test('doGet responde estado activo (health-check)', () => {
  const ctx = loadIntake();
  const output = ctx.doGet({});
  const parsed = JSON.parse(output.getContent());

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.servicio, 'SIGSO Intake');
});
