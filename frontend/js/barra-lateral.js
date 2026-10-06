/**
 * barra-lateral.js — la barra lateral de la plataforma.
 *
 * Tercera versión (2026-10-06): propuesta 2b «Bloques» del dueño.
 *   RIEL (68 px): solo íconos, agrupados (Mi espacio · Áreas · Sistema). Al
 *       pasar el mouse (180 ms de espera) o al entrar con el teclado se
 *       despliega SOBRE el panel (236 px) con nombres completos y conteos;
 *       sale el mouse o Esc, se contrae. Contraído, el conteo es un punto;
 *       desplegado, una píldora con el número. Nunca los dos.
 *   PANEL (268 px): el área abierta. Divulgación progresiva:
 *       nivel 1 = TARJETA (cada módulo principal: Agenda, Trabajo, Reportes),
 *       nivel 2 = FILA dentro de la tarjeta,
 *       nivel 3 = BANDEJA hundida dentro de su fila (p. ej. Convenios TGR).
 *       Acordeón: un solo abierto por nivel. Los niveles con hijos solo abren
 *       o cierran; navegan las hojas. Al entrar a un área desde el riel todo
 *       parte cerrado (el módulo de la página activa queda MARCADO); al cargar
 *       o al llegar por una dirección, se abre la ruta de la página.
 *   Una sola marca de «dónde estás»: fondo índigo sólido en la página activa.
 *
 * Se mantiene: los atajos (fijados) y lo reciente en Inicio, la estrella del
 * encabezado, Alt+1…8, el manual de cada módulo y los contadores de tres
 * tonos (rojo atrasado, ámbar para hoy, gris por revisar).
 *
 * El shell (plataforma.js) le pasa qué módulos ve la cuenta y dónde está la
 * persona; los menús salen del mismo registro que ya usaban el buscador y las
 * migas (SigsoNav), con el mismo permiso `visible`. Un ítem puede traer
 * `hijos` (tercer nivel).
 */
(function () {
  'use strict';

  var MAX_FIJADOS = 8;
  var MAX_RECIENTES = 5;
  var TONOS = { rojo: 'atrasado', ambar: 'para hoy', gris: 'por revisar' };
  var ESTADO_TXT = { rojo: ['atrasado', 'atrasados'], ambar: ['para hoy', 'para hoy'], gris: ['por revisar', 'por revisar'] };
  var ESPERA_RIEL = 180;
  // Lo que se propone como atajo la primera vez, por área.
  var SUGERIDOS_AREA = { dep_contabilidad: ['hoy', 'm:IVA', 'conv'] };
  var SUGERIDOS_MODULO = ['bandeja', 'mi_trabajo', 'mis_solicitudes', 'proyectos', 'calidad', 'gerencia', 'dep_administracion', 'novedades'];

  var est_ = {
    opts: null, badges: {}, fijados: null, recientes: [], cuenta: '',
    abierto1: null, abierto2: null, q: '',
    ultMod: null, abrirRuta: true, cerrarTodo: false
  };
  var raiz_ = null;
  var timerRiel_ = null;

  function esc(t) { return window.Componentes ? Componentes.escaparHtml(t) : String(t == null ? '' : t); }
  function ico(n, t) { return window.Iconos ? Iconos.svg(n, { tam: t || 18 }) : ''; }
  function leerLS(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function guardarLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin storage */ } }
  function llave(base) { return base + (est_.cuenta ? '_' + est_.cuenta : ''); }
  // Para buscar sin importar mayúsculas ni tildes.
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function idSeguro(t) { return String(t || '').replace(/[^a-zA-Z0-9_-]/g, '_'); }

  function modulo(id) { return ((est_.opts && est_.opts.modulos) || []).filter(function (m) { return m.id === id; })[0] || null; }
  function puedeIr(f) { return !!f && (modulo(f.modulo) || (est_.opts && est_.opts.accion && est_.opts.accion.modulo === f.modulo)); }
  function colorDe(m) { return (m && m.acento) || 'var(--mod-inicio)'; }
  function tonoDe(t) { return t === 'peligro' ? 'rojo' : (TONOS[t] ? t : 'ambar'); }

  /**
   * Menú de un módulo, en los tres niveles de la barra:
   *   [{ id, titulo, icono, nota, plano, items: [{ id, nombre, badge, tono, hijos: [...] }] }]
   * Un submódulo de una sola pantalla homónima («Hoy», «Reporte mensual») es
   * `plano`: una tarjeta que lleva directo a su pantalla.
   */
  function menu(moduloId) {
    // Inicio también va en bloques (2026-10-06): sus tarjetas se arman con lo tuyo, tus atajos, lo pendiente y lo reciente.
    if (moduloId === 'home') return inicioCards();
    var def = window.SigsoNav && SigsoNav.obtener(moduloId);
    if (!def || !(def.submodulos || []).length) return [];
    var hoja = function (it, nombre) {
      var hijos = it.hijos && it.hijos.length ? SigsoNav.itemsVisibles({ items: it.hijos }, def.visible).map(function (h) { return hoja(h); }) : [];
      return { id: it.id, nombre: nombre || it.nombre, badge: it.badge, tono: tonoDe(it.tono), hijos: hijos };
    };
    var out = [];
    def.submodulos.forEach(function (sub) {
      var items = SigsoNav.itemsVisibles(sub, def.visible);
      if (!items.length) return;
      if (SigsoNav.esPlano(sub, items) && !(items[0].hijos && items[0].hijos.length)) {
        out.push({ id: sub.id || items[0].id, titulo: sub.nombre, icono: sub.icono || 'derecha', nota: sub.descripcion || '', plano: true, items: [hoja(items[0], sub.nombre)] });
        return;
      }
      out.push({ id: sub.id || sub.nombre, titulo: sub.nombre, icono: sub.icono || 'lista', nota: sub.descripcion || '', plano: false, items: items.map(function (it) { return hoja(it); }) });
    });
    return out;
  }
  // Todas las hojas (pantallas) del menú, con su ruta: [{ hoja, mod1, item2 }].
  function hojas(moduloId) {
    var out = [];
    menu(moduloId).forEach(function (c) {
      c.items.forEach(function (it) {
        if (it.hijos.length) it.hijos.forEach(function (h) { out.push({ hoja: h, mod1: c.id, item2: it.id }); });
        else out.push({ hoja: it, mod1: c.id, item2: null });
      });
    });
    return out;
  }
  function hojaDe(moduloId, itemId) {
    var r = hojas(moduloId).filter(function (x) { return x.hoja.id === itemId; })[0];
    return r ? r.hoja : null;
  }
  // La hoja de la página activa. Una pantalla que no está en el menú (la ficha
  // «conv:123») se atribuye a la hoja de la que cuelga («conv»).
  function rutaActiva(moduloId, itemId) {
    if (moduloId === 'home') return rutaInicio();
    if (!itemId) return null;
    var todas = hojas(moduloId);
    var r = todas.filter(function (x) { return x.hoja.id === itemId; })[0];
    if (!r) r = todas.filter(function (x) { return itemId.indexOf(x.hoja.id + ':') === 0; }).sort(function (a, b) { return b.hoja.id.length - a.hoja.id.length; })[0];
    return r || null;
  }
  function tieneMenu(moduloId) { return menu(moduloId).length > 0; }
  // Lo que salió del riel (Mis solicitudes, Pausas) se muestra en el panel de Inicio.
  function esDeInicio(id) { return !!(est_.opts && (est_.opts.fueraDelRiel || []).indexOf(id) !== -1 && modulo(id)); }
  // En Inicio, la fila de la pantalla abierta (primero en «Lo tuyo»).
  function rutaInicio() {
    var o = est_.opts;
    if (!o || o.moduloActivo === 'home') return null;
    var r = null;
    inicioCards().forEach(function (c) {
      c.items.forEach(function (it) {
        if (!r && it.mod === o.moduloActivo && (it.item || '') === (it.item ? o.itemActivo || '' : '')) r = { hoja: it, mod1: c.id, item2: null };
      });
    });
    return r;
  }

  // --- atajos (fijados) y recientes ---------------------------------------------------------
  function sugeridos() {
    var out = [];
    var dep = ((est_.opts && est_.opts.modulos) || []).filter(function (m) { return /^dep_/.test(m.id) && m.id !== 'dep_administracion'; })[0];
    if (dep) {
      var pref = SUGERIDOS_AREA[dep.id];
      var trabajo = menu(dep.id).filter(function (c) { return c.titulo === 'Trabajo'; })[0];
      var candidatos = pref ? pref.map(function (id) { return hojaDe(dep.id, id); })
        : [hojaDe(dep.id, 'hoy')].concat(((trabajo && trabajo.items) || []).filter(function (it) { return it.id !== 'inicio' && !it.hijos.length; }).slice(0, 2));
      candidatos.forEach(function (it) { if (it) out.push({ modulo: dep.id, item: it.id, nombre: it.nombre, ruta: dep.corto }); });
    }
    SUGERIDOS_MODULO.forEach(function (id) {
      var m = modulo(id);
      if (out.length < 3 && m && !out.some(function (f) { return f.modulo === id; })) out.push({ modulo: id, item: '', nombre: m.nombre, ruta: m.corto });
    });
    return out.slice(0, 3);
  }
  function fijadosVisibles() { return (est_.fijados === null ? sugeridos() : est_.fijados).filter(puedeIr); }
  function esFijado(mod, item) { return fijadosVisibles().some(function (f) { return f.modulo === mod && (f.item || '') === (item || ''); }); }

  function guardarFijados(lista) {
    est_.fijados = lista.slice(0, MAX_FIJADOS);
    guardarLS(llave('sigso_barra_fijados'), est_.fijados);
    pintar();
    if (typeof llamarApi !== 'function') return;
    llamarApi(null, 'guardarFijados', { fijados: est_.fijados }).then(function (r) {
      var d = r && r.data;
      if (!r || !r.ok || (d && d.ok === false)) avisar((d && d.message) || (r && r.message) || 'No se pudieron guardar tus atajos. Quedan en este equipo; inténtalo más tarde.', 'error');
    }).catch(function () { avisar('Sin conexión: tus atajos quedaron en este equipo y se guardan en tu cuenta la próxima vez.', 'info'); });
  }
  function alternarFijado(mod, item, nombre) {
    var lista = fijadosVisibles().slice();
    var i = -1;
    lista.forEach(function (f, k) { if (f.modulo === mod && (f.item || '') === (item || '')) i = k; });
    if (i !== -1) { lista.splice(i, 1); guardarFijados(lista); avisar('Quitado de tus atajos.', 'info'); return; }
    if (lista.length >= MAX_FIJADOS) { avisar('Hasta ' + MAX_FIJADOS + ' atajos: quita uno en Inicio antes de agregar otro.', 'info'); return; }
    var m = modulo(mod);
    lista.push({ modulo: mod, item: item || '', nombre: nombre, ruta: m ? m.corto : '' });
    guardarFijados(lista);
    avisar('Agregado a tus atajos: lo encuentras en Inicio.', 'exito');
  }
  function avisar(texto, tipo) { if (window.Componentes && Componentes.aviso) Componentes.aviso({ texto: texto, tipo: tipo || 'info' }); }

  /** Una pantalla visitada pasa a Recientes (por equipo: es un atajo, no un dato de la cuenta). */
  function visita(mod, item) {
    if (!mod || mod === 'home') return;
    var nombre;
    if (item) { var h = hojaDe(mod, item); if (!h) return; nombre = h.nombre; }
    else {
      if (tieneMenu(mod)) return; // la visita útil es la pantalla, que se publica después
      var m = modulo(mod) || (est_.opts && est_.opts.accion && est_.opts.accion.modulo === mod ? { nombre: est_.opts.accion.texto, corto: est_.opts.accion.texto } : null);
      if (!m) return;
      nombre = m.nombre;
    }
    var m2 = modulo(mod);
    var r = { modulo: mod, item: item || '', nombre: nombre, ruta: m2 ? m2.corto : '' };
    est_.recientes = [r].concat(est_.recientes.filter(function (x) { return !(x.modulo === r.modulo && x.item === r.item); })).slice(0, MAX_RECIENTES + 1);
    guardarLS(llave('sigso_barra_recientes'), est_.recientes);
  }

  // --- piezas -------------------------------------------------------------------------------
  function cifra(n) { return n > 99 ? '99+' : String(n); }
  function textoEstado(b) {
    if (!b || !b.n) return '';
    var t = ESTADO_TXT[b.tono] || ESTADO_TXT.ambar;
    return b.n + ' ' + (b.n === 1 ? t[0] : t[1]);
  }
  /** Píldora con número (riel desplegado, tarjetas, filas). */
  function pildora(b, attrs, clase) {
    var n = b && b.n ? cifra(b.n) : '';
    return '<span class="sb-pill sb-pill--' + ((b && b.tono) || 'ambar') + (clase ? ' ' + clase : '') + (n ? '' : ' sigso-oculto') + '"' + (attrs || '') +
      (n ? ' title="' + esc(textoEstado(b)) + '"' : '') + '>' + n + '</span>';
  }
  function badgeHoja(it) { return it && it.badge ? { n: Number(it.badge) || 0, tono: it.tono } : null; }

  /** El riel: grupos con su título (desplegado) o una línea (contraído). */
  function rielHtml() {
    var o = est_.opts, usados = {}, bloques = [];
    var fuera = o.fueraDelRiel || [];
    (o.grupos || []).forEach(function (g) {
      var b = [];
      (g.modulos || []).forEach(function (id) { if (modulo(id) && !usados[id] && fuera.indexOf(id) === -1) { usados[id] = true; b.push(id); } });
      if (b.length) bloques.push({ titulo: g.titulo, ids: b });
    });
    var resto = o.modulos.filter(function (m) { return !usados[m.id] && fuera.indexOf(m.id) === -1; }).map(function (m) { return m.id; });
    if (resto.length) bloques.push({ titulo: '', ids: resto });
    return bloques.map(function (b, i) {
      return '<div class="sb-grupo-r" role="group"' + (b.titulo ? ' aria-label="' + esc(b.titulo) + '"' : '') + '>' +
        (b.titulo || i ? '<p class="sb-grupo" aria-hidden="true"><span class="sb-grupo__linea"></span><span class="sb-txt">' + esc(b.titulo) + '</span></p>' : '') +
        b.ids.map(function (id) {
          var m = modulo(id), act = id === (esDeInicio(o.moduloActivo) ? 'home' : o.moduloActivo), bd = est_.badges[id];
          var nombre = m.titulo || m.nombre;
          return '<button type="button" class="sb-rb' + (act ? ' sb-rb--act' : '') + '" data-modulo="' + esc(id) + '"' +
            ' aria-label="' + esc(nombre + (bd && bd.n ? ', ' + textoEstado(bd) : '')) + '"' + (act ? ' aria-current="true"' : '') + '>' +
            '<span class="sb-rb__ico">' + ico(m.icono, 20) +
              '<i class="sb-punto sb-punto--' + ((bd && bd.tono) || 'ambar') + (bd && bd.n ? '' : ' sigso-oculto') + '" data-punto="' + esc(id) + '"></i></span>' +
            '<span class="sb-txt sb-rb__t">' + esc(nombre) + '</span>' +
            pildora(bd, ' data-badge="' + esc(id) + '"', 'sb-txt') +
          '</button>';
        }).join('') +
      '</div>';
    }).join('');
  }

  // Nivel 3: la bandeja hundida.
  function bandejaHtml(mod, it, abierta, activa) {
    var idc = 'sb3-' + idSeguro(mod + '-' + it.id);
    return '<div class="sb-plegable sb-plegable--3' + (abierta ? ' sb-plegable--abierto' : '') + '" id="' + idc + '"><div><div class="sb-bandeja">' +
      it.hijos.map(function (h) {
        var act = activa && activa.hoja.id === h.id;
        return '<button type="button" class="sb-n3' + (act ? ' sb-n3--act' : '') + '" data-item="' + esc(h.id) + '" data-de-modulo="' + esc(mod) + '"' + (act ? ' aria-current="page"' : '') + (abierta ? '' : ' tabindex="-1"') + '>' +
          '<i class="sb-vineta" aria-hidden="true"></i><span class="sb-n3__t">' + esc(h.nombre) + '</span>' + pildora(badgeHoja(h)) + '</button>';
      }).join('') +
    '</div></div></div>';
  }
  // Nivel 2: una fila (hoja) o una fila que abre su bandeja.
  function filaHtml(mod, c, it, activa, abierta1, q) {
    var tab = abierta1 ? '' : ' tabindex="-1"';
    if (!it.hijos.length) {
      var act = activa && activa.hoja.id === it.id;
      // En Inicio cada fila lleva a su propio módulo (it.mod) y pantalla (it.item, '' = el módulo).
      var destino = it.mod ? ' data-item="' + esc(it.item || '') + '" data-de-modulo="' + esc(it.mod) + '"' : ' data-item="' + esc(it.id) + '" data-de-modulo="' + esc(mod) + '"';
      var boton = '<button type="button" class="sb-n2' + (act ? ' sb-n2--act' : '') + '"' + destino + (act ? ' aria-current="page"' : '') + (it.titulo ? ' title="' + esc(it.titulo) + '"' : '') + tab + '>' +
        '<span class="sb-n2__t">' + esc(it.nombre) + (it.sub ? '<small>' + esc(it.sub) + '</small>' : '') + '</span>' + pildora(badgeHoja(it)) + '</button>';
      if (!it.envoltura && !it.extra) return boton;
      return '<div class="sb-fila"' + (it.envoltura || '') + '>' + boton + String(it.extra || '').replace('{tab}', tab) + '</div>';
    }
    var padre = activa && activa.item2 === it.id;
    var abierta = q ? true : est_.abierto2 === it.id && abierta1;
    var idc = 'sb3-' + idSeguro(mod + '-' + it.id);
    return '<div class="sb-n2-grupo' + (abierta ? ' sb-n2-grupo--abierto' : '') + '">' +
      '<button type="button" class="sb-n2 sb-n2--rama' + (padre ? ' sb-n2--padre' : '') + '" data-abrir2="' + esc(it.id) + '" aria-expanded="' + abierta + '" aria-controls="' + idc + '"' + tab + '>' +
        '<span class="sb-n2__t">' + esc(it.nombre) + '</span><span class="sb-n2__cuenta">' + it.hijos.length + '</span><span class="sb-n2__flecha">' + ico('abajo', 14) + '</span></button>' +
      bandejaHtml(mod, it, abierta, activa) +
    '</div>';
  }
  // Nivel 1: la tarjeta de un módulo principal.
  function tarjetaHtml(mod, c, activa, q) {
    var contiene = activa && activa.mod1 === c.id;
    if (c.plano) {
      var it = c.items[0], pag = activa && activa.hoja.id === it.id;
      return '<div class="sb-mod sb-mod--hoja' + (contiene ? ' sb-mod--act' : '') + (pag ? ' sb-mod--pagina' : '') + '">' +
        '<button type="button" class="sb-mod__cab" data-item="' + esc(it.id) + '" data-de-modulo="' + esc(mod) + '"' + (pag ? ' aria-current="page"' : '') + (c.nota ? ' title="' + esc(c.nota) + '"' : '') + '>' +
          '<span class="sb-mod__tile">' + ico(c.icono, 17) + '</span><span class="sb-mod__t"><b>' + esc(c.titulo) + '</b>' +
          (badgeHoja(it) && badgeHoja(it).n ? '<small>' + esc(textoEstado(badgeHoja(it))) + '</small>' : '') + '</span>' + pildora(badgeHoja(it)) + '</button></div>';
    }
    var abierta = q ? true : est_.abierto1 === c.id;
    var idc = 'sb1-' + idSeguro(mod + '-' + c.id);
    // El conteo de la tarjeta: lo que esperan sus pantallas (rojo si algo está atrasado).
    var suma = 0, rojo = false;
    c.items.forEach(function (it) { [it].concat(it.hijos).forEach(function (h) { var b = badgeHoja(h); if (b && b.n) { suma += b.n; if (b.tono === 'rojo') rojo = true; } }); });
    var n = c.items.length, u = c.unidad || ['sección', 'secciones'];
    return '<div class="sb-mod' + (abierta ? ' sb-mod--abierto' : '') + (contiene ? ' sb-mod--act' : '') + '" data-mod1="' + esc(c.id) + '">' +
      '<button type="button" class="sb-mod__cab" data-abrir1="' + esc(c.id) + '" aria-expanded="' + abierta + '" aria-controls="' + idc + '"' + (c.nota ? ' title="' + esc(c.nota) + '"' : '') + '>' +
        '<span class="sb-mod__tile">' + ico(c.icono, 17) + '</span>' +
        '<span class="sb-mod__t"><b>' + esc(c.titulo) + '</b><small>' + n + ' ' + (n === 1 ? u[0] : u[1]) + '</small></span>' +
        (suma ? pildora({ n: suma, tono: rojo ? 'rojo' : 'ambar' }) : '') +
        '<span class="sb-mod__flecha">' + ico('derecha', 16) + '</span></button>' +
      '<div class="sb-plegable" id="' + idc + '"><div><div class="sb-mod__cuerpo' + (c.claseCuerpo ? ' ' + c.claseCuerpo : '') + '">' +
        (c.pista ? '<p class="sb-pista sb-pista--tarjeta">' + c.pista + '</p>' : '') +
        c.items.map(function (it) { return filaHtml(mod, c, it, activa, abierta, q); }).join('') +
      '</div></div></div>' +
    '</div>';
  }

  /** Lo que coincide con lo buscado: tarjeta completa, fila con sus hijos o hijo con su ruta. */
  function filtrar(cards, q) {
    var p = norm(q).trim();
    if (!p) return cards;
    var calza = function (t) { return norm(t).indexOf(p) !== -1; };
    return cards.map(function (c) {
      if (calza(c.titulo)) return c;
      if (c.plano) return null;
      var items = c.items.map(function (it) {
        if (calza(it.nombre)) return it;
        var hijos = it.hijos.filter(function (h) { return calza(h.nombre); });
        return hijos.length ? Object.assign({}, it, { hijos: hijos }) : null;
      }).filter(Boolean);
      return items.length ? Object.assign({}, c, { items: items }) : null;
    }).filter(Boolean);
  }

  function areaHtml(m) {
    var o = est_.opts;
    var cards = menu(m.id);
    if (!cards.length && o.conMenu && o.conMenu(m.id)) return '<p class="sb-pista sb-cargando">Cargando el menú…</p>';
    if (!cards.length) {
      return '<div class="sb-directo">' + ico('derecha', 14) + '<span><b>' + esc(m.titulo || m.nombre) + '</b> abre directo, sin submenú: todo está a la derecha.</span></div>';
    }
    var activa = rutaActiva(m.id, o.itemActivo);
    var vista = filtrar(cards, est_.q);
    if (!vista.length) return '<p class="sb-pista sb-sin">Sin resultados en este módulo.</p>';
    return vista.map(function (c) { return tarjetaHtml(m.id, c, activa, est_.q.trim()); }).join('');
  }

  function badgeDe(f) {
    if (f.item) { var h = hojaDe(f.modulo, f.item); return badgeHoja(h); }
    return est_.badges[f.modulo] || null;
  }
  function conBadge(it, b) { it.badge = b && b.n ? b.n : 0; it.tono = (b && b.tono) || 'ambar'; return it; }

  /**
   * Inicio, en bloques como las áreas (2026-10-06): tarjetas que se abren de a
   * una — Lo tuyo (lo que salió del riel: Mis solicitudes, Pausas), tus
   * atajos, lo pendiente de cada módulo y lo reciente.
   */
  function inicioCards() {
    var o = est_.opts;
    if (!o) return [];
    var cards = [];
    var propios = (o.fueraDelRiel || []).filter(function (id) { return modulo(id); });
    if (propios.length) {
      cards.push({ id: 'tuyo', titulo: 'Lo tuyo', icono: 'persona', nota: 'Tus solicitudes y tus pausas', items: propios.map(function (id) {
        var m = modulo(id);
        return conBadge({ id: 'tuyo|' + id, mod: id, item: '', nombre: m.titulo || m.nombre, hijos: [] }, est_.badges[id]);
      }) });
    }
    var l = fijadosVisibles(), sug = est_.fijados === null;
    cards.push({ id: 'atajos', titulo: sug ? 'Atajos sugeridos' : 'Mis atajos', icono: 'estrella', unidad: ['atajo', 'atajos'], claseCuerpo: 'sb-fijados',
      nota: 'Alt+1 a Alt+8 te llevan directo. Arrástralos para ordenarlos.',
      pista: sug ? 'Agrega tus pantallas de todos los días con la estrella ' + ico('estrella', 11) + ' junto al nombre del área. Mientras, te sugerimos estas.'
        : (l.length ? '' : 'Todavía no tienes atajos: márcalos con la estrella ' + ico('estrella', 11) + ' junto al nombre del área.'),
      items: l.map(function (f, i) {
        return conBadge({ id: 'atajo|' + i, mod: f.modulo, item: f.item || '', nombre: f.nombre, hijos: [],
          sub: f.ruta && f.nombre.indexOf(f.ruta) === -1 ? f.ruta : '', titulo: i < 8 ? 'Alt+' + (i + 1) : '',
          envoltura: ' draggable="true" data-pos="' + i + '"',
          extra: sug ? '' : '<button type="button" class="sb-quitar" data-quitar="' + i + '" aria-label="Quitar ' + esc(f.nombre) + ' de tus atajos" title="Quitar de tus atajos"{tab}>' + ico('equis', 12) + '</button>' }, badgeDe(f));
      }) });
    var orden = { rojo: 0, ambar: 1, gris: 2 };
    var pend = o.modulos.filter(function (m) { return m.id !== 'home' && est_.badges[m.id] && est_.badges[m.id].n; })
      .sort(function (x, y) { return orden[est_.badges[x.id].tono] - orden[est_.badges[y.id].tono] || est_.badges[y.id].n - est_.badges[x.id].n; });
    if (pend.length) {
      cards.push({ id: 'pendiente', titulo: 'Lo pendiente', icono: 'campana', unidad: ['módulo', 'módulos'], nota: 'Lo que te espera en cada módulo', items: pend.map(function (m) {
        var bd = est_.badges[m.id];
        return conBadge({ id: 'pend|' + m.id, mod: m.id, item: '', nombre: m.titulo || m.nombre, sub: textoEstado(bd), hijos: [] }, bd);
      }) });
    }
    var rec = est_.recientes.filter(function (r) { return puedeIr(r) && !esFijado(r.modulo, r.item); }).slice(0, MAX_RECIENTES);
    if (rec.length) {
      cards.push({ id: 'recientes', titulo: 'Recientes', icono: 'reloj', unidad: ['pantalla', 'pantallas'], nota: 'Lo último que abriste en este equipo', items: rec.map(function (r, i) {
        return { id: 'rec|' + i, mod: r.modulo, item: r.item || '', nombre: r.nombre, sub: r.ruta && r.nombre.indexOf(r.ruta) === -1 ? r.ruta : '', hijos: [], badge: 0, tono: 'ambar' };
      }) });
    }
    return cards;
  }

  function estadoHtml(m) {
    var b = est_.badges[m.id];
    if (!b || !b.n || m.id === 'home') return '';
    return '<span class="sb-chip sb-chip--' + b.tono + '"><i aria-hidden="true"></i>' + esc(textoEstado(b)) + '</span>';
  }

  // Qué módulo de primer nivel abrir para que se vea la página activa.
  function abrirRutaDe(moduloId, itemId) {
    var r = rutaActiva(moduloId, itemId);
    if (!r) return false;
    est_.abierto1 = r.mod1;
    est_.abierto2 = r.item2;
    return true;
  }

  var INICIO_ = { id: 'home', nombre: 'Inicio', titulo: 'Inicio', icono: 'inicio', desc: 'Lo tuyo, tus atajos y lo pendiente de todos tus módulos' };
  function moduloVisible() {
    var o = est_.opts;
    if (esDeInicio(o.moduloActivo)) return INICIO_;
    return modulo(o.moduloActivo) || (o.accion && o.accion.modulo === o.moduloActivo ? { id: o.accion.modulo, nombre: o.accion.texto, titulo: o.accion.texto, icono: o.accion.icono || 'nueva', desc: 'Ingresa un pedido a cualquier área' } : null) ||
      INICIO_;
  }

  function pintar() {
    if (!raiz_ || !est_.opts) return;
    var o = est_.opts;
    var m = moduloVisible();
    // Cambió el área: desde el riel todo parte cerrado (la página queda marcada);
    // por otro camino (dirección, atajo, buscador) se abre la ruta de la página.
    if (m.id !== est_.ultMod) {
      est_.ultMod = m.id;
      est_.q = '';
      est_.abierto1 = null; est_.abierto2 = null;
      est_.abrirRuta = !est_.cerrarTodo;
      est_.cerrarTodo = false;
      var input = raiz_.querySelector('#sb-buscar');
      if (input) input.value = '';
    }
    if (est_.abrirRuta && (o.itemActivo || m.id === 'home') && abrirRutaDe(m.id, o.itemActivo)) est_.abrirRuta = false;

    var riel = raiz_.querySelector('#sb-riel');
    var nav = raiz_.querySelector('#nav-modulos');
    var scroll = nav ? nav.scrollTop : 0;
    var foco = document.activeElement && raiz_.contains(document.activeElement) ? refFoco(document.activeElement) : null;
    if (riel) riel.innerHTML = rielHtml();
    var tit = raiz_.querySelector('#sb-panel-titulo');
    var sub = raiz_.querySelector('#sb-panel-sub');
    var estado = raiz_.querySelector('#sb-panel-estado');
    if (tit) tit.textContent = m.titulo || m.nombre;
    if (sub) sub.textContent = m.desc || '';
    if (estado) { estado.innerHTML = estadoHtml(m); estado.hidden = !estado.innerHTML; }
    var panel = raiz_.querySelector('#sb-panel');
    if (panel) panel.setAttribute('aria-label', 'Menú de ' + (m.titulo || m.nombre));
    // El buscador filtra el menú del área; sin menú (Inicio, áreas directas) queda solo el de todo SIGSO.
    var caja = raiz_.querySelector('#sb-buscar-caja');
    if (caja) {
      caja.classList.remove('sb-buscar--global');
      caja.hidden = !tieneMenu(m.id);
      var inp = caja.querySelector('#sb-buscar');
      if (inp) inp.placeholder = 'Buscar en ' + (m.titulo || m.nombre);
    }
    // La estrella del encabezado agrega a tus atajos lo que estás mirando.
    var estrella = raiz_.querySelector('#sb-fijar-actual');
    if (estrella) {
      if (!estrella.firstChild) estrella.innerHTML = ico('estrella', 15);
      var h = o.itemActivo ? hojaDe(m.id, o.itemActivo) : null;
      var puede = m.id !== 'home' && (h || !tieneMenu(m.id));
      var on = puede && esFijado(m.id, h ? h.id : '');
      estrella.hidden = !puede;
      estrella.classList.toggle('sb-fijar--on', !!on);
      estrella.setAttribute('aria-pressed', String(!!on));
      estrella.setAttribute('aria-label', on ? 'Quitar esta pantalla de tus atajos' : 'Agregar esta pantalla a tus atajos');
      estrella.setAttribute('title', on ? 'Quitar de tus atajos' : 'Agregar a tus atajos (Inicio)');
      estrella.setAttribute('data-fmod', m.id);
      estrella.setAttribute('data-fitem', h ? h.id : '');
      estrella.setAttribute('data-fnombre', h ? h.nombre : (m.nombre || ''));
    }
    // El manual de uso de este módulo (manual-v2.js).
    var manual = raiz_.querySelector('#sb-manual');
    if (manual) {
      var mn = window.SigsoManual ? SigsoManual.de(esDeInicio(o.moduloActivo) ? o.moduloActivo : m.id) : null;
      manual.hidden = !mn;
      if (mn) { manual.innerHTML = ico('libro', 14) + '<span>Manual de uso</span>'; manual.setAttribute('data-manual', mn.id); manual.title = 'Paso a paso de ' + (m.nombre || '') + ' (F1)'; }
    }
    var accion = raiz_.querySelector('#sb-accion');
    if (accion) {
      accion.hidden = !o.accion;
      if (o.accion) {
        accion.innerHTML = '<span class="sb-rb__ico">' + ico('nueva', 20) + '</span><span class="sb-txt">' + esc(o.accion.texto) + '</span>';
        accion.setAttribute('aria-label', o.accion.texto);
        accion.classList.toggle('sb-nueva--act', o.moduloActivo === o.accion.modulo);
      }
    }
    var volver = raiz_.querySelector('#sb-volver');
    if (volver && !volver.firstChild) volver.innerHTML = ico('izquierda', 16) + '<span>Áreas</span>';
    if (nav) { nav.innerHTML = areaHtml(m); nav.scrollTop = scroll; }
    if (foco) { var el = raiz_.querySelector(foco); if (el) el.focus(); }
    // El área abierta, a la vista en el riel (cuentas con muchas).
    var act = riel && riel.querySelector('.sb-rb--act');
    if (act && act.offsetTop !== est_.ultimoAct) {
      est_.ultimoAct = act.offsetTop;
      if (act.offsetTop < riel.scrollTop || act.offsetTop + act.offsetHeight > riel.scrollTop + riel.clientHeight) riel.scrollTop = act.offsetTop - riel.clientHeight / 2;
    }
  }
  function refFoco(el) {
    var attrs = ['data-modulo', 'data-item', 'data-abrir1', 'data-abrir2', 'data-fijado', 'data-quitar', 'data-reciente', 'data-irmod', 'data-fitem'];
    for (var i = 0; i < attrs.length; i++) {
      var v = el.getAttribute(attrs[i]);
      if (v !== null) return '[' + attrs[i] + '="' + String(v).replace(/"/g, '\\"') + '"]' + (attrs[i] === 'data-fitem' ? '.sb-fijar' : '');
    }
    return el.id ? '#' + el.id : null;
  }

  // --- acordeón sin repintar (para que se vea la animación) ---------------------------------
  function marcarAbierto(el, abierto) {
    el.setAttribute('aria-expanded', String(abierto));
    var cuerpo = document.getElementById(el.getAttribute('aria-controls'));
    if (cuerpo) {
      cuerpo.classList.toggle('sb-plegable--abierto', abierto);
      // Lo de adentro de algo cerrado no se recorre con Tab.
      cuerpo.querySelectorAll('.sb-n2, .sb-n3, .sb-quitar').forEach(function (b) {
        var enBandeja = b.classList.contains('sb-n3');
        var visible = abierto && (!enBandeja || (b.closest('.sb-plegable--3') || {}).classList.contains('sb-plegable--abierto'));
        if (visible) b.removeAttribute('tabindex'); else b.setAttribute('tabindex', '-1');
      });
    }
  }
  function alternar1(id) {
    if (est_.q.trim()) return;
    est_.abierto1 = est_.abierto1 === id ? null : id;
    est_.abierto2 = null;
    raiz_.querySelectorAll('#nav-modulos .sb-mod[data-mod1]').forEach(function (card) {
      var abre = card.getAttribute('data-mod1') === est_.abierto1;
      card.classList.toggle('sb-mod--abierto', abre);
      card.querySelectorAll('.sb-n2-grupo').forEach(function (g) {
        g.classList.remove('sb-n2-grupo--abierto');
        var b = g.querySelector('[data-abrir2]');
        if (b) marcarAbierto(b, false);
      });
      marcarAbierto(card.querySelector('[data-abrir1]'), abre);
    });
  }
  function alternar2(btn) {
    if (est_.q.trim()) return;
    var id = btn.getAttribute('data-abrir2');
    est_.abierto2 = est_.abierto2 === id ? null : id;
    var card = btn.closest('.sb-mod');
    (card || raiz_).querySelectorAll('[data-abrir2]').forEach(function (b) {
      var abre = b.getAttribute('data-abrir2') === est_.abierto2;
      b.parentNode.classList.toggle('sb-n2-grupo--abierto', abre);
      marcarAbierto(b, abre);
    });
  }

  // --- riel que se despliega ----------------------------------------------------------------
  // Mientras se anima el ancho los nombres van en una línea (no saltan); ya
  // desplegado, uno largo («Administración del sistema») baja a dos líneas
  // dentro de la misma fila: nunca se corta.
  var timerListo_ = null;
  function desplegar(si) {
    clearTimeout(timerRiel_);
    clearTimeout(timerListo_);
    if (!raiz_) return;
    raiz_.classList.toggle('sb--riel-abierto', !!si);
    if (!si) { raiz_.classList.remove('sb--riel-listo'); return; }
    timerListo_ = setTimeout(function () { if (raiz_.classList.contains('sb--riel-abierto')) raiz_.classList.add('sb--riel-listo'); }, 270);
  }
  function esCajon() { return window.innerWidth < 1024; }

  // --- interacción --------------------------------------------------------------------------
  function ir(f) {
    var o = est_.opts;
    if (!f || !o) return;
    if (f.item) o.onItem(f.modulo, f.item); else o.onModulo(f.modulo);
    if (o.alNavegar) o.alNavegar();
  }
  function alClic(ev) {
    var o = est_.opts;
    if (!o) return;
    var t = ev.target.closest('button');
    if (!t || !raiz_.contains(t)) return;
    if (t.hasAttribute('data-modulo')) {
      var id = t.getAttribute('data-modulo');
      var cambia = id !== o.moduloActivo;
      if (cambia) { est_.cerrarTodo = true; o.onModulo(id); }
      if (!esCajon()) desplegar(false);
      // Con menú, se muestra el panel del área para elegir; sin menú, ya llegaste.
      if (tieneMenu(id) || (o.conMenu && o.conMenu(id))) { if (o.abrirMenu) o.abrirMenu(!cambia); }
      else if (o.alNavegar) o.alNavegar();
      return;
    }
    if (t.hasAttribute('data-abrir1')) { alternar1(t.getAttribute('data-abrir1')); return; }
    if (t.hasAttribute('data-abrir2')) { alternar2(t); return; }
    if (t.hasAttribute('data-item')) { ir({ modulo: t.getAttribute('data-de-modulo'), item: t.getAttribute('data-item') }); return; }
    if (t.hasAttribute('data-irmod')) { ir({ modulo: t.getAttribute('data-irmod'), item: '' }); return; }
    if (t.hasAttribute('data-fijado')) { ir(fijadosVisibles()[Number(t.getAttribute('data-fijado'))]); return; }
    if (t.hasAttribute('data-reciente')) { var p = t.getAttribute('data-reciente').split('|'); ir({ modulo: p[0], item: p.slice(1).join('|') }); return; }
    if (t.hasAttribute('data-quitar')) {
      var l = fijadosVisibles().slice(); l.splice(Number(t.getAttribute('data-quitar')), 1); guardarFijados(l); return;
    }
    if (t.hasAttribute('data-fmod')) { alternarFijado(t.getAttribute('data-fmod'), t.getAttribute('data-fitem'), t.getAttribute('data-fnombre')); return; }
    if (t.id === 'sb-accion' && o.accion) { desplegar(false); o.accion.ir(); if (o.alNavegar) o.alNavegar(); return; }
    if (t.id === 'sb-manual' && window.SigsoManual) { SigsoManual.abrir(t.getAttribute('data-manual')); if (o.alNavegar) o.alNavegar(); return; }
    if (t.id === 'sb-volver' && o.volverAreas) o.volverAreas();
  }

  // Teclado: flechas arriba/abajo recorren lo visible; derecha abre, izquierda cierra o sube al padre.
  function alTeclado(ev) {
    if (ev.key === 'Escape' && raiz_.classList.contains('sb--riel-abierto')) { desplegar(false); return; }
    var zona = ev.target.closest('#sb-riel-caja, #nav-modulos');
    if (!zona) return;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
      var t = ev.target;
      var rama = t.hasAttribute('data-abrir1') || t.hasAttribute('data-abrir2');
      var abierto = t.getAttribute('aria-expanded') === 'true';
      if (ev.key === 'ArrowRight' && rama && !abierto) { ev.preventDefault(); t.click(); return; }
      if (ev.key === 'ArrowLeft') {
        if (rama && abierto) { ev.preventDefault(); t.click(); return; }
        var padre = t.closest('.sb-n2-grupo') && !t.hasAttribute('data-abrir2') ? t.closest('.sb-n2-grupo').querySelector('[data-abrir2]')
          : (t.closest('.sb-mod[data-mod1]') && !t.hasAttribute('data-abrir1') ? t.closest('.sb-mod[data-mod1]').querySelector('[data-abrir1]') : null);
        if (padre) { ev.preventDefault(); padre.focus(); }
      }
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].indexOf(ev.key) === -1) return;
    var lista = Array.prototype.slice.call(zona.querySelectorAll('.sb-rb, .sb-nueva, .sb-mod__cab, .sb-n2, .sb-n3')).filter(function (b) { return b.offsetParent !== null && b.getAttribute('tabindex') !== '-1'; });
    var i = lista.indexOf(ev.target);
    if (i === -1) return;
    ev.preventDefault();
    var j = ev.key === 'Home' ? 0 : ev.key === 'End' ? lista.length - 1 : i + (ev.key === 'ArrowDown' ? 1 : -1);
    if (lista[Math.max(0, Math.min(lista.length - 1, j))]) lista[Math.max(0, Math.min(lista.length - 1, j))].focus();
  }
  // Alt+1…8: ir a tus atajos desde cualquier parte.
  function alAtajo(ev) {
    if (!ev.altKey || ev.ctrlKey || ev.metaKey || !/^Digit[1-8]$/.test(ev.code || '')) return;
    if (!est_.opts || document.getElementById('vista-shell').hidden) return;
    var f = fijadosVisibles()[Number(ev.code.slice(5)) - 1];
    if (!f) return;
    ev.preventDefault();
    ir(f);
  }

  // Reordenar atajos arrastrando (en Inicio).
  var arrastre_ = -1;
  function alArrastrar(ev) {
    var fila = ev.target.closest && ev.target.closest('.sb-fijados [data-pos]');
    if (ev.type === 'dragstart') {
      if (!fila) return;
      arrastre_ = Number(fila.getAttribute('data-pos'));
      try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(arrastre_)); } catch (e) { /* */ }
      fila.classList.add('sb-fila--arrastre');
      return;
    }
    if (ev.type === 'dragover') { if (fila && arrastre_ !== -1) { ev.preventDefault(); fila.classList.add('sb-fila--destino'); } return; }
    if (ev.type === 'dragleave') { if (fila) fila.classList.remove('sb-fila--destino'); return; }
    if (ev.type === 'drop') {
      if (!fila || arrastre_ === -1) return;
      ev.preventDefault();
      var a = arrastre_, b = Number(fila.getAttribute('data-pos'));
      arrastre_ = -1;
      if (a === b) { pintar(); return; }
      var l = fijadosVisibles().slice();
      var x = l.splice(a, 1)[0];
      l.splice(b, 0, x);
      guardarFijados(l);
      return;
    }
    if (ev.type === 'dragend') { arrastre_ = -1; pintar(); }
  }

  // --- API ----------------------------------------------------------------------------------
  function iniciar(cfg) {
    raiz_ = document.getElementById('plataforma-sidebar');
    if (!raiz_ || raiz_.getAttribute('data-sb') === '1') { if (cfg && cfg.cuenta) cargarCuenta(cfg.cuenta); return; }
    raiz_.setAttribute('data-sb', '1');
    raiz_.addEventListener('click', alClic);
    raiz_.addEventListener('keydown', alTeclado);
    ['dragstart', 'dragover', 'dragleave', 'drop', 'dragend'].forEach(function (t) { raiz_.addEventListener(t, alArrastrar); });
    // El riel se despliega sobre el panel: con el mouse (tras una pausa, para
    // que no se abra al cruzarlo de pasada) o al entrar con el teclado.
    var riel = raiz_.querySelector('#sb-riel-caja');
    if (riel) {
      riel.addEventListener('mouseenter', function () {
        if (esCajon()) return;
        clearTimeout(timerRiel_);
        timerRiel_ = setTimeout(function () { desplegar(true); }, ESPERA_RIEL);
      });
      riel.addEventListener('mouseleave', function () {
        if (esCajon()) return;
        var menuAbierto = document.getElementById('btn-menu-usuario');
        if (menuAbierto && menuAbierto.getAttribute('aria-expanded') === 'true') { clearTimeout(timerRiel_); return; }
        desplegar(false);
      });
      riel.addEventListener('focusin', function (ev) { if (!esCajon() && ev.target.matches(':focus-visible')) desplegar(true); });
      riel.addEventListener('focusout', function (ev) { if (!esCajon() && !riel.contains(ev.relatedTarget)) desplegar(false); });
    }
    // Buscador del panel: filtra mientras se escribe; Esc lo vacía.
    var input = raiz_.querySelector('#sb-buscar');
    if (input) {
      input.addEventListener('input', function () {
        est_.q = input.value;
        var nav = raiz_.querySelector('#nav-modulos');
        if (nav && est_.opts) nav.innerHTML = areaHtml(moduloVisible());
      });
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape' && input.value) { ev.stopPropagation(); input.value = ''; est_.q = ''; pintar(); }
      });
    }
    var icoB = raiz_.querySelector('#ico-sb-buscar');
    if (icoB) icoB.innerHTML = ico('lupa', 15);
    // Llegar por una dirección (o con atrás/adelante) abre la ruta de la página.
    window.addEventListener('hashchange', function () { est_.abrirRuta = true; });
    document.addEventListener('keydown', alAtajo);
    if (cfg && cfg.cuenta) cargarCuenta(cfg.cuenta);
  }
  /** Atajos de la cuenta: primero lo guardado en este equipo (al instante), después lo de la cuenta. */
  function cargarCuenta(cuentaId) {
    est_.cuenta = String(cuentaId || '');
    var cache = leerLS(llave('sigso_barra_fijados'));
    est_.fijados = Array.isArray(cache) ? cache : null;
    est_.recientes = leerLS(llave('sigso_barra_recientes')) || [];
    pintar();
    if (typeof llamarApi !== 'function') return;
    llamarApi(null, 'obtenerPreferencias', {}).then(function (r) {
      if (!r || !r.ok || !r.data) return;
      est_.fijados = Array.isArray(r.data.fijados) ? r.data.fijados : null;
      guardarLS(llave('sigso_barra_fijados'), est_.fijados);
      pintar();
    }).catch(function () { /* se queda con lo de este equipo */ });
  }
  function actualizar(opts) { est_.opts = opts; pintar(); }
  function badge(id, n, tono) {
    est_.badges[id] = { n: Number(n) || 0, tono: TONOS[tono] ? tono : 'ambar' };
    if (!raiz_) return;
    var b = est_.badges[id];
    raiz_.querySelectorAll('[data-badge="' + id + '"]').forEach(function (el) {
      el.textContent = b.n ? cifra(b.n) : '';
      el.className = 'sb-pill sb-pill--' + b.tono + ' sb-txt' + (b.n ? '' : ' sigso-oculto');
      el.title = textoEstado(b);
      var btn = el.closest('.sb-rb');
      if (btn) { var m = modulo(id); btn.setAttribute('aria-label', ((m && (m.titulo || m.nombre)) || id) + (b.n ? ', ' + textoEstado(b) : '')); }
    });
    raiz_.querySelectorAll('[data-punto="' + id + '"]').forEach(function (el) {
      el.className = 'sb-punto sb-punto--' + b.tono + (b.n ? '' : ' sigso-oculto');
    });
    // El encabezado del área abierta e Inicio (lo pendiente, tus atajos) muestran el mismo número.
    var o = est_.opts;
    if (o && (o.moduloActivo === id || o.moduloActivo === 'home' || esDeInicio(o.moduloActivo) || !modulo(o.moduloActivo))) pintar();
  }

  window.SigsoBarra = {
    iniciar: iniciar,
    actualizar: actualizar,
    badge: badge,
    visita: visita,
    tieneMenu: tieneMenu,
    desplegar: desplegar,
    // Para pruebas y para el buscador: lo que hoy se ve como atajo.
    fijados: function () { return fijadosVisibles(); },
    // Para los manuales: repintar cuando llega su índice, qué módulos ve la cuenta y cuál está abierto.
    refrescar: function () { pintar(); },
    modulos: function () { return ((est_.opts && est_.opts.modulos) || []).map(function (m) { return m.id; }).concat(est_.opts && est_.opts.accion ? [est_.opts.accion.modulo] : []); },
    moduloActivo: function () { return est_.opts ? est_.opts.moduloActivo : ''; },
    _menu: menu,
    MAX_FIJADOS: MAX_FIJADOS
  };
})();
