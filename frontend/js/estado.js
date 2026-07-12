/**
 * estado.js — consulta publica de estado por numero + correo (§3.2, §12.1).
 *
 * Version interina: el correo se envia y se compara directo contra el
 * registrado (ver nota en backend/intake/Solicitudes.gs, estadoPublico). El
 * magic link real (token por Gmail) llega en la Fase 4.
 */
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    if (typeof renderHeaderSigso === 'function') {
      renderHeaderSigso('estado');
    }

    var parametros = new URLSearchParams(window.location.search);
    var idPrellenado = parametros.get('id');
    if (idPrellenado) {
      document.getElementById('campo-numero-solicitud').value = idPrellenado;
    }

    document.getElementById('form-estado').addEventListener('submit', manejarConsulta_);

    manejarTabs_();
    document.getElementById('form-pedir-codigo').addEventListener('submit', manejarPedirCodigo_);
    document.getElementById('form-verificar-codigo').addEventListener('submit', manejarVerificarCodigo_);
    document.getElementById('btn-reenviar-codigo').addEventListener('click', function () {
      manejarPedirCodigo_({ preventDefault: function () {} });
    });
    poblarFiltroEstados_();
    ['filtro-mis-buscador', 'filtro-mis-estado', 'filtro-mis-desde', 'filtro-mis-hasta'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', renderListaFiltrada_);
    });
  });

  // Se recuerda la ultima consulta exitosa para poder recargar el estado
  // despues de que el solicitante responda una pregunta (sin pedirle de
  // nuevo el numero+correo). contenedorId distingue si el detalle vive en la
  // pestaña "Por numero" (#resultado) o en el drill-down de "Mis solicitudes"
  // (#detalle-mis-solicitudes) -- ambas reusan el mismo render/acciones.
  var ultimaConsulta = null;

  // v3.0 (Fase 3, §4): estado de la pestaña "Mis solicitudes".
  var correoParaCodigo_ = null;
  var sesionMisSolicitudes = null;
  var listaCompleta_ = [];

  function manejarTabs_() {
    document.querySelectorAll('.sigso-tabs__boton').forEach(function (boton) {
      boton.addEventListener('click', function () {
        document.querySelectorAll('.sigso-tabs__boton').forEach(function (b) {
          b.classList.remove('sigso-tabs__boton--activo');
        });
        boton.classList.add('sigso-tabs__boton--activo');
        var tab = boton.getAttribute('data-tab');
        document.getElementById('panel-numero').classList.toggle('sigso-oculto', tab !== 'numero');
        document.getElementById('panel-mis-solicitudes').classList.toggle('sigso-oculto', tab !== 'mis-solicitudes');
      });
    });
  }

  function manejarConsulta_(evento) {
    evento.preventDefault();
    var boton = document.getElementById('btn-consultar');
    var solicitudId = document.getElementById('campo-numero-solicitud').value.trim();
    var email = document.getElementById('campo-email-consulta').value.trim();

    ocultarResultado_();
    boton.disabled = true;
    boton.innerHTML = '<span class="sigso-spinner"></span> Consultando...';

    consultar_(solicitudId, email)
      .finally(function () {
        boton.disabled = false;
        boton.textContent = 'Consultar';
      });
  }

  // contenedorId: 'resultado' (pestaña "Por numero") o
  // 'detalle-mis-solicitudes' (drill-down de "Mis solicitudes") -- mismo
  // render y mismas acciones (responder/validar) en ambos casos.
  function consultar_(solicitudId, email, contenedorId) {
    var contenedor = contenedorId || 'resultado';
    return llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'consultarEstado', { solicitud_id: solicitudId, email: email })
      .then(function (respuesta) {
        if (respuesta.ok) {
          ultimaConsulta = { solicitud_id: solicitudId, email: email, contenedorId: contenedor };
          mostrarEstado_(respuesta.data, contenedor);
        } else {
          mostrarError_(respuesta, contenedor);
        }
      })
      .catch(function () {
        mostrarError_({ message: 'No se pudo conectar con el servidor. Intenta nuevamente.' }, contenedor);
      });
  }

  function mostrarEstado_(data, contenedorId) {
    var itemsHtml = data.subsolicitudes.map(function (s, idx) {
      var etiquetaTipo = s.tipo_nombre ? '[' + Componentes.escaparHtml(s.tipo_nombre) + '] ' : '';
      return '<div class="sigso-acordeon-item" data-idx="' + idx + '" data-pregunta-pendiente="' + (s.pregunta_pendiente ? '1' : '0') + '">' +
        '<div class="sigso-acordeon-item__cabecera" data-accion="expandir" data-idx="' + idx + '">' +
        '<span>' + etiquetaTipo + Componentes.escaparHtml(s.titulo) + '</span>' +
        Componentes.badgePrioridad(s.prioridad) + ' ' + Componentes.badgeEstado(s.estado) +
        '</div>' +
        '<div class="sigso-acordeon-item__cuerpo">' + cuerpoItem_(s) + '</div>' +
        '</div>';
    }).join('');

    var pdf = data.url_pdf ? '<p><a href="' + data.url_pdf + '" target="_blank" rel="noopener">Ver documento PDF</a></p>' : '';

    // P2 (v2.0, Sprint 2): "cuantas hay antes que yo" -- solo se muestra si
    // sigue abierta (posicion_cola es null cuando ya esta cerrada/rechazada).
    var cola = '';
    if (typeof data.posicion_cola === 'number') {
      cola = data.posicion_cola > 0
        ? '<p class="sigso-ayuda">Hay ' + data.posicion_cola + ' solicitud(es) de tu empresa con igual o mayor prioridad por delante.</p>'
        : '<p class="sigso-ayuda">Eres la solicitud de mayor prioridad en espera de tu empresa.</p>';
    }

    var contenedor = document.getElementById(contenedorId || 'resultado');
    contenedor.innerHTML =
      '<div class="sigso-resultado-exito">' +
      renderBannerAcciones_(data) +
      '<p class="sigso-numero-solicitud">' + data.solicitud_id + '</p>' +
      renderHitos_(data.estado_derivado) +
      '<p>Estado: <strong>' + formatearEstadoSigso(data.estado_derivado) + '</strong>' +
      ' &mdash; Prioridad: ' + Componentes.badgePrioridad(data.prioridad_derivada) + '</p>' +
      renderFechaComprometidaResumen_(data) +
      cola +
      '<p class="sigso-ayuda">Haz clic en cada &iacute;tem para ver su detalle.</p>' +
      pdf +
      itemsHtml +
      '</div>';

    // Expandir/colapsar el detalle de cada item al hacer clic en la cabecera.
    contenedor.querySelectorAll('[data-accion="expandir"]').forEach(function (el) {
      el.addEventListener('click', function () {
        el.parentElement.classList.toggle('sigso-acordeon-item--activo');
      });
    });

    // Fase 10.1: si el item esta "esperando informacion" (S06), Leo dejo una
    // pregunta -- se responde desde aqui mismo, sin llamar/escribir aparte.
    contenedor.querySelectorAll('[data-accion="enviar-respuesta"]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        enviarRespuesta_(boton.getAttribute('data-subsolicitud'));
      });
    });

    // RN-201: validacion del solicitante sobre un item "Terminada".
    contenedor.querySelectorAll('[data-accion="confirmar-cierre"]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        enviarValidacion_(boton.getAttribute('data-subsolicitud'), 'confirmar');
      });
    });
    contenedor.querySelectorAll('[data-accion="mostrar-reabrir"]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        var bloque = contenedor.querySelector('[data-bloque-reabrir="' + boton.getAttribute('data-subsolicitud') + '"]');
        bloque.classList.toggle('sigso-oculto');
      });
    });
    contenedor.querySelectorAll('[data-accion="enviar-reabrir"]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        var subId = boton.getAttribute('data-subsolicitud');
        var comentario = document.getElementById('motivo-reabrir-' + subId).value.trim();
        if (!comentario) {
          document.querySelector('[data-resultado-validacion="' + subId + '"]').innerHTML =
            Componentes.alerta('Cuéntanos qué falta antes de reabrir.', 'error');
          return;
        }
        enviarValidacion_(subId, 'reabrir', comentario);
      });
    });

    // Expande automaticamente items con pregunta pendiente: son los que mas
    // le importan al solicitante en ese momento.
    contenedor.querySelectorAll('.sigso-acordeon-item[data-pregunta-pendiente="1"]').forEach(function (el) {
      el.classList.add('sigso-acordeon-item--activo');
    });

    contenedor.classList.remove('sigso-oculto');
  }

  // UI-3 (§3): linea de tiempo horizontal de hitos -- el solicitante ve el
  // camino recorrido y cuanto falta, no solo una palabra de estado. Los
  // estados intermedios se agrupan en 5 hitos legibles; Rechazada/Cancelada
  // no siguen el camino, se muestran como aviso en vez de barra.
  var HITOS = ['Recibida', 'Aprobada', 'En desarrollo', 'Terminada', 'Cerrada'];
  var NIVEL_POR_ESTADO = {
    S01: 0, S02: 0, S03: 1, S04: 1, S05: 2, S06: 2, S07: 2, S08: 3, S09: 4
  };

  function renderHitos_(estadoDerivado) {
    if (estadoDerivado === 'S10' || estadoDerivado === 'S11') {
      return Componentes.alerta('Esta solicitud fue ' +
        (estadoDerivado === 'S10' ? 'rechazada' : 'cancelada') +
        '. Revisa el detalle de los ítems para ver el motivo.', 'aviso');
    }
    var nivel = NIVEL_POR_ESTADO[estadoDerivado];
    if (nivel === undefined) return '';
    var cerrada = estadoDerivado === 'S09';
    return '<div class="sigso-hitos">' + HITOS.map(function (nombre, idx) {
      var clase = 'sigso-hito';
      var marcador = idx + 1;
      if (idx < nivel || cerrada) { clase += ' sigso-hito--hecho'; marcador = '✓'; }
      else if (idx === nivel) { clase += ' sigso-hito--actual'; marcador = '●'; }
      return '<span class="' + clase + '"><span class="sigso-hito__n">' + marcador + '</span>' + nombre + '</span>';
    }).join('<span class="sigso-hito__union"></span>') + '</div>';
  }

  // UI-3 (§3): si el solicitante tiene algo que HACER (validar un item
  // Terminada, o responder una pregunta), se le dice arriba de todo -- es
  // lo unico realmente urgente de esta pantalla.
  function renderBannerAcciones_(data) {
    var porValidar = data.subsolicitudes.filter(function (s) { return s.estado === 'S08'; }).length;
    var porResponder = data.subsolicitudes.filter(function (s) { return s.pregunta_pendiente; }).length;
    var avisos = [];
    if (porValidar > 0) avisos.push(porValidar + ' ítem(s) esperando tu validación');
    if (porResponder > 0) avisos.push(porResponder + ' pregunta(s) del equipo por responder');
    if (avisos.length === 0) return '';
    return '<div class="sigso-banner-accion">⚡ Tienes ' + avisos.join(' y ') +
      ' — están más abajo, expandidos.</div>';
  }

  // UI-3 (§3): la fecha comprometida mas proxima entre los items abiertos,
  // con su semaforo -- es lo que el solicitante realmente quiere saber.
  function renderFechaComprometidaResumen_(data) {
    var abiertosConFecha = data.subsolicitudes.filter(function (s) {
      return s.fecha_comprometida && ['S09', 'S10', 'S11'].indexOf(s.estado) === -1;
    }).sort(function (a, b) { return new Date(a.fecha_comprometida) - new Date(b.fecha_comprometida); });
    if (abiertosConFecha.length === 0) return '';
    var item = abiertosConFecha[0];
    var semaforo = item.cumplimiento
      ? ' <span class="sigso-semaforo-inline">' + item.cumplimiento.emoji + ' ' + Componentes.escaparHtml(item.cumplimiento.etiqueta) + '</span>'
      : '';
    return '<div class="sigso-fecha-destacada">📅 Próxima entrega comprometida: <strong>' +
      Componentes.escaparHtml(formatearFechaHora_(item.fecha_comprometida)) + '</strong>' + semaforo +
      (abiertosConFecha.length > 1 ? ' <span class="sigso-ayuda-inline">(+' + (abiertosConFecha.length - 1) + ' ítem(s) más con fecha)</span>' : '') +
      '</div>';
  }

  function cuerpoItem_(s) {
    var filas = '';
    if (s.modulo_nombre) filas += campo_('Módulo', s.modulo_nombre);
    if (s.descripcion) filas += campo_('Lo que reportaste', s.descripcion);
    if (s.resultado_esperado) filas += campo_('Resultado esperado', s.resultado_esperado);
    if (s.contexto) filas += campo_('Contexto', s.contexto);
    // v2.1 (Fase A): la fecha comprometida por el desarrollador es la
    // definitiva -- se muestra primero y con mas peso que la propuesta.
    if (s.fecha_comprometida) {
      filas += campo_('Fecha comprometida', formatearFechaHora_(s.fecha_comprometida));
    } else if (s.fecha_propuesta) {
      filas += '<p class="sigso-ayuda">Para cuándo lo pediste: ' + Componentes.escaparHtml(formatearFechaHora_(s.fecha_propuesta)) + ' (a confirmar por el equipo).</p>';
    }
    if (s.pregunta_pendiente) {
      filas += Componentes.alerta('El equipo necesita más información: ' + s.pregunta_pendiente, 'aviso') +
        '<div class="sigso-campo">' +
        '<label for="respuesta-' + s.subsolicitud_id + '">Tu respuesta</label>' +
        '<textarea id="respuesta-' + s.subsolicitud_id + '" data-campo="respuesta" data-subsolicitud="' + s.subsolicitud_id + '"></textarea>' +
        '</div>' +
        '<button type="button" class="sigso-boton--secundario" data-accion="enviar-respuesta" data-subsolicitud="' + s.subsolicitud_id + '">Enviar respuesta</button>' +
        '<div data-resultado-respuesta="' + s.subsolicitud_id + '"></div>';
    }
    // RN-201 (v2.0, Sprint 1): un item "Terminada" (S08) espera la
    // validacion del solicitante -- confirmar que quedo resuelto (se cierra)
    // o indicar que falta (vuelve a En desarrollo). Si nadie valida, se
    // cierra solo tras unos dias (Triggers.cerrarInactivosTrigger, Backoffice).
    if (s.estado === 'S08') {
      filas += Componentes.alerta('Este ítem está terminado. Confírmalo si quedó resuelto, o cuéntanos si no.', 'aviso') +
        '<div class="sigso-acciones-item">' +
        '<button type="button" class="sigso-boton" data-accion="confirmar-cierre" data-subsolicitud="' + s.subsolicitud_id + '">Confirmar y cerrar</button> ' +
        '<button type="button" class="sigso-boton--secundario" data-accion="mostrar-reabrir" data-subsolicitud="' + s.subsolicitud_id + '">No quedó resuelto</button>' +
        '</div>' +
        '<div class="sigso-oculto" data-bloque-reabrir="' + s.subsolicitud_id + '">' +
        '<div class="sigso-campo">' +
        '<label for="motivo-reabrir-' + s.subsolicitud_id + '">Cuéntanos qué falta</label>' +
        '<textarea id="motivo-reabrir-' + s.subsolicitud_id + '" data-campo="motivo-reabrir" data-subsolicitud="' + s.subsolicitud_id + '"></textarea>' +
        '</div>' +
        '<button type="button" class="sigso-boton--secundario" data-accion="enviar-reabrir" data-subsolicitud="' + s.subsolicitud_id + '">Enviar</button>' +
        '</div>' +
        '<div data-resultado-validacion="' + s.subsolicitud_id + '"></div>';
    }
    return filas || '<p class="sigso-ayuda">Sin detalle adicional.</p>';
  }

  function enviarRespuesta_(subsolicitudId) {
    var textarea = document.getElementById('respuesta-' + subsolicitudId);
    var boton = document.querySelector('[data-accion="enviar-respuesta"][data-subsolicitud="' + subsolicitudId + '"]');
    var contenedorResultado = document.querySelector('[data-resultado-respuesta="' + subsolicitudId + '"]');
    var texto = textarea.value.trim();
    if (!texto) {
      contenedorResultado.innerHTML = Componentes.alerta('Escribe una respuesta antes de enviar.', 'error');
      return;
    }

    boton.disabled = true;
    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'responderConsulta', {
      solicitud_id: ultimaConsulta.solicitud_id,
      subsolicitud_id: subsolicitudId,
      email: ultimaConsulta.email,
      texto: texto
    }).then(function (respuesta) {
      if (!respuesta.ok) {
        contenedorResultado.innerHTML = Componentes.alerta(respuesta.message || 'No se pudo enviar la respuesta.', 'error');
        boton.disabled = false;
        return;
      }
      // Recarga el estado: el item sigue en "esperando informacion" hasta
      // que Leo lo mueva, pero la respuesta ya quedo registrada.
      return consultar_(ultimaConsulta.solicitud_id, ultimaConsulta.email, ultimaConsulta.contenedorId);
    });
  }

  function enviarValidacion_(subsolicitudId, accion, comentario) {
    var contenedorResultado = document.querySelector('[data-resultado-validacion="' + subsolicitudId + '"]');
    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'validarCierre', {
      solicitud_id: ultimaConsulta.solicitud_id,
      subsolicitud_id: subsolicitudId,
      email: ultimaConsulta.email,
      accion: accion,
      comentario: comentario || ''
    }).then(function (respuesta) {
      if (!respuesta.ok) {
        contenedorResultado.innerHTML = Componentes.alerta(respuesta.message || 'No se pudo aplicar la validacion.', 'error');
        return;
      }
      return consultar_(ultimaConsulta.solicitud_id, ultimaConsulta.email, ultimaConsulta.contenedorId);
    });
  }

  // Acepta 'YYYY-MM-DD' o 'YYYY-MM-DDTHH:MM' (ver Fase A, fecha_propuesta);
  // se muestra tal cual sin hora si no la trae, para no inventar un "00:00".
  function formatearFechaHora_(valor) {
    var partes = String(valor).split('T');
    if (partes.length < 2) return partes[0];
    return partes[0] + ' ' + partes[1].slice(0, 5);
  }

  function campo_(etiqueta, valor) {
    return '<p><strong>' + Componentes.escaparHtml(etiqueta) + ':</strong> ' + Componentes.escaparHtml(valor) + '</p>';
  }

  function mostrarError_(respuesta, contenedorId) {
    var mensaje = respuesta.message || 'No se pudo consultar el estado.';
    var contenedor = document.getElementById(contenedorId || 'resultado');
    contenedor.innerHTML = Componentes.alerta(mensaje, 'error');
    contenedor.classList.remove('sigso-oculto');
  }

  function ocultarResultado_() {
    var contenedor = document.getElementById('resultado');
    contenedor.classList.add('sigso-oculto');
    contenedor.innerHTML = '';
  }

  // ------------------------------------------------------------------
  // v3.0 (Fase 3, §4): "Mis solicitudes" -- codigo de un solo uso, lista
  // filtrable con resumen y semaforo del solicitante, drill-down (reusa
  // consultar_/mostrarEstado_ de arriba, apuntando a #detalle-mis-solicitudes).
  // ------------------------------------------------------------------

  function manejarPedirCodigo_(evento) {
    evento.preventDefault();
    var email = document.getElementById('campo-email-mis-solicitudes').value.trim();
    if (!email) return;

    var boton = document.getElementById('btn-pedir-codigo');
    var resultado = document.getElementById('resultado-verificar-codigo');
    boton.disabled = true;

    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'solicitarCodigoAcceso', { email: email })
      .then(function () {
        correoParaCodigo_ = email;
        document.getElementById('form-pedir-codigo').classList.add('sigso-oculto');
        document.getElementById('form-verificar-codigo').classList.remove('sigso-oculto');
        document.getElementById('texto-codigo-enviado').textContent =
          'Te enviamos un código a ' + email + '. Puede tardar unos minutos en llegar.';
        resultado.innerHTML = '';
      })
      .catch(function () {
        resultado.innerHTML = Componentes.alerta('No se pudo enviar el código. Intenta nuevamente.', 'error');
      })
      .finally(function () {
        boton.disabled = false;
      });
  }

  function manejarVerificarCodigo_(evento) {
    evento.preventDefault();
    var codigo = document.getElementById('campo-codigo-acceso').value.trim();
    var boton = document.getElementById('btn-verificar-codigo');
    var resultado = document.getElementById('resultado-verificar-codigo');
    boton.disabled = true;

    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'misSolicitudes', { email: correoParaCodigo_, codigo: codigo })
      .then(function (respuesta) {
        if (!respuesta.ok) {
          resultado.innerHTML = Componentes.alerta(respuesta.message || 'Código inválido o expirado.', 'error');
          return;
        }
        sesionMisSolicitudes = { email: correoParaCodigo_ };
        listaCompleta_ = respuesta.data.solicitudes;
        document.getElementById('form-verificar-codigo').classList.add('sigso-oculto');
        document.getElementById('panel-lista-mis-solicitudes').classList.remove('sigso-oculto');
        renderResumenMisSolicitudes_(respuesta.data.resumen);
        renderListaFiltrada_();
      })
      .catch(function () {
        resultado.innerHTML = Componentes.alerta('No se pudo verificar el código.', 'error');
      })
      .finally(function () {
        boton.disabled = false;
      });
  }

  function renderResumenMisSolicitudes_(resumen) {
    document.getElementById('resumen-mis-solicitudes').innerHTML =
      '<p><strong>' + resumen.total + '</strong> solicitud(es) — ' +
      resumen.abiertas + ' abierta(s), ' +
      resumen.en_desarrollo + ' en desarrollo, ' +
      resumen.pendientes_validar + ' ítem(s) pendiente(s) de validar.</p>';
  }

  function poblarFiltroEstados_() {
    var select = document.getElementById('filtro-mis-estado');
    Object.keys(SIGSO_ESTADOS_LABEL).forEach(function (codigo) {
      var option = document.createElement('option');
      option.value = codigo;
      option.textContent = SIGSO_ESTADOS_LABEL[codigo];
      select.appendChild(option);
    });
  }

  function renderListaFiltrada_() {
    var texto = document.getElementById('filtro-mis-buscador').value.trim().toLowerCase();
    var estado = document.getElementById('filtro-mis-estado').value;
    var desde = document.getElementById('filtro-mis-desde').value;
    var hasta = document.getElementById('filtro-mis-hasta').value;

    var filtradas = listaCompleta_.filter(function (s) {
      if (estado && s.estado_derivado !== estado) return false;
      var fechaDia = String(s.fecha_creacion).slice(0, 10);
      if (desde && fechaDia < desde) return false;
      if (hasta && fechaDia > hasta) return false;
      if (texto) {
        var haystack = (s.solicitud_id + ' ' + (s.empresa_nombre || '')).toLowerCase();
        if (haystack.indexOf(texto) === -1) return false;
      }
      return true;
    });

    var contenedor = document.getElementById('lista-mis-solicitudes');
    if (filtradas.length === 0) {
      contenedor.innerHTML = Componentes.vacio('No hay solicitudes que coincidan con el filtro.');
      return;
    }

    contenedor.innerHTML = filtradas.map(function (s) {
      var semaforo = s.items_pendientes_validar > 0
        ? '<div class="sigso-bandeja__semaforo">🔵 Llevas ' + (s.dias_esperando_max || 0) +
          ' día(s) sin revisar ' + s.items_pendientes_validar + ' ítem(s)</div>'
        : '';
      return '<button type="button" class="sigso-bandeja__fila" data-solicitud="' + s.solicitud_id + '">' +
        '<div class="sigso-bandeja__fila-cabecera">' +
        '<strong class="sigso-id">' + Componentes.escaparHtml(s.solicitud_id) + '</strong>' +
        '<span>' + Componentes.badgePrioridad(s.prioridad_derivada) + ' ' + Componentes.badgeEstado(s.estado_derivado) + '</span>' +
        '</div>' +
        '<div class="sigso-bandeja__fila-meta">' +
        Componentes.escaparHtml(s.empresa_nombre || '') + ' — ' + formatearFechaHora_(s.fecha_creacion) +
        ' — ' + s.total_items + ' ítem(s)</div>' +
        semaforo +
        '</button>';
    }).join('');

    contenedor.querySelectorAll('[data-solicitud]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        contenedor.querySelectorAll('.sigso-bandeja__fila').forEach(function (fila) {
          fila.classList.remove('sigso-bandeja__fila--activa');
        });
        boton.classList.add('sigso-bandeja__fila--activa');
        var detalle = document.getElementById('detalle-mis-solicitudes');
        detalle.classList.remove('sigso-oculto');
        detalle.innerHTML = Componentes.cargando('Cargando detalle...');
        consultar_(boton.getAttribute('data-solicitud'), sesionMisSolicitudes.email, 'detalle-mis-solicitudes');
      });
    });
  }
})();
