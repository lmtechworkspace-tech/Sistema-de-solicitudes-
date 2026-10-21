'use strict';

/**
 * aceptacion-fuentes-reales.js — I13: aceptación con las FUENTES REALES (cartolas BCI de
 * julio, detalle «Mis Movimientos», Excel BANCOS julio/agosto, planilla SIGECO) sobre una
 * bóveda TEMPORAL en la carpeta temporal del sistema, que se borra al terminar.
 * Casos: T01/T02, T04/QA-R16, QA-R17/T07–T09 (de grupo de la planilla a gestión), T10, T37/T42.
 *
 *   node backend/herramientas/finanzas-demo/aceptacion-fuentes-reales.js <carpeta datos-iniciales>
 *
 * La carpeta de datos (confidencial) NO está en el repositorio ni se versiona. Imprime solo
 * totales, conteos y resultados por caso: nunca filas, glosas ni importes de movimientos.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SIGSO = path.resolve(__dirname, '../../..') + '/';
if (!process.argv[2]) { console.error('Uso: aceptacion-fuentes-reales.js <carpeta datos-iniciales>'); process.exit(1); }
const R = path.resolve(process.argv[2]) + '/';
const L = require(SIGSO + 'frontend/js/lector-xlsx.js');
const { preparar } = require(SIGSO + 'backend/test/_finanzasPrueba.js');
const despues = [];
const t = { after: (f) => despues.push(f) };
const { db, ctx, D, dir } = preparar(t);
if (!/sigso-finv2-/.test(dir)) throw new Error('solo en bóveda temporal');
const F = require(SIGSO + 'backend/logica/finanzasBancos.js');
const Pg = require(SIGSO + 'backend/logica/finanzasPagadores.js');
const Ca = require(SIGSO + 'backend/logica/finanzasCargas.js');
const Op = require(SIGSO + 'backend/logica/finanzasOperaciones.js');
const { agregarFila_ } = require(SIGSO + 'backend/db/sqliteRepo');
const out = {};
const leer = async (p) => { const b = fs.readFileSync(p); return L.leer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), { formulas: true }); };
const hash = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const ok = (r) => { if (r && (r._validationError || r._forbidden || r.ok === false)) throw new Error(JSON.stringify(r).slice(0, 300)); return r; };

(async () => {
  // ---- T01 · tres cartolas BCI de julio ----
  const carp = R + '02-cartolas-BCI-julio-2026/';
  const arch = fs.readdirSync(carp).filter((a) => /\.xlsx$/.test(a)).sort();
  const revs = [];
  for (const a of arch) {
    const filas = (await leer(carp + a))[0].filas;
    const rv = ok(F.revisarCartola(db, D({ filas }), ctx));
    const im = ok(F.importarCartola(db, D({ filas, empresa: 'HomePymes', nombre_archivo: a }), ctx));
    revs.push({ archivo: a, movimientos: rv.movimientos, cuadra: rv.cuadra, nuevas: im.nuevas, repetidas: im.repetidas, saldo_anterior: rv.saldo_anterior, saldo_final: rv.saldo_final, cargos: rv.total_cargos, abonos: rv.total_abonos, filas });
  }
  const sum = (k) => revs.reduce((s, r) => s + r[k], 0);
  const enBoveda = B().prepare('SELECT COUNT(*) n FROM FIN_MOVIMIENTOS').get().n;
  const movs = ['2026-06', '2026-07'].flatMap((p) => F.movimientos(db, D({ periodo: p }), ctx).movimientos);
  out.T01 = { archivos: revs.map((r) => ({ archivo: r.archivo, movimientos: r.movimientos, cuadra: r.cuadra, nuevas: r.nuevas, repetidas: r.repetidas })),
    movimientos_leidos: sum('movimientos'), movimientos_en_boveda: enBoveda, apertura: revs[0].saldo_anterior, abonos: sum('abonos'), cargos: sum('cargos'), cierre: revs[revs.length - 1].saldo_final,
    abonos_boveda: movs.reduce((s, m) => s + (m.abono || 0), 0), cargos_boveda: movs.reduce((s, m) => s + (m.cargo || 0), 0),
    encadena: revs.every((r, i) => i === 0 || r.saldo_anterior === revs[i - 1].saldo_final) };
  // ---- T02 · el mismo archivo otra vez + una exportación solapada (detalle del banco) ----
  const rep = revs.map((r) => ok(F.importarCartola(db, D({ filas: r.filas, empresa: 'HomePymes', nombre_archivo: r.archivo + ' (otra vez)' }), ctx)));
  const det = R + '03-detalle-banco-Mis-Movimientos/';
  const detA = fs.readdirSync(det).find((a) => /\.xlsx$/.test(a));
  const cuenta = B().prepare('SELECT id FROM FIN_CUENTAS').get().id;
  const dfilas = (await leer(det + detA))[0].filas;
  const di = Pg.importarDetalle(db, D({ filas: dfilas, cuenta, nombre_archivo: detA }), ctx);
  const di2 = Pg.importarDetalle(db, D({ filas: dfilas, cuenta, nombre_archivo: detA }), ctx);
  out.T02 = { reimportar_nuevas: rep.map((r) => r.nuevas), movimientos_tras_reimportar: B().prepare('SELECT COUNT(*) n FROM FIN_MOVIMIENTOS').get().n,
    detalle: di._validationError ? { error: di.message } : { resumen: resumir(di) }, detalle_otra_vez: di2._validationError ? { error: di2.message } : { resumen: resumir(di2) },
    movimientos_tras_detalle: B().prepare('SELECT COUNT(*) n FROM FIN_MOVIMIENTOS').get().n,
    con_pagador: ['2026-06', '2026-07'].flatMap((p) => F.movimientos(db, D({ periodo: p }), ctx).movimientos).filter((m) => m.detalle && m.detalle.pagador).length };

  // ---- T04 / QA-R16 · Excel BANCOS julio y agosto ----
  const bc = R + '04-excel-BANCOS-2026/';
  const libro = async (a) => ({ nombre: a, hash: hash(bc + a), hojas: (await leer(bc + a)).map((h) => ({ nombre: h.hoja, oculta: !!h.oculta, filas: h.filas, formulas: h.formulas || [] })) });
  const lj = await libro('BANCOS 2026 - Julio.xlsx'), la = await libro('BANCOS 2026 - Agosto.xlsx');
  const cj = ok(Ca.cargar(db, D(lj), ctx));
  const ca = ok(Ca.cargar(db, D(la), ctx));
  const cjRep = Ca.cargar(db, D(lj), ctx);
  const pubJ = {};
  for (const h of cj.hojas) pubJ[h.nombre] = ok(Ca.publicar(db, D({ lote_id: cj.lote_id, hoja: h.nombre, cuenta_ref: /BCI/.test(h.nombre) ? cuenta : '' }), ctx)).resultado;
  const opsTrasJ = Op.listar(db, D({}), ctx).operaciones.length;
  const pubA = {};
  for (const h of ca.hojas) pubA[h.nombre] = ok(Ca.publicar(db, D({ lote_id: ca.lote_id, hoja: h.nombre, cuenta_ref: /BCI/.test(h.nombre) ? cuenta : '' }), ctx)).resultado;
  const opsTrasA = Op.listar(db, D({}), ctx).operaciones.length;
  const pubJ2 = {};
  for (const h of cj.hojas) pubJ2[h.nombre] = ok(Ca.publicar(db, D({ lote_id: cj.lote_id, hoja: h.nombre, cuenta_ref: /BCI/.test(h.nombre) ? cuenta : '' }), ctx)).resultado;
  const opsTrasRep = Op.listar(db, D({}), ctx).operaciones.length;
  const cuadroJ = ok(Ca.cuadroControl(db, D({ lote_id: cj.lote_id }), ctx));
  out.T04 = { tipo: [cj.tipo, ca.tipo], hojas_julio: cj.hojas.map((h) => ({ hoja: h.nombre, oculta: !!h.oculta, filas: h.filas, repetidas: h.repetidas })),
    hojas_agosto: ca.hojas.map((h) => ({ hoja: h.nombre, oculta: !!h.oculta, filas: h.filas, repetidas: h.repetidas })), mismo_archivo_otra_vez: !!cjRep.repetido,
    publicar_julio: pubJ, publicar_agosto: pubA, publicar_julio_otra_vez: pubJ2, operaciones: { tras_julio: opsTrasJ, tras_agosto: opsTrasA, tras_repetir: opsTrasRep },
    cuadro_julio: cuadroJ.hojas.map((h) => ({ hoja: h.hoja, leidas: h.leidas, por_estado: h.por_estado, importe_sin_resolver: h.importe_sin_resolver, montos_no_leibles: h.montos_no_leibles, motivos: h.motivos.slice(0, 4) })) };

  // ---- QA-R17 / T07–T09 · grupos de fondos de la planilla (UNITARIO) ----
  const grupos = ok(Ca.candidatas(db, D({ lote_id: cj.lote_id }), ctx)).grupos.concat(ok(Ca.candidatas(db, D({ lote_id: ca.lote_id }), ctx)).grupos);
  const caso = (re) => grupos.filter((g) => g.miembros.some((m) => re.test(String(m.alias || '')))).map((g) => ({
    libro: grupos.indexOf(g) < ok(Ca.candidatas(db, D({ lote_id: cj.lote_id }), ctx)).grupos.length ? 'julio' : 'agosto',
    filas: g.miembros.length, entradas: g.miembros.filter((m) => m.monto > 0).length, salidas: g.miembros.filter((m) => m.monto < 0).length,
    destinos: [...new Set(g.miembros.filter((m) => m.monto < 0).map((m) => m.plan).filter(Boolean))].length,
    suma_sistema: g.suma, remanente_planilla: g.remanente_planilla }));
  out.QA_R17 = { grupos_candidatos: grupos.length, ARMA_HIERRO: caso(/ARMA/i), VYE: caso(/^\s*VYE|V\s*Y\s*E/i), ELOHIM: caso(/ELOHIM/i) };
  // ---- T10 · pagador KRAKEN: se enseñan los nombres cortos como clientes (catálogo sintético con esos nombres) y se reaprende ----
  ['ELOHIM', 'KRAKEN', 'WWL', 'ARMA HIERRO'].forEach((n, i) => agregarFila_(db, 'CAT_CLIENTES', { cliente_id: 'K-' + i, razon_social: n + ' SPA (catálogo de prueba)', rut: '7' + i + '.000.000-' + i, activo: true }));
  ok(Pg.guardarAlias(db, D({ alias: ['ELOHIM', 'KRAKEN', 'WWL', 'ARMA HIERRO'].map((n, i) => ({ alias: n, clase: 'cliente', cliente_id: 'K-' + i })) }), ctx));
  const hojaBci = lj.hojas.find((h) => /BCI/.test(h.nombre));
  const apr = ok(Pg.aprenderExcelBancos(db, D({ filas: hojaBci.filas, cuenta }), ctx));
  const movsK2 = ['2026-06', '2026-07'].flatMap((p) => F.movimientos(db, D({ periodo: p }), ctx).movimientos).filter((m) => /KRAKEN/i.test(JSON.stringify([m.glosa, m.detalle])));
  const pagadoresK = [...new Set(movsK2.map((m) => m.detalle && m.detalle.pagador).filter(Boolean))];
  out.T10_aprendido = { emparejadas: apr.emparejadas, pagadores_aprendidos: apr.pagadores_aprendidos,
    movimientos_kraken: movsK2.length, clientes_por_movimiento: [...new Set(movsK2.map((m) => m.sugerencia && m.sugerencia.cliente_id).filter(Boolean))].length,
    pagador: pagadoresK.map((p) => { const x = Pg.pagadorDe_(p); return { clientes: x ? Object.keys(x.clientes).length : 0 }; }),
    sugerencia_nueva: (() => { const m = { abono: 100, cargo: 0, fecha: '2026-08-01', detalle: { pagador: pagadoresK[0] } }; const s = Pg.sugerirConPagador_(m, Object.assign({}, { pagadores: (() => { const mm = new Map(); B().prepare('SELECT huella, datos FROM FIN_PAGADORES').all().forEach((r) => mm.set(r.huella, require(SIGSO + 'backend/logica/finanzasBase.js').des_(r.datos))); return mm; })(), tipoPorCliente: new Map(), clientes: [] }), {}); return s ? { certeza: s.certeza, opciones: (s.opciones || []).length, cliente_fijo: !!s.cliente_id } : null; })() };
  // ---- QA-R17 · de grupo candidato a gestión: se confirma lo que la planilla sugiere para esos movimientos y se crea la gestión ----
  ok(Pg.guardarAlias(db, D({ alias: [{ alias: 'VYE', clase: 'cliente', cliente_id: 'K-4' }] }), (agregarFila_(db, 'CAT_CLIENTES', { cliente_id: 'K-4', razon_social: 'VYE SPA (catálogo de prueba)', rut: '74.000.000-4', activo: true }), ctx)));
  ok(Pg.aprenderExcelBancos(db, D({ filas: hojaBci.filas, cuenta }), ctx));
  const gj = ok(Ca.candidatas(db, D({ lote_id: cj.lote_id }), ctx)).grupos;
  const convertir = (re, cliente, esperado) => {
    const i = gj.findIndex((g) => g.remanente_planilla === esperado && g.miembros.some((m) => re.test(String(m.alias || ''))));
    if (i === -1) return { error: 'grupo no encontrado' };
    // Confirmar, para los movimientos del grupo, la clasificación que dejó la planilla (lo que haría la operadora al revisarla).
    const pend = ['2026-06', '2026-07'].flatMap((p) => F.movimientos(db, D({ periodo: p }), ctx).movimientos).filter((m) => m.estado === 'PENDIENTE');
    const items = [];
    gj[i].miembros.forEach((mm) => {
      // Mismo criterio que el sistema: monto exacto y fecha a ±3 días, el más cercano.
      const dif = (x) => Math.abs(Date.parse(x.fecha) - Date.parse(mm.fecha));
      const m = pend.filter((x) => dif(x) <= 3 * 864e5 && (mm.monto > 0 ? x.abono === mm.monto : x.cargo === -mm.monto) && items.every((y) => y.id !== x.id)).sort((a, b) => dif(a) - dif(b))[0];
      if (m && m.sugerencia && m.sugerencia.tipo) items.push({ id: m.id, expected_version: m.version, recordar: false, tipo: m.sugerencia.tipo, subtipo: m.sugerencia.tipo === 'FONDO_RECIBIDO' ? 'RECEPCION' : 'PAGO_OBLIGACION', cuenta: m.sugerencia.cuenta, cliente_id: cliente });
    });
    const cl = F.clasificar(db, D({ items }), ctx);
    const r = Ca.crearGestionDeCandidata(db, D({ lote_id: cj.lote_id, indice: i, cliente_id: cliente, obligacion: 'Imposiciones', periodo_obligacion: '2026-06' }), ctx);
    return r._validationError ? { error: r.message, clasificados: cl.hechos } : { clasificados: cl.hechos, miembros: gj[i].miembros.length, asignadas: r.asignadas, por_revisar: r.revisar.length, saldo_sistema: r.saldo_sistema, remanente_planilla: r.remanente_planilla, diferencia: r.diferencia };
  };
  out.QA_R17_gestion = { ARMA_HIERRO: convertir(/ARMA/i, 'K-3', 101739), VYE: convertir(/^\s*VYE/i, 'K-4', 0), ELOHIM: convertir(/ELOHIM/i, 'K-0', -1) };
  // ---- T10 · pagador KRAKEN ----
  const kr = grupos.filter((g) => g.miembros.some((m) => /KRAKEN/i.test(String(m.alias || '') + ' ' + String(m.obs || ''))));
  const movsK = ['2026-06', '2026-07', '2026-08'].flatMap((p) => F.movimientos(db, D({ periodo: p }), ctx).movimientos).filter((m) => /KRAKEN/i.test(JSON.stringify([m.glosa, m.detalle, m.planilla])));
  out.T10 = { grupos_con_kraken: kr.length, movimientos_con_kraken: movsK.length,
    clientes_en_la_planilla: new Set(movsK.map((m) => m.planilla && m.planilla.alias).filter(Boolean)).size,
    sugerencias: movsK.map((m) => ({ certeza: m.sugerencia && m.sugerencia.certeza, cliente: !!(m.sugerencia && m.sugerencia.cliente_id), alternativas: (m.sugerencia && m.sugerencia.alternativas || []).length })),
    reglas_globales: B().prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'FIN_REGLAS'").get().n ? B().prepare('SELECT COUNT(*) n FROM FIN_REGLAS').get().n : 0 };

  // ---- T37/T42 · SIGECO (la planilla más reciente) ----
  const sg = R + '01-planilla-SIGECO/';
  const sa = 'Planilla_SIGECO_v1_07-oct-2026.xlsx';
  const hs = (await leer(sg + sa)).map((h) => ({ nombre: h.hoja, oculta: !!h.oculta, filas: h.filas, formulas: h.formulas || [] }));
  // SIGSO conoce a sus clientes por su catálogo; aquí se siembra desde la propia hoja CLIENTES (en producción vienen del catálogo real).
  const hc = hs.find((h) => h.nombre === 'CLIENTES');
  const cab = hc.filas[0].map((c) => String(c || '').toUpperCase());
  const iR = cab.findIndex((c) => c === 'RUT'), iN = cab.findIndex((c) => /RAZ/.test(c));
  let sembrados = 0;
  hc.filas.slice(1).forEach((f, i) => { if (f[iR] && f[iN]) { agregarFila_(db, 'CAT_CLIENTES', { cliente_id: 'R-' + i, razon_social: f[iN], rut: f[iR], activo: true }); sembrados++; } });
  const cs = ok(Ca.cargar(db, D({ nombre: sa, hash: hash(sg + sa), hojas: hs }), ctx));
  const orden = ['CATÁLOGOS', 'PROYECTOS', 'CLIENTES'].concat(cs.hojas.map((h) => h.nombre).filter((n) => ['CATÁLOGOS', 'PROYECTOS', 'CLIENTES'].indexOf(n) === -1));
  const pubS = {}, pubS2 = {};
  for (const n of orden) { const r = Ca.publicar(db, D({ lote_id: cs.lote_id, hoja: n }), ctx); pubS[n] = r._validationError ? 'ERROR ' + r.message : r.resultado; }
  const opsS = Op.listar(db, D({}), ctx).operaciones.length;
  for (const n of orden) { const r = Ca.publicar(db, D({ lote_id: cs.lote_id, hoja: n }), ctx); pubS2[n] = r._validationError ? 'ERROR ' + r.message : r.resultado; }
  const cuadroS = ok(Ca.cuadroControl(db, D({ lote_id: cs.lote_id }), ctx));
  const otra = 'Planilla_SIGECO_v1_06-oct-2026_copia-anterior.xlsx';
  const cs2 = Ca.cargar(db, D({ nombre: otra, hash: hash(sg + otra), hojas: (await leer(sg + otra)).map((h) => ({ nombre: h.hoja, oculta: !!h.oculta, filas: h.filas, formulas: h.formulas || [] })) }), ctx);
  out.T37 = { tipo: cs.tipo, hojas: cs.hojas.length, clientes_sembrados: sembrados, publicar: pubS, publicar_otra_vez: pubS2,
    operaciones: { tras_publicar: opsS, tras_repetir: Op.listar(db, D({}), ctx).operaciones.length },
    otra_copia: { repetido: !!cs2.repetido, hojas_con_filas_repetidas: (cs2.hojas || []).filter((h) => h.repetidas).length },
    cuadro: cuadroS.hojas.map((h) => ({ hoja: h.hoja, destino: h.destino, leidas: h.leidas, por_estado: h.por_estado, sin_resolver: h.importe_sin_resolver, motivos: h.motivos.slice(0, 3) })) };
  out.mejoras = (Ca.mejoras(db, D({}), ctx).mejoras || []).length;

  console.log(JSON.stringify(out, null, 1));
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => {
  despues.forEach((f) => f());
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.error('no se pudo borrar la bóveda temporal'); }
});

function B() { return require(SIGSO + 'backend/logica/finanzasBoveda.js').dbFin(); }
function resumir(r) { const o = {}; Object.keys(r).forEach((k) => { if (typeof r[k] === 'number' || typeof r[k] === 'boolean') o[k] = r[k]; }); return o; }
