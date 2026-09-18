'use strict';

/**
 * Tests de almacenamiento.js (cliente R2). No pega a la red real -- mockea
 * `globalThis.fetch`, que es lo único que `aws4fetch` llama internamente
 * (confirmado leyendo su fuente: `AwsClient.fetch` hace `fetch(await
 * this.sign(...))` sin importar su propio fetch, así que reemplazar el
 * global alcanza sin tocar la librería).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const ENV_KEYS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_ENDPOINT'];

function limpiarEnv_() {
  ENV_KEYS.forEach((k) => delete process.env[k]);
}
function configurarEnv_(t) {
  process.env.R2_ACCOUNT_ID = 'cuenta-test';
  process.env.R2_ACCESS_KEY_ID = 'clave-test';
  process.env.R2_SECRET_ACCESS_KEY = 'secreto-test';
  process.env.R2_BUCKET = 'bucket-test';
  t.after(limpiarEnv_);
}
function mockFetch_(t, impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  t.after(() => { globalThis.fetch = original; });
}
// Cada test requiere el módulo fresco: el cliente interno se cachea por
// accessKeyId dentro del proceso, y distintos tests usan distinta clave de
// mock -- requerir con una cache limpia evita que un test vea el cliente
// cacheado de otro.
function almacenamientoFresco_() {
  delete require.cache[require.resolve('../logica/almacenamiento')];
  return require('../logica/almacenamiento');
}

test('disponible_ da false sin las variables de entorno configuradas', () => {
  limpiarEnv_();
  const Almacenamiento = almacenamientoFresco_();
  assert.equal(Almacenamiento.disponible_(), false);
});

test('disponible_ da true con las cuatro variables configuradas', (t) => {
  configurarEnv_(t);
  const Almacenamiento = almacenamientoFresco_();
  assert.equal(Almacenamiento.disponible_(), true);
});

test('subirArchivo_ sin configurar devuelve el mismo mensaje que ya usan los módulos gateados', async () => {
  limpiarEnv_();
  const Almacenamiento = almacenamientoFresco_();
  const r = await Almacenamiento.subirArchivo_('x/y.pdf', 'aG9sYQ==', 'application/pdf');
  assert.equal(r.ok, false);
  assert.equal(r.message, Almacenamiento.MENSAJE_NO_CONFIGURADO);
});

test('subirArchivo_ rechaza contenido vacío o no-base64 antes de llamar a la red', async (t) => {
  configurarEnv_(t);
  let llamadas = 0;
  mockFetch_(t, async () => { llamadas++; return new Response('', { status: 200 }); });
  const Almacenamiento = almacenamientoFresco_();

  const sinContenido = await Almacenamiento.subirArchivo_('x/y.pdf', '', 'application/pdf');
  assert.equal(sinContenido.ok, false);
  assert.match(sinContenido.message, /falta el contenido/i);
  assert.equal(llamadas, 0, 'no debe llamar a R2 si la validación previa falla');
});

test('subirArchivo_ hace PUT a la URL del objeto y decodifica el base64 al tamaño correcto', async (t) => {
  configurarEnv_(t);
  const llamadas = [];
  // aws4fetch firma la petición y llama a fetch(new Request(...)) con un
  // solo argumento -- no (url, init) por separado.
  mockFetch_(t, async (req) => {
    const body = Buffer.from(await req.arrayBuffer());
    llamadas.push({ url: req.url, method: req.method, bodyLength: body.length });
    return new Response('', { status: 200 });
  });
  const Almacenamiento = almacenamientoFresco_();

  const r = await Almacenamiento.subirArchivo_('novedades/N1/foto.png', Buffer.from('contenido real').toString('base64'), 'image/png');

  assert.equal(r.ok, true);
  assert.equal(r.tamano, Buffer.byteLength('contenido real'));
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].method, 'PUT');
  assert.match(llamadas[0].url, /bucket-test\/novedades\/N1\/foto\.png$/);
  assert.equal(llamadas[0].bodyLength, Buffer.byteLength('contenido real'));
});

test('subirArchivo_ propaga un fallo de R2 como error legible, no como excepción', async (t) => {
  configurarEnv_(t);
  mockFetch_(t, async () => new Response('boom', { status: 500 }));
  const Almacenamiento = almacenamientoFresco_();

  const r = await Almacenamiento.subirArchivo_('x/y.pdf', Buffer.from('a').toString('base64'), 'application/pdf');
  assert.equal(r.ok, false);
  assert.match(r.message, /500/);
});

test('descargarArchivo_ devuelve el contenido en base64 y el content-type', async (t) => {
  configurarEnv_(t);
  mockFetch_(t, async () => new Response(Buffer.from('hola mundo'), { status: 200, headers: { 'content-type': 'text/plain' } }));
  const Almacenamiento = almacenamientoFresco_();

  const r = await Almacenamiento.descargarArchivo_('x/y.txt');
  assert.equal(r.ok, true);
  assert.equal(Buffer.from(r.contenido_base64, 'base64').toString('utf8'), 'hola mundo');
  assert.equal(r.content_type, 'text/plain');
});

test('descargarArchivo_ distingue "no existe" (404) de un error real de R2', async (t) => {
  configurarEnv_(t);
  mockFetch_(t, async () => new Response('', { status: 404 }));
  const Almacenamiento = almacenamientoFresco_();

  const r = await Almacenamiento.descargarArchivo_('no/existe.txt');
  assert.equal(r.ok, false);
  assert.match(r.message, /no existe/i);
});

test('eliminarArchivo_ es idempotente: un 404 de R2 no se trata como error', async (t) => {
  configurarEnv_(t);
  mockFetch_(t, async () => new Response('', { status: 404 }));
  const Almacenamiento = almacenamientoFresco_();

  const r = await Almacenamiento.eliminarArchivo_('ya/no/esta.txt');
  assert.equal(r.ok, true, 'borrar algo que ya no existe no es un error');
});

test('eliminarArchivo_ SI reporta un error real (500) de R2', async (t) => {
  configurarEnv_(t);
  mockFetch_(t, async () => new Response('', { status: 500 }));
  const Almacenamiento = almacenamientoFresco_();

  const r = await Almacenamiento.eliminarArchivo_('x/y.txt');
  assert.equal(r.ok, false);
});
