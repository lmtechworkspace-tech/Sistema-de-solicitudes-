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

  var ACCIONES = [
    { id: 'avance', texto: 'Avancé', icono: 'tendencia', tono: 'info' },
    { id: 'sin_cambio', texto: 'Sin cambios', icono: 'estado', tono: 'neutro' },
    { id: 'bloqueo', texto: 'Me bloqueé', icono: 'candado', tono: 'critico' },
    { id: 'desbloqueo', texto: 'Me destrabé', icono: 'llave', tono: 'ok' },
    { id: 'listo', texto: 'La terminé', icono: 'check', tono: 'ok' }
  ];
  var PRIORIDAD = { P1: 'P1 · Crítica', P2: 'P2 · Alta', P3: 'P3 · Media', P4: 'P4 · Baja', P5: 'P5' };

  function trabajaLa(a) {
    var yo = PY.miEmail();
    if (!yo) return false;
    if (String(a.responsable_email || '').toLowerCase() === yo) return true;
    return (a.colaboradores || []).some(function (c) { return String(c.email || '').toLowerCase() === yo; });
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
      s += '<div class="sx2-py-aviso sx2-tono-critico">' + U.ico('alerta', 16) + '<span>Depende de <strong>' + U.esc(a.dependencia_titulo) + '</strong>, que está atrasada.</span></div>';
    }

    s += seccion('Fechas', '<dl class="sx2-dato">' +
      '<dt>Planificada</dt><dd>' + PY.fecha(p.plan_inicio || a.fecha_inicio_plan || a.fecha_creacion, true) + ' → ' + PY.fecha(p.plan_fin || a.fecha_compromiso, true) + '</dd>' +
      '<dt>Real</dt><dd>' + (p.fecha_inicio_real ? PY.fecha(p.fecha_inicio_real, true) : 'Sin iniciar') + ' → ' +
        (p.fecha_fin_real || a.fecha_terminada ? PY.fecha(p.fecha_fin_real || a.fecha_terminada, true) : (a.estado === 'NO_INICIADA' ? '—' : 'en curso')) + '</dd>' +
      (Number(a.reprogramaciones) ? '<dt>Reprogramada</dt><dd>' + a.reprogramaciones + (Number(a.reprogramaciones) === 1 ? ' vez' : ' veces') + '</dd>' : '') +
    '</dl>');

    s += seccion('Avance', '<div class="sx2-apilado" style="gap:10px">' +
      '<div><div class="sx2-entre"><span class="sx2-tenue">Real</span><strong>' + Math.round(real) + '%</strong></div>' + U.barra(real, PY.tonoTarea(a), true) + '</div>' +
      (esp !== undefined && esp !== null ? '<div><div class="sx2-entre"><span class="sx2-tenue">Esperado a hoy</span><strong>' + Math.round(esp) + '%</strong></div>' + U.barra(esp, 'neutro', true) + '</div>' : '') +
      (a.subtareas_total ? '<span class="sx2-tenue" style="font-size:.8125rem">' + a.subtareas_terminadas + ' de ' + a.subtareas_total + ' subtareas terminadas</span>' : '') +
    '</div>');

    s += seccion('Desviación', '<div class="sx2-py-desv">' +
      desvCaja('Plazo', dd === null || dd === undefined ? '—' : (dd > 0 ? '+' : '') + dd + ' días', dd > 0 ? 'critico' : (dd < 0 ? 'ok' : 'neutro')) +
      desvCaja('Avance', dp === null || dp === undefined ? '—' : (dp > 0 ? '+' : '') + dp + ' pp', dp < 0 ? 'critico' : (dp > 0 ? 'ok' : 'neutro')) +
    '</div>');

    s += seccion('Datos', '<dl class="sx2-dato">' +
      '<dt>Estado</dt><dd>' + U.badge(a.semaforo_etiqueta || a.estado, PY.tonoTarea(a)) + '</dd>' +
      '<dt>Hito</dt><dd>' + (hito ? U.esc(hito.nombre) : '—') + '</dd>' +
      '<dt>Prioridad</dt><dd>' + U.esc(PRIORIDAD[a.prioridad] || a.prioridad || '—') + '</dd>' +
      (a.dependencia_titulo ? '<dt>Depende de</dt><dd>' + U.esc(a.dependencia_titulo) + '</dd>' : '') +
      (a.impacto_dependientes ? '<dt>Bloquea a</dt><dd>' + a.impacto_dependientes + (a.impacto_dependientes === 1 ? ' tarea' : ' tareas') + '</dd>' : '') +
      (a.es_critica ? '<dt>Ruta crítica</dt><dd>' + U.badge('Sí · sin holgura', 'critico') + '</dd>' : '') +
    '</dl>');

    if (a.descripcion) s += seccion('Descripción', '<p class="sx2-py-descripcion">' + U.esc(a.descripcion) + '</p>');
    return s;
  }
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
  function formActualizar(ctx, a, opts) {
    var puedeAvance = trabajaLa(a) && !PY.esTerminal(a);
    var hoy = PY.hoyClave();
    var acciones = ACCIONES.filter(function (x) {
      if (x.id === 'desbloqueo') return a.estado === 'BLOQUEADA';
      if (x.id === 'bloqueo') return a.estado !== 'BLOQUEADA';
      return true;
    });
    var avanceActual = Number(a.avance_pct) || 0;
    return '<form class="sx2-form js-py2p-form-act" novalidate>' +
      (puedeAvance
        ? '<div class="sx2-campo"><span class="sx2-campo__et">¿Qué pasó con la tarea?</span><div class="sx2-chips">' +
            acciones.map(function (x) { return U.chip({ texto: x.texto, icono: x.icono, tono: x.tono, clase: 'js-py2p-accion', datos: { accion: x.id } }); }).join('') +
            U.chip({ texto: 'Solo registrar horas', icono: 'reloj', clase: 'js-py2p-accion', datos: { accion: '' }, activo: true }) +
          '</div></div>'
        : '<div class="sx2-py-aviso sx2-tono-info">' + U.ico('info', 16) + '<span>' + (PY.esTerminal(a) ? 'La tarea está cerrada: puedes registrar horas de un día anterior.' : 'Como no trabajas esta tarea, puedes registrar el día pero no cambiar su avance.') + '</span></div>') +
      '<div class="sx2-campo js-py2p-avance" hidden><span class="sx2-campo__et">Avance de la tarea <strong class="js-py2p-avance-txt">' + avanceActual + '%</strong></span>' +
        '<input type="range" class="sx2-py-rango" name="avance_pct" min="0" max="100" step="5" value="' + avanceActual + '" aria-label="Avance de la tarea"></div>' +
      '<label class="sx2-campo js-py2p-motivo" hidden><span class="sx2-campo__et">Motivo del bloqueo</span><textarea class="sx2-input" name="bloqueo_motivo" maxlength="500" placeholder="¿Qué te impide avanzar y quién lo puede destrabar?"></textarea></label>' +
      '<div class="sx2-form__fila">' +
        PY.campo('Día', '<input class="sx2-input" type="date" name="dia" value="' + (opts.dia || hoy) + '" max="' + hoy + '">') +
        PY.campo('Horas trabajadas ese día', '<input class="sx2-input" type="number" name="horas" min="0" max="24" step="0.5" placeholder="Opcional">') +
      '</div>' +
      PY.campo('Nota', '<textarea class="sx2-input" name="nota" maxlength="2000" placeholder="Qué hiciste, qué falta, algo que el equipo deba saber…"></textarea>') +
      '<p class="sx2-campo__error js-py2p-error" hidden></p>' +
    '</form>';
  }

  function formEditar(ctx, a) {
    var integrantes = (ctx.detalle.integrantes || []).map(function (i) { return PY.persona(i.usuario_email, i.usuario_nombre); });
    var comp = a.fecha_compromiso ? String(a.fecha_compromiso).slice(0, 10) : '';
    return '<form class="sx2-form js-py2p-form-edit" novalidate>' +
      PY.campo('Título', '<input class="sx2-input" name="titulo" maxlength="160" value="' + U.esc(a.titulo) + '">') +
      PY.campo('Descripción', '<textarea class="sx2-input" name="descripcion" maxlength="2000">' + U.esc(a.descripcion || '') + '</textarea>') +
      PY.campo('Responsable', '<select class="sx2-select" name="responsable_email">' + integrantes.map(function (p) {
        return '<option value="' + U.esc(p.email) + '"' + (String(p.email).toLowerCase() === String(a.responsable_email || '').toLowerCase() ? ' selected' : '') + '>' + U.esc(p.nombre + (p.cargo ? ' — ' + p.cargo : '')) + '</option>';
      }).join('') + '</select>', 'Reasignar reinicia la confirmación: la nueva persona debe aceptar el compromiso.') +
      '<div class="sx2-form__fila">' +
        PY.campo('Fecha comprometida', '<input class="sx2-input" type="date" name="fecha_compromiso" value="' + comp + '">') +
        PY.campo('Prioridad', '<select class="sx2-select" name="prioridad">' + ['P1', 'P2', 'P3', 'P4'].map(function (x) {
          return '<option value="' + x + '"' + (a.prioridad === x ? ' selected' : '') + '>' + PRIORIDAD[x] + '</option>';
        }).join('') + '</select>') +
      '</div>' +
      '<label class="sx2-campo js-py2p-motivo-reprog" hidden><span class="sx2-campo__et">Motivo de la reprogramación</span><textarea class="sx2-input" name="motivo" maxlength="500" placeholder="Toda reprogramación queda registrada con su motivo."></textarea></label>' +
      PY.campo('Hito', '<select class="sx2-select" name="hito_id"><option value="">Sin hito</option>' + (ctx.detalle.hitos || []).map(function (h) {
        return '<option value="' + U.esc(h.hito_id) + '"' + (h.hito_id === a.hito_id ? ' selected' : '') + '>' + U.esc(h.nombre) + '</option>';
      }).join('') + '</select>') +
      '<p class="sx2-campo__error js-py2p-error" hidden></p>' +
    '</form>';
  }

  // --- Panel ------------------------------------------------------------------------
  function abrirTarea(id, opts) {
    opts = opts || {};
    var ctx = PY.ctx();
    var a = buscar(ctx, id);
    if (!a) return;
    var pestana = 'detalle';
    var modo = opts.actualizar ? 'actualizar' : 'ver';
    var puedeGestionar = !!(ctx.detalle && ctx.detalle.puede_gestionar);
    var puedeActualizar = trabajaLa(a) || puedeGestionar;
    var puedeEditar = trabajaLa(a) || puedeGestionar;

    var d = U.drawer({
      titulo: a.titulo,
      subtitulo: '<span class="sx2-flex" style="flex-wrap:wrap">' + U.badge(a.semaforo_etiqueta || a.estado, PY.tonoTarea(a)) +
        (a.prioridad ? U.badge(a.prioridad, a.prioridad === 'P1' ? 'critico' : (a.prioridad === 'P2' ? 'alerta' : 'neutro'), true) : '') +
        (a.es_critica ? U.badge('Ruta crítica', 'critico', true) : '') + '</span>',
      cabeceraExtra: '<div class="sx2-tabs js-py2p-tabs" role="tablist">' +
        [['detalle', 'Detalle'], ['historial', 'Historial'], ['archivos', 'Archivos']].map(function (t) {
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
      pie.innerHTML =
        (puedeEditar ? U.boton({ texto: 'Editar', icono: 'editar', clase: 'js-py2p-editar' }) : '') +
        (puedeActualizar ? U.boton({ texto: 'Actualizar tarea', icono: 'tendencia', variante: 'primario', clase: 'js-py2p-actualizar' }) : '');
      pie.hidden = !pie.innerHTML;
    }
    function pintarActualizar() {
      modo = 'actualizar';
      tabs.hidden = true;
      d.cuerpo(formActualizar(ctx, a, opts));
      pie.hidden = false;
      pie.innerHTML = U.boton({ texto: 'Volver', icono: 'izquierda', clase: 'js-py2p-volver' }) +
        U.boton({ texto: 'Guardar', icono: 'check', variante: 'primario', clase: 'js-py2p-guardar-act' });
      var rango = d.el.querySelector('.sx2-py-rango');
      if (rango) rango.addEventListener('input', function () { d.el.querySelector('.js-py2p-avance-txt').textContent = rango.value + '%'; });
    }
    function pintarEditar() {
      modo = 'editar';
      tabs.hidden = true;
      d.cuerpo(formEditar(ctx, a));
      pie.hidden = false;
      pie.innerHTML = U.boton({ texto: 'Volver', icono: 'izquierda', clase: 'js-py2p-volver' }) +
        U.boton({ texto: 'Guardar cambios', icono: 'check', variante: 'primario', clase: 'js-py2p-guardar-edit' });
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
      var accion = sel ? sel.getAttribute('data-accion') : '';
      var datos = { proyecto_id: ctx.proyecto.proyecto_id, actividad_id: a.actividad_id, accion: accion,
        dia: form.dia.value, horas: form.horas.value, nota: form.nota.value.trim() };
      if (accion === 'avance') datos.avance_pct = form.avance_pct.value;
      if (accion === 'bloqueo') {
        datos.bloqueo_motivo = form.bloqueo_motivo.value.trim();
        if (!datos.bloqueo_motivo) { error('Indica el motivo del bloqueo.'); return; }
      }
      if (!accion && datos.horas === '') { error('Elige qué pasó con la tarea o registra las horas del día.'); return; }
      btn.disabled = true;
      PY.api('actualizarTareaProyecto', datos).then(function (r) {
        btn.disabled = false;
        if (!r || !r.ok) { error((r && r.message) || 'No se pudo guardar.'); return; }
        d.cerrar();
        PY.aviso(accion === 'listo' ? '¡Tarea terminada!' : 'Tarea actualizada.', 'exito');
        PY.recargarProyecto();
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
      if (form.responsable_email.value.toLowerCase() !== String(a.responsable_email || '').toLowerCase()) cambios.responsable_email = form.responsable_email.value;
      var fechaNueva = form.fecha_compromiso.value;
      var fechaOriginal = a.fecha_compromiso ? String(a.fecha_compromiso).slice(0, 10) : '';
      var reprog = fechaNueva && fechaOriginal && fechaNueva !== fechaOriginal;
      if (reprog && !form.motivo.value.trim()) { error('Toda reprogramación necesita un motivo.'); return; }
      if (fechaNueva && !fechaOriginal) cambios.fecha_compromiso = fechaNueva;
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
        PY.recargarProyecto();
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
      if (t.closest('.js-py2p-editar')) { pintarEditar(); return; }
      if (t.closest('.js-py2p-volver')) { pintarVer(); return; }
      var ac = t.closest('.js-py2p-accion');
      if (ac) {
        d.el.querySelectorAll('.js-py2p-accion').forEach(function (b) { b.setAttribute('aria-pressed', b === ac ? 'true' : 'false'); });
        var acc = ac.getAttribute('data-accion');
        d.el.querySelector('.js-py2p-avance').hidden = acc !== 'avance';
        d.el.querySelector('.js-py2p-motivo').hidden = acc !== 'bloqueo';
        var e = d.el.querySelector('.js-py2p-error');
        if (e) e.hidden = true;
        return;
      }
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

  PY.abrirTarea = abrirTarea;
})();
