'use strict';

// v13 (Fase 2, "dashboard ejecutivo"): getDetalle gana dos piezas nuevas,
// ambas on-read y sin columnas/hojas nuevas:
//  - avance_esperado_pct a nivel de PROYECTO (mismo supuesto lineal, ya
//    probado, que Plan/Esperado/Real usa POR TAREA -- aquí aplicado una sola
//    vez sobre fecha_inicio->fecha_objetivo, sin pedir bitácora).
//  - requiere_atencion.items: la lista ACCIONABLE (con a qué pestaña
//    navegar) detrás de los contadores de siempre, que se mantienen
//    intactos para no romper el PDF (bandaKpisPdf_ los sigue leyendo tal
//    cual).

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
    ['U1', 'Leo Lider', 'leo@rld.cl', 'RLD', 'DEV', true, '', 'sistema']
  ]);
  return ctx;
}

const CTX_LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV' };

function diasDesdeHoy(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

// --- avance esperado a nivel de proyecto ------------------------------------

test('getDetalle: avance_esperado_pct usa fecha_inicio->fecha_objetivo del proyecto, lineal', () => {
  const ctx = loadConSchema();
  // Ventana de 20 días, arrancó hace 10 -> ~50% esperado a hoy.
  const proyecto = ctx.Proyectos.crear({
    nombre: 'Migración ERP', fecha_inicio: diasDesdeHoy(-10), fecha_objetivo: diasDesdeHoy(10)
  }, CTX_LEO);

  const detalle = ctx.Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.ok(detalle.avance_esperado_pct > 40 && detalle.avance_esperado_pct < 60, 'a mitad de camino, ~50% esperado');
});

test('getDetalle: con fecha_objetivo igual o anterior a fecha_inicio (plan invertido), avance_esperado_pct es null (nunca inventado)', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Fechas invertidas', fecha_inicio: diasDesdeHoy(5), fecha_objetivo: diasDesdeHoy(5) }, CTX_LEO);
  const detalle = ctx.Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(detalle.avance_esperado_pct, null);
});

// --- requiere_atencion: contadores intactos + items accionables nuevos -----

test('getDetalle: requiere_atencion mantiene los contadores de siempre (compat PDF) y suma items accionables', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Proyecto con problemas', fecha_inicio: diasDesdeHoy(-30), fecha_objetivo: diasDesdeHoy(30) }, CTX_LEO);

  // Tarea P1 vencida (crítica atrasada).
  const critica = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Firmar contrato', responsable_email: 'leo@rld.cl',
    fecha_compromiso: diasDesdeHoy(-3), prioridad: 'P1'
  }, CTX_LEO);
  // Tarea P4 vencida (vencida "normal", no crítica).
  const vencidaNormal = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Actualizar wiki', responsable_email: 'leo@rld.cl',
    fecha_compromiso: diasDesdeHoy(-2), prioridad: 'P4'
  }, CTX_LEO);
  // Tarea bloqueada.
  const bloqueada = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Integrar API externa', responsable_email: 'leo@rld.cl',
    fecha_compromiso: diasDesdeHoy(10)
  }, CTX_LEO);
  ctx.Actividades.checkin({ actividad_id: bloqueada.actividad_id, tipo: 'bloqueo', bloqueo_motivo: 'Esperando credenciales' }, CTX_LEO);
  // Hito vencido.
  const hito = ctx.Proyectos.gestionarHito({ proyecto_id: proyecto.proyecto_id, nombre: 'Kickoff', fecha_objetivo: diasDesdeHoy(-5) }, CTX_LEO);
  // Riesgo alto abierto.
  ctx.Proyectos.gestionarRiesgo({
    proyecto_id: proyecto.proyecto_id, descripcion: 'El proveedor puede fallar', probabilidad: 'ALTA', impacto: 'ALTA'
  }, CTX_LEO);
  // Riesgo bajo abierto -- NO debe aparecer como "alto".
  ctx.Proyectos.gestionarRiesgo({
    proyecto_id: proyecto.proyecto_id, descripcion: 'Riesgo menor', probabilidad: 'BAJA', impacto: 'BAJA'
  }, CTX_LEO);

  const detalle = ctx.Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const at = detalle.requiere_atencion;

  // Contadores de siempre (los que ya consume el PDF) -- deben seguir ahí.
  assert.equal(at.tareas_vencidas, 2, 'critica + vencidaNormal');
  assert.equal(at.tareas_bloqueadas, 1);
  assert.equal(at.hitos_atrasados, 1);

  // Contadores nuevos.
  assert.equal(at.tareas_criticas_atrasadas, 1, 'solo la P1 vencida cuenta como crítica');
  assert.equal(at.riesgos_altos, 1, 'solo el riesgo ALTA cuenta, no el BAJA');

  // Items accionables: cada uno con su pestaña de destino.
  const tipos = toPlain(at.items.map((i) => i.tipo)).sort();
  assert.deepEqual(tipos, ['hito_atrasado', 'riesgo_alto', 'tarea_bloqueada', 'tarea_critica_atrasada', 'tarea_vencida']);

  const itemCritica = at.items.find((i) => i.tipo === 'tarea_critica_atrasada');
  assert.equal(itemCritica.titulo, 'Firmar contrato');
  assert.equal(itemCritica.tab, 'tareas');

  const itemHito = at.items.find((i) => i.tipo === 'hito_atrasado');
  assert.equal(itemHito.titulo, 'Kickoff');
  assert.equal(itemHito.tab, 'hitos');

  const itemRiesgo = at.items.find((i) => i.tipo === 'riesgo_alto');
  assert.equal(itemRiesgo.titulo, 'El proveedor puede fallar');
  assert.equal(itemRiesgo.tab, 'riesgos');

  // La tarea P1 vencida NO debe duplicarse también como "tarea_vencida" simple.
  assert.equal(at.items.filter((i) => i.titulo === 'Firmar contrato').length, 1);
});

test('getDetalle: sin nada pendiente, requiere_atencion.items queda vacío (no ruido)', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Proyecto sano', fecha_inicio: diasDesdeHoy(-5), fecha_objetivo: diasDesdeHoy(30) }, CTX_LEO);
  ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Todo a tiempo', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(15)
  }, CTX_LEO);

  const detalle = ctx.Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.deepEqual(toPlain(detalle.requiere_atencion.items), []);
  assert.equal(detalle.requiere_atencion.items_total, 0);
  assert.equal(detalle.requiere_atencion.tareas_criticas_atrasadas, 0);
  assert.equal(detalle.requiere_atencion.riesgos_altos, 0);
});
