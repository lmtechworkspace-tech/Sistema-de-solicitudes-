'use strict';

// v11 (Reingeniería Cronograma, P3): "Analítica avanzada" (lead time, cycle
// time, tiempo en bloqueo/revisión, SPI conceptual) + "Workload cruzado
// multi-proyecto". Ambas se calculan on-read sobre datos que ya existían
// (fechas de ACTIVIDADES + eventos de ACTIVIDADES_BITACORA) -- sin columnas
// ni hojas nuevas. CPI se evaluó y se descartó a propósito (no hay campo de
// costo/valor en SIGSO, misma razón que la Fase G4b diferida).

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
    ['U1', 'Leo Lider', 'leo@rld.cl', 'RLD', 'DEV', true, '', 'sistema'],
    ['U2', 'Marcelo Integrante', 'marcelo@rld.cl', 'RLD', 'DEV', true, '', 'sistema']
  ]);
  return ctx;
}

const CTX_LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV' };
const CTX_MARCELO = { email: 'marcelo@rld.cl', nombre: 'Marcelo Integrante', rol: 'DEV' };
const CTX_GERENCIA = { email: 'gerencia@rld.cl', nombre: 'Gerencia', rol: 'GERENCIA' };

function armarProyecto(ctx) {
  const proyecto = ctx.Proyectos.crear({
    nombre: 'Migración ERP', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01'
  }, CTX_LEO);
  ctx.Proyectos.gestionarIntegrante({
    proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE'
  }, CTX_LEO);
  return proyecto;
}

// Fecha en el pasado, para poder retroceder fecha_creacion a mano y simular
// una tarea que llevó varios días -- Actividades.crear siempre pone "ahora".
function haceDias_(n) {
  return new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();
}

test('obtenerAnalitica: lead time y cycle time solo se miden en tareas TERMINADAS', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const tarea = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Migrar base de datos', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01'
  }, CTX_LEO);
  // Se creó hace 10 días, se empezó a trabajar hace 6, se terminó ahora.
  ctx.actualizarFilaPorId_('ACTIVIDADES', 'actividad_id', tarea.actividad_id, { fecha_creacion: haceDias_(10) });
  const bitacora = ctx.leerFilas_('ACTIVIDADES_BITACORA').filter((b) => b.actividad_id === tarea.actividad_id);
  // La fila CREADA que registró Actividades.crear -- no cuenta como "trabajo real".
  assert.equal(bitacora.length, 1);
  ctx.actualizarFilaPorId_('ACTIVIDADES_BITACORA', 'bitacora_id', bitacora[0].bitacora_id, { timestamp: haceDias_(10) });

  // Primera señal de trabajo real: hace 6 días.
  const avance = ctx.Actividades.checkin({ actividad_id: tarea.actividad_id, tipo: 'avance', avance_pct: 40 }, CTX_LEO);
  const filaAvance = ctx.leerFilas_('ACTIVIDADES_BITACORA').filter((b) => b.tipo === 'CHECKIN_AVANCE')[0];
  ctx.actualizarFilaPorId_('ACTIVIDADES_BITACORA', 'bitacora_id', filaAvance.bitacora_id, { timestamp: haceDias_(6) });

  // Terminada ahora (fecha_terminada = "ahora" real, sin retroceder).
  ctx.Actividades.checkin({ actividad_id: tarea.actividad_id, tipo: 'listo' }, CTX_LEO);

  const analitica = ctx.Proyectos.obtenerAnalitica({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const fila = analitica.por_tarea.filter((t) => t.actividad_id === tarea.actividad_id)[0];
  // Lead time ~10 días (creación -> terminada); cycle time ~6 días (primer avance -> terminada).
  assert.ok(fila.lead_time_dias >= 9.9 && fila.lead_time_dias <= 10.1, 'lead_time_dias=' + fila.lead_time_dias);
  assert.ok(fila.cycle_time_dias >= 5.9 && fila.cycle_time_dias <= 6.1, 'cycle_time_dias=' + fila.cycle_time_dias);
  assert.ok(fila.cycle_time_dias < fila.lead_time_dias, 'cycle time excluye el tiempo en cola antes de empezar');
});

test('obtenerAnalitica: sin terminar, lead/cycle time son null (no un número inventado)', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const tarea = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'En curso', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01'
  }, CTX_LEO);
  ctx.Actividades.checkin({ actividad_id: tarea.actividad_id, tipo: 'avance', avance_pct: 20 }, CTX_LEO);
  const analitica = ctx.Proyectos.obtenerAnalitica({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const fila = analitica.por_tarea.filter((t) => t.actividad_id === tarea.actividad_id)[0];
  assert.equal(fila.lead_time_dias, null);
  assert.equal(fila.cycle_time_dias, null);
});

test('obtenerAnalitica: tiempo en bloqueo suma cada ciclo bloqueo->desbloqueo; sigue contando si quedó bloqueada', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const tarea = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Con bloqueos', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01'
  }, CTX_LEO);
  ctx.Actividades.checkin({ actividad_id: tarea.actividad_id, tipo: 'bloqueo', bloqueo_motivo: 'Esperando acceso' }, CTX_LEO);
  const bloqueo1 = ctx.leerFilas_('ACTIVIDADES_BITACORA').filter((b) => b.tipo === 'BLOQUEO')[0];
  ctx.actualizarFilaPorId_('ACTIVIDADES_BITACORA', 'bitacora_id', bloqueo1.bitacora_id, { timestamp: haceDias_(5) });

  ctx.Actividades.checkin({ actividad_id: tarea.actividad_id, tipo: 'desbloqueo' }, CTX_LEO);
  const desbloqueo1 = ctx.leerFilas_('ACTIVIDADES_BITACORA').filter((b) => b.tipo === 'DESBLOQUEO')[0];
  ctx.actualizarFilaPorId_('ACTIVIDADES_BITACORA', 'bitacora_id', desbloqueo1.bitacora_id, { timestamp: haceDias_(3) });

  // Se bloquea de nuevo y queda así (sin desbloquear) -- debe contar hasta ahora.
  ctx.Actividades.checkin({ actividad_id: tarea.actividad_id, tipo: 'bloqueo', bloqueo_motivo: 'Otro impedimento' }, CTX_LEO);
  const bloqueos = ctx.leerFilas_('ACTIVIDADES_BITACORA').filter((b) => b.tipo === 'BLOQUEO');
  ctx.actualizarFilaPorId_('ACTIVIDADES_BITACORA', 'bitacora_id', bloqueos[1].bitacora_id, { timestamp: haceDias_(1) });

  const analitica = ctx.Proyectos.obtenerAnalitica({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const fila = analitica.por_tarea.filter((t) => t.actividad_id === tarea.actividad_id)[0];
  // Ciclo 1: día -5 a -3 = 2 días. Ciclo 2: día -1 a ahora (~1 día). Total ~3 días.
  assert.ok(fila.tiempo_bloqueo_dias >= 2.8 && fila.tiempo_bloqueo_dias <= 3.2, 'tiempo_bloqueo_dias=' + fila.tiempo_bloqueo_dias);
});

test('obtenerAnalitica: tiempo en revisión es 0 si la tarea nunca requiere validación', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const tarea = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Sin validación', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01'
  }, CTX_LEO);
  ctx.Actividades.checkin({ actividad_id: tarea.actividad_id, tipo: 'listo' }, CTX_LEO);
  const analitica = ctx.Proyectos.obtenerAnalitica({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const fila = analitica.por_tarea.filter((t) => t.actividad_id === tarea.actividad_id)[0];
  assert.equal(fila.tiempo_revision_dias, 0);
});

test('obtenerAnalitica: tiempo en revisión mide entrega->validación cuando SÍ requiere validación', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const tarea = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Con validación', responsable_email: 'leo@rld.cl',
    fecha_compromiso: '2026-09-01', requiere_validacion: true
  }, CTX_LEO);
  ctx.Actividades.checkin({ actividad_id: tarea.actividad_id, tipo: 'listo' }, CTX_LEO);
  const entrega = ctx.leerFilas_('ACTIVIDADES_BITACORA').filter((b) => b.tipo === 'ENTREGA')[0];
  ctx.actualizarFilaPorId_('ACTIVIDADES_BITACORA', 'bitacora_id', entrega.bitacora_id, { timestamp: haceDias_(2) });

  ctx.Actividades.validar({ actividad_id: tarea.actividad_id, aprobar: true }, CTX_LEO);
  const analitica = ctx.Proyectos.obtenerAnalitica({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const fila = analitica.por_tarea.filter((t) => t.actividad_id === tarea.actividad_id)[0];
  assert.ok(fila.tiempo_revision_dias >= 1.9 && fila.tiempo_revision_dias <= 2.1, 'tiempo_revision_dias=' + fila.tiempo_revision_dias);
});

test('obtenerAnalitica: promedios/sumas del proyecto se calculan solo sobre lo medible', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  // Una tarea terminada (medible) y una en curso (no medible).
  const t1 = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'T1', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);
  ctx.Actividades.checkin({ actividad_id: t1.actividad_id, tipo: 'listo' }, CTX_LEO);
  ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'T2', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);

  const analitica = ctx.Proyectos.obtenerAnalitica({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.ok(analitica.lead_time_promedio_dias !== null, 'hay al menos una tarea terminada con lead time medible');
  assert.equal(typeof analitica.tiempo_bloqueo_total_dias, 'number');
  assert.equal(typeof analitica.tiempo_revision_total_dias, 'number');
});

test('obtenerAnalitica: exige poder VER el proyecto', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const otro = { email: 'otro@rld.cl', nombre: 'Otro', rol: 'DEV' };
  const r = ctx.Proyectos.obtenerAnalitica({ proyecto_id: proyecto.proyecto_id }, otro);
  assert.equal(r._forbidden, true);
});

// --- workload cruzado multi-proyecto ---------------------------------------

test('obtenerWorkloadPortafolio: cruza tareas/bitácora de TODOS los proyectos visibles del usuario', () => {
  const ctx = loadConSchema();
  const proyectoA = armarProyecto(ctx);
  const proyectoB = ctx.Proyectos.crear({ nombre: 'Otro proyecto', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01' }, CTX_LEO);

  const tareaA = ctx.Proyectos.crearTarea({ proyecto_id: proyectoA.proyecto_id, titulo: 'Tarea A', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);
  const tareaB = ctx.Proyectos.crearTarea({ proyecto_id: proyectoB.proyecto_id, titulo: 'Tarea B', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);
  ctx.Actividades.checkin({ actividad_id: tareaA.actividad_id, tipo: 'avance', horas: 3 }, CTX_LEO);
  ctx.Actividades.checkin({ actividad_id: tareaB.actividad_id, tipo: 'avance', horas: 2 }, CTX_LEO);

  const workload = ctx.Proyectos.obtenerWorkloadPortafolio({}, CTX_LEO);
  assert.equal(workload.proyectos.length, 2);
  const titulos = workload.tareas.map((t) => t.titulo).sort();
  assert.deepEqual(titulos, ['Tarea A', 'Tarea B']);
  assert.equal(workload.bitacora.filter((b) => b.horas).length, 2);
  // Cada tarea trae el nombre de SU proyecto (para poder agrupar/mostrar de dónde viene).
  const filaA = workload.tareas.filter((t) => t.actividad_id === tareaA.actividad_id)[0];
  assert.equal(filaA.proyecto_nombre, 'Migración ERP');
});

test('obtenerWorkloadPortafolio: un integrante sin acceso a un proyecto no ve sus tareas ahí', () => {
  const ctx = loadConSchema();
  const proyectoA = armarProyecto(ctx); // marcelo es integrante aquí
  ctx.Proyectos.crear({ nombre: 'Proyecto ajeno de Leo', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01' }, CTX_LEO); // marcelo NO es integrante

  const workload = ctx.Proyectos.obtenerWorkloadPortafolio({}, CTX_MARCELO);
  assert.equal(workload.proyectos.length, 1);
  assert.equal(workload.proyectos[0].proyecto_id, proyectoA.proyecto_id);
});

test('obtenerWorkloadPortafolio: GERENCIA ve todos los proyectos (solo lectura, mismo criterio que el portafolio)', () => {
  const ctx = loadConSchema();
  armarProyecto(ctx);
  ctx.Proyectos.crear({ nombre: 'Segundo proyecto', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01' }, CTX_LEO);
  const workload = ctx.Proyectos.obtenerWorkloadPortafolio({}, CTX_GERENCIA);
  assert.equal(workload.proyectos.length, 2);
});
