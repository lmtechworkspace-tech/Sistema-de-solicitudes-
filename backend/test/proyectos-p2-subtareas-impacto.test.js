'use strict';

// v11 (Reingeniería Cronograma, P2): "Subtareas con rollup de avance" +
// "Dependencias con impacto de retraso". Ambas son puramente informativas
// (§I: nada mueve fechas ni cierra cosas solo) y se calculan on-read en
// Proyectos.listarTareas -- sin columnas nuevas para el impacto (reusa
// depende_de) y con una sola columna aditiva (tarea_padre_id, sin hoja
// nueva) para las subtareas.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'fake-drive-root' } });
  ['PROYECTOS', 'PROYECTO_INTEGRANTES', 'PROYECTO_HITOS', 'PROYECTO_EVENTOS',
    'PROYECTO_ENTREGABLES', 'PROYECTO_RIESGOS', 'PROYECTO_PLANTILLAS',
    'PROYECTO_PLANTILLA_HITOS', 'SOLICITUDES', 'ACTIVIDADES', 'ACTIVIDADES_BITACORA',
    'JEFATURAS', 'LOG_NOTIFICACIONES', 'CONFIG_FERIADOS', 'NOTIFICACIONES_APP', 'CAT_AREAS']
    .forEach((h) => seedSheet(ctx, h, ctx.COLUMNAS[h]));
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Leo Lider', 'leo@rld.cl', 'RLD', 'DEV', true, '', 'sistema'],
    ['U2', 'Marcelo Integrante', 'marcelo@rld.cl', 'RLD', 'DEV', true, '', 'sistema']
  ]);
  return ctx;
}

const CTX_LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV' };
const CTX_MARCELO = { email: 'marcelo@rld.cl', nombre: 'Marcelo Integrante', rol: 'DEV' };

function armarProyecto(ctx) {
  const proyecto = ctx.Proyectos.crear({
    nombre: 'Migración ERP', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01'
  }, CTX_LEO);
  ctx.Proyectos.gestionarIntegrante({
    proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE'
  }, CTX_LEO);
  return proyecto;
}

// --- subtareas con rollup --------------------------------------------------

test('crearTarea con tarea_padre_id: exige mismo proyecto y prohíbe un tercer nivel', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const otroProyecto = ctx.Proyectos.crear({ nombre: 'Otro', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01' }, CTX_LEO);

  const padre = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Padre', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);

  const deOtroProyecto = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Hija', responsable_email: 'leo@rld.cl',
    fecha_compromiso: '2026-09-01', tarea_padre_id: 'no-existe'
  }, CTX_LEO);
  assert.equal(deOtroProyecto._validationError, true);

  const hija = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Hija', responsable_email: 'leo@rld.cl',
    fecha_compromiso: '2026-09-01', tarea_padre_id: padre.actividad_id
  }, CTX_LEO);
  assert.ok(hija.actividad_id);

  const nieta = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Nieta', responsable_email: 'leo@rld.cl',
    fecha_compromiso: '2026-09-01', tarea_padre_id: hija.actividad_id
  }, CTX_LEO);
  assert.equal(nieta._validationError, true, 'la hija ya es subtarea -- no puede a su vez ser padre');
});

test('listarTareas: rollup de avance se calcula on-read a partir de las hijas', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const padre = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Padre', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);
  const h1 = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Hija 1', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01', tarea_padre_id: padre.actividad_id }, CTX_LEO);
  const h2 = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Hija 2', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01', tarea_padre_id: padre.actividad_id }, CTX_LEO);

  // Hija 1 terminada (100%), Hija 2 sin tocar (NO_INICIADA=0%) -> rollup 50%.
  ctx.Actividades.checkin({ actividad_id: h1.actividad_id, tipo: 'listo' }, CTX_LEO);

  const tareas = ctx.Proyectos.listarTareas({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const filaPadre = tareas.filter((t) => t.actividad_id === padre.actividad_id)[0];
  assert.equal(filaPadre.subtareas_total, 2);
  assert.equal(filaPadre.subtareas_terminadas, 1);
  assert.equal(filaPadre.avance_rollup_pct, 50);
  assert.equal(filaPadre.es_subtarea, false);

  const filaHija = tareas.filter((t) => t.actividad_id === h2.actividad_id)[0];
  assert.equal(filaHija.es_subtarea, true);
  assert.equal(filaHija.padre_titulo, 'Padre');
  assert.equal(filaHija.subtareas_total, undefined, 'una hija sin hijas propias no tiene rollup');
});

test('listarTareas: sin hijas, una tarea se comporta exactamente igual que antes (cero regresión)', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const suelta = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Suelta', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);
  const tareas = ctx.Proyectos.listarTareas({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const fila = tareas.filter((t) => t.actividad_id === suelta.actividad_id)[0];
  assert.equal(fila.subtareas_total, undefined);
  assert.equal(fila.es_subtarea, false);
  assert.equal(fila.padre_titulo, undefined);
});

// --- dependencias con impacto ---------------------------------------------

test('listarTareas: impacto_dependientes cuenta transitivamente (A<-B<-C) y trae hasta 3 títulos', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const a = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'A: cimientos', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);
  const b = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'B: estructura', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-05', depende_de: a.actividad_id }, CTX_LEO);
  const c = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'C: techo', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-10', depende_de: b.actividad_id }, CTX_LEO);

  const tareas = ctx.Proyectos.listarTareas({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const filaA = tareas.filter((t) => t.actividad_id === a.actividad_id)[0];
  assert.equal(filaA.impacto_dependientes, 2, 'A afecta transitivamente a B y C');
  assert.deepEqual(toPlain(filaA.impacto_titulos).sort(), ['B: estructura', 'C: techo']);

  const filaB = tareas.filter((t) => t.actividad_id === b.actividad_id)[0];
  assert.equal(filaB.impacto_dependientes, 1, 'B solo afecta a C');

  const filaC = tareas.filter((t) => t.actividad_id === c.actividad_id)[0];
  assert.equal(filaC.impacto_dependientes, 0, 'nada depende de C todavía');
});

test('listarTareas: sin nadie dependiendo, impacto_dependientes es 0 (no undefined) -- siempre presente', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const suelta = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Suelta', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);
  const tareas = ctx.Proyectos.listarTareas({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const fila = tareas.filter((t) => t.actividad_id === suelta.actividad_id)[0];
  assert.equal(fila.impacto_dependientes, 0);
  assert.deepEqual(toPlain(fila.impacto_titulos), []);
});
