'use strict';

// v13 (Fase 3, "reporte ejecutivo -- prioridad máxima"): dos secciones
// nuevas del PDF, ambas on-read sobre datos que el reporte YA cargaba
// (detalle de Fase 2 + tareas de listarTareas con es_critica de Fase 1):
//  - 'narrativa': el Resumen Ejecutivo en prosa (página 1 conceptual).
//  - 'mini_gantt': el plan semana a semana, en chips de color sólido.
// Ambas viven en el reporte CLÁSICO (un clic, sin config) además de estar
// disponibles como secciones del informe configurable.

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

function diasDesdeHoy(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

function htmlDe_(res) {
  return Buffer.from(res.pdf_base64, 'base64').toString('utf8');
}

// Aisla el párrafo de la narrativa (entre el encabezado "Resumen ejecutivo"
// y el cierre de su <p>) -- para afirmar qué NO debe decir sin depender de
// que otras secciones (Hitos, Plan de ejecución) existan o no.
function parrafoNarrativa_(html) {
  const m = html.match(/Resumen ejecutivo<\/td><\/tr><\/table><p[^>]*>([\s\S]*?)<\/p>/);
  return m ? m[1] : '';
}

test('descargarReporte (clásico, sin config): trae el Resumen ejecutivo narrativo con la decisión sugerida', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Proyecto con riesgo', fecha_inicio: diasDesdeHoy(-20), fecha_objetivo: diasDesdeHoy(20) }, CTX_LEO);
  ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Firmar contrato', responsable_email: 'leo@rld.cl',
    fecha_compromiso: diasDesdeHoy(-3), prioridad: 'P1'
  }, CTX_LEO);
  ctx.Proyectos.gestionarRiesgo({
    proyecto_id: proyecto.proyecto_id, descripcion: 'El proveedor puede fallar', probabilidad: 'ALTA', impacto: 'ALTA'
  }, CTX_LEO);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const html = htmlDe_(res);
  assert.match(html, /Resumen ejecutivo/);
  assert.match(html, /Requiere atención:/);
  assert.match(html, /riesgo\(s\) alto\(s\) abierto\(s\)/);
  assert.match(html, /Decisión sugerida para gerencia:.*Revisar la mitigación/);
});

test('narrativa: sin nada pendiente, dice explícitamente que no hay problemas y sugiere seguimiento normal', () => {
  const ctx = loadConSchema();
  // Sin tareas: avance_pct queda null (calcularAvanceProyecto_ sin activas),
  // así que la desviación tampoco se calcula -- el escenario más limpio para
  // aislar el mensaje de "nada pendiente" del de "atraso de avance" (son dos
  // señales independientes de la narrativa, cada una con su propio test).
  const proyecto = ctx.Proyectos.crear({ nombre: 'Proyecto sano', fecha_inicio: diasDesdeHoy(-5), fecha_objetivo: diasDesdeHoy(30) }, CTX_LEO);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const html = htmlDe_(res);
  assert.match(html, /No hay tareas críticas atrasadas, bloqueos, hitos vencidos ni riesgos altos abiertos/);
  assert.match(html, /Sin decisiones urgentes/);
});

test('narrativa: avance real muy por debajo del plan sugiere evaluar un ajuste', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Proyecto atrasado', fecha_inicio: diasDesdeHoy(-5), fecha_objetivo: diasDesdeHoy(30) }, CTX_LEO);
  ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Sin avanzar', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(15)
  }, CTX_LEO);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const html = htmlDe_(res);
  assert.match(html, /por DEBAJO de lo planificado/);
  assert.match(html, /Evaluar un ajuste de plan/);
});

test('narrativa: menciona el próximo hito no-terminal más cercano', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Con hitos', fecha_inicio: diasDesdeHoy(-5), fecha_objetivo: diasDesdeHoy(60) }, CTX_LEO);
  ctx.Proyectos.gestionarHito({ proyecto_id: proyecto.proyecto_id, nombre: 'Kickoff completado', fecha_objetivo: diasDesdeHoy(-2) }, CTX_LEO);
  const hitoLejano = ctx.Proyectos.gestionarHito({ proyecto_id: proyecto.proyecto_id, nombre: 'Cierre final', fecha_objetivo: diasDesdeHoy(50) }, CTX_LEO);
  ctx.Proyectos.gestionarHito({ proyecto_id: proyecto.proyecto_id, nombre: 'Piloto', fecha_objetivo: diasDesdeHoy(10) }, CTX_LEO);
  // Marcar el hito vencido como completado para que no "gane" por ser el más antiguo.
  const hitos = ctx.Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, CTX_LEO).hitos;
  const kickoff = hitos.filter((h) => h.nombre === 'Kickoff completado')[0];
  ctx.Proyectos.gestionarHito({ proyecto_id: proyecto.proyecto_id, hito_id: kickoff.hito_id, estado: 'COMPLETADO' }, CTX_LEO);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const html = htmlDe_(res);
  const parrafo = parrafoNarrativa_(html);
  assert.match(parrafo, /Próximo hito: <b>Piloto<\/b>/, 'el más cercano no-terminal es Piloto, no Cierre final');
  assert.doesNotMatch(parrafo, /Cierre final/, 'el hito lejano (60 días) no debe mencionarse como próximo hito en la narrativa');
});

test('mini-Gantt semanal: agrupa las tareas por semana, marca críticas y respeta el tope de 6 por semana', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Proyecto con muchas tareas', fecha_inicio: diasDesdeHoy(0), fecha_objetivo: diasDesdeHoy(7) }, CTX_LEO);
  // 8 tareas todas dentro de la misma semana -> se debe ver el tope + "más".
  for (let i = 1; i <= 8; i++) {
    ctx.Proyectos.crearTarea({
      proyecto_id: proyecto.proyecto_id, titulo: 'Tarea número ' + i, responsable_email: 'leo@rld.cl',
      fecha_compromiso: diasDesdeHoy(3), prioridad: i === 1 ? 'P1' : 'P4'
    }, CTX_LEO);
  }
  const critica = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Base de la ruta crítica', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(2)
  }, CTX_LEO);
  ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Depende de la base', responsable_email: 'leo@rld.cl',
    fecha_compromiso: diasDesdeHoy(5), depende_de: critica.actividad_id
  }, CTX_LEO);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const html = htmlDe_(res);
  assert.match(html, /Plan de ejecución/);
  assert.match(html, /Semana del/);
  assert.match(html, /\+\d+ más/, 'con más de 6 tareas en la semana, debe recortar y avisar cuántas más hay');
  assert.match(html, /Base de la ruta crítica.*&#9733;|&#9733;.*Base de la ruta crítica/, 'la tarea en la ruta crítica lleva la estrella');
});

test('mini-Gantt semanal: una tarea retroactiva (creada hoy con compromiso ya pasado) NO desaparece del reporte', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Con tarea retroactiva', fecha_inicio: diasDesdeHoy(-10), fecha_objetivo: diasDesdeHoy(10) }, CTX_LEO);
  const retro = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Tarea cargada con atraso', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(-3)
  }, CTX_LEO);
  // fecha_creacion queda en "ahora" (hoy) por defecto -- POSTERIOR al
  // fecha_compromiso que se le dio (-3 días). Esta inversión es la que antes
  // hacía que kIni>kFin y la tarea nunca calzara con ninguna semana.
  ctx.actualizarFilaPorId_('ACTIVIDADES', 'actividad_id', retro.actividad_id, { fecha_creacion: new Date().toISOString() });

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const html = htmlDe_(res);
  assert.match(html, /Plan de ejecución/);
  assert.match(html, /Tarea cargada con atraso/, 'la tarea con ventana invertida debe seguir apareciendo en alguna semana');
});

test('mini-Gantt semanal: sin tareas ni hitos con fecha, la sección no aparece (nunca un bloque vacío)', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Proyecto recién creado', fecha_inicio: diasDesdeHoy(-1), fecha_objetivo: diasDesdeHoy(1) }, CTX_LEO);
  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const html = htmlDe_(res);
  assert.doesNotMatch(html, /Plan de ejecución/);
});

test('descargarReporte con config: narrativa y mini_gantt son secciones seleccionables independientes', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Config a medida', fecha_inicio: diasDesdeHoy(-5), fecha_objetivo: diasDesdeHoy(20) }, CTX_LEO);
  ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Solo para el mini gantt', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(3)
  }, CTX_LEO);

  const soloNarrativa = ctx.Proyectos.descargarReporte({
    proyecto_id: proyecto.proyecto_id, config: { secciones: ['narrativa'] }
  }, CTX_LEO);
  const htmlNarrativa = htmlDe_(soloNarrativa);
  assert.match(htmlNarrativa, /Resumen ejecutivo/);
  assert.doesNotMatch(htmlNarrativa, /Plan de ejecución/);

  const soloMiniGantt = ctx.Proyectos.descargarReporte({
    proyecto_id: proyecto.proyecto_id, config: { secciones: ['mini_gantt'] }
  }, CTX_LEO);
  const htmlMiniGantt = htmlDe_(soloMiniGantt);
  assert.match(htmlMiniGantt, /Plan de ejecución/);
  assert.doesNotMatch(htmlMiniGantt, /Resumen ejecutivo/);
});
