/**
 * detalle.js — Backoffice: detalle de solicitud (§12.5): datos generales,
 * datos de cliente, subsolicitudes, historial, comentarios y acciones.
 *
 * Las transiciones de estado validas dependen de TRANSICIONES_VALIDAS
 * (backend, por rol y estado actual). En vez de duplicar esa tabla aqui,
 * el selector ofrece los 11 estados y el backend responde 'validation' con
 * un mensaje claro si la transicion no esta permitida -- evita que la
 * regla de negocio viva en dos lugares que puedan desalinearse.
 */
(function () {
  window.SigsoDetalle = { cargar: cargarDetalle_ };

  function cargarDetalle_(solicitudId) {
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'getSolicitudDetalle', { solicitud_id: solicitudId })
      .then(function (respuesta) {
        if (!respuesta.ok) {
          document.getElementById('detalle-contenido').innerHTML =
            '<div class="sigso-resultado-error"><p>' + escaparHtml_(respuesta.message || 'No se pudo cargar la solicitud.') + '</p></div>';
          return respuesta;
        }
        render_(respuesta.data);
        return respuesta;
      });
  }

  function render_(detalle) {
    var s = detalle.solicitud;
    var contenedor = document.getElementById('detalle-contenido');

    var archivos = detalle.archivos || [];
    // Fase 9: imagenes sin subsolicitud_id son adjuntos generales de la
    // solicitud (RF-003: se adjuntan a nivel de solicitud, Bloque 5).
    var archivosGenerales = archivos.filter(function (a) { return !a.subsolicitud_id; });

    contenedor.innerHTML =
      '<div class="sigso-card">' +
      '<h2>' + s.solicitud_id + '</h2>' +
      '<p><span class="sigso-badge sigso-badge--' + s.prioridad_derivada + '">' + s.prioridad_derivada + '</span> ' +
      formatearEstadoSigso(s.estado_derivado) + '</p>' +
      '<p>Empresa: ' + s.empresa_id + ' — Plataforma/Modulo: ' + s.plataforma + ' / ' + s.modulo + ' — Tipo: ' + s.tipo + '</p>' +
      '<p>Solicitante: ' + escaparHtml_(s.solicitante_nombre) + ' (' + escaparHtml_(s.solicitante_cargo) + ') — ' + escaparHtml_(s.solicitante_email) +
      (s.cc ? ' — CC: ' + escaparHtml_(s.cc) : '') + '</p>' +
      (s.es_cliente ? renderBloqueCliente_(s) : '') +
      (s.observaciones_generales ? '<p><em>Observaciones: ' + escaparHtml_(s.observaciones_generales) + '</em></p>' : '') +
      renderGaleria_(archivosGenerales) +
      '</div>' +
      '<div class="sigso-card"><h3>Qu&eacute; hacer (subsolicitudes)</h3>' + renderSubsolicitudes_(detalle.subsolicitudes, archivos) + '</div>' +
      '<div class="sigso-card"><h3>Historial de estados</h3>' + renderTimeline_(detalle.historial_estados) + '</div>' +
      '<div class="sigso-card"><h3>Comentarios</h3><div id="lista-comentarios">' + renderComentarios_(detalle.comentarios) + '</div>' + renderFormComentario_() + '</div>' +
      '<div class="sigso-card"><h3>Acciones</h3>' + renderAcciones_(detalle.subsolicitudes) + '</div>';

    document.getElementById('form-comentario').addEventListener('submit', function (evento) {
      evento.preventDefault();
      enviarComentario_(s.solicitud_id);
    });
    document.getElementById('form-cambiar-estado').addEventListener('submit', function (evento) {
      evento.preventDefault();
      enviarCambioEstado_(s.solicitud_id);
    });
    document.getElementById('form-cambiar-prioridad').addEventListener('submit', function (evento) {
      evento.preventDefault();
      enviarCambioPrioridad_(s.solicitud_id);
    });
  }

  function renderBloqueCliente_(s) {
    return '<div class="sigso-bloque-cliente sigso-bloque-cliente--visible">' +
      '<p><strong>Cliente:</strong> ' + escaparHtml_(s.empresa_cliente) + '</p>' +
      (s.cliente_mandante ? '<p>Mandante: ' + escaparHtml_(s.cliente_mandante) + '</p>' : '') +
      (s.cliente_obra ? '<p>Obra: ' + escaparHtml_(s.cliente_obra) + '</p>' : '') +
      '<p>Contacto: ' + escaparHtml_(s.contacto_cliente) + ' — ' + escaparHtml_(s.correo_cliente) + '</p>' +
      (s.urgencia_cliente ? '<p>Urgencia reportada: ' + escaparHtml_(s.urgencia_cliente) + '</p>' : '') +
      '</div>';
  }

  // Fase 9 (hallazgo de datos reales): el objetivo de este panel es que
  // Leo entienda, sin cruzar ninguna otra planilla ni pedir mas datos por
  // WhatsApp, exactamente donde reproducir/hacer el cambio (URLs, usuario
  // de prueba, credencial), y con que estado/prioridad esta cada item --
  // el reemplazo real de "mandar un PDF" que motivo este rediseno.
  function renderSubsolicitudes_(subsolicitudes, archivos) {
    return subsolicitudes.map(function (sub) {
      var urlsAdicionales = [];
      try {
        urlsAdicionales = JSON.parse(sub.urls_adicionales || '[]');
      } catch (err) {
        urlsAdicionales = [];
      }
      var imagenesItem = (archivos || []).filter(function (a) { return a.subsolicitud_id === sub.subsolicitud_id; });

      var datos = [];
      if (sub.url_modulo) {
        datos.push(renderCampoDato_('URL principal', '<a href="' + escaparHtml_(sub.url_modulo) + '" target="_blank" rel="noopener">' + escaparHtml_(sub.url_modulo) + '</a>'));
      }
      urlsAdicionales.forEach(function (u) {
        if (!u.url) return;
        datos.push(renderCampoDato_(u.titulo || 'URL adicional', '<a href="' + escaparHtml_(u.url) + '" target="_blank" rel="noopener">' + escaparHtml_(u.url) + '</a>'));
      });
      if (sub.usuario_prueba) {
        datos.push(renderCampoDato_('Usuario de prueba', escaparHtml_(sub.usuario_prueba)));
      }
      if (sub.ref_credencial) {
        datos.push(renderCampoDato_('Credencial', escaparHtml_(sub.ref_credencial)));
      }
      if (sub.centro_costos) {
        datos.push(renderCampoDato_('Centro de costos', escaparHtml_(sub.centro_costos)));
      }
      if (sub.desarrollador_asignado) {
        datos.push(renderCampoDato_('Asignado a', escaparHtml_(sub.desarrollador_asignado)));
      }
      if (sub.estimacion_horas) {
        datos.push(renderCampoDato_('Estimacion', sub.estimacion_horas + ' h' + (sub.horas_reales ? ' (reales: ' + sub.horas_reales + ' h)' : '')));
      }

      return '<div class="sigso-acordeon-item sigso-acordeon-item--activo">' +
        '<div class="sigso-acordeon-item__cabecera"><span>' + sub.numero_item + '. ' + escaparHtml_(sub.titulo) +
        ' — <span class="sigso-badge sigso-badge--' + sub.prioridad + '">' + sub.prioridad + '</span> — ' + formatearEstadoSigso(sub.estado) + '</span></div>' +
        '<div class="sigso-acordeon-item__cuerpo">' +
        '<p>' + escaparHtml_(sub.descripcion) + '</p>' +
        (sub.contexto ? '<p><strong>Contexto:</strong> ' + escaparHtml_(sub.contexto) + '</p>' : '') +
        (sub.resultado_esperado ? '<p><strong>Resultado esperado:</strong> ' + escaparHtml_(sub.resultado_esperado) + '</p>' : '') +
        (datos.length > 0 ? '<dl class="sigso-datos-item">' + datos.join('') + '</dl>' : '') +
        (sub.observaciones ? '<p><em>' + escaparHtml_(sub.observaciones) + '</em></p>' : '') +
        renderGaleria_(imagenesItem) +
        '</div></div>';
    }).join('') || '<p>Sin subsolicitudes.</p>';
  }

  function renderCampoDato_(etiqueta, valorHtml) {
    return '<dt>' + escaparHtml_(etiqueta) + '</dt><dd>' + valorHtml + '</dd>';
  }

  function renderGaleria_(archivos) {
    if (!archivos || archivos.length === 0) {
      return '';
    }
    return '<div class="sigso-galeria">' + archivos.map(function (a) {
      var esImagen = String(a.tipo_mime || '').indexOf('image/') === 0;
      return '<a href="' + escaparHtml_(a.url) + '" target="_blank" rel="noopener" class="sigso-galeria__item" title="' + escaparHtml_(a.nombre_original) + '">' +
        (esImagen
          ? '<img src="' + escaparHtml_(a.url) + '" alt="' + escaparHtml_(a.nombre_original) + '">'
          : escaparHtml_(a.nombre_original)) +
        '</a>';
    }).join('') + '</div>';
  }

  function renderTimeline_(historial) {
    if (historial.length === 0) {
      return '<p>Sin historial todavia.</p>';
    }
    return '<ul class="sigso-timeline">' + historial.map(function (h) {
      return '<li><strong>' + formatearEstadoSigso(h.estado_nuevo) + '</strong> — ' + escaparHtml_(h.usuario) +
        ' (' + new Date(h.timestamp).toLocaleString('es-CL') + ')' +
        (h.comentario ? '<br>' + escaparHtml_(h.comentario) : '') + '</li>';
    }).join('') + '</ul>';
  }

  function renderComentarios_(comentarios) {
    if (comentarios.length === 0) {
      return '<p>Sin comentarios todavia.</p>';
    }
    return comentarios.map(function (c) {
      return '<div class="sigso-comentario' + (c.es_interno ? ' sigso-comentario--interno' : '') + '">' +
        '<p>' + escaparHtml_(c.texto) + '</p>' +
        '<p class="sigso-comentario__meta">' + escaparHtml_(c.usuario) + ' — ' + new Date(c.timestamp).toLocaleString('es-CL') +
        (c.es_interno ? ' (interno)' : '') + '</p>' +
        '</div>';
    }).join('');
  }

  function renderFormComentario_() {
    return '<form id="form-comentario">' +
      '<div class="sigso-campo"><textarea id="campo-nuevo-comentario" required placeholder="Escribe un comentario..."></textarea></div>' +
      '<label class="sigso-toggle"><input type="checkbox" id="campo-comentario-interno"> Comentario interno (no visible al solicitante)</label>' +
      '<button type="submit" class="sigso-boton--secundario">Agregar comentario</button>' +
      '</form>';
  }

  function renderAcciones_(subsolicitudes) {
    var opcionesSub = subsolicitudes.map(function (sub) {
      return '<option value="' + sub.subsolicitud_id + '">' + sub.numero_item + '. ' + escaparHtml_(sub.titulo) + ' (' + sub.estado + ')</option>';
    }).join('');
    var opcionesEstado = Object.keys(SIGSO_ESTADOS_LABEL).map(function (codigo) {
      return '<option value="' + codigo + '">' + codigo + ' — ' + SIGSO_ESTADOS_LABEL[codigo] + '</option>';
    }).join('');

    return '<form id="form-cambiar-estado" class="sigso-campo">' +
      '<label>Cambiar estado de</label><select id="select-subsolicitud-estado">' + opcionesSub + '</select>' +
      '<label>Nuevo estado</label><select id="select-nuevo-estado">' + opcionesEstado + '</select>' +
      '<label>Comentario</label><input type="text" id="campo-comentario-estado" placeholder="Motivo (obligatorio en rechazos/reaperturas)">' +
      '<button type="submit" class="sigso-boton">Aplicar cambio de estado</button>' +
      '<span id="resultado-estado"></span>' +
      '</form>' +
      '<form id="form-cambiar-prioridad" class="sigso-campo" style="margin-top:1rem">' +
      '<label>Cambiar prioridad de</label><select id="select-subsolicitud-prioridad">' + opcionesSub + '</select>' +
      '<label>Nueva prioridad</label>' +
      '<select id="select-nueva-prioridad"><option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option><option value="P4">P4</option><option value="P5">P5</option></select>' +
      '<label>Justificacion (minimo 20 caracteres)</label><input type="text" id="campo-justificacion-prioridad">' +
      '<button type="submit" class="sigso-boton">Aplicar cambio de prioridad</button>' +
      '<span id="resultado-prioridad"></span>' +
      '</form>';
  }

  function enviarComentario_(solicitudId) {
    var texto = document.getElementById('campo-nuevo-comentario').value;
    var esInterno = document.getElementById('campo-comentario-interno').checked;
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'agregarComentario', { solicitud_id: solicitudId, texto: texto, es_interno: esInterno })
      .then(function () {
        return window.SigsoDetalle.cargar(solicitudId);
      });
  }

  function enviarCambioEstado_(solicitudId) {
    var subsolicitudId = document.getElementById('select-subsolicitud-estado').value;
    var estadoNuevo = document.getElementById('select-nuevo-estado').value;
    var comentario = document.getElementById('campo-comentario-estado').value;
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'actualizarEstado', { subsolicitud_id: subsolicitudId, estado_nuevo: estadoNuevo, comentario: comentario })
      .then(function (respuesta) {
        if (respuesta.ok) {
          return window.SigsoDetalle.cargar(solicitudId);
        }
        document.getElementById('resultado-estado').textContent = respuesta.message || 'No se pudo aplicar el cambio.';
      });
  }

  function enviarCambioPrioridad_(solicitudId) {
    var subsolicitudId = document.getElementById('select-subsolicitud-prioridad').value;
    var prioridadNueva = document.getElementById('select-nueva-prioridad').value;
    var justificacion = document.getElementById('campo-justificacion-prioridad').value;
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'actualizarPrioridad', { subsolicitud_id: subsolicitudId, prioridad_nueva: prioridadNueva, justificacion: justificacion })
      .then(function (respuesta) {
        if (respuesta.ok) {
          return window.SigsoDetalle.cargar(solicitudId);
        }
        document.getElementById('resultado-prioridad').textContent = respuesta.message || 'No se pudo aplicar el cambio.';
      });
  }

  function escaparHtml_(texto) {
    var div = document.createElement('div');
    div.textContent = texto || '';
    return div.innerHTML;
  }
})();
