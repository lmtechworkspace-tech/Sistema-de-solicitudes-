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
const DocV2 = require('./documentoV2');

const MAX_IMAGENES_OT = 6;
const CREDENCIAL_OCULTA = 'Registrada en SIGSO (verla en la solicitud)';

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
  // El campo pide una REFERENCIA al gestor de credenciales, pero en la práctica se escriben
  // contraseñas. La OT es un PDF que se descarga y se reenvía: nunca lleva el valor, solo
  // avisa que existe (quien trabaja el ítem lo ve dentro de SIGSO).
  if (sub.ref_credencial) accesos.push(['Credencial', CREDENCIAL_OCULTA]);

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

// --- Versión v2 (R-5 de la auditoría de reportes) -----------------------------------------
// La OT es un documento OPERATIVO, no un reporte: sin niveles ni KPI. Cabecera con la
// marca de SIGSO (nunca la de una empresa) y la ficha; cada ítem como una tarjeta con qué
// pasa, dónde ejecutar y el detalle del pedido; enlaces clicables; cómo cerrarla. Mismas
// piezas visuales que los reportes (documentoV2.js); pdfkit queda de respaldo.
const TONO_PRIORIDAD = { P1: 'critico', P2: 'alerta', P3: 'info', P4: 'neutro', P5: 'neutro' };
const TONO_ESTADO = { S06: 'alerta', S07: 'info', S08: 'ok', S09: 'ok', S10: 'neutro', S11: 'neutro' };

function cuerpoOTV2_(vista, detalle, nombres, U, fecha) {
  const s = detalle.solicitud || {};
  const subs = detalle.subsolicitudes || [];
  const persona = (v) => (v && nombres[String(v).toLowerCase()]) || v;
  const valor = (v) => {
    if (v && typeof v === 'object' && v.link) return '<a href="' + U.esc(v.link) + '">' + U.esc(v.texto || v.link) + '</a>';
    if (fecha && /^\d{4}-\d{2}-\d{2}(T|$)/.test(String(v || ''))) return U.esc(fecha(v, true));
    return U.esc(v);
  };
  const datos = (filas) => '<dl class="ot2-datos">' + filas.map((f) => '<div><dt>' + U.esc(f[0]) + '</dt><dd>' + valor(f[1]) + '</dd></div>').join('') + '</dl>';
  const enlaces = (lista) => '<ul class="ot2-enlaces">' + lista.map((e) => '<li>' + valor({ texto: e.nombre, link: e.link }) + '</li>').join('') + '</ul>';
  const campo = (titulo, texto) => (texto ? '<div class="ot2-campo"><h3>' + U.esc(titulo) + '</h3><p>' + U.esc(texto) + '</p></div>' : '');

  const obs = vista.observacionesGenerales
    ? '<div class="ot2-obs"><strong>Observaciones generales</strong><p>' + U.esc(vista.observacionesGenerales) + '</p></div>' : '';

  const items = vista.items.map((it, i) => {
    const sub = subs[i] || {};
    // Las observaciones son texto largo: van a lo ancho, con los demás campos, no en la grilla.
    const observaciones = (it.detalles.find((d) => d[0] === 'Observaciones') || [])[1];
    const detalles = it.detalles.filter((d) => d[0] !== 'Observaciones').map((d) => (d[0] === 'Responsable asignado' ? [d[0], persona(d[1])] : d));
    const accesos = it.accesos.map((a) => (a[0] === 'Credencial' ? ['Referencia de credencial', a[1]] : a));
    const adjuntos = (it.imagenes || []).concat(it.documentos || []);
    return '<section class="ot2-item">' +
      '<header class="ot2-item__cab"><div><span class="ot2-item__num">Ítem ' + it.indice + ' de ' + it.total + (it.tipo ? ' · ' + U.esc(it.tipo) : '') + '</span>' +
        '<h2>' + U.esc(it.titulo) + '</h2></div>' +
        '<span class="ot2-item__chips">' + (it.prioridad ? U.badge(it.prioridad, TONO_PRIORIDAD[it.prioridad] || 'neutro', true) : '') +
        U.badge(it.estadoLabel, TONO_ESTADO[sub.estado] || 'info', true) + '</span></header>' +
      '<div class="ot2-campos">' + campo('Qué pasa', it.campos.descripcion) + campo('Contexto', it.campos.contexto) +
        campo('Resultado esperado', it.campos.resultadoEsperado) + campo('Observaciones', observaciones) + '</div>' +
      '<div class="ot2-dos">' +
        (accesos.length ? '<div><h3 class="ot2-sub">Dónde ejecutar</h3>' + datos(accesos) + '</div>' : '') +
        (detalles.length ? '<div><h3 class="ot2-sub">Detalles del pedido</h3>' + datos(detalles) + '</div>' : '') +
      '</div>' +
      (adjuntos.length ? '<h3 class="ot2-sub">Adjuntos</h3>' + enlaces(adjuntos) +
        (it.imagenesOmitidas ? '<p class="ot2-nota">+' + it.imagenesOmitidas + ' captura(s) más en SIGSO.</p>' : '') : '') +
    '</section>';
  }).join('') || '<p class="ot2-nota">Sin ítems registrados.</p>';

  const generales = vista.adjuntosGenerales
    ? '<h3 class="ot2-sub">Adjuntos de la solicitud</h3>' + enlaces((vista.adjuntosGenerales.imagenes || []).concat(vista.adjuntosGenerales.documentos || [])) : '';

  const cierre = '<div class="ot2-cierre"><h3>Cómo cerrar esta orden</h3><ol>' +
    '<li>Ejecuta el trabajo descrito en cada ítem.</li>' +
    '<li>Marca cada ítem como <strong>Terminada</strong> en SIGSO, o confirma su cierre por el canal acordado con tu coordinación.</li>' +
    '<li>Adjunta evidencia del resultado (captura o enlace) cuando corresponda, para agilizar la validación.</li></ol></div>';

  return obs + items + generales + cierre;
}

async function pdfV2_(db, contexto, vista, detalle) {
  const { U } = DocV2.piezas();
  const s = detalle.solicitud || {};
  const filtros = [];
  (vista.ficha || []).forEach((f) => { for (let k = 0; k < f.length; k += 2) filtros.push({ etiqueta: f[k], valor: f[k + 1] }); });
  return DocV2.aPdf(db, contexto, {
    titulo: 'Orden de trabajo', subtitulo: s.solicitud_id + (s.plataforma_nombre ? ' · ' + s.plataforma_nombre : ''),
    modulo: 'Solicitudes', codigo: s.solicitud_id, filtros: filtros.filter((f) => f.valor && f.valor !== '—'),
    cuerpo: cuerpoOTV2_(vista, detalle, DocV2.nombresPorCorreo(db), U, DocV2.fecha_), nombreArchivo: 'OT-' + s.solicitud_id, enlaces: true
  });
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
  const detalle = SolicitudesBO.getDetalle(db, data.solicitud_id, contexto || { rol: 'ADM', email: '' });
  if (detalle && (detalle._validationError || detalle._forbidden)) return detalle;
  const vista = armarVista_(detalle);
  if (DocV2.disponible()) {
    try {
      const r = await pdfV2_(db, contexto || {}, vista, detalle);
      // Mismo nombre de siempre: la OT se reconoce por su número.
      return { pdf_base64: r.pdf_base64, filename: 'OT-' + data.solicitud_id + '.pdf' };
    } catch (e) {
      console.error('[orden de trabajo] sin diseño v2, se usa pdfkit:', e && e.message);
    }
  }
  const buffer = await dibujar_(vista);
  return { pdf_base64: buffer.toString('base64'), filename: 'OT-' + data.solicitud_id + '.pdf' };
}

module.exports = { generar, descargar, armarVista_, estadoLabel_, cuerpoOTV2_, CREDENCIAL_OCULTA };
