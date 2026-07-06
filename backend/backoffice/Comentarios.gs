/**
 * Comentarios.gs — Comentarios.agregarComentario (RF-018, §8.1 tabla de
 * roles: "Cualquier rol autenticado"). El historial de comentarios es
 * inmutable: no hay accion de editar/borrar, solo agregar.
 */

var Comentarios = {
  agregarComentario: function (data, contexto) {
    if (!data.solicitud_id) {
      return errorValidacion_('solicitud_id', 'Falta indicar la solicitud.');
    }
    if (!data.texto || String(data.texto).trim() === '') {
      return errorValidacion_('texto', 'El comentario no puede estar vacio.');
    }
    if (!buscarSolicitudPorId_(data.solicitud_id)) {
      return errorValidacion_('solicitud_id', 'No existe una solicitud con ese numero.');
    }

    var comentario = {
      comentario_id: Utilities.getUuid(),
      solicitud_id: data.solicitud_id,
      subsolicitud_id: data.subsolicitud_id || '',
      usuario: contexto.email,
      texto: data.texto,
      es_interno: !!data.es_interno,
      timestamp: new Date().toISOString()
    };

    agregarFila_(SHEETS.COMENTARIOS, comentario);
    return comentario;
  }
};
