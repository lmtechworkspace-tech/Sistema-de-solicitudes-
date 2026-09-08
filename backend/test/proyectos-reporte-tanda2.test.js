'use strict';

/**
 * Auditoría del reporte descargable, tanda 2:
 *  - C1: la Carta Gantt marca la ruta crítica (el dato es_critica ya existía
 *        pero el PDF no lo usaba -- todas las barras se veían igual).
 *  - D1: la Carga de trabajo se agrega POR SEMANA en proyectos largos (por día
 *        eran decenas de columnas casi vacías) y suma una columna de total por
 *        persona.
 *
 * Se verifica sobre el HTML real que arma `descargarReporte` (el mismo que el
 * motor de Apps Script convierte a PDF), no sobre un mock.
 */

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

function htmlDe_(res) { return Buffer.from(res.pdf_base64, 'base64').toString('utf8'); }
function diasDesdeHoy(n) {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
  const p = hoy.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2]) + n * 86400000).toISOString().slice(0, 10);
}

// --- C1: ruta crítica en la Carta Gantt -------------------------------------

test('C1: con una cadena de dependencias, la Carta Gantt marca la ruta crítica (▲, leyenda y nota)', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Migración ERP', fecha_inicio: diasDesdeHoy(-5), fecha_objetivo: '2026-12-31' }, CTX_LEO);
  const a = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Definir CRM', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(10) }, CTX_LEO);
  const b = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Arranque op.', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(20), depende_de: a.actividad_id }, CTX_LEO);
  ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Cierre', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(30), depende_de: b.actividad_id }, CTX_LEO);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['gantt'] } }, CTX_LEO);
  const html = htmlDe_(res);

  assert.match(html, /&#9650;/, 'la tarea crítica debe llevar un ▲ antes del título');
  assert.match(html, /Ruta cr.tica/, 'la leyenda debe explicar la marca de ruta crítica');
  assert.match(html, /en la ruta cr.tica/, 'una nota debe decir cuántas tareas forman la ruta crítica');
  // El contorno navy (border-top de color) es lo que distingue la barra crítica
  // -- el motor no pinta rellenos, sólo bordes.
  assert.match(html, /border-top:2px solid #14213D/, 'la barra crítica debe llevar contorno navy');
});

test('C1: un proyecto SIN dependencias no inventa ruta crítica (ni ▲ ni nota)', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Sueltas', fecha_inicio: diasDesdeHoy(-5), fecha_objetivo: '2026-12-31' }, CTX_LEO);
  ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Suelta 1', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(10) }, CTX_LEO);
  ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Suelta 2', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(15) }, CTX_LEO);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['gantt'] } }, CTX_LEO);
  const html = htmlDe_(res);

  assert.doesNotMatch(html, /Ruta cr.tica/, 'sin dependencias no hay ruta crítica que mostrar');
  assert.doesNotMatch(html, /en la ruta cr.tica/, 'sin ruta crítica no hay nota');
});

// --- D1: Carga de trabajo por semana en proyectos largos --------------------

function armarProyectoLargoConHoras(ctx) {
  // 40 días de ventana (> 21) -> agregación por semana.
  const proyecto = ctx.Proyectos.crear({ nombre: 'Largo', fecha_inicio: diasDesdeHoy(-40), fecha_objetivo: '2026-12-31' }, CTX_LEO);
  ctx.Proyectos.gestionarIntegrante({ proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  const t = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Con horas', responsable_email: 'marcelo@rld.cl', fecha_compromiso: diasDesdeHoy(3) }, CTX_LEO);
  ctx.Actividades.confirmar({ actividad_id: t.actividad_id, fecha_compromiso: diasDesdeHoy(3) }, CTX_MARCELO);
  // Horas en dos días distintos de la misma semana, para que el total semanal
  // sume > jornada semanal y dispare la marca de sobrecarga (2 x 30 = 60 > 45).
  ctx.Proyectos.guardarRegistroDia({ proyecto_id: proyecto.proyecto_id, actividad_id: t.actividad_id, dia: diasDesdeHoy(0), estado_dia: 'en_proceso', horas: 24 }, CTX_MARCELO);
  ctx.Proyectos.guardarRegistroDia({ proyecto_id: proyecto.proyecto_id, actividad_id: t.actividad_id, dia: diasDesdeHoy(-1), estado_dia: 'en_proceso', horas: 24 }, CTX_MARCELO);
  return proyecto;
}

test('D1: en un proyecto largo la Carga de trabajo se agrupa por semana, con columna de total', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyectoLargoConHoras(ctx);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['workload'] } }, CTX_LEO);
  const html = htmlDe_(res);

  assert.match(html, /horas por semana y persona/, 'ventana larga -> título por semana');
  assert.doesNotMatch(html, /horas por d.a y persona/, 'no debe usar el título por día');
  assert.match(html, />sem /, 'las columnas deben rotularse como semanas');
  assert.match(html, />Total</, 'debe existir la columna de total por persona');
  assert.match(html, /jornada semanal de referencia/, 'la nota debe explicar la sobrecarga semanal');
});

test('D1: en un proyecto corto la Carga de trabajo sigue siendo por día (no cambia lo que ya andaba)', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Corto', fecha_inicio: diasDesdeHoy(-2), fecha_objetivo: '2026-12-31' }, CTX_LEO);
  ctx.Proyectos.gestionarIntegrante({ proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  const t = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Con horas', responsable_email: 'marcelo@rld.cl', fecha_compromiso: diasDesdeHoy(2) }, CTX_LEO);
  ctx.Actividades.confirmar({ actividad_id: t.actividad_id, fecha_compromiso: diasDesdeHoy(2) }, CTX_MARCELO);
  ctx.Proyectos.guardarRegistroDia({ proyecto_id: proyecto.proyecto_id, actividad_id: t.actividad_id, dia: diasDesdeHoy(0), estado_dia: 'en_proceso', horas: 6 }, CTX_MARCELO);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['workload'] } }, CTX_LEO);
  const html = htmlDe_(res);

  assert.match(html, /horas por d.a y persona/, 'ventana corta -> título por día');
  assert.doesNotMatch(html, /horas por semana y persona/, 'no debe agrupar por semana');
  assert.match(html, />Total</, 'la columna de total por persona también aplica por día');
});
