'use strict';

/**
 * Auditoría del reporte descargable, tanda 3 (legibilidad de tablas):
 *  - D2: "Plan · Esperado · Real" se ordena por desviación (lo más atrasado
 *        arriba) y cada fila lleva una mini-barra de magnitud.
 *  - D3: "Próximos vencimientos" dice el total de pendientes y, si recorta la
 *        lista, avisa "+N vencimientos más".
 *  - D4: "Riesgos abiertos" suma Responsable y Mitigación (pasa de inventario
 *        a plan de acción).
 *
 * Se verifica sobre el HTML real que arma `descargarReporte`.
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

// --- D2: orden por desviación + mini-barra -----------------------------------

test('D2: "Plan · Esperado · Real" pone la tarea MÁS atrasada arriba y la adelantada abajo', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Con desvíos', fecha_inicio: diasDesdeHoy(-40), fecha_objetivo: '2026-12-31' }, CTX_LEO);
  // Muy atrasada: comprometida hace 30 días y sin avance -> esperado 100, real 0 -> -100pp.
  ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'ZZZ muy atrasada', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(-30) }, CTX_LEO);
  // Adelantada: comprometida en 20 días y con 90% -> esperado bajo, real 90 -> +pp.
  const ade = ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'AAA adelantada', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(20) }, CTX_LEO);
  ctx.Actividades.confirmar({ actividad_id: ade.actividad_id, fecha_compromiso: diasDesdeHoy(20) }, CTX_LEO);
  ctx.Actividades.checkin({ actividad_id: ade.actividad_id, tipo: 'avance', avance_pct: 90 }, CTX_LEO);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['desviaciones'] } }, CTX_LEO);
  const html = htmlDe_(res);
  const tabla = seccion_(html, 'Plan · Esperado · Real');
  const iAtrasada = tabla.indexOf('ZZZ muy atrasada');
  const iAdelantada = tabla.indexOf('AAA adelantada');
  assert.ok(iAtrasada > -1 && iAdelantada > -1, 'ambas tareas deben aparecer en la tabla');
  assert.ok(iAtrasada < iAdelantada, 'la más atrasada va antes que la adelantada (orden por desviación), no en orden natural (que sería AAA primero)');
  // Mini-barra de desviación: celda con borde inferior grueso.
  assert.match(tabla, /border-bottom:4px solid/, 'cada fila con desviación lleva su mini-barra');
});

// --- D3: total + "+N más" ----------------------------------------------------

function crearPendientes(ctx, proyecto, n) {
  for (let i = 0; i < n; i++) {
    ctx.Proyectos.crearTarea({ proyecto_id: proyecto.proyecto_id, titulo: 'Pendiente ' + (i + 1), responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(i + 1) }, CTX_LEO);
  }
}

test('D3: con más de 8 pendientes, avisa el total y "+N vencimientos más"', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Muchos', fecha_inicio: diasDesdeHoy(-5), fecha_objetivo: '2026-12-31' }, CTX_LEO);
  crearPendientes(ctx, proyecto, 11);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['vencimientos'] } }, CTX_LEO);
  const html = htmlDe_(res);
  assert.match(html, /11 tareas pendientes en total/, 'el encabezado dice el total real');
  assert.match(html, /\+ 3 vencimientos m.s/, '11 - 8 = 3 quedan fuera de la lista');
});

test('D3: con 8 o menos pendientes, NO agrega el pie "+N más"', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Pocos', fecha_inicio: diasDesdeHoy(-5), fecha_objetivo: '2026-12-31' }, CTX_LEO);
  crearPendientes(ctx, proyecto, 5);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['vencimientos'] } }, CTX_LEO);
  const html = htmlDe_(res);
  assert.match(html, /5 tareas pendientes en total/);
  assert.doesNotMatch(html, /vencimientos m.s/, 'sin recorte no hay pie de "+N más"');
});

// --- D4: riesgos con responsable + mitigación --------------------------------

test('D4: "Riesgos abiertos" suma Responsable y Mitigación', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({ nombre: 'Con riesgos', fecha_inicio: diasDesdeHoy(-5), fecha_objetivo: '2026-12-31' }, CTX_LEO);
  ctx.Proyectos.gestionarIntegrante({ proyecto_id: proyecto.proyecto_id, usuario_email: 'marcela@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  ctx.Proyectos.gestionarRiesgo({ proyecto_id: proyecto.proyecto_id, descripcion: 'Baja adopción del CRM', probabilidad: 'ALTA', impacto: 'ALTA', responsable_email: 'marcela@rld.cl', mitigacion: 'Capacitación semanal y acompañamiento' }, CTX_LEO);
  ctx.Proyectos.gestionarRiesgo({ proyecto_id: proyecto.proyecto_id, descripcion: 'Contactos duplicados en la migración', probabilidad: 'MEDIA', impacto: 'ALTA', responsable_email: 'leo@rld.cl' }, CTX_LEO);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id, config: { secciones: ['riesgos'] } }, CTX_LEO);
  const html = htmlDe_(res);
  const tabla = seccion_(html, 'Riesgos abiertos');
  assert.match(tabla, /Responsable/, 'columna Responsable');
  assert.match(tabla, /Mitigaci.n/, 'columna Mitigación');
  assert.match(tabla, /Capacitación semanal y acompañamiento/, 'muestra el plan de mitigación');
  assert.match(tabla, /marcela@rld\.cl/, 'muestra al responsable (email si no hay nombre resuelto)');
  assert.match(tabla, /Sin plan de mitigaci.n/, 'un riesgo sin mitigación se marca explícitamente, no queda en blanco');
});
