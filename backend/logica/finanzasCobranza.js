'use strict';

/**
 * finanzasCobranza.js — Finanzas, Etapa 3: clientes, facturas y cobranza
 * (2026-10-06).
 *
 * En la planilla SIGECO la cobranza dependía de un paso a mano ("facturar
 * abonos" → crear el PAGO): como casi nunca se hacía, la cartera vencida
 * mostraba $5,15 M de $5,43 M que en realidad ya estaban pagados. Aquí no
 * hay ese paso:
 *
 *  - FACTURAS: se suben desde el Registro de Ventas del SII (CSV de
 *    "Descargar detalles", el mismo que ya lee Control interno), con el RUT
 *    de cada cliente; o se traen de la hoja FACTURAS de la planilla SIGECO.
 *    El SII manda: si una factura de la planilla llega después en el RCV,
 *    se reemplazan sus datos.
 *  - PAGOS: los movimientos del banco confirmados como «Ingreso de la
 *    empresa» con su cliente (Etapa 2), más las notas de crédito.
 *  - CRUCE: los pagos de cada cliente cubren sus facturas de la más antigua
 *    a la más nueva (FIFO). Lo que sobra es SALDO A FAVOR del cliente y se
 *    aplica solo a la próxima factura. La plata que el cliente manda para
 *    sus imposiciones (FONDO_RECIBIDO) no paga facturas: es suya.
 *  - CARTERA: lo que falta de cada factura, con días de atraso desde su
 *    vencimiento (30 días, como en SIGECO). Anulada e incobrable salen de
 *    la cartera a mano, con nota.
 *
 * Todo dentro de la bóveda y cifrado (misma llave y huellas que Bancos).
 */

const crypto = require('node:crypto');
const B = require('./finanzasBoveda');
const FB = require('./finanzasBancos');
const SII = require('./controlInternoSII');
const { errorValidacion, errorForbidden } = require('./errores');

const I = FB.interno;
const DIAS_VENCIMIENTO = 30;
const TRAMOS = [['al_dia', 'Al día'], ['d1_30', '1–30 días'], ['d31_60', '31–60 días'], ['d61_90', '61–90 días'], ['d90', 'Más de 90 días']];
const NOTA_CREDITO = 61;

// ---------------------------------------------------------------- esquema

let preparada_ = null;
function db_() {
  const d = I.db_();
  if (preparada_ === d) return d;
  [
    `CREATE TABLE IF NOT EXISTS FIN_FACTURAS (
       id TEXT PRIMARY KEY, empresa TEXT NOT NULL, fecha TEXT NOT NULL, periodo TEXT NOT NULL,
       huella TEXT NOT NULL UNIQUE, estado TEXT NOT NULL, origen TEXT NOT NULL, datos TEXT NOT NULL,
       actualizado_en TEXT, actualizado_por TEXT)`,
    'CREATE INDEX IF NOT EXISTS ix_fin_fact ON FIN_FACTURAS (empresa, fecha)',
    `CREATE TABLE IF NOT EXISTS FIN_EMISORES (huella_rut TEXT PRIMARY KEY, empresa TEXT NOT NULL)`
  ].forEach((sql) => d.exec(sql));
  preparada_ = d;
  return d;
}

// ---------------------------------------------------------------- utilidades

function hoy_() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
function sumarDias_(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dias_(desde, hasta) { return Math.round((Date.parse(hasta + 'T12:00:00Z') - Date.parse(desde + 'T12:00:00Z')) / 864e5); }
function rutNorm_(r) { const s = String(r || '').replace(/[^0-9kK]/g, '').toUpperCase(); return s.length >= 2 ? s.slice(0, -1).replace(/^0+/, '') + '-' + s.slice(-1) : ''; }
function huellaFactura_(empresa, tipo, folio) { return I.hmac_(['factura', empresa, Number(tipo) || 33, String(folio).trim()].join('|')); }
const txt_ = (v) => String(v == null ? '' : v).trim();
function tramo_(dias) { return dias <= 0 ? 'al_dia' : dias <= 30 ? 'd1_30' : dias <= 60 ? 'd31_60' : dias <= 90 ? 'd61_90' : 'd90'; }

function clientePorRut_(clientes) {
  const m = new Map();
  clientes.forEach((c) => { const r = rutNorm_(c.rut); if (r) m.set(r, c); });
  return m;
}
function facturaPublica_(r) {
  const d = I.des_(r.datos);
  return Object.assign({ id: r.id, empresa: r.empresa, fecha: r.fecha, estado: r.estado, origen: r.origen, actualizado_por: r.actualizado_por }, d);
}

// ---------------------------------------------------------------- cartera (el corazón)

/**
 * Cruza facturas y pagos por cliente (FIFO). Devuelve un mapa clave →
 * { clave, cliente_id, cliente, rut, facturas:[...con saldo, dias, tramo], pagos:[...], saldo_a_favor, ... }.
 * La clave es el cliente de SIGSO; si la factura trae un RUT que no está en
 * SIGSO, "rut:<RUT>" (no puede recibir pagos hasta que se cree el cliente).
 */
function cartera_(db, opciones) {
  opciones = opciones || {};
  const hoy = opciones.hoy || hoy_();
  const d = db_();
  const clientes = I.clientes_(db);
  const porId = new Map(clientes.map((c) => [c.id, c]));
  const porRut = clientePorRut_(clientes);
  const mapa = new Map();
  const nodo = (clave, base) => {
    if (!mapa.has(clave)) mapa.set(clave, Object.assign({ clave, cliente_id: '', cliente: '', rut: '', facturas: [], pagos: [], notas_credito: 0, creditos: 0 }, base));
    return mapa.get(clave);
  };
  d.prepare("SELECT * FROM FIN_FACTURAS WHERE estado != 'ANULADA' ORDER BY fecha, rowid").all().forEach((r) => {
    const f = facturaPublica_(r);
    if (opciones.empresa && f.empresa !== opciones.empresa) return;
    let cli = f.cliente_id && porId.get(f.cliente_id);
    if (!cli && f.rut) cli = porRut.get(rutNorm_(f.rut));
    const n = cli ? nodo(cli.id, { cliente_id: cli.id, cliente: cli.nombre, rut: cli.rut || f.rut })
      : nodo('rut:' + (rutNorm_(f.rut) || f.razon_social || f.id), { cliente: f.razon_social || 'Sin cliente', rut: f.rut });
    if (Number(f.tipo_doc) === NOTA_CREDITO) { n.notas_credito += Math.abs(f.total); return; }
    n.facturas.push(f);
  });
  d.prepare("SELECT fecha, datos FROM FIN_MOVIMIENTOS WHERE estado = 'CONFIRMADO' ORDER BY fecha, orden").all().forEach((r) => {
    const m = I.des_(r.datos), c = m.clasif;
    if (!c || c.tipo !== 'INGRESO' || !c.cliente_id || !(m.abono > 0)) return;
    const cli = porId.get(c.cliente_id);
    const n = nodo(c.cliente_id, { cliente_id: c.cliente_id, cliente: cli ? cli.nombre : c.cliente, rut: cli ? cli.rut : '' });
    n.pagos.push({ fecha: r.fecha, monto: m.abono, glosa: m.glosa, nota: c.nota || '' });
  });
  mapa.forEach((n) => {
    n.creditos = n.pagos.reduce((s, p) => s + p.monto, 0) + n.notas_credito;
    let resto = n.creditos;
    n.por_cobrar = 0; n.vencido = 0; n.dias_max = 0; n.facturado = 0;
    n.tramos = { al_dia: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0 };
    n.facturas.forEach((f) => {
      f.vence = f.vence || sumarDias_(f.fecha, DIAS_VENCIMIENTO);
      if (f.estado === 'INCOBRABLE') { f.saldo = f.total; f.situacion = 'Incobrable'; f.dias = 0; return; }
      n.facturado += f.total;
      const aplicado = Math.min(resto, f.total); resto -= aplicado;
      f.pagado = aplicado; f.saldo = f.total - aplicado;
      f.dias = f.saldo > 0 ? Math.max(0, dias_(f.vence, hoy)) : 0;
      f.situacion = f.saldo === 0 ? 'Pagada' : aplicado > 0 ? 'Pago parcial' : f.dias > 0 ? 'Vencida' : 'Por vencer';
      if (f.saldo > 0) {
        n.por_cobrar += f.saldo;
        n.tramos[tramo_(f.dias)] += f.saldo;
        if (f.dias > 0) { n.vencido += f.saldo; n.dias_max = Math.max(n.dias_max, f.dias); }
      }
    });
    n.saldo_a_favor = resto;
    n.incobrable = n.facturas.filter((f) => f.estado === 'INCOBRABLE').reduce((s, f) => s + f.total, 0);
  });
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

// ---------------------------------------------------------------- guardar facturas

function guardarFacturas_(db, empresa, documentos, origen, quien) {
  const d = db_();
  const ahora = new Date().toISOString();
  let nuevas = 0, actualizadas = 0, repetidas = 0;
  d.exec('BEGIN');
  try {
    documentos.forEach((doc) => {
      const h = huellaFactura_(empresa, doc.tipo_doc, doc.folio);
      const previa = d.prepare('SELECT id, origen, estado, datos FROM FIN_FACTURAS WHERE huella = ?').get(h);
      const fecha = doc.fecha || hoy_();
      const datos = {
        tipo_doc: Number(doc.tipo_doc) || 33, folio: String(doc.folio), rut: doc.rut || '', razon_social: doc.razon_social || '',
        cliente_id: doc.cliente_id || '', exento: doc.exento || 0, neto: doc.neto || 0, iva: doc.iva || 0,
        total: doc.total || ((doc.neto || 0) + (doc.iva || 0) + (doc.exento || 0)), vence: sumarDias_(fecha, DIAS_VENCIMIENTO),
        concepto: doc.concepto || '', nota: ''
      };
      if (previa) {
        // El SII manda sobre la planilla; lo que ya vino del SII no se toca (se conserva la nota y el estado manual).
        if (previa.origen === 'planilla' && origen === 'rcv') {
          const vieja = I.des_(previa.datos);
          datos.nota = vieja.nota || ''; datos.cliente_id = datos.cliente_id || vieja.cliente_id || '';
          d.prepare('UPDATE FIN_FACTURAS SET fecha = ?, periodo = ?, origen = ?, datos = ?, actualizado_en = ?, actualizado_por = ? WHERE id = ?')
            .run(fecha, fecha.slice(0, 7), origen, I.cif_(datos), ahora, quien, previa.id);
          actualizadas++;
        } else repetidas++;
        return;
      }
      d.prepare('INSERT INTO FIN_FACTURAS (id, empresa, fecha, periodo, huella, estado, origen, datos, actualizado_en, actualizado_por) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(crypto.randomUUID(), empresa, fecha, fecha.slice(0, 7), h, 'VIGENTE', origen, I.cif_(datos), ahora, quien);
      nuevas++;
    });
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
  return { nuevas, actualizadas, repetidas };
}

function empresaDeEmisor_(rut) {
  if (!rut) return '';
  const r = db_().prepare('SELECT empresa FROM FIN_EMISORES WHERE huella_rut = ?').get(I.hmac_('emisor|' + rutNorm_(rut)));
  return r ? r.empresa : '';
}

/** Lee el CSV del RCV de ventas y dice qué haría, sin guardar. */
function leerVentas_(db, data) {
  const leido = SII.leer_(String((data && data.texto) || ''), String((data && data.nombre) || ''));
  if (!leido || leido.fuente !== 'rcv' || leido.nivel !== 'detalle') return { error: 'No es el detalle del Registro de Ventas del SII. Descárgalo desde el RCV › Ventas › «Descargar detalles» (CSV).' };
  if (leido.tipo !== 'ventas') return { error: 'Ese archivo es de COMPRAS. Para la cobranza se necesita el de VENTAS.' };
  const porRut = clientePorRut_(I.clientes_(db));
  const docs = leido.documentos.map((x) => {
    const c = porRut.get(rutNorm_(x.rut));
    return Object.assign({}, x, { cliente_id: c ? c.id : '', cliente: c ? c.nombre : '' });
  });
  return { leido, docs, rut_emisor: leido.rut || '', empresa_sugerida: empresaDeEmisor_(leido.rut) };
}

// ---------------------------------------------------------------- acciones

const revisarVentas = B.conBoveda('', function (db, data) {
  const r = leerVentas_(db, data);
  if (r.error) return errorValidacion('archivo', r.error);
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
  if (I.soloEscritura_(contexto)) return errorForbidden('Tu acceso a Finanzas es de solo lectura.');
  const r = leerVentas_(db, data);
  if (r.error) return errorValidacion('archivo', r.error);
  const empresa = txt_(data.empresa) || r.empresa_sugerida;
  if (FB.EMPRESAS.indexOf(empresa) === -1) return errorValidacion('empresa', 'Elige de qué empresa son estas ventas.');
  if (r.rut_emisor) {
    db_().prepare('INSERT INTO FIN_EMISORES (huella_rut, empresa) VALUES (?,?) ON CONFLICT(huella_rut) DO UPDATE SET empresa = excluded.empresa')
      .run(I.hmac_('emisor|' + rutNorm_(r.rut_emisor)), empresa);
  }
  const res = guardarFacturas_(db, empresa, r.docs, 'rcv', x.nombre);
  x.registrar('IMPORTAR_VENTAS_SII', empresa + ': ' + res.nuevas + ' nuevas, ' + res.actualizadas + ' actualizadas de ' + r.docs.length);
  return Object.assign({ empresa, documentos: r.docs.length }, res);
});

/**
 * Hoja FACTURAS de la planilla SIGECO (julio-agosto 2026): N° FACTURA, FECHA
 * EMISIÓN, ID CLIENTE, CLIENTE, EMPRESA EMISORA, CONCEPTO, NETO, IVA, TOTAL.
 * El cliente se busca por nombre en SIGSO. "HomePymes Antiguo" = HomePymes.
 */
const importarFacturasPlanilla = B.conBoveda('', function (db, data, contexto, x) {
  if (I.soloEscritura_(contexto)) return errorForbidden('Tu acceso a Finanzas es de solo lectura.');
  const filas = Array.isArray(data && data.filas) ? data.filas : [];
  const cab = Array.from(filas[0] || [], (c) => I.normalizar_(c));
  const ix = (...n) => cab.findIndex((h) => n.some((k) => h === k || h.indexOf(k) === 0));
  const C = { folio: ix('N FACTURA'), fecha: ix('FECHA EMISION'), cliente: ix('CLIENTE'), empresa: ix('EMPRESA EMISORA'), concepto: ix('CONCEPTO'), neto: ix('NETO'), iva: ix('IVA'), total: ix('TOTAL'), estado: ix('ESTADO') };
  if (C.folio === -1 || C.total === -1 || C.cliente === -1) return errorValidacion('archivo', 'No encuentro la hoja FACTURAS de la planilla SIGECO.');
  const clientes = I.clientes_(db);
  const porNombre = new Map(clientes.map((c) => [c.n, c]));
  const grupos = {};
  let sinCliente = 0;
  filas.slice(1).forEach((f) => {
    const c = Array.from(f || [], txt_);
    const folio = String(c[C.folio] || '').replace(/\.0+$/, '');
    if (!/^\d+$/.test(folio)) return;
    if (/anulad/i.test(c[C.estado] || '')) return;
    let emp = c[C.empresa] || 'HomePymes'; if (/^HomePymes/i.test(emp)) emp = 'HomePymes';
    if (FB.EMPRESAS.indexOf(emp) === -1) return;
    const cli = porNombre.get(I.normalizar_(c[C.cliente]));
    if (!cli) sinCliente++;
    const num = (v) => { const n = FB.monto_(v); return isNaN(n) ? 0 : n; };
    (grupos[emp] = grupos[emp] || []).push({
      tipo_doc: 33, folio, fecha: I.fechaIso_(c[C.fecha]), razon_social: c[C.cliente], rut: cli ? cli.rut : '', cliente_id: cli ? cli.id : '',
      neto: num(c[C.neto]), iva: num(c[C.iva]), total: num(c[C.total]), concepto: c[C.concepto] || ''
    });
  });
  const tot = { nuevas: 0, actualizadas: 0, repetidas: 0 };
  Object.keys(grupos).forEach((emp) => { const r = guardarFacturas_(db, emp, grupos[emp], 'planilla', x.nombre); Object.keys(tot).forEach((k) => { tot[k] += r[k]; }); });
  x.registrar('IMPORTAR_FACTURAS_PLANILLA', tot.nuevas + ' nuevas');
  return Object.assign(tot, { sin_cliente: sinCliente });
});

/** Panel de cobranza: totales, antigüedad y clientes ordenados por lo vencido. */
const cobranza = B.conBoveda('VER_COBRANZA', function (db, data) {
  const empresa = FB.EMPRESAS.indexOf(txt_(data && data.empresa)) !== -1 ? data.empresa : '';
  const mapa = cartera_(db, { empresa });
  const hoy = hoy_();
  const mes = hoy.slice(0, 7);
  const lista = [...mapa.values()].filter((n) => n.facturas.length || n.saldo_a_favor > 0);
  const T = { por_cobrar: 0, vencido: 0, mas_60: 0, saldo_a_favor: 0, cobrado_mes: 0, facturado_mes: 0, incobrable: 0, tramos: { al_dia: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0 } };
  lista.forEach((n) => {
    T.por_cobrar += n.por_cobrar; T.vencido += n.vencido; T.saldo_a_favor += n.saldo_a_favor; T.incobrable += n.incobrable;
    Object.keys(T.tramos).forEach((k) => { T.tramos[k] += n.tramos[k]; });
    n.pagos.forEach((p) => { if (p.fecha.slice(0, 7) === mes) T.cobrado_mes += p.monto; });
    n.facturas.forEach((f) => { if (f.fecha.slice(0, 7) === mes) T.facturado_mes += f.total; });
  });
  T.mas_60 = T.tramos.d61_90 + T.tramos.d90;
  const sinFacturas = db_().prepare('SELECT COUNT(*) AS n FROM FIN_FACTURAS').get().n === 0;
  return {
    hoy, empresa, sin_facturas: sinFacturas, totales: T, tramos: TRAMOS.map((t) => ({ id: t[0], nombre: t[1], monto: T.tramos[t[0]] })),
    clientes: lista.map((n) => ({
      clave: n.clave, cliente_id: n.cliente_id, cliente: n.cliente, rut: n.rut, en_sigso: !!n.cliente_id,
      facturas_abiertas: n.facturas.filter((f) => f.saldo > 0 && f.estado !== 'INCOBRABLE').length, por_cobrar: n.por_cobrar,
      vencido: n.vencido, dias_max: n.dias_max, saldo_a_favor: n.saldo_a_favor, ultimo_pago: n.pagos.length ? n.pagos[n.pagos.length - 1].fecha : ''
    })).sort((a, b) => b.vencido - a.vencido || b.por_cobrar - a.por_cobrar || b.saldo_a_favor - a.saldo_a_favor)
  };
});

/** La cuenta corriente de un cliente: sus facturas con lo que falta de cada una y sus pagos. */
const fichaCliente = B.conBoveda('VER_FICHA_CLIENTE', function (db, data) {
  const n = cartera_(db).get(txt_(data && data.clave));
  if (!n) return errorValidacion('clave', 'Ese cliente no tiene facturas ni pagos.');
  return {
    cliente: n.cliente, rut: n.rut, en_sigso: !!n.cliente_id, por_cobrar: n.por_cobrar, vencido: n.vencido, saldo_a_favor: n.saldo_a_favor,
    facturado: n.facturado, pagado: n.creditos, notas_credito: n.notas_credito,
    facturas: n.facturas.slice().reverse().map((f) => ({ id: f.id, folio: f.folio, tipo_doc: f.tipo_doc, fecha: f.fecha, vence: f.vence, empresa: f.empresa, total: f.total, pagado: f.pagado || 0, saldo: f.saldo, dias: f.dias, situacion: f.situacion, origen: f.origen, concepto: f.concepto, nota: f.nota, estado: f.estado })),
    pagos: n.pagos.slice().reverse()
  };
});

/** Anular, marcar incobrable o reactivar una factura (con nota obligatoria). */
const cambiarEstadoFactura = B.conBoveda('', function (db, data, contexto, x) {
  if (I.soloEscritura_(contexto)) return errorForbidden('Tu acceso a Finanzas es de solo lectura.');
  const estado = txt_(data && data.estado);
  if (['VIGENTE', 'ANULADA', 'INCOBRABLE'].indexOf(estado) === -1) return errorValidacion('estado', 'Estado no válido.');
  const nota = txt_(data && data.nota).slice(0, 300);
  if (estado !== 'VIGENTE' && nota.length < 3) return errorValidacion('nota', 'Escribe el motivo.');
  const d = db_();
  const r = d.prepare('SELECT * FROM FIN_FACTURAS WHERE id = ?').get(txt_(data && data.id));
  if (!r) return errorValidacion('id', 'Esa factura no existe.');
  const datos = I.des_(r.datos);
  datos.nota = nota || datos.nota;
  d.prepare('UPDATE FIN_FACTURAS SET estado = ?, datos = ?, actualizado_en = ?, actualizado_por = ? WHERE id = ?')
    .run(estado, I.cif_(datos), new Date().toISOString(), x.nombre, r.id);
  x.registrar('FACTURA_' + estado, 'N° ' + datos.folio);
  return { ok: true };
});

module.exports = {
  revisarVentas, importarVentas, importarFacturasPlanilla, cobranza, fichaCliente, cambiarEstadoFactura,
  facturasPorMonto_, cartera_, rutNorm_
};
