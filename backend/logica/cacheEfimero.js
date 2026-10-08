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

// Revisión Codex 2026-10-08 (D-002, hallazgo 2): las claves de un solo uso que nadie
// vuelve a consultar (pases abandonados) quedaban para siempre. Se purgan las vencidas
// cada PURGA_CADA_MS al escribir, y hay un tope de entradas: si se supera aun después
// de purgar, salen las más antiguas (el Map conserva el orden de inserción).
const PURGA_CADA_MS = 60 * 1000;
const MAX_ENTRADAS = 20000;
let ultimaPurga = 0;

function purgarVencidas_() {
  const ahora = Date.now();
  let borradas = 0;
  almacen.forEach((v, k) => { if (ahora > v.expira) { almacen.delete(k); borradas++; } });
  ultimaPurga = ahora;
  return borradas;
}

function put(clave, valor, ttlSegundos) {
  if (Date.now() - ultimaPurga > PURGA_CADA_MS || almacen.size >= MAX_ENTRADAS) purgarVencidas_();
  almacen.delete(clave); // al reescribir, pasa al final del orden de antigüedad
  while (almacen.size >= MAX_ENTRADAS) almacen.delete(almacen.keys().next().value);
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
  ultimaPurga = 0;
}
function tamano_() { return almacen.size; }

module.exports = { put, get, remove, limpiarTodo_, purgarVencidas_, tamano_, MAX_ENTRADAS };
