'use strict';

/**
 * sesiones.js — puerto de la parte de sesiones de backend/intake/Portal.gs
 * (crearSesion_/resolverCuentaPorToken_/purgarSesionesExpiradas_), con una
 * simplificacion deliberada: en el .gs, CacheService envuelve la lectura de
 * SESIONES_PORTAL porque cada lectura a Sheets es un round-trip de red
 * (~50-200ms) y esta es la ruta mas transitada del sistema (toda peticion
 * autenticada pasa por aqui). Esa razon de ser desaparece en SQLite: una
 * lectura local tarda microsegundos, asi que la capa de cache no protege
 * nada que valga la complejidad de portarla. Se porta solo la logica real
 * (expiracion, revocacion), no la optimizacion que ya no aplica.
 *
 * El limite anti fuerza bruta (5 intentos -> 10 min) SI se porta: no es una
 * cache de rendimiento, es una defensa de seguridad. En Apps Script vive en
 * CacheService (compartido entre TODAS las ejecuciones); aqui vive en un Map
 * en memoria del proceso -- valido mientras el backend siga siendo un solo
 * proceso Node en un VPS (que es el diseño actual). Si el dia de manana hay
 * mas de un proceso detras de un balanceador, este contador dejaria de ser
 * compartido entre ellos y habria que moverlo a la base de datos; documentado
 * aqui para no olvidarlo si ese dia llega.
 */

const { agregarFila_, actualizarFilaPorId_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { generarToken } = require('./passwordHash');

const SESION_HORAS = 12;
const HORAS_ENLACE_MAGICO = 24 * 30;
const MAX_INTENTOS_LOGIN = 5;
const BLOQUEO_LOGIN_MS = 600 * 1000;

// usuario (normalizado) -> { intentos, bloqueadoHasta }. Vive mientras viva
// el proceso -- ver la nota de arriba sobre por que eso es aceptable hoy.
const intentosLogin = new Map();

function loginBloqueado(usuario) {
  const registro = intentosLogin.get(usuario);
  if (!registro) return false;
  if (registro.intentos < MAX_INTENTOS_LOGIN) return false;
  if (Date.now() > registro.bloqueadoHasta) {
    intentosLogin.delete(usuario);
    return false;
  }
  return true;
}

function registrarIntentoFallido(usuario) {
  const registro = intentosLogin.get(usuario) || { intentos: 0, bloqueadoHasta: 0 };
  registro.intentos += 1;
  registro.bloqueadoHasta = Date.now() + BLOQUEO_LOGIN_MS;
  intentosLogin.set(usuario, registro);
}

function limpiarIntentos(usuario) {
  intentosLogin.delete(usuario);
}

function crearSesion(db, cuentaId, horas) {
  const token = generarToken();
  agregarFila_(db, 'SESIONES_PORTAL', {
    token: token,
    cuenta_id: cuentaId,
    expira: new Date(Date.now() + (horas || SESION_HORAS) * 3600 * 1000).toISOString(),
    creada: new Date().toISOString()
  });
  return token;
}

function crearEnlaceMagico(db, cuentaId) {
  return crearSesion(db, cuentaId, HORAS_ENLACE_MAGICO);
}

function esCuentaActiva(cuenta) {
  return cuenta.activo === true || cuenta.activo === 'TRUE' || cuenta.activo === 1;
}

/** Cuenta activa duena de un token vigente, o null. La hoja/tabla manda. */
function resolverCuentaPorToken(db, token) {
  if (!token) return null;
  const sesion = leerFilas_(db, 'SESIONES_PORTAL', COLUMNAS.SESIONES_PORTAL)
    .find((s) => s.token === token);
  if (!sesion || new Date(sesion.expira).getTime() <= Date.now()) return null;

  const cuenta = leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL)
    .find((c) => c.cuenta_id === sesion.cuenta_id);
  return cuenta && esCuentaActiva(cuenta) ? cuenta : null;
}

function revocarSesion(db, token) {
  if (!token) return;
  actualizarFilaPorId_(db, 'SESIONES_PORTAL', 'token', token, { expira: new Date(0).toISOString() });
}

/** Equivalente de purgarSesionesExpiradas_ (Triggers.gs, pase diario). */
function purgarExpiradas(db) {
  const ahora = Date.now();
  const expiradas = leerFilas_(db, 'SESIONES_PORTAL', COLUMNAS.SESIONES_PORTAL)
    .filter((s) => !s.expira || new Date(s.expira).getTime() <= ahora);
  const { eliminarFilasPorId_ } = require('../db/sqliteRepo');
  let borradas = 0;
  expiradas.forEach((s) => { borradas += eliminarFilasPorId_(db, 'SESIONES_PORTAL', 'token', s.token); });
  return { borradas };
}

module.exports = {
  loginBloqueado, registrarIntentoFallido, limpiarIntentos,
  crearSesion, crearEnlaceMagico, resolverCuentaPorToken, revocarSesion, purgarExpiradas,
  esCuentaActiva
};
