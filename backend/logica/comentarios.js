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
const { buscarSolicitudPorId_ } = require('./solicitudesBackoffice');
const Notificaciones = require('./notificaciones');

function agregarComentario(db, data, contexto) {
  if (contexto.rol === 'GERENCIA') {
    return errorForbidden('El rol Gerencia es de solo lectura: no puede comentar.');
  }
  if (!data.solicitud_id) return errorValidacion('solicitud_id', 'Falta indicar la solicitud.');
  if (!data.texto || String(data.texto).trim() === '') return errorValidacion('texto', 'El comentario no puede estar vacio.');
  if (!buscarSolicitudPorId_(db, data.solicitud_id)) return errorValidacion('solicitud_id', 'No existe una solicitud con ese numero.');

  const comentario = {
    comentario_id: crypto.randomUUID(),
    solicitud_id: data.solicitud_id,
    subsolicitud_id: data.subsolicitud_id || '',
    usuario: contexto.email,
    texto: data.texto,
    es_interno: !!data.es_interno,
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
