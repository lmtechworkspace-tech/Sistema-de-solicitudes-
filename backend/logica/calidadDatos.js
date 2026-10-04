'use strict';

/**
 * calidadDatos.js — arreglos de datos que corren solos al arrancar el
 * servidor (2026-10-03, etapa 1 de la reportabilidad: "limpiar el dato"). Son
 * idempotentes: correrlos dos veces no cambia nada.
 *
 *  1. Montos en notación científica. Excel entrega los montos de 10 millones
 *     o más como "1.3256668E7"; el importador los guardaba como texto. Se
 *     convierten a número en las columnas de tipo monto o número de cada
 *     matriz (en la copia del 2-10-2026: 34 pagos de IVA y 171 facturas solo
 *     en el último año). Los RUT y N° de contrato que Excel convirtió en
 *     número grande quedan en dígitos ("12345678").
 *  2. Feriados de Chile. CONFIG_FERIADOS estaba vacía y ningún plazo en días
 *     hábiles los descontaba (un F29 declarado el lunes después de un feriado
 *     se contaba atrasado). Se cargan los que falten; nunca se borra uno.
 */

const { leerFilas_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { matriz_ } = require('./controlInternoMatrices');

const RE_CIENTIFICA = /^-?\d+(\.\d+)?E[+-]?\d+$/i;

/** Convierte a número los montos guardados como "1.3256668E7". Devuelve cuántas filas cambió. */
function normalizarNotacionCientifica_(db) {
  let tabla;
  try { tabla = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'CI_REGISTROS'").get(); } catch (e) { return 0; }
  if (!tabla) return 0;
  // Solo las filas que podrían tener uno: el texto JSON trae "…E7" entre comillas.
  const filas = db.prepare('SELECT rowid AS id, "matriz" AS matriz, "datos" AS datos FROM "CI_REGISTROS" WHERE "datos" LIKE ?').all('%E%');
  const upd = db.prepare('UPDATE "CI_REGISTROS" SET "datos" = ? WHERE rowid = ?');
  let cambiadas = 0;
  db.exec('BEGIN');
  try {
    filas.forEach((f) => {
      let datos, m;
      try { datos = JSON.parse(f.datos); m = matriz_(JSON.parse(f.matriz)); } catch (e) { return; }
      if (!datos || typeof datos !== 'object' || !m) return;
      let cambio = false;
      m.columnas.forEach((c) => {
        const v = datos[c.clave];
        if (typeof v !== 'string' || !RE_CIENTIFICA.test(v.trim())) return;
        // Montos y números (también los montos que la planilla trae como texto,
        // p. ej. la deuda de los convenios 4 a 9) pasan a número; RUT y N° de
        // contrato quedan en dígitos (Excel los convirtió en número grande).
        if (c.tipo === 'monto' || c.tipo === 'numero' || /^monto/.test(c.clave)) datos[c.clave] = Math.round(Number(v.trim()) * 100) / 100;
        else if (c.tipo === 'texto' || c.tipo === 'texto_largo') datos[c.clave] = String(Math.round(Number(v.trim())));
        else return;
        cambio = true;
      });
      if (cambio) { upd.run(JSON.stringify(datos), f.id); cambiadas++; }
    });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return cambiadas;
}

// Feriados legales de Chile (fuente: feriados.cl / Ley 19.973 y siguientes).
// Incluye los días de elecciones que fueron feriado. Revisar cada diciembre.
const FERIADOS_CHILE = [
  ['2024-01-01', 'Año Nuevo'], ['2024-03-29', 'Viernes Santo'], ['2024-03-30', 'Sábado Santo'], ['2024-05-01', 'Día del Trabajo'],
  ['2024-05-21', 'Glorias Navales'], ['2024-06-09', 'Elecciones primarias'], ['2024-06-20', 'Día de los Pueblos Indígenas'], ['2024-06-29', 'San Pedro y San Pablo'],
  ['2024-07-16', 'Virgen del Carmen'], ['2024-08-15', 'Asunción de la Virgen'], ['2024-09-18', 'Independencia Nacional'], ['2024-09-19', 'Glorias del Ejército'],
  ['2024-09-20', 'Feriado adicional Fiestas Patrias'], ['2024-10-12', 'Encuentro de Dos Mundos'], ['2024-10-27', 'Elecciones municipales y regionales'],
  ['2024-10-31', 'Iglesias Evangélicas y Protestantes'], ['2024-11-01', 'Todos los Santos'], ['2024-12-08', 'Inmaculada Concepción'], ['2024-12-25', 'Navidad'],
  ['2025-01-01', 'Año Nuevo'], ['2025-04-18', 'Viernes Santo'], ['2025-04-19', 'Sábado Santo'], ['2025-05-01', 'Día del Trabajo'],
  ['2025-05-21', 'Glorias Navales'], ['2025-06-20', 'Día de los Pueblos Indígenas'], ['2025-06-29', 'San Pedro y San Pablo'], ['2025-07-16', 'Virgen del Carmen'],
  ['2025-08-15', 'Asunción de la Virgen'], ['2025-09-18', 'Independencia Nacional'], ['2025-09-19', 'Glorias del Ejército'], ['2025-10-12', 'Encuentro de Dos Mundos'],
  ['2025-10-31', 'Iglesias Evangélicas y Protestantes'], ['2025-11-01', 'Todos los Santos'], ['2025-11-16', 'Elecciones presidenciales y parlamentarias'],
  ['2025-12-08', 'Inmaculada Concepción'], ['2025-12-14', 'Segunda vuelta presidencial'], ['2025-12-25', 'Navidad'],
  ['2026-01-01', 'Año Nuevo'], ['2026-04-03', 'Viernes Santo'], ['2026-04-04', 'Sábado Santo'], ['2026-05-01', 'Día del Trabajo'],
  ['2026-05-21', 'Glorias Navales'], ['2026-06-21', 'Día de los Pueblos Indígenas'], ['2026-06-29', 'San Pedro y San Pablo'], ['2026-07-16', 'Virgen del Carmen'],
  ['2026-08-15', 'Asunción de la Virgen'], ['2026-09-18', 'Independencia Nacional'], ['2026-09-19', 'Glorias del Ejército'], ['2026-10-12', 'Encuentro de Dos Mundos'],
  ['2026-10-31', 'Iglesias Evangélicas y Protestantes'], ['2026-11-01', 'Todos los Santos'], ['2026-12-08', 'Inmaculada Concepción'], ['2026-12-25', 'Navidad'],
  ['2027-01-01', 'Año Nuevo'], ['2027-03-26', 'Viernes Santo'], ['2027-03-27', 'Sábado Santo'], ['2027-05-01', 'Día del Trabajo'],
  ['2027-05-21', 'Glorias Navales'], ['2027-06-21', 'Día de los Pueblos Indígenas'], ['2027-06-28', 'San Pedro y San Pablo'], ['2027-07-16', 'Virgen del Carmen'],
  ['2027-08-15', 'Asunción de la Virgen'], ['2027-09-18', 'Independencia Nacional'], ['2027-09-19', 'Glorias del Ejército'], ['2027-10-11', 'Encuentro de Dos Mundos'],
  ['2027-10-31', 'Iglesias Evangélicas y Protestantes'], ['2027-11-01', 'Todos los Santos'], ['2027-12-08', 'Inmaculada Concepción'], ['2027-12-25', 'Navidad']
];

/** Carga los feriados que falten (nunca borra ni cambia uno existente). Devuelve cuántos agregó. */
function asegurarFeriados_(db) {
  let actuales;
  try { actuales = leerFilas_(db, 'CONFIG_FERIADOS', COLUMNAS.CONFIG_FERIADOS); } catch (e) { return 0; }
  const ya = new Set(actuales.map((f) => String(f.fecha || '').slice(0, 10)));
  let n = 0;
  FERIADOS_CHILE.forEach(([fecha, nombre]) => {
    if (ya.has(fecha)) return;
    agregarFila_(db, 'CONFIG_FERIADOS', { fecha, nombre, anio: Number(fecha.slice(0, 4)) });
    n++;
  });
  return n;
}

/** Todo lo de arriba, para el arranque del servidor. Nunca lo bota: solo avisa en el registro. */
function corregirAlArrancar(db) {
  const r = {};
  try { r.montos = normalizarNotacionCientifica_(db); } catch (e) { r.error_montos = String(e && e.message || e); }
  try { r.feriados = asegurarFeriados_(db); } catch (e) { r.error_feriados = String(e && e.message || e); }
  return r;
}

module.exports = { normalizarNotacionCientifica_, asegurarFeriados_, corregirAlArrancar, FERIADOS_CHILE };
