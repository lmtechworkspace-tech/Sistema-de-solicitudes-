'use strict';

/**
 * finanzasPagadores.js — Finanzas, Etapa A del rediseño (2026-10-07).
 *
 * Lo que mostraron las planillas reales de julio y agosto: el nombre que da
 * el banco NO dice de qué cliente es la plata. Construcciones Kraken pagó por
 * Elohim y por WWL; Daniela Muñoz por Osses; Construcciones Miranda por
 * Ynfantes. Bárbara y Lisseth lo saben; el banco no. Por eso:
 *
 *  - QUIÉN PAGÓ y DE QUÉ CLIENTE ES son dos cosas distintas. El sistema
 *    recuerda, por cada pagador, por qué clientes ha pagado (FIN_PAGADORES).
 *    Si siempre pagó por el mismo, lo propone; si pagó por varios, muestra
 *    las opciones y NUNCA lo da por seguro.
 *  - DETALLE DEL BANCO: el Excel «Mis Movimientos» del BCI trae el nombre
 *    completo de quien transfiere y si un pago fue a Previred, al SII o a la
 *    Tesorería. No reemplaza a la cartola (le faltan traspasos y no trae
 *    saldos): se empareja con ella y le pone nombre a cada movimiento.
 *  - EXCEL «BANCOS»: lo que ellas llenaban a mano (DETALLE = cliente con su
 *    nombre corto, OBS = abono/IVA/imposiciones…). Primero se enseñan los
 *    nombres cortos una vez (FIN_ALIAS: «OSSES» = Constructora Osses Muñoz;
 *    «COMISION» = gasto Comisión Banco) y después cada fila del Excel queda
 *    como sugerencia en su movimiento, y cada pagador aprende su cliente.
 *  - DIVIDIR: una transferencia puede ser de varios clientes (clasif.partes);
 *    piezas_() la abre en partes para todos los cálculos (tablero, cobranza,
 *    presupuesto, plata de clientes).
 */

const crypto = require('node:crypto');
const B = require('./finanzasBoveda');
const FB = require('./finanzasBancos');
const { errorValidacion, errorForbidden } = require('./errores');

const I = FB.interno;

let preparada_ = null;
function db_() {
  const d = I.db_();
  if (preparada_ === d) return d;
  d.exec('CREATE TABLE IF NOT EXISTS FIN_PAGADORES (huella TEXT PRIMARY KEY, datos TEXT NOT NULL, actualizado_en TEXT)');
  d.exec('CREATE TABLE IF NOT EXISTS FIN_ALIAS (huella TEXT PRIMARY KEY, datos TEXT NOT NULL, actualizado_en TEXT, actualizado_por TEXT)');
  preparada_ = d;
  return d;
}
const txt_ = (v) => String(v == null ? '' : v).trim();
const huella_ = (tipo, s) => I.hmac_(tipo + '|' + I.normalizar_(s));

// ---------------------------------------------------------------- piezas (dividir)

/** Las partes de un movimiento confirmado: [{abono, cargo, clasif}]. Sin división, el mismo movimiento. */
function piezas_(m, clasif) {
  const c = clasif === undefined ? m.clasif : clasif;
  if (!c || !Array.isArray(c.partes) || !c.partes.length) return [{ abono: m.abono, cargo: m.cargo, clasif: c }];
  return c.partes.map((p) => ({ abono: m.abono ? p.monto : 0, cargo: m.cargo ? p.monto : 0, clasif: Object.assign({ nota: c.nota || '' }, p) }));
}

// ---------------------------------------------------------------- lectura del detalle «Mis Movimientos»

/** De la descripción del BCI: quién pagó / a quién se pagó y por qué medio. */
function analizarDescripcion_(desc) {
  const d = txt_(desc);
  let m = /^Transferencia recibida de\s+(.+)$/i.exec(d);
  if (m) return { pagador: m[1].trim(), medio: 'TRANSFERENCIA' };
  m = /^Transferencia enviada a\s+(.+)$/i.exec(d);
  if (m) return { destinatario: m[1].trim(), medio: 'TRANSFERENCIA' };
  m = /^Pago en l[ií]nea\s+(.+)$/i.exec(d);
  if (m) {
    const a = I.normalizar_(m[1]);
    return { medio: /PREVIRED/.test(a) ? 'PREVIRED' : /^SII/.test(a) ? 'SII' : /TESORERIA|TGR/.test(a) ? 'TESORERIA' : 'PAGO', destinatario: m[1].trim() };
  }
  if (/dep[oó]sito en efectivo/i.test(d)) return { medio: 'EFECTIVO' };
  return { medio: 'OTRO' };
}

/** Filas de «Mis Movimientos» (lector-xlsx) → [{fecha, contable, descripcion, cargo, abono, saldo}] */
function leerDetalle(filas) {
  filas = Array.isArray(filas) ? filas : [];
  const iH = filas.findIndex((f) => Array.isArray(f) && f.some((c) => /^Fecha Transacci/i.test(txt_(c))) && f.some((c) => /^Descripci/i.test(txt_(c))));
  if (iH === -1) return { error: 'No reconozco este archivo. Es el Excel «Mis Movimientos» del BCI (Fecha Transacción, Fecha Contable, Descripción, Egreso, Ingreso, Saldo).' };
  const H = Array.from(filas[iH], txt_);
  const ix = (re) => H.findIndex((h) => re.test(h));
  const C = { tx: ix(/^Fecha Transacci/i), cont: ix(/^Fecha Contable/i), desc: ix(/^Descripci/i), egr: ix(/^Egreso/i), ing: ix(/^Ingreso/i), saldo: ix(/^Saldo/i) };
  const out = [];
  filas.slice(iH + 1).forEach((f) => {
    const c = Array.from(f || [], txt_);
    const fecha = I.fechaIso_(c[C.tx]);
    if (!fecha) return;
    const cargo = Math.abs(FB.monto_(c[C.egr]) || 0), abono = Math.abs(FB.monto_(c[C.ing]) || 0);
    if (!cargo && !abono) return;
    out.push(Object.assign({ fecha, contable: I.fechaIso_(c[C.cont]) || fecha, descripcion: c[C.desc], cargo, abono, saldo: FB.monto_(c[C.saldo]) }, analizarDescripcion_(c[C.desc])));
  });
  return { movimientos: out };
}

function cuentaDesdeNombre_(nombre) {
  const m = /Cuenta[_\s-]*(\d{4,})/i.exec(String(nombre || ''));
  if (!m) return null;
  const u4 = m[1].slice(-4);
  return [...I.cuentasMapa_().values()].find((c) => c.ultimos4 === u4) || null;
}

/** Empareja filas externas con movimientos de una cuenta: mismo monto y sentido; fecha exacta primero, luego ±3 días. */
function emparejar_(filasExternas, movimientos, fechaDe) {
  const usados = new Set();
  const pares = [];
  [0, 1, 2, 3].forEach((tol) => {
    filasExternas.forEach((x, i) => {
      if (x._par) return;
      const f = fechaDe(x);
      const j = movimientos.findIndex((m, k) => !usados.has(k) && (x.abono ? m.d.abono === x.abono : m.d.cargo === x.cargo) &&
        Math.abs(Date.parse(m.r.fecha) - Date.parse(f)) <= tol * 864e5);
      if (j >= 0) { usados.add(j); x._par = true; pares.push({ x, m: movimientos[j], i }); }
    });
  });
  return pares;
}
function movimientosDe_(cuentaId, desde, hasta) {
  return db_().prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE cuenta_ref = ? AND fecha >= ? AND fecha <= ? ORDER BY fecha, orden').all(cuentaId, desde, hasta)
    .map((r) => ({ r, d: I.des_(r.datos) }));
}
function rango_(lista, campo) {
  const fs = lista.map((x) => x[campo]).filter(Boolean).sort();
  if (!fs.length) return null;
  const mas = (iso, n) => { const t = new Date(iso + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  return [mas(fs[0], -4), mas(fs[fs.length - 1], 4)];
}

/** Agrega el detalle del banco a los movimientos de la cartola (no crea movimientos). */
const importarDetalle = B.conBoveda('', function (db, data, contexto, x) {
  if (I.soloEscritura_(contexto)) return errorForbidden('Tu acceso a Finanzas es de solo lectura.');
  const det = leerDetalle(data && data.filas);
  if (det.error) return errorValidacion('archivo', det.error);
  const cuenta = (data && data.cuenta && I.cuentasMapa_().get(data.cuenta)) || cuentaDesdeNombre_(data && data.nombre_archivo);
  if (!cuenta) return errorValidacion('cuenta', 'No sé de qué cuenta es este detalle. Primero sube la cartola de esa cuenta en Bancos.');
  const r = rango_(det.movimientos, 'contable');
  if (!r) return errorValidacion('archivo', 'El archivo no trae movimientos.');
  const movs = movimientosDe_(cuenta.id, r[0], r[1]);
  const pares = emparejar_(det.movimientos, movs, (y) => y.contable);
  const d = db_();
  d.exec('BEGIN');
  try {
    pares.forEach((p) => {
      p.m.d.detalle = { descripcion: p.x.descripcion, pagador: p.x.pagador || '', destinatario: p.x.destinatario || '', medio: p.x.medio, fecha_tx: p.x.fecha };
      d.prepare('UPDATE FIN_MOVIMIENTOS SET datos = ? WHERE id = ?').run(I.cif_(p.m.d), p.m.r.id);
    });
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
  FB.resugerirPendientes_(db);
  x.registrar('IMPORTAR_DETALLE', cuenta.banco + ' ···' + cuenta.ultimos4 + ': ' + pares.length + ' de ' + det.movimientos.length);
  return {
    cuenta: { banco: cuenta.banco, ultimos4: cuenta.ultimos4, empresa: cuenta.empresa }, filas: det.movimientos.length, emparejados: pares.length,
    sin_cartola: det.movimientos.filter((y) => !y._par).length, cartola_sin_detalle: movs.length - pares.length
  };
});

// ---------------------------------------------------------------- pagadores

function pagadores_() {
  const m = new Map();
  db_().prepare('SELECT huella, datos FROM FIN_PAGADORES').all().forEach((r) => m.set(r.huella, I.des_(r.datos)));
  return m;
}
/** Anota que un pagador pagó por un cliente (veces += 1). */
function registrarPagador_(nombre, clienteId, cliente, origen) {
  if (!txt_(nombre) || !clienteId) return;
  const h = huella_('pagador', nombre);
  const d = db_();
  const r = d.prepare('SELECT datos FROM FIN_PAGADORES WHERE huella = ?').get(h);
  const p = r ? I.des_(r.datos) : { nombre: txt_(nombre), clientes: {} };
  const c = p.clientes[clienteId] || { cliente, veces: 0, origen };
  c.veces += 1; c.cliente = cliente || c.cliente;
  p.clientes[clienteId] = c;
  d.prepare('INSERT INTO FIN_PAGADORES (huella, datos, actualizado_en) VALUES (?,?,?) ON CONFLICT(huella) DO UPDATE SET datos = excluded.datos, actualizado_en = excluded.actualizado_en')
    .run(h, I.cif_(p), new Date().toISOString());
}
/** ¿Es el propio cliente el que transfiere? (nombre del pagador ≈ razón social) */
function clientePorNombre_(nombre, clientes) {
  const n = I.normalizar_(nombre).replace(/\b(SPA|LTDA|LIMITADA|EIRL|S A|SA)\b/g, '').trim();
  if (n.length < 6) return null;
  const c = clientes.filter((x) => { const k = x.n.replace(/\b(SPA|LTDA|LIMITADA|EIRL|S A|SA)\b/g, '').trim(); return k === n || (k.indexOf(n) === 0 && n.length >= 12) || (n.indexOf(k) === 0 && k.length >= 12); });
  return c.length === 1 ? c[0] : null;
}

// ---------------------------------------------------------------- nombres cortos (alias) del Excel BANCOS

function aliasMapa_() {
  const m = new Map();
  db_().prepare('SELECT huella, datos FROM FIN_ALIAS').all().forEach((r) => m.set(r.huella, I.des_(r.datos)));
  return m;
}
const GASTOS_CONOCIDOS = { COMISION: 'Comisión Banco', 'CUENTAS BASICAS': 'Cuentas Básicas', ARRIENDO: 'Arriendo Mensual', 'CAJA CHICA': 'Caja Chica', PATENTE: 'Patente Comercial' };
/** Propuesta automática para un nombre corto: cliente (todas sus palabras en la razón social, único), empresa del grupo o gasto conocido. */
function proponerAlias_(alias, clientes) {
  const a = I.normalizar_(alias);
  if (!a) return null;
  if (GASTOS_CONOCIDOS[a]) return { clase: 'gasto', cuenta: GASTOS_CONOCIDOS[a] };
  const emp = FB.EMPRESAS.find((e) => I.normalizar_(e) === a || (a === 'AYS' && e === 'HomePymes') || (a.indexOf('VIRTUAL') === 0 && e === 'Virtual Base'));
  if (emp) return { clase: 'empresa', empresa: emp };
  const palabras = a.replace(/\bCONST\b/g, 'CONSTRUC').split(' ').filter((p) => p.length >= 3);
  if (!palabras.length) return null;
  const cand = clientes.filter((c) => palabras.every((p) => c.n.split(' ').some((w) => w.indexOf(p) === 0)));
  return cand.length === 1 ? { clase: 'cliente', cliente_id: cand[0].id, cliente: cand[0].nombre } : null;
}

/** Filas de la hoja AYS - BCI del Excel BANCOS → [{fecha, monto, alias, plan, obs, glosa}] */
function leerExcelBancos(filas) {
  filas = Array.isArray(filas) ? filas : [];
  const iH = filas.findIndex((f) => Array.isArray(f) && f.some((c) => txt_(c) === 'FECHA') && f.some((c) => txt_(c) === 'DETALLE') && f.some((c) => txt_(c) === 'TOTAL'));
  if (iH === -1) return { error: 'No reconozco este Excel. Es la planilla «BANCOS» (hoja con FECHA, DETALLE, TOTAL, OBS y DETALLE BANCO).' };
  const H = Array.from(filas[iH], txt_);
  const ix = (n) => H.indexOf(n);
  const C = { total: ix('TOTAL'), fecha: ix('FECHA'), det: ix('DETALLE'), plan: ix('PLAN DE CUENTA'), obs: ix('OBS'), banco: ix('DETALLE BANCO') };
  const out = [];
  filas.slice(iH + 1).forEach((f) => {
    const c = Array.from(f || [], txt_);
    const monto = FB.monto_(c[C.total]);
    const fecha = I.fechaIso_(c[C.fecha]);
    if (!fecha || !monto || isNaN(monto)) return;
    out.push({ fecha, monto, abono: monto > 0 ? monto : 0, cargo: monto < 0 ? -monto : 0, alias: c[C.det], plan: C.plan >= 0 ? c[C.plan] : '', obs: C.obs >= 0 ? c[C.obs] : '', glosa: C.banco >= 0 ? c[C.banco] : '' });
  });
  return { filas: out };
}

/** Paso 1: los nombres cortos del Excel, con lo que ya se sabe de cada uno y una propuesta. No guarda nada. */
const revisarExcelBancos = B.conBoveda('', function (db, data) {
  const ex = leerExcelBancos(data && data.filas);
  if (ex.error) return errorValidacion('archivo', ex.error);
  const clientes = I.clientes_(db);
  const conocidos = aliasMapa_();
  const grupos = new Map();
  ex.filas.forEach((f) => {
    const k = I.normalizar_(f.alias) || '(SIN NOMBRE)';
    const g = grupos.get(k) || { alias: f.alias || '(sin nombre)', filas: 0, total: 0, pagadores: new Set() };
    g.filas++; g.total += f.monto;
    const pag = analizarDescripcion_(f.glosa).pagador; if (pag) g.pagadores.add(pag);
    grupos.set(k, g);
  });
  const lista = [...grupos.values()].map((g) => {
    const actual = conocidos.get(huella_('alias', g.alias)) || null;
    return { alias: g.alias, filas: g.filas, total: g.total, pagadores: [...g.pagadores].slice(0, 4), actual: actual && actual.destino, propuesta: actual ? null : proponerAlias_(g.alias, clientes) };
  }).sort((a, b) => (a.actual ? 1 : 0) - (b.actual ? 1 : 0) || b.filas - a.filas);
  return { filas: ex.filas.length, desde: ex.filas.reduce((a, f) => (!a || f.fecha < a ? f.fecha : a), ''), hasta: ex.filas.reduce((a, f) => (f.fecha > a ? f.fecha : a), ''), nombres: lista };
});

/** Guarda qué es cada nombre corto: cliente, empresa del grupo, gasto de la empresa o ignorar. */
const guardarAlias = B.conBoveda('', function (db, data, contexto, x) {
  if (I.soloEscritura_(contexto)) return errorForbidden('Tu acceso a Finanzas es de solo lectura.');
  const clientes = new Map(I.clientes_(db).map((c) => [c.id, c.nombre]));
  const lista = Array.isArray(data && data.alias) ? data.alias.slice(0, 1000) : [];
  const ahora = new Date().toISOString();
  let n = 0;
  const errores = [];
  lista.forEach((a) => {
    const destino = { clase: txt_(a.clase) };
    if (destino.clase === 'cliente') { if (!clientes.has(txt_(a.cliente_id))) { errores.push(a.alias + ': elige el cliente'); return; } destino.cliente_id = txt_(a.cliente_id); destino.cliente = clientes.get(destino.cliente_id); }
    else if (destino.clase === 'empresa') { if (FB.EMPRESAS.indexOf(txt_(a.empresa)) === -1) { errores.push(a.alias + ': elige la empresa'); return; } destino.empresa = txt_(a.empresa); }
    else if (destino.clase === 'gasto') { if (FB.TIPOS && FB.CUENTAS_EGRESO.indexOf(txt_(a.cuenta)) === -1) { errores.push(a.alias + ': elige la cuenta del gasto'); return; } destino.cuenta = txt_(a.cuenta); }
    else if (destino.clase !== 'ignorar') return;
    db_().prepare('INSERT INTO FIN_ALIAS (huella, datos, actualizado_en, actualizado_por) VALUES (?,?,?,?) ON CONFLICT(huella) DO UPDATE SET datos = excluded.datos, actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por')
      .run(huella_('alias', a.alias), I.cif_({ alias: txt_(a.alias), destino }), ahora, x.nombre);
    n++;
  });
  if (n) x.registrar('GUARDAR_NOMBRES', n + ' nombre(s) corto(s)');
  return { guardados: n, errores };
});

/** Lo que el Excel dice de una fila, traducido a una clasificación de SIGSO. */
function clasifDesdeExcel_(fila, destino, medio) {
  if (!destino || destino.clase === 'ignorar') return null;
  const obs = I.normalizar_(fila.obs), plan = I.normalizar_(fila.plan);
  const concepto = (() => {
    if (/IVA|PAGO DIFERIDO|POSTERG/.test(obs + ' ' + plan) && !/IMPOSIC/.test(obs)) return 'IVA';
    if (/IMPOSIC/.test(obs + ' ' + plan)) return 'Imposiciones';
    if (/CONVENIO/.test(plan)) return 'Convenios';
    if (/RENTA/.test(plan + ' ' + obs)) return 'Renta';
    if (/SUELDO/.test(plan)) return 'Sueldos';
    if (medio === 'PREVIRED') return 'Imposiciones';
    if (medio === 'SII') return 'IVA';
    if (medio === 'TESORERIA') return 'Convenios';
    return 'Otro';
  })();
  if (destino.clase === 'gasto') return fila.cargo ? { tipo: 'EGRESO', cuenta: destino.cuenta } : { tipo: 'INGRESO', cuenta: 'Otros Ingresos' };
  if (destino.clase === 'empresa') return { tipo: destino.empresa === fila._empresaCuenta ? 'TRASPASO' : 'PRESTAMO', empresa: destino.empresa === fila._empresaCuenta ? '' : destino.empresa };
  // Cliente: ABONO = honorarios; lo demás es plata del cliente (para sus imposiciones, IVA…).
  if (fila.abono) {
    if (obs === 'ABONO') return { tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: destino.cliente_id, cliente: destino.cliente };
    if (obs === 'ABONO RENTA') return { tipo: 'INGRESO', cuenta: 'Servicio Renta', cliente_id: destino.cliente_id, cliente: destino.cliente };
    return { tipo: 'FONDO_RECIBIDO', cuenta: concepto, cliente_id: destino.cliente_id, cliente: destino.cliente };
  }
  return { tipo: 'FONDO_PAGADO', cuenta: concepto, cliente_id: destino.cliente_id, cliente: destino.cliente };
}

/**
 * Paso 2: aprende del Excel. Cada fila se empareja con su movimiento de la
 * cartola (misma cuenta, monto y sentido; fecha exacta y luego ±3 días): la
 * fila queda como sugerencia del movimiento (si está pendiente) y el pagador
 * aprende de qué cliente era. Nunca confirma nada.
 */
const aprenderExcelBancos = B.conBoveda('', function (db, data, contexto, x) {
  if (I.soloEscritura_(contexto)) return errorForbidden('Tu acceso a Finanzas es de solo lectura.');
  const ex = leerExcelBancos(data && data.filas);
  if (ex.error) return errorValidacion('archivo', ex.error);
  const cuenta = I.cuentasMapa_().get(txt_(data && data.cuenta));
  if (!cuenta) return errorValidacion('cuenta', 'Elige a qué cuenta del banco corresponde esta hoja.');
  const r = rango_(ex.filas, 'fecha');
  const movs = movimientosDe_(cuenta.id, r[0], r[1]);
  const pares = emparejar_(ex.filas, movs, (y) => y.fecha);
  const alias = aliasMapa_();
  const d = db_();
  let sugeridos = 0, aprendidos = 0, sinNombre = 0;
  d.exec('BEGIN');
  try {
    pares.forEach((p) => {
      const destino = (alias.get(huella_('alias', p.x.alias)) || {}).destino;
      if (!destino) sinNombre++;
      const medio = (p.m.d.detalle && p.m.d.detalle.medio) || analizarDescripcion_(p.x.glosa).medio;
      p.x._empresaCuenta = cuenta.empresa;
      p.m.d.planilla = { alias: p.x.alias, obs: p.x.obs, plan: p.x.plan, glosa: p.x.glosa, clasif: clasifDesdeExcel_(p.x, destino, medio) };
      d.prepare('UPDATE FIN_MOVIMIENTOS SET datos = ? WHERE id = ?').run(I.cif_(p.m.d), p.m.r.id);
      if (p.m.d.planilla.clasif) sugeridos++;
      const pagador = (p.m.d.detalle && p.m.d.detalle.pagador) || analizarDescripcion_(p.x.glosa).pagador;
      if (pagador && destino && destino.clase === 'cliente' && p.x.abono) { registrarPagador_(pagador, destino.cliente_id, destino.cliente, 'excel'); aprendidos++; }
    });
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
  FB.resugerirPendientes_(db);
  x.registrar('APRENDER_EXCEL_BANCOS', cuenta.banco + ' ···' + cuenta.ultimos4 + ': ' + pares.length + ' de ' + ex.filas.length + ' filas');
  return { filas: ex.filas.length, emparejadas: pares.length, sin_movimiento: ex.filas.length - pares.length, con_sugerencia: sugeridos, nombres_sin_ensenar: sinNombre, pagadores_aprendidos: aprendidos };
});

// ---------------------------------------------------------------- sugerencia con pagador y detalle

/**
 * Lo que agrega esta etapa a la sugerencia de un movimiento (finanzasBancos.sugerir_
 * lo llama antes de sus reglas por glosa). Devuelve una sugerencia o null.
 *   1. Lo que dijo el Excel BANCOS para este movimiento (media: ellas lo anotaron).
 *   2. El pagador ya conocido: un solo cliente → media; varios → baja con las opciones.
 *   3. El pagador ES el cliente (mismo nombre) → media.
 *   4. Pago a Previred / SII / Tesorería: concepto por el medio; cliente si alguien
 *      transfirió exactamente ese monto en los 10 días anteriores.
 */
function sugerirConPagador_(m, ctx, base) {
  const sentido = m.abono > 0 ? 'abono' : 'cargo';
  if (m.planilla && m.planilla.clasif && FB.completa_(m.planilla.clasif, sentido)) {
    return Object.assign({}, base, m.planilla.clasif, { certeza: 'media', motivo: 'Así lo anotaron en el Excel BANCOS («' + m.planilla.alias + (m.planilla.obs ? ' · ' + m.planilla.obs : '') + '»)' });
  }
  const det = m.detalle || {};
  if (det.pagador && sentido === 'abono') {
    const p = ctx.pagadores && ctx.pagadores.get(huella_('pagador', det.pagador));
    const lista = p ? Object.keys(p.clientes).map((id) => Object.assign({ id }, p.clientes[id])).sort((a, b) => b.veces - a.veces) : [];
    const previo = (id) => ctx.tipoPorCliente.get(id);
    if (lista.length === 1) {
      const c = lista[0], t = previo(c.id);
      return Object.assign({}, base, { cliente_id: c.id, cliente: c.cliente, tipo: t && FB.TIPOS[t.tipo].sentido === sentido ? t.tipo : '', cuenta: t && FB.TIPOS[t.tipo].sentido === sentido ? t.cuenta : '',
        certeza: 'media', motivo: det.pagador + ' ha pagado ' + c.veces + ' vez/veces por ' + c.cliente + '. Confírmalo.' });
    }
    if (lista.length > 1) {
      return Object.assign({}, base, { opciones: lista.slice(0, 5).map((c) => ({ cliente_id: c.id, cliente: c.cliente, veces: c.veces })), certeza: 'baja',
        motivo: det.pagador + ' ha pagado por ' + lista.length + ' clientes: ' + lista.slice(0, 3).map((c) => c.cliente + ' (' + c.veces + ')').join(', ') + '. Elige, o divide la transferencia.' });
    }
    const mismo = clientePorNombre_(det.pagador, ctx.clientes);
    if (mismo) {
      const t = previo(mismo.id);
      return Object.assign({}, base, { cliente_id: mismo.id, cliente: mismo.nombre, tipo: t && FB.TIPOS[t.tipo].sentido === sentido ? t.tipo : '', cuenta: t && FB.TIPOS[t.tipo].sentido === sentido ? t.cuenta : '',
        certeza: 'media', motivo: 'Transfiere el mismo cliente (' + det.pagador + ')' + (t ? '; se usa lo de la última vez' : '; falta decir si es honorario o fondo') });
    }
    return Object.assign({}, base, { certeza: 'baja', motivo: 'Transfirió ' + det.pagador + ': no es un cliente conocido. Puede estar pagando por otro: elige de qué cliente es.' });
  }
  if (sentido === 'cargo' && /^(PREVIRED|SII|TESORERIA)$/.test(det.medio || '')) {
    const concepto = det.medio === 'PREVIRED' ? 'Imposiciones' : det.medio === 'SII' ? 'IVA' : 'Convenios';
    const nombreMedio = det.medio === 'PREVIRED' ? 'Previred' : det.medio === 'SII' ? 'el SII' : 'la Tesorería';
    const origen = (ctx.recibidos || []).filter((x) => x.monto === m.cargo && x.fecha <= m.fecha && Date.parse(m.fecha) - Date.parse(x.fecha) <= 10 * 864e5 && x.cliente_id)
      .filter((x, i, l) => l.findIndex((y) => y.cliente_id === x.cliente_id) === i); // un cliente cuenta una vez
    if (origen.length === 1) {
      return Object.assign({}, base, { tipo: 'FONDO_PAGADO', cuenta: concepto, cliente_id: origen[0].cliente_id, cliente: origen[0].cliente, certeza: 'media',
        motivo: 'Pago a ' + nombreMedio + ' por el mismo monto que ' + origen[0].cliente + ' transfirió el ' + origen[0].fecha.slice(8) + '-' + origen[0].fecha.slice(5, 7) + '.' });
    }
    return Object.assign({}, base, { tipo: 'FONDO_PAGADO', cuenta: concepto, certeza: 'baja', motivo: 'Pago a ' + nombreMedio + ': falta de qué cliente (o si es de la propia empresa, «Gasto de la empresa»).' });
  }
  if (det.destinatario && sentido === 'cargo' && det.medio === 'TRANSFERENCIA') {
    const emp = FB.empresaEnTexto_(det.destinatario);
    if (emp) return Object.assign({}, base, { tipo: emp === ctx.empresa ? 'TRASPASO' : 'PRESTAMO', empresa: emp === ctx.empresa ? '' : emp, certeza: 'media', motivo: 'Transferencia a ' + det.destinatario });
  }
  return null;
}

/** Contexto extra para las sugerencias: pagadores y lo recibido por cliente (confirmado o sugerido). */
function contextoPagadores_() {
  const recibidos = [];
  db_().prepare('SELECT fecha, estado, datos FROM FIN_MOVIMIENTOS WHERE fecha >= ?').all(new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10)).forEach((r) => {
    const d = I.des_(r.datos);
    if (!(d.abono > 0)) return;
    piezas_(d, r.estado === 'CONFIRMADO' ? d.clasif : null).forEach((p) => {
      const c = p.clasif || (d.sugerencia && d.sugerencia.certeza !== 'baja' ? d.sugerencia : null);
      if (c && c.cliente_id) recibidos.push({ fecha: r.fecha, monto: p.abono, cliente_id: c.cliente_id, cliente: c.cliente });
    });
  });
  return { pagadores: pagadores_(), recibidos };
}

module.exports = {
  importarDetalle, revisarExcelBancos, guardarAlias, aprenderExcelBancos,
  piezas_, sugerirConPagador_, contextoPagadores_, registrarPagador_, leerDetalle, leerExcelBancos, analizarDescripcion_, proponerAlias_, clientePorNombre_
};
