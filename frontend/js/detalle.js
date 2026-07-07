/**
 * detalle.js — Backoffice: detalle de solicitud (§12.5, Fase 10 rediseno UX).
 *
 * Layout de 3 columnas (auditoria de producto): ficha (izquierda, sticky,
 * solo lectura) / items (centro, donde Leo actua) / historia (derecha,
 * timeline unificado de estados + comentarios). Reemplaza el layout previo
 * de bloques apilados con un formulario de acciones al fondo.
 *
 * El selector de "nuevo estado" ahora solo ofrece transiciones que el
 * backend realmente aceptaria para el rol actual (getDetalle ya las
 * calcula, ver backend/backoffice/Solicitudes.gs) -- antes ofrecia los 11
 * estados y dejaba que el usuario adivinara/fallara.
 */
(function () {
  window.SigsoDetalle = { cargar: cargarDetalle_ };

  var detalleActual = null;

  function cargarDetalle_(solicitudId) {
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'getSolicitudDetalle', { solicitud_id: solicitudId })
      .then(function (respuesta) {
        if (!respuesta.ok) {
          document.getElementById('detalle-contenido').innerHTML =
            Componentes.alerta(respuesta.message || 'No se pudo cargar la solicitud.', 'error');
          return respuesta;
        }
        detalleActual = respuesta.data;
        render_(detalleActual);
        return respuesta;
      });
  }

  function render_(detalle) {
    var contenedor = document.getElementById('detalle-contenido');
    contenedor.innerHTML =
      '<div class="sigso-detalle-layout">' +
      '<div class="sigso-detalle-ficha">' + renderFicha_(detalle) + '</div>' +
      '<div class="sigso-detalle-centro"><h3>Qu&eacute; hacer (items)</h3>' + renderSubsolicitudes_(detalle) + '</div>' +
      '<div class="sigso-detalle-historia">' + renderHistoria_(detalle) + '</div>' +
      '</div>';

    wireAcciones_(detalle.solicitud.solicitud_id);

    document.getElementById('form-comentario').addEventListener('submit', function (evento) {
      evento.preventDefault();
      enviarComentario_(detalle.solicitud.solicitud_id);
    });
  }

  // --- Columna izquierda: ficha (solo lectura, sticky) -------------------

  function renderFicha_(detalle) {
    var s = detalle.solicitud;
    var archivos = detalle.archivos || [];
    // Fase 9: imagenes sin subsolicitud_id son adjuntos generales de la
    // solicitud (RF-003: se adjuntan a nivel de solicitud, Bloque 5).
    var archivosGenerales = archivos.filter(function (a) { return !a.subsolicitud_id; });

    var documentos = '';
    if (s.url_doc || s.url_pdf) {
      documentos = '<div class="sigso-datos-item-compacto">' +
        (s.url_doc ? '<a href="' + Componentes.escaparHtml(s.url_doc) + '" target="_blank" rel="noopener">Ver documento</a>' : '') +
        (s.url_pdf ? '<a href="' + Componentes.escaparHtml(s.url_pdf) + '" target="_blank" rel="noopener">Descargar PDF</a>' : '') +
        '</div>';
    }

    return '<h2>' + s.solicitud_id + '</h2>' +
      '<p>' + Componentes.badgePrioridad(s.prioridad_derivada) + ' ' + Componentes.badgeEstado(s.estado_derivado) + '</p>' +
      documentos +
      '<dl class="sigso-datos-item">' +
      renderCampoDato_('Empresa', Componentes.escaparHtml(s.empresa_nombre || s.empresa_id)) +
      renderCampoDato_('Plataforma', Componentes.escaparHtml(s.plataforma_nombre || s.plataforma)) +
      renderCampoDato_('Solicitante', Componentes.escaparHtml(s.solicitante_nombre) + ' (' + Componentes.escaparHtml(s.solicitante_cargo) + ')') +
      renderCampoDato_('Correo', Componentes.escaparHtml(s.solicitante_email)) +
      (s.cc ? renderCampoDato_('CC', Componentes.escaparHtml(s.cc)) : '') +
      '</dl>' +
      (s.es_cliente ? renderBloqueCliente_(s) : '') +
      (s.observaciones_generales ? '<p><em>' + Componentes.escaparHtml(s.observaciones_generales) + '</em></p>' : '') +
      renderGaleria_(archivosGenerales);
  }

  function renderBloqueCliente_(s) {
    return '<dl class="sigso-datos-item">' +
      renderCampoDato_('Cliente', Componentes.escaparHtml(s.empresa_cliente)) +
      (s.cliente_mandante ? renderCampoDato_('Mandante', Componentes.escaparHtml(s.cliente_mandante)) : '') +
      (s.cliente_obra ? renderCampoDato_('Obra', Componentes.escaparHtml(s.cliente_obra)) : '') +
      renderCampoDato_('Contacto', Componentes.escaparHtml(s.contacto_cliente) + ' — ' + Componentes.escaparHtml(s.correo_cliente)) +
      (s.urgencia_cliente ? renderCampoDato_('Urgencia reportada', Componentes.escaparHtml(s.urgencia_cliente)) : '') +
      '</dl>';
  }

  // --- Columna central: items, con acciones inline -----------------------

  // Fase 9 (hallazgo de datos reales): el objetivo de este panel es que
  // Leo entienda, sin cruzar ninguna otra planilla ni pedir mas datos por
  // WhatsApp, exactamente donde reproducir/hacer el cambio (URLs, usuario
  // de prueba, credencial), y con que estado/prioridad esta cada item.
  // Fase 10: ademas, actua sin salir de la tarjeta (cambiar estado con solo
  // las transiciones validas para su rol, cambiar prioridad), en vez de un
  // formulario generico al fondo del panel.
  function renderSubsolicitudes_(detalle) {
    var subsolicitudes = detalle.subsolicitudes;
    var archivos = detalle.archivos || [];
    var transiciones = detalle.transiciones_por_subsolicitud || {};

    return subsolicitudes.map(function (sub) {
      var urlsAdicionales = [];
      try {
        urlsAdicionales = JSON.parse(sub.urls_adicionales || '[]');
      } catch (err) {
        urlsAdicionales = [];
      }
      var imagenesItem = archivos.filter(function (a) { return a.subsolicitud_id === sub.subsolicitud_id; });

      var datos = [];
      if (sub.url_modulo) {
        datos.push(renderCampoDato_('URL principal', '<a href="' + Componentes.escaparHtml(sub.url_modulo) + '" target="_blank" rel="noopener">' + Componentes.escaparHtml(sub.url_modulo) + '</a>'));
      }
      urlsAdicionales.forEach(function (u) {
        if (!u.url) return;
        datos.push(renderCampoDato_(u.titulo || 'URL adicional', '<a href="' + Componentes.escaparHtml(u.url) + '" target="_blank" rel="noopener">' + Componentes.escaparHtml(u.url) + '</a>'));
      });
      if (sub.usuario_prueba) datos.push(renderCampoDato_('Usuario de prueba', Componentes.escaparHtml(sub.usuario_prueba)));
      if (sub.ref_credencial) datos.push(renderCampoDato_('Credencial', Componentes.escaparHtml(sub.ref_credencial)));
      if (sub.centro_costos) datos.push(renderCampoDato_('Centro de costos', Componentes.escaparHtml(sub.centro_costos)));
      if (sub.frecuencia) datos.push(renderCampoDato_('Frecuencia', Componentes.escaparHtml(sub.frecuencia)));
      if (sub.personas_afectadas) datos.push(renderCampoDato_('Personas afectadas', Componentes.escaparHtml(sub.personas_afectadas)));
      if (sub.desarrollador_asignado) datos.push(renderCampoDato_('Asignado a', Componentes.escaparHtml(sub.desarrollador_asignado)));
      if (sub.estimacion_horas) datos.push(renderCampoDato_('Estimacion', sub.estimacion_horas + ' h' + (sub.horas_reales ? ' (reales: ' + sub.horas_reales + ' h)' : '')));

      return '<div class="sigso-acordeon-item sigso-acordeon-item--activo">' +
        '<div class="sigso-acordeon-item__cabecera"><span>' + sub.numero_item + '. ' + Componentes.escaparHtml(sub.titulo) +
        ' — ' + Componentes.badgePrioridad(sub.prioridad) + ' ' + Componentes.badgeEstado(sub.estado) + '</span></div>' +
        '<div class="sigso-acordeon-item__cuerpo">' +
        '<p>' + Componentes.escaparHtml(sub.descripcion) + '</p>' +
        (sub.contexto ? '<p><strong>Contexto:</strong> ' + Componentes.escaparHtml(sub.contexto) + '</p>' : '') +
        (sub.resultado_esperado ? '<p><strong>Resultado esperado:</strong> ' + Componentes.escaparHtml(sub.resultado_esperado) + '</p>' : '') +
        (datos.length > 0 ? '<dl class="sigso-datos-item">' + datos.join('') + '</dl>' : '') +
        (sub.observaciones ? '<p><em>' + Componentes.escaparHtml(sub.observaciones) + '</em></p>' : '') +
        renderGaleria_(imagenesItem) +
        renderAccionesItem_(sub, transiciones[sub.subsolicitud_id] || []) +
        '</div></div>';
    }).join('') || Componentes.vacio('Sin items.');
  }

  // Acciones inline: los 11 estados estan siempre disponibles (Fase 10.1,
  // "Leo hace todo" -- ver nota en backend/backoffice/Constantes.gs); el
  // backend ya indica cuales piden comentario obligatorio
  // (comentarioObligatorioParaCambio_ en Solicitudes.gs), asi el frontend
  // muestra el campo de motivo antes de que el usuario intente aplicar el
  // cambio en vez de que le rebote despues.
  function renderAccionesItem_(sub, opcionesTransicion) {
    var selectorEstado = '';
    if (opcionesTransicion.length > 0) {
      var opciones = opcionesTransicion.map(function (t) {
        return '<option value="' + t.estado + '" data-comentario-obligatorio="' + (t.comentario_obligatorio ? '1' : '0') + '">' +
          t.estado + ' — ' + (typeof SIGSO_ESTADOS_LABEL !== 'undefined' ? SIGSO_ESTADOS_LABEL[t.estado] : t.estado) + '</option>';
      }).join('');
      selectorEstado =
        '<div class="sigso-acciones-item">' +
        '<select class="sigso-cambiar-estado" data-subsolicitud="' + sub.subsolicitud_id + '">' +
        '<option value="">Cambiar estado a...</option>' + opciones +
        '</select>' +
        '<input type="text" class="sigso-comentario-estado sigso-oculto" data-subsolicitud="' + sub.subsolicitud_id + '" placeholder="Motivo (obligatorio para esta transicion)">' +
        '<button type="button" class="sigso-boton--secundario sigso-aplicar-estado" data-subsolicitud="' + sub.subsolicitud_id + '" disabled>Aplicar</button>' +
        '<span class="sigso-resultado-accion" data-subsolicitud="' + sub.subsolicitud_id + '"></span>' +
        '</div>';
    }

    return selectorEstado +
      '<div class="sigso-acciones-item">' +
      '<select class="sigso-nueva-prioridad" data-subsolicitud="' + sub.subsolicitud_id + '">' +
      ['P1', 'P2', 'P3', 'P4', 'P5'].map(function (p) {
        return '<option value="' + p + '"' + (p === sub.prioridad ? ' selected' : '') + '>' + p + '</option>';
      }).join('') +
      '</select>' +
      '<input type="text" class="sigso-justificacion-prioridad" data-subsolicitud="' + sub.subsolicitud_id + '" placeholder="Justificacion (min. 20 caracteres) para cambiar prioridad">' +
      '<button type="button" class="sigso-boton--secundario sigso-aplicar-prioridad" data-subsolicitud="' + sub.subsolicitud_id + '">Cambiar prioridad</button>' +
      '<span class="sigso-resultado-accion" data-subsolicitud="' + sub.subsolicitud_id + '-prioridad"></span>' +
      '</div>';
  }

  function renderCampoDato_(etiqueta, valorHtml) {
    return '<dt>' + Componentes.escaparHtml(etiqueta) + '</dt><dd>' + valorHtml + '</dd>';
  }

  function renderGaleria_(archivos) {
    return Componentes.galeriaImagenes((archivos || []).map(function (a) {
      var esImagen = String(a.tipo_mime || '').indexOf('image/') === 0;
      return { url: a.url, nombre: a.nombre_original, descripcion: esImagen ? '' : a.nombre_original };
    }));
  }

  // --- Columna derecha: historia unificada (estados + comentarios) ------

  function renderHistoria_(detalle) {
    var eventos = (detalle.historial_estados || []).map(function (h) {
      return {
        tipo: 'estado', timestamp: h.timestamp, usuario: h.usuario,
        texto: formatearEstadoSigso(h.estado_nuevo), comentario: h.comentario
      };
    }).concat((detalle.comentarios || []).map(function (c) {
      return { tipo: 'comentario', timestamp: c.timestamp, usuario: c.usuario, texto: c.texto, esInterno: c.es_interno };
    })).sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });

    var feed = eventos.length === 0
      ? Componentes.vacio('Sin actividad todavia.')
      : '<ul class="sigso-timeline">' + eventos.map(function (e) {
        var etiqueta = e.tipo === 'estado' ? '<strong>' + e.texto + '</strong>' : 'Comentario' + (e.esInterno ? ' (interno)' : '');
        return '<li' + (e.tipo === 'comentario' && e.esInterno ? ' class="sigso-comentario--interno"' : '') + '>' +
          etiqueta + ' — ' + Componentes.escaparHtml(e.usuario) + ' (' + new Date(e.timestamp).toLocaleString('es-CL') + ')' +
          ((e.tipo === 'estado' ? e.comentario : e.texto) ? '<br>' + Componentes.escaparHtml(e.tipo === 'estado' ? e.comentario : e.texto) : '') +
          '</li>';
      }).join('') + '</ul>';

    return '<h3>Actividad</h3>' + feed + renderFormComentario_();
  }

  function renderFormComentario_() {
    return '<form id="form-comentario">' +
      '<div class="sigso-campo"><textarea id="campo-nuevo-comentario" required placeholder="Escribe un comentario..."></textarea></div>' +
      '<label class="sigso-toggle"><input type="checkbox" id="campo-comentario-interno"> Interno (no visible al solicitante)</label>' +
      '<button type="submit" class="sigso-boton--secundario">Comentar</button>' +
      '</form>';
  }

  // --- Cableado de acciones inline ---------------------------------------

  function wireAcciones_(solicitudId) {
    document.querySelectorAll('.sigso-cambiar-estado').forEach(function (select) {
      select.addEventListener('change', function () {
        var subId = select.getAttribute('data-subsolicitud');
        var boton = document.querySelector('.sigso-aplicar-estado[data-subsolicitud="' + subId + '"]');
        var campoComentario = document.querySelector('.sigso-comentario-estado[data-subsolicitud="' + subId + '"]');
        var opcionElegida = select.options[select.selectedIndex];
        var requiereComentario = opcionElegida && opcionElegida.getAttribute('data-comentario-obligatorio') === '1';
        campoComentario.classList.toggle('sigso-oculto', !requiereComentario);
        boton.disabled = !select.value;
      });
    });

    document.querySelectorAll('.sigso-aplicar-estado').forEach(function (boton) {
      boton.addEventListener('click', function () {
        var subId = boton.getAttribute('data-subsolicitud');
        var select = document.querySelector('.sigso-cambiar-estado[data-subsolicitud="' + subId + '"]');
        var comentario = document.querySelector('.sigso-comentario-estado[data-subsolicitud="' + subId + '"]').value;
        enviarCambioEstado_(solicitudId, subId, select.value, comentario);
      });
    });

    document.querySelectorAll('.sigso-aplicar-prioridad').forEach(function (boton) {
      boton.addEventListener('click', function () {
        var subId = boton.getAttribute('data-subsolicitud');
        var prioridad = document.querySelector('.sigso-nueva-prioridad[data-subsolicitud="' + subId + '"]').value;
        var justificacion = document.querySelector('.sigso-justificacion-prioridad[data-subsolicitud="' + subId + '"]').value;
        enviarCambioPrioridad_(solicitudId, subId, prioridad, justificacion);
      });
    });
  }

  function enviarComentario_(solicitudId) {
    var texto = document.getElementById('campo-nuevo-comentario').value;
    var esInterno = document.getElementById('campo-comentario-interno').checked;
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'agregarComentario', { solicitud_id: solicitudId, texto: texto, es_interno: esInterno })
      .then(function () {
        return window.SigsoDetalle.cargar(solicitudId);
      });
  }

  function enviarCambioEstado_(solicitudId, subsolicitudId, estadoNuevo, comentario) {
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'actualizarEstado', { subsolicitud_id: subsolicitudId, estado_nuevo: estadoNuevo, comentario: comentario })
      .then(function (respuesta) {
        if (respuesta.ok) {
          return window.SigsoDetalle.cargar(solicitudId);
        }
        var span = document.querySelector('.sigso-resultado-accion[data-subsolicitud="' + subsolicitudId + '"]');
        if (span) span.textContent = respuesta.message || 'No se pudo aplicar el cambio.';
      });
  }

  function enviarCambioPrioridad_(solicitudId, subsolicitudId, prioridadNueva, justificacion) {
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'actualizarPrioridad', { subsolicitud_id: subsolicitudId, prioridad_nueva: prioridadNueva, justificacion: justificacion })
      .then(function (respuesta) {
        if (respuesta.ok) {
          return window.SigsoDetalle.cargar(solicitudId);
        }
        var span = document.querySelector('.sigso-resultado-accion[data-subsolicitud="' + subsolicitudId + '-prioridad"]');
        if (span) span.textContent = respuesta.message || 'No se pudo aplicar el cambio.';
      });
  }
})();
