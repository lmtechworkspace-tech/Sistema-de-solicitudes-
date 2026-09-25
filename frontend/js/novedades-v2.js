/**
 * novedades-v2.js — Novedades: "Publicadas" + lectura (SIGSO v2, Módulo 6A;
 * análisis y decisiones en documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 *  - Arriba, lo que te toca confirmar (acuse), ordenado por plazo.
 *  - La novedad se lee en un panel lateral y se confirma ahí ("Confirmo que
 *    la leí"); el mismo panel se abre desde el Inicio (decisión del dueño).
 *  - Quien la publicó ve quién falta, separando a quienes no tienen cuenta
 *    activa (no pueden acusar: no cuentan como incumplimiento).
 * Mismos endpoints (getFeedNovedades, getDetalleNovedad, marcarLeidaNovedad,
 * getLectoresNovedad, descargarAdjuntoNovedad). Publicar, Por aprobar, Mis
 * envíos y Cumplimiento siguen en novedades.js (6B los rehace).
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var TONO_TIPO = { LEY: 'critico', AVISO: 'alerta', LOGRO: 'ok', GENERAL: 'info' };
  var datos_ = null, turno_ = 0, filtro_ = '';

  function api(accion, datos) {
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, accion, datos || {}).catch(function (e) {
      return { ok: false, message: (e && e.message) || 'No se pudo conectar.' };
    });
  }
  function tonoTipo(n) { return TONO_TIPO[n.tipo] || 'info'; }
  function plazo(n) {
    if (n.dias_para_vencer === null || n.dias_para_vencer === undefined) return { txt: 'Sin plazo', tono: 'neutro' };
    var d = n.dias_para_vencer;
    if (d < 0) return { txt: 'Venció hace ' + (-d) + (d === -1 ? ' día' : ' días'), tono: 'critico' };
    if (d === 0) return { txt: 'Vence hoy', tono: 'critico' };
    if (d === 1) return { txt: 'Vence mañana', tono: 'alerta' };
    return { txt: 'Vence en ' + d + ' días', tono: 'info' };
  }
  function avisarLeida() {
    if (window.SigsoNovedades) {
      if (SigsoNovedades.invalidarFeed) SigsoNovedades.invalidarFeed();
      if (SigsoNovedades.actualizarBadge) SigsoNovedades.actualizarBadge();
    }
    document.dispatchEvent(new CustomEvent('sigso:novedad-leida'));
  }

  // --- Panel de lectura (módulo e Inicio) -----------------------------------------------
  function abrir(id) {
    var d = U.drawer({ titulo: 'Novedad', subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Cargando…</span>', cuerpo: U.esqueleto('tabla', 5), pie: ' ' });
    d.el.classList.add('bj2-drawer', 'nv2-drawer');
    var n = null, lect = null;

    function pintar(lectores) {
      d.el.querySelector('.sx2-drawer__titulo').textContent = n.titulo;
      var cab = d.el.querySelector('.sx2-drawer__fila-titulo .sx2-apilado');
      cab.querySelectorAll('.sx2-tenue, .bj2-det-sub').forEach(function (e) { e.remove(); });
      cab.insertAdjacentHTML('beforeend', '<span class="bj2-det-sub sx2-flex">' + U.badge(n.tipo_etiqueta || n.tipo, tonoTipo(n)) +
        (n.area_nombre ? U.badge(n.area_nombre, 'neutro', true) : '') +
        '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(PY.persona(n.autor_email, n.autor_nombre).nombre + ' · ' + PY.fecha(n.fecha_publicacion, true)) + '</span></span>');
      var p = plazo(n);
      var devuelta = n.estado === 'DEVUELTA' && n.es_autor;
      var cuerpo =
        (devuelta ? '<div class="nv2-acuse sx2-tono-alerta" style="flex-direction:column;align-items:flex-start"><span>' + U.ico('editar', 15) + ' Te la devolvieron para corregir.</span>' +
          '<span style="font-weight:400;color:var(--sx-texto)">Motivo: ' + U.esc(n.motivo_devolucion || '—') + '</span></div>' : '') +
        (n.requiere_acuse && n.estado === 'PUBLICADA' ? '<p class="nv2-acuse sx2-tono-' + (n.leida ? 'ok' : p.tono) + '">' + U.ico(n.leida ? 'check' : 'reloj', 15) +
          (n.leida ? 'Ya confirmaste que la leíste.' : 'Requiere que confirmes la lectura · ' + p.txt + '.') + '</p>' : '') +
        (n.resumen ? '<p class="nv2-resumen">' + U.esc(n.resumen) + '</p>' : '') +
        (n.cuerpo ? '<div class="nv2-cuerpo">' + U.esc(n.cuerpo) + '</div>' : '') +
        (n.fuente_url ? '<p class="nv2-fuente">' + U.ico('enlace', 14) + '<a class="sx2-enlace" href="' + U.esc(n.fuente_url) + '" target="_blank" rel="noopener noreferrer">Fuente oficial</a></p>' : '') +
        (n.tiene_adjunto ? '<button type="button" class="bj2-archivo js-nv2-adjunto" style="width:100%;text-align:left;background:none">' +
          '<span class="bj2-archivo__ico sx2-tono-info">' + U.ico('documento', 18) + '</span>' +
          '<span class="sx2-apilado" style="gap:2px;flex:1;min-width:0"><strong class="sx2-cortar">' + U.esc(n.archivo_nombre || 'Adjunto') + '</strong><span class="sx2-tenue" style="font-size:.75rem">Descargar</span></span>' + U.ico('descargar', 14) + '</button>' : '') +
        (lectores ? bloqueLectores(lectores) : '');
      d.cuerpo(cuerpo);
      d.el.querySelector('.sx2-drawer__pie').innerHTML = (devuelta && window.SigsoNovedades && SigsoNovedades.abrirReenviar
        ? U.boton({ texto: 'Corregir y reenviar', icono: 'editar', variante: 'primario', clase: 'js-nv2-reenviar' }) : '') +
        (n.requiere_acuse && !n.leida && n.estado === 'PUBLICADA'
        ? U.boton({ texto: 'Confirmo que la leí', icono: 'check', variante: 'primario', clase: 'js-nv2-confirmar' })
        : '') + U.boton({ texto: 'Cerrar', clase: 'js-sx2-drawer-cerrar' });
    }

    function bloqueLectores(l) {
      var conCuenta = l.pendientes.filter(function (p) { return !p.sin_cuenta; });
      var sinCuenta = l.pendientes.filter(function (p) { return p.sin_cuenta; });
      var total = l.leyeron.length + conCuenta.length;
      var pct = total ? Math.round(l.leyeron.length * 100 / total) : 0;
      var fila = function (p, extra) {
        var per = PY.persona(p.email, p.nombre);
        return '<li>' + U.avatar(per, 'xs') + '<span class="sx2-cortar">' + U.esc(per.nombre) + '</span>' + (extra || '') + '</li>';
      };
      return '<section class="sx2-seccion-drawer"><h3 class="sx2-seccion-drawer__titulo">Quién la leyó</h3>' +
        '<div class="sx2-flex" style="gap:12px;align-items:center">' + U.barra(pct, pct === 100 ? 'ok' : 'primario', true) +
          '<strong style="flex:none">' + l.leyeron.length + ' de ' + total + '</strong></div>' +
        (conCuenta.length ? '<p class="sx2-tenue" style="margin:0;font-size:.75rem">Faltan (' + conCuenta.length + '):</p><ul class="nv2-gente">' + conCuenta.map(function (p) {
          return fila(p, p.nunca_entro ? U.badge('Nunca entró a SIGSO', 'neutro', true) : '');
        }).join('') + '</ul>' : '<p class="sx2-tenue" style="margin:0">Todas las personas con cuenta la confirmaron.</p>') +
        (sinCuenta.length ? '<p class="sx2-tenue" style="margin:8px 0 0;font-size:.75rem">Sin cuenta activa en SIGSO — no pueden confirmar y no cuentan como pendientes (' + sinCuenta.length + '):</p>' +
          '<ul class="nv2-gente nv2-gente--sin">' + sinCuenta.map(function (p) { return fila(p); }).join('') + '</ul>' : '') +
      '</section>';
    }

    api('getDetalleNovedad', { novedad_id: id }).then(function (r) {
      if (!r || !r.ok) { d.cuerpo(U.vacio({ icono: 'alerta', titulo: 'No se pudo abrir', texto: (r && r.message) || 'Inténtalo de nuevo.' })); return; }
      n = r.data;
      pintar(lect);
      if (window.SigsoDirectorio && n.autor_email) SigsoDirectorio.resolver([n.autor_email]).then(function () { if (d.el.isConnected) pintar(lect); });
      if (n.puede_gestionar && n.requiere_acuse) {
        api('getLectoresNovedad', { novedad_id: id }).then(function (l) { if (l && l.ok) { lect = l.data; pintar(lect); } });
      }
    });

    d.el.addEventListener('click', function (ev) {
      var b;
      if ((b = ev.target.closest('.js-nv2-confirmar'))) {
        b.disabled = true;
        api('marcarLeidaNovedad', { novedad_id: id }).then(function (r) {
          if (!r || !r.ok) { b.disabled = false; PY.aviso((r && r.message) || 'No se pudo registrar el acuse.', 'error'); return; }
          PY.aviso('Lectura confirmada. ¡Gracias!', 'exito');
          n.leida = true;
          pintar(lect);
          avisarLeida();
        });
        return;
      }
      if (ev.target.closest('.js-nv2-reenviar')) { d.cerrar(true); SigsoNovedades.abrirReenviar(n); return; }
      if ((b = ev.target.closest('.js-nv2-adjunto'))) {
        b.disabled = true;
        api('descargarAdjuntoNovedad', { novedad_id: id }).then(function (r) {
          b.disabled = false;
          if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo descargar.', 'error'); return; }
          PY.descargarBase64(r.data.contenido_base64, r.data.nombre_archivo || 'adjunto.pdf', r.data.mime || 'application/pdf');
        });
      }
    });
    return d;
  }

  // --- Módulo: Publicadas -----------------------------------------------------------------
  function seccion() { return document.getElementById('modulo-novedades'); }
  function contenedor() {
    var s = seccion();
    if (!s) return null;
    var c = document.getElementById('novedades-v2');
    if (!c) {
      c = document.createElement('div');
      c.id = 'novedades-v2';
      c.className = 'sx2';
      s.appendChild(c);
    }
    s.classList.add('novedades-v2-activa');
    return c;
  }
  function desmontar() {
    var s = seccion();
    if (s) s.classList.remove('novedades-v2-activa');
    var c = document.getElementById('novedades-v2');
    if (c) c.remove();
  }
  function cargar(silencioso) {
    var c = contenedor();
    if (!c) return;
    var t = ++turno_;
    if (!silencioso || !datos_) c.innerHTML = '<div class="sx2-pagina">' + cabecera() + U.esqueleto('kpis', 3) + U.esqueleto('tabla', 5) + '</div>';
    api('getFeedNovedades', {}).then(function (r) {
      if (t !== turno_) return;
      if (!r || !r.ok) {
        c.innerHTML = '<div class="sx2-pagina">' + cabecera() + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudieron cargar las novedades',
          texto: (r && r.message) || 'Inténtalo de nuevo.', accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-nv2-recargar' }) }) }) + '</div>';
        return;
      }
      datos_ = r.data;
      pintar(!!silencioso);
      var correos = (datos_.recientes || []).map(function (n) { return n.autor_email; }).filter(Boolean);
      if (window.SigsoDirectorio && correos.length) SigsoDirectorio.resolver(correos).then(function () { if (t === turno_) pintar(true); });
    });
  }
  function puedePublicar() { return !!(window.SigsoNovedades && SigsoNovedades.puedePublicar && SigsoNovedades.puedePublicar()); }
  function cabecera() {
    return '<header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Mi espacio</span><h1>Novedades</h1>' +
      '<span class="sx2-tenue" style="font-size:.875rem">Leyes, avisos y novedades de todas las áreas.</span></div>' +
      '<div class="sx2-cabecera__acciones">' + U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-nv2-recargar' }) +
        (puedePublicar() ? U.boton({ texto: 'Publicar', icono: 'nueva', variante: 'primario', clase: 'js-nv2-publicar' }) : '') + '</div></header>';
  }
  function fila(n, i) {
    var p = plazo(n);
    var pendiente = n.requiere_acuse && !n.leida;
    return '<li class="nv2-fila' + (pendiente ? ' nv2-fila--pendiente' : '') + ' sx2-tono-' + tonoTipo(n) + ' sx2-entra" style="--i:' + Math.min(i + 3, 12) + '" data-nv2="' + U.esc(n.novedad_id) + '" tabindex="0">' +
      '<span class="sx2-apilado" style="gap:4px;min-width:0;flex:1">' +
        '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + U.badge(n.tipo_etiqueta || n.tipo, tonoTipo(n)) + (n.area_nombre ? U.badge(n.area_nombre, 'neutro', true) : '') +
          (n.tiene_adjunto ? '<span class="sx2-tenue" title="Tiene adjunto">' + U.ico('adjunto', 13) + '</span>' : '') + '</span>' +
        '<strong class="sx2-cortar">' + U.esc(n.titulo) + '</strong>' +
        (n.resumen ? '<span class="nv2-fila__resumen">' + U.esc(n.resumen) + '</span>' : '') +
        '<span class="sx2-tenue" style="font-size:.75rem">' + U.esc(PY.persona(n.autor_email, n.autor_nombre).nombre + ' · ' + PY.haceTiempo(n.fecha_publicacion)) + '</span>' +
      '</span>' +
      '<span class="nv2-fila__estado">' +
        (n.requiere_acuse
          ? (n.leida ? U.badge('Leída', 'ok') : U.badge(p.txt, p.tono))
          : '') +
        (pendiente ? U.boton({ texto: 'Leer y confirmar', icono: 'check', sm: true, variante: 'primario', clase: 'js-nv2-leer' }) : '') +
      '</span></li>';
  }
  function pintar(silencioso) {
    var c = contenedor();
    if (!c || !datos_) return;
    var y = window.scrollY;
    var todas = datos_.recientes || [];
    var pend = todas.filter(function (n) { return n.requiere_acuse && !n.leida; })
      .sort(function (a, b) { return (a.dias_para_vencer === null ? 99 : a.dias_para_vencer) - (b.dias_para_vencer === null ? 99 : b.dias_para_vencer); });
    var vencidas = pend.filter(function (n) { return n.dias_para_vencer !== null && n.dias_para_vencer < 0; }).length;
    var tipos = {};
    todas.forEach(function (n) { tipos[n.tipo] = n.tipo_etiqueta || n.tipo; });
    var lista = todas.filter(function (n) { return !filtro_ || n.tipo === filtro_; });
    var kpis = '<div class="sx2-fila-kpis">' +
      U.kpi({ i: 0, icono: 'check', tono: pend.length ? 'alerta' : 'ok', etiqueta: 'Por confirmar', valor: pend.length, unidad: pend.length === 1 ? 'espera tu lectura' : 'esperan tu lectura' }) +
      U.kpi({ i: 1, icono: 'alerta', tono: vencidas ? 'critico' : 'neutro', etiqueta: 'Plazo vencido', valor: vencidas, unidad: 'sin confirmar' }) +
      U.kpi({ i: 2, icono: 'campana', tono: 'primario', etiqueta: 'Publicadas', valor: todas.length, unidad: 'para ti' }) +
    '</div>';
    var porConfirmar = pend.length ? '<section class="sx2-card nv2-toca sx2-entra" style="--i:2"><div class="sx2-card__cab"><h2 class="sx2-card__titulo">' +
      '<span class="sx2-py-mt-ico sx2-tono-alerta">' + U.ico('check', 15) + '</span>Te falta confirmar <span class="sx2-card__sub">' + pend.length + '</span></h2></div>' +
      '<ul class="nv2-lista">' + pend.map(fila).join('') + '</ul></section>' : '';
    var chips = Object.keys(tipos).length > 1 ? '<div class="sx2-chips sx2-entra" style="--i:3">' + U.chip({ texto: 'Todas', activo: !filtro_, clase: 'js-nv2-tipo', datos: { tipo: '' } }) +
      Object.keys(tipos).map(function (t) { return U.chip({ texto: tipos[t], activo: filtro_ === t, clase: 'js-nv2-tipo', datos: { tipo: t } }); }).join('') + '</div>' : '';
    var todasHtml = lista.length
      ? '<section class="sx2-card sx2-card--sin-relleno sx2-entra" style="--i:4"><ul class="nv2-lista">' + lista.map(fila).join('') + '</ul></section>'
      : U.card({ i: 4, cuerpo: U.vacio({ icono: 'campana', titulo: 'Sin novedades', texto: filtro_ ? 'No hay de este tipo.' : 'Cuando se publique algo para ti, aparecerá aquí.' }) });
    c.innerHTML = '<div class="sx2-pagina">' + cabecera() + kpis + porConfirmar + chips + todasHtml + '</div>';
    if (silencioso) {
      c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; });
      window.scrollTo(0, y);
    }
    U.animar(c);
  }

  // --- Eventos ------------------------------------------------------------------------
  document.addEventListener('click', function (ev) {
    var t = ev.target, b;
    // Filas de novedades pendientes en el Inicio (fuera del módulo).
    if ((b = t.closest && t.closest('[data-nv2-inicio]'))) { abrir(b.getAttribute('data-nv2-inicio')); return; }
    var raiz = document.getElementById('novedades-v2');
    if (!raiz || !raiz.contains(t)) return;
    if (t.closest('.js-nv2-recargar')) { cargar(!!datos_); return; }
    if (t.closest('.js-nv2-publicar')) { if (window.SigsoNovedades && SigsoNovedades.abrirPublicar) SigsoNovedades.abrirPublicar(); return; }
    if ((b = t.closest('.js-nv2-tipo'))) { filtro_ = b.getAttribute('data-tipo') || ''; pintar(true); return; }
    if ((b = t.closest('[data-nv2]'))) abrir(b.getAttribute('data-nv2'));
  });
  document.addEventListener('keydown', function (ev) {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('#novedades-v2 [data-nv2], [data-nv2-inicio]')) { ev.preventDefault(); ev.target.click(); }
  });
  document.addEventListener('sigso:novedad-leida', function () {
    var c = document.getElementById('novedades-v2');
    if (c && c.offsetParent !== null) cargar(true);
  });

  // 2026-09-25: la versión clásica se retiró; la v2 es la única.
  function activo() { return true; }
  function usarVersion() { /* sin versión clásica */ }

  window.SigsoNovedadesV2 = {
    mostrar: function () { cargar(!!datos_ && !!document.getElementById('novedades-v2')); },
    cargar: function () { if (window.SigsoNovedades) SigsoNovedades.irAItem('feed'); },
    refrescar: function () { cargar(true); },
    abrir: abrir,
    // Para el Inicio: filas de novedades por confirmar.
    filasInicio: function (lista) {
      return (lista || []).map(function (n) {
        var p = plazo(n);
        return '<li class="sx2-py-mt-fila sx2-tono-' + p.tono + '" data-nv2-inicio="' + U.esc(n.novedad_id) + '" tabindex="0"><span class="sx2-py-punto"></span>' +
          '<span class="sx2-apilado" style="gap:4px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(n.titulo) + '</strong>' +
          '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + U.badge(n.tipo_etiqueta || n.tipo, tonoTipo(n)) + '<span class="sx2-tenue" style="font-size:.75rem">' + U.esc(PY.persona(n.autor_email, n.autor_nombre).nombre) + '</span></span></span>' +
          '<span class="sx2-py-mt-cuando' + (p.tono === 'critico' ? ' sx2-delta--mal' : '') + '">' + U.esc(p.txt) + '</span>' +
          U.boton({ texto: 'Leer', icono: 'ojo', sm: true, variante: 'primario' }) + '</li>';
      }).join('');
    },
    activo: activo, usarVersion: usarVersion, desmontar: desmontar
  };
})();
