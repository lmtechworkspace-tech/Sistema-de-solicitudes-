'use strict';

/**
 * Prueba de portabilidad: Auth.gestionarUsuario / listarUsuarios / RN-030
 * (Auth.gs), corridas contra auth.js. Escenarios adaptados de
 * backend/test/auth.test.js (el .gs, vía gasSandbox). suspenderInactivos
 * se prueba aparte, abajo: es lógica portada pero NO una acción de
 * router.js (ver la cabecera de auth.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, leerFilas_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Auth = require('../logica/auth');

function db_(usuarios) {
  const db = abrirDb_();
  sembrarTabla_(db, 'USUARIOS', COLUMNAS.USUARIOS, []);
  (usuarios || []).forEach((u) => agregarFila_(db, 'USUARIOS', u));
  return db;
}
const ADMIN_CTX = { email: 'admin@homepymes.cl', rol: 'ADM' };

test('gestionarUsuario (Admin) crea un usuario nuevo', () => {
  const db = db_();
  const resultado = Auth.gestionarUsuario(db,
    { email: 'nuevo@homepymes.cl', nombre: 'Nuevo', empresa_id: 'HP', rol: 'ANA' }, ADMIN_CTX);

  assert.equal(resultado.email, 'nuevo@homepymes.cl');
  assert.equal(resultado.activo, true);
  assert.equal(leerFilas_(db, 'USUARIOS', COLUMNAS.USUARIOS).length, 1);
});

test('gestionarUsuario rechaza si quien llama no es Admin', () => {
  const db = db_();
  const resultado = Auth.gestionarUsuario(db,
    { email: 'nuevo@homepymes.cl', empresa_id: 'HP', rol: 'ANA' }, { email: 'analista@homepymes.cl', rol: 'ANA' });
  assert.equal(resultado._forbidden, true);
});

test('gestionarUsuario edita un usuario existente en vez de duplicarlo', () => {
  const db = db_([{ usuario_id: 'U1', nombre: 'Ana', email: 'ana@homepymes.cl', empresa_id: 'HP', rol: 'ANA', activo: true, ultimo_acceso: '', creado_por: 'sistema' }]);
  const resultado = Auth.gestionarUsuario(db, { email: 'ana@homepymes.cl', nombre: 'Ana Actualizada' }, ADMIN_CTX);

  assert.equal(resultado.nombre, 'Ana Actualizada');
  assert.equal(leerFilas_(db, 'USUARIOS', COLUMNAS.USUARIOS).length, 1);
});

test('gestionarUsuario (RN-030): no permite desactivar al último Admin activo de una empresa', () => {
  const db = db_([{ usuario_id: 'U1', nombre: 'Admin Uno', email: 'admin1@homepymes.cl', empresa_id: 'HP', rol: 'ADM', activo: true, ultimo_acceso: '', creado_por: 'sistema' }]);
  const resultado = Auth.gestionarUsuario(db, { email: 'admin1@homepymes.cl', activo: false }, { email: 'otro-admin@homepymes.cl', rol: 'ADM' });
  assert.equal(resultado._validationError, true);
});

test('gestionarUsuario (RN-030): permite desactivar un Admin si queda otro activo', () => {
  const db = db_([
    { usuario_id: 'U1', nombre: 'Admin Uno', email: 'admin1@homepymes.cl', empresa_id: 'HP', rol: 'ADM', activo: true, ultimo_acceso: '', creado_por: 'sistema' },
    { usuario_id: 'U2', nombre: 'Admin Dos', email: 'admin2@homepymes.cl', empresa_id: 'HP', rol: 'ADM', activo: true, ultimo_acceso: '', creado_por: 'sistema' }
  ]);
  const resultado = Auth.gestionarUsuario(db, { email: 'admin1@homepymes.cl', activo: false }, { email: 'admin2@homepymes.cl', rol: 'ADM' });
  assert.equal(resultado.activo, false);
});

test('gestionarUsuario (RN-030): también aplica al bajar el rol de Admin a otro rol', () => {
  const db = db_([{ usuario_id: 'U1', nombre: 'Admin Uno', email: 'admin1@homepymes.cl', empresa_id: 'HP', rol: 'ADM', activo: true, ultimo_acceso: '', creado_por: 'sistema' }]);
  const resultado = Auth.gestionarUsuario(db, { email: 'admin1@homepymes.cl', rol: 'ANA' }, { email: 'otro@homepymes.cl', rol: 'ADM' });
  assert.equal(resultado._validationError, true);
});

test('gestionarUsuario responde error de validación si falta empresa_id al crear', () => {
  const db = db_();
  const resultado = Auth.gestionarUsuario(db, { email: 'nuevo@homepymes.cl', rol: 'ANA' }, ADMIN_CTX);
  assert.equal(resultado._validationError, true);
});

test('listarUsuarios (Admin) devuelve todos los usuarios', () => {
  const db = db_([
    { usuario_id: 'U1', nombre: 'Ana', email: 'ana@homepymes.cl', empresa_id: 'HP', rol: 'ANA', activo: true, ultimo_acceso: '', creado_por: 'sistema' },
    { usuario_id: 'U2', nombre: 'Dev', email: 'dev@homepymes.cl', empresa_id: 'HP', rol: 'DEV', activo: false, ultimo_acceso: '', creado_por: 'sistema' }
  ]);
  const lista = Auth.listarUsuarios(db, {}, ADMIN_CTX);
  assert.equal(lista.length, 2);
});

test('listarUsuarios rechaza roles distintos de Admin', () => {
  const db = db_();
  const resultado = Auth.listarUsuarios(db, {}, { email: 'analista@homepymes.cl', rol: 'ANA' });
  assert.equal(resultado._forbidden, true);
});

// --- suspenderInactivos (A-11, RN-029): lógica portada, no expuesta -------

test('suspenderInactivos: suspende a quien supera 90 días sin acceso', () => {
  const hace100Dias = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
  const db = db_([{ usuario_id: 'U1', nombre: 'Inactivo', email: 'inactivo@hp.cl', empresa_id: 'HP', rol: 'ANA', activo: true, ultimo_acceso: hace100Dias, creado_por: 'sistema' }]);
  const suspendidos = Auth.suspenderInactivos(db);
  assert.deepEqual(suspendidos, ['inactivo@hp.cl']);
  assert.equal(leerFilas_(db, 'USUARIOS', COLUMNAS.USUARIOS)[0].activo, false);
});

test('suspenderInactivos: NO suspende a quien nunca accedió (margen de primer ingreso)', () => {
  const db = db_([{ usuario_id: 'U1', nombre: 'Nuevo', email: 'nuevo@hp.cl', empresa_id: 'HP', rol: 'ANA', activo: true, ultimo_acceso: '', creado_por: 'sistema' }]);
  const suspendidos = Auth.suspenderInactivos(db);
  assert.deepEqual(suspendidos, []);
});

test('suspenderInactivos: NO suspende a quien accedió hace menos de 90 días', () => {
  const hace10Dias = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const db = db_([{ usuario_id: 'U1', nombre: 'Reciente', email: 'reciente@hp.cl', empresa_id: 'HP', rol: 'ANA', activo: true, ultimo_acceso: hace10Dias, creado_por: 'sistema' }]);
  const suspendidos = Auth.suspenderInactivos(db);
  assert.deepEqual(suspendidos, []);
});
