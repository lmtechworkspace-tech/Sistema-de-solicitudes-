/**
 * proyectos-v2/proyecto-acciones.js — lo que en v1 colgaba del proyecto y
 * no es de ninguna sección:
 *  - La Sala (drawer): publicar con tipo y menciones, adjuntar un archivo,
 *    descargar adjuntos y convertir una publicación en tarea.
 *  - El menú "Más" de la cabecera: editar proyecto, configurar el informe
 *    PDF, guardar como plantilla, congelar la línea base y cerrar el proyecto.
 *  - PY.sobreProyecto(ctx): descripción, objetivo, líder y origen (Resumen).
 * Mismos endpoints y permisos que v1.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;

  var TIPOS_SALA = [
    { id: 'COMENTARIO', texto: 'Comentario', icono: 'comentario' },
    { id: 'ACTUALIZACION', texto: 'Actualización', icono: 'tendencia' },
    { id: 'DECISION', texto: 'Decisión', icono: 'check' },
    { id: 'REUNION', texto: 'Reunión', icono: 'calendario' },
    { id: 'BLOQUEO', texto: 'Bloqueo', icono: 'candado' }
  ];
  var TIPO_TEXTO = {
    ACTUALIZACION: 'Actualización', COMENTARIO: 'Comentario', DECISION: 'Decisión', REUNION: 'Reunión',
    BLOQUEO: 'Bloqueo', SOLICITUD_LIDER: 'Solicitud del líder', ARCHIVO: 'Archivo', ENTREGABLE: 'Entregable', RIESGO: 'Riesgo'
  };
  var TIPO_TONO = { ACTUALIZACION: 'info', DECISION: 'ok', REUNION: 'primario', BLOQUEO: 'critico', SOLICITUD_LIDER: 'alerta', ARCHIVO: 'hito', RIESGO: 'alerta' };
  var CONVERTIBLES = { COMENTARIO: true, SOLICITUD_LIDER: true, DECISION: true, REUNION: true };
  var SECCIONES_INFORME = [
    ['portada', 'Portada'], ['narrativa', 'Resumen ejecutivo (narrativo)', 1], ['ficha', 'Ficha resumen', 1],
    ['kpis', 'Indicadores clave (KPIs)', 1], ['salud', 'Salud detallada'], ['mini_gantt', 'Plan semana a semana', 1],
    ['hitos', 'Hitos', 1], ['riesgos', 'Riesgos abiertos', 1], ['vencimientos', 'Próximos vencimientos', 1],
    ['rendimiento', 'Rendimiento', 1], ['desviaciones', 'Plan · Esperado · Real'], ['gantt', 'Carta Gantt completa'],
    ['workload', 'Carga por persona'], ['bitacora', 'Actividad reciente', 1], ['leyenda', 'Leyenda']
  ];
  var ACEPTA = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.webp';

  function gestiona(ctx) { return !!(ctx.detalle && ctx.detalle.puede_gestionar); }
  function fechaInput(v) { return v ? String(v).slice(0, 10) : ''; }
  function nota(t) { return '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(t) + '</span>'; }
  function selectIntegrantes(ctx, nombre, actual) {
    return '<select class="sx2-select" name="' + nombre + '">' + (ctx.detalle.integrantes || []).map(function (i) {
      var p = PY.persona(i.usuario_email, i.usuario_nombre);
      return '<option value="' + U.esc(i.usuario_email) + '"' + (String(i.usuario_email).toLowerCase() === String(actual || '').toLowerCase() ? ' selected' : '') + '>' +
        U.esc(p.nombre + (p.cargo ? ' — ' + p.cargo : '')) + '</option>';
    }).join('') + '</select>';
  }

  // =========================================================================
  // Cabecera: Sala + menú "Más"
  // =========================================================================
  function accionesCabecera(ctx) {
    var n = (ctx.sala || []).length;
    return U.boton({ texto: 'Sala' + (n ? ' · ' + n : ''), icono: 'comentario', clase: 'js-py2-sala', titulo: 'Conversación del proyecto' }) +
      '<span class="sx2-menu-ancla">' + U.boton({ soloIcono: true, icono: 'menu', titulo: 'Más acciones', clase: 'js-py2-mas' }) + '</span>';
  }

  var menuAbierto_ = null;
  function cerrarMenu() {
    if (!menuAbierto_) return;
    menuAbierto_.remove();
    menuAbierto_ = null;
    document.removeEventListener('click', fueraDelMenu, true);
    document.removeEventListener('keydown', escMenu, true);
  }
  function fueraDelMenu(ev) { if (menuAbierto_ && !ev.target.closest('.sx2-menu-ancla')) cerrarMenu(); }
  function escMenu(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); cerrarMenu(); } }

  function item(id, icono, texto, sub, peligro) {
    return '<button type="button" class="sx2-menu__item' + (peligro ? ' sx2-menu__item--peligro' : '') + '" data-py2-menu="' + id + '" role="menuitem">' +
      U.ico(icono, 16) + '<span>' + U.esc(texto) + (sub ? '<small>' + U.esc(sub) + '</small>' : '') + '</span></button>';
  }
  function abrirMenu(boton) {
    if (menuAbierto_) { cerrarMenu(); return; }
    var ctx = PY.ctx(), p = ctx.proyecto, g = gestiona(ctx);
    var cerrado = p.estado === 'CERRADO' || p.estado === 'CANCELADO';
    var html = item('informe', 'documento', 'Configurar informe PDF', 'Elige secciones, rango y personas') +
      (g ? '<span class="sx2-menu__sep"></span>' +
        item('editar', 'editar', 'Editar proyecto', 'Nombre, fechas, estado y presupuesto') +
        item('plantilla', 'copiar', 'Guardar como plantilla', 'Copia los hitos para proyectos parecidos') +
        item('baseline', 'capas', 'Congelar línea base', 'Foto de las fechas de plan de hoy') +
        (!cerrado ? '<span class="sx2-menu__sep"></span>' + item('cerrar', 'candado', 'Cerrar proyecto', 'Con un resumen del cierre', true) : '') : '');
    var m = document.createElement('div');
    m.className = 'sx2-menu';
    m.setAttribute('role', 'menu');
    m.innerHTML = html;
    boton.closest('.sx2-menu-ancla').appendChild(m);
    menuAbierto_ = m;
    setTimeout(function () {
      document.addEventListener('click', fueraDelMenu, true);
      document.addEventListener('keydown', escMenu, true);
    }, 0);
    var primero = m.querySelector('button');
    if (primero) primero.focus();
  }

  function clicAcciones(t) {
    if (t.closest('.js-py2-sala')) { abrirSala(); return true; }
    if (t.closest('.js-py2-mas')) { abrirMenu(t.closest('.js-py2-mas')); return true; }
    var mi = t.closest('[data-py2-menu]');
    if (mi) {
      var id = mi.getAttribute('data-py2-menu');
      cerrarMenu();
      ({ informe: abrirInforme, editar: abrirEditar, plantilla: abrirPlantilla, baseline: congelarBaseline, cerrar: abrirCerrar })[id](PY.ctx());
      return true;
    }
    return false;
  }

  // =========================================================================
  // Menú: acciones del proyecto
  // =========================================================================
  function abrirEditar(ctx) {
    var p = ctx.proyecto;
    var estados = Object.keys(PY.ETIQUETA_ESTADO_PROYECTO).filter(function (e) { return e !== 'CERRADO'; });
    PY.formulario({
      titulo: 'Editar proyecto',
      campos: PY.campo('Nombre', '<input class="sx2-input" name="nombre" maxlength="160" value="' + U.esc(p.nombre) + '">') +
        PY.campo('Descripción', '<textarea class="sx2-input" name="descripcion" maxlength="2000">' + U.esc(p.descripcion || '') + '</textarea>') +
        PY.campo('Objetivo / resultado esperado', '<textarea class="sx2-input" name="objetivo" maxlength="2000">' + U.esc(p.objetivo || '') + '</textarea>') +
        '<div class="sx2-form__fila">' +
          PY.campo('Inicio', '<input class="sx2-input" type="date" name="fecha_inicio" value="' + fechaInput(p.fecha_inicio) + '">') +
          PY.campo('Fecha objetivo', '<input class="sx2-input" type="date" name="fecha_objetivo" value="' + fechaInput(p.fecha_objetivo) + '">') +
        '</div>' +
        '<div class="sx2-form__fila">' +
          PY.campo('Prioridad', '<select class="sx2-select" name="prioridad">' + [['P1', 'P1 · Crítica'], ['P2', 'P2 · Alta'], ['P3', 'P3 · Media'], ['P4', 'P4 · Normal'], ['P5', 'P5 · Baja']].map(function (x) {
            return '<option value="' + x[0] + '"' + (x[0] === (p.prioridad || 'P4') ? ' selected' : '') + '>' + x[1] + '</option>';
          }).join('') + '</select>') +
          PY.campo('Estado', '<select class="sx2-select" name="estado">' + estados.map(function (e) {
            return '<option value="' + e + '"' + (e === p.estado ? ' selected' : '') + '>' + PY.ETIQUETA_ESTADO_PROYECTO[e] + '</option>';
          }).join('') + '</select>') +
        '</div>' +
        PY.campo('Centro de costo', '<input class="sx2-input" name="centro_costo" value="' + U.esc(p.centro_costo || '') + '" placeholder="Opcional">') +
        '<div class="sx2-form__fila">' +
          PY.campo('Presupuesto', '<input class="sx2-input" type="number" min="0" step="any" name="presupuesto_monto" value="' + U.esc(p.presupuesto_monto || '') + '" placeholder="Opcional">', 'Lo usa "Avance y costos".') +
          PY.campo('Moneda', '<select class="sx2-select" name="presupuesto_moneda"><option value="CLP"' + (p.presupuesto_moneda !== 'UF' ? ' selected' : '') + '>CLP</option><option value="UF"' + (p.presupuesto_moneda === 'UF' ? ' selected' : '') + '>UF</option></select>') +
        '</div>',
      preparar: function (d) {
        if (!d.nombre) return 'El nombre es obligatorio.';
        if (d.presupuesto_monto === '') d.presupuesto_moneda = '';
        return d;
      },
      accion: 'actualizarProyecto', aviso: 'Proyecto actualizado.'
    });
  }

  function abrirInforme(ctx) {
    var personas = (ctx.detalle.integrantes || []).map(function (i) { return PY.persona(i.usuario_email, i.usuario_nombre); });
    PY.formulario({
      titulo: 'Configurar informe PDF', boton: 'Generar PDF', ocupado: 'Generando…',
      subtitulo: nota('El PDF se arma al momento, con los datos de ahora.'),
      campos: '<div class="sx2-campo"><span class="sx2-campo__et">Secciones</span><div class="sx2-chips">' +
          SECCIONES_INFORME.map(function (s) { return U.chip({ texto: s[1], activo: !!s[2], clase: 'js-py2i-sec', datos: { v: s[0] } }); }).join('') + '</div></div>' +
        '<div class="sx2-form__fila">' +
          PY.campo('Desde', '<input class="sx2-input" type="date" name="desde">') +
          PY.campo('Hasta', '<input class="sx2-input" type="date" name="hasta">') +
        '</div><p class="sx2-campo__ayuda" style="margin-top:-8px">El rango solo acota el Gantt, la carga y la bitácora. Vacío = todo el proyecto.</p>' +
        PY.campo('Tareas', '<select class="sx2-select" name="estado"><option value="">Todas</option><option value="abiertas">Solo abiertas</option><option value="atrasadas">Solo atrasadas</option></select>') +
        (personas.length ? '<div class="sx2-campo"><span class="sx2-campo__et">Personas <span class="sx2-tenue" style="font-weight:400">(ninguna = todas)</span></span><div class="sx2-chips">' +
          personas.map(function (p) { return '<button type="button" class="sx2-py-mencion js-py2i-per" data-v="' + U.esc(p.email) + '" aria-pressed="false">' + U.avatar(p, 'xs') + U.esc(p.nombre) + '</button>'; }).join('') + '</div></div>' : ''),
      alMontar: function (form) {
        form.addEventListener('click', function (ev) {
          var b = ev.target.closest('.js-py2i-sec, .js-py2i-per');
          if (b) b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
        });
      },
      preparar: function (d, form) {
        var sel = function (c) { return Array.prototype.map.call(form.querySelectorAll(c + '[aria-pressed="true"]'), function (b) { return b.getAttribute('data-v'); }); };
        var config = { secciones: sel('.js-py2i-sec'), estado: d.estado, personas: sel('.js-py2i-per') };
        if (!config.secciones.length) return 'Elige al menos una sección.';
        if ((d.desde && !d.hasta) || (!d.desde && d.hasta)) return 'Para acotar por fechas indica desde y hasta.';
        if (d.desde && d.hasta) config.rango = { desde: d.desde, hasta: d.hasta };
        return { proyecto_id: d.proyecto_id, config: config };
      },
      accion: 'descargarReporteProyecto',
      listo: function (r) {
        PY.descargarBase64(r.data.pdf_base64, r.data.filename || ('Informe-' + (ctx.proyecto.codigo || 'proyecto') + '.pdf'), 'application/pdf');
        PY.aviso('Informe generado.', 'exito');
      }
    });
  }

  function abrirPlantilla(ctx) {
    PY.formulario({
      titulo: 'Guardar como plantilla', boton: 'Guardar plantilla',
      subtitulo: nota('Se copian los hitos (nombre y descripción, sin fechas). Tareas y entregables no se copian.'),
      campos: PY.campo('Nombre de la plantilla', '<input class="sx2-input" name="nombre" maxlength="160" value="' + U.esc(ctx.proyecto.nombre) + '">'),
      preparar: function (d) { return d.nombre ? d : 'Ponle un nombre a la plantilla.'; },
      accion: 'guardarProyectoComoPlantilla', aviso: 'Plantilla guardada: aparecerá al crear un proyecto nuevo.',
      listo: function () { /* nada que refrescar en el proyecto */ }
    });
  }

  function congelarBaseline() {
    PY.accionConfirmada({
      titulo: '¿Congelar la línea base?', texto: 'Guarda una foto de las fechas de plan de hoy para comparar el avance contra ella. No borra la anterior.', boton: 'Congelar',
      accion: 'congelarBaselineProyecto',
      listo: function (r) {
        PY.aviso('Línea base congelada' + (r.data && r.data.total_tareas !== undefined ? ' (' + r.data.total_tareas + ' tareas)' : '') + '.', 'exito');
        PY.recargarProyecto();
      }
    });
  }

  function abrirCerrar(ctx) {
    PY.formulario({
      titulo: 'Cerrar proyecto', boton: 'Cerrar proyecto',
      subtitulo: nota(ctx.proyecto.nombre),
      campos: '<div class="sx2-py-aviso sx2-tono-alerta">' + U.ico('alerta', 16) + '<span>El proyecto pasa a Cerrado y sale de los activos del portafolio.</span></div>' +
        PY.campo('Resumen del cierre', '<textarea class="sx2-input" name="motivo" rows="5" maxlength="2000" placeholder="Entregables logrados, pendientes, aprendizajes"></textarea>'),
      preparar: function (d) { if (!d.motivo) return 'Resume brevemente el cierre.'; d.estado = 'CERRADO'; return d; },
      accion: 'actualizarProyecto', aviso: 'Proyecto cerrado.'
    });
  }

  // =========================================================================
  // Sala
  // =========================================================================
  var sala_ = null; // drawer abierto
  var POR_PAGINA_SALA = 30;
  var mostrarSala_ = POR_PAGINA_SALA;

  function eventoHtml(ev, ctx, aporta) {
    var autor = PY.persona(ev.autor_email, ev.autor_nombre);
    var tono = TIPO_TONO[ev.tipo] || 'neutro';
    var menciones = String(ev.menciones || '').split(',').map(function (m) { return m.trim(); }).filter(Boolean);
    return '<li class="sx2-py-sala-ev">' + U.avatar(autor, 'sm') +
      '<div class="sx2-apilado" style="gap:2px;flex:1;min-width:0">' +
        '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap"><strong style="font-size:.8125rem">' + U.esc(autor.nombre) + '</strong>' +
          U.badge(TIPO_TEXTO[ev.tipo] || ev.tipo, tono, true) + '<span class="sx2-tenue" style="font-size:.75rem">' + U.esc(PY.haceTiempo(ev.timestamp)) + '</span></span>' +
        (ev.titulo ? '<strong style="font-size:.8125rem;margin-top:4px">' + U.esc(ev.titulo) + '</strong>' : '') +
        (ev.cuerpo ? '<p class="sx2-py-sala-ev__cuerpo">' + U.esc(ev.cuerpo) + '</p>' : '') +
        (menciones.length ? '<span class="sx2-tenue" style="font-size:.75rem">@ ' + menciones.map(function (m) { return U.esc(PY.persona(m).nombre); }).join(', ') + '</span>' : '') +
        '<span class="sx2-flex" style="gap:6px;margin-top:4px;flex-wrap:wrap">' +
          (ev.tipo === 'ARCHIVO' ? U.boton({ texto: 'Descargar', icono: 'descargar', sm: true, clase: 'js-py2s-adj', datos: { id: ev.evento_id } }) : '') +
          (ev.ref_tipo === 'ACTIVIDAD' && ev.ref_id ? '<button type="button" class="sx2-py-ref js-py2s-vertarea" data-id="' + U.esc(ev.ref_id) + '">' + U.ico('tareas', 12) + 'Convertido en tarea</button>' : '') +
          (aporta && !ev.ref_id && CONVERTIBLES[ev.tipo] ? U.boton({ texto: 'Convertir en tarea', icono: 'nueva', sm: true, variante: 'fantasma', clase: 'js-py2s-convertir', datos: { id: ev.evento_id } }) : '') +
        '</span>' +
      '</div></li>';
  }

  function cuerpoSala(ctx) {
    var d = ctx.detalle, aporta = PY.puedeAportar(d);
    var rv = d.resumen_desde_ultima_visita;
    var visita = '';
    if (rv) {
      var partes = [];
      if (rv.eventos_sala > 0) partes.push(rv.eventos_sala + ' en la sala');
      if (rv.tareas_completadas > 0) partes.push(rv.tareas_completadas + ' tareas completadas');
      if (rv.tareas_bloqueadas > 0) partes.push(rv.tareas_bloqueadas + ' bloqueadas');
      if (rv.entregables_aprobados > 0) partes.push(rv.entregables_aprobados + ' entregables aprobados');
      visita = '<div class="sx2-py-visita">' + U.ico('destello', 16) + '<span><strong>Desde tu última visita</strong> (' + U.esc(PY.haceTiempo(rv.desde)) + '): ' +
        U.esc(partes.length ? partes.join(' · ') : 'sin novedades') + '</span></div>';
    }
    var tipos = TIPOS_SALA.concat(d.rol_actual === 'LIDER' || gestiona(ctx) ? [{ id: 'SOLICITUD_LIDER', texto: 'Solicitud al equipo', icono: 'campana' }] : []);
    var form = aporta ? '<form class="sx2-py-sala-form js-py2s-form" novalidate>' +
        '<textarea class="sx2-input" name="cuerpo" maxlength="4000" placeholder="Comparte un avance, una decisión o pide algo al equipo…"></textarea>' +
        '<div class="sx2-chips">' + tipos.map(function (t, i) { return U.chip({ texto: t.texto, icono: t.icono, activo: i === 0, clase: 'js-py2s-tipo', datos: { t: t.id } }); }).join('') + '</div>' +
        ((d.integrantes || []).length ? '<div class="sx2-apilado" style="gap:6px"><span class="sx2-campo__et">Avisar a</span><div class="sx2-chips">' +
          d.integrantes.map(function (i) { var p = PY.persona(i.usuario_email, i.usuario_nombre); return '<button type="button" class="sx2-py-mencion js-py2s-men" data-v="' + U.esc(i.usuario_email) + '" aria-pressed="false">' + U.avatar(p, 'xs') + U.esc(p.nombre) + '</button>'; }).join('') +
        '</div></div>' : '') +
        '<p class="sx2-campo__error js-py2s-error" hidden></p>' +
        '<div class="sx2-entre">' +
          '<label class="sx2-boton sx2-boton--secundario sx2-boton--sm">' + U.ico('adjunto', 14) + 'Adjuntar archivo<input type="file" class="sx2-oculto-visual js-py2s-archivo" accept="' + ACEPTA + '"></label>' +
          U.boton({ texto: 'Publicar', icono: 'derecha', variante: 'primario', clase: 'js-py2s-publicar' }) +
        '</div>' +
      '</form>' : '';
    var eventos = (ctx.sala || []).slice().sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
    return visita + form + (eventos.length ? '<ul class="sx2-lista" style="gap:0">' + eventos.slice(0, mostrarSala_).map(function (e) { return eventoHtml(e, ctx, aporta); }).join('') + '</ul>' +
        (eventos.length > mostrarSala_ ? '<div style="text-align:center">' + U.boton({ texto: 'Mostrar más (' + (eventos.length - mostrarSala_) + ')', icono: 'abajo', sm: true, variante: 'fantasma', clase: 'js-py2s-mas' }) + '</div>' : '')
      : U.vacio({ icono: 'comentario', titulo: 'La sala está vacía', texto: 'Es el lugar para avisos, decisiones y preguntas del proyecto.' }));
  }

  function abrirSala() {
    var ctx = PY.ctx();
    mostrarSala_ = POR_PAGINA_SALA;
    var d = U.drawer({
      titulo: 'Sala del proyecto',
      subtitulo: nota(ctx.proyecto.nombre),
      cuerpo: cuerpoSala(ctx),
      alCerrar: function () { document.removeEventListener('py2:datos', alRecargar); sala_ = null; }
    });
    sala_ = d;
    function alRecargar() { if (sala_ === d) d.cuerpo(cuerpoSala(PY.ctx())); }
    document.addEventListener('py2:datos', alRecargar);

    function error(m) { var e = d.el.querySelector('.js-py2s-error'); if (e) { e.textContent = m; e.hidden = !m; } }

    d.el.addEventListener('click', function (ev) {
      var t = ev.target, b;
      if ((b = t.closest('.js-py2s-tipo'))) {
        d.el.querySelectorAll('.js-py2s-tipo').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        return;
      }
      if (t.closest('.js-py2s-mas')) { mostrarSala_ += POR_PAGINA_SALA; d.cuerpo(cuerpoSala(PY.ctx())); return; }
      if ((b = t.closest('.js-py2s-men'))) { b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); return; }
      if ((b = t.closest('.js-py2s-publicar'))) {
        var form = d.el.querySelector('.js-py2s-form');
        var cuerpo = form.cuerpo.value.trim();
        if (!cuerpo) { error('Escribe algo antes de publicar.'); return; }
        var tipo = (d.el.querySelector('.js-py2s-tipo[aria-pressed="true"]') || {}).getAttribute ? d.el.querySelector('.js-py2s-tipo[aria-pressed="true"]').getAttribute('data-t') : 'COMENTARIO';
        var menciones = Array.prototype.map.call(d.el.querySelectorAll('.js-py2s-men[aria-pressed="true"]'), function (x) { return x.getAttribute('data-v'); });
        b.disabled = true;
        PY.api('publicarEnSalaProyecto', { proyecto_id: PY.estado().proyectoId, tipo: tipo, cuerpo: cuerpo, menciones: menciones }).then(function (r) {
          b.disabled = false;
          if (!r || !r.ok) { error((r && r.message) || 'No se pudo publicar.'); return; }
          PY.aviso('Publicado en la sala.', 'exito');
          PY.recargarProyecto();
        });
        return;
      }
      if ((b = t.closest('.js-py2s-adj'))) {
        b.disabled = true;
        PY.api('descargarAdjuntoProyecto', { proyecto_id: PY.estado().proyectoId, evento_id: b.getAttribute('data-id') }).then(function (r) {
          b.disabled = false;
          if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo descargar el archivo.', 'error'); return; }
          PY.descargarBase64(r.data.contenido_base64, r.data.nombre_archivo, r.data.mime);
        });
        return;
      }
      if ((b = t.closest('.js-py2s-vertarea'))) { d.cerrar(true); PY.abrirTarea(b.getAttribute('data-id')); return; }
      if ((b = t.closest('.js-py2s-convertir'))) {
        var e = (PY.ctx().sala || []).filter(function (x) { return x.evento_id === b.getAttribute('data-id'); })[0];
        if (e) abrirConvertir(PY.ctx(), e);
      }
    });
    d.el.addEventListener('change', function (ev) {
      var input = ev.target.closest('.js-py2s-archivo');
      if (!input || !input.files[0]) return;
      var archivo = input.files[0];
      U.confirmar({ titulo: '¿Adjuntar "' + archivo.name + '"?', texto: 'Queda en la sala para todo el equipo. Para documentos formales con versiones, usa Archivos.', boton: 'Adjuntar' }).then(function (si) {
        if (!si) { input.value = ''; return; }
        PY.aviso('Subiendo archivo…');
        PY.leerBase64(archivo).then(function (b64) {
          return PY.api('subirAdjuntoProyecto', { proyecto_id: PY.estado().proyectoId, nombre_archivo: archivo.name, contenido_base64: b64 });
        }).then(function (r) {
          input.value = '';
          if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo subir el archivo.', 'error'); return; }
          PY.aviso('Archivo adjuntado.', 'exito');
          PY.recargarProyecto();
        }, function (err) { PY.aviso((err && err.message) || 'No se pudo leer el archivo.', 'error'); });
      });
    });
    d.el.addEventListener('submit', function (ev) { ev.preventDefault(); });
  }

  function abrirConvertir(ctx, ev) {
    var cuerpo = ev.cuerpo || '';
    var hitos = ctx.detalle.hitos || [];
    PY.formulario({
      titulo: 'Convertir en tarea', boton: 'Crear tarea',
      subtitulo: nota('La publicación queda enlazada a la tarea.'),
      campos: PY.campo('Título', '<input class="sx2-input" name="titulo" maxlength="160" value="' + U.esc(cuerpo.length > 60 ? cuerpo.slice(0, 57).trim() + '…' : cuerpo) + '">') +
        PY.campo('Descripción', '<textarea class="sx2-input" name="descripcion" maxlength="2000">' + U.esc(cuerpo) + '</textarea>') +
        PY.campo('Responsable', selectIntegrantes(ctx, 'responsable_email', PY.miEmail())) +
        '<div class="sx2-form__fila">' +
          PY.campo('Fecha comprometida', '<input class="sx2-input" type="date" name="fecha_compromiso">') +
          PY.campo('Prioridad', '<select class="sx2-select" name="prioridad"><option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option><option value="P4" selected>P4</option><option value="P5">P5</option></select>') +
        '</div>' +
        (hitos.length ? PY.campo('Hito', '<select class="sx2-select" name="hito_id"><option value="">Sin hito</option>' + hitos.map(function (h) {
          return '<option value="' + U.esc(h.hito_id) + '">' + U.esc(h.nombre) + '</option>';
        }).join('') + '</select>') : ''),
      preparar: function (d) {
        if (!d.titulo) return 'El título es obligatorio.';
        if (!d.fecha_compromiso) return 'Indica la fecha comprometida.';
        d.evento_id = ev.evento_id;
        return d;
      },
      accion: 'convertirEventoEnTareaProyecto', aviso: 'Tarea creada desde la sala.'
    });
  }

  // =========================================================================
  // "Sobre el proyecto" (lo usa el Resumen)
  // =========================================================================
  function sobreProyecto(ctx) {
    var p = ctx.proyecto;
    var lider = PY.persona(p.lider_email, p.lider_nombre);
    return '<div class="sx2-py-sobre">' +
      '<div style="margin-bottom:12px">' + U.persona(Object.assign({}, lider, { cargo: 'Líder del proyecto' }), 'lg') + '</div>' +
      (p.descripcion ? '<p>' + U.esc(p.descripcion) + '</p>' : '') +
      (p.objetivo ? '<p><b>Objetivo:</b> ' + U.esc(p.objetivo) + '</p>' : '') +
      (p.centro_costo ? '<p><b>Centro de costo:</b> ' + U.esc(p.centro_costo) + '</p>' : '') +
      (p.solicitud_origen_id ? '<p><b>Origen:</b> solicitud ' + U.esc(p.solicitud_origen_id) + '</p>' : '') +
      (!p.descripcion && !p.objetivo ? '<p class="sx2-tenue">Sin descripción ni objetivo cargados.' + (gestiona(ctx) ? ' Agrégalos desde "Más → Editar proyecto".' : '') + '</p>' : '') +
    '</div>';
  }

  PY.accionesCabecera = accionesCabecera;
  PY.clicAcciones = clicAcciones;
  PY.abrirSala = abrirSala;
  PY.sobreProyecto = sobreProyecto;
})();
