'use strict';

/**
 * v6.0 (modulo Pausas Activas, Fase P0): configuracion administrable por ADM.
 * Estos tests cubren el CRUD de las tres cosas que el usuario pidio que fueran
 * editables: los parametros por empresa (hora/dias/duracion/umbrales), las
 * coordinadoras (titulares/reemplazos) y el roster de trabajadores.
 *
 * Todo es ADM-only y aditivo: no toca ninguna hoja del sistema de solicitudes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

const ADMIN = { rol: 'ADM', email: 'admin@homepymes.cl' };
const DEV = { rol: 'DEV', email: 'dev@homepymes.cl' };

function loadConPausas() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'PAUSAS_CONFIG', ctx.COLUMNAS.PAUSAS_CONFIG);
  seedSheet(ctx, 'PAUSAS_COORDINADORES', ctx.COLUMNAS.PAUSAS_COORDINADORES);
  seedSheet(ctx, 'PAUSAS_TRABAJADORES', ctx.COLUMNAS.PAUSAS_TRABAJADORES);
  seedSheet(ctx, 'PAUSAS_LOG', ctx.COLUMNAS.PAUSAS_LOG);
  return ctx;
}

// --- PAUSAS_CONFIG ----------------------------------------------------------

test('guardarConfig crea la config de una empresa y normaliza hora/dias', () => {
  const ctx = loadConPausas();
  const res = ctx.Pausas.guardarConfig({
    empresa_id: 'HP', hora_habitual: '9:30', dias_semana: '3,1,1,5',
    duracion_min: 10, min_anticipacion: 15, umbral_verde: 80, umbral_amarillo: 60
  }, ADMIN);

  assert.ok(!res._validationError && !res._forbidden, JSON.stringify(res));
  assert.equal(res.hora_habitual, '09:30'); // cero a la izquierda
  assert.equal(res.dias_semana, '1,3,5'); // unico y ordenado
  const filas = ctx.Pausas.listarConfig({}, ADMIN);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].empresa_id, 'HP');
});

test('guardarConfig hace UPSERT por empresa_id (no duplica la fila)', () => {
  const ctx = loadConPausas();
  ctx.Pausas.guardarConfig({ empresa_id: 'HP', hora_habitual: '09:00', duracion_min: 5 }, ADMIN);
  ctx.Pausas.guardarConfig({ empresa_id: 'HP', hora_habitual: '10:00', duracion_min: 8 }, ADMIN);

  const filas = ctx.Pausas.listarConfig({}, ADMIN);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].hora_habitual, '10:00');
  assert.equal(String(filas[0].duracion_min), '8');
});

test('guardarConfig rechaza hora, dias, duracion y umbrales invalidos', () => {
  const ctx = loadConPausas();
  assert.equal(ctx.Pausas.guardarConfig({ empresa_id: 'HP', hora_habitual: '25:00' }, ADMIN)._validationError, true);
  assert.equal(ctx.Pausas.guardarConfig({ empresa_id: 'HP', dias_semana: '1,9' }, ADMIN)._validationError, true);
  assert.equal(ctx.Pausas.guardarConfig({ empresa_id: 'HP', duracion_min: 0 }, ADMIN)._validationError, true);
  assert.equal(ctx.Pausas.guardarConfig({ empresa_id: 'HP', umbral_verde: 120 }, ADMIN)._validationError, true);
  // amarillo no puede superar al verde
  assert.equal(ctx.Pausas.guardarConfig({ empresa_id: 'HP', umbral_verde: 50, umbral_amarillo: 70 }, ADMIN)._validationError, true);
  // falta empresa
  assert.equal(ctx.Pausas.guardarConfig({ hora_habitual: '09:00' }, ADMIN)._validationError, true);
});

test('la configuracion de pausas es ADM-only', () => {
  const ctx = loadConPausas();
  assert.equal(ctx.Pausas.guardarConfig({ empresa_id: 'HP', hora_habitual: '09:00' }, DEV)._forbidden, true);
  assert.equal(ctx.Pausas.listarConfig({}, DEV)._forbidden, true);
  assert.equal(ctx.Pausas.gestionarCoordinador({ operacion: 'crear' }, DEV)._forbidden, true);
  assert.equal(ctx.Pausas.gestionarTrabajador({ operacion: 'crear' }, DEV)._forbidden, true);
});

// --- PAUSAS_COORDINADORES ---------------------------------------------------

test('gestionarCoordinador crea titular y reemplazo, y valida el tipo', () => {
  const ctx = loadConPausas();
  const t = ctx.Pausas.gestionarCoordinador({
    operacion: 'crear', empresa_id: 'HP', nombre: 'Amarlla', email: 'amarilla@hp.cl', tipo: 'titular'
  }, ADMIN);
  assert.ok(!t._validationError, JSON.stringify(t));
  assert.equal(t.tipo, 'titular');
  assert.ok(t.coord_id);

  const r = ctx.Pausas.gestionarCoordinador({
    operacion: 'crear', empresa_id: 'HP', nombre: 'Camila', email: 'camila@hp.cl', tipo: 'reemplazo'
  }, ADMIN);
  assert.equal(r.tipo, 'reemplazo');

  // tipo invalido
  assert.equal(ctx.Pausas.gestionarCoordinador({
    operacion: 'crear', empresa_id: 'HP', nombre: 'X', email: 'x@hp.cl', tipo: 'jefe'
  }, ADMIN)._validationError, true);

  assert.equal(ctx.Pausas.listarCoordinadores({}, ADMIN).length, 2);
});

test('gestionarCoordinador rechaza correo invalido y duplicados activos', () => {
  const ctx = loadConPausas();
  assert.equal(ctx.Pausas.gestionarCoordinador({
    operacion: 'crear', empresa_id: 'HP', nombre: 'X', email: 'no-es-correo'
  }, ADMIN)._validationError, true);

  ctx.Pausas.gestionarCoordinador({ operacion: 'crear', empresa_id: 'HP', nombre: 'Amarlla', email: 'a@hp.cl' }, ADMIN);
  const dup = ctx.Pausas.gestionarCoordinador({ operacion: 'crear', empresa_id: 'HP', nombre: 'Amarlla 2', email: 'A@hp.cl' }, ADMIN);
  assert.equal(dup._validationError, true);
});

test('gestionarCoordinador desactiva (baja logica) y elimina', () => {
  const ctx = loadConPausas();
  const c = ctx.Pausas.gestionarCoordinador({ operacion: 'crear', empresa_id: 'HP', nombre: 'Amarlla', email: 'a@hp.cl' }, ADMIN);

  ctx.Pausas.gestionarCoordinador({ operacion: 'activar', coord_id: c.coord_id, activo: false }, ADMIN);
  assert.equal(ctx.Pausas.listarCoordinadores({}, ADMIN)[0].activo, false);
  // desactivada libera el correo para un nuevo alta
  const reAlta = ctx.Pausas.gestionarCoordinador({ operacion: 'crear', empresa_id: 'HP', nombre: 'Amarlla', email: 'a@hp.cl' }, ADMIN);
  assert.ok(!reAlta._validationError);

  ctx.Pausas.gestionarCoordinador({ operacion: 'eliminar', coord_id: c.coord_id }, ADMIN);
  // quedaba la desactivada + la re-alta; se borro la primera -> 1
  assert.equal(ctx.Pausas.listarCoordinadores({}, ADMIN).length, 1);
});

// --- PAUSAS_TRABAJADORES ----------------------------------------------------

test('gestionarTrabajador crea con area/cargo y pone fecha_ingreso por defecto', () => {
  const ctx = loadConPausas();
  const t = ctx.Pausas.gestionarTrabajador({
    operacion: 'crear', empresa_id: 'HP', nombre: 'Juan', email: 'juan@hp.cl', area: 'Bodega', cargo: 'Operario'
  }, ADMIN);
  assert.ok(!t._validationError, JSON.stringify(t));
  assert.equal(t.area, 'Bodega');
  assert.ok(t.fecha_ingreso); // default a hoy
  assert.equal(ctx.Pausas.listarTrabajadores({}, ADMIN).length, 1);
});

test('gestionarTrabajador rechaza duplicado activo y permite eliminar', () => {
  const ctx = loadConPausas();
  const t = ctx.Pausas.gestionarTrabajador({ operacion: 'crear', empresa_id: 'HP', nombre: 'Juan', email: 'juan@hp.cl' }, ADMIN);
  const dup = ctx.Pausas.gestionarTrabajador({ operacion: 'crear', empresa_id: 'HP', nombre: 'Juan 2', email: 'juan@hp.cl' }, ADMIN);
  assert.equal(dup._validationError, true);

  ctx.Pausas.gestionarTrabajador({ operacion: 'eliminar', trabajador_id: t.trabajador_id }, ADMIN);
  assert.equal(ctx.Pausas.listarTrabajadores({}, ADMIN).length, 0);
});

// --- auditoria --------------------------------------------------------------

test('las operaciones dejan traza en PAUSAS_LOG', () => {
  const ctx = loadConPausas();
  ctx.Pausas.guardarConfig({ empresa_id: 'HP', hora_habitual: '09:00' }, ADMIN);
  ctx.Pausas.gestionarCoordinador({ operacion: 'crear', empresa_id: 'HP', nombre: 'Amarlla', email: 'a@hp.cl' }, ADMIN);

  const logs = ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('PAUSAS_LOG')
    .getDataRange().getValues().slice(1);
  assert.ok(logs.length >= 2);
});
