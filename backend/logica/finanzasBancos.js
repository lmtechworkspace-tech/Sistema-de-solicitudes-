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
const { errorValidacion } = require('./errores');
const Base = require('./finanzasBase');
const Cat = require('./finanzasCatalogos');

// ---------------------------------------------------------------- catálogos

// Semilla histórica. La lista vigente vive en FIN_CATALOGO (finanzasCatalogos.js):
// usar Cat.empresas_() para validar.
const EMPRESAS = ['HomePymes', 'Homeconsulting', 'HomePrevise', 'GDE', 'RLD', 'Virtual Base'];
// Nombres con que cada empresa puede aparecer en una glosa (razón social o fantasía).
const NOMBRES_EMPRESA = {
  HomePymes: ['HOMEPYMES', 'ASESORIAS INTEGRALES AYS', 'AYS SPA'],
  Homeconsulting: ['HOMECONSULTING', 'HOME CONSULTING'],
  HomePrevise: ['HOMEPREVISE', 'HOME PREVISE'],
  GDE: ['GDE '],
  RLD: ['RLD '],
  'Virtual Base': ['VIRTUAL BASE', 'VIRTUAL BAAS']
};
const TIPOS = {
  INGRESO: { nombre: 'Ingreso de la empresa', sentido: 'abono' },
  EGRESO: { nombre: 'Gasto de la empresa', sentido: 'cargo' },
  // v2 (FIN-15/16): subtipos dentro del mismo sentido y titularidad. Una devolución
  // al cliente sale de sus fondos pero no es el pago de una obligación; un
  // reintegro (lo que vuelve, p. ej. de Previred) entra a sus fondos.
  FONDO_RECIBIDO: { nombre: 'Fondo de cliente recibido', sentido: 'abono', cliente: true, subtipos: { RECEPCION: 'Recepción de fondos', REINTEGRO: 'Reintegro (vuelve dinero de un pago)' } },
  FONDO_PAGADO: { nombre: 'Pago por cuenta de cliente', sentido: 'cargo', cliente: true, subtipos: { PAGO_OBLIGACION: 'Pago de una obligación', DEVOLUCION: 'Devolución al cliente' } },
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
// Conceptos vigentes desde el catálogo (FIN-03); si el catálogo no responde, la semilla.
function cuentasDe_(tipo) {
  const g = tipo === 'INGRESO' ? 'INGRESO' : tipo === 'EGRESO' ? 'EGRESO' : (tipo === 'FONDO_RECIBIDO' || tipo === 'FONDO_PAGADO') ? 'FONDO' : '';
  if (!g) return [];
  try { const l = Cat.conceptos_(g); if (l.length) return l; } catch (e) { /* sin bóveda: semilla */ }
  return CUENTAS[g];
}
function empresasValidas_() { try { const l = Cat.empresas_(); if (l.length) return l; } catch (e) { /* semilla */ } return EMPRESAS; }
// Glosas que no dicen quién es: nunca se vuelven regla (todas se verían iguales).
const GENERICAS = [
  /^PAGO CUENTAS VIA INTERNET$/, /^ABONO POR TRF DESDE OTRO BANCO/, /^TRASPASO FONDOS OTRO BANCO/,
  /^TRANSFERENCIA DE FONDOS AUTOSERVICIO$/, /^CARGO POR TRANSF DE FONDOS AUTOSERVICIO$/, /^DEPOSITO EN EFECTIVO/,
  /^TRANSFER DE (CONSTRUCTORA|CONSTRUCCIONE|CONSTRUCCION|INVERSIONES|SERVICIOS|SOCIEDAD|COMERCIAL|EMPRESA)S?$/
];

// ---------------------------------------------------------------- esquema

let preparada_ = null;
Base.registrarEsquema_(() => { preparada_ = null; });
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
  // v2 (FIN-08, FIN-20): migraciones aditivas — versión para detectar ediciones simultáneas,
  // reglas que se pueden desactivar y versionar sin borrarlas.
  Base.asegurarColumna_(d, 'FIN_MOVIMIENTOS', 'version', 'INTEGER NOT NULL DEFAULT 0');
  Base.asegurarColumna_(d, 'FIN_REGLAS', 'activa', 'INTEGER NOT NULL DEFAULT 1');
  Base.asegurarColumna_(d, 'FIN_REGLAS', 'version', 'INTEGER NOT NULL DEFAULT 0');
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
// v2 (FIN-07): fecha civil validada contra el calendario real (un 31-02 ya no pasa).
function fechaIso_(v) { return Base.fechaCivil_(v); }
const texto_ = (v) => String(v == null ? '' : v).trim();
function mesCerrado_(periodo) { try { return require('./finanzasCierre').mesCerrado_(periodo); } catch (e) { return false; } }
/** ¿Le falta a esta cuenta la capacidad? (v2: capacidades en vez de solo «solo lectura»). */
function soloEscritura_(contexto, cap) { return !Base.puede_(contexto, cap || 'REGISTRAR'); }

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
  // Nombres fijos + alias del catálogo (de 3 letras o más, como palabra completa).
  let lista = [];
  try { lista = Cat.lista_('EMPRESA', { todos: true }).map((e) => ({ id: e.id, nombres: (NOMBRES_EMPRESA[e.id] || []).concat((e.alias || []).filter((a) => normalizar_(a).length >= 3)) })); } catch (e) { lista = []; }
  if (!lista.length) lista = EMPRESAS.map((e) => ({ id: e, nombres: NOMBRES_EMPRESA[e] }));
  const hit = lista.find((e) => e.nombres.some((n) => { const k = normalizar_(n); return k && g.indexOf(' ' + k + (/\s$/.test(n) || k.length <= 4 ? ' ' : '')) !== -1; }));
  return hit ? hit.id : '';
}
/** I07.6: una regla con alcance solo aplica a esa empresa / cuenta / sentido y dentro de su vigencia. */
function reglaAplica_(regla, m, ctx, sentido) {
  const a = regla.alcance || {}, v = regla.vigencia || {};
  const cuenta = m.cuenta_ref || ctx.cuenta_ref || '';
  if (a.empresa && a.empresa !== ctx.empresa) return false;
  if (a.cuenta_ref && cuenta && a.cuenta_ref !== cuenta) return false;
  if (a.sentido && a.sentido !== sentido) return false;
  if (m.fecha && ((v.desde && m.fecha < v.desde) || (v.hasta && m.fecha > v.hasta))) return false;
  return true;
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
  // 0) Cobros del banco.
  if (/^COMISION|^IMPUESTO|^INTERES|MANTENCION/.test(g) && sentido === 'cargo') return Object.assign(base, { tipo: 'EGRESO', cuenta: 'Comisión Banco', certeza: 'alta', motivo: 'Cobro del banco' });
  // Etapa A: lo que anotaron en el Excel BANCOS, el pagador conocido y el detalle del banco
  // (nombre completo, Previred/SII/Tesorería) mandan sobre la glosa cortada de la cartola.
  // v2 (FIN-19, T28): si la operación ya registró este dinero, se propone CONCILIAR (no clasificar
  // de nuevo: el hecho se contaría dos veces). Solo con una operación única; con empate, se avisa.
  if (ctx.opsSinBanco && m.fecha) {
    const monto = m.abono || m.cargo, sent = m.abono > 0 ? 'ENTRADA' : 'SALIDA';
    const cand = ctx.opsSinBanco.filter((o) => o.empresa === ctx.empresa && o.sentido === sent && o.monto === monto && Math.abs(Date.parse(o.fecha) - Date.parse(m.fecha)) <= 10 * 864e5);
    if (cand.length === 1) {
      const o = cand[0], d0 = (o.distribuciones || [])[0] || {};
      const una = (o.distribuciones || []).length === 1;
      return Object.assign(base, una ? { tipo: d0.tipo, subtipo: d0.subtipo || '', cuenta: d0.cuenta || '', cliente_id: d0.cliente_id || '', cliente: d0.cliente || '', empresa: d0.empresa || '' } : {},
        { operacion_candidata: o.id, certeza: 'media', motivo: 'Coincide con una operación registrada el ' + o.fecha.slice(8) + '-' + o.fecha.slice(5, 7) + (o.tercero ? ' (' + o.tercero + ')' : '') + ': concílialos para no contarla dos veces.' });
    }
    if (cand.length > 1) base.motivo = cand.length + ' operaciones registradas calzan con este monto: concilia la que corresponde.';
  }
  const conPagador = require('./finanzasPagadores').sugerirConPagador_(m, ctx, base);
  if (conPagador) return conPagador;
  // 1) Regla aprendida para esta glosa exacta.
  const regla = ctx.reglas.get(huellaGlosa_(m.glosa));
  if (regla && reglaAplica_(regla, m, ctx, sentido) && (!TIPOS[regla.tipo] || !TIPOS[regla.tipo].sentido || TIPOS[regla.tipo].sentido === sentido)) {
    const segura = regla.origen === 'persona' && !regla.ambigua;
    return Object.assign(base, regla, {
      certeza: segura ? 'alta' : 'media',
      motivo: regla.ambigua ? 'Antes fue ' + (regla.cliente || 'así') + ', pero hay varios clientes con ese nombre corto: revisa'
        : regla.origen === 'persona' ? 'Así se clasificó antes' : 'Aprendido de la planilla SIGECO'
    });
  }
  // 2) Reglas fijas.
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
  d.prepare('SELECT huella, datos, origen FROM FIN_REGLAS WHERE COALESCE(activa, 1) = 1').all().forEach((r) => { const dd = des_(r.datos); reglas.set(r.huella, Object.assign({}, dd.clasif, { origen: r.origen, alcance: dd.alcance || null, vigencia: dd.vigencia || null })); });
  // Último tipo confirmado por cliente (para "lo de la última vez").
  const tipoPorCliente = new Map();
  d.prepare("SELECT datos FROM FIN_MOVIMIENTOS WHERE estado = 'CONFIRMADO' ORDER BY fecha, orden").all().forEach((r) => {
    const dd = des_(r.datos);
    require('./finanzasPagadores').piezas_(dd).forEach((p) => { const c = p.clasif; if (c && c.cliente_id && c.tipo) tipoPorCliente.set(c.cliente_id, { tipo: c.tipo, cuenta: c.cuenta }); });
  });
  let facturasPorMonto = null;
  try { facturasPorMonto = require('./finanzasCobranza').facturasPorMonto_(db); } catch (e) { facturasPorMonto = null; }
  const extra = require('./finanzasPagadores').contextoPagadores_();
  let opsSinBanco = [];
  try { opsSinBanco = require('./finanzasConciliacion').opsSinBanco_(); } catch (e) { opsSinBanco = []; }
  return { reglas, tipoPorCliente, clientes: clientes_(db), empresa, facturasPorMonto, pagadores: extra.pagadores, recibidos: extra.recibidos, opsSinBanco };
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

/**
 * Todo lo que las pantallas necesitan para no repetir listas (v2, FIN-03):
 * empresas, conceptos, medios, repartos (con su modo), tipos con subtipos,
 * clientes (con RUT y alias), proyectos de SIGSO, obligaciones, parámetros y
 * las capacidades de quien pregunta (para ocultar lo que no puede hacer).
 */
const catalogo = B.conBoveda('', function (db, data, contexto) {
  const ctlg = (tipo) => Cat.lista_(tipo).map((x) => Object.assign({}, x));
  let alias = new Map();
  try { alias = require('./finanzasClientes').aliasPorCliente_(); } catch (e) { alias = new Map(); }
  return {
    empresas: Cat.empresas_(),
    empresas_detalle: ctlg('EMPRESA'),
    repartos: Cat.lista_('REPARTO').map((r) => ({ id: r.id, nombre: r.nombre, modo: r.modo || 'IGUALES', partes: r.partes || [], empresas: (r.partes || []).map((p) => p.empresa) })),
    tipos: Object.keys(TIPOS).map((k) => ({ id: k, nombre: TIPOS[k].nombre, sentido: TIPOS[k].sentido, cliente: !!TIPOS[k].cliente, empresa: !!TIPOS[k].empresa, cuentas: cuentasDe_(k),
      subtipos: TIPOS[k].subtipos ? Object.keys(TIPOS[k].subtipos).map((s) => ({ id: s, nombre: TIPOS[k].subtipos[s] })) : [] })),
    medios: ctlg('MEDIO'), bancos: ctlg('BANCO'), canales: ctlg('CANAL'), vendedores: ctlg('VENDEDOR'), obligaciones: ctlg('OBLIGACION'),
    tipos_proyecto: ctlg('TIPO_PROYECTO'), provisiones: Cat.conceptos_('PROVISION'),
    proyectos: proyectosSigso_(db),
    clientes: clientes_(db).map((c) => ({ id: c.id, nombre: c.nombre, rut: c.rut, alias: alias.get(c.id) || [] })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    capacidades: Base.capacidades_(contexto),
    capacidades_nombres: Base.CAPACIDADES
  };
});
/** Proyectos de SIGSO (módulo Proyectos) para usarlos como dimensión: solo id, código, nombre y estado. */
function proyectosSigso_(db) {
  try {
    return leerFilas_(db, 'PROYECTOS', COLUMNAS.PROYECTOS)
      .filter((p) => p.proyecto_id && !(p.activa === false || p.activa === 'FALSE'))
      .map((p) => ({ id: String(p.proyecto_id), codigo: String(p.codigo || ''), nombre: String(p.nombre || ''), estado: String(p.estado || ''), presupuesto: Number(p.presupuesto_monto) || 0 }));
  } catch (e) { return []; }
}

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
  { const e_ = Base.exigir_(contexto, 'REGISTRAR'); if (e_) return e_; }
  const c = leerCartola(data && data.filas);
  if (c.error) return errorValidacion('archivo', c.error);
  if (!c.cuadra && !(data && data.aceptar_descuadre)) return errorValidacion('archivo', 'La cartola no cuadra: ' + c.errores[0]);
  const d = db_();
  let cuenta = cuentaPorNumero_(c.numero);
  if (!cuenta) {
    const empresa = texto_(data && data.empresa);
    if (empresasValidas_().indexOf(empresa) === -1) return errorValidacion('empresa', 'Elige a qué empresa pertenece esta cuenta.');
    const id = crypto.randomUUID();
    d.prepare('INSERT INTO FIN_CUENTAS (id, banco, huella_numero, datos, ultimos4, empresa, creada_en) VALUES (?,?,?,?,?,?,?)')
      .run(id, c.banco, hmac_('cuenta|' + c.numero), cif_({ numero: c.numero, titular: c.titular }), c.numero.slice(-4), empresa, new Date().toISOString());
    cuenta = cuentaPorNumero_(c.numero);
    x.registrar('CUENTA_NUEVA', c.banco + ' ···' + c.numero.slice(-4) + ' → ' + empresa);
  }
  // Etapa 6: no entran movimientos NUEVOS a un mes cerrado (los repetidos se ignoran igual).
  const cerrados = [...new Set(c.movimientos.filter((m) => mesCerrado_(m.fecha.slice(0, 7)) &&
    !d.prepare('SELECT 1 FROM FIN_MOVIMIENTOS WHERE huella = ?').get(hmac_(['mov', c.numero, m.fecha, m.doc, m.cargo, m.abono, m.saldo].join('|')))).map((m) => m.fecha.slice(0, 7)))];
  if (cerrados.length) return errorValidacion('archivo', 'La cartola trae movimientos nuevos de un mes cerrado (' + cerrados.join(', ') + '). Reábrelo en «Cierre» si de verdad faltaban.');
  const ctx = contextoSugerencias_(db, cuenta.empresa);
  ctx.cuenta_ref = cuenta.id;
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
    id: r.id, fecha: r.fecha, estado: r.estado, version: r.version || 0, cuenta_ref: r.cuenta_ref, glosa: d.glosa, doc: d.doc, cargo: d.cargo, abono: d.abono, saldo: d.saldo,
    cuenta: { banco: cu.banco, ultimos4: cu.ultimos4, empresa: cu.empresa }, sugerencia: d.sugerencia, clasif: d.clasif,
    // Etapa A: lo que dice el detalle del banco (quién pagó, Previred/SII…) y lo que anotaron en el Excel BANCOS.
    detalle: d.detalle || null, planilla: d.planilla ? { alias: d.planilla.alias, obs: d.planilla.obs, plan: d.planilla.plan } : null,
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
    require('./finanzasPagadores').piezas_(m).forEach((p) => {
      const t = p.clasif.tipo, monto = p.abono || p.cargo;
      if (t === 'TRASPASO' || t === 'PRESTAMO') r[t + (p.abono ? '_ENTRA' : '_SALE')] += monto;
      else if (r[t] !== undefined) r[t] += monto;
    });
  });
  return r;
}

function validarClasif_(c, mov) {
  const sentido = mov.abono > 0 ? 'abono' : 'cargo';
  const t = TIPOS[c.tipo];
  if (!t) return 'Elige qué tipo de movimiento es.';
  if (t.sentido && t.sentido !== sentido) return t.nombre + (sentido === 'abono' ? ' no puede ser plata que entra.' : ' no puede ser plata que sale.');
  if (t.cliente && !c.cliente_id) return 'Elige de qué cliente es.';
  if (t.empresa && empresasValidas_().indexOf(c.empresa) === -1) return 'Elige con qué empresa del grupo.';
  if (cuentasDe_(c.tipo).length && cuentasDe_(c.tipo).indexOf(c.cuenta) === -1) return 'Elige la cuenta o el concepto.';
  if (c.subtipo && !(t.subtipos && t.subtipos[c.subtipo])) return 'Ese subtipo no corresponde a «' + t.nombre + '».';
  return '';
}

/**
 * Reparto de un gasto compartido (FIN-25). Entra como arreglo de empresas
 * (partes iguales, forma anterior) o como { modo, partes:[{empresa, valor}] }:
 *  - IGUALES: valor se ignora;
 *  - PORCENTAJE: los valores suman 100;
 *  - FIJO: los valores suman exacto el monto del gasto.
 * Devuelve { reparto } normalizado, { error } o {} si no hay reparto.
 */
function normalizarReparto_(entrada, monto) {
  if (!entrada || (Array.isArray(entrada) && !entrada.length)) return {};
  const validas = empresasValidas_();
  let modo = 'IGUALES', partes;
  if (Array.isArray(entrada)) partes = [...new Set(entrada.map(texto_))].map((e) => ({ empresa: e }));
  else {
    modo = ['IGUALES', 'PORCENTAJE', 'FIJO'].indexOf(texto_(entrada.modo).toUpperCase()) !== -1 ? texto_(entrada.modo).toUpperCase() : 'IGUALES';
    partes = (Array.isArray(entrada.partes) ? entrada.partes : []).map((p) => ({ empresa: texto_(p.empresa), valor: p.valor }));
  }
  partes = partes.filter((p) => p.empresa);
  if (new Set(partes.map((p) => p.empresa)).size !== partes.length) return { error: 'Una empresa aparece dos veces en el reparto.' };
  const malas = partes.filter((p) => validas.indexOf(p.empresa) === -1);
  if (malas.length) return { error: 'Empresa desconocida en el reparto: ' + malas.map((p) => p.empresa).join(', ') + '.' };
  if (partes.length < 2) return Array.isArray(entrada) ? {} : { error: 'Un gasto compartido se reparte entre 2 o más empresas.' };
  if (modo === 'PORCENTAJE') {
    partes = partes.map((p) => ({ empresa: p.empresa, valor: Math.round(Number(String(p.valor).replace(',', '.')) * 100) / 100 }));
    if (partes.some((p) => !(p.valor >= 0))) return { error: 'Cada porcentaje debe ser un número de 0 a 100.' };
    const suma = Math.round(partes.reduce((s, p) => s + p.valor, 0) * 100) / 100;
    if (suma !== 100) return { error: 'Los porcentajes suman ' + String(suma).replace('.', ',') + ' %, deben sumar 100 %.' };
  } else if (modo === 'FIJO') {
    const vs = partes.map((p) => Base.montoClp_(p.valor));
    if (vs.some((v) => !v.ok || v.valor < 0)) return { error: 'Cada parte fija necesita un monto válido.' };
    partes = partes.map((p, i) => ({ empresa: p.empresa, valor: vs[i].valor }));
    const suma = partes.reduce((s, p) => s + p.valor, 0);
    if (suma !== monto) return { error: 'Las partes fijas suman ' + Base.plata_(suma) + ' y el gasto es de ' + Base.plata_(monto) + '.' };
  } else partes = partes.map((p) => ({ empresa: p.empresa }));
  return { reparto: { modo, partes } };
}
/**
 * Cuánto le toca a cada empresa de un gasto compartido: [{empresa, monto}],
 * sumando exacto el gasto (los pesos que sobran del redondeo se entregan con
 * un criterio fijo: mayor resto y, en empate, el orden del reparto).
 */
function partesReparto_(reparto, monto) {
  if (!reparto) return null;
  const r = Array.isArray(reparto) ? { modo: 'IGUALES', partes: reparto.map((e) => ({ empresa: e })) } : reparto;
  if (!r.partes || r.partes.length < 2) return null;
  let montos;
  if (r.modo === 'FIJO') montos = r.partes.map((p) => Number(p.valor) || 0);
  else montos = Base.repartir_(monto, r.partes.map((p) => (r.modo === 'PORCENTAJE' ? Number(p.valor) || 0 : 1)));
  return r.partes.map((p, i) => ({ empresa: p.empresa, monto: montos[i] }));
}

/**
 * Normaliza y valida UNA clasificación (o una parte de una división) para un
 * movimiento de cierto sentido y monto. Lo usan los movimientos del banco y
 * el registro operativo (finanzasOperaciones.js): mismas reglas en ambos.
 * Devuelve { clasif } o { error }.
 */
function normalizarClasif_(it, mov, ctxN) {
  const c = {
    tipo: texto_(it.tipo), subtipo: texto_(it.subtipo).toUpperCase(), cuenta: texto_(it.cuenta), cliente_id: texto_(it.cliente_id),
    empresa: texto_(it.empresa), nota: texto_(it.nota).slice(0, 300)
  };
  const t = TIPOS[c.tipo];
  if (c.cliente_id && !ctxN.clientes.has(c.cliente_id)) return { error: 'Ese cliente no existe en SIGSO.' };
  c.cliente = c.cliente_id ? ctxN.clientes.get(c.cliente_id) : '';
  if (!t || (!t.cliente && c.tipo !== 'INGRESO')) { c.cliente_id = ''; c.cliente = ''; }
  if (!t || !t.empresa) c.empresa = '';
  if (!cuentasDe_(c.tipo).length) c.cuenta = '';
  if (!t || !t.subtipos) c.subtipo = '';
  // Dimensiones (FIN-13/27): no cambian el monto; solo dicen a qué gestión, proyecto u obligación pertenece.
  const gestion = texto_(it.gestion_id);
  if (gestion) {
    if (!t || !t.cliente) return { error: 'Solo la plata de un cliente se asigna a una gestión de fondos.' };
    const g = ctxN.gestion ? ctxN.gestion(gestion) : null;
    if (!g) return { error: 'Esa gestión de fondos no existe.' };
    if (g.cliente_id !== c.cliente_id) return { error: 'La gestión de fondos es de otro cliente.' };
    c.gestion_id = gestion;
  }
  const proyecto = texto_(it.proyecto_id);
  if (proyecto) {
    if (ctxN.proyectos && !ctxN.proyectos.has(proyecto)) return { error: 'Ese proyecto no existe.' };
    c.proyecto_id = proyecto;
  }
  if (texto_(it.periodo_obligacion)) {
    const p = Base.periodo_(it.periodo_obligacion);
    if (!p) return { error: 'El período de la obligación no se entiende (usa AAAA-MM).' };
    c.periodo_obligacion = p;
  }
  if (texto_(it.destino)) c.destino = texto_(it.destino).slice(0, 160);
  if (texto_(it.prestamo_id)) c.prestamo_id = texto_(it.prestamo_id);
  if (texto_(it.servicio_id)) c.servicio_id = texto_(it.servicio_id);
  if (c.tipo === 'EGRESO' && it.reparto) {
    const r = normalizarReparto_(it.reparto, mov.abono || mov.cargo);
    if (r.error) return { error: r.error };
    if (r.reparto) c.reparto = r.reparto;
  }
  const err = validarClasif_(c, mov);
  if (err) return { error: err };
  return { clasif: c };
}
/** Contexto compartido para normalizar muchas clasificaciones de una vez. */
function contextoNormalizar_(db) {
  const lista = clientes_(db);
  let gestiones = null;
  return {
    listaClientes: lista,
    clientes: new Map(lista.map((c) => [c.id, c.nombre])),
    proyectos: new Set(proyectosSigso_(db).map((p) => p.id).concat((() => { try { return require('./finanzasPlanificacion').proyectosLegado_().map((p) => p.id); } catch (e) { return []; } })())),
    gestion: (id) => {
      if (!gestiones) { try { gestiones = require('./finanzasFondos').gestionesMapa_(); } catch (e) { gestiones = new Map(); } }
      return gestiones.get(id) || null;
    }
  };
}
/** Una clasificación con partes: valida cada parte y que sumen exacto el movimiento. */
function normalizarPartes_(it, mov, ctxN) {
  const total = mov.abono || mov.cargo;
  const partes = [];
  for (const p of it.partes.slice(0, 10)) {
    const m = Base.montoClp_(p.monto);
    if (!m.ok || !(m.valor > 0)) return { error: 'Cada parte necesita un monto mayor que cero.' };
    const r = normalizarClasif_(p, mov, ctxN);
    if (r.error) return { error: 'Parte de ' + Base.plata_(m.valor) + ': ' + r.error };
    partes.push(Object.assign({ monto: m.valor }, r.clasif));
  }
  const suma = partes.reduce((a, q) => a + q.monto, 0);
  if (suma !== total) return { error: 'Las partes suman ' + Base.plata_(suma) + ' y el movimiento es de ' + Base.plata_(total) + '.' };
  return { clasif: { partes, nota: texto_(it.nota).slice(0, 300) } };
}

/**
 * Confirma o corrige la clasificación de uno o varios movimientos.
 * items: [{ id, tipo, subtipo, cuenta, cliente_id, empresa, nota, reparto, partes,
 *           gestion_id, proyecto_id, periodo_obligacion, destino, expected_version, recordar }]
 * Con `recordar` (por defecto sí), la glosa queda como regla, salvo que sea genérica.
 * v2: si llega expected_version y el movimiento cambió entretanto, ese ítem
 * vuelve con conflicto (codigo CONFLICTO_VERSION) y no se pisa.
 */
const clasificar = B.conBoveda('', function (db, data, contexto, x) {
  { const e_ = Base.exigir_(contexto, 'CONFIRMAR'); if (e_) return e_; }
  const items = Array.isArray(data && data.items) ? data.items.slice(0, 500) : [];
  if (!items.length) return errorValidacion('items', 'No hay movimientos para guardar.');
  const d = db_();
  const ctxN = contextoNormalizar_(db);
  const listaClientes = ctxN.listaClientes;
  const errores = [];
  const ahora = new Date().toISOString();
  let hechos = 0, reglas = 0;
  const tocados = [];
  d.exec('BEGIN');
  try {
    items.forEach((it) => {
      const r = d.prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE id = ?').get(texto_(it.id));
      if (!r) { errores.push({ id: it.id, mensaje: 'No existe.' }); return; }
      // Etapa 6: un mes cerrado queda fijo (se reabre con motivo en «Cierre»).
      if (mesCerrado_(r.periodo)) { errores.push({ id: it.id, codigo: 'PERIODO_CERRADO', mensaje: 'El mes ' + r.periodo + ' está cerrado. Reábrelo en «Cierre» si hay que corregir algo.' }); return; }
      // I11.2: cambiar un movimiento YA confirmado exige la versión vista. La primera clasificación de un pendiente
      // se protege por su estado: si otra persona lo confirmó entretanto, ya no está pendiente y se exige la versión.
      const sinVersion = it.expected_version === undefined || it.expected_version === null || it.expected_version === '';
      if (sinVersion && r.estado !== 'PENDIENTE') { errores.push({ id: it.id, codigo: 'VERSION_REQUERIDA', mensaje: 'Este movimiento ya estaba confirmado: ábrelo de nuevo para cambiarlo.' }); return; }
      if (!sinVersion && Number(it.expected_version) !== Number(r.version || 0)) {
        errores.push({ id: it.id, codigo: 'CONFLICTO_VERSION', mensaje: 'Otra persona cambió este movimiento mientras lo revisabas (' + (r.actualizado_por || '') + '). Ábrelo de nuevo.' });
        return;
      }
      const datos = des_(r.datos);
      // v2 (I02): un movimiento vinculado con el registro (total o en parte) se corrige en Conciliación; clasificarlo aquí pisaría el vínculo.
      if (datos.clasif && datos.clasif.conciliado) { errores.push({ id: it.id, codigo: 'CONCILIADO', mensaje: 'Está vinculado con operaciones registradas: complétalo o deshaz el vínculo en Conciliación.' }); return; }
      // v2 (T28): si el movimiento calza con una operación registrada, se concilia; clasificarlo
      // por separado contaría el mismo dinero dos veces (salvo que se diga que NO es esa operación).
      if (r.estado === 'PENDIENTE' && datos.sugerencia && datos.sugerencia.operacion_candidata && !it.no_es_operacion && !it.operaciones) {
        errores.push({ id: it.id, codigo: 'CONCILIAR', mensaje: 'Este movimiento coincide con una operación ya registrada: concílialos (o indica que no es la misma).' });
        return;
      }
      const n = Array.isArray(it.partes) && it.partes.length >= 2 ? normalizarPartes_(it, datos, ctxN) : normalizarClasif_(it, datos, ctxN);
      if (n.error) { errores.push({ id: it.id, mensaje: n.error }); return; }
      const c = n.clasif;
      c.confirmado_por = x.nombre;
      if (it.operaciones) c.operaciones = it.operaciones; // vínculo con el registro operativo (conciliación)
      datos.clasif = c;
      // El pagador aprende de qué cliente(s) era (una vez por movimiento).
      const pagador = datos.detalle && datos.detalle.pagador;
      if (pagador && datos.abono > 0 && !datos.pagador_aprendido) {
        const P = require('./finanzasPagadores');
        P.piezas_(datos).forEach((p) => { if (p.clasif && p.clasif.cliente_id) P.registrarPagador_(pagador, p.clasif.cliente_id, p.clasif.cliente, 'persona'); });
        datos.pagador_aprendido = true;
      }
      d.prepare("UPDATE FIN_MOVIMIENTOS SET estado = 'CONFIRMADO', datos = ?, actualizado_en = ?, actualizado_por = ?, version = COALESCE(version, 0) + 1 WHERE id = ?")
        .run(cif_(datos), ahora, x.nombre, r.id);
      hechos++;
      tocados.push({ glosa: datos.glosa, pagador: datos.detalle && datos.detalle.pagador, cuenta_ref: r.cuenta_ref });
      if (it.recordar !== false && !esGenerica_(datos.glosa) && !datos.clasif.partes && !(datos.detalle && datos.detalle.pagador)) {
        const h = huellaGlosa_(datos.glosa);
        // La regla guarda solo la clasificación (no la gestión, el período ni el destino, que son de ESE movimiento).
        const regla = { glosa: datos.glosa, clasif: { tipo: c.tipo, subtipo: c.subtipo, cuenta: c.cuenta, cliente_id: c.cliente_id, cliente: c.cliente, empresa: c.empresa, reparto: c.reparto, ambigua: ambigua_(datos.glosa, listaClientes) } };
        d.prepare("INSERT INTO FIN_REGLAS (id, huella, datos, origen, usos, actualizada_en) VALUES (?,?,?,'persona',1,?) " +
          "ON CONFLICT(huella) DO UPDATE SET datos = excluded.datos, origen = 'persona', usos = usos + 1, actualizada_en = excluded.actualizada_en")
          .run(crypto.randomUUID(), h, cif_(regla), ahora);
        reglas++;
      }
    });
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
  if (hechos) x.registrar('CLASIFICAR', hechos + ' movimiento(s)');
  if (hechos) resugerirPendientes_(db, alcanceDe_(tocados));
  return { hechos, reglas, errores };
});

/**
 * A quién afecta lo recién confirmado (FIN-44): la misma glosa (regla), el
 * mismo pagador y los pendientes de esas cuentas (Previred del mismo monto,
 * «lo de la última vez» del cliente). El resto no cambia de sugerencia.
 */
function alcanceDe_(tocados) {
  return {
    glosas: new Set(tocados.map((t) => normalizar_(t.glosa))),
    pagadores: new Set(tocados.map((t) => normalizar_(t.pagador)).filter(Boolean)),
    cuentas: new Set(tocados.map((t) => t.cuenta_ref))
  };
}

/**
 * Vuelve a sugerir los pendientes (todos, o solo los del `alcance`). El
 * contexto pesado (confirmados, cartera, pagadores) se arma UNA vez; solo se
 * reescribe la fila cuya sugerencia cambió. Devuelve cuántas cambiaron.
 */
function resugerirPendientes_(db, alcance) {
  const d = db_();
  const cuentas = cuentasMapa_();
  const comun = contextoSugerencias_(db, 'HomePymes');
  const ctxDe = (emp) => Object.assign({}, comun, { empresa: emp });
  let cambiadas = 0;
  const afectado = (r) => {
    if (!alcance) return true;
    const g = normalizar_(r.d.glosa), p = normalizar_(r.d.detalle && r.d.detalle.pagador);
    return alcance.glosas.has(g) || (p && alcance.pagadores.has(p)) || alcance.cuentas.has(r.cuenta_ref);
  };
  const upd = d.prepare('UPDATE FIN_MOVIMIENTOS SET datos = ? WHERE id = ?');
  // Primero los abonos: un pago a Previred/SII busca al cliente entre lo recibido,
  // y eso tiene que incluir lo que se acaba de reconocer en esta misma pasada.
  d.prepare("SELECT id, cuenta_ref, fecha, datos FROM FIN_MOVIMIENTOS WHERE estado = 'PENDIENTE'").all()
    .map((r) => Object.assign(r, { d: des_(r.datos) }))
    .filter(afectado)
    .sort((x, y) => (y.d.abono > 0) - (x.d.abono > 0))
    .forEach((r) => {
      const emp = (cuentas.get(r.cuenta_ref) || {}).empresa || 'HomePymes';
      const ctx = ctxDe(emp);
      const datos = r.d;
      const antes = JSON.stringify(datos.sugerencia || null);
      datos.sugerencia = sugerir_(Object.assign({ fecha: r.fecha, cuenta_ref: r.cuenta_ref }, datos), ctx);
      const s = datos.sugerencia;
      if (datos.abono > 0 && s && s.cliente_id && s.certeza !== 'baja' && comun.recibidos) comun.recibidos.push({ fecha: r.fecha, monto: datos.abono, cliente_id: s.cliente_id, cliente: s.cliente });
      if (JSON.stringify(s) !== antes) { upd.run(cif_(datos), r.id); cambiadas++; }
    });
  return cambiadas;
}

/**
 * Confirma de una vez lo que tiene sugerencia de certeza alta y completa.
 * v2 (FIN-02): pasa por la MISMA revisión de avisos que el panel y los lotes;
 * lo que tiene una alerta no se confirma y vuelve en `detenidos`.
 */
const confirmarSugeridas = B.conBoveda('', function (db, data, contexto) {
  { const e_ = Base.exigir_(contexto, 'CONFIRMAR'); if (e_) return e_; }
  const periodo = texto_(data && data.periodo);
  const filas = db_().prepare("SELECT * FROM FIN_MOVIMIENTOS WHERE estado = 'PENDIENTE' AND periodo = ?").all(periodo);
  const items = [];
  filas.forEach((r) => {
    const d = des_(r.datos); const s = d.sugerencia || {};
    if (s.certeza === 'alta' && completa_(s, d.abono > 0 ? 'abono' : 'cargo')) items.push({ id: r.id, tipo: s.tipo, subtipo: s.subtipo, cuenta: s.cuenta, cliente_id: s.cliente_id, empresa: s.empresa, reparto: s.reparto, recordar: false, expected_version: r.version || 0 });
  });
  if (!items.length) return { hechos: 0, reglas: 0, errores: [], detenidos: [] };
  const A = require('./finanzasAvisos');
  const rev = A.revisarItems_(db, items);
  const conAlerta = new Set(rev.filter((x) => x.avisos.some((a) => a.nivel === 'alerta')).map((x) => x.id));
  const limpios = items.filter((it) => !conAlerta.has(it.id));
  const detenidos = rev.filter((x) => conAlerta.has(x.id));
  if (!limpios.length) return { hechos: 0, reglas: 0, errores: [], detenidos };
  const r = clasificar(db, Object.assign({}, data, { items: limpios }), contexto);
  return Object.assign({}, r, { detenidos });
});

/**
 * Aprender de la planilla SIGECO: la hoja CUENTA BANCARIA tiene lo que
 * Bárbara y Lisseth clasificaron a mano. Cada fila se empareja con un
 * movimiento ya importado (misma empresa, mismo monto y sentido, ±3 días) y
 * su cliente queda como SUGERENCIA (nunca se confirma sola). Las glosas que
 * siempre fueron del mismo cliente quedan como reglas "de la planilla".
 */
const aprenderPlanilla = B.conBoveda('', function (db, data, contexto, x) {
  { const e_ = Base.exigir_(contexto, 'REGISTRAR'); if (e_) return e_; }
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
    require('./finanzasPagadores').piezas_(des_(r.datos)).forEach((m) => {
      const c = m.clasif;
      if (!c || (c.tipo !== 'FONDO_RECIBIDO' && c.tipo !== 'FONDO_PAGADO')) return;
      const f = fondos.get(c.cliente_id) || { cliente_id: c.cliente_id, cliente: c.cliente, recibido: 0, pagado: 0 };
      if (c.tipo === 'FONDO_RECIBIDO') f.recibido += m.abono; else f.pagado += m.cargo;
      fondos.set(c.cliente_id, f);
    });
  });
  const pendientes = d.prepare("SELECT COUNT(*) AS n FROM FIN_MOVIMIENTOS WHERE estado = 'PENDIENTE'").get().n;
  const reglas = d.prepare('SELECT COUNT(*) AS n FROM FIN_REGLAS WHERE COALESCE(activa, 1) = 1').get().n;
  return {
    cuentas: lista, pendientes, reglas,
    fondos: [...fondos.values()].map((f) => Object.assign(f, { saldo: f.recibido - f.pagado })).sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo))
  };
});

module.exports = {
  reglaAplica_,
  catalogo, revisarCartola, importarCartola, movimientos, clasificar, confirmarSugeridas, aprenderPlanilla, resumenBancos,
  // pruebas
  leerCartola, sugerir_, esGenerica_, monto_, EMPRESAS, TIPOS, resugerirPendientes_, completa_, CUENTAS_EGRESO: CUENTAS.EGRESO,
  empresaEnTexto_: (t) => empresaEnGlosa_(t),
  // v2: compartido con el registro operativo, la conciliación y la planificación
  cuentasDe_, empresasValidas_, normalizarClasif_, normalizarPartes_, contextoNormalizar_, normalizarReparto_, partesReparto_,
  validarClasif_, huellaGlosa_, ambigua_, contextoSugerencias_, proyectosSigso_, movimientoPublico_, alcanceDe_,
  // compartido con finanzasCobranza.js
  interno: { db_, des_: (t) => des_(t), cif_: (o) => cif_(o), hmac_: (t) => hmac_(t), normalizar_, clientes_, fechaIso_, soloEscritura_, cuentasMapa_, movimientoPublico_ }
};
