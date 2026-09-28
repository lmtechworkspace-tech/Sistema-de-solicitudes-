/**
 * proyectos-v2/seguimiento.js — sección "Seguimiento", con sub-navegación
 * lateral: Hitos · Riesgos (matriz probabilidad × impacto) · Reuniones y
 * decisiones · Avance y costos (curva S física + costos con respaldo) ·
 * Analítica. Reemplaza en v1: Hitos, Riesgos, Reuniones, Decisiones,
 * Avance, Financiero y Analítica. (RDI retirado el 2026-09-28: 0 usos.)
 *
 * Mismas acciones, endpoints y permisos que v1. Lo que v1 carga "lazy"
 * (reuniones, decisiones, avance, pagos, analítica) se pide con
 * PY.extra() la primera vez que la sub-vista se abre.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;

  var SUBS = [
    { id: 'hitos', texto: 'Hitos', icono: 'bandera' },
    { id: 'riesgos', texto: 'Riesgos', icono: 'escudo' },
    { id: 'reuniones', texto: 'Reuniones y decisiones', icono: 'comentario' },
    { id: 'avance', texto: 'Avance y costos', icono: 'tendencia' },
    { id: 'analitica', texto: 'Analítica', icono: 'grafico' }
  ];
  var sub = 'hitos';
  var graficos_ = [];
  var filtroRiesgo = null; // { p, i } desde la matriz

  var HITO = {
    PENDIENTE: { texto: 'Pendiente', tono: 'neutro' }, EN_CURSO: { texto: 'En curso', tono: 'primario' },
    COMPLETADO: { texto: 'Completado', tono: 'ok' }, CANCELADO: { texto: 'Cancelado', tono: 'neutro' }
  };
  var NIVEL = { BAJA: 'Baja', MEDIA: 'Media', ALTA: 'Alta' };
  var NIVEL_N = { BAJA: 1, MEDIA: 2, ALTA: 3 };
  var NIVEL_TONO = { ALTA: 'critico', MEDIA: 'alerta', BAJA: 'ok' };
  var RIESGO_ESTADO = {
    ABIERTO: { texto: 'Abierto', tono: 'info' }, EN_MITIGACION: { texto: 'En mitigación', tono: 'primario' },
    MATERIALIZADO: { texto: 'Problema', tono: 'critico' }, CERRADO: { texto: 'Cerrado', tono: 'neutro' }
  };
  var PAGO = { proyectado: { texto: 'Proyectado', tono: 'neutro' }, facturado: { texto: 'Facturado', tono: 'info' }, pagado: { texto: 'Pagado', tono: 'ok' } };

  function gestiona(ctx) { return !!ctx.detalle.puede_gestionar; }
  function hitosDe(ctx) { return (ctx.detalle.hitos || []).slice().sort(function (a, b) { return (Number(a.orden) || 0) - (Number(b.orden) || 0); }); }
  function riesgosDe(ctx) { return ctx.detalle.riesgos || []; }
  function activo(r) { return r.estado !== 'CERRADO'; }
  function vacioNum(v) { return v === '' || v === null || v === undefined; }
  function cargando() { return U.card({ cuerpo: U.esqueleto('tabla', 5) }); }
  function fallo(texto) { return U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: texto }) }); }
  function selectIntegrantes(ctx, nombre, actual) {
    return '<select class="sx2-select" name="' + nombre + '">' + (ctx.detalle.integrantes || []).map(function (i) {
      var p = PY.persona(i.usuario_email, i.usuario_nombre);
      return '<option value="' + U.esc(i.usuario_email) + '"' + (String(i.usuario_email).toLowerCase() === String(actual || '').toLowerCase() ? ' selected' : '') + '>' +
        U.esc(p.nombre + (p.cargo ? ' — ' + p.cargo : '')) + '</option>';
    }).join('') + '</select>';
  }
  function selectNivel(nombre, actual) {
    return '<select class="sx2-select" name="' + nombre + '">' + ['BAJA', 'MEDIA', 'ALTA'].map(function (n) {
      return '<option value="' + n + '"' + (n === (actual || 'MEDIA') ? ' selected' : '') + '>' + NIVEL[n] + '</option>';
    }).join('') + '</select>';
  }
  function fechaInput(v) { return v ? String(v).slice(0, 10) : ''; }
  function nota(texto) { return '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(texto) + '</span>'; }

  // =========================================================================
  // Hitos
  // =========================================================================
  function tonoHito(h) {
    var terminal = h.estado === 'COMPLETADO' || h.estado === 'CANCELADO';
    if (!terminal && h.fecha_objetivo && String(h.fecha_objetivo).slice(0, 10) < PY.hoyClave()) return 'critico';
    return (HITO[h.estado] || HITO.PENDIENTE).tono;
  }

  function pintarHitos(ctx) {
    var hitos = hitosDe(ctx);
    var porHito = {};
    ctx.tareas.forEach(function (a) { if (a.hito_id) (porHito[a.hito_id] = porHito[a.hito_id] || []).push(a); });
    var sinHito = ctx.tareas.filter(function (a) { return !a.hito_id && a.estado !== 'CANCELADA'; });
    var completados = hitos.filter(function (h) { return h.estado === 'COMPLETADO'; }).length;
    var vencidos = hitos.filter(function (h) { return tonoHito(h) === 'critico'; }).length;
    var hoy = PY.hoyClave();
    var proximo = hitos.filter(function (h) { return h.estado !== 'COMPLETADO' && h.estado !== 'CANCELADO' && h.fecha_objetivo && String(h.fecha_objetivo).slice(0, 10) >= hoy; })
      .sort(function (a, b) { return String(a.fecha_objetivo).localeCompare(String(b.fecha_objetivo)); })[0];

    var kpis = '<div class="sx2-fila-kpis">' +
      U.kpi({ i: 0, icono: 'bandera', tono: 'hito', etiqueta: 'Hitos', valor: hitos.length, unidad: completados + (completados === 1 ? ' completado' : ' completados'), progreso: hitos.length ? Math.round(completados / hitos.length * 100) : 0 }) +
      U.kpi({ i: 1, icono: 'alerta', tono: vencidos ? 'critico' : 'neutro', etiqueta: 'Vencidos', valor: vencidos, unidad: 'fecha objetivo pasada' }) +
      U.kpi({ i: 2, icono: 'calendario', tono: 'primario', etiqueta: 'Próximo hito', valor: proximo ? PY.fecha(proximo.fecha_objetivo) : '—', unidad: proximo ? proximo.nombre : 'ninguno por venir' }) +
      U.kpi({ i: 3, icono: 'tareas', tono: sinHito.length ? 'alerta' : 'ok', etiqueta: 'Tareas sin hito', valor: sinHito.length, unidad: 'no suman a ningún hito' }) +
    '</div>';

    if (!hitos.length) {
      return kpis + U.card({ cuerpo: U.vacio({ icono: 'bandera', titulo: 'Todavía no hay hitos', texto: 'Los hitos agrupan tareas y marcan los momentos clave del proyecto.',
        accion: gestiona(ctx) ? U.boton({ texto: 'Nuevo hito', icono: 'nueva', variante: 'primario', clase: 'js-py2s-h-nuevo' }) : '' }) });
    }

    var linea = hitos.map(function (h, idx) {
      var tareas = porHito[h.hito_id] || [];
      var tono = tonoHito(h);
      var pct = vacioNum(h.avance_pct) ? null : Math.round(Number(h.avance_pct));
      var terminal = h.estado === 'COMPLETADO' || h.estado === 'CANCELADO';
      var dias = PY.diasHasta(h.fecha_objetivo);
      var cuando = !h.fecha_objetivo ? 'Sin fecha' : (terminal ? PY.fecha(h.fecha_objetivo, true)
        : (dias < 0 ? 'Venció hace ' + (-dias) + ' d' : (dias === 0 ? 'Vence hoy' : 'En ' + dias + ' d')));
      var visibles = tareas.slice(0, 6);
      return '<li class="sx2-py-hito sx2-tono-' + tono + ' sx2-entra" style="--i:' + Math.min(idx + 2, 12) + '">' +
        '<span class="sx2-py-hito__nodo">' + (h.estado === 'COMPLETADO' ? U.ico('check', 14) : '') + '</span>' +
        '<div class="sx2-card sx2-py-hito__card">' +
          '<div class="sx2-entre" style="align-items:flex-start">' +
            '<div class="sx2-apilado" style="gap:4px;min-width:0">' +
              '<strong class="sx2-py-hito__nombre">' + U.esc(h.nombre) + '</strong>' +
              '<span class="sx2-flex" style="flex-wrap:wrap;gap:6px">' + U.badge(tono === 'critico' ? 'Vencido' : (HITO[h.estado] || HITO.PENDIENTE).texto, tono) +
                '<span class="sx2-tenue" style="font-size:.8125rem">' + U.ico('calendario', 13) + ' ' + U.esc(cuando) + '</span></span>' +
            '</div>' +
            (gestiona(ctx) ? '<span class="sx2-flex" style="gap:4px">' +
              (!terminal ? U.boton({ texto: 'Completar', icono: 'check', sm: true, clase: 'js-py2s-h-completar', datos: { id: h.hito_id, nombre: h.nombre } }) : '') +
              U.boton({ soloIcono: true, icono: 'editar', sm: true, variante: 'fantasma', titulo: 'Editar hito', clase: 'js-py2s-h-editar', datos: { id: h.hito_id } }) +
            '</span>' : '') +
          '</div>' +
          (h.descripcion ? '<p class="sx2-py-hito__desc">' + U.esc(h.descripcion) + '</p>' : '') +
          (pct !== null ? '<div><div class="sx2-entre sx2-tenue" style="font-size:.75rem;margin-bottom:4px"><span>' + tareas.length + (tareas.length === 1 ? ' tarea' : ' tareas') + '</span><span>' + pct + '%</span></div>' + U.barra(pct, tono === 'critico' ? 'critico' : 'hito') + '</div>' : '') +
          (visibles.length ? '<ul class="sx2-py-hito__tareas">' + visibles.map(function (a) {
            return '<li><button type="button" class="sx2-py-hito__tarea" data-py2-tarea="' + U.esc(a.actividad_id) + '">' +
              '<span class="sx2-py-punto sx2-tono-' + PY.tonoTarea(a) + '"></span><span class="sx2-cortar">' + U.esc(a.titulo) + '</span>' +
              U.avatar(PY.persona(a.responsable_email, a.responsable_nombre), 'xs') + '</button></li>';
          }).join('') + '</ul>' : '<p class="sx2-tenue" style="font-size:.8125rem;margin:0">Sin tareas asociadas todavía.</p>') +
          (tareas.length > visibles.length ? '<button type="button" class="sx2-enlace js-py2s-h-ver" data-id="' + U.esc(h.hito_id) + '">Ver las ' + tareas.length + ' tareas en Trabajo' + U.ico('derecha', 14) + '</button>' : '') +
        '</div>' +
      '</li>';
    }).join('');

    return kpis +
      '<div class="sx2-entre sx2-entra" style="--i:2"><h2 class="sx2-card__titulo">' + U.ico('bandera', 18) + 'Línea de hitos</h2>' +
        (gestiona(ctx) ? U.boton({ texto: 'Nuevo hito', icono: 'nueva', variante: 'primario', sm: true, clase: 'js-py2s-h-nuevo' }) : '') + '</div>' +
      '<ol class="sx2-py-hitos-linea">' + linea + '</ol>' +
      (sinHito.length ? '<div class="sx2-py-aviso sx2-tono-alerta sx2-entra">' + U.ico('info', 16) + '<span>' + sinHito.length +
        (sinHito.length === 1 ? ' tarea no está' : ' tareas no están') + ' en ningún hito. Asígnalas desde el panel de la tarea (Editar → Hito).</span></div>' : '');
  }

  function abrirHito(ctx, h) {
    var campos = PY.campo('Nombre', '<input class="sx2-input" name="nombre" maxlength="160" value="' + U.esc(h ? h.nombre : '') + '" placeholder="Ej: Diagnóstico aprobado">') +
      PY.campo('Descripción', '<textarea class="sx2-input" name="descripcion" maxlength="1000">' + U.esc(h ? h.descripcion || '' : '') + '</textarea>') +
      '<div class="sx2-form__fila">' + PY.campo('Fecha objetivo', '<input class="sx2-input" type="date" name="fecha_objetivo" value="' + fechaInput(h && h.fecha_objetivo) + '">') +
        (h ? PY.campo('Estado', '<select class="sx2-select" name="estado">' + Object.keys(HITO).map(function (k) {
          return '<option value="' + k + '"' + (k === h.estado ? ' selected' : '') + '>' + HITO[k].texto + '</option>';
        }).join('') + '</select>') : '') + '</div>';
    PY.formulario({
      titulo: h ? 'Editar hito' : 'Nuevo hito', boton: h ? 'Guardar' : 'Crear', campos: campos,
      preparar: function (d) { if (!d.nombre) return 'El nombre es obligatorio.'; if (h) d.hito_id = h.hito_id; return d; },
      accion: 'gestionarHitoProyecto', aviso: h ? 'Hito actualizado.' : 'Hito creado.',
      eliminar: h && Number(h.total_tareas) === 0 && h.estado !== 'CANCELADO' ? {
        titulo: '¿Eliminar el hito "' + h.nombre + '"?', mensaje: 'Solo se puede porque no tiene tareas.',
        enviar: function () { return PY.api('gestionarHitoProyecto', { proyecto_id: PY.estado().proyectoId, accion: 'eliminar', hito_id: h.hito_id }); }
      } : null
    });
  }

  // =========================================================================
  // Riesgos
  // =========================================================================
  function tonoCelda(p, i) { var s = p * i; return s >= 6 ? 'critico' : (s >= 3 ? 'alerta' : 'ok'); }

  function matriz(ctx) {
    var vivos = riesgosDe(ctx).filter(activo);
    var celdas = '';
    [3, 2, 1].forEach(function (p) {
      var pk = ['', 'BAJA', 'MEDIA', 'ALTA'][p];
      celdas += '<span class="sx2-py-matriz__eje-y">' + NIVEL[pk] + '</span>';
      [1, 2, 3].forEach(function (i) {
        var ik = ['', 'BAJA', 'MEDIA', 'ALTA'][i];
        var n = vivos.filter(function (r) { return r.probabilidad === pk && r.impacto === ik; }).length;
        var sel = filtroRiesgo && filtroRiesgo.p === pk && filtroRiesgo.i === ik;
        celdas += '<button type="button" class="sx2-py-matriz__celda sx2-tono-' + tonoCelda(p, i) + (n ? ' sx2-py-matriz__celda--con' : '') + '"' +
          ' data-p="' + pk + '" data-i="' + ik + '" aria-pressed="' + (sel ? 'true' : 'false') + '"' +
          ' title="Probabilidad ' + NIVEL[pk] + ' · Impacto ' + NIVEL[ik] + ': ' + n + (n === 1 ? ' riesgo' : ' riesgos') + '">' +
          (n ? '<b>' + n + '</b>' : '') + '</button>';
      });
    });
    return '<div class="sx2-py-matriz">' +
      '<span class="sx2-py-matriz__titulo-y">Probabilidad</span>' +
      '<div class="sx2-py-matriz__rejilla">' + celdas +
        '<span></span><span class="sx2-py-matriz__eje-x">Baja</span><span class="sx2-py-matriz__eje-x">Media</span><span class="sx2-py-matriz__eje-x">Alta</span>' +
      '</div>' +
      '<span class="sx2-py-matriz__titulo-x">Impacto</span>' +
    '</div>';
  }

  function tarjetaRiesgo(ctx, r, i) {
    var est = RIESGO_ESTADO[r.estado] || { texto: r.estado, tono: 'neutro' };
    var p = PY.persona(r.responsable_email);
    var edita = gestiona(ctx) && r.estado !== 'CERRADO';
    return '<article class="sx2-py-riesgo sx2-tono-' + (r.estado === 'CERRADO' ? 'neutro' : (NIVEL_TONO[r.nivel] || 'neutro')) + ' sx2-entra" style="--i:' + Math.min(i, 12) + '">' +
      '<div class="sx2-entre" style="align-items:flex-start;gap:10px">' +
        '<strong class="sx2-py-riesgo__desc">' + U.esc(r.descripcion) + '</strong>' +
        '<span class="sx2-flex" style="gap:6px;flex:none">' + U.badge('Nivel ' + (NIVEL[r.nivel] || r.nivel || '—'), NIVEL_TONO[r.nivel] || 'neutro', true) + U.badge(est.texto, est.tono) + '</span>' +
      '</div>' +
      '<div class="sx2-py-riesgo__meta">' +
        '<span>Probabilidad <b>' + (NIVEL[r.probabilidad] || '—') + '</b></span><span>Impacto <b>' + (NIVEL[r.impacto] || '—') + '</b></span>' +
        '<span class="sx2-flex" style="gap:6px">' + U.avatar(p, 'xs') + U.esc(p.nombre) + '</span>' +
      '</div>' +
      (r.mitigacion ? '<p class="sx2-py-riesgo__mitigacion"><b>Mitigación:</b> ' + U.esc(r.mitigacion) + '</p>' : '') +
      (edita ? '<div class="sx2-flex" style="gap:6px;flex-wrap:wrap">' +
        U.boton({ texto: 'Editar', icono: 'editar', sm: true, variante: 'fantasma', clase: 'js-py2s-r-editar', datos: { id: r.riesgo_id } }) +
        (r.estado === 'ABIERTO' ? U.boton({ texto: 'Ya está ocurriendo', icono: 'alerta', sm: true, variante: 'fantasma', clase: 'js-py2s-r-materializar', datos: { id: r.riesgo_id } }) : '') +
        U.boton({ texto: 'Cerrar', icono: 'check', sm: true, variante: 'fantasma', clase: 'js-py2s-r-cerrar', datos: { id: r.riesgo_id } }) +
      '</div>' : '') +
    '</article>';
  }

  function pintarRiesgos(ctx) {
    var todos = riesgosDe(ctx);
    var vivos = todos.filter(activo);
    var altos = vivos.filter(function (r) { return r.nivel === 'ALTA'; }).length;
    var problemas = vivos.filter(function (r) { return r.estado === 'MATERIALIZADO'; }).length;
    var sinMitigar = vivos.filter(function (r) { return !String(r.mitigacion || '').trim(); }).length;
    var lista = todos.filter(function (r) {
      if (filtroRiesgo) return activo(r) && r.probabilidad === filtroRiesgo.p && r.impacto === filtroRiesgo.i;
      return true;
    }).sort(function (a, b) {
      return (activo(b) - activo(a)) || ((NIVEL_N[b.probabilidad] * NIVEL_N[b.impacto]) - (NIVEL_N[a.probabilidad] * NIVEL_N[a.impacto]));
    });
    var aporta = PY.puedeAportar(ctx.detalle);

    return '<div class="sx2-fila-kpis">' +
        U.kpi({ i: 0, icono: 'escudo', tono: 'primario', etiqueta: 'Riesgos activos', valor: vivos.length, unidad: (todos.length - vivos.length) + ' cerrados' }) +
        U.kpi({ i: 1, icono: 'alerta', tono: altos ? 'critico' : 'neutro', etiqueta: 'Nivel alto', valor: altos, unidad: 'probabilidad × impacto' }) +
        U.kpi({ i: 2, icono: 'rayo', tono: problemas ? 'critico' : 'neutro', etiqueta: 'Ya son problemas', valor: problemas, unidad: 'materializados' }) +
        U.kpi({ i: 3, icono: 'escudoCheck', tono: sinMitigar ? 'alerta' : 'ok', etiqueta: 'Sin mitigación', valor: sinMitigar, unidad: 'no tienen plan' }) +
      '</div>' +
      '<div class="sx2-grid sx2-grid--estira">' +
        '<div class="sx2-col-5 sx2-col--apila">' + U.card({ titulo: 'Matriz de riesgos', icono: 'rejilla', sub: 'clic en una celda para filtrar', i: 2,
          cuerpo: matriz(ctx) + '<p class="sx2-tenue" style="font-size:.75rem;margin:12px 0 0">Solo riesgos activos. El nivel lo calcula SIGSO con probabilidad × impacto.</p>' }) + '</div>' +
        '<div class="sx2-col-7"><section class="sx2-card sx2-entra" style="--i:3">' +
          '<div class="sx2-card__cab"><h2 class="sx2-card__titulo">' + U.ico('escudo', 18) + 'Registro de riesgos <span class="sx2-card__sub">' + lista.length + '</span></h2>' +
            (aporta ? U.boton({ texto: 'Nuevo riesgo', icono: 'nueva', sm: true, variante: 'primario', clase: 'js-py2s-r-nuevo' }) : '') + '</div>' +
          (filtroRiesgo ? '<div style="margin-bottom:12px"><button type="button" class="sx2-chip js-py2s-r-sinfiltro" aria-pressed="true">Probabilidad ' + NIVEL[filtroRiesgo.p] + ' · Impacto ' + NIVEL[filtroRiesgo.i] + U.ico('equis', 12) + '</button></div>' : '') +
          (lista.length ? '<div class="sx2-apilado" style="gap:10px">' + lista.map(function (r, i) { return tarjetaRiesgo(ctx, r, i); }).join('') + '</div>'
            : U.vacio({ icono: 'escudoCheck', titulo: todos.length ? 'Nada en esta celda' : 'Sin riesgos registrados', texto: todos.length ? '' : 'Anticipar lo que puede salir mal es la mitad de la gestión.' })) +
        '</section></div>' +
      '</div>';
  }

  function abrirRiesgo(ctx, r) {
    PY.formulario({
      titulo: r ? 'Editar riesgo' : 'Nuevo riesgo', boton: r ? 'Guardar' : 'Registrar',
      subtitulo: nota('El nivel se calcula solo: probabilidad × impacto.'),
      campos: PY.campo('Qué podría pasar', '<textarea class="sx2-input" name="descripcion" maxlength="1000" placeholder="Ej: El cliente no entrega la información a tiempo">' + U.esc(r ? r.descripcion : '') + '</textarea>') +
        '<div class="sx2-form__fila">' + PY.campo('Probabilidad', selectNivel('probabilidad', r && r.probabilidad)) + PY.campo('Impacto', selectNivel('impacto', r && r.impacto)) + '</div>' +
        PY.campo('Responsable', selectIntegrantes(ctx, 'responsable_email', r ? r.responsable_email : PY.miEmail())) +
        PY.campo('Plan de mitigación', '<textarea class="sx2-input" name="mitigacion" maxlength="1000" placeholder="Qué haremos para que no pase, o para reducir el daño">' + U.esc(r ? r.mitigacion || '' : '') + '</textarea>'),
      preparar: function (d) { if (!d.descripcion) return 'Describe el riesgo.'; if (r) d.riesgo_id = r.riesgo_id; return d; },
      accion: 'gestionarRiesgoProyecto', aviso: r ? 'Riesgo actualizado.' : 'Riesgo registrado.'
    });
  }

  // =========================================================================
  // Reuniones y decisiones
  // =========================================================================
  var MES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  function bloqueFecha(valor) {
    var d = new Date(valor);
    if (isNaN(d.getTime())) return '<span class="sx2-py-fecha-bloque"><b>—</b></span>';
    return '<span class="sx2-py-fecha-bloque"><b>' + d.getUTCDate() + '</b>' + MES[d.getUTCMonth()] + '</span>';
  }

  function tarjetaReunion(ctx, r, aporta, i) {
    var acuerdos = r.acuerdos || [];
    var hechos = acuerdos.filter(function (a) { return a.ref_id; }).length;
    return '<article class="sx2-card sx2-py-reunion sx2-entra" style="--i:' + Math.min(i + 2, 12) + '">' +
      '<div class="sx2-flex" style="gap:14px;align-items:flex-start">' + bloqueFecha(r.fecha) +
        '<div class="sx2-apilado" style="gap:6px;flex:1;min-width:0">' +
          '<div class="sx2-entre" style="align-items:flex-start"><strong class="sx2-py-reunion__titulo">' + U.esc(r.titulo) + '</strong>' +
            (aporta ? '<span class="sx2-flex" style="gap:2px;flex:none">' +
              U.boton({ soloIcono: true, icono: 'editar', sm: true, variante: 'fantasma', titulo: 'Editar reunión', clase: 'js-py2s-reu-editar', datos: { id: r.reunion_id } }) +
              (hechos === 0 ? U.boton({ soloIcono: true, icono: 'basura', sm: true, variante: 'fantasma', titulo: 'Eliminar reunión', clase: 'js-py2s-reu-eliminar', datos: { id: r.reunion_id, nombre: r.titulo } }) : '') +
            '</span>' : '') + '</div>' +
          ((r.participantes || []).length ? '<span class="sx2-chips">' + r.participantes.map(function (x) {
            var p = /@/.test(x) ? PY.persona(x) : { nombre: x };
            return '<span class="sx2-py-participante">' + U.avatar(p, 'xs') + U.esc(p.nombre) + '</span>';
          }).join('') + '</span>' : '') +
          (r.objetivo ? '<p class="sx2-py-reunion__txt"><b>Objetivo:</b> ' + U.esc(r.objetivo) + '</p>' : '') +
          (r.minuta ? '<details class="sx2-py-reunion__minuta"><summary>Minuta</summary><p>' + U.esc(r.minuta) + '</p></details>' : '') +
        '</div>' +
      '</div>' +
      '<div class="sx2-py-acuerdos">' +
        '<div class="sx2-entre"><span class="sx2-seccion-drawer__titulo">Acuerdos' + (acuerdos.length ? ' · ' + hechos + '/' + acuerdos.length + ' en tareas' : '') + '</span>' +
          (aporta ? '<button type="button" class="sx2-enlace js-py2s-ac-nuevo" data-id="' + U.esc(r.reunion_id) + '">' + U.ico('nueva', 14) + 'Acuerdo</button>' : '') + '</div>' +
        (acuerdos.length ? '<ul>' + acuerdos.map(function (a) {
          return '<li class="sx2-py-acuerdo' + (a.ref_id ? ' sx2-py-acuerdo--hecho' : '') + '">' +
            '<span class="sx2-py-acuerdo__check">' + (a.ref_id ? U.ico('check', 12) : '') + '</span>' +
            '<span class="sx2-py-acuerdo__txt">' + U.esc(a.texto) + '</span>' +
            (a.ref_id ? '<button type="button" class="sx2-py-ref" data-py2-tarea="' + U.esc(a.ref_id) + '">' + U.ico('tareas', 12) + 'Ver tarea</button>'
              : (aporta ? '<span class="sx2-flex" style="gap:2px;flex:none">' +
                  U.boton({ texto: 'Convertir en tarea', sm: true, variante: 'fantasma', clase: 'js-py2s-ac-convertir', datos: { id: a.acuerdo_id } }) +
                  U.boton({ soloIcono: true, icono: 'equis', sm: true, variante: 'fantasma', titulo: 'Quitar acuerdo', clase: 'js-py2s-ac-quitar', datos: { id: a.acuerdo_id } }) +
                '</span>' : '')) +
          '</li>';
        }).join('') + '</ul>' : '<p class="sx2-tenue" style="font-size:.8125rem;margin:0">Sin acuerdos registrados.</p>') +
      '</div>' +
    '</article>';
  }

  function tarjetaDecision(ctx, d, aporta, i) {
    var p = PY.persona(d.responsable_email);
    return '<article class="sx2-py-decision sx2-entra" style="--i:' + Math.min(i + 2, 12) + '">' +
      '<div class="sx2-entre" style="align-items:flex-start;gap:8px"><strong>' + U.esc(d.descripcion) + '</strong>' +
        (aporta ? '<span class="sx2-flex" style="gap:2px;flex:none">' +
          U.boton({ soloIcono: true, icono: 'editar', sm: true, variante: 'fantasma', titulo: 'Editar decisión', clase: 'js-py2s-dec-editar', datos: { id: d.decision_id } }) +
          U.boton({ soloIcono: true, icono: 'basura', sm: true, variante: 'fantasma', titulo: 'Eliminar decisión', clase: 'js-py2s-dec-eliminar', datos: { id: d.decision_id } }) +
        '</span>' : '') + '</div>' +
      (d.contexto ? '<p><span class="sx2-tenue">Contexto:</span> ' + U.esc(d.contexto) + '</p>' : '') +
      (d.impacto ? '<p><span class="sx2-tenue">Impacto:</span> ' + U.esc(d.impacto) + '</p>' : '') +
      '<span class="sx2-flex sx2-tenue" style="gap:6px;font-size:.75rem">' + U.avatar(p, 'xs') + U.esc(p.nombre) + ' · ' + PY.fecha(d.fecha_decision, true) + '</span>' +
    '</article>';
  }

  function pintarReuniones(ctx) {
    var reuniones = PY.extra('reuniones', 'listarReunionesProyecto');
    var decisiones = PY.extra('decisiones', 'listarDecisionesProyecto');
    var aporta = PY.puedeAportar(ctx.detalle);
    var colR, colD;
    if (reuniones === undefined) colR = cargando();
    else if (reuniones === null) colR = fallo('Las reuniones no respondieron. Vuelve a abrir la sección.');
    else colR = '<div class="sx2-entre sx2-entra" style="--i:1"><h2 class="sx2-card__titulo">' + U.ico('comentario', 18) + 'Reuniones <span class="sx2-card__sub">' + reuniones.length + '</span></h2>' +
        (aporta ? U.boton({ texto: 'Nueva reunión', icono: 'nueva', sm: true, variante: 'primario', clase: 'js-py2s-reu-nueva' }) : '') + '</div>' +
      (reuniones.length ? reuniones.map(function (r, i) { return tarjetaReunion(ctx, r, aporta, i); }).join('')
        : U.card({ cuerpo: U.vacio({ icono: 'comentario', titulo: 'Sin reuniones', texto: 'Registra la minuta y convierte cada acuerdo en una tarea con responsable.' }) }));
    if (decisiones === undefined) colD = cargando();
    else if (decisiones === null) colD = fallo('Las decisiones no respondieron.');
    else colD = '<section class="sx2-card sx2-entra" style="--i:2"><div class="sx2-card__cab"><h2 class="sx2-card__titulo">' + U.ico('check', 18) + 'Decisiones <span class="sx2-card__sub">' + decisiones.length + '</span></h2>' +
        (aporta ? U.boton({ texto: 'Nueva', icono: 'nueva', sm: true, clase: 'js-py2s-dec-nueva' }) : '') + '</div>' +
      (decisiones.length ? '<div class="sx2-py-decisiones">' + decisiones.map(function (d, i) { return tarjetaDecision(ctx, d, aporta, i); }).join('') + '</div>'
        : U.vacio({ icono: 'check', texto: 'Las decisiones importantes quedan aquí, con su contexto, para que nadie tenga que recordarlas.' })) +
    '</section>';
    return '<div class="sx2-grid">' +
      '<div class="sx2-col-7 sx2-apilado">' + colR + '</div>' +
      '<div class="sx2-col-5 sx2-col--apila">' + colD + '</div>' +
    '</div>';
  }

  function participantesTexto(lista) { return (lista || []).join(', '); }
  function partirParticipantes(txt) { return String(txt || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean); }

  function abrirReunion(ctx, r) {
    PY.formulario({
      titulo: r ? 'Editar reunión' : 'Nueva reunión', boton: r ? 'Guardar' : 'Registrar',
      campos: PY.campo('Título', '<input class="sx2-input" name="titulo" maxlength="160" value="' + U.esc(r ? r.titulo : '') + '" placeholder="Ej: Revisión semanal con el cliente">') +
        PY.campo('Fecha', '<input class="sx2-input" type="date" name="fecha" value="' + (r ? fechaInput(r.fecha) : PY.hoyClave()) + '">') +
        PY.campo('Participantes', '<input class="sx2-input" name="participantes" value="' + U.esc(r ? participantesTexto(r.participantes) : '') + '" placeholder="correo@empresa.cl, Cliente ACME">', 'Separados por coma. Con correo se muestran con su foto.') +
        PY.campo('Objetivo', '<textarea class="sx2-input" name="objetivo" maxlength="1000">' + U.esc(r ? r.objetivo || '' : '') + '</textarea>') +
        PY.campo('Minuta', '<textarea class="sx2-input" name="minuta" maxlength="5000" rows="5">' + U.esc(r ? r.minuta || '' : '') + '</textarea>') +
        (r ? '' : PY.campo('Acuerdos', '<textarea class="sx2-input" name="acuerdos" rows="4" placeholder="Uno por línea"></textarea>', 'Después puedes convertir cada acuerdo en una tarea.')),
      preparar: function (d) {
        if (!d.titulo) return 'El título es obligatorio.';
        d.participantes = partirParticipantes(d.participantes);
        if (r) d.reunion_id = r.reunion_id;
        else d.acuerdos = String(d.acuerdos || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        return d;
      },
      accion: 'gestionarReunionProyecto', aviso: r ? 'Reunión actualizada.' : 'Reunión registrada.',
      listo: function () { PY.invalidarExtra('reuniones'); }
    });
  }

  function abrirAcuerdo(reunionId) {
    PY.formulario({
      titulo: 'Agregar acuerdo', boton: 'Agregar',
      campos: PY.campo('Acuerdo', '<textarea class="sx2-input" name="texto" maxlength="1000" placeholder="Qué se acordó, en una frase"></textarea>'),
      preparar: function (d) { if (!d.texto) return 'Escribe el acuerdo.'; d.reunion_id = reunionId; return d; },
      accion: 'agregarAcuerdoReunionProyecto', aviso: 'Acuerdo agregado.',
      listo: function () { PY.invalidarExtra('reuniones'); }
    });
  }

  function abrirConvertir(ctx, acuerdo) {
    PY.formulario({
      titulo: 'Convertir en tarea', boton: 'Crear tarea',
      subtitulo: nota('El acuerdo queda enlazado a la tarea.'),
      campos: PY.campo('Título', '<input class="sx2-input" name="titulo" maxlength="160" value="' + U.esc(acuerdo.texto) + '">') +
        PY.campo('Responsable', selectIntegrantes(ctx, 'responsable_email', PY.miEmail())) +
        '<div class="sx2-form__fila">' + PY.campo('Fecha comprometida', '<input class="sx2-input" type="date" name="fecha_compromiso">') +
          PY.campo('Prioridad', '<select class="sx2-select" name="prioridad"><option value="P1">P1 · Urgente</option><option value="P2">P2 · Alta</option><option value="P3" selected>P3 · Normal</option><option value="P4">P4 · Baja</option></select>') + '</div>',
      preparar: function (d) {
        if (!d.titulo) return 'El título es obligatorio.';
        if (!d.fecha_compromiso) return 'Indica la fecha comprometida.';
        d.acuerdo_id = acuerdo.acuerdo_id;
        return d;
      },
      accion: 'convertirAcuerdoEnTareaProyecto', aviso: 'Tarea creada desde el acuerdo.',
      listo: function () { PY.recargarProyecto(); }
    });
  }

  function abrirDecision(ctx, d0) {
    PY.formulario({
      titulo: d0 ? 'Editar decisión' : 'Nueva decisión', boton: d0 ? 'Guardar' : 'Registrar',
      campos: PY.campo('Decisión', '<textarea class="sx2-input" name="descripcion" maxlength="1000" placeholder="Qué se decidió">' + U.esc(d0 ? d0.descripcion : '') + '</textarea>') +
        '<div class="sx2-form__fila">' + PY.campo('Fecha', '<input class="sx2-input" type="date" name="fecha_decision" value="' + (d0 ? fechaInput(d0.fecha_decision) : PY.hoyClave()) + '">') +
          PY.campo('Responsable', selectIntegrantes(ctx, 'responsable_email', d0 ? d0.responsable_email : PY.miEmail())) + '</div>' +
        PY.campo('Contexto', '<textarea class="sx2-input" name="contexto" maxlength="1000" placeholder="Por qué se decidió así">' + U.esc(d0 ? d0.contexto || '' : '') + '</textarea>') +
        PY.campo('Impacto', '<textarea class="sx2-input" name="impacto" maxlength="1000" placeholder="Qué cambia a partir de ahora">' + U.esc(d0 ? d0.impacto || '' : '') + '</textarea>'),
      preparar: function (d) { if (!d.descripcion) return 'Describe la decisión.'; if (d0) d.decision_id = d0.decision_id; return d; },
      accion: 'gestionarDecisionProyecto', aviso: d0 ? 'Decisión actualizada.' : 'Decisión registrada.',
      listo: function () { PY.invalidarExtra('decisiones'); }
    });
  }

  // =========================================================================
  // Avance y costos
  // =========================================================================
  function monto(v, moneda) {
    if (vacioNum(v)) return '—';
    var n = Number(v);
    if (isNaN(n)) return '—';
    if (moneda === 'UF') return n.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' UF';
    return '$' + Math.round(n).toLocaleString('es-CL');
  }
  function montoCorto(v, moneda) {
    var n = Number(v) || 0;
    if (moneda === 'UF') return n.toLocaleString('es-CL', { maximumFractionDigits: 0 }) + ' UF';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + ' M';
    return '$' + Math.round(n).toLocaleString('es-CL');
  }

  // --- Curva S automática (control plan vs real, 2026-09-28) -------------------------
  // Se calcula de las propias tareas, sin que nadie tenga que declararla: cada tarea
  // pesa por su tamaño (S 1 · M 2 · L 3 · XL 5) y en el PLAN avanza en línea recta
  // entre su inicio y su término de plan; en lo REAL suma completa el día de su
  // término real, y a hoy aporta además el avance parcial de las que siguen abiertas.
  var PESO_TAMANO = { S: 1, M: 2, L: 3, XL: 5 };
  var DIA_MS = 86400000;
  function curvaS(ctx) {
    var plan = PY.planPorId(ctx);
    var items = ctx.tareas.filter(function (a) { return a.estado !== 'CANCELADA'; }).map(function (a) {
      var p = plan[a.actividad_id] || {};
      var fin = Date.parse(String(p.plan_fin || a.fecha_compromiso || a.fecha_propuesta || '').slice(0, 10));
      if (isNaN(fin)) return null;
      var ini = Date.parse(String(a.fecha_inicio_plan || p.plan_inicio || '').slice(0, 10));
      if (isNaN(ini) || ini > fin) ini = fin;
      var finReal = p.fecha_fin_real || a.fecha_terminada;
      var avance = !vacioNum(p.avance_real_pct) ? Number(p.avance_real_pct) : (a.estado === 'TERMINADA' ? 100 : (Number(a.avance_pct) || 0));
      return { w: PESO_TAMANO[a.tamano] || 2, ini: ini, fin: fin, finReal: finReal ? Date.parse(String(finReal).slice(0, 10)) : null, avance: avance, terminada: a.estado === 'TERMINADA' };
    }).filter(Boolean);
    if (!items.length) return null;
    var total = items.reduce(function (s, x) { return s + x.w; }, 0);
    var hoy = Date.parse(PY.hoyClave());
    var min = Math.min.apply(null, items.map(function (x) { return x.ini; }));
    var maxPlan = Math.max.apply(null, items.map(function (x) { return x.fin; }));
    var fechas = [];
    for (var t = PY.lunes(new Date(min)).getTime(); t <= Math.max(maxPlan, hoy); t += 7 * DIA_MS) fechas.push(t);
    [hoy, maxPlan].forEach(function (x) { if (fechas.indexOf(x) === -1) fechas.push(x); });
    fechas.sort(function (a, b) { return a - b; });
    var r1 = function (v) { return Math.round(v * 10) / 10; };
    var puntos = fechas.map(function (t) {
      var pl = items.reduce(function (s, x) { return s + x.w * Math.max(0, Math.min(1, (t - x.ini + DIA_MS) / (x.fin - x.ini + DIA_MS))); }, 0);
      var re = null;
      if (t <= hoy) {
        re = items.reduce(function (s, x) {
          if (x.finReal !== null && x.finReal <= t) return s + x.w;
          if (t === hoy) return s + x.w * (x.terminada ? 1 : x.avance / 100);
          return s;
        }, 0);
      }
      return { t: t, plan: r1(pl / total * 100), real: re === null ? null : r1(re / total * 100) };
    });
    var enHoy = puntos.filter(function (p) { return p.t === hoy; })[0];
    return { puntos: puntos, planHoy: enHoy.plan, realHoy: enHoy.real, tareas: items.length };
  }

  function bloqueFisico(ctx, controles) {
    var g = gestiona(ctx);
    var accion = g ? U.boton({ texto: 'Registrar control', icono: 'nueva', sm: true, variante: 'fantasma', clase: 'js-py2s-av-nuevo', titulo: 'Punto de control declarado (opcional)' }) : '';
    var cs = curvaS(ctx);
    if (!cs) {
      return '<section class="sx2-card sx2-entra" style="--i:2"><div class="sx2-card__cab"><h2 class="sx2-card__titulo">' + U.ico('tendencia', 18) + 'Avance físico</h2>' + accion + '</div>' +
        U.vacio({ icono: 'tendencia', titulo: 'Sin tareas con fechas', texto: 'La curva S se arma sola con las fechas de plan y de término real de las tareas.' }) + '</section>';
    }
    var desvio = r1(cs.realHoy - cs.planHoy);
    function r1(v) { return Math.round(v * 10) / 10; }
    return '<section class="sx2-card sx2-entra" style="--i:2">' +
      '<div class="sx2-card__cab"><h2 class="sx2-card__titulo">' + U.ico('tendencia', 18) + 'Avance físico <span class="sx2-card__sub">curva S · ' + cs.tareas + ' tareas</span></h2>' + accion + '</div>' +
      '<div class="sx2-py-mini-kpis">' +
        '<span><small>Plan a hoy</small><b>' + cs.planHoy + '%</b></span>' +
        '<span><small>Real a hoy</small><b>' + cs.realHoy + '%</b></span>' +
        '<span class="' + (desvio < 0 ? 'sx2-delta--mal' : 'sx2-delta--bien') + '"><small>Desvío</small><b>' + (desvio > 0 ? '+' : '') + desvio + ' pp</b></span>' +
      '</div>' +
      '<div class="sx2-py-grafico sx2-py-grafico--alto"><canvas id="py2-grafico-fisico" role="img" aria-label="Curva S: avance planificado versus real, calculada de las tareas"></canvas></div>' +
      '<p class="sx2-tenue" style="font-size:.75rem;margin:6px 0 0">Cada tarea pesa por su tamaño. El plan usa inicio y término de plan; lo real, el término real de cada tarea.</p>' +
      (controles && controles.length ? '<h3 class="sx2-card__titulo" style="font-size:.875rem;margin:14px 0 6px">Controles declarados</h3>' +
        '<div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr><th>Fecha</th><th class="sx2-num">Proyectado</th><th class="sx2-num">Real</th><th>Nota</th></tr></thead><tbody>' +
        controles.slice().reverse().map(function (p) {
          return '<tr' + (g ? ' class="sx2-fila--clic js-py2s-av-editar" data-id="' + U.esc(p.control_id) + '" title="Editar"' : '') + '>' +
            '<td>' + PY.fecha(p.fecha, true) + '</td><td class="sx2-num">' + p.pct_proyectado + '%</td><td class="sx2-num">' + (vacioNum(p.pct_real) ? '—' : p.pct_real + '%') + '</td>' +
            '<td class="sx2-tenue">' + U.esc(p.nota || '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '') +
    '</section>';
  }

  // --- Costos con respaldo (2026-09-28) ------------------------------------------------
  function bloqueFinanciero(ctx, fin) {
    var g = gestiona(ctx);
    var moneda = fin.presupuesto_moneda || 'CLP';
    var estados = fin.estados || [];
    var accion = g ? U.boton({ texto: 'Registrar pago', icono: 'nueva', sm: true, clase: 'js-py2s-pago-nuevo' }) : '';
    if (!estados.length) {
      return '<section class="sx2-card sx2-entra" style="--i:3"><div class="sx2-card__cab"><h2 class="sx2-card__titulo">' + U.ico('dinero', 18) + 'Costos</h2>' + accion + '</div>' +
        U.vacio({ icono: 'dinero', titulo: 'Sin pagos registrados', texto: g ? 'Registra cada pago (cuota, anticipo, factura) con su documento y su comprobante.' : 'Quien gestiona el proyecto aún no registra pagos.' }) + '</section>';
    }
    var r = fin.resumen || {};
    var base = r.presupuesto || r.comprometido || 0;
    var pctPagado = base ? Math.round(r.pagado / base * 1000) / 10 : null;
    var fisico = vacioNum(ctx.detalle.avance_pct) ? null : Math.round(Number(ctx.detalle.avance_pct));
    var brecha = pctPagado !== null && fisico !== null ? Math.round(pctPagado - fisico) : null;
    var alerta = brecha !== null && brecha > 15
      ? '<div class="sx2-py-aviso sx2-tono-alerta" style="margin-bottom:12px">' + U.ico('alerta', 16) + '<span>Se ha pagado el <strong>' + pctPagado + '%</strong> ' + (r.presupuesto ? 'del presupuesto' : 'de lo comprometido') + ' con un <strong>' + fisico + '%</strong> de avance físico: los pagos van ' + brecha + ' pp adelante del trabajo.</span></div>'
      : '';
    var prox = r.proximo_pago;
    return '<section class="sx2-card sx2-entra" style="--i:3">' +
      '<div class="sx2-card__cab"><h2 class="sx2-card__titulo">' + U.ico('dinero', 18) + 'Costos <span class="sx2-card__sub">' + (r.pagos_realizados || 0) + ' de ' + (r.pagos_totales || estados.length) + ' pagos hechos</span></h2>' + accion + '</div>' +
      '<div class="sx2-py-costos-kpis">' +
        '<span><small>Presupuesto</small><b>' + (r.presupuesto ? montoCorto(r.presupuesto, moneda) : '—') + '</b></span>' +
        '<span><small>Comprometido</small><b>' + montoCorto(r.comprometido || 0, moneda) + '</b></span>' +
        '<span><small>Pagado</small><b>' + montoCorto(r.pagado || 0, moneda) + '</b></span>' +
        '<span><small>Por pagar</small><b>' + montoCorto(r.por_pagar || 0, moneda) + '</b></span>' +
      '</div>' +
      (pctPagado !== null ? '<div style="margin-bottom:6px" class="sx2-entre"><span class="sx2-tenue" style="font-size:.8125rem">Ejecutado</span><strong class="sx2-num">' + pctPagado + '%</strong></div><div style="margin-bottom:12px">' + U.barra(Math.min(pctPagado, 100), pctPagado > 100 ? 'critico' : 'ok') + '</div>' : '') +
      alerta +
      (prox ? '<p style="font-size:.8125rem;margin:0 0 12px">' + U.ico('calendario', 13) + ' Próximo pago: <strong>' + U.esc(String(prox.nombre).split(' · ')[0]) + '</strong> · ' + PY.fecha(prox.fecha, true) + ' · ' + monto(prox.monto, moneda) + (prox.estado === 'facturado' ? ' · ya facturado' : '') + '</p>' : '') +
      '<div class="sx2-py-grafico sx2-py-grafico--alto"><canvas id="py2-grafico-financiero" role="img" aria-label="Costos acumulados: comprometido versus pagado"></canvas></div>' +
      '<div class="sx2-tabla-wrap" style="margin-top:12px"><table class="sx2-tabla"><thead><tr><th>Pago</th><th>Documento</th><th>Pagado el</th><th class="sx2-num">Monto</th><th>Estado</th><th></th></tr></thead><tbody>' +
        estados.map(function (e) {
          var est = PAGO[e.estado] || { texto: e.estado, tono: 'neutro' };
          var montoFila = e.estado === 'pagado' && !vacioNum(e.monto_real) ? e.monto_real : e.monto_proyectado;
          var desglose = !vacioNum(e.monto_neto) ? 'Neto ' + monto(e.monto_neto, moneda) + (!vacioNum(e.monto_impuesto) ? ' + impuesto ' + monto(e.monto_impuesto, moneda) : '') : '';
          return '<tr' + (g ? ' class="sx2-fila--clic js-py2s-pago-editar" data-id="' + U.esc(e.estado_pago_id) + '" title="Editar"' : '') + '>' +
            '<td><strong>' + U.esc(String(e.nombre).split(' · ')[0]) + '</strong>' + (e.proveedor ? '<span class="sx2-py-doc-pago">' + U.esc(e.proveedor) + '</span>' : '') + '</td>' +
            '<td>' + (e.documento_numero ? 'N° ' + U.esc(e.documento_numero) : '—') + (e.fecha_documento ? '<span class="sx2-py-doc-pago">' + PY.fecha(e.fecha_documento, true) + '</span>' : '') + '</td>' +
            '<td>' + (e.fecha_real ? PY.fecha(e.fecha_real, true) : '<span class="sx2-tenue">prev. ' + PY.fecha(e.fecha_proyectada, true) + '</span>') + '</td>' +
            '<td class="sx2-num"' + (desglose ? ' title="' + U.esc(desglose) + '"' : '') + '>' + monto(montoFila, moneda) + '</td>' +
            '<td>' + U.badge(est.texto, est.tono) + '</td>' +
            '<td>' + (e.documento_id ? U.boton({ soloIcono: true, icono: 'descargar', sm: true, variante: 'fantasma', titulo: 'Descargar respaldo' + (e.documento_nombre ? ': ' + e.documento_nombre : ''), clase: 'js-py2s-pago-doc', datos: { id: e.documento_id } }) : '') + '</td></tr>';
        }).join('') +
      '</tbody></table></div>' +
    '</section>';
  }

  function pintarAvance(ctx) {
    var puntos = PY.extra('avance', 'listarControlAvanceProyecto', function (d) { return d.puntos || []; });
    var fin = PY.extra('pagos', 'listarEstadosPagoProyecto');
    var p = ctx.proyecto, det = ctx.detalle;
    var real = vacioNum(det.avance_pct) ? null : Math.round(Number(det.avance_pct));
    var esperado = vacioNum(det.avance_esperado_pct) ? null : Math.round(Number(det.avance_esperado_pct));
    var diff = real !== null && esperado !== null ? real - esperado : null;
    var r = fin && fin.resumen;
    var base = r ? (r.presupuesto || r.comprometido) : 0;
    var pctPagado = base ? Math.round(r.pagado / base * 100) : null;
    var kpis = '<div class="sx2-fila-kpis">' +
      U.kpi({ i: 0, icono: 'tareas', tono: 'primario', etiqueta: 'Avance físico', valor: real === null ? '—' : real, sufijo: real === null ? '' : '%', unidad: 'por tareas', progreso: real === null ? null : real }) +
      U.kpi({ i: 1, icono: 'calendario', tono: 'info', etiqueta: 'Esperado a hoy', valor: esperado === null ? '—' : esperado, sufijo: esperado === null ? '' : '%', unidad: 'según fechas plan' }) +
      U.kpi({ i: 2, icono: diff !== null && diff < 0 ? 'tendenciaBaja' : 'tendencia', tono: diff === null ? 'neutro' : (diff < -10 ? 'critico' : (diff < 0 ? 'alerta' : 'ok')), etiqueta: 'Diferencia',
        valor: diff === null ? '—' : (diff > 0 ? '+' : '') + Math.round(diff) + ' pp', unidad: diff === null ? 'sin datos' : (diff < 0 ? 'atrasado' : 'en línea o adelantado') }) +
      U.kpi({ i: 3, icono: 'dinero', tono: pctPagado === null ? 'neutro' : (real !== null && pctPagado - real > 15 ? 'alerta' : 'ok'), etiqueta: 'Avance financiero', valor: pctPagado === null ? '—' : pctPagado, sufijo: pctPagado === null ? '' : '%',
        unidad: pctPagado === null ? 'sin pagos' : (r.presupuesto ? 'pagado del presupuesto' : 'pagado de lo comprometido'), progreso: pctPagado === null ? null : Math.min(100, pctPagado) }) +
      U.kpi({ i: 4, icono: 'calendario', tono: 'neutro', etiqueta: 'Término', valor: PY.fecha(p.fecha_objetivo, true), unidad: (function () { var d = PY.diasHasta(p.fecha_objetivo); return d === null ? '' : (d < 0 ? 'vencido hace ' + (-d) + ' d' : 'quedan ' + d + ' d'); })() }) +
    '</div>';
    return kpis + '<div class="sx2-grid sx2-grid--estira">' +
      '<div class="sx2-col-6">' + (puntos === undefined ? cargando() : bloqueFisico(ctx, puntos || [])) + '</div>' +
      '<div class="sx2-col-6">' + (fin === undefined ? cargando() : (fin === null ? fallo('Los costos no respondieron.') : bloqueFinanciero(ctx, fin))) + '</div>' +
    '</div>';
  }

  function abrirControl(ctx, p) {
    PY.formulario({
      titulo: p ? 'Editar punto de control' : 'Nuevo punto de control', boton: p ? 'Guardar' : 'Registrar',
      subtitulo: nota('Una fecha, un punto: registrar la misma fecha la actualiza.'),
      campos: PY.campo('Fecha', '<input class="sx2-input" type="date" name="fecha" value="' + (p ? fechaInput(p.fecha) : PY.hoyClave()) + '">') +
        '<div class="sx2-form__fila">' +
          PY.campo('% proyectado', '<input class="sx2-input" type="number" min="0" max="100" step="0.1" name="pct_proyectado" value="' + (p ? U.esc(p.pct_proyectado) : '') + '">') +
          PY.campo('% real', '<input class="sx2-input" type="number" min="0" max="100" step="0.1" name="pct_real" value="' + (p && !vacioNum(p.pct_real) ? U.esc(p.pct_real) : '') + '" placeholder="Opcional">') +
        '</div>' +
        PY.campo('Nota', '<textarea class="sx2-input" name="nota" maxlength="1000">' + U.esc(p ? p.nota || '' : '') + '</textarea>'),
      preparar: function (d) { if (!d.fecha) return 'Indica la fecha.'; if (d.pct_proyectado === '') return 'Indica el % proyectado.'; return d; },
      accion: 'gestionarControlAvanceProyecto', aviso: 'Punto de control guardado.',
      listo: function () { PY.invalidarExtra('avance'); },
      eliminar: p ? { titulo: '¿Eliminar el control del ' + PY.fecha(p.fecha, true) + '?',
        enviar: function () { return PY.api('gestionarControlAvanceProyecto', { proyecto_id: PY.estado().proyectoId, accion: 'eliminar', control_id: p.control_id }); } } : null
    });
  }

  function abrirPago(ctx, e) {
    var fin = PY.extra('pagos', 'listarEstadosPagoProyecto') || {};
    var docs = fin.documentos || [];
    var v = function (k) { return e && !vacioNum(e[k]) ? U.esc(e[k]) : ''; };
    PY.formulario({
      titulo: e ? 'Editar pago' : 'Nuevo pago', boton: e ? 'Guardar' : 'Registrar',
      subtitulo: nota('Cada pago con su documento (factura o boleta) y su comprobante como respaldo.'),
      campos: PY.campo('Concepto', '<input class="sx2-input" name="nombre" maxlength="120" value="' + U.esc(e ? e.nombre : '') + '" placeholder="Cuota 1/6, Anticipo, Entrega final…">') +
        '<div class="sx2-form__fila">' +
          PY.campo('Proveedor', '<input class="sx2-input" name="proveedor" maxlength="120" value="' + U.esc(e ? e.proveedor || '' : '') + '" placeholder="Opcional">') +
          PY.campo('Estado', '<select class="sx2-select" name="estado">' + Object.keys(PAGO).map(function (k) {
            return '<option value="' + k + '"' + (k === (e ? e.estado : 'proyectado') ? ' selected' : '') + '>' + PAGO[k].texto + '</option>';
          }).join('') + '</select>') +
        '</div>' +
        '<div class="sx2-form__fila">' +
          PY.campo('N° documento', '<input class="sx2-input" name="documento_numero" maxlength="40" value="' + U.esc(e ? e.documento_numero || '' : '') + '" placeholder="N° factura o boleta">') +
          PY.campo('Fecha del documento', '<input class="sx2-input" type="date" name="fecha_documento" value="' + fechaInput(e && e.fecha_documento) + '">') +
        '</div>' +
        '<div class="sx2-form__fila">' +
          PY.campo('Neto', '<input class="sx2-input js-py2s-neto" type="number" min="0" step="any" name="monto_neto" value="' + v('monto_neto') + '" placeholder="Opcional">') +
          PY.campo('Impuesto (IVA)', '<input class="sx2-input js-py2s-iva" type="number" min="0" step="any" name="monto_impuesto" value="' + v('monto_impuesto') + '" placeholder="Opcional">') +
        '</div>' +
        '<div class="sx2-form__fila">' +
          PY.campo('Monto total', '<input class="sx2-input js-py2s-total" type="number" min="0" step="any" name="monto_proyectado" value="' + v('monto_proyectado') + '">', 'Si completas neto e impuesto, se suma solo.') +
          PY.campo('Fecha prevista', '<input class="sx2-input" type="date" name="fecha_proyectada" value="' + fechaInput(e && e.fecha_proyectada) + '">') +
        '</div>' +
        '<div class="sx2-form__fila">' +
          PY.campo('Fecha de pago', '<input class="sx2-input" type="date" name="fecha_real" max="' + PY.hoyClave() + '" value="' + fechaInput(e && e.fecha_real) + '">') +
          PY.campo('Monto pagado', '<input class="sx2-input" type="number" min="0" step="any" name="monto_real" value="' + v('monto_real') + '" placeholder="Al pagar">') +
        '</div>' +
        PY.campo('Respaldo', '<select class="sx2-select" name="documento_id"><option value="">Sin respaldo</option>' + docs.map(function (d) {
          return '<option value="' + U.esc(d.documento_id) + '"' + (e && e.documento_id === d.documento_id ? ' selected' : '') + '>' + U.esc(d.nombre) + '</option>';
        }).join('') + '</select>', docs.length ? 'Un documento ya subido en Archivos del proyecto.' : 'Sube la factura o el comprobante en Archivos para poder vincularlo.') +
        PY.campo('Nota', '<textarea class="sx2-input" name="nota" maxlength="1000" rows="2">' + U.esc(e ? e.nota || '' : '') + '</textarea>'),
      alMontar: function (form) {
        var neto = form.querySelector('.js-py2s-neto'), iva = form.querySelector('.js-py2s-iva'), total = form.querySelector('.js-py2s-total');
        function sumar() {
          if (neto.value === '' || iva.value === '') return;
          total.value = Math.round((Number(neto.value) + Number(iva.value)) * 100) / 100;
        }
        neto.addEventListener('input', sumar);
        iva.addEventListener('input', sumar);
      },
      preparar: function (d) {
        if (!d.nombre) return 'El concepto es obligatorio.';
        if (!d.fecha_proyectada) return 'Indica la fecha prevista.';
        if (d.monto_proyectado === '') return 'Indica el monto total.';
        if (d.estado === 'pagado' && !d.fecha_real) return 'Indica la fecha de pago.';
        if (d.estado === 'pagado' && d.monto_real === '') d.monto_real = d.monto_proyectado;
        if (e) d.estado_pago_id = e.estado_pago_id;
        return d;
      },
      accion: 'gestionarEstadoPagoProyecto', aviso: 'Pago guardado.',
      listo: function () { PY.invalidarExtra('pagos'); },
      eliminar: e ? { titulo: '¿Eliminar "' + e.nombre + '"?',
        enviar: function () { return PY.api('gestionarEstadoPagoProyecto', { proyecto_id: PY.estado().proyectoId, accion: 'eliminar', estado_pago_id: e.estado_pago_id }); } } : null
    });
  }

  // =========================================================================
  // Analítica
  // =========================================================================
  function conDato(an) {
    return ((an && an.por_tarea) || []).filter(function (t) {
      return t.lead_time_dias !== null || t.cycle_time_dias !== null || t.tiempo_bloqueo_dias > 0 || t.tiempo_revision_dias > 0;
    });
  }
  function pintarAnalitica(ctx) {
    var an = PY.extra('analitica', 'obtenerAnaliticaProyecto');
    if (an === undefined) return U.esqueleto('kpis', 5) + cargando();
    if (an === null) return fallo('La analítica no respondió.');
    var filas = conDato(an);
    var d = function (v) { return v === null || v === undefined ? '—' : v; };
    var kpis = '<div class="sx2-fila-kpis">' +
      U.kpi({ i: 0, icono: 'reloj', tono: 'primario', etiqueta: 'Lead time', valor: d(an.lead_time_promedio_dias), unidad: 'días promedio', titulo: 'Desde que se creó la tarea hasta que se terminó. Solo tareas terminadas.' }) +
      U.kpi({ i: 1, icono: 'rayo', tono: 'info', etiqueta: 'Cycle time', valor: d(an.cycle_time_promedio_dias), unidad: 'días promedio', titulo: 'Desde el primer avance real hasta que se terminó.' }) +
      U.kpi({ i: 2, icono: 'pausado', tono: an.tiempo_bloqueo_total_dias > 0 ? 'critico' : 'neutro', etiqueta: 'En bloqueo', valor: an.tiempo_bloqueo_total_dias || 0, unidad: 'días sumados' }) +
      U.kpi({ i: 3, icono: 'ojo', tono: 'hito', etiqueta: 'En revisión', valor: an.tiempo_revision_total_dias || 0, unidad: 'días sumados' }) +
      (an.spi_promedio !== null && an.spi_promedio !== undefined ? U.kpi({ i: 4, icono: an.spi_promedio < 1 ? 'tendenciaBaja' : 'tendencia', tono: an.spi_promedio < 0.9 ? 'critico' : (an.spi_promedio < 1 ? 'alerta' : 'ok'),
        etiqueta: 'SPI', valor: an.spi_promedio, unidad: an.spi_promedio < 1 ? 'bajo el ritmo esperado' : 'a tiempo o adelantado', titulo: 'Avance real ÷ avance esperado a hoy. 1 = a tiempo.' }) : '') +
    '</div>';
    if (!filas.length) return kpis + U.card({ cuerpo: U.vacio({ icono: 'grafico', titulo: 'Aún no hay datos para desglosar', texto: 'Aparecen cuando hay tareas terminadas, bloqueadas o en revisión.' }) });
    return kpis + '<div class="sx2-grid sx2-grid--estira">' +
      '<div class="sx2-col-5 sx2-col--apila">' + U.card({ titulo: 'Tareas más lentas', icono: 'grafico', sub: 'días, top 8', i: 2,
        cuerpo: '<div class="sx2-py-grafico sx2-py-grafico--alto"><canvas id="py2-grafico-analitica" role="img" aria-label="Tareas con mayor lead time"></canvas></div>' }) + '</div>' +
      '<div class="sx2-col-7"><section class="sx2-card sx2-entra" style="--i:3"><div class="sx2-card__cab"><h2 class="sx2-card__titulo">' + U.ico('tabla', 18) + 'Detalle por tarea <span class="sx2-card__sub">' + filas.length + '</span></h2>' +
        U.boton({ texto: 'Excel', icono: 'exportar', sm: true, clase: 'js-py2s-an-excel' }) + '</div>' +
        '<div class="sx2-tabla-wrap" style="max-height:420px"><table class="sx2-tabla"><thead><tr><th>Tarea</th><th class="sx2-num">Lead</th><th class="sx2-num">Cycle</th><th class="sx2-num">Bloqueo</th><th class="sx2-num">Revisión</th></tr></thead><tbody>' +
          filas.map(function (t) {
            return '<tr' + (t.actividad_id ? ' class="sx2-fila--clic" data-py2-tarea="' + U.esc(t.actividad_id) + '"' : '') + '><td>' + U.esc(t.titulo) + '</td>' +
              '<td class="sx2-num">' + (t.lead_time_dias === null ? '—' : t.lead_time_dias + ' d') + '</td>' +
              '<td class="sx2-num">' + (t.cycle_time_dias === null ? '—' : t.cycle_time_dias + ' d') + '</td>' +
              '<td class="sx2-num' + (t.tiempo_bloqueo_dias > 0 ? ' sx2-delta--mal' : '') + '">' + (t.tiempo_bloqueo_dias > 0 ? t.tiempo_bloqueo_dias + ' d' : '—') + '</td>' +
              '<td class="sx2-num">' + (t.tiempo_revision_dias > 0 ? t.tiempo_revision_dias + ' d' : '—') + '</td></tr>';
          }).join('') + '</tbody></table></div></section></div>' +
    '</div>';
  }
  // R-4: Excel real en vez de CSV (los días como números: se pueden promediar y ordenar).
  function exportarExcel(ctx, b) {
    var filas = conDato(PY.extra('analitica', 'obtenerAnaliticaProyecto'));
    var num = function (v) { return v === null || v === undefined || v === '' ? '' : Number(v); };
    SigsoReportes.descargarExcelDeDatos({
      titulo: 'Analítica · ' + (ctx.proyecto.nombre || 'Proyecto'), nombreArchivo: 'sigso-analitica-' + (ctx.proyecto.codigo || ctx.proyecto.nombre || 'proyecto'),
      meta: [['Proyecto', (ctx.proyecto.codigo ? ctx.proyecto.codigo + ' · ' : '') + (ctx.proyecto.nombre || '')]],
      hojas: [{ nombre: 'Analítica', columnas: ['Tarea', 'Lead time (d)', 'Cycle time (d)', 'Bloqueo (d)', 'Revisión (d)'],
        filas: filas.map(function (t) { return [t.titulo, num(t.lead_time_dias), num(t.cycle_time_dias), num(t.tiempo_bloqueo_dias), num(t.tiempo_revision_dias)]; }) }]
    }, { boton: b });
  }

  // =========================================================================
  // Gráficos (Chart.js ya cargado por el shell)
  // =========================================================================
  // Los tokens pueden venir como hex, rgb() o color-mix(): se resuelven a
  // rgb() a través de un elemento para que Chart.js (canvas) los entienda.
  function color(raiz, v) {
    var el = document.createElement('span');
    el.style.color = 'var(' + v + ')';
    el.style.display = 'none';
    raiz.appendChild(el);
    var c = getComputedStyle(el).color || '#888';
    el.remove();
    return c;
  }
  function conAlfa(c, a) {
    var m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return c;
    var p = m[1].split(/[\s,\/]+/).filter(Boolean);
    return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + a + ')';
  }
  function limpiarGraficos() { graficos_.forEach(function (g) { try { g.destroy(); } catch (e) { /* ya destruido */ } }); graficos_ = []; }
  function opcionesBase(raiz, extra) {
    var t3 = color(raiz, '--sx-texto-3'), borde = color(raiz, '--sx-borde-suave');
    return Object.assign({
      maintainAspectRatio: false,
      animation: U.reducirMovimiento() ? false : { duration: 700 },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false }, ticks: { color: t3, font: { size: 10 }, maxRotation: 0, autoSkip: true } },
        y: { beginAtZero: true, grid: { color: borde }, ticks: { color: t3, font: { size: 10 } } }
      },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, color: color(raiz, '--sx-texto-2'), font: { size: 11 } } } }
    }, extra || {});
  }
  function dibujar(raiz, ctx) {
    limpiarGraficos();
    if (!window.Chart) return;
    var prim = color(raiz, '--sx-primario'), ok = color(raiz, '--sx-ok'), hito = color(raiz, '--sx-hito'), neutro = color(raiz, '--sx-texto-3');
    var c = raiz.querySelector('#py2-grafico-fisico');
    var cs = c && curvaS(ctx);
    if (c && cs) {
      var controles = PY.extra('avance', 'listarControlAvanceProyecto', function (d) { return d.puntos || []; }) || [];
      var op = opcionesBase(raiz);
      op.scales.y.max = 100;
      op.scales.y.ticks.callback = function (v) { return v + '%'; };
      op.plugins.tooltip = { callbacks: { label: function (it) { return it.dataset.label + ': ' + it.parsed.y + '%'; } } };
      // Controles declarados (si los hay): cada uno en la semana que le corresponde.
      var declarados = cs.puntos.map(function () { return null; });
      controles.forEach(function (k) {
        if (vacioNum(k.pct_real)) return;
        var t = Date.parse(String(k.fecha).slice(0, 10)), idx = 0;
        cs.puntos.forEach(function (p, i) { if (p.t <= t) idx = i; });
        declarados[idx] = Number(k.pct_real);
      });
      var datasets = [
        { label: 'Plan', data: cs.puntos.map(function (p) { return p.plan; }), borderColor: neutro, borderDash: [6, 4], pointRadius: 0, tension: 0.25, fill: false },
        { label: 'Real', data: cs.puntos.map(function (p) { return p.real; }), borderColor: prim, backgroundColor: conAlfa(prim, 0.13), pointRadius: 0, pointHoverRadius: 4, tension: 0.25, fill: true, spanGaps: false }
      ];
      if (declarados.some(function (x) { return x !== null; })) {
        datasets.push({ label: 'Control declarado', data: declarados, borderColor: hito, backgroundColor: hito, showLine: false, pointRadius: 5, pointStyle: 'rectRot' });
      }
      graficos_.push(new Chart(c, { type: 'line', options: op, data: { labels: cs.puntos.map(function (p) { return PY.fecha(new Date(p.t).toISOString()); }), datasets: datasets } }));
    }
    c = raiz.querySelector('#py2-grafico-financiero');
    var fin = c && PY.extra('pagos', 'listarEstadosPagoProyecto');
    if (c && fin && (fin.estados || []).length) {
      var moneda = fin.presupuesto_moneda || 'CLP', aP = 0, aR = 0;
      var of = opcionesBase(raiz);
      of.scales.y.ticks.callback = function (v) { return montoCorto(v, moneda); };
      of.plugins.tooltip = { callbacks: { label: function (it) { return it.dataset.label + ': ' + monto(it.parsed.y, moneda); } } };
      var presupuesto = fin.resumen && fin.resumen.presupuesto;
      var dsF = [
        { label: 'Comprometido acumulado', data: fin.estados.map(function (e) { aP += Number(e.monto_proyectado) || 0; return aP; }), borderColor: neutro, borderDash: [6, 4], pointRadius: 3, tension: 0.3 },
        { label: 'Pagado acumulado', data: fin.estados.map(function (e) { if (e.estado !== 'pagado') return null; aR += Number(vacioNum(e.monto_real) ? e.monto_proyectado : e.monto_real) || 0; return aR; }), borderColor: ok, backgroundColor: conAlfa(ok, 0.13), pointRadius: 4, tension: 0.3, fill: true, spanGaps: true }
      ];
      if (presupuesto) dsF.push({ label: 'Presupuesto', data: fin.estados.map(function () { return presupuesto; }), borderColor: color(raiz, '--sx-critico'), borderWidth: 1, borderDash: [2, 3], pointRadius: 0, fill: false });
      graficos_.push(new Chart(c, { type: 'line', options: of, data: {
        labels: fin.estados.map(function (e) { return String(e.nombre).split(' · ')[0]; }),
        datasets: dsF } }));
    }
    c = raiz.querySelector('#py2-grafico-analitica');
    var an = c && PY.extra('analitica', 'obtenerAnaliticaProyecto');
    if (c && an) {
      var top = conDato(an).filter(function (t) { return t.lead_time_dias !== null; })
        .sort(function (a, b) { return b.lead_time_dias - a.lead_time_dias; }).slice(0, 8);
      var oa = opcionesBase(raiz, { indexAxis: 'y' });
      oa.scales = {
        x: { beginAtZero: true, grid: { color: color(raiz, '--sx-borde-suave') }, ticks: { color: neutro, font: { size: 10 } } },
        y: { grid: { display: false }, ticks: { color: color(raiz, '--sx-texto-2'), font: { size: 10 }, callback: function (v) { var s = this.getLabelForValue(v); return s.length > 26 ? s.slice(0, 25) + '…' : s; } } }
      };
      graficos_.push(new Chart(c, { type: 'bar', options: oa, data: {
        labels: top.map(function (t) { return t.titulo; }),
        datasets: [
          { label: 'Lead time', data: top.map(function (t) { return t.lead_time_dias; }), backgroundColor: hito, borderRadius: 4, maxBarThickness: 14 },
          { label: 'Cycle time', data: top.map(function (t) { return t.cycle_time_dias; }), backgroundColor: prim, borderRadius: 4, maxBarThickness: 14 }
        ] } }));
    }
  }

  // =========================================================================
  // Sección
  // =========================================================================
  function contadorSub(ctx, id) {
    if (id === 'hitos') return hitosDe(ctx).filter(function (h) { return h.estado !== 'COMPLETADO' && h.estado !== 'CANCELADO'; }).length;
    if (id === 'riesgos') return riesgosDe(ctx).filter(activo).length;
    if (id === 'reuniones') { var r = PY.estado().datos.extra; return r && r.reuniones ? r.reuniones.length : null; }
    return null;
  }

  function pintar(ctx) {
    if (PY.subSeguimiento) { sub = PY.subSeguimiento; PY.subSeguimiento = null; }
    var cuerpo = { hitos: pintarHitos, riesgos: pintarRiesgos, reuniones: pintarReuniones, avance: pintarAvance, analitica: pintarAnalitica }[sub] || pintarHitos;
    return '<div class="sx2-con-subnav">' +
      '<nav class="sx2-subnav sx2-entra" aria-label="Seguimiento">' + SUBS.map(function (s) {
        var n = contadorSub(ctx, s.id);
        return '<button type="button" class="sx2-subnav__item js-py2s-sub" data-id="' + s.id + '"' + (s.id === sub ? ' aria-current="page"' : '') + '>' +
          U.ico(s.icono, 16) + '<span style="flex:1">' + s.texto + '</span>' + (n ? '<span class="sx2-nav__contador">' + n + '</span>' : '') + '</button>';
      }).join('') + '</nav>' +
      '<div class="sx2-apilado" style="min-width:0">' + cuerpo(ctx) + '</div>' +
    '</div>';
  }

  function porId(lista, campo, id) { return (lista || []).filter(function (x) { return x[campo] === id; })[0]; }

  function alMontar(raiz, ctx) {
    dibujar(raiz, ctx);
    raiz.addEventListener('click', function (ev) {
      var t = ev.target, b;
      if ((b = t.closest('.js-py2s-sub'))) { sub = b.getAttribute('data-id'); filtroRiesgo = null; PY.pintar({ soloCuerpo: true }); return; }
      if ((b = t.closest('[data-py2-tarea]'))) { PY.abrirTarea(b.getAttribute('data-py2-tarea')); return; }
      // Hitos
      if (t.closest('.js-py2s-h-nuevo')) { abrirHito(ctx, null); return; }
      if ((b = t.closest('.js-py2s-h-editar'))) { abrirHito(ctx, porId(ctx.detalle.hitos, 'hito_id', b.getAttribute('data-id'))); return; }
      if ((b = t.closest('.js-py2s-h-completar'))) {
        PY.accionConfirmada({ titulo: '¿Completar "' + b.getAttribute('data-nombre') + '"?', texto: 'El hito queda cerrado y deja de contar como vencido.', boton: 'Completar',
          accion: 'gestionarHitoProyecto', datos: { hito_id: b.getAttribute('data-id'), estado: 'COMPLETADO' }, aviso: 'Hito completado.' });
        return;
      }
      if ((b = t.closest('.js-py2s-h-ver'))) { PY.hitoTrabajo = b.getAttribute('data-id'); PY.modoTrabajo = 'tabla'; PY.filtroTrabajo = 'todas'; PY.irSeccion('trabajo'); return; }
      // Riesgos
      if ((b = t.closest('.sx2-py-matriz__celda'))) {
        var p = b.getAttribute('data-p'), i = b.getAttribute('data-i');
        filtroRiesgo = (filtroRiesgo && filtroRiesgo.p === p && filtroRiesgo.i === i) ? null : { p: p, i: i };
        PY.pintar({ sinAnimacion: true });
        return;
      }
      if (t.closest('.js-py2s-r-sinfiltro')) { filtroRiesgo = null; PY.pintar({ sinAnimacion: true }); return; }
      if (t.closest('.js-py2s-r-nuevo')) { abrirRiesgo(ctx, null); return; }
      if ((b = t.closest('.js-py2s-r-editar'))) { abrirRiesgo(ctx, porId(ctx.detalle.riesgos, 'riesgo_id', b.getAttribute('data-id'))); return; }
      if ((b = t.closest('.js-py2s-r-materializar'))) {
        PY.accionConfirmada({ titulo: '¿El riesgo ya está ocurriendo?', texto: 'Pasa a ser un problema: deja de ser hipotético y se destaca en el proyecto.', boton: 'Sí, es un problema', peligro: true,
          accion: 'gestionarRiesgoProyecto', datos: { accion: 'materializar', riesgo_id: b.getAttribute('data-id') }, aviso: 'Riesgo marcado como problema.' });
        return;
      }
      if ((b = t.closest('.js-py2s-r-cerrar'))) {
        PY.accionConfirmada({ titulo: '¿Cerrar este riesgo?', texto: 'Ya no puede ocurrir o dejó de ser relevante. Queda en el registro como cerrado.', boton: 'Cerrar riesgo',
          accion: 'gestionarRiesgoProyecto', datos: { accion: 'eliminar', riesgo_id: b.getAttribute('data-id') }, aviso: 'Riesgo cerrado.' });
        return;
      }
      // Reuniones / decisiones
      var reus = (PY.estado().datos.extra || {}).reuniones || [];
      var decs = (PY.estado().datos.extra || {}).decisiones || [];
      if (t.closest('.js-py2s-reu-nueva')) { abrirReunion(ctx, null); return; }
      if ((b = t.closest('.js-py2s-reu-editar'))) { abrirReunion(ctx, porId(reus, 'reunion_id', b.getAttribute('data-id'))); return; }
      if ((b = t.closest('.js-py2s-reu-eliminar'))) {
        PY.accionConfirmada({ titulo: '¿Eliminar "' + b.getAttribute('data-nombre') + '"?', texto: 'Se borran la reunión y sus acuerdos.', boton: 'Eliminar', peligro: true,
          accion: 'gestionarReunionProyecto', datos: { accion: 'eliminar', reunion_id: b.getAttribute('data-id') }, aviso: 'Reunión eliminada.',
          listo: function () { PY.invalidarExtra('reuniones'); } });
        return;
      }
      if ((b = t.closest('.js-py2s-ac-nuevo'))) { abrirAcuerdo(b.getAttribute('data-id')); return; }
      if ((b = t.closest('.js-py2s-ac-convertir'))) {
        var ac = null;
        reus.forEach(function (r) { (r.acuerdos || []).forEach(function (a) { if (a.acuerdo_id === b.getAttribute('data-id')) ac = a; }); });
        if (ac) abrirConvertir(ctx, ac);
        return;
      }
      if ((b = t.closest('.js-py2s-ac-quitar'))) {
        PY.accionConfirmada({ titulo: '¿Quitar este acuerdo?', boton: 'Quitar', peligro: true,
          accion: 'eliminarAcuerdoReunionProyecto', datos: { acuerdo_id: b.getAttribute('data-id') },
          listo: function () { PY.invalidarExtra('reuniones'); } });
        return;
      }
      if (t.closest('.js-py2s-dec-nueva')) { abrirDecision(ctx, null); return; }
      if ((b = t.closest('.js-py2s-dec-editar'))) { abrirDecision(ctx, porId(decs, 'decision_id', b.getAttribute('data-id'))); return; }
      if ((b = t.closest('.js-py2s-dec-eliminar'))) {
        PY.accionConfirmada({ titulo: '¿Eliminar esta decisión?', boton: 'Eliminar', peligro: true,
          accion: 'gestionarDecisionProyecto', datos: { accion: 'eliminar', decision_id: b.getAttribute('data-id') }, aviso: 'Decisión eliminada.',
          listo: function () { PY.invalidarExtra('decisiones'); } });
        return;
      }
      // Avance y costos
      var ex = PY.estado().datos.extra || {};
      if (t.closest('.js-py2s-av-nuevo')) { abrirControl(ctx, null); return; }
      if ((b = t.closest('.js-py2s-av-editar'))) { abrirControl(ctx, porId(ex.avance, 'control_id', b.getAttribute('data-id'))); return; }
      if ((b = t.closest('.js-py2s-pago-doc'))) {
        b.disabled = true;
        PY.api('descargarDocumentoProyecto', { proyecto_id: PY.estado().proyectoId, documento_id: b.getAttribute('data-id') }).then(function (r) {
          b.disabled = false;
          if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo descargar el respaldo.', 'error'); return; }
          PY.descargarBase64(r.data.contenido_base64, r.data.nombre_archivo, r.data.mime);
        });
        return;
      }
      if (t.closest('.js-py2s-pago-nuevo')) { abrirPago(ctx, null); return; }
      if ((b = t.closest('.js-py2s-pago-editar'))) { abrirPago(ctx, porId(ex.pagos && ex.pagos.estados, 'estado_pago_id', b.getAttribute('data-id'))); return; }
      // Analítica
      if (t.closest('.js-py2s-an-excel')) { exportarExcel(ctx, t.closest('.js-py2s-an-excel')); return; }
    });
  }

  PY.secciones.seguimiento = { pintar: pintar, alMontar: alMontar };
})();
