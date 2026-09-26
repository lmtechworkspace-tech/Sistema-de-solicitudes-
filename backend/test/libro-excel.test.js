'use strict';

/**
 * R-4 de la auditoría de reportes: Excel real en vez de CSV. Generador compartido
 * (libroExcel.js) y acción generarExcelReporte (reporteExcel.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, agregarFila_ } = require('../db/sqliteRepo');
const { asegurarEsquema } = require('../db/schema');
const { leerZip_ } = require('../logica/xlsxZip');
const Libro = require('../logica/libroExcel');
const ReporteExcel = require('../logica/reporteExcel');

const CTX = { cuenta_id: 'c-1', email: 'ana@x.cl', rol: 'ADM' };

// leerZip_ devuelve las entradas en orden; se buscan por el nombre dentro del ZIP.
function partes_(buf) {
  const zlib = require('zlib');
  const out = {};
  let p = 0;
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const metodo = buf.readUInt16LE(p + 8), tam = buf.readUInt32LE(p + 18);
    const nlen = buf.readUInt16LE(p + 26), elen = buf.readUInt16LE(p + 28);
    const nombre = buf.slice(p + 30, p + 30 + nlen).toString('utf8');
    const datos = buf.slice(p + 30 + nlen + elen, p + 30 + nlen + elen + tam);
    out[nombre] = (metodo === 8 ? zlib.inflateRawSync(datos) : datos).toString('utf8');
    p += 30 + nlen + elen + tam;
  }
  return out;
}

test('inferir: el texto de la pantalla se vuelve valor (%, número chileno, fecha) y lo demás queda texto', () => {
  assert.deepEqual([Libro.inferir('42%').v, Libro.inferir('38,9 %').v], [0.42, 0.389]);
  assert.equal(Libro.inferir('1.234,5').v, 1234.5);
  assert.equal(Libro.inferir('1.234').v, 1234);
  assert.equal(Libro.inferir('31/12/2026').v, 46387); // serial de Excel
  assert.equal(Libro.inferir('2026-12-31').v, 46387);
  assert.equal(Libro.inferir('0012').t, 's', 'un código con ceros a la izquierda no es número');
  assert.equal(Libro.inferir('4.3').t, 's', 'una cláusula ISO no es número');
  assert.equal(Libro.inferir('—').v, '');
  assert.equal(Libro.inferir({ v: 'Atrasada', tono: 'critico' }).s, Libro.S.critico);
});

test('construirLibro: Resumen + una hoja por tabla, con filtros, fila fija, barras en % y nombres de hoja válidos', () => {
  const buf = Libro.construirLibro({
    titulo: 'Estado', meta: [['Área', 'Todas']],
    resumen: { estado: 'critico', frase: 'Frase', kpis: [{ etiqueta: 'A tiempo', valor: '20%' }], alertas: [{ severidad: 'critico', cantidad: '3', titulo: 'Ana', detalle: 'x' }] },
    hojas: [
      { nombre: 'Detalle: [pendientes]/*?', columnas: ['Tarea', 'Situación', 'Avance', 'Vence'], filas: [['T1', { v: 'Atrasada', tono: 'critico' }, '30%', '14/08/2026']] },
      { nombre: 'Resumen', columnas: ['X'], filas: [['1']] }
    ]
  });
  const p = partes_(buf);
  assert.match(p['xl/workbook.xml'], /<sheet name="Resumen"/);
  assert.match(p['xl/workbook.xml'], /<sheet name="Detalle pendientes"/, 'sin caracteres prohibidos');
  assert.match(p['xl/workbook.xml'], /<sheet name="Resumen \(datos\)"/, 'nombres únicos');
  assert.match(p['xl/workbook.xml'], /_xlnm\._FilterDatabase/);
  const hoja = p['xl/worksheets/sheet2.xml'];
  assert.match(hoja, /<autoFilter ref="A1:D2"\/>/);
  assert.match(hoja, /<pane ySplit="1"/);
  assert.match(hoja, /<conditionalFormatting sqref="C2:C2"><cfRule type="dataBar"/);
  assert.match(hoja, /<c r="C2" s="\d+"><v>0.3<\/v><\/c>/, 'el porcentaje es un número');
  assert.match(hoja, /<c r="D2" s="\d+"><v>46248<\/v><\/c>/, 'la fecha es un serial');
  assert.match(p['xl/worksheets/sheet1.xml'], /LO QUE REQUIERE DECISIÓN/);
  // Orden del esquema de Excel: sheetData → autoFilter → mergeCells → conditionalFormatting → pageMargins.
  const orden = ['<sheetData>', '<autoFilter', '<conditionalFormatting', '<pageMargins'].map((t) => hoja.indexOf(t));
  assert.deepEqual(orden.slice().sort((a, b) => a - b), orden);
});

test('construirLibro: un texto que parece fórmula queda como texto (el CSV permitía inyectar "=…")', () => {
  const p = partes_(Libro.construirLibro({ hojas: [{ nombre: 'D', columnas: ['A'], filas: [['=HYPERLINK("http://x","y")'], ['<b>&"']] }] }));
  const hoja = p['xl/worksheets/sheet2.xml'] || p['xl/worksheets/sheet1.xml'];
  assert.ok(!/<f>/.test(hoja));
  assert.match(hoja, /t="inlineStr"><is><t xml:space="preserve">=HYPERLINK/);
  assert.match(hoja, /&lt;b&gt;&amp;&quot;/);
});

test('generarExcelReporte: "Generado por" lo pone la sesión y el archivo es .xlsx con fecha', () => {
  const db = abrirDb_(':memory:');
  asegurarEsquema(db);
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'c-1', usuario: 'ana', nombre: 'Ana Pérez', emails: JSON.stringify(['ana@x.cl']), rol: 'ADM', activo: true });
  ReporteExcel._usos.clear();
  const r = ReporteExcel.generarExcelReporte(db, { titulo: 'Estado del SGC', meta: [['Generado por', 'Alguien Falso']],
    hojas: [{ nombre: 'D', columnas: ['A'], filas: [['1']] }] }, CTX);
  assert.match(r.filename, /^estado-del-sgc-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const resumen = partes_(Buffer.from(r.xlsx_base64, 'base64'))['xl/worksheets/sheet1.xml'];
  assert.match(resumen, /Ana Pérez/);
  assert.ok(!/Alguien Falso/.test(resumen));
});

test('generarExcelReporte: valida vacío, tamaño y freno por cuenta', () => {
  const db = abrirDb_(':memory:');
  asegurarEsquema(db);
  ReporteExcel._usos.clear();
  assert.equal(ReporteExcel.generarExcelReporte(db, {}, CTX)._validationError, true);
  const enorme = { hojas: [{ nombre: 'D', columnas: ['A'], filas: Array.from({ length: 160000 }, () => ['x']) }] };
  assert.match(ReporteExcel.generarExcelReporte(db, enorme, CTX).message, /demasiado grande/);
  for (let i = 0; i < 20; i++) assert.ok(ReporteExcel.generarExcelReporte(db, { hojas: [{ nombre: 'D', columnas: ['A'], filas: [['1']] }] }, CTX).xlsx_base64);
  assert.match(ReporteExcel.generarExcelReporte(db, { hojas: [{ nombre: 'D', columnas: ['A'], filas: [['1']] }] }, CTX).message, /muchos Excel/);
  ReporteExcel._usos.clear();
});

test('el ZIP del libro se puede volver a leer entero (estructura válida)', () => {
  const buf = Libro.construirLibro({ titulo: 'X', hojas: [{ nombre: 'D', columnas: ['A', 'B'], filas: [['1', '50%']] }] });
  const entradas = leerZip_(buf);
  assert.ok(Object.keys(entradas).length >= 7);
});
