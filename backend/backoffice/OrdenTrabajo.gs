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

// v7.6 (documentos profesionales): paleta "corporativa sobria" -- tinta
// oscura, grises, hairlines finas y un acento azul marino discreto (no el
// morado saturado de la app). Pensada para que la OT (y el resto de PDF que
// reusen estos tokens) se lea como un documento formal de empresa. El motor
// HTML->PDF de Apps Script no soporta flexbox/grid ni fuentes web, asi que
// todo va con tablas + estilos inline + fuentes seguras (Georgia para
// titulos, Arial para el cuerpo).
var DOC = {
  INK: '#1F2937',       // tinta principal
  INK_SOFT: '#374151',  // texto secundario
  MUTED: '#6B7280',     // etiquetas / metadatos
  FAINT: '#9AA1AC',     // notas al pie de bloque
  HAIRLINE: '#E5E7EB',  // lineas finas / bordes
  PANEL: '#F8FAFC',     // fondo suave de bloques
  NAVY: '#14213D',      // acento formal (reglas, encabezados de bloque)
  SERIF: 'Georgia, "Times New Roman", serif',
  SANS: 'Arial, Helvetica, sans-serif'
};

// Compat: algun caller viejo podria referenciar COLOR_MARCA_OT.
var COLOR_MARCA_OT = DOC.NAVY;

// Codigo de estado -> etiqueta legible (mismo texto que la app).
var ESTADO_LABEL_OT = {
  S01: 'Nueva', S02: 'Recibida', S03: 'En revisión', S04: 'Aprobada',
  S05: 'En desarrollo', S06: 'Esperando información', S07: 'En pruebas',
  S08: 'Terminada', S09: 'Cerrada', S10: 'Rechazada', S11: 'Cancelada'
};

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
  var total = subsolicitudes.length;

  var itemsHtml = subsolicitudes.map(function (sub, i) {
    return bloqueItemOt_(sub, archivos, contadorImagenes, i + 1, total);
  }).join('') || '<p style="color:' + DOC.MUTED + ';margin:0;">Sin ítems registrados.</p>';

  var cuerpo =
    docSeccionOt_('Ficha de la solicitud') +
    fichaSolicitudOt_(s, total) +
    (s.observaciones_generales
      ? docSeccionOt_('Observaciones generales') +
        '<p style="margin:0 0 16px;color:' + DOC.INK_SOFT + ';">' +
        escaparHtml_(s.observaciones_generales).replace(/\n/g, '<br>') + '</p>'
      : '') +
    docSeccionOt_('Detalle de los ítems') +
    itemsHtml +
    bloqueAdjuntosGeneralesOt_(archivos, contadorImagenes) +
    cierreOt_();

  return docChromeOt_({
    tipoDoc: 'Orden de trabajo',
    referencia: s.solicitud_id,
    empresa: s.empresa_nombre || s.empresa_id
  }, cuerpo);
}

// --- chrome compartido (reutilizable por otros PDF, v7.6) -------------------

// Envuelve el contenido con el encabezado (marca + metadatos), la doble regla
// y el pie institucional con nota de confidencialidad. Sin barra de color
// saturada: wordmark + metadatos a la derecha + reglas finas = documento
// formal.
function docChromeOt_(meta, contenidoHtml) {
  var emitida = formatearFechaLegible_(new Date());
  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
    '<body style="margin:0;font-family:' + DOC.SANS + ';color:' + DOC.INK + ';font-size:13px;line-height:1.5;">' +
    '<div style="padding:26px 30px;">' +
    // Encabezado: wordmark izq + metadatos der
    '<table width="100%" style="border-collapse:collapse;"><tr>' +
    '<td style="vertical-align:middle;">' +
    '<table style="border-collapse:collapse;"><tr>' +
    '<td style="background:' + DOC.NAVY + ';color:#ffffff;font-family:' + DOC.SERIF + ';font-weight:bold;font-size:18px;' +
    'width:30px;height:30px;text-align:center;vertical-align:middle;border-radius:5px;">S</td>' +
    '<td style="padding-left:10px;vertical-align:middle;">' +
    '<div style="font-size:17px;font-weight:bold;letter-spacing:2px;color:' + DOC.INK + ';">SIGSO</div>' +
    '<div style="font-size:10px;color:' + DOC.MUTED + ';letter-spacing:0.3px;">Sistema de Gestión de Solicitudes</div>' +
    '</td></tr></table>' +
    '</td>' +
    '<td style="vertical-align:middle;text-align:right;">' +
    '<div style="font-size:12px;letter-spacing:2px;color:' + DOC.NAVY + ';font-weight:bold;text-transform:uppercase;">' +
    escaparHtml_(meta.tipoDoc) + '</div>' +
    '<div style="font-size:14px;color:' + DOC.INK + ';font-weight:bold;margin-top:2px;">N.º ' + escaparHtml_(meta.referencia) + '</div>' +
    '<div style="font-size:10px;color:' + DOC.MUTED + ';margin-top:2px;">Emitida: ' + escaparHtml_(emitida) + '</div>' +
    '</td></tr></table>' +
    // Doble regla (formal)
    '<div style="border-top:2px solid ' + DOC.NAVY + ';margin-top:12px;"></div>' +
    '<div style="border-top:1px solid ' + DOC.HAIRLINE + ';margin-top:2px;margin-bottom:18px;"></div>' +
    contenidoHtml +
    // Pie institucional
    '<div style="border-top:1px solid ' + DOC.HAIRLINE + ';margin-top:22px;padding-top:10px;font-size:10px;color:' + DOC.FAINT + ';line-height:1.5;">' +
    'SIGSO · Sistema de Gestión de Solicitudes · Documento generado automáticamente el ' + escaparHtml_(emitida) + '.<br>' +
    '<strong style="color:' + DOC.MUTED + ';">Confidencial — uso interno.</strong> Contiene datos de acceso y de la operación; no lo redistribuyas fuera del equipo autorizado.' +
    '</div>' +
    '</div></body></html>';
}

// Etiqueta de seccion en versalitas, con una barra de acento a la izquierda.
function docSeccionOt_(texto) {
  return '<table style="border-collapse:collapse;margin:0 0 8px;"><tr>' +
    '<td style="width:3px;background:' + DOC.NAVY + ';"></td>' +
    '<td style="padding-left:8px;font-size:11px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase;color:' + DOC.NAVY + ';">' +
    escaparHtml_(texto) + '</td></tr></table>';
}

// Ficha resumen: los datos "de un vistazo" en una tabla con hairlines.
function fichaSolicitudOt_(s, total) {
  var solicitante = escaparHtml_(s.solicitante_nombre || '—') +
    (s.solicitante_cargo ? ' <span style="color:' + DOC.MUTED + ';">— ' + escaparHtml_(s.solicitante_cargo) + '</span>' : '');
  var filas = [
    ['Empresa', escaparHtml_(s.empresa_nombre || s.empresa_id || '—'), 'Plataforma', escaparHtml_(s.plataforma_nombre || '—')],
    ['Estado', estadoOt_(s.estado_derivado), 'Prioridad', chipPrioridadOt_(s.prioridad_derivada)],
    ['Ítems', String(total), 'Ingresada', escaparHtml_(fechaCortaOt_(s.fecha_creacion))],
    ['Solicitante', solicitante, 'Correo', escaparHtml_(s.solicitante_email || '—')]
  ];
  if (s.es_cliente && s.empresa_cliente) {
    filas.push(['Cliente', escaparHtml_(s.empresa_cliente), 'Contacto', escaparHtml_(s.contacto_cliente || '—')]);
  }
  var cuerpo = filas.map(function (f) {
    return '<tr>' +
      '<td style="' + celdaLabelFicha_() + '">' + f[0] + '</td>' +
      '<td style="' + celdaValorFicha_() + '">' + f[1] + '</td>' +
      '<td style="' + celdaLabelFicha_() + '">' + f[2] + '</td>' +
      '<td style="' + celdaValorFicha_() + '">' + f[3] + '</td>' +
      '</tr>';
  }).join('');
  return '<table width="100%" style="border-collapse:collapse;border:1px solid ' + DOC.HAIRLINE + ';margin:0 0 18px;font-size:12px;">' +
    cuerpo + '</table>';
}
function celdaLabelFicha_() {
  return 'width:15%;padding:6px 8px;background:' + DOC.PANEL + ';border:1px solid ' + DOC.HAIRLINE +
    ';color:' + DOC.MUTED + ';font-size:10px;text-transform:uppercase;letter-spacing:0.5px;vertical-align:top;white-space:nowrap;';
}
function celdaValorFicha_() {
  return 'width:35%;padding:6px 8px;border:1px solid ' + DOC.HAIRLINE + ';color:' + DOC.INK + ';vertical-align:top;';
}

// --- bloque de un item -----------------------------------------------------

function bloqueItemOt_(sub, archivos, contador, indice, total) {
  var tipo = sub.tipo_nombre || sub.tipo || '';
  var estado = estadoOt_(sub.estado);
  var fecha = sub.fecha_comprometida
    ? escaparHtml_(fechaCortaOt_(sub.fecha_comprometida))
    : '<span style="color:' + DOC.MUTED + ';">Sin definir</span>';

  // Encabezado del item: "Ítem N de T" + tipo | chip prioridad + estado.
  var encabezado =
    '<table width="100%" style="border-collapse:collapse;background:' + DOC.PANEL +
    ';border-bottom:1px solid ' + DOC.HAIRLINE + ';"><tr>' +
    '<td style="padding:9px 12px;vertical-align:top;">' +
    '<div style="font-size:10px;letter-spacing:0.5px;text-transform:uppercase;color:' + DOC.MUTED + ';">' +
    'Ítem ' + indice + ' de ' + total + (tipo ? ' · ' + escaparHtml_(tipo) : '') + '</div>' +
    '<div style="font-size:15px;font-weight:bold;color:' + DOC.INK + ';font-family:' + DOC.SERIF + ';margin-top:2px;">' +
    escaparHtml_(sub.titulo || 'Sin título') + '</div>' +
    '</td>' +
    '<td style="padding:9px 12px;text-align:right;white-space:nowrap;vertical-align:top;">' +
    chipPrioridadOt_(sub.prioridad) + '<div style="font-size:11px;color:' + DOC.MUTED + ';margin-top:4px;">' + estado + '</div>' +
    '</td></tr></table>';

  // Secciones de contenido.
  var secciones = '';
  secciones += campoTextoOt_('Descripción del problema', sub.descripcion);
  secciones += campoTextoOt_('Contexto', sub.contexto);
  secciones += campoTextoOt_('Resultado esperado', sub.resultado_esperado);

  // Donde ejecutar (accesos).
  var filasEjec = [];
  if (sub.url_modulo) filasEjec.push(['URL principal', enlaceOt_(sub.url_modulo)]);
  parsearUrlsAdicionales_(sub.urls_adicionales).forEach(function (u) {
    if (u.url) filasEjec.push([u.titulo || 'URL adicional', enlaceOt_(u.url)]);
  });
  if (sub.usuario_prueba) filasEjec.push(['Usuario de prueba', escaparHtml_(sub.usuario_prueba)]);
  if (sub.ref_credencial) filasEjec.push(['Credencial', escaparHtml_(sub.ref_credencial)]);
  if (filasEjec.length) secciones += subseccionOt_('Dónde ejecutar') + tablaDatosOt_(filasEjec);

  // Detalles del pedido (contexto operativo para el desarrollador).
  var filasDet = [];
  if (sub.modulo_nombre) filasDet.push(['Módulo', escaparHtml_(sub.modulo_nombre)]);
  if (sub.area_nombre) filasDet.push(['Área', escaparHtml_(sub.area_nombre)]);
  if (sub.frecuencia) filasDet.push(['Frecuencia', escaparHtml_(sub.frecuencia)]);
  if (sub.personas_afectadas) filasDet.push(['Personas afectadas', escaparHtml_(sub.personas_afectadas)]);
  if (sub.desarrollador_asignado) filasDet.push(['Responsable asignado', escaparHtml_(sub.desarrollador_asignado)]);
  filasDet.push(['Fecha comprometida', fecha]);
  if (sub.observaciones) filasDet.push(['Observaciones', escaparHtml_(sub.observaciones)]);
  secciones += subseccionOt_('Detalles del pedido') + tablaDatosOt_(filasDet);

  var archivosItem = (archivos || []).filter(function (a) { return a.subsolicitud_id === sub.subsolicitud_id; });
  secciones += bloqueImagenesOt_(archivosItem.filter(esImagenOt_), contador);
  secciones += bloqueDocumentosOt_(archivosItem.filter(function (a) { return !esImagenOt_(a); }));

  // page-break-inside:avoid para que un item no se parta feo entre paginas.
  return '<div style="border:1px solid ' + DOC.HAIRLINE + ';border-radius:4px;margin-bottom:14px;overflow:hidden;page-break-inside:avoid;">' +
    encabezado +
    '<div style="padding:12px 14px;">' + secciones + '</div>' +
    '</div>';
}

// Campo de texto libre con su etiqueta en versalitas (omite si vacio).
function campoTextoOt_(etiqueta, valor) {
  if (!valor) return '';
  return subseccionOt_(etiqueta) +
    '<p style="margin:0 0 12px;color:' + DOC.INK_SOFT + ';">' + escaparHtml_(valor).replace(/\n/g, '<br>') + '</p>';
}

// Sub-etiqueta dentro de un item.
function subseccionOt_(texto) {
  return '<div style="font-size:10px;font-weight:bold;letter-spacing:0.8px;text-transform:uppercase;color:' + DOC.MUTED +
    ';margin:0 0 4px;">' + escaparHtml_(texto) + '</div>';
}

// Tabla etiqueta/valor (accesos, detalles).
function tablaDatosOt_(filas) {
  var cuerpo = filas.map(function (f) {
    return '<tr>' +
      '<td style="padding:3px 12px 3px 0;color:' + DOC.MUTED + ';vertical-align:top;white-space:nowrap;width:150px;">' + f[0] + '</td>' +
      '<td style="padding:3px 0;color:' + DOC.INK + ';vertical-align:top;word-break:break-word;">' + f[1] + '</td>' +
      '</tr>';
  }).join('');
  return '<table style="border-collapse:collapse;font-size:12px;margin:0 0 12px;width:100%;">' + cuerpo + '</table>';
}

function enlaceOt_(url) {
  var limpia = escaparHtml_(url);
  return '<a href="' + limpia + '" style="color:' + DOC.NAVY + ';text-decoration:underline;word-break:break-all;">' + limpia + '</a>';
}

// Chip de prioridad sobrio: punto de color + codigo, borde fino (no relleno
// saturado). Se lee claro pero sin gritar.
function chipPrioridadOt_(prioridad) {
  var colores = { P1: '#B4232A', P2: '#B26A00', P3: '#8A6D00', P4: '#556070', P5: '#6B7280' };
  var c = colores[prioridad] || '#556070';
  return '<span style="display:inline-block;border:1px solid ' + DOC.HAIRLINE + ';border-radius:11px;padding:2px 9px 2px 7px;' +
    'font-size:11px;font-weight:bold;color:' + DOC.INK + ';white-space:nowrap;">' +
    '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:' + c + ';margin-right:5px;"></span>' +
    escaparHtml_(prioridad || '—') + '</span>';
}

function estadoOt_(codigo) {
  return escaparHtml_(ESTADO_LABEL_OT[codigo] || codigo || '—');
}

// v5.2: true si el archivo es una imagen (se embebe); false si es documento
// (PDF/Word/Excel -- se enlaza para descargar).
function esImagenOt_(archivo) {
  return String(archivo.tipo_mime || '').indexOf('image/') === 0;
}

// Embebe hasta MAX_IMAGENES_OT capturas (base64), leyendo los bytes de Drive.
// Recibe la lista de imagenes YA filtrada. Si una imagen falla (id no valido,
// permiso, borrada) se salta sin romper la OT -- una captura menos es mejor
// que una OT que no se genera.
function bloqueImagenesOt_(imagenes, contador) {
  if (!imagenes || imagenes.length === 0) return '';

  var figuras = [];
  var omitidas = 0;
  imagenes.forEach(function (archivo) {
    if (contador.usadas >= MAX_IMAGENES_OT) { omitidas++; return; }
    var tag = imgEmbebidaOt_(archivo);
    if (tag) {
      contador.usadas++;
      var nombre = archivo.nombre_original || '';
      figuras.push(
        '<div style="margin:6px 0 10px;page-break-inside:avoid;">' +
        tag +
        '<div style="font-size:10px;color:' + DOC.MUTED + ';margin-top:3px;">Figura ' + contador.usadas +
        (nombre ? ' — ' + escaparHtml_(nombre) : '') + '</div></div>'
      );
    }
  });
  if (figuras.length === 0 && omitidas === 0) return '';

  return '<div style="margin-top:8px;">' +
    subseccionOt_('Capturas') +
    figuras.join('') +
    (omitidas > 0
      ? '<p style="margin:2px 0 0;font-size:11px;color:' + DOC.FAINT + ';">(+' + omitidas + ' captura(s) adicional(es) disponibles en el sistema)</p>'
      : '') +
    '</div>';
}

// v5.2: los documentos (PDF/Word/Excel) NO se embeben (un PDF dentro de otro
// no tiene sentido) -- se listan con un ENLACE para verlos/descargarlos desde
// Drive. Recibe la lista de documentos YA filtrada (no imagenes).
function bloqueDocumentosOt_(documentos) {
  if (!documentos || documentos.length === 0) return '';
  var items = documentos.map(function (d) {
    var nombre = d.nombre_original || 'documento';
    return '<li style="margin-bottom:4px;">' +
      '<a href="' + escaparHtml_(d.url) + '" style="color:' + DOC.NAVY + ';text-decoration:underline;">' +
      escaparHtml_(nombre) + '</a></li>';
  }).join('');
  return '<div style="margin-top:8px;">' +
    subseccionOt_('Documentos adjuntos') +
    '<ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.5;color:' + DOC.INK + ';">' + items + '</ul>' +
    '<p style="margin:3px 0 0;font-size:11px;color:' + DOC.FAINT + ';">Abre el enlace para ver o descargar el documento.</p>' +
    '</div>';
}

// v5.2: adjuntos a nivel de SOLICITUD (sin subsolicitud_id) -- imagenes y
// documentos del bloque general del formulario. Van en su propia tarjeta al
// final para que no se pierdan.
function bloqueAdjuntosGeneralesOt_(archivos, contador) {
  var generales = (archivos || []).filter(function (a) { return !a.subsolicitud_id; });
  if (generales.length === 0) return '';
  var imagenesHtml = bloqueImagenesOt_(generales.filter(esImagenOt_), contador);
  var documentosHtml = bloqueDocumentosOt_(generales.filter(function (a) { return !esImagenOt_(a); }));
  if (!imagenesHtml && !documentosHtml) return '';
  return docSeccionOt_('Adjuntos de la solicitud') +
    '<div style="border:1px solid ' + DOC.HAIRLINE + ';border-radius:4px;padding:12px 14px;margin-bottom:14px;page-break-inside:avoid;">' +
    imagenesHtml +
    documentosHtml +
    '</div>';
}

// Bloque de cierre: instrucciones profesionales (reemplaza el "responde LISTO
// por WhatsApp" informal de v5.2).
function cierreOt_() {
  return docSeccionOt_('Cómo cerrar esta orden') +
    '<table width="100%" style="border-collapse:collapse;background:' + DOC.PANEL +
    ';border:1px solid ' + DOC.HAIRLINE + ';border-radius:4px;margin-bottom:4px;"><tr>' +
    '<td style="padding:12px 14px;font-size:12px;color:' + DOC.INK_SOFT + ';line-height:1.6;">' +
    '<strong style="color:' + DOC.INK + ';">1.</strong> Ejecuta el trabajo descrito en los ítems anteriores.<br>' +
    '<strong style="color:' + DOC.INK + ';">2.</strong> Marca cada ítem como <strong>Terminada</strong> en SIGSO, o confirma su cierre por el canal acordado con tu coordinación.<br>' +
    '<strong style="color:' + DOC.INK + ';">3.</strong> Adjunta evidencia del resultado (captura o enlace) cuando corresponda, para agilizar la validación.' +
    '</td></tr></table>';
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
      '" style="max-width:100%;height:auto;border:1px solid ' + DOC.HAIRLINE + ';border-radius:4px;display:block;">';
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
