'use strict';

// v11 (Reingeniería Cronograma, "PDF ejecutivo configurable"): con
// `data.config`, Proyectos.descargarReporte arma un documento a medida
// (portada, salud ponderada, Gantt/Workload multipágina, desviaciones
// Plan/Esperado/Real, bitácora por rango, leyenda) en vez del reporte
// clásico. El mock de Utilities.newBlob().getAs('application/pdf') no
// convierte de verdad -- conserva el HTML, así que decodificar el base64
// alcanza para verificar contenido y estructura (no la geometría real del
// PDF, que no tiene motor de render en el sandbox).

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
    ['U2', 'Marcelo Integrante', 'marcelo@rld.cl', 'RLD', 'DEV', true, '', 'sistema'],
    ['U3', 'Cami Colab', 'cami@rld.cl', 'RLD', 'DEV', true, '', 'sistema']
  ]);
  return ctx;
}

const CTX_LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV' };
const CTX_MARCELO = { email: 'marcelo@rld.cl', nombre: 'Marcelo Integrante', rol: 'DEV' };

const AYER = (function () {
  const d = new Date(Date.now() - 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
})();

function armarProyectoConTarea(ctx) {
  const proyecto = ctx.Proyectos.crear({
    nombre: 'Migración ERP', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01'
  }, CTX_LEO);
  ctx.Proyectos.gestionarIntegrante({
    proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE'
  }, CTX_LEO);
  const tarea = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Levantar requerimientos',
    responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-09-20'
  }, CTX_LEO);
  ctx.Actividades.confirmar({ actividad_id: tarea.actividad_id, fecha_compromiso: '2026-09-20' }, CTX_MARCELO);
  return { proyecto, tarea };
}

function htmlDe_(res) {
  return Buffer.from(res.pdf_base64, 'base64').toString('utf8');
}

test('descargarReporte SIN config: sigue siendo el reporte clásico (cero cambio de comportamiento)', () => {
  const ctx = loadConSchema();
  const { proyecto } = armarProyectoConTarea(ctx);
  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const html = htmlDe_(res);
  assert.doesNotMatch(html, /Reporte ejecutivo de proyecto/, 'sin config no hay portada');
  assert.doesNotMatch(html, /@page/, 'sin config no hay CSS de página (sigue portrait implícito)');
});

test('descargarReporte con config: solo arma las secciones elegidas, en el orden fijo', () => {
  const ctx = loadConSchema();
  const { proyecto } = armarProyectoConTarea(ctx);
  const res = ctx.Proyectos.descargarReporte({
    proyecto_id: proyecto.proyecto_id,
    config: { secciones: ['portada', 'salud'] }
  }, CTX_LEO);
  const html = htmlDe_(res);
  assert.match(html, /Reporte ejecutivo de proyecto/);
  assert.match(html, /Salud del proyecto/);
  assert.doesNotMatch(html, /Hitos/, 'no se pidió la sección de hitos');
  assert.doesNotMatch(html, /Próximos vencimientos/, 'no se pidió vencimientos');
});

test('descargarReporte config: una config vacía o corrupta cae a ["ficha"] -- nunca un PDF vacío', () => {
  const ctx = loadConSchema();
  const { proyecto } = armarProyectoConTarea(ctx);
  const res = ctx.Proyectos.descargarReporte({
    proyecto_id: proyecto.proyecto_id, config: { secciones: 'no-es-un-array' }
  }, CTX_LEO);
  const html = htmlDe_(res);
  assert.match(html, /Migración ERP/, 'la ficha trae al menos el nombre del proyecto');
});

test('descargarReporte config: salud detallada expone el score y el desglose ponderado', () => {
  const ctx = loadConSchema();
  const { proyecto } = armarProyectoConTarea(ctx);
  const vencida = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Urgente', responsable_email: 'marcelo@rld.cl',
    prioridad: 'P1', fecha_compromiso: '2020-01-01'
  }, CTX_LEO);
  ctx.Actividades.confirmar({ actividad_id: vencida.actividad_id, fecha_compromiso: '2020-01-01' }, CTX_MARCELO);

  const res = ctx.Proyectos.descargarReporte({
    proyecto_id: proyecto.proyecto_id, config: { secciones: ['salud'] }
  }, CTX_LEO);
  const html = htmlDe_(res);
  assert.match(html, /88\/100/, 'score = 100 - 12 (tarea_critica_atrasada)');
  assert.match(html, /Tarea\(s\) crítica\(s\) atrasada\(s\)/);
  assert.match(html, /-12/);
});

test('descargarReporte config: desviaciones trae Plan/Esperado/Real de las tareas activas', () => {
  const ctx = loadConSchema();
  const { proyecto, tarea } = armarProyectoConTarea(ctx);
  ctx.Actividades.checkin({ actividad_id: tarea.actividad_id, tipo: 'avance', avance_pct: 30 }, CTX_MARCELO);
  const res = ctx.Proyectos.descargarReporte({
    proyecto_id: proyecto.proyecto_id, config: { secciones: ['desviaciones'] }
  }, CTX_LEO);
  const html = htmlDe_(res);
  assert.match(html, /Plan · Esperado · Real/);
  assert.match(html, /Levantar requerimientos/);
  assert.match(html, /30%/);
});

test('descargarReporte config: personas filtra qué tareas entran a vencimientos/desviaciones', () => {
  const ctx = loadConSchema();
  const { proyecto } = armarProyectoConTarea(ctx); // responsable: marcelo
  ctx.Proyectos.gestionarIntegrante({ proyecto_id: proyecto.proyecto_id, usuario_email: 'cami@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  const tareaCami = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Tarea de Cami', responsable_email: 'cami@rld.cl', fecha_compromiso: '2026-09-25'
  }, CTX_LEO);
  ctx.Actividades.confirmar({ actividad_id: tareaCami.actividad_id, fecha_compromiso: '2026-09-25' }, { email: 'cami@rld.cl', nombre: 'Cami Colab', rol: 'DEV' });

  const soloMarcelo = ctx.Proyectos.descargarReporte({
    proyecto_id: proyecto.proyecto_id, config: { secciones: ['vencimientos'], personas: ['marcelo@rld.cl'] }
  }, CTX_LEO);
  const html = htmlDe_(soloMarcelo);
  assert.match(html, /Levantar requerimientos/);
  assert.doesNotMatch(html, /Tarea de Cami/);
});

test('descargarReporte config: Gantt/Workload agregan @page landscape; sin ellos, no', () => {
  const ctx = loadConSchema();
  const { proyecto, tarea } = armarProyectoConTarea(ctx);
  // AYER es anterior a fecha_creacion (la tarea se creó "hoy" en este test) --
  // sin un rango explícito, el Gantt auto-calculado no lo cubriría. Un rango
  // explícito que sí lo incluya prueba lo mismo sin depender de eso.
  ctx.Proyectos.guardarRegistroDia({
    proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id,
    dia: AYER, estado_dia: 'finalizado', horas: 5
  }, CTX_MARCELO);

  const conGantt = ctx.Proyectos.descargarReporte({
    proyecto_id: proyecto.proyecto_id,
    config: { secciones: ['gantt', 'workload'], rango: { desde: AYER, hasta: AYER } }
  }, CTX_LEO);
  const htmlGantt = htmlDe_(conGantt);
  assert.match(htmlGantt, /@page/);
  assert.match(htmlGantt, /landscape/);
  assert.match(htmlGantt, /Carta Gantt/);
  assert.match(htmlGantt, /Carga de trabajo/);
  // El registro del día (P0) manda: la celda debe traer la marca de
  // "finalizado" (✓), no una derivada de check-in.
  assert.match(htmlGantt, /✓/);

  const sinGantt = ctx.Proyectos.descargarReporte({
    proyecto_id: proyecto.proyecto_id, config: { secciones: ['ficha'] }
  }, CTX_LEO);
  assert.doesNotMatch(htmlDe_(sinGantt), /@page/);
});

test('descargarReporte config: un rango explícito acota el Gantt a esos días', () => {
  const ctx = loadConSchema();
  const { proyecto, tarea } = armarProyectoConTarea(ctx);
  ctx.Proyectos.guardarRegistroDia({
    proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id,
    dia: AYER, estado_dia: 'en_proceso', horas: 3
  }, CTX_MARCELO);
  const res = ctx.Proyectos.descargarReporte({
    proyecto_id: proyecto.proyecto_id,
    config: { secciones: ['gantt'], rango: { desde: AYER, hasta: AYER } }
  }, CTX_LEO);
  const html = htmlDe_(res);
  // Un solo día de columna -> el encabezado del Gantt trae la fecha de AYER
  // en formato corto DD/MM (v12: columnas angostas), y NO la de hoy (fuera
  // del rango).
  const cortaDe = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
  const hoyIso = new Date().toISOString().slice(0, 10);
  assert.match(html, new RegExp(cortaDe(AYER).replace('/', '\\/')));
  if (cortaDe(hoyIso) !== cortaDe(AYER)) {
    assert.doesNotMatch(html, new RegExp(cortaDe(hoyIso).replace('/', '\\/')), 'hoy queda fuera del rango de un solo día');
  }
});

test('descargarReporte config: la sección KPIs trae la banda de indicadores ejecutivos', () => {
  const ctx = loadConSchema();
  const { proyecto } = armarProyectoConTarea(ctx);
  const res = ctx.Proyectos.descargarReporte({
    proyecto_id: proyecto.proyecto_id, config: { secciones: ['kpis'] }
  }, CTX_LEO);
  const html = htmlDe_(res);
  assert.match(html, /Indicadores clave/);
  assert.match(html, /Avance/);
  assert.match(html, /Entregas a tiempo/);
  assert.match(html, /Hitos atrasados/);
});

test('descargarReporte config: el Gantt dibuja barras (fondo de color en el período planificado), no solo letras', () => {
  const ctx = loadConSchema();
  const { proyecto, tarea } = armarProyectoConTarea(ctx);
  // Rango que cubre desde antes de la creación hasta la fecha comprometida:
  // la barra planificada (creación -> compromiso) debe pintar celdas con
  // color de fondo aunque no haya ninguna marca registrada.
  const hoy = new Date().toISOString().slice(0, 10);
  const res = ctx.Proyectos.descargarReporte({
    proyecto_id: proyecto.proyecto_id,
    config: { secciones: ['gantt'], rango: { desde: hoy, hasta: '2026-09-20' } }
  }, CTX_LEO);
  const html = htmlDe_(res);
  assert.match(html, /Carta Gantt/);
  // v12.1: alguna celda del Gantt trae un background SÓLIDO SATURADO de barra
  // (semáforo) -- el motor HTML->PDF rinde los tintes pálidos casi blancos, así
  // que las barras usan color saturado (verde/ámbar/rojo/azul/gris/violeta).
  assert.match(html, /background-color:#(16A34A|D97706|DC2626|2563EB|64748B|94A3B8|7C3AED)/);
  // Y una leyenda de colores para decodificar el semáforo.
  assert.match(html, /Al día \/ entregado/);
});

test('descargarReporte config: la bitácora, con Gantt activo, se acota al mismo rango (no "últimas 30")', () => {
  const ctx = loadConSchema();
  const { proyecto, tarea } = armarProyectoConTarea(ctx);
  ctx.Proyectos.guardarRegistroDia({
    proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id,
    dia: AYER, estado_dia: 'en_proceso', horas: 2, nota: 'Nota dentro del rango'
  }, CTX_MARCELO);
  const res = ctx.Proyectos.descargarReporte({
    proyecto_id: proyecto.proyecto_id,
    config: { secciones: ['gantt', 'bitacora'], rango: { desde: AYER, hasta: AYER } }
  }, CTX_LEO);
  const html = htmlDe_(res);
  assert.match(html, /Nota dentro del rango/);
});
