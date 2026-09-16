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
const { agregarFila_ } = require('../db/sqliteRepo');
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

module.exports = { enviarAcuseRecibo, enviarAvisoDesarrollo, avisarAtencionDirectaRegistrada };
