'use strict';

/**
 * Prueba de portabilidad: los mismos escenarios de CRUD de cuentas de
 * backend/test/portal.test.js (seccion "CRUD de administracion"), corridos
 * contra backend/logica/cuentasPortal.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const CuentasPortal = require('../logica/cuentasPortal');

const ADMIN = { email: 'admin@homepymes.cl', rol: 'ADM' };

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}

test('el CRUD de cuentas es solo para ADM', () => {
  const db = dbConSchema();
  ['ANA', 'DEV', 'GERENCIA'].forEach((rol) => {
    assert.equal(CuentasPortal.listar(db, {}, { email: 'x@x.cl', rol })._forbidden, true, rol);
    assert.equal(CuentasPortal.gestionar(db, { operacion: 'crear', usuario: 'a', nombre: 'A', emails: 'a@a.cl' },
      { email: 'x@x.cl', rol })._forbidden, true, rol);
  });
});

test('el rol COORDINADOR ya no existe (retirado 2026-09-19: nunca fue un permiso real)', () => {
  const db = dbConSchema();
  const res = CuentasPortal.gestionar(db, {
    operacion: 'crear', usuario: 'nueva', nombre: 'Nueva', emails: 'nueva@x.cl', rol: 'COORDINADOR'
  }, ADMIN);
  assert.equal(res._validationError, true);
  assert.match(res.message, /Rol invalido/i);
  assert.equal(CuentasPortal.MODULOS_POR_ROL.COORDINADOR, undefined);
});

test('crear cuenta aplica la plantilla de modulos del rol y no repite usuarios', () => {
  const db = dbConSchema();
  const dev = CuentasPortal.gestionar(db, {
    operacion: 'crear', usuario: 'leo', nombre: 'Leo', emails: 'leo@rld.cl', rol: 'DEV'
  }, ADMIN);
  assert.equal(dev.password_temporal.length, 10);

  const lista = CuentasPortal.listar(db, {}, ADMIN).cuentas;
  assert.deepEqual(lista[0].modulos, ['nueva_solicitud', 'mis_solicitudes', 'bandeja', 'mi_trabajo']);

  const repetido = CuentasPortal.gestionar(db, {
    operacion: 'crear', usuario: 'LEO', nombre: 'Otro', emails: 'otro@rld.cl'
  }, ADMIN);
  assert.equal(repetido._validationError, true);
});

test('actualizar permite modulos por persona, distintos de la plantilla del rol', () => {
  const db = dbConSchema();
  const creada = CuentasPortal.gestionar(db, {
    operacion: 'crear', usuario: 'felipe', nombre: 'Felipe', emails: 'felipe@rld.cl', rol: 'SOLICITANTE'
  }, ADMIN);

  CuentasPortal.gestionar(db, {
    operacion: 'actualizar', cuenta_id: creada.cuenta_id,
    modulos: ['nueva_solicitud', 'mis_solicitudes', 'gerencia']
  }, ADMIN);

  const cuenta = CuentasPortal.listar(db, {}, ADMIN).cuentas[0];
  assert.equal(cuenta.rol, 'SOLICITANTE');
  assert.deepEqual(cuenta.modulos, ['nueva_solicitud', 'mis_solicitudes', 'gerencia']);

  const invalido = CuentasPortal.gestionar(db, {
    operacion: 'actualizar', cuenta_id: creada.cuenta_id, modulos: ['hackear_todo']
  }, ADMIN);
  assert.equal(invalido._validationError, true);
});

test('resetear password genera clave nueva de un solo anuncio y vuelve a exigir cambio', () => {
  const db = dbConSchema();
  const creada = CuentasPortal.gestionar(db, {
    operacion: 'crear', usuario: 'cpena', nombre: 'Camila', emails: 'c@gde.cl'
  }, ADMIN);
  const reset = CuentasPortal.gestionar(db, { operacion: 'resetear_password', cuenta_id: creada.cuenta_id }, ADMIN);

  assert.notEqual(reset.password_temporal, creada.password_temporal);
  const { leerFilas_ } = require('../db/sqliteRepo');
  const fila = leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL)[0];
  assert.equal(fila.debe_cambiar_password, true);
  // La clave nunca queda guardada -- solo el hash.
  assert.equal(JSON.stringify(fila).includes(reset.password_temporal), false);
});

test('listar nunca expone hash ni sal, ni siquiera al Admin', () => {
  const db = dbConSchema();
  CuentasPortal.gestionar(db, { operacion: 'crear', usuario: 'cpena', nombre: 'Camila', emails: 'c@gde.cl' }, ADMIN);
  const cuenta = CuentasPortal.listar(db, {}, ADMIN).cuentas[0];
  assert.equal(cuenta.hash_password, undefined);
  assert.equal(cuenta.salt, undefined);
});

test('renombrar valida formato y unicidad del nuevo usuario', () => {
  const db = dbConSchema();
  CuentasPortal.gestionar(db, { operacion: 'crear', usuario: 'existente', nombre: 'A', emails: 'a@a.cl' }, ADMIN);
  const creada = CuentasPortal.gestionar(db, { operacion: 'crear', usuario: 'porrenombrar', nombre: 'B', emails: 'b@b.cl' }, ADMIN);

  const chocaConOtro = CuentasPortal.gestionar(db, {
    operacion: 'renombrar', cuenta_id: creada.cuenta_id, usuario: 'existente'
  }, ADMIN);
  assert.equal(chocaConOtro._validationError, true);

  const ok = CuentasPortal.gestionar(db, {
    operacion: 'renombrar', cuenta_id: creada.cuenta_id, usuario: 'nuevo-nombre'
  }, ADMIN);
  assert.equal(ok.usuario, 'nuevo-nombre');
});

test('eliminar borra la cuenta y sus sesiones', () => {
  const db = dbConSchema();
  const creada = CuentasPortal.gestionar(db, { operacion: 'crear', usuario: 'borrar', nombre: 'X', emails: 'x@x.cl' }, ADMIN);
  const { agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
  agregarFila_(db, 'SESIONES_PORTAL', {
    token: 'tok-1', cuenta_id: creada.cuenta_id,
    expira: new Date(Date.now() + 3600000).toISOString(), creada: new Date().toISOString()
  });

  const res = CuentasPortal.gestionar(db, { operacion: 'eliminar', cuenta_id: creada.cuenta_id }, ADMIN);
  assert.equal(res.eliminada, true);
  assert.equal(CuentasPortal.listar(db, {}, ADMIN).cuentas.length, 0);
  assert.equal(leerFilas_(db, 'SESIONES_PORTAL', COLUMNAS.SESIONES_PORTAL).length, 0);
});

test('operacion invalida responde error de validacion', () => {
  const db = dbConSchema();
  const res = CuentasPortal.gestionar(db, { operacion: 'volar' }, ADMIN);
  assert.equal(res._validationError, true);
});
