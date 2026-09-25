/**
 * ui-v2.js — componentes del sistema visual v2 (clase raíz `.sx2`).
 *
 * Generadores de HTML (devuelven string, igual que Componentes en v1, para
 * encajar con el patrón de todo el frontend) + los pocos comportamientos que
 * necesitan JS: drawer, contadores animados y barras que se llenan al entrar.
 * No es de Proyectos: es la capa que después usará el resto de SIGSO.
 *
 * Depende de: Componentes.escaparHtml (components.js), Iconos (iconos.js) y,
 * si existe, SigsoPerfil (perfil.js) para las fotos de perfil.
 */
var UIv2 = (function () {
  'use strict';

  function esc(v) { return Componentes.escaparHtml(v === null || v === undefined ? '' : String(v)); }
  function ico(nombre, tam) { return Iconos.svg(nombre, { tam: tam || 16 }); }
  function tono(t) { return t ? ' sx2-tono-' + t : ''; }
  function datos(obj) {
    if (!obj) return '';
    return Object.keys(obj).map(function (k) {
      return obj[k] === undefined || obj[k] === null ? '' : ' data-' + k + '="' + esc(obj[k]) + '"';
    }).join('');
  }
  function limitarPct(p) { var n = Number(p); return isNaN(n) ? 0 : Math.max(0, Math.min(100, n)); }

  // --- Personas ------------------------------------------------------------
  function iniciales(nombre) {
    var partes = String(nombre || '?').trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return '?';
    return (partes[0].charAt(0) + (partes.length > 1 ? partes[partes.length - 1].charAt(0) : '')).toUpperCase();
  }
  // persona: { nombre, email, foto }. Sin foto explícita se busca en el
  // cache de SigsoPerfil (que llenó precargarFotos); si no hay, iniciales.
  function avatar(persona, tam) {
    persona = persona || {};
    var foto = persona.foto || (window.SigsoPerfil && persona.email ? SigsoPerfil.fotoDe(persona.email) : '');
    var nombre = persona.nombre || persona.email || '';
    return '<span class="sx2-avatar' + (tam ? ' sx2-avatar--' + tam : '') + '" title="' + esc(nombre) + '" aria-hidden="true">' +
      esc(iniciales(nombre)) +
      (foto ? '<img src="' + esc(foto) + '" alt="" loading="lazy" onerror="this.remove()">' : '') +
    '</span>';
  }
  function avatares(personas, max) {
    max = max || 4;
    var lista = personas || [];
    var visibles = lista.slice(0, max).map(function (p) { return avatar(p, 'sm'); }).join('');
    var resto = lista.length - max;
    var nombres = lista.map(function (p) { return p.nombre || p.email; }).join(', ');
    return '<span class="sx2-avatares" role="img" aria-label="' + esc(nombres) + '">' + visibles +
      (resto > 0 ? '<span class="sx2-avatar sx2-avatares__mas" title="' + resto + ' más">+' + resto + '</span>' : '') +
    '</span>';
  }
  function persona(p, tam) {
    p = p || {};
    return '<span class="sx2-persona">' + avatar(p, tam || 'sm') +
      '<span class="sx2-persona__txt">' +
        '<span class="sx2-persona__nombre">' + esc(p.nombre || p.email || 'Sin asignar') + '</span>' +
        (p.cargo ? '<span class="sx2-persona__cargo">' + esc(p.cargo) + '</span>' : '') +
      '</span>' +
    '</span>';
  }
  // Pide en una sola llamada las fotos de todos los correos que se van a
  // pintar. Devuelve una promesa; quien la usa repinta al resolverse.
  function precargarFotos(correos) {
    if (!window.SigsoPerfil || !SigsoPerfil.precargarFotos) return Promise.resolve();
    return SigsoPerfil.precargarFotos(correos);
  }

  // --- Indicadores -----------------------------------------------------------
  // o: { icono, tono, etiqueta, valor, unidad, tendencia: { texto, tono, icono },
  //      progreso (0-100), filtro, activo, i, titulo }
  function kpi(o) {
    o = o || {};
    var clic = !!o.filtro;
    var tag = clic ? 'button' : 'div';
    var esNumero = typeof o.valor === 'number' && isFinite(o.valor);
    var valorHtml = esNumero
      ? '<span data-sx-cifra="' + o.valor + '"' + (o.sufijo ? ' data-sx-sufijo="' + esc(o.sufijo) + '"' : '') + '>' + esc(o.valor) + esc(o.sufijo || '') + '</span>'
      : esc(o.valor === undefined || o.valor === null ? '—' : o.valor);
    return '<' + tag + ' class="sx2-kpi sx2-entra' + tono(o.tono) + (clic ? ' sx2-kpi--clic' : '') + (o.activo ? ' sx2-kpi--activo' : '') + '"' +
      ' style="--i:' + (o.i || 0) + '"' +
      (clic ? ' type="button"' + datos({ filtro: o.filtro }) + ' aria-pressed="' + (o.activo ? 'true' : 'false') + '"' : '') +
      (o.titulo ? ' title="' + esc(o.titulo) + '"' : '') + '>' +
      '<span class="sx2-kpi__cab">' +
        (o.icono ? '<span class="sx2-kpi__ico">' + ico(o.icono, 18) + '</span>' : '') +
        '<span class="sx2-kpi__etiqueta">' + esc(o.etiqueta) + '</span>' +
      '</span>' +
      '<span class="sx2-kpi__cuerpo">' +
        '<span><span class="sx2-kpi__valor">' + valorHtml + '</span>' +
          (o.unidad ? '<span class="sx2-kpi__unidad">' + esc(o.unidad) + '</span>' : '') +
        '</span>' +
        (o.tendencia ? '<span class="sx2-kpi__tendencia' + tono(o.tendencia.tono) + '">' +
          (o.tendencia.icono ? ico(o.tendencia.icono, 12) : '') + esc(o.tendencia.texto) + '</span>' : '') +
      '</span>' +
      (o.progreso !== undefined && o.progreso !== null ? barra(o.progreso, o.tono) : '') +
    '</' + tag + '>';
  }

  function barra(pct, t, gruesa) {
    return '<span class="sx2-barra' + (gruesa ? ' sx2-barra--gruesa' : '') + tono(t) + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(limitarPct(pct)) + '">' +
      '<span class="sx2-barra__relleno" data-sx-pct="' + limitarPct(pct) + '"></span>' +
    '</span>';
  }

  // Anillo de progreso SVG. o: { tam (px), grosor (px), tono, texto }
  function anillo(pct, o) {
    o = o || {};
    var tam = o.tam || 64, grosor = o.grosor || 7;
    var r = (tam - grosor) / 2, c = 2 * Math.PI * r;
    var p = limitarPct(pct);
    return '<span class="sx2-anillo' + tono(o.tono) + '" style="width:' + tam + 'px;height:' + tam + 'px" role="img" aria-label="' + Math.round(p) + '%">' +
      '<svg width="' + tam + '" height="' + tam + '" viewBox="0 0 ' + tam + ' ' + tam + '">' +
        '<circle class="sx2-anillo__pista" cx="' + (tam / 2) + '" cy="' + (tam / 2) + '" r="' + r + '" stroke-width="' + grosor + '"/>' +
        '<circle class="sx2-anillo__arco" cx="' + (tam / 2) + '" cy="' + (tam / 2) + '" r="' + r + '" stroke-width="' + grosor + '"' +
          ' stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + c.toFixed(2) + '" data-sx-arco="' + (c * (1 - p / 100)).toFixed(2) + '"/>' +
      '</svg>' +
      '<span class="sx2-anillo__txt">' + esc(o.texto !== undefined ? o.texto : Math.round(p) + '%') + '</span>' +
    '</span>';
  }

  function badge(texto, t, sinPunto) {
    return '<span class="sx2-badge' + tono(t) + (sinPunto ? ' sx2-badge--sin-punto' : '') + '">' + esc(texto) + '</span>';
  }

  // o: { texto, icono, tono, n, activo, clase, datos }
  function chip(o) {
    o = o || {};
    return '<button type="button" class="sx2-chip' + tono(o.tono) + (o.clase ? ' ' + o.clase : '') + '"' +
      ' aria-pressed="' + (o.activo ? 'true' : 'false') + '"' + datos(o.datos) + '>' +
      (o.icono ? ico(o.icono, 14) : '') + esc(o.texto) +
      (o.n !== undefined && o.n !== null ? '<span class="sx2-chip__n">' + esc(o.n) + '</span>' : '') +
    '</button>';
  }

  // o: { texto, icono, variante: primario|secundario|fantasma, sm, clase, datos, titulo, soloIcono, tipo }
  function boton(o) {
    o = o || {};
    var clases = 'sx2-boton sx2-boton--' + (o.variante || 'secundario') + (o.sm ? ' sx2-boton--sm' : '') +
      (o.soloIcono ? ' sx2-boton--icono' : '') + (o.clase ? ' ' + o.clase : '');
    return '<button type="' + (o.tipo || 'button') + '" class="' + clases + '"' + datos(o.datos) +
      (o.titulo ? ' title="' + esc(o.titulo) + '" aria-label="' + esc(o.titulo) + '"' : '') +
      (o.deshabilitado ? ' disabled' : '') + '>' +
      (o.icono ? ico(o.icono, o.sm ? 14 : 16) : '') + (o.soloIcono ? '' : esc(o.texto)) +
    '</button>';
  }

  // ops: [{ id, texto, icono }]
  function segmento(ops, activo, clase) {
    return '<span class="sx2-segmento" role="group">' + ops.map(function (op) {
      return '<button type="button" class="sx2-segmento__op' + (clase ? ' ' + clase : '') + '" data-id="' + esc(op.id) + '"' +
        ' aria-pressed="' + (op.id === activo ? 'true' : 'false') + '">' +
        (op.icono ? ico(op.icono, 15) : '') + esc(op.texto) + '</button>';
    }).join('') + '</span>';
  }

  // o: { titulo, icono, sub, accion: { texto, clase, datos }, cuerpo, clase, sinRelleno, i }
  function card(o) {
    o = o || {};
    var cab = (o.titulo || o.accion)
      ? '<div class="sx2-card__cab">' +
          '<h2 class="sx2-card__titulo">' + (o.icono ? ico(o.icono, 18) : '') + esc(o.titulo) +
            (o.sub ? ' <span class="sx2-card__sub">' + esc(o.sub) + '</span>' : '') + '</h2>' +
          (o.accion ? '<button type="button" class="sx2-enlace' + (o.accion.clase ? ' ' + o.accion.clase : '') + '"' + datos(o.accion.datos) + '>' +
            esc(o.accion.texto) + ico('derecha', 14) + '</button>' : '') +
        '</div>'
      : '';
    return '<section class="sx2-card sx2-entra' + (o.sinRelleno ? ' sx2-card--sin-relleno' : '') + (o.clase ? ' ' + o.clase : '') + '"' +
      ' style="--i:' + (o.i || 0) + '">' + cab + (o.cuerpo || '') + '</section>';
  }

  // o: { icono, titulo, texto, accion (html) }
  function vacio(o) {
    o = o || {};
    return '<div class="sx2-vacio">' +
      '<span class="sx2-vacio__ico">' + ico(o.icono || 'caja', 26) + '</span>' +
      (o.titulo ? '<h3>' + esc(o.titulo) + '</h3>' : '') +
      (o.texto ? '<p>' + esc(o.texto) + '</p>' : '') +
      (o.accion || '') +
    '</div>';
  }

  // Esqueleto de carga: tipo kpis | tarjetas | tabla.
  function esqueleto(tipo, n) {
    n = n || 4;
    var i, html = '';
    if (tipo === 'kpis') {
      for (i = 0; i < n; i++) html += '<div class="sx2-kpi"><span class="sx2-esq sx2-esq--texto" style="width:55%"></span><span class="sx2-esq sx2-esq--titulo" style="width:35%"></span></div>';
      return '<div class="sx2-fila-kpis">' + html + '</div>';
    }
    if (tipo === 'tabla') {
      for (i = 0; i < n; i++) html += '<span class="sx2-esq sx2-esq--texto" style="margin:14px 0;width:' + (60 + (i * 7) % 35) + '%"></span>';
      return '<div>' + html + '</div>';
    }
    for (i = 0; i < n; i++) html += '<div class="sx2-card sx2-col-4"><span class="sx2-esq sx2-esq--titulo"></span><span class="sx2-esq sx2-esq--texto" style="margin-top:14px"></span><span class="sx2-esq sx2-esq--texto" style="margin-top:8px;width:70%"></span></div>';
    return '<div class="sx2-grid">' + html + '</div>';
  }

  // --- Comportamiento ---------------------------------------------------------
  function reducirMovimiento() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // Tras insertar HTML: llena barras/anillos (transición CSS) y anima cifras.
  function animar(raiz) {
    if (!raiz) return;
    var sinMov = reducirMovimiento();
    requestAnimationFrame(function () {
      raiz.querySelectorAll('[data-sx-pct]').forEach(function (el) { el.style.width = el.getAttribute('data-sx-pct') + '%'; });
      raiz.querySelectorAll('[data-sx-arco]').forEach(function (el) { el.setAttribute('stroke-dashoffset', el.getAttribute('data-sx-arco')); });
    });
    raiz.querySelectorAll('[data-sx-cifra]').forEach(function (el) {
      var fin = Number(el.getAttribute('data-sx-cifra'));
      var sufijo = el.getAttribute('data-sx-sufijo') || '';
      if (sinMov || !isFinite(fin) || fin === 0) { el.textContent = fin + sufijo; return; }
      var decimales = Math.round(fin) === fin ? 0 : 1;
      var inicio = null, dur = 700;
      function paso(t) {
        if (inicio === null) inicio = t;
        var k = Math.min(1, (t - inicio) / dur);
        var suave = 1 - Math.pow(1 - k, 3);
        el.textContent = (fin * suave).toFixed(decimales) + sufijo;
        if (k < 1) requestAnimationFrame(paso);
      }
      requestAnimationFrame(paso);
    });
  }

  // Drawer (panel lateral). o: { titulo, subtitulo (html), cuerpo (html), pie (html),
  // cabeceraExtra (html), alCerrar }. Devuelve { el, cerrar, cuerpo(html) }.
  var drawerAbierto_ = null;
  function drawer(o) {
    o = o || {};
    if (drawerAbierto_) drawerAbierto_.cerrar(true);
    var el = document.createElement('div');
    el.className = 'sx2 sx2-drawer';
    el.innerHTML =
      '<div class="sx2-drawer__telon js-sx2-drawer-cerrar"></div>' +
      '<aside class="sx2-drawer__panel" role="dialog" aria-modal="true" aria-label="' + esc(o.titulo) + '">' +
        '<div class="sx2-drawer__cab">' +
          '<div class="sx2-drawer__fila-titulo">' +
            '<div class="sx2-apilado" style="gap:6px"><h2 class="sx2-drawer__titulo">' + esc(o.titulo) + '</h2>' + (o.subtitulo || '') + '</div>' +
            boton({ variante: 'fantasma', soloIcono: true, icono: 'equis', titulo: 'Cerrar', clase: 'js-sx2-drawer-cerrar' }) +
          '</div>' +
          (o.cabeceraExtra || '') +
        '</div>' +
        '<div class="sx2-drawer__cuerpo">' + (o.cuerpo || '') + '</div>' +
        (o.pie ? '<div class="sx2-drawer__pie">' + o.pie + '</div>' : '') +
      '</aside>';
    document.body.appendChild(el);
    var previoFoco = document.activeElement;
    var cerrado = false;

    function onKey(ev) { if (ev.key === 'Escape') api.cerrar(); }
    var api = {
      el: el,
      cuerpo: function (html) {
        var c = el.querySelector('.sx2-drawer__cuerpo');
        c.innerHTML = html;
        animar(c);
      },
      cerrar: function (inmediato) {
        if (cerrado) return;
        cerrado = true;
        document.removeEventListener('keydown', onKey);
        if (drawerAbierto_ === api) { drawerAbierto_ = null; document.body.classList.remove('sx2-con-drawer'); }
        function quitar() { if (el.parentNode) el.parentNode.removeChild(el); if (o.alCerrar) o.alCerrar(); }
        if (inmediato || reducirMovimiento()) { quitar(); }
        else {
          el.classList.add('sx2-drawer--saliendo');
          setTimeout(quitar, 220);
        }
        if (previoFoco && previoFoco.focus) { try { previoFoco.focus(); } catch (e) { /* elemento ya no existe */ } }
      }
    };
    el.addEventListener('click', function (ev) { if (ev.target.closest('.js-sx2-drawer-cerrar')) api.cerrar(); });
    document.addEventListener('keydown', onKey);
    drawerAbierto_ = api;
    // Los botones flotantes del shell (campana, interruptor) tapan el pie del drawer.
    document.body.classList.add('sx2-con-drawer');
    animar(el);
    var primero = el.querySelector('.sx2-drawer__panel button, .sx2-drawer__panel [tabindex]');
    if (primero) primero.focus();
    return api;
  }

  // Diálogo de confirmación centrado (reemplaza window.confirm y el modal v1).
  // o: { titulo, texto, boton, peligro }. Devuelve Promise<boolean>.
  function confirmar(o) {
    o = o || {};
    return new Promise(function (resolver) {
      var el = document.createElement('div');
      el.className = 'sx2 sx2-dialogo';
      el.innerHTML =
        '<div class="sx2-drawer__telon js-sx2-dlg-no"></div>' +
        '<div class="sx2-dialogo__caja" role="alertdialog" aria-modal="true" aria-label="' + esc(o.titulo) + '">' +
          '<span class="sx2-dialogo__ico' + tono(o.peligro ? 'critico' : 'primario') + '">' + ico(o.peligro ? 'alerta' : 'info', 20) + '</span>' +
          '<h2 class="sx2-dialogo__titulo">' + esc(o.titulo) + '</h2>' +
          (o.texto ? '<p class="sx2-dialogo__texto">' + esc(o.texto) + '</p>' : '') +
          '<div class="sx2-dialogo__acciones">' +
            boton({ texto: 'Cancelar', clase: 'js-sx2-dlg-no' }) +
            boton({ texto: o.boton || 'Confirmar', variante: o.peligro ? 'peligro' : 'primario', clase: 'js-sx2-dlg-si' }) +
          '</div>' +
        '</div>';
      document.body.appendChild(el);
      var previo = document.activeElement;
      function fin(v) {
        document.removeEventListener('keydown', onKey, true);
        if (el.parentNode) el.parentNode.removeChild(el);
        if (previo && previo.focus) { try { previo.focus(); } catch (e) { /* ya no existe */ } }
        resolver(v);
      }
      // En captura: que Escape cierre el diálogo y no el drawer de abajo.
      function onKey(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); fin(false); } }
      el.addEventListener('click', function (ev) {
        if (ev.target.closest('.js-sx2-dlg-si')) fin(true);
        else if (ev.target.closest('.js-sx2-dlg-no')) fin(false);
      });
      document.addEventListener('keydown', onKey, true);
      el.querySelector('.js-sx2-dlg-si').focus();
    });
  }

  // --- Formularios (SIGSO v2, R3) ---------------------------------------------
  // Campo con etiqueta: control es HTML (input/select/textarea con clase sx2-input).
  function campo(etiqueta, control, ayuda) {
    return '<label class="sx2-campo"><span class="sx2-campo__et">' + esc(etiqueta) + '</span>' + control +
      (ayuda ? '<span class="sx2-campo__ayuda">' + esc(ayuda) + '</span>' : '') + '</label>';
  }
  // Formulario en drawer, el patrón de todas las altas/ediciones v2 fuera de
  // Proyectos (que tiene el suyo, atado al proyecto abierto).
  // o: { titulo, subtitulo, campos (html), boton, ocupado, enviar(datos, form) -> Promise<{ok,...}>,
  //      preparar(datos, form) -> datos | 'error' | Promise, aviso, listo(r), alMontar(form, d), ancho }
  function formulario(o) {
    var d = drawer({
      titulo: o.titulo,
      subtitulo: o.subtitulo,
      cuerpo: '<form class="sx2-form js-sx2-form" novalidate>' + o.campos +
        '<p class="sx2-campo__error js-sx2-form-error" role="alert" hidden></p></form>',
      pie: '<span style="flex:1"></span>' + boton({ texto: 'Cancelar', clase: 'js-sx2-drawer-cerrar' }) +
        boton({ texto: o.boton || 'Guardar', icono: 'check', variante: 'primario', clase: 'js-sx2-form-ok' })
    });
    if (o.ancho) d.el.classList.add('sx2-drawer--ancho');
    var form = d.el.querySelector('.js-sx2-form');
    var err = d.el.querySelector('.js-sx2-form-error');
    var ok = d.el.querySelector('.js-sx2-form-ok');
    var textoOk = ok.innerHTML;
    function error(m) { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: 'nearest' }); }
    function ocupado(si) { ok.disabled = si; ok.innerHTML = si ? esc(o.ocupado || 'Guardando…') : textoOk; }
    function terminar(r) {
      ocupado(false);
      if (!r || !r.ok) { error((r && r.message) || 'No se pudo guardar.'); return; }
      d.cerrar();
      if (o.aviso && window.Componentes && Componentes.aviso) Componentes.aviso({ texto: typeof o.aviso === 'function' ? o.aviso(r) : o.aviso, tipo: 'exito' });
      if (o.listo) o.listo(r);
    }
    function enviar(ev) {
      if (ev) ev.preventDefault();
      if (ok.disabled) return;
      err.hidden = true;
      var datos = {};
      new FormData(form).forEach(function (v, k) { if (typeof v === 'string') datos[k] = v.trim(); });
      ocupado(true);
      Promise.resolve(o.preparar ? o.preparar(datos, form) : datos).then(function (listos) {
        if (typeof listos === 'string') { ocupado(false); error(listos); return; }
        return Promise.resolve(o.enviar(listos, form)).then(terminar, function (e) { terminar({ ok: false, message: (e && e.message) || 'No se pudo conectar.' }); });
      }, function (e) { ocupado(false); error((e && e.message) || 'No se pudo preparar el envío.'); });
    }
    form.addEventListener('submit', enviar);
    ok.addEventListener('click', enviar);
    if (o.alMontar) o.alMontar(form, d);
    var primero = form.querySelector('input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]), textarea, select');
    if (primero) primero.focus();
    return d;
  }
  // Lee un File como base64 (sin el prefijo data:...;base64,).
  function leerBase64(archivo) {
    return new Promise(function (resolver, rechazar) {
      var lector = new FileReader();
      lector.onload = function () { resolver(String(lector.result).slice(String(lector.result).indexOf(',') + 1)); };
      lector.onerror = function () { rechazar(new Error('No se pudo leer el archivo.')); };
      lector.readAsDataURL(archivo);
    });
  }

  return {
    campo: campo, formulario: formulario, leerBase64: leerBase64,
    confirmar: confirmar,
    esc: esc, ico: ico, datos: datos,
    iniciales: iniciales, avatar: avatar, avatares: avatares, persona: persona, precargarFotos: precargarFotos,
    kpi: kpi, barra: barra, anillo: anillo, badge: badge, chip: chip, boton: boton, segmento: segmento,
    card: card, vacio: vacio, esqueleto: esqueleto,
    animar: animar, drawer: drawer, reducirMovimiento: reducirMovimiento
  };
})();
