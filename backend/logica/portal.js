'use strict';

/**
 * portal.js — puerto de backend/intake/Portal.gs (login/logout/sesion/
 * cambiarPassword). Misma logica, mismos mensajes (la respuesta de usuario
 * inexistente y de clave mala es LA MISMA a proposito: no se filtra que
 * usuarios existen).
 *
 * Diferencias reales con el .gs (no cosmeticas, documentadas donde importan):
 *  - hash de contraseñas: scrypt en vez de SHA-256 iterado (ver
 *    passwordHash.js).
 *  - limite de intentos y sesiones: sin CacheService (ver sesiones.js).
 */

const { actualizarFilaPorId_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { errorValidacion, errorForbidden } = require('./errores');
const Hash = require('./passwordHash');
const Sesiones = require('./sesiones');

function normalizarUsuario(usuario) {
  return String(usuario || '').trim().toLowerCase();
}

function parsearListaPortal(valor) {
  if (!valor) return [];
  if (Array.isArray(valor)) return valor;
  try {
    const lista = JSON.parse(valor);
    return Array.isArray(lista) ? lista : [];
  } catch (err) {
    return [];
  }
}

function buscarCuentaPorUsuario(db, usuario) {
  return leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL)
    .find((c) => normalizarUsuario(c.usuario) === usuario) || null;
}

// Relleno para cuando el usuario no existe: sin esto, Hash.coincide (scrypt,
// deliberadamente costoso) solo se calcula si la cuenta existe -- el tiempo
// de respuesta delataria qué usuarios existen aunque el MENSAJE de error sea
// igual a proposito (ver cabecera del archivo). Se calcula una sola vez al
// cargar el modulo, no en cada login.
const SALT_RELLENO_LOGIN = 'relleno-anti-timing-no-es-una-cuenta-real';
const HASH_RELLENO_LOGIN = Hash.hashPassword('relleno-sin-significado', SALT_RELLENO_LOGIN);

// Perfil que viaja al navegador: SOLO lo que el shell necesita. Nunca el
// hash ni la sal.
function perfilPublico(cuenta) {
  return {
    cuenta_id: cuenta.cuenta_id,
    usuario: cuenta.usuario,
    nombre: cuenta.nombre,
    cargo: cuenta.cargo,
    emails: parsearListaPortal(cuenta.emails),
    rol: cuenta.rol,
    modulos: parsearListaPortal(cuenta.modulos),
    empresa_id: cuenta.empresa_id,
    debe_cambiar_password: cuenta.debe_cambiar_password === true || cuenta.debe_cambiar_password === 'TRUE' || cuenta.debe_cambiar_password === 1
  };
}

function login(db, data, ip) {
  const usuario = normalizarUsuario(data.usuario);
  const password = String(data.password || '');
  if (!usuario || !password) {
    return errorValidacion('usuario', 'Indica tu usuario y contrasena.');
  }

  if (Sesiones.loginBloqueado(usuario, ip)) {
    return errorForbidden('Demasiados intentos fallidos. Espera 10 minutos e intenta de nuevo.');
  }

  const cuenta = buscarCuentaPorUsuario(db, usuario);
  // Hash.coincide corre SIEMPRE, exista o no la cuenta -- de lo contrario el
  // costo del scrypt (solo pagado cuando hay cuenta real) delataria por
  // tiempo lo que RN-030/el mensaje generico ya se cuidan de no delatar.
  const passwordCoincide = Hash.coincide(
    password,
    cuenta ? cuenta.salt : SALT_RELLENO_LOGIN,
    cuenta ? cuenta.hash_password : HASH_RELLENO_LOGIN
  );
  const hashCorrecto = cuenta && Sesiones.esCuentaActiva(cuenta) && passwordCoincide;

  if (!hashCorrecto) {
    Sesiones.registrarIntentoFallido(usuario, ip);
    return errorForbidden('Usuario o contrasena incorrectos.');
  }

  Sesiones.limpiarIntentos(usuario, ip);
  const token = Sesiones.crearSesion(db, cuenta.cuenta_id);
  actualizarFilaPorId_(db, 'CUENTAS_PORTAL', 'cuenta_id', cuenta.cuenta_id, {
    ultimo_acceso: new Date().toISOString()
  });

  return { token: token, cuenta: perfilPublico(cuenta) };
}

function logout(db, data) {
  if (data.token) Sesiones.revocarSesion(db, data.token);
  return { ok: true };
}

function sesion(db, data) {
  const cuenta = Sesiones.resolverCuentaPorToken(db, data.token);
  if (!cuenta) return errorForbidden('Sesion invalida o expirada. Ingresa de nuevo.');
  return { cuenta: perfilPublico(cuenta) };
}

function cambiarPassword(db, data) {
  const cuenta = Sesiones.resolverCuentaPorToken(db, data.token);
  if (!cuenta) return errorForbidden('Sesion invalida o expirada. Ingresa de nuevo.');
  if (!Hash.coincide(String(data.password_actual || ''), cuenta.salt, cuenta.hash_password)) {
    return errorForbidden('La contrasena actual no es correcta.');
  }
  const nueva = String(data.password_nueva || '');
  if (nueva.length < 8) {
    return errorValidacion('password_nueva', 'La contrasena nueva debe tener al menos 8 caracteres.');
  }
  if (nueva === String(data.password_actual)) {
    return errorValidacion('password_nueva', 'La contrasena nueva debe ser distinta de la actual.');
  }

  const salt = Hash.generarSalt();
  actualizarFilaPorId_(db, 'CUENTAS_PORTAL', 'cuenta_id', cuenta.cuenta_id, {
    salt: salt,
    hash_password: Hash.hashPassword(nueva, salt),
    debe_cambiar_password: false
  });
  return { ok: true };
}

module.exports = { login, logout, sesion, cambiarPassword, perfilPublico, parsearListaPortal, normalizarUsuario };
