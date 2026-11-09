'use strict';

/**
 * robotSii.js — robot que trae el Registro de Ventas del SII (09-11-2026; pedido con capturas del recorrido real).
 *
 * Hace lo mismo que hoy se hace a mano, en el PC de la oficina (el mismo programa que trae las cartolas del BCI):
 *   SII › Identificación de Contribuyentes (RUT de la EMPRESA + Clave Tributaria) › Servicios online › Impuestos
 *   mensuales › Registro de compras y ventas › Ingresar › RUT · Período (mes y año) › Consultar › VENTA ›
 *   «Descargar Detalles»
 * y devuelve el CSV a SIGSO, donde entra por Finanzas › Subir archivos con su lector de siempre (Registro de Ventas del
 * SII: revisar antes de importar). «Descargar Detalles» trae cada factura y nota de crédito con su folio y su cliente;
 * «Descargar Resúmenes» solo los totales por tipo de documento (no sirve para Cobranza).
 *
 * Solo LEE: nunca aprieta «Agregar documento», «Agregar resumen», «Ir a propuesta F29» ni nada de la pestaña COMPRA.
 *
 * Dos formas de entrar, como el robot del BCI:
 *  - con la Clave Tributaria que la persona escribe EN ESE MOMENTO en SIGSO: se escribe en el SII y se suelta; nunca va a
 *    un log ni a la base;
 *  - sin clave («asistido»): el robot abre el SII y espera hasta 4 minutos a que alguien entre a mano en el PC.
 *
 * Reglas: un solo intento de ingreso (el SII pide verificar un correo tras varios fallos); se detiene ante un CAPTCHA,
 * un cambio de clave obligatorio o un aviso que no conoce; antes de apretar «Ingresar» revisa que el RUT y la clave
 * hayan quedado completos (si no, se detiene sin gastar el intento); el diagnóstico lleva direcciones, botones y
 * títulos, nunca montos ni lo escrito.
 *
 * Todo lo que depende de la página está en RECETA: si el SII cambia algo, se ajusta ahí. Los tests la reemplazan por un
 * sitio de prueba local. Las piezas de navegación son las del robot del BCI (robotBci.piezas).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const PdfChromium = require('./pdfChromium');
const Bci = require('./robotBci');

const { Detencion, espera_, hasta_, ruta_, host_, buscarTexto_, hayCaptcha_, enAlguno_, clic_, clicDirecto_, clicTexto_, hayTexto_,
  grabarClics_, escribir_, rutEscrito_, mostrarVentanas_, adoptar_, diagnostico_ } = Bci.piezas;

const RCV = 'https://www4.sii.cl/consdcvinternetui/';
const RECETA = {
  // El ingreso del SII con regreso directo al Registro de Compras y Ventas (si el SII no vuelve solo, se va por el menú).
  inicio: 'https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoRutClave.html?' + RCV,
  rcv: RCV,
  misii: 'https://misiir.sii.cl/cgi_misii/siihome.cgi',
  salirUrl: 'https://zeusr.sii.cl/cgi_AUT2000/autTermino.cgi',
  hostsIngreso: ['zeusr.sii.cl'],
  rut: '#rutcntr, #inputRut',                 // «RUT · Ej: 123456789» (sin puntos ni guion)
  clave: '#clave, #inputPass',                // «Ingresar Clave Tributaria»
  ingresar: '#bt_ingresar',
  desafio: '#correo',                         // verificar un correo tras intentos fallidos
  cambioClave: '#MCurrentPass2',              // el SII obliga a cambiar la clave
  // El recorrido por el menú, por si el SII no vuelve solo al RCV (capturas del 09-11-2026).
  menu: ['^servicios online', '^impuestos mensuales$', '^registro de compras y ventas$', '^ingresar al registro de compras y ventas$'],
  consultar: '^consultar$',
  venta: '^venta$',
  descargarDetalles: '^descargar detalles$',
  salir: '^(cerrar sesi[oó]n|salir)$',
  esperaMs: 45 * 1000,
  ingresoManualMs: 4 * 60 * 1000,
  descargaMs: 90 * 1000
};
const MAX_BYTES = 8 * 1024 * 1024;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** RUT como se teclea en el formulario del SII: cuerpo y dígito verificador, sin puntos ni guion. */
function rutTeclas_(rut) {
  const s = String(rut || '').replace(/[.\s-]/g, '').toUpperCase();
  return /^\d{7,8}[\dK]$/.test(s) ? s : '';
}
const conGuion_ = (r) => r.slice(0, -1) + '-' + r.slice(-1);

// --- dentro de la página (se ejecuta en el navegador) ----------------------------------------
function visibleSel_(sel) {
  const e = document.querySelector(sel);
  if (!e) return false;
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
}
/** El texto visible de la página (para reconocer avisos del SII). */
function textoPagina_() { return String((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').slice(0, 20000); }
/**
 * El formulario del RCV: «RUT ▾ · Período: mes ▾ año ▾ · Consultar». Marca cada lista con data-sigso-rcv y devuelve
 * qué opción elegir en cada una (o null si aún no está). rut: cuerpo+DV sin guion ('' = la que ya está elegida).
 */
function formularioRcv_(rut, mes, anio) {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  const limpio = (t) => String(t || '').replace(/[^0-9kK]/g, '').toUpperCase();
  let sRut = null, sMes = null, sAnio = null;
  Array.from(document.querySelectorAll('select')).filter(vis).forEach((s) => {
    const ops = Array.from(s.options).map((o) => o.text);
    if (!sRut && ops.some((t) => /\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]/.test(t))) sRut = s;
    else if (!sMes && ops.some((t) => norm(t) === 'octubre' || norm(t) === 'enero')) sMes = s;
    else if (!sAnio && ops.some((t) => /^20\d{2}$/.test(t.trim()))) sAnio = s;
  });
  const boton = Array.from(document.querySelectorAll('button,input[type=button],input[type=submit],a'))
    .find((b) => vis(b) && /^consultar$/i.test(String(b.innerText || b.value || '').trim()));
  if (!sRut || !sMes || !sAnio || !boton) return null;
  sRut.setAttribute('data-sigso-rcv', 'rut'); sMes.setAttribute('data-sigso-rcv', 'mes'); sAnio.setAttribute('data-sigso-rcv', 'anio');
  boton.setAttribute('data-sigso-rcv', 'consultar');
  const ruts = Array.from(sRut.options).map((o) => ({ v: o.value, r: limpio(o.text) })).filter((x) => x.r.length >= 8);
  const oRut = rut ? ruts.find((x) => x.r === rut) : (ruts.find((x) => x.v === sRut.value) || ruts[0]);
  const oMes = Array.from(sMes.options).find((o) => norm(o.text) === mes);
  const oAnio = Array.from(sAnio.options).find((o) => o.text.trim() === anio);
  return { ruts: ruts.map((x) => x.r), rut: oRut ? { v: oRut.v, r: oRut.r } : null, mes: oMes ? oMes.value : null, anio: oAnio ? oAnio.value : null };
}
/** ¿Ya se ve el registro de ventas del período pedido? 'listo' (con «Descargar Detalles»), 'vacio' o null (cargando). */
function estadoVenta_(aaaamm) {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const t = String((document.body && document.body.innerText) || '').replace(/\s+/g, ' ');
  const delMes = new RegExp('registro\\s+de\\s+ventas\\s*' + aaaamm, 'i').test(t);
  const boton = Array.from(document.querySelectorAll('button,a,input[type=button]')).some((b) => vis(b) && /^descargar detalles$/i.test(String(b.innerText || b.value || '').trim()));
  if (delMes && boton) return 'listo';
  if (/no (existen|hay|se (encontraron|registran)|registra)[^.]{0,60}(registro|documento|informaci|venta)/i.test(t)) return 'vacio';
  return null;
}

// --- piezas ----------------------------------------------------------------------------------
/** En qué recuadro está el formulario del RCV (y qué elegir), o null. */
async function formulario_(page, rut, mes, anio) {
  for (const f of page.frames()) {
    try { const r = await f.evaluate(formularioRcv_, rut, mes, anio); if (r) return { frame: f, r }; } catch (e) { /* recuadro que se fue */ }
  }
  return null;
}
/** ¿Sigue en la página de ingreso del SII? (su dirección o el formulario de RUT y clave a la vista). */
async function enIngreso_(page, receta) {
  if (receta.hostsIngreso.includes(host_(page.url()))) return true;
  return !!(await enAlguno_(page, visibleSel_, receta.rut));
}
const RE_RECHAZO = /(rut|clave)[^.]{0,50}(incorrect|inv[aá]lid|no coincide|no (es|son) v[aá]lid)|no autorizad|bloquead/i;
function revisarAviso_(dialogo) {
  const t = dialogo.texto;
  if (!t) return;
  dialogo.texto = '';
  if (RE_RECHAZO.test(t) || /intentos/i.test(t)) throw new Detencion('CLAVE_INVALIDA', 'El SII no aceptó el RUT o la clave: «' + t + '». No se reintentó (tras varios intentos el SII pide verificar un correo).');
  if (/diferid/i.test(t)) throw new Detencion('DIFERIDA', 'El SII dejó la descarga como «diferida» (registro grande): queda en la pestaña «Descargas Diferidas» del RCV. Bájala de ahí y súbela en Finanzas › Subir archivos.');
  throw new Detencion('AVISO', 'El SII mostró un aviso: «' + t + '». El robot se detuvo sin reintentar.');
}
/** Lo que el SII puede pedir después de «Ingresar» y que el robot no hace. */
async function revisarIngreso_(page, receta, dialogo) {
  revisarAviso_(dialogo);
  if (await enAlguno_(page, visibleSel_, receta.desafio)) throw new Detencion('DESAFIO', 'El SII pide verificar un correo (por intentos fallidos). Entra tú una vez al SII con esa clave; el robot no lo hará.');
  if (await enAlguno_(page, visibleSel_, receta.cambioClave)) throw new Detencion('CAMBIO_CLAVE', 'El SII pide cambiar la Clave Tributaria. El robot no cambia claves: hazlo a mano y vuelve a intentar.');
  if (await enAlguno_(page, hayCaptcha_)) throw new Detencion('CAPTCHA', 'El SII pidió un CAPTCHA: el robot se detuvo. Entra a mano esta vez.');
}

async function ingresar_(S, receta, rut, clave, paso, dialogo, info) {
  const page = S.page;
  paso('Abriendo el SII');
  await page.goto(receta.inicio, { waitUntil: 'domcontentloaded', timeout: receta.esperaMs });
  await S.mostrar();
  if (!clave) {
    // Asistido: la persona entra a mano en la ventana del PC de la oficina.
    paso('Esperando que alguien entre al SII en el PC de la oficina (hasta 4 minutos)');
    try { await page.bringToFront(); } catch (e) { /* */ }
    await espera_(1500);
    await hasta_(async () => { await adoptar_(S); await revisarIngreso_(S.page, receta, dialogo); return !(await enIngreso_(S.page, receta)); }, receta.ingresoManualMs, 'nadie entró al SII')
      .catch((e) => { if (e.estado === 'SIN_RESPUESTA') throw new Detencion('SIN_INGRESO', 'Nadie entró al SII en el PC de la oficina dentro de 4 minutos.'); throw e; });
    return;
  }
  paso('Escribiendo el RUT de la empresa y la Clave Tributaria');
  await page.waitForSelector(receta.rut, { visible: true, timeout: receta.esperaMs });
  await revisarIngreso_(page, receta, dialogo);
  await escribir_(page, receta.rut, rut);
  await escribir_(page, receta.clave, clave);
  await espera_(600);
  // Antes de apretar «Ingresar» (que gasta un intento): que lo escrito haya quedado tal cual.
  info.formulario = (await page.evaluate(Bci.piezas.camposIngreso_).catch(() => [])) || [];
  const enRut = rutEscrito_(await page.$eval(receta.rut, (e) => e.value).catch(() => ''));
  if (enRut !== rut) throw new Detencion('NO_INGRESADO', 'El RUT no quedó bien escrito en el formulario del SII (quedaron ' + enRut.length + ' de ' + rut.length + ' caracteres). No se apretó «Ingresar»: no se gastó ningún intento.');
  const largo = await page.$eval(receta.clave, (e) => String(e.value || '').length).catch(() => -1);
  if (largo !== clave.length) throw new Detencion('NO_INGRESADO', 'La clave no quedó completa en el formulario del SII (quedaron ' + Math.max(0, largo) + ' de ' + clave.length + ' caracteres). No se apretó «Ingresar»: no se gastó ningún intento.');
  if (!(await page.$(receta.ingresar))) throw new Detencion('PAGINA_DISTINTA', 'No se encontró el botón «Ingresar» del SII.');
  paso('Entrando al SII');
  await page.click(receta.ingresar);
  // Un solo intento: o sale del ingreso, o se detiene diciendo por qué.
  await hasta_(async () => {
    await adoptar_(S);
    await revisarIngreso_(S.page, receta, dialogo);
    if (!(await enIngreso_(S.page, receta))) return true;
    const t = (await enAlguno_(S.page, textoPagina_)) || '';
    const m = RE_RECHAZO.exec(t);
    if (m) throw new Detencion('CLAVE_INVALIDA', 'El SII no aceptó el RUT o la clave («' + t.slice(Math.max(0, m.index - 20), m.index + 60).trim() + '»). No se reintentó (tras varios intentos el SII pide verificar un correo).');
    return false;
  }, receta.esperaMs, 'respuesta del ingreso');
}

/** Llega al formulario del RCV: el SII suele volver solo; si no, la dirección directa y, al final, el menú. */
async function irAlRcv_(S, receta, paso, elegir) {
  paso('Abriendo el Registro de Compras y Ventas');
  const esperar = (ms) => hasta_(async () => { await adoptar_(S); return formulario_(S.page, ...elegir); }, ms, 'Registro de Compras y Ventas').catch((e) => { if (e.estado === 'SIN_RESPUESTA') return null; throw e; });
  let f = await esperar(15000);
  if (f) return f;
  S.registro('el SII no volvió solo al RCV: se abre su dirección');
  await S.page.goto(receta.rcv, { waitUntil: 'domcontentloaded', timeout: receta.esperaMs }).catch(() => null);
  f = await esperar(25000);
  if (f) return f;
  S.registro('por el menú: Servicios online › Impuestos mensuales › Registro de compras y ventas');
  await S.page.goto(receta.misii, { waitUntil: 'domcontentloaded', timeout: receta.esperaMs }).catch(() => null);
  for (const opcion of receta.menu) {
    await hasta_(async () => { await adoptar_(S); return clicTexto_(S.page, opcion); }, 20000, 'opción «' + opcion.replace(/[\^$\\]/g, '') + '» del menú del SII')
      .catch((e) => { if (e.estado === 'SIN_RESPUESTA') throw new Detencion('PAGINA_DISTINTA', 'Se entró al SII, pero no se pudo llegar al Registro de Compras y Ventas (falta la opción «' + opcion.replace(/[\^$\\]/g, '') + '»).'); throw e; });
    await espera_(1200);
  }
  f = await esperar(receta.esperaMs);
  if (!f) throw new Detencion('PAGINA_DISTINTA', 'Se abrió el Registro de Compras y Ventas, pero no aparece el formulario «RUT · Período · Consultar».');
  return f;
}

/** Espera el archivo nuevo de la carpeta de descargas (sin «.crdownload» y con su tamaño quieto). */
async function descarga_(S, dir, antes, ms, dialogo) {
  let previo = -1;
  return hasta_(async () => {
    revisarAviso_(dialogo);
    // Un aviso de descarga diferida (la pestaña «Descargas Diferidas» está siempre en el RCV: su nombre no cuenta).
    const t = ((await enAlguno_(S.page, textoPagina_)) || '').replace(/descargas\s+diferidas/gi, '');
    if (/diferid/i.test(t) && !fs.readdirSync(dir).some((n) => !antes.has(n))) {
      throw new Detencion('DIFERIDA', 'El SII dejó la descarga como «diferida» (registro grande): queda en la pestaña «Descargas Diferidas» del RCV. Bájala de ahí y súbela en Finanzas › Subir archivos.');
    }
    const nuevos = fs.readdirSync(dir).filter((n) => !antes.has(n) && !/\.(crdownload|tmp)$/i.test(n));
    if (!nuevos.length) return null;
    const p = path.join(dir, nuevos[0]), tam = fs.statSync(p).size;
    if (!tam || tam !== previo) { previo = tam; return null; }
    return p;
  }, ms, 'descarga del detalle').catch((e) => { if (e.estado === 'SIN_RESPUESTA') throw new Detencion('SIN_DESCARGA', 'El SII no entregó el archivo de «Descargar Detalles».'); throw e; });
}

/**
 * Trae el detalle del Registro de Ventas de un mes. datos = { rut?, clave?, periodo: 'AAAA-MM' } (rut: el de la
 * EMPRESA, con el que se entra al SII y que se elige en el RCV). opciones = { receta, alPaso, registro, rutaChrome, oculto }.
 * Devuelve { estado: 'OK' | motivo, mensaje, archivos: [{ nombre, rut, periodo, base64 }], ruts?, diagnostico? }.
 */
async function traerVentas(datos, opciones) {
  const o = opciones || {};
  const receta = Object.assign({}, RECETA, o.receta || {});
  const alPaso = typeof o.alPaso === 'function' ? o.alPaso : () => {};
  const periodo = String((datos && datos.periodo) || '');
  let clave = String((datos && datos.clave) || '');
  const rut = rutTeclas_(datos && datos.rut);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) return { estado: 'DATOS', mensaje: 'Falta el mes de las ventas.', archivos: [] };
  if (clave && !rut) return { estado: 'DATOS', mensaje: 'El RUT de la empresa no es válido.', archivos: [] };
  const ruta = o.rutaChrome || PdfChromium.rutaChrome();
  if (!ruta) return { estado: 'SIN_NAVEGADOR', mensaje: 'Este PC no tiene Chrome ni Edge.', archivos: [] };
  const [anio, mm] = periodo.split('-');
  const aaaamm = anio + mm;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigso-sii-'));
  const puppeteer = require('puppeteer-core');
  // Mismas opciones que el robot del BCI (ventana visible, sin GPU, sin frenar la página aunque Chrome la crea de fondo).
  const navegador = await puppeteer.launch({
    executablePath: ruta, headless: o.oculto ? true : false, defaultViewport: null,
    args: ['--no-first-run', '--disable-extensions', '--mute-audio', '--disable-gpu', '--window-size=1280,900',
      '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
    timeout: receta.esperaMs, protocolTimeout: 90 * 1000
  });
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
  S.mostrar = async () => { const n = await mostrarVentanas_(pid); if (n > 0) registro('ventana del SII estaba oculta: se mostró (' + n + ')'); };
  let page = null;
  try {
    const dialogo = info.dialogo = { texto: '' };
    S.preparar = async (p) => {
      p.on('dialog', (d) => { dialogo.texto = String(d.message() || 'aviso sin texto').slice(0, 200); registro('aviso del SII: ' + dialogo.texto.replace(/\d/g, '#')); d.dismiss().catch(() => null); });
      p.on('framenavigated', (f) => { if (f === p.mainFrame()) registro('página: ' + ruta_(f.url())); });
      p.on('console', (m) => { const t = m.text(); if (t.indexOf('__sigso_clic ') === 0) registro('clic: ' + t.slice(13)); });
      await p.evaluateOnNewDocument(grabarClics_).catch(() => null);
      await p.evaluate(grabarClics_).catch(() => null);
      const cdp = await p.target().createCDPSession().catch(() => null);
      if (cdp) await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir }).catch(() => null);
    };
    page = S.page = (await navegador.pages())[0] || await navegador.newPage();
    S.vistas.add(page);
    await S.preparar(page);

    await ingresar_(S, receta, rut, clave, paso, dialogo, info);
    clave = ''; // ya se usó: no se vuelve a necesitar
    const { frame, r } = await irAlRcv_(S, receta, paso, [rut, MESES[Number(mm) - 1], anio]);
    if (!r.rut) {
      throw new Detencion('EMPRESA', 'En el Registro de Compras y Ventas no aparece el RUT ' + conGuion_(rut) + '. Aparecen: ' + (r.ruts.map(conGuion_).join(', ') || 'ninguno') + '.');
    }
    if (!r.mes || !r.anio) throw new Detencion('SIN_PERIODO', 'El SII no ofrece el período ' + MESES[Number(mm) - 1] + ' ' + anio + ' en el Registro de Compras y Ventas.');
    paso('Consultando ' + MESES[Number(mm) - 1] + ' ' + anio + ' de la empresa ' + conGuion_(r.rut.r));
    const elegirEn = async (cual, valor) => { const h = await frame.$('[data-sigso-rcv=' + cual + ']'); if (!h) throw new Detencion('PAGINA_DISTINTA', 'El formulario del RCV cambió mientras se llenaba.'); await h.select(valor); await h.dispose(); };
    await elegirEn('rut', r.rut.v);
    await elegirEn('mes', r.mes);
    await elegirEn('anio', r.anio);
    await espera_(500);
    const consultar = await frame.$('[data-sigso-rcv=consultar]');
    if (!consultar) throw new Detencion('PAGINA_DISTINTA', 'No se encontró el botón «Consultar» del RCV.');
    await consultar.click(); await consultar.dispose();
    // VENTA (nunca COMPRA): con paciencia, porque la consulta tarda y la pestaña aparece después.
    paso('Abriendo la pestaña VENTA');
    let ultimo = 0, intentos = 0;
    const estado = await hasta_(async () => {
      revisarAviso_(dialogo);
      const e = await enAlguno_(S.page, estadoVenta_, aaaamm);
      if (e && intentos) return e;
      if (Date.now() - ultimo > 3000 && (await hayTexto_(S.page, receta.venta))) {
        ultimo = Date.now(); intentos++;
        if (intentos % 2) await clicTexto_(S.page, receta.venta); else await clicDirecto_(S.page, buscarTexto_, receta.venta);
      }
      return null;
    }, receta.esperaMs, 'registro de ventas de ' + aaaamm);
    if (estado === 'vacio') {
      paso('Cerrando la sesión del SII');
      await salir_(S, receta);
      return { estado: 'SIN_VENTAS', mensaje: 'El SII no tiene ventas registradas de ' + MESES[Number(mm) - 1] + ' ' + anio + ' para la empresa ' + conGuion_(r.rut.r) + '.', archivos: [], ruts: r.ruts };
    }
    paso('Descargando el detalle de ventas');
    const antes = new Set(fs.readdirSync(dir));
    if (!(await clicTexto_(S.page, receta.descargarDetalles))) throw new Detencion('PAGINA_DISTINTA', 'No se encontró el botón «Descargar Detalles».');
    const p = await descarga_(S, dir, antes, receta.descargaMs, dialogo);
    const buf = fs.readFileSync(p);
    if (buf.length > MAX_BYTES) throw new Detencion('SIN_DESCARGA', 'El detalle de ventas es demasiado grande para traerlo por el robot. Bájalo a mano.');
    if (!/\.(csv|txt)$/i.test(p)) throw new Detencion('FORMATO', 'El SII entregó un archivo que no es CSV (' + path.extname(p) + ').');
    // El nombre del SII (RCV_VENTA_<RUT>_<AAAAMM>.csv): de ahí SIGSO saca la empresa emisora y el período.
    const nombre = 'RCV_VENTA_' + conGuion_(r.rut.r) + '_' + aaaamm + '.csv';
    registro('detalle de ventas descargado (' + Math.round(buf.length / 1024) + ' KB)');
    paso('Cerrando la sesión del SII');
    await salir_(S, receta);
    return { estado: 'OK', mensaje: 'Detalle de ventas de ' + MESES[Number(mm) - 1] + ' ' + anio + ' descargado.', archivos: [{ nombre, rut: conGuion_(r.rut.r), periodo, base64: buf.toString('base64') }], ruts: r.ruts };
  } catch (e) {
    const estado = e instanceof Detencion ? e.estado : 'ERROR';
    const mensaje = e instanceof Detencion ? e.message : 'El robot no pudo terminar: ' + String((e && e.message) || e).slice(0, 200);
    registro('se detuvo: ' + estado);
    const actual = S.page || page;
    const diagnostico = actual ? await diagnostico_(actual, info) : null;
    if (actual && estado !== 'NO_INGRESADO') await salir_(S, receta).catch(() => null);
    return { estado, mensaje, archivos: [], diagnostico };
  } finally {
    clave = '';
    await navegador.close().catch(() => null);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ }
  }
}

/** Cierra la sesión del SII: su enlace si está a la vista; si no, la dirección de término. */
async function salir_(S, receta) {
  try {
    if (await clicTexto_(S.page, receta.salir)) { await espera_(2000); return; }
    if (receta.salirUrl && !(await enIngreso_(S.page, receta))) await S.page.goto(receta.salirUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
  } catch (e) { /* el navegador se cierra igual */ }
}

module.exports = { traerVentas, rutTeclas_, RECETA, disponible: () => !!PdfChromium.rutaChrome() };
