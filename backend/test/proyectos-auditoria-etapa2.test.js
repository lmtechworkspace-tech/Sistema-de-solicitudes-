'use strict';

/**
 * Auditoría de Proyectos 2026-09-29 — etapa 2 "una sola Carta Gantt"
 * (documentacion/SIGSO-Proyectos-auditoria-2026-09-29.md, P1/G7/E3/E4):
 *  - El dibujo vive en frontend/js/proyectos-v2/gantt-dibujo.js y lo usan la
 *    pantalla y el PDF (corre en el vm de documentoV2): mismo inicio de barra,
 *    mismos colores, avance dentro de la barra, lo real, hitos y "Hoy".
 *  - "Descargar Gantt" desde la vista: solo la Carta Gantt, apaisada, con las
 *    tareas que se están viendo.
 *  - El Excel usa los mismos tonos y reglas, con avance en la barra, semana de
 *    hoy, resumen por hito, leyenda, filtros e impresión apaisada.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { abrirDb_, sembrarTabla_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Proyectos = require('../logica/proyectos');
const Libro = require('../logica/libroProyecto');
const DocV2 = require('../logica/documentoV2');
const Motor = require('../logica/pdfChromium');
const ReporteProyecto = require('../logica/reporteProyecto');
const { leerZip_ } = require('../logica/xlsxZip');

const CTX_LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV' };
const FRONT = path.join(__dirname, '..', '..', 'frontend');

function db_() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function escenario_(db) {
  const p = Proyectos.crear(db, { nombre: 'Estandarización', fecha_inicio: '2026-03-02', fecha_objetivo: '2026-06-30' }, CTX_LEO);
  const h = Proyectos.gestionarHito(db, { proyecto_id: p.proyecto_id, accion: 'crear', nombre: 'H1 Diagnóstico', fecha_objetivo: '2026-03-27' }, CTX_LEO);
  const tareas = [];
  for (let i = 1; i <= 6; i++) {
    tareas.push(Proyectos.crearTarea(db, { proyecto_id: p.proyecto_id, titulo: 'Tarea ' + i, responsable_email: 'leo@rld.cl',
      fecha_compromiso: '2026-03-' + String(5 + i * 3).padStart(2, '0'), hito_id: h.hito_id,
      depende_de: i > 1 ? tareas[i - 2].actividad_id : '' }, CTX_LEO));
  }
  return { p, h, tareas };
}
function hoja_(r, parte) {
  const e = leerZip_(Buffer.from(r.xlsx_base64, 'base64')).find((x) => x.nombre === parte);
  return e ? e.contenido.toString('utf8') : '';
}
function ctxGantt_(db, p) {
  return {
    tareas: Proyectos.listarTareas(db, { proyecto_id: p.proyecto_id }, CTX_LEO),
    proyecto: p, detalle: { hitos: Proyectos.getDetalle(db, { proyecto_id: p.proyecto_id }, CTX_LEO).hitos },
    rendimiento: Proyectos.obtenerRendimiento(db, { proyecto_id: p.proyecto_id }, CTX_LEO)
  };
}

// ===== Un solo mapa de colores ===================================================

test('los tonos del semáforo son los mismos en la pantalla, el dibujo compartido y el Excel', () => {
  const nucleo = fs.readFileSync(path.join(FRONT, 'js/proyectos-v2/nucleo.js'), 'utf8');
  const bloque = nucleo.match(/var TONO_SEMAFORO = (\{[\s\S]*?\});/)[1];
  const deNucleo = Function('return ' + bloque)();
  const { G } = DocV2.piezas();
  assert.deepEqual(Object.assign({}, G.TONO_SEMAFORO), deNucleo, 'gantt-dibujo.js = nucleo.js');
  assert.deepEqual(Libro.TONO_SEMAFORO_XLSX_, deNucleo, 'libroProyecto.js = nucleo.js');
});

test('la plataforma carga el dibujo compartido antes que gantt.js, y el servidor lo tiene', () => {
  const html = fs.readFileSync(path.join(FRONT, 'plataforma.html'), 'utf8');
  const a = html.indexOf('js/proyectos-v2/gantt-dibujo.js'), b = html.indexOf('js/proyectos-v2/gantt.js');
  assert.ok(a !== -1 && a < b, 'gantt-dibujo.js va antes que gantt.js');
  const gantt = fs.readFileSync(path.join(FRONT, 'js/proyectos-v2/gantt.js'), 'utf8');
  assert.ok(!/function tramo\(/.test(gantt), 'gantt.js ya no dibuja por su cuenta: usa SigsoGantt');
  assert.ok(/PY\.gantt = G\.html/.test(gantt));
});

// ===== El dibujo en el servidor (vm) ===============================================

test('el dibujo compartido corre en el servidor: barras con avance, hito con resumen y la misma escalera por dependencias', () => {
  const db = db_();
  const { p } = escenario_(db);
  const { G } = DocV2.piezas();
  const ctx = ctxGantt_(db, p);
  const r = G.rango(ctx);
  const html = G.html(ctx, { desde: r.desde, semanas: r.semanas, agrupar: true, quieto: true, anchoEstimado: 720 });
  assert.match(html, /sx2-py-gantt__fila--grupo/);
  assert.match(html, /sx2-py-gantt__resumen/);
  assert.match(html, /sx2-py-gantt__relleno/);
  assert.equal((html.match(/data-py2-tarea=/g) || []).length, 6);
  // La tarea 2 depende de la 1 (vence el 08/03, domingo): su barra parte el lunes 09/03, más a la derecha.
  const left = (t) => {
    const fila = html.split('data-py2-tarea=').find((x) => x.indexOf('title="' + t + '"') !== -1);
    return Number(fila.match(/sx2-py-gantt__barra[^"]*" style="left:([\d.]+)%/)[1]);
  };
  assert.ok(left('Tarea 2') > left('Tarea 1'), 'escalera: la 2 empieza después de la 1');
});

test('paginas(): cada bloque trae su cabecera; el que empieza a mitad de un hito lo repite "(continúa)"', () => {
  const db = db_();
  const { p } = escenario_(db);
  const { G } = DocV2.piezas();
  const ctx = ctxGantt_(db, p);
  const r = G.rango(ctx);
  const bloques = G.paginas(ctx, { desde: r.desde, semanas: r.semanas, agrupar: true, quieto: true }, 4, 3);
  assert.ok(bloques.length >= 2);
  bloques.forEach((b) => assert.match(b, /sx2-py-gantt__fila--cab/, 'cada página con su cabecera de meses/semanas'));
  assert.equal((bloques[0].match(/sx2-py-gantt__fila(?!--)[^"]*" style/g) || []).length <= 3, true, 'la primera página lleva menos filas');
  assert.match(bloques[1], /H1 Diagnóstico \(continúa\)/);
  assert.ok(!/sx2-py-gantt__plegar/.test(bloques.join('')), 'en papel no hay botones para plegar');
});

// ===== Informe y "Descargar Gantt" ==================================================

test('descargarGantt: sin acceso al proyecto no genera nada', async () => {
  const db = db_();
  const { p } = escenario_(db);
  const r = await ReporteProyecto.descargarGantt(db, { proyecto_id: p.proyecto_id }, { email: 'otro@x.cl', rol: 'DEV' });
  assert.ok(r._forbidden || r._validationError);
});

test('descargarGantt con Chromium: PDF apaisado, solo las tareas filtradas', { skip: !Motor.disponible() && 'sin Chromium en este equipo' }, async () => {
  const db = db_();
  const { p, tareas } = escenario_(db);
  try {
    const r = await ReporteProyecto.descargarGantt(db, { proyecto_id: p.proyecto_id, actividades: [tareas[0].actividad_id],
      filtros: [{ etiqueta: 'Estado', valor: 'Atrasadas' }] }, CTX_LEO);
    const buf = Buffer.from(r.pdf_base64, 'base64');
    assert.equal(buf.slice(0, 5).toString(), '%PDF-');
    assert.match(r.filename, /^carta-gantt-/);
  } finally { await Motor.cerrar(); }
});

// ===== Excel ========================================================================

test('Excel: la Carta Gantt usa los tonos de la pantalla, el avance dentro de la barra y "Situación" coherente con el color', () => {
  const db = db_();
  const { p, tareas } = escenario_(db);
  // Tarea 1: terminada (100 % → toda la barra en verde lleno).
  actualizarFilaPorId_(db, 'ACTIVIDADES', 'actividad_id', tareas[0].actividad_id, { estado: 'TERMINADA', fecha_terminada: '2026-03-08T15:00:00.000Z' });
  const r = Libro.descargarLibro(db, { proyecto_id: p.proyecto_id }, CTX_LEO);
  const gantt = hoja_(r, 'xl/worksheets/sheet2.xml');
  assert.match(gantt, />Situación</);
  assert.match(gantt, />Terminada<\/t>/);
  assert.match(gantt, /<c r="[A-Z]+\d+" s="14"\/>/, 'barra terminada en verde lleno (tono ok)');
  // Las demás están vencidas (marzo de 2026): "Atrasada" y en rojo, texto y color de acuerdo.
  assert.match(gantt, /s="21" t="inlineStr"><is><t xml:space="preserve">Atrasada<\/t>/, 'Situación Atrasada con el tono crítico');
  assert.match(gantt, /s="2[01]"\/>/, 'barra atrasada en rojo (lleno o suave)');
  assert.match(gantt, /s="2[89]"\/>/, 'barra resumen del hito');
  assert.match(gantt, />Leyenda</);
  assert.match(gantt, /<pageSetup [^>]*orientation="landscape"[^>]*fitToWidth="1"/);
  assert.match(gantt, /<sheetPr><pageSetUpPr fitToPage="1"\/><\/sheetPr>/);
  const wb = hoja_(r, 'xl/workbook.xml');
  assert.match(wb, /_xlnm\.Print_Titles/);
  assert.match(wb, /_xlnm\._FilterDatabase/);
  assert.match(hoja_(r, 'xl/worksheets/sheet3.xml'), /<autoFilter ref="A1:K\d+"\/>/, 'filtro en la hoja Tareas');
});
