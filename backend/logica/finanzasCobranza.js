'use strict';

/**
 * finanzasCobranza.js — facturas, abonos y cobranza (Etapa 3 del 2026-10-06;
 * versión 2 del 2026-10-20: FIN-21, FIN-22, FIN-23, FIN-24).
 *
 *  - FACTURAS: desde el Registro de Ventas del SII (CSV «Descargar detalles»,
 *    con el RUT de cada cliente) o desde la hoja FACTURAS de la planilla
 *    SIGECO. Identidad = empresa emisora + tipo de documento + folio (el mismo
 *    folio en dos empresas son dos facturas distintas). El SII manda: si una
 *    factura de la planilla llega después en el RCV, se reemplazan sus datos
 *    sin tocar sus aplicaciones. Vencimiento: el de la factura si se conoce
 *    (planilla, edición manual); si no, emisión + el parámetro de días.
 *  - ABONOS (recepciones): cada pieza de dinero clasificada como «Ingreso de
 *    la empresa» con su cliente, venga del banco o del registro operativo
 *    (incluido efectivo; una compensación aplica a facturas pero no es caja).
 *    Se registra UNA vez y no desaparece si todavía no tiene factura.
 *  - APLICACIONES (v2): un abono se aplica EXPLÍCITAMENTE a una o varias
 *    facturas, total o parcial; varias recepciones pueden pagar una factura.
 *    La fecha del abono y la de la aplicación son distintas. Se bloquea
 *    aplicar a una factura inexistente, anulada, incobrable, sin saldo, de
 *    otro cliente o de otra empresa (salvo una relación de cobro por terceros
 *    autorizada). Desaplicar deja la historia.
 *  - FIFO es SUGERENCIA: lo que un cliente pagó y todavía no está aplicado se
 *    propone sobre sus facturas de la más antigua a la más nueva. Las cifras
 *    muestran cuánto es confirmado y cuánto sugerido; «Aceptar sugeridas» lo
 *    vuelve explícito.
 *  - NOTAS DE CRÉDITO: con folio de referencia, rebajan ESA factura una vez;
 *    sin referencia, quedan como crédito del cliente.
 *  - FONDO_RECIBIDO no paga facturas: es plata del cliente.
 */

const crypto = require('node:crypto');
const B = require('./finanzasBoveda');
const Base = require('./finanzasBase');
const Cat = require('./finanzasCatalogos');
const FB = require('./finanzasBancos');
const SII = require('./controlInternoSII');
const { errorValidacion } = require('./errores');

const I = FB.interno;
const TRAMOS = [['al_dia', 'Al día'], ['d1_30', '1–30 días'], ['d31_60', '31–60 días'], ['d61_90', '61–90 días'], ['d90', 'Más de 90 días']];
const NOTA_CREDITO = 61;

// ---------------------------------------------------------------- esquema

let preparada_ = null;
Base.registrarEsquema_(() => { preparada_ = null; });
function db_() {
  const d = I.db_();
  if (preparada_ === d) return d;
  [
    `CREATE TABLE IF NOT EXISTS FIN_FACTURAS (
       id TEXT PRIMARY KEY, empresa TEXT NOT NULL, fecha TEXT NOT NULL, periodo TEXT NOT NULL,
       huella TEXT NOT NULL UNIQUE, estado TEXT NOT NULL, origen TEXT NOT NULL, datos TEXT NOT NULL,
       actualizado_en TEXT, actualizado_por TEXT)`,
    'CREATE INDEX IF NOT EXISTS ix_fin_fact ON FIN_FACTURAS (empresa, fecha)',
    `CREATE TABLE IF NOT EXISTS FIN_EMISORES (huella_rut TEXT PRIMARY KEY, empresa TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS FIN_APLICACIONES (
       id TEXT PRIMARY KEY, factura_id TEXT NOT NULL, recepcion_ref TEXT NOT NULL, estado TEXT NOT NULL, fecha_aplicacion TEXT NOT NULL,
       version INTEGER NOT NULL DEFAULT 1, datos TEXT NOT NULL, clave_origen TEXT, creado_en TEXT, creado_por TEXT, deshecho_en TEXT, deshecho_por TEXT)`,
    'CREATE INDEX IF NOT EXISTS ix_fin_apl_fac ON FIN_APLICACIONES (factura_id, estado)',
    'CREATE INDEX IF NOT EXISTS ix_fin_apl_rec ON FIN_APLICACIONES (recepcion_ref, estado)',
    'CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_apl_origen ON FIN_APLICACIONES (clave_origen) WHERE clave_origen IS NOT NULL',
    `CREATE TABLE IF NOT EXISTS FIN_RELACIONES_COBRO (
       id TEXT PRIMARY KEY, tipo TEXT NOT NULL, estado TEXT NOT NULL, datos TEXT NOT NULL, creado_en TEXT, creado_por TEXT)`
  ].forEach((sql) => d.exec(sql));
  Base.asegurarColumna_(d, 'FIN_FACTURAS', 'version', 'INTEGER NOT NULL DEFAULT 1');
  preparada_ = d;
  return d;
}

// ---------------------------------------------------------------- utilidades

const hoy_ = () => Base.hoy_();
const sumarDias_ = (iso, n) => Base.sumarDias_(iso, n);
function dias_(desde, hasta) { return Math.round((Date.parse(hasta + 'T12:00:00Z') - Date.parse(desde + 'T12:00:00Z')) / 864e5); }
function rutNorm_(r) { const s = String(r || '').replace(/[^0-9kK]/g, '').toUpperCase(); return s.length >= 2 ? s.slice(0, -1).replace(/^0+/, '') + '-' + s.slice(-1) : ''; }
function huellaFactura_(empresa, tipo, folio) { return I.hmac_(['factura', empresa, Number(tipo) || 33, String(folio).trim()].join('|')); }
const txt_ = (v) => String(v == null ? '' : v).trim();
function tramo_(dias) { return dias <= 0 ? 'al_dia' : dias <= 30 ? 'd1_30' : dias <= 60 ? 'd31_60' : dias <= 90 ? 'd61_90' : 'd90'; }
function diasVencimiento_() { try { return Cat.param_('vencimiento_dias', 30); } catch (e) { return 30; } }

function clientePorRut_(clientes) {
  const m = new Map();
  clientes.forEach((c) => { const r = rutNorm_(c.rut); if (r) m.set(r, c); });
  return m;
}
function facturaPublica_(r) {
  const d = I.des_(r.datos);
  return Object.assign({ id: r.id, empresa: r.empresa, fecha: r.fecha, estado: r.estado, origen: r.origen, version: r.version || 1, actualizado_por: r.actualizado_por }, d);
}

// ---------------------------------------------------------------- recepciones y aplicaciones

/** Recepciones elegibles para aplicar a facturas: ingresos de la empresa con cliente (banco o registro). */
function recepciones_(filtro) {
  filtro = filtro || {};
  const H = require('./finanzasHechos');
  return H.hechos_({ soloConfirmados: true }).filter((h) => h.clasif && h.clasif.tipo === 'INGRESO' && h.clasif.cliente_id && h.abono > 0 &&
    (!filtro.cliente_id || h.clasif.cliente_id === filtro.cliente_id))
    .map((h) => ({ ref: h.ref, fuente: h.fuente, fecha: h.fecha, monto: h.abono, cliente_id: h.clasif.cliente_id, cliente: h.clasif.cliente, empresa: h.empresa, medio: h.medio, caja: h.caja,
      glosa: h.glosa || '', nota: h.clasif.nota || '', cuenta: h.clasif.cuenta, banco: h.banco || '', ultimos4: h.ultimos4 || '', fecha_banco: h.fecha_banco || '' }));
}
/**
 * Identidad económica (corrección v2, I01): una aplicación pudo hacerse sobre
 * la parte del REGISTRO ('op:…') que después se concilió y hoy la representa
 * una parte del BANCO ('mov:…', con origen_ref). Estas son todas las
 * referencias que significan el mismo abono.
 */
function refsEquivalentes_(ref) {
  const H = require('./finanzasHechos');
  const out = new Set([ref]);
  H.resolverRef_(ref).forEach((r) => out.add(r));
  H.alias_().forEach((refs, origen) => { if (refs.indexOf(ref) !== -1 || out.has(origen)) { out.add(origen); refs.forEach((r) => out.add(r)); } });
  return [...out];
}
function aplicaciones_(filtro) {
  filtro = filtro || {};
  const d = db_();
  const filas = filtro.factura_id ? d.prepare('SELECT * FROM FIN_APLICACIONES WHERE factura_id = ? ORDER BY creado_en').all(filtro.factura_id)
    : filtro.recepcion_ref ? d.prepare('SELECT * FROM FIN_APLICACIONES WHERE recepcion_ref = ? ORDER BY creado_en').all(filtro.recepcion_ref)
      : d.prepare('SELECT * FROM FIN_APLICACIONES ORDER BY creado_en').all();
  return filas.filter((r) => filtro.todas || r.estado === 'ACTIVA').map((r) => Object.assign({ id: r.id, factura_id: r.factura_id, recepcion_ref: r.recepcion_ref, estado: r.estado,
    fecha_aplicacion: r.fecha_aplicacion, version: r.version, creado_por: r.creado_por, creado_en: r.creado_en, deshecho_por: r.deshecho_por || '' }, I.des_(r.datos)));
}
/** ¿Algún abono de este movimiento u operación está aplicado? (prefijo 'mov:<id>' u 'op:<id>') */
function recepcionAplicada_(prefijo) {
  return !!db_().prepare("SELECT 1 FROM FIN_APLICACIONES WHERE estado = 'ACTIVA' AND recepcion_ref LIKE ? LIMIT 1").get(prefijo + ':%');
}
function relaciones_() {
  return db_().prepare("SELECT * FROM FIN_RELACIONES_COBRO WHERE estado = 'ACTIVA'").all().map((r) => Object.assign({ id: r.id, tipo: r.tipo, creado_por: r.creado_por }, I.des_(r.datos)));
}
/** Una relación de cobro rige para un abono si la fecha del abono cae en su vigencia. */
function vigente_(x, fecha) { return (!x.desde || fecha >= x.desde) && (!x.hasta || fecha <= x.hasta); }
/**
 * ¿Se permite aplicar un abono de (cliente, empresa) a una factura de (cliente, empresa)?
 * Devuelve { motivo (vacío si se permite), via: [textos de las relaciones que lo habilitan] }.
 * I04.4: una relación CLIENTE puede limitarse a una empresa emisora; cada relación tiene vigencia.
 */
function permitidoDetalle_(rec, f, rels) {
  const via = [];
  let cliOk = rec.cliente_id === f.cliente_id;
  if (!cliOk) {
    const r = rels.find((x) => x.tipo === 'CLIENTE' && x.pagador_id === rec.cliente_id && x.beneficiario_id === f.cliente_id && (!x.emisor || x.emisor === f.empresa) && vigente_(x, rec.fecha));
    if (r) { cliOk = true; via.push(r.pagador + ' paga por ' + r.beneficiario + (r.emisor ? ' (facturas de ' + r.emisor + ')' : '') + ' · autorizó ' + (r.autorizado_por || r.creado_por) + ' · ' + r.motivo); }
  }
  let empOk = rec.empresa === f.empresa;
  if (!empOk) {
    const r = rels.find((x) => x.tipo === 'EMPRESA' && x.recibe === rec.empresa && x.emite === f.empresa && vigente_(x, rec.fecha));
    if (r) { empOk = true; via.push(r.recibe + ' cobra facturas de ' + r.emite + ' · autorizó ' + (r.autorizado_por || r.creado_por) + ' · ' + r.motivo); }
  }
  if (!cliOk) return { motivo: 'La factura es de otro cliente (' + (f.cliente || f.razon_social) + '). Solo con una relación de cobro por terceros autorizada y vigente.', via };
  if (!empOk) return { motivo: 'La factura la emitió ' + f.empresa + ' y el abono entró a ' + rec.empresa + '. Solo con una relación de cobro por terceros autorizada y vigente.', via };
  return { motivo: '', via };
}
function permitido_(rec, f, rels) { return permitidoDetalle_(rec, f, rels).motivo; }

// ---------------------------------------------------------------- cartera (el corazón)

/**
 * Facturas, recepciones y aplicaciones por cliente. Devuelve un mapa clave →
 * { clave, cliente_id, cliente, rut, facturas:[…con aplicado_confirmado,
 *   aplicado_sugerido, saldo, saldo_confirmado, dias, tramo, situacion],
 *   recepciones:[…con aplicado, sugerido, sin_aplicar], sugerencias:[…],
 *   por_cobrar, vencido, saldo_a_favor (= sin aplicar), sin_aplicar … }.
 * La clave es el cliente de SIGSO; si la factura trae un RUT que no está en
 * SIGSO, "rut:<RUT>" (no recibe abonos hasta que se cree el cliente).
 */
// I12.2: la cartera se arma una vez por revisión de datos (y día): la usan cobranza, pendientes, informe y avisos.
const memoCartera_ = new Map();
B.registrarLimpieza_(() => memoCartera_.clear());
function cartera_(db, opciones) {
  const o = opciones || {};
  return Base.memo_(memoCartera_, JSON.stringify([o.empresa || '', o.hoy || hoy_()]), () => carteraCalc_(db, o));
}
function carteraCalc_(db, opciones) {
  opciones = opciones || {};
  const hoy = opciones.hoy || hoy_();
  const d = db_();
  const clientes = I.clientes_(db);
  const porId = new Map(clientes.map((c) => [c.id, c]));
  const porRut = clientePorRut_(clientes);
  const mapa = new Map();
  const nodo = (clave, base) => {
    if (!mapa.has(clave)) mapa.set(clave, Object.assign({ clave, cliente_id: '', cliente: '', rut: '', facturas: [], recepciones: [], sugerencias: [], notas: [], notas_credito: 0, nc_sin_referencia: 0 }, base));
    return mapa.get(clave);
  };
  const facturas = new Map(); // id → factura (para aplicaciones)
  const porFolio = new Map(); // empresa|folio → factura (para notas de crédito con referencia)
  const notas = [];
  d.prepare("SELECT * FROM FIN_FACTURAS WHERE estado != 'ANULADA' ORDER BY fecha, rowid").all().forEach((r) => {
    const f = facturaPublica_(r);
    if (opciones.empresa && f.empresa !== opciones.empresa) return;
    let cli = f.cliente_id && porId.get(f.cliente_id);
    if (!cli && f.rut) cli = porRut.get(rutNorm_(f.rut));
    const n = cli ? nodo(cli.id, { cliente_id: cli.id, cliente: cli.nombre, rut: cli.rut || f.rut })
      : nodo('rut:' + (rutNorm_(f.rut) || f.razon_social || f.id), { cliente: f.razon_social || 'Sin cliente', rut: f.rut });
    f.cliente_id = cli ? cli.id : ''; f.cliente = n.cliente; f._nodo = n;
    if (Number(f.tipo_doc) === NOTA_CREDITO) { notas.push(f); return; }
    f.nc = 0; f.aplicado_confirmado = 0; f.aplicado_sugerido = 0; f.aplicaciones = [];
    n.facturas.push(f); facturas.set(f.id, f); porFolio.set(f.empresa + '|' + f.folio, f);
  });
  // Notas de crédito: con referencia rebajan esa factura (una vez); sin referencia, crédito del cliente.
  notas.forEach((nc) => {
    const ref = nc.referencia ? porFolio.get(nc.empresa + '|' + nc.referencia) : null;
    nc._nodo.notas_credito += Math.abs(nc.total);
    const usa = ref && ref._nodo === nc._nodo;
    if (usa) ref.nc += Math.abs(nc.total);
    else nc._nodo.nc_sin_referencia += Math.abs(nc.total);
    nc._nodo.notas.push({ id: nc.id, empresa: nc.empresa, tipo_doc: nc.tipo_doc, folio: nc.folio, fecha: nc.fecha, total: nc.total, referencia: nc.referencia || '', rebaja: usa ? ref.folio : '', version: nc.version, origen: nc.origen });
  });
  // Recepciones.
  const recs = new Map();
  recepciones_().filter((r) => !opciones.empresa || r.empresa === opciones.empresa).forEach((r) => {
    const cli = porId.get(r.cliente_id);
    const n = nodo(r.cliente_id, { cliente_id: r.cliente_id, cliente: cli ? cli.nombre : r.cliente, rut: cli ? cli.rut : '' });
    const rec = Object.assign({}, r, { aplicado: 0, sugerido: 0 });
    n.recepciones.push(rec); recs.set(r.ref, rec);
  });
  // I01: la aplicación hecha sobre el registro sigue encontrando su abono después de conciliar.
  const H = require('./finanzasHechos');
  H.alias_().forEach((refs, origen) => { if (!recs.has(origen) && refs.length === 1 && recs.has(refs[0])) recs.set(origen, recs.get(refs[0])); });
  // Un registro en conflicto de identidad (posible duplicado de un movimiento ya clasificado) no es un abono
  // disponible —cuenta el banco—, pero las aplicaciones que ya tenía se respetan hasta que alguien decida.
  H.conflictos_({}).forEach((c) => c.hechos.forEach((h) => {
    if (recs.has(h.ref) || !h.clasif || h.clasif.tipo !== 'INGRESO' || !(h.abono > 0)) return;
    recs.set(h.ref, { ref: h.ref, fuente: h.fuente, fecha: h.fecha, monto: h.abono, cliente_id: h.clasif.cliente_id, empresa: h.empresa, conflicto: true, aplicado: 0, sugerido: 0 });
  }));
  // Aplicaciones explícitas (se ignoran las que quedaron sin su recepción o factura: se informan).
  const huerfanas = [];
  aplicaciones_().forEach((a) => {
    const f = facturas.get(a.factura_id), rec = recs.get(a.recepcion_ref);
    if (!f || !rec) { if (!opciones.empresa) huerfanas.push(a); return; }
    f.aplicado_confirmado += a.monto; rec.aplicado += a.monto;
    f.aplicaciones.push({ id: a.id, version: a.version, recepcion_ref: a.recepcion_ref, monto: a.monto, fecha_aplicacion: a.fecha_aplicacion, fecha_recepcion: rec.fecha, por: a.creado_por, glosa: rec.glosa || '', cuenta: rec.banco ? rec.banco + ' ···' + rec.ultimos4 : (rec.medio || 'Registro'), cliente_cobro: rec.cliente_id });
  });
  const venceDias = diasVencimiento_();
  const relsFifo = relaciones_();
  mapa.forEach((n) => {
    // FIFO como sugerencia: lo no aplicado de cada recepción, sobre lo que falta de cada factura (más antigua primero).
    // I12.2: el permiso (mismo emisor o relación vigente) depende de la recepción y de la empresa de la factura: se recuerda.
    const recLibres = n.recepciones.slice().sort((a, b) => (a.fecha < b.fecha ? -1 : 1)).map((r) => ({ r, libre: r.monto - r.aplicado, perm: new Map() }));
    let ini = 0;
    let credito = n.nc_sin_referencia;
    n.facturas.forEach((f) => {
      f.vence = f.vence || sumarDias_(f.fecha, venceDias);
      if (f.estado === 'INCOBRABLE') return;
      let falta = f.total - f.nc - f.aplicado_confirmado;
      if (credito > 0 && falta > 0) { const c = Math.min(credito, falta); credito -= c; falta -= c; f.nc_cliente = c; }
      while (ini < recLibres.length && recLibres[ini].libre <= 0) ini++; // las primeras ya agotadas no se vuelven a mirar
      const fCli = Object.assign({}, f, { cliente_id: n.cliente_id });
      for (let i = ini; i < recLibres.length; i++) {
        const x = recLibres[i];
        if (falta <= 0) break;
        if (x.libre <= 0) continue;
        // La sugerencia respeta lo mismo que aplicar: mismo emisor o una relación de terceros vigente.
        let ok = x.perm.get(f.empresa);
        if (ok === undefined) { ok = !permitido_(x.r, fCli, relsFifo); x.perm.set(f.empresa, ok); }
        if (!ok) continue;
        const m = Math.min(x.libre, falta);
        x.libre -= m; falta -= m; x.r.sugerido += m; f.aplicado_sugerido += m;
        n.sugerencias.push({ recepcion_ref: x.r.ref, factura_id: f.id, folio: f.folio, monto: m });
      }
    });
    n.credito_sin_usar = credito;
    n.por_cobrar = 0; n.por_cobrar_confirmado = 0; n.vencido = 0; n.vencido_confirmado = 0; n.dias_max = 0; n.facturado = 0;
    n.tramos = { al_dia: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0 };
    n.facturas.forEach((f) => {
      if (f.estado === 'INCOBRABLE') { f.saldo = f.total; f.saldo_confirmado = f.total; f.situacion = 'Incobrable'; f.dias = 0; f.creditos = 0; return; }
      n.facturado += f.total;
      f.creditos = (f.nc || 0) + (f.nc_cliente || 0);
      f.pagado = f.aplicado_confirmado + f.aplicado_sugerido + f.creditos;
      f.saldo = Math.max(0, f.total - f.pagado);
      f.saldo_confirmado = Math.max(0, f.total - f.aplicado_confirmado - f.creditos);
      f.dias_confirmado = f.saldo_confirmado > 0 ? Math.max(0, dias_(f.vence, hoy)) : 0;
      f.dias = f.saldo > 0 ? Math.max(0, dias_(f.vence, hoy)) : 0;
      // I04.2: «Pagada» exige saldo CONFIRMADO cero; lo que solo cubre una sugerencia es «Aplicación sugerida».
      f.situacion = f.saldo_confirmado === 0 ? 'Pagada' : f.aplicado_confirmado + f.creditos > 0 ? 'Pago parcial'
        : f.aplicado_sugerido > 0 ? 'Aplicación sugerida' : f.dias_confirmado > 0 ? 'Vencida' : 'Por vencer';
      if (f.dias_confirmado > 0) n.vencido_confirmado += f.saldo_confirmado;
      if (f.saldo > 0) {
        n.por_cobrar += f.saldo;
        n.tramos[tramo_(f.dias)] += f.saldo;
        if (f.dias > 0) { n.vencido += f.saldo; n.dias_max = Math.max(n.dias_max, f.dias); }
      }
      n.por_cobrar_confirmado += f.saldo_confirmado;
      delete f._nodo;
    });
    n.recepciones.forEach((r) => { r.sin_aplicar = r.monto - r.aplicado - r.sugerido; });
    n.sin_aplicar = n.recepciones.reduce((s, r) => s + r.sin_aplicar, 0) + n.credito_sin_usar;
    n.saldo_a_favor = n.sin_aplicar; // compatibilidad: lo pagado sin factura
    n.sugerido = n.sugerencias.reduce((s, x) => s + x.monto, 0);
    n.incobrable = n.facturas.filter((f) => f.estado === 'INCOBRABLE').reduce((s, f) => s + f.total, 0);
    // Compatibilidad con la Etapa 3: pagos = recepciones.
    n.pagos = n.recepciones.map((r) => ({ fecha: r.fecha, monto: r.monto, glosa: r.glosa, nota: r.nota, ref: r.ref, aplicado: r.aplicado, sugerido: r.sugerido, sin_aplicar: r.sin_aplicar, fuente: r.fuente, medio: r.medio }));
    n.creditos = n.recepciones.reduce((s, r) => s + r.monto, 0) + n.notas_credito;
  });
  mapa.huerfanas = huerfanas;
  return mapa;
}

/** Para Bancos: total pendiente de cada factura abierta → [{cliente_id, cliente, folio}] (solo clientes de SIGSO). */
function facturasPorMonto_(db) {
  const d = db_();
  if (!d.prepare('SELECT 1 FROM FIN_FACTURAS LIMIT 1').get()) return null;
  const m = new Map();
  cartera_(db).forEach((n) => {
    if (!n.cliente_id) return;
    n.facturas.forEach((f) => { if (f.saldo > 0 && f.estado !== 'INCOBRABLE') { const l = m.get(f.saldo) || []; l.push({ cliente_id: n.cliente_id, cliente: n.cliente, folio: f.folio }); m.set(f.saldo, l); } });
  });
  return m;
}
function facturasDeCliente_(db, clienteId) {
  return db_().prepare("SELECT * FROM FIN_FACTURAS WHERE estado != 'ANULADA'").all().map(facturaPublica_).filter((f) => f.cliente_id === clienteId);
}

// ---------------------------------------------------------------- guardar facturas

/** Lee del CSV del RCV las columnas de referencia (folio de la factura que rebaja una nota de crédito). */
function referenciasRcv_(texto) {
  const lineas = String(texto || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const iEnc = lineas.findIndex((l) => /;/.test(l) && /folio/i.test(l) && /tipo\s*doc/i.test(l));
  if (iEnc === -1) return new Map();
  const enc = lineas[iEnc].split(';').map((x) => Base.normalizar_(x));
  const iTipo = enc.findIndex((h) => h === 'TIPO DOC'), iFolio = enc.findIndex((h) => h === 'FOLIO');
  const iRef = enc.findIndex((h) => /^FOLIO (DOCTO )?REFERENCIA$/.test(h));
  const m = new Map();
  if (iRef === -1) return m;
  lineas.slice(iEnc + 1).forEach((l) => { const c = l.split(';'); const ref = String(c[iRef] || '').trim(); if (/^\d+$/.test(ref)) m.set(String(c[iTipo]).trim() + '|' + String(c[iFolio]).trim(), ref); });
  return m;
}

function guardarFacturas_(db, empresa, documentos, origen, quien) {
  const d = db_();
  const ahora = new Date().toISOString();
  let nuevas = 0, actualizadas = 0, repetidas = 0;
  const conflictos = [];
  const venceDias = diasVencimiento_();
  Base.transaccion_(() => {
    documentos.forEach((doc) => {
      const h = huellaFactura_(empresa, doc.tipo_doc, doc.folio);
      const previa = d.prepare('SELECT id, origen, estado, datos FROM FIN_FACTURAS WHERE huella = ?').get(h);
      const fecha = doc.fecha || hoy_();
      const datos = {
        tipo_doc: Number(doc.tipo_doc) || 33, folio: String(doc.folio), rut: doc.rut || '', razon_social: doc.razon_social || '',
        cliente_id: doc.cliente_id || '', exento: doc.exento || 0, neto: doc.neto || 0, iva: doc.iva || 0,
        total: doc.total || ((doc.neto || 0) + (doc.iva || 0) + (doc.exento || 0)),
        vence: doc.vence || sumarDias_(fecha, venceDias), vence_origen: doc.vence ? 'documento' : 'parametro',
        referencia: doc.referencia || '', concepto: doc.concepto || '', nota: '', estado_legado: doc.estado_legado || '', fuente: doc.fuente || null
      };
      if (previa) {
        // El SII manda sobre la planilla; lo que ya vino del SII no se toca (se conserva la nota, el vencimiento editado y el estado manual).
        if (previa.origen === 'planilla' && origen === 'rcv') {
          const vieja = I.des_(previa.datos);
          const aplicado = d.prepare("SELECT datos FROM FIN_APLICACIONES WHERE factura_id = ? AND estado = 'ACTIVA'").all(previa.id).reduce((t, a) => t + (I.des_(a.datos).monto || 0), 0);
          if (aplicado > datos.total) {
            // I04.4: primero se resuelve la compatibilidad (desaplicar lo que sobra); la factura queda marcada.
            vieja.conflicto_fuente = { total_nuevo: datos.total, aplicado, archivo: (doc.fuente && doc.fuente.archivo) || '', en: ahora };
            d.prepare('UPDATE FIN_FACTURAS SET datos = ?, version = COALESCE(version, 1) + 1 WHERE id = ?').run(I.cif_(vieja), previa.id);
            conflictos.push({ folio: datos.folio, total_nuevo: datos.total, aplicado });
            return;
          }
          datos.nota = vieja.nota || ''; datos.cliente_id = datos.cliente_id || vieja.cliente_id || '';
          if (vieja.vence_origen === 'manual' || vieja.vence_origen === 'documento') { datos.vence = vieja.vence; datos.vence_origen = vieja.vence_origen; }
          datos.estado_legado = vieja.estado_legado || ''; datos.reemplaza = { origen: 'planilla', total: vieja.total, fecha: vieja.fecha };
          d.prepare('UPDATE FIN_FACTURAS SET fecha = ?, periodo = ?, origen = ?, datos = ?, version = COALESCE(version, 1) + 1, actualizado_en = ?, actualizado_por = ? WHERE id = ?')
            .run(fecha, fecha.slice(0, 7), origen, I.cif_(datos), ahora, quien, previa.id);
          actualizadas++;
        } else repetidas++;
        return;
      }
      d.prepare('INSERT INTO FIN_FACTURAS (id, empresa, fecha, periodo, huella, estado, origen, datos, actualizado_en, actualizado_por) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(crypto.randomUUID(), empresa, fecha, fecha.slice(0, 7), h, 'VIGENTE', origen, I.cif_(datos), ahora, quien);
      nuevas++;
    });
  });
  return { nuevas, actualizadas, repetidas, conflictos };
}

function empresaDeEmisor_(rut) {
  if (!rut) return '';
  const r = db_().prepare('SELECT empresa FROM FIN_EMISORES WHERE huella_rut = ?').get(I.hmac_('emisor|' + rutNorm_(rut)));
  return r ? r.empresa : '';
}

/** Lee el CSV del RCV de ventas y dice qué haría, sin guardar. */
function leerVentas_(db, data) {
  const texto = String((data && data.texto) || '');
  const leido = SII.leer_(texto, String((data && data.nombre) || ''));
  if (!leido || leido.fuente !== 'rcv' || leido.nivel !== 'detalle') return { error: 'No es el detalle del Registro de Ventas del SII. Descárgalo desde el RCV › Ventas › «Descargar detalles» (CSV).' };
  if (leido.tipo !== 'ventas') return { error: 'Ese archivo es de COMPRAS. Para la cobranza se necesita el de VENTAS.' };
  const porRut = clientePorRut_(I.clientes_(db));
  const refs = referenciasRcv_(texto);
  const docs = leido.documentos.map((x) => {
    const c = porRut.get(rutNorm_(x.rut));
    return Object.assign({}, x, { cliente_id: c ? c.id : '', cliente: c ? c.nombre : '', referencia: refs.get(String(x.tipo_doc) + '|' + String(x.folio)) || '' });
  });
  return { leido, docs, rut_emisor: leido.rut || '', empresa_sugerida: empresaDeEmisor_(leido.rut) };
}

// ---------------------------------------------------------------- acciones: facturas

const revisarVentas = B.conBoveda('', function (db, data) {
  const r = leerVentas_(db, data);
  if (r.error) return Base.errFuente(r.error);
  const empresa = txt_(data.empresa) || r.empresa_sugerida || 'HomePymes';
  const d = db_();
  let nuevas = 0;
  r.docs.forEach((x) => { if (!d.prepare('SELECT 1 FROM FIN_FACTURAS WHERE huella = ?').get(huellaFactura_(empresa, x.tipo_doc, x.folio))) nuevas++; });
  const sinCliente = r.docs.filter((x) => !x.cliente_id);
  return {
    rut_emisor: r.rut_emisor, empresa_sugerida: r.empresa_sugerida, documentos: r.docs.length, nuevas,
    facturas: r.docs.filter((x) => Number(x.tipo_doc) !== NOTA_CREDITO).length, notas_credito: r.docs.filter((x) => Number(x.tipo_doc) === NOTA_CREDITO).length,
    total: r.docs.reduce((s, x) => s + (Number(x.tipo_doc) === NOTA_CREDITO ? -x.total : x.total), 0),
    sin_cliente: sinCliente.length, ejemplos_sin_cliente: [...new Set(sinCliente.map((x) => x.razon_social + ' (' + x.rut + ')'))].slice(0, 8),
    desde: r.docs.reduce((a, x) => (!a || x.fecha < a ? x.fecha : a), ''), hasta: r.docs.reduce((a, x) => (x.fecha > a ? x.fecha : a), '')
  };
});

const importarVentas = B.conBoveda('', function (db, data, contexto, x) {
  { const e_ = Base.exigir_(contexto, 'REGISTRAR'); if (e_) return e_; }
  const r = leerVentas_(db, data);
  if (r.error) return Base.errFuente(r.error);
  const empresa = txt_(data.empresa) || r.empresa_sugerida;
  if (Cat.empresas_().indexOf(empresa) === -1) return errorValidacion('empresa', 'Elige de qué empresa son estas ventas.');
  if (r.rut_emisor) {
    db_().prepare('INSERT INTO FIN_EMISORES (huella_rut, empresa) VALUES (?,?) ON CONFLICT(huella_rut) DO UPDATE SET empresa = excluded.empresa')
      .run(I.hmac_('emisor|' + rutNorm_(r.rut_emisor)), empresa);
  }
  const res = guardarFacturas_(db, empresa, r.docs.map((d0) => Object.assign({}, d0, { fuente: { tipo: 'RCV', archivo: txt_(data.nombre).slice(0, 120) } })), 'rcv', x.nombre);
  x.registrar('IMPORTAR_VENTAS_SII', empresa + ': ' + res.nuevas + ' nuevas, ' + res.actualizadas + ' actualizadas de ' + r.docs.length);
  return Object.assign({ empresa, documentos: r.docs.length }, res);
});

/**
 * Hoja FACTURAS de la planilla SIGECO: N° FACTURA, FECHA EMISIÓN, ID CLIENTE,
 * CLIENTE, EMPRESA EMISORA, CONCEPTO, NETO, IVA, TOTAL, FECHA VENCIMIENTO,
 * ESTADO, OBSERVACIONES. El cliente se busca por el ID de la planilla (si la
 * ficha lo tiene) o por nombre exacto. "HomePymes Antiguo" = HomePymes. El
 * ESTADO de la planilla se conserva como dato legado: NO se convierte en un
 * pago (los pagos salen de las aplicaciones).
 */
const importarFacturasPlanilla = B.conBoveda('', function (db, data, contexto, x) {
  { const e_ = Base.exigir_(contexto, 'REGISTRAR'); if (e_) return e_; }
  const r = importarFacturasPlanilla_(db, Array.isArray(data && data.filas) ? data.filas : [], x, txt_(data.archivo));
  if (r._validationError) return r;
  x.registrar('IMPORTAR_FACTURAS_PLANILLA', r.nuevas + ' nuevas');
  return r;
});
function importarFacturasPlanilla_(db, filas, x, archivo) {
  const cab = Array.from(filas[0] || [], (c) => I.normalizar_(c));
  const ix = (...n) => cab.findIndex((h) => n.some((k) => h === k || h.indexOf(k) === 0));
  const C = { folio: ix('N FACTURA'), fecha: ix('FECHA EMISION'), id: ix('ID CLIENTE'), cliente: ix('CLIENTE'), empresa: ix('EMPRESA EMISORA'), concepto: ix('CONCEPTO'), neto: ix('NETO'), iva: ix('IVA'), total: ix('TOTAL'), vence: ix('FECHA VENCIMIENTO'), estado: ix('ESTADO'), obs: ix('OBSERVACIONES') };
  if (C.folio === -1 || C.total === -1 || C.cliente === -1) return Base.errFuente('No encuentro la hoja FACTURAS de la planilla SIGECO.');
  const clientes = I.clientes_(db);
  const porNombre = new Map(clientes.map((c) => [c.n, c]));
  const porCodigo = new Map();
  try { require('./finanzasClientes').fichas_().forEach((f, id) => { if (f.codigo_legado) porCodigo.set(f.codigo_legado.toUpperCase(), clientes.find((c) => c.id === id)); }); } catch (e) { /* sin fichas */ }
  const grupos = {};
  const rechazadas = [];
  let sinCliente = 0;
  filas.slice(1).forEach((f, i) => {
    const c = Array.from(f || [], txt_);
    const folio = String(c[C.folio] || '').replace(/\.0+$/, '');
    if (!/^\d+$/.test(folio)) return;
    if (/anulad/i.test(c[C.estado] || '')) return;
    const emp = Cat.empresa_(c[C.empresa] || 'HomePymes');
    if (!emp) return;
    const cli = (C.id !== -1 && porCodigo.get(String(c[C.id]).toUpperCase())) || porNombre.get(I.normalizar_(c[C.cliente]));
    if (!cli) sinCliente++;
    // I07.3: un monto ilegible (error de fórmula, otra moneda, texto) NO se vuelve cero: la fila se rechaza con su motivo.
    const M = require('./finanzasCargas').monto_;
    const lec = { neto: M(c[C.neto]), iva: C.iva !== -1 ? M(c[C.iva]) : { ok: true, valor: 0 }, total: M(c[C.total]) };
    const malo = ['total', 'neto', 'iva'].find((k) => !lec[k].ok);
    if (malo) { rechazadas.push({ fila: i + 2, folio, motivo: lec[malo].error }); return; }
    if (lec.total.vacio) { rechazadas.push({ fila: i + 2, folio, motivo: 'Sin total.' }); return; }
    const num = (k) => lec[k].valor;
    (grupos[emp] = grupos[emp] || []).push({
      tipo_doc: 33, folio, fecha: I.fechaIso_(c[C.fecha]), razon_social: c[C.cliente], rut: cli ? cli.rut : '', cliente_id: cli ? cli.id : '',
      neto: num('neto'), iva: num('iva'), total: num('total'), concepto: c[C.concepto] || '', vence: C.vence !== -1 ? I.fechaIso_(c[C.vence]) : '',
      estado_legado: C.estado !== -1 ? c[C.estado] : '', fuente: { tipo: 'SIGECO', hoja: 'FACTURAS', fila: i + 2, archivo: archivo || '', valores: c }
    });
  });
  const tot = { nuevas: 0, actualizadas: 0, repetidas: 0 };
  Object.keys(grupos).forEach((emp) => { const r = guardarFacturas_(db, emp, grupos[emp], 'planilla', x.nombre); Object.keys(tot).forEach((k) => { tot[k] += r[k]; }); });
  return Object.assign(tot, { sin_cliente: sinCliente, rechazadas });
}

/** Panel de cobranza: totales, antigüedad y clientes ordenados por lo vencido. */
const cobranza = B.conBoveda('VER_COBRANZA', function (db, data) {
  const empresa = Cat.empresas_({ todos: true }).indexOf(txt_(data && data.empresa)) !== -1 ? data.empresa : '';
  const mapa = cartera_(db, { empresa });
  const hoy = hoy_();
  const mes = hoy.slice(0, 7);
  const lista = [...mapa.values()].filter((n) => n.facturas.length || n.sin_aplicar > 0);
  const T = { por_cobrar: 0, por_cobrar_confirmado: 0, vencido: 0, mas_60: 0, saldo_a_favor: 0, sin_aplicar: 0, sugerido: 0, cobrado_mes: 0, facturado_mes: 0, incobrable: 0, tramos: { al_dia: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0 } };
  lista.forEach((n) => {
    T.por_cobrar += n.por_cobrar; T.por_cobrar_confirmado += n.por_cobrar_confirmado; T.vencido += n.vencido; T.saldo_a_favor += n.saldo_a_favor; T.sin_aplicar += n.sin_aplicar; T.sugerido += n.sugerido; T.incobrable += n.incobrable;
    Object.keys(T.tramos).forEach((k) => { T.tramos[k] += n.tramos[k]; });
    n.recepciones.forEach((p) => { if (p.fecha.slice(0, 7) === mes && p.caja !== false) T.cobrado_mes += p.monto; });
    n.facturas.forEach((f) => { if (f.fecha.slice(0, 7) === mes) T.facturado_mes += f.total; });
  });
  T.mas_60 = T.tramos.d61_90 + T.tramos.d90;
  const sinFacturas = db_().prepare('SELECT COUNT(*) AS n FROM FIN_FACTURAS').get().n === 0;
  return {
    hoy, empresa, sin_facturas: sinFacturas, corte: 'hoy', totales: T, tramos: TRAMOS.map((t) => ({ id: t[0], nombre: t[1], monto: T.tramos[t[0]] })),
    aplicaciones_huerfanas: (mapa.huerfanas || []).length,
    clientes: lista.map((n) => ({
      clave: n.clave, cliente_id: n.cliente_id, cliente: n.cliente, rut: n.rut, en_sigso: !!n.cliente_id,
      facturas_abiertas: n.facturas.filter((f) => f.saldo > 0 && f.estado !== 'INCOBRABLE').length, por_cobrar: n.por_cobrar, por_cobrar_confirmado: n.por_cobrar_confirmado,
      vencido: n.vencido, dias_max: n.dias_max, saldo_a_favor: n.saldo_a_favor, sin_aplicar: n.sin_aplicar, sugerido: n.sugerido, ultimo_pago: n.recepciones.length ? n.recepciones[n.recepciones.length - 1].fecha : ''
    })).sort((a, b) => b.vencido - a.vencido || b.por_cobrar - a.por_cobrar || b.saldo_a_favor - a.saldo_a_favor)
  };
});

/**
 * Bandeja de cobranza por FACTURA (I04.2). Identidad = emisor + tipo + folio.
 * data: { empresa, clave (cliente), estado: abiertas|vencidas|sugeridas|pagadas|incobrables|todas, vence_hasta, busca }
 * Totales con lo CONFIRMADO; lo sugerido va aparte y no reduce la deuda.
 */
const facturas = B.conBoveda('VER_COBRANZA', function (db, data) {
  data = data || {};
  const empresa = Cat.empresas_({ todos: true }).indexOf(txt_(data.empresa)) !== -1 ? data.empresa : '';
  const mapa = cartera_(db, { empresa });
  const estado = txt_(data.estado) || 'abiertas';
  const busca = Base.normalizar_ ? Base.normalizar_(txt_(data.busca)) : txt_(data.busca).toUpperCase();
  const venceHasta = Base.fechaCivil_(data.vence_hasta) || '';
  const filas = [];
  const T = { facturado: 0, saldo_confirmado: 0, vencido_confirmado: 0, propuesto: 0, sin_aplicar: 0, documentos: 0 };
  mapa.forEach((n) => {
    if (data.clave && n.clave !== data.clave) return;
    T.sin_aplicar += n.recepciones.reduce((s0, r) => s0 + Math.max(r.monto - r.aplicado, 0), 0);
    n.facturas.forEach((f) => {
      const ok = estado === 'todas' ? true : estado === 'abiertas' ? f.saldo_confirmado > 0 && f.estado !== 'INCOBRABLE'
        : estado === 'vencidas' ? f.saldo_confirmado > 0 && f.dias_confirmado > 0 && f.estado !== 'INCOBRABLE' : estado === 'sugeridas' ? f.aplicado_sugerido > 0
          : estado === 'pagadas' ? f.situacion === 'Pagada' : estado === 'incobrables' ? f.estado === 'INCOBRABLE' : true;
      if (!ok) return;
      if (venceHasta && f.vence > venceHasta) return;
      if (busca) {
        const h = [f.folio, n.cliente, n.rut, f.razon_social, f.empresa].join(' ');
        if ((Base.normalizar_ ? Base.normalizar_(h) : h.toUpperCase()).indexOf(busca) === -1 && String(n.rut || '').replace(/[^0-9kK]/g, '').indexOf(busca.replace(/[^0-9K]/g, '') || '§') === -1) return;
      }
      if (f.estado !== 'INCOBRABLE') { T.facturado += f.total; T.saldo_confirmado += f.saldo_confirmado; if (f.dias_confirmado > 0) T.vencido_confirmado += f.saldo_confirmado; T.propuesto += f.aplicado_sugerido; }
      T.documentos++;
      filas.push({ id: f.id, clave: n.clave, cliente_id: n.cliente_id, cliente: n.cliente, rut: n.rut, en_sigso: !!n.cliente_id, empresa: f.empresa, tipo_doc: f.tipo_doc, folio: f.folio,
        fecha: f.fecha, vence: f.vence, vence_origen: f.vence_origen || 'parametro', condicion_dias: f.condicion_dias || null, total: f.total, creditos: f.creditos || 0,
        aplicado: f.aplicado_confirmado || 0, sugerido: f.aplicado_sugerido || 0, saldo_confirmado: f.saldo_confirmado, dias: f.dias_confirmado || 0, situacion: f.situacion,
        estado: f.estado, version: f.version, origen: f.origen, aplicaciones: (f.aplicaciones || []).length, conflicto_fuente: f.conflicto_fuente || null });
    });
    // Notas de crédito: documentos propios (no se pagan); se ven con la factura que rebajan.
    if (estado === 'todas') n.notas.forEach((c) => {
      if (busca && (Base.normalizar_([c.folio, n.cliente, n.rut, c.empresa].join(' '))).indexOf(busca) === -1) return;
      T.documentos++;
      filas.push({ id: c.id, clave: n.clave, cliente_id: n.cliente_id, cliente: n.cliente, rut: n.rut, en_sigso: !!n.cliente_id, empresa: c.empresa, tipo_doc: c.tipo_doc, folio: c.folio,
        fecha: c.fecha, vence: '', vence_origen: '', total: c.total, creditos: 0, aplicado: 0, sugerido: 0, saldo_confirmado: 0, dias: 0,
        situacion: c.rebaja ? 'Rebaja F ' + c.rebaja : 'Crédito del cliente', estado: 'VIGENTE', version: c.version, origen: c.origen, aplicaciones: 0, referencia: c.referencia });
    });
  });
  filas.sort((a, b) => (b.dias - a.dias) || (a.vence < b.vence ? -1 : 1));
  return { corte: hoy_(), empresa, estado, totales: T, facturas: filas.slice(0, 500), truncado: filas.length > 500, empresas: Cat.empresas_() };
});

/** La cuenta corriente de un cliente: facturas (con lo aplicado confirmado y sugerido), recepciones y sugerencias. */
const fichaCliente = B.conBoveda('VER_FICHA_CLIENTE', function (db, data) {
  const n = cartera_(db).get(txt_(data && data.clave));
  if (!n) return errorValidacion('clave', 'Ese cliente no tiene facturas ni abonos.');
  return {
    cliente_id: n.cliente_id, cliente: n.cliente, rut: n.rut, en_sigso: !!n.cliente_id, por_cobrar: n.por_cobrar, por_cobrar_confirmado: n.por_cobrar_confirmado, vencido: n.vencido,
    saldo_a_favor: n.saldo_a_favor, sin_aplicar: n.sin_aplicar, sugerido: n.sugerido, facturado: n.facturado, pagado: n.creditos, notas_credito: n.notas_credito,
    facturas: n.facturas.slice().reverse().map((f) => ({ id: f.id, folio: f.folio, tipo_doc: f.tipo_doc, fecha: f.fecha, vence: f.vence, vence_origen: f.vence_origen || 'parametro', empresa: f.empresa, total: f.total,
      pagado: f.pagado || 0, aplicado_confirmado: f.aplicado_confirmado || 0, aplicado_sugerido: f.aplicado_sugerido || 0, nc: (f.nc || 0) + (f.nc_cliente || 0), saldo: f.saldo, saldo_confirmado: f.saldo_confirmado,
      dias: f.dias, situacion: f.situacion, origen: f.origen, concepto: f.concepto, nota: f.nota, estado: f.estado, estado_legado: f.estado_legado || '', version: f.version, aplicaciones: f.aplicaciones || [] })),
    recepciones: n.recepciones.slice().reverse(), sugerencias: n.sugerencias, sugerencias_digest: Base.digest_(n.sugerencias), clave: n.clave,
    pagos: n.pagos.slice().reverse()
  };
});

/** Anular, marcar incobrable o reactivar una factura (con nota obligatoria). Con abonos aplicados no se anula. */
const cambiarEstadoFactura = B.conBoveda('', function (db, data, contexto, x) {
  { const e_ = Base.exigir_(contexto, 'APLICAR'); if (e_) return e_; }
  const estado = txt_(data && data.estado);
  if (['VIGENTE', 'ANULADA', 'INCOBRABLE'].indexOf(estado) === -1) return errorValidacion('estado', 'Estado no válido.');
  const nota = txt_(data && data.nota).slice(0, 300);
  if (estado !== 'VIGENTE' && nota.length < 3) return errorValidacion('nota', 'Escribe el motivo.');
  const d = db_();
  const r = d.prepare('SELECT * FROM FIN_FACTURAS WHERE id = ?').get(txt_(data && data.id));
  if (!r) return errorValidacion('id', 'Esa factura no existe.');
  if (data.expected_version === undefined || data.expected_version === null || data.expected_version === '') return Base.errVersionRequerida_();
  if (Number(data.expected_version) !== Number(r.version || 1)) return Base.errConflicto();
  // T23: «anulada», «incobrable» y «pagada» son hechos distintos: no se anula una factura con abonos aplicados.
  if (estado !== 'VIGENTE' && aplicaciones_({ factura_id: r.id }).length) return errorValidacion('estado', 'La factura tiene abonos aplicados: desaplícalos primero (un abono no desaparece al anular).');
  const datos = I.des_(r.datos);
  datos.nota = nota || datos.nota;
  datos.historial = (datos.historial || []).concat([{ en: Base.ahora_(), por: x.nombre, de: r.estado, a: estado, nota }]).slice(-30);
  d.prepare('UPDATE FIN_FACTURAS SET estado = ?, datos = ?, version = COALESCE(version, 1) + 1, actualizado_en = ?, actualizado_por = ? WHERE id = ?')
    .run(estado, I.cif_(datos), new Date().toISOString(), x.nombre, r.id);
  x.registrar('FACTURA_' + estado, 'N° ' + datos.folio);
  return { ok: true };
});

/** Edita lo que la persona sabe de una factura: vencimiento (o días de la condición), referencia de una nota de crédito, nota. */
const editarFactura = Base.conCapacidad('APLICAR', '', function (db, data, contexto, x) {
  const d = db_();
  const r = d.prepare('SELECT * FROM FIN_FACTURAS WHERE id = ?').get(txt_(data && data.id));
  if (!r) return errorValidacion('id', 'Esa factura no existe.');
  if (data.expected_version === undefined || data.expected_version === null || data.expected_version === '') return errorValidacion('expected_version', 'Falta la versión de la factura que revisaste.');
  if (Number(data.expected_version) !== Number(r.version || 1)) return Base.errConflicto();
  const datos = I.des_(r.datos);
  const antes = { vence: datos.vence, vence_origen: datos.vence_origen, referencia: datos.referencia };
  if (data.vence !== undefined || data.condicion_dias !== undefined) {
    let vence = '', origen = 'parametro', dias = null;
    if (txt_(data.vence)) { vence = Base.fechaCivil_(data.vence); if (!vence) return errorValidacion('vence', 'Fecha no válida.'); origen = 'manual'; }
    else if (txt_(data.condicion_dias)) { dias = Number(data.condicion_dias); if (!(dias >= 0 && dias <= 365)) return errorValidacion('condicion_dias', 'Días entre 0 y 365.'); vence = sumarDias_(r.fecha, dias); origen = 'condicion'; }
    if (vence && vence < r.fecha) return errorValidacion('vence', 'No puede vencer antes de emitirse.');
    datos.vence = vence || sumarDias_(r.fecha, diasVencimiento_()); datos.vence_origen = origen; datos.condicion_dias = dias;
    datos.vence_respaldo = txt_(data.respaldo).slice(0, 200);
  }
  if (data.referencia !== undefined) {
    if (Number(datos.tipo_doc) !== NOTA_CREDITO) return errorValidacion('referencia', 'Solo una nota de crédito tiene factura de referencia.');
    const ref = txt_(data.referencia);
    if (ref && !d.prepare('SELECT 1 FROM FIN_FACTURAS WHERE huella = ?').get(huellaFactura_(r.empresa, 33, ref))) return errorValidacion('referencia', 'No existe la factura N° ' + ref + ' de ' + r.empresa + '.');
    datos.referencia = ref;
  }
  if (data.nota !== undefined) datos.nota = txt_(data.nota).slice(0, 300);
  datos.historial = (datos.historial || []).concat([{ en: Base.ahora_(), por: x.nombre, accion: 'EDITAR', antes, despues: { vence: datos.vence, vence_origen: datos.vence_origen, referencia: datos.referencia }, respaldo: datos.vence_respaldo || '' }]).slice(-30);
  d.prepare('UPDATE FIN_FACTURAS SET datos = ?, version = COALESCE(version, 1) + 1, actualizado_en = ?, actualizado_por = ? WHERE id = ?').run(I.cif_(datos), Base.ahora_(), x.nombre, r.id);
  x.registrar('FACTURA_EDITAR', 'N° ' + datos.folio);
  return { ok: true, version: (r.version || 1) + 1 };
});

// ---------------------------------------------------------------- acciones: aplicaciones (FIN-22; corrección v2 I04)

function cerrado_(fecha) { try { return require('./finanzasCierre').mesCerrado_(String(fecha || '').slice(0, 7)); } catch (e) { return false; } }

/**
 * Aplica una recepción a una o varias facturas. Todo o nada: si una no
 * calza, no se aplica ninguna y el abono queda como estaba.
 * data: { recepcion_ref, aplicaciones:[{factura_id, monto, expected_version?}], fecha_aplicacion }
 * La aplicación NO cambia el banco, la fecha del abono ni los ingresos.
 */
function aplicar_(db, data, x, opciones) {
  opciones = opciones || {};
  const H = require('./finanzasHechos');
  let ref = txt_(data.recepcion_ref);
  const vigentes = H.resolverRef_(ref);
  if (vigentes.length === 1) ref = vigentes[0]; // el registro ya se concilió: se aplica sobre su parte del banco
  const rec = recepciones_().find((r) => r.ref === ref);
  if (!rec) {
    const enConflicto = H.conflictos_({}).some((c) => c.hechos.some((h) => h.ref === ref));
    return errorValidacion('recepcion_ref', enConflicto ? 'Este cobro podría ser el mismo que un movimiento del banco ya clasificado: vincúlalos en Conciliación (o marca que son distintos) antes de aplicarlo.'
      : 'Ese abono no existe o no está confirmado como ingreso con cliente (los fondos de clientes no pagan facturas).');
  }
  const items = (Array.isArray(data.aplicaciones) ? data.aplicaciones : []).slice(0, 50);
  if (!items.length) return errorValidacion('aplicaciones', 'Elige al menos una factura.');
  const fecha = Base.fechaCivil_(data.fecha_aplicacion) || Base.hoy_();
  if (cerrado_(fecha)) return Base.errPeriodoCerrado(fecha.slice(0, 7));
  const cart = cartera_(db);
  const todas = new Map();
  cart.forEach((n) => n.facturas.forEach((f) => todas.set(f.id, Object.assign({ _cliente: n.cliente_id }, f))));
  const usado = refsEquivalentes_(ref).reduce((s, r) => s + aplicaciones_({ recepcion_ref: r }).reduce((t, a) => t + a.monto, 0), 0);
  let libre = rec.monto - usado;
  const rels = relaciones_();
  const plan = [];
  const porFactura = {};
  for (const it of items) {
    const m = Base.montoClp_(it.monto);
    if (!m.ok || !(m.valor > 0)) return errorValidacion('aplicaciones', 'Cada aplicación necesita un monto mayor que cero.');
    const fid = txt_(it.factura_id);
    const filaF = db_().prepare('SELECT * FROM FIN_FACTURAS WHERE id = ?').get(fid);
    if (!filaF) return errorValidacion('aplicaciones', 'Esa factura no existe.');
    // I11.2: aplicar AGREGA una aplicación: lo protegen el saldo de la factura y lo disponible del cobro (misma
    // transacción). La versión, si viene, se compara; «aceptar sugeridas» además exige el resumen de lo que se vio.
    if (it.expected_version !== undefined && it.expected_version !== null && Number(it.expected_version) !== Number(filaF.version || 1)) return Base.errConflicto('La factura N° ' + I.des_(filaF.datos).folio + ' cambió mientras la revisabas. Vuelve a abrirla.');
    const f = todas.get(fid);
    if (!f) return errorValidacion('aplicaciones', 'La factura N° ' + I.des_(filaF.datos).folio + ' está anulada.');
    if (Number(f.tipo_doc) === NOTA_CREDITO) return errorValidacion('aplicaciones', 'Una nota de crédito no se paga con un abono.');
    if (f.estado === 'INCOBRABLE') return errorValidacion('aplicaciones', 'La factura N° ' + f.folio + ' está marcada incobrable: reactívala primero.');
    const motivo = permitido_(rec, Object.assign({}, f, { cliente_id: f._cliente }), rels);
    if (motivo) return errorValidacion('aplicaciones', 'Factura N° ' + f.folio + ': ' + motivo);
    porFactura[fid] = (porFactura[fid] || 0) + m.valor;
    if (porFactura[fid] > f.saldo_confirmado) return errorValidacion('aplicaciones', 'A la factura N° ' + f.folio + ' le faltan ' + Base.plata_(f.saldo_confirmado) + ': no se le pueden aplicar ' + Base.plata_(porFactura[fid]) + '.');
    libre -= m.valor;
    if (libre < 0) return errorValidacion('aplicaciones', 'El abono es de ' + Base.plata_(rec.monto) + ' y ya tiene ' + Base.plata_(usado) + ' aplicado: no alcanza.');
    plan.push({ f, monto: m.valor });
  }
  const ids = [];
  const ins = db_().prepare('INSERT INTO FIN_APLICACIONES (id, factura_id, recepcion_ref, estado, fecha_aplicacion, version, datos, clave_origen, creado_en, creado_por) VALUES (?,?,?,?,?,?,?,?,?,?)');
  for (const p of plan) {
    const id = Base.id_();
    try {
      ins.run(id, p.f.id, ref, 'ACTIVA', fecha, 1, I.cif_({ monto: p.monto, cliente_id: rec.cliente_id, folio: p.f.folio, empresa: p.f.empresa, tipo_doc: p.f.tipo_doc, fecha_recepcion: rec.fecha, origen: opciones.origen || null }),
        opciones.clave_origen ? opciones.clave_origen + '|' + p.f.id : null, Base.ahora_(), x.nombre);
    } catch (e) { if (/UNIQUE/.test(e.message)) return { repetida: true, aplicaciones: [] }; throw e; }
    ids.push(id);
  }
  return { aplicaciones: ids, aplicado: plan.reduce((s, p) => s + p.monto, 0), sin_aplicar: libre, recepcion_ref: ref };
}

/** Cómo quedaron, según el servidor, las facturas y los cobros tocados (la pantalla no resta por su cuenta). */
function estadoDespues_(db, facturaIds, refs) {
  const cart = cartera_(db);
  const facturas = [], cobros = [];
  cart.forEach((n) => {
    n.facturas.forEach((f) => { if (facturaIds.indexOf(f.id) !== -1) facturas.push({ id: f.id, empresa: f.empresa, tipo_doc: f.tipo_doc, folio: f.folio, saldo_confirmado: f.saldo_confirmado, situacion: f.situacion, version: f.version }); });
    n.recepciones.forEach((r) => { if (refs.some((ref) => refsEquivalentes_(ref).indexOf(r.ref) !== -1)) cobros.push({ ref: r.ref, fecha: r.fecha, monto: r.monto, aplicado: r.aplicado, disponible: r.monto - r.aplicado }); });
  });
  return { facturas, cobros };
}

/**
 * Aplicar (I04.3): uno o varios cobros a una o varias facturas, en UN grupo atómico.
 * data: { grupos:[{recepcion_ref, aplicaciones:[{factura_id, monto, expected_version}]}] | recepcion_ref + aplicaciones,
 *         fecha_aplicacion, idempotency_key }
 * Reintento con la misma clave devuelve el mismo resultado; contenido distinto con esa clave → conflicto.
 */
const aplicar = Base.conCapacidad('APLICAR', '', function (db, data, contexto, x) {
  const grupos = Array.isArray(data.grupos) && data.grupos.length ? data.grupos.slice(0, 20) : [{ recepcion_ref: data.recepcion_ref, aplicaciones: data.aplicaciones }];
  return Base.idempotente_(contexto, 'aplicar', data.idempotency_key, { g: grupos, f: data.fecha_aplicacion }, () => Base.transaccion_(() => {
    let ids = [], monto = 0;
    const refs = [], fids = [];
    for (const g of grupos) {
      const r = aplicar_(db, { recepcion_ref: g.recepcion_ref, aplicaciones: g.aplicaciones, fecha_aplicacion: data.fecha_aplicacion }, x);
      if (r._validationError || r.codigo) return r;
      ids = ids.concat(r.aplicaciones); monto += r.aplicado || 0;
      refs.push(r.recepcion_ref || g.recepcion_ref);
      (g.aplicaciones || []).forEach((a) => fids.push(txt_(a.factura_id)));
    }
    if (ids.length) x.registrar('APLICAR_ABONO', grupos.length + ' cobro(s) → ' + new Set(fids).size + ' factura(s) · ' + Base.plata_(monto));
    return Object.assign({ aplicaciones: ids, aplicado: monto }, estadoDespues_(db, fids, refs));
  }));
});

/**
 * Desaplica (I04.4): exige motivo y versión; respeta el cierre del mes de la aplicación. El cobro y su
 * evidencia bancaria no se tocan: vuelve a estar disponible con su fecha original y la factura recupera saldo.
 */
const desaplicar = Base.conCapacidad('APLICAR', '', function (db, data, contexto, x) {
  const motivo = txt_(data && data.motivo);
  if (motivo.length < 3) return errorValidacion('motivo', 'Escribe por qué se desaplica.');
  const r = db_().prepare("SELECT * FROM FIN_APLICACIONES WHERE id = ? AND estado = 'ACTIVA'").get(txt_(data.id));
  if (!r) return errorValidacion('id', 'Esa aplicación no existe o ya está deshecha.');
  if (data.expected_version === undefined || data.expected_version === null || data.expected_version === '') return errorValidacion('expected_version', 'Falta la versión de la aplicación que revisaste.');
  if (Number(data.expected_version) !== Number(r.version)) return Base.errConflicto('La aplicación cambió mientras la revisabas.');
  if (cerrado_(r.fecha_aplicacion)) return Base.errPeriodoCerrado(r.fecha_aplicacion.slice(0, 7));
  return Base.transaccion_(() => {
    const datos = Object.assign(I.des_(r.datos), { motivo_deshacer: motivo.slice(0, 300) });
    db_().prepare("UPDATE FIN_APLICACIONES SET estado = 'DESHECHA', datos = ?, version = version + 1, deshecho_en = ?, deshecho_por = ? WHERE id = ?").run(I.cif_(datos), Base.ahora_(), x.nombre, r.id);
    x.registrar('DESAPLICAR_ABONO', 'N° ' + datos.folio + ' · ' + Base.plata_(datos.monto) + ': ' + motivo.slice(0, 80));
    return Object.assign({ ok: true, monto: datos.monto }, estadoDespues_(db, [r.factura_id], [r.recepcion_ref]));
  });
});

/** Vuelve explícitas las aplicaciones FIFO sugeridas de un cliente (las que la persona revisó en pantalla). */
const aceptarSugeridas = Base.conCapacidad('APLICAR', '', function (db, data, contexto, x) {
  const n = cartera_(db).get(txt_(data && data.clave));
  if (!n) return errorValidacion('clave', 'Ese cliente no tiene facturas ni abonos.');
  // Solo lo que se vio: si la sugerencia cambió desde que se mostró, hay que revisar de nuevo.
  if (data.digest && Base.digest_(n.sugerencias) !== data.digest) return Base.errConflicto('Las sugerencias cambiaron desde que las viste. Revísalas de nuevo.');
  return Base.transaccion_(() => {
    const porRec = {};
    n.sugerencias.forEach((s) => { (porRec[s.recepcion_ref] = porRec[s.recepcion_ref] || []).push({ factura_id: s.factura_id, monto: s.monto }); });
    let hechos = 0, monto = 0;
    for (const ref of Object.keys(porRec)) {
      const r = aplicar_(db, { recepcion_ref: ref, aplicaciones: porRec[ref], fecha_aplicacion: data.fecha_aplicacion }, x, { porDigest: true });
      if (r._validationError || r.codigo) return r;
      hechos += r.aplicaciones.length; monto += r.aplicado;
    }
    if (hechos) x.registrar('APLICAR_SUGERIDAS', n.cliente + ': ' + hechos + ' · ' + Base.plata_(monto));
    return { hechos, monto };
  });
});

/**
 * Cobros elegibles para un conjunto de facturas (I04.3): ingresos propios con cliente y con algo
 * disponible (monto − aplicaciones confirmadas), que se puedan aplicar a TODAS las facturas elegidas
 * (mismo cliente y emisor, o una relación de terceros vigente que lo habilite, a la vista).
 * Los fondos de clientes nunca aparecen: no pagan facturas.
 */
const cobrosElegibles = B.conBoveda('VER_COBRANZA', function (db, data) {
  const ids = (Array.isArray(data && data.factura_ids) ? data.factura_ids : []).map(txt_).slice(0, 50);
  if (!ids.length) return errorValidacion('factura_ids', 'Elige al menos una factura.');
  const cart = cartera_(db);
  const fs_ = [], recs = [];
  cart.forEach((n) => {
    n.facturas.forEach((f) => { if (ids.indexOf(f.id) !== -1) fs_.push(Object.assign({}, f, { cliente_id: n.cliente_id, cliente: n.cliente })); });
    n.recepciones.forEach((r) => { if (r.monto - r.aplicado > 0) recs.push(Object.assign({}, r, { cliente: n.cliente })); });
  });
  if (fs_.length !== ids.length) return errorValidacion('factura_ids', 'Alguna factura ya no existe o está anulada.');
  const rels = relaciones_();
  const cobros = [];
  recs.forEach((r) => {
    const via = [];
    for (const f of fs_) { const p = permitidoDetalle_(r, f, rels); if (p.motivo) return; p.via.forEach((v) => { if (via.indexOf(v) === -1) via.push(v); }); }
    cobros.push({ ref: r.ref, fecha: r.fecha, fecha_banco: r.fecha_banco, medio: r.medio || (r.fuente === 'BANCO' ? 'TRANSFERENCIA' : ''), cuenta: r.banco ? r.banco + ' ···' + r.ultimos4 : (r.medio || 'Registro'),
      origen: r.fuente === 'BANCO' ? 'Cartola' : 'Registro', glosa: r.glosa, cliente_id: r.cliente_id, cliente: r.cliente, empresa: r.empresa, monto: r.monto, aplicado: r.aplicado,
      disponible: r.monto - r.aplicado, sugerido: r.sugerido, terceros: via });
  });
  cobros.sort((a, b) => (a.terceros.length - b.terceros.length) || (a.fecha < b.fecha ? -1 : 1));
  return { corte: hoy_(), facturas: fs_.map((f) => ({ id: f.id, empresa: f.empresa, tipo_doc: f.tipo_doc, folio: f.folio, cliente: f.cliente, cliente_id: f.cliente_id, fecha: f.fecha, vence: f.vence,
    total: f.total, creditos: f.creditos || 0, aplicado: f.aplicado_confirmado, saldo_confirmado: f.saldo_confirmado, version: f.version })), cobros };
});

/**
 * Relación de cobro por terceros (FIN-24; I04.4): permite aplicar abonos de un
 * cliente a facturas de otro, o abonos que entraron a una empresa a facturas
 * de otra. Registra pagador, beneficiario, emisor (alcance), vigencia, quién
 * autoriza y respaldo. No relaja nada más.
 * tipo CLIENTE: { pagador_id, beneficiario_id, emisor? } · tipo EMPRESA: { recibe, emite }
 * Comunes: { motivo (respaldo), autorizado_por, desde?, hasta? }
 */
const guardarRelacion = Base.conCapacidad('APLICAR', '', function (db, data, contexto, x) {
  const tipo = txt_(data && data.tipo).toUpperCase();
  const motivo = txt_(data.motivo).slice(0, 300);
  if (motivo.length < 5) return errorValidacion('motivo', 'Escribe el respaldo de esta relación (contrato, instrucción…).');
  const desde = txt_(data.desde) ? Base.fechaCivil_(data.desde) : '', hasta = txt_(data.hasta) ? Base.fechaCivil_(data.hasta) : '';
  if ((txt_(data.desde) && !desde) || (txt_(data.hasta) && !hasta) || (desde && hasta && hasta < desde)) return errorValidacion('desde', 'Revisa la vigencia (desde ≤ hasta).');
  const comunes = { motivo, autorizado_por: txt_(data.autorizado_por).slice(0, 120) || x.nombre, desde, hasta };
  let datos;
  if (tipo === 'CLIENTE') {
    const cl = I.clientes_(db);
    const a = cl.find((c) => c.id === txt_(data.pagador_id)), b = cl.find((c) => c.id === txt_(data.beneficiario_id));
    if (!a || !b || a.id === b.id) return errorValidacion('pagador_id', 'Elige dos clientes distintos.');
    const emisor = txt_(data.emisor) ? Cat.empresa_(data.emisor) : '';
    if (txt_(data.emisor) && !emisor) return errorValidacion('emisor', 'Empresa emisora no válida.');
    datos = Object.assign({ pagador_id: a.id, pagador: a.nombre, beneficiario_id: b.id, beneficiario: b.nombre, emisor }, comunes);
  } else if (tipo === 'EMPRESA') {
    const a = Cat.empresa_(data.recibe), b = Cat.empresa_(data.emite);
    if (!a || !b || a === b) return errorValidacion('recibe', 'Elige dos empresas distintas.');
    datos = Object.assign({ recibe: a, emite: b }, comunes);
  } else return errorValidacion('tipo', 'Tipo no válido.');
  const id = Base.id_();
  db_().prepare("INSERT INTO FIN_RELACIONES_COBRO (id, tipo, estado, datos, creado_en, creado_por) VALUES (?,?,'ACTIVA',?,?,?)").run(id, tipo, I.cif_(datos), Base.ahora_(), x.nombre);
  x.registrar('RELACION_COBRO', tipo + ': ' + motivo.slice(0, 80));
  return { id };
});
/** Termina una relación de terceros (con motivo). Las aplicaciones ya hechas se conservan. */
const anularRelacion = Base.conCapacidad('APLICAR', '', function (db, data, contexto, x) {
  const motivo = txt_(data && data.motivo);
  if (motivo.length < 3) return errorValidacion('motivo', 'Escribe por qué se termina la relación.');
  const r = db_().prepare("SELECT * FROM FIN_RELACIONES_COBRO WHERE id = ? AND estado = 'ACTIVA'").get(txt_(data.id));
  if (!r) return errorValidacion('id', 'Esa relación no existe o ya terminó.');
  const datos = Object.assign(I.des_(r.datos), { anulada: { por: x.nombre, en: Base.ahora_(), motivo: motivo.slice(0, 300) } });
  db_().prepare("UPDATE FIN_RELACIONES_COBRO SET estado = 'ANULADA', datos = ? WHERE id = ?").run(I.cif_(datos), r.id);
  x.registrar('RELACION_COBRO_FIN', motivo.slice(0, 80));
  return { ok: true };
});
const relaciones = B.conBoveda('', function () { return { relaciones: relaciones_() }; });

function reiniciar_() { preparada_ = null; }

module.exports = {
  revisarVentas, importarVentas, importarFacturasPlanilla, cobranza, fichaCliente, cambiarEstadoFactura, editarFactura,
  aplicar, desaplicar, aceptarSugeridas, guardarRelacion, anularRelacion, relaciones, facturas, cobrosElegibles,
  facturasPorMonto_, cartera_, rutNorm_, recepciones_, aplicaciones_, recepcionAplicada_, facturasDeCliente_, aplicar_, importarFacturasPlanilla_, guardarFacturas_, huellaFactura_, reiniciar_
};
