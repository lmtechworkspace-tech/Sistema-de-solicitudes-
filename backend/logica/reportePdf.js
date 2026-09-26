'use strict';

/**
 * reportePdf.js — "Descargar PDF" de los reportes v2 (R-3 de la auditoría de
 * reportes). El navegador manda el reporte TAL COMO SE VE (su HTML y el CSS
 * v2 que lo pinta) y aquí se imprime con Chromium (pdfChromium.js): el PDF es
 * una foto de la pantalla, con las mismas tarjetas, colores y gráficos, y cada
 * mejora de diseño vale para ambos sin mantener un segundo sistema visual.
 *
 * Qué pone el SERVIDOR y no el cliente: el pie (quién lo generó, cuándo,
 * página X de Y) sale de la sesión, y la fuente Inter va incrustada desde
 * @fontsource/inter (el servidor no descarga nada).
 *
 * Seguridad (el HTML viene del cliente): se quitan scripts, iframes, objetos,
 * enlaces a hojas externas, <base>/<meta>, atributos on* y URLs javascript:;
 * del CSS se quitan @import y url() que no sean data:. Además el motor apaga
 * el JavaScript y bloquea TODA la red (ver pdfChromium.js): esta limpieza es
 * una segunda capa, no la única. Tamaños acotados y un freno por cuenta.
 */

const fs = require('node:fs');
const path = require('node:path');
const { leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { errorValidacion } = require('./errores');
const Motor = require('./pdfChromium');

// Por debajo del límite de cuerpo de nginx en el VPS (1 MB por defecto): el mensaje
// claro lo da el servidor, no un 413 genérico. Un reporte típico pesa ~50 KB.
const MAX_HTML = 700 * 1024;
const MAX_CSS = 200 * 1024;
const POR_MINUTO = 12;

// --- Limpieza -------------------------------------------------------------------------------
const TAGS_FUERA = ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input',
  'button', 'textarea', 'select', 'template', 'noscript', 'style', 'video', 'audio', 'source', 'track', 'portal'];

function sanitizarHtml(html) {
  let s = String(html || '');
  TAGS_FUERA.forEach((t) => {
    // Con contenido (<script>…</script>) y sueltos (<link …>, <input …/>).
    s = s.replace(new RegExp('<' + t + '\\b[\\s\\S]*?<\\/' + t + '\\s*>', 'gi'), '');
    s = s.replace(new RegExp('<\\/?' + t + '\\b[^>]*>', 'gi'), '');
  });
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/\s(href|src|xlink:href|action|formaction|srcset|poster)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (m, attr, val) => {
    const v = val.replace(/^["']|["']$/g, '').trim().toLowerCase();
    return v.startsWith('data:image/') || v.startsWith('#') ? m : '';
  });
  return s;
}

function sanitizarCss(css) {
  return String(css || '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(\s*(['"]?)(?!data:)[^)]*\)/gi, 'none')
    .replace(/expression\s*\(/gi, '(')
    .replace(/<\/style/gi, '');
}

// --- Documento ------------------------------------------------------------------------------
let fuentes_ = null;
function fuentesInter_() {
  if (fuentes_ !== null) return fuentes_;
  try {
    const dir = path.join(path.dirname(require.resolve('@fontsource/inter/package.json')), 'files');
    fuentes_ = [400, 500, 600, 700].map((w) => {
      const b64 = fs.readFileSync(path.join(dir, 'inter-latin-' + w + '-normal.woff2')).toString('base64');
      return "@font-face{font-family:'Inter';font-style:normal;font-weight:" + w + ';font-display:block;src:url(data:font/woff2;base64,' + b64 + ") format('woff2')}";
    }).join('\n');
  } catch (e) {
    fuentes_ = ''; // Sin el paquete: queda la fuente de respaldo del sistema.
  }
  return fuentes_;
}

function esc_(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// En papel no hay animaciones (una tarjeta a medio aparecer saldría en blanco)
// y lo interactivo que se haya colado no se ve.
const CSS_PAPEL = [
  '*,*::before,*::after{animation:none!important;transition:none!important}',
  'html,body{margin:0;padding:0;background:#fff}',
  'body{font-family:Inter,system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
  '.sx2-entra{opacity:1!important;transform:none!important}',
  '.rp2-acciones,.rp2-filtros,.js-no-pdf,button{display:none!important}',
  // Cascarones: la cadena de ancestros del reporte (para que sus selectores apliquen),
  // sin nada que desarme la página: ni rejilla del shell, ni márgenes, ni fondos.
  '[data-rp2-cascaron]{display:block!important;position:static!important;margin:0!important;padding:0!important;' +
    'width:auto!important;max-width:none!important;min-width:0!important;height:auto!important;min-height:0!important;max-height:none!important;' +
    'overflow:visible!important;background:none!important;border:0!important;box-shadow:none!important;transform:none!important;' +
    'opacity:1!important;visibility:visible!important;filter:none!important}',
  '.rp2-pdf{padding:0}'
].join('\n');

function componerDocumento(o) {
  return '<!doctype html><html lang="es" data-theme="light"><head><meta charset="utf-8"><title>' + esc_(o.titulo) + '</title>' +
    '<style>' + fuentesInter_() + '</style>' +
    '<style>' + sanitizarCss(o.css) + '</style>' +
    '<style>' + CSS_PAPEL + '</style>' +
    '</head><body class="sx2 rp2-pdf">' + sanitizarHtml(o.html) + '</body></html>';
}

function fechaChile_(d) {
  try {
    return new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
  } catch (e) { return d.toISOString().slice(0, 16).replace('T', ' '); }
}

// Pie de Chromium: se dibuja fuera del documento, con estilos en línea y sin
// fuentes web. Lo firma el servidor con la sesión, no el cliente.
function piePagina(o) {
  return '<div style="width:100%;box-sizing:border-box;padding:0 12mm;font-family:Arial,Helvetica,sans-serif;font-size:7.5px;color:#6b7280;display:flex;justify-content:space-between;gap:12px">' +
    '<span>SIGSO · ' + esc_(o.titulo) + ' · Generado por ' + esc_(o.generadoPor || 'SIGSO') + ' el ' + esc_(o.fecha) + '</span>' +
    '<span style="white-space:nowrap">Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>';
}

function nombreArchivo_(n) {
  const base = String(n || 'sigso-reporte').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'sigso-reporte';
  // Fecha de Chile, no UTC: de noche en Santiago, UTC ya es mañana.
  let dia;
  try { dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); } catch (e) { dia = new Date().toISOString().slice(0, 10); }
  return base.replace(/\.pdf$/, '') + '-' + dia + '.pdf';
}

function nombreCuenta_(db, contexto) {
  try {
    const c = leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL).find((x) => x.cuenta_id === contexto.cuenta_id);
    return (c && String(c.nombre || c.usuario || '').trim()) || contexto.email || '';
  } catch (e) { return contexto.email || ''; }
}

// Freno por cuenta (ventana deslizante de 1 minuto, en memoria del proceso).
const usos_ = new Map();
function dentroDelFreno_(cuentaId) {
  const ahora = Date.now();
  const l = (usos_.get(cuentaId) || []).filter((t) => ahora - t < 60 * 1000);
  if (l.length >= POR_MINUTO) { usos_.set(cuentaId, l); return false; }
  l.push(ahora);
  usos_.set(cuentaId, l);
  return true;
}

/**
 * data: { html, css, titulo, nombre_archivo, horizontal }.
 * Devuelve { pdf_base64, filename } — mismo contrato que los PDF de pdfkit.
 */
async function generarPdfReporte(db, data, contexto) {
  data = data || {};
  const html = typeof data.html === 'string' ? data.html : '';
  const css = typeof data.css === 'string' ? data.css : '';
  const titulo = String(data.titulo || 'Reporte').slice(0, 160);
  if (!html.trim()) return errorValidacion('html', 'No llegó el contenido del reporte.');
  if (html.length > MAX_HTML) return errorValidacion('html', 'El reporte es demasiado grande para un PDF. Acota los filtros.');
  if (css.length > MAX_CSS) return errorValidacion('css', 'El estilo del reporte es demasiado grande.');
  if (!Motor.disponible()) return errorValidacion('motor', 'Este servidor todavía no tiene el generador de PDF. Usa "Imprimir" mientras tanto.');
  if (!dentroDelFreno_(contexto.cuenta_id || contexto.email)) return errorValidacion('motor', 'Generaste muchos PDF en el último minuto. Espera un momento.');

  const doc = componerDocumento({ html, css, titulo });
  const pie = piePagina({ titulo, generadoPor: nombreCuenta_(db, contexto), fecha: fechaChile_(new Date()) });
  try {
    const buf = await Motor.htmlAPdf(doc, { pie, horizontal: data.horizontal === true });
    return { pdf_base64: buf.toString('base64'), filename: nombreArchivo_(data.nombre_archivo || titulo) };
  } catch (e) {
    const codigo = e && e.codigo;
    if (codigo === 'OCUPADO') return errorValidacion('motor', 'El generador de PDF está ocupado. Intenta de nuevo en unos segundos.');
    if (codigo === 'SIN_MOTOR') return errorValidacion('motor', 'Este servidor todavía no tiene el generador de PDF. Usa "Imprimir" mientras tanto.');
    if (codigo === 'TIMEOUT') return errorValidacion('motor', 'El PDF tardó demasiado. Acota los filtros e intenta de nuevo.');
    console.error('[reportePdf] no se pudo generar:', e && e.message);
    return errorValidacion('motor', 'No se pudo generar el PDF. Usa "Imprimir" mientras tanto.');
  }
}

module.exports = { generarPdfReporte, sanitizarHtml, sanitizarCss, componerDocumento, piePagina, _usos: usos_ };
