/**
 * proyectos-v2/resumen.js — sección "Resumen" de un proyecto (el dashboard
 * de la referencia): KPIs, Gantt compacto de 12 semanas, avance real vs
 * esperado, carga del equipo, próximas tareas, actividad reciente e hitos,
 * y la franja de alertas.
 *
 * Todo sale de los datos que ya cargó el núcleo (detalle, tareas, bitácora,
 * rendimiento): cero llamadas nuevas. Los cálculos compartidos con otras
 * secciones (métricas por estado de plazo, frases de la bitácora, tiempo
 * relativo) se exponen en PYv2 para no duplicarlos.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var DIA = 86400000;

  // --- Cálculos compartidos -------------------------------------------------
  function planPorId(ctx) {
    var m = {};
    ((ctx.rendimiento && ctx.rendimiento.plan_seguimiento) || []).forEach(function (t) { m[t.actividad_id] = t; });
    return m;
  }
  function esTerminal(a) { return a.estado === 'TERMINADA' || a.estado === 'CANCELADA'; }

  // Mismo criterio que v1 (pintarPlanificacionKpis_): el estado de PLAZO
  // (backend, obtenerRendimiento) manda sobre el semáforo para
  // atrasada/en riesgo.
  function metricas(ctx) {
    var plan = planPorId(ctx);
    var m = { total: 0, completadas: 0, enCurso: 0, atrasadas: 0, enRiesgo: 0, antesDePlazo: 0, entregadas: 0, aTiempo: 0 };
    ctx.tareas.forEach(function (a) {
      if (a.estado === 'CANCELADA') return;
      m.total++;
      if (a.estado === 'TERMINADA') {
        m.completadas++;
        if (a.fecha_terminada && a.fecha_compromiso) {
          m.entregadas++;
          var fin = new Date(a.fecha_terminada), comp = new Date(a.fecha_compromiso);
          if (fin <= comp) m.aTiempo++;
          if (fin < new Date(comp.getTime() - DIA)) m.antesDePlazo++;
        }
        return;
      }
      var ep = (plan[a.actividad_id] || {}).estado_plazo;
      if (ep === 'ATRASADA' || a.semaforo === 'atrasada') m.atrasadas++;
      else if (ep === 'EN_RIESGO' || a.semaforo === 'riesgo') m.enRiesgo++;
      else m.enCurso++;
    });
    m.cumplimiento = m.entregadas ? Math.round(m.aTiempo / m.entregadas * 100) : null;
    return m;
  }

  function haceTiempo(ts) {
    var t = new Date(ts).getTime();
    if (isNaN(t)) return '';
    var min = Math.round((Date.now() - t) / 60000);
    if (min < 1) return 'recién';
    if (min < 60) return 'hace ' + min + ' min';
    var h = Math.round(min / 60);
    if (h < 24) return 'hace ' + h + ' h';
    var d = Math.round(h / 24);
    if (d < 30) return 'hace ' + d + ' d';
    return PY.fecha(ts, true);
  }

  var BITACORA = {
    CREADA: { ico: 'nueva', tono: 'primario', txt: 'asignó' },
    CHECKIN_AVANCE: { ico: 'tendencia', tono: 'info', txt: 'reportó avance en' },
    CHECKIN_SIN_CAMBIO: { ico: 'estado', tono: 'neutro', txt: 'actualizó sin cambios' },
    BLOQUEO: { ico: 'candado', tono: 'critico', txt: 'marcó como bloqueada' },
    DESBLOQUEO: { ico: 'llave', tono: 'ok', txt: 'destrabó' },
    ENTREGA: { ico: 'check', tono: 'ok', txt: 'entregó' },
    VALIDACION: { ico: 'ojo', tono: 'primario', txt: 'revisó' },
    REPROGRAMACION: { ico: 'calendario', tono: 'alerta', txt: 'reprogramó' },
    REASIGNACION: { ico: 'persona', tono: 'hito', txt: 'reasignó' },
    REGISTRO_DIA: { ico: 'documento', tono: 'info', txt: 'registró el día en' }
  };
  var SALA = {
    ACTUALIZACION: { ico: 'tendencia', tono: 'info', txt: 'publicó una actualización' },
    COMENTARIO: { ico: 'comentario', tono: 'neutro', txt: 'comentó' },
    DECISION: { ico: 'check', tono: 'ok', txt: 'registró una decisión' },
    REUNION: { ico: 'calendario', tono: 'primario', txt: 'registró una reunión' },
    BLOQUEO: { ico: 'candado', tono: 'critico', txt: 'avisó un bloqueo' },
    SOLICITUD_LIDER: { ico: 'campana', tono: 'alerta', txt: 'hizo una solicitud' }
  };

  // Una sola línea de tiempo con la bitácora de tareas + la Sala del proyecto.
  function feed(ctx, limite) {
    var titulos = {};
    ctx.tareas.forEach(function (a) { titulos[a.actividad_id] = a.titulo; });
    var items = ctx.bitacora.map(function (b) {
      var def = BITACORA[b.tipo] || { ico: 'estado', tono: 'neutro', txt: 'actualizó' };
      var extra = '';
      if (b.tipo === 'REPROGRAMACION' && b.fecha_nueva) extra = ' · ' + PY.fecha(b.fecha_anterior) + ' → ' + PY.fecha(b.fecha_nueva);
      if (b.horas) extra += ' · ' + b.horas + ' h';
      return {
        // El REGISTRO_DIA guarda su timestamp fijo a mediodía del día que
        // describe; para "cuándo pasó" se usa cuándo se cargó/editó.
        ts: (b.tipo === 'REGISTRO_DIA') ? (b.editado_en || (b.dia ? b.dia + 'T13:00:00Z' : b.timestamp)) : b.timestamp, def: def,
        autor: PY.persona(b.autor_email, b.autor_nombre), objeto: titulos[b.actividad_id] || '', extra: extra,
        nota: b.nota, actividadId: b.actividad_id
      };
    }).concat(ctx.sala.map(function (e) {
      var def = SALA[e.tipo] || SALA.COMENTARIO;
      return { ts: e.timestamp, def: def, autor: PY.persona(e.autor_email, e.autor_nombre), objeto: e.titulo || '', extra: '', nota: e.cuerpo };
    }));
    items.sort(function (a, b) { return new Date(b.ts) - new Date(a.ts); });
    return items.slice(0, limite || 8);
  }

  function feedHtml(items) {
    if (!items.length) return U.vacio({ icono: 'actividad', texto: 'Todavía no hay actividad en este proyecto.' });
    return '<ul class="sx2-py-feed">' + items.map(function (it, i) {
      return '<li class="sx2-py-feed__item sx2-entra" style="--i:' + i + '"' + (it.actividadId ? ' data-py2-tarea="' + U.esc(it.actividadId) + '"' : '') + '>' +
        '<span class="sx2-py-feed__av">' + U.avatar(it.autor, 'sm') +
          '<span class="sx2-py-feed__tipo sx2-tono-' + it.def.tono + '">' + U.ico(it.def.ico, 10) + '</span></span>' +
        '<span class="sx2-py-feed__txt">' +
          '<span><strong>' + U.esc(it.autor.nombre) + '</strong> ' + U.esc(it.def.txt) +
            (it.objeto ? ' <span class="sx2-py-feed__obj">' + U.esc(it.objeto) + '</span>' : '') + U.esc(it.extra) + '</span>' +
          (it.nota ? '<span class="sx2-py-feed__nota">' + U.esc(String(it.nota).slice(0, 180)) + '</span>' : '') +
        '</span>' +
        '<span class="sx2-py-feed__cuando">' + haceTiempo(it.ts) + '</span>' +
      '</li>';
    }).join('') + '</ul>';
  }

  // El Gantt (adelanto de 12 semanas) lo pinta gantt.js: un solo renderizador
  // para el Resumen y para Trabajo.

  // --- Tarjetas --------------------------------------------------------------------
  function kpis(ctx, m) {
    var pct = function (n) { return m.total ? Math.round(n / m.total * 100) + '%' : '0%'; };
    return '<div class="sx2-fila-kpis">' +
      U.kpi({ i: 0, icono: 'capas', tono: 'primario', etiqueta: 'Total de tareas', valor: m.total, unidad: 'tareas', filtro: 'todas' }) +
      U.kpi({ i: 1, icono: 'check', tono: 'ok', etiqueta: 'Completadas', valor: m.completadas, unidad: 'tareas', tendencia: { texto: pct(m.completadas), tono: 'ok' }, filtro: 'completadas' }) +
      U.kpi({ i: 2, icono: 'estado', tono: 'info', etiqueta: 'En plazo', valor: m.enCurso, unidad: 'tareas', tendencia: { texto: pct(m.enCurso), tono: 'info' }, filtro: 'en-curso' }) +
      U.kpi({ i: 3, icono: 'alerta', tono: 'critico', etiqueta: 'Atrasadas', valor: m.atrasadas, unidad: m.atrasadas === 1 ? 'tarea' : 'tareas', tendencia: { texto: pct(m.atrasadas), tono: 'critico' }, filtro: 'atrasadas' }) +
      U.kpi({ i: 4, icono: 'rayo', tono: 'alerta', etiqueta: 'En riesgo', valor: m.enRiesgo, unidad: m.enRiesgo === 1 ? 'tarea' : 'tareas', tendencia: { texto: pct(m.enRiesgo), tono: 'alerta' }, filtro: 'en-riesgo' }) +
      U.kpi({ i: 5, icono: 'diana', tono: m.cumplimiento === null ? 'neutro' : (m.cumplimiento >= 80 ? 'ok' : (m.cumplimiento >= 50 ? 'alerta' : 'critico')), etiqueta: 'Cumplimiento de plazos',
        valor: m.cumplimiento === null ? '—' : m.cumplimiento, sufijo: m.cumplimiento === null ? '' : '%', unidad: m.entregadas ? m.aTiempo + ' de ' + m.entregadas + ' a tiempo' : 'sin entregas aún',
        progreso: m.cumplimiento === null ? null : m.cumplimiento }) +
    '</div>';
  }

  function avance(ctx) {
    var d = ctx.detalle;
    var real = d.avance_pct, esp = d.avance_esperado_pct;
    var desv = (real !== null && real !== undefined && esp !== null && esp !== undefined) ? Math.round((real - esp) * 10) / 10 : null;
    var tono = PY.TONO_SALUD[d.salud] || 'primario';
    var prox = (d.hitos || []).filter(function (h) { return h.estado !== 'COMPLETADO' && h.estado !== 'CANCELADO' && h.fecha_objetivo; })
      .sort(function (a, b) { return new Date(a.fecha_objetivo) - new Date(b.fecha_objetivo); })[0];
    var diasProx = prox ? PY.diasHasta(prox.fecha_objetivo) : null;
    return '<div class="sx2-py-avance">' +
      '<div class="sx2-py-avance__anillo">' + U.anillo(real || 0, { tam: 120, grosor: 11, tono: tono }) + '</div>' +
      '<div class="sx2-apilado" style="gap:10px;flex:1;min-width:0">' +
        '<div><div class="sx2-entre"><span class="sx2-tenue">Real</span><strong>' + (real === null || real === undefined ? '—' : real + '%') + '</strong></div>' + U.barra(real || 0, tono, true) + '</div>' +
        '<div><div class="sx2-entre"><span class="sx2-tenue">Esperado a hoy</span><strong>' + (esp === null || esp === undefined ? '—' : esp + '%') + '</strong></div>' + U.barra(esp || 0, 'neutro', true) + '</div>' +
        (desv !== null ? U.badge((desv >= 0 ? '+' : '') + desv + ' pp ' + (desv >= 0 ? 'sobre lo esperado' : 'bajo lo esperado'), desv >= 0 ? 'ok' : 'critico') : '') +
      '</div>' +
    '</div>' +
    (prox ? '<div class="sx2-py-proximo">' + U.ico('bandera', 16) + '<span class="sx2-cortar"><span class="sx2-tenue">Próximo hito · </span><strong>' + U.esc(prox.nombre) + '</strong></span>' +
      U.badge(diasProx < 0 ? 'Venció hace ' + (-diasProx) + ' d' : (diasProx === 0 ? 'Hoy' : 'En ' + diasProx + ' d'), diasProx < 0 ? 'critico' : (diasProx <= 7 ? 'alerta' : 'hito')) + '</div>' : '') +
    ((d.salud_motivos && d.salud_motivos.length) ? '<ul class="sx2-py-motivos">' + d.salud_motivos.slice(0, 4).map(function (mo) {
      return '<li>' + U.ico('alerta', 13) + U.esc(mo) + '</li>';
    }).join('') + '</ul>' : '');
  }

  function equipo(ctx) {
    var porPersona = {};
    ctx.tareas.forEach(function (a) {
      if (a.estado === 'CANCELADA' || !a.responsable_email) return;
      var k = a.responsable_email.toLowerCase();
      var x = porPersona[k] || (porPersona[k] = { email: a.responsable_email, nombre: a.responsable_nombre, total: 0, hechas: 0, atrasadas: 0, abiertas: 0 });
      x.total++;
      if (a.estado === 'TERMINADA') x.hechas++;
      else { x.abiertas++; if (a.semaforo === 'atrasada') x.atrasadas++; }
    });
    var lista = Object.keys(porPersona).map(function (k) { return porPersona[k]; }).sort(function (a, b) { return b.abiertas - a.abiertas; });
    if (!lista.length) return U.vacio({ icono: 'equipo', texto: 'Aún no hay tareas asignadas.' });
    var max = Math.max.apply(null, lista.map(function (x) { return x.abiertas; })) || 1;
    return '<div class="sx2-tabla-wrap"><table class="sx2-tabla sx2-py-tabla-equipo"><thead><tr><th>Persona</th><th class="sx2-num">Abiertas</th><th class="sx2-num">Hechas</th><th class="sx2-num">Atrasadas</th><th style="width:28%">Carga</th></tr></thead><tbody>' +
      lista.slice(0, 6).map(function (x) {
        var pct = Math.round(x.abiertas / max * 100);
        return '<tr><td>' + U.persona(PY.persona(x.email, x.nombre)) + '</td>' +
          '<td class="sx2-num">' + x.abiertas + '</td><td class="sx2-num">' + x.hechas + '</td>' +
          '<td class="sx2-num' + (x.atrasadas ? ' sx2-delta--mal' : '') + '">' + x.atrasadas + '</td>' +
          '<td>' + U.barra(pct, pct >= 85 ? 'critico' : (pct >= 60 ? 'alerta' : 'primario')) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function proximas(ctx) {
    var abiertas = ctx.tareas.filter(function (a) { return !esTerminal(a); })
      .sort(function (a, b) { return new Date(a.fecha_compromiso || '9999-12-31') - new Date(b.fecha_compromiso || '9999-12-31'); }).slice(0, 6);
    if (!abiertas.length) return U.vacio({ icono: 'check', titulo: 'Todo al día', texto: 'No hay tareas abiertas.' });
    return '<div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr><th>Tarea</th><th>Responsable</th><th class="sx2-num">Vence</th><th>Estado</th></tr></thead><tbody>' +
      abiertas.map(function (a) {
        var d = PY.diasHasta(a.fecha_compromiso);
        return '<tr class="sx2-fila--clic" data-py2-tarea="' + U.esc(a.actividad_id) + '" tabindex="0">' +
          '<td class="sx2-cortar" style="max-width:260px"><strong>' + U.esc(a.titulo) + '</strong></td>' +
          '<td>' + U.persona(PY.persona(a.responsable_email, a.responsable_nombre)) + '</td>' +
          '<td class="sx2-num' + (d !== null && d < 0 ? ' sx2-delta--mal' : '') + '">' + PY.fecha(a.fecha_compromiso) + '</td>' +
          '<td>' + U.badge(a.semaforo_etiqueta || a.estado, PY.tonoTarea(a)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function hitosLinea(ctx) {
    var hitos = ((ctx.detalle && ctx.detalle.hitos) || []).slice().sort(function (a, b) {
      return new Date(a.fecha_objetivo || '9999-12-31') - new Date(b.fecha_objetivo || '9999-12-31');
    });
    if (!hitos.length) return U.vacio({ icono: 'bandera', texto: 'Este proyecto no tiene hitos.' });
    var hoy = new Date();
    return '<ol class="sx2-py-hitos">' + hitos.map(function (h) {
      var vencido = h.estado !== 'COMPLETADO' && h.estado !== 'CANCELADO' && h.fecha_objetivo && new Date(h.fecha_objetivo) < hoy;
      var tono = h.estado === 'COMPLETADO' ? 'ok' : (vencido ? 'critico' : (h.estado === 'CANCELADO' ? 'neutro' : 'hito'));
      return '<li class="sx2-py-hitos__item sx2-tono-' + tono + '">' +
        '<span class="sx2-py-hitos__marca"></span>' +
        '<span class="sx2-py-hitos__txt"><strong>' + U.esc(h.nombre) + '</strong>' +
          '<span class="sx2-tenue">' + PY.fecha(h.fecha_objetivo, true) + (h.total_tareas ? ' · ' + h.total_tareas + ' tareas' : '') + '</span></span>' +
        (h.avance_pct !== null && h.avance_pct !== undefined ? '<span class="sx2-py-hitos__pct">' + Math.round(Number(h.avance_pct)) + '%</span>' : '') +
      '</li>';
    }).join('') + '</ol>';
  }

  function alertas(ctx, m) {
    var at = (ctx.detalle && ctx.detalle.requiere_atencion) || {};
    var partes = [];
    if (m.atrasadas) partes.push(['critico', 'alerta', m.atrasadas + (m.atrasadas === 1 ? ' tarea atrasada' : ' tareas atrasadas')]);
    if (m.enRiesgo) partes.push(['alerta', 'rayo', m.enRiesgo + (m.enRiesgo === 1 ? ' tarea en riesgo' : ' tareas en riesgo')]);
    if (at.hitos_atrasados) partes.push(['critico', 'bandera', at.hitos_atrasados + (at.hitos_atrasados === 1 ? ' hito vencido' : ' hitos vencidos')]);
    if (at.tareas_bloqueadas) partes.push(['hito', 'candado', at.tareas_bloqueadas + (at.tareas_bloqueadas === 1 ? ' tarea bloqueada' : ' tareas bloqueadas')]);
    if (m.completadas) partes.push(['ok', 'check', m.completadas + (m.completadas === 1 ? ' tarea completada' : ' tareas completadas')]);
    if (m.antesDePlazo) partes.push(['ok', 'tendencia', m.antesDePlazo + (m.antesDePlazo === 1 ? ' terminó antes de plazo' : ' terminaron antes de plazo')]);
    var hayProblemas = m.atrasadas || m.enRiesgo || at.hitos_atrasados || at.tareas_bloqueadas;
    return '<div class="sx2-alertas sx2-entra' + (hayProblemas ? '' : ' sx2-alertas--ok') + '" style="--i:6">' +
      '<span class="sx2-alertas__titulo ' + (hayProblemas ? 'sx2-tono-critico' : 'sx2-tono-ok') + '"><span class="sx2-kpi__ico' + (hayProblemas ? ' sx2-pulso' : '') + '">' +
        U.ico(hayProblemas ? 'alerta' : 'check', 16) + '</span>' + (hayProblemas ? 'Alertas del proyecto' : 'Sin alertas') + '</span>' +
      partes.map(function (p) { return '<span class="sx2-alertas__item sx2-tono-' + p[0] + '">' + U.ico(p[1], 15) + U.esc(p[2]) + '</span>'; }).join('') +
    '</div>';
  }

  function pintar(ctx) {
    var m = metricas(ctx);
    return kpis(ctx, m) +
      '<div class="sx2-grid sx2-grid--estira">' +
        '<div class="sx2-col-8">' + U.card({ titulo: 'Cronograma', icono: 'gantt', sub: '12 semanas', i: 1, accion: { texto: 'Ver Gantt completo', clase: 'js-py2-ir', datos: { seccion: 'trabajo', modo: 'gantt' } }, cuerpo: PY.gantt(ctx, { semanas: 12, limite: 10 }) }) + '</div>' +
        '<div class="sx2-col-4">' + U.card({ titulo: 'Avance del proyecto', icono: 'dona', i: 2, cuerpo: avance(ctx) }) + '</div>' +
        '<div class="sx2-col-7">' + U.card({ titulo: 'Próximas tareas', icono: 'tareas', i: 3, sinRelleno: true, accion: { texto: 'Ver todas', clase: 'js-py2-ir', datos: { seccion: 'trabajo', modo: 'tabla' } }, cuerpo: proximas(ctx) }) + '</div>' +
        '<div class="sx2-col-5">' + U.card({ titulo: 'Carga del equipo', icono: 'equipo', i: 4, sinRelleno: true, accion: { texto: 'Ver equipo', clase: 'js-py2-ir', datos: { seccion: 'equipo' } }, cuerpo: equipo(ctx) }) + '</div>' +
        '<div class="sx2-col-8">' + U.card({ titulo: 'Actividad reciente', icono: 'actividad', i: 5, accion: { texto: 'Abrir la sala', clase: 'js-py2-sala' }, cuerpo: feedHtml(feed(ctx, 8)) }) + '</div>' +
        '<div class="sx2-col-4 sx2-apilado">' + U.card({ titulo: 'Hitos', icono: 'bandera', i: 5, accion: { texto: 'Ver seguimiento', clase: 'js-py2-ir', datos: { seccion: 'seguimiento' } }, cuerpo: hitosLinea(ctx) }) +
          (PY.sobreProyecto ? U.card({ titulo: 'Sobre el proyecto', icono: 'info', i: 6, cuerpo: PY.sobreProyecto(ctx) }) : '') + '</div>' +
      '</div>' +
      alertas(ctx, m);
  }

  function alMontar(raiz) {
    raiz.addEventListener('click', function (ev) {
      var k = ev.target.closest('.sx2-kpi[data-filtro]');
      if (k) { PY.filtroTrabajo = k.getAttribute('data-filtro'); PY.modoTrabajo = 'tabla'; PY.irSeccion('trabajo'); return; }
      var ir = ev.target.closest('.js-py2-ir');
      if (ir) { if (ir.getAttribute('data-modo')) PY.modoTrabajo = ir.getAttribute('data-modo'); PY.filtroTrabajo = ''; PY.irSeccion(ir.getAttribute('data-seccion')); return; }
      var t = ev.target.closest('[data-py2-tarea]');
      if (t && PY.abrirTarea) PY.abrirTarea(t.getAttribute('data-py2-tarea'));
    });
  }

  PY.planPorId = planPorId;
  PY.metricas = metricas;
  PY.haceTiempo = haceTiempo;
  PY.feed = feed;
  PY.feedHtml = feedHtml;
  PY.esTerminal = esTerminal;
  PY.secciones.resumen = { pintar: pintar, alMontar: alMontar };
})();
