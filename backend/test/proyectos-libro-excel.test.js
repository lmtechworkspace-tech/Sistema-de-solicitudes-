'use strict';

/**
 * v16.8: el proyecto exportado a .xlsx con la Carta Gantt VISUAL.
 *
 * A diferencia de la versión anterior (una Hoja temporal de Drive que Google
 * exportaba), ahora el .xlsx se arma como OOXML a mano con Utilities.zip
 * (ExcelGantt.gs): sin Hoja temporal, sin permiso de Drive nuevo, sin UrlFetch.
 * Eso lo vuelve VERIFICABLE acá: el mock de Utilities.zip arma un ZIP "stored"
 * (sin comprimir), así que el XML de cada parte viaja como texto plano dentro
 * del binario y se puede aseverar sobre su contenido. (La verificación fuerte
 * de que Excel lo abre con las barras de color se hizo aparte con un round-trip
 * por SheetJS; acá se fija que el contenido correcto está en el archivo.)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function ctxConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake', SIGSO_DRIVE_ROOT_FOLDER_ID: 'fake' } });
  Object.keys(ctx.COLUMNAS).forEach((h) => { try { seedSheet(ctx, h, ctx.COLUMNAS[h]); } catch (e) { /* hoja de otro proyecto */ } });
  return ctx;
}

const ADM = { email: 'adm@x.cl', nombre: 'Admin', rol: 'ADM' };

function armarEscenario(ctx) {
  const p = toPlain(ctx.Proyectos.crear({
    nombre: 'Migración ERP', lider_email: 'leo@rld.cl',
    fecha_inicio: '2026-01-15', fecha_objetivo: '2026-11-30'
  }, ADM));
  const hito = toPlain(ctx.Proyectos.gestionarHito({
    proyecto_id: p.proyecto_id, accion: 'crear', nombre: 'Puesta en marcha', fecha_objetivo: '2026-06-30'
  }, ADM));
  const t1 = toPlain(ctx.Proyectos.crearTarea({
    proyecto_id: p.proyecto_id, titulo: 'Levantar requerimientos',
    responsable_email: 'leo@rld.cl', tamano: 'M', fecha_compromiso: '2026-03-15', hito_id: hito.hito_id
  }, ADM));
  const t2 = toPlain(ctx.Proyectos.crearTarea({
    proyecto_id: p.proyecto_id, titulo: 'Migrar datos',
    responsable_email: 'leo@rld.cl', tamano: 'L', fecha_compromiso: '2026-05-20'
  }, ADM));
  ctx.Proyectos.editarTarea({ proyecto_id: p.proyecto_id, actividad_id: t2.actividad_id, depende_de: t1.actividad_id }, ADM);
  // Confirmar fija la fecha_compromiso (RN-710: una tarea asignada queda
  // "pendiente de confirmar" hasta que el responsable la acepta) -- sin eso no
  // tiene barra que dibujar en la Carta Gantt.
  const LEO = { email: 'leo@rld.cl', nombre: 'Leo', rol: 'DEV' };
  ctx.Actividades.confirmar({ actividad_id: t1.actividad_id, fecha_compromiso: '2026-03-15' }, LEO);
  ctx.Actividades.confirmar({ actividad_id: t2.actividad_id, fecha_compromiso: '2026-05-20' }, LEO);
  return { p, hito, t1, t2 };
}

function bufDe(r) { return Buffer.from(r.xlsx_base64, 'base64'); }

// --- primitivas OOXML -------------------------------------------------------

test('colLetraXlsx_: índice de columna a letra(s)', () => {
  const ctx = ctxConSchema();
  assert.equal(ctx.colLetraXlsx_(1), 'A');
  assert.equal(ctx.colLetraXlsx_(26), 'Z');
  assert.equal(ctx.colLetraXlsx_(27), 'AA');
  assert.equal(ctx.colLetraXlsx_(52), 'AZ');
});

test('celdaXmlXlsx_: string, número, celda vacía con estilo (barra)', () => {
  const ctx = ctxConSchema();
  // string -> inlineStr
  assert.match(ctx.celdaXmlXlsx_('A1', 'hola'), /t="inlineStr"[\s\S]*hola/);
  // número -> <v>
  assert.match(ctx.celdaXmlXlsx_('B1', { v: 5, t: 'n' }), /<v>5<\/v>/);
  // vacía con estilo -> celda auto-cerrada con s= (así se pintan las barras)
  assert.equal(ctx.celdaXmlXlsx_('C1', { s: 6 }), '<c r="C1" s="6"/>');
  // null -> sin celda
  assert.equal(ctx.celdaXmlXlsx_('D1', null), '');
  // escapa XML
  assert.match(ctx.celdaXmlXlsx_('E1', 'a & b < c'), /a &amp; b &lt; c/);
});

test('construirXlsx_ produce un ZIP (firma PK) con las partes OOXML esperadas', () => {
  const ctx = ctxConSchema();
  const blob = ctx.construirXlsx_([{ nombre: 'Uno', filas: [['x']] }, { nombre: 'Dos', filas: [['y']] }], 'prueba');
  const buf = Buffer.from(blob.getBytes().map((b) => (b < 0 ? b + 256 : b)));
  assert.equal(buf[0], 0x50); assert.equal(buf[1], 0x4b);   // "PK"
  const txt = buf.toString('utf8');
  ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']
    .forEach((parte) => assert.ok(txt.includes(parte), 'falta la parte ' + parte));
  assert.ok(txt.includes('<sheet name="Uno"') && txt.includes('<sheet name="Dos"'), 'faltan los nombres de hoja');
});

// --- el libro del proyecto --------------------------------------------------

test('descargarLibro devuelve un .xlsx con las 6 hojas del proyecto', () => {
  const ctx = ctxConSchema();
  const { p } = armarEscenario(ctx);
  const r = toPlain(ctx.Proyectos.descargarLibro({ proyecto_id: p.proyecto_id }, ADM));
  assert.ok(r.xlsx_base64, 'debe devolver el archivo en base64');
  assert.match(r.filename, /\.xlsx$/);
  const txt = bufDe(r).toString('utf8');
  ['Resumen', 'Carta Gantt', 'Tareas', 'Hitos', 'Dependencias'].forEach((n) => {
    assert.ok(txt.includes('<sheet name="' + n + '"'), 'falta la hoja ' + n);
  });
});

test('la Carta Gantt trae las tareas bajo su hito y celdas-barra con estilo de color', () => {
  const ctx = ctxConSchema();
  const { p } = armarEscenario(ctx);
  const txt = bufDe(toPlain(ctx.Proyectos.descargarLibro({ proyecto_id: p.proyecto_id }, ADM))).toString('utf8');
  // El nombre del hito y los títulos de tarea están en el libro.
  assert.ok(txt.includes('Puesta en marcha'), 'falta el nombre del hito');
  assert.ok(txt.includes('Levantar requerimientos') && txt.includes('Migrar datos'), 'faltan tareas');
  // Hay al menos una celda-barra: celda vacía con un estilo de relleno de barra
  // (4=verde .. 10=atraso). En la carta se pintan como <c r=".." s="N"/>.
  assert.match(txt, /<c r="[A-Z]+\d+" s="([4-9]|10)"\/>/, 'no hay ninguna celda-barra pintada');
  // El rombo del hito en el calendario.
  assert.ok(txt.indexOf('◆') !== -1, 'falta el ◆ del hito en la línea de tiempo');
});

test('la Dependencia sale por TÍTULO del padre, no por su id', () => {
  const ctx = ctxConSchema();
  const { p, t1 } = armarEscenario(ctx);
  const txt = bufDe(toPlain(ctx.Proyectos.descargarLibro({ proyecto_id: p.proyecto_id }, ADM))).toString('utf8');
  // Aislar la hoja de Dependencias (la única con la columna "Depende de").
  const i = txt.indexOf('Depende de');
  assert.ok(i !== -1, 'falta la hoja/columna de dependencias');
  const hojaDep = txt.slice(i, i + 600);
  // "Migrar datos" depende de "Levantar requerimientos": se muestra el TÍTULO
  // del padre, nunca su actividad_id crudo (que a quien abre el archivo no le
  // dice nada).
  assert.ok(hojaDep.includes('Levantar requerimientos'), 'la dependencia debe salir por el título del padre');
  assert.ok(hojaDep.indexOf(t1.actividad_id) === -1, 'el id del padre no debe escaparse a la celda de dependencia');
});

test('un proyecto recién creado (sin tareas) igual produce un .xlsx válido', () => {
  const ctx = ctxConSchema();
  const p = toPlain(ctx.Proyectos.crear({
    nombre: 'Recién creado', lider_email: 'leo@rld.cl', fecha_inicio: '2026-01-01', fecha_objetivo: '2026-12-01'
  }, ADM));
  const r = toPlain(ctx.Proyectos.descargarLibro({ proyecto_id: p.proyecto_id }, ADM));
  const buf = bufDe(r);
  assert.equal(buf[0], 0x50); assert.equal(buf[1], 0x4b);
  const txt = buf.toString('utf8');
  // Sin dependencias, esa hoja no aparece (no se inventa una tabla vacía).
  assert.ok(txt.includes('<sheet name="Resumen"') && txt.includes('<sheet name="Carta Gantt"'));
  assert.ok(!txt.includes('<sheet name="Dependencias"'), 'sin dependencias no debe haber hoja de dependencias');
});

test('un ajeno no puede descargar el libro (mismo gate que el PDF)', () => {
  const ctx = ctxConSchema();
  const { p } = armarEscenario(ctx);
  const r = toPlain(ctx.Proyectos.descargarLibro({ proyecto_id: p.proyecto_id }, { email: 'ajeno@x.cl', rol: 'DEV' }));
  assert.ok(r._forbidden, 'mismo gate de lectura que el PDF');
});
