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

  function manejarConsulta_(evento) {
    evento.preventDefault();
    var boton = document.getElementById('btn-consultar');
    var solicitudId = document.getElementById('campo-numero-solicitud').value.trim();
    var email = document.getElementById('campo-email-consulta').value.trim();

    ocultarResultado_();
    boton.disabled = true;
    boton.innerHTML = '<span class="sigso-spinner"></span> Consultando...';

    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'consultarEstado', { solicitud_id: solicitudId, email: email })
      .then(function (respuesta) {
        if (respuesta.ok) {
          mostrarEstado_(respuesta.data);
        } else {
          mostrarError_(respuesta);
        }
      })
      .catch(function () {
        mostrarError_({ message: 'No se pudo conectar con el servidor. Intenta nuevamente.' });
      })
      .finally(function () {
        boton.disabled = false;
        boton.textContent = 'Consultar';
      });
  }

  function mostrarEstado_(data) {
    var itemsHtml = data.subsolicitudes.map(function (s) {
      var etiquetaTipo = s.tipo_nombre ? '[' + Componentes.escaparHtml(s.tipo_nombre) + '] ' : '';
      return '<div class="sigso-acordeon-item">' +
        '<div class="sigso-acordeon-item__cabecera">' +
        '<span>' + etiquetaTipo + Componentes.escaparHtml(s.titulo) + '</span>' +
        Componentes.badgePrioridad(s.prioridad) + ' ' + Componentes.badgeEstado(s.estado) +
        '</div></div>';
    }).join('');

    var pdf = data.url_pdf ? '<p><a href="' + data.url_pdf + '" target="_blank" rel="noopener">Ver documento PDF</a></p>' : '';

    document.getElementById('resultado').innerHTML =
      '<div class="sigso-resultado-exito">' +
      '<p class="sigso-numero-solicitud">' + data.solicitud_id + '</p>' +
      '<p>Estado: <strong>' + formatearEstadoSigso(data.estado_derivado) + '</strong>' +
      ' &mdash; Prioridad: ' + Componentes.badgePrioridad(data.prioridad_derivada) + '</p>' +
      pdf +
      itemsHtml +
      '</div>';
    document.getElementById('resultado').classList.remove('sigso-oculto');
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
