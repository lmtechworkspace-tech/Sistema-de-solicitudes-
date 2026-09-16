'use strict';

/**
 * passwordHash.js — MEJORA deliberada respecto del .gs original, no un
 * puerto 1:1.
 *
 * backend/intake/Portal.gs (hashPassword_) y backend/backoffice/
 * CuentasPortal.gs (hashPasswordPortal_) usan SHA-256 iterado 1000 veces con
 * sal -- documentado ahi mismo como "lo mejor disponible en Apps Script"
 * (sin acceso a bcrypt/argon2/scrypt). Eso ya no es una limitacion: Node
 * trae scrypt en node:crypto, sin dependencias, y es memory-hard (mucho mas
 * caro de atacar por fuerza bruta con GPU que SHA-256 iterado, que es barato
 * de paralelizar).
 *
 * Se hace el cambio AHORA, antes de migrar ninguna cuenta real al nuevo
 * ecosistema: cambiar el esquema de hash despues de que existan cuentas
 * reales obligaria a resetear la clave de todo el mundo (el hash viejo no
 * se puede "mejorar" sin la clave en claro). Hacerlo ahora es gratis.
 *
 * Comparacion en tiempo constante (timingSafeEqual): el .gs original compara
 * los hashes con ===, que corta apenas encuentra una diferencia -- una
 * filtracion de tiempo teorica que en Node es igual de facil de evitar.
 */

const crypto = require('node:crypto');

const LARGO_HASH = 64;

function generarSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), String(salt), LARGO_HASH).toString('hex');
}

function coincide(password, salt, hashGuardado) {
  const calculado = Buffer.from(hashPassword(password, salt), 'hex');
  const guardado = Buffer.from(String(hashGuardado || ''), 'hex');
  if (calculado.length !== guardado.length) return false;
  return crypto.timingSafeEqual(calculado, guardado);
}

function generarToken() {
  return crypto.randomUUID();
}

// 10 caracteres legibles (sin 0/O/1/l/I que se confunden al dictarla por
// telefono o WhatsApp) -- identico al criterio del .gs original.
const ABECEDARIO_CLAVE = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generarClaveTemporal() {
  const bytes = crypto.randomBytes(10);
  let clave = '';
  for (let i = 0; i < 10; i++) {
    clave += ABECEDARIO_CLAVE.charAt(bytes[i] % ABECEDARIO_CLAVE.length);
  }
  return clave;
}

module.exports = { generarSalt, hashPassword, coincide, generarToken, generarClaveTemporal };
