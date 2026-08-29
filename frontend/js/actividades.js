/**
 * actividades.js — modulo "Mi trabajo" (v7.0 Fase 2).
 * documentacion/SIGSO-v7.0-propuesta-modulo-gestion-operacional.md §4.4, §5.1.
 *
 * Compartido por las dos vias de acceso (plataforma.js con token y app.js
 * con login Google), mismo patron que novedades.js/dashboard.js: un solo
 * archivo, sin duplicar logica entre los dos hosts.
 *
 * DECISION DE DISEÑO (viene del backend, ver Actividades.gs): el check-in
 * es de 1 clic, sin formularios. "Sin cambios" es una respuesta legitima,
 * no un estado de fallo -- por eso tiene el mismo tamaño de boton que
 * "Avancé", no un estilo apagado que la desaliente.
 */
(function () {
  window.SigsoActividades = { cargar: cargarActividades_ };

  var ultimaLista_ = [];

  function urlBackoffice_() {
    return (window.SIGSO_CONFIG || {}).BACKOFFICE_URL;
  }
  function api_(accion, datos) {
    return llamarApi(urlBackoffice_(), accion, datos || {});
  }

  var ETIQUETA_TAMANO = { S: 'Chica (~2 h)', M: 'Mediana (~1 día)', L: 'Grande (~3 días)', XL: 'Muy grande (~1 semana+)' };

  // --- semaforo de urgencia (solo de presentacion: el backend no clasifica
  // "en riesgo" en Fase 1 -- eso es Gerencia/Cumplimiento en F5). Calendario
  // simple (no dias habiles): alcanza para ordenar la lista del dia. ---
  function semaforo_(a) {
    if (a.estado === 'TERMINADA') return { codigo: 'terminada', etiqueta: 'Terminada' };
    if (a.estado === 'CANCELADA') return { codigo: 'cancelada', etiqueta: 'Cancelada' };
    if (a.estado === 'BLOQUEADA') return { codigo: 'bloqueada', etiqueta: 'Bloqueada' };
    if (a.estado === 'EN_REVISION') return { codigo: 'revision', etiqueta: 'En revisión' };
    if (a.fecha_propuesta && !a.confirmada_en) return { codigo: 'pendiente', etiqueta: 'Por confirmar' };
    if (!a.fecha_compromiso) return { codigo: 'al-dia', etiqueta: 'Al día' };
    // Comparacion en dias de calendario UTC: fecha_compromiso puede venir de
    // un <input type=date> (interpretado como medianoche UTC) -- comparar
    // con la hora LOCAL del navegador corre el resultado un dia segun el
    // huso (mismo motivo que correrFechaRecurrencia_ en el backend).
    var hoyUTC = Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    var f = new Date(a.fecha_compromiso);
    var venceUTC = Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate());
    var dias = Math.round((venceUTC - hoyUTC) / 86400000);
    if (dias < 0) return { codigo: 'atrasada', etiqueta: 'Atrasada' };
    if (dias <= 1) return { codigo: 'riesgo', etiqueta: dias === 0 ? 'Vence hoy' : 'Vence mañana' };
    return { codigo: 'al-dia', etiqueta: 'Al día' };
  }

  function fechaCorta_(iso) {
    if (!iso) return '—';
    // Se formatea en UTC (no en hora local): ver nota en semaforo_ sobre por
    // que una fecha-sin-hora se corre un dia segun el huso del navegador.
    var f = new Date(iso);
    return new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate()))
      .toLocaleDateString('es-CL', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  function esActiva_(a) {
    return a.estado !== 'TERMINADA' && a.estado !== 'CANCELADA';
  }

  // --- carga -----------------------------------------------------------

  function cargarActividades_() {
    var cont = document.getElementById('actividades-contenido');
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando tu trabajo...');
    api_('listarActividades', {}).then(function (respuesta) {
      if (!respuesta.ok) {
        cont.innerHTML = Componentes.alerta(respuesta.message || 'No se pudo cargar tu trabajo.', 'error');
        return;
      }
      ultimaLista_ = respuesta.data || [];
      renderModulo_(cont);
    }).catch(function () {
      cont.innerHTML = Componentes.alerta('No se pudo conectar para cargar tu trabajo.', 'error');
    });
  }

  function renderModulo_(cont) {
    var activas = ultimaLista_.filter(esActiva_);
    var terminadasHoy = ultimaLista_.filter(function (a) {
      if (esActiva_(a)) return false;
      if (!a.fecha_terminada) return false;
      var dias = Math.round((Date.now() - new Date(a.fecha_terminada).getTime()) / 86400000);
      return dias <= 7;
    });

    // Orden: bloqueadas/atrasadas primero, luego por fecha de compromiso.
    var ORDEN = { atrasada: 0, riesgo: 1, bloqueada: 2, pendiente: 3, revision: 4, 'al-dia': 5 };
    activas.sort(function (a, b) {
      var sa = semaforo_(a), sb = semaforo_(b);
      var oa = ORDEN[sa.codigo] !== undefined ? ORDEN[sa.codigo] : 9;
      var ob = ORDEN[sb.codigo] !== undefined ? ORDEN[sb.codigo] : 9;
      if (oa !== ob) return oa - ob;
      return new Date(a.fecha_compromiso || 0) - new Date(b.fecha_compromiso || 0);
    });

    var conteo = { al_dia: 0, riesgo: 0, bloqueada: 0, pendiente: 0 };
    activas.forEach(function (a) {
      var s = semaforo_(a).codigo;
      if (s === 'atrasada' || s === 'riesgo') conteo.riesgo++;
      else if (s === 'bloqueada') conteo.bloqueada++;
      else if (s === 'pendiente') conteo.pendiente++;
      else conteo.al_dia++;
    });

    cont.innerHTML =
      '<div class="sigso-mt-resumen">' +
        '<div class="sigso-mt-resumen__item"><span class="sigso-mt-resumen__num" style="color:var(--ok)">' + conteo.al_dia + '</span><span class="sigso-mt-resumen__rot">Al día</span></div>' +
        '<div class="sigso-mt-resumen__item"><span class="sigso-mt-resumen__num" style="color:var(--alerta)">' + conteo.riesgo + '</span><span class="sigso-mt-resumen__rot">En riesgo</span></div>' +
        '<div class="sigso-mt-resumen__item"><span class="sigso-mt-resumen__num" style="color:var(--info)">' + conteo.bloqueada + '</span><span class="sigso-mt-resumen__rot">Bloqueadas</span></div>' +
        (conteo.pendiente ? '<div class="sigso-mt-resumen__item"><span class="sigso-mt-resumen__num" style="color:var(--texto-2)">' + conteo.pendiente + '</span><span class="sigso-mt-resumen__rot">Por confirmar</span></div>' : '') +
        '<div class="sigso-mt-resumen__acciones">' +
          Componentes.boton({ texto: 'Registrar algo no planificado', variante: 'sutil', clase: 'js-mt-emergente', tipo: 'button' }) +
          Componentes.boton({ texto: '+ Nueva actividad', clase: 'js-mt-nueva', tipo: 'button' }) +
        '</div>' +
      '</div>' +
      '<div class="sigso-mt-lista">' +
        (activas.length
          ? activas.map(tarjeta_).join('')
          : Componentes.vacio({ texto: 'No tienes actividades activas.', detalle: 'Usa "Nueva actividad" para registrar un compromiso.' })) +
      '</div>' +
      (terminadasHoy.length
        ? '<div class="sigso-mt-terminadas">Terminadas esta semana: ' + terminadasHoy.length + ' — se archivan solas, no aparecen arriba.</div>'
        : '');

    cont.querySelector('.js-mt-nueva').addEventListener('click', function () { abrirFormularioActividad_('PROPIA'); });
    cont.querySelector('.js-mt-emergente').addEventListener('click', function () { abrirFormularioActividad_('EMERGENTE'); });

    cont.querySelectorAll('[data-checkin]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        manejarCheckin_(boton.getAttribute('data-id'), boton.getAttribute('data-checkin'), leerCheckinExtra_(boton));
      });
    });
    cont.querySelectorAll('[data-confirmar]').forEach(function (boton) {
      boton.addEventListener('click', function () { manejarConfirmar_(boton.getAttribute('data-confirmar')); });
    });
    cont.querySelectorAll('[data-contraproponer]').forEach(function (boton) {
      boton.addEventListener('click', function () { manejarContrapropuesta_(boton.getAttribute('data-contraproponer')); });
    });
  }

  function tarjeta_(a) {
    var s = semaforo_(a);
    var pendienteConfirmar = s.codigo === 'pendiente';
    var meta = '<span>Vence <b>' + fechaCorta_(a.fecha_compromiso || a.fecha_propuesta) + '</b></span>' +
      '<span>Tamaño <b>' + Componentes.escaparHtml(ETIQUETA_TAMANO[a.tamano] || a.tamano || '—') + '</b></span>' +
      (a.proyecto ? '<span>Proyecto <b>' + Componentes.escaparHtml(a.proyecto) + '</b></span>' : '');

    var acciones;
    if (pendienteConfirmar) {
      acciones = '<div class="sigso-mt-checkin">' +
        '<button type="button" class="sigso-mt-pastilla sigso-mt-pastilla--destacada" data-confirmar="' + a.actividad_id + '">Confirmo esta fecha</button>' +
        '<button type="button" class="sigso-mt-pastilla" data-contraproponer="' + a.actividad_id + '">Propongo otra fecha</button>' +
      '</div>';
    } else if (a.estado === 'BLOQUEADA') {
      acciones = '<div class="sigso-mt-checkin-wrap">' + checkinExtraHtml_() +
        '<div class="sigso-mt-checkin">' +
          '<button type="button" class="sigso-mt-pastilla sigso-mt-pastilla--destacada" data-checkin="desbloqueo" data-id="' + a.actividad_id + '">Ya se destrabó</button>' +
        '</div>' +
      '</div>';
    } else if (a.estado === 'EN_REVISION' || a.estado === 'TERMINADA' || a.estado === 'CANCELADA') {
      acciones = '';
    } else {
      acciones = '<div class="sigso-mt-checkin-wrap">' + checkinExtraHtml_() +
        '<div class="sigso-mt-checkin">' +
          '<button type="button" class="sigso-mt-pastilla" data-checkin="avance" data-id="' + a.actividad_id + '">Avancé</button>' +
          '<button type="button" class="sigso-mt-pastilla sigso-mt-pastilla--destacada" data-checkin="sin_cambio" data-id="' + a.actividad_id + '">Sin cambios</button>' +
          '<button type="button" class="sigso-mt-pastilla" data-checkin="bloqueo" data-id="' + a.actividad_id + '">Estoy bloqueado</button>' +
          '<button type="button" class="sigso-mt-pastilla" data-checkin="listo" data-id="' + a.actividad_id + '">Listo</button>' +
        '</div>' +
      '</div>';
    }

    var bloqueoInfo = a.estado === 'BLOQUEADA' && a.bloqueo_motivo
      ? '<div class="sigso-mt-bloqueo">' + Iconos.svg('pausado', { tam: 14 }) + ' ' + Componentes.escaparHtml(a.bloqueo_motivo) +
        (a.bloqueo_responsable_email ? ' — espera a <b>' + Componentes.escaparHtml(a.bloqueo_responsable_email) + '</b>' : '') + '</div>'
      : '';

    return '<div class="sigso-mt-card sigso-mt-card--' + s.codigo + '">' +
      '<div class="sigso-mt-card__top">' +
        '<span class="sigso-mt-card__titulo">' + Componentes.escaparHtml(a.titulo) + '</span>' +
        '<span class="sigso-badge sigso-mt-badge--' + s.codigo + '">' + Componentes.escaparHtml(s.etiqueta) + '</span>' +
        (a.origen === 'EMERGENTE' ? '<span class="sigso-badge sigso-badge--neutro">No planificado</span>' : '') +
        (a.recurrencia && a.recurrencia !== 'NINGUNA' ? '<span class="sigso-badge sigso-badge--neutro">↻ ' + (a.recurrencia === 'SEMANAL' ? 'semanal' : 'mensual') + '</span>' : '') +
      '</div>' +
      '<div class="sigso-mt-card__meta">' + meta + '</div>' +
      bloqueoInfo +
      acciones +
    '</div>';
  }

  // --- check-in (§4.4) --------------------------------------------------

  // v10 (Fase G2, "el dia se justifica mejor"): el disclosure de horas/nota
  // se comparte entre TODOS los estados con pastillas -- ver
  // .sigso-mt-checkin-wrap (components.css). Plegado por defecto: no le
  // agrega un solo clic al check-in de un clic de siempre.
  function checkinExtraHtml_() {
    return '<details class="sigso-mt-checkin-extra">' +
      '<summary>+ Horas / nota de hoy (opcional)</summary>' +
      '<div class="sigso-mt-checkin-extra__campos">' +
        '<input type="number" class="js-checkin-horas" min="0" max="24" step="0.5" placeholder="Horas">' +
        '<input type="text" class="js-checkin-nota" maxlength="280" placeholder="¿Qué hiciste hoy? (opcional)">' +
      '</div>' +
    '</details>';
  }

  function leerCheckinExtra_(btn) {
    var wrap = btn.closest('.sigso-mt-checkin-wrap');
    var extra = {};
    if (!wrap) return extra;
    var horasEl = wrap.querySelector('.js-checkin-horas');
    var notaEl = wrap.querySelector('.js-checkin-nota');
    if (horasEl && horasEl.value !== '') extra.horas = horasEl.value;
    if (notaEl && notaEl.value.trim() !== '') extra.nota = notaEl.value.trim();
    return extra;
  }

  function manejarCheckin_(id, tipo, extra) {
    extra = extra || {};
    if (tipo === 'bloqueo') {
      Componentes.prompt({
        titulo: 'Motivo del bloqueo',
        mensaje: '¿Qué necesitas para poder seguir? Si sabes quién debe destrabarlo, dilo también.',
        placeholder: 'Ej: esperando la aprobación de Contabilidad'
      }).then(function (motivo) {
        if (motivo === null || motivo === undefined || String(motivo).trim() === '') return;
        var payload = { actividad_id: id, tipo: 'bloqueo', bloqueo_motivo: motivo };
        if (extra.horas !== undefined) payload.horas = extra.horas;
        api_('checkinActividad', payload).then(recargarTrasAccion_);
      });
      return;
    }
    var payload = { actividad_id: id, tipo: tipo };
    if (extra.horas !== undefined) payload.horas = extra.horas;
    if (extra.nota !== undefined) payload.nota = extra.nota;
    api_('checkinActividad', payload).then(recargarTrasAccion_);
  }

  function manejarConfirmar_(id) {
    api_('confirmarActividad', { actividad_id: id }).then(recargarTrasAccion_);
  }

  function manejarContrapropuesta_(id) {
    Componentes.prompt({
      titulo: 'Proponer otra fecha',
      mensaje: 'Elige una nueva fecha de compromiso. Tu supervisor la verá con el motivo.',
      tipo: 'date'
    }).then(function (fecha) {
      if (!fecha) return;
      Componentes.prompt({ titulo: 'Motivo', mensaje: 'Cuéntanos brevemente por qué.' }).then(function (motivo) {
        api_('confirmarActividad', { actividad_id: id, fecha_compromiso: fecha, motivo: motivo || '' }).then(recargarTrasAccion_);
      });
    });
  }

  function recargarTrasAccion_(respuesta) {
    if (respuesta && !respuesta.ok) {
      Componentes.aviso({ texto: respuesta.message || 'No se pudo actualizar.', tipo: 'error' });
    }
    cargarActividades_();
  }

  // --- alta de actividad (nueva / no planificada) ------------------------

  function abrirFormularioActividad_(origenSugerido) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    var esEmergente = origenSugerido === 'EMERGENTE';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">' + (esEmergente ? 'Registrar algo no planificado' : 'Nueva actividad') + '</h3>' +
        '<form id="form-mt-actividad" class="sigso-novedad-form">' +
          '<div class="sigso-campo"><label>Título</label><input type="text" id="mt-titulo" maxlength="140" required placeholder="Ej: Editar 3 videos de testimonios"></div>' +
          '<div class="sigso-campo"><label>Vence</label><input type="date" id="mt-fecha" required></div>' +
          '<div class="sigso-campo"><label>Tamaño</label><select id="mt-tamano">' +
            Object.keys(ETIQUETA_TAMANO).map(function (t) {
              return '<option value="' + t + '"' + (t === 'M' ? ' selected' : '') + '>' + ETIQUETA_TAMANO[t] + '</option>';
            }).join('') +
          '</select></div>' +
          '<div class="sigso-campo"><label>Proyecto (opcional)</label><input type="text" id="mt-proyecto" maxlength="80"></div>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-mt-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit', clase: 'js-mt-guardar' }) +
          '</div>' +
        '</form>' +
      '</div>';

    function cerrar() {
      document.removeEventListener('keydown', alTeclado);
      if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
    }
    function alTeclado(ev) { if (ev.key === 'Escape') cerrar(); }
    fondo.addEventListener('click', function (ev) { if (ev.target === fondo) cerrar(); });
    document.addEventListener('keydown', alTeclado);
    document.body.appendChild(fondo);
    fondo.querySelector('.js-mt-cancelar').addEventListener('click', cerrar);
    document.getElementById('mt-titulo').focus();

    if (esEmergente) {
      document.getElementById('mt-fecha').valueAsDate = new Date();
      document.getElementById('mt-tamano').value = 'S';
    }

    document.getElementById('form-mt-actividad').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var boton = fondo.querySelector('.js-mt-guardar');
      boton.disabled = true;
      api_('crearActividad', {
        titulo: document.getElementById('mt-titulo').value,
        fecha_compromiso: document.getElementById('mt-fecha').value,
        tamano: document.getElementById('mt-tamano').value,
        proyecto: document.getElementById('mt-proyecto').value,
        origen: origenSugerido
      }).then(function (respuesta) {
        if (!respuesta.ok) {
          boton.disabled = false;
          Componentes.aviso({ texto: respuesta.message || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        cargarActividades_();
      }).catch(function () {
        boton.disabled = false;
        Componentes.aviso({ texto: 'No se pudo conectar para guardar.', tipo: 'error' });
      });
    });
  }
})();
