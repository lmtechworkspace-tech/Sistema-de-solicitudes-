'use strict';

/**
 * finanzasRespaldo.js — Respaldo de Finanzas fuera de SIGSO (Finanzas v5.9, 02-11-2026; segunda revisión con gerencia).
 *
 * Gerencia: «que se haga un PDF… un doble respaldo» y «que genere una copia, diaria o semanal, que llegue a un correo».
 * La bóveda guarda todo cifrado con una llave que vive en el servidor: si el servidor se pierde, se pierde la llave.
 * Por eso el respaldo es un archivo que se abre SIN SIGSO y SIN el servidor, pero que tampoco lee cualquiera:
 *
 *   «Respaldo Finanzas AAAA-MM-DD.html» — una página que se abre con doble clic en cualquier navegador, pide la CLAVE DE
 *   RESPALDO y muestra la planilla de cada cuenta y mes, las facturas, las deudas anteriores y los préstamos, con un
 *   botón para descargar cada tabla a Excel (CSV). Sin la clave es ilegible (AES-256-GCM, clave derivada con PBKDF2).
 *
 * Dos formas de obtenerlo:
 *   1. Manual (Más › Exportar): la persona escribe una clave y descarga el archivo. La clave no se guarda.
 *   2. Automático (cada lunes 08:00, server/index.js): si en el servidor están SIGSO_FINANZAS_RESPALDO_CLAVE y
 *      SIGSO_FINANZAS_RESPALDO_CORREO, se arma el archivo, se guarda una copia en el servidor (las últimas 12) y se envía
 *      ADJUNTO a ese correo. El cuerpo del correo no lleva cifras: solo dice si el BCI quedó en $0 la semana anterior.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const B = require('./finanzasBoveda');
const Base = require('./finanzasBase');
const F = require('./finanzasBancos');
const { errorValidacion } = require('./errores');

const I = F.interno;
const ITERACIONES = 310000;
const REMITENTE_ = 'SIGSO — Control y Gestión Empresarial <notificaciones@ctrly.cl>';
const MIN_CLAVE = 10;

function db_() { const d = I.db_(); d.exec('CREATE TABLE IF NOT EXISTS FIN_AJUSTES (clave TEXT PRIMARY KEY, datos TEXT NOT NULL, actualizado_en TEXT, actualizado_por TEXT)'); return d; }

/** Todo lo que va en el respaldo, como hojas (nombre, columnas, filas). */
function hojas_(db) {
  const H = require('./finanzasHoja');
  const ctx = H.contexto_(db);
  const hojas = [];
  const meses = I.db_().prepare('SELECT DISTINCT periodo FROM FIN_MOVIMIENTOS WHERE periodo IS NOT NULL ORDER BY periodo').all().map((r) => r.periodo).filter((p) => /^\d{4}-\d{2}$/.test(p));
  const COLS = ['Fecha', 'Nombre', 'OBS', 'Plan de cuenta', 'Monto', 'Grupo', 'N° factura', 'Detalle banco', 'Saldo', 'Qué es', 'Banco'];
  [...ctx.cuentas.values()].forEach((cu) => meses.forEach((mes) => {
    const h = H.construir_(db, cu, mes, ctx);
    if (!h.filas.length) return;
    hojas.push({ nombre: 'Planilla ' + cu.banco + ' ···' + cu.ultimos4 + ' · ' + cu.empresa + ' · ' + mes, columnas: COLS,
      filas: h.filas.map((f) => [f.fecha || '', f.nombre || '', f.obs || '', f.plan || '', f.monto || 0, f.grupo || '', f.fact || '', f.glosa || '', typeof f.saldo === 'number' ? f.saldo : '',
        (f.que && f.que.t) || '', f.banco === 'ok' ? 'en banco' : f.banco === 'falta' ? 'falta anotar' : f.banco || '']) });
  }));
  try {
    const fac = H.facturas_(db, null);
    hojas.push({ nombre: 'Facturas (registro de ventas)', columnas: ['Folio', 'Cliente', 'Empresa', 'Emisión', 'Vence', 'Total', 'Pagado', 'Saldo', 'Estado'],
      filas: fac.map((f) => [f.folio || '', f.cliente || '', f.empresa || '', f.emision || f.fecha || '', f.vence || '', f.total || 0, f.pagado || 0, f.saldo || 0, f.estado || '']) });
  } catch (e) { /* sin facturas */ }
  try {
    const dd = require('./finanzasDeudas').lista_().deudas;
    hojas.push({ nombre: 'Deudas anteriores', columnas: ['Código', 'Cliente', 'RUT', 'Origen', 'Año', 'Estado', 'Adeudado', 'Abonado', 'Por cobrar', 'Último abono'],
      filas: dd.map((d) => [d.codigo, d.cliente || '', d.rut_visible || '', d.origen || '', d.anio || '', d.estado_cliente || '', d.monto || 0, d.abonado || 0, d.saldo || 0, d.ultimo_abono || '']) });
  } catch (e) { /* sin deudas */ }
  try {
    const pf = require('./finanzasPrestamosSocio').filas_(db);
    hojas.push({ nombre: 'Préstamos y aportes', columnas: ['Fecha', 'Quién', 'Tipo', 'Monto', 'Cuenta', 'Plan de cuenta'],
      filas: pf.map((f) => [f.fecha, f.nombre, f.tipo === 'entra' ? 'Préstamo recibido' : f.tipo === 'devuelve' ? 'Devolución' : 'Aporte', f.monto, f.cuenta, f.plan]) });
  } catch (e) { /* sin préstamos */ }
  return hojas;
}

/** Cifra el contenido con la clave (PBKDF2-SHA256 + AES-256-GCM; compatible con WebCrypto del navegador). */
function cifrar_(texto, clave) {
  const sal = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const llave = crypto.pbkdf2Sync(String(clave), sal, ITERACIONES, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-gcm', llave, iv);
  const cuerpo = Buffer.concat([c.update(Buffer.from(texto, 'utf8')), c.final(), c.getAuthTag()]);
  return { sal: sal.toString('base64'), iv: iv.toString('base64'), datos: cuerpo.toString('base64'), iter: ITERACIONES };
}
/** Para pruebas y para comprobar un respaldo desde el servidor. */
function descifrar_(paquete, clave) {
  const llave = crypto.pbkdf2Sync(String(clave), Buffer.from(paquete.sal, 'base64'), paquete.iter, 32, 'sha256');
  const b = Buffer.from(paquete.datos, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', llave, Buffer.from(paquete.iv, 'base64'));
  d.setAuthTag(b.subarray(b.length - 16));
  return Buffer.concat([d.update(b.subarray(0, b.length - 16)), d.final()]).toString('utf8');
}

function paginaHtml_(paquete, fecha) {
  // La página no carga nada de afuera: el descifrado y las tablas son del propio navegador.
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Respaldo Finanzas SIGSO ' + fecha + '</title>' +
    '<style>body{font:15px/1.45 system-ui,Segoe UI,sans-serif;margin:0;background:#f1f4fb;color:#0f172a}header{background:#1f2438;color:#fff;padding:20px 24px}h1{margin:0;font-size:20px}' +
    'main{padding:20px 24px;max-width:1200px;margin:0 auto}.c{background:#fff;border:1px solid #e5e8ef;border-radius:12px;padding:16px 18px;margin-bottom:16px}input{font:inherit;padding:9px 12px;border:1px solid #cbd2de;border-radius:8px;width:280px;max-width:100%}' +
    'button{font:600 14px system-ui,sans-serif;padding:9px 14px;border:0;border-radius:8px;background:#2a5fd6;color:#fff;cursor:pointer;margin-left:6px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid #e5e8ef;padding:6px 8px;text-align:left;white-space:nowrap}' +
    'th{background:#f1f4f9;color:#5b6474;font-size:12px}.t{overflow:auto;max-height:420px}.e{color:#c2362b}.m{text-align:right}h2{font-size:16px;margin:0 0 10px;display:flex;justify-content:space-between;align-items:center;gap:8px}small{color:#5b6474}</style></head><body>' +
    '<header><h1>Respaldo de Finanzas · SIGSO</h1><small style="color:#b9bfd6">Generado el ' + fecha + '. Confidencial: se abre solo con la clave de respaldo.</small></header><main>' +
    '<div class="c" id="pide"><p>Escribe la clave de respaldo para ver los datos. Sin ella el archivo no se puede leer.</p><form id="f"><input type="password" id="k" autocomplete="off" placeholder="Clave de respaldo" required><button>Abrir</button></form><p class="e" id="err"></p></div>' +
    '<div id="todo"></div></main><script>var P=' + JSON.stringify(paquete) + ';' +
    'function b(x){return Uint8Array.from(atob(x),function(c){return c.charCodeAt(0)})}' +
    'function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}' +
    'function csv(h){var l=[h.columnas].concat(h.filas).map(function(r){return r.map(function(v){v=String(v==null?"":v);if(/^[=+\\-@]/.test(v)&&isNaN(Number(v)))v="\'"+v;return /[";\\n]/.test(v)?\'"\'+v.replace(/"/g,\'""\')+\'"\':v}).join(";")});' +
    'var a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\\ufeff"+l.join("\\r\\n")],{type:"text/csv"}));a.download=h.nombre.replace(/[^\\w\\-· ]+/g,"_")+".csv";a.click()}' +
    'document.getElementById("f").onsubmit=async function(e){e.preventDefault();var err=document.getElementById("err");err.textContent="Abriendo…";try{' +
    'var k=await crypto.subtle.importKey("raw",new TextEncoder().encode(document.getElementById("k").value),"PBKDF2",false,["deriveKey"]);' +
    'var key=await crypto.subtle.deriveKey({name:"PBKDF2",salt:b(P.sal),iterations:P.iter,hash:"SHA-256"},k,{name:"AES-GCM",length:256},false,["decrypt"]);' +
    'var t=await crypto.subtle.decrypt({name:"AES-GCM",iv:b(P.iv)},key,b(P.datos));var D=JSON.parse(new TextDecoder().decode(t));' +
    'document.getElementById("pide").remove();var h="";D.hojas.forEach(function(x,i){h+=\'<div class="c"><h2>\'+esc(x.nombre)+\' <small>\'+x.filas.length+\' fila(s)</small><button data-i="\'+i+\'">Descargar Excel (CSV)</button></h2><div class="t"><table><thead><tr>\'+x.columnas.map(function(c){return"<th>"+esc(c)+"</th>"}).join("")+"</tr></thead><tbody>"+x.filas.map(function(r){return"<tr>"+r.map(function(v){return\'<td\'+(typeof v==="number"?\' class="m"\':"")+">"+esc(typeof v==="number"?v.toLocaleString("es-CL"):v)+"</td>"}).join("")+"</tr>"}).join("")+"</tbody></table></div></div>"});' +
    'var T=document.getElementById("todo");T.innerHTML=\'<div class="c"><b>\'+D.hojas.length+\' tabla(s)</b> · corte \'+esc(D.generado)+\'</div>\'+h;T.onclick=function(ev){var i=ev.target.getAttribute("data-i");if(i!=null)csv(D.hojas[+i])};' +
    '}catch(x){err.textContent="La clave no es correcta (o el archivo está dañado)."}};</script></body></html>';
}

/** Arma el archivo de respaldo (texto HTML) con una clave. */
function armar_(db, clave) {
  const fecha = Base.hoy_();
  const contenido = JSON.stringify({ generado: new Date().toISOString(), hojas: hojas_(db) });
  return { nombre: 'Respaldo Finanzas ' + fecha + '.html', html: paginaHtml_(cifrar_(contenido, clave), fecha), fecha };
}

/** Manual: Más › Exportar. data: { clave } (no se guarda). */
const descargar = Base.conCapacidad('EXPORTAR', '', function (db, data, contexto, x) {
  const clave = String((data && data.clave) || '');
  if (clave.length < MIN_CLAVE) return errorValidacion('clave', 'La clave de respaldo debe tener al menos ' + MIN_CLAVE + ' caracteres. Guárdala bien: sin ella el archivo no se abre.');
  const r = armar_(db, clave);
  x.registrar('RESPALDO_DESCARGA', r.nombre);
  return { nombre: r.nombre, html: r.html };
});

// ---------------------------------------------------------------- automático (cada lunes)

function semanaIso_(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dia = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - dia);
  const ini = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return t.getUTCFullYear() + '-S' + String(Math.ceil(((t - ini) / 86400000 + 1) / 7)).padStart(2, '0');
}
function carpeta_() {
  const base = process.env.SIGSO_FINANZAS_DB_PATH ? path.dirname(process.env.SIGSO_FINANZAS_DB_PATH)
    : path.dirname(process.env.SIGSO_DB_PATH || path.join(__dirname, '..', '..', 'data', 'sigso.db'));
  return process.env.SIGSO_FINANZAS_RESPALDO_DIR || path.join(base, 'respaldos-finanzas');
}
/** Una línea sin cifras sobre la cuenta de paso de la semana anterior (va en el cuerpo del correo). */
function avisoCuentaPaso_(db, ahora) {
  try {
    const H = require('./finanzasHoja'), CP = require('./finanzasCuentaPaso');
    const ctx = H.contexto_(db);
    const hace7 = new Date(ahora.getTime() - 7 * 86400000);
    const periodo = hace7.getFullYear() + '-' + String(hace7.getMonth() + 1).padStart(2, '0');
    const dia = periodo + '-' + String(hace7.getDate()).padStart(2, '0');
    const out = [];
    [...ctx.cuentas.values()].forEach((cu) => {
      const c = CP.control_(db, cu, periodo, ctx); if (!c) return;
      const s = (c.semanas || []).find((w) => w.desde <= dia && w.hasta >= dia);
      if (!s) return;
      out.push(cu.banco + ' ···' + cu.ultimos4 + ' (cuenta de paso), semana del ' + s.desde.split('-').reverse().join('-') + ' al ' + s.hasta.split('-').reverse().join('-') + ': ' +
        (s.saldo === null ? 'sin cartola cargada para esa semana.' : s.en_cero ? 'quedó en $0.' : 'NO quedó en $0. Revisa en SIGSO › Finanzas › Planilla la tarjeta «Cuenta de paso» (¿de qué es el saldo?).'));
    });
    return out;
  } catch (e) { return []; }
}

/**
 * Lo llama server/index.js cada 5 minutos: actúa solo los lunes a las 08:00 y una vez por semana.
 * Devuelve qué hizo (para pruebas). Nunca lanza.
 */
async function programado(db, ahora) {
  ahora = ahora || new Date();
  try {
    const clave = String(process.env.SIGSO_FINANZAS_RESPALDO_CLAVE || '');
    if (clave.length < MIN_CLAVE) return { hecho: false, motivo: 'sin_clave' };
    if (!B.tieneAcceso || !process.env.SIGSO_FINANZAS_LLAVE) return { hecho: false, motivo: 'sin_boveda' };
    const semana = semanaIso_(ahora);
    const ya = db_().prepare('SELECT 1 FROM FIN_AJUSTES WHERE clave = ?').get('respaldo|' + semana);
    if (ya) return { hecho: false, motivo: 'ya_hecho' };
    const r = armar_(db, clave);
    const dir = carpeta_();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, r.nombre), r.html);
    fs.readdirSync(dir).filter((n) => /^Respaldo Finanzas .*\.html$/.test(n)).sort().reverse().slice(12).forEach((n) => { try { fs.unlinkSync(path.join(dir, n)); } catch (e) { /* */ } });
    let enviado = false, motivo = '';
    const correo = String(process.env.SIGSO_FINANZAS_RESPALDO_CORREO || '').trim();
    if (correo) {
      const avisos = avisoCuentaPaso_(db, ahora);
      const texto = 'Respaldo semanal de Finanzas (' + semana + ').\n\nAdjunto va el archivo cifrado: se abre con doble clic y pide la clave de respaldo. Sin la clave no se puede leer.\n' +
        (avisos.length ? '\nControl de la cuenta de paso:\n- ' + avisos.join('\n- ') + '\n' : '') + '\nEste correo no lleva cifras. SIGSO · Finanzas';
      try {
        await require('./resend').enviarCorreoResend_({ from: process.env.RESEND_FROM || REMITENTE_, to: correo.split(',').map((s) => s.trim()).filter(Boolean),
          subject: 'Respaldo semanal de Finanzas · ' + r.fecha, text: texto, attachments: [{ filename: r.nombre, content: Buffer.from(r.html, 'utf8').toString('base64') }] });
        enviado = true;
      } catch (e) { motivo = String(e && e.message || e).slice(0, 160); }
    }
    db_().prepare('INSERT OR REPLACE INTO FIN_AJUSTES (clave, datos, actualizado_en, actualizado_por) VALUES (?,?,?,?)')
      .run('respaldo|' + semana, I.cif_({ archivo: r.nombre, enviado, motivo }), Base.ahora_(), 'sistema');
    try { B.registrar_ && B.registrar_({ cuenta_id: 'sistema', nombre: 'Sistema', accion: 'RESPALDO_SEMANAL', detalle: r.nombre + (correo ? (enviado ? ' · enviado' : ' · correo no salió') : ' · solo en el servidor') }); } catch (e) { /* */ }
    return { hecho: true, archivo: r.nombre, enviado, motivo };
  } catch (e) {
    console.error('error en el respaldo semanal de Finanzas:', e);
    return { hecho: false, motivo: 'error' };
  }
}

module.exports = { descargar, programado, armar_, hojas_, cifrar_, descifrar_, semanaIso_, carpeta_, MIN_CLAVE };
