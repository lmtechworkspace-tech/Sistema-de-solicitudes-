'use strict';

/**
 * cacheEfimero.js — equivalente minimo de CacheService.getScriptCache() del
 * .gs: put(clave, valor, ttlSegundos) / get(clave) / remove(clave), en
 * memoria del proceso. Mismo limite ya documentado en sesiones.js para su
 * Map de intentos de login: valido mientras el backend sea un solo proceso
 * Node en el VPS (diseño actual); si el dia de manana hay varios procesos
 * detras de un balanceador, esto dejaria de compartirse entre ellos y habria
 * que moverlo a la base de datos.
 *
 * Usado por solicitudesPublico.js para el freno de fuerza bruta de
 * estadoPublico (RN, Fase 4) y el codigo de un solo uso de "Mis solicitudes"
 * (Fase 3) -- las mismas dos cosas que usaban CacheService en el .gs.
 */

const almacen = new Map(); // clave -> { valor, expira }

function put(clave, valor, ttlSegundos) {
  almacen.set(clave, { valor: String(valor), expira: Date.now() + ttlSegundos * 1000 });
}

function get(clave) {
  const entrada = almacen.get(clave);
  if (!entrada) return null;
  if (Date.now() > entrada.expira) {
    almacen.delete(clave);
    return null;
  }
  return entrada.valor;
}

function remove(clave) {
  almacen.delete(clave);
}

// Solo para tests: el CacheService real del .gs quedaba aislado por
// ejecucion; este Map es un singleton de proceso, asi que sin esto un test
// podria heredar estado (intentos fallidos, codigos) de otro que corrio antes.
function limpiarTodo_() {
  almacen.clear();
}

module.exports = { put, get, remove, limpiarTodo_ };
