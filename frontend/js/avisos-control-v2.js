/**
 * avisos-control-v2.js — Panel de gerencia › «Avisos de control» (Plan de
 * control y certificación, P8; backend avisosControl.js).
 *
 * Una tarjeta por aviso (cotizaciones, F29, contabilización, convenios) con
 * cómo está HOY (barra y lo que falta), el interruptor, el día del mes, a
 * quién le llega, «avisar al llegar al 100 %» y la vista previa del correo.
 * Se guarda con «Guardar» en cada tarjeta.
 *
 * Uso: SigsoAvisosControl.montar(el) o <div data-avisos-host> + montarPendientes().
 */
(function () {
  'use strict';

  var U = window.UIv2;
  var ICONO = { COTIZACIONES: 'gafete', IVA_F29: 'recibo', CONTABILIZACION: 'libro', CONVENIOS: 'dinero' };
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  function api(accion, datos) {
    return llamarApi((window.SIGSO_CONFIG || {}).BACKOFFICE_URL, accion, datos || {}).catch(function (e) {
      return { ok: false, message: (e && e.message) || 'No se pudo conectar.' };
    });
  }
  var esc = function (s) { return U.esc(s); };
  function aviso(t, tipo) { if (window.Componentes && Componentes.aviso) Componentes.aviso({ texto: t, tipo: tipo || 'info' }); }
  function fecha(d) { return d ? Number(d.slice(8, 10)) + ' ' + MESES[Number(d.slice(5, 7)) - 1] : ''; }

  function tarjeta(a, personas, k) {
    var e = a.estado_hoy || {};
    var conv = a.clave === 'CONVENIOS';
    var tono = !e.total ? 'neutro' : (conv ? (e.faltan.length ? 'alerta' : 'ok') : (e.pct >= 100 ? 'ok' : (e.pct >= 75 ? 'alerta' : 'critico')));
    var hoyTxt = !e.total ? 'La matriz no tiene registros de ' + esc(e.periodo_txt) + ' todavía.'
      : (conv ? '<strong>' + e.faltan.length + '</strong> de ' + e.total + ' con cuotas vencidas · ' + esc(e.periodo_txt)
        : '<strong>' + e.hechos + ' de ' + e.total + '</strong> listos · ' + esc(e.periodo_txt) + (e.vence ? ' · vence el ' + esc(fecha(e.vence)) : ''));
    var dias = ''; for (var d = 1; d <= 28; d++) dias += '<option value="' + d + '"' + (d === a.dia ? ' selected' : '') + '>Día ' + d + '</option>';
    var chips = a.destinatarios.map(function (p) {
      return '<span class="ac2-dest" data-email="' + esc(p.email) + '">' + U.avatar({ nombre: p.nombre, email: p.email }, 'sm') + esc(p.nombre) +
        '<button type="button" class="ac2-dest__x js-ac2-quitar" aria-label="Quitar a ' + esc(p.nombre) + '">' + U.ico('equis', 12) + '</button></span>';
    }).join('');
    var sumar = '<select class="sx2-select ac2-sumar js-ac2-sumar" aria-label="Agregar destinatario"><option value="">+ Agregar</option>' + personas.filter(function (p) {
      return !a.destinatarios.some(function (x) { return x.email === p.email; });
    }).map(function (p) { return '<option value="' + esc(p.email) + '">' + esc(p.nombre) + '</option>'; }).join('') + '</select>';
    return '<section class="sx2-card ac2-aviso sx2-entra' + (a.activo ? ' ac2-aviso--on' : '') + '" data-clave="' + esc(a.clave) + '" style="--i:' + (k + 1) + '">' +
      '<div class="ac2-aviso__cab"><span class="ac2-aviso__ico sx2-tono-' + tono + '">' + U.ico(ICONO[a.clave] || 'campana', 20) + '</span>' +
        '<div class="ac2-aviso__tit"><h3>' + esc(a.titulo) + '</h3><p>' + esc(a.descripcion) + '</p></div>' +
        '<label class="ac2-switch"><input type="checkbox" class="js-ac2-activo"' + (a.activo ? ' checked' : '') + '><span class="ac2-switch__pista"></span><span class="ac2-switch__txt">' + (a.activo ? 'Encendido' : 'Apagado') + '</span></label></div>' +
      '<div class="ac2-hoy sx2-tono-' + tono + '"><span class="ac2-eti">Así está hoy</span><span class="ac2-hoy__txt">' + hoyTxt + '</span>' +
        (e.total && !conv ? U.barra(e.pct || 0, tono) : '') + '</div>' +
      '<div class="ac2-campos"><label class="ac2-campo"><span class="ac2-eti">Qué día del mes</span><select class="sx2-select js-ac2-dia">' + dias + '</select></label>' +
        '<label class="ac2-check"><input type="checkbox" class="js-ac2-100"' + (a.avisar_100 ? ' checked' : '') + '>Avisar también cuando llegue al 100 %</label></div>' +
      '<div class="ac2-campo"><span class="ac2-eti">Le llega a' + (a.destinatarios_por_defecto ? ' <small>(propuesto: gerencia y la jefatura del área)</small>' : '') + '</span><div class="ac2-dests">' + chips + sumar + '</div></div>' +
      '<details class="ac2-previa"><summary>' + U.ico('correo', 14) + 'Ver cómo llega el correo</summary><pre>' + esc(a.vista_previa) + '</pre></details>' +
      '<div class="ac2-pie">' + U.boton({ texto: 'Guardar', icono: 'check', variante: 'primario', sm: true, clase: 'js-ac2-guardar' }) + '</div>' +
    '</section>';
  }

  function pintar(el) {
    var t = ++el._ac2.turno;
    el.innerHTML = '<div class="ac2">' + U.esqueleto('tarjetas', 4) + '</div>';
    api('listarAvisosControl', {}).then(function (r) {
      if (t !== el._ac2.turno || !el.isConnected) return;
      if (!r || !r.ok) { el.innerHTML = '<div class="ac2">' + U.card({ cuerpo: U.vacio({ icono: 'candado', titulo: 'No se pudo cargar', texto: (r && r.message) || 'Inténtalo de nuevo.' }) }) + '</div>'; return; }
      var d = r.data;
      el._ac2.datos = d;
      el.innerHTML = '<div class="ac2"><p class="ac2-intro">' + U.ico('info', 14) + 'Las respuestas a las «preguntas programadas» de gerencia: el día elegido, a las 9:00, llega por correo y a la campana cómo va cada tema y qué falta, con su responsable. Salen de las matrices de los departamentos, sin costo.</p>' +
        '<div class="ac2-grid">' + d.avisos.map(function (a, k) { return tarjeta(a, d.personas, k); }).join('') + '</div>' +
        (d.no_disponibles.length ? U.card({ titulo: 'Todavía no se pueden programar', icono: 'candado', i: 6, cuerpo: '<ul class="ac2-nodisp">' + d.no_disponibles.map(function (x) {
          return '<li><strong>' + esc(x.titulo) + '</strong><span>' + esc(x.motivo) + '</span></li>';
        }).join('') + '</ul>' }) : '') + '</div>';
      U.animar(el);
    });
  }

  function montar(el) {
    if (!el) return;
    el._ac2 = { turno: 0, datos: null };
    el.setAttribute('data-avisos-montado', '1');
    el.addEventListener('click', function (ev) {
      var t = ev.target, b;
      if ((b = t.closest('.js-ac2-quitar'))) { b.closest('.ac2-dest').remove(); return; }
      if ((b = t.closest('.js-ac2-guardar'))) {
        var card = b.closest('.ac2-aviso');
        var dest = Array.prototype.map.call(card.querySelectorAll('.ac2-dest'), function (x) { return x.getAttribute('data-email'); });
        b.disabled = true;
        api('guardarAvisoControl', { clave: card.getAttribute('data-clave'), activo: card.querySelector('.js-ac2-activo').checked, dia: Number(card.querySelector('.js-ac2-dia').value),
          avisar_100: card.querySelector('.js-ac2-100').checked, destinatarios: dest }).then(function (r) {
          b.disabled = false;
          if (!r || !r.ok) { aviso((r && r.message) || 'No se pudo guardar.', 'error'); return; }
          aviso('Aviso guardado.', 'exito');
          pintar(el);
        });
      }
    });
    el.addEventListener('change', function (ev) {
      var s = ev.target;
      if (s.classList.contains('js-ac2-activo')) {
        var card = s.closest('.ac2-aviso');
        card.classList.toggle('ac2-aviso--on', s.checked);
        card.querySelector('.ac2-switch__txt').textContent = s.checked ? 'Encendido' : 'Apagado';
        return;
      }
      if (s.classList.contains('js-ac2-sumar') && s.value) {
        var p = (el._ac2.datos.personas || []).filter(function (x) { return x.email === s.value; })[0];
        s.insertAdjacentHTML('beforebegin', '<span class="ac2-dest" data-email="' + esc(s.value) + '">' + U.avatar({ nombre: p ? p.nombre : s.value, email: s.value }, 'sm') + esc(p ? p.nombre : s.value) +
          '<button type="button" class="ac2-dest__x js-ac2-quitar" aria-label="Quitar">' + U.ico('equis', 12) + '</button></span>');
        s.querySelector('option[value="' + CSS.escape(s.value) + '"]').remove();
        s.value = '';
      }
    });
    pintar(el);
  }
  function montarPendientes(raiz) {
    (raiz || document).querySelectorAll('[data-avisos-host]:not([data-avisos-montado])').forEach(function (el) { montar(el); });
  }

  window.SigsoAvisosControl = { montar: montar, montarPendientes: montarPendientes, recargar: function (raiz) {
    (raiz || document).querySelectorAll('[data-avisos-montado]').forEach(function (el) { if (el._ac2) pintar(el); });
  } };
})();
