'use strict';

/**
 * catalogos.js — puerto directo de backend/backoffice/Catalogos.gs (CU-006,
 * RF-019, §4.2). Misma logica exacta, mismos casos de prueba (ver
 * backend/test/catalogos-porteo.test.js, portados de
 * backend/test/catalogos-admin.test.js): CRUD sobre los catalogos
 * administrables (crear si no existe, actualizar si existe; "desactivar" es
 * la misma operacion con activo=false -- los catalogos nunca se eliminan).
 *
 * Unica diferencia real con el .gs: en Apps Script leerFilas_/agregarFila_/
 * actualizarFilaPorId_ son globales que ya saben a que spreadsheet ir; aqui
 * reciben `db` como primer argumento explicito (no hay estado global de
 * modulo entre requests en un server Node).
 *
 * Permisos por tipo de catalogo (Actor Admin/Analista, doc 5 v1.0):
 * Admin administra los 4; Analista solo Modulos y Tipos ("nivel basico").
 */

const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { errorValidacion, errorForbidden } = require('./errores');
const { COLUMNAS } = require('../db/schema');

const CATALOGOS_CONFIG = {
  EMPRESA: { hoja: 'CAT_EMPRESAS', idCampo: 'empresa_id', roles: ['ADM'] },
  PLATAFORMA: { hoja: 'CAT_PLATAFORMAS', idCampo: 'plataforma_id', roles: ['ADM'] },
  MODULO: { hoja: 'CAT_MODULOS', idCampo: 'modulo_id', roles: ['ADM', 'ANA'] },
  TIPO: { hoja: 'CAT_TIPOS', idCampo: 'tipo_id', roles: ['ADM', 'ANA'] },
  // v3.0 (Fase 1, multi-responsable): areas -> responsable. Solo Admin: a
  // quien se le rutean las solicitudes es una decision de gobierno, no de
  // operacion diaria (mismo criterio que empresas/plataformas).
  AREA: { hoja: 'CAT_AREAS', idCampo: 'area_id', roles: ['ADM'] },
  // P12 (v2.0, Sprint 3): CONFIG_NOTIFICACIONES via el mismo CRUD generico
  // -- solo Admin, es una decision de gobierno (C2), no de operacion diaria.
  NOTIFICACION: { hoja: 'CONFIG_NOTIFICACIONES', idCampo: 'notif_id', roles: ['ADM'] }
};

function guardar(db, data, contexto) {
  const config = CATALOGOS_CONFIG[data.tipo];
  if (!config) {
    return errorValidacion('tipo', 'Tipo de catalogo desconocido: ' + data.tipo);
  }
  if (config.roles.indexOf(contexto.rol) === -1) {
    return errorForbidden('El rol ' + contexto.rol + ' no puede administrar el catalogo ' + data.tipo + '.');
  }
  if (!data.registro || !data.registro[config.idCampo]) {
    return errorValidacion(config.idCampo, 'Falta el identificador del registro (' + config.idCampo + ').');
  }

  const actualizado = actualizarFilaPorId_(db, config.hoja, config.idCampo, data.registro[config.idCampo], data.registro);
  if (actualizado) {
    return actualizado;
  }
  agregarFila_(db, config.hoja, data.registro);
  return data.registro;
}

/**
 * Lista TODAS las filas de un catalogo (activas e inactivas) para el panel
 * de administracion (§12.6, CU-006) -- a diferencia del catalogo publico de
 * Intake, que solo expone activos al formulario.
 */
function listar(db, data, contexto) {
  const config = CATALOGOS_CONFIG[data.tipo];
  if (!config) {
    return errorValidacion('tipo', 'Tipo de catalogo desconocido: ' + data.tipo);
  }
  if (config.roles.indexOf(contexto.rol) === -1) {
    return errorForbidden('El rol ' + contexto.rol + ' no puede ver el catalogo ' + data.tipo + '.');
  }
  return leerFilas_(db, config.hoja, COLUMNAS[config.hoja]);
}

module.exports = { CATALOGOS_CONFIG, guardar, listar };
