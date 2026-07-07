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

var Notificaciones = {
  enviarAcuseRecibo: function (solicitud) {
    var asunto = 'SIGSO - Solicitud registrada: ' + solicitud.solicitud_id;
    var cuerpo =
      'Hola ' + solicitud.solicitante_nombre + ',\n\n' +
      'Tu solicitud ' + solicitud.solicitud_id + ' fue registrada correctamente.\n\n' +
      solicitud.resumen_whatsapp;
    // Fase 9: cc opcional del formulario (hallazgo real, RLD "Hoja de
    // ruta") -- se copia en el acuse, no cambia a quien va dirigido ni
    // la deduplicacion (esa sigue siendo por solicitante_email).
    return enviarCorreo_(solicitud.solicitud_id, solicitud.solicitante_email, 'ACUSE_RECIBO', asunto, cuerpo, solicitud.cc);
  },

  // Aviso al equipo de desarrollo (Leo). Reemplaza al ruteo por rol/empresa
  // anterior (que no enviaba nada si no habia un ANA/DEV registrado para esa
  // empresa): ahora hay un unico destinatario claro. El motivo (cliente /
  // pedido explicito / P1) lo decide crearSolicitud.
  enviarAvisoDesarrollo: function (solicitud, motivo) {
    var asunto = 'SIGSO - ' + (solicitud.prioridad === 'P1' ? 'ALERTA P1: ' : 'Nueva solicitud: ') + solicitud.solicitud_id;
    var cuerpo =
      'Nueva solicitud para revisar (' + (motivo || 'aviso') + '):\n\n' +
      solicitud.resumen_whatsapp;
    return enviarCorreo_(solicitud.solicitud_id, EMAIL_DESARROLLO, 'AVISO_DESARROLLO', asunto, cuerpo);
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

function enviarCorreo_(solicitudId, destinatario, evento, asunto, cuerpo, cc) {
  if (!destinatario) {
    return { enviado: false, motivo: 'sin_destinatario' };
  }
  if (yaNotificadoRecientemente_(solicitudId, evento, destinatario)) {
    return { enviado: false, motivo: 'deduplicado' };
  }
  try {
    // MailApp (no GmailApp): solo necesita el scope script.send_mail para
    // enviar, en vez del scope completo de Gmail. Soporta cc en opciones.
    MailApp.sendEmail(destinatario, asunto, cuerpo, cc ? { cc: cc } : {});
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
