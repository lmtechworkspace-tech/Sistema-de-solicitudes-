'use strict';

/**
 * Prueba de portabilidad: getEstadoSistema (backend/backoffice/Code.gs,
 * handleGetEstadoSistema_), corrido contra backend/logica/sistema.js.
 * diagnosticarEsquema_ en sí ya tiene cobertura completa en
 * sqlite-repo-poc.test.js -- aquí solo se prueba el guardia de rol y la
 * forma de lo que devuelve la acción.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Sistema = require('../logica/sistema');

const ADMIN = { rol: 'ADM', email: 'admin@homepymes.cl' };
const NO_ADMIN = { rol: 'DEV', email: 'dev@homepymes.cl' };

function dbCompleta() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}

test('getEstadoSistema es ADM-only', () => {
  const db = dbCompleta();
  assert.equal(Sistema.getEstadoSistema(db, {}, NO_ADMIN)._forbidden, true);
});

test('getEstadoSistema trae version_backend y el esquema al día cuando todas las tablas existen', () => {
  const db = dbCompleta();
  const r = Sistema.getEstadoSistema(db, {}, ADMIN);
  assert.equal(r.version_backend, Sistema.VERSION_BACKEND);
  assert.equal(r.esquema.al_dia, true);
  assert.equal(r.esquema.hojas_faltantes.length, 0);
});

test('getEstadoSistema reporta una tabla faltante y una accion en espanol para Node (no el Instalador de Apps Script)', () => {
  const db = abrirDb_();
  // Sembrar todo MENOS una tabla -- fuerza un hueco real.
  Object.keys(COLUMNAS).filter((h) => h !== 'JEFATURAS').forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  const r = Sistema.getEstadoSistema(db, {}, ADMIN);
  assert.equal(r.esquema.al_dia, false);
  assert.ok(r.esquema.hojas_faltantes.includes('JEFATURAS'));
  assert.match(r.esquema.accion, /backend\/db\/schema\.js/);
  assert.ok(!/Apps Script/i.test(r.esquema.accion));
});
