/**
 * proyectos-v2/gantt.js — Gantt de Proyectos v2, UN solo renderizador para
 * el adelanto del Resumen y el Gantt completo de Trabajo.
 *
 * Posiciones en % dentro de la pista. Dos modos:
 *  - compacto (sin pxSemana): la pista ocupa el ancho disponible.
 *  - con zoom (pxSemana): la grilla mide semanas × pxSemana y el contenedor
 *    hace scroll horizontal; la columna de nombres queda fija (sticky).
 *
 * opts: { tareas, desde (Date), semanas, pxSemana, agrupar (por hito),
 *         limite, marcarHoy (true) }
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var DIA = 86400000;
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  function lunes(d) {
    var x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    return new Date(x.getTime() - ((x.getUTCDay() + 6) % 7) * DIA);
  }

  // Inicio/fin de barra de una tarea: el plan del backend (plan_seguimiento)
  // manda; si no hay, fecha de creación -> compromiso.
  function tramo(a, p) {
    var fin = new Date((p && p.plan_fin) || a.fecha_compromiso);
    var ini = new Date((p && p.plan_inicio) || a.fecha_inicio_plan || a.fecha_creacion || (fin.getTime() - 7 * DIA));
    if (isNaN(fin.getTime())) return null;
    if (isNaN(ini.getTime()) || ini > fin) ini = new Date(fin.getTime() - DIA);
    return { ini: ini, fin: fin };
  }

  // Rango que cubre todo el proyecto (para el Gantt completo).
  function rangoProyecto(ctx) {
    var plan = PY.planPorId(ctx);
    var hoy = new Date();
    var min = new Date(hoy.getTime() - 7 * DIA), max = new Date(hoy.getTime() + 21 * DIA);
    var p = ctx.proyecto || {};
    if (p.fecha_inicio && new Date(p.fecha_inicio) < min) min = new Date(p.fecha_inicio);
    if (p.fecha_objetivo && new Date(p.fecha_objetivo) > max) max = new Date(p.fecha_objetivo);
    ctx.tareas.forEach(function (a) {
      var t = tramo(a, plan[a.actividad_id]);
      if (!t) return;
      if (t.ini < min) min = t.ini;
      if (t.fin > max) max = t.fin;
    });
    var desde = lunes(min);
    return { desde: desde, semanas: Math.max(8, Math.ceil((max - desde) / (7 * DIA)) + 1) };
  }

  function gantt(ctx, opts) {
    opts = opts || {};
    var plan = PY.planPorId(ctx);
    var hoy = new Date();
    var desde = opts.desde || lunes(new Date(hoy.getTime() - 14 * DIA));
    var semanas = opts.semanas || 12;
    var hasta = new Date(desde.getTime() + semanas * 7 * DIA);
    var rango = hasta - desde;
    function pos(t) { return Math.max(0, Math.min(100, (t - desde) / rango * 100)); }

    var tareas = (opts.tareas || ctx.tareas).filter(function (a) { return a.fecha_compromiso && a.estado !== 'CANCELADA'; });
    var filas = tareas.map(function (a) {
      var p = plan[a.actividad_id] || {};
      var t = tramo(a, p);
      return t ? { a: a, p: p, ini: t.ini, fin: t.fin } : null;
    }).filter(function (f) { return f && f.fin >= desde && f.ini <= hasta; });

    var hitos = ((ctx.detalle && ctx.detalle.hitos) || []);
    var hitosEnRango = hitos.filter(function (h) { return h.fecha_objetivo && new Date(h.fecha_objetivo) >= desde && new Date(h.fecha_objetivo) <= hasta; });

    function tonoHito(h) {
      if (h.estado === 'COMPLETADO') return 'ok';
      if (h.estado === 'CANCELADO') return 'neutro';
      return (h.fecha_objetivo && new Date(h.fecha_objetivo) < hoy) ? 'critico' : 'hito';
    }
    function marcaHito(h) {
      return '<span class="sx2-py-gantt__hito sx2-tono-' + tonoHito(h) + '" style="left:' + pos(new Date(h.fecha_objetivo).getTime()).toFixed(2) + '%"' +
        ' title="' + U.esc(h.nombre + ' · ' + PY.fecha(h.fecha_objetivo, true)) + '"></span>';
    }
    function filaTarea(f, i) {
      var tono = PY.tonoTarea(f.a);
      var izq = pos(f.ini), der = pos(f.fin.getTime() + DIA);
      var avance = (f.p.avance_real_pct !== undefined && f.p.avance_real_pct !== null) ? f.p.avance_real_pct : (f.a.estado === 'TERMINADA' ? 100 : 0);
      var resp = PY.persona(f.a.responsable_email, f.a.responsable_nombre);
      return '<div class="sx2-py-gantt__fila sx2-entra" style="--i:' + Math.min(i, 14) + '" data-py2-tarea="' + U.esc(f.a.actividad_id) + '" tabindex="0">' +
        '<span class="sx2-py-gantt__nombre">' + U.avatar(resp, 'xs') + '<span class="sx2-cortar" title="' + U.esc(f.a.titulo) + '">' + U.esc(f.a.titulo) + '</span>' +
          (f.a.es_critica ? '<span class="sx2-py-gantt__critica" title="Ruta crítica">' + U.ico('rayo', 11) + '</span>' : '') + '</span>' +
        '<span class="sx2-py-gantt__pista">' +
          '<span class="sx2-py-gantt__barra sx2-tono-' + tono + '" style="left:' + izq.toFixed(2) + '%;width:' + Math.max(1, der - izq).toFixed(2) + '%"' +
            ' title="' + U.esc(f.a.titulo + ' · ' + PY.fecha(f.ini) + ' → ' + PY.fecha(f.fin) + ' · ' + (f.a.semaforo_etiqueta || '') + ' · ' + Math.round(avance) + '%') + '">' +
            '<span class="sx2-py-gantt__relleno" style="width:' + Math.max(0, Math.min(100, avance)) + '%"></span>' +
          '</span>' +
        '</span>' +
      '</div>';
    }

    var cuerpo = '', total = 0, limite = opts.limite || Infinity, i = 0;
    var ordenar = function (x, y) {
      var tx = PY.esTerminal(x.a) ? 1 : 0, ty = PY.esTerminal(y.a) ? 1 : 0;
      return (opts.agrupar ? 0 : (tx - ty)) || (x.ini - y.ini) || (x.fin - y.fin);
    };

    if (opts.agrupar) {
      var grupos = hitos.slice().sort(function (a, b) { return new Date(a.fecha_objetivo || '9999-12-31') - new Date(b.fecha_objetivo || '9999-12-31'); })
        .map(function (h) { return { h: h, filas: filas.filter(function (f) { return f.a.hito_id === h.hito_id; }).sort(ordenar) }; });
      var idsHitos = {};
      hitos.forEach(function (h) { idsHitos[h.hito_id] = true; });
      var sueltas = filas.filter(function (f) { return !f.a.hito_id || !idsHitos[f.a.hito_id]; }).sort(ordenar);
      if (sueltas.length) grupos.push({ h: null, filas: sueltas });
      grupos.forEach(function (g) {
        if (!g.filas.length && !(g.h && g.h.fecha_objetivo && new Date(g.h.fecha_objetivo) >= desde && new Date(g.h.fecha_objetivo) <= hasta)) return;
        var cerrado = !!(PY.gruposCerrados && PY.gruposCerrados[g.h ? g.h.hito_id : '_'] );
        cuerpo += '<div class="sx2-py-gantt__fila sx2-py-gantt__fila--grupo" data-py2-grupo="' + U.esc(g.h ? g.h.hito_id : '_') + '">' +
          '<span class="sx2-py-gantt__nombre"><button type="button" class="sx2-py-gantt__plegar" aria-expanded="' + (cerrado ? 'false' : 'true') + '" aria-label="Mostrar u ocultar tareas">' + U.ico(cerrado ? 'derecha' : 'abajo', 14) + '</button>' +
            (g.h ? U.ico('bandera', 13) : '') + '<span class="sx2-cortar">' + U.esc(g.h ? g.h.nombre : 'Sin hito') + '</span>' +
            '<span class="sx2-py-gantt__n">' + g.filas.length + '</span></span>' +
          '<span class="sx2-py-gantt__pista">' + (g.h && g.h.fecha_objetivo && new Date(g.h.fecha_objetivo) >= desde && new Date(g.h.fecha_objetivo) <= hasta ? marcaHito(g.h) : '') + '</span>' +
        '</div>';
        if (!cerrado) g.filas.forEach(function (f) { if (total < limite) { cuerpo += filaTarea(f, i++); total++; } });
      });
    } else {
      if (hitosEnRango.length) {
        cuerpo += '<div class="sx2-py-gantt__fila sx2-py-gantt__fila--hitos"><span class="sx2-py-gantt__nombre sx2-tenue">' + U.ico('bandera', 14) + 'Hitos</span>' +
          '<span class="sx2-py-gantt__pista">' + hitosEnRango.map(marcaHito).join('') + '</span></div>';
      }
      filas.sort(ordenar).forEach(function (f) { if (total < limite) { cuerpo += filaTarea(f, i++); total++; } });
    }

    if (!filas.length && !hitosEnRango.length) {
      return U.vacio({ icono: 'gantt', titulo: 'Nada planificado en este período', texto: 'Las tareas con fecha comprometida aparecen aquí.' });
    }

    var cab = '';
    for (var s = 0; s < semanas; s++) {
      var d = new Date(desde.getTime() + s * 7 * DIA);
      var esMes = s === 0 || d.getUTCDate() <= 7;
      cab += '<span class="sx2-py-gantt__sem' + (esMes ? ' sx2-py-gantt__sem--mes' : '') + '">' + (esMes ? '<b>' + MESES[d.getUTCMonth()] + '</b> ' : '') + d.getUTCDate() + '</span>';
    }
    var ancho = opts.pxSemana ? ' style="--sx-semanas:' + semanas + ';min-width:calc(var(--sx-gantt-et) + ' + (semanas * opts.pxSemana) + 'px)"' : ' style="--sx-semanas:' + semanas + '"';
    var hoyPct = pos(hoy.getTime());
    var mostrarHoy = opts.marcarHoy !== false && hoy >= desde && hoy <= hasta;

    return '<div class="sx2-py-gantt-scroll' + (opts.pxSemana ? ' sx2-py-gantt-scroll--zoom' : '') + '">' +
      '<div class="sx2-py-gantt"' + ancho + '>' +
        '<div class="sx2-py-gantt__fila sx2-py-gantt__fila--cab"><span class="sx2-py-gantt__nombre"></span><span class="sx2-py-gantt__semanas">' + cab + '</span></div>' +
        cuerpo +
        (mostrarHoy ? '<span class="sx2-py-gantt__hoy" style="--hoy:' + hoyPct.toFixed(2) + '"><span>HOY</span></span>' : '') +
      '</div>' +
    '</div>' +
    (filas.length > total && !opts.agrupar ? '<p class="sx2-tenue" style="margin:12px 0 0;font-size:.8125rem">+ ' + (filas.length - total) + ' tareas más en este período.</p>' : '');
  }

  // Lleva el scroll horizontal a "hoy" (Gantt con zoom).
  function centrarEnHoy(raiz) {
    var sc = raiz.querySelector('.sx2-py-gantt-scroll--zoom');
    var hoy = sc && sc.querySelector('.sx2-py-gantt__hoy');
    if (!sc || !hoy) return;
    sc.scrollLeft = Math.max(0, hoy.offsetLeft - sc.clientWidth * 0.35);
  }

  PY.gruposCerrados = PY.gruposCerrados || {};
  PY.gantt = gantt;
  PY.ganttRangoProyecto = rangoProyecto;
  PY.ganttCentrarEnHoy = centrarEnHoy;
  PY.lunes = lunes;
})();
