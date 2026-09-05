/**
 * navegacion.js — arquitectura de navegación de SIGSO (v12.0).
 *
 * PROBLEMA QUE RESUELVE
 * Cada módulo resolvía su navegación interna por su cuenta y casi siempre con
 * una barra horizontal de pestañas:
 *   - calidad.js       16 secciones en 7 grupos, en UNA barra con scroll lateral
 *   - proyectos.js      7 pestañas por proyecto
 *   - novedades.js      3-4 vistas
 *   - coordinacion.js   3 vistas
 *   - admin.js         14 ítems (ya vertical) + sub-pestañas dentro de Pausas
 * El propio CSS de Calidad dejó escrito el síntoma: "con la quinta sección la
 * barra dejó de caber en un móvil y estiraba la página entera". Hoy son 16.
 *
 * QUÉ HACE ESTE ARCHIVO
 * Da UNA sola forma de declarar y pintar la navegación interna de cualquier
 * módulo, con la jerarquía Módulo -> Submódulo -> Ítem, en vertical.
 *
 * LO QUE **NO** HACE, A PROPÓSITO
 *  - No decide permisos. Recibe un predicado `visible` y lo obedece. Quien
 *    manda sigue siendo el backend (en Calidad, seccionesVisiblesSgc_).
 *  - No conoce ningún módulo en particular. La arquitectura de cada uno se
 *    declara al llamar, o se registra en SigsoNav.registrar().
 *  - No navega solo: avisa por onSeleccion y el módulo decide qué pintar.
 *
 * REGLA DE PROFUNDIDAD
 * Un submódulo con UN solo ítem que se llama igual que él no se dibuja como
 * acordeón: se dibuja como un enlace directo. Tres niveles visibles siempre
 * serían más ruido que ayuda (§24 del encargo: "no sobrediseñar").
 */
(function () {
  'use strict';

  // Submódulo de Reportes: es transversal a todos los módulos y por eso su id
  // está fijado aquí y no lo elige cada módulo. Se dibuja destacado (§23).
  var ID_REPORTES = 'reportes';

  // Registro central de arquitecturas por módulo. Un módulo puede registrarse
  // aquí (compartido) o pasar sus submódulos directo en cada render.
  var registro_ = {};

  /**
   * Registra la arquitectura de un módulo.
   * @param {string} moduloId
   * @param {{nombre:string, submodulos:Array}} definicion
   */
  function registrar(moduloId, definicion) {
    registro_[moduloId] = definicion;
  }

  function obtener(moduloId) {
    return registro_[moduloId] || null;
  }

  /**
   * Separa un id de ítem compuesto: "documentos:PRO" -> {seccion, argumento}.
   * Permite que un submódulo tenga ítems que son VISTAS FILTRADAS de una misma
   * sección ya existente, sin duplicar pantallas ni inventar endpoints.
   */
  function partes(itemId) {
    var i = String(itemId || '').indexOf(':');
    if (i === -1) return { seccion: String(itemId || ''), argumento: '' };
    return {
      seccion: String(itemId).slice(0, i),
      argumento: String(itemId).slice(i + 1)
    };
  }

  function icono_(nombre, tam) {
    if (!nombre || !window.Iconos || !window.Iconos.svg) return '';
    return window.Iconos.svg(nombre, { tam: tam || 16 });
  }

  function esc_(texto) {
    return window.Componentes ? window.Componentes.escaparHtml(texto) : String(texto == null ? '' : texto);
  }

  /**
   * ¿Qué ítems de este submódulo puede ver la persona?
   * `visible` puede faltar (todo visible) o ser una función id -> bool.
   */
  function itemsVisibles_(sub, visible) {
    var items = sub.items || [];
    if (typeof visible !== 'function') return items.slice();
    return items.filter(function (it) {
      // El permiso puede declararse aparte del id: un ítem "documentos:PRO"
      // se rige por el permiso de "documentos", no por uno propio.
      var llave = it.permiso || partes(it.id).seccion;
      return visible(llave, it) !== false;
    });
  }

  /**
   * Un submódulo con un único ítem homónimo se aplana a enlace directo.
   * Ej.: "Inicio > Tablero" se dibuja solo como "Inicio".
   */
  function esPlano_(sub, items) {
    if (items.length !== 1) return false;
    if (sub.plano === false) return false;
    return sub.plano === true || items[0].nombre === sub.nombre;
  }

  function badgeHtml_(valor) {
    if (valor === undefined || valor === null || valor === '' || valor === 0) return '';
    return '<span class="sigso-nav2__badge">' + esc_(valor) + '</span>';
  }

  /**
   * Pinta la navegación vertical de un módulo dentro de `contenedor`.
   *
   * @param {Object} opts
   *   contenedor   {HTMLElement}  dónde pintar
   *   modulo       {string}       id del módulo (para data-attrs y registro)
   *   submodulos   {Array}        si falta, se toma del registro
   *   activo       {string}       id del ítem activo
   *   visible      {Function}     (llavePermiso, item) -> bool
   *   badges       {Object}       { itemId: valor }
   *   onSeleccion  {Function}     (itemId, item) -> void
   */
  function render(opts) {
    var cont = opts.contenedor;
    if (!cont) return;

    var def = opts.submodulos ? { submodulos: opts.submodulos } : obtener(opts.modulo);
    if (!def) { cont.innerHTML = ''; return; }

    var activo = opts.activo || '';
    var seccionActiva = partes(activo).seccion;
    var badges = opts.badges || {};

    // Sólo submódulos con al menos un ítem visible.
    var grupos = [];
    (def.submodulos || []).forEach(function (sub) {
      var items = itemsVisibles_(sub, opts.visible);
      if (!items.length) return;
      grupos.push({ sub: sub, items: items });
    });

    var html = grupos.map(function (g, indice) {
      var sub = g.sub;
      var items = g.items;
      // Un submódulo se abre si contiene el ítem activo. Es lo que hace que al
      // entrar por un enlace directo el usuario vea DÓNDE está parado.
      var contieneActivo = items.some(function (it) {
        return it.id === activo || partes(it.id).seccion === seccionActiva;
      });
      var destacado = sub.id === ID_REPORTES;

      if (esPlano_(sub, items)) {
        var it0 = items[0];
        var activoPlano = it0.id === activo;
        return '<div class="sigso-nav2__bloque' + (destacado ? ' sigso-nav2__bloque--destacado' : '') + '">' +
          '<button type="button" class="sigso-nav2__directo' + (activoPlano ? ' sigso-nav2__directo--activo' : '') + '"' +
            ' data-nav-item="' + esc_(it0.id) + '"' +
            (activoPlano ? ' aria-current="page"' : '') + '>' +
            '<span class="sigso-nav2__ico">' + icono_(sub.icono || it0.icono, 16) + '</span>' +
            '<span class="sigso-nav2__txt">' + esc_(sub.nombre) + '</span>' +
            badgeHtml_(badges[it0.id]) +
          '</button>' +
        '</div>';
      }

      var idPanel = 'nav2-' + esc_(opts.modulo || 'mod') + '-' + esc_(sub.id);
      return '<div class="sigso-nav2__bloque' + (destacado ? ' sigso-nav2__bloque--destacado' : '') + '">' +
        '<button type="button" class="sigso-nav2__cab' + (contieneActivo ? ' sigso-nav2__cab--abierto' : '') + '"' +
          ' data-nav-sub="' + esc_(sub.id) + '"' +
          ' aria-expanded="' + (contieneActivo ? 'true' : 'false') + '"' +
          ' aria-controls="' + idPanel + '">' +
          '<span class="sigso-nav2__ico">' + icono_(sub.icono, 16) + '</span>' +
          '<span class="sigso-nav2__txt">' + esc_(sub.nombre) + '</span>' +
          (sub.descripcion ? '<span class="sigso-nav2__desc">' + esc_(sub.descripcion) + '</span>' : '') +
          '<span class="sigso-nav2__chevron" aria-hidden="true"></span>' +
        '</button>' +
        '<ul class="sigso-nav2__items" id="' + idPanel + '" role="list"' +
            (contieneActivo ? '' : ' hidden') + '>' +
          items.map(function (it) {
            var esActivo = it.id === activo;
            return '<li>' +
              '<button type="button" class="sigso-nav2__item' + (esActivo ? ' sigso-nav2__item--activo' : '') + '"' +
                ' data-nav-item="' + esc_(it.id) + '"' +
                (esActivo ? ' aria-current="page"' : '') + '>' +
                '<span class="sigso-nav2__punto" aria-hidden="true"></span>' +
                '<span class="sigso-nav2__txt">' + esc_(it.nombre) + '</span>' +
                badgeHtml_(badges[it.id]) +
              '</button>' +
            '</li>';
          }).join('') +
        '</ul>' +
      '</div>';
    }).join('');

    cont.innerHTML = html;
    cont.setAttribute('data-nav-modulo', opts.modulo || '');

    // --- interacción ---------------------------------------------------------
    cont.querySelectorAll('[data-nav-sub]').forEach(function (cab) {
      cab.addEventListener('click', function () {
        var abierto = cab.getAttribute('aria-expanded') === 'true';
        var panel = document.getElementById(cab.getAttribute('aria-controls'));
        cab.setAttribute('aria-expanded', abierto ? 'false' : 'true');
        cab.classList.toggle('sigso-nav2__cab--abierto', !abierto);
        if (panel) panel.hidden = abierto;
      });
    });

    cont.querySelectorAll('[data-nav-item]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-nav-item');
        if (typeof opts.onSeleccion === 'function') opts.onSeleccion(id, partes(id));
      });
    });
  }

  /**
   * Migas de pan. Devuelve el HTML de "SIGSO / Módulo / Submódulo / Ítem".
   * El último tramo NO es un botón: es donde estás.
   */
  function migas(opts) {
    var def = opts.submodulos ? { submodulos: opts.submodulos } : obtener(opts.modulo);
    // `ruta` es a dónde lleva el tramo. Sin ruta, el tramo es texto muerto.
    // Antes de la v12.1 TODOS eran texto muerto, porque no había enrutamiento
    // y no existía destino al que enlazar.
    var tramos = [{ texto: 'SIGSO', ruta: 'home' }];
    if (opts.moduloNombre) {
      tramos.push({ texto: opts.moduloNombre, ruta: opts.modulo });
    }

    if (def) {
      var activo = opts.activo || '';
      (def.submodulos || []).forEach(function (sub) {
        (sub.items || []).forEach(function (it) {
          if (it.id !== activo) return;
          // Un submódulo aplanado no aporta un tramo propio: sería repetir
          // el mismo nombre dos veces seguidas.
          // El submódulo NO lleva ruta: no es un destino, es una agrupación.
          // Enlazarlo al primero de sus ítems mentiría sobre a dónde va.
          if (!esPlano_(sub, sub.items || [])) tramos.push({ texto: sub.nombre });
          tramos.push({ texto: it.nombre, ruta: opts.modulo, item: it.id });
        });
      });
    }
    if (opts.detalle) tramos.push({ texto: opts.detalle });

    return '<nav class="sigso-migas" aria-label="Ruta de navegación"><ol>' +
      tramos.map(function (t, i) {
        var ultimo = i === tramos.length - 1;
        if (ultimo || !t.ruta) {
          return '<li>' + (ultimo
            ? '<span aria-current="page">' + esc_(t.texto) + '</span>'
            : '<span>' + esc_(t.texto) + '</span>') + '</li>';
        }
        // Un <a> con href real: se puede abrir en pestaña nueva, copiar el
        // enlace y usar con el teclado sin que haya que programar nada.
        var destino = '#/' + encodeURIComponent(t.ruta) +
          (t.item ? '/' + encodeURIComponent(t.item) : '');
        return '<li><a href="' + destino + '">' + esc_(t.texto) + '</a></li>';
      }).join('') +
      '</ol></nav>';
  }

  // ==========================================================================
  // ÁRBOL DE LA BARRA LATERAL (v13.0)
  //
  // CORRECCIÓN de la v12: la jerarquía Módulo > Submódulo > Ítem vivía en el
  // CONTENIDO (una columna de acordeones a la izquierda del panel). Debía
  // vivir en la BARRA AZUL. El contenido vuelve a ser sólo la pantalla
  // seleccionada, con su título, sus migas y sus acciones.
  //
  // Tres niveles y no más:
  //   1. Módulo    — lo que ya listaba el sidebar
  //   2. Submódulo — agrupa; se expande y colapsa
  //   3. Ítem      — la pantalla que se abre
  //
  // Un módulo SIN árbol registrado se dibuja como enlace simple, igual que
  // siempre (Nueva solicitud, Mis solicitudes, Pausas...). No se le inventa
  // una jerarquía que no tiene.
  //
  // El permiso lo sigue decidiendo cada módulo: registra un predicado
  // `visible` y el árbol lo obedece. Si un ítem no se puede ver, no se dibuja
  // -- y si un submódulo se queda sin ítems visibles, tampoco.

  // ACORDEÓN de una sola rama por módulo (bug real reportado: antes cada
  // rama era un boolean INDEPENDIENTE que, una vez abierto, no se volvía a
  // cerrar solo -- tras navegar un rato por Personas, Seguimiento, Medición
  // y El sistema, las cuatro quedaban abiertas a la vez aunque el usuario ya
  // estuviera en "Inicio", y el sidebar se veía "muy extenso"). Ahora se
  // guarda COMO MUCHO una rama abierta por módulo.
  //   - abiertoPorModulo_[modulo]: id de la rama abierta, o null si ninguna.
  //   - activoRecordado_[modulo]: último itemActivo visto, para notar
  //     cuándo la navegación se movió a otra parte.
  // Regla: si el ítem activo CAMBIÓ desde el último repintado, manda dónde
  // estás parado -- se abre la rama que lo contiene (o ninguna, si es un
  // ítem plano sin grupo, como "Inicio"), y la que estuviera abierta antes
  // se pliega. Si el ítem activo NO cambió (repintado por otro motivo, ej.
  // una badge), se respeta lo último que el usuario abrió o cerró a mano.
  var abiertoPorModulo_ = {};
  var activoRecordado_ = {};

  function estaAbierto_(modulo, sub) {
    return abiertoPorModulo_[modulo] === sub;
  }

  // Un clic en la cabecera de una rama es SIEMPRE exclusivo: abrirla pliega
  // cualquier otra del mismo módulo (y un segundo clic sobre la misma la
  // cierra, volviendo a "nada abierto") -- así se navega de a un nivel por
  // vez, como se pidió.
  function alternarAbierto_(modulo, sub) {
    abiertoPorModulo_[modulo] = (abiertoPorModulo_[modulo] === sub) ? null : sub;
    return abiertoPorModulo_[modulo] === sub;
  }

  /**
   * Ensambla el sidebar: agrupado si vienen grupos, plano si no.
   *
   * Agrupar tiene sentido con muchos modulos; con cuatro es ruido. Por eso el
   * shell decide si manda `grupos` o no, segun cuantos ve la cuenta. Un grupo
   * sin modulos visibles NO se dibuja: si el admin no le dio ninguno de esa
   * familia, el encabezado sobraria.
   *
   * Lo que no cae en ningun grupo va al final. Asi, agregar un modulo nuevo
   * sin acordarse de meterlo en un grupo NUNCA lo hace desaparecer del menu.
   */
  function ensamblar_(opts, htmlPorModulo) {
    var orden = (opts.modulos || []).map(function (m) { return m.id; });
    if (!opts.grupos || !opts.grupos.length) {
      return orden.map(function (id) { return htmlPorModulo[id] || ''; }).join('');
    }
    var usados = {};
    var html = opts.grupos.map(function (g) {
      var suyos = (g.modulos || []).filter(function (id) { return htmlPorModulo[id]; });
      if (!suyos.length) return '';
      suyos.forEach(function (id) { usados[id] = true; });
      return '<div class="plataforma-nav__grupo">' +
        (g.titulo ? '<p class="plataforma-nav__grupo-tit">' + esc_(g.titulo) + '</p>' : '') +
        suyos.map(function (id) { return htmlPorModulo[id]; }).join('') +
      '</div>';
    }).join('');
    var sueltos = orden.filter(function (id) { return htmlPorModulo[id] && !usados[id]; });
    return html + (sueltos.length
      ? '<div class="plataforma-nav__grupo">' + sueltos.map(function (id) { return htmlPorModulo[id]; }).join('') + '</div>'
      : '');
  }
  /**
   * Pinta el árbol completo de la barra lateral.
   *
   * @param {Object} opts
   *   contenedor    {HTMLElement}
   *   modulos       {Array}  [{id, nombre, icono, badge, esEnlace, href}]
   *   moduloActivo  {string}
   *   itemActivo    {string} id del ítem activo dentro del módulo activo
   *   onModulo      {Function} (moduloId) -> void
   *   onItem        {Function} (moduloId, itemId) -> void
   */
  function renderArbol(opts) {
    var cont = opts.contenedor;
    if (!cont) return;
    var moduloActivo = opts.moduloActivo || '';
    var itemActivo = opts.itemActivo || '';

    // v13.1: se construye el HTML de cada modulo y DESPUES se ensambla,
    // agrupado o plano. Antes se concatenaba directo y no habia donde meter
    // los encabezados de grupo.
    var htmlPorModulo = {};
    (opts.modulos || []).forEach(function (m) {
      var def = obtener(m.id);
      var esExpandible = !!(def && (def.submodulos || []).length);
      var abiertoModulo = m.id === moduloActivo;

      // --- Nivel 1: el módulo ---
      var badge = (m.badge !== undefined && m.badge !== null && m.badge !== '' && m.badge !== 0)
        ? '<span class="plataforma-nav__badge" data-badge="' + esc_(m.id) + '">' + esc_(m.badge) + '</span>'
        : '<span class="plataforma-nav__badge sigso-oculto" data-badge="' + esc_(m.id) + '"></span>';

      var cabecera;
      if (m.esEnlace && m.href) {
        // Módulo externo: sigue siendo un <a>, como antes.
        cabecera = '<a class="plataforma-nav__item" href="' + esc_(m.href) + '"' +
          ' target="_blank" rel="noopener"' + (m.acento || '') + '>' +
          '<span class="plataforma-nav__ico">' + icono_(m.icono, 18) + '</span>' +
          '<span class="plataforma-nav__etiqueta">' + esc_(m.nombre) + '</span></a>';
      } else {
        cabecera = '<button type="button" class="plataforma-nav__item' +
            (abiertoModulo ? ' plataforma-nav__item--activo' : '') +
            (esExpandible ? ' plataforma-nav__item--rama' : '') + '"' +
          ' data-modulo="' + esc_(m.id) + '"' + (m.acento || '') +
          (esExpandible ? ' aria-expanded="' + (abiertoModulo ? 'true' : 'false') + '"' : '') + '>' +
          '<span class="plataforma-nav__ico">' + icono_(m.icono, 18) + '</span>' +
          '<span class="plataforma-nav__etiqueta">' + esc_(m.nombre) + '</span>' +
          badge +
          (esExpandible ? '<span class="plataforma-nav__chevron" aria-hidden="true"></span>' : '') +
        '</button>';
      }

      if (!esExpandible || !abiertoModulo) { htmlPorModulo[m.id] = cabecera; return; }

      // --- Nivel 2 y 3: sólo del módulo abierto ---
      var visible = def.visible;
      var subsConItems = (def.submodulos || []).map(function (sub) {
        return { sub: sub, items: itemsVisibles_(sub, visible) };
      }).filter(function (x) { return x.items.length > 0; });

      // Acordeón de una sola rama (ver abiertoPorModulo_ arriba): si el
      // ítem activo cambió desde el último repintado de ESTE módulo, la
      // rama que lo contiene manda -- se abre esa y se pliega cualquier
      // otra. Si no cambió, se respeta lo último que el usuario abrió o
      // cerró a mano (ej. está mirando "Inicio" pero abrió "Personas" para
      // curiosear, sin haber hecho clic en ningún ítem todavía).
      if (activoRecordado_[m.id] !== itemActivo) {
        activoRecordado_[m.id] = itemActivo;
        var grupoDelActivo = null;
        subsConItems.forEach(function (x) {
          if (esPlano_(x.sub, x.items)) return;
          if (x.items.some(function (it) { return it.id === itemActivo; })) grupoDelActivo = x.sub.id;
        });
        abiertoPorModulo_[m.id] = grupoDelActivo;
      }

      var ramas = subsConItems.map(function (x) {
        var sub = x.sub;
        var items = x.items;

        // Un submódulo de un solo ítem homónimo (o marcado plano) no se
        // dibuja como rama que hay que abrir para encontrar una sola cosa:
        // va directo como hoja de nivel 2.
        if (esPlano_(sub, items)) {
          var it0 = items[0];
          return '<button type="button" class="plataforma-nav__sub plataforma-nav__hoja' +
              (it0.id === itemActivo ? ' plataforma-nav__sub--activo' : '') +
              (sub.id === ID_REPORTES ? ' plataforma-nav__sub--reportes' : '') + '"' +
            ' data-item="' + esc_(it0.id) + '" data-de-modulo="' + esc_(m.id) + '"' +
            (it0.id === itemActivo ? ' aria-current="page"' : '') + '>' +
            '<span class="plataforma-nav__etiqueta">' + esc_(sub.nombre) + '</span>' +
          '</button>';
        }

        var abierto = estaAbierto_(m.id, sub.id);
        var idLista = 'arbol-' + esc_(m.id) + '-' + esc_(sub.id);
        return '<button type="button" class="plataforma-nav__sub' +
            (abierto ? ' plataforma-nav__sub--abierto' : '') +
            (sub.id === ID_REPORTES ? ' plataforma-nav__sub--reportes' : '') + '"' +
          ' data-sub="' + esc_(sub.id) + '" data-de-modulo="' + esc_(m.id) + '"' +
          ' aria-expanded="' + (abierto ? 'true' : 'false') + '" aria-controls="' + idLista + '">' +
          '<span class="plataforma-nav__etiqueta">' + esc_(sub.nombre) + '</span>' +
          '<span class="plataforma-nav__chevron" aria-hidden="true"></span>' +
        '</button>' +
        '<div class="plataforma-nav__items" id="' + idLista + '"' + (abierto ? '' : ' hidden') + '>' +
          items.map(function (it) {
            return '<button type="button" class="plataforma-nav__hoja' +
                (it.id === itemActivo ? ' plataforma-nav__hoja--activo' : '') + '"' +
              ' data-item="' + esc_(it.id) + '" data-de-modulo="' + esc_(m.id) + '"' +
              (it.id === itemActivo ? ' aria-current="page"' : '') + '>' +
              '<span class="plataforma-nav__punto" aria-hidden="true"></span>' +
              '<span class="plataforma-nav__etiqueta">' + esc_(it.nombre) + '</span>' +
            '</button>';
          }).join('') +
        '</div>';
      }).join('');

      htmlPorModulo[m.id] = cabecera + '<div class="plataforma-nav__rama">' + ramas + '</div>';
    });

    // Repintar con innerHTML tira el DOM entero, y con el se van dos cosas
    // que el usuario SI nota: donde tenia scrolleado el menu (si esta abajo
    // en Calidad, el arbol saltaba arriba en cada clic) y que boton tenia
    // enfocado con el teclado. Se guardan y se reponen.
    var scrollPrevio = cont.scrollTop;
    var enfocado = document.activeElement;
    var refFoco = (enfocado && cont.contains(enfocado))
      ? (enfocado.getAttribute('data-item') ? 'item:' + enfocado.getAttribute('data-item')
        : enfocado.getAttribute('data-sub') ? 'sub:' + enfocado.getAttribute('data-sub')
        : enfocado.getAttribute('data-modulo') ? 'modulo:' + enfocado.getAttribute('data-modulo') : null)
      : null;

    cont.innerHTML = ensamblar_(opts, htmlPorModulo);
    cont.scrollTop = scrollPrevio;
    if (refFoco) {
      var partes_ = refFoco.split(':');
      var attr = partes_.shift();
      var valor = partes_.join(':');
      var destino = cont.querySelector('[data-' + attr + '="' + valor.replace(/"/g, '\\"') + '"]');
      if (destino) destino.focus();
    }

    // --- interacción ---------------------------------------------------------
    cont.querySelectorAll('[data-modulo]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (typeof opts.onModulo === 'function') opts.onModulo(b.getAttribute('data-modulo'));
      });
    });
    cont.querySelectorAll('[data-sub]').forEach(function (b) {
      b.addEventListener('click', function () {
        // Acordeón exclusivo: repinta el árbol ENTERO (no solo este botón)
        // porque abrir esta rama tiene que plegar cualquier otra del mismo
        // módulo -- un parche local a un solo <ul> no alcanza para eso.
        alternarAbierto_(b.getAttribute('data-de-modulo'), b.getAttribute('data-sub'));
        renderArbol(opts);
      });
    });
    cont.querySelectorAll('[data-item]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (typeof opts.onItem === 'function') {
          opts.onItem(b.getAttribute('data-de-modulo'), b.getAttribute('data-item'));
        }
      });
    });
  }

  // ==========================================================================
  // RUTAS (v12.1)
  //
  // Hasta la v12.0 SIGSO no tenia enrutamiento: los modulos se mostraban y
  // ocultaban con clases, y plataforma.js borraba la URL con replaceState. Eso
  // dejaba tres cosas rotas que nadie podia arreglar desde la UI:
  //   - no habia forma de compartir un enlace a una seccion;
  //   - el boton ATRAS del navegador sacaba al usuario de SIGSO entero;
  //   - las migas de pan no podian ser clicables, porque no habia destino.
  //
  // Formato:  #/<modulo>            ->  #/calidad
  //           #/<modulo>/<itemId>   ->  #/calidad/documentos:PRO
  //
  // Se usa HASH y no History API a proposito: SIGSO se publica en GitHub
  // Pages, que sirve archivos estaticos. Con pushState, recargar en
  // /plataforma/calidad daria 404 porque no hay servidor que reescriba.
  // El hash que escribimos nosotros y cuyo hashchange hay que ignorar.
  // null = el proximo evento es del usuario.
  var RUTA_ESCRITA_POR_NOSOTROS = null;

  function leerRuta() {
    var h = String(window.location.hash || '').replace(new RegExp('^#/?'), '');
    if (!h) return { modulo: '', item: '' };
    var trozos = h.split('/');
    return {
      modulo: decodeURIComponent(trozos[0] || ''),
      // El item puede traer ':' (documentos:PRO); se rearma por si el split
      // lo partio en mas trozos de la cuenta.
      item: decodeURIComponent(trozos.slice(1).join('/') || '')
    };
  }

  // Escribe la ruta SIN disparar el manejador de hashchange: quien llama ya
  // esta navegando, y volver a navegar por el evento seria un bucle.
  function escribirRuta(modulo, item, reemplazar) {
    var destino = '#/' + encodeURIComponent(modulo || '') +
      (item ? '/' + encodeURIComponent(item) : '');
    if (window.location.hash === destino) return;
    // Se RECUERDA lo que escribimos en vez de levantar una bandera temporal.
    // Ver alCambiarRuta: la comparacion no puede perder una carrera.
    RUTA_ESCRITA_POR_NOSOTROS = destino;
    try {
      // replaceState para los cambios que NO son navegacion del usuario (p.ej.
      // restaurar la seccion por defecto al entrar): asi el boton atras no
      // acumula pasos que el usuario nunca dio.
      if (reemplazar && window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search + destino);
      } else {
        window.location.hash = destino;
      }
    } catch (err) {
      // Si la escritura fallo no hay evento que ignorar: se limpia la marca
      // para no silenciar una navegacion real del usuario mas adelante.
      RUTA_ESCRITA_POR_NOSOTROS = null;
      throw err;
    }
  }

  function alCambiarRuta(fn) {
    window.addEventListener('hashchange', function () {
      // Si el hash actual es EXACTAMENTE el que acabamos de escribir, el evento
      // es nuestro y no hay nada que navegar. Se consume la marca: un segundo
      // hashchange al mismo destino ya seria del usuario (boton atras, por
      // ejemplo) y tiene que pasar.
      //
      // Antes esto era una bandera que se bajaba con setTimeout(0), y perdia la
      // carrera contra el propio evento cuando habia trabajo en el medio: el
      // modulo se montaba dos veces y repetia TODAS sus llamadas al backend.
      if (RUTA_ESCRITA_POR_NOSOTROS !== null && window.location.hash === RUTA_ESCRITA_POR_NOSOTROS) {
        RUTA_ESCRITA_POR_NOSOTROS = null;
        return;
      }
      RUTA_ESCRITA_POR_NOSOTROS = null;
      fn(leerRuta());
    });
  }

  window.SigsoRutas = {
    leer: leerRuta,
    escribir: escribirRuta,
    alCambiar: alCambiarRuta
  };

  window.SigsoNav = {
    ID_REPORTES: ID_REPORTES,
    registrar: registrar,
    obtener: obtener,
    partes: partes,
    render: render,
    renderArbol: renderArbol,
    migas: migas
  };
})();
