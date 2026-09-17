'use strict';

/**
 * bootstrap.js — herramienta TEMPORAL: crea/resetea UNA cuenta ADM para
 * poder arrancar la migracion de datos (gestionarCuentaPortal/
 * importarDatosMigracion ya exigen una sesion ADM -- huevo y gallina la
 * primera vez que no hay ninguna clave ADM utilizable a mano).
 *
 * Publica a proposito (no hay sesion ADM todavia que la proteja), pero
 * inutil sin el secreto: MIGRACION_BOOTSTRAP_SECRET vive SOLO como variable
 * de entorno del servicio en el VPS (igual que RESEND_API_KEY), nunca en el
 * codigo. Sin esa variable configurada, la accion siempre falla -- seguro
 * por defecto en cualquier otro ambiente (dev, CI, tests).
 *
 * Se puede (y se debe) borrar este archivo y su entrada en router.js, y
 * quitar la variable de entorno del VPS, en cuanto termine la migracion.
 */

const { agregarFila_, leerFilas_, eliminarFilasPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { errorValidacion } = require('./errores');
const Hash = require('./passwordHash');

function bootstrapAdmin(db, data) {
  const secreto = process.env.MIGRACION_BOOTSTRAP_SECRET;
  if (!secreto || !data || data.secreto !== secreto) {
    return errorValidacion('secreto', 'Secreto invalido o no configurado.');
  }

  const usuario = 'migracion-admin';
  // Reemplaza cualquier cuenta previa con este mismo usuario (reintentos
  // idempotentes: correr esto dos veces no deja cuentas duplicadas).
  leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL)
    .filter((c) => c.usuario === usuario)
    .forEach((c) => eliminarFilasPorId_(db, 'CUENTAS_PORTAL', 'cuenta_id', c.cuenta_id));

  const claveTemporal = Hash.generarClaveTemporal();
  const salt = Hash.generarSalt();
  agregarFila_(db, 'CUENTAS_PORTAL', {
    cuenta_id: require('node:crypto').randomUUID(),
    usuario: usuario,
    nombre: 'Cuenta de migracion (temporal)',
    cargo: '',
    hash_password: Hash.hashPassword(claveTemporal, salt),
    salt: salt,
    emails: JSON.stringify(['migracion@ctrly.cl']),
    rol: 'ADM',
    modulos: JSON.stringify(['administracion']),
    empresa_id: '',
    activo: true,
    debe_cambiar_password: false,
    ultimo_acceso: '',
    creado_por: 'bootstrap'
  });

  return { usuario: usuario, password_temporal: claveTemporal };
}

module.exports = { bootstrapAdmin };
