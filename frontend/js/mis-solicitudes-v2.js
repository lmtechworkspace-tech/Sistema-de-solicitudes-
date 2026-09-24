/**
 * mis-solicitudes-v2.js — Mis solicitudes v2 (SIGSO v2, Módulo 3C; análisis
 * y decisiones en documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 * Solo dentro de la plataforma: las páginas públicas (estado.html,
 * index.html) siguen con estado.js, que también queda un ciclo como versión
 * clásica de este módulo ("Volver a la versión clásica").
 *
 * Qué cambia:
 *  - La lista dice DE QUÉ trata cada solicitud (título del primer ítem) y
 *    cómo va cada ítem, sin abrirla (misSolicitudes ahora trae `items`).
 *  - "Te toca a ti": lo que espera una acción tuya (validar un ítem
 *    terminado, responder una pregunta del equipo) arriba de todo, a un clic.
 *  - El detalle se abre en un panel lateral (Ítems · Historial · Archivos)
 *    con las mismas acciones de siempre y los mismos endpoints públicos:
 *    responderConsulta, validarCierre (confirmar / reabrir / cerrar_directo),
 *    editarSubsolicitud, eliminarArchivo, subirArchivo.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var CLAVE_PREF = 'sigso_mis_solicitudes_v2';
  var CERRADOS = ['S09', 'S10', 'S11'];
  var EDITABLES = ['S01', 'S02', 'S03', 'S04'];
  var HITOS = ['Recibida', 'Aprobada', 'En desarrollo', 'Terminada', 'Cerrada'];
  var NIVEL = { S01: 0, S02: 0, S03: 1, S04: 1, S05: 2, S06: 2, S07: 2, S08: 3, S09: 4 };
  var TONO_CUMPLIMIENTO = {
    ATRASADA_DESARROLLADOR: 'critico', EN_RIESGO: 'alerta', ESPERANDO_VALIDACION: 'info',
    EN_PLAZO: 'ok', SIN_COMPROMISO: 'neutro', CERRADA_A_TIEMPO: 'ok', CERRADA_CON_ATRASO: 'critico'
  };
  var ACTOR = { tu: 'Tú', sistema: 'Sistema', equipo: 'El equipo' };

  var datos_ = null, turno_ = 0;
  var f = { vista: 'abiertas', texto: '', orden: 'recientes' };

  function intake(accion, datos) {
    return llamarApi(window.SIGSO_CONFIG.INTAKE_URL, accion, datos || {}).catch(function (e) {
      return { ok: false, message: (e && e.message) || 'No se pudo conectar con el servidor.' };
    });
  }
  function token() { try { return localStorage.getItem('sigso_portal_token') || ''; } catch (e) { return ''; } }
  function estadoTxt(c) { return window.formatearEstadoSigso ? formatearEstadoSigso(c) : c; }
  function tonoEstado(c) {
    if (c === 'S01' || c === 'S02') return 'info';
    if (c === 'S06') return 'alerta';
    if (c === 'S08') return 'primario';
    if (c === 'S09') return 'ok';
    if (c === 'S10' || c === 'S11') return 'neutro';
    return 'hito';
  }
  function tonoPrioridad(p) { return p === 'P1' ? 'critico' : (p === 'P2' ? 'alerta' : (p === 'P3' ? 'info' : 'neutro')); }
  function cerrada(s) { return CERRADOS.indexOf(s.estado_derivado) !== -1; }
  function teToca(s) { return (s.items_pendientes_validar || 0) + (s.items_esperan_respuesta || 0); }
  function fechaCorta(v) { return v ? PY.fecha(v, true) : ''; }
  function avisarCambio() { document.dispatchEvent(new CustomEvent('sigso:solicitudes-cambio')); }

  // --- Montaje ------------------------------------------------------------------------
  function seccion() { return document.getElementById('modulo-mis_solicitudes'); }
  function contenedor() {
    var s = seccion();
    if (!s) return null;
    var c = document.getElementById('mis-solicitudes-v2');
    if (!c) {
      c = document.createElement('div');
      c.id = 'mis-solicitudes-v2';
      c.className = 'sx2';
      s.appendChild(c);
    }
    s.classList.add('ms2-activa');
    return c;
  }
  function desmontar() {
    var s = seccion();
    if (s) s.classList.remove('ms2-activa');
    var c = document.getElementById('mis-solicitudes-v2');
    if (c) c.remove();
    datos_ = null;
  }

  // --- Carga --------------------------------------------------------------------------
  function cargar(silencioso) {
    var c = contenedor();
    if (!c) return Promise.resolve();
    var t = ++turno_;
    if (!silencioso || !datos_) c.innerHTML = '<div class="sx2-pagina">' + cabecera() + U.esqueleto('kpis', 4) + U.esqueleto('tabla', 6) + '</div>';
    return intake('misSolicitudes', { token: token() }).then(function (r) {
      if (t !== turno_) return;
      if (!r || !r.ok) {
        c.innerHTML = '<div class="sx2-pagina">' + cabecera() + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No pudimos cargar tus solicitudes',
          texto: (r && r.message) || 'Inténtalo de nuevo.', accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-ms2-recargar' }) }) }) + '</div>';
        return;
      }
      datos_ = r.data || { resumen: {}, solicitudes: [] };
      pintar(!!silencioso);
    });
  }

  // --- Pintado ------------------------------------------------------------------------
  function cabecera() {
    var correos = [];
    try { correos = (JSON.parse(localStorage.getItem('sigso_portal_cuenta') || '{}').emails) || []; } catch (e) { /* sin caché de cuenta */ }
    var puedeNueva = window.SigsoShell && SigsoShell.tieneModulo && SigsoShell.tieneModulo('nueva_solicitud');
    return '<header class="sx2-cabecera sx2-entra">' +
      '<div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Solicitudes</span><h1>Mis solicitudes</h1>' +
        '<span class="sx2-tenue" style="font-size:.875rem">Lo que pediste al equipo y cómo va' + (correos.length ? ' · ' + U.esc(correos.join(', ')) : '') + '.</span></div>' +
      '<div class="sx2-cabecera__acciones">' +
        U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-ms2-recargar' }) +
        (puedeNueva ? U.boton({ texto: 'Nueva solicitud', icono: 'nueva', variante: 'primario', clase: 'js-ms2-nueva' }) : '') +
      '</div>' +
    '</header>';
  }

  var VISTAS = [
    { id: 'abiertas', etiqueta: 'Abiertas', icono: 'bandeja', tono: 'primario', unidad: 'en curso', f: function (s) { return !cerrada(s); } },
    { id: 'te_toca', etiqueta: 'Te toca a ti', icono: 'rayo', tono: 'alerta', unidad: 'validar o responder', f: function (s) { return teToca(s) > 0; } },
    { id: 'cerradas', etiqueta: 'Cerradas', icono: 'check', tono: 'ok', unidad: 'terminadas o canceladas', f: cerrada },
    { id: 'todas', etiqueta: 'Todas', icono: 'lista', tono: 'neutro', unidad: 'desde el inicio', f: function () { return true; } }
  ];
  function vista(id) { return VISTAS.filter(function (v) { return v.id === id; })[0] || VISTAS[0]; }

  function kpis() {
    var ss = datos_.solicitudes || [];
    return '<div class="sx2-fila-kpis">' + VISTAS.map(function (v, i) {
      var n = v.id === 'te_toca' ? ss.reduce(function (a, s) { return a + teToca(s); }, 0) : ss.filter(v.f).length;
      return U.kpi({ i: i, icono: v.icono, tono: n || v.id === 'abiertas' ? v.tono : 'neutro', etiqueta: v.etiqueta, valor: n,
        unidad: v.id === 'te_toca' ? (n === 1 ? 'ítem espera tu acción' : 'ítems esperan tu acción') : v.unidad, filtro: v.id, activo: f.vista === v.id });
    }).join('') + '</div>';
  }

  // Lo que espera una acción tuya, ítem por ítem.
  function tarjetaTeToca() {
    var filas = [];
    (datos_.solicitudes || []).forEach(function (s) {
      (s.items || []).forEach(function (i) {
        if (i.estado === 'S08' || i.estado === 'S06') filas.push({ s: s, i: i });
      });
    });
    if (!filas.length) return '';
    return '<section class="sx2-card ms2-toca sx2-entra" style="--i:1">' +
      '<div class="sx2-card__cab"><h2 class="sx2-card__titulo"><span class="sx2-py-mt-ico sx2-tono-alerta">' + U.ico('rayo', 15) + '</span>Te toca a ti' +
        ' <span class="sx2-card__sub">' + filas.length + '</span></h2></div>' +
      '<ul class="sx2-py-mt-lista">' + filas.map(function (x, n) {
        var validar = x.i.estado === 'S08';
        return '<li class="sx2-py-mt-fila sx2-tono-' + (validar ? 'primario' : 'alerta') + ' sx2-entra" style="--i:' + Math.min(n + 2, 12) + '" data-ms2-sol="' + U.esc(x.s.solicitud_id) + '" data-ms2-item="' + U.esc(x.i.subsolicitud_id) + '" tabindex="0">' +
          '<span class="sx2-py-punto"></span>' +
          '<span class="sx2-apilado" style="gap:4px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(x.i.titulo) + '</strong>' +
            '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap"><span class="sx2-py-ref sx2-py-ref--sol">' + U.ico('lista', 12) + '<span class="sx2-cortar">' + U.esc(x.s.solicitud_id) + '</span></span>' +
            U.badge(validar ? 'Terminado: confirma si quedó resuelto' : 'El equipo te hizo una pregunta', validar ? 'primario' : 'alerta', true) + '</span></span>' +
          (validar && x.s.dias_esperando_max ? '<span class="sx2-py-mt-cuando">Esperando hace ' + x.s.dias_esperando_max + (x.s.dias_esperando_max === 1 ? ' día' : ' días') + '</span>' : '') +
          U.boton({ texto: validar ? 'Validar' : 'Responder', icono: validar ? 'check' : 'comentario', sm: true, variante: 'primario', clase: 'js-ms2-abrir' }) +
        '</li>';
      }).join('') + '</ul></section>';
  }

  function filtradas() {
    var q = f.texto.toLowerCase();
    var v = vista(f.vista);
    return (datos_.solicitudes || []).filter(function (s) {
      if (!v.f(s)) return false;
      if (q) {
        var t = [s.solicitud_id, s.empresa_nombre, s.titulo].concat((s.items || []).map(function (i) { return i.titulo; })).join(' ').toLowerCase();
        if (t.indexOf(q) === -1) return false;
      }
      return true;
    }).sort(function (a, b) {
      return f.orden === 'antiguas' ? new Date(a.fecha_creacion) - new Date(b.fecha_creacion) : new Date(b.fecha_creacion) - new Date(a.fecha_creacion);
    });
  }

  // Cómo van los ítems: "2 En desarrollo · 1 Terminada".
  function reparto(s) {
    var n = {}, orden = [];
    (s.items || []).forEach(function (i) { if (!n[i.estado]) { n[i.estado] = 0; orden.push(i.estado); } n[i.estado]++; });
    return orden.map(function (e) { return U.badge(n[e] + ' ' + estadoTxt(e), tonoEstado(e), true); }).join('');
  }
  function proximaFecha(s) {
    var fs = (s.items || []).filter(function (i) { return i.fecha_comprometida && CERRADOS.indexOf(i.estado) === -1; })
      .map(function (i) { return String(i.fecha_comprometida).slice(0, 10); }).sort();
    return fs[0] || '';
  }

  function fila(s, n) {
    var toca = teToca(s);
    var prox = proximaFecha(s);
    var multi = (s.items || []).length > 1;
    return '<li class="ms2-fila sx2-tono-' + tonoEstado(s.estado_derivado) + ' sx2-entra" style="--i:' + Math.min(n + 3, 12) + '" data-ms2-sol="' + U.esc(s.solicitud_id) + '" tabindex="0">' +
      '<span class="sx2-apilado ms2-fila__cuerpo">' +
        '<strong class="sx2-cortar">' + U.esc(s.titulo || '(sin título)') + (multi ? ' <span class="sx2-tenue">+ ' + (s.items.length - 1) + (s.items.length === 2 ? ' ítem más' : ' ítems más') + '</span>' : '') + '</strong>' +
        '<span class="sx2-flex ms2-fila__meta"><span class="bj2-id">' + U.esc(s.solicitud_id) + '</span><span>' + U.esc(s.empresa_nombre || '') + '</span><span>' + U.esc(fechaCorta(s.fecha_creacion)) + '</span></span>' +
        (multi ? '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + reparto(s) + '</span>' : '') +
      '</span>' +
      '<span class="ms2-fila__estado">' + U.badge(estadoTxt(s.estado_derivado), tonoEstado(s.estado_derivado)) +
        (toca ? U.badge(s.items_pendientes_validar ? 'Te toca validar' : 'Te toca responder', 'alerta', true) : '') + '</span>' +
      '<span class="ms2-fila__fecha">' + (prox ? '<small class="sx2-tenue">Entrega comprometida</small><span>' + U.esc(PY.fecha(prox, true)) + '</span>'
        : (cerrada(s) ? '' : '<small class="sx2-tenue">Sin fecha comprometida aún</small>')) + '</span>' +
      U.ico('derecha', 16) +
    '</li>';
  }

  function lista() {
    var ss = filtradas();
    var total = (datos_.solicitudes || []).length;
    var herramientas = '<div class="sx2-card sx2-py-herramientas sx2-entra" style="--i:2"><div class="sx2-barra-filtros">' +
      '<label class="sx2-buscar">' + U.ico('lupa', 16) + '<input class="sx2-input js-ms2-buscar" type="search" placeholder="Buscar por título, N° o empresa…" value="' + U.esc(f.texto) + '"></label>' +
      '<select class="sx2-select js-ms2-orden" aria-label="Ordenar"><option value="recientes"' + (f.orden === 'recientes' ? ' selected' : '') + '>Más recientes primero</option>' +
        '<option value="antiguas"' + (f.orden === 'antiguas' ? ' selected' : '') + '>Más antiguas primero</option></select>' +
    '</div></div>';
    if (!total) {
      return U.card({ i: 3, cuerpo: U.vacio({ icono: 'lista', titulo: 'No tienes solicitudes todavía',
        texto: 'Cuando pidas algo al equipo aparecerá aquí para que sigas cómo va.',
        accion: window.SigsoShell && SigsoShell.tieneModulo('nueva_solicitud') ? U.boton({ texto: 'Nueva solicitud', icono: 'nueva', variante: 'primario', clase: 'js-ms2-nueva' }) : '' }) });
    }
    return herramientas + (ss.length
      ? '<section class="sx2-card sx2-card--sin-relleno sx2-entra" style="--i:3"><ul class="ms2-lista">' + ss.map(fila).join('') + '</ul></section>'
      : U.card({ i: 3, cuerpo: U.vacio({ icono: 'lupa', titulo: 'Nada con estos filtros', texto: f.vista === 'te_toca' ? 'No hay nada esperando por ti. ¡Al día!' : 'Prueba otra búsqueda o mira "Todas".' }) }));
  }

  function pintar(silencioso) {
    var c = contenedor();
    if (!c || !datos_) return;
    var y = window.scrollY;
    c.innerHTML = '<div class="sx2-pagina">' + cabecera() + kpis() + tarjetaTeToca() + lista() + '</div>';
    if (silencioso) {
      c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; });
      window.scrollTo(0, y);
    }
    U.animar(c);
  }

  // --- Detalle en panel lateral ---------------------------------------------------------
  function abrirDetalle(solicitudId, subFoco) {
    var s0 = (datos_ && datos_.solicitudes || []).filter(function (s) { return s.solicitud_id === solicitudId; })[0];
    var email = (s0 && s0.email_coincidente) || '';
    var d = U.drawer({ titulo: solicitudId, subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Cargando…</span>', cuerpo: U.esqueleto('tabla', 6), pie: ' ' });
    d.el.classList.add('bj2-drawer', 'ms2-drawer');
    var det = null, pestana = 'items', abierto = {};

    function cargarDetalle() {
      return intake('consultarEstado', { solicitud_id: solicitudId, email: email }).then(function (r) {
        if (!r || !r.ok) { d.cuerpo(U.vacio({ icono: 'alerta', titulo: 'No se pudo abrir', texto: (r && r.message) || 'Inténtalo de nuevo.' })); return; }
        det = r.data;
        pintarDetalle();
      });
    }
    function recargarTodo() { cargarDetalle(); cargar(true); avisarCambio(); }

    function hitos(e) {
      if (e === 'S10' || e === 'S11') {
        return '<p class="ms2-aviso sx2-tono-neutro">' + U.ico('info', 15) + 'Esta solicitud fue ' + (e === 'S10' ? 'rechazada' : 'cancelada') + '. En cada ítem verás el motivo.</p>';
      }
      var nivel = NIVEL[e];
      if (nivel === undefined) return '';
      return '<ol class="ms2-hitos">' + HITOS.map(function (h, i) {
        var hecho = i < nivel || e === 'S09', actual = i === nivel && e !== 'S09';
        return '<li class="' + (hecho ? 'is-hecho' : (actual ? 'is-actual' : '')) + '"><span>' + (hecho ? U.ico('check', 12) : (i + 1)) + '</span>' + h + '</li>';
      }).join('') + '</ol>';
    }

    function pintarDetalle() {
      var subs = det.subsolicitudes || [];
      d.el.querySelector('.sx2-drawer__titulo').textContent = (subs[0] ? subs[0].titulo : solicitudId);
      var cab = d.el.querySelector('.sx2-drawer__fila-titulo .sx2-apilado');
      cab.querySelectorAll('.sx2-tenue, .bj2-det-sub').forEach(function (e) { e.remove(); });
      cab.insertAdjacentHTML('beforeend', '<span class="bj2-det-sub sx2-flex"><span class="bj2-id">' + U.esc(det.solicitud_id) + '</span>' +
        U.badge(estadoTxt(det.estado_derivado), tonoEstado(det.estado_derivado)) +
        '<span class="sx2-tenue" style="font-size:.8125rem">Ingresada el ' + U.esc(fechaCorta(det.fecha_creacion)) + '</span></span>');
      var nArch = subs.reduce(function (n, s) { return n + (s.archivos || []).length; }, 0);
      var tabs = [['items', 'Ítems (' + subs.length + ')'], ['historial', 'Historial'], ['archivos', 'Archivos (' + nArch + ')']];
      var pendientes = subs.filter(function (s) { return s.estado === 'S08' || s.pregunta_pendiente; }).length;
      var cuerpo = hitos(det.estado_derivado) +
        (pendientes ? '<p class="ms2-aviso sx2-tono-alerta">' + U.ico('rayo', 15) + (pendientes === 1 ? 'Un ítem espera' : pendientes + ' ítems esperan') + ' tu acción: está marcado abajo.</p>' : '') +
        (typeof det.posicion_cola === 'number' ? '<p class="sx2-tenue" style="margin:0;font-size:.8125rem">' + (det.posicion_cola > 0
          ? 'Hay ' + det.posicion_cola + (det.posicion_cola === 1 ? ' solicitud' : ' solicitudes') + ' de tu empresa con igual o mayor prioridad por delante.'
          : 'Es la solicitud de mayor prioridad en espera de tu empresa.') + '</p>' : '') +
        '<div class="sx2-tabs bj2-tabs" role="tablist">' + tabs.map(function (t) {
          return '<button type="button" class="sx2-tabs__op js-ms2-tab" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === pestana) + '">' + t[1] + '</button>';
        }).join('') + '</div>' +
        (pestana === 'historial' ? historial() : (pestana === 'archivos' ? archivos() : items(subs)));
      d.cuerpo(cuerpo);
      d.el.querySelector('.sx2-drawer__pie').innerHTML =
        (det.url_pdf ? '<a class="sx2-boton sx2-boton--secundario" href="' + U.esc(det.url_pdf) + '" target="_blank" rel="noopener">' + U.ico('documento', 16) + 'Documento PDF</a>' : '') +
        U.boton({ texto: 'Cerrar', clase: 'js-sx2-drawer-cerrar' });
    }

    function dato(et, v) { return v ? '<dt>' + U.esc(et) + '</dt><dd>' + U.esc(v) + '</dd>' : ''; }
    function items(subs) {
      return '<div class="sx2-apilado" style="gap:12px">' + subs.map(function (s) {
        var id = s.subsolicitud_id, acc = abierto[id] || '';
        var cump = s.cumplimiento;
        var foco = subFoco === id || s.estado === 'S08' || !!s.pregunta_pendiente;
        var abiertoItem = CERRADOS.indexOf(s.estado) === -1;
        var opciones = [];
        if (EDITABLES.indexOf(s.estado) !== -1) opciones.push(['editar', 'Corregir', 'editar']);
        if (abiertoItem && s.estado !== 'S08') opciones.push(['directo', 'Ya se resolvió por fuera', 'check']);
        return '<article class="bj2-item' + (foco ? ' bj2-item--foco' : '') + '" data-ms2-det="' + U.esc(id) + '">' +
          '<div class="sx2-entre" style="align-items:flex-start"><strong>' + (subs.length > 1 ? s.numero_item + '. ' : '') + U.esc(s.titulo) + '</strong>' +
            '<span class="sx2-flex" style="gap:6px;flex:none">' + U.badge(s.prioridad || '—', tonoPrioridad(s.prioridad), true) + U.badge(estadoTxt(s.estado), tonoEstado(s.estado)) + '</span></div>' +
          '<span class="sx2-flex sx2-tenue" style="gap:10px;flex-wrap:wrap;font-size:.8125rem">' +
            (s.tipo_nombre ? '<span>' + U.esc(s.tipo_nombre) + '</span>' : '') + (s.modulo_nombre ? '<span>' + U.esc(s.modulo_nombre) + '</span>' : '') +
            '<span>' + U.ico('calendario', 12) + ' ' + (s.fecha_comprometida ? 'Comprometida para el ' + U.esc(PY.fecha(s.fecha_comprometida, true))
              : (s.fecha_propuesta ? 'Pediste para el ' + U.esc(PY.fecha(s.fecha_propuesta, true)) + ' (a confirmar)' : 'Sin fecha comprometida aún')) + '</span>' +
            (cump && cump.etiqueta && abiertoItem ? U.badge(cump.etiqueta, TONO_CUMPLIMIENTO[cump.codigo] || 'neutro') : '') +
          '</span>' +
          (s.descripcion ? '<p class="sx2-py-descripcion" style="margin:0">' + U.esc(s.descripcion) + '</p>' : '') +
          (s.contexto || s.resultado_esperado ? '<details class="bj2-mas"><summary>Contexto y resultado esperado</summary>' +
            (s.contexto ? '<p><b>Contexto:</b> ' + U.esc(s.contexto) + '</p>' : '') + (s.resultado_esperado ? '<p><b>Resultado esperado:</b> ' + U.esc(s.resultado_esperado) + '</p>' : '') + '</details>' : '') +
          (s.pregunta_pendiente ? bloqueResponder(s) : '') +
          (s.estado === 'S08' ? bloqueValidar(s, acc === 'reabrir') : '') +
          (opciones.length ? '<div class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + opciones.map(function (o) {
            return U.chip({ texto: o[1], icono: o[2], activo: acc === o[0], clase: 'js-ms2-acc', datos: { id: id, acc: o[0] } });
          }).join('') + '</div>' : '') +
          (acc === 'editar' ? formEditar(s) : '') +
          (acc === 'directo' ? formDirecto(s) : '') +
        '</article>';
      }).join('') + '</div>';
    }
    function error() { return '<p class="sx2-campo__error js-ms2-error" hidden></p>'; }
    function bloqueResponder(s) {
      return '<form class="sx2-form bj2-item__form ms2-accion sx2-tono-alerta js-ms2-form" data-id="' + U.esc(s.subsolicitud_id) + '" data-acc="responder" novalidate>' +
        '<p class="ms2-pregunta">' + U.ico('comentario', 15) + '<span><b>El equipo necesita más información:</b> ' + U.esc(s.pregunta_pendiente) + '</span></p>' +
        PY.campo('Tu respuesta', '<textarea class="sx2-input" name="texto" maxlength="4000"></textarea>') + error() +
        '<div class="sx2-flex" style="justify-content:flex-end">' + U.boton({ texto: 'Enviar respuesta', icono: 'derecha', sm: true, variante: 'primario', tipo: 'submit' }) + '</div></form>';
    }
    function bloqueValidar(s, reabrir) {
      return '<form class="sx2-form bj2-item__form ms2-accion sx2-tono-primario js-ms2-form" data-id="' + U.esc(s.subsolicitud_id) + '" data-acc="' + (reabrir ? 'reabrir' : 'confirmar') + '" novalidate>' +
        '<p class="ms2-pregunta">' + U.ico('check', 15) + '<span><b>Este ítem está terminado.</b> Confírmalo si quedó resuelto, o cuéntanos qué falta.</span></p>' +
        (reabrir ? PY.campo('¿Qué falta?', '<textarea class="sx2-input" name="comentario" maxlength="2000" placeholder="Sé concreto: el equipo lo retomará con esto"></textarea>') : '') + error() +
        '<div class="sx2-flex" style="justify-content:flex-end;gap:6px">' +
          (reabrir
            ? U.boton({ texto: 'Volver', sm: true, clase: 'js-ms2-acc', datos: { id: s.subsolicitud_id, acc: 'reabrir' } }) + U.boton({ texto: 'Reabrir', icono: 'derecha', sm: true, variante: 'primario', tipo: 'submit' })
            : U.boton({ texto: 'No quedó resuelto', sm: true, clase: 'js-ms2-acc', datos: { id: s.subsolicitud_id, acc: 'reabrir' } }) + U.boton({ texto: 'Confirmar y cerrar', icono: 'check', sm: true, variante: 'primario', tipo: 'submit' })) +
        '</div></form>';
    }
    function formEditar(s) {
      var adj = (s.archivos || []).map(function (a) {
        return '<li class="sx2-entre"><span class="sx2-cortar">' + U.ico(/^image\//.test(a.tipo_mime || '') ? 'imagen' : 'documento', 14) + ' ' + U.esc(a.nombre_original || 'archivo') + '</span>' +
          U.boton({ texto: 'Quitar', sm: true, variante: 'fantasma', clase: 'js-ms2-quitar', datos: { archivo: a.archivo_id } }) + '</li>';
      }).join('');
      return '<form class="sx2-form bj2-item__form js-ms2-form" data-id="' + U.esc(s.subsolicitud_id) + '" data-acc="editar" novalidate>' +
        '<p class="sx2-tenue" style="margin:0;font-size:.8125rem">Corriges lo que enviaste. Antes de guardar verás qué cambia; el equipo ve el cambio registrado.</p>' +
        PY.campo('Título', '<input class="sx2-input" name="titulo" maxlength="200" value="' + U.esc(s.titulo || '') + '">') +
        PY.campo('Descripción', '<textarea class="sx2-input" name="descripcion" rows="4">' + U.esc(s.descripcion || '') + '</textarea>') +
        PY.campo('Contexto (opcional)', '<textarea class="sx2-input" name="contexto">' + U.esc(s.contexto || '') + '</textarea>') +
        PY.campo('Resultado esperado (opcional)', '<textarea class="sx2-input" name="resultado_esperado">' + U.esc(s.resultado_esperado || '') + '</textarea>') +
        (adj ? PY.campo('Adjuntos actuales', '<ul class="ms2-adjuntos">' + adj + '</ul>') : '') +
        PY.campo('Agregar imágenes (opcional)', '<input class="sx2-input" type="file" name="imagenes" accept="image/png,image/jpeg,image/gif" multiple>') + error() +
        '<div class="sx2-flex" style="justify-content:flex-end;gap:6px">' + U.boton({ texto: 'Cancelar', sm: true, clase: 'js-ms2-acc', datos: { id: s.subsolicitud_id, acc: 'editar' } }) +
          U.boton({ texto: 'Revisar y guardar', icono: 'check', sm: true, variante: 'primario', tipo: 'submit' }) + '</div></form>';
    }
    function formDirecto(s) {
      return '<form class="sx2-form bj2-item__form js-ms2-form" data-id="' + U.esc(s.subsolicitud_id) + '" data-acc="directo" novalidate>' +
        '<p class="sx2-tenue" style="margin:0;font-size:.8125rem">Si esto ya se solucionó (por ejemplo, por teléfono), ciérralo dejando registro de lo que pasó.</p>' +
        '<div class="sx2-form__fila">' + PY.campo('¿Quién lo resolvió?', '<input class="sx2-input" name="resuelto_por" maxlength="120">') +
          PY.campo('¿Cuándo?', '<input class="sx2-input" type="datetime-local" name="fecha_resolucion">') + '</div>' +
        PY.campo('¿Qué se hizo?', '<textarea class="sx2-input" name="detalle" maxlength="2000" placeholder="Al menos 10 caracteres"></textarea>') + error() +
        '<div class="sx2-flex" style="justify-content:flex-end;gap:6px">' + U.boton({ texto: 'Cancelar', sm: true, clase: 'js-ms2-acc', datos: { id: s.subsolicitud_id, acc: 'directo' } }) +
          U.boton({ texto: 'Registrar y cerrar', icono: 'check', sm: true, variante: 'primario', tipo: 'submit' }) + '</div></form>';
    }

    function historial() {
      var ev = det.historial || [];
      if (!ev.length) return U.vacio({ icono: 'reloj', texto: 'Sin movimientos todavía.' });
      var tit = {};
      (det.subsolicitudes || []).forEach(function (s) { tit[s.subsolicitud_id] = s.numero_item; });
      var multi = (det.subsolicitudes || []).length > 1;
      return '<ul class="sx2-lista" style="gap:0">' + ev.slice().sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); }).map(function (h) {
        return '<li class="sx2-py-sala-ev"><span class="bj2-act-ico sx2-tono-' + tonoEstado(h.estado_nuevo) + '" style="width:28px;height:28px;border-radius:9px">' + U.ico('estado', 13) + '</span>' +
          '<div class="sx2-apilado" style="gap:2px;flex:1;min-width:0"><span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' +
            '<strong style="font-size:.8125rem">' + U.esc(ACTOR[h.actor] || 'El equipo') + '</strong>' +
            '<span style="font-size:.8125rem">' + (h.estado_anterior ? U.esc(estadoTxt(h.estado_anterior)) + ' → ' : 'Ingresó en ') + U.esc(estadoTxt(h.estado_nuevo)) + '</span>' +
            (multi && tit[h.subsolicitud_id] ? U.badge('Ítem ' + tit[h.subsolicitud_id], 'neutro', true) : '') +
            '<span class="sx2-tenue" style="font-size:.75rem">' + U.esc(PY.haceTiempo(h.timestamp)) + '</span></span>' +
            (h.comentario ? '<p class="sx2-py-sala-ev__cuerpo">' + U.esc(h.comentario) + '</p>' : '') + '</div></li>';
      }).join('') + '</ul>';
    }

    function archivos() {
      var grupos = (det.subsolicitudes || []).filter(function (s) { return (s.archivos || []).length; });
      if (!grupos.length) return U.vacio({ icono: 'carpeta', titulo: 'Sin archivos', texto: 'No adjuntaste imágenes ni documentos. Puedes agregarlas con "Corregir" mientras el ítem no esté en desarrollo.' });
      return grupos.map(function (s) {
        return '<section class="sx2-seccion-drawer"><h3 class="sx2-seccion-drawer__titulo">' + U.esc(s.titulo || 'Ítem') + '</h3><ul class="bj2-archivos">' + s.archivos.map(function (a) {
          var img = /^image\//.test(a.tipo_mime || '');
          return '<li><a class="bj2-archivo" href="' + U.esc(a.url) + '" target="_blank" rel="noopener noreferrer">' +
            '<span class="bj2-archivo__ico sx2-tono-' + (img ? 'hito' : 'info') + '">' + U.ico(img ? 'imagen' : 'documento', 18) + '</span>' +
            '<span class="sx2-apilado" style="gap:2px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(a.nombre_original || 'Archivo') + '</strong>' +
            '<span class="sx2-tenue" style="font-size:.75rem">' + U.esc(PY.fecha(a.fecha_subida, true)) + (a.tamano_bytes ? ' · ' + Math.max(1, Math.round(Number(a.tamano_bytes) / 1024)) + ' KB' : '') + '</span></span>' +
            U.ico('derecha', 14) + '</a></li>';
        }).join('') + '</ul></section>';
      }).join('');
    }

    function leerBase64(file) {
      return new Promise(function (ok, mal) {
        var l = new FileReader();
        l.onload = function () { ok(String(l.result).split(',')[1] || ''); };
        l.onerror = mal;
        l.readAsDataURL(file);
      });
    }
    function subirImagenes(subId, files) {
      return [].slice.call(files || []).reduce(function (p, file) {
        return p.then(function () {
          return leerBase64(file).then(function (b64) {
            return intake('subirArchivo', { solicitud_id: solicitudId, subsolicitud_id: subId, nombre_archivo: file.name, contenido_base64: b64 });
          }).catch(function () { /* un adjunto fallido no frena los demás */ });
        });
      }, Promise.resolve());
    }
    // Resumen antes → después centrado en lo que cambió (si el cambio está al
    // final de un texto largo, recortar desde el inicio lo escondería).
    function diffCorto(a, b) {
      a = String(a || '').trim().replace(/\s+/g, ' ');
      b = String(b || '').trim().replace(/\s+/g, ' ');
      var p = 0;
      while (p < a.length && p < b.length && a[p] === b[p]) p++;
      var desde = p > 30 ? p - 20 : 0;
      var corta = function (t) { var x = t.slice(desde); return (desde ? '…' : '') + (x.length > 80 ? x.slice(0, 80) + '…' : x) || '(vacío)'; };
      return '"' + corta(a) + '" → "' + corta(b) + '"';
    }

    function enviar(form) {
      var id = form.getAttribute('data-id'), acc = form.getAttribute('data-acc');
      var s = (det.subsolicitudes || []).filter(function (x) { return x.subsolicitud_id === id; })[0];
      var err = form.querySelector('.js-ms2-error');
      function mal(m) { err.textContent = m; err.hidden = false; }
      var x = {};
      new FormData(form).forEach(function (v, k) { if (typeof v === 'string') x[k] = v.trim(); });
      var btn = form.querySelector('[type=submit]');
      function correr(accion, datos, exito) {
        btn.disabled = true;
        return intake(accion, Object.assign({ solicitud_id: solicitudId, subsolicitud_id: id, email: email }, datos)).then(function (r) {
          btn.disabled = false;
          if (!r || !r.ok) { mal((r && r.message) || 'No se pudo completar.'); return null; }
          return r;
        }).then(function (r) {
          if (!r) return;
          return Promise.resolve(exito ? exito() : null).then(function () { abierto[id] = ''; recargarTodo(); });
        });
      }
      if (acc === 'responder') {
        if (!x.texto) return mal('Escribe tu respuesta antes de enviar.');
        return correr('responderConsulta', { texto: x.texto }, function () { PY.aviso('Respuesta enviada al equipo.', 'exito'); });
      }
      if (acc === 'confirmar') {
        return correr('validarCierre', { accion: 'confirmar', comentario: '', atencion_directa: null }, function () { PY.aviso('Listo: ítem cerrado. ¡Gracias por confirmar!', 'exito'); });
      }
      if (acc === 'reabrir') {
        if (!x.comentario) return mal('Cuéntanos qué falta antes de reabrir.');
        return correr('validarCierre', { accion: 'reabrir', comentario: x.comentario, atencion_directa: null }, function () { PY.aviso('Reabierto: el equipo lo retoma con lo que indicaste.', 'exito'); });
      }
      if (acc === 'directo') {
        if (!x.resuelto_por || !x.fecha_resolucion || (x.detalle || '').length < 10) return mal('Completa quién lo resolvió, cuándo y qué se hizo (al menos 10 caracteres).');
        return correr('validarCierre', { accion: 'cerrar_directo', comentario: '', atencion_directa: { activo: true, resuelto_por: x.resuelto_por, fecha_resolucion: x.fecha_resolucion, detalle: x.detalle } },
          function () { PY.aviso('Cerrado con el registro de lo que pasó.', 'exito'); });
      }
      if (acc === 'editar') {
        if ((x.titulo || '').length < 3 || (x.descripcion || '').length < 5) return mal('El título y la descripción no pueden quedar vacíos.');
        var campos = [['titulo', 'Título'], ['descripcion', 'Descripción'], ['contexto', 'Contexto'], ['resultado_esperado', 'Resultado esperado']];
        var cambios = campos.filter(function (c) { return String(s[c[0]] || '').trim() !== x[c[0]]; });
        var files = form.querySelector('[name=imagenes]').files || [];
        if (!cambios.length && !files.length) return mal('No cambiaste nada todavía.');
        var resumen = cambios.map(function (c) { return c[1] + ': ' + diffCorto(s[c[0]], x[c[0]]); });
        if (files.length) resumen.push('+ ' + files.length + (files.length === 1 ? ' imagen nueva' : ' imágenes nuevas'));
        return U.confirmar({ titulo: '¿Confirmar corrección?', texto: resumen.join('\n'), boton: 'Confirmar corrección' }).then(function (si) {
          if (!si) return;
          return correr('editarSubsolicitud', { titulo: x.titulo, descripcion: x.descripcion, contexto: x.contexto, resultado_esperado: x.resultado_esperado },
            function () { return subirImagenes(id, files).then(function () { PY.aviso('Corrección guardada.', 'exito'); }); });
        });
      }
    }

    d.el.addEventListener('click', function (ev) {
      var t = ev.target, b;
      if ((b = t.closest('.js-ms2-tab'))) { pestana = b.getAttribute('data-tab'); pintarDetalle(); return; }
      if ((b = t.closest('.js-ms2-acc'))) {
        var id = b.getAttribute('data-id'), a = b.getAttribute('data-acc');
        abierto[id] = abierto[id] === a ? '' : a;
        pintarDetalle();
        return;
      }
      if ((b = t.closest('.js-ms2-quitar'))) {
        U.confirmar({ titulo: '¿Quitar este adjunto?', texto: 'Se elimina de tu solicitud.', boton: 'Quitar', peligro: true }).then(function (si) {
          if (!si) return;
          b.disabled = true;
          intake('eliminarArchivo', { solicitud_id: solicitudId, archivo_id: b.getAttribute('data-archivo'), email: email }).then(function (r) {
            if (!r || !r.ok) { b.disabled = false; PY.aviso((r && r.message) || 'No se pudo quitar el adjunto.', 'error'); return; }
            PY.aviso('Adjunto quitado.', 'exito');
            cargarDetalle();
          });
        });
      }
    });
    d.el.addEventListener('submit', function (ev) {
      if (!ev.target.classList.contains('js-ms2-form')) return;
      ev.preventDefault();
      enviar(ev.target);
    });

    cargarDetalle().then(function () {
      var foco = subFoco && d.el.querySelector('[data-ms2-det="' + subFoco + '"]');
      if (foco) foco.scrollIntoView({ block: 'nearest' });
    });
    return d;
  }

  // --- Eventos ------------------------------------------------------------------------
  var buscarT_ = null;
  document.addEventListener('click', function (ev) {
    var raiz = document.getElementById('mis-solicitudes-v2');
    if (!raiz || !raiz.contains(ev.target)) return;
    var t = ev.target, b;
    if (t.closest('.js-ms2-recargar')) { cargar(!!datos_); return; }
    if (t.closest('.js-ms2-nueva')) { if (window.SigsoShell) SigsoShell.irAModulo('nueva_solicitud'); return; }
    if (!datos_) return;
    if ((b = t.closest('.sx2-kpi[data-filtro]'))) { f.vista = b.getAttribute('data-filtro'); pintar(true); return; }
    if ((b = t.closest('[data-ms2-sol]'))) abrirDetalle(b.getAttribute('data-ms2-sol'), b.getAttribute('data-ms2-item') || '');
  });
  document.addEventListener('change', function (ev) {
    if (ev.target.classList && ev.target.classList.contains('js-ms2-orden')) { f.orden = ev.target.value; pintar(true); }
  });
  document.addEventListener('input', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('js-ms2-buscar')) return;
    var v = ev.target.value;
    clearTimeout(buscarT_);
    buscarT_ = setTimeout(function () {
      f.texto = v.trim();
      pintar(true);
      var n = document.querySelector('.js-ms2-buscar');
      if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    }, 220);
  });
  document.addEventListener('keydown', function (ev) {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('#mis-solicitudes-v2 [data-ms2-sol]')) { ev.preventDefault(); ev.target.click(); }
  });

  function activo() { try { return localStorage.getItem(CLAVE_PREF) !== '0'; } catch (e) { return true; } }
  function usarVersion(v2) {
    try { localStorage.setItem(CLAVE_PREF, v2 ? '1' : '0'); } catch (e) { /* sin storage: no se recuerda */ }
    document.dispatchEvent(new CustomEvent('sigso:v2-version', { detail: { modulo: 'mis_solicitudes', v2: !!v2 } }));
  }

  window.SigsoMisSolicitudesV2 = {
    cargar: function () { cargar(false); },
    refrescar: function () { cargar(true); },
    abrirSolicitud: function (id, subId) { return abrirDetalle(id, subId); },
    activo: activo, usarVersion: usarVersion, desmontar: desmontar
  };
})();
