'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadIntakeProject, seedSheet } = require('./helpers/gasSandbox');

function loadConCounters(rows) {
  const ctx = loadIntakeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'COUNTERS', ctx.COLUMNAS.COUNTERS, rows || []);
  return ctx;
}

test('generarId_ crea la fila del correlativo la primera vez (formato SOL-AAAA-EMPRESA-NNNN)', () => {
  const ctx = loadConCounters();
  const id = ctx.generarId_('HP');
  const anio = new Date().getFullYear();

  assert.equal(id, 'SOL-' + anio + '-HP-0001');
});

test('generarId_ incrementa el correlativo existente para la misma empresa+anio', () => {
  const ctx = loadConCounters();
  const primero = ctx.generarId_('HP');
  const segundo = ctx.generarId_('HP');
  const anio = new Date().getFullYear();

  assert.equal(primero, 'SOL-' + anio + '-HP-0001');
  assert.equal(segundo, 'SOL-' + anio + '-HP-0002');
});

test('generarId_ mantiene contadores independientes por empresa', () => {
  const ctx = loadConCounters();
  const idHP = ctx.generarId_('HP');
  const idRLD = ctx.generarId_('RLD');
  const anio = new Date().getFullYear();

  assert.equal(idHP, 'SOL-' + anio + '-HP-0001');
  assert.equal(idRLD, 'SOL-' + anio + '-RLD-0001');
});

test('generarId_ no reutiliza el numero de un anio anterior (reinicio por anio)', () => {
  const anioActual = new Date().getFullYear();
  const ctx = loadConCounters([['HP', anioActual - 1, 5]]);

  const id = ctx.generarId_('HP');

  assert.equal(id, 'SOL-' + anioActual + '-HP-0001');
  // La fila del anio anterior no se toca.
  const filas = ctx.leerFilas_('COUNTERS');
  const filaVieja = filas.find((f) => Number(f.anio) === anioActual - 1);
  assert.equal(Number(filaVieja.ultimo_numero), 5);
});

test('generarId_ propaga el error si el lock ya esta tomado', () => {
  const ctx = loadConCounters();
  const lock = ctx.LockService.getScriptLock();
  lock.waitLock(1000);

  assert.throws(() => ctx.generarId_('HP'));

  lock.releaseLock();
});
