'use strict';

/**
 * Auditoría de Proyectos 2026-09-29 — etapa 1 "datos correctos"
 * (documentacion/SIGSO-Proyectos-auditoria-2026-09-29.md):
 *  C1  El Excel corría las fechas un día (medianoche UTC llevada a la hora de
 *      Chile) y las escribía como texto en dos formatos.
 *  C2  El inicio de plan de una tarea sin inicio propio era su fecha de
 *      creación aunque dependiera de otra: todas las barras partían juntas.
 *  C3  "Sin actualizar" contaba tareas terminadas y tareas que aún no les toca
 *      empezar, e inflaba la salud a "Crítico".
 *  C4  La Carta Gantt del PDF tomaba "hoy" en UTC.
 *  P3  El resumen del PDF decía "en línea" con una brecha que el KPI ya
 *      marcaba en rojo, con decimales en formato inglés y plurales "(s)".
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { abrirDb_, sembrarTabla_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Proyectos = require('../logica/proyectos');
const Libro = require('../logica/libroProyecto');
const Utils = require('../logica/utils');
const DocV2 = require('../logica/documentoV2');
const ReporteProyecto = require('../logica/reporteProyecto');
const { leerZip_ } = require('../logica/xlsxZip');

const CTX_LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV' };

function db_() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function proyecto_(db, over) {
  return Proyectos.crear(db, Object.assign({ nombre: 'Estandarización', fecha_inicio: '2026-03-02', fecha_objetivo: '2099-12-31' }, over), CTX_LEO);
}
function tarea_(db, p, datos) {
  return Proyectos.crearTarea(db, Object.assign({ proyecto_id: p.proyecto_id, responsable_email: 'leo@rld.cl' }, datos), CTX_LEO);
}
function plan_(db, p, t) {
  return Proyectos.obtenerRendimiento(db, { proyecto_id: p.proyecto_id }, CTX_LEO).plan_seguimiento.find((x) => x.actividad_id === t.actividad_id);
}
function hoja_(r, parte) {
  const e = leerZip_(Buffer.from(r.xlsx_base64, 'base64')).find((x) => x.nombre === parte);
  return e ? e.contenido.toString('utf8') : '';
}
function serieExcel_(clave) {
  return (Date.UTC(+clave.slice(0, 4), +clave.slice(5, 7) - 1, +clave.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000;
}

// ===== Utils.claveDiaCampo_ ===================================================

test('claveDiaCampo_: un campo de fecha se lee tal cual; solo un instante real va a la hora de Chile', () => {
  assert.equal(Utils.claveDiaCampo_('2026-09-03T00:00:00.000Z'), '2026-09-03', 'medianoche UTC = etiqueta de día');
  assert.equal(Utils.claveDiaCampo_('2026-09-21'), '2026-09-21');
  assert.equal(Utils.claveDiaCampo_('2026-09-04T13:47:24.778Z'), '2026-09-04');
  assert.equal(Utils.claveDiaCampo_('2026-09-30T02:10:00.000Z'), '2026-09-29', 'las 23:10 del 29 en Chile');
  assert.equal(Utils.claveDiaCampo_(''), '');
  assert.equal(Utils.claveDiaCampo_(null), '');
  assert.equal(Utils.claveDiaCampo_('no es fecha'), '');
});

// ===== C2 · inicio de plan por dependencia ======================================

test('C2: sin inicio propio, la tarea que depende de otra empieza el día hábil siguiente a su término', () => {
  const db = db_();
  const p = proyecto_(db);
  // 13/03/2026 es viernes: la siguiente empieza el lunes 16.
  const a = tarea_(db, p, { titulo: 'Levantar flujo', fecha_compromiso: '2026-03-13' });
  const b = tarea_(db, p, { titulo: 'Formalizar flujo', fecha_compromiso: '2026-03-31', depende_de: a.actividad_id });
  const pb = plan_(db, p, b);
  assert.equal(pb.plan_inicio, '2026-03-16');
  assert.equal(pb.plan_inicio_origen, 'dependencia');
});

test('C2: el inicio propio sigue mandando; sin inicio ni dependencia se avisa que es la fecha de carga', () => {
  const db = db_();
  const p = proyecto_(db);
  const a = tarea_(db, p, { titulo: 'A', fecha_compromiso: '2026-03-13' });
  const propia = tarea_(db, p, { titulo: 'Con inicio', fecha_inicio_plan: '2026-03-20', fecha_compromiso: '2026-03-31', depende_de: a.actividad_id });
  assert.equal(plan_(db, p, propia).plan_inicio, '2026-03-20');
  assert.equal(plan_(db, p, propia).plan_inicio_origen, 'propio');
  assert.ok(['creacion', 'proyecto', 'compromiso'].indexOf(plan_(db, p, a).plan_inicio_origen) !== -1);
});

test('C2: si la anterior termina después del compromiso propio, no se inventa un inicio incoherente', () => {
  const db = db_();
  const p = proyecto_(db);
  const a = tarea_(db, p, { titulo: 'Larga', fecha_compromiso: '2026-06-30' });
  const b = tarea_(db, p, { titulo: 'Corta', fecha_compromiso: '2026-04-10', depende_de: a.actividad_id });
  const pb = plan_(db, p, b);
  assert.notEqual(pb.plan_inicio_origen, 'dependencia');
  assert.ok(pb.plan_inicio <= '2026-04-10', 'el inicio nunca queda después del término');
});

test('C1: la desviación de plazo cuenta días de calendario (03/09 → terminó el 04/09 por la mañana = 1 día)', () => {
  assert.equal(Proyectos.calcularDesviacionPlazoDias_('2026-09-03T00:00:00.000Z', '2026-09-04T13:47:24.778Z'), 1);
  assert.equal(Proyectos.calcularDesviacionPlazoDias_('2026-09-15', '2026-09-09T20:00:00.000Z'), -6);
  assert.equal(Proyectos.calcularDuracionDias_('2026-01-15', '2026-03-15'), 59);
  assert.equal(Proyectos.calcularDuracionDias_('', '2026-03-15'), null);
});

// ===== C3 · salud: "sin actualizar" =============================================

test('C3: "sin actualizar" no cuenta terminadas ni tareas que aún no les toca empezar', () => {
  const db = db_();
  const p = proyecto_(db);
  const vieja = '2026-01-05T12:00:00.000Z';
  const terminada = tarea_(db, p, { titulo: 'Hecha', fecha_compromiso: '2099-01-10' });
  const futura = tarea_(db, p, { titulo: 'Futura', fecha_inicio_plan: '2099-02-01', fecha_compromiso: '2099-03-01' });
  const enCurso = tarea_(db, p, { titulo: 'En curso', fecha_compromiso: '2099-04-01' });
  const debioPartir = tarea_(db, p, { titulo: 'Debió partir', fecha_inicio_plan: '2026-03-02', fecha_compromiso: '2099-05-01' });
  const sinInicio = tarea_(db, p, { titulo: 'Sin inicio planificado', fecha_compromiso: '2099-06-01' });
  actualizarFilaPorId_(db, 'ACTIVIDADES', 'actividad_id', terminada.actividad_id, { estado: 'TERMINADA', fecha_terminada: vieja, ultima_actualizacion: vieja });
  actualizarFilaPorId_(db, 'ACTIVIDADES', 'actividad_id', futura.actividad_id, { estado: 'NO_INICIADA', ultima_actualizacion: vieja });
  actualizarFilaPorId_(db, 'ACTIVIDADES', 'actividad_id', enCurso.actividad_id, { estado: 'EN_CURSO', ultima_actualizacion: vieja });
  actualizarFilaPorId_(db, 'ACTIVIDADES', 'actividad_id', debioPartir.actividad_id, { estado: 'NO_INICIADA', ultima_actualizacion: vieja });
  actualizarFilaPorId_(db, 'ACTIVIDADES', 'actividad_id', sinInicio.actividad_id, { estado: 'NO_INICIADA', ultima_actualizacion: vieja, fecha_creacion: vieja });
  const d = Proyectos.getDetalle(db, { proyecto_id: p.proyecto_id }, CTX_LEO);
  const factor = (d.salud_desglose || []).find((x) => x.factor === 'sin_actualizar');
  assert.ok(factor, 'la tarea en curso sin movimiento sí cuenta');
  // Cuentan: la en curso y la no iniciada cuyo inicio planificado ya pasó.
  // No cuentan: la terminada, la futura y la que solo tiene fecha de carga.
  assert.equal(factor.cantidad, 2);
  assert.ok(d.salud_motivos.indexOf('2 tareas sin actualizar hace 5+ días hábiles') !== -1, 'plural resuelto: ' + d.salud_motivos.join(' | '));
  const soloUna = db_();
  const p2 = proyecto_(soloUna);
  const t = tarea_(soloUna, p2, { titulo: 'Única', fecha_compromiso: '2099-04-01' });
  actualizarFilaPorId_(soloUna, 'ACTIVIDADES', 'actividad_id', t.actividad_id, { estado: 'EN_CURSO', ultima_actualizacion: vieja });
  const d2 = Proyectos.getDetalle(soloUna, { proyecto_id: p2.proyecto_id }, CTX_LEO);
  assert.ok(d2.salud_motivos.indexOf('1 tarea sin actualizar hace 5+ días hábiles') !== -1, 'singular: ' + d2.salud_motivos.join(' | '));
  assert.ok(!d.salud_motivos.some((m) => /\(s\)/.test(m)), 'sin "(s)" en los motivos');
});

// ===== C1 · Excel: fechas =======================================================

test('C1: el Excel escribe fechas reales (serie de Excel) sin correrlas un día', () => {
  const db = db_();
  const p = proyecto_(db);
  const t = tarea_(db, p, { titulo: 'Reunión inicial', fecha_compromiso: '2026-03-15' });
  // Así quedan algunas cargas: el día como medianoche UTC.
  actualizarFilaPorId_(db, 'ACTIVIDADES', 'actividad_id', t.actividad_id, { fecha_compromiso: '2026-09-03T00:00:00.000Z' });
  const r = Libro.descargarLibro(db, { proyecto_id: p.proyecto_id }, CTX_LEO);
  const tareas = hoja_(r, 'xl/worksheets/sheet3.xml');
  assert.ok(tareas.includes('s="12"><v>' + serieExcel_('2026-09-03') + '</v>'), 'Fin plan = 03/09/2026 como fecha de Excel');
  assert.ok(!tareas.includes('<v>' + serieExcel_('2026-09-02') + '</v>'), 'no debe correrse al 02/09');
  assert.ok(!/\d{2}-\d{2}-\d{4}/.test(tareas), 'ninguna fecha como texto dd-mm-aaaa');
  const estilos = leerZip_(Buffer.from(r.xlsx_base64, 'base64')).find((x) => x.nombre === 'xl/styles.xml').contenido.toString('utf8');
  assert.ok(estilos.includes('formatCode="dd/mm/yyyy"') && estilos.includes('<cellXfs count="14">'));
});

test('C1/E2: porcentajes como número con formato %, y la Carta Gantt del Excel usa el inicio de plan', () => {
  const db = db_();
  const p = proyecto_(db);
  const a = tarea_(db, p, { titulo: 'A', fecha_compromiso: '2026-03-13' });
  const b = tarea_(db, p, { titulo: 'B', fecha_compromiso: '2026-03-31', depende_de: a.actividad_id });
  const r = Libro.descargarLibro(db, { proyecto_id: p.proyecto_id }, CTX_LEO);
  const resp = hoja_(r, 'xl/worksheets/sheet' + (leerZip_(Buffer.from(r.xlsx_base64, 'base64')).filter((x) => /worksheets\/sheet\d+\.xml$/.test(x.nombre)).length) + '.xml');
  assert.match(resp, /s="13"><v>1<\/v>/, 'carga relativa 100 % = 1 con formato de porcentaje');
  const gantt = hoja_(r, 'xl/worksheets/sheet2.xml');
  assert.ok(gantt.includes('<v>' + serieExcel_('2026-03-16') + '</v>'), 'la tarea B parte el lunes 16/03, tras su dependencia');
  assert.ok(b);
});

// ===== C4 · PDF: hoy en Chile ======================================================

test('C4: la Carta Gantt del PDF no calcula "hoy" en UTC', () => {
  const fuente = fs.readFileSync(path.join(__dirname, '..', 'logica', 'reporteProyecto.js'), 'utf8');
  assert.ok(!/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)[^\n]*\n[^\n]*hoy/i.test(fuente));
  assert.ok(!/const hoy(Clave|Utc) = new Date\(\)\.toISOString\(\)/.test(fuente), 'hoy debe salir de claveHoyChile_()');
});

// ===== P3 · PDF: redacción ========================================================

test('P3: el resumen no dice "en línea" con 2,5 puntos de atraso y usa coma decimal', () => {
  const { R, U } = DocV2.piezas();
  const detalle = {
    proyecto: { nombre: 'Estandarización', estado: 'PLANIFICACION' }, salud: 'critico', salud_penalizacion: 100,
    avance_pct: 19.6, avance_esperado_pct: 22.1, requiere_atencion: {}, hitos: [], riesgos: []
  };
  const html = ReporteProyecto.cuerpoProyectoV2_(detalle, [], { cumplimiento_tareas: {}, plan_seguimiento: [] }, [], {}, R, U, DocV2.fecha_);
  assert.ok(!html.includes('está en línea con lo planificado'), 'con −2,5 pp no está en línea');
  assert.ok(html.includes('19,6 %') && html.includes('22,1 %'), 'coma decimal');
  assert.ok(!/\(\d+ puntos en contra\)/.test(html), 'sin la jerga del puntaje en la frase');
});
