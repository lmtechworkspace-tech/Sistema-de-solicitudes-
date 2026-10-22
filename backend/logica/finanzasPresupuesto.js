'use strict';

/**
 * finanzasPresupuesto.js — presupuesto y su ejecución (Etapa 5 del
 * 2026-10-06; versión 2 del 2026-10-20: FIN-28, FIN-34, FIN-35).
 *
 * El presupuesto de SIGECO (hoja PRESUPUESTO) tenía el mismo valor en todas
 * las celdas y los egresos como texto, así que el «proyectado vs real» daba
 * error. Aquí:
 *  - Un presupuesto por AÑO y EMPRESA, con una línea por concepto y 12
 *    montos. El grupo es la suma de las empresas (no otra copia).
 *  - VERSIONES: guardar crea un BORRADOR; APROBAR fija esa versión. Las
 *    comparaciones usan la última versión APROBADA (si solo hay borrador, se
 *    dice). Todas las versiones quedan en la historia.
 *  - BASE declarada: CASH_GROSS (cobros y pagos propios clasificados, montos
 *    completos) o DOCUMENT_NET (facturas netas por fecha de emisión, menos
 *    notas de crédito). Solo se compara con ejecución de la MISMA base; si no
 *    hay cómo (p. ej. gastos en base documental, sin facturas de compra), se
 *    dice «base no comparable».
 *  - Montos estrictos: una celda que no se entiende es un error con su
 *    concepto y mes, nunca un cero.
 *  - I10.1: un presupuesto anterior a las versiones queda como versión
 *    HEREDADA con su procedencia (quién lo cargó y cuándo); no se le inventa
 *    una aprobación. Se sigue comparando por compatibilidad, dicho así.
 *    La comparación del año usa solo los meses con cartolas (cobertura).
 */

const B = require('./finanzasBoveda');
const Base = require('./finanzasBase');
const Cat = require('./finanzasCatalogos');
const FB = require('./finanzasBancos');
const { errorValidacion } = require('./errores');

const I = FB.interno;
const BASES = { CASH_GROSS: 'Caja bruta (cobros y pagos propios clasificados)', DOCUMENT_NET: 'Documental neta (facturas emitidas, sin IVA)' };
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
// Compatibilidad (pruebas y otros módulos): la lista vigente viene del catálogo.
const CUENTAS = {
  get INGRESO() { return FB.cuentasDe_('INGRESO'); },
  get EGRESO() { return FB.cuentasDe_('EGRESO'); }
};

let preparada_ = null;
Base.registrarEsquema_(() => { preparada_ = null; });
function db_() {
  const d = I.db_();
  if (preparada_ === d) return d;
  d.exec(`CREATE TABLE IF NOT EXISTS FIN_PRESUPUESTO (
    id TEXT PRIMARY KEY, anio INTEGER NOT NULL, empresa TEXT NOT NULL, datos TEXT NOT NULL,
    actualizado_en TEXT, actualizado_por TEXT)`);
  Base.asegurarColumna_(d, 'FIN_PRESUPUESTO', 'estado', "TEXT NOT NULL DEFAULT 'BORRADOR'");
  Base.asegurarColumna_(d, 'FIN_PRESUPUESTO', 'version', 'INTEGER NOT NULL DEFAULT 1');
  Base.asegurarColumna_(d, 'FIN_PRESUPUESTO', 'base', "TEXT NOT NULL DEFAULT 'CASH_GROSS'");
  d.exec(`CREATE TABLE IF NOT EXISTS FIN_PRESUPUESTO_VERSIONES (
    id TEXT PRIMARY KEY, anio INTEGER NOT NULL, empresa TEXT NOT NULL, version INTEGER NOT NULL, estado TEXT NOT NULL, base TEXT NOT NULL,
    datos TEXT NOT NULL, en TEXT NOT NULL, por TEXT)`);
  preparada_ = d;
  return d;
}

/** La versión que manda para comparar: la última APROBADA (o null). Por empresa. */
const PROCEDENCIA_HEREDADA_ = 'Presupuesto cargado antes de que existieran versiones y aprobación (Etapa 5): no hay aprobación registrada.';
function aprobada_(anio, empresa) {
  const r = db_().prepare("SELECT * FROM FIN_PRESUPUESTO_VERSIONES WHERE anio = ? AND empresa = ? AND estado = 'APROBADO' ORDER BY version DESC LIMIT 1").get(Number(anio), empresa);
  if (r) return { version: r.version, base: r.base, en: r.en, por: r.por, lineas: I.des_(r.datos).lineas || [] };
  // I10.1 · Versión HEREDADA (anterior a las versiones): se compara por compatibilidad, pero sin aprobador ni fecha de
  // aprobación inventados; se informa quién la cargó y cuándo, y su procedencia.
  const h = db_().prepare("SELECT * FROM FIN_PRESUPUESTO_VERSIONES WHERE anio = ? AND empresa = ? AND estado = 'HEREDADO' ORDER BY version DESC LIMIT 1").get(Number(anio), empresa);
  if (h) { const dh = I.des_(h.datos); return { version: h.version, base: h.base, en: null, por: null, cargado_en: dh.cargado_en || '', cargado_por: dh.cargado_por || '', procedencia: dh.procedencia || PROCEDENCIA_HEREDADA_, lineas: dh.lineas || [], heredado: true }; }
  const viejo = db_().prepare('SELECT * FROM FIN_PRESUPUESTO WHERE anio = ? AND empresa = ?').get(Number(anio), empresa);
  if (viejo && !db_().prepare('SELECT 1 FROM FIN_PRESUPUESTO_VERSIONES WHERE anio = ? AND empresa = ? LIMIT 1').get(Number(anio), empresa)) {
    const dv = I.des_(viejo.datos);
    return { version: viejo.version || 1, base: viejo.base || 'CASH_GROSS', en: null, por: null, cargado_en: viejo.actualizado_en || '', cargado_por: viejo.actualizado_por || '',
      procedencia: (dv.origen && dv.origen.archivo ? 'Importado de ' + dv.origen.archivo + '. ' : '') + PROCEDENCIA_HEREDADA_, lineas: dv.lineas || [], heredado: true };
  }
  return null;
}
function borrador_(anio, empresa) {
  const r = db_().prepare('SELECT * FROM FIN_PRESUPUESTO WHERE anio = ? AND empresa = ?').get(Number(anio), empresa);
  return r ? { version: r.version || 1, estado: r.estado || 'BORRADOR', base: r.base || 'CASH_GROSS', en: r.actualizado_en, por: r.actualizado_por, lineas: I.des_(r.datos).lineas || [], requiere_validacion: I.des_(r.datos).requiere_validacion || '' } : null;
}

/**
 * { 'INGRESO|Servicio Mensual': [12], ... } del año y empresa ('' = suma del
 * grupo), de las versiones APROBADAS (o de los borradores, si se pide).
 */
function lineas_(anio, empresa, opciones) {
  opciones = opciones || {};
  const empresas = empresa ? [empresa] : Cat.empresas_({ todos: true });
  const out = {};
  const bases = new Set();
  const versiones = [];
  empresas.forEach((e) => {
    const v = opciones.borrador ? borrador_(anio, e) : aprobada_(anio, e);
    if (!v) return;
    bases.add(v.base); versiones.push({ empresa: e, version: v.version, base: v.base, por: v.por, en: v.en, heredado: !!v.heredado, cargado_por: v.cargado_por || '', cargado_en: v.cargado_en || '', procedencia: v.procedencia || '' });
    v.lineas.forEach((l) => {
      const k = l.tipo + '|' + l.cuenta;
      out[k] = out[k] || new Array(12).fill(0);
      l.meses.forEach((x, i) => { out[k][i] += Number(x) || 0; });
    });
  });
  Object.defineProperty(out, '_bases', { value: [...bases], enumerable: false });
  Object.defineProperty(out, '_versiones', { value: versiones, enumerable: false });
  return out;
}

/** Para el tablero: { 'AAAA-MM': { ingresos, egresos, base } } de los meses pedidos (null si no hay nada aprobado). */
function porMes_(periodos, empresa) {
  const res = {};
  const anios = [...new Set(periodos.map((p) => Number(p.slice(0, 4))))];
  let alguno = false;
  anios.forEach((a) => {
    const l = lineas_(a, empresa);
    if (Object.keys(l).length) alguno = true;
    periodos.filter((p) => Number(p.slice(0, 4)) === a).forEach((p) => {
      const i = Number(p.slice(5, 7)) - 1;
      const o = { ingresos: 0, egresos: 0, base: l._bases.length === 1 ? l._bases[0] : (l._bases.length ? 'MIXTA' : '') };
      Object.keys(l).forEach((k) => { if (k.indexOf('INGRESO|') === 0) o.ingresos += l[k][i]; else o.egresos += l[k][i]; });
      res[p] = o;
    });
  });
  return alguno ? res : null;
}

/** Lo real del año por concepto y mes en la base pedida. Con la parte de cada empresa de los gastos compartidos. */
function real_(anio, empresa, base) {
  const out = {};
  const sumar = (k, mes, v) => { out[k] = out[k] || new Array(12).fill(0); out[k][mes] += v; };
  if (base === 'DOCUMENT_NET') {
    // Facturas emitidas por fecha de emisión (neto + exento), menos notas de crédito; solo ingresos.
    try {
      require('./finanzasCobranza'); // asegura la tabla
      I.db_().prepare("SELECT empresa, fecha, datos FROM FIN_FACTURAS WHERE estado != 'ANULADA' AND fecha LIKE ?").all(anio + '-%').forEach((r) => {
        if (empresa && r.empresa !== empresa) return;
        const f = I.des_(r.datos);
        const neto = (Number(f.neto) || 0) + (Number(f.exento) || 0);
        const cuenta = /renta/i.test(f.concepto || '') ? 'Servicio Renta' : 'Servicio Mensual';
        sumar('INGRESO|' + cuenta, Number(r.fecha.slice(5, 7)) - 1, Number(f.tipo_doc) === 61 ? -neto : neto);
      });
    } catch (e) { /* sin facturas */ }
    return out;
  }
  const H = require('./finanzasHechos');
  H.hechos_({ soloConfirmados: true }).forEach((m) => {
    if (!m.clasif || m.fecha.slice(0, 4) !== String(anio) || m.caja === false) return;
    if (m.clasif.tipo !== 'INGRESO' && m.clasif.tipo !== 'EGRESO') return;
    const v = H.parteEmpresa_(m, empresa);
    if (!v) return;
    sumar(m.clasif.tipo + '|' + m.clasif.cuenta, Number(m.fecha.slice(5, 7)) - 1, v);
  });
  return out;
}

/** Presupuesto (aprobado y borrador) + real del año, listo para comparar o editar. */
const ver = B.conBoveda('VER_PRESUPUESTO', function (db, data) {
  const anio = Number((data && data.anio) || new Date().getFullYear());
  if (!(anio >= 2020 && anio <= 2100)) return errorValidacion('anio', 'Año no válido.');
  const empresa = Cat.empresas_({ todos: true }).indexOf(String((data && data.empresa) || '')) !== -1 ? data.empresa : '';
  const ppto = lineas_(anio, empresa);
  const bor = lineas_(anio, empresa, { borrador: true });
  const basePpto = ppto._bases.length === 1 ? ppto._bases[0] : ppto._bases.length ? 'MIXTA' : 'CASH_GROSS';
  const real = real_(anio, empresa, basePpto === 'MIXTA' ? 'CASH_GROSS' : basePpto);
  const filas = [];
  ['INGRESO', 'EGRESO'].forEach((tipo) => {
    const cuentas = new Set(FB.cuentasDe_(tipo));
    Object.keys(ppto).concat(Object.keys(bor)).concat(Object.keys(real)).forEach((k) => { if (k.indexOf(tipo + '|') === 0) cuentas.add(k.slice(tipo.length + 1)); });
    [...cuentas].forEach((cuenta) => {
      const k = tipo + '|' + cuenta;
      filas.push({ tipo, cuenta, ppto: ppto[k] || new Array(12).fill(0), borrador: bor[k] || new Array(12).fill(0), real: real[k] || new Array(12).fill(0),
        comparable: !(basePpto === 'DOCUMENT_NET' && tipo === 'EGRESO') && basePpto !== 'MIXTA' });
    });
  });
  const anios = db_().prepare('SELECT DISTINCT anio FROM FIN_PRESUPUESTO ORDER BY anio DESC').all().map((r) => r.anio);
  const meta = empresa ? borrador_(anio, empresa) : null;
  const historial = empresa ? db_().prepare('SELECT version, estado, base, en, por FROM FIN_PRESUPUESTO_VERSIONES WHERE anio = ? AND empresa = ? ORDER BY version DESC, en DESC').all(anio, empresa) : [];
  // I10.1 · Cobertura: los meses del año con cartolas. El acumulado compara solo esos meses (ppto y real).
  const mesesConDatos = I.db_().prepare('SELECT DISTINCT periodo FROM FIN_MOVIMIENTOS WHERE periodo LIKE ? ORDER BY periodo').all(anio + '-%').map((r) => Number(r.periodo.slice(5, 7)) - 1);
  // Primer mes del año con movimientos: antes de eso, "real = 0" no significa que no hubo dinero.
  const primero = I.db_().prepare('SELECT MIN(periodo) AS p FROM FIN_MOVIMIENTOS WHERE periodo LIKE ?').get(anio + '-%');
  const primerMes = primero && primero.p ? Number(primero.p.slice(5, 7)) - 1 : null;
  const ultimo = I.db_().prepare('SELECT MAX(periodo) AS p FROM FIN_MOVIMIENTOS WHERE periodo LIKE ?').get(anio + '-%');
  const ultimoMes = ultimo && ultimo.p ? Number(ultimo.p.slice(5, 7)) - 1 : null;
  return {
    anio, empresa, empresas: Cat.empresas_(), anios, filas, bases: BASES, base: basePpto,
    base_no_comparable: basePpto === 'MIXTA' ? 'Las empresas del grupo tienen presupuestos en bases distintas: elige una empresa para comparar.' : '',
    cargado: Object.keys(ppto).length > 0, hay_borrador: Object.keys(bor).length > 0, versiones: ppto._versiones,
    borrador: meta ? { version: meta.version, estado: meta.estado, base: meta.base, por: meta.por, en: meta.en, requiere_validacion: meta.requiere_validacion } : null, historial,
    actualizado: meta ? { actualizado_en: meta.en, actualizado_por: meta.por } : null, primer_mes_con_datos: primerMes, ultimo_mes_con_datos: ultimoMes, meses_con_datos: mesesConDatos
  };
});

/** Lee y valida las líneas: cada celda se entiende o es un error con su concepto y mes (nunca un cero silencioso). */
function leerLineas_(entrada) {
  const lineas = [];
  for (const l of (Array.isArray(entrada) ? entrada : [])) {
    const cuentas = FB.cuentasDe_(l.tipo);
    if (['INGRESO', 'EGRESO'].indexOf(l.tipo) === -1 || cuentas.indexOf(l.cuenta) === -1) return { error: errorValidacion('lineas', 'Concepto desconocido: ' + l.cuenta) };
    const meses = [];
    for (let i = 0; i < 12; i++) {
      const v = (Array.isArray(l.meses) ? l.meses : [])[i];
      if (v === undefined || v === null || String(v).trim() === '') { meses.push(0); continue; }
      const crudo = typeof v === 'number' ? Math.round(v) : Base.montoExcel_(v);
      const m = crudo !== null ? { ok: true, valor: crudo } : Base.montoClp_(v);
      if (!m.ok) return { error: errorValidacion('lineas', l.cuenta + ', ' + MESES[i] + ': ' + m.error) };
      if (m.valor < 0) return { error: errorValidacion('lineas', l.cuenta + ', ' + MESES[i] + ': el presupuesto no puede ser negativo.') };
      meses.push(m.valor);
    }
    if (meses.some((v) => v)) lineas.push({ tipo: l.tipo, cuenta: l.cuenta, meses });
  }
  return { lineas };
}

/** Guarda el BORRADOR de un año y una empresa (nueva versión; la aprobada sigue mandando hasta aprobar esta). */
function guardar_(db, data, x, opciones) {
  opciones = opciones || {};
  const anio = Number(data && data.anio);
  const empresa = Cat.empresa_(data && data.empresa) || String((data && data.empresa) || '');
  if (!(anio >= 2020 && anio <= 2100)) return errorValidacion('anio', 'Año no válido.');
  if (Cat.empresas_().indexOf(empresa) === -1) return errorValidacion('empresa', 'El presupuesto se carga por empresa.');
  const base = BASES[String(data.base || '').toUpperCase()] ? String(data.base).toUpperCase() : 'CASH_GROSS';
  const r = leerLineas_(data.lineas);
  if (r.error) return r.error;
  const d = db_();
  const id = anio + '|' + empresa;
  const previo = d.prepare('SELECT * FROM FIN_PRESUPUESTO WHERE id = ?').get(id);
  // I11.2: si ya hay presupuesto de ese año y empresa, se guarda solo sobre la versión que se vio (o lo dice una carga interna).
  if (previo && !opciones.interno && (data.expected_version === undefined || data.expected_version === null || data.expected_version === '')) return Base.errVersionRequerida_();
  if (previo && data.expected_version !== undefined && data.expected_version !== null && data.expected_version !== '' && Number(data.expected_version) !== Number(previo.version || 1)) return Base.errConflicto();
  // Un presupuesto de la Etapa 5 (sin versiones) queda primero en la historia como versión HEREDADA, con su
  // procedencia y sin aprobador: no se registra una aprobación que nadie hizo (I10.1).
  if (previo && !d.prepare('SELECT 1 FROM FIN_PRESUPUESTO_VERSIONES WHERE anio = ? AND empresa = ? LIMIT 1').get(anio, empresa)) {
    const dp = I.des_(previo.datos);
    const her = Object.assign({}, dp, { cargado_en: previo.actualizado_en || '', cargado_por: previo.actualizado_por || '', procedencia: (dp.origen && dp.origen.archivo ? 'Importado de ' + dp.origen.archivo + '. ' : '') + PROCEDENCIA_HEREDADA_ });
    d.prepare("INSERT INTO FIN_PRESUPUESTO_VERSIONES (id, anio, empresa, version, estado, base, datos, en, por) VALUES (?,?,?,?,'HEREDADO',?,?,?,?)")
      .run(Base.id_(), anio, empresa, previo.version || 1, previo.base || 'CASH_GROSS', I.cif_(her), Base.ahora_(), '');
  }
  const version = previo ? (previo.version || 1) + 1 : 1;
  const ahora = Base.ahora_();
  const datos = { lineas: r.lineas, nota: Base.txt_(data.nota).slice(0, 500), origen: opciones.origen || null, requiere_validacion: opciones.requiere_validacion || '' };
  d.prepare("INSERT INTO FIN_PRESUPUESTO (id, anio, empresa, datos, actualizado_en, actualizado_por, estado, version, base) VALUES (?,?,?,?,?,?,'BORRADOR',?,?) " +
    "ON CONFLICT(id) DO UPDATE SET datos = excluded.datos, actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por, estado = 'BORRADOR', version = excluded.version, base = excluded.base")
    .run(id, anio, empresa, I.cif_(datos), ahora, x.nombre, version, base);
  d.prepare("INSERT INTO FIN_PRESUPUESTO_VERSIONES (id, anio, empresa, version, estado, base, datos, en, por) VALUES (?,?,?,?,'BORRADOR',?,?,?,?)")
    .run(Base.id_(), anio, empresa, version, base, I.cif_(datos), ahora, x.nombre);
  const total = (t) => r.lineas.filter((l) => l.tipo === t).reduce((s, l) => s + l.meses.reduce((a, b) => a + b, 0), 0);
  return { anio, empresa, version, estado: 'BORRADOR', base, cuentas: r.lineas.length, ingresos_anio: total('INGRESO'), egresos_anio: total('EGRESO') };
}
const guardar = Base.conCapacidad('PRESUPUESTO', '', function (db, data, contexto, x) {
  const r = guardar_(db, data, x);
  if (!r._validationError) x.registrar('GUARDAR_PRESUPUESTO', r.anio + ' ' + r.empresa + ' v' + r.version + ' (borrador): ' + r.cuentas + ' cuentas');
  return r;
});

/** Aprueba el borrador vigente de un año y empresa: desde ahora es el que se compara. */
const aprobar = Base.conCapacidad('PRESUPUESTO', '', function (db, data, contexto, x) {
  const anio = Number(data && data.anio), empresa = Cat.empresa_(data && data.empresa);
  const d = db_();
  const r = d.prepare('SELECT * FROM FIN_PRESUPUESTO WHERE id = ?').get(anio + '|' + empresa);
  if (!r) return errorValidacion('anio', 'No hay presupuesto de ' + empresa + ' ' + anio + '.');
  if (data.expected_version === undefined || data.expected_version === null || data.expected_version === '') return Base.errVersionRequerida_();
  if (Number(data.expected_version) !== Number(r.version || 1)) return Base.errConflicto('El presupuesto cambió desde que lo revisaste.');
  if (r.estado === 'APROBADO') return errorValidacion('estado', 'Esa versión ya está aprobada.');
  const datos = I.des_(r.datos);
  if (datos.requiere_validacion && !data.confirmo_validacion) return errorValidacion('confirmo_validacion', datos.requiere_validacion + ' Confirma que lo revisaste antes de aprobar.');
  const ahora = Base.ahora_();
  d.prepare("UPDATE FIN_PRESUPUESTO SET estado = 'APROBADO', actualizado_en = ?, actualizado_por = ? WHERE id = ?").run(ahora, x.nombre, r.id);
  d.prepare("INSERT INTO FIN_PRESUPUESTO_VERSIONES (id, anio, empresa, version, estado, base, datos, en, por) VALUES (?,?,?,?,'APROBADO',?,?,?,?)")
    .run(Base.id_(), anio, empresa, r.version || 1, r.base || 'CASH_GROSS', r.datos, ahora, x.nombre);
  x.registrar('APROBAR_PRESUPUESTO', anio + ' ' + empresa + ' v' + (r.version || 1));
  return { anio, empresa, version: r.version || 1, estado: 'APROBADO' };
});

module.exports = { ver, guardar, aprobar, porMes_, lineas_, real_, aprobada_, borrador_, guardar_, CUENTAS, BASES };
