/**
 * novedades.js — modulo Novedades (v6.5).
 *
 * Feed compartido por las dos vias de acceso (plataforma.js con token y
 * app.js con login Google), igual que dashboard.js/detalle.js: un solo
 * archivo, sin duplicar logica entre los dos hosts.
 *
 * DECISION DE DISEÑO (viene del backend, ver Novedades.gs): el area es
 * ETIQUETA, no audiencia. SIGSO no modela a que area pertenece cada
 * persona, asi que TODO lo publicado aparece para TODOS -- el area sirve
 * para filtrar, no para restringir. Por eso ninguna tarjeta se oculta ni se
 * "destaca como tuya": todas se ven igual, el filtro de area es una
 * eleccion del lector, no del sistema.
 */
(function () {
  window.SigsoNovedades = {
    // v13.0: el arbol del sidebar entra por aca.
    irAItem: function (itemId) {
      vista_ = itemId;
      if (window.SigsoShell && SigsoShell.publicarItem) SigsoShell.publicarItem(itemId);
      cambiarVista_();
    },
    cargar: cargarNovedades_,
    actualizarBadge: actualizarBadgeStandalone_,
    pintarTarjetaHome: pintarTarjetaHome_
  };

  var ultimoFeed_ = [];
  var filtroTipo_ = '';
  var puedePublicar_ = false;
  var areasPropias_ = [];
  var tiposCatalogo_ = [];
  var puedeGeneral_ = false;
  // v6.7 (Fase 5, audiencia dirigida): directorio completo (para
  // "Seleccionar personas"), el propio equipo y si puede usar las opciones
  // amplias (TODOS/MI_EQUIPO, reservadas a jefatura/ADM). Se cargan una vez
  // al entrar al modulo (listarAreasPublicablesNovedad) y sirven tanto para
  // el formulario de publicar como para el mini-formulario de aprobar.
  var directorio_ = [];
  var equipo_ = [];
  var puedeTodos_ = false;
  var puedeEquipo_ = false;
  // v6.6 (Fase 4): 'feed' = publicadas (de siempre), 'aprobar' = bandeja de
  // jefatura/ADM, 'envios' = mis novedades que todavia no estan publicadas.
  var vista_ = 'feed';

  function carrilDe_(tipo) {
    var t = tiposCatalogo_.filter(function (x) { return x.tipo === tipo; })[0];
    return t ? t.carril : 'LIBRE';
  }

  function urlBackoffice_() {
    return (window.SIGSO_CONFIG || {}).BACKOFFICE_URL;
  }
  function api_(accion, datos) {
    return llamarApi(urlBackoffice_(), accion, datos || {});
  }

  // "hace 2 días" en vez de una fecha ISO pelada -- mas facil de escanear en
  // un feed que se recorre rapido.
  function relativo_(iso) {
    if (!iso) return '';
    var ms = Date.now() - new Date(iso).getTime();
    var dias = Math.floor(ms / 86400000);
    if (dias <= 0) return 'Hoy';
    if (dias === 1) return 'Ayer';
    if (dias < 7) return 'Hace ' + dias + ' días';
    if (dias < 31) return 'Hace ' + Math.floor(dias / 7) + ' semana(s)';
    return new Date(iso).toLocaleDateString('es-CL');
  }

  // Cuenta atras a la fecha de vigencia (leyes/normativas): es el
  // diferenciador del modulo -- convierte "hay una ley nueva" (pasado) en
  // "esto rige en 12 dias" (accionable, con urgencia creciente).
  function chipVigencia_(fechaVigencia) {
    if (!fechaVigencia) return '';
    var dias = Math.ceil((new Date(fechaVigencia).getTime() - Date.now()) / 86400000);
    var variante = dias <= 0 ? 'critico' : (dias <= 7 ? 'alerta' : 'info');
    var texto = dias > 0
      ? 'Entra en vigencia en ' + dias + ' día(s)'
      : (dias === 0 ? 'Entra en vigencia hoy' : 'Vigente desde hace ' + (-dias) + ' día(s)');
    return '<span class="sigso-situacion sigso-situacion--' + variante + '">' +
      Iconos.svg('calendario', { tam: 12 }) + ' ' + Componentes.escaparHtml(texto) + '</span>';
  }

  // v6.8 (Fase 6): plazo para dar el acuse -- el diferenciador de esta fase
  // es que "vence en X días" empuje a confirmar antes de que se cumpla.
  function chipPlazoAcuse_(n) {
    if (!n.fecha_limite_acuse || n.dias_para_vencer === undefined || n.dias_para_vencer === null) return '';
    var dias = n.dias_para_vencer;
    var variante = dias < 0 ? 'critico' : (dias <= 2 ? 'alerta' : 'info');
    var texto = dias > 0
      ? 'Vence en ' + dias + ' día(s) para dar acuse'
      : (dias === 0 ? 'Vence hoy para dar acuse' : 'Venció hace ' + (-dias) + ' día(s) sin acuse');
    return '<span class="sigso-situacion sigso-situacion--' + variante + '">' +
      Iconos.svg('reloj', { tam: 12 }) + ' ' + Componentes.escaparHtml(texto) + '</span>';
  }

  function tarjeta_(n) {
    var avatar = window.SigsoPerfil
      ? SigsoPerfil.avatarDe(n.autor_nombre, n.autor_email, { tam: 'sm' })
      : '';
    return '<article class="sigso-novedad-card' + (n.leida ? '' : ' sigso-novedad-card--no-leida') +
      '" data-novedad="' + n.novedad_id + '" tabindex="0" role="button" ' +
      'aria-label="Abrir: ' + Componentes.escaparHtml(n.titulo) + '">' +
      '<div class="sigso-novedad-card__franja sigso-novedad-card__franja--' + n.tipo_color + '"></div>' +
      '<div class="sigso-novedad-card__cuerpo">' +
        '<div class="sigso-novedad-card__meta-top">' +
          '<span class="sigso-badge sigso-badge--' + n.tipo_color + '">' + Componentes.escaparHtml(n.tipo_etiqueta) + '</span>' +
          (n.area_nombre ? '<span class="sigso-novedad-card__area">' + Componentes.escaparHtml(n.area_nombre) + '</span>' : '<span class="sigso-novedad-card__area">General</span>') +
          (n.tiene_adjunto ? '<span title="Tiene adjunto">' + Iconos.svg('adjunto', { tam: 13 }) + '</span>' : '') +
          (n.audiencia_tipo && n.audiencia_tipo !== 'TODOS'
            ? '<span class="sigso-badge sigso-badge--info" title="No llega a todo el personal">Dirigida</span>'
            : '') +
          (!n.leida && n.requiere_acuse ? '<span class="sigso-punto-no-leido" aria-hidden="true"></span>' : '') +
        '</div>' +
        '<h3 class="sigso-novedad-card__titulo">' + Componentes.escaparHtml(n.titulo) + '</h3>' +
        '<p class="sigso-novedad-card__resumen">' + Componentes.escaparHtml(n.resumen) + '</p>' +
        chipVigencia_(n.fecha_vigencia) +
        chipPlazoAcuse_(n) +
        '<div class="sigso-novedad-card__meta-bottom">' +
          avatar +
          '<span>' + Componentes.escaparHtml(n.autor_nombre) + '</span>' +
          '<span aria-hidden="true">·</span>' +
          '<span>' + relativo_(n.fecha_publicacion) + '</span>' +
          (n.requiere_acuse
            ? (n.leida
                ? '<span class="sigso-novedad-card__leida">' + Iconos.svg('check', { tam: 13 }) + ' Enterado</span>'
                : '<span class="sigso-novedad-card__pendiente">Requiere acuse</span>')
            : '') +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function renderChipsTipo_(cont) {
    var chips = [{ tipo: '', etiqueta: 'Todas' }].concat(
      tiposCatalogo_.map(function (t) { return { tipo: t.tipo, etiqueta: t.etiqueta }; })
    );
    cont.innerHTML = chips.map(function (c) {
      var activo = c.tipo === filtroTipo_ ? ' sigso-chip--activo' : '';
      return '<button type="button" class="sigso-chip' + activo + '" data-chip-tipo="' + c.tipo + '">' +
        Componentes.escaparHtml(c.etiqueta) + '</button>';
    }).join('');
    cont.querySelectorAll('[data-chip-tipo]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        filtroTipo_ = chip.getAttribute('data-chip-tipo');
        cargarFeed_();
      });
    });
  }

  function renderFeed_(datos) {
    var cont = document.getElementById('novedades-contenido');
    if (!cont) return;
    ultimoFeed_ = datos.recientes;

    var correos = datos.recientes.map(function (n) { return n.autor_email; });
    var pintarConAvatares = function () {
      cont.querySelector('.sigso-novedades__lista').innerHTML = datos.recientes.length
        ? datos.recientes.map(tarjeta_).join('')
        : Componentes.vacio({
            icono: 'campana',
            texto: 'Todavía no hay novedades' + (filtroTipo_ ? ' de este tipo' : '') + '.',
            detalle: puedePublicar_ ? 'Publica la primera con el botón de arriba.' : 'Vuelve pronto: cada área va a ir sumando lo suyo.'
          });
      cont.querySelectorAll('[data-novedad]').forEach(function (card) {
        card.addEventListener('click', function () { abrirDetalle_(card.getAttribute('data-novedad')); });
        card.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); card.click(); }
        });
      });
    };

    if (window.SigsoPerfil) {
      SigsoPerfil.precargarFotos(correos).then(pintarConAvatares);
    } else {
      pintarConAvatares();
    }
  }

  // Actualiza CUALQUIER badge de "novedades" presente en la pagina --
  // funciona igual en el nav de plataforma.js (que ya genera
  // [data-badge="novedades"] para todo modulo, ver renderNav_) y en el
  // boton de app.html (Backoffice con login Google), sin que ninguno de los
  // dos hosts tenga que conocer al otro.
  function actualizarBadge_(pendientes) {
    document.querySelectorAll('[data-badge="novedades"]').forEach(function (badge) {
      badge.textContent = pendientes > 99 ? '99+' : String(pendientes);
      badge.classList.toggle('sigso-oculto', !pendientes);
    });
  }

  // v6.9 (rendimiento): el feed sin filtro lo piden hasta TRES consumidores
  // casi a la vez al entrar (badge del nav, tarjeta del Home y el propio
  // modulo). Eran tres requests identicos, cada una pagando su resolucion de
  // identidad en el servidor. Aqui se comparte UNA promesa por unos
  // segundos; cualquier accion que modifique novedades la descarta para no
  // mostrar datos viejos.
  var promesaFeed_ = null;
  var promesaFeedEn_ = 0;
  var TTL_FEED_COMPARTIDO_MS = 10000;

  function feedSinFiltro_() {
    var ahora = Date.now();
    if (promesaFeed_ && (ahora - promesaFeedEn_) < TTL_FEED_COMPARTIDO_MS) {
      return promesaFeed_;
    }
    promesaFeedEn_ = ahora;
    promesaFeed_ = api_('getFeedNovedades', {});
    return promesaFeed_;
  }

  function invalidarFeedCompartido_() {
    promesaFeed_ = null;
  }

  /**
   * Se llama desde Home (o desde donde convenga) para que el badge de
   * pendientes aparezca SIN que el usuario haya entrado todavia al modulo --
   * mismo criterio que "pendientes_validar" de Mis solicitudes. No toca el
   * DOM del feed (que puede no existir todavia).
   */
  function actualizarBadgeStandalone_() {
    feedSinFiltro_().then(function (respuesta) {
      if (respuesta && respuesta.ok) actualizarBadge_(respuesta.data.resumen.pendientes);
    }).catch(function () { /* sin badge si falla: no es critico */ });
  }

  /**
   * Fase 3: tarjeta en el Home con la novedad pendiente mas relevante (la
   * mas reciente que requiere acuse y aun no fue confirmada) -- para que la
   * informacion quede visible sin tener que entrar al modulo. Si no hay
   * ninguna pendiente, el contenedor queda vacio (no agrega ruido al Home).
   */
  function pintarTarjetaHome_(contenedorId) {
    var cont = document.getElementById(contenedorId);
    if (!cont) return;
    feedSinFiltro_().then(function (respuesta) {
      if (!respuesta || !respuesta.ok) { cont.innerHTML = ''; return; }
      var destacada = respuesta.data.recientes.filter(function (n) {
        return n.requiere_acuse && !n.leida;
      })[0];
      if (!destacada) { cont.innerHTML = ''; return; }

      cont.innerHTML =
        '<div class="plataforma-aviso plataforma-aviso--accion">' +
        Iconos.svg('campana', { tam: 18 }) +
        '<div><strong>' + Componentes.escaparHtml(destacada.titulo) + '</strong>' +
        '<div class="sigso-ayuda">' + Componentes.escaparHtml(destacada.resumen) + '</div></div>' +
        '<button type="button" class="sigso-boton--secundario js-ver-novedad-home">Ver</button>' +
        '</div>';
      var btn = cont.querySelector('.js-ver-novedad-home');
      if (btn) {
        btn.addEventListener('click', function () { abrirDetalle_(destacada.novedad_id); });
      }
    }).catch(function () { cont.innerHTML = ''; });
  }

  // El detalle puede abrirse desde la tarjeta del Home (ademas del feed del
  // modulo); si el acuse se dio desde ahi, la tarjeta debe actualizarse sola
  // -- si no, el aviso "Enterado" registrado no se reflejaba hasta la
  // proxima carga de pagina.
  function refrescarTarjetaHomeSiExiste_() {
    invalidarFeedCompartido_(); // el acuse recien dado cambia lo que muestra
    if (document.getElementById('novedades-home')) {
      pintarTarjetaHome_('novedades-home');
    }
  }

  function cargarFeed_() {
    var cont = document.getElementById('novedades-contenido');
    if (!cont) return;
    var lista = cont.querySelector('.sigso-novedades__lista');
    if (lista) lista.innerHTML = Componentes.cargando('Cargando novedades...');

    // Sin filtro de tipo se reutiliza la promesa compartida (la misma que ya
    // pidieron el badge y la tarjeta del Home). Con filtro, la consulta es
    // distinta y va aparte.
    var peticion = filtroTipo_
      ? api_('getFeedNovedades', { tipo: filtroTipo_ })
      : feedSinFiltro_();

    peticion.then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        if (lista) lista.innerHTML = Componentes.alerta(
          (respuesta && respuesta.message) || 'No se pudieron cargar las novedades.', 'error'
        );
        return;
      }
      renderFeed_(respuesta.data);
      actualizarBadge_(respuesta.data.resumen.pendientes);
    }).catch(function () {
      if (lista) lista.innerHTML = Componentes.alerta('No se pudo conectar para cargar las novedades.', 'error');
    });
  }

  /**
   * Punto de entrada, llamado por plataforma.js (mostrarModulo_) y por
   * app.js al mostrar la seccion. Idempotente: puede llamarse cada vez que
   * se entra al modulo sin duplicar listeners (el markup se reemplaza
   * completo en cada carga).
   */
  function cargarNovedades_() {
    var cont = document.getElementById('novedades-contenido');
    if (!cont) return;
    // v12.1: la vista puede venir de la URL (#/novedades/aprobar). Se valida
    // contra la arquitectura: una URL no puede inventar una vista. Y el filtro
    // de permiso lo sigue aplicando renderTabs_ con puedeGeneral_.
    var pedida = (window.SigsoShell && SigsoShell.tomarItemDeRuta)
      ? SigsoShell.tomarItemDeRuta() : '';
    var valida = ARQUITECTURA_NOVEDADES.some(function (sub) {
      return sub.items.some(function (it) { return it.id === pedida; });
    });
    vista_ = valida ? pedida : 'feed';

    // v12.1: mismo layout de dos columnas que Calidad y Administracion. La
    // navegacion sale del contenido y pasa a ser persistente: antes vivia
    // dentro del bloque que cada vista reemplazaba.
    cont.innerHTML =
      '<div class="sigso-modulo-layout">' +
      '<div class="sigso-modulo-layout__panel">' +
      '<div class="sigso-novedades__cabecera">' +
        '<div class="sigso-novedades__chips" id="novedades-chips-tipo"></div>' +
        '<button type="button" class="sigso-boton sigso-boton--con-icono sigso-oculto" id="btn-publicar-novedad">' +
          Iconos.svg('mas', { tam: 15 }) + 'Publicar' +
        '</button>' +
      '</div>' +
      '<div class="sigso-novedades__lista">' + Componentes.cargando('Cargando novedades...') + '</div>' +
      '</div></div>';

    api_('listarAreasPublicablesNovedad', {}).then(function (respuesta) {
      if (respuesta && respuesta.ok) {
        areasPropias_ = respuesta.data.areas;
        tiposCatalogo_ = respuesta.data.tipos;
        puedeGeneral_ = respuesta.data.puede_general;
        directorio_ = respuesta.data.directorio || [];
        equipo_ = respuesta.data.equipo || [];
        puedeTodos_ = !!respuesta.data.puede_todos;
        puedeEquipo_ = !!respuesta.data.puede_equipo;
        puedePublicar_ = areasPropias_.length > 0 || puedeGeneral_;
        var btn = document.getElementById('btn-publicar-novedad');
        if (btn && puedePublicar_) {
          btn.classList.remove('sigso-oculto');
          btn.addEventListener('click', abrirFormularioPublicar_);
        }
      }
      renderChipsTipo_(document.getElementById('novedades-chips-tipo'));
      renderTabs_();
      cargarFeed_();
    }).catch(function () {
      renderChipsTipo_(document.getElementById('novedades-chips-tipo'));
      renderTabs_();
      cargarFeed_();
    });
  }

  /**
   * v6.6 (Fase 4): segmentos Publicadas / Por aprobar / Mis envíos. "Por
   * aprobar" y "Mis envíos" se piden siempre (sin saber de antemano si el
   * usuario es jefatura de alguien): si vienen vacios, simplemente no
   * aparece el contador -- no hace falta un permiso previo para decidir si
   * mostrar la pestaña.
   */
  // v12.1: la barra de pestañas pasa a navegación vertical (SigsoNav). Con
  // tres o cuatro vistas no hace falta acordeón: cada submódulo tiene un solo
  // ítem y el componente los aplana a enlaces directos. Se mantiene el nombre
  // renderTabs_ porque lo llaman varios sitios; lo que cambia es qué pinta.
  var ARQUITECTURA_NOVEDADES = [
    { id: 'publicadas', nombre: 'Publicadas', icono: 'campana', items: [
      { id: 'feed', nombre: 'Publicadas' }
    ] },
    { id: 'aprobar', nombre: 'Por aprobar', icono: 'check', items: [
      { id: 'aprobar', nombre: 'Por aprobar' }
    ] },
    { id: 'envios', nombre: 'Mis envíos', icono: 'subir', items: [
      { id: 'envios', nombre: 'Mis envíos' }
    ] },
    // Submódulo transversal. NO se inventa contenido: "Cumplimiento" ya
    // existía y ya era un reporte (quién leyó qué), sólo que estaba como una
    // pestaña más, indistinguible de las vistas de trabajo.
    { id: 'reportes', nombre: 'Reportes', icono: 'grafico', plano: true,
      descripcion: 'Quién leyó qué', items: [
      { id: 'cumplimiento', nombre: 'Cumplimiento de lectura' }
    ] }
  ];

  // v13.0: la navegacion vive en el sidebar. renderTabs_ conserva el nombre
  // porque lo llaman varios sitios; lo que hace ahora es registrar el arbol
  // (con sus badges y su permiso) y pedir que se repinte.
  function renderTabs_(pendientesAprobar, misEnvios) {
    if (!window.SigsoNav) return;
    SigsoNav.registrar('novedades', {
      nombre: 'Novedades',
      submodulos: ARQUITECTURA_NOVEDADES,
      // "Cumplimiento" sólo para ADM -- puedeGeneral_ es exactamente esa señal
      // (viene de listarAreasPublicablesNovedad). Mismo criterio que antes.
      visible: function (llave) { return llave === 'cumplimiento' ? !!puedeGeneral_ : true; }
    });
    if (window.SigsoShell && SigsoShell.refrescarArbol) SigsoShell.refrescarArbol();
    // Pide los contadores en segundo plano (no bloquea el feed inicial) y
    // vuelve a pintar con el número real.
    if (pendientesAprobar === undefined) {
      Promise.all([
        api_('listarPendientesAprobacionNovedad', {}).catch(function () { return null; }),
        api_('misPendientesNovedad', {}).catch(function () { return null; })
      ]).then(function (resultados) {
        var aprobar = resultados[0] && resultados[0].ok ? resultados[0].data.pendientes.length : 0;
        var envios = resultados[1] && resultados[1].ok ? resultados[1].data.envios.length : 0;
        renderTabs_(aprobar, envios);
      });
    }
  }

  function cambiarVista_() {
    var cont = document.getElementById('novedades-contenido');
    if (!cont) return;
    renderTabs_();
    document.getElementById('novedades-chips-tipo').classList.toggle('sigso-oculto', vista_ !== 'feed');
    document.getElementById('btn-publicar-novedad').classList.toggle('sigso-oculto', vista_ !== 'feed' || !puedePublicar_);
    if (vista_ === 'feed') { cargarFeed_(); return; }
    if (vista_ === 'aprobar') { cargarPendientesAprobacion_(); return; }
    if (vista_ === 'cumplimiento') { cargarPanelCumplimiento_(); return; }
    cargarMisEnvios_();
  }

  // Tarjeta compacta para "Por aprobar" / "Mis envíos" -- sin foto ni
  // acuse (todavia no aplica), con el estado como lo primero que se ve.
  function tarjetaEstado_(n) {
    var estadoInfo = {
      EN_REVISION: { etiqueta: 'En revisión', color: 'alerta' },
      DEVUELTA: { etiqueta: 'Devuelta para corregir', color: 'critico' },
      RECHAZADA: { etiqueta: 'Rechazada', color: 'critico' }
    }[n.estado] || { etiqueta: n.estado, color: 'info' };
    return '<article class="sigso-novedad-card" data-novedad="' + n.novedad_id + '" tabindex="0" role="button" ' +
      'aria-label="Abrir: ' + Componentes.escaparHtml(n.titulo) + '">' +
      '<div class="sigso-novedad-card__franja sigso-novedad-card__franja--' + n.tipo_color + '"></div>' +
      '<div class="sigso-novedad-card__cuerpo">' +
        '<div class="sigso-novedad-card__meta-top">' +
          '<span class="sigso-badge sigso-badge--' + n.tipo_color + '">' + Componentes.escaparHtml(n.tipo_etiqueta) + '</span>' +
          '<span class="sigso-badge sigso-badge--' + estadoInfo.color + '">' + Componentes.escaparHtml(estadoInfo.etiqueta) + '</span>' +
        '</div>' +
        '<h3 class="sigso-novedad-card__titulo">' + Componentes.escaparHtml(n.titulo) + '</h3>' +
        '<p class="sigso-novedad-card__resumen">' + Componentes.escaparHtml(n.resumen) + '</p>' +
        (n.motivo_devolucion ? '<p class="sigso-ayuda"><strong>Motivo:</strong> ' + Componentes.escaparHtml(n.motivo_devolucion) + '</p>' : '') +
        '<div class="sigso-novedad-card__meta-bottom">' +
          '<span>' + Componentes.escaparHtml(n.autor_nombre) + '</span>' +
          '<span aria-hidden="true">·</span>' +
          '<span>' + relativo_(n.fecha_creacion) + '</span>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function renderListaEstados_(items, mensajeVacio) {
    var cont = document.getElementById('novedades-contenido');
    var lista = cont.querySelector('.sigso-novedades__lista');
    if (!lista) return;
    lista.innerHTML = items.length
      ? items.map(tarjetaEstado_).join('')
      : Componentes.vacio({ icono: 'campana', texto: mensajeVacio });
    lista.querySelectorAll('[data-novedad]').forEach(function (card) {
      card.addEventListener('click', function () { abrirDetalle_(card.getAttribute('data-novedad')); });
      card.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); card.click(); }
      });
    });
  }

  function cargarPendientesAprobacion_() {
    var cont = document.getElementById('novedades-contenido');
    var lista = cont && cont.querySelector('.sigso-novedades__lista');
    if (lista) lista.innerHTML = Componentes.cargando('Cargando...');
    api_('listarPendientesAprobacionNovedad', {}).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        if (lista) lista.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar.', 'error');
        return;
      }
      renderListaEstados_(respuesta.data.pendientes, 'No tienes novedades pendientes de aprobar.');
    }).catch(function () {
      if (lista) lista.innerHTML = Componentes.alerta('No se pudo conectar.', 'error');
    });
  }

  function cargarMisEnvios_() {
    var cont = document.getElementById('novedades-contenido');
    var lista = cont && cont.querySelector('.sigso-novedades__lista');
    if (lista) lista.innerHTML = Componentes.cargando('Cargando...');
    api_('misPendientesNovedad', {}).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        if (lista) lista.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar.', 'error');
        return;
      }
      // v7.4b: "Mis envíos" solo muestra lo que sigue EN TRÁMITE (en
      // revisión, devuelto, rechazado) -- un Aviso/Logro (carril LIBRE) se
      // publica de inmediato y nunca pasa por aquí, así que vacío es lo
      // normal para esos tipos. Mensaje propio (antes era casi idéntico al
      // de "Por aprobar" -- "esperando aprobación" -- y confundía).
      renderListaEstados_(respuesta.data.envios, 'No tienes envíos en trámite. Los tipos que se publican de inmediato (Aviso, Logro) no pasan por aquí -- revisa "Publicadas".');
    }).catch(function () {
      if (lista) lista.innerHTML = Componentes.alerta('No se pudo conectar.', 'error');
    });
  }

  // Refresca la vista actual (feed/aprobar/envios/cumplimiento) sin perder
  // la pestaña en la que esta el usuario -- usado despues de aprobar/
  // devolver/rechazar/reenviar, que pueden mover una novedad de una lista
  // a otra (o cambiar sus numeros de cumplimiento).
  function recargarVistaActual_() {
    // Se llega aca despues de publicar/aprobar/devolver/rechazar/reenviar/
    // acusar: lo compartido quedo viejo y hay que volver a pedirlo.
    invalidarFeedCompartido_();
    if (vista_ === 'feed') { cargarFeed_(); return; }
    if (vista_ === 'aprobar') { cargarPendientesAprobacion_(); return; }
    if (vista_ === 'cumplimiento') { cargarPanelCumplimiento_(); renderTabs_(); return; }
    cargarMisEnvios_();
    renderTabs_();
  }

  // v6.8 (Fase 6): tarjeta del panel de cumplimiento -- el semaforo es lo
  // primero que se ve (vencida/por vencer/al dia/cumplida), con cuantos de
  // la audiencia real ya confirmaron. Clic abre el detalle normal (que ya
  // trae "Ver quién leyó" para ver nombres puntuales).
  var ESTADO_CUMPLIMIENTO_INFO = {
    VENCIDA: { etiqueta: 'Vencida', color: 'critico' },
    POR_VENCER: { etiqueta: 'Por vencer', color: 'alerta' },
    AL_DIA: { etiqueta: 'Al día', color: 'info' },
    CUMPLIDA: { etiqueta: 'Cumplida', color: 'ok' }
  };

  function textoPlazoCumplimiento_(dias) {
    if (dias < 0) return 'Venció hace ' + (-dias) + ' día(s)';
    if (dias === 0) return 'Vence hoy';
    return 'Vence en ' + dias + ' día(s)';
  }

  function tarjetaCumplimiento_(item) {
    var estadoInfo = ESTADO_CUMPLIMIENTO_INFO[item.estado_cumplimiento] || { etiqueta: item.estado_cumplimiento, color: 'info' };
    var pct = item.total_audiencia ? Math.round((item.confirmados / item.total_audiencia) * 100) : 0;
    return '<article class="sigso-novedad-card" data-novedad="' + item.novedad_id + '" tabindex="0" role="button" ' +
      'aria-label="Abrir: ' + Componentes.escaparHtml(item.titulo) + '">' +
      '<div class="sigso-novedad-card__franja sigso-novedad-card__franja--' + item.tipo_color + '"></div>' +
      '<div class="sigso-novedad-card__cuerpo">' +
        '<div class="sigso-novedad-card__meta-top">' +
          '<span class="sigso-badge sigso-badge--' + item.tipo_color + '">' + Componentes.escaparHtml(item.tipo_etiqueta) + '</span>' +
          '<span class="sigso-badge sigso-badge--' + estadoInfo.color + '">' + Componentes.escaparHtml(estadoInfo.etiqueta) + '</span>' +
        '</div>' +
        '<h3 class="sigso-novedad-card__titulo">' + Componentes.escaparHtml(item.titulo) + '</h3>' +
        '<p class="sigso-ayuda">' + Componentes.escaparHtml(textoPlazoCumplimiento_(item.dias_para_vencer)) +
          ' · ' + item.confirmados + '/' + item.total_audiencia + ' confirmaron (' + pct + '%)</p>' +
      '</div>' +
    '</article>';
  }

  function cargarPanelCumplimiento_() {
    var cont = document.getElementById('novedades-contenido');
    var lista = cont && cont.querySelector('.sigso-novedades__lista');
    if (lista) lista.innerHTML = Componentes.cargando('Cargando...');
    api_('getPanelCumplimientoNovedad', {}).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        if (lista) lista.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar.', 'error');
        return;
      }
      var items = respuesta.data.items;
      if (!lista) return;
      lista.innerHTML = items.length
        ? items.map(tarjetaCumplimiento_).join('')
        : Componentes.vacio({ icono: 'campana', texto: 'No hay novedades con fecha límite de acuse activa.' });
      lista.querySelectorAll('[data-novedad]').forEach(function (card) {
        card.addEventListener('click', function () { abrirDetalle_(card.getAttribute('data-novedad')); });
        card.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); card.click(); }
        });
      });
    }).catch(function () {
      if (lista) lista.innerHTML = Componentes.alerta('No se pudo conectar.', 'error');
    });
  }

  // --- Selector de audiencia (Fase 5) -----------------------------------------
  // Compartido por el formulario de publicar (carril LIBRE, lo elige el
  // autor) y el mini-formulario de aprobar (carril CONTROLADO, lo elige
  // quien aprueba) -- misma UI, mismo contrato con el backend
  // (audiencia_tipo + destinatarios), solo cambia quien la ve.

  function htmlAudienciaSelector_(prefix, defaultTipo) {
    var radios = [];
    if (puedeTodos_) {
      radios.push('<label class="sigso-campo-check"><input type="radio" name="' + prefix + '-audiencia" value="TODOS"' +
        (defaultTipo === 'TODOS' ? ' checked' : '') + '> Todos</label>');
    }
    if (puedeEquipo_) {
      radios.push('<label class="sigso-campo-check"><input type="radio" name="' + prefix + '-audiencia" value="MI_EQUIPO"' +
        (defaultTipo === 'MI_EQUIPO' ? ' checked' : '') + '> Mi equipo (' + equipo_.length + ')</label>');
    }
    radios.push('<label class="sigso-campo-check"><input type="radio" name="' + prefix + '-audiencia" value="SELECCION"' +
      (defaultTipo === 'SELECCION' ? ' checked' : '') + '> Seleccionar personas</label>');

    var checklist = directorio_.length
      ? directorio_.map(function (p) {
          return '<label class="sigso-campo-check"><input type="checkbox" class="js-' + prefix + '-destinatario" value="' +
            Componentes.escaparHtml(p.email) + '"> ' + Componentes.escaparHtml(p.nombre) + '</label>';
        }).join('')
      : '<p class="sigso-ayuda">No hay personas con credenciales activas para elegir.</p>';

    return '<div class="sigso-campo"><label>¿A quién llega?</label>' +
      '<div class="sigso-audiencia-opciones">' + radios.join('') + '</div>' +
      '<div class="sigso-audiencia-lista" id="' + prefix + '-audiencia-lista">' + checklist + '</div>' +
    '</div>';
  }

  // Muestra/oculta el checklist de personas segun la opcion elegida.
  function bindAudienciaSelector_(cont, prefix) {
    var radios = cont.querySelectorAll('input[name="' + prefix + '-audiencia"]');
    var lista = cont.querySelector('#' + prefix + '-audiencia-lista');
    function actualizar() {
      var elegido = cont.querySelector('input[name="' + prefix + '-audiencia"]:checked');
      lista.classList.toggle('sigso-oculto', !elegido || elegido.value !== 'SELECCION');
    }
    radios.forEach(function (r) { r.addEventListener('change', actualizar); });
    actualizar();
  }

  function leerAudienciaSeleccionada_(cont, prefix) {
    var elegido = cont.querySelector('input[name="' + prefix + '-audiencia"]:checked');
    var tipo = elegido ? elegido.value : 'SELECCION';
    var destinatarios = tipo === 'SELECCION'
      ? Array.from(cont.querySelectorAll('.js-' + prefix + '-destinatario:checked')).map(function (el) { return el.value; })
      : [];
    return { audiencia_tipo: tipo, destinatarios: destinatarios };
  }

  // Linea "Dirigido a..." en el detalle -- solo se muestra si NO es TODOS
  // (el caso normal no necesita explicarse).
  function lineaAudiencia_(n) {
    if (!n.audiencia || !n.audiencia.tipo || n.audiencia.tipo === 'TODOS') return '';
    var texto = n.audiencia.tipo === 'MI_EQUIPO'
      ? 'Dirigido a un equipo específico, no a todo el personal.'
      : 'Dirigido a: ' + (n.audiencia.destinatarios || []).map(function (p) { return p.nombre; }).join(', ');
    return '<p class="sigso-ayuda">' + Componentes.escaparHtml(texto) + '</p>';
  }

  // --- Detalle + acuse ------------------------------------------------------

  function abrirDetalle_(novedadId) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<div class="js-detalle-cuerpo">' + Componentes.cargando('Cargando...') + '</div>' +
      '</div>';
    function cerrar() {
      document.removeEventListener('keydown', alTeclado);
      if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
    }
    function alTeclado(ev) { if (ev.key === 'Escape') cerrar(); }
    fondo.addEventListener('click', function (ev) { if (ev.target === fondo) cerrar(); });
    document.addEventListener('keydown', alTeclado);
    document.body.appendChild(fondo);

    api_('getDetalleNovedad', { novedad_id: novedadId }).then(function (respuesta) {
      var cuerpo = fondo.querySelector('.js-detalle-cuerpo');
      if (!respuesta || !respuesta.ok) {
        cuerpo.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar.', 'error');
        return;
      }
      renderDetalle_(cuerpo, respuesta.data, cerrar);
    }).catch(function () {
      fondo.querySelector('.js-detalle-cuerpo').innerHTML =
        Componentes.alerta('No se pudo conectar.', 'error');
    });
  }

  // v6.6 (Fase 4): mientras no esta PUBLICADA, no hay acuse ni lectores ni
  // "retirar" que tengan sentido -- lo que corresponde es el circuito de
  // aprobacion (o, si esta DEVUELTA y soy el autor, corregir y reenviar).
  var ESTADO_INFO = {
    EN_REVISION: { etiqueta: 'En revisión', color: 'alerta' },
    DEVUELTA: { etiqueta: 'Devuelta para corregir', color: 'critico' },
    RECHAZADA: { etiqueta: 'Rechazada', color: 'critico' }
  };

  function renderDetalle_(cuerpo, n, cerrar) {
    var avatar = window.SigsoPerfil
      ? SigsoPerfil.avatarDe(n.autor_nombre, n.autor_email, { tam: 'md' })
      : '';
    var noPublicada = n.estado && n.estado !== 'PUBLICADA';
    var estadoInfo = ESTADO_INFO[n.estado];

    cuerpo.innerHTML =
      '<div class="sigso-novedad-detalle">' +
        '<div class="sigso-novedad-card__meta-top">' +
          '<span class="sigso-badge sigso-badge--' + n.tipo_color + '">' + Componentes.escaparHtml(n.tipo_etiqueta) + '</span>' +
          (estadoInfo ? '<span class="sigso-badge sigso-badge--' + estadoInfo.color + '">' + Componentes.escaparHtml(estadoInfo.etiqueta) + '</span>' : '') +
          (n.area_nombre ? '<span class="sigso-novedad-card__area">' + Componentes.escaparHtml(n.area_nombre) + '</span>' : '<span class="sigso-novedad-card__area">General</span>') +
        '</div>' +
        '<h2 class="sigso-novedad-detalle__titulo">' + Componentes.escaparHtml(n.titulo) + '</h2>' +
        chipVigencia_(n.fecha_vigencia) +
        (!noPublicada ? chipPlazoAcuse_(n) : '') +
        '<div class="sigso-novedad-detalle__autor">' + avatar +
          '<div><strong>' + Componentes.escaparHtml(n.autor_nombre) + '</strong>' +
          '<div class="sigso-ayuda">' + relativo_(n.fecha_publicacion || n.fecha_creacion) + '</div></div>' +
        '</div>' +
        (n.motivo_devolucion ? Componentes.alerta('Motivo: ' + n.motivo_devolucion, 'error') : '') +
        (!noPublicada ? lineaAudiencia_(n) : '') +
        '<div class="sigso-novedad-detalle__cuerpo">' + Componentes.escaparHtml(n.cuerpo || n.resumen).replace(/\n/g, '<br>') + '</div>' +
        (n.tiene_adjunto
          ? Componentes.boton({ texto: 'Descargar adjunto', icono: 'descargar', variante: 'secundario', clase: 'js-descargar-adjunto' })
          : '') +
        '<div class="sigso-novedad-detalle__acciones">' +
          (!noPublicada && n.requiere_acuse && !n.leida
            ? Componentes.boton({ texto: 'Enterado', icono: 'check', clase: 'js-marcar-leida' })
            : (!noPublicada && n.requiere_acuse
                ? '<span class="sigso-novedad-card__leida">' + Iconos.svg('check', { tam: 14 }) + ' Ya diste acuse de esta novedad</span>'
                : '')) +
          (!noPublicada && n.puede_gestionar && n.requiere_acuse
            ? Componentes.boton({ texto: 'Ver quién leyó', variante: 'secundario', clase: 'js-ver-lectores' })
            : '') +
          (!noPublicada && n.puede_gestionar
            ? Componentes.boton({ texto: 'Retirar', variante: 'sutil', clase: 'sigso-boton--destructivo-sutil js-retirar-novedad' })
            : '') +
          (n.estado === 'EN_REVISION' && n.puede_aprobar
            ? Componentes.boton({ texto: 'Aprobar', icono: 'check', clase: 'js-aprobar-novedad' }) +
              Componentes.boton({ texto: 'Devolver', variante: 'secundario', clase: 'js-devolver-novedad' }) +
              Componentes.boton({ texto: 'Rechazar', variante: 'sutil', clase: 'sigso-boton--destructivo-sutil js-rechazar-novedad' })
            : '') +
          (n.estado === 'DEVUELTA' && n.es_autor
            ? Componentes.boton({ texto: 'Corregir y reenviar', icono: 'editar', clase: 'js-reenviar-novedad' })
            : '') +
        '</div>' +
        '<div class="js-lectores-panel"></div>' +
      '</div>';

    var btnLeida = cuerpo.querySelector('.js-marcar-leida');
    if (btnLeida) {
      btnLeida.addEventListener('click', function () {
        btnLeida.disabled = true;
        btnLeida.innerHTML = '<span class="sigso-spinner"></span>Guardando...';
        api_('marcarLeidaNovedad', { novedad_id: n.novedad_id }).then(function (respuesta) {
          if (!respuesta || !respuesta.ok) {
            Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo registrar el acuse.', tipo: 'error' });
            btnLeida.disabled = false;
            btnLeida.innerHTML = Iconos.svg('check', { tam: 15 }) + 'Enterado';
            return;
          }
          Componentes.aviso({ texto: 'Acuse registrado.', tipo: 'exito' });
          cerrar();
          recargarVistaActual_();
          refrescarTarjetaHomeSiExiste_();
        }).catch(function () {
          Componentes.aviso({ texto: 'No se pudo conectar.', tipo: 'error' });
          btnLeida.disabled = false;
          btnLeida.innerHTML = Iconos.svg('check', { tam: 15 }) + 'Enterado';
        });
      });
    }

    var btnAdjunto = cuerpo.querySelector('.js-descargar-adjunto');
    if (btnAdjunto) {
      btnAdjunto.addEventListener('click', function () {
        api_('descargarAdjuntoNovedad', { novedad_id: n.novedad_id }).then(function (respuesta) {
          if (!respuesta || !respuesta.ok) {
            Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo descargar el adjunto.', tipo: 'error' });
            return;
          }
          descargarBase64_(respuesta.data.contenido_base64, respuesta.data.nombre_archivo, respuesta.data.mime);
        });
      });
    }

    var btnLectores = cuerpo.querySelector('.js-ver-lectores');
    if (btnLectores) {
      btnLectores.addEventListener('click', function () {
        var panel = cuerpo.querySelector('.js-lectores-panel');
        panel.innerHTML = Componentes.cargando('Cargando...');
        api_('getLectoresNovedad', { novedad_id: n.novedad_id }).then(function (respuesta) {
          if (!respuesta || !respuesta.ok) {
            panel.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar.', 'error');
            return;
          }
          renderLectores_(panel, respuesta.data);
        }).catch(function () {
          panel.innerHTML = Componentes.alerta('No se pudo conectar.', 'error');
        });
      });
    }

    var btnRetirar = cuerpo.querySelector('.js-retirar-novedad');
    if (btnRetirar) {
      btnRetirar.addEventListener('click', function () {
        Componentes.confirmar({
          titulo: 'Retirar esta novedad',
          mensaje: 'Dejará de verse en el feed. No se puede deshacer desde aquí.',
          confirmar: 'Retirar', peligro: true
        }).then(function (confirmado) {
          if (!confirmado) return;
          api_('despublicarNovedad', { novedad_id: n.novedad_id }).then(function (respuesta) {
            if (!respuesta || !respuesta.ok) {
              Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo retirar.', tipo: 'error' });
              return;
            }
            Componentes.aviso({ texto: 'Novedad retirada.', tipo: 'exito' });
            cerrar();
            recargarVistaActual_();
            refrescarTarjetaHomeSiExiste_();
          });
        });
      });
    }

    // v6.6 (Fase 4): aprobar/devolver/rechazar (jefatura/ADM).
    // v6.7 (Fase 5): aprobar abre un mini-formulario para elegir a quien
    // llega -- ya no es una accion instantanea.
    var btnAprobar = cuerpo.querySelector('.js-aprobar-novedad');
    if (btnAprobar) {
      btnAprobar.addEventListener('click', function () {
        cerrar();
        abrirFormularioAprobar_(n);
      });
    }

    function pedirMotivoYEnviar_(accion, tituloPrompt, mensajeExito) {
      Componentes.prompt({
        titulo: tituloPrompt,
        placeholder: 'Explica por qué (mínimo 10 caracteres)…',
        confirmar: 'Enviar',
        validar: function (valor) {
          return valor.trim().length < 10 ? 'El motivo debe tener al menos 10 caracteres.' : null;
        }
      }).then(function (motivo) {
        if (motivo === null) return; // cancelado
        api_(accion, { novedad_id: n.novedad_id, motivo: motivo }).then(function (respuesta) {
          if (!respuesta || !respuesta.ok) {
            Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo completar la acción.', tipo: 'error' });
            return;
          }
          Componentes.aviso({ texto: mensajeExito, tipo: 'exito' });
          cerrar();
          recargarVistaActual_();
        }).catch(function () {
          Componentes.aviso({ texto: 'No se pudo conectar.', tipo: 'error' });
        });
      });
    }

    var btnDevolver = cuerpo.querySelector('.js-devolver-novedad');
    if (btnDevolver) {
      btnDevolver.addEventListener('click', function () {
        pedirMotivoYEnviar_('devolverNovedad', 'Devolver para corregir', 'Novedad devuelta al autor.');
      });
    }

    var btnRechazar = cuerpo.querySelector('.js-rechazar-novedad');
    if (btnRechazar) {
      btnRechazar.addEventListener('click', function () {
        pedirMotivoYEnviar_('rechazarNovedad', 'Rechazar novedad', 'Novedad rechazada.');
      });
    }

    var btnReenviar = cuerpo.querySelector('.js-reenviar-novedad');
    if (btnReenviar) {
      btnReenviar.addEventListener('click', function () {
        cerrar();
        abrirFormularioReenviar_(n);
      });
    }
  }

  // Fase 2 (seguimiento de lectura): panel simple, sin foto ni adorno --
  // el punto es poder verificar rapido "quien falta", no otra vista bonita.
  function renderLectores_(cont, datos) {
    var listaLeyeron = datos.leyeron.length
      ? '<ul class="sigso-lectores-lista">' + datos.leyeron.map(function (p) {
          return '<li>' + Iconos.svg('check', { tam: 13 }) + ' ' + Componentes.escaparHtml(p.nombre) + '</li>';
        }).join('') + '</ul>'
      : '<p class="sigso-ayuda">Nadie ha confirmado todavía.</p>';
    var listaPendientes = datos.pendientes.length
      ? '<ul class="sigso-lectores-lista sigso-lectores-lista--pendiente">' + datos.pendientes.map(function (p) {
          return '<li>' + Componentes.escaparHtml(p.nombre) + '</li>';
        }).join('') + '</ul>'
      : '<p class="sigso-ayuda">Nadie queda pendiente.</p>';

    cont.innerHTML =
      '<div class="sigso-lectores">' +
        '<div><h4>Confirmaron (' + datos.leyeron.length + ')</h4>' + listaLeyeron + '</div>' +
        '<div><h4>Pendientes (' + datos.pendientes.length + ')</h4>' + listaPendientes + '</div>' +
      '</div>';
  }

  function descargarBase64_(base64, nombre, mime) {
    var bytes = atob(base64);
    var arr = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    var blob = new Blob([arr], { type: mime || 'application/pdf' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = nombre || 'adjunto.pdf';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  // --- Aprobar + elegir audiencia (Fase 5) ------------------------------------

  // v6.7: quien aprueba una novedad CONTROLADA elige, en el mismo paso, a
  // quien llega -- mismo selector que el formulario de publicar, pero
  // evaluado contra QUIEN APRUEBA (jefatura/ADM), no contra el autor.
  // v6.8 (Fase 6): Ley/Dictamen exigen fecha límite de acuse al aprobar;
  // el resto la deja opcional.
  function exigeFechaLimite_(tipo) {
    return tipo === 'LEY' || tipo === 'DICTAMEN';
  }

  function abrirFormularioAprobar_(n) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    var exigeFecha = exigeFechaLimite_(n.tipo);
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Aprobar novedad</h3>' +
        '<p class="sigso-ayuda">' + Componentes.escaparHtml(n.titulo) + '</p>' +
        '<form id="form-aprobar-novedad">' +
          '<div class="sigso-campo"><label>Fecha límite para dar acuse' + (exigeFecha ? '' : ' (opcional)') + '</label>' +
            '<input type="date" id="ap-fecha-limite"' + (exigeFecha ? ' required' : '') + '></div>' +
          htmlAudienciaSelector_('ap', 'SELECCION') +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-cancelar-aprobar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Aprobar y publicar', icono: 'check', tipo: 'submit' }) +
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

    fondo.querySelector('.js-cancelar-aprobar').addEventListener('click', cerrar);
    bindAudienciaSelector_(fondo, 'ap');

    var form = document.getElementById('form-aprobar-novedad');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var botonSubmit = form.querySelector('button[type="submit"]');
      botonSubmit.disabled = true;
      botonSubmit.textContent = 'Aprobando...';
      var audiencia = leerAudienciaSeleccionada_(fondo, 'ap');
      var fechaLimite = document.getElementById('ap-fecha-limite').value;
      api_('aprobarNovedad', Object.assign(
        { novedad_id: n.novedad_id, fecha_limite_acuse: fechaLimite }, audiencia
      )).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo aprobar.', tipo: 'error' });
          botonSubmit.disabled = false;
          botonSubmit.textContent = 'Aprobar y publicar';
          return;
        }
        Componentes.aviso({ texto: 'Novedad aprobada y publicada.', tipo: 'exito' });
        cerrar();
        recargarVistaActual_();
      }).catch(function () {
        Componentes.aviso({ texto: 'No se pudo conectar.', tipo: 'error' });
        botonSubmit.disabled = false;
        botonSubmit.textContent = 'Aprobar y publicar';
      });
    });
  }

  // --- Corregir y reenviar (Fase 4) -------------------------------------------

  // v6.6: el autor edita una novedad DEVUELTA y la reenvia a revision.
  // Reusa el markup del formulario de publicar pero sin tipo/area (esos no
  // cambian al corregir) ni adjunto (no se reemplaza aqui).
  function abrirFormularioReenviar_(n) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Corregir y reenviar</h3>' +
        (n.motivo_devolucion ? Componentes.alerta('Motivo de la devolución: ' + n.motivo_devolucion, 'error') : '') +
        '<form id="form-reenviar-novedad" class="sigso-novedad-form">' +
          '<div class="sigso-campo"><label>Título</label><input type="text" id="nr-titulo" maxlength="140" required value="' + Componentes.escaparHtml(n.titulo) + '"></div>' +
          '<div class="sigso-campo"><label>Resumen (1-2 líneas)</label><textarea id="nr-resumen" rows="2" maxlength="240" required>' + Componentes.escaparHtml(n.resumen) + '</textarea></div>' +
          '<div class="sigso-campo"><label>Detalle completo</label><textarea id="nr-cuerpo" rows="6">' + Componentes.escaparHtml(n.cuerpo || '') + '</textarea></div>' +
          '<div class="sigso-campo"><label>Entra en vigencia (opcional)</label><input type="date" id="nr-vigencia" value="' + Componentes.escaparHtml(n.fecha_vigencia || '') + '"></div>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-cancelar-reenviar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Reenviar a revisión', tipo: 'submit' }) +
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

    fondo.querySelector('.js-cancelar-reenviar').addEventListener('click', cerrar);

    var form = document.getElementById('form-reenviar-novedad');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var botonSubmit = form.querySelector('button[type="submit"]');
      botonSubmit.disabled = true;
      botonSubmit.textContent = 'Reenviando...';
      api_('reenviarNovedad', {
        novedad_id: n.novedad_id,
        titulo: document.getElementById('nr-titulo').value,
        resumen: document.getElementById('nr-resumen').value,
        cuerpo: document.getElementById('nr-cuerpo').value,
        fecha_vigencia: document.getElementById('nr-vigencia').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo reenviar.', tipo: 'error' });
          botonSubmit.disabled = false;
          botonSubmit.textContent = 'Reenviar a revisión';
          return;
        }
        Componentes.aviso({ texto: 'Novedad reenviada a revisión.', tipo: 'exito' });
        cerrar();
        recargarVistaActual_();
      }).catch(function () {
        Componentes.aviso({ texto: 'No se pudo conectar.', tipo: 'error' });
        botonSubmit.disabled = false;
        botonSubmit.textContent = 'Reenviar a revisión';
      });
    });
  }

  // --- Publicar --------------------------------------------------------------

  function abrirFormularioPublicar_() {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    var opcionesArea = (puedeGeneral_ ? ['<option value="">General (todos)</option>'] : [])
      .concat(areasPropias_.map(function (a) {
        return '<option value="' + Componentes.escaparHtml(a.area_id) + '">' + Componentes.escaparHtml(a.nombre) + '</option>';
      })).join('');

    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Publicar novedad</h3>' +
        '<form id="form-publicar-novedad" class="sigso-novedad-form">' +
          '<div class="sigso-campo"><label>Tipo</label><select id="np-tipo" required>' +
            tiposCatalogo_.map(function (t) {
              return '<option value="' + t.tipo + '" data-carril="' + t.carril + '">' + Componentes.escaparHtml(t.etiqueta) + '</option>';
            }).join('') +
          '</select></div>' +
          '<div id="np-aviso-carril"></div>' +
          '<div id="np-audiencia-bloque">' + htmlAudienciaSelector_('np', 'SELECCION') + '</div>' +
          '<div class="sigso-campo"><label>Área</label><select id="np-area">' + opcionesArea + '</select></div>' +
          '<div class="sigso-campo"><label>Título</label><input type="text" id="np-titulo" maxlength="140" required></div>' +
          '<div class="sigso-campo"><label>Resumen (1-2 líneas)</label><textarea id="np-resumen" rows="2" maxlength="240" required></textarea></div>' +
          '<div class="sigso-campo"><label>Detalle completo</label><textarea id="np-cuerpo" rows="6"></textarea></div>' +
          '<div class="sigso-campo"><label>Entra en vigencia (opcional)</label><input type="date" id="np-vigencia"></div>' +
          '<div class="sigso-campo" id="np-fecha-limite-campo"><label>Fecha límite para dar acuse (opcional)</label><input type="date" id="np-fecha-limite"></div>' +
          '<div class="sigso-campo"><label>Adjunto PDF (opcional)</label><input type="file" id="np-archivo" accept="application/pdf"></div>' +
          '<label class="sigso-campo-check"><input type="checkbox" id="np-requiere-acuse" checked> Exigir acuse de lectura ("Enterado")</label>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-cancelar-publicar', tipo: 'button' }) +
            Componentes.boton({ texto: carrilDe_(tiposCatalogo_[0] && tiposCatalogo_[0].tipo) === 'CONTROLADO' ? 'Enviar a revisión' : 'Publicar', tipo: 'submit', clase: 'js-submit-publicar' }) +
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

    fondo.querySelector('.js-cancelar-publicar').addEventListener('click', cerrar);
    bindAudienciaSelector_(fondo, 'np');

    // v6.6: el aviso de "esto requiere aprobación" y el texto del boton
    // dependen del carril del tipo elegido -- se actualizan al cambiar el
    // selector, y de nuevo al enviar (por si el usuario nunca lo toco).
    // v6.7: en CONTROLADO se oculta el selector de audiencia -- la elige
    // quien aprueba, no tiene sentido pedirla aqui todavia.
    var selectTipo = document.getElementById('np-tipo');
    var botonSubmitRef = fondo.querySelector('.js-submit-publicar');
    function actualizarAvisoCarril_() {
      var carril = selectTipo.options[selectTipo.selectedIndex].getAttribute('data-carril');
      var esControlado = carril === 'CONTROLADO';
      document.getElementById('np-aviso-carril').innerHTML = esControlado
        ? Componentes.alerta('Este tipo requiere la aprobación de tu jefatura antes de publicarse.', 'info')
        : '';
      document.getElementById('np-audiencia-bloque').classList.toggle('sigso-oculto', esControlado);
      document.getElementById('np-fecha-limite-campo').classList.toggle('sigso-oculto', esControlado);
      botonSubmitRef.textContent = esControlado ? 'Enviar a revisión' : 'Publicar';
    }
    selectTipo.addEventListener('change', actualizarAvisoCarril_);
    actualizarAvisoCarril_();

    var form = document.getElementById('form-publicar-novedad');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var botonSubmit = form.querySelector('button[type="submit"]');
      var archivo = document.getElementById('np-archivo').files[0];
      var esControlado = selectTipo.options[selectTipo.selectedIndex].getAttribute('data-carril') === 'CONTROLADO';
      var textoOriginal = esControlado ? 'Enviar a revisión' : 'Publicar';

      function enviar(contenidoBase64, nombreArchivo) {
        botonSubmit.disabled = true;
        botonSubmit.textContent = esControlado ? 'Enviando...' : 'Publicando...';
        var audiencia = esControlado ? null : leerAudienciaSeleccionada_(fondo, 'np');
        api_('publicarNovedad', Object.assign({
          tipo: document.getElementById('np-tipo').value,
          area_id: document.getElementById('np-area').value,
          titulo: document.getElementById('np-titulo').value,
          resumen: document.getElementById('np-resumen').value,
          cuerpo: document.getElementById('np-cuerpo').value,
          fecha_vigencia: document.getElementById('np-vigencia').value,
          fecha_limite_acuse: esControlado ? '' : document.getElementById('np-fecha-limite').value,
          requiere_acuse: document.getElementById('np-requiere-acuse').checked,
          contenido_base64: contenidoBase64,
          nombre_archivo: nombreArchivo
        }, audiencia || {})).then(function (respuesta) {
          if (!respuesta || !respuesta.ok) {
            Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo publicar.', tipo: 'error' });
            botonSubmit.disabled = false;
            botonSubmit.textContent = textoOriginal;
            return;
          }
          Componentes.aviso({
            texto: respuesta.data.estado === 'EN_REVISION' ? 'Novedad enviada a revisión.' : 'Novedad publicada.',
            tipo: 'exito'
          });
          cerrar();
          recargarVistaActual_();
        }).catch(function () {
          Componentes.aviso({ texto: 'No se pudo conectar.', tipo: 'error' });
          botonSubmit.disabled = false;
          botonSubmit.textContent = textoOriginal;
        });
      }

      if (archivo) {
        var lector = new FileReader();
        lector.onload = function () {
          var base64 = lector.result.slice(lector.result.indexOf(',') + 1);
          enviar(base64, archivo.name);
        };
        lector.readAsDataURL(archivo);
      } else {
        enviar(null, null);
      }
    });
  }

  // v13.1: registro TEMPRANO del arbol. Antes esto pasaba recien al abrir
  // el modulo, asi que el sidebar no le dibujaba el chevron ni lo dejaba
  // desplegar hasta que entrabas una vez.
  if (window.SigsoNav) {
    SigsoNav.registrar('novedades', {
      nombre: 'Novedades',
      submodulos: ARQUITECTURA_NOVEDADES,
      visible: function (llave) { return llave === 'cumplimiento' ? !!puedeGeneral_ : true; }
    });
  }
})();
