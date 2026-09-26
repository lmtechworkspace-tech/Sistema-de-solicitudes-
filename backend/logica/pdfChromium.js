/**
 * pdfChromium.js — motor de PDF con Chromium (R-3 de la auditoría de reportes,
 * documentacion/SIGSO-v2-reportes-auditoria.md §5 y §7): convierte un
 * documento HTML + CSS en PDF A4. Es lo que hace que el papel sea idéntico a
 * la pantalla v2 (mismas tarjetas, colores y gráficos), en vez de dibujar cada
 * reporte a mano con pdfkit.
 *
 * Cuidado de recursos (VPS de 4 GB): UN navegador, reutilizado entre
 * documentos y cerrado tras OCIO_MS sin uso; UN documento a la vez, con una
 * cola corta (MAX_COLA) — si se llena, se responde "ocupado" en vez de
 * acumular procesos.
 *
 * Aislamiento: cada documento se abre en un contexto propio, con JavaScript
 * APAGADO y TODA la red bloqueada salvo `data:` (fuentes e imágenes van
 * incrustadas). El HTML llega del navegador del usuario (ver reportePdf.js):
 * con esto no puede ejecutar código ni pedir nada a la red ni al disco.
 *
 * Dónde está Chromium: SIGSO_CHROME_PATH o /opt/sigso/chrome/actual (en el VPS lo instala
 * backend/scripts/asegurar-chromium.sh). Sin esa variable se prueban las rutas
 * típicas de un equipo de desarrollo. Si no hay ninguno, htmlAPdf rechaza con
 * codigo 'SIN_MOTOR' y quien llama decide qué decir.
 */
const fs = require('node:fs');

const OCIO_MS = 90 * 1000;
const TIMEOUT_MS = 30 * 1000;
const MAX_COLA = 4;

const CANDIDATOS_ = [
  '/opt/sigso/chrome/actual',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

let navegador_ = null;
let lanzando_ = null;
let temporizadorOcio_ = null;
let cola_ = Promise.resolve();
let enCola_ = 0;

function error_(codigo, mensaje) {
  const e = new Error(mensaje);
  e.codigo = codigo;
  return e;
}

// Solo un ARCHIVO cuenta (sigue enlaces): una carpeta con el mismo nombre, p. ej. de
// una instalación a medias, no es un motor.
function esArchivo_(r) { try { return fs.statSync(r).isFile(); } catch (e) { return false; } }

function rutaChrome() {
  const env = process.env.SIGSO_CHROME_PATH;
  if (env) return esArchivo_(env) ? env : null;
  return CANDIDATOS_.find(esArchivo_) || null;
}

function disponible() { return !!rutaChrome(); }

async function navegador_Listo_() {
  if (navegador_ && navegador_.connected) return navegador_;
  if (lanzando_) return lanzando_;
  const ruta = rutaChrome();
  if (!ruta) throw error_('SIN_MOTOR', 'No hay un Chromium instalado para generar PDF.');
  const puppeteer = require('puppeteer-core');
  lanzando_ = puppeteer.launch({
    executablePath: ruta,
    // chrome-headless-shell es el binario liviano pensado para esto; un Chrome
    // completo (desarrollo) usa el headless nuevo.
    headless: /headless-shell/i.test(ruta) ? 'shell' : true,
    // --no-sandbox: el servicio corre sin privilegios y Ubuntu restringe los
    // user namespaces que usa el sandbox de Chromium. El aislamiento real lo
    // dan el JS apagado y la red bloqueada de cada documento.
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions',
      '--no-first-run', '--mute-audio', '--font-render-hinting=none'],
    timeout: TIMEOUT_MS
  }).then((b) => {
    navegador_ = b;
    lanzando_ = null;
    b.on('disconnected', () => { if (navegador_ === b) navegador_ = null; });
    return b;
  }, (e) => { lanzando_ = null; throw e; });
  return lanzando_;
}

function programarCierre_() {
  clearTimeout(temporizadorOcio_);
  temporizadorOcio_ = setTimeout(() => { cerrar().catch(() => {}); }, OCIO_MS);
  if (temporizadorOcio_.unref) temporizadorOcio_.unref();
}

async function cerrar() {
  clearTimeout(temporizadorOcio_);
  const b = navegador_;
  navegador_ = null;
  if (b) await b.close().catch(() => {});
}

function conTimeout_(promesa, ms) {
  let t;
  return Promise.race([promesa, new Promise((_, rej) => { t = setTimeout(() => rej(error_('TIMEOUT', 'El PDF tardó demasiado en generarse.')), ms); })])
    .finally(() => clearTimeout(t));
}

async function renderizar_(html, opts) {
  const b = await navegador_Listo_();
  const ctx = await b.createBrowserContext();
  try {
    const page = await ctx.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      const u = r.url();
      if (u.startsWith('data:') || u === 'about:blank') r.continue(); else r.abort('blockedbyclient');
    });
    await page.emulateMediaType('print');
    await page.emulateMediaFeatures([
      { name: 'prefers-color-scheme', value: 'light' },
      { name: 'prefers-reduced-motion', value: 'reduce' }
    ]);
    await page.setContent(html, { waitUntil: 'load', timeout: TIMEOUT_MS });
    const pdf = await page.pdf({
      format: 'A4',
      landscape: !!opts.horizontal,
      printBackground: true,
      margin: { top: '12mm', bottom: '16mm', left: '12mm', right: '12mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: opts.pie || '<span></span>',
      timeout: TIMEOUT_MS
    });
    return Buffer.from(pdf);
  } finally {
    await ctx.close().catch(() => {});
    programarCierre_();
  }
}

/**
 * html: documento completo (<!doctype html>…). opts: { pie (plantilla de pie
 * de Chromium, con .pageNumber/.totalPages), horizontal }. Devuelve un Buffer.
 * Rechaza con e.codigo = 'SIN_MOTOR' | 'OCUPADO' | 'TIMEOUT' | (otro).
 */
function htmlAPdf(html, opts) {
  opts = opts || {};
  if (!rutaChrome()) return Promise.reject(error_('SIN_MOTOR', 'No hay un Chromium instalado para generar PDF.'));
  if (enCola_ >= MAX_COLA) return Promise.reject(error_('OCUPADO', 'El generador de PDF está ocupado.'));
  enCola_++;
  // Si un documento se cuelga, se cierra el navegador: el siguiente arranca limpio.
  const tarea = cola_.then(() => conTimeout_(renderizar_(html, opts), TIMEOUT_MS + 5000))
    .catch((e) => { if (e && e.codigo === 'TIMEOUT') cerrar().catch(() => {}); throw e; });
  cola_ = tarea.catch(() => {});
  return tarea.finally(() => { enCola_--; });
}

module.exports = { htmlAPdf, disponible, rutaChrome, cerrar, MAX_COLA };
