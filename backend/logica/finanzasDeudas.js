'use strict';

/**
 * finanzasDeudas.js — Deudas anteriores (Finanzas v5.5, 02-11-2026; reunión con gerencia).
 *
 * Clientes de 2025 (HomePymes antigua) o que ya se fueron y quedaron debiendo. No tienen factura en el libro actual,
 * así que no aparecen en la cobranza. Aquí:
 *   - Cada deuda tiene un CÓDIGO ESPECIAL (DA001, DA002…): el número con que se identifica en la planilla.
 *   - Se carga a mano o desde un Excel (cliente, RUT, empresa de origen, año, monto, si sigue o se fue).
 *   - Lo abonado sale de la PLANILLA: un abono con el plan «Cobro deuda anterior» y el código en la columna
 *     «N° factura» descuenta esa deuda (como una factura, sin otra hoja que llenar). Si el abono lleva varios
 *     códigos, paga en el orden anotado hasta lo que falta de cada una.
 *   - Así se sabe quién debe, cuánto, desde cuándo, y a qué corresponde cada ingreso sin factura.
 */

const crypto = require('node:crypto');
const B = require('./finanzasBoveda');
const Base = require('./finanzasBase');
const F = require('./finanzasBancos');
const { errorValidacion } = require('./errores');

const I = F.interno;
const N = (s) => I.normalizar_(s);
const txt_ = (v) => String(v == null ? '' : v).trim();
const PLAN = 'Cobro deuda anterior';
const ESTADOS = { ACTIVO: 'Sigue como cliente', SE_FUE: 'Se fue' };
const CODIGO_ = /^DA\d{3,}$/;

let preparada_ = null;
Base.registrarEsquema_(() => { preparada_ = null; });
function db_() {
  const d = I.db_();
  if (preparada_ === d) return d;
  d.exec(`CREATE TABLE IF NOT EXISTS FIN_DEUDAS (
    id TEXT PRIMARY KEY, codigo TEXT NOT NULL UNIQUE, activa INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1,
    datos TEXT NOT NULL, creada_en TEXT, actualizado_en TEXT, actualizado_por TEXT)`);
  // El plan de cuenta con que se anota el abono en la planilla (se agrega a un catálogo ya sembrado).
  try { require('./finanzasCatalogos').asegurar_('CONCEPTO', PLAN, { grupo: 'INGRESO' }, 'sistema'); } catch (e) { /* sin catálogo: queda en la semilla */ }
  preparada_ = d;
  return d;
}

function rutNorm_(r) { const s = String(r || '').replace(/[^0-9kK]/g, '').toUpperCase(); return s.length >= 2 ? s.slice(0, -1).replace(/^0+/, '') + '-' + s.slice(-1) : ''; }
function rutValido_(r) {
  const n = rutNorm_(r); if (!n) return false;
  const [cuerpo, dv] = n.split('-'); let s = 0, m = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { s += Number(cuerpo[i]) * m; m = m === 7 ? 2 : m + 1; }
  const r11 = 11 - (s % 11); return dv === (r11 === 11 ? '0' : r11 === 10 ? 'K' : String(r11));
}
function rutVisible_(r) { const n = rutNorm_(r); if (!n) return ''; const [c, dv] = n.split('-'); return c.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv; }

// Todos los clientes del maestro, también los inactivos (los que se fueron siguen debiendo).
function maestro_(db) {
  try {
    const { leerFilas_ } = require('../db/sqliteRepo');
    const { COLUMNAS } = require('../db/schema');
    return leerFilas_(db, 'CAT_CLIENTES', COLUMNAS.CAT_CLIENTES).filter((c) => c.cliente_id && c.razon_social)
      .map((c) => ({ id: String(c.cliente_id), nombre: String(c.razon_social).trim(), rut: rutNorm_(c.rut), activo: !(c.activo === false || c.activo === 'FALSE') }));
  } catch (e) { return []; }
}
function siguienteCodigo_() {
  const n = db_().prepare("SELECT codigo FROM FIN_DEUDAS").all().map((r) => Number(String(r.codigo).slice(2)) || 0).reduce((a, b) => Math.max(a, b), 0);
  return 'DA' + String(n + 1).padStart(3, '0');
}

/** Lo abonado a cada código según la planilla: { codigo → [{id, fecha, monto, nombre, periodo}] }. */
function abonos_() {
  const d = db_();
  const deudas = new Map(d.prepare('SELECT codigo, datos FROM FIN_DEUDAS WHERE activa = 1').all().map((r) => [r.codigo, I.des_(r.datos)]));
  const usado = new Map(), out = new Map(), sueltos = [];
  d.prepare('SELECT id, fecha, periodo, datos FROM FIN_MOVIMIENTOS ORDER BY fecha, orden').all().forEach((r) => {
    const m = I.des_(r.datos), p = m.planilla; if (!p) return;
    const monto = (m.abono || 0) - (m.cargo || 0);
    if (!(monto > 0)) return;
    const codigos = N(p.fact || '').split(/[^0-9A-Z]+/).filter((x) => CODIGO_.test(x) && deudas.has(x));
    if (!codigos.length) {
      // Anotado como cobro de deuda anterior pero sin su código: se avisa (no se descuenta a nadie por suposición).
      if (N(p.plan) === N(PLAN)) sueltos.push({ id: r.id, fecha: p.fecha || r.fecha, monto, nombre: p.alias || '', periodo: r.periodo });
      return;
    }
    let resto = monto;
    codigos.forEach((c, i) => {
      const ya = usado.get(c) || 0;
      const v = i === codigos.length - 1 ? resto : Math.min(resto, Math.max(0, (deudas.get(c).monto || 0) - ya));
      usado.set(c, ya + v); resto -= v;
      if (v > 0) out.set(c, (out.get(c) || []).concat([{ id: r.id, fecha: p.fecha || r.fecha, monto: v, nombre: p.alias || '', periodo: r.periodo }]));
    });
  });
  return { porCodigo: out, sueltos };
}

/** Lista de deudas con lo abonado y su saldo (la usan la pantalla, la planilla y los informes). */
function lista_() {
  const ab = abonos_();
  const l = db_().prepare('SELECT * FROM FIN_DEUDAS WHERE activa = 1').all().map((r) => {
    const x = I.des_(r.datos), abonos = ab.porCodigo.get(r.codigo) || [];
    const abonado = abonos.reduce((s, a) => s + a.monto, 0);
    return Object.assign({ id: r.id, codigo: r.codigo, version: r.version, actualizado_en: r.actualizado_en, actualizado_por: r.actualizado_por }, x,
      { rut_visible: rutVisible_(x.rut), abonado, saldo: Math.max(0, (x.monto || 0) - abonado), abonos, ultimo_abono: abonos.length ? abonos[abonos.length - 1].fecha : '' });
  });
  l.sort((a, b) => b.saldo - a.saldo || a.codigo.localeCompare(b.codigo));
  return { deudas: l, sueltos: ab.sueltos };
}

const deudas = B.conBoveda('', function () {
  const { deudas: l, sueltos } = lista_();
  const T = { adeudado: 0, abonado: 0, saldo: 0, clientes: 0, se_fueron: 0, activos: 0, pagadas: 0 };
  l.forEach((x) => {
    T.adeudado += x.monto || 0; T.abonado += x.abonado; T.saldo += x.saldo;
    if (x.saldo > 0) { T.clientes++; if (x.estado_cliente === 'SE_FUE') T.se_fueron += x.saldo; else T.activos += x.saldo; } else T.pagadas++;
  });
  const origenes = [...new Set(l.map((x) => x.origen).filter(Boolean))].sort();
  return { deudas: l, totales: T, origenes, sueltos, plan: PLAN, estados: ESTADOS };
});

/** Valida y arma una deuda desde lo que llega (formulario o fila del Excel). */
function leerDeuda_(db, v, maestro) {
  const cliente = txt_(v.cliente).replace(/\s+/g, ' ').slice(0, 160);
  const rut = rutNorm_(v.rut);
  const mo = Base.montoClp_(typeof v.monto === 'number' ? String(v.monto) : v.monto);
  if (!cliente && !rut) return { error: 'Falta el cliente (nombre o RUT).' };
  if (!mo.ok) return { error: mo.error || 'El monto no se entiende.' };
  if (!(mo.valor > 0)) return { error: 'El monto adeudado tiene que ser mayor que cero.' };
  const anio = txt_(v.anio).replace(/[^0-9]/g, '').slice(0, 4);
  if (anio && (Number(anio) < 2000 || Number(anio) > 2100)) return { error: 'El año ' + anio + ' no parece correcto.' };
  const estado = /FUE|RETIR|EX|NO/.test(N(v.estado_cliente)) ? 'SE_FUE' : 'ACTIVO';
  const m = (maestro || maestro_(db));
  const enMaestro = (rut && m.find((c) => c.rut === rut)) || (cliente && m.find((c) => N(c.nombre) === N(cliente))) || null;
  return { valor: {
    cliente: cliente || (enMaestro ? enMaestro.nombre : ''), rut, cliente_id: enMaestro ? enMaestro.id : '', origen: txt_(v.origen).slice(0, 80),
    anio, monto: mo.valor, estado_cliente: estado, nota: txt_(v.nota).slice(0, 500), alias: txt_(v.alias).toUpperCase().slice(0, 60),
    // Un RUT con dígito verificador malo no bloquea (pasa en planillas reales): se guarda tal cual y se marca para revisar.
    rut_invalido: !!(rut && !rutValido_(rut))
  } };
}

const guardarDeuda = Base.conCapacidad('APLICAR', '', function (db, data, contexto, x) {
  const d = db_();
  const r0 = data && data.id ? d.prepare('SELECT * FROM FIN_DEUDAS WHERE id = ? AND activa = 1').get(txt_(data.id)) : null;
  if (data && data.id && !r0) return errorValidacion('id', 'Esa deuda ya no existe: recarga la lista.');
  if (r0 && data.expected_version !== undefined && Number(data.expected_version) !== Number(r0.version)) return Base.errConflicto('Otra persona cambió esta deuda (' + (r0.actualizado_por || '') + '). Se recargó la lista.');
  const v = leerDeuda_(db, data || {});
  if (v.error) return errorValidacion('deuda', v.error);
  const ahora = Base.ahora_();
  if (r0) {
    const antes = I.des_(r0.datos);
    const datos = Object.assign({}, v.valor, { origen_carga: antes.origen_carga || 'manual', historial: (antes.historial || []).concat([{ en: ahora, por: x.nombre, antes: { monto: antes.monto, cliente: antes.cliente, estado_cliente: antes.estado_cliente } }]).slice(-30) });
    d.prepare('UPDATE FIN_DEUDAS SET datos = ?, version = version + 1, actualizado_en = ?, actualizado_por = ? WHERE id = ?').run(I.cif_(datos), ahora, x.nombre, r0.id);
    x.registrar('DEUDA_ANTERIOR_EDITAR', r0.codigo + ' · ' + datos.cliente);
    return { id: r0.id, codigo: r0.codigo };
  }
  const id = crypto.randomUUID(), codigo = siguienteCodigo_();
  d.prepare('INSERT INTO FIN_DEUDAS (id, codigo, datos, creada_en, actualizado_en, actualizado_por) VALUES (?,?,?,?,?,?)').run(id, codigo, I.cif_(Object.assign(v.valor, { origen_carga: 'manual' })), ahora, ahora, x.nombre);
  x.registrar('DEUDA_ANTERIOR_NUEVA', codigo + ' · ' + v.valor.cliente);
  return { id, codigo };
});

/** Se quita de la lista solo si no tiene abonos (si los tiene, la historia no se borra: se corrige el monto). */
const borrarDeuda = Base.conCapacidad('APLICAR', '', function (db, data, contexto, x) {
  const d = db_();
  const r = d.prepare('SELECT * FROM FIN_DEUDAS WHERE id = ? AND activa = 1').get(txt_(data && data.id));
  if (!r) return errorValidacion('id', 'Esa deuda ya no existe.');
  if ((abonos_().porCodigo.get(r.codigo) || []).length) return errorValidacion('id', 'Esta deuda ya tiene abonos en la planilla: no se borra. Si el monto estaba mal, corrígelo.');
  d.prepare('UPDATE FIN_DEUDAS SET activa = 0, version = version + 1, actualizado_en = ?, actualizado_por = ? WHERE id = ?').run(Base.ahora_(), x.nombre, r.id);
  x.registrar('DEUDA_ANTERIOR_QUITAR', r.codigo);
  return { borrada: true };
});

// Columnas que se reconocen en el Excel (en cualquier orden).
const COLS_ = {
  cliente: /^(CLIENTE|RAZON SOCIAL|NOMBRE|EMPRESA CLIENTE)/, rut: /^RUT/, origen: /^(ORIGEN|EMPRESA|SOCIEDAD|FACTURADO POR)/,
  anio: /^(ANO|AÑO|PERIODO|FECHA)/, monto: /^(MONTO|DEUDA|SALDO|TOTAL|ADEUDADO)/, estado_cliente: /^(ESTADO|SITUACION|SIGUE)/, nota: /^(NOTA|OBS|DETALLE|COMENTARIO)/, alias: /^(ALIAS|NOMBRE CORTO)/
};
function leerExcel_(filas) {
  filas = (Array.isArray(filas) ? filas : []).map((f) => Array.from(f || [], txt_));
  const iH = filas.findIndex((f) => f.some((c) => COLS_.monto.test(N(c))) && f.some((c) => COLS_.cliente.test(N(c)) || COLS_.rut.test(N(c))));
  if (iH === -1) return { error: 'No encuentro las columnas. La primera fila debe decir al menos CLIENTE (o RUT) y MONTO; también se leen RUT, EMPRESA u ORIGEN, AÑO, ESTADO y NOTA.' };
  const H = filas[iH].map(N), ix = {};
  Object.keys(COLS_).forEach((k) => { ix[k] = H.findIndex((h) => COLS_[k].test(h)); });
  const out = [];
  filas.slice(iH + 1).forEach((f, k) => {
    if (!f.some(Boolean)) return;
    const v = {}; Object.keys(ix).forEach((c) => { v[c] = ix[c] >= 0 ? f[ix[c]] : ''; });
    if (/^TOTAL/.test(N(v.cliente))) return; // fila de totales del Excel
    if (v.anio && /\d{4}-\d{2}/.test(v.anio)) v.anio = v.anio.slice(0, 4);
    out.push({ fila: iH + k + 2, v });
  });
  return { filas: out };
}

/** Carga desde Excel. Con revisar: true solo muestra lo que entraría (sin guardar). Las repetidas no se duplican. */
const importarDeudas = Base.conCapacidad('APLICAR', '', function (db, data, contexto, x) {
  const d = db_();
  const leido = leerExcel_(data && data.filas);
  if (leido.error) return errorValidacion('archivo', leido.error);
  const m = maestro_(db);
  const hay = new Set(lista_().deudas.map((y) => [y.rut || N(y.cliente), N(y.origen), y.monto].join('|')));
  const nuevas = [], errores = [], repetidas = [];
  leido.filas.forEach((f) => {
    const r = leerDeuda_(db, f.v, m);
    if (r.error) { errores.push({ fila: f.fila, error: r.error }); return; }
    const k = [r.valor.rut || N(r.valor.cliente), N(r.valor.origen), r.valor.monto].join('|');
    if (hay.has(k)) { repetidas.push({ fila: f.fila, cliente: r.valor.cliente }); return; }
    hay.add(k); nuevas.push(Object.assign({ fila: f.fila }, r.valor));
  });
  const total = nuevas.reduce((s, y) => s + y.monto, 0);
  if (data && data.revisar) return { nuevas, errores, repetidas, total, en_maestro: nuevas.filter((y) => y.cliente_id).length, rut_invalido: nuevas.filter((y) => y.rut_invalido).length };
  const ahora = Base.ahora_(), archivo = txt_(data && data.archivo).slice(0, 120);
  d.exec('BEGIN');
  try {
    nuevas.forEach((y) => {
      const datos = Object.assign({}, y, { origen_carga: 'excel', archivo }); delete datos.fila;
      d.prepare('INSERT INTO FIN_DEUDAS (id, codigo, datos, creada_en, actualizado_en, actualizado_por) VALUES (?,?,?,?,?,?)').run(crypto.randomUUID(), siguienteCodigo_(), I.cif_(datos), ahora, ahora, x.nombre);
    });
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
  x.registrar('DEUDA_ANTERIOR_CARGA', nuevas.length + ' deuda(s) · ' + Base.plata_(total) + (archivo ? ' · ' + archivo : ''));
  return { creadas: nuevas.length, errores, repetidas, total, rut_invalido: nuevas.filter((y) => y.rut_invalido).length };
});

/**
 * Código de deuda sugerido para un abono de la planilla: el deudor con saldo cuyo cliente (ficha), RUT o nombre corto
 * calza con la fila. Solo cuando hay uno solo (si hay varios, la persona elige).
 */
function sugerirCodigo_(fila, deudasConSaldo) {
  const n = N(fila.nombre), c = fila.cliente_id;
  const palabras = (s) => N(s).replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((p) => p.length > 2 && !/^(SPA|LTDA|CONST|CONSTRUCTORA|CONSTRUCCIONES|EIRL|LIMITADA)$/.test(p));
  const pn = palabras(n);
  const l = deudasConSaldo.filter((dd) => (c && dd.cliente_id === c) || (dd.alias && N(dd.alias) === n) ||
    (pn.length && palabras(dd.cliente).length && pn.every((p) => palabras(dd.cliente).indexOf(p) !== -1)));
  return l.length === 1 ? l[0] : null;
}

module.exports = { deudas, guardarDeuda, borrarDeuda, importarDeudas, lista_, abonos_, sugerirCodigo_, leerExcel_, rutValido_, PLAN, CODIGO_ };
