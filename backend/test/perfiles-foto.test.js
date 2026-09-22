'use strict';

/**
 * Foto de perfil (Perfiles.gs v6.4, portada a Node+R2 2026-09-22). Escenarios
 * adaptados de backend/test/perfiles.test.js (el .gs, vía gasSandbox) --
 * NO se portan las secciones PERF/CACHE de ese archivo: existían para no
 * pagar cuota/latencia de SpreadsheetApp en cada avatar, un problema de
 * Sheets que no existe leyendo un SQLite local (ver la nota en la cabecera
 * de perfiles.js).
 *
 * Lo que estos tests protegen, por orden de importancia:
 *  1. QUE NADIE PUEDA TOCAR LA FOTO DE OTRO -- la identidad sale de
 *     `contexto`, nunca de `data` (hay tests que mandan a propósito
 *     email/cuenta_id/identidad_clave de otra persona).
 *  2. Que la validación sea por FIRMA BINARIA, nunca por el nombre/mime
 *     que declara el cliente.
 *  3. Que las dos poblaciones de identidad (GOOGLE y PORTAL) no se pisen,
 *     incluida la resolución por correo para los avatares en lote.
 *  4. Que lo que se devuelve sea un data URI listo para un <img src>
 *     (mismo contrato que esperaba el frontend en la era Sheets).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Perfiles = require('../logica/perfiles');
const Almacenamiento = require('../logica/almacenamiento');
const Router = require('../server/router');

// Imágenes reales de 1x1 con firma válida -- se usan bytes de verdad y no
// cadenas inventadas justamente porque lo que se prueba es la detección por
// firma binaria.
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const JPEG_1X1 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
// RIFF....WEBP: la firma de WebP va partida (bytes 0-3 y 8-11).
const WEBP_1X1 = 'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';

function b64(texto) {
  return Buffer.from(texto, 'binary').toString('base64');
}

// Mock de Almacenamiento (R2): un Map en memoria que se comporta como un
// bucket real -- lo subido es lo que se lee/borra de vuelta. Nunca pega a
// la red (mismo patrón que pausas-porteo.test.js).
function conMockAlmacenamiento_(t) {
  const bucket = new Map();
  t.mock.method(Almacenamiento, 'subirArchivo_', async (clave, contenidoBase64, contentType) => {
    bucket.set(clave, { contenidoBase64, contentType });
    return { ok: true, clave, tamano: Buffer.byteLength(contenidoBase64, 'base64') };
  });
  t.mock.method(Almacenamiento, 'eliminarArchivo_', async (clave) => {
    bucket.delete(clave);
    return { ok: true };
  });
  return bucket;
}

function db_() {
  const db = abrirDb_();
  ['USUARIOS', 'CUENTAS_PORTAL', 'SESIONES_PORTAL', 'CAT_EMPRESAS', 'PERFILES']
    .forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function seedUsuarioGoogle(db, overrides) {
  const base = Object.assign({
    usuario_id: 'u-1', nombre: 'Juan Pérez', email: 'juan@homepymes.cl',
    empresa_id: 'HP', rol: 'ANA', activo: true, ultimo_acceso: '', creado_por: 'adm@hp.cl'
  }, overrides);
  agregarFila_(db, 'USUARIOS', base);
  return base;
}
function seedCuentaPortal(db, overrides) {
  const base = Object.assign({
    cuenta_id: 'c-1', usuario: 'camila', nombre: 'Camila Soto', cargo: 'Analista',
    hash_password: 'x', salt: 'y', emails: JSON.stringify(['camila@rld.cl']),
    rol: 'DEV', modulos: JSON.stringify(['bandeja']), empresa_id: 'RLD',
    activo: true, debe_cambiar_password: false, ultimo_acceso: '', creado_por: 'adm@hp.cl'
  }, overrides);
  agregarFila_(db, 'CUENTAS_PORTAL', base);
  return base;
}
function seedSesionPortal(db, cuentaId, token) {
  agregarFila_(db, 'SESIONES_PORTAL', {
    token: token, cuenta_id: cuentaId,
    expira: new Date(Date.now() + 3600 * 1000).toISOString(), creada: new Date().toISOString()
  });
}

function ctxGoogle(email) {
  return { email: email || 'juan@homepymes.cl', rol: 'ANA' };
}
function ctxPortal(cuentaId, email) {
  return { email: email || 'camila@rld.cl', rol: 'DEV', modulos: ['bandeja'], via_portal: true, cuenta_id: cuentaId || 'c-1' };
}
function filasPerfiles_(db) {
  return leerFilas_(db, 'PERFILES', COLUMNAS.PERFILES);
}

function guardar(db, contexto, original, thumb) {
  return Perfiles.guardarFoto(db, { contenido_base64: original, thumb_base64: thumb || original || PNG_1X1 }, contexto);
}

// --- 1-4: las cuatro combinaciones identidad x tiene-foto -----------------

test('1. usuario Google SIN foto: perfil valido, tiene_foto=false', () => {
  const db = db_();
  seedUsuarioGoogle(db);
  agregarFila_(db, 'CAT_EMPRESAS', { empresa_id: 'HP', nombre: 'HomePymes', logo: '', activo: true });

  const perfil = Perfiles.getMiPerfil(db, {}, ctxGoogle());
  assert.equal(perfil.tiene_foto, false);
  assert.equal(perfil.foto_thumb, '');
});

test('2. usuario Google CON foto: devuelve la miniatura como data URI', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  seedUsuarioGoogle(db);
  await guardar(db, ctxGoogle(), PNG_1X1);

  const perfil = Perfiles.getMiPerfil(db, {}, ctxGoogle());
  assert.equal(perfil.tiene_foto, true);
  assert.match(perfil.foto_thumb, /^data:image\/png;base64,/);
});

test('3. usuario Portal SIN foto: se identifica por cuenta_id, no por correo', () => {
  const db = db_();
  seedCuentaPortal(db);
  agregarFila_(db, 'CAT_EMPRESAS', { empresa_id: 'RLD', nombre: 'RLD', logo: '', activo: true });

  const perfil = Perfiles.getMiPerfil(db, {}, ctxPortal());
  assert.equal(perfil.tiene_foto, false);
  assert.equal(perfil.nombre, 'Camila Soto');
  assert.equal(perfil.origen, 'PORTAL');
});

test('4. usuario Portal CON foto', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  seedCuentaPortal(db);
  await guardar(db, ctxPortal(), JPEG_1X1, JPEG_1X1);

  const perfil = Perfiles.getMiPerfil(db, {}, ctxPortal());
  assert.equal(perfil.tiene_foto, true);
  assert.match(perfil.foto_thumb, /^data:image\/jpeg;base64,/);
});

test('las dos poblaciones NO se pisan: misma persona, perfiles independientes', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  seedUsuarioGoogle(db, { email: 'mixto@hp.cl' });
  seedCuentaPortal(db, { cuenta_id: 'c-9', emails: JSON.stringify(['mixto@hp.cl']) });

  await guardar(db, ctxGoogle('mixto@hp.cl'), PNG_1X1);

  const portal = Perfiles.getMiPerfil(db, {}, ctxPortal('c-9', 'mixto@hp.cl'));
  assert.equal(portal.tiene_foto, false, 'la cuenta de portal, aunque comparte correo, sigue sin foto propia');
  assert.equal(filasPerfiles_(db).length, 1);
});

// --- 5-7: formatos aceptados ------------------------------------------------

test('5. sube JPG valido', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  seedUsuarioGoogle(db);
  const res = await guardar(db, ctxGoogle(), JPEG_1X1, JPEG_1X1);
  assert.equal(res.tiene_foto, true);
  assert.equal(filasPerfiles_(db)[0].thumb_mime, 'image/jpeg');
});

test('6. sube PNG valido', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  seedUsuarioGoogle(db);
  const res = await guardar(db, ctxGoogle(), PNG_1X1, PNG_1X1);
  assert.equal(res.tiene_foto, true);
  assert.equal(filasPerfiles_(db)[0].thumb_mime, 'image/png');
});

test('7. sube WebP valido (firma partida RIFF/WEBP)', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  seedUsuarioGoogle(db);
  const res = await guardar(db, ctxGoogle(), WEBP_1X1, WEBP_1X1);
  assert.equal(res.tiene_foto, true);
  assert.equal(filasPerfiles_(db)[0].thumb_mime, 'image/webp');
});

// --- 8-9: rechazos -----------------------------------------------------------

test('8. rechaza un original de mas de 5 MB', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  seedUsuarioGoogle(db);
  // PNG valido pero enorme: pasa la firma y debe caer por tamano.
  const gigante = Buffer.concat([Buffer.from(PNG_1X1, 'base64'), Buffer.alloc(5 * 1024 * 1024 + 10)]).toString('base64');

  const res = await guardar(db, ctxGoogle(), gigante);
  assert.equal(res._validationError, true);
  assert.match(res.message, /tamaño máximo/i);
  assert.equal(filasPerfiles_(db).length, 0);
});

test('9. rechaza contenido binario que NO es imagen aunque venga declarado como imagen', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  seedUsuarioGoogle(db);
  // MZ = ejecutable de Windows.
  const exe = await guardar(db, ctxGoogle(), b64('MZ\x90\x00\x03\x00\x00\x00ejecutable'));
  assert.equal(exe._validationError, true);
  assert.match(exe.message, /JPG, PNG o WebP/i);

  // SVG con script: es texto, la firma binaria lo descarta -- es el vector
  // que importa, porque el thumb acaba dentro de un <img> de la página.
  const svg = await guardar(db, ctxGoogle(), b64('<svg onload="alert(1)"></svg>'));
  assert.equal(svg._validationError, true);

  assert.equal(filasPerfiles_(db).length, 0);
});

test('9b. rechaza una miniatura que no sea imagen aunque el original si lo sea', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  seedUsuarioGoogle(db);
  const res = await guardar(db, ctxGoogle(), PNG_1X1, b64('<svg onload="alert(1)"></svg>'));
  assert.equal(res._validationError, true);
  assert.equal(filasPerfiles_(db).length, 0);
});

test('9c. el data URI se arma con el mime DETECTADO, no con el declarado', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  seedUsuarioGoogle(db);
  // El cliente miente diciendo que es svg+xml; el contenido real es PNG.
  const res = await Perfiles.guardarFoto(db, {
    contenido_base64: PNG_1X1, thumb_base64: PNG_1X1,
    foto_mime: 'image/svg+xml', tipo_mime: 'image/svg+xml'
  }, ctxGoogle());

  assert.match(res.foto_thumb, /^data:image\/png;base64,/);
  assert.doesNotMatch(res.foto_thumb, /svg/);
});

// --- 10-11: cambiar y eliminar -----------------------------------------------

test('10. cambiar foto reemplaza la miniatura: una sola fila, R2 sobrescrito (no acumula)', async (t) => {
  const db = db_();
  const bucket = conMockAlmacenamiento_(t);
  seedUsuarioGoogle(db);
  await guardar(db, ctxGoogle(), PNG_1X1, PNG_1X1);
  const primeraClave = filasPerfiles_(db)[0].original_clave;

  await guardar(db, ctxGoogle(), JPEG_1X1, JPEG_1X1);
  const filas = filasPerfiles_(db);

  assert.equal(filas.length, 1, 'una sola fila: se reemplaza, no se acumula');
  assert.equal(filas[0].thumb_mime, 'image/jpeg');
  assert.equal(filas[0].original_clave, primeraClave, 'la clave R2 es estable: se sobrescribe en el mismo lugar');
  assert.equal(bucket.size, 1, 'el bucket no acumula archivos huerfanos por cada version');
});

test('11. eliminar foto vacia la imagen pero CONSERVA la fila de identidad', async (t) => {
  const db = db_();
  const bucket = conMockAlmacenamiento_(t);
  seedUsuarioGoogle(db);
  await guardar(db, ctxGoogle(), PNG_1X1);

  const res = await Perfiles.eliminarFoto(db, {}, ctxGoogle());
  assert.equal(res.tiene_foto, false);
  assert.equal(res.foto_thumb, '');

  const filas = filasPerfiles_(db);
  assert.equal(filas.length, 1, 'la identidad no se borra');
  assert.equal(filas[0].identidad_tipo, 'GOOGLE');
  assert.equal(filas[0].identidad_clave, 'juan@homepymes.cl');
  assert.equal(filas[0].thumb_base64, '');
  assert.equal(bucket.size, 0, 'el original tambien se borra de R2');

  // Y el usuario sigue existiendo intacto en su fuente de verdad.
  assert.equal(leerFilas_(db, 'USUARIOS', COLUMNAS.USUARIOS).length, 1);
});

test('11b. eliminar sin foto previa no falla', async () => {
  const db = db_();
  seedUsuarioGoogle(db);
  const res = await Perfiles.eliminarFoto(db, {}, ctxGoogle());
  assert.equal(res.tiene_foto, false);
});

// --- 12-13: seguridad ---------------------------------------------------------

test('12. sin identidad en el contexto, toda accion es forbidden', async () => {
  const db = db_();
  seedUsuarioGoogle(db);
  assert.equal(Perfiles.getMiPerfil(db, {}, {})._forbidden, true);
  assert.equal((await Perfiles.guardarFoto(db, { contenido_base64: PNG_1X1, thumb_base64: PNG_1X1 }, {}))._forbidden, true);
  assert.equal((await Perfiles.eliminarFoto(db, {}, {}))._forbidden, true);
  assert.equal(Perfiles.getFotosDe(db, { emails: ['juan@homepymes.cl'] }, {})._forbidden, true);

  // Un contexto de portal sin cuenta_id tampoco sirve.
  const sinCuenta = Perfiles.getMiPerfil(db, {}, { email: 'x@y.cl', via_portal: true });
  assert.equal(sinCuenta._forbidden, true);
});

test('13. SEGURIDAD: los identificadores enviados por el cliente se ignoran', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  seedUsuarioGoogle(db, { email: 'juan@homepymes.cl' });
  seedUsuarioGoogle(db, { usuario_id: 'u-2', nombre: 'Otra', email: 'otra@homepymes.cl' });

  // Juan intenta, por todos los nombres de parametro imaginables, escribir
  // sobre el perfil de "otra".
  await Perfiles.guardarFoto(db, {
    contenido_base64: PNG_1X1, thumb_base64: PNG_1X1,
    email: 'otra@homepymes.cl', usuario_id: 'u-2', cuenta_id: 'c-1',
    identidad_clave: 'otra@homepymes.cl', identidad_tipo: 'GOOGLE', perfil_id: 'cualquiera'
  }, ctxGoogle('juan@homepymes.cl'));

  const filas = filasPerfiles_(db);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].identidad_clave, 'juan@homepymes.cl',
    'la foto debe quedar en el perfil de QUIEN LLAMA, no en el que pidio el cliente');

  const otra = Perfiles.getMiPerfil(db, {}, ctxGoogle('otra@homepymes.cl'));
  assert.equal(otra.tiene_foto, false, 'y "otra" sigue sin foto');
});

test('13b. el email de la identidad se normaliza (mayusculas/espacios no crean otro perfil)', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  seedUsuarioGoogle(db);
  await guardar(db, ctxGoogle('juan@homepymes.cl'), PNG_1X1);
  await guardar(db, ctxGoogle('  JUAN@HomePymes.CL  '), JPEG_1X1, JPEG_1X1);

  assert.equal(filasPerfiles_(db).length, 1, 'no debe crearse un segundo perfil por diferencias de mayusculas');
});

// --- 14: avatares en lote -----------------------------------------------------

test('14. getFotosDe resuelve por correo en AMBAS poblaciones, en una llamada', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  seedUsuarioGoogle(db);
  seedCuentaPortal(db, { emails: JSON.stringify(['camila@rld.cl', 'c.soto@rld.cl']) });
  await guardar(db, ctxGoogle(), PNG_1X1, PNG_1X1);
  await guardar(db, ctxPortal(), JPEG_1X1, JPEG_1X1);

  const res = Perfiles.getFotosDe(db,
    { emails: ['juan@homepymes.cl', 'camila@rld.cl', 'c.soto@rld.cl', 'nadie@x.cl'] }, ctxGoogle());

  assert.match(res.fotos['juan@homepymes.cl'], /^data:image\/png/);
  assert.match(res.fotos['camila@rld.cl'], /^data:image\/jpeg/, 'la cuenta de portal se resuelve por su lista de correos');
  assert.match(res.fotos['c.soto@rld.cl'], /^data:image\/jpeg/, 'cualquier correo de la cuenta sirve');
  assert.equal(res.fotos['nadie@x.cl'], undefined, 'quien no tiene foto simplemente no aparece');
});

test('14b. getFotosDe devuelve SOLO miniaturas: nada de ids, correos ni roles', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  seedUsuarioGoogle(db);
  await guardar(db, ctxGoogle(), PNG_1X1);

  const res = Perfiles.getFotosDe(db, { emails: ['juan@homepymes.cl'] }, ctxGoogle());
  assert.deepEqual(Object.keys(res), ['fotos']);
  assert.equal(typeof res.fotos['juan@homepymes.cl'], 'string');

  const serializado = JSON.stringify(res);
  ['perfil_id', 'identidad_clave', 'usuario_id', 'cuenta_id', 'rol']
    .forEach((campo) => assert.doesNotMatch(serializado, new RegExp(campo)));
});

test('14c. getFotosDe con lista vacia no falla y no revela nada', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  seedUsuarioGoogle(db);
  await guardar(db, ctxGoogle(), PNG_1X1);
  assert.deepEqual(Perfiles.getFotosDe(db, { emails: [] }, ctxGoogle()).fotos, {});
  assert.deepEqual(Perfiles.getFotosDe(db, {}, ctxGoogle()).fotos, {});
});

// --- 15: bordes ----------------------------------------------------------------

test('15. usuario sin fila en PERFILES no rompe: responde como "sin foto"', () => {
  const db = db_();
  seedUsuarioGoogle(db, { email: 'nuevo@hp.cl', nombre: 'Nuevo' });
  const perfil = Perfiles.getMiPerfil(db, {}, ctxGoogle('nuevo@hp.cl'));
  assert.equal(perfil.tiene_foto, false);
  assert.equal(filasPerfiles_(db).length, 0, 'consultar no debe crear filas');
});

test('16. la foto persiste entre sesiones (vive en la tabla, no en la sesion)', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  seedCuentaPortal(db);
  await guardar(db, ctxPortal('c-1'), PNG_1X1);

  // Nueva "sesion" = mismo contexto reconstruido, misma cuenta.
  const despues = Perfiles.getMiPerfil(db, {}, ctxPortal('c-1'));
  assert.equal(despues.tiene_foto, true);
  assert.match(despues.foto_thumb, /^data:image\/png/);
});

// --- El camino real, extremo a extremo por el router (ejecutarAccion) ---------

test('router: un token de portal valido puede gestionar SU foto (sin exigir modulo)', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  seedCuentaPortal(db, { modulos: JSON.stringify([]) }); // sin ningun modulo
  seedSesionPortal(db, 'c-1', 'tok-1');

  const respuesta = await Router.ejecutarAccion(db, 'guardarFotoPerfil',
    { portal_token: 'tok-1', contenido_base64: PNG_1X1, thumb_base64: PNG_1X1 });

  assert.equal(respuesta.body.ok, true);
  assert.equal(respuesta.body.data.tiene_foto, true);
  assert.equal(filasPerfiles_(db)[0].identidad_clave, 'c-1', 'quedo asociada a la cuenta del token, no a otra cosa');
});

test('router: un token invalido no puede tocar ninguna foto', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  seedCuentaPortal(db);
  seedSesionPortal(db, 'c-1', 'tok-1');

  const respuesta = await Router.ejecutarAccion(db, 'guardarFotoPerfil',
    { portal_token: 'token-falso', contenido_base64: PNG_1X1, thumb_base64: PNG_1X1 });

  assert.equal(respuesta.body.ok, false);
  assert.equal(respuesta.body.error, 'forbidden');
  assert.equal(filasPerfiles_(db).length, 0);
});
