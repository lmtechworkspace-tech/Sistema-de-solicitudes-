'use strict';

/**
 * v6.0 (modulo Pausas Activas, Fase P1): programacion de la pausa del dia +
 * maquina de estados. El trigger crea, cada dia, la pausa de cada empresa
 * cuya config aplique a ese dia de la semana; el ADM puede crearla a mano,
 * reprogramarla o cancelarla. Las transiciones de estado se validan como en
 * Solicitudes (solo saltos declarados).
 *
 * Se usan fechas a mediodia UTC para que el dia de la semana en la zona del
 * proyecto (America/Santiago) sea determinista y los tests no dependan de la
 * zona de la maquina.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

const ADMIN = { rol: 'ADM', email: 'admin@homepymes.cl' };
const DEV = { rol: 'DEV', email: 'dev@homepymes.cl' };

const LUNES = new Date('2026-07-20T12:00:00Z');   // lunes (ISO 1) en Santiago
const DOMINGO = new Date('2026-07-19T12:00:00Z');  // domingo (ISO 7) en Santiago

function loadConPausas(configs) {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'PAUSAS_CONFIG', ctx.COLUMNAS.PAUSAS_CONFIG, configs || []);
  seedSheet(ctx, 'PAUSAS_PROGRAMADAS', ctx.COLUMNAS.PAUSAS_PROGRAMADAS);
  seedSheet(ctx, 'PAUSAS_LOG', ctx.COLUMNAS.PAUSAS_LOG);
  return ctx;
}

// fila de PAUSAS_CONFIG: empresa_id, hora_habitual, dias_semana, duracion_min,
// min_anticipacion, umbral_verde, umbral_amarillo, activo
function configHP(dias, activo) {
  return ['HP', '09:30', dias, 10, 15, 80, 60, activo === undefined ? true : activo];
}

test('programarDelDia crea la pausa del dia para la empresa cuyo dia aplica', () => {
  const ctx = loadConPausas([configHP('1,2,3,4,5')]);
  const res = ctx.Pausas.programarDelDia(LUNES);

  assert.equal(res.total_creadas, 1);
  assert.equal(res.dia_semana, 1);
  const filas = ctx.Pausas.listarProgramadas({}, ADMIN);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].empresa_id, 'HP');
  assert.equal(filas[0].fecha, '2026-07-20');
  assert.equal(filas[0].hora_programada, '09:30');
  assert.equal(filas[0].estado, 'Programada');
  assert.equal(String(filas[0].duracion_min), '10');
});

test('programarDelDia es idempotente: dos corridas el mismo dia no duplican', () => {
  const ctx = loadConPausas([configHP('1,2,3,4,5')]);
  ctx.Pausas.programarDelDia(LUNES);
  const res2 = ctx.Pausas.programarDelDia(LUNES);
  assert.equal(res2.total_creadas, 0);
  assert.equal(ctx.Pausas.listarProgramadas({}, ADMIN).length, 1);
});

test('programarDelDia no crea nada si hoy no esta en dias_semana', () => {
  const ctx = loadConPausas([configHP('1,2,3,4,5')]);
  const res = ctx.Pausas.programarDelDia(DOMINGO); // domingo = 7, no esta
  assert.equal(res.total_creadas, 0);
  assert.equal(ctx.Pausas.listarProgramadas({}, ADMIN).length, 0);
});

test('programarDelDia ignora configuraciones inactivas', () => {
  const ctx = loadConPausas([configHP('1,2,3,4,5', false)]);
  const res = ctx.Pausas.programarDelDia(LUNES);
  assert.equal(res.total_creadas, 0);
});

test('programarDelDiaAdmin exige rol ADM', () => {
  const ctx = loadConPausas([configHP('1,2,3,4,5')]);
  assert.equal(ctx.Pausas.programarDelDiaAdmin({}, DEV)._forbidden, true);
  const ok = ctx.Pausas.programarDelDiaAdmin({}, ADMIN);
  assert.ok(!ok._forbidden);
});

test('listarProgramadas filtra por empresa y estado, y es ADM-only', () => {
  const ctx = loadConPausas([configHP('1,2,3,4,5')]);
  ctx.Pausas.programarDelDia(LUNES);
  assert.equal(ctx.Pausas.listarProgramadas({ empresa_id: 'HP' }, ADMIN).length, 1);
  assert.equal(ctx.Pausas.listarProgramadas({ empresa_id: 'OTRA' }, ADMIN).length, 0);
  assert.equal(ctx.Pausas.listarProgramadas({ estado: 'Programada' }, ADMIN).length, 1);
  assert.equal(ctx.Pausas.listarProgramadas({ estado: 'Cerrada' }, ADMIN).length, 0);
  assert.equal(ctx.Pausas.listarProgramadas({}, DEV)._forbidden, true);
});

test('cancelar pasa la pausa a Cancelada y no se puede cancelar dos veces', () => {
  const ctx = loadConPausas([configHP('1,2,3,4,5')]);
  ctx.Pausas.programarDelDia(LUNES);
  const p = ctx.Pausas.listarProgramadas({}, ADMIN)[0];

  const res = ctx.Pausas.gestionarPausaProgramada({ operacion: 'cancelar', pausa_id: p.pausa_id, motivo: 'feriado interno' }, ADMIN);
  assert.equal(res.estado, 'Cancelada');
  assert.equal(res.observaciones, 'feriado interno');

  // Cancelada es terminal: no admite otra transicion.
  const otra = ctx.Pausas.gestionarPausaProgramada({ operacion: 'cancelar', pausa_id: p.pausa_id }, ADMIN);
  assert.equal(otra._validationError, true);
});

test('reprogramar cambia fecha/hora de una pausa Programada y rechaza fechas mal formadas', () => {
  const ctx = loadConPausas([configHP('1,2,3,4,5')]);
  ctx.Pausas.programarDelDia(LUNES);
  const p = ctx.Pausas.listarProgramadas({}, ADMIN)[0];

  const res = ctx.Pausas.gestionarPausaProgramada({ operacion: 'reprogramar', pausa_id: p.pausa_id, fecha: '2026-07-21', hora_programada: '10:00' }, ADMIN);
  assert.equal(res.fecha, '2026-07-21');
  assert.equal(res.hora_programada, '10:00');

  assert.equal(ctx.Pausas.gestionarPausaProgramada({ operacion: 'reprogramar', pausa_id: p.pausa_id, fecha: '21-07-2026' }, ADMIN)._validationError, true);
});

test('no se puede reprogramar una pausa ya cancelada', () => {
  const ctx = loadConPausas([configHP('1,2,3,4,5')]);
  ctx.Pausas.programarDelDia(LUNES);
  const p = ctx.Pausas.listarProgramadas({}, ADMIN)[0];
  ctx.Pausas.gestionarPausaProgramada({ operacion: 'cancelar', pausa_id: p.pausa_id }, ADMIN);

  const res = ctx.Pausas.gestionarPausaProgramada({ operacion: 'reprogramar', pausa_id: p.pausa_id, hora_programada: '11:00' }, ADMIN);
  assert.equal(res._validationError, true);
});

test('crear_manual agrega una pausa puntual y rechaza duplicado vivo y fecha invalida', () => {
  const ctx = loadConPausas([configHP('1,2,3,4,5')]);
  const res = ctx.Pausas.gestionarPausaProgramada({ operacion: 'crear_manual', empresa_id: 'HP', fecha: '2026-07-22', hora_programada: '9:00', duracion_min: 12 }, ADMIN);
  assert.ok(!res._validationError, JSON.stringify(res));
  assert.equal(res.hora_programada, '09:00');
  assert.equal(res.estado, 'Programada');

  // duplicado vivo mismo dia/empresa
  assert.equal(ctx.Pausas.gestionarPausaProgramada({ operacion: 'crear_manual', empresa_id: 'HP', fecha: '2026-07-22' }, ADMIN)._validationError, true);
  // fecha mal formada
  assert.equal(ctx.Pausas.gestionarPausaProgramada({ operacion: 'crear_manual', empresa_id: 'HP', fecha: 'hoy' }, ADMIN)._validationError, true);
});

test('gestionarPausaProgramada es ADM-only', () => {
  const ctx = loadConPausas([configHP('1,2,3,4,5')]);
  assert.equal(ctx.Pausas.gestionarPausaProgramada({ operacion: 'crear_manual', empresa_id: 'HP', fecha: '2026-07-22' }, DEV)._forbidden, true);
});

test('el trigger programarPausasDiariasTrigger corre sin contexto y crea la del dia', () => {
  const ctx = loadConPausas([configHP('1,2,3,4,5')]);
  // El wrapper del trigger usa new Date() real; aca ejercitamos el nucleo con
  // fecha fija para no depender del dia en que corran los tests.
  const res = ctx.Pausas.programarDelDia(LUNES, null);
  assert.equal(res.total_creadas, 1);
});
