'use strict';

/**
 * reporteExcel.js — "Descargar Excel" de los reportes (R-4 de la auditoría de
 * reportes). El navegador manda el reporte como una especificación (lo que se
 * ve: el resumen de los niveles 1–2 y cada tabla) y aquí se arma el .xlsx con
 * el generador compartido (libroExcel.js).
 *
 * Lo que pone el SERVIDOR: "Generado por" (de la sesión, nunca del cliente) y
 * la fecha de emisión en hora de Chile. Tamaños acotados por debajo del 1 MB
 * de nginx y un freno por cuenta.
 */

const { errorValidacion } = require('./errores');
const Libro = require('./libroExcel');
const ReportePdf = require('./reportePdf');

const MAX_HOJAS = 20;
const MAX_CELDAS = 150000;
const POR_MINUTO = 20;

const usos_ = new Map();
function dentroDelFreno_(clave) {
  const ahora = Date.now();
  const l = (usos_.get(clave) || []).filter((t) => ahora - t < 60 * 1000);
  if (l.length >= POR_MINUTO) { usos_.set(clave, l); return false; }
  l.push(ahora);
  usos_.set(clave, l);
  return true;
}

function texto_(v, max) { return String(v === undefined || v === null ? '' : v).slice(0, max || 500); }
function celda_(c) {
  if (c && typeof c === 'object' && !Array.isArray(c)) return { v: texto_(c.v, 32000), tono: texto_(c.tono, 20) };
  if (typeof c === 'number') return c;
  return texto_(c, 32000);
}

// Normaliza lo que llega del cliente a la forma que espera libroExcel (sin campos de más).
function normalizar_(data, generadoPor) {
  const res = data.resumen && typeof data.resumen === 'object' ? data.resumen : null;
  const meta = (Array.isArray(data.meta) ? data.meta : [])
    .filter((m) => Array.isArray(m) && m.length >= 2 && !/^generado por$/i.test(String(m[0]).trim()))
    .slice(0, 20).map((m) => [texto_(m[0], 80), texto_(m[1], 300)]);
  meta.push(['Generado por', generadoPor || 'SIGSO'], ['Emitido', ReportePdf.fechaChile_(new Date())]);
  return {
    titulo: texto_(data.titulo || 'Reporte', 160), subtitulo: texto_(data.subtitulo, 300), meta,
    resumen: res ? {
      estado: texto_(res.estado, 20), frase: texto_(res.frase, 2000),
      kpis: (Array.isArray(res.kpis) ? res.kpis : []).slice(0, 20).map((k) => ({ etiqueta: texto_(k.etiqueta, 120), valor: texto_(k.valor, 60), nota: texto_(k.nota, 300) })),
      alertas: Array.isArray(res.alertas) ? res.alertas.slice(0, 200).map((a) => ({
        severidad: a.severidad === 'critico' ? 'critico' : 'alerta', cantidad: texto_(a.cantidad, 30), titulo: texto_(a.titulo, 300),
        detalle: texto_(a.detalle, 2000), dueno: texto_(a.dueno, 120) })) : undefined,
      bien: (Array.isArray(res.bien) ? res.bien : []).slice(0, 20).map((b) => texto_(b, 500))
    } : null,
    hojas: (Array.isArray(data.hojas) ? data.hojas : []).slice(0, MAX_HOJAS).map((h) => ({
      nombre: texto_(h && h.nombre, 80),
      columnas: (Array.isArray(h && h.columnas) ? h.columnas : []).slice(0, 60).map((c) => texto_(c, 200)),
      filas: (Array.isArray(h && h.filas) ? h.filas : []).map((f) => (Array.isArray(f) ? f.slice(0, 60).map(celda_) : []))
    }))
  };
}

function nombreArchivo_(n) {
  const base = String(n || 'sigso-reporte').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'sigso-reporte';
  let dia;
  try { dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); } catch (e) { dia = new Date().toISOString().slice(0, 10); }
  return base.replace(/\.(xlsx|csv)$/, '') + '-' + dia + '.xlsx';
}

/**
 * data: { titulo, subtitulo, meta, resumen, hojas, nombre_archivo }.
 * Devuelve { xlsx_base64, filename }.
 */
function generarExcelReporte(db, data, contexto) {
  data = data || {};
  const hojas = Array.isArray(data.hojas) ? data.hojas : [];
  if (!hojas.length && !data.resumen) return errorValidacion('hojas', 'El reporte no tiene datos que exportar.');
  if (hojas.length > MAX_HOJAS) return errorValidacion('hojas', 'El reporte tiene demasiadas tablas para un Excel.');
  const celdas = hojas.reduce((s, h) => s + (Array.isArray(h && h.filas) ? h.filas.reduce((t, f) => t + (Array.isArray(f) ? f.length : 0), 0) : 0), 0);
  if (celdas > MAX_CELDAS) return errorValidacion('hojas', 'El reporte es demasiado grande para un Excel. Acota los filtros.');
  if (!dentroDelFreno_(contexto.cuenta_id || contexto.email)) return errorValidacion('hojas', 'Generaste muchos Excel en el último minuto. Espera un momento.');
  const buf = Libro.construirLibro(normalizar_(data, ReportePdf.nombreCuenta_(db, contexto)));
  return { xlsx_base64: buf.toString('base64'), filename: nombreArchivo_(data.nombre_archivo || data.titulo) };
}

module.exports = { generarExcelReporte, _usos: usos_ };
