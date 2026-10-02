'use strict';

/**
 * controlInternoConvenios.js — Seguimiento de convenios TGR (2026-10-01).
 *
 * Lo que Francisca hacía en papel: por cada folio imprime "Imprimir cuotas
 * de convenios vigentes" de la TGR y, a mitad de mes, marca a mano cada
 * cuota como pagada (azul), vencida (rojo) y contabilizada (verde); guarda
 * aparte las hojas de los convenios terminados y caídos. Después traspasa a
 * la matriz Convenios (10-15 min por fila, medio día en total).
 *
 * Aquí:
 *  - un convenio = cliente + folio + tipo + fecha + pie + deuda + sus cuotas;
 *  - las cuotas se cargan PEGANDO la tabla que muestra la TGR (no hace falta
 *    imprimir ni guardar claves): cada vez que se pega, se actualiza qué
 *    cuotas da la TGR por pagadas y queda en el historial lo que cambió;
 *  - la revisión manual (pagada / vencida) y "contabilizada" se marcan
 *    cuota por cuota, igual que en la hoja;
 *  - la situación de cada cuota se calcula: pagada (TGR o revisión), vencida
 *    (pasó la fecha y no está pagada) o por vencer;
 *  - "Pasar a la matriz" llena la matriz Convenios del mes (convenio 1…9 con
 *    pie, deuda, folio, cuotas canceladas y vencidas, situación, término y
 *    tipo) desde el seguimiento: se acaba el doble registro.
 *
 * Permisos: los de la matriz Convenios (Contabilidad).
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const CI = require('./controlInterno');
const P = require('./controlInternoPlanillas');

const TIPOS = ['IVA', 'RENTA', 'IVA Y RENTA', 'OTRO'];
const ESTADOS = ['VIGENTE', 'TERMINADO', 'CAIDO'];
const MAX_CUOTAS = 72;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function hoy_() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
function email_(ctx) { return String((ctx && ctx.email) || '').toLowerCase(); }
function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }
function permiso_(db, ctx, que) { return CI.matrizConPermiso_(db, ctx, 'CONVENIOS', que); }
function todos_(db) {
  try { return leerFilas_(db, 'CI_CONVENIOS', COLUMNAS.CI_CONVENIOS).filter((c) => esVerdadero_(c.activa)); } catch (e) { return []; }
}
function porId_(db, id) { return todos_(db).find((c) => c.convenio_id === String(id || '')) || null; }
function cuotas_(c) {
  let l = c && c.cuotas;
  if (typeof l === 'string') { try { l = JSON.parse(l); } catch (e) { l = []; } }
  return Array.isArray(l) ? l : [];
}
function tipo_(v) {
  const s = P.n_(v);
  if (!s) return '';
  if (/IVA/.test(s) && /RENTA/.test(s)) return 'IVA Y RENTA';
  if (/RENTA/.test(s)) return 'RENTA';
  if (/IVA/.test(s)) return 'IVA';
  return 'OTRO';
}
// Pesos chilenos escritos a mano: "150.000" son ciento cincuenta mil (P.numero_ lo
// leería como decimal, que es como viene de Excel).
/** Como se escribe "quién realiza" en la planilla: el primer nombre en mayúsculas (FRANCISCA). */
function nombreCuenta_(db, ctx) {
  const yo = email_(ctx);
  let nombre = (ctx && ctx.nombre) || '';
  if (!nombre) {
    try {
      const c = leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL).find((k) => esVerdadero_(k.activo) && String(k.emails || '').toLowerCase().indexOf(yo) !== -1);
      nombre = (c && c.nombre) || '';
    } catch (e) { /* sin cuentas */ }
  }
  return String(nombre).trim().split(/\s+/)[0].toUpperCase() || yo;
}
function monto_(v) {
  const s = String(v == null ? '' : v).replace(/[$\s]/g, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ''));
  const n = P.numero_(v);
  return n === '' ? '' : n;
}

// --- situación ---------------------------------------------------------------------------
/** Cuota de ajuste: la última, en $0 hasta que la TGR la calcula. No cuenta como impaga. */
function esAjuste_(q, l) { return Number(q.monto) === 0 && q.n === Math.max(...l.map((x) => x.n)); }
function situacionCuota_(q, l, hoy) {
  if (q.tgr === 'SI' || q.revision === 'PAGADA') return 'PAGADA';
  if (esAjuste_(q, l)) return 'AJUSTE';
  if (q.revision === 'VENCIDA' || (RE_FECHA.test(q.vencimiento || '') && q.vencimiento < hoy)) return 'VENCIDA';
  return 'POR_VENCER';
}
function resumen_(c, hoy) {
  const l = cuotas_(c).slice().sort((a, b) => a.n - b.n);
  const h = hoy || hoy_();
  const en7 = new Date(Date.parse(h + 'T12:00:00Z') + 7 * 864e5).toISOString().slice(0, 10);
  let pagadas = 0, vencidas = 0, porContabilizar = 0, total = 0, proxima = null, en7dias = 0;
  const vencidasN = [];
  l.forEach((q) => {
    const s = situacionCuota_(q, l, h);
    if (s !== 'AJUSTE') total++;
    if (s === 'PAGADA') { pagadas++; if (!q.contabilizada) porContabilizar++; }
    if (s === 'VENCIDA') { vencidas++; vencidasN.push(q.n); }
    if (s === 'POR_VENCER') {
      if (!proxima) proxima = { n: q.n, vencimiento: q.vencimiento, monto: q.monto };
      if (q.vencimiento && q.vencimiento <= en7) en7dias++;
    }
  });
  const termino = l.length ? l[l.length - 1].vencimiento || '' : '';
  return { total, pagadas, vencidas, vencidas_n: vencidasN, por_contabilizar: porContabilizar, proxima, vencen_7_dias: en7dias, termino, todas_pagadas: total > 0 && pagadas >= total };
}
function publico_(c, hoy) {
  const l = cuotas_(c).slice().sort((a, b) => a.n - b.n);
  const h = hoy || hoy_();
  return {
    convenio_id: c.convenio_id, cliente_id: c.cliente_id || '', cliente_nombre: c.cliente_nombre || '', cliente_rut: c.cliente_rut || '',
    folio: c.folio || '', tipo: c.tipo || '', fecha_convenio: c.fecha_convenio || '', pie: c.pie === '' ? '' : c.pie, deuda_total: c.deuda_total === '' ? '' : c.deuda_total,
    estado: c.estado || 'VIGENTE', motivo_estado: c.motivo_estado || '', fecha_estado: c.fecha_estado || '',
    fecha_revision_tgr: c.fecha_revision_tgr || '', observaciones: c.observaciones || '', fecha_actualizacion: c.fecha_actualizacion || '',
    cuotas: l.map((q) => Object.assign({}, q, { situacion: situacionCuota_(q, l, h), ajuste: esAjuste_(q, l) })),
    resumen: resumen_(c, h)
  };
}

// --- pegar desde la TGR ----------------------------------------------------------------------
/**
 * Lee la tabla de "Imprimir cuotas de convenios vigentes" tal como se copia
 * de la página (con tabulaciones, espacios o una celda por línea):
 * "(*) 1   31-03-2026   77.717   SI". Devuelve { cuotas, folio }.
 */
function parsearCuotas_(texto) {
  const t = String(texto || '').replace(/ /g, ' ');
  const folio = (t.match(/folio\s*(?:n[°º.]?\s*)?:?\s*(\d{3,})/i) || [])[1] || '';
  const tokens = t.replace(/\(\*\)/g, ' ').split(/[\s\t]+/).filter(Boolean);
  const cuotas = [];
  const vistos = new Set();
  for (let i = 0; i + 3 < tokens.length; i++) {
    const [a, b, c, d] = [tokens[i], tokens[i + 1], tokens[i + 2], tokens[i + 3]];
    if (!/^\d{1,3}$/.test(a)) continue;
    const f = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(b);
    if (!f) continue;
    if (!/^\$?[\d.,]+$/.test(c)) continue;
    const pg = P.n_(d);
    if (pg !== 'SI' && pg !== 'NO') continue;
    const n = Number(a);
    if (n < 1 || n > MAX_CUOTAS || vistos.has(n)) continue;
    vistos.add(n);
    // En la TGR los montos van en pesos con punto de miles (77.717): sin decimales.
    cuotas.push({ n, vencimiento: f[3] + '-' + f[2].padStart(2, '0') + '-' + f[1].padStart(2, '0'), monto: Number(c.replace(/[$.]/g, '').replace(',', '.')) || 0, tgr: pg });
    i += 3;
  }
  return { cuotas: cuotas.sort((x, y) => x.n - y.n), folio };
}
/**
 * La página completa de la TGR (lo que manda el botón "Enviar a SIGSO" o un
 * Ctrl+A / Ctrl+C) puede traer varios convenios: se separa por folio. Las
 * cuotas que aparecen antes del primer folio van con el primero; un folio
 * repetido junta sus cuotas. Sin ningún folio, un solo bloque sin folio.
 * También se busca el RUT del contribuyente (el primero que aparece).
 */
const RE_FOLIO_G = /folio\s*(?:n[°º.]?\s*)?:?\s*(\d{3,})/ig;
const MAX_TEXTO = 400000;
function bloquesTGR_(texto) {
  const t = String(texto || '').slice(0, MAX_TEXTO).replace(/00a0/g, ' ');
  const rut = (t.match(/\b(\d{1,2}\.?\d{3}\.?\d{3}\s*-\s*[\dkK])\b/) || [])[1] || '';
  const marcas = [];
  let m;
  RE_FOLIO_G.lastIndex = 0;
  while ((m = RE_FOLIO_G.exec(t))) marcas.push({ i: m.index, folio: m[1] });
  if (!marcas.length) {
    const p = parsearCuotas_(t);
    return { rut, bloques: p.cuotas.length ? [{ folio: '', cuotas: p.cuotas, texto: t }] : [] };
  }
  const porFolio = new Map();
  marcas.forEach((mk, k) => {
    const tramo = t.slice(k === 0 ? 0 : mk.i, k + 1 < marcas.length ? marcas[k + 1].i : t.length);
    const b = porFolio.get(mk.folio) || { folio: mk.folio, cuotas: [], texto: '' };
    const vistos = new Set(b.cuotas.map((q) => q.n));
    parsearCuotas_(tramo).cuotas.forEach((q) => { if (!vistos.has(q.n)) { b.cuotas.push(q); vistos.add(q.n); } });
    b.texto += '\n' + tramo;
    porFolio.set(mk.folio, b);
  });
  const bloques = Array.from(porFolio.values()).filter((b) => b.cuotas.length);
  bloques.forEach((b) => b.cuotas.sort((x, y) => x.n - y.n));
  return { rut, bloques };
}

/** Une lo pegado con lo que ya había: conserva la revisión manual y "contabilizada". */
function unir_(anteriores, nuevas, hoy) {
  const porN = {};
  anteriores.forEach((q) => { porN[q.n] = Object.assign({}, q); });
  const cambios = [];
  nuevas.forEach((q) => {
    const a = porN[q.n];
    if (!a) { porN[q.n] = { n: q.n, vencimiento: q.vencimiento, monto: q.monto, tgr: q.tgr, revision: '', fecha_revision: '', contabilizada: false, fecha_contabilizada: '' }; cambios.push({ n: q.n, que: 'nueva' }); return; }
    if (a.tgr !== q.tgr) { cambios.push({ n: q.n, que: q.tgr === 'SI' ? 'la TGR la da por pagada' : 'la TGR la da por NO pagada' }); a.tgr = q.tgr; }
    if (a.vencimiento !== q.vencimiento) { cambios.push({ n: q.n, que: 'vencimiento ' + q.vencimiento }); a.vencimiento = q.vencimiento; }
    if (Number(a.monto) !== Number(q.monto)) { cambios.push({ n: q.n, que: 'monto ' + q.monto }); a.monto = q.monto; }
    // Si la TGR ya la da por pagada, la marca manual "vencida" deja de aplicar.
    if (q.tgr === 'SI' && a.revision === 'VENCIDA') { a.revision = 'PAGADA'; a.fecha_revision = hoy; }
  });
  return { cuotas: Object.keys(porN).map((k) => porN[k]).sort((x, y) => x.n - y.n), cambios };
}

/** "10 cuotas nuevas (1-10); cuota 3 la TGR la da por pagada" en vez de una por una. */
function textoCambios_(cambios) {
  const nuevas = cambios.filter((k) => k.que === 'nueva').map((k) => k.n);
  const resto = cambios.filter((k) => k.que !== 'nueva').map((k) => 'cuota ' + k.n + ' ' + k.que);
  const partes = [];
  if (nuevas.length === 1) partes.push('cuota ' + nuevas[0] + ' nueva');
  else if (nuevas.length) partes.push(nuevas.length + ' cuotas nuevas (' + nuevas[0] + '-' + nuevas[nuevas.length - 1] + ')');
  return partes.concat(resto).join('; ');
}

// =========================================================================================
// Acciones
// =========================================================================================

function listar(db, data, contexto) {
  const x = permiso_(db, contexto, 've');
  if (x.error) return x.error;
  const hoy = hoy_();
  const lista = todos_(db).map((c) => publico_(c, hoy));
  const vig = lista.filter((c) => c.estado === 'VIGENTE');
  return {
    puede_registrar: !!x.p.registra, hoy,
    convenios: lista.sort((a, b) => a.cliente_nombre.localeCompare(b.cliente_nombre, 'es') || String(a.fecha_convenio).localeCompare(String(b.fecha_convenio))),
    kpis: {
      vigentes: vig.length,
      cuotas_vencidas: vig.reduce((s, c) => s + c.resumen.vencidas, 0),
      convenios_con_vencidas: vig.filter((c) => c.resumen.vencidas > 0).length,
      por_contabilizar: lista.reduce((s, c) => s + c.resumen.por_contabilizar, 0),
      vencen_7_dias: vig.reduce((s, c) => s + c.resumen.vencen_7_dias, 0),
      sin_cuotas: vig.filter((c) => !c.cuotas.length).length
    },
    clientes: CI.clientes_(db)
  };
}

function get(db, data, contexto) {
  const x = permiso_(db, contexto, 've');
  if (x.error) return x.error;
  const c = porId_(db, data && data.convenio_id);
  if (!c) return { ok: false, message: 'No se encontró el convenio.' };
  const hist = CI.consultar_(db, 'CI_HISTORIAL', { registro_id: c.convenio_id }).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  return { convenio: publico_(c), historial: hist.map((h) => ({ accion: h.accion, detalle: h.detalle, usuario_email: h.usuario_email, fecha: h.fecha })), puede_registrar: !!x.p.registra };
}

/** Crear o editar los datos del convenio (y, si viene `texto`, sus cuotas pegadas). */
function guardar(db, data, contexto) {
  const x = permiso_(db, contexto, 'registra');
  if (x.error) return x.error;
  const d = data || {};
  const existente = d.convenio_id ? porId_(db, d.convenio_id) : null;
  if (d.convenio_id && !existente) return { ok: false, message: 'No se encontró el convenio.' };
  const folio = String(d.folio !== undefined ? d.folio : (existente ? existente.folio : '')).replace(/\D/g, '');
  if (!folio) return { ok: false, message: 'Indica el folio del convenio (sale en la TGR).' };
  const repetido = todos_(db).find((c) => c.folio === folio && (!existente || c.convenio_id !== existente.convenio_id));
  if (repetido) return { ok: false, message: 'El folio ' + folio + ' ya está registrado (' + repetido.cliente_nombre + ').' };
  const cambios = { folio };
  if (d.tipo !== undefined) cambios.tipo = tipo_(d.tipo);
  if (d.fecha_convenio !== undefined) { const f = String(d.fecha_convenio || '').slice(0, 10); if (f && !RE_FECHA.test(f)) return { ok: false, message: 'La fecha del convenio no es válida.' }; cambios.fecha_convenio = f; }
  if (d.pie !== undefined) cambios.pie = monto_(d.pie);
  if (d.deuda_total !== undefined) cambios.deuda_total = monto_(d.deuda_total);
  if (d.observaciones !== undefined) cambios.observaciones = String(d.observaciones || '').trim().slice(0, 2000);
  if (d.cliente_id !== undefined || d.cliente_nombre !== undefined || !existente) {
    const id = String(d.cliente_id || '').trim();
    let cli;
    if (id) {
      const c = CI.clientes_(db).find((k) => k.cliente_id === id);
      if (!c) return { ok: false, message: 'El cliente no está en el catálogo de SIGSO.' };
      cli = { cliente_id: c.cliente_id, cliente_nombre: c.nombre, cliente_rut: c.rut };
    } else {
      const nombre = String(d.cliente_nombre || '').trim();
      if (nombre.length < 2) return { ok: false, message: 'Elige el cliente.' };
      cli = CI.resolverClienteTexto_(CI.contextoClientes_(db), nombre, d.cliente_rut || '', '');
    }
    Object.assign(cambios, cli);
  }
  const ahora = new Date().toISOString(), yo = email_(contexto);
  let id = existente ? existente.convenio_id : crypto.randomUUID();
  let cuotas = existente ? cuotas_(existente) : [];
  let msgCuotas = '';
  if (d.texto) {
    const p = parsearCuotas_(d.texto);
    if (!p.cuotas.length) return { ok: false, message: 'No se reconocieron cuotas en lo pegado. Copia la tabla completa de "Imprimir cuotas" en la TGR.' };
    const u = unir_(cuotas, p.cuotas, hoy_());
    cuotas = u.cuotas;
    cambios.fecha_revision_tgr = hoy_();
    msgCuotas = ' ' + p.cuotas.length + ' cuotas leídas.';
  }
  cambios.cuotas = JSON.stringify(cuotas);
  CI.enTransaccion_(db, () => {
    if (!existente) {
      agregarFila_(db, 'CI_CONVENIOS', Object.assign({
        convenio_id: id, tipo: '', fecha_convenio: '', pie: '', deuda_total: '', estado: 'VIGENTE', motivo_estado: '', fecha_estado: '',
        fecha_revision_tgr: '', observaciones: '', creado_por: yo, fecha_creacion: ahora, actualizado_por: yo, fecha_actualizacion: ahora, activa: true
      }, cambios));
      CI.historial_(db, id, 'CREADO', 'Convenio folio ' + folio + ' · ' + (cambios.cliente_nombre || ''), contexto);
    } else {
      actualizarFilaPorId_(db, 'CI_CONVENIOS', 'convenio_id', id, Object.assign(cambios, { actualizado_por: yo, fecha_actualizacion: ahora }));
      CI.historial_(db, id, 'EDITADO', 'Datos del convenio' + (d.texto ? ' y cuotas pegadas de la TGR' : ''), contexto);
    }
  });
  return { ok: true, convenio: publico_(porId_(db, id)), message: (existente ? 'Guardado.' : 'Convenio creado.') + msgCuotas };
}

/** Pegar la tabla de la TGR: simular muestra qué cambia; si no, se aplica. */
function pegarCuotas(db, data, contexto) {
  const d = data || {};
  const x = permiso_(db, contexto, d.simular ? 've' : 'registra');
  if (x.error) return x.error;
  const c = porId_(db, d.convenio_id);
  if (!c) return { ok: false, message: 'No se encontró el convenio.' };
  const p = parsearCuotas_(d.texto);
  if (!p.cuotas.length) return { ok: false, message: 'No se reconocieron cuotas. En la TGR: "Imprimir cuotas de convenios vigentes" → selecciona la tabla completa → copia → pega aquí.' };
  if (p.folio && p.folio !== c.folio) return { ok: false, message: 'Lo pegado es del folio ' + p.folio + ' y este convenio es el ' + c.folio + '.' };
  const hoy = hoy_();
  const u = unir_(cuotas_(c), p.cuotas, hoy);
  const res = { ok: true, simulado: !!d.simular, leidas: p.cuotas.length, cambios: u.cambios, texto_cambios: textoCambios_(u.cambios), pagadas_tgr: p.cuotas.filter((q) => q.tgr === 'SI').length };
  if (d.simular) return res;
  actualizarFilaPorId_(db, 'CI_CONVENIOS', 'convenio_id', c.convenio_id, { cuotas: JSON.stringify(u.cuotas), fecha_revision_tgr: hoy, actualizado_por: email_(contexto), fecha_actualizacion: new Date().toISOString() });
  CI.historial_(db, c.convenio_id, 'TGR', 'Revisión en la TGR: ' + (u.cambios.length ? res.texto_cambios : 'sin cambios'), contexto);
  res.convenio = publico_(porId_(db, c.convenio_id));
  res.message = u.cambios.length ? u.cambios.length + (u.cambios.length === 1 ? ' cambio' : ' cambios') + ' desde la TGR.' : 'Revisado: la TGR no muestra cambios.';
  return res;
}

/**
 * Recibir la página de la TGR (piloto "Enviar a SIGSO", 2026-10-01): uno o
 * varios convenios de una vez. `simular` muestra, por folio, qué cambia (o
 * que no está en el seguimiento); al aplicar se actualizan los que existen y
 * se crean los folios de `crear` (con el cliente del RUT de la página o el
 * `cliente_id` que se indique). El texto no se guarda: solo las cuotas.
 */
function recibirTGR(db, data, contexto) {
  const d = data || {};
  const x = permiso_(db, contexto, d.simular ? 've' : 'registra');
  if (x.error) return x.error;
  const leido = bloquesTGR_(d.texto);
  if (!leido.bloques.length) return { ok: false, message: 'No se encontraron cuotas en la página. En la TGR abre "Imprimir cuotas de convenios vigentes" y elige el convenio antes de enviar.' };
  const hoy = hoy_();
  const todos = todos_(db);
  let cliente = null;
  if (leido.rut) {
    const c = CI.resolverClienteTexto_(CI.contextoClientes_(db), leido.rut, leido.rut, '');
    if (c && c.cliente_id) cliente = { cliente_id: c.cliente_id, nombre: c.cliente_nombre, rut: c.cliente_rut };
  }
  // La página de la TGR a veces no dice el folio (solo la tabla de cuotas):
  // la persona elige el convenio y llega en `asignar` = { <n° de bloque>: convenio_id }.
  const asignar = d.asignar && typeof d.asignar === 'object' ? d.asignar : {};
  const resultado = leido.bloques.map((b, k) => {
    const base = { folio: b.folio, leidas: b.cuotas.length, pagadas_tgr: b.cuotas.filter((q) => q.tgr === 'SI').length };
    const elegido = asignar[k] ? todos.find((x) => x.convenio_id === String(asignar[k])) : null;
    const c = elegido || (b.folio ? todos.find((x) => x.folio === b.folio) : null);
    if (!c) return Object.assign(base, { nuevo: true });
    const u = unir_(cuotas_(c), b.cuotas, hoy);
    return Object.assign(base, { convenio_id: c.convenio_id, cliente_nombre: c.cliente_nombre, folio_convenio: c.folio, asignado: !!elegido, estado: c.estado || 'VIGENTE', cambios: u.cambios, texto_cambios: textoCambios_(u.cambios) });
  });
  const res = { ok: true, simulado: !!d.simular, rut: leido.rut, cliente, convenios: resultado };
  if (d.simular) return res;

  const crear = new Set((Array.isArray(d.crear) ? d.crear : []).map(String));
  const cliCrear = String(d.cliente_id || (cliente && cliente.cliente_id) || '');
  let actualizados = 0, creados = 0;
  const errores = [];
  leido.bloques.forEach((b, k) => {
    const r = resultado[k];
    if (r.convenio_id) {
      const c = porId_(db, r.convenio_id);
      const u = unir_(cuotas_(c), b.cuotas, hoy);
      actualizarFilaPorId_(db, 'CI_CONVENIOS', 'convenio_id', c.convenio_id, { cuotas: JSON.stringify(u.cuotas), fecha_revision_tgr: hoy, actualizado_por: email_(contexto), fecha_actualizacion: new Date().toISOString() });
      CI.historial_(db, c.convenio_id, 'TGR', 'Recibido desde la TGR: ' + (u.cambios.length ? textoCambios_(u.cambios) : 'sin cambios'), contexto);
      actualizados++;
      return;
    }
    if (!b.folio || !crear.has(b.folio)) return;
    if (!cliCrear) { errores.push('Folio ' + b.folio + ': elige el cliente.'); return; }
    const g = guardar(db, { cliente_id: cliCrear, folio: b.folio, texto: b.texto }, contexto);
    if (g && g.ok) { creados++; Object.assign(r, { nuevo: false, creado: true, convenio_id: g.convenio.convenio_id, cliente_nombre: g.convenio.cliente_nombre }); }
    else errores.push('Folio ' + b.folio + ': ' + ((g && g.message) || 'no se pudo crear.'));
  });
  res.actualizados = actualizados;
  res.creados = creados;
  res.errores = errores;
  res.message = [actualizados ? actualizados + (actualizados === 1 ? ' convenio actualizado' : ' convenios actualizados') : '', creados ? creados + (creados === 1 ? ' creado' : ' creados') : '']
    .filter(Boolean).join(' y ') + (actualizados || creados ? ' desde la TGR.' : 'Nada que aplicar.') + (errores.length ? ' ' + errores.join(' ') : '');
  return res;
}

/** Marcar cuotas: revisión (PAGADA / VENCIDA / '') o contabilizada (true / false). */
function marcarCuotas(db, data, contexto) {
  const x = permiso_(db, contexto, 'registra');
  if (x.error) return x.error;
  const d = data || {};
  const c = porId_(db, d.convenio_id);
  if (!c) return { ok: false, message: 'No se encontró el convenio.' };
  const nums = new Set((Array.isArray(d.numeros) ? d.numeros : []).map(Number).filter((n) => n > 0));
  if (!nums.size) return { ok: false, message: 'Marca al menos una cuota.' };
  if (['revision', 'contabilizada'].indexOf(d.campo) === -1) return { ok: false, message: 'Campo no válido.' };
  if (d.campo === 'revision' && ['PAGADA', 'VENCIDA', ''].indexOf(d.valor) === -1) return { ok: false, message: 'Revisión no válida.' };
  const hoy = hoy_();
  let n = 0;
  const cuotas = cuotas_(c).map((q) => {
    if (!nums.has(q.n)) return q;
    const z = Object.assign({}, q);
    if (d.campo === 'revision') { if (z.revision === d.valor) return q; z.revision = d.valor; z.fecha_revision = d.valor ? hoy : ''; }
    else { const v = !!d.valor; if (!!z.contabilizada === v) return q; z.contabilizada = v; z.fecha_contabilizada = v ? hoy : ''; }
    n++;
    return z;
  });
  if (!n) return { ok: true, convenio: publico_(c), message: 'Sin cambios.' };
  actualizarFilaPorId_(db, 'CI_CONVENIOS', 'convenio_id', c.convenio_id, { cuotas: JSON.stringify(cuotas), actualizado_por: email_(contexto), fecha_actualizacion: new Date().toISOString() });
  const que = d.campo === 'revision' ? (d.valor === 'PAGADA' ? 'pagada' : d.valor === 'VENCIDA' ? 'vencida' : 'sin revisión') : (d.valor ? 'contabilizada' : 'no contabilizada');
  CI.historial_(db, c.convenio_id, 'CUOTAS', 'Cuota' + (n > 1 ? 's ' : ' ') + Array.from(nums).sort((a, b) => a - b).join(', ') + ': ' + que, contexto);
  return { ok: true, convenio: publico_(porId_(db, c.convenio_id)), message: n + (n === 1 ? ' cuota marcada ' : ' cuotas marcadas ') + que + '.' };
}

function cambiarEstado(db, data, contexto) {
  const x = permiso_(db, contexto, 'registra');
  if (x.error) return x.error;
  const d = data || {};
  const c = porId_(db, d.convenio_id);
  if (!c) return { ok: false, message: 'No se encontró el convenio.' };
  if (ESTADOS.indexOf(d.estado) === -1) return { ok: false, message: 'Estado no válido.' };
  if (d.estado === 'CAIDO' && !String(d.motivo || '').trim()) return { ok: false, message: 'Indica por qué cayó el convenio (p. ej., cuotas impagas).' };
  if (c.estado === d.estado) return { ok: true, convenio: publico_(c), message: 'Sin cambios.' };
  actualizarFilaPorId_(db, 'CI_CONVENIOS', 'convenio_id', c.convenio_id, { estado: d.estado, motivo_estado: String(d.motivo || '').trim().slice(0, 500), fecha_estado: hoy_(), actualizado_por: email_(contexto), fecha_actualizacion: new Date().toISOString() });
  const etq = { VIGENTE: 'Vigente', TERMINADO: 'Terminado', CAIDO: 'Caído' };
  CI.historial_(db, c.convenio_id, 'ESTADO', etq[c.estado || 'VIGENTE'] + ' → ' + etq[d.estado] + (d.motivo ? '. ' + d.motivo : ''), contexto);
  return { ok: true, convenio: publico_(porId_(db, c.convenio_id)), message: 'Convenio ' + etq[d.estado].toLowerCase() + '.' };
}

function anular(db, data, contexto) {
  const x = permiso_(db, contexto, 'registra');
  if (x.error) return x.error;
  const c = porId_(db, data && data.convenio_id);
  if (!c) return { ok: false, message: 'No se encontró el convenio.' };
  actualizarFilaPorId_(db, 'CI_CONVENIOS', 'convenio_id', c.convenio_id, { activa: false, actualizado_por: email_(contexto), fecha_actualizacion: new Date().toISOString() });
  CI.historial_(db, c.convenio_id, 'ANULADO', 'Convenio quitado del seguimiento', contexto);
  return { ok: true, message: 'Convenio quitado del seguimiento.' };
}

/**
 * Crear las fichas desde la matriz Convenios de un mes: cada folio que no
 * esté en el seguimiento entra con su fecha, pie, deuda y tipo. Las cuotas
 * se completan después pegando la tabla de la TGR.
 */
function desdeMatriz(db, data, contexto) {
  const d = data || {};
  const x = permiso_(db, contexto, d.simular ? 've' : 'registra');
  if (x.error) return x.error;
  const periodo = CI.RE_PERIODO.test(String(d.periodo || '')) ? d.periodo : CI.moverPeriodo_(CI.periodoActual_(), -1);
  const filas = CI.consultar_(db, 'CI_REGISTROS', { matriz: 'CONVENIOS', periodo, activa: true });
  const existentes = new Set(todos_(db).map((c) => c.folio));
  const nuevos = [];
  filas.forEach((r) => {
    const dt = r.datos || {};
    for (let i = 1; i <= 9; i++) {
      const folio = String(dt['folio_convenio_' + i] == null ? '' : dt['folio_convenio_' + i]).replace(/\.0+$/, '').replace(/\D/g, '');
      if (!folio || existentes.has(folio)) continue;
      existentes.add(folio);
      const caido = /CAIDO/.test(P.n_(dt['situacion_convenio_' + i]));
      nuevos.push({
        folio, cliente_id: r.cliente_id || '', cliente_nombre: r.cliente_nombre || '', cliente_rut: r.cliente_rut || '',
        tipo: tipo_(dt['tipo_convenio_' + i]), fecha_convenio: RE_FECHA.test(String(dt['fecha_realizo_convenio_' + i] || '')) ? dt['fecha_realizo_convenio_' + i] : '',
        pie: monto_(dt['pie_covenio_' + i]), deuda_total: monto_(dt['monto_total_deuda_' + i]), estado: caido ? 'CAIDO' : 'VIGENTE'
      });
    }
  });
  const res = { ok: true, simulado: !!d.simular, periodo, filas: filas.length, nuevos: nuevos.length, ejemplos: nuevos.slice(0, 10).map((k) => k.cliente_nombre + ' · folio ' + k.folio) };
  if (d.simular || !nuevos.length) return Object.assign(res, { message: nuevos.length ? '' : 'No hay folios nuevos en la matriz de ese mes.' });
  const ahora = new Date().toISOString(), yo = email_(contexto);
  CI.enTransaccion_(db, () => {
    nuevos.forEach((k) => {
      const id = crypto.randomUUID();
      agregarFila_(db, 'CI_CONVENIOS', Object.assign({
        convenio_id: id, motivo_estado: k.estado === 'CAIDO' ? 'Marcado caído en la matriz' : '', fecha_estado: k.estado === 'CAIDO' ? hoy_() : '', cuotas: '[]',
        fecha_revision_tgr: '', observaciones: '', creado_por: yo, fecha_creacion: ahora, actualizado_por: yo, fecha_actualizacion: ahora, activa: true
      }, k));
      CI.historial_(db, id, 'CREADO', 'Creado desde la matriz Convenios de ' + CI.periodoTexto_(periodo), contexto);
    });
  });
  res.message = nuevos.length + ' convenios agregados al seguimiento. Falta pegar sus cuotas desde la TGR.';
  return res;
}

/**
 * Llenar la matriz Convenios del mes desde el seguimiento: por cliente, sus
 * convenios vigentes (y los que terminaron o cayeron ese mes) en las
 * columnas Convenio 1…9, como en la planilla.
 */
function aMatriz(db, data, contexto) {
  const d = data || {};
  const x = permiso_(db, contexto, d.simular ? 've' : 'registra');
  if (x.error) return x.error;
  const periodo = CI.RE_PERIODO.test(String(d.periodo || '')) ? d.periodo : CI.periodoActual_();
  const finMes = new Date(Date.UTC(Number(periodo.slice(0, 4)), Number(periodo.slice(6, 8)), 0)).toISOString().slice(0, 10);
  const corte = finMes < hoy_() ? finMes : hoy_();
  const delMes = (f) => f && f.slice(0, 7) === periodo.slice(0, 4) + '-' + periodo.slice(6, 8);
  const porCliente = {};
  todos_(db).forEach((c) => {
    if (c.estado !== 'VIGENTE' && !delMes(c.fecha_estado)) return;
    const k = c.cliente_id || 'N:' + CI.normalizarTexto_(c.cliente_nombre);
    (porCliente[k] = porCliente[k] || []).push(c);
  });
  const filas = CI.consultar_(db, 'CI_REGISTROS', { matriz: 'CONVENIOS', periodo, activa: true });
  const nombreYo = nombreCuenta_(db, contexto);
  const CAMPOS = ['fecha_realizo_convenio_', 'pie_covenio_', 'monto_total_deuda_', 'folio_convenio_', 'cuotas_canceladas_convenio_', 'cuotas_vencidas_convenio_', 'situacion_convenio_', 'termino_convenio_', 'tipo_convenio_'];
  const DE_CUOTAS = ['cuotas_canceladas_convenio_', 'cuotas_vencidas_convenio_', 'situacion_convenio_', 'termino_convenio_'];
  const folioDe = (v) => String(v == null ? '' : v).replace(/\.0+$/, '').replace(/\D/g, '');
  /** Lo que la fila de la matriz ya dice de cada folio (convenio 1…9). */
  function casillas_(fila) {
    const out = [];
    if (!fila) return out;
    const dt = fila.datos || {};
    for (let i = 1; i <= 9; i++) {
      const folio = folioDe(dt['folio_convenio_' + i]);
      if (!folio) continue;
      const v = {};
      CAMPOS.forEach((p) => { v[p] = dt[p + i] == null ? '' : dt[p + i]; });
      out.push({ folio, v });
    }
    return out;
  }
  const plan = [];
  let sinCuotas = 0, conservados = 0;
  Object.keys(porCliente).forEach((k) => {
    const lista = porCliente[k].sort((a, b) => String(a.fecha_convenio).localeCompare(String(b.fecha_convenio)));
    const c0 = lista[0];
    const existente = filas.find((f) => (c0.cliente_id && f.cliente_id === c0.cliente_id) || (!c0.cliente_id && CI.normalizarTexto_(f.cliente_nombre) === CI.normalizarTexto_(c0.cliente_nombre)));
    const previas = casillas_(existente);
    const casillas = lista.map((c) => {
      const antes = (previas.find((p) => p.folio === c.folio) || {}).v || {};
      const v = {
        fecha_realizo_convenio_: c.fecha_convenio || antes.fecha_realizo_convenio_ || '',
        pie_covenio_: c.pie !== '' ? c.pie : (antes.pie_covenio_ || ''),
        monto_total_deuda_: c.deuda_total !== '' ? c.deuda_total : (antes.monto_total_deuda_ || ''),
        folio_convenio_: c.folio,
        tipo_convenio_: c.tipo || antes.tipo_convenio_ || ''
      };
      if (cuotas_(c).length) {
        const r = resumen_(c, corte);
        v.cuotas_canceladas_convenio_ = r.pagadas;
        v.cuotas_vencidas_convenio_ = r.vencidas;
        v.situacion_convenio_ = c.estado === 'CAIDO' ? 'CAÍDO' : (c.estado === 'TERMINADO' ? 'TERMINADO' : (r.vencidas ? r.vencidas + (r.vencidas === 1 ? ' CUOTA VENCIDA' : ' CUOTAS VENCIDAS') : 'AL DIA'));
        v.termino_convenio_ = r.termino;
      } else {
        // Sin cuotas cargadas no se sabe cuántas van pagadas: queda lo que ya dice la matriz.
        sinCuotas++;
        DE_CUOTAS.forEach((p) => { v[p] = antes[p] !== undefined ? antes[p] : ''; });
        if (c.estado === 'CAIDO') v.situacion_convenio_ = 'CAÍDO';
        if (c.estado === 'TERMINADO') v.situacion_convenio_ = 'TERMINADO';
      }
      return v;
    });
    // Los folios que la matriz tiene y el seguimiento no (quitados o nunca creados) se conservan.
    previas.forEach((p) => {
      if (lista.some((c) => c.folio === p.folio)) return;
      conservados++;
      casillas.push(p.v);
    });
    const datos = { convenios: 'SI', cantidad_convenios: Math.min(casillas.length, 9), quien_realiza: nombreYo, fecha_realizacion: hoy_() };
    const antes = (existente && existente.datos) || {};
    const vacio = (x) => x === undefined || x === null || x === '';
    for (let i = 1; i <= 9; i++) {
      const v = casillas[i - 1] || {};
      CAMPOS.forEach((p) => {
        const nuevo = v[p] === undefined ? '' : v[p];
        // Solo se escribe lo que cambia: una casilla vacía que ya estaba vacía no se toca.
        if (vacio(nuevo) && vacio(antes[p + i])) return;
        if (!vacio(antes[p + i]) && String(antes[p + i]) === String(nuevo)) return;
        datos[p + i] = nuevo;
      });
    }
    plan.push({ cliente_id: c0.cliente_id, cliente_nombre: c0.cliente_nombre, existente, datos, demas: casillas.length > 9 });
  });
  const res = {
    ok: true, simulado: !!d.simular, periodo, clientes: plan.length, nuevas: plan.filter((p) => !p.existente).length, actualizadas: plan.filter((p) => p.existente).length,
    sin_cuotas: sinCuotas, conservados, mas_de_9: plan.filter((p) => p.demas).length
  };
  if (d.simular) return res;
  let errores = 0;
  plan.forEach((p) => {
    const r = p.existente
      ? CI.guardar(db, { registro_id: p.existente.registro_id, datos: p.datos }, contexto)
      : CI.guardar(db, { matriz: 'CONVENIOS', periodo, cliente_id: p.cliente_id, cliente_nombre: p.cliente_id ? undefined : p.cliente_nombre, datos: Object.assign({ empresa: p.cliente_nombre }, p.datos) }, contexto);
    if (!r || !r.ok) errores++;
  });
  res.message = 'Matriz Convenios de ' + CI.periodoTexto_(periodo) + ': ' + res.actualizadas + ' filas actualizadas y ' + res.nuevas + ' nuevas' + (errores ? ' (' + errores + ' con error)' : '') + '.';
  return res;
}

module.exports = { listar, get, guardar, pegarCuotas, recibirTGR, marcarCuotas, cambiarEstado, anular, desdeMatriz, aMatriz, parsearCuotas_, bloquesTGR_, situacionCuota_, resumen_, textoCambios_, TIPOS };
