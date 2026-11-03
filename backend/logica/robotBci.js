'use strict';

/**
 * robotBci.js — robot que trae las cartolas del BCI Pyme (03-11-2026; «el robot que no pudimos desarrollar»).
 *
 * Hace lo mismo que hoy hace Bárbara a mano, en el PC de la oficina (con el agente del robot TGR):
 *   Banco en Línea Pyme › Cuentas › Cartola Histórica › flecha de la cartola › Exportar › Descargar Excel
 * y devuelve los Excel a SIGSO, donde entran por Finanzas › Subir archivos con su lector de siempre (revisar antes de
 * importar). El robot NO importa nada, NO lee los movimientos y NUNCA entra a transferir ni a pagar: solo Cuentas.
 *
 * Dos formas de entrar:
 *  - con la clave que la persona escribe EN ESE MOMENTO en SIGSO (como la Clave Tributaria del robot TGR): se escribe
 *    en el formulario del banco y se suelta; nunca va a un log ni a la base;
 *  - sin clave («asistido»): el robot abre el banco y espera hasta 4 minutos a que alguien entre a mano en la ventana
 *    del PC de la oficina. Así la clave no pasa por SIGSO.
 *
 * Reglas (para no bloquear la cuenta del banco):
 *  - un intento de ingreso; si el banco no acepta, se detiene y lo dice (el BCI bloquea la clave tras varios intentos);
 *  - si aparece un CAPTCHA o un aviso que no conoce, se detiene;
 *  - el navegador se ve (no se disfraza ni se esconde) y se cierra al terminar, cerrando antes la sesión del banco;
 *  - el diagnóstico de una detención lleva solo la dirección y los nombres de botones y títulos: nada de montos.
 *
 * Ruta revisada el 03-11-2026 con capturas de Bárbara (BCI Pyme): menú lateral Inicio / Mis Ventas / Cuentas ›
 * (Resumen de Cuenta, Mis Movimientos, Cartola Histórica). La cartola histórica es una tabla «Mes · Fecha · Nº de
 * cartola · Ver Cartola» (dos cartolas al mes, aprox.); la flecha abre «Detalle Cartola Histórica» con «Exportar ▲» ›
 * «Imprimir Pantalla» / «Descargar Excel». Todo lo que depende de la página está en RECETA: si el BCI cambia algo, se
 * ajusta ahí. Los tests la reemplazan por un sitio de prueba local.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const PdfChromium = require('./pdfChromium');

const RECETA = {
  inicio: 'https://www.bci.cl/corporativo/banco-en-linea/pyme',
  rechazarCookies: '#onetrust-reject-all-handler',      // la opción que no comparte datos
  rut: '#rut_aux',                                       // el banco le pone puntos y guion solo
  clave: '#clave',
  ingresar: '^ingresar$',
  menuCuentas: '^cuentas$',
  menuCartola: '^cartola hist[oó]rica$',
  detalle: 'cartola de cuenta corriente|detalle cartola',
  exportar: '^exportar',
  descargarExcel: '^descargar excel$',
  salir: '^(salir|cerrar sesi[oó]n)$',
  esperaMs: 45 * 1000,
  ingresoManualMs: 4 * 60 * 1000,
  descargaMs: 60 * 1000
};
const PASO_MS = 700;
const MAX_CARTOLAS = 6;
const MAX_BYTES = 3 * 1024 * 1024;

class Detencion extends Error {
  constructor(estado, mensaje) { super(mensaje); this.estado = estado; }
}
const espera_ = (ms) => new Promise((r) => setTimeout(r, ms));

/** RUT como se teclea en el formulario del BCI: solo cuerpo y dígito verificador (el banco pone puntos y guion). */
function rutTeclas_(rut) {
  const s = String(rut || '').replace(/[.\s-]/g, '').toUpperCase();
  return /^\d{7,8}[\dK]$/.test(s) ? s : '';
}
function host_(url) { try { return new URL(url).hostname; } catch (e) { return ''; } }
function ruta_(url) { try { const u = new URL(url); return u.hostname + u.pathname; } catch (e) { return ''; } }

/** Espera hasta que `prueba()` devuelva algo distinto de null/false. */
async function hasta_(prueba, ms, queEspero) {
  const fin = Date.now() + ms;
  for (;;) {
    let r = null;
    try { r = await prueba(); } catch (e) {
      // Mientras la página navega, leerla falla («contexto destruido»): se sigue esperando.
      if (e instanceof Detencion) throw e;
    }
    if (r) return r;
    if (Date.now() > fin) throw new Detencion('SIN_RESPUESTA', 'El banco no respondió a tiempo (' + queEspero + ').');
    await espera_(PASO_MS);
  }
}

// --- dentro de la página (se ejecuta en el navegador) ----------------------------------------
/** El elemento visible más chico cuyo texto calza con la expresión (un botón, un enlace o una opción del menú). */
function buscarTexto_(fuente) {
  const re = new RegExp(fuente, 'i');
  const vis = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const st = getComputedStyle(n);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const l = Array.from(document.querySelectorAll('a,button,[role=button],[role=menuitem],[role=tab],li,span,div,td,p,label,h1,h2,h3,h4'))
    .filter((el) => re.test(String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()) && vis(el));
  l.sort((a, b) => { const x = a.getBoundingClientRect(), y = b.getBoundingClientRect(); return x.width * x.height - y.width * y.height; });
  return l[0] || null;
}
/** Filas de la cartola histórica: las de la tabla que tienen fecha dd/mm/aaaa y número de cartola. */
function filasCartola_() {
  const out = [];
  Array.from(document.querySelectorAll('tr,[role=row]')).forEach((tr) => {
    const celdas = Array.from(tr.querySelectorAll('td,[role=cell],[role=gridcell]')).map((c) => String(c.innerText || c.textContent || '').replace(/\s+/g, ' ').trim());
    if (celdas.length < 2) return;
    const f = celdas.map((c) => /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(c)).find(Boolean);
    const n = celdas.find((c) => /^\d{1,5}$/.test(c));
    if (f && n) out.push({ fecha: f[3] + '-' + f[2] + '-' + f[1], numero: n });
  });
  return out;
}
/** La flecha («Ver Cartola») de la fila de esa cartola. */
function flechaDe_(numero, fecha) {
  const dmy = fecha.split('-').reverse().join('/');
  const tr = Array.from(document.querySelectorAll('tr,[role=row]')).find((x) => {
    const c = Array.from(x.querySelectorAll('td,[role=cell],[role=gridcell]')).map((y) => String(y.innerText || y.textContent || '').replace(/\s+/g, ' ').trim());
    return c.includes(numero) && c.includes(dmy);
  });
  if (!tr) return null;
  const l = tr.querySelectorAll('a,button,[role=button],[onclick],svg,img,i');
  if (l.length) return l[l.length - 1];
  const celdas = tr.querySelectorAll('td,[role=cell],[role=gridcell]');
  return celdas[celdas.length - 1] || tr;
}
function hayCaptcha_() {
  return !!document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"],.g-recaptcha,.h-captcha,.cf-turnstile');
}
function avisoVisible_() {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  return Array.from(document.querySelectorAll('[class*=error],[class*=alert],[id*=error],[role=alert],.invalid-feedback,[class*=mensaje]'))
    .filter(vis).map((e) => String(e.innerText || '').trim()).filter(Boolean).join(' | ').slice(0, 200);
}

// --- piezas ----------------------------------------------------------------------------------
/** En cada recuadro de la página (el banco puede usar varios): el primero que devuelva algo. */
async function enAlguno_(page, fn, ...a) {
  for (const f of page.frames()) {
    try { const r = await f.evaluate(fn, ...a); if (r && (!Array.isArray(r) || r.length)) return r; } catch (e) { /* recuadro que se fue */ }
  }
  return null;
}
/** El primer elemento que encuentre `buscar` (una función que corre en la página) en algún recuadro, o null. */
async function elemento_(page, buscar, ...a) {
  for (const f of page.frames()) {
    try {
      const h = await f.evaluateHandle(buscar, ...a);
      const el = h.asElement();
      if (el) return el;
      await h.dispose();
    } catch (e) { /* recuadro que se fue mientras se buscaba */ }
  }
  return null;
}
async function clic_(page, buscar, ...a) {
  const el = await elemento_(page, buscar, ...a);
  if (!el) return false;
  try {
    await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await el.click();
    return true;
  } catch (e) { return false; } finally { el.dispose().catch(() => null); }
}
const clicTexto_ = (page, fuente) => clic_(page, buscarTexto_, fuente);
async function hayTexto_(page, fuente) {
  const el = await elemento_(page, buscarTexto_, fuente);
  if (el) el.dispose().catch(() => null);
  return !!el;
}

function revisarAviso_(dialogo) {
  const t = dialogo.texto;
  if (!t) return;
  dialogo.texto = '';
  if (/incorrect|inv[aá]lid|no coincide|bloquead|intentos|no autorizad/i.test(t)) throw new Detencion('CLAVE_INVALIDA', 'El banco no aceptó el RUT o la clave: «' + t + '». No se reintentó (el BCI bloquea la clave tras varios intentos).');
  throw new Detencion('AVISO', 'El banco mostró un aviso: «' + t + '». El robot se detuvo sin reintentar.');
}

/** ¿Ya se entró? (ya no se está en la página de ingreso y se ve el menú de Cuentas o la cartola). */
async function adentro_(page, receta, dialogo) {
  revisarAviso_(dialogo);
  if (await enAlguno_(page, hayCaptcha_)) throw new Detencion('CAPTCHA', 'El banco pidió un CAPTCHA: el robot se detuvo. Entra a mano esta vez.');
  if (ruta_(page.url()) === ruta_(receta.inicio)) return false;
  return (await hayTexto_(page, receta.menuCartola)) || (await hayTexto_(page, receta.menuCuentas));
}

async function ingresar_(page, receta, rut, clave, alPaso, dialogo) {
  alPaso('Abriendo el Banco en Línea Pyme');
  await page.goto(receta.inicio, { waitUntil: 'domcontentloaded', timeout: receta.esperaMs });
  await espera_(1500);
  try { const c = await page.$(receta.rechazarCookies); if (c) await c.click(); } catch (e) { /* sin aviso de cookies */ }
  if (!clave) {
    // Asistido: la persona entra a mano en la ventana del PC de la oficina.
    alPaso('Esperando que alguien entre al BCI en el PC de la oficina (hasta 4 minutos)');
    try { await page.bringToFront(); } catch (e) { /* */ }
    await hasta_(() => adentro_(page, receta, dialogo), receta.ingresoManualMs, 'nadie entró al banco en el PC de la oficina')
      .catch((e) => { if (e.estado === 'SIN_RESPUESTA') throw new Detencion('SIN_INGRESO', 'Nadie entró al banco en el PC de la oficina dentro de 4 minutos.'); throw e; });
    return;
  }
  alPaso('Escribiendo el RUT y la clave');
  await page.waitForSelector(receta.rut, { visible: true, timeout: receta.esperaMs });
  await page.click(receta.rut);
  await page.type(receta.rut, rut, { delay: 60 });
  await page.click(receta.clave);
  await page.type(receta.clave, clave, { delay: 60 });
  await espera_(400);
  if (!(await clicTexto_(page, receta.ingresar))) throw new Detencion('PAGINA_DISTINTA', 'No se encontró el botón «Ingresar» del banco.');
  alPaso('Entrando al banco');
  await hasta_(async () => {
    if (await adentro_(page, receta, dialogo)) return true;
    // Sigue en el ingreso con un mensaje del banco: la clave no sirvió (un solo intento).
    if (ruta_(page.url()) === ruta_(receta.inicio)) {
      const a = await enAlguno_(page, avisoVisible_);
      if (a) throw new Detencion('CLAVE_INVALIDA', 'El banco no aceptó el ingreso: «' + a + '». No se reintentó (el BCI bloquea la clave tras varios intentos).');
    }
    return false;
  }, receta.esperaMs, 'entrada al banco');
}

async function irACartolas_(page, receta, alPaso) {
  alPaso('Abriendo Cuentas › Cartola Histórica');
  if (!(await clicTexto_(page, receta.menuCartola))) {
    if (!(await clicTexto_(page, receta.menuCuentas))) throw new Detencion('PAGINA_DISTINTA', 'Se entró al banco, pero no aparece el menú «Cuentas».');
    await hasta_(() => clicTexto_(page, receta.menuCartola), receta.esperaMs, 'opción «Cartola Histórica»');
  }
  return hasta_(() => enAlguno_(page, filasCartola_), receta.esperaMs, 'lista de cartolas');
}

/**
 * Qué cartolas traer para un mes: las de ese mes y la primera del mes siguiente (trae los últimos días del mes, que
 * quedan después de la última cartola). Sin repetir y hasta MAX_CARTOLAS.
 */
function elegir_(filas, periodo) {
  const vistas = new Set();
  const l = (filas || []).filter((f) => { const k = f.numero + '|' + f.fecha; if (vistas.has(k)) return false; vistas.add(k); return true; })
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
  const del = l.filter((f) => f.fecha.slice(0, 7) === periodo);
  const sig = l.find((f) => f.fecha.slice(0, 7) > periodo);
  return (sig && del.length ? del.concat(sig) : del).slice(-MAX_CARTOLAS);
}

/** Espera el archivo nuevo de la carpeta de descargas (sin el «.crdownload» de Chrome y con su tamaño quieto). */
async function descarga_(dir, antes, ms) {
  let previo = -1;
  return hasta_(() => {
    const nuevos = fs.readdirSync(dir).filter((n) => !antes.has(n) && !/\.(crdownload|tmp)$/i.test(n));
    if (!nuevos.length) return null;
    const p = path.join(dir, nuevos[0]), t = fs.statSync(p).size;
    if (!t || t !== previo) { previo = t; return null; }
    return p;
  }, ms, 'descarga del Excel').catch((e) => { if (e.estado === 'SIN_RESPUESTA') throw new Detencion('SIN_DESCARGA', 'El banco no entregó el Excel de la cartola.'); throw e; });
}

async function diagnostico_(page) {
  // Solo la dirección y los nombres de botones y títulos: nada de montos ni movimientos del banco.
  const d = { url: '', elementos: [] };
  try {
    d.url = ruta_(page.url());
    for (const f of page.frames()) {
      try {
        const l = await f.evaluate(() => Array.from(document.querySelectorAll('a,button,[role=button],[role=menuitem],h1,h2,h3,th'))
          .map((e) => (e.tagName.toLowerCase() + ':' + String(e.innerText || '').replace(/\s+/g, ' ').trim()).slice(0, 60))
          .filter((t) => !/\d{3}/.test(t)).slice(0, 60));
        d.elementos.push(...l);
      } catch (e) { /* */ }
    }
    d.elementos = d.elementos.slice(0, 80);
  } catch (e) { /* lo que se alcanzó a juntar */ }
  return d;
}

/**
 * Trae las cartolas de un mes. datos = { rut?, clave?, periodo: 'AAAA-MM' }. opciones = { receta, alPaso, rutaChrome }.
 * Devuelve { estado: 'OK' | motivo de detención, mensaje, archivos: [{ nombre, numero, fecha, base64 }], disponibles, diagnostico? }.
 */
async function traerCartolas(datos, opciones) {
  const o = opciones || {};
  const receta = Object.assign({}, RECETA, o.receta || {});
  const alPaso = typeof o.alPaso === 'function' ? o.alPaso : () => {};
  const periodo = String((datos && datos.periodo) || '');
  let clave = String((datos && datos.clave) || '');
  const rut = rutTeclas_(datos && datos.rut);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) return { estado: 'DATOS', mensaje: 'Falta el mes de las cartolas.', archivos: [] };
  if (clave && !rut) return { estado: 'DATOS', mensaje: 'El RUT no es válido.', archivos: [] };
  const ruta = o.rutaChrome || PdfChromium.rutaChrome();
  if (!ruta) return { estado: 'SIN_NAVEGADOR', mensaje: 'Este PC no tiene Chrome ni Edge.', archivos: [] };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigso-bci-'));
  const puppeteer = require('puppeteer-core');
  // Siempre con ventana: en modo asistido alguien entra a mano, y el banco no tiene por qué ver un navegador escondido.
  const navegador = await puppeteer.launch({
    executablePath: ruta, headless: o.oculto ? true : false, defaultViewport: null,
    args: ['--no-first-run', '--disable-extensions', '--mute-audio', '--window-size=1280,900'],
    timeout: receta.esperaMs, protocolTimeout: 90 * 1000
  });
  let page = null;
  try {
    page = (await navegador.pages())[0] || await navegador.newPage();
    const dialogo = { texto: '' };
    page.on('dialog', (d) => { dialogo.texto = String(d.message() || 'aviso sin texto').slice(0, 200); d.dismiss().catch(() => null); });
    const cdp = await page.target().createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });

    await ingresar_(page, receta, rut, clave, alPaso, dialogo);
    clave = ''; // ya se usó: no se vuelve a necesitar
    const filas = await irACartolas_(page, receta, alPaso);
    const disponibles = filas.slice(0, 24);
    const elegidas = elegir_(filas, periodo);
    if (!elegidas.length) {
      return { estado: 'SIN_CARTOLAS', mensaje: 'El banco no tiene cartolas de ' + periodo + ' (la última es la N° ' + (filas[0] ? filas[0].numero + ' del ' + filas[0].fecha : '—') + '). Si el mes no ha cerrado, sus movimientos aún no están en una cartola.', archivos: [], disponibles };
    }
    const archivos = [];
    for (let i = 0; i < elegidas.length; i++) {
      const c = elegidas[i];
      alPaso('Descargando la cartola N° ' + c.numero + ' del ' + c.fecha.split('-').reverse().join('-') + ' (' + (i + 1) + ' de ' + elegidas.length + ')');
      if (i) {
        // De vuelta a la lista: primero «atrás»; si no aparece, de nuevo por el menú (la sesión sigue).
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: receta.esperaMs }).catch(() => null);
        const ok = await hasta_(() => enAlguno_(page, filasCartola_), 8000, 'lista').catch(() => null);
        if (!ok) await irACartolas_(page, receta, () => {});
      }
      if (!(await clic_(page, flechaDe_, c.numero, c.fecha))) throw new Detencion('PAGINA_DISTINTA', 'No se pudo abrir la cartola N° ' + c.numero + '.');
      await hasta_(() => hayTexto_(page, receta.exportar), receta.esperaMs, 'detalle de la cartola N° ' + c.numero);
      const antes = new Set(fs.readdirSync(dir));
      await clicTexto_(page, receta.exportar);
      await hasta_(() => clicTexto_(page, receta.descargarExcel), 10000, 'opción «Descargar Excel»');
      const p = await descarga_(dir, antes, receta.descargaMs);
      const buf = fs.readFileSync(p);
      if (buf.length > MAX_BYTES) throw new Detencion('SIN_DESCARGA', 'El Excel de la cartola N° ' + c.numero + ' es demasiado grande.');
      const ext = (/\.(xlsx|xls)$/i.exec(p) || ['', 'xlsx'])[1].toLowerCase();
      archivos.push({ nombre: 'Cartola BCI N° ' + c.numero + ' del ' + c.fecha + '.' + ext, numero: c.numero, fecha: c.fecha, base64: buf.toString('base64') });
      fs.unlinkSync(p);
    }
    alPaso('Cerrando la sesión del banco');
    if (await clicTexto_(page, receta.salir)) await espera_(2500);
    return { estado: 'OK', mensaje: archivos.length + (archivos.length === 1 ? ' cartola descargada.' : ' cartolas descargadas.'), archivos, disponibles };
  } catch (e) {
    const estado = e instanceof Detencion ? e.estado : 'ERROR';
    const mensaje = e instanceof Detencion ? e.message : 'El robot no pudo terminar: ' + String((e && e.message) || e).slice(0, 200);
    const diagnostico = page ? await diagnostico_(page) : null;
    if (page) { try { await clicTexto_(page, receta.salir); await espera_(1500); } catch (x) { /* */ } }
    return { estado, mensaje, archivos: [], diagnostico };
  } finally {
    clave = '';
    await navegador.close().catch(() => null);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ }
  }
}

module.exports = { traerCartolas, elegir_, rutTeclas_, RECETA, MAX_CARTOLAS, disponible: () => !!PdfChromium.rutaChrome() };
