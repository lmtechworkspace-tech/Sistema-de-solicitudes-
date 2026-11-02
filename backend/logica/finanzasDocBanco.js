'use strict';

/**
 * finanzasDocBanco.js — Documentos del banco que completan la cartola (Finanzas v5.6, 02-11-2026; paso 2 de la reunión).
 *
 * La cartola solo trae fecha, monto y una glosa corta («PAGO CUENTAS VIA INTERNET», «TRANSFER DE CONSTRUC…»). Dos
 * descargas del BCI dicen lo que falta:
 *   - HISTORIAL DE PAGOS DE CUENTAS: qué servicio se pagó (Previred = imposiciones, SII = IVA, Tesorería…) y el
 *     IDENTIFICADOR, que es el RUT de la empresa por la que se pagó → de qué cliente es ese dinero.
 *   - TRANSFERENCIAS RECIBIDAS: nombre completo y RUT de quien transfirió → el cliente con certeza, aunque el banco
 *     acorte el nombre. Si paga alguien que no es cliente, SIGSO recuerda por quién pagó la vez anterior, o propone
 *     el cliente cuya factura abierta tiene ese mismo monto.
 * Cada fila se une con su movimiento de la cartola (mismo monto, hasta 3 días hábiles) y la planilla muestra una
 * SUGERENCIA con su respaldo. SIGSO propone, no decide: la persona acepta (y lo aceptado se recuerda por RUT).
 *
 * Los lectores reconocen las columnas por su título (con sinónimos), no por su posición: el BCI cambia sus exportaciones.
 */

const B = require('./finanzasBoveda');
const Base = require('./finanzasBase');
const F = require('./finanzasBancos');
const P = require('./finanzasPagadores');
const { errorValidacion } = require('./errores');

const I = F.interno;
const N = (s) => I.normalizar_(s);
const txt_ = (v) => String(v == null ? '' : v).trim();

function rutNorm_(r) { const s = String(r || '').replace(/[^0-9kK]/g, '').toUpperCase(); return s.length >= 7 && s.length <= 10 ? s.slice(0, -1).replace(/^0+/, '') + '-' + s.slice(-1) : ''; }
function rutVisible_(r) { const n = rutNorm_(r); if (!n) return ''; const [c, dv] = n.split('-'); return c.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv; }

// ---------------------------------------------------------------- lectores

const COLS_PAGOS = {
  fecha: /^(FECHA( DE)? PAGO|FECHA( DE)? OPERACION|FECHA)/, monto: /^(MONTO( PAGADO| TOTAL)?|TOTAL( PAGADO)?|IMPORTE|VALOR)/,
  servicio: /^(SERVICIO|EMPRESA|CONVENIO|INSTITUCION|BENEFICIARIO|COMERCIO|ENTIDAD|RAZON SOCIAL)/,
  identificador: /^(IDENTIFICADOR|N(RO|°|O)? (DE )?CLIENTE|RUT|CODIGO( DE)? (CLIENTE|SERVICIO)|REFERENCIA|ID( |$)|NUMERO( DE)? (CLIENTE|SERVICIO))/,
  estado: /^(ESTADO|RESULTADO)/, detalle: /^(DETALLE|DESCRIPCION|GLOSA)/
};
const COLS_TRANSF = {
  fecha: /^(FECHA( DE)? (TRANSFERENCIA|ABONO|OPERACION|RECEPCION)|FECHA)/, monto: /^(MONTO|IMPORTE|VALOR|TOTAL)/,
  nombre: /^(NOMBRE( DEL)? (ORIGEN|ORDENANTE|REMITENTE|EMISOR|TITULAR)|ORIGEN|ORDENANTE|REMITENTE|EMISOR|NOMBRE)/,
  rut: /^(RUT( DEL)? (ORIGEN|ORDENANTE|REMITENTE|EMISOR|TITULAR)?|RUT)/, banco: /^(BANCO( DE)? ORIGEN|BANCO)/,
  estado: /^(ESTADO|RESULTADO)/, mensaje: /^(MENSAJE|COMENTARIO|GLOSA|DESCRIPCION|DETALLE)/
};
function cabecera_(filas, cols, obligatorias) {
  for (let i = 0; i < Math.min(filas.length, 40); i++) {
    const H = Array.from(filas[i] || [], (c) => N(c));
    const ix = {};
    Object.keys(cols).forEach((k) => { ix[k] = H.findIndex((h, j) => h && cols[k].test(h) && !Object.keys(ix).some((o) => ix[o] === j)); });
    if (obligatorias.every((k) => ix[k] >= 0)) return { fila: i, ix };
  }
  return null;
}
function filas_(filas, cab, armar) {
  const out = [];
  filas.slice(cab.fila + 1).forEach((f, k) => {
    const c = Array.from(f || [], txt_);
    if (!c.some(Boolean)) return;
    const v = {}; Object.keys(cab.ix).forEach((x) => { v[x] = cab.ix[x] >= 0 ? c[cab.ix[x]] : ''; });
    const fecha = I.fechaIso_(v.fecha);
    const monto = Math.abs(F.monto_(v.monto) || 0);
    if (!fecha || !monto) return;
    if (/RECHAZ|ANULAD|FALLID|REVERS|DEVUELT|PENDIENTE/.test(N(v.estado))) return; // solo lo que de verdad se movió
    const r = armar(v); if (r) out.push(Object.assign({ fila: cab.fila + k + 2, fecha, monto }, r));
  });
  return out;
}
/** Qué obligación es un servicio pagado. */
function servicio_(s) {
  const n = N(s);
  if (/PREVIRED|AFP|IPS|FONASA|ISAPRE|MUTUAL|CAJA DE COMPENSACION|CCAF|IMPOSICION/.test(n)) return { medio: 'PREVIRED', obs: 'IMPOSICIONES', plan: 'Imposiciones', texto: 'imposiciones' };
  if (/TESORERIA|TGR/.test(n)) return { medio: 'TESORERIA', obs: 'IVA', plan: /CONVENIO/.test(n) ? 'Convenios' : 'IVA', texto: /CONVENIO/.test(n) ? 'un convenio con la Tesorería' : 'impuestos (Tesorería)' };
  if (/\bSII\b|SERVICIO DE IMPUESTOS|F29|IVA/.test(n)) return { medio: 'SII', obs: 'IVA', plan: 'IVA', texto: 'IVA' };
  return { medio: 'OTRO', obs: '', plan: '', texto: txt_(s).toLowerCase() || 'un servicio' };
}
/** Reconoce el archivo: historial de pagos de cuentas o transferencias recibidas. */
function leer_(filas) {
  filas = Array.isArray(filas) ? filas : [];
  const cp = cabecera_(filas, COLS_PAGOS, ['fecha', 'monto', 'servicio', 'identificador']);
  if (cp) {
    const l = filas_(filas, cp, (v) => ({ servicio: v.servicio, identificador: v.identificador, rut: rutNorm_(v.identificador), detalle: v.detalle || '', obligacion: servicio_(v.servicio) }));
    if (l.length) return { tipo: 'PAGOS_CUENTAS', nombre: 'Historial de pagos de cuentas', sentido: 'cargo', filas: l };
  }
  const ct = cabecera_(filas, COLS_TRANSF, ['fecha', 'monto', 'nombre']);
  if (ct) {
    const l = filas_(filas, ct, (v) => {
      const nombre = txt_(v.nombre).replace(/\s+/g, ' ');
      return { nombre, rut: rutNorm_(v.rut) || rutNorm_((/(\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK])/.exec(nombre) || [])[1]), banco: v.banco || '', mensaje: v.mensaje || '' };
    });
    if (l.length) return { tipo: 'TRANSFERENCIAS', nombre: 'Transferencias recibidas', sentido: 'abono', filas: l };
  }
  return { error: 'No reconozco este archivo. Aquí entran el «historial de pagos de cuentas» del BCI (columnas de fecha, servicio o empresa, identificador y monto) y las «transferencias recibidas» (fecha, nombre y RUT de quien transfiere, y monto). Si es uno de ellos y no lo reconoce, envíalo para ajustar el lector.' };
}

// ---------------------------------------------------------------- importar (unir con la cartola)

function cuentaDe_(data) {
  const cuentas = I.cuentasMapa_();
  if (data && data.cuenta && cuentas.get(data.cuenta)) return cuentas.get(data.cuenta);
  const m = /(\d{4,})/.exec(String((data && data.nombre_archivo) || '').replace(/\d{4}-\d{2}-\d{2}/g, ''));
  if (m) { const c = [...cuentas.values()].find((x) => m[1].slice(-4) === x.ultimos4); if (c) return c; }
  return cuentas.size === 1 ? [...cuentas.values()][0] : null;
}
function maestro_(db) {
  try {
    const { leerFilas_ } = require('../db/sqliteRepo');
    const { COLUMNAS } = require('../db/schema');
    return leerFilas_(db, 'CAT_CLIENTES', COLUMNAS.CAT_CLIENTES).filter((c) => c.cliente_id && c.razon_social)
      .map((c) => ({ id: String(c.cliente_id), nombre: String(c.razon_social).trim(), rut: rutNorm_(c.rut) }));
  } catch (e) { return []; }
}
function rutsPropios_() {
  const s = new Set();
  try { require('./finanzasCatalogos').lista_('EMPRESA', { todos: true }).forEach((e) => { [e.rut].concat(e.ruts || []).forEach((r) => { if (rutNorm_(r)) s.add(rutNorm_(r)); }); }); } catch (e) { /* sin catálogo */ }
  return s;
}

const importar = B.conBoveda('', function (db, data, contexto, x) {
  const revisar = !!(data && data.revisar);
  if (!revisar) { const e_ = Base.exigir_(contexto, 'REGISTRAR'); if (e_) return e_; }
  const doc = leer_(data && data.filas);
  if (doc.error) return errorValidacion('archivo', doc.error);
  const cuenta = cuentaDe_(data);
  if (!cuenta) return errorValidacion('cuenta', 'Elige de qué cuenta es este archivo (o sube primero la cartola de esa cuenta).');
  const fs = doc.filas.map((y) => y.fecha).sort();
  const desde = Base.sumarDias_(fs[0], -6), hasta = Base.sumarDias_(fs[fs.length - 1], 6);
  const d = I.db_();
  const movs = d.prepare('SELECT id, fecha, datos FROM FIN_MOVIMIENTOS WHERE cuenta_ref = ? AND fecha BETWEEN ? AND ? ORDER BY fecha, orden').all(cuenta.id, desde, hasta)
    .map((r) => ({ r, d: I.des_(r.datos) })).filter((m) => !m.d.sin_cartola && (doc.sentido === 'cargo' ? m.d.cargo > 0 : m.d.abono > 0));
  // Mismo monto; primero el mismo día, después hasta 3 días hábiles (el banco contabiliza al día hábil siguiente).
  const usados = new Set(), pares = [];
  [0, 1, 2, 3].forEach((tol) => doc.filas.forEach((y) => {
    if (y._par) return;
    const j = movs.findIndex((m, k) => !usados.has(k) && (doc.sentido === 'cargo' ? m.d.cargo : m.d.abono) === y.monto && Base.diasHabiles_(m.r.fecha, y.fecha) <= tol);
    if (j >= 0) { usados.add(j); y._par = true; pares.push({ y, m: movs[j] }); }
  }));
  const maestro = maestro_(db), porRut = new Map(maestro.filter((c) => c.rut).map((c) => [c.rut, c])), propios = rutsPropios_();
  const conCliente = pares.filter((p) => p.y.rut && (porRut.has(p.y.rut) || propios.has(p.y.rut))).length;
  const resumen = { tipo: doc.tipo, nombre: doc.nombre, cuenta: cuenta.banco + ' ···' + cuenta.ultimos4 + ' · ' + cuenta.empresa, filas: doc.filas.length, emparejados: pares.length, con_cliente: conCliente,
    sin_cartola: doc.filas.filter((y) => !y._par).slice(0, 30).map((y) => ({ fecha: y.fecha, monto: y.monto, quien: y.nombre || y.servicio || '' })),
    periodos: [...new Set(pares.map((p) => p.m.r.fecha.slice(0, 7)))].sort() };
  if (revisar) return resumen;
  d.exec('BEGIN');
  try {
    pares.forEach((p) => {
      const y = p.y, m = p.m.d;
      m.doc_banco = Object.assign({}, m.doc_banco || {}, doc.tipo === 'PAGOS_CUENTAS'
        ? { pago: { servicio: y.servicio, identificador: y.identificador, rut: y.rut, medio: y.obligacion.medio, fecha: y.fecha, archivo: txt_(data.nombre_archivo).slice(0, 120) } }
        : { transferencia: { nombre: y.nombre, rut: y.rut, banco: y.banco, mensaje: y.mensaje, fecha: y.fecha, archivo: txt_(data.nombre_archivo).slice(0, 120) } });
      // El nombre completo de quien pagó también le sirve a la sugerencia de siempre (detalle del banco).
      m.detalle = Object.assign({ descripcion: '', medio: doc.tipo === 'PAGOS_CUENTAS' ? y.obligacion.medio : 'TRANSFERENCIA' }, m.detalle || {});
      if (doc.tipo === 'TRANSFERENCIAS' && !m.detalle.pagador) m.detalle.pagador = y.nombre;
      if (doc.tipo === 'PAGOS_CUENTAS' && !m.detalle.destinatario) m.detalle.destinatario = y.servicio;
      if (!m.detalle.fecha_tx) m.detalle.fecha_tx = y.fecha;
      d.prepare('UPDATE FIN_MOVIMIENTOS SET datos = ? WHERE id = ?').run(I.cif_(m), p.m.r.id);
    });
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
  x.registrar('IMPORTAR_DOC_BANCO', doc.nombre + ' · ' + cuenta.banco + ' ···' + cuenta.ultimos4 + ': ' + pares.length + ' de ' + doc.filas.length);
  return resumen;
});

// ---------------------------------------------------------------- sugerencias para la planilla

const VACIAS_ = /^(SPA|LTDA|LIMITADA|EIRL|SA)$/; // solo la forma legal: «PANADERIA SOL DE MAYO» queda entera
function corto_(nombre) { return N(nombre).replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !VACIAS_.test(w)).join(' '); }

/**
 * Sugerencia de cada fila sin anotar (o sin nombre) que tiene su documento del banco: { nombre, obs, plan, cliente_id,
 * motivo, certeza, fuente }. La OBS de un cliente que ya se anotó antes se toma de lo último (memoria de la hoja).
 */
function sugerir_(db, filas, listas, empresaCuenta) {
  const con = filas.filter((f) => f.doc_banco && (f.banco === 'falta' || !f.nombre || !f.obs));
  if (!con.length) return;
  const maestro = maestro_(db), porRut = new Map(maestro.filter((c) => c.rut).map((c) => [c.rut, c])), propios = rutsPropios_();
  // Cómo se llama a cada cliente en la planilla (el nombre corto más usado), para que la sugerencia se vea como el resto.
  const usado = new Map();
  filas.forEach((f) => { if (f.cliente_id && f.nombre) { const m = usado.get(f.cliente_id) || new Map(); m.set(f.nombre, (m.get(f.nombre) || 0) + 1); usado.set(f.cliente_id, m); } });
  const nombreDe = (c) => { const m = usado.get(c.id); return m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] : corto_(c.nombre); };
  const memoria = (listas && listas.memoria) || {};
  let facturas = null;
  const facturasAbiertas = () => { if (!facturas) { try { facturas = require('./finanzasHoja').facturas_(db, null).filter((x) => x.saldo > 0 && x.estado !== 'Incobrable'); } catch (e) { facturas = []; } } return facturas; };
  con.forEach((f) => {
    const pg = f.doc_banco.pago, tr = f.doc_banco.transferencia;
    if (pg) {
      const ob = servicio_(pg.servicio), c = pg.rut && porRut.get(pg.rut);
      if (pg.rut && propios.has(pg.rut)) { f.sug_doc = { nombre: corto_(pg.servicio) || ob.medio, obs: 'ABONO', plan: ob.plan || 'Otros Egresos', certeza: 'alta', fuente: 'Historial de pagos de cuentas', motivo: 'Pago de ' + ob.texto + ' de la propia empresa (' + txt_(pg.servicio) + ', RUT ' + rutVisible_(pg.rut) + ')' }; return; }
      if (c) { f.sug_doc = { nombre: nombreDe(c), cliente_id: c.id, obs: ob.obs, plan: ob.plan, certeza: ob.obs ? 'alta' : 'media', fuente: 'Historial de pagos de cuentas', motivo: 'Se pagó ' + ob.texto + ' de ' + c.nombre + ' (' + txt_(pg.servicio) + ', RUT ' + rutVisible_(pg.rut) + ')' }; return; }
      f.sug_doc = { nombre: '', obs: ob.obs, plan: ob.plan, certeza: 'baja', fuente: 'Historial de pagos de cuentas', motivo: 'Pago de ' + ob.texto + ' (' + txt_(pg.servicio) + ')' + (pg.rut ? ' por el RUT ' + rutVisible_(pg.rut) + ', que no está en el maestro de clientes' : ' sin RUT en el identificador') + ': escribe de quién es.' };
      return;
    }
    if (tr) {
      const c = tr.rut && porRut.get(tr.rut);
      const obsDe = (nombre) => { const m = memoria[N(nombre)]; return m && m.signo !== -1 && m.obs ? { obs: m.obs, plan: m.plan || '' } : { obs: 'ABONO', plan: '' }; };
      if (c) { const n = nombreDe(c), o = obsDe(n); f.sug_doc = { nombre: n, cliente_id: c.id, obs: o.obs, plan: o.plan, certeza: 'alta', fuente: 'Transferencias recibidas', motivo: 'Transfirió ' + c.nombre + ' (RUT ' + rutVisible_(tr.rut) + ')' }; return; }
      // Pagó alguien que no es cliente: ¿por quién pagó antes (recordado por su RUT o su nombre)?
      const rec = (tr.rut && P.pagadorDe_('RUT ' + tr.rut)) || P.pagadorDe_(tr.nombre);
      const cl = rec && Object.keys(rec.clientes || {}).map((id) => Object.assign({ id }, rec.clientes[id])).sort((a, b) => b.veces - a.veces);
      if (cl && cl.length) {
        const k = maestro.find((m) => m.id === cl[0].id) || { id: cl[0].id, nombre: cl[0].cliente };
        const n = nombreDe(k), o = obsDe(n);
        f.sug_doc = { nombre: n, cliente_id: k.id, obs: o.obs, plan: o.plan, certeza: cl.length === 1 ? 'alta' : 'media', fuente: 'Transferencias recibidas', motivo: tr.nombre + ' ya pagó antes por ' + k.nombre + (cl.length > 1 ? ' (también por ' + cl.slice(1, 3).map((z) => z.cliente).join(', ') + ')' : '') };
        return;
      }
      // ¿El monto calza con una sola factura abierta? Se propone ese cliente (y su factura).
      const fa = facturasAbiertas().filter((z) => z.saldo === f.monto && (!empresaCuenta || z.empresa === empresaCuenta));
      if (fa.length === 1) {
        const k = maestro.find((m) => m.id === fa[0].cliente_id) || { id: fa[0].cliente_id, nombre: fa[0].cliente };
        const n = k.id ? nombreDe(k) : corto_(fa[0].cliente);
        f.sug_doc = { nombre: n, cliente_id: k.id || '', obs: 'ABONO', plan: '', fact: String(fa[0].folio), certeza: 'media', fuente: 'Transferencias recibidas', motivo: 'Pagó ' + tr.nombre + (tr.rut ? ' (RUT ' + rutVisible_(tr.rut) + ')' : '') + ', que no es cliente; el monto calza con la factura ' + fa[0].folio + ' de ' + fa[0].cliente + '. Confírmalo y SIGSO lo recordará' };
        return;
      }
      f.sug_doc = { nombre: corto_(tr.nombre), obs: 'ABONO', plan: '', certeza: 'baja', fuente: 'Transferencias recibidas', motivo: 'Transfirió ' + tr.nombre + (tr.rut ? ' (RUT ' + rutVisible_(tr.rut) + ')' : '') + ': no está en el maestro de clientes. Si paga por un cliente, escribe el del cliente.' };
    }
  });
}

/**
 * Acepta sugerencias: anota cada fila con lo sugerido (como si se escribiera en la hoja) y recuerda por qué cliente
 * pagó cada RUT o nombre, para la próxima vez. data: { ids, cuenta_ref, periodo }
 */
const aceptar = Base.conCapacidad('REGISTRAR', '', function (db, data, contexto, x) {
  const H = require('./finanzasHoja');
  const ids = new Set((Array.isArray(data && data.ids) ? data.ids : []).map(txt_).filter(Boolean).slice(0, 300));
  if (!ids.size) return errorValidacion('ids', 'Elige las filas.');
  const h = H.hoja(db, Object.assign({}, data, { periodo: data.periodo, cuenta_ref: data.cuenta_ref }), contexto);
  if (!h || h._validationError) return h;
  let anotadas = 0; const errores = [];
  h.filas.filter((f) => ids.has(f.id) && f.sug_doc && f.sug_doc.nombre).forEach((f) => {
    const s = f.sug_doc, campos = { nombre: s.nombre };
    if (!f.obs && s.obs) campos.obs = s.obs;
    if (!f.plan && s.plan) campos.plan = s.plan;
    if (!f.fact && s.fact) campos.fact = s.fact;
    const r = H.guardar(db, Object.assign({}, data, { id: f.id, expected_version: f.version, campos }), contexto);
    if (r && (r._validationError || r._forbidden || r.codigo)) { errores.push({ id: f.id, error: r.message || 'No se pudo anotar.' }); return; }
    anotadas++;
    const tr = f.doc_banco && f.doc_banco.transferencia;
    if (tr && s.cliente_id) {
      const cli = s.nombre;
      if (tr.rut) P.registrarPagador_('RUT ' + tr.rut, s.cliente_id, cli, 'TRANSFERENCIAS');
      if (tr.nombre) P.registrarPagador_(tr.nombre, s.cliente_id, cli, 'TRANSFERENCIAS');
    }
  });
  x.registrar('ACEPTAR_SUGERENCIAS_DOC', anotadas + ' fila(s)');
  return { anotadas, errores };
});

module.exports = { importar, aceptar, sugerir_, leer_, servicio_, rutNorm_ };
