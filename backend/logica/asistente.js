'use strict';

/**
 * asistente.js — el Asistente SIGSO (2026-11-11): un asistente con IA (Claude,
 * de Anthropic) al que cualquier persona le pregunta en lenguaje natural sobre
 * SIGSO, sus datos, cómo hacer algo, o sobre documentos que adjunta.
 *
 * Cómo responde con datos reales sin saltarse ningún permiso:
 *  - `consultar_sigso`: corre una acción de SOLO LECTURA del router (lista
 *    blanca en asistenteConocimiento.js) con la MISMA sesión de quien pregunta.
 *    Cada acción ya verifica sus permisos, así que el asistente ve exactamente
 *    lo que la persona ve. Segunda barrera: la parte síncrona de la acción
 *    corre dentro de un SAVEPOINT que siempre se deshace (nada queda escrito).
 *    Con `ver` filtra, agrupa y cuenta las filas aquí (no en el modelo).
 *  - `leer_archivo_sigso`: abre archivos que la persona puede descargar
 *    (documentos del SGC, de proyectos, adjuntos de novedades) y se los pasa
 *    al modelo (PDF e imágenes directo; Word/Excel/PowerPoint como texto).
 *  - `buscar_en_manuales`: los manuales de uso (frontend/manuales/*.js).
 *  - `explorar_tabla`: solo super admin y ADM; lectura cruda de una tabla,
 *    sin las tablas de sesiones/claves y sin columnas de contraseñas o tokens.
 *  - búsqueda web (herramienta de servidor de Anthropic), para normativa.
 *
 * La conversación vive en el navegador (solo texto); el servidor no guarda lo
 * que se pregunta, solo el CONSUMO (tokens) en ASISTENTE_USO para el tope
 * diario y el costo. Los adjuntos quedan en memoria del proceso unas horas.
 *
 * Variables del servidor (/etc/sigso/*.env):
 *   ANTHROPIC_API_KEY            obligatoria (sin ella el asistente dice "no configurado")
 *   SIGSO_ASISTENTE_MODELO       por defecto claude-opus-5-5
 *   SIGSO_ASISTENTE_ESFUERZO     low | medium | high (por defecto medium)
 *   SIGSO_ASISTENTE_TOPE_DIA     preguntas por persona al día (por defecto 60)
 *   SIGSO_ASISTENTE_TODOS        "si" = todas las cuentas; si no, ADM, super admin y módulo `asistente`
 *   SIGSO_ASISTENTE_WEB          "no" apaga la búsqueda web
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { leerFilas_, agregarFila_ } = require('../db/sqliteRepo');

function tablaExiste_(db, nombre) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(nombre);
}
const { COLUMNAS } = require('../db/schema');
const { CATALOGO, ARCHIVOS, SISTEMA } = require('./asistenteConocimiento');
const TextoDeArchivo = require('./textoDeArchivo');

const MODULO = 'asistente';
const MAX_VUELTAS = 14;
const TOPE_RESULTADO = 30000; // caracteres por resultado de herramienta
const ACCIONES_LECTURA = new Set(CATALOGO.map((c) => c[0]));
const MODULO_DE_ACCION = {};
CATALOGO.forEach((c) => { MODULO_DE_ACCION[c[0]] = c[1]; });

// Precio en US$ por millón de tokens [entrada, salida, lectura de caché, escritura de caché].
const PRECIOS = {
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-sonnet-5-5': [2, 10, 0.1, 2.5],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125]
};

function modelo_() { return String(process.env.SIGSO_ASISTENTE_MODELO || 'claude-opus-5-5').trim(); }
function esfuerzo_() { const e = String(process.env.SIGSO_ASISTENTE_ESFUERZO || 'medium').trim(); return ['low', 'medium', 'high', 'xhigh', 'max'].indexOf(e) !== -1 ? e : 'medium'; }
function topeDia_() { const n = Number(process.env.SIGSO_ASISTENTE_TOPE_DIA || 60); return n > 0 ? n : 60; }
function webActiva_() { return String(process.env.SIGSO_ASISTENTE_WEB || '').toLowerCase() !== 'no'; }
function configurado_() { return !!String(process.env.ANTHROPIC_API_KEY || '').trim(); }
function hoy_() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1 || v === 'true'; }

/** ¿Puede usar el asistente? ADM, super admin, quien tenga el módulo, o todos si así se configuró. */
function puedeUsar(contexto) {
  if (!contexto) return false;
  if (contexto.super_admin || contexto.rol === 'ADM') return true;
  if ((contexto.modulos || []).indexOf(MODULO) !== -1) return true;
  return String(process.env.SIGSO_ASISTENTE_TODOS || '').toLowerCase() === 'si';
}
function puedeExplorar_(contexto) { return !!(contexto && (contexto.super_admin || contexto.rol === 'ADM')); }

// --- consumo y tope diario --------------------------------------------------------------

function usosDeHoy_(db, cuentaId) {
  if (!tablaExiste_(db, 'ASISTENTE_USO')) return 0;
  const dia = JSON.stringify(hoy_());
  const r = db.prepare('SELECT COUNT(*) AS n FROM "ASISTENTE_USO" WHERE "dia" = ? AND "cuenta_id" = ?').get(dia, JSON.stringify(cuentaId));
  return r ? r.n : 0;
}

function costo_(modelo, u) {
  const p = PRECIOS[modelo] || PRECIOS['claude-opus-5-5'];
  return (u.input * p[0] + u.output * p[1] + u.cache_read * p[2] + u.cache_write * p[3]) / 1e6;
}

function registrarUso_(db, contexto, u, extra) {
  try {
    agregarFila_(db, 'ASISTENTE_USO', Object.assign({
      uso_id: crypto.randomUUID(), fecha: new Date().toISOString(), dia: hoy_(),
      cuenta_id: contexto.cuenta_id || '', email: contexto.email || '', modelo: u.modelo,
      tokens_entrada: u.input, tokens_salida: u.output, tokens_cache_lectura: u.cache_read, tokens_cache_escritura: u.cache_write,
      herramientas: u.herramientas, costo_usd: Math.round(costo_(u.modelo, u) * 10000) / 10000
    }, extra || {}));
  } catch (e) { console.error('asistente: no se pudo registrar el uso:', e.message); }
}

/** Estado para la pantalla: ¿está disponible?, ¿cuántas preguntas le quedan hoy? */
function estado(db, data, contexto) {
  if (!puedeUsar(contexto)) return { _forbidden: true, message: 'Tu cuenta no tiene el Asistente SIGSO. Pídelo a Administración del sistema.' };
  const usadas = usosDeHoy_(db, contexto.cuenta_id);
  return {
    yo: contexto.email || '',
    disponible: configurado_(),
    modelo: modelo_(),
    usadas_hoy: usadas,
    tope_dia: topeDia_(),
    web: webActiva_(),
    explora_tablas: puedeExplorar_(contexto)
  };
}

/** Consumo del mes (solo ADM / super admin): preguntas y costo estimado por persona. */
function uso(db, data, contexto) {
  if (!puedeExplorar_(contexto)) return { _forbidden: true, message: 'Solo Administración ve el consumo del asistente.' };
  const mes = /^\d{4}-\d{2}$/.test(String((data && data.mes) || '')) ? data.mes : hoy_().slice(0, 7);
  const filas = tablaExiste_(db, 'ASISTENTE_USO') ? leerFilas_(db, 'ASISTENTE_USO', COLUMNAS.ASISTENTE_USO).filter((f) => String(f.dia || '').slice(0, 7) === mes) : [];
  const porPersona = {};
  let total = 0;
  filas.forEach((f) => {
    const k = f.email || f.cuenta_id;
    const x = porPersona[k] = porPersona[k] || { email: k, preguntas: 0, costo_usd: 0 };
    x.preguntas++; x.costo_usd += Number(f.costo_usd) || 0; total += Number(f.costo_usd) || 0;
  });
  return {
    mes, preguntas: filas.length, costo_usd: Math.round(total * 100) / 100,
    personas: Object.values(porPersona).map((x) => Object.assign(x, { costo_usd: Math.round(x.costo_usd * 100) / 100 })).sort((a, b) => b.costo_usd - a.costo_usd)
  };
}

// --- adjuntos (en memoria, unas horas) --------------------------------------------------

const ADJUNTOS = new Map(); // adjunto_id -> { cuenta_id, nombre, bloque, bytes, expira }
const TTL_ADJUNTO_MS = 8 * 60 * 60 * 1000;
const TOPE_MEMORIA = 400 * 1024 * 1024;
const TOPE_PDF = 24 * 1024 * 1024;
const TOPE_IMAGEN = 5 * 1024 * 1024;
const TOPE_OFFICE = 30 * 1024 * 1024;
const IMAGENES = { 'image/png': 1, 'image/jpeg': 1, 'image/gif': 1, 'image/webp': 1 };

function purgarAdjuntos_() {
  const ahora = Date.now();
  let total = 0;
  ADJUNTOS.forEach((a, k) => { if (a.expira < ahora) ADJUNTOS.delete(k); else total += a.bytes; });
  for (const [k, a] of ADJUNTOS) { if (total <= TOPE_MEMORIA) break; ADJUNTOS.delete(k); total -= a.bytes; }
}

/**
 * Convierte un archivo (base64) en el bloque que entiende Claude.
 * Devuelve { bloque, resumen } o { error }.
 */
function bloqueDeArchivo_(nombre, mime, base64) {
  nombre = String(nombre || 'archivo').slice(0, 200);
  mime = String(mime || '').toLowerCase();
  const b64 = String(base64 || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!b64) return { error: 'El archivo viene vacío.' };
  const bytes = Math.floor(b64.length * 3 / 4);
  const ext = (/\.([a-z0-9]+)$/i.exec(nombre) || [])[1] || '';
  if (mime === 'application/pdf' || /^pdf$/i.test(ext)) {
    if (bytes > TOPE_PDF) return { error: 'El PDF pesa más de 24 MB; divídelo o comprímelo.' };
    return { bloque: { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 }, title: nombre }, resumen: 'PDF', bytes };
  }
  if (IMAGENES[mime] || /^(png|jpe?g|gif|webp)$/i.test(ext)) {
    const tipo = IMAGENES[mime] ? mime : ('image/' + ext.toLowerCase().replace('jpg', 'jpeg'));
    if (bytes > TOPE_IMAGEN) return { error: 'La imagen pesa más de 5 MB; achícala o envía una captura.' };
    return { bloque: { type: 'image', source: { type: 'base64', media_type: tipo, data: b64 } }, resumen: 'imagen', bytes };
  }
  const office = TextoDeArchivo.tipoOffice(nombre, mime);
  if (office) {
    if (bytes > TOPE_OFFICE) return { error: 'El archivo pesa más de 30 MB.' };
    try {
      const r = TextoDeArchivo.extraer(Buffer.from(b64, 'base64'), office);
      if (!r.texto.trim()) return { error: 'No encontré texto en «' + nombre + '».' };
      const nota = r.recortado ? '\n\n[Archivo muy largo: se incluyó solo la primera parte.]' : '';
      return { bloque: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: r.texto + nota }, title: nombre }, resumen: { docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint' }[office], bytes: r.texto.length * 2 };
    } catch (e) {
      return { error: 'No pude leer «' + nombre + '»: ' + e.message };
    }
  }
  if (/^text\//.test(mime) || /^(txt|csv|md|json|xml|html?|log|tsv)$/i.test(ext)) {
    let texto = Buffer.from(b64, 'base64').toString('utf8');
    const recortado = texto.length > TextoDeArchivo.TOPE_TEXTO;
    if (recortado) texto = texto.slice(0, TextoDeArchivo.TOPE_TEXTO) + '\n\n[Archivo muy largo: se incluyó solo la primera parte.]';
    if (!texto.trim()) return { error: 'El archivo de texto viene vacío.' };
    return { bloque: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: texto }, title: nombre }, resumen: 'texto', bytes: texto.length * 2 };
  }
  if (/^(doc|xls|ppt)$/i.test(ext)) return { error: 'Los formatos antiguos de Office (.doc, .xls, .ppt) no se pueden leer: guárdalo como .docx, .xlsx, .pptx o PDF.' };
  return { error: 'Formato no soportado («' + nombre + '»). Sirven PDF, Word, Excel, PowerPoint, imágenes y texto.' };
}

/** Acción `asistenteAdjuntar`: { nombre, mime, contenido_base64 } -> { adjunto_id, nombre, tipo }. */
function adjuntar(db, data, contexto) {
  if (!puedeUsar(contexto)) return { _forbidden: true, message: 'Tu cuenta no tiene el Asistente SIGSO.' };
  const d = data || {};
  const r = bloqueDeArchivo_(d.nombre, d.mime, d.contenido_base64);
  if (r.error) return { _validationError: true, message: r.error, fields: { contenido_base64: r.error } };
  purgarAdjuntos_();
  const id = crypto.randomUUID();
  ADJUNTOS.set(id, { cuenta_id: contexto.cuenta_id, nombre: String(d.nombre || 'archivo').slice(0, 200), bloque: r.bloque, bytes: r.bytes, expira: Date.now() + TTL_ADJUNTO_MS });
  return { adjunto_id: id, nombre: String(d.nombre || 'archivo').slice(0, 200), tipo: r.resumen };
}

function bloqueDeAdjunto_(id, contexto) {
  const a = ADJUNTOS.get(String(id || ''));
  if (!a || a.expira < Date.now() || a.cuenta_id !== contexto.cuenta_id) return null;
  a.expira = Date.now() + TTL_ADJUNTO_MS; // se usa: dura más
  return a.bloque;
}

// --- manuales ---------------------------------------------------------------------------

let manuales_ = null;
function carpetaManuales_() { return process.env.SIGSO_MANUALES_DIR || path.join(__dirname, '..', '..', 'frontend', 'manuales'); }

function limpiarFormato_(t) {
  return String(t == null ? '' : t).replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[\[(.+?)\]\]/g, '«$1»').replace(/\(\((\d+)\)\)/g, '($1)').replace(/`(.+?)`/g, '"$1"');
}
function aplanar_(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.reduce((a, x) => a.concat(aplanar_(x)), []);
  if (typeof v === 'object') return [];
  return [limpiarFormato_(v)];
}

/** Lee los manuales una vez y los parte en secciones (una por capítulo). */
function manuales_cargar_() {
  if (manuales_) return manuales_;
  const secciones = [];
  const registrados = [];
  let indice = [];
  const sandbox = { SigsoManual: { registrar: (def) => registrados.push(def), indice: (l) => { indice = l || []; }, marcas: () => {} }, window: {} };
  sandbox.window.SigsoManual = sandbox.SigsoManual;
  vm.createContext(sandbox);
  let archivos = [];
  try { archivos = fs.readdirSync(carpetaManuales_()).filter((f) => /\.js$/.test(f)); } catch (e) { archivos = []; }
  archivos.forEach((f) => {
    try { vm.runInContext(fs.readFileSync(path.join(carpetaManuales_(), f), 'utf8'), sandbox, { timeout: 2000 }); } catch (e) { console.error('asistente: manual ' + f + ' no se pudo leer:', e.message); }
  });
  registrados.forEach((m) => {
    const cabecera = 'Manual «' + (m.titulo || m.id) + '»' + (m.para ? ' (para: ' + limpiarFormato_(m.para) + ')' : '');
    const intro = aplanar_(m.resumen).concat(aplanar_(m.antes)).join('\n');
    if (intro) secciones.push({ titulo: cabecera + ' › Introducción', texto: intro });
    (m.capitulos || []).forEach((c) => {
      const lineas = aplanar_(c.intro);
      (c.pasos || []).forEach((p, i) => {
        lineas.push('Paso ' + (i + 1) + ': ' + limpiarFormato_(p.titulo || ''));
        lineas.push.apply(lineas, aplanar_(p.texto));
        (p.marcas || []).forEach((mk) => lineas.push('  (' + mk.n + ') ' + limpiarFormato_(mk.t)));
        aplanar_(p.consejo).forEach((x) => lineas.push('  Consejo: ' + x));
        aplanar_(p.cuidado).forEach((x) => lineas.push('  Cuidado: ' + x));
      });
      aplanar_(c.consejo).forEach((x) => lineas.push('Consejo: ' + x));
      secciones.push({ titulo: cabecera + ' › ' + limpiarFormato_(c.titulo || c.id) + (c.ruta ? ' (en SIGSO: ' + c.ruta + ')' : ''), texto: lineas.join('\n') });
    });
  });
  indice.forEach((e) => { if (e && e.titulo) secciones.push({ titulo: 'Índice de manuales › ' + e.titulo, texto: limpiarFormato_(e.resumen || '') + (e.modulos ? ' (módulos: ' + e.modulos.join(', ') + ')' : '') }); });
  manuales_ = secciones;
  return manuales_;
}

function normalizar_(t) { return String(t == null ? '' : t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
const VACIAS = new Set('para como cual cuál donde dónde que qué los las del una uno unos unas con por sin sobre esta este esto hay hacer puedo puede tengo tiene sigso entre desde hasta cuando'.split(' ').map(normalizar_));

function buscarEnManuales_(consulta) {
  const secciones = manuales_cargar_();
  if (!secciones.length) return 'Los manuales no están disponibles en este servidor.';
  const palabras = normalizar_(consulta).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 3 && !VACIAS.has(w));
  if (!palabras.length) return 'Indica palabras clave para buscar en los manuales.';
  const puntaje = secciones.map((s) => {
    const titulo = normalizar_(s.titulo), texto = normalizar_(s.texto);
    let p = 0;
    palabras.forEach((w) => {
      const raiz = w.length > 5 ? w.slice(0, w.length - 2) : w; // plural/singular aproximado
      if (titulo.indexOf(raiz) !== -1) p += 4;
      const n = texto.split(raiz).length - 1;
      if (n) p += 1 + Math.min(n, 5);
    });
    return { s, p };
  }).filter((x) => x.p > 0).sort((a, b) => b.p - a.p).slice(0, 4);
  if (!puntaje.length) return 'No encontré nada sobre eso en los manuales. Hay manuales de: ' + Array.from(new Set(secciones.map((s) => s.titulo.split(' › ')[0]))).join('; ') + '.';
  return puntaje.map((x) => '## ' + x.s.titulo + '\n' + x.s.texto.slice(0, 3500)).join('\n\n');
}

// --- ejecutar acciones de lectura con la sesión de la persona ---------------------------

/**
 * Corre una acción del router con el contexto de la persona. La parte síncrona
 * (que es donde las acciones de SQLite leen y escribirían) va dentro de un
 * SAVEPOINT que siempre se deshace.
 */
async function correrAccion_(db, accion, params, contexto) {
  const { ACCIONES } = require('../server/router');
  const fn = ACCIONES[accion];
  if (!fn) return { error: 'La consulta «' + accion + '» no existe.' };
  const data = Object.assign({}, params || {});
  delete data.portal_token; delete data.cliente_token;
  let pendiente;
  db.exec('SAVEPOINT asistente_lectura');
  try {
    pendiente = fn(db, data, Object.assign({}, contexto, { via_asistente: true }));
  } catch (e) {
    pendiente = Promise.reject(e);
  } finally {
    db.exec('ROLLBACK TO asistente_lectura');
    db.exec('RELEASE asistente_lectura');
  }
  let r;
  try { r = await pendiente; } catch (e) { return { error: 'La consulta falló: ' + (e && e.message ? e.message : String(e)) }; }
  if (r && r._forbidden) return { error: 'Sin acceso: ' + (r.message || 'tu cuenta no puede ver esto.') };
  if (r && r._noEncontrado) return { error: 'Sin acceso: tu cuenta no puede ver esto.' };
  if (r && r._validationError) return { error: 'Faltan o no sirven los parámetros: ' + (r.message || '') + (r.fields ? ' ' + JSON.stringify(r.fields) : '') };
  if (r && r.ok === false && r.message) return { error: r.message };
  return { datos: r };
}

// --- ver: filtrar, agrupar y contar filas sin mandarlas todas al modelo -----------------

function valorDe_(obj, ruta) {
  if (!ruta) return obj;
  return String(ruta).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function primerArreglo_(datos) {
  if (Array.isArray(datos)) return { ruta: '', filas: datos };
  if (!datos || typeof datos !== 'object') return null;
  let mejor = null;
  Object.keys(datos).forEach((k) => { if (Array.isArray(datos[k]) && (!mejor || datos[k].length > mejor.filas.length)) mejor = { ruta: k, filas: datos[k] }; });
  return mejor;
}

function comparar_(v, op, valor) {
  const tv = normalizar_(typeof v === 'object' && v !== null ? JSON.stringify(v) : v).trim();
  const tx = normalizar_(valor).trim();
  const nv = Number(v), nx = Number(valor);
  const numeros = v !== '' && v != null && valor !== '' && valor != null && !isNaN(nv) && !isNaN(nx);
  switch (op) {
    case '=': return numeros ? nv === nx : tv === tx;
    case '!=': return numeros ? nv !== nx : tv !== tx;
    case 'contiene': return tv.indexOf(tx) !== -1;
    case 'no_contiene': return tv.indexOf(tx) === -1;
    case 'empieza': return tv.indexOf(tx) === 0;
    case '>': return numeros ? nv > nx : tv > tx;
    case '>=': return numeros ? nv >= nx : tv >= tx;
    case '<': return numeros ? nv < nx : tv < tx;
    case '<=': return numeros ? nv <= nx : tv <= tx;
    case 'vacio': return tv === '' || v == null || v === false;
    case 'no_vacio': return !(tv === '' || v == null || v === false);
    case 'en': return (Array.isArray(valor) ? valor : String(valor).split(',')).map((x) => normalizar_(x).trim()).indexOf(tv) !== -1;
    default: return true;
  }
}

function aplicarVer_(datos, ver) {
  const v = ver || {};
  let base;
  if (v.ruta) {
    const filas = valorDe_(datos, v.ruta);
    if (!Array.isArray(filas)) return { error: 'En el resultado, «' + v.ruta + '» no es una lista. Claves disponibles: ' + Object.keys(datos || {}).join(', ') };
    base = { ruta: v.ruta, filas };
  } else {
    base = primerArreglo_(datos);
    if (!base) return { error: 'El resultado no trae una lista que filtrar. Consulta sin «ver».' };
  }
  let filas = base.filas;
  (v.filtro || []).forEach((f) => { if (f && f.campo) filas = filas.filter((x) => comparar_(valorDe_(x, f.campo), f.op || '=', f.valor)); });
  const res = { lista: base.ruta || '(raíz)', total_en_lista: base.filas.length, coinciden: filas.length };
  if (v.agrupar_por) {
    const grupos = {};
    const campos = [].concat(v.agrupar_por);
    filas.forEach((x) => {
      const k = campos.map((c) => { const val = valorDe_(x, c); return val === '' || val == null ? '(vacío)' : (typeof val === 'object' ? JSON.stringify(val) : String(val)); }).join(' | ');
      grupos[k] = (grupos[k] || 0) + 1;
    });
    res.agrupado_por = campos.join(' | ');
    res.grupos = Object.keys(grupos).map((k) => ({ valor: k, cantidad: grupos[k] })).sort((a, b) => b.cantidad - a.cantidad).slice(0, 200);
  }
  if (!v.contar) {
    const limite = Math.max(1, Math.min(Number(v.limite) || 40, 300));
    let salida = filas.slice(0, limite);
    if (Array.isArray(v.campos) && v.campos.length) {
      salida = salida.map((x) => { const o = {}; v.campos.forEach((c) => { o[c] = valorDe_(x, c); }); return o; });
    }
    res.filas = salida;
    if (filas.length > limite) res.nota = 'Se muestran ' + limite + ' de ' + filas.length + ' filas que coinciden. Usa filtro, agrupar_por, campos o un limite mayor.';
  }
  return { datos: res };
}

const CLAVES_OCULTAS = /base64|password|^salt$|contrasena|hash|token|secret|privad|p256dh|llave|^auth$|^clave$/i;

function compactar_(v, maxItems, prof) {
  if (prof > 12) return '…';
  if (Array.isArray(v)) {
    const out = v.slice(0, maxItems).map((x) => compactar_(x, maxItems, prof + 1));
    if (v.length > maxItems) out.push({ _omitidos: v.length - maxItems, _nota: 'lista recortada: usa «ver» para filtrar/agrupar/contar' });
    return out;
  }
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).forEach((k) => {
      if (CLAVES_OCULTAS.test(k)) return;
      const x = v[k];
      if (x === '' || x == null) return; // vacíos: ahorran espacio
      o[k] = compactar_(x, maxItems, prof + 1);
    });
    return o;
  }
  if (typeof v === 'string' && v.length > 1500) return v.slice(0, 1500) + '…[recortado]';
  return v;
}

function aTexto_(datos) {
  for (const n of [60, 25, 10, 4]) {
    const t = JSON.stringify(compactar_(datos, n, 0));
    if (t.length <= TOPE_RESULTADO) return t;
  }
  return JSON.stringify(compactar_(datos, 3, 0)).slice(0, TOPE_RESULTADO) + '…[resultado muy grande, recortado: usa «ver» para filtrar o agrupar]';
}

// --- explorar tablas (ADM / super admin) ------------------------------------------------

const TABLAS_BLOQUEADAS = new Set(['SESIONES_PORTAL', 'RESETS_PASSWORD', 'CI_ROBOT_AGENTES', 'PORTAL_SESIONES', 'PORTAL_PUSH', 'PORTAL_PUSH_CLAVES']);
function tablasExplorables_() { return Object.keys(COLUMNAS).filter((t) => !TABLAS_BLOQUEADAS.has(t)).sort(); }

function explorarTabla_(db, input) {
  const tabla = String(input.tabla || '');
  if (tablasExplorables_().indexOf(tabla) === -1) return { error: 'Tabla no disponible: ' + tabla };
  if (!tablaExiste_(db, tabla)) return { error: 'La tabla ' + tabla + ' no existe todavía en este servidor.' };
  const columnas = COLUMNAS[tabla].filter((c) => !CLAVES_OCULTAS.test(c));
  const filas = leerFilas_(db, tabla, COLUMNAS[tabla]).map((f) => {
    const o = {};
    columnas.forEach((c) => { o[c] = f[c]; });
    return o;
  });
  const r = aplicarVer_(filas, input.ver || {});
  if (r.datos) r.datos.columnas = columnas;
  return r;
}

// --- archivos de SIGSO ------------------------------------------------------------------

async function leerArchivoSigso_(db, input, contexto) {
  const def = ARCHIVOS[String(input.origen || '')];
  if (!def) return { error: 'Origen no válido. Usa: ' + Object.keys(ARCHIVOS).join(', ') };
  const r = await correrAccion_(db, def.accion, input.parametros || {}, contexto);
  if (r.error) return r;
  const a = r.datos || {};
  if (!a.contenido_base64) return { error: 'El archivo no trae contenido.' };
  const b = bloqueDeArchivo_(a.nombre_archivo, a.mime, a.contenido_base64);
  if (b.error) return { error: b.error };
  return { bloques: [{ type: 'text', text: 'Archivo «' + (a.nombre_archivo || 'archivo') + '» (' + b.resumen + '):' }, b.bloque] };
}

// --- definición de herramientas --------------------------------------------------------

const ESQUEMA_VER = {
  type: 'object',
  description: 'Opcional. Trabaja la lista de filas del resultado aquí mismo (más rápido y exacto que traer todo): filtra, agrupa y cuenta.',
  properties: {
    ruta: { type: 'string', description: 'Dónde está la lista dentro del resultado (ej. "registros"). Si se omite, se usa la lista más grande.' },
    filtro: {
      type: 'array',
      description: 'Condiciones (todas deben cumplirse). campo admite rutas con punto, ej. "datos.estatus". Texto sin importar mayúsculas ni tildes.',
      items: {
        type: 'object',
        properties: {
          campo: { type: 'string' },
          op: { type: 'string', enum: ['=', '!=', 'contiene', 'no_contiene', 'empieza', '>', '>=', '<', '<=', 'vacio', 'no_vacio', 'en'] },
          valor: { description: 'Valor a comparar (para "en", lista separada por comas).' }
        },
        required: ['campo', 'op']
      }
    },
    agrupar_por: { description: 'Campo (o lista de campos) por el que contar las filas, ej. "situacion" o ["responsable_email","situacion"].' },
    campos: { type: 'array', items: { type: 'string' }, description: 'Solo estos campos de cada fila (ej. ["cliente_nombre","situacion","datos.fecha_declaracion"]).' },
    limite: { type: 'integer', description: 'Máximo de filas a devolver (por defecto 40, tope 300).' },
    contar: { type: 'boolean', description: 'true = solo totales y grupos, sin filas.' }
  }
};

function herramientas_(contexto) {
  const lista = [
    {
      name: 'consultar_sigso',
      description: 'Consulta datos REALES de SIGSO con los permisos de la persona. `accion` es una de las consultas del catálogo del prompt de sistema; `parametros` sus parámetros. Usa `ver` para filtrar/agrupar/contar listas largas.',
      input_schema: {
        type: 'object',
        properties: {
          accion: { type: 'string', enum: CATALOGO.map((c) => c[0]) },
          parametros: { type: 'object', description: 'Parámetros de la consulta (ver catálogo).' },
          ver: ESQUEMA_VER
        },
        required: ['accion']
      }
    },
    {
      name: 'leer_archivo_sigso',
      description: 'Abre y lee un archivo guardado en SIGSO (documento del SGC, documento de proyecto o adjunto de novedad) que la persona puede descargar. PDF, Word, Excel, PowerPoint e imágenes.',
      input_schema: {
        type: 'object',
        properties: {
          origen: { type: 'string', enum: Object.keys(ARCHIVOS) },
          parametros: { type: 'object', description: 'sgc: { documento_id } · proyecto: { proyecto_id, documento_id } · novedad: { novedad_id }' }
        },
        required: ['origen', 'parametros']
      }
    },
    {
      name: 'buscar_en_manuales',
      description: 'Busca en los manuales de uso de SIGSO cómo se hace algo (pasos, botones, dónde está). Úsala para preguntas de "¿cómo…?" o "¿dónde…?".',
      input_schema: { type: 'object', properties: { consulta: { type: 'string', description: 'Palabras clave, ej. "comprometer fecha solicitud".' } }, required: ['consulta'] }
    }
  ];
  if (puedeExplorar_(contexto)) {
    lista.push({
      name: 'explorar_tabla',
      description: 'Solo Administración: lee una tabla cruda de la base de SIGSO (sin claves ni tokens) y la filtra/agrupa/cuenta con `ver`. Úsala cuando ninguna consulta del catálogo sirve. Las celdas de tipo objeto (ej. `datos`) admiten rutas con punto.',
      input_schema: {
        type: 'object',
        properties: { tabla: { type: 'string', enum: tablasExplorables_() }, ver: ESQUEMA_VER },
        required: ['tabla']
      }
    });
  }
  if (webActiva_()) {
    lista.push({ type: 'web_search_20260209', name: 'web_search', max_uses: 4, user_location: { type: 'approximate', country: 'CL', timezone: 'America/Santiago' } });
  }
  return lista;
}

/** Texto corto para mostrar en pantalla mientras corre una herramienta. */
function descripcionHerramienta_(nombre, input) {
  const i = input || {};
  if (nombre === 'consultar_sigso') return 'Consultando ' + (MODULO_DE_ACCION[i.accion] || 'SIGSO') + ' (' + i.accion + ')';
  if (nombre === 'leer_archivo_sigso') return 'Abriendo un archivo de ' + ({ sgc: 'Calidad', proyecto: 'Proyectos', novedad: 'Novedades' }[i.origen] || 'SIGSO');
  if (nombre === 'buscar_en_manuales') return 'Buscando en los manuales: ' + String(i.consulta || '').slice(0, 60);
  if (nombre === 'explorar_tabla') return 'Revisando la tabla ' + i.tabla;
  return 'Trabajando';
}

async function ejecutarHerramienta_(db, nombre, input, contexto) {
  input = input || {};
  let r;
  if (nombre === 'consultar_sigso') {
    if (!ACCIONES_LECTURA.has(input.accion)) return { texto: 'Error: «' + input.accion + '» no está en el catálogo de consultas.', error: true };
    r = await correrAccion_(db, input.accion, input.parametros, contexto);
    if (!r.error && input.ver && Object.keys(input.ver).length) r = aplicarVer_(r.datos, input.ver);
  } else if (nombre === 'leer_archivo_sigso') {
    r = await leerArchivoSigso_(db, input, contexto);
    if (r.bloques) return { bloques: r.bloques };
  } else if (nombre === 'buscar_en_manuales') {
    return { texto: buscarEnManuales_(input.consulta) };
  } else if (nombre === 'explorar_tabla') {
    if (!puedeExplorar_(contexto)) return { texto: 'Error: solo Administración puede explorar tablas.', error: true };
    r = explorarTabla_(db, input);
  } else {
    return { texto: 'Error: herramienta desconocida ' + nombre, error: true };
  }
  if (r.error) return { texto: r.error, error: true };
  return { texto: aTexto_(r.datos) };
}

// --- la conversación --------------------------------------------------------------------

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function nombreDe_(db, email) {
  try {
    const P = require('./directorioPersonas');
    if (P.resolverPersonas) {
      const r = P.resolverPersonas(db, { emails: [email] }, { rol: 'ADM', email });
      const x = r && r.personas && r.personas[String(email || '').trim().toLowerCase()];
      if (x && x.nombre) return x.nombre + (x.cargo ? ', ' + x.cargo : '');
    }
  } catch (e) { /* sin nombre: basta el correo */ }
  return '';
}

/** Contexto de la pregunta (fecha, persona, pantalla): va en el mensaje, no en el sistema, para no romper la caché. */
function textoContexto_(db, contexto, pantalla) {
  const ahora = new Date();
  const p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false })
    .formatToParts(ahora).forEach((x) => { p[x.type] = x.value; });
  const fecha = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  const nombre = nombreDe_(db, contexto.email);
  return '[Contexto: hoy es ' + DIAS[fecha.getUTCDay()] + ' ' + Number(p.day) + ' de ' + MESES[Number(p.month) - 1] + ' de ' + p.year +
    ', ' + p.hour + ':' + p.minute + ' (Chile); período actual "' + p.year + '-M' + p.month + '". Pregunta ' + (nombre ? nombre + ' <' + contexto.email + '>' : contexto.email) +
    ', rol ' + (contexto.rol_origen || contexto.rol) + (contexto.super_admin ? ' (super admin)' : '') +
    (contexto.modulos && contexto.modulos.length ? ', módulos: ' + contexto.modulos.join(', ') : '') +
    (pantalla ? '. Tiene abierta la pantalla ' + String(pantalla).slice(0, 80) : '') + '.]';
}

function mensajeUsuario_(contexto, turno) {
  const contenido = [];
  (turno.adjuntos || []).forEach((id) => {
    const b = bloqueDeAdjunto_(id, contexto);
    contenido.push(b || { type: 'text', text: '[Un archivo adjunto de esta pregunta ya no está disponible (pasaron varias horas): pide que lo vuelvan a adjuntar si hace falta.]' });
  });
  const texto = (turno.contexto ? String(turno.contexto).slice(0, 1200) + '\n\n' : '') + String(turno.texto || '').slice(0, 20000);
  contenido.push({ type: 'text', text: texto || '(sin texto)' });
  return { role: 'user', content: contenido };
}

function clienteAnthropic_() {
  const mod = require('@anthropic-ai/sdk');
  const Anthropic = mod.default || mod;
  return { cliente: new Anthropic({ maxRetries: 2 }), Anthropic };
}

function mensajeDeError_(e, Anthropic) {
  if (Anthropic) {
    if (e instanceof Anthropic.AuthenticationError) return 'La clave de la API de Claude no es válida. Avísale a Administración del sistema.';
    if (e instanceof Anthropic.PermissionDeniedError) return 'La cuenta de Claude no tiene permiso para este modelo. Avísale a Administración del sistema.';
    if (e instanceof Anthropic.RateLimitError) return 'Hay muchas preguntas al mismo tiempo. Intenta de nuevo en un minuto.';
    if (e instanceof Anthropic.BadRequestError) return 'No pude procesar la pregunta (' + String(e.message || '').slice(0, 200) + ').';
    if (e instanceof Anthropic.APIConnectionError) return 'No hay conexión con el servicio de IA. Intenta de nuevo en un momento.';
    if (e instanceof Anthropic.APIError) return 'El servicio de IA respondió con un error (' + (e.status || '') + '). Intenta de nuevo.';
  }
  if (e && e.name === 'AbortError') return 'Pregunta cancelada.';
  return 'Ocurrió un error inesperado: ' + String((e && e.message) || e).slice(0, 200);
}

/**
 * Responde una pregunta y va emitiendo eventos:
 *   { tipo:'contexto', texto }   guárdalo con la pregunta y reenvíalo en el historial
 *   { tipo:'estado', texto }     qué está haciendo (consultando, leyendo…)
 *   { tipo:'texto', t }          trozo de la respuesta
 *   { tipo:'fin', usadas_hoy, tope_dia }
 *   { tipo:'error', mensaje }
 *
 * cuerpo: { portal_token, pregunta, adjuntos:[ids], historial:[{rol:'usuario'|'asistente', texto, contexto?, adjuntos?}], pantalla }
 * opciones: { senal (AbortSignal), cliente (para tests), Anthropic }
 */
async function conversar(db, cuerpo, emitir, opciones) {
  const op = opciones || {};
  const { resolverContextoPortal_ } = require('../server/router');
  const contexto = resolverContextoPortal_(db, (cuerpo || {}).portal_token);
  if (!contexto) return emitir({ tipo: 'error', mensaje: 'Sesión inválida o expirada. Ingresa de nuevo.' });
  if (!puedeUsar(contexto)) return emitir({ tipo: 'error', mensaje: 'Tu cuenta no tiene el Asistente SIGSO. Pídelo a Administración del sistema.' });
  const pregunta = String(cuerpo.pregunta || '').trim();
  if (!pregunta && !(cuerpo.adjuntos || []).length) return emitir({ tipo: 'error', mensaje: 'Escribe tu pregunta.' });
  if (!op.cliente && !configurado_()) return emitir({ tipo: 'error', mensaje: 'El asistente todavía no está configurado en el servidor (falta la clave de la API de Claude). Avísale a Administración del sistema.' });
  const usadas = usosDeHoy_(db, contexto.cuenta_id);
  if (usadas >= topeDia_()) return emitir({ tipo: 'error', mensaje: 'Llegaste al máximo de ' + topeDia_() + ' preguntas por hoy. Mañana se renueva.' });

  let cliente = op.cliente, Anthropic = op.Anthropic;
  if (!cliente) { const c = clienteAnthropic_(); cliente = c.cliente; Anthropic = c.Anthropic; }

  const ctxTexto = textoContexto_(db, contexto, cuerpo.pantalla);
  emitir({ tipo: 'contexto', texto: ctxTexto });

  const mensajes = [];
  (Array.isArray(cuerpo.historial) ? cuerpo.historial : []).slice(-30).forEach((t) => {
    if (!t || !String(t.texto || '').trim() && !(t.adjuntos || []).length) return;
    if (t.rol === 'asistente') {
      if (mensajes.length && mensajes[mensajes.length - 1].role === 'user') mensajes.push({ role: 'assistant', content: [{ type: 'text', text: String(t.texto).slice(0, 30000) }] });
    } else if (!mensajes.length || mensajes[mensajes.length - 1].role === 'assistant') {
      mensajes.push(mensajeUsuario_(contexto, t));
    }
  });
  if (mensajes.length && mensajes[mensajes.length - 1].role === 'user') mensajes.pop(); // pregunta que quedó sin respuesta
  mensajes.push(mensajeUsuario_(contexto, { texto: pregunta, contexto: ctxTexto, adjuntos: cuerpo.adjuntos || [] }));

  const modelo = modelo_();
  const tools = herramientas_(contexto);
  const u = { modelo, input: 0, output: 0, cache_read: 0, cache_write: 0, herramientas: 0 };
  const inicio = Date.now();
  let error = '';
  let respuesta = '';

  try {
    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      const params = {
        model: modelo,
        max_tokens: 32000,
        system: [{ type: 'text', text: SISTEMA, cache_control: { type: 'ephemeral' } }],
        tools,
        messages: mensajes,
        cache_control: { type: 'ephemeral' },
        output_config: { effort: esfuerzo_() }
      };
      // Fallback del lado del servidor ante un rechazo de seguridad (modelos 5.5).
      if (/^claude-(opus|sonnet)-5-5$/.test(modelo)) { params.betas = ['server-side-fallback-2026-07-01']; params.fallbacks = 'default'; }
      if (vuelta > 0 && respuesta && !/\n\n$/.test(respuesta)) { emitir({ tipo: 'texto', t: '\n\n' }); respuesta += '\n\n'; }

      const stream = cliente.beta.messages.stream(params, op.senal ? { signal: op.senal } : undefined);
      stream.on('text', (delta) => { respuesta += delta; emitir({ tipo: 'texto', t: delta }); });
      if (stream.on) {
        stream.on('streamEvent', (ev) => {
          if (ev && ev.type === 'content_block_start' && ev.content_block && ev.content_block.type === 'server_tool_use') emitir({ tipo: 'estado', texto: 'Buscando en internet' });
        });
      }
      const msg = await stream.finalMessage();
      const us = msg.usage || {};
      u.input += us.input_tokens || 0; u.output += us.output_tokens || 0;
      u.cache_read += us.cache_read_input_tokens || 0; u.cache_write += us.cache_creation_input_tokens || 0;

      if (msg.stop_reason === 'refusal') {
        const t = '\n\nNo puedo ayudar con esa solicitud.';
        respuesta += t; emitir({ tipo: 'texto', t });
        break;
      }
      if (msg.stop_reason === 'pause_turn') { mensajes.push({ role: 'assistant', content: msg.content }); continue; }
      if (msg.stop_reason === 'max_tokens') {
        const t = '\n\n_(La respuesta quedó cortada por ser muy larga. Pídeme que continúe o que resuma.)_';
        respuesta += t; emitir({ tipo: 'texto', t });
        break;
      }
      const usos = (msg.content || []).filter((b) => b.type === 'tool_use');
      if (msg.stop_reason !== 'tool_use' || !usos.length) break;

      mensajes.push({ role: 'assistant', content: msg.content });
      const resultados = await Promise.all(usos.map(async (b) => {
        u.herramientas++;
        emitir({ tipo: 'estado', texto: descripcionHerramienta_(b.name, b.input) });
        let r;
        try { r = await ejecutarHerramienta_(db, b.name, b.input, contexto); } catch (e) { r = { texto: 'Error al ejecutar: ' + e.message, error: true }; }
        const out = { type: 'tool_result', tool_use_id: b.id, content: r.bloques || [{ type: 'text', text: r.texto || '(sin resultado)' }] };
        if (r.error) out.is_error = true;
        return out;
      }));
      mensajes.push({ role: 'user', content: resultados });
      if (vuelta === MAX_VUELTAS - 1) {
        const t = '\n\n_(Hice muchas consultas y me detuve. Pregúntame de forma más acotada para seguir.)_';
        respuesta += t; emitir({ tipo: 'texto', t });
      }
    }
  } catch (e) {
    error = mensajeDeError_(e, Anthropic);
    console.error('asistente: error en la conversación:', e && e.message);
    emitir({ tipo: 'error', mensaje: error });
  }
  registrarUso_(db, contexto, u, { ms: Date.now() - inicio, error: error.slice(0, 300) });
  if (!error) emitir({ tipo: 'fin', usadas_hoy: usadas + 1, tope_dia: topeDia_(), costo_usd: Math.round(costo_(modelo, u) * 10000) / 10000 });
}

module.exports = {
  conversar, estado, uso, adjuntar, puedeUsar,
  // para tests
  _interno: { aplicarVer_, compactar_, aTexto_, correrAccion_, ejecutarHerramienta_, buscarEnManuales_, bloqueDeArchivo_, herramientas_, textoContexto_, ADJUNTOS }
};
