'use strict';

/**
 * Prueba de integracion HTTP: POST /v1/accion con action=guardarCatalogo /
 * listarCatalogo, de punta a punta a traves del servidor real -- ahora con
 * identidad resuelta por sesion real (portal_token), no por un `contexto`
 * mandado directo en el cuerpo (ese camino se cerro a proposito, ver
 * router.js: cualquiera podia declararse ADM). Cada test siembra una cuenta
 * de CUENTAS_PORTAL + una sesion vigente en SESIONES_PORTAL, como haria un
 * login real.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { crearServidor } = require('../server/app');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}

/** Siembra una cuenta activa con sesion vigente y devuelve el token. */
function sembrarSesion(db, { rol, email }) {
  const cuentaId = 'CTA-' + rol + '-' + Math.random().toString(36).slice(2, 8);
  const token = 'tok-' + cuentaId;
  agregarFila_(db, 'CUENTAS_PORTAL', {
    cuenta_id: cuentaId, usuario: cuentaId.toLowerCase(), nombre: 'Test ' + rol, cargo: '',
    hash_password: 'x', salt: 'x', emails: JSON.stringify([email]), rol: rol,
    modulos: JSON.stringify(['administracion']), empresa_id: 'HP', activo: true,
    debe_cambiar_password: false, ultimo_acceso: '', creado_por: 'test'
  });
  agregarFila_(db, 'SESIONES_PORTAL', {
    token: token, cuenta_id: cuentaId,
    expira: new Date(Date.now() + 3600000).toISOString(), creada: new Date().toISOString()
  });
  return token;
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

test('POST /v1/accion guardarCatalogo responde ok:true end-to-end con sesion valida', async () => {
  const db = dbConSchema();
  const token = sembrarSesion(db, { rol: 'ADM', email: 'admin@homepymes.cl' });
  await conServidor(db, async (server) => {
    const { status, json } = await post(server, '/v1/accion', {
      action: 'guardarCatalogo',
      data: { tipo: 'TIPO', registro: { tipo_id: 'ERR', nombre: 'Error', prioridad_default: 'P2', activo: true }, portal_token: token }
    });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.data.tipo_id, 'ERR');
  });
});

test('POST /v1/accion listarCatalogo responde ok:true con los registros guardados', async () => {
  const db = dbConSchema();
  const token = sembrarSesion(db, { rol: 'ADM', email: 'admin@homepymes.cl' });
  await conServidor(db, async (server) => {
    await post(server, '/v1/accion', {
      action: 'guardarCatalogo',
      data: { tipo: 'EMPRESA', registro: { empresa_id: 'HP', nombre: 'HomePymes', activo: true }, portal_token: token }
    });
    const { status, json } = await post(server, '/v1/accion', {
      action: 'listarCatalogo',
      data: { tipo: 'EMPRESA', portal_token: token }
    });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.data.length, 1);
    assert.equal(json.data[0].empresa_id, 'HP');
  });
});

test('POST /v1/accion guardarCatalogo responde 403 para un rol sin permiso', async () => {
  const db = dbConSchema();
  const token = sembrarSesion(db, { rol: 'ANA', email: 'analista@homepymes.cl' });
  await conServidor(db, async (server) => {
    const { status, json } = await post(server, '/v1/accion', {
      action: 'guardarCatalogo',
      data: { tipo: 'EMPRESA', registro: { empresa_id: 'HP', nombre: 'HomePymes', activo: true }, portal_token: token }
    });
    assert.equal(status, 403);
    assert.equal(json.ok, false);
    assert.equal(json.error, 'forbidden');
  });
});

test('POST /v1/accion guardarCatalogo responde 400 sin el identificador (validacion)', async () => {
  const db = dbConSchema();
  const token = sembrarSesion(db, { rol: 'ADM', email: 'admin@homepymes.cl' });
  await conServidor(db, async (server) => {
    const { status, json } = await post(server, '/v1/accion', {
      action: 'guardarCatalogo',
      data: { tipo: 'EMPRESA', registro: { nombre: 'Sin id' }, portal_token: token }
    });
    assert.equal(status, 400);
    assert.equal(json.ok, false);
    assert.equal(json.error, 'validation');
  });
});

test('POST /v1/accion con una accion desconocida responde 404', async () => {
  const db = dbConSchema();
  await conServidor(db, async (server) => {
    const { status, json } = await post(server, '/v1/accion', { action: 'noExiste', data: {} });
    assert.equal(status, 404);
    assert.match(json.error, /Acción desconocida/);
  });
});

test('POST /v1/accion guardarCatalogo SIN token responde 403 (ya no se confia en un contexto mandado por el cliente)', async () => {
  const db = dbConSchema();
  await conServidor(db, async (server) => {
    // Intento de saltarse la auth mandando el rol directo, como aceptaba la
    // version anterior del router -- ahora debe ser ignorado por completo.
    const { status, json } = await post(server, '/v1/accion', {
      action: 'guardarCatalogo',
      data: { tipo: 'EMPRESA', registro: { empresa_id: 'HACK', nombre: 'x', activo: true } },
      contexto: { email: 'nadie@x.cl', rol: 'ADM' }
    });
    assert.equal(status, 403);
    assert.equal(json.error, 'forbidden');
  });
});

test('POST /v1/accion con portal_token invalido responde 403', async () => {
  const db = dbConSchema();
  await conServidor(db, async (server) => {
    const { status, json } = await post(server, '/v1/accion', {
      action: 'listarCatalogo',
      data: { tipo: 'EMPRESA', portal_token: 'no-existe' }
    });
    assert.equal(status, 403);
    assert.equal(json.error, 'forbidden');
  });
});
