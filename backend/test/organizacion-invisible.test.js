'use strict';

/**
 * Fase "Organización invisible" (documento "Arquitectura de Accesos",
 * 2026-09-19, decisiones 1 y 4 del rediseño de accesos): tabla ORGANIZACIONES
 * nueva + columna organizacion_id en CUENTAS_PORTAL/CAT_EMPRESAS, con UNA
 * fila que agrupa todo lo que ya existe. Cubre dos piezas:
 *
 *   1. asegurarColumnas_ (sqliteRepo.js): el primitivo genérico de "agregar
 *      una columna a una tabla real con datos" -- no existía hasta ahora
 *      (asegurarTabla_ solo creaba tablas nuevas, nunca migraba una
 *      existente).
 *   2. asegurarOrganizacionPorDefecto_ (schema.js, vía asegurarEsquema):
 *      la siembra + el backfill, corridos automáticamente en cada arranque
 *      del servidor -- sin intervención manual en producción.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_, asegurarColumnas_ } = require('../db/sqliteRepo');
const { asegurarEsquema, COLUMNAS, ORGANIZACION_POR_DEFECTO_ID } = require('../db/schema');

// --- asegurarColumnas_ -------------------------------------------------

test('asegurarColumnas_: agrega una columna nueva a una tabla real con datos, sin tocar lo existente', () => {
  const db = abrirDb_();
  sembrarTabla_(db, 'CAT_EMPRESAS', ['empresa_id', 'nombre', 'logo', 'activo'], [
    ['HP', 'HomePymes', 'logo.png', true]
  ]);
  asegurarColumnas_(db, 'CAT_EMPRESAS', ['empresa_id', 'nombre', 'logo', 'activo', 'organizacion_id']);

  const filas = leerFilas_(db, 'CAT_EMPRESAS', ['empresa_id', 'nombre', 'logo', 'activo', 'organizacion_id']);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].nombre, 'HomePymes', 'no debe tocar datos existentes');
  assert.equal(filas[0].organizacion_id, '', 'la fila vieja lee \'\' para la columna nueva, igual que una columna que no existe');
});

test('asegurarColumnas_: no rompe si se corre dos veces (idempotente)', () => {
  const db = abrirDb_();
  sembrarTabla_(db, 'CAT_EMPRESAS', ['empresa_id', 'nombre', 'logo', 'activo'], []);
  asegurarColumnas_(db, 'CAT_EMPRESAS', ['empresa_id', 'nombre', 'logo', 'activo', 'organizacion_id']);
  assert.doesNotThrow(() => asegurarColumnas_(db, 'CAT_EMPRESAS', ['empresa_id', 'nombre', 'logo', 'activo', 'organizacion_id']));
});

test('asegurarColumnas_: no hace nada si la tabla no existe (no revienta el arranque)', () => {
  const db = abrirDb_();
  assert.doesNotThrow(() => asegurarColumnas_(db, 'NO_EXISTE', ['algo']));
});

test('asegurarColumnas_: una fila agregada DESPUÉS sí puede escribir un valor real en la columna nueva', () => {
  const db = abrirDb_();
  sembrarTabla_(db, 'CAT_EMPRESAS', ['empresa_id', 'nombre', 'logo', 'activo'], []);
  asegurarColumnas_(db, 'CAT_EMPRESAS', ['empresa_id', 'nombre', 'logo', 'activo', 'organizacion_id']);
  agregarFila_(db, 'CAT_EMPRESAS', { empresa_id: 'RLD', nombre: 'RLD', logo: '', activo: true, organizacion_id: 'org-1' });
  const fila = leerFilas_(db, 'CAT_EMPRESAS', ['empresa_id', 'nombre', 'logo', 'activo', 'organizacion_id']).find((f) => f.empresa_id === 'RLD');
  assert.equal(fila.organizacion_id, 'org-1');
});

// --- asegurarOrganizacionPorDefecto_ (vía asegurarEsquema) --------------

function dbEstiloProduccionVieja_() {
  // Simula el esquema de producción ANTES de este incremento: sin la
  // columna organizacion_id ni la tabla ORGANIZACIONES.
  const db = abrirDb_();
  sembrarTabla_(db, 'CAT_EMPRESAS', ['empresa_id', 'nombre', 'logo', 'activo'], [
    ['HP', 'HomePymes', '', true],
    ['RLD', 'RLD', '', true]
  ]);
  sembrarTabla_(db, 'CUENTAS_PORTAL', [
    'cuenta_id', 'usuario', 'nombre', 'cargo', 'hash_password', 'salt', 'emails',
    'rol', 'modulos', 'empresa_id', 'activo', 'debe_cambiar_password', 'ultimo_acceso', 'creado_por'
  ], [
    ['c-1', 'lmendoza', 'Luis Mendoza', 'Admin', 'h', 's', '["a@x.cl"]', 'ADM', '[]', 'HP', true, false, '', 'sistema']
  ]);
  sembrarTabla_(db, 'USUARIOS', ['usuario_id', 'nombre', 'email', 'empresa_id', 'rol', 'activo', 'ultimo_acceso', 'creado_por'], [
    ['U1', 'Luis Mendoza', 'a@x.cl', 'HP', 'ADM', true, '', 'sistema']
  ]);
  return db;
}

test('asegurarEsquema: crea ORGANIZACIONES con UNA sola fila por defecto', () => {
  const db = dbEstiloProduccionVieja_();
  asegurarEsquema(db);
  const organizaciones = leerFilas_(db, 'ORGANIZACIONES', COLUMNAS.ORGANIZACIONES);
  assert.equal(organizaciones.length, 1);
  assert.equal(organizaciones[0].organizacion_id, ORGANIZACION_POR_DEFECTO_ID);
  assert.equal(organizaciones[0].activo, true);
});

test('asegurarEsquema: le asigna la organización por defecto a TODAS las cuentas y empresas ya existentes', () => {
  const db = dbEstiloProduccionVieja_();
  asegurarEsquema(db);

  const cuentas = leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL);
  assert.ok(cuentas.every((c) => c.organizacion_id === ORGANIZACION_POR_DEFECTO_ID));

  const empresas = leerFilas_(db, 'CAT_EMPRESAS', COLUMNAS.CAT_EMPRESAS);
  assert.ok(empresas.every((e) => e.organizacion_id === ORGANIZACION_POR_DEFECTO_ID));
});

test('asegurarEsquema: NO toca USUARIOS (identidad legada, ya decidido retirarla en Fase 4)', () => {
  const db = dbEstiloProduccionVieja_();
  asegurarEsquema(db);
  const usuarios = leerFilas_(db, 'USUARIOS', COLUMNAS.USUARIOS);
  assert.equal(usuarios[0].organizacion_id, undefined, 'USUARIOS no debe ganar la columna organizacion_id');
});

test('asegurarEsquema: es idempotente -- correrla varias veces no duplica la organización ni rompe nada', () => {
  const db = dbEstiloProduccionVieja_();
  asegurarEsquema(db);
  asegurarEsquema(db);
  asegurarEsquema(db);
  assert.equal(leerFilas_(db, 'ORGANIZACIONES', COLUMNAS.ORGANIZACIONES).length, 1);
  assert.equal(leerFilas_(db, 'CAT_EMPRESAS', COLUMNAS.CAT_EMPRESAS).length, 2, 'no debe duplicar filas existentes');
});

test('asegurarEsquema: NUNCA pisa un organizacion_id ya asignado a mano', () => {
  const db = dbEstiloProduccionVieja_();
  asegurarEsquema(db); // primera corrida: asigna el default a todo

  // Simula una organización futura real y una empresa reasignada a mano.
  agregarFila_(db, 'ORGANIZACIONES', { organizacion_id: 'org-cliente-nuevo', nombre: 'Cliente Nuevo SpA', activo: true, creado_en: new Date().toISOString() });
  const { actualizarFilaPorId_ } = require('../db/sqliteRepo');
  actualizarFilaPorId_(db, 'CAT_EMPRESAS', 'empresa_id', 'RLD', { organizacion_id: 'org-cliente-nuevo' });

  asegurarEsquema(db); // segunda corrida: no debe tocar la reasignación

  const rld = leerFilas_(db, 'CAT_EMPRESAS', COLUMNAS.CAT_EMPRESAS).find((e) => e.empresa_id === 'RLD');
  assert.equal(rld.organizacion_id, 'org-cliente-nuevo', 'una asignación explícita no debe revertirse');
  const hp = leerFilas_(db, 'CAT_EMPRESAS', COLUMNAS.CAT_EMPRESAS).find((e) => e.empresa_id === 'HP');
  assert.equal(hp.organizacion_id, ORGANIZACION_POR_DEFECTO_ID, 'la que nunca se reasignó sigue con el default');
});

test('asegurarEsquema: sobre una base de datos NUEVA (sin ninguna tabla) también funciona', () => {
  const db = abrirDb_();
  assert.doesNotThrow(() => asegurarEsquema(db));
  assert.equal(leerFilas_(db, 'ORGANIZACIONES', COLUMNAS.ORGANIZACIONES).length, 1);
});
