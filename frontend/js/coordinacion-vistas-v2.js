/**
 * coordinacion-vistas-v2.js — Coordinación de pausas: "Historial por
 * trabajador" y "Cumplimiento" en v2 (SIGSO v2, R4 del retiro de la versión
 * clásica; ver documentacion/SIGSO-v2-hoja-de-ruta.md). "Hoy" vive en
 * coordinacion-v2.js; ambas comparten el contenedor #coordinacion-v2.
 *
 * Este archivo también define window.SigsoCoordinacion (la API que usa el
 * shell: cargar, irAItem) y registra el árbol del sidebar: la plataforma ya
 * no carga coordinacion.js (clásico, queda solo para app.html).
 *
 *  - Historial: lista de personas con buscador y, al elegir una, su
 *    participación, rachas y una franja con cada día (participó, no pudo,
 *    sin registro, sin pausa ese día).
 *  - Cumplimiento: KPIs del periodo, clima emocional (con el detalle por
 *    persona), motivos de inasistencia, participación y rachas por área, PDF.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var ESTADO_DIA = {
    participo: ['Participó', 'ok'], no_participo: ['No pudo', 'alerta'],
    sin_registro: ['Sin registro', 'critico'], no_aplica: ['Sin pausa ese día', 'neutro']
  };
  var ARQUITECTURA = [
    { id: 'hoy', nombre: 'Hoy', icono: 'reloj', items: [{ id: 'hoy', nombre: 'Hoy' }] },
    { id: 'historial', nombre: 'Historial por trabajador', icono: 'persona', items: [{ id: 'historial', nombre: 'Historial por trabajador' }] },
    { id: 'reportes', nombre: 'Reportes', icono: 'grafico', plano: true, descripcion: 'Cumplimiento de las pausas',
      items: [{ id: 'reportes', nombre: 'Cumplimiento' }] }
  ];
  var vista_ = 'hoy', turno_ = 0;
  var roster_ = null, elegido_ = '', historial_ = {}, q_ = '', reporte_ = null;

  function api(accion, datos) {
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, accion, datos || {}).catch(function (e) {
      return { ok: false, message: (e && e.message) || 'No se pudo conectar.' };
    });
  }
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function fechaCorta(clave) {
    var k = String(clave || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return clave || '';
    var d = new Date(k + 'T12:00:00');
    return ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][d.getDay()] + ' ' + k.slice(8, 10) + '/' + k.slice(5, 7);
  }
  function periodo(p) { return p ? 'Del ' + PY.fecha(p.desde, true) + ' al ' + PY.fecha(p.hasta, true) : ''; }

  function registrarArbol() {
    if (!window.SigsoNav) return;
    SigsoNav.registrar('pausas_coordinacion', { nombre: 'Coordinación de pausas', submodulos: ARQUITECTURA });
    if (window.SigsoShell && SigsoShell.refrescarArbol) SigsoShell.refrescarArbol();
  }

  function contenedor() {
    var s = document.getElementById('modulo-pausas_coordinacion');
    if (!s) return null;
    var c = document.getElementById('coordinacion-v2');
    if (!c) {
      c = document.createElement('div');
      c.id = 'coordinacion-v2';
      c.className = 'sx2';
      s.appendChild(c);
    }
    s.classList.add('coord-v2-activa');
    return c;
  }
  function cabecera(titulo, sub, acciones) {
    return '<header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Coordinación de pausas</span><h1>' + U.esc(titulo) + '</h1>' +
      '<span class="sx2-tenue" style="font-size:.875rem">' + U.esc(sub) + '</span></div>' +
      '<div class="sx2-cabecera__acciones">' + (acciones || '') + U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-cv2-recargar' }) + '</div></header>';
  }
  function error(c, titulo, r) {
    c.innerHTML = '<div class="sx2-pagina">' + cabecera(titulo, '') + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar',
      texto: (r && r.message) || 'Inténtalo de nuevo.', accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-cv2-recargar' }) }) }) + '</div>';
  }
  function asentar(c, silencioso, y) {
    if (silencioso) {
      c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; });
      window.scrollTo(0, y);
    }
    U.animar(c);
  }

  // --- Historial por trabajador --------------------------------------------------------
  function cargarHistorial(silencioso) {
    var c = contenedor();
    if (!c) return;
    var t = ++turno_;
    if (!silencioso || !roster_) c.innerHTML = '<div class="sx2-pagina">' + cabecera('Historial por trabajador', 'Participación y rachas de cada persona.') + U.esqueleto('tarjetas', 2) + '</div>';
    api('listarRosterCoordinadorPausas', {}).then(function (r) {
      if (t !== turno_ || vista_ !== 'historial') return;
      if (!r || !r.ok) { error(c, 'Historial por trabajador', r); return; }
      roster_ = r.data;
      if (!elegido_ && roster_.roster && roster_.roster.length) elegido_ = roster_.roster[0].trabajador_id;
      pintarHistorial(!!silencioso);
      if (elegido_) cargarPersona(elegido_);
    });
  }
  function cargarPersona(id) {
    elegido_ = id;
    if (historial_[id]) { pintarHistorial(true); return; }
    pintarHistorial(true);
    api('getHistorialTrabajadorPausas', { trabajador_id: id }).then(function (r) {
      historial_[id] = r && r.ok ? r.data : { _error: (r && r.message) || 'No se pudo cargar.' };
      if (vista_ === 'historial' && elegido_ === id) pintarHistorial(true);
    });
  }
  function pintarHistorial(silencioso) {
    var c = contenedor();
    if (!c || !roster_ || vista_ !== 'historial') return;
    var y = window.scrollY;
    var foco = document.activeElement && document.activeElement.classList.contains('js-cv2-q');
    var gente = roster_.roster || [];
    if (roster_.sin_empresa || !gente.length) {
      c.innerHTML = '<div class="sx2-pagina">' + cabecera('Historial por trabajador', 'Participación y rachas de cada persona.') +
        U.card({ i: 1, cuerpo: U.vacio({ icono: 'persona', titulo: 'Sin personas en la lista', texto: roster_.sin_empresa ? 'No coordinas ninguna empresa.' : 'Todavía no hay trabajadores en la lista de pausas de tu(s) empresa(s).' }) }) + '</div>';
      asentar(c, silencioso, y);
      return;
    }
    var palabras = norm(q_).split(/\s+/).filter(Boolean);
    var visibles = gente.filter(function (p) {
      var h = norm([p.nombre, p.area, p.email].join(' '));
      return palabras.every(function (w) { return h.indexOf(w) !== -1; });
    });
    var lista = '<div class="cv2-roster">' +
      '<label class="dc2-buscar cv2-roster__buscar">' + U.ico('lupa', 16) + '<input type="search" class="js-cv2-q" placeholder="Buscar persona o área…" value="' + U.esc(q_) + '" aria-label="Buscar persona"></label>' +
      '<ul class="cv2-roster__lista">' + (visibles.length ? visibles.map(function (p) {
        var per = PY.persona(p.email, p.nombre);
        var h = historial_[p.trabajador_id];
        var pct = h && h.resumen && h.resumen.pct_participacion != null ? h.resumen.pct_participacion + '%' : '';
        return '<li><button type="button" class="cv2-persona js-cv2-persona' + (p.trabajador_id === elegido_ ? ' cv2-persona--activa' : '') + '" data-id="' + U.esc(p.trabajador_id) + '">' +
          U.avatar(per, 'sm') + '<span class="sx2-apilado" style="gap:1px;min-width:0;flex:1;text-align:left"><strong class="sx2-cortar">' + U.esc(per.nombre) + '</strong>' +
          '<span class="sx2-tenue sx2-cortar" style="font-size:.75rem">' + U.esc(p.area || p.empresa_id || '') + '</span></span>' +
          (pct ? '<span class="cv2-pct">' + pct + '</span>' : '') + '</button></li>';
      }).join('') : '<li class="sx2-tenue" style="padding:12px">Nadie coincide.</li>') + '</ul></div>';
    c.innerHTML = '<div class="sx2-pagina">' + cabecera('Historial por trabajador', 'Participación y rachas de cada persona, pausa por pausa.') +
      '<div class="sx2-grid sx2-grid--estira"><div class="sx2-col-4">' + U.card({ sinRelleno: true, i: 1, cuerpo: lista }) + '</div>' +
      '<div class="sx2-col-8">' + fichaPersona(historial_[elegido_]) + '</div></div></div>';
    if (foco) { var q = c.querySelector('.js-cv2-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
    asentar(c, silencioso, y);
  }
  function fichaPersona(h) {
    if (!elegido_) return U.card({ i: 2, cuerpo: U.vacio({ icono: 'persona', titulo: 'Elige una persona', texto: 'Su historial aparece aquí.' }) });
    if (!h) return U.card({ i: 2, cuerpo: U.esqueleto('kpis', 4) + U.esqueleto('tabla', 5) });
    if (h._error) return U.card({ i: 2, cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: h._error }) });
    var s = h.resumen || {};
    var per = PY.persona(h.trabajador.email, h.trabajador.nombre);
    var tono = s.pct_participacion == null ? 'neutro' : (s.pct_participacion >= 80 ? 'ok' : (s.pct_participacion >= 50 ? 'alerta' : 'critico'));
    var dias = (h.detalle || []).slice().sort(function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)); });
    var franja = dias.slice(0, 30).reverse().map(function (d) {
      var e = ESTADO_DIA[d.mi_estado] || [d.mi_estado, 'neutro'];
      return '<span class="cv2-dia sx2-tono-' + e[1] + '" title="' + U.esc(fechaCorta(d.fecha) + ' · ' + e[0] + (d.motivo ? ' (' + d.motivo + ')' : '')) + '"></span>';
    }).join('');
    return '<section class="sx2-card sx2-entra" style="--i:2"><div class="cv2-ficha__cab">' + U.avatar(per, 'lg') +
        '<div class="sx2-apilado" style="gap:2px;min-width:0"><strong class="cv2-ficha__nombre">' + U.esc(per.nombre) + '</strong>' +
        '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc([h.trabajador.area, periodo(h.periodo)].filter(Boolean).join(' · ')) + '</span></div></div>' +
      '<div class="sx2-fila-kpis cv2-kpis">' +
        U.kpi({ etiqueta: 'Participación', valor: s.pct_participacion == null ? '—' : s.pct_participacion, sufijo: s.pct_participacion == null ? '' : '%', icono: 'check', tono: tono, progreso: s.pct_participacion == null ? null : s.pct_participacion }) +
        U.kpi({ etiqueta: 'Racha actual', valor: s.racha_actual || 0, unidad: 'pausas', icono: 'tendencia', tono: 'primario' }) +
        U.kpi({ etiqueta: 'Racha máxima', valor: s.racha_maxima || 0, unidad: 'pausas', icono: 'diana', tono: 'info' }) +
        U.kpi({ etiqueta: 'Justificaciones', valor: s.justificaciones || 0, icono: 'comentario', tono: 'neutro' }) +
        U.kpi({ etiqueta: 'Sin registro', valor: s.sin_registro || 0, icono: 'alerta', tono: s.sin_registro ? 'critico' : 'ok' }) +
      '</div>' +
      (dias.length ? '<div class="sx2-seccion-drawer"><h3 class="sx2-seccion-drawer__titulo">Últimas ' + Math.min(30, dias.length) + ' pausas</h3><div class="cv2-franja">' + franja + '</div>' +
        '<div class="cv2-leyenda">' + Object.keys(ESTADO_DIA).map(function (k) { return '<span><i class="cv2-dia sx2-tono-' + ESTADO_DIA[k][1] + '"></i>' + ESTADO_DIA[k][0] + '</span>'; }).join('') + '</div></div>' +
        '<div class="sx2-tabla-wrap cv2-tabla"><table class="sx2-tabla"><thead><tr><th>Fecha</th><th>Estado</th><th>Motivo</th></tr></thead><tbody>' + dias.map(function (d) {
          var e = ESTADO_DIA[d.mi_estado] || [d.mi_estado, 'neutro'];
          return '<tr><td>' + U.esc(fechaCorta(d.fecha)) + '</td><td>' + U.badge(e[0], e[1]) + '</td><td class="sx2-tenue">' + U.esc(d.motivo || '') + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : U.vacio({ icono: 'calendario', titulo: 'Sin pausas resueltas en el periodo', texto: '' })) +
    '</section>';
  }

  // --- Cumplimiento ------------------------------------------------------------------------
  function cargarReporte(silencioso) {
    var c = contenedor();
    if (!c) return;
    var t = ++turno_;
    if (!silencioso || !reporte_) c.innerHTML = '<div class="sx2-pagina">' + cabecera('Cumplimiento', 'Cómo viene el programa de pausas.') + U.esqueleto('kpis', 5) + U.esqueleto('tarjetas', 3) + '</div>';
    api('getReporteCumplimientoPausas', {}).then(function (r) {
      if (t !== turno_ || vista_ !== 'reportes') return;
      if (!r || !r.ok) { error(c, 'Cumplimiento', r); return; }
      reporte_ = r.data;
      pintarReporte(!!silencioso);
    });
  }
  function pintarReporte(silencioso) {
    var c = contenedor();
    var d = reporte_;
    if (!c || !d || vista_ !== 'reportes') return;
    var y = window.scrollY;
    if (d.sin_empresa) {
      c.innerHTML = '<div class="sx2-pagina">' + cabecera('Cumplimiento', 'Cómo viene el programa de pausas.') +
        U.card({ i: 1, cuerpo: U.vacio({ icono: 'persona', titulo: 'No coordinas ninguna empresa', texto: 'Pide al administrador que te registre como coordinador(a) de pausas.' }) }) + '</div>';
      asentar(c, silencioso, y);
      return;
    }
    // Misma definición que Gerencia (reporte-pausas-v2.js), con el alcance de sus empresas.
    c.innerHTML = '<div class="sx2-pagina">' +
      cabecera('Cumplimiento', periodo(d.periodo), U.boton({ texto: 'Descargar PDF', icono: 'descargar', variante: 'primario', clase: 'js-cv2-pdf' })) +
      '<div class="sx2-card sx2-entra js-cv2-doc">' + SigsoReportePausas.cuerpo(d, { multiempresa: false }) + '</div></div>';
    asentar(c, silencioso, y);
  }
  // R-3: la tarjeta tal como se ve, impresa con Chromium en el servidor, con la cabecera
  // documental que en pantalla no lleva.
  function descargarPdf(b) {
    var doc = document.querySelector('.js-cv2-doc'), d = reporte_;
    if (!doc || !d || !window.SigsoReportes) return;
    SigsoReportes.descargarPdf(doc, { titulo: 'Cumplimiento de pausas activas', nombreArchivo: 'sigso-cumplimiento-pausas', boton: b,
      cabecera: SigsoReportes.cabeceraDocumento({ titulo: 'Cumplimiento de pausas activas', subtitulo: '¿Se están haciendo las pausas?', modulo: 'Coordinación de pausas',
        codigo: 'SIGSO-REP-PAU-CUMPLIMIENTO', periodo: d.periodo ? PY.fecha(d.periodo.desde, true) + ' al ' + PY.fecha(d.periodo.hasta, true) : '', generadoPor: (PY.miNombre && PY.miNombre()) || '' }) });
  }

  // --- Navegación ---------------------------------------------------------------------------
  function irA(v) {
    vista_ = v === 'historial' || v === 'reportes' ? v : 'hoy';
    registrarArbol();
    if (window.SigsoShell && SigsoShell.publicarItem) SigsoShell.publicarItem(vista_);
    if (vista_ === 'hoy') { if (window.SigsoCoordinacionV2) SigsoCoordinacionV2.mostrar(); return; }
    if (vista_ === 'historial') cargarHistorial(!!roster_ && !!document.getElementById('coordinacion-v2'));
    else cargarReporte(!!reporte_ && !!document.getElementById('coordinacion-v2'));
  }

  document.addEventListener('click', function (ev) {
    var raiz = document.getElementById('coordinacion-v2');
    if (!raiz || !raiz.contains(ev.target) || vista_ === 'hoy') return;
    var t = ev.target, b;
    if (t.closest('.js-cv2-recargar')) {
      if (vista_ === 'historial') { historial_ = {}; cargarHistorial(true); } else cargarReporte(true);
      return;
    }
    if ((b = t.closest('.js-cv2-persona'))) { cargarPersona(b.getAttribute('data-id')); return; }
    if ((b = t.closest('.js-cv2-pdf'))) descargarPdf(b);
  });
  var tq_ = null;
  document.addEventListener('input', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('js-cv2-q')) return;
    q_ = ev.target.value;
    clearTimeout(tq_);
    tq_ = setTimeout(function () { pintarHistorial(true); }, 150);
  });

  window.SigsoCoordinacion = {
    cargar: function () {
      var pedida = (window.SigsoShell && SigsoShell.tomarItemDeRuta) ? SigsoShell.tomarItemDeRuta() : '';
      irA(pedida || vista_);
    },
    irAItem: irA,
    // coordinacion-v2.js ("Hoy") pregunta si sigue siendo la vista activa antes de pintar.
    vista: function () { return vista_; }
  };
  registrarArbol();
})();
