'use strict';

/**
 * robotTgr.js — robot semiautomático de la TGR (2026-10-02, opción 2 del
 * dueño): con la Clave Tributaria que la persona escribe EN ESE MOMENTO, entra
 * a "Imprimir cuotas de convenios vigentes", recorre los convenios del cliente
 * y devuelve sus cuotas (n°, vencimiento, monto, pagada SÍ/NO).
 *
 * La clave NO se guarda: vive solo mientras dura esta llamada, se escribe en
 * el formulario del SII y se suelta. Nunca va a un log ni a la base.
 *
 * Reglas (para no dañar la cuenta del cliente ni saltarse controles):
 *  - un intento de ingreso por revisión; si falla, se detiene y lo dice;
 *  - si el SII pide verificar un correo o cambiar la clave, se detiene;
 *  - si aparece un CAPTCHA o la TGR rechaza el acceso (403/429), se detiene;
 *  - el navegador se identifica tal cual es (no se disfraza);
 *  - un navegador y un cliente a la vez; se cierra al terminar.
 *
 * Cómo es el ingreso (revisado el 2-10-2026):
 *  tgr.cl › trámite → autentica.tgr.cl (#id-button-idp-claveTributaria) →
 *  www2.sii.cl (#inputRut, #inputPass, #bt_ingresar) → www.tesoreria.cl, con
 *  el contenido en un recuadro (iframe) de otro origen: se lee con el
 *  protocolo del navegador, que sí entra a esos recuadros.
 *
 * Todo lo que depende de la página está en RECETA: si la TGR cambia algo, se
 * ajusta ahí. Los tests la reemplazan por un sitio de prueba local.
 */

const PdfChromium = require('./pdfChromium');
const Convenios = require('./controlInternoConvenios');

const ESPERA_MS = 45 * 1000;
const RECETA = {
  inicio: 'https://www.tgr.cl/tramites-tgr/imprimir-cuotas-de-convenios-vigentes/',
  hostsIngreso: ['autentica.tgr.cl', 'www2.sii.cl', 'zeusr.sii.cl'],
  botonClaveTributaria: '#id-button-idp-claveTributaria',
  rut: '#inputRut',
  clave: '#inputPass',
  ingresar: '#bt_ingresar',
  desafio: '#correo',
  cambioClave: '#MCurrentPass2',
  errorSii: '#btn-no-autorizado',
  esperaMs: ESPERA_MS
};
const PASO_MS = 700;
const MAX_CONVENIOS = 15;

class Detencion extends Error {
  constructor(estado, mensaje) { super(mensaje); this.estado = estado; }
}
const espera_ = (ms) => new Promise((r) => setTimeout(r, ms));

/** RUT como lo pide el formulario del SII: sin puntos, con guion. */
function rutFormulario_(rut) {
  const s = String(rut || '').replace(/[.\s]/g, '').toUpperCase();
  const m = /^(\d{7,8})-?([\dK])$/.exec(s);
  return m ? m[1] + '-' + m[2] : '';
}

// --- dentro de la página (se ejecuta en el navegador) ----------------------------------------
function visible_(sel) {
  const el = document.querySelector(sel);
  if (!el) return false;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const st = getComputedStyle(n);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
  }
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
function avisosVisibles_() {
  const vis = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const st = getComputedStyle(n);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  return Array.from(document.querySelectorAll('[class*=error],[class*=alert],[id*=error],[class*=mensaje],[role=alert],.invalid-feedback'))
    .filter(vis).map((e) => (e.innerText || '').trim()).filter(Boolean).join(' | ').slice(0, 300);
}
function hayCaptcha_() {
  return !!document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"],.g-recaptcha,.h-captcha,.cf-turnstile');
}

// --- piezas ----------------------------------------------------------------------------------
async function textosDeRecuadros_(page) {
  const out = [];
  for (const f of page.frames()) {
    try {
      const t = await f.evaluate(() => (document.body ? document.body.innerText : ''));
      if (t && t.trim()) out.push({ frame: f, texto: t });
    } catch (e) { /* recuadro que se fue mientras se leía */ }
  }
  return out;
}
async function hayCaptchaEnAlguno_(page) {
  for (const f of page.frames()) {
    try { if (await f.evaluate(hayCaptcha_)) return true; } catch (e) { /* */ }
  }
  return false;
}
function host_(url) { try { return new URL(url).hostname; } catch (e) { return ''; } }

/** Espera hasta que `prueba()` devuelva algo distinto de null/false. */
async function hasta_(prueba, ms, queEspero) {
  const fin = Date.now() + ms;
  for (;;) {
    let r = null;
    try { r = await prueba(); } catch (e) {
      // Mientras la página navega, leerla falla ("contexto destruido"): se sigue esperando.
      if (e instanceof Detencion) throw e;
    }
    if (r) return r;
    if (Date.now() > fin) throw new Detencion('SIN_RESPUESTA', 'La página no respondió a tiempo (' + queEspero + ').');
    await espera_(PASO_MS);
  }
}

async function ingresar_(page, receta, rut, clave, alPaso) {
  alPaso('Abriendo la TGR');
  const r = await page.goto(receta.inicio, { waitUntil: 'domcontentloaded', timeout: receta.esperaMs });
  if (r && (r.status() === 403 || r.status() === 429)) throw new Detencion('BLOQUEADO', 'La TGR rechazó el acceso automático (código ' + r.status() + ').');
  // Pantalla de la TGR para elegir la clave (o directo el formulario del SII).
  await hasta_(async () => {
    if (await hayCaptchaEnAlguno_(page)) throw new Detencion('CAPTCHA', 'La TGR pidió un CAPTCHA: el robot no lo resuelve. Usa el marcador "Enviar a SIGSO".');
    return (await page.$(receta.botonClaveTributaria)) || (await page.$(receta.rut));
  }, receta.esperaMs, 'pantalla de ingreso');
  if (!(await page.$(receta.rut))) {
    alPaso('Eligiendo Clave Tributaria');
    await page.click(receta.botonClaveTributaria);
    await hasta_(() => page.evaluate(visible_, receta.rut), receta.esperaMs, 'formulario del SII');
  }
  if (await hayCaptchaEnAlguno_(page)) throw new Detencion('CAPTCHA', 'El SII pidió un CAPTCHA: el robot no lo resuelve. Usa el marcador "Enviar a SIGSO".');
  alPaso('Ingresando con la Clave Tributaria');
  await page.type(receta.rut, rut, { delay: 15 });
  await page.type(receta.clave, clave, { delay: 15 });
  await page.click(receta.ingresar);
  // Un solo intento: o sale del ingreso, o se detiene diciendo por qué.
  await hasta_(async () => {
    if (!receta.hostsIngreso.includes(host_(page.url()))) return true;
    if (await page.evaluate(visible_, receta.desafio)) throw new Detencion('DESAFIO', 'El SII pide verificar un correo por intentos fallidos. Entra tú una vez al SII con esa clave; el robot no lo hará.');
    if (await page.evaluate(visible_, receta.cambioClave)) throw new Detencion('CAMBIO_CLAVE', 'El SII pide cambiar la Clave Tributaria del cliente. El robot no cambia claves: hazlo con el cliente y vuelve a intentar.');
    if (await page.evaluate(visible_, receta.errorSii)) throw new Detencion('ERROR_SII', 'El SII respondió con un error. Prueba más tarde.');
    const aviso = await page.evaluate(avisosVisibles_);
    if (aviso && /incorrect|inv[aá]lid|no coincide|no es v[aá]lid|bloquead|no autorizad/i.test(aviso)) throw new Detencion('CLAVE_INVALIDA', 'El SII no aceptó el RUT o la clave: "' + aviso + '". No se reintentó.');
    if (await hayCaptchaEnAlguno_(page)) throw new Detencion('CAPTCHA', 'El SII pidió un CAPTCHA: el robot no lo resuelve.');
    return false;
  }, receta.esperaMs, 'respuesta del ingreso');
}

const RE_CONTENIDO = /pagada|resoluci[oó]n|no (posee|tiene|registra|existen|hay)|sin convenios/i;

async function contenido_(page, receta) {
  return hasta_(async () => {
    if (await hayCaptchaEnAlguno_(page)) throw new Detencion('CAPTCHA', 'La TGR pidió un CAPTCHA después del ingreso.');
    const ts = await textosDeRecuadros_(page);
    return ts.some((x) => RE_CONTENIDO.test(x.texto)) ? ts : null;
  }, receta.esperaMs, 'lista de convenios');
}
function tablaDe_(ts) {
  for (const x of ts) {
    const p = Convenios.parsearCuotas_(x.texto);
    if (p.cuotas.length) return { cuotas: p.cuotas, resolucion: (x.texto.match(/resoluci[oó]n\D{0,20}(\d{3,})/i) || [])[1] || p.folio || '' };
  }
  return null;
}
/** Números que parecen resoluciones: enlaces con solo dígitos en los recuadros. */
async function resoluciones_(ts) {
  const out = [];
  for (const x of ts) {
    try {
      const l = await x.frame.evaluate(() => Array.from(document.querySelectorAll('a')).map((a) => (a.textContent || '').trim()).filter((t) => /^\d{3,12}$/.test(t)));
      l.forEach((t) => { if (!out.includes(t)) out.push(t); });
    } catch (e) { /* */ }
  }
  return out.slice(0, MAX_CONVENIOS);
}
async function abrirResolucion_(page, res) {
  for (const f of page.frames()) {
    try {
      const ok = await f.evaluate((t) => {
        const a = Array.from(document.querySelectorAll('a')).find((x) => (x.textContent || '').trim() === t);
        if (!a) return false;
        a.click();
        return true;
      }, res);
      if (ok) return true;
    } catch (e) { /* */ }
  }
  return false;
}

async function diagnostico_(page) {
  const d = { url: '', textos: [], captura: '' };
  try {
    const u = new URL(page.url());
    d.url = u.hostname + u.pathname;
    d.textos = (await textosDeRecuadros_(page)).map((x) => x.texto.slice(0, 2500)).slice(0, 4);
    d.captura = await page.screenshot({ type: 'jpeg', quality: 55, encoding: 'base64', fullPage: false });
  } catch (e) { /* lo que se alcanzó a juntar */ }
  return d;
}

/**
 * Revisa un cliente. datos = { rut, clave }. opciones = { receta, alPaso, navegador }.
 * Devuelve { estado: 'OK' | motivo de detención, mensaje, convenios: [{ resolucion, cuotas }], diagnostico? }.
 */
async function revisarCliente(datos, opciones) {
  const o = opciones || {};
  const receta = Object.assign({}, RECETA, o.receta || {});
  const alPaso = typeof o.alPaso === 'function' ? o.alPaso : () => {};
  const rut = rutFormulario_(datos && datos.rut);
  let clave = String((datos && datos.clave) || '');
  if (!rut) return { estado: 'DATOS', mensaje: 'El RUT no es válido.', convenios: [] };
  if (!clave) return { estado: 'DATOS', mensaje: 'Falta la Clave Tributaria.', convenios: [] };
  const ruta = o.rutaChrome || PdfChromium.rutaChrome();
  if (!ruta) return { estado: 'SIN_NAVEGADOR', mensaje: 'El servidor no tiene el navegador del robot instalado.', convenios: [] };

  const puppeteer = require('puppeteer-core');
  const navegador = await puppeteer.launch({
    executablePath: ruta,
    headless: /headless-shell/i.test(ruta) ? 'shell' : true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions', '--no-first-run', '--mute-audio'],
    timeout: receta.esperaMs
  });
  let page = null;
  try {
    const contexto = await navegador.createBrowserContext();
    page = await contexto.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    // Sin imágenes, fuentes ni videos: menos carga para la TGR y para el servidor.
    await page.setRequestInterception(true);
    page.on('request', (rq) => { if (['image', 'media', 'font'].includes(rq.resourceType())) rq.abort(); else rq.continue(); });

    await ingresar_(page, receta, rut, clave, alPaso);
    clave = ''; // ya se usó: no se vuelve a necesitar
    alPaso('Leyendo los convenios');
    let ts = await contenido_(page, receta);
    const directa = tablaDe_(ts);
    if (directa) return { estado: 'OK', mensaje: '1 convenio leído.', convenios: [directa] };
    const lista = await resoluciones_(ts);
    if (!lista.length) {
      const sin = ts.some((x) => /no (posee|tiene|registra|existen|hay)[^.]{0,40}convenio|sin convenios/i.test(x.texto));
      if (sin) return { estado: 'OK', mensaje: 'El cliente no tiene convenios vigentes en la TGR.', convenios: [] };
      throw new Detencion('PAGINA_DISTINTA', 'Se entró a la TGR, pero la página no muestra convenios ni cuotas como se esperaba.');
    }
    const convenios = [];
    for (let i = 0; i < lista.length; i++) {
      const res = lista[i];
      alPaso('Leyendo el convenio ' + res + ' (' + (i + 1) + ' de ' + lista.length + ')');
      if (!(await abrirResolucion_(page, res))) {
        await page.goto(receta.inicio, { waitUntil: 'domcontentloaded', timeout: receta.esperaMs });
        await contenido_(page, receta);
        if (!(await abrirResolucion_(page, res))) throw new Detencion('PAGINA_DISTINTA', 'No se pudo abrir el convenio ' + res + '.');
      }
      const t = await hasta_(async () => tablaDe_(await textosDeRecuadros_(page)), receta.esperaMs, 'cuotas del convenio ' + res);
      convenios.push({ resolucion: res, cuotas: t.cuotas });
      if (i + 1 < lista.length) {
        // Volver a la lista: primero "atrás" dentro de la página; si no, se abre el trámite de nuevo (la sesión sigue).
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: receta.esperaMs }).catch(() => null);
        ts = await contenido_(page, receta).catch(() => null);
        if (!ts || !(await resoluciones_(ts)).includes(lista[i + 1])) {
          await page.goto(receta.inicio, { waitUntil: 'domcontentloaded', timeout: receta.esperaMs });
          await contenido_(page, receta);
        }
      }
    }
    return { estado: 'OK', mensaje: convenios.length + (convenios.length === 1 ? ' convenio leído.' : ' convenios leídos.'), convenios };
  } catch (e) {
    const estado = e instanceof Detencion ? e.estado : 'ERROR';
    const mensaje = e instanceof Detencion ? e.message : 'El robot no pudo terminar: ' + String((e && e.message) || e).slice(0, 200);
    return { estado, mensaje, convenios: [], diagnostico: page ? await diagnostico_(page) : null };
  } finally {
    clave = '';
    await navegador.close().catch(() => null);
  }
}

/**
 * Las cuotas leídas, escritas como la página de la TGR con su folio, para
 * pasarlas por el mismo "Recibir desde la TGR" (revisar, asignar, aplicar).
 */
function comoTexto(convenios) {
  const dmy = (f) => f.split('-').reverse().join('-');
  return (convenios || []).map((c) => (c.resolucion ? 'Folio N°: ' + c.resolucion + '\n' : '') + 'Cuota\tFecha de Vencimiento\tMonto ($)\tPagada\n' +
    c.cuotas.map((q) => q.n + '\t' + dmy(q.vencimiento) + '\t' + Math.round(q.monto).toLocaleString('es-CL') + '\t' + q.tgr).join('\n')).join('\n\n');
}

module.exports = { revisarCliente, comoTexto, rutFormulario_, RECETA, disponible: () => !!PdfChromium.rutaChrome() };
