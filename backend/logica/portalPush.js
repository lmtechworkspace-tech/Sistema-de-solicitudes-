'use strict';

/**
 * portalPush.js — avisos al teléfono del contratista (2026-10-08).
 *
 * Por qué: el contratista solo se enteraba de una respuesta si entraba al
 * portal (los correos de SIGSO dependen de Resend y muchos contratistas no
 * tienen correo). Web Push es el estándar de los navegadores: el teléfono
 * muestra el aviso aunque el portal esté cerrado. Gratis y sin servicios de
 * terceros: el servidor cifra y firma el aviso él mismo (RFC 8291 + RFC 8292)
 * con node:crypto, y lo entrega al servicio de avisos del propio navegador
 * (Google, Apple, Mozilla, Microsoft).
 *
 * Qué se avisa: lo mismo que hoy va por correo al solicitante (en curso,
 * pregunta, listo para confirmar, cierre, recepción con fecha, mensaje o
 * documento del equipo), solo para pedidos que vienen del portal, y a TODOS
 * los teléfonos activos de esa empresa (la cuenta es de la empresa). Un aviso
 * nunca frena ni rompe lo que lo originó.
 *
 * iPhone: los avisos web solo funcionan con el portal instalado en la
 * pantalla de inicio (iOS 16.4 o más); el portal lo explica.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { errorValidacion } = require('./errores');

const CONTACTO_VAPID = process.env.VAPID_CONTACTO || 'mailto:soporte@ctrly.cl';
// Solo se entregan avisos a los servicios de avisos de los navegadores: el
// endpoint lo manda el teléfono y no puede apuntar a cualquier servidor.
const HOSTS_PUSH = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)$/i;
const FALLOS_BAJA = 5;

function b64u(buf) { return Buffer.from(buf).toString('base64url'); }
function deB64u(s) { return Buffer.from(String(s || ''), 'base64url'); }
function leer_(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
function v_(x) { return x === true || x === 'TRUE' || x === 1 || x === 'true'; }

// ---------------------------------------------------------------- llaves VAPID
let clavesCache_ = new WeakMap();
function claves_(db) {
  if (process.env.VAPID_PUBLICA && process.env.VAPID_PRIVADA) {
    const pub = deB64u(process.env.VAPID_PUBLICA);
    return { publica: process.env.VAPID_PUBLICA, jwk: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: process.env.VAPID_PRIVADA } };
  }
  if (clavesCache_.has(db)) return clavesCache_.get(db);
  let fila = leer_(db, 'PORTAL_PUSH_CLAVES')[0];
  if (!fila) {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = privateKey.export({ format: 'jwk' });
    const publica = b64u(Buffer.concat([Buffer.from([4]), deB64u(jwk.x), deB64u(jwk.y)]));
    fila = { clave_id: crypto.randomUUID(), publica, privada_jwk: JSON.stringify(jwk), creada: new Date().toISOString() };
    agregarFila_(db, 'PORTAL_PUSH_CLAVES', fila);
  }
  const c = { publica: fila.publica, jwk: typeof fila.privada_jwk === 'string' ? JSON.parse(fila.privada_jwk) : fila.privada_jwk };
  clavesCache_.set(db, c);
  return c;
}

// JWT ES256 de RFC 8292: «quién manda» el aviso, válido 12 h para ese servicio.
function jwtVapid_(endpoint, claves) {
  const aud = new URL(endpoint).origin;
  const cab = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const cuerpo = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: CONTACTO_VAPID }));
  const llave = crypto.createPrivateKey({ key: claves.jwk, format: 'jwk' });
  const firma = crypto.sign('sha256', Buffer.from(cab + '.' + cuerpo), { key: llave, dsaEncoding: 'ieee-p1363' });
  return cab + '.' + cuerpo + '.' + b64u(firma);
}

// ---------------------------------------------------------------- cifrado (RFC 8291, aes128gcm)
function hmac_(llave, dato) { return crypto.createHmac('sha256', llave).update(dato).digest(); }
function cifrar_(texto, p256dh, auth) {
  const uaPublica = deB64u(p256dh), secreto = deB64u(auth);
  if (uaPublica.length !== 65 || secreto.length < 16) throw new Error('Suscripción con llaves inválidas.');
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const asPublica = ecdh.getPublicKey();
  const compartido = ecdh.computeSecret(uaPublica);
  const sal = crypto.randomBytes(16);
  const prkLlave = hmac_(secreto, compartido);
  const ikm = hmac_(prkLlave, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublica, asPublica, Buffer.from([1])]));
  const prk = hmac_(sal, ikm);
  const cek = hmac_(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac_(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const cifrado = Buffer.concat([c.update(Buffer.concat([Buffer.from(texto, 'utf8'), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([sal, rs, Buffer.from([asPublica.length]), asPublica, cifrado]);
}

// ---------------------------------------------------------------- envío
async function enviar_(db, sub, aviso) {
  const claves = claves_(db);
  let cuerpo;
  try { cuerpo = cifrar_(JSON.stringify(aviso), sub.p256dh, sub.auth); } catch (e) { return { ok: false, baja: true }; }
  let r;
  const cabeceras = { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(3 * 24 * 3600), Urgency: 'high',
    Authorization: 'vapid t=' + jwtVapid_(sub.endpoint, claves) + ', k=' + claves.publica };
  // Topic: un aviso nuevo del mismo pedido reemplaza al que aún no se entregó.
  const topic = String(aviso.tag || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  if (topic) cabeceras.Topic = topic;
  try {
    r = await fetch(sub.endpoint, { method: 'POST', body: cuerpo, headers: cabeceras });
  } catch (e) { r = null; }
  const ahora = new Date().toISOString();
  if (r && r.status >= 200 && r.status < 300) {
    actualizarFilaPorId_(db, 'PORTAL_PUSH', 'suscripcion_id', sub.suscripcion_id, { ultimo_envio: ahora, ultimo_ok: ahora, fallos: 0 });
    return { ok: true };
  }
  const baja = !!r && (r.status === 404 || r.status === 410);
  const fallos = (Number(sub.fallos) || 0) + 1;
  actualizarFilaPorId_(db, 'PORTAL_PUSH', 'suscripcion_id', sub.suscripcion_id, { ultimo_envio: ahora, fallos, activa: !(baja || fallos >= FALLOS_BAJA) });
  return { ok: false, baja, status: r ? r.status : 0 };
}

function suscripcionesDe_(db, clienteId) {
  // Solo personas que siguen activas en una empresa con el portal habilitado.
  try {
    const perfil = leer_(db, 'PORTAL_CLIENTES').find((c) => c.cliente_id === clienteId);
    if (!perfil || !v_(perfil.habilitado)) return [];
    const activos = {};
    leer_(db, 'PORTAL_CONTACTOS').forEach((c) => { if (c.cliente_id === clienteId && c.estado === 'ACTIVO') activos[c.contacto_id] = true; });
    return leer_(db, 'PORTAL_PUSH').filter((s) => s.cliente_id === clienteId && v_(s.activa) && activos[s.contacto_id]);
  } catch (e) { return []; }
}

/**
 * Aviso a los teléfonos de la empresa dueña del pedido. No espera ni lanza:
 * se llama desde las notificaciones existentes. Devuelve la promesa (útil en pruebas).
 * aviso: { titulo, cuerpo }.
 */
function avisarPedido(db, solicitudId, aviso) {
  let sol = null;
  try { sol = leer_(db, 'SOLICITUDES').find((s) => s.solicitud_id === solicitudId); } catch (e) { sol = null; }
  if (!sol || sol.origen !== 'PORTAL' || !sol.cliente_id) return Promise.resolve({ enviados: 0 });
  const subs = suscripcionesDe_(db, sol.cliente_id);
  if (!subs.length) return Promise.resolve({ enviados: 0 });
  const datos = { titulo: String(aviso.titulo || 'HomePymes').slice(0, 80), cuerpo: String(aviso.cuerpo || '').slice(0, 200),
    pedido: solicitudId, tag: solicitudId };
  return Promise.all(subs.map((s) => enviar_(db, s, datos).catch(() => ({ ok: false }))))
    .then((rs) => ({ enviados: rs.filter((x) => x.ok).length }))
    .catch((err) => { console.error('aviso al teléfono:', err); return { enviados: 0 }; });
}

// ---------------------------------------------------------------- acciones del contratista
function clave(db) { return { publica: claves_(db).publica }; }

function suscribir(db, data, ctx) {
  const s = data && data.suscripcion || {};
  const endpoint = String(s.endpoint || '');
  let host = '';
  try { const u = new URL(endpoint); if (u.protocol === 'https:') host = u.hostname; } catch (e) { host = ''; }
  if (!host || !HOSTS_PUSH.test(host)) return errorValidacion('suscripcion', 'Este navegador no permite avisos.');
  const p256dh = String((s.keys || {}).p256dh || ''), auth = String((s.keys || {}).auth || '');
  if (deB64u(p256dh).length !== 65 || deB64u(auth).length < 16) return errorValidacion('suscripcion', 'Este navegador no permite avisos.');
  const ahora = new Date().toISOString();
  const fila = { cliente_id: ctx.cliente_id, contacto_id: ctx.contacto_id, p256dh, auth, dispositivo: String(data.dispositivo || '').slice(0, 120), activa: true, fallos: 0 };
  const previa = leer_(db, 'PORTAL_PUSH').find((x) => x.endpoint === endpoint);
  if (previa) actualizarFilaPorId_(db, 'PORTAL_PUSH', 'suscripcion_id', previa.suscripcion_id, fila);
  else agregarFila_(db, 'PORTAL_PUSH', Object.assign({ suscripcion_id: crypto.randomUUID(), endpoint, creada: ahora, ultimo_envio: '', ultimo_ok: '' }, fila));
  return { ok: true };
}

function quitar(db, data, ctx) {
  const endpoint = String(data && data.endpoint || '');
  leer_(db, 'PORTAL_PUSH').filter((x) => x.contacto_id === ctx.contacto_id && (!endpoint || x.endpoint === endpoint) && v_(x.activa))
    .forEach((x) => actualizarFilaPorId_(db, 'PORTAL_PUSH', 'suscripcion_id', x.suscripcion_id, { activa: false }));
  return { ok: true };
}

/** «Probar el aviso»: llega solo a este teléfono. */
async function probar(db, data, ctx) {
  const endpoint = String(data && data.endpoint || '');
  const sub = leer_(db, 'PORTAL_PUSH').find((x) => x.endpoint === endpoint && x.contacto_id === ctx.contacto_id && v_(x.activa));
  if (!sub) return errorValidacion('endpoint', 'Primero activa los avisos en este teléfono.');
  const r = await enviar_(db, sub, { titulo: 'Avisos activados', cuerpo: 'Así te avisaremos cuando te respondan o te manden un documento.', tag: 'prueba' });
  return r.ok ? { ok: true } : errorValidacion('endpoint', 'El aviso no salió. Inténtalo de nuevo en un rato.');
}

/** Para el personal: cuántos teléfonos de la empresa reciben avisos. */
function resumenCliente(db, clienteId) {
  const subs = suscripcionesDe_(db, clienteId);
  const porContacto = {};
  subs.forEach((s) => { porContacto[s.contacto_id] = (porContacto[s.contacto_id] || 0) + 1; });
  return { telefonos: subs.length, por_contacto: porContacto };
}

module.exports = { avisarPedido, clave, suscribir, quitar, probar, resumenCliente, cifrar_, jwtVapid_, claves_, HOSTS_PUSH };
