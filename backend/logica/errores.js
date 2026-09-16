'use strict';

/**
 * errores.js — mismas formas de error que backend/backoffice/Solicitudes.gs
 * (errorValidacion_) y el resto de los modulos .gs (_forbidden inline), para
 * que responderResultado_ (server/router.js) las reconozca igual sin
 * importar si la logica viene de Sheets o de SQLite.
 */

function errorValidacion(campo, mensaje) {
  return { _validationError: true, message: mensaje, fields: [{ campo: campo, mensaje: mensaje }] };
}

function errorForbidden(mensaje) {
  return { _forbidden: true, message: mensaje };
}

module.exports = { errorValidacion, errorForbidden };
