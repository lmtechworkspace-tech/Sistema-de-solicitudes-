'use strict';

/**
 * migracion.js — herramienta TEMPORAL, una sola vez: importa CAT_CLIENTES
 * (284 filas reales, catálogo de clientes que existe en SIGSO desde la v1.0
 * pero nunca se había migrado al esquema Node) a la tabla SQLite del backend
 * nuevo. Se puede borrar (junto a su entrada en router.js) una vez terminado
 * el corte.
 *
 * Por qué existe como acción HTTP y no como script suelto contra el archivo
 * de la base de datos: node:sqlite bloquea el archivo en exclusiva mientras
 * el servicio lo tiene abierto -- hacerlo por HTTP, en el mismo proceso que
 * ya tiene la base abierta, evita parar el servicio (mismo patrón que la
 * migración de datos original del 2026-09-16/17).
 *
 * importarTabla(db, data, contexto):
 *  - Solo ADM.
 *  - data = { hoja, filas } -- filas es un array de OBJETOS (mismo shape
 *    que agregarFila_), no de arrays posicionales.
 *  - Vacía la tabla y la vuelve a llenar con `filas` (sembrarTabla_, el
 *    mismo primitivo "recrear" que ya usan los tests) -- deliberado: hoy
 *    CAT_CLIENTES está vacía en producción (la tabla se agregó al esquema
 *    en este mismo incremento, nunca se sembró), así que no hay dato real
 *    que perder.
 */

const { sembrarTabla_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { errorValidacion, errorForbidden } = require('./errores');

const TABLAS_MIGRABLES = ['CAT_CLIENTES'];

function importarTabla(db, data, contexto) {
  if (!contexto || contexto.rol !== 'ADM') {
    return errorForbidden('Solo un Administrador puede importar datos de migración.');
  }
  const hoja = data && data.hoja;
  if (!hoja || TABLAS_MIGRABLES.indexOf(hoja) === -1) {
    return errorValidacion('hoja', 'Hoja no reconocida para migración: ' + hoja);
  }
  const columnas = COLUMNAS[hoja];
  const filasEntrada = Array.isArray(data.filas) ? data.filas : [];

  const filasPosicionales = filasEntrada.map((obj) => columnas.map((c) => (obj[c] !== undefined ? obj[c] : '')));
  sembrarTabla_(db, hoja, columnas, filasPosicionales);

  return { hoja: hoja, importadas: filasEntrada.length };
}

module.exports = { importarTabla, TABLAS_MIGRABLES };
