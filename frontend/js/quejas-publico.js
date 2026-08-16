/**
 * quejas-publico.js — v10.0 Fase 4 (PRO-07): formulario público de quejas,
 * felicitaciones y consultas. Sin cuenta, mismo criterio de transporte que
 * "Nueva solicitud" (index.html / formulario.js): llamarApi contra
 * INTAKE_URL, sin login.
 */
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    if (typeof renderHeaderSigso === 'function') renderHeaderSigso('quejas');

    var form = document.getElementById('form-queja');
    if (form) form.addEventListener('submit', manejarEnvio_);
  });

  function manejarEnvio_(evento) {
    evento.preventDefault();
    ocultarError_();

    var datos = {
      nombre_completo: valor_('q-nombre'),
      empresa: valor_('q-empresa'),
      rut: valor_('q-rut'),
      email: valor_('q-email'),
      telefono: valor_('q-telefono'),
      tipo: valor_('q-tipo'),
      area: valor_('q-area'),
      descripcion: valor_('q-descripcion'),
      canal: 'WEB'
    };

    var boton = document.getElementById('btn-enviar-queja');
    boton.disabled = true;
    boton.textContent = 'Enviando...';

    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'crearQuejaSgc', datos)
      .then(function (respuesta) {
        boton.disabled = false;
        boton.textContent = 'Enviar';
        if (!respuesta || !respuesta.ok) {
          mostrarError_((respuesta && respuesta.message) || 'No se pudo enviar tu mensaje. Intenta nuevamente.');
          return;
        }
        mostrarExito_(respuesta.data);
      })
      .catch(function () {
        boton.disabled = false;
        boton.textContent = 'Enviar';
        mostrarError_('No se pudo conectar. Revisa tu conexión e intenta nuevamente.');
      });
  }

  function valor_(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  function mostrarError_(mensaje) {
    var el = document.getElementById('queja-error');
    if (!el) return;
    el.textContent = mensaje;
    el.classList.remove('sigso-oculto');
  }

  function ocultarError_() {
    var el = document.getElementById('queja-error');
    if (el) el.classList.add('sigso-oculto');
  }

  var ETIQUETA_TIPO = { QUEJA: 'queja', RECLAMACION: 'reclamación', FELICITACION: 'felicitación', CONSULTA: 'consulta' };

  function mostrarExito_(data) {
    document.getElementById('form-queja').classList.add('sigso-oculto');
    var resultado = document.getElementById('resultado');
    var tipo = ETIQUETA_TIPO[data.tipo] || 'mensaje';
    resultado.innerHTML =
      '<h2>¡Gracias!</h2>' +
      '<p>Recibimos tu ' + esc_(tipo) + ' con el número <strong>' + esc_(data.correlativo) + '</strong>.</p>' +
      '<p>Te enviamos una confirmación a tu correo. Nuestro equipo la revisará y te dará respuesta ' +
      'en un plazo máximo de 30 días corridos.</p>' +
      '<p><a href="index.html">Volver al inicio</a></p>';
    resultado.classList.remove('sigso-oculto');
    resultado.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function esc_(texto) {
    var div = document.createElement('div');
    div.textContent = texto === undefined || texto === null ? '' : String(texto);
    return div.innerHTML;
  }
})();
