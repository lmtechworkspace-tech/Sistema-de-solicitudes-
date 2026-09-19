'use strict';

/**
 * evidenciaClausulaSgc.js — puerto de la parte PDF de
 * backend/backoffice/MatrizCobertura.gs (descargarEvidencia): el PDF de
 * evidencia de auditoría de una cláusula ISO, para el botón de "modo
 * auditoría" de la matriz de cobertura. La lógica de datos (qué evidencia
 * cuenta, cómo se evalúa cada cláusula) ya vive portada en
 * matrizCoberturaSgc.js (getDetalle) -- este módulo solo la dibuja.
 *
 * El más simple de los PDF del motor (§8.3): sin el "chrome" de fichas ni
 * items, solo título + estado + tabla de evidencia.
 */

const MatrizCobertura = require('./matrizCoberturaSgc');
const PdfDoc = require('./pdfDocumento');

const ETIQUETA_ESTADO = { COMPLETO: 'Completo', PARCIAL: 'Parcial', FALTANTE: 'Faltante', NO_APLICA: 'No aplica' };

async function descargarEvidencia(db, data, contexto) {
  const detalle = MatrizCobertura.getDetalle(db, data, contexto);
  if (detalle && (detalle._validationError || detalle._forbidden)) return detalle;

  const doc = PdfDoc.crearDocumento();
  PdfDoc.encabezado(doc, { tipoDoc: 'Evidencia de auditoría', referencia: detalle.codigo });

  doc.font('Helvetica-Bold').fontSize(13).fillColor(PdfDoc.DOC.INK)
    .text('Cláusula ' + detalle.codigo + ' — ' + detalle.titulo, PdfDoc.MARGIN, doc.y, { width: PdfDoc.CONTENT_WIDTH });
  doc.moveDown(0.4);

  doc.font('Helvetica-Bold').fontSize(9).fillColor(PdfDoc.DOC.MUTED).text('Estado: ', PdfDoc.MARGIN, doc.y, { continued: true })
    .font('Helvetica-Bold').fillColor(PdfDoc.DOC.INK).text(ETIQUETA_ESTADO[detalle.estado] || detalle.estado);
  doc.moveDown(0.3);

  if (detalle.resumen) {
    doc.font('Helvetica').fontSize(9).fillColor(PdfDoc.DOC.INK_SOFT).text(detalle.resumen, PdfDoc.MARGIN, doc.y, { width: PdfDoc.CONTENT_WIDTH });
    doc.moveDown(0.4);
  }
  if (detalle.nota) {
    doc.font('Helvetica').fontSize(8.5).fillColor('#92400E').text(detalle.nota, PdfDoc.MARGIN, doc.y, { width: PdfDoc.CONTENT_WIDTH });
    doc.moveDown(0.5);
  }

  PdfDoc.seccion(doc, 'Registros de evidencia');
  if (!detalle.evidencia || detalle.evidencia.length === 0) {
    doc.font('Helvetica').fontSize(9).fillColor(PdfDoc.DOC.MUTED).text('Sin registros de evidencia para esta cláusula.', PdfDoc.MARGIN, doc.y);
    doc.moveDown(0.5);
  } else {
    PdfDoc.tablaGenerica(
      doc,
      [{ campo: 'tipo', etiqueta: 'Tipo' }, { campo: 'descripcion', etiqueta: 'Descripción' },
        { campo: 'fecha', etiqueta: 'Fecha' }, { campo: 'responsable', etiqueta: 'Responsable' }],
      detalle.evidencia.map((e) => ({
        tipo: e.tipo, descripcion: e.descripcion || '', fecha: e.fecha ? String(e.fecha).slice(0, 10) : '—', responsable: e.responsable || '—'
      }))
    );
  }

  PdfDoc.pie(doc);
  const buffer = await PdfDoc.finalizar(doc);
  return { pdf_base64: buffer.toString('base64'), filename: 'SIGSO-Evidencia-' + detalle.codigo + '.pdf' };
}

module.exports = { descargarEvidencia };
