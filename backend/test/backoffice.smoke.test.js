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

test('doGet responde estado activo (health-check) sin parametro page', () => {
  const ctx = loadBackoffice({ activeUserEmail: 'admin@rld.cl' });
  const output = ctx.doGet({});
  const parsed = JSON.parse(output.getContent());

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.servicio, 'SIGSO Backoffice');
});

// Fase 8: ?page=app/admin sirve la UI real via HtmlService (mismo origen,
// evita el bloqueo de cookies de terceros de un fetch cross-origin).
test('doGet con page=app sirve App.html via HtmlService', () => {
  const ctx = loadBackoffice({ activeUserEmail: 'admin@rld.cl' });
  const output = ctx.doGet({ parameter: { page: 'app' } });

  assert.ok(output.getContent().indexOf('vista-dashboard') !== -1);
});

test('doGet con page=admin sirve Admin.html via HtmlService', () => {
  const ctx = loadBackoffice({ activeUserEmail: 'admin@rld.cl' });
  const output = ctx.doGet({ parameter: { page: 'admin' } });

  assert.ok(output.getContent().indexOf('admin-menu') !== -1);
});

test('ejecutarAccionBackoffice (puente de google.script.run) exige identidad y rol igual que doPost', () => {
  const ctx = loadBackoffice({ activeUserEmail: '' });
  const resultado = ctx.ejecutarAccionBackoffice('ping', {});

  assert.equal(resultado.ok, false);
  assert.equal(resultado.error, 'forbidden');
});

test('ejecutarAccionBackoffice responde ok:true a action=ping (mismo router que doPost)', () => {
  const ctx = loadBackoffice({ activeUserEmail: 'analista@homepymes.cl' });
  seedUsuario(ctx, 'analista@homepymes.cl', 'ANA');

  const resultado = ctx.ejecutarAccionBackoffice('ping', {});

  assert.equal(resultado.ok, true);
  assert.equal(resultado.data.usuario, 'analista@homepymes.cl');
  assert.equal(resultado.data.rol, 'ANA');
});

test('ejecutarAccionBackoffice responde error de validacion para una accion desconocida', () => {
  const ctx = loadBackoffice({ activeUserEmail: 'admin@rld.cl' });
  seedUsuario(ctx, 'admin@rld.cl', 'ADM');

  const resultado = ctx.ejecutarAccionBackoffice('accionInexistente', {});

  assert.equal(resultado.ok, false);
  assert.equal(resultado.error, 'validation');
});

// --- H-04: saber que hay desplegado ---------------------------------------
// El backend se pega a mano en Apps Script, asi que sin una marca no habia
// forma de saber si lo que corre es lo ultimo. Ya paso: la planilla quedo dos
// fases atras y solo se noto cuando unos datos entraron corridos de columna.

test('ping devuelve la version del backend, para poder compararla con la del sitio', () => {
  const ctx = loadBackoffice({ activeUserEmail: 'admin@homepymes.cl' });
  seedUsuario(ctx, 'admin@homepymes.cl', 'ADM');

  const parsed = JSON.parse(ctx.doPost(makeEvent({ action: 'ping', data: {} })).getContent());

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.version, ctx.VERSION_SIGSO);
  assert.match(String(parsed.data.version), /\d{4}-\d{2}-\d{2}/, 'la versión debe ser reconocible');
});

test('getEstadoSistema es solo del Admin: quien no despliega no necesita el diagnóstico', () => {
  const ctx = loadBackoffice({ activeUserEmail: 'gerente@homepymes.cl' });
  seedUsuario(ctx, 'gerente@homepymes.cl', 'GERENCIA');
  Object.keys(ctx.COLUMNAS).forEach((h) => {
    if (h !== 'USUARIOS') seedSheet(ctx, h, ctx.COLUMNAS[h]);
  });

  const parsed = JSON.parse(ctx.doPost(makeEvent({ action: 'getEstadoSistema', data: {} })).getContent());
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, 'forbidden');
});

test('getEstadoSistema le dice al Admin la versión y si la planilla está al día', () => {
  const ctx = loadBackoffice({ activeUserEmail: 'admin@homepymes.cl' });
  Object.keys(ctx.COLUMNAS).forEach((h) => seedSheet(ctx, h, ctx.COLUMNAS[h]));
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Admin', 'admin@homepymes.cl', 'HP', 'ADM', true, '', 'sistema']
  ]);

  const parsed = JSON.parse(ctx.doPost(makeEvent({ action: 'getEstadoSistema', data: {} })).getContent());

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.version_backend, ctx.VERSION_SIGSO);
  assert.equal(parsed.data.esquema.al_dia, true);
});
