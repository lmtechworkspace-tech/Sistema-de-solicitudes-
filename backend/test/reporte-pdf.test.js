'use strict';

/**
 * R-3 de la auditoría de reportes: "Descargar PDF" imprime con Chromium el
 * reporte v2 tal como se ve. Estos tests cubren lo que NO depende de tener
 * Chromium (limpieza del HTML/CSS, documento, pie firmado por el servidor,
 * validaciones, freno, errores del motor) con el motor simulado; el último
 * renderiza de verdad solo si el equipo tiene un Chromium (en CI, ubuntu-latest
 * trae Google Chrome).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { abrirDb_, agregarFila_ } = require('../db/sqliteRepo');
const { asegurarEsquema } = require('../db/schema');
const RP = require('../logica/reportePdf');
const Motor = require('../logica/pdfChromium');

const CTX = { cuenta_id: 'c-1', email: 'ana@empresa.cl', rol: 'ADM' };
function db_() { const db = abrirDb_(':memory:'); asegurarEsquema(db); return db; }

test('sanitizarHtml quita scripts, iframes, enlaces externos, on* y javascript:', () => {
  const s = RP.sanitizarHtml('<p onclick="x()">a</p><script>alert(1)</script><iframe src="file:///etc/passwd"></iframe>' +
    '<link rel="stylesheet" href="http://x/y.css"><a href="javascript:alert(1)">b</a><img src="http://127.0.0.1:3000/v1/estado">' +
    '<svg><use href="#i-check"></use></svg><img src="data:image/png;base64,AAA"><base href="http://x/"><meta http-equiv="refresh" content="0;url=http://x">');
  assert.ok(!/script|iframe|<link|onclick|javascript:|127\.0\.0\.1|<base|<meta/i.test(s), s);
  assert.ok(s.includes('href="#i-check"'), 'conserva referencias internas');
  assert.ok(s.includes('data:image/png'), 'conserva imágenes incrustadas');
  assert.ok(s.includes('<p>a</p>'));
});

test('sanitizarCss quita @import y url() que no son data:', () => {
  const c = RP.sanitizarCss("@import url(http://x/a.css);.a{background:url('http://127.0.0.1/x')}.b{background:url(data:image/png;base64,AA)}</style><script>");
  assert.ok(!/@import|127\.0\.0\.1|<\/style/i.test(c), c);
  assert.ok(c.includes('url(data:image/png'));
});

test('componerDocumento: tema claro, sin animaciones, fuente Inter incrustada y contenido limpio', () => {
  const d = RP.componerDocumento({ titulo: 'Estado <x>', css: '.k{color:red}', html: '<div class="rp2-nivel">ok</div><script>1</script>' });
  assert.ok(d.startsWith('<!doctype html>'));
  assert.ok(d.includes('data-theme="light"'));
  assert.ok(d.includes('animation:none!important'));
  assert.ok(/font-family:'Inter'.*data:font\/woff2;base64,/.test(d), 'Inter va incrustada, sin red');
  assert.ok(d.includes('<title>Estado &lt;x&gt;</title>'));
  assert.ok(d.includes('.k{color:red}') && !d.includes('<script>'));
});

test('piePagina: firmado con escape y con número de página de Chromium', () => {
  const p = RP.piePagina({ titulo: 'Pausas', generadoPor: '<b>Ana</b>', fecha: '25-09-2026' });
  assert.ok(p.includes('Generado por &lt;b&gt;Ana&lt;/b&gt;'));
  assert.ok(p.includes('class="pageNumber"') && p.includes('class="totalPages"'));
});

test('generarPdfReporte: el pie lo firma la sesión (nombre de la cuenta), no el cliente', async () => {
  const db = db_();
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'c-1', usuario: 'ana', nombre: 'Ana Pérez', emails: JSON.stringify(['ana@empresa.cl']), rol: 'ADM', activo: true });
  const orig = { htmlAPdf: Motor.htmlAPdf, disponible: Motor.disponible };
  let recibido = null;
  Motor.disponible = () => true;
  Motor.htmlAPdf = async (html, opts) => { recibido = { html, opts }; return Buffer.from('%PDF-1.7 prueba'); };
  try {
    RP._usos.clear();
    const r = await RP.generarPdfReporte(db, { html: '<p>x</p>', css: '', titulo: 'Estado del SGC', nombre_archivo: 'Estado del SGC', generado_por: 'Alguien Falso' }, CTX);
    assert.equal(Buffer.from(r.pdf_base64, 'base64').toString().slice(0, 5), '%PDF-');
    assert.match(r.filename, /^estado-del-sgc-\d{4}-\d{2}-\d{2}\.pdf$/);
    assert.ok(recibido.opts.pie.includes('Generado por Ana Pérez'));
    assert.ok(!recibido.opts.pie.includes('Alguien Falso'));
  } finally { Object.assign(Motor, orig); }
});

test('generarPdfReporte: valida contenido y tamaño', async () => {
  const db = db_();
  assert.equal((await RP.generarPdfReporte(db, { html: '   ' }, CTX))._validationError, true);
  const r = await RP.generarPdfReporte(db, { html: 'x'.repeat(1600 * 1024) }, CTX);
  assert.equal(r._validationError, true);
  assert.match(r.message, /demasiado grande/);
});

test('generarPdfReporte: sin Chromium responde un error claro (el cliente cae a Imprimir)', async () => {
  const orig = Motor.disponible;
  Motor.disponible = () => false;
  try {
    const r = await RP.generarPdfReporte(db_(), { html: '<p>x</p>' }, CTX);
    assert.equal(r._validationError, true);
    assert.equal(r.fields[0].campo, 'motor');
  } finally { Motor.disponible = orig; }
});

test('generarPdfReporte: motor ocupado o colgado → mensajes distintos, nunca una excepción', async () => {
  const orig = { htmlAPdf: Motor.htmlAPdf, disponible: Motor.disponible };
  Motor.disponible = () => true;
  try {
    for (const [codigo, re] of [['OCUPADO', /ocupado/], ['TIMEOUT', /tardó/], [undefined, /No se pudo/]]) {
      RP._usos.clear();
      Motor.htmlAPdf = async () => { const e = new Error('x'); e.codigo = codigo; throw e; };
      const r = await RP.generarPdfReporte(db_(), { html: '<p>x</p>' }, CTX);
      assert.equal(r._validationError, true);
      assert.match(r.message, re);
    }
  } finally { Object.assign(Motor, orig); }
});

test('generarPdfReporte: freno de 12 por minuto por cuenta', async () => {
  const orig = { htmlAPdf: Motor.htmlAPdf, disponible: Motor.disponible };
  Motor.disponible = () => true;
  Motor.htmlAPdf = async () => Buffer.from('%PDF-');
  try {
    RP._usos.clear();
    for (let i = 0; i < 12; i++) assert.ok((await RP.generarPdfReporte(db_(), { html: '<p>x</p>' }, CTX)).pdf_base64);
    const r = await RP.generarPdfReporte(db_(), { html: '<p>x</p>' }, CTX);
    assert.match(r.message, /muchos PDF/);
    const otra = await RP.generarPdfReporte(db_(), { html: '<p>x</p>' }, { cuenta_id: 'c-2' });
    assert.ok(otra.pdf_base64, 'el freno es por cuenta');
  } finally { Object.assign(Motor, orig); RP._usos.clear(); }
});

test('motor real (si hay Chromium): PDF válido, JS apagado y cero pedidos a la red', { skip: !Motor.disponible() && 'sin Chromium en este equipo' }, async () => {
  let pedidos = 0;
  const srv = http.createServer((q, r) => { pedidos++; r.end('x'); });
  await new Promise((ok) => srv.listen(0, ok));
  const url = 'http://127.0.0.1:' + srv.address().port;
  try {
    // A propósito SIN sanitizar: prueba el aislamiento del motor por sí solo.
    const doc = '<!doctype html><html><head><style>body{background:url(' + url + '/css)}</style></head><body><p id="x">ORIGINAL</p>' +
      '<script>document.getElementById("x").textContent="EJECUTADO";fetch("' + url + '/js")</script><img src="' + url + '/img"><iframe src="' + url + '/if"></iframe></body></html>';
    const b = await Motor.htmlAPdf(doc, {});
    assert.equal(b.slice(0, 5).toString(), '%PDF-');
    assert.equal(pedidos, 0, 'ningún pedido salió del documento');
  } finally { srv.close(); await Motor.cerrar(); }
});

test('rutaChrome: una CARPETA con el nombre del motor no cuenta (instalación a medias)', () => {
  const antes = process.env.SIGSO_CHROME_PATH;
  process.env.SIGSO_CHROME_PATH = require('node:os').tmpdir();
  try {
    assert.equal(Motor.rutaChrome(), null);
    assert.equal(Motor.disponible(), false);
  } finally {
    if (antes === undefined) delete process.env.SIGSO_CHROME_PATH; else process.env.SIGSO_CHROME_PATH = antes;
  }
});
