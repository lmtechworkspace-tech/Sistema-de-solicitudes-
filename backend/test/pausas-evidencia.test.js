'use strict';

/**
 * v6.0 (mejora #4): evidencia de la charla -- foto opcional que la
 * coordinadora adjunta al finalizar una pausa (gestionarPausaCoordinador,
 * operacion 'finalizar'). Reusa el patron de Drive.subirArchivo del Intake,
 * simplificado a solo imagenes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

const ADMIN = { rol: 'ADM', email: 'admin@homepymes.cl' };

// PNG minimo valido (firma 89 50 4E 47) en base64 -- no hace falta que sea
// una imagen completa/decodificable, solo que la firma de bytes coincida.
const PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).toString('base64');
const TEXTO_BASE64 = Buffer.from('esto no es una imagen').toString('base64');

function load(opts) {
  opts = opts || {};
  const props = { SIGSO_SHEET_ID: 'fake-sheet-id' };
  if (opts.conDriveRoot !== false) props.SIGSO_DRIVE_ROOT_FOLDER_ID = 'root-1';
  const ctx = loadBackofficeProject({ scriptProperties: props });
  seedSheet(ctx, 'PAUSAS_CONFIG', ctx.COLUMNAS.PAUSAS_CONFIG, [['HP', '09:30', '1,2,3,4,5', 10, 15, 80, 60, true]]);
  seedSheet(ctx, 'PAUSAS_COORDINADORES', ctx.COLUMNAS.PAUSAS_COORDINADORES, []);
  seedSheet(ctx, 'PAUSAS_TRABAJADORES', ctx.COLUMNAS.PAUSAS_TRABAJADORES, []);
  seedSheet(ctx, 'PAUSAS_PROGRAMADAS', ctx.COLUMNAS.PAUSAS_PROGRAMADAS, [
    ['PA-1', 'HP', '2026-07-27', '09:30', '', '', '', 'En_curso', 10, '']
  ]);
  seedSheet(ctx, 'PAUSAS_ASISTENCIA', ctx.COLUMNAS.PAUSAS_ASISTENCIA, []);
  seedSheet(ctx, 'PAUSAS_LOG', ctx.COLUMNAS.PAUSAS_LOG);
  return ctx;
}

test('finalizar con evidencia (imagen valida): sube a Drive y guarda evidencia_url', () => {
  const ctx = load();
  const res = ctx.Pausas.gestionarPausaCoordinador({
    pausa_id: 'PA-1', operacion: 'finalizar', evidencia_nombre: 'charla.png', evidencia_base64: PNG_BASE64
  }, ADMIN);
  assert.equal(res.estado, 'Realizada');
  assert.ok(res.evidencia_url);
  assert.ok(res.evidencia_url.indexOf('drive.mock') !== -1);
});

test('finalizar sin evidencia: sigue funcionando igual que antes (evidencia_url vacio)', () => {
  const ctx = load();
  const res = ctx.Pausas.gestionarPausaCoordinador({ pausa_id: 'PA-1', operacion: 'finalizar' }, ADMIN);
  assert.equal(res.estado, 'Realizada');
  assert.ok(!res.evidencia_url);
});

test('finalizar con evidencia que no es una imagen valida: error de validacion, no cierra la pausa', () => {
  const ctx = load();
  const res = ctx.Pausas.gestionarPausaCoordinador({
    pausa_id: 'PA-1', operacion: 'finalizar', evidencia_nombre: 'nota.txt', evidencia_base64: TEXTO_BASE64
  }, ADMIN);
  assert.equal(res._validationError, true);
  const p = ctx.Pausas.listarProgramadas({}, ADMIN)[0];
  assert.equal(p.estado, 'En_curso'); // no se toco
});

test('finalizar con evidencia pero base64 invalido: error de validacion', () => {
  const ctx = load();
  const res = ctx.Pausas.gestionarPausaCoordinador({
    pausa_id: 'PA-1', operacion: 'finalizar', evidencia_nombre: 'charla.png', evidencia_base64: '%%%no-es-base64%%%'
  }, ADMIN);
  assert.equal(res._validationError, true);
});

test('finalizar con evidencia sin SIGSO_DRIVE_ROOT_FOLDER_ID configurado: no bloquea, cierra sin evidencia', () => {
  const ctx = load({ conDriveRoot: false });
  const res = ctx.Pausas.gestionarPausaCoordinador({
    pausa_id: 'PA-1', operacion: 'finalizar', evidencia_nombre: 'charla.png', evidencia_base64: PNG_BASE64
  }, ADMIN);
  assert.equal(res.estado, 'Realizada');
  assert.ok(!res.evidencia_url);
});
