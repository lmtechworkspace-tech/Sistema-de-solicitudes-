'use strict';

/**
 * sistema.js — puerto de getEstadoSistema (backend/backoffice/Code.gs):
 * el panel de diagnóstico de Administración, ADM-only. `diagnosticarEsquema_`
 * ya vivía portado en db/sqliteRepo.js (mismo contrato que
 * backend/backoffice/SheetsRepo.gs) -- este módulo solo lo expone como
 * acción, con el guardia de rol.
 */

const { COLUMNAS } = require('../db/schema');
const { diagnosticarEsquema_ } = require('../db/sqliteRepo');

// Única fuente de verdad de la versión del backend Node -- backend/server/
// app.js la reusa para /v1/estado, en vez de mantener dos constantes que
// puedan desincronizarse.
const VERSION_BACKEND = '1.0.0-poc';

function getEstadoSistema(db, data, contexto) {
  if (!contexto || contexto.rol !== 'ADM') {
    return { _forbidden: true, message: 'Solo Admin puede ver el estado del sistema.' };
  }
  const esquema = diagnosticarEsquema_(db, COLUMNAS);
  // El texto de "accion" del .gs referenciaba el Instalador de Apps
  // Script (actualizarEsquema) -- no existe en Node. Aqui la accion real
  // es tocar backend/db/schema.js y desplegar (asegurarTabla_ solo CREA
  // tablas nuevas, nunca agrega columnas a una tabla ya existente).
  if (esquema.accion) {
    esquema.accion = 'Revisa backend/db/schema.js y el proceso de despliegue -- faltan tablas o columnas que el código ya espera.';
  }
  return { version_backend: VERSION_BACKEND, esquema };
}

module.exports = { getEstadoSistema, VERSION_BACKEND };
