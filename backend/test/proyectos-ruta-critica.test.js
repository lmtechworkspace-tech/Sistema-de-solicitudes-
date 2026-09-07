'use strict';

// v13 (Fase 1, "ruta crítica"): CPM sobre la red de dependencias, calculado
// on-read en Proyectos.listarTareas (mismo lugar y criterio que el impacto de
// retraso). es_critica + holgura_dias por tarea; "disponible" sólo si hay al
// menos una dependencia (si no, resaltar la tarea más larga sería engañoso).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function loadConSchema() {
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

const CTX_LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV' };

function armarProyecto(ctx) {
  return ctx.Proyectos.crear({ nombre: 'Migración ERP', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01' }, CTX_LEO);
}

function diasDesdeHoy(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

function porId(tareas, id) { return tareas.filter((t) => t.actividad_id === id)[0]; }

test('cadena A<-B<-C: la ruta única es crítica de punta a punta (holgura 0)', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const a = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'A', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(10) }, CTX_LEO);
  const b = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'B', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(20), depende_de: a.actividad_id }, CTX_LEO);
  const c = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'C', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(30), depende_de: b.actividad_id }, CTX_LEO);

  const tareas = ctx.Proyectos.listarTareas({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(porId(tareas, a.actividad_id).es_critica, true);
  assert.equal(porId(tareas, b.actividad_id).es_critica, true);
  assert.equal(porId(tareas, c.actividad_id).es_critica, true);
  assert.ok(porId(tareas, a.actividad_id).holgura_dias <= 0.5, 'A tiene holgura ~0');
});

test('rutas paralelas: la más larga es crítica; la corta tiene holgura y NO es crítica', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  // A alimenta a B (rama corta) y a C (rama larga).
  const a = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'A', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(10) }, CTX_LEO);
  const b = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'B corta', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(20), depende_de: a.actividad_id }, CTX_LEO);
  const c = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'C larga', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(40), depende_de: a.actividad_id }, CTX_LEO);

  const tareas = ctx.Proyectos.listarTareas({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(porId(tareas, a.actividad_id).es_critica, true, 'A alimenta la ruta más larga');
  assert.equal(porId(tareas, c.actividad_id).es_critica, true, 'C es la rama larga');
  assert.equal(porId(tareas, b.actividad_id).es_critica, false, 'B corta tiene holgura');
  assert.ok(porId(tareas, b.actividad_id).holgura_dias > 0.5, 'B corta reporta holgura real');
});

test('sin ninguna dependencia: nada es crítico y la holgura es null (no disponible)', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const x = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'X', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(10) }, CTX_LEO);
  const y = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Y', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(20) }, CTX_LEO);

  const tareas = ctx.Proyectos.listarTareas({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(porId(tareas, x.actividad_id).es_critica, false);
  assert.equal(porId(tareas, x.actividad_id).holgura_dias, null);
  assert.equal(porId(tareas, y.actividad_id).es_critica, false);
  assert.equal(porId(tareas, y.actividad_id).holgura_dias, null);
});

// --- auditoría v13: el trabajo terminal no está en juego -------------------

test('AUDITORÍA: una tarea CANCELADA queda fuera de la red -- no es crítica ni arrastra a su predecesora', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const a = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'A', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(5) }, CTX_LEO);
  const b = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'B larga', responsable_email: 'leo@rld.cl',
    fecha_compromiso: diasDesdeHoy(60), depende_de: a.actividad_id
  }, CTX_LEO);
  ctx.Actividades.cancelar({ actividad_id: b.actividad_id, motivo: 'ya no se hace' }, CTX_LEO);

  const tareas = ctx.Proyectos.listarTareas({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(porId(tareas, b.actividad_id).es_critica, false, 'una cancelada nunca define la duración del proyecto');
  assert.equal(porId(tareas, b.actividad_id).holgura_dias, null, 'una cancelada no participa de la red');
  assert.equal(porId(tareas, a.actividad_id).impacto_dependientes, 0, 'atrasar A ya no puede afectar a una cancelada');
});

test('AUDITORÍA: una tarea TERMINADA no se marca crítica ni cuenta como impacto (no puede atrasarse ni ser afectada)', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const a = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'A', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(5) }, CTX_LEO);
  const b = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'B', responsable_email: 'leo@rld.cl',
    fecha_compromiso: diasDesdeHoy(20), depende_de: a.actividad_id
  }, CTX_LEO);
  ctx.Actividades.checkin({ actividad_id: b.actividad_id, tipo: 'listo' }, CTX_LEO);

  const tareas = ctx.Proyectos.listarTareas({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(porId(tareas, b.actividad_id).es_critica, false, 'lo ya terminado no puede atrasar el proyecto');
  assert.equal(porId(tareas, a.actividad_id).impacto_dependientes, 0, 'un dependiente terminado no es "afectable"');
});

test('AUDITORÍA: la cadena viva sigue midiéndose igual aunque haya una cancelada colgando', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const a = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'A', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(10) }, CTX_LEO);
  const b = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'B viva', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(30), depende_de: a.actividad_id }, CTX_LEO);
  const c = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'C cancelada', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(90), depende_de: a.actividad_id }, CTX_LEO);
  ctx.Actividades.cancelar({ actividad_id: c.actividad_id, motivo: 'descartada' }, CTX_LEO);

  const tareas = ctx.Proyectos.listarTareas({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(porId(tareas, a.actividad_id).es_critica, true, 'A sigue alimentando la rama viva');
  assert.equal(porId(tareas, b.actividad_id).es_critica, true, 'la rama viva es ahora la más larga');
  assert.equal(porId(tareas, a.actividad_id).impacto_dependientes, 1, 'solo B cuenta como afectable');
});

test('tarea aislada dentro de un proyecto con dependencias: nunca es crítica (no arrastra a nadie)', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const a = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'A', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(10) }, CTX_LEO);
  ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'B', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(20), depende_de: a.actividad_id }, CTX_LEO);
  // D no participa de ninguna dependencia, aunque sea la más larga del proyecto.
  const d = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'D aislada larga', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(90) }, CTX_LEO);

  const tareas = ctx.Proyectos.listarTareas({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(porId(tareas, d.actividad_id).es_critica, false, 'aislada no forma ruta crítica');
  assert.equal(porId(tareas, d.actividad_id).holgura_dias, null);
});
