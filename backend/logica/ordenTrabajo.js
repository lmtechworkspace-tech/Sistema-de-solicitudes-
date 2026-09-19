'use strict';

/**
 * ordenTrabajo.js — puerto de backend/backoffice/OrdenTrabajo.gs (v5.2):
 * genera la "Orden de Trabajo" (OT) de una solicitud como PDF, del lado
 * del servidor. Reusa SolicitudesBO.getDetalle (solicitud + subsolicitudes
 * + archivos ya vienen ahí), igual que el .gs reusaba Solicitudes.getDetalle.
 *
 * DIVERGENCIA DELIBERADA respecto del .gs, documentada (nunca fingida):
 * el .gs embebía las capturas de pantalla como imagen dentro del PDF
 * (DriveApp.getFileById + base64) porque el servidor de Apps Script es
 * dueño de los archivos en Drive. El ecosistema Node NO tiene acceso a
 * Drive (solo tiene credenciales de Cloudflare R2, ver almacenamiento.js)
 * y la carga de adjuntos de Solicitudes todavía no está portada a Node
 * (sigue subiendo a Drive vía Apps Script) — no hay ninguna "clave" R2 que
 * pedir. Por eso, hasta que Solicitudes migre sus adjuntos a R2, las
 * imágenes se tratan exactamente como los documentos: un enlace clicable
 * al archivo, nunca un intento de fetch a una URL arbitraria guardada en
 * la base (evita además un riesgo de SSRF). El día que haya una "clave"
 * real, este es el único lugar que hay que tocar.
 */

const SolicitudesBO = require('./solicitudesBackoffice');
const { errorValidacion } = require('./errores');
const PdfDoc = require('./pdfDocumento');

const MAX_IMAGENES_OT = 6;

const ESTADO_LABEL_OT = {
  S01: 'Nueva', S02: 'Recibida', S03: 'En revisión', S04: 'Aprobada',
  S05: 'En desarrollo', S06: 'Esperando información', S07: 'En pruebas',
  S08: 'Terminada', S09: 'Cerrada', S10: 'Rechazada', S11: 'Cancelada'
};

function estadoLabel_(codigo) {
  return ESTADO_LABEL_OT[codigo] || codigo || '—';
}

function parsearUrlsAdicionales_(valor) {
  if (!valor) return [];
  try {
    const lista = JSON.parse(valor);
    return Array.isArray(lista) ? lista : [];
  } catch (err) {
    return [];
  }
}

function esImagen_(archivo) {
  return String(archivo.tipo_mime || '').indexOf('image/') === 0;
}

/**
 * Arma la "vista" (datos ya en la forma que se dibuja) a partir del
 * detalle de la solicitud. Separado de la función que dibuja el PDF a
 * propósito: es lo que testea el porteo (backend/test/orden-trabajo-porteo.test.js),
 * sin acoplar los tests al contenido binario del PDF.
 */
function armarVista_(detalle) {
  const s = detalle.solicitud;
  const subsolicitudes = detalle.subsolicitudes || [];
  const archivos = detalle.archivos || [];
  const total = subsolicitudes.length;

  const ficha = [
    ['Empresa', s.empresa_nombre || s.empresa_id || '—', 'Plataforma', s.plataforma_nombre || '—'],
    ['Estado', estadoLabel_(s.estado_derivado), 'Prioridad', s.prioridad_derivada || '—'],
    ['Ítems', String(total), 'Ingresada', PdfDoc.fechaCorta_(s.fecha_creacion)],
    ['Solicitante', s.solicitante_nombre + (s.solicitante_cargo ? ' — ' + s.solicitante_cargo : ''), 'Correo', s.solicitante_email || '—']
  ];
  if (s.es_cliente && s.empresa_cliente) {
    ficha.push(['Cliente', s.empresa_cliente, 'Contacto', s.contacto_cliente || '—']);
  }

  const items = subsolicitudes.map((sub, i) => armarItem_(sub, archivos, i + 1, total));

  const generales = archivos.filter((a) => !a.subsolicitud_id);
  const adjuntosGenerales = generales.length === 0 ? null : {
    imagenes: generales.filter(esImagen_).map(archivoAEnlace_),
    documentos: generales.filter((a) => !esImagen_(a)).map(archivoAEnlace_)
  };

  return {
    meta: { tipoDoc: 'Orden de trabajo', referencia: s.solicitud_id, empresa: s.empresa_nombre || s.empresa_id },
    ficha,
    observacionesGenerales: s.observaciones_generales || null,
    items,
    adjuntosGenerales
  };
}

function archivoAEnlace_(archivo) {
  return { nombre: archivo.nombre_original || 'documento', link: archivo.url };
}

function armarItem_(sub, archivos, indice, total) {
  const accesos = [];
  if (sub.url_modulo) accesos.push(['URL principal', { texto: sub.url_modulo, link: sub.url_modulo }]);
  parsearUrlsAdicionales_(sub.urls_adicionales).forEach((u) => {
    if (u.url) accesos.push([u.titulo || 'URL adicional', { texto: u.url, link: u.url }]);
  });
  if (sub.usuario_prueba) accesos.push(['Usuario de prueba', sub.usuario_prueba]);
  if (sub.ref_credencial) accesos.push(['Credencial', sub.ref_credencial]);

  const detalles = [];
  if (sub.modulo_nombre) detalles.push(['Módulo', sub.modulo_nombre]);
  if (sub.area_nombre) detalles.push(['Área', sub.area_nombre]);
  if (sub.frecuencia) detalles.push(['Frecuencia', sub.frecuencia]);
  if (sub.personas_afectadas) detalles.push(['Personas afectadas', sub.personas_afectadas]);
  if (sub.desarrollador_asignado) detalles.push(['Responsable asignado', sub.desarrollador_asignado]);
  detalles.push(['Fecha comprometida', sub.fecha_comprometida ? PdfDoc.fechaCorta_(sub.fecha_comprometida) : 'Sin definir']);
  if (sub.observaciones) detalles.push(['Observaciones', sub.observaciones]);

  const archivosItem = (archivos || []).filter((a) => a.subsolicitud_id === sub.subsolicitud_id);
  const imagenes = archivosItem.filter(esImagen_);
  const documentos = archivosItem.filter((a) => !esImagen_(a));

  return {
    indice, total,
    tipo: sub.tipo_nombre || sub.tipo || '',
    titulo: sub.titulo || 'Sin título',
    prioridad: sub.prioridad,
    estadoLabel: estadoLabel_(sub.estado),
    campos: {
      descripcion: sub.descripcion || '',
      contexto: sub.contexto || '',
      resultadoEsperado: sub.resultado_esperado || ''
    },
    accesos,
    detalles,
    // v5.2 Node: nunca embebidas (ver cabecera del archivo) -- se listan
    // como enlace igual que un documento, con nota de cuántas hay.
    imagenes: imagenes.map(archivoAEnlace_),
    imagenesOmitidas: Math.max(0, imagenes.length - MAX_IMAGENES_OT),
    documentos: documentos.map(archivoAEnlace_)
  };
}

async function dibujar_(vista) {
  const doc = PdfDoc.crearDocumento();
  PdfDoc.encabezado(doc, vista.meta);

  PdfDoc.seccion(doc, 'Ficha de la solicitud');
  PdfDoc.fichaTabla(doc, vista.ficha);

  if (vista.observacionesGenerales) {
    PdfDoc.seccion(doc, 'Observaciones generales');
    PdfDoc.campoTexto(doc, 'Observaciones', vista.observacionesGenerales);
  }

  PdfDoc.seccion(doc, 'Detalle de los ítems');
  if (vista.items.length === 0) {
    doc.fillColor(PdfDoc.DOC.MUTED).font('Helvetica').fontSize(9).text('Sin ítems registrados.', PdfDoc.MARGIN, doc.y);
    doc.moveDown(0.5);
  } else {
    vista.items.forEach((item) => dibujarItem_(doc, item));
  }

  if (vista.adjuntosGenerales) {
    PdfDoc.seccion(doc, 'Adjuntos de la solicitud');
    dibujarAdjuntos_(doc, vista.adjuntosGenerales);
  }

  PdfDoc.seccion(doc, 'Cómo cerrar esta orden');
  PdfDoc.asegurarEspacio(doc, 50);
  const y0 = doc.y;
  doc.rect(PdfDoc.MARGIN, y0, PdfDoc.CONTENT_WIDTH, 48).fill(PdfDoc.DOC.PANEL);
  doc.rect(PdfDoc.MARGIN, y0, PdfDoc.CONTENT_WIDTH, 48).lineWidth(0.5).strokeColor(PdfDoc.DOC.HAIRLINE).stroke();
  doc.fillColor(PdfDoc.DOC.INK_SOFT).font('Helvetica').fontSize(8.5).text(
    '1. Ejecuta el trabajo descrito en los ítems anteriores.\n' +
    '2. Marca cada ítem como Terminada en SIGSO, o confirma su cierre por el canal acordado con tu coordinación.\n' +
    '3. Adjunta evidencia del resultado (captura o enlace) cuando corresponda, para agilizar la validación.',
    PdfDoc.MARGIN + 8, y0 + 6, { width: PdfDoc.CONTENT_WIDTH - 16 }
  );
  doc.y = y0 + 52;

  PdfDoc.pie(doc);

  const buffer = await PdfDoc.finalizar(doc);
  return buffer;
}

function dibujarItem_(doc, item) {
  PdfDoc.asegurarEspacio(doc, 40);
  const yInicio = doc.y;
  doc.fillColor(PdfDoc.DOC.MUTED).font('Helvetica').fontSize(7.5)
    .text('ÍTEM ' + item.indice + ' DE ' + item.total + (item.tipo ? ' · ' + item.tipo.toUpperCase() : ''), PdfDoc.MARGIN, yInicio);
  doc.fillColor(PdfDoc.DOC.INK).font('Helvetica-Bold').fontSize(12).text(item.titulo, PdfDoc.MARGIN, doc.y + 1, { width: PdfDoc.CONTENT_WIDTH - 80 });
  PdfDoc.chipPrioridad(doc, PdfDoc.MARGIN + PdfDoc.CONTENT_WIDTH - 60, yInicio, item.prioridad);
  doc.fillColor(PdfDoc.DOC.MUTED).font('Helvetica').fontSize(7.5).text(item.estadoLabel, PdfDoc.MARGIN + PdfDoc.CONTENT_WIDTH - 60, yInicio + 16, { width: 60, align: 'right' });
  doc.moveDown(0.6);
  doc.x = PdfDoc.MARGIN;

  PdfDoc.campoTexto(doc, 'Descripción del problema', item.campos.descripcion);
  PdfDoc.campoTexto(doc, 'Contexto', item.campos.contexto);
  PdfDoc.campoTexto(doc, 'Resultado esperado', item.campos.resultadoEsperado);

  if (item.accesos.length) {
    PdfDoc.subseccion(doc, 'Dónde ejecutar');
    PdfDoc.tablaDatos(doc, item.accesos);
    doc.moveDown(0.4);
  }
  if (item.detalles.length) {
    PdfDoc.subseccion(doc, 'Detalles del pedido');
    PdfDoc.tablaDatos(doc, item.detalles);
    doc.moveDown(0.4);
  }

  if (item.imagenes.length || item.documentos.length) dibujarAdjuntos_(doc, item);

  doc.moveDown(0.6);
}

function dibujarAdjuntos_(doc, bloque) {
  if (bloque.imagenes && bloque.imagenes.length) {
    PdfDoc.subseccion(doc, 'Capturas (ver enlace — no embebidas, ver nota del módulo)');
    PdfDoc.listaEnlaces(doc, bloque.imagenes.map((im) => ({ texto: im.nombre, link: im.link })));
    if (bloque.imagenesOmitidas) {
      doc.fillColor(PdfDoc.DOC.FAINT).font('Helvetica').fontSize(7.5)
        .text('(+' + bloque.imagenesOmitidas + ' captura(s) adicional(es) disponibles en el sistema)', PdfDoc.MARGIN, doc.y);
    }
    doc.moveDown(0.4);
  }
  if (bloque.documentos && bloque.documentos.length) {
    PdfDoc.subseccion(doc, 'Documentos adjuntos');
    PdfDoc.listaEnlaces(doc, bloque.documentos.map((d) => ({ texto: d.nombre, link: d.link })));
  }
  doc.moveDown(0.3);
}

// Detalle -> vista, o el error tal cual lo devolvio SolicitudesBO.getDetalle
// (_validationError / _forbidden) -- comun a generar() y descargar() para no
// duplicar el guardia de acceso (ya vive dentro de getDetalle: JEFATURA solo
// ve su equipo).
function obtenerVista_(db, solicitudId, contexto) {
  const detalle = SolicitudesBO.getDetalle(db, solicitudId, contexto || { rol: 'ADM', email: '' });
  if (detalle && (detalle._validationError || detalle._forbidden)) return detalle;
  return armarVista_(detalle);
}

/**
 * generar(db, solicitudId, contexto) -> Buffer PDF de la OT. Para un futuro
 * llamador que necesite adjuntarla a un correo (derivarSolicitud, igual que
 * en el .gs) -- lanza si la solicitud no es valida, no hay a quien
 * devolverle un _validationError.
 */
async function generar(db, solicitudId, contexto) {
  const vista = obtenerVista_(db, solicitudId, contexto);
  if (vista && (vista._validationError || vista._forbidden)) {
    throw new Error('No se pudo generar la OT: ' + (vista.message || solicitudId));
  }
  return dibujar_(vista);
}

/**
 * descargar({ solicitud_id }, contexto) -> { pdf_base64, filename }.
 */
async function descargar(db, data, contexto) {
  if (!data || !data.solicitud_id) {
    return errorValidacion('solicitud_id', 'Falta indicar el número de solicitud.');
  }
  const vista = obtenerVista_(db, data.solicitud_id, contexto);
  if (vista && (vista._validationError || vista._forbidden)) return vista;
  const buffer = await dibujar_(vista);
  return { pdf_base64: buffer.toString('base64'), filename: 'OT-' + data.solicitud_id + '.pdf' };
}

module.exports = { generar, descargar, armarVista_, estadoLabel_ };
