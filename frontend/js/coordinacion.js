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
  // v7.2 (Bloque A, mejora A1): guarda las pausas de hoy ya cargadas para que
  // el modal de "pasar lista" pueda armar el roster de pendientes sin pedirlo
  // de nuevo al servidor.
  var ultimasPausasHoy_ = [];

  function api(action, data) {
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, action, data || {});
  }
  function cont() { return document.getElementById('coordinacion-contenido'); }

  // v12.1: Coordinación pasa a la navegación vertical común. Es el módulo que
  // YA tenía un apartado "Reportes" antes de que existiera la regla — aquí
  // sólo se lo mueve al submódulo transversal, con el mismo contenido.
  var ARQUITECTURA_COORD = [
    { id: 'hoy', nombre: 'Hoy', icono: 'reloj', items: [
      { id: 'hoy', nombre: 'Hoy' }
    ] },
    { id: 'historial', nombre: 'Historial por trabajador', icono: 'persona', items: [
      { id: 'historial', nombre: 'Historial por trabajador' }
    ] },
    { id: 'reportes', nombre: 'Reportes', icono: 'grafico', plano: true,
      descripcion: 'Cumplimiento de las pausas', items: [
      { id: 'reportes', nombre: 'Cumplimiento' }
    ] }
  ];

  function cargar() {
    var c = cont();
    if (!c) return;
    // La vista puede venir de la URL (#/pausas_coordinacion/reportes); se
    // valida contra la arquitectura para que no se pueda inventar una.
    var pedida = (window.SigsoShell && SigsoShell.tomarItemDeRuta)
      ? SigsoShell.tomarItemDeRuta() : '';
    if (pedida && ARQUITECTURA_COORD.some(function (s) {
      return s.items.some(function (it) { return it.id === pedida; });
    })) {
      subtab = pedida;
    }

    // El layout se arma UNA vez: la navegación es persistente y sólo se
    // reemplaza el panel. Antes se repintaba entera en cada cambio de vista.
    if (!c.querySelector('.sigso-modulo-layout')) {
      c.innerHTML =
        '<div class="sigso-modulo-layout">' +
          '<nav class="sigso-modulo-layout__nav sigso-nav2" id="coord-nav" aria-label="Secciones de Coordinación"></nav>' +
          '<div class="sigso-modulo-layout__panel" id="coord-sub-contenido"></div>' +
        '</div>';
    }
    if (window.SigsoNav) {
      SigsoNav.render({
        contenedor: document.getElementById('coord-nav'),
        modulo: 'pausas_coordinacion',
        submodulos: ARQUITECTURA_COORD,
        activo: subtab,
        onSeleccion: function (id) {
          subtab = id;
          if (window.SigsoShell && SigsoShell.publicarItem) SigsoShell.publicarItem(id);
          cargar();
        }
      });
    }
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
      ultimasPausasHoy_ = d.pausas;
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
    // v7.2 (Bloque A, mejora A1): "pasar lista" grupal -- solo tiene sentido
    // mientras la pausa admite registros y hay gente sin registrar todavia.
    var puedePasarLista = ['Programada', 'Recordatorio_enviado', 'En_curso'].indexOf(p.estado) !== -1;
    if (puedePasarLista && part.n_pendientes > 0) {
      acciones += Componentes.boton({
        texto: 'Pasar lista (' + part.n_pendientes + ' pendientes)', variante: 'secundario',
        accion: 'pasar_lista', idx: p.pausa_id, clase: 'sigso-pausa-btn'
      });
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
      (TERMINALES.indexOf(p.estado) !== -1 && p.observaciones ? '<p class="sigso-ayuda">Observaciones: ' + Componentes.escaparHtml(p.observaciones) + '</p>' : '') +
      (p.evidencia_url ? '<p class="sigso-ayuda">Evidencia: <a href="' + Componentes.escaparHtml(p.evidencia_url) + '" target="_blank" rel="noopener">ver foto</a></p>' : ''));
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
          promptFinalizarConEvidencia_().then(function (resultado) {
            if (resultado === null) return;
            operar_(Object.assign({ operacion: 'finalizar', pausa_id: id }, resultado), id);
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
        } else if (accion === 'pasar_lista') {
          abrirModalPasarLista_(id);
        }
      });
    });
  }

  // v7.2 (Bloque A, mejora A1 "pasar lista grupal"): pensado para el taller
  // presencial donde nadie tiene el celular a mano para autoregistrarse. La
  // coordinadora marca de una vez a quienes quedan pendientes -- toggle
  // Participó/No pudo por persona, sin marcar nada por defecto (no se envia
  // lo que no se toco).
  function abrirModalPasarLista_(pausaId) {
    var pausa = ultimasPausasHoy_.filter(function (p) { return p.pausa_id === pausaId; })[0];
    var pendientes = (pausa && pausa.participacion && pausa.participacion.pendientes) || [];
    if (!pendientes.length) return;

    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    var filas = pendientes.map(function (t, idx) {
      return '<div class="sigso-lista-item" data-trab="' + Componentes.escaparHtml(t.trabajador_id) + '">' +
        '<span>' + Componentes.escaparHtml(t.nombre) + (t.area ? ' · ' + Componentes.escaparHtml(t.area) : '') + '</span>' +
        '<span class="sigso-lista-item__botones">' +
        '<button type="button" class="sigso-boton sigso-boton--sutil js-lista-participo" data-idx="' + idx + '">✅ Participó</button>' +
        '<button type="button" class="sigso-boton sigso-boton--sutil js-lista-nopudo" data-idx="' + idx + '">✋ No pudo</button>' +
        '</span></div>';
    }).join('');
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true" aria-labelledby="lista-titulo">' +
      '<h3 class="sigso-modal__titulo" id="lista-titulo">Pasar lista (' + pendientes.length + ' pendientes)</h3>' +
      '<p class="sigso-modal__mensaje">Marca a quienes participaron o no pudieron. Lo que no toques queda pendiente.</p>' +
      '<div class="sigso-lista-pasar-lista">' + filas + '</div>' +
      '<p class="sigso-campo__error sigso-oculto" id="lista-error"></p>' +
      '<div class="sigso-modal__acciones">' +
      Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-modal-no' }) +
      Componentes.boton({ texto: 'Guardar', clase: 'js-modal-si' }) +
      '</div></div>';

    var marcas = {}; // trabajador_id -> 'participo' | 'no_participo'
    function alTeclado(ev) { if (ev.key === 'Escape') cerrar(); }
    function cerrar() {
      document.removeEventListener('keydown', alTeclado);
      if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
    }
    fondo.querySelectorAll('.js-lista-participo, .js-lista-nopudo').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var item = btn.closest('.sigso-lista-item');
        var trabId = item.getAttribute('data-trab');
        var esParticipo = btn.classList.contains('js-lista-participo');
        marcas[trabId] = esParticipo ? 'participo' : 'no_participo';
        item.querySelectorAll('button').forEach(function (b) { b.classList.remove('sigso-boton--activo'); });
        btn.classList.add('sigso-boton--activo');
      });
    });
    fondo.querySelector('.js-modal-no').addEventListener('click', cerrar);
    fondo.querySelector('.js-modal-si').addEventListener('click', function () {
      var registros = Object.keys(marcas).map(function (id) { return { trabajador_id: id, estado: marcas[id] }; });
      if (!registros.length) {
        var err = fondo.querySelector('#lista-error');
        err.textContent = 'Marca al menos a una persona.';
        err.classList.remove('sigso-oculto');
        return;
      }
      cerrar();
      var destino = document.getElementById('coord-resultado-' + pausaId);
      if (destino) destino.innerHTML = Componentes.cargando('Guardando la lista…');
      api('registrarAsistenciaGrupalPausas', { pausa_id: pausaId, registros: registros }).then(function (r) {
        if (!r.ok) { if (destino) destino.innerHTML = Componentes.alerta(r.message || 'No se pudo guardar.', 'error'); return; }
        cargarHoy_();
      }).catch(function (e) {
        if (destino) destino.innerHTML = Componentes.alerta((e && e.message) || 'Error de conexión.', 'error');
      });
    });
    fondo.addEventListener('click', function (ev) { if (ev.target === fondo) cerrar(); });
    document.addEventListener('keydown', alTeclado);
    document.body.appendChild(fondo);
  }

  // v6.0 (mejora #4): mismo modal que Componentes.prompt (observaciones),
  // mas un input de foto OPCIONAL -- evidencia de que la charla se hizo.
  // Se hace a mano (no via Componentes.prompt) porque ese componente es de
  // un solo campo de texto; aca hacen falta 2 campos + conversion a base64.
  // Resuelve {observaciones, evidencia_nombre, evidencia_base64} (los ultimos
  // 2 solo si se eligio una foto), o null si se cancela.
  var LIMITE_EVIDENCIA_BYTES = 5 * 1024 * 1024;
  function promptFinalizarConEvidencia_() {
    return new Promise(function (resolver) {
      var fondo = document.createElement('div');
      fondo.className = 'sigso-modal-fondo';
      fondo.innerHTML =
        '<div class="sigso-modal" role="dialog" aria-modal="true" aria-labelledby="coord-finalizar-titulo">' +
        '<h3 class="sigso-modal__titulo" id="coord-finalizar-titulo">Finalizar pausa</h3>' +
        '<p class="sigso-modal__mensaje">Declaro que la pausa activa programada fue realizada.</p>' +
        '<textarea class="sigso-prompt__input" id="coord-finalizar-obs" placeholder="Observaciones (opcional)" rows="3"></textarea>' +
        '<label for="coord-finalizar-foto" style="display:block;margin-top:10px;">Evidencia de la charla (foto, opcional)</label>' +
        '<input type="file" id="coord-finalizar-foto" accept="image/jpeg,image/png,image/gif">' +
        '<p class="sigso-campo__error sigso-oculto" id="coord-finalizar-error"></p>' +
        '<div class="sigso-modal__acciones">' +
        Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-modal-no' }) +
        Componentes.boton({ texto: 'Finalizar', clase: 'js-modal-si' }) +
        '</div></div>';

      var error = fondo.querySelector('#coord-finalizar-error');
      function cerrar(valor) {
        document.removeEventListener('keydown', alTeclado);
        if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
        resolver(valor);
      }
      function alTeclado(ev) { if (ev.key === 'Escape') cerrar(null); }

      function aceptar() {
        var observaciones = fondo.querySelector('#coord-finalizar-obs').value.trim();
        var foto = fondo.querySelector('#coord-finalizar-foto').files[0];
        if (!foto) { cerrar({ observaciones: observaciones }); return; }
        if (foto.size > LIMITE_EVIDENCIA_BYTES) {
          error.textContent = 'La foto supera el tamaño máximo (5 MB).';
          error.classList.remove('sigso-oculto');
          return;
        }
        var lector = new FileReader();
        lector.onload = function () {
          var base64 = String(lector.result).split(',')[1] || '';
          cerrar({ observaciones: observaciones, evidencia_nombre: foto.name, evidencia_base64: base64 });
        };
        lector.onerror = function () {
          error.textContent = 'No se pudo leer la foto. Intenta de nuevo.';
          error.classList.remove('sigso-oculto');
        };
        lector.readAsDataURL(foto);
      }

      fondo.querySelector('.js-modal-no').addEventListener('click', function () { cerrar(null); });
      fondo.querySelector('.js-modal-si').addEventListener('click', aceptar);
      fondo.addEventListener('click', function (ev) { if (ev.target === fondo) cerrar(null); });
      document.addEventListener('keydown', alTeclado);
      document.body.appendChild(fondo);
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
        (k.animo_promedio == null ? '' : Componentes.kpi({ etiqueta: 'Ánimo promedio', valor: k.animo_promedio + '/5' })) +
        '</div>' +
        Componentes.tarjeta('<h3>Motivos de inasistencia</h3>' + tablaSimple_(d.motivos, 'motivo', 'cantidad', 'Sin justificaciones en el periodo.')) +
        Componentes.tarjeta('<h3>Participación por área</h3>' + tablaSimple_(d.por_area, 'area', 'participaciones', 'Sin participaciones en el periodo.')) +
        Componentes.tarjeta('<h3>Rachas de equipo por área</h3>' +
          '<p class="sigso-ayuda">Pausas consecutivas donde el área alcanzó su umbral de participación. Es una racha de EQUIPO, no de personas.</p>' +
          rachasAreaHtml_(d.rachas_area));
    }).catch(function (e) { c.innerHTML = Componentes.alerta((e && e.message) || 'Error de conexión.', 'error'); });
  }

  // v7.2 (Bloque A, mejora A4): "rachas por area" -- a proposito de EQUIPO,
  // nunca individual (RN-708: nunca rankear personas). Ordenadas de mayor a
  // menor racha actual (ya vienen asi del backend).
  function rachasAreaHtml_(rachas) {
    if (!rachas || rachas.length === 0) return '<p class="sigso-ayuda">Sin datos suficientes en el periodo.</p>';
    var filas = rachas.map(function (r) {
      return '<tr><td>' + Componentes.escaparHtml(r.area) + '</td>' +
        '<td>' + Componentes.escaparHtml(String(r.roster)) + '</td>' +
        '<td>' + Componentes.escaparHtml(String(r.racha_actual)) + '</td>' +
        '<td>' + Componentes.escaparHtml(String(r.racha_maxima)) + '</td>' +
        '<td>≥' + Componentes.escaparHtml(String(r.umbral_pct)) + '%</td></tr>';
    }).join('');
    return '<table class="sigso-tabla"><thead><tr><th>Área</th><th>Personas</th><th>Racha actual</th><th>Racha máxima</th><th>Umbral</th></tr></thead><tbody>' + filas + '</tbody></table>';
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

  // v7.2 (Bloque A, mejora A7): "no_aplica" (la EMPRESA no hizo la pausa) y
  // "sin_registro" (la pausa SI se hizo, la persona no dejo constancia) son
  // dos hechos distintos -- antes ambos se veian igual ("Pendiente"), lo que
  // hacia parecer que alguien "faltó" cuando en realidad la empresa entera
  // no tuvo pausa ese día.
  var ESTADO_MIO_TEXTO = {
    participo: 'Participó', no_participo: 'No pudo',
    sin_registro: 'Sin registro', no_aplica: 'No aplica (sin pausa ese día)'
  };

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
      Componentes.kpi({ etiqueta: 'Sin registro', valor: s.sin_registro }) +
      '</div>' +
      (d.detalle.length === 0
        ? '<p class="sigso-ayuda">Sin pausas resueltas en el periodo.</p>'
        : '<table class="sigso-tabla"><thead><tr><th>Fecha</th><th>Estado</th></tr></thead><tbody>' + filas + '</tbody></table>'));
  }

  window.SigsoCoordinacion = { cargar: cargar };
})();
