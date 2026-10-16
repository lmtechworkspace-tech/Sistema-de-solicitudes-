/**
 * proyectos-v2/panel-tarea.js — el panel ÚNICO de una tarea. Se abre igual
 * desde cualquier sección (Resumen, Trabajo, Equipo…): PY.abrirTarea(id).
 *
 * Pestañas: Detalle · Historial · Archivos. Acciones:
 *  - "Actualizar tarea": UNA sola acción (backend actualizarTareaProyecto)
 *    que reemplaza las dos puertas de v1 (check-in + Registro diario).
 *  - "Editar": datos de la tarea (editarTareaProyecto); cambiar la fecha
 *    comprometida va por reprogramarTareaProyecto, que exige un motivo y
 *    deja la traza de siempre.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;

  // "Actualizar tarea" paso a paso (auditoría 16-10-2026, Etapa 2): primero
  // UNA pregunta con botones grandes; después, solo lo que esa respuesta pide.
  // 'horas' no cambia el estado (al backend va sin acción).
  var ACCIONES = [
    { id: 'avance', texto: 'Avancé', sub: 'Indica cuánto lleva', icono: 'tendencia', tono: 'info', boton: 'Guardar avance' },
    { id: 'listo', texto: 'La terminé', sub: 'Queda cerrada', icono: 'check', tono: 'ok', boton: 'Marcar terminada' },
    { id: 'bloqueo', texto: 'Me bloqueé', sub: 'Algo me impide seguir', icono: 'candado', tono: 'critico', boton: 'Avisar bloqueo' },
    { id: 'desbloqueo', texto: 'Me destrabé', sub: 'Vuelve a estar en curso', icono: 'llave', tono: 'ok', boton: 'Volver a en curso' },
    { id: 'horas', texto: 'Solo anotar horas', sub: 'Sin cambiar el estado', icono: 'reloj', tono: 'neutro', boton: 'Guardar horas' },
    { id: 'sin_cambio', texto: 'Sin cambios por ahora', boton: 'Guardar' }
  ];
  function accionPorId(id) { return ACCIONES.filter(function (x) { return x.id === id; })[0]; }
  var PRIORIDAD = { P1: 'P1 · Crítica', P2: 'P2 · Alta', P3: 'P3 · Media', P4: 'P4 · Baja', P5: 'P5' };

  function trabajaLa(a) {
    var yo = PY.miEmail();
    if (!yo) return false;
    if (String(a.responsable_email || '').toLowerCase() === yo) return true;
    return (a.colaboradores || []).some(function (c) { return String(c.email || '').toLowerCase() === yo; });
  }

  // Decisión del dueño (16-10-2026): en un proyecto, el equipo (líder,
  // integrantes, colaboradores; no observadores) cambia el estado de
  // cualquier tarea. Mismo criterio que Proyectos.esEquipoProyecto_.
  function esEquipo(ctx) {
    if (!ctx || !ctx.proyecto) return false;
    if (PY.miRol() === 'ADM') return true;
    return ['LIDER', 'INTEGRANTE', 'COLABORADOR'].indexOf((ctx.detalle && ctx.detalle.rol_actual) || '') !== -1;
  }
  function puedeEstado(ctx, a) { return trabajaLa(a) || esEquipo(ctx); }
  function soyResponsable(a) { return String(a.responsable_email || '').toLowerCase() === PY.miEmail(); }
  // Quién puede recibir una tarea: integrantes activos que no son observadores.
  function quienesReciben(ctx) {
    return (ctx.detalle.integrantes || []).filter(function (i) { return i.rol_proyecto !== 'OBSERVADOR'; })
      .map(function (i) { return PY.persona(i.usuario_email, i.usuario_nombre); });
  }
  // Colaboradores de la tarea: casillas con el equipo (sin quien es responsable).
  function campoColaboradores(ctx, a) {
    var resp = String((a && a.responsable_email) || '').toLowerCase();
    var marcados = ((a && a.colaboradores) || []).map(function (c) { return String(c.email || '').toLowerCase(); });
    var opciones = quienesReciben(ctx);
    if (opciones.length < 2) return '';
    return '<fieldset class="sx2-py-deps js-py2p-colabs"><legend>Colaboran</legend>' +
      '<div class="sx2-py-deps__lista">' + opciones.map(function (p) {
        var e = String(p.email).toLowerCase();
        return '<label class="sx2-py-deps__op"' + (e === resp ? ' hidden' : '') + '><input type="checkbox" name="colaboradores" value="' + U.esc(e) + '"' + (marcados.indexOf(e) !== -1 ? ' checked' : '') + '>' +
          '<span class="sx2-cortar">' + U.esc(p.nombre + (p.cargo ? ' — ' + p.cargo : '')) + '</span></label>';
      }).join('') + '</div>' +
      '<p class="sx2-campo__ayuda">Quienes colaboran ven la tarea en su Mi trabajo y pueden actualizarla.</p>' +
    '</fieldset>';
  }
  function colaboradoresMarcados(form) {
    return Array.prototype.filter.call(form.querySelectorAll('input[name="colaboradores"]:checked'), function (x) { return !x.closest('label').hidden; })
      .map(function (x) { return x.value; });
  }
  // Al cambiar el responsable, esa persona no puede figurar también como colaboradora.
  function sincronizarColaboradores(form) {
    var sel = form.querySelector('[name="responsable_email"]');
    if (!sel) return;
    var resp = String(sel.value || '').toLowerCase();
    form.querySelectorAll('input[name="colaboradores"]').forEach(function (x) {
      var l = x.closest('label');
      l.hidden = x.value === resp;
      if (l.hidden) x.checked = false;
    });
  }

  function buscar(ctx, id) { return ctx.tareas.filter(function (a) { return a.actividad_id === id; })[0]; }

  // --- Pestañas -------------------------------------------------------------------
  function detalle(ctx, a) {
    var p = PY.planPorId(ctx)[a.actividad_id] || {};
    var resp = PY.persona(a.responsable_email, a.responsable_nombre);
    var hito = (ctx.detalle.hitos || []).filter(function (h) { return h.hito_id === a.hito_id; })[0];
    var esp = p.avance_esperado_pct, real = p.avance_real_pct !== undefined && p.avance_real_pct !== null ? p.avance_real_pct : (a.avance_pct || 0);
    var dd = p.desviacion_dias, dp = p.desviacion_pp;
    var s = '';
    var colaboran = (a.colaboradores || []).filter(function (c) {
      return String(c.email || '').toLowerCase() !== String(a.responsable_email || '').toLowerCase();
    });

    s += seccion('Responsable', '<div class="sx2-entre">' + U.persona(resp, 'lg') +
      (a.responsable_email ? '<a class="sx2-enlace" href="mailto:' + U.esc(a.responsable_email) + '">' + U.ico('correo', 14) + 'Escribir</a>' : '') + '</div>' +
      (colaboran.length ? '<div class="sx2-flex" style="margin-top:8px"><span class="sx2-tenue" style="font-size:.75rem">Colabora:</span>' +
        U.avatares(colaboran.map(function (c) { return PY.persona(c.email, c.nombre); }), 5) + '</div>' : ''));

    if (a.estado === 'BLOQUEADA' && a.bloqueo_motivo) {
      s += '<div class="sx2-py-aviso sx2-tono-hito">' + U.ico('candado', 16) + '<span><strong>Bloqueada:</strong> ' + U.esc(a.bloqueo_motivo) + '</span></div>';
    }
    if (a.dependencia_comprometida) {
      // Con varias dependencias, se nombran solo las atrasadas.
      var atrasadas = (a.dependencias || []).filter(function (d) { return d.atrasada; }).map(function (d) { return d.titulo; });
      var nombres = atrasadas.length ? atrasadas : [a.dependencia_titulo];
      s += '<div class="sx2-py-aviso sx2-tono-critico">' + U.ico('alerta', 16) + '<span>Depende de <strong>' + U.esc(nombres.join(', ')) + '</strong>, ' + (nombres.length > 1 ? 'que están atrasadas' : 'que está atrasada') + '.</span></div>';
    }

    // Control plan vs real: las 4 fechas en una tabla, con el desfase en días
    // de cada extremo (+ = después de lo planificado).
    var iniPlan = a.fecha_inicio_plan || p.plan_inicio || a.fecha_creacion, finPlan = p.plan_fin || a.fecha_compromiso;
    var iniReal = a.fecha_inicio_real || p.fecha_inicio_real, finReal = p.fecha_fin_real || a.fecha_terminada;
    function desfase(real, plan) {
      if (!real || !plan) return '<td class="sx2-num sx2-tenue">—</td>';
      var d = Math.round((new Date(String(real).slice(0, 10)) - new Date(String(plan).slice(0, 10))) / 86400000);
      return '<td class="sx2-num ' + (d > 0 ? 'sx2-delta--mal' : (d < 0 ? 'sx2-delta--bien' : '')) + '">' + (d === 0 ? 'en fecha' : (d > 0 ? '+' : '') + d + ' d') + '</td>';
    }
    // Etapa 3 (16-10-2026): arriba lo que sirve para actuar (quién, estado,
    // cuándo vence, avance, descripción); el control del plan queda plegado.
    var vence = a.fecha_compromiso || a.fecha_propuesta, ddv = PY.diasHasta(vence);
    s += seccion('Estado', '<div class="sx2-flex" style="flex-wrap:wrap;gap:8px">' +
      U.badge({ NO_INICIADA: 'Por empezar', EN_CURSO: 'En curso', BLOQUEADA: 'Bloqueada', EN_REVISION: 'En revisión', TERMINADA: 'Terminada', CANCELADA: 'Cancelada' }[a.estado] || a.estado, PY.tonoTarea(a)) +
      (vence && !PY.esTerminal(a) ? '<span class="' + (ddv !== null && ddv < 0 ? 'sx2-delta--mal' : 'sx2-tenue') + '" style="font-size:.8125rem">' + U.ico('calendario', 13) + ' ' +
        (ddv === null ? '' : (ddv < 0 ? 'Venció hace ' + (-ddv) + (ddv === -1 ? ' día' : ' días') : (ddv === 0 ? 'Vence hoy' : (ddv === 1 ? 'Vence mañana' : 'Vence el ' + PY.fecha(vence, true))))) +
        (!a.confirmada_en && a.fecha_propuesta ? ' · fecha por confirmar' : '') + '</span>' : '') +
    '</div>');
    var ctl = seccion('Fechas', '<div class="sx2-tabla-wrap"><table class="sx2-tabla sx2-py-tabla-fechas"><thead><tr><th></th><th>Plan</th><th>Real</th><th class="sx2-num">Desfase</th></tr></thead><tbody>' +
      '<tr><th scope="row">Inicio</th><td>' + PY.fecha(iniPlan, true) + '</td><td>' + (iniReal ? PY.fecha(iniReal, true) : '<span class="sx2-tenue">Sin iniciar</span>') + '</td>' + desfase(iniReal, iniPlan) + '</tr>' +
      '<tr><th scope="row">Término</th><td>' + PY.fecha(finPlan, true) + '</td><td>' + (finReal ? PY.fecha(finReal, true) : '<span class="sx2-tenue">' + (a.estado === 'NO_INICIADA' ? '—' : 'en curso') + '</span>') + '</td>' + desfase(finReal, finPlan) + '</tr>' +
      '</tbody></table></div>' +
      (Number(a.reprogramaciones) ? '<p class="sx2-tenue" style="font-size:.8125rem;margin-top:6px">Reprogramada ' + a.reprogramaciones + (Number(a.reprogramaciones) === 1 ? ' vez' : ' veces') + '.</p>' : ''));

    s += seccion('Avance', '<div class="sx2-apilado" style="gap:10px">' +
      '<div><div class="sx2-entre"><span class="sx2-tenue">Real</span><strong>' + Math.round(real) + '%</strong></div>' + U.barra(real, PY.tonoTarea(a), true) + '</div>' +
      (esp !== undefined && esp !== null ? '<div><div class="sx2-entre"><span class="sx2-tenue">Esperado a hoy</span><strong>' + Math.round(esp) + '%</strong></div>' + U.barra(esp, 'neutro', true) + '</div>' : '') +
      (a.subtareas_total ? '<span class="sx2-tenue" style="font-size:.8125rem">' + a.subtareas_terminadas + ' de ' + a.subtareas_total + ' subtareas terminadas</span>' : '') +
    '</div>');

    if (a.descripcion) s += seccion('Descripción', '<p class="sx2-py-descripcion">' + U.esc(a.descripcion) + '</p>');

    ctl += seccion('Desviación', '<div class="sx2-py-desv">' +
      desvCaja('Plazo', dd === null || dd === undefined ? '—' : (dd > 0 ? '+' : '') + dd + ' días', dd > 0 ? 'critico' : (dd < 0 ? 'ok' : 'neutro')) +
      desvCaja('Avance', dp === null || dp === undefined ? '—' : (dp > 0 ? '+' : '') + dp + ' pp', dp < 0 ? 'critico' : (dp > 0 ? 'ok' : 'neutro')) +
    '</div>');

    ctl += seccion('Datos', '<dl class="sx2-dato">' +
      '<dt>Plazo</dt><dd>' + U.badge(a.semaforo_etiqueta || a.estado, PY.tonoTarea(a)) + '</dd>' +
      (ctx.proyecto
        ? '<dt>Hito</dt><dd>' + (hito ? U.esc(hito.nombre) : '—') + '</dd>'
        : '<dt>Tipo</dt><dd>Compromiso personal' + (a.origen === 'EMERGENTE' ? ' · no planificado' : '') + '</dd>' +
          (a.proyecto ? '<dt>Etiqueta</dt><dd>' + U.esc(a.proyecto) + '</dd>' : '') +
          (a.recurrencia && a.recurrencia !== 'NINGUNA' ? '<dt>Se repite</dt><dd>' + (a.recurrencia === 'SEMANAL' ? 'Cada semana' : 'Cada mes') + '</dd>' : '')) +
      '<dt>Prioridad</dt><dd>' + U.esc(PRIORIDAD[a.prioridad] || a.prioridad || '—') + '</dd>' +
      (a.dependencia_titulo ? '<dt>Depende de</dt><dd>' + U.esc(a.dependencia_titulo) + '</dd>' : '') +
      (a.impacto_dependientes ? '<dt>Bloquea a</dt><dd>' + a.impacto_dependientes + (a.impacto_dependientes === 1 ? ' tarea' : ' tareas') + '</dd>' : '') +
      (a.es_critica ? '<dt>Ruta crítica</dt><dd>' + U.badge('Sí · sin holgura', 'critico') + '</dd>' : '') +
    '</dl>');

    return s + '<details class="sx2-py-control"' + (verControl_ ? ' open' : '') + '><summary>' + U.ico('grafico', 15) + 'Control del plan <small class="sx2-tenue">fechas plan / real, desviación y datos</small></summary>' + ctl + '</details>';
  }
  // Abierto o cerrado según lo dejó la persona la última vez (en este navegador).
  var verControl_ = false;
  try { verControl_ = localStorage.getItem('sigso_py2_panel_control') === '1'; } catch (e) { /* sin storage */ }
  document.addEventListener('toggle', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('sx2-py-control')) return;
    verControl_ = ev.target.open;
    try { localStorage.setItem('sigso_py2_panel_control', verControl_ ? '1' : '0'); } catch (e) { /* sin storage */ }
  }, true);
  function seccion(titulo, html) {
    return '<section class="sx2-seccion-drawer"><h3 class="sx2-seccion-drawer__titulo">' + U.esc(titulo) + '</h3>' + html + '</section>';
  }
  function desvCaja(etiqueta, valor, tono) {
    return '<div class="sx2-py-desv__caja sx2-tono-' + tono + '"><span>' + U.esc(etiqueta) + '</span><strong>' + U.esc(valor) + '</strong></div>';
  }

  function historial(ctx, a) {
    var items = PY.feed({ tareas: ctx.tareas, bitacora: ctx.bitacora.filter(function (b) { return b.actividad_id === a.actividad_id; }), sala: [] }, 60);
    items.forEach(function (it) { it.objeto = ''; it.actividadId = null; });
    return PY.feedHtml(items);
  }

  function archivos(ctx, a) {
    var docs = (ctx.detalle.documentos || []).filter(function (d) { return d.ref_tipo === 'ACTIVIDAD' && d.ref_id === a.actividad_id; });
    if (!docs.length) return U.vacio({ icono: 'carpeta', titulo: 'Sin archivos', texto: 'Los documentos vinculados a esta tarea aparecen aquí. Puedes vincularlos desde la sección Archivos.' });
    return '<ul class="sx2-lista">' + docs.map(function (d) {
      return '<li><span class="sx2-kpi__ico sx2-tono-primario" style="width:34px;height:34px">' + U.ico('documento', 16) + '</span>' +
        '<span class="sx2-apilado" style="gap:2px;flex:1;min-width:0"><strong class="sx2-cortar">' + U.esc(d.nombre) + '</strong>' +
          '<span class="sx2-tenue" style="font-size:.75rem">' + U.esc((d.categoria || 'Documento') + (d.version_vigente ? ' · v' + d.version_vigente : '') + ' · ' + PY.fecha(d.fecha_creacion, true)) + '</span></span>' +
        U.boton({ soloIcono: true, icono: 'descargar', sm: true, titulo: 'Descargar', clase: 'js-py2p-descargar', datos: { id: d.documento_id } }) + '</li>';
    }).join('') + '</ul>';
  }

  // --- Formularios ------------------------------------------------------------------
  // Lo ya registrado para esa tarea ese día: el formulario lo muestra para
  // corregirlo en vez de empezar en blanco.
  function registroDe(ctx, id, dia) {
    var r = null;
    (ctx.bitacora || []).forEach(function (b) {
      if (b.tipo === 'REGISTRO_DIA' && b.actividad_id === id && b.dia === dia) r = b;
    });
    return r;
  }
  function rellenarDia(form, ctx, a) {
    var r = registroDe(ctx, a.actividad_id, form.querySelector('[name="dia"]').value);
    form.querySelector('[name="horas"]').value = r && Number(r.horas) ? Number(r.horas) : '';
    form.querySelector('[name="nota"]').value = r ? (r.nota || '') : '';
    var aviso = form.querySelector('.js-py2p-ya');
    aviso.hidden = !r;
  }

  function formActualizar(ctx, a, opts) {
    var puedeAvance = puedeEstado(ctx, a) && !PY.esTerminal(a);
    var porEquipo = puedeAvance && !trabajaLa(a);
    var hoy = PY.hoyClave();
    var acciones = ACCIONES.filter(function (x) {
      if (x.id === 'desbloqueo') return a.estado === 'BLOQUEADA';
      if (x.id === 'bloqueo') return a.estado !== 'BLOQUEADA';
      return true;
    });
    var avanceActual = Number(a.avance_pct) || 0;
    function paso(n, titulo, cuerpo, clase, oculto) {
      return '<section class="sx2-py-paso ' + clase + '"' + (oculto ? ' hidden' : '') + '>' +
        '<h3 class="sx2-py-paso__titulo"><span class="sx2-py-paso__n js-py2p-n">' + n + '</span><span class="js-py2p-paso-et">' + titulo + '</span></h3>' + cuerpo + '</section>';
    }
    var grandes = acciones.filter(function (x) { return x.sub; });
    return '<form class="sx2-form js-py2p-form-act" novalidate>' +
      (porEquipo ? '<div class="sx2-py-aviso sx2-tono-info">' + U.ico('equipo', 16) + '<span>La tarea está a nombre de <strong>' + U.esc(PY.persona(a.responsable_email, a.responsable_nombre).nombre) + '</strong>. Como parte del equipo puedes actualizarla; queda registrado que fuiste tú.</span></div>' : '') +
      (puedeAvance
        ? paso(1, '¿Qué pasó con la tarea?',
            '<div class="sx2-py-opciones">' + grandes.map(function (x) {
              return '<button type="button" class="sx2-py-opcion sx2-tono-' + x.tono + ' js-py2p-accion" data-accion="' + x.id + '" aria-pressed="false">' +
                '<span class="sx2-py-opcion__ico">' + U.ico(x.icono, 18) + '</span><span class="sx2-apilado" style="gap:2px;min-width:0"><strong>' + U.esc(x.texto) + '</strong><small>' + U.esc(x.sub) + '</small></span></button>';
            }).join('') + '</div>' +
            '<button type="button" class="sx2-enlace sx2-py-sin-cambio js-py2p-accion" data-accion="sin_cambio" aria-pressed="false">Sin cambios por ahora (la revisé y sigue igual)</button>',
            'js-py2p-paso1')
        : '<div class="sx2-py-aviso sx2-tono-info">' + U.ico('info', 16) + '<span>' + (PY.esTerminal(a) ? 'La tarea está cerrada: puedes registrar horas de un día anterior.' : 'Como no trabajas esta tarea, puedes registrar el día pero no cambiar su avance.') + '</span></div>') +
      paso(2, 'Cuéntanos un poco más',
        '<div class="sx2-campo js-py2p-avance" hidden><span class="sx2-campo__et">¿Cuánto lleva? <strong class="js-py2p-avance-txt">' + avanceActual + '%</strong></span>' +
          '<input type="range" class="sx2-py-rango" name="avance_pct" min="0" max="100" step="5" value="' + avanceActual + '" aria-label="Avance de la tarea"></div>' +
        '<label class="sx2-campo js-py2p-motivo" hidden><span class="sx2-campo__et">¿Qué te impide seguir y quién lo puede destrabar?</span><textarea class="sx2-input" name="bloqueo_motivo" maxlength="500" placeholder="Ej: falta la firma del cliente; lo ve Gerencia"></textarea></label>',
        'js-py2p-paso2', true) +
      paso(3, 'Horas y nota <small class="sx2-tenue">(opcional)</small>',
        '<div class="sx2-form__fila">' +
          '<label class="sx2-campo"><span class="sx2-campo__et js-py2p-dia-et">Día</span><input class="sx2-input" type="date" name="dia" value="' + (opts.dia || hoy) + '" max="' + hoy + '"></label>' +
          PY.campo('Horas trabajadas ese día', '<input class="sx2-input" type="number" name="horas" min="0" max="24" step="0.5" placeholder="Ej: 1.5">') +
        '</div>' +
        '<p class="sx2-campo__ayuda js-py2p-ya" hidden>Ese día ya tiene un registro: lo que cambies aquí lo corrige.</p>' +
        PY.campo('Nota', '<textarea class="sx2-input" name="nota" maxlength="2000" placeholder="Qué hiciste, qué falta, algo que el equipo deba saber…"></textarea>'),
        'js-py2p-paso3', puedeAvance) +
      '<p class="sx2-campo__error js-py2p-error" hidden></p>' +
    '</form>';
  }
  // Muestra lo que pide la respuesta elegida y renumera los pasos visibles.
  function elegirAccion(raiz, id) {
    var x = accionPorId(id) || accionPorId('horas');
    raiz.querySelectorAll('.js-py2p-accion').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-accion') === id ? 'true' : 'false'); });
    var p2 = raiz.querySelector('.js-py2p-paso2'), p3 = raiz.querySelector('.js-py2p-paso3');
    raiz.querySelector('.js-py2p-avance').hidden = id !== 'avance';
    raiz.querySelector('.js-py2p-motivo').hidden = id !== 'bloqueo';
    p2.hidden = id !== 'avance' && id !== 'bloqueo';
    p3.hidden = false;
    var soloHoras = id === 'horas';
    p3.querySelector('.js-py2p-paso-et').innerHTML = soloHoras ? '¿Cuántas horas y qué día?' : 'Horas y nota <small class="sx2-tenue">(opcional)</small>';
    p3.querySelector('.js-py2p-dia-et').textContent = id === 'listo' ? 'Día en que la terminaste' : 'Día';
    var n = 1;
    raiz.querySelectorAll('.sx2-py-paso').forEach(function (s) { if (!s.hidden) s.querySelector('.js-py2p-n').textContent = n++; });
    var g = raiz.querySelector('.js-py2p-guardar-act');
    if (g) { g.disabled = false; g.lastChild.textContent = x.boton; }
    var e = raiz.querySelector('.js-py2p-error');
    if (e) e.hidden = true;
    var foco = id === 'avance' ? raiz.querySelector('[name="avance_pct"]') : (id === 'bloqueo' ? raiz.querySelector('[name="bloqueo_motivo"]') : (soloHoras ? raiz.querySelector('[name="horas"]') : null));
    if (foco) foco.focus();
  }

  // "Depende de" (auditoría 2026-09-29, etapa 4): una tarea puede depender de
  // VARIAS. Lista de casillas con las tareas abiertas del proyecto (más las ya
  // elegidas aunque estén cerradas); se envía como ids separados por coma.
  function idsDependencias(a) { return String((a && a.depende_de) || '').split(/[\s,;]+/).filter(Boolean); }
  function campoDependencias(ctx, a) {
    var elegidas = idsDependencias(a);
    var opciones = ctx.tareas.filter(function (t) {
      return (!a || t.actividad_id !== a.actividad_id) && t.estado !== 'CANCELADA' && (!PY.esTerminal(t) || elegidas.indexOf(t.actividad_id) !== -1);
    });
    if (!opciones.length) return '';
    return '<fieldset class="sx2-py-deps"><legend>Depende de</legend>' +
      '<div class="sx2-py-deps__lista">' + opciones.map(function (t) {
        var on = elegidas.indexOf(t.actividad_id) !== -1;
        return '<label class="sx2-py-deps__op"><input type="checkbox" name="depende_de" value="' + U.esc(t.actividad_id) + '"' + (on ? ' checked' : '') + '>' +
          '<span class="sx2-cortar">' + U.esc(t.titulo) + '</span>' + (PY.esTerminal(t) ? '<small>terminada</small>' : '') + '</label>';
      }).join('') + '</div>' +
      '<p class="sx2-campo__ayuda">No podrá empezar antes de que terminen las que marques. Su inicio de plan pasa al día hábil siguiente a la que termina más tarde.</p>' +
    '</fieldset>';
  }
  function dependenciasMarcadas(form) {
    return Array.prototype.map.call(form.querySelectorAll('input[name="depende_de"]:checked'), function (x) { return x.value; });
  }

  function formEditar(ctx, a) {
    var integrantes = quienesReciben(ctx);
    // El responsable actual siempre aparece, aunque hoy sea observador o ya no esté.
    if (a.responsable_email && !integrantes.some(function (p) { return String(p.email).toLowerCase() === String(a.responsable_email).toLowerCase(); })) {
      integrantes.unshift(PY.persona(a.responsable_email, a.responsable_nombre));
    }
    var reasigna = !!(ctx.detalle.puede_gestionar || soyResponsable(a));
    var comp = a.fecha_compromiso ? String(a.fecha_compromiso).slice(0, 10) : '';
    var p0 = PY.planPorId(ctx)[a.actividad_id] || {};
    function fInput(v) { return v ? String(v).slice(0, 10) : ''; }
    return '<form class="sx2-form js-py2p-form-edit" novalidate>' +
      PY.campo('Título', '<input class="sx2-input" name="titulo" maxlength="160" value="' + U.esc(a.titulo) + '">') +
      PY.campo('Descripción', '<textarea class="sx2-input" name="descripcion" maxlength="2000">' + U.esc(a.descripcion || '') + '</textarea>') +
      PY.campo('Responsable', '<select class="sx2-select" name="responsable_email"' + (reasigna ? '' : ' disabled') + '>' + integrantes.map(function (p) {
        return '<option value="' + U.esc(p.email) + '"' + (String(p.email).toLowerCase() === String(a.responsable_email || '').toLowerCase() ? ' selected' : '') + '>' + U.esc(p.nombre + (p.cargo ? ' — ' + p.cargo : '')) + '</option>';
      }).join('') + '</select>', reasigna
        ? 'Pasarla a otra persona conserva su estado, avance y fecha; queda registrado.'
        : 'Solo el líder o la persona responsable pueden pasarla a otra persona.') +
      campoColaboradores(ctx, a) +
      '<div class="sx2-form__fila">' +
        PY.campo('Fecha comprometida', '<input class="sx2-input" type="date" name="fecha_compromiso" value="' + comp + '">') +
        PY.campo('Prioridad', '<select class="sx2-select" name="prioridad">' + ['P1', 'P2', 'P3', 'P4'].map(function (x) {
          return '<option value="' + x + '"' + (a.prioridad === x ? ' selected' : '') + '>' + PRIORIDAD[x] + '</option>';
        }).join('') + '</select>') +
      '</div>' +
      '<label class="sx2-campo js-py2p-motivo-reprog" hidden><span class="sx2-campo__et">Motivo de la reprogramación</span><textarea class="sx2-input" name="motivo" maxlength="500" placeholder="Toda reprogramación queda registrada con su motivo."></textarea></label>' +
      // Control plan vs real: el término de plan es la "Fecha comprometida" de arriba.
      '<fieldset class="sx2-py-fechas-pr"><legend>Plan y real</legend>' +
        '<div class="sx2-form__fila">' +
          PY.campo('Inicio plan', '<input class="sx2-input" type="date" name="fecha_inicio_plan" value="' + fInput(a.fecha_inicio_plan || p0.plan_inicio) + '">') +
          PY.campo('Inicio real', '<input class="sx2-input" type="date" name="fecha_inicio_real" max="' + PY.hoyClave() + '" value="' + fInput(a.fecha_inicio_real || p0.fecha_inicio_real) + '">') +
        '</div>' +
        (PY.esTerminal(a) && a.estado === 'TERMINADA'
          ? PY.campo('Término real', '<input class="sx2-input" type="date" name="fecha_terminada" max="' + PY.hoyClave() + '" value="' + fInput(a.fecha_terminada) + '">', 'Corrige el día en que de verdad se terminó.')
          : '<p class="sx2-campo__ayuda">El término real se registra al marcar la tarea como terminada.</p>') +
      '</fieldset>' +
      PY.campo('Hito', '<select class="sx2-select" name="hito_id"><option value="">Sin hito</option>' + (ctx.detalle.hitos || []).map(function (h) {
        return '<option value="' + U.esc(h.hito_id) + '"' + (h.hito_id === a.hito_id ? ' selected' : '') + '>' + U.esc(h.nombre) + '</option>';
      }).join('') + '</select>') +
      campoDependencias(ctx, a) +
      '<p class="sx2-campo__error js-py2p-error" hidden></p>' +
    '</form>';
  }

  // --- Panel ------------------------------------------------------------------------
  function abrirTarea(id, opts) {
    opts = opts || {};
    // opts.ctx: datos de OTRO proyecto (Mi trabajo abre tareas de varios);
    // opts.alGuardar: qué refrescar después (por defecto, el proyecto abierto).
    var ctx = opts.ctx || PY.ctx();
    var alGuardar = opts.alGuardar || PY.recargarProyecto;
    var a = buscar(ctx, id);
    if (!a) return;
    var pestana = 'detalle';
    var modo = opts.actualizar ? 'actualizar' : 'ver';
    var puedeGestionar = !!(ctx.detalle && ctx.detalle.puede_gestionar);
    var puedeActualizar = puedeEstado(ctx, a) || puedeGestionar;
    // Tarea entregada que espera revisión: la aprueba o devuelve el líder,
    // el supervisor o un administrador.
    var revisa = a.estado === 'EN_REVISION' && (puedeGestionar || PY.miRol() === 'ADM' ||
      String(a.supervisor_email || '').toLowerCase() === PY.miEmail());
    // Compromiso personal (sin proyecto): no hay edición de proyecto; se
    // reprograma o cancela con las acciones del módulo Actividades.
    var personal = !ctx.proyecto;
    var puedeEditar = !personal && (trabajaLa(a) || puedeGestionar);

    var d = U.drawer({
      titulo: a.titulo,
      subtitulo: '<span class="sx2-flex" style="flex-wrap:wrap">' + U.badge(a.semaforo_etiqueta || a.estado, PY.tonoTarea(a)) +
        (a.prioridad ? U.badge(a.prioridad, a.prioridad === 'P1' ? 'critico' : (a.prioridad === 'P2' ? 'alerta' : 'neutro'), true) : '') +
        (a.es_critica ? U.badge('Ruta crítica', 'critico', true) : '') + '</span>',
      cabeceraExtra: '<div class="sx2-tabs js-py2p-tabs" role="tablist">' +
        [['detalle', 'Detalle'], ['historial', 'Historial']].concat(personal ? [] : [['archivos', 'Archivos']]).map(function (t) {
          return '<button type="button" class="sx2-tabs__op" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === pestana ? 'true' : 'false') + '">' + t[1] + '</button>';
        }).join('') + '</div>',
      cuerpo: '',
      pie: ' '
    });
    var tabs = d.el.querySelector('.js-py2p-tabs');
    var pie = d.el.querySelector('.sx2-drawer__pie');

    function pintarVer() {
      modo = 'ver';
      tabs.hidden = false;
      d.cuerpo(pestana === 'historial' ? historial(ctx, a) : (pestana === 'archivos' ? archivos(ctx, a) : detalle(ctx, a)));
      var abierta = !PY.esTerminal(a);
      pie.innerHTML =
        (personal && abierta && trabajaLa(a) ? U.boton({ texto: 'Reprogramar', icono: 'calendario', clase: 'js-py2p-reprogramar' }) + U.boton({ soloIcono: true, icono: 'basura', variante: 'fantasma', titulo: 'Cancelar tarea', clase: 'js-py2p-cancelar' }) : '') +
        (puedeEditar ? U.boton({ texto: 'Editar', icono: 'editar', clase: 'js-py2p-editar' }) : '') +
        (revisa
          ? U.boton({ texto: 'Devolver', icono: 'izquierda', clase: 'js-py2p-devolver' }) + U.boton({ texto: 'Aprobar', icono: 'check', variante: 'primario', clase: 'js-py2p-aprobar' })
          : (puedeActualizar ? U.boton({ texto: 'Actualizar tarea', icono: 'tendencia', variante: 'primario', clase: 'js-py2p-actualizar' }) : ''));
      pie.hidden = !pie.innerHTML;
    }
    function pintarActualizar() {
      modo = 'actualizar';
      tabs.hidden = true;
      d.cuerpo(formActualizar(ctx, a, opts));
      pie.hidden = false;
      pie.innerHTML = U.boton({ texto: 'Volver', icono: 'izquierda', clase: 'js-py2p-volver' }) +
        U.boton({ texto: 'Guardar', icono: 'check', variante: 'primario', clase: 'js-py2p-guardar-act', deshabilitado: true });
      var rango = d.el.querySelector('.sx2-py-rango');
      if (rango) rango.addEventListener('input', function () { d.el.querySelector('.js-py2p-avance-txt').textContent = rango.value + '%'; });
      var form = d.el.querySelector('.js-py2p-form-act');
      rellenarDia(form, ctx, a);
      form.querySelector('[name="dia"]').addEventListener('change', function () { rellenarDia(form, ctx, a); });
      // Sin derecho a cambiar el estado, solo queda anotar horas: se salta la pregunta.
      // opts.accion: la respuesta ya elegida desde la fila (p. ej. "Me bloqueé").
      var puede = !!form.querySelector('.js-py2p-paso1');
      var pre = opts.accion && form.querySelector('.js-py2p-accion[data-accion="' + opts.accion + '"]') ? opts.accion : '';
      if (!puede) elegirAccion(d.el, 'horas');
      else if (pre) elegirAccion(d.el, pre);
    }
    function pintarEditar() {
      modo = 'editar';
      tabs.hidden = true;
      d.cuerpo(formEditar(ctx, a));
      pie.hidden = false;
      pie.innerHTML = U.boton({ texto: 'Volver', icono: 'izquierda', clase: 'js-py2p-volver' }) +
        U.boton({ texto: 'Guardar cambios', icono: 'check', variante: 'primario', clase: 'js-py2p-guardar-edit' });
      var formE = d.el.querySelector('.js-py2p-form-edit');
      var selResp = formE.querySelector('[name="responsable_email"]');
      if (selResp) selResp.addEventListener('change', function () { sincronizarColaboradores(formE); });
      var fecha = d.el.querySelector('[name="fecha_compromiso"]');
      var original = fecha.value;
      fecha.addEventListener('input', function () { d.el.querySelector('.js-py2p-motivo-reprog').hidden = !original || fecha.value === original; });
    }

    function error(msg) {
      var e = d.el.querySelector('.js-py2p-error');
      if (e) { e.textContent = msg; e.hidden = false; }
    }

    function guardarActualizar(btn) {
      var form = d.el.querySelector('.js-py2p-form-act');
      var sel = d.el.querySelector('.js-py2p-accion[aria-pressed="true"]');
      var elegida = sel ? sel.getAttribute('data-accion') : (form.querySelector('.js-py2p-paso1') ? '' : 'horas');
      if (!elegida) { error('Elige qué pasó con la tarea.'); return; }
      var accion = elegida === 'horas' ? '' : elegida;
      var datos = { proyecto_id: ctx.proyecto ? ctx.proyecto.proyecto_id : '', actividad_id: a.actividad_id, accion: accion,
        dia: form.dia.value, horas: form.horas.value, nota: form.nota.value.trim() };
      if (accion === 'avance') datos.avance_pct = form.avance_pct.value;
      if (accion === 'bloqueo') {
        datos.bloqueo_motivo = form.bloqueo_motivo.value.trim();
        if (!datos.bloqueo_motivo) { error('Indica el motivo del bloqueo.'); return; }
      }
      if (!accion && datos.horas === '') { error('Indica cuántas horas trabajaste ese día.'); return; }
      btn.disabled = true;
      PY.api('actualizarTareaProyecto', datos).then(function (r) {
        btn.disabled = false;
        if (!r || !r.ok) { error((r && r.message) || 'No se pudo guardar.'); return; }
        d.cerrar();
        PY.aviso(accion === 'listo' ? '¡Tarea terminada!' : 'Tarea actualizada.', 'exito');
        alGuardar();
      });
    }

    function guardarEditar(btn) {
      var form = d.el.querySelector('.js-py2p-form-edit');
      var cambios = {};
      ['titulo', 'descripcion', 'prioridad', 'hito_id'].forEach(function (k) {
        var v = form[k].value.trim();
        if (v !== String(a[k] || '')) cambios[k] = v;
      });
      if (!cambios.titulo && cambios.titulo !== undefined) { error('El título no puede quedar vacío.'); return; }
      if (!form.responsable_email.disabled && form.responsable_email.value.toLowerCase() !== String(a.responsable_email || '').toLowerCase()) cambios.responsable_email = form.responsable_email.value;
      if (form.querySelector('.js-py2p-colabs')) {
        var colabs = colaboradoresMarcados(form).sort().join(',');
        var colabsAntes = (a.colaboradores || []).map(function (c) { return String(c.email || '').toLowerCase(); })
          .filter(function (e) { return e !== String(a.responsable_email || '').toLowerCase(); }).sort().join(',');
        if (colabs !== colabsAntes || cambios.responsable_email) cambios.colaboradores_emails = JSON.stringify(colaboradoresMarcados(form));
      }
      var deps = dependenciasMarcadas(form).sort().join(','), depsAntes = idsDependencias(a).sort().join(',');
      if (form.querySelector('.sx2-py-deps') && deps !== depsAntes) cambios.depende_de = deps;
      var fechaNueva = form.fecha_compromiso.value;
      var fechaOriginal = a.fecha_compromiso ? String(a.fecha_compromiso).slice(0, 10) : '';
      var reprog = fechaNueva && fechaOriginal && fechaNueva !== fechaOriginal;
      if (reprog && !form.motivo.value.trim()) { error('Toda reprogramación necesita un motivo.'); return; }
      if (fechaNueva && !fechaOriginal) cambios.fecha_compromiso = fechaNueva;
      // Plan y real: solo se envía lo que la persona cambió respecto de lo mostrado.
      var p0 = PY.planPorId(ctx)[a.actividad_id] || {};
      var mostrado = { fecha_inicio_plan: a.fecha_inicio_plan || p0.plan_inicio, fecha_inicio_real: a.fecha_inicio_real || p0.fecha_inicio_real, fecha_terminada: a.fecha_terminada };
      ['fecha_inicio_plan', 'fecha_inicio_real', 'fecha_terminada'].forEach(function (k) {
        if (!form[k]) return;
        var v = form[k].value;
        if (v !== (mostrado[k] ? String(mostrado[k]).slice(0, 10) : '')) cambios[k] = v;
      });
      if (!Object.keys(cambios).length && !reprog) { pintarVer(); return; }
      btn.disabled = true;
      var base = { proyecto_id: ctx.proyecto.proyecto_id, actividad_id: a.actividad_id };
      var paso1 = Object.keys(cambios).length ? PY.api('editarTareaProyecto', Object.assign({}, base, cambios)) : Promise.resolve({ ok: true });
      paso1.then(function (r) {
        if (!r || !r.ok) throw r;
        return reprog ? PY.api('reprogramarTareaProyecto', Object.assign({}, base, { fecha_compromiso: fechaNueva, motivo: form.motivo.value.trim() })) : { ok: true };
      }).then(function (r) {
        if (!r || !r.ok) throw r;
        d.cerrar();
        PY.aviso('Cambios guardados.', 'exito');
        alGuardar();
      }).catch(function (r) {
        btn.disabled = false;
        error((r && r.message) || 'No se pudieron guardar los cambios.');
      });
    }

    d.el.addEventListener('click', function (ev) {
      var t = ev.target;
      var tab = t.closest('.js-py2p-tabs [data-tab]');
      if (tab) {
        pestana = tab.getAttribute('data-tab');
        tabs.querySelectorAll('[data-tab]').forEach(function (b) { b.setAttribute('aria-selected', b === tab ? 'true' : 'false'); });
        pintarVer();
        return;
      }
      if (t.closest('.js-py2p-actualizar')) { pintarActualizar(); return; }
      if (t.closest('.js-py2p-reprogramar')) { abrirReprogramarPersonal(a, alGuardar); return; }
      if (t.closest('.js-py2p-cancelar')) { abrirCancelarPersonal(a, alGuardar); return; }
      if (t.closest('.js-py2p-editar')) { pintarEditar(); return; }
      var apr = t.closest('.js-py2p-aprobar');
      if (apr) {
        apr.disabled = true;
        PY.api('validarActividad', { actividad_id: a.actividad_id, aprobar: true }).then(function (r) {
          apr.disabled = false;
          if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo aprobar.', 'error'); return; }
          d.cerrar();
          PY.aviso('Tarea aprobada y terminada.', 'exito');
          alGuardar();
        });
        return;
      }
      if (t.closest('.js-py2p-devolver')) {
        PY.formulario({
          titulo: 'Devolver tarea', boton: 'Devolver',
          subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(a.titulo) + '</span>',
          campos: PY.campo('¿Qué falta?', '<textarea class="sx2-input" name="motivo" maxlength="500" placeholder="Quien la entregó verá este comentario."></textarea>'),
          preparar: function (x) { return x.motivo ? { actividad_id: a.actividad_id, aprobar: false, motivo: x.motivo } : 'Cuenta qué falta.'; },
          accion: 'validarActividad', aviso: 'Tarea devuelta.',
          listo: function () { d.cerrar(true); alGuardar(); }
        });
        return;
      }
      if (t.closest('.js-py2p-volver')) { pintarVer(); return; }
      var ac = t.closest('.js-py2p-accion');
      if (ac) { elegirAccion(d.el, ac.getAttribute('data-accion')); return; }
      var g = t.closest('.js-py2p-guardar-act');
      if (g) { guardarActualizar(g); return; }
      var ge = t.closest('.js-py2p-guardar-edit');
      if (ge) { guardarEditar(ge); return; }
      var desc = t.closest('.js-py2p-descargar');
      if (desc) {
        desc.disabled = true;
        PY.api('descargarDocumentoProyecto', { proyecto_id: ctx.proyecto.proyecto_id, documento_id: desc.getAttribute('data-id') }).then(function (r) {
          desc.disabled = false;
          if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo descargar.', 'error'); return; }
          PY.descargarBase64(r.data.contenido_base64, r.data.nombre_archivo, r.data.mime);
        });
      }
    });
    d.el.addEventListener('submit', function (ev) { ev.preventDefault(); });

    if (modo === 'actualizar' && puedeActualizar) pintarActualizar(); else pintarVer();
    return d;
  }

  // --- Compromisos personales -------------------------------------------------------
  // Reprogramar el término de una tarea de PROYECTO con su motivo (RN-703). Lo abre
  // el arrastre del asa en la Carta Gantt con la fecha nueva ya puesta.
  function abrirReprogramarProyecto(ctx, a, fechaNueva) {
    PY.formulario({
      titulo: 'Reprogramar', boton: 'Reprogramar',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(a.titulo) + (a.fecha_compromiso ? ' · hoy vence el ' + PY.fecha(a.fecha_compromiso, true) : '') + '</span>',
      campos: PY.campo('Nueva fecha comprometida', '<input class="sx2-input" type="date" name="fecha_compromiso" value="' + U.esc(fechaNueva || '') + '">') +
        PY.campo('Motivo', '<textarea class="sx2-input" name="motivo" maxlength="500" placeholder="Toda reprogramación queda registrada con su motivo."></textarea>'),
      preparar: function (d) {
        if (!d.fecha_compromiso) return 'Indica la nueva fecha.';
        if (!d.motivo) return 'Toda reprogramación necesita un motivo.';
        return { proyecto_id: ctx.proyecto.proyecto_id, actividad_id: a.actividad_id, fecha_compromiso: d.fecha_compromiso, motivo: d.motivo };
      },
      accion: 'reprogramarTareaProyecto', aviso: 'Tarea reprogramada.'
    });
  }

  function abrirReprogramarPersonal(a, alGuardar) {
    PY.formulario({
      titulo: 'Reprogramar', boton: 'Reprogramar',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(a.titulo) + (a.fecha_compromiso ? ' · hoy vence el ' + PY.fecha(a.fecha_compromiso, true) : '') + '</span>',
      campos: PY.campo('Nueva fecha', '<input class="sx2-input" type="date" name="fecha_compromiso" value="' + (a.fecha_compromiso ? String(a.fecha_compromiso).slice(0, 10) : '') + '">') +
        PY.campo('Motivo', '<textarea class="sx2-input" name="motivo" maxlength="500" placeholder="Toda reprogramación queda registrada con su motivo."></textarea>'),
      preparar: function (d) {
        if (!d.fecha_compromiso) return 'Indica la nueva fecha.';
        if (!d.motivo) return 'Indica el motivo.';
        return { actividad_id: a.actividad_id, fecha_compromiso: d.fecha_compromiso, motivo: d.motivo };
      },
      accion: 'reprogramarActividad', aviso: 'Tarea reprogramada.', listo: function () { alGuardar(); }
    });
  }
  function abrirCancelarPersonal(a, alGuardar) {
    PY.formulario({
      titulo: 'Cancelar tarea', boton: 'Cancelar tarea',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(a.titulo) + '</span>',
      campos: PY.campo('Motivo', '<textarea class="sx2-input" name="motivo" maxlength="500" placeholder="Por qué ya no se hará"></textarea>'),
      preparar: function (d) { return d.motivo ? { actividad_id: a.actividad_id, motivo: d.motivo } : 'Indica el motivo.'; },
      accion: 'cancelarActividad', aviso: 'Tarea cancelada.', listo: function () { alGuardar(); }
    });
  }

  // Misma forma que Proyectos.filaBitacoraSalida_ (backend): getDetalleActividad
  // devuelve las filas crudas, con los datos del día dentro de 'datos'.
  function bitacoraSalida(b) {
    var d = {};
    try { d = b.datos ? JSON.parse(b.datos) : {}; } catch (e) { d = {}; }
    var s = { actividad_id: b.actividad_id, tipo: b.tipo, nota: b.nota, horas: d.horas, timestamp: b.timestamp, autor_nombre: b.autor_nombre || b.autor_email, autor_email: b.autor_email };
    if (b.tipo === 'REGISTRO_DIA') { s.dia = d.dia || ''; s.estado_dia = d.estado_dia || ''; s.editado_en = d.editado_en || ''; }
    if (b.tipo === 'REPROGRAMACION') { s.fecha_anterior = d.fecha_anterior || ''; s.fecha_nueva = d.fecha_nueva || ''; }
    return s;
  }
  function colaboradores(v) {
    var lista = v;
    if (typeof v === 'string') { try { lista = JSON.parse(v || '[]'); } catch (e) { lista = []; } }
    return (Array.isArray(lista) ? lista : []).map(function (c) { return typeof c === 'string' ? { email: c } : c; });
  }

  // Abre el panel de un compromiso PERSONAL (sin proyecto). opts.base: la fila
  // de Mi trabajo (trae el semáforo calculado por el backend).
  function abrirTareaPersonal(actividadId, opts) {
    opts = opts || {};
    return Promise.all([PY.api('getDetalleActividad', { actividad_id: actividadId }), PY.cargarMiPerfil()]).then(function (r) {
      if (!r[0] || !r[0].ok) { PY.aviso((r[0] && r[0].message) || 'No se pudo abrir la tarea.', 'error'); return null; }
      var act = Object.assign({}, r[0].data.actividad, opts.base ? { semaforo: opts.base.semaforo, semaforo_etiqueta: opts.base.semaforo_etiqueta } : {});
      act.colaboradores = colaboradores(act.colaboradores);
      var ctx = {
        detalle: { integrantes: [], hitos: [], documentos: [], puede_gestionar: false }, proyecto: null,
        tareas: [act], sala: [], bitacora: (r[0].data.bitacora || []).map(bitacoraSalida), rendimiento: null
      };
      return abrirTarea(actividadId, Object.assign({}, opts, { ctx: ctx }));
    });
  }

  // Abre el panel de una tarea de CUALQUIER proyecto sin salir de la vista
  // actual (Mi trabajo, Calendario): carga ese proyecto por detrás.
  // Abrir varias tareas del mismo proyecto seguidas no vuelve a cargarlo
  // (Etapa 2): se reutiliza por 45 s y se olvida al guardar cualquier cambio.
  var cacheProy_ = {};
  var VIDA_CACHE_MS = 45000;
  function olvidarProyecto(id) { if (id) delete cacheProy_[id]; else cacheProy_ = {}; }
  function abrirTareaDeProyecto(proyectoId, actividadId, opts) {
    opts = opts || {};
    var datos = { proyecto_id: proyectoId };
    var c = cacheProy_[proyectoId];
    if (!c || Date.now() - c.t > VIDA_CACHE_MS) {
      PY.aviso('Abriendo la tarea…');
      c = cacheProy_[proyectoId] = { t: Date.now(), promesa: Promise.all([
        PY.api('getDetalleCompletoProyecto', datos),
        PY.api('listarBitacoraProyecto', datos),
        PY.cargarMiPerfil()
      ]) };
    }
    var alGuardar = opts.alGuardar;
    opts = Object.assign({}, opts, { alGuardar: function () { olvidarProyecto(proyectoId); if (alGuardar) alGuardar(); else PY.recargarProyecto(); } });
    return c.promesa.then(function (r) {
      if (!r[0] || !r[0].ok) { olvidarProyecto(proyectoId); PY.aviso((r[0] && r[0].message) || 'No se pudo abrir la tarea.', 'error'); return null; }
      var ctx = {
        detalle: r[0].data.detalle, proyecto: r[0].data.detalle.proyecto, tareas: r[0].data.tareas || [],
        sala: r[0].data.sala || [], bitacora: (r[1] && r[1].ok) ? (r[1].data || []) : [], rendimiento: null
      };
      return abrirTarea(actividadId, Object.assign({}, opts, { ctx: ctx }));
    });
  }

  PY.abrirTarea = abrirTarea;
  PY.campoDependencias = campoDependencias;
  PY.abrirReprogramarProyecto = abrirReprogramarProyecto;
  // ¿Puede esta persona reprogramar la tarea? (mismo criterio que "Editar").
  PY.puedeReprogramar = function (ctx, a) {
    return !!(ctx && ctx.proyecto && a && !PY.esTerminal(a) && (trabajaLa(a) || (ctx.detalle && ctx.detalle.puede_gestionar)));
  };
  PY.dependenciasMarcadas = dependenciasMarcadas;
  PY.quienesReciben = quienesReciben;
  PY.puedeEstado = puedeEstado;
  PY.campoColaboradores = campoColaboradores;
  PY.colaboradoresMarcados = colaboradoresMarcados;
  PY.sincronizarColaboradores = sincronizarColaboradores;
  PY.abrirTareaDeProyecto = abrirTareaDeProyecto;
  PY.olvidarProyectoCacheado = olvidarProyecto;
  PY.abrirTareaPersonal = abrirTareaPersonal;
})();
