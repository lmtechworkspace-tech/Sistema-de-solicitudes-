'use strict';

/**
 * rrhhInformes.js — los dos informes internos de RR.HH. que hasta ahora se
 * armaban a mano (revisión del módulo con el área, 2026-10-05; decisiones 2 y 3
 * aprobadas por el dueño):
 *
 *  - IMPUESTO ÚNICO para Contabilidad (el 5-7 un primer informe y el 13 el
 *    final): sale de Remuneraciones, que ya trae el impuesto único y el 3 % de
 *    préstamo solidario de cada obra. Reemplaza a la matriz «3 %-IUSC», que
 *    repetía ese trabajo y dejó de llenarse en julio de 2026. Se cruza con lo
 *    que Contabilidad tiene en el Informe y pago de IVA del mismo mes.
 *  - PLATAFORMAS EXTERNAS para Facturación y Cobranzas (primeros 5 días): sale
 *    de la matriz Plataformas externas: por cliente y plataforma, trabajadores a
 *    los que se subió documentación (lo que se cobra), trabajadores del mes y
 *    finiquitados.
 *
 * Lo ven RR.HH. y el área que recibe el informe (Contabilidad o Facturación y
 * Cobranzas), además del administrador.
 */

const CI = require('./controlInterno');
const { periodoRemuneracion_ } = require('./controlInternoMatrices');

function num_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const s = String(v == null ? '' : v).replace(/[$\s]/g, '');
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ''));
  const n = Number(s.replace(',', '.'));
  return s && isFinite(n) ? n : 0;
}
function esFecha_(v) { return /^\d{4}-\d{2}-\d{2}/.test(String(v || '')); }
function clave_(r) { return r.cliente_id || 'N:' + CI.normalizarTexto_(r.cliente_nombre); }
function periodo_(d) { return CI.RE_PERIODO.test(String((d || {}).periodo || '')) ? d.periodo : CI.moverPeriodo_(CI.periodoActual_(), -1); }
function puede_(db, contexto, otra) {
  const ac = CI.acceso_(db, contexto);
  return ac.esAdmin || (ac.deptos.RRHH || {}).ve || (ac.deptos[otra] || {}).ve;
}

/** Filas de Remuneraciones cuyo mes de la remuneración es p (llegan en p o en p+1). */
function remuneraciones_(db, p) {
  return CI.rango_(db, 'REMUNERACIONES', p, CI.moverPeriodo_(p, 1)).filter((r) => periodoRemuneracion_(r) === p);
}

function impuestoUnico(db, data, contexto) {
  if (!puede_(db, contexto, 'CONTABILIDAD')) return { _forbidden: true, message: 'Este informe lo ven RR.HH. y Contabilidad.' };
  const periodo = periodo_(data);
  const porCli = {};
  remuneraciones_(db, periodo).forEach((r) => {
    const d = r.datos || {}, k = clave_(r);
    const x = porCli[k] = porCli[k] || { cliente_id: r.cliente_id || '', cliente: r.cliente_nombre, obras: new Set(), trabajadores: 0, iusc: 0, tres: 0, imposiciones: 0, liquidaciones_enviadas: 0, filas: 0, ultima_recepcion: '' };
    x.filas++;
    if (d.nombre_obra) x.obras.add(String(d.nombre_obra).trim().toUpperCase());
    x.trabajadores += num_(d.cantidad);
    x.iusc += num_(d.monto_iusc);
    x.tres += num_(d['3%_prestamo_solidario']);
    x.imposiciones += num_(d.valor_imposiciones);
    if (esFecha_(d.fecha_envio_liquidacion)) x.liquidaciones_enviadas++;
    const f = String(d.fecha_recepcion_informacion || '').slice(0, 10);
    if (esFecha_(f) && f > x.ultima_recepcion) x.ultima_recepcion = f;
  });
  // Lo que Contabilidad tiene en el IVA del mismo período (para cruzar).
  const iva = {};
  try { CI.rango_(db, 'IVA', periodo, periodo).forEach((r) => { if (!/^ANULAD/.test(String(r.estado || ''))) iva[clave_(r)] = (r.datos || {}).monto_impuesto_unico; }); } catch (e) { /* sin IVA */ }
  const filas = Object.keys(porCli).map((k) => {
    const x = porCli[k];
    const enIva = iva[k];
    const cruce = enIva === undefined ? 'SIN_FILA' : (String(enIva).trim() === '' ? 'VACIO' : (Math.abs(num_(enIva) - x.iusc) < 1 ? 'IGUAL' : 'DISTINTO'));
    return { cliente_id: x.cliente_id, cliente: x.cliente, obras: x.obras.size || x.filas, trabajadores: x.trabajadores, iusc: x.iusc, tres: x.tres, imposiciones: x.imposiciones,
      completo: x.liquidaciones_enviadas === x.filas, liquidaciones_enviadas: x.liquidaciones_enviadas, obras_registradas: x.filas, ultima_recepcion: x.ultima_recepcion,
      iva_contabilidad: enIva === undefined ? null : (String(enIva).trim() === '' ? '' : num_(enIva)), cruce };
  }).sort((a, b) => b.iusc - a.iusc || String(a.cliente).localeCompare(String(b.cliente)));
  // Clientes con sueldos el mes anterior que todavía no envían la información de este mes.
  const ahora = new Set(Object.keys(porCli));
  const faltan = {};
  remuneraciones_(db, CI.moverPeriodo_(periodo, -1)).forEach((r) => { const k = clave_(r); if (!ahora.has(k)) faltan[k] = r.cliente_nombre; });
  const tot = filas.reduce((s, f) => ({ iusc: s.iusc + f.iusc, tres: s.tres + f.tres, trabajadores: s.trabajadores + f.trabajadores, imposiciones: s.imposiciones + f.imposiciones }), { iusc: 0, tres: 0, trabajadores: 0, imposiciones: 0 });
  return {
    periodo, periodo_texto: CI.periodoTexto_(periodo), filas, totales: Object.assign(tot, { clientes: filas.length, con_iusc: filas.filter((f) => f.iusc > 0).length,
      completos: filas.filter((f) => f.completo).length, distintos: filas.filter((f) => f.cruce === 'DISTINTO' || (f.cruce === 'VACIO' && f.iusc > 0)).length }),
    sin_informacion: Object.values(faltan).sort(),
    definicion: 'Sueldos del mes (la información llega entre el 20 del mes y el 10 del siguiente), por cliente, desde la matriz Remuneraciones.'
  };
}

function plataformas(db, data, contexto) {
  if (!puede_(db, contexto, 'COBRANZAS')) return { _forbidden: true, message: 'Este informe lo ven RR.HH. y Facturación y Cobranzas.' };
  const periodo = periodo_(data);
  const grupos = {};
  CI.rango_(db, 'PLATAFORMAS', periodo, periodo).forEach((r) => {
    const d = r.datos || {};
    const plat = String(d.plataforma || 'Sin plataforma').trim();
    const k = clave_(r) + '|' + plat.toUpperCase();
    const g = grupos[k] = grupos[k] || { cliente_id: r.cliente_id || '', cliente: r.cliente_nombre, plataforma: plat, empresa_principal: '', obras: new Set(), cobro: 0, trabajadores_mes: 0, finiquitados: 0, subidas: 0, ultima_subida: '', con_movimiento: false };
    g.subidas++;
    if (d.empresa_principal && !g.empresa_principal) g.empresa_principal = String(d.empresa_principal).trim();
    if (d.obras) g.obras.add(String(d.obras).trim().toUpperCase());
    g.cobro += num_(d.cantidad_trabajadores_le_subio_doc_periodo_cobro);
    // Trabajadores y finiquitados del mes: cada subida repite el total del mes; se toma el mayor.
    g.trabajadores_mes = Math.max(g.trabajadores_mes, num_(d.cantidad_trabajadores_mes));
    g.finiquitados = Math.max(g.finiquitados, num_(d.cantidad_trabajadores_finiquitados_mes));
    if (/CON MOV/i.test(String(d.estado || ''))) g.con_movimiento = true;
    const f = String(d.fecha_subida || '').slice(0, 10);
    if (esFecha_(f) && f > g.ultima_subida) g.ultima_subida = f;
  });
  const filas = Object.values(grupos).map((g) => Object.assign({}, g, { obras: Array.from(g.obras).sort() }))
    .sort((a, b) => b.cobro - a.cobro || String(a.cliente).localeCompare(String(b.cliente)));
  const porCliente = {};
  filas.forEach((f) => { porCliente[f.cliente] = (porCliente[f.cliente] || 0) + f.cobro; });
  return {
    periodo, periodo_texto: CI.periodoTexto_(periodo), filas,
    totales: { clientes: Object.keys(porCliente).length, plataformas: new Set(filas.map((f) => f.plataforma.toUpperCase())).size, cobro: filas.reduce((s, f) => s + f.cobro, 0),
      finiquitados: filas.reduce((s, f) => s + f.finiquitados, 0), subidas: filas.reduce((s, f) => s + f.subidas, 0) },
    definicion: 'Desde la matriz Plataformas externas, por la fecha de subida. «Para el cobro» suma los trabajadores a los que se subió documentación en el mes; trabajadores y finiquitados del mes toman el mayor informado.'
  };
}

module.exports = { impuestoUnico, plataformas, remuneraciones_ };
