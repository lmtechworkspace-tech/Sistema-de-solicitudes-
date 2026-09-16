'use strict';

/**
 * schema.js — equivalente Node del Instalador de Apps Script (backend/setup):
 * declara las tablas y las crea si faltan, sin tocar las que ya existen.
 *
 * Mismos nombres de columna que COLUMNAS en backend/backoffice/Constantes.gs
 * -- se van agregando aqui a medida que se porta cada modulo de logica,
 * empezando por Catalogos.
 */

const { asegurarTabla_ } = require('./sqliteRepo');

const COLUMNAS = {
  CAT_EMPRESAS: ['empresa_id', 'nombre', 'logo', 'activo'],
  CAT_PLATAFORMAS: ['plataforma_id', 'nombre', 'empresa_id', 'url_base', 'activo'],
  CAT_MODULOS: ['modulo_id', 'nombre', 'plataforma_id', 'modulo_padre_id', 'activo'],
  CAT_TIPOS: ['tipo_id', 'nombre', 'prioridad_default', 'activo', 'es_urgente'],
  CAT_AREAS: ['area_id', 'nombre', 'responsable_email', 'activo'],
  CONFIG_NOTIFICACIONES: ['notif_id', 'evento', 'rol_destinatario', 'emails_extra', 'activo'],
  // v3.3 (§2.4): cuentas e identidad de la plataforma (Portal.gs/
  // CuentasPortal.gs). hash_password nunca guarda la clave en claro --
  // ver backend/logica/passwordHash.js sobre el cambio de algoritmo.
  CUENTAS_PORTAL: [
    'cuenta_id', 'usuario', 'nombre', 'cargo',
    'hash_password', 'salt', 'emails', 'rol', 'modulos',
    'empresa_id', 'activo', 'debe_cambiar_password',
    'ultimo_acceso', 'creado_por'
  ],
  SESIONES_PORTAL: ['token', 'cuenta_id', 'expira', 'creada']
};

function asegurarEsquema(db) {
  Object.keys(COLUMNAS).forEach((hoja) => asegurarTabla_(db, hoja, COLUMNAS[hoja]));
}

module.exports = { COLUMNAS, asegurarEsquema };
