'use strict';

/**
 * notificaciones.js — puerto de backend/intake/Notificaciones.gs +
 * backend/backoffice/Notificaciones.gs (solo el nucleo de envio real /
 * cola de reintentos / dedup / plantilla HTML branded; el digest de
 * Jefatura, las alertas de patron y las notificaciones de validacion del
 * solicitante quedan para cuando se porten los modulos que las disparan).
 *
 * Envio real via Resend (backend/logica/resend.js), HTTP puro con fetch
 * nativo, sin SDK.
 *
 * Diferencia deliberada de diseno respecto del .gs (documentada, no
 * fingida): alla casi todo se intentaba enviar EN el momento, bloqueando la
 * peticion en MailApp.sendEmail -- salvo notificarCambioEstado (Fase 10.2),
 * la unica que se encolaba a proposito por ser la mas frecuente y la mas
 * lenta en la practica. Aqui se replica ESE MISMO contrato funcion por
 * funcion (no se homogeniza todo a "siempre cola"): las funciones que en
 * el .gs enviaban sincrono siguen intentando un envio real de inmediato
 * (ahora con `await`, porque en Node la red es async); notificarCambioEstado
 * se sigue encolando sin intentar nada, igual que antes.
 *
 * RN-026 (dedup): no se reenvia el mismo evento a la misma solicitud/
 * destinatario dentro de una ventana de 30 minutos. No estaba portado antes
 * de este turno (el modulo 3 solo encolaba, nunca reenviaba de verdad, asi
 * que la regla no tenia nada que evitar todavia).
 *
 * A-12 (cola de reintentos): las filas PENDIENTE_REINTENTO (fallo de Resend,
 * o RESEND_API_KEY todavia sin configurar) se reintentan hasta
 * MAX_REINTENTOS_CORREO veces. No hay Triggers.gs en Node -- lo dispara un
 * setInterval en server/index.js, misma cadencia (5 min) que ya usaba
 * procesarColaCorreoTrigger.
 */

const crypto = require('node:crypto');
const { agregarFila_, leerFilas_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { EMAIL_DESARROLLO } = require('./constantesSolicitudes');
const Resend = require('./resend');

const VENTANA_DEDUP_MINUTOS = 30;
const MAX_REINTENTOS_CORREO = 3;
const REMITENTE_POR_DEFECTO = 'SIGSO — Control y Gestión Empresarial <notificaciones@ctrly.cl>';

function remitente_() {
  return process.env.RESEND_FROM || REMITENTE_POR_DEFECTO;
}

// RN-026: solo cuenta como "ya notificado" lo que de verdad se envio
// (ENVIADO) -- una fila PENDIENTE_REINTENTO no debe bloquear el reintento.
function yaNotificadoRecientemente_(db, solicitudId, evento, destinatario) {
  const ahora = Date.now();
  return leerFilas_(db, 'LOG_NOTIFICACIONES', COLUMNAS.LOG_NOTIFICACIONES).some((fila) => {
    if (
      fila.solicitud_id !== solicitudId || fila.evento !== evento ||
      fila.destinatario !== destinatario || fila.resultado !== 'ENVIADO'
    ) {
      return false;
    }
    const minutosTranscurridos = (ahora - new Date(fila.timestamp).getTime()) / 60000;
    return minutosTranscurridos < VENTANA_DEDUP_MINUTOS;
  });
}

function pieCorreo_() {
  return '\n\n' +
    '--------------------------------------------------\n' +
    'Este es un mensaje automatico del sistema SIGSO.\n' +
    'Por favor no responda directamente a este correo.\n' +
    'Equipo SIGSO — Control y Gestión Empresarial';
}

function escaparHtmlCorreo_(valor) {
  return String(valor === undefined || valor === null ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Plantilla "corporativo sobrio" del .gs (v7.6), portada UNA sola vez (en
// Apps Script estaba duplicada entre backend/intake y backend/backoffice por
// ser proyectos separados; aqui no hay esa restriccion, asi que hay un solo
// dueño). Estilos inline: los clientes de correo ignoran <style>/CSS externo.
function plantillaCorreoHtml_(titulo, cuerpoHtml) {
  return '<div style="margin:0;padding:0;background:#EEF1F6;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1F6;padding:32px 0;">' +
    '<tr><td align="center">' +
    '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #E5E7EB;font-family:Arial,Helvetica,sans-serif;">' +
    '<tr><td style="background:#14213D;padding:22px 28px;">' +
    '<table cellpadding="0" cellspacing="0" role="presentation"><tr>' +
    '<td style="width:34px;height:34px;background:#ffffff;text-align:center;vertical-align:middle;font-family:Georgia,\'Times New Roman\',serif;font-weight:bold;font-size:17px;color:#14213D;">S</td>' +
    '<td style="padding-left:12px;vertical-align:middle;">' +
    '<div style="color:#ffffff;font-family:Georgia,\'Times New Roman\',serif;font-size:19px;font-weight:bold;letter-spacing:0.3px;">SIGSO</div>' +
    '<div style="color:#AEB8CC;font-size:11px;letter-spacing:0.3px;">Sistema de Gestión de Solicitudes</div>' +
    '</td></tr></table>' +
    '</td></tr>' +
    '<tr><td style="padding:14px 28px;background:#F8FAFC;border-bottom:1px solid #E5E7EB;">' +
    '<span style="display:inline-block;width:3px;height:12px;background:#14213D;margin-right:8px;"></span>' +
    '<span style="font-size:12px;font-weight:bold;letter-spacing:0.8px;color:#374151;text-transform:uppercase;">' + escaparHtmlCorreo_(titulo) + '</span>' +
    '</td></tr>' +
    '<tr><td style="padding:26px 28px;color:#1F2937;font-size:15px;line-height:1.6;">' +
    cuerpoHtml +
    '</td></tr>' +
    '<tr><td style="padding:16px 28px;background:#F8FAFC;border-top:1px solid #E5E7EB;color:#6B7280;font-size:12px;line-height:1.6;">' +
    'Mensaje automático del sistema SIGSO. Por favor no respondas directamente a este correo.<br>' +
    'Equipo SIGSO — Control y Gestión Empresarial' +
    '</td></tr>' +
    '</table></td></tr></table></div>';
}

// Convierte el cuerpo de texto plano (el que ya compone cada metodo de este
// archivo) en el HTML branded, sin reescribir cada correo a mano. Corta el
// pie de texto plano (pieCorreo_) porque la plantilla ya pone su propio pie
// institucional -- mismo criterio que el .gs, para no duplicarlo.
function htmlAutoDesdeTexto_(asunto, textoPlano) {
  let texto = String(textoPlano || '');
  const corte = texto.indexOf('\n--------------------------------------------------');
  if (corte !== -1) texto = texto.slice(0, corte);
  const cuerpoHtml = '<p style="margin:0;">' + escaparHtmlCorreo_(texto.trim()).replace(/\n/g, '<br>') + '</p>';
  const titulo = String(asunto || 'Notificación').replace(/^SIGSO\s*[—-]\s*/, '').trim() || 'Notificación';
  return plantillaCorreoHtml_(titulo, cuerpoHtml);
}

function registrar_(db, { solicitudId, destinatario, evento, resultado, reintentos, asunto, cuerpo }) {
  agregarFila_(db, 'LOG_NOTIFICACIONES', {
    log_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    solicitud_id: solicitudId,
    canal: 'EMAIL',
    destinatario: destinatario,
    evento: evento,
    resultado: resultado,
    reintentos: reintentos || 0,
    asunto: asunto || '',
    cuerpo: cuerpo || ''
  });
}

// Mismo contrato que enviarCorreo_ en backend/intake/Notificaciones.gs:
// intenta un envio real de inmediato; si Resend responde bien, ENVIADO; si
// falla (cuota, dominio, o la API key todavia no esta configurada),
// PENDIENTE_REINTENTO, para que procesarColaCorreo lo reintente despues.
async function enviarCorreo_(db, { solicitudId, destinatario, evento, asunto, cuerpo, cc }) {
  if (!destinatario) return { enviado: false, motivo: 'sin_destinatario' };
  if (yaNotificadoRecientemente_(db, solicitudId, evento, destinatario)) {
    return { enviado: false, motivo: 'deduplicado' };
  }
  try {
    await Resend.enviarCorreoResend_({
      from: remitente_(),
      to: [destinatario],
      cc: cc ? [cc] : undefined,
      subject: asunto,
      html: htmlAutoDesdeTexto_(asunto, cuerpo),
      text: cuerpo
    });
    registrar_(db, { solicitudId, destinatario, evento, resultado: 'ENVIADO', reintentos: 0, asunto, cuerpo });
    return { enviado: true };
  } catch (err) {
    registrar_(db, { solicitudId, destinatario, evento, resultado: 'PENDIENTE_REINTENTO', reintentos: 1, asunto, cuerpo });
    return { enviado: false, motivo: 'error_envio' };
  }
}

// Fase 10.2 (backend/backoffice/Notificaciones.gs): se encola directo, SIN
// intentar un envio inmediato -- la optimizacion real que ya traia el .gs
// para el correo mas frecuente del sistema. procesarColaCorreo lo entrega
// despues.
function encolarCorreo_(db, { solicitudId, destinatario, evento, asunto, cuerpo }) {
  if (!destinatario) return { enviado: false, motivo: 'sin_destinatario' };
  if (yaNotificadoRecientemente_(db, solicitudId, evento, destinatario)) {
    return { enviado: false, motivo: 'deduplicado' };
  }
  registrar_(db, { solicitudId, destinatario, evento, resultado: 'PENDIENTE_REINTENTO', reintentos: 0, asunto, cuerpo });
  return { encolado: true };
}

async function enviarAcuseRecibo(db, solicitud) {
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
    'RESUMEN\n' + solicitud.resumen_whatsapp +
    pieCorreo_();

  return enviarCorreo_(db, {
    solicitudId: solicitud.solicitud_id, destinatario: solicitud.solicitante_email,
    evento: 'ACUSE_RECIBO', asunto, cuerpo, cc: solicitud.cc
  });
}

async function enviarAvisoDesarrollo(db, solicitud, motivo, destinatario) {
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
    'RESUMEN\n' + solicitud.resumen_whatsapp +
    pieCorreo_();
  return enviarCorreo_(db, { solicitudId: solicitud.solicitud_id, destinatario: email, evento: 'AVISO_DESARROLLO', asunto, cuerpo });
}

async function avisarAtencionDirectaRegistrada(db, solicitud, atencion, destinatario) {
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
    'Si algo de este registro no es exacto, puede corregirlo desde el Backoffice.' +
    pieCorreo_();
  return enviarCorreo_(db, { solicitudId: solicitud.solicitud_id, destinatario: email, evento: 'ATENCION_DIRECTA', asunto, cuerpo });
}

// Fase 10.2: sigue encolando directo (sin intentar un envio inmediato),
// ahora con dedup (RN-026) que antes no aplicaba aqui.
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
    'Puede revisar el detalle completo en la página de Consultar Estado del sistema.' +
    pieCorreo_();
  const evento = 'CAMBIO_ESTADO:' + subsolicitudId + ':' + estadoNuevo;
  const resultado = encolarCorreo_(db, { solicitudId, destinatario: solicitud.solicitante_email, evento, asunto, cuerpo });
  return resultado.encolado ? { encolado: true } : resultado;
}

async function avisarCompromisoFecha(db, solicitud, subsolicitud, fechaComprometida) {
  if (!solicitud.solicitante_email) return { enviado: false, motivo: 'sin_destinatario' };
  const asunto = 'SIGSO — Fecha comprometida para su solicitud ' + solicitud.solicitud_id;
  const cuerpo =
    'Estimado/a ' + (solicitud.solicitante_nombre || '') + ':\n\n' +
    'Le informamos que el equipo responsable ha comprometido una fecha de entrega para el siguiente ítem de su solicitud:\n\n' +
    'DETALLE\n- Ítem: ' + subsolicitud.subsolicitud_id + ' — ' + subsolicitud.titulo +
    '\n- Solicitud: ' + solicitud.solicitud_id +
    '\n- Fecha comprometida de entrega: ' + String(fechaComprometida).replace('T', ' ') + '\n\n' +
    'Le avisaremos cuando el trabajo esté terminado para su validación.' +
    pieCorreo_();
  return enviarCorreo_(db, { solicitudId: solicitud.solicitud_id, destinatario: solicitud.solicitante_email, evento: 'COMPROMISO_FECHA', asunto, cuerpo });
}

// derivadas: array de { solicitud_id, ... } ya escritas (aplicarDerivacion_).
// Un solo correo agrupado al nuevo responsable, no uno por solicitud.
async function notificarDerivacion(db, derivadas, responsableNuevo, motivo, usuario) {
  if (!responsableNuevo || !derivadas.length) return { enviado: false, motivo: 'sin_destinatario' };
  const ids = derivadas.map((d) => d.solicitud_id);
  const asunto = 'SIGSO - Se ha derivado trabajo a tu bandeja (' + ids.length + (ids.length === 1 ? ' solicitud' : ' solicitudes') + ')';
  const cuerpo = 'Se ha derivado a tu bandeja: ' + ids.join(', ') + '.\nMotivo: ' + motivo + '\nDerivado por: ' + usuario + pieCorreo_();
  return enviarCorreo_(db, { solicitudId: ids[0], destinatario: responsableNuevo, evento: 'DERIVACION', asunto, cuerpo });
}

// A-12: reintenta filas PENDIENTE_REINTENTO (fallo transitorio de Resend, o
// RESEND_API_KEY todavia sin configurar), hasta MAX_REINTENTOS_CORREO veces.
async function procesarColaCorreo(db) {
  const pendientes = leerFilas_(db, 'LOG_NOTIFICACIONES', COLUMNAS.LOG_NOTIFICACIONES)
    .filter((n) => n.resultado === 'PENDIENTE_REINTENTO' && Number(n.reintentos) < MAX_REINTENTOS_CORREO);

  const resultados = [];
  for (const n of pendientes) {
    try {
      const asunto = n.asunto || ('[Reintento] ' + n.evento);
      const cuerpo = n.cuerpo || ('Reintento de notificación para ' + n.solicitud_id);
      await Resend.enviarCorreoResend_({
        from: remitente_(),
        to: [n.destinatario],
        subject: asunto,
        html: htmlAutoDesdeTexto_(asunto, cuerpo),
        text: cuerpo
      });
      actualizarFilaPorId_(db, 'LOG_NOTIFICACIONES', 'log_id', n.log_id, { resultado: 'ENVIADO' });
      resultados.push({ log_id: n.log_id, resultado: 'ENVIADO' });
    } catch (err) {
      const reintentos = Number(n.reintentos) + 1;
      actualizarFilaPorId_(db, 'LOG_NOTIFICACIONES', 'log_id', n.log_id, {
        reintentos: reintentos,
        resultado: reintentos >= MAX_REINTENTOS_CORREO ? 'FALLIDO' : 'PENDIENTE_REINTENTO'
      });
      resultados.push({ log_id: n.log_id, resultado: 'ERROR' });
    }
  }
  return resultados;
}

// RF-019: vista de logs de automatizaciones. Solo Admin, mas recientes primero.
function listarLogs(db, data, contexto) {
  if (!contexto || contexto.rol !== 'ADM') {
    return { _forbidden: true, message: 'Solo un Administrador puede ver los logs de automatizaciones.' };
  }
  const limite = (data && data.limite) ? Number(data.limite) : 100;
  return leerFilas_(db, 'LOG_NOTIFICACIONES', COLUMNAS.LOG_NOTIFICACIONES)
    .slice()
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limite);
}

module.exports = {
  enviarAcuseRecibo, enviarAvisoDesarrollo, avisarAtencionDirectaRegistrada,
  notificarCambioEstado, avisarCompromisoFecha, notificarDerivacion,
  procesarColaCorreo, listarLogs,
  MAX_REINTENTOS_CORREO
};
