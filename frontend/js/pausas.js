/**
 * pausas.js — modulo "Pausas activas" del trabajador (v6.0 Fase P2).
 *
 * Vive DENTRO del shell (plataforma.js lo orquesta, igual que dashboard.js /
 * gerencia.js). El trabajador entra tipicamente por un enlace magico; ve la
 * pausa de hoy y declara en <15 seg: "Participé" (con checkbox de declaración)
 * o "No pude participar" (con motivo). Todo por token (api.js lo adjunta).
 *
 * El valor probatorio lo pone el servidor (identidad + timestamp + declaración,
 * §4 de la propuesta); aquí solo se recoge la declaración. Sin firma dibujada.
 */
(function () {
  'use strict';

  var MOTIVOS_NO_PARTICIPA = [
    'En terreno / fuera de la oficina',
    'En reunión',
    'Atendiendo un cliente',
    'Licencia / permiso',
    'Problema de salud',
    'No me enteré a tiempo',
    'Otro'
  ];

  function api(action, data) {
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, action, data || {});
  }

  function cont() {
    return document.getElementById('pausas-contenido');
  }

  function cargar() {
    var c = cont();
    if (!c) return;
    c.innerHTML = Componentes.cargando('Buscando la pausa de hoy…');
    api('getPausaHoyTrabajador', {}).then(function (r) {
      if (!r.ok) {
        c.innerHTML = Componentes.alerta(r.message || 'No se pudo cargar la pausa de hoy.', 'error');
        return;
      }
      render_(r.data);
    }).catch(function (err) {
      c.innerHTML = Componentes.alerta((err && err.message) || 'No se pudo contactar el servidor.', 'error');
    });
  }

  function render_(data) {
    var c = cont();
    if (data.sin_empresa) {
      c.innerHTML = Componentes.tarjeta(
        '<h3>No encontramos tu empresa</h3>' +
        '<p class="sigso-ayuda">No pudimos asociar tu cuenta a una empresa para las pausas activas. ' +
        'Avísale al administrador para que te agregue al listado.</p>');
      return;
    }
    if (!data.pausa) {
      c.innerHTML = Componentes.tarjeta(
        '<h3>Sin pausa activa hoy</h3>' +
        '<p class="sigso-ayuda">No hay una pausa activa programada para hoy. Cuando la haya, aparecerá aquí ' +
        'para que registres tu participación.</p>');
      return;
    }

    var p = data.pausa;
    var cabecera =
      '<div class="sigso-pausa-cab">' +
      '<h3>Pausa activa de hoy</h3>' +
      '<p class="sigso-ayuda">Hora ' + Componentes.escaparHtml(p.hora_programada || '—') +
      ' · ' + Componentes.escaparHtml(String(p.duracion_min || '—')) + ' min</p>' +
      '</div>';

    if (data.mi_registro) {
      var esParticipo = data.mi_registro.estado === 'participo';
      c.innerHTML = Componentes.tarjeta(
        cabecera +
        Componentes.alerta(
          (esParticipo ? 'Registraste: Participé. ¡Gracias!'
                       : 'Registraste: No pude participar' +
                         (data.mi_registro.motivo ? ' (' + data.mi_registro.motivo + ')' : '') + '. ¡Gracias por avisar!'),
          esParticipo ? 'exito' : 'aviso') +
        (data.registrable
          ? '<p class="sigso-ayuda">¿Te equivocaste? Puedes corregir tu respuesta antes de que se cierre la pausa.</p>' +
            Componentes.boton({ texto: 'Cambiar mi respuesta', variante: 'secundario', id: 'btn-pausa-cambiar' })
          : ''));
      var btnCambiar = document.getElementById('btn-pausa-cambiar');
      if (btnCambiar) btnCambiar.addEventListener('click', function () { renderFormulario_(data, true); });
      return;
    }

    if (!data.registrable) {
      c.innerHTML = Componentes.tarjeta(
        cabecera +
        Componentes.alerta('La pausa de hoy ya se cerró y no admite nuevos registros.', 'aviso'));
      return;
    }

    renderFormulario_(data, false);
  }

  function renderFormulario_(data, esCambio) {
    var p = data.pausa;
    var c = cont();
    var motivosOpts = MOTIVOS_NO_PARTICIPA.map(function (m) { return { valor: m, texto: m }; });
    c.innerHTML = Componentes.tarjeta(
      '<div class="sigso-pausa-cab"><h3>Pausa activa de hoy</h3>' +
      '<p class="sigso-ayuda">Hora ' + Componentes.escaparHtml(p.hora_programada || '—') +
      ' · ' + Componentes.escaparHtml(String(p.duracion_min || '—')) + ' min. Registra en un toque:</p></div>' +
      '<div class="sigso-pausa-botonera">' +
      Componentes.boton({ texto: 'Participé', icono: 'check', id: 'btn-pausa-participe', clase: 'sigso-pausa-btn' }) +
      Componentes.boton({ texto: 'No pude participar', icono: 'equis', variante: 'secundario', id: 'btn-pausa-nopude', clase: 'sigso-pausa-btn' }) +
      '</div>' +
      '<div id="pausa-detalle-registro"></div>' +
      '<div id="pausa-resultado"></div>');

    document.getElementById('btn-pausa-participe').addEventListener('click', function () {
      var det = document.getElementById('pausa-detalle-registro');
      det.innerHTML =
        '<form id="form-pausa-participe" class="sigso-pausa-form">' +
        '<label class="sigso-toggle"><input type="checkbox" data-campo="confirmacion"> ' +
        'Declaro que participé en la pausa activa de hoy.</label>' +
        animoHtml_() +
        Componentes.boton({ tipo: 'submit', texto: 'Guardar' }) +
        '</form>';
      wireAnimo_(document.getElementById('form-pausa-participe'));
      document.getElementById('form-pausa-participe').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var conf = document.querySelector('#form-pausa-participe [data-campo="confirmacion"]').checked;
        enviar_({ estado: 'participo', confirmacion: conf, animo: leerAnimo_(document.getElementById('form-pausa-participe')) });
      });
    });

    document.getElementById('btn-pausa-nopude').addEventListener('click', function () {
      var det = document.getElementById('pausa-detalle-registro');
      det.innerHTML =
        '<form id="form-pausa-nopude" class="sigso-pausa-form">' +
        Componentes.campoSelect({ dataCampo: 'motivo', label: 'Motivo', opciones: motivosOpts }) +
        Componentes.campoTextarea({ dataCampo: 'comentario', label: 'Comentario (opcional)' }) +
        Componentes.boton({ tipo: 'submit', texto: 'Guardar' }) +
        '</form>';
      document.getElementById('form-pausa-nopude').addEventListener('submit', function (ev) {
        ev.preventDefault();
        enviar_({
          estado: 'no_participo',
          motivo: document.querySelector('#form-pausa-nopude [data-campo="motivo"]').value.trim(),
          comentario: document.querySelector('#form-pausa-nopude [data-campo="comentario"]').value.trim()
        });
      });
    });
  }

  // v7.2 (Bloque A, mejora A6): micro-encuesta de bienestar, OPCIONAL --
  // 5 caritas, sin obligar a elegir ninguna (nunca debe ser una barrera para
  // registrar la participacion). No se muestra a nadie por persona -- el
  // servidor solo la agrega en un promedio (RN-708, ver calcularReportePausas_).
  var ANIMO_EMOJI = ['😞', '🙁', '😐', '🙂', '😄'];

  function animoHtml_() {
    var botones = ANIMO_EMOJI.map(function (emoji, idx) {
      return '<button type="button" class="sigso-animo-btn" data-animo="' + (idx + 1) + '" ' +
        'aria-label="Ánimo ' + (idx + 1) + ' de 5">' + emoji + '</button>';
    }).join('');
    return '<div class="sigso-animo" data-animo-valor="">' +
      '<p class="sigso-ayuda" style="margin-bottom:6px;">¿Cómo te sientes hoy? (opcional)</p>' +
      '<div class="sigso-animo-botonera">' + botones + '</div>' +
      '</div>';
  }

  function wireAnimo_(form) {
    var cont = form.querySelector('.sigso-animo');
    if (!cont) return;
    cont.querySelectorAll('.sigso-animo-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var yaActivo = btn.classList.contains('sigso-animo-btn--activo');
        cont.querySelectorAll('.sigso-animo-btn').forEach(function (b) { b.classList.remove('sigso-animo-btn--activo'); });
        cont.setAttribute('data-animo-valor', yaActivo ? '' : btn.getAttribute('data-animo'));
        if (!yaActivo) btn.classList.add('sigso-animo-btn--activo');
      });
    });
  }

  function leerAnimo_(form) {
    var cont = form.querySelector('.sigso-animo');
    if (!cont) return undefined;
    var v = cont.getAttribute('data-animo-valor');
    return v ? Number(v) : undefined;
  }

  function enviar_(payload) {
    var destino = document.getElementById('pausa-resultado');
    destino.innerHTML = Componentes.cargando('Guardando…');
    api('registrarAsistenciaPausa', payload).then(function (r) {
      if (!r.ok) {
        destino.innerHTML = Componentes.alerta(r.message || 'No se pudo guardar.', 'error');
        return;
      }
      // Recarga para mostrar el estado "ya registrado".
      cargar();
    }).catch(function (err) {
      destino.innerHTML = Componentes.alerta((err && err.message) || 'No se pudo guardar.', 'error');
    });
  }

  window.SigsoPausas = { cargar: cargar };
})();
