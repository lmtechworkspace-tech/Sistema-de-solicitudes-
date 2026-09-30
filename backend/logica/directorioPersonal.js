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

// Una fila por CUENTA activa, con su correo principal (el primero), su rol y
// su empresa: para los avisos que van "a Gerencia", "a los ADM de la empresa",
// etc. Una persona con dos correos recibe UNA vez. Antes esto se leía de
// USUARIOS (Google): quien tenía el rol solo en su cuenta del portal (caso
// real: una cuenta GERENCIA creada después del apagado) no recibía nada.
function cuentasActivasConRol_(db) {
  const lista = [];
  leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL).forEach((c) => {
    if (!esVerdadero_(c.activo)) return;
    const principal = Portal.parsearListaPortal(c.emails).map((e) => String(e || '').trim()).filter(Boolean)[0];
    if (principal) lista.push({ email: principal, nombre: c.nombre || principal, rol: c.rol || '', empresa_id: c.empresa_id || '' });
  });
  return lista;
}

// Correos de las cuentas activas con alguno de esos roles (y de esa empresa, si se indica).
function emailsPorRol_(db, roles, empresaId) {
  return cuentasActivasConRol_(db)
    .filter((c) => roles.indexOf(c.rol) !== -1 && (empresaId === undefined || c.empresa_id === empresaId))
    .map((c) => c.email);
}

module.exports = { directorioPersonalActivo_, cuentasActivasConRol_, emailsPorRol_ };
