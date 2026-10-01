'use strict';

/**
 * controlInternoImportar.js — carga en Control interno las planillas del
 * Drive, COMPLETAS (2022-2026) y como espejo del Excel (2026-10-01).
 *
 * El NAVEGADOR lee el .xlsx (frontend/js/lector-xlsx.js) y manda hoja por
 * hoja las filas tal cual. Aquí:
 *  1. se reconoce de qué matriz es la hoja (por el libro y el nombre de la
 *     hoja: "SEPTIEMBRE 2026" en la de Facturación, "Anexos" en RR.HH.);
 *  2. se encuentra el encabezado (cambia de fila y de forma entre años) y
 *     cada columna se ubica por sus nombres en todas las versiones
 *     (controlInternoColumnas.js); las columnas de usuarios y claves nunca
 *     se leen, y los textos con forma de clave se borran;
 *  3. cada fila se guarda con TODAS sus celdas, su número de fila (para
 *     mostrarla en el mismo orden) y la hoja de origen.
 *
 * Reemplazo (decisión del dueño 2026-10-01): antes de cargar, `prepararImportacion`
 * borra todo lo que vino de planillas (incluida la carga anterior con la
 * estructura vieja). Lo ingresado a mano en SIGSO (sin `_origen`) se conserva.
 * Volver a importar el mismo archivo deja lo mismo: no duplica.
 *
 * Solo ADM. Siempre se puede `simular` primero (no escribe nada).
 */

const crypto = require('node:crypto');
const { agregarFila_ } = require('../db/sqliteRepo');
const { MATRICES, matriz_ } = require('./controlInternoMatrices');
const P = require('./controlInternoPlanillas');
const CI = require('./controlInterno');

const MAX_FILAS = 8000;

// --- qué matriz es cada hoja -------------------------------------------------------------
function matricesDelLibro_(archivo) {
  const a = P.n_(archivo);
  const delLibro = MATRICES.filter((m) => m.archivo && a.indexOf(P.n_(m.archivo)) !== -1);
  return delLibro.length ? delLibro : MATRICES;
}
/** { m, modo: 'mes'|'extra'|'hoja'|'fichas'|'subsanacion', periodo } o null. */
function reconocerHoja_(archivo, hoja, hojas) {
  const nombre = P.n_(hoja);
  const candidatas = matricesDelLibro_(archivo);
  for (const m of candidatas) {
    if ((m.hojas || []).some((h) => P.n_(h) === nombre)) return { m, modo: 'hoja' };
    if ((m.hojasExtra || []).some((h) => P.n_(h) === nombre)) return { m, modo: 'extra' };
  }
  const fichas = candidatas.find((m) => m.especial === 'fichas');
  if (fichas && /^[A-Z]$/.test(nombre)) return { m: fichas, modo: 'fichas' };
  const subs = candidatas.find((m) => m.especial === 'subsanacion');
  if (subs && nombre === 'SUBSANACION') return { m: subs, modo: 'subsanacion' };
  const mensuales = candidatas.filter((m) => m.tipo === 'mensual');
  if (mensuales.length === 1) {
    if (/^COPIA DE /.test(nombre)) return null;
    const per = P.periodosDeHojas_(Array.isArray(hojas) && hojas.length ? hojas : [hoja])[hoja] || '';
    // "CONVENIOS" a secas: el mes sale de la fecha de realización de sus filas.
    if (per || P.n_(hoja) === P.n_(mensuales[0].archivo)) return { m: mensuales[0], modo: 'mes', periodo: per };
  }
  return null;
}

// --- encabezado y columnas -----------------------------------------------------------------
function indiceNombres_(m) {
  const idx = {};
  m.columnas.forEach((c) => (c.nombres || []).forEach((nm) => { idx[nm] = c; }));
  return idx;
}
function conocidos_(m) {
  const s = new Set();
  m.columnas.forEach((c) => (c.nombres || []).forEach((nm) => { s.add(nm.replace(/^.* \/ /, '').replace(/ > .*$/, '').replace(/ #\d+$/, '')); }));
  return s;
}
/** Columnas de la hoja: [{ col, c (columna de la matriz) | null, nombre }]. */
function mapaColumnas_(m, filas, modo) {
  if (m.sinEncabezado) {
    return { iEnc: -1, cols: Object.keys(m.sinEncabezado).map((j) => ({ col: Number(j), c: indiceNombres_(m)[P.n_(m.sinEncabezado[j])] || null, nombre: m.sinEncabezado[j] })) };
  }
  const iEnc = m.depto === 'RRHH' ? P.filaEncabezadoPorTexto_(filas) : P.filaEncabezado_(filas, conocidos_(m), 2);
  if (iEnc === -1) return null;
  const defs = P.columnasDeEncabezado_(filas[iEnc], m.dosNiveles ? filas[iEnc - 1] : null, m.lectura);
  const idx = indiceNombres_(m);
  const cols = defs.filter((d) => d.clave !== P.n_(m.periodoPorFila || '-'))
    .map((d) => ({ col: d.col, c: P.esColumnaDeClave_(d.clave.replace(/^.* \/ /, '')) ? null : (idx[d.clave] || null), nombre: d.etiqueta, clave: d.clave, excluida: P.esColumnaDeClave_(d.clave.replace(/^.* \/ /, '')) }));
  // Cliente en una columna sin nombre (Facturación 2023: la B vacía).
  const cCli = m.columnas.find((c) => c.rol === 'cliente');
  if (cCli && !cols.some((x) => x.c === cCli)) {
    const fEnc = filas[iEnc] || [];
    for (let j = 0; j < 4; j++) {
      if (P.vacio_(fEnc[j]) !== '') continue;
      const llenas = filas.slice(iEnc + 1, iEnc + 25).filter((f) => f && /[A-Za-z]/.test(P.vacio_(f[j]))).length;
      if (llenas > 5) { cols.unshift({ col: j, c: cCli, nombre: '(sin nombre)' }); break; }
    }
  }
  return { iEnc, cols, filaGrupo: m.dosNiveles ? filas[iEnc - 1] : null };
}
/**
 * Hoja mensual sin fila de encabezado (Acuse AGOSTO2025: del título pasa a
 * los datos): las columnas van en el orden actual de la matriz.
 */
function mapaPorPosicion_(m, filas) {
  let inicio = -1;
  for (let i = 0; i < Math.min(filas.length, 20); i++) {
    const f = filas[i] || [];
    if (/[A-Za-z]{3}/.test(P.vacio_(f[0])) && f.filter((v) => P.vacio_(v) !== '').length >= 4) { inicio = i; break; }
  }
  if (inicio === -1) return null;
  const actuales = m.columnas.filter((c) => !c.antigua);
  return { iEnc: inicio - 1, cols: actuales.map((c, j) => ({ col: j, c, nombre: c.etiqueta })), porPosicion: true };
}

// --- filas especiales ---------------------------------------------------------------------------
/** Fichas A–W: bloques por cliente con Notificaciones (col B) y Anotaciones (col G). */
function filasDeFichas_(filas) {
  const out = [];
  const realizado = P.vacio_(((filas[1] || [])[3]));
  const actualizada = P.fecha_(((filas[2] || [])[3]));
  let cliente = '';
  const lado = { B: null, G: null };
  const cerrar = (k) => { const e = lado[k]; if (e && (e.fecha || e.detalle.length)) out.push({ i: e.i, datos: { empresa: cliente, tipo: k === 'B' ? 'NOTIFICACIÓN' : 'ANOTACIÓN', fecha: e.fecha, detalle: e.detalle.join(' ').slice(0, 4000), realizado_por: realizado, ultima_actualizacion: actualizada } }); lado[k] = null; };
  for (let i = 4; i < filas.length; i++) {
    const f = filas[i] || [];
    const b = P.vacio_(f[1]), g = P.vacio_(f[6]);
    // Encabezado de cliente: la fila siguiente (o la de después) dice "Notificaciones".
    const sig = [filas[i + 1], filas[i + 2]].some((x) => x && /^NOTIFICACIONES$/.test(P.n_(x[1])));
    if (b && sig && !P.fecha_(b)) { cerrar('B'); cerrar('G'); cliente = b; continue; }
    if (/^NOTIFICACIONES$/.test(P.n_(b))) continue;
    if (!cliente) continue;
    [['B', f.slice(1, 6)], ['G', f.slice(6, 11)]].forEach(([k, celdas]) => {
      const textos = celdas.map(P.vacio_).filter(Boolean);
      if (!textos.length) return;
      const fecha = P.fecha_(textos[0]);
      if (fecha) { cerrar(k); lado[k] = { i, fecha, detalle: textos.slice(1) }; return; }
      if (!lado[k]) lado[k] = { i, fecha: '', detalle: [] };
      lado[k].detalle.push(...textos);
    });
  }
  cerrar('B'); cerrar('G');
  return out;
}
/** Subsanación: secciones con N°/Empresa y peticiones (fecha + folio), dos tablas lado a lado arriba. */
function filasDeSubsanacion_(filas) {
  const out = [];
  let seccion = '', seccion2 = '';
  const ultimo = { izq: null, der: null };
  const fecha = (v) => P.fecha_(v);
  const folio = (v) => { const s = P.vacio_(v); if (!s) return ''; const n = Number(s); return isFinite(n) ? String(Math.round(n)) : s; };
  const agregarPeticion = (reg, f, j) => {
    if (!reg) return;
    for (let k = 1; k <= 5; k++) if (!reg.datos['peticion_' + k + '_fecha'] && !reg.datos['peticion_' + k + '_folio']) {
      if (fecha(f[j])) reg.datos['peticion_' + k + '_fecha'] = fecha(f[j]);
      if (folio(f[j + 1])) reg.datos['peticion_' + k + '_folio'] = folio(f[j + 1]);
      return;
    }
  };
  for (let i = 0; i < filas.length; i++) {
    const f = filas[i] || [];
    const a = P.vacio_(f[0]), b = P.vacio_(f[1]);
    if (!a && b && !/^\d/.test(b) && f.filter((v) => P.vacio_(v)).length <= 4) {
      if (/^EMPRESAS QUE SE DEBE/.test(P.n_(b))) continue;
      seccion = b;
      seccion2 = P.vacio_(f[8]);
      continue;
    }
    if (/^\d+(\.0)?$/.test(a) && b) {
      const reg = { i, datos: { seccion, n: Number(a), empresa: b } };
      if (fecha(f[5]) || folio(f[6])) agregarPeticion(reg, f, 5);
      out.push(reg); ultimo.izq = reg;
      const h = P.vacio_(f[7]), emp2 = P.vacio_(f[8]);
      if (/^\d+(\.0)?$/.test(h) && emp2) {
        const reg2 = { i: i + 0.5, datos: { seccion: seccion2 || seccion, n: Number(h), empresa: emp2, domicilio: P.vacio_(f[16]) } };
        if (fecha(f[13]) || folio(f[14])) agregarPeticion(reg2, f, 13);
        out.push(reg2); ultimo.der = reg2;
      } else ultimo.der = null;
      continue;
    }
    // "segunda petición": fila solo con fecha y folio debajo de la empresa.
    if (!a && (fecha(f[5]) || folio(f[6]))) agregarPeticion(ultimo.izq, f, 5);
    if (!P.vacio_(f[7]) && (fecha(f[13]) || folio(f[14]))) agregarPeticion(ultimo.der, f, 13);
  }
  return out;
}

// =========================================================================================
// Acciones
// =========================================================================================

/**
 * Antes de importar: borra lo que vino de planillas (de las matrices
 * indicadas, o de todas) y lo de la estructura anterior. data: { matrices?, simular }.
 */
function prepararImportacion(db, data, contexto) {
  if (!contexto || contexto.rol !== 'ADM') return { _forbidden: true, message: 'Solo el administrador importa planillas.' };
  const d = data || {};
  const vigentes = new Set(MATRICES.map((m) => m.clave));
  const pedidas = Array.isArray(d.matrices) && d.matrices.length ? new Set(d.matrices) : null;
  const filas = CI.consultar_(db, 'CI_REGISTROS', {});
  const borrar = filas.filter((r) => {
    const importada = !!(r.datos && r.datos._origen);
    if (!vigentes.has(r.matriz)) return importada || !esVerdaderoActiva_(r);
    if (!importada) return false;
    if (!(r.datos && r.datos._hoja)) return true; // carga con la estructura anterior
    return !pedidas || pedidas.has(r.matriz);
  });
  const porMatriz = {};
  borrar.forEach((r) => { porMatriz[r.matriz] = (porMatriz[r.matriz] || 0) + 1; });
  const conservadas = filas.filter((r) => !(r.datos && r.datos._origen) && vigentes.has(r.matriz)).length;
  if (!d.simular && borrar.length) {
    const ids = borrar.map((r) => r.registro_id);
    CI.enTransaccion_(db, () => {
      const delR = db.prepare('DELETE FROM "CI_REGISTROS" WHERE "registro_id" = ?');
      const delH = db.prepare('DELETE FROM "CI_HISTORIAL" WHERE "registro_id" = ?');
      ids.forEach((id) => { delR.run(JSON.stringify(id)); delH.run(JSON.stringify(id)); });
    });
  }
  return { ok: true, simulado: !!d.simular, a_borrar: borrar.length, por_matriz: porMatriz, conservadas_a_mano: conservadas };
}
function esVerdaderoActiva_(r) { return r.activa === true || r.activa === 'TRUE' || r.activa === 1; }

/**
 * Importa (o simula) UNA hoja. data: { archivo, hoja, hojas: [nombres en orden], filas, simular }.
 */
function importarHoja(db, data, contexto) {
  if (!contexto || contexto.rol !== 'ADM') return { _forbidden: true, message: 'Solo el administrador importa planillas.' };
  const d = data || {};
  const hoja = String(d.hoja || '').slice(0, 120), archivo = String(d.archivo || '').slice(0, 200);
  const filas = Array.isArray(d.filas) ? d.filas.map((f) => (Array.isArray(f) ? f : [])) : [];
  const llenas = filas.filter((f) => f.some((v) => P.vacio_(v) !== '')).length;
  if (llenas > MAX_FILAS) return { ok: false, message: 'La hoja ' + hoja + ' tiene demasiadas filas (' + llenas + ').' };
  const base = { ok: true, archivo, hoja };

  const rec = reconocerHoja_(archivo, hoja, d.hojas);
  if (!rec) return Object.assign(base, { omitida: true, motivo: 'No corresponde a una matriz (notas, listas de validación, cálculos, claves o copias).' });
  const m = rec.m;
  const res = Object.assign(base, {
    matriz: m.clave, nombre: m.nombre, simulado: !!d.simular, periodo: '', leidas: 0, nuevas: 0, ya_estaban: 0,
    fuera_catalogo: 0, fuera_catalogo_ejemplos: [], sin_cuenta: [], columnas_desconocidas: [], columnas_excluidas: [], por_periodo: {}, avisos: []
  });

  // 1. Filas -> { i, datos } según el tipo de hoja.
  let entradas = [];
  let periodoHoja = rec.periodo || '';
  if (rec.modo === 'fichas') entradas = filasDeFichas_(filas);
  else if (rec.modo === 'subsanacion') entradas = filasDeSubsanacion_(filas);
  else {
    let mapa = mapaColumnas_(m, filas, rec.modo);
    if (!mapa && m.tipo === 'mensual') { mapa = mapaPorPosicion_(m, filas); if (mapa) res.avisos.push('La hoja no tiene fila de encabezado: se leyó en el orden de columnas actual.'); }
    if (!mapa) return Object.assign(res, { omitida: true, motivo: 'No se encontró la fila de encabezado.' });
    res.columnas_desconocidas = mapa.cols.filter((x) => !x.c && !x.excluida).map((x) => x.nombre).slice(0, 30);
    res.columnas_excluidas = mapa.cols.filter((x) => x.excluida).map((x) => x.nombre);
    const usadas = mapa.cols.filter((x) => x.c);
    const cCli = m.columnas.find((c) => c.rol === 'cliente');
    const idCols = new Set(m.columnas.filter((c) => c.rol === 'cliente' || c.rol === 'rut' || c.clave === 'codigo' || c.clave === 'n').map((c) => c.clave));
    const encabezado = new Set(usadas.map((x) => P.n_(x.nombre)));
    // Año de las hojas extra (SOLO RENTA / INSUMINE): el número en la fila de grupos.
    let anioExtra = '';
    if (rec.modo === 'extra' && mapa.filaGrupo) anioExtra = String((mapa.filaGrupo.map((v) => /^(20\d{2})(\.0)?$/.exec(String(v || '').trim())).find(Boolean) || [])[1] || '');
    const iMes = rec.modo === 'extra' ? ((filas[mapa.iEnc] || []).findIndex((v) => P.n_(v) === P.n_(m.periodoPorFila)) ) : -1;
    let clienteArrastre = '';
    for (let i = mapa.iEnc + 1; i < filas.length; i++) {
      const f = filas[i];
      if (!f.some((v) => P.vacio_(v) !== '')) continue;
      const datos = {};
      usadas.forEach((x) => { const v = P.valor_(x.c.tipo, f[x.col]); if (v !== '' && datos[x.c.clave] === undefined) datos[x.c.clave] = v; });
      // Celdas de columnas que la matriz no conoce: se guardan igual (no se pierde nada).
      mapa.cols.filter((x) => !x.c && !x.excluida).forEach((x) => { const v = P.sinClaves_(P.vacio_(f[x.col])); if (v) { datos._extra = datos._extra || {}; datos._extra[x.nombre] = v.slice(0, 600); } });
      // Encabezado repetido más abajo: no es una fila.
      if (cCli && datos[cCli.clave] && encabezado.has(P.n_(datos[cCli.clave]))) continue;
      // Hojas extra: el cliente va solo en la primera fila de su bloque.
      if (rec.modo === 'extra' && cCli) {
        if (datos[cCli.clave] && !/^(RUT|CLAVE)\b/i.test(String(datos[cCli.clave]))) clienteArrastre = datos[cCli.clave];
        else delete datos[cCli.clave];
        if (!datos[cCli.clave]) datos[cCli.clave] = clienteArrastre;
      }
      const conDatos = Object.keys(datos).some((k) => !idCols.has(k) && k !== '_extra');
      // En las mensuales, una fila con solo el cliente es una lista pegada bajo la tabla.
      if (m.tipo !== 'lista' && !conDatos) continue;
      if (!m.sinCliente && cCli && !datos[cCli.clave]) continue;
      let periodo = periodoHoja;
      if (rec.modo === 'extra') {
        const mes = iMes !== -1 ? P.mesDeHoja_(f[iMes]) : null;
        periodo = mes && anioExtra ? anioExtra + '-M' + String(mes.mes).padStart(2, '0') : '';
        if (!periodo) continue;
      }
      entradas.push({ i, datos, periodo });
    }
  }

  // 2. Período de cada fila.
  if (m.tipo === 'mensual' && !periodoHoja && rec.modo === 'mes') {
    // Hoja sin mes en el nombre: el mes más repetido en "fecha de realización".
    const cuenta = {};
    entradas.forEach((e) => { const p = CI.periodoDeFecha_(e.datos.fecha_realizacion); if (p) cuenta[p] = (cuenta[p] || 0) + 1; });
    periodoHoja = Object.keys(cuenta).sort((a, b) => cuenta[b] - cuenta[a])[0] || '';
    if (!periodoHoja) return Object.assign(res, { omitida: true, motivo: 'La hoja no dice de qué mes es.' });
    res.avisos.push('El mes se dedujo de las fechas de realización: ' + CI.periodoTexto_(periodoHoja) + '.');
  }
  res.periodo = periodoHoja;
  if (m.tipo === 'registro') {
    // La fecha de la fila; si no tiene, la de la fila anterior (las planillas van en orden).
    let ultimo = '';
    const sinFecha = [];
    entradas.forEach((e) => {
      const p = CI.periodoDeDatos_(m, e.datos);
      if (p) { e.periodo = p; ultimo = p; sinFecha.forEach((x) => { x.periodo = p; }); sinFecha.length = 0; }
      else if (ultimo) { e.periodo = ultimo; e.inferido = true; }
      else { e.inferido = true; sinFecha.push(e); }
    });
    sinFecha.forEach((e) => { e.periodo = CI.periodoActual_(); });
    const inferidos = entradas.filter((e) => e.inferido).length;
    if (inferidos) res.avisos.push(inferidos + ' filas sin fecha: tomaron el mes de la fila anterior.');
  }
  if (m.tipo === 'lista') entradas.forEach((e) => { e.periodo = CI.PERIODO_LISTA; });
  if (m.tipo === 'mensual' && rec.modo === 'mes') entradas.forEach((e) => { e.periodo = periodoHoja; });

  // 3. Registros.
  const ctx = CI.contextoClientes_(db);
  const persona = CI.personas_(db);
  const existentes = CI.consultar_(db, 'CI_REGISTROS', { matriz: m.clave, activa: true });
  const origenes = new Set(existentes.map((r) => (r.datos || {})._origen).filter(Boolean));
  const sinCuenta = new Set(), fueraEj = new Set();
  const cResp = m.columnas.find((c) => c.rol === 'responsable');
  const cCli = m.columnas.find((c) => c.rol === 'cliente'), cRut = m.columnas.find((c) => c.rol === 'rut');
  const nuevos = [];
  const ahora = new Date().toISOString();
  const autor = String(contexto.email || '').toLowerCase();
  entradas.forEach((e) => {
    res.leidas++;
    const huella = crypto.createHash('sha1').update(m.clave + '|' + archivo.replace(/\s*\(\d+\)/g, '') + '|' + hoja + '|' + e.i + '|' + JSON.stringify(e.datos)).digest('hex').slice(0, 24);
    if (origenes.has(huella)) { res.ya_estaban++; return; }
    const datos = Object.assign({}, e.datos, { _origen: huella, _hoja: hoja, _fila: (rec.modo === 'mes' || rec.modo === 'hoja' ? 0 : 100000) + Number(e.i) + 1 });
    if (e.inferido) datos._periodo_inferido = true;
    const cli = m.sinCliente ? { cliente_id: '', cliente_nombre: '', cliente_rut: '' }
      : CI.resolverClienteTexto_(ctx, cCli ? datos[cCli.clave] : '', cRut ? datos[cRut.clave] : '', datos.codigo);
    if (!cli) return;
    if (!m.sinCliente && !cli.cliente_id) { res.fuera_catalogo++; if (fueraEj.size < 8) fueraEj.add(cli.cliente_nombre); }
    const der = CI.derivados_(m, datos, { persona });
    if (cResp && datos[cResp.clave] && !der.responsable_email) sinCuenta.add(String(datos[cResp.clave]));
    nuevos.push(Object.assign({
      registro_id: CI.uuid_(), depto: m.depto, matriz: m.clave, periodo: e.periodo,
      fecha: der.fecha, estado: der.estado, responsable_email: der.responsable_email || '',
      liberado_por: '', fecha_liberacion: '', datos, observaciones: '',
      creado_por: autor, fecha_creacion: ahora, actualizado_por: autor, fecha_actualizacion: ahora, activa: true
    }, cli));
    res.por_periodo[e.periodo] = (res.por_periodo[e.periodo] || 0) + 1;
  });
  res.nuevas = nuevos.length;
  res.sin_cuenta = Array.from(sinCuenta).slice(0, 20);
  res.fuera_catalogo_ejemplos = Array.from(fueraEj);

  if (!d.simular && nuevos.length) {
    CI.enTransaccion_(db, () => {
      nuevos.forEach((r) => {
        agregarFila_(db, 'CI_REGISTROS', r);
        CI.historial_(db, r.registro_id, 'IMPORTADO', 'Importado de ' + (archivo || 'planilla') + ' › ' + hoja, contexto);
      });
    });
  }
  return res;
}

module.exports = { importarHoja, prepararImportacion, reconocerHoja_, filasDeFichas_, filasDeSubsanacion_, mapaColumnas_ };
