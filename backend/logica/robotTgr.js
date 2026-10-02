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
  // En orden: el primero que lleve a la pantalla de ingreso (revisado el 2-10-2026).
  inicio: [
    'https://web.tesoreria.cl/tramites-tgr/imprimir-cuotas-de-convenios-vigentes/',
    'https://tgr.gob.cl/tramites-tgr/imprimir-cuotas-de-convenios-vigentes/',
    'https://www.tgr.cl/tramites-tgr/imprimir-cuotas-de-convenios-vigentes/'
  ],
  hostsIngreso: ['autentica.tgr.cl', 'www2.sii.cl', 'zeusr.sii.cl'],
  botonClaveTributaria: '#id-button-idp-claveTributaria',
  rut: '#inputRut',
  clave: '#inputPass',
  ingresar: '#bt_ingresar',
  desafio: '#correo',
  cambioClave: '#MCurrentPass2',
  errorSii: '#btn-no-autorizado',
  // Menú "Convenios" de la TGR después del ingreso (2-10-2026): Imprimir
  // Documentos › "Cuotas convenios vigentes". OJO: en Pagar está "Cuotas DE
  // convenios vigentes", que lleva a pagar: ese nunca.
  menuCuotas: '^cuotas\\s+convenios\\s+vigentes$',
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

/** Un aviso emergente del SII o la TGR (alert): se lee y se cierra; aquí se decide qué significa. */
function revisarAviso_(dialogo) {
  const t = dialogo.texto;
  if (!t) return;
  dialogo.texto = '';
  if (/incorrect|inv[aá]lid|no coincide|no es v[aá]lid|bloquead|no autorizad|intentos/i.test(t)) throw new Detencion('CLAVE_INVALIDA', 'El SII no aceptó el RUT o la clave: "' + t + '". No se reintentó.');
  throw new Detencion('AVISO', 'La página mostró un aviso: "' + t + '". El robot se detuvo sin reintentar.');
}

async function ingresar_(page, receta, rut, clave, alPaso, dialogo) {
  // El trámite vive en varios dominios de la TGR y no todos responden igual
  // (2-10-2026: www.tgr.cl, pedido desde el servidor, mostró "la página no
  // existe"): se prueban en orden y se usa el primero que lleva al ingreso.
  const inicios = [].concat(receta.inicio);
  for (let i = 0; i < inicios.length; i++) {
    alPaso(i ? 'Probando otra dirección de la TGR' : 'Abriendo la TGR');
    const r = await page.goto(inicios[i], { waitUntil: 'domcontentloaded', timeout: receta.esperaMs }).catch(() => null);
    if (r && (r.status() === 403 || r.status() === 429)) throw new Detencion('BLOQUEADO', 'La TGR rechazó el acceso automático (código ' + r.status() + ').');
    // Pantalla de la TGR para elegir la clave (o directo el formulario del SII), o "no existe".
    const llegada = await hasta_(async () => {
      if (await hayCaptchaEnAlguno_(page)) throw new Detencion('CAPTCHA', 'La TGR pidió un CAPTCHA: el robot no lo resuelve. Usa el marcador "Enviar a SIGSO".');
      if ((await page.$(receta.botonClaveTributaria)) || (await page.$(receta.rut))) return 'ingreso';
      const t = await page.evaluate(() => (document.body ? document.body.innerText : ''));
      return /no existe|no encontrada|not found|error 404/i.test(t) ? 'no-existe' : null;
    }, receta.esperaMs, 'pantalla de ingreso').catch((e) => {
      if (e instanceof Detencion && e.estado === 'SIN_RESPUESTA' && i + 1 < inicios.length) return 'no-existe';
      throw e;
    });
    if (llegada === 'ingreso') { receta.inicioUsado = inicios[i]; break; }
    if (i + 1 === inicios.length) throw new Detencion('PAGINA_DISTINTA', 'La TGR respondió "la página no existe" en todas las direcciones conocidas del trámite.');
  }
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
    revisarAviso_(dialogo);
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

const RE_SIN_CONVENIOS = /no (posee|tiene|registra|existen|hay)[^.]{0,40}convenio|sin convenios/i;
/**
 * Espera a que aparezca algo CONCRETO: la tabla de cuotas, la lista de
 * convenios (con su columna Resolución) o el aviso de que no tiene. Una
 * palabra suelta no basta: la página de afuera dice "Resolución" en sus menús
 * y la tabla real llega después en un recuadro (2-10-2026, primera prueba).
 */
async function contenido_(page, receta) {
  let clicsMenu = 0;
  const alPasoMenu = receta._alPaso || (() => {});
  return hasta_(async () => {
    if (await hayCaptchaEnAlguno_(page)) throw new Detencion('CAPTCHA', 'La TGR pidió un CAPTCHA después del ingreso.');
    const ts = await textosDeRecuadros_(page);
    if (tablaDe_(ts) || ts.some((x) => RE_SIN_CONVENIOS.test(x.texto)) || (await resoluciones_(ts)).length) return ts;
    // Menú de convenios: Imprimir Documentos › Cuotas convenios vigentes (a lo más 2 veces por espera).
    if (clicsMenu < 2 && (await clicMenu_(page, receta))) { clicsMenu++; alPasoMenu('Abriendo "Cuotas convenios vigentes"'); }
    return null;
  }, receta.esperaMs, 'lista de convenios').catch((e) => {
    if (e instanceof Detencion && e.estado === 'SIN_RESPUESTA') throw new Detencion('PAGINA_DISTINTA', 'Se entró a la TGR, pero en ' + Math.round(receta.esperaMs / 1000) + ' s no apareció la lista de convenios ni la tabla de cuotas.');
    throw e;
  });
}
function tablaDe_(ts) {
  for (const x of ts) {
    const p = Convenios.parsearCuotas_(x.texto);
    if (p.cuotas.length) return { cuotas: p.cuotas, resolucion: (x.texto.match(/resoluci[oó]n\D{0,20}(\d{3,})/i) || [])[1] || p.folio || '' };
  }
  return null;
}
// (se ejecutan en la página) Las resoluciones: primero la columna "Resolución" de
// cualquier tabla; si no hay, enlaces o botones cuyo texto es un número (no montos ni RUT).
/** Toca el enlace del menú de convenios que lleva a imprimir cuotas (nunca el de pagar). */
async function clicMenu_(page, receta) {
  if (!receta.menuCuotas) return false;
  for (const f of page.frames()) {
    try {
      const ok = await f.evaluate((fuente) => {
        const re = new RegExp(fuente, 'i');
        const a = Array.from(document.querySelectorAll('a,button')).find((x) => re.test(String(x.innerText || x.value || '').replace(/\s+/g, ' ').trim()));
        if (!a) return false;
        if (a.removeAttribute) a.removeAttribute('target'); // que no abra otra pestaña
        a.click();
        return true;
      }, receta.menuCuotas);
      if (ok) return true;
    } catch (e) { /* recuadro que navegaba */ }
  }
  return false;
}

// Una página para PAGAR cuotas nunca se opera: ni se buscan resoluciones ni se toca nada.
function candidatos_() {
  if (/desea pagar|ir a pagar/i.test(document.body ? document.body.innerText : '')) return [];
  const limpiar = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const out = [];
  for (const tabla of Array.from(document.querySelectorAll('table'))) {
    const filas = Array.from(tabla.rows || []);
    const iEnc = filas.findIndex((r) => /resoluci/i.test(r.innerText || ''));
    if (iEnc === -1) continue;
    const col = Array.from(filas[iEnc].cells).findIndex((c) => /resoluci/i.test(c.innerText || ''));
    if (col === -1) continue;
    filas.slice(iEnc + 1).forEach((r) => { const c = r.cells[col]; const m = c && limpiar(c.innerText).match(/^\D{0,6}(\d{3,12})\D{0,3}$/); if (m) out.push(m[1]); });
  }
  if (out.length) return out;
  if (!/convenio/i.test(document.body.innerText || '') || !/resoluci/i.test(document.body.innerText || '')) return out;
  for (const el of Array.from(document.querySelectorAll('a,button,[onclick]'))) {
    const t = limpiar(el.innerText || el.value);
    const m = t.match(/^\D{0,12}(\d{3,12})\D{0,3}$/);
    if (m && t.length <= 40 && !/\$|\d\.\d{3}|-\s*[\dkK]$/.test(t)) out.push(m[1]);
  }
  return out;
}
function abrir_(res) {
  if (/desea pagar|ir a pagar/i.test(document.body ? document.body.innerText : '')) return false;
  const limpiar = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const CLIC = 'a,button,input[type=submit],input[type=button],input[type=radio],[onclick]';
  for (const tabla of Array.from(document.querySelectorAll('table'))) {
    const filas = Array.from(tabla.rows || []);
    const iEnc = filas.findIndex((r) => /resoluci/i.test(r.innerText || ''));
    if (iEnc === -1) continue;
    const col = Array.from(filas[iEnc].cells).findIndex((c) => /resoluci/i.test(c.innerText || ''));
    for (const r of filas.slice(iEnc + 1)) {
      const c = r.cells[col];
      const m = c && limpiar(c.innerText).match(/(\d{3,12})/);
      if (!m || m[1] !== res) continue;
      // El enlace o botón de la celda; si no, el de la fila; si no, la fila o la celda.
      const blanco = c.querySelector(CLIC) || r.querySelector(CLIC) || (r.getAttribute('onclick') ? r : null) || c;
      blanco.click();
      // Si es un selector (radio), luego el botón de la página: Ver / Imprimir / Consultar / Aceptar.
      if (blanco.type === 'radio') {
        const b = Array.from(document.querySelectorAll('button,input[type=submit],input[type=button],a')).find((x) => /^(ver|imprimir|consultar|aceptar|continuar)/i.test(limpiar(x.innerText || x.value)));
        if (b) b.click();
      }
      return true;
    }
  }
  const el = Array.from(document.querySelectorAll('a,button,[onclick]')).find((x) => { const t = limpiar(x.innerText || x.value); const m = t.match(/(\d{3,12})/); return m && m[1] === res && t.length <= 40; });
  if (!el) return false;
  el.click();
  return true;
}
async function resoluciones_(ts) {
  const out = [];
  for (const x of ts) {
    try { (await x.frame.evaluate(candidatos_)).forEach((t) => { if (!out.includes(t)) out.push(t); }); } catch (e) { /* */ }
  }
  return out.slice(0, MAX_CONVENIOS);
}
async function abrirResolucion_(page, res) {
  for (const f of page.frames()) {
    try { if (await f.evaluate(abrir_, res)) return true; } catch (e) { /* */ }
  }
  return false;
}

async function diagnostico_(page) {
  const d = { url: '', textos: [], captura: '' };
  try {
    const u = new URL(page.url());
    d.url = u.hostname + u.pathname;
    const ts = (await textosDeRecuadros_(page)).slice(0, 4);
    d.textos = ts.map((x) => x.texto.slice(0, 2500));
    d.elementos = [];
    for (const x of ts) {
      try {
        const l = await x.frame.evaluate(() => Array.from(document.querySelectorAll('a,button,input[type=submit],input[type=button],input[type=radio],[onclick]'))
          .map((e) => ((e.tagName === 'INPUT' ? e.type + ':' : e.tagName.toLowerCase() + ':') + String(e.innerText || e.value || '').replace(/\s+/g, ' ').trim()).slice(0, 60)).slice(0, 40));
        d.elementos.push(...l);
      } catch (e) { /* */ }
    }
    d.captura = await page.screenshot({ type: 'jpeg', quality: 50, encoding: 'base64', fullPage: true });
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
    // ventana: true (piloto en la oficina) = se ve el navegador mientras trabaja.
    headless: o.ventana ? false : (/headless-shell/i.test(ruta) ? 'shell' : true),
    defaultViewport: o.ventana ? null : undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions', '--no-first-run', '--mute-audio'],
    timeout: receta.esperaMs,
    protocolTimeout: 60 * 1000
  });
  let page = null;
  try {
    const contexto = await navegador.createBrowserContext();
    page = await contexto.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    // Un aviso emergente bloquea la página hasta que se cierra: se lee, se cierra y se decide.
    const dialogo = { texto: '' };
    page.on('dialog', (d) => { dialogo.texto = String(d.message() || 'aviso sin texto').slice(0, 200); d.dismiss().catch(() => null); });
    // Sin imágenes, fuentes ni videos: menos carga para la TGR y para el servidor.
    await page.setRequestInterception(true);
    page.on('request', (rq) => { if (['image', 'media', 'font'].includes(rq.resourceType())) rq.abort(); else rq.continue(); });

    receta._alPaso = alPaso;
    await ingresar_(page, receta, rut, clave, alPaso, dialogo);
    clave = ''; // ya se usó: no se vuelve a necesitar
    alPaso('Leyendo los convenios');
    let ts = await contenido_(page, receta);
    const directa = tablaDe_(ts);
    if (directa) return { estado: 'OK', mensaje: '1 convenio leído.', convenios: [directa] };
    const lista = await resoluciones_(ts);
    if (!lista.length) {
      const sin = ts.some((x) => RE_SIN_CONVENIOS.test(x.texto));
      if (sin) return { estado: 'OK', mensaje: 'El cliente no tiene convenios vigentes en la TGR.', convenios: [] };
      throw new Detencion('PAGINA_DISTINTA', 'Se entró a la TGR, pero la página no muestra convenios ni cuotas como se esperaba.');
    }
    const convenios = [];
    for (let i = 0; i < lista.length; i++) {
      const res = lista[i];
      alPaso('Leyendo el convenio ' + res + ' (' + (i + 1) + ' de ' + lista.length + ')');
      if (!(await abrirResolucion_(page, res))) {
        await page.goto(receta.inicioUsado || [].concat(receta.inicio)[0], { waitUntil: 'domcontentloaded', timeout: receta.esperaMs });
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
          await page.goto(receta.inicioUsado || [].concat(receta.inicio)[0], { waitUntil: 'domcontentloaded', timeout: receta.esperaMs });
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
