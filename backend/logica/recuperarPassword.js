'use strict';

/**
 * recuperarPassword.js — flujo de "olvidé mi contraseña" (nuevo: no existía
 * en ningún lado de Apps Script, confirmado por búsqueda exhaustiva en el
 * documento "Arquitectura de Accesos", 2026-09-19, §06). Antes de este
 * módulo, la única forma de recuperar el acceso era pedirle a un Admin que
 * reseteara la clave a mano (cuentasPortal.js: resetearPassword/
 * asignarPassword) -- eso sigue existiendo, este módulo agrega el camino
 * de autoservicio.
 *
 * ANTI-ENUMERACIÓN: solicitarRecuperacion responde SIEMPRE el mismo
 * mensaje -- exista o no la cuenta, esté activa o no, esté o no bloqueada
 * por el límite de envíos -- mismo criterio que portal.login (nunca se
 * revela qué identificadores existen).
 *
 * EL TOKEN NUNCA SE GUARDA EN CLARO: se guarda su hash (RESETS_PASSWORD.
 * token_hash, ver passwordHash.hashToken -- SHA-256, no scrypt: el token
 * es de alta entropía, no una contraseña de baja entropía que alguien
 * eligió). Una lectura de la tabla no alcanza para usar un enlace ajeno.
 *
 * LÍMITE DE ENVÍOS PERSISTIDO EN LA BASE DE DATOS, no en memoria (a
 * diferencia del freno de login en sesiones.js): cada solicitud real
 * dispara un correo por Resend, que en el plan gratuito da 100/día para
 * TODO SIGSO -- un límite en memoria de proceso no protegería esa cuota
 * compartida si el proceso se reinicia. El límite es por CUENTA, no por
 * identificador ni IP: da igual con qué correo/usuario se pida, lo que
 * hay que proteger es que una misma cuenta no dispare de más.
 */

const crypto = require('node:crypto');
const { agregarFila_, leerFilas_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { errorValidacion, errorForbidden } = require('./errores');
const Hash = require('./passwordHash');
const Sesiones = require('./sesiones');
const { parsearListaPortal, normalizarUsuario } = require('./portal');
const Notificaciones = require('./notificaciones');

const MINUTOS_VIGENCIA_TOKEN = 45;
const MAX_SOLICITUDES_POR_CUENTA = 3;
const VENTANA_LIMITE_MINUTOS = 60;

const RESPUESTA_GENERICA = {
  ok: true,
  message: 'Si el usuario o correo existe, te llegará un enlace para restablecer tu contraseña. Revisa tu bandeja (y spam).'
};

function normalizarIdentificador_(valor) {
  return String(valor || '').trim().toLowerCase();
}

function buscarCuentaPorIdentificador_(db, identificador) {
  return leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL).find((c) => {
    if (normalizarUsuario(c.usuario) === identificador) return true;
    return parsearListaPortal(c.emails).some((e) => normalizarIdentificador_(e) === identificador);
  }) || null;
}

function excedeLimite_(db, cuentaId) {
  const desde = Date.now() - VENTANA_LIMITE_MINUTOS * 60000;
  const recientes = leerFilas_(db, 'RESETS_PASSWORD', COLUMNAS.RESETS_PASSWORD)
    .filter((r) => r.cuenta_id === cuentaId && new Date(r.creado_en).getTime() > desde);
  return recientes.length >= MAX_SOLICITUDES_POR_CUENTA;
}

function urlRecuperacion_(token) {
  const base = process.env.PORTAL_URL || 'https://lmtechworkspace-tech.github.io/Sistema-de-solicitudes-/plataforma.html';
  return base + '?reset=' + encodeURIComponent(token);
}

// Piso de tiempo de respuesta: sin esto, una identificador que no existe (o
// una cuenta inactiva/con limite excedido) responde casi al instante,
// mientras una cuenta real espera el envio real por Resend (await) antes de
// responder -- el MENSAJE es identico a proposito (ver cabecera del
// archivo), pero el TIEMPO delataria igual que cuenta existe. Se pareja el
// tiempo total, no el trabajo: no tiene sentido enviar un correo de mentira.
const RESPUESTA_MINIMA_MS = 400;

function esperar_(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function solicitarRecuperacion(db, data) {
  const inicio = Date.now();
  const resultado = await solicitarRecuperacionInterna_(db, data);
  const faltante = RESPUESTA_MINIMA_MS - (Date.now() - inicio);
  if (faltante > 0) await esperar_(faltante);
  return resultado;
}

async function solicitarRecuperacionInterna_(db, data) {
  const identificador = normalizarIdentificador_(data && data.identificador);
  if (!identificador) return RESPUESTA_GENERICA;

  const cuenta = buscarCuentaPorIdentificador_(db, identificador);
  if (!cuenta || !Sesiones.esCuentaActiva(cuenta)) return RESPUESTA_GENERICA;
  if (excedeLimite_(db, cuenta.cuenta_id)) return RESPUESTA_GENERICA;

  const destinatario = parsearListaPortal(cuenta.emails)[0];
  if (!destinatario) return RESPUESTA_GENERICA;

  const tokenCrudo = Hash.generarToken();
  const resetId = crypto.randomUUID();
  agregarFila_(db, 'RESETS_PASSWORD', {
    reset_id: resetId,
    cuenta_id: cuenta.cuenta_id,
    token_hash: Hash.hashToken(tokenCrudo),
    creado_en: new Date().toISOString(),
    expira: new Date(Date.now() + MINUTOS_VIGENCIA_TOKEN * 60000).toISOString(),
    usado: false
  });

  await Notificaciones.enviarCorreoRecuperacion(db, destinatario, resetId, urlRecuperacion_(tokenCrudo), MINUTOS_VIGENCIA_TOKEN);
  return RESPUESTA_GENERICA;
}

function esUsado_(valor) {
  return valor === true || valor === 'TRUE' || valor === 1;
}

async function restablecerPassword(db, data) {
  const tokenCrudo = String((data && data.token) || '');
  const nueva = String((data && data.password_nueva) || '');
  if (!tokenCrudo) return errorValidacion('token', 'Falta el enlace de recuperación.');
  if (nueva.length < 8) return errorValidacion('password_nueva', 'La contraseña nueva debe tener al menos 8 caracteres.');

  const hash = Hash.hashToken(tokenCrudo);
  const solicitud = leerFilas_(db, 'RESETS_PASSWORD', COLUMNAS.RESETS_PASSWORD).find((r) => r.token_hash === hash);
  if (!solicitud || esUsado_(solicitud.usado)) {
    return errorForbidden('Este enlace ya no es válido. Solicita uno nuevo.');
  }
  if (new Date(solicitud.expira).getTime() <= Date.now()) {
    return errorForbidden('Este enlace expiró. Solicita uno nuevo.');
  }

  const cuenta = leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL).find((c) => c.cuenta_id === solicitud.cuenta_id);
  if (!cuenta || !Sesiones.esCuentaActiva(cuenta)) {
    return errorForbidden('Esta cuenta ya no está disponible.');
  }

  const salt = Hash.generarSalt();
  actualizarFilaPorId_(db, 'CUENTAS_PORTAL', 'cuenta_id', cuenta.cuenta_id, {
    salt,
    hash_password: Hash.hashPassword(nueva, salt),
    debe_cambiar_password: false
  });
  actualizarFilaPorId_(db, 'RESETS_PASSWORD', 'reset_id', solicitud.reset_id, { usado: true });

  // Si alguien (el dueño en otro dispositivo, o quien haya tenido la
  // clave vieja) seguía con una sesión abierta, queda fuera.
  Sesiones.revocarSesionesDeCuenta(db, cuenta.cuenta_id);

  return { ok: true };
}

module.exports = { solicitarRecuperacion, restablecerPassword };
