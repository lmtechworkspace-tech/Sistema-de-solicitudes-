'use strict';

/**
 * directorioPersonal.js — el personal ACTIVO que puede entrar a SIGSO: un
 * correo por fila (las cuentas con varios correos aparecen una vez por cada
 * uno, porque los roles del SGC, los acuses y las alertas van por correo).
 * Lo usan Calidad ("Accesos", "Matriz de distribución", confidenciales) y
 * Notificaciones ("Enviar alerta", "Alertas en vivo").
 *
 * 2026-09-30: sale solo de CUENTAS_PORTAL. Antes también leía USUARIOS (la
 * identidad de Google de Apps Script); desde el apagado del 2026-09-27 esas
 * personas ya no pueden entrar, así que aparecían en Accesos y recibían
 * alertas con correos que nadie usa (caso medido: el correo viejo de una
 * persona que hoy entra con otro). El nombre viene del Directorio de Personas
 * cuando está, para que sea el mismo en todo SIGSO.
 */

const { leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Portal = require('./portal');
const Directorio = require('./directorioPersonas');

function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }

function directorioPersonalActivo_(db) {
  const personas = {};
  const cuentas = leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL).filter((c) => esVerdadero_(c.activo));
  const correos = [];
  cuentas.forEach((c) => Portal.parsearListaPortal(c.emails).forEach((e) => correos.push(e)));
  const canonico = Directorio.resolverVarios(db, correos);
  cuentas.forEach((c) => {
    Portal.parsearListaPortal(c.emails).forEach((email) => {
      const correo = String(email || '').trim();
      if (!correo) return;
      const clave = correo.toLowerCase();
      const p = canonico[clave];
      if (!personas[clave]) personas[clave] = { email: correo, nombre: (p && p.nombre) || c.nombre || correo, empresa_id: c.empresa_id || '', origen: 'Plataforma (portal)' };
    });
  });
  return Object.values(personas);
}

module.exports = { directorioPersonalActivo_ };
