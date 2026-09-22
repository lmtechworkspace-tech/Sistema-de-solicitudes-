'use strict';

/**
 * Prueba de portabilidad: Perfiles.getMiPerfil (Perfiles.gs), corrida
 * contra perfiles.js. Escenarios adaptados de backend/test/perfiles.test.js
 * (el .gs, vía gasSandbox) -- solo los del perfil de solo lectura; los de
 * foto (guardarFoto/eliminarFoto/getFotosDe, portados 2026-09-22) están en
 * perfiles-foto.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Perfiles = require('../logica/perfiles');

function db_() {
  const db = abrirDb_();
  ['USUARIOS', 'CUENTAS_PORTAL', 'CAT_EMPRESAS'].forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function seedUsuarioGoogle(db, overrides) {
  const base = Object.assign({
    usuario_id: 'u-1', nombre: 'Juan Pérez', email: 'juan@homepymes.cl',
    empresa_id: 'HP', rol: 'ANA', activo: true, ultimo_acceso: '', creado_por: 'adm@hp.cl'
  }, overrides);
  require('../db/sqliteRepo').agregarFila_(db, 'USUARIOS', base);
  return base;
}
function seedCuentaPortal(db, overrides) {
  const base = Object.assign({
    cuenta_id: 'c-1', usuario: 'camila', nombre: 'Camila Soto', cargo: 'Analista',
    hash_password: 'x', salt: 'y', emails: JSON.stringify(['camila@rld.cl']),
    rol: 'DEV', modulos: JSON.stringify(['bandeja']), empresa_id: 'RLD',
    activo: true, debe_cambiar_password: false, ultimo_acceso: '', creado_por: 'adm@hp.cl'
  }, overrides);
  require('../db/sqliteRepo').agregarFila_(db, 'CUENTAS_PORTAL', base);
  return base;
}
function seedEmpresa(db, empresaId, nombre) {
  require('../db/sqliteRepo').agregarFila_(db, 'CAT_EMPRESAS', { empresa_id: empresaId, nombre, logo: '', activo: true });
}

function ctxGoogle(email) {
  return { email: email || 'juan@homepymes.cl', rol: 'ANA' };
}
function ctxPortal(cuentaId, email) {
  return { email: email || 'camila@rld.cl', rol: 'DEV', modulos: ['bandeja'], via_portal: true, cuenta_id: cuentaId || 'c-1' };
}

test('1. usuario Google: perfil viene de USUARIOS, tiene_foto=false (foto fuera de alcance)', () => {
  const db = db_();
  seedUsuarioGoogle(db);
  seedEmpresa(db, 'HP', 'HomePymes');

  const perfil = Perfiles.getMiPerfil(db, {}, ctxGoogle());
  assert.equal(perfil.tiene_foto, false);
  assert.equal(perfil.foto_thumb, '');
  assert.equal(perfil.nombre, 'Juan Pérez');
  assert.equal(perfil.email, 'juan@homepymes.cl');
  assert.equal(perfil.rol, 'ANA');
  assert.equal(perfil.empresa_nombre, 'HomePymes');
  assert.equal(perfil.origen, 'GOOGLE');
});

test('2. usuario Portal: se identifica por cuenta_id, no por correo', () => {
  const db = db_();
  seedCuentaPortal(db);
  seedEmpresa(db, 'RLD', 'RLD');

  const perfil = Perfiles.getMiPerfil(db, {}, ctxPortal());
  assert.equal(perfil.nombre, 'Camila Soto');
  assert.equal(perfil.cargo, 'Analista');
  assert.equal(perfil.origen, 'PORTAL');
});

test('sin identidad en el contexto: forbidden', () => {
  const db = db_();
  const res = Perfiles.getMiPerfil(db, {}, {});
  assert.equal(res._forbidden, true);
});

test('contexto de portal sin cuenta_id: forbidden', () => {
  const db = db_();
  const res = Perfiles.getMiPerfil(db, {}, { email: 'x@y.cl', via_portal: true });
  assert.equal(res._forbidden, true);
});

test('el perfil siempre es el de QUIEN LLAMA: no hay parámetro de data que lo cambie', () => {
  const db = db_();
  seedUsuarioGoogle(db, { email: 'juan@homepymes.cl' });
  seedUsuarioGoogle(db, { usuario_id: 'u-2', nombre: 'Otra', email: 'otra@homepymes.cl' });

  const perfil = Perfiles.getMiPerfil(db,
    { email: 'otra@homepymes.cl', usuario_id: 'u-2', identidad_clave: 'otra@homepymes.cl' },
    ctxGoogle('juan@homepymes.cl'));

  assert.equal(perfil.nombre, 'Juan Pérez', 'debe ignorar cualquier identificador en data');
  assert.equal(perfil.email, 'juan@homepymes.cl');
});

test('rol del portal: sale de CUENTAS_PORTAL.rol (el real), no del rol normalizado del contexto', () => {
  const db = db_();
  // SOLICITANTE llega normalizado a DEV en contexto.rol (router.js), pero el
  // perfil debe mostrar el rol REAL de la cuenta.
  seedCuentaPortal(db, { cuenta_id: 'c-2', rol: 'SOLICITANTE' });
  const perfil = Perfiles.getMiPerfil(db, {}, { email: 'camila@rld.cl', rol: 'DEV', rol_origen: 'SOLICITANTE', via_portal: true, cuenta_id: 'c-2' });
  assert.equal(perfil.rol, 'SOLICITANTE');
});

test('sin CAT_EMPRESAS para el empresa_id, muestra el id como nombre (no inventa uno)', () => {
  const db = db_();
  seedUsuarioGoogle(db, { empresa_id: 'ZZZ' });
  const perfil = Perfiles.getMiPerfil(db, {}, ctxGoogle());
  assert.equal(perfil.empresa_nombre, 'ZZZ');
});
