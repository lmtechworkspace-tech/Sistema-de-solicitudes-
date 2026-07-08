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
  });

  // Se recuerda la ultima consulta exitosa para poder recargar el estado
  // despues de que el solicitante responda una pregunta (sin pedirle de
  // nuevo el numero+correo).
  var ultimaConsulta = null;

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

  function consultar_(solicitudId, email) {
    return llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'consultarEstado', { solicitud_id: solicitudId, email: email })
      .then(function (respuesta) {
        if (respuesta.ok) {
          ultimaConsulta = { solicitud_id: solicitudId, email: email };
          mostrarEstado_(respuesta.data);
        } else {
          mostrarError_(respuesta);
        }
      })
      .catch(function () {
        mostrarError_({ message: 'No se pudo conectar con el servidor. Intenta nuevamente.' });
      });
  }

  function mostrarEstado_(data) {
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

    var contenedor = document.getElementById('resultado');
    contenedor.innerHTML =
      '<div class="sigso-resultado-exito">' +
      '<p class="sigso-numero-solicitud">' + data.solicitud_id + '</p>' +
      '<p>Estado: <strong>' + formatearEstadoSigso(data.estado_derivado) + '</strong>' +
      ' &mdash; Prioridad: ' + Componentes.badgePrioridad(data.prioridad_derivada) + '</p>' +
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

  function cuerpoItem_(s) {
    var filas = '';
    if (s.modulo_nombre) filas += campo_('Módulo', s.modulo_nombre);
    if (s.descripcion) filas += campo_('Lo que reportaste', s.descripcion);
    if (s.resultado_esperado) filas += campo_('Resultado esperado', s.resultado_esperado);
    if (s.contexto) filas += campo_('Contexto', s.contexto);
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
      return consultar_(ultimaConsulta.solicitud_id, ultimaConsulta.email);
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
      return consultar_(ultimaConsulta.solicitud_id, ultimaConsulta.email);
    });
  }

  function campo_(etiqueta, valor) {
    return '<p><strong>' + Componentes.escaparHtml(etiqueta) + ':</strong> ' + Componentes.escaparHtml(valor) + '</p>';
  }

  function mostrarError_(respuesta) {
    var mensaje = respuesta.message || 'No se pudo consultar el estado.';
    document.getElementById('resultado').innerHTML = Componentes.alerta(mensaje, 'error');
    document.getElementById('resultado').classList.remove('sigso-oculto');
  }

  function ocultarResultado_() {
    var contenedor = document.getElementById('resultado');
    contenedor.classList.add('sigso-oculto');
    contenedor.innerHTML = '';
  }
})();
