'use strict';

/**
 * pdfDocumento.js — motor de PDF compartido (§8.3 del handoff de
 * migración). Puerto a `pdfkit` del "chrome" que en Apps Script vivía en
 * OrdenTrabajo.gs (DOC, docChromeOt_, docSeccionOt_, fichaSolicitudOt_,
 * tablaDatosOt_, chipPrioridadOt_...) y que reusaban ReporteActividades.gs
 * y el reporte de Pausas vía `Utilities.newBlob(html,...).getAs('application/pdf')`.
 * Node no tiene ese conversor HTML->PDF nativo, así que este módulo dibuja
 * con las primitivas de pdfkit (texto/rect/línea) en vez de interpretar
 * HTML/CSS.
 *
 * Diferencia deliberada de fidelidad: se replica el CONTENIDO y la
 * estructura (encabezado, fichas, secciones, tablas, chips, pie
 * institucional) — no cada detalle visual pixel a pixel del HTML original.
 * Es una decisión de diseño, no una regla de negocio: lo que ISO/el
 * usuario necesitan es el dato correcto en el documento, no el mismo CSS.
 *
 * Elegido sobre Puppeteer (headless Chrome) por el mismo criterio de
 * dependencias mínimas ya establecido en el resto de la migración
 * (aws4fetch en vez del SDK de AWS, scrypt en vez de bcrypt): pdfkit es
 * generación pura en JS, sin navegador, liviana para el VPS de 2 vCPU/4GB
 * (smoke test: ~80ms / ~4KB para un documento de 2 páginas).
 */

const PDFDocument = require('pdfkit');

const DOC = {
  INK: '#1F2937',
  INK_SOFT: '#374151',
  MUTED: '#6B7280',
  FAINT: '#9AA1AC',
  HAIRLINE: '#E5E7EB',
  PANEL: '#F8FAFC',
  NAVY: '#14213D',
  WHITE: '#FFFFFF'
};

const MARGIN = 40;
const PAGE_WIDTH = 595.28; // A4 en puntos
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

// Colores de prioridad, mismos codigos que chipPrioridadOt_ (OrdenTrabajo.gs).
const COLOR_PRIORIDAD = { P1: '#B4232A', P2: '#B26A00', P3: '#8A6D00', P4: '#556070', P5: '#6B7280' };

// dd-mm-aaaa hh:mm en horario de Chile -- mismo formato que
// formatearFechaLegible_ (OrdenTrabajo.gs).
function formatearFechaLegible_(fecha) {
  try {
    const partes = new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(fecha);
    const val = (tipo) => (partes.find((p) => p.type === tipo) || {}).value || '';
    return val('day') + '-' + val('month') + '-' + val('year') + ' ' + val('hour') + ':' + val('minute');
  } catch (err) {
    return fecha.toISOString().replace('T', ' ').slice(0, 16);
  }
}

function fechaCorta_(valor) {
  return String(valor == null ? '' : valor).replace('T', ' ').slice(0, 16);
}

function crearDocumento() {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true, autoFirstPage: true });
  doc.font('Helvetica');
  return doc;
}

function finalizar(doc) {
  return new Promise((resolve) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.end();
  });
}

// Agrega una pagina nueva si lo que sigue no entra en la actual -- pdfkit no
// pagina solo cuando se dibuja con rect/line en coordenadas manuales (solo
// lo hace para texto fluido sin x/y explicito).
function asegurarEspacio(doc, altura) {
  const limite = doc.page.height - doc.page.margins.bottom;
  if (doc.y + altura > limite) {
    doc.addPage();
    doc.x = MARGIN;
  }
}

// Encabezado (sello + wordmark + metadatos a la derecha) + doble regla.
// Se dibuja UNA sola vez, al principio del documento -- igual que
// docChromeOt_, que no se repite por pagina (el conversor HTML->PDF de Apps
// Script tampoco lo hacia, no soporta position:fixed).
function encabezado(doc, meta) {
  const top = MARGIN;
  const etiquetaReferencia = meta.etiquetaReferencia === undefined ? 'N.º ' : meta.etiquetaReferencia;

  doc.rect(MARGIN, top, 26, 26).fill(DOC.NAVY);
  doc.fillColor(DOC.WHITE).font('Helvetica-Bold').fontSize(13)
    .text('S', MARGIN, top + 7, { width: 26, align: 'center' });
  doc.fillColor(DOC.INK).font('Helvetica-Bold').fontSize(15).text('SIGSO', MARGIN + 34, top);
  doc.fillColor(DOC.MUTED).font('Helvetica').fontSize(8)
    .text('Sistema de Gestión de Solicitudes', MARGIN + 34, top + 16);

  doc.fillColor(DOC.NAVY).font('Helvetica-Bold').fontSize(9)
    .text(String(meta.tipoDoc || '').toUpperCase(), MARGIN, top, { width: CONTENT_WIDTH, align: 'right', characterSpacing: 0.8 });
  doc.fillColor(DOC.INK).font('Helvetica-Bold').fontSize(11)
    .text(etiquetaReferencia + (meta.referencia || ''), MARGIN, top + 13, { width: CONTENT_WIDTH, align: 'right' });
  doc.fillColor(DOC.MUTED).font('Helvetica').fontSize(8)
    .text('Emitida: ' + formatearFechaLegible_(new Date()), MARGIN, top + 27, { width: CONTENT_WIDTH, align: 'right' });

  const reglaY = top + 42;
  doc.moveTo(MARGIN, reglaY).lineTo(PAGE_WIDTH - MARGIN, reglaY).lineWidth(2).strokeColor(DOC.NAVY).stroke();
  doc.moveTo(MARGIN, reglaY + 3).lineTo(PAGE_WIDTH - MARGIN, reglaY + 3).lineWidth(1).strokeColor(DOC.HAIRLINE).stroke();

  doc.y = reglaY + 16;
  doc.x = MARGIN;
}

// Pie institucional (confidencialidad) -- se agrega una vez, al final del
// contenido, en la posicion donde quede (igual que el div de cierre del
// HTML original, que el navegador empujaba a donde alcanzara).
function pie(doc) {
  asegurarEspacio(doc, 40);
  const y = doc.y + 10;
  doc.moveTo(MARGIN, y).lineTo(PAGE_WIDTH - MARGIN, y).lineWidth(1).strokeColor(DOC.HAIRLINE).stroke();
  doc.fillColor(DOC.FAINT).font('Helvetica').fontSize(7.5)
    .text('SIGSO · Sistema de Gestión de Solicitudes · Documento generado automáticamente el ' +
      formatearFechaLegible_(new Date()) + '.', MARGIN, y + 8, { width: CONTENT_WIDTH });
  doc.fillColor(DOC.MUTED).font('Helvetica-Bold').fontSize(7.5)
    .text('Confidencial — uso interno.', MARGIN, doc.y + 2, { continued: true })
    .font('Helvetica').fillColor(DOC.FAINT)
    .text(' Contiene datos de acceso y de la operación; no lo redistribuyas fuera del equipo autorizado.', { width: CONTENT_WIDTH });
}

// Etiqueta de seccion en versalitas con una barra de acento -- docSeccionOt_.
function seccion(doc, texto) {
  asegurarEspacio(doc, 22);
  const y = doc.y;
  doc.rect(MARGIN, y + 1, 3, 11).fill(DOC.NAVY);
  doc.fillColor(DOC.NAVY).font('Helvetica-Bold').fontSize(9)
    .text(String(texto).toUpperCase(), MARGIN + 9, y, { characterSpacing: 0.6 });
  doc.y = y + 16;
  doc.x = MARGIN;
}

// Sub-etiqueta dentro de un bloque -- subseccionOt_.
function subseccion(doc, texto) {
  asegurarEspacio(doc, 14);
  doc.fillColor(DOC.MUTED).font('Helvetica-Bold').fontSize(7.5)
    .text(String(texto).toUpperCase(), MARGIN, doc.y, { characterSpacing: 0.5 });
  doc.moveDown(0.15);
  doc.x = MARGIN;
}

// Campo de texto libre con su etiqueta (omite si vacio) -- campoTextoOt_.
function campoTexto(doc, etiqueta, valor) {
  if (!valor) return;
  subseccion(doc, etiqueta);
  const texto = String(valor);
  const altura = doc.font('Helvetica').fontSize(9).heightOfString(texto, { width: CONTENT_WIDTH });
  asegurarEspacio(doc, altura);
  doc.fillColor(DOC.INK_SOFT).font('Helvetica').fontSize(9).text(texto, MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc.moveDown(0.6);
  doc.x = MARGIN;
}

// Ficha resumen: tabla de 4 columnas (label/value/label/value) con
// hairlines y fondo suave en las etiquetas -- fichaSolicitudOt_.
function fichaTabla(doc, filas) {
  const colWidths = [CONTENT_WIDTH * 0.15, CONTENT_WIDTH * 0.35, CONTENT_WIDTH * 0.15, CONTENT_WIDTH * 0.35];
  const colX = [MARGIN, MARGIN + colWidths[0], MARGIN + colWidths[0] + colWidths[1], MARGIN + colWidths[0] + colWidths[1] + colWidths[2]];

  filas.forEach((fila) => {
    const alturas = fila.map((texto, i) => {
      const esLabel = i % 2 === 0;
      doc.font(esLabel ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
      return doc.heightOfString(String(texto == null ? '—' : texto), { width: colWidths[i] - 12 });
    });
    const alturaFila = Math.max.apply(null, alturas.concat([14])) + 8;
    asegurarEspacio(doc, alturaFila);
    const y = doc.y;
    fila.forEach((texto, i) => {
      const esLabel = i % 2 === 0;
      if (esLabel) doc.rect(colX[i], y, colWidths[i], alturaFila).fill(DOC.PANEL);
      doc.rect(colX[i], y, colWidths[i], alturaFila).lineWidth(0.5).strokeColor(DOC.HAIRLINE).stroke();
      doc.fillColor(esLabel ? DOC.MUTED : DOC.INK).font(esLabel ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5)
        .text(String(texto == null ? '—' : texto), colX[i] + 6, y + 4, { width: colWidths[i] - 12 });
    });
    doc.y = y + alturaFila;
  });
  doc.x = MARGIN;
  doc.moveDown(0.5);
}

// Tabla etiqueta/valor sin bordes (accesos, detalles del pedido) --
// tablaDatosOt_. `valor` puede ser texto plano o { texto, link } para que
// salga como enlace clicable real.
function tablaDatos(doc, filas) {
  const labelWidth = 130;
  const valorWidth = CONTENT_WIDTH - labelWidth;
  filas.forEach(([label, valor]) => {
    const esLink = valor && typeof valor === 'object' && valor.link;
    const texto = esLink ? valor.texto : String(valor == null ? '—' : valor);
    doc.font('Helvetica').fontSize(8.5);
    const altura = Math.max(
      doc.heightOfString(label, { width: labelWidth }),
      doc.heightOfString(texto, { width: valorWidth })
    ) + 5;
    asegurarEspacio(doc, altura);
    const y = doc.y;
    doc.fillColor(DOC.MUTED).font('Helvetica').fontSize(8.5).text(label, MARGIN, y, { width: labelWidth });
    if (esLink) {
      doc.fillColor(DOC.NAVY).font('Helvetica').fontSize(8.5)
        .text(texto, MARGIN + labelWidth, y, { width: valorWidth, underline: true, link: valor.link });
    } else {
      doc.fillColor(DOC.INK).font('Helvetica').fontSize(8.5).text(texto, MARGIN + labelWidth, y, { width: valorWidth });
    }
    doc.y = y + altura;
  });
  doc.x = MARGIN;
}

// Lista de enlaces (documentos adjuntos, o imagenes que no se pueden
// embeber -- ver ordenTrabajo.js) -- bloqueDocumentosOt_.
function listaEnlaces(doc, items) {
  const bullet = '•  ';
  items.forEach((item) => {
    doc.font('Helvetica').fontSize(8.5);
    const altura = doc.heightOfString(bullet + item.texto, { width: CONTENT_WIDTH - 10 }) + 3;
    asegurarEspacio(doc, altura);
    const y = doc.y;
    doc.fillColor(DOC.INK).text(bullet, MARGIN, y, { continued: true })
      .fillColor(DOC.NAVY).text(item.texto, { width: CONTENT_WIDTH - 10, underline: true, link: item.link });
    doc.y = y + altura;
  });
  doc.x = MARGIN;
}

// Chip de prioridad: punto de color + codigo, con borde fino (nunca relleno
// solido con texto blanco encima -- la leccion de Proyectos.gs v15.3: el
// conversor HTML->PDF de Apps Script no pintaba fondos, y aca directamente
// evitamos el riesgo dibujando solo borde+texto). Devuelve el ancho usado.
function chipPrioridad(doc, x, y, prioridad) {
  const color = COLOR_PRIORIDAD[prioridad] || '#556070';
  const texto = String(prioridad || '—');
  doc.font('Helvetica-Bold').fontSize(8);
  const anchoTexto = doc.widthOfString(texto);
  const ancho = anchoTexto + 20;
  doc.roundedRect(x, y, ancho, 14, 7).lineWidth(0.75).strokeColor(DOC.HAIRLINE).stroke();
  doc.circle(x + 9, y + 7, 3).fill(color);
  doc.fillColor(DOC.INK).text(texto, x + 15, y + 3, { width: ancho - 15, lineBreak: false });
  return ancho;
}

module.exports = {
  DOC, MARGIN, CONTENT_WIDTH, COLOR_PRIORIDAD,
  crearDocumento, finalizar, asegurarEspacio,
  encabezado, pie, seccion, subseccion, campoTexto, fichaTabla, tablaDatos, listaEnlaces, chipPrioridad,
  formatearFechaLegible_, fechaCorta_
};
