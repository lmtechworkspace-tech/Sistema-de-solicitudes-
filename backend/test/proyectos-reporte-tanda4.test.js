'use strict';

/**
 * Auditoría del reporte descargable, tanda 4 (cierre):
 *  - A2: índice de contenido en la portada.
 *  - A4: con un solo responsable, no se repite su correo bajo cada tarea.
 *  - C2: marca fantasma de la línea base (compromiso original) en la Carta Gantt.
 *  - C3: en un proyecto con hitos, las tareas de la Carta Gantt se agrupan por hito.
 *  - D5: "Actividad reciente" se agrupa por día (cabecera por fecha, sin columna Fecha).
 *  - D6: "Hitos" trae columna "Cuándo" relativa, orden por fecha y vencidos marcados.
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
    ['U2', 'Marcela Dev', 'marcela@rld.cl', 'RLD', 'DEV', true, '', 'sistema']
  ]);
  return ctx;
}

const CTX_LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV' };
const CTX_MARCELA = { email: 'marcela@rld.cl', nombre: 'Marcela Dev', rol: 'DEV' };

function htmlDe_(res) { return Buffer.from(res.pdf_base64, 'base64').toString('utf8'); }
function diasDesdeHoy(n) {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
  const p = hoy.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2]) + n * 86400000).toISOString().slice(0, 10);
}
function seccion_(html, desde, hasta) {
  const i = html.indexOf(desde);
  const j = hasta ? html.indexOf(hasta, i + 1) : html.length;
  return html.slice(i, j < 0 ? html.length : j);
}

// --- A2: índice de contenido -------------------------------------------------

test('A2: la portada lista un índice de contenido con las secciones incluidas', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Con índice', fecha_inicio: diasDesdeHoy(-5), fecha_objetivo: '2026-12-31' }, CTX_LEO);
  ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'T', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(5) }, CTX_LEO);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['portada', 'ficha', 'hitos', 'riesgos', 'vencimientos'] } }, CTX_LEO);
  const html = htmlDe_(res);
  assert.match(html, /Contenido/, 'la portada trae un índice rotulado "Contenido"');
  // "Ficha del proyecto" solo existe como etiqueta del índice (la sección ficha
  // no tiene ese título), así que verlo prueba que el índice se armó.
  assert.match(html, /Ficha del proyecto/);
  assert.match(html, /Próximos vencimientos/);
});

// --- A4: responsable único ---------------------------------------------------

test('A4: con un solo responsable, se dice una vez y NO se repite bajo cada tarea', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Un dueño', fecha_inicio: diasDesdeHoy(-5), fecha_objetivo: '2026-12-31' }, CTX_LEO);
  for (let i = 0; i < 3; i++) {
    ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Tarea ' + (i + 1), responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(i + 2) }, CTX_LEO);
  }
  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['gantt'] } }, CTX_LEO);
  const html = htmlDe_(res);
  const gantt = seccion_(html, 'Carta Gantt');
  assert.match(gantt, /Responsable de todas las tareas/, 'lo dice una vez arriba');
  // El correo del responsable aparece solo en esa nota, no en cada fila.
  assert.equal((gantt.match(/leo@rld\.cl/g) || []).length, 1, 'el responsable no se repite fila a fila');
});

test('A4: con varios responsables, cada tarea sigue mostrando el suyo', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Varios', fecha_inicio: diasDesdeHoy(-5), fecha_objetivo: '2026-12-31' }, CTX_LEO);
  ctx.Proyectos.gestionarIntegrante({ proyecto_id: proyecto.proyecto_id, usuario_email: 'marcela@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'De Leo', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(3) }, CTX_LEO);
  ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'De Marcela', responsable_email: 'marcela@rld.cl', fecha_compromiso: diasDesdeHoy(4) }, CTX_LEO);
  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['gantt'] } }, CTX_LEO);
  const html = htmlDe_(res);
  const gantt = seccion_(html, 'Carta Gantt');
  assert.doesNotMatch(gantt, /Responsable de todas las tareas/, 'con varios no hay responsable único');
  assert.match(gantt, /marcela@rld\.cl/);
  assert.match(gantt, /leo@rld\.cl/);
});

// --- B2: línea de estado en la portada ---------------------------------------

test('B2: la portada trae una línea de estado (avance / desvío / vencidas)', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Con estado', fecha_inicio: diasDesdeHoy(-20), fecha_objetivo: '2026-12-31' }, CTX_LEO);
  // Una tarea vencida sin avance para que la línea tenga las tres piezas.
  ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Vencida', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(-3) }, CTX_LEO);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['portada'] } }, CTX_LEO);
  const html = htmlDe_(res);
  assert.match(html, /% avanzado/, 'la línea de estado dice el avance');
  assert.match(html, /tarea(s)? vencida(s)?/, 'y las tareas vencidas');
});

// --- C4: primer registro real señalado --------------------------------------

test('C4: "Ejecución día a día" avisa a cuántos días del inicio ocurrió el primer registro', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Con hueco', fecha_inicio: diasDesdeHoy(-15), fecha_objetivo: '2026-12-31' }, CTX_LEO);
  ctx.Proyectos.gestionarIntegrante({ proyecto_id: proyecto.proyecto_id, usuario_email: 'marcela@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  const t = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Con registro', responsable_email: 'marcela@rld.cl', fecha_compromiso: diasDesdeHoy(5) }, CTX_LEO);
  ctx.Actividades.confirmar({ actividad_id: t.actividad_id, fecha_compromiso: diasDesdeHoy(5) }, CTX_MARCELA);
  // Registro real recién hoy: el proyecto arrancó hace 15 días.
  ctx.Proyectos.guardarRegistroDia({ proyecto_id: proyecto.proyecto_id, actividad_id: t.actividad_id, dia: diasDesdeHoy(0), estado_dia: 'en_proceso', horas: 4 }, CTX_MARCELA);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['gantt'] } }, CTX_LEO);
  const html = htmlDe_(res);
  assert.match(html, /Primer registro real:/, 'señala el primer registro real');
  assert.match(html, /d[ií]as después del inicio del proyecto/, 'y a cuántos días del inicio ocurrió');
});

// --- C2: marca fantasma de línea base ---------------------------------------

test('C2: si el plan se movió respecto a la línea base, la Carta Gantt dibuja el ◇ original', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Con baseline', fecha_inicio: diasDesdeHoy(-20), fecha_objetivo: '2026-12-31' }, CTX_LEO);
  const t = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Se reprogramó', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(-2) }, CTX_LEO);
  // Congelar la línea base con el compromiso ORIGINAL, luego reprogramar más tarde.
  ctx.Proyectos.congelarBaseline({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  ctx.Proyectos.reprogramarTarea({ proyecto_id: proyecto.proyecto_id, actividad_id: t.actividad_id, fecha_compromiso: diasDesdeHoy(15), motivo: 'Se corrió por dependencias' }, CTX_LEO);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['gantt'] } }, CTX_LEO);
  const html = htmlDe_(res);
  const gantt = seccion_(html, 'Carta Gantt');
  assert.match(gantt, /&#9671;/, 'dibuja el rombo hueco ◇ del compromiso original');
  assert.match(gantt, /Compromiso original/, 'la leyenda explica el ◇');
});

// --- C3: agrupar por hito ----------------------------------------------------

test('C3: con hitos, la Carta Gantt agrupa las tareas bajo una cabecera por hito', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Con fases', fecha_inicio: diasDesdeHoy(-10), fecha_objetivo: '2026-12-31' }, CTX_LEO);
  const h1 = ctx.Proyectos.gestionarHito({ proyecto_id: proyecto.proyecto_id, nombre: 'Fase Levantamiento', fecha_objetivo: diasDesdeHoy(5) }, CTX_LEO);
  const h2 = ctx.Proyectos.gestionarHito({ proyecto_id: proyecto.proyecto_id, nombre: 'Fase Activación', fecha_objetivo: diasDesdeHoy(20) }, CTX_LEO);
  ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Tarea A', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(4), hito_id: h1.hito_id }, CTX_LEO);
  ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Tarea B', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(18), hito_id: h2.hito_id }, CTX_LEO);
  ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Tarea suelta', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(10) }, CTX_LEO);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['gantt'] } }, CTX_LEO);
  const html = htmlDe_(res);
  const gantt = seccion_(html, 'Carta Gantt');
  assert.match(gantt, /Fase Levantamiento/, 'cabecera de grupo por hito');
  assert.match(gantt, /Fase Activación/);
  assert.match(gantt, /Sin hito/, 'las tareas sin hito quedan en su propio bloque');
  // La cabecera del hito va antes que su tarea.
  assert.ok(gantt.indexOf('Fase Levantamiento') < gantt.indexOf('Tarea A'), 'la tarea va bajo su hito');
});

// --- D6: hitos con "cuándo" --------------------------------------------------

test('D6: la tabla de Hitos trae la columna "Cuándo" y marca los vencidos', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Con hitos', fecha_inicio: diasDesdeHoy(-10), fecha_objetivo: '2026-12-31' }, CTX_LEO);
  ctx.Proyectos.gestionarHito({ proyecto_id: proyecto.proyecto_id, nombre: 'Hito vencido', fecha_objetivo: diasDesdeHoy(-6) }, CTX_LEO);
  ctx.Proyectos.gestionarHito({ proyecto_id: proyecto.proyecto_id, nombre: 'Hito futuro', fecha_objetivo: diasDesdeHoy(12) }, CTX_LEO);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['hitos'] } }, CTX_LEO);
  const html = htmlDe_(res);
  const hitos = seccion_(html, 'Hitos');
  assert.match(hitos, />Cuándo</, 'columna Cuándo');
  // El conteo exacto de días baila ±1 según la hora (clave UTC del reporte vs
  // día Santiago de la siembra); se verifica el patrón, no el número exacto.
  assert.match(hitos, /venció hace \d+ d/, 'el vencido muestra cuánto hace que venció');
  assert.match(hitos, /en \d+ d/, 'el futuro muestra cuánto falta');
  // El vencido va antes que el futuro (orden por fecha objetivo).
  assert.ok(hitos.indexOf('Hito vencido') < hitos.indexOf('Hito futuro'), 'orden por fecha objetivo');
});
