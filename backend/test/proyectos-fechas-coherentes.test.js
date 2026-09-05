'use strict';

// P-03 de la auditoría: un proyecto no puede terminar antes de empezar.
//
// Medido antes del arreglo: crear un proyecto con fecha_inicio 01-12-2026 y
// fecha_objetivo 01-01-2026 se guardaba sin una sola objeción. Nada lo
// impedía, el Gantt tenía que dibujar una barra de duración negativa y el
// portafolio anunciaba "vence en -334 días", que no le dice nada a nadie.
//
// El caso que de verdad importa es el de `actualizar`: ahí se puede mover UNA
// sola de las dos fechas, así que hay que validar la combinación RESULTANTE
// (el campo que llega contra el que ya tiene el proyecto), no el campo suelto.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function ctxConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'fake-drive-root' } });
  ['PROYECTOS', 'PROYECTO_INTEGRANTES', 'PROYECTO_HITOS', 'PROYECTO_EVENTOS',
    'PROYECTO_ENTREGABLES', 'PROYECTO_RIESGOS', 'PROYECTO_PLANTILLAS',
    'PROYECTO_PLANTILLA_HITOS', 'SOLICITUDES', 'ACTIVIDADES', 'ACTIVIDADES_BITACORA',
    'JEFATURAS', 'LOG_NOTIFICACIONES', 'CONFIG_FERIADOS', 'NOTIFICACIONES_APP', 'CAT_AREAS']
    .forEach((h) => seedSheet(ctx, h, ctx.COLUMNAS[h]));
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Leo Lider', 'leo@rld.cl', 'RLD', 'DEV', true, '', 'sistema']
  ]);
  return ctx;
}

const LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV' };

test('crear rechaza un proyecto que termina antes de empezar', () => {
  const ctx = ctxConSchema();
  const r = ctx.Proyectos.crear({
    nombre: 'Al revés', fecha_inicio: '2026-12-01', fecha_objetivo: '2026-01-01'
  }, LEO);
  assert.ok(r._validationError, 'debería rechazarse');
  assert.equal(r.fields[0].campo, 'fecha_objetivo');
});

test('crear acepta fechas coherentes, y también un proyecto de un solo día', () => {
  const ctx = ctxConSchema();
  const normal = ctx.Proyectos.crear({
    nombre: 'Normal', fecha_inicio: '2026-01-01', fecha_objetivo: '2026-12-01'
  }, LEO);
  assert.ok(normal.proyecto_id, 'un rango normal debe aceptarse');

  // Empezar y terminar el mismo día es legítimo, no un error de tipeo.
  const unDia = ctx.Proyectos.crear({
    nombre: 'De un día', fecha_inicio: '2026-03-10', fecha_objetivo: '2026-03-10'
  }, LEO);
  assert.ok(unDia.proyecto_id, 'inicio == objetivo debe aceptarse');
});

test('actualizar valida la combinación resultante, no el campo que llega', () => {
  const ctx = ctxConSchema();
  const p = ctx.Proyectos.crear({
    nombre: 'Migración', fecha_inicio: '2026-06-01', fecha_objetivo: '2026-09-01'
  }, LEO);

  // Mover SOLO el objetivo, a antes del inicio que ya tenía guardado.
  const soloObjetivo = ctx.Proyectos.actualizar({
    proyecto_id: p.proyecto_id, fecha_objetivo: '2026-02-01'
  }, LEO);
  assert.ok(soloObjetivo._validationError,
    'mover solo el objetivo por detrás del inicio guardado debe rechazarse');

  // Mover SOLO el inicio, a después del objetivo que ya tenía guardado.
  const soloInicio = ctx.Proyectos.actualizar({
    proyecto_id: p.proyecto_id, fecha_inicio: '2026-11-01'
  }, LEO);
  assert.ok(soloInicio._validationError,
    'mover solo el inicio por delante del objetivo guardado debe rechazarse');

  // Mover LAS DOS de forma coherente sí se acepta.
  const ambas = ctx.Proyectos.actualizar({
    proyecto_id: p.proyecto_id, fecha_inicio: '2027-01-01', fecha_objetivo: '2027-06-01'
  }, LEO);
  assert.ok(!ambas._validationError, 'mover ambas de forma coherente debe aceptarse');

  // Y no quedó a medias por los rechazos anteriores.
  const fila = ctx.leerFilas_(ctx.SHEETS.PROYECTOS).filter((x) => x.proyecto_id === p.proyecto_id)[0];
  assert.equal(String(fila.fecha_inicio).slice(0, 10), '2027-01-01');
  assert.equal(String(fila.fecha_objetivo).slice(0, 10), '2027-06-01');
});

test('una actualización que no toca fechas sigue funcionando', () => {
  const ctx = ctxConSchema();
  const p = ctx.Proyectos.crear({
    nombre: 'Sin tocar fechas', fecha_inicio: '2026-06-01', fecha_objetivo: '2026-09-01'
  }, LEO);
  const r = ctx.Proyectos.actualizar({ proyecto_id: p.proyecto_id, descripcion: 'nueva' }, LEO);
  assert.ok(!r._validationError, 'no debe exigir fechas para editar otro campo');
});
