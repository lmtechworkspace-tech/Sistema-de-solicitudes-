'use strict';

/**
 * Auditoría de Proyectos 2026-09-29 — etapa 4 "Gantt operativo"
 * (documentacion/SIGSO-Proyectos-auditoria-2026-09-29.md, G3/G4/G5/G6/G8/G9):
 *  - Una tarea puede depender de VARIAS (depende_de = ids separados por coma):
 *    validación de proyecto, de sí misma y de ciclos; el inicio de plan parte
 *    tras la que termina más tarde; la ruta crítica usa la duración de PLAN.
 *  - El dibujo compartido anida las subtareas, muestra la línea base y el asa
 *    para reprogramar arrastrando (solo si se permite).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { abrirDb_, sembrarTabla_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Proyectos = require('../logica/proyectos');
const Libro = require('../logica/libroProyecto');
const DocV2 = require('../logica/documentoV2');
const { leerZip_ } = require('../logica/xlsxZip');

const CTX_LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV' };
const FRONT = path.join(__dirname, '..', '..', 'frontend');

function db_() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function proyecto_(db, nombre) {
  return Proyectos.crear(db, { nombre: nombre || 'Estandarización', fecha_inicio: '2026-03-02', fecha_objetivo: '2026-12-31' }, CTX_LEO);
}
function tarea_(db, p, datos) {
  return Proyectos.crearTarea(db, Object.assign({ proyecto_id: p.proyecto_id, responsable_email: 'leo@rld.cl' }, datos), CTX_LEO);
}
function listar_(db, p) { return Proyectos.listarTareas(db, { proyecto_id: p.proyecto_id }, CTX_LEO); }

// ===== Varias dependencias ============================================================

test('G6: una tarea depende de varias; se guarda la lista y el detalle las trae todas', () => {
  const db = db_();
  const p = proyecto_(db);
  const a = tarea_(db, p, { titulo: 'Contrato', fecha_compromiso: '2026-03-13' });
  const b = tarea_(db, p, { titulo: 'Diseño', fecha_compromiso: '2026-03-20' });
  const c = tarea_(db, p, { titulo: 'Lanzamiento', fecha_compromiso: '2026-04-10', depende_de: [a.actividad_id, b.actividad_id] });
  const fila = listar_(db, p).find((x) => x.actividad_id === c.actividad_id);
  assert.deepEqual(Proyectos.dependenciasDe_(fila).sort(), [a.actividad_id, b.actividad_id].sort());
  assert.equal(fila.dependencias.length, 2);
  assert.match(fila.dependencia_titulo, /Contrato/);
  assert.match(fila.dependencia_titulo, /Diseño/);
});

test('G6: el inicio de plan parte el día hábil siguiente a la dependencia que termina MÁS TARDE', () => {
  const db = db_();
  const p = proyecto_(db);
  const a = tarea_(db, p, { titulo: 'Corta', fecha_compromiso: '2026-03-10' });
  const b = tarea_(db, p, { titulo: 'Larga', fecha_compromiso: '2026-03-20' }); // viernes
  const c = tarea_(db, p, { titulo: 'Después de ambas', fecha_compromiso: '2026-04-10', depende_de: a.actividad_id + ',' + b.actividad_id });
  const plan = Proyectos.obtenerRendimiento(db, { proyecto_id: p.proyecto_id }, CTX_LEO).plan_seguimiento.find((x) => x.actividad_id === c.actividad_id);
  assert.equal(plan.plan_inicio, '2026-03-23', 'lunes siguiente al viernes 20');
  assert.equal(plan.plan_inicio_origen, 'dependencia');
});

test('G6: no se acepta depender de sí misma, de otro proyecto ni formar un ciclo', () => {
  const db = db_();
  const p = proyecto_(db);
  const otro = proyecto_(db, 'Otro');
  const a = tarea_(db, p, { titulo: 'A', fecha_compromiso: '2026-03-13' });
  const b = tarea_(db, p, { titulo: 'B', fecha_compromiso: '2026-03-20', depende_de: a.actividad_id });
  const c = tarea_(db, p, { titulo: 'C', fecha_compromiso: '2026-03-27', depende_de: b.actividad_id });
  const ajena = tarea_(db, otro, { titulo: 'Ajena', fecha_compromiso: '2026-03-20' });
  const base = { proyecto_id: p.proyecto_id, actividad_id: a.actividad_id };
  assert.equal(Proyectos.editarTarea(db, Object.assign({ depende_de: a.actividad_id }, base), CTX_LEO)._validationError, true, 'de sí misma');
  assert.equal(Proyectos.editarTarea(db, Object.assign({ depende_de: ajena.actividad_id }, base), CTX_LEO)._validationError, true, 'de otro proyecto');
  const ciclo = Proyectos.editarTarea(db, Object.assign({ depende_de: c.actividad_id }, base), CTX_LEO);
  assert.equal(ciclo._validationError, true, 'A→C→B→A es un ciclo');
  assert.match(ciclo.message, /ciclo/);
  // Quitar todas las dependencias sí se puede.
  const libre = Proyectos.editarTarea(db, { proyecto_id: p.proyecto_id, actividad_id: c.actividad_id, depende_de: '' }, CTX_LEO);
  assert.ok(!libre._validationError);
  assert.deepEqual(Proyectos.dependenciasDe_(listar_(db, p).find((x) => x.actividad_id === c.actividad_id)), []);
});

test('G6: la ruta crítica considera todas las dependencias y la duración de plan', () => {
  const db = db_();
  const p = proyecto_(db);
  // Dos caminos hacia el final: A (larga) y B (corta). Crítico: A → Fin.
  const a = tarea_(db, p, { titulo: 'Larga', fecha_inicio_plan: '2026-03-02', fecha_compromiso: '2026-04-30' });
  const b = tarea_(db, p, { titulo: 'Corta', fecha_inicio_plan: '2026-03-02', fecha_compromiso: '2026-03-06' });
  tarea_(db, p, { titulo: 'Fin', fecha_compromiso: '2026-05-15', depende_de: [a.actividad_id, b.actividad_id] });
  const filas = listar_(db, p);
  const por = (t) => filas.find((x) => x.titulo === t);
  assert.equal(por('Larga').es_critica, true);
  assert.equal(por('Fin').es_critica, true);
  assert.equal(por('Corta').es_critica, false, 'la corta tiene holgura');
  assert.ok(por('Corta').holgura_dias > 30);
});

test('Excel: una fila por cada dependencia en la hoja Dependencias', () => {
  const db = db_();
  const p = proyecto_(db);
  const a = tarea_(db, p, { titulo: 'Contrato', fecha_compromiso: '2026-03-13' });
  const b = tarea_(db, p, { titulo: 'Diseño', fecha_compromiso: '2026-03-20' });
  tarea_(db, p, { titulo: 'Lanzamiento', fecha_compromiso: '2026-04-10', depende_de: [a.actividad_id, b.actividad_id] });
  const r = Libro.descargarLibro(db, { proyecto_id: p.proyecto_id }, CTX_LEO);
  const hoja = leerZip_(Buffer.from(r.xlsx_base64, 'base64')).map((e) => e.contenido.toString('utf8')).find((x) => x.includes('>Depende de<'));
  assert.equal((hoja.match(/>Lanzamiento</g) || []).length, 2, 'Lanzamiento aparece una vez por cada dependencia');
});

// ===== El dibujo: subtareas, línea base, asa ===========================================

function ctxGantt_(db, p, extra) {
  const rend = Proyectos.obtenerRendimiento(db, { proyecto_id: p.proyecto_id }, CTX_LEO);
  return Object.assign({ tareas: listar_(db, p), proyecto: p, detalle: { hitos: [] }, rendimiento: rend }, extra || {});
}

test('G5: las subtareas van justo debajo de su tarea padre, con sangría', () => {
  const db = db_();
  const p = proyecto_(db);
  const padre = tarea_(db, p, { titulo: 'Padre', fecha_compromiso: '2026-04-30' });
  tarea_(db, p, { titulo: 'Otra', fecha_compromiso: '2026-03-10' });
  tarea_(db, p, { titulo: 'Hija', fecha_compromiso: '2026-04-20', tarea_padre_id: padre.actividad_id });
  const { G } = DocV2.piezas();
  const ctx = ctxGantt_(db, p);
  const r = G.rango(ctx);
  const html = G.html(ctx, { desde: r.desde, semanas: r.semanas, agrupar: true, quieto: true });
  const orden = (html.match(/title="(Padre|Otra|Hija)"/g) || []).map((x) => x.slice(7, -1));
  assert.equal(orden[orden.indexOf('Padre') + 1], 'Hija', 'la hija sigue a su padre');
  assert.match(html, /sx2-py-gantt__fila--sub[^>]*>[\s\S]*?title="Hija"/);
});

test('G4/G3: línea base cuando se pide y existe; asa solo si se puede reprogramar', () => {
  const db = db_();
  const p = proyecto_(db);
  tarea_(db, p, { titulo: 'Con base', fecha_compromiso: '2026-04-30' });
  Proyectos.congelarBaseline(db, { proyecto_id: p.proyecto_id }, CTX_LEO);
  const { G } = DocV2.piezas();
  const ctx = ctxGantt_(db, p);
  assert.ok(ctx.rendimiento.baseline, 'hay línea base congelada');
  const r = G.rango(ctx);
  const con = G.html(ctx, { desde: r.desde, semanas: r.semanas, lineaBase: true, reprogramable: () => true });
  const sin = G.html(ctx, { desde: r.desde, semanas: r.semanas, lineaBase: false, reprogramable: () => false });
  assert.match(con, /sx2-py-gantt__base/);
  assert.match(con, /data-asa/);
  assert.ok(!/sx2-py-gantt__base/.test(sin) && !/data-asa/.test(sin));
  assert.match(con, /data-desde="\d{4}-\d{2}-\d{2}" data-semanas="\d+"/, 'el rango queda en el DOM para calcular el arrastre');
  assert.match(G.leyenda({ lineaBase: true }), /Línea base/);
});

test('G3: el arrastre abre el formulario de reprogramar con motivo (no cambia nada por sí solo)', () => {
  const gantt = fs.readFileSync(path.join(FRONT, 'js/proyectos-v2/gantt.js'), 'utf8');
  assert.match(gantt, /PY\.abrirReprogramarProyecto\(/);
  const panel = fs.readFileSync(path.join(FRONT, 'js/proyectos-v2/panel-tarea.js'), 'utf8');
  assert.match(panel, /accion: 'reprogramarTareaProyecto'/);
  assert.match(panel, /Toda reprogramación necesita un motivo/);
});
