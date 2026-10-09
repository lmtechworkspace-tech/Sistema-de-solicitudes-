'use strict';

/**
 * comentarios.js — puerto de backend/backoffice/Comentarios.gs (RF-018,
 * §8.1 tabla de roles: "Cualquier rol autenticado" salvo Gerencia, que es
 * de solo lectura -- P6, v2.0 Sprint 2). El historial de comentarios es
 * inmutable: no hay accion de editar/borrar, solo agregar.
 */

const crypto = require('node:crypto');
const { agregarFila_ } = require('../db/sqliteRepo');
const { errorValidacion, errorForbidden } = require('./errores');
const BO = require('./solicitudesBackoffice');
const Notificaciones = require('./notificaciones');

function agregarComentario(db, data, contexto) {
  if (contexto.rol === 'GERENCIA') {
    return errorForbidden('El rol Gerencia es de solo lectura: no puede comentar.');
  }
  if (!data.solicitud_id) return errorValidacion('solicitud_id', 'Falta indicar la solicitud.');
  if (!data.texto || String(data.texto).trim() === '') return errorValidacion('texto', 'El comentario no puede estar vacio.');
  const solicitud = BO.buscarSolicitudPorId_(db, data.solicitud_id);
  if (!solicitud) return errorValidacion('solicitud_id', 'No existe una solicitud con ese numero.');
  // Auditoría Codex 2026-10-08 (D-005, E2-2): escribir en la conversación es escribir.
  // Mensaje de un ítem → ese ítem debe ser de esta solicitud y poder escribirse en él.
  // Mensaje general → poder escribir en al menos un ítem de la solicitud.
  const items = BO.obtenerSubsolicitudesDeSolicitud_(db, data.solicitud_id);
  if (data.subsolicitud_id) {
    const item = items.find((i) => i.subsolicitud_id === data.subsolicitud_id);
    if (!item) return errorValidacion('subsolicitud_id', 'Ese ítem no es de esta solicitud.');
    const veto = BO.vetoFueraDeAlcance_(db, contexto, item, 'escribir en la conversación');
    if (veto) return veto;
  } else {
    const ajena = BO.solicitudAjenaParaSolicitante_(contexto, solicitud, items);
    if (ajena) return ajena;
    const vetos = items.map((i) => BO.vetoFueraDeAlcance_(db, contexto, i, 'escribir en la conversación'));
    if (items.length && vetos.every(Boolean)) return vetos[0];
  }


  const comentario = {
    comentario_id: crypto.randomUUID(),
    solicitud_id: data.solicitud_id,
    subsolicitud_id: data.subsolicitud_id || '',
    usuario: contexto.email,
    texto: data.texto,
    // Solo true de verdad (un 'false' en texto no debe volverse nota interna, ni al revés).
    es_interno: data.es_interno === true || data.es_interno === 'true' || data.es_interno === 1,
    timestamp: new Date().toISOString()
  };
  agregarFila_(db, 'COMENTARIOS', comentario);
  // 2026-10-05: un mensaje que NO es nota interna es para el solicitante: le
  // llega (correo + campana) y lo ve en Mis solicitudes. Antes se guardaba y
  // nadie del otro lado se enteraba. El aviso nunca frena el guardado.
  if (!comentario.es_interno) {
    Promise.resolve().then(() => Notificaciones.avisarMensajeEquipo(db, comentario)).catch((err) => {
      console.error('error avisando el mensaje al solicitante:', err);
    });
  }
  return comentario;
}

module.exports = { agregarComentario };
