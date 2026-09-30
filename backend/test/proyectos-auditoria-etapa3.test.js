'use strict';

/**
 * Auditoría de Proyectos 2026-09-29 — etapa 3 "informe más corto y Excel ordenado"
 * (documentacion/SIGSO-Proyectos-auditoria-2026-09-29.md, P2/P4/P5/P6/C5/E5/E6):
 *  - Próximos vencimientos = atrasadas + lo que vence en 14 días (no todas).
 *  - Plan · Esperado · Real = solo lo que va detrás del plan.
 *  - "Avance real vs. lo planificado" marca lo planificado sobre la barra.
 *  - La actividad reciente dice qué tarea y quién.
 *  - Nombres de archivo sigso-<qué>-<código>-<nombre>-<fecha>; código PRY-AAAA-NNN.
 *  - Excel: sin el ID interno, una sola columna de avance, nombres (no correos)
 *    y un historial en palabras con quién lo registró.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, actualizarFilaPorId_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Proyectos = require('../logica/proyectos');
const Libro = require('../logica/libroProyecto');
const DocV2 = require('../logica/documentoV2');
const ReporteProyecto = require('../logica/reporteProyecto');
const Utils = require('../logica/utils');
const { leerZip_ } = require('../logica/xlsxZip');

const CTX_LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV' };
const HOY = Utils.claveDia_(new Date(), 'America/Santiago');
const enDias = (n) => { const d = new Date(Date.parse(HOY) + n * 86400000); return d.toISOString().slice(0, 10); };

function db_() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function proyecto_(db, over) {
  return Proyectos.crear(db, Object.assign({ nombre: 'Estandarización', fecha_inicio: enDias(-60), fecha_objetivo: enDias(120) }, over), CTX_LEO);
}
function tarea_(db, p, datos) {
  return Proyectos.crearTarea(db, Object.assign({ proyecto_id: p.proyecto_id, responsable_email: 'leo@rld.cl' }, datos), CTX_LEO);
}
function cuerpo_(db, p, config) {
  const { R, U } = DocV2.piezas();
  const d = { proyecto_id: p.proyecto_id };
  const detalle = Proyectos.getDetalle(db, d, CTX_LEO);
  const tareas = Proyectos.listarTareas(db, d, CTX_LEO);
  const rend = Proyectos.obtenerRendimiento(db, d, CTX_LEO);
  const bit = Proyectos.listarBitacora(db, d, CTX_LEO);
  if (config) return ReporteProyecto.cuerpoConfiguradoV2_(ReporteProyecto.normalizarConfig_(config), detalle, tareas, rend, bit, { 'leo@rld.cl': 'Leo Lider' }, R, U, DocV2.fecha_);
  return ReporteProyecto.cuerpoProyectoV2_(detalle, tareas, rend, bit, { 'leo@rld.cl': 'Leo Lider' }, R, U, DocV2.fecha_);
}
function hoja_(r, parte) {
  const e = leerZip_(Buffer.from(r.xlsx_base64, 'base64')).find((x) => x.nombre === parte);
  return e ? e.contenido.toString('utf8') : '';
}

// ===== P6 · código de proyecto ======================================================

test('P6: un proyecto nuevo sin código recibe PRY-AAAA-NNN correlativo; uno escrito a mano se respeta', () => {
  const db = db_();
  const a = proyecto_(db, { nombre: 'A' });
  const b = proyecto_(db, { nombre: 'B' });
  const c = proyecto_(db, { nombre: 'C', codigo: 'ISO-9001' });
  const anio = HOY.slice(0, 4);
  assert.equal(a.codigo, 'PRY-' + anio + '-001');
  assert.equal(b.codigo, 'PRY-' + anio + '-002');
  assert.equal(c.codigo, 'ISO-9001');
});

// ===== P2 · el informe no repite la lista completa ===================================

test('P2: "Próximos vencimientos" trae solo lo atrasado y lo que vence en 14 días', () => {
  const db = db_();
  const p = proyecto_(db);
  tarea_(db, p, { titulo: 'Atrasada', fecha_compromiso: enDias(-3) });
  tarea_(db, p, { titulo: 'Vence pronto', fecha_compromiso: enDias(5) });
  tarea_(db, p, { titulo: 'Lejana', fecha_compromiso: enDias(60) });
  const html = cuerpo_(db, p, { secciones: ['vencimientos'] });
  assert.ok(html.includes('Atrasada') && html.includes('Vence pronto'));
  assert.ok(!html.includes('Lejana'), 'lo que vence en dos meses no es "próximo"');
});

test('P2: "Plan · Esperado · Real" lista solo lo que va detrás del plan y cuenta el resto', () => {
  const db = db_();
  const p = proyecto_(db);
  tarea_(db, p, { titulo: 'Detrás', fecha_inicio_plan: enDias(-20), fecha_compromiso: enDias(10) });
  const lista = tarea_(db, p, { titulo: 'Lista', fecha_inicio_plan: enDias(-20), fecha_compromiso: enDias(-2) });
  actualizarFilaPorId_(db, 'ACTIVIDADES', 'actividad_id', lista.actividad_id, { estado: 'TERMINADA', fecha_terminada: enDias(-3) + 'T15:00:00.000Z', avance_pct: 100 });
  const html = cuerpo_(db, p, { secciones: ['desviaciones'] });
  assert.ok(html.includes('Detrás'));
  assert.ok(!/<strong>Lista<\/strong>|>Lista</.test(html), 'la terminada a tiempo no se lista');
  assert.match(html, /1 tarea va al día o adelantadas, o sin medición/);
});

// ===== P4 · marca del plan ===========================================================

test('P4: "Avance real vs. lo planificado" marca lo planificado sobre cada barra', () => {
  const db = db_();
  const p = proyecto_(db);
  tarea_(db, p, { titulo: 'Sin avance', fecha_inicio_plan: enDias(-20), fecha_compromiso: enDias(10) });
  const html = cuerpo_(db, p);
  assert.match(html, /class="rp2-ranking__marca" style="left:\d+%" title="Planificado a hoy: \d+ %"/);
});

// ===== C5 · actividad reciente ========================================================

test('C5: la actividad reciente del PDF dice en qué tarea y quién', () => {
  const db = db_();
  const p = proyecto_(db);
  const t = tarea_(db, p, { titulo: 'Definir estados CRM', fecha_compromiso: enDias(10) });
  agregarFila_(db, 'ACTIVIDADES_BITACORA', { bitacora_id: 'b1', actividad_id: t.actividad_id, tipo: 'CHECKIN_AVANCE', autor_email: 'leo@rld.cl',
    autor_nombre: '', nota: 'Avanzando', avance_pct: 30, confianza: '', datos: '', timestamp: new Date().toISOString() });
  const html = cuerpo_(db, p);
  const fila = html.split('<tr').find((x) => x.indexOf('Avanzando') !== -1) || '';
  assert.match(fila, /Definir estados CRM/, 'la tarea');
  assert.match(fila, /Leo Lider/, 'quién, por nombre');
});

// ===== Excel ===========================================================================

test('E5/E6/C5: el Excel no muestra el ID interno ni correos, y el historial está en palabras', () => {
  const db = db_();
  const p = proyecto_(db);
  const t = tarea_(db, p, { titulo: 'Tarea con historial', fecha_compromiso: enDias(10) });
  agregarFila_(db, 'ACTIVIDADES_BITACORA', { bitacora_id: 'b1', actividad_id: t.actividad_id, tipo: 'CHECKIN_AVANCE', autor_email: 'leo@rld.cl',
    autor_nombre: 'Leo Lider', nota: 'Nota', avance_pct: 30, confianza: '', datos: '', timestamp: new Date().toISOString() });
  const r = Libro.descargarLibro(db, { proyecto_id: p.proyecto_id }, CTX_LEO);
  assert.match(r.filename, /^sigso-proyecto-pry-\d{4}-\d{3}-estandarizacion-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const tareas = hoja_(r, 'xl/worksheets/sheet3.xml');
  assert.ok(!tareas.includes(t.actividad_id), 'sin el ID interno');
  assert.match(tareas, />Situación</);
  const historial = leerZip_(Buffer.from(r.xlsx_base64, 'base64')).map((e) => e.contenido.toString('utf8')).find((x) => x.includes('>Qué pasó<'));
  assert.ok(historial, 'hoja Historial con "Qué pasó"');
  assert.ok(historial.includes('>Avance<') && !historial.includes('CHECKIN_AVANCE'), 'el tipo en palabras');
  assert.ok(historial.includes('Leo Lider'), 'quién lo registró');
});
