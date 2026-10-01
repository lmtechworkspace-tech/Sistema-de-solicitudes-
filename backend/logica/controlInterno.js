'use strict';

/**
 * controlInterno.js — módulo "Control interno": las matrices de Contabilidad
 * y RR.HH. del Drive dentro de SIGSO.
 *
 * Versión "espejo del Excel" (2026-10-01, pedido del dueño): cada matriz
 * tiene las MISMAS columnas, nombres y orden que su planilla
 * (controlInternoColumnas.js) y se guarda TODO lo que la planilla dice, tal
 * cual. Lo que SIGSO agrega sale de esas mismas columnas:
 *  - el cliente (contra el catálogo), el responsable (contra las cuentas) y
 *    la fecha/período de cada fila;
 *  - la SITUACIÓN (pendiente, en proceso, terminado...), que se calcula con
 *    la regla de cada matriz (controlInternoMatrices.js): nadie la escribe;
 *  - liberación, historial y reportes.
 *
 * Permisos REALES en el servidor: el módulo `control_interno` en la cuenta
 * (o ADM) y, por departamento, CI_MIEMBROS (REGISTRA / LECTURA). Ven todo sin
 * registrar: Gerencia y el Encargado del SGC. Libera quien libera el área en
 * Calidad (SGC_LIBERADORES): una sola lista "Quién libera". Nadie libera lo
 * suyo. Las columnas sensibles (motivo de la licencia) solo las ven los
 * miembros del departamento.
 *
 * Escala: ~50.000 filas (2022-2026). Siempre se filtra en SQL por matriz +
 * período (índice); un año de la matriz más grande son ~2.000 filas.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_, encabezadosReales_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { DEPARTAMENTOS, MATRICES, matriz_ } = require('./controlInternoMatrices');
const P = require('./controlInternoPlanillas');
const Prestaciones = require('./prestacionesSgc');

const MODULO = 'control_interno';
const ROLES_MIEMBRO = ['REGISTRA', 'LECTURA'];
const TOPE_LOTE = 300;
const RE_PERIODO = /^\d{4}-M(0[1-9]|1[0-2])$/;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Las listas (foto por cliente) no tienen período: todas sus filas van aquí.
const PERIODO_LISTA = '0000-M01';

function uuid_() { return crypto.randomUUID(); }
function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }
function normalizarEmail_(e) { return String(e || '').trim().toLowerCase(); }
function hoy_() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
function periodoDeFecha_(f) { return RE_FECHA.test(String(f || '')) ? String(f).slice(0, 4) + '-M' + String(f).slice(5, 7) : ''; }
function periodoActual_() { return periodoDeFecha_(hoy_()); }
function moverPeriodo_(per, n) {
  const m = /^(\d{4})-M(\d{2})$/.exec(per || '');
  if (!m) return '';
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
  return Math.floor(total / 12) + '-M' + String((total % 12) + 1).padStart(2, '0');
}
const MESES_ = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function periodoTexto_(per) { const m = /^(\d{4})-M(\d{2})$/.exec(per || ''); return m ? MESES_[Number(m[2]) - 1] + ' de ' + m[1] : String(per || ''); }
function normalizarTexto_(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

// --- acceso a datos: SQL filtrado + índices --------------------------------------------

const indicesListos_ = new WeakSet();
function asegurarIndices_(db) {
  if (indicesListos_.has(db)) return;
  const existe = (t) => !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (existe('CI_REGISTROS')) {
    db.exec('CREATE INDEX IF NOT EXISTS "ix_ci_registros_matriz_periodo" ON "CI_REGISTROS" ("matriz", "periodo")');
    db.exec('CREATE INDEX IF NOT EXISTS "ix_ci_registros_id" ON "CI_REGISTROS" ("registro_id")');
  }
  if (existe('CI_HISTORIAL')) db.exec('CREATE INDEX IF NOT EXISTS "ix_ci_historial_registro" ON "CI_HISTORIAL" ("registro_id")');
  indicesListos_.add(db);
}
function mapear_(fila, encabezados, columnas) {
  const o = {};
  columnas.forEach((c) => { o[c] = ''; });
  encabezados.forEach((c) => { if (c && fila[c] !== undefined && fila[c] !== null) o[c] = JSON.parse(fila[c]); });
  return o;
}
// Los valores se guardan como JSON (convención de sqliteRepo): se compara contra
// JSON.stringify del valor, así el índice sirve.
function consultar_(db, tabla, iguales, extra) {
  asegurarIndices_(db);
  const enc = encabezadosReales_(db, tabla);
  const conds = [], params = [];
  Object.keys(iguales || {}).forEach((k) => { conds.push('"' + k + '" = ?'); params.push(JSON.stringify(iguales[k])); });
  if (extra) { conds.push(extra.sql); params.push(...extra.params); }
  const sql = 'SELECT * FROM "' + tabla + '"' + (conds.length ? ' WHERE ' + conds.join(' AND ') : '');
  return db.prepare(sql).all(...params).map((f) => mapear_(f, enc, COLUMNAS[tabla]));
}
/** Filas de una matriz entre dos períodos (inclusive), activas. */
function rango_(db, matriz, desde, hasta) {
  return consultar_(db, 'CI_REGISTROS', { matriz, activa: true }, {
    sql: '"periodo" >= ? AND "periodo" <= ?', params: [JSON.stringify(desde), JSON.stringify(hasta)]
  });
}
function registroPorId_(db, id) {
  if (!id) return null;
  return consultar_(db, 'CI_REGISTROS', { registro_id: String(id) }).find((r) => esVerdadero_(r.activa)) || null;
}
function enTransaccion_(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (err) { db.exec('ROLLBACK'); throw err; }
}
function historial_(db, registroId, accion, detalle, contexto) {
  agregarFila_(db, 'CI_HISTORIAL', {
    historial_id: uuid_(), registro_id: registroId, accion, detalle: String(detalle || '').slice(0, 600),
    usuario_email: normalizarEmail_(contexto && contexto.email), fecha: new Date().toISOString()
  });
}

// --- permisos ----------------------------------------------------------------------------

function miembros_(db) {
  try { return leerFilas_(db, 'CI_MIEMBROS', COLUMNAS.CI_MIEMBROS).filter((m) => esVerdadero_(m.activa)); } catch (e) { return []; }
}
/**
 * Qué puede hacer la persona en cada departamento. `tieneModulo` es la
 * puerta del módulo (CUENTAS_PORTAL.modulos, que aquí SÍ se verifica: el
 * módulo guarda datos de trabajadores y montos de clientes). `miembro` = está
 * en la lista del departamento (o es ADM): ve las columnas sensibles.
 */
function acceso_(db, contexto) {
  const email = normalizarEmail_(contexto && contexto.email);
  const esAdmin = !!contexto && contexto.rol === 'ADM';
  const modulos = (contexto && Array.isArray(contexto.modulos)) ? contexto.modulos : [];
  const tieneModulo = esAdmin || modulos.indexOf(MODULO) !== -1;
  const gobierna = Prestaciones.gobiernaLiberacion_(db, contexto);
  const veTodo = esAdmin || gobierna || (!!contexto && contexto.rol === 'GERENCIA');
  const mios = miembros_(db).filter((m) => normalizarEmail_(m.usuario_email) === email);
  const deptos = {};
  DEPARTAMENTOS.forEach((d) => {
    const m = mios.find((x) => x.depto === d.clave);
    const registra = esAdmin || (!!m && m.rol === 'REGISTRA');
    const libera = Prestaciones.liberaArea_(db, contexto, d.area);
    deptos[d.clave] = { ve: registra || libera || veTodo || !!m, registra, libera, miembro: esAdmin || !!m };
  });
  return { email, esAdmin, tieneModulo, gobierna, deptos };
}
function sinModulo_() { return { _forbidden: true, message: 'Tu cuenta no tiene el módulo Control interno.' }; }
function matrizConPermiso_(db, contexto, clave, que) {
  const ac = acceso_(db, contexto);
  if (!ac.tieneModulo) return { error: sinModulo_() };
  const m = matriz_(String(clave || ''));
  if (!m) return { error: { ok: false, message: 'No existe esa matriz.' } };
  const p = ac.deptos[m.depto];
  if (!p || !p.ve) return { error: { _forbidden: true, message: 'No tienes acceso a ' + nombreDepto_(m.depto) + '.' } };
  if (que === 'registra' && !p.registra) return { error: { _forbidden: true, message: 'En ' + nombreDepto_(m.depto) + ' tienes acceso de solo lectura.' } };
  if (que === 'libera' && !p.libera) return { error: { _forbidden: true, message: 'No estás designado para liberar ' + nombreDepto_(m.depto) + '.' } };
  return { m, ac, p };
}
function nombreDepto_(clave) { return (DEPARTAMENTOS.find((d) => d.clave === clave) || {}).nombre || clave; }

// --- situación -----------------------------------------------------------------------------

function estadoDef_(m, clave) { return m.estados.find((e) => e.clave === clave) || null; }
function esAnulado_(clave) { return /^ANULAD/.test(String(clave || '')); }
function esFinal_(m, clave) { const e = estadoDef_(m, clave); return !!(e && e.final); }
function liberable_(m, r) { return !m.sinLiberacion && esFinal_(m, r.estado) && !esAnulado_(r.estado) && !r.liberado_por; }
function situacion_(m, datos) {
  const s = m.situacion(datos || {}, m);
  return estadoDef_(m, s) ? s : m.estados[0].clave;
}

// --- columnas y valores -------------------------------------------------------------------

function columna_(m, rol) { return m.columnas.find((c) => c.rol === rol) || null; }
/**
 * Lo que llega de una celda, tal cual (como en la planilla): fecha, número u
 * hora si se entiende; si no, el texto. Nunca se guardan claves.
 */
function limpiarDatos_(m, entrada, base) {
  const datos = Object.assign({}, base || {});
  const e = entrada && typeof entrada === 'object' ? entrada : {};
  for (const c of m.columnas) {
    if (!Object.prototype.hasOwnProperty.call(e, c.clave)) continue;
    const v = P.valor_(c.tipo, e[c.clave]);
    if (v === '') delete datos[c.clave]; else datos[c.clave] = v;
  }
  return { datos };
}
// Fechas fuera de rango son errores de tipeo de la planilla (0204, 2016, 2032):
// no dan período. Válido: desde 2020 hasta dos meses después de hoy.
function periodoValido_(p) {
  const s = String(p || '');
  if (/^\d{4}$/.test(s)) return Number(s) >= 2020 && Number(s) <= new Date().getFullYear();
  return RE_PERIODO.test(s) && s >= '2020-M01' && s <= moverPeriodo_(periodoActual_(), 2);
}
function periodoDeDatos_(m, datos) {
  for (const k of (m.periodoDe || [m.fechaPrincipal]).concat(m.columnas.filter((c) => c.tipo === 'fecha').map((c) => c.clave))) {
    const v = datos[k];
    const p = periodoDeFecha_(v);
    if (periodoValido_(p)) return p;
    const mes = P.mesDeHoja_(v);
    if (mes && mes.anio && periodoValido_(String(mes.anio))) return mes.anio + '-M' + String(mes.mes).padStart(2, '0');
    const anio = /^(20\d{2})(\.0)?$/.exec(String(v || '').trim());
    if (anio && periodoValido_(anio[1])) return anio[1] + '-M01';
  }
  return '';
}

// Personas: "FRANCISCA", "Bárbara", "Vanessa Sepulveda" -> el correo de la única cuenta que calza.
function personas_(db) {
  let cuentas = [];
  try { cuentas = leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL).filter((c) => esVerdadero_(c.activo)); } catch (e) { /* sin cuentas */ }
  const lista = cuentas.map((c) => {
    let emails = c.emails;
    if (typeof emails === 'string') { try { emails = JSON.parse(emails); } catch (e) { emails = emails.split(/[,;\s]+/); } }
    return { nombre: P.n_(c.nombre), email: String((emails || [])[0] || '').toLowerCase() };
  }).filter((c) => c.nombre && c.email);
  const cache = {};
  return function (texto) {
    const s = P.n_(texto);
    if (!s) return '';
    if (RE_EMAIL.test(String(texto).trim())) return normalizarEmail_(texto);
    if (cache[s] !== undefined) return cache[s];
    let c = lista.filter((x) => x.nombre === s);
    if (c.length !== 1) c = lista.filter((x) => x.nombre.indexOf(s) === 0);
    if (c.length !== 1) { const pr = s.split(' ')[0]; c = lista.filter((x) => x.nombre.split(' ')[0] === pr); }
    cache[s] = c.length === 1 ? c[0].email : '';
    return cache[s];
  };
}

// Clientes del catálogo. Lo que no calza queda con el nombre de la planilla y
// "Fuera del catálogo" (el reporte lo cuenta: es la conciliación pendiente).
function clientes_(db) {
  try {
    return leerFilas_(db, 'CAT_CLIENTES', COLUMNAS.CAT_CLIENTES).filter((c) => esVerdadero_(c.activo))
      .map((c) => ({ cliente_id: c.cliente_id, nombre: c.razon_social || '', rut: c.rut || '', codigo: c.codigo_cliente || '' }));
  } catch (e) { return []; }
}
function contextoClientes_(db) {
  const porId = {}, porCodigo = {}, porRut = {}, porNombre = {};
  clientes_(db).forEach((c) => {
    porId[c.cliente_id] = c;
    if (c.codigo) porCodigo[P.n_(c.codigo)] = c;
    const r = P.rutNorm_(c.rut);
    if (r) porRut[r] = c;
    const k = P.nombreNorm_(c.nombre);
    if (k && !porNombre[k]) porNombre[k] = c;
  });
  return { porId, porCodigo, porRut, porNombre };
}
/** Texto de la planilla (+ RUT / código si los hay) -> cliente del catálogo o nombre libre. */
function resolverClienteTexto_(ctx, texto, rutTexto, codigoTexto) {
  const s = String(texto || '').replace(/\s+/g, ' ').trim();
  if (s.length < 2) return null;
  const cod = (String(codigoTexto || '').match(/^([A-Z]{2,3}-\d{2,4}-\d+)/i) || s.match(/^([A-Z]{2,3}-\d{2,4}-\d+)/i) || [])[1];
  const rut = P.rutNorm_(rutTexto) || P.rutNorm_(s);
  const nombre = s.replace(/^[A-Z]{2,3}-\d{2,4}-\d+\s*/i, '').replace(/\s*\d{1,2}\.?\d{3}\.?\d{3}\s*-\s*[\dkK]\s*$/, '').trim() || s;
  const c = (cod && ctx.porCodigo[P.n_(cod)]) || (rut && ctx.porRut[rut]) || ctx.porNombre[P.nombreNorm_(nombre)];
  if (c) return { cliente_id: c.cliente_id, cliente_nombre: c.nombre, cliente_rut: c.rut };
  return { cliente_id: '', cliente_nombre: nombre.slice(0, 200), cliente_rut: rut };
}

/**
 * Lo que el registro guarda aparte de `datos` (todo sale de las columnas):
 * cliente, responsable, fecha, situación y, en las de tipo registro, período.
 */
function derivados_(m, datos, ctx) {
  const out = { fecha: m.fechaPrincipal && RE_FECHA.test(String(datos[m.fechaPrincipal] || '')) ? datos[m.fechaPrincipal] : '' };
  out.estado = situacion_(m, datos);
  const cResp = columna_(m, 'responsable');
  if (cResp && ctx.persona) out.responsable_email = ctx.persona(datos[cResp.clave]);
  if (m.tipo === 'registro') { const p = periodoDeDatos_(m, datos); if (p) out.periodo = p; }
  return out;
}

function formatear_(m, r, verSensibles) {
  const datos = Object.assign({}, r.datos && typeof r.datos === 'object' ? r.datos : {});
  if (!verSensibles) (m.sensibles || []).forEach((k) => { if (datos[k] !== undefined) datos[k] = '•••'; });
  return {
    registro_id: r.registro_id, matriz: r.matriz, periodo: r.periodo,
    cliente_id: r.cliente_id || '', cliente_nombre: r.cliente_nombre || '', cliente_rut: r.cliente_rut || '',
    fecha: r.fecha || '', estado: r.estado, responsable_email: r.responsable_email || '',
    liberado_por: r.liberado_por || '', fecha_liberacion: r.fecha_liberacion || '',
    datos, observaciones: r.observaciones || '',
    creado_por: r.creado_por || '', actualizado_por: r.actualizado_por || '', fecha_actualizacion: r.fecha_actualizacion || r.fecha_creacion || ''
  };
}
function orden_(a, b) {
  const fa = Number((a.datos || {})._fila), fb = Number((b.datos || {})._fila);
  if (isFinite(fa) && isFinite(fb) && fa !== fb) return fa - fb;
  if (isFinite(fa) !== isFinite(fb)) return isFinite(fa) ? -1 : 1;
  return String(a.fecha_creacion || '').localeCompare(String(b.fecha_creacion || '')) || String(a.registro_id).localeCompare(String(b.registro_id));
}
function resumen_(m, filas) {
  const r = { total: 0, por_estado: {}, pendientes: 0, finalizados: 0, liberados: 0, por_liberar: 0, anulados: 0 };
  m.estados.forEach((e) => { r.por_estado[e.clave] = 0; });
  filas.forEach((x) => {
    if (esAnulado_(x.estado)) { r.anulados++; return; }
    r.total++;
    r.por_estado[x.estado] = (r.por_estado[x.estado] || 0) + 1;
    if (esFinal_(m, x.estado)) r.finalizados++; else r.pendientes++;
    if (x.liberado_por) r.liberados++;
    else if (liberable_(m, x)) r.por_liberar++;
  });
  return r;
}
/** Filas del resumen: mensual = el mes; registro = el año del mes; lista = todo. */
function filasDelResumen_(db, m, periodo) {
  if (m.tipo === 'lista') return consultar_(db, 'CI_REGISTROS', { matriz: m.clave, periodo: PERIODO_LISTA, activa: true });
  if (m.tipo === 'registro') return consultar_(db, 'CI_REGISTROS', { matriz: m.clave, periodo, activa: true });
  return consultar_(db, 'CI_REGISTROS', { matriz: m.clave, periodo, activa: true });
}

function definicionPublica_(m) {
  return {
    clave: m.clave, depto: m.depto, seccion: m.seccion, nombre: m.nombre, codigo: m.codigo || '', descripcion: m.descripcion || '',
    tipo: m.tipo, unaPorCliente: !!m.unaPorCliente, abrirMes: m.tipo === 'mensual' && !!(m.unaPorCliente || m.copiar),
    sinLiberacion: !!m.sinLiberacion, sinCliente: !!m.sinCliente, tiempos: m.tiempos || null, montos: m.montos || [],
    fechaPrincipal: m.fechaPrincipal || '', estados: m.estados, sensibles: m.sensibles || [],
    columnas: m.columnas.map((c) => ({ clave: c.clave, etiqueta: c.etiqueta, tipo: c.tipo, rol: c.rol || '', grupo: c.grupo || '', antigua: !!c.antigua, sugerencias: c.sugerencias || [] }))
  };
}

// =========================================================================================
// Acciones
// =========================================================================================

/** Configuración del módulo para esta persona + el resumen del período. */
function getConfig(db, data, contexto) {
  const ac = acceso_(db, contexto);
  if (!ac.tieneModulo) return sinModulo_();
  const periodo = RE_PERIODO.test(String((data && data.periodo) || '')) ? data.periodo : periodoActual_();
  const deptos = DEPARTAMENTOS.filter((d) => ac.deptos[d.clave].ve);
  const visibles = MATRICES.filter((m) => ac.deptos[m.depto].ve);
  const resumen = {};
  visibles.forEach((m) => { if (m.tipo !== 'lista') resumen[m.clave] = resumen_(m, filasDelResumen_(db, m, periodo)); });
  return {
    yo: ac.email,
    periodo,
    puede_administrar: ac.esAdmin,
    departamentos: deptos.map((d) => Object.assign({ clave: d.clave, nombre: d.nombre, liberadores: Prestaciones.liberadoresDeArea_(db, d.area) }, ac.deptos[d.clave])),
    matrices: visibles.map(definicionPublica_),
    clientes: visibles.length ? clientes_(db) : [],
    resumen
  };
}

/**
 * Filas de una matriz. Mensual: un mes (`periodo`). Registro: un año
 * (`anio`) o un mes (`periodo`). Lista: todas. Siempre en el orden de la
 * planilla. `columnas_con_datos`: las columnas antiguas que se muestran.
 */
function listar(db, data, contexto) {
  const d = data || {};
  const x = matrizConPermiso_(db, contexto, d.matriz, 've');
  if (x.error) return x.error;
  const m = x.m;
  let filas, periodo = '', anio = '';
  if (m.tipo === 'lista') {
    filas = consultar_(db, 'CI_REGISTROS', { matriz: m.clave, periodo: PERIODO_LISTA, activa: true });
  } else if (m.tipo === 'registro' && /^\d{4}$/.test(String(d.anio || ''))) {
    anio = String(d.anio);
    filas = rango_(db, m.clave, anio + '-M01', anio + '-M12');
  } else {
    periodo = String(d.periodo || '');
    if (!RE_PERIODO.test(periodo)) return { ok: false, message: 'Indica el período.' };
    filas = consultar_(db, 'CI_REGISTROS', { matriz: m.clave, periodo, activa: true });
  }
  const registros = filas.map((r) => formatear_(m, r, x.p.miembro)).sort(orden_);
  const conDatos = {};
  registros.forEach((r) => Object.keys(r.datos).forEach((k) => { if (r.datos[k] !== '') conDatos[k] = true; }));
  const res = {
    matriz: m.clave, tipo: m.tipo, periodo, anio,
    puede_registrar: x.p.registra, puede_liberar: x.p.libera && !m.sinLiberacion, gobierna: x.ac.gobierna, yo: x.ac.email,
    registros, resumen: resumen_(m, filas), columnas_con_datos: Object.keys(conDatos)
  };
  if (m.tipo === 'mensual' && periodo) {
    const anterior = moverPeriodo_(periodo, -1);
    const delAnterior = consultar_(db, 'CI_REGISTROS', { matriz: m.clave, periodo: anterior, activa: true });
    res.periodo_anterior = anterior;
    res.en_periodo_anterior = delAnterior.length;
    res.por_abrir = m.unaPorCliente ? delAnterior.filter((a) => !filas.some((f) => mismoCliente_(f, a))).length : 0;
  }
  if (m.tipo === 'registro') {
    // Años con datos (para el selector).
    const anios = db.prepare('SELECT DISTINCT substr("periodo", 2, 4) AS a FROM "CI_REGISTROS" WHERE "matriz" = ? AND "activa" = ? ORDER BY a DESC')
      .all(JSON.stringify(m.clave), JSON.stringify(true)).map((f) => f.a).filter((a) => /^\d{4}$/.test(a));
    res.anios = anios;
  }
  return res;
}

/** Un registro con su historial. */
function getRegistro(db, data, contexto) {
  const r = registroPorId_(db, data && data.registro_id);
  if (!r) return { ok: false, message: 'No se encontró el registro.' };
  const x = matrizConPermiso_(db, contexto, r.matriz, 've');
  if (x.error) return x.error;
  const hist = consultar_(db, 'CI_HISTORIAL', { registro_id: r.registro_id })
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  return {
    registro: formatear_(x.m, r, x.p.miembro),
    historial: hist.map((h) => ({ accion: h.accion, detalle: h.detalle, usuario_email: h.usuario_email, fecha: h.fecha })),
    puede_registrar: x.p.registra, puede_liberar: x.p.libera && !x.m.sinLiberacion
  };
}

function resolverCliente_(db, m, d, datos) {
  if (m.sinCliente) return { cliente_id: '', cliente_nombre: '', cliente_rut: '' };
  const id = String(d.cliente_id || '').trim();
  if (id) {
    const c = clientes_(db).find((k) => k.cliente_id === id);
    if (!c) return { error: 'El cliente no está en el catálogo de SIGSO.' };
    return { cliente_id: c.cliente_id, cliente_nombre: c.nombre, cliente_rut: c.rut };
  }
  const cCli = columna_(m, 'cliente'), cRut = columna_(m, 'rut');
  const nombre = String(d.cliente_nombre || (cCli ? datos[cCli.clave] : '') || '').trim().slice(0, 200);
  if (nombre.length < 2) return { error: 'Elige el cliente (o escribe su nombre si no está en el catálogo).' };
  const ctx = contextoClientes_(db);
  return resolverClienteTexto_(ctx, nombre, d.cliente_rut || (cRut ? datos[cRut.clave] : ''), datos.codigo);
}
function mismoCliente_(a, b) {
  if (a.cliente_id || b.cliente_id) return a.cliente_id === b.cliente_id;
  return normalizarTexto_(a.cliente_nombre) === normalizarTexto_(b.cliente_nombre);
}
function etiquetasCambiadas_(m, antes, despues) {
  return m.columnas.filter((c) => JSON.stringify(antes[c.clave] === undefined ? '' : antes[c.clave]) !== JSON.stringify(despues[c.clave] === undefined ? '' : despues[c.clave]))
    .map((c) => (c.grupo ? c.grupo + ' › ' : '') + c.etiqueta);
}
function siguienteFila_(db, m, periodo) {
  const filas = m.tipo === 'lista' || m.tipo === 'mensual'
    ? consultar_(db, 'CI_REGISTROS', { matriz: m.clave, periodo, activa: true })
    : consultar_(db, 'CI_REGISTROS', { matriz: m.clave, activa: true });
  return filas.reduce((mx, r) => Math.max(mx, Number((r.datos || {})._fila) || 0), 0) + 1;
}

/**
 * Crea o edita un registro. En la edición basta mandar lo que cambió
 * (`datos` parcial): así la grilla guarda celda por celda.
 */
function guardar(db, data, contexto) {
  const d = data || {};
  const existente = d.registro_id ? registroPorId_(db, d.registro_id) : null;
  if (d.registro_id && !existente) return { ok: false, message: 'No se encontró el registro (¿lo anularon?).' };
  const x = matrizConPermiso_(db, contexto, existente ? existente.matriz : d.matriz, 'registra');
  if (x.error) return x.error;
  const m = x.m;
  // Lo sensible que no se ve no se puede pisar con los "•••" de la pantalla.
  const entrada = Object.assign({}, d.datos || {});
  (m.sensibles || []).forEach((k) => { if (!x.p.miembro || entrada[k] === '•••') delete entrada[k]; });
  const datos = limpiarDatos_(m, entrada, existente ? existente.datos : {}).datos;
  const der = derivados_(m, datos, { persona: personas_(db) });
  const ahora = new Date().toISOString();

  if (!existente) {
    const cli = resolverCliente_(db, m, d, datos);
    if (cli.error) return { ok: false, message: cli.error };
    let periodo = String(d.periodo || '');
    if (m.tipo === 'lista') periodo = PERIODO_LISTA;
    else if (m.tipo === 'registro') periodo = der.periodo || (RE_PERIODO.test(periodo) ? periodo : periodoActual_());
    if (!RE_PERIODO.test(periodo)) return { ok: false, message: 'Indica el período.' };
    if (m.unaPorCliente) {
      const ya = consultar_(db, 'CI_REGISTROS', { matriz: m.clave, periodo, activa: true }).find((r) => mismoCliente_(r, cli));
      if (ya) return { ok: false, message: cli.cliente_nombre + ' ya tiene su fila en este mes: edítala en la tabla.' };
    }
    datos._fila = siguienteFila_(db, m, periodo);
    const fila = Object.assign({
      registro_id: uuid_(), depto: m.depto, matriz: m.clave, periodo,
      fecha: der.fecha, estado: der.estado, responsable_email: der.responsable_email || (columna_(m, 'responsable') ? '' : x.ac.email),
      liberado_por: '', fecha_liberacion: '', datos, observaciones: String(d.observaciones || '').trim().slice(0, 2000),
      creado_por: x.ac.email, fecha_creacion: ahora, actualizado_por: x.ac.email, fecha_actualizacion: ahora, activa: true
    }, cli);
    enTransaccion_(db, () => {
      agregarFila_(db, 'CI_REGISTROS', fila);
      historial_(db, fila.registro_id, 'CREADO', m.nombre + (cli.cliente_nombre ? ' · ' + cli.cliente_nombre : ''), contexto);
    });
    return { ok: true, registro: formatear_(m, fila, x.p.miembro), message: 'Fila agregada.' };
  }

  const cambios = { datos, estado: der.estado, fecha: der.fecha, actualizado_por: x.ac.email, fecha_actualizacion: ahora };
  if (der.responsable_email !== undefined) cambios.responsable_email = der.responsable_email;
  if (m.tipo === 'registro' && der.periodo) cambios.periodo = der.periodo;
  if (d.observaciones !== undefined) cambios.observaciones = String(d.observaciones || '').trim().slice(0, 2000);
  const cCli = columna_(m, 'cliente');
  if (d.cliente_id !== undefined || d.cliente_nombre !== undefined || (cCli && entrada[cCli.clave] !== undefined)) {
    const cli = resolverCliente_(db, m, d, datos);
    if (cli.error) return { ok: false, message: cli.error };
    Object.assign(cambios, cli);
  }
  const detalle = etiquetasCambiadas_(m, existente.datos || {}, datos);
  if (existente.estado !== cambios.estado) detalle.push('Situación: ' + ((estadoDef_(m, existente.estado) || {}).etiqueta || existente.estado) + ' → ' + estadoDef_(m, cambios.estado).etiqueta);
  if (cambios.observaciones !== undefined && cambios.observaciones !== existente.observaciones) detalle.push('Observaciones');
  if (cambios.cliente_nombre !== undefined && cambios.cliente_nombre !== existente.cliente_nombre) detalle.push('Cliente');
  if (!detalle.length) return { ok: true, registro: formatear_(m, existente, x.p.miembro), message: 'Sin cambios.' };

  // Lo liberado es lo que alguien revisó: si cambia, vuelve a revisión.
  const revierte = !!existente.liberado_por;
  if (revierte) { cambios.liberado_por = ''; cambios.fecha_liberacion = ''; }
  enTransaccion_(db, () => {
    actualizarFilaPorId_(db, 'CI_REGISTROS', 'registro_id', existente.registro_id, cambios);
    historial_(db, existente.registro_id, 'EDITADO', detalle.join(' · '), contexto);
    if (revierte) historial_(db, existente.registro_id, 'LIBERACION_REVERTIDA', 'Se editó después de liberado: hay que liberarlo de nuevo.', contexto);
  });
  return {
    ok: true, registro: formatear_(m, Object.assign({}, existente, cambios), x.p.miembro),
    message: revierte ? 'Guardado. Estaba liberado: queda para liberar de nuevo.' : 'Guardado.'
  };
}

/**
 * "Abrir el mes": crea las filas del mes a partir del anterior (los mismos
 * clientes, con las columnas que se arrastran). Es lo que hoy se hace
 * copiando la hoja del mes pasado.
 */
function abrirPeriodo(db, data, contexto) {
  const d = data || {};
  const x = matrizConPermiso_(db, contexto, d.matriz, 'registra');
  if (x.error) return x.error;
  const m = x.m;
  if (m.tipo !== 'mensual' || !m.unaPorCliente) return { ok: false, message: 'Esta matriz no se abre por mes: se agrega una fila por requerimiento.' };
  const periodo = String(d.periodo || '');
  if (!RE_PERIODO.test(periodo)) return { ok: false, message: 'Indica el período.' };
  const origen = consultar_(db, 'CI_REGISTROS', { matriz: m.clave, periodo: moverPeriodo_(periodo, -1), activa: true }).sort(orden_);
  if (!origen.length) return { ok: false, message: 'El mes anterior no tiene filas que copiar.' };
  const actuales = consultar_(db, 'CI_REGISTROS', { matriz: m.clave, periodo, activa: true });
  const cResp = columna_(m, 'responsable');
  const copiar = m.copiar === '*'
    ? m.columnas.filter((c) => !c.antigua && c.rol !== 'responsable' && !/^fecha_realizacion$/.test(c.clave)).map((c) => c.clave)
    : (m.copiar || []).concat(m.columnas.filter((c) => c.rol === 'cliente' || c.rol === 'rut').map((c) => c.clave));
  const persona = personas_(db);
  const ahora = new Date().toISOString();
  let creadas = 0, omitidas = 0, fila_ = actuales.reduce((mx, r) => Math.max(mx, Number((r.datos || {})._fila) || 0), 0);
  enTransaccion_(db, () => {
    origen.forEach((o) => {
      if (actuales.some((a) => mismoCliente_(a, o))) { omitidas++; return; }
      const datos = {};
      copiar.forEach((k) => { if (o.datos && o.datos[k] !== undefined && o.datos[k] !== '') datos[k] = o.datos[k]; });
      datos._fila = ++fila_;
      const der = derivados_(m, datos, { persona });
      const fila = {
        registro_id: uuid_(), depto: m.depto, matriz: m.clave, periodo,
        cliente_id: o.cliente_id || '', cliente_nombre: o.cliente_nombre || '', cliente_rut: o.cliente_rut || '',
        fecha: '', estado: der.estado, responsable_email: cResp ? '' : (o.responsable_email || ''), liberado_por: '', fecha_liberacion: '',
        datos, observaciones: '', creado_por: x.ac.email, fecha_creacion: ahora, actualizado_por: x.ac.email, fecha_actualizacion: ahora, activa: true
      };
      agregarFila_(db, 'CI_REGISTROS', fila);
      historial_(db, fila.registro_id, 'CREADO', 'Creado al abrir el mes, desde ' + periodoTexto_(moverPeriodo_(periodo, -1)), contexto);
      actuales.push(fila);
      creadas++;
    });
  });
  return { ok: true, creadas, omitidas, message: creadas + (creadas === 1 ? ' fila creada' : ' filas creadas') + (omitidas ? '; ' + omitidas + ' ya estaban.' : '.') };
}

/**
 * Acciones sobre varias filas: liberar, quitar la liberación o anular. Lo
 * que no se puede no frena al resto: vuelve en `omitidas` con el motivo.
 */
function accionLote(db, data, contexto) {
  const d = data || {};
  const accion = String(d.accion || '');
  const que = accion === 'liberar' || accion === 'desliberar' ? 'libera' : 'registra';
  const x = matrizConPermiso_(db, contexto, d.matriz, que);
  if (x.error) return x.error;
  const m = x.m;
  const ids = Array.isArray(d.ids) ? Array.from(new Set(d.ids.map(String))).filter(Boolean) : [];
  if (!ids.length) return { ok: false, message: 'Marca al menos una fila.' };
  if (ids.length > TOPE_LOTE) return { ok: false, message: 'Máximo ' + TOPE_LOTE + ' por vez.' };
  if (['liberar', 'desliberar', 'anular'].indexOf(accion) === -1) return { ok: false, message: 'Acción no válida.' };
  if (que === 'libera' && m.sinLiberacion) return { ok: false, message: 'Esta matriz no se libera: es una lista de situación.' };

  const hoy = hoy_();
  const ahora = new Date().toISOString();
  const omitidas = [];
  let hechos = 0;
  enTransaccion_(db, () => {
    ids.forEach((id) => {
      const r = registroPorId_(db, id);
      if (!r || r.matriz !== m.clave) { omitidas.push({ registro_id: id, cliente_nombre: '', motivo: 'No se encontró.' }); return; }
      const omitir = (motivo) => omitidas.push({ registro_id: id, cliente_nombre: r.cliente_nombre, motivo });
      let cambios = null, hist = '';
      if (accion === 'liberar') {
        if (r.liberado_por) return omitir('Ya estaba liberado.');
        if (!esFinal_(m, r.estado)) return omitir('Todavía no está terminado (' + ((estadoDef_(m, r.estado) || {}).etiqueta || r.estado) + ').');
        if (!x.ac.gobierna && r.responsable_email && normalizarEmail_(r.responsable_email) === x.ac.email) return omitir('Lo realizaste tú: lo libera otra persona.');
        cambios = { liberado_por: x.ac.email, fecha_liberacion: hoy };
        hist = 'Liberado';
      } else if (accion === 'desliberar') {
        if (!r.liberado_por) return omitir('No estaba liberado.');
        if (!x.ac.gobierna && normalizarEmail_(r.liberado_por) !== x.ac.email) return omitir('Lo liberó otra persona.');
        cambios = { liberado_por: '', fecha_liberacion: '' };
        hist = 'Se quitó la liberación';
      } else if (accion === 'anular') {
        if (r.liberado_por && !x.ac.gobierna) return omitir('Está liberado: lo anula el Encargado del SGC.');
        cambios = { activa: false };
        hist = 'Anulado';
      }
      cambios.actualizado_por = x.ac.email;
      cambios.fecha_actualizacion = ahora;
      actualizarFilaPorId_(db, 'CI_REGISTROS', 'registro_id', id, cambios);
      historial_(db, id, accion.toUpperCase(), hist, contexto);
      hechos++;
    });
  });
  const VERBOS = { liberar: ['liberada', 'liberadas'], desliberar: ['quedó sin liberar', 'quedaron sin liberar'], anular: ['anulada', 'anuladas'] };
  const v = VERBOS[accion];
  return {
    ok: true, hechos, omitidas,
    message: hechos + (hechos === 1 ? ' fila ' + v[0] : ' filas ' + v[1]) +
      (omitidas.length ? '; ' + omitidas.length + ' sin cambio (ver motivo).' : '.')
  };
}

// --- accesos (solo ADM) ---------------------------------------------------------------

function listarMiembros(db, data, contexto) {
  if (!contexto || contexto.rol !== 'ADM') return { _forbidden: true, message: 'Solo el administrador ve los accesos.' };
  const todos = miembros_(db);
  return {
    departamentos: DEPARTAMENTOS.map((d) => ({
      clave: d.clave, nombre: d.nombre,
      miembros: todos.filter((m) => m.depto === d.clave).map((m) => ({ email: normalizarEmail_(m.usuario_email), rol: m.rol })),
      liberadores: Prestaciones.liberadoresDeArea_(db, d.area)
    })),
    roles: ROLES_MIEMBRO
  };
}
/** Reemplaza la lista de un departamento: [{ email, rol }]. */
function guardarMiembros(db, data, contexto) {
  if (!contexto || contexto.rol !== 'ADM') return { _forbidden: true, message: 'Solo el administrador reparte los accesos.' };
  const d = data || {};
  const depto = DEPARTAMENTOS.find((x) => x.clave === d.depto);
  if (!depto) return { ok: false, message: 'Departamento no válido.' };
  const lista = Array.isArray(d.miembros) ? d.miembros : [];
  const vistos = {};
  const nuevos = [];
  for (const it of lista) {
    const email = normalizarEmail_(it && it.email);
    if (!email) continue;
    if (!RE_EMAIL.test(email)) return { ok: false, message: 'Revisa el correo ' + email + '.' };
    const rol = ROLES_MIEMBRO.indexOf(it.rol) !== -1 ? it.rol : 'REGISTRA';
    if (vistos[email]) continue;
    vistos[email] = true;
    nuevos.push({ email, rol });
  }
  if (nuevos.length > 40) return { ok: false, message: 'Máximo 40 personas por departamento.' };
  const actuales = miembros_(db).filter((m) => m.depto === depto.clave);
  const ahora = new Date().toISOString();
  let altas = 0, bajas = 0, cambios = 0;
  enTransaccion_(db, () => {
    actuales.forEach((m) => {
      const n = nuevos.find((x) => x.email === normalizarEmail_(m.usuario_email));
      if (!n) { actualizarFilaPorId_(db, 'CI_MIEMBROS', 'miembro_id', m.miembro_id, { activa: false }); bajas++; }
      else if (n.rol !== m.rol) { actualizarFilaPorId_(db, 'CI_MIEMBROS', 'miembro_id', m.miembro_id, { rol: n.rol }); cambios++; }
    });
    nuevos.forEach((n) => {
      if (actuales.some((m) => normalizarEmail_(m.usuario_email) === n.email)) return;
      agregarFila_(db, 'CI_MIEMBROS', {
        miembro_id: uuid_(), depto: depto.clave, usuario_email: n.email, rol: n.rol,
        creado_por: normalizarEmail_(contexto.email), fecha_creacion: ahora, activa: true
      });
      altas++;
    });
  });
  return { ok: true, altas, bajas, cambios, message: altas + bajas + cambios ? 'Accesos de ' + depto.nombre + ' guardados.' : 'Sin cambios.' };
}

module.exports = {
  getConfig, listar, getRegistro, guardar, abrirPeriodo, accionLote, listarMiembros, guardarMiembros,
  // Para el importador y los reportes: mismas reglas que la carga a mano.
  moverPeriodo_, periodoDeFecha_, periodoActual_, periodoTexto_, limpiarDatos_, derivados_, situacion_, periodoDeDatos_,
  consultar_, rango_, enTransaccion_, historial_, clientes_, contextoClientes_, resolverClienteTexto_, personas_,
  matrizConPermiso_, acceso_, resumen_, esFinal_, esAnulado_, estadoDef_, columna_, normalizarTexto_, orden_, uuid_,
  MODULO, PERIODO_LISTA, RE_PERIODO, RE_FECHA
};
