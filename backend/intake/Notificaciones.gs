/**
 * Notificaciones.gs — App Publica: acuse de recibo y alerta critica (A-02,
 * A-03, §5.1 pasos 6-7). Duplica el nucleo de envio/dedup con
 * backend/backoffice/Notificaciones.gs (mismo criterio de siempre: son
 * proyectos Apps Script separados, ver nota en Config.gs).
 *
 * RN-026: se deduplica el mismo evento para la misma solicitud dentro de
 * una ventana de 30 minutos (evita reenvios por reintentos/dobles clics).
 */

var VENTANA_DEDUP_MINUTOS = 30;

// Buzon del equipo de desarrollo (Leo). Es quien recibe el aviso de cada
// solicitud que corresponda notificar (cliente siempre; interna solo si el
// solicitante lo pide; y cualquier P1). Se deja como constante para poder
// cambiarlo sin tocar Script Properties; si se quiere hacer configurable en
// caliente, mover a getConfig_() / una hoja de config es un cambio acotado.
var EMAIL_DESARROLLO = 'lestay@rld.cl';

// URL del sitio publico (GitHub Pages) para los enlaces de seguimiento en
// los correos. No es secreta (es el sitio publico); misma fuente que
// backend/build-backoffice-html.js.
var SITIO_PUBLICO_CORREOS = 'https://lmtechworkspace-tech.github.io/Sistema-de-solicitudes-/';

// Pie comun de todos los correos formales del sistema (v3.0, mejora de
// redaccion): un solo lugar para cambiar la firma institucional.
function pieCorreo_() {
  return '\n\n' +
    '--------------------------------------------------\n' +
    'Este es un mensaje automatico del sistema SIGSO.\n' +
    'Por favor no responda directamente a este correo.\n' +
    'Equipo SIGSO — Control y Gestión Empresarial';
}

// v7.6 (correos "corporativo sobrio"): estos son los correos que le llegan al
// SOLICITANTE -- externo a la empresa, el que primero forma una impresion de
// SIGSO -- asi que se les aplica la misma plantilla branded que ya tiene el
// Backoffice (backend/backoffice/Notificaciones.gs), duplicada aqui por ser
// un proyecto Apps Script separado (misma nota de siempre). Estilos INLINE
// (los clientes de correo ignoran <style>/CSS externo). `opts.pie` agrega un
// bloque de accion destacado bajo el cuerpo.
function plantillaCorreoHtml_(titulo, cuerpoHtml, opts) {
  opts = opts || {};
  var pie = opts.pie
    ? '<div style="background:#F8FAFC;border:1px solid #E5E7EB;border-left:3px solid #14213D;padding:12px 16px;margin:20px 0 0;font-size:14px;color:#1F2937;">' +
      opts.pie + '</div>'
    : '';
  return '<div style="margin:0;padding:0;background:#EEF1F6;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1F6;padding:32px 0;">' +
    '<tr><td align="center">' +
    '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #E5E7EB;font-family:Arial,Helvetica,sans-serif;">' +
    // Cabecera institucional: sello + marca.
    '<tr><td style="background:#14213D;padding:22px 28px;">' +
    '<table cellpadding="0" cellspacing="0" role="presentation"><tr>' +
    '<td style="width:34px;height:34px;background:#ffffff;text-align:center;vertical-align:middle;font-family:Georgia,\'Times New Roman\',serif;font-weight:bold;font-size:17px;color:#14213D;">S</td>' +
    '<td style="padding-left:12px;vertical-align:middle;">' +
    '<div style="color:#ffffff;font-family:Georgia,\'Times New Roman\',serif;font-size:19px;font-weight:bold;letter-spacing:0.3px;">SIGSO</div>' +
    '<div style="color:#AEB8CC;font-size:11px;letter-spacing:0.3px;">Sistema de Gestión de Solicitudes</div>' +
    '</td></tr></table>' +
    '</td></tr>' +
    // Categoria del correo (eyebrow).
    '<tr><td style="padding:14px 28px;background:#F8FAFC;border-bottom:1px solid #E5E7EB;">' +
    '<span style="display:inline-block;width:3px;height:12px;background:#14213D;margin-right:8px;"></span>' +
    '<span style="font-size:12px;font-weight:bold;letter-spacing:0.8px;color:#374151;text-transform:uppercase;">' + escaparHtmlCorreo_(titulo) + '</span>' +
    '</td></tr>' +
    // Cuerpo
    '<tr><td style="padding:26px 28px;color:#1F2937;font-size:15px;line-height:1.6;">' +
    cuerpoHtml +
    pie +
    '</td></tr>' +
    // Pie institucional
    '<tr><td style="padding:16px 28px;background:#F8FAFC;border-top:1px solid #E5E7EB;color:#6B7280;font-size:12px;line-height:1.6;">' +
    'Mensaje automático del sistema SIGSO. Por favor no respondas directamente a este correo.<br>' +
    'Equipo SIGSO — Control y Gestión Empresarial' +
    '</td></tr>' +
    '</table></td></tr></table></div>';
}

function escaparHtmlCorreo_(valor) {
  return String(valor === undefined || valor === null ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Convierte el cuerpo de texto plano (el que ya escribe cada metodo de
// Notificaciones) en el HTML branded, sin tener que reescribir cada correo a
// mano. Corta el pie de texto plano (pieCorreo_) porque la plantilla ya pone
// su propio pie institucional.
function htmlAutoDesdeTexto_(asunto, textoPlano) {
  var texto = String(textoPlano || '');
  var corte = texto.indexOf('\n--------------------------------------------------');
  if (corte !== -1) texto = texto.slice(0, corte);
  var cuerpoHtml = '<p style="margin:0;">' +
    escaparHtmlCorreo_(texto.trim()).replace(/\n/g, '<br>') +
    '</p>';
  var titulo = String(asunto || 'Notificación').replace(/^SIGSO\s*[—-]\s*/, '').trim() || 'Notificación';
  return plantillaCorreoHtml_(titulo, cuerpoHtml);
}

var Notificaciones = {
  enviarAcuseRecibo: function (solicitud) {
    var asunto = 'SIGSO — Confirmación de recepción de su solicitud ' + solicitud.solicitud_id;
    var lineasDetalle = [
      '- N° de solicitud: ' + solicitud.solicitud_id,
      solicitud.empresa_id ? '- Empresa: ' + solicitud.empresa_id : '',
      solicitud.prioridad ? '- Prioridad inicial: ' + solicitud.prioridad : '',
      solicitud.total_items ? '- Ítems registrados: ' + solicitud.total_items : '',
      '- Fecha de ingreso: ' + new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })
    ].filter(function (l) { return l !== ''; });

    // v3.1 (§1.8): en una atencion directa la solicitud NO se deriva a nadie
    // para revision -- ya esta resuelta y nace cerrada. Decirle lo contrario
    // al solicitante lo dejaria esperando una respuesta que no va a llegar.
    var cuerpo =
      'Estimado/a ' + solicitud.solicitante_nombre + ':\n\n' +
      (solicitud.atencion_directa
        ? 'Confirmamos el registro de su solicitud, que ya fue resuelta mediante ' +
          'atención directa. Queda cerrada en el Sistema de Gestión de Solicitudes ' +
          '(SIGSO) como respaldo de lo ocurrido; no requiere ninguna acción adicional.\n\n'
        : 'Confirmamos la recepción de su solicitud, la cual ha sido registrada ' +
          'correctamente en el Sistema de Gestión de Solicitudes (SIGSO) y derivada ' +
          'al equipo responsable para su revisión.\n\n') +
      'DETALLE DE LA SOLICITUD\n' +
      lineasDetalle.join('\n') + '\n\n' +
      'SEGUIMIENTO\n' +
      'Puede consultar el estado de su solicitud en cualquier momento en:\n' +
      SITIO_PUBLICO_CORREOS + 'estado.html\n' +
      'En la pestaña "Mis solicitudes", ingresando este mismo correo, podrá ver ' +
      'todas sus solicitudes y su avance.\n\n' +
      'RESUMEN\n' +
      solicitud.resumen_whatsapp +
      pieCorreo_();
    // Fase 9: cc opcional del formulario (hallazgo real, RLD "Hoja de
    // ruta") -- se copia en el acuse, no cambia a quien va dirigido ni
    // la deduplicacion (esa sigue siendo por solicitante_email).
    return enviarCorreo_(solicitud.solicitud_id, solicitud.solicitante_email, 'ACUSE_RECIBO', asunto, cuerpo, solicitud.cc);
  },

  // Aviso al responsable de la solicitud. v3.0 (Fase 1, multi-responsable):
  // el destinatario ya no es fijo -- crearSolicitud resuelve el responsable
  // ruteado de cada item (CAT_AREAS -> correo) y lo pasa aqui. Si no se pasa
  // destinatario (llamadas viejas), cae al buzon por defecto EMAIL_DESARROLLO,
  // preservando el comportamiento previo. El motivo (cliente / P1 / nueva)
  // lo decide crearSolicitud.
  enviarAvisoDesarrollo: function (solicitud, motivo, destinatario) {
    var email = destinatario || EMAIL_DESARROLLO;
    var asunto = 'SIGSO - ' + (solicitud.prioridad === 'P1' ? 'ALERTA P1: ' : 'Nueva solicitud asignada: ') + solicitud.solicitud_id;
    var cuerpo =
      'Estimado/a:\n\n' +
      'Se ha registrado una nueva solicitud dirigida a su bandeja de trabajo.\n\n' +
      'DETALLE\n' +
      '- N° de solicitud: ' + solicitud.solicitud_id + '\n' +
      '- Prioridad: ' + (solicitud.prioridad || 'por definir') + '\n' +
      '- Motivo del aviso: ' + (motivo || 'nueva solicitud') + '\n\n' +
      'ACCIÓN REQUERIDA\n' +
      'Ingrese al Backoffice para revisarla, comprometer una fecha de entrega ' +
      'y gestionar su avance.\n\n' +
      'RESUMEN\n' +
      solicitud.resumen_whatsapp +
      pieCorreo_();
    return enviarCorreo_(solicitud.solicitud_id, email, 'AVISO_DESARROLLO', asunto, cuerpo);
  },

  // v3.1 (§1.8): acuse de una atencion directa. NO es "tienes una solicitud
  // nueva": el destinatario es justamente quien ya resolvio el problema por
  // telefono, asi que un llamado a la accion seria absurdo. Solo se le avisa
  // que quedo el registro, para que sepa que existe y pueda corregirlo si el
  // detalle no es exacto.
  avisarAtencionDirectaRegistrada: function (solicitud, atencion, destinatario) {
    var email = destinatario || EMAIL_DESARROLLO;
    var asunto = 'SIGSO — Registro de atención directa: ' + solicitud.solicitud_id;
    var cuerpo =
      'Estimado/a:\n\n' +
      'Se dejó registro en SIGSO de una solicitud que ya fue resuelta fuera del ' +
      'flujo normal (atención directa). No requiere ninguna acción de su parte: ' +
      'queda cerrada.\n\n' +
      'DETALLE\n' +
      '- N° de solicitud: ' + solicitud.solicitud_id + '\n' +
      '- Ítems registrados: ' + (solicitud.total_items || 1) + '\n' +
      '- Registrada por: ' + (solicitud.solicitante_nombre || '') + '\n' +
      '- Resuelta por: ' + atencion.resuelto_por + '\n' +
      '- Fecha de resolución: ' + String(atencion.fecha_resolucion).replace('T', ' ') + '\n\n' +
      'QUÉ SE HIZO\n' +
      atencion.detalle + '\n\n' +
      'Si algo de este registro no es exacto, puede corregirlo desde el Backoffice.' +
      pieCorreo_();
    return enviarCorreo_(solicitud.solicitud_id, email, 'ATENCION_DIRECTA', asunto, cuerpo);
  },

  // RN-201 (v2.0, Sprint 1): avisa al responsable del item cuando el
  // solicitante valida un item "Terminada" -- confirmando el cierre o
  // reabriendolo con un motivo. Sin este aviso, no se entera de una
  // reapertura hasta que vuelve a mirar el panel (el gobierno del proceso
  // depende de que se entere rapido). v3.0 (Fase 2.1, multi-responsable): el
  // destinatario ya no es fijo -- se pasa el desarrollador_asignado del item
  // (o el buzon por defecto EMAIL_DESARROLLO si no hay ruteo, retrocompatible).
  notificarValidacionSolicitante: function (solicitud, subsolicitud, accion, destinatario) {
    var email = destinatario || EMAIL_DESARROLLO;
    var esConfirmacion = accion === 'confirmar';
    // v3.1 (§1.3B): 'cerrar_directo' es un tercer caso. Sin distinguirlo, un
    // cierre directo se anunciaria como "Ítem reabierto", que es lo contrario
    // de lo que paso.
    var esCierreDirecto = accion === 'cerrar_directo';
    var asunto = 'SIGSO - ' + (esCierreDirecto
      ? 'Cerrado por atención directa'
      : (esConfirmacion ? 'Cierre confirmado' : 'Ítem reabierto por el solicitante')) +
      ': ' + subsolicitud.subsolicitud_id;
    var cuerpo =
      'Estimado/a:\n\n' +
      (esCierreDirecto
        ? 'El solicitante indicó que el ítem ya fue resuelto fuera del flujo (atención directa) y lo cerró, dejando el registro correspondiente. El ítem pasa a estado Cerrada; no se requieren más acciones.'
        : esConfirmacion
          ? 'El solicitante confirmó que el ítem indicado quedó resuelto satisfactoriamente. El ítem pasa a estado Cerrada; no se requieren más acciones.'
          : 'El solicitante indicó que el ítem NO quedó resuelto y lo reabrió. El ítem vuelve a estado En desarrollo; se requiere su revisión.') + '\n\n' +
      'DETALLE\n' +
      '- Ítem: ' + subsolicitud.subsolicitud_id + (subsolicitud.titulo ? ' — ' + subsolicitud.titulo : '') + '\n' +
      '- Solicitud: ' + solicitud.solicitud_id + '\n' +
      '- Solicitante: ' + (solicitud.solicitante_nombre || solicitud.solicitante_email || '') +
      pieCorreo_();
    return enviarCorreo_(solicitud.solicitud_id, email, 'VALIDACION_SOLICITANTE:' + subsolicitud.subsolicitud_id + ':' + accion, asunto, cuerpo);
  },

  // P5 (v2.0, Sprint 3): avisa al responsable cuando el solicitante responde
  // una pregunta ("esperando informacion", S06). Sin este aviso, solo se
  // entera si vuelve a mirar el panel -- el ciclo "pedir info / responder"
  // quedaba con la mitad notificada (la pregunta si avisaba, la respuesta no).
  // v3.0 (Fase 2.1): destinatarios es un array de correos (uno por cada
  // responsable distinto involucrado); si viene vacio, cae al buzon por
  // defecto EMAIL_DESARROLLO (retrocompatible).
  notificarRespuestaSolicitante: function (solicitud, subsolicitudId, texto, destinatarios) {
    var emails = (destinatarios && destinatarios.length > 0) ? destinatarios : [EMAIL_DESARROLLO];
    var asunto = 'SIGSO - Respuesta del solicitante: ' + (subsolicitudId || solicitud.solicitud_id);
    var cuerpo =
      'Estimado/a:\n\n' +
      'El solicitante ha respondido a la información pendiente de la solicitud ' +
      solicitud.solicitud_id + (subsolicitudId ? ' (ítem ' + subsolicitudId + ')' : '') + '.\n\n' +
      'RESPUESTA DEL SOLICITANTE\n' +
      '"' + texto + '"\n\n' +
      'ACCIÓN REQUERIDA\n' +
      'Ingrese al Backoffice para revisar la respuesta y continuar con la gestión ' +
      'del ítem (sigue en estado "Esperando información" hasta que usted lo avance).' +
      pieCorreo_();
    return emails.map(function (email) {
      return enviarCorreo_(solicitud.solicitud_id, email, 'RESPUESTA_SOLICITANTE:' + (subsolicitudId || solicitud.solicitud_id), asunto, cuerpo);
    });
  },

  // v3.0 (Fase 3, "Mis solicitudes", §4): codigo de un solo uso para ver la
  // lista de solicitudes propias. El evento incluye el codigo (no solo el
  // correo) para que dos pedidos seguidos del mismo correo no se deduplique
  // el segundo -- cada codigo es distinto, cada uno debe llegar.
  enviarCodigoAcceso: function (email, codigo) {
    var asunto = 'SIGSO — Código de acceso a Mis solicitudes: ' + codigo;
    var cuerpo =
      'Estimado/a:\n\n' +
      'Ha solicitado acceder a la vista "Mis solicitudes" del sistema SIGSO. ' +
      'Su código de verificación es:\n\n' +
      '    ' + codigo + '\n\n' +
      'Ingréselo en la página de Consultar Estado, pestaña "Mis solicitudes":\n' +
      SITIO_PUBLICO_CORREOS + 'estado.html\n\n' +
      'El código es válido por 10 minutos y de un solo uso. Si usted no lo ' +
      'solicitó, puede ignorar este correo con tranquilidad.' +
      pieCorreo_();
    return enviarCorreo_(email, email, 'CODIGO_ACCESO:' + codigo, asunto, cuerpo);
  }
};

// RN-026 deduplica por (solicitud, evento, destinatario): una alerta con
// varios destinatarios (p.ej. Analista + Desarrollador en ALERTA_CRITICA)
// debe llegarle a cada uno, no solo al primero.
function yaNotificadoRecientemente_(solicitudId, evento, destinatario) {
  var ahora = new Date().getTime();
  return leerFilas_(SHEETS.LOG_NOTIFICACIONES).some(function (fila) {
    if (
      fila.solicitud_id !== solicitudId ||
      fila.evento !== evento ||
      fila.destinatario !== destinatario ||
      fila.resultado !== 'ENVIADO'
    ) {
      return false;
    }
    var minutosTranscurridos = (ahora - new Date(fila.timestamp).getTime()) / 60000;
    return minutosTranscurridos < VENTANA_DEDUP_MINUTOS;
  });
}

function registrarNotificacion_(solicitudId, canal, destinatario, evento, resultado, reintentos) {
  agregarFila_(SHEETS.LOG_NOTIFICACIONES, {
    log_id: Utilities.getUuid(),
    timestamp: new Date().toISOString(),
    solicitud_id: solicitudId,
    canal: canal,
    destinatario: destinatario,
    evento: evento,
    resultado: resultado,
    reintentos: reintentos || 0
  });
}

// opts (v10.0 Fase 4): opcional, { htmlBody } -- si el caller trae un HTML
// propio (Quejas.gs, con su propio formato) se respeta; si no, se genera
// uno branded a partir del texto plano, igual que siempre. Parametro
// aditivo al final: no cambia ningun llamador existente de 6 argumentos.
function enviarCorreo_(solicitudId, destinatario, evento, asunto, cuerpo, cc, opts) {
  if (!destinatario) {
    return { enviado: false, motivo: 'sin_destinatario' };
  }
  if (yaNotificadoRecientemente_(solicitudId, evento, destinatario)) {
    return { enviado: false, motivo: 'deduplicado' };
  }
  try {
    // MailApp (no GmailApp): solo necesita el scope script.send_mail para
    // enviar, en vez del scope completo de Gmail. Soporta cc en opciones.
    // v7.6: htmlBody branded (el texto plano sigue viajando como fallback
    // para clientes de correo que no rendericen HTML).
    var opciones = {
      name: 'SIGSO — Control y Gestión Empresarial',
      htmlBody: (opts && opts.htmlBody) ? opts.htmlBody : htmlAutoDesdeTexto_(asunto, cuerpo)
    };
    if (cc) opciones.cc = cc;
    MailApp.sendEmail(destinatario, asunto, cuerpo, opciones);
    registrarNotificacion_(solicitudId, 'EMAIL', destinatario, evento, 'ENVIADO', 0);
    return { enviado: true };
  } catch (err) {
    // A-12: cuota de Gmail u otro error transitorio -- se encola para
    // reintentar (Notificaciones.procesarColaCorreo, Backoffice/Triggers.gs).
    registrarNotificacion_(solicitudId, 'EMAIL', destinatario, evento, 'PENDIENTE_REINTENTO', 1);
    logError_(err, 'Notificaciones.enviarCorreo:' + evento + ':' + solicitudId);
    return { enviado: false, motivo: 'error_envio' };
  }
}
