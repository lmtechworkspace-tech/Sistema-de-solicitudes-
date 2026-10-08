'use strict';

/**
 * Portal de clientes (2026-10-08): avisos al teléfono (Web Push) y «Mis documentos».
 * El servicio de avisos del navegador se simula reemplazando fetch.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { ejecutarAccion } = require('../server/router');
const Sesiones = require('../logica/sesiones');
const Push = require('../logica/portalPush');

delete process.env.RESEND_API_KEY;

const SUPER = 'luis@ctrly.cl', VANESSA = 'vanessa@homepymes.cl';

function dbPortal() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  sembrarTabla_(db, 'CONFIG_SLA', COLUMNAS.CONFIG_SLA, [['P1', 2], ['P2', 24], ['P3', 72], ['P4', 120], ['P5', '']]);
  sembrarTabla_(db, 'CAT_EMPRESAS', COLUMNAS.CAT_EMPRESAS, [['HP', 'HomePymes', '', true, '']]);
  const vacio = (hoja) => Object.fromEntries(COLUMNAS[hoja].map((c) => [c, '']));
  [['Luis', SUPER, 'ADM', true], ['Vanessa Sepúlveda', VANESSA, 'SOLICITANTE', false]]
    .forEach(([n, e, r, sa]) => agregarFila_(db, 'CUENTAS_PORTAL', Object.assign(vacio('CUENTAS_PORTAL'), {
      cuenta_id: 'c-' + e, usuario: e.split('@')[0], nombre: n, emails: JSON.stringify([e]), rol: r, activo: true, empresa_id: 'HP', super_admin: sa })));
  agregarFila_(db, 'CI_MIEMBROS', { miembro_id: 'm0', depto: 'RRHH', usuario_email: VANESSA, rol: 'JEFATURA', activa: true });
  [['CLI-1', 'Constructora Cerro Alto SpA', '76.543.210-K'], ['CLI-2', 'Constructora Vecina SpA', '77.777.777-7']]
    .forEach(([id, n, rut]) => agregarFila_(db, 'CAT_CLIENTES', Object.assign(vacio('CAT_CLIENTES'), { cliente_id: id, razon_social: n, rut, activo: true })));
  return db;
}
async function staff(db, email, action, data) {
  return ejecutarAccion(db, action, Object.assign({ portal_token: Sesiones.crearSesion(db, 'c-' + email) }, data || {}), { ip: '10.0.0.1' });
}
async function cliente(db, action, data) { return ejecutarAccion(db, action, data || {}, { ip: '200.1.1.1' }); }
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
async function activado(db, clienteId, rut, nombre) {
  await staff(db, SUPER, 'portalAdmGuardarCliente', { cliente_id: clienteId, habilitado: true, servicios: ['RRHH'], encargados: { RRHH: VANESSA } });
  const r = await staff(db, SUPER, 'portalAdmInvitar', { cliente_id: clienteId, nombre, rut, telefono: '9 5555 0099' });
  const a = await cliente(db, 'clienteActivar', { invitacion: r.body.data.enlace.split('#invitacion=')[1], pin: '482915', pin2: '482915' });
  return a.body.data.cliente_token;
}
function suscripcion(n) {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  return { endpoint: 'https://fcm.googleapis.com/fcm/send/telefono-' + n, keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
}
const esperar = () => new Promise((r) => setTimeout(r, 30));

function conFetchFalso(respuesta) {
  const llamadas = [], orig = global.fetch;
  global.fetch = async (url, opts) => { llamadas.push({ url, opts }); return { status: typeof respuesta === 'function' ? respuesta(url) : (respuesta || 201) }; };
  return { llamadas, restaurar: () => { global.fetch = orig; } };
}

test('avisos: solo a servicios de avisos de navegador, firmados y cifrados, y llegan a los teléfonos de la empresa', async () => {
  const db = dbPortal();
  const tok = await activado(db, 'CLI-1', '12.345.678-5', 'Pedro Sáez');
  const tokVecina = await activado(db, 'CLI-2', '11.111.111-1', 'Ana Vecina');
  // Un endpoint cualquiera (posible SSRF) no se acepta.
  const malo = await cliente(db, 'clientePushSuscribir', { cliente_token: tok, suscripcion: { endpoint: 'https://169.254.169.254/x', keys: suscripcion(0).keys } });
  assert.equal(malo.status, 400);
  assert.equal((await cliente(db, 'clientePushSuscribir', { cliente_token: tok, suscripcion: suscripcion(1), dispositivo: 'Android' })).status, 200);
  assert.equal((await cliente(db, 'clientePushSuscribir', { cliente_token: tokVecina, suscripcion: suscripcion(2) })).status, 200);
  assert.ok(filas(db, 'PORTAL_REGISTRO').some((x) => x.accion === 'AVISOS_ACTIVADOS'));
  const clave = (await cliente(db, 'clientePushClave', { cliente_token: tok })).body.data.publica;
  assert.equal(Buffer.from(clave, 'base64url').length, 65);

  const solId = (await cliente(db, 'clienteCrearPedido', { cliente_token: tok, plantilla_id: 'f30', datos: { mes: 'octubre', para: 'Inmobiliaria' } })).body.data.solicitud_id;
  const f = conFetchFalso(201);
  try {
    // El equipo escribe: le llega a Pedro (CLI-1), no a la empresa vecina.
    await staff(db, VANESSA, 'agregarComentario', { solicitud_id: solId, subsolicitud_id: solId + '-01', texto: '¿Para qué mes lo necesitas?', es_interno: false });
    await esperar();
    assert.equal(f.llamadas.length, 1, 'un aviso, al teléfono de la empresa del pedido');
    const ll = f.llamadas[0];
    assert.match(ll.url, /telefono-1$/);
    assert.equal(ll.opts.headers['Content-Encoding'], 'aes128gcm');
    assert.match(ll.opts.headers.Authorization, new RegExp('^vapid t=[^,]+, k=' + clave + '$'));
    assert.ok(!Buffer.from(ll.opts.body).toString('latin1').includes('mes lo necesitas'), 'el contenido viaja cifrado');
    // Una nota interna no avisa.
    await staff(db, VANESSA, 'agregarComentario', { solicitud_id: solId, texto: 'nota interna', es_interno: true });
    await esperar();
    assert.equal(f.llamadas.length, 1);
    // Listo para confirmar: avisa (mismo «tema» por pedido: el teléfono reemplaza el aviso anterior).
    const r = await staff(db, VANESSA, 'actualizarEstado', { subsolicitud_id: solId + '-01', estado_nuevo: 'S08', comentario: 'F30 listo' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await esperar();
    assert.ok(f.llamadas.length >= 2, 'aviso de listo');
    assert.equal(f.llamadas[f.llamadas.length - 1].opts.headers.Topic, solId.replace(/[^A-Za-z0-9_-]/g, ''));
  } finally { f.restaurar(); }

  // Contacto bloqueado: deja de recibir avisos.
  const pedro = filas(db, 'PORTAL_CONTACTOS').find((c) => c.cliente_id === 'CLI-1');
  actualizarFilaPorId_(db, 'PORTAL_CONTACTOS', 'contacto_id', pedro.contacto_id, { estado: 'BLOQUEADO' });
  const f2 = conFetchFalso(201);
  try {
    assert.deepEqual(await Push.avisarPedido(db, solId, { titulo: 'x', cuerpo: 'y' }), { enviados: 0 });
    assert.equal(f2.llamadas.length, 0);
  } finally { f2.restaurar(); }
});

test('avisos: el navegador dio de baja la suscripción (410) → no se vuelve a intentar; «apagar» y la prueba', async () => {
  const db = dbPortal();
  const tok = await activado(db, 'CLI-1', '12.345.678-5', 'Pedro Sáez');
  const s1 = suscripcion(1);
  await cliente(db, 'clientePushSuscribir', { cliente_token: tok, suscripcion: s1 });
  const solId = (await cliente(db, 'clienteCrearPedido', { cliente_token: tok, plantilla_id: 'f30', datos: { mes: 'octubre' } })).body.data.solicitud_id;
  let f = conFetchFalso(201);
  try { assert.equal((await cliente(db, 'clientePushProbar', { cliente_token: tok, endpoint: s1.endpoint })).status, 200); } finally { f.restaurar(); }
  f = conFetchFalso(410);
  try {
    assert.deepEqual(await Push.avisarPedido(db, solId, { titulo: 'x' }), { enviados: 0 });
    assert.equal(filas(db, 'PORTAL_PUSH')[0].activa, false);
    assert.deepEqual(await Push.avisarPedido(db, solId, { titulo: 'x' }), { enviados: 0 });
    assert.equal(f.llamadas.length, 1, 'tras el 410 no se insiste');
  } finally { f.restaurar(); }
  await cliente(db, 'clientePushSuscribir', { cliente_token: tok, suscripcion: s1 });
  assert.equal(filas(db, 'PORTAL_PUSH').length, 1, 'el mismo teléfono no se duplica');
  assert.equal((await cliente(db, 'clientePushQuitar', { cliente_token: tok, endpoint: s1.endpoint })).status, 200);
  assert.equal(filas(db, 'PORTAL_PUSH')[0].activa, false);
  // Para el personal: cuántos teléfonos reciben avisos por persona.
  await cliente(db, 'clientePushSuscribir', { cliente_token: tok, suscripcion: s1 });
  const adm = await staff(db, SUPER, 'portalAdmCliente', { cliente_id: 'CLI-1' });
  assert.equal(adm.body.data.contactos[0].telefonos_con_avisos, 1);
});

test('«Mis documentos»: lo entregado por el equipo con su pedido y trabajador, solo de la propia empresa', async () => {
  const Almacen = require('../logica/almacenamiento');
  const orig = Almacen.subirArchivo_;
  Almacen.subirArchivo_ = async (clave) => ({ ok: true, clave });
  try {
    const db = dbPortal();
    const tok = await activado(db, 'CLI-1', '12.345.678-5', 'Pedro Sáez');
    const tokVecina = await activado(db, 'CLI-2', '11.111.111-1', 'Ana Vecina');
    const r = await cliente(db, 'clienteCrearPedido', { cliente_token: tok, plantilla_id: 'contrato', personas: [{ nombre: 'Juan Pérez', rut: '12.345.678-5' }] });
    const solId = r.body.data.solicitud_id;
    const pdf = Buffer.from('%PDF-1.4 contrato').toString('base64');
    const f = conFetchFalso(201);
    try {
      assert.equal((await staff(db, VANESSA, 'subirArchivoEquipo', { subsolicitud_id: solId + '-01', nombre_archivo: 'Contrato Juan.pdf', contenido_base64: pdf })).status, 200);
    } finally { f.restaurar(); }
    const jpg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2]).toString('base64');
    await cliente(db, 'clienteSubirArchivo', { cliente_token: tok, solicitud_id: solId, nombre_archivo: 'carnet.jpg', contenido_base64: jpg });
    const docs = (await cliente(db, 'clienteDocumentos', { cliente_token: tok })).body.data.documentos;
    assert.equal(docs.length, 2);
    const contrato = docs.find((d) => d.del_equipo);
    assert.equal(contrato.nombre, 'Contrato Juan.pdf');
    assert.equal(contrato.trabajador, 'Juan Pérez');
    assert.equal(contrato.quien, 'Vanessa Sepúlveda');
    assert.match(contrato.pedido, /^Contrato de trabajo/);
    assert.ok(!('url' in contrato), 'sin el enlace con llave');
    assert.ok(docs.some((d) => !d.del_equipo && d.nombre === 'carnet.jpg'));
    assert.equal((await cliente(db, 'clienteDocumentos', { cliente_token: tokVecina })).body.data.documentos.length, 0, 'la vecina no ve nada');
  } finally { Almacen.subirArchivo_ = orig; }
});
