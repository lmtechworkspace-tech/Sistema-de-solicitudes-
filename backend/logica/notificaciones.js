'use strict';

/**
 * notificaciones.js — puerto de backend/intake/Notificaciones.gs +
 * backend/backoffice/Notificaciones.gs (el nucleo de envio real / cola de
 * reintentos / dedup / plantilla HTML branded, el digest diario de
 * Jefatura y las alertas de patron; los demas digests -- Actividades,
 * Proyectos -- quedan para cuando se porten los modulos que los disparan).
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
const { claveDia_ } = require('./utils');
const Jefatura = require('./jefatura');
const Dashboard = require('./dashboard');

const VENTANA_DEDUP_MINUTOS = 30;
// v4.2: "SLA vencido"/digests diarios notifican como mucho 1 vez/dia -- se
// aproxima con una ventana deslizante de 24h (mas simple que anclar al dia
// calendario de Chile, y cumple igual la intencion de no saturar de correos).
const VENTANA_DEDUP_DIARIA_MINUTOS = 24 * 60;
const MAX_REINTENTOS_CORREO = 3;
const REMITENTE_POR_DEFECTO = 'SIGSO — Control y Gestión Empresarial <notificaciones@ctrly.cl>';

function remitente_() {
  return process.env.RESEND_FROM || REMITENTE_POR_DEFECTO;
}

// RN-026: solo cuenta como "ya notificado" lo que de verdad se envio
// (ENVIADO) -- una fila PENDIENTE_REINTENTO no debe bloquear el reintento.
// ventanaMinutos es inyectable (igual que en backend/backoffice/Notificaciones.gs):
// los digests diarios usan una ventana de 24h en vez de los 30 min por defecto.
function yaNotificadoRecientemente_(db, solicitudId, evento, destinatario, ventanaMinutos) {
  const ventana = ventanaMinutos || VENTANA_DEDUP_MINUTOS;
  const ahora = Date.now();
  return leerFilas_(db, 'LOG_NOTIFICACIONES', COLUMNAS.LOG_NOTIFICACIONES).some((fila) => {
    if (
      fila.solicitud_id !== solicitudId || fila.evento !== evento ||
      fila.destinatario !== destinatario || fila.resultado !== 'ENVIADO'
    ) {
      return false;
    }
    const minutosTranscurridos = (ahora - new Date(fila.timestamp).getTime()) / 60000;
    return minutosTranscurridos < ventana;
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
async function enviarCorreo_(db, { solicitudId, destinatario, evento, asunto, cuerpo, cc, ventanaMinutos }) {
  if (!destinatario) return { enviado: false, motivo: 'sin_destinatario' };
  if (yaNotificadoRecientemente_(db, solicitudId, evento, destinatario, ventanaMinutos)) {
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

// v3.0 (Fase 3, "Mis solicitudes", §4): codigo de un solo uso para ver la
// lista de solicitudes propias. El evento incluye el codigo (no solo el
// correo) para que dos pedidos seguidos del mismo correo no deduplique el
// segundo -- cada codigo es distinto, cada uno debe llegar.
async function enviarCodigoAcceso(db, email, codigo) {
  const asunto = 'SIGSO — Código de acceso a Mis solicitudes: ' + codigo;
  const cuerpo =
    'Estimado/a:\n\n' +
    'Ha solicitado acceder a la vista "Mis solicitudes" del sistema SIGSO. ' +
    'Su código de verificación es:\n\n' +
    '    ' + codigo + '\n\n' +
    'El código es válido por 10 minutos y de un solo uso. Si usted no lo ' +
    'solicitó, puede ignorar este correo con tranquilidad.' +
    pieCorreo_();
  return enviarCorreo_(db, { solicitudId: email, destinatario: email, evento: 'CODIGO_ACCESO:' + codigo, asunto, cuerpo });
}

// RN-201 (v2.0, Sprint 1): avisa al responsable del item cuando el
// solicitante valida un item "Terminada" -- confirmando el cierre,
// reabriendolo con un motivo, o cerrandolo directo (atencion directa desde
// "Mis solicitudes"). Sin este aviso, el equipo no se entera hasta que
// vuelve a mirar el panel.
async function notificarValidacionSolicitante(db, solicitud, subsolicitud, accion, destinatario) {
  const email = destinatario || EMAIL_DESARROLLO;
  const esConfirmacion = accion === 'confirmar';
  const esCierreDirecto = accion === 'cerrar_directo';
  const asunto = 'SIGSO - ' + (esCierreDirecto
    ? 'Cerrado por atención directa'
    : (esConfirmacion ? 'Cierre confirmado' : 'Ítem reabierto por el solicitante')) +
    ': ' + subsolicitud.subsolicitud_id;
  const cuerpo =
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
  return enviarCorreo_(db, {
    solicitudId: solicitud.solicitud_id, destinatario: email,
    evento: 'VALIDACION_SOLICITANTE:' + subsolicitud.subsolicitud_id + ':' + accion, asunto, cuerpo
  });
}

// P5 (v2.0, Sprint 3): avisa al responsable cuando el solicitante responde
// una pregunta ("esperando informacion", S06). destinatarios es un array
// (uno por cada responsable distinto involucrado); si viene vacio, cae al
// buzon por defecto EMAIL_DESARROLLO (retrocompatible).
async function notificarRespuestaSolicitante(db, solicitud, subsolicitudId, texto, destinatarios) {
  const emails = (destinatarios && destinatarios.length > 0) ? destinatarios : [EMAIL_DESARROLLO];
  const asunto = 'SIGSO - Respuesta del solicitante: ' + (subsolicitudId || solicitud.solicitud_id);
  const cuerpo =
    'Estimado/a:\n\n' +
    'El solicitante ha respondido a la información pendiente de la solicitud ' +
    solicitud.solicitud_id + (subsolicitudId ? ' (ítem ' + subsolicitudId + ')' : '') + '.\n\n' +
    'RESPUESTA DEL SOLICITANTE\n' +
    '"' + texto + '"\n\n' +
    'ACCIÓN REQUERIDA\n' +
    'Ingrese al Backoffice para revisar la respuesta y continuar con la gestión ' +
    'del ítem (sigue en estado "Esperando información" hasta que usted lo avance).' +
    pieCorreo_();
  const resultados = [];
  for (const email of emails) {
    resultados.push(await enviarCorreo_(db, {
      solicitudId: solicitud.solicitud_id, destinatario: email,
      evento: 'RESPUESTA_SOLICITANTE:' + (subsolicitudId || solicitud.solicitud_id), asunto, cuerpo
    }));
  }
  return resultados;
}

// v4.2 (§4): formatea la lista compacta de items (hoy.nuevas/cerradas/...
// de Jefatura.getPanel) para el cuerpo de texto plano del digest.
function listarItems_(items) {
  return items.map((i) => '- ' + i.solicitud_id + '-' + i.numero_item + ' — ' + i.titulo +
    ' (' + i.solicitante_nombre + ', ' + i.semaforo + ')').join('\n');
}

// v4.2 (§4, "al finalizar el dia poder ver que ocurrio en su departamento"):
// un correo por jefe activo, con el mismo resumen "hoy" que ya ve en su
// panel (Jefatura.getPanel, ya portado). No manda nada si el jefe no tiene
// equipo o si hoy no paso nada de relevancia -- un digest siempre vacio
// entrena a la gente a ignorarlo. Sin Triggers.gs en Node, quien la dispara
// es server/index.js (una vez al dia, ~18:00 America/Santiago); el dedup
// diario (VENTANA_DEDUP_DIARIA_MINUTOS + claveDia_ en el evento) hace que
// llamarla de mas no reenvie nada.
async function enviarDigestJefatura(db) {
  const jefes = {};
  leerFilas_(db, 'JEFATURAS', COLUMNAS.JEFATURAS).forEach((j) => {
    const activo = j.activo === true || j.activo === 'TRUE' || j.activo === 1;
    if (activo) jefes[j.jefe_email] = true;
  });

  const resultados = [];
  for (const jefeEmail of Object.keys(jefes)) {
    const panel = Jefatura.getPanel(db, {}, { email: jefeEmail, rol: 'JEFATURA' });
    const r = panel.hoy.resumen;
    const huboAlgo = r.nuevas > 0 || r.avanzaron > 0 || r.cerradas > 0 || r.en_riesgo > 0 || r.requieren_accion > 0;
    if (!huboAlgo) {
      resultados.push({ jefe: jefeEmail, enviado: false, motivo: 'sin_novedades' });
      continue;
    }
    const asunto = 'SIGSO — Hoy en tu departamento (' + r.nuevas + ' nuevas, ' + r.cerradas + ' cerradas)';
    const cuerpo =
      'Resumen del día en tu departamento:\n\n' +
      '- Nuevas solicitudes: ' + r.nuevas + '\n' +
      '- Avanzaron de estado: ' + r.avanzaron + '\n' +
      '- Se cerraron: ' + r.cerradas + '\n' +
      '- En riesgo o vencidas: ' + r.en_riesgo + '\n' +
      '- Esperan validación de tu equipo: ' + r.requieren_accion + '\n\n' +
      (panel.hoy.nuevas.length ? 'NUEVAS\n' + listarItems_(panel.hoy.nuevas) + '\n\n' : '') +
      (panel.hoy.cerradas.length ? 'CERRADAS HOY\n' + listarItems_(panel.hoy.cerradas) + '\n\n' : '') +
      (panel.hoy.en_riesgo_o_vencidas.length ? 'EN RIESGO O VENCIDAS\n' + listarItems_(panel.hoy.en_riesgo_o_vencidas) + '\n\n' : '') +
      (panel.hoy.requieren_accion.length ? 'ESPERANDO VALIDACIÓN DE TU EQUIPO\n' + listarItems_(panel.hoy.requieren_accion) + '\n\n' : '') +
      'Puedes ver el detalle completo en tu Panel de Jefatura.' +
      pieCorreo_();
    const claveEvento = 'DIGEST_JEFATURA:' + claveDia_(new Date(), 'America/Santiago');
    const resultado = await enviarCorreo_(db, {
      solicitudId: 'DIGEST_JEFATURA', destinatario: jefeEmail, evento: claveEvento, asunto, cuerpo,
      ventanaMinutos: VENTANA_DEDUP_DIARIA_MINUTOS
    });
    resultados.push(Object.assign({ jefe: jefeEmail }, resultado));
  }
  return resultados;
}

// P7 (v2.0, Sprint 3): avisa a Gerencia/Admin cuando un (modulo, tipo)
// supera el umbral de patron (Dashboard.calcularAlertasPatron_, ya
// portado). No usa un solicitud_id real (es un aviso agregado, no de una
// solicitud puntual) -- el "solicitud_id" del log es un tag descriptivo.
async function notificarPatron(db, alerta) {
  const destinatarios = leerFilas_(db, 'USUARIOS', COLUMNAS.USUARIOS)
    .filter((u) => {
      const activo = u.activo === true || u.activo === 'TRUE' || u.activo === 1;
      return activo && (u.rol === 'GERENCIA' || u.rol === 'ADM');
    })
    .map((u) => u.email);
  const asunto = 'SIGSO - Patron detectado: ' + alerta.modulo + ' / ' + alerta.tipo;
  const cuerpo =
    'El modulo "' + alerta.modulo + '" acumula ' + alerta.cantidad + ' reportes de tipo "' + alerta.tipo +
    '" en los ultimos ' + Dashboard.PATRON_VENTANA_DIAS + ' dias, de ' + alerta.solicitantes_distintos +
    ' solicitantes distintos.\n\nPosible causa raiz -- no lo trates como casos aislados.';
  const resultados = [];
  for (const email of destinatarios) {
    resultados.push(await enviarCorreo_(db, {
      solicitudId: 'PATRON:' + alerta.modulo + ':' + alerta.tipo, destinatario: email,
      evento: 'ALERTA_PATRON:' + alerta.modulo + ':' + alerta.tipo, asunto, cuerpo
    }));
  }
  return resultados;
}

// P7: recorre las alertas de patron vigentes (Dashboard.calcularAlertasPatron_,
// mismo umbral que se muestra en el Dashboard) y avisa por correo las que no
// se hayan avisado ya HOY (dedup via LOG_SISTEMA, contexto ALERTA_PATRON,
// ref = modulo||tipo) -- evita mandar el mismo aviso cada dia mientras el
// patron siga activo sin que nadie lo resuelva. Equivalente de
// Triggers.detectarPatrones; disparada por server/index.js (09:00
// America/Santiago, mismo horario que el .gs).
async function detectarPatrones(db) {
  const hoy = claveDia_(new Date(), 'America/Santiago');
  const yaAvisadosHoy = {};
  leerFilas_(db, 'LOG_SISTEMA', COLUMNAS.LOG_SISTEMA).forEach((log) => {
    if (log.contexto === 'ALERTA_PATRON' && claveDia_(new Date(log.timestamp), 'America/Santiago') === hoy) {
      yaAvisadosHoy[log.ref] = true;
    }
  });

  const avisados = [];
  for (const alerta of Dashboard.calcularAlertasPatron_(db)) {
    const clave = alerta.modulo + '||' + alerta.tipo;
    if (yaAvisadosHoy[clave]) continue;
    await notificarPatron(db, alerta);
    agregarFila_(db, 'LOG_SISTEMA', {
      log_id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      contexto: 'ALERTA_PATRON',
      mensaje: alerta.modulo + ' acumula ' + alerta.cantidad + ' reportes de tipo ' + alerta.tipo +
        ' (' + alerta.solicitantes_distintos + ' solicitantes distintos) en los ultimos ' + Dashboard.PATRON_VENTANA_DIAS + ' dias.',
      ref: clave
    });
    avisados.push(clave);
  }
  return { avisados: avisados.length, patrones: avisados };
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

// Envio de correo generico para otros modulos (Novedades, etc.): mismo
// transporte/dedup/cola que el resto, sin componer un texto especifico
// aqui. El HTML branded lo genera htmlAutoDesdeTexto_ a partir del cuerpo
// de texto plano -- se prefiere sobre portar el HTML hecho a mano de cada
// correo del .gs (mismo criterio de "no re-portar cada plantilla": el
// correo sale igual de branded, generado desde el texto).
function enviarCorreoModulo(db, opciones) {
  return enviarCorreo_(db, opciones);
}

module.exports = {
  enviarAcuseRecibo, enviarAvisoDesarrollo, avisarAtencionDirectaRegistrada,
  notificarCambioEstado, avisarCompromisoFecha, notificarDerivacion, enviarCodigoAcceso,
  notificarValidacionSolicitante, notificarRespuestaSolicitante, enviarDigestJefatura,
  notificarPatron, detectarPatrones, enviarCorreoModulo,
  procesarColaCorreo, listarLogs,
  MAX_REINTENTOS_CORREO
};
