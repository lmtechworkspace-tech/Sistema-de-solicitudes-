'use strict';

/**
 * notificaciones.js — puerto PARCIAL de backend/intake/Notificaciones.gs.
 *
 * Se porta la COMPOSICION de los correos (mismo asunto, mismo texto, mismas
 * reglas de redaccion -- p.ej. una atencion directa dice "queda cerrada",
 * nunca "sera revisada"). El ENVIO real via Resend todavia NO esta portado
 * (pendiente en sigso-ecosistema-nuevo.md): cada llamada queda encolada en
 * LOG_NOTIFICACIONES con resultado 'PENDIENTE_ENVIO_REAL' y el asunto/cuerpo
 * completos guardados -- son las MISMAS columnas que ya usaba
 * procesarColaCorreo en el .gs para reintentar envios, asi que la
 * integracion de Resend, cuando se construya, solo tiene que leer esta cola
 * y enviar, sin tocar esta capa de composicion.
 *
 * No se porta yaNotificadoRecientemente_ (dedup por envio reciente, ni el
 * pie de correo/enlace de seguimiento con SITIO_PUBLICO_CORREOS): esa
 * proteccion de cuota y ese enlace no tienen sentido todavia sin un envio
 * real que proteger o un sitio publico Node al que apuntar.
 */

const crypto = require('node:crypto');
const { agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { EMAIL_DESARROLLO } = require('./constantesSolicitudes');

function registrar(db, { solicitudId, destinatario, evento, asunto, cuerpo }) {
  if (!destinatario) return { enviado: false, motivo: 'sin_destinatario' };
  agregarFila_(db, 'LOG_NOTIFICACIONES', {
    log_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    solicitud_id: solicitudId,
    canal: 'EMAIL',
    destinatario: destinatario,
    evento: evento,
    resultado: 'PENDIENTE_ENVIO_REAL',
    reintentos: 0,
    asunto: asunto,
    cuerpo: cuerpo
  });
  return { enviado: false, motivo: 'envio_real_pendiente' };
}

function enviarAcuseRecibo(db, solicitud) {
  const asunto = 'SIGSO — Confirmación de recepción de su solicitud ' + solicitud.solicitud_id;
  const lineasDetalle = [
    '- N° de solicitud: ' + solicitud.solicitud_id,
    solicitud.empresa_id ? '- Empresa: ' + solicitud.empresa_id : '',
    solicitud.prioridad ? '- Prioridad inicial: ' + solicitud.prioridad : '',
    solicitud.total_items ? '- Ítems registrados: ' + solicitud.total_items : ''
  ].filter((l) => l !== '');

  const cuerpo =
    'Estimado/a ' + solicitud.solicitante_nombre + ':\n\n' +
    (solicitud.atencion_directa
      ? 'Confirmamos el registro de su solicitud, que ya fue resuelta mediante ' +
        'atención directa. Queda cerrada en el Sistema de Gestión de Solicitudes ' +
        '(SIGSO) como respaldo de lo ocurrido; no requiere ninguna acción adicional.\n\n'
      : 'Confirmamos la recepción de su solicitud, la cual ha sido registrada ' +
        'correctamente en el Sistema de Gestión de Solicitudes (SIGSO) y derivada ' +
        'al equipo responsable para su revisión.\n\n') +
    'DETALLE DE LA SOLICITUD\n' + lineasDetalle.join('\n') + '\n\n' +
    'RESUMEN\n' + solicitud.resumen_whatsapp;

  return registrar(db, { solicitudId: solicitud.solicitud_id, destinatario: solicitud.solicitante_email, evento: 'ACUSE_RECIBO', asunto, cuerpo });
}

function enviarAvisoDesarrollo(db, solicitud, motivo, destinatario) {
  const email = destinatario || EMAIL_DESARROLLO;
  const asunto = 'SIGSO - ' + (solicitud.prioridad === 'P1' ? 'ALERTA P1: ' : 'Nueva solicitud asignada: ') + solicitud.solicitud_id;
  const cuerpo =
    'Estimado/a:\n\n' +
    'Se ha registrado una nueva solicitud dirigida a su bandeja de trabajo.\n\n' +
    'DETALLE\n' +
    '- N° de solicitud: ' + solicitud.solicitud_id + '\n' +
    '- Prioridad: ' + (solicitud.prioridad || 'por definir') + '\n' +
    '- Motivo del aviso: ' + (motivo || 'nueva solicitud') + '\n\n' +
    'ACCIÓN REQUERIDA\n' +
    'Ingrese al Backoffice para revisarla, comprometer una fecha de entrega y gestionar su avance.\n\n' +
    'RESUMEN\n' + solicitud.resumen_whatsapp;
  return registrar(db, { solicitudId: solicitud.solicitud_id, destinatario: email, evento: 'AVISO_DESARROLLO', asunto, cuerpo });
}

function avisarAtencionDirectaRegistrada(db, solicitud, atencion, destinatario) {
  const email = destinatario || EMAIL_DESARROLLO;
  const asunto = 'SIGSO — Registro de atención directa: ' + solicitud.solicitud_id;
  const cuerpo =
    'Estimado/a:\n\n' +
    'Se dejó registro en SIGSO de una solicitud que ya fue resuelta fuera del ' +
    'flujo normal (atención directa). No requiere ninguna acción de su parte: queda cerrada.\n\n' +
    'DETALLE\n' +
    '- N° de solicitud: ' + solicitud.solicitud_id + '\n' +
    '- Ítems registrados: ' + (solicitud.total_items || 1) + '\n' +
    '- Registrada por: ' + (solicitud.solicitante_nombre || '') + '\n' +
    '- Resuelta por: ' + atencion.resuelto_por + '\n' +
    '- Fecha de resolución: ' + String(atencion.fecha_resolucion).replace('T', ' ') + '\n\n' +
    'QUÉ SE HIZO\n' + atencion.detalle + '\n\n' +
    'Si algo de este registro no es exacto, puede corregirlo desde el Backoffice.';
  return registrar(db, { solicitudId: solicitud.solicitud_id, destinatario: email, evento: 'ATENCION_DIRECTA', asunto, cuerpo });
}

// --- Backoffice (backend/backoffice/Notificaciones.gs) --------------------
// Version simplificada a proposito: el .gs compone HTML branded + adjunta
// la Orden de Trabajo en PDF (derivarSolicitud) -- ninguna de las dos cosas
// esta portada todavia (generacion de PDF es su propio modulo, Documentos.gs,
// no tocado). Aqui se deja la MISMA cola/contrato que enviarAcuseRecibo
// (para que Resend, cuando se porte, procese todo desde un solo lugar), con
// texto simple en vez del HTML branded.

// Mismo signature que el .gs: resuelve la solicitud (y su solicitante_email)
// por su cuenta, el llamador (actualizarEstado) no necesita saber a quien.
function notificarCambioEstado(db, solicitudId, subsolicitudId, estadoAnterior, estadoNuevo) {
  const solicitud = leerFilas_(db, 'SOLICITUDES', COLUMNAS.SOLICITUDES).find((s) => s.solicitud_id === solicitudId);
  if (!solicitud) return { enviado: false, motivo: 'solicitud_no_encontrada' };
  if (!solicitud.solicitante_email) return { enviado: false, motivo: 'sin_destinatario' };
  const asunto = 'SIGSO — Actualización de su solicitud ' + solicitudId;
  const cuerpo =
    'Estimado/a ' + (solicitud.solicitante_nombre || '') + ':\n\n' +
    'Le informamos que su solicitud ha registrado un cambio de estado en el sistema.\n\n' +
    'DETALLE\n- N° de solicitud: ' + solicitudId + '\n- Estado anterior: ' + estadoAnterior +
    '\n- Estado nuevo: ' + estadoNuevo + '\n\n' +
    'Puede revisar el detalle completo en la página de Consultar Estado del sistema.';
  return registrar(db, { solicitudId, destinatario: solicitud.solicitante_email, evento: 'CAMBIO_ESTADO', asunto, cuerpo });
}

function avisarCompromisoFecha(db, solicitud, subsolicitud, fechaComprometida) {
  if (!solicitud.solicitante_email) return { enviado: false, motivo: 'sin_destinatario' };
  const asunto = 'SIGSO — Fecha comprometida para su solicitud ' + solicitud.solicitud_id;
  const cuerpo =
    'Estimado/a ' + (solicitud.solicitante_nombre || '') + ':\n\n' +
    'Le informamos que el equipo responsable ha comprometido una fecha de entrega para el siguiente ítem de su solicitud:\n\n' +
    'DETALLE\n- Ítem: ' + subsolicitud.subsolicitud_id + ' — ' + subsolicitud.titulo +
    '\n- Solicitud: ' + solicitud.solicitud_id +
    '\n- Fecha comprometida de entrega: ' + String(fechaComprometida).replace('T', ' ') + '\n\n' +
    'Le avisaremos cuando el trabajo esté terminado para su validación.';
  return registrar(db, { solicitudId: solicitud.solicitud_id, destinatario: solicitud.solicitante_email, evento: 'COMPROMISO_FECHA', asunto, cuerpo });
}

// derivadas: array de { solicitud_id, ... } ya escritas (aplicarDerivacion_).
// Un solo correo agrupado al nuevo responsable, no uno por solicitud.
function notificarDerivacion(db, derivadas, responsableNuevo, motivo, usuario) {
  if (!responsableNuevo || !derivadas.length) return { enviado: false, motivo: 'sin_destinatario' };
  const ids = derivadas.map((d) => d.solicitud_id);
  const asunto = 'SIGSO - Se ha derivado trabajo a tu bandeja (' + ids.length + (ids.length === 1 ? ' solicitud' : ' solicitudes') + ')';
  const cuerpo = 'Se ha derivado a tu bandeja: ' + ids.join(', ') + '.\nMotivo: ' + motivo + '\nDerivado por: ' + usuario;
  return registrar(db, { solicitudId: ids[0], destinatario: responsableNuevo, evento: 'DERIVACION', asunto, cuerpo });
}

module.exports = {
  enviarAcuseRecibo, enviarAvisoDesarrollo, avisarAtencionDirectaRegistrada,
  notificarCambioEstado, avisarCompromisoFecha, notificarDerivacion
};
