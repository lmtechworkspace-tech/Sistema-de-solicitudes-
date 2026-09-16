'use strict';

/**
 * Prueba de integracion HTTP: POST /v1/accion con action=guardarCatalogo /
 * listarCatalogo, de punta a punta a traves del servidor real (no solo el
 * modulo de logica aislado, que ya se prueba en catalogos-porteo.test.js).
 * Equivalente al test "doPost action=guardarCatalogo responde ok:true
 * end-to-end" de catalogos-admin.test.js, con `contexto` ya resuelto (ver
 * la nota en server/router.js sobre por que todavia viaja explicito).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { crearServidor } = require('../server/app');
const { abrirDb_, sembrarTabla_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}

function post(server, ruta, cuerpo) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const datos = JSON.stringify(cuerpo);
    const req = http.request(
      { host: '127.0.0.1', port, method: 'POST', path: ruta, headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let cuerpoRes = '';
        res.on('data', (c) => { cuerpoRes += c; });
        res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(cuerpoRes) }));
      }
    );
    req.on('error', reject);
    req.end(datos);
  });
}

async function conServidor(db, fn) {
  const server = crearServidor(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    return await fn(server);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('POST /v1/accion guardarCatalogo responde ok:true end-to-end', async () => {
  const db = dbConSchema();
  await conServidor(db, async (server) => {
    const { status, json } = await post(server, '/v1/accion', {
      action: 'guardarCatalogo',
      data: { tipo: 'TIPO', registro: { tipo_id: 'ERR', nombre: 'Error', prioridad_default: 'P2', activo: true } },
      contexto: { email: 'admin@homepymes.cl', rol: 'ADM' }
    });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.data.tipo_id, 'ERR');
  });
});

test('POST /v1/accion listarCatalogo responde ok:true con los registros guardados', async () => {
  const db = dbConSchema();
  await conServidor(db, async (server) => {
    await post(server, '/v1/accion', {
      action: 'guardarCatalogo',
      data: { tipo: 'EMPRESA', registro: { empresa_id: 'HP', nombre: 'HomePymes', activo: true } },
      contexto: { email: 'admin@homepymes.cl', rol: 'ADM' }
    });
    const { status, json } = await post(server, '/v1/accion', {
      action: 'listarCatalogo',
      data: { tipo: 'EMPRESA' },
      contexto: { email: 'admin@homepymes.cl', rol: 'ADM' }
    });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.data.length, 1);
    assert.equal(json.data[0].empresa_id, 'HP');
  });
});

test('POST /v1/accion guardarCatalogo responde 403 para un rol sin permiso', async () => {
  const db = dbConSchema();
  await conServidor(db, async (server) => {
    const { status, json } = await post(server, '/v1/accion', {
      action: 'guardarCatalogo',
      data: { tipo: 'EMPRESA', registro: { empresa_id: 'HP', nombre: 'HomePymes', activo: true } },
      contexto: { email: 'analista@homepymes.cl', rol: 'ANA' }
    });
    assert.equal(status, 403);
    assert.equal(json.ok, false);
    assert.equal(json.error, 'forbidden');
  });
});

test('POST /v1/accion guardarCatalogo responde 400 sin el identificador (validacion)', async () => {
  const db = dbConSchema();
  await conServidor(db, async (server) => {
    const { status, json } = await post(server, '/v1/accion', {
      action: 'guardarCatalogo',
      data: { tipo: 'EMPRESA', registro: { nombre: 'Sin id' } },
      contexto: { email: 'admin@homepymes.cl', rol: 'ADM' }
    });
    assert.equal(status, 400);
    assert.equal(json.ok, false);
    assert.equal(json.error, 'validation');
  });
});

test('POST /v1/accion con una accion desconocida responde 404', async () => {
  const db = dbConSchema();
  await conServidor(db, async (server) => {
    const { status, json } = await post(server, '/v1/accion', { action: 'noExiste', data: {}, contexto: {} });
    assert.equal(status, 404);
    assert.match(json.error, /Acción desconocida/);
  });
});
