'use strict';

/**
 * finanzasBoveda.js — la "bóveda" del módulo Finanzas (Etapa 1, 2026-10-06;
 * propuesta en _datos-manual/finanzas/propuesta-finanzas.html, sección 3).
 *
 * Gerencia pidió que los datos financieros del grupo no se puedan filtrar.
 * Por eso Finanzas NO es un módulo más de la cuenta: tiene su propio
 * candado, distinto de todos los permisos de SIGSO.
 *
 *  1. Base de datos propia (`finanzas.db`, junto a sigso.db). El panel de
 *     datos del super admin, los respaldos de sigso.db y cualquier error de
 *     otro módulo no la tocan.
 *  2. Lo sensible (secretos del autenticador y, desde la Etapa 2, cada
 *     movimiento) se guarda CIFRADO con AES-256-GCM. La llave vive solo en
 *     la variable de entorno SIGSO_FINANZAS_LLAVE del servidor: un respaldo
 *     copiado de finanzas.db sin esa llave no se puede leer.
 *  3. Lista de acceso fija (SIGSO_FINANZAS_ACCESO, usuarios o correos
 *     separados por coma). NO hay pantalla para editarla: ningún ADM ni
 *     super admin puede darse acceso; cambiarla exige tocar el servidor.
 *     Para quien no está en la lista, cada acción responde exactamente lo
 *     mismo que una acción inexistente (404): el módulo "no existe".
 *  4. Segundo factor TOTP (Google Authenticator, RFC 6238) para abrir la
 *     bóveda. Activarlo exige volver a escribir la contraseña de SIGSO (una
 *     sesión robada no alcanza para registrar el teléfono de otro). Un
 *     código ya usado no sirve otra vez. 5 códigos malos bloquean 15 min.
 *  5. La bóveda se cierra sola a los 15 min sin uso (máximo 8 h), aunque
 *     SIGSO siga abierto.
 *  6. Bitácora encadenada: cada entrada guarda el hash de la anterior, así
 *     que borrar o editar una fila a mano rompe la cadena y se nota
 *     (verificarCadena_). Ingresos desde un equipo nuevo o fuera de horario
 *     avisan en SIGSO a SIGSO_FINANZAS_AVISAR (sin cifras).
 *
 * Esta base usa SQL tipado directo, no el contrato de "hojas" de
 * sqliteRepo.js: no viene de Google Sheets y no tiene filas legadas que
 * preservar.
 */

const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Hash = require('./passwordHash');
const { errorValidacion, errorForbidden } = require('./errores');

const INACTIVIDAD_MS = 15 * 60 * 1000;
const MAXIMO_MS = 8 * 60 * 60 * 1000;
const PASO_TOTP_S = 30;
const MAX_FALLOS = 5;
const VENTANA_FALLOS_MS = 10 * 60 * 1000;
const BLOQUEO_MS = 15 * 60 * 1000;
const EMISOR_TOTP = 'SIGSO Finanzas';

// Respuesta para quien no está en la lista: la misma que da el router a una
// acción que no existe (ver ejecutarAccion en router.js).
const NO_ENCONTRADO = Object.freeze({ _noEncontrado: true });

// ---------------------------------------------------------------- configuración

function listaAcceso_() {
  return String(process.env.SIGSO_FINANZAS_ACCESO || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}
function listaAvisar_() {
  return String(process.env.SIGSO_FINANZAS_AVISAR || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}
function llave_() {
  const b64 = String(process.env.SIGSO_FINANZAS_LLAVE || '').trim();
  if (!b64) return null;
  const buf = Buffer.from(b64, 'base64');
  return buf.length === 32 ? buf : null;
}
function rutaDb_() {
  if (process.env.SIGSO_FINANZAS_DB_PATH) return process.env.SIGSO_FINANZAS_DB_PATH;
  const principal = process.env.SIGSO_DB_PATH || path.join(__dirname, '..', '..', 'data', 'sigso.db');
  return path.join(path.dirname(principal), 'finanzas.db');
}

// ---------------------------------------------------------------- base propia

let dbFin_ = null;
let rutaAbierta_ = null;

const ESQUEMA_ = [
  `CREATE TABLE IF NOT EXISTS FIN_AUTENTICADOR (
     cuenta_id TEXT PRIMARY KEY,
     secreto TEXT NOT NULL,
     activo INTEGER NOT NULL DEFAULT 0,
     ultimo_contador INTEGER NOT NULL DEFAULT 0,
     creado_en TEXT NOT NULL,
     activado_en TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS FIN_SESIONES (
     token_hash TEXT PRIMARY KEY,
     cuenta_id TEXT NOT NULL,
     creada_en INTEGER NOT NULL,
     ultimo_uso INTEGER NOT NULL,
     equipo TEXT,
     ip TEXT,
     cerrada INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS FIN_BITACORA (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts TEXT NOT NULL,
     cuenta_id TEXT,
     nombre TEXT,
     accion TEXT NOT NULL,
     detalle TEXT,
     ip TEXT,
     equipo TEXT,
     hash_prev TEXT NOT NULL,
     hash TEXT NOT NULL
   )`,
  'CREATE INDEX IF NOT EXISTS ix_fin_bitacora_cuenta ON FIN_BITACORA (cuenta_id, id)'
];

function dbFin() {
  const ruta = rutaDb_();
  if (dbFin_ && rutaAbierta_ === ruta) return dbFin_;
  if (dbFin_) { try { dbFin_.close(); } catch (e) { /* ya cerrada */ } }
  if (ruta !== ':memory:') fs.mkdirSync(path.dirname(ruta), { recursive: true });
  dbFin_ = new DatabaseSync(ruta);
  dbFin_.exec('PRAGMA journal_mode = WAL');
  ESQUEMA_.forEach((sql) => dbFin_.exec(sql));
  rutaAbierta_ = ruta;
  return dbFin_;
}
// Solo para pruebas: cada test parte con una base limpia.
function reiniciarParaPruebas_() {
  if (dbFin_) { try { dbFin_.close(); } catch (e) { /* nada */ } }
  dbFin_ = null; rutaAbierta_ = null; fallos_.clear();
}

// ---------------------------------------------------------------- cifrado

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

// ---------------------------------------------------------------- TOTP (RFC 6238)

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf) {
  let bits = 0, valor = 0, out = '';
  for (const byte of buf) {
    valor = (valor << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(valor << (5 - bits)) & 31];
  return out;
}
function desdeBase32(txt) {
  const limpio = String(txt).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, valor = 0; const out = [];
  for (const ch of limpio) {
    valor = (valor << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function codigoTotp(secretoB32, contador) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(contador));
  const h = crypto.createHmac('sha1', desdeBase32(secretoB32)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}
function contadorActual_(ahoraMs) { return Math.floor((ahoraMs || Date.now()) / 1000 / PASO_TOTP_S); }
// Acepta el paso actual y uno a cada lado (relojes de teléfono algo corridos).
// Devuelve el contador que calzó, o null.
function verificarTotp_(secretoB32, codigo, ahoraMs) {
  const c = String(codigo || '').replace(/\D/g, '');
  if (c.length !== 6) return null;
  const actual = contadorActual_(ahoraMs);
  for (const d of [0, -1, 1]) {
    const esperado = codigoTotp(secretoB32, actual + d);
    if (crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(c))) return actual + d;
  }
  return null;
}

// ---------------------------------------------------------------- identidad

function cuentaDe_(db, contexto) {
  if (!contexto || !contexto.cuenta_id) return null;
  try {
    return leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL)
      .find((c) => String(c.cuenta_id) === String(contexto.cuenta_id)) || null;
  } catch (e) { return null; }
}
function claves_(cuenta, contexto) {
  const emails = String((cuenta && cuenta.emails) || '').split(/[,;\s]+/);
  return [cuenta && cuenta.usuario, cuenta && cuenta.cuenta_id, contexto && contexto.email]
    .concat(emails).map((s) => String(s || '').trim().toLowerCase()).filter(Boolean);
}
/** ¿Esta cuenta está en la lista de la bóveda? (Lo usa también la sesión del portal.) */
function tieneAcceso(db, contexto) {
  const lista = listaAcceso_();
  if (!lista.length) return false;
  const cuenta = cuentaDe_(db, contexto);
  if (!cuenta) return false;
  return claves_(cuenta, contexto).some((k) => lista.indexOf(k) !== -1);
}
function nombreDe_(cuenta, contexto) { return String((cuenta && cuenta.nombre) || (contexto && contexto.email) || ''); }

// ---------------------------------------------------------------- bitácora

function hashEntrada_(prev, e) {
  return crypto.createHash('sha256')
    .update([prev, e.ts, e.cuenta_id, e.nombre, e.accion, e.detalle, e.ip, e.equipo].map((x) => String(x == null ? '' : x)).join('\u001f'))
    .digest('hex');
}
function registrar_(entrada) {
  const d = dbFin();
  const ult = d.prepare('SELECT hash FROM FIN_BITACORA ORDER BY id DESC LIMIT 1').get();
  const prev = ult ? ult.hash : 'origen';
  const e = {
    ts: new Date().toISOString(), cuenta_id: entrada.cuenta_id || '', nombre: entrada.nombre || '',
    accion: entrada.accion, detalle: entrada.detalle || '', ip: entrada.ip || '', equipo: entrada.equipo || ''
  };
  d.prepare('INSERT INTO FIN_BITACORA (ts, cuenta_id, nombre, accion, detalle, ip, equipo, hash_prev, hash) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(e.ts, e.cuenta_id, e.nombre, e.accion, e.detalle, e.ip, e.equipo, prev, hashEntrada_(prev, e));
}
/** Recorre la cadena completa: { ok, filas, rota_en } */
function verificarCadena_() {
  const filas = dbFin().prepare('SELECT * FROM FIN_BITACORA ORDER BY id').all();
  let prev = 'origen';
  for (const f of filas) {
    if (f.hash_prev !== prev || hashEntrada_(prev, f) !== f.hash) return { ok: false, filas: filas.length, rota_en: f.id };
    prev = f.hash;
  }
  return { ok: true, filas: filas.length, rota_en: null };
}

// ---------------------------------------------------------------- límite de intentos (en memoria)

const fallos_ = new Map(); // cuenta_id -> { marcas: [ms], bloqueado_hasta }
function bloqueado_(cuentaId, ahora) {
  const f = fallos_.get(cuentaId);
  return !!(f && f.bloqueado_hasta && f.bloqueado_hasta > ahora);
}
function anotarFallo_(cuentaId, ahora) {
  const f = fallos_.get(cuentaId) || { marcas: [], bloqueado_hasta: 0 };
  f.marcas = f.marcas.filter((t) => ahora - t < VENTANA_FALLOS_MS).concat([ahora]);
  if (f.marcas.length >= MAX_FALLOS) { f.bloqueado_hasta = ahora + BLOQUEO_MS; f.marcas = []; }
  fallos_.set(cuentaId, f);
  return f.bloqueado_hasta > ahora;
}

// ---------------------------------------------------------------- sesiones de bóveda

function hashToken_(t) { return crypto.createHash('sha256').update(String(t)).digest('hex'); }
function abrirSesion_(cuentaId, equipo, ip) {
  const token = crypto.randomBytes(32).toString('base64url');
  const ahora = Date.now();
  dbFin().prepare('INSERT INTO FIN_SESIONES (token_hash, cuenta_id, creada_en, ultimo_uso, equipo, ip) VALUES (?,?,?,?,?,?)')
    .run(hashToken_(token), cuentaId, ahora, ahora, equipo || '', ip || '');
  return token;
}
function sesionValida_(cuentaId, token, ahora) {
  if (!token) return null;
  const s = dbFin().prepare('SELECT * FROM FIN_SESIONES WHERE token_hash = ?').get(hashToken_(token));
  if (!s || s.cerrada || String(s.cuenta_id) !== String(cuentaId)) return null;
  if (ahora - s.ultimo_uso > INACTIVIDAD_MS || ahora - s.creada_en > MAXIMO_MS) return null;
  return s;
}

function equipoDe_(data) { return String((data && data.equipo) || '').replace(/[^\w-]/g, '').slice(0, 64); }
function ipDe_(contexto) { return String((contexto && contexto.ip) || ''); }

function avisarSiInusual_(db, cuenta, contexto, equipo) {
  const destinos = listaAvisar_();
  if (!destinos.length) return;
  const previo = dbFin().prepare("SELECT 1 FROM FIN_BITACORA WHERE cuenta_id = ? AND accion = 'ENTRAR' AND equipo = ? LIMIT 1")
    .get(String(cuenta.cuenta_id), equipo);
  const hora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', hour12: false }).format(new Date()));
  const motivos = [];
  if (!previo) motivos.push('desde un equipo nuevo');
  if (hora < 7 || hora >= 21) motivos.push('fuera de horario');
  if (!motivos.length) return;
  const miEmail = String((contexto && contexto.email) || '').toLowerCase();
  const items = destinos.filter((d) => d !== miEmail && d !== String(cuenta.usuario || '').toLowerCase()).map((d) => ({
    destinatario: d, tipo: 'FINANZAS_ACCESO', modulo_id: 'finanzas', texto_accion: 'Ver bitácora',
    titulo: 'Ingreso a Finanzas ' + motivos.join(' y '),
    mensaje: nombreDe_(cuenta, contexto) + ' abrió la bóveda ' + motivos.join(' y ') + '.'
  }));
  try { require('./notificacionesApp').encolarLote(db, items); } catch (e) { /* un aviso nunca bloquea el ingreso */ }
}

// ---------------------------------------------------------------- acciones

/** Estado de la bóveda para pintar la pantalla de entrada. */
function estado(db, data, contexto) {
  if (!tieneAcceso(db, contexto)) return NO_ENCONTRADO;
  if (!llave_()) return { llave_configurada: false, autenticador_activo: false, sesion_activa: false };
  const a = dbFin().prepare('SELECT activo FROM FIN_AUTENTICADOR WHERE cuenta_id = ?').get(String(contexto.cuenta_id));
  const s = sesionValida_(contexto.cuenta_id, data && data.boveda_token, Date.now());
  return {
    llave_configurada: true,
    autenticador_activo: !!(a && a.activo),
    sesion_activa: !!s,
    inactividad_min: INACTIVIDAD_MS / 60000
  };
}

/**
 * Primer paso para registrar el teléfono: exige la contraseña de SIGSO y
 * entrega la clave para Google Authenticator. Si ya hay un autenticador
 * ACTIVO, no se puede reemplazar desde aquí (ver la herramienta del servidor
 * backend/herramientas/finanzas/reiniciar-autenticador.js).
 */
function prepararAutenticador(db, data, contexto) {
  if (!tieneAcceso(db, contexto)) return NO_ENCONTRADO;
  if (!llave_()) return errorForbidden('La bóveda todavía no tiene su llave configurada en el servidor.');
  const cuenta = cuentaDe_(db, contexto);
  const ahora = Date.now();
  if (bloqueado_(cuenta.cuenta_id, ahora)) return errorForbidden('Demasiados intentos. Espera 15 minutos.');
  if (!Hash.coincide(String((data && data.password) || ''), cuenta.salt, cuenta.hash_password)) {
    anotarFallo_(cuenta.cuenta_id, ahora);
    registrar_({ cuenta_id: cuenta.cuenta_id, nombre: nombreDe_(cuenta, contexto), accion: 'AUTENTICADOR_CLAVE_INCORRECTA', ip: ipDe_(contexto), equipo: equipoDe_(data) });
    return errorForbidden('La contraseña no es correcta.');
  }
  const d = dbFin();
  const previo = d.prepare('SELECT activo FROM FIN_AUTENTICADOR WHERE cuenta_id = ?').get(String(cuenta.cuenta_id));
  if (previo && previo.activo) return errorForbidden('Tu autenticador ya está activo. Si cambiaste de teléfono, pide que lo reinicien en el servidor.');
  const secreto = base32(crypto.randomBytes(20));
  d.prepare('INSERT INTO FIN_AUTENTICADOR (cuenta_id, secreto, activo, ultimo_contador, creado_en) VALUES (?,?,0,0,?) ' +
    'ON CONFLICT(cuenta_id) DO UPDATE SET secreto = excluded.secreto, activo = 0, ultimo_contador = 0, creado_en = excluded.creado_en')
    .run(String(cuenta.cuenta_id), cifrar(secreto), new Date().toISOString());
  registrar_({ cuenta_id: cuenta.cuenta_id, nombre: nombreDe_(cuenta, contexto), accion: 'AUTENTICADOR_PREPARADO', ip: ipDe_(contexto), equipo: equipoDe_(data) });
  const etiqueta = encodeURIComponent(EMISOR_TOTP + ':' + (cuenta.usuario || contexto.email));
  return {
    clave: secreto.replace(/(.{4})/g, '$1 ').trim(),
    uri: 'otpauth://totp/' + etiqueta + '?secret=' + secreto + '&issuer=' + encodeURIComponent(EMISOR_TOTP) + '&algorithm=SHA1&digits=6&period=' + PASO_TOTP_S
  };
}

// Verifica el código contra el secreto guardado y lo "consume" (no se puede repetir).
function consumirCodigo_(cuentaId, codigo, exigirActivo) {
  const d = dbFin();
  const a = d.prepare('SELECT * FROM FIN_AUTENTICADOR WHERE cuenta_id = ?').get(String(cuentaId));
  if (!a || (exigirActivo && !a.activo)) return { error: 'SIN_AUTENTICADOR' };
  const contador = verificarTotp_(descifrar(a.secreto), codigo, Date.now());
  if (contador === null || contador <= a.ultimo_contador) return { error: 'CODIGO' };
  d.prepare('UPDATE FIN_AUTENTICADOR SET ultimo_contador = ? WHERE cuenta_id = ?').run(contador, String(cuentaId));
  return { autenticador: a };
}

function ingresar_(db, data, contexto, activando) {
  if (!tieneAcceso(db, contexto)) return NO_ENCONTRADO;
  if (!llave_()) return errorForbidden('La bóveda todavía no tiene su llave configurada en el servidor.');
  const cuenta = cuentaDe_(db, contexto);
  const ahora = Date.now();
  const equipo = equipoDe_(data), ip = ipDe_(contexto), nombre = nombreDe_(cuenta, contexto);
  if (bloqueado_(cuenta.cuenta_id, ahora)) return errorForbidden('Demasiados códigos incorrectos. Espera 15 minutos.');
  const r = consumirCodigo_(cuenta.cuenta_id, data && data.codigo, !activando);
  if (r.error === 'SIN_AUTENTICADOR') return errorForbidden(activando ? 'Primero genera la clave del autenticador.' : 'Todavía no activas tu autenticador.');
  if (r.error) {
    const quedoBloqueado = anotarFallo_(cuenta.cuenta_id, ahora);
    registrar_({ cuenta_id: cuenta.cuenta_id, nombre, accion: 'CODIGO_INCORRECTO', detalle: quedoBloqueado ? 'bloqueo 15 min' : '', ip, equipo });
    return errorValidacion('codigo', quedoBloqueado ? 'Demasiados códigos incorrectos. Espera 15 minutos.' : 'El código no es correcto o ya se usó. Espera el siguiente.');
  }
  fallos_.delete(cuenta.cuenta_id);
  if (activando) {
    dbFin().prepare('UPDATE FIN_AUTENTICADOR SET activo = 1, activado_en = ? WHERE cuenta_id = ?').run(new Date().toISOString(), String(cuenta.cuenta_id));
    registrar_({ cuenta_id: cuenta.cuenta_id, nombre, accion: 'AUTENTICADOR_ACTIVADO', ip, equipo });
  }
  avisarSiInusual_(db, cuenta, contexto, equipo);
  const token = abrirSesion_(cuenta.cuenta_id, equipo, ip);
  registrar_({ cuenta_id: cuenta.cuenta_id, nombre, accion: 'ENTRAR', ip, equipo });
  return { boveda_token: token, inactividad_min: INACTIVIDAD_MS / 60000 };
}
function activarAutenticador(db, data, contexto) { return ingresar_(db, data, contexto, true); }
function entrar(db, data, contexto) { return ingresar_(db, data, contexto, false); }

function salir(db, data, contexto) {
  if (!tieneAcceso(db, contexto)) return NO_ENCONTRADO;
  if (data && data.boveda_token) {
    const r = dbFin().prepare('UPDATE FIN_SESIONES SET cerrada = 1 WHERE token_hash = ? AND cuenta_id = ? AND cerrada = 0')
      .run(hashToken_(data.boveda_token), String(contexto.cuenta_id));
    if (r.changes) registrar_({ cuenta_id: contexto.cuenta_id, nombre: nombreDe_(cuentaDe_(db, contexto), contexto), accion: 'SALIR', ip: ipDe_(contexto), equipo: equipoDe_(data) });
  }
  return { ok: true };
}

/**
 * Envoltorio para TODA acción con datos financieros: lista + bóveda abierta.
 * Renueva la inactividad y deja la acción en la bitácora.
 *   conBoveda('VER_BITACORA', fn)  ->  (db, data, contexto) => ...
 * fn recibe (db, data, contexto, { cuenta, nombre, registrar }).
 */
function conBoveda(accion, fn) {
  return function (db, data, contexto) {
    if (!tieneAcceso(db, contexto)) return NO_ENCONTRADO;
    if (!llave_()) return errorForbidden('La bóveda todavía no tiene su llave configurada en el servidor.');
    const ahora = Date.now();
    const s = sesionValida_(contexto.cuenta_id, data && data.boveda_token, ahora);
    if (!s) return { _forbidden: true, message: 'La bóveda se cerró. Ingresa tu código de nuevo.', boveda_cerrada: true };
    dbFin().prepare('UPDATE FIN_SESIONES SET ultimo_uso = ? WHERE token_hash = ?').run(ahora, s.token_hash);
    const cuenta = cuentaDe_(db, contexto);
    const nombre = nombreDe_(cuenta, contexto);
    const extra = {
      cuenta, nombre,
      registrar: (acc, detalle) => registrar_({ cuenta_id: contexto.cuenta_id, nombre, accion: acc, detalle, ip: ipDe_(contexto), equipo: equipoDe_(data) })
    };
    if (accion) extra.registrar(accion, '');
    return fn(db, data, contexto, extra);
  };
}

const bitacora = conBoveda('VER_BITACORA', function (db, data) {
  const limite = Math.min(Math.max(Number(data && data.limite) || 200, 1), 1000);
  const filas = dbFin().prepare('SELECT id, ts, cuenta_id, nombre, accion, detalle, ip, equipo FROM FIN_BITACORA ORDER BY id DESC LIMIT ?').all(limite);
  return { filas, cadena: verificarCadena_() };
});

/** Lo mínimo para la pantalla de inicio de la bóveda (Etapa 1: aún sin datos). */
const resumen = conBoveda('', function (db, data, contexto, x) {
  const ultimos = dbFin().prepare("SELECT ts, nombre, equipo FROM FIN_BITACORA WHERE accion = 'ENTRAR' ORDER BY id DESC LIMIT 6").all();
  const personas = dbFin().prepare("SELECT COUNT(*) AS n FROM FIN_AUTENTICADOR WHERE activo = 1").get().n;
  return { nombre: x.nombre, ultimos_ingresos: ultimos, autenticadores_activos: personas, personas_con_acceso: listaAcceso_().length, cadena: verificarCadena_() };
});

/** Herramienta del servidor: borra el autenticador de una cuenta (teléfono perdido). */
function reiniciarAutenticador_(cuentaId, motivo) {
  const r = dbFin().prepare('DELETE FROM FIN_AUTENTICADOR WHERE cuenta_id = ?').run(String(cuentaId));
  dbFin().prepare('UPDATE FIN_SESIONES SET cerrada = 1 WHERE cuenta_id = ?').run(String(cuentaId));
  registrar_({ cuenta_id: cuentaId, accion: 'AUTENTICADOR_REINICIADO', detalle: String(motivo || 'desde el servidor') });
  return r.changes;
}

module.exports = {
  NO_ENCONTRADO, tieneAcceso, conBoveda, cifrar, descifrar, dbFin,
  estado, prepararAutenticador, activarAutenticador, entrar, salir, bitacora, resumen,
  // pruebas / herramientas
  codigoTotp, base32, desdeBase32, contadorActual_, verificarCadena_, reiniciarAutenticador_, reiniciarParaPruebas_
};
