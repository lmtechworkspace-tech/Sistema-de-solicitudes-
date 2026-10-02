'use strict';

/**
 * controlInternoSII.js — "Enviar a SIGSO" desde el SII (2026-10-01, piloto
 * asistido en el navegador, igual que el de la TGR): F29 y Registro de
 * Compras y Ventas (RCV).
 *
 * SIGSO no entra al SII ni guarda claves: recibe lo que la persona ya tiene
 * en pantalla (el texto de la página que manda el marcador, lo que pega, o el
 * CSV de "Descargar detalles" del RCV), lo compara con la matriz que
 * corresponde y aplica solo lo que se marca:
 *
 *  - F29 → Informe y pago de IVA (fila del cliente y mes): total a pagar
 *    (cód. 91), tasa (115), base (563) y PPM (62), retención de honorarios
 *    (151), impuesto único (48) y la fecha de presentación. Débitos, créditos
 *    e IVA determinado se muestran (para comparar con el pre-IVA).
 *  - RCV ventas (detalle) → Facturación: folio por folio; los que faltan en la
 *    matriz se pueden agregar con mandante, RUT, tipo y montos.
 *  - RCV compras → Acuse de recibo: cantidad e IVA de facturas y de notas de
 *    crédito.
 *  - Resumen del RCV (la página, sin el CSV): totales para comparar.
 *
 * El texto recibido no se guarda; queda en el historial qué se trajo.
 */

const CI = require('./controlInterno');
const P = require('./controlInternoPlanillas');

const MAX_TEXTO = 3000000;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MESES = { ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, SETIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12 };

// Códigos del F29 (instrucciones del SII).
const CODIGOS_F29 = {
  538: 'Total débitos', 537: 'Total créditos', 89: 'IVA determinado', 77: 'Remanente de crédito fiscal',
  48: 'Impuesto único de segunda categoría', 151: 'Retención de honorarios', 563: 'Base imponible PPM (ingresos brutos)',
  115: 'Tasa PPM', 62: 'PPM neto determinado', 91: 'Total a pagar dentro del plazo legal', 94: 'Total a pagar con recargo'
};
const F29_A_IVA = [
  { columna: 'monto_pago', codigo: 91 }, { columna: 'tasa_ppm', codigo: 115 }, { columna: 'ventas_ppm', codigo: 563 },
  { columna: 'monto_ppm', codigo: 62 }, { columna: 'retencion_honorario', codigo: 151 }, { columna: 'monto_impuesto_unico', codigo: 48 }
];
const F29_INFO = [538, 537, 89, 77, 94];
// Tipo de documento del SII → como se escribe en la matriz Facturación.
const TIPO_DOC = { 33: 'FE', 34: 'FE EXENTA', 46: 'FACTURA DE COMPRA', 52: 'GD', 56: 'ND', 61: 'NC', 110: 'FACTURA EXPORTACION', 111: 'ND EXPORTACION', 112: 'NC EXPORTACION' };
const FAMILIA = { FE: 33, FACTURA: 33, 'FE EXENTA': 34, NC: 61, 'N/C': 61, 'NOTA DE CREDITO': 61, 'N.C ANULACION': 61, ND: 56, GD: 52, 'GUIA DE DESPACHO': 52, 'GUIA DESPACHO': 52 };

function hoy_() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
/** "1.234.567" → 1234567; "0,25" → 0.25; "-5" → -5; lo demás → null. */
function numero_(v) {
  const s = String(v == null ? '' : v).replace(/[$\s]/g, '');
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ''));
  if (/^-?\d+(,\d+)?$/.test(s)) return Number(s.replace(',', '.'));
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  return null;
}
function fechaDMY_(v) {
  const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(String(v || '').trim());
  return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : (RE_FECHA.test(String(v || '').trim()) ? String(v).trim() : '');
}
function rutDe_(t) { const m = /(?<![\d.])(\d{1,2}\.?\d{3}\.?\d{3}\s*-\s*[\dkK])(?![\dkK])/.exec(t); return m ? m[1].replace(/\s/g, '') : ''; }
function periodo_(anio, mes) { return anio + '-M' + String(mes).padStart(2, '0'); }
/** Período del texto: "Período 2026-09", "202609", "09/2026", "Septiembre 2026". */
function periodoDe_(t) {
  let m = /per[ií]odo(?:\s+tributario)?\D{0,25}?(20\d{2})[-/ ]?(0[1-9]|1[0-2])(?!\d)/i.exec(t);
  if (m) return periodo_(m[1], Number(m[2]));
  m = /per[ií]odo(?:\s+tributario)?\D{0,25}?(0?[1-9]|1[0-2])\s*[-/ ]\s*(20\d{2})/i.exec(t);
  if (m) return periodo_(m[2], Number(m[1]));
  m = /per[ií]odo(?:\s+tributario)?[^\n]{0,25}?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|sept?iembre|octubre|noviembre|diciembre)\D{0,6}(20\d{2})/i.exec(t);
  if (m) return periodo_(m[2], MESES[P.n_(m[1])]);
  return '';
}
function periodoDeNombre_(nombre) {
  const m = /(?:^|[_\-\s])(20\d{2})(0[1-9]|1[0-2])(?=[_\-.\s]|$)/.exec(String(nombre || ''));
  return m ? periodo_(m[1], Number(m[2])) : '';
}

// --- F29 ------------------------------------------------------------------------------------
/**
 * Códigos y valores del F29 tal como se copian de la página (tabla
 * "código · glosa · valor", casillas "[91] 1.234.567", o una celda por línea).
 * Por cada aparición de un código conocido, el valor es el ÚLTIMO número
 * antes del siguiente código de la misma línea (la glosa puede traer números
 * como "Art. 42 N°2"). Si en la línea no hay número, se mira la línea siguiente.
 */
function leerF29_(texto) {
  const lineas = String(texto || '').replace(/ /g, ' ').split(/\r?\n/).map((l) => l.replace(/[[\]()]/g, ' ').trim());
  const codigos = {};
  const esNumero = (tk) => numero_(tk) !== null && !/^\d{1,2}\.?\d{3}\.?\d{3}-/.test(tk);
  lineas.forEach((l, i) => {
    const tk = l.split(/[\s\t|:]+/).filter(Boolean);
    const pos = [];
    // Un código conocido (no el número de una línea del formulario: "Línea 20").
    tk.forEach((x, j) => { if (/^\d{2,3}$/.test(x) && CODIGOS_F29[Number(x)] && !/^l[ií]nea$/i.test(tk[j - 1] || '')) pos.push(j); });
    pos.forEach((j, k) => {
      const cod = Number(tk[j]);
      if (codigos[cod] !== undefined) return;
      const tramo = tk.slice(j + 1, k + 1 < pos.length ? pos[k + 1] : tk.length).filter(esNumero);
      let v = tramo.length ? numero_(tramo[tramo.length - 1]) : null;
      if (v === null && k + 1 === pos.length) {
        const sig = (lineas[i + 1] || '').split(/[\s\t|:]+/).filter(Boolean);
        if (sig.length && sig.length <= 3 && sig.every((x) => esNumero(x) || x === '$')) v = numero_(sig.filter(esNumero).pop());
      }
      if (v !== null) codigos[cod] = v;
    });
  });
  const t = lineas.join('\n');
  const fp = /fecha\s+(?:de\s+)?presentaci[oó]n\D{0,15}(\d{1,2}[-/]\d{1,2}[-/]\d{4})/i.exec(t);
  const folio = /folio\D{0,10}(\d{5,})/i.exec(t);
  return { codigos, fecha_presentacion: fp ? fechaDMY_(fp[1]) : '', folio: folio ? folio[1] : '' };
}
function esF29_(t) { return /formulario\s*(n[°º]\s*)?29|\bF\s?29\b|declaraci[oó]n mensual/i.test(t) && /\b(91|538|537)\b/.test(t); }

// --- RCV ------------------------------------------------------------------------------------
/** CSV de "Descargar detalles" (separado por ;): una fila por documento. */
function leerCsvRcv_(texto) {
  const lineas = String(texto || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const iEnc = lineas.findIndex((l) => /;/.test(l) && /folio/i.test(l) && /tipo\s*doc/i.test(l));
  if (iEnc === -1) return null;
  const enc = lineas[iEnc].split(';').map((x) => P.n_(x));
  const col = (...nombres) => enc.findIndex((h) => nombres.some((n) => h === n));
  const ix = {
    tipo: col('TIPO DOC'), folio: col('FOLIO'), fecha: col('FECHA DOCTO'), acuse: col('FECHA ACUSE', 'FECHA ACUSE RECIBO'),
    rut: col('RUT CLIENTE', 'RUT PROVEEDOR'), razon: col('RAZON SOCIAL'), exento: col('MONTO EXENTO'), neto: col('MONTO NETO'),
    iva: col('MONTO IVA', 'MONTO IVA RECUPERABLE'), total: col('MONTO TOTAL')
  };
  const tipo = enc.includes('RUT PROVEEDOR') || enc.includes('MONTO IVA RECUPERABLE') ? 'compras' : 'ventas';
  const num = (v) => { const n = numero_(v); return n === null ? 0 : n; };
  const documentos = lineas.slice(iEnc + 1).map((l) => l.split(';')).filter((c) => c.length >= enc.length - 2 && /^\d+$/.test(String(c[ix.folio] || '').trim())).map((c) => ({
    tipo_doc: Number(c[ix.tipo]) || String(c[ix.tipo] || '').trim(), folio: String(c[ix.folio]).trim(), fecha: fechaDMY_(c[ix.fecha]),
    acuse: ix.acuse === -1 ? '' : fechaDMY_(c[ix.acuse]), rut: ix.rut === -1 ? '' : String(c[ix.rut] || '').trim(), razon_social: ix.razon === -1 ? '' : String(c[ix.razon] || '').trim(),
    exento: num(c[ix.exento]), neto: num(c[ix.neto]), iva: num(c[ix.iva]), total: num(c[ix.total])
  }));
  return { tipo, nivel: 'detalle', documentos };
}
/**
 * Resumen del RCV tal como se ve en la página: una línea por tipo de
 * documento, "Factura Electrónica (33)  12  0  1.000.000  190.000  1.190.000".
 * Primer número = documentos, segundo exento, tercero neto, cuarto IVA y el
 * último el total.
 */
function leerResumenRcv_(texto) {
  const filas = [];
  String(texto || '').replace(/ /g, ' ').split(/\r?\n/).forEach((l) => {
    const m = /^(.*?)\((\d{2,3})\)(.*)$/.exec(l.trim());
    if (!m) return;
    const nums = m[3].split(/[\s\t|]+/).filter(Boolean).map(numero_).filter((n) => n !== null);
    if (nums.length < 3) return;
    filas.push({ tipo_doc: Number(m[2]), nombre: m[1].trim() || 'Tipo ' + m[2], documentos: nums[0], exento: nums[1] || 0, neto: nums[2] || 0, iva: nums[3] || 0, total: nums[nums.length - 1] });
  });
  if (!filas.length) return null;
  const tipo = /iva\s+recuperable|proveedor|compras/i.test(texto) && !/rut\s+cliente/i.test(texto) && !/registro de ventas/i.test(texto) ? 'compras' : 'ventas';
  return { tipo, nivel: 'resumen', resumen: filas };
}

/** ¿Qué llegó? F29, detalle del RCV (CSV) o resumen del RCV. */
function leer_(texto, nombre) {
  const t = String(texto || '').slice(0, MAX_TEXTO);
  const base = { rut: rutDe_(String(nombre || '')) || rutDe_(t), periodo: periodoDeNombre_(nombre) || periodoDe_(t) };
  const csv = leerCsvRcv_(t);
  if (csv) {
    // En el CSV los RUT del cuerpo son de clientes o proveedores: el del contribuyente va en el nombre del archivo.
    base.rut = rutDe_(String(nombre || ''));
    if (!base.periodo && csv.documentos.length) {
      const cuenta = {};
      csv.documentos.forEach((d) => { if (d.fecha) { const p = d.fecha.slice(0, 4) + '-M' + d.fecha.slice(5, 7); cuenta[p] = (cuenta[p] || 0) + 1; } });
      base.periodo = Object.keys(cuenta).sort((a, b) => cuenta[b] - cuenta[a])[0] || '';
    }
    return Object.assign({ fuente: 'rcv' }, base, csv);
  }
  if (esF29_(t)) return Object.assign({ fuente: 'f29' }, base, leerF29_(t));
  const res = leerResumenRcv_(t);
  if (res) return Object.assign({ fuente: 'rcv' }, base, res);
  return null;
}

// --- comparación con las matrices ---------------------------------------------------------------
function num_(v) { const n = numero_(v); return n === null ? (typeof v === 'number' ? v : null) : n; }
function campo_(m, columna, sii, actual, extra) {
  const c = m.columnas.find((k) => k.clave === columna) || { etiqueta: columna };
  const vacio = actual === undefined || actual === null || actual === '';
  const igual = !vacio && (num_(actual) !== null && typeof sii === 'number' ? Math.abs(num_(actual) - sii) < 1 : String(actual) === String(sii));
  return Object.assign({ columna, etiqueta: c.etiqueta, sii, matriz: vacio ? '' : actual, estado: vacio ? 'vacio' : (igual ? 'igual' : 'distinto') }, extra || {});
}
function filaDe_(db, matriz, periodo, cliente) {
  return CI.consultar_(db, 'CI_REGISTROS', { matriz, periodo, activa: true }).find((r) => (cliente.cliente_id ? r.cliente_id === cliente.cliente_id : CI.normalizarTexto_(r.cliente_nombre) === CI.normalizarTexto_(cliente.nombre))) || null;
}
function familia_(tipo) {
  if (typeof tipo === 'number') return tipo === 34 ? 33 : tipo;
  const n = P.n_(tipo);
  return FAMILIA[n] === 34 ? 33 : (FAMILIA[n] || (/^N\.?\s?C|CREDITO/.test(n) ? 61 : (/FACT/.test(n) ? 33 : n)));
}

function comparar_(db, contexto, leido, cliente, periodo) {
  if (leido.fuente === 'f29') {
    const x = CI.matrizConPermiso_(db, contexto, 'IVA', 've');
    if (x.error) return { error: x.error };
    const fila = filaDe_(db, 'IVA', periodo, cliente);
    const d = (fila && fila.datos) || {};
    const campos = F29_A_IVA.filter((k) => leido.codigos[k.codigo] !== undefined)
      .map((k) => campo_(x.m, k.columna, leido.codigos[k.codigo], d[k.columna], { codigo: k.codigo, glosa: CODIGOS_F29[k.codigo] }));
    if (leido.fecha_presentacion) campos.push(campo_(x.m, 'fecha_declaracion', leido.fecha_presentacion, d.fecha_declaracion, { glosa: 'Fecha de presentación del F29' }));
    const info = F29_INFO.filter((c) => leido.codigos[c] !== undefined).map((c) => ({ codigo: c, glosa: CODIGOS_F29[c], valor: leido.codigos[c] }));
    if (leido.codigos[89] !== undefined && num_(d.monto_pre_iva) !== null) info.push({ glosa: 'Pre-IVA de la matriz (para comparar con el IVA determinado)', valor: num_(d.monto_pre_iva) });
    return { matriz: 'IVA', registro_id: fila ? fila.registro_id : '', campos, info, puede_registrar: !!x.p.registra };
  }
  if (leido.tipo === 'compras') {
    const x = CI.matrizConPermiso_(db, contexto, 'ACUSE', 've');
    if (x.error) return { error: x.error };
    const fila = filaDe_(db, 'ACUSE', periodo, cliente);
    const d = (fila && fila.datos) || {};
    const filas = leido.nivel === 'detalle' ? leido.documentos.map((k) => ({ tipo_doc: k.tipo_doc, documentos: 1, iva: k.iva, acuse: k.acuse })) : leido.resumen;
    const suma = (fam, k) => filas.filter((f) => (fam === 61 ? f.tipo_doc === 61 : f.tipo_doc !== 61 && f.tipo_doc !== 56)).reduce((s, f) => s + (Number(f[k]) || 0), 0);
    const campos = [
      campo_(x.m, 'cantidad_documentos', suma(33, 'documentos'), d.cantidad_documentos, { glosa: 'Facturas y otros documentos (no NC ni ND)' }),
      campo_(x.m, 'monto_iva', suma(33, 'iva'), d.monto_iva, { glosa: 'IVA recuperable de esos documentos' }),
      campo_(x.m, 'cantidad_documentos_n_c', suma(61, 'documentos'), d.cantidad_documentos_n_c, { glosa: 'Notas de crédito (61)' }),
      campo_(x.m, 'monto_iva_n_c', suma(61, 'iva'), d.monto_iva_n_c, { glosa: 'IVA de las notas de crédito' })
    ];
    const info = leido.nivel === 'detalle' ? [{ glosa: 'Documentos sin fecha de acuse en el archivo', valor: leido.documentos.filter((k) => !k.acuse).length }] : [];
    return { matriz: 'ACUSE', registro_id: fila ? fila.registro_id : '', campos, info, puede_registrar: !!x.p.registra };
  }
  // Ventas → Facturación.
  const x = CI.matrizConPermiso_(db, contexto, 'FACTURACION', 've');
  if (x.error) return { error: x.error };
  const filas = CI.consultar_(db, 'CI_REGISTROS', { matriz: 'FACTURACION', periodo, activa: true })
    .filter((r) => !/^ANULAD/.test(String(r.estado || '')) && (cliente.cliente_id ? r.cliente_id === cliente.cliente_id : CI.normalizarTexto_(r.cliente_nombre) === CI.normalizarTexto_(cliente.nombre)));
  if (leido.nivel === 'resumen') {
    const docs = leido.resumen.reduce((s, f) => s + f.documentos, 0), total = leido.resumen.reduce((s, f) => s + (f.tipo_doc === 61 ? -f.total : f.total), 0);
    const totMatriz = filas.reduce((s, r) => s + ((familia_((r.datos || {}).tipo_documento) === 61 ? -1 : 1) * (num_((r.datos || {}).monto_total) || 0)), 0);
    return {
      matriz: 'FACTURACION', resumen: leido.resumen, puede_registrar: false,
      info: [{ glosa: 'Documentos en el SII', valor: docs }, { glosa: 'Filas en la matriz', valor: filas.length }, { glosa: 'Monto total en el SII (NC restan)', valor: total }, { glosa: 'Monto total en la matriz (NC restan)', valor: totMatriz }],
      nota: 'Con el CSV de "Descargar detalles" se compara folio por folio y se pueden agregar los que faltan.'
    };
  }
  const usados = new Set();
  const faltan = [], distintos = [];
  let iguales = 0;
  leido.documentos.forEach((k) => {
    const f = filas.find((r) => !usados.has(r.registro_id) && String(num_((r.datos || {}).folio_documento)) === String(Number(k.folio)) && (!(r.datos || {}).tipo_documento || familia_(r.datos.tipo_documento) === familia_(k.tipo_doc)));
    if (!f) { faltan.push(k); return; }
    usados.add(f.registro_id);
    const tot = num_((f.datos || {}).monto_total);
    if (tot !== null && Math.abs(tot - k.total) >= 1) distintos.push({ folio: k.folio, tipo_doc: k.tipo_doc, sii: k.total, matriz: tot, registro_id: f.registro_id });
    else iguales++;
  });
  const sobran = filas.filter((r) => !usados.has(r.registro_id) && (r.datos || {}).folio_documento !== undefined && (r.datos || {}).folio_documento !== '')
    .map((r) => ({ registro_id: r.registro_id, folio: String(r.datos.folio_documento), tipo: r.datos.tipo_documento || '', total: r.datos.monto_total }));
  return {
    matriz: 'FACTURACION', puede_registrar: !!x.p.registra, iguales, distintos, sobran,
    faltan: faltan.map((k) => Object.assign({}, k, { tipo: TIPO_DOC[k.tipo_doc] || String(k.tipo_doc) }))
  };
}

function preparar_(db, data, contexto) {
  const d = data || {};
  const leido = leer_(d.texto, d.nombre);
  if (!leido) return { error: { ok: false, message: 'No se reconoció un F29 ni el Registro de Compras y Ventas. Abre el formulario o el registro en el SII (o su CSV de "Descargar detalles") y vuelve a enviar.' } };
  if (leido.fuente === 'rcv' && leido.nivel === 'resumen' && (d.tipo === 'ventas' || d.tipo === 'compras')) leido.tipo = d.tipo;
  let cliente = null;
  if (d.cliente_id) {
    const c = CI.clientes_(db).find((k) => k.cliente_id === String(d.cliente_id));
    if (!c) return { error: { ok: false, message: 'El cliente no está en el catálogo.' } };
    cliente = { cliente_id: c.cliente_id, nombre: c.nombre, rut: c.rut };
  } else if (leido.rut) {
    const c = CI.resolverClienteTexto_(CI.contextoClientes_(db), leido.rut, leido.rut, '');
    if (c && c.cliente_id) cliente = { cliente_id: c.cliente_id, nombre: c.cliente_nombre, rut: c.cliente_rut };
  }
  const periodo = CI.RE_PERIODO.test(String(d.periodo || '')) ? d.periodo : leido.periodo;
  const desc = { fuente: leido.fuente, tipo: leido.tipo || '', nivel: leido.nivel || '', rut: leido.rut, periodo_detectado: leido.periodo, folio: leido.folio || '',
    documentos: leido.documentos ? leido.documentos.length : (leido.resumen ? leido.resumen.reduce((s, f) => s + f.documentos, 0) : undefined),
    codigos: leido.codigos ? Object.keys(leido.codigos).length : undefined };
  const res = { ok: true, leido: desc, cliente, periodo: periodo || '' };
  if (!cliente || !periodo) return { res, falta: !cliente ? 'cliente' : 'periodo' };
  const comp = comparar_(db, contexto, leido, cliente, periodo);
  if (comp.error) return { error: comp.error };
  return { res: Object.assign(res, { comparacion: comp }), leido, cliente, periodo };
}

// =========================================================================================
// Acciones
// =========================================================================================

/** Revisar: qué llegó, de qué cliente y mes, y cómo se compara con la matriz. */
function revisar(db, data, contexto) {
  if (!CI.acceso_(db, contexto).tieneModulo) return { _forbidden: true, message: 'Tu cuenta no tiene el módulo Control interno.' };
  const p = preparar_(db, data, contexto);
  if (p.error) return p.error;
  if (p.falta) return Object.assign(p.res, { falta: p.falta, message: p.falta === 'cliente' ? 'Elige el cliente (no se reconoció el RUT de la página).' : 'Elige el mes.' });
  return p.res;
}

/**
 * Aplicar lo marcado. data: lo mismo que revisar + usar: [columnas] (F29 y
 * compras) o crear: [folios] (ventas). Se vuelve a comparar en el servidor:
 * nunca se escriben valores que vengan de la pantalla.
 */
function aplicar(db, data, contexto) {
  const p = preparar_(db, data, contexto);
  if (p.error) return p.error;
  if (p.falta) return { ok: false, message: p.falta === 'cliente' ? 'Elige el cliente.' : 'Elige el mes.' };
  const d = data || {};
  const comp = p.res.comparacion;
  const nombreFuente = p.leido.fuente === 'f29' ? 'F29' : 'RCV ' + p.leido.tipo;
  if (comp.matriz === 'FACTURACION') {
    const crear = new Set((Array.isArray(d.crear) ? d.crear : []).map(String));
    let creadas = 0;
    const errores = [];
    (comp.faltan || []).filter((k) => crear.has(String(k.folio))).forEach((k) => {
      const datos = { folio_documento: Number(k.folio), tipo_documento: k.tipo, monto_neto: k.neto, monto_total: k.total };
      if (k.razon_social) datos.empresa_mandante = k.razon_social;
      if (k.rut) datos.rut_empresa_mandante = k.rut;
      const r = CI.guardar(db, { matriz: 'FACTURACION', periodo: p.periodo, cliente_id: p.cliente.cliente_id, datos, observaciones: 'Desde el Registro de Ventas del SII' + (k.fecha ? ' (documento del ' + k.fecha.split('-').reverse().join('-') + ')' : '') + '.' }, contexto);
      if (r && r.ok) { creadas++; CI.historial_(db, r.registro.registro_id, 'SII', 'Agregado desde el ' + nombreFuente + ' (folio ' + k.folio + ')', contexto); } else errores.push('Folio ' + k.folio + ': ' + ((r && r.message) || 'no se pudo.'));
    });
    return { ok: true, creadas, errores, message: creadas + (creadas === 1 ? ' documento agregado' : ' documentos agregados') + ' a Facturación.' + (errores.length ? ' ' + errores.join(' ') : '') };
  }
  const usar = new Set((Array.isArray(d.usar) ? d.usar : []).map(String));
  const datos = {};
  (comp.campos || []).filter((c) => usar.has(c.columna) && c.estado !== 'igual').forEach((c) => { datos[c.columna] = c.sii; });
  if (!Object.keys(datos).length) return { ok: true, message: 'Nada que aplicar.' };
  const r = comp.registro_id
    ? CI.guardar(db, { registro_id: comp.registro_id, datos }, contexto)
    : CI.guardar(db, { matriz: comp.matriz, periodo: p.periodo, cliente_id: p.cliente.cliente_id, datos }, contexto);
  if (!r || !r.ok) return r || { ok: false, message: 'No se pudo guardar.' };
  CI.historial_(db, r.registro.registro_id, 'SII', 'Datos traídos del ' + nombreFuente + ': ' + Object.keys(datos).join(', '), contexto);
  return { ok: true, registro_id: r.registro.registro_id, message: (comp.registro_id ? 'Fila actualizada' : 'Fila creada') + ' con ' + Object.keys(datos).length + (Object.keys(datos).length === 1 ? ' dato' : ' datos') + ' del ' + nombreFuente + '.' };
}

module.exports = { revisar, aplicar, leer_, leerF29_, leerCsvRcv_, leerResumenRcv_, periodoDe_, CODIGOS_F29 };
