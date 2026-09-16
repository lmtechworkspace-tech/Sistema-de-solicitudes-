'use strict';

/**
 * router.js — equivalente de BACKOFFICE_ACTIONS + responderResultado_ en
 * backend/backoffice/Code.gs: un mapa accion -> funcion de logica, y una
 * traduccion uniforme del resultado a {status, body} HTTP.
 *
 * Misma forma exacta que ya usa el frontend (api.js) contra Apps Script:
 * { ok:true, data } en exito, { ok:false, error, message, fields? } en
 * validacion/permiso -- asi que cuando se apunte api.js a este servidor no
 * hace falta tocarlo.
 *
 * `contexto` (rol, email) llega YA resuelto por quien llama a ejecutarAccion
 * -- la resolucion de identidad real (equivalente a Auth.gs / USUARIOS) es
 * su propio modulo, todavia no portado. Documentado en vez de fingido.
 */

const Catalogos = require('../logica/catalogos');

const ACCIONES = {
  guardarCatalogo: (db, data, contexto) => Catalogos.guardar(db, data, contexto),
  listarCatalogo: (db, data, contexto) => Catalogos.listar(db, data, contexto)
};

function responderResultado_(resultado) {
  if (resultado && resultado._validationError) {
    return { status: 400, body: { ok: false, error: 'validation', message: resultado.message, fields: resultado.fields } };
  }
  if (resultado && resultado._forbidden) {
    return { status: 403, body: { ok: false, error: 'forbidden', message: resultado.message } };
  }
  return { status: 200, body: { ok: true, data: resultado } };
}

function ejecutarAccion(db, action, data, contexto) {
  const fn = ACCIONES[action];
  if (!fn) {
    return { status: 404, body: { ok: false, error: 'Acción desconocida: ' + action } };
  }
  return responderResultado_(fn(db, data || {}, contexto || {}));
}

module.exports = { ejecutarAccion, ACCIONES };
