'use strict';

/**
 * controlInternoReportes.js — los reportes de Control interno (2026-10-01).
 * Pedido del dueño: "mejorar bastante el módulo, sobre todo los reportes".
 * Lo que hoy se arma a mano en el Drive o directamente no se saca:
 *
 *  1. informeMensual  — el "INFORME PROCESO MENSUAL" que Contabilidad hace a
 *     mano por matriz (hojas 'Hoja 16' de Acuse y 'Hoja 22' de Contabiliza-
 *     ción): realizado por, período, resumen (clientes activos, pendientes,
 *     cerrados) y detalle. Ahora sale solo, de cualquier matriz y mes.
 *  2. panelHistorico  — 2022-2026: volumen y cierre por mes, año contra año,
 *     montos y días de respuesta; por departamento o por matriz.
 *  3. fichaCliente    — todo lo de un cliente en todas las matrices.
 *  4. personasTiempos — carga por responsable, días de respuesta y lo
 *     pendiente con su antigüedad.
 *
 * Solo datos: la pantalla los dibuja con el motor común de reportes
 * (frontend/js/reportes-v2.js), que también saca el PDF y el Excel.
 * Permisos: los mismos del módulo (cada quien ve los departamentos que ve).
 */

const { MATRICES, DEPARTAMENTOS, matriz_ } = require('./controlInternoMatrices');
const CI = require('./controlInterno');

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

// --- lectura liviana ----------------------------------------------------------------------
/**
 * Filas de varias matrices entre dos períodos. Sin `datos` salvo que se pida
 * (es lo único pesado): con 50.000 filas, leer solo las columnas fijas es
 * ~10x más rápido.
 */
function filas_(db, claves, desde, hasta, conDatos, extra) {
  if (!claves.length) return [];
  const cols = ['registro_id', 'matriz', 'periodo', 'cliente_id', 'cliente_nombre', 'cliente_rut', 'fecha', 'estado', 'responsable_email', 'liberado_por', 'fecha_liberacion'].concat(conDatos ? ['datos'] : []);
  let sql = 'SELECT ' + cols.map((c) => '"' + c + '"').join(', ') + ' FROM "CI_REGISTROS" WHERE "activa" = ? AND "matriz" IN (' + claves.map(() => '?').join(',') + ')';
  const params = [JSON.stringify(true)].concat(claves.map((k) => JSON.stringify(k)));
  if (desde) { sql += ' AND "periodo" >= ?'; params.push(JSON.stringify(desde)); }
  if (hasta) { sql += ' AND "periodo" <= ?'; params.push(JSON.stringify(hasta)); }
  if (extra) { sql += ' AND ' + extra.sql; params.push(...extra.params); }
  return db.prepare(sql).all(...params).map((f) => {
    const o = {};
    cols.forEach((c) => { o[c] = f[c] == null ? '' : JSON.parse(f[c]); });
    return o;
  });
}
function visibles_(db, contexto, depto) {
  const ac = CI.acceso_(db, contexto);
  if (!ac.tieneModulo) return { error: { _forbidden: true, message: 'Tu cuenta no tiene el módulo Control interno.' } };
  const ms = MATRICES.filter((m) => ac.deptos[m.depto] && ac.deptos[m.depto].ve && (!depto || m.depto === depto));
  return { ac, matrices: ms };
}
function dias_(a, b) {
  if (!RE_FECHA.test(String(a || '')) || !RE_FECHA.test(String(b || ''))) return null;
  const d = Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
  return d >= 0 && d <= 365 ? d : null; // fuera de rango = error de tipeo
}
function estadisticas_(lista) {
  const l = lista.filter((n) => n !== null).sort((a, b) => a - b);
  if (!l.length) return { casos: 0, promedio: null, mediana: null, maximo: null };
  const prom = l.reduce((s, n) => s + n, 0) / l.length;
  return { casos: l.length, promedio: Math.round(prom * 10) / 10, mediana: l[Math.floor(l.length / 2)], maximo: l[l.length - 1] };
}
function num_(v) { const n = Number(v); return v === '' || v == null || !isFinite(n) ? null : n; }
function claveResp_(m, r) {
  if (r.responsable_email) return r.responsable_email;
  const c = m && m.columnas.find((x) => x.rol === 'responsable');
  const t = c && r.datos ? String(r.datos[c.clave] || '').trim() : '';
  return t ? 'txt:' + t.toUpperCase() : '';
}
function clienteClave_(r) { return r.cliente_id || 'N:' + CI.normalizarTexto_(r.cliente_nombre); }
function mesesEntre_(desde, hasta) {
  const out = [];
  for (let p = desde; p <= hasta && out.length < 120; p = CI.moverPeriodo_(p, 1)) out.push(p);
  return out;
}

// =========================================================================================
// 1. Informe mensual (el "INFORME PROCESO MENSUAL" de la planilla)
// =========================================================================================
function informeMensual(db, data, contexto) {
  const d = data || {};
  const x = CI.matrizConPermiso_(db, contexto, d.matriz, 've');
  if (x.error) return x.error;
  const m = x.m;
  const periodo = CI.RE_PERIODO.test(String(d.periodo || '')) ? d.periodo : CI.periodoActual_();
  const per = m.tipo === 'lista' ? CI.PERIODO_LISTA : periodo;
  const filas = filas_(db, [m.clave], per, per, true);
  const previas = m.tipo === 'lista' ? [] : filas_(db, [m.clave], CI.moverPeriodo_(periodo, -1), CI.moverPeriodo_(periodo, -1), false);

  const res = CI.resumen_(m, filas);
  const clientes = new Set(filas.map(clienteClave_));
  const clientesPend = new Set(filas.filter((r) => !CI.esFinal_(m, r.estado)).map(clienteClave_));
  const resPrev = CI.resumen_(m, previas);
  // Responsables del mes: correo (si calzó con una cuenta) o el nombre de la planilla.
  const porResp = {};
  filas.forEach((r) => {
    const k = claveResp_(m, r) || '(sin responsable)';
    const o = porResp[k] = porResp[k] || { clave: k, total: 0, terminados: 0, pendientes: 0 };
    o.total++;
    if (CI.esFinal_(m, r.estado)) o.terminados++; else o.pendientes++;
  });
  const montos = (m.montos || []).map((k) => {
    const c = m.columnas.find((y) => y.clave === k);
    const vals = filas.map((r) => num_((r.datos || {})[k])).filter((n) => n !== null);
    return { clave: k, etiqueta: c ? c.etiqueta : k, total: vals.reduce((s, n) => s + n, 0), casos: vals.length };
  }).filter((x2) => x2.casos);
  let tiempos = null;
  if (m.tiempos) {
    const [a, b] = m.tiempos;
    const l = filas.map((r) => dias_((r.datos || {})[a], (r.datos || {})[b]));
    const st = estadisticas_(l);
    const tramos = [[0, 2, '0 a 2 días'], [3, 5, '3 a 5 días'], [6, 10, '6 a 10 días'], [11, 365, 'Más de 10 días']]
      .map(([lo, hi, etq]) => ({ etiqueta: etq, casos: l.filter((n) => n !== null && n >= lo && n <= hi).length }));
    const etq = (k) => (m.columnas.find((c) => c.clave === k) || {}).etiqueta || k;
    tiempos = Object.assign({ desde: etq(a), hasta: etq(b), tramos }, st);
  }
  // Clientes que entran por primera vez a esta matriz (el primer mes con datos no cuenta).
  const nuevosIds = new Set(m.tipo !== 'lista' && !m.sinCliente ? CI.clientesNuevos_(db, m, periodo, filas).nuevos : []);
  const nuevos = Array.from(new Set(filas.filter((r) => nuevosIds.has(r.registro_id)).map((r) => r.cliente_nombre))).sort((a, b) => a.localeCompare(b, 'es'));
  // Detalle: la fila tal cual + su situación (en el orden de la planilla).
  const cResp = m.columnas.find((c) => c.rol === 'responsable');
  const detalle = filas.slice().sort(CI.orden_).map((r) => ({
    registro_id: r.registro_id, cliente_nombre: r.cliente_nombre, cliente_rut: r.cliente_rut, fuera_catalogo: !r.cliente_id,
    responsable_email: r.responsable_email, responsable_texto: cResp ? String((r.datos || {})[cResp.clave] || '') : '',
    estado: r.estado, liberado_por: r.liberado_por, fecha: r.fecha, nuevo: nuevosIds.has(r.registro_id)
  }));
  return {
    matriz: m.clave, nombre: m.nombre, codigo: m.codigo || '', depto: m.depto, tipo: m.tipo, periodo: m.tipo === 'lista' ? '' : periodo,
    estados: m.estados, sin_liberacion: !!m.sinLiberacion,
    resumen: {
      clientes_activos: clientes.size, clientes_pendientes: clientesPend.size, clientes_cerrados: clientes.size - clientesPend.size, clientes_nuevos: nuevos.length,
      filas: res.total, terminados: res.finalizados, pendientes: res.pendientes, liberados: res.liberados, por_liberar: res.por_liberar,
      avance_pct: res.total ? Math.round(100 * res.finalizados / res.total) : null, por_estado: res.por_estado
    },
    anterior: m.tipo === 'lista' ? null : { periodo: CI.moverPeriodo_(periodo, -1), filas: resPrev.total, terminados: resPrev.finalizados, avance_pct: resPrev.total ? Math.round(100 * resPrev.finalizados / resPrev.total) : null },
    por_responsable: Object.values(porResp).sort((a, b) => b.total - a.total),
    montos, tiempos, detalle, clientes_nuevos: nuevos
  };
}

// =========================================================================================
// 2. Panel histórico
// =========================================================================================
function panelHistorico(db, data, contexto) {
  const d = data || {};
  const hasta = CI.RE_PERIODO.test(String(d.hasta || '')) ? d.hasta : CI.periodoActual_();
  const desde = CI.RE_PERIODO.test(String(d.desde || '')) ? d.desde : '2022-M01';
  if (desde > hasta) return { ok: false, message: 'El rango está al revés.' };
  let ms;
  if (d.matriz) {
    const x = CI.matrizConPermiso_(db, contexto, d.matriz, 've');
    if (x.error) return x.error;
    ms = [x.m];
  } else {
    const v = visibles_(db, contexto, d.depto);
    if (v.error) return v.error;
    ms = v.matrices;
  }
  ms = ms.filter((m) => m.tipo !== 'lista');
  const conDatos = !!d.matriz;
  const filas = filas_(db, ms.map((m) => m.clave), desde, hasta, conDatos);
  const meses = mesesEntre_(desde, hasta);
  const porMatriz = {};
  ms.forEach((m) => { porMatriz[m.clave] = { m, filas: [] }; });
  filas.forEach((r) => { if (porMatriz[r.matriz]) porMatriz[r.matriz].filas.push(r); });

  const serie = meses.map((p) => {
    let total = 0, term = 0;
    ms.forEach((m) => porMatriz[m.clave].filas.forEach((r) => { if (r.periodo === p) { total++; if (CI.esFinal_(m, r.estado)) term++; } }));
    return { periodo: p, total, terminados: term, pendientes: total - term, avance_pct: total ? Math.round(100 * term / total) : null };
  });
  // Año contra año: filas por mes del año (1..12) en cada año del rango.
  const anios = Array.from(new Set(meses.map((p) => p.slice(0, 4))));
  const anioContraAnio = anios.map((a) => ({ anio: a, meses: Array.from({ length: 12 }, (_, i) => {
    const s = serie.find((x2) => x2.periodo === a + '-M' + String(i + 1).padStart(2, '0'));
    return s ? s.total : null;
  }) }));
  const matrices = ms.map((m) => {
    const fl = porMatriz[m.clave].filas;
    const r = CI.resumen_(m, fl);
    const ult = fl.reduce((mx, x2) => (x2.periodo > mx ? x2.periodo : mx), '');
    return { clave: m.clave, nombre: m.nombre, depto: m.depto, seccion: m.seccion, filas: r.total, terminados: r.finalizados, pendientes: r.pendientes, avance_pct: r.total ? Math.round(100 * r.finalizados / r.total) : null, ultimo_periodo: ult, clientes: new Set(fl.map(clienteClave_)).size };
  }).filter((x2) => x2.filas).sort((a, b) => b.filas - a.filas);

  let detalleMatriz = null;
  if (d.matriz) {
    const m = ms[0];
    const fl = porMatriz[m.clave].filas;
    const montos = (m.montos || []).map((k) => {
      const c = m.columnas.find((y) => y.clave === k);
      return { clave: k, etiqueta: c ? c.etiqueta : k, por_mes: meses.map((p) => fl.filter((r) => r.periodo === p).reduce((s, r) => s + (num_((r.datos || {})[k]) || 0), 0)) };
    }).filter((x2) => x2.por_mes.some((v) => v));
    let tiempos = null;
    if (m.tiempos) {
      const [a, b] = m.tiempos;
      tiempos = { por_mes: meses.map((p) => estadisticas_(fl.filter((r) => r.periodo === p).map((r) => dias_((r.datos || {})[a], (r.datos || {})[b]))).promedio) };
    }
    detalleMatriz = { montos, tiempos, clientes_por_mes: meses.map((p) => new Set(fl.filter((r) => r.periodo === p).map(clienteClave_)).size) };
  }
  return { desde, hasta, meses, serie, anio_contra_anio: anioContraAnio, matrices, detalle_matriz: detalleMatriz, depto: d.depto || '', matriz: d.matriz || '' };
}

// =========================================================================================
// 3. Ficha por cliente
// =========================================================================================
/** Clientes con filas en el módulo (para buscar): nombre, si está en el catálogo y cuántas filas tiene. */
function buscarClientes(db, data, contexto) {
  const v = visibles_(db, contexto);
  if (v.error) return v.error;
  const q = CI.normalizarTexto_((data && data.q) || '');
  const claves = v.matrices.map((m) => m.clave);
  const filas = db.prepare('SELECT "cliente_id", "cliente_nombre", "cliente_rut", COUNT(*) AS n FROM "CI_REGISTROS" WHERE "activa" = ? AND "matriz" IN (' + claves.map(() => '?').join(',') + ') GROUP BY "cliente_id", "cliente_nombre"')
    .all(JSON.stringify(true), ...claves.map((k) => JSON.stringify(k)));
  const mapa = {};
  filas.forEach((f) => {
    const id = f.cliente_id ? JSON.parse(f.cliente_id) : '';
    const nombre = f.cliente_nombre ? JSON.parse(f.cliente_nombre) : '';
    if (!nombre) return;
    const k = id || 'N:' + CI.normalizarTexto_(nombre);
    const o = mapa[k] = mapa[k] || { cliente_id: id, cliente_nombre: nombre, cliente_rut: f.cliente_rut ? JSON.parse(f.cliente_rut) : '', filas: 0 };
    o.filas += f.n;
  });
  let lista = Object.values(mapa);
  if (q) lista = lista.filter((c) => CI.normalizarTexto_(c.cliente_nombre + ' ' + c.cliente_rut).indexOf(q) !== -1);
  return { clientes: lista.sort((a, b) => b.filas - a.filas).slice(0, 40) };
}
function fichaCliente(db, data, contexto) {
  const d = data || {};
  const v = visibles_(db, contexto);
  if (v.error) return v.error;
  const id = String(d.cliente_id || '').trim();
  const nombre = String(d.cliente_nombre || '').trim();
  if (!id && !nombre) return { ok: false, message: 'Elige un cliente.' };
  const extra = id ? { sql: '"cliente_id" = ?', params: [JSON.stringify(id)] } : { sql: '"cliente_nombre" = ?', params: [JSON.stringify(nombre)] };
  const filas = filas_(db, v.matrices.map((m) => m.clave), '', '', true, extra);
  const actual = CI.periodoActual_();
  const hace12 = CI.moverPeriodo_(actual, -11);
  const porMatriz = v.matrices.map((m) => {
    const fl = filas.filter((r) => r.matriz === m.clave);
    if (!fl.length) return null;
    const r = CI.resumen_(m, fl);
    const ult = fl.slice().sort((a, b) => String(b.periodo).localeCompare(String(a.periodo)) || CI.orden_(b, a))[0];
    const montos = (m.montos || []).map((k) => {
      const c = m.columnas.find((y) => y.clave === k);
      const porAnio = {};
      fl.forEach((x2) => { const n = num_((x2.datos || {})[k]); if (n !== null) { const a = x2.periodo.slice(0, 4); porAnio[a] = (porAnio[a] || 0) + n; } });
      return { etiqueta: c ? c.etiqueta : k, por_anio: porAnio };
    }).filter((x2) => Object.keys(x2.por_anio).length);
    return {
      clave: m.clave, nombre: m.nombre, depto: m.depto, tipo: m.tipo, filas: r.total, terminados: r.finalizados, pendientes: r.pendientes,
      ultimo_periodo: m.tipo === 'lista' ? '' : ult.periodo, ultima_situacion: ult.estado, ultima_situacion_texto: (CI.estadoDef_(m, ult.estado) || {}).etiqueta || ult.estado,
      ultimos_12: fl.filter((x2) => x2.periodo >= hace12).length, montos
    };
  }).filter(Boolean);
  // Pendientes del cliente, de lo más antiguo a lo más nuevo.
  const pendientes = filas.filter((r) => { const m = matriz_(r.matriz); return m && m.tipo !== 'lista' && !CI.esFinal_(m, r.estado); })
    .sort((a, b) => String(a.periodo).localeCompare(String(b.periodo)))
    .slice(0, 100).map((r) => { const m = matriz_(r.matriz); return { registro_id: r.registro_id, matriz: r.matriz, matriz_nombre: m.nombre, periodo: r.periodo, estado: r.estado, estado_texto: (CI.estadoDef_(m, r.estado) || {}).etiqueta || r.estado, responsable_email: r.responsable_email }; });
  // Actividad por mes (últimos 24): cuántas filas tuvo en cada matriz.
  const meses = mesesEntre_(CI.moverPeriodo_(actual, -23), actual);
  const actividad = meses.map((p) => ({ periodo: p, filas: filas.filter((r) => r.periodo === p).length }));
  const primero = filas.filter((r) => r.periodo !== CI.PERIODO_LISTA).reduce((mn, r) => (!mn || r.periodo < mn ? r.periodo : mn), '');
  const muestra = filas.find((r) => r.cliente_nombre) || {};
  return {
    cliente_id: id, cliente_nombre: muestra.cliente_nombre || nombre, cliente_rut: muestra.cliente_rut || '', fuera_catalogo: !id,
    desde: primero, total_filas: filas.length, matrices: porMatriz, pendientes, actividad,
    deptos: DEPARTAMENTOS.filter((dp) => porMatriz.some((x2) => x2.depto === dp.clave)).map((dp) => ({ clave: dp.clave, nombre: dp.nombre }))
  };
}

// =========================================================================================
// 4. Personas y tiempos
// =========================================================================================
function personasTiempos(db, data, contexto) {
  const d = data || {};
  const v = visibles_(db, contexto, d.depto);
  if (v.error) return v.error;
  const hasta = CI.RE_PERIODO.test(String(d.hasta || '')) ? d.hasta : CI.periodoActual_();
  const desde = CI.RE_PERIODO.test(String(d.desde || '')) ? d.desde : CI.moverPeriodo_(hasta, -11);
  const ms = v.matrices.filter((m) => m.tipo !== 'lista' && (!d.matriz || m.clave === d.matriz));
  const filas = filas_(db, ms.map((m) => m.clave), desde, hasta, true);
  const porM = {};
  ms.forEach((m) => { porM[m.clave] = m; });
  const hoy = new Date().toISOString().slice(0, 10);

  const personas = {};
  const tiemposMatriz = {};
  const pendientes = [];
  filas.forEach((r) => {
    const m = porM[r.matriz];
    const k = claveResp_(m, r) || '(sin responsable)';
    const p = personas[k] = personas[k] || { clave: k, total: 0, terminados: 0, pendientes: 0, liberados: 0, matrices: {}, dias: [] };
    p.total++;
    const fin = CI.esFinal_(m, r.estado);
    if (fin) p.terminados++; else p.pendientes++;
    if (r.liberado_por) p.liberados++;
    p.matrices[m.clave] = (p.matrices[m.clave] || 0) + 1;
    if (m.tiempos) {
      const dd = dias_((r.datos || {})[m.tiempos[0]], (r.datos || {})[m.tiempos[1]]);
      if (dd !== null) { p.dias.push(dd); (tiemposMatriz[m.clave] = tiemposMatriz[m.clave] || []).push(dd); }
    }
    if (!fin) {
      // Antigüedad: desde la fecha de la fila (o el fin de su mes si no tiene).
      const base = RE_FECHA.test(String(r.fecha || '')) ? r.fecha : (r.periodo.slice(0, 4) + '-' + r.periodo.slice(6, 8) + '-28');
      const dias = Math.max(0, Math.round((Date.parse(hoy + 'T12:00:00Z') - Date.parse(base + 'T12:00:00Z')) / 86400000));
      pendientes.push({ registro_id: r.registro_id, matriz: m.clave, matriz_nombre: m.nombre, periodo: r.periodo, cliente_nombre: r.cliente_nombre, responsable: k, dias, estado_texto: (CI.estadoDef_(m, r.estado) || {}).etiqueta || r.estado });
    }
  });
  const listaPersonas = Object.values(personas).map((p) => {
    const st = estadisticas_(p.dias);
    return { clave: p.clave, total: p.total, terminados: p.terminados, pendientes: p.pendientes, liberados: p.liberados, avance_pct: p.total ? Math.round(100 * p.terminados / p.total) : null, dias_promedio: st.promedio, dias_mediana: st.mediana, casos_tiempo: st.casos, matrices: Object.keys(p.matrices).map((k) => ({ clave: k, nombre: porM[k].nombre, filas: p.matrices[k] })).sort((a, b) => b.filas - a.filas) };
  }).sort((a, b) => b.total - a.total);
  const tramos = [[0, 30, 'Hasta 30 días'], [31, 90, '31 a 90 días'], [91, 180, '91 a 180 días'], [181, 100000, 'Más de 180 días']]
    .map(([lo, hi, etq]) => ({ etiqueta: etq, casos: pendientes.filter((x2) => x2.dias >= lo && x2.dias <= hi).length }));
  const tiempos = Object.keys(tiemposMatriz).map((k) => {
    const m = porM[k];
    const etq = (c) => (m.columnas.find((y) => y.clave === c) || {}).etiqueta || c;
    return Object.assign({ clave: k, nombre: m.nombre, desde: etq(m.tiempos[0]), hasta: etq(m.tiempos[1]) }, estadisticas_(tiemposMatriz[k]));
  }).sort((a, b) => (b.promedio || 0) - (a.promedio || 0));
  return {
    desde, hasta, depto: d.depto || '', personas: listaPersonas, tiempos, tramos_pendientes: tramos,
    pendientes_antiguos: pendientes.sort((a, b) => b.dias - a.dias).slice(0, 60), total_pendientes: pendientes.length
  };
}

module.exports = { informeMensual, panelHistorico, buscarClientes, fichaCliente, personasTiempos };
