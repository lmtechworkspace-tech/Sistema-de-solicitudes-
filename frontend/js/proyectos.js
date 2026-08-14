/**
 * proyectos.js — modulo "Proyectos" (v9.0 MVP Fase 1).
 * documentacion/SIGSO-v9.0-propuesta-modulo-gestion-proyectos.md.
 *
 * Compartido por las dos vias de acceso (plataforma.js con token y app.js
 * con login Google), mismo patron que actividades.js/novedades.js: un solo
 * archivo, sin duplicar logica entre los dos hosts.
 *
 * DECISION DE DISEÑO (viene del backend, ver Proyectos.gs/Actividades.gs):
 * las tareas de un proyecto SON actividades del modulo "Mi trabajo" -- el
 * check-in (avance/sin cambios/bloqueo/listo) es EXACTAMENTE el mismo de
 * siempre, solo que agrupado dentro de un proyecto. No hay un motor de
 * tareas nuevo aca.
 */
(function () {
  // v9.0b: 'refrescar' -- a diferencia de 'cargar' (siempre portafolio), esta
  // entrada respeta donde esta el usuario: si tiene un proyecto abierto, lo
  // vuelve a cargar A ESE MISMO proyecto en vez de sacarlo al portafolio. La
  // usa el auto-refresco de plataforma.js (al volver a la pestana del
  // navegador) -- antes llamaba 'cargar' sin condicion, lo que reseteaba
  // proyectoActivoId_ a null y sacaba al usuario del proyecto que estaba
  // gestionando; si en ese instante tenia un formulario abierto (crear tarea,
  // agregar integrante...), el guardado viajaba con proyecto_id vacio y el
  // backend lo rechazaba en silencio (parecia "no se guarda").
  window.SigsoProyectos = {
    cargar: cargarPortafolio_,
    refrescar: function () {
      if (proyectoActivoId_) refrescarDetalle_(); else cargarPortafolio_();
    }
  };

  function urlBackoffice_() {
    return (window.SIGSO_CONFIG || {}).BACKOFFICE_URL;
  }
  function api_(accion, datos) {
    return llamarApi(urlBackoffice_(), accion, datos || {});
  }

  var SALUD_ETIQUETA = { normal: '🟢 Normal', riesgo: '🟡 En riesgo', critico: '🔴 Crítico' };
  var ESTADO_PROYECTO_ETIQUETA = {
    PLANIFICACION: 'Planificación', ACTIVO: 'Activo', EN_PAUSA: 'En pausa',
    EN_REVISION: 'En revisión', CERRADO: 'Cerrado', CANCELADO: 'Cancelado'
  };
  var ROL_PROYECTO_ETIQUETA = { LIDER: 'Líder', INTEGRANTE: 'Integrante', COLABORADOR: 'Colaborador', OBSERVADOR: 'Observador' };
  var TIPO_EVENTO_ETIQUETA = {
    ACTUALIZACION: 'Actualización', COMENTARIO: 'Comentario', DECISION: 'Decisión',
    REUNION: 'Reunión', BLOQUEO: 'Bloqueo', SOLICITUD_LIDER: 'Solicitud del líder',
    CAMBIO_ESTADO: 'Cambio de estado'
  };

  var proyectoActivoId_ = null;
  var pestanaActiva_ = 'resumen';

  // --- portafolio ----------------------------------------------------------

  function cargarPortafolio_() {
    proyectoActivoId_ = null;
    datosDetalleActual_ = null;
    var cont = document.getElementById('proyectos-contenido');
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando proyectos...');
    api_('listarProyectos', {}).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar el portafolio.', 'error');
        return;
      }
      pintarPortafolio_(cont, respuesta.data || []);
    }).catch(function () {
      cont.innerHTML = Componentes.alerta('No se pudo conectar para cargar los proyectos.', 'error');
    });
  }

  function pintarPortafolio_(cont, proyectos) {
    var cabecera = '<div class="sigso-py-cabecera">' +
      '<p class="sigso-ayuda">Portafolio de proyectos internos: quién lidera cada uno, en qué estado está y qué necesita atención.</p>' +
      Componentes.boton({ texto: '+ Nuevo proyecto', clase: 'js-py-nuevo' }) +
      '</div>';

    if (proyectos.length === 0) {
      cont.innerHTML = cabecera + Componentes.vacio({ texto: 'Todavía no participas en ningún proyecto.', detalle: 'Crea uno para empezar.' });
      cont.querySelector('.js-py-nuevo').addEventListener('click', abrirFormularioProyecto_);
      return;
    }

    var tarjetas = proyectos.map(function (p) {
      var avance = p.avance_pct === null || p.avance_pct === undefined ? '—' : p.avance_pct + '%';
      return '<button type="button" class="sigso-py-card js-py-abrir" data-id="' + p.proyecto_id + '">' +
        '<div class="sigso-py-card__top">' +
          '<span class="sigso-py-card__nombre">' + Componentes.escaparHtml(p.nombre) + '</span>' +
          '<span class="sigso-py-salud sigso-py-salud--' + p.salud + '">' + SALUD_ETIQUETA[p.salud] + '</span>' +
        '</div>' +
        (p.descripcion ? '<p class="sigso-py-card__desc">' + Componentes.escaparHtml(p.descripcion) + '</p>' : '') +
        '<div class="sigso-py-card__barra"><div class="sigso-py-card__barra-fill" style="width:' + (p.avance_pct || 0) + '%"></div></div>' +
        '<div class="sigso-py-card__meta">' +
          '<span>Avance <b>' + avance + '</b></span>' +
          '<span>' + Componentes.badge(ESTADO_PROYECTO_ETIQUETA[p.estado] || p.estado, 'neutro') + '</span>' +
          '<span>' + p.total_tareas + ' tarea(s) · ' + p.total_integrantes + ' integrante(s)</span>' +
          '<span>Líder ' + Componentes.escaparHtml(p.lider_email) + '</span>' +
        '</div>' +
        (p.salud_motivos && p.salud_motivos.length
          ? '<p class="sigso-py-card__motivos">' + Componentes.escaparHtml(p.salud_motivos.join(' · ')) + '</p>'
          : '') +
      '</button>';
    }).join('');

    cont.innerHTML = cabecera + '<div class="sigso-py-grid">' + tarjetas + '</div>';
    cont.querySelector('.js-py-nuevo').addEventListener('click', abrirFormularioProyecto_);
    cont.querySelectorAll('.js-py-abrir').forEach(function (btn) {
      btn.addEventListener('click', function () { abrirProyecto_(btn.getAttribute('data-id')); });
    });
  }

  // --- crear proyecto --------------------------------------------------

  function abrirFormularioProyecto_() {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Nuevo proyecto</h3>' +
        '<form id="form-py-nuevo">' +
          Componentes.campoTexto({ id: 'py-nombre', label: 'Nombre', requerido: true, placeholder: 'Ej: Migración ERP' }) +
          Componentes.campoTextarea({ id: 'py-descripcion', label: 'Descripción breve' }) +
          Componentes.campoTextarea({ id: 'py-objetivo', label: 'Objetivo / resultado esperado' }) +
          '<div class="sigso-py-form-fila">' +
            Componentes.campoTexto({ id: 'py-fecha-inicio', label: 'Fecha de inicio', tipo: 'date', requerido: true }) +
            Componentes.campoTexto({ id: 'py-fecha-objetivo', label: 'Fecha objetivo', tipo: 'date', requerido: true }) +
          '</div>' +
          Componentes.campoSelect({
            id: 'py-prioridad', label: 'Prioridad', valor: 'P4', placeholder: false,
            opciones: [{ valor: 'P1', texto: 'P1 — Crítica' }, { valor: 'P2', texto: 'P2 — Alta' },
              { valor: 'P3', texto: 'P3 — Media' }, { valor: 'P4', texto: 'P4 — Normal' }, { valor: 'P5', texto: 'P5 — Baja' }]
          }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-py-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Crear proyecto', tipo: 'submit', clase: 'js-py-guardar' }) +
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
    fondo.querySelector('.js-py-cancelar').addEventListener('click', cerrar);
    document.getElementById('py-nombre').focus();

    document.getElementById('form-py-nuevo').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var datos = {
        nombre: document.getElementById('py-nombre').value,
        descripcion: document.getElementById('py-descripcion').value,
        objetivo: document.getElementById('py-objetivo').value,
        fecha_inicio: document.getElementById('py-fecha-inicio').value,
        fecha_objetivo: document.getElementById('py-fecha-objetivo').value,
        prioridad: document.getElementById('py-prioridad').value
      };
      api_('crearProyecto', datos).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo crear el proyecto.', tipo: 'error' });
          return;
        }
        cerrar();
        cargarPortafolio_();
      });
    });
  }

  // --- detalle del proyecto ------------------------------------------------

  // v9.0b: cache del ultimo detalle/tareas/sala cargados -- cambiar de
  // pestana (Resumen/Sala/Tareas/Hitos/Equipo) es solo PRESENTACION, los
  // datos no cambian por eso. Antes cada clic en una pestana volvia a pedir
  // los 3 endpoints (getDetalleProyecto + listarTareasProyecto +
  // listarSalaProyecto), lo que hacia lenta la navegacion dentro de un
  // mismo proyecto sin necesidad. Ahora solo se vuelve a la red al abrir el
  // proyecto, tras una accion que cambia datos, o en el refresco de fondo.
  var datosDetalleActual_ = null;

  function abrirProyecto_(id) {
    proyectoActivoId_ = id;
    pestanaActiva_ = 'resumen';
    datosDetalleActual_ = null;
    refrescarDetalle_();
  }

  // Cambia de pestana SIN red: repinta con lo que ya se cargo. Si por algun
  // motivo no hay nada en cache todavia (carga interrumpida), cae a pedirlo.
  function cambiarPestana_(id) {
    pestanaActiva_ = id;
    var cont = document.getElementById('proyectos-contenido');
    if (!cont || !datosDetalleActual_) { refrescarDetalle_(); return; }
    pintarDetalle_(cont, datosDetalleActual_.detalle, datosDetalleActual_.tareas, datosDetalleActual_.sala);
  }

  function refrescarDetalle_() {
    var cont = document.getElementById('proyectos-contenido');
    if (!cont || !proyectoActivoId_) return;
    cont.innerHTML = Componentes.cargando('Cargando proyecto...');

    Promise.all([
      api_('getDetalleProyecto', { proyecto_id: proyectoActivoId_ }),
      api_('listarTareasProyecto', { proyecto_id: proyectoActivoId_ }),
      api_('listarSalaProyecto', { proyecto_id: proyectoActivoId_ })
    ]).then(function (respuestas) {
      var rDetalle = respuestas[0], rTareas = respuestas[1], rSala = respuestas[2];
      if (!rDetalle || !rDetalle.ok) {
        cont.innerHTML = Componentes.alerta((rDetalle && rDetalle.message) || 'No se pudo abrir el proyecto.', 'error');
        return;
      }
      var tareas = (rTareas && rTareas.ok) ? rTareas.data : [];
      var sala = (rSala && rSala.ok) ? rSala.data : [];
      datosDetalleActual_ = { detalle: rDetalle.data, tareas: tareas, sala: sala };
      pintarDetalle_(cont, rDetalle.data, tareas, sala);
    }).catch(function () {
      cont.innerHTML = Componentes.alerta('No se pudo conectar para abrir el proyecto.', 'error');
    });
  }

  function pintarDetalle_(cont, detalle, tareas, sala) {
    var p = detalle.proyecto;
    var puedeGestionar = detalle.rol_actual === 'LIDER';
    var PESTANAS = [
      { id: 'resumen', texto: 'Resumen' },
      { id: 'sala', texto: 'Sala' },
      { id: 'tareas', texto: 'Tareas' },
      { id: 'hitos', texto: 'Hitos' },
      { id: 'equipo', texto: 'Equipo' }
    ];

    var tabs = PESTANAS.map(function (t) {
      return '<button type="button" class="sigso-tab js-py-tab' + (t.id === pestanaActiva_ ? ' sigso-tab--activo' : '') + '" data-tab="' + t.id + '">' + t.texto + '</button>';
    }).join('');

    var cabecera =
      '<div class="sigso-py-detalle-cab">' +
        Componentes.boton({ texto: '← Portafolio', variante: 'sutil', clase: 'js-py-volver' }) +
        '<h1>' + Componentes.escaparHtml(p.nombre) + '</h1>' +
        '<span class="sigso-py-salud sigso-py-salud--' + detalle.salud + '">' + SALUD_ETIQUETA[detalle.salud] + '</span>' +
        Componentes.badge(ESTADO_PROYECTO_ETIQUETA[p.estado] || p.estado, 'neutro') +
      '</div>' +
      (detalle.salud_motivos && detalle.salud_motivos.length
        ? '<p class="sigso-py-motivos">' + Componentes.escaparHtml(detalle.salud_motivos.join(' · ')) + '</p>' : '') +
      '<div class="sigso-tabs">' + tabs + '</div>';

    var cuerpo = '';
    if (pestanaActiva_ === 'resumen') cuerpo = pintarResumen_(detalle, tareas, puedeGestionar);
    else if (pestanaActiva_ === 'sala') cuerpo = pintarSala_(sala, detalle);
    else if (pestanaActiva_ === 'tareas') cuerpo = pintarTareas_(tareas, detalle, puedeGestionar);
    else if (pestanaActiva_ === 'hitos') cuerpo = pintarHitos_(detalle, puedeGestionar);
    else if (pestanaActiva_ === 'equipo') cuerpo = pintarEquipo_(detalle, puedeGestionar);

    cont.innerHTML = cabecera + '<div class="sigso-py-cuerpo">' + cuerpo + '</div>';

    cont.querySelector('.js-py-volver').addEventListener('click', cargarPortafolio_);
    cont.querySelectorAll('.js-py-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        cambiarPestana_(btn.getAttribute('data-tab'));
      });
    });

    wireAccionesPestana_(cont, detalle, puedeGestionar);
  }

  // --- Resumen ---------------------------------------------------------

  function pintarResumen_(detalle, tareas, puedeGestionar) {
    var p = detalle.proyecto;
    var atencion = detalle.requiere_atencion || {};
    var kpis = [
      Componentes.kpi({ etiqueta: 'Avance', valor: (detalle.avance_pct === null ? '—' : detalle.avance_pct + '%') }),
      Componentes.kpi({ etiqueta: 'Tareas vencidas', valor: atencion.tareas_vencidas || 0 }),
      Componentes.kpi({ etiqueta: 'Tareas bloqueadas', valor: atencion.tareas_bloqueadas || 0 }),
      Componentes.kpi({ etiqueta: 'Hitos atrasados', valor: atencion.hitos_atrasados || 0 })
    ].join('');

    var acciones = puedeGestionar
      ? '<div class="sigso-py-acciones">' +
          Componentes.boton({ texto: 'Editar proyecto', variante: 'secundario', clase: 'js-py-editar' }) +
          (p.estado !== 'CERRADO' && p.estado !== 'CANCELADO'
            ? Componentes.boton({ texto: 'Cerrar proyecto', variante: 'peligro', clase: 'js-py-cerrar' }) : '') +
        '</div>'
      : '';

    return '<div class="sigso-py-kpis">' + kpis + '</div>' +
      (p.descripcion ? '<p>' + Componentes.escaparHtml(p.descripcion) + '</p>' : '') +
      (p.objetivo ? '<p><b>Objetivo:</b> ' + Componentes.escaparHtml(p.objetivo) + '</p>' : '') +
      '<p class="sigso-ayuda">Líder: ' + Componentes.escaparHtml(p.lider_email) +
        ' · Del ' + fechaCorta_(p.fecha_inicio) + ' al ' + fechaCorta_(p.fecha_objetivo) + '</p>' +
      acciones;
  }

  // --- Sala --------------------------------------------------------------

  function pintarSala_(sala, detalle) {
    var puedePublicar = !!detalle.rol_actual && detalle.rol_actual !== 'OBSERVADOR';
    var esLider = detalle.rol_actual === 'LIDER';
    var form = puedePublicar
      ? '<form id="form-py-sala" class="sigso-py-sala-form">' +
          Componentes.campoTextarea({ id: 'py-sala-cuerpo', label: 'Publicar en la sala', placeholder: 'Comparte un avance, decisión, o pide algo...', requerido: true }) +
          '<div class="sigso-py-sala-form__acciones">' +
            Componentes.campoSelect({
              id: 'py-sala-tipo', label: false, valor: 'COMENTARIO', placeholder: false,
              opciones: [
                { valor: 'COMENTARIO', texto: 'Comentario' },
                { valor: 'ACTUALIZACION', texto: 'Actualización' },
                { valor: 'DECISION', texto: 'Decisión' },
                { valor: 'REUNION', texto: 'Reunión' },
                { valor: 'BLOQUEO', texto: 'Bloqueo' }
              ].concat(esLider ? [{ valor: 'SOLICITUD_LIDER', texto: 'Solicitud (a todo el equipo)' }] : [])
            }) +
            Componentes.boton({ texto: 'Publicar', tipo: 'submit' }) +
          '</div>' +
        '</form>'
      : '';

    if (sala.length === 0) {
      return form + Componentes.vacio({ texto: 'Todavía no hay nada en la sala.' });
    }

    var feed = sala.map(function (e) {
      var puedeConvertir = puedePublicar && !e.ref_id && (e.tipo === 'COMENTARIO' || e.tipo === 'SOLICITUD_LIDER' || e.tipo === 'DECISION');
      return '<div class="sigso-py-evento sigso-py-evento--' + e.tipo.toLowerCase() + '">' +
        '<div class="sigso-py-evento__top">' +
          '<span class="sigso-py-evento__autor">' + Componentes.escaparHtml(e.autor_nombre || e.autor_email) + '</span>' +
          Componentes.badge(TIPO_EVENTO_ETIQUETA[e.tipo] || e.tipo, 'neutro') +
          '<span class="sigso-py-evento__fecha">' + fechaHora_(e.timestamp) + '</span>' +
        '</div>' +
        (e.titulo ? '<p class="sigso-py-evento__titulo">' + Componentes.escaparHtml(e.titulo) + '</p>' : '') +
        '<p class="sigso-py-evento__cuerpo">' + Componentes.escaparHtml(e.cuerpo || '') + '</p>' +
        (e.ref_id ? '<p class="sigso-ayuda">→ Convertido en tarea.</p>' : '') +
        (puedeConvertir
          ? Componentes.boton({ texto: 'Convertir en tarea', variante: 'sutil', clase: 'js-py-convertir', idx: e.evento_id })
          : '') +
      '</div>';
    }).join('');

    return form + '<div class="sigso-py-feed">' + feed + '</div>';
  }

  // --- Tareas --------------------------------------------------------------

  function pintarTareas_(tareas, detalle, puedeGestionar) {
    var puedeCrear = detalle.rol_actual && detalle.rol_actual !== 'OBSERVADOR';
    var acciones = puedeCrear
      ? '<div class="sigso-py-cabecera">' + Componentes.boton({ texto: '+ Nueva tarea', clase: 'js-py-nueva-tarea' }) + '</div>'
      : '';

    if (tareas.length === 0) {
      return acciones + Componentes.vacio({ texto: 'Todavía no hay tareas en este proyecto.' });
    }

    var filas = tareas.map(function (a) {
      var esMia = true; // el backend ya filtra por acceso; el check-in exige ser el responsable, el boton igual se muestra y el servidor valida.
      return '<div class="sigso-py-tarea">' +
        '<div class="sigso-py-tarea__top">' +
          '<span class="sigso-py-tarea__titulo">' + Componentes.escaparHtml(a.titulo) + '</span>' +
          '<span class="sigso-badge sigso-mt-badge--' + a.semaforo + '">' + Componentes.escaparHtml(a.semaforo_etiqueta) + '</span>' +
        '</div>' +
        '<div class="sigso-py-tarea__meta">' +
          '<span>' + Componentes.escaparHtml(a.responsable_nombre || a.responsable_email) + '</span>' +
          '<span>Prioridad ' + a.prioridad + '</span>' +
          (a.fecha_compromiso ? '<span>Vence ' + fechaCorta_(a.fecha_compromiso) + '</span>' : '') +
          (a.avance_pct !== '' && a.avance_pct !== undefined && a.avance_pct !== null ? '<span>' + a.avance_pct + '% avance</span>' : '') +
        '</div>' +
        (a.estado === 'BLOQUEADA' ? '<div class="sigso-mt-bloqueo">⏸ ' + Componentes.escaparHtml(a.bloqueo_motivo) + '</div>' : '') +
      '</div>';
    }).join('');

    return acciones + '<div class="sigso-py-lista">' + filas + '</div>' +
      '<p class="sigso-ayuda">Para actualizar el avance de una tarea, entra a "Mi trabajo" — el check-in es el mismo de siempre.</p>';
  }

  // --- Hitos --------------------------------------------------------------

  function pintarHitos_(detalle, puedeGestionar) {
    var acciones = puedeGestionar
      ? '<div class="sigso-py-cabecera">' + Componentes.boton({ texto: '+ Nuevo hito', clase: 'js-py-nuevo-hito' }) + '</div>'
      : '';
    if (!detalle.hitos || detalle.hitos.length === 0) {
      return acciones + Componentes.vacio({ texto: 'Todavía no hay hitos definidos.' });
    }
    var filas = detalle.hitos.map(function (h) {
      var avance = h.avance_pct === null || h.avance_pct === undefined ? '—' : h.avance_pct + '%';
      return '<div class="sigso-py-hito">' +
        '<div class="sigso-py-hito__top">' +
          '<span class="sigso-py-hito__nombre">' + Componentes.escaparHtml(h.nombre) + '</span>' +
          Componentes.badge(h.estado, 'neutro') +
        '</div>' +
        (h.descripcion ? '<p>' + Componentes.escaparHtml(h.descripcion) + '</p>' : '') +
        '<p class="sigso-ayuda">' + h.total_tareas + ' tarea(s) · ' + avance + ' de avance' +
          (h.fecha_objetivo ? ' · vence ' + fechaCorta_(h.fecha_objetivo) : '') + '</p>' +
      '</div>';
    }).join('');
    return acciones + '<div class="sigso-py-lista">' + filas + '</div>';
  }

  // --- Equipo ---------------------------------------------------------

  function pintarEquipo_(detalle, puedeGestionar) {
    var acciones = puedeGestionar
      ? '<div class="sigso-py-cabecera">' + Componentes.boton({ texto: '+ Agregar integrante', clase: 'js-py-nuevo-integrante' }) + '</div>'
      : '';
    var filas = (detalle.integrantes || []).map(function (i) {
      return '<div class="sigso-py-integrante">' +
        Componentes.avatar({ nombre: i.usuario_nombre || i.usuario_email, email: i.usuario_email }) +
        '<div class="sigso-py-integrante__info">' +
          '<span class="sigso-py-integrante__nombre">' + Componentes.escaparHtml(i.usuario_nombre || i.usuario_email) + '</span>' +
          '<span class="sigso-ayuda">' + (ROL_PROYECTO_ETIQUETA[i.rol_proyecto] || i.rol_proyecto) +
            (i.responsabilidad ? ' · ' + Componentes.escaparHtml(i.responsabilidad) : '') + '</span>' +
        '</div>' +
        (puedeGestionar && i.rol_proyecto !== 'LIDER'
          ? Componentes.boton({ texto: 'Quitar', variante: 'sutil', clase: 'js-py-quitar-integrante', idx: i.integrante_id })
          : '') +
      '</div>';
    }).join('');
    return acciones + '<div class="sigso-py-lista">' + filas + '</div>';
  }

  // --- acciones (delegadas por pestaña) -------------------------------

  function wireAccionesPestana_(cont, detalle, puedeGestionar) {
    var editar = cont.querySelector('.js-py-editar');
    if (editar) editar.addEventListener('click', function () { abrirFormularioEditar_(detalle.proyecto); });

    var cerrar = cont.querySelector('.js-py-cerrar');
    if (cerrar) cerrar.addEventListener('click', function () { manejarCerrarProyecto_(detalle.proyecto.proyecto_id); });

    var formSala = cont.querySelector('#form-py-sala');
    if (formSala) {
      formSala.addEventListener('submit', function (evento) {
        evento.preventDefault();
        var cuerpo = document.getElementById('py-sala-cuerpo').value;
        var tipo = document.getElementById('py-sala-tipo').value;
        if (!cuerpo.trim()) return;
        api_('publicarEnSalaProyecto', { proyecto_id: proyectoActivoId_, tipo: tipo, cuerpo: cuerpo }).then(function (respuesta) {
          if (!respuesta || !respuesta.ok) {
            Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo publicar.', tipo: 'error' });
            return;
          }
          refrescarDetalle_();
        });
      });
    }
    cont.querySelectorAll('.js-py-convertir').forEach(function (btn) {
      btn.addEventListener('click', function () { abrirFormularioConvertir_(btn.getAttribute('data-idx')); });
    });

    var nuevaTarea = cont.querySelector('.js-py-nueva-tarea');
    if (nuevaTarea) nuevaTarea.addEventListener('click', function () { abrirFormularioTarea_(detalle); });

    var nuevoHito = cont.querySelector('.js-py-nuevo-hito');
    if (nuevoHito) nuevoHito.addEventListener('click', abrirFormularioHito_);

    var nuevoIntegrante = cont.querySelector('.js-py-nuevo-integrante');
    if (nuevoIntegrante) nuevoIntegrante.addEventListener('click', abrirFormularioIntegrante_);

    cont.querySelectorAll('.js-py-quitar-integrante').forEach(function (btn) {
      btn.addEventListener('click', function () {
        Componentes.confirmar({ titulo: 'Quitar del equipo', mensaje: '¿Confirmas quitar a esta persona del proyecto?' }).then(function (ok) {
          if (!ok) return;
          api_('gestionarIntegranteProyecto', {
            proyecto_id: proyectoActivoId_, accion: 'quitar', integrante_id: btn.getAttribute('data-idx')
          }).then(refrescarDetalle_);
        });
      });
    });
  }

  function manejarCerrarProyecto_(proyectoId) {
    Componentes.prompt({
      titulo: 'Cerrar proyecto', mensaje: 'Resume brevemente el cierre (entregables, pendientes, aprendizajes).'
    }).then(function (motivo) {
      if (!motivo || !String(motivo).trim()) return;
      api_('actualizarProyecto', { proyecto_id: proyectoId, estado: 'CERRADO', motivo: motivo }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo cerrar el proyecto.', tipo: 'error' });
          return;
        }
        refrescarDetalle_();
      });
    });
  }

  function abrirFormularioEditar_(p) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Editar proyecto</h3>' +
        '<form id="form-py-editar">' +
          Componentes.campoTexto({ id: 'py-ed-nombre', label: 'Nombre', valor: p.nombre, requerido: true }) +
          Componentes.campoTextarea({ id: 'py-ed-descripcion', label: 'Descripción', valor: p.descripcion }) +
          Componentes.campoSelect({
            id: 'py-ed-estado', label: 'Estado', valor: p.estado, placeholder: false,
            opciones: Object.keys(ESTADO_PROYECTO_ETIQUETA).filter(function (e) { return e !== 'CERRADO'; }).map(function (e) {
              return { valor: e, texto: ESTADO_PROYECTO_ETIQUETA[e] };
            })
          }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-py-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-py-editar').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('actualizarProyecto', {
        proyecto_id: p.proyecto_id,
        nombre: document.getElementById('py-ed-nombre').value,
        descripcion: document.getElementById('py-ed-descripcion').value,
        estado: document.getElementById('py-ed-estado').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        refrescarDetalle_();
      });
    });
  }

  function abrirFormularioTarea_(detalle) {
    var opcionesIntegrantes = (detalle.integrantes || []).map(function (i) {
      return { valor: i.usuario_email, texto: i.usuario_nombre || i.usuario_email };
    });
    var opcionesHitos = (detalle.hitos || []).map(function (h) { return { valor: h.hito_id, texto: h.nombre }; });
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Nueva tarea</h3>' +
        '<form id="form-py-tarea">' +
          Componentes.campoTexto({ id: 'py-t-titulo', label: 'Título', requerido: true }) +
          Componentes.campoTextarea({ id: 'py-t-descripcion', label: 'Descripción' }) +
          Componentes.campoSelect({ id: 'py-t-responsable', label: 'Responsable', opciones: opcionesIntegrantes, requerido: true }) +
          (opcionesHitos.length ? Componentes.campoSelect({ id: 'py-t-hito', label: 'Hito (opcional)', opciones: opcionesHitos }) : '') +
          '<div class="sigso-py-form-fila">' +
            Componentes.campoTexto({ id: 'py-t-fecha', label: 'Fecha comprometida', tipo: 'date', requerido: true }) +
            Componentes.campoSelect({
              id: 'py-t-prioridad', label: 'Prioridad', valor: 'P4', placeholder: false,
              opciones: [{ valor: 'P1', texto: 'P1' }, { valor: 'P2', texto: 'P2' }, { valor: 'P3', texto: 'P3' }, { valor: 'P4', texto: 'P4' }, { valor: 'P5', texto: 'P5' }]
            }) +
          '</div>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-py-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Crear tarea', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-py-tarea').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var hitoEl = document.getElementById('py-t-hito');
      api_('crearTareaProyecto', {
        proyecto_id: proyectoActivoId_,
        hito_id: hitoEl ? hitoEl.value : '',
        titulo: document.getElementById('py-t-titulo').value,
        descripcion: document.getElementById('py-t-descripcion').value,
        responsable_email: document.getElementById('py-t-responsable').value,
        fecha_compromiso: document.getElementById('py-t-fecha').value,
        prioridad: document.getElementById('py-t-prioridad').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo crear la tarea.', tipo: 'error' });
          return;
        }
        cerrar();
        refrescarDetalle_();
      });
    });
  }

  function abrirFormularioHito_() {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Nuevo hito</h3>' +
        '<form id="form-py-hito">' +
          Componentes.campoTexto({ id: 'py-h-nombre', label: 'Nombre', requerido: true, placeholder: 'Ej: Levantamiento' }) +
          Componentes.campoTextarea({ id: 'py-h-descripcion', label: 'Descripción' }) +
          Componentes.campoTexto({ id: 'py-h-fecha', label: 'Fecha objetivo', tipo: 'date' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-py-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Crear hito', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-py-hito').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('gestionarHitoProyecto', {
        proyecto_id: proyectoActivoId_,
        nombre: document.getElementById('py-h-nombre').value,
        descripcion: document.getElementById('py-h-descripcion').value,
        fecha_objetivo: document.getElementById('py-h-fecha').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo crear el hito.', tipo: 'error' });
          return;
        }
        cerrar();
        refrescarDetalle_();
      });
    });
  }

  function abrirFormularioIntegrante_() {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Agregar integrante</h3>' +
        '<form id="form-py-integrante">' +
          Componentes.campoTexto({ id: 'py-i-email', label: 'Correo', tipo: 'email', requerido: true }) +
          Componentes.campoTexto({ id: 'py-i-nombre', label: 'Nombre' }) +
          Componentes.campoSelect({
            id: 'py-i-rol', label: 'Rol en el proyecto', valor: 'INTEGRANTE', placeholder: false,
            opciones: Object.keys(ROL_PROYECTO_ETIQUETA).map(function (r) { return { valor: r, texto: ROL_PROYECTO_ETIQUETA[r] }; })
          }) +
          Componentes.campoTexto({ id: 'py-i-responsabilidad', label: 'Responsabilidad (opcional)' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-py-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Agregar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-py-integrante').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('gestionarIntegranteProyecto', {
        proyecto_id: proyectoActivoId_,
        usuario_email: document.getElementById('py-i-email').value,
        usuario_nombre: document.getElementById('py-i-nombre').value,
        rol_proyecto: document.getElementById('py-i-rol').value,
        responsabilidad: document.getElementById('py-i-responsabilidad').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo agregar.', tipo: 'error' });
          return;
        }
        cerrar();
        refrescarDetalle_();
      });
    });
  }

  function abrirFormularioConvertir_(eventoId) {
    Componentes.prompt({ titulo: 'Título de la tarea', mensaje: 'Ej: Revisar documento' }).then(function (titulo) {
      if (!titulo || !String(titulo).trim()) return;
      Componentes.prompt({ titulo: 'Responsable', mensaje: 'Correo de quien la hará' }).then(function (email) {
        if (!email || !String(email).trim()) return;
        Componentes.prompt({ titulo: 'Fecha comprometida', tipo: 'date' }).then(function (fecha) {
          if (!fecha) return;
          api_('convertirEventoEnTareaProyecto', {
            proyecto_id: proyectoActivoId_, evento_id: eventoId, titulo: titulo,
            responsable_email: email, fecha_compromiso: fecha
          }).then(function (respuesta) {
            if (!respuesta || !respuesta.ok) {
              Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo convertir.', tipo: 'error' });
              return;
            }
            refrescarDetalle_();
          });
        });
      });
    });
  }

  // --- utilidades ------------------------------------------------------

  function montarModal_(fondo) {
    function cerrar() {
      document.removeEventListener('keydown', alTeclado);
      if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
    }
    function alTeclado(ev) { if (ev.key === 'Escape') cerrar(); }
    fondo.addEventListener('click', function (ev) { if (ev.target === fondo) cerrar(); });
    document.addEventListener('keydown', alTeclado);
    document.body.appendChild(fondo);
    fondo.querySelector('.js-py-cancelar').addEventListener('click', cerrar);
    return cerrar;
  }

  function fechaCorta_(iso) {
    if (!iso) return '—';
    var f = new Date(iso);
    if (isNaN(f.getTime())) return '—';
    return ('0' + f.getUTCDate()).slice(-2) + '/' + ('0' + (f.getUTCMonth() + 1)).slice(-2) + '/' + f.getUTCFullYear();
  }

  function fechaHora_(iso) {
    if (!iso) return '';
    var f = new Date(iso);
    if (isNaN(f.getTime())) return '';
    return f.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
})();
