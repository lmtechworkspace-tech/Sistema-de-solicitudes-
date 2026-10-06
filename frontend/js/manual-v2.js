/**
 * manual-v2.js — los manuales de uso de SIGSO, dentro de SIGSO (2026-10-06).
 *
 * Cada módulo tiene su manual paso a paso, con capturas de la empresa de
 * DEMOSTRACIÓN (datos ficticios: las imágenes se publican en el sitio) y
 * señales numeradas sobre cada captura. Se abre desde la portada del módulo
 * en la barra lateral («Manual de uso»), desde el menú de tu cuenta
 * («Manuales de uso», con todos los que te corresponden) y con F1.
 *
 * Contenido: manuales/indice.js (liviano, siempre cargado) dice qué manual
 * corresponde a cada módulo; el texto (manuales/<id>.js) y las señales de
 * cada captura (manuales/img/<id>/marcas.js) se bajan recién al abrirlo.
 *
 * Formato del texto: **negrita**, [[Botón]] (lo que dice un botón),
 * ((2)) (la señal 2 de la captura) y `texto exacto` (lo que se escribe).
 */
(function () {
  'use strict';

  var indice_ = [];
  var manuales_ = {};
  var marcas_ = {};
  var cargando_ = {};
  var abierto_ = null;
  var VERSION = '1';

  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ico(n, t) { return window.Iconos ? Iconos.svg(n, { tam: t || 18 }) : ''; }
  /** Texto con el formato de los manuales → HTML seguro. */
  function fmt(t) {
    return esc(t)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\[\[(.+?)\]\]/g, '<span class="mn-btn">$1</span>')
      .replace(/\(\((\d+)\)\)/g, '<span class="mn-num" data-n="$1">$1</span>')
      .replace(/`(.+?)`/g, '<code>$1</code>');
  }
  function parrafos(t) {
    if (!t) return '';
    return (Array.isArray(t) ? t : [t]).map(function (p) {
      if (Array.isArray(p)) return '<ul>' + p.map(function (li) { return '<li>' + fmt(li) + '</li>'; }).join('') + '</ul>';
      return '<p>' + fmt(p) + '</p>';
    }).join('');
  }

  // --- registro ---------------------------------------------------------------------------
  function indice(lista, version) { indice_ = lista || []; VERSION = version || VERSION; if (window.SigsoBarra && SigsoBarra.refrescar) SigsoBarra.refrescar(); }
  function registrar(def) { manuales_[def.id] = def; }
  function marcas(id, mapa) { marcas_[id] = mapa || {}; }
  function entrada(id) { return indice_.filter(function (m) { return m.id === id; })[0] || null; }
  /** El manual que corresponde a un módulo (o null). */
  function de(moduloId) { return indice_.filter(function (m) { return (m.modulos || []).indexOf(moduloId) !== -1; })[0] || null; }

  function cargarScript(src) {
    return new Promise(function (ok, mal) {
      var s = document.createElement('script');
      s.src = src + (src.indexOf('?') === -1 ? '?' : '&') + 'v=' + encodeURIComponent(VERSION);
      s.async = true;
      s.onload = ok; s.onerror = function () { mal(new Error('No se pudo cargar ' + src)); };
      document.head.appendChild(s);
    });
  }
  function cargar(id) {
    if (manuales_[id] && marcas_[id]) return Promise.resolve(manuales_[id]);
    if (cargando_[id]) return cargando_[id];
    cargando_[id] = Promise.all([
      manuales_[id] ? null : cargarScript('manuales/' + ((entrada(id) || {}).archivo || id) + '.js'),
      marcas_[id] ? null : cargarScript('manuales/img/' + id + '/marcas.js').catch(function () { marcas_[id] = {}; })
    ]).then(function () { delete cargando_[id]; return manuales_[id]; }, function (e) { delete cargando_[id]; throw e; });
    return cargando_[id];
  }

  // --- capturas con señales -----------------------------------------------------------------
  function figura(manualId, paso) {
    var key = paso.img;
    if (!key) return '';
    var m = (marcas_[manualId] || {})[key];
    if (!m) return ''; // sin captura (todavía): el paso se lee igual
    var w = m.w || 1600, h = m.h || 1000;
    var leyenda = paso.marcas || [];
    var senales = (m.marcas || []).map(function (s) {
      var txt = (leyenda.filter(function (l) { return l.n === s.n; })[0] || {}).t || '';
      return '<span class="mn-senal mn-senal--' + (s.forma || 'caja') + '" data-n="' + s.n + '" style="left:' + s.x + '%;top:' + s.y + '%;width:' + s.w + '%;height:' + s.h + '%"' +
        (txt ? ' title="' + esc(txt) + '"' : '') + '><b>' + s.n + '</b></span>';
    }).join('');
    // Capturas tomadas a 1,5x: nunca más grandes que su tamaño real (las angostas del menú quedaban gigantes).
    return '<figure class="mn-fig">' +
      '<button type="button" class="mn-fig__marco" data-mn-zoom aria-label="Ver la captura en grande" style="aspect-ratio:' + w + ' / ' + h + ';max-width:' + Math.round(w / 1.5) + 'px">' +
        '<img src="manuales/img/' + esc(manualId) + '/' + esc(key) + '.webp?v=' + esc(VERSION) + '" alt="' + esc(paso.alt || paso.titulo || '') + '" loading="lazy" width="' + w + '" height="' + h + '">' + senales +
        '<span class="mn-fig__lupa">' + ico('lupa', 14) + 'Ampliar</span></button>' +
      (leyenda.length ? '<ol class="mn-leyenda">' + leyenda.map(function (l) {
        // Una seña que no está en esta captura (por ejemplo, el asunto en un WhatsApp) se ve atenuada.
        var esta = (m.marcas || []).some(function (s) { return s.n === l.n; });
        return '<li data-n="' + l.n + '"' + (esta ? '' : ' class="mn-sin" title="No aparece en esta captura"') + '><span class="mn-num">' + l.n + '</span><span>' + fmt(l.t) + '</span></li>';
      }).join('') + '</ol>' : '') +
      (paso.pie ? '<figcaption>' + fmt(paso.pie) + '</figcaption>' : '') +
    '</figure>';
  }
  function aviso(tipo, texto) {
    if (!texto) return '';
    var T = { consejo: ['bombilla', 'Consejo'], ojo: ['alerta', 'Importante'], error: ['info', 'Si algo no resulta'] }[tipo];
    return '<aside class="mn-aviso mn-aviso--' + tipo + '">' + ico(T[0], 16) + '<div><strong class="mn-aviso__t">' + T[1] + '</strong>' + parrafos(texto) + '</div></aside>';
  }

  // --- vista del manual --------------------------------------------------------------------------
  function htmlManual(def, ent) {
    var caps = def.capitulos || [];
    var nPasos = caps.reduce(function (s, c) { return s + (c.pasos || []).length; }, 0);
    var toc = '<nav class="mn-toc" aria-label="Contenido"><p class="mn-toc__t">Contenido</p><ol>' + caps.map(function (c, i) {
      return '<li><a href="#" data-mn-cap="' + esc(c.id) + '"><span>' + (i + 1) + '</span>' + esc(c.titulo) + '</a></li>';
    }).join('') + '</ol><button type="button" class="mn-toc__todos" data-mn-centro>' + ico('libro', 14) + 'Todos los manuales</button></nav>';
    var portada = '<header class="mn-portada" style="--mn-c:' + (ent && ent.color || 'var(--sx-primario)') + '">' +
      '<span class="mn-portada__tile">' + ico((ent && ent.icono) || 'libro', 26) + '</span>' +
      '<div><p class="mn-ceja">Manual de uso</p><h1>' + esc(def.titulo) + '</h1>' + parrafos(def.resumen) +
      '<p class="mn-meta">' + (def.para ? '<span>' + ico('persona', 13) + esc(def.para) + '</span>' : '') +
        '<span>' + ico('reloj', 13) + esc(def.tiempo || Math.max(5, Math.round(nPasos * 0.8)) + ' min') + '</span>' +
        '<span>' + ico('check', 13) + caps.length + ' capítulos · ' + nPasos + ' pasos</span></p></div></header>';
    var antes = def.antes ? '<section class="mn-antes">' + ico('info', 18) + '<div><h2>Antes de empezar</h2>' + parrafos(def.antes) + '</div></section>' : '';
    var cuerpo = caps.map(function (c, i) {
      return '<section class="mn-cap" id="mn-cap-' + esc(c.id) + '" data-cap="' + esc(c.id) + '">' +
        '<div class="mn-cap__cab"><span class="mn-cap__n">' + (i + 1) + '</span><div><h2>' + esc(c.titulo) + '</h2>' + parrafos(c.intro) + '</div>' +
          (c.ruta ? '<button type="button" class="mn-ir" data-mn-ir="' + esc(c.ruta) + '">' + ico('derecha', 14) + 'Ir a esta pantalla</button>' : '') + '</div>' +
        (c.pasos || []).map(function (p, k) {
          return '<article class="mn-paso" data-busca="' + esc(((p.titulo || '') + ' ' + JSON.stringify(p.texto || '') + ' ' + JSON.stringify(p.marcas || '')).toLowerCase()) + '">' +
            '<div class="mn-paso__cab"><span class="mn-paso__n">' + (i + 1) + '.' + (k + 1) + '</span><h3>' + esc(p.titulo) + '</h3></div>' +
            parrafos(p.texto) + figura(def.id, p) + aviso('consejo', p.consejo) + aviso('ojo', p.ojo) + aviso('error', p.error) +
          '</article>';
        }).join('') + '</section>';
    }).join('');
    var faq = (def.preguntas || []).length ? '<section class="mn-cap mn-faq" id="mn-cap-preguntas"><div class="mn-cap__cab"><span class="mn-cap__n">?</span><div><h2>Preguntas frecuentes</h2></div></div>' +
      def.preguntas.map(function (q) { return '<details class="mn-preg"><summary>' + esc(q.p) + '</summary>' + parrafos(q.r) + '</details>'; }).join('') + '</section>' : '';
    return '<div class="mn-barra"><button type="button" class="mn-cerrar" data-mn-cerrar aria-label="Cerrar el manual">' + ico('izquierda', 16) + '<span>Volver a SIGSO</span></button>' +
      '<label class="mn-buscar">' + ico('lupa', 15) + '<input type="search" placeholder="Buscar en este manual" data-mn-buscar aria-label="Buscar en este manual"></label>' +
      '<span class="mn-barra__esp"></span><button type="button" class="mn-accion" data-mn-imprimir title="Imprimir o guardar en PDF">' + ico('imprimir', 15) + '<span>Imprimir / PDF</span></button></div>' +
      '<div class="mn-cuerpo">' + toc + '<main class="mn-art">' + portada + antes + cuerpo + faq +
        '<p class="mn-sinres" hidden>No hay pasos con esa búsqueda.</p>' +
        '<footer class="mn-pie">Las capturas son de una empresa de demostración: los clientes, RUT y personas que aparecen son ficticios.</footer></main></div>';
  }

  function contenedor() {
    var el = document.getElementById('mn-manual');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mn-manual';
      el.className = 'sx2 mn';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-label', 'Manual de uso');
      el.hidden = true;
      document.body.appendChild(el);
      el.addEventListener('click', alClic);
      el.addEventListener('input', alBuscar);
      el.addEventListener('mouseover', alResaltar);
      el.addEventListener('mouseout', alResaltar);
    }
    return el;
  }
  function mostrar(html, etiqueta) {
    var el = contenedor();
    el.innerHTML = html;
    el.setAttribute('aria-label', etiqueta || 'Manual de uso');
    if (el.hidden) { el.hidden = false; document.documentElement.classList.add('mn-abierto'); document.addEventListener('keydown', alTecla); }
    el.scrollTop = 0;
    var b = el.querySelector('[data-mn-cerrar]');
    if (b) b.focus();
  }
  function cerrar() {
    var el = document.getElementById('mn-manual');
    if (!el || el.hidden) return;
    el.hidden = true;
    el.innerHTML = '';
    abierto_ = null;
    document.documentElement.classList.remove('mn-abierto');
    document.removeEventListener('keydown', alTecla);
    cerrarZoom();
  }

  /** Abre el manual `id`; con `capId`, directo en ese capítulo. */
  function abrir(id, capId) {
    var ent = entrada(id);
    mostrar('<div class="mn-cargando">' + ico('libro', 22) + '<p>Abriendo el manual…</p></div>', 'Manual de uso');
    return cargar(id).then(function (def) {
      if (!def) throw new Error('Manual sin contenido');
      abierto_ = id;
      mostrar(htmlManual(def, ent), 'Manual de uso: ' + def.titulo);
      if (capId) irACap(capId);
    }).catch(function () {
      mostrar('<div class="mn-barra"><button type="button" class="mn-cerrar" data-mn-cerrar>' + ico('izquierda', 16) + '<span>Volver a SIGSO</span></button></div>' +
        '<div class="mn-cargando">' + ico('alerta', 22) + '<p>No se pudo abrir el manual. Revisa tu conexión e inténtalo de nuevo.</p></div>');
    });
  }
  /** Todos los manuales que corresponden a la cuenta (por sus módulos). */
  function centro(modulosCuenta) {
    var mios = modulosCuenta || (window.SigsoBarra && SigsoBarra.modulos ? SigsoBarra.modulos() : null);
    if (mios && !mios.length) mios = null; // sin datos de la cuenta todavía: se muestran todos
    var lista = indice_.filter(function (m) { return !mios || m.todos || (m.modulos || []).some(function (x) { return mios.indexOf(x) !== -1; }); });
    var grupos = {};
    var orden = [];
    lista.forEach(function (m) { var g = m.grupo || 'Manuales'; if (!grupos[g]) { grupos[g] = []; orden.push(g); } grupos[g].push(m); });
    mostrar('<div class="mn-barra"><button type="button" class="mn-cerrar" data-mn-cerrar aria-label="Cerrar">' + ico('izquierda', 16) + '<span>Volver a SIGSO</span></button></div>' +
      '<main class="mn-art mn-centro"><header class="mn-portada"><span class="mn-portada__tile">' + ico('libro', 26) + '</span><div><p class="mn-ceja">Centro de ayuda</p><h1>Manuales de uso</h1>' +
      '<p>Paso a paso, con capturas, de cada módulo que usas. También los abres desde cada módulo, con el botón <span class="mn-btn">Manual de uso</span> de la barra lateral, o con la tecla <kbd>F1</kbd>.</p></div></header>' +
      orden.map(function (g) {
        return '<h2 class="mn-centro__g">' + esc(g) + '</h2><div class="mn-centro__lista">' + grupos[g].map(function (m) {
          return '<button type="button" class="mn-tarjeta" data-mn-abrir="' + esc(m.id) + '" style="--mn-c:' + (m.color || 'var(--sx-primario)') + '"><span class="mn-tarjeta__tile">' + ico(m.icono || 'libro', 20) + '</span>' +
            '<span><b>' + esc(m.titulo) + '</b><small>' + esc(m.resumen || '') + '</small></span>' + ico('derecha', 16) + '</button>';
        }).join('') + '</div>';
      }).join('') + '<footer class="mn-pie">Las capturas son de una empresa de demostración: los clientes, RUT y personas que aparecen son ficticios.</footer></main>', 'Manuales de uso');
  }

  function irACap(capId) {
    var el = document.getElementById('mn-manual');
    var c = el && el.querySelector('#mn-cap-' + (window.CSS && CSS.escape ? CSS.escape(capId) : capId));
    if (c) c.scrollIntoView({ block: 'start', behavior: 'auto' });
  }

  // --- interacción ---------------------------------------------------------------------------
  function alClic(ev) {
    var b;
    if ((b = ev.target.closest('[data-mn-cerrar]'))) { cerrar(); return; }
    if ((b = ev.target.closest('[data-mn-cap]'))) { ev.preventDefault(); irACap(b.getAttribute('data-mn-cap')); return; }
    if ((b = ev.target.closest('[data-mn-abrir]'))) { abrir(b.getAttribute('data-mn-abrir')); return; }
    if (ev.target.closest('[data-mn-centro]')) { centro(); return; }
    if (ev.target.closest('[data-mn-imprimir]')) { imprimir(); return; }
    if ((b = ev.target.closest('[data-mn-ir]'))) { var r = b.getAttribute('data-mn-ir'); cerrar(); location.hash = r; return; }
    if ((b = ev.target.closest('[data-mn-zoom]'))) { zoom(b); return; }
  }
  function alTecla(ev) {
    if (ev.key !== 'Escape') return;
    if (document.querySelector('.mn-zoom')) { cerrarZoom(); return; }
    cerrar();
  }
  function alBuscar(ev) {
    if (!ev.target.matches('[data-mn-buscar]')) return;
    var q = ev.target.value.trim().toLowerCase();
    var el = document.getElementById('mn-manual');
    var vistos = 0;
    el.querySelectorAll('.mn-cap').forEach(function (c) {
      var algun = false;
      c.querySelectorAll('.mn-paso').forEach(function (p) { var si = !q || p.getAttribute('data-busca').indexOf(q) !== -1; p.hidden = !si; if (si) { algun = true; vistos++; } });
      c.hidden = !!q && !algun && !c.classList.contains('mn-faq');
    });
    var s = el.querySelector('.mn-sinres');
    if (s) s.hidden = !q || vistos > 0;
    var a = el.querySelector('.mn-antes'); if (a) a.hidden = !!q;
  }
  // Pasar sobre «2» en la leyenda (o en el texto) ilumina la señal 2 de su captura, y al revés.
  function alResaltar(ev) {
    var t = ev.target.closest('[data-n]');
    if (!t) return;
    var paso = t.closest('.mn-paso');
    if (!paso) return;
    var n = t.getAttribute('data-n');
    var on = ev.type === 'mouseover';
    paso.querySelectorAll('[data-n="' + n + '"]').forEach(function (x) { x.classList.toggle('mn-on', on); });
  }

  function zoom(marco) {
    var capa = document.createElement('div');
    capa.className = 'sx2 mn-zoom';
    capa.innerHTML = '<button type="button" class="mn-zoom__x" aria-label="Cerrar">' + ico('equis', 18) + '</button><div class="mn-zoom__in">' + marco.innerHTML + '</div>';
    capa.addEventListener('click', function (e) { if (e.target === capa || e.target.closest('.mn-zoom__x')) cerrarZoom(); });
    document.body.appendChild(capa);
    capa.querySelector('.mn-zoom__x').focus();
  }
  function cerrarZoom() { var z = document.querySelector('.mn-zoom'); if (z) z.remove(); }

  function imprimir() {
    // Las capturas se bajan antes de imprimir (carga diferida).
    var el = document.getElementById('mn-manual');
    var imgs = Array.prototype.slice.call(el.querySelectorAll('img'));
    imgs.forEach(function (i) { i.loading = 'eager'; });
    Promise.all(imgs.map(function (i) { return i.complete ? null : new Promise(function (r) { i.onload = i.onerror = r; }); })).then(function () { window.print(); });
  }

  // F1: el manual del módulo abierto.
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'F1' || abierto_) return;
    var shell = document.getElementById('vista-shell');
    if (!shell || shell.hidden) return;
    ev.preventDefault();
    var mod = window.SigsoBarra && SigsoBarra.moduloActivo ? SigsoBarra.moduloActivo() : '';
    var m = de(mod) || entrada('primeros-pasos');
    if (m) abrir(m.id); else centro();
  });

  window.SigsoManual = { indice: indice, registrar: registrar, marcas: marcas, de: de, abrir: abrir, centro: centro, cerrar: cerrar, _fmt: fmt };
})();
