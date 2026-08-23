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
    var tramos = [{ texto: 'SIGSO' }];
    if (opts.moduloNombre) tramos.push({ texto: opts.moduloNombre });

    if (def) {
      var activo = opts.activo || '';
      (def.submodulos || []).forEach(function (sub) {
        (sub.items || []).forEach(function (it) {
          if (it.id !== activo) return;
          // Un submódulo aplanado no aporta un tramo propio: sería repetir
          // el mismo nombre dos veces seguidas.
          if (!esPlano_(sub, sub.items || [])) tramos.push({ texto: sub.nombre });
          tramos.push({ texto: it.nombre });
        });
      });
    }
    if (opts.detalle) tramos.push({ texto: opts.detalle });

    return '<nav class="sigso-migas" aria-label="Ruta de navegación"><ol>' +
      tramos.map(function (t, i) {
        var ultimo = i === tramos.length - 1;
        return '<li>' + (ultimo
          ? '<span aria-current="page">' + esc_(t.texto) + '</span>'
          : '<span>' + esc_(t.texto) + '</span>') + '</li>';
      }).join('') +
      '</ol></nav>';
  }

  window.SigsoNav = {
    ID_REPORTES: ID_REPORTES,
    registrar: registrar,
    obtener: obtener,
    partes: partes,
    render: render,
    migas: migas
  };
})();
