'use strict';

// v14 ("reporte legible"): cuatro mejoras al PDF de proyectos, todas pedidas
// tras mirar un reporte real:
//   1. La Carta Gantt ya no arrastra columnas/páginas vacías: sin rango, la
//      ventana va de la asignación más antigua a hoy (+margen), y un
//      compromiso lejano y aislado no estira el gráfico (se marca "vence →").
//   2. TODA tabla de contenido trae fila de encabezado (<th> navy).
//   3. "Actividad reciente" se reestructura: columnas con título, chip de
//      color que clasifica el tipo, y horas en su propia columna.
//   4. La Carga de trabajo sin horas registradas se resume en una línea en
//      vez de imprimir una grilla en blanco.
//
// Igual que proyectos-pdf-configurable: el mock de getAs('application/pdf')
// conserva el HTML, así que decodificar el base64 alcanza para verificar
// estructura y contenido (no la geometría real del PDF).

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
function diasDesdeHoy(n) { return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10); }
function cortaDe(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }

function armarProyecto(ctx) {
  const proyecto = ctx.Proyectos.crear({ nombre: 'Seguimiento', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-31' }, CTX_LEO);
  ctx.Proyectos.gestionarIntegrante({ proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  return proyecto;
}

// --- 1. El rango del Gantt no lo arrastra un compromiso lejano y aislado ----

test('la ventana del Gantt llega hasta ~hoy y NO hasta un compromiso a meses de distancia', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  // La mayoría vence pronto; una sola tarea vence en ~100 días (el outlier que
  // antes estiraba el gráfico con decenas de columnas en blanco). Se confirman
  // para que la fecha comprometida sea firme (RN-710: asignar a otro la deja
  // como propuesta hasta que el responsable la confirma).
  const cercana = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Cercana', responsable_email: 'marcelo@rld.cl', fecha_compromiso: diasDesdeHoy(3) }, CTX_LEO);
  ctx.Actividades.confirmar({ actividad_id: cercana.actividad_id, fecha_compromiso: diasDesdeHoy(3) }, CTX_MARCELO);
  const lejana = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Lejana', responsable_email: 'marcelo@rld.cl', fecha_compromiso: diasDesdeHoy(100) }, CTX_LEO);
  ctx.Actividades.confirmar({ actividad_id: lejana.actividad_id, fecha_compromiso: diasDesdeHoy(100) }, CTX_MARCELO);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['gantt'] } }, CTX_LEO);
  const html = htmlDe_(res);

  // El día del compromiso lejano (100 días) NO puede aparecer como columna.
  assert.doesNotMatch(html, new RegExp('>' + cortaDe(diasDesdeHoy(100)).replace('/', '\\/') + '<'),
    'un compromiso a 100 días no debe estirar el Gantt con columnas vacías');
  // Pero el compromiso cercano (3 días) sí entra en la ventana.
  assert.match(html, new RegExp(cortaDe(diasDesdeHoy(3)).replace('/', '\\/')),
    'lo que vence pronto sí está en el gráfico');
  // Y la tarea lejana no se pierde: se marca "vence dd-mm →" en su etiqueta.
  assert.match(html, /vence [0-3][0-9]-[0-1][0-9]-\d{4} &#8594;/,
    'el compromiso fuera de rango se marca con flecha, no se descarta');
  assert.ok(lejana.actividad_id);
});

test('un proyecto planificado A FUTURO sí muestra su plan (la ventana no se corta en hoy)', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  // Todo arranca hoy y vence de forma continua en las próximas 2-3 semanas:
  // no hay "hueco muerto", así que la ventana debe llegar hasta esos días.
  const e1 = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Etapa 1', responsable_email: 'marcelo@rld.cl', fecha_compromiso: diasDesdeHoy(6) }, CTX_LEO);
  ctx.Actividades.confirmar({ actividad_id: e1.actividad_id, fecha_compromiso: diasDesdeHoy(6) }, CTX_MARCELO);
  const e2 = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Etapa 2', responsable_email: 'marcelo@rld.cl', fecha_compromiso: diasDesdeHoy(13) }, CTX_LEO);
  ctx.Actividades.confirmar({ actividad_id: e2.actividad_id, fecha_compromiso: diasDesdeHoy(13) }, CTX_MARCELO);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['gantt'] } }, CTX_LEO);
  const html = htmlDe_(res);
  assert.match(html, new RegExp(cortaDe(diasDesdeHoy(13)).replace('/', '\\/')),
    'un plan continuo a futuro se muestra completo, no se corta en hoy');
});

// --- 2. Encabezados en todas las tablas -------------------------------------

test('todas las tablas de contenido traen fila de encabezado', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const t = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Tarea A', responsable_email: 'marcelo@rld.cl', fecha_compromiso: diasDesdeHoy(2) }, CTX_LEO);
  ctx.Actividades.confirmar({ actividad_id: t.actividad_id, fecha_compromiso: diasDesdeHoy(2) }, CTX_MARCELO);
  ctx.Proyectos.gestionarHito({ proyecto_id: proyecto.proyecto_id, nombre: 'Kickoff', fecha_objetivo: diasDesdeHoy(5) }, CTX_LEO);
  ctx.Proyectos.gestionarRiesgo({ proyecto_id: proyecto.proyecto_id, descripcion: 'Proveedor lento', nivel: 'ALTO' }, CTX_LEO);

  const res = ctx.Proyectos.descargarReporte({
    proyecto_id: proyecto.proyecto_id,
    config: { secciones: ['hitos', 'riesgos', 'vencimientos'] }
  }, CTX_LEO);
  const html = htmlDe_(res);
  // Los <th> navy se emiten con el fondo de DOC.NAVY (#14213D) y el texto.
  ['Fecha objetivo', 'Responsable', 'Compromiso', 'Nivel'].forEach(function (titulo) {
    assert.match(html, new RegExp(titulo), 'falta el encabezado: ' + titulo);
  });
  // El encabezado usa el navy del documento.
  assert.match(html, /background:#14213D;color:#ffffff;font-size:9px;font-weight:bold;text-transform:uppercase/);
});

test('el nivel del riesgo y el estado del vencimiento salen como chip de color (clasificación)', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const t = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Atrasada', responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2020-01-01' }, CTX_LEO);
  ctx.Actividades.confirmar({ actividad_id: t.actividad_id, fecha_compromiso: '2020-01-01' }, CTX_MARCELO);
  ctx.Proyectos.gestionarRiesgo({ proyecto_id: proyecto.proyecto_id, descripcion: 'Riesgo alto', nivel: 'ALTO' }, CTX_LEO);

  const res = ctx.Proyectos.descargarReporte({
    proyecto_id: proyecto.proyecto_id, config: { secciones: ['riesgos', 'vencimientos'] }
  }, CTX_LEO);
  const html = htmlDe_(res);
  // Chip rojo saturado para "ALTO" y para el semáforo "Atrasada".
  assert.match(html, /background-color:#DC2626;color:#ffffff;font-weight:bold;font-size:8px/);
  assert.match(html, /Atrasada/);
});

// --- 3. Actividad reciente reestructurada -----------------------------------

test('la Actividad reciente trae columnas con título, chip de tipo y horas aparte', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const t = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Con bitácora', responsable_email: 'marcelo@rld.cl', fecha_compromiso: diasDesdeHoy(4) }, CTX_LEO);
  ctx.Actividades.confirmar({ actividad_id: t.actividad_id, fecha_compromiso: diasDesdeHoy(4) }, CTX_MARCELO);
  ctx.Proyectos.guardarRegistroDia({
    proyecto_id: proyecto.proyecto_id, actividad_id: t.actividad_id,
    dia: diasDesdeHoy(0), estado_dia: 'en_proceso', horas: 3, nota: 'Avancé el borrador'
  }, CTX_MARCELO);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['bitacora'] } }, CTX_LEO);
  const html = htmlDe_(res);
  assert.match(html, /Actividad reciente/);
  // Encabezados de columna reales.
  ['Fecha', 'Tarea', 'Tipo', 'Detalle', 'Horas'].forEach(function (t2) {
    assert.match(html, new RegExp('>' + t2 + '<'), 'falta el encabezado de Actividad: ' + t2);
  });
  // La nota va en su columna (Detalle), y las horas en la suya ("3 h"), no
  // amontonadas como "En proceso (3h): Avancé...".
  assert.match(html, /Avancé el borrador/);
  assert.match(html, /3 h/);
  assert.doesNotMatch(html, /\(3h\):/, 'ya no se amontona tipo+horas+nota en una sola celda');
});

// --- 4. Carga de trabajo sin horas se resume ---------------------------------

test('la Carga de trabajo sin horas registradas se resume en una línea, no imprime grilla vacía', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const t = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Sin horas', responsable_email: 'marcelo@rld.cl', fecha_compromiso: diasDesdeHoy(3) }, CTX_LEO);
  ctx.Actividades.confirmar({ actividad_id: t.actividad_id, fecha_compromiso: diasDesdeHoy(3) }, CTX_MARCELO);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['workload'] } }, CTX_LEO);
  const html = htmlDe_(res);
  assert.match(html, /Carga de trabajo/);
  assert.match(html, /Sin horas registradas en el período/);
  // No debe haber una fila "Persona" de grilla (esa solo se arma cuando hay horas).
  assert.doesNotMatch(html, />Persona</, 'sin horas no se arma la grilla');
});

test('la Carga de trabajo CON horas sí arma la grilla completa', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const t = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Con horas', responsable_email: 'marcelo@rld.cl', fecha_compromiso: diasDesdeHoy(3) }, CTX_LEO);
  ctx.Actividades.confirmar({ actividad_id: t.actividad_id, fecha_compromiso: diasDesdeHoy(3) }, CTX_MARCELO);
  ctx.Proyectos.guardarRegistroDia({
    proyecto_id: proyecto.proyecto_id, actividad_id: t.actividad_id,
    dia: diasDesdeHoy(0), estado_dia: 'en_proceso', horas: 6
  }, CTX_MARCELO);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['workload'] } }, CTX_LEO);
  const html = htmlDe_(res);
  assert.match(html, />Persona</, 'con horas sí se arma la grilla');
  assert.doesNotMatch(html, /Sin horas registradas en el período/);
});
