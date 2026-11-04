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
  // Respuesta del banco cuando no acepta el ingreso (03-11-2026: www.bci.cl/pyme/clave-invalida, «Autentificación
  // incorrecta · Reintentar»). Se reconoce por la dirección o por el título, y se detiene AL TIRO, sin reintentar.
  rechazoRuta: 'clave-invalida|clave-bloqueada|bloqueo|error-autenti',
  rechazoTexto: '^(autentificaci[oó]n incorrecta|autenticaci[oó]n incorrecta|clave (bloqueada|incorrecta|inv[aá]lida)|usuario bloqueado)',
  // Tras un ingreso correcto el BCI ofrece registrar el navegador (03-11-2026: login.bci.cl/.../dispositivo-confianza,
  // «Registra tu Dispositivo de confianza · Omitir · Ir a registrar»). El robot SIEMPRE omite: el navegador del robot
  // no queda como dispositivo de confianza de nadie.
  dispositivoTitulo: 'dispositivo de confianza',
  omitir: '^omitir$',
  // Si el usuario del banco tiene varias empresas, el BCI pregunta con cuál entrar (03-11-2026: bel.bci.cl/
  // LoginJSFGenerico, «Convenios Relacionados al Usuario», tabla Convenio · Rol · Rut · Razón Social).
  conveniosTitulo: 'convenios relacionados',
  continuar: '^(continuar|aceptar|ingresar|seleccionar|entrar)$',
  // Páginas que todavía son parte del ingreso (después de ellas viene el portal). Fuera de estas y con la página quieta
  // `quietoMs`, el robot da por hecho que entró y busca el menú (y si no lo encuentra, dice dónde quedó).
  rutasIngreso: 'bci\\.cl/corporativo/banco-en-linea|login\\.bci\\.cl|loginjsf|clave-invalida|dispositivo-confianza',
  quietoMs: 20 * 1000,
  abrirMenu: '^(men[uú]|☰|≡)$',                          // menú plegado (ventana angosta)
  esperaMs: 45 * 1000,
  // Desde «Ingresar» hasta ver Cuentas: incluye «dispositivo de confianza» y «Convenios» (más lento que una página).
  entradaMs: 2 * 60 * 1000,
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
/** 781943940 → 78.194.394-0 (para los mensajes). */
function rutLegible_(r) {
  const s = String(r || '');
  return s.length < 2 ? s : s.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + s.slice(-1);
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
// OJO (04-11-2026, revisión a fondo): las páginas nuevas del banco pueden armar su contenido con «componentes»
// (shadow DOM), donde document.querySelectorAll NO entra: el robot no veía «Cuentas» aunque estuviera en pantalla.
// Por eso cada función de página busca con `todos` (documento + cada shadow root abierto). Va repetido en cada una
// porque cada función viaja sola al navegador.
/** El elemento visible más chico cuyo texto calza con la expresión (un botón, un enlace o una opción del menú). */
function buscarTexto_(fuente) {
  const todos = (s) => { const o = []; const w = (r) => { r.querySelectorAll(s).forEach((e) => o.push(e)); r.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) w(e.shadowRoot); }); }; w(document); return o; };
  const re = new RegExp(fuente, 'i');
  const vis = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const st = getComputedStyle(n);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const l = todos('a,button,[role=button],[role=menuitem],[role=tab],[role=link],li,span,div,td,p,label,h1,h2,h3,h4')
    .filter((el) => re.test(String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()) && vis(el));
  l.sort((a, b) => { const x = a.getBoundingClientRect(), y = b.getBoundingClientRect(); return x.width * x.height - y.width * y.height; });
  return l[0] || null;
}
/** Filas de la cartola histórica: las de la tabla que tienen fecha dd/mm/aaaa y número de cartola. */
function filasCartola_() {
  const todos = (s) => { const o = []; const w = (r) => { r.querySelectorAll(s).forEach((e) => o.push(e)); r.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) w(e.shadowRoot); }); }; w(document); return o; };
  const out = [];
  todos('tr,[role=row]').forEach((tr) => {
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
  const todos = (s) => { const o = []; const w = (r) => { r.querySelectorAll(s).forEach((e) => o.push(e)); r.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) w(e.shadowRoot); }); }; w(document); return o; };
  const dmy = fecha.split('-').reverse().join('/');
  const tr = todos('tr,[role=row]').find((x) => {
    const c = Array.from(x.querySelectorAll('td,[role=cell],[role=gridcell]')).map((y) => String(y.innerText || y.textContent || '').replace(/\s+/g, ' ').trim());
    return c.includes(numero) && c.includes(dmy);
  });
  if (!tr) return null;
  const l = tr.querySelectorAll('a,button,[role=button],[onclick],svg,img,i');
  if (l.length) return l[l.length - 1];
  const celdas = tr.querySelectorAll('td,[role=cell],[role=gridcell]');
  return celdas[celdas.length - 1] || tr;
}
/**
 * ¿Hay un CAPTCHA que pide algo a una persona (la casilla «No soy un robot» o el desafío de imágenes)? El reCAPTCHA
 * INVISIBLE que el BCI tiene en todas sus páginas (03-11-2026: también en /pyme/clave-invalida) no pide nada y no cuenta.
 */
function hayCaptcha_() {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 30 && r.height > 30 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).opacity !== '0'; };
  return Array.from(document.querySelectorAll('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"],iframe[src*="challenges.cloudflare"]')).some((f) => {
    const src = String(f.getAttribute('src') || '');
    if (/size=invisible/i.test(src) || f.closest('.grecaptcha-badge')) return false;
    return vis(f);
  });
}
/** Filas de «Convenios Relacionados al Usuario»: la tabla con columnas Rut y Razón Social. RUT solo dígitos y DV. */
function convenios_() {
  const limpio = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  for (const tabla of Array.from(document.querySelectorAll('table'))) {
    // Títulos de columna: los <th>; si la tabla no los usa (JSF), la primera fila.
    let cab = Array.from(tabla.querySelectorAll('th')).map((th) => limpio(th.innerText).toLowerCase());
    if (!cab.some((c) => /^rut/.test(c))) { const f = tabla.querySelector('tr'); cab = f ? Array.from(f.children).map((c) => limpio(c.innerText).toLowerCase()) : []; }
    const iRut = cab.findIndex((c) => /^rut/.test(c)), iRazon = cab.findIndex((c) => /raz[oó]n/.test(c));
    if (iRut === -1) continue;
    const filas = Array.from(tabla.querySelectorAll('tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => limpio(td.innerText)))
      .filter((c) => c.length > iRut && /\d/.test(c[iRut]))
      .map((c) => ({ rut: c[iRut].replace(/[^0-9kK]/g, '').toUpperCase(), razon: iRazon !== -1 ? (c[iRazon] || '') : '' }));
    if (filas.length) return filas;
  }
  return [];
}
/** Lo que se aprieta para entrar con esa empresa: su enlace, botón u opción; si no hay, la celda de la razón social. */
// 03-11-2026: en el BCI real el primer clic en la fila no avanzó; no se sabe aún qué se aprieta (página JSF). Se
// prueban, de a uno por intento, los candidatos de la fila: opciones, enlaces y botones, celdas con acción, la fila.
function convenioDe_(rut, i) {
  const limpio = (t) => String(t || '').replace(/[^0-9kK]/g, '').toUpperCase();
  const tr = Array.from(document.querySelectorAll('tr')).find((x) => Array.from(x.querySelectorAll('td')).some((td) => limpio(td.innerText) === rut));
  if (!tr) return null;
  const l = [];
  const sumar = (e) => { if (e && l.indexOf(e) === -1) l.push(e); };
  // 04-11-2026, recorrido real: lo que funciona es el enlace con el número de convenio (a#conveniosForm:lista:N:linkConvenio).
  tr.querySelectorAll('a[id*="linkConvenio" i]').forEach(sumar);
  tr.querySelectorAll('input[type=radio],input[type=checkbox]').forEach(sumar);
  tr.querySelectorAll('a,button,[role=button],[role=link],[onclick]').forEach(sumar);
  if (tr.hasAttribute('onclick') || getComputedStyle(tr).cursor === 'pointer') sumar(tr);
  Array.from(tr.querySelectorAll('td')).filter((td) => getComputedStyle(td).cursor === 'pointer').forEach(sumar);
  Array.from(tr.querySelectorAll('td')).reverse().forEach(sumar); // al final, cada celda (la razón social primero)
  return l[i] || null;
}
/** Cómo es la fila de esa empresa (para ajustar el robot): solo etiquetas y tipos de acción, nunca textos ni montos. */
function filaConvenio_(rut) {
  const limpio = (t) => String(t || '').replace(/[^0-9kK]/g, '').toUpperCase();
  const tr = Array.from(document.querySelectorAll('tr')).find((x) => Array.from(x.querySelectorAll('td')).some((td) => limpio(td.innerText) === rut));
  if (!tr) return [];
  const desc = (e) => e.tagName.toLowerCase() + (e.type ? '[' + e.type + ']' : '') + (e.getAttribute('href') ? ' href=' + (/^(#|javascript)/i.test(e.getAttribute('href')) ? e.getAttribute('href').slice(0, 12) : 'url') : '') +
    (e.hasAttribute('onclick') ? ' onclick' : '') + (getComputedStyle(e).cursor === 'pointer' ? ' mano' : '');
  return ['fila: ' + desc(tr)].concat(Array.from(tr.querySelectorAll('td,a,button,input,[onclick],[role=button],[role=link],img,i,svg,span')).slice(0, 25).map(desc));
}
/** ¿La página tiene reCAPTCHA invisible? (solo para el diagnóstico: el banco evalúa el navegador sin pedir nada). */
function hayCaptchaInvisible_() {
  return !!document.querySelector('.grecaptcha-badge,iframe[src*="recaptcha"][src*="size=invisible"]');
}
function avisoVisible_() {
  const todos = (s) => { const o = []; const w = (r) => { r.querySelectorAll(s).forEach((e) => o.push(e)); r.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) w(e.shadowRoot); }); }; w(document); return o; };
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  return todos('[class*=error],[class*=alert],[id*=error],[role=alert],.invalid-feedback,[class*=mensaje]')
    .filter(vis).map((e) => String(e.innerText || '').trim()).filter(Boolean).join(' | ').slice(0, 200);
}

/** ¿Algún título o alerta visible dice esto? (solo títulos: un enlace «¿Clave bloqueada?» del ingreso no cuenta). */
function tituloCalza_(fuente) {
  const todos = (s) => { const o = []; const w = (r) => { r.querySelectorAll(s).forEach((e) => o.push(e)); r.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) w(e.shadowRoot); }); }; w(document); return o; };
  const re = new RegExp(fuente, 'i');
  return todos('h1,h2,h3,[role=heading],[role=alert],[role=alertdialog]')
    .some((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && re.test(String(e.innerText || '').replace(/\s+/g, ' ').trim()); });
}
/**
 * Los campos visibles del formulario de ingreso, para ajustar la receta: tipo, id, nombre, etiqueta, largo máximo y
 * cuántos caracteres tiene escritos. NUNCA su contenido.
 */
function camposIngreso_() {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const etiqueta = (el) => {
    const l = (el.id && document.querySelector('label[for="' + el.id + '"]')) || el.closest('label');
    return String((l && l.innerText) || el.getAttribute('aria-label') || el.placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  };
  return Array.from(document.querySelectorAll('input,select,textarea'))
    .filter((e) => !/^(hidden|submit|button|image|reset|file)$/i.test(e.type || '') && vis(e))
    .map((e) => ({ tag: e.tagName.toLowerCase(), tipo: e.type || '', id: e.id || '', nombre: e.name || '', etiqueta: etiqueta(e),
      maximo: e.maxLength > 0 ? e.maxLength : 0, escrito: String(e.value || '').length, marcado: !!e.checked }))
    .slice(0, 20);
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
/** Clic «desde la página» (element.click()): sirve cuando algo encima tapa el elemento o el banco escucha solo el evento. */
async function clicDirecto_(page, buscar, ...a) {
  const el = await elemento_(page, buscar, ...a);
  if (!el) return false;
  try { await el.evaluate((e) => { e.scrollIntoView({ block: 'center' }); e.click(); }); return true; } catch (e) { return false; } finally { el.dispose().catch(() => null); }
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

const MSJ_RECHAZO = 'El BCI respondió «Autentificación incorrecta»: no aceptó el RUT o la clave. No se reintentó (el BCI bloquea la clave tras varios intentos). Antes de volver a probar, entra una vez a mano al banco.';

/** ¿El banco ya dijo que no? (la página «clave inválida» o su título). */
async function rechazo_(page, receta) {
  if (receta.rechazoRuta && new RegExp(receta.rechazoRuta, 'i').test(ruta_(page.url()))) return true;
  return !!(receta.rechazoTexto && await enAlguno_(page, tituloCalza_, receta.rechazoTexto));
}

/** ¿Es la página «Convenios Relacionados al Usuario»? Por su texto (sea o no encabezado) y su tabla de empresas. */
async function enConvenios_(page, receta) {
  if (!((await enAlguno_(page, convenios_)) || []).length) return false;
  return !!((await enAlguno_(page, tituloCalza_, receta.conveniosTitulo)) || (await hayTexto_(page, receta.conveniosTitulo)));
}

/** ¿Ya se entró? (ya no se está en la página de ingreso y se ve el menú de Cuentas o la cartola). */
async function adentro_(page, receta, dialogo) {
  revisarAviso_(dialogo);
  // Primero el rechazo: la página «clave inválida» del BCI también trae su reCAPTCHA invisible.
  if (await rechazo_(page, receta)) throw new Detencion('CLAVE_INVALIDA', MSJ_RECHAZO);
  if (await enAlguno_(page, hayCaptcha_)) throw new Detencion('CAPTCHA', 'El banco pidió un CAPTCHA (la casilla «No soy un robot» o imágenes): el robot se detuvo. Entra a mano esta vez.');
  // «Registra tu Dispositivo de confianza»: se omite (unas pocas veces como máximo, por si pide confirmar).
  if (receta.dispositivoTitulo && await enAlguno_(page, tituloCalza_, receta.dispositivoTitulo)) {
    dialogo.omitidos = (dialogo.omitidos || 0) + 1;
    if (dialogo.omitidos > 5) throw new Detencion('PAGINA_DISTINTA', 'El banco insiste en «Registra tu Dispositivo de confianza» y el robot no pudo omitirlo. Entra a mano esta vez y elige «Omitir».');
    if (!(await clicTexto_(page, receta.omitir))) throw new Detencion('PAGINA_DISTINTA', 'El banco pidió registrar un dispositivo de confianza y no se encontró «Omitir». El robot no registra dispositivos.');
    await espera_(1500);
    return false;
  }
  // «Convenios Relacionados al Usuario»: se entra con la empresa pedida (o con la única que haya).
  // 04-11-2026, recorrido real: en el BCI ese título NO es un encabezado (h1-h3), así que el robot no reconocía la
  // página y se quedaba 2 minutos sin hacer nada. Se reconoce por la tabla de empresas (Rut · Razón Social).
  const filas = receta.conveniosTitulo ? ((await enAlguno_(page, convenios_)) || []) : [];
  if (filas.length && await enConvenios_(page, receta)) {
    const lista = filas.map((f) => (f.razon || 'sin nombre') + ' (' + rutLegible_(f.rut) + ')').join(' · ');
    const pedida = dialogo.rutEmpresa ? rutTeclas_(dialogo.rutEmpresa) : '';
    const fila = pedida ? filas.find((f) => f.rut === pedida) : (filas.length === 1 ? filas[0] : null);
    if (pedida && !fila) throw new Detencion('EMPRESA', 'Ese usuario del banco no tiene la empresa ' + rutLegible_(pedida) + '. Sus empresas son: ' + lista + '.');
    if (!fila) {
      if (dialogo.asistido) return false; // entrada a mano: la persona elige la empresa en la ventana
      throw new Detencion('EMPRESA', 'Ese usuario del banco tiene varias empresas: ' + lista + '. Escribe en «RUT de la empresa» con cuál entrar.');
    }
    // Cada intento prueba un candidato de la fila: primero con el mouse y, si no avanzó, con un clic directo.
    const n = dialogo.convenios = (dialogo.convenios || 0) + 1;
    const i = Math.floor((n - 1) / 2), directo = (n - 1) % 2 === 1;
    const sinSalida = 'No se pudo entrar con la empresa ' + rutLegible_(fila.rut) + ' en «Convenios Relacionados al Usuario» (se probaron ' + (n - 1) + ' formas). Revisa «Para ajustar el robot» y entra a mano esta vez.';
    if (n > 16) throw new Detencion('PAGINA_DISTINTA', sinSalida);
    if (dialogo.alPaso) dialogo.alPaso('Eligiendo la empresa ' + (fila.razon || rutLegible_(fila.rut)) + ' (intento ' + n + ')');
    const ok = directo ? await clicDirecto_(page, convenioDe_, fila.rut, i) : await clic_(page, convenioDe_, fila.rut, i);
    if (!ok && !(await elemento_(page, convenioDe_, fila.rut, i))) throw new Detencion('PAGINA_DISTINTA', sinSalida);
    await espera_(1200);
    await clicTexto_(page, receta.continuar); // si la elección pide confirmar
    // Se da tiempo a que el banco cambie de página antes de probar otra forma.
    await hasta_(async () => !(await enConvenios_(page, receta)), 6000, 'empresa').catch(() => null);
    return false;
  }
  if (ruta_(page.url()) === ruta_(receta.inicio)) { dialogo.fueraDesde = 0; return false; }
  if ((await hayTexto_(page, receta.menuCartola)) || (await hayTexto_(page, receta.menuCuentas))) return true;
  // 04-11-2026: antes, si después de entrar el robot no veía «Cuentas», esperaba hasta agotar el plazo y decía «el
  // banco no respondió (entrada al banco)», sin saber dónde estaba. Ahora: fuera de las páginas de ingreso y quieto un
  // rato, se da por adentro y se busca el menú (irACartolas_), que si falla dice en qué página quedó.
  if (receta.rutasIngreso && new RegExp(receta.rutasIngreso, 'i').test(ruta_(page.url()))) { dialogo.fueraDesde = 0; return false; }
  if (!dialogo.fueraDesde) dialogo.fueraDesde = Date.now();
  return Date.now() - dialogo.fueraDesde > (receta.quietoMs || 20000) ? 'sin-menu' : false;
}
/** Un botón de menú plegado («hamburguesa»): por su etiqueta accesible. */
function botonMenu_() {
  const todos = (s) => { const o = []; const w = (r) => { r.querySelectorAll(s).forEach((e) => o.push(e)); r.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) w(e.shadowRoot); }); }; w(document); return o; };
  return todos('button,[role=button],a').find((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && /men[uú]|navegaci[oó]n/i.test(String(e.getAttribute('aria-label') || e.title || ''));
  }) || null;
}
/**
 * Graba los clics que se hacen en la página (de la persona en la entrada a mano, y los del robot): solo la etiqueta
 * del elemento y su texto corto, con los dígitos tapados (#). Nunca lo escrito ni montos. Sale por la consola.
 */
function grabarClics_() {
  if (window.__sigsoGrabando) return;
  window.__sigsoGrabando = true;
  document.addEventListener('click', (ev) => {
    try {
      const t = (ev.composedPath && ev.composedPath()[0]) || ev.target;
      const el = t && t.closest ? (t.closest('a,button,[role=button],[role=menuitem],[role=link],[role=tab],li,td,tr,label') || t) : t;
      if (!el || !el.tagName) return;
      const txt = /^(input|textarea|select)$/i.test(el.tagName) ? '' : String(el.innerText || el.getAttribute('aria-label') || el.title || '').replace(/\s+/g, ' ').trim().replace(/\d/g, '#').slice(0, 40);
      const raiz = el.getRootNode && el.getRootNode();
      console.debug('__sigso_clic ' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : '') +
        (txt ? ' «' + txt + '»' : '') + (raiz && raiz !== document ? ' (dentro de un componente)' : '') + (window.top !== window ? ' (en un recuadro)' : ''));
    } catch (e) { /* grabar nunca molesta a la página */ }
  }, true);
}

/** Escribe en un campo desde cero (borra lo que hubiera, p. ej. un autocompletado). */
async function escribir_(page, selector, texto) {
  await page.click(selector, { clickCount: 3 });
  await page.$eval(selector, (e) => { e.value = ''; });
  await page.type(selector, texto, { delay: 70 });
}
/** El RUT tal como quedó en el campo, solo cuerpo y dígito (sin puntos ni guion). */
const rutEscrito_ = (v) => String(v || '').replace(/[^0-9kK]/g, '').toUpperCase();

/**
 * Muestra las ventanas de Chrome que estén ocultas (Windows). 04-11-2026, CAUSA de las fallas: el robot arranca con
 * Windows SIN ventana (wscript … , 0) y Chrome hereda ese modo: su ventana existía pero OCULTA (comprobado en el PC:
 * IsWindowVisible = False). La persona veía una ventana en blanco y no podía entrar a mano, y Chrome trata una página
 * oculta como de fondo (la frena), así que con clave el portal del banco tampoco terminaba de armarse. Se muestran con
 * ShowWindow (SW_RESTORE): solo las ventanas de ESTE Chrome (por su número de proceso). Devuelve cuántas mostró.
 */
function mostrarVentanas_(pid) {
  if (process.platform !== 'win32' || !pid) return Promise.resolve(0);
  const script = [
    'Add-Type @\'',
    'using System; using System.Runtime.InteropServices; using System.Text;',
    'public class SigsoVentanas {',
    '  public delegate bool Proc(IntPtr h, IntPtr l);',
    '  [DllImport("user32.dll")] public static extern bool EnumWindows(Proc f, IntPtr l);',
    '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
    '  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);',
    '  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);',
    '  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);',
    '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);',
    '  public static int Mostrar(uint pid) {',
    '    int n = 0;',
    '    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p != pid || IsWindowVisible(h) || GetWindowTextLength(h) == 0) return true;',
    '      var c = new StringBuilder(64); GetClassName(h, c, 64); if (c.ToString() != "Chrome_WidgetWin_1") return true; ShowWindow(h, 9); n++; return true; }, IntPtr.Zero);',
    '    return n;',
    '  }',
    '}',
    '\'@',
    '[SigsoVentanas]::Mostrar([uint32]$env:SIGSO_CHROME_PID)'
  ].join('\n');
  return new Promise((ok) => {
    require('node:child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { env: Object.assign({}, process.env, { SIGSO_CHROME_PID: String(pid) }), timeout: 20000, windowsHide: true },
      (err, salida) => ok(err ? -1 : (Number(String(salida || '').trim()) || 0)));
  });
}

/**
 * ¿El banco abrió otra pestaña o ventana (o cerró la actual)? Se sigue a la más nueva. 04-11-2026: el robot solo
 * miraba la primera pestaña; si el portal se abre aparte, se quedaba esperando en la de ingreso hasta agotar el plazo.
 */
async function adoptar_(S) {
  const ps = await S.navegador.pages().catch(() => []);
  const abiertas = ps.filter((p) => !p.isClosed());
  let nueva = abiertas.filter((p) => p !== S.page && !S.vistas.has(p) && p.url() !== 'about:blank').pop();
  if (!nueva && (S.page.isClosed() || abiertas.indexOf(S.page) === -1)) nueva = abiertas.filter((p) => p.url() !== 'about:blank').pop();
  if (!nueva) return false;
  S.vistas.add(nueva);
  await S.preparar(nueva);
  S.page = nueva;
  try { await nueva.bringToFront(); } catch (e) { /* */ }
  S.registro('el banco siguió en otra pestaña: ' + ruta_(nueva.url()));
  await S.mostrar();
  return true;
}

async function ingresar_(S, receta, rut, clave, alPaso, dialogo, info) {
  const page = S.page;
  alPaso('Abriendo el Banco en Línea Pyme');
  await page.goto(receta.inicio, { waitUntil: 'domcontentloaded', timeout: receta.esperaMs });
  await S.mostrar();
  await espera_(1500);
  try { const c = await page.$(receta.rechazarCookies); if (c) await c.click(); } catch (e) { /* sin aviso de cookies */ }
  if (!clave) {
    // Asistido: la persona entra a mano en la ventana del PC de la oficina.
    alPaso('Esperando que alguien entre al BCI en el PC de la oficina (hasta 4 minutos)');
    try { await page.bringToFront(); } catch (e) { /* */ }
    let visto = Date.now();
    await hasta_(async () => {
      if (Date.now() - visto > 10000) { visto = Date.now(); await S.mostrar(); } // por si una ventana nueva nace oculta
      await adoptar_(S);
      return adentro_(S.page, receta, dialogo);
    }, receta.ingresoManualMs, 'nadie entró al banco en el PC de la oficina')
      .catch((e) => {
        if (e.estado !== 'SIN_RESPUESTA') throw e;
        const donde = ruta_(S.page.url());
        if (donde === ruta_(receta.inicio)) throw new Detencion('SIN_INGRESO', 'Nadie entró al banco en el PC de la oficina dentro de 4 minutos.');
        throw new Detencion('PAGINA_DISTINTA', 'Pasaron 4 minutos y la ventana del banco quedó en ' + donde + ', sin llegar a «Cuentas». En «Para ajustar el robot» está el recorrido.');
      });
    return;
  }
  alPaso('Escribiendo el RUT y la clave');
  await page.waitForSelector(receta.rut, { visible: true, timeout: receta.esperaMs });
  await escribir_(page, receta.rut, rut);
  await page.waitForSelector(receta.clave, { visible: true, timeout: receta.esperaMs });
  await escribir_(page, receta.clave, clave);
  await espera_(600);
  // Antes de apretar «Ingresar» (que gasta uno de los intentos del banco): que lo escrito haya quedado tal cual.
  info.formulario = (await page.evaluate(camposIngreso_).catch(() => [])) || [];
  const enRut = rutEscrito_(await page.$eval(receta.rut, (e) => e.value).catch(() => ''));
  if (enRut !== rut) throw new Detencion('NO_INGRESADO', 'El RUT no quedó bien escrito en el formulario del banco (quedaron ' + enRut.length + ' de ' + rut.length + ' caracteres). No se apretó «Ingresar»: no se gastó ningún intento.');
  const largoClave = await page.$eval(receta.clave, (e) => String(e.value || '').length).catch(() => -1);
  if (largoClave !== clave.length) throw new Detencion('NO_INGRESADO', 'La clave no quedó completa en el formulario del banco (quedaron ' + Math.max(0, largoClave) + ' de ' + clave.length + ' caracteres; puede que el banco acepte menos). No se apretó «Ingresar»: no se gastó ningún intento.');
  const otro = await page.evaluate((selRut, selClave) => {
    const c = document.querySelector(selClave), f = c && c.form;
    if (!f) return '';
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    const e = Array.from(f.querySelectorAll('input,select,textarea')).find((x) => !x.matches(selRut) && !x.matches(selClave) &&
      !/^(hidden|submit|button|image|reset|file|checkbox|radio)$/i.test(x.type || '') && vis(x) && !String(x.value || '').trim());
    if (!e) return '';
    const l = (e.id && document.querySelector('label[for="' + e.id + '"]')) || e.closest('label');
    return String((l && l.innerText) || e.getAttribute('aria-label') || e.placeholder || e.name || e.id || 'sin nombre').replace(/\s+/g, ' ').trim().slice(0, 40);
  }, receta.rut, receta.clave).catch(() => '');
  if (otro) throw new Detencion('NO_INGRESADO', 'El formulario del banco pide otro dato que el robot no conoce («' + otro + '»). No se apretó «Ingresar»: no se gastó ningún intento.');
  if (!(await clicTexto_(page, receta.ingresar))) throw new Detencion('PAGINA_DISTINTA', 'No se encontró el botón «Ingresar» del banco.');
  alPaso('Entrando al banco');
  await hasta_(async () => {
    await adoptar_(S);
    if (await adentro_(S.page, receta, dialogo)) return true;
    // Sigue en el ingreso con un mensaje del banco: la clave no sirvió (un solo intento).
    if (ruta_(S.page.url()) === ruta_(receta.inicio)) {
      const a = await enAlguno_(S.page, avisoVisible_);
      if (a) throw new Detencion('CLAVE_INVALIDA', 'El banco no aceptó el ingreso: «' + a + '». No se reintentó (el BCI bloquea la clave tras varios intentos). Antes de volver a probar, entra una vez a mano al banco.');
    }
    return false;
  }, receta.entradaMs || receta.esperaMs, 'entrada al banco')
    .catch((e) => {
      if (e.estado !== 'SIN_RESPUESTA') throw e;
      throw new Detencion('SIN_RESPUESTA', 'El banco aceptó «Ingresar», pero la página no llegó a «Cuentas» en ' + Math.round((receta.entradaMs || receta.esperaMs) / 60000) + ' minutos (quedó en ' + ruta_(S.page.url()) + '). En «Para ajustar el robot» está el recorrido.');
    });
}

/**
 * Cuentas › Cartola Histórica. Espera a que el menú aparezca (la página puede seguir cargando); si está plegado, lo
 * abre. Si no lo encuentra, dice en qué página quedó (antes se rendía al primer intento, sin esperar).
 */
async function irACartolas_(S, receta, alPaso) {
  alPaso('Abriendo Cuentas › Cartola Histórica');
  let menu = 0;
  await hasta_(async () => {
    await adoptar_(S);
    if (await clicTexto_(S.page, receta.menuCartola)) return true;
    if (await clicTexto_(S.page, receta.menuCuentas)) {
      await espera_(1200);
      if (await clicTexto_(S.page, receta.menuCartola)) return true;
    }
    if (Date.now() - menu > 5000) { menu = Date.now(); if (!(await clicTexto_(S.page, receta.abrirMenu))) await clic_(S.page, botonMenu_); }
    return false;
  }, receta.esperaMs, 'menú')
    .catch((e) => {
      if (e.estado !== 'SIN_RESPUESTA') throw e;
      throw new Detencion('PAGINA_DISTINTA', 'Se entró al banco, pero no se encontró «Cuentas › Cartola Histórica» (la página es ' + ruta_(S.page.url()) + '). En «Para ajustar el robot» están sus botones y el recorrido.');
    });
  return hasta_(async () => { await adoptar_(S); return enAlguno_(S.page, filasCartola_); }, receta.esperaMs, 'lista de cartolas');
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

async function diagnostico_(page, info) {
  // Solo la dirección, los nombres de botones y títulos y cómo es el formulario de ingreso: nada de montos, ni
  // movimientos, ni lo escrito (de los campos solo cuántos caracteres tienen).
  const campo = (c) => [c.tag + (c.tipo ? '[' + c.tipo + ']' : ''), c.id && '#' + c.id, c.nombre && 'name=' + c.nombre, c.etiqueta && '«' + c.etiqueta + '»',
    c.maximo && 'máx ' + c.maximo, (c.tipo === 'checkbox' || c.tipo === 'radio') ? (c.marcado ? 'marcado' : 'sin marcar') : c.escrito + ' escritos'].filter(Boolean).join(' ');
  // El recorrido: páginas, pestañas, pasos y clics (sin montos ni lo escrito; ver grabarClics_).
  const d = { url: '', elementos: [], formulario: ((info && info.formulario) || []).map(campo), recorrido: ((info && info.recorrido) || []).slice(-40) };
  try {
    d.url = ruta_(page.url());
    for (const f of page.frames()) {
      try {
        const l = await f.evaluate(() => {
          const todos = (s) => { const o = []; const w = (r) => { r.querySelectorAll(s).forEach((e) => o.push(e)); r.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) w(e.shadowRoot); }); }; w(document); return o; };
          return todos('a,button,[role=button],[role=menuitem],[role=link],h1,h2,h3,th')
            .map((e) => (e.tagName.toLowerCase() + ':' + String(e.innerText || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()).slice(0, 60))
            .filter((t) => !/\d{3}/.test(t) && !/:$/.test(t)).slice(0, 60);
        });
        if (f !== page.mainFrame() && l.length) d.elementos.push('[recuadro ' + ruta_(f.url()) + ']');
        d.elementos.push(...l);
      } catch (e) { /* */ }
    }
    d.elementos = d.elementos.slice(0, 80);
    // Empresas de «Convenios Relacionados al Usuario» (razón social y RUT de la empresa; nada de montos).
    ((await enAlguno_(page, convenios_)) || []).slice(0, 15).forEach((f) => d.formulario.push('empresa: ' + (f.razon || 'sin nombre') + ' (' + rutLegible_(f.rut) + ')'));
    const pedida = info && info.rutEmpresa ? rutTeclas_(info.rutEmpresa) : '';
    if (pedida) ((await enAlguno_(page, filaConvenio_, pedida)) || []).forEach((x) => d.formulario.push('fila de la empresa: ' + x));
    if (info && info.dialogo && info.dialogo.convenios) d.formulario.push('intentos en Convenios: ' + info.dialogo.convenios);
    if (await enAlguno_(page, hayCaptchaInvisible_)) d.formulario.push('la página tiene reCAPTCHA invisible (el banco evalúa el navegador sin pedir nada)');
  } catch (e) { /* lo que se alcanzó a juntar */ }
  return d;
}

/**
 * Trae las cartolas de un mes. datos = { rut?, clave?, periodo: 'AAAA-MM', rutEmpresa? } (rutEmpresa: con qué empresa
 * entrar si el usuario del banco tiene varias). opciones = { receta, alPaso, rutaChrome }.
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
    // --disable-gpu, como el robot TGR: abierto desde el arranque con Windows (programa sin ventana), Chrome con
    // GPU dejaba la ventana gris, sin dibujar (03-11-2026), y nadie podía entrar a mano en el modo sin clave.
    // 04-11-2026: además, que Chrome no frene la página aunque la crea de fondo u oculta (ver mostrarVentanas_).
    args: ['--no-first-run', '--disable-extensions', '--mute-audio', '--disable-gpu', '--window-size=1280,900',
      '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
    timeout: receta.esperaMs, protocolTimeout: 90 * 1000
  });
  // El recorrido (04-11-2026): cada página, pestaña, paso y clic queda anotado, para saber DÓNDE se detuvo sin tener que
  // adivinar y gastar otro intento en el banco. Va al registro del PC (opciones.registro) y al diagnóstico.
  const info = { formulario: [], recorrido: [] };
  const registro = (m) => {
    const s = String(m || '').slice(0, 160);
    if (!s || info.recorrido[info.recorrido.length - 1] === s) return;
    info.recorrido.push(s);
    if (info.recorrido.length > 80) info.recorrido.shift();
    try { if (typeof o.registro === 'function') o.registro(s); } catch (e) { /* */ }
  };
  const paso = (p) => { registro('paso: ' + p); alPaso(p); };
  const S = { navegador, page: null, vistas: new Set(), registro };
  const pid = !o.oculto && navegador.process() ? navegador.process().pid : 0;
  S.mostrar = async () => { const n = await mostrarVentanas_(pid); if (n > 0) registro('ventana del banco estaba oculta: se mostró (' + n + ')'); };
  let page = null;
  const bajadas = [];                       // las cartolas que ya bajaron (se entregan aunque después algo falle)
  try {
    const dialogo = info.dialogo = { texto: '', rutEmpresa: (datos && datos.rutEmpresa) || '', asistido: !clave, alPaso: paso };
    info.rutEmpresa = dialogo.rutEmpresa;
    // Cada pestaña que se use: avisos, páginas visitadas y clics grabados.
    S.preparar = async (p) => {
      p.on('dialog', (d) => { dialogo.texto = String(d.message() || 'aviso sin texto').slice(0, 200); registro('aviso del banco: ' + dialogo.texto.replace(/\d/g, '#')); d.dismiss().catch(() => null); });
      p.on('framenavigated', (f) => { if (f === p.mainFrame()) registro('página: ' + ruta_(f.url())); });
      p.on('console', (m) => { const t = m.text(); if (t.indexOf('__sigso_clic ') === 0) registro('clic: ' + t.slice(13)); });
      await p.evaluateOnNewDocument(grabarClics_).catch(() => null);
      await p.evaluate(grabarClics_).catch(() => null);
    };
    page = S.page = (await navegador.pages())[0] || await navegador.newPage();
    S.vistas.add(page);
    await S.preparar(page);
    const cdp = await page.target().createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });

    await ingresar_(S, receta, rut, clave, paso, dialogo, info);
    clave = ''; // ya se usó: no se vuelve a necesitar
    const filas = await irACartolas_(S, receta, paso);
    page = S.page;
    const disponibles = filas.slice(0, 24);
    const elegidas = elegir_(filas, periodo);
    if (!elegidas.length) {
      return { estado: 'SIN_CARTOLAS', mensaje: 'El banco no tiene cartolas de ' + periodo + ' (la última es la N° ' + (filas[0] ? filas[0].numero + ' del ' + filas[0].fecha : '—') + '). Si el mes no ha cerrado, sus movimientos aún no están en una cartola.', archivos: [], disponibles };
    }
    const archivos = bajadas;
    let enLista = true;
    for (let i = 0; i < elegidas.length; i++) {
      const c = elegidas[i];
      paso('Descargando la cartola N° ' + c.numero + ' del ' + c.fecha.split('-').reverse().join('-') + ' (' + (i + 1) + ' de ' + elegidas.length + ')');
      if (!enLista) {
        // De vuelta a la lista por el menú «Cartola Histórica» (04-11-2026: el portal real vive en un recuadro y
        // «atrás» del navegador no volvía a la lista de forma confiable). La sesión sigue abierta.
        await irACartolas_(S, receta, () => {});
      }
      const lista = S.page;
      if (!(await clic_(S.page, flechaDe_, c.numero, c.fecha))) throw new Detencion('PAGINA_DISTINTA', 'No se pudo abrir la cartola N° ' + c.numero + '.');
      // El detalle puede abrirse en la misma pestaña o en otra.
      await hasta_(async () => { await adoptar_(S); return hayTexto_(S.page, receta.exportar); }, receta.esperaMs, 'detalle de la cartola N° ' + c.numero);
      const antes = new Set(fs.readdirSync(dir));
      await clicTexto_(S.page, receta.exportar);
      await hasta_(() => clicTexto_(S.page, receta.descargarExcel), 10000, 'opción «Descargar Excel»');
      const p = await descarga_(dir, antes, receta.descargaMs);
      const buf = fs.readFileSync(p);
      if (buf.length > MAX_BYTES) throw new Detencion('SIN_DESCARGA', 'El Excel de la cartola N° ' + c.numero + ' es demasiado grande.');
      const ext = (/\.(xlsx|xls)$/i.exec(p) || ['', 'xlsx'])[1].toLowerCase();
      archivos.push({ nombre: 'Cartola BCI N° ' + c.numero + ' del ' + c.fecha + '.' + ext, numero: c.numero, fecha: c.fecha, base64: buf.toString('base64') });
      fs.unlinkSync(p);
      registro('cartola N° ' + c.numero + ' descargada');
      if (S.page !== lista && !lista.isClosed()) { await S.page.close().catch(() => null); S.page = lista; enLista = true; } else enLista = false;
    }
    paso('Cerrando la sesión del banco');
    if (await clicTexto_(S.page, receta.salir)) await espera_(2500);
    return { estado: 'OK', mensaje: archivos.length + (archivos.length === 1 ? ' cartola descargada.' : ' cartolas descargadas.'), archivos, disponibles };
  } catch (e) {
    const estado = e instanceof Detencion ? e.estado : 'ERROR';
    const mensaje = e instanceof Detencion ? e.message : 'El robot no pudo terminar: ' + String((e && e.message) || e).slice(0, 200);
    registro('se detuvo: ' + estado);
    const actual = S.page || page;
    const diagnostico = actual ? await diagnostico_(actual, info) : null;
    if (actual) { try { await clicTexto_(actual, receta.salir); await espera_(1500); } catch (x) { /* */ } }
    // Lo ya descargado no se pierde (04-11-2026: la N° 021 bajó bien y se descartó porque la 022 falló): se entrega
    // como resultado bueno, diciendo qué faltó.
    if (bajadas.length) {
      return { estado: 'OK', mensaje: bajadas.length + (bajadas.length === 1 ? ' cartola descargada' : ' cartolas descargadas') + '; las demás no se pudieron traer: ' + mensaje, archivos: bajadas, disponibles: [], diagnostico };
    }
    return { estado, mensaje, archivos: [], diagnostico };
  } finally {
    clave = '';
    await navegador.close().catch(() => null);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ }
  }
}

module.exports = { traerCartolas, elegir_, rutTeclas_, RECETA, MAX_CARTOLAS, disponible: () => !!PdfChromium.rutaChrome() };
