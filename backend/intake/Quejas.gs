/**
 * Quejas.gs (Intake) — v10.0 Fase 4, PRO-07.
 *
 * La PARTE 1 del FO-PRO-07-01 ("Formulario de quejas, felicitaciones y
 * consultas"): lo que cualquier visitante del sitio llena SIN CUENTA, tal
 * como hoy se llena "Nueva solicitud". Las Partes 2 a 5 (registro interno,
 * investigación, resolución, notificación y seguimiento) las gestiona el
 * Backoffice, en su propio Quejas.gs -- misma separación que ya existe
 * entre Solicitudes.gs de Intake y de Backoffice: dos proyectos de Apps
 * Script distintos, una sola hoja compartida.
 *
 * DECISIÓN QUE VALE LA PENA EXPLICAR: `Especificacion_Formulario_Web_Quejas.docx`
 * es un encargo a un proveedor externo para construir esto en el sitio,
 * pero pide EXACTAMENTE la arquitectura que Intake ya tiene: formulario
 * público → correo al responsable → confirmación al remitente → registro
 * en una base de datos. Construirlo acá, en vez de encargarlo aparte,
 * elimina el paso de transcripción manual que PRO-07 §6.1 hoy exige
 * ("el responsable del SGC transcribirá la información al formulario") y
 * hace que el correlativo y el plazo arranquen desde el segundo en que el
 * cliente envía, no desde que alguien abre el correo.
 */

var Quejas = {

  // El único destinatario fijo del aviso de "llegó una queja nueva": no
  // hay una cuenta de Backoffice logueada del otro lado (es Intake, sin
  // login), así que no se puede resolver "el Encargado SGC" por rol como
  // hace el Backoffice (SGC_ROLES vive en la otra hoja/proyecto, pero aun
  // pudiendo leerla, aquí no hay un `contexto` de quién pregunta). Se
  // avisa a esta casilla fija, tal como pedía la especificación original
  // del formulario web ("enviar correo a homepymes89@gmail.com") -- solo
  // que con el correo vigente.
  EMAIL_CONTACTO_SGC: 'homepymes.control@gmail.com',

  crear: function (data) {
    var nombre = String(data.nombre_completo || '').trim();
    if (!nombre) return errorValidacion_('nombre_completo', 'Indica tu nombre completo.');
    var email = String(data.email || '').trim();
    if (!email || !esEmailValido_(email)) {
      return errorValidacion_('email', 'Indica un correo electrónico válido: ahí te llegará la respuesta.');
    }
    if (TIPOS_QUEJA.indexOf(data.tipo) === -1) {
      return errorValidacion_('tipo', 'Indica si es queja, reclamación, felicitación o consulta.');
    }
    if (AREAS_QUEJA.indexOf(data.area) === -1) {
      return errorValidacion_('area', 'Indica a qué área o servicio se relaciona.');
    }
    var descripcion = String(data.descripcion || '').trim();
    // El formulario real pide minimo 20 caracteres: un mensaje mas corto
    // no le da al Responsable SGC nada con que empezar la investigacion.
    if (descripcion.length < 20) {
      return errorValidacion_('descripcion', 'Cuéntanos con un poco más de detalle (mínimo 20 caracteres).');
    }

    var ahora = new Date();
    var queja = {
      queja_id: Utilities.getUuid(),
      correlativo: siguienteCorrelativoQueja_(ahora),
      nombre_completo: nombre,
      empresa: String(data.empresa || '').trim(),
      rut: String(data.rut || '').trim(),
      email: email,
      telefono: String(data.telefono || '').trim(),
      tipo: data.tipo,
      area: data.area,
      descripcion: descripcion,
      canal: CANALES_QUEJA.indexOf(data.canal) !== -1 ? data.canal : 'WEB',
      fecha_envio: ahora.toISOString(),
      fecha_recepcion: '', procede: '', motivo_no_procede: '', registrado_por: '',
      investigador_email: '', resultado_investigacion: '', valida: '',
      accion_implementada: '', nc_id: '', resolucion_plazo: '', fecha_resolucion: '', responsable_resolucion: '',
      fecha_notificacion: '', revisado_por: '',
      seguimiento_plazo: '', fecha_seguimiento: '', cliente_conforme: '',
      estado: 'RECIBIDA',
      fecha_cierre: '', cerrada_por: '',
      fecha_creacion: ahora.toISOString(),
      activa: true
    };
    agregarFila_(SHEETS.SGC_QUEJAS, queja);

    enviarConfirmacionQueja_(queja);
    enviarAvisoNuevaQueja_(queja);

    // Al remitente solo le importan estos datos -- no la fila completa
    // (que ya trae campos internos vacíos que no son de su incumbencia).
    return {
      queja_id: queja.queja_id,
      correlativo: queja.correlativo,
      tipo: queja.tipo,
      fecha_envio: queja.fecha_envio
    };
  }
};

var TIPOS_QUEJA = ['QUEJA', 'RECLAMACION', 'FELICITACION', 'CONSULTA'];
var AREAS_QUEJA = ['RRHH', 'CONTABILIDAD', 'PREVENCION', 'MARKETING', 'ADMINISTRACION', 'OTRO'];
var CANALES_QUEJA = ['WEB', 'CORREO', 'TELEFONO', 'ENCUESTA'];

function siguienteCorrelativoQueja_(fecha) {
  var anio = fecha.getFullYear();
  var delAnio = leerFilas_(SHEETS.SGC_QUEJAS).filter(function (q) {
    var f = new Date(q.fecha_envio);
    return !isNaN(f.getTime()) && f.getFullYear() === anio;
  }).length;
  return 'Q-' + anio + '-' + ('00' + (delAnio + 1)).slice(-3);
}

function enviarConfirmacionQueja_(queja) {
  var asunto = 'HomePymes — Recibimos tu ' + etiquetaTipoQueja_(queja.tipo).toLowerCase();
  var texto = 'Hola ' + queja.nombre_completo + ',\n\n' +
    'Recibimos tu mensaje (' + queja.correlativo + ') y lo estamos revisando.\n\n' +
    'Nuestro equipo te dará respuesta en un plazo máximo de 30 días corridos.\n\n' +
    'Resumen de lo que registramos:\n"' + queja.descripcion.slice(0, 200) + (queja.descripcion.length > 200 ? '…' : '') + '"';
  var html = plantillaCorreoHtml_('Recibimos tu mensaje',
    '<p>Hola ' + escaparHtmlCorreo_(queja.nombre_completo) + ',</p>' +
    '<p>Recibimos tu mensaje (<strong>' + escaparHtmlCorreo_(queja.correlativo) + '</strong>) y lo estamos revisando.</p>' +
    '<p>Nuestro equipo te dará respuesta en un plazo máximo de <strong>30 días corridos</strong>.</p>');
  enviarCorreo_(queja.queja_id, queja.email, 'SGC_QUEJA_CONFIRMACION', asunto, texto, null, { htmlBody: html });
}

function enviarAvisoNuevaQueja_(queja) {
  var asunto = 'SIGSO — Nueva ' + etiquetaTipoQueja_(queja.tipo).toLowerCase() + ' recibida (' + queja.correlativo + ')';
  var texto = 'Se recibió un nuevo mensaje por el formulario público:\n\n' +
    'Correlativo: ' + queja.correlativo + '\n' +
    'Tipo: ' + etiquetaTipoQueja_(queja.tipo) + '\n' +
    'Área: ' + queja.area + '\n' +
    'De: ' + queja.nombre_completo + (queja.empresa ? ' (' + queja.empresa + ')' : '') + ' — ' + queja.email + '\n\n' +
    queja.descripcion;
  var html = plantillaCorreoHtml_('Nuevo mensaje recibido',
    '<p>Se recibió un nuevo mensaje por el formulario público de quejas, felicitaciones y consultas:</p>' +
    '<p><strong>' + escaparHtmlCorreo_(queja.correlativo) + '</strong> — ' + escaparHtmlCorreo_(etiquetaTipoQueja_(queja.tipo)) +
    ' · ' + escaparHtmlCorreo_(queja.area) + '</p>' +
    '<p>De: ' + escaparHtmlCorreo_(queja.nombre_completo) +
    (queja.empresa ? ' (' + escaparHtmlCorreo_(queja.empresa) + ')' : '') + ' — ' + escaparHtmlCorreo_(queja.email) + '</p>' +
    '<p>' + escaparHtmlCorreo_(queja.descripcion) + '</p>' +
    '<p>Entra a SIGSO &gt; Calidad &gt; Quejas para registrarla.</p>');
  enviarCorreo_(queja.queja_id, Quejas.EMAIL_CONTACTO_SGC, 'SGC_QUEJA_NUEVA', asunto, texto, null, { htmlBody: html });
}

function etiquetaTipoQueja_(tipo) {
  var etiquetas = { QUEJA: 'Queja', RECLAMACION: 'Reclamación', FELICITACION: 'Felicitación', CONSULTA: 'Consulta' };
  return etiquetas[tipo] || tipo;
}
