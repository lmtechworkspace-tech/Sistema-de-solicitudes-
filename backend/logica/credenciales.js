'use strict';

/**
 * credenciales.js — bóveda de credenciales de la empresa (2026-10-07).
 *
 * Pedido del dueño: registrar y resguardar las claves de la empresa (partiendo
 * por las redes sociales que lleva Hompy) y dejar registro de QUIÉN TIENE
 * ACCESO a cada una. Decisiones: las claves se guardan en SIGSO, cifradas;
 * una bóveda de la empresa con categorías (Hompy muestra sus redes sociales);
 * ver o cambiar una clave pide el código de Google Authenticator; solo el
 * dueño (super admin) administra categorías y accesos.
 *
 * Mismo diseño que la bóveda de Finanzas (finanzasBoveda.js), del que reusa el
 * TOTP:
 *  1. Base propia (`credenciales.db`, junto a sigso.db; entra en el respaldo
 *     diario). Lo secreto de cada cuenta (la clave y las notas privadas) se
 *     guarda CIFRADO con AES-256-GCM. La llave es SIGSO_CREDENCIALES_LLAVE o,
 *     si no está, una derivada (HKDF) de la llave de Finanzas: distinta, pero
 *     sin tocar el servidor.
 *  2. Acceso POR CATEGORÍA (Redes sociales, Gobierno, Bancos…), que da y quita
 *     solo el super admin. Para quien no tiene ninguna, el módulo «no existe»
 *     (404, igual que una acción inventada).
 *  3. Ver la lista (plataforma, usuario, quién tiene acceso, verificación en
 *     dos pasos, último cambio) basta con la sesión de SIGSO. Ver, crear o
 *     cambiar una clave exige la bóveda abierta: código de 6 dígitos, que no
 *     se puede repetir; 5 malos bloquean 15 min; se cierra sola a los 15 min.
 *  4. Bitácora encadenada por hash: quién vio qué clave, quién la cambió y a
 *     quién se le dio o quitó acceso. Borrar o editar una fila rompe la cadena.
 *
 * NO se guardan claves de clientes (misma decisión que el robot de la TGR).
 */

const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Hash = require('./passwordHash');
const { errorValidacion, errorForbidden } = require('./errores');
const { codigoTotp, base32, contadorActual_ } = require('./finanzasBoveda');

const INACTIVIDAD_MS = 15 * 60 * 1000;
const MAXIMO_MS = 8 * 60 * 60 * 1000;
const MAX_FALLOS = 5;
const VENTANA_FALLOS_MS = 10 * 60 * 1000;
const BLOQUEO_MS = 15 * 60 * 1000;
const EMISOR_TOTP = 'SIGSO Credenciales';
const NO_ENCONTRADO = Object.freeze({ _noEncontrado: true });
const ICONOS = ['megafono', 'escudo', 'dinero', 'correo', 'capas', 'empresa', 'llave', 'candado', 'camara', 'equipo'];
const ROLES = ['ADMINISTRA', 'EDITA', 'PUBLICA', 'CONSULTA'];
const CADA = [0, 30, 90, 180, 365];
const CATEGORIAS_INICIALES = [
  ['redes', 'Redes sociales', 'megafono', 'Facebook, Instagram, TikTok, LinkedIn, YouTube… (las ve Hompy).'],
  ['gobierno', 'Gobierno', 'escudo', 'SII, TGR, Previred, Dirección del Trabajo, Mutual: las cuentas de la propia empresa.'],
  ['bancos', 'Bancos', 'dinero', 'Quién tiene acceso y con qué clave dinámica. Mejor no guardar claves bancarias.'],
  ['correo', 'Correo y dominio', 'correo', 'Cuentas de correo, el dominio, el hosting y Cloudflare.'],
  ['software', 'Software y suscripciones', 'capas', 'Programas y servicios que paga la empresa.'],
  ['oficina', 'Oficina', 'empresa', 'WiFi, impresoras, cámaras.']
];

// ---------------------------------------------------------------- configuración

function llave_() {
  const propia = String(process.env.SIGSO_CREDENCIALES_LLAVE || '').trim();
  if (propia) { const b = Buffer.from(propia, 'base64'); return b.length === 32 ? b : null; }
  const fin = String(process.env.SIGSO_FINANZAS_LLAVE || '').trim();
  if (!fin) return null;
  const base = Buffer.from(fin, 'base64');
  if (base.length !== 32) return null;
  return Buffer.from(crypto.hkdfSync('sha256', base, Buffer.from('sigso'), Buffer.from('credenciales-v1'), 32));
}
function rutaDb_() {
  if (process.env.SIGSO_CREDENCIALES_DB_PATH) return process.env.SIGSO_CREDENCIALES_DB_PATH;
  const principal = process.env.SIGSO_DB_PATH || path.join(__dirname, '..', '..', 'data', 'sigso.db');
  return path.join(path.dirname(principal), 'credenciales.db');
}

let db_ = null, rutaAbierta_ = null;
const ESQUEMA_ = [
  `CREATE TABLE IF NOT EXISTS CRED_CATEGORIAS (id TEXT PRIMARY KEY, nombre TEXT NOT NULL, icono TEXT, descripcion TEXT, orden INTEGER NOT NULL DEFAULT 99, activa INTEGER NOT NULL DEFAULT 1, creada_en TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS CRED_ACCESOS (categoria_id TEXT NOT NULL, cuenta_id TEXT NOT NULL, nombre TEXT, otorgado_por TEXT, desde TEXT NOT NULL, PRIMARY KEY (categoria_id, cuenta_id))`,
  `CREATE TABLE IF NOT EXISTS CRED_CUENTAS (
     id TEXT PRIMARY KEY, categoria_id TEXT NOT NULL, plataforma TEXT NOT NULL, usuario TEXT, url TEXT, secreto TEXT,
     titular TEXT, recuperacion TEXT, dos_pasos INTEGER NOT NULL DEFAULT 0, dos_pasos_donde TEXT, uso TEXT, notas TEXT,
     personas TEXT NOT NULL DEFAULT '[]', cambio_cada INTEGER NOT NULL DEFAULT 90, clave_cambiada_en TEXT,
     estado TEXT NOT NULL DEFAULT 'ACTIVA', creado_por TEXT, creada_en TEXT NOT NULL, actualizado_por TEXT, actualizada_en TEXT)`,
  `CREATE TABLE IF NOT EXISTS CRED_AUTENTICADOR (cuenta_id TEXT PRIMARY KEY, secreto TEXT NOT NULL, activo INTEGER NOT NULL DEFAULT 0, ultimo_contador INTEGER NOT NULL DEFAULT 0, creado_en TEXT NOT NULL, activado_en TEXT)`,
  `CREATE TABLE IF NOT EXISTS CRED_SESIONES (token_hash TEXT PRIMARY KEY, cuenta_id TEXT NOT NULL, creada_en INTEGER NOT NULL, ultimo_uso INTEGER NOT NULL, equipo TEXT, ip TEXT, cerrada INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS CRED_BITACORA (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, cuenta_id TEXT, nombre TEXT, accion TEXT NOT NULL, categoria_id TEXT, credencial_id TEXT, detalle TEXT, ip TEXT, equipo TEXT, hash_prev TEXT NOT NULL, hash TEXT NOT NULL)`
];
function dbCred() {
  const ruta = rutaDb_();
  if (db_ && rutaAbierta_ === ruta) return db_;
  if (db_) { try { db_.close(); } catch (e) { /* ya cerrada */ } }
  if (ruta !== ':memory:') fs.mkdirSync(path.dirname(ruta), { recursive: true });
  db_ = new DatabaseSync(ruta);
  db_.exec('PRAGMA journal_mode = WAL');
  ESQUEMA_.forEach((sql) => db_.exec(sql));
  const hay = db_.prepare('SELECT COUNT(*) AS n FROM CRED_CATEGORIAS').get().n;
  if (!hay) {
    const ins = db_.prepare('INSERT INTO CRED_CATEGORIAS (id, nombre, icono, descripcion, orden, activa, creada_en) VALUES (?,?,?,?,?,1,?)');
    CATEGORIAS_INICIALES.forEach(([id, n, ic, d], i) => ins.run(id, n, ic, d, i + 1, new Date().toISOString()));
  }
  rutaAbierta_ = ruta;
  return db_;
}
function reiniciarParaPruebas_() {
  if (db_) { try { db_.close(); } catch (e) { /* nada */ } }
  db_ = null; rutaAbierta_ = null; fallos_.clear();
}

// ---------------------------------------------------------------- cifrado y TOTP

function cifrar(texto) {
  const k = llave_();
  if (!k) throw new Error('La bóveda no tiene llave configurada.');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const datos = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), datos]).toString('base64');
}
function descifrar(sobre) {
  const k = llave_();
  if (!k) throw new Error('La bóveda no tiene llave configurada.');
  const m = /^v1:(.+)$/.exec(String(sobre || ''));
  if (!m) throw new Error('Dato cifrado con formato desconocido.');
  const buf = Buffer.from(m[1], 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', k, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}
function verificarTotp_(secreto, codigo) {
  const c = String(codigo || '').replace(/\D/g, '');
  if (c.length !== 6) return null;
  const actual = contadorActual_(Date.now());
  for (const d of [0, -1, 1]) {
    if (crypto.timingSafeEqual(Buffer.from(codigoTotp(secreto, actual + d)), Buffer.from(c))) return actual + d;
  }
  return null;
}

// ---------------------------------------------------------------- identidad y permisos

function cuentas_(db) { try { return leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL); } catch (e) { return []; } }
function cuentaDe_(db, contexto) {
  if (!contexto || !contexto.cuenta_id) return null;
  return cuentas_(db).find((c) => String(c.cuenta_id) === String(contexto.cuenta_id)) || null;
}
function nombreDe_(cuenta, contexto) { return String((cuenta && cuenta.nombre) || (contexto && contexto.email) || ''); }
function esAdmin_(contexto) { return !!(contexto && contexto.super_admin === true); }
function misCategorias_(contexto) {
  if (!contexto || !contexto.cuenta_id) return [];
  if (esAdmin_(contexto)) return dbCred().prepare('SELECT id FROM CRED_CATEGORIAS').all().map((r) => r.id);
  return dbCred().prepare('SELECT categoria_id FROM CRED_ACCESOS WHERE cuenta_id = ?').all(String(contexto.cuenta_id)).map((r) => r.categoria_id);
}
/** ¿Ve el módulo? Super admin o con acceso a alguna categoría. (Lo usa también la sesión del portal.) */
function tieneAcceso(db, contexto) {
  if (!contexto || !contexto.cuenta_id) return false;
  try { return esAdmin_(contexto) || misCategorias_(contexto).length > 0; } catch (e) { return false; }
}
function puedeCategoria_(contexto, categoriaId) { return misCategorias_(contexto).indexOf(categoriaId) !== -1; }

// ---------------------------------------------------------------- bitácora

function hashEntrada_(prev, e) {
  return crypto.createHash('sha256')
    .update([prev, e.ts, e.cuenta_id, e.nombre, e.accion, e.categoria_id, e.credencial_id, e.detalle, e.ip, e.equipo].map((x) => String(x == null ? '' : x)).join('\u001f'))
    .digest('hex');
}
function registrar_(entrada) {
  const d = dbCred();
  const ult = d.prepare('SELECT hash FROM CRED_BITACORA ORDER BY id DESC LIMIT 1').get();
  const prev = ult ? ult.hash : 'origen';
  const e = {
    ts: new Date().toISOString(), cuenta_id: entrada.cuenta_id || '', nombre: entrada.nombre || '', accion: entrada.accion,
    categoria_id: entrada.categoria_id || '', credencial_id: entrada.credencial_id || '', detalle: entrada.detalle || '', ip: entrada.ip || '', equipo: entrada.equipo || ''
  };
  d.prepare('INSERT INTO CRED_BITACORA (ts, cuenta_id, nombre, accion, categoria_id, credencial_id, detalle, ip, equipo, hash_prev, hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(e.ts, e.cuenta_id, e.nombre, e.accion, e.categoria_id, e.credencial_id, e.detalle, e.ip, e.equipo, prev, hashEntrada_(prev, e));
}
function verificarCadena_() {
  const filas = dbCred().prepare('SELECT * FROM CRED_BITACORA ORDER BY id').all();
  let prev = 'origen';
  for (const f of filas) {
    if (f.hash_prev !== prev || hashEntrada_(prev, f) !== f.hash) return { ok: false, filas: filas.length, rota_en: f.id };
    prev = f.hash;
  }
  return { ok: true, filas: filas.length, rota_en: null };
}

// ---------------------------------------------------------------- intentos y sesiones

const fallos_ = new Map();
function bloqueado_(id, ahora) { const f = fallos_.get(id); return !!(f && f.bloqueado_hasta > ahora); }
function anotarFallo_(id, ahora) {
  const f = fallos_.get(id) || { marcas: [], bloqueado_hasta: 0 };
  f.marcas = f.marcas.filter((t) => ahora - t < VENTANA_FALLOS_MS).concat([ahora]);
  if (f.marcas.length >= MAX_FALLOS) { f.bloqueado_hasta = ahora + BLOQUEO_MS; f.marcas = []; }
  fallos_.set(id, f);
  return f.bloqueado_hasta > ahora;
}
function hashToken_(t) { return crypto.createHash('sha256').update(String(t)).digest('hex'); }
function sesionValida_(cuentaId, token, ahora) {
  if (!token) return null;
  const s = dbCred().prepare('SELECT * FROM CRED_SESIONES WHERE token_hash = ?').get(hashToken_(token));
  if (!s || s.cerrada || String(s.cuenta_id) !== String(cuentaId)) return null;
  if (ahora - s.ultimo_uso > INACTIVIDAD_MS || ahora - s.creada_en > MAXIMO_MS) return null;
  return s;
}
function equipoDe_(data) { return String((data && data.equipo) || '').replace(/[^\w-]/g, '').slice(0, 64); }
function ipDe_(contexto) { return String((contexto && contexto.ip) || ''); }

// ---------------------------------------------------------------- utilidades de datos

function linea_(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max || 200); }
function texto_(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max || 2000); }
function url_(v) { const s = linea_(v, 500); return /^https?:\/\/\S+$/i.test(s) ? s : ''; }
function fecha_(v) { const s = String(v || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''; const d = new Date(s + 'T12:00:00Z'); return !isNaN(d) && d.toISOString().slice(0, 10) === s ? s : ''; }
function hoy_() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
function json_(v, d) { try { return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function personasLimpias_(lista) {
  const vistos = new Set();
  return (Array.isArray(lista) ? lista : []).slice(0, 30).map((p) => ({
    nombre: linea_(p && p.nombre, 80), rol: ROLES.indexOf(p && p.rol) !== -1 ? p.rol : 'CONSULTA', desde: fecha_(p && p.desde)
  })).filter((p) => { const k = p.nombre.toLowerCase(); if (!p.nombre || vistos.has(k)) return false; vistos.add(k); return true; });
}
function vencimiento_(c) {
  if (!c.cambio_cada) return null;
  if (!c.clave_cambiada_en) return '';
  const d = new Date(c.clave_cambiada_en.slice(0, 10) + 'T12:00:00Z');
  return new Date(d.getTime() + c.cambio_cada * 864e5).toISOString().slice(0, 10);
}
/** Lo que se muestra sin abrir la bóveda: nunca la clave ni las notas privadas. */
function publica_(c) {
  return {
    id: c.id, categoria_id: c.categoria_id, plataforma: c.plataforma, usuario: c.usuario || '', url: c.url || '', titular: c.titular || '',
    recuperacion: c.recuperacion || '', dos_pasos: !!c.dos_pasos, dos_pasos_donde: c.dos_pasos_donde || '', uso: c.uso || '', notas: c.notas || '',
    personas: json_(c.personas, []), cambio_cada: c.cambio_cada, clave_cambiada_en: c.clave_cambiada_en || '', vence: vencimiento_(c),
    tiene_clave: !!c.secreto, estado: c.estado, actualizado_por: c.actualizado_por || '', actualizada_en: c.actualizada_en || c.creada_en
  };
}

// ---------------------------------------------------------------- acciones sin bóveda

function estado(db, data, contexto) {
  if (!tieneAcceso(db, contexto)) return NO_ENCONTRADO;
  if (!llave_()) return { llave_configurada: false, es_admin: esAdmin_(contexto), autenticador_activo: false, sesion_activa: false };
  const a = dbCred().prepare('SELECT activo FROM CRED_AUTENTICADOR WHERE cuenta_id = ?').get(String(contexto.cuenta_id));
  return {
    llave_configurada: true, es_admin: esAdmin_(contexto), autenticador_activo: !!(a && a.activo),
    sesion_activa: !!sesionValida_(contexto.cuenta_id, data && data.boveda_token, Date.now()), inactividad_min: INACTIVIDAD_MS / 60000
  };
}

/** La lista (sin claves), los accesos y los avisos. Basta con la sesión de SIGSO. */
function datos(db, data, contexto) {
  if (!tieneAcceso(db, contexto)) return NO_ENCONTRADO;
  const d = dbCred();
  const mias = misCategorias_(contexto), admin = esAdmin_(contexto);
  const categorias = d.prepare('SELECT * FROM CRED_CATEGORIAS ORDER BY orden, nombre').all()
    .filter((c) => mias.indexOf(c.id) !== -1).map((c) => ({ id: c.id, nombre: c.nombre, icono: c.icono, descripcion: c.descripcion || '', activa: !!c.activa }));
  const ids = new Set(categorias.map((c) => c.id));
  const lista = d.prepare("SELECT * FROM CRED_CUENTAS ORDER BY plataforma").all().filter((c) => ids.has(c.categoria_id)).map(publica_);
  const accesos = d.prepare('SELECT * FROM CRED_ACCESOS ORDER BY nombre').all().filter((a) => ids.has(a.categoria_id))
    .map((a) => ({ categoria_id: a.categoria_id, cuenta_id: a.cuenta_id, nombre: a.nombre, desde: a.desde, otorgado_por: a.otorgado_por }));
  const todas = cuentas_(db);
  const activos = new Set(todas.filter((c) => c.activo === true || c.activo === 'TRUE' || c.activo === 1).map((c) => String(c.nombre || '').trim().toLowerCase()).filter(Boolean));
  const inactivos = new Set(todas.filter((c) => !(c.activo === true || c.activo === 'TRUE' || c.activo === 1)).map((c) => String(c.nombre || '').trim().toLowerCase()).filter(Boolean));
  const hoy = hoy_(), avisos = [];
  lista.filter((c) => c.estado === 'ACTIVA').forEach((c) => {
    if (c.vence === '') avisos.push({ tipo: 'SIN_FECHA', credencial_id: c.id, texto: 'No se sabe cuándo se cambió la clave' });
    else if (c.vence && c.vence < hoy) avisos.push({ tipo: 'VENCIDA', credencial_id: c.id, texto: 'Toca cambiar la clave (desde el ' + c.vence.split('-').reverse().join('-') + ')' });
    if (!c.dos_pasos) avisos.push({ tipo: 'SIN_2FA', credencial_id: c.id, texto: 'Sin verificación en dos pasos' });
    c.personas.forEach((p) => { if (inactivos.has(p.nombre.toLowerCase()) && !activos.has(p.nombre.toLowerCase())) avisos.push({ tipo: 'PERSONA_INACTIVA', credencial_id: c.id, texto: p.nombre + ' ya no está activo en SIGSO y sigue con acceso' }); });
  });
  return {
    es_admin: admin, categorias, cuentas: lista, accesos, avisos,
    personas: todas.filter((c) => c.activo === true || c.activo === 'TRUE' || c.activo === 1).map((c) => ({ cuenta_id: c.cuenta_id, nombre: c.nombre })).filter((p) => p.nombre).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    catalogos: { roles: ROLES, cada: CADA, iconos: ICONOS }
  };
}

// ---------------------------------------------------------------- autenticador y bóveda

function prepararAutenticador(db, data, contexto) {
  if (!tieneAcceso(db, contexto)) return NO_ENCONTRADO;
  if (!llave_()) return errorForbidden('La bóveda todavía no tiene su llave configurada en el servidor.');
  const cuenta = cuentaDe_(db, contexto);
  if (!cuenta) return errorForbidden('Ingresa con tu cuenta de SIGSO.');
  const ahora = Date.now();
  if (bloqueado_(cuenta.cuenta_id, ahora)) return errorForbidden('Demasiados intentos. Espera 15 minutos.');
  if (!Hash.coincide(String((data && data.password) || ''), cuenta.salt, cuenta.hash_password)) {
    anotarFallo_(cuenta.cuenta_id, ahora);
    registrar_({ cuenta_id: cuenta.cuenta_id, nombre: nombreDe_(cuenta, contexto), accion: 'AUTENTICADOR_CLAVE_INCORRECTA', ip: ipDe_(contexto), equipo: equipoDe_(data) });
    return errorForbidden('La contraseña no es correcta.');
  }
  const d = dbCred();
  const previo = d.prepare('SELECT activo FROM CRED_AUTENTICADOR WHERE cuenta_id = ?').get(String(cuenta.cuenta_id));
  if (previo && previo.activo) return errorForbidden('Tu autenticador ya está activo. Si cambiaste de teléfono, pide que lo reinicien.');
  const secreto = base32(crypto.randomBytes(20));
  d.prepare('INSERT INTO CRED_AUTENTICADOR (cuenta_id, secreto, activo, ultimo_contador, creado_en) VALUES (?,?,0,0,?) ON CONFLICT(cuenta_id) DO UPDATE SET secreto = excluded.secreto, activo = 0, ultimo_contador = 0, creado_en = excluded.creado_en')
    .run(String(cuenta.cuenta_id), cifrar(secreto), new Date().toISOString());
  registrar_({ cuenta_id: cuenta.cuenta_id, nombre: nombreDe_(cuenta, contexto), accion: 'AUTENTICADOR_PREPARADO', ip: ipDe_(contexto), equipo: equipoDe_(data) });
  const etiqueta = encodeURIComponent(EMISOR_TOTP + ':' + (cuenta.usuario || contexto.email));
  return { clave: secreto.replace(/(.{4})/g, '$1 ').trim(), uri: 'otpauth://totp/' + etiqueta + '?secret=' + secreto + '&issuer=' + encodeURIComponent(EMISOR_TOTP) + '&algorithm=SHA1&digits=6&period=30' };
}
function ingresar_(db, data, contexto, activando) {
  if (!tieneAcceso(db, contexto)) return NO_ENCONTRADO;
  if (!llave_()) return errorForbidden('La bóveda todavía no tiene su llave configurada en el servidor.');
  const cuenta = cuentaDe_(db, contexto);
  if (!cuenta) return errorForbidden('Ingresa con tu cuenta de SIGSO.');
  const ahora = Date.now(), equipo = equipoDe_(data), ip = ipDe_(contexto), nombre = nombreDe_(cuenta, contexto);
  if (bloqueado_(cuenta.cuenta_id, ahora)) return errorForbidden('Demasiados códigos incorrectos. Espera 15 minutos.');
  const d = dbCred();
  const a = d.prepare('SELECT * FROM CRED_AUTENTICADOR WHERE cuenta_id = ?').get(String(cuenta.cuenta_id));
  if (!a || (!activando && !a.activo)) return errorForbidden(activando ? 'Primero genera la clave del autenticador.' : 'Todavía no activas tu autenticador.');
  const contador = verificarTotp_(descifrar(a.secreto), data && data.codigo);
  if (contador === null || contador <= a.ultimo_contador) {
    const bloq = anotarFallo_(cuenta.cuenta_id, ahora);
    registrar_({ cuenta_id: cuenta.cuenta_id, nombre, accion: 'CODIGO_INCORRECTO', detalle: bloq ? 'bloqueo 15 min' : '', ip, equipo });
    return errorValidacion('codigo', bloq ? 'Demasiados códigos incorrectos. Espera 15 minutos.' : 'El código no es correcto o ya se usó. Espera el siguiente.');
  }
  fallos_.delete(cuenta.cuenta_id);
  d.prepare('UPDATE CRED_AUTENTICADOR SET ultimo_contador = ?' + (activando ? ', activo = 1, activado_en = ?' : '') + ' WHERE cuenta_id = ?')
    .run(...(activando ? [contador, new Date().toISOString(), String(cuenta.cuenta_id)] : [contador, String(cuenta.cuenta_id)]));
  if (activando) registrar_({ cuenta_id: cuenta.cuenta_id, nombre, accion: 'AUTENTICADOR_ACTIVADO', ip, equipo });
  const token = crypto.randomBytes(32).toString('base64url');
  d.prepare('INSERT INTO CRED_SESIONES (token_hash, cuenta_id, creada_en, ultimo_uso, equipo, ip) VALUES (?,?,?,?,?,?)').run(hashToken_(token), String(cuenta.cuenta_id), ahora, ahora, equipo, ip);
  registrar_({ cuenta_id: cuenta.cuenta_id, nombre, accion: 'ENTRAR', ip, equipo });
  return { boveda_token: token, inactividad_min: INACTIVIDAD_MS / 60000 };
}
function activarAutenticador(db, data, contexto) { return ingresar_(db, data, contexto, true); }
function entrar(db, data, contexto) { return ingresar_(db, data, contexto, false); }
function salir(db, data, contexto) {
  if (!tieneAcceso(db, contexto)) return NO_ENCONTRADO;
  if (data && data.boveda_token) {
    const r = dbCred().prepare('UPDATE CRED_SESIONES SET cerrada = 1 WHERE token_hash = ? AND cuenta_id = ? AND cerrada = 0').run(hashToken_(data.boveda_token), String(contexto.cuenta_id));
    if (r.changes) registrar_({ cuenta_id: contexto.cuenta_id, nombre: nombreDe_(cuentaDe_(db, contexto), contexto), accion: 'SALIR', ip: ipDe_(contexto), equipo: equipoDe_(data) });
  }
  return { ok: true };
}

/** Envoltorio de toda acción que toca claves o accesos: módulo + bóveda abierta. */
function conBoveda(fn) {
  return function (db, data, contexto) {
    if (!tieneAcceso(db, contexto)) return NO_ENCONTRADO;
    if (!llave_()) return errorForbidden('La bóveda todavía no tiene su llave configurada en el servidor.');
    const ahora = Date.now();
    const s = sesionValida_(contexto.cuenta_id, data && data.boveda_token, ahora);
    if (!s) return { _forbidden: true, message: 'La bóveda se cerró. Escribe tu código de nuevo.', boveda_cerrada: true };
    dbCred().prepare('UPDATE CRED_SESIONES SET ultimo_uso = ? WHERE token_hash = ?').run(ahora, s.token_hash);
    const cuenta = cuentaDe_(db, contexto), nombre = nombreDe_(cuenta, contexto);
    const registrar = (accion, extra) => registrar_(Object.assign({ cuenta_id: contexto.cuenta_id, nombre, accion, ip: ipDe_(contexto), equipo: equipoDe_(data) }, extra || {}));
    return fn(db, data || {}, contexto, { nombre, registrar });
  };
}

// ---------------------------------------------------------------- acciones con bóveda

const verClave = conBoveda(function (db, data, contexto, x) {
  const c = dbCred().prepare('SELECT * FROM CRED_CUENTAS WHERE id = ?').get(String(data.id || ''));
  if (!c || !puedeCategoria_(contexto, c.categoria_id)) return errorValidacion('id', 'Esa credencial no existe o no tienes acceso a su categoría.');
  const s = c.secreto ? json_(descifrar(c.secreto), {}) : {};
  x.registrar('VER_CLAVE', { categoria_id: c.categoria_id, credencial_id: c.id, detalle: c.plataforma + (c.usuario ? ' · ' + c.usuario : '') });
  return { clave: s.clave || '', notas_privadas: s.notas_privadas || '' };
});

const guardarCuenta = conBoveda(function (db, data, contexto, x) {
  const d = dbCred();
  const categoria = d.prepare('SELECT * FROM CRED_CATEGORIAS WHERE id = ?').get(String(data.categoria_id || ''));
  if (!categoria || !puedeCategoria_(contexto, categoria.id)) return errorValidacion('categoria_id', 'Elige una categoría a la que tengas acceso.');
  const plataforma = linea_(data.plataforma, 80);
  if (!plataforma) return errorValidacion('plataforma', 'Escribe la plataforma o el servicio (por ejemplo, Facebook).');
  const previa = data.id ? d.prepare('SELECT * FROM CRED_CUENTAS WHERE id = ?').get(String(data.id)) : null;
  if (data.id && (!previa || !puedeCategoria_(contexto, previa.categoria_id))) return errorValidacion('id', 'Esa credencial ya no existe.');
  const secretoPrevio = previa && previa.secreto ? json_(descifrar(previa.secreto), {}) : {};
  const claveNueva = data.clave === undefined || data.clave === null ? undefined : String(data.clave).slice(0, 500);
  const notasPriv = data.notas_privadas === undefined ? secretoPrevio.notas_privadas || '' : texto_(data.notas_privadas, 2000);
  const cambioClave = claveNueva !== undefined && claveNueva !== '' && claveNueva !== (secretoPrevio.clave || '');
  const clave = claveNueva !== undefined && claveNueva !== '' ? claveNueva : (secretoPrevio.clave || '');
  const ahora = new Date().toISOString();
  const fila = {
    categoria_id: categoria.id, plataforma, usuario: linea_(data.usuario, 160), url: url_(data.url), titular: linea_(data.titular, 120),
    recuperacion: linea_(data.recuperacion, 200), dos_pasos: data.dos_pasos === true || data.dos_pasos === 'true' ? 1 : 0, dos_pasos_donde: linea_(data.dos_pasos_donde, 120),
    uso: linea_(data.uso, 120), notas: texto_(data.notas, 1500), personas: JSON.stringify(personasLimpias_(data.personas)),
    cambio_cada: CADA.indexOf(Number(data.cambio_cada)) !== -1 ? Number(data.cambio_cada) : 90,
    // Al crearla se respeta la fecha que se anote (la clave puede ser antigua); al cambiarla después, es hoy.
    clave_cambiada_en: cambioClave && previa ? hoy_() : (fecha_(data.clave_cambiada_en) || (cambioClave ? hoy_() : '') || (previa && previa.clave_cambiada_en) || ''),
    secreto: clave || notasPriv ? cifrar(JSON.stringify({ clave, notas_privadas: notasPriv })) : null,
    actualizado_por: x.nombre, actualizada_en: ahora
  };
  if (previa) {
    const sets = Object.keys(fila).map((k) => k + ' = ?').join(', ');
    d.prepare('UPDATE CRED_CUENTAS SET ' + sets + ' WHERE id = ?').run(...Object.values(fila), previa.id);
    if (previa.categoria_id !== categoria.id) x.registrar('MOVER', { categoria_id: categoria.id, credencial_id: previa.id, detalle: plataforma + ': de ' + previa.categoria_id + ' a ' + categoria.id });
    x.registrar(cambioClave ? 'CAMBIAR_CLAVE' : 'EDITAR', { categoria_id: categoria.id, credencial_id: previa.id, detalle: plataforma });
    return { cuenta: publica_(d.prepare('SELECT * FROM CRED_CUENTAS WHERE id = ?').get(previa.id)) };
  }
  const id = 'CR-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const nueva = Object.assign({ id, estado: 'ACTIVA', creado_por: x.nombre, creada_en: ahora }, fila);
  d.prepare('INSERT INTO CRED_CUENTAS (' + Object.keys(nueva).join(', ') + ') VALUES (' + Object.keys(nueva).map(() => '?').join(', ') + ')').run(...Object.values(nueva));
  x.registrar('CREAR', { categoria_id: categoria.id, credencial_id: id, detalle: plataforma });
  return { cuenta: publica_(nueva) };
});

const retirarCuenta = conBoveda(function (db, data, contexto, x) {
  const d = dbCred();
  const c = d.prepare('SELECT * FROM CRED_CUENTAS WHERE id = ?').get(String(data.id || ''));
  if (!c || !puedeCategoria_(contexto, c.categoria_id)) return errorValidacion('id', 'Esa credencial ya no existe.');
  const estado = data.reactivar ? 'ACTIVA' : 'RETIRADA';
  d.prepare('UPDATE CRED_CUENTAS SET estado = ?, actualizado_por = ?, actualizada_en = ? WHERE id = ?').run(estado, x.nombre, new Date().toISOString(), c.id);
  x.registrar(estado === 'RETIRADA' ? 'RETIRAR' : 'REACTIVAR', { categoria_id: c.categoria_id, credencial_id: c.id, detalle: c.plataforma + (data.motivo ? ': ' + linea_(data.motivo, 200) : '') });
  return { cuenta: publica_(d.prepare('SELECT * FROM CRED_CUENTAS WHERE id = ?').get(c.id)) };
});

// Solo el super admin: categorías y accesos.
function soloAdmin_(fn) {
  return conBoveda(function (db, data, contexto, x) {
    if (!esAdmin_(contexto)) return errorForbidden('Solo la administración de la bóveda puede hacer esto.');
    return fn(db, data, contexto, x);
  });
}
const guardarCategoria = soloAdmin_(function (db, data, contexto, x) {
  const d = dbCred();
  const nombre = linea_(data.nombre, 60);
  if (!nombre) return errorValidacion('nombre', 'Ponle nombre a la categoría.');
  const icono = ICONOS.indexOf(data.icono) !== -1 ? data.icono : 'llave';
  if (data.id) {
    const c = d.prepare('SELECT id FROM CRED_CATEGORIAS WHERE id = ?').get(String(data.id));
    if (!c) return errorValidacion('id', 'Esa categoría no existe.');
    d.prepare('UPDATE CRED_CATEGORIAS SET nombre = ?, icono = ?, descripcion = ? WHERE id = ?').run(nombre, icono, linea_(data.descripcion, 200), c.id);
    x.registrar('EDITAR_CATEGORIA', { categoria_id: c.id, detalle: nombre });
    return { id: c.id };
  }
  const id = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'cat';
  if (d.prepare('SELECT 1 FROM CRED_CATEGORIAS WHERE id = ?').get(id)) return errorValidacion('nombre', 'Ya existe una categoría con ese nombre.');
  const orden = d.prepare('SELECT COALESCE(MAX(orden), 0) + 1 AS o FROM CRED_CATEGORIAS').get().o;
  d.prepare('INSERT INTO CRED_CATEGORIAS (id, nombre, icono, descripcion, orden, activa, creada_en) VALUES (?,?,?,?,?,1,?)').run(id, nombre, icono, linea_(data.descripcion, 200), orden, new Date().toISOString());
  x.registrar('CREAR_CATEGORIA', { categoria_id: id, detalle: nombre });
  return { id };
});
const darAcceso = soloAdmin_(function (db, data, contexto, x) {
  const d = dbCred();
  const cat = d.prepare('SELECT * FROM CRED_CATEGORIAS WHERE id = ?').get(String(data.categoria_id || ''));
  if (!cat) return errorValidacion('categoria_id', 'Esa categoría no existe.');
  const persona = cuentas_(db).find((c) => String(c.cuenta_id) === String(data.cuenta_id || ''));
  if (!persona) return errorValidacion('cuenta_id', 'Elige una persona con cuenta en SIGSO.');
  d.prepare('INSERT OR IGNORE INTO CRED_ACCESOS (categoria_id, cuenta_id, nombre, otorgado_por, desde) VALUES (?,?,?,?,?)').run(cat.id, String(persona.cuenta_id), persona.nombre || '', x.nombre, new Date().toISOString());
  x.registrar('DAR_ACCESO', { categoria_id: cat.id, detalle: (persona.nombre || persona.cuenta_id) + ' → ' + cat.nombre });
  return { ok: true };
});
const quitarAcceso = soloAdmin_(function (db, data, contexto, x) {
  const d = dbCred();
  const a = d.prepare('SELECT * FROM CRED_ACCESOS WHERE categoria_id = ? AND cuenta_id = ?').get(String(data.categoria_id || ''), String(data.cuenta_id || ''));
  if (!a) return errorValidacion('cuenta_id', 'Esa persona no tenía acceso a la categoría.');
  d.prepare('DELETE FROM CRED_ACCESOS WHERE categoria_id = ? AND cuenta_id = ?').run(a.categoria_id, a.cuenta_id);
  d.prepare('UPDATE CRED_SESIONES SET cerrada = 1 WHERE cuenta_id = ?').run(a.cuenta_id);
  x.registrar('QUITAR_ACCESO', { categoria_id: a.categoria_id, detalle: (a.nombre || a.cuenta_id) + ' ✕ ' + a.categoria_id });
  return { ok: true };
});

/** Bitácora: el admin la ve completa; el resto, lo de sus categorías y lo suyo. */
const bitacora = conBoveda(function (db, data, contexto, x) {
  const limite = Math.min(Math.max(Number(data.limite) || 200, 1), 1000);
  let filas = dbCred().prepare('SELECT id, ts, nombre, accion, categoria_id, credencial_id, detalle FROM CRED_BITACORA ORDER BY id DESC LIMIT ?').all(limite * 3);
  if (!esAdmin_(contexto)) {
    const mias = new Set(misCategorias_(contexto)), yo = nombreDe_(cuentaDe_(db, contexto), contexto);
    filas = filas.filter((f) => mias.has(f.categoria_id) || f.nombre === yo);
  }
  x.registrar('VER_BITACORA', {});
  return { filas: filas.slice(0, limite), cadena: verificarCadena_() };
});

module.exports = {
  NO_ENCONTRADO, tieneAcceso, estado, datos, prepararAutenticador, activarAutenticador, entrar, salir,
  verClave, guardarCuenta, retirarCuenta, guardarCategoria, darAcceso, quitarAcceso, bitacora,
  // pruebas / herramientas
  dbCred, verificarCadena_, reiniciarParaPruebas_, rutaDb_, llave_
};
