'use strict';

/**
 * directorioPersonal.js — puerto de directorioPersonalActivo_
 * (backend/backoffice/Notificaciones.gs). Personal ACTIVO con identidad en
 * SIGSO (USUARIOS + CUENTAS_PORTAL), deduplicado por email. Se extrae a su
 * propio modulo (en el .gs vivia suelta por scope global de Apps Script)
 * porque el SGC la necesita para "Accesos"/"Matriz de distribución" y no es
 * exclusiva de Notificaciones -- un solo dueño, nunca duplicada.
 */

const { leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Portal = require('./portal');

function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }

function directorioPersonalActivo_(db) {
  const personas = {};
  leerFilas_(db, 'USUARIOS', COLUMNAS.USUARIOS).forEach((u) => {
    if (!esVerdadero_(u.activo) || !u.email) return;
    personas[String(u.email).toLowerCase()] = { email: u.email, nombre: u.nombre || u.email, empresa_id: u.empresa_id || '', origen: 'Backoffice (Google)' };
  });
  leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL).forEach((c) => {
    if (!esVerdadero_(c.activo)) return;
    Portal.parsearListaPortal(c.emails).forEach((email) => {
      const correo = String(email || '').trim();
      if (!correo) return;
      const clave = correo.toLowerCase();
      if (!personas[clave]) personas[clave] = { email: correo, nombre: c.nombre || correo, empresa_id: c.empresa_id || '', origen: 'Plataforma (portal)' };
    });
  });
  return Object.values(personas);
}

module.exports = { directorioPersonalActivo_ };
