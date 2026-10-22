'use strict';

/**
 * finanzasBase.js — piezas comunes del módulo Finanzas, versión 2 (2026-10-20;
 * instrucciones maestras FIN-03, FIN-06, FIN-07, FIN-08, FIN-42).
 *
 *  - Dinero y fechas estrictos: un texto monetario se entiende o se rechaza
 *    con su motivo (nunca NaN ni cero encubierto); las fechas son civiles
 *    (sin UTC que corra el día) y se validan contra el calendario real.
 *  - Errores que se distinguen: conflicto de versión, idempotencia con otro
 *    contenido, período cerrado, base no comparable, fuente no soportada.
 *    Viajan con `codigo` (router.js lo agrega al cuerpo de la respuesta).
 *  - Capacidades: qué puede hacer cada persona de la lista de la bóveda.
 *    Por defecto la lista opera todo y quien está en SIGSO_FINANZAS_SOLO_LECTURA
 *    solo consulta y exporta. SIGSO_FINANZAS_CAPACIDADES permite afinar por
 *    cuenta_id ("id1:CONSULTAR|EXPORTAR;id2:..."), sin dar acceso a nadie que
 *    no esté ya en la lista.
 *  - Idempotencia por comando: la misma clave con el mismo contenido devuelve
 *    el resultado anterior; con otro contenido, conflicto.
 *  - Migraciones aditivas: columnas nuevas en tablas existentes sin tocar datos.
 *  - Revisión de datos: un número que cambia con cada escritura de la bóveda
 *    (la conexión es una sola por proceso), para cachés y para que pantalla,
 *    comentario y PDF digan sobre qué datos se calcularon.
 */

const crypto = require('node:crypto');
const B = require('./finanzasBoveda');
const { errorValidacion, errorForbidden } = require('./errores');

// ---------------------------------------------------------------- dinero

/**
 * Texto monetario en pesos chilenos (como lo escribe una persona o lo pega
 * desde Excel) → { ok, valor } o { ok:false, error }.
 * Acepta: "10000000", "$10.000.000", "-1.234", "(1.234)", "1.234,00",
 * "1234,5" (se redondea al peso), números de JavaScript.
 * Rechaza lo ambiguo: "1.5", "1,234.56", "12.34", "1.2345", "abc", "".
 */
function montoClp_(v, opciones) {
  opciones = opciones || {};
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) {
    return opciones.vacioCero ? { ok: true, valor: 0 } : { ok: false, error: 'Falta el monto.' };
  }
  if (typeof v === 'number') {
    if (!isFinite(v)) return { ok: false, error: 'El monto no es un número.' };
    return { ok: true, valor: Math.round(v) };
  }
  let s = String(v).trim().replace(/\s+/g, '').replace(/^CLP/i, '').replace(/CLP$/i, '');
  let negativo = false;
  if (/^\(.*\)$/.test(s)) { negativo = true; s = s.slice(1, -1); }
  if (/^-/.test(s)) { negativo = !negativo; s = s.slice(1); }
  s = s.replace(/^\$/, '').replace(/^-/, () => { negativo = !negativo; return ''; });
  let n = null;
  if (/^\d+$/.test(s)) n = Number(s);
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) n = Number(s.replace(/\./g, ''));
  else if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) n = Number(s.replace(/\./g, '').replace(',', '.'));
  else if (/^\d+,\d+$/.test(s)) n = Number(s.replace(',', '.'));
  if (n === null || !isFinite(n)) return { ok: false, error: 'No se entiende el monto «' + String(v).slice(0, 30) + '» (usa 1.234.567 o 1234567).' };
  return { ok: true, valor: Math.round(negativo ? -n : n) };
}

/**
 * Valor numérico crudo de una celda de Excel (lo que entrega lector-xlsx.js
 * para una celda numérica: "1234", "-1234.5", "1.2E+7") → entero o null.
 */
function montoExcel_(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^-?\d+(\.\d+)?(E[+-]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return isFinite(n) ? Math.round(n) : null;
}

// ---------------------------------------------------------------- fechas civiles

function bisiesto_(a) { return (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0; }
function diasDelMes_(a, m) { return [31, bisiesto_(a) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }
function iso_(a, m, d) { return a + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
function valida_(a, m, d) { return a >= 1900 && a <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= diasDelMes_(a, m); }

/**
 * Fecha civil → 'AAAA-MM-DD' o '' si no se entiende o no existe en el
 * calendario. Acepta dd/mm/aaaa, dd-mm-aaaa, dd.mm.aaaa, aaaa-mm-dd y el
 * número de serie de Excel (sistema 1900). Sin conversiones de zona horaria.
 */
function fechaCivil_(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) { const d = +m[1], me = +m[2], a = +m[3]; return valida_(a, me, d) ? iso_(a, me, d) : ''; }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) { const a = +m[1], me = +m[2], d = +m[3]; return valida_(a, me, d) ? iso_(a, me, d) : ''; }
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    // Serie Excel: día 1 = 1900-01-01, con el 29-02-1900 ficticio de Excel.
    const n = Math.floor(Number(s));
    // Desde el 1-03-1900 (serie 61) la base es el 30-12-1899; antes, el 31-12-1899.
    const t = new Date(Date.UTC(1899, 11, n >= 61 ? 30 : 31) + n * 864e5);
    return iso_(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  return '';
}

const MESES_ = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
/** Período 'AAAA-MM' desde '2026-07', '07-2026', '07/2026', 'julio 2026', 'JUL-26' o una fecha. '' si no. */
function periodo_(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  let m = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (m) return +m[2] >= 1 && +m[2] <= 12 ? m[1] + '-' + String(+m[2]).padStart(2, '0') : '';
  m = /^(\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return +m[1] >= 1 && +m[1] <= 12 ? m[2] + '-' + String(+m[1]).padStart(2, '0') : '';
  const t = s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  m = /^([A-Z]+)[\s/-]*(?:DE\s+)?(\d{2}|\d{4})$/.exec(t);
  if (m) {
    const i = MESES_.findIndex((x) => x === m[1] || (m[1].length >= 3 && x.indexOf(m[1]) === 0));
    if (i !== -1) return (m[2].length === 2 ? '20' + m[2] : m[2]) + '-' + String(i + 1).padStart(2, '0');
  }
  const f = fechaCivil_(s);
  return f ? f.slice(0, 7) : '';
}
function ultimoDia_(periodo) { const [a, m] = String(periodo).split('-').map(Number); return iso_(a, m, diasDelMes_(a, m)); }
function mesSiguiente_(p) { const [a, m] = p.split('-').map(Number); return m === 12 ? (a + 1) + '-01' : a + '-' + String(m + 1).padStart(2, '0'); }
function mesAnterior_(p) { const [a, m] = p.split('-').map(Number); return m === 1 ? (a - 1) + '-12' : a + '-' + String(m - 1).padStart(2, '0'); }
function sumarDias_(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
// Distancia en días hábiles entre dos fechas ISO: el sábado y el domingo no cuentan. Una transferencia anotada el
// jueves que el banco contabiliza el lunes queda a 2 días, no a 4 (pasó con OSSES en septiembre: 17-09 → 21-09).
function diasHabiles_(a, b) {
  let x = String(a || '').slice(0, 10), y = String(b || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x) || !/^\d{4}-\d{2}-\d{2}$/.test(y)) return Infinity;
  if (x > y) [x, y] = [y, x];
  const t = Date.parse(y + 'T12:00:00Z'), total = Math.round((t - Date.parse(x + 'T12:00:00Z')) / 864e5);
  if (total > 60) return total;
  let n = 0;
  for (let d = new Date(x + 'T12:00:00Z'); d.getTime() < t;) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) n += 1; }
  return n;
}
// I12.2: crear un formateador de fechas cuesta; se crea una vez.
const FECHA_CL_ = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' });
function hoy_() { return FECHA_CL_.format(new Date()); }
/** Meses de desde a hasta, ambos incluidos (sin huecos). */
function rangoMeses_(desde, hasta) { const out = []; let p = desde; while (p <= hasta && out.length < 600) { out.push(p); p = mesSiguiente_(p); } return out; }

// ---------------------------------------------------------------- errores con código

function conCodigo_(e, codigo, extra) { e.codigo = codigo; return Object.assign(e, extra || {}); }
function errConflicto(mensaje, extra) { return conCodigo_(errorValidacion('version', mensaje || 'Otra persona cambió este registro mientras lo editabas. Revisa lo nuevo y vuelve a guardar.'), 'CONFLICTO_VERSION', extra); }
function errVersionRequerida_() { return conCodigo_(errorValidacion('expected_version', 'Falta la versión del registro que estás cambiando: recarga la pantalla y vuelve a guardar.'), 'VERSION_REQUERIDA'); }
function errIdempotencia() { return conCodigo_(errorValidacion('idempotency_key', 'Esa operación ya se registró con otro contenido. Recarga antes de volver a enviarla.'), 'IDEMPOTENCIA'); }
function errPeriodoCerrado(periodo) { return conCodigo_(errorValidacion('periodo', 'El mes ' + periodo + ' está cerrado. Reábrelo en «Cierre» si de verdad hay que corregir algo.'), 'PERIODO_CERRADO'); }
function errNoComparable(mensaje) { return conCodigo_(errorValidacion('base', mensaje || 'Las cifras no tienen una base comparable.'), 'BASE_NO_COMPARABLE'); }
function errFuente(mensaje) { return conCodigo_(errorValidacion('archivo', mensaje), 'FUENTE_NO_SOPORTADA'); }
function errPermiso(mensaje) { return conCodigo_(errorForbidden(mensaje || 'Tu acceso a Finanzas no permite esta acción.'), 'PERMISO'); }

// ---------------------------------------------------------------- capacidades

const CAPACIDADES = {
  CONSULTAR: 'Ver cifras e informes',
  REGISTRAR: 'Registrar operaciones, borradores y cargas',
  CONFIRMAR: 'Confirmar y clasificar movimientos',
  CONCILIAR: 'Conciliar con el banco',
  APLICAR: 'Aplicar abonos a facturas y cambiar su estado',
  FONDOS: 'Gestionar fondos de clientes',
  APERTURA: 'Aprobar saldos iniciales de fondos',
  PRESUPUESTO: 'Editar y aprobar el presupuesto',
  PLANIFICAR: 'Préstamos, gastos compartidos, provisiones y compromisos',
  CLIENTES: 'Fichas comerciales, servicios y documentos',
  REGLAS: 'Editar reglas, pagadores y nombres cortos',
  CIERRE: 'Revisar, cerrar y reabrir meses',
  EXPORTAR: 'Descargar informes y datos',
  CONFIGURAR: 'Catálogos y parámetros',
  MIGRAR: 'Cargar y publicar planillas anteriores'
};
const LECTURA_ = ['CONSULTAR', 'EXPORTAR'];

function lista_(variable) { return String(process.env[variable] || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean); }
function esSoloLectura_(contexto) { return lista_('SIGSO_FINANZAS_SOLO_LECTURA').indexOf(String((contexto && contexto.cuenta_id) || '').toLowerCase()) !== -1; }

/** Capacidades de una cuenta que YA pasó la lista de la bóveda. */
function capacidades_(contexto) {
  const id = String((contexto && contexto.cuenta_id) || '').toLowerCase();
  const fino = String(process.env.SIGSO_FINANZAS_CAPACIDADES || '').split(';').map((s) => s.trim()).filter(Boolean);
  for (const linea of fino) {
    const [quien, caps] = linea.split(':');
    if (String(quien || '').trim().toLowerCase() === id) {
      const lista = String(caps || '').split('|').map((c) => c.trim().toUpperCase()).filter((c) => CAPACIDADES[c]);
      // Solo lectura manda siempre: el ajuste fino no puede darle escritura.
      return esSoloLectura_(contexto) ? lista.filter((c) => LECTURA_.indexOf(c) !== -1) : lista;
    }
  }
  return esSoloLectura_(contexto) ? LECTURA_.slice() : Object.keys(CAPACIDADES);
}
function puede_(contexto, cap) { return capacidades_(contexto).indexOf(cap) !== -1; }
/** null si puede; si no, el error listo para devolver. */
function exigir_(contexto, cap) {
  if (puede_(contexto, cap)) return null;
  return esSoloLectura_(contexto) ? errPermiso('Tu acceso a Finanzas es de solo lectura.') : errPermiso('Tu acceso a Finanzas no incluye: ' + CAPACIDADES[cap].toLowerCase() + '.');
}
/** conBoveda + capacidad: la acción no corre si la cuenta no tiene esa capacidad. */
function conCapacidad(cap, accion, fn) {
  return B.conBoveda(accion, function (db, data, contexto, x) {
    const e = exigir_(contexto, cap);
    if (e) return e;
    return fn(db, data, contexto, x);
  });
}

// ---------------------------------------------------------------- esquema y migraciones aditivas

function columnas_(d, tabla) { try { return d.prepare('PRAGMA table_info(' + tabla + ')').all().map((c) => c.name); } catch (e) { return []; } }
/** Agrega una columna si la tabla existe y no la tiene. Nunca borra ni renombra. */
function asegurarColumna_(d, tabla, columna, definicion) {
  const cols = columnas_(d, tabla);
  if (!cols.length || cols.indexOf(columna) !== -1) return false;
  d.exec('ALTER TABLE ' + tabla + ' ADD COLUMN ' + columna + ' ' + definicion);
  return true;
}

let preparada_ = null;
function db_() {
  const d = B.dbFin();
  if (preparada_ === d) return d;
  d.exec(`CREATE TABLE IF NOT EXISTS FIN_IDEMPOTENCIA (
    clave TEXT PRIMARY KEY, cuenta_id TEXT, accion TEXT, digest TEXT NOT NULL, resultado TEXT, ts TEXT NOT NULL)`);
  preparada_ = d;
  return d;
}

// ---------------------------------------------------------------- idempotencia

function digest_(obj) { return crypto.createHash('sha256').update(JSON.stringify(obj === undefined ? null : obj)).digest('hex'); }
/**
 * Corre fn() una sola vez por (cuenta, acción, clave). Mismo contenido →
 * mismo resultado guardado; otro contenido → error de idempotencia. Sin
 * clave, corre siempre. El resultado se guarda cifrado.
 */
function idempotente_(contexto, accion, clave, contenido, fn) {
  const k = String(clave || '').trim();
  if (!k) return fn();
  if (k.length > 120) return errorValidacion('idempotency_key', 'Clave de reintento demasiado larga.');
  const d = db_();
  const h = crypto.createHash('sha256').update([contexto.cuenta_id, accion, k].join('|')).digest('hex');
  const dig = digest_(contenido);
  const previo = d.prepare('SELECT digest, resultado FROM FIN_IDEMPOTENCIA WHERE clave = ?').get(h);
  if (previo) {
    if (previo.digest !== dig) return errIdempotencia();
    return Object.assign(JSON.parse(B.descifrar(previo.resultado)), { repetido: true });
  }
  const r = fn();
  if (r && !r._validationError && !r._forbidden) {
    d.prepare('INSERT OR IGNORE INTO FIN_IDEMPOTENCIA (clave, cuenta_id, accion, digest, resultado, ts) VALUES (?,?,?,?,?,?)')
      .run(h, String(contexto.cuenta_id), accion, dig, B.cifrar(JSON.stringify(r)), new Date().toISOString());
  }
  return r;
}

// ---------------------------------------------------------------- revisión de datos y transacciones

const conexiones_ = new WeakMap(); // conexión → id propio (otra base, otra revisión)
let tablasRev_ = new WeakMap(); // conexión → cuántas tablas tenían su trigger
// Escrituras técnicas que NO cambian los datos financieros: abrir sesión, renovar inactividad, bitácora,
// autenticador y respuestas idempotentes. Antes contaban (total_changes) y cada pedido «cambiaba los datos».
// I11.3: el estado del cierre (envío a revisión, observaciones, versiones guardadas) es flujo de trabajo, no un dato
// financiero: si contara, enviar a revisión dejaría «vencida» su propia revisión.
const SIN_REVISION_ = ['FIN_SESIONES', 'FIN_BITACORA', 'FIN_AUTENTICADOR', 'FIN_IDEMPOTENCIA', 'FIN_REVISION', 'FIN_CIERRES', 'FIN_CIERRE_VERSIONES'];
function asegurarRevision_(d) {
  const n = d.prepare('PRAGMA schema_version').get().schema_version;
  if (tablasRev_.get(d) === n) return;
  d.exec('CREATE TABLE IF NOT EXISTS FIN_REVISION (id INTEGER PRIMARY KEY CHECK (id = 1), n INTEGER NOT NULL)');
  d.exec('INSERT OR IGNORE INTO FIN_REVISION (id, n) VALUES (1, 0)');
  const tablas = d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'FIN_%'").all().map((r) => r.name).filter((t) => /^FIN_[A-Z0-9_]+$/.test(t));
  // Una tabla que pasó a no contar pierde sus triggers (bases creadas antes de este cambio).
  tablas.filter((t) => SIN_REVISION_.indexOf(t) !== -1).forEach((t) => ['insert', 'update', 'delete'].forEach((op) => d.exec('DROP TRIGGER IF EXISTS rev_' + t + '_' + op)));
  tablas.filter((t) => SIN_REVISION_.indexOf(t) === -1).forEach((t) => {
      ['INSERT', 'UPDATE', 'DELETE'].forEach((op) => d.exec('CREATE TRIGGER IF NOT EXISTS rev_' + t + '_' + op.toLowerCase() + ' AFTER ' + op + ' ON ' + t + ' BEGIN UPDATE FIN_REVISION SET n = n + 1 WHERE id = 1; END'));
    });
  tablasRev_.set(d, d.prepare('PRAGMA schema_version').get().schema_version);
}
/**
 * I12.2 · Marca de una caché: la revisión y si se armó DENTRO de una transacción.
 * Si esa transacción se revierte, el contador vuelve atrás y la siguiente
 * escritura confirmada reutiliza el mismo número: una caché armada adentro
 * podría devolver datos que nunca existieron. Por eso solo vale dentro de su
 * transacción; afuera se rearma.
 */
function marcaCache_() { return { rev: revision_(), tx: !!B.dbFin().isTransaction }; }
/**
 * I12.2 · Memo de un cálculo caro por (clave, revisión). El resultado se congela:
 * quien lo use no puede modificarlo y dañar la caché de otros (fallaría a la vista).
 */
function memo_(tabla, clave, fn) {
  const c = tabla.get(clave);
  if (c && cacheVigente_(c.marca)) return c.v;
  if (tabla.size > 40) tabla.clear();
  const marca = marcaCache_();
  const v = congelar_(fn());
  tabla.set(clave, { marca, v });
  return v;
}
function congelar_(o) {
  if (!o || typeof o !== 'object' || Object.isFrozen(o)) return o;
  if (o instanceof Map) { o.forEach((v) => congelar_(v)); return o; }
  Object.freeze(o);
  Object.keys(o).forEach((k) => congelar_(o[k]));
  return o;
}
function cacheVigente_(c) {
  if (!c) return false;
  if (c.tx && !B.dbFin().isTransaction) return false;
  return c.rev === revision_();
}
/**
 * Revisión de los datos financieros: cambia con cada escritura de una tabla de
 * datos (I09.5: la pantalla, el PDF y la exportación comparan esta revisión).
 */
function revision_() {
  const d = B.dbFin();
  if (!conexiones_.has(d)) conexiones_.set(d, crypto.randomBytes(4).toString('hex'));
  asegurarRevision_(d);
  return conexiones_.get(d) + '-' + d.prepare('SELECT n FROM FIN_REVISION WHERE id = 1').get().n;
}

/**
 * Los módulos registran aquí cómo olvidar que su esquema está listo. Si una
 * transacción se revierte, un CREATE TABLE hecho dentro de ella también se
 * revierte: hay que volver a crearlo la próxima vez (si no, «no such table»).
 */
const esquemas_ = [];
function registrarEsquema_(olvidar) { esquemas_.push(olvidar); }
function olvidarEsquemas_() { esquemas_.forEach((f) => { try { f(); } catch (e) { /* nada */ } }); preparada_ = null; }
// Un trigger creado dentro de una transacción revertida también se pierde: volver a revisarlos.
registrarEsquema_(() => { tablasRev_ = new WeakMap(); });

/** Todo o nada: corre fn dentro de una transacción (anidable con SAVEPOINT). */
let profundidad_ = 0;
function transaccion_(fn) {
  const d = B.dbFin();
  const nombre = 'fin_sp_' + (++profundidad_);
  d.exec('SAVEPOINT ' + nombre);
  const revertir = () => { d.exec('ROLLBACK TO ' + nombre); d.exec('RELEASE ' + nombre); olvidarEsquemas_(); };
  try {
    const r = fn(d);
    if (r && (r._validationError || r._forbidden)) { revertir(); return r; }
    d.exec('RELEASE ' + nombre);
    return r;
  } catch (e) {
    try { revertir(); } catch (e2) { /* ya cerrada */ }
    throw e;
  } finally { profundidad_--; }
}

// ---------------------------------------------------------------- utilidades compartidas

const cif_ = (o) => B.cifrar(JSON.stringify(o));
const des_ = (t) => JSON.parse(B.descifrar(t));
const txt_ = (v) => String(v == null ? '' : v).trim();
function id_() { return crypto.randomUUID(); }
function ahora_() { return new Date().toISOString(); }
function normalizar_(s) {
  return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9& ]/g, ' ').replace(/\s+/g, ' ').trim();
}
/** RUT chileno: { original, normal ('12345678-9' o ''), valido } — el original se conserva siempre. */
function rut_(v) {
  const original = txt_(v);
  const s = original.replace(/[^0-9kK]/g, '').toUpperCase();
  if (s.length < 2) return { original, normal: '', valido: false };
  const cuerpo = s.slice(0, -1).replace(/^0+/, ''), dv = s.slice(-1);
  let suma = 0, mul = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { suma += Number(cuerpo[i]) * mul; mul = mul === 7 ? 2 : mul + 1; }
  const r = 11 - (suma % 11);
  const esperado = r === 11 ? '0' : r === 10 ? 'K' : String(r);
  return { original, normal: cuerpo + '-' + dv, valido: esperado === dv && cuerpo.length >= 6 };
}
const plata_ = (n) => { const v = Math.round(n || 0); return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('es-CL'); };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function nombreMes_(p) { const [a, m] = String(p).split('-').map(Number); return m ? MESES[m - 1] + ' ' + a : String(p); }

/**
 * Reparte un monto entero en partes según pesos, sin crear ni perder pesos:
 * redondea hacia abajo y entrega los pesos que sobran de a uno, a las partes
 * con mayor resto (empate: en el orden dado). Determinista.
 *   repartir_(100001, [1,1,1]) → [33334, 33334, 33333]
 */
function repartir_(monto, pesos) {
  const total = pesos.reduce((s, p) => s + p, 0);
  if (!(total > 0)) return pesos.map(() => 0);
  const signo = monto < 0 ? -1 : 1, abs = Math.abs(Math.round(monto));
  const crudo = pesos.map((p) => abs * p / total);
  const base = crudo.map(Math.floor);
  let resto = abs - base.reduce((s, x) => s + x, 0);
  const orden = crudo.map((c, i) => ({ i, f: c - Math.floor(c) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; resto > 0 && k < orden.length; k++, resto--) base[orden[k].i]++;
  return base.map((x) => x * signo);
}

module.exports = {
  // dinero y fechas
  montoClp_, montoExcel_, fechaCivil_, periodo_, ultimoDia_, mesSiguiente_, mesAnterior_, sumarDias_, diasHabiles_, hoy_, rangoMeses_, diasDelMes_,
  // errores
  errConflicto, errIdempotencia, errPeriodoCerrado, errNoComparable, errFuente, errPermiso,
  // capacidades
  CAPACIDADES, capacidades_, puede_, exigir_, conCapacidad, esSoloLectura_, errVersionRequerida_,
  // esquema, idempotencia, revisión
  asegurarColumna_, columnas_, db_, idempotente_, digest_, revision_, marcaCache_, cacheVigente_, memo_, transaccion_, registrarEsquema_,
  // utilidades
  cif_, des_, txt_, id_, ahora_, normalizar_, rut_, plata_, nombreMes_, repartir_, MESES
};
