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
    },
    // v10 (Fase D, "Solicitud -> Proyecto"): detalle.js llama esto desde el
    // boton "Convertir en proyecto" -- abre el MISMO modal de "Nuevo
    // proyecto", prellenado, en vez de duplicarlo en dos archivos.
    abrirFormularioDesdeSolicitud: function (prellenado) { abrirFormularioProyecto_(prellenado); }
  };

  function urlBackoffice_() {
    return (window.SIGSO_CONFIG || {}).BACKOFFICE_URL;
  }
  function api_(accion, datos) {
    return llamarApi(urlBackoffice_(), accion, datos || {});
  }

  // v10 (auditoría G, 2026-08-29): una llamada AUXILIAR que falla (timeout,
  // red, o una acción que aún no está desplegada en el backend) NO debe
  // tumbar toda la pantalla. Devuelve {ok:false} en vez de rechazar, para
  // que un Promise.all nunca se caiga entero por una pieza secundaria -- la
  // pieza ESENCIAL (getDetalle) se sigue validando por su propio .ok. Este
  // era el bug de "No se pudo conectar para abrir el proyecto": bastaba con
  // que UNA de las 6 llamadas paralelas fallara para perder todo el detalle.
  function apiSeguro_(accion, datos) {
    return api_(accion, datos).catch(function (err) {
      return { ok: false, message: (err && err.message) || 'No se pudo conectar.' };
    });
  }

  var SALUD_ETIQUETA = { normal: 'Normal', riesgo: 'En riesgo', critico: 'Crítico' };
  // v14.0 (piel nueva): salud -> tono del punto de estado (Componentes.punto).
  var SALUD_TONO = { normal: 'ok', riesgo: 'riesgo', critico: 'critico' };
  // v11 (P1, "score de salud ponderado"): el número que acompaña al pill de
  // siempre -- null en salud_override (correccion manual, no aporta fingir
  // precisión numérica).
  function saludScoreHtml_(score) {
    return (score === null || score === undefined) ? '' : '<span class="sigso-py-salud-score">· ' + score + '/100</span>';
  }
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
    ENTREGABLE: 'Entregable', RIESGO: 'Riesgo',
    // v10 (Fase D, "adjuntos por proyecto"): un archivo subido es un evento
    // mas de la Sala (Proyectos.subirAdjunto).
    ARCHIVO: 'Archivo',
    // v11 (P1, "congelar línea base"): un evento más del feed de siempre,
    // igual que ENTREGABLE/RIESGO/ARCHIVO -- lo registra el sistema al
    // congelar (Proyectos.congelarBaseline).
    BASELINE: 'Línea base'
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
  // v13 (Fase 5, "riesgo vs. problema"): MATERIALIZADO = el riesgo dejó de
  // ser hipotético, ya está ocurriendo (§17 del encargo). Mismo enum, sin
  // entidad nueva.
  var RIESGO_ESTADO_ETIQUETA = { ABIERTO: 'Abierto', EN_MITIGACION: 'En mitigación', CERRADO: 'Cerrado', MATERIALIZADO: 'Problema' };

  var proyectoActivoId_ = null;
  var pestanaActiva_ = 'resumen';

  // v10 (Fase A, "check-in inline"): para saber si LA TAREA que se esta
  // pintando es del usuario que mira (y ahi si ofrecerle los mismos botones
  // de check-in de "Mi trabajo"), hace falta su propio correo. getMiPerfil
  // no tiene gate de modulo (Code.gs) -- se puede pedir desde cualquier
  // pantalla. Se pide UNA vez por carga de pagina y se cachea la PROMESA
  // (no solo el resultado): si dos llamadas caen antes de que responda la
  // primera, comparten el mismo pedido en vez de duplicarlo.
  var miPerfilPromise_ = null;
  function miPerfil_() {
    if (!miPerfilPromise_) {
      miPerfilPromise_ = api_('getMiPerfil', {}).then(function (r) {
        return (r && r.ok) ? r.data : null;
      }).catch(function () { return null; });
    }
    return miPerfilPromise_;
  }

  // Espejo liviano de normalizarEmailProyecto_ (Proyectos.gs) -- necesario
  // aca solo para mapear menciones a nombres al pintar el feed; el backend
  // sigue siendo la autoridad para permisos/comparaciones.
  function normalizarEmail_(email) { return String(email || '').trim().toLowerCase(); }

  // v10 (Fase D): mismo patron de siempre (novedades.js/detalle.js) para
  // bajar un binario que llega en base64 -- sin este paso no hay forma de
  // convertir lo que devuelve fetch/google.script.run en un archivo real.
  function descargarBase64Proyecto_(base64, nombre, mime) {
    var bytes = atob(base64);
    var buffer = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i);
    var blob = new Blob([buffer], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nombre || 'adjunto';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  // v11 (P3, "exportación CSV"): 100% cliente -- los datos ya están cargados
  // (analítica/tareas), así que no hace falta un viaje al servidor solo para
  // armar el archivo. BOM UTF-8 al inicio para que Excel abra los acentos
  // bien (sin el BOM, Excel a veces asume Latin-1 y los rompe). CSV, no
  // XLSX: un binario .xlsx de verdad necesitaría o bien un permiso de Drive
  // nuevo (crear una Hoja temporal y exportarla) o construir el ZIP/XML de
  // Office a mano -- ninguno de los dos aporta control real sobre lo que ya
  // resuelve un CSV, que Excel y Sheets abren igual de bien.
  function descargarCsv_(nombreArchivo, filas) {
    var csv = filas.map(function (fila) {
      return fila.map(function (v) {
        var s = (v === null || v === undefined) ? '' : String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

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
    fijarAnchoCarta_(false); // el portafolio vuelve al ancho normal
    var cont = panelProyectos_();
    if (!cont) return;
    cont.innerHTML = esqueletoPortafolio_();
    var filtros = filtroEstadoPortafolio_ ? { estado: filtroEstadoPortafolio_ } : {};
    // v10 (auditoría G): el resumen ejecutivo es secundario -- si falla, el
    // portafolio (lo esencial) igual se ve. apiSeguro_ evita que un fallo del
    // resumen tumbe toda la lista de proyectos.
    Promise.all([
      apiSeguro_('listarProyectos', filtros),
      apiSeguro_('getResumenPortafolioProyectos', {})
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
    });
  }

  // v11 (P3, "workload cruzado multi-proyecto"): pantalla dedicada (mismo
  // patrón que abrir un proyecto: reemplaza el contenido del panel, con su
  // propio "← Portafolio" para volver) -- reusa TAL CUAL
  // pintarWorkloadProyecto_ (P2), que ya soporta detalle=null (igual que
  // "Mi dedicación" para la vista Dedicación).
  var workloadPortafolioCache_ = null;
  function cargarWorkloadPortafolio_() {
    proyectoActivoId_ = null;
    datosDetalleActual_ = null;
    var cont = panelProyectos_();
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando carga de trabajo...');
    apiSeguro_('obtenerWorkloadPortafolioProyectos', {}).then(function (r) {
      if (!r || !r.ok) {
        cont.innerHTML = Componentes.alerta((r && r.message) || 'No se pudo cargar la carga de trabajo.', 'error');
        return;
      }
      workloadPortafolioCache_ = r.data;
      pintarWorkloadPortafolioPantalla_(cont);
    });
  }

  function pintarWorkloadPortafolioPantalla_(cont) {
    var datos = workloadPortafolioCache_ || { proyectos: [], tareas: [], bitacora: [] };
    // v11 ("mejoras visuales del módulo"): "← Portafolio" en su propia línea
    // de migaja de pan -- no compite en peso visual con el título, mismo
    // criterio que la cabecera de un proyecto (pintarDetalle_).
    var cabecera = '<div class="sigso-py-migaja">' +
        Componentes.boton({ texto: '← Portafolio', variante: 'sutil', clase: 'js-py-volver' }) +
      '</div>' +
      '<div class="sigso-py-detalle-cab"><h1>Carga de trabajo del portafolio</h1></div>' +
      '<p class="sigso-ayuda">Horas por persona, cruzando ' + datos.proyectos.length + ' proyecto(s) visibles para ti.</p>';
    var cuerpo = pintarWorkloadProyecto_(null, datos.tareas, datos.bitacora);
    cont.innerHTML = cabecera + '<div class="sigso-py-cuerpo">' + cuerpo + '</div>';
    cont.querySelector('.js-py-volver').addEventListener('click', cargarPortafolio_);
    wireCartaControles_(cont, function () { pintarWorkloadPortafolioPantalla_(cont); }, null);
  }

  // KPIs agregados (activos/críticos/en riesgo, próximos a cerrar, sin
  // actualizar) + carga por persona ponderada por tamaño (S=1,M=2,L=3,XL=5
  // -- ver Proyectos.getResumenPortafolio). "Muchos L/XL" es sobrecarga
  // real; un conteo plano de tareas no lo distingue (§L.3 de la propuesta).
  function pintarResumenEjecutivo_(resumen) {
    if (!resumen || !resumen.total_proyectos) return '';
    var kpis = [
      Componentes.kpi({ etiqueta: 'Proyectos activos', valor: resumen.total_proyectos }),
      Componentes.kpi({ etiqueta: 'Críticos', valor: (resumen.por_salud && resumen.por_salud.critico) || 0, alerta: true }),
      Componentes.kpi({ etiqueta: 'En riesgo', valor: (resumen.por_salud && resumen.por_salud.riesgo) || 0 }),
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
          '<div class="sigso-py-carga">' + carga + '</div>' +
          // v11 (P3, "workload cruzado multi-proyecto"): esta barra es una
          // ESTIMACIÓN por tamaño (S/M/L/XL); el link lleva a las horas REALES
          // registradas, cruzando todos los proyectos visibles.
          Componentes.boton({ texto: 'Ver carga de trabajo por horas (todos los proyectos)', variante: 'sutil', clase: 'js-py-ver-workload-portafolio', tipo: 'button' })
        : '') +
    '</details>';
  }

  // v10 (Fase A, propuesta 06 "buscar/ordenar/agrupar"): todo client-side --
  // el portafolio ya llega completo (sin paginación), así que no hay razón
  // para volver a pedírselo al backend por esto. Estado a nivel de módulo,
  // mismo criterio que filtroEstadoPortafolio_/filtroSaludPortafolio_ (arriba):
  // sobrevive un refrescar_() de fondo sin resetearse solo.
  var busquedaPortafolio_ = '';
  var ordenPortafolio_ = 'salud';
  var agruparPorLider_ = false;
  var ORDEN_PORTAFOLIO_ETIQUETA = {
    salud: 'Más urgente primero', fecha_objetivo: 'Vence antes', avance: 'Menos avanzado primero'
  };

  function ordenarProyectosPortafolio_(lista) {
    if (ordenPortafolio_ === 'fecha_objetivo') {
      return lista.slice().sort(function (a, b) { return new Date(a.fecha_objetivo || 0) - new Date(b.fecha_objetivo || 0); });
    }
    if (ordenPortafolio_ === 'avance') {
      return lista.slice().sort(function (a, b) { return (a.avance_pct || 0) - (b.avance_pct || 0); });
    }
    return lista; // 'salud': el backend ya lo entrega así (crítico/riesgo/normal, luego última actualización) -- no hay que reordenar.
  }

  function filtrarPorBusquedaPortafolio_(lista) {
    var q = busquedaPortafolio_.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter(function (p) {
      return (p.nombre || '').toLowerCase().indexOf(q) !== -1 ||
        (p.lider_email || '').toLowerCase().indexOf(q) !== -1;
    });
  }

  // Un proyecto sin líder (no debería pasar, pero un dato viejo podría venir
  // así) cae en su propio grupo en vez de romper el agrupado.
  function agruparProyectosPorLider_(lista) {
    var grupos = {}, orden = [];
    lista.forEach(function (p) {
      var clave = p.lider_email || '(sin líder)';
      if (!grupos[clave]) { grupos[clave] = []; orden.push(clave); }
      grupos[clave].push(p);
    });
    orden.sort(function (a, b) { return a.localeCompare(b); });
    return orden.map(function (clave) { return { lider: clave, proyectos: grupos[clave] }; });
  }

  // "hace 3 días" / "hoy" / "ayer" -- para "última novedad" (p.ultima_actualizacion,
  // ya viene del backend) y en general cualquier fecha PASADA que se quiera
  // leer relativa en vez de como calendario.
  function diasRelativo_(iso) {
    if (!iso) return '';
    var f = new Date(iso);
    if (isNaN(f.getTime())) return '';
    var hoyUTC = Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    var diaUTC = Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate());
    var dias = Math.round((hoyUTC - diaUTC) / 86400000);
    if (dias <= 0) return 'hoy';
    if (dias === 1) return 'ayer';
    return 'hace ' + dias + ' días';
  }

  // "Vence en 5 días" / "Vence hoy" / "Venció hace 2 días" -- misma idea que
  // Componentes.tiempoRelativoSla, pero en DÍAS DE CALENDARIO (fecha_objetivo
  // es una fecha de proyecto, no un SLA en horas hábiles).
  function venceEn_(iso) {
    if (!iso) return '';
    var f = new Date(iso);
    if (isNaN(f.getTime())) return '';
    var hoyUTC = Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    var diaUTC = Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate());
    var dias = Math.round((diaUTC - hoyUTC) / 86400000);
    if (dias === 0) return 'Vence hoy';
    if (dias === 1) return 'Vence mañana';
    if (dias > 1) return 'Vence en ' + dias + ' días';
    if (dias === -1) return 'Venció ayer';
    return 'Venció hace ' + (-dias) + ' días';
  }

  // v10 (Fase A, propuesta "tarjetas con más pulso"): avatares del equipo
  // (p.integrantes ya viene del backend, líder primero), barra de avance con
  // el COLOR de la salud (antes siempre el mismo azul, sin importar si el
  // proyecto estaba crítico) y "última novedad hace N días" -- de un vistazo,
  // sin entrar al proyecto.
  var MAX_AVATARES_TARJETA = 4;
  function tarjetaProyecto_(p) {
    var avance = p.avance_pct === null || p.avance_pct === undefined ? '—' : p.avance_pct + '%';
    var integrantes = p.integrantes || [];
    var avatares = integrantes.slice(0, MAX_AVATARES_TARJETA).map(function (i) {
      return Componentes.avatar(
        { nombre: i.nombre, foto: window.SigsoPerfil ? SigsoPerfil.fotoDe(i.email) : '' },
        { tam: 'sm', clase: 'sigso-py-card__avatar' }
      );
    }).join('');
    var restantes = integrantes.length - MAX_AVATARES_TARJETA;
    var extra = restantes > 0
      ? '<span class="sigso-py-card__avatar sigso-py-card__avatar--extra" title="' + restantes + ' más">+' + restantes + '</span>'
      : '';
    var vence = venceEn_(p.fecha_objetivo);

    return '<button type="button" class="sigso-py-card js-py-abrir" data-id="' + p.proyecto_id + '">' +
      '<div class="sigso-py-card__top">' +
        '<span class="sigso-py-card__nombre">' + Componentes.escaparHtml(p.nombre) + '</span>' +
        '<span class="sigso-py-salud sigso-py-salud--' + p.salud + '">' + Componentes.punto(SALUD_TONO[p.salud]) + SALUD_ETIQUETA[p.salud] + saludScoreHtml_(p.salud_score) + '</span>' +
      '</div>' +
      (p.descripcion ? '<p class="sigso-py-card__desc">' + Componentes.escaparHtml(p.descripcion) + '</p>' : '') +
      '<div class="sigso-py-card__barra"><div class="sigso-py-card__barra-fill sigso-py-card__barra-fill--' + p.salud + '" style="width:' + (p.avance_pct || 0) + '%"></div></div>' +
      '<div class="sigso-py-card__meta">' +
        '<span>Avance <b>' + avance + '</b></span>' +
        '<span>' + Componentes.badge(ESTADO_PROYECTO_ETIQUETA[p.estado] || p.estado, 'neutro') + '</span>' +
        '<span>' + p.total_tareas + ' tarea(s)</span>' +
      '</div>' +
      '<div class="sigso-py-card__pulso">' +
        (avatares ? '<span class="sigso-py-card__avatares">' + avatares + extra + '</span>' : '<span></span>') +
        (vence ? '<span class="sigso-py-card__vence' + (vence.indexOf('Venció') === 0 ? ' sigso-py-card__vence--atrasado' : '') + '">' + vence + '</span>' : '') +
      '</div>' +
      (p.ultima_actualizacion
        ? '<p class="sigso-py-card__novedad">' + Iconos.svg('reloj', { tam: 12 }) + ' Última novedad ' + diasRelativo_(p.ultima_actualizacion) + '</p>'
        : '') +
      (p.salud_motivos && p.salud_motivos.length
        ? '<p class="sigso-py-card__motivos">' + Componentes.escaparHtml(p.salud_motivos.join(' · ')) + '</p>'
        : '') +
    '</button>';
  }

  // v10 (Fase A, "estados de carga con forma"): la MISMA cuadrícula que las
  // tarjetas reales, con barras de esqueleto en vez de spinner -- así el
  // contenido no "salta" cuando llega.
  function esqueletoPortafolio_() {
    var tarjeta = '<div class="sigso-esq__tarjeta" aria-hidden="true">' +
      '<span class="sigso-esq__barra" style="width:60%"></span>' +
      '<span class="sigso-esq__barra" style="width:90%"></span>' +
      '<span class="sigso-esq__barra" style="width:40%"></span>' +
    '</div>';
    var html = '';
    for (var i = 0; i < 6; i++) html += tarjeta;
    return '<div class="sigso-py-grid" aria-busy="true" aria-label="Cargando proyectos">' + html + '</div>';
  }

  // Repinta SOLO la grilla (#py-grid-wrap), sin tocar la barra de
  // filtros/búsqueda -- así escribir en el buscador no destruye el <input>
  // en el que se está escribiendo (perdería el foco en cada tecla).
  function pintarGridPortafolio_() {
    var wrap = document.getElementById('py-grid-wrap');
    if (!wrap) return;

    var hayFiltros = !!(filtroEstadoPortafolio_ || filtroSaludPortafolio_ || busquedaPortafolio_.trim());
    var proyectos = filtroSaludPortafolio_
      ? proyectosPortafolioSinFiltrarSalud_.filter(function (p) { return p.salud === filtroSaludPortafolio_; })
      : proyectosPortafolioSinFiltrarSalud_;
    proyectos = filtrarPorBusquedaPortafolio_(proyectos);
    proyectos = ordenarProyectosPortafolio_(proyectos);

    if (proyectos.length === 0) {
      wrap.innerHTML = Componentes.vacio(hayFiltros
        ? { texto: 'Ningún proyecto coincide con la búsqueda o los filtros.' }
        : { texto: 'Todavía no participas en ningún proyecto.', detalle: 'Crea uno para empezar.' });
      return;
    }

    if (agruparPorLider_) {
      wrap.innerHTML = agruparProyectosPorLider_(proyectos).map(function (g) {
        return '<div class="sigso-py-grupo">' +
          '<h3 class="sigso-py-grupo__titulo">' + Componentes.escaparHtml(g.lider) +
            ' <span class="sigso-py-grupo__cuenta">' + g.proyectos.length + '</span></h3>' +
          '<div class="sigso-py-grid">' + g.proyectos.map(tarjetaProyecto_).join('') + '</div>' +
        '</div>';
      }).join('');
    } else {
      wrap.innerHTML = '<div class="sigso-py-grid">' + proyectos.map(tarjetaProyecto_).join('') + '</div>';
    }

    wrap.querySelectorAll('.js-py-abrir').forEach(function (btn) {
      btn.addEventListener('click', function () { abrirProyecto_(btn.getAttribute('data-id')); });
    });
  }

  // v10: fotos reales del equipo (si existen) en vez de solo iniciales.
  // Fire-and-forget: si el usuario ya entró a un proyecto mientras cargaban,
  // no se repinta el portafolio por encima de otra pantalla.
  function precargarAvataresPortafolio_(proyectos) {
    if (!window.SigsoPerfil) return;
    var correos = [];
    proyectos.forEach(function (p) {
      (p.integrantes || []).slice(0, MAX_AVATARES_TARJETA).forEach(function (i) {
        if (i.email && correos.indexOf(i.email) === -1) correos.push(i.email);
      });
    });
    if (!correos.length) return;
    SigsoPerfil.precargarFotos(correos).then(function () {
      if (!proyectoActivoId_) pintarGridPortafolio_();
    });
  }

  var TEMPORIZADOR_BUSQUEDA_PORTAFOLIO_MS = 200;

  function pintarPortafolio_(cont, proyectosSinFiltrarSalud) {
    var hayFiltros = !!(filtroEstadoPortafolio_ || filtroSaludPortafolio_);
    var cabeceraBase = '<div class="sigso-py-cabecera">' +
      '<p class="sigso-ayuda">Portafolio de proyectos internos: quién lidera cada uno, en qué estado está y qué necesita atención.</p>' +
      Componentes.boton({ texto: '+ Nuevo proyecto', clase: 'js-py-nuevo' }) +
      '</div>' + pintarResumenEjecutivo_(resumenPortafolioActual_);

    if (proyectosSinFiltrarSalud.length === 0 && !filtroEstadoPortafolio_) {
      // Portafolio de verdad vacío (nadie ha creado nada aún): ni siquiera
      // vale la pena mostrar la barra de búsqueda.
      cont.innerHTML = cabeceraBase +
        Componentes.vacio({ texto: 'Todavía no participas en ningún proyecto.', detalle: 'Crea uno para empezar.' });
      cont.querySelector('.js-py-nuevo').addEventListener('click', abrirFormularioProyecto_);
      wireVerWorkloadPortafolio_(cont);
      return;
    }

    var filtrosBar = '<div class="sigso-py-filtros">' +
      Componentes.campoTexto({
        id: 'py-buscar', label: false, tipo: 'search', valor: busquedaPortafolio_,
        placeholder: 'Buscar por nombre o líder...', claseCampo: 'sigso-py-filtros__buscar'
      }) +
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
      Componentes.campoSelect({
        id: 'py-orden', label: false, valor: ordenPortafolio_, placeholder: false,
        opciones: Object.keys(ORDEN_PORTAFOLIO_ETIQUETA).map(function (o) { return { valor: o, texto: ORDEN_PORTAFOLIO_ETIQUETA[o] }; })
      }) +
      '<label class="sigso-py-agrupar"><input type="checkbox" id="py-agrupar"' + (agruparPorLider_ ? ' checked' : '') + '> Agrupar por líder</label>' +
      (hayFiltros ? Componentes.boton({ texto: 'Limpiar filtros', variante: 'sutil', clase: 'js-py-limpiar-filtros', tipo: 'button' }) : '') +
      '</div>';

    cont.innerHTML = cabeceraBase + filtrosBar + '<div id="py-grid-wrap"></div>';

    cont.querySelector('.js-py-nuevo').addEventListener('click', abrirFormularioProyecto_);
    cont.querySelector('#py-filtro-estado').addEventListener('change', function () {
      filtroEstadoPortafolio_ = this.value;
      cargarPortafolio_();
    });
    cont.querySelector('#py-filtro-salud').addEventListener('change', function () {
      filtroSaludPortafolio_ = this.value;
      pintarGridPortafolio_();
    });
    cont.querySelector('#py-orden').addEventListener('change', function () {
      ordenPortafolio_ = this.value;
      pintarGridPortafolio_();
    });
    cont.querySelector('#py-agrupar').addEventListener('change', function () {
      agruparPorLider_ = this.checked;
      pintarGridPortafolio_();
    });
    var limpiar = cont.querySelector('.js-py-limpiar-filtros');
    if (limpiar) limpiar.addEventListener('click', function () {
      filtroEstadoPortafolio_ = ''; filtroSaludPortafolio_ = ''; busquedaPortafolio_ = '';
      cargarPortafolio_();
    });

    var temporizadorBusqueda_ = null;
    cont.querySelector('#py-buscar').addEventListener('input', function () {
      var valor = this.value;
      if (temporizadorBusqueda_) clearTimeout(temporizadorBusqueda_);
      temporizadorBusqueda_ = setTimeout(function () {
        busquedaPortafolio_ = valor;
        pintarGridPortafolio_();
      }, TEMPORIZADOR_BUSQUEDA_PORTAFOLIO_MS);
    });

    pintarGridPortafolio_();
    precargarAvataresPortafolio_(proyectosSinFiltrarSalud);
    wireVerWorkloadPortafolio_(cont);
  }

  function wireVerWorkloadPortafolio_(cont) {
    var btn = cont.querySelector('.js-py-ver-workload-portafolio');
    if (btn) btn.addEventListener('click', cargarWorkloadPortafolio_);
  }

  // --- crear proyecto --------------------------------------------------

  // v10 (Fase D, propuesta 10 "Solicitud -> Proyecto"): `prellenado` es
  // opcional -- detalle.js (otro archivo, otro modulo) lo usa via
  // window.SigsoProyectos.abrirFormularioDesdeSolicitud para abrir ESTE
  // MISMO formulario con nombre/descripcion ya completados y el
  // solicitud_id enganchado, en vez de duplicar el modal en dos archivos.
  function abrirFormularioProyecto_(prellenado) {
    prellenado = prellenado || {};
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Nuevo proyecto</h3>' +
        '<form id="form-py-nuevo">' +
          Componentes.campoTexto({ id: 'py-nombre', label: 'Nombre', requerido: true, placeholder: 'Ej: Migración ERP', valor: prellenado.nombre || '' }) +
          '<div id="py-plantilla-wrap"></div>' +
          Componentes.campoTextarea({ id: 'py-descripcion', label: 'Descripción breve', valor: prellenado.descripcion || '' }) +
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

    // v10 (Fase C, propuesta 07): el selector de plantilla es progresivo --
    // no vale la pena retrasar la apertura del modal (una accion muy comun)
    // por un pedido que la mayoria de las veces va a estar vacio o no se va
    // a usar. Si no hay ninguna plantilla activa, el modal se queda tal
    // como estaba (sin el campo).
    api_('listarPlantillasProyecto', {}).then(function (r) {
      var wrap = document.getElementById('py-plantilla-wrap');
      if (!wrap || !r || !r.ok || !r.data || !r.data.length) return;
      wrap.innerHTML = Componentes.campoSelect({
        id: 'py-plantilla', label: 'Crear desde una plantilla (opcional)', valor: '', placeholder: 'Empezar desde cero',
        opciones: r.data.map(function (p) { return { valor: p.plantilla_id, texto: p.nombre + ' (' + p.total_hitos + ' hito(s))' }; })
      });
    });

    document.getElementById('form-py-nuevo').addEventListener('submit', function (evento) {
      var campoPlantilla = document.getElementById('py-plantilla');
      enviarModal_(evento, 'crearProyecto', {
        nombre: document.getElementById('py-nombre').value,
        descripcion: document.getElementById('py-descripcion').value,
        objetivo: document.getElementById('py-objetivo').value,
        fecha_inicio: document.getElementById('py-fecha-inicio').value,
        fecha_objetivo: document.getElementById('py-fecha-objetivo').value,
        prioridad: document.getElementById('py-prioridad').value,
        plantilla_id: campoPlantilla ? campoPlantilla.value : '',
        solicitud_id: prellenado.solicitud_id || ''
      }, function () { cerrar(); cargarPortafolio_(); });
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
    // La sub-vista del Cronograma tambien vuelve a su inicio. Sin esto
    // sobrevivia al cambio de proyecto mientras sus datos NO: abrir otro
    // proyecto con la vista en 'analitica' dejaba un spinner permanente,
    // porque nadie pedia una analitica que ya se creia en curso.
    vistaCronograma_ = 'dedicacion';
    datosDetalleActual_ = null;
    refrescarDetalle_();
  }

  // Cambia de pestana SIN red: repinta con lo que ya se cargo. Si por algun
  // motivo no hay nada en cache todavia (carga interrumpida), cae a pedirlo.
  function cambiarPestana_(id) {
    pestanaActiva_ = id;
    var cont = panelProyectos_();
    if (!cont || !datosDetalleActual_) { refrescarDetalle_(); return; }
    // v10 (auditoría G): el Cronograma carga su data pesada (bitácora +
    // rendimiento) de forma perezosa la primera vez -- las demás pestañas
    // repintan desde cache al instante. v13 (Fase 5): Reuniones/Decisiones
    // siguen el mismo criterio (join con acuerdos / hoja propia, no vale la
    // pena pedirlos si nunca se abre la pestaña).
    if (id === 'cronograma') { cargarDatosCronograma_(cont); }
    else if (id === 'reuniones') { cargarReuniones_(cont); }
    else if (id === 'decisiones') { cargarDecisiones_(cont); }
    else { pintarDetalle_(cont, datosDetalleActual_.detalle, datosDetalleActual_.tareas, datosDetalleActual_.sala, datosDetalleActual_.miEmail, datosDetalleActual_.bitacora, datosDetalleActual_.rendimiento); }
    // v10 (Fase D, propuesta 09): marca "vi la Sala" a ahora -- de fondo, sin
    // bloquear el repintado ni volver a pedir el detalle. El resumen que se
    // acaba de mostrar usa la marca de tiempo ANTERIOR (ya estaba en cache);
    // esta solo prepara la PROXIMA visita.
    if (id === 'sala' && proyectoActivoId_) {
      api_('marcarSalaVisitadaProyecto', { proyecto_id: proyectoActivoId_ }).catch(function () { /* best-effort */ });
    }
  }

  // v12.4 ("nada de recargar la página ante un cambio"): refrescar el detalle
  // tiene DOS modos:
  //  - PRIMERA apertura (no hay datosDetalleActual_): se muestra "Cargando
  //    proyecto..." y se arma la pantalla desde cero -- es la única vez que un
  //    wipe tiene sentido (no hay nada que preservar).
  //  - REFRESCO tras un cambio (ya hay detalle en pantalla -- reprogramar,
  //    editar, cerrar, arrastrar el Gantt, etc.): NO se borra el panel. Se
  //    re-piden los datos EN SEGUNDO PLANO (incluida bitácora+rendimiento si
  //    estamos en el Cronograma, para no dejarlos en "Cargando cronograma...")
  //    y recién cuando llegan TODOS se repinta una sola vez, preservando el
  //    scroll de la carta. El usuario ve su vista intacta mientras tanto: el
  //    cambio aparece sin parpadeo ni "recarga".
  function refrescarDetalle_() {
    var cont = panelProyectos_();
    if (!cont || !proyectoActivoId_) return;
    var suave = !!datosDetalleActual_;         // ya hay detalle en pantalla -> refresco sin wipe
    var enCron = pestanaActiva_ === 'cronograma';
    var previo = suave ? cont.querySelector('.sigso-py-ded-scroll') : null;
    var sx = previo ? previo.scrollLeft : 0, sy = previo ? previo.scrollTop : 0;
    if (!suave) cont.innerHTML = Componentes.cargando('Cargando proyecto...');
    // v10 (auditoría G): guarda contra carreras -- si el usuario cambia de
    // proyecto (o vuelve al portafolio) antes de que responda, la respuesta
    // vieja no debe pisar la pantalla nueva.
    var idAlPedir = proyectoActivoId_;

    // v10 (auditoría G): detalle + tareas + sala en UNA sola llamada
    // (getDetalleCompletoProyecto). En modo SUAVE, si la pestaña activa tiene
    // datos propios "lazy" (Cronograma: bitácora+rendimiento; v13 Fase 5:
    // Reuniones/Decisiones), se piden en el MISMO lote para repintar una
    // sola vez con todo fresco (y no caer en su "Cargando..." de siempre).
    var extras = [];
    if (suave && enCron) {
      extras.push(['bitacora', 'listarBitacoraProyecto'], ['rendimiento', 'obtenerRendimientoProyecto']);
    } else if (suave && pestanaActiva_ === 'reuniones') {
      extras.push(['reuniones', 'listarReunionesProyecto']);
    } else if (suave && pestanaActiva_ === 'decisiones') {
      extras.push(['decisiones', 'listarDecisionesProyecto']);
    }
    var peticiones = [
      apiSeguro_('getDetalleCompletoProyecto', { proyecto_id: proyectoActivoId_ }),
      miPerfil_()
    ].concat(extras.map(function (e) { return apiSeguro_(e[1], { proyecto_id: proyectoActivoId_ }); }));

    Promise.all(peticiones).then(function (respuestas) {
      if (idAlPedir !== proyectoActivoId_) return; // el usuario ya se movió
      var perfil = respuestas[1];
      var miEmail = normalizarEmail_(perfil && perfil.email);
      // Degradación elegante: si el backend nuevo todavía no está desplegado,
      // getDetalleCompletoProyecto vuelve {ok:false} (acción desconocida) --
      // se cae al camino viejo de 3 llamadas para no romper nada en la
      // ventana entre publicar el frontend y pegar el backend.
      var r = respuestas[0];
      if (r && r.ok && r.data && r.data.detalle) {
        if (suave) {
          datosDetalleActual_ = {
            detalle: r.data.detalle, tareas: r.data.tareas || [], sala: r.data.sala || [],
            bitacora: undefined, rendimiento: undefined, reuniones: undefined, decisiones: undefined,
            miEmail: miEmail
          };
          extras.forEach(function (e, i) {
            var resp = respuestas[2 + i];
            datosDetalleActual_[e[0]] = (resp && resp.ok) ? resp.data : (e[0] === 'rendimiento' ? null : []);
          });
          fijarAnchoCarta_(enCron);
          pintarDetalle_(cont, datosDetalleActual_.detalle, datosDetalleActual_.tareas, datosDetalleActual_.sala,
            miEmail, datosDetalleActual_.bitacora, datosDetalleActual_.rendimiento);
          var nuevo = cont.querySelector('.sigso-py-ded-scroll');
          if (nuevo) { nuevo.scrollLeft = sx; nuevo.scrollTop = sy; }
        } else {
          pintarDetalleCargado_(cont, r.data.detalle, r.data.tareas || [], r.data.sala || [], miEmail);
        }
      } else if (r && r.ok === false && /desconocida/i.test(r.message || '')) {
        if (suave) { datosDetalleActual_ = null; cont.innerHTML = Componentes.cargando('Cargando proyecto...'); }
        refrescarDetalleLegacy_(cont, idAlPedir, miEmail);
      } else if (!suave) {
        cont.innerHTML = Componentes.alerta((r && r.message) || 'No se pudo abrir el proyecto.', 'error');
      } else {
        // Modo suave y falló: se deja la vista actual intacta y se avisa (no
        // se rompe la pantalla que el usuario estaba mirando).
        Componentes.aviso({ texto: (r && r.message) || 'No se pudo actualizar el proyecto.', tipo: 'error' });
      }
    });
    // Sin .catch: apiSeguro_ y miPerfil_ nunca rechazan.
  }

  // Camino de compatibilidad (backend viejo, sin getDetalleCompletoProyecto):
  // las 3 llamadas de siempre, ya resilientes con apiSeguro_.
  function refrescarDetalleLegacy_(cont, idAlPedir, miEmail) {
    Promise.all([
      apiSeguro_('getDetalleProyecto', { proyecto_id: proyectoActivoId_ }),
      apiSeguro_('listarTareasProyecto', { proyecto_id: proyectoActivoId_ }),
      apiSeguro_('listarSalaProyecto', { proyecto_id: proyectoActivoId_ })
    ]).then(function (respuestas) {
      if (idAlPedir !== proyectoActivoId_) return;
      var rDetalle = respuestas[0], rTareas = respuestas[1], rSala = respuestas[2];
      if (!rDetalle || !rDetalle.ok) {
        cont.innerHTML = Componentes.alerta((rDetalle && rDetalle.message) || 'No se pudo abrir el proyecto.', 'error');
        return;
      }
      pintarDetalleCargado_(cont, rDetalle.data, (rTareas && rTareas.ok) ? rTareas.data : [], (rSala && rSala.ok) ? rSala.data : [], miEmail);
    });
  }

  // Guarda el detalle en cache y lo pinta -- punto único, para que el camino
  // consolidado y el legacy hagan exactamente lo mismo.
  function pintarDetalleCargado_(cont, detalle, tareas, sala, miEmail) {
    // bitacora/rendimiento = undefined => "aún no cargados" (los trae
    // cargarDatosCronograma_ la primera vez que se abre el Cronograma).
    datosDetalleActual_ = { detalle: detalle, tareas: tareas, sala: sala, bitacora: undefined, rendimiento: undefined, miEmail: miEmail };
    pintarDetalle_(cont, detalle, tareas, sala, miEmail, undefined, undefined);
    if (pestanaActiva_ === 'cronograma') cargarDatosCronograma_(cont);
    else if (pestanaActiva_ === 'reuniones') cargarReuniones_(cont);
    else if (pestanaActiva_ === 'decisiones') cargarDecisiones_(cont);
  }

  // v10 (auditoría G): carga perezosa de la bitácora + el rendimiento (lo
  // caro), solo cuando de verdad se abre el Cronograma. Si ya se cargaron en
  // esta apertura del proyecto, repinta desde cache sin red.
  function cargarDatosCronograma_(cont) {
    if (!datosDetalleActual_) return;
    // Red de seguridad del spinner eterno: si se entra a la pestaña con la
    // sub-vista ya en 'analitica', hay que pedirla aqui -- el manejador del
    // cambio de sub-vista no se dispara porque la vista no cambio.
    if (vistaCronograma_ === 'analitica') pedirAnaliticaProyecto_();
    if (datosDetalleActual_.bitacora !== undefined) {
      pintarDetalle_(cont, datosDetalleActual_.detalle, datosDetalleActual_.tareas, datosDetalleActual_.sala,
        datosDetalleActual_.miEmail, datosDetalleActual_.bitacora, datosDetalleActual_.rendimiento);
      return;
    }
    var idAlPedir = proyectoActivoId_;
    Promise.all([
      apiSeguro_('listarBitacoraProyecto', { proyecto_id: proyectoActivoId_ }),
      apiSeguro_('obtenerRendimientoProyecto', { proyecto_id: proyectoActivoId_ })
    ]).then(function (r) {
      if (!datosDetalleActual_ || idAlPedir !== proyectoActivoId_) return;
      datosDetalleActual_.bitacora = (r[0] && r[0].ok) ? r[0].data : [];
      datosDetalleActual_.rendimiento = (r[1] && r[1].ok) ? r[1].data : null;
      if (pestanaActiva_ === 'cronograma') {
        pintarDetalle_(cont, datosDetalleActual_.detalle, datosDetalleActual_.tareas, datosDetalleActual_.sala,
          datosDetalleActual_.miEmail, datosDetalleActual_.bitacora, datosDetalleActual_.rendimiento);
      }
    });
  }

  // v13 (Fase 5): mismo patrón lazy que cronograma, para dos pestañas chicas
  // que casi nadie abre en cada visita al proyecto.
  function cargarReuniones_(cont) {
    if (!datosDetalleActual_) return;
    if (datosDetalleActual_.reuniones !== undefined) {
      pintarDetalle_(cont, datosDetalleActual_.detalle, datosDetalleActual_.tareas, datosDetalleActual_.sala,
        datosDetalleActual_.miEmail, datosDetalleActual_.bitacora, datosDetalleActual_.rendimiento);
      return;
    }
    var idAlPedir = proyectoActivoId_;
    apiSeguro_('listarReunionesProyecto', { proyecto_id: proyectoActivoId_ }).then(function (r) {
      if (!datosDetalleActual_ || idAlPedir !== proyectoActivoId_) return;
      datosDetalleActual_.reuniones = (r && r.ok) ? r.data : [];
      if (pestanaActiva_ === 'reuniones') {
        pintarDetalle_(cont, datosDetalleActual_.detalle, datosDetalleActual_.tareas, datosDetalleActual_.sala,
          datosDetalleActual_.miEmail, datosDetalleActual_.bitacora, datosDetalleActual_.rendimiento);
      }
    });
  }

  function cargarDecisiones_(cont) {
    if (!datosDetalleActual_) return;
    if (datosDetalleActual_.decisiones !== undefined) {
      pintarDetalle_(cont, datosDetalleActual_.detalle, datosDetalleActual_.tareas, datosDetalleActual_.sala,
        datosDetalleActual_.miEmail, datosDetalleActual_.bitacora, datosDetalleActual_.rendimiento);
      return;
    }
    var idAlPedir = proyectoActivoId_;
    apiSeguro_('listarDecisionesProyecto', { proyecto_id: proyectoActivoId_ }).then(function (r) {
      if (!datosDetalleActual_ || idAlPedir !== proyectoActivoId_) return;
      datosDetalleActual_.decisiones = (r && r.ok) ? r.data : [];
      if (pestanaActiva_ === 'decisiones') {
        pintarDetalle_(cont, datosDetalleActual_.detalle, datosDetalleActual_.tareas, datosDetalleActual_.sala,
          datosDetalleActual_.miEmail, datosDetalleActual_.bitacora, datosDetalleActual_.rendimiento);
      }
    });
  }

  // v12.2 ("llenar rápido, sin recarga"): actualización OPTIMISTA al registrar
  // un día. Antes, cada guardado invalidaba la bitácora en caché y volvía a
  // pedir bitácora+rendimiento al backend (Apps Script en serie, 1-3 s) y
  // repintaba todo perdiendo el scroll -- se sentía como recargar la página en
  // cada celda. Ahora: el registro ya guardado se mergea en la bitácora en
  // caché, la grilla se repinta al instante DESDE CACHÉ (sin red, sin perder
  // el scroll), y solo el rendimiento (KPIs / Plan·Esperado·Real, que lo
  // calcula el backend) se refresca en segundo plano, en silencio.
  function mergeRegistroDiaEnCache_(reg) {
    if (!datosDetalleActual_ || datosDetalleActual_.bitacora === undefined || !reg || !reg.actividad_id || !reg.dia) return false;
    // Sella autor/momento para la traza del modal (el backend pondrá los
    // definitivos en la próxima carga real; esto es solo para el repintado ya).
    reg.editado_por = reg.editado_por || datosDetalleActual_.miEmail || '';
    reg.editado_en = new Date().toISOString();
    var b = datosDetalleActual_.bitacora;
    for (var i = b.length - 1; i >= 0; i--) {
      if (b[i].tipo === 'REGISTRO_DIA' && b[i].actividad_id === reg.actividad_id && b[i].dia === reg.dia) b.splice(i, 1);
    }
    b.push(reg);
    return true;
  }

  // v12.5: quita de la bitácora en caché el REGISTRO_DIA de (tarea, día) --
  // para el repintado optimista al eliminar un registro.
  function eliminarRegistroDiaEnCache_(actId, dia) {
    if (!datosDetalleActual_ || datosDetalleActual_.bitacora === undefined || !actId || !dia) return false;
    var b = datosDetalleActual_.bitacora, quitados = 0;
    for (var i = b.length - 1; i >= 0; i--) {
      if (b[i].tipo === 'REGISTRO_DIA' && b[i].actividad_id === actId && b[i].dia === dia) { b.splice(i, 1); quitados++; }
    }
    return quitados > 0;
  }

  // Repinta el detalle DESDE CACHÉ (sin red) preservando el scroll de la carta.
  function repintarCronogramaDesdeCache_(cont) {
    var previo = cont.querySelector('.sigso-py-ded-scroll');
    var sx = previo ? previo.scrollLeft : 0, sy = previo ? previo.scrollTop : 0;
    cambiarPestana_('cronograma'); // pinta desde datosDetalleActual_, sin viaje de red
    var nuevo = cont.querySelector('.sigso-py-ded-scroll');
    if (nuevo) { nuevo.scrollLeft = sx; nuevo.scrollTop = sy; }
  }

  // Refresca SOLO el rendimiento (KPIs y Plan·Esperado·Real, que los calcula el
  // backend) en segundo plano, sin bloquear ni parpadear la grilla ya pintada.
  function refrescarRendimientoEnSegundoPlano_(cont) {
    if (!datosDetalleActual_ || !proyectoActivoId_) return;
    var idAlPedir = proyectoActivoId_;
    apiSeguro_('obtenerRendimientoProyecto', { proyecto_id: proyectoActivoId_ }).then(function (r) {
      if (!datosDetalleActual_ || idAlPedir !== proyectoActivoId_ || !r || !r.ok) return;
      datosDetalleActual_.rendimiento = r.data;
      if (pestanaActiva_ === 'cronograma' && vistaCronograma_ === 'dedicacion') repintarCronogramaDesdeCache_(cont);
    });
  }

  function pintarDetalle_(cont, detalle, tareas, sala, miEmail, bitacora, rendimiento) {
    // v12.3: el Cronograma va a ancho completo; las demás pestañas, angostas.
    fijarAnchoCarta_(pestanaActiva_ === 'cronograma');
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
      { id: 'cronograma', texto: 'Cronograma' },
      { id: 'entregables', texto: 'Entregables' },
      { id: 'documentos', texto: 'Documentos' },
      { id: 'reuniones', texto: 'Reuniones' },
      { id: 'decisiones', texto: 'Decisiones' },
      { id: 'riesgos', texto: 'Riesgos' },
      { id: 'equipo', texto: 'Equipo' }
    ];

    var tabs = PESTANAS.map(function (t) {
      return '<button type="button" class="sigso-tab js-py-tab' + (t.id === pestanaActiva_ ? ' sigso-tab--activo' : '') + '" data-tab="' + t.id + '">' + t.texto + '</button>';
    }).join('');

    // v11 ("mejoras visuales del módulo"): "← Portafolio" pasa a su propia
    // migaja de pan, más chica y muda -- antes competía en la misma línea
    // con el título y la salud, los tres con el mismo peso visual. Salud +
    // estado quedan agrupados como un "cluster" a la derecha del título
    // (se van debajo en mobile), en vez de tres piezas sueltas envolviendo.
    var cabecera =
      '<div class="sigso-py-migaja">' +
        Componentes.boton({ texto: '← Portafolio', variante: 'sutil', clase: 'js-py-volver' }) +
      '</div>' +
      '<div class="sigso-py-detalle-cab">' +
        '<h1>' + Componentes.escaparHtml(p.nombre) + '</h1>' +
        '<div class="sigso-py-detalle-cab__estado">' +
          '<span class="sigso-py-salud sigso-py-salud--' + detalle.salud + '">' + Componentes.punto(SALUD_TONO[detalle.salud]) + SALUD_ETIQUETA[detalle.salud] + saludScoreHtml_(detalle.salud_score) + '</span>' +
          Componentes.badge(ESTADO_PROYECTO_ETIQUETA[p.estado] || p.estado, 'neutro') +
        '</div>' +
      '</div>' +
      (detalle.salud_motivos && detalle.salud_motivos.length
        ? '<p class="sigso-py-motivos">' + Componentes.escaparHtml(detalle.salud_motivos.join(' · ')) + '</p>' : '') +
      '<div class="sigso-tabs">' + tabs + '</div>';

    var cuerpo = '';
    if (pestanaActiva_ === 'resumen') cuerpo = pintarResumen_(detalle, tareas, puedeGestionar);
    else if (pestanaActiva_ === 'sala') cuerpo = pintarSala_(sala, detalle);
    else if (pestanaActiva_ === 'tareas') cuerpo = pintarTareas_(tareas, detalle, puedeGestionar, miEmail);
    else if (pestanaActiva_ === 'hitos') cuerpo = pintarHitos_(detalle, puedeGestionar, tareas);
    else if (pestanaActiva_ === 'cronograma') {
      // v10 (auditoría G): bitacora === undefined => todavía cargando (lazy).
      cuerpo = (bitacora === undefined)
        ? Componentes.cargando('Cargando cronograma...')
        // v11 (P0): contexto de edición de la celda diaria -- quién soy y si
        // puedo gestionar el proyecto, para decidir qué celdas son editables.
        : pintarCronograma_(detalle, tareas, bitacora, rendimiento, {
            miEmail: miEmail,
            proyectoId: detalle.proyecto.proyecto_id,
            puedeEditarTarea: function (a) { return puedeGestionar || trabajoLaTarea_(a, miEmail); },
            // v11 (P1): "congelar línea base" es gestión del proyecto (líder/
            // ADM), no de una tarea puntual -- distinto de puedeEditarTarea.
            puedeGestionar: puedeGestionar
          });
    }
    else if (pestanaActiva_ === 'entregables') cuerpo = pintarEntregables_(detalle, puedeGestionar);
    else if (pestanaActiva_ === 'documentos') cuerpo = pintarDocumentos_(detalle, tareas, puedeGestionar);
    else if (pestanaActiva_ === 'reuniones') {
      cuerpo = (datosDetalleActual_ && datosDetalleActual_.reuniones === undefined)
        ? Componentes.cargando('Cargando reuniones...')
        : pintarReuniones_(datosDetalleActual_ ? (datosDetalleActual_.reuniones || []) : [], detalle, tareas, puedeGestionar);
    }
    else if (pestanaActiva_ === 'decisiones') {
      cuerpo = (datosDetalleActual_ && datosDetalleActual_.decisiones === undefined)
        ? Componentes.cargando('Cargando decisiones...')
        : pintarDecisiones_(datosDetalleActual_ ? (datosDetalleActual_.decisiones || []) : [], detalle, tareas, puedeGestionar);
    }
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

  // v13 (Fase 2, "dashboard ejecutivo"): tipo de dato -> a qué pestaña
  // navega un ítem de "Atención requerida" al hacer click, y qué ícono lo
  // representa. Mapa de presentación puro, igual criterio que
  // HITO_ESTADO_ETIQUETA/TIPO_EVENTO_ETIQUETA -- no es una regla de negocio.
  var ATENCION_ITEM_ICONO_ = {
    tarea_critica_atrasada: 'alerta', tarea_vencida: 'alerta',
    tarea_bloqueada: 'pausado', hito_atrasado: 'diana', riesgo_alto: 'escudo'
  };

  function pintarResumen_(detalle, tareas, puedeGestionar) {
    var p = detalle.proyecto;
    var atencion = detalle.requiere_atencion || {};

    // --- Banda de KPIs ejecutivos ------------------------------------------
    // v13 (Fase 2): de 4 números sueltos a una banda que responde preguntas
    // de gerencia (§8 de la propuesta: "qué decisión puede tomar con esto").
    // Cada KPI en rojo SOLO si su valor es alarmante -- un cero no debe
    // gritar (mismo criterio que ya usa el PDF, kpiTarjetaPdf_).
    var avance = detalle.avance_pct;
    var esperado = detalle.avance_esperado_pct;
    var desviacion = (avance !== null && avance !== undefined && esperado !== null && esperado !== undefined)
      ? Math.round((avance - esperado) * 10) / 10 : null;
    var hitosTotal = (detalle.hitos || []).length;
    var hitosCompletados = (detalle.hitos || []).filter(function (h) { return h.estado === 'COMPLETADO'; }).length;
    var vencePlazo = venceEn_(p.fecha_objetivo);

    var kpis = [
      Componentes.kpi({ etiqueta: 'Avance real', valor: (avance === null ? '—' : avance + '%') }),
      Componentes.kpi({ etiqueta: 'Avance esperado (plan)', valor: (esperado === null || esperado === undefined ? '—' : esperado + '%') }),
      Componentes.kpi({
        etiqueta: 'Desviación', alerta: desviacion !== null && desviacion < 0,
        valor: desviacion === null ? '—' : (desviacion > 0 ? '+' : '') + desviacion + 'pp'
      }),
      Componentes.kpi({ etiqueta: 'Hitos completados', valor: hitosTotal ? (hitosCompletados + '/' + hitosTotal) : '—' }),
      Componentes.kpi({ etiqueta: 'Tareas vencidas', alerta: (atencion.tareas_vencidas || 0) > 0, valor: atencion.tareas_vencidas || 0 }),
      Componentes.kpi({ etiqueta: 'Críticas atrasadas (P1/P2)', alerta: (atencion.tareas_criticas_atrasadas || 0) > 0, valor: atencion.tareas_criticas_atrasadas || 0 }),
      Componentes.kpi({ etiqueta: 'Riesgos altos abiertos', alerta: (atencion.riesgos_altos || 0) > 0, valor: atencion.riesgos_altos || 0 }),
      Componentes.kpi({ etiqueta: 'Fecha objetivo', titulo: vencePlazo, valor: fechaCorta_(p.fecha_objetivo) })
    ].join('');

    // --- Próximo hito --------------------------------------------------
    // v13 (Fase 2): el hito no-terminal más próximo -- calculado en cliente
    // a partir de `detalle.hitos` (ya viaja completo, cero llamada nueva).
    var hitosVivos = (detalle.hitos || []).filter(function (h) { return h.estado !== 'COMPLETADO' && h.estado !== 'CANCELADO' && h.fecha_objetivo; })
      .sort(function (a, b) { return new Date(a.fecha_objetivo) - new Date(b.fecha_objetivo); });
    var proximoHito = hitosVivos[0];
    var proximoHitoHtml = proximoHito
      ? '<div class="sigso-py-proximo-hito">' + Iconos.svg('diana', { tam: 16 }) +
          '<span><b>Próximo hito:</b> ' + Componentes.escaparHtml(proximoHito.nombre) + ' · ' + venceEn_(proximoHito.fecha_objetivo) + '</span>' +
        '</div>'
      : '';

    // --- Atención requerida ----------------------------------------------
    // v13 (Fase 2): la lista ACCIONABLE detrás de los números en rojo de
    // arriba -- cada ítem navega a la pestaña donde vive (§7 de la
    // propuesta: "solo lo que necesita atención, y que sea accionable").
    var items = atencion.items || [];
    var atencionHtml;
    if (!items.length) {
      atencionHtml = '<div class="sigso-py-atencion sigso-py-atencion--vacia">' +
        Iconos.svg('check', { tam: 16 }) + '<span>Nada requiere atención ahora mismo.</span></div>';
    } else {
      var filas = items.map(function (it) {
        return '<button type="button" class="sigso-py-atencion-item js-py-atencion-item" data-tab="' + Componentes.escaparHtml(it.tab) + '">' +
          Iconos.svg(ATENCION_ITEM_ICONO_[it.tipo] || 'alerta', { tam: 15 }) +
          '<span class="sigso-py-atencion-item__tit">' + Componentes.escaparHtml(it.titulo) + '</span>' +
          '<span class="sigso-py-atencion-item__meta">' + Componentes.escaparHtml(it.meta || '') + '</span>' +
        '</button>';
      }).join('');
      var masTexto = (atencion.items_total || 0) > items.length
        ? '<p class="sigso-ayuda">Y ' + (atencion.items_total - items.length) + ' más -- revisa cada pestaña para verlos todos.</p>' : '';
      atencionHtml = '<div class="sigso-py-atencion">' + filas + '</div>' + masTexto;
    }

    // v10 (Fase D, propuesta 11): "Descargar PDF" es de solo lectura --
    // cualquiera que vea el proyecto puede exportarlo, no solo quien puede
    // gestionarlo.
    var descargarPdf = Componentes.boton({ texto: 'Descargar PDF', variante: 'secundario', clase: 'js-py-descargar-pdf' });
    // v11 ("PDF ejecutivo configurable"): un informe a medida -- secciones,
    // rango, personas, estado. "Descargar PDF" (arriba) sigue siendo el
    // camino de un clic, sin tocar nada.
    var configurarInforme = Componentes.boton({ texto: 'Configurar informe', variante: 'sutil', clase: 'js-py-configurar-informe' });

    var acciones = puedeGestionar
      ? '<div class="sigso-py-acciones">' +
          Componentes.boton({ texto: 'Editar proyecto', variante: 'secundario', clase: 'js-py-editar' }) +
          // v10 (Fase C, propuesta 07): guardar la estructura de hitos de
          // ESTE proyecto como plantilla, para arrancar los proximos
          // proyectos parecidos desde ahi.
          Componentes.boton({ texto: 'Guardar como plantilla', variante: 'secundario', clase: 'js-py-guardar-plantilla' }) +
          descargarPdf + configurarInforme +
          (p.estado !== 'CERRADO' && p.estado !== 'CANCELADO'
            ? Componentes.boton({ texto: 'Cerrar proyecto', variante: 'peligro', clase: 'js-py-cerrar' }) : '') +
        '</div>'
      : '<div class="sigso-py-acciones">' + descargarPdf + configurarInforme + '</div>';

    // v10 (Fase D, propuesta 10 "Solicitud -> Proyecto"): trazabilidad de
    // donde salio este proyecto, si vino de una solicitud convertida.
    var origenSolicitud = p.solicitud_origen_id
      ? '<p class="sigso-ayuda">Creado a partir de la solicitud <b>' + Componentes.escaparHtml(p.solicitud_origen_id) + '</b>.</p>'
      : '';

    return '<div class="sigso-py-kpis sigso-py-kpis--resumen">' + kpis + '</div>' +
      proximoHitoHtml +
      '<h3 class="sigso-py-seccion-tit">Atención requerida</h3>' +
      atencionHtml +
      (p.descripcion ? '<p>' + Componentes.escaparHtml(p.descripcion) + '</p>' : '') +
      (p.objetivo ? '<p><b>Objetivo:</b> ' + Componentes.escaparHtml(p.objetivo) + '</p>' : '') +
      '<p class="sigso-ayuda">Líder: ' + Componentes.escaparHtml(p.lider_email) +
        ' · Del ' + fechaCorta_(p.fecha_inicio) + ' al ' + fechaCorta_(p.fecha_objetivo) + '</p>' +
      origenSolicitud +
      acciones;
  }

  // --- Sala --------------------------------------------------------------

  // v10 (Fase D, propuesta 09 "resumen diario"): "que se movió" desde la
  // ultima vez que ESTA persona vio la Sala -- ya viene calculado del
  // backend (calcularResumenVisitaProyecto_), aca solo se elige que texto
  // mostrar segun que contadores vinieron en > 0.
  function pintarResumenVisita_(resumen) {
    if (!resumen) return ''; // primera visita: nada que "desde" mostrar
    var partes = [];
    if (resumen.eventos_sala > 0) partes.push(resumen.eventos_sala + ' publicación(es) en la sala');
    if (resumen.tareas_completadas > 0) partes.push(resumen.tareas_completadas + ' tarea(s) completada(s)');
    if (resumen.tareas_bloqueadas > 0) partes.push(resumen.tareas_bloqueadas + ' tarea(s) bloqueada(s)');
    if (resumen.entregables_aprobados > 0) partes.push(resumen.entregables_aprobados + ' entregable(s) aprobado(s)');
    var texto = partes.length ? partes.join(' · ') : 'Sin novedades';
    return '<div class="sigso-py-resumen-visita">' +
      '<b>Desde tu última visita</b> (' + diasRelativo_(resumen.desde) + '): ' + texto +
    '</div>';
  }

  function pintarSala_(sala, detalle) {
    var puedePublicar = puedeAportar_(detalle);
    var resumenVisita = pintarResumenVisita_(detalle.resumen_desde_ultima_visita);
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
    // v10 (Fase D, propuesta 08 "adjuntos por proyecto"): zona de archivos,
    // literalmente dentro de la Sala -- el input queda oculto (el label
    // hace de boton) y el nombre elegido se muestra al lado para que quede
    // claro que hay algo listo para subir antes de tocar "Adjuntar".
    var formAdjunto = puedePublicar
      ? '<div class="sigso-py-adjuntar">' +
          '<label for="py-sala-archivo" class="sigso-boton sigso-boton--sutil sigso-boton--con-icono">' +
            Iconos.svg('adjunto', { tam: 14 }) + 'Elegir archivo</label>' +
          '<input type="file" id="py-sala-archivo" class="sigso-oculto" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.webp">' +
          '<span class="sigso-py-adjuntar__nombre" id="py-sala-archivo-nombre">Ningún archivo elegido</span>' +
          Componentes.boton({ texto: 'Adjuntar', variante: 'sutil', clase: 'js-py-adjuntar-enviar', tipo: 'button', disabled: true }) +
        '</div>'
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
          formAdjunto +
        '</form>'
      : '';

    if (sala.length === 0) {
      return resumenVisita + form + Componentes.vacio({ texto: 'Todavía no hay nada en la sala.' });
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
        // v10 (Fase D, "adjuntos por proyecto"): un archivo es un evento mas
        // de la Sala (ver Proyectos.subirAdjunto) -- se distingue mostrando
        // "Descargar" en vez del cuerpo de texto (que aca solo trae un
        // comentario opcional sobre el archivo, si lo hubo).
        (e.tipo === 'ARCHIVO'
          ? (e.cuerpo ? '<p class="sigso-py-evento__cuerpo">' + Componentes.escaparHtml(e.cuerpo) + '</p>' : '') +
            Componentes.boton({ texto: 'Descargar', variante: 'sutil', clase: 'js-py-descargar-adjunto', idx: e.evento_id })
          : '<p class="sigso-py-evento__cuerpo">' + Componentes.escaparHtml(e.cuerpo || '') + '</p>') +
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

    return resumenVisita + form + '<div class="sigso-py-feed">' + feed + '</div>';
  }

  // v10 (Fase A/B): check-in inline, compartido entre la pestaña "Tareas" de
  // un proyecto (wireAccionesPestana_, tanto en Lista como en el tablero
  // Kanban), la vista transversal "Mi trabajo en proyectos"
  // (pintarMiTrabajoProyectos_) y ahora tambien arrastrar una tarjeta del
  // Kanban a otra columna (wireKanbanDragDrop_) -- todos terminan en el
  // MISMO endpoint (checkinActividad). Lo unico que cambia entre ellos es
  // QUÉ se repinta al terminar.
  // v10 (Fase G2, "el dia se justifica mejor"): horas + nota OPCIONALES,
  // leidas del <details> plegado que acompaña a las pastillas (si existe y
  // tiene algo escrito) -- ver .sigso-mt-checkin-wrap. Sin eso, el check-in
  // de un clic de siempre sigue funcionando exactamente igual.
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

  function ejecutarCheckin_(actividadId, tipo, alExito, extra) {
    extra = extra || {};
    if (tipo === 'bloqueo') {
      Componentes.prompt({
        titulo: 'Motivo del bloqueo',
        mensaje: '¿Qué necesitas para poder seguir? Si sabes quién debe destrabarlo, dilo también.',
        placeholder: 'Ej: esperando la aprobación de Contabilidad'
      }).then(function (motivo) {
        if (motivo === null || motivo === undefined || String(motivo).trim() === '') return;
        var payload = { actividad_id: actividadId, tipo: 'bloqueo', bloqueo_motivo: motivo };
        if (extra.horas !== undefined) payload.horas = extra.horas;
        api_('checkinActividad', payload).then(function (r) {
          if (!r || !r.ok) { Componentes.aviso({ texto: (r && r.message) || 'No se pudo actualizar.', tipo: 'error' }); return; }
          alExito();
        });
      });
      return;
    }
    var payload = { actividad_id: actividadId, tipo: tipo };
    if (extra.horas !== undefined) payload.horas = extra.horas;
    if (extra.nota !== undefined) payload.nota = extra.nota;
    api_('checkinActividad', payload).then(function (r) {
      if (!r || !r.ok) { Componentes.aviso({ texto: (r && r.message) || 'No se pudo actualizar.', tipo: 'error' }); return; }
      alExito();
    });
  }

  function wireCheckin_(cont, alExito) {
    cont.querySelectorAll('[data-py-checkin]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        ejecutarCheckin_(btn.getAttribute('data-idx'), btn.getAttribute('data-py-checkin'), alExito, leerCheckinExtra_(btn));
      });
    });
  }

  // --- Mi trabajo en proyectos (v10, Fase B) --------------------------------
  //
  // Vista transversal: TODAS mis tareas y entregables pendientes, de TODOS
  // mis proyectos, en un solo lugar -- antes había que entrar proyecto por
  // proyecto para saber qué toca. Backend: Proyectos.listarMisTareas (ya
  // filtra por responsable_email === yo, no reusa Actividades.listar a
  // propósito -- ver comentario en Proyectos.gs).
  var vistaMiTrabajo_ = 'lista';
  // v10 (Fase G3): la bitácora transversal se pide solo la primera vez que
  // se abre "Dedicación" en esta pantalla -- la mayoría de las visitas a
  // "Mi trabajo en proyectos" solo miran la Lista, no vale la pena pedirla
  // siempre (a diferencia del Cronograma de un proyecto, donde SÍ se pide
  // junto con el resto porque esa pestaña puntual ya la necesita seguro).
  var miBitacoraCache_ = null;

  function cargarMiTrabajoProyectos_() {
    proyectoActivoId_ = null;
    datosDetalleActual_ = null;
    miBitacoraCache_ = null;
    var cont = panelProyectos_();
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando tu trabajo...');
    api_('listarMisTareasProyectos', {}).then(function (r) {
      if (!r || !r.ok) {
        cont.innerHTML = Componentes.alerta((r && r.message) || 'No se pudo cargar tu trabajo.', 'error');
        return;
      }
      pintarMiTrabajoVista_(cont, r.data || { tareas: [], entregables: [] });
    }).catch(function () {
      cont.innerHTML = Componentes.alerta('No se pudo conectar.', 'error');
    });
  }

  // v10 (Fase G3, "vista transversal por recurso"): Lista (de siempre) vs.
  // Dedicación -- la MISMA Carta Gantt de Dedicación de un proyecto, pero
  // cruzando TODOS los proyectos donde trabajo. Mismo patrón de toggle que
  // el Cronograma Plan/Dedicación de un proyecto.
  function pintarMiTrabajoVista_(cont, datos) {
    var toggle = '<div class="sigso-py-vista-toggle" style="margin-bottom:var(--esp-3);">' +
        Componentes.boton({ texto: 'Lista', variante: vistaMiTrabajo_ === 'lista' ? undefined : 'sutil', clase: 'js-py-mt-vista', idx: 'lista' }) +
        Componentes.boton({ texto: 'Dedicación', variante: vistaMiTrabajo_ === 'dedicacion' ? undefined : 'sutil', clase: 'js-py-mt-vista', idx: 'dedicacion' }) +
      '</div>';
    if (vistaMiTrabajo_ === 'dedicacion') {
      pintarMiDedicacion_(cont, toggle, datos.tareas || []);
      return;
    }
    pintarMiTrabajoLista_(cont, toggle, datos);
  }

  function wireMiTrabajoToggle_(cont, datos) {
    cont.querySelectorAll('.js-py-mt-vista').forEach(function (btn) {
      btn.addEventListener('click', function () {
        vistaMiTrabajo_ = btn.getAttribute('data-idx');
        pintarMiTrabajoVista_(cont, datos);
      });
    });
  }

  function pintarMiDedicacion_(cont, toggle, tareas) {
    if (!tareas.length) {
      cont.innerHTML = toggle + Componentes.vacio({ texto: 'No tienes tareas en proyectos para mostrar tu dedicación.' });
      wireMiTrabajoToggle_(cont, { tareas: tareas });
      return;
    }
    if (miBitacoraCache_ === null) {
      cont.innerHTML = toggle + Componentes.cargando('Cargando tu dedicación...');
      api_('listarMiBitacoraProyectos', {}).then(function (r) {
        miBitacoraCache_ = (r && r.ok) ? r.data : [];
        pintarMiDedicacion_(cont, toggle, tareas);
      }).catch(function () {
        miBitacoraCache_ = [];
        pintarMiDedicacion_(cont, toggle, tareas);
      });
      return;
    }
    // Sin rendimiento (null): esa tira de KPIs es por proyecto (Fase G3
    // Part A) -- un promedio cruzando proyectos distintos mezclaría metas
    // de unidades diferentes (imágenes con piezas, por ejemplo).
    // v11 (P0): en "Mi dedicación" todas las tareas son mías (soy responsable
    // o colaborador), así que toda celda no futura es editable; el proyecto de
    // cada celda es el de su propia tarea (vista cruzada de proyectos).
    var ctxEdicion = { proyectoId: null, puedeEditarTarea: function () { return true; } };
    cont.innerHTML = toggle + pintarCronogramaDedicacion_(null, tareas, miBitacoraCache_, null, ctxEdicion);
    wireMiTrabajoToggle_(cont, { tareas: tareas });
    wireCartaControles_(cont, function () { pintarMiDedicacion_(cont, toggle, tareas); }, null,
      function () { miBitacoraCache_ = null; pintarMiDedicacion_(cont, toggle, tareas); });
  }

  function pintarMiTrabajoLista_(cont, toggle, datos) {
    var tareas = datos.tareas || [];
    var entregables = datos.entregables || [];
    var cabecera = '<div class="sigso-py-cabecera">' +
      '<p class="sigso-ayuda">Tus tareas y entregables pendientes, de todos tus proyectos, en un solo lugar.</p>' +
    '</div>';

    if (tareas.length === 0 && entregables.length === 0) {
      cont.innerHTML = toggle + cabecera + Componentes.vacio({ texto: 'No tienes tareas ni entregables pendientes en proyectos.' });
      wireMiTrabajoToggle_(cont, datos);
      return;
    }

    function abrirBoton_(proyectoId, proyectoNombre) {
      return '<button type="button" class="sigso-mt-link js-py-mt-abrir" data-id="' + proyectoId + '">' +
        Componentes.escaparHtml(proyectoNombre) + '</button>';
    }

    var bloqueTareas = '<h3 class="sigso-py-grupo__titulo">Tareas <span class="sigso-py-grupo__cuenta">' + tareas.length + '</span></h3>' +
      (tareas.length === 0
        ? Componentes.vacio({ texto: 'No tienes tareas pendientes en proyectos.' })
        : '<div class="sigso-py-lista">' + tareas.map(function (a) {
            return '<div class="sigso-py-tarea sigso-py-tarea--mia">' +
              '<div class="sigso-py-tarea__top">' +
                '<span class="sigso-py-tarea__titulo">' + Componentes.escaparHtml(a.titulo) + '</span>' +
                // v10 (multi-asignación): si aparezco por colaborador y no como
                // dueño, se marca "Colaboras" para que quede claro el rol.
                (a.soy_responsable === false ? '<span class="sigso-badge sigso-badge--neutro">Colaboras</span>' : '') +
                '<span class="sigso-badge sigso-mt-badge--' + a.semaforo + '">' + Componentes.escaparHtml(a.semaforo_etiqueta) + '</span>' +
              '</div>' +
              '<div class="sigso-py-tarea__meta">' +
                abrirBoton_(a.proyecto_id, a.proyecto_nombre) +
                '<span>Prioridad ' + a.prioridad + '</span>' +
                (a.fecha_compromiso ? '<span>Vence ' + fechaCorta_(a.fecha_compromiso) + '</span>' : '') +
                (a.avance_pct !== '' && a.avance_pct !== undefined && a.avance_pct !== null ? '<span>' + a.avance_pct + '% avance</span>' : '') +
                metaChipHtml_(a) +
              '</div>' +
              (a.estado === 'BLOQUEADA' ? '<div class="sigso-mt-bloqueo">' + Iconos.svg('pausado', { tam: 14 }) + ' ' + Componentes.escaparHtml(a.bloqueo_motivo) + '</div>' : '') +
              accionesCheckinTarea_(a, true) +
            '</div>';
          }).join('') + '</div>');

    var bloqueEntregables = entregables.length
      ? '<h3 class="sigso-py-grupo__titulo">Entregables pendientes <span class="sigso-py-grupo__cuenta">' + entregables.length + '</span></h3>' +
        '<div class="sigso-py-lista">' + entregables.map(function (e) {
          return '<div class="sigso-py-tarea">' +
            '<div class="sigso-py-tarea__top">' +
              '<span class="sigso-py-tarea__titulo">' + Componentes.escaparHtml(e.nombre) + '</span>' +
              Componentes.badge(ENTREGABLE_ESTADO_ETIQUETA[e.estado] || e.estado, entregableBadgeVariante_(e.estado)) +
            '</div>' +
            '<div class="sigso-py-tarea__meta">' +
              abrirBoton_(e.proyecto_id, e.proyecto_nombre) +
              '<span>' + venceEn_(e.fecha_comprometida) + '</span>' +
            '</div>' +
          '</div>';
        }).join('') + '</div>'
      : '';

    cont.innerHTML = toggle + cabecera + bloqueTareas + bloqueEntregables;

    cont.querySelectorAll('.js-py-mt-abrir').forEach(function (btn) {
      btn.addEventListener('click', function () { abrirProyecto_(btn.getAttribute('data-id')); });
    });
    wireMiTrabajoToggle_(cont, datos);
    wireCheckin_(cont, cargarMiTrabajoProyectos_);
  }

  // --- Calendario (v10, Fase C, propuesta 05) -------------------------------
  //
  // Un mes con las fechas comprometidas de tareas, hitos y entregables de
  // TODOS los proyectos visibles, como marcas por día. El filtro por
  // proyecto/"solo lo mío" es client-side sobre la MISMA lista (mismo
  // criterio que buscar/ordenar/agrupar el portafolio en Fase A): son pocos
  // items, no vale la pena un viaje de red por cada combinacion de filtro.
  var calendarioDatos_ = null;
  var calMiEmail_ = '';
  var calAnio_ = null;
  var calMes_ = null; // 0-indexado
  var calFiltroProyecto_ = '';
  var calSoloMio_ = false;
  var calDiaSeleccionado_ = '';
  var DIAS_SEMANA_CAL = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];
  var MESES_CAL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var ITEM_TIPO_ETIQUETA_CAL = { tarea: 'Tarea', hito: 'Hito', entregable: 'Entregable' };

  function pad2_(n) { return n < 10 ? '0' + n : '' + n; }
  function claveDia_(anio, mes, dia) { return anio + '-' + pad2_(mes + 1) + '-' + pad2_(dia); }
  // Mismo criterio que venceEn_/diasRelativo_: se leen los componentes de
  // fecha guardados TAL CUAL (UTC), sin convertir a la zona horaria local --
  // una fecha comprometida es un dia de calendario, no un instante.
  function claveDeIso_(iso) {
    var f = new Date(iso);
    if (isNaN(f.getTime())) return '';
    return claveDia_(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate());
  }
  function claveHoy_() {
    var h = new Date();
    return claveDia_(h.getFullYear(), h.getMonth(), h.getDate());
  }

  function cargarCalendario_() {
    proyectoActivoId_ = null;
    datosDetalleActual_ = null;
    var cont = panelProyectos_();
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando calendario...');
    if (calAnio_ === null) {
      var hoy = new Date();
      calAnio_ = hoy.getFullYear();
      calMes_ = hoy.getMonth();
    }
    Promise.all([api_('listarCalendarioProyectos', {}), miPerfil_()]).then(function (respuestas) {
      var r = respuestas[0], perfil = respuestas[1];
      if (!r || !r.ok) {
        cont.innerHTML = Componentes.alerta((r && r.message) || 'No se pudo cargar el calendario.', 'error');
        return;
      }
      calendarioDatos_ = r.data;
      calMiEmail_ = normalizarEmail_(perfil && perfil.email);
      pintarCalendario_(cont);
    }).catch(function () {
      cont.innerHTML = Componentes.alerta('No se pudo conectar.', 'error');
    });
  }

  function itemsCalendarioFiltrados_() {
    var items = (calendarioDatos_ && calendarioDatos_.items) || [];
    if (calFiltroProyecto_) items = items.filter(function (i) { return i.proyecto_id === calFiltroProyecto_; });
    if (calSoloMio_) {
      items = items.filter(function (i) { return !!i.responsable_email && normalizarEmail_(i.responsable_email) === calMiEmail_; });
    }
    return items;
  }

  // Un hito/entregable no trae semaforo del backend (no son "actividades") --
  // se deriva aca mismo, con la misma idea de siempre (vencido = rojo).
  function colorClaveItemCalendario_(item) {
    if (item.tipo === 'tarea') return item.semaforo || 'al-dia';
    var vencido = new Date(item.fecha) < new Date();
    if (item.tipo === 'hito') {
      if (item.estado === 'COMPLETADO') return 'terminada';
      if (item.estado === 'CANCELADO') return 'cancelada';
      return vencido ? 'atrasada' : 'al-dia';
    }
    if (item.estado === 'OBSERVADO') return 'riesgo';
    return vencido ? 'atrasada' : 'al-dia';
  }

  function pintarDiaSeleccionadoCalendario_(items) {
    if (items.length === 0) {
      return '<div class="sigso-py-cal-panel">' + Componentes.vacio({ texto: 'Nada para este día.' }) + '</div>';
    }
    var filas = items.map(function (it) {
      return '<div class="sigso-py-tarea">' +
        '<div class="sigso-py-tarea__top">' +
          '<span class="sigso-py-tarea__titulo">' + Componentes.escaparHtml(it.titulo) + '</span>' +
          Componentes.badge(ITEM_TIPO_ETIQUETA_CAL[it.tipo] || it.tipo, 'neutro') +
        '</div>' +
        '<div class="sigso-py-tarea__meta">' +
          '<button type="button" class="sigso-mt-link js-cal-abrir" data-id="' + it.proyecto_id + '">' + Componentes.escaparHtml(it.proyecto_nombre) + '</button>' +
        '</div>' +
      '</div>';
    }).join('');
    return '<div class="sigso-py-cal-panel"><div class="sigso-py-lista">' + filas + '</div></div>';
  }

  function pintarCalendario_(cont) {
    var items = itemsCalendarioFiltrados_();
    var porDia = {};
    items.forEach(function (i) {
      var k = claveDeIso_(i.fecha);
      if (!k) return;
      (porDia[k] = porDia[k] || []).push(i);
    });

    var cabecera = '<div class="sigso-py-cabecera">' +
        '<p class="sigso-ayuda">Fechas comprometidas de tareas, hitos y entregables de tus proyectos.</p>' +
      '</div>';

    var filtros = '<div class="sigso-py-filtros">' +
        Componentes.campoSelect({
          id: 'cal-filtro-proyecto', label: false, valor: calFiltroProyecto_, placeholder: 'Todos los proyectos',
          opciones: (calendarioDatos_.proyectos || []).map(function (p) { return { valor: p.proyecto_id, texto: p.nombre }; })
        }) +
        '<label class="sigso-campo-check"><input type="checkbox" id="cal-solo-mio"' + (calSoloMio_ ? ' checked' : '') + '> Solo lo mío</label>' +
      '</div>';

    var nav = '<div class="sigso-py-cal-nav">' +
        Componentes.boton({ texto: '←', variante: 'sutil', clase: 'js-cal-mes-anterior', tipo: 'button' }) +
        '<span class="sigso-py-cal-mes">' + MESES_CAL[calMes_] + ' de ' + calAnio_ + '</span>' +
        Componentes.boton({ texto: '→', variante: 'sutil', clase: 'js-cal-mes-siguiente', tipo: 'button' }) +
        Componentes.boton({ texto: 'Hoy', variante: 'sutil', clase: 'js-cal-hoy', tipo: 'button' }) +
      '</div>';

    var primerDiaSemana = (new Date(calAnio_, calMes_, 1).getDay() + 6) % 7; // 0 = lunes
    var diasEnMes = new Date(calAnio_, calMes_ + 1, 0).getDate();
    var hoyClave = claveHoy_();

    var celdas = '';
    for (var i = 0; i < primerDiaSemana; i++) celdas += '<div class="sigso-py-cal-celda sigso-py-cal-celda--vacia"></div>';
    for (var dia = 1; dia <= diasEnMes; dia++) {
      var clave = claveDia_(calAnio_, calMes_, dia);
      var itemsDia = porDia[clave] || [];
      var marcas = itemsDia.slice(0, 3).map(function (it) {
        return '<span class="sigso-py-cal-marca sigso-py-cal-marca--' + colorClaveItemCalendario_(it) + '" title="' + Componentes.escaparHtml(it.titulo) + '"></span>';
      }).join('');
      var extra = itemsDia.length > 3 ? '<span class="sigso-py-cal-extra">+' + (itemsDia.length - 3) + '</span>' : '';
      celdas += '<button type="button" class="sigso-py-cal-celda js-cal-dia' +
          (clave === hoyClave ? ' sigso-py-cal-celda--hoy' : '') +
          (clave === calDiaSeleccionado_ ? ' sigso-py-cal-celda--activa' : '') + '" data-dia="' + clave + '">' +
        '<span class="sigso-py-cal-numero">' + dia + '</span>' +
        '<span class="sigso-py-cal-marcas">' + marcas + extra + '</span>' +
      '</button>';
    }

    var grid = '<div class="sigso-py-cal-cabecera-dias">' + DIAS_SEMANA_CAL.map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</div>' +
      '<div class="sigso-py-cal-grid">' + celdas + '</div>';

    var panelDia = calDiaSeleccionado_ ? pintarDiaSeleccionadoCalendario_(porDia[calDiaSeleccionado_] || []) : '';

    cont.innerHTML = cabecera + filtros + nav + grid + panelDia;

    cont.querySelector('#cal-filtro-proyecto').addEventListener('change', function () {
      calFiltroProyecto_ = this.value;
      pintarCalendario_(cont);
    });
    cont.querySelector('#cal-solo-mio').addEventListener('change', function () {
      calSoloMio_ = this.checked;
      pintarCalendario_(cont);
    });
    cont.querySelector('.js-cal-mes-anterior').addEventListener('click', function () {
      calMes_--; if (calMes_ < 0) { calMes_ = 11; calAnio_--; }
      pintarCalendario_(cont);
    });
    cont.querySelector('.js-cal-mes-siguiente').addEventListener('click', function () {
      calMes_++; if (calMes_ > 11) { calMes_ = 0; calAnio_++; }
      pintarCalendario_(cont);
    });
    cont.querySelector('.js-cal-hoy').addEventListener('click', function () {
      var h = new Date();
      calAnio_ = h.getFullYear(); calMes_ = h.getMonth(); calDiaSeleccionado_ = claveHoy_();
      pintarCalendario_(cont);
    });
    cont.querySelectorAll('.js-cal-dia').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var d = btn.getAttribute('data-dia');
        calDiaSeleccionado_ = (calDiaSeleccionado_ === d) ? '' : d;
        pintarCalendario_(cont);
      });
    });
    cont.querySelectorAll('.js-cal-abrir').forEach(function (btn) {
      btn.addEventListener('click', function () { abrirProyecto_(btn.getAttribute('data-id')); });
    });
  }

  // --- Tareas --------------------------------------------------------------

  // v10 (Fase A, propuesta 01 "check-in sin salir del proyecto"): las
  // pastillas de siempre de "Mi trabajo" (mismo texto, misma clase CSS
  // sigso-mt-pastilla), pero SOLO en la tarea propia -- comparando el correo
  // de la tarea con el de quien mira. El backend es quien de verdad manda
  // (Actividades.checkin exige ser el responsable, RN-702); esto solo evita
  // ofrecerle a cada integrante un boton que a el le va a rebotar.
  // v10 (Fase G2): chip "Meta: 16 imágenes" -- solo si la tarea tiene meta
  // cuantificable cargada (ver "Nueva tarea"). Sin meta, no se muestra nada.
  function metaChipHtml_(a) {
    if (a.meta_cantidad === '' || a.meta_cantidad === undefined || a.meta_cantidad === null) return '';
    return '<span>Meta ' + Componentes.escaparHtml(String(a.meta_cantidad)) + (a.meta_unidad ? ' ' + Componentes.escaparHtml(a.meta_unidad) : '') + '</span>';
  }

  // v10 (multi-asignación): chip "+ N nombre(s)" con los colaboradores de la
  // tarea (además del responsable). listarTareas ya los trae resueltos a
  // {email, nombre}. Sin colaboradores, no muestra nada.
  function colaboradoresChipHtml_(a) {
    var colab = a.colaboradores || [];
    if (!colab.length) return '';
    var nombres = colab.map(function (c) { return c.nombre || c.email; });
    var texto = nombres.length <= 2 ? nombres.join(', ') : (nombres.slice(0, 1).join('') + ' +' + (nombres.length - 1));
    return '<span class="sigso-py-colab-chip" title="' + Componentes.escaparHtml('Colaboran: ' + nombres.join(', ')) + '">' +
      Iconos.svg('equipo', { tam: 12 }) + ' ' + Componentes.escaparHtml(texto) + '</span>';
  }

  // v10 (Fase G2): el disclosure de horas/nota se comparte entre TODOS los
  // estados con pastillas -- ver leerCheckinExtra_/.sigso-mt-checkin-wrap.
  function checkinExtraHtml_() {
    return '<details class="sigso-mt-checkin-extra">' +
      '<summary>+ Horas / nota de hoy (opcional)</summary>' +
      '<div class="sigso-mt-checkin-extra__campos">' +
        '<input type="number" class="js-checkin-horas" min="0" max="24" step="0.5" placeholder="Horas">' +
        '<input type="text" class="js-checkin-nota" maxlength="280" placeholder="¿Qué hiciste hoy? (opcional)">' +
      '</div>' +
    '</details>';
  }

  function accionesCheckinTarea_(a, esMia) {
    if (!esMia) return '';
    var pendienteConfirmar = a.fecha_propuesta && !a.confirmada_en;
    if (pendienteConfirmar || a.estado === 'EN_REVISION' || a.estado === 'TERMINADA' || a.estado === 'CANCELADA') return '';
    if (a.estado === 'BLOQUEADA') {
      return '<div class="sigso-mt-checkin-wrap">' + checkinExtraHtml_() +
        '<div class="sigso-mt-checkin">' +
          '<button type="button" class="sigso-mt-pastilla sigso-mt-pastilla--destacada" data-py-checkin="desbloqueo" data-idx="' + a.actividad_id + '">Ya se destrabó</button>' +
        '</div>' +
      '</div>';
    }
    return '<div class="sigso-mt-checkin-wrap">' + checkinExtraHtml_() +
      '<div class="sigso-mt-checkin">' +
        '<button type="button" class="sigso-mt-pastilla" data-py-checkin="avance" data-idx="' + a.actividad_id + '">Avancé</button>' +
        '<button type="button" class="sigso-mt-pastilla sigso-mt-pastilla--destacada" data-py-checkin="sin_cambio" data-idx="' + a.actividad_id + '">Sin cambios</button>' +
        '<button type="button" class="sigso-mt-pastilla" data-py-checkin="bloqueo" data-idx="' + a.actividad_id + '">Estoy bloqueado</button>' +
        '<button type="button" class="sigso-mt-pastilla" data-py-checkin="listo" data-idx="' + a.actividad_id + '">Listo</button>' +
      '</div>' +
    '</div>';
  }

  // v10 (Fase B, tablero Kanban): "Lista" y "Tablero" son dos PRESENTACIONES
  // de las mismas tareas -- ni los datos ni los permisos cambian entre una y
  // otra, por eso vive como un simple flag de modulo (mismo patron que
  // pestanaActiva_), no algo que se pida de nuevo al servidor.
  var vistaTareas_ = 'lista';

  function pintarTareas_(tareas, detalle, puedeGestionar, miEmail) {
    var puedeCrear = puedeAportar_(detalle);
    var toggle = '<div class="sigso-py-vista-toggle">' +
        Componentes.boton({ texto: 'Lista', variante: vistaTareas_ === 'lista' ? undefined : 'sutil', clase: 'js-py-tareas-vista', idx: 'lista' }) +
        Componentes.boton({ texto: 'Tablero', variante: vistaTareas_ === 'tablero' ? undefined : 'sutil', clase: 'js-py-tareas-vista', idx: 'tablero' }) +
      '</div>';
    var acciones = '<div class="sigso-py-cabecera">' +
      '<div class="sigso-py-cabecera__izq">' +
        (puedeCrear ? Componentes.boton({ texto: '+ Nueva tarea', clase: 'js-py-nueva-tarea' }) : '') +
        (puedeGestionar ? Componentes.boton({ texto: 'Asignar en lote', variante: 'secundario', clase: 'js-py-asignacion-masiva' }) : '') +
      '</div>' +
      toggle +
    '</div>';

    if (tareas.length === 0) {
      return acciones + Componentes.vacio({ texto: 'Todavía no hay tareas en este proyecto.' });
    }

    return acciones + (vistaTareas_ === 'tablero'
      ? pintarTareasTablero_(tareas, miEmail, puedeGestionar)
      : pintarTareasLista_(tareas, miEmail, puedeGestionar));
  }

  // v11 (P2, "subtareas con rollup"): reordena para que cada subtarea
  // aparezca inmediatamente después de su padre (nesting visual por orden,
  // sin indentación de árbol de verdad -- un solo nivel, no hace falta más).
  // Una subtarea cuyo padre no está en esta lista (ej. un filtro que ocultó
  // al padre) se muestra igual, al final, para no perderla de vista.
  function ordenarConSubtareas_(tareas) {
    var porPadre = {}, idsHijas = {};
    tareas.forEach(function (a) {
      if (a.es_subtarea) { (porPadre[a.tarea_padre_id] = porPadre[a.tarea_padre_id] || []).push(a); idsHijas[a.actividad_id] = true; }
    });
    var resultado = [];
    tareas.forEach(function (a) {
      if (idsHijas[a.actividad_id]) return;
      resultado.push(a);
      (porPadre[a.actividad_id] || []).forEach(function (h) { resultado.push(h); });
    });
    var vistas = {};
    resultado.forEach(function (a) { vistas[a.actividad_id] = true; });
    tareas.forEach(function (a) { if (idsHijas[a.actividad_id] && !vistas[a.actividad_id]) resultado.push(a); });
    return resultado;
  }

  // v11 (P2, "subtareas con rollup"): chip "2/5 subtareas" + barra de
  // avance -- se calcula on-read (Proyectos.listarTareas), nunca se guarda.
  function rollupSubtareasHtml_(a) {
    if (!a.subtareas_total) return '';
    return '<div class="sigso-py-rollup" title="' + a.subtareas_terminadas + ' de ' + a.subtareas_total + ' subtareas terminadas">' +
      '<span>' + a.subtareas_terminadas + '/' + a.subtareas_total + ' subtareas</span>' +
      '<div class="sigso-py-rollup__barra"><div class="sigso-py-rollup__barra-fill" style="width:' + (a.avance_rollup_pct || 0) + '%"></div></div>' +
    '</div>';
  }

  // v11 (P2, "dependencias con impacto"): "si esto se atrasa, ¿a qué más
  // afecta?" -- puramente informativo (§I: nada mueve fechas ni bloquea
  // solo), calculado on-read en Proyectos.listarTareas.
  function impactoDependenciaHtml_(a) {
    if (!a.impacto_dependientes) return '';
    var extra = a.impacto_dependientes > a.impacto_titulos.length ? ' y ' + (a.impacto_dependientes - a.impacto_titulos.length) + ' más' : '';
    return '<div class="sigso-mt-bloqueo sigso-py-impacto" title="' + Componentes.escaparHtml(a.impacto_titulos.join(', ') + extra) + '">' +
      Iconos.svg('enlace', { tam: 14 }) + ' Si se atrasa, afecta a ' + a.impacto_dependientes + ' tarea(s) más</div>';
  }

  function pintarTareasLista_(tareas, miEmail, puedeGestionar) {
    var filas = ordenarConSubtareas_(tareas).map(function (a) {
      var esMia = !!miEmail && normalizarEmail_(a.responsable_email) === miEmail;
      var puedeEditar = puedeGestionar || trabajoLaTarea_(a, miEmail);
      return '<div class="sigso-py-tarea' + (esMia ? ' sigso-py-tarea--mia' : '') + (a.es_subtarea ? ' sigso-py-tarea--subtarea' : '') + '">' +
        (a.es_subtarea ? '<div class="sigso-py-subtarea-de">↳ Subtarea de "' + Componentes.escaparHtml(a.padre_titulo || '') + '"</div>' : '') +
        '<div class="sigso-py-tarea__top">' +
          '<span class="sigso-py-tarea__titulo">' + Componentes.escaparHtml(a.titulo) + '</span>' +
          '<span class="sigso-badge sigso-mt-badge--' + a.semaforo + '">' + Componentes.escaparHtml(a.semaforo_etiqueta) + '</span>' +
          (puedeEditar ? '<button type="button" class="sigso-btn--icono js-py-editar-tarea" data-idx="' + a.actividad_id + '" title="Editar tarea">' + Iconos.svg('editar', { tam: 16 }) + '</button>' : '') +
        '</div>' +
        '<div class="sigso-py-tarea__meta">' +
          '<span>' + (esMia ? '<b>Tú</b>' : Componentes.escaparHtml(a.responsable_nombre || a.responsable_email)) + '</span>' +
          '<span>Prioridad ' + a.prioridad + '</span>' +
          (a.fecha_compromiso ? '<span>Vence ' + fechaCorta_(a.fecha_compromiso) + '</span>' : '') +
          (a.avance_pct !== '' && a.avance_pct !== undefined && a.avance_pct !== null ? '<span>' + a.avance_pct + '% avance</span>' : '') +
          metaChipHtml_(a) +
          colaboradoresChipHtml_(a) +
        '</div>' +
        rollupSubtareasHtml_(a) +
        (a.estado === 'BLOQUEADA' ? '<div class="sigso-mt-bloqueo">' + Iconos.svg('pausado', { tam: 14 }) + ' ' + Componentes.escaparHtml(a.bloqueo_motivo) + '</div>' : '') +
        (a.dependencia_comprometida
          ? '<div class="sigso-mt-bloqueo">' + Iconos.svg('alerta', { tam: 14 }) + ' Depende de "' + Componentes.escaparHtml(a.dependencia_titulo) + '", que está atrasada.</div>'
          : '') +
        impactoDependenciaHtml_(a) +
        accionesCheckinTarea_(a, esMia) +
      '</div>';
    }).join('');

    return '<div class="sigso-py-lista">' + filas + '</div>';
  }

  // --- Tareas: tablero Kanban (v10, Fase B) ---------------------------------
  //
  // 4 columnas fijas, calcadas de los estados de Actividades.gs -- no hay un
  // estado de tablero propio, es la MISMA maquina de estados de siempre
  // vista como columnas. "Lista" agrupa los 3 estados terminales (no tiene
  // sentido una columna por cada uno: nadie necesita distinguir a simple
  // vista una tarea terminada de una cancelada en el tablero).
  var KANBAN_COLUMNAS = [
    { id: 'NO_INICIADA', titulo: 'Por hacer' },
    { id: 'EN_CURSO', titulo: 'En curso' },
    { id: 'BLOQUEADA', titulo: 'Bloqueada' },
    { id: 'LISTA', titulo: 'Lista' }
  ];

  function columnaDeEstado_(estado) {
    if (estado === 'NO_INICIADA' || estado === 'EN_CURSO' || estado === 'BLOQUEADA') return estado;
    return 'LISTA'; // TERMINADA, EN_REVISION, CANCELADA
  }

  // Solo se puede arrastrar la tarjeta propia, y solo si el check-in de
  // verdad podria hacer algo con ella (misma condicion que
  // accionesCheckinTarea_): una tarea ajena rebotaria en el backend (RN-702)
  // y una ya en "Lista" no tiene a donde volver (Actividades.gs no tiene
  // transicion hacia atras desde un estado terminal).
  function puedeArrastrarTarea_(a, esMia) {
    if (!esMia) return false;
    var pendienteConfirmar = a.fecha_propuesta && !a.confirmada_en;
    if (pendienteConfirmar) return false;
    return columnaDeEstado_(a.estado) !== 'LISTA';
  }

  // Que tipo de checkinActividad dispara soltar una tarjeta en `columnaDestino`,
  // viniendo de `estadoOrigen`. null = no hay transicion valida (soltar ahi
  // no hace nada -- p.ej. "Por hacer" nunca es un destino, o soltar en la
  // misma columna de la que salio).
  function tipoCheckinParaColumna_(columnaDestino, estadoOrigen) {
    if (columnaDestino === columnaDeEstado_(estadoOrigen)) return null;
    if (columnaDestino === 'NO_INICIADA') return null;
    if (columnaDestino === 'BLOQUEADA') return 'bloqueo';
    if (columnaDestino === 'EN_CURSO') return estadoOrigen === 'BLOQUEADA' ? 'desbloqueo' : 'sin_cambio';
    if (columnaDestino === 'LISTA') return 'listo';
    return null;
  }

  function tarjetaKanban_(a, esMia, puedeEditar) {
    var arrastrable = puedeArrastrarTarea_(a, esMia);
    return '<div class="sigso-kanban__tarjeta' + (esMia ? ' sigso-kanban__tarjeta--mia' : '') +
        (arrastrable ? ' sigso-kanban__tarjeta--arrastrable' : '') + '"' +
        (arrastrable ? ' draggable="true"' : '') +
        ' data-actividad-id="' + a.actividad_id + '" data-estado-origen="' + a.estado + '">' +
      '<div class="sigso-py-tarea__top">' +
        '<span class="sigso-py-tarea__titulo">' + Componentes.escaparHtml(a.titulo) + '</span>' +
        '<span class="sigso-badge sigso-mt-badge--' + a.semaforo + '">' + Componentes.escaparHtml(a.semaforo_etiqueta) + '</span>' +
        (puedeEditar ? '<button type="button" class="sigso-btn--icono js-py-editar-tarea" data-idx="' + a.actividad_id + '" title="Editar tarea">' + Iconos.svg('editar', { tam: 16 }) + '</button>' : '') +
      '</div>' +
      (a.es_subtarea ? '<div class="sigso-py-subtarea-de">↳ ' + Componentes.escaparHtml(a.padre_titulo || '') + '</div>' : '') +
      '<div class="sigso-py-tarea__meta">' +
        '<span>' + (esMia ? '<b>Tú</b>' : Componentes.escaparHtml(a.responsable_nombre || a.responsable_email)) + '</span>' +
        (a.fecha_compromiso ? '<span>Vence ' + fechaCorta_(a.fecha_compromiso) + '</span>' : '') +
        colaboradoresChipHtml_(a) +
      '</div>' +
      rollupSubtareasHtml_(a) +
      (a.estado === 'BLOQUEADA' ? '<div class="sigso-mt-bloqueo">' + Iconos.svg('pausado', { tam: 14 }) + ' ' + Componentes.escaparHtml(a.bloqueo_motivo) + '</div>' : '') +
      impactoDependenciaHtml_(a) +
      // Las mismas pastillas de siempre, aca doblan de fallback tactil/mobile
      // (donde arrastrar no es comodo): tocar "Listo" mueve la tarjeta igual
      // que soltarla en la columna "Lista".
      accionesCheckinTarea_(a, esMia) +
    '</div>';
  }

  function pintarTareasTablero_(tareas, miEmail, puedeGestionar) {
    var porColumna = { NO_INICIADA: [], EN_CURSO: [], BLOQUEADA: [], LISTA: [] };
    tareas.forEach(function (a) { porColumna[columnaDeEstado_(a.estado)].push(a); });

    var columnas = KANBAN_COLUMNAS.map(function (c) {
      var items = porColumna[c.id];
      var tarjetas = items.map(function (a) {
        var esMia = !!miEmail && normalizarEmail_(a.responsable_email) === miEmail;
        var puedeEditar = puedeGestionar || trabajoLaTarea_(a, miEmail);
        return tarjetaKanban_(a, esMia, puedeEditar);
      }).join('');
      // v10 (auditoría G, visual): acento de color por columna (mismo
      // semáforo del módulo) para que el tablero se lea de un vistazo.
      return '<div class="sigso-kanban__columna sigso-kanban__columna--' + c.id + '" data-columna="' + c.id + '">' +
        '<h3 class="sigso-kanban__titulo">' + c.titulo + ' <span class="sigso-kanban__cuenta">' + items.length + '</span></h3>' +
        '<div class="sigso-kanban__tarjetas">' + (tarjetas || '<p class="sigso-ayuda sigso-kanban__vacia">Sin tareas</p>') + '</div>' +
      '</div>';
    }).join('');

    return '<div class="sigso-kanban">' + columnas + '</div>';
  }

  // Arrastre HTML5 nativo. Estado de "que se esta arrastrando" en una
  // variable de modulo (no en dataTransfer): todo ocurre en la misma pagina,
  // asi que no hace falta serializar nada -- alcanza con leerlo de vuelta en
  // el 'drop'. dataTransfer.setData igual se llama (Firefox lo exige para
  // permitir el drag en absoluto).
  var arrastrandoId_ = null;
  var arrastrandoEstado_ = null;

  function wireKanbanDragDrop_(cont, alExito) {
    cont.querySelectorAll('.sigso-kanban__tarjeta--arrastrable').forEach(function (tarjeta) {
      tarjeta.addEventListener('dragstart', function (ev) {
        arrastrandoId_ = tarjeta.getAttribute('data-actividad-id');
        arrastrandoEstado_ = tarjeta.getAttribute('data-estado-origen');
        tarjeta.classList.add('sigso-kanban__tarjeta--arrastrando');
        if (ev.dataTransfer) {
          ev.dataTransfer.effectAllowed = 'move';
          ev.dataTransfer.setData('text/plain', arrastrandoId_);
        }
      });
      tarjeta.addEventListener('dragend', function () {
        tarjeta.classList.remove('sigso-kanban__tarjeta--arrastrando');
      });
    });

    cont.querySelectorAll('.sigso-kanban__columna').forEach(function (columna) {
      columna.addEventListener('dragover', function (ev) {
        if (!arrastrandoId_) return;
        ev.preventDefault();
        columna.classList.add('sigso-kanban__columna--sobre');
      });
      columna.addEventListener('dragleave', function () {
        columna.classList.remove('sigso-kanban__columna--sobre');
      });
      columna.addEventListener('drop', function (ev) {
        ev.preventDefault();
        columna.classList.remove('sigso-kanban__columna--sobre');
        if (!arrastrandoId_) return;
        var tipo = tipoCheckinParaColumna_(columna.getAttribute('data-columna'), arrastrandoEstado_);
        var id = arrastrandoId_;
        arrastrandoId_ = null;
        arrastrandoEstado_ = null;
        if (!tipo) return; // misma columna, o "Por hacer" como destino: no-op silencioso
        ejecutarCheckin_(id, tipo, alExito);
      });
    });
  }

  // --- Hitos --------------------------------------------------------------

  function pintarHitos_(detalle, puedeGestionar, tareas) {
    var acciones = puedeGestionar
      ? '<div class="sigso-py-cabecera">' + Componentes.boton({ texto: '+ Nuevo hito', clase: 'js-py-nuevo-hito' }) + '</div>'
      : '';
    if (!detalle.hitos || detalle.hitos.length === 0) {
      return acciones + Componentes.vacio({ texto: 'Todavía no hay hitos definidos.' });
    }
    // v13 (Fase 1, "unificar tareas e hitos"): agrupo las tareas por hito para
    // mostrar, dentro de cada hito, EXACTAMENTE qué tareas lo componen y su
    // estado. El avance del hito ya lo calcula el backend desde estas tareas.
    var tareasPorHito = {};
    (tareas || []).forEach(function (a) {
      if (a.hito_id) (tareasPorHito[a.hito_id] = tareasPorHito[a.hito_id] || []).push(a);
    });
    var ahora = new Date();
    var filas = detalle.hitos.map(function (h) {
      var pct = (h.avance_pct === null || h.avance_pct === undefined) ? null : h.avance_pct;
      var avance = pct === null ? '—' : pct + '%';
      var terminal = h.estado === 'COMPLETADO' || h.estado === 'CANCELADO';
      var vencido = !terminal && h.fecha_objetivo && new Date(h.fecha_objetivo) < ahora;
      var botones = puedeGestionar
        ? '<div class="sigso-py-hito__acciones">' +
            (!terminal ? Componentes.boton({ texto: '✓ Completar', variante: 'sutil', clase: 'js-py-hito-completar', idx: h.hito_id }) : '') +
            Componentes.boton({ texto: 'Editar', variante: 'sutil', clase: 'js-py-hito-editar', idx: h.hito_id }) +
            (h.total_tareas === 0 && h.estado !== 'CANCELADO' ? Componentes.boton({ texto: 'Eliminar', variante: 'sutil', clase: 'js-py-hito-eliminar', idx: h.hito_id }) : '') +
          '</div>'
        : '';
      // Barra de avance derivada de las tareas del hito.
      var barra = pct === null ? '' :
        '<div class="sigso-py-hito__barra" title="' + pct + '% de las tareas del hito terminadas">' +
          '<div class="sigso-py-hito__barra-fill" style="width:' + Math.min(pct, 100) + '%"></div>' +
        '</div>';
      // Lista plegable de las tareas que componen el hito.
      var lista = tareasPorHito[h.hito_id] || [];
      var tareasHtml = '';
      if (lista.length) {
        var items = lista.map(function (a) {
          var resp = a.responsable_nombre || a.responsable_email || '';
          var av = (a.avance_pct === null || a.avance_pct === undefined || a.avance_pct === '') ? '' : ' · ' + a.avance_pct + '%';
          return '<li class="sigso-py-hito-tarea">' +
            '<span class="sigso-badge sigso-mt-badge--' + (a.semaforo || 'al-dia') + '">' + Componentes.escaparHtml(a.semaforo_etiqueta || '') + '</span>' +
            '<span class="sigso-py-hito-tarea__tit">' + Componentes.escaparHtml(a.titulo) + '</span>' +
            '<span class="sigso-py-hito-tarea__meta">' + Componentes.escaparHtml(resp) + av + '</span>' +
          '</li>';
        }).join('');
        tareasHtml = '<details class="sigso-py-hito-tareas"' + (lista.length <= 6 ? ' open' : '') + '>' +
          '<summary>' + lista.length + ' tarea(s) en este hito</summary>' +
          '<ul class="sigso-py-hito-tarea-lista">' + items + '</ul>' +
        '</details>';
      } else {
        tareasHtml = '<p class="sigso-ayuda">Sin tareas asociadas todavía.</p>';
      }
      return '<div class="sigso-py-hito' + (vencido ? ' sigso-py-hito--vencido' : '') + '">' +
        '<div class="sigso-py-hito__top">' +
          '<span class="sigso-py-hito__nombre">' + Componentes.escaparHtml(h.nombre) + '</span>' +
          Componentes.badge(HITO_ESTADO_ETIQUETA[h.estado] || h.estado, 'neutro') +
        '</div>' +
        (h.descripcion ? '<p>' + Componentes.escaparHtml(h.descripcion) + '</p>' : '') +
        barra +
        '<p class="sigso-ayuda">' + h.total_tareas + ' tarea(s) · ' + avance + ' de avance' +
          (h.fecha_objetivo ? ' · vence ' + fechaCorta_(h.fecha_objetivo) : '') +
          (vencido ? ' · <b class="sigso-py-hito__vencido-tag">vencido</b>' : '') + '</p>' +
        tareasHtml +
        botones +
      '</div>';
    }).join('');
    // Tareas sin hito -- para que ninguna quede invisible en esta vista.
    var sinHito = (tareas || []).filter(function (a) { return !a.hito_id; });
    var sinHitoHtml = '';
    if (sinHito.length) {
      sinHitoHtml = '<div class="sigso-py-hito sigso-py-hito--sinhito">' +
        '<div class="sigso-py-hito__top"><span class="sigso-py-hito__nombre">Sin hito asignado</span>' +
          Componentes.badge(sinHito.length + ' tarea(s)', 'neutro') + '</div>' +
        '<p class="sigso-ayuda">Estas tareas no están vinculadas a ningún hito. Puedes asignarlas editando la tarea.</p>' +
      '</div>';
    }
    return acciones + '<div class="sigso-py-lista">' + filas + sinHitoHtml + '</div>';
  }

  // --- Cronograma: Plan vs. Dedicación (v10, Fases C y E) -------------------
  //
  // Dos lentes sobre la MISMA pestaña: "Plan" (Fase C, ya existía) muestra
  // la ventana comprometida de cada tarea -- lo que el cronograma de
  // siempre dice. "Dedicación" (Fase E, propuesta "Carta Gantt de
  // Dedicación") muestra, día por día, en qué se ocupó el recurso de
  // verdad -- releyendo la MISMA bitácora de check-ins que "Mi trabajo" ya
  // escribe, sin marcar nada a mano. La diferencia entre las dos vistas es
  // literalmente la propuesta.
  var vistaCronograma_ = 'dedicacion';

  function pintarCronograma_(detalle, tareas, bitacora, rendimiento, ctxEdicion) {
    var toggle = '<div class="sigso-py-vista-toggle" style="margin-bottom:var(--esp-3);">' +
        Componentes.boton({ texto: 'Dedicación', variante: vistaCronograma_ === 'dedicacion' ? undefined : 'sutil', clase: 'js-py-cron-vista', idx: 'dedicacion' }) +
        Componentes.boton({ texto: 'Plan', variante: vistaCronograma_ === 'plan' ? undefined : 'sutil', clase: 'js-py-cron-vista', idx: 'plan' }) +
        // v11 (P1, "historial visible"): 3ra vista -- un feed cronológico de
        // TODO lo que pasó en el proyecto (reprogramaciones, check-ins,
        // registros del día, entregas...), sin red nueva: reusa la MISMA
        // bitácora que ya cargó Dedicación.
        Componentes.boton({ texto: 'Historial', variante: vistaCronograma_ === 'historial' ? undefined : 'sutil', clase: 'js-py-cron-vista', idx: 'historial' }) +
        // v11 (P2, "vistas Workload y Actividad"): Workload como vista
        // propia (antes solo vivía como un checkbox "Por persona" dentro de
        // Dedicación) -- el foco acá es SOLO la carga por persona, sin las
        // marcas de tarea que ensucian la lectura de "quién está sobrecargado".
        // "Actividad" YA es Historial (arriba): un feed de qué pasó, no hace
        // falta una vista más para lo mismo.
        Componentes.boton({ texto: 'Workload', variante: vistaCronograma_ === 'workload' ? undefined : 'sutil', clase: 'js-py-cron-vista', idx: 'workload' }) +
        // v11 (P3, "analítica avanzada"): lead/cycle time, tiempo en
        // bloqueo/revisión, SPI -- se carga aparte (lazy, al elegir esta
        // vista) porque es la única subvista de Cronograma que pide un
        // endpoint propio (obtenerAnaliticaProyecto), distinto de
        // bitácora/rendimiento que ya cargaron las demás.
        Componentes.boton({ texto: 'Analítica', variante: vistaCronograma_ === 'analitica' ? undefined : 'sutil', clase: 'js-py-cron-vista', idx: 'analitica' }) +
      '</div>';
    var cuerpo;
    if (vistaCronograma_ === 'plan') cuerpo = pintarCronogramaPlan_(detalle, tareas, ctxEdicion);
    else if (vistaCronograma_ === 'historial') cuerpo = pintarHistorialProyecto_(tareas, bitacora || []);
    else if (vistaCronograma_ === 'workload') cuerpo = pintarWorkloadProyecto_(detalle, tareas, bitacora || []);
    else if (vistaCronograma_ === 'analitica') cuerpo = pintarAnaliticaProyecto_(datosDetalleActual_ && datosDetalleActual_.analitica, tareas);
    else cuerpo = pintarCronogramaDedicacion_(detalle, tareas, bitacora || [], rendimiento, ctxEdicion);
    return toggle + cuerpo;
  }

  // v11 (P1, "historial antes→después"): un feed reverso-cronológico de la
  // bitácora COMPLETA del proyecto (todas las tareas), con frase humana por
  // tipo -- "Fulano reprogramó 'Tarea X': 20/08 → 25/08 (motivo: ...)",
  // "Fulano registró el día 30/08 como Finalizado (5h)". Es SOLO lectura y
  // SOLO presentación: cero cálculo nuevo, mismos datos que ya trae
  // Dedicación (listarBitacoraProyecto), interpretados con más detalle.
  var HISTORIAL_ICONO_ = {
    CREADA: '＋', CHECKIN_AVANCE: '↗', CHECKIN_SIN_CAMBIO: '·', DESBLOQUEO: '🔓',
    BLOQUEO: '🔒', ENTREGA: '✓', VALIDACION: '👁', REPROGRAMACION: '📅',
    REASIGNACION: '👤', REGISTRO_DIA: '🗓'
  };
  function historialFraseHtml_(b, tituloTarea) {
    var quien = '<strong>' + Componentes.escaparHtml(b.autor_nombre || 'Alguien') + '</strong>';
    var tarea = '"' + Componentes.escaparHtml(tituloTarea || '(tarea eliminada)') + '"';
    switch (b.tipo) {
      case 'REPROGRAMACION':
        return quien + ' reprogramó ' + tarea + ': ' +
          '<span class="sigso-py-hist-cambio">' + fechaCorta_(b.fecha_anterior) + ' → ' + fechaCorta_(b.fecha_nueva) + '</span>' +
          (b.nota ? ' — motivo: ' + Componentes.escaparHtml(b.nota) : '');
      case 'REASIGNACION':
        return quien + ' reasignó ' + tarea + ': ' +
          '<span class="sigso-py-hist-cambio">' + Componentes.escaparHtml(b.responsable_anterior || '—') + ' → ' + Componentes.escaparHtml(b.responsable_nuevo || '—') + '</span>' +
          (b.nota ? ' — motivo: ' + Componentes.escaparHtml(b.nota) : '');
      case 'REGISTRO_DIA':
        return quien + ' registró el día ' + fechaCorta_(b.dia) + ' en ' + tarea + ' como ' +
          '<span class="sigso-py-hist-cambio">' + Componentes.escaparHtml(REGISTRO_DIA_ESTADO_LABEL_[b.estado_dia] || b.estado_dia) + '</span>' +
          (b.horas ? ' (' + redond1_(b.horas) + 'h)' : '') +
          (b.ediciones ? ' <span class="sigso-ayuda">· editado ' + b.ediciones + ' vez(ces)</span>' : '') +
          (b.nota ? ': ' + Componentes.escaparHtml(b.nota) : '');
      case 'BLOQUEO':
        return quien + ' bloqueó ' + tarea + (b.nota ? ': ' + Componentes.escaparHtml(b.nota) : '');
      case 'DESBLOQUEO':
        return quien + ' destrabó ' + tarea + (b.nota ? ': ' + Componentes.escaparHtml(b.nota) : '');
      case 'ENTREGA':
        return quien + ' entregó ' + tarea + (b.nota ? ': ' + Componentes.escaparHtml(b.nota) : '');
      case 'VALIDACION':
        return quien + ' revisó ' + tarea + (b.nota ? ': ' + Componentes.escaparHtml(b.nota) : '');
      case 'CREADA':
        return tarea + ' fue asignada' + (b.nota ? ': ' + Componentes.escaparHtml(b.nota) : '');
      default:
        return quien + ' actualizó ' + tarea + (b.nota ? ': ' + Componentes.escaparHtml(b.nota) : '') +
          (b.horas ? ' (' + redond1_(b.horas) + 'h)' : '');
    }
  }
  function pintarHistorialProyecto_(tareas, bitacora) {
    if (!bitacora.length) return Componentes.vacio({ texto: 'Todavía no hay historial que mostrar.' });
    var tituloPorTarea = {};
    tareas.forEach(function (a) { tituloPorTarea[a.actividad_id] = a.titulo; });
    var filas = bitacora.slice().sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); })
      .map(function (b) {
        return '<div class="sigso-py-hist-fila">' +
          '<span class="sigso-py-hist-icono">' + (HISTORIAL_ICONO_[b.tipo] || '•') + '</span>' +
          '<div class="sigso-py-hist-cuerpo">' +
            '<div class="sigso-py-hist-frase">' + historialFraseHtml_(b, tituloPorTarea[b.actividad_id]) + '</div>' +
            '<div class="sigso-py-hist-cuando">' + fechaHora_(b.timestamp) + '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    return '<div class="sigso-py-hist">' + filas + '</div>';
  }

  // v11 (P2, "vistas Workload y Actividad"): controles mínimos de la vista
  // Workload -- rango, navegación y estado, con los MISMOS ids/clases que
  // cartaControlesHtml_ (Dedicación) para que wireCartaControles_ de siempre
  // los cablee sin código nuevo. Sin "Por persona" (Workload YA está
  // agrupada por persona siempre) ni "Descargar/Imprimir" (el informe
  // configurable ya trae su propia sección de Carga de trabajo).
  function cartaControlesWorkloadHtml_(dias) {
    var esTodo = dedRango_ === 'todo';
    var desdeTxt = fechaCorta_(dias[0].clave), hastaTxt = fechaCorta_(dias[dias.length - 1].clave);
    var rangoSel = Componentes.campoSelect({ id: 'py-ded-rango', valor: dedRango_, placeholder: false, claseCampo: 'sigso-py-ded-ctrl',
      opciones: [{ valor: 'semana', texto: 'Semana' }, { valor: 'quincena', texto: '2 semanas' }, { valor: 'mes', texto: 'Mes' }, { valor: 'todo', texto: 'Todo el proyecto' }] });
    var filtroEstado = Componentes.campoSelect({ id: 'py-ded-estado', valor: dedFiltroEstado_, placeholder: 'Todos los estados', claseCampo: 'sigso-py-ded-ctrl',
      opciones: [{ valor: 'abiertas', texto: 'Solo abiertas' }, { valor: 'atrasadas', texto: 'Solo atrasadas' }] });
    var nav = esTodo ? '' :
      (Componentes.boton({ texto: '←', variante: 'sutil', clase: 'js-py-ded-atras', tipo: 'button' }) +
       Componentes.boton({ texto: '→', variante: 'sutil', clase: 'js-py-ded-adelante', tipo: 'button' }) +
       Componentes.boton({ texto: 'Hoy', variante: 'sutil', clase: 'js-py-ded-hoy', tipo: 'button' }));
    return '<div class="sigso-py-ded-controles">' +
      rangoSel + nav +
      '<span class="sigso-ayuda sigso-py-ded-rangotxt">' + Componentes.escaparHtml(desdeTxt) + ' – ' + Componentes.escaparHtml(hastaTxt) + '</span>' +
      filtroEstado +
    '</div>';
  }

  // v11 (P2, "vistas Workload y Actividad"): Workload como vista PROPIA --
  // antes solo existía como el checkbox "Por persona" dentro de Dedicación,
  // mezclado con las marcas de tarea. Acá el foco es SOLO la carga: cuántas
  // horas tiene cada persona cada día (misma prioridad REGISTRO_DIA>check-in
  // de siempre) y quién está sobrecargado, con KPIs de resumen arriba.
  function pintarWorkloadProyecto_(detalle, tareas, bitacora) {
    if (!tareas.length) return Componentes.vacio({ texto: 'Todavía no hay tareas para mostrar la carga de trabajo.' });
    if (!dedicacionAncla_) dedicacionAncla_ = new Date();
    var feriadosSet = {};
    ((detalle && detalle.feriados) || []).forEach(function (f) { feriadosSet[f] = true; });
    var hoyClave = claveHoy_();
    var dias = construirDiasCarta_(detalle, tareas, bitacora, feriadosSet, hoyClave);
    var controles = cartaControlesWorkloadHtml_(dias);

    // Mismo filtro de estado que Dedicación (comparte el módulo dedFiltroEstado_);
    // sin filtro de persona propio -- acá se ve a TODOS a la vez, es justo el
    // punto de esta vista (comparar cargas entre personas).
    var filas = tareas.filter(function (a) {
      if (dedFiltroEstado_ === 'abiertas' && (a.estado === 'TERMINADA' || a.estado === 'CANCELADA')) return false;
      if (dedFiltroEstado_ === 'atrasadas' && a.semaforo !== 'atrasada') return false;
      return true;
    });
    if (!filas.length) return controles + Componentes.vacio({ texto: 'Ninguna tarea coincide con el filtro en esta ventana.' });

    var registroPorTareaDia = {}, horasPorTareaDia = {};
    bitacora.forEach(function (b) {
      var k = (b.tipo === 'REGISTRO_DIA' && b.dia) ? b.dia : claveDeIso_(b.timestamp);
      if (!k) return;
      if (b.tipo === 'REGISTRO_DIA') {
        (registroPorTareaDia[b.actividad_id] = registroPorTareaDia[b.actividad_id] || {})[k] = b;
      } else if (b.horas) {
        var hh = (horasPorTareaDia[b.actividad_id] = horasPorTareaDia[b.actividad_id] || {});
        hh[k] = (hh[k] || 0) + Number(b.horas);
      }
    });
    function horasDelDiaTarea_(actividadId, diaClave) {
      var reg = (registroPorTareaDia[actividadId] || {})[diaClave];
      if (reg) return Number(reg.horas) || 0;
      return (horasPorTareaDia[actividadId] || {})[diaClave] || 0;
    }

    var porPersona = {}, orden = [];
    filas.forEach(function (a) {
      var clave = a.responsable_nombre || a.responsable_email || '—';
      if (!porPersona[clave]) { porPersona[clave] = []; orden.push(clave); }
      porPersona[clave].push(a);
    });

    var headDias = dias.map(diaCabeceraHtml_).join('');
    var totalPorDia = {};
    dias.forEach(function (x) { totalPorDia[x.clave] = 0; });
    var granTotal = 0, diasSobrecarga = 0, maxPersona = null, maxHoras = 0;

    var filasHtml = orden.map(function (persona) {
      var totalPersona = 0, sobrecargaPersona = 0;
      var celdas = dias.map(function (x) {
        var total = porPersona[persona].reduce(function (s, a) { return s + horasDelDiaTarea_(a.actividad_id, x.clave); }, 0);
        totalPersona += total; totalPorDia[x.clave] += total;
        var sobrecarga = total > WORKLOAD_JORNADA_HORAS_;
        if (sobrecarga) sobrecargaPersona++;
        var nivel = nivelHoras_(total);
        var tituloCelda = total
          ? (persona + ' — ' + fechaCorta_(x.clave) + ': ' + redond1_(total) + 'h' + (sobrecarga ? ' (sobrecarga)' : ''))
          : '';
        return '<div class="sigso-py-ded-celda sigso-py-ded-celda--workload' + (x.we ? ' we' : '') + (x.feriado ? ' feriado' : '') + (x.clave === hoyClave ? ' hoy' : '') +
          (nivel ? ' h' + nivel : '') + (sobrecarga ? ' sigso-py-ded-celda--sobrecarga' : '') + '"' +
          (tituloCelda ? ' title="' + Componentes.escaparHtml(tituloCelda) + '"' : '') + '>' + (total ? '<span>' + redond1_(total) + '</span>' : '') + '</div>';
      }).join('');
      granTotal += totalPersona;
      diasSobrecarga += sobrecargaPersona;
      if (totalPersona > maxHoras) { maxHoras = totalPersona; maxPersona = persona; }
      return '<div class="sigso-py-ded-fila">' +
        '<div class="sigso-py-ded-etiqueta"><span class="t">' + Componentes.escaparHtml(persona) + '</span>' +
          '<span class="m">' + porPersona[persona].length + ' tarea(s)' + (sobrecargaPersona ? ' · ' + sobrecargaPersona + ' día(s) con sobrecarga' : '') + '</span></div>' +
        celdas +
        '<div class="sigso-py-ded-total">' + (totalPersona ? redond1_(totalPersona) + 'h' : '') + '</div>' +
      '</div>';
    }).join('');

    var footerCeldas = dias.map(function (x) {
      var h = totalPorDia[x.clave];
      return '<div class="sigso-py-ded-celda sigso-py-ded-celda--total' + (x.we ? ' we' : '') + (x.feriado ? ' feriado' : '') + '">' +
        (h ? '<span>' + redond1_(h) + '</span>' : '') + '</div>';
    }).join('');
    var footer = '<div class="sigso-py-ded-fila sigso-py-ded-footer">' +
      '<div class="sigso-py-ded-etiqueta"><span class="t">Horas por día</span></div>' +
      footerCeldas + '<div class="sigso-py-ded-total">' + (granTotal ? redond1_(granTotal) + 'h' : '') + '</div></div>';

    var promedioPersonaDia = (orden.length && dias.length) ? redond1_(granTotal / (orden.length * dias.length)) : 0;
    var kpis = '<div class="sigso-py-kpis">' +
      Componentes.kpi({ etiqueta: 'Horas del período', valor: redond1_(granTotal) + 'h' }) +
      Componentes.kpi({ etiqueta: 'Promedio por persona/día', valor: promedioPersonaDia + 'h' }) +
      Componentes.kpi({ etiqueta: 'Días con sobrecarga', valor: diasSobrecarga, alerta: diasSobrecarga > 0 }) +
      (maxPersona ? Componentes.kpi({ etiqueta: 'Mayor carga', valor: Componentes.escaparHtml(maxPersona) + ' (' + redond1_(maxHoras) + 'h)' }) : '') +
    '</div>';

    return kpis + controles +
      '<div class="sigso-py-ded-scroll"><div class="sigso-py-ded" style="--dias:' + dias.length + '">' +
        '<div class="sigso-py-ded-fila sigso-py-ded-cabecera"><div class="sigso-py-ded-etiqueta">Persona</div>' + headDias +
          '<div class="sigso-py-ded-total">Horas</div></div>' +
        filasHtml +
        footer +
      '</div></div>' +
      '<div class="sigso-py-ded-leyenda"><span><i class="sigso-py-ded-sw sigso-py-ded-sw--bloq"></i>Sobrecarga: más de ' + WORKLOAD_JORNADA_HORAS_ + 'h en un día</span>' +
        '<span class="sigso-py-ded-heatleg">Horas del día: <i class="hl h1"></i><i class="hl h2"></i><i class="hl h3"></i><i class="hl h4"></i> más</span></div>';
  }

  // v11 (P3, "analítica avanzada"): se dispara al elegir la vista -- si ya
  // está en caché, solo repinta (sin red); si no, pide obtenerAnaliticaProyecto
  // una vez y la deja en datosDetalleActual_.analitica (mismo criterio de
  // "cargar pesado solo si de verdad se abre" que bitácora/rendimiento).
  // Proyecto cuya analitica se esta pidiendo ahora mismo. Evita disparar
  // dos veces la misma peticion cuando el cargador de la pestaña y el
  // cambio de sub-vista coinciden.
  var analiticaEnVuelo_ = null;

  // PIDE la analitica y la deja en cache. NO repinta: quien llama decide.
  // Separar pedir de repintar es lo que permite llamarla tambien desde
  // cargarDatosCronograma_ sin entrar en recursion (repintar vuelve a
  // entrar al cargador).
  function pedirAnaliticaProyecto_() {
    if (!datosDetalleActual_) return;
    if (datosDetalleActual_.analitica !== undefined) return;   // ya esta
    if (analiticaEnVuelo_ === proyectoActivoId_) return;       // ya se pidio
    analiticaEnVuelo_ = proyectoActivoId_;
    var idAlPedir = proyectoActivoId_;
    apiSeguro_('obtenerAnaliticaProyecto', { proyecto_id: proyectoActivoId_ }).then(function (r) {
      if (analiticaEnVuelo_ === idAlPedir) analiticaEnVuelo_ = null;
      if (!datosDetalleActual_ || idAlPedir !== proyectoActivoId_) return;
      // null (no undefined) para que pintarAnaliticaProyecto_ muestre el
      // estado de error en vez de seguir en "Cargando..." para siempre.
      datosDetalleActual_.analitica = (r && r.ok) ? r.data : null;
      if (pestanaActiva_ === 'cronograma' && vistaCronograma_ === 'analitica') cambiarPestana_('cronograma');
    });
  }

  function cargarAnaliticaProyecto_(cont) {
    if (!datosDetalleActual_) return;
    cambiarPestana_('cronograma'); // repinta ya: cache si la hay, spinner si no
    pedirAnaliticaProyecto_();
  }

  // v11 (P3, "SPI conceptual" en pantalla): tooltips explican qué es cada
  // métrica en una frase -- "explicable, no una metodología completa" aplica
  // también a cómo se presenta, no solo a cómo se calcula.
  // Las tareas que tienen ALGO que mostrar. Una sola definicion para la
  // tabla y para el CSV: si divergen, se descarga algo distinto de lo que
  // se ve, que es justo lo que pasaba.
  function tareasConDatoAnalitica_(analitica) {
    return ((analitica && analitica.por_tarea) || []).filter(function (t) {
      return t.lead_time_dias !== null || t.cycle_time_dias !== null ||
        t.tiempo_bloqueo_dias > 0 || t.tiempo_revision_dias > 0;
    });
  }

  function pintarAnaliticaProyecto_(analitica, tareas) {
    if (analitica === undefined) return Componentes.cargando('Cargando analítica...');
    if (!analitica) return Componentes.vacio({ texto: 'No se pudo cargar la analítica de este proyecto.' });

    var kpis = '<div class="sigso-py-kpis">' +
      Componentes.kpi({
        etiqueta: 'Lead time promedio', valor: analitica.lead_time_promedio_dias === null ? '—' : analitica.lead_time_promedio_dias + ' d',
        titulo: 'Desde que se creó la tarea hasta que se terminó (incluye la espera antes de empezar). Solo tareas terminadas.'
      }) +
      Componentes.kpi({
        etiqueta: 'Cycle time promedio', valor: analitica.cycle_time_promedio_dias === null ? '—' : analitica.cycle_time_promedio_dias + ' d',
        titulo: 'Desde el primer avance real hasta que se terminó (sin la espera). Solo tareas terminadas con al menos un avance registrado.'
      }) +
      Componentes.kpi({
        etiqueta: 'Tiempo en bloqueo', valor: analitica.tiempo_bloqueo_total_dias + ' d', alerta: analitica.tiempo_bloqueo_total_dias > 0,
        titulo: 'Suma de todos los días que las tareas del proyecto pasaron bloqueadas.'
      }) +
      Componentes.kpi({
        etiqueta: 'Tiempo en revisión', valor: analitica.tiempo_revision_total_dias + ' d',
        titulo: 'Suma de todos los días que las tareas pasaron esperando validación.'
      }) +
      (analitica.spi_promedio !== null
        ? Componentes.kpi({
            etiqueta: 'SPI promedio', valor: analitica.spi_promedio, alerta: analitica.spi_promedio < 1,
            titulo: 'Avance real ÷ avance esperado a hoy. 1.0 = a tiempo, menos de 1 = atrasado, más de 1 = adelantado. Conceptual: no es una implementación completa de EVM (no incluye costo/CPI).'
          })
        : '') +
    '</div>';

    var conDato = tareasConDatoAnalitica_(analitica);
    if (!conDato.length) {
      return kpis + Componentes.vacio({ texto: 'Todavía no hay tareas terminadas, bloqueadas o en revisión para desglosar.' });
    }
    var filas = conDato.map(function (t) {
      return '<tr>' +
        '<td>' + Componentes.escaparHtml(t.titulo) + '</td>' +
        '<td>' + (t.lead_time_dias === null ? '—' : t.lead_time_dias + ' d') + '</td>' +
        '<td>' + (t.cycle_time_dias === null ? '—' : t.cycle_time_dias + ' d') + '</td>' +
        '<td>' + (t.tiempo_bloqueo_dias > 0 ? t.tiempo_bloqueo_dias + ' d' : '—') + '</td>' +
        '<td>' + (t.tiempo_revision_dias > 0 ? t.tiempo_revision_dias + ' d' : '—') + '</td>' +
      '</tr>';
    }).join('');
    return kpis +
      '<div class="sigso-py-analitica-acciones">' +
        Componentes.boton({ texto: 'Exportar CSV', variante: 'secundario', clase: 'js-py-analitica-csv', tipo: 'button', icono: 'descargar' }) +
      '</div>' +
      '<div class="sigso-py-ded-scroll"><table class="sigso-py-analitica-tabla">' +
        '<thead><tr><th>Tarea</th><th>Lead time</th><th>Cycle time</th><th>Bloqueo</th><th>Revisión</th></tr></thead>' +
        '<tbody>' + filas + '</tbody>' +
      '</table></div>';
  }

  // v11 (Reingeniería Cronograma, P0): el ESTADO DEL DÍA explícito -- lo que
  // el usuario elige en la celda diaria (distinto del estado de la tarea
  // completa). Cada estado tiene su clase visual (reusa las del heatmap donde
  // calza y agrega las nuevas: plan/pausa/rev/esp) y su marca corta en la
  // celda. SIGSO no es vigilancia: "sin registro" NO es un estado -- una
  // celda vacía significa "SIGSO no tiene registro de ese día", nunca "no se
  // trabajó".
  var REGISTRO_DIA_ESTADO_VIS_ = {
    asignado:          { cls: 'asig', txt: 'A' },
    planificado:       { cls: 'plan', txt: 'P' },
    en_proceso:        { cls: 'proc', txt: '●' },
    bloqueado:         { cls: 'bloq', txt: '!' },
    pausado:           { cls: 'pausa', txt: '‖' },
    finalizado:        { cls: 'done', txt: '✓' },
    entregado:         { cls: 'done', txt: 'F' },
    revision:          { cls: 'rev', txt: 'R' },
    esperando_tercero: { cls: 'esp', txt: '…' }
  };
  var REGISTRO_DIA_ESTADO_LABEL_ = {
    asignado: 'Asignado', planificado: 'Planificado', en_proceso: 'En proceso',
    bloqueado: 'Bloqueado', pausado: 'En pausa', finalizado: 'Finalizado',
    entregado: 'Entregado', revision: 'En revisión', esperando_tercero: 'Esperando a un tercero'
  };
  var REGISTRO_DIA_ESTADO_ORDEN_ = [
    'asignado', 'planificado', 'en_proceso', 'bloqueado', 'pausado',
    'finalizado', 'entregado', 'revision', 'esperando_tercero'
  ];

  // v11 (P0): ¿esta persona trabaja la tarea? (responsable o colaborador) --
  // espejo de trabajaLaActividad_ del backend, para decidir qué celdas son
  // editables sin un viaje de red.
  function trabajoLaTarea_(a, miEmail) {
    if (!miEmail) return false;
    if (normalizarEmail_(a.responsable_email) === miEmail) return true;
    return (a.colaboradores || []).some(function (c) { return normalizarEmail_(c.email) === miEmail; });
  }

  // v11 (P0): referencias que el manejador de clic de la celda usa para abrir
  // el modal y refrescar tras guardar -- se fijan en cada pintado de la carta.
  var cartaBitacoraActual_ = [];
  var cartaTareasActual_ = [];
  var cartaOnGuardarRegistro_ = null;

  // v10 (Fase E, "Carta Gantt de Dedicación"): traduce el `tipo` que
  // Actividades.checkin YA escribe en la bitácora a la letra de siempre --
  // A/P/F, más "bloqueada" y "esperando a un tercero". Es un mapa de
  // presentación (igual que TIPO_EVENTO_ETIQUETA o HITO_ESTADO_ETIQUETA),
  // no una regla de negocio nueva: el enum de `tipo` es fijo y ya está
  // documentado en Actividades.gs (checkin).
  var DEDICACION_TIPO_ESTADO_ = {
    CHECKIN_AVANCE: 'proc', CHECKIN_SIN_CAMBIO: 'proc', DESBLOQUEO: 'proc',
    BLOQUEO: 'bloq', ENTREGA: 'done'
  };
  var DEDICACION_TIPO_ETIQUETA_ = {
    CREADA: 'Tarea asignada', CHECKIN_AVANCE: 'Avanzó', CHECKIN_SIN_CAMBIO: 'Sin cambios',
    DESBLOQUEO: 'Se destrabó', BLOQUEO: 'Bloqueado', ENTREGA: 'Entregó', VALIDACION: 'Revisión'
  };
  // Ancla = ULTIMO dia visible de la ventana (14 dias, movible). Modulo, no
  // por proyecto -- mismo criterio que pestanaActiva_: al cambiar de
  // proyecto se mantiene donde el usuario la dejo, no es una sorpresa
  // nueva de este archivo.
  var dedicacionAncla_ = null;
  var DEDICACION_DIAS_VENTANA = 14;
  // v10 (auditoría G, carta de dedicación pro): controles de la carta.
  // rango: cuántos días muestra ('todo' = todo el proyecto). agrupar: filas
  // por persona. filtroPersona/filtroEstado: acotan qué tareas se ven.
  var dedRango_ = 'quincena';       // semana | quincena | mes | todo
  var DED_RANGO_DIAS = { semana: 7, quincena: 14, mes: 30 };
  var dedAgruparPersona_ = false;
  var dedFiltroPersona_ = '';
  var dedFiltroEstado_ = '';        // '' | abiertas | atrasadas
  // Heatmap: horas de un día -> nivel de intensidad (1..4). Cortes absolutos
  // sobre una jornada ~8h: cuarto / medio / casi todo / día completo o más.
  function nivelHoras_(horas) {
    if (!horas || horas <= 0) return 0;
    if (horas <= 2) return 1;
    if (horas <= 4) return 2;
    if (horas <= 6) return 3;
    return 4;
  }

  // v11 (P1, "workload / sobrecarga"): jornada de referencia para marcar un
  // día sobrecargado -- 9h, la MISMA convención que ya usa el resto de SIGSO
  // para "un día de trabajo" (ver CUMPLIMIENTO_HORAS_JORNADA en el backend,
  // Cumplimiento.gs), no un número nuevo inventado para esta vista.
  var WORKLOAD_JORNADA_HORAS_ = 9;

  // v11 (P1, "Plan · Esperado · Real"): línea compacta bajo el título de la
  // tarea en la carta de Dedicación -- Plan (fechas vigentes), Base (solo si
  // difiere del plan actual: señal de que hubo slippage desde que se
  // congeló), Esperado/Real a hoy, y la desviación en puntos porcentuales
  // (verde a favor, rojo en contra). Nada se muestra sin fecha_compromiso
  // confirmada -- RN-710 (pendiente de confirmar) no tiene curva que trazar.
  // v12.3 ("rediseño"): Plan · Esperado · Real dejan de ser una línea de texto
  // apretada y pasan a CHIPS -- más legibles y modernos; la desviación va como
  // pill de color (verde a favor / rojo en contra).
  function planLineaHtml_(plan) {
    if (!plan || !plan.plan_fin) return '';
    var chips = ['<span class="sigso-py-plan-chip">Plan ' + fechaCorta_(plan.plan_inicio) + '–' + fechaCorta_(plan.plan_fin) + '</span>'];
    if (plan.baseline_fin && plan.baseline_fin !== plan.plan_fin) {
      chips.push('<span class="sigso-py-plan-chip sigso-py-plan-chip--base">Base ' + fechaCorta_(plan.baseline_fin) + '</span>');
    }
    if (plan.avance_esperado_pct !== null && plan.avance_esperado_pct !== undefined) {
      chips.push('<span class="sigso-py-plan-chip">Esp ' + redond1_(plan.avance_esperado_pct) + '%</span>');
    }
    if (plan.avance_real_pct !== null && plan.avance_real_pct !== undefined) {
      chips.push('<span class="sigso-py-plan-chip">Real ' + redond1_(plan.avance_real_pct) + '%</span>');
    }
    if (plan.desviacion_pp !== null && plan.desviacion_pp !== undefined) {
      var aFavor = plan.desviacion_pp >= 0;
      chips.push('<span class="sigso-py-plan-chip sigso-py-plan-chip--dev ' + (aFavor ? 'is-favor' : 'is-contra') + '">' +
        (aFavor ? '+' : '') + redond1_(plan.desviacion_pp) + 'pp</span>');
    }
    return '<span class="sigso-py-ded-plan">' + chips.join('') + '</span>';
  }

  // v10 (auditoría G): cablea TODOS los controles de la carta (rango,
  // agrupar, filtros, imprimir) además de la navegación de ventana. Se usa
  // igual en el Cronograma de un proyecto y en "Mi dedicación" -- solo
  // cambian `alRepintar` y el `detalle` (para el título del reporte).
  function wireCartaControles_(cont, alRepintar, detalle, alGuardarRegistro) {
    wireDedicacionNav_(cont, alRepintar);
    var rango = cont.querySelector('#py-ded-rango');
    if (rango) rango.addEventListener('change', function () { dedRango_ = rango.value; alRepintar(); });
    var agr = cont.querySelector('.js-py-ded-agrupar');
    if (agr) agr.addEventListener('change', function () { dedAgruparPersona_ = agr.checked; alRepintar(); });
    var per = cont.querySelector('#py-ded-persona');
    if (per) per.addEventListener('change', function () { dedFiltroPersona_ = per.value; alRepintar(); });
    var est = cont.querySelector('#py-ded-estado');
    if (est) est.addEventListener('change', function () { dedFiltroEstado_ = est.value; alRepintar(); });
    var imp = cont.querySelector('.js-py-ded-imprimir');
    if (imp) imp.addEventListener('click', function () {
      // v12 ("reporte PDF potenciado"): en el Cronograma de UN proyecto el
      // botón baja el PDF ejecutivo real del backend (no imprime la pantalla).
      // "Mi dedicación" (sin proyecto único) conserva la impresión de la carta.
      if (detalle && detalle.proyecto && detalle.proyecto.proyecto_id) descargarReporteCronograma_(imp, detalle);
      else imprimirCartaDedicacion_(cont, detalle);
    });

    // v11 (P1, "congelar línea base"): solo existe en el Cronograma de UN
    // proyecto (Mi dedicación no la ofrece -- ver cartaControlesHtml_). Solo
    // afecta la baseline/plan_seguimiento, que viajan junto a la bitácora:
    // basta con la MISMA invalidación que ya usa el registro del día.
    var basBtn = cont.querySelector('.js-py-ded-baseline');
    if (basBtn) {
      basBtn.addEventListener('click', function () {
        var proyectoId = detalle && detalle.proyecto && detalle.proyecto.proyecto_id;
        if (!proyectoId) return;
        Componentes.confirmar({
          titulo: 'Congelar línea base',
          mensaje: 'Guarda una foto de las fechas de plan de hoy, para comparar el avance contra ella más adelante. No borra la anterior.',
          confirmar: 'Congelar'
        }).then(function (ok) {
          if (!ok) return;
          basBtn.disabled = true;
          apiSeguro_('congelarBaselineProyecto', { proyecto_id: proyectoId }).then(function (r) {
            basBtn.disabled = false;
            if (!r || !r.ok) { Componentes.aviso({ texto: (r && r.message) || 'No se pudo congelar la línea base.', tipo: 'error' }); return; }
            Componentes.aviso({ texto: 'Línea base congelada (' + r.data.total_tareas + ' tarea[s]).', tipo: 'exito' });
            if (alGuardarRegistro) alGuardarRegistro();
          });
        });
      });
    }

    // v11 (P1, "historial de fecha"): reprogramar cambia fecha_compromiso en
    // ACTIVIDADES -- para que la tarea quede al día en TODAS las pestañas
    // (Tareas, Kanban, Hitos), no solo en la carta, se recarga el proyecto
    // completo (mismo patrón que cualquier otro modal de edición del
    // módulo). En "Mi dedicación" (sin un único proyecto abierto) se hace el
    // repintado liviano de siempre.
    var scrollReprog = cont.querySelector('.sigso-py-ded-scroll');
    if (scrollReprog) {
      scrollReprog.addEventListener('click', function (ev) {
        var btn = ev.target.closest('.js-py-ded-reprogramar');
        if (btn) abrirReprogramarDesdeBoton_(btn, detalle, alGuardarRegistro);
      });
    }

    // v11 (P0): la celda diaria como unidad editable -- clic (o Enter/Espacio)
    // abre el modal de registro del día. Delegación sobre el contenedor: las
    // celdas se re-crean en cada repintado, un solo listener las cubre todas.
    cartaOnGuardarRegistro_ = alGuardarRegistro || null;
    var scroll = cont.querySelector('.sigso-py-ded-scroll');
    if (scroll) {
      scroll.addEventListener('click', function (ev) {
        var celda = ev.target.closest('.sigso-py-ded-celda--edit');
        if (celda) abrirRegistroDiaDesdeCelda_(celda);
      });
      scroll.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        var celda = ev.target.closest && ev.target.closest('.sigso-py-ded-celda--edit');
        if (celda) { ev.preventDefault(); abrirRegistroDiaDesdeCelda_(celda); }
      });
    }
  }

  // v11 (P1, "historial de fecha"): abre el modal de reprogramar a partir
  // del botón 📅 de una fila de la carta.
  function abrirReprogramarDesdeBoton_(btn, detalle, alGuardarRegistro) {
    var proyId = btn.getAttribute('data-proy');
    var actId = btn.getAttribute('data-act');
    if (!proyId || !actId) return;
    var tarea = tareaPorIdEnCarta_(actId);
    abrirReprogramarTarea_(proyId, tarea, function () {
      if (detalle) refrescarDetalle_();
      else if (alGuardarRegistro) alGuardarRegistro();
    });
  }

  // v11 (P1): modal de reprogramar -- fecha nueva + motivo obligatorio
  // (RN-703). Reusa el mismo par enviarModal_/montarModal_ de siempre.
  // v11 (P2, "drag & drop de fechas"): `fechaSugerida` ('YYYY-MM-DD') es
  // opcional -- la usa el arrastre del Gantt navegable para prellenar con la
  // fecha que resultó de soltar la barra ahí; sin ella (el botón 📅 de
  // siempre), se prellena con la fecha_compromiso actual de la tarea. En
  // ambos casos el motivo sigue siendo obligatorio -- arrastrar NUNCA
  // reprograma en silencio.
  function abrirReprogramarTarea_(proyectoId, tarea, alExito, fechaSugerida) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Reprogramar</h3>' +
        '<p class="sigso-py-reg-cab"><strong>' + Componentes.escaparHtml((tarea && tarea.titulo) || 'Tarea') + '</strong>' +
          (tarea && tarea.fecha_compromiso ? '<br><span class="sigso-ayuda">Fecha actual: ' + Componentes.escaparHtml(fechaCorta_(tarea.fecha_compromiso)) + '</span>' : '') + '</p>' +
        '<form id="form-py-reprogramar">' +
          Componentes.campoTexto({ id: 'py-repro-fecha', label: 'Nueva fecha de compromiso', tipo: 'date', valor: fechaSugerida || fechaISOCorta_(tarea && tarea.fecha_compromiso), requerido: true }) +
          Componentes.campoTextarea({ id: 'py-repro-motivo', label: 'Motivo (obligatorio)', requerido: true }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-py-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Reprogramar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    fondo.querySelector('#form-py-reprogramar').addEventListener('submit', function (evento) {
      enviarModal_(evento, 'reprogramarTareaProyecto', {
        proyecto_id: proyectoId,
        actividad_id: tarea && tarea.actividad_id,
        fecha_compromiso: fondo.querySelector('#py-repro-fecha').value,
        motivo: fondo.querySelector('#py-repro-motivo').value
      }, function () {
        cerrar();
        Componentes.aviso({ texto: 'Tarea reprogramada.', tipo: 'exito' });
        if (typeof alExito === 'function') alExito();
      });
    });
  }

  // v11 ("PDF ejecutivo configurable"): las secciones disponibles, en el
  // MISMO orden fijo del backend (REPORTE_SECCIONES_DISPONIBLES_,
  // Proyectos.gs) -- lo que cambia es cuáles vienen marcadas por defecto:
  // exactamente las del reporte clásico de "Descargar PDF" de siempre, para
  // que abrir este modal sin tocar nada produzca el mismo documento de
  // siempre y las secciones nuevas (portada/salud/desviaciones/gantt/
  // workload/leyenda) se sumen a propósito.
  var SECCIONES_INFORME_ = [
    { valor: 'portada', texto: 'Portada' },
    // v13 (Fase 3, "reporte ejecutivo -- prioridad máxima"): las dos piezas
    // nuevas van marcadas por defecto -- son justamente lo que responde la
    // "prueba de los 60 segundos" del encargo, antes de cualquier tabla.
    { valor: 'narrativa', texto: 'Resumen ejecutivo (narrativo)', defecto: true },
    { valor: 'ficha', texto: 'Ficha resumen', defecto: true },
    { valor: 'kpis', texto: 'Indicadores clave (KPIs)', defecto: true },
    { valor: 'salud', texto: 'Salud detallada (score y desglose)' },
    { valor: 'mini_gantt', texto: 'Plan semana a semana (mini Gantt)', defecto: true },
    { valor: 'hitos', texto: 'Hitos', defecto: true },
    { valor: 'riesgos', texto: 'Riesgos abiertos', defecto: true },
    { valor: 'vencimientos', texto: 'Próximos vencimientos', defecto: true },
    { valor: 'rendimiento', texto: 'Rendimiento', defecto: true },
    { valor: 'desviaciones', texto: 'Plan · Esperado · Real' },
    { valor: 'gantt', texto: 'Carta Gantt (día × tarea)' },
    { valor: 'workload', texto: 'Carga de trabajo por persona' },
    { valor: 'bitacora', texto: 'Actividad reciente / bitácora', defecto: true },
    { valor: 'leyenda', texto: 'Leyenda' }
  ];

  // v11 ("Configurar informe"): secciones + rango + personas + estado. El
  // PDF resultante llega igual que "Descargar PDF" (base64 -> Blob), solo
  // que con `config` viajando en el payload -- Proyectos.descargarReporte
  // (Proyectos.gs) arma el documento a medida cuando `config` está presente,
  // y el reporte clásico (sin config) queda intacto para quien no abre esto.
  function abrirConfigurarInforme_(detalle) {
    var personas = (detalle.integrantes || []).map(function (i) {
      return { email: i.usuario_email, nombre: i.usuario_nombre || i.usuario_email };
    });
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Configurar informe</h3>' +
        '<p class="sigso-ayuda">Elige qué incluir. El PDF se genera al momento, con los datos de ahora.</p>' +
        '<form id="form-py-informe">' +
          '<div class="sigso-py-informe-secciones">' +
            SECCIONES_INFORME_.map(function (s) {
              return '<label class="sigso-campo-check"><input type="checkbox" class="js-py-informe-seccion" value="' + s.valor + '"' +
                (s.defecto ? ' checked' : '') + '> ' + Componentes.escaparHtml(s.texto) + '</label>';
            }).join('') +
          '</div>' +
          '<div class="sigso-py-form-fila">' +
            Componentes.campoTexto({ id: 'py-informe-desde', label: 'Desde (opcional)', tipo: 'date' }) +
            Componentes.campoTexto({ id: 'py-informe-hasta', label: 'Hasta (opcional)', tipo: 'date' }) +
          '</div>' +
          '<p class="sigso-ayuda">El rango solo acota Gantt / Carga de trabajo / bitácora. Vacío = todo el proyecto.</p>' +
          Componentes.campoSelect({
            id: 'py-informe-estado', label: 'Estado de las tareas', valor: '', placeholder: 'Todos los estados',
            opciones: [{ valor: 'abiertas', texto: 'Solo abiertas' }, { valor: 'atrasadas', texto: 'Solo atrasadas' }]
          }) +
          (personas.length
            ? '<details class="sigso-py-colab-opcional" open>' +
                '<summary>Personas (opcional -- vacío = todas)</summary>' +
                personas.map(function (p) {
                  return '<label class="sigso-campo-check"><input type="checkbox" class="js-py-informe-persona" value="' +
                    Componentes.escaparHtml(p.email) + '"> ' + Componentes.escaparHtml(p.nombre) + '</label>';
                }).join('') +
              '</details>'
            : '') +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-py-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Generar PDF', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    fondo.querySelector('#form-py-informe').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var btn = evento.currentTarget.querySelector('button[type="submit"]');
      if (btn.disabled) return; // a prueba de doble-clic, mismo criterio que enviarModal_
      var secciones = Array.prototype.map.call(fondo.querySelectorAll('.js-py-informe-seccion:checked'), function (el) { return el.value; });
      var desde = fondo.querySelector('#py-informe-desde').value;
      var hasta = fondo.querySelector('#py-informe-hasta').value;
      var personasSel = Array.prototype.map.call(fondo.querySelectorAll('.js-py-informe-persona:checked'), function (el) { return el.value; });
      var config = {
        secciones: secciones,
        estado: fondo.querySelector('#py-informe-estado').value,
        personas: personasSel
      };
      if (desde && hasta) config.rango = { desde: desde, hasta: hasta };

      var textoOriginal = btn.textContent;
      btn.disabled = true;
      btn.innerHTML = '<span class="sigso-spinner"></span>Generando…';
      apiSeguro_('descargarReporteProyecto', { proyecto_id: detalle.proyecto.proyecto_id, config: config }).then(function (r) {
        btn.disabled = false;
        btn.textContent = textoOriginal;
        if (!r || !r.ok) { Componentes.aviso({ texto: (r && r.message) || 'No se pudo generar el reporte.', tipo: 'error' }); return; }
        descargarBase64Proyecto_(r.data.pdf_base64, r.data.filename || ('Reporte-' + detalle.proyecto.proyecto_id + '.pdf'), 'application/pdf');
        cerrar();
      });
    });
  }

  // v11 (P0): abre el modal de registro del día a partir de una celda de la
  // carta -- resuelve el registro existente (si lo hay) desde la bitácora en
  // memoria y la tarea desde la caché actual.
  function abrirRegistroDiaDesdeCelda_(celda) {
    var proyId = celda.getAttribute('data-proy');
    var actId = celda.getAttribute('data-act');
    var dia = celda.getAttribute('data-dia');
    if (!proyId || !actId || !dia) return;
    var registro = (cartaBitacoraActual_ || []).filter(function (b) {
      return b.tipo === 'REGISTRO_DIA' && b.actividad_id === actId && b.dia === dia;
    })[0] || null;
    var tarea = tareaPorIdEnCarta_(actId);
    abrirRegistroDia_(proyId, tarea, dia, registro, cartaOnGuardarRegistro_);
  }

  // Busca la tarea por id entre las que la carta está mostrando ahora -- solo
  // para el título del encabezado del modal (sirve igual en el Cronograma de
  // un proyecto y en "Mi dedicación", que fija esta lista en cada pintado).
  function tareaPorIdEnCarta_(actId) {
    return (cartaTareasActual_ || []).filter(function (t) { return t.actividad_id === actId; })[0] || null;
  }

  // v10 (Fase G3, "vista transversal por recurso"): la navegación de
  // ventana se comparte entre el Cronograma de un proyecto y "Mi
  // dedicación" (varios proyectos) -- ambas mueven la MISMA ancla de
  // módulo, `alRepintar` es lo único que cambia entre las dos pantallas.
  function wireDedicacionNav_(cont, alRepintar) {
    var dedAtras = cont.querySelector('.js-py-ded-atras');
    if (dedAtras) dedAtras.addEventListener('click', function () {
      dedicacionAncla_ = new Date(dedicacionAncla_.getFullYear(), dedicacionAncla_.getMonth(), dedicacionAncla_.getDate() - DEDICACION_DIAS_VENTANA);
      alRepintar();
    });
    var dedAdelante = cont.querySelector('.js-py-ded-adelante');
    if (dedAdelante) dedAdelante.addEventListener('click', function () {
      dedicacionAncla_ = new Date(dedicacionAncla_.getFullYear(), dedicacionAncla_.getMonth(), dedicacionAncla_.getDate() + DEDICACION_DIAS_VENTANA);
      alRepintar();
    });
    var dedHoy = cont.querySelector('.js-py-ded-hoy');
    if (dedHoy) dedHoy.addEventListener('click', function () {
      dedicacionAncla_ = new Date();
      alRepintar();
    });
  }

  // v10 (Fase G3, "los números de rendimiento"): tira de KPIs derivados de
  // la MISMA bitácora -- cumplimiento de entregas (mismo cálculo que ya
  // usaba el portafolio), ritmo promedio (unidades/día) y horas
  // registradas. Se omite si el proyecto no tiene todavía nada que medir
  // (evita una tira vacía en un proyecto recién creado).
  function pintarRendimientoKpis_(rendimiento) {
    if (!rendimiento) return '';
    var c = rendimiento.cumplimiento_tareas || {};
    var kpis = [];
    if (c.entregadas) {
      kpis.push(Componentes.kpi({
        etiqueta: 'Entregas a tiempo', valor: c.a_tiempo + '/' + c.entregadas,
        alerta: c.pct !== null && c.pct < 100,
        titulo: 'Entregadas dentro de su fecha comprometida'
      }));
    }
    if (rendimiento.promedio_unidades_dia !== null && rendimiento.promedio_unidades_dia !== undefined) {
      kpis.push(Componentes.kpi({
        etiqueta: 'Ritmo promedio', valor: rendimiento.promedio_unidades_dia + '/día',
        titulo: 'Unidades por día, sobre tareas con meta cuantificable ya terminadas'
      }));
    }
    if (rendimiento.horas_totales_proyecto) {
      kpis.push(Componentes.kpi({ etiqueta: 'Horas registradas', valor: rendimiento.horas_totales_proyecto + 'h' }));
    }
    if (rendimiento.tareas_sin_avance) {
      kpis.push(Componentes.kpi({ etiqueta: 'Sin arrancar', valor: rendimiento.tareas_sin_avance, alerta: true }));
    }
    if (!kpis.length) return '';
    return '<div class="sigso-py-kpis">' + kpis.join('') + '</div>';
  }

  // --- helpers de la carta de dedicación (auditoría G, versión pro) --------
  var MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function redond1_(n) { return Math.round(n * 10) / 10; }
  function fechaDeClave_(c) { var p = String(c).split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }

  // Días visibles según el rango elegido. 'todo' abarca de la fecha más
  // temprana conocida (inicio del proyecto / creación de tareas / primera
  // bitácora) a la más tardía (hoy / objetivo / compromisos), con un tope
  // de 370 columnas para no dibujar ventanas absurdas.
  function construirDiasCarta_(detalle, tareas, bitacora, feriadosSet, hoyClave) {
    function dia(d) {
      var c = claveDia_(d.getFullYear(), d.getMonth(), d.getDate());
      return { clave: c, dia: d.getDate(), mes: d.getMonth(), primeroMes: d.getDate() === 1,
        we: (d.getDay() === 0 || d.getDay() === 6), feriado: !!feriadosSet[c], hoy: c === hoyClave };
    }
    var dias = [];
    if (dedRango_ === 'todo') {
      var claves = [hoyClave];
      if (detalle && detalle.proyecto) {
        if (detalle.proyecto.fecha_inicio) claves.push(claveDeIso_(detalle.proyecto.fecha_inicio));
        if (detalle.proyecto.fecha_objetivo) claves.push(claveDeIso_(detalle.proyecto.fecha_objetivo));
      }
      tareas.forEach(function (a) {
        if (a.fecha_creacion) claves.push(claveDeIso_(a.fecha_creacion));
        if (a.fecha_compromiso) claves.push(claveDeIso_(a.fecha_compromiso));
      });
      bitacora.forEach(function (b) { var k = claveDeIso_(b.timestamp); if (k) claves.push(k); });
      claves = claves.filter(Boolean).sort();
      var dIni = fechaDeClave_(claves[0]), dFin = fechaDeClave_(claves[claves.length - 1]);
      if ((dFin - dIni) / 86400000 > 369) dIni = new Date(dFin.getTime() - 369 * 86400000);
      for (var d = new Date(dIni); d <= dFin; d.setDate(d.getDate() + 1)) dias.push(dia(new Date(d)));
    } else {
      var n = DED_RANGO_DIAS[dedRango_] || 14;
      for (var i = n - 1; i >= 0; i--) {
        dias.push(dia(new Date(dedicacionAncla_.getFullYear(), dedicacionAncla_.getMonth(), dedicacionAncla_.getDate() - i)));
      }
    }
    return dias;
  }

  // v12.3 ("rediseño"): la cabecera del día muestra la INICIAL del día de la
  // semana (L M X J V S D) sobre el número -- mucho más fácil ubicarse en la
  // grilla (y el primer día del mes antepone el mes corto).
  var DIA_SEMANA_INICIAL_ = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
  function diaCabeceraHtml_(x) {
    var inicial = DIA_SEMANA_INICIAL_[fechaDeClave_(x.clave).getDay()];
    var top = (x.primeroMes ? MESES_CORTOS[x.mes] + ' ' : '') + inicial;
    return '<div class="sigso-py-ded-dia' + (x.we ? ' we' : '') + (x.feriado ? ' feriado' : '') +
      (x.hoy ? ' hoy' : '') + (x.primeroMes ? ' mes' : '') + '" title="' + fechaCorta_(x.clave) + '">' +
      '<b>' + top + '</b>' + x.dia + '</div>';
  }

  // Barra de controles: rango, navegación de ventana, agrupar por persona,
  // filtros y el botón de imprimir/descargar.
  function cartaControlesHtml_(tareas, dias, ctxEdicion, baseline) {
    var esTodo = dedRango_ === 'todo';
    // v12: hay un proyecto único abierto (Cronograma de un proyecto) vs. "Mi
    // dedicación" (varios). Solo el primero tiene reporte PDF de backend.
    var esProyecto = !!(ctxEdicion && ctxEdicion.proyectoId);
    var desdeTxt = fechaCorta_(dias[0].clave), hastaTxt = fechaCorta_(dias[dias.length - 1].clave);
    var rangoSel = Componentes.campoSelect({ id: 'py-ded-rango', valor: dedRango_, placeholder: false, claseCampo: 'sigso-py-ded-ctrl',
      opciones: [{ valor: 'semana', texto: 'Semana' }, { valor: 'quincena', texto: '2 semanas' }, { valor: 'mes', texto: 'Mes' }, { valor: 'todo', texto: 'Todo el proyecto' }] });
    var vistos = {}, personas = [];
    tareas.forEach(function (a) {
      var e = normalizarEmail_(a.responsable_email);
      if (e && !vistos[e]) { vistos[e] = true; personas.push({ valor: e, texto: a.responsable_nombre || a.responsable_email }); }
    });
    var filtroPersona = personas.length > 1
      ? Componentes.campoSelect({ id: 'py-ded-persona', valor: dedFiltroPersona_, placeholder: 'Todas las personas', claseCampo: 'sigso-py-ded-ctrl', opciones: personas })
      : '';
    var filtroEstado = Componentes.campoSelect({ id: 'py-ded-estado', valor: dedFiltroEstado_, placeholder: 'Todos los estados', claseCampo: 'sigso-py-ded-ctrl',
      opciones: [{ valor: 'abiertas', texto: 'Solo abiertas' }, { valor: 'atrasadas', texto: 'Solo atrasadas' }] });
    var nav = esTodo ? '' :
      (Componentes.boton({ texto: '←', variante: 'sutil', clase: 'js-py-ded-atras', tipo: 'button' }) +
       Componentes.boton({ texto: '→', variante: 'sutil', clase: 'js-py-ded-adelante', tipo: 'button' }) +
       Componentes.boton({ texto: 'Hoy', variante: 'sutil', clase: 'js-py-ded-hoy', tipo: 'button' }));
    // v11 (P1, "congelar línea base"): solo quien gestiona ESTE proyecto (no
    // en "Mi dedicación", que cruza varios) puede fijar una nueva foto de
    // referencia. Si ya hay una, se ve cuándo y quién -- nunca en silencio.
    var baselineHtml = '';
    if (ctxEdicion && ctxEdicion.puedeGestionar && ctxEdicion.proyectoId) {
      var nota = baseline
        ? '<span class="sigso-ayuda">Línea base: ' + Componentes.escaparHtml(fechaHora_(baseline.timestamp)) +
            (baseline.autor_nombre ? ' por ' + Componentes.escaparHtml(baseline.autor_nombre) : '') + '</span>'
        : '<span class="sigso-ayuda">Sin línea base todavía</span>';
      baselineHtml = '<span class="sigso-py-ded-baseline">' + nota +
        Componentes.boton({ texto: 'Congelar línea base', variante: 'sutil', clase: 'js-py-ded-baseline', tipo: 'button' }) + '</span>';
    }
    return '<div class="sigso-py-ded-controles">' +
      rangoSel + nav +
      '<span class="sigso-ayuda sigso-py-ded-rangotxt">' + Componentes.escaparHtml(desdeTxt) + ' – ' + Componentes.escaparHtml(hastaTxt) + '</span>' +
      '<label class="sigso-campo-check sigso-py-ded-ctrl"><input type="checkbox" class="js-py-ded-agrupar"' + (dedAgruparPersona_ ? ' checked' : '') + '> Por persona</label>' +
      filtroPersona + filtroEstado +
      // v12 ("reporte PDF potenciado"): en el Cronograma de UN proyecto el
      // botón ya NO imprime la pantalla -- genera el PDF ejecutivo real del
      // backend (portada, KPIs, Carta Gantt de barras, riesgos, etc.),
      // respetando el filtro de persona/estado que el usuario tenga puesto.
      // En "Mi dedicación" (varios proyectos a la vez, sin un proyecto_id
      // único) no hay ese reporte, así que ahí se conserva Imprimir (window.
      // print de la carta). El title del span da el contexto sin sumar texto
      // fijo al toolbar (un <button> sin title propio hereda el del ancestro).
      (esProyecto
        ? '<span title="Genera el PDF ejecutivo del proyecto: portada, indicadores, Carta Gantt, riesgos y más. Respeta el filtro de persona/estado.">' +
            Componentes.boton({ texto: 'Descargar reporte (PDF)', variante: 'secundario', clase: 'js-py-ded-imprimir', tipo: 'button', icono: 'descargar' }) +
          '</span>'
        : '<span title="Consejo: en el diálogo de impresión, desactiva la opción Encabezados y pies de página para un PDF más limpio.">' +
            Componentes.boton({ texto: 'Descargar / Imprimir', variante: 'secundario', clase: 'js-py-ded-imprimir', tipo: 'button', icono: 'descargar' }) +
          '</span>') +
      baselineHtml +
    '</div>';
  }

  function cartaLeyendaHtml_() {
    var estados = [
      ['asig', 'Asignado (A)'], ['plan', 'Planificado (P)'], ['proc', 'En proceso (●)'],
      ['done', 'Finalizado / entregado (✓/F)'], ['rev', 'En revisión (R)'], ['pausa', 'En pausa (‖)'],
      ['esp', 'Esperando a un tercero (…)'], ['bloq', 'Bloqueado (!)'], ['late', 'Vencida sin gestión'],
      ['we', 'Fin de semana'], ['feriado', 'Feriado']
    ].map(function (p) { return '<span><i class="sigso-py-ded-sw sigso-py-ded-sw--' + p[0] + '"></i>' + p[1] + '</span>'; }).join('');
    var heat = '<span class="sigso-py-ded-heatleg">Horas del día: <i class="hl h1"></i><i class="hl h2"></i><i class="hl h3"></i><i class="hl h4"></i> más</span>';
    return '<div class="sigso-py-ded-leyenda">' + estados + heat + '</div>';
  }

  // v12 ("reporte PDF potenciado"): el botón del Cronograma de un proyecto
  // genera el PDF ejecutivo REAL del backend (Proyectos.descargarReporte con
  // config), el mismo motor de "Configurar informe" del Resumen, pero con un
  // set de secciones profesional por defecto (portada, KPIs, salud,
  // desviaciones, Carta Gantt de barras, workload, hitos, riesgos,
  // vencimientos, bitácora, leyenda). Respeta el filtro de persona/estado que
  // el usuario tenga puesto en la carta -- así el PDF cuenta lo que está
  // mirando, no un genérico. Llega en base64 y se baja como .pdf de verdad
  // (descargarBase64Proyecto_), sin diálogo de impresión ni clon de pantalla.
  var CRONOGRAMA_REPORTE_SECCIONES_ = [
    'portada', 'ficha', 'kpis', 'salud', 'desviaciones', 'gantt',
    'workload', 'hitos', 'riesgos', 'vencimientos', 'bitacora', 'leyenda'
  ];
  function descargarReporteCronograma_(btn, detalle) {
    var config = { secciones: CRONOGRAMA_REPORTE_SECCIONES_ };
    if (dedFiltroPersona_) config.personas = [dedFiltroPersona_];
    if (dedFiltroEstado_) config.estado = dedFiltroEstado_;
    var textoOriginal = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="sigso-spinner"></span>Generando…';
    api_('descargarReporteProyecto', { proyecto_id: detalle.proyecto.proyecto_id, config: config }).then(function (r) {
      if (!r || !r.ok) {
        Componentes.aviso({ texto: (r && r.message) || 'No se pudo generar el reporte.', tipo: 'error' });
        return;
      }
      descargarBase64Proyecto_(r.data.pdf_base64, r.data.filename || ('Reporte-' + detalle.proyecto.proyecto_id + '.pdf'), 'application/pdf');
    }).catch(function () {
      Componentes.aviso({ texto: 'No se pudo conectar con el servidor.', tipo: 'error' });
    }).finally(function () {
      btn.disabled = false;
      btn.textContent = textoOriginal;
    });
  }

  // Vista imprimible: arma un contenedor con encabezado + la grilla ya
  // renderizada (misma del DOM) + leyenda, y dispara el diálogo del
  // navegador. El @media print (components.css) oculta todo lo demás y pone
  // la página en horizontal. Sin librerías: "Guardar como PDF" del navegador.
  function imprimirCartaDedicacion_(cont, detalle) {
    var scroll = cont.querySelector('.sigso-py-ded-scroll');
    if (!scroll) return;
    var titulo = (detalle && detalle.proyecto && detalle.proyecto.nombre) || 'Mi dedicación';
    var rangoTxt = (cont.querySelector('.sigso-py-ded-rangotxt') || {}).textContent || '';
    var leyenda = cont.querySelector('.sigso-py-ded-leyenda');
    var root = document.getElementById('sigso-print-root');
    if (!root) { root = document.createElement('div'); root.id = 'sigso-print-root'; document.body.appendChild(root); }
    var generado = new Date().toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    root.innerHTML =
      '<div class="sigso-print-cab">' +
        '<h1>Carta de Dedicación</h1>' +
        '<p class="sigso-print-proy">' + Componentes.escaparHtml(titulo) + '</p>' +
        '<p class="sigso-print-sub">' + Componentes.escaparHtml(rangoTxt) + ' · generado ' + generado + '</p>' +
      '</div>' +
      '<div class="sigso-print-grid">' + scroll.innerHTML + '</div>' +
      (leyenda ? leyenda.outerHTML : '');
    // Forzar tema CLARO mientras se imprime: un reporte para gerentes va a
    // papel/PDF y debe verse nítido con la paleta clara, aunque la persona
    // tenga la app en modo oscuro. Se restaura al terminar.
    var temaPrevio = document.documentElement.getAttribute('data-tema');
    document.documentElement.setAttribute('data-tema', 'claro');
    document.body.classList.add('sigso-imprimiendo');
    function limpiar() {
      document.body.classList.remove('sigso-imprimiendo');
      if (temaPrevio) document.documentElement.setAttribute('data-tema', temaPrevio);
      else document.documentElement.removeAttribute('data-tema');
      window.removeEventListener('afterprint', limpiar);
    }
    window.addEventListener('afterprint', limpiar);
    window.print();
  }

  function pintarCronogramaDedicacion_(detalle, tareas, bitacora, rendimiento, ctxEdicion) {
    if (!tareas.length) {
      return Componentes.vacio({ texto: 'Todavía no hay tareas para mostrar la dedicación.' });
    }
    if (!dedicacionAncla_) dedicacionAncla_ = new Date();
    // v11 (P0): se fijan las referencias que usa el manejador de clic de la
    // celda para abrir el modal y refrescar tras guardar.
    cartaBitacoraActual_ = bitacora;
    cartaTareasActual_ = tareas;
    var porTareaRendimiento = {};
    ((rendimiento && rendimiento.por_tarea) || []).forEach(function (t) { porTareaRendimiento[t.actividad_id] = t; });
    // v11 (P1, "Plan · Esperado · Real"): por TODA tarea activa, no solo las
    // que tienen meta_cantidad -- viene de la MISMA llamada a rendimiento que
    // ya se pedía (cero red nueva).
    var planPorTarea = {};
    ((rendimiento && rendimiento.plan_seguimiento) || []).forEach(function (t) { planPorTarea[t.actividad_id] = t; });

    var feriadosSet = {};
    ((detalle && detalle.feriados) || []).forEach(function (f) { feriadosSet[f] = true; });

    var hoyClave = claveHoy_();
    var dias = construirDiasCarta_(detalle, tareas, bitacora, feriadosSet, hoyClave);
    var finVentana = dias[dias.length - 1].clave;
    var kpis = pintarRendimientoKpis_(rendimiento);
    var controles = cartaControlesHtml_(tareas, dias, ctxEdicion, rendimiento && rendimiento.baseline);

    // Bitácora por tarea/día, horas por tarea/día, y última entrega (para
    // "esperando a un tercero"). v11 (P0): los REGISTRO_DIA (el registro
    // editable de la celda) van a su propio mapa -- son la fuente autoritativa
    // del estado y las horas de ese día, y ganan sobre lo derivado del
    // check-in. Sus horas NO se suman a las del check-in (evita doble conteo:
    // el registro del día reemplaza, no acumula).
    var eventosPorTareaDia = {}, horasPorTareaDia = {}, ultimaEntregaPorTarea = {}, registroPorTareaDia = {};
    bitacora.forEach(function (b) {
      var k = (b.tipo === 'REGISTRO_DIA' && b.dia) ? b.dia : claveDeIso_(b.timestamp);
      if (!k) return;
      if (b.tipo === 'REGISTRO_DIA') {
        var reg = (registroPorTareaDia[b.actividad_id] = registroPorTareaDia[b.actividad_id] || {});
        reg[k] = b;
        return;
      }
      var porDia = (eventosPorTareaDia[b.actividad_id] = eventosPorTareaDia[b.actividad_id] || {});
      (porDia[k] = porDia[k] || []).push(b);
      if (b.horas) {
        var hh = (horasPorTareaDia[b.actividad_id] = horasPorTareaDia[b.actividad_id] || {});
        hh[k] = (hh[k] || 0) + Number(b.horas);
      }
      if (b.tipo === 'ENTREGA' && (!ultimaEntregaPorTarea[b.actividad_id] || k > ultimaEntregaPorTarea[b.actividad_id])) {
        ultimaEntregaPorTarea[b.actividad_id] = k;
      }
    });

    // Filtros (persona / estado) + "la tarea existía en la ventana".
    var filas = tareas.filter(function (a) {
      if (dedFiltroPersona_ && normalizarEmail_(a.responsable_email) !== dedFiltroPersona_) return false;
      if (dedFiltroEstado_ === 'abiertas' && (a.estado === 'TERMINADA' || a.estado === 'CANCELADA')) return false;
      if (dedFiltroEstado_ === 'atrasadas' && a.semaforo !== 'atrasada') return false;
      return !a.fecha_creacion || claveDeIso_(a.fecha_creacion) <= finVentana;
    });
    if (!filas.length) {
      return kpis + controles + Componentes.vacio({ texto: 'Ninguna tarea coincide con el filtro en esta ventana.' });
    }

    var headDias = dias.map(diaCabeceraHtml_).join('');
    var totalPorDia = {};
    dias.forEach(function (x) { totalPorDia[x.clave] = 0; });

    // v11 (P0): ¿puede esta persona editar la celda de ESTA tarea? y ¿a qué
    // proyecto pertenece? (en "Mi dedicación", cada tarea trae el suyo).
    var puedeEditarTarea = !!(ctxEdicion && typeof ctxEdicion.puedeEditarTarea === 'function');

    // Una fila-tarea. Acumula horas por día en totalPorDia (para el pie).
    function filaTareaHtml_(a) {
      var claveCreacion = a.fecha_creacion ? claveDeIso_(a.fecha_creacion) : '';
      var claveVence = a.fecha_compromiso ? claveDeIso_(a.fecha_compromiso) : '';
      var terminal = a.estado === 'TERMINADA' || a.estado === 'CANCELADA';
      var ultimaEntrega = ultimaEntregaPorTarea[a.actividad_id];
      var porDia = eventosPorTareaDia[a.actividad_id] || {};
      var horasDia = horasPorTareaDia[a.actividad_id] || {};
      var regDia = registroPorTareaDia[a.actividad_id] || {};
      var horasFila = 0, diasConActividad = 0;
      // Editable: solo si el contexto lo permite Y la persona trabaja/gestiona
      // esta tarea. El día futuro no es editable (el backend lo rechaza).
      var editableTarea = puedeEditarTarea && ctxEdicion.puedeEditarTarea(a);
      var proyIdCelda = (ctxEdicion && ctxEdicion.proyectoId) || a.proyecto_id || '';

      var celdas = dias.map(function (x) {
        var registro = regDia[x.clave];
        var estado = '', txt = '', tituloCelda = '', horas = 0;

        if (registro) {
          // v11 (P0): el registro del día MANDA -- estado explícito, horas y
          // comentario propios; ignora la derivación por check-in de ese día.
          var vis = REGISTRO_DIA_ESTADO_VIS_[registro.estado_dia] || { cls: '', txt: '' };
          estado = vis.cls; txt = vis.txt;
          horas = Number(registro.horas) || 0;
          var partes = [REGISTRO_DIA_ESTADO_LABEL_[registro.estado_dia] || registro.estado_dia];
          if (horas) partes[0] += ' (' + redond1_(horas) + 'h)';
          if (registro.nota) partes.push(registro.nota);
          if (registro.bloqueo_motivo) partes.push('Bloqueo: ' + registro.bloqueo_motivo);
          if (registro.editado_por) {
            partes.push('registrado por ' + (registro.autor_nombre || registro.editado_por) +
              (registro.ediciones ? ' · editado ' + registro.ediciones + ' vez(ces)' : ''));
          }
          tituloCelda = fechaCorta_(x.clave) + ': ' + partes.join(' — ');
          if (['en_proceso', 'finalizado', 'entregado', 'revision'].indexOf(registro.estado_dia) !== -1) diasConActividad++;
        } else {
          var eventos = porDia[x.clave] || [];
          var notas = eventos.map(function (ev) {
            return (DEDICACION_TIPO_ETIQUETA_[ev.tipo] || ev.tipo) +
              (ev.horas !== undefined && ev.horas !== null && ev.horas !== '' ? ' (' + ev.horas + 'h)' : '') +
              (ev.nota ? ': ' + ev.nota : '');
          });
          eventos.forEach(function (ev) {
            if (ev.tipo === 'ENTREGA') { estado = 'done'; txt = 'F'; return; }
            if (ev.tipo === 'VALIDACION') {
              if (/^Aprobada/i.test(ev.nota || '')) { estado = 'done'; txt = 'F'; }
              else if (estado !== 'done') { estado = 'bloq'; txt = '!'; }
              return;
            }
            if (estado === 'done') return; // F del día manda sobre cualquier otra marca del mismo día
            if (ev.tipo === 'BLOQUEO') { estado = 'bloq'; txt = '!'; return; }
            if (DEDICACION_TIPO_ESTADO_[ev.tipo] && estado !== 'bloq') { estado = DEDICACION_TIPO_ESTADO_[ev.tipo]; txt = 'P'; }
          });
          if (!estado && x.clave === claveCreacion) { estado = 'asig'; txt = 'A'; }
          if (!estado && a.estado === 'EN_REVISION' && ultimaEntrega && x.clave > ultimaEntrega && x.clave <= hoyClave) { estado = 'wait'; }
          // Vencida sin gestión: SOLO días laborales (ni fin de semana ni
          // feriado) pasado el compromiso, tarea abierta, sin marca ese día.
          if (!estado && !terminal && !x.we && !x.feriado && claveVence && x.clave > claveVence && x.clave <= hoyClave) { estado = 'late'; txt = '!'; }
          if (estado === 'proc' || estado === 'done' || estado === 'asig') diasConActividad++;
          horas = horasDia[x.clave] || 0;
          tituloCelda = notas.length ? (fechaCorta_(x.clave) + ': ' + notas.join(' · ')) : '';
        }

        if (horas) { horasFila += horas; totalPorDia[x.clave] += horas; }
        var nivel = nivelHoras_(horas);
        // Editable: día no futuro. Lleva data-* para que el clic sepa qué
        // (proyecto, tarea, día) registrar; el modal valida el resto.
        var editableCelda = editableTarea && x.clave <= hoyClave;
        return '<div class="sigso-py-ded-celda' + (x.we ? ' we' : '') + (x.feriado ? ' feriado' : '') + (x.clave === hoyClave ? ' hoy' : '') +
          (estado ? ' e-' + estado : '') + (nivel ? ' h' + nivel : '') + (registro ? ' reg' : '') +
          (editableCelda ? ' sigso-py-ded-celda--edit' : '') + '"' +
          (editableCelda ? ' role="button" tabindex="0" data-proy="' + Componentes.escaparHtml(proyIdCelda) +
            '" data-act="' + Componentes.escaparHtml(a.actividad_id) + '" data-dia="' + x.clave + '"' : '') +
          (tituloCelda ? ' title="' + Componentes.escaparHtml(tituloCelda) + '"' : '') + '>' + (txt ? '<span>' + txt + '</span>' : '') + '</div>';
      }).join('');

      var r = porTareaRendimiento[a.actividad_id];
      var metaTxt = a.meta_cantidad
        ? (a.meta_cantidad + (a.meta_unidad ? ' ' + a.meta_unidad : '') + (r && r.unidades_por_dia !== '' ? ' · ' + r.unidades_por_dia + '/día' : ''))
        : '';
      var subEtiqueta = a.proyecto_nombre || a.responsable_nombre || a.responsable_email || '';
      var totalTxt = horasFila ? redond1_(horasFila) + 'h' : '';
      // v11 (P1): botón "Reprogramar" solo si esta persona puede editar la
      // tarea Y la tarea ya tiene un plan vigente (sin fecha_compromiso
      // confirmada -- RN-710 -- no hay nada que reprogramar todavía).
      var proyIdFila = (ctxEdicion && ctxEdicion.proyectoId) || a.proyecto_id || '';
      var reprogramarBtn = (editableTarea && a.fecha_compromiso)
        ? '<button type="button" class="sigso-py-ded-reprogramar js-py-ded-reprogramar" data-proy="' + Componentes.escaparHtml(proyIdFila) + '" data-act="' + Componentes.escaparHtml(a.actividad_id) + '" title="Reprogramar fecha de compromiso">📅</button>'
        : '';

      // v12.3 ("rediseño"): riel de color por semáforo a la izquierda de la
      // fila -- el estado de la tarea se lee de un vistazo, sin leer texto.
      return '<div class="sigso-py-ded-fila sigso-py-ded-fila--sem-' + (a.semaforo || 'al-dia') + '">' +
        '<div class="sigso-py-ded-etiqueta"><span class="t">' + Componentes.escaparHtml(a.titulo) + reprogramarBtn + '</span>' +
          '<span class="m">' + Componentes.escaparHtml(subEtiqueta) + (metaTxt ? ' · ' + Componentes.escaparHtml(metaTxt) : '') + '</span>' +
          planLineaHtml_(planPorTarea[a.actividad_id]) +
        '</div>' +
        celdas +
        '<div class="sigso-py-ded-total"' + (diasConActividad ? ' title="' + diasConActividad + ' día(s) con actividad"' : '') + '>' + totalTxt + '</div>' +
      '</div>';
    }

    // v11 (P1, "workload / sobrecarga"): horas de UNA tarea en UN día,
    // priorizando el registro explícito del día (P0) sobre lo derivado del
    // check-in -- misma regla que usa cada celda individual, reusada aquí
    // para sumar por persona sin duplicar conteo.
    function horasDelDiaTarea_(actividadId, diaClave) {
      var reg = (registroPorTareaDia[actividadId] || {})[diaClave];
      if (reg) return Number(reg.horas) || 0;
      return (horasPorTareaDia[actividadId] || {})[diaClave] || 0;
    }

    // Cuerpo: agrupado por persona, o plano.
    var cuerpo;
    if (dedAgruparPersona_) {
      var grupos = {}, ordenGrupos = [];
      filas.forEach(function (a) {
        var clave = a.responsable_nombre || a.responsable_email || '—';
        if (!grupos[clave]) { grupos[clave] = []; ordenGrupos.push(clave); }
        grupos[clave].push(a);
      });
      cuerpo = ordenGrupos.map(function (persona) {
        // v11 (P1): el total de horas de ESTA persona por día, sumando TODAS
        // sus tareas visibles -- heatmapeado igual que una celda normal, con
        // una marca de sobrecarga cuando el total del día supera la jornada
        // (WORKLOAD_JORNADA_HORAS_, misma convención de "un día" que ya usa
        // el resto de SIGSO -- ver CUMPLIMIENTO_HORAS_JORNADA en el backend).
        var celdasWorkload = dias.map(function (x) {
          var total = grupos[persona].reduce(function (s, a) { return s + horasDelDiaTarea_(a.actividad_id, x.clave); }, 0);
          var nivel = nivelHoras_(total);
          var sobrecarga = total > WORKLOAD_JORNADA_HORAS_;
          var tituloCelda = total
            ? (Componentes.escaparHtml(persona) + ' — ' + fechaCorta_(x.clave) + ': ' + redond1_(total) + 'h' + (sobrecarga ? ' (sobrecarga)' : ''))
            : '';
          return '<div class="sigso-py-ded-celda sigso-py-ded-celda--workload' + (x.we ? ' we' : '') + (x.feriado ? ' feriado' : '') +
            (nivel ? ' h' + nivel : '') + (sobrecarga ? ' sigso-py-ded-celda--sobrecarga' : '') + '"' +
            (tituloCelda ? ' title="' + tituloCelda + '"' : '') + '>' + (total ? '<span>' + redond1_(total) + '</span>' : '') + '</div>';
        }).join('');
        var head = '<div class="sigso-py-ded-fila sigso-py-ded-grupo">' +
          '<div class="sigso-py-ded-etiqueta"><span class="t">' + Componentes.escaparHtml(persona) + '</span>' +
            '<span class="m">' + grupos[persona].length + ' tarea(s)</span></div>' +
          celdasWorkload + '<div class="sigso-py-ded-total"></div></div>';
        return head + grupos[persona].map(filaTareaHtml_).join('');
      }).join('');
    } else {
      cuerpo = filas.map(filaTareaHtml_).join('');
    }

    // Pie: horas por día (y gran total).
    var granTotal = 0;
    var footerCeldas = dias.map(function (x) {
      var h = totalPorDia[x.clave]; granTotal += h;
      return '<div class="sigso-py-ded-celda sigso-py-ded-celda--total' + (x.we ? ' we' : '') + (x.feriado ? ' feriado' : '') + '">' +
        (h ? '<span>' + redond1_(h) + '</span>' : '') + '</div>';
    }).join('');
    var footer = '<div class="sigso-py-ded-fila sigso-py-ded-footer">' +
      '<div class="sigso-py-ded-etiqueta"><span class="t">Horas por día</span></div>' +
      footerCeldas + '<div class="sigso-py-ded-total">' + (granTotal ? redond1_(granTotal) + 'h' : '') + '</div></div>';

    return kpis + controles +
      '<div class="sigso-py-ded-scroll"><div class="sigso-py-ded" style="--dias:' + dias.length + '">' +
        '<div class="sigso-py-ded-fila sigso-py-ded-cabecera"><div class="sigso-py-ded-etiqueta">Tarea</div>' + headDias +
          '<div class="sigso-py-ded-total">Horas</div></div>' +
        cuerpo +
        footer +
      '</div></div>' +
      cartaLeyendaHtml_();
  }

  // --- Cronograma: vista Plan -- Gantt navegable (v11, P2 "Gantt profesional") --
  //
  // v10 (Fase C) dibujaba las barras a PORCENTAJE del ancho del contenedor
  // (auto-encoge todo para que quepa, sin scroll, sin zoom real). v11 lo
  // reconstruye como una línea de tiempo de verdad: escala en PÍXELES POR
  // DÍA (zoom real, no solo "cabe más o menos"), columna de etiquetas FIJA
  // (position:sticky) mientras el eje de tiempo se desplaza horizontalmente,
  // regla de meses, y el borde derecho de la barra de una tarea se puede
  // ARRASTRAR para reprogramarla -- SIEMPRE con el modal de confirmación +
  // motivo de siempre (reprogramarTareaProyecto, P1), nunca un commit mudo.
  // Los HITOS son un punto en el tiempo (fecha_objetivo); las TAREAS con
  // fecha comprometida son una barra desde que se crearon hasta esa fecha,
  // extendida en rojo más allá si ya venció y sigue sin terminar. 100% con
  // datos que la pestaña ya tenía cargados -- no pide nada nuevo al servidor.
  var CRONOGRAMA_HITO_ESTADO_CODIGO = { COMPLETADO: 'terminada', CANCELADO: 'cancelada' };

  // Niveles de zoom -- píxeles por día. Módulo, no por proyecto (mismo
  // criterio que dedRango_/vistaCronograma_: al cambiar de proyecto se
  // mantiene donde el usuario lo dejó).
  // Ancho de la columna de etiquetas (fija, position:sticky) -- en JS y en
  // CSS (.sigso-py-gantt-etiqueta) para que la línea de "Hoy" (hija directa
  // de .sigso-py-gantt-body, no de un track) calce con el eje de los días:
  // su `left` es relativo al body COMPLETO, que arranca en la etiqueta.
  var PLAN_ETIQUETA_ANCHO_PX_ = 240;
  var PLAN_ZOOM_NIVELES_ = [
    { id: 'trimestre', pxDia: 4, etiqueta: 'Trimestre' },
    { id: 'mes', pxDia: 10, etiqueta: 'Mes' },
    { id: 'quincena', pxDia: 20, etiqueta: 'Quincena' },
    { id: 'semana', pxDia: 40, etiqueta: 'Semana' }
  ];
  var planZoomIdx_ = 1; // 'mes' por defecto
  // v13 (Fase 1): resaltar la ruta crítica en el Gantt (flag de presentación,
  // igual que planZoomIdx_ -- no se pide de nuevo al servidor, es_critica ya
  // viene en cada tarea).
  var mostrarRutaCritica_ = false;
  // v11 (P2): minTime/pxDia del último pintado -- wireAccionesPestana_ los
  // necesita para traducir el ancho final de una barra arrastrada a una
  // fecha, sin recalcular el rango completo (mismo criterio que
  // cartaBitacoraActual_/cartaTareasActual_ para la carta de Dedicación).
  var planMinTimeActual_ = 0;
  var planPxDiaActual_ = 0;

  // v11 (P2, "drag & drop de fechas"): estado de arrastre del handle de
  // resize -- ÚNICO módulo, con los listeners de mousemove/mouseup
  // registrados UNA SOLA VEZ (fuera de cualquier repintado) para no acumular
  // handlers en `document` cada vez que se repinta la vista Plan. Los
  // mousedown SÍ se re-wirean en cada repintado (viven en nodos que se
  // recrean, mueren con ellos -- sin fuga).
  var ganttArrastre_ = null;
  document.addEventListener('mousemove', function (ev) {
    if (!ganttArrastre_) return;
    var delta = ev.clientX - ganttArrastre_.xInicial;
    var nuevoAncho = Math.max(ganttArrastre_.pxDia, ganttArrastre_.anchoInicial + delta);
    ganttArrastre_.barra.style.width = nuevoAncho + 'px';
    ganttArrastre_.anchoActual = nuevoAncho;
    ganttArrastre_.barra.classList.add('sigso-py-gantt-barra--arrastrando');
  });
  document.addEventListener('mouseup', function () {
    if (!ganttArrastre_) return;
    var g = ganttArrastre_;
    ganttArrastre_ = null;
    document.body.style.removeProperty('user-select');
    g.barra.classList.remove('sigso-py-gantt-barra--arrastrando');
    if (g.anchoActual === g.anchoInicial) return; // no se movió -- un clic no abre el modal
    var diasDesdeInicio = Math.round((g.izquierdaPx + g.anchoActual) / g.pxDia);
    var nuevaFecha = new Date(g.minTime + diasDesdeInicio * 86400000);
    var tarea = tareaPorIdEnCarta_(g.actId);
    abrirReprogramarTarea_(g.proyId, tarea, g.alExito, fechaISOCorta_(nuevaFecha.toISOString()));
  });

  // Cablea los handles de resize de la vista Plan actual -- se llama en cada
  // repintado (los nodos son nuevos, los listeners viejos mueren con ellos).
  function wireGanttResize_(cont, pxDia, minTime, alExito) {
    cont.querySelectorAll('.sigso-py-gantt-resize').forEach(function (handle) {
      handle.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        var barra = handle.closest('.sigso-py-gantt-barra');
        ganttArrastre_ = {
          barra: barra, pxDia: pxDia, minTime: minTime, alExito: alExito,
          actId: handle.getAttribute('data-act'), proyId: handle.getAttribute('data-proy'),
          anchoInicial: barra.offsetWidth, anchoActual: barra.offsetWidth,
          xInicial: ev.clientX, izquierdaPx: parseFloat(barra.style.left) || 0
        };
        document.body.style.userSelect = 'none';
      });
    });
  }

  function pintarCronogramaPlan_(detalle, tareas, ctxEdicion) {
    var p = detalle.proyecto;
    var hitos = (detalle.hitos || []).filter(function (h) { return h.fecha_objetivo; });
    var tareasConFecha = tareas.filter(function (a) { return a.fecha_compromiso; });

    if (hitos.length === 0 && tareasConFecha.length === 0) {
      return Componentes.vacio({ texto: 'Todavía no hay hitos ni tareas con fecha para mostrar en el cronograma.' });
    }
    // v11 (P2): mismo mecanismo que Dedicación usa para resolver "¿qué tarea
    // es esta?" al soltar el arrastre (tareaPorIdEnCarta_) -- se fija acá
    // también, por si Plan se abre ANTES que Dedicación en esta sesión.
    cartaTareasActual_ = tareas;

    // v13 (Fase 1, "ruta crítica"): el toggle solo tiene sentido si hay al
    // menos una dependencia definida -- si no, resaltar "la tarea más larga"
    // sería engañoso (ver calcularRutaCritica_ en el backend).
    var hayRutaCritica = tareas.some(function (a) { return !!a.depende_de; });
    var resaltarCritica = hayRutaCritica && mostrarRutaCritica_;

    var ahora = new Date();
    var tiempos = [ahora.getTime()];
    if (p.fecha_inicio) tiempos.push(new Date(p.fecha_inicio).getTime());
    if (p.fecha_objetivo) tiempos.push(new Date(p.fecha_objetivo).getTime());
    hitos.forEach(function (h) { tiempos.push(new Date(h.fecha_objetivo).getTime()); });
    tareasConFecha.forEach(function (a) {
      if (a.fecha_creacion) tiempos.push(new Date(a.fecha_creacion).getTime());
      tiempos.push(new Date(a.fecha_compromiso).getTime());
    });
    // Margen de 3 días a cada lado -- que la primera/última barra no queden
    // pegadas al borde del todo, y que arrastrar la última tarea más allá de
    // su fecha actual tenga a dónde crecer sin recalcular el rango al vuelo.
    var minTime = Math.min.apply(null, tiempos) - 3 * 86400000;
    var maxTime = Math.max.apply(null, tiempos) + 3 * 86400000;
    var totalDias = Math.max(Math.ceil((maxTime - minTime) / 86400000), 1);
    var pxDia = PLAN_ZOOM_NIVELES_[planZoomIdx_].pxDia;
    var anchoTotal = totalDias * pxDia;
    planMinTimeActual_ = minTime;
    planPxDiaActual_ = pxDia;
    function offsetPx_(fecha) { return Math.round(((new Date(fecha).getTime() - minTime) / 86400000) * pxDia); }
    var hoyPx = offsetPx_(ahora);

    // v11 (P2): quién puede arrastrar -- mismo criterio que la celda diaria
    // de Dedicación (líder/ADM, o quien trabaja la tarea).
    var puedeEditar = ctxEdicion && typeof ctxEdicion.puedeEditarTarea === 'function';

    var filasHitos = hitos.map(function (h) {
      var vencido = h.estado !== 'COMPLETADO' && h.estado !== 'CANCELADO' && new Date(h.fecha_objetivo) < ahora;
      var codigo = CRONOGRAMA_HITO_ESTADO_CODIGO[h.estado] || (vencido ? 'atrasada' : 'al-dia');
      var hitoPx = offsetPx_(h.fecha_objetivo);
      return '<div class="sigso-py-gantt-fila">' +
        '<div class="sigso-py-gantt-etiqueta">' +
          '<div class="sigso-py-gantt-etiqueta__titulo">' + Iconos.svg('diana', { tam: 13 }) + '<span>' + Componentes.escaparHtml(h.nombre) + '</span></div>' +
          '<div class="sigso-py-gantt-etiqueta__meta">Hito · ' + Componentes.escaparHtml(fechaCorta_(h.fecha_objetivo)) + '</div>' +
        '</div>' +
        '<div class="sigso-py-gantt-track" style="width:' + anchoTotal + 'px">' +
          '<div class="sigso-py-cron-hito sigso-py-cron-hito--' + codigo + '" style="left:' + hitoPx + 'px" title="' + Componentes.escaparHtml(fechaCorta_(h.fecha_objetivo)) + '"></div>' +
          '<div class="sigso-py-gantt-fecha" style="left:' + (hitoPx + 10) + 'px">' + Componentes.escaparHtml(h.nombre) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    var filasTareas = tareasConFecha.slice().sort(function (a, b) {
      return new Date(a.fecha_compromiso) - new Date(b.fecha_compromiso);
    }).map(function (a) {
      var inicioPx = offsetPx_(a.fecha_creacion || p.fecha_inicio || a.fecha_compromiso);
      var finPx = offsetPx_(a.fecha_compromiso);
      var anchoBarra = Math.max(finPx - inicioPx, 4);
      var codigo = a.semaforo || 'al-dia';
      var extraAtraso = '';
      if (codigo === 'atrasada' && hoyPx > finPx) {
        extraAtraso = '<div class="sigso-py-cron-barra sigso-py-cron-barra--atraso" style="left:' + finPx + 'px; width:' + (hoyPx - finPx) + 'px"></div>';
      }
      var editable = puedeEditar && ctxEdicion.puedeEditarTarea(a);
      var proyId = (ctxEdicion && ctxEdicion.proyectoId) || a.proyecto_id || '';
      var handle = editable
        ? '<div class="sigso-py-gantt-resize" data-act="' + Componentes.escaparHtml(a.actividad_id) + '" data-proy="' + Componentes.escaparHtml(proyId) + '" title="Arrastrar para reprogramar"></div>'
        : '';
      // v12: relleno de avance dentro de la barra + texto de % si la barra es
      // ancha; el % siempre visible en la meta de la etiqueta si no cabe.
      var avance = (a.avance_pct === null || a.avance_pct === undefined || a.avance_pct === '') ? null : Number(a.avance_pct);
      var fill = (avance !== null && avance > 0)
        ? '<div class="sigso-py-cron-barra__fill" style="width:' + Math.min(avance, 100) + '%"></div>' : '';
      var txtBarra = (avance !== null && anchoBarra >= 34) ? '<span class="sigso-py-cron-barra__txt">' + avance + '%</span>' : '';
      var resp = a.responsable_nombre || a.responsable_email || '';
      // v13 (Fase 1): en modo ruta crítica, la tarea crítica se marca; las que
      // NO están en la ruta se atenúan para que la cadena resalte sola.
      var critClase = '';
      if (resaltarCritica) critClase = a.es_critica ? ' sigso-py-gantt-barra--critica' : ' sigso-py-gantt-barra--holgada';
      var critMeta = (resaltarCritica && a.es_critica) ? '<span class="sigso-py-gantt-critica-chip">Ruta crítica</span>' : '';
      var meta = '<span class="sigso-py-gantt-etiqueta__punto sigso-py-cron-barra--' + codigo + '"></span>' +
        '<span>' + Componentes.escaparHtml(resp) + (avance !== null ? ' · ' + avance + '%' : '') + '</span>' + critMeta;
      var holguraTxt = (a.holgura_dias !== null && a.holgura_dias !== undefined)
        ? ' · ' + (a.es_critica ? 'ruta crítica (holgura 0)' : 'holgura ' + a.holgura_dias + ' día(s)') : '';
      // El chip de fecha va a la DERECHA de la barra; si la barra termina muy a
      // la derecha (poco espacio), no se pone (el title y la etiqueta lo dan).
      var chipFecha = '<div class="sigso-py-gantt-fecha" style="left:' + (finPx + 6) + 'px">' + Componentes.escaparHtml(fechaCorta_(a.fecha_compromiso)) + '</div>';
      return '<div class="sigso-py-gantt-fila">' +
        '<div class="sigso-py-gantt-etiqueta">' +
          '<div class="sigso-py-gantt-etiqueta__titulo"><span>' + Componentes.escaparHtml(a.titulo) + '</span></div>' +
          '<div class="sigso-py-gantt-etiqueta__meta">' + meta + '</div>' +
        '</div>' +
        '<div class="sigso-py-gantt-track" style="width:' + anchoTotal + 'px">' +
          '<div class="sigso-py-cron-barra sigso-py-gantt-barra sigso-py-cron-barra--' + codigo + (editable ? ' sigso-py-gantt-barra--editable' : '') + critClase +
            '" style="left:' + inicioPx + 'px; width:' + anchoBarra + 'px" title="' + Componentes.escaparHtml(a.titulo + ' — compromiso ' + fechaCorta_(a.fecha_compromiso) + (avance !== null ? ' · ' + avance + '% avance' : '') + holguraTxt) + '">' + fill + txtBarra + handle + '</div>' +
          extraAtraso + chipFecha +
        '</div>' +
      '</div>';
    }).join('');

    var zoomBtns = PLAN_ZOOM_NIVELES_.map(function (z, i) {
      return Componentes.boton({ texto: z.etiqueta, variante: i === planZoomIdx_ ? undefined : 'sutil', clase: 'js-py-gantt-zoom', idx: i });
    }).join('');
    // v13 (Fase 1): toggle de ruta crítica -- solo si hay dependencias que la
    // hagan significativa.
    var rutaCriticaBtn = hayRutaCritica
      ? Componentes.boton({ texto: (mostrarRutaCritica_ ? '✓ Ruta crítica' : 'Ruta crítica'), variante: mostrarRutaCritica_ ? undefined : 'sutil', clase: 'js-py-gantt-ruta-critica', tipo: 'button' })
      : '';
    var controles = '<div class="sigso-py-ded-controles">' + zoomBtns +
      Componentes.boton({ texto: 'Hoy', variante: 'sutil', clase: 'js-py-gantt-hoy', tipo: 'button' }) +
      rutaCriticaBtn +
      '<span class="sigso-ayuda">Hitos (◆) y tareas con fecha comprometida, de ' +
        (p.fecha_inicio ? fechaCorta_(p.fecha_inicio) : '—') + ' a ' + (p.fecha_objetivo ? fechaCorta_(p.fecha_objetivo) : '—') +
        (puedeEditar ? '. Arrastra el borde derecho de una barra para reprogramarla.' : '') +
        (resaltarCritica ? ' Resaltadas: la cadena de tareas que determina la duración del proyecto.' : '') + '</span>' +
    '</div>';

    return controles +
      '<div class="sigso-py-gantt-scroll">' +
        '<div class="sigso-py-gantt-body">' +
          ganttFondoHtml_(minTime, maxTime, pxDia, totalDias) +
          '<div class="sigso-py-gantt-fila sigso-py-gantt-fila--regla">' +
            '<div class="sigso-py-gantt-etiqueta"></div>' +
            '<div class="sigso-py-gantt-track sigso-py-gantt-track--regla" style="width:' + anchoTotal + 'px">' + reglaMesesHtml_(minTime, maxTime, pxDia) + '</div>' +
          '</div>' +
          filasHitos + filasTareas +
          '<div class="sigso-py-gantt-hoy" style="left:' + (PLAN_ETIQUETA_ANCHO_PX_ + hoyPx) + 'px" title="Hoy"></div>' +
          '<div class="sigso-py-gantt-hoy-pill" style="left:' + (PLAN_ETIQUETA_ANCHO_PX_ + hoyPx) + 'px">HOY</div>' +
        '</div>' +
      '</div>';
  }

  // v12: capa de fondo de la vista Plan -- bandas de fin de semana + líneas
  // finas al inicio de cada mes, detrás de todas las filas (hija directa del
  // body). Las posiciones se calculan sumando PLAN_ETIQUETA_ANCHO_PX_ (igual
  // que la línea de "Hoy"), porque el body arranca en la columna de etiqueta.
  function ganttFondoHtml_(minTime, maxTime, pxDia, totalDias) {
    var base = PLAN_ETIQUETA_ANCHO_PX_;
    var parts = '';
    for (var i = 0; i <= totalDias; i++) {
      var dia = new Date(minTime + i * 86400000);
      var dow = dia.getDay();
      if (dow === 0 || dow === 6) {
        parts += '<div class="sigso-py-gantt-weekend" style="left:' + (base + Math.round(i * pxDia)) + 'px; width:' + Math.ceil(pxDia) + 'px"></div>';
      }
    }
    var d = new Date(minTime);
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    while (d.getTime() <= maxTime) {
      var offsetPx = Math.round(((d.getTime() - minTime) / 86400000) * pxDia);
      parts += '<div class="sigso-py-gantt-mesline" style="left:' + (base + offsetPx) + 'px"></div>';
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
    return '<div class="sigso-py-gantt-fondo">' + parts + '</div>';
  }

  // Regla de meses: una marca + etiqueta en el primer día de cada mes que
  // cae dentro del rango visible -- alcanza para ubicarse en cualquier zoom
  // (trimestre a semana) sin saturar de marcas de semana/día.
  function reglaMesesHtml_(minTime, maxTime, pxDia) {
    var ticks = '';
    var d = new Date(minTime);
    d = new Date(d.getFullYear(), d.getMonth(), 1);
    while (d.getTime() <= maxTime) {
      var offsetPx = Math.round(((d.getTime() - minTime) / 86400000) * pxDia);
      if (offsetPx >= 0) {
        ticks += '<div class="sigso-py-gantt-tick" style="left:' + offsetPx + 'px"><span>' + MESES_CORTOS[d.getMonth()] + ' ' + d.getFullYear() + '</span></div>';
      }
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
    return ticks;
  }

  // --- Entregables (v9.4, Fase 2) -------------------------------------

  function entregableBadgeVariante_(estado) {
    if (estado === 'APROBADO') return 'ok';
    if (estado === 'OBSERVADO') return 'alerta';
    return 'neutro';
  }

  function pintarEntregables_(detalle, puedeGestionar) {
    var puedeCrear = puedeAportar_(detalle);
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
        (e.estado === 'OBSERVADO' && e.observaciones ? '<div class="sigso-mt-bloqueo">' + Iconos.svg('pausado', { tam: 14 }) + ' ' + Componentes.escaparHtml(e.observaciones) + '</div>' : '') +
        (e.url_evidencia ? '<p class="sigso-ayuda"><a href="' + Componentes.escaparHtml(e.url_evidencia) + '" target="_blank" rel="noopener noreferrer">Ver evidencia</a></p>' : '') +
        botones +
      '</div>';
    }).join('');
    return acciones + '<div class="sigso-py-lista">' + filas + '</div>';
  }

  // --- Documentos (Fase 4, "centro documental") -------------------------
  //
  // Repositorio FORMAL: categoría, versionado real, historial y enlace
  // opcional a una tarea/hito -- distinto del adjunto suelto de la Sala
  // (que sigue existiendo para el archivo rápido de conversación). Mismo
  // patrón visual que Entregables/Riesgos arriba.

  var PROYECTO_DOC_CATEGORIA_ETIQUETA_ = {
    REQUISITOS: 'Requisitos', DISEÑO: 'Diseño', CONTRATO: 'Contrato',
    ACTA: 'Acta', APROBACION: 'Aprobación', ENTREGABLE: 'Entregable', OTRO: 'Otro'
  };
  var PROYECTO_DOC_CATEGORIAS_OPCIONES_ = Object.keys(PROYECTO_DOC_CATEGORIA_ETIQUETA_).map(function (c) {
    return { valor: c, texto: PROYECTO_DOC_CATEGORIA_ETIQUETA_[c] };
  });

  // v10 (lección de la Fase A del portafolio): la lista se repinta SOLA en
  // su propio contenedor (#py-docs-lista-wrap) al buscar/filtrar -- si se
  // repintara el toolbar completo en cada tecla, el <input> se destruiría y
  // el foco se perdería a cada letra.
  var docBusqueda_ = '';
  var docFiltroCategoria_ = '';

  function tamanoLegible_(bytes) {
    bytes = Number(bytes) || 0;
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (Math.round(bytes / (1024 * 1024) * 10) / 10) + ' MB';
  }

  function pintarDocumentos_(detalle, tareas, puedeGestionar) {
    // v13: el backend acepta crear/editar/eliminar/subir-versión a
    // cualquier miembro NO observador (mismo círculo que Entregables) --
    // "puedeGestionar" (líder/ADM) es más estricto y aquí solo aplica a
    // "marcar vigente" (rollback), dentro del modal de historial.
    var puedeCrear = puedeAportar_(detalle);
    // Sin accion disponible no se emite la barra: una cabecera vacia ocupa
    // espacio y no dice nada. Mismo criterio que Entregables y Riesgos.
    var acciones = puedeCrear
      ? '<div class="sigso-py-cabecera">' + Componentes.boton({ texto: '+ Subir documento', clase: 'js-py-nuevo-documento' }) + '</div>'
      : '';
    var todos = detalle.documentos || [];
    if (todos.length === 0) {
      return acciones + Componentes.vacio({ texto: 'Todavía no hay documentos en este proyecto.' });
    }
    var toolbar = '<div class="sigso-py-filtros">' +
      Componentes.campoTexto({
        id: 'py-docs-buscar', label: false, tipo: 'search', valor: docBusqueda_,
        placeholder: 'Buscar documento...', claseCampo: 'sigso-py-filtros__buscar'
      }) +
      Componentes.campoSelect({
        id: 'py-docs-filtro-categoria', label: false, placeholder: 'Todas las categorías', valor: docFiltroCategoria_,
        opciones: PROYECTO_DOC_CATEGORIAS_OPCIONES_
      }) +
    '</div>';
    return acciones + toolbar + '<div id="py-docs-lista-wrap">' + pintarListaDocumentos_(detalle, tareas, puedeCrear) + '</div>';
  }

  function pintarListaDocumentos_(detalle, tareas, puedeEditar) {
    var todos = detalle.documentos || [];
    var q = docBusqueda_.trim().toLowerCase();
    var filtrados = todos.filter(function (d) {
      if (docFiltroCategoria_ && d.categoria !== docFiltroCategoria_) return false;
      if (!q) return true;
      return (d.nombre || '').toLowerCase().indexOf(q) !== -1 || (d.descripcion || '').toLowerCase().indexOf(q) !== -1;
    });
    if (filtrados.length === 0) {
      return Componentes.vacio({ texto: 'Ningún documento coincide con la búsqueda.' });
    }
    var tareasPorId = {};
    (tareas || []).forEach(function (a) { tareasPorId[a.actividad_id] = a; });
    var hitosPorId = {};
    (detalle.hitos || []).forEach(function (h) { hitosPorId[h.hito_id] = h; });

    var filas = filtrados.map(function (d) {
      var refHtml = '';
      if (d.ref_tipo === 'ACTIVIDAD' && tareasPorId[d.ref_id]) {
        refHtml = '<button type="button" class="sigso-py-doc-ref js-py-doc-ir-ref" data-tab="tareas">' + Iconos.svg('enlace', { tam: 12 }) + ' ' + Componentes.escaparHtml(tareasPorId[d.ref_id].titulo) + '</button>';
      } else if (d.ref_tipo === 'HITO' && hitosPorId[d.ref_id]) {
        refHtml = '<button type="button" class="sigso-py-doc-ref js-py-doc-ir-ref" data-tab="hitos">' + Iconos.svg('enlace', { tam: 12 }) + ' ' + Componentes.escaparHtml(hitosPorId[d.ref_id].nombre) + '</button>';
      } else if (d.ref_tipo === 'REUNION') {
        // v13 (Fase 5): Reuniones se carga lazy y por separado -- mostrar el
        // título exacto aquí obligaría a cargarla solo para este chip. Un
        // enlace genérico a la pestaña sigue siendo accionable.
        refHtml = '<button type="button" class="sigso-py-doc-ref js-py-doc-ir-ref" data-tab="reuniones">' + Iconos.svg('enlace', { tam: 12 }) + ' Vinculado a una reunión</button>';
      } else if (d.ref_tipo === 'DECISION') {
        refHtml = '<button type="button" class="sigso-py-doc-ref js-py-doc-ir-ref" data-tab="decisiones">' + Iconos.svg('enlace', { tam: 12 }) + ' Vinculado a una decisión</button>';
      }
      var botones = '<div class="sigso-py-hito__acciones">' +
          Componentes.boton({ texto: 'Descargar', variante: 'sutil', clase: 'js-py-doc-descargar', idx: d.documento_id }) +
          (puedeEditar ? Componentes.boton({ texto: 'Nueva versión', variante: 'sutil', clase: 'js-py-doc-nueva-version', idx: d.documento_id }) : '') +
          Componentes.boton({ texto: 'Historial', variante: 'sutil', clase: 'js-py-doc-historial', idx: d.documento_id }) +
          (puedeEditar ? Componentes.boton({ texto: 'Editar', variante: 'sutil', clase: 'js-py-doc-editar', idx: d.documento_id }) : '') +
          (puedeEditar ? Componentes.boton({ texto: 'Eliminar', variante: 'sutil', clase: 'js-py-doc-eliminar', idx: d.documento_id }) : '') +
        '</div>';
      return '<div class="sigso-py-tarea">' +
        '<div class="sigso-py-tarea__top">' +
          '<span class="sigso-py-tarea__titulo">' + Componentes.escaparHtml(d.nombre) + '</span>' +
          Componentes.badge(PROYECTO_DOC_CATEGORIA_ETIQUETA_[d.categoria] || d.categoria, 'neutro') +
          '<span class="sigso-py-doc-vigente">' + Componentes.escaparHtml(d.version_vigente) + '</span>' +
        '</div>' +
        (d.descripcion ? '<p>' + Componentes.escaparHtml(d.descripcion) + '</p>' : '') +
        '<div class="sigso-py-tarea__meta">' +
          '<span>' + Componentes.escaparHtml(d.archivo_nombre || '') + '</span>' +
          '<span>' + tamanoLegible_(d.tamano_bytes) + '</span>' +
          '<span>Subido ' + fechaCorta_(d.fecha_creacion) + '</span>' +
        '</div>' +
        refHtml +
        botones +
      '</div>';
    }).join('');
    return '<div class="sigso-py-lista">' + filas + '</div>';
  }

  function repintarListaDocumentos_(cont) {
    var wrap = cont.querySelector('#py-docs-lista-wrap');
    if (!wrap || !datosDetalleActual_) return;
    var detalle = datosDetalleActual_.detalle;
    var puedeEditar = puedeAportar_(detalle);
    wrap.innerHTML = pintarListaDocumentos_(detalle, datosDetalleActual_.tareas, puedeEditar);
    wireListaDocumentos_(cont, detalle, datosDetalleActual_.tareas, puedeGestionarActual_(detalle));
  }

  // Mismo criterio que pintarDetalle_ usa para "puedeGestionar" (líder/ADM,
  // con fallback si el Backoffice aún no publicó puede_gestionar) -- se
  // repite aquí porque los repintados aislados (búsqueda/filtro) no pasan
  // por pintarDetalle_.
  function puedeGestionarActual_(detalle) {
    return detalle.puede_gestionar === true || detalle.rol_actual === 'LIDER';
  }

  // v13.5 (Fase 6): quien puede APORTAR al proyecto (crear tareas, subir
  // documentos, registrar riesgos, entregables, reuniones y decisiones).
  //
  // Espejo EXACTO de la regla del backend, que en las siete acciones abre
  // con:  contexto.rol === "ADM" || rol en {LIDER, INTEGRANTE, COLABORADOR}
  //
  // Antes cada pantalla repetia `rol_actual && rol_actual !== "OBSERVADOR"`,
  // que deja fuera al ADM que no es miembro del proyecto: su rol_actual
  // viene vacio. Resultado medido: Sala, Entregables, Documentos y Riesgos
  // se le mostraban SIN un solo boton, aunque el servidor habria aceptado
  // la accion. Es la UI escondiendo una capacidad que el backend concede.
  //
  // puede_gestionar ya vale true para ADM y para el LIDER, y false para
  // GERENCIA (solo lectura por diseño), asi que el espejo se mantiene.
  function puedeAportar_(detalle) {
    if (!detalle) return false;
    if (detalle.puede_gestionar === true) return true;
    return !!detalle.rol_actual && detalle.rol_actual !== 'OBSERVADOR';
  }

  function wireListaDocumentos_(cont, detalle, tareas, puedeGestionarEstricto) {
    function docPorId_(id) {
      var lista = (datosDetalleActual_ && datosDetalleActual_.detalle && datosDetalleActual_.detalle.documentos) || detalle.documentos || [];
      for (var i = 0; i < lista.length; i++) { if (lista[i].documento_id === id) return lista[i]; }
      return null;
    }
    cont.querySelectorAll('.js-py-doc-descargar').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var textoOriginal = btn.textContent;
        btn.disabled = true;
        btn.innerHTML = '<span class="sigso-spinner"></span>Descargando…';
        api_('descargarDocumentoProyecto', { proyecto_id: proyectoActivoId_, documento_id: btn.getAttribute('data-idx') }).then(function (r) {
          if (!r || !r.ok) { Componentes.aviso({ texto: (r && r.message) || 'No se pudo descargar el documento.', tipo: 'error' }); return; }
          descargarBase64Proyecto_(r.data.contenido_base64, r.data.nombre_archivo, r.data.mime);
        }).catch(function () {
          Componentes.aviso({ texto: 'No se pudo conectar con el servidor.', tipo: 'error' });
        }).finally(function () {
          btn.disabled = false; btn.textContent = textoOriginal;
        });
      });
    });
    cont.querySelectorAll('.js-py-doc-nueva-version').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var doc = docPorId_(btn.getAttribute('data-idx'));
        if (doc) abrirFormularioNuevaVersionDocumento_(doc);
      });
    });
    cont.querySelectorAll('.js-py-doc-historial').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var doc = docPorId_(btn.getAttribute('data-idx'));
        if (doc) abrirHistorialDocumento_(doc, puedeGestionarEstricto);
      });
    });
    cont.querySelectorAll('.js-py-doc-editar').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var doc = docPorId_(btn.getAttribute('data-idx'));
        if (doc) abrirFormularioEditarDocumento_(doc, detalle, tareas);
      });
    });
    cont.querySelectorAll('.js-py-doc-eliminar').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-idx');
        Componentes.confirmar({ titulo: 'Eliminar documento', mensaje: 'Se elimina de la lista; su historial de versiones se conserva. ¿Confirmas?' }).then(function (ok) {
          if (!ok) return;
          api_('gestionarDocumentoProyecto', { proyecto_id: proyectoActivoId_, accion: 'eliminar', documento_id: id }).then(function (r) {
            if (!r || !r.ok) { Componentes.aviso({ texto: (r && r.message) || 'No se pudo eliminar el documento.', tipo: 'error' }); return; }
            refrescarDetalle_();
          });
        });
      });
    });
    cont.querySelectorAll('.js-py-doc-ir-ref').forEach(function (btn) {
      btn.addEventListener('click', function () { cambiarPestana_(btn.getAttribute('data-tab')); });
    });
  }

  // --- Reuniones (Fase 5, "reuniones formales") --------------------------

  function pintarReuniones_(reuniones, detalle, tareas, puedeGestionar) {
    var puedeCrear = puedeAportar_(detalle);
    var acciones = '<div class="sigso-py-cabecera">' +
      (puedeCrear ? Componentes.boton({ texto: '+ Nueva reunión', clase: 'js-py-nueva-reunion' }) : '<span></span>') +
    '</div>';
    if (!reuniones.length) {
      return acciones + Componentes.vacio({ texto: 'Todavía no hay reuniones registradas.' });
    }
    var filas = reuniones.map(function (r) {
      var participantesTxt = (r.participantes || []).join(', ');
      var acuerdosHtml = (r.acuerdos || []).map(function (a) {
        var convertido = !!a.ref_id;
        return '<li class="sigso-py-acuerdo' + (convertido ? ' sigso-py-acuerdo--hecho' : '') + '">' +
          '<span class="sigso-py-acuerdo__texto">' + Componentes.escaparHtml(a.texto) + '</span>' +
          (convertido
            ? '<button type="button" class="sigso-py-doc-ref js-py-acuerdo-ir-tarea" data-idx="' + a.ref_id + '">' + Iconos.svg('enlace', { tam: 12 }) + ' Convertido en tarea</button>'
            : (puedeCrear
              ? '<span class="sigso-py-acuerdo__acciones">' +
                  Componentes.boton({ texto: 'Convertir en tarea', variante: 'sutil', clase: 'js-py-acuerdo-convertir', idx: a.acuerdo_id }) +
                  Componentes.boton({ texto: 'Quitar', variante: 'sutil', clase: 'js-py-acuerdo-eliminar', idx: a.acuerdo_id }) +
                '</span>'
              : '')) +
        '</li>';
      }).join('');
      var soloConTareasPendientes = (r.acuerdos || []).every(function (a) { return !a.ref_id; });
      return '<div class="sigso-py-tarea">' +
        '<div class="sigso-py-tarea__top">' +
          '<span class="sigso-py-tarea__titulo">' + Componentes.escaparHtml(r.titulo) + '</span>' +
          '<span class="sigso-py-doc-vigente">' + fechaCorta_(r.fecha) + '</span>' +
        '</div>' +
        (participantesTxt ? '<p class="sigso-ayuda"><b>Participantes:</b> ' + Componentes.escaparHtml(participantesTxt) + '</p>' : '') +
        (r.objetivo ? '<p><b>Objetivo:</b> ' + Componentes.escaparHtml(r.objetivo) + '</p>' : '') +
        (r.minuta ? '<p>' + Componentes.escaparHtml(r.minuta) + '</p>' : '') +
        (acuerdosHtml ? '<ul class="sigso-py-acuerdos">' + acuerdosHtml + '</ul>' : '<p class="sigso-ayuda">Sin acuerdos registrados.</p>') +
        (puedeCrear
          ? '<div class="sigso-py-hito__acciones">' +
              Componentes.boton({ texto: '+ Agregar acuerdo', variante: 'sutil', clase: 'js-py-reunion-agregar-acuerdo', idx: r.reunion_id }) +
              Componentes.boton({ texto: 'Editar', variante: 'sutil', clase: 'js-py-reunion-editar', idx: r.reunion_id }) +
              (soloConTareasPendientes ? Componentes.boton({ texto: 'Eliminar', variante: 'sutil', clase: 'js-py-reunion-eliminar', idx: r.reunion_id }) : '') +
            '</div>'
          : '') +
      '</div>';
    }).join('');
    return acciones + '<div class="sigso-py-lista">' + filas + '</div>';
  }

  // --- Decisiones (Fase 5, "registro de decisiones") ----------------------

  function pintarDecisiones_(decisiones, detalle, tareas, puedeGestionar) {
    var puedeCrear = puedeAportar_(detalle);
    var acciones = '<div class="sigso-py-cabecera">' +
      (puedeCrear ? Componentes.boton({ texto: '+ Nueva decisión', clase: 'js-py-nueva-decision' }) : '<span></span>') +
    '</div>';
    if (!decisiones.length) {
      return acciones + Componentes.vacio({ texto: 'Todavía no hay decisiones registradas.' });
    }
    var integrantesPorEmail = {};
    (detalle.integrantes || []).forEach(function (i) { integrantesPorEmail[normalizarEmail_(i.usuario_email)] = i.usuario_nombre || i.usuario_email; });

    var filas = decisiones.map(function (d) {
      return '<div class="sigso-py-tarea">' +
        '<div class="sigso-py-tarea__top">' +
          '<span class="sigso-py-tarea__titulo">' + Componentes.escaparHtml(d.descripcion) + '</span>' +
          '<span class="sigso-py-doc-vigente">' + fechaCorta_(d.fecha_decision) + '</span>' +
        '</div>' +
        (d.contexto ? '<p><b>Contexto:</b> ' + Componentes.escaparHtml(d.contexto) + '</p>' : '') +
        (d.impacto ? '<p><b>Impacto:</b> ' + Componentes.escaparHtml(d.impacto) + '</p>' : '') +
        '<div class="sigso-py-tarea__meta">' +
          '<span>Responsable: ' + Componentes.escaparHtml(integrantesPorEmail[normalizarEmail_(d.responsable_email)] || d.responsable_email) + '</span>' +
        '</div>' +
        (puedeCrear
          ? '<div class="sigso-py-hito__acciones">' +
              Componentes.boton({ texto: 'Editar', variante: 'sutil', clase: 'js-py-decision-editar', idx: d.decision_id }) +
              Componentes.boton({ texto: 'Eliminar', variante: 'sutil', clase: 'js-py-decision-eliminar', idx: d.decision_id }) +
            '</div>'
          : '') +
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
    var puedeCrear = puedeAportar_(detalle);
    var acciones = puedeCrear
      ? '<div class="sigso-py-cabecera">' + Componentes.boton({ texto: '+ Nuevo riesgo', clase: 'js-py-nuevo-riesgo' }) + '</div>'
      : '';
    var riesgos = detalle.riesgos || [];
    if (riesgos.length === 0) {
      return acciones + Componentes.vacio({ texto: 'Todavía no hay riesgos registrados.' });
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
          '<span>' + Componentes.badge(RIESGO_ESTADO_ETIQUETA[r.estado] || r.estado, r.estado === 'MATERIALIZADO' ? 'critico' : 'neutro') + '</span>' +
        '</div>' +
        (r.mitigacion ? '<p class="sigso-ayuda"><b>Mitigación:</b> ' + Componentes.escaparHtml(r.mitigacion) + '</p>' : '') +
        (puedeEditar
          ? '<div class="sigso-py-hito__acciones">' +
              Componentes.boton({ texto: 'Editar', variante: 'sutil', clase: 'js-py-riesgo-editar', idx: r.riesgo_id }) +
              (r.estado === 'ABIERTO' ? Componentes.boton({ texto: 'Marcar como problema', variante: 'sutil', clase: 'js-py-riesgo-materializar', idx: r.riesgo_id }) : '') +
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
    // v13 (Fase 2, "dashboard ejecutivo"): cada ítem de "Atención requerida"
    // navega a la pestaña donde vive -- mismo repintado sin red que el resto
    // de las pestañas (cambiarPestana_), nunca un link roto.
    cont.querySelectorAll('.js-py-atencion-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.getAttribute('data-tab');
        if (tab) cambiarPestana_(tab);
      });
    });

    var editar = cont.querySelector('.js-py-editar');
    if (editar) editar.addEventListener('click', function () { abrirFormularioEditar_(detalle.proyecto); });

    var cerrar = cont.querySelector('.js-py-cerrar');
    if (cerrar) cerrar.addEventListener('click', function () { manejarCerrarProyecto_(detalle.proyecto.proyecto_id); });

    // v10 (Fase D, propuesta 11): mismo patron que descargarOrdenTrabajo_
    // (detalle.js) -- pide el PDF en base64, lo pasa a Blob y dispara la
    // descarga. Sin ese paso no hay forma de bajar un binario que llega por
    // fetch/google.script.run como texto.
    var descargarPdf = cont.querySelector('.js-py-descargar-pdf');
    if (descargarPdf) {
      descargarPdf.addEventListener('click', function () {
        var textoOriginal = descargarPdf.textContent;
        descargarPdf.disabled = true;
        descargarPdf.innerHTML = '<span class="sigso-spinner"></span>Generando…';
        api_('descargarReporteProyecto', { proyecto_id: detalle.proyecto.proyecto_id }).then(function (r) {
          if (!r || !r.ok) {
            Componentes.aviso({ texto: (r && r.message) || 'No se pudo generar el reporte.', tipo: 'error' });
            return;
          }
          descargarBase64Proyecto_(r.data.pdf_base64, r.data.filename || ('Reporte-' + detalle.proyecto.proyecto_id + '.pdf'), 'application/pdf');
        }).catch(function () {
          Componentes.aviso({ texto: 'No se pudo conectar con el servidor.', tipo: 'error' });
        }).finally(function () {
          descargarPdf.disabled = false;
          descargarPdf.textContent = textoOriginal;
        });
      });
    }

    // v11 ("PDF ejecutivo configurable"): abre el modal de secciones/rango/
    // personas/estado -- la descarga en sí reusa exactamente el mismo patrón
    // de base64->Blob que "Descargar PDF" (arriba).
    var configurarInforme = cont.querySelector('.js-py-configurar-informe');
    if (configurarInforme) {
      configurarInforme.addEventListener('click', function () {
        abrirConfigurarInforme_(detalle);
      });
    }

    // v10 (Fase C, propuesta 07): guardar como plantilla -- solo pide el
    // nombre; la estructura (hitos) se copia tal cual esta ahora mismo.
    var guardarPlantilla = cont.querySelector('.js-py-guardar-plantilla');
    if (guardarPlantilla) {
      guardarPlantilla.addEventListener('click', function () {
        Componentes.prompt({
          titulo: 'Guardar como plantilla',
          mensaje: 'Se copian los hitos de este proyecto (nombre y descripción, sin fechas). Los entregables y las tareas no se copian.',
          valorInicial: detalle.proyecto.nombre,
          placeholder: 'Nombre de la plantilla',
          confirmar: 'Guardar plantilla'
        }).then(function (nombre) {
          if (nombre === null || nombre === undefined || String(nombre).trim() === '') return;
          api_('guardarProyectoComoPlantilla', { proyecto_id: detalle.proyecto.proyecto_id, nombre: nombre }).then(function (r) {
            if (!r || !r.ok) { Componentes.aviso({ texto: (r && r.message) || 'No se pudo guardar la plantilla.', tipo: 'error' }); return; }
            Componentes.aviso({ texto: 'Plantilla "' + nombre + '" guardada (' + r.data.total_hitos + ' hito(s)).', tipo: 'exito' });
          });
        });
      });
    }

    var formSala = cont.querySelector('#form-py-sala');
    if (formSala) {
      formSala.addEventListener('submit', function (evento) {
        evento.preventDefault();
        var cuerpo = document.getElementById('py-sala-cuerpo').value;
        var tipo = document.getElementById('py-sala-tipo').value;
        if (!cuerpo.trim()) return;
        var menciones = Array.from(cont.querySelectorAll('.js-py-mencion:checked')).map(function (el) { return el.value; });
        enviarModal_(evento, 'publicarEnSalaProyecto',
          { proyecto_id: proyectoActivoId_, tipo: tipo, cuerpo: cuerpo, menciones: menciones },
          function () { refrescarDetalle_(); });
      });
    }
    // v10 (Fase D, "adjuntos por proyecto"): elegir archivo solo habilita el
    // boton y muestra el nombre -- subir es un paso aparte (evita mandar
    // el archivo antes de que la persona confirme que es el correcto).
    var campoArchivo = cont.querySelector('#py-sala-archivo');
    var botonAdjuntar = cont.querySelector('.js-py-adjuntar-enviar');
    if (campoArchivo && botonAdjuntar) {
      campoArchivo.addEventListener('change', function () {
        var archivo = campoArchivo.files[0];
        cont.querySelector('#py-sala-archivo-nombre').textContent = archivo ? archivo.name : 'Ningún archivo elegido';
        botonAdjuntar.disabled = !archivo;
      });
      botonAdjuntar.addEventListener('click', function () {
        var archivo = campoArchivo.files[0];
        if (!archivo) return;
        var textoOriginal = botonAdjuntar.textContent;
        botonAdjuntar.disabled = true;
        botonAdjuntar.innerHTML = '<span class="sigso-spinner"></span>Subiendo…';
        var lector = new FileReader();
        lector.onload = function () {
          var base64 = lector.result.slice(lector.result.indexOf(',') + 1);
          api_('subirAdjuntoProyecto', {
            proyecto_id: proyectoActivoId_, nombre_archivo: archivo.name, contenido_base64: base64
          }).then(function (r) {
            if (!r || !r.ok) {
              Componentes.aviso({ texto: (r && r.message) || 'No se pudo subir el archivo.', tipo: 'error' });
              botonAdjuntar.disabled = false;
              botonAdjuntar.textContent = textoOriginal;
              return;
            }
            refrescarDetalle_();
          }).catch(function () {
            Componentes.aviso({ texto: 'No se pudo conectar con el servidor.', tipo: 'error' });
            botonAdjuntar.disabled = false;
            botonAdjuntar.textContent = textoOriginal;
          });
        };
        lector.readAsDataURL(archivo);
      });
    }
    cont.querySelectorAll('.js-py-descargar-adjunto').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var textoOriginal = btn.textContent;
        btn.disabled = true;
        btn.innerHTML = '<span class="sigso-spinner"></span>Descargando…';
        api_('descargarAdjuntoProyecto', { proyecto_id: proyectoActivoId_, evento_id: btn.getAttribute('data-idx') }).then(function (r) {
          if (!r || !r.ok) { Componentes.aviso({ texto: (r && r.message) || 'No se pudo descargar el archivo.', tipo: 'error' }); return; }
          descargarBase64Proyecto_(r.data.contenido_base64, r.data.nombre_archivo, r.data.mime);
        }).catch(function () {
          Componentes.aviso({ texto: 'No se pudo conectar con el servidor.', tipo: 'error' });
        }).finally(function () {
          btn.disabled = false;
          btn.textContent = textoOriginal;
        });
      });
    });

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

    cont.querySelectorAll('.js-py-editar-tarea').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = btn.getAttribute('data-idx');
        var tarea = null;
        for (var i = 0; i < tareas.length; i++) { if (tareas[i].actividad_id === id) { tarea = tareas[i]; break; } }
        if (tarea) abrirFormularioEditarTarea_(tarea, detalle, tareas);
      });
    });

    var btnAsignMasiva = cont.querySelector('.js-py-asignacion-masiva');
    if (btnAsignMasiva) btnAsignMasiva.addEventListener('click', function () { abrirAsignacionMasiva_(detalle, tareas); });

    // v10 (Fase A, propuesta 01): check-in inline -- mismo endpoint y mismos
    // tipos que "Mi trabajo" (manejarCheckin_ en actividades.js); aca solo
    // cambia que al terminar se refresca el PROYECTO, no la lista de "Mi
    // trabajo".
    wireCheckin_(cont, refrescarDetalle_);

    // v10 (Fase B): toggle Lista/Tablero -- solo cambia la PRESENTACION
    // (vistaTareas_), asi que repinta con cambiarPestana_ (sin red) en vez
    // de refrescarDetalle_.
    cont.querySelectorAll('.js-py-tareas-vista').forEach(function (btn) {
      btn.addEventListener('click', function () {
        vistaTareas_ = btn.getAttribute('data-idx');
        cambiarPestana_('tareas');
      });
    });
    wireKanbanDragDrop_(cont, refrescarDetalle_);

    // v10 (Fase E, "Carta Gantt de Dedicación"): toggle Dedicación/Plan y
    // navegación de la ventana de 14 días -- ambos repintan sin red, los
    // datos (tareas + bitácora) ya están en cache.
    cont.querySelectorAll('.js-py-cron-vista').forEach(function (btn) {
      btn.addEventListener('click', function () {
        vistaCronograma_ = btn.getAttribute('data-idx');
        // v11 (P3): "Analítica" es la única subvista con endpoint propio --
        // las demás repintan directo desde caché (cambiarPestana_).
        if (vistaCronograma_ === 'analitica') cargarAnaliticaProyecto_(cont);
        else cambiarPestana_('cronograma');
      });
    });
    var analiticaCsvBtn = cont.querySelector('.js-py-analitica-csv');
    if (analiticaCsvBtn) {
      analiticaCsvBtn.addEventListener('click', function () {
        var analitica = datosDetalleActual_ && datosDetalleActual_.analitica;
        if (!analitica) return;
        var nombreProyecto = (datosDetalleActual_.detalle && datosDetalleActual_.detalle.proyecto && datosDetalleActual_.detalle.proyecto.nombre) || 'proyecto';
        // Cabecera de documento, igual que los otros reportes del modulo:
        // un CSV que se abre dos semanas despues tiene que decir solo de
        // que proyecto es, de cuando y quien lo emitio.
        var emitido = new Date();
        var fechaTxt;
        try { fechaTxt = emitido.toLocaleString('es-CL', { dateStyle: 'long', timeStyle: 'short' }); }
        catch (e) { fechaTxt = emitido.toISOString().slice(0, 16).replace('T', ' '); }
        var filas = [
          ['SIGSO — Asesorías Integrales AyS SpA'],
          ['Reporte', 'Analítica de tareas (lead time / cycle time)'],
          ['Código', 'SIGSO-REP-PY-ANALITICA'],
          ['Proyecto', nombreProyecto],
          ['Emitido', fechaTxt],
          ['Generado por', (window.SIGSO_USUARIO && SIGSO_USUARIO.nombre) || ''],
          [],
          ['Tarea', 'Lead time (días)', 'Cycle time (días)', 'Tiempo en bloqueo (días)', 'Tiempo en revisión (días)']
        ];
        tareasConDatoAnalitica_(analitica).forEach(function (t) {
          filas.push([t.titulo, t.lead_time_dias, t.cycle_time_dias, t.tiempo_bloqueo_dias, t.tiempo_revision_dias]);
        });
        descargarCsv_('Analitica - ' + nombreProyecto + '.csv', filas);
      });
    }
    wireCartaControles_(cont, function () { cambiarPestana_('cronograma'); }, (datosDetalleActual_ && datosDetalleActual_.detalle) || null,
      // v12.2 ("llenar rápido, sin recarga"): actualización OPTIMISTA -- se
      // mergea el registro ya guardado en la bitácora en caché y se repinta al
      // instante desde caché (sin red, sin perder scroll); el rendimiento se
      // refresca en segundo plano. Fallback al refetch completo si por lo que
      // sea no hay caché o no llegó el registro (p. ej. "Mi dedicación").
      function (registroGuardado) {
        if (!datosDetalleActual_) return;
        // v12.5: el mismo callback sirve para guardar y para ELIMINAR (marca
        // __eliminado) -- ambos actualizan la carta en el acto, sin recarga.
        var ok = (registroGuardado && registroGuardado.__eliminado)
          ? eliminarRegistroDiaEnCache_(registroGuardado.actividad_id, registroGuardado.dia)
          : mergeRegistroDiaEnCache_(registroGuardado);
        if (ok) {
          repintarCronogramaDesdeCache_(cont);
          refrescarRendimientoEnSegundoPlano_(cont);
        } else {
          datosDetalleActual_.bitacora = undefined; cargarDatosCronograma_(cont);
        }
      });

    // v11 (P2, "Gantt navegable"): zoom, "Hoy" y arrastrar-para-reprogramar
    // -- solo existen cuando la vista Plan está pintada (los selectores
    // simplemente no encuentran nada en las otras vistas).
    cont.querySelectorAll('.js-py-gantt-zoom').forEach(function (btn) {
      btn.addEventListener('click', function () {
        planZoomIdx_ = Number(btn.getAttribute('data-idx'));
        cambiarPestana_('cronograma');
      });
    });
    var ganttHoyBtn = cont.querySelector('.js-py-gantt-hoy');
    if (ganttHoyBtn) {
      ganttHoyBtn.addEventListener('click', function () {
        var scroll = cont.querySelector('.sigso-py-gantt-scroll');
        var hoy = cont.querySelector('.sigso-py-gantt-hoy');
        if (scroll && hoy) scroll.scrollLeft = Math.max(0, parseFloat(hoy.style.left) - scroll.clientWidth / 2);
      });
    }
    // v13 (Fase 1): alternar el resaltado de ruta crítica -- solo repinta
    // desde caché (cambiarPestana_), sin red, igual que el zoom.
    var rutaCriticaBtn = cont.querySelector('.js-py-gantt-ruta-critica');
    if (rutaCriticaBtn) {
      rutaCriticaBtn.addEventListener('click', function () {
        mostrarRutaCritica_ = !mostrarRutaCritica_;
        cambiarPestana_('cronograma');
      });
    }
    // Reprogramar tras un arrastre: refresco completo (mismo criterio que el
    // botón 📅 de Dedicación -- fecha_compromiso vive en `tareas`, no en la
    // bitácora, así que hace falta releer el proyecto).
    wireGanttResize_(cont, planPxDiaActual_, planMinTimeActual_, function () { refrescarDetalle_(); });

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

    // --- v13 (Fase 4): documentos --------------------------------------
    var nuevoDocumento = cont.querySelector('.js-py-nuevo-documento');
    if (nuevoDocumento) nuevoDocumento.addEventListener('click', function () { abrirFormularioDocumento_(detalle, tareas); });
    var buscarDocs = cont.querySelector('#py-docs-buscar');
    if (buscarDocs) {
      buscarDocs.addEventListener('input', function () {
        docBusqueda_ = buscarDocs.value;
        repintarListaDocumentos_(cont);
      });
    }
    var filtroCategoriaDocs = cont.querySelector('#py-docs-filtro-categoria');
    if (filtroCategoriaDocs) {
      filtroCategoriaDocs.addEventListener('change', function () {
        docFiltroCategoria_ = filtroCategoriaDocs.value;
        repintarListaDocumentos_(cont);
      });
    }
    wireListaDocumentos_(cont, detalle, tareas, puedeGestionar);

    // --- v13 (Fase 5): reuniones -----------------------------------------
    var nuevaReunion = cont.querySelector('.js-py-nueva-reunion');
    if (nuevaReunion) nuevaReunion.addEventListener('click', function () { abrirFormularioReunion_(detalle); });

    function reunionesCache_() { return (datosDetalleActual_ && datosDetalleActual_.reuniones) || []; }
    function reunionPorId_(id) {
      var lista = reunionesCache_();
      for (var i = 0; i < lista.length; i++) { if (lista[i].reunion_id === id) return lista[i]; }
      return null;
    }
    function acuerdoPorId_(id) {
      var lista = reunionesCache_();
      for (var i = 0; i < lista.length; i++) {
        var encontrado = (lista[i].acuerdos || []).filter(function (a) { return a.acuerdo_id === id; })[0];
        if (encontrado) return encontrado;
      }
      return null;
    }
    cont.querySelectorAll('.js-py-reunion-editar').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var r = reunionPorId_(btn.getAttribute('data-idx'));
        if (r) abrirFormularioEditarReunion_(r);
      });
    });
    cont.querySelectorAll('.js-py-reunion-eliminar').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-idx');
        Componentes.confirmar({ titulo: 'Eliminar reunión', mensaje: '¿Confirmas eliminar esta reunión y sus acuerdos sin convertir?' }).then(function (ok) {
          if (!ok) return;
          api_('gestionarReunionProyecto', { proyecto_id: proyectoActivoId_, accion: 'eliminar', reunion_id: id }).then(function (r) {
            if (!r || !r.ok) { Componentes.aviso({ texto: (r && r.message) || 'No se pudo eliminar la reunión.', tipo: 'error' }); return; }
            if (datosDetalleActual_) datosDetalleActual_.reuniones = undefined;
            refrescarDetalle_();
          });
        });
      });
    });
    cont.querySelectorAll('.js-py-reunion-agregar-acuerdo').forEach(function (btn) {
      btn.addEventListener('click', function () { abrirFormularioAgregarAcuerdo_(btn.getAttribute('data-idx')); });
    });
    cont.querySelectorAll('.js-py-acuerdo-convertir').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var a = acuerdoPorId_(btn.getAttribute('data-idx'));
        if (a) abrirFormularioConvertirAcuerdo_(a, detalle);
      });
    });
    cont.querySelectorAll('.js-py-acuerdo-eliminar').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-idx');
        Componentes.confirmar({ titulo: 'Quitar acuerdo', mensaje: '¿Confirmas quitar este acuerdo?' }).then(function (ok) {
          if (!ok) return;
          api_('eliminarAcuerdoReunionProyecto', { proyecto_id: proyectoActivoId_, acuerdo_id: id }).then(function (r) {
            if (!r || !r.ok) { Componentes.aviso({ texto: (r && r.message) || 'No se pudo quitar el acuerdo.', tipo: 'error' }); return; }
            if (datosDetalleActual_) datosDetalleActual_.reuniones = undefined;
            refrescarDetalle_();
          });
        });
      });
    });
    cont.querySelectorAll('.js-py-acuerdo-ir-tarea').forEach(function (btn) {
      btn.addEventListener('click', function () { cambiarPestana_('tareas'); });
    });

    // --- v13 (Fase 5): decisiones ------------------------------------------
    var nuevaDecision = cont.querySelector('.js-py-nueva-decision');
    if (nuevaDecision) nuevaDecision.addEventListener('click', function () { abrirFormularioDecision_(detalle); });
    function decisionPorId_(id) {
      var lista = (datosDetalleActual_ && datosDetalleActual_.decisiones) || [];
      for (var i = 0; i < lista.length; i++) { if (lista[i].decision_id === id) return lista[i]; }
      return null;
    }
    cont.querySelectorAll('.js-py-decision-editar').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var d = decisionPorId_(btn.getAttribute('data-idx'));
        if (d) abrirFormularioEditarDecision_(d, detalle);
      });
    });
    cont.querySelectorAll('.js-py-decision-eliminar').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-idx');
        Componentes.confirmar({ titulo: 'Eliminar decisión', mensaje: '¿Confirmas eliminar esta decisión?' }).then(function (ok) {
          if (!ok) return;
          api_('gestionarDecisionProyecto', { proyecto_id: proyectoActivoId_, accion: 'eliminar', decision_id: id }).then(function (r) {
            if (!r || !r.ok) { Componentes.aviso({ texto: (r && r.message) || 'No se pudo eliminar la decisión.', tipo: 'error' }); return; }
            if (datosDetalleActual_) datosDetalleActual_.decisiones = undefined;
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

    // v13 (Fase 5, "riesgo vs. problema").
    cont.querySelectorAll('.js-py-riesgo-materializar').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-idx');
        Componentes.confirmar({ titulo: 'Marcar como problema', mensaje: 'Este riesgo deja de ser hipotético: ya está ocurriendo. ¿Confirmas?' }).then(function (ok) {
          if (!ok) return;
          api_('gestionarRiesgoProyecto', { proyecto_id: proyectoActivoId_, accion: 'materializar', riesgo_id: id }).then(function (respuesta) {
            if (!respuesta || !respuesta.ok) {
              Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo actualizar el riesgo.', tipo: 'error' });
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
      enviarModal_(evento, 'actualizarProyecto', {
        proyecto_id: p.proyecto_id,
        nombre: document.getElementById('py-ed-nombre').value,
        descripcion: document.getElementById('py-ed-descripcion').value,
        objetivo: document.getElementById('py-ed-objetivo').value,
        fecha_inicio: document.getElementById('py-ed-fecha-inicio').value,
        fecha_objetivo: document.getElementById('py-ed-fecha-objetivo').value,
        prioridad: document.getElementById('py-ed-prioridad').value,
        estado: document.getElementById('py-ed-estado').value
      }, function () { cerrar(); refrescarDetalle_(); });
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
    // v11 (P2, "subtareas con rollup"): un solo nivel -- una tarea que YA es
    // subtarea no puede a su vez ser padre (mismo límite que valida el
    // backend, Proyectos.crearTarea).
    var opcionesPadre = (tareas || []).filter(function (a) { return !a.es_subtarea; })
      .map(function (a) { return { valor: a.actividad_id, texto: a.titulo }; });
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
          (opcionesPadre.length ? Componentes.campoSelect({ id: 'py-t-padre', label: 'Tarea padre (opcional, la convierte en subtarea)', opciones: opcionesPadre }) : '') +
          '<div class="sigso-py-form-fila">' +
            Componentes.campoTexto({ id: 'py-t-fecha', label: 'Fecha comprometida', tipo: 'date', requerido: true }) +
            Componentes.campoSelect({
              id: 'py-t-prioridad', label: 'Prioridad', valor: 'P4', placeholder: false,
              opciones: [{ valor: 'P1', texto: 'P1' }, { valor: 'P2', texto: 'P2' }, { valor: 'P3', texto: 'P3' }, { valor: 'P4', texto: 'P4' }, { valor: 'P5', texto: 'P5' }]
            }) +
          '</div>' +
          // v10 (Fase G2, "el dia se justifica mejor"): meta cuantificable
          // OPCIONAL (ej. 16 "imágenes") -- habilita el rendimiento por
          // unidad de la Fase G3. Plegada para no ensuciar el alta rapida
          // de siempre cuando no aplica (mismo criterio que las menciones
          // de la Sala, ver .sigso-py-menciones).
          // v10 (multi-asignación): colaboradores OPCIONALES además del
          // responsable único. Plegado, mismo patrón que la meta y las
          // menciones de la Sala. El responsable es el dueño; los
          // colaboradores también pueden hacer check-in y ven la tarea en
          // "Mi trabajo".
          (opcionesIntegrantes.length
            ? '<details class="sigso-py-colab-opcional">' +
                '<summary>Colaboradores (opcional)</summary>' +
                '<p class="sigso-ayuda">Además del responsable. También podrán hacer check-in y verán la tarea en "Mi trabajo".</p>' +
                opcionesIntegrantes.map(function (o) {
                  return '<label class="sigso-campo-check"><input type="checkbox" class="js-py-colab" value="' +
                    Componentes.escaparHtml(o.valor) + '"> ' + Componentes.escaparHtml(o.texto) + '</label>';
                }).join('') +
              '</details>'
            : '') +
          '<details class="sigso-py-meta-opcional">' +
            '<summary>Meta cuantificable (opcional)</summary>' +
            '<div class="sigso-py-form-fila">' +
              Componentes.campoTexto({ id: 'py-t-meta-cantidad', label: 'Cantidad', tipo: 'number', placeholder: 'Ej: 16' }) +
              Componentes.campoTexto({ id: 'py-t-meta-unidad', label: 'Unidad', placeholder: 'Ej: imágenes' }) +
            '</div>' +
          '</details>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-py-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Crear tarea', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-py-tarea').addEventListener('submit', function (evento) {
      var hitoEl = document.getElementById('py-t-hito');
      var dependeEl = document.getElementById('py-t-depende');
      var padreEl = document.getElementById('py-t-padre');
      var responsable = document.getElementById('py-t-responsable').value;
      // Colaboradores marcados, sin el que ya es responsable (el backend
      // igual lo excluye, pero así el payload va limpio).
      var colaboradores = Array.from(fondo.querySelectorAll('.js-py-colab:checked'))
        .map(function (el) { return el.value; })
        .filter(function (email) { return email !== responsable; });
      enviarModal_(evento, 'crearTareaProyecto', {
        proyecto_id: proyectoActivoId_,
        hito_id: hitoEl ? hitoEl.value : '',
        depende_de: dependeEl ? dependeEl.value : '',
        tarea_padre_id: padreEl ? padreEl.value : '',
        titulo: document.getElementById('py-t-titulo').value,
        descripcion: document.getElementById('py-t-descripcion').value,
        colaboradores_emails: colaboradores,
        responsable_email: document.getElementById('py-t-responsable').value,
        fecha_compromiso: document.getElementById('py-t-fecha').value,
        prioridad: document.getElementById('py-t-prioridad').value,
        meta_cantidad: document.getElementById('py-t-meta-cantidad').value,
        meta_unidad: document.getElementById('py-t-meta-unidad').value
      }, function () { cerrar(); refrescarDetalle_(); });
    });
  }

  function abrirFormularioEditarTarea_(tarea, detalle, tareas) {
    var opcionesIntegrantes = (detalle.integrantes || []).map(function (i) {
      return { valor: i.usuario_email, texto: i.usuario_nombre || i.usuario_email };
    });
    var opcionesHitos = (detalle.hitos || []).map(function (h) { return { valor: h.hito_id, texto: h.nombre }; });
    var opcionesDependencia = (tareas || []).filter(function (a) { return a.actividad_id !== tarea.actividad_id; })
      .map(function (a) { return { valor: a.actividad_id, texto: a.titulo }; });
    var opcionesPadre = (tareas || []).filter(function (a) { return !a.es_subtarea && a.actividad_id !== tarea.actividad_id; })
      .map(function (a) { return { valor: a.actividad_id, texto: a.titulo }; });
    var colabActuales = (tarea.colaboradores || []).map(function (c) { return normalizarEmail_(c.email); });
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Editar tarea</h3>' +
        '<form id="form-py-tarea-editar">' +
          Componentes.campoTexto({ id: 'py-te-titulo', label: 'Título', valor: tarea.titulo, requerido: true }) +
          Componentes.campoTextarea({ id: 'py-te-descripcion', label: 'Descripción', valor: tarea.descripcion }) +
          Componentes.campoSelect({ id: 'py-te-responsable', label: 'Responsable', opciones: opcionesIntegrantes, valor: tarea.responsable_email, requerido: true }) +
          (opcionesHitos.length ? Componentes.campoSelect({ id: 'py-te-hito', label: 'Hito (opcional)', opciones: opcionesHitos, valor: tarea.hito_id }) : '') +
          (opcionesDependencia.length ? Componentes.campoSelect({ id: 'py-te-depende', label: 'Depende de (opcional)', opciones: opcionesDependencia, valor: tarea.depende_de }) : '') +
          (opcionesPadre.length ? Componentes.campoSelect({ id: 'py-te-padre', label: 'Tarea padre (opcional)', opciones: opcionesPadre, valor: tarea.tarea_padre_id }) : '') +
          '<div class="sigso-py-form-fila">' +
            Componentes.campoTexto({ id: 'py-te-fecha', label: 'Fecha comprometida', tipo: 'date', valor: fechaISOCorta_(tarea.fecha_compromiso), requerido: true }) +
            Componentes.campoSelect({
              id: 'py-te-prioridad', label: 'Prioridad', valor: tarea.prioridad || 'P4', placeholder: false,
              opciones: [{ valor: 'P1', texto: 'P1' }, { valor: 'P2', texto: 'P2' }, { valor: 'P3', texto: 'P3' }, { valor: 'P4', texto: 'P4' }, { valor: 'P5', texto: 'P5' }]
            }) +
          '</div>' +
          (opcionesIntegrantes.length
            ? '<details class="sigso-py-colab-opcional" open>' +
                '<summary>Colaboradores</summary>' +
                '<p class="sigso-ayuda">Además del responsable. También podrán hacer check-in y verán la tarea en "Mi trabajo".</p>' +
                opcionesIntegrantes.map(function (o) {
                  var marcado = colabActuales.indexOf(normalizarEmail_(o.valor)) !== -1;
                  return '<label class="sigso-campo-check"><input type="checkbox" class="js-py-colab-edit" value="' +
                    Componentes.escaparHtml(o.valor) + '"' + (marcado ? ' checked' : '') + '> ' + Componentes.escaparHtml(o.texto) + '</label>';
                }).join('') +
              '</details>'
            : '') +
          '<details class="sigso-py-meta-opcional"' + (tarea.meta_cantidad ? ' open' : '') + '>' +
            '<summary>Meta cuantificable (opcional)</summary>' +
            '<div class="sigso-py-form-fila">' +
              Componentes.campoTexto({ id: 'py-te-meta-cantidad', label: 'Cantidad', tipo: 'number', valor: tarea.meta_cantidad, placeholder: 'Ej: 16' }) +
              Componentes.campoTexto({ id: 'py-te-meta-unidad', label: 'Unidad', valor: tarea.meta_unidad, placeholder: 'Ej: imágenes' }) +
            '</div>' +
          '</details>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-py-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar cambios', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-py-tarea-editar').addEventListener('submit', function (evento) {
      var hitoEl = document.getElementById('py-te-hito');
      var dependeEl = document.getElementById('py-te-depende');
      var padreEl = document.getElementById('py-te-padre');
      var responsable = document.getElementById('py-te-responsable').value;
      var colaboradores = Array.from(fondo.querySelectorAll('.js-py-colab-edit:checked'))
        .map(function (el) { return el.value; })
        .filter(function (email) { return email !== responsable; });
      enviarModal_(evento, 'editarTareaProyecto', {
        proyecto_id: proyectoActivoId_,
        actividad_id: tarea.actividad_id,
        hito_id: hitoEl ? hitoEl.value : '',
        depende_de: dependeEl ? dependeEl.value : '',
        tarea_padre_id: padreEl ? padreEl.value : '',
        titulo: document.getElementById('py-te-titulo').value,
        descripcion: document.getElementById('py-te-descripcion').value,
        colaboradores_emails: colaboradores,
        responsable_email: responsable,
        fecha_compromiso: document.getElementById('py-te-fecha').value,
        prioridad: document.getElementById('py-te-prioridad').value,
        meta_cantidad: document.getElementById('py-te-meta-cantidad').value,
        meta_unidad: document.getElementById('py-te-meta-unidad').value
      }, function () { cerrar(); refrescarDetalle_(); });
    });
  }

  function abrirAsignacionMasiva_(detalle, tareas) {
    var opcionesIntegrantes = (detalle.integrantes || []).map(function (i) {
      return { valor: i.usuario_email, texto: i.usuario_nombre || i.usuario_email };
    });
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Asignación masiva</h3>' +
        '<form id="form-py-asignacion-masiva">' +
          '<p class="sigso-ayuda">Selecciona las tareas y elige cómo asignar al integrante.</p>' +
          Componentes.campoSelect({ id: 'py-am-persona', label: 'Integrante a asignar', opciones: opcionesIntegrantes, requerido: true }) +
          Componentes.campoSelect({
            id: 'py-am-modo', label: '¿Cómo asignar?', placeholder: false, valor: 'colaborador',
            opciones: [
              { valor: 'colaborador', texto: 'Agregar como colaborador' },
              { valor: 'responsable', texto: 'Cambiar responsable' }
            ]
          }) +
          '<fieldset class="sigso-py-am-tareas">' +
            '<legend>Tareas</legend>' +
            '<label class="sigso-campo-check sigso-py-am-todas"><input type="checkbox" id="py-am-todas"> <b>Seleccionar todas</b></label>' +
            tareas.map(function (a) {
              return '<label class="sigso-campo-check"><input type="checkbox" class="js-py-am-tarea" value="' +
                Componentes.escaparHtml(a.actividad_id) + '"> ' + Componentes.escaparHtml(a.titulo) + '</label>';
            }).join('') +
          '</fieldset>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-py-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Aplicar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('py-am-todas').addEventListener('change', function () {
      var marcado = this.checked;
      fondo.querySelectorAll('.js-py-am-tarea').forEach(function (cb) { cb.checked = marcado; });
    });
    document.getElementById('form-py-asignacion-masiva').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var persona = document.getElementById('py-am-persona').value;
      var modo = document.getElementById('py-am-modo').value;
      var seleccionadas = Array.from(fondo.querySelectorAll('.js-py-am-tarea:checked')).map(function (cb) { return cb.value; });
      if (!seleccionadas.length) { Componentes.toast('Selecciona al menos una tarea.', 'error'); return; }
      var tareasMap = {};
      tareas.forEach(function (a) { tareasMap[a.actividad_id] = a; });
      var btnSubmit = fondo.querySelector('[type="submit"]');
      if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.textContent = 'Aplicando...'; }
      var promesas = seleccionadas.map(function (actId) {
        var t = tareasMap[actId];
        if (!t) return Promise.resolve({ ok: true });
        var payload = { proyecto_id: proyectoActivoId_, actividad_id: actId };
        if (modo === 'responsable') {
          payload.responsable_email = persona;
        } else {
          var colabExistentes = (t.colaboradores || []).map(function (c) { return c.email; });
          if (colabExistentes.indexOf(persona) === -1) colabExistentes.push(persona);
          payload.colaboradores_emails = colabExistentes;
        }
        return apiSeguro_('editarTareaProyecto', payload);
      });
      Promise.all(promesas).then(function (resultados) {
        var errores = resultados.filter(function (r) { return !r || !r.ok; }).length;
        cerrar();
        Componentes.aviso({ texto: seleccionadas.length + ' tarea(s) actualizadas.' + (errores ? ' (' + errores + ' con error)' : ''), tipo: errores ? 'error' : 'ok' });
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
      enviarModal_(evento, 'gestionarHitoProyecto', {
        proyecto_id: proyectoActivoId_,
        nombre: document.getElementById('py-h-nombre').value,
        descripcion: document.getElementById('py-h-descripcion').value,
        fecha_objetivo: document.getElementById('py-h-fecha').value
      }, function () { cerrar(); refrescarDetalle_(); });
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
      enviarModal_(evento, 'gestionarHitoProyecto', {
        proyecto_id: proyectoActivoId_,
        hito_id: h.hito_id,
        nombre: document.getElementById('py-he-nombre').value,
        descripcion: document.getElementById('py-he-descripcion').value,
        fecha_objetivo: document.getElementById('py-he-fecha').value,
        estado: document.getElementById('py-he-estado').value
      }, function () { cerrar(); refrescarDetalle_(); });
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
      enviarModal_(evento, 'gestionarIntegranteProyecto', {
        proyecto_id: proyectoActivoId_,
        usuario_email: document.getElementById('py-i-email').value,
        usuario_nombre: document.getElementById('py-i-nombre').value,
        rol_proyecto: document.getElementById('py-i-rol').value,
        responsabilidad: document.getElementById('py-i-responsabilidad').value
      }, function () { cerrar(); refrescarDetalle_(); });
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
      var hitoEl = document.getElementById('py-e-hito');
      enviarModal_(evento, 'gestionarEntregableProyecto', {
        proyecto_id: proyectoActivoId_,
        nombre: document.getElementById('py-e-nombre').value,
        descripcion: document.getElementById('py-e-descripcion').value,
        responsable_email: document.getElementById('py-e-responsable').value,
        hito_id: hitoEl ? hitoEl.value : '',
        fecha_comprometida: document.getElementById('py-e-fecha').value
      }, function () { cerrar(); refrescarDetalle_(); });
    });
  }

  // v9.4 (Fase 3): nuevo riesgo. nivel lo calcula el backend (probabilidad x
  // impacto) -- el formulario nunca lo pide ni lo muestra como campo editable.
  // --- Reuniones (Fase 5) --------------------------------------------------

  // Crea una reunión: los acuerdos se escriben UNO POR LÍNEA en un textarea
  // (mismo criterio que redactar una minuta real) -- se parten en el submit,
  // no hace falta una UI de fieldset repetible para la primera versión.
  function abrirFormularioReunion_(detalle) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Nueva reunión</h3>' +
        '<form id="form-py-reunion">' +
          Componentes.campoTexto({ id: 'py-reu-titulo', label: 'Título', requerido: true }) +
          Componentes.campoTexto({ id: 'py-reu-fecha', label: 'Fecha', tipo: 'date', valor: fechaISOCorta_(new Date().toISOString()) }) +
          Componentes.campoTexto({ id: 'py-reu-participantes', label: 'Participantes (separados por coma)', placeholder: 'leo@rld.cl, Cliente ACME' }) +
          Componentes.campoTextarea({ id: 'py-reu-objetivo', label: 'Objetivo (opcional)' }) +
          Componentes.campoTextarea({ id: 'py-reu-minuta', label: 'Minuta (opcional)' }) +
          Componentes.campoTextarea({ id: 'py-reu-acuerdos', label: 'Acuerdos (opcional, uno por línea)', placeholder: 'Definir estados CRM\nEnviar propuesta de flujo' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-py-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Crear reunión', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    fondo.querySelector('#form-py-reunion').addEventListener('submit', function (evento) {
      var participantes = document.getElementById('py-reu-participantes').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      var acuerdos = document.getElementById('py-reu-acuerdos').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      enviarModal_(evento, 'gestionarReunionProyecto', {
        proyecto_id: proyectoActivoId_,
        titulo: document.getElementById('py-reu-titulo').value,
        fecha: document.getElementById('py-reu-fecha').value,
        participantes: participantes,
        objetivo: document.getElementById('py-reu-objetivo').value,
        minuta: document.getElementById('py-reu-minuta').value,
        acuerdos: acuerdos
      }, function () { cerrar(); refrescarDetalle_(); });
    });
  }

  function abrirFormularioEditarReunion_(reunion) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Editar reunión</h3>' +
        '<form id="form-py-reunion-editar">' +
          Componentes.campoTexto({ id: 'py-ree-titulo', label: 'Título', valor: reunion.titulo, requerido: true }) +
          Componentes.campoTexto({ id: 'py-ree-fecha', label: 'Fecha', tipo: 'date', valor: fechaISOCorta_(reunion.fecha) }) +
          Componentes.campoTexto({ id: 'py-ree-participantes', label: 'Participantes (separados por coma)', valor: (reunion.participantes || []).join(', ') }) +
          Componentes.campoTextarea({ id: 'py-ree-objetivo', label: 'Objetivo', valor: reunion.objetivo }) +
          Componentes.campoTextarea({ id: 'py-ree-minuta', label: 'Minuta', valor: reunion.minuta }) +
          '<p class="sigso-ayuda">Los acuerdos se agregan/quitan desde la tarjeta de la reunión, no aquí.</p>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-py-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    fondo.querySelector('#form-py-reunion-editar').addEventListener('submit', function (evento) {
      var participantes = document.getElementById('py-ree-participantes').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      enviarModal_(evento, 'gestionarReunionProyecto', {
        proyecto_id: proyectoActivoId_,
        reunion_id: reunion.reunion_id,
        titulo: document.getElementById('py-ree-titulo').value,
        fecha: document.getElementById('py-ree-fecha').value,
        participantes: participantes,
        objetivo: document.getElementById('py-ree-objetivo').value,
        minuta: document.getElementById('py-ree-minuta').value
      }, function () { cerrar(); refrescarDetalle_(); });
    });
  }

  function abrirFormularioAgregarAcuerdo_(reunionId) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Agregar acuerdo</h3>' +
        '<form id="form-py-acuerdo">' +
          Componentes.campoTextarea({ id: 'py-ac-texto', label: 'Acuerdo', requerido: true }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-py-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Agregar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    fondo.querySelector('#form-py-acuerdo').addEventListener('submit', function (evento) {
      enviarModal_(evento, 'agregarAcuerdoReunionProyecto', {
        proyecto_id: proyectoActivoId_, reunion_id: reunionId, texto: document.getElementById('py-ac-texto').value
      }, function () { cerrar(); refrescarDetalle_(); });
    });
  }

  // Convierte un acuerdo en tarea real -- mismo espíritu que "Convertir en
  // tarea" de la Sala, pero con la traza en el acuerdo puntual.
  function abrirFormularioConvertirAcuerdo_(acuerdo, detalle) {
    var opcionesIntegrantes = (detalle.integrantes || []).map(function (i) {
      return { valor: i.usuario_email, texto: i.usuario_nombre || i.usuario_email };
    });
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Convertir en tarea</h3>' +
        '<p class="sigso-ayuda">' + Componentes.escaparHtml(acuerdo.texto) + '</p>' +
        '<form id="form-py-acuerdo-convertir">' +
          Componentes.campoTexto({ id: 'py-acc-titulo', label: 'Título de la tarea', valor: acuerdo.texto, requerido: true }) +
          Componentes.campoSelect({ id: 'py-acc-responsable', label: 'Responsable', opciones: opcionesIntegrantes, requerido: true }) +
          Componentes.campoTexto({ id: 'py-acc-fecha', label: 'Fecha comprometida', tipo: 'date', requerido: true }) +
          Componentes.campoSelect({
            id: 'py-acc-prioridad', label: 'Prioridad', valor: 'P4', placeholder: false,
            opciones: [{ valor: 'P1', texto: 'P1' }, { valor: 'P2', texto: 'P2' }, { valor: 'P3', texto: 'P3' }, { valor: 'P4', texto: 'P4' }, { valor: 'P5', texto: 'P5' }]
          }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-py-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Convertir', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    fondo.querySelector('#form-py-acuerdo-convertir').addEventListener('submit', function (evento) {
      enviarModal_(evento, 'convertirAcuerdoEnTareaProyecto', {
        proyecto_id: proyectoActivoId_, acuerdo_id: acuerdo.acuerdo_id,
        titulo: document.getElementById('py-acc-titulo').value,
        responsable_email: document.getElementById('py-acc-responsable').value,
        fecha_compromiso: document.getElementById('py-acc-fecha').value,
        prioridad: document.getElementById('py-acc-prioridad').value
      }, function () { cerrar(); refrescarDetalle_(); });
    });
  }

  // --- Decisiones (Fase 5) --------------------------------------------------

  function abrirFormularioDecision_(detalle) {
    var opcionesIntegrantes = (detalle.integrantes || []).map(function (i) {
      return { valor: i.usuario_email, texto: i.usuario_nombre || i.usuario_email };
    });
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Nueva decisión</h3>' +
        '<form id="form-py-decision">' +
          Componentes.campoTextarea({ id: 'py-dec-descripcion', label: 'Decisión', requerido: true }) +
          Componentes.campoTexto({ id: 'py-dec-fecha', label: 'Fecha', tipo: 'date', valor: fechaISOCorta_(new Date().toISOString()) }) +
          Componentes.campoSelect({ id: 'py-dec-responsable', label: 'Responsable (opcional, por defecto el líder)', opciones: opcionesIntegrantes }) +
          Componentes.campoTextarea({ id: 'py-dec-contexto', label: 'Contexto (opcional)' }) +
          Componentes.campoTextarea({ id: 'py-dec-impacto', label: 'Impacto (opcional)' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-py-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Registrar decisión', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    fondo.querySelector('#form-py-decision').addEventListener('submit', function (evento) {
      enviarModal_(evento, 'gestionarDecisionProyecto', {
        proyecto_id: proyectoActivoId_,
        descripcion: document.getElementById('py-dec-descripcion').value,
        fecha_decision: document.getElementById('py-dec-fecha').value,
        responsable_email: document.getElementById('py-dec-responsable').value,
        contexto: document.getElementById('py-dec-contexto').value,
        impacto: document.getElementById('py-dec-impacto').value
      }, function () { cerrar(); refrescarDetalle_(); });
    });
  }

  function abrirFormularioEditarDecision_(decision, detalle) {
    var opcionesIntegrantes = (detalle.integrantes || []).map(function (i) {
      return { valor: i.usuario_email, texto: i.usuario_nombre || i.usuario_email };
    });
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Editar decisión</h3>' +
        '<form id="form-py-decision-editar">' +
          Componentes.campoTextarea({ id: 'py-dece-descripcion', label: 'Decisión', valor: decision.descripcion, requerido: true }) +
          Componentes.campoTexto({ id: 'py-dece-fecha', label: 'Fecha', tipo: 'date', valor: fechaISOCorta_(decision.fecha_decision) }) +
          Componentes.campoSelect({ id: 'py-dece-responsable', label: 'Responsable', opciones: opcionesIntegrantes, valor: decision.responsable_email }) +
          Componentes.campoTextarea({ id: 'py-dece-contexto', label: 'Contexto', valor: decision.contexto }) +
          Componentes.campoTextarea({ id: 'py-dece-impacto', label: 'Impacto', valor: decision.impacto }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-py-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    fondo.querySelector('#form-py-decision-editar').addEventListener('submit', function (evento) {
      enviarModal_(evento, 'gestionarDecisionProyecto', {
        proyecto_id: proyectoActivoId_,
        decision_id: decision.decision_id,
        descripcion: document.getElementById('py-dece-descripcion').value,
        fecha_decision: document.getElementById('py-dece-fecha').value,
        responsable_email: document.getElementById('py-dece-responsable').value,
        contexto: document.getElementById('py-dece-contexto').value,
        impacto: document.getElementById('py-dece-impacto').value
      }, function () { cerrar(); refrescarDetalle_(); });
    });
  }

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
      enviarModal_(evento, 'gestionarRiesgoProyecto', {
        proyecto_id: proyectoActivoId_,
        descripcion: document.getElementById('py-r-descripcion').value,
        probabilidad: document.getElementById('py-r-probabilidad').value,
        impacto: document.getElementById('py-r-impacto').value,
        responsable_email: document.getElementById('py-r-responsable').value,
        mitigacion: document.getElementById('py-r-mitigacion').value
      }, function () { cerrar(); refrescarDetalle_(); });
    });
  }

  // --- Documentos (Fase 4, "centro documental") --------------------------

  // Opciones "Relacionado con": tareas + hitos del proyecto, codificadas
  // como "TIPO::id" en el <option value> (un solo <select>, sin agrupar por
  // tipo aparte -- more simple, y la lista de un proyecto rara vez es tan
  // larga como para necesitar dos selects).
  function opcionesReferenciaDocumento_(detalle, tareas) {
    // v13 (Fase 5): Reuniones/Decisiones se agregan SOLO si ya están en
    // caché (esas pestañas cargan lazy) -- no vale la pena forzar una
    // llamada de red solo para poblar este selector; si el usuario nunca
    // visitó esa pestaña en esta sesión, igual puede enlazar a tarea/hito.
    var reuniones = (datosDetalleActual_ && datosDetalleActual_.reuniones) || [];
    var decisiones = (datosDetalleActual_ && datosDetalleActual_.decisiones) || [];
    return (tareas || []).map(function (a) { return { valor: 'ACTIVIDAD::' + a.actividad_id, texto: 'Tarea: ' + a.titulo }; })
      .concat((detalle.hitos || []).map(function (h) { return { valor: 'HITO::' + h.hito_id, texto: 'Hito: ' + h.nombre }; }))
      .concat(reuniones.map(function (r) { return { valor: 'REUNION::' + r.reunion_id, texto: 'Reunión: ' + r.titulo }; }))
      .concat(decisiones.map(function (d) { return { valor: 'DECISION::' + d.decision_id, texto: 'Decisión: ' + d.descripcion.slice(0, 40) }; }));
  }

  // v13 (Fase 4): "elegir archivo habilita el nombre visible" -- mismo
  // patrón que ya usa el adjunto de la Sala (js-py-adjuntar-enviar), aquí
  // factorizado porque se repite en "nuevo documento" y "nueva versión".
  function wireCampoArchivoDocumento_(fondo, idInput, idNombre) {
    var campo = fondo.querySelector('#' + idInput);
    campo.addEventListener('change', function () {
      var archivo = campo.files[0];
      fondo.querySelector('#' + idNombre).textContent = archivo ? archivo.name : 'Ningún archivo elegido';
    });
    return campo;
  }

  function campoArchivoDocumentoHtml_(idInput, idNombre) {
    return '<div class="sigso-py-adjuntar">' +
      '<label for="' + idInput + '" class="sigso-boton sigso-boton--sutil sigso-boton--con-icono">' +
        Iconos.svg('adjunto', { tam: 14 }) + 'Elegir archivo</label>' +
      '<input type="file" id="' + idInput + '" class="sigso-oculto" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.webp">' +
      '<span class="sigso-py-adjuntar__nombre" id="' + idNombre + '">Ningún archivo elegido</span>' +
    '</div>';
  }

  // Sube un documento NUEVO -- a diferencia del adjunto suelto de la Sala,
  // SIEMPRE nace con su primera versión (un documento sin ninguna versión no
  // tiene sentido en un repositorio). No usa enviarModal_ porque el archivo
  // necesita pasar primero por FileReader (async) antes del api_.
  function abrirFormularioDocumento_(detalle, tareas) {
    var opcionesRef = opcionesReferenciaDocumento_(detalle, tareas);
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Subir documento</h3>' +
        '<form id="form-py-documento">' +
          Componentes.campoTexto({ id: 'py-doc-nombre', label: 'Nombre', requerido: true }) +
          Componentes.campoSelect({
            id: 'py-doc-categoria', label: 'Categoría', valor: 'OTRO', placeholder: false,
            opciones: PROYECTO_DOC_CATEGORIAS_OPCIONES_
          }) +
          Componentes.campoTextarea({ id: 'py-doc-descripcion', label: 'Descripción (opcional)' }) +
          (opcionesRef.length ? Componentes.campoSelect({ id: 'py-doc-ref', label: 'Relacionado con (opcional)', opciones: opcionesRef, placeholder: 'Ninguna' }) : '') +
          campoArchivoDocumentoHtml_('py-doc-archivo', 'py-doc-archivo-nombre') +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-py-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Subir documento', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    var campoArchivo = wireCampoArchivoDocumento_(fondo, 'py-doc-archivo', 'py-doc-archivo-nombre');
    fondo.querySelector('#form-py-documento').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var btn = evento.currentTarget.querySelector('button[type="submit"]');
      if (btn.disabled) return;
      var archivo = campoArchivo.files[0];
      if (!archivo) { Componentes.aviso({ texto: 'Elige un archivo.', tipo: 'error' }); return; }
      var refEl = fondo.querySelector('#py-doc-ref');
      var refPartes = (refEl && refEl.value) ? refEl.value.split('::') : ['', ''];
      var textoOriginal = btn.textContent;
      btn.disabled = true;
      btn.innerHTML = '<span class="sigso-spinner"></span>Subiendo…';
      var lector = new FileReader();
      lector.onload = function () {
        var base64 = lector.result.slice(lector.result.indexOf(',') + 1);
        api_('gestionarDocumentoProyecto', {
          proyecto_id: proyectoActivoId_,
          nombre: document.getElementById('py-doc-nombre').value,
          categoria: document.getElementById('py-doc-categoria').value,
          descripcion: document.getElementById('py-doc-descripcion').value,
          ref_tipo: refPartes[0], ref_id: refPartes[1],
          nombre_archivo: archivo.name, contenido_base64: base64
        }).then(function (r) {
          if (!r || !r.ok) {
            Componentes.aviso({ texto: (r && r.message) || 'No se pudo subir el documento.', tipo: 'error' });
            btn.disabled = false; btn.textContent = textoOriginal;
            return;
          }
          cerrar(); refrescarDetalle_();
        }).catch(function () {
          Componentes.aviso({ texto: 'No se pudo conectar con el servidor.', tipo: 'error' });
          btn.disabled = false; btn.textContent = textoOriginal;
        });
      };
      lector.readAsDataURL(archivo);
    });
  }

  // Sube una nueva versión de un documento EXISTENTE.
  function abrirFormularioNuevaVersionDocumento_(doc) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Nueva versión</h3>' +
        '<p class="sigso-ayuda">' + Componentes.escaparHtml(doc.nombre) + ' — vigente hoy: ' + Componentes.escaparHtml(doc.version_vigente) + '</p>' +
        '<form id="form-py-doc-version">' +
          Componentes.campoTextarea({ id: 'py-docv-comentario', label: 'Qué cambió (opcional)' }) +
          campoArchivoDocumentoHtml_('py-docv-archivo', 'py-docv-archivo-nombre') +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-py-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Subir versión', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    var campoArchivo = wireCampoArchivoDocumento_(fondo, 'py-docv-archivo', 'py-docv-archivo-nombre');
    fondo.querySelector('#form-py-doc-version').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var btn = evento.currentTarget.querySelector('button[type="submit"]');
      if (btn.disabled) return;
      var archivo = campoArchivo.files[0];
      if (!archivo) { Componentes.aviso({ texto: 'Elige un archivo.', tipo: 'error' }); return; }
      var textoOriginal = btn.textContent;
      btn.disabled = true;
      btn.innerHTML = '<span class="sigso-spinner"></span>Subiendo…';
      var lector = new FileReader();
      lector.onload = function () {
        var base64 = lector.result.slice(lector.result.indexOf(',') + 1);
        api_('subirVersionDocumentoProyecto', {
          proyecto_id: proyectoActivoId_, documento_id: doc.documento_id,
          comentario: document.getElementById('py-docv-comentario').value,
          nombre_archivo: archivo.name, contenido_base64: base64
        }).then(function (r) {
          if (!r || !r.ok) {
            Componentes.aviso({ texto: (r && r.message) || 'No se pudo subir la versión.', tipo: 'error' });
            btn.disabled = false; btn.textContent = textoOriginal;
            return;
          }
          cerrar(); refrescarDetalle_();
        }).catch(function () {
          Componentes.aviso({ texto: 'No se pudo conectar con el servidor.', tipo: 'error' });
          btn.disabled = false; btn.textContent = textoOriginal;
        });
      };
      lector.readAsDataURL(archivo);
    });
  }

  // Edita METADATA (nombre/categoría/descripción/referencia) -- nunca el
  // archivo, eso es "Nueva versión". Sin FileReader de por medio, reusa
  // enviarModal_ igual que el resto de los formularios síncronos.
  function abrirFormularioEditarDocumento_(doc, detalle, tareas) {
    var opcionesRef = opcionesReferenciaDocumento_(detalle, tareas);
    var valorRefActual = (doc.ref_tipo && doc.ref_id) ? (doc.ref_tipo + '::' + doc.ref_id) : '';
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Editar documento</h3>' +
        '<form id="form-py-doc-editar">' +
          Componentes.campoTexto({ id: 'py-de-nombre', label: 'Nombre', valor: doc.nombre, requerido: true }) +
          Componentes.campoSelect({
            id: 'py-de-categoria', label: 'Categoría', valor: doc.categoria, placeholder: false,
            opciones: PROYECTO_DOC_CATEGORIAS_OPCIONES_
          }) +
          Componentes.campoTextarea({ id: 'py-de-descripcion', label: 'Descripción', valor: doc.descripcion }) +
          (opcionesRef.length ? Componentes.campoSelect({ id: 'py-de-ref', label: 'Relacionado con (opcional)', opciones: opcionesRef, valor: valorRefActual, placeholder: 'Ninguna' }) : '') +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-py-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    fondo.querySelector('#form-py-doc-editar').addEventListener('submit', function (evento) {
      var refEl = document.getElementById('py-de-ref');
      var refPartes = (refEl && refEl.value) ? refEl.value.split('::') : ['', ''];
      enviarModal_(evento, 'gestionarDocumentoProyecto', {
        proyecto_id: proyectoActivoId_,
        documento_id: doc.documento_id,
        nombre: document.getElementById('py-de-nombre').value,
        categoria: document.getElementById('py-de-categoria').value,
        descripcion: document.getElementById('py-de-descripcion').value,
        ref_tipo: refPartes[0], ref_id: refPartes[1]
      }, function () { cerrar(); refrescarDetalle_(); });
    });
  }

  // Historial completo de un documento -- pedido LAZY (solo al abrir "Ver
  // historial"), igual criterio que la bitácora del Cronograma. "Marcar
  // vigente" (rollback) solo se ofrece a quien gestiona el proyecto
  // (líder/ADM) -- el backend lo exige igual, esto solo evita un viaje que
  // sabemos de antemano que el servidor va a rechazar.
  function abrirHistorialDocumento_(doc, puedeGestionarEstricto) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Historial: ' + Componentes.escaparHtml(doc.nombre) + '</h3>' +
        '<div id="py-doc-hist-lista">' + Componentes.cargando('Cargando historial...') + '</div>' +
        '<div class="sigso-modal__acciones">' +
          Componentes.boton({ texto: 'Cerrar', variante: 'sutil', clase: 'js-py-cancelar', tipo: 'button' }) +
        '</div>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    function cargar() {
      api_('listarVersionesDocumentoProyecto', { proyecto_id: proyectoActivoId_, documento_id: doc.documento_id }).then(function (r) {
        var lista = fondo.querySelector('#py-doc-hist-lista');
        if (!r || !r.ok) { lista.innerHTML = '<p class="sigso-ayuda">No se pudo cargar el historial.</p>'; return; }
        var versiones = r.data || [];
        lista.innerHTML = '<div class="sigso-py-lista">' + versiones.map(function (v) {
          return '<div class="sigso-py-tarea' + (v.vigente ? ' sigso-py-tarea--mia' : '') + '">' +
            '<div class="sigso-py-tarea__top">' +
              '<span class="sigso-py-tarea__titulo">' + Componentes.escaparHtml(v.version) + '</span>' +
              (v.vigente ? Componentes.badge('Vigente', 'ok') : '') +
            '</div>' +
            (v.comentario ? '<p>' + Componentes.escaparHtml(v.comentario) + '</p>' : '') +
            '<div class="sigso-py-tarea__meta">' +
              '<span>' + Componentes.escaparHtml(v.archivo_nombre) + '</span>' +
              '<span>' + tamanoLegible_(v.tamano_bytes) + '</span>' +
              '<span>' + Componentes.escaparHtml(v.subido_por) + ' · ' + fechaHora_(v.fecha) + '</span>' +
            '</div>' +
            '<div class="sigso-py-hito__acciones">' +
              Componentes.boton({ texto: 'Descargar', variante: 'sutil', clase: 'js-py-doc-hist-descargar', idx: v.version_id }) +
              (!v.vigente && puedeGestionarEstricto ? Componentes.boton({ texto: 'Marcar vigente', variante: 'sutil', clase: 'js-py-doc-hist-vigente', idx: v.version_id }) : '') +
            '</div>' +
          '</div>';
        }).join('') + '</div>';

        lista.querySelectorAll('.js-py-doc-hist-descargar').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var textoOriginal = btn.textContent;
            btn.disabled = true;
            btn.innerHTML = '<span class="sigso-spinner"></span>Descargando…';
            api_('descargarVersionDocumentoProyecto', { proyecto_id: proyectoActivoId_, version_id: btn.getAttribute('data-idx') }).then(function (rd) {
              if (!rd || !rd.ok) { Componentes.aviso({ texto: (rd && rd.message) || 'No se pudo descargar.', tipo: 'error' }); return; }
              descargarBase64Proyecto_(rd.data.contenido_base64, rd.data.nombre_archivo, rd.data.mime);
            }).catch(function () {
              Componentes.aviso({ texto: 'No se pudo conectar con el servidor.', tipo: 'error' });
            }).finally(function () {
              btn.disabled = false; btn.textContent = textoOriginal;
            });
          });
        });
        lista.querySelectorAll('.js-py-doc-hist-vigente').forEach(function (btn) {
          btn.addEventListener('click', function () {
            btn.disabled = true;
            api_('marcarVersionVigenteProyecto', {
              proyecto_id: proyectoActivoId_, documento_id: doc.documento_id, version_id: btn.getAttribute('data-idx')
            }).then(function (rv) {
              if (!rv || !rv.ok) {
                Componentes.aviso({ texto: (rv && rv.message) || 'No se pudo cambiar la versión vigente.', tipo: 'error' });
                btn.disabled = false;
                return;
              }
              Componentes.aviso({ texto: 'Versión vigente actualizada.' });
              cargar();
              refrescarDetalle_();
            });
          });
        });
      });
    }
    cargar();
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
      enviarModal_(evento, 'gestionarRiesgoProyecto', {
        proyecto_id: proyectoActivoId_,
        riesgo_id: r.riesgo_id,
        descripcion: document.getElementById('py-re-descripcion').value,
        probabilidad: document.getElementById('py-re-probabilidad').value,
        impacto: document.getElementById('py-re-impacto').value,
        responsable_email: document.getElementById('py-re-responsable').value,
        mitigacion: document.getElementById('py-re-mitigacion').value,
        estado: document.getElementById('py-re-estado').value
      }, function () { cerrar(); refrescarDetalle_(); });
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
      var hitoEl = document.getElementById('py-cv-hito');
      enviarModal_(evento, 'convertirEventoEnTareaProyecto', {
        proyecto_id: proyectoActivoId_,
        evento_id: ev.evento_id,
        titulo: document.getElementById('py-cv-titulo').value,
        descripcion: document.getElementById('py-cv-descripcion').value,
        responsable_email: document.getElementById('py-cv-responsable').value,
        hito_id: hitoEl ? hitoEl.value : '',
        fecha_compromiso: document.getElementById('py-cv-fecha').value,
        prioridad: document.getElementById('py-cv-prioridad').value
      }, function () { cerrar(); refrescarDetalle_(); });
    });
  }

  // v11 (Reingeniería Cronograma, P0): el modal del REGISTRO DEL DÍA -- la
  // celda diaria como unidad de información editable. Registra/edita el estado
  // del día (uno de 9), las horas, un comentario, los tramos horarios y, si el
  // día quedó bloqueado, el motivo. Muestra la traza de edición (quién y
  // cuántas veces) cuando ya existe un registro. Todo persiste vía
  // guardarRegistroDiaProyecto -- nada es visual sin respaldo.
  function abrirRegistroDia_(proyectoId, tarea, dia, registro, alGuardar) {
    registro = registro || {};
    var titulo = (tarea && tarea.titulo) || 'Tarea';
    var fechaTxt = etiquetaDiaLargo_(dia);
    var estadoActual = registro.estado_dia || 'en_proceso';
    var horasActual = (registro.horas !== undefined && registro.horas !== null && registro.horas !== '') ? registro.horas : '';
    var tramos = Array.isArray(registro.tramos) ? registro.tramos : [];

    var opcionesEstado = REGISTRO_DIA_ESTADO_ORDEN_.map(function (e) {
      return { valor: e, texto: REGISTRO_DIA_ESTADO_LABEL_[e] };
    });

    var trazaHtml = '';
    if (registro.editado_por) {
      trazaHtml = '<p class="sigso-ayuda sigso-py-reg-traza">Registrado por ' +
        Componentes.escaparHtml(registro.autor_nombre || registro.editado_por) +
        (registro.editado_en ? ' · última edición ' + Componentes.escaparHtml(fechaHora_(registro.editado_en)) : '') +
        (registro.ediciones ? ' · ' + registro.ediciones + ' edición(es)' : '') + '</p>';
    }

    // v12.5 ("rediseño del registro del día"): el estado deja de ser un
    // dropdown y pasa a PILLS de color (una por estado, con el color de su
    // semáforo) -- más moderno y de un solo toque. El valor viaja en un input
    // oculto (#py-reg-estado) para no tocar el resto de la lógica del submit.
    var esEdicion = !!registro.editado_por;
    var pillsEstado = REGISTRO_DIA_ESTADO_ORDEN_.map(function (e) {
      var meta = DEDICACION_TIPO_ESTADO_[e] || { cls: 'proc' };
      var sel = e === estadoActual;
      return '<button type="button" class="sigso-py-reg-pill sigso-py-reg-pill--' + meta.cls + (sel ? ' is-sel' : '') +
        '" data-estado="' + e + '" aria-pressed="' + (sel ? 'true' : 'false') + '">' +
        Componentes.escaparHtml(REGISTRO_DIA_ESTADO_LABEL_[e]) + '</button>';
    }).join('');

    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-py-reg-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Registro del día</h3>' +
        '<div class="sigso-py-reg-cab">' +
          '<strong>' + Componentes.escaparHtml(titulo) + '</strong>' +
          '<span class="sigso-py-reg-cab__fecha">' + Componentes.escaparHtml(fechaTxt) + '</span>' +
        '</div>' +
        trazaHtml +
        '<form id="form-py-registro-dia">' +
          '<span class="sigso-py-reg-campo-label">Estado del día</span>' +
          '<div class="sigso-py-reg-estados" role="group" aria-label="Estado del día">' + pillsEstado + '</div>' +
          '<input type="hidden" id="py-reg-estado" value="' + Componentes.escaparHtml(estadoActual) + '">' +
          Componentes.campoTexto({ id: 'py-reg-horas', label: 'Horas dedicadas (opcional)', tipo: 'number', valor: horasActual }) +
          Componentes.campoTextarea({ id: 'py-reg-nota', label: 'Comentario del día (opcional)', valor: registro.nota || '' }) +
          '<div class="sigso-campo js-py-reg-bloqueo-cont"' + (estadoActual === 'bloqueado' ? '' : ' style="display:none;"') + '>' +
            Componentes.campoTexto({ id: 'py-reg-bloqueo', label: 'Motivo del bloqueo', valor: registro.bloqueo_motivo || '' }) +
          '</div>' +
          '<div class="sigso-py-reg-tramos">' +
            '<div class="sigso-py-reg-tramos__cab"><span>Tramos horarios (opcional)</span>' +
              Componentes.boton({ texto: '+ Tramo', variante: 'sutil', clase: 'js-py-reg-tramo-add', tipo: 'button' }) + '</div>' +
            '<div class="js-py-reg-tramos-lista">' +
              (tramos.length ? tramos.map(tramoFilaHtml_).join('') : '') +
            '</div>' +
          '</div>' +
          '<div class="sigso-py-reg-acciones">' +
            (esEdicion ? '<button type="button" class="sigso-py-reg-eliminar js-py-reg-eliminar">Eliminar registro</button>' : '') +
            '<div class="sigso-py-reg-acciones__der">' +
              Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-py-cancelar', tipo: 'button' }) +
              Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
            '</div>' +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    // Estado como pills: sincroniza el input oculto y muestra el motivo de
    // bloqueo solo cuando el estado elegido es "bloqueado".
    var hiddenEstado = fondo.querySelector('#py-reg-estado');
    var bloqueoCont = fondo.querySelector('.js-py-reg-bloqueo-cont');
    function syncBloqueo_() { bloqueoCont.style.display = hiddenEstado.value === 'bloqueado' ? '' : 'none'; }
    fondo.querySelectorAll('.sigso-py-reg-pill').forEach(function (pill) {
      pill.addEventListener('click', function () {
        fondo.querySelectorAll('.sigso-py-reg-pill').forEach(function (o) { o.classList.remove('is-sel'); o.setAttribute('aria-pressed', 'false'); });
        pill.classList.add('is-sel'); pill.setAttribute('aria-pressed', 'true');
        hiddenEstado.value = pill.getAttribute('data-estado');
        syncBloqueo_();
      });
    });

    // Eliminar registro (solo si ya existe): confirmación en DOS toques, sin
    // diálogo nativo. Persiste vía eliminarRegistroDiaProyecto y actualiza la
    // carta al instante (optimista, __eliminado) igual que el guardado.
    var btnEliminar = fondo.querySelector('.js-py-reg-eliminar');
    if (btnEliminar) {
      btnEliminar.addEventListener('click', function () {
        if (btnEliminar.dataset.armado !== '1') {
          btnEliminar.dataset.armado = '1';
          btnEliminar.textContent = 'Confirmar eliminación';
          btnEliminar.classList.add('is-armado');
          return;
        }
        btnEliminar.disabled = true;
        api_('eliminarRegistroDiaProyecto', { proyecto_id: proyectoId, actividad_id: tarea && tarea.actividad_id, dia: dia }).then(function (r) {
          if (!r || !r.ok) {
            btnEliminar.disabled = false; btnEliminar.dataset.armado = '';
            btnEliminar.textContent = 'Eliminar registro'; btnEliminar.classList.remove('is-armado');
            Componentes.aviso({ texto: (r && r.message) || 'No se pudo eliminar el registro.', tipo: 'error' });
            return;
          }
          cerrar();
          Componentes.aviso({ texto: 'Registro eliminado.', tipo: 'exito' });
          if (typeof alGuardar === 'function') alGuardar({ __eliminado: true, actividad_id: tarea && tarea.actividad_id, dia: dia });
        });
      });
    }

    var listaTramos = fondo.querySelector('.js-py-reg-tramos-lista');
    fondo.querySelector('.js-py-reg-tramo-add').addEventListener('click', function () {
      listaTramos.insertAdjacentHTML('beforeend', tramoFilaHtml_({ desde: '', hasta: '', nota: '' }));
    });
    listaTramos.addEventListener('click', function (ev) {
      var quitar = ev.target.closest('.js-py-reg-tramo-quitar');
      if (quitar) quitar.closest('.sigso-py-reg-tramo').remove();
    });

    fondo.querySelector('#form-py-registro-dia').addEventListener('submit', function (evento) {
      var estado = hiddenEstado.value;
      var motivo = fondo.querySelector('#py-reg-bloqueo').value.trim();
      if (estado === 'bloqueado' && !motivo) {
        evento.preventDefault();
        Componentes.aviso({ texto: 'Un día bloqueado necesita un motivo.', tipo: 'error' });
        return;
      }
      var tramosOut = Array.prototype.map.call(fondo.querySelectorAll('.sigso-py-reg-tramo'), function (fila) {
        return {
          desde: fila.querySelector('.js-py-reg-tramo-desde').value,
          hasta: fila.querySelector('.js-py-reg-tramo-hasta').value,
          nota: fila.querySelector('.js-py-reg-tramo-nota').value
        };
      }).filter(function (t) { return t.desde || t.hasta || t.nota; });
      var horasVal = fondo.querySelector('#py-reg-horas').value;
      enviarModal_(evento, 'guardarRegistroDiaProyecto', {
        proyecto_id: proyectoId,
        actividad_id: tarea && tarea.actividad_id,
        dia: dia,
        estado_dia: estado,
        horas: horasVal === '' ? '' : Number(horasVal),
        nota: fondo.querySelector('#py-reg-nota').value,
        bloqueo_motivo: motivo,
        tramos: tramosOut
      }, function () {
        cerrar();
        Componentes.aviso({ texto: 'Día registrado.', tipo: 'exito' });
        // v12.2 ("llenar rápido, sin recarga"): se pasa el registro recién
        // guardado al callback, para que la carta pueda actualizarse en el
        // acto (optimista) sin volver a pedir todo el proyecto al backend.
        if (typeof alGuardar === 'function') alGuardar({
          tipo: 'REGISTRO_DIA',
          actividad_id: tarea && tarea.actividad_id,
          dia: dia,
          estado_dia: estado,
          horas: horasVal === '' ? '' : Number(horasVal),
          nota: fondo.querySelector('#py-reg-nota').value,
          bloqueo_motivo: motivo,
          tramos: tramosOut
        });
      });
    });
  }

  // Una fila del editor de tramos horarios (desde / hasta / qué se hizo).
  function tramoFilaHtml_(t) {
    t = t || {};
    return '<div class="sigso-py-reg-tramo">' +
      '<input type="time" class="sigso-campo__control js-py-reg-tramo-desde" value="' + Componentes.escaparHtml(t.desde || '') + '" aria-label="Desde">' +
      '<input type="time" class="sigso-campo__control js-py-reg-tramo-hasta" value="' + Componentes.escaparHtml(t.hasta || '') + '" aria-label="Hasta">' +
      '<input type="text" class="sigso-campo__control js-py-reg-tramo-nota" placeholder="¿Qué hiciste?" value="' + Componentes.escaparHtml(t.nota || '') + '" aria-label="Nota del tramo">' +
      '<button type="button" class="sigso-boton sigso-boton--sutil js-py-reg-tramo-quitar" aria-label="Quitar tramo">×</button>' +
    '</div>';
  }

  // 'YYYY-MM-DD' -> "sábado 30 de agosto de 2026" (para el encabezado del
  // modal de registro). Usa la fecha local del calendario, no un instante.
  function etiquetaDiaLargo_(dia) {
    var f = fechaDeClave_(dia);
    if (isNaN(f.getTime())) return dia;
    try {
      return f.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    } catch (e) {
      return fechaCorta_(dia);
    }
  }

  // --- utilidades ------------------------------------------------------

  // v10 (auditoría G, 2026-08-29): envío de formulario de modal a prueba de
  // doble-clic. Deshabilita el botón "guardar" mientras la llamada está en
  // vuelo; si falla lo re-habilita para reintentar; si sale bien corre
  // alExito (que normalmente cierra el modal y refresca). Antes, un
  // doble-clic rápido -- o Enter + clic -- ANTES de que respondiera el
  // backend creaba la fila DOS veces (p.ej. dos tareas idénticas). Usa
  // apiSeguro_ para que un fallo de red llegue como {ok:false} y no como una
  // promesa colgada que deja el botón muerto.
  function enviarModal_(evento, accion, datos, alExito) {
    evento.preventDefault();
    var btn = evento.currentTarget.querySelector('button[type="submit"]');
    if (btn && btn.disabled) return;            // segundo submit: ignorar
    if (btn) btn.disabled = true;
    apiSeguro_(accion, datos).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        if (btn) btn.disabled = false;
        Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
        return;
      }
      alExito(respuesta);
    });
  }

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
    // v10 (Fase B, propuesta 03 "Mi trabajo en proyectos"): primero, porque es
    // la vista personal -- lo que a MÍ me toca hoy, de todos mis proyectos a
    // la vez -- en vez de tener que entrar proyecto por proyecto a revisarlo.
    { id: 'mi-trabajo', nombre: 'Mi trabajo', icono: 'persona', plano: true, items: [
      { id: 'mi-trabajo', nombre: 'Mi trabajo en proyectos' }
    ] },
    { id: 'portafolio', nombre: 'Portafolio', icono: 'caja', plano: true, items: [
      { id: 'portafolio', nombre: 'Portafolio' }
    ] },
    // v10 (Fase C, propuesta 05 "vista calendario").
    { id: 'calendario', nombre: 'Calendario', icono: 'calendario', plano: true, items: [
      { id: 'calendario', nombre: 'Calendario' }
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
  // v12.3 ("usar todo el ancho"): el Cronograma (Carta Gantt / Dedicación) se
  // ve mucho mejor a ancho completo -- más días y tareas de un vistazo. El
  // resto de las pestañas (texto) se leen mejor angostas, así que el ancho
  // total se activa SOLO en el Cronograma, soltando el tope de 1180px del
  // contenedor del shell (queda relativo a la región principal -- funciona con
  // y sin sidebar). Se limpia al volver al portafolio o cambiar de pestaña.
  function fijarAnchoCarta_(activo) {
    var raiz = document.getElementById('proyectos-contenido');
    var caja = raiz && raiz.closest('.sigso-contenido');
    if (caja) caja.classList.toggle('sigso-py-ancho-total', !!activo);
  }

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
    else if (id === 'mi-trabajo') cargarMiTrabajoProyectos_();
    else if (id === 'calendario') cargarCalendario_();
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

  // Solo el estado: es el unico filtro que viaja al servidor y que por lo
  // tanto esta aplicado sobre los datos del reporte. El de salud se aplica
  // en el cliente y los reportes usan el arreglo previo, asi que estamparlo
  // seria afirmar un recorte que no ocurrio.
  function filtrosDelReporte_() {
    if (!filtroEstadoPortafolio_) return [];
    return [{ etiqueta: 'Estado', valor: filtroEstadoPortafolio_ }];
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
      SigsoReportes.cabeceraDocumento({
        titulo: r.nombre,
        subtitulo: r.desc,
        modulo: 'Proyectos — Portafolio',
        codigo: 'SIGSO-REP-PY-' + String(r.id).replace(/^[a-z]+-/, '').toUpperCase(),
        generadoPor: (window.SIGSO_USUARIO && SIGSO_USUARIO.nombre) || '',
        filtros: filtrosDelReporte_()
      }) +
      cuerpo +
      SigsoReportes.pieDocumento();

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


  // v13.1: registro TEMPRANO del arbol. Antes esto pasaba recien al abrir
  // el modulo, asi que el sidebar no le dibujaba el chevron ni lo dejaba
  // desplegar hasta que entrabas una vez.
  if (window.SigsoNav) {
    SigsoNav.registrar('proyectos', {
      nombre: 'Proyectos',
      submodulos: ARQUITECTURA_PROYECTOS
    });
  }
})();
