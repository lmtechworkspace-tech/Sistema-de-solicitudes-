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
const DocV2 = require('./documentoV2');

const ETIQUETA_ESTADO = { COMPLETO: 'Completo', PARCIAL: 'Parcial', FALTANTE: 'Faltante', NO_APLICA: 'No aplica' };

// --- Versión v2 (R-3b de la auditoría de reportes) ----------------------------------------
// Evidencia para el auditor en la anatomía de 4 niveles, con las piezas de la pantalla:
// estado y qué hay (En una línea) · qué falta para cerrarla · evidencia por tipo · registros.
function cuerpoEvidenciaV2_(d, nombres, R, U, fecha) {
  // Por tipo y descripción: la fecha significa cosas distintas según el tipo de
  // evidencia (emisión, próxima revisión…), así que no sirve para ordenar.
  const ev = (d.evidencia || []).slice().sort((a, b) => String(a.tipo || '').localeCompare(String(b.tipo || ''), 'es') ||
    String(a.descripcion || '').localeCompare(String(b.descripcion || ''), 'es', { numeric: true }));
  const porTipo = {};
  ev.forEach((e) => { porTipo[e.tipo || 'Otro'] = (porTipo[e.tipo || 'Otro'] || 0) + 1; });
  const tipos = Object.keys(porTipo).sort((a, b) => porTipo[b] - porTipo[a]);
  const persona = (r) => (r && nombres[String(r).toLowerCase()]) || r || '—';

  const linea = R.enUnaLinea({
    estado: d.estado === 'COMPLETO' ? 'ok' : (d.estado === 'FALTANTE' ? 'critico' : (d.estado === 'NO_APLICA' ? 'neutro' : 'alerta')),
    frase: (ETIQUETA_ESTADO[d.estado] || d.estado) + '. ' + (d.resumen || (ev.length ? '' : 'Sin evidencia registrada en el sistema.')),
    kpis: [
      { etiqueta: 'Registros de evidencia', valor: ev.length, icono: 'documento', tono: ev.length ? 'primario' : 'critico' },
      { etiqueta: 'Tipos de evidencia', valor: tipos.length, icono: 'capas', tono: 'info', nota: tipos.slice(0, 2).join(' · ') || 'ninguno' },
      { etiqueta: 'Exclusiones', valor: (d.exclusiones || []).length, icono: 'escudo', tono: 'neutro', nota: (d.exclusiones || []).length ? 'declaradas en el alcance' : 'ninguna declarada' }
    ]
  });
  const falta = d.nota
    ? R.requiereDecision([{ severidad: d.estado === 'FALTANTE' ? 'critico' : 'alerta', titulo: 'Para cerrar la cláusula ' + d.codigo, detalle: d.nota }])
    : R.requiereDecision([], { vacio: d.estado === 'COMPLETO' ? 'La cláusula tiene la evidencia que el sistema espera.' : '' });
  const panorama = tipos.length
    ? R.ranking(tipos.map((t) => ({ etiqueta: t, valor: porTipo[t], texto: String(porTipo[t]) })), { max: ev.length, sinPosicion: true })
    : '';
  const detalle = '<div class="rp2-detalle">' + R.tabla([
    { campo: 'descripcion', titulo: 'Registro', html: true }, { campo: 'fecha', titulo: 'Fecha' }, { campo: 'responsable', titulo: 'Responsable' }
  ], ev.map((e) => ({
    descripcion: '<span class="rp2-item"><strong>' + U.esc(e.descripcion || '—') + '</strong><small>' + U.esc(e.tipo || '') + '</small></span>',
    fecha: e.fecha ? fecha(e.fecha, true) : '—', responsable: persona(e.responsable)
  })), { vacio: 'Sin registros de evidencia para esta cláusula.' }) + '</div>';

  return R.nivel('En una línea', linea) +
    R.nivel('Lo que falta', falta) +
    (panorama ? R.nivel('Evidencia por tipo', panorama) : '') +
    R.nivel('Registros', detalle, { nota: ev.length + (ev.length === 1 ? ' registro' : ' registros') + ' · por tipo' });
}

async function descargarEvidencia(db, data, contexto) {
  const detalle = MatrizCobertura.getDetalle(db, data, contexto);
  if (detalle && (detalle._validationError || detalle._forbidden)) return detalle;
  if (DocV2.disponible()) {
    try {
      const { R, U } = DocV2.piezas();
      return await DocV2.aPdf(db, contexto, {
        titulo: 'Evidencia · cláusula ' + detalle.codigo, subtitulo: detalle.titulo,
        modulo: 'Calidad — ' + (detalle.norma && detalle.norma.codigo ? detalle.norma.codigo + (detalle.norma.version ? ':' + detalle.norma.version : '') : 'ISO 9001:2015'), codigo: 'SIGSO-EVID-' + detalle.codigo,
        cuerpo: cuerpoEvidenciaV2_(detalle, DocV2.nombresPorCorreo(db), R, U, DocV2.fecha_),
        nombreArchivo: 'sigso-evidencia-' + detalle.codigo
      });
    } catch (e) {
      console.error('[evidencia] sin diseño v2, se usa pdfkit:', e && e.message);
    }
  }

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

module.exports = { descargarEvidencia, cuerpoEvidenciaV2_ };
