'use strict';

/**
 * reporteActividades.js — puerto de backend/backoffice/ReporteActividades.gs
 * (v7.0 Fase 5, §4.8): "3 motores + filtros comunes" en PDF, más la
 * "Acta de reunión de seguimiento". La lógica de datos (qué filas salen,
 * cómo se calculan los resúmenes) ya vive portada en actividades.js
 * (generarReporte/generarActaReunion) — este módulo SOLO dibuja esos
 * datos como PDF, igual que el .gs solo los convertía a HTML.
 *
 * Diferencia de diseño respecto del .gs: reusa el mismo "chrome"
 * (pdfDocumento.js) que Orden de Trabajo, en vez de un encabezado propio
 * más simple — mismo criterio ya documentado ahí (contenido > pixel a
 * pixel) y de paso unifica la papelería de SIGSO en un solo estilo.
 */

const Actividades = require('./actividades');
const Utils = require('./utils');
const PdfDoc = require('./pdfDocumento');

const TITULOS = {
  estado_actual: 'Estado actual',
  cumplimiento_periodo: 'Cumplimiento del período',
  carga_capacidad: 'Carga y capacidad'
};

const ETIQUETAS_RESUMEN = {
  total: 'Total', comprometidas: 'Comprometidas', cumplidas_a_tiempo: 'Cumplidas a tiempo',
  pct_cumplimiento: '% cumplimiento', vencidas: 'Vencidas',
  reprogramaciones_promedio: 'Reprogramaciones prom.', emergentes: 'Emergentes', pct_emergente: '% emergente'
};

function formatearCelda_(valor) {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(valor)) return PdfDoc.fechaCorta_(valor);
  return String(valor);
}

async function descargarReporte(db, data, contexto) {
  const reporte = Actividades.generarReporte(db, data, contexto);
  if (reporte && (reporte._validationError || reporte._forbidden)) return reporte;

  const doc = PdfDoc.crearDocumento();
  PdfDoc.encabezado(doc, { tipoDoc: TITULOS[reporte.tipo] || 'Reporte', referencia: '', etiquetaReferencia: '' });
  const resumenPares = Object.keys(reporte.resumen || {}).map((k) => [ETIQUETAS_RESUMEN[k] || k, formatearCelda_(reporte.resumen[k])]);
  if (resumenPares.length) PdfDoc.lineaResumen(doc, resumenPares);
  PdfDoc.tablaGenerica(doc, reporte.columnas, reporte.filas, (v) => formatearCelda_(v));
  PdfDoc.pie(doc);
  const buffer = await PdfDoc.finalizar(doc);

  const filename = 'SIGSO-reporte-' + data.tipo + '-' + Utils.claveDia_(new Date(), 'America/Santiago') + '.pdf';
  return { pdf_base64: buffer.toString('base64'), filename };
}

function seccionActa_(doc, titulo, filas, campoExtra) {
  PdfDoc.seccion(doc, titulo);
  if (!filas.length) {
    doc.font('Helvetica').fontSize(9).fillColor(PdfDoc.DOC.MUTED).text('Nada que reportar.', PdfDoc.MARGIN, doc.y);
    doc.moveDown(0.6);
    return;
  }
  const items = filas.map((f) => {
    let linea = f.titulo + ' — ' + f.responsable + ' (' + f.area + ')';
    if (campoExtra && f[campoExtra]) linea += ' · ' + f[campoExtra];
    if (f.fecha_compromiso) linea += ' · vence ' + PdfDoc.fechaCorta_(f.fecha_compromiso);
    return { texto: linea };
  });
  PdfDoc.asegurarEspacio(doc, 14);
  items.forEach((it) => {
    doc.font('Helvetica').fontSize(9).fillColor(PdfDoc.DOC.INK);
    const altura = doc.heightOfString('•  ' + it.texto, { width: PdfDoc.CONTENT_WIDTH - 10 }) + 4;
    PdfDoc.asegurarEspacio(doc, altura);
    doc.text('•  ' + it.texto, PdfDoc.MARGIN, doc.y, { width: PdfDoc.CONTENT_WIDTH - 10 });
    doc.moveDown(0.15);
  });
  doc.x = PdfDoc.MARGIN;
  doc.moveDown(0.4);
}

async function descargarActa(db, data, contexto) {
  const acta = Actividades.generarActaReunion(db, data || {}, contexto);

  const doc = PdfDoc.crearDocumento();
  PdfDoc.encabezado(doc, { tipoDoc: 'Acta de reunión de seguimiento', referencia: '', etiquetaReferencia: '' });
  seccionActa_(doc, '1. Venció', acta.vencidas);
  seccionActa_(doc, '2. Bloqueado', acta.bloqueadas, 'motivo');
  seccionActa_(doc, '3. Se reprogramó esta semana', acta.reprogramadas_semana, 'motivo');
  seccionActa_(doc, '4. Vence la semana entrante', acta.vence_semana_entrante);
  PdfDoc.pie(doc);
  const buffer = await PdfDoc.finalizar(doc);

  const filename = 'SIGSO-acta-reunion-' + Utils.claveDia_(new Date(), 'America/Santiago') + '.pdf';
  return { pdf_base64: buffer.toString('base64'), filename };
}

module.exports = { descargarReporte, descargarActa };
