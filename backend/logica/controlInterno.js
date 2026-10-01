'use strict';

/**
 * controlInterno.js — módulo "Control interno" (2026-10-01): las matrices de
 * Contabilidad y RR.HH. que hoy se llenan en el Drive, dentro de SIGSO.
 * Pedido del dueño: probar si ingresar los datos aquí suma al proceso actual
 * y, sobre todo, poder sacar reportes (hoy no se sacan por lo difícil que es
 * en el Drive). Mientras tanto el Drive sigue siendo el registro oficial para
 * la certificación: este módulo NO escribe en el SGC (servicios prestados).
 *
 * Diseño (ver documentacion/SIGSO-control-interno.md):
 *  - Un solo motor; cada matriz es configuración (controlInternoMatrices.js).
 *  - Permisos REALES en el servidor: el módulo `control_interno` en la cuenta
 *    (o ADM) y, por departamento, CI_MIEMBROS (REGISTRA / LECTURA). Ven todo
 *    sin registrar: Gerencia y el Encargado del SGC. Libera quien libera el
 *    área en Calidad (SGC_LIBERADORES / jefatura / Encargado): una sola
 *    lista "Quién libera" para los dos módulos. Nadie libera lo suyo.
 *  - Escala: se consulta filtrando en SQL por matriz + período, con índice.
 *    Un mes de la matriz más grande son ~220 filas; el año, ~10.000.
 *  - Trazabilidad: CI_HISTORIAL guarda quién creó, cambió, liberó o anuló.
 *    Editar un registro liberado le quita la liberación (hay que revisarlo
 *    de nuevo): lo liberado es lo que alguien revisó, no una versión vieja.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_, encabezadosReales_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { DEPARTAMENTOS, MATRICES, matriz_ } = require('./controlInternoMatrices');
const Prestaciones = require('./prestacionesSgc');

const MODULO = 'control_interno';
const ROLES_MIEMBRO = ['REGISTRA', 'LECTURA'];
const TOPE_LOTE = 300;
const MAX_ITEMS = 30;
const RE_PERIODO = /^\d{4}-M(0[1-9]|1[0-2])$/;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^([01]?\d|2[0-3]):[0-5]\d$/;
const ESTADOS_CHECK = ['OK', 'PENDIENTE', 'NO_APLICA'];

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
 * módulo guarda datos de trabajadores y montos de clientes).
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
    deptos[d.clave] = { ve: registra || libera || veTodo || !!m, registra, libera };
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

// --- estados ------------------------------------------------------------------------------

function estadoDef_(m, clave) { return m.estados.find((e) => e.clave === clave) || null; }
function esAnulado_(clave) { return /^ANULAD/.test(String(clave || '')); }
function esFinal_(m, clave) { const e = estadoDef_(m, clave); return !!(e && e.final); }
function liberable_(m, r) { return esFinal_(m, r.estado) && !esAnulado_(r.estado) && !r.liberado_por; }
// Convenios: el estado sale de las cuotas (antes "SITUACIÓN CONVENIO 1..9" a mano).
function estadoCalculado_(m, datos) {
  if (m.estadoCalculado !== 'convenios') return '';
  const l = Array.isArray(datos.convenios) ? datos.convenios : [];
  if (!l.length) return 'SIN_CONVENIO';
  return l.some((c) => Number(c.cuotas_vencidas) > 0) ? 'CON_VENCIDAS' : 'AL_DIA';
}

// --- validación de campos -------------------------------------------------------------------

function valorCampo_(c, v) {
  if (v === undefined || v === null) return { v: '' };
  switch (c.tipo) {
    case 'numero': case 'monto': {
      const s = String(v).trim().replace(/\$/g, '').replace(/\s/g, '');
      if (s === '') return { v: '' };
      const n = Number(c.tipo === 'monto' ? s.replace(/\./g, '').replace(',', '.') : s.replace(',', '.'));
      if (!isFinite(n)) return { error: c.etiqueta + ' tiene que ser un número.' };
      return { v: n };
    }
    case 'fecha': {
      const s = String(v).trim().slice(0, 10);
      if (s && !RE_FECHA.test(s)) return { error: c.etiqueta + ': la fecha no es válida.' };
      return { v: s };
    }
    case 'hora': {
      const s = String(v).trim().slice(0, 5);
      if (s && !RE_HORA.test(s)) return { error: c.etiqueta + ': la hora no es válida (hh:mm).' };
      return { v: s };
    }
    case 'lista': {
      const s = String(v).trim();
      if (s && (c.opciones || []).indexOf(s) === -1) return { error: c.etiqueta + ': "' + s + '" no está en la lista.' };
      return { v: s };
    }
    case 'persona': {
      const s = normalizarEmail_(v);
      if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return { error: c.etiqueta + ': elige a la persona del directorio.' };
      return { v: s };
    }
    case 'texto_largo': return { v: String(v).trim().slice(0, 4000) };
    case 'items': {
      if (!Array.isArray(v)) return { v: [] };
      if (v.length > MAX_ITEMS) return { error: c.etiqueta + ': máximo ' + MAX_ITEMS + ' filas.' };
      const filas = [];
      for (const it of v) {
        const fila = {};
        let alguno = false;
        for (const sc of c.subcampos) {
          const r = valorCampo_(sc, it && it[sc.clave]);
          if (r.error) return { error: c.etiqueta + ' › ' + r.error };
          fila[sc.clave] = r.v;
          if (r.v !== '') alguno = true;
        }
        if (alguno) filas.push(fila);
      }
      return { v: filas };
    }
    case 'checklist': {
      const o = {};
      const entrada = v && typeof v === 'object' ? v : {};
      for (const g of c.grupos) {
        const eg = entrada[g.clave] && typeof entrada[g.clave] === 'object' ? entrada[g.clave] : {};
        const items = {};
        g.items.forEach((nombre) => {
          const e = String((eg.items || {})[nombre] || '').toUpperCase();
          items[nombre] = ESTADOS_CHECK.indexOf(e) !== -1 ? e : '';
        });
        const quien = normalizarEmail_(eg.quien);
        const fecha = String(eg.fecha || '').slice(0, 10);
        if (fecha && !RE_FECHA.test(fecha)) return { error: g.nombre + ': la fecha no es válida.' };
        o[g.clave] = { quien, fecha, items };
      }
      return { v: o };
    }
    default: return { v: String(v).trim().slice(0, 300) };
  }
}
function limpiarDatos_(m, entrada, base) {
  const datos = Object.assign({}, base || {});
  const e = entrada && typeof entrada === 'object' ? entrada : {};
  for (const c of m.campos) {
    if (!Object.prototype.hasOwnProperty.call(e, c.clave)) continue;
    const r = valorCampo_(c, e[c.clave]);
    if (r.error) return { error: r.error };
    datos[c.clave] = r.v;
  }
  return { datos };
}
// Avance de una checklist: OK sobre lo que aplica.
function avanceChecklist_(m, datos) {
  const c = m.campos.find((x) => x.tipo === 'checklist');
  if (!c) return null;
  let ok = 0, aplica = 0;
  c.grupos.forEach((g) => g.items.forEach((nombre) => {
    const e = (((datos[c.clave] || {})[g.clave] || {}).items || {})[nombre];
    if (e === 'NO_APLICA') return;
    aplica++;
    if (e === 'OK') ok++;
  }));
  return { ok, aplica, pct: aplica ? Math.round(100 * ok / aplica) : 0 };
}

function formatear_(m, r) {
  return {
    registro_id: r.registro_id, matriz: r.matriz, periodo: r.periodo,
    cliente_id: r.cliente_id || '', cliente_nombre: r.cliente_nombre || '', cliente_rut: r.cliente_rut || '',
    fecha: r.fecha || '', estado: r.estado, responsable_email: r.responsable_email || '',
    liberado_por: r.liberado_por || '', fecha_liberacion: r.fecha_liberacion || '',
    datos: r.datos && typeof r.datos === 'object' ? r.datos : {}, observaciones: r.observaciones || '',
    avance: avanceChecklist_(m, r.datos || {}),
    creado_por: r.creado_por || '', actualizado_por: r.actualizado_por || '', fecha_actualizacion: r.fecha_actualizacion || r.fecha_creacion || ''
  };
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

// Clientes del catálogo (los que se eligen al registrar). Fuera del catálogo se
// permite escribir el nombre: así el propio módulo muestra qué falta conciliar.
function clientes_(db) {
  try {
    return leerFilas_(db, 'CAT_CLIENTES', COLUMNAS.CAT_CLIENTES).filter((c) => esVerdadero_(c.activo))
      .map((c) => ({ cliente_id: c.cliente_id, nombre: c.razon_social || '', rut: c.rut || '', codigo: c.codigo_cliente || '' }));
  } catch (e) { return []; }
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
  if (visibles.length) {
    // Una consulta por matriz: usa el índice (matriz, período).
    visibles.forEach((m) => { resumen[m.clave] = resumen_(m, consultar_(db, 'CI_REGISTROS', { matriz: m.clave, periodo, activa: true })); });
  }
  return {
    yo: ac.email,
    periodo,
    puede_administrar: ac.esAdmin,
    departamentos: deptos.map((d) => Object.assign({ clave: d.clave, nombre: d.nombre, liberadores: Prestaciones.liberadoresDeArea_(db, d.area) }, ac.deptos[d.clave])),
    matrices: visibles.map((m) => ({
      clave: m.clave, depto: m.depto, nombre: m.nombre, descripcion: m.descripcion, servicio: m.servicio || '',
      periodica: !!m.periodica, unaPorCliente: !!m.unaPorCliente, abrirMes: !!m.periodica && (m.unaPorCliente || !!m.copiar),
      estadoCalculado: !!m.estadoCalculado, tiempos: m.tiempos || null, fechaPrincipal: m.fechaPrincipal || '',
      estados: m.estados, campos: m.campos
    })),
    clientes: visibles.length ? clientes_(db) : [],
    resumen
  };
}

/** Registros de una matriz en un período (siempre acotado por período). */
function listar(db, data, contexto) {
  const d = data || {};
  const x = matrizConPermiso_(db, contexto, d.matriz, 've');
  if (x.error) return x.error;
  const periodo = String(d.periodo || '');
  if (!RE_PERIODO.test(periodo)) return { ok: false, message: 'Indica el período.' };
  const filas = consultar_(db, 'CI_REGISTROS', { matriz: x.m.clave, periodo, activa: true });
  const anterior = moverPeriodo_(periodo, -1);
  const delAnterior = consultar_(db, 'CI_REGISTROS', { matriz: x.m.clave, periodo: anterior, activa: true }).filter((r) => !esAnulado_(r.estado));
  const registros = filas.map((r) => formatear_(x.m, r))
    .sort((a, b) => a.cliente_nombre.localeCompare(b.cliente_nombre, 'es') || String(a.registro_id).localeCompare(String(b.registro_id)));
  return {
    matriz: x.m.clave, periodo, periodo_anterior: anterior,
    puede_registrar: x.p.registra, puede_liberar: x.p.libera, gobierna: x.ac.gobierna, yo: x.ac.email,
    registros, resumen: resumen_(x.m, filas), en_periodo_anterior: delAnterior.length,
    // Lo que "Abrir el mes" crearía (clientes del mes anterior que faltan en este).
    por_abrir: x.m.periodica && (x.m.unaPorCliente || x.m.copiar)
      ? delAnterior.filter((a) => !filas.some((f) => mismoCliente_(f, a) && (x.m.unaPorCliente || (x.m.copiar || []).every((k) => JSON.stringify((f.datos || {})[k]) === JSON.stringify((a.datos || {})[k]))))).length
      : 0
  };
}

/** Un registro con su historial. */
function getRegistro(db, data, contexto) {
  const r = registroPorId_(db, data && data.registro_id);
  if (!r) return { ok: false, message: 'No se encontró el registro.' };
  const x = matrizConPermiso_(db, contexto, r.matriz, 've');
  if (x.error) return x.error;
  const hist = consultar_(db, 'CI_HISTORIAL', { registro_id: r.registro_id })
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  return { registro: formatear_(x.m, r), historial: hist.map((h) => ({ accion: h.accion, detalle: h.detalle, usuario_email: h.usuario_email, fecha: h.fecha })), puede_registrar: x.p.registra, puede_liberar: x.p.libera };
}

function resolverCliente_(db, d) {
  const id = String(d.cliente_id || '').trim();
  if (id) {
    const c = clientes_(db).find((k) => k.cliente_id === id);
    if (!c) return { error: 'El cliente no está en el catálogo de SIGSO.' };
    return { cliente_id: c.cliente_id, cliente_nombre: c.nombre, cliente_rut: c.rut };
  }
  const nombre = String(d.cliente_nombre || '').trim().slice(0, 200);
  if (nombre.length < 3) return { error: 'Elige el cliente (o escribe su nombre si no está en el catálogo).' };
  return { cliente_id: '', cliente_nombre: nombre, cliente_rut: String(d.cliente_rut || '').trim().slice(0, 20) };
}
function mismoCliente_(a, b) {
  if (a.cliente_id || b.cliente_id) return a.cliente_id === b.cliente_id;
  return normalizarTexto_(a.cliente_nombre) === normalizarTexto_(b.cliente_nombre);
}
function etiquetasCambiadas_(m, antes, despues) {
  return m.campos.filter((c) => JSON.stringify(antes[c.clave] === undefined ? '' : antes[c.clave]) !== JSON.stringify(despues[c.clave] === undefined ? '' : despues[c.clave]))
    .map((c) => c.etiqueta);
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

  const limpio = limpiarDatos_(m, d.datos, existente ? existente.datos : {});
  if (limpio.error) return { ok: false, message: limpio.error };
  const datos = limpio.datos;

  let estado = d.estado !== undefined ? String(d.estado) : (existente ? existente.estado : m.estados[0].clave);
  if (!estadoDef_(m, estado)) return { ok: false, message: 'Estado no válido.' };
  const calculado = estadoCalculado_(m, datos);
  if (calculado) estado = calculado;

  const responsable = d.responsable_email !== undefined ? normalizarEmail_(d.responsable_email) : (existente ? existente.responsable_email : x.ac.email);
  if (responsable && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(responsable)) return { ok: false, message: 'Elige a la persona que lo realiza.' };
  const fecha = m.fechaPrincipal ? String(datos[m.fechaPrincipal] || '') : '';
  const ahora = new Date().toISOString();

  if (!existente) {
    const cli = resolverCliente_(db, d);
    if (cli.error) return { ok: false, message: cli.error };
    let periodo = String(d.periodo || '');
    if (!m.periodica) periodo = periodoDeFecha_(fecha) || (RE_PERIODO.test(periodo) ? periodo : periodoActual_());
    if (!RE_PERIODO.test(periodo)) return { ok: false, message: 'Indica el período.' };
    if (m.unaPorCliente) {
      const ya = consultar_(db, 'CI_REGISTROS', { matriz: m.clave, periodo, activa: true }).find((r) => mismoCliente_(r, cli));
      if (ya) return { ok: false, message: cli.cliente_nombre + ' ya tiene su registro en este período: edítalo en la tabla.' };
    }
    const fila = Object.assign({
      registro_id: uuid_(), depto: m.depto, matriz: m.clave, periodo,
      fecha, estado, responsable_email: responsable, liberado_por: '', fecha_liberacion: '',
      datos, observaciones: String(d.observaciones || '').trim().slice(0, 2000),
      creado_por: x.ac.email, fecha_creacion: ahora, actualizado_por: x.ac.email, fecha_actualizacion: ahora, activa: true
    }, cli);
    enTransaccion_(db, () => {
      agregarFila_(db, 'CI_REGISTROS', fila);
      historial_(db, fila.registro_id, 'CREADO', m.nombre + ' · ' + cli.cliente_nombre, contexto);
    });
    return { ok: true, registro: formatear_(m, fila), message: 'Registro creado.' };
  }

  const cambios = { datos, estado, responsable_email: responsable, fecha, actualizado_por: x.ac.email, fecha_actualizacion: ahora };
  if (d.observaciones !== undefined) cambios.observaciones = String(d.observaciones || '').trim().slice(0, 2000);
  if (!m.periodica && fecha) cambios.periodo = periodoDeFecha_(fecha);
  if (d.cliente_id !== undefined || d.cliente_nombre !== undefined) {
    const cli = resolverCliente_(db, d);
    if (cli.error) return { ok: false, message: cli.error };
    Object.assign(cambios, cli);
  }
  const detalle = etiquetasCambiadas_(m, existente.datos || {}, datos);
  if (existente.estado !== estado) detalle.push('Estado: ' + ((estadoDef_(m, existente.estado) || {}).etiqueta || existente.estado) + ' → ' + estadoDef_(m, estado).etiqueta);
  if (existente.responsable_email !== responsable) detalle.push('Responsable');
  if (cambios.observaciones !== undefined && cambios.observaciones !== existente.observaciones) detalle.push('Observaciones');
  if (cambios.cliente_nombre !== undefined && cambios.cliente_nombre !== existente.cliente_nombre) detalle.push('Cliente');
  if (!detalle.length) return { ok: true, registro: formatear_(m, existente), message: 'Sin cambios.' };

  // Lo liberado es lo que alguien revisó: si cambia, vuelve a revisión.
  const revierte = !!existente.liberado_por;
  if (revierte) { cambios.liberado_por = ''; cambios.fecha_liberacion = ''; }
  enTransaccion_(db, () => {
    actualizarFilaPorId_(db, 'CI_REGISTROS', 'registro_id', existente.registro_id, cambios);
    historial_(db, existente.registro_id, 'EDITADO', detalle.join(' · '), contexto);
    if (revierte) historial_(db, existente.registro_id, 'LIBERACION_REVERTIDA', 'Se editó después de liberado: hay que liberarlo de nuevo.', contexto);
  });
  return {
    ok: true, registro: formatear_(m, Object.assign({}, existente, cambios)),
    message: revierte ? 'Guardado. Estaba liberado: queda para liberar de nuevo.' : 'Guardado.'
  };
}

/**
 * "Abrir el mes": crea los registros del período a partir del anterior
 * (los mismos clientes, en estado inicial). En las matrices con una fila por
 * cliente es lo que hoy se hace copiando la hoja del mes pasado.
 */
function abrirPeriodo(db, data, contexto) {
  const d = data || {};
  const x = matrizConPermiso_(db, contexto, d.matriz, 'registra');
  if (x.error) return x.error;
  const m = x.m;
  if (!m.periodica || !(m.unaPorCliente || m.copiar)) return { ok: false, message: 'Esta matriz no se abre por mes: se registra cada requerimiento.' };
  const periodo = String(d.periodo || '');
  if (!RE_PERIODO.test(periodo)) return { ok: false, message: 'Indica el período.' };
  const origen = consultar_(db, 'CI_REGISTROS', { matriz: m.clave, periodo: moverPeriodo_(periodo, -1), activa: true }).filter((r) => !esAnulado_(r.estado));
  if (!origen.length) return { ok: false, message: 'El mes anterior no tiene registros que copiar.' };
  const actuales = consultar_(db, 'CI_REGISTROS', { matriz: m.clave, periodo, activa: true });
  const copiar = m.copiar || [];
  const ahora = new Date().toISOString();
  let creadas = 0, omitidas = 0;
  enTransaccion_(db, () => {
    origen.forEach((o) => {
      const datos = {};
      copiar.forEach((k) => { if (o.datos && o.datos[k] !== undefined) datos[k] = o.datos[k]; });
      const repetido = actuales.some((a) => mismoCliente_(a, o) && (m.unaPorCliente || copiar.every((k) => JSON.stringify((a.datos || {})[k]) === JSON.stringify(datos[k]))));
      if (repetido) { omitidas++; return; }
      const estado = estadoCalculado_(m, datos) || m.estados[0].clave;
      const fila = {
        registro_id: uuid_(), depto: m.depto, matriz: m.clave, periodo,
        cliente_id: o.cliente_id || '', cliente_nombre: o.cliente_nombre || '', cliente_rut: o.cliente_rut || '',
        fecha: '', estado, responsable_email: o.responsable_email || x.ac.email, liberado_por: '', fecha_liberacion: '',
        datos, observaciones: '', creado_por: x.ac.email, fecha_creacion: ahora, actualizado_por: x.ac.email, fecha_actualizacion: ahora, activa: true
      };
      agregarFila_(db, 'CI_REGISTROS', fila);
      historial_(db, fila.registro_id, 'CREADO', 'Creado al abrir el mes, desde ' + periodoTexto_(moverPeriodo_(periodo, -1)), contexto);
      actuales.push(fila);
      creadas++;
    });
  });
  return { ok: true, creadas, omitidas, message: creadas + (creadas === 1 ? ' registro creado' : ' registros creados') + (omitidas ? '; ' + omitidas + ' ya estaban.' : '.') };
}

/**
 * Acciones sobre varios registros: cambiar estado, cambiar responsable,
 * liberar, quitar la liberación o anular. Lo que no se puede no frena al
 * resto: vuelve en `omitidas` con el motivo.
 */
function accionLote(db, data, contexto) {
  const d = data || {};
  const accion = String(d.accion || '');
  const que = accion === 'liberar' || accion === 'desliberar' ? 'libera' : 'registra';
  const x = matrizConPermiso_(db, contexto, d.matriz, que);
  if (x.error) return x.error;
  const m = x.m;
  const ids = Array.isArray(d.ids) ? Array.from(new Set(d.ids.map(String))).filter(Boolean) : [];
  if (!ids.length) return { ok: false, message: 'Marca al menos un registro.' };
  if (ids.length > TOPE_LOTE) return { ok: false, message: 'Máximo ' + TOPE_LOTE + ' por vez.' };
  if (['estado', 'responsable', 'liberar', 'desliberar', 'anular'].indexOf(accion) === -1) return { ok: false, message: 'Acción no válida.' };
  if (accion === 'estado' && !estadoDef_(m, d.estado)) return { ok: false, message: 'Estado no válido.' };
  if (accion === 'estado' && m.estadoCalculado) return { ok: false, message: 'En esta matriz el estado se calcula solo.' };
  const responsable = normalizarEmail_(d.responsable_email);
  if (accion === 'responsable' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(responsable)) return { ok: false, message: 'Elige a la persona.' };

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
        if (esAnulado_(r.estado)) return omitir('Está anulado.');
        if (!esFinal_(m, r.estado)) return omitir('Todavía no está terminado (' + ((estadoDef_(m, r.estado) || {}).etiqueta || r.estado) + ').');
        if (!x.ac.gobierna && normalizarEmail_(r.responsable_email) === x.ac.email) return omitir('Lo realizaste tú: lo libera otra persona.');
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
      } else if (accion === 'estado') {
        if (r.estado === d.estado) return omitir('Ya estaba en ese estado.');
        cambios = { estado: d.estado };
        if (r.liberado_por) { cambios.liberado_por = ''; cambios.fecha_liberacion = ''; }
        hist = 'Estado: ' + ((estadoDef_(m, r.estado) || {}).etiqueta || r.estado) + ' → ' + estadoDef_(m, d.estado).etiqueta;
      } else if (accion === 'responsable') {
        if (normalizarEmail_(r.responsable_email) === responsable) return omitir('Ya era el responsable.');
        cambios = { responsable_email: responsable };
        hist = 'Responsable cambiado';
      }
      cambios.actualizado_por = x.ac.email;
      cambios.fecha_actualizacion = ahora;
      actualizarFilaPorId_(db, 'CI_REGISTROS', 'registro_id', id, cambios);
      historial_(db, id, accion.toUpperCase(), hist, contexto);
      hechos++;
    });
  });
  const VERBOS = { liberar: ['liberado', 'liberados'], desliberar: ['quedó sin liberar', 'quedaron sin liberar'], anular: ['anulado', 'anulados'], estado: ['actualizado', 'actualizados'], responsable: ['actualizado', 'actualizados'] };
  const v = VERBOS[accion];
  return {
    ok: true, hechos, omitidas,
    message: hechos + (hechos === 1 ? ' registro ' + v[0] : ' registros ' + v[1]) +
      (omitidas.length ? '; ' + omitidas.length + ' sin cambio (ver motivo).' : '.')
  };
}

/**
 * Reporte de una matriz en un rango de períodos: lo que hoy no se saca del
 * Drive. Por mes, por estado, por responsable, pendientes que arrastran
 * meses y, si la matriz los tiene, días entre recepción y envío.
 */
function reporte(db, data, contexto) {
  const d = data || {};
  const x = matrizConPermiso_(db, contexto, d.matriz, 've');
  if (x.error) return x.error;
  const m = x.m;
  const hasta = RE_PERIODO.test(String(d.hasta || '')) ? d.hasta : periodoActual_();
  const desde = RE_PERIODO.test(String(d.desde || '')) ? d.desde : moverPeriodo_(hasta, -11);
  if (desde > hasta) return { ok: false, message: 'El rango está al revés.' };
  const filas = consultar_(db, 'CI_REGISTROS', { matriz: m.clave, activa: true }, {
    sql: '"periodo" >= ? AND "periodo" <= ?', params: [JSON.stringify(desde), JSON.stringify(hasta)]
  }).filter((r) => !esAnulado_(r.estado));

  const meses = [];
  for (let p = desde; p <= hasta && meses.length < 60; p = moverPeriodo_(p, 1)) meses.push(p);
  const porMes = meses.map((p) => {
    const f = filas.filter((r) => r.periodo === p);
    const res = resumen_(m, f);
    return { periodo: p, total: res.total, finalizados: res.finalizados, pendientes: res.pendientes, liberados: res.liberados, por_estado: res.por_estado };
  });
  const porResp = {};
  filas.forEach((r) => {
    const k = r.responsable_email || '(sin responsable)';
    const o = porResp[k] = porResp[k] || { email: r.responsable_email || '', total: 0, finalizados: 0, liberados: 0 };
    o.total++;
    if (esFinal_(m, r.estado)) o.finalizados++;
    if (r.liberado_por) o.liberados++;
  });
  const porCliente = {};
  filas.forEach((r) => {
    const k = r.cliente_id || 'N:' + normalizarTexto_(r.cliente_nombre);
    const o = porCliente[k] = porCliente[k] || { cliente_nombre: r.cliente_nombre, fuera_catalogo: !r.cliente_id, total: 0, pendientes: 0 };
    o.total++;
    if (!esFinal_(m, r.estado)) o.pendientes++;
  });
  // Lo que arrastra: sin terminar en meses ya cerrados.
  const actual = periodoActual_();
  const arrastre = filas.filter((r) => r.periodo < actual && !esFinal_(m, r.estado))
    .map((r) => ({ registro_id: r.registro_id, periodo: r.periodo, cliente_nombre: r.cliente_nombre, estado: r.estado, responsable_email: r.responsable_email }))
    .sort((a, b) => a.periodo.localeCompare(b.periodo)).slice(0, 200);

  let tiempos = null;
  if (m.tiempos) {
    const [a, b] = m.tiempos;
    const dias = (r) => {
      const fa = (r.datos || {})[a], fb = (r.datos || {})[b];
      if (!RE_FECHA.test(String(fa || '')) || !RE_FECHA.test(String(fb || ''))) return null;
      return Math.round((Date.parse(fb + 'T12:00:00Z') - Date.parse(fa + 'T12:00:00Z')) / 86400000);
    };
    const etq = (k) => (m.campos.find((c) => c.clave === k) || {}).etiqueta || k;
    tiempos = {
      desde: etq(a), hasta: etq(b),
      por_mes: meses.map((p) => {
        const l = filas.filter((r) => r.periodo === p).map(dias).filter((n) => n !== null && n >= 0);
        return { periodo: p, casos: l.length, promedio: l.length ? Math.round(10 * l.reduce((s, n) => s + n, 0) / l.length) / 10 : null };
      })
    };
  }
  const total = resumen_(m, filas);
  return {
    matriz: m.clave, nombre: m.nombre, desde, hasta, estados: m.estados,
    total, por_mes: porMes,
    por_responsable: Object.values(porResp).sort((p, q) => q.total - p.total),
    por_cliente: Object.values(porCliente).sort((p, q) => q.total - p.total).slice(0, 25),
    fuera_catalogo: Object.values(porCliente).filter((c) => c.fuera_catalogo).length,
    arrastre, tiempos
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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: 'Revisa el correo ' + email + '.' };
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
  getConfig, listar, getRegistro, guardar, abrirPeriodo, accionLote, reporte, listarMiembros, guardarMiembros,
  moverPeriodo_, MODULO
};
