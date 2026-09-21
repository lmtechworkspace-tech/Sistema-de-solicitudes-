'use strict';

/**
 * super-admin-panel.test.js — panel de datos crudo (superAdminPanel.js),
 * exclusivo de la cuenta marcada contexto.super_admin === true. Cubre: el
 * gate (nadie mas puede usarlo, ni ADM comun), listar/agregar/editar/
 * eliminar sobre una tabla cualquiera via los mismos primitivos que usa el
 * resto del backend, y que cada escritura deja rastro en LOG_SISTEMA.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const SuperAdmin = require('../logica/superAdminPanel');

const TABLAS = ['CAT_AREAS', 'LOG_SISTEMA'];
function db_() {
  const db = abrirDb_();
  TABLAS.forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }

const CTX_SUPER_ADMIN = { email: 'lmendoza@homepymes.cl', nombre: 'Luis', rol: 'ADM', super_admin: true };
const CTX_ADM_NORMAL = { email: 'otro-admin@homepymes.cl', nombre: 'Otro Admin', rol: 'ADM' };
const CTX_ADM_SIN_BANDERA = { email: 'casi@homepymes.cl', rol: 'ADM', super_admin: false };
const CTX_SIN_SESION = null;

test('el gate rechaza a cualquiera sin contexto.super_admin === true, incluido otro ADM', () => {
  const db = db_();
  [
    SuperAdmin.listarTablas(db, {}, CTX_ADM_NORMAL),
    SuperAdmin.listarTablas(db, {}, CTX_ADM_SIN_BANDERA),
    SuperAdmin.listarTablas(db, {}, CTX_SIN_SESION),
    SuperAdmin.listarFilasTabla(db, { tabla: 'CAT_AREAS' }, CTX_ADM_NORMAL),
    SuperAdmin.agregarFilaTabla(db, { tabla: 'CAT_AREAS', fila: { area_id: 'X' } }, CTX_ADM_NORMAL),
    SuperAdmin.actualizarFilaTabla(db, { tabla: 'CAT_AREAS', id_campo: 'area_id', id_valor: 'X', cambios: {} }, CTX_ADM_NORMAL),
    SuperAdmin.eliminarFilaTabla(db, { tabla: 'CAT_AREAS', id_campo: 'area_id', id_valor: 'X' }, CTX_ADM_NORMAL)
  ].forEach((resultado) => assert.ok(resultado._forbidden, 'debe rechazarse: ' + JSON.stringify(resultado)));
});

test('listarTablas: devuelve todas las tablas de COLUMNAS con su conteo real de filas', () => {
  const db = db_();
  SuperAdmin.agregarFilaTabla(db, { tabla: 'CAT_AREAS', fila: { area_id: 'A1', nombre: 'Area 1', activo: true } }, CTX_SUPER_ADMIN);
  SuperAdmin.agregarFilaTabla(db, { tabla: 'CAT_AREAS', fila: { area_id: 'A2', nombre: 'Area 2', activo: true } }, CTX_SUPER_ADMIN);

  const { tablas } = SuperAdmin.listarTablas(db, {}, CTX_SUPER_ADMIN);
  assert.equal(tablas.length, Object.keys(COLUMNAS).length, 'debe listar TODAS las tablas del esquema, no solo las sembradas');
  const catAreas = tablas.find((t) => t.nombre === 'CAT_AREAS');
  assert.equal(catAreas.filas, 2);
  assert.deepEqual(catAreas.columnas, COLUMNAS.CAT_AREAS);
});

test('rechaza una tabla que no existe en el esquema', () => {
  const db = db_();
  assert.equal(SuperAdmin.listarFilasTabla(db, { tabla: 'TABLA_INVENTADA' }, CTX_SUPER_ADMIN)._validationError, true);
  assert.equal(SuperAdmin.agregarFilaTabla(db, { tabla: 'TABLA_INVENTADA', fila: {} }, CTX_SUPER_ADMIN)._validationError, true);
});

test('agregarFilaTabla / actualizarFilaTabla / eliminarFilaTabla: CRUD completo sobre una tabla cualquiera', () => {
  const db = db_();
  const creada = SuperAdmin.agregarFilaTabla(db, {
    tabla: 'CAT_AREAS', fila: { area_id: 'PREV', nombre: 'Prevención', responsable_email: 'p@x.cl', activo: true }
  }, CTX_SUPER_ADMIN);
  assert.equal(creada.fila.area_id, 'PREV');
  assert.equal(filas(db, 'CAT_AREAS').length, 1);

  const editada = SuperAdmin.actualizarFilaTabla(db, {
    tabla: 'CAT_AREAS', id_campo: 'area_id', id_valor: 'PREV', cambios: { nombre: 'Prevención de Riesgos' }
  }, CTX_SUPER_ADMIN);
  assert.equal(editada.fila.nombre, 'Prevención de Riesgos');
  assert.equal(filas(db, 'CAT_AREAS')[0].nombre, 'Prevención de Riesgos');

  const eliminada = SuperAdmin.eliminarFilaTabla(db, {
    tabla: 'CAT_AREAS', id_campo: 'area_id', id_valor: 'PREV'
  }, CTX_SUPER_ADMIN);
  assert.equal(eliminada.eliminadas, 1);
  assert.equal(filas(db, 'CAT_AREAS').length, 0);
});

test('actualizarFilaTabla: id_campo debe ser una columna real de la tabla; id_valor debe existir', () => {
  const db = db_();
  SuperAdmin.agregarFilaTabla(db, { tabla: 'CAT_AREAS', fila: { area_id: 'A1', nombre: 'Area 1' } }, CTX_SUPER_ADMIN);
  assert.equal(SuperAdmin.actualizarFilaTabla(db, {
    tabla: 'CAT_AREAS', id_campo: 'columna_inventada', id_valor: 'A1', cambios: { nombre: 'x' }
  }, CTX_SUPER_ADMIN)._validationError, true);
  assert.equal(SuperAdmin.actualizarFilaTabla(db, {
    tabla: 'CAT_AREAS', id_campo: 'area_id', id_valor: 'NO-EXISTE', cambios: { nombre: 'x' }
  }, CTX_SUPER_ADMIN)._validationError, true);
});

test('cada escritura (agregar/editar/eliminar) deja rastro en LOG_SISTEMA con el autor real', () => {
  const db = db_();
  SuperAdmin.agregarFilaTabla(db, { tabla: 'CAT_AREAS', fila: { area_id: 'A1', nombre: 'Area 1' } }, CTX_SUPER_ADMIN);
  SuperAdmin.actualizarFilaTabla(db, { tabla: 'CAT_AREAS', id_campo: 'area_id', id_valor: 'A1', cambios: { nombre: 'x' } }, CTX_SUPER_ADMIN);
  SuperAdmin.eliminarFilaTabla(db, { tabla: 'CAT_AREAS', id_campo: 'area_id', id_valor: 'A1' }, CTX_SUPER_ADMIN);

  const logs = filas(db, 'LOG_SISTEMA').filter((l) => String(l.contexto || '').startsWith('SUPER_ADMIN_PANEL:'));
  assert.equal(logs.length, 3);
  assert.ok(logs.every((l) => l.mensaje.indexOf(CTX_SUPER_ADMIN.email) === 0), 'cada log debe empezar con el autor real');
  assert.ok(logs.some((l) => l.contexto === 'SUPER_ADMIN_PANEL:FILA_AGREGADA'));
  assert.ok(logs.some((l) => l.contexto === 'SUPER_ADMIN_PANEL:FILA_EDITADA'));
  assert.ok(logs.some((l) => l.contexto === 'SUPER_ADMIN_PANEL:FILA_ELIMINADA'));
});

// Una eliminacion que no encuentra ninguna fila no debe fallar (mismo
// contrato que eliminarFilasPorId_: devuelve 0), pero tampoco debe dejar
// log -- no paso nada de verdad.
test('eliminarFilaTabla sobre una fila inexistente devuelve 0 y no deja log', () => {
  const db = db_();
  const resultado = SuperAdmin.eliminarFilaTabla(db, { tabla: 'CAT_AREAS', id_campo: 'area_id', id_valor: 'NO-EXISTE' }, CTX_SUPER_ADMIN);
  assert.equal(resultado.eliminadas, 0);
  assert.equal(filas(db, 'LOG_SISTEMA').length, 0);
});
