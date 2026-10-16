/**
 * proyectos-v2/trabajo.js — sección "Trabajo": UNA lista de tareas con tres
 * modos (Tabla · Kanban · Gantt) y una sola barra de filtros compartida.
 * Reemplaza en v1: Tareas (Lista/Tabla/Tablero), Planificación
 * (Cronograma/Tabla) e Hitos como agrupación.
 *
 * Clic en cualquier tarea -> PY.abrirTarea (panel único, panel-tarea.js).
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;

  var f = { estado: 'todas', responsable: '', hito: '', texto: '', modo: 'tabla', zoom: 'todo', orden: { campo: 'fin', dir: 1 } };
  try { f.modo = localStorage.getItem('sigso_py2_modo_trabajo') || 'tabla'; } catch (e) { /* sin storage */ }

  // Carta Gantt (rediseño 2026-09-28): zoom de "Semana" (días) a "Todo" (el
  // proyecto entero en el ancho disponible), densidad, dependencias y pantalla
  // completa. Las preferencias se recuerdan en este navegador.
  var ZOOM = { semana: 120, mes: 48, trimestre: 22, anio: 9 };
  var ZOOMS = [{ id: 'semana', texto: 'Semana' }, { id: 'mes', texto: 'Mes' }, { id: 'trimestre', texto: 'Trimestre' }, { id: 'anio', texto: 'Año' }, { id: 'todo', texto: 'Todo' }];
  var g = { densidad: '', deps: true, completa: false, quieto: false, base: true };
  function leerPref(k, def) { try { var v = localStorage.getItem('sigso_py2_gantt_' + k); return v === null ? def : v; } catch (e) { return def; } }
  function guardarPref(k, v) { try { localStorage.setItem('sigso_py2_gantt_' + k, v); } catch (e) { /* sin storage */ } }
  f.zoom = leerPref('zoom', 'todo');
  g.densidad = leerPref('densidad', '');
  g.deps = leerPref('deps', '1') === '1';
  var ESTADOS = [
    { id: 'todas', texto: 'Todas', icono: 'rejilla' },
    // "En plazo" (plazo) y no "En curso" (flujo): la columna "En curso" del
    // Kanban es otra cosa, y dos "En curso" con cifras distintas confunden.
    { id: 'en-curso', texto: 'En plazo', icono: 'estado', tono: 'info' },
    { id: 'atrasadas', texto: 'Atrasadas', icono: 'alerta', tono: 'critico' },
    { id: 'en-riesgo', texto: 'En riesgo', icono: 'rayo', tono: 'alerta' },
    { id: 'bloqueadas', texto: 'Bloqueadas', icono: 'candado', tono: 'hito' },
    { id: 'completadas', texto: 'Completadas', icono: 'check', tono: 'ok' }
  ];
  var COLUMNAS_KANBAN = [
    { estado: 'NO_INICIADA', texto: 'Por hacer', tono: 'neutro' },
    { estado: 'EN_CURSO', texto: 'En curso', tono: 'info' },
    { estado: 'BLOQUEADA', texto: 'Bloqueadas', tono: 'hito' },
    { estado: 'EN_REVISION', texto: 'En revisión', tono: 'primario' },
    { estado: 'TERMINADA', texto: 'Terminadas', tono: 'ok' }
  ];
  var PRIORIDAD_TONO = { P1: 'critico', P2: 'alerta', P3: 'info', P4: 'neutro', P5: 'neutro' };

  // Selección múltiple para "Pasar a…" (auditoría 16-10-2026). El líder
  // puede pasar cualquier tarea abierta; cada persona, las que tiene a su nombre.
  var sel = {};
  function seleccionable(ctx, a) {
    if (PY.esTerminal(a)) return false;
    return !!ctx.detalle.puede_gestionar || String(a.responsable_email || '').toLowerCase() === PY.miEmail();
  }
  function seleccionadas(ctx) {
    return ctx.tareas.filter(function (a) { return sel[a.actividad_id] && seleccionable(ctx, a); });
  }

  // Los filtros son de UN proyecto: al abrir otro se parte de cero (antes un
  // hito o una persona del proyecto anterior dejaba la lista vacía).
  var proyectoVisto_ = null;
  function reiniciarSiCambioProyecto(ctx) {
    var id = ctx.proyecto && ctx.proyecto.proyecto_id;
    if (id === proyectoVisto_) return;
    proyectoVisto_ = id;
    f.estado = 'todas'; f.responsable = ''; f.hito = ''; f.texto = '';
    sel = {};
  }

  // Misma clasificación que las métricas del Resumen (PY.metricas).
  function clase(a, plan) {
    if (a.estado === 'TERMINADA') return 'completadas';
    var ep = (plan[a.actividad_id] || {}).estado_plazo;
    if (ep === 'ATRASADA' || a.semaforo === 'atrasada') return 'atrasadas';
    if (ep === 'EN_RIESGO' || a.semaforo === 'riesgo') return 'en-riesgo';
    return 'en-curso';
  }
  function coincide(a, plan, estado) {
    if (estado === 'todas') return true;
    if (estado === 'bloqueadas') return a.estado === 'BLOQUEADA';
    return clase(a, plan) === estado;
  }

  function filtrar(ctx, plan, ignorarEstado) {
    var txt = f.texto.trim().toLowerCase();
    return ctx.tareas.filter(function (a) {
      if (a.estado === 'CANCELADA') return false;
      if (!ignorarEstado && !coincide(a, plan, f.estado)) return false;
      if (f.responsable && String(a.responsable_email || '').toLowerCase() !== f.responsable) return false;
      if (f.hito && (f.hito === '_' ? a.hito_id : a.hito_id !== f.hito)) return false;
      if (txt && (a.titulo + ' ' + (a.descripcion || '') + ' ' + PY.persona(a.responsable_email, a.responsable_nombre).nombre).toLowerCase().indexOf(txt) === -1) return false;
      return true;
    });
  }

  // --- Barra de herramientas ----------------------------------------------------
  function barra(ctx, plan) {
    var base = filtrar(ctx, plan, true);
    var cuenta = {};
    ESTADOS.forEach(function (e) { cuenta[e.id] = base.filter(function (a) { return coincide(a, plan, e.id); }).length; });

    var personas = {};
    ctx.tareas.forEach(function (a) { if (a.responsable_email) personas[a.responsable_email.toLowerCase()] = PY.persona(a.responsable_email, a.responsable_nombre).nombre; });
    // Integrantes sin tareas también: se llega aquí desde su tarjeta en Equipo.
    (ctx.detalle.integrantes || []).forEach(function (i) {
      var e = String(i.usuario_email || '').toLowerCase();
      if (e && !personas[e]) personas[e] = PY.persona(e, i.usuario_nombre).nombre;
    });
    var hitos = (ctx.detalle.hitos || []);

    return '<div class="sx2-card sx2-py-herramientas sx2-entra">' +
      '<div class="sx2-entre" style="flex-wrap:wrap">' +
        '<div class="sx2-barra-filtros">' +
          '<label class="sx2-buscar">' + U.ico('lupa', 16) + '<input class="sx2-input js-py2t-buscar" type="search" placeholder="Buscar tarea…" aria-label="Buscar tarea" value="' + U.esc(f.texto) + '"></label>' +
          '<select class="sx2-select js-py2t-resp" aria-label="Responsable"><option value="">Todas las personas</option>' +
            Object.keys(personas).sort(function (x, y) { return personas[x].localeCompare(personas[y], 'es'); }).map(function (e) {
              return '<option value="' + U.esc(e) + '"' + (f.responsable === e ? ' selected' : '') + '>' + U.esc(personas[e]) + '</option>';
            }).join('') + '</select>' +
          '<select class="sx2-select js-py2t-hito" aria-label="Hito"><option value="">Todos los hitos</option>' +
            hitos.map(function (h) { return '<option value="' + U.esc(h.hito_id) + '"' + (f.hito === h.hito_id ? ' selected' : '') + '>' + U.esc(h.nombre) + '</option>'; }).join('') +
            '<option value="_"' + (f.hito === '_' ? ' selected' : '') + '>Sin hito</option></select>' +
        '</div>' +
        '<div class="sx2-flex" style="flex-wrap:wrap">' +
          U.segmento([{ id: 'tabla', texto: 'Tabla', icono: 'tabla' }, { id: 'kanban', texto: 'Kanban', icono: 'kanban' }, { id: 'gantt', texto: 'Gantt', icono: 'gantt' }], f.modo, 'js-py2t-modo') +
          U.boton({ texto: 'Nueva tarea', icono: 'nueva', variante: 'primario', clase: 'js-py2t-nueva' }) +
        '</div>' +
      '</div>' +
      '<div class="sx2-chips">' + ESTADOS.map(function (e) {
        return U.chip({ texto: e.texto, icono: e.icono, tono: e.tono, n: cuenta[e.id], activo: f.estado === e.id, clase: 'js-py2t-estado', datos: { estado: e.id } });
      }).join('') +
      ((f.responsable || f.hito || f.texto || f.estado !== 'todas') ? '<button type="button" class="sx2-enlace js-py2t-limpiar">' + U.ico('equis', 13) + 'Limpiar filtros</button>' : '') +
      '</div>' +
    '</div>';
  }

  // --- Tabla ------------------------------------------------------------------------
  var COLS = [
    { id: 'titulo', texto: 'Tarea' }, { id: 'resp', texto: 'Responsable' }, { id: 'estado', texto: 'Estado' },
    { id: 'prio', texto: 'Prioridad' }, { id: 'ini', texto: 'Inicio plan', num: true }, { id: 'fin', texto: 'Fin plan', num: true },
    { id: 'ireal', texto: 'Inicio real', num: true }, { id: 'real', texto: 'Fin real', num: true }, { id: 'avance', texto: 'Avance' }, { id: 'desv', texto: 'Desv. plazo', num: true }
  ];
  function valorOrden(a, p, campo) {
    switch (campo) {
      case 'titulo': return String(a.titulo).toLowerCase();
      case 'resp': return PY.persona(a.responsable_email, a.responsable_nombre).nombre.toLowerCase();
      case 'estado': return a.semaforo_etiqueta || a.estado;
      case 'prio': return a.prioridad || 'P9';
      case 'ini': return new Date(p.plan_inicio || a.fecha_creacion || 0).getTime();
      case 'fin': return new Date(p.plan_fin || a.fecha_compromiso || '9999-12-31').getTime();
      case 'ireal': return new Date(a.fecha_inicio_real || p.fecha_inicio_real || '9999-12-31').getTime();
      case 'real': return new Date(p.fecha_fin_real || a.fecha_terminada || '9999-12-31').getTime();
      case 'avance': return Number(p.avance_real_pct !== undefined && p.avance_real_pct !== null ? p.avance_real_pct : (a.avance_pct || 0));
      case 'desv': return p.desviacion_dias === null || p.desviacion_dias === undefined ? -9999 : p.desviacion_dias;
    }
    return 0;
  }
  // Barra de selección: siempre visible en la tabla si hay algo que se pueda
  // pasar, para que se descubra sin explicación.
  function barraSeleccion(ctx, visibles) {
    var marcables = visibles.filter(function (a) { return seleccionable(ctx, a); });
    if (!marcables.length) return '';
    var n = seleccionadas(ctx).length;
    return '<div class="sx2-py-seleccion' + (n ? ' sx2-py-seleccion--activa' : '') + ' sx2-entra" style="--i:1" role="region" aria-label="Tareas seleccionadas">' +
      (n
        ? '<strong>' + n + (n === 1 ? ' tarea seleccionada' : ' tareas seleccionadas') + '</strong>' +
          '<span style="flex:1"></span>' +
          U.boton({ texto: 'Quitar selección', sm: true, variante: 'fantasma', clase: 'js-py2t-sel-limpiar' }) +
          U.boton({ texto: 'Pasar a…', icono: 'equipo', sm: true, variante: 'primario', clase: 'js-py2t-pasar' })
        : '<span class="sx2-tenue">' + U.ico('equipo', 14) + ' Marca tareas en la tabla para pasarlas a otra persona del equipo' +
          (ctx.detalle.puede_gestionar ? '' : ' (puedes pasar las que están a tu nombre)') + '.</span>') +
    '</div>';
  }

  function tabla(tareas, plan, ctx) {
    if (!tareas.length) return vacioFiltros();
    var hitosPorId = {};
    (ctx.detalle.hitos || []).forEach(function (h) { hitosPorId[h.hito_id] = h; });
    var o = f.orden;
    var ordenadas = tareas.slice().sort(function (a, b) {
      var va = valorOrden(a, plan[a.actividad_id] || {}, o.campo), vb = valorOrden(b, plan[b.actividad_id] || {}, o.campo);
      return (va < vb ? -1 : (va > vb ? 1 : 0)) * o.dir;
    });
    var marcables = ordenadas.filter(function (a) { return seleccionable(ctx, a); });
    var conSel = marcables.length > 0;
    var todas = conSel && marcables.every(function (a) { return sel[a.actividad_id]; });
    return barraSeleccion(ctx, ordenadas) +
      '<div class="sx2-card sx2-card--sin-relleno sx2-entra" style="--i:1"><div class="sx2-tabla-wrap"><table class="sx2-tabla sx2-py-tabla-trabajo"><thead><tr>' +
      (conSel ? '<th class="sx2-py-col-sel"><input type="checkbox" class="js-py2t-sel-todas" aria-label="Seleccionar todas las que puedes pasar"' + (todas ? ' checked' : '') + '></th>' : '') +
      COLS.map(function (c) {
        var sort = o.campo === c.id ? (o.dir === 1 ? 'ascending' : 'descending') : 'none';
        return '<th class="js-py2t-orden' + (c.num ? ' sx2-num' : '') + '" data-campo="' + c.id + '" aria-sort="' + sort + '" tabindex="0">' + c.texto + '</th>';
      }).join('') +
    '</tr></thead><tbody>' +
    ordenadas.map(function (a) {
      var p = plan[a.actividad_id] || {};
      var avance = valorOrden(a, p, 'avance');
      var desv = p.desviacion_dias;
      var h = hitosPorId[a.hito_id];
      return '<tr class="sx2-fila--clic' + (sel[a.actividad_id] ? ' sx2-py-fila--sel' : '') + '" data-py2-tarea="' + U.esc(a.actividad_id) + '" tabindex="0">' +
        (conSel ? '<td class="sx2-py-col-sel">' + (seleccionable(ctx, a)
          ? '<input type="checkbox" class="js-py2t-sel" data-id="' + U.esc(a.actividad_id) + '" aria-label="Seleccionar ' + U.esc(a.titulo) + '"' + (sel[a.actividad_id] ? ' checked' : '') + '>'
          : '') + '</td>' : '') +
        '<td class="sx2-py-celda-tarea"><strong class="sx2-cortar">' + U.esc(a.titulo) + '</strong>' +
          (h || a.es_subtarea ? '<span class="sx2-tenue sx2-cortar">' + (a.es_subtarea ? U.ico('derecha', 11) + U.esc(a.padre_titulo || 'Subtarea') : U.ico('bandera', 11) + U.esc(h.nombre)) + '</span>' : '') + '</td>' +
        '<td>' + U.persona(PY.persona(a.responsable_email, a.responsable_nombre)) + '</td>' +
        '<td>' + U.badge(a.semaforo_etiqueta || a.estado, PY.tonoTarea(a)) + '</td>' +
        '<td>' + (a.prioridad ? U.badge(a.prioridad, PRIORIDAD_TONO[a.prioridad] || 'neutro', true) : '—') + '</td>' +
        '<td class="sx2-num">' + PY.fecha(a.fecha_inicio_plan || p.plan_inicio || a.fecha_creacion) + '</td>' +
        '<td class="sx2-num">' + PY.fecha(p.plan_fin || a.fecha_compromiso) + '</td>' +
        '<td class="sx2-num">' + PY.fecha(a.fecha_inicio_real || p.fecha_inicio_real) + '</td>' +
        '<td class="sx2-num">' + PY.fecha(p.fecha_fin_real || a.fecha_terminada) + '</td>' +
        '<td><div class="sx2-flex" style="gap:8px;min-width:110px"><span style="flex:1">' + U.barra(avance, PY.tonoTarea(a)) + '</span><span class="sx2-num" style="min-width:3.5ch">' + Math.round(avance) + '%</span></div></td>' +
        '<td class="sx2-num' + (desv > 0 ? ' sx2-delta--mal' : (desv < 0 ? ' sx2-delta--bien' : '')) + '">' + (desv === null || desv === undefined ? '—' : (desv > 0 ? '+' : '') + desv + ' d') + '</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table></div></div>';
  }

  // --- Kanban -----------------------------------------------------------------------
  function kanban(tareas, plan, ctx) {
    var hitosPorId = {};
    (ctx.detalle.hitos || []).forEach(function (h) { hitosPorId[h.hito_id] = h; });
    return '<div class="sx2-py-kanban">' + COLUMNAS_KANBAN.map(function (col, ci) {
      var propias = tareas.filter(function (a) { return a.estado === col.estado; })
        .sort(function (a, b) { return new Date(a.fecha_compromiso || '9999-12-31') - new Date(b.fecha_compromiso || '9999-12-31'); });
      return '<section class="sx2-py-kanban__col sx2-tono-' + col.tono + ' sx2-entra" style="--i:' + ci + '" data-estado="' + col.estado + '">' +
        '<header class="sx2-py-kanban__cab"><span class="sx2-py-kanban__punto"></span>' + col.texto + '<span class="sx2-py-gantt__n">' + propias.length + '</span></header>' +
        '<div class="sx2-py-kanban__lista">' +
          (propias.length ? propias.map(function (a) {
            var p = plan[a.actividad_id] || {};
            var avance = valorOrden(a, p, 'avance');
            var d = PY.diasHasta(a.fecha_compromiso);
            var h = hitosPorId[a.hito_id];
            return '<article class="sx2-py-kcard" data-py2-tarea="' + U.esc(a.actividad_id) + '" tabindex="0">' +
              '<div class="sx2-entre">' + U.badge(a.semaforo_etiqueta || a.estado, PY.tonoTarea(a)) +
                (a.prioridad ? U.badge(a.prioridad, PRIORIDAD_TONO[a.prioridad] || 'neutro', true) : '') + '</div>' +
              '<h4 class="sx2-py-kcard__titulo">' + U.esc(a.titulo) + '</h4>' +
              (h ? '<span class="sx2-py-kcard__hito">' + U.ico('bandera', 11) + U.esc(h.nombre) + '</span>' : '') +
              (a.estado !== 'NO_INICIADA' ? U.barra(avance, PY.tonoTarea(a)) : '') +
              '<div class="sx2-entre">' + U.avatar(PY.persona(a.responsable_email, a.responsable_nombre), 'sm') +
                '<span class="sx2-py-kcard__fecha' + (d !== null && d < 0 && a.estado !== 'TERMINADA' ? ' sx2-py-kcard__fecha--vencida' : '') + '">' + U.ico('calendario', 12) + PY.fecha(a.fecha_compromiso) + '</span>' +
              '</div>' +
            '</article>';
          }).join('') : '<p class="sx2-py-kanban__vacia">Sin tareas</p>') +
        '</div>' +
      '</section>';
    }).join('') + '</div>';
  }

  // --- Gantt --------------------------------------------------------------------------
  // "Todo": el ancho por semana que hace caber el proyecto entero en pantalla.
  function pxAjustado(r) {
    var cont = document.getElementById('proyectos-contenido');
    var ancho = g.completa ? window.innerWidth - 56 : (((cont && cont.clientWidth) || (window.innerWidth - 300)) - 44);
    var et = window.innerWidth >= 1200 ? 280 : (window.innerWidth <= 720 ? 130 : 220);
    return Math.max(3, (ancho - et - 6) / r.semanas);
  }
  function gantt(tareas, ctx) {
    var r = PY.ganttRangoProyecto(ctx);
    var hayBase = !!(ctx.rendimiento && ctx.rendimiento.baseline);
    var densidad = g.densidad || (ctx.tareas.length > 40 ? 'compacta' : 'comoda');
    var hitos = (ctx.detalle.hitos || []);
    var todosCerrados = hitos.length && hitos.every(function (h) { return PY.gruposCerrados[h.hito_id]; });
    // "Todo": sin ancho fijo, la línea de tiempo ocupa exactamente el ancho disponible.
    var px = f.zoom === 'todo' ? 0 : ZOOM[f.zoom];
    var anchoEstimado = f.zoom === 'todo' ? Math.max(300, pxAjustado(r) * r.semanas) : 0;
    var quieto = g.quieto;
    g.quieto = false;
    return '<div class="sx2-card sx2-entra js-py2t-gantt-card' + (g.completa ? ' sx2-py-gantt-card--completa' : '') + '" style="--i:1">' +
      '<div class="sx2-py-gantt-barra">' +
        '<span class="sx2-py-gantt-barra__grupo">' + U.segmento(ZOOMS, f.zoom, 'js-py2t-zoom') +
          U.boton({ texto: 'Hoy', icono: 'calendario', sm: true, clase: 'js-py2t-hoy', titulo: 'Ir a hoy' }) +
          U.boton({ texto: 'Comienzo', icono: 'izquierda', sm: true, variante: 'fantasma', clase: 'js-py2t-inicio', titulo: 'Ir al comienzo del proyecto' }) + '</span>' +
        '<span class="sx2-py-gantt-barra__grupo">' +
          U.segmento([{ id: 'comoda', texto: 'Cómoda' }, { id: 'compacta', texto: 'Compacta' }], densidad, 'js-py2t-densidad') +
          U.chip({ texto: 'Dependencias', icono: 'enlace', activo: g.deps, clase: 'js-py2t-deps' }) +
          // Solo si alguien congeló una línea base (menú Más → Congelar línea base).
          (hayBase ? U.chip({ texto: 'Línea base', icono: 'capas', activo: g.base, clase: 'js-py2t-base', titulo: 'Compara con las fechas congeladas el ' + PY.fecha(ctx.rendimiento.baseline.timestamp, true) }) : '') +
          (hitos.length ? U.boton({ texto: todosCerrados ? 'Expandir hitos' : 'Contraer hitos', icono: todosCerrados ? 'abajo' : 'derecha', sm: true, variante: 'fantasma', clase: 'js-py2t-plegar-todo', datos: { abrir: todosCerrados ? '1' : '0' } }) : '') +
          U.boton({ texto: 'PDF', icono: 'descargar', sm: true, clase: 'js-py2t-gantt-pdf', titulo: 'Descargar esta Carta Gantt en PDF (con los filtros que estás viendo)' }) +
          U.boton({ texto: 'Excel', icono: 'tabla', sm: true, clase: 'js-py2t-gantt-xlsx', titulo: 'Descargar el libro Excel del proyecto (con su Carta Gantt)' }) +
          U.boton({ soloIcono: true, icono: g.completa ? 'reducir' : 'expandir', sm: true, clase: 'js-py2t-completa', titulo: g.completa ? 'Salir de pantalla completa (Esc)' : 'Pantalla completa' }) +
        '</span>' +
      '</div>' +
      PY.gantt(ctx, { tareas: tareas, desde: r.desde, semanas: r.semanas, pxSemana: px, agrupar: true, densidad: densidad, dependencias: g.deps, completa: true, quieto: quieto, anchoEstimado: anchoEstimado,
        lineaBase: hayBase && g.base,
        reprogramable: PY.puedeReprogramar ? function (a) { return PY.puedeReprogramar(ctx, a) && !!a.fecha_compromiso; } : null }) +
      SigsoGantt.aviso(ctx) +
      SigsoGantt.leyenda({ lineaBase: hayBase && g.base }) +
    '</div>';
  }
  var ORDEN_ZOOM = ['semana', 'mes', 'trimestre', 'anio', 'todo'];
  // Esc sale de la pantalla completa del Gantt.
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape' || !g.completa || !document.querySelector('.sx2-py-gantt-card--completa')) return;
    g.completa = false;
    repintarGantt();
  });
  function cambiarZoom(id) {
    f.zoom = id;
    guardarPref('zoom', id);
    g.quieto = true;
    PY.pintar({ sinAnimacion: true });
    var raiz = document.getElementById('proyectos-contenido');
    if (id !== 'todo') PY.ganttCentrarEnHoy(raiz);
  }
  function repintarGantt() { g.quieto = true; PY.pintar({ sinAnimacion: true }); }

  function vacioFiltros() {
    return U.card({ cuerpo: U.vacio({ icono: 'lupa', titulo: 'Ninguna tarea coincide', texto: 'Prueba con otros filtros.',
      accion: U.boton({ texto: 'Limpiar filtros', icono: 'equis', clase: 'js-py2t-limpiar' }) }) });
  }

  function pintar(ctx) {
    reiniciarSiCambioProyecto(ctx);
    // Filtro/modo pedidos desde el Resumen (clic en un KPI o en "Ver…").
    if (PY.filtroTrabajo !== undefined && PY.filtroTrabajo !== null) {
      f.estado = PY.filtroTrabajo || 'todas';
      PY.filtroTrabajo = null;
    }
    if (PY.modoTrabajo) { f.modo = PY.modoTrabajo; PY.modoTrabajo = null; }
    if (PY.responsableTrabajo) { f.responsable = PY.responsableTrabajo; f.hito = ''; PY.responsableTrabajo = null; }
    if (PY.hitoTrabajo) { f.hito = PY.hitoTrabajo; f.responsable = ''; PY.hitoTrabajo = null; }
    var plan = PY.planPorId(ctx);
    var tareas = filtrar(ctx, plan, false);
    var cuerpo;
    if (!ctx.tareas.length) {
      cuerpo = U.card({ cuerpo: U.vacio({ icono: 'tareas', titulo: 'Este proyecto aún no tiene tareas', texto: 'Crea la primera para empezar a planificar.',
        accion: U.boton({ texto: 'Nueva tarea', icono: 'nueva', variante: 'primario', clase: 'js-py2t-nueva' }) }) });
    } else if (f.modo === 'kanban') cuerpo = tareas.length ? kanban(tareas, plan, ctx) : vacioFiltros();
    else if (f.modo === 'gantt') cuerpo = gantt(tareas, ctx);
    else cuerpo = tabla(tareas, plan, ctx);
    return barra(ctx, plan) + cuerpo;
  }

  var tBusqueda_ = null;
  function alMontar(raiz, ctx) {
    if (f.modo === 'gantt') {
      if (f.zoom !== 'todo') PY.ganttCentrarEnHoy(raiz);
      PY.ganttMontar(raiz);
      var sc = raiz.querySelector('.sx2-py-gantt-scroll--completa');
      // Ctrl (o ⌘) + rueda: acercar / alejar el zoom.
      if (sc) sc.addEventListener('wheel', function (ev) {
        if (!ev.ctrlKey && !ev.metaKey) return;
        ev.preventDefault();
        var i = ORDEN_ZOOM.indexOf(f.zoom) + (ev.deltaY > 0 ? 1 : -1);
        if (i < 0 || i >= ORDEN_ZOOM.length) return;
        cambiarZoom(ORDEN_ZOOM[i]);
      }, { passive: false });
    }
    raiz.addEventListener('click', function (ev) {
      var t = ev.target;
      // Casillas de selección: no abren la tarea.
      var cs = t.closest('.js-py2t-sel');
      if (cs) {
        ev.stopPropagation();
        if (cs.checked) sel[cs.getAttribute('data-id')] = true; else delete sel[cs.getAttribute('data-id')];
        PY.pintar({ sinAnimacion: true });
        return;
      }
      var ct = t.closest('.js-py2t-sel-todas');
      if (ct) {
        var plan0 = PY.planPorId(ctx);
        filtrar(ctx, plan0, false).forEach(function (a) {
          if (!seleccionable(ctx, a)) return;
          if (ct.checked) sel[a.actividad_id] = true; else delete sel[a.actividad_id];
        });
        PY.pintar({ sinAnimacion: true });
        return;
      }
      // Un clic al lado de la casilla tampoco abre la tarea.
      if (t.closest('.sx2-py-col-sel')) return;
      if (t.closest('.js-py2t-sel-limpiar')) { sel = {}; PY.pintar({ sinAnimacion: true }); return; }
      if (t.closest('.js-py2t-pasar')) { abrirPasarA(ctx); return; }
      var e = t.closest('.js-py2t-estado');
      if (e) { f.estado = e.getAttribute('data-estado'); PY.pintar({ sinAnimacion: true }); return; }
      var m = t.closest('.js-py2t-modo');
      if (m) {
        f.modo = m.getAttribute('data-id');
        try { localStorage.setItem('sigso_py2_modo_trabajo', f.modo); } catch (er) { /* sin storage */ }
        PY.pintar();
        return;
      }
      var z = t.closest('.js-py2t-zoom');
      if (z) { cambiarZoom(z.getAttribute('data-id')); return; }
      if (t.closest('.js-py2t-hoy')) { PY.ganttCentrarEnHoy(raiz); return; }
      if (t.closest('.js-py2t-inicio')) { PY.ganttIrAlInicio(raiz); return; }
      var dz = t.closest('.js-py2t-densidad');
      if (dz) { g.densidad = dz.getAttribute('data-id'); guardarPref('densidad', g.densidad); repintarGantt(); return; }
      if (t.closest('.js-py2t-deps')) { g.deps = !g.deps; guardarPref('deps', g.deps ? '1' : '0'); repintarGantt(); return; }
      if (t.closest('.js-py2t-base')) { g.base = !g.base; repintarGantt(); return; }
      var pt = t.closest('.js-py2t-plegar-todo');
      if (pt) {
        var abrir = pt.getAttribute('data-abrir') === '1';
        (ctx.detalle.hitos || []).forEach(function (h) { PY.gruposCerrados[h.hito_id] = !abrir; });
        PY.gruposCerrados._ = !abrir;
        repintarGantt();
        return;
      }
      if (t.closest('.js-py2t-completa')) { g.completa = !g.completa; repintarGantt(); return; }
      var dg = t.closest('.js-py2t-gantt-pdf, .js-py2t-gantt-xlsx');
      if (dg) { descargarGantt(ctx, dg.classList.contains('js-py2t-gantt-pdf') ? 'pdf' : 'xlsx', dg); return; }
      if (t.closest('.js-py2t-limpiar')) { f.estado = 'todas'; f.responsable = ''; f.hito = ''; f.texto = ''; PY.pintar({ sinAnimacion: true }); return; }
      if (t.closest('.js-py2t-nueva')) { abrirNuevaTarea(ctx); return; }
      var o = t.closest('.js-py2t-orden');
      if (o) { ordenarPor(o.getAttribute('data-campo')); return; }
      var pl = t.closest('.sx2-py-gantt__plegar');
      if (pl) {
        var grupo = pl.closest('[data-py2-grupo]').getAttribute('data-py2-grupo');
        PY.gruposCerrados[grupo] = !PY.gruposCerrados[grupo];
        repintarGantt();
        return;
      }
      var tarea = t.closest('[data-py2-tarea]');
      if (tarea && PY.abrirTarea) PY.abrirTarea(tarea.getAttribute('data-py2-tarea'));
    });
    raiz.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var o = ev.target.closest('.js-py2t-orden');
      if (o) { ev.preventDefault(); ordenarPor(o.getAttribute('data-campo')); return; }
      var tarea = ev.target.closest('[data-py2-tarea]');
      if (tarea && ev.target === tarea && PY.abrirTarea) { ev.preventDefault(); PY.abrirTarea(tarea.getAttribute('data-py2-tarea')); }
    });
    var buscar = raiz.querySelector('.js-py2t-buscar');
    if (buscar) buscar.addEventListener('input', function () {
      clearTimeout(tBusqueda_);
      tBusqueda_ = setTimeout(function () {
        f.texto = buscar.value;
        PY.pintar({ sinAnimacion: true });
        var n = document.querySelector('.js-py2t-buscar');
        if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
      }, 220);
    });
    var resp = raiz.querySelector('.js-py2t-resp');
    if (resp) resp.addEventListener('change', function () { f.responsable = resp.value; PY.pintar({ sinAnimacion: true }); });
    var hito = raiz.querySelector('.js-py2t-hito');
    if (hito) hito.addEventListener('change', function () { f.hito = hito.value; PY.pintar({ sinAnimacion: true }); });
  }

  // "Descargar Gantt" (auditoría G7): el PDF lleva las tareas que se están viendo
  // (mismos filtros de persona, hito, estado y búsqueda) y dice cuáles son.
  function descargarGantt(ctx, tipo, boton) {
    var plan = PY.planPorId(ctx);
    var p = ctx.proyecto;
    var datos = { proyecto_id: p.proyecto_id };
    if (tipo === 'pdf') {
      var filtros = [];
      if (f.estado !== 'todas') filtros.push({ etiqueta: 'Estado', valor: (ESTADOS.filter(function (e) { return e.id === f.estado; })[0] || {}).texto || f.estado });
      if (f.responsable) filtros.push({ etiqueta: 'Persona', valor: PY.persona(f.responsable).nombre });
      if (f.hito) filtros.push({ etiqueta: 'Hito', valor: f.hito === '_' ? 'Sin hito' : (((ctx.detalle.hitos || []).filter(function (h) { return h.hito_id === f.hito; })[0]) || {}).nombre || '' });
      if (f.texto.trim()) filtros.push({ etiqueta: 'Búsqueda', valor: '“' + f.texto.trim() + '”' });
      if (filtros.length) datos.actividades = filtrar(ctx, plan, false).map(function (a) { return a.actividad_id; });
      datos.filtros = filtros;
    }
    boton.disabled = true;
    PY.aviso(tipo === 'pdf' ? 'Generando la Carta Gantt en PDF…' : 'Generando el Excel…');
    PY.api(tipo === 'pdf' ? 'descargarGanttProyecto' : 'descargarLibroProyecto', datos).then(function (r) {
      boton.disabled = false;
      if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo generar el archivo.', 'error'); return; }
      if (tipo === 'pdf') PY.descargarBase64(r.data.pdf_base64, r.data.filename, 'application/pdf');
      else PY.descargarBase64(r.data.xlsx_base64, r.data.filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    });
  }

  function ordenarPor(campo) {
    f.orden = f.orden.campo === campo ? { campo: campo, dir: -f.orden.dir } : { campo: campo, dir: 1 };
    PY.pintar({ sinAnimacion: true });
  }

  // --- Pasar a… (reasignación en lote) ---------------------------------------------
  // Traspaso dentro del equipo: se conservan estado, avance y fechas.
  function abrirPasarA(ctx) {
    var lista = seleccionadas(ctx);
    if (!lista.length) return;
    var personas = PY.quienesReciben(ctx);
    var MAX = 8;
    PY.formulario({
      titulo: lista.length === 1 ? 'Pasar la tarea a…' : 'Pasar ' + lista.length + ' tareas a…',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Conservan su estado, avance y fechas. Queda registrado y la persona recibe un aviso.</span>',
      boton: 'Pasar',
      campos: PY.campo('Nueva persona responsable', '<select class="sx2-select" name="responsable_email"><option value="">Elige a alguien del equipo…</option>' +
          personas.map(function (p) { return '<option value="' + U.esc(p.email) + '">' + U.esc(p.nombre + (p.cargo ? ' — ' + p.cargo : '')) + '</option>'; }).join('') + '</select>') +
        PY.campo('Motivo (opcional)', '<textarea class="sx2-input" name="motivo" maxlength="500" placeholder="Ej: las ejecuta Valentina desde octubre"></textarea>') +
        '<div class="sx2-campo"><span class="sx2-campo__et">Tareas</span><ul class="sx2-py-pasar-lista">' +
          lista.slice(0, MAX).map(function (a) {
            return '<li><span class="sx2-cortar">' + U.esc(a.titulo) + '</span><small class="sx2-tenue">' + U.esc(PY.persona(a.responsable_email, a.responsable_nombre).nombre) + '</small></li>';
          }).join('') +
          (lista.length > MAX ? '<li class="sx2-tenue">y ' + (lista.length - MAX) + ' más</li>' : '') +
        '</ul></div>',
      preparar: function (x) {
        if (!x.responsable_email) return 'Elige a quién pasarlas.';
        return { proyecto_id: ctx.proyecto.proyecto_id, actividad_ids: JSON.stringify(lista.map(function (a) { return a.actividad_id; })), responsable_email: x.responsable_email, motivo: x.motivo };
      },
      accion: 'reasignarTareasProyecto',
      listo: function (r) {
        var d = (r && r.data) || {};
        sel = {};
        PY.aviso(d.reasignadas
          ? (d.reasignadas === 1 ? 'Tarea pasada a ' : d.reasignadas + ' tareas pasadas a ') + (d.responsable_nombre || d.responsable_email) + '.'
          : 'Ya estaban a nombre de esa persona.', 'exito');
        PY.recargarProyecto();
      }
    });
  }

  // --- Nueva tarea (drawer) --------------------------------------------------------
  function abrirNuevaTarea(ctx) {
    var det = ctx.detalle;
    var hoy = PY.hoyClave();
    var integrantes = PY.quienesReciben(ctx);
    var d = U.drawer({
      titulo: 'Nueva tarea',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(ctx.proyecto.nombre) + '</span>',
      cuerpo: '<form class="sx2-form js-py2t-form" novalidate>' +
        PY.campo('Título', '<input class="sx2-input" name="titulo" required maxlength="160" placeholder="¿Qué hay que hacer?">') +
        PY.campo('Descripción', '<textarea class="sx2-input" name="descripcion" maxlength="2000" placeholder="Detalle, criterio de terminado, enlaces…"></textarea>') +
        PY.campo('Responsable', '<select class="sx2-select" name="responsable_email">' + integrantes.map(function (p) {
          return '<option value="' + U.esc(p.email) + '">' + U.esc(p.nombre + (p.cargo ? ' — ' + p.cargo : '')) + '</option>';
        }).join('') + '</select>') +
        '<div class="sx2-form__fila">' +
          PY.campo('Inicio', '<input class="sx2-input" type="date" name="fecha_inicio_plan" value="' + hoy + '">') +
          PY.campo('Fecha comprometida', '<input class="sx2-input" type="date" name="fecha_compromiso" required>') +
        '</div>' +
        '<div class="sx2-form__fila">' +
          PY.campo('Hito', '<select class="sx2-select" name="hito_id"><option value="">Sin hito</option>' + (det.hitos || []).map(function (h) {
            return '<option value="' + U.esc(h.hito_id) + '">' + U.esc(h.nombre) + '</option>';
          }).join('') + '</select>') +
          PY.campo('Prioridad', '<select class="sx2-select" name="prioridad"><option value="P1">P1 · Crítica</option><option value="P2">P2 · Alta</option><option value="P3" selected>P3 · Media</option><option value="P4">P4 · Baja</option></select>') +
        '</div>' +
        PY.campoColaboradores(ctx, { responsable_email: integrantes[0] ? integrantes[0].email : '', colaboradores: [] }) +
        (PY.campoDependencias ? PY.campoDependencias(ctx, null) : '') +
        '<p class="sx2-campo__error js-py2t-error" hidden></p>' +
      '</form>',
      pie: U.boton({ texto: 'Cancelar', clase: 'js-sx2-drawer-cerrar' }) + U.boton({ texto: 'Crear tarea', icono: 'check', variante: 'primario', clase: 'js-py2t-crear' })
    });
    var form = d.el.querySelector('.js-py2t-form');
    form.querySelector('[name="responsable_email"]').addEventListener('change', function () { PY.sincronizarColaboradores(form); });
    var btn = d.el.querySelector('.js-py2t-crear');
    var err = d.el.querySelector('.js-py2t-error');
    function enviar(ev) {
      if (ev) ev.preventDefault();
      var datos = { proyecto_id: ctx.proyecto.proyecto_id, origen: 'ASIGNADA' };
      new FormData(form).forEach(function (v, k) { if (k !== 'depende_de' && k !== 'colaboradores') datos[k] = String(v).trim(); });
      var colabs = PY.colaboradoresMarcados(form);
      if (colabs.length) datos.colaboradores_emails = JSON.stringify(colabs);
      // Puede depender de varias: todas las casillas marcadas, separadas por coma.
      if (PY.dependenciasMarcadas) datos.depende_de = PY.dependenciasMarcadas(form).join(',');
      if (!datos.titulo || !datos.fecha_compromiso) { err.textContent = 'Completa el título y la fecha comprometida.'; err.hidden = false; return; }
      var resp = integrantes.filter(function (p) { return p.email === datos.responsable_email; })[0];
      if (resp) datos.responsable_nombre = resp.nombre;
      btn.disabled = true;
      PY.api('crearTareaProyecto', datos).then(function (r) {
        btn.disabled = false;
        if (!r || !r.ok) { err.textContent = (r && r.message) || 'No se pudo crear la tarea.'; err.hidden = false; return; }
        d.cerrar();
        PY.aviso('Tarea creada.', 'exito');
        PY.recargarProyecto();
      });
    }
    form.addEventListener('submit', enviar);
    btn.addEventListener('click', enviar);
  }

  PY.secciones.trabajo = { pintar: pintar, alMontar: alMontar };
})();
