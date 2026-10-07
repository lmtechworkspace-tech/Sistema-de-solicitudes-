'use strict';

/**
 * finanzasPresupuesto.js — Finanzas, Etapa 5: presupuesto y proyección
 * (2026-10-06).
 *
 * El presupuesto de SIGECO (hoja PRESUPUESTO) tenía $10.000.000 en todas las
 * celdas y las de egresos guardadas como texto, así que el "proyectado vs.
 * real" daba #NUM!. Aquí:
 *  - Un presupuesto por AÑO y EMPRESA, con una línea por cuenta del plan de
 *    cuentas (ingresos y gastos de la empresa) y 12 montos. Lo cargan
 *    Bárbara y Lisseth (decisión del dueño 2026-10-06). El grupo es la suma.
 *  - Comparación con lo real del mes y del acumulado del año, por cuenta,
 *    con los gastos compartidos repartidos (factor_ de finanzasTablero.js).
 *  - Todo cifrado dentro de la bóveda.
 */

const B = require('./finanzasBoveda');
const FB = require('./finanzasBancos');
const { errorValidacion, errorForbidden } = require('./errores');

const I = FB.interno;
const CUENTAS = {
  INGRESO: ['Servicio Mensual', 'Servicio Renta', 'Devolución Renta', 'Otros Ingresos'],
  EGRESO: ['Arriendo Mensual', 'Arriendo Reajuste', 'Cuentas Básicas', 'Sueldos', 'Anticipos', 'Finiquitos', 'Imposiciones',
    'Convenios', 'IVA', 'IVA Postergado', 'Renta', 'Multas Clientes', 'Caja Chica', 'Patente Comercial', 'Comisión Banco',
    'Servidores y Sistemas', 'Otros Egresos']
};

let preparada_ = null;
function db_() {
  const d = I.db_();
  if (preparada_ === d) return d;
  d.exec(`CREATE TABLE IF NOT EXISTS FIN_PRESUPUESTO (
    id TEXT PRIMARY KEY, anio INTEGER NOT NULL, empresa TEXT NOT NULL, datos TEXT NOT NULL,
    actualizado_en TEXT, actualizado_por TEXT)`);
  preparada_ = d;
  return d;
}

/** { 'INGRESO|Servicio Mensual': [12], ... } del año y empresa ('' = suma del grupo). */
function lineas_(anio, empresa) {
  const filas = db_().prepare('SELECT empresa, datos FROM FIN_PRESUPUESTO WHERE anio = ?').all(Number(anio));
  const out = {};
  filas.forEach((r) => {
    if (empresa && r.empresa !== empresa) return;
    (I.des_(r.datos).lineas || []).forEach((l) => {
      const k = l.tipo + '|' + l.cuenta;
      out[k] = out[k] || new Array(12).fill(0);
      l.meses.forEach((v, i) => { out[k][i] += Number(v) || 0; });
    });
  });
  return out;
}

/** Para el tablero: { 'AAAA-MM': { ingresos, egresos } } de los meses pedidos (null si no hay nada cargado). */
function porMes_(periodos, empresa) {
  const res = {};
  const anios = [...new Set(periodos.map((p) => Number(p.slice(0, 4))))];
  let alguno = false;
  anios.forEach((a) => {
    const l = lineas_(a, empresa);
    if (Object.keys(l).length) alguno = true;
    periodos.filter((p) => Number(p.slice(0, 4)) === a).forEach((p) => {
      const i = Number(p.slice(5, 7)) - 1;
      const o = { ingresos: 0, egresos: 0 };
      Object.keys(l).forEach((k) => { if (k.indexOf('INGRESO|') === 0) o.ingresos += l[k][i]; else o.egresos += l[k][i]; });
      res[p] = o;
    });
  });
  return alguno ? res : null;
}

/** Lo real del año por cuenta y mes, con la parte que le toca a la empresa de los gastos compartidos. */
function real_(anio, empresa) {
  const T = require('./finanzasTablero');
  const out = {};
  T.movimientos_().forEach((m) => {
    if (!m.clasif || m.fecha.slice(0, 4) !== String(anio)) return;
    if (m.clasif.tipo !== 'INGRESO' && m.clasif.tipo !== 'EGRESO') return;
    const f = T.factor_(m, empresa);
    if (!f) return;
    const k = m.clasif.tipo + '|' + m.clasif.cuenta;
    out[k] = out[k] || new Array(12).fill(0);
    out[k][Number(m.fecha.slice(5, 7)) - 1] += Math.round((m.clasif.tipo === 'INGRESO' ? m.abono : m.cargo) * f);
  });
  return out;
}

/** Presupuesto + real del año, listo para comparar o editar. */
const ver = B.conBoveda('VER_PRESUPUESTO', function (db, data) {
  const anio = Number((data && data.anio) || new Date().getFullYear());
  if (!(anio >= 2020 && anio <= 2100)) return errorValidacion('anio', 'Año no válido.');
  const empresa = FB.EMPRESAS.indexOf(String((data && data.empresa) || '')) !== -1 ? data.empresa : '';
  const ppto = lineas_(anio, empresa);
  const real = real_(anio, empresa);
  const filas = [];
  ['INGRESO', 'EGRESO'].forEach((tipo) => {
    CUENTAS[tipo].forEach((cuenta) => {
      const k = tipo + '|' + cuenta;
      filas.push({ tipo, cuenta, ppto: ppto[k] || new Array(12).fill(0), real: real[k] || new Array(12).fill(0) });
    });
  });
  const anios = db_().prepare('SELECT DISTINCT anio FROM FIN_PRESUPUESTO ORDER BY anio DESC').all().map((r) => r.anio);
  const meta = empresa ? db_().prepare('SELECT actualizado_en, actualizado_por FROM FIN_PRESUPUESTO WHERE anio = ? AND empresa = ?').get(anio, empresa) : null;
  // Primer mes del año con movimientos: antes de eso, "real = 0" no significa que no hubo plata.
  const primero = I.db_().prepare('SELECT MIN(periodo) AS p FROM FIN_MOVIMIENTOS WHERE periodo LIKE ?').get(anio + '-%');
  const primerMes = primero && primero.p ? Number(primero.p.slice(5, 7)) - 1 : null;
  return { anio, empresa, empresas: FB.EMPRESAS, anios, filas, cargado: Object.keys(ppto).length > 0, actualizado: meta || null, primer_mes_con_datos: primerMes };
});

/** Guarda el presupuesto de un año y una empresa (reemplaza el anterior). */
const guardar = B.conBoveda('', function (db, data, contexto, x) {
  if (I.soloEscritura_(contexto)) return errorForbidden('Tu acceso a Finanzas es de solo lectura.');
  const anio = Number(data && data.anio);
  const empresa = String((data && data.empresa) || '');
  if (!(anio >= 2020 && anio <= 2100)) return errorValidacion('anio', 'Año no válido.');
  if (FB.EMPRESAS.indexOf(empresa) === -1) return errorValidacion('empresa', 'El presupuesto se carga por empresa.');
  const lineas = [];
  for (const l of (Array.isArray(data && data.lineas) ? data.lineas : [])) {
    if (!CUENTAS[l.tipo] || CUENTAS[l.tipo].indexOf(l.cuenta) === -1) return errorValidacion('lineas', 'Cuenta desconocida: ' + l.cuenta);
    const meses = (Array.isArray(l.meses) ? l.meses : []).slice(0, 12).map((v) => Math.round(Number(String(v).replace(/[^\d-]/g, '')) || 0));
    while (meses.length < 12) meses.push(0);
    if (meses.some((v) => v < 0)) return errorValidacion('lineas', 'Los montos del presupuesto no pueden ser negativos.');
    if (meses.some((v) => v)) lineas.push({ tipo: l.tipo, cuenta: l.cuenta, meses });
  }
  const d = db_();
  const id = anio + '|' + empresa;
  d.prepare('INSERT INTO FIN_PRESUPUESTO (id, anio, empresa, datos, actualizado_en, actualizado_por) VALUES (?,?,?,?,?,?) ' +
    'ON CONFLICT(id) DO UPDATE SET datos = excluded.datos, actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por')
    .run(id, anio, empresa, I.cif_({ lineas }), new Date().toISOString(), x.nombre);
  const total = (t) => lineas.filter((l) => l.tipo === t).reduce((s, l) => s + l.meses.reduce((a, b) => a + b, 0), 0);
  x.registrar('GUARDAR_PRESUPUESTO', anio + ' ' + empresa + ': ' + lineas.length + ' cuentas');
  return { anio, empresa, cuentas: lineas.length, ingresos_anio: total('INGRESO'), egresos_anio: total('EGRESO') };
});

module.exports = { ver, guardar, porMes_, lineas_, real_, CUENTAS };
