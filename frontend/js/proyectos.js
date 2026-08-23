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
    cargar: function () {
      // v12.4: la vista puede venir de la URL (#/proyectos/reportes). Se
      // valida contra la arquitectura: una URL no puede inventar una vista.
      var pedidaPy = (window.SigsoShell && SigsoShell.tomarItemDeRuta)
        ? SigsoShell.tomarItemDeRuta() : '';
      var valida = ARQUITECTURA_PROYECTOS.some(function (sub) {
        return sub.items.some(function (it) { return it.id === pedidaPy; });
      });
      irAVistaProyectos_(valida ? pedidaPy : 'portafolio');
    },
    // v13.0: el arbol del sidebar entra por aca.
    irAItem: function (itemId) { irAVistaProyectos_(itemId); },
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
  // v9.1: estados de hito con etiqueta amable. COMPLETADO y CANCELADO son los
  // dos "terminales" que la salud (calcularSaludProyecto_) NO cuenta como
  // vencidos -- por eso el lider necesita poder marcar un hito completado.
  var HITO_ESTADO_ETIQUETA = { PENDIENTE: 'Pendiente', EN_CURSO: 'En curso', COMPLETADO: 'Completado', CANCELADO: 'Cancelado' };
  var TIPO_EVENTO_ETIQUETA = {
    ACTUALIZACION: 'Actualización', COMENTARIO: 'Comentario', DECISION: 'Decisión',
    REUNION: 'Reunión', BLOQUEO: 'Bloqueo', SOLICITUD_LIDER: 'Solicitud del líder',
    CAMBIO_ESTADO: 'Cambio de estado',
    // v9.4: eventos que registra el sistema (no el usuario) al crear/marcar/
    // revisar un entregable o registrar un riesgo -- mismo feed unico de
    // siempre (registrarEventoProyecto_), no hay canal nuevo.
    ENTREGABLE: 'Entregable', RIESGO: 'Riesgo'
  };
  // v9.4 (Fase 2 de la propuesta): entregables (aprobar/observar).
  // EN_REVISION queda mapeado por si el backend lo usa a futuro; el MVP usa
  // ENTREGADO como "listo para revisión" (ver Proyectos.gestionarEntregable).
  var ENTREGABLE_ESTADO_ETIQUETA = {
    PENDIENTE: 'Pendiente', ENTREGADO: 'Entregado', EN_REVISION: 'En revisión',
    APROBADO: 'Aprobado', OBSERVADO: 'Observado', CANCELADO: 'Cancelado'
  };
  // v9.4 (Fase 3 de la propuesta): riesgos. nivel lo deriva el backend
  // (probabilidad x impacto) -- el frontend nunca lo calcula ni lo edita.
  var RIESGO_NIVEL_ETIQUETA = { BAJA: 'Baja', MEDIA: 'Media', ALTA: 'Alta' };
  var RIESGO_ESTADO_ETIQUETA = { ABIERTO: 'Abierto', EN_MITIGACION: 'En mitigación', CERRADO: 'Cerrado' };

  var proyectoActivoId_ = null;
  var pestanaActiva_ = 'resumen';

  // Espejo liviano de normalizarEmailProyecto_ (Proyectos.gs) -- necesario
  // aca solo para mapear menciones a nombres al pintar el feed; el backend
  // sigue siendo la autoridad para permisos/comparaciones.
  function normalizarEmail_(email) { return String(email || '').trim().toLowerCase(); }

  // --- portafolio ----------------------------------------------------------

  // v9.3: filtros del portafolio. Estado va al backend (Proyectos.listar ya
  // acepta filtros.estado); salud se filtra en el cliente porque ya viene
  // calculada en cada tarjeta -- no hay razon para pedirla de nuevo al
  // servidor. Se guardan a nivel de modulo para sobrevivir un refrescar_()
  // (auto-refresco al volver a la pestaña) sin resetearse solos.
  var filtroEstadoPortafolio_ = '';
  var filtroSaludPortafolio_ = '';
  var proyectosPortafolioSinFiltrarSalud_ = [];
  // v9.4 (Fase 3): resumen ejecutivo del portafolio -- KPIs agregados + carga
  // por persona. Se pide en paralelo con el listado (mismo patron que
  // refrescarDetalle_ con Promise.all); si falla, el portafolio igual se
  // muestra (el resumen es un plus, no un bloqueante).
  var resumenPortafolioActual_ = null;

  function cargarPortafolio_() {
    proyectoActivoId_ = null;
    datosDetalleActual_ = null;
    var cont = panelProyectos_();
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando proyectos...');
    var filtros = filtroEstadoPortafolio_ ? { estado: filtroEstadoPortafolio_ } : {};
    Promise.all([
      api_('listarProyectos', filtros),
      api_('getResumenPortafolioProyectos', {})
    ]).then(function (respuestas) {
      var rProyectos = respuestas[0], rResumen = respuestas[1];
      if (!rProyectos || !rProyectos.ok) {
        cont.innerHTML = Componentes.alerta((rProyectos && rProyectos.message) || 'No se pudo cargar el portafolio.', 'error');
        return;
      }
      proyectosPortafolioSinFiltrarSalud_ = rProyectos.data || [];
      portafolioCargado_ = true;
      resumenPortafolioActual_ = (rResumen && rResumen.ok) ? rResumen.data : null;
      pintarPortafolio_(cont, proyectosPortafolioSinFiltrarSalud_);
    }).catch(function () {
      cont.innerHTML = Componentes.alerta('No se pudo conectar para cargar los proyectos.', 'error');
    });
  }

  // KPIs agregados (activos/críticos/en riesgo, próximos a cerrar, sin
  // actualizar) + carga por persona ponderada por tamaño (S=1,M=2,L=3,XL=5
  // -- ver Proyectos.getResumenPortafolio). "Muchos L/XL" es sobrecarga
  // real; un conteo plano de tareas no lo distingue (§L.3 de la propuesta).
  function pintarResumenEjecutivo_(resumen) {
    if (!resumen || !resumen.total_proyectos) return '';
    var kpis = [
      Componentes.kpi({ etiqueta: 'Proyectos activos', valor: resumen.total_proyectos }),
      Componentes.kpi({ etiqueta: '🔴 Críticos', valor: (resumen.por_salud && resumen.por_salud.critico) || 0 }),
      Componentes.kpi({ etiqueta: '🟡 En riesgo', valor: (resumen.por_salud && resumen.por_salud.riesgo) || 0 }),
      Componentes.kpi({ etiqueta: 'Vencen en 14 días', valor: resumen.proximos_a_cerrar || 0 }),
      Componentes.kpi({ etiqueta: 'Sin novedad 7+ días', valor: resumen.sin_actualizacion_reciente || 0 })
    ].join('');
    var maxCarga = Math.max(1, (resumen.carga_por_persona || []).reduce(function (m, c) { return Math.max(m, c.carga_ponderada); }, 1));
    var carga = (resumen.carga_por_persona || []).slice(0, 8).map(function (c) {
      return '<div class="sigso-py-carga-fila">' +
        '<span class="sigso-py-carga-nombre">' + Componentes.escaparHtml(c.nombre) + '</span>' +
        '<span class="sigso-py-carga-barra"><span style="width:' + Math.round((c.carga_ponderada / maxCarga) * 100) + '%"></span></span>' +
        '<span class="sigso-ayuda">' + c.total_tareas + ' tarea(s)</span>' +
      '</div>';
    }).join('');
    return '<details class="sigso-py-resumen-ejecutivo" open>' +
      '<summary>Resumen ejecutivo del portafolio</summary>' +
      '<div class="sigso-py-kpis">' + kpis + '</div>' +
      (carga
        ? '<p class="sigso-ayuda sigso-py-carga-titulo">Carga por persona (proyectos activos, ponderada por tamaño de tarea)</p>' +
          '<div class="sigso-py-carga">' + carga + '</div>'
        : '') +
    '</details>';
  }

  function pintarPortafolio_(cont, proyectosSinFiltrarSalud) {
    var hayFiltros = !!(filtroEstadoPortafolio_ || filtroSaludPortafolio_);
    var proyectos = filtroSaludPortafolio_
      ? proyectosSinFiltrarSalud.filter(function (p) { return p.salud === filtroSaludPortafolio_; })
      : proyectosSinFiltrarSalud;

    var filtrosBar = '<div class="sigso-py-filtros">' +
      Componentes.campoSelect({
        id: 'py-filtro-estado', label: false, valor: filtroEstadoPortafolio_,
        placeholder: 'Todos los estados',
        opciones: Object.keys(ESTADO_PROYECTO_ETIQUETA).map(function (e) { return { valor: e, texto: ESTADO_PROYECTO_ETIQUETA[e] }; })
      }) +
      Componentes.campoSelect({
        id: 'py-filtro-salud', label: false, valor: filtroSaludPortafolio_,
        placeholder: 'Toda salud',
        opciones: Object.keys(SALUD_ETIQUETA).map(function (s) { return { valor: s, texto: SALUD_ETIQUETA[s] }; })
      }) +
      (hayFiltros ? Componentes.boton({ texto: 'Limpiar filtros', variante: 'sutil', clase: 'js-py-limpiar-filtros', tipo: 'button' }) : '') +
      '</div>';

    var cabecera = '<div class="sigso-py-cabecera">' +
      '<p class="sigso-ayuda">Portafolio de proyectos internos: quién lidera cada uno, en qué estado está y qué necesita atención.</p>' +
      Componentes.boton({ texto: '+ Nuevo proyecto', clase: 'js-py-nuevo' }) +
      '</div>' + pintarResumenEjecutivo_(resumenPortafolioActual_) + filtrosBar;

    function wireFiltros() {
      cont.querySelector('.js-py-nuevo').addEventListener('click', abrirFormularioProyecto_);
      cont.querySelector('#py-filtro-estado').addEventListener('change', function () {
        filtroEstadoPortafolio_ = this.value;
        cargarPortafolio_();
      });
      cont.querySelector('#py-filtro-salud').addEventListener('change', function () {
        filtroSaludPortafolio_ = this.value;
        pintarPortafolio_(cont, proyectosPortafolioSinFiltrarSalud_);
      });
      var limpiar = cont.querySelector('.js-py-limpiar-filtros');
      if (limpiar) limpiar.addEventListener('click', function () {
        filtroEstadoPortafolio_ = ''; filtroSaludPortafolio_ = '';
        cargarPortafolio_();
      });
    }

    if (proyectos.length === 0) {
      var vacio = hayFiltros
        ? { texto: 'Ningún proyecto coincide con estos filtros.' }
        : { texto: 'Todavía no participas en ningún proyecto.', detalle: 'Crea uno para empezar.' };
      cont.innerHTML = cabecera + Componentes.vacio(vacio);
      wireFiltros();
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
    wireFiltros();
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
    var cont = panelProyectos_();
    if (!cont || !datosDetalleActual_) { refrescarDetalle_(); return; }
    pintarDetalle_(cont, datosDetalleActual_.detalle, datosDetalleActual_.tareas, datosDetalleActual_.sala);
  }

  function refrescarDetalle_() {
    var cont = panelProyectos_();
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
    // v9.2: la capacidad de gestion la resuelve el backend (puede_gestionar:
    // LIDER del proyecto o ADM). Fallback a rol_actual==='LIDER' para que el
    // frontend siga funcionando ANTES de desplegar el backend nuevo (el ADM
    // gana los controles recien cuando el Backoffice actualizado esta en
    // produccion) -- degradacion elegante, sin regresion.
    var puedeGestionar = detalle.puede_gestionar === true || detalle.rol_actual === 'LIDER';
    var PESTANAS = [
      { id: 'resumen', texto: 'Resumen' },
      { id: 'sala', texto: 'Sala' },
      { id: 'tareas', texto: 'Tareas' },
      { id: 'hitos', texto: 'Hitos' },
      { id: 'entregables', texto: 'Entregables' },
      { id: 'riesgos', texto: 'Riesgos' },
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
    else if (pestanaActiva_ === 'entregables') cuerpo = pintarEntregables_(detalle, puedeGestionar);
    else if (pestanaActiva_ === 'riesgos') cuerpo = pintarRiesgos_(detalle, puedeGestionar);
    else if (pestanaActiva_ === 'equipo') cuerpo = pintarEquipo_(detalle, puedeGestionar);

    cont.innerHTML = cabecera + '<div class="sigso-py-cuerpo">' + cuerpo + '</div>';

    cont.querySelector('.js-py-volver').addEventListener('click', cargarPortafolio_);
    cont.querySelectorAll('.js-py-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        cambiarPestana_(btn.getAttribute('data-tab'));
      });
    });

    wireAccionesPestana_(cont, detalle, tareas, puedeGestionar);
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
    // v9.3: menciones -- el backend (notificarSala_) ya notifica a quien
    // venga en evento.menciones, pero la UI nunca lo mandaba (campo muerto).
    // Checklist opcional y plegada (patron <details> ya usado en
    // dashboard.js/detalle.js para acciones secundarias) con los integrantes
    // del proyecto. No se excluye al propio autor de la lista -- getDetalle
    // no expone el email de quien consulta, y mencionarse a uno mismo es
    // inofensivo (a lo sumo, una notificacion de mas); quien no lo quiera
    // simplemente no marca su propia casilla.
    var checklistMenciones = (detalle.integrantes || []).length
      ? '<details class="sigso-py-menciones">' +
          '<summary>Mencionar a alguien (opcional)</summary>' +
          (detalle.integrantes || []).map(function (i) {
            return '<label class="sigso-campo-check"><input type="checkbox" class="js-py-mencion" value="' +
              Componentes.escaparHtml(i.usuario_email) + '"> ' + Componentes.escaparHtml(i.usuario_nombre || i.usuario_email) + '</label>';
          }).join('') +
        '</details>'
      : '';
    var form = puedePublicar
      ? '<form id="form-py-sala" class="sigso-py-sala-form">' +
          Componentes.campoTextarea({ id: 'py-sala-cuerpo', label: 'Publicar en la sala', placeholder: 'Comparte un avance, decisión, o pide algo...', requerido: true }) +
          checklistMenciones +
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

    var integrantesPorEmail_ = {};
    (detalle.integrantes || []).forEach(function (i) { integrantesPorEmail_[normalizarEmail_(i.usuario_email)] = i.usuario_nombre || i.usuario_email; });

    var feed = sala.map(function (e) {
      // v9.4: REUNION se suma a los tipos convertibles -- "reunion -> tareas"
      // (§L.6 de la propuesta) era casi gratis: el mecanismo ya existia para
      // COMENTARIO/SOLICITUD_LIDER/DECISION, solo faltaba incluir el tipo.
      var puedeConvertir = puedePublicar && !e.ref_id &&
        (e.tipo === 'COMENTARIO' || e.tipo === 'SOLICITUD_LIDER' || e.tipo === 'DECISION' || e.tipo === 'REUNION');
      var menciones = (e.menciones || '').split(',').map(function (m) { return normalizarEmail_(m); }).filter(Boolean);
      return '<div class="sigso-py-evento sigso-py-evento--' + e.tipo.toLowerCase() + '">' +
        '<div class="sigso-py-evento__top">' +
          '<span class="sigso-py-evento__autor">' + Componentes.escaparHtml(e.autor_nombre || e.autor_email) + '</span>' +
          Componentes.badge(TIPO_EVENTO_ETIQUETA[e.tipo] || e.tipo, 'neutro') +
          '<span class="sigso-py-evento__fecha">' + fechaHora_(e.timestamp) + '</span>' +
        '</div>' +
        (e.titulo ? '<p class="sigso-py-evento__titulo">' + Componentes.escaparHtml(e.titulo) + '</p>' : '') +
        '<p class="sigso-py-evento__cuerpo">' + Componentes.escaparHtml(e.cuerpo || '') + '</p>' +
        (menciones.length
          ? '<p class="sigso-ayuda">@ ' + menciones.map(function (m) { return Componentes.escaparHtml(integrantesPorEmail_[m] || m); }).join(', ') + '</p>'
          : '') +
        // v9.4: ref_tipo/ref_id ahora tambien enlazan eventos de sistema a
        // su propio ENTREGABLE/RIESGO (autorreferencia, para trazabilidad),
        // no solo a una tarea convertida -- el texto "Convertido en tarea"
        // solo aplica cuando ref_tipo==='ACTIVIDAD'.
        (e.ref_tipo === 'ACTIVIDAD' ? '<p class="sigso-ayuda">→ Convertido en tarea.</p>' : '') +
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
        // v9.4: dependencia comprometida -- bandera derivada (nunca mueve
        // fechas ni bloquea, §I de la propuesta), solo avisa.
        (a.dependencia_comprometida
          ? '<div class="sigso-mt-bloqueo">⚠ Depende de "' + Componentes.escaparHtml(a.dependencia_titulo) + '", que está atrasada.</div>'
          : '') +
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
    var ahora = new Date();
    var filas = detalle.hitos.map(function (h) {
      var avance = h.avance_pct === null || h.avance_pct === undefined ? '—' : h.avance_pct + '%';
      var terminal = h.estado === 'COMPLETADO' || h.estado === 'CANCELADO';
      var vencido = !terminal && h.fecha_objetivo && new Date(h.fecha_objetivo) < ahora;
      var botones = puedeGestionar
        ? '<div class="sigso-py-hito__acciones">' +
            (!terminal ? Componentes.boton({ texto: '✓ Completar', variante: 'sutil', clase: 'js-py-hito-completar', idx: h.hito_id }) : '') +
            Componentes.boton({ texto: 'Editar', variante: 'sutil', clase: 'js-py-hito-editar', idx: h.hito_id }) +
            (h.total_tareas === 0 && h.estado !== 'CANCELADO' ? Componentes.boton({ texto: 'Eliminar', variante: 'sutil', clase: 'js-py-hito-eliminar', idx: h.hito_id }) : '') +
          '</div>'
        : '';
      return '<div class="sigso-py-hito' + (vencido ? ' sigso-py-hito--vencido' : '') + '">' +
        '<div class="sigso-py-hito__top">' +
          '<span class="sigso-py-hito__nombre">' + Componentes.escaparHtml(h.nombre) + '</span>' +
          Componentes.badge(HITO_ESTADO_ETIQUETA[h.estado] || h.estado, 'neutro') +
        '</div>' +
        (h.descripcion ? '<p>' + Componentes.escaparHtml(h.descripcion) + '</p>' : '') +
        '<p class="sigso-ayuda">' + h.total_tareas + ' tarea(s) · ' + avance + ' de avance' +
          (h.fecha_objetivo ? ' · vence ' + fechaCorta_(h.fecha_objetivo) : '') +
          (vencido ? ' · <b class="sigso-py-hito__vencido-tag">vencido</b>' : '') + '</p>' +
        botones +
      '</div>';
    }).join('');
    return acciones + '<div class="sigso-py-lista">' + filas + '</div>';
  }

  // --- Entregables (v9.4, Fase 2) -------------------------------------

  function entregableBadgeVariante_(estado) {
    if (estado === 'APROBADO') return 'ok';
    if (estado === 'OBSERVADO') return 'alerta';
    return 'neutro';
  }

  function pintarEntregables_(detalle, puedeGestionar) {
    var puedeCrear = detalle.rol_actual && detalle.rol_actual !== 'OBSERVADOR';
    var acciones = puedeCrear
      ? '<div class="sigso-py-cabecera">' + Componentes.boton({ texto: '+ Nuevo entregable', clase: 'js-py-nuevo-entregable' }) + '</div>'
      : '';
    var entregables = detalle.entregables || [];
    if (entregables.length === 0) {
      return acciones + Componentes.vacio({ texto: 'Todavía no hay entregables definidos.' });
    }
    var integrantesPorEmail = {};
    (detalle.integrantes || []).forEach(function (i) { integrantesPorEmail[normalizarEmail_(i.usuario_email)] = i.usuario_nombre || i.usuario_email; });

    var filas = entregables.map(function (e) {
      // El backend valida quien es realmente el responsable (mismo criterio
      // que el check-in en pintarTareas_): el boton se muestra a cualquiera
      // que pueda actuar en el proyecto, el servidor rechaza si no corresponde.
      var puedeMarcar = puedeCrear && (e.estado === 'PENDIENTE' || e.estado === 'OBSERVADO');
      var puedeRevisar = puedeGestionar && e.estado === 'ENTREGADO';
      var botones = '<div class="sigso-py-hito__acciones">' +
          (puedeMarcar ? Componentes.boton({ texto: 'Marcar entregado', variante: 'sutil', clase: 'js-py-entregable-marcar', idx: e.entregable_id }) : '') +
          (puedeRevisar ? Componentes.boton({ texto: 'Aprobar', variante: 'sutil', clase: 'js-py-entregable-aprobar', idx: e.entregable_id }) : '') +
          (puedeRevisar ? Componentes.boton({ texto: 'Observar', variante: 'sutil', clase: 'js-py-entregable-observar', idx: e.entregable_id }) : '') +
          (puedeGestionar && e.estado === 'PENDIENTE' ? Componentes.boton({ texto: 'Eliminar', variante: 'sutil', clase: 'js-py-entregable-eliminar', idx: e.entregable_id }) : '') +
        '</div>';
      return '<div class="sigso-py-tarea">' +
        '<div class="sigso-py-tarea__top">' +
          '<span class="sigso-py-tarea__titulo">' + Componentes.escaparHtml(e.nombre) + '</span>' +
          Componentes.badge(ENTREGABLE_ESTADO_ETIQUETA[e.estado] || e.estado, entregableBadgeVariante_(e.estado)) +
        '</div>' +
        (e.descripcion ? '<p>' + Componentes.escaparHtml(e.descripcion) + '</p>' : '') +
        '<div class="sigso-py-tarea__meta">' +
          '<span>' + Componentes.escaparHtml(integrantesPorEmail[normalizarEmail_(e.responsable_email)] || e.responsable_email) + '</span>' +
          '<span>Vence ' + fechaCorta_(e.fecha_comprometida) + '</span>' +
        '</div>' +
        (e.estado === 'OBSERVADO' && e.observaciones ? '<div class="sigso-mt-bloqueo">⏸ ' + Componentes.escaparHtml(e.observaciones) + '</div>' : '') +
        (e.url_evidencia ? '<p class="sigso-ayuda"><a href="' + Componentes.escaparHtml(e.url_evidencia) + '" target="_blank" rel="noopener noreferrer">Ver evidencia</a></p>' : '') +
        botones +
      '</div>';
    }).join('');
    return acciones + '<div class="sigso-py-lista">' + filas + '</div>';
  }

  // --- Riesgos (v9.4, Fase 3) -------------------------------------------

  function riesgoBadgeVariante_(nivel) {
    if (nivel === 'ALTA') return 'critico';
    if (nivel === 'MEDIA') return 'alerta';
    return 'ok';
  }

  function pintarRiesgos_(detalle, puedeGestionar) {
    var puedeCrear = detalle.rol_actual && detalle.rol_actual !== 'OBSERVADOR';
    var acciones = puedeCrear
      ? '<div class="sigso-py-cabecera">' + Componentes.boton({ texto: '+ Nuevo riesgo', clase: 'js-py-nuevo-riesgo' }) + '</div>'
      : '';
    var riesgos = detalle.riesgos || [];
    if (riesgos.length === 0) {
      return acciones + Componentes.vacio({ texto: 'No hay riesgos registrados.' });
    }
    var integrantesPorEmail = {};
    (detalle.integrantes || []).forEach(function (i) { integrantesPorEmail[normalizarEmail_(i.usuario_email)] = i.usuario_nombre || i.usuario_email; });

    var filas = riesgos.map(function (r) {
      var puedeEditar = puedeGestionar && r.estado !== 'CERRADO';
      return '<div class="sigso-py-riesgo sigso-py-riesgo--' + (r.nivel || '').toLowerCase() + '">' +
        '<div class="sigso-py-tarea__top">' +
          '<span class="sigso-py-tarea__titulo">' + Componentes.escaparHtml(r.descripcion) + '</span>' +
          Componentes.badge('Riesgo ' + (RIESGO_NIVEL_ETIQUETA[r.nivel] || r.nivel), riesgoBadgeVariante_(r.nivel)) +
        '</div>' +
        '<div class="sigso-py-tarea__meta">' +
          '<span>Probabilidad ' + (RIESGO_NIVEL_ETIQUETA[r.probabilidad] || r.probabilidad) + '</span>' +
          '<span>Impacto ' + (RIESGO_NIVEL_ETIQUETA[r.impacto] || r.impacto) + '</span>' +
          '<span>' + Componentes.escaparHtml(integrantesPorEmail[normalizarEmail_(r.responsable_email)] || r.responsable_email) + '</span>' +
          '<span>' + Componentes.badge(RIESGO_ESTADO_ETIQUETA[r.estado] || r.estado, 'neutro') + '</span>' +
        '</div>' +
        (r.mitigacion ? '<p class="sigso-ayuda"><b>Mitigación:</b> ' + Componentes.escaparHtml(r.mitigacion) + '</p>' : '') +
        (puedeEditar
          ? '<div class="sigso-py-hito__acciones">' +
              Componentes.boton({ texto: 'Editar', variante: 'sutil', clase: 'js-py-riesgo-editar', idx: r.riesgo_id }) +
              Componentes.boton({ texto: 'Cerrar', variante: 'sutil', clase: 'js-py-riesgo-cerrar', idx: r.riesgo_id }) +
            '</div>'
          : '') +
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

  function wireAccionesPestana_(cont, detalle, tareas, puedeGestionar) {
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
        var menciones = Array.from(cont.querySelectorAll('.js-py-mencion:checked')).map(function (el) { return el.value; });
        api_('publicarEnSalaProyecto', { proyecto_id: proyectoActivoId_, tipo: tipo, cuerpo: cuerpo, menciones: menciones }).then(function (respuesta) {
          if (!respuesta || !respuesta.ok) {
            Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo publicar.', tipo: 'error' });
            return;
          }
          refrescarDetalle_();
        });
      });
    }
    cont.querySelectorAll('.js-py-convertir').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-idx');
        var sala = (datosDetalleActual_ && datosDetalleActual_.sala) || [];
        var ev = null;
        for (var i = 0; i < sala.length; i++) { if (sala[i].evento_id === id) { ev = sala[i]; break; } }
        abrirFormularioConvertir_(ev || { evento_id: id }, detalle);
      });
    });

    var nuevaTarea = cont.querySelector('.js-py-nueva-tarea');
    if (nuevaTarea) nuevaTarea.addEventListener('click', function () { abrirFormularioTarea_(detalle, tareas); });

    var nuevoHito = cont.querySelector('.js-py-nuevo-hito');
    if (nuevoHito) nuevoHito.addEventListener('click', abrirFormularioHito_);

    // v9.1: gestion de hitos (editar / completar / eliminar). Los datos del
    // hito se toman de la cache de detalle -- no hay endpoint "getHito".
    var hitosCache = (datosDetalleActual_ && datosDetalleActual_.detalle && datosDetalleActual_.detalle.hitos) || [];
    function hitoPorId_(id) {
      for (var i = 0; i < hitosCache.length; i++) { if (hitosCache[i].hito_id === id) return hitosCache[i]; }
      return null;
    }
    cont.querySelectorAll('.js-py-hito-editar').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var h = hitoPorId_(btn.getAttribute('data-idx'));
        if (h) abrirFormularioEditarHito_(h);
      });
    });
    cont.querySelectorAll('.js-py-hito-completar').forEach(function (btn) {
      btn.addEventListener('click', function () {
        api_('gestionarHitoProyecto', {
          proyecto_id: proyectoActivoId_, hito_id: btn.getAttribute('data-idx'), estado: 'COMPLETADO'
        }).then(function (respuesta) {
          if (!respuesta || !respuesta.ok) {
            Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo actualizar el hito.', tipo: 'error' });
            return;
          }
          refrescarDetalle_();
        });
      });
    });
    cont.querySelectorAll('.js-py-hito-eliminar').forEach(function (btn) {
      btn.addEventListener('click', function () {
        Componentes.confirmar({ titulo: 'Eliminar hito', mensaje: '¿Confirmas eliminar este hito? (solo se puede si no tiene tareas)' }).then(function (ok) {
          if (!ok) return;
          api_('gestionarHitoProyecto', {
            proyecto_id: proyectoActivoId_, accion: 'eliminar', hito_id: btn.getAttribute('data-idx')
          }).then(function (respuesta) {
            if (!respuesta || !respuesta.ok) {
              Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo eliminar el hito.', tipo: 'error' });
              return;
            }
            refrescarDetalle_();
          });
        });
      });
    });

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

    // --- v9.4: entregables ------------------------------------------------
    var nuevoEntregable = cont.querySelector('.js-py-nuevo-entregable');
    if (nuevoEntregable) nuevoEntregable.addEventListener('click', function () { abrirFormularioEntregable_(detalle); });

    cont.querySelectorAll('.js-py-entregable-marcar').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-idx');
        Componentes.prompt({ titulo: 'Marcar como entregado', mensaje: 'Link de evidencia (opcional)' }).then(function (url) {
          if (url === null || url === undefined) return; // cancelado; '' (vacio) SI procede -- ver comentario del prompt.
          api_('gestionarEntregableProyecto', {
            proyecto_id: proyectoActivoId_, accion: 'marcarEntregado', entregable_id: id, url_evidencia: url
          }).then(function (respuesta) {
            if (!respuesta || !respuesta.ok) {
              Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo marcar como entregado.', tipo: 'error' });
              return;
            }
            refrescarDetalle_();
          });
        });
      });
    });
    cont.querySelectorAll('.js-py-entregable-aprobar').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-idx');
        Componentes.confirmar({ titulo: 'Aprobar entregable', mensaje: '¿Confirmas aprobar este entregable?' }).then(function (ok) {
          if (!ok) return;
          api_('revisarEntregableProyecto', { proyecto_id: proyectoActivoId_, entregable_id: id, resultado: 'APROBADO' }).then(function (respuesta) {
            if (!respuesta || !respuesta.ok) {
              Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo aprobar el entregable.', tipo: 'error' });
              return;
            }
            refrescarDetalle_();
          });
        });
      });
    });
    cont.querySelectorAll('.js-py-entregable-observar').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-idx');
        Componentes.prompt({ titulo: 'Observar entregable', mensaje: 'Indica qué falta corregir.' }).then(function (motivo) {
          if (!motivo || !String(motivo).trim()) return;
          api_('revisarEntregableProyecto', {
            proyecto_id: proyectoActivoId_, entregable_id: id, resultado: 'OBSERVADO', observaciones: motivo
          }).then(function (respuesta) {
            if (!respuesta || !respuesta.ok) {
              Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo observar el entregable.', tipo: 'error' });
              return;
            }
            refrescarDetalle_();
          });
        });
      });
    });
    cont.querySelectorAll('.js-py-entregable-eliminar').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-idx');
        Componentes.confirmar({ titulo: 'Eliminar entregable', mensaje: '¿Confirmas eliminar este entregable?' }).then(function (ok) {
          if (!ok) return;
          api_('gestionarEntregableProyecto', { proyecto_id: proyectoActivoId_, accion: 'eliminar', entregable_id: id }).then(function (respuesta) {
            if (!respuesta || !respuesta.ok) {
              Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo eliminar el entregable.', tipo: 'error' });
              return;
            }
            refrescarDetalle_();
          });
        });
      });
    });

    // --- v9.4: riesgos ------------------------------------------------------
    var nuevoRiesgo = cont.querySelector('.js-py-nuevo-riesgo');
    if (nuevoRiesgo) nuevoRiesgo.addEventListener('click', function () { abrirFormularioRiesgo_(detalle); });

    var riesgosCache = (datosDetalleActual_ && datosDetalleActual_.detalle && datosDetalleActual_.detalle.riesgos) || [];
    function riesgoPorId_(id) {
      for (var i = 0; i < riesgosCache.length; i++) { if (riesgosCache[i].riesgo_id === id) return riesgosCache[i]; }
      return null;
    }
    cont.querySelectorAll('.js-py-riesgo-editar').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var r = riesgoPorId_(btn.getAttribute('data-idx'));
        if (r) abrirFormularioEditarRiesgo_(r, detalle);
      });
    });
    cont.querySelectorAll('.js-py-riesgo-cerrar').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-idx');
        Componentes.confirmar({ titulo: 'Cerrar riesgo', mensaje: '¿Confirmas cerrar este riesgo?' }).then(function (ok) {
          if (!ok) return;
          api_('gestionarRiesgoProyecto', { proyecto_id: proyectoActivoId_, accion: 'eliminar', riesgo_id: id }).then(function (respuesta) {
            if (!respuesta || !respuesta.ok) {
              Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo cerrar el riesgo.', tipo: 'error' });
              return;
            }
            refrescarDetalle_();
          });
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
          Componentes.campoTextarea({ id: 'py-ed-objetivo', label: 'Objetivo / resultado esperado', valor: p.objetivo }) +
          '<div class="sigso-py-form-fila">' +
            Componentes.campoTexto({ id: 'py-ed-fecha-inicio', label: 'Fecha de inicio', tipo: 'date', valor: fechaISOCorta_(p.fecha_inicio) }) +
            Componentes.campoTexto({ id: 'py-ed-fecha-objetivo', label: 'Fecha objetivo', tipo: 'date', valor: fechaISOCorta_(p.fecha_objetivo) }) +
          '</div>' +
          '<div class="sigso-py-form-fila">' +
            Componentes.campoSelect({
              id: 'py-ed-prioridad', label: 'Prioridad', valor: p.prioridad || 'P4', placeholder: false,
              opciones: [{ valor: 'P1', texto: 'P1 — Crítica' }, { valor: 'P2', texto: 'P2 — Alta' },
                { valor: 'P3', texto: 'P3 — Media' }, { valor: 'P4', texto: 'P4 — Normal' }, { valor: 'P5', texto: 'P5 — Baja' }]
            }) +
            Componentes.campoSelect({
              id: 'py-ed-estado', label: 'Estado', valor: p.estado, placeholder: false,
              opciones: Object.keys(ESTADO_PROYECTO_ETIQUETA).filter(function (e) { return e !== 'CERRADO'; }).map(function (e) {
                return { valor: e, texto: ESTADO_PROYECTO_ETIQUETA[e] };
              })
            }) +
          '</div>' +
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
        objetivo: document.getElementById('py-ed-objetivo').value,
        fecha_inicio: document.getElementById('py-ed-fecha-inicio').value,
        fecha_objetivo: document.getElementById('py-ed-fecha-objetivo').value,
        prioridad: document.getElementById('py-ed-prioridad').value,
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

  function abrirFormularioTarea_(detalle, tareas) {
    var opcionesIntegrantes = (detalle.integrantes || []).map(function (i) {
      return { valor: i.usuario_email, texto: i.usuario_nombre || i.usuario_email };
    });
    var opcionesHitos = (detalle.hitos || []).map(function (h) { return { valor: h.hito_id, texto: h.nombre }; });
    // v9.4 (Fase 2): dependencia opcional -- solo informativa, nunca bloquea
    // ni mueve fechas (§I de la propuesta). Solo tareas de este mismo proyecto.
    var opcionesDependencia = (tareas || []).map(function (a) { return { valor: a.actividad_id, texto: a.titulo }; });
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
          (opcionesDependencia.length ? Componentes.campoSelect({ id: 'py-t-depende', label: 'Depende de (opcional)', opciones: opcionesDependencia }) : '') +
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
      var dependeEl = document.getElementById('py-t-depende');
      api_('crearTareaProyecto', {
        proyecto_id: proyectoActivoId_,
        hito_id: hitoEl ? hitoEl.value : '',
        depende_de: dependeEl ? dependeEl.value : '',
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

  // v9.1: editar un hito existente (nombre, descripcion, fecha, estado).
  // Reusa gestionarHitoProyecto con hito_id -> el backend actualiza en vez
  // de crear (ver Proyectos.gestionarHito).
  function abrirFormularioEditarHito_(h) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Editar hito</h3>' +
        '<form id="form-py-hito-editar">' +
          Componentes.campoTexto({ id: 'py-he-nombre', label: 'Nombre', valor: h.nombre, requerido: true }) +
          Componentes.campoTextarea({ id: 'py-he-descripcion', label: 'Descripción', valor: h.descripcion }) +
          Componentes.campoTexto({ id: 'py-he-fecha', label: 'Fecha objetivo', tipo: 'date', valor: fechaISOCorta_(h.fecha_objetivo) }) +
          Componentes.campoSelect({
            id: 'py-he-estado', label: 'Estado', valor: h.estado || 'PENDIENTE', placeholder: false,
            opciones: Object.keys(HITO_ESTADO_ETIQUETA).map(function (e) { return { valor: e, texto: HITO_ESTADO_ETIQUETA[e] }; })
          }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-py-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-py-hito-editar').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('gestionarHitoProyecto', {
        proyecto_id: proyectoActivoId_,
        hito_id: h.hito_id,
        nombre: document.getElementById('py-he-nombre').value,
        descripcion: document.getElementById('py-he-descripcion').value,
        fecha_objetivo: document.getElementById('py-he-fecha').value,
        estado: document.getElementById('py-he-estado').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar el hito.', tipo: 'error' });
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

  // v9.4 (Fase 2): nuevo entregable.
  function abrirFormularioEntregable_(detalle) {
    var opcionesIntegrantes = (detalle.integrantes || []).map(function (i) {
      return { valor: i.usuario_email, texto: i.usuario_nombre || i.usuario_email };
    });
    var opcionesHitos = (detalle.hitos || []).map(function (h) { return { valor: h.hito_id, texto: h.nombre }; });
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Nuevo entregable</h3>' +
        '<form id="form-py-entregable">' +
          Componentes.campoTexto({ id: 'py-e-nombre', label: 'Nombre', requerido: true }) +
          Componentes.campoTextarea({ id: 'py-e-descripcion', label: 'Descripción' }) +
          Componentes.campoSelect({ id: 'py-e-responsable', label: 'Responsable', opciones: opcionesIntegrantes, requerido: true }) +
          (opcionesHitos.length ? Componentes.campoSelect({ id: 'py-e-hito', label: 'Hito (opcional)', opciones: opcionesHitos }) : '') +
          Componentes.campoTexto({ id: 'py-e-fecha', label: 'Fecha comprometida', tipo: 'date', requerido: true }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-py-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Crear entregable', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-py-entregable').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var hitoEl = document.getElementById('py-e-hito');
      api_('gestionarEntregableProyecto', {
        proyecto_id: proyectoActivoId_,
        nombre: document.getElementById('py-e-nombre').value,
        descripcion: document.getElementById('py-e-descripcion').value,
        responsable_email: document.getElementById('py-e-responsable').value,
        hito_id: hitoEl ? hitoEl.value : '',
        fecha_comprometida: document.getElementById('py-e-fecha').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo crear el entregable.', tipo: 'error' });
          return;
        }
        cerrar();
        refrescarDetalle_();
      });
    });
  }

  // v9.4 (Fase 3): nuevo riesgo. nivel lo calcula el backend (probabilidad x
  // impacto) -- el formulario nunca lo pide ni lo muestra como campo editable.
  function abrirFormularioRiesgo_(detalle) {
    var opcionesIntegrantes = (detalle.integrantes || []).map(function (i) {
      return { valor: i.usuario_email, texto: i.usuario_nombre || i.usuario_email };
    });
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Nuevo riesgo</h3>' +
        '<form id="form-py-riesgo">' +
          Componentes.campoTextarea({ id: 'py-r-descripcion', label: 'Descripción del riesgo', requerido: true }) +
          '<div class="sigso-py-form-fila">' +
            Componentes.campoSelect({
              id: 'py-r-probabilidad', label: 'Probabilidad', valor: 'MEDIA', placeholder: false,
              opciones: [{ valor: 'BAJA', texto: 'Baja' }, { valor: 'MEDIA', texto: 'Media' }, { valor: 'ALTA', texto: 'Alta' }]
            }) +
            Componentes.campoSelect({
              id: 'py-r-impacto', label: 'Impacto', valor: 'MEDIA', placeholder: false,
              opciones: [{ valor: 'BAJA', texto: 'Baja' }, { valor: 'MEDIA', texto: 'Media' }, { valor: 'ALTA', texto: 'Alta' }]
            }) +
          '</div>' +
          // Responsable opcional -- sin elegir, el backend lo asigna al lider
          // del proyecto por defecto (Proyectos.gestionarRiesgo).
          Componentes.campoSelect({ id: 'py-r-responsable', label: 'Responsable (opcional, por defecto el líder)', opciones: opcionesIntegrantes }) +
          Componentes.campoTextarea({ id: 'py-r-mitigacion', label: 'Mitigación (opcional)' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-py-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Registrar riesgo', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-py-riesgo').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('gestionarRiesgoProyecto', {
        proyecto_id: proyectoActivoId_,
        descripcion: document.getElementById('py-r-descripcion').value,
        probabilidad: document.getElementById('py-r-probabilidad').value,
        impacto: document.getElementById('py-r-impacto').value,
        responsable_email: document.getElementById('py-r-responsable').value,
        mitigacion: document.getElementById('py-r-mitigacion').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo registrar el riesgo.', tipo: 'error' });
          return;
        }
        cerrar();
        refrescarDetalle_();
      });
    });
  }

  function abrirFormularioEditarRiesgo_(r, detalle) {
    var opcionesIntegrantes = (detalle.integrantes || []).map(function (i) {
      return { valor: i.usuario_email, texto: i.usuario_nombre || i.usuario_email };
    });
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Editar riesgo</h3>' +
        '<form id="form-py-riesgo-editar">' +
          Componentes.campoTextarea({ id: 'py-re-descripcion', label: 'Descripción del riesgo', valor: r.descripcion, requerido: true }) +
          '<div class="sigso-py-form-fila">' +
            Componentes.campoSelect({
              id: 'py-re-probabilidad', label: 'Probabilidad', valor: r.probabilidad, placeholder: false,
              opciones: [{ valor: 'BAJA', texto: 'Baja' }, { valor: 'MEDIA', texto: 'Media' }, { valor: 'ALTA', texto: 'Alta' }]
            }) +
            Componentes.campoSelect({
              id: 'py-re-impacto', label: 'Impacto', valor: r.impacto, placeholder: false,
              opciones: [{ valor: 'BAJA', texto: 'Baja' }, { valor: 'MEDIA', texto: 'Media' }, { valor: 'ALTA', texto: 'Alta' }]
            }) +
          '</div>' +
          Componentes.campoSelect({ id: 'py-re-responsable', label: 'Responsable', valor: r.responsable_email, opciones: opcionesIntegrantes }) +
          Componentes.campoTextarea({ id: 'py-re-mitigacion', label: 'Mitigación', valor: r.mitigacion }) +
          Componentes.campoSelect({
            id: 'py-re-estado', label: 'Estado', valor: r.estado || 'ABIERTO', placeholder: false,
            opciones: [{ valor: 'ABIERTO', texto: 'Abierto' }, { valor: 'EN_MITIGACION', texto: 'En mitigación' }]
          }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-py-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-py-riesgo-editar').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('gestionarRiesgoProyecto', {
        proyecto_id: proyectoActivoId_,
        riesgo_id: r.riesgo_id,
        descripcion: document.getElementById('py-re-descripcion').value,
        probabilidad: document.getElementById('py-re-probabilidad').value,
        impacto: document.getElementById('py-re-impacto').value,
        responsable_email: document.getElementById('py-re-responsable').value,
        mitigacion: document.getElementById('py-re-mitigacion').value,
        estado: document.getElementById('py-re-estado').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar el riesgo.', tipo: 'error' });
          return;
        }
        cerrar();
        refrescarDetalle_();
      });
    });
  }

  // v9.1: convertir un evento de la sala (comentario/decisión/solicitud) en
  // una tarea real, con un modal en vez de 3 prompts encadenados. Prellena
  // título y descripción desde el texto del evento y ofrece los integrantes
  // del proyecto como responsable (evita el correo escrito a mano, que el
  // backend rechazaba si no era integrante). Reusa convertirEventoEnTareaProyecto.
  function abrirFormularioConvertir_(ev, detalle) {
    var opcionesIntegrantes = (detalle.integrantes || []).map(function (i) {
      return { valor: i.usuario_email, texto: i.usuario_nombre || i.usuario_email };
    });
    var opcionesHitos = (detalle.hitos || []).map(function (h) { return { valor: h.hito_id, texto: h.nombre }; });
    var cuerpoOrigen = ev.cuerpo || '';
    var tituloSugerido = cuerpoOrigen.length > 60 ? cuerpoOrigen.slice(0, 57).trim() + '…' : cuerpoOrigen;
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Convertir en tarea</h3>' +
        (cuerpoOrigen ? '<p class="sigso-ayuda">Desde: “' + Componentes.escaparHtml(cuerpoOrigen.slice(0, 140)) + '”</p>' : '') +
        '<form id="form-py-convertir">' +
          Componentes.campoTexto({ id: 'py-cv-titulo', label: 'Título', requerido: true, valor: tituloSugerido }) +
          Componentes.campoTextarea({ id: 'py-cv-descripcion', label: 'Descripción', valor: cuerpoOrigen }) +
          Componentes.campoSelect({ id: 'py-cv-responsable', label: 'Responsable', opciones: opcionesIntegrantes, requerido: true }) +
          (opcionesHitos.length ? Componentes.campoSelect({ id: 'py-cv-hito', label: 'Hito (opcional)', opciones: opcionesHitos }) : '') +
          '<div class="sigso-py-form-fila">' +
            Componentes.campoTexto({ id: 'py-cv-fecha', label: 'Fecha comprometida', tipo: 'date', requerido: true }) +
            Componentes.campoSelect({
              id: 'py-cv-prioridad', label: 'Prioridad', valor: 'P4', placeholder: false,
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
    document.getElementById('form-py-convertir').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var hitoEl = document.getElementById('py-cv-hito');
      api_('convertirEventoEnTareaProyecto', {
        proyecto_id: proyectoActivoId_,
        evento_id: ev.evento_id,
        titulo: document.getElementById('py-cv-titulo').value,
        descripcion: document.getElementById('py-cv-descripcion').value,
        responsable_email: document.getElementById('py-cv-responsable').value,
        hito_id: hitoEl ? hitoEl.value : '',
        fecha_compromiso: document.getElementById('py-cv-fecha').value,
        prioridad: document.getElementById('py-cv-prioridad').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo convertir.', tipo: 'error' });
          return;
        }
        cerrar();
        refrescarDetalle_();
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

  // ISO -> 'YYYY-MM-DD' para prellenar un <input type="date"> (UTC, igual
  // criterio que fechaCorta_). Vacio si no hay fecha valida.
  function fechaISOCorta_(iso) {
    if (!iso) return '';
    var f = new Date(iso);
    if (isNaN(f.getTime())) return '';
    return f.getUTCFullYear() + '-' + ('0' + (f.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + f.getUTCDate()).slice(-2);
  }

  function fechaHora_(iso) {
    if (!iso) return '';
    var f = new Date(iso);
    if (isNaN(f.getTime())) return '';
    return f.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  // ==========================================================================
  // v12.4 (Fase 3) — Navegación y reportes de Proyectos
  //
  // A diferencia de Gerencia y Jefatura, acá NO se tocan las 7 pestañas del
  // detalle de un proyecto: esas son pestañas sobre una ENTIDAD (un proyecto
  // concreto), no navegación de módulo. Convertirlas daría tres niveles
  // verticales a la vez, que es lo que el encargo pedía evitar.
  //
  // Lo que sí es navegación de módulo son sus dos destinos: el portafolio y
  // los reportes.
  var ARQUITECTURA_PROYECTOS = [
    { id: 'portafolio', nombre: 'Portafolio', icono: 'caja', plano: true, items: [
      { id: 'portafolio', nombre: 'Portafolio' }
    ] },
    { id: 'reportes', nombre: 'Reportes', icono: 'grafico', plano: true,
      descripcion: 'Estado y avance del portafolio', items: [
      { id: 'reportes', nombre: 'Centro de reportes' }
    ] }
  ];

  var vistaProyectos_ = 'portafolio';
  // proyectosPortafolioSinFiltrarSalud_ arranca en [] y no en null, asi que
  // no sirve para saber si YA se pidio: una lista vacia legitima (sin
  // proyectos) se veria igual que 'todavia no cargue'.
  var portafolioCargado_ = false;
  var reportePyAbierto_ = null;

  // Crea el layout de dos columnas una vez y devuelve SIEMPRE el panel
  // derecho, para que las vistas que escriben el contenido no pisen la
  // navegación (mismo patrón que panelSgc_ en Calidad).
  function panelProyectos_() {
    var raiz = document.getElementById('proyectos-contenido');
    if (!raiz) return null;
    var panel = raiz.querySelector('.sigso-modulo-layout__panel');
    if (!panel) {
      // v13.0: sin <nav> interno -- la navegacion vive en el sidebar.
      raiz.innerHTML =
        '<div class="sigso-modulo-layout">' +
          '<div class="sigso-modulo-layout__panel"></div>' +
        '</div>';
      panel = raiz.querySelector('.sigso-modulo-layout__panel');
    }
    pintarNavProyectos_();
    return panel;
  }

  // v13.0: la navegacion vive en el sidebar.
  function pintarNavProyectos_() {
    if (!window.SigsoNav) return;
    SigsoNav.registrar('proyectos', {
      nombre: 'Proyectos',
      submodulos: ARQUITECTURA_PROYECTOS
    });
    if (window.SigsoShell && SigsoShell.refrescarArbol) SigsoShell.refrescarArbol();
  }

  function irAVistaProyectos_(id) {
    vistaProyectos_ = id;
    if (id !== 'reportes') reportePyAbierto_ = null;
    if (window.SigsoShell && SigsoShell.publicarItem) SigsoShell.publicarItem(id);
    if (id === 'reportes') renderReportesProyectos_();
    else cargarPortafolio_();
  }

  // --- Centro de reportes ----------------------------------------------------
  var REPORTES_PROYECTOS = [
    { grupo: 'Estado del portafolio', icono: 'escudo', reportes: [
      { id: 'py-salud', nombre: 'Salud del portafolio', tipo: 'ESTADO', estado: 'LISTO',
        desc: 'Cuántos proyectos están normales, en riesgo o críticos, y por qué.',
        fuente: 'listarProyectos', filtros: [] },
      { id: 'py-avance', nombre: 'Avance por proyecto', tipo: 'RANKING', estado: 'LISTO',
        desc: 'Porcentaje de avance de cada proyecto, del más adelantado al más atrasado.',
        fuente: 'listarProyectos', filtros: [] },
      { id: 'py-plazos', nombre: 'Plazos', tipo: 'DETALLE', estado: 'LISTO',
        desc: 'Proyectos con fecha objetivo vencida o próxima a vencer.',
        fuente: 'listarProyectos', filtros: [] }
    ] },
    { grupo: 'Personas', icono: 'persona', reportes: [
      { id: 'py-lider', nombre: 'Carga por líder', tipo: 'RANKING', estado: 'LISTO',
        desc: 'Cuántos proyectos lidera cada persona y cuántos de ellos no están sanos.',
        fuente: 'listarProyectos', filtros: [] },
      // v12.5: deja de estar pendiente -- listarProyectos ahora calcula
      // cumplimiento_tareas por proyecto, con la MISMA regla del motor.
      { id: 'py-cumplimiento', nombre: 'Cumplimiento de tareas', tipo: 'CUMPLIMIENTO', estado: 'LISTO',
        desc: 'Tareas entregadas dentro de su fecha comprometida, proyecto por proyecto.',
        fuente: 'listarProyectos', filtros: [] }
    ] }
  ];

  function registrarReportesProyectos_() {
    if (!window.SigsoReportes || registrarReportesProyectos_.hecho) return;
    SigsoReportes.registrar('proyectos', {
      titulo: 'Reportes del portafolio',
      nota: 'Se arman con los proyectos que ya puedes ver: el filtrado por permisos ' +
        'lo hace el backend, y estos reportes trabajan sobre ese mismo conjunto.',
      grupos: REPORTES_PROYECTOS
    });
    registrarReportesProyectos_.hecho = true;
  }

  function renderReportesProyectos_() {
    var cont = panelProyectos_();
    if (!cont) return;
    registrarReportesProyectos_();
    if (!window.SigsoReportes) {
      cont.innerHTML = Componentes.alerta('El motor de reportes no está disponible.', 'error');
      return;
    }
    // Los reportes usan el mismo listado del portafolio. Si todavía no se
    // cargó (se entró directo por URL a Reportes), se pide ahora.
    if (!portafolioCargado_) {
      cont.innerHTML = Componentes.cargando('Cargando proyectos...');
      api_('listarProyectos', {}).then(function (r) {
        if (!r || !r.ok) {
          cont.innerHTML = Componentes.alerta((r && r.message) || 'No se pudo cargar el portafolio.', 'error');
          return;
        }
        proyectosPortafolioSinFiltrarSalud_ = r.data || [];
        portafolioCargado_ = true;
        renderReportesProyectos_();
      }).catch(function () {
        cont.innerHTML = Componentes.alerta('No se pudo conectar.', 'error');
      });
      return;
    }
    if (reportePyAbierto_) { pintarReporteProyectos_(cont); return; }
    SigsoReportes.pintarCatalogo({
      contenedor: cont,
      modulo: 'proyectos',
      onAbrir: function (id) { reportePyAbierto_ = id; renderReportesProyectos_(); },
      onIrASeccion: function (vista) { irAVistaProyectos_(vista); }
    });
  }

  function pintarReporteProyectos_(cont) {
    var r = SigsoReportes.buscarReporte('proyectos', reportePyAbierto_);
    if (!r) { reportePyAbierto_ = null; renderReportesProyectos_(); return; }
    var ps = proyectosPortafolioSinFiltrarSalud_ || [];
    var cuerpo = '';
    if (r.id === 'py-salud') cuerpo = cuerpoSaludPortafolio_(ps);
    else if (r.id === 'py-avance') cuerpo = cuerpoAvance_(ps);
    else if (r.id === 'py-plazos') cuerpo = cuerpoPlazos_(ps);
    else if (r.id === 'py-lider') cuerpo = cuerpoPorLider_(ps);
    else if (r.id === 'py-cumplimiento') cuerpo = cuerpoCumplimientoTareas_(ps);

    cont.innerHTML =
      SigsoReportes.barraAcciones({}) +
      '<h2>' + Componentes.escaparHtml(r.nombre) + '</h2>' +
      '<p class="sigso-ayuda">' + Componentes.escaparHtml(r.desc) + '</p>' +
      cuerpo;

    SigsoReportes.wireAcciones(cont, {
      nombreArchivo: 'sigso-proyectos-' + r.id,
      onVolver: function () { reportePyAbierto_ = null; renderReportesProyectos_(); }
    });
  }

  function cuerpoSaludPortafolio_(ps) {
    if (!ps.length) return Componentes.vacio('No hay proyectos que mostrar.');
    var porSalud = { normal: 0, riesgo: 0, critico: 0 };
    ps.forEach(function (p) { if (porSalud[p.salud] !== undefined) porSalud[p.salud]++; });
    return SigsoReportes.kpis([
      { etiqueta: 'Proyectos', valor: ps.length },
      { etiqueta: 'Normales', valor: porSalud.normal },
      { etiqueta: 'En riesgo', valor: porSalud.riesgo, alerta: porSalud.riesgo > 0 },
      { etiqueta: 'Críticos', valor: porSalud.critico, alerta: porSalud.critico > 0 }
    ]) +
    '<h3>Los que no están sanos</h3>' +
    SigsoReportes.tabla([
      { campo: 'codigo', titulo: 'Código' },
      { campo: 'nombre', titulo: 'Proyecto' },
      { campo: 'salud_etiqueta', titulo: 'Salud' },
      { campo: 'motivos', titulo: 'Por qué' }
    ], ps.filter(function (p) { return p.salud !== 'normal'; }).map(function (p) {
      return {
        codigo: p.codigo, nombre: p.nombre, salud_etiqueta: p.salud_etiqueta,
        motivos: (p.salud_motivos || []).join(' · ')
      };
    }), { vacio: 'Todos los proyectos están sanos.' });
  }

  function cuerpoAvance_(ps) {
    if (!ps.length) return Componentes.vacio('No hay proyectos que mostrar.');
    var ordenados = ps.slice().sort(function (a, b) { return (b.avance_pct || 0) - (a.avance_pct || 0); });
    return SigsoReportes.ranking(ordenados.map(function (p) {
      return { etiqueta: p.codigo + ' — ' + p.nombre, valor: p.avance_pct || 0, texto: (p.avance_pct || 0) + '%' };
    })) +
    '<h3>Detalle</h3>' +
    SigsoReportes.tabla([
      { campo: 'codigo', titulo: 'Código' },
      { campo: 'nombre', titulo: 'Proyecto' },
      { campo: 'estado', titulo: 'Estado' },
      { campo: 'avance', titulo: 'Avance', alinear: 'derecha' },
      { campo: 'total_tareas', titulo: 'Tareas', alinear: 'derecha' }
    ], ordenados.map(function (p) {
      return {
        codigo: p.codigo, nombre: p.nombre,
        estado: ESTADO_PROYECTO_ETIQUETA[p.estado] || p.estado,
        avance: (p.avance_pct || 0) + '%', total_tareas: p.total_tareas
      };
    }));
  }

  function cuerpoPlazos_(ps) {
    var hoy = new Date();
    var en30 = new Date(hoy.getTime() + 30 * 86400000);
    // Sólo proyectos VIVOS: uno cerrado con fecha pasada no es un atraso.
    var vivos = ps.filter(function (p) {
      return p.estado !== 'CERRADO' && p.estado !== 'CANCELADO' && p.fecha_objetivo;
    });
    var conPlazo = vivos.map(function (p) {
      var f = new Date(p.fecha_objetivo);
      var dias = Math.round((f - hoy) / 86400000);
      return {
        codigo: p.codigo, nombre: p.nombre,
        estado: ESTADO_PROYECTO_ETIQUETA[p.estado] || p.estado,
        fecha_objetivo: p.fecha_objetivo,
        situacion: isNaN(f.getTime()) ? 'fecha inválida'
          : (dias < 0 ? 'vencido hace ' + Math.abs(dias) + ' días'
            : (f <= en30 ? 'vence en ' + dias + ' días' : 'a tiempo')),
        dias: isNaN(f.getTime()) ? 9999 : dias
      };
    }).sort(function (a, b) { return a.dias - b.dias; });

    var vencidos = conPlazo.filter(function (p) { return p.dias < 0; });
    var porVencer = conPlazo.filter(function (p) { return p.dias >= 0 && p.dias <= 30; });

    return SigsoReportes.kpis([
      { etiqueta: 'Con fecha objetivo', valor: conPlazo.length },
      { etiqueta: 'Vencidos', valor: vencidos.length, alerta: vencidos.length > 0 },
      { etiqueta: 'Vencen en 30 días', valor: porVencer.length, alerta: porVencer.length > 0 },
      { etiqueta: 'Sin fecha objetivo', valor: ps.length - vivos.length,
        titulo: 'Incluye los cerrados y cancelados, que no cuentan como atraso.' }
    ]) +
    SigsoReportes.tabla([
      { campo: 'codigo', titulo: 'Código' },
      { campo: 'nombre', titulo: 'Proyecto' },
      { campo: 'estado', titulo: 'Estado' },
      { campo: 'fecha_objetivo', titulo: 'Fecha objetivo' },
      { campo: 'situacion', titulo: 'Situación' }
    ], conPlazo, { vacio: 'Ningún proyecto activo tiene fecha objetivo definida.' });
  }

  // El cumplimiento lo calcula el BACKEND (calcularCumplimientoTareasProyecto_)
  // con la misma regla del motor: solo sobre tareas ENTREGADAS que tenian
  // fecha de compromiso. pct null = no hay entregas medibles, que NO es 0%.
  function cuerpoCumplimientoTareas_(ps) {
    if (!ps.length) return Componentes.vacio('No hay proyectos que mostrar.');
    var conDato = ps.filter(function (p) { return p.cumplimiento_tareas; });
    if (!conDato.length) {
      return Componentes.vacio(
        'El backend todavia no envia el cumplimiento por proyecto. Si acabas de ' +
        'pegar la version nueva de Proyectos.gs, vuelve a publicar la implementacion.');
    }
    var medibles = conDato.filter(function (p) { return p.cumplimiento_tareas.pct !== null; });
    var ordenados = medibles.slice().sort(function (a, b) {
      return b.cumplimiento_tareas.pct - a.cumplimiento_tareas.pct;
    });
    return SigsoReportes.kpis([
      { etiqueta: 'Proyectos', valor: conDato.length },
      { etiqueta: 'Ya medibles', valor: medibles.length,
        titulo: 'Solo se puede medir donde hay tareas entregadas con fecha de compromiso.' },
      { etiqueta: 'Tareas sin comprometer',
        valor: conDato.reduce(function (s, p) { return s + p.cumplimiento_tareas.sin_comprometer; }, 0) }
    ]) +
    SigsoReportes.ranking(ordenados.map(function (p) {
      return { etiqueta: p.codigo + ' — ' + p.nombre, valor: p.cumplimiento_tareas.pct,
        texto: p.cumplimiento_tareas.pct + '%' };
    }), { vacio: 'Ningun proyecto tiene todavia tareas entregadas con fecha de compromiso.' }) +
    '<h3>Detalle</h3>' +
    SigsoReportes.tabla([
      { campo: 'codigo', titulo: 'Código' },
      { campo: 'nombre', titulo: 'Proyecto' },
      { campo: 'total', titulo: 'Tareas', alinear: 'derecha' },
      { campo: 'entregadas', titulo: 'Entregadas', alinear: 'derecha' },
      { campo: 'aTiempo', titulo: 'A tiempo', alinear: 'derecha' },
      { campo: 'pct', titulo: 'Cumplimiento', alinear: 'derecha' }
    ], conDato.map(function (p) {
      var c = p.cumplimiento_tareas;
      return { codigo: p.codigo, nombre: p.nombre, total: c.total,
        entregadas: c.entregadas, aTiempo: c.a_tiempo,
        pct: c.pct === null ? 'sin entregas' : c.pct + '%' };
    }));
  }
  function cuerpoPorLider_(ps) {
    if (!ps.length) return Componentes.vacio('No hay proyectos que mostrar.');
    var porLider = {};
    ps.forEach(function (p) {
      var k = p.lider_email || '(sin líder)';
      if (!porLider[k]) porLider[k] = { total: 0, noSanos: 0 };
      porLider[k].total++;
      if (p.salud !== 'normal') porLider[k].noSanos++;
    });
    var filas = Object.keys(porLider).map(function (k) {
      return { etiqueta: k, total: porLider[k].total, noSanos: porLider[k].noSanos };
    }).sort(function (a, b) { return b.total - a.total; });
    return SigsoReportes.kpis([
      { etiqueta: 'Líderes', valor: filas.length },
      { etiqueta: 'Proyectos', valor: ps.length }
    ]) +
    SigsoReportes.ranking(filas.map(function (f) {
      return { etiqueta: f.etiqueta, valor: f.total, texto: f.total };
    })) +
    '<h3>Detalle</h3>' +
    SigsoReportes.tabla([
      { campo: 'etiqueta', titulo: 'Líder' },
      { campo: 'total', titulo: 'Proyectos', alinear: 'derecha' },
      { campo: 'noSanos', titulo: 'En riesgo o críticos', alinear: 'derecha' }
    ], filas);
  }

})();
