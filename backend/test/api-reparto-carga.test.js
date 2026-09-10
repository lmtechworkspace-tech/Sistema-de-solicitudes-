'use strict';

/**
 * Reparto de carga del Backoffice por token (frontend/js/api.js).
 *
 * POR QUE. Apps Script serializa las ejecuciones de una misma cuenta. La
 * implementacion "por token" corre toda como una sola cuenta, asi que con
 * varias personas a la vez las llamadas hacen cola. La solucion $0 es
 * publicar el mismo proyecto desde varias cuentas y repartir el trafico. Si
 * ese reparto no fuera ESTABLE por usuario, cada llamada de una sesion caeria
 * en una cuenta distinta y se perderia el cache persistente de esa cuenta; si
 * no rotara en el reintento, una implementacion caida rompería a sus
 * usuarios en vez de sortearse.
 *
 * QUE FIJA:
 *   · pool vacio o de 1 -> se comporta EXACTO como antes (una sola URL).
 *   · pool de N -> cada token cae siempre en la misma URL (estable).
 *   · tokens distintos se reparten (no todos a la misma).
 *   · en el reintento se rota a la siguiente URL del pool.
 *   · la URL elegida es siempre una del pool, nunca otra.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const API_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'api.js'), 'utf8');

/**
 * Carga api.js en un contexto vm con los globals del navegador stubbeados.
 * `fetchImpl` decide que responde el transporte (para simular fallos).
 */
function cargarApi(cfg, tokenPortal, fetchImpl) {
  const llamadas = [];
  const almacen = { sigso_portal_token: tokenPortal || null, sigso_perf_log: null, sigso_debug_timing: null };

  const sandbox = {
    window: { SIGSO_CONFIG: cfg },
    localStorage: {
      getItem: (k) => (k in almacen ? almacen[k] : null),
      setItem: (k, v) => { almacen[k] = String(v); },
      removeItem: (k) => { delete almacen[k]; }
    },
    performance: { now: () => 0 },
    console: { info: () => {}, warn: () => {}, table: () => {} },
    setTimeout: (fn) => { fn(); return 0; },
    AbortController: function () { this.signal = {}; this.abort = () => {}; },
    fetch: function (url, opciones) {
      llamadas.push({ url, body: opciones && opciones.body });
      return Promise.resolve(fetchImpl ? fetchImpl(url, llamadas.length) : {
        text: () => Promise.resolve(JSON.stringify({ ok: true, data: {} }))
      });
    }
  };
  sandbox.window.localStorage = sandbox.localStorage;
  vm.createContext(sandbox);
  vm.runInContext(API_SRC, sandbox);
  return { sandbox, llamadas, almacen };
}

const URL_BASE = 'https://script.google.com/macros/s/AAA/exec';
const URL_TOKEN = 'https://script.google.com/macros/s/TOK1/exec';
const URL_TOK2 = 'https://script.google.com/macros/s/TOK2/exec';
const URL_TOK3 = 'https://script.google.com/macros/s/TOK3/exec';

test('sin URLs extra: se usa la unica BACKOFFICE_TOKEN_URL (comportamiento previo)', () => {
  const cfg = { BACKOFFICE_URL: URL_BASE, BACKOFFICE_TOKEN_URL: URL_TOKEN, BACKOFFICE_TOKEN_URLS: [] };
  const { sandbox } = cargarApi(cfg, 'tok-usuario-1');
  const pool = sandbox.construirPoolToken_(cfg);
  assert.equal(pool.length, 1);
  assert.equal(pool[0], URL_TOKEN);
  assert.equal(sandbox.elegirUrlToken_(pool, 'cualquier-token', 1), URL_TOKEN);
});

test('pool de 3: un token dado cae SIEMPRE en la misma URL', () => {
  const cfg = {
    BACKOFFICE_URL: URL_BASE, BACKOFFICE_TOKEN_URL: URL_TOKEN,
    BACKOFFICE_TOKEN_URLS: [URL_TOK2, URL_TOK3]
  };
  const { sandbox } = cargarApi(cfg, 'x');
  const pool = sandbox.construirPoolToken_(cfg);
  assert.equal(pool.length, 3);

  const elegida = sandbox.elegirUrlToken_(pool, 'token-de-lisseth', 1);
  for (let k = 0; k < 20; k++) {
    assert.equal(sandbox.elegirUrlToken_(pool, 'token-de-lisseth', 1), elegida,
      'el mismo token no puede saltar de despliegue entre llamadas');
  }
  assert.ok(pool.indexOf(elegida) !== -1, 'la URL elegida es del pool');
});

test('pool de 3: tokens distintos se reparten entre las tres URLs', () => {
  const cfg = {
    BACKOFFICE_URL: URL_BASE, BACKOFFICE_TOKEN_URL: URL_TOKEN,
    BACKOFFICE_TOKEN_URLS: [URL_TOK2, URL_TOK3]
  };
  const { sandbox } = cargarApi(cfg, 'x');
  const pool = sandbox.construirPoolToken_(cfg);

  const vistas = new Set();
  for (let k = 0; k < 60; k++) {
    vistas.add(sandbox.elegirUrlToken_(pool, 'sesion-' + k, 1));
  }
  assert.equal(vistas.size, 3, 'con 60 tokens distintos deberian tocarse las 3 URLs');
});

test('en el reintento se rota a la siguiente URL del pool', () => {
  const cfg = {
    BACKOFFICE_URL: URL_BASE, BACKOFFICE_TOKEN_URL: URL_TOKEN,
    BACKOFFICE_TOKEN_URLS: [URL_TOK2, URL_TOK3]
  };
  const { sandbox } = cargarApi(cfg, 'x');
  const pool = sandbox.construirPoolToken_(cfg);

  const i1 = sandbox.elegirUrlToken_(pool, 'tok', 1);
  const i2 = sandbox.elegirUrlToken_(pool, 'tok', 2);
  const i3 = sandbox.elegirUrlToken_(pool, 'tok', 3);
  assert.notEqual(i1, i2, 'intento 2 debe ir a otra URL');
  assert.notEqual(i2, i3, 'intento 3 debe ir a otra URL');
  assert.equal(sandbox.elegirUrlToken_(pool, 'tok', 4), i1, 'da la vuelta al pool');
});

test('end-to-end: una lectura que falla dos veces rota y termina en la 3a URL', async () => {
  const cfg = {
    BACKOFFICE_URL: URL_BASE, BACKOFFICE_TOKEN_URL: URL_TOKEN,
    BACKOFFICE_TOKEN_URLS: [URL_TOK2, URL_TOK3]
  };
  // Las dos primeras llamadas de red rechazan; la tercera responde ok.
  const { sandbox, llamadas } = cargarApi(cfg, 'tok-abc', function (url, n) {
    if (n < 3) return Promise.reject(new Error('transporte caido'));
    return { text: () => Promise.resolve(JSON.stringify({ ok: true, data: { pong: true } })) };
  });

  const r = await sandbox.llamarApi(URL_BASE, 'getDashboardData', {});
  assert.equal(r.ok, true);
  assert.equal(llamadas.length, 3, 'reintento de lectura: 3 intentos');
  const urls = llamadas.map((l) => l.url);
  assert.equal(new Set(urls).size, 3, 'los 3 intentos fueron a 3 despliegues distintos');
  urls.forEach((u) => assert.ok([URL_TOKEN, URL_TOK2, URL_TOK3].indexOf(u) !== -1));
  // el token viaja en el body en los tres
  llamadas.forEach((l) => assert.ok(l.body.indexOf('tok-abc') !== -1));
});

test('end-to-end: una ESCRITURA no rota -- va SIEMPRE a la cuenta primaria', async () => {
  const cfg = {
    BACKOFFICE_URL: URL_BASE, BACKOFFICE_TOKEN_URL: URL_TOKEN,
    BACKOFFICE_TOKEN_URLS: [URL_TOK2, URL_TOK3]
  };
  const okFetch = function () {
    return { text: () => Promise.resolve(JSON.stringify({ ok: true, data: {} })) };
  };
  // Se prueban varios tokens: una lectura los reparte, una escritura NO.
  for (const tok of ['tok-a', 'tok-b', 'tok-c', 'tok-d', 'tok-e']) {
    const { sandbox, llamadas } = cargarApi(cfg, tok, okFetch);
    await sandbox.llamarApi(URL_BASE, 'actualizarEstado', { x: 1 });
    assert.equal(llamadas.length, 1, 'escritura: un solo intento');
    assert.equal(llamadas[0].url, URL_TOKEN,
      'la escritura de ' + tok + ' tiene que ir a la primaria (poolToken[0]), no a otra cuenta -- ' +
      'el correo se manda en el request y debe salir siempre de la misma');
  }
});

test('end-to-end: una escritura que falla NO reintenta (podria duplicarse)', async () => {
  const cfg = { BACKOFFICE_URL: URL_BASE, BACKOFFICE_TOKEN_URL: URL_TOKEN, BACKOFFICE_TOKEN_URLS: [URL_TOK2] };
  const { sandbox, llamadas } = cargarApi(cfg, 'tok-abc', function () {
    return Promise.reject(new Error('transporte caido'));
  });
  await assert.rejects(sandbox.llamarApi(URL_BASE, 'actualizarEstado', { x: 1 }));
  assert.equal(llamadas.length, 1);
});

test('sin token de portal: la URL no se toca (intake / login Google)', async () => {
  const cfg = { BACKOFFICE_URL: URL_BASE, BACKOFFICE_TOKEN_URL: URL_TOKEN, BACKOFFICE_TOKEN_URLS: [URL_TOK2] };
  const { sandbox, llamadas } = cargarApi(cfg, null);
  await sandbox.llamarApi('https://script.google.com/macros/s/INTAKE/exec', 'getCatalogos', {});
  assert.equal(llamadas[0].url, 'https://script.google.com/macros/s/INTAKE/exec');
});
