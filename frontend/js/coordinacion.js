/**
 * coordinacion.js — modulo "Coordinación de pausas" (v6.0 Fase P3).
 *
 * Rol coordinador (prevencionista: Amarlla, Camila, reemplazo). Vive dentro del
 * shell. Dos pestañas:
 *  - Hoy: opera la pausa del día (iniciar / finalizar / marcar no realizada) y
 *    ve la participación en vivo (participaron / justificaron / pendientes).
 *  - Reportes: su propio apartado de cumplimiento (KPIs, motivos, por área),
 *    sin pasar por Gerencia (requisito explícito).
 *
 * Todo por token (api.js lo adjunta). El backend valida por rol en cada acción.
 */
(function () {
  'use strict';

  var subtab = 'hoy';

  function api(action, data) {
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, action, data || {});
  }
  function cont() { return document.getElementById('coordinacion-contenido'); }

  function cargar() {
    var c = cont();
    if (!c) return;
    c.innerHTML =
      '<div class="sigso-tabs" id="coord-subtabs">' +
      '<button type="button" class="sigso-tabs__boton' + (subtab === 'hoy' ? ' sigso-tabs__boton--activo' : '') + '" data-coord-sub="hoy">Hoy</button>' +
      '<button type="button" class="sigso-tabs__boton' + (subtab === 'reportes' ? ' sigso-tabs__boton--activo' : '') + '" data-coord-sub="reportes">Reportes</button>' +
      '<button type="button" class="sigso-tabs__boton' + (subtab === 'historial' ? ' sigso-tabs__boton--activo' : '') + '" data-coord-sub="historial">Historial por trabajador</button>' +
      '</div><div id="coord-sub-contenido"></div>';
    c.querySelectorAll('[data-coord-sub]').forEach(function (b) {
      b.addEventListener('click', function () { subtab = b.getAttribute('data-coord-sub'); cargar(); });
    });
    if (subtab === 'hoy') cargarHoy_();
    else if (subtab === 'reportes') cargarReportes_();
    else cargarHistorial_();
  }

  // --- Hoy: operar la pausa -------------------------------------------------
  function cargarHoy_() {
    var c = document.getElementById('coord-sub-contenido');
    c.innerHTML = Componentes.cargando('Cargando la pausa de hoy…');
    api('getPanelCoordinadorPausas', {}).then(function (r) {
      if (!r.ok) { c.innerHTML = Componentes.alerta(r.message || 'No se pudo cargar.', 'error'); return; }
      var d = r.data;
      if (d.sin_empresa) {
        c.innerHTML = Componentes.tarjeta('<p class="sigso-ayuda">No estás registrada como coordinadora de ninguna empresa. Avísale al administrador.</p>');
        return;
      }
      if (!d.pausas || d.pausas.length === 0) {
        c.innerHTML = Componentes.tarjeta('<h3>Sin pausa hoy</h3><p class="sigso-ayuda">No hay una pausa programada para hoy en tu(s) empresa(s).</p>');
        return;
      }
      c.innerHTML = d.pausas.map(tarjetaPausa_).join('');
      wireAccionesHoy_();
    }).catch(function (e) { c.innerHTML = Componentes.alerta((e && e.message) || 'Error de conexión.', 'error'); });
  }

  var ESTADO_BADGE = {
    Programada: 'P3', Recordatorio_enviado: 'P3', En_curso: 'P2',
    Realizada: 'P4', Cerrada: 'P4', Suspendida: 'P5', No_realizada: 'P1', Cancelada: 'P1'
  };
  var TERMINALES = ['Cerrada', 'No_realizada', 'Cancelada', 'Realizada'];

  function tarjetaPausa_(p) {
    var part = p.participacion || {};
    var acciones = '';
    if (p.estado === 'Programada' || p.estado === 'Recordatorio_enviado') {
      acciones =
        Componentes.boton({ texto: 'Iniciar pausa', accion: 'iniciar', idx: p.pausa_id, clase: 'sigso-pausa-btn' }) +
        Componentes.boton({ texto: 'No se realizó', variante: 'peligro', accion: 'no_realizada', idx: p.pausa_id, clase: 'sigso-pausa-btn' });
    } else if (p.estado === 'En_curso') {
      acciones =
        Componentes.boton({ texto: 'Finalizar (realizada)', accion: 'finalizar', idx: p.pausa_id, clase: 'sigso-pausa-btn' }) +
        Componentes.boton({ texto: 'No se realizó', variante: 'peligro', accion: 'no_realizada', idx: p.pausa_id, clase: 'sigso-pausa-btn' });
    }
    var listas =
      bloqueLista_('Participaron (' + part.n_participaron + ')', part.participaron, false) +
      bloqueLista_('Justificaron (' + part.n_justificaron + ')', part.justificaron, true) +
      bloqueLista_('Pendientes (' + part.n_pendientes + ')', part.pendientes, false);
    return Componentes.tarjeta(
      '<div class="sigso-pausa-cab"><h3>Pausa de hoy · ' + Componentes.escaparHtml(p.empresa_id) + '</h3>' +
      '<p class="sigso-ayuda">Hora ' + Componentes.escaparHtml(p.hora_programada || '—') + ' · ' +
      Componentes.escaparHtml(String(p.duracion_min || '—')) + ' min · ' +
      Componentes.badge(String(p.estado).replace(/_/g, ' '), ESTADO_BADGE[p.estado] || 'P3') + '</p></div>' +
      '<p class="sigso-ayuda">Participación: <strong>' + (part.pct_participacion == null ? '—' : part.pct_participacion + '%') +
      '</strong> (' + part.n_participaron + ' de ' + part.total_roster + ')</p>' +
      (acciones ? '<div class="sigso-pausa-botonera">' + acciones + '</div>' : '') +
      '<div id="coord-resultado-' + p.pausa_id + '"></div>' +
      listas +
      (TERMINALES.indexOf(p.estado) !== -1 && p.observaciones ? '<p class="sigso-ayuda">Observaciones: ' + Componentes.escaparHtml(p.observaciones) + '</p>' : ''));
  }

  function bloqueLista_(titulo, items, conMotivo) {
    if (!items || items.length === 0) return '<p class="sigso-ayuda"><strong>' + Componentes.escaparHtml(titulo) + ':</strong> —</p>';
    var lis = items.map(function (i) {
      return '<li>' + Componentes.escaparHtml(i.nombre) + (i.area ? ' · ' + Componentes.escaparHtml(i.area) : '') +
        (conMotivo && i.motivo ? ' <em>(' + Componentes.escaparHtml(i.motivo) + ')</em>' : '') + '</li>';
    }).join('');
    return '<p class="sigso-ayuda"><strong>' + Componentes.escaparHtml(titulo) + '</strong></p><ul class="sigso-lista-simple">' + lis + '</ul>';
  }

  function wireAccionesHoy_() {
    document.querySelectorAll('#coord-sub-contenido [data-accion]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var accion = btn.getAttribute('data-accion');
        var id = btn.getAttribute('data-idx');
        if (accion === 'iniciar') {
          operar_({ operacion: 'iniciar', pausa_id: id }, id);
        } else if (accion === 'finalizar') {
          Componentes.prompt({
            titulo: 'Finalizar pausa', mensaje: 'Declaro que la pausa activa programada fue realizada.',
            placeholder: 'Observaciones (opcional)', confirmar: 'Finalizar'
          }).then(function (obs) {
            if (obs === null) return;
            operar_({ operacion: 'finalizar', pausa_id: id, observaciones: obs }, id);
          });
        } else if (accion === 'no_realizada') {
          Componentes.prompt({
            titulo: 'Marcar no realizada', mensaje: 'Indica por qué no se realizó la pausa.',
            placeholder: 'Motivo', confirmar: 'Guardar',
            validar: function (v) { return v ? null : 'Indica el motivo.'; }
          }).then(function (motivo) {
            if (motivo === null) return;
            operar_({ operacion: 'no_realizada', pausa_id: id, motivo: motivo }, id);
          });
        }
      });
    });
  }

  function operar_(payload, pausaId) {
    var destino = document.getElementById('coord-resultado-' + pausaId);
    if (destino) destino.innerHTML = Componentes.cargando('Guardando…');
    api('gestionarPausaCoordinador', payload).then(function (r) {
      if (!r.ok) {
        if (destino) destino.innerHTML = Componentes.alerta(r.message || 'No se pudo aplicar.', 'error');
        return;
      }
      cargarHoy_();
    }).catch(function (e) {
      if (destino) destino.innerHTML = Componentes.alerta((e && e.message) || 'Error de conexión.', 'error');
    });
  }

  // --- Reportes -------------------------------------------------------------
  function cargarReportes_() {
    var c = document.getElementById('coord-sub-contenido');
    c.innerHTML = Componentes.cargando('Calculando el cumplimiento…');
    api('getReporteCumplimientoPausas', {}).then(function (r) {
      if (!r.ok) { c.innerHTML = Componentes.alerta(r.message || 'No se pudo cargar.', 'error'); return; }
      var d = r.data;
      if (d.sin_empresa) {
        c.innerHTML = Componentes.tarjeta('<p class="sigso-ayuda">No coordinas ninguna empresa.</p>');
        return;
      }
      var k = d.kpis;
      var semaforo = k.pct_cumplimiento == null ? 'P3' : (k.pct_cumplimiento >= 90 ? 'P4' : (k.pct_cumplimiento >= 70 ? 'P3' : 'P1'));
      c.innerHTML =
        '<p class="sigso-ayuda">Periodo: ' + Componentes.escaparHtml(d.periodo.desde) + ' a ' + Componentes.escaparHtml(d.periodo.hasta) + '</p>' +
        '<div class="sigso-kpis">' +
        Componentes.kpi({ etiqueta: 'Cumplimiento', valor: (k.pct_cumplimiento == null ? '—' : k.pct_cumplimiento + '%'), variante: semaforo }) +
        Componentes.kpi({ etiqueta: 'Realizadas', valor: k.realizadas }) +
        Componentes.kpi({ etiqueta: 'No realizadas', valor: k.no_realizadas }) +
        Componentes.kpi({ etiqueta: 'Participaciones', valor: k.participaciones }) +
        Componentes.kpi({ etiqueta: 'Justificaciones', valor: k.justificaciones }) +
        '</div>' +
        Componentes.tarjeta('<h3>Motivos de inasistencia</h3>' + tablaSimple_(d.motivos, 'motivo', 'cantidad', 'Sin justificaciones en el periodo.')) +
        Componentes.tarjeta('<h3>Participación por área</h3>' + tablaSimple_(d.por_area, 'area', 'participaciones', 'Sin participaciones en el periodo.'));
    }).catch(function (e) { c.innerHTML = Componentes.alerta((e && e.message) || 'Error de conexión.', 'error'); });
  }

  function tablaSimple_(filas, campoA, campoB, vacio) {
    if (!filas || filas.length === 0) return '<p class="sigso-ayuda">' + Componentes.escaparHtml(vacio) + '</p>';
    var cuerpo = filas.map(function (f) {
      return '<tr><td>' + Componentes.escaparHtml(String(f[campoA])) + '</td><td>' + Componentes.escaparHtml(String(f[campoB])) + '</td></tr>';
    }).join('');
    return '<table class="sigso-tabla"><tbody>' + cuerpo + '</tbody></table>';
  }

  // --- Historial por trabajador (mejora #7) ----------------------------------
  // "¿quien participa siempre y quien nunca?" -- util para RRHH/prevencion sin
  // tener que revisar pausa por pausa. Selector de roster + racha calculada
  // por el backend (getHistorialTrabajador).
  function cargarHistorial_() {
    var c = document.getElementById('coord-sub-contenido');
    c.innerHTML = Componentes.cargando('Cargando el roster…');
    api('listarRosterCoordinadorPausas', {}).then(function (r) {
      if (!r.ok) { c.innerHTML = Componentes.alerta(r.message || 'No se pudo cargar.', 'error'); return; }
      var d = r.data;
      if (d.sin_empresa || !d.roster || d.roster.length === 0) {
        c.innerHTML = Componentes.tarjeta('<p class="sigso-ayuda">No hay trabajadores en el roster de tu(s) empresa(s).</p>');
        return;
      }
      var opciones = '<option value="">Selecciona un trabajador…</option>' + d.roster.map(function (t) {
        return '<option value="' + Componentes.escaparHtml(t.trabajador_id) + '">' + Componentes.escaparHtml(t.nombre) +
          (t.area ? ' · ' + Componentes.escaparHtml(t.area) : '') + '</option>';
      }).join('');
      c.innerHTML =
        Componentes.tarjeta('<label for="coord-sel-historial">Trabajador</label>' +
          '<select id="coord-sel-historial">' + opciones + '</select>') +
        '<div id="coord-historial-detalle"></div>';
      document.getElementById('coord-sel-historial').addEventListener('change', function (ev) {
        var id = ev.target.value;
        var destino = document.getElementById('coord-historial-detalle');
        if (!id) { destino.innerHTML = ''; return; }
        destino.innerHTML = Componentes.cargando('Calculando el historial…');
        api('getHistorialTrabajadorPausas', { trabajador_id: id }).then(function (r2) {
          if (!r2.ok) { destino.innerHTML = Componentes.alerta(r2.message || 'No se pudo cargar.', 'error'); return; }
          destino.innerHTML = renderHistorialTrabajador_(r2.data);
        }).catch(function (e) { destino.innerHTML = Componentes.alerta((e && e.message) || 'Error de conexión.', 'error'); });
      });
    }).catch(function (e) { c.innerHTML = Componentes.alerta((e && e.message) || 'Error de conexión.', 'error'); });
  }

  var ESTADO_MIO_TEXTO = { participo: 'Participó', no_participo: 'No pudo', pendiente: 'Pendiente' };

  function renderHistorialTrabajador_(d) {
    var s = d.resumen;
    var filas = d.detalle.map(function (f) {
      return '<tr><td>' + Componentes.escaparHtml(f.fecha) + '</td><td>' +
        Componentes.escaparHtml(ESTADO_MIO_TEXTO[f.mi_estado] || f.mi_estado) +
        (f.motivo ? ' <em>(' + Componentes.escaparHtml(f.motivo) + ')</em>' : '') + '</td></tr>';
    }).join('');
    return Componentes.tarjeta(
      '<h3>' + Componentes.escaparHtml(d.trabajador.nombre) + '</h3>' +
      '<p class="sigso-ayuda">Periodo: ' + Componentes.escaparHtml(d.periodo.desde) + ' a ' + Componentes.escaparHtml(d.periodo.hasta) + '</p>' +
      '<div class="sigso-kpis">' +
      Componentes.kpi({ etiqueta: 'Participación', valor: (s.pct_participacion == null ? '—' : s.pct_participacion + '%') }) +
      Componentes.kpi({ etiqueta: 'Racha actual', valor: s.racha_actual }) +
      Componentes.kpi({ etiqueta: 'Racha máxima', valor: s.racha_maxima }) +
      Componentes.kpi({ etiqueta: 'Justificaciones', valor: s.justificaciones }) +
      Componentes.kpi({ etiqueta: 'Pendientes', valor: s.pendientes }) +
      '</div>' +
      (d.detalle.length === 0
        ? '<p class="sigso-ayuda">Sin pausas resueltas en el periodo.</p>'
        : '<table class="sigso-tabla"><thead><tr><th>Fecha</th><th>Estado</th></tr></thead><tbody>' + filas + '</tbody></table>'));
  }

  window.SigsoCoordinacion = { cargar: cargar };
})();
