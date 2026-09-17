'use strict';

/**
 * Tests de bootstrap.js (herramienta temporal para arrancar la migracion:
 * crear la primera cuenta ADM cuando no hay ninguna clave utilizable).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Bootstrap = require('../logica/bootstrap');
const Hash = require('../logica/passwordHash');

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}

test('bootstrapAdmin falla si no hay secreto configurado en el servidor', () => {
  delete process.env.MIGRACION_BOOTSTRAP_SECRET;
  const db = dbConSchema();
  const resultado = Bootstrap.bootstrapAdmin(db, { secreto: 'lo que sea' });
  assert.equal(resultado._validationError, true);
  assert.equal(leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL).length, 0);
});

test('bootstrapAdmin falla si el secreto no coincide', (t) => {
  process.env.MIGRACION_BOOTSTRAP_SECRET = 'correcto';
  t.after(() => { delete process.env.MIGRACION_BOOTSTRAP_SECRET; });
  const db = dbConSchema();
  const resultado = Bootstrap.bootstrapAdmin(db, { secreto: 'incorrecto' });
  assert.equal(resultado._validationError, true);
});

test('bootstrapAdmin crea una cuenta ADM valida cuando el secreto coincide', (t) => {
  process.env.MIGRACION_BOOTSTRAP_SECRET = 'correcto';
  t.after(() => { delete process.env.MIGRACION_BOOTSTRAP_SECRET; });
  const db = dbConSchema();

  const resultado = Bootstrap.bootstrapAdmin(db, { secreto: 'correcto' });

  assert.equal(resultado.usuario, 'migracion-admin');
  assert.ok(resultado.password_temporal);
  const cuenta = leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL)[0];
  assert.equal(cuenta.rol, 'ADM');
  assert.equal(Hash.coincide(resultado.password_temporal, cuenta.salt, cuenta.hash_password), true);
});

test('bootstrapAdmin es idempotente: correrlo dos veces no deja cuentas duplicadas', (t) => {
  process.env.MIGRACION_BOOTSTRAP_SECRET = 'correcto';
  t.after(() => { delete process.env.MIGRACION_BOOTSTRAP_SECRET; });
  const db = dbConSchema();

  Bootstrap.bootstrapAdmin(db, { secreto: 'correcto' });
  const segunda = Bootstrap.bootstrapAdmin(db, { secreto: 'correcto' });

  const cuentas = leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL).filter((c) => c.usuario === 'migracion-admin');
  assert.equal(cuentas.length, 1);
  const cuenta = cuentas[0];
  assert.equal(Hash.coincide(segunda.password_temporal, cuenta.salt, cuenta.hash_password), true);
});
