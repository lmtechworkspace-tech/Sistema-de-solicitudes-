'use strict';

/**
 * db/index.js — abre la base de datos real del servidor: crea la carpeta si
 * falta, abre (o crea) el archivo SQLite, y asegura el esquema conocido
 * (nunca destructivo -- ver asegurarTabla_ en sqliteRepo.js).
 */

const path = require('node:path');
const fs = require('node:fs');
const { abrirDb_ } = require('./sqliteRepo');
const { asegurarEsquema } = require('./schema');

function abrirDbProduccion(archivo) {
  const ruta = archivo || process.env.SIGSO_DB_PATH || path.join(__dirname, '..', '..', 'data', 'sigso.db');
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const db = abrirDb_(ruta);
  asegurarEsquema(db);
  return db;
}

module.exports = { abrirDbProduccion };
