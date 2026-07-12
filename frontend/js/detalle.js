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

    // P6: el formulario no existe en el DOM cuando el rol es GERENCIA
    // (renderHistoria_ lo omite) -- solo se cablea si esta presente.
    var formComentario = document.getElementById('form-comentario');
    if (formComentario) {
      formComentario.addEventListener('submit', function (evento) {
        evento.preventDefault();
        enviarComentario_(detalle.solicitud.solicitud_id);
      });
    }
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
    var historialCompromiso = detalle.historial_compromiso || [];
    // P6 (v2.0, Sprint 2): Gerencia ve el detalle completo, pero de solo
    // lectura -- no se le ofrecen las acciones de cambiar estado/prioridad
    // (el backend ya las rechaza igual, esto evita mostrar controles que
    // solo van a fallar).
    var soloLectura = detalle.rol_actual === 'GERENCIA';

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
      // v2.1 (Fase A): "dos promesas" -- lo que propuso el solicitante vs. lo
      // que Leo comprometio (la oficial, ver §2.1 de la especificacion).
      if (sub.fecha_propuesta) datos.push(renderCampoDato_('Fecha propuesta (solicitante)', Componentes.escaparHtml(sub.fecha_propuesta.replace('T', ' '))));
      if (sub.fecha_comprometida) datos.push(renderCampoDato_('Fecha comprometida', Componentes.escaparHtml(sub.fecha_comprometida.replace('T', ' ')) + (sub.comprometida_por ? ' — ' + Componentes.escaparHtml(sub.comprometida_por) : '')));
      if (sub.fecha_terminada) datos.push(renderCampoDato_('Terminada el', Componentes.escaparHtml(new Date(sub.fecha_terminada).toLocaleString('es-CL'))));
      // v2.1 (Fase B): semaforo de cumplimiento (§6) -- ya calculado por
      // getDetalle (Cumplimiento.gs), aqui solo se muestra.
      var cumplimientoBadge = sub.cumplimiento
        ? ' ' + Componentes.badge(sub.cumplimiento.emoji + ' ' + sub.cumplimiento.etiqueta, '')
        : '';
      if (sub.cumplimiento && sub.cumplimiento.dias_esperando !== null) {
        datos.push(renderCampoDato_('Esperando validación', sub.cumplimiento.dias_esperando + ' día(s) hábil(es)'));
      }

      // v2.1 (Fase C, §7 drill-down): "resbalones" de este item -- cada
      // re-compromiso con su motivo, la evidencia que pidio Gerencia.
      var resbalones = historialCompromiso.filter(function (h) { return h.subsolicitud_id === sub.subsolicitud_id; });
      var historialHtml = resbalones.length === 0 ? '' :
        '<div class="sigso-datos-item"><strong>Historial de compromiso:</strong>' +
        '<ul>' + resbalones.map(function (h) {
          return '<li>' + Componentes.escaparHtml(String(h.fecha_anterior).replace('T', ' ')) + ' &rarr; ' +
            Componentes.escaparHtml(String(h.fecha_nueva).replace('T', ' ')) + ' — ' +
            Componentes.escaparHtml(h.motivo) + ' (' + Componentes.escaparHtml(h.usuario) + ', ' +
            new Date(h.timestamp).toLocaleDateString('es-CL') + ')</li>';
        }).join('') + '</ul></div>';

      return '<div class="sigso-acordeon-item sigso-acordeon-item--activo">' +
        '<div class="sigso-acordeon-item__cabecera"><span>' + sub.numero_item + '. ' + Componentes.escaparHtml(sub.titulo) +
        ' — ' + Componentes.badgePrioridad(sub.prioridad) + ' ' + Componentes.badgeEstado(sub.estado) + cumplimientoBadge + '</span></div>' +
        '<div class="sigso-acordeon-item__cuerpo">' +
        '<p>' + Componentes.escaparHtml(sub.descripcion) + '</p>' +
        (sub.contexto ? '<p><strong>Contexto:</strong> ' + Componentes.escaparHtml(sub.contexto) + '</p>' : '') +
        (sub.resultado_esperado ? '<p><strong>Resultado esperado:</strong> ' + Componentes.escaparHtml(sub.resultado_esperado) + '</p>' : '') +
        (datos.length > 0 ? '<dl class="sigso-datos-item">' + datos.join('') + '</dl>' : '') +
        historialHtml +
        (sub.observaciones ? '<p><em>' + Componentes.escaparHtml(sub.observaciones) + '</em></p>' : '') +
        renderGaleria_(imagenesItem) +
        (soloLectura ? '' : renderAccionesItem_(sub, transiciones[sub.subsolicitud_id] || [])) +
        '</div></div>';
    }).join('') || Componentes.vacio('Sin items.');
  }

  // Acciones inline: los 11 estados estan siempre disponibles (Fase 10.1,
  // "Leo hace todo" -- ver nota en backend/backoffice/Constantes.gs); el
  // backend ya indica cuales piden comentario obligatorio
  // (comentarioObligatorioParaCambio_ en Solicitudes.gs), asi el frontend
  // muestra el campo de motivo antes de que el usuario intente aplicar el
  // cambio en vez de que le rebote despues.
  // UI-2 (§5): cada transicion valida se ofrece como un boton con NOMBRE DE
  // ACCION ("Iniciar desarrollo", "Pedir informacion"...) en vez del combo
  // "Cambiar estado a... + Aplicar" -- menos pasos y sin ambiguedad sobre
  // que va a pasar. Las etiquetas describen la accion, no el estado destino.
  var VERBO_TRANSICION = {
    S01: 'Devolver a Nueva',
    S02: 'Marcar recibida', S03: 'Pasar a revisión', S04: 'Aprobar',
    S05: 'Iniciar desarrollo', S06: 'Pedir información', S07: 'Pasar a pruebas',
    S08: 'Marcar terminada', S09: 'Cerrar', S10: 'Rechazar', S11: 'Cancelar'
  };

  function renderAccionesItem_(sub, opcionesTransicion) {
    var selectorEstado = '';
    if (opcionesTransicion.length > 0) {
      var botones = opcionesTransicion.map(function (t) {
        return '<button type="button" class="sigso-boton--secundario sigso-accion-estado" ' +
          'data-subsolicitud="' + sub.subsolicitud_id + '" data-estado="' + t.estado + '" ' +
          'data-comentario-obligatorio="' + (t.comentario_obligatorio ? '1' : '0') + '">' +
          (VERBO_TRANSICION[t.estado] || t.estado) + '</button>';
      }).join(' ');
      selectorEstado =
        '<div class="sigso-acciones-item sigso-botonera-estado">' + botones + '</div>' +
        '<div class="sigso-acciones-item sigso-oculto" data-bloque-motivo="' + sub.subsolicitud_id + '">' +
        '<input type="text" class="sigso-comentario-estado" data-subsolicitud="' + sub.subsolicitud_id + '" placeholder="Motivo (obligatorio para esta acción)">' +
        '</div>' +
        '<span class="sigso-resultado-accion" data-subsolicitud="' + sub.subsolicitud_id + '"></span>';
    }

    // v2.1 (Fase A): comprometer/ajustar la fecha es una accion propia,
    // aparte de cambiar estado -- Leo la usa al aprobar (S04) o cuando
    // quiera confirmar/mover el compromiso. Re-comprometer (ya habia una
    // fecha) exige motivo, igual que cambiar prioridad exige justificacion.
    var yaComprometida = !!sub.fecha_comprometida;
    var bloqueFecha =
      '<div class="sigso-acciones-item">' +
      '<input type="datetime-local" class="sigso-fecha-comprometida" data-subsolicitud="' + sub.subsolicitud_id + '" value="' + Componentes.escaparHtml(sub.fecha_comprometida || sub.fecha_propuesta || '') + '">' +
      '<input type="text" class="sigso-motivo-fecha' + (yaComprometida ? '' : ' sigso-oculto') + '" data-subsolicitud="' + sub.subsolicitud_id + '" placeholder="Motivo (min. 20 caracteres) para mover una fecha ya comprometida">' +
      '<button type="button" class="sigso-boton--secundario sigso-aplicar-fecha" data-subsolicitud="' + sub.subsolicitud_id + '">' + (yaComprometida ? 'Ajustar fecha comprometida' : 'Comprometer fecha') + '</button>' +
      '<span class="sigso-resultado-accion" data-subsolicitud="' + sub.subsolicitud_id + '-fecha"></span>' +
      '</div>';

    return selectorEstado + bloqueFecha +
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
    })).concat((detalle.historial_compromiso || []).map(function (h) {
      // UI-2 (§5): los re-compromisos de fecha entran al timeline unificado
      // (antes solo se veian dentro de cada item).
      return {
        tipo: 'compromiso', timestamp: h.timestamp, usuario: h.usuario,
        texto: 'Fecha comprometida: ' + String(h.fecha_nueva).replace('T', ' '),
        comentario: h.motivo
      };
    })).sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });

    // UI-2 (§5): icono por tipo de evento para escanear el timeline sin leer.
    function iconoEvento_(e) {
      if (e.tipo === 'estado') return '🔄';
      if (e.tipo === 'compromiso') return '📅';
      return e.esInterno ? '🔒' : '💬';
    }

    var feed = eventos.length === 0
      ? Componentes.vacio('Sin actividad todavia.')
      : '<ul class="sigso-timeline">' + eventos.map(function (e) {
        var etiqueta = e.tipo === 'comentario'
          ? 'Comentario' + (e.esInterno ? ' (interno)' : '')
          : '<strong>' + e.texto + '</strong>';
        var detalleTexto = e.tipo === 'comentario' ? e.texto : e.comentario;
        return '<li class="sigso-timeline__evento--' + e.tipo + (e.tipo === 'comentario' && e.esInterno ? ' sigso-comentario--interno' : '') + '">' +
          '<span class="sigso-timeline__icono">' + iconoEvento_(e) + '</span> ' +
          etiqueta + ' — ' + Componentes.escaparHtml(e.usuario) + ' (' + new Date(e.timestamp).toLocaleString('es-CL') + ')' +
          (detalleTexto ? '<br>' + Componentes.escaparHtml(detalleTexto) : '') +
          '</li>';
      }).join('') + '</ul>';

    // P6: Gerencia ve la actividad pero no comenta (el backend ya lo
    // rechaza igual; ver nota identica en renderSubsolicitudes_).
    var formComentario = detalle.rol_actual === 'GERENCIA' ? '' : renderFormComentario_();
    return '<h3>Actividad</h3>' + feed + formComentario;
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
    // UI-2 (§5): botonera contextual. Si la accion exige motivo, el primer
    // clic revela el campo y el segundo (con texto) aplica -- el usuario
    // nunca descubre el requisito DESPUES de intentar.
    document.querySelectorAll('.sigso-accion-estado').forEach(function (boton) {
      boton.addEventListener('click', function () {
        var subId = boton.getAttribute('data-subsolicitud');
        var estado = boton.getAttribute('data-estado');
        var requiereComentario = boton.getAttribute('data-comentario-obligatorio') === '1';
        var bloqueMotivo = document.querySelector('[data-bloque-motivo="' + subId + '"]');
        var campoComentario = document.querySelector('.sigso-comentario-estado[data-subsolicitud="' + subId + '"]');
        var span = document.querySelector('.sigso-resultado-accion[data-subsolicitud="' + subId + '"]');

        if (requiereComentario) {
          if (bloqueMotivo.classList.contains('sigso-oculto')) {
            bloqueMotivo.classList.remove('sigso-oculto');
            campoComentario.focus();
            if (span) span.textContent = 'Escribe el motivo y vuelve a pulsar "' + boton.textContent + '".';
            return;
          }
          if (!campoComentario.value.trim()) {
            campoComentario.focus();
            if (span) span.textContent = 'El motivo es obligatorio para esta acción.';
            return;
          }
        }
        enviarCambioEstado_(solicitudId, subId, estado, campoComentario ? campoComentario.value : '');
      });
    });

    document.querySelectorAll('.sigso-aplicar-fecha').forEach(function (boton) {
      boton.addEventListener('click', function () {
        var subId = boton.getAttribute('data-subsolicitud');
        var fecha = document.querySelector('.sigso-fecha-comprometida[data-subsolicitud="' + subId + '"]').value;
        var motivo = document.querySelector('.sigso-motivo-fecha[data-subsolicitud="' + subId + '"]').value;
        enviarCompromisoFecha_(solicitudId, subId, fecha, motivo);
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

  // v2.1 (Fase A): comprometer/ajustar la fecha por item -- el motivo solo
  // es obligatorio si ya habia una fecha comprometida (backend lo re-valida
  // igual, esto solo evita el viaje redondo cuando obviamente falta).
  function enviarCompromisoFecha_(solicitudId, subsolicitudId, fechaComprometida, motivo) {
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'comprometerFecha', {
      subsolicitud_id: subsolicitudId, fecha_comprometida: fechaComprometida, motivo: motivo
    }).then(function (respuesta) {
      if (respuesta.ok) {
        return window.SigsoDetalle.cargar(solicitudId);
      }
      var span = document.querySelector('.sigso-resultado-accion[data-subsolicitud="' + subsolicitudId + '-fecha"]');
      if (span) span.textContent = respuesta.message || 'No se pudo comprometer la fecha.';
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
