/**
 * jefatura-vistas-v2.js — Mi departamento 100 % v2 (SIGSO v2, R5 del retiro
 * de la versión clásica; ver documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 * "Mi equipo hoy" (las personas) vive en jefatura-v2.js; aquí están el
 * resto de las vistas, que comparten el contenedor #jefatura-v2:
 *  - Solicitudes del equipo: KPIs, lo que pasó hoy, filtros rápidos y tabla;
 *    cada solicitud se abre en el panel lateral de la Bandeja v2.
 *  - Por persona: qué reportó y qué tiene asignado cada integrante.
 *  - Actividades del equipo: semáforo, pedir actualización y reasignar.
 *  - Reportes (motor v2) y Carga por módulo y tipo.
 * Mismos endpoints (getPanelJefatura, panelEquipoActividades,
 * pedirActualizacionActividad, reasignarActividad). Define
 * window.SigsoJefatura: la plataforma ya no carga jefatura.js (queda para app.html).
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var TONO_CUMPL = {
    ATRASADA_DESARROLLADOR: 'critico', EN_RIESGO: 'alerta', ESPERANDO_VALIDACION: 'info', EN_PLAZO: 'ok',
    SIN_COMPROMISO: 'neutro', CERRADA_A_TIEMPO: 'ok', CERRADA_CON_ATRASO: 'critico'
  };
  var CERRADOS = ['S09', 'S10', 'S11'];
  var TONO_ACT = { atrasada: 'critico', riesgo: 'alerta', bloqueada: 'info', pendiente: 'neutro', revision: 'primario', 'al-dia': 'ok', terminada: 'ok', cancelada: 'neutro' };
  var ORDEN_ACT = { atrasada: 0, riesgo: 1, bloqueada: 2, pendiente: 3, revision: 4, 'al-dia': 5, terminada: 6, cancelada: 7 };
  var TAMANO = { S: 'Chica', M: 'Mediana', L: 'Grande', XL: 'Muy grande' };
  var VISTAS = {
    tablero: ['Solicitudes del equipo', 'Lo que tu equipo pidió y lo que tiene a cargo.'],
    persona: ['Por persona', 'Qué reportó y qué tiene asignado cada integrante.'],
    actividades: ['Actividades del equipo', 'Tareas de tu equipo, con las que necesitan atención primero.'],
    reportes: ['Reportes del departamento', 'Desempeño de tu equipo con la misma regla que usa Gerencia.'],
    carga: ['Carga por módulo y tipo', 'Qué se repite en el trabajo de tu equipo.']
  };
  var ARQUITECTURA = [
    { id: 'hoy', nombre: 'Personas', icono: 'equipo', items: [{ id: 'resumen', nombre: 'Mi equipo hoy' }] },
    { id: 'equipo', nombre: 'Mi equipo', icono: 'persona', items: [
      { id: 'tablero', nombre: 'Solicitudes del equipo' }, { id: 'persona', nombre: 'Por persona' }, { id: 'actividades', nombre: 'Actividades del equipo' }
    ] },
    { id: 'reportes', nombre: 'Reportes', icono: 'grafico', descripcion: 'Desempeño de tu equipo', items: [
      { id: 'reportes', nombre: 'Centro de reportes' }, { id: 'carga', nombre: 'Carga por módulo y tipo' }
    ] }
  ];
  var CAMPOS_FILTRO = { responsable: { valor: 'desarrollador_asignado', texto: 'desarrollador_nombre' } };
  var REPORTES = [
    { grupo: 'Cumplimiento', icono: 'escudo', reportes: [
      { id: 'jef-responsable', nombre: 'Cumplimiento por persona', tipo: 'RANKING', estado: 'LISTO', desc: 'Entregas a tiempo de cada integrante, sobre lo que ya cerró.', fuente: 'getPanelJefatura', filtros: ['periodo'], etiquetaPeriodo: 'Ítems creados en', campos: CAMPOS_FILTRO },
      { id: 'jef-modulo', nombre: 'Cumplimiento por módulo', tipo: 'CUMPLIMIENTO', estado: 'LISTO', desc: 'Qué módulos del sistema concentran los atrasos del equipo.', fuente: 'getPanelJefatura', filtros: ['periodo', 'responsable'], etiquetaPeriodo: 'Ítems creados en', campos: CAMPOS_FILTRO },
      { id: 'jef-tipo', nombre: 'Cumplimiento por tipo', tipo: 'CUMPLIMIENTO', estado: 'LISTO', desc: 'Si el atraso se concentra en errores, mejoras o alguna otra clase.', fuente: 'getPanelJefatura', filtros: ['periodo', 'responsable'], etiquetaPeriodo: 'Ítems creados en', campos: CAMPOS_FILTRO },
      { id: 'jef-resbalon', nombre: 'Resbalón de compromisos', tipo: 'DETALLE', estado: 'LISTO', desc: 'Ítems de tu equipo que movieron su fecha comprometida, y cuántas veces se reabrieron.', fuente: 'getPanelJefatura', filtros: ['periodo', 'responsable'], etiquetaPeriodo: 'Ítems creados en', campos: CAMPOS_FILTRO }
    ] },
    { grupo: 'Evolución', icono: 'grafico', reportes: [
      { id: 'jef-throughput', nombre: 'Entrada vs salida por mes', tipo: 'TENDENCIA', estado: 'LISTO', desc: 'Cuánto entra y cuánto cierra tu equipo cada mes.', fuente: 'getPanelJefatura', filtros: [] },
      { id: 'jef-carga', nombre: 'Carga por módulo y tipo', tipo: 'RANKING', estado: 'LISTO', desc: 'Qué se repite en tu equipo.', fuente: 'getPanelJefatura', seccion: 'carga' }
    ] }
  ];

  var vista_ = 'resumen', turno_ = 0;
  var panel_ = null, actividades_ = null, filtro_ = '', q_ = '';
  var reporteAbierto_ = null, filtrosRep_ = {}, panelRep_ = null, personasConocidas_ = [];

  function api(accion, datos) {
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, accion, datos || {}).catch(function (e) {
      return { ok: false, message: (e && e.message) || 'No se pudo conectar.' };
    });
  }
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
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
  function abrirSolicitud(i) { if (window.SigsoBandejaV2) SigsoBandejaV2.abrirSolicitud(i.solicitud_id, i.subsolicitud_id); }

  function registrarArbol() {
    if (!window.SigsoNav) return;
    SigsoNav.registrar('jefatura', { nombre: 'Mi departamento', submodulos: ARQUITECTURA });
    if (window.SigsoShell && SigsoShell.refrescarArbol) SigsoShell.refrescarArbol();
  }
  function contenedor() {
    var s = document.getElementById('modulo-bandeja');
    if (!s) return null;
    var c = document.getElementById('jefatura-v2');
    if (!c) {
      c = document.createElement('div');
      c.id = 'jefatura-v2';
      c.className = 'sx2';
      s.appendChild(c);
    }
    s.classList.add('jefatura-v2-activa');
    return c;
  }
  function cabecera() {
    var v = VISTAS[vista_];
    return '<header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Mi departamento</span><h1>' + U.esc(v[0]) + '</h1>' +
      '<span class="sx2-tenue" style="font-size:.875rem">' + U.esc(v[1]) + '</span></div>' +
      '<div class="sx2-cabecera__acciones">' + U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-jv2-recargar' }) + '</div></header>';
  }
  function pagina(c, cuerpo, silencioso) {
    var y = window.scrollY;
    var foco = document.activeElement && document.activeElement.classList.contains('js-jv2-q');
    c.innerHTML = '<div class="sx2-pagina">' + cabecera() + cuerpo + '</div>';
    if (silencioso) {
      c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; });
      window.scrollTo(0, y);
    }
    if (foco) { var q = c.querySelector('.js-jv2-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
    U.animar(c);
  }
  function errorEn(c, r) {
    pagina(c, U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || 'Inténtalo de nuevo.',
      accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-jv2-recargar' }) }) }));
  }
  function sinEquipo() {
    return U.card({ i: 1, cuerpo: U.vacio({ icono: 'equipo', titulo: 'Todavía no tienes a nadie a cargo', texto: 'Pide al administrador que te asigne tu equipo en Administración → Jefaturas.' }) });
  }

  // --- Datos del panel (compartidos por tablero, persona, carga) -------------------------
  function recordarPersonas(items) {
    var vistas = {};
    personasConocidas_.forEach(function (p) { vistas[p.desarrollador_asignado] = true; });
    (items || []).forEach(function (i) {
      var e = String(i.desarrollador_asignado || '').trim();
      if (e && !vistas[e]) { vistas[e] = true; personasConocidas_.push({ desarrollador_asignado: e, desarrollador_nombre: i.desarrollador_nombre || e }); }
    });
  }
  function cargarPanel(silencioso) {
    var c = contenedor();
    if (!c) return;
    var t = ++turno_, v = vista_;
    if (!silencioso || !panel_) pagina(c, U.esqueleto('kpis', 5) + U.esqueleto('tabla', 6));
    api('getPanelJefatura', {}).then(function (r) {
      if (t !== turno_ || v !== vista_) return;
      if (!r || !r.ok) { errorEn(c, r); return; }
      panel_ = r.data;
      recordarPersonas(panel_.items);
      pintar(!!silencioso);
      var correos = (panel_.equipo || []).concat((panel_.items || []).map(function (i) { return i.desarrollador_asignado; })).filter(Boolean);
      Promise.all([window.SigsoDirectorio ? SigsoDirectorio.resolver(correos) : Promise.resolve(), U.precargarFotos(correos)])
        .then(function () { if (t === turno_) pintar(true); });
    });
  }
  function pintar(silencioso) {
    var c = contenedor();
    if (!c) return;
    if (vista_ === 'actividades') { if (actividades_) pagina(c, vistaActividades(), silencioso); return; }
    if (vista_ === 'reportes') { pintarReportes(silencioso); return; }
    if (!panel_) return;
    if (!(panel_.equipo || []).length) { pagina(c, sinEquipo(), silencioso); return; }
    pagina(c, vista_ === 'tablero' ? vistaTablero() : (vista_ === 'persona' ? vistaPersona() : vistaCarga()), silencioso);
  }

  // --- Solicitudes del equipo -------------------------------------------------------------
  var FILTROS = {
    atencion: function (i) { return i.cumplimiento && ['ATRASADA_DESARROLLADOR', 'EN_RIESGO'].indexOf(i.cumplimiento.codigo) !== -1; },
    validar: function (i) { return i.cumplimiento && i.cumplimiento.codigo === 'ESPERANDO_VALIDACION'; },
    abiertas: function (i) { return CERRADOS.indexOf(i.estado) === -1; },
    cerradas: function (i) { return CERRADOS.indexOf(i.estado) !== -1; }
  };
  function vistaTablero() {
    var k = panel_.kpis || {}, hoy = panel_.hoy || {}, r = hoy.resumen || {};
    var items = (panel_.items || []).slice();
    var cuenta = function (f) { return items.filter(FILTROS[f]).length; };
    var palabras = norm(q_).split(/\s+/).filter(Boolean);
    var lista = items.filter(function (i) {
      if (filtro_ && !FILTROS[filtro_](i)) return false;
      if (!palabras.length) return true;
      var h = norm([i.solicitud_id, i.titulo, i.solicitante_nombre, i.desarrollador_nombre, i.modulo_nombre, i.tipo_nombre].join(' '));
      return palabras.every(function (w) { return h.indexOf(w) !== -1; });
    }).sort(function (a, b) {
      var oa = FILTROS.atencion(a) ? 0 : (FILTROS.validar(a) ? 1 : (FILTROS.abiertas(a) ? 2 : 3));
      var ob = FILTROS.atencion(b) ? 0 : (FILTROS.validar(b) ? 1 : (FILTROS.abiertas(b) ? 2 : 3));
      return oa - ob || (Number(b.dias_abierta) || 0) - (Number(a.dias_abierta) || 0);
    });
    var totalHoy = (r.nuevas || 0) + (r.avanzaron || 0) + (r.cerradas || 0) + (r.en_riesgo || 0) + (r.requieren_accion || 0);
    var bloqueHoy = function (titulo, ico, tono, l) {
      if (!l || !l.length) return '';
      return '<div class="jv2-hoy__grupo"><span class="jv2-hoy__tit sx2-tono-' + tono + '">' + U.ico(ico, 14) + U.esc(titulo) + ' <b>' + l.length + '</b></span>' +
        '<ul>' + l.slice(0, 6).map(function (i) {
          return '<li><button type="button" class="jv2-hoy__item js-jv2-sol" data-sol="' + U.esc(i.solicitud_id) + '" data-sub="' + U.esc(i.subsolicitud_id || '') + '">' +
            '<span class="jv2-cod">' + U.esc(i.solicitud_id + '-' + i.numero_item) + '</span><span class="sx2-cortar">' + U.esc(i.titulo) + '</span></button></li>';
        }).join('') + '</ul></div>';
    };
    return '<div class="sx2-fila-kpis">' +
        U.kpi({ i: 0, etiqueta: 'Abiertas del equipo', valor: k.abiertas || 0, icono: 'bandeja', tono: 'primario', filtro: 'abiertas', activo: filtro_ === 'abiertas' }) +
        U.kpi({ i: 1, etiqueta: 'En riesgo o atrasadas', valor: k.en_riesgo_o_atrasadas || 0, icono: 'alerta', tono: k.en_riesgo_o_atrasadas ? 'critico' : 'ok', filtro: 'atencion', activo: filtro_ === 'atencion' }) +
        U.kpi({ i: 2, etiqueta: 'Esperando validación', valor: k.esperando_validacion || 0, icono: 'reloj', tono: k.esperando_validacion ? 'alerta' : 'ok', filtro: 'validar', activo: filtro_ === 'validar', titulo: 'Entregado a alguien de tu equipo, todavía sin confirmar.' }) +
        U.kpi({ i: 3, etiqueta: 'Cumplimiento del equipo', valor: k.pct_cumplimiento === null || k.pct_cumplimiento === undefined ? '—' : k.pct_cumplimiento, sufijo: k.pct_cumplimiento === null || k.pct_cumplimiento === undefined ? '' : '%', icono: 'diana', tono: k.pct_cumplimiento >= 90 ? 'ok' : (k.pct_cumplimiento >= 70 ? 'alerta' : 'critico'), progreso: k.pct_cumplimiento }) +
        U.kpi({ i: 4, etiqueta: 'Días prom. resolución', valor: k.dias_promedio_resolucion || 0, icono: 'calendario', tono: 'info' }) +
      '</div>' +
      U.card({ titulo: 'Hoy en tu equipo', icono: 'actividad', sub: totalHoy ? totalHoy + ' movimientos' : 'sin novedades', i: 5,
        cuerpo: totalHoy ? '<div class="jv2-hoy">' +
          bloqueHoy('Nuevas', 'nueva', 'info', hoy.nuevas) + bloqueHoy('Avanzaron', 'derivar', 'primario', hoy.avanzaron) +
          bloqueHoy('Cerradas hoy', 'check', 'ok', hoy.cerradas) + bloqueHoy('En riesgo o vencidas', 'alerta', 'critico', hoy.en_riesgo_o_vencidas) +
          bloqueHoy('Esperando validación', 'reloj', 'alerta', hoy.requieren_accion) + '</div>'
          : '<p class="sx2-tenue" style="margin:0">Sin movimientos hoy en las solicitudes de tu equipo.</p>' }) +
      '<div class="dc2-barra sx2-entra"><label class="dc2-buscar">' + U.ico('lupa', 16) + '<input type="search" class="js-jv2-q" placeholder="Buscar por número, título, persona o módulo…" value="' + U.esc(q_) + '" aria-label="Buscar solicitud"></label></div>' +
      '<div class="dc2-chips sx2-entra">' +
        U.chip({ texto: 'Todas', n: items.length, activo: !filtro_, clase: 'js-jv2-filtro', datos: { f: '' } }) +
        U.chip({ texto: 'Requieren atención', n: cuenta('atencion'), activo: filtro_ === 'atencion', tono: 'critico', clase: 'js-jv2-filtro', datos: { f: 'atencion' } }) +
        U.chip({ texto: 'Esperando validación', n: cuenta('validar'), activo: filtro_ === 'validar', clase: 'js-jv2-filtro', datos: { f: 'validar' } }) +
        U.chip({ texto: 'Abiertas', n: cuenta('abiertas'), activo: filtro_ === 'abiertas', clase: 'js-jv2-filtro', datos: { f: 'abiertas' } }) +
        U.chip({ texto: 'Cerradas', n: cuenta('cerradas'), activo: filtro_ === 'cerradas', clase: 'js-jv2-filtro', datos: { f: 'cerradas' } }) +
      '</div>' +
      U.card({ sinRelleno: true, i: 6, cuerpo: lista.length
        ? '<div class="sx2-tabla-wrap"><table class="sx2-tabla jv2-tabla"><thead><tr><th>Solicitud</th><th>Título</th><th>Solicitante</th><th>Responsable</th><th>Estado</th><th>Prioridad</th><th>Cumplimiento</th><th class="sx2-num">Días</th></tr></thead><tbody>' +
          lista.map(function (i) {
            var cu = i.cumplimiento || {};
            var resp = i.desarrollador_asignado ? PY.persona(i.desarrollador_asignado, i.desarrollador_nombre) : null;
            return '<tr class="sx2-fila--clic js-jv2-sol" data-sol="' + U.esc(i.solicitud_id) + '" data-sub="' + U.esc(i.subsolicitud_id || '') + '" tabindex="0">' +
              '<td><span class="jv2-cod">' + U.esc(i.solicitud_id + '-' + i.numero_item) + '</span></td>' +
              '<td class="jv2-titulo"><span class="sx2-cortar" title="' + U.esc(i.titulo) + '">' + U.esc(i.titulo) + '</span><span class="sx2-tenue">' + U.esc([i.tipo_nombre, i.modulo_nombre].filter(Boolean).join(' · ')) + '</span></td>' +
              '<td' + (i.persona_solicitante ? ' class="jv2-mio"' : '') + '>' + U.esc(i.solicitante_nombre || '') + '</td>' +
              '<td' + (i.persona_resolutor ? ' class="jv2-mio"' : '') + '>' + (resp ? '<span class="sx2-flex" style="gap:6px;align-items:center">' + U.avatar(resp, 'xs') + U.esc(resp.nombre) + '</span>' : '<span class="sx2-tenue">Sin asignar</span>') + '</td>' +
              '<td>' + U.badge(estadoTxt(i.estado), tonoEstado(i.estado)) + '</td>' +
              '<td>' + (i.prioridad ? U.badge(i.prioridad, tonoPrioridad(i.prioridad), true) : '') + '</td>' +
              '<td>' + U.badge(cu.etiqueta || '—', TONO_CUMPL[cu.codigo] || 'neutro') + '</td>' +
              '<td class="sx2-num">' + (Number(i.dias_abierta) || 0) + '</td></tr>';
          }).join('') + '</tbody></table></div>'
        : U.vacio({ icono: 'lupa', titulo: 'Nada con este filtro', texto: 'Cambia el filtro o la búsqueda.' }) });
  }

  // --- Por persona -------------------------------------------------------------------------
  function vistaPersona() {
    var l = (panel_.por_persona || []).slice().sort(function (a, b) {
      return (b.asignadas_en_riesgo + b.solicitadas_esperando_validacion) - (a.asignadas_en_riesgo + a.solicitadas_esperando_validacion) || String(a.nombre).localeCompare(String(b.nombre));
    });
    var cel = function (n, tono) { return n ? U.badge(String(n), tono) : '<span class="sx2-tenue">0</span>'; };
    return U.card({ sinRelleno: true, i: 1, cuerpo: '<div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr><th>Persona</th><th class="sx2-num">Reportó (abiertas / total)</th><th class="sx2-num">Esperando que valide</th><th class="sx2-num">Tiene asignado (abiertas / total)</th><th class="sx2-num">En riesgo</th></tr></thead><tbody>' +
      l.map(function (p) {
        var per = PY.persona(p.email, p.nombre);
        return '<tr><td><span class="sx2-flex" style="gap:8px;align-items:center">' + U.avatar(per, 'sm') + '<strong>' + U.esc(per.nombre) + '</strong></span></td>' +
          '<td class="sx2-num">' + p.solicitadas_abiertas + ' / ' + p.solicitadas_total + '</td>' +
          '<td class="sx2-num">' + cel(p.solicitadas_esperando_validacion, 'alerta') + '</td>' +
          '<td class="sx2-num">' + p.asignadas_abiertas + ' / ' + p.asignadas_total + '</td>' +
          '<td class="sx2-num">' + cel(p.asignadas_en_riesgo, 'critico') + '</td></tr>';
      }).join('') + '</tbody></table></div>' }) +
      '<p class="sx2-tenue" style="margin:0;font-size:.8125rem">"Esperando que valide": alguien le entregó algo que pidió y aún no lo confirma. "En riesgo": trabajo asignado que está atrasado o por vencer.</p>';
  }

  // --- Carga ------------------------------------------------------------------------------------
  function barras(filas, tono) {
    if (!filas || !filas.length) return U.vacio({ icono: 'grafico', titulo: 'Sin datos', texto: '' });
    var max = filas.reduce(function (m, f) { return Math.max(m, f.cantidad); }, 0) || 1;
    return '<ul class="cv2-barras">' + filas.map(function (f) {
      return '<li><span class="cv2-barras__et" title="' + U.esc(f.etiqueta) + '">' + U.esc(f.etiqueta) + '</span>' + U.barra(f.cantidad * 100 / max, tono) + '<strong class="cv2-barras__v">' + f.cantidad + '</strong></li>';
    }).join('') + '</ul>';
  }
  function vistaCarga() {
    var cg = panel_.carga || {};
    return '<div class="sx2-grid sx2-grid--estira"><div class="sx2-col-6">' + U.card({ titulo: 'Por módulo', icono: 'capas', i: 1, cuerpo: barras(cg.por_modulo, 'primario') }) + '</div>' +
      '<div class="sx2-col-6">' + U.card({ titulo: 'Por tipo', icono: 'etiqueta', i: 2, cuerpo: barras(cg.por_tipo, 'info') }) + '</div></div>';
  }

  // --- Actividades del equipo -------------------------------------------------------------------
  function cargarActividades(silencioso) {
    var c = contenedor();
    if (!c) return;
    var t = ++turno_;
    if (!silencioso || !actividades_) pagina(c, U.esqueleto('kpis', 4) + U.esqueleto('tabla', 6));
    api('panelEquipoActividades', {}).then(function (r) {
      if (t !== turno_ || vista_ !== 'actividades') return;
      if (!r || !r.ok) { errorEn(c, r); return; }
      actividades_ = r.data;
      pintar(!!silencioso);
      var correos = (actividades_.items || []).map(function (a) { return a.responsable_email; }).filter(Boolean);
      Promise.all([window.SigsoDirectorio ? SigsoDirectorio.resolver(correos) : Promise.resolve(), U.precargarFotos(correos)])
        .then(function () { if (t === turno_) pintar(true); });
    });
  }
  function vistaActividades() {
    var items = (actividades_.items || []).slice();
    var cnt = { al: 0, riesgo: 0, bloq: 0, pend: 0 };
    items.forEach(function (a) {
      if (a.semaforo === 'atrasada' || a.semaforo === 'riesgo') cnt.riesgo++;
      else if (a.semaforo === 'bloqueada') cnt.bloq++;
      else if (a.semaforo === 'pendiente') cnt.pend++;
      else if (a.semaforo === 'al-dia') cnt.al++;
    });
    items.sort(function (a, b) { return (ORDEN_ACT[a.semaforo] === undefined ? 9 : ORDEN_ACT[a.semaforo]) - (ORDEN_ACT[b.semaforo] === undefined ? 9 : ORDEN_ACT[b.semaforo]); });
    return '<div class="sx2-fila-kpis">' +
        U.kpi({ i: 0, etiqueta: 'Al día', valor: cnt.al, icono: 'check', tono: 'ok' }) +
        U.kpi({ i: 1, etiqueta: 'En riesgo o atrasadas', valor: cnt.riesgo, icono: 'alerta', tono: cnt.riesgo ? 'critico' : 'ok' }) +
        U.kpi({ i: 2, etiqueta: 'Bloqueadas', valor: cnt.bloq, icono: 'pausado', tono: cnt.bloq ? 'info' : 'ok' }) +
        U.kpi({ i: 3, etiqueta: 'Por confirmar fecha', valor: cnt.pend, icono: 'reloj', tono: 'neutro' }) +
      '</div>' +
      U.card({ sinRelleno: true, i: 4, cuerpo: items.length
        ? '<div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr><th>Actividad</th><th>Responsable</th><th>Tamaño</th><th>Vence</th><th>Semáforo</th><th></th></tr></thead><tbody>' +
          items.map(function (a) {
            var per = PY.persona(a.responsable_email, a.responsable_nombre);
            var viva = a.estado !== 'TERMINADA' && a.estado !== 'CANCELADA';
            return '<tr><td class="jv2-titulo"><span class="sx2-cortar" title="' + U.esc(a.titulo) + '">' + U.esc(a.titulo) + '</span>' +
                (a.bloqueo_motivo ? '<span class="jv2-bloqueo">' + U.ico('pausado', 12) + ' ' + U.esc(a.bloqueo_motivo) + '</span>' : '') + '</td>' +
              '<td><span class="sx2-flex" style="gap:6px;align-items:center">' + U.avatar(per, 'xs') + U.esc(per.nombre) + '</span></td>' +
              '<td>' + U.esc(TAMANO[a.tamano] || a.tamano || '—') + '</td>' +
              '<td>' + U.esc(PY.fecha(a.fecha_compromiso || a.fecha_propuesta) || '—') + '</td>' +
              '<td>' + U.badge(a.semaforo_etiqueta || a.semaforo, TONO_ACT[a.semaforo] || 'neutro') + '</td>' +
              '<td class="jv2-acc">' + (viva ? U.boton({ texto: 'Pedir actualización', sm: true, variante: 'fantasma', clase: 'js-jv2-pedir', datos: { id: a.actividad_id } }) +
                U.boton({ texto: 'Reasignar', sm: true, variante: 'fantasma', clase: 'js-jv2-reasignar', datos: { id: a.actividad_id, resp: a.responsable_email } }) : '') + '</td></tr>';
          }).join('') + '</tbody></table></div>'
        : U.vacio({ icono: 'tareas', titulo: 'Tu equipo no tiene actividades registradas', texto: '' }) });
  }
  function pedirActualizacion(id) {
    U.formulario({
      titulo: 'Pedir una actualización', boton: 'Enviar', ocupado: 'Enviando…',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Le llega un correo de inmediato.</span>',
      campos: U.campo('Nota (opcional)', '<textarea class="sx2-input" name="nota" maxlength="500" placeholder="¿Cómo vas con esto?"></textarea>'),
      enviar: function (x) { return api('pedirActualizacionActividad', { actividad_id: id, nota: x.nota || '' }); },
      aviso: 'Se le avisó por correo.'
    });
  }
  function reasignar(id, actual) {
    var equipo = ((panel_ && panel_.equipo) || []).filter(function (e) { return e !== actual; });
    U.formulario({
      titulo: 'Reasignar actividad', boton: 'Reasignar', ocupado: 'Reasignando…',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Queda pendiente de que la nueva persona la confirme.</span>',
      campos: U.campo('Nuevo responsable', equipo.length
          ? '<select class="sx2-select" name="responsable_nuevo">' + equipo.map(function (e) { return '<option value="' + U.esc(e) + '">' + U.esc(PY.persona(e).nombre) + '</option>'; }).join('') + '</select>'
          : '<input class="sx2-input" type="email" name="responsable_nuevo" placeholder="nombre@empresa.cl">') +
        U.campo('Motivo', '<textarea class="sx2-input" name="motivo" maxlength="500" required placeholder="Queda en la bitácora de la actividad"></textarea>'),
      preparar: function (x) { if (!x.responsable_nuevo) return 'Elige a quién reasignar.'; return x.motivo ? x : 'Indica el motivo de la reasignación.'; },
      enviar: function (x) { return api('reasignarActividad', { actividad_id: id, responsable_nuevo: x.responsable_nuevo, motivo: x.motivo }); },
      aviso: 'Reasignada: queda pendiente de que la confirme.',
      listo: function () { cargarActividades(true); }
    });
  }

  // --- Reportes (motor v2) -------------------------------------------------------------------
  function registrarReportes() {
    if (!window.SigsoReportes || registrarReportes.hecho) return;
    SigsoReportes.registrar('jefatura', {
      titulo: 'Reportes de tu departamento',
      nota: 'Se arman con lo que ya devuelve el panel, siempre acotado a tu equipo. La regla de cumplimiento es la misma que usa Gerencia: solo se mide sobre lo entregado con fecha comprometida.',
      grupos: REPORTES
    });
    registrarReportes.hecho = true;
  }
  function filtrosServidor() {
    var f = filtrosRep_ || {}, s = {};
    if (f.responsable) s.desarrollador = f.responsable;
    var rango = SigsoReportes.rangoDePeriodo(f.periodo);
    if (f.desde || rango.desde) s.desde = f.desde || rango.desde;
    if (f.hasta || rango.hasta) s.hasta = f.hasta || rango.hasta;
    return s;
  }
  function cargarReportes(silencioso) {
    registrarReportes();
    var c = contenedor();
    if (!c) return;
    var t = ++turno_;
    if (!silencioso || !panelRep_) pagina(c, U.esqueleto('tarjetas', 3));
    api('getPanelJefatura', filtrosServidor()).then(function (r) {
      if (t !== turno_ || vista_ !== 'reportes') return;
      if (!r || !r.ok) { errorEn(c, r); return; }
      panelRep_ = r.data;
      recordarPersonas(panelRep_.items);
      pintarReportes(!!silencioso);
    });
  }
  function pintarReportes(silencioso) {
    var c = contenedor();
    if (!c || !panelRep_) return;
    pagina(c, '<div class="sx2-card sx2-entra jv2-rep" style="--i:1"></div>', silencioso);
    var cont = c.querySelector('.jv2-rep');
    if (!reporteAbierto_) {
      SigsoReportes.pintarCatalogo({
        contenedor: cont, modulo: 'jefatura',
        onAbrir: function (id) { reporteAbierto_ = id; filtrosRep_ = {}; pintarReportes(); },
        onIrASeccion: function (v) { irA(v); }
      });
      return;
    }
    var r = SigsoReportes.buscarReporte('jefatura', reporteAbierto_);
    if (!r) { reporteAbierto_ = null; pintarReportes(); return; }
    var items = panelRep_.items || [];
    var opciones = SigsoReportes.opcionesDeItems(personasConocidas_, r.campos || {});
    var cuerpo = '';
    if (r.id === 'jef-responsable') cuerpo = SigsoReportes.cuerpoCumplimientoPor(items, { campo: 'desarrollador_nombre', etiquetaVacia: '(sin asignar)', dimension: 'Persona', etiquetaTotal: 'Personas' });
    else if (r.id === 'jef-modulo') cuerpo = SigsoReportes.cuerpoCumplimientoPor(items, { campo: 'modulo_nombre', etiquetaVacia: '(sin módulo)', dimension: 'Módulo', etiquetaTotal: 'Módulos' });
    else if (r.id === 'jef-tipo') cuerpo = SigsoReportes.cuerpoCumplimientoPor(items, { campo: 'tipo_nombre', etiquetaVacia: '(sin tipo)', dimension: 'Tipo', etiquetaTotal: 'Tipos' });
    else if (r.id === 'jef-throughput') cuerpo = SigsoReportes.cuerpoEntradaSalida(panelRep_.tendencia || []);
    else if (r.id === 'jef-resbalon') cuerpo = SigsoReportes.cuerpoResbalon(items, { columnasExtra: [{ campo: 'modulo_nombre', titulo: 'Módulo' }] });
    cont.innerHTML = SigsoReportes.barraAcciones({}) +
      SigsoReportes.cabeceraDocumento({
        titulo: r.nombre, subtitulo: r.desc, modulo: 'Mi departamento',
        codigo: 'SIGSO-REP-JEF-' + String(r.id).replace(/^[a-z]+-/, '').toUpperCase(),
        generadoPor: PY.miNombre() || '', filtros: SigsoReportes.filtrosParaCabecera(r, opciones, filtrosRep_)
      }) +
      SigsoReportes.pintarFiltros(r, opciones, filtrosRep_) + cuerpo + SigsoReportes.pieDocumento();
    SigsoReportes.wireAcciones(cont, { nombreArchivo: 'sigso-jefatura-' + r.id, onVolver: function () { reporteAbierto_ = null; filtrosRep_ = {}; pintarReportes(); } });
    SigsoReportes.alAplicarFiltros(cont, function (valores) { filtrosRep_ = valores; cargarReportes(false); });
  }

  // --- Navegación -----------------------------------------------------------------------------
  function irA(v) {
    vista_ = v === 'resumen' || VISTAS[v] ? v : 'resumen';
    if (vista_ !== 'reportes') { reporteAbierto_ = null; filtrosRep_ = {}; }
    registrarArbol();
    if (window.SigsoShell && SigsoShell.publicarItem) SigsoShell.publicarItem(vista_);
    if (vista_ === 'resumen') { if (window.SigsoJefaturaV2) SigsoJefaturaV2.mostrar(); return; }
    var hay = !!document.getElementById('jefatura-v2');
    if (vista_ === 'actividades') { cargarActividades(!!actividades_ && hay); return; }
    if (vista_ === 'reportes') { cargarReportes(!!panelRep_ && hay); return; }
    cargarPanel(!!panel_ && hay);
  }

  document.addEventListener('click', function (ev) {
    var raiz = document.getElementById('jefatura-v2');
    if (!raiz || !raiz.contains(ev.target) || vista_ === 'resumen') return;
    var t = ev.target, b;
    if (t.closest('.js-jv2-recargar')) {
      if (vista_ === 'actividades') cargarActividades(true);
      else if (vista_ === 'reportes') cargarReportes(true);
      else cargarPanel(true);
      return;
    }
    if ((b = t.closest('.js-jv2-sol'))) { abrirSolicitud({ solicitud_id: b.getAttribute('data-sol'), subsolicitud_id: b.getAttribute('data-sub') }); return; }
    if ((b = t.closest('.js-jv2-filtro'))) { filtro_ = b.getAttribute('data-f') || ''; pintar(true); return; }
    if ((b = t.closest('.sx2-kpi--clic'))) { var f = b.getAttribute('data-filtro'); filtro_ = filtro_ === f ? '' : f; pintar(true); return; }
    if ((b = t.closest('.js-jv2-pedir'))) { pedirActualizacion(b.getAttribute('data-id')); return; }
    if ((b = t.closest('.js-jv2-reasignar'))) reasignar(b.getAttribute('data-id'), b.getAttribute('data-resp'));
  });
  document.addEventListener('keydown', function (ev) {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('#jefatura-v2 tr.js-jv2-sol')) { ev.preventDefault(); ev.target.click(); }
  });
  var tq_ = null;
  document.addEventListener('input', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('js-jv2-q')) return;
    q_ = ev.target.value;
    clearTimeout(tq_);
    tq_ = setTimeout(function () { pintar(true); }, 150);
  });
  // Un cambio hecho en el panel de la solicitud (derivar, cerrar…) actualiza la tabla.
  document.addEventListener('sigso:solicitudes-cambio', function () {
    var c = document.getElementById('jefatura-v2');
    if (c && c.offsetParent !== null && (vista_ === 'tablero' || vista_ === 'persona')) cargarPanel(true);
  });

  window.SigsoJefatura = {
    cargar: function () {
      var pedida = (window.SigsoShell && SigsoShell.tomarItemDeRuta) ? SigsoShell.tomarItemDeRuta() : '';
      irA(pedida || vista_);
    },
    irAItem: irA,
    registrarArbol: registrarArbol,
    // jefatura-v2.js ("Mi equipo hoy") pregunta si sigue siendo la vista activa antes de pintar.
    vista: function () { return vista_; }
  };
  registrarArbol();
})();
