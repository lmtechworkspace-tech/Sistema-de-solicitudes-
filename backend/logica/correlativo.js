'use strict';

/**
 * correlativo.js — puerto de backend/intake/Correlativo.gs + la parte de
 * incrementarContadorCorrelativo_ (SheetsRepo.gs) que le da formato al
 * numero. Formato identico: SOL-[ANIO]-[EMPRESA]-[NNNN].
 *
 * Simplificacion deliberada: el .gs toma LockService.getScriptLock() porque
 * Apps Script puede correr VARIAS ejecuciones de verdad en paralelo (dos
 * solicitudes llegando al mismo tiempo son dos procesos distintos, y sin
 * lock podrian leer+incrementar el mismo numero antes de que ninguna
 * escriba). Aqui no hace falta: node:sqlite (DatabaseSync) es sincrono y
 * Node es de un solo hilo para JS, asi que leer+incrementar+escribir el
 * contador ocurre de corrido, sin que otra peticion pueda intercalarse en
 * medio -- la misma garantia que daba el lock, gratis por como corre Node.
 */

const { leerFilas_, actualizarFilaPorFiltro_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');

function incrementarContador(db, empresaId, anio) {
  const actual = leerFilas_(db, 'COUNTERS', COLUMNAS.COUNTERS)
    .find((f) => String(f.empresa_id) === String(empresaId) && Number(f.anio) === anio);
  const nuevoNumero = (actual ? Number(actual.ultimo_numero) : 0) + 1;

  if (actual) {
    actualizarFilaPorFiltro_(db, 'COUNTERS',
      (f) => String(f.empresa_id) === String(empresaId) && Number(f.anio) === anio,
      { ultimo_numero: nuevoNumero });
  } else {
    agregarFila_(db, 'COUNTERS', { empresa_id: empresaId, anio: anio, ultimo_numero: nuevoNumero });
  }
  return nuevoNumero;
}

function generarId(db, empresaId) {
  const anio = new Date().getFullYear();
  const nuevoNumero = incrementarContador(db, empresaId, anio);
  const numeroFormateado = ('0000' + nuevoNumero).slice(-4);
  return 'SOL-' + anio + '-' + empresaId + '-' + numeroFormateado;
}

module.exports = { generarId };
