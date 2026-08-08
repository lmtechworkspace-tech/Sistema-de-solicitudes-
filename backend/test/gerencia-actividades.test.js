'use strict';

// v7.0 Fase 5 (documentacion/SIGSO-v7.0-propuesta-modulo-gestion-operacional.md
// §4.7/§4.8/§5.3): pestaña de Actividades en el Panel de Gerencia (KPIs,
// mapa de calor, criticas), los 3 motores de reporte, y la Acta de reunión.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

const ADM = { rol: 'ADM', email: 'admin@rld.cl' };

function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'ACTIVIDADES', ctx.COLUMNAS.ACTIVIDADES);
  seedSheet(ctx, 'ACTIVIDADES_BITACORA', ctx.COLUMNAS.ACTIVIDADES_BITACORA);
  seedSheet(ctx, 'JEFATURAS', ctx.COLUMNAS.JEFATURAS);
  seedSheet(ctx, 'CONFIG_FERIADOS', ctx.COLUMNAS.CONFIG_FERIADOS);
  seedSheet(ctx, 'CAT_AREAS', ctx.COLUMNAS.CAT_AREAS, [
    ['AREA-1', 'Contabilidad', '', true],
    ['AREA-2', 'Marketing', '', true]
  ]);
  return ctx;
}

function diasAtras(n) {
  return new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();
}
function diasAdelante(n) {
  return new Date(Date.now() + n * 24 * 3600 * 1000).toISOString();
}

const CTX_MARCELO = { email: 'marcelo@rld.cl', nombre: 'Marcelo Gonzalez', rol: 'DEV' };

function crearActividad(ctx, overrides) {
  const actividad = ctx.Actividades.crear(
    Object.assign({ titulo: 'Actividad', fecha_compromiso: diasAdelante(10), area_id: 'AREA-1', prioridad: 'P3' }, overrides),
    CTX_MARCELO
  );
  return actividad;
}

// --- getPanelGerencia --------------------------------------------------

test('getPanelGerencia: KPIs de HOY (antigüedad, bloqueadas) y de periodo (cumplidas/emergente)', () => {
  const ctx = loadConSchema();
  const terminada = crearActividad(ctx, { titulo: 'Cerrada a tiempo', fecha_compromiso: diasAtras(1) });
  ctx.actualizarFilaPorId_('ACTIVIDADES', 'actividad_id', terminada.actividad_id, {
    estado: 'TERMINADA', fecha_terminada: diasAtras(2)
  });
  const bloqueada = crearActividad(ctx, { titulo: 'Bloqueada', origen: 'EMERGENTE' });
  ctx.actualizarFilaPorId_('ACTIVIDADES', 'actividad_id', bloqueada.actividad_id, {
    estado: 'BLOQUEADA', bloqueo_desde: diasAtras(3)
  });

  const panel = ctx.Actividades.getPanelGerencia({}, ADM);

  assert.equal(panel.kpis.bloqueadas_actual, 1);
  assert.ok(panel.kpis.bloqueo_promedio_dias > 0);
  assert.ok(panel.kpis.antiguedad_media_dias >= 0);
  assert.equal(panel.kpis.pct_cumplidas_a_tiempo, 100);
  assert.ok(panel.kpis.pct_emergente > 0, 'la bloqueada emergente cuenta en % emergente del periodo');
  assert.ok(Array.isArray(panel.kpis.carga_por_persona));
  assert.deepEqual(toPlain(panel.areas.map((a) => a.area_id).sort()), ['AREA-1', 'AREA-2']);
});

test('getPanelGerencia: "criticas" solo P1/P2 con semaforo atrasada/riesgo/bloqueada', () => {
  const ctx = loadConSchema();
  crearActividad(ctx, { titulo: 'P1 atrasada', prioridad: 'P1', fecha_compromiso: diasAtras(2) });
  crearActividad(ctx, { titulo: 'P3 atrasada (no cuenta)', prioridad: 'P3', fecha_compromiso: diasAtras(2) });
  crearActividad(ctx, { titulo: 'P2 al día (no cuenta)', prioridad: 'P2', fecha_compromiso: diasAdelante(30) });

  const panel = ctx.Actividades.getPanelGerencia({}, ADM);

  assert.deepEqual(panel.criticas.map((c) => c.titulo), ['P1 atrasada']);
  assert.equal(panel.criticas[0].semaforo, 'atrasada');
});

test('getPanelGerencia: filtro por área excluye lo que no matchea', () => {
  const ctx = loadConSchema();
  crearActividad(ctx, { titulo: 'De contabilidad', area_id: 'AREA-1' });
  crearActividad(ctx, { titulo: 'De marketing', area_id: 'AREA-2' });

  const panel = ctx.Actividades.getPanelGerencia({ area_id: 'AREA-2' }, ADM);

  assert.equal(panel.kpis.carga_por_persona[0].total, 1);
});

test('getPanelGerencia: heatmap agrupa por área con % de cumplimiento por semana', () => {
  const ctx = loadConSchema();
  const ahoraIso = new Date().toISOString();
  const a = crearActividad(ctx, { titulo: 'Esta semana', area_id: 'AREA-1', fecha_compromiso: ahoraIso });
  ctx.actualizarFilaPorId_('ACTIVIDADES', 'actividad_id', a.actividad_id, { estado: 'TERMINADA', fecha_terminada: ahoraIso });

  const panel = ctx.Actividades.getPanelGerencia({}, ADM);

  const fila = panel.heatmap.find((h) => h.area_nombre === 'Contabilidad');
  assert.ok(fila, 'debe existir la fila de Contabilidad');
  assert.equal(fila.semanas.length, 6);
  const semanaActual = fila.semanas[fila.semanas.length - 1];
  assert.equal(semanaActual.total, 1);
  assert.equal(semanaActual.pct_cumplimiento, 100);
});

// --- generarReporte ------------------------------------------------------

test('generarReporte: tipo invalido devuelve error de validacion', () => {
  const ctx = loadConSchema();
  const resultado = ctx.Actividades.generarReporte({ tipo: 'algo_raro' }, ADM);
  assert.equal(resultado._validationError, true);
});

test('generarReporte "estado_actual": una fila por actividad activa, con semáforo', () => {
  const ctx = loadConSchema();
  crearActividad(ctx, { titulo: 'Uno' });
  crearActividad(ctx, { titulo: 'Dos' });

  const reporte = ctx.Actividades.generarReporte({ tipo: 'estado_actual' }, ADM);

  assert.equal(reporte.filas.length, 2);
  assert.equal(reporte.resumen.total, 2);
  assert.ok(reporte.columnas.some((c) => c.campo === 'semaforo'));
});

test('generarReporte "cumplimiento_periodo": resumen de comprometidas/cumplidas/vencidas', () => {
  const ctx = loadConSchema();
  const aTiempo = crearActividad(ctx, { titulo: 'A tiempo', fecha_compromiso: diasAtras(1) });
  ctx.actualizarFilaPorId_('ACTIVIDADES', 'actividad_id', aTiempo.actividad_id, { estado: 'TERMINADA', fecha_terminada: diasAtras(2) });
  crearActividad(ctx, { titulo: 'Vencida sin cerrar', fecha_compromiso: diasAtras(3) });

  const reporte = ctx.Actividades.generarReporte({ tipo: 'cumplimiento_periodo', desde: diasAtras(30), hasta: new Date().toISOString() }, ADM);

  assert.equal(reporte.resumen.comprometidas, 2);
  assert.equal(reporte.resumen.cumplidas_a_tiempo, 1);
  assert.equal(reporte.resumen.vencidas, 1);
  assert.equal(reporte.resumen.pct_cumplimiento, 100);
});

test('generarReporte "carga_capacidad": agrupa por persona con % emergente', () => {
  const ctx = loadConSchema();
  crearActividad(ctx, { titulo: 'Planificada' });
  crearActividad(ctx, { titulo: 'Emergente', origen: 'EMERGENTE' });

  const reporte = ctx.Actividades.generarReporte({ tipo: 'carga_capacidad', desde: diasAtras(30), hasta: new Date().toISOString() }, ADM);

  assert.equal(reporte.filas.length, 1, 'una sola persona (Marcelo) agrupa ambas');
  assert.equal(reporte.filas[0].total, 2);
  assert.equal(reporte.filas[0].emergentes, 1);
  assert.equal(reporte.filas[0].pct_emergente, 50);
});

// --- generarActaReunion ----------------------------------------------------

test('generarActaReunion: vencidas, bloqueadas y lo que vence la semana entrante', () => {
  const ctx = loadConSchema();
  crearActividad(ctx, { titulo: 'Venció', fecha_compromiso: diasAtras(2) });
  const bloqueada = crearActividad(ctx, { titulo: 'Bloqueada' });
  ctx.actualizarFilaPorId_('ACTIVIDADES', 'actividad_id', bloqueada.actividad_id, {
    estado: 'BLOQUEADA', bloqueo_motivo: 'Esperando aprobación'
  });
  crearActividad(ctx, { titulo: 'Vence pronto (dentro de esta semana, no entra)', fecha_compromiso: diasAdelante(1) });

  const acta = ctx.Actividades.generarActaReunion({}, ADM);

  assert.deepEqual(acta.vencidas.map((a) => a.titulo), ['Venció']);
  assert.equal(acta.bloqueadas.length, 1);
  assert.equal(acta.bloqueadas[0].motivo, 'Esperando aprobación');
});

// --- ReporteActividades (PDF) ----------------------------------------------

test('ReporteActividades.descargarReporte: devuelve un PDF en base64', () => {
  const ctx = loadConSchema();
  crearActividad(ctx, { titulo: 'Para el PDF' });

  const resultado = ctx.ReporteActividades.descargarReporte({ tipo: 'estado_actual' }, ADM);

  assert.ok(resultado.pdf_base64 && resultado.pdf_base64.length > 0);
  assert.ok(resultado.filename.indexOf('estado_actual') !== -1);
});

test('ReporteActividades.descargarReporte: tipo invalido no genera PDF', () => {
  const ctx = loadConSchema();
  const resultado = ctx.ReporteActividades.descargarReporte({ tipo: 'no_existe' }, ADM);
  assert.equal(resultado._validationError, true);
});

test('ReporteActividades.descargarActa: devuelve un PDF en base64', () => {
  const ctx = loadConSchema();
  crearActividad(ctx, { titulo: 'Para el acta', fecha_compromiso: diasAtras(1) });

  const resultado = ctx.ReporteActividades.descargarActa({}, ADM);

  assert.ok(resultado.pdf_base64 && resultado.pdf_base64.length > 0);
  assert.ok(resultado.filename.indexOf('acta-reunion') !== -1);
});
