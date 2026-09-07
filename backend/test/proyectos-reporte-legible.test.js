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

// --- 1. La Carta Gantt es de BARRAS por semana, anclada en el inicio real ---

const MESES_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function bandaMesDe(iso) { return MESES_ES[Number(iso.slice(5, 7)) - 1] + ' ' + iso.slice(0, 4); }

test('la Carta Gantt arranca en el INICIO del proyecto, no en la fecha de creación auto-estampada', () => {
  const ctx = loadConSchema();
  // El proyecto empezó hace 40 días; las tareas se "crean" hoy en el sandbox
  // (igual que en producción, donde el sistema estampa la creación al cargarlas
  // tarde). La carta debe reflejar el inicio REAL, no ese "hoy".
  const inicio = diasDesdeHoy(-40);
  const proyecto = ctx.Proyectos.crear({ nombre: 'Con historia', fecha_inicio: inicio, fecha_objetivo: '2026-12-31' }, CTX_LEO);
  ctx.Proyectos.gestionarIntegrante({ proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  const t = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Tarea', responsable_email: 'marcelo@rld.cl', fecha_compromiso: diasDesdeHoy(3) }, CTX_LEO);
  ctx.Actividades.confirmar({ actividad_id: t.actividad_id, fecha_compromiso: diasDesdeHoy(3) }, CTX_MARCELO);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['gantt'] } }, CTX_LEO);
  const html = htmlDe_(res);
  assert.match(html, /Carta Gantt/);
  // La banda de mes del INICIO del proyecto (hace 40 días) tiene que aparecer:
  // prueba que la línea de tiempo arranca ahí y no en la creación de hoy.
  assert.match(html, new RegExp(bandaMesDe(inicio)),
    'la carta debe arrancar en el mes del inicio del proyecto, no en la creación');
  // Sin registro diario, la grilla de letras día a día NO se agrega (antes salía
  // casi vacía y estorbaba).
  assert.doesNotMatch(html, /Ejecución día a día/);
});

test('un compromiso lejano aparece como barra en la grilla semanal, sin arrastrar columnas diarias', () => {
  const ctx = loadConSchema();
  const inicio = diasDesdeHoy(-10);
  const proyecto = ctx.Proyectos.crear({ nombre: 'Con lejana', fecha_inicio: inicio, fecha_objetivo: '2026-12-31' }, CTX_LEO);
  ctx.Proyectos.gestionarIntegrante({ proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  const lejana = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Publicaciones a fin de año', responsable_email: 'marcelo@rld.cl', fecha_compromiso: diasDesdeHoy(100) }, CTX_LEO);
  ctx.Actividades.confirmar({ actividad_id: lejana.actividad_id, fecha_compromiso: diasDesdeHoy(100) }, CTX_MARCELO);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['gantt'] } }, CTX_LEO);
  const html = htmlDe_(res);
  // La tarea lejana está presente (no se pierde).
  assert.match(html, /Publicaciones a fin de año/);
  // La banda del mes del compromiso lejano aparece -> la barra llega hasta allá.
  assert.match(html, new RegExp(bandaMesDe(diasDesdeHoy(100))));
  // Es semanal, no diaria: el número de columnas de semana es acotado (<=27),
  // no ~110 columnas de día. Se cuenta el encabezado de semanas (font 7px).
  const cols = (html.match(/font-size:7px/g) || []).length;
  assert.ok(cols > 0 && cols <= 27, 'la carta es semanal y acotada (' + cols + ' columnas)');
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
  // v15.3: sin relleno (el importador HTML->PDF de Apps Script no pinta
  // background-color, confirmado renderizando el PDF real) -- el encabezado
  // es texto navy en negrita con un borde inferior grueso del mismo color.
  assert.match(html, /color:#14213D;font-size:9px;font-weight:bold;text-transform:uppercase[^"]*border-bottom:2px solid #14213D/);
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
  // v15.3: sin relleno -- el chip es texto rojo en negrita con borde rojo,
  // no una píldora blanca-sobre-rojo (esa quedaba invisible en el PDF real).
  assert.match(html, /color:#DC2626;font-weight:bold;font-size:8px[^"]*border:1\.3px solid #DC2626/);
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

// --- 5. El "inicio del plan" no puede quedar invertido en una tarea cargada tarde ---
//
// Caso real: un proyecto que arrancó el 07-08 tuvo sus tareas CARGADAS en
// SIGSO el 01-09 (comprometidas de vuelta al 28-08, antes de existir como
// fila). fecha_creacion (01-09) quedó DESPUÉS de fecha_compromiso (28-08) --
// el Cronograma en pantalla mostraba "Plan 01/09/2026–28/08/2026" (invertido)
// y el PDF renunciaba a calcular "Esperado" (fin <= inicio -> null), aunque
// el inicio real del proyecto sí permite trazar un plan coherente.

test('planInicioEfectivoClave_: usa el inicio del proyecto cuando la creación quedó DESPUÉS del compromiso', () => {
  assert.equal(planInicioEfectivoClave_('2026-09-01', '2026-08-28', '2026-08-07'), '2026-08-07');
});
test('planInicioEfectivoClave_: la creación manda cuando ya es coherente (<= compromiso)', () => {
  assert.equal(planInicioEfectivoClave_('2026-08-01', '2026-08-28', '2026-08-07'), '2026-08-01');
});
test('planInicioEfectivoClave_: sin inicio de proyecto (o también inconsistente), cae al propio compromiso', () => {
  assert.equal(planInicioEfectivoClave_('2026-09-01', '2026-08-28', ''), '2026-08-28');
  assert.equal(planInicioEfectivoClave_('2026-09-01', '2026-08-28', '2026-09-15'), '2026-08-28');
});
test('planInicioEfectivoClave_: sin compromiso, se queda con la creación tal cual (nada que invertir)', () => {
  assert.equal(planInicioEfectivoClave_('2026-09-01', '', '2026-08-07'), '2026-09-01');
});

function planInicioEfectivoClave_(claveCreacion, claveCompromiso, claveInicioProyecto) {
  // Re-implementación de la función privada de Proyectos.gs para probarla
  // por contrato (no está expuesta en el objeto público Proyectos) -- el
  // test de integración de más abajo prueba el efecto real end-to-end.
  if (!claveCompromiso) return claveCreacion || '';
  if (claveCreacion && claveCreacion <= claveCompromiso) return claveCreacion;
  if (claveInicioProyecto && claveInicioProyecto <= claveCompromiso) return claveInicioProyecto;
  return claveCompromiso;
}

test('obtenerRendimiento: una tarea cargada tarde usa el inicio del PROYECTO como plan_inicio, no la fecha de creación', () => {
  const ctx = loadConSchema();
  // Proyecto que arrancó hace 20 días (la asignación real).
  const proyecto = ctx.Proyectos.crear({ nombre: 'Con historia', fecha_inicio: diasDesdeHoy(-20), fecha_objetivo: '2026-12-31' }, CTX_LEO);
  ctx.Proyectos.gestionarIntegrante({ proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  // La tarea se CREA hoy pero comprometida hacia atrás (hace 10 días) --
  // exactamente el patrón real: creación > compromiso.
  const t = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Presentaciones HP', responsable_email: 'marcelo@rld.cl', fecha_compromiso: diasDesdeHoy(-10) }, CTX_LEO);
  ctx.Actividades.confirmar({ actividad_id: t.actividad_id, fecha_compromiso: diasDesdeHoy(-10) }, CTX_MARCELO);

  const rendimiento = ctx.Proyectos.obtenerRendimiento({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const plan = rendimiento.plan_seguimiento.filter((p) => p.actividad_id === t.actividad_id)[0];

  assert.equal(plan.plan_inicio, diasDesdeHoy(-20), 'el inicio del plan es el del proyecto, no la fecha de creación (hoy)');
  assert.equal(plan.plan_fin, diasDesdeHoy(-10));
  assert.notEqual(plan.avance_esperado_pct, null,
    'con el inicio corregido SÍ se puede trazar un "esperado" -- antes salía null (fin <= inicio)');
});

test('obtenerRendimiento: una tarea creada en orden normal no cambia (plan_inicio sigue siendo la creación)', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const t = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Normal', responsable_email: 'marcelo@rld.cl', fecha_compromiso: diasDesdeHoy(10) }, CTX_LEO);
  ctx.Actividades.confirmar({ actividad_id: t.actividad_id, fecha_compromiso: diasDesdeHoy(10) }, CTX_MARCELO);

  const rendimiento = ctx.Proyectos.obtenerRendimiento({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const plan = rendimiento.plan_seguimiento.filter((p) => p.actividad_id === t.actividad_id)[0];
  assert.equal(plan.plan_inicio, diasDesdeHoy(0), 'sin creación-tardía, el plan sigue empezando donde se creó la tarea');
});

// --- 6. Leyenda rotulada en Carta Gantt / Ejecución día a día ---------------
// La leyenda ya existía (chips de color con borde), pero sin ningún título
// que la identifique como tal -- fácil de pasar por alto en un diseño sin
// relleno. Se le agrega la palabra "Leyenda" delante, en las dos secciones
// que la usan.

test('la Carta Gantt y la Ejecución día a día rotulan su leyenda con la palabra "Leyenda"', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const t = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Con registro', responsable_email: 'marcelo@rld.cl', fecha_compromiso: diasDesdeHoy(4) }, CTX_LEO);
  ctx.Actividades.confirmar({ actividad_id: t.actividad_id, fecha_compromiso: diasDesdeHoy(4) }, CTX_MARCELO);
  ctx.Proyectos.guardarRegistroDia({
    proyecto_id: proyecto.proyecto_id, actividad_id: t.actividad_id, dia: diasDesdeHoy(0), estado_dia: 'en_proceso', horas: 2
  }, CTX_MARCELO);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['gantt'] } }, CTX_LEO);
  const html = htmlDe_(res);
  const ocurrencias = (html.match(/>Leyenda</g) || []).length;
  assert.ok(ocurrencias >= 2, 'debe rotularse tanto en la Carta Gantt como en Ejecución día a día (encontradas: ' + ocurrencias + ')');
});

// --- 7. Enlace a la página pública al pie del reporte -----------------------
// Nunca un enlace con token de sesión (el PDF se descarga, se imprime, se
// reenvía) -- solo la URL pública, y solo si SIGSO_SITIO_PUBLICO está
// configurado (mismo patrón defensivo que enlaceMagicoPausas_ en Pausas.gs).

function loadConSitioPublico() {
  const ctx = loadBackofficeProject({ scriptProperties: {
    SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'fake-drive-root',
    SIGSO_SITIO_PUBLICO: 'https://ejemplo.github.io/sigso'
  } });
  ['PROYECTOS', 'PROYECTO_INTEGRANTES', 'PROYECTO_HITOS', 'PROYECTO_EVENTOS',
    'PROYECTO_ENTREGABLES', 'PROYECTO_RIESGOS', 'PROYECTO_PLANTILLAS',
    'PROYECTO_PLANTILLA_HITOS', 'SOLICITUDES', 'ACTIVIDADES', 'ACTIVIDADES_BITACORA',
    'JEFATURAS', 'LOG_NOTIFICACIONES', 'CONFIG_FERIADOS', 'NOTIFICACIONES_APP', 'CAT_AREAS']
    .forEach((h) => seedSheet(ctx, h, ctx.COLUMNAS[h]));
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [['U1', 'Leo Lider', 'leo@rld.cl', 'RLD', 'DEV', true, '', 'sistema']]);
  return ctx;
}

test('con SIGSO_SITIO_PUBLICO configurado, el PDF cierra con un enlace a la página pública', () => {
  const ctx = loadConSitioPublico();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Con sitio', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-31' }, CTX_LEO);
  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['ficha'] } }, CTX_LEO);
  const html = htmlDe_(res);
  assert.match(html, /<a href="https:\/\/ejemplo\.github\.io\/sigso\/landing\.html" target="_blank"/,
    'debe enlazar a landing.html, abriendo en pestaña nueva');
  assert.doesNotMatch(html, /token=/, 'jamás un enlace con token de sesión en un documento que se descarga/reenvía');
});

test('sin SIGSO_SITIO_PUBLICO configurado, el PDF se genera igual, sin enlace roto', () => {
  const ctx = loadConSchema(); // sin la propiedad SIGSO_SITIO_PUBLICO
  const proyecto = armarProyecto(ctx);
  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['ficha'] } }, CTX_LEO);
  const html = htmlDe_(res);
  assert.match(html, /Confidencial/, 'el documento se genera igual');
  assert.doesNotMatch(html, /<a href="https:\/\//, 'sin sitio configurado, no hay enlace que mostrar (ni uno roto)');
});
