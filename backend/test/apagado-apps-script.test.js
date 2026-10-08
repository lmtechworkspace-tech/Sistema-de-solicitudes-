'use strict';

/**
 * Apagado de Apps Script (2026-09-27): las 3 acciones que solo existían en el
 * Intake (.gs) y ahora sirve Node -- subirArchivo (adjuntos de solicitudes a
 * R2 + enlace con llave), getClientes (ahora con sesión) y crearQuejaSgc
 * (formulario público de quejas). Pruebas de lógica y de punta a punta por HTTP.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { crearServidor } = require('../server/app');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Almacenamiento = require('../logica/almacenamiento');
const Resend = require('../logica/resend');
const Archivos = require('../logica/archivosSolicitud');
const Quejas = require('../logica/quejasSgc');

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>', 'binary').toString('base64');
const ZIP = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0]).toString('base64');

function dbBase() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  agregarFila_(db, 'SOLICITUDES', {
    solicitud_id: 'SOL-1', solicitante_email: 'ana@cliente.cl', es_cliente: true, correo_cliente: 'jefe@cliente.cl'
  });
  return db;
}
function conBucket(t) {
  const bucket = new Map();
  t.mock.method(Almacenamiento, 'subirArchivo_', async (clave, b64, mime) => { bucket.set(clave, { b64, mime }); return { ok: true, clave }; });
  t.mock.method(Almacenamiento, 'descargarArchivo_', async (clave) => {
    const o = bucket.get(clave);
    return o ? { ok: true, contenido_base64: o.b64, content_type: o.mime } : { ok: false, message: 'no existe' };
  });
  t.mock.method(Almacenamiento, 'eliminarArchivo_', async (clave) => { bucket.delete(clave); return { ok: true }; });
  return bucket;
}
function conCorreo(t) {
  process.env.RESEND_API_KEY = 're_test_key';
  const mock = t.mock.method(Resend, 'enviarCorreoResend_', async () => ({ id: 'x' }));
  t.after(() => { delete process.env.RESEND_API_KEY; });
  return mock;
}
function subir(db, extra) {
  return Archivos.subirArchivo(db, Object.assign({
    solicitud_id: 'SOL-1', subsolicitud_id: 'SOL-1-01', nombre_archivo: 'foto.png', contenido_base64: PNG_1X1, email: 'ana@cliente.cl'
  }, extra));
}

// --- subirArchivo ---------------------------------------------------------------

test('subirArchivo: el solicitante sube una imagen; queda en R2 y en ARCHIVOS con enlace con llave', async (t) => {
  const bucket = conBucket(t);
  const db = dbBase();
  const r = await subir(db);
  assert.ok(r.archivo_id, JSON.stringify(r));
  assert.equal(r.tipo_mime, 'image/png');
  assert.match(r.url, /\/v1\/archivo\/[0-9a-f-]{36}\?k=[\w-]{20,}$/);
  assert.ok(bucket.has('solicitudes/SOL-1/' + r.archivo_id));
  const fila = leerFilas_(db, 'ARCHIVOS', COLUMNAS.ARCHIVOS)[0];
  assert.equal(fila.url, r.url);
  assert.equal(fila.subsolicitud_id, 'SOL-1-01');
  assert.equal(fila.nombre_original, 'foto.png');
});

test('subirArchivo: el correo del cliente registrado también sirve; uno ajeno o vacío no', async (t) => {
  conBucket(t);
  const db = dbBase();
  assert.ok((await subir(db, { email: 'JEFE@cliente.cl ' })).archivo_id);
  assert.equal((await subir(db, { email: 'otro@x.cl' }))._forbidden, true);
  assert.equal((await subir(db, { email: '' }))._forbidden, true);
  assert.equal(leerFilas_(db, 'ARCHIVOS', COLUMNAS.ARCHIVOS).length, 1);
});

test('subirArchivo: el tipo se decide por la firma, no por la extensión', async (t) => {
  conBucket(t);
  const db = dbBase();
  // Texto con nombre .png: rechazado.
  assert.equal((await subir(db, { contenido_base64: Buffer.from('<script>alert(1)</script>').toString('base64') }))._validationError, true);
  // PDF real con nombre .docx: la familia no calza, rechazado.
  assert.equal((await subir(db, { nombre_archivo: 'x.docx', contenido_base64: PDF }))._validationError, true);
  // PDF y .xlsx (zip) bien nombrados: aceptados con su mime exacto.
  assert.equal((await subir(db, { nombre_archivo: 'a.pdf', contenido_base64: PDF })).tipo_mime, 'application/pdf');
  assert.equal((await subir(db, { nombre_archivo: 'b.xlsx', contenido_base64: ZIP })).tipo_mime,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});

test('subirArchivo: respeta tamaño máximo y cantidad por ítem', async (t) => {
  conBucket(t);
  const db = dbBase();
  const grande = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47]), Buffer.alloc(5 * 1024 * 1024)]).toString('base64');
  assert.match((await subir(db, { contenido_base64: grande })).message, /tamaño máximo/);
  for (let i = 0; i < 5; i++) assert.ok((await subir(db)).archivo_id);
  assert.match((await subir(db)).message, /máximo de 5/);
  // Otro ítem de la misma solicitud todavía puede.
  assert.ok((await subir(db, { subsolicitud_id: 'SOL-1-02' })).archivo_id);
});

test('subirArchivo: solicitud inexistente o datos incompletos', async (t) => {
  conBucket(t);
  const db = dbBase();
  assert.equal((await subir(db, { solicitud_id: 'SOL-9' }))._validationError, true);
  assert.equal((await subir(db, { contenido_base64: '' }))._validationError, true);
});

test('servirArchivo: con la llave correcta devuelve los bytes; con otra, nada', async (t) => {
  conBucket(t);
  const db = dbBase();
  const r = await subir(db);
  const llave = r.url.split('k=')[1];
  const ok = await Archivos.servirArchivo(db, r.archivo_id, llave);
  assert.equal(ok.mime, 'image/png');
  assert.equal(ok.buffer.toString('base64'), PNG_1X1);
  assert.equal(await Archivos.servirArchivo(db, r.archivo_id, llave.slice(0, -1) + (llave.endsWith('A') ? 'B' : 'A')), null);
  assert.equal(await Archivos.servirArchivo(db, r.archivo_id, ''), null);
  assert.equal(await Archivos.servirArchivo(db, '00000000-0000-0000-0000-000000000000', llave), null);
});

test('eliminarArchivo (público) también borra el objeto en R2', async (t) => {
  const bucket = conBucket(t);
  const db = dbBase();
  const r = await subir(db);
  const Publico = require('../logica/solicitudesPublico');
  const res = Publico.eliminarArchivo(db, { solicitud_id: 'SOL-1', archivo_id: r.archivo_id, email: 'ana@cliente.cl' });
  assert.equal(res.ok, true);
  await new Promise((ok) => setImmediate(ok));
  assert.equal(bucket.size, 0);
});

// --- crearQuejaSgc ----------------------------------------------------------------

test('crearQuejaSgc: registra RECIBIDA con correlativo y avisa al remitente y a los Encargados SGC', async (t) => {
  const correo = conCorreo(t);
  const db = dbBase();
  agregarFila_(db, 'SGC_ROLES', { rol_id: 'R1', usuario_email: 'sgc@empresa.cl', rol_sgc: 'ENCARGADO_SGC', activo: true });
  const r = await Quejas.crearPublica(db, {
    nombre_completo: 'María Pérez', email: 'maria@x.cl', tipo: 'QUEJA', area: 'RRHH',
    descripcion: 'La liquidación de este mes llegó con un error en las horas extra.'
  });
  assert.match(r.correlativo, /^Q-\d{4}-001$/);
  const fila = leerFilas_(db, 'SGC_QUEJAS', COLUMNAS.SGC_QUEJAS)[0];
  assert.equal(fila.estado, 'RECIBIDA');
  assert.equal(fila.canal, 'WEB');
  const destinos = correo.mock.calls.map((c) => JSON.stringify(c.arguments));
  assert.ok(destinos.some((d) => d.includes('maria@x.cl') && d.includes('SIGSO — Recibimos tu queja')));
  assert.ok(destinos.some((d) => d.includes('sgc@empresa.cl') && d.includes('Nueva queja recibida')));
  assert.ok(!destinos.some((d) => /homepymes/i.test(d)), 'no debe avisar a una casilla fija de empresa');
  const r2 = await Quejas.crearPublica(db, {
    nombre_completo: 'Otro', email: 'o@x.cl', tipo: 'FELICITACION', area: 'OTRO', descripcion: 'Muy buena atención del equipo, gracias.'
  });
  assert.match(r2.correlativo, /-002$/);
});

test('crearQuejaSgc: sin Encargado SGC, avisa a los Administradores', async (t) => {
  const correo = conCorreo(t);
  const db = dbBase();
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'A', usuario: 'adm', emails: JSON.stringify(['adm@empresa.cl']), rol: 'ADM', activo: true });
  await Quejas.crearPublica(db, { nombre_completo: 'X', email: 'x@x.cl', tipo: 'CONSULTA', area: 'OTRO', descripcion: 'Quisiera saber el horario de atención.' });
  assert.ok(correo.mock.calls.some((c) => JSON.stringify(c.arguments).includes('adm@empresa.cl')));
});

test('crearQuejaSgc: valida nombre, correo, tipo, área y largo de la descripción', async () => {
  const db = dbBase();
  const base = { nombre_completo: 'X', email: 'x@x.cl', tipo: 'QUEJA', area: 'RRHH', descripcion: 'Descripción suficientemente larga.' };
  for (const malo of [{ nombre_completo: '' }, { email: 'no-es-correo' }, { tipo: 'OTRA' }, { area: 'VENTAS' }, { descripcion: 'corta' }]) {
    assert.equal((await Quejas.crearPublica(db, Object.assign({}, base, malo)))._validationError, true, JSON.stringify(malo));
  }
  assert.equal(leerFilas_(db, 'SGC_QUEJAS', COLUMNAS.SGC_QUEJAS).length, 0);
});

// --- HTTP de punta a punta -----------------------------------------------------------

function pedir(server, metodo, ruta, cuerpo) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request({ host: '127.0.0.1', port, method: metodo, path: ruta, headers: { 'Content-Type': 'application/json' } }, (res) => {
      const partes = [];
      res.on('data', (c) => partes.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(partes) }));
    });
    req.on('error', reject);
    req.end(cuerpo ? JSON.stringify(cuerpo) : undefined);
  });
}
async function conServidor(db, fn) {
  const server = crearServidor(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { return await fn(server); } finally { await new Promise((r) => server.close(r)); }
}

test('HTTP: subirArchivo sin sesión + GET /v1/archivo sirve la imagen aislada', async (t) => {
  conBucket(t);
  const db = dbBase();
  await conServidor(db, async (server) => {
    const sub = await pedir(server, 'POST', '/v1/accion', { action: 'subirArchivo', data: {
      solicitud_id: 'SOL-1', nombre_archivo: 'foto.png', contenido_base64: PNG_1X1, email: 'ana@cliente.cl',
      // Opción B (2026-10-08): el correo se prueba con un pase (el que entrega crearSolicitud).
      pase_acceso: require('../logica/solicitudesPublico').crearPaseAcceso_('ana@cliente.cl', 'SOL-1') } });
    const json = JSON.parse(sub.buffer.toString());
    assert.equal(json.ok, true, sub.buffer.toString());
    const ruta = json.data.url.replace(/^https?:\/\/[^/]+/, '');
    const r = await pedir(server, 'GET', ruta);
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'image/png');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.match(r.headers['content-security-policy'], /sandbox/);
    assert.equal(r.buffer.toString('base64'), PNG_1X1);
    const sinLlave = await pedir(server, 'GET', ruta.split('?')[0]);
    assert.equal(sinLlave.status, 404);
  });
});

test('HTTP: getClientes exige sesión y devuelve solo clientes activos', async () => {
  const db = dbBase();
  agregarFila_(db, 'CAT_CLIENTES', { cliente_id: 'C1', razon_social: 'Activa SpA', rut: '76.000.000-1', activo: true });
  agregarFila_(db, 'CAT_CLIENTES', { cliente_id: 'C2', razon_social: 'Antigua Ltda', activo: false });
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'CT', usuario: 'u', emails: JSON.stringify(['u@x.cl']), rol: 'ANA', activo: true, modulos: '[]' });
  agregarFila_(db, 'SESIONES_PORTAL', { token: 'tok', cuenta_id: 'CT', expira: new Date(Date.now() + 3600000).toISOString(), creada: new Date().toISOString() });
  await conServidor(db, async (server) => {
    const anon = await pedir(server, 'POST', '/v1/accion', { action: 'getClientes', data: {} });
    assert.equal(anon.status, 403);
    const conSesion = JSON.parse((await pedir(server, 'POST', '/v1/accion', { action: 'getClientes', data: { portal_token: 'tok' } })).buffer.toString());
    assert.equal(conSesion.ok, true);
    assert.deepEqual(conSesion.data.map((c) => c.cliente_id), ['C1']);
  });
});

test('HTTP: crearQuejaSgc es pública', async (t) => {
  conCorreo(t);
  const db = dbBase();
  await conServidor(db, async (server) => {
    const r = JSON.parse((await pedir(server, 'POST', '/v1/accion', { action: 'crearQuejaSgc', data: {
      nombre_completo: 'X', email: 'x@x.cl', tipo: 'CONSULTA', area: 'OTRO', descripcion: 'Una consulta de más de veinte caracteres.' } })).buffer.toString());
    assert.equal(r.ok, true);
    assert.match(r.data.correlativo, /^Q-/);
  });
});
