/**
 * OrdenTrabajo.gs — v5.2 (mejora de la propuesta de adopcion): genera la
 * "Orden de Trabajo" (OT) de una solicitud como PDF, del lado del servidor.
 *
 * Por que en el servidor y no con el print del navegador (como era antes):
 *   1. Las capturas se guardan en Drive con su URL de *vista*
 *      (archivoDrive.getUrl() -> .../view), que NO se puede renderizar como
 *      <img>. La unica forma confiable de que la imagen quede DENTRO del PDF
 *      es leer sus bytes de Drive (DriveApp.getFileById) y embeberlos en
 *      base64 -- eso solo lo puede hacer el servidor, que corre como dueno de
 *      los archivos.
 *   2. Un PDF generado en el servidor se puede ADJUNTAR al correo de
 *      derivacion (Notificaciones.notificarDerivacion), cosa imposible con un
 *      print del navegador.
 *
 * Conversion: Utilities.newBlob(html, 'text/html').getAs('application/pdf')
 * -- mismo motor que ya usa Documentos.gs para el documento formal. El HTML
 * es autocontenido (estilos inline, una columna, tablas simples): el
 * conversor HTML->PDF de Apps Script no soporta CSS complejo, asi que NO se
 * reusa el CSS de la app.
 *
 * Reusa Solicitudes.getDetalle (solicitud + subsolicitudes + archivos ya
 * vienen ahi); no toca ninguna hoja.
 */

// Tope de imagenes embebidas en una OT: acota el tamano del PDF (capturas de
// hasta 5 MB c/u) para no inflar el adjunto ni chocar con el limite de 25 MB
// de Gmail. Las que sobran se mencionan pero no se embeben.
var MAX_IMAGENES_OT = 6;

var COLOR_MARCA_OT = '#6D5DF6';

var OrdenTrabajo = {
  /**
   * generar(solicitudId, contexto) -> Blob PDF de la OT. Lo usa el correo de
   * derivacion (para adjuntar) y descargar() (para bajarlo).
   */
  generar: function (solicitudId, contexto) {
    var detalle = Solicitudes.getDetalle(solicitudId, contexto || { rol: 'ADM', email: '' });
    if (detalle && (detalle._validationError || detalle._forbidden)) {
      throw new Error('No se pudo generar la OT: ' + (detalle.message || solicitudId));
    }
    var html = construirHtmlOt_(detalle);
    var pdf = Utilities.newBlob(html, 'text/html', 'OT-' + solicitudId + '.html').getAs('application/pdf');
    pdf.setName('OT-' + solicitudId + '.pdf');
    return pdf;
  },

  /**
   * descargar({ solicitud_id }, contexto) -> { pdf_base64, filename }.
   * Accion de router (Code.gs) para el boton "Orden de trabajo (PDF)" del
   * detalle: el frontend decodifica el base64 a un Blob y lo descarga.
   */
  descargar: function (data, contexto) {
    if (!data || !data.solicitud_id) {
      return errorValidacion_('solicitud_id', 'Falta indicar el numero de solicitud.');
    }
    var pdf = OrdenTrabajo.generar(data.solicitud_id, contexto);
    return {
      pdf_base64: Utilities.base64Encode(pdf.getBytes()),
      filename: pdf.getName()
    };
  }
};

// --- construccion del HTML -------------------------------------------------

function construirHtmlOt_(detalle) {
  var s = detalle.solicitud;
  var subsolicitudes = detalle.subsolicitudes || [];
  var archivos = detalle.archivos || [];
  var contadorImagenes = { usadas: 0 };

  var itemsHtml = subsolicitudes.map(function (sub) {
    return bloqueItemOt_(sub, archivos, contadorImagenes);
  }).join('') || '<p style="color:#5B6474;">Sin items.</p>';

  var generada = 'Generada el ' + formatearFechaLegible_(new Date());

  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
    '<body style="margin:0;font-family:Arial,Helvetica,sans-serif;color:#0F172A;font-size:14px;line-height:1.45;">' +
    // Barra de marca
    '<table width="100%" style="border-collapse:collapse;"><tr>' +
    '<td style="background:' + COLOR_MARCA_OT + ';padding:14px 22px;">' +
    '<span style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:0.3px;">SIGSO</span>' +
    '<span style="color:#E7E4FF;font-size:15px;margin-left:10px;">Orden de trabajo</span>' +
    '</td></tr></table>' +
    '<div style="padding:20px 22px;">' +
    '<h1 style="font-size:26px;margin:0 0 4px;letter-spacing:-0.5px;">' + escaparHtml_(s.solicitud_id) + '</h1>' +
    '<p style="margin:0 0 2px;color:#5B6474;">' + escaparHtml_(s.empresa_nombre || s.empresa_id) +
    ' &middot; Solicitante: ' + escaparHtml_(s.solicitante_nombre || '') +
    (s.solicitante_email ? ' (' + escaparHtml_(s.solicitante_email) + ')' : '') + '</p>' +
    (s.es_cliente && s.empresa_cliente
      ? '<p style="margin:0 0 2px;color:#5B6474;">Cliente: ' + escaparHtml_(s.empresa_cliente) +
        (s.contacto_cliente ? ' &middot; ' + escaparHtml_(s.contacto_cliente) : '') + '</p>'
      : '') +
    '<p style="margin:0 0 16px;font-size:12px;color:#8A93A5;">' + escaparHtml_(generada) + '</p>' +
    itemsHtml +
    // Pie: como cerrarla
    '<div style="background:#F1F4F9;border-left:4px solid ' + COLOR_MARCA_OT + ';padding:12px 16px;margin-top:18px;font-size:13px;">' +
    '&#9989; <strong>Para cerrar:</strong> responde <strong>"LISTO ' + escaparHtml_(s.solicitud_id) +
    '"</strong> por este mismo WhatsApp, o marca el item como Terminada en el sistema si ya tienes acceso.' +
    '</div>' +
    '</div></body></html>';
}

function bloqueItemOt_(sub, archivos, contador) {
  var fecha = sub.fecha_comprometida
    ? '&#128197; <strong>Comprometida:</strong> ' + escaparHtml_(fechaCortaOt_(sub.fecha_comprometida))
    : '&#128197; <span style="color:#8A93A5;">Sin fecha comprometida</span>';

  // "Donde ejecutar": URLs como enlaces reales, mas usuario/credencial.
  var filasContexto = [];
  if (sub.url_modulo) {
    filasContexto.push(filaContextoOt_('URL principal', enlaceOt_(sub.url_modulo)));
  }
  parsearUrlsAdicionales_(sub.urls_adicionales).forEach(function (u) {
    if (u.url) filasContexto.push(filaContextoOt_(u.titulo || 'URL adicional', enlaceOt_(u.url)));
  });
  if (sub.usuario_prueba) filasContexto.push(filaContextoOt_('Usuario de prueba', escaparHtml_(sub.usuario_prueba)));
  if (sub.ref_credencial) filasContexto.push(filaContextoOt_('Credencial', escaparHtml_(sub.ref_credencial)));
  var contextoHtml = filasContexto.length
    ? '<p style="margin:10px 0 4px;font-weight:bold;font-size:13px;color:#5B6474;">&#128269; Donde ejecutar</p>' +
      '<table style="border-collapse:collapse;font-size:13px;">' + filasContexto.join('') + '</table>'
    : '';

  var imagenesHtml = imagenesItemOt_(archivos, sub.subsolicitud_id, contador);

  return '<div style="border:1px solid #E5E8EF;border-radius:8px;padding:14px 16px;margin-bottom:14px;">' +
    '<h2 style="font-size:17px;margin:0 0 6px;">' + escaparHtml_(sub.numero_item + '. ' + (sub.titulo || '')) + '</h2>' +
    '<p style="margin:0 0 8px;">' + badgePrioridadOt_(sub.prioridad) + ' &nbsp; ' + fecha + '</p>' +
    (sub.descripcion ? '<p style="margin:0 0 8px;">' + escaparHtml_(sub.descripcion) + '</p>' : '') +
    (sub.resultado_esperado
      ? '<p style="margin:0 0 8px;"><strong>Resultado esperado:</strong> ' + escaparHtml_(sub.resultado_esperado) + '</p>'
      : '') +
    contextoHtml +
    imagenesHtml +
    '</div>';
}

function filaContextoOt_(etiqueta, valorHtml) {
  return '<tr>' +
    '<td style="padding:2px 12px 2px 0;color:#8A93A5;vertical-align:top;white-space:nowrap;">' + escaparHtml_(etiqueta) + '</td>' +
    '<td style="padding:2px 0;word-break:break-all;">' + valorHtml + '</td>' +
    '</tr>';
}

function enlaceOt_(url) {
  var limpia = escaparHtml_(url);
  return '<a href="' + limpia + '" style="color:' + COLOR_MARCA_OT + ';text-decoration:underline;">' + limpia + '</a>';
}

function badgePrioridadOt_(prioridad) {
  var colores = {
    P1: '#C0392B', P2: '#E67E22', P3: '#B7950B', P4: '#7F8C8D', P5: '#95A5A6'
  };
  var fondo = colores[prioridad] || '#7F8C8D';
  return '<span style="background:' + fondo + ';color:#ffffff;padding:2px 9px;border-radius:10px;font-size:12px;font-weight:bold;">' +
    escaparHtml_(prioridad || '—') + '</span>';
}

// Embebe hasta MAX_IMAGENES_OT capturas (base64), leyendo los bytes de Drive.
// Si una imagen falla (id no valido, permiso, borrada) se salta sin romper la
// OT -- una captura menos es mejor que una OT que no se genera.
function imagenesItemOt_(archivos, subsolicitudId, contador) {
  var imagenes = (archivos || []).filter(function (a) {
    return a.subsolicitud_id === subsolicitudId && String(a.tipo_mime || '').indexOf('image/') === 0;
  });
  if (imagenes.length === 0) return '';

  var tags = [];
  var omitidas = 0;
  imagenes.forEach(function (archivo) {
    if (contador.usadas >= MAX_IMAGENES_OT) { omitidas++; return; }
    var tag = imgEmbebidaOt_(archivo);
    if (tag) { tags.push(tag); contador.usadas++; }
  });
  if (tags.length === 0 && omitidas === 0) return '';

  return '<div style="margin-top:10px;">' +
    '<p style="margin:0 0 4px;font-weight:bold;font-size:13px;color:#5B6474;">&#128247; Capturas</p>' +
    tags.join('') +
    (omitidas > 0
      ? '<p style="margin:4px 0 0;font-size:12px;color:#8A93A5;">(+' + omitidas + ' captura(s) mas en el sistema)</p>'
      : '') +
    '</div>';
}

function imgEmbebidaOt_(archivo) {
  try {
    var id = extraerIdDrive_(archivo.url);
    if (!id) return '';
    var blob = DriveApp.getFileById(id).getBlob();
    var bytes = blob.getBytes();
    if (!bytes || !bytes.length) return '';
    var mime = archivo.tipo_mime || blob.getContentType() || 'image/png';
    var b64 = Utilities.base64Encode(bytes);
    return '<img src="data:' + mime + ';base64,' + b64 +
      '" style="max-width:100%;height:auto;border:1px solid #E5E8EF;border-radius:6px;margin:6px 0;display:block;">';
  } catch (err) {
    return '';
  }
}

// El file ID de Drive va en la URL guardada. Cubre el formato real
// (https://drive.google.com/file/d/<ID>/view) y, como respaldo, el ultimo
// segmento (mock/otras variantes).
function extraerIdDrive_(url) {
  var texto = String(url || '');
  var m = texto.match(/\/d\/([^/?#]+)/);
  if (m) return m[1];
  var partes = texto.split(/[/?#]/).filter(function (p) { return p; });
  return partes.length ? partes[partes.length - 1] : '';
}

function parsearUrlsAdicionales_(valor) {
  if (!valor) return [];
  try {
    var lista = JSON.parse(valor);
    return Array.isArray(lista) ? lista : [];
  } catch (err) {
    return [];
  }
}

function fechaCortaOt_(valor) {
  return String(valor).replace('T', ' ').slice(0, 16);
}

function formatearFechaLegible_(fecha) {
  // dd-mm-aaaa hh:mm en horario de Chile, sin depender de toLocaleString
  // (Apps Script lo formatea distinto segun locale del servidor).
  try {
    return Utilities.formatDate(fecha, 'America/Santiago', 'dd-MM-yyyy HH:mm');
  } catch (err) {
    return fecha.toISOString().replace('T', ' ').slice(0, 16);
  }
}

// Escape HTML propio del Backoffice (Componentes.escaparHtml vive solo en el
// frontend). Cubre los 5 caracteres que rompen el HTML/atributos.
function escaparHtml_(valor) {
  return String(valor === undefined || valor === null ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
