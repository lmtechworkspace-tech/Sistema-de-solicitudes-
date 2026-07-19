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

  // Fix (reporte real de produccion): al tocar una accion, se aplicaban
  // varios cambios de estado en rafaga. Candado global: mientras hay una
  // accion en vuelo se ignora cualquier otro clic (de este u otro boton),
  // y los botones se deshabilitan visualmente hasta que el detalle se
  // recarga o la accion falla.
  var accionEnCurso = false;

  function bloquearAcciones_(botonActivo) {
    accionEnCurso = true;
    document.querySelectorAll('.sigso-accion-estado, .sigso-aplicar-fecha, .sigso-aplicar-prioridad, .sigso-aplicar-derivacion').forEach(function (b) {
      b.disabled = true;
    });
    if (botonActivo) {
      botonActivo.setAttribute('data-texto-original', botonActivo.textContent);
      botonActivo.innerHTML = '<span class="sigso-spinner"></span>Aplicando…';
    }
  }

  function desbloquearAcciones_() {
    accionEnCurso = false;
    document.querySelectorAll('.sigso-accion-estado, .sigso-aplicar-fecha, .sigso-aplicar-prioridad, .sigso-aplicar-derivacion').forEach(function (b) {
      b.disabled = false;
      var original = b.getAttribute('data-texto-original');
      if (original) {
        b.textContent = original;
        b.removeAttribute('data-texto-original');
      }
    });
  }

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
    var subsolicitudes = detalle.subsolicitudes || [];
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
      '<dl class="sigso-datos-item">' +
      renderCampoDato_('Ingresada', Componentes.escaparHtml(fechaCorta_(s.fecha_creacion))) +
      renderCampoDato_('Ítems', Componentes.escaparHtml(resumenTiposItems_(subsolicitudes))) +
      renderCampoDato_('Módulo(s)', Componentes.escaparHtml(resumenModulosItems_(subsolicitudes))) +
      '</dl>' +
      '<dl class="sigso-datos-item">' +
      renderCampoDato_('Empresa', Componentes.escaparHtml(s.empresa_nombre || s.empresa_id)) +
      renderCampoDato_('Plataforma', Componentes.escaparHtml(s.plataforma_nombre || s.plataforma)) +
      '</dl>' +
      '<dl class="sigso-datos-item">' +
      renderCampoDato_('Solicitante', Componentes.escaparHtml(s.solicitante_nombre) + ' (' + Componentes.escaparHtml(s.solicitante_cargo) + ')') +
      renderCampoDato_('Correo', Componentes.escaparHtml(s.solicitante_email)) +
      (s.cc ? renderCampoDato_('CC', Componentes.escaparHtml(s.cc)) : '') +
      '</dl>' +
      (s.es_cliente ? renderBloqueCliente_(s) : '') +
      (s.observaciones_generales ? '<p><em>' + Componentes.escaparHtml(s.observaciones_generales) + '</em></p>' : '') +
      documentos +
      renderGaleria_(archivosGenerales);
  }

  // Propuesta 4: la ficha debe responder "que es esto" de un vistazo -- una
  // solicitud real mezcla tipos/modulos por item (Fase 10), asi que aca se
  // resume en vez de repetir cada item (eso ya se ve en la columna central).
  function resumenTiposItems_(subsolicitudes) {
    if (subsolicitudes.length === 0) return '—';
    var conteo = {};
    subsolicitudes.forEach(function (sub) {
      var nombre = sub.tipo_nombre || sub.tipo || 'Sin tipo';
      conteo[nombre] = (conteo[nombre] || 0) + 1;
    });
    var partes = Object.keys(conteo).map(function (nombre) {
      return conteo[nombre] + ' ' + nombre;
    });
    return subsolicitudes.length + ' (' + partes.join(', ') + ')';
  }

  function resumenModulosItems_(subsolicitudes) {
    if (subsolicitudes.length === 0) return '—';
    var vistos = [];
    subsolicitudes.forEach(function (sub) {
      var nombre = sub.modulo_nombre || sub.modulo || '';
      if (nombre && vistos.indexOf(nombre) === -1) vistos.push(nombre);
    });
    return vistos.length ? vistos.join(' · ') : '—';
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

      // Propuesta 1: identidad completa del item -- tipo y modulo existian
      // en los datos (tipo_nombre/modulo_nombre, por item desde Fase 10) pero
      // la vista nunca los mostraba, obligando a leer toda la descripcion
      // para saber "que es esto" (reporte real de uso).
      var metaChips = [];
      if (sub.tipo_nombre || sub.tipo) metaChips.push('🏷 ' + Componentes.escaparHtml(sub.tipo_nombre || sub.tipo));
      if (sub.modulo_nombre || sub.modulo) metaChips.push('📦 ' + Componentes.escaparHtml(sub.modulo_nombre || sub.modulo));
      if (sub.fecha_propuesta) metaChips.push('📅 Propuesta: ' + Componentes.escaparHtml(fechaCorta_(sub.fecha_propuesta)));
      var metaHtml = metaChips.length ? '<div class="sigso-item-meta">' + metaChips.join(' &middot; ') + '</div>' : '';

      // Propuesta 3: los datos del item se agrupan por proposito (donde
      // reproducir / contexto del pedido / plazos y responsable) en vez de
      // una unica lista plana -- se escanea, no solo se lee.
      var datosReproducir = [];
      if (sub.url_modulo) {
        datosReproducir.push(renderCampoDato_('URL principal', '<a href="' + Componentes.escaparHtml(sub.url_modulo) + '" target="_blank" rel="noopener">' + Componentes.escaparHtml(sub.url_modulo) + '</a>'));
      }
      urlsAdicionales.forEach(function (u) {
        if (!u.url) return;
        datosReproducir.push(renderCampoDato_(u.titulo || 'URL adicional', '<a href="' + Componentes.escaparHtml(u.url) + '" target="_blank" rel="noopener">' + Componentes.escaparHtml(u.url) + '</a>'));
      });
      if (sub.usuario_prueba) datosReproducir.push(renderCampoDato_('Usuario de prueba', Componentes.escaparHtml(sub.usuario_prueba)));
      if (sub.ref_credencial) datosReproducir.push(renderCampoDato_('Credencial', Componentes.escaparHtml(sub.ref_credencial)));

      var datosContexto = [];
      if (sub.frecuencia) datosContexto.push(renderCampoDato_('Frecuencia', Componentes.escaparHtml(sub.frecuencia)));
      if (sub.personas_afectadas) datosContexto.push(renderCampoDato_('Personas afectadas', Componentes.escaparHtml(sub.personas_afectadas)));
      if (sub.centro_costos) datosContexto.push(renderCampoDato_('Centro de costos', Componentes.escaparHtml(sub.centro_costos)));

      var datosPlazos = [];
      if (sub.desarrollador_asignado) datosPlazos.push(renderCampoDato_('Asignado a', Componentes.escaparHtml(sub.desarrollador_asignado)));
      if (sub.estimacion_horas) datosPlazos.push(renderCampoDato_('Estimacion', sub.estimacion_horas + ' h' + (sub.horas_reales ? ' (reales: ' + sub.horas_reales + ' h)' : '')));
      // v2.1 (Fase A): "dos promesas" -- lo que propuso el solicitante vs. lo
      // que Leo comprometio (la oficial, ver §2.1 de la especificacion). La
      // fecha propuesta ya se ve arriba en los chips; aca solo la comprometida.
      if (sub.fecha_comprometida) datosPlazos.push(renderCampoDato_('Fecha comprometida', Componentes.escaparHtml(fechaCorta_(sub.fecha_comprometida)) + (sub.comprometida_por ? ' — ' + Componentes.escaparHtml(sub.comprometida_por) : '')));
      if (sub.fecha_terminada) datosPlazos.push(renderCampoDato_('Terminada el', Componentes.escaparHtml(new Date(sub.fecha_terminada).toLocaleString('es-CL'))));
      // != null (laxo) cubre tambien undefined -- un backend desplegado con
      // una version anterior puede no traer dias_esperando y antes se
      // imprimia "undefined dia(s)".
      if (sub.cumplimiento && sub.cumplimiento.dias_esperando != null) {
        datosPlazos.push(renderCampoDato_('Esperando validación', sub.cumplimiento.dias_esperando + ' día(s) hábil(es)'));
      }

      function bloqueDatos_(titulo, datos) {
        return datos.length === 0 ? '' : '<h5 class="sigso-titulo-accion">' + titulo + '</h5><dl class="sigso-datos-item">' + datos.join('') + '</dl>';
      }

      // v2.1 (Fase B): semaforo de cumplimiento (§6) -- ya calculado por
      // getDetalle (Cumplimiento.gs). Fix contraste: Componentes.badge(...,'')
      // sin variante deja texto blanco sin fondo (invisible sobre la tarjeta
      // blanca) -- se usa el mismo estilo de texto que ya se ve bien en
      // estado.js/gerencia.js para el mismo dato.
      var cumplimientoTexto = sub.cumplimiento
        ? ' <span class="sigso-semaforo-inline">' + sub.cumplimiento.emoji + ' ' + Componentes.escaparHtml(sub.cumplimiento.etiqueta) + '</span>'
        : '';

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
        ' — ' + Componentes.badgePrioridad(sub.prioridad) + ' ' + Componentes.badgeEstado(sub.estado) + cumplimientoTexto + '</span></div>' +
        '<div class="sigso-acordeon-item__cuerpo">' +
        metaHtml +
        '<p>' + Componentes.escaparHtml(sub.descripcion) + '</p>' +
        (sub.contexto ? '<p><strong>Contexto:</strong> ' + Componentes.escaparHtml(sub.contexto) + '</p>' : '') +
        (sub.resultado_esperado ? '<p><strong>Resultado esperado:</strong> ' + Componentes.escaparHtml(sub.resultado_esperado) + '</p>' : '') +
        bloqueDatos_('🔍 Dónde reproducir', datosReproducir) +
        bloqueDatos_('📋 Contexto del pedido', datosContexto) +
        bloqueDatos_('⏱ Plazos y responsable', datosPlazos) +
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

  // Rediseño de la vista del desarrollador (feedback real: "muchos botones,
  // no queda claro el flujo"): las transiciones se separan en AVANZAR (el
  // camino natural hacia adelante, con el siguiente paso destacado en
  // naranja) y "Más acciones" (retrocesos, rechazar, cancelar) plegadas en
  // un details -- estan disponibles pero no compiten visualmente.
  var RANGO_ESTADO = {
    S01: 0, S02: 1, S03: 2, S04: 3, S05: 4, S06: 4, S07: 5, S08: 6, S09: 7,
    S10: 99, S11: 99
  };

  // Rediseño (Propuesta 2): el flujo real de trabajo es "llega -> evaluar ->
  // comprometer fecha -> recien ahi avanzar estados", pero la tarjeta
  // mostraba Avanzar primero. La fecha comprometida pasa a ser el primer
  // bloque; si el item sigue abierto y no tiene fecha, se destaca con una
  // alerta y el boton de comprometer pasa a ser la accion principal.
  var ESTADOS_CERRADOS_DETALLE = ['S09', 'S10', 'S11'];

  function renderAccionesItem_(sub, opcionesTransicion) {
    // Se calcula antes que la botonera de "Avanzar" porque decide si esta
    // puede tener su propio boton primario -- solo un naranja por tarjeta
    // (UI-1 §1): si falta comprometer fecha, ESA es la accion principal.
    var itemAbierto = ESTADOS_CERRADOS_DETALLE.indexOf(sub.estado) === -1;
    var faltaComprometer = itemAbierto && !sub.fecha_comprometida;

    var selectorEstado = '';
    if (opcionesTransicion.length > 0) {
      var rangoActual = RANGO_ESTADO[sub.estado] !== undefined ? RANGO_ESTADO[sub.estado] : -1;
      var avanzar = opcionesTransicion.filter(function (t) {
        return RANGO_ESTADO[t.estado] > rangoActual && RANGO_ESTADO[t.estado] < 99;
      });
      var otras = opcionesTransicion.filter(function (t) {
        return avanzar.indexOf(t) === -1;
      });
      // El paso inmediato (menor rango entre los de avanzar) va en naranja:
      // es LA accion esperada; el resto en secundario. Si falta comprometer
      // fecha, ningun boton de avanzar es primario (ese lugar lo ocupa
      // "Comprometer fecha" arriba).
      var rangoSiguiente = avanzar.length > 0 && !faltaComprometer
        ? Math.min.apply(null, avanzar.map(function (t) { return RANGO_ESTADO[t.estado]; }))
        : null;

      function botonDe_(t) {
        var esPrincipal = RANGO_ESTADO[t.estado] === rangoSiguiente;
        return '<button type="button" class="' + (esPrincipal ? 'sigso-boton' : 'sigso-boton--secundario') + ' sigso-accion-estado" ' +
          'data-subsolicitud="' + sub.subsolicitud_id + '" data-estado="' + t.estado + '" ' +
          'data-comentario-obligatorio="' + (t.comentario_obligatorio ? '1' : '0') + '">' +
          (VERBO_TRANSICION[t.estado] || t.estado) + '</button>';
      }

      var botonesAvanzar = avanzar.map(botonDe_).join(' ');
      var botonesOtras = otras.map(botonDe_).join(' ');

      selectorEstado =
        '<h4 class="sigso-titulo-accion">Avanzar el ítem</h4>' +
        '<div class="sigso-acciones-item sigso-botonera-estado">' + (botonesAvanzar || '<span class="sigso-ayuda">Sin pasos siguientes: este ítem ya está al final de su flujo.</span>') + '</div>' +
        (botonesOtras
          ? '<details class="sigso-mas-acciones"><summary>Más acciones (retroceder, rechazar, cancelar)</summary>' +
            '<div class="sigso-acciones-item sigso-botonera-estado">' + botonesOtras + '</div></details>'
          : '') +
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
    // Rediseño (Propuesta 2): sin fecha comprometida y con el item todavia
    // abierto, "comprometer fecha" pasa a ser LA accion principal (naranja,
    // faltaComprometer calculado arriba) y se avisa antes de avanzar -- el
    // flujo real es evaluar -> comprometer -> recien ahi avanzar estados.
    var avisoFecha = faltaComprometer
      ? '<div class="sigso-alerta"><p>⚠ Este ítem aún no tiene fecha comprometida — defínela antes de avanzar.</p></div>'
      : '';
    var bloqueFecha =
      avisoFecha +
      '<div class="sigso-acciones-item">' +
      '<input type="datetime-local" class="sigso-fecha-comprometida" data-subsolicitud="' + sub.subsolicitud_id + '" value="' + Componentes.escaparHtml(sub.fecha_comprometida || sub.fecha_propuesta || '') + '">' +
      '<input type="text" class="sigso-motivo-fecha' + (yaComprometida ? '' : ' sigso-oculto') + '" data-subsolicitud="' + sub.subsolicitud_id + '" placeholder="Motivo (min. 20 caracteres) para mover una fecha ya comprometida">' +
      '<button type="button" class="' + (faltaComprometer ? 'sigso-boton' : 'sigso-boton--secundario') + ' sigso-aplicar-fecha" data-subsolicitud="' + sub.subsolicitud_id + '">' + (yaComprometida ? 'Ajustar fecha comprometida' : 'Comprometer fecha') + '</button>' +
      '<span class="sigso-resultado-accion" data-subsolicitud="' + sub.subsolicitud_id + '-fecha"></span>' +
      '</div>';

    return '<h4 class="sigso-titulo-accion">Fecha comprometida</h4>' + bloqueFecha +
      selectorEstado +
      '<h4 class="sigso-titulo-accion">Prioridad</h4>' +
      '<div class="sigso-acciones-item">' +
      '<select class="sigso-nueva-prioridad" data-subsolicitud="' + sub.subsolicitud_id + '">' +
      ['P1', 'P2', 'P3', 'P4', 'P5'].map(function (p) {
        return '<option value="' + p + '"' + (p === sub.prioridad ? ' selected' : '') + '>' + p + '</option>';
      }).join('') +
      '</select>' +
      '<input type="text" class="sigso-justificacion-prioridad" data-subsolicitud="' + sub.subsolicitud_id + '" placeholder="Justificacion (min. 20 caracteres) para cambiar prioridad">' +
      '<button type="button" class="sigso-boton--secundario sigso-aplicar-prioridad" data-subsolicitud="' + sub.subsolicitud_id + '">Cambiar prioridad</button>' +
      '<span class="sigso-resultado-accion" data-subsolicitud="' + sub.subsolicitud_id + '-prioridad"></span>' +
      '</div>' +
      renderBloqueDerivar_(sub);
  }

  // v3.1 (§2.6): pasar el item a otro responsable. Va al final del panel
  // porque no es una accion del dia a dia (a diferencia de fecha/estado),
  // pero tiene que estar a mano y no escondida en Administracion.
  function renderBloqueDerivar_(sub) {
    var responsables = (detalleActual && detalleActual.responsables) || [];
    if (!responsables.length) {
      return '';
    }
    var actual = sub.desarrollador_asignado || '';
    var opciones = responsables
      // Derivarle a quien ya lo tiene no hace nada; no se ofrece.
      .filter(function (r) { return r.email !== actual; })
      .map(function (r) {
        return '<option value="' + Componentes.escaparHtml(r.email) + '">' +
          Componentes.escaparHtml(r.nombre) + '</option>';
      }).join('');
    if (!opciones) {
      return '';
    }

    return '<h4 class="sigso-titulo-accion">Derivar</h4>' +
      '<div class="sigso-acciones-item">' +
      '<p class="sigso-ayuda">Responsable actual: <strong>' +
      Componentes.escaparHtml(actual || 'sin asignar') + '</strong></p>' +
      '<select class="sigso-nuevo-responsable" data-subsolicitud="' + sub.subsolicitud_id + '">' +
      '<option value="">Derivar a…</option>' + opciones +
      '</select>' +
      '<input type="text" class="sigso-motivo-derivacion" data-subsolicitud="' + sub.subsolicitud_id + '" placeholder="Motivo (min. 10 caracteres)">' +
      '<button type="button" class="sigso-boton--secundario sigso-aplicar-derivacion" data-subsolicitud="' + sub.subsolicitud_id + '">Derivar ítem</button>' +
      '<span class="sigso-resultado-accion" data-subsolicitud="' + sub.subsolicitud_id + '-derivacion"></span>' +
      '</div>';
  }

  function renderCampoDato_(etiqueta, valorHtml) {
    return '<dt>' + Componentes.escaparHtml(etiqueta) + '</dt><dd>' + valorHtml + '</dd>';
  }

  // 'YYYY-MM-DDTHH:MM[:SS.mmmZ]' -> 'YYYY-MM-DD HH:MM' (sin segundos ni la
  // Z de UTC, que en pantalla solo confunden).
  function fechaCorta_(valor) {
    return String(valor).replace('T', ' ').slice(0, 16);
  }

  function renderGaleria_(archivos) {
    return Componentes.galeriaImagenes((archivos || []).map(function (a) {
      var esImagen = String(a.tipo_mime || '').indexOf('image/') === 0;
      return { url: a.url, nombre: a.nombre_original, descripcion: esImagen ? '' : a.nombre_original };
    }));
  }

  // --- Columna derecha: historia unificada (estados + comentarios) ------

  function renderHistoria_(detalle) {
    var s = detalle.solicitud;
    var subsolicitudes = detalle.subsolicitudes || [];
    var eventos = (detalle.historial_estados || []).map(function (h) {
      // Propuesta 5: el evento de creacion (estado_anterior vacio) solo
      // decia "Nueva -- sistema" -- se enriquece con quien pidio que y
      // cuantos items trae, usando datos que getDetalle ya trae (sin tocar
      // el backend).
      var esCreacion = h.estado_anterior === '';
      var comentario = h.comentario;
      if (esCreacion) {
        comentario = (comentario ? comentario + ' — ' : '') +
          'Solicitada por ' + (s.solicitante_nombre || 'desconocido') +
          (s.solicitante_cargo ? ' (' + s.solicitante_cargo + ')' : '') +
          ' · ' + resumenTiposItems_(subsolicitudes);
      }
      return {
        tipo: 'estado', timestamp: h.timestamp, usuario: h.usuario,
        texto: formatearEstadoSigso(h.estado_nuevo), comentario: comentario
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
    })).concat((detalle.historial_asignacion || []).map(function (h) {
      // v3.1 (§2.3): las derivaciones van al mismo timeline que estados,
      // comentarios y compromisos -- "quien tiene esto ahora" es parte de la
      // historia de la solicitud, no un dato aparte.
      return {
        tipo: 'asignacion', timestamp: h.timestamp, usuario: h.usuario,
        texto: 'Derivada a ' + h.responsable_nuevo +
          (h.responsable_anterior ? ' (antes: ' + h.responsable_anterior + ')' : ''),
        comentario: h.motivo
      };
    })).sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });

    // UI-2 (§5): icono por tipo de evento para escanear el timeline sin leer.
    function iconoEvento_(e) {
      if (e.tipo === 'estado') return '🔄';
      if (e.tipo === 'compromiso') return '📅';
      if (e.tipo === 'asignacion') return '↪️';
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
    // nunca descubre el requisito DESPUES de intentar. El candado
    // accionEnCurso evita que un segundo clic (en este u otro boton)
    // dispare otra transicion mientras la primera esta en vuelo.
    document.querySelectorAll('.sigso-accion-estado').forEach(function (boton) {
      boton.addEventListener('click', function () {
        if (accionEnCurso) return;
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
        bloquearAcciones_(boton);
        enviarCambioEstado_(solicitudId, subId, estado, campoComentario ? campoComentario.value : '');
      });
    });

    document.querySelectorAll('.sigso-aplicar-fecha').forEach(function (boton) {
      boton.addEventListener('click', function () {
        if (accionEnCurso) return;
        var subId = boton.getAttribute('data-subsolicitud');
        var fecha = document.querySelector('.sigso-fecha-comprometida[data-subsolicitud="' + subId + '"]').value;
        var motivo = document.querySelector('.sigso-motivo-fecha[data-subsolicitud="' + subId + '"]').value;
        bloquearAcciones_(boton);
        enviarCompromisoFecha_(solicitudId, subId, fecha, motivo);
      });
    });

    document.querySelectorAll('.sigso-aplicar-prioridad').forEach(function (boton) {
      boton.addEventListener('click', function () {
        if (accionEnCurso) return;
        var subId = boton.getAttribute('data-subsolicitud');
        var prioridad = document.querySelector('.sigso-nueva-prioridad[data-subsolicitud="' + subId + '"]').value;
        var justificacion = document.querySelector('.sigso-justificacion-prioridad[data-subsolicitud="' + subId + '"]').value;
        bloquearAcciones_(boton);
        enviarCambioPrioridad_(solicitudId, subId, prioridad, justificacion);
      });
    });

    document.querySelectorAll('.sigso-aplicar-derivacion').forEach(function (boton) {
      boton.addEventListener('click', function () {
        if (accionEnCurso) return;
        var subId = boton.getAttribute('data-subsolicitud');
        var responsable = document.querySelector('.sigso-nuevo-responsable[data-subsolicitud="' + subId + '"]').value;
        var motivo = document.querySelector('.sigso-motivo-derivacion[data-subsolicitud="' + subId + '"]').value;
        var span = document.querySelector('.sigso-resultado-accion[data-subsolicitud="' + subId + '-derivacion"]');
        // Chequeos locales para ahorrar el viaje redondo; el backend
        // re-valida ambos igual.
        if (!responsable) {
          if (span) span.textContent = 'Elige a quién derivar el ítem.';
          return;
        }
        if (motivo.trim().length < 10) {
          if (span) span.textContent = 'El motivo debe tener al menos 10 caracteres.';
          return;
        }
        bloquearAcciones_(boton);
        enviarDerivacion_(solicitudId, subId, responsable, motivo);
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
          // La recarga reemplaza los botones (quedan habilitados de fabrica);
          // solo hay que soltar el candado cuando termina.
          return window.SigsoDetalle.cargar(solicitudId).then(function () { accionEnCurso = false; });
        }
        desbloquearAcciones_();
        var span = document.querySelector('.sigso-resultado-accion[data-subsolicitud="' + subsolicitudId + '"]');
        if (span) span.textContent = respuesta.message || 'No se pudo aplicar el cambio.';
      })
      .catch(function () {
        desbloquearAcciones_();
        var span = document.querySelector('.sigso-resultado-accion[data-subsolicitud="' + subsolicitudId + '"]');
        if (span) span.textContent = 'No se pudo conectar con el servidor. Intenta nuevamente.';
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
        return window.SigsoDetalle.cargar(solicitudId).then(function () { accionEnCurso = false; });
      }
      desbloquearAcciones_();
      var span = document.querySelector('.sigso-resultado-accion[data-subsolicitud="' + subsolicitudId + '-fecha"]');
      if (span) span.textContent = respuesta.message || 'No se pudo comprometer la fecha.';
    }).catch(function () {
      desbloquearAcciones_();
      var span = document.querySelector('.sigso-resultado-accion[data-subsolicitud="' + subsolicitudId + '-fecha"]');
      if (span) span.textContent = 'No se pudo conectar con el servidor. Intenta nuevamente.';
    });
  }

  // v3.1 (§2): derivar el item a otro responsable. Tras derivarlo puede
  // desaparecer de la bandeja propia (si quien deriva es DEV), pero la vista
  // de detalle se abre por id, asi que la recarga sigue siendo valida.
  function enviarDerivacion_(solicitudId, subsolicitudId, responsableNuevo, motivo) {
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'derivarSolicitud', {
      solicitud_id: solicitudId, subsolicitud_id: subsolicitudId,
      responsable_nuevo: responsableNuevo, motivo: motivo
    }).then(function (respuesta) {
      if (respuesta.ok) {
        return window.SigsoDetalle.cargar(solicitudId).then(function () { accionEnCurso = false; });
      }
      desbloquearAcciones_();
      var span = document.querySelector('.sigso-resultado-accion[data-subsolicitud="' + subsolicitudId + '-derivacion"]');
      if (span) span.textContent = respuesta.message || 'No se pudo derivar el ítem.';
    }).catch(function () {
      desbloquearAcciones_();
      var span = document.querySelector('.sigso-resultado-accion[data-subsolicitud="' + subsolicitudId + '-derivacion"]');
      if (span) span.textContent = 'No se pudo conectar con el servidor. Intenta nuevamente.';
    });
  }

  function enviarCambioPrioridad_(solicitudId, subsolicitudId, prioridadNueva, justificacion) {
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'actualizarPrioridad', { subsolicitud_id: subsolicitudId, prioridad_nueva: prioridadNueva, justificacion: justificacion })
      .then(function (respuesta) {
        if (respuesta.ok) {
          return window.SigsoDetalle.cargar(solicitudId).then(function () { accionEnCurso = false; });
        }
        desbloquearAcciones_();
        var span = document.querySelector('.sigso-resultado-accion[data-subsolicitud="' + subsolicitudId + '-prioridad"]');
        if (span) span.textContent = respuesta.message || 'No se pudo aplicar el cambio.';
      })
      .catch(function () {
        desbloquearAcciones_();
        var span = document.querySelector('.sigso-resultado-accion[data-subsolicitud="' + subsolicitudId + '-prioridad"]');
        if (span) span.textContent = 'No se pudo conectar con el servidor. Intenta nuevamente.';
      });
  }
})();
