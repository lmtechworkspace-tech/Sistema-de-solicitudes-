'use strict';

/**
 * Prueba del nucleo HTTP del backend Node (backend/server/app.js).
 *
 * Ata el servidor al puerto 0 (efimero) para no chocar con nada y hace
 * peticiones reales por HTTP. Valida el contrato { ok, data } que el frontend
 * ya espera, para que la migracion desde Apps Script sea transparente.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { crearServidor } = require('../server/app');

function pedir(server, metodo, ruta) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request({ host: '127.0.0.1', port, method: metodo, path: ruta }, (res) => {
      let cuerpo = '';
      res.on('data', (c) => { cuerpo += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: cuerpo ? JSON.parse(cuerpo) : null }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function conServidor(fn) {
  const server = crearServidor();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    return await fn(server);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('/v1/estado responde 200 con la forma { ok, data } y estado activo', async () => {
  await conServidor(async (server) => {
    const { status, json } = await pedir(server, 'GET', '/v1/estado');
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.data.servicio, 'SIGSO API');
    assert.equal(json.data.estado, 'activo');
    assert.ok(json.data.version, 'debe reportar version');
  });
});

test('la raiz "/" tambien responde el smoke-test (sin login)', async () => {
  await conServidor(async (server) => {
    const { status, json } = await pedir(server, 'GET', '/');
    assert.equal(status, 200);
    assert.equal(json.ok, true);
  });
});

test('una ruta desconocida responde 404 con { ok:false, error }', async () => {
  await conServidor(async (server) => {
    const { status, json } = await pedir(server, 'GET', '/no-existe');
    assert.equal(status, 404);
    assert.equal(json.ok, false);
    assert.match(json.error, /no encontrada/i);
  });
});

test('OPTIONS (preflight CORS) responde 204', async () => {
  await conServidor(async (server) => {
    const { status } = await pedir(server, 'OPTIONS', '/v1/estado');
    assert.equal(status, 204);
  });
});
