'use strict';

/**
 * v6.4: foto de perfil (Perfiles.gs).
 *
 * Lo que estos tests protegen, por orden de importancia:
 *
 *  1. QUE NADIE PUEDA TOCAR LA FOTO DE OTRO. El modelo entero se apoya en
 *     que la identidad sale de `contexto` y no de `data`. Hay tests que
 *     mandan a proposito data.email/usuario_id/cuenta_id de otra persona y
 *     verifican que se ignoran por completo.
 *  2. Que la validacion sea por FIRMA BINARIA. Un ejecutable renombrado a
 *     .jpg, o un SVG con script, tienen que ser rechazados.
 *  3. Que las dos poblaciones de identidad (GOOGLE y PORTAL) funcionen sin
 *     pisarse, incluida la resolucion por correo para los avatares en lote.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

// Imagenes reales de 1x1 con firma valida. Se usan bytes de verdad y no
// cadenas inventadas justamente porque lo que se prueba es la deteccion por
// firma.
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const JPEG_1X1 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
// RIFF....WEBP: la firma de WebP va partida (bytes 0-3 y 8-11).
const WEBP_1X1 = 'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';

function b64(texto) {
  return Buffer.from(texto, 'binary').toString('base64');
}

function cargar() {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'root-folder-id' }
  });
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS);
  seedSheet(ctx, 'CUENTAS_PORTAL', ctx.COLUMNAS.CUENTAS_PORTAL);
  seedSheet(ctx, 'SESIONES_PORTAL', ctx.COLUMNAS.SESIONES_PORTAL);
  seedSheet(ctx, 'CAT_EMPRESAS', ctx.COLUMNAS.CAT_EMPRESAS);
  seedSheet(ctx, 'PERFILES', ctx.COLUMNAS.PERFILES);
  return ctx;
}

function agregar(ctx, hoja, obj) {
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName(hoja)
    .appendRow(ctx.COLUMNAS[hoja].map((c) => (obj[c] !== undefined ? obj[c] : '')));
}

function seedUsuarioGoogle(ctx, overrides) {
  const base = Object.assign({
    usuario_id: 'u-1', nombre: 'Juan Pérez', email: 'juan@homepymes.cl',
    empresa_id: 'HP', rol: 'ANA', activo: true, ultimo_acceso: '', creado_por: 'adm@hp.cl'
  }, overrides);
  agregar(ctx, 'USUARIOS', base);
  return base;
}

function seedCuentaPortal(ctx, overrides) {
  const base = Object.assign({
    cuenta_id: 'c-1', usuario: 'camila', nombre: 'Camila Soto', cargo: 'Analista',
    hash_password: 'x', salt: 'y', emails: JSON.stringify(['camila@rld.cl']),
    rol: 'DEV', modulos: JSON.stringify(['bandeja']), empresa_id: 'RLD',
    activo: true, debe_cambiar_password: false, ultimo_acceso: '', creado_por: 'adm@hp.cl'
  }, overrides);
  agregar(ctx, 'CUENTAS_PORTAL', base);
  return base;
}

function seedSesionPortal(ctx, cuentaId, token) {
  agregar(ctx, 'SESIONES_PORTAL', {
    token: token, cuenta_id: cuentaId,
    expira: new Date(Date.now() + 3600 * 1000).toISOString(),
    creada: new Date().toISOString()
  });
  return token;
}

// Contextos tal como los produce Code.gs. Se construyen a mano para poder
// probar Perfiles directamente, pero mas abajo hay tests que pasan por
// doPost real para verificar que Code.gs los arma igual.
function ctxGoogle(email) {
  return { email: email || 'juan@homepymes.cl', rol: 'ANA' };
}
function ctxPortal(cuentaId, email) {
  return {
    email: email || 'camila@rld.cl', rol: 'DEV',
    modulos: ['bandeja'], via_portal: true, cuenta_id: cuentaId || 'c-1'
  };
}

function guardar(ctx, contexto, original, thumb) {
  return toPlain(ctx.Perfiles.guardarFoto(
    { contenido_base64: original, thumb_base64: thumb || PNG_1X1 }, contexto
  ));
}

// --- 1-4: las cuatro combinaciones identidad x tiene-foto ----------------

test('1. usuario Google SIN foto: perfil valido, tiene_foto=false, sin miniatura', () => {
  const ctx = cargar();
  seedUsuarioGoogle(ctx);
  agregar(ctx, 'CAT_EMPRESAS', { empresa_id: 'HP', nombre: 'HomePymes', activo: true });

  const perfil = toPlain(ctx.Perfiles.getMiPerfil({}, ctxGoogle()));
  assert.equal(perfil.tiene_foto, false);
  assert.equal(perfil.foto_thumb, '');
  // Los datos de identidad salen de USUARIOS, no de PERFILES.
  assert.equal(perfil.nombre, 'Juan Pérez');
  assert.equal(perfil.email, 'juan@homepymes.cl');
  assert.equal(perfil.rol, 'ANA');
  assert.equal(perfil.empresa_nombre, 'HomePymes');
  assert.equal(perfil.origen, 'GOOGLE');
});

test('2. usuario Google CON foto: devuelve la miniatura guardada', () => {
  const ctx = cargar();
  seedUsuarioGoogle(ctx);
  guardar(ctx, ctxGoogle(), PNG_1X1);

  const perfil = toPlain(ctx.Perfiles.getMiPerfil({}, ctxGoogle()));
  assert.equal(perfil.tiene_foto, true);
  assert.match(perfil.foto_thumb, /^data:image\/png;base64,/);
});

test('3. usuario Portal SIN foto: se identifica por cuenta_id, no por correo', () => {
  const ctx = cargar();
  seedCuentaPortal(ctx);
  agregar(ctx, 'CAT_EMPRESAS', { empresa_id: 'RLD', nombre: 'RLD', activo: true });

  const perfil = toPlain(ctx.Perfiles.getMiPerfil({}, ctxPortal()));
  assert.equal(perfil.tiene_foto, false);
  assert.equal(perfil.nombre, 'Camila Soto');
  assert.equal(perfil.cargo, 'Analista');
  assert.equal(perfil.origen, 'PORTAL');
});

test('4. usuario Portal CON foto', () => {
  const ctx = cargar();
  seedCuentaPortal(ctx);
  guardar(ctx, ctxPortal(), JPEG_1X1, JPEG_1X1);

  const perfil = toPlain(ctx.Perfiles.getMiPerfil({}, ctxPortal()));
  assert.equal(perfil.tiene_foto, true);
  assert.match(perfil.foto_thumb, /^data:image\/jpeg;base64,/);
});

test('las dos poblaciones NO se pisan: misma persona, perfiles independientes', () => {
  const ctx = cargar();
  seedUsuarioGoogle(ctx, { email: 'mixto@hp.cl' });
  seedCuentaPortal(ctx, { cuenta_id: 'c-9', emails: JSON.stringify(['mixto@hp.cl']) });

  guardar(ctx, ctxGoogle('mixto@hp.cl'), PNG_1X1);

  // La cuenta de portal, aunque comparte correo, sigue sin foto propia.
  const portal = toPlain(ctx.Perfiles.getMiPerfil({}, ctxPortal('c-9', 'mixto@hp.cl')));
  assert.equal(portal.tiene_foto, false);
  assert.equal(ctx.leerFilas_('PERFILES').length, 1);
});

// --- 5-7: formatos aceptados ---------------------------------------------

test('5. sube JPG valido', () => {
  const ctx = cargar();
  seedUsuarioGoogle(ctx);
  const res = guardar(ctx, ctxGoogle(), JPEG_1X1, JPEG_1X1);
  assert.equal(res.tiene_foto, true);
  assert.equal(ctx.leerFilas_('PERFILES')[0].foto_mime, 'image/jpeg');
});

test('6. sube PNG valido', () => {
  const ctx = cargar();
  seedUsuarioGoogle(ctx);
  const res = guardar(ctx, ctxGoogle(), PNG_1X1, PNG_1X1);
  assert.equal(res.tiene_foto, true);
  assert.equal(ctx.leerFilas_('PERFILES')[0].foto_mime, 'image/png');
});

test('7. sube WebP valido (firma partida RIFF/WEBP)', () => {
  const ctx = cargar();
  seedUsuarioGoogle(ctx);
  const res = guardar(ctx, ctxGoogle(), WEBP_1X1, WEBP_1X1);
  assert.equal(res.tiene_foto, true);
  assert.equal(ctx.leerFilas_('PERFILES')[0].foto_mime, 'image/webp');
});

// --- 8-9: rechazos --------------------------------------------------------

test('8. rechaza un original de mas de 5 MB', () => {
  const ctx = cargar();
  seedUsuarioGoogle(ctx);
  // PNG valido pero enorme: pasa la firma y debe caer por tamano.
  const gigante = Buffer.concat([
    Buffer.from(PNG_1X1, 'base64'),
    Buffer.alloc(5 * 1024 * 1024 + 10)
  ]).toString('base64');

  const res = guardar(ctx, ctxGoogle(), gigante);
  assert.equal(res._validationError, true);
  assert.match(res.message, /tamano maximo/i);
  assert.equal(ctx.leerFilas_('PERFILES').length, 0);
});

test('9. rechaza contenido binario que NO es imagen aunque venga como .jpg', () => {
  const ctx = cargar();
  seedUsuarioGoogle(ctx);
  // MZ = ejecutable de Windows.
  const exe = guardar(ctx, ctxGoogle(), b64('MZ\x90\x00\x03\x00\x00\x00ejecutable'));
  assert.equal(exe._validationError, true);
  assert.match(exe.message, /JPG, PNG o WebP/i);

  // SVG con script: es texto, la firma binaria lo descarta. Es el vector
  // que importa, porque el thumb acaba dentro de un <img> de la pagina.
  const svg = guardar(ctx, ctxGoogle(), b64('<svg onload="alert(1)"></svg>'));
  assert.equal(svg._validationError, true);

  assert.equal(ctx.leerFilas_('PERFILES').length, 0);
});

test('9b. rechaza una miniatura que no sea imagen aunque el original si lo sea', () => {
  const ctx = cargar();
  seedUsuarioGoogle(ctx);
  const res = guardar(ctx, ctxGoogle(), PNG_1X1, b64('<svg onload="alert(1)"></svg>'));
  assert.equal(res._validationError, true);
  assert.equal(ctx.leerFilas_('PERFILES').length, 0);
});

test('9c. el data URI se arma con el mime DETECTADO, no con el declarado', () => {
  const ctx = cargar();
  seedUsuarioGoogle(ctx);
  // El cliente miente diciendo que es svg+xml; el contenido real es PNG.
  const res = toPlain(ctx.Perfiles.guardarFoto({
    contenido_base64: PNG_1X1, thumb_base64: PNG_1X1,
    foto_mime: 'image/svg+xml', tipo_mime: 'image/svg+xml'
  }, ctxGoogle()));

  assert.match(res.foto_thumb, /^data:image\/png;base64,/);
  assert.doesNotMatch(res.foto_thumb, /svg/);
});

// --- 10-11: cambiar y eliminar -------------------------------------------

test('10. cambiar foto reemplaza la miniatura y manda la anterior a la papelera', () => {
  const ctx = cargar();
  seedUsuarioGoogle(ctx);
  guardar(ctx, ctxGoogle(), PNG_1X1, PNG_1X1);
  const primerFileId = ctx.leerFilas_('PERFILES')[0].foto_file_id;

  guardar(ctx, ctxGoogle(), JPEG_1X1, JPEG_1X1);
  const filas = ctx.leerFilas_('PERFILES');

  // Una sola fila: se reemplaza, no se acumula.
  assert.equal(filas.length, 1);
  assert.equal(filas[0].foto_mime, 'image/jpeg');
  assert.notEqual(filas[0].foto_file_id, primerFileId);
  assert.equal(ctx.DriveApp.getFileById(primerFileId).isTrashed(), true);
});

test('11. eliminar foto vacia la imagen pero CONSERVA la fila de identidad', () => {
  const ctx = cargar();
  seedUsuarioGoogle(ctx);
  guardar(ctx, ctxGoogle(), PNG_1X1);
  const fileId = ctx.leerFilas_('PERFILES')[0].foto_file_id;

  const res = toPlain(ctx.Perfiles.eliminarFoto({}, ctxGoogle()));
  assert.equal(res.tiene_foto, false);
  assert.equal(res.foto_thumb, '');

  const fila = ctx.leerFilas_('PERFILES')[0];
  assert.equal(ctx.leerFilas_('PERFILES').length, 1, 'la identidad no se borra');
  assert.equal(fila.identidad_tipo, 'GOOGLE');
  assert.equal(fila.identidad_clave, 'juan@homepymes.cl');
  assert.equal(fila.foto_thumb, '');
  assert.equal(fila.foto_file_id, '');
  assert.equal(ctx.DriveApp.getFileById(fileId).isTrashed(), true);

  // Y el usuario sigue existiendo intacto en su fuente de verdad.
  assert.equal(ctx.leerFilas_('USUARIOS').length, 1);
});

test('11b. eliminar sin foto previa no falla', () => {
  const ctx = cargar();
  seedUsuarioGoogle(ctx);
  const res = toPlain(ctx.Perfiles.eliminarFoto({}, ctxGoogle()));
  assert.equal(res.tiene_foto, false);
});

// --- 12-13: seguridad -----------------------------------------------------

test('12. sin identidad en el contexto, toda accion es forbidden', () => {
  const ctx = cargar();
  ['getMiPerfil', 'guardarFoto', 'eliminarFoto', 'getFotosDe'].forEach((accion) => {
    const res = toPlain(ctx.Perfiles[accion]({ contenido_base64: PNG_1X1, thumb_base64: PNG_1X1 }, {}));
    assert.equal(res._forbidden, true, accion + ' deberia rechazar un contexto sin identidad');
  });
  // Un contexto de portal sin cuenta_id tampoco sirve.
  const sinCuenta = toPlain(ctx.Perfiles.getMiPerfil({}, { email: 'x@y.cl', via_portal: true }));
  assert.equal(sinCuenta._forbidden, true);
});

test('13. SEGURIDAD: los identificadores enviados por el cliente se ignoran', () => {
  const ctx = cargar();
  seedUsuarioGoogle(ctx, { email: 'juan@homepymes.cl' });
  seedUsuarioGoogle(ctx, { usuario_id: 'u-2', nombre: 'Otra', email: 'otra@homepymes.cl' });

  // Juan intenta, por todos los nombres de parametro imaginables, escribir
  // sobre el perfil de "otra".
  ctx.Perfiles.guardarFoto({
    contenido_base64: PNG_1X1, thumb_base64: PNG_1X1,
    email: 'otra@homepymes.cl', usuario_id: 'u-2', cuenta_id: 'c-1',
    identidad_clave: 'otra@homepymes.cl', identidad_tipo: 'GOOGLE',
    perfil_id: 'cualquiera'
  }, ctxGoogle('juan@homepymes.cl'));

  const filas = ctx.leerFilas_('PERFILES');
  assert.equal(filas.length, 1);
  assert.equal(filas[0].identidad_clave, 'juan@homepymes.cl',
    'la foto debe quedar en el perfil de QUIEN LLAMA, no en el que pidio el cliente');

  // Y "otra" sigue sin foto.
  const otra = toPlain(ctx.Perfiles.getMiPerfil({}, ctxGoogle('otra@homepymes.cl')));
  assert.equal(otra.tiene_foto, false);
});

test('13b. el email de la identidad se normaliza (mayusculas/espacios no crean otro perfil)', () => {
  const ctx = cargar();
  seedUsuarioGoogle(ctx);
  guardar(ctx, ctxGoogle('juan@homepymes.cl'), PNG_1X1);
  guardar(ctx, ctxGoogle('  JUAN@HomePymes.CL  '), JPEG_1X1, JPEG_1X1);

  assert.equal(ctx.leerFilas_('PERFILES').length, 1,
    'no debe crearse un segundo perfil por diferencias de mayusculas');
});

// --- 14: avatares en lote -------------------------------------------------

test('14. getFotosDe resuelve por correo en AMBAS poblaciones, en una llamada', () => {
  const ctx = cargar();
  seedUsuarioGoogle(ctx);
  seedCuentaPortal(ctx, { emails: JSON.stringify(['camila@rld.cl', 'c.soto@rld.cl']) });
  guardar(ctx, ctxGoogle(), PNG_1X1, PNG_1X1);
  guardar(ctx, ctxPortal(), JPEG_1X1, JPEG_1X1);

  const res = toPlain(ctx.Perfiles.getFotosDe({
    emails: ['juan@homepymes.cl', 'camila@rld.cl', 'c.soto@rld.cl', 'nadie@x.cl']
  }, ctxGoogle()));

  assert.match(res.fotos['juan@homepymes.cl'], /^data:image\/png/);
  assert.match(res.fotos['camila@rld.cl'], /^data:image\/jpeg/,
    'la cuenta de portal se resuelve por su lista de correos');
  assert.match(res.fotos['c.soto@rld.cl'], /^data:image\/jpeg/,
    'cualquier correo de la cuenta sirve');
  assert.equal(res.fotos['nadie@x.cl'], undefined, 'quien no tiene foto simplemente no aparece');
});

test('14b. getFotosDe devuelve SOLO miniaturas: nada de ids, nombres ni roles', () => {
  const ctx = cargar();
  seedUsuarioGoogle(ctx);
  guardar(ctx, ctxGoogle(), PNG_1X1);

  const res = toPlain(ctx.Perfiles.getFotosDe({ emails: ['juan@homepymes.cl'] }, ctxGoogle()));
  assert.deepEqual(Object.keys(res), ['fotos']);
  assert.equal(typeof res.fotos['juan@homepymes.cl'], 'string');

  const serializado = JSON.stringify(res);
  ['perfil_id', 'foto_file_id', 'identidad_clave', 'usuario_id', 'cuenta_id', 'rol']
    .forEach((campo) => assert.doesNotMatch(serializado, new RegExp(campo)));
});

test('14c. getFotosDe con lista vacia no falla y no revela nada', () => {
  const ctx = cargar();
  seedUsuarioGoogle(ctx);
  guardar(ctx, ctxGoogle(), PNG_1X1);
  assert.deepEqual(toPlain(ctx.Perfiles.getFotosDe({ emails: [] }, ctxGoogle())).fotos, {});
  assert.deepEqual(toPlain(ctx.Perfiles.getFotosDe({}, ctxGoogle())).fotos, {});
});

// --- 15-16: bordes --------------------------------------------------------

test('15. usuario sin fila en PERFILES no rompe: responde como "sin foto"', () => {
  const ctx = cargar();
  seedUsuarioGoogle(ctx, { email: 'nuevo@hp.cl', nombre: 'Nuevo' });
  const perfil = toPlain(ctx.Perfiles.getMiPerfil({}, ctxGoogle('nuevo@hp.cl')));
  assert.equal(perfil.tiene_foto, false);
  assert.equal(ctx.leerFilas_('PERFILES').length, 0, 'consultar no debe crear filas');
});

test('16. la foto persiste entre sesiones (vive en la hoja, no en la sesion)', () => {
  const ctx = cargar();
  seedCuentaPortal(ctx);
  guardar(ctx, ctxPortal('c-1'), PNG_1X1);

  // Nueva sesion = nuevo token, misma cuenta.
  const despues = toPlain(ctx.Perfiles.getMiPerfil({}, ctxPortal('c-1')));
  assert.equal(despues.tiene_foto, true);
  assert.match(despues.foto_thumb, /^data:image\/png/);
});

// --- El camino real, extremo a extremo por doPost -------------------------

test('doPost: un token de portal valido puede gestionar SU foto (sin exigir modulo)', () => {
  const ctx = cargar();
  seedCuentaPortal(ctx, { modulos: JSON.stringify([]) }); // sin ningun modulo
  seedSesionPortal(ctx, 'c-1', 'tok-1');

  const respuesta = JSON.parse(ctx.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'guardarFotoPerfil',
        data: { portal_token: 'tok-1', contenido_base64: PNG_1X1, thumb_base64: PNG_1X1 }
      })
    }
  }).getContent());

  assert.equal(respuesta.ok, true);
  assert.equal(respuesta.data.tiene_foto, true);
  // Y quedo asociada a la cuenta del token, no a otra cosa.
  assert.equal(ctx.leerFilas_('PERFILES')[0].identidad_clave, 'c-1');
});

test('doPost: un token invalido no puede tocar ninguna foto', () => {
  const ctx = cargar();
  seedCuentaPortal(ctx);
  seedSesionPortal(ctx, 'c-1', 'tok-1');

  const respuesta = JSON.parse(ctx.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'guardarFotoPerfil',
        data: { portal_token: 'token-falso', contenido_base64: PNG_1X1, thumb_base64: PNG_1X1 }
      })
    }
  }).getContent());

  assert.equal(respuesta.ok, false);
  assert.equal(respuesta.error, 'forbidden');
  assert.equal(ctx.leerFilas_('PERFILES').length, 0);
});

// --- Rendimiento: el cache de miniaturas (v6.4 optimizacion) -------------
//
// CONTEXTO DEL PROBLEMA QUE ESTO PREVIENE: leerFilas_(PERFILES) trae la hoja
// ENTERA, con TODAS las miniaturas base64. Sin cache, pintar un avatar
// obligaba a leer las fotos de todo el personal, y el costo crecia con cada
// foto nueva -- lo que se noto en produccion como "todo se puso lento
// despues de subir fotos al equipo".
//
// Estos tests cuentan LECTURAS REALES de la hoja envolviendo leerFilas_. Si
// alguien quita el cache, el contador sube y fallan.

function espiarLecturas_(ctx) {
  var conteo = { PERFILES: 0, total: 0 };
  var original = ctx.leerFilas_;
  ctx.leerFilas_ = function (hoja) {
    conteo.total++;
    if (hoja === 'PERFILES') conteo.PERFILES++;
    return original.apply(null, arguments);
  };
  return conteo;
}

test('PERF: con todo cacheado, getFotosDe NO lee la hoja PERFILES', () => {
  const ctx = cargar();
  seedUsuarioGoogle(ctx);
  guardar(ctx, ctxGoogle(), PNG_1X1);

  // Primera llamada: llena el cache (aqui SI se lee la hoja).
  toPlain(ctx.Perfiles.getFotosDe({ emails: ['juan@homepymes.cl'] }, ctxGoogle()));

  const conteo = espiarLecturas_(ctx);
  const res = toPlain(ctx.Perfiles.getFotosDe({ emails: ['juan@homepymes.cl'] }, ctxGoogle()));

  assert.equal(conteo.PERFILES, 0, 'la segunda llamada no debe leer PERFILES');
  assert.match(res.fotos['juan@homepymes.cl'], /^data:image\/png/,
    'y aun asi debe devolver la foto correcta');
});

test('PERF: el "no tiene foto" tambien se cachea (no se relee por cada render)', () => {
  const ctx = cargar();
  seedUsuarioGoogle(ctx);
  // Nadie tiene foto: el caso mas comun al principio.
  toPlain(ctx.Perfiles.getFotosDe({ emails: ['juan@homepymes.cl'] }, ctxGoogle()));

  const conteo = espiarLecturas_(ctx);
  const res = toPlain(ctx.Perfiles.getFotosDe({ emails: ['juan@homepymes.cl'] }, ctxGoogle()));

  assert.equal(conteo.PERFILES, 0, 'sin foto tambien debe salir del cache');
  assert.equal(res.fotos['juan@homepymes.cl'], undefined, 'y seguir sin devolver foto');
});

test('PERF: solo se lee la hoja por los correos que faltan, no por todo el lote', () => {
  const ctx = cargar();
  seedUsuarioGoogle(ctx);
  seedUsuarioGoogle(ctx, { usuario_id: 'u-2', nombre: 'Otra', email: 'otra@homepymes.cl' });
  guardar(ctx, ctxGoogle('juan@homepymes.cl'), PNG_1X1);
  guardar(ctx, ctxGoogle('otra@homepymes.cl'), JPEG_1X1, JPEG_1X1);

  // Se cachea solo uno de los dos.
  toPlain(ctx.Perfiles.getFotosDe({ emails: ['juan@homepymes.cl'] }, ctxGoogle()));

  const conteo = espiarLecturas_(ctx);
  const res = toPlain(ctx.Perfiles.getFotosDe(
    { emails: ['juan@homepymes.cl', 'otra@homepymes.cl'] }, ctxGoogle()
  ));

  // Falta uno -> se paga UNA lectura, no una por correo.
  assert.equal(conteo.PERFILES, 1, 'una sola lectura aunque falte mas de un correo');
  assert.match(res.fotos['juan@homepymes.cl'], /^data:image\/png/);
  assert.match(res.fotos['otra@homepymes.cl'], /^data:image\/jpeg/);
});

test('PERF: getMiPerfil no relee PERFILES cuando la miniatura propia esta cacheada', () => {
  const ctx = cargar();
  seedUsuarioGoogle(ctx);
  guardar(ctx, ctxGoogle(), PNG_1X1);
  toPlain(ctx.Perfiles.getMiPerfil({}, ctxGoogle()));   // llena el cache

  const conteo = espiarLecturas_(ctx);
  const perfil = toPlain(ctx.Perfiles.getMiPerfil({}, ctxGoogle()));

  assert.equal(conteo.PERFILES, 0, 'montar el header no debe releer todas las miniaturas');
  assert.equal(perfil.tiene_foto, true);
  assert.match(perfil.foto_thumb, /^data:image\/png/);
});

// --- Correccion: el cache NUNCA debe servir datos obsoletos --------------

test('CACHE: guardar una foto nueva invalida el cache (no se sirve la anterior)', () => {
  const ctx = cargar();
  seedUsuarioGoogle(ctx);
  guardar(ctx, ctxGoogle(), PNG_1X1, PNG_1X1);
  // Se cachea la PNG por los dos caminos.
  toPlain(ctx.Perfiles.getFotosDe({ emails: ['juan@homepymes.cl'] }, ctxGoogle()));
  toPlain(ctx.Perfiles.getMiPerfil({}, ctxGoogle()));

  // Se reemplaza por una JPEG.
  guardar(ctx, ctxGoogle(), JPEG_1X1, JPEG_1X1);

  const lote = toPlain(ctx.Perfiles.getFotosDe({ emails: ['juan@homepymes.cl'] }, ctxGoogle()));
  const propio = toPlain(ctx.Perfiles.getMiPerfil({}, ctxGoogle()));

  assert.match(lote.fotos['juan@homepymes.cl'], /^data:image\/jpeg/,
    'el lote debe devolver la foto NUEVA, no la cacheada');
  assert.match(propio.foto_thumb, /^data:image\/jpeg/,
    'el perfil propio tambien');
});

test('CACHE: eliminar la foto invalida el cache (deja de devolverse)', () => {
  const ctx = cargar();
  seedUsuarioGoogle(ctx);
  guardar(ctx, ctxGoogle(), PNG_1X1);
  toPlain(ctx.Perfiles.getFotosDe({ emails: ['juan@homepymes.cl'] }, ctxGoogle()));
  toPlain(ctx.Perfiles.getMiPerfil({}, ctxGoogle()));

  ctx.Perfiles.eliminarFoto({}, ctxGoogle());

  const lote = toPlain(ctx.Perfiles.getFotosDe({ emails: ['juan@homepymes.cl'] }, ctxGoogle()));
  const propio = toPlain(ctx.Perfiles.getMiPerfil({}, ctxGoogle()));

  assert.equal(lote.fotos['juan@homepymes.cl'], undefined, 'ya no debe venir en el lote');
  assert.equal(propio.tiene_foto, false, 'ni en el perfil propio');
});

test('CACHE: una cuenta PORTAL invalida TODOS sus correos, no solo el primero', () => {
  const ctx = cargar();
  seedCuentaPortal(ctx, { emails: JSON.stringify(['camila@rld.cl', 'c.soto@rld.cl']) });
  guardar(ctx, ctxPortal(), PNG_1X1, PNG_1X1);
  // Se cachean los dos correos de la cuenta.
  toPlain(ctx.Perfiles.getFotosDe(
    { emails: ['camila@rld.cl', 'c.soto@rld.cl'] }, ctxPortal()
  ));

  ctx.Perfiles.eliminarFoto({}, ctxPortal());

  const res = toPlain(ctx.Perfiles.getFotosDe(
    { emails: ['camila@rld.cl', 'c.soto@rld.cl'] }, ctxPortal()
  ));
  assert.equal(res.fotos['camila@rld.cl'], undefined);
  assert.equal(res.fotos['c.soto@rld.cl'], undefined,
    'el correo secundario tambien debe invalidarse, si no quedaria una foto fantasma');
});
