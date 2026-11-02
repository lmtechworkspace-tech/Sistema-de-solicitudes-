'use strict';

/**
 * finanzasProyectosFin.js — Proyectos financiados por clientes (Finanzas v5.8, 02-11-2026; reunión con gerencia).
 *
 * «Vamos a hacer el proyecto podcast: buscamos 5 clientes para financiarlo». Cada proyecto tiene una META (cuánto debe
 * financiarse al mes y, si se quiere, en total) y los CLIENTES que lo financian con un porcentaje de lo que pagan
 * (la asignación cliente → proyecto que ya existe en las fichas, con su vigencia). Con la planilla:
 *   aporte del mes      = Σ honorarios del cliente en el mes × su porcentaje
 *   esperado del mes    = Σ mensual de sus servicios vigentes × su porcentaje
 *   cumplimiento        = aporte del mes ÷ meta mensual
 * Así gerencia ve, mes a mes, si cada proyecto va cumpliendo lo esperado y qué cliente no está aportando.
 */

const B = require('./finanzasBoveda');
const Base = require('./finanzasBase');
const F = require('./finanzasBancos');
const { errorValidacion } = require('./errores');

const I = F.interno;
const PER_ = /^\d{4}-\d{2}$/;

function db_() { const d = I.db_(); d.exec('CREATE TABLE IF NOT EXISTS FIN_AJUSTES (clave TEXT PRIMARY KEY, datos TEXT NOT NULL, actualizado_en TEXT, actualizado_por TEXT)'); return d; }
function metas_() {
  const m = new Map();
  db_().prepare("SELECT clave, datos, actualizado_en, actualizado_por FROM FIN_AJUSTES WHERE clave LIKE 'proyecto-fin|%'").all()
    .forEach((r) => { const x = I.des_(r.datos); if (x.activo !== false) m.set(r.clave.slice('proyecto-fin|'.length), Object.assign({ en: r.actualizado_en, por: r.actualizado_por }, x)); });
  return m;
}
function hoyMes_() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()).slice(0, 7); }
function mesMas_(p, n) { const [a, m] = p.split('-').map(Number); return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 7); }
function todosLosProyectos_(db) {
  const l = [];
  try { F.proyectosSigso_(db).forEach((p) => l.push({ id: p.id, codigo: p.codigo, nombre: p.nombre, estado: p.estado, fuente: 'SIGSO' })); } catch (e) { /* sin módulo Proyectos */ }
  try { require('./finanzasPlanificacion').proyectosLegado_().forEach((p) => l.push({ id: p.id, codigo: p.codigo, nombre: p.nombre, estado: p.estado, fuente: 'Finanzas' })); } catch (e) { /* sin legado */ }
  return l;
}
function vigente_(a, mes) {
  const ini = mes + '-01', fin = Base.ultimoDia_(mes);
  return a.estado === 'VIGENTE' && (!a.desde || a.desde <= fin) && (!a.hasta || a.hasta >= ini);
}

const financiamiento = B.conBoveda('', function (db, data) {
  const H = require('./finanzasHoja');
  const ctx = H.contexto_(db);
  const hasta = PER_.test(Base.txt_(data && data.hasta)) ? data.hasta : hoyMes_();
  const n = Math.min(12, Math.max(1, Number(data && data.meses) || 6));
  const meses = []; for (let i = n - 1; i >= 0; i--) meses.push(mesMas_(hasta, -i));
  const metas = metas_();
  let asign = [];
  try { asign = require('./finanzasClientes').asignaciones_(); } catch (e) { asign = []; }
  const todos = todosLosProyectos_(db);
  const conAlgo = todos.filter((p) => metas.has(p.id) || asign.some((a) => a.proyecto_id === p.id && a.estado === 'VIGENTE'));
  const nombreCli = new Map(I.clientes_(db).map((c) => [c.id, c.nombre]));
  // Lo mensual de los servicios vigentes de cada cliente (lo esperado).
  const mensual = new Map();
  try { I.db_().prepare("SELECT datos FROM FIN_SERVICIOS WHERE estado = 'VIGENTE'").all().forEach((r) => { const s = I.des_(r.datos); if (s.modalidad === 'MENSUAL') mensual.set(s.cliente_id, (mensual.get(s.cliente_id) || 0) + (s.monto_neto || 0)); }); } catch (e) { /* sin servicios */ }
  // Honorarios de cada cliente por mes, desde la planilla (solo los clientes que financian algo).
  const interesan = new Set(asign.filter((a) => a.estado === 'VIGENTE').map((a) => a.cliente_id));
  const hon = new Map(); // cliente_id → { mes → monto }
  if (interesan.size) meses.forEach((mes) => [...ctx.cuentas.values()].forEach((cu) => {
    H.construir_(db, cu, mes, ctx).filas.forEach((f) => {
      if (f.monto > 0 && f.que && f.que.k === 'ing' && f.cliente_id && interesan.has(f.cliente_id)) { const o = hon.get(f.cliente_id) || {}; o[mes] = (o[mes] || 0) + f.monto; hon.set(f.cliente_id, o); }
    });
  }));
  const conDatos = meses.filter((m) => I.db_().prepare('SELECT 1 FROM FIN_MOVIMIENTOS WHERE periodo = ? LIMIT 1').get(m));
  const ultimo = conDatos[conDatos.length - 1] || hasta;
  const proyectos = conAlgo.map((p) => {
    const meta = metas.get(p.id) || {};
    const asignados = asign.filter((a) => a.proyecto_id === p.id && a.estado === 'VIGENTE');
    const porMes = {}, esperadoMes = {};
    const clientes = [...new Set(asignados.map((a) => a.cliente_id))].map((cid) => {
      const vig = asignados.filter((a) => a.cliente_id === cid);
      const pctDe = (mes) => { const a = vig.filter((x) => vigente_(x, mes)).sort((x, y) => String(y.desde).localeCompare(String(x.desde)))[0]; return a ? Number(a.porcentaje) || 0 : null; };
      const aporte = {}; let total = 0;
      meses.forEach((mes) => {
        const pct = pctDe(mes); if (pct === null) return;
        const v = Math.round(((hon.get(cid) || {})[mes] || 0) * pct / 100);
        const e = Math.round((mensual.get(cid) || 0) * pct / 100);
        aporte[mes] = v; total += v; porMes[mes] = (porMes[mes] || 0) + v; esperadoMes[mes] = (esperadoMes[mes] || 0) + e;
      });
      const pctHoy = pctDe(ultimo);
      return { cliente_id: cid, cliente: nombreCli.get(cid) || cid, porcentaje: pctHoy === null ? (Number(vig[vig.length - 1].porcentaje) || 0) : pctHoy, mensual: mensual.get(cid) || 0,
        esperado_mes: Math.round((mensual.get(cid) || 0) * (pctHoy || 0) / 100), aporte_mes: aporte[ultimo] || 0, aporte_total: total, por_mes: aporte, vigente: pctHoy !== null };
    }).sort((a, b) => b.aporte_total - a.aporte_total);
    const aporteMes = porMes[ultimo] || 0, total = conDatos.reduce((s, m) => s + (porMes[m] || 0), 0);
    return { id: p.id, codigo: p.codigo, nombre: p.nombre, fuente: p.fuente, estado: p.estado, meta_mensual: meta.meta_mensual || 0, meta_total: meta.meta_total || 0, nota: meta.nota || '',
      clientes, por_mes: porMes, esperado_mes: esperadoMes, aporte_mes: aporteMes, aporte_total: total,
      cumplimiento_mes: meta.meta_mensual ? Math.round(aporteMes / meta.meta_mensual * 100) : null, avance_total: meta.meta_total ? Math.round(total / meta.meta_total * 100) : null,
      sin_aportar: clientes.filter((c) => c.vigente && !c.aporte_mes).map((c) => c.cliente) };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return { meses, meses_con_datos: conDatos, ultimo, proyectos, disponibles: todos.filter((p) => !conAlgo.some((q) => q.id === p.id)).map((p) => ({ id: p.id, nombre: p.nombre, codigo: p.codigo })),
    clientes: I.clientes_(db).map((c) => ({ id: c.id, nombre: c.nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    formulas: { aporte: 'Honorarios del cliente en el mes (planilla) × su porcentaje', esperado: 'Mensual de sus servicios vigentes × su porcentaje', cumplimiento: 'Aporte del mes ÷ meta mensual' } };
});

/** Meta de financiamiento de un proyecto (mensual y total). data: { proyecto_id, meta_mensual, meta_total, nota, activo } */
const guardarMeta = Base.conCapacidad('PLANIFICAR', '', function (db, data, contexto, x) {
  const id = Base.txt_(data && data.proyecto_id);
  const p = todosLosProyectos_(db).find((q) => q.id === id);
  if (!p) return errorValidacion('proyecto_id', 'Ese proyecto no existe.');
  const monto = (v, campo) => { if (Base.txt_(v) === '') return { ok: true, valor: 0 }; const m = Base.montoClp_(String(v)); return m.ok && m.valor >= 0 ? m : { ok: false, error: 'La ' + campo + ' no se entiende.' }; };
  const mm = monto(data.meta_mensual, 'meta mensual'), mt = monto(data.meta_total, 'meta total');
  if (!mm.ok) return errorValidacion('meta_mensual', mm.error);
  if (!mt.ok) return errorValidacion('meta_total', mt.error);
  db_().prepare('INSERT INTO FIN_AJUSTES (clave, datos, actualizado_en, actualizado_por) VALUES (?,?,?,?) ON CONFLICT(clave) DO UPDATE SET datos = excluded.datos, actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por')
    .run('proyecto-fin|' + id, I.cif_({ meta_mensual: mm.valor, meta_total: mt.valor, nota: Base.txt_(data.nota).slice(0, 300), activo: data.activo !== false }), Base.ahora_(), x.nombre);
  x.registrar('PROYECTO_META', p.nombre.slice(0, 60) + ' · ' + Base.plata_(mm.valor) + '/mes');
  return { ok: true };
});

module.exports = { financiamiento, guardarMeta };
