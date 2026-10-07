'use strict';

/**
 * finanzasBancos.js — Finanzas, Etapa 2: bancos y cartolas (2026-10-06).
 *
 * Reemplaza el formulario "Movimiento bancario" de la planilla SIGECO: en
 * vez de digitar cada movimiento, se sube la cartola del banco tal cual
 * (Excel), el sistema la lee, comprueba que el saldo cuadre, descarta lo que
 * ya estaba y SUGIERE qué es cada movimiento. La persona confirma o corrige;
 * lo que corrige queda como regla para la próxima vez.
 *
 * Lo que se aprendió de las cartolas reales del BCI (julio 2026, cuenta de
 * HomePymes = razón social Asesorías Integrales AYS SpA):
 *  - La descripción es pobre: "TRANSFER DE " + el nombre cortado a 13
 *    letras y SIN RUT; "PAGO CUENTAS VIA INTERNET" (Previred, TGR...) no dice
 *    nada. Por eso hay glosas GENÉRICAS que nunca se convierten en regla.
 *  - Los saldos encadenan fila a fila: sirve para detectar una cartola
 *    incompleta o alterada antes de importarla.
 *
 * Seis tipos de movimiento (decisión del dueño 2026-10-06: la plata de los
 * clientes NO es ingreso de la empresa, va a su propia cuenta corriente):
 *   INGRESO        ingreso de la empresa (honorarios, etc.)
 *   EGRESO         gasto de la empresa
 *   FONDO_RECIBIDO el cliente manda plata para pagar SUS obligaciones
 *   FONDO_PAGADO   la empresa paga por cuenta del cliente (Previred, IVA...)
 *   TRASPASO       entre cuentas de la misma empresa
 *   PRESTAMO       entre empresas del grupo
 *
 * Todo lo sensible (montos, glosas, clasificación, número de cuenta) se
 * guarda cifrado con la llave de la bóveda. Lo que queda en claro es lo
 * mínimo para filtrar: fecha, mes, estado y una huella HMAC (no se puede
 * revertir sin la llave) para no duplicar.
 */

const crypto = require('node:crypto');
const B = require('./finanzasBoveda');
const { leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { errorValidacion, errorForbidden } = require('./errores');

// ---------------------------------------------------------------- catálogos

const EMPRESAS = ['HomePymes', 'Homeconsulting', 'HomePrevise', 'GDE', 'RLD', 'Virtual Base'];
// Nombres con que cada empresa puede aparecer en una glosa (razón social o fantasía).
const NOMBRES_EMPRESA = {
  HomePymes: ['HOMEPYMES', 'ASESORIAS INTEGRALES AYS', 'AYS SPA'],
  Homeconsulting: ['HOMECONSULTING', 'HOME CONSULTING'],
  HomePrevise: ['HOMEPREVISE', 'HOME PREVISE'],
  GDE: ['GDE '],
  RLD: ['RLD '],
  'Virtual Base': ['VIRTUAL BASE']
};
const TIPOS = {
  INGRESO: { nombre: 'Ingreso de la empresa', sentido: 'abono' },
  EGRESO: { nombre: 'Gasto de la empresa', sentido: 'cargo' },
  FONDO_RECIBIDO: { nombre: 'Fondo de cliente recibido', sentido: 'abono', cliente: true },
  FONDO_PAGADO: { nombre: 'Pago por cuenta de cliente', sentido: 'cargo', cliente: true },
  TRASPASO: { nombre: 'Traspaso entre cuentas propias', sentido: '' },
  PRESTAMO: { nombre: 'Préstamo entre empresas', sentido: '', empresa: true }
};
// Plan de cuentas de la planilla SIGECO (hoja CATÁLOGOS), sin cambios.
const CUENTAS = {
  INGRESO: ['Servicio Mensual', 'Servicio Renta', 'Devolución Renta', 'Otros Ingresos'],
  EGRESO: ['Arriendo Mensual', 'Arriendo Reajuste', 'Cuentas Básicas', 'Sueldos', 'Anticipos', 'Finiquitos', 'Imposiciones',
    'Convenios', 'IVA', 'IVA Postergado', 'Renta', 'Multas Clientes', 'Caja Chica', 'Patente Comercial', 'Comisión Banco',
    'Servidores y Sistemas', 'Otros Egresos'],
  FONDO: ['Imposiciones', 'IVA', 'Sueldos', 'Convenios', 'Renta', 'Otro']
};
function cuentasDe_(tipo) {
  if (tipo === 'INGRESO') return CUENTAS.INGRESO;
  if (tipo === 'EGRESO') return CUENTAS.EGRESO;
  if (tipo === 'FONDO_RECIBIDO' || tipo === 'FONDO_PAGADO') return CUENTAS.FONDO;
  return [];
}
// Glosas que no dicen quién es: nunca se vuelven regla (todas se verían iguales).
const GENERICAS = [
  /^PAGO CUENTAS VIA INTERNET$/, /^ABONO POR TRF DESDE OTRO BANCO/, /^TRASPASO FONDOS OTRO BANCO/,
  /^TRANSFERENCIA DE FONDOS AUTOSERVICIO$/, /^CARGO POR TRANSF DE FONDOS AUTOSERVICIO$/, /^DEPOSITO EN EFECTIVO/,
  /^TRANSFER DE (CONSTRUCTORA|CONSTRUCCIONE|CONSTRUCCION|INVERSIONES|SERVICIOS|SOCIEDAD|COMERCIAL|EMPRESA)S?$/
];

// ---------------------------------------------------------------- esquema

let preparada_ = null;
function db_() {
  const d = B.dbFin();
  if (preparada_ === d) return d;
  [
    `CREATE TABLE IF NOT EXISTS FIN_CUENTAS (
       id TEXT PRIMARY KEY, banco TEXT NOT NULL, huella_numero TEXT NOT NULL UNIQUE, datos TEXT NOT NULL,
       ultimos4 TEXT, empresa TEXT NOT NULL, creada_en TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS FIN_IMPORTACIONES (
       id TEXT PRIMARY KEY, cuenta_ref TEXT NOT NULL, ts TEXT NOT NULL, quien TEXT, desde TEXT, hasta TEXT, datos TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS FIN_MOVIMIENTOS (
       id TEXT PRIMARY KEY, cuenta_ref TEXT NOT NULL, fecha TEXT NOT NULL, periodo TEXT NOT NULL, orden INTEGER NOT NULL,
       huella TEXT NOT NULL UNIQUE, estado TEXT NOT NULL, datos TEXT NOT NULL, importacion_id TEXT,
       actualizado_en TEXT, actualizado_por TEXT)`,
    'CREATE INDEX IF NOT EXISTS ix_fin_mov_periodo ON FIN_MOVIMIENTOS (periodo, cuenta_ref, orden)',
    `CREATE TABLE IF NOT EXISTS FIN_REGLAS (
       id TEXT PRIMARY KEY, huella TEXT NOT NULL UNIQUE, datos TEXT NOT NULL, origen TEXT NOT NULL,
       usos INTEGER NOT NULL DEFAULT 0, actualizada_en TEXT NOT NULL)`
  ].forEach((sql) => d.exec(sql));
  preparada_ = d;
  return d;
}

// ---------------------------------------------------------------- utilidades

function hmac_(texto) {
  return crypto.createHmac('sha256', llaveHuella_()).update(String(texto)).digest('hex');
}
// Derivada de la llave de la bóveda: sin ella no se pueden adivinar montos por fuerza bruta.
function llaveHuella_() {
  const k = Buffer.from(String(process.env.SIGSO_FINANZAS_LLAVE || ''), 'base64');
  return crypto.createHash('sha256').update(Buffer.concat([Buffer.from('fin-huella'), k])).digest('hex');
}
const cif_ = (obj) => B.cifrar(JSON.stringify(obj));
const des_ = (txt) => JSON.parse(B.descifrar(txt));
function normalizar_(s) {
  return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9& ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function monto_(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Math.round(v);
  const s = String(v).trim().replace(/\$/g, '').replace(/\s/g, '');
  if (/^-?\d+(\.\d{3})*(,\d+)?$/.test(s)) return Math.round(Number(s.replace(/\./g, '').replace(',', '.')));
  const n = Number(s.replace(',', '.'));
  return isFinite(n) ? Math.round(n) : NaN;
}
function fechaIso_(v) {
  const s = String(v == null ? '' : v).trim();
  let m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 864e5).toISOString().slice(0, 10);
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
}
const texto_ = (v) => String(v == null ? '' : v).trim();
function soloEscritura_(contexto) {
  const lista = String(process.env.SIGSO_FINANZAS_SOLO_LECTURA || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return lista.indexOf(String(contexto.cuenta_id || '').toLowerCase()) !== -1;
}

// ---------------------------------------------------------------- lectura de la cartola

/**
 * Lee una cartola a partir de sus filas (lo que entrega lector-xlsx.js:
 * arreglos de celdas de texto). Hoy reconoce el formato del BCI ("Cartola de
 * cuenta corriente" en Excel). Devuelve { error } si no la reconoce.
 */
function leerCartola(filas) {
  filas = Array.isArray(filas) ? filas : [];
  const celdas = (f) => Array.from(Array.isArray(f) ? f : [], texto_); // Array.from: las filas vienen con huecos
  const valorJunto = (f, etiqueta) => {
    const c = celdas(f); const i = c.findIndex((x) => normalizar_(x) === normalizar_(etiqueta));
    if (i === -1) return '';
    for (let k = i + 1; k < c.length; k++) if (c[k]) return c[k];
    return '';
  };
  let titular = '', numero = '', periodo = '';
  let iCab = -1, col = null, resumen = null;
  for (let i = 0; i < filas.length; i++) {
    const c = celdas(filas[i]);
    const n = c.map(normalizar_);
    if (n[0] === 'EMPRESA') { titular = valorJunto(filas[i], 'Empresa'); }
    if (n[0] === 'N DE CUENTA' || n[0] === 'NO DE CUENTA' || n[0] === 'N DE CTA') { numero = valorJunto(filas[i], c[0]); periodo = periodo || valorJunto(filas[i], 'Periodo'); }
    if (n.indexOf('SALDO ANTERIOR') !== -1 && !resumen) {
      const sig = celdas(filas[i + 1]);
      const at = (et) => sig[n.findIndex((x) => x.indexOf(et) === 0)];
      resumen = {
        saldo_anterior: monto_(at('SALDO ANTERIOR')), total_cargos: monto_(at('TOTAL CARGOS')),
        total_abonos: monto_(at('TOTAL ABONOS')), saldo_final: monto_(at('SALDO CONTABLE'))
      };
      if (!periodo) periodo = sig[0] || '';
    }
    if (n[0] === 'FECHA' && n.indexOf('DESCRIPCION') !== -1 && n.some((x) => x.indexOf('SALDO') === 0)) {
      iCab = i;
      col = {
        fecha: 0, glosa: n.indexOf('DESCRIPCION'), doc: n.findIndex((x) => x.indexOf('N DOCUMENTO') === 0 || x.indexOf('NO DOCUMENTO') === 0),
        cargo: n.findIndex((x) => x.indexOf('CHEQUES') === 0 || x.indexOf('CARGOS') === 0),
        abono: n.findIndex((x) => x.indexOf('DEPOSITOS') === 0 || x.indexOf('ABONOS') === 0),
        saldo: n.findIndex((x) => x.indexOf('SALDO') === 0)
      };
      break;
    }
  }
  if (iCab === -1 || col.glosa === -1 || col.saldo === -1) {
    return { error: 'No reconozco el formato de este archivo. Por ahora se lee la cartola en Excel del BCI («Cartola de cuenta corriente»).' };
  }
  if (!numero) return { error: 'La cartola no trae el número de cuenta.' };
  const movimientos = [];
  for (let i = iCab + 1; i < filas.length; i++) {
    const c = celdas(filas[i]);
    const fecha = fechaIso_(c[col.fecha]);
    if (!fecha) continue;
    const cargo = monto_(c[col.cargo]), abono = monto_(c[col.abono]), saldo = monto_(c[col.saldo]);
    if ([cargo, abono, saldo].some((x) => isNaN(x))) return { error: 'La fila ' + (i + 1) + ' tiene un monto que no se entiende.' };
    movimientos.push({ fila: i + 1, fecha, glosa: c[col.glosa].replace(/\s+/g, ' '), doc: col.doc >= 0 ? c[col.doc] : '', cargo, abono, saldo });
  }
  const pm = /(\d{2}-\d{2}-\d{4}).*?(\d{2}-\d{2}-\d{4})/.exec(periodo) || [];
  const desde = fechaIso_(pm[1] || '') || (movimientos[0] && movimientos[0].fecha) || '';
  const hasta = fechaIso_(pm[2] || '') || (movimientos.length && movimientos[movimientos.length - 1].fecha) || '';

  // Chequeos: cada saldo diario = el anterior - cargo + abono; y el resumen del banco.
  const errores = [];
  let previo = resumen ? resumen.saldo_anterior : null;
  movimientos.forEach((m) => {
    if (previo !== null && previo - m.cargo + m.abono !== m.saldo) errores.push('Fila ' + m.fila + ': el saldo no sigue del anterior.');
    previo = m.saldo;
  });
  const sumC = movimientos.reduce((s, m) => s + m.cargo, 0), sumA = movimientos.reduce((s, m) => s + m.abono, 0);
  if (resumen) {
    if (resumen.saldo_anterior - resumen.total_cargos + resumen.total_abonos !== resumen.saldo_final) errores.push('El resumen del banco no cuadra.');
    if (sumC !== resumen.total_cargos || sumA !== resumen.total_abonos) errores.push('Los movimientos no suman lo que dice el resumen del banco (faltan o sobran filas).');
  }
  return {
    banco: 'BCI', titular, numero: numero.replace(/\D/g, ''), desde, hasta,
    saldo_anterior: resumen ? resumen.saldo_anterior : null, saldo_final: resumen ? resumen.saldo_final : (movimientos.length ? movimientos[movimientos.length - 1].saldo : null),
    total_cargos: sumC, total_abonos: sumA, movimientos, cuadra: errores.length === 0, errores: errores.slice(0, 10)
  };
}

// ---------------------------------------------------------------- clientes de SIGSO

function clientes_(db) {
  try {
    return leerFilas_(db, 'CAT_CLIENTES', COLUMNAS.CAT_CLIENTES)
      .filter((c) => c.cliente_id && c.razon_social && !(c.activo === false || c.activo === 'FALSE'))
      .map((c) => ({ id: String(c.cliente_id), nombre: String(c.razon_social).trim(), rut: String(c.rut || ''), n: normalizar_(c.razon_social) }));
  } catch (e) { return []; }
}
function nombreEnGlosa_(glosa) {
  const m = /^(?:TRANSFER DE|TRANSFERENCIA DE|ABONO TERCEROS\s+[\dKk.-]+)\s+(.+)$/i.exec(glosa);
  return m ? normalizar_(m[1]) : '';
}

// ---------------------------------------------------------------- sugerencias

function empresaEnGlosa_(glosa) {
  const g = ' ' + normalizar_(glosa) + ' ';
  return EMPRESAS.find((e) => NOMBRES_EMPRESA[e].some((n) => g.indexOf(' ' + normalizar_(n) + (n.endsWith(' ') ? ' ' : '')) !== -1)) || '';
}
function esGenerica_(glosa) { const g = normalizar_(glosa); return GENERICAS.some((re) => re.test(g)); }
function huellaGlosa_(glosa) { return hmac_('glosa|' + normalizar_(glosa)); }
// El BCI corta el nombre a 13 letras: «TRANSFER DE ENFIERRADURA» calza con 11
// clientes. Una regla así nunca es "segura": queda como propuesta a revisar.
function ambigua_(glosa, clientes) {
  const nombre = nombreEnGlosa_(glosa);
  return !!nombre && clientes.filter((c) => c.n.indexOf(nombre) === 0).length > 1;
}

/** Sugerencia para un movimiento: { tipo, cuenta, cliente_id, cliente, empresa, certeza: alta|media|baja, motivo } */
function sugerir_(m, ctx) {
  const sentido = m.abono > 0 ? 'abono' : 'cargo';
  const base = { tipo: '', cuenta: '', cliente_id: '', cliente: '', empresa: '', nota: '', certeza: 'baja', motivo: '' };
  const g = normalizar_(m.glosa);
  // 1) Regla aprendida para esta glosa exacta.
  const regla = ctx.reglas.get(huellaGlosa_(m.glosa));
  if (regla && (!TIPOS[regla.tipo] || !TIPOS[regla.tipo].sentido || TIPOS[regla.tipo].sentido === sentido)) {
    const segura = regla.origen === 'persona' && !regla.ambigua;
    return Object.assign(base, regla, {
      certeza: segura ? 'alta' : 'media',
      motivo: regla.ambigua ? 'Antes fue ' + (regla.cliente || 'así') + ', pero hay varios clientes con ese nombre corto: revisa'
        : regla.origen === 'persona' ? 'Así se clasificó antes' : 'Aprendido de la planilla SIGECO'
    });
  }
  // 2) Reglas fijas.
  if (/^COMISION|^IMPUESTO|^INTERES|MANTENCION/.test(g) && sentido === 'cargo') return Object.assign(base, { tipo: 'EGRESO', cuenta: 'Comisión Banco', certeza: 'alta', motivo: 'Cobro del banco' });
  const emp = empresaEnGlosa_(m.glosa);
  if (emp && emp === ctx.empresa) return Object.assign(base, { tipo: 'TRASPASO', certeza: 'alta', motivo: 'Viene de otra cuenta de ' + emp });
  if (emp) return Object.assign(base, { tipo: 'PRESTAMO', empresa: emp, certeza: 'media', motivo: 'Movimiento con ' + emp });
  // 3) Cliente por el nombre (el BCI lo corta a 13 letras).
  const nombre = nombreEnGlosa_(m.glosa);
  if (nombre && !esGenerica_(m.glosa)) {
    const cand = ctx.clientes.filter((c) => c.n.indexOf(nombre) === 0);
    if (cand.length === 1) {
      const previo = ctx.tipoPorCliente.get(cand[0].id);
      return Object.assign(base, {
        cliente_id: cand[0].id, cliente: cand[0].nombre, tipo: previo && TIPOS[previo.tipo].sentido === sentido ? previo.tipo : '',
        cuenta: previo && TIPOS[previo.tipo].sentido === sentido ? previo.cuenta : '',
        certeza: 'media', motivo: 'El nombre calza con un cliente' + (previo ? '; se usa lo de la última vez' : '; falta decir si es honorario o fondo')
      });
    }
    if (cand.length > 1) base.motivo = cand.length + ' clientes empiezan con «' + nombre + '»';
  }
  // 4) Ingreso sin nombre (o ambiguo) que calza exacto con UNA factura abierta.
  if (sentido === 'abono' && ctx.facturasPorMonto) {
    const f = ctx.facturasPorMonto.get(m.abono);
    if (f && f.length === 1) {
      return Object.assign(base, { tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: f[0].cliente_id, cliente: f[0].cliente,
        certeza: 'media', motivo: 'Calza exacto con lo que falta de la factura N° ' + f[0].folio + ' de ' + f[0].cliente });
    }
  }
  if (/^PAGO CUENTAS/.test(g)) return Object.assign(base, { tipo: 'FONDO_PAGADO', certeza: 'baja', motivo: 'El banco no dice qué se pagó (Previred, TGR…) ni de quién' });
  if (base.motivo) return base; // nombre corto que calza con varios clientes
  if (/^DEPOSITO EN EFECTIVO/.test(g)) return Object.assign(base, { motivo: 'Depósito en efectivo: el banco no dice de quién' });
  return Object.assign(base, { motivo: 'El banco no dice quién es' });
}
function completa_(c, sentido) {
  const t = TIPOS[c.tipo];
  if (!t) return false;
  if (t.sentido && t.sentido !== sentido) return false;
  if (t.cliente && !c.cliente_id) return false;
  if (t.empresa && !c.empresa) return false;
  if (cuentasDe_(c.tipo).length && cuentasDe_(c.tipo).indexOf(c.cuenta) === -1) return false;
  return true;
}
function contextoSugerencias_(db, empresa) {
  const d = db_();
  const reglas = new Map();
  d.prepare('SELECT huella, datos, origen FROM FIN_REGLAS').all().forEach((r) => reglas.set(r.huella, Object.assign(des_(r.datos).clasif, { origen: r.origen })));
  // Último tipo confirmado por cliente (para "lo de la última vez").
  const tipoPorCliente = new Map();
  d.prepare("SELECT datos FROM FIN_MOVIMIENTOS WHERE estado = 'CONFIRMADO' ORDER BY fecha, orden").all().forEach((r) => {
    const c = des_(r.datos).clasif;
    if (c && c.cliente_id) tipoPorCliente.set(c.cliente_id, { tipo: c.tipo, cuenta: c.cuenta });
  });
  let facturasPorMonto = null;
  try { facturasPorMonto = require('./finanzasCobranza').facturasPorMonto_(db); } catch (e) { facturasPorMonto = null; }
  return { reglas, tipoPorCliente, clientes: clientes_(db), empresa, facturasPorMonto };
}

// ---------------------------------------------------------------- cuentas

function cuentaPorNumero_(numero) {
  const r = db_().prepare('SELECT * FROM FIN_CUENTAS WHERE huella_numero = ?').get(hmac_('cuenta|' + numero));
  return r ? publicaCuenta_(r) : null;
}
function publicaCuenta_(r) {
  const d = des_(r.datos);
  return { id: r.id, banco: r.banco, ultimos4: r.ultimos4, empresa: r.empresa, titular: d.titular, numero: d.numero };
}

// ---------------------------------------------------------------- acciones

const catalogo = B.conBoveda('', function (db) {
  return {
    empresas: EMPRESAS,
    // Repartos de gastos compartidos (SIGECO: CONFIG.EMPRESAS_PRORRATEO; Virtual Base paga y no se carga).
    repartos: [
      { id: 'sigeco', nombre: 'Partes iguales: GDE, HomePymes, HomePrevise y RLD', empresas: ['GDE', 'HomePymes', 'HomePrevise', 'RLD'] },
      { id: 'todas', nombre: 'Partes iguales entre las 6 empresas', empresas: EMPRESAS.slice() }
    ],
    tipos: Object.keys(TIPOS).map((k) => ({ id: k, nombre: TIPOS[k].nombre, sentido: TIPOS[k].sentido, cliente: !!TIPOS[k].cliente, empresa: !!TIPOS[k].empresa, cuentas: cuentasDe_(k) })),
    clientes: clientes_(db).map((c) => ({ id: c.id, nombre: c.nombre, rut: c.rut })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  };
});

/** Revisa una cartola SIN guardar nada: qué cuenta es, si cuadra, cuántas filas son nuevas. */
const revisarCartola = B.conBoveda('', function (db, data) {
  const c = leerCartola(data && data.filas);
  if (c.error) return errorValidacion('archivo', c.error);
  const cuenta = cuentaPorNumero_(c.numero);
  const d = db_();
  let nuevas = 0;
  const huella = (m) => hmac_(['mov', c.numero, m.fecha, m.doc, m.cargo, m.abono, m.saldo].join('|'));
  c.movimientos.forEach((m) => { if (!d.prepare('SELECT 1 FROM FIN_MOVIMIENTOS WHERE huella = ?').get(huella(m))) nuevas++; });
  const ctx = contextoSugerencias_(db, cuenta ? cuenta.empresa : 'HomePymes');
  const certezas = { alta: 0, media: 0, baja: 0 };
  c.movimientos.forEach((m) => { const s = sugerir_(m, ctx); certezas[completa_(s, m.abono > 0 ? 'abono' : 'cargo') && s.certeza === 'alta' ? 'alta' : s.certeza === 'baja' ? 'baja' : 'media']++; });
  return {
    banco: c.banco, titular: c.titular, ultimos4: c.numero.slice(-4), desde: c.desde, hasta: c.hasta,
    saldo_anterior: c.saldo_anterior, saldo_final: c.saldo_final, total_cargos: c.total_cargos, total_abonos: c.total_abonos,
    cuadra: c.cuadra, errores: c.errores, movimientos: c.movimientos.length, nuevas, repetidas: c.movimientos.length - nuevas,
    cuenta_conocida: cuenta ? { empresa: cuenta.empresa, banco: cuenta.banco } : null, certezas
  };
});

/** Guarda la cartola: crea la cuenta si es nueva (con su empresa) y agrega solo lo que no estaba. */
const importarCartola = B.conBoveda('', function (db, data, contexto, x) {
  if (soloEscritura_(contexto)) return errorForbidden('Tu acceso a Finanzas es de solo lectura.');
  const c = leerCartola(data && data.filas);
  if (c.error) return errorValidacion('archivo', c.error);
  if (!c.cuadra && !(data && data.aceptar_descuadre)) return errorValidacion('archivo', 'La cartola no cuadra: ' + c.errores[0]);
  const d = db_();
  let cuenta = cuentaPorNumero_(c.numero);
  if (!cuenta) {
    const empresa = texto_(data && data.empresa);
    if (EMPRESAS.indexOf(empresa) === -1) return errorValidacion('empresa', 'Elige a qué empresa pertenece esta cuenta.');
    const id = crypto.randomUUID();
    d.prepare('INSERT INTO FIN_CUENTAS (id, banco, huella_numero, datos, ultimos4, empresa, creada_en) VALUES (?,?,?,?,?,?,?)')
      .run(id, c.banco, hmac_('cuenta|' + c.numero), cif_({ numero: c.numero, titular: c.titular }), c.numero.slice(-4), empresa, new Date().toISOString());
    cuenta = cuentaPorNumero_(c.numero);
    x.registrar('CUENTA_NUEVA', c.banco + ' ···' + c.numero.slice(-4) + ' → ' + empresa);
  }
  const ctx = contextoSugerencias_(db, cuenta.empresa);
  const impId = crypto.randomUUID();
  const ahora = new Date().toISOString();
  const base = d.prepare('SELECT COALESCE(MAX(orden), 0) AS n FROM FIN_MOVIMIENTOS').get().n;
  let nuevas = 0;
  const ins = d.prepare('INSERT OR IGNORE INTO FIN_MOVIMIENTOS (id, cuenta_ref, fecha, periodo, orden, huella, estado, datos, importacion_id, actualizado_en, actualizado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  d.exec('BEGIN');
  try {
    c.movimientos.forEach((m, i) => {
      const s = sugerir_(m, ctx);
      const r = ins.run(crypto.randomUUID(), cuenta.id, m.fecha, m.fecha.slice(0, 7), base + i + 1,
        hmac_(['mov', c.numero, m.fecha, m.doc, m.cargo, m.abono, m.saldo].join('|')), 'PENDIENTE',
        cif_({ glosa: m.glosa, doc: m.doc, cargo: m.cargo, abono: m.abono, saldo: m.saldo, sugerencia: s, clasif: null }),
        impId, ahora, x.nombre);
      if (r.changes) nuevas++;
    });
    d.prepare('INSERT INTO FIN_IMPORTACIONES (id, cuenta_ref, ts, quien, desde, hasta, datos) VALUES (?,?,?,?,?,?,?)')
      .run(impId, cuenta.id, ahora, x.nombre, c.desde, c.hasta, cif_({ archivo: texto_(data && data.nombre_archivo).slice(0, 120), saldo_anterior: c.saldo_anterior, saldo_final: c.saldo_final, movimientos: c.movimientos.length, nuevas, cuadra: c.cuadra }));
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
  x.registrar('IMPORTAR_CARTOLA', c.banco + ' ···' + c.numero.slice(-4) + ' ' + c.desde + ' a ' + c.hasta + ': ' + nuevas + ' nuevos de ' + c.movimientos.length);
  return { cuenta: { empresa: cuenta.empresa, banco: cuenta.banco, ultimos4: cuenta.ultimos4 }, nuevas, repetidas: c.movimientos.length - nuevas, periodo: c.desde.slice(0, 7) };
});

function movimientoPublico_(r, cuentas) {
  const d = des_(r.datos);
  const cu = cuentas.get(r.cuenta_ref) || {};
  return {
    id: r.id, fecha: r.fecha, estado: r.estado, glosa: d.glosa, doc: d.doc, cargo: d.cargo, abono: d.abono, saldo: d.saldo,
    cuenta: { banco: cu.banco, ultimos4: cu.ultimos4, empresa: cu.empresa }, sugerencia: d.sugerencia, clasif: d.clasif,
    actualizado_por: r.actualizado_por, actualizado_en: r.actualizado_en
  };
}
function cuentasMapa_() {
  const m = new Map();
  db_().prepare('SELECT * FROM FIN_CUENTAS').all().forEach((r) => m.set(r.id, publicaCuenta_(r)));
  return m;
}

/** Movimientos de un mes (y de una cuenta, opcional), con su resumen. */
const movimientos = B.conBoveda('', function (db, data, contexto, x) {
  const d = db_();
  const periodo = /^\d{4}-\d{2}$/.test(texto_(data && data.periodo)) ? data.periodo : '';
  const periodos = d.prepare('SELECT periodo, COUNT(*) AS n, SUM(estado = \'PENDIENTE\') AS pendientes FROM FIN_MOVIMIENTOS GROUP BY periodo ORDER BY periodo DESC').all();
  const elegido = periodo || (periodos[0] && periodos[0].periodo) || '';
  const cuentas = cuentasMapa_();
  let filas = elegido ? d.prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE periodo = ? ORDER BY fecha, orden').all(elegido) : [];
  if (data && data.cuenta) filas = filas.filter((r) => r.cuenta_ref === data.cuenta);
  const lista = filas.map((r) => movimientoPublico_(r, cuentas));
  x.registrar('VER_MOVIMIENTOS', elegido);
  return { periodo: elegido, periodos, cuentas: [...cuentas.values()].map((c) => ({ id: c.id, banco: c.banco, ultimos4: c.ultimos4, empresa: c.empresa })), movimientos: lista, resumen: resumir_(lista) };
});

function resumir_(lista) {
  const r = { INGRESO: 0, EGRESO: 0, FONDO_RECIBIDO: 0, FONDO_PAGADO: 0, TRASPASO_ENTRA: 0, TRASPASO_SALE: 0, PRESTAMO_ENTRA: 0, PRESTAMO_SALE: 0, pendientes: 0, pendiente_monto: 0, confirmados: 0, total: lista.length };
  lista.forEach((m) => {
    const c = m.clasif;
    if (!c || m.estado !== 'CONFIRMADO') { r.pendientes++; r.pendiente_monto += m.abono || m.cargo; return; }
    r.confirmados++;
    if (c.tipo === 'TRASPASO' || c.tipo === 'PRESTAMO') r[c.tipo + (m.abono ? '_ENTRA' : '_SALE')] += m.abono || m.cargo;
    else r[c.tipo] += m.abono || m.cargo;
  });
  return r;
}

function validarClasif_(c, mov) {
  const sentido = mov.abono > 0 ? 'abono' : 'cargo';
  const t = TIPOS[c.tipo];
  if (!t) return 'Elige qué tipo de movimiento es.';
  if (t.sentido && t.sentido !== sentido) return t.nombre + (sentido === 'abono' ? ' no puede ser plata que entra.' : ' no puede ser plata que sale.');
  if (t.cliente && !c.cliente_id) return 'Elige de qué cliente es.';
  if (t.empresa && EMPRESAS.indexOf(c.empresa) === -1) return 'Elige con qué empresa del grupo.';
  if (cuentasDe_(c.tipo).length && cuentasDe_(c.tipo).indexOf(c.cuenta) === -1) return 'Elige la cuenta o el concepto.';
  return '';
}

/**
 * Confirma o corrige la clasificación de uno o varios movimientos.
 * items: [{ id, tipo, cuenta, cliente_id, empresa, nota, recordar }]
 * Con `recordar` (por defecto sí), la glosa queda como regla, salvo que sea genérica.
 */
const clasificar = B.conBoveda('', function (db, data, contexto, x) {
  if (soloEscritura_(contexto)) return errorForbidden('Tu acceso a Finanzas es de solo lectura.');
  const items = Array.isArray(data && data.items) ? data.items.slice(0, 500) : [];
  if (!items.length) return errorValidacion('items', 'No hay movimientos para guardar.');
  const d = db_();
  const listaClientes = clientes_(db);
  const clientes = new Map(listaClientes.map((c) => [c.id, c.nombre]));
  const errores = [];
  const ahora = new Date().toISOString();
  let hechos = 0, reglas = 0;
  d.exec('BEGIN');
  try {
    items.forEach((it) => {
      const r = d.prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE id = ?').get(texto_(it.id));
      if (!r) { errores.push({ id: it.id, mensaje: 'No existe.' }); return; }
      const datos = des_(r.datos);
      const c = {
        tipo: texto_(it.tipo), cuenta: texto_(it.cuenta), cliente_id: texto_(it.cliente_id), empresa: texto_(it.empresa), nota: texto_(it.nota).slice(0, 300)
      };
      if (c.cliente_id && !clientes.has(c.cliente_id)) { errores.push({ id: it.id, mensaje: 'Ese cliente no existe en SIGSO.' }); return; }
      c.cliente = c.cliente_id ? clientes.get(c.cliente_id) : '';
      if (!TIPOS[c.tipo] || !TIPOS[c.tipo].cliente) { if (c.tipo !== 'INGRESO') { c.cliente_id = ''; c.cliente = ''; } }
      if (!TIPOS[c.tipo] || !TIPOS[c.tipo].empresa) c.empresa = '';
      if (!cuentasDe_(c.tipo).length) c.cuenta = '';
      // Etapa 5: un gasto de la empresa puede repartirse en partes iguales entre
      // varias empresas del grupo (arriendo, internet, aseo: el GASTOS
      // COMPARTIDOS de SIGECO). Solo EGRESO y con 2 o más empresas.
      const reparto = Array.isArray(it.reparto) ? [...new Set(it.reparto.map(texto_))].filter((e) => EMPRESAS.indexOf(e) !== -1) : [];
      if (c.tipo === 'EGRESO' && reparto.length >= 2) c.reparto = reparto;
      const err = validarClasif_(c, datos);
      if (err) { errores.push({ id: it.id, mensaje: err }); return; }
      datos.clasif = c;
      d.prepare("UPDATE FIN_MOVIMIENTOS SET estado = 'CONFIRMADO', datos = ?, actualizado_en = ?, actualizado_por = ? WHERE id = ?")
        .run(cif_(datos), ahora, x.nombre, r.id);
      hechos++;
      if (it.recordar !== false && !esGenerica_(datos.glosa)) {
        const h = huellaGlosa_(datos.glosa);
        const regla = { glosa: datos.glosa, clasif: { tipo: c.tipo, cuenta: c.cuenta, cliente_id: c.cliente_id, cliente: c.cliente, empresa: c.empresa, reparto: c.reparto, ambigua: ambigua_(datos.glosa, listaClientes) } };
        d.prepare("INSERT INTO FIN_REGLAS (id, huella, datos, origen, usos, actualizada_en) VALUES (?,?,?,'persona',1,?) " +
          "ON CONFLICT(huella) DO UPDATE SET datos = excluded.datos, origen = 'persona', usos = usos + 1, actualizada_en = excluded.actualizada_en")
          .run(crypto.randomUUID(), h, cif_(regla), ahora);
        reglas++;
      }
    });
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
  if (hechos) x.registrar('CLASIFICAR', hechos + ' movimiento(s)');
  if (hechos) resugerirPendientes_(db);
  return { hechos, reglas, errores };
});

// Con reglas nuevas, los pendientes de toda la bóveda se vuelven a sugerir.
function resugerirPendientes_(db) {
  const d = db_();
  const cuentas = cuentasMapa_();
  const porEmpresa = {};
  d.prepare("SELECT id, cuenta_ref, datos FROM FIN_MOVIMIENTOS WHERE estado = 'PENDIENTE'").all().forEach((r) => {
    const emp = (cuentas.get(r.cuenta_ref) || {}).empresa || 'HomePymes';
    const ctx = porEmpresa[emp] || (porEmpresa[emp] = contextoSugerencias_(db, emp));
    const datos = des_(r.datos);
    datos.sugerencia = sugerir_(datos, ctx);
    d.prepare('UPDATE FIN_MOVIMIENTOS SET datos = ? WHERE id = ?').run(cif_(datos), r.id);
  });
}

/** Confirma de una vez todo lo que tiene sugerencia de certeza alta y completa. */
const confirmarSugeridas = B.conBoveda('', function (db, data, contexto, x) {
  if (soloEscritura_(contexto)) return errorForbidden('Tu acceso a Finanzas es de solo lectura.');
  const periodo = texto_(data && data.periodo);
  const filas = db_().prepare("SELECT * FROM FIN_MOVIMIENTOS WHERE estado = 'PENDIENTE' AND periodo = ?").all(periodo);
  const items = [];
  filas.forEach((r) => {
    const d = des_(r.datos); const s = d.sugerencia || {};
    if (s.certeza === 'alta' && completa_(s, d.abono > 0 ? 'abono' : 'cargo')) items.push({ id: r.id, tipo: s.tipo, cuenta: s.cuenta, cliente_id: s.cliente_id, empresa: s.empresa, reparto: s.reparto, recordar: false });
  });
  if (!items.length) return { hechos: 0, reglas: 0, errores: [] };
  return clasificar(db, Object.assign({}, data, { items }), contexto);
});

/**
 * Aprender de la planilla SIGECO: la hoja CUENTA BANCARIA tiene lo que
 * Bárbara y Lisseth clasificaron a mano. Cada fila se empareja con un
 * movimiento ya importado (misma empresa, mismo monto y sentido, ±3 días) y
 * su cliente queda como SUGERENCIA (nunca se confirma sola). Las glosas que
 * siempre fueron del mismo cliente quedan como reglas "de la planilla".
 */
const aprenderPlanilla = B.conBoveda('', function (db, data, contexto, x) {
  if (soloEscritura_(contexto)) return errorForbidden('Tu acceso a Finanzas es de solo lectura.');
  const filas = Array.isArray(data && data.filas) ? data.filas : [];
  const cab = (filas[0] || []).map(normalizar_);
  const ix = (n) => cab.indexOf(n);
  const C = { fecha: ix('FECHA'), banco: ix('BANCO'), empresa: ix('EMPRESA'), cliente: ix('CLIENTE GLOSA'), detalle: ix('DETALLE'), ingreso: ix('INGRESO'), egreso: ix('EGRESO'), origen: ix('ORIGEN') };
  if (C.fecha === -1 || C.ingreso === -1 || C.egreso === -1 || C.cliente === -1) return errorValidacion('archivo', 'No encuentro la hoja CUENTA BANCARIA de la planilla SIGECO.');
  const clientes = clientes_(db);
  const porNombre = new Map(clientes.map((c) => [c.n, c]));
  const d = db_();
  const cuentas = cuentasMapa_();
  const pendientes = d.prepare("SELECT * FROM FIN_MOVIMIENTOS WHERE estado = 'PENDIENTE'").all().map((r) => ({ r, d: des_(r.datos), emp: (cuentas.get(r.cuenta_ref) || {}).empresa, banco: (cuentas.get(r.cuenta_ref) || {}).banco }));
  const usados = new Set();
  const porGlosa = new Map();
  let emparejados = 0, conCliente = 0;
  filas.slice(1).forEach((f) => {
    f = (f || []).map(texto_);
    const fecha = fechaIso_(f[C.fecha]);
    const ing = monto_(f[C.ingreso]), egr = monto_(f[C.egreso]);
    if (!fecha || !(ing > 0 || egr > 0)) return;
    let emp = f[C.empresa]; if (/^HomePymes/i.test(emp)) emp = 'HomePymes';
    const t0 = Date.parse(fecha);
    const p = pendientes.find((m) => !usados.has(m.r.id) && m.emp === emp && (!f[C.banco] || normalizar_(m.banco) === normalizar_(f[C.banco])) &&
      (ing > 0 ? m.d.abono === ing : m.d.cargo === egr) && Math.abs(Date.parse(m.r.fecha) - t0) <= 3 * 864e5);
    if (!p) return;
    usados.add(p.r.id); emparejados++;
    const cli = porNombre.get(normalizar_(f[C.cliente])) || clientes.find((c) => normalizar_(f[C.cliente]).length >= 8 && c.n.indexOf(normalizar_(f[C.cliente])) === 0);
    const det = f[C.detalle];
    const tipo = !cli ? '' : (ing > 0 ? (/abono/i.test(f[C.origen]) ? 'INGRESO' : 'FONDO_RECIBIDO') : 'FONDO_PAGADO');
    const cuenta = tipo === 'INGRESO' ? 'Servicio Mensual' : tipo ? (/\bIVA\b/i.test(det) ? 'IVA' : 'Imposiciones') : '';
    const s = Object.assign({ tipo: '', cuenta: '', cliente_id: '', cliente: '', empresa: '' }, p.d.sugerencia, {
      nota: det, certeza: 'media', motivo: 'Así quedó en la planilla SIGECO' + (cli ? '' : ' (sin cliente reconocido)')
    });
    if (cli) { s.cliente_id = cli.id; s.cliente = cli.nombre; s.tipo = tipo; s.cuenta = cuenta; conCliente++; }
    p.d.sugerencia = s;
    d.prepare('UPDATE FIN_MOVIMIENTOS SET datos = ? WHERE id = ?').run(cif_(p.d), p.r.id);
    if (cli && !esGenerica_(p.d.glosa)) {
      const h = huellaGlosa_(p.d.glosa);
      const g = porGlosa.get(h) || { glosa: p.d.glosa, ids: new Set(), clasif: { tipo, cuenta, cliente_id: cli.id, cliente: cli.nombre, empresa: '', ambigua: ambigua_(p.d.glosa, clientes) } };
      g.ids.add(cli.id); porGlosa.set(h, g);
    }
  });
  let reglas = 0;
  const ahora = new Date().toISOString();
  porGlosa.forEach((g, h) => {
    if (g.ids.size !== 1) return; // la misma glosa fue de clientes distintos: no sirve como regla
    const r = d.prepare("INSERT INTO FIN_REGLAS (id, huella, datos, origen, usos, actualizada_en) VALUES (?,?,?,'planilla',0,?) ON CONFLICT(huella) DO NOTHING")
      .run(crypto.randomUUID(), h, cif_({ glosa: g.glosa, clasif: g.clasif }), ahora);
    reglas += r.changes;
  });
  x.registrar('APRENDER_PLANILLA', emparejados + ' movimientos emparejados, ' + reglas + ' reglas');
  return { emparejados, con_cliente: conCliente, reglas, filas_planilla: filas.length - 1 };
});

/** Resumen de los bancos y la cuenta corriente de fondos por cliente (para el inicio de la bóveda). */
const resumenBancos = B.conBoveda('', function () {
  const d = db_();
  const cuentas = cuentasMapa_();
  const ultimos = d.prepare('SELECT cuenta_ref, MAX(fecha) AS hasta FROM FIN_MOVIMIENTOS GROUP BY cuenta_ref').all();
  const lista = [...cuentas.values()].map((c) => {
    const u = ultimos.find((x) => x.cuenta_ref === c.id);
    const ult = d.prepare('SELECT datos FROM FIN_MOVIMIENTOS WHERE cuenta_ref = ? ORDER BY fecha DESC, orden DESC LIMIT 1').get(c.id);
    return { id: c.id, banco: c.banco, ultimos4: c.ultimos4, empresa: c.empresa, hasta: u ? u.hasta : '', saldo: ult ? des_(ult.datos).saldo : null };
  });
  const fondos = new Map();
  d.prepare("SELECT datos FROM FIN_MOVIMIENTOS WHERE estado = 'CONFIRMADO'").all().forEach((r) => {
    const m = des_(r.datos), c = m.clasif;
    if (!c || (c.tipo !== 'FONDO_RECIBIDO' && c.tipo !== 'FONDO_PAGADO')) return;
    const f = fondos.get(c.cliente_id) || { cliente_id: c.cliente_id, cliente: c.cliente, recibido: 0, pagado: 0 };
    if (c.tipo === 'FONDO_RECIBIDO') f.recibido += m.abono; else f.pagado += m.cargo;
    fondos.set(c.cliente_id, f);
  });
  const pendientes = d.prepare("SELECT COUNT(*) AS n FROM FIN_MOVIMIENTOS WHERE estado = 'PENDIENTE'").get().n;
  const reglas = d.prepare('SELECT COUNT(*) AS n FROM FIN_REGLAS').get().n;
  return {
    cuentas: lista, pendientes, reglas,
    fondos: [...fondos.values()].map((f) => Object.assign(f, { saldo: f.recibido - f.pagado })).sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo))
  };
});

module.exports = {
  catalogo, revisarCartola, importarCartola, movimientos, clasificar, confirmarSugeridas, aprenderPlanilla, resumenBancos,
  // pruebas
  leerCartola, sugerir_, esGenerica_, monto_, EMPRESAS, TIPOS,
  // compartido con finanzasCobranza.js
  interno: { db_, des_: (t) => des_(t), cif_: (o) => cif_(o), hmac_: (t) => hmac_(t), normalizar_, clientes_, fechaIso_, soloEscritura_, cuentasMapa_ }
};
