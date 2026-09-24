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

  var f = { estado: 'todas', responsable: '', hito: '', texto: '', modo: 'tabla', zoom: 'mes', orden: { campo: 'fin', dir: 1 } };
  try { f.modo = localStorage.getItem('sigso_py2_modo_trabajo') || 'tabla'; } catch (e) { /* sin storage */ }

  var ZOOM = { semana: 110, mes: 46, trimestre: 20 };
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
    { id: 'real', texto: 'Fin real', num: true }, { id: 'avance', texto: 'Avance' }, { id: 'desv', texto: 'Desv. plazo', num: true }
  ];
  function valorOrden(a, p, campo) {
    switch (campo) {
      case 'titulo': return String(a.titulo).toLowerCase();
      case 'resp': return PY.persona(a.responsable_email, a.responsable_nombre).nombre.toLowerCase();
      case 'estado': return a.semaforo_etiqueta || a.estado;
      case 'prio': return a.prioridad || 'P9';
      case 'ini': return new Date(p.plan_inicio || a.fecha_creacion || 0).getTime();
      case 'fin': return new Date(p.plan_fin || a.fecha_compromiso || '9999-12-31').getTime();
      case 'real': return new Date(p.fecha_fin_real || a.fecha_terminada || '9999-12-31').getTime();
      case 'avance': return Number(p.avance_real_pct !== undefined && p.avance_real_pct !== null ? p.avance_real_pct : (a.avance_pct || 0));
      case 'desv': return p.desviacion_dias === null || p.desviacion_dias === undefined ? -9999 : p.desviacion_dias;
    }
    return 0;
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
    return '<div class="sx2-card sx2-card--sin-relleno sx2-entra" style="--i:1"><div class="sx2-tabla-wrap"><table class="sx2-tabla sx2-py-tabla-trabajo"><thead><tr>' +
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
      return '<tr class="sx2-fila--clic" data-py2-tarea="' + U.esc(a.actividad_id) + '" tabindex="0">' +
        '<td class="sx2-py-celda-tarea"><strong class="sx2-cortar">' + U.esc(a.titulo) + '</strong>' +
          (h || a.es_subtarea ? '<span class="sx2-tenue sx2-cortar">' + (a.es_subtarea ? U.ico('derecha', 11) + U.esc(a.padre_titulo || 'Subtarea') : U.ico('bandera', 11) + U.esc(h.nombre)) + '</span>' : '') + '</td>' +
        '<td>' + U.persona(PY.persona(a.responsable_email, a.responsable_nombre)) + '</td>' +
        '<td>' + U.badge(a.semaforo_etiqueta || a.estado, PY.tonoTarea(a)) + '</td>' +
        '<td>' + (a.prioridad ? U.badge(a.prioridad, PRIORIDAD_TONO[a.prioridad] || 'neutro', true) : '—') + '</td>' +
        '<td class="sx2-num">' + PY.fecha(p.plan_inicio || a.fecha_inicio_plan || a.fecha_creacion) + '</td>' +
        '<td class="sx2-num">' + PY.fecha(p.plan_fin || a.fecha_compromiso) + '</td>' +
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
  function gantt(tareas, ctx) {
    var r = PY.ganttRangoProyecto(ctx);
    return '<div class="sx2-card sx2-entra" style="--i:1">' +
      '<div class="sx2-entre" style="margin-bottom:12px;flex-wrap:wrap">' +
        '<span class="sx2-flex sx2-tenue" style="font-size:.8125rem">' + U.ico('bandera', 14) + 'Agrupado por hito · clic en una barra para ver el detalle</span>' +
        '<span class="sx2-flex">' + U.segmento([{ id: 'semana', texto: 'Semana' }, { id: 'mes', texto: 'Mes' }, { id: 'trimestre', texto: 'Trimestre' }], f.zoom, 'js-py2t-zoom') +
          U.boton({ texto: 'Hoy', icono: 'calendario', sm: true, clase: 'js-py2t-hoy' }) + '</span>' +
      '</div>' +
      PY.gantt(ctx, { tareas: tareas, desde: r.desde, semanas: r.semanas, pxSemana: ZOOM[f.zoom], agrupar: true }) +
      leyenda() +
    '</div>';
  }
  function leyenda() {
    return '<div class="sx2-py-leyenda-gantt">' +
      [['info', 'En curso'], ['ok', 'Terminada'], ['alerta', 'En riesgo'], ['critico', 'Atrasada'], ['hito', 'Bloqueada'], ['neutro', 'Pendiente']].map(function (x) {
        return '<span class="sx2-tono-' + x[0] + '"><i></i>' + x[1] + '</span>';
      }).join('') +
      '<span class="sx2-tono-hito"><i class="sx2-py-leyenda-gantt__hito"></i>Hito</span>' +
      '<span><i class="sx2-py-leyenda-gantt__hoy"></i>Hoy</span>' +
    '</div>';
  }

  function vacioFiltros() {
    return U.card({ cuerpo: U.vacio({ icono: 'lupa', titulo: 'Ninguna tarea coincide', texto: 'Prueba con otros filtros.',
      accion: U.boton({ texto: 'Limpiar filtros', icono: 'equis', clase: 'js-py2t-limpiar' }) }) });
  }

  function pintar(ctx) {
    // Filtro/modo pedidos desde el Resumen (clic en un KPI o en "Ver…").
    if (PY.filtroTrabajo !== undefined && PY.filtroTrabajo !== null) {
      f.estado = PY.filtroTrabajo || 'todas';
      PY.filtroTrabajo = null;
    }
    if (PY.modoTrabajo) { f.modo = PY.modoTrabajo; PY.modoTrabajo = null; }
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
    if (f.modo === 'gantt') PY.ganttCentrarEnHoy(raiz);
    raiz.addEventListener('click', function (ev) {
      var t = ev.target;
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
      if (z) { f.zoom = z.getAttribute('data-id'); PY.pintar({ sinAnimacion: true }); PY.ganttCentrarEnHoy(document.getElementById('proyectos-contenido')); return; }
      if (t.closest('.js-py2t-hoy')) { PY.ganttCentrarEnHoy(raiz); return; }
      if (t.closest('.js-py2t-limpiar')) { f.estado = 'todas'; f.responsable = ''; f.hito = ''; f.texto = ''; PY.pintar({ sinAnimacion: true }); return; }
      if (t.closest('.js-py2t-nueva')) { abrirNuevaTarea(ctx); return; }
      var o = t.closest('.js-py2t-orden');
      if (o) { ordenarPor(o.getAttribute('data-campo')); return; }
      var pl = t.closest('.sx2-py-gantt__plegar');
      if (pl) {
        var g = pl.closest('[data-py2-grupo]').getAttribute('data-py2-grupo');
        PY.gruposCerrados[g] = !PY.gruposCerrados[g];
        PY.pintar({ sinAnimacion: true });
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

  function ordenarPor(campo) {
    f.orden = f.orden.campo === campo ? { campo: campo, dir: -f.orden.dir } : { campo: campo, dir: 1 };
    PY.pintar({ sinAnimacion: true });
  }

  // --- Nueva tarea (drawer) --------------------------------------------------------
  function abrirNuevaTarea(ctx) {
    var det = ctx.detalle;
    var hoy = PY.hoyClave();
    var integrantes = (det.integrantes || []).map(function (i) { return PY.persona(i.usuario_email, i.usuario_nombre); });
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
        PY.campo('Depende de', '<select class="sx2-select" name="depende_de"><option value="">No depende de otra tarea</option>' +
          ctx.tareas.filter(function (a) { return !PY.esTerminal(a); }).map(function (a) {
            return '<option value="' + U.esc(a.actividad_id) + '">' + U.esc(a.titulo) + '</option>';
          }).join('') + '</select>', 'No podrá empezar antes de que esa termine.') +
        '<p class="sx2-campo__error js-py2t-error" hidden></p>' +
      '</form>',
      pie: U.boton({ texto: 'Cancelar', clase: 'js-sx2-drawer-cerrar' }) + U.boton({ texto: 'Crear tarea', icono: 'check', variante: 'primario', clase: 'js-py2t-crear' })
    });
    var form = d.el.querySelector('.js-py2t-form');
    var btn = d.el.querySelector('.js-py2t-crear');
    var err = d.el.querySelector('.js-py2t-error');
    function enviar(ev) {
      if (ev) ev.preventDefault();
      var datos = { proyecto_id: ctx.proyecto.proyecto_id, origen: 'ASIGNADA' };
      new FormData(form).forEach(function (v, k) { datos[k] = String(v).trim(); });
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
