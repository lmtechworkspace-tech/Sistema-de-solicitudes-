'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function makeEvent(body) {
  return { postData: { contents: JSON.stringify(body), type: 'text/plain' } };
}

function loadBackoffice(options) {
  return loadBackofficeProject(
    Object.assign({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } }, options)
  );
}

function seedUsuario(ctx, email, rol, activo) {
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Usuario de prueba', email, 'HP', rol, activo !== false, '', 'sistema']
  ]);
}

test('doPost rechaza la llamada si Session no resuelve un email de dominio', () => {
  const ctx = loadBackoffice({ activeUserEmail: '' });
  const output = ctx.doPost(makeEvent({ action: 'ping' }));
  const parsed = JSON.parse(output.getContent());

  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, 'forbidden');
});

test('doPost rechaza si el email no esta registrado (o inactivo) en USUARIOS', () => {
  const ctx = loadBackoffice({ activeUserEmail: 'desconocido@homepymes.cl' });
  seedUsuario(ctx, 'otro@homepymes.cl', 'ANA');

  const output = ctx.doPost(makeEvent({ action: 'ping' }));
  const parsed = JSON.parse(output.getContent());

  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, 'forbidden');
});

test('doPost responde ok:true a action=ping con identidad y rol resueltos', () => {
  const ctx = loadBackoffice({ activeUserEmail: 'analista@homepymes.cl' });
  seedUsuario(ctx, 'analista@homepymes.cl', 'ANA');

  const output = ctx.doPost(makeEvent({ action: 'ping', data: {} }));
  const parsed = JSON.parse(output.getContent());

  assert.equal(output.getMimeType(), ctx.ContentService.MimeType.JSON);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.usuario, 'analista@homepymes.cl');
  assert.equal(parsed.data.rol, 'ANA');
  assert.equal(parsed.data.tz, 'America/Santiago');
});

test('doPost responde error de validacion para una accion desconocida', () => {
  const ctx = loadBackoffice({ activeUserEmail: 'admin@rld.cl' });
  seedUsuario(ctx, 'admin@rld.cl', 'ADM');

  const output = ctx.doPost(makeEvent({ action: 'accionInexistente' }));
  const parsed = JSON.parse(output.getContent());

  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, 'validation');
});

test('doGet responde estado activo (health-check)', () => {
  const ctx = loadBackoffice({ activeUserEmail: 'admin@rld.cl' });
  const output = ctx.doGet({});
  const parsed = JSON.parse(output.getContent());

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.servicio, 'SIGSO Backoffice');
});
