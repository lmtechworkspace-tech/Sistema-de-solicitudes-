/**
 * barra-lateral.js — la barra lateral de la plataforma.
 *
 * Segunda versión (2026-10-05, decisiones del dueño tras la primera semana:
 * el equipo no distinguía el módulo, veía «todo como una lista» y no entendía
 * los íconos solos):
 *   A   RIEL CON NOMBRES + PANEL CON PORTADA: cada módulo con su ícono, su
 *       nombre y su color, agrupados (Mi espacio, Solicitudes, Áreas…). Al lado,
 *       la portada del módulo abierto (color, nombre, para qué sirve, cuánto
 *       espera) y su menú por SECCIONES que se pliegan, con ícono y línea guía.
 *   2   Un ícono y un color propios por módulo (iconos.js, tokens.css).
 *   3   Los FIJADOS salen del menú de cada módulo: viven en Inicio como «Mis
 *       atajos» (hasta 8, en la cuenta), junto a lo pendiente y lo reciente.
 *   4   Para todos de una vez, reemplazando la versión anterior.
 *
 * Se mantiene de la primera versión: contadores de tres colores (rojo
 * atrasado, ámbar para hoy, gris por revisar), Alt+1…8 a los atajos,
 * angostar con «[» (queda el riel, que ahora sí dice qué es cada cosa).
 *
 * El shell (plataforma.js) le pasa qué módulos ve la cuenta y dónde está la
 * persona; los menús de cada módulo salen del mismo registro que ya usaban el
 * árbol y el buscador (SigsoNav), con el mismo permiso `visible`.
 */
(function () {
  'use strict';

  var MAX_FIJADOS = 8;
  var MAX_RECIENTES = 5;
  var TONOS = { rojo: 'atrasado', ambar: 'para hoy', gris: 'por revisar' };
  // Cómo se lee el contador de un módulo en su portada.
  var ESTADO_TXT = { rojo: ['pendiente con atraso', 'pendientes, con atrasos'], ambar: ['para hoy', 'para hoy'], gris: ['por revisar', 'por revisar'] };
  // Títulos cortos de los grupos del riel (92 px).
  var GRUPO_CORTO = { Departamentos: 'Áreas' };
  // Lo que se propone como atajo la primera vez, por área.
  var SUGERIDOS_AREA = { dep_contabilidad: ['hoy', 'm:IVA', 'conv'] };
  var SUGERIDOS_MODULO = ['bandeja', 'mi_trabajo', 'mis_solicitudes', 'proyectos', 'calidad', 'gerencia', 'dep_administracion', 'novedades'];

  var est_ = { opts: null, badges: {}, fijados: null, recientes: [], cuenta: '', cerradas: {} };
  var raiz_ = null;

  function esc(t) { return window.Componentes ? Componentes.escaparHtml(t) : String(t == null ? '' : t); }
  function ico(n, t) { return window.Iconos ? Iconos.svg(n, { tam: t || 18 }) : ''; }
  function leerLS(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function guardarLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin storage */ } }
  function llave(base) { return base + (est_.cuenta ? '_' + est_.cuenta : ''); }

  function modulo(id) { return ((est_.opts && est_.opts.modulos) || []).filter(function (m) { return m.id === id; })[0] || null; }
  function puedeIr(f) { return !!f && (modulo(f.modulo) || (est_.opts && est_.opts.accion && est_.opts.accion.modulo === f.modulo)); }
  function colorDe(m) { return (m && m.acento) || 'var(--mod-inicio)'; }

  /**
   * Menú de un módulo: secciones con título, ícono y sus pantallas. Las
   * secciones de una sola pantalla («Hoy», «Reporte mensual») quedan sueltas,
   * sin título, y se muestran destacadas arriba de su bloque.
   */
  function secciones(moduloId) {
    var def = window.SigsoNav && SigsoNav.obtener(moduloId);
    if (!def || !(def.submodulos || []).length) return [];
    var out = [], sueltas = null;
    def.submodulos.forEach(function (sub) {
      var items = SigsoNav.itemsVisibles(sub, def.visible);
      if (!items.length) return;
      var hoja = function (it, nombre) { return { id: it.id, nombre: nombre || it.nombre, badge: it.badge, tono: it.tono === 'peligro' ? 'rojo' : (it.tono || 'ambar'), icono: sub.icono || '' }; };
      if (SigsoNav.esPlano(sub, items)) {
        if (!sueltas) { sueltas = { titulo: '', items: [] }; out.push(sueltas); }
        sueltas.items.push(hoja(items[0], sub.nombre));
        return;
      }
      sueltas = null;
      out.push({ titulo: sub.nombre, nota: sub.descripcion || '', icono: sub.icono || '', items: items.map(function (it) { return hoja(it); }) });
    });
    return out;
  }
  function hojaDe(moduloId, itemId) {
    var r = null;
    secciones(moduloId).forEach(function (s) { s.items.forEach(function (it) { if (it.id === itemId) r = it; }); });
    return r;
  }
  function tieneMenu(moduloId) { return secciones(moduloId).length > 0; }

  // --- atajos (fijados) y recientes ---------------------------------------------------------
  function sugeridos() {
    var out = [];
    var dep = ((est_.opts && est_.opts.modulos) || []).filter(function (m) { return /^dep_/.test(m.id) && m.id !== 'dep_administracion'; })[0];
    if (dep) {
      var pref = SUGERIDOS_AREA[dep.id];
      var candidatos = pref ? pref.map(function (id) { return hojaDe(dep.id, id); })
        : [hojaDe(dep.id, 'hoy')].concat((secciones(dep.id).filter(function (s) { return s.titulo === 'Trabajo'; })[0] || { items: [] }).items.filter(function (it) { return it.id !== 'inicio'; }).slice(0, 2));
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

  // --- HTML ---------------------------------------------------------------------------------
  function contador(b, attrs) {
    var n = b && b.n ? (b.n > 99 ? '99+' : String(b.n)) : '';
    return '<span class="sb-n sb-n--' + ((b && b.tono) || 'ambar') + (n ? '' : ' sigso-oculto') + '"' + (attrs || '') + '>' + n + '</span>';
  }
  function etiquetaContador(b) { return b && b.n ? ', ' + b.n + ' ' + (TONOS[b.tono] || '') : ''; }

  /** El riel: grupos con título corto y cada módulo con ícono, nombre y color. */
  function rielHtml() {
    var o = est_.opts, usados = {}, bloques = [];
    (o.grupos || []).forEach(function (g) {
      var b = [];
      (g.modulos || []).forEach(function (id) { if (modulo(id) && !usados[id]) { usados[id] = true; b.push(id); } });
      if (b.length) bloques.push({ titulo: g.titulo, ids: b });
    });
    var resto = o.modulos.filter(function (m) { return !usados[m.id]; }).map(function (m) { return m.id; });
    if (resto.length) bloques.push({ titulo: '', ids: resto });
    return bloques.map(function (b) {
      return (b.titulo ? '<p class="sb-grupo">' + esc(GRUPO_CORTO[b.titulo] || b.titulo) + '</p>' : '') + b.ids.map(function (id) {
        var m = modulo(id), act = id === o.moduloActivo, bd = est_.badges[id];
        return '<button type="button" class="sb-rb' + (act ? ' sb-rb--act' : '') + '" data-modulo="' + esc(id) + '" data-tip="' + esc(m.titulo || m.nombre) + '" data-desc="' + esc(m.desc || '') + '"' +
          ' aria-label="' + esc((m.titulo || m.nombre) + etiquetaContador(bd)) + '"' + (act ? ' aria-current="page"' : '') + ' style="--sb-c:' + colorDe(m) + '">' +
          ico(m.icono, 20) + '<span class="sb-rb__t">' + esc(m.corto || m.nombre) + '</span>' + contador(bd, ' data-badge="' + esc(id) + '"') + '</button>';
      }).join('');
    }).join('');
  }

  function filaHoja(mod, it, act) {
    var fij = esFijado(mod, it.id);
    return '<div class="sb-fila' + (act ? ' sb-fila--act' : '') + '">' +
      '<button type="button" class="sb-hoja" data-item="' + esc(it.id) + '" data-de-modulo="' + esc(mod) + '"' + (act ? ' aria-current="page"' : '') + '>' +
        '<span class="sb-hoja__t">' + esc(it.nombre) + '</span>' + (it.badge ? contador({ n: Number(it.badge) || it.badge, tono: it.tono }) : '') + '</button>' +
      '<button type="button" class="sb-fijar' + (fij ? ' sb-fijar--on' : '') + '" data-fmod="' + esc(mod) + '" data-fitem="' + esc(it.id) + '" data-fnombre="' + esc(it.nombre) + '"' +
        ' aria-pressed="' + fij + '" aria-label="' + (fij ? 'Quitar ' + esc(it.nombre) + ' de tus atajos' : 'Agregar ' + esc(it.nombre) + ' a tus atajos') + '" title="' + (fij ? 'Quitar de tus atajos' : 'Agregar a tus atajos (Inicio)') + '">' + ico('estrella', 14) + '</button>' +
    '</div>';
  }
  /** Una pantalla suelta («Hoy», «Reporte mensual»): tarjeta destacada con su ícono. */
  function destacada(mod, it, act) {
    var b = it.badge ? { n: Number(it.badge) || it.badge, tono: it.tono } : null;
    return '<div class="sb-fila sb-dest' + (act ? ' sb-fila--act' : '') + '">' +
      '<button type="button" class="sb-hoja" data-item="' + esc(it.id) + '" data-de-modulo="' + esc(mod) + '"' + (act ? ' aria-current="page"' : '') + '>' +
        '<span class="sb-sec__ico">' + ico(it.icono || 'derecha', 15) + '</span><span class="sb-hoja__t"><b>' + esc(it.nombre) + '</b>' +
        (b && b.n ? '<small>' + esc(b.n + ' ' + (b.n === 1 ? (ESTADO_TXT[b.tono] || ESTADO_TXT.ambar)[0] : (ESTADO_TXT[b.tono] || ESTADO_TXT.ambar)[1])) + '</small>' : '') + '</span>' + (b ? contador(b) : '') + '</button>' +
    '</div>';
  }
  function bloque(m, s, o) {
    var k = m.id + '|' + s.titulo;
    var activa = s.items.some(function (it) { return it.id === o.itemActivo; });
    var abierta = activa || !est_.cerradas[k];
    var urg = s.items.filter(function (it) { return it.badge; }).length;
    return '<div class="sb-bloque' + (abierta ? '' : ' sb-bloque--cerrado') + '">' +
      '<button type="button" class="sb-sec" data-sec="' + esc(k) + '" aria-expanded="' + abierta + '"' + (s.nota ? ' title="' + esc(s.nota) + '"' : '') + '>' +
        '<span class="sb-sec__ico">' + ico(s.icono || 'lista', 15) + '</span><span class="sb-sec__t">' + esc(s.titulo) + '</span>' +
        (urg && !abierta ? '<span class="sb-sec__punto" title="Hay pendientes adentro"></span>' : '') +
        '<span class="sb-sec__cuenta">' + s.items.length + '</span><span class="sb-sec__flecha">' + ico('abajo', 14) + '</span></button>' +
      '<div class="sb-lista">' + s.items.map(function (it) { return filaHoja(m.id, it, it.id === o.itemActivo); }).join('') + '</div></div>';
  }
  function badgeDe(f) {
    if (f.item) { var h = hojaDe(f.modulo, f.item); return h && h.badge ? { n: Number(h.badge) || h.badge, tono: h.tono } : null; }
    return est_.badges[f.modulo] || null;
  }
  function mini(m) { return '<span class="sb-mini" style="--sb-c:' + colorDe(m) + '">' + ico((m && m.icono) || 'derecha', 14) + '</span>'; }

  /** Inicio: tus atajos (los fijados), lo pendiente de cada módulo y lo reciente. */
  function inicioHtml() {
    var o = est_.opts, html = '';
    var l = fijadosVisibles(), sug = est_.fijados === null;
    html += '<p class="sb-titulo sb-titulo--fij">' + ico('estrella', 12) + (sug ? 'Atajos sugeridos' : 'Mis atajos') + '</p>' +
      (sug ? '<p class="sb-pista">Agrega tus pantallas de todos los días con la estrella ' + ico('estrella', 11) + ' que aparece al pasar por cada una. Mientras, te sugerimos estas.</p>' : '') +
      (l.length ? '<div class="sb-lista sb-fijados">' + l.map(function (f, i) {
        var m = modulo(f.modulo) || (o.accion && o.accion.modulo === f.modulo ? { icono: o.accion.icono || 'nueva', acento: 'var(--mod-nueva)' } : null);
        return '<div class="sb-fila sb-atajo" draggable="true" data-pos="' + i + '">' +
          '<button type="button" class="sb-hoja" data-fijado="' + i + '"' + (i < 8 ? ' title="Alt+' + (i + 1) + '"' : '') + '>' + mini(m) + '<span class="sb-hoja__t">' + esc(f.nombre) +
            (f.ruta && f.nombre.indexOf(f.ruta) === -1 ? '<small>' + esc(f.ruta) + '</small>' : '') + '</span>' + (badgeDe(f) ? contador(badgeDe(f)) : '') + '</button>' +
          (sug ? '' : '<button type="button" class="sb-quitar" data-quitar="' + i + '" aria-label="Quitar ' + esc(f.nombre) + ' de tus atajos" title="Quitar de tus atajos">' + ico('equis', 12) + '</button>') +
        '</div>';
      }).join('') + '</div>' : '<p class="sb-pista">Todavía no tienes atajos.</p>');
    var pend = o.modulos.filter(function (m) { return m.id !== 'home' && est_.badges[m.id] && est_.badges[m.id].n; })
      .sort(function (a, b) { var r = { rojo: 0, ambar: 1, gris: 2 }; return r[est_.badges[a.id].tono] - r[est_.badges[b.id].tono] || est_.badges[b.id].n - est_.badges[a.id].n; });
    if (pend.length) {
      html += '<p class="sb-titulo">' + ico('campana', 12) + 'Lo pendiente</p><div class="sb-lista">' + pend.map(function (m) {
        var b = est_.badges[m.id];
        return '<div class="sb-fila sb-atajo"><button type="button" class="sb-hoja" data-irmod="' + esc(m.id) + '">' + mini(m) + '<span class="sb-hoja__t">' + esc(m.nombre) +
          '<small>' + esc(TONOS[b.tono] === 'atrasado' ? 'Con atrasos' : (TONOS[b.tono] || '').charAt(0).toUpperCase() + (TONOS[b.tono] || '').slice(1)) + '</small></span>' + contador(b) + '</button></div>';
      }).join('') + '</div>';
    }
    var rec = est_.recientes.filter(function (r) { return puedeIr(r) && !esFijado(r.modulo, r.item); }).slice(0, MAX_RECIENTES);
    if (rec.length) {
      html += '<p class="sb-titulo">' + ico('reloj', 12) + 'Recientes</p><div class="sb-lista">' + rec.map(function (r) {
        return '<div class="sb-fila sb-atajo"><button type="button" class="sb-hoja" data-reciente="' + esc(r.modulo) + '|' + esc(r.item || '') + '">' + mini(modulo(r.modulo)) + '<span class="sb-hoja__t">' + esc(r.nombre) +
          (r.ruta && r.nombre.indexOf(r.ruta) === -1 ? '<small>' + esc(r.ruta) + '</small>' : '') + '</span></button></div>';
      }).join('') + '</div>';
    }
    return html;
  }

  function panelHtml(m) {
    var o = est_.opts;
    if (m.id === 'home') return inicioHtml();
    var secs = secciones(m.id);
    if (!secs.length && o.conMenu && o.conMenu(m.id)) return '<p class="sb-pista sb-cargando">Cargando el menú…</p>';
    if (!secs.length) {
      return '<div class="sb-directo">' + ico('derecha', 14) + '<span><b>' + esc(m.nombre) + '</b> se abre directo, sin submenú: lo que haces aquí está a la derecha.</span></div>' +
        '<p class="sb-pista">Para tenerlo a mano, agrégalo a tus atajos con la estrella de arriba.</p>';
    }
    return secs.map(function (s) {
      if (!s.titulo) return '<div class="sb-destacadas">' + s.items.map(function (it) { return destacada(m.id, it, it.id === o.itemActivo); }).join('') + '</div>';
      return bloque(m, s, o);
    }).join('');
  }

  function estadoHtml(m) {
    var b = est_.badges[m.id];
    if (!b || !b.n || m.id === 'home') return '';
    var t = ESTADO_TXT[b.tono] || ESTADO_TXT.ambar;
    return '<span class="sb-chip sb-chip--' + b.tono + '"><i></i>' + (b.n > 99 ? '99+' : b.n) + ' ' + esc(b.n === 1 ? t[0] : t[1]) + '</span>';
  }

  function pintar() {
    if (!raiz_ || !est_.opts) return;
    var o = est_.opts;
    var m = modulo(o.moduloActivo) || (o.accion && o.accion.modulo === o.moduloActivo ? { id: o.accion.modulo, nombre: o.accion.texto, titulo: o.accion.texto, icono: o.accion.icono || 'nueva', acento: 'var(--mod-nueva)', desc: 'Ingresa un pedido a cualquier área' } : null) ||
      { id: 'home', nombre: 'Inicio', titulo: 'Inicio', icono: 'inicio', acento: 'var(--mod-inicio)', desc: 'Tus atajos y lo pendiente de todos tus módulos' };
    var riel = raiz_.querySelector('#sb-riel');
    var nav = raiz_.querySelector('#nav-modulos');
    var panel = raiz_.querySelector('#sb-panel');
    var scroll = nav ? nav.scrollTop : 0;
    var foco = document.activeElement && raiz_.contains(document.activeElement) ? refFoco(document.activeElement) : null;
    if (riel) riel.innerHTML = rielHtml();
    if (panel) panel.style.setProperty('--sb-c', colorDe(m));
    var tile = raiz_.querySelector('#sb-panel-tile');
    if (tile) tile.innerHTML = ico(m.icono || 'inicio', 22);
    var tit = raiz_.querySelector('#sb-panel-titulo');
    var sub = raiz_.querySelector('#sb-panel-sub');
    var estado = raiz_.querySelector('#sb-panel-estado');
    if (tit) tit.textContent = m.titulo || m.nombre;
    if (sub) sub.textContent = m.desc || m.grupo || '';
    if (estado) { estado.innerHTML = estadoHtml(m); estado.hidden = !estado.innerHTML; }
    // La estrella de la portada agrega a tus atajos lo que estás mirando (un módulo sin menú o la pantalla abierta).
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
      var mn = window.SigsoManual ? SigsoManual.de(m.id) : null;
      manual.hidden = !mn;
      if (mn) { manual.innerHTML = ico('libro', 14) + '<span>Manual de uso</span>'; manual.setAttribute('data-manual', mn.id); manual.title = 'Paso a paso de ' + (m.nombre || '') + ' (F1)'; }
    }
    var accion = raiz_.querySelector('#sb-accion');
    if (accion) {
      accion.hidden = !o.accion;
      if (o.accion) {
        accion.innerHTML = ico(o.accion.icono || 'nueva', 18) + '<span>' + esc(o.accion.texto) + '</span>';
        accion.classList.toggle('sb-nueva--act', o.moduloActivo === o.accion.modulo);
      }
    }
    if (nav) { nav.innerHTML = panelHtml(m); nav.scrollTop = scroll; }
    if (foco) { var el = raiz_.querySelector(foco); if (el) el.focus(); }
    // El módulo abierto, a la vista en el riel (cuentas con muchos módulos).
    var act = riel && riel.querySelector('.sb-rb--act');
    if (act && act.offsetTop !== est_.ultimoAct) {
      est_.ultimoAct = act.offsetTop;
      if (act.offsetTop < riel.scrollTop || act.offsetTop + act.offsetHeight > riel.scrollTop + riel.clientHeight) riel.scrollTop = act.offsetTop - riel.clientHeight / 2;
    }
  }
  function refFoco(el) {
    var attrs = ['data-modulo', 'data-item', 'data-fijado', 'data-quitar', 'data-reciente', 'data-sec', 'data-irmod', 'data-fitem'];
    for (var i = 0; i < attrs.length; i++) {
      var v = el.getAttribute(attrs[i]);
      if (v !== null) return '[' + attrs[i] + '="' + String(v).replace(/"/g, '\\"') + '"]' + (attrs[i] === 'data-fitem' ? '.sb-fijar' : '');
    }
    return el.id ? '#' + el.id : null;
  }

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
      if (id !== o.moduloActivo) o.onModulo(id);
      // Con menú, se queda abierto para elegir la pantalla (angostada, flotando); sin menú, ya llegaste.
      if (tieneMenu(id) || (o.conMenu && o.conMenu(id))) { if (o.abrirMenu) o.abrirMenu(id === o.moduloActivo); }
      else if (o.alNavegar) o.alNavegar();
      return;
    }
    if (t.hasAttribute('data-sec')) {
      var k = t.getAttribute('data-sec');
      est_.cerradas[k] = t.getAttribute('aria-expanded') === 'true';
      if (!est_.cerradas[k]) delete est_.cerradas[k];
      guardarLS(llave('sigso_barra_cerradas'), est_.cerradas);
      pintar();
      return;
    }
    if (t.hasAttribute('data-item')) { ir({ modulo: t.getAttribute('data-de-modulo'), item: t.getAttribute('data-item') }); return; }
    if (t.hasAttribute('data-irmod')) { ir({ modulo: t.getAttribute('data-irmod'), item: '' }); return; }
    if (t.hasAttribute('data-fijado')) { ir(fijadosVisibles()[Number(t.getAttribute('data-fijado'))]); return; }
    if (t.hasAttribute('data-reciente')) { var p = t.getAttribute('data-reciente').split('|'); ir({ modulo: p[0], item: p.slice(1).join('|') }); return; }
    if (t.hasAttribute('data-quitar')) {
      var l = fijadosVisibles().slice(); l.splice(Number(t.getAttribute('data-quitar')), 1); guardarFijados(l); return;
    }
    if (t.hasAttribute('data-fmod')) { alternarFijado(t.getAttribute('data-fmod'), t.getAttribute('data-fitem'), t.getAttribute('data-fnombre')); return; }
    if (t.id === 'sb-accion' && o.accion) { o.accion.ir(); if (o.alNavegar) o.alNavegar(); return; }
    if (t.id === 'sb-manual' && window.SigsoManual) { SigsoManual.abrir(t.getAttribute('data-manual')); if (o.alNavegar) o.alNavegar(); }
  }

  // Flechas arriba/abajo dentro del riel o del panel; Inicio/Fin a los extremos.
  function alTeclado(ev) {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].indexOf(ev.key) === -1) return;
    var zona = ev.target.closest('#sb-riel, #nav-modulos');
    if (!zona) return;
    var lista = Array.prototype.slice.call(zona.querySelectorAll('.sb-rb, .sb-sec, .sb-hoja')).filter(function (b) { return b.offsetParent !== null; });
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

  // Al pasar por el riel: el nombre completo, para qué sirve y qué significa su número.
  var tip_ = null;
  function mostrarTip(btn) {
    if (!tip_) { tip_ = document.createElement('div'); tip_.className = 'sb-tip'; tip_.setAttribute('role', 'tooltip'); document.body.appendChild(tip_); }
    var bd = est_.badges[btn.getAttribute('data-modulo')];
    var desc = btn.getAttribute('data-desc');
    tip_.innerHTML = '<b>' + esc(btn.getAttribute('data-tip')) + '</b>' + (desc ? '<span class="sb-tip__d">' + esc(desc) + '</span>' : '') +
      (bd && bd.n ? '<span class="sb-tip__s"><span class="sb-n sb-n--' + bd.tono + '">' + bd.n + '</span>' + esc(TONOS[bd.tono] || '') + '</span>' : '');
    var r = btn.getBoundingClientRect();
    tip_.style.top = Math.round(r.top + r.height / 2) + 'px';
    tip_.style.left = Math.round(r.right + 10) + 'px';
    tip_.classList.add('sb-tip--ver');
  }
  function ocultarTip() { if (tip_) tip_.classList.remove('sb-tip--ver'); }

  // --- API ----------------------------------------------------------------------------------
  function iniciar(cfg) {
    raiz_ = document.getElementById('plataforma-sidebar');
    if (!raiz_ || raiz_.getAttribute('data-sb') === '1') { if (cfg && cfg.cuenta) cargarCuenta(cfg.cuenta); return; }
    raiz_.setAttribute('data-sb', '1');
    raiz_.addEventListener('click', alClic);
    raiz_.addEventListener('keydown', alTeclado);
    ['dragstart', 'dragover', 'dragleave', 'drop', 'dragend'].forEach(function (t) { raiz_.addEventListener(t, alArrastrar); });
    raiz_.addEventListener('mouseover', function (ev) { var b = ev.target.closest('.sb-rb'); if (b) mostrarTip(b); });
    raiz_.addEventListener('mouseout', function (ev) { if (ev.target.closest('.sb-rb')) ocultarTip(); });
    raiz_.addEventListener('focusin', function (ev) { if (ev.target.classList && ev.target.classList.contains('sb-rb')) mostrarTip(ev.target); });
    raiz_.addEventListener('focusout', ocultarTip);
    var nav = raiz_.querySelector('#sb-riel');
    if (nav) nav.addEventListener('scroll', ocultarTip);
    document.addEventListener('keydown', alAtajo);
    if (cfg && cfg.cuenta) cargarCuenta(cfg.cuenta);
  }
  /** Atajos de la cuenta: primero lo guardado en este equipo (al instante), después lo de la cuenta. */
  function cargarCuenta(cuentaId) {
    est_.cuenta = String(cuentaId || '');
    var cache = leerLS(llave('sigso_barra_fijados'));
    est_.fijados = Array.isArray(cache) ? cache : null;
    est_.recientes = leerLS(llave('sigso_barra_recientes')) || [];
    est_.cerradas = leerLS(llave('sigso_barra_cerradas')) || {};
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
    raiz_.querySelectorAll('[data-badge="' + id + '"]').forEach(function (el) {
      var b = est_.badges[id];
      el.textContent = b.n > 99 ? '99+' : String(b.n);
      el.className = 'sb-n sb-n--' + b.tono + (b.n ? '' : ' sigso-oculto');
      var btn = el.closest('.sb-rb');
      if (btn) btn.setAttribute('aria-label', btn.getAttribute('data-tip') + etiquetaContador(b));
    });
    // La portada del módulo abierto e Inicio (lo pendiente, tus atajos) muestran el mismo número.
    var o = est_.opts;
    if (o && (o.moduloActivo === id || o.moduloActivo === 'home' || !modulo(o.moduloActivo))) pintar();
  }

  window.SigsoBarra = {
    iniciar: iniciar,
    actualizar: actualizar,
    badge: badge,
    visita: visita,
    tieneMenu: tieneMenu,
    // Para pruebas y para el buscador: lo que hoy se ve como atajo.
    fijados: function () { return fijadosVisibles(); },
    // Para los manuales: repintar cuando llega su índice, qué módulos ve la cuenta y cuál está abierto.
    refrescar: function () { pintar(); },
    modulos: function () { return ((est_.opts && est_.opts.modulos) || []).map(function (m) { return m.id; }).concat(est_.opts && est_.opts.accion ? [est_.opts.accion.modulo] : []); },
    moduloActivo: function () { return est_.opts ? est_.opts.moduloActivo : ''; },
    _secciones: secciones,
    MAX_FIJADOS: MAX_FIJADOS
  };
})();
