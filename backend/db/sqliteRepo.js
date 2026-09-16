'use strict';

/**
 * sqliteRepo.js — prueba de concepto: el mismo CONTRATO de
 * backend/backoffice/SheetsRepo.gs, pero contra SQLite en vez de Sheets.
 *
 * Objetivo de esta prueba: validar que la logica de negocio de SIGSO (que
 * solo conoce leerFilas_/agregarFila_/actualizarFilaPorId_/etc, nunca Sheets
 * directamente) puede correr sin cambios contra un motor relacional real.
 * Por eso replica exactamente las mismas reglas que ya endurecio la version
 * de Sheets:
 *   - lectura y escritura por NOMBRE de encabezado, nunca por posicion.
 *   - una columna del esquema (COLUMNAS) que la tabla real no tiene todavia
 *     se entrega como '' (nunca undefined).
 *   - columnas reales que el esquema no conoce se preservan por su nombre.
 *
 * Cada "hoja" es una tabla cuyas columnas SON los encabezados reales (asi se
 * puede simular, igual que con seedSheet, una tabla mas vieja o mas nueva
 * que el esquema del codigo). Cada celda se guarda como JSON en una columna
 * TEXT: Sheets no tiene tipos fijos por columna (una celda puede traer texto,
 * numero o booleano), y json preserva eso sin depender del tipado de SQLite.
 *
 * node:sqlite es experimental en Node 22 (la version del VPS) -- aceptable
 * para esta prueba de concepto; si se adopta en produccion se decide ahi
 * si conviene fijar una libreria estable (better-sqlite3) en su lugar.
 */

const { DatabaseSync } = require('node:sqlite');

function abrirDb_(archivo) {
  return new DatabaseSync(archivo || ':memory:');
}

function col_(nombre) {
  return '"' + String(nombre).replace(/"/g, '""') + '"';
}

function tabla_(nombre) {
  return '"' + String(nombre).replace(/"/g, '""') + '"';
}

function tablaExiste_(db, nombreHoja) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(nombreHoja);
}

function encabezadosReales_(db, nombreHoja) {
  return db.prepare('PRAGMA table_info(' + tabla_(nombreHoja) + ')').all().map((f) => f.name);
}

/** Crea (reemplazando si ya existia) una tabla con exactamente estas columnas. */
function crearTabla_(db, nombreHoja, columnas) {
  db.exec('DROP TABLE IF EXISTS ' + tabla_(nombreHoja));
  const definicion = columnas.map((c) => col_(c) + ' TEXT').join(', ');
  db.exec('CREATE TABLE ' + tabla_(nombreHoja) + ' (' + definicion + ')');
}

/** Equivalente de seedSheet (gasSandbox) pero para la tabla SQLite. */
function sembrarTabla_(db, nombreHoja, columnas, filas) {
  crearTabla_(db, nombreHoja, columnas);
  if (!filas || !filas.length) return;
  const marcadores = columnas.map(() => '?').join(', ');
  const stmt = db.prepare(
    'INSERT INTO ' + tabla_(nombreHoja) + ' (' + columnas.map(col_).join(', ') + ') VALUES (' + marcadores + ')'
  );
  filas.forEach((fila) => {
    stmt.run(...fila.map((v) => JSON.stringify(v === undefined ? '' : v)));
  });
}

function mapearFila_(filaSql, encabezados, columnasEsquema) {
  const obj = {};
  (columnasEsquema || []).forEach((col) => { obj[col] = ''; });
  encabezados.forEach((col) => {
    if (col) obj[col] = JSON.parse(filaSql[col]);
  });
  return obj;
}

function leerFilas_(db, nombreHoja, columnasEsquema) {
  if (!tablaExiste_(db, nombreHoja)) {
    throw new Error('Hoja no encontrada: ' + nombreHoja + '. Ejecuta el instalador (backend/setup) primero.');
  }
  const encabezados = encabezadosReales_(db, nombreHoja);
  const filasSql = db.prepare('SELECT * FROM ' + tabla_(nombreHoja) + ' ORDER BY rowid').all();
  return filasSql.map((f) => mapearFila_(f, encabezados, columnasEsquema));
}

function agregarFila_(db, nombreHoja, objetoFila) {
  const encabezados = encabezadosReales_(db, nombreHoja);
  const columnas = encabezados.length ? encabezados : Object.keys(objetoFila);
  const valores = columnas.map((c) => (c && objetoFila[c] !== undefined) ? objetoFila[c] : '');
  const marcadores = columnas.map(() => '?').join(', ');
  db.prepare(
    'INSERT INTO ' + tabla_(nombreHoja) + ' (' + columnas.map(col_).join(', ') + ') VALUES (' + marcadores + ')'
  ).run(...valores.map((v) => JSON.stringify(v)));
  return objetoFila;
}

function agregarFilas_(db, nombreHoja, objetosFila) {
  if (!objetosFila || !objetosFila.length) return objetosFila;
  objetosFila.forEach((obj) => agregarFila_(db, nombreHoja, obj));
  return objetosFila;
}

function actualizarFilaPorId_(db, nombreHoja, columnaId, valorId, cambios) {
  const encabezados = encabezadosReales_(db, nombreHoja);
  if (encabezados.indexOf(columnaId) === -1) return null;

  const filasSql = db.prepare('SELECT rowid AS _rowid, * FROM ' + tabla_(nombreHoja)).all();
  for (const f of filasSql) {
    if (String(JSON.parse(f[columnaId])) !== String(valorId)) continue;

    const objetoActual = mapearFila_(f, encabezados, []);
    const objetoActualizado = Object.assign({}, objetoActual, cambios);
    const sets = encabezados.map((col) => col_(col) + ' = ?');
    const valores = encabezados.map((col) => JSON.stringify(objetoActualizado[col]));
    db.prepare('UPDATE ' + tabla_(nombreHoja) + ' SET ' + sets.join(', ') + ' WHERE rowid = ?')
      .run(...valores, f._rowid);
    return objetoActualizado;
  }
  return null;
}

function eliminarFilasPorId_(db, nombreHoja, columnaId, valorId) {
  const encabezados = encabezadosReales_(db, nombreHoja);
  if (encabezados.indexOf(columnaId) === -1) return 0;

  const filasSql = db.prepare(
    'SELECT rowid AS _rowid, ' + col_(columnaId) + ' AS _val FROM ' + tabla_(nombreHoja)
  ).all();
  let borradas = 0;
  filasSql.forEach((f) => {
    if (String(JSON.parse(f._val)) === String(valorId)) {
      db.prepare('DELETE FROM ' + tabla_(nombreHoja) + ' WHERE rowid = ?').run(f._rowid);
      borradas++;
    }
  });
  return borradas;
}

function diagnosticarEsquema_(db, COLUMNAS) {
  const faltanHojas = [];
  const faltanColumnas = [];

  Object.keys(COLUMNAS).forEach((nombre) => {
    if (!tablaExiste_(db, nombre)) { faltanHojas.push(nombre); return; }
    const reales = encabezadosReales_(db, nombre);
    if (!reales.join('')) { faltanHojas.push(nombre); return; }
    const esperadas = COLUMNAS[nombre];
    const ausentes = esperadas.filter((c) => reales.indexOf(c) === -1);
    if (ausentes.length) faltanColumnas.push({ hoja: nombre, columnas: ausentes });
  });

  return {
    al_dia: faltanHojas.length === 0 && faltanColumnas.length === 0,
    hojas_faltantes: faltanHojas,
    columnas_faltantes: faltanColumnas,
    accion: (faltanHojas.length || faltanColumnas.length)
      ? 'Ejecuta actualizarEsquema en el proyecto SETUP de Apps Script.'
      : ''
  };
}

module.exports = {
  abrirDb_,
  crearTabla_,
  sembrarTabla_,
  encabezadosReales_,
  leerFilas_,
  agregarFila_,
  agregarFilas_,
  actualizarFilaPorId_,
  eliminarFilasPorId_,
  diagnosticarEsquema_
};
