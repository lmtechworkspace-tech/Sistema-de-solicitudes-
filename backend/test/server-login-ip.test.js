'use strict';

/**
 * Prueba de integracion HTTP: confirma que app.js extrae la IP real del
 * cliente desde X-Forwarded-For (que Caddy fija, ver la cabecera de
 * index.js -- Node nunca recibe una conexion directa) y la hace llegar
 * hasta el bloqueo anti fuerza bruta de sesiones.js. Sin este viaje
 * completo, el fix de portal.js/sesiones.js (bloqueo por usuario+IP) queda
 * sin probar en el unico punto donde la IP existe de verdad: la peticion
 * HTTP.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { crearServidor } = require('../server/app');
const { abrirDb_, sembrarTabla_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const CuentasPortal = require('../logica/cuentasPortal');

const ADMIN = { email: 'admin@homepymes.cl', rol: 'ADM' };

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}

function post(server, ruta, cuerpo, headers) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const datos = JSON.stringify(cuerpo);
    const req = http.request(
      { host: '127.0.0.1', port, method: 'POST', path: ruta, headers: Object.assign({ 'Content-Type': 'application/json' }, headers) },
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

test('POST /v1/accion portalLogin: el bloqueo por intentos fallidos respeta X-Forwarded-For, no solo el usuario', async () => {
  const db = dbConSchema();
  const creada = CuentasPortal.gestionar(db, {
    operacion: 'crear', usuario: 'http-ip-test', nombre: 'X', emails: 'x@x.cl'
  }, ADMIN);

  await conServidor(db, async (server) => {
    // El atacante, desde SU IP (203.0.113.9), agota el limite.
    for (let i = 0; i < 5; i++) {
      await post(server, '/v1/accion',
        { action: 'portalLogin', data: { usuario: 'http-ip-test', password: 'mala-' + i } },
        { 'X-Forwarded-For': '203.0.113.9' });
    }
    const atacante = await post(server, '/v1/accion',
      { action: 'portalLogin', data: { usuario: 'http-ip-test', password: 'otra-mas' } },
      { 'X-Forwarded-For': '203.0.113.9' });
    assert.match(atacante.json.message || atacante.json.error, /Demasiados intentos/, 'el atacante queda bloqueado en su propia IP');

    // La victima, desde OTRA IP, entra normal con la clave real -- la IP
    // llego de verdad desde el header HTTP hasta el bloqueo, o esta
    // peticion tambien fallaria.
    const victima = await post(server, '/v1/accion',
      { action: 'portalLogin', data: { usuario: 'http-ip-test', password: creada.password_temporal } },
      { 'X-Forwarded-For': '198.51.100.7' });
    assert.ok(victima.json.data && victima.json.data.token, 'la victima entra desde su propia IP: ' + JSON.stringify(victima.json));
  });
});
