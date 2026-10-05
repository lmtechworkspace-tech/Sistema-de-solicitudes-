/**
 * barra-lateral.js — la barra lateral de la plataforma (2026-10-05).
 *
 * Propuesta aprobada por el dueño («avanza según tus recomendaciones»):
 *   1A  RIEL + PANEL: a la izquierda un riel con el ícono de cada módulo y su
 *       contador, siempre a la vista; al lado, el menú COMPLETO del módulo
 *       abierto, con títulos de sección en vez de acordeones (dos niveles, no
 *       tres). Angostada, queda solo el riel y el menú se abre flotando.
 *   2   Nombres cortos donde falta espacio («RR.HH.», «Facturación»).
 *   3   FIJADOS de cada persona (hasta 8, en su cuenta: la siguen a cualquier
 *       equipo); la primera vez se proponen tres según su área.
 *   4   Contadores con significado: rojo atrasado, ámbar para hoy, gris por
 *       revisar.
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
  // Lo que se propone fijar la primera vez, por área (decisión 3).
  var SUGERIDOS_AREA = { dep_contabilidad: ['hoy', 'm:IVA', 'conv'] };
  var SUGERIDOS_MODULO = ['bandeja', 'mi_trabajo', 'mis_solicitudes', 'proyectos', 'calidad', 'gerencia', 'dep_administracion', 'novedades'];

  var est_ = { opts: null, badges: {}, fijados: null, recientes: [], cuenta: '' };
  var raiz_ = null;

  function esc(t) { return window.Componentes ? Componentes.escaparHtml(t) : String(t == null ? '' : t); }
  function ico(n, t) { return window.Iconos ? Iconos.svg(n, { tam: t || 18 }) : ''; }
  function leerLS(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function guardarLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin storage */ } }
  function llave(base) { return base + (est_.cuenta ? '_' + est_.cuenta : ''); }

  function modulo(id) { return ((est_.opts && est_.opts.modulos) || []).filter(function (m) { return m.id === id; })[0] || null; }
  function puedeIr(f) { return !!f && (modulo(f.modulo) || (est_.opts && est_.opts.accion && est_.opts.accion.modulo === f.modulo)); }

  /** Menú de un módulo: secciones con título y sus pantallas (las sueltas, juntas y sin título). */
  function secciones(moduloId) {
    var def = window.SigsoNav && SigsoNav.obtener(moduloId);
    if (!def || !(def.submodulos || []).length) return [];
    var out = [], sueltas = null;
    def.submodulos.forEach(function (sub) {
      var items = SigsoNav.itemsVisibles(sub, def.visible);
      if (!items.length) return;
      var hoja = function (it, nombre) { return { id: it.id, nombre: nombre || it.nombre, badge: it.badge, tono: it.tono === 'peligro' ? 'rojo' : (it.tono || 'ambar') }; };
      if (SigsoNav.esPlano(sub, items)) {
        if (!sueltas) { sueltas = { titulo: '', items: [] }; out.push(sueltas); }
        sueltas.items.push(hoja(items[0], sub.nombre));
        return;
      }
      sueltas = null;
      out.push({ titulo: sub.nombre, nota: sub.descripcion || '', items: items.map(function (it) { return hoja(it); }) });
    });
    return out;
  }
  function hojaDe(moduloId, itemId) {
    var r = null;
    secciones(moduloId).forEach(function (s) { s.items.forEach(function (it) { if (it.id === itemId) r = it; }); });
    return r;
  }
  function tieneMenu(moduloId) { return secciones(moduloId).length > 0; }

  // --- fijados y recientes ------------------------------------------------------------------
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
      if (!r || !r.ok || (d && d.ok === false)) avisar((d && d.message) || (r && r.message) || 'No se pudieron guardar tus fijados. Quedan en este equipo; inténtalo más tarde.', 'error');
    }).catch(function () { avisar('Sin conexión: tus fijados quedaron en este equipo y se guardan en tu cuenta la próxima vez.', 'info'); });
  }
  function alternarFijado(mod, item, nombre) {
    var lista = fijadosVisibles().slice();
    var i = -1;
    lista.forEach(function (f, k) { if (f.modulo === mod && (f.item || '') === (item || '')) i = k; });
    if (i !== -1) { lista.splice(i, 1); guardarFijados(lista); return; }
    if (lista.length >= MAX_FIJADOS) { avisar('Hasta ' + MAX_FIJADOS + ' fijados: quita uno antes de agregar otro.', 'info'); return; }
    var m = modulo(mod);
    lista.push({ modulo: mod, item: item || '', nombre: nombre, ruta: m ? m.corto : '' });
    guardarFijados(lista);
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

  function rielHtml() {
    var o = est_.opts, usados = {}, bloques = [];
    (o.grupos || []).forEach(function (g) {
      var b = [];
      (g.modulos || []).forEach(function (id) { if (modulo(id) && !usados[id]) { usados[id] = true; b.push(id); } });
      if (b.length) bloques.push(b);
    });
    var resto = o.modulos.filter(function (m) { return !usados[m.id]; }).map(function (m) { return m.id; });
    if (resto.length) bloques.push(resto);
    return bloques.map(function (b, i) {
      return (i ? '<span class="sb-sep" aria-hidden="true"></span>' : '') + b.map(function (id) {
        var m = modulo(id), act = id === o.moduloActivo, bd = est_.badges[id];
        return '<button type="button" class="sb-rb' + (act ? ' sb-rb--act' : '') + '" data-modulo="' + esc(id) + '" data-tip="' + esc(m.titulo) + '"' +
          ' aria-label="' + esc(m.titulo + etiquetaContador(bd)) + '"' + (act ? ' aria-current="page"' : '') +
          (m.acento ? ' style="--sb-acento:' + m.acento + '"' : '') + '>' +
          ico(m.icono, 20) + contador(bd, ' data-badge="' + esc(id) + '"') + '</button>';
      }).join('');
    }).join('');
  }

  function filaHoja(mod, it, act) {
    var fij = esFijado(mod, it.id);
    return '<div class="sb-fila' + (act ? ' sb-fila--act' : '') + '">' +
      '<button type="button" class="sb-hoja" data-item="' + esc(it.id) + '" data-de-modulo="' + esc(mod) + '"' + (act ? ' aria-current="page"' : '') + '>' +
        '<span class="sb-hoja__t">' + esc(it.nombre) + '</span>' + (it.badge ? contador({ n: Number(it.badge) || it.badge, tono: it.tono }) : '') + '</button>' +
      '<button type="button" class="sb-fijar' + (fij ? ' sb-fijar--on' : '') + '" data-fmod="' + esc(mod) + '" data-fitem="' + esc(it.id) + '" data-fnombre="' + esc(it.nombre) + '"' +
        ' aria-pressed="' + fij + '" aria-label="' + (fij ? 'Quitar ' + esc(it.nombre) + ' de fijados' : 'Fijar ' + esc(it.nombre) + ' arriba') + '" title="' + (fij ? 'Quitar de fijados' : 'Fijar arriba') + '">' + ico('estrella', 14) + '</button>' +
    '</div>';
  }
  function badgeDe(f) {
    if (f.item) { var h = hojaDe(f.modulo, f.item); return h && h.badge ? { n: Number(h.badge) || h.badge, tono: h.tono } : null; }
    return est_.badges[f.modulo] || null;
  }
  function fijadosHtml() {
    var l = fijadosVisibles();
    if (!l.length) return '';
    var sug = est_.fijados === null;
    return '<p class="sb-sec sb-sec--fij">' + ico('estrella', 12) + (sug ? 'Sugeridos para ti' : 'Fijados') + '</p>' +
      (sug ? '<p class="sb-pista">Fija tus pantallas con la estrella ' + ico('estrella', 11) + '; estas son una propuesta según tu área.</p>' : '') +
      '<div class="sb-lista sb-fijados">' + l.map(function (f, i) {
        return '<div class="sb-fila" draggable="true" data-pos="' + i + '">' +
          '<button type="button" class="sb-hoja" data-fijado="' + i + '"' + (i < 8 ? ' title="Alt+' + (i + 1) + '"' : '') + '><span class="sb-hoja__t">' + esc(f.nombre) +
            (f.ruta && f.ruta !== f.nombre ? '<small>' + esc(f.ruta) + '</small>' : '') + '</span>' + (badgeDe(f) ? contador(badgeDe(f)) : '') + '</button>' +
          '<button type="button" class="sb-quitar" data-quitar="' + i + '" aria-label="Quitar ' + esc(f.nombre) + ' de fijados" title="Quitar de fijados">' + ico('equis', 12) + '</button>' +
        '</div>';
      }).join('') + '</div>';
  }
  function recientesHtml() {
    var o = est_.opts;
    var l = est_.recientes.filter(function (r) { return puedeIr(r) && !(r.modulo === o.moduloActivo && (r.item || '') === (o.itemActivo || '')); }).slice(0, MAX_RECIENTES);
    if (!l.length) return '';
    return '<p class="sb-sec">' + ico('reloj', 12) + 'Recientes</p><div class="sb-lista">' + l.map(function (r) {
      return '<div class="sb-fila"><button type="button" class="sb-hoja" data-reciente="' + esc(r.modulo) + '|' + esc(r.item || '') + '"><span class="sb-hoja__t">' + esc(r.nombre) +
        (r.ruta && r.ruta !== r.nombre ? '<small>' + esc(r.ruta) + '</small>' : '') + '</span></button></div>';
    }).join('') + '</div>';
  }

  function panelHtml(m) {
    var o = est_.opts, secs = secciones(m.id), html = fijadosHtml();
    if (secs.length) {
      html += secs.map(function (s) {
        return (s.titulo ? '<p class="sb-sec">' + esc(s.titulo) + (s.nota ? ' <small>' + esc(s.nota) + '</small>' : '') + '</p>' : '<span class="sb-sec sb-sec--vacia" aria-hidden="true"></span>') +
          '<div class="sb-lista">' + s.items.map(function (it) { return filaHoja(m.id, it, it.id === o.itemActivo); }).join('') + '</div>';
      }).join('');
    } else {
      html += recientesHtml();
      if (!fijadosVisibles().length && !html) html = '<p class="sb-pista">Fija tus pantallas de todos los días con la estrella ' + ico('estrella', 11) + ' y aparecen aquí.</p>';
    }
    return html;
  }

  function pintar() {
    if (!raiz_ || !est_.opts) return;
    var o = est_.opts;
    var m = modulo(o.moduloActivo) || (o.accion && o.accion.modulo === o.moduloActivo ? { id: o.accion.modulo, nombre: o.accion.texto, titulo: o.accion.texto, grupo: '' } : null) ||
      { id: 'home', nombre: 'Inicio', titulo: 'Inicio', grupo: '' };
    var riel = raiz_.querySelector('#sb-riel');
    var nav = raiz_.querySelector('#nav-modulos');
    var scroll = nav ? nav.scrollTop : 0;
    var foco = document.activeElement && raiz_.contains(document.activeElement) ? refFoco(document.activeElement) : null;
    if (riel) riel.innerHTML = rielHtml();
    var tit = raiz_.querySelector('#sb-panel-titulo');
    var sub = raiz_.querySelector('#sb-panel-sub');
    if (tit) tit.textContent = m.titulo || m.nombre;
    if (sub) sub.textContent = m.id === 'home' ? 'Tu espacio de trabajo' : (m.grupo || '');
    // La estrella del encabezado fija lo que estás mirando (un módulo sin menú o la pantalla abierta).
    var estrella = raiz_.querySelector('#sb-fijar-actual');
    if (estrella) {
      if (!estrella.firstChild) estrella.innerHTML = ico('estrella', 15);
      var h = o.itemActivo ? hojaDe(m.id, o.itemActivo) : null;
      var puede = m.id !== 'home' && (h || !tieneMenu(m.id));
      var on = puede && esFijado(m.id, h ? h.id : '');
      estrella.hidden = !puede;
      estrella.classList.toggle('sb-fijar--on', !!on);
      estrella.setAttribute('aria-pressed', String(!!on));
      estrella.setAttribute('aria-label', on ? 'Quitar esta pantalla de fijados' : 'Fijar esta pantalla arriba');
      estrella.setAttribute('title', on ? 'Quitar de fijados' : 'Fijar esta pantalla');
      estrella.setAttribute('data-fmod', m.id);
      estrella.setAttribute('data-fitem', h ? h.id : '');
      estrella.setAttribute('data-fnombre', h ? h.nombre : (m.nombre || ''));
    }
    var accion = raiz_.querySelector('#sb-accion');
    if (accion) {
      accion.hidden = !o.accion;
      if (o.accion) accion.innerHTML = ico(o.accion.icono || 'mas', 16) + '<span>' + esc(o.accion.texto) + '</span>';
    }
    if (nav) { nav.innerHTML = panelHtml(m); nav.scrollTop = scroll; }
    if (foco) { var el = raiz_.querySelector(foco); if (el) el.focus(); }
  }
  function refFoco(el) {
    var attrs = ['data-modulo', 'data-item', 'data-fijado', 'data-quitar', 'data-reciente', 'data-fitem'];
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
    if (t.hasAttribute('data-item')) { ir({ modulo: t.getAttribute('data-de-modulo'), item: t.getAttribute('data-item') }); return; }
    if (t.hasAttribute('data-fijado')) { ir(fijadosVisibles()[Number(t.getAttribute('data-fijado'))]); return; }
    if (t.hasAttribute('data-reciente')) { var p = t.getAttribute('data-reciente').split('|'); ir({ modulo: p[0], item: p.slice(1).join('|') }); return; }
    if (t.hasAttribute('data-quitar')) {
      var l = fijadosVisibles().slice(); l.splice(Number(t.getAttribute('data-quitar')), 1); guardarFijados(l); return;
    }
    if (t.hasAttribute('data-fmod')) { alternarFijado(t.getAttribute('data-fmod'), t.getAttribute('data-fitem'), t.getAttribute('data-fnombre')); return; }
    if (t.id === 'sb-accion' && o.accion) { o.accion.ir(); if (o.alNavegar) o.alNavegar(); }
  }

  // Flechas arriba/abajo dentro del riel o del panel; Inicio/Fin a los extremos.
  function alTeclado(ev) {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].indexOf(ev.key) === -1) return;
    var zona = ev.target.closest('#sb-riel, #nav-modulos');
    if (!zona) return;
    var lista = Array.prototype.slice.call(zona.querySelectorAll('.sb-rb, .sb-hoja'));
    var i = lista.indexOf(ev.target);
    if (i === -1) return;
    ev.preventDefault();
    var j = ev.key === 'Home' ? 0 : ev.key === 'End' ? lista.length - 1 : i + (ev.key === 'ArrowDown' ? 1 : -1);
    if (lista[Math.max(0, Math.min(lista.length - 1, j))]) lista[Math.max(0, Math.min(lista.length - 1, j))].focus();
  }
  // Alt+1…8: ir a tus fijados desde cualquier parte.
  function alAtajo(ev) {
    if (!ev.altKey || ev.ctrlKey || ev.metaKey || !/^Digit[1-8]$/.test(ev.code || '')) return;
    if (!est_.opts || document.getElementById('vista-shell').hidden) return;
    var f = fijadosVisibles()[Number(ev.code.slice(5)) - 1];
    if (!f) return;
    ev.preventDefault();
    ir(f);
  }

  // Reordenar fijados arrastrando.
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

  // Nombre del módulo al pasar el mouse por el riel (fuera del riel, que hace scroll).
  var tip_ = null;
  function mostrarTip(btn) {
    if (!tip_) { tip_ = document.createElement('div'); tip_.className = 'sb-tip'; tip_.setAttribute('role', 'tooltip'); document.body.appendChild(tip_); }
    var bd = est_.badges[btn.getAttribute('data-modulo')];
    tip_.innerHTML = '<b>' + esc(btn.getAttribute('data-tip')) + '</b>' + (bd && bd.n ? '<span class="sb-tip__n sb-n sb-n--' + bd.tono + '">' + bd.n + '</span><span class="sb-tip__s">' + esc(TONOS[bd.tono] || '') + '</span>' : '');
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
  /** Fijados de la cuenta: primero lo guardado en este equipo (al instante), después lo de la cuenta. */
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
    raiz_.querySelectorAll('[data-badge="' + id + '"]').forEach(function (el) {
      var b = est_.badges[id];
      el.textContent = b.n > 99 ? '99+' : String(b.n);
      el.className = 'sb-n sb-n--' + b.tono + (b.n ? '' : ' sigso-oculto');
      var btn = el.closest('.sb-rb');
      if (btn) btn.setAttribute('aria-label', btn.getAttribute('data-tip') + etiquetaContador(b));
    });
    // Los fijados de ese módulo muestran el mismo número.
    if (fijadosVisibles().some(function (f) { return f.modulo === id && !f.item; })) pintar();
  }

  window.SigsoBarra = {
    iniciar: iniciar,
    actualizar: actualizar,
    badge: badge,
    visita: visita,
    tieneMenu: tieneMenu,
    // Para pruebas y para el buscador: lo que hoy se ve como fijado.
    fijados: function () { return fijadosVisibles(); },
    _secciones: secciones,
    MAX_FIJADOS: MAX_FIJADOS
  };
})();
