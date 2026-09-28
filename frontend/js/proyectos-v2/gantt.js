/**
 * proyectos-v2/gantt.js — Carta Gantt de Proyectos v2, UN solo renderizador para
 * el adelanto del Resumen y el Gantt completo de Trabajo.
 *
 * Rediseño 2026-09-28 (proyectos grandes, ej. ISO 9001: 100+ tareas, 9 meses):
 *  - Cabecera de dos pisos (meses con año · semanas o días) que queda FIJA arriba
 *    al bajar, dentro de un área con scroll propio; la columna de nombres queda fija
 *    a la izquierda.
 *  - Cada hito muestra una barra resumen (de su primera a su última tarea) con su
 *    avance, además del rombo de la fecha objetivo. Los hitos van en el orden del plan.
 *  - Barra de plan con avance + línea de lo REAL (verde a tiempo, roja con atraso,
 *    azul en curso) y el nombre de la tarea al lado de la barra.
 *  - Flechas de dependencias (SVG) que se resaltan al pasar el mouse.
 *  - Ficha emergente con plan, real, desfase y avance; arrastrar para desplazarse.
 *  - Líneas de inicio de mes, sombreado de fin de semana en la vista por días y
 *    la marca de "Hoy" en la cabecera (ya no tapa las fechas).
 *
 * Posiciones en % dentro de la pista. Dos modos:
 *  - compacto (sin pxSemana): la pista ocupa el ancho disponible (Resumen).
 *  - con zoom (pxSemana): la grilla mide semanas × pxSemana, scroll propio.
 *
 * opts: { tareas, desde (Date), semanas, pxSemana, agrupar (por hito), limite,
 *         marcarHoy (true), densidad ('comoda'|'compacta'), dependencias (bool),
 *         completa (área con scroll y cabecera fija), quieto (sin animación) }
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var DIA = 86400000;
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  function lunes(d) {
    var x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    return new Date(x.getTime() - ((x.getUTCDay() + 6) % 7) * DIA);
  }
  function dia(v) {
    if (!v) return null;
    var t = Date.parse(String(v).slice(0, 10));
    return isNaN(t) ? null : new Date(t);
  }

  // Tramo de PLAN de una tarea: inicio de plan propio → término de plan.
  function tramo(a, p) {
    var fin = dia((p && p.plan_fin) || a.fecha_compromiso || a.fecha_propuesta);
    if (!fin) return null;
    var ini = dia(a.fecha_inicio_plan) || dia(p && p.plan_inicio) || dia(a.fecha_creacion) || new Date(fin.getTime() - 7 * DIA);
    if (ini > fin) ini = fin;
    return { ini: ini, fin: fin };
  }
  // Tramo REAL: inicio real → término real (o hoy si sigue abierta).
  function tramoReal(a, p, hoy) {
    var ini = dia(a.fecha_inicio_real || (p && p.fecha_inicio_real));
    var fin = dia((p && p.fecha_fin_real) || a.fecha_terminada);
    if (!ini && !fin) return null;
    if (!ini) ini = fin;
    var abierta = !fin;
    if (!fin) fin = hoy;
    if (fin < ini) fin = ini;
    return { ini: ini, fin: fin, abierta: abierta };
  }

  // Rango que cubre todo el proyecto (Gantt completo), con una semana de aire.
  function rangoProyecto(ctx) {
    var plan = PY.planPorId(ctx);
    var hoy = dia(PY.hoyClave());
    var min = new Date(hoy.getTime() - 7 * DIA), max = new Date(hoy.getTime() + 14 * DIA);
    var p = ctx.proyecto || {};
    var pi = dia(p.fecha_inicio), po = dia(p.fecha_objetivo);
    if (pi && pi < min) min = pi;
    if (po && po > max) max = po;
    ctx.tareas.forEach(function (a) {
      var t = tramo(a, plan[a.actividad_id]);
      if (t) { if (t.ini < min) min = t.ini; if (t.fin > max) max = t.fin; }
      var r = tramoReal(a, plan[a.actividad_id] || {}, hoy);
      if (r && r.ini < min) min = r.ini;
    });
    var desde = lunes(new Date(min.getTime() - 7 * DIA));
    return { desde: desde, semanas: Math.max(8, Math.ceil((max - desde) / (7 * DIA)) + 2) };
  }

  function gantt(ctx, opts) {
    opts = opts || {};
    var plan = PY.planPorId(ctx);
    var hoy = dia(PY.hoyClave());
    var desde = opts.desde || lunes(new Date(hoy.getTime() - 14 * DIA));
    var semanas = opts.semanas || 12;
    var hasta = new Date(desde.getTime() + semanas * 7 * DIA);
    var rango = hasta - desde;
    var px = opts.pxSemana || 0;
    var anchoPista = px ? semanas * px : 0;
    function pos(t) { return Math.max(0, Math.min(100, (t - desde) / rango * 100)); }
    function pct(n) { return n.toFixed(3) + '%'; }
    var compacta = opts.densidad === 'compacta';

    var tareas = (opts.tareas || ctx.tareas).filter(function (a) { return a.estado !== 'CANCELADA'; });
    var visibles = {};
    var filas = tareas.map(function (a) {
      var p = plan[a.actividad_id] || {};
      var t = tramo(a, p);
      return t ? { a: a, p: p, ini: t.ini, fin: t.fin, real: tramoReal(a, p, hoy) } : null;
    }).filter(function (f) { return f && f.fin >= desde && f.ini <= hasta; });

    var hitos = ((ctx.detalle && ctx.detalle.hitos) || []);
    var hitosEnRango = hitos.filter(function (h) { var d = dia(h.fecha_objetivo); return d && d >= desde && d <= hasta; });

    function tonoHito(h) {
      if (h.estado === 'COMPLETADO') return 'ok';
      if (h.estado === 'CANCELADO') return 'neutro';
      return (dia(h.fecha_objetivo) && dia(h.fecha_objetivo) < hoy) ? 'critico' : 'hito';
    }
    function marcaHito(h) {
      return '<span class="sx2-py-gantt__hito sx2-tono-' + tonoHito(h) + '" style="left:' + pct(pos(dia(h.fecha_objetivo).getTime())) + '"' +
        ' title="' + U.esc('Hito: ' + h.nombre + ' · objetivo ' + PY.fecha(h.fecha_objetivo, true)) + '"></span>';
    }
    function avanceDe(f) {
      if (f.p.avance_real_pct !== undefined && f.p.avance_real_pct !== null) return Number(f.p.avance_real_pct);
      return f.a.estado === 'TERMINADA' ? 100 : (Number(f.a.avance_pct) || 0);
    }

    // Línea de lo real: verde a tiempo, roja con atraso, azul si sigue en curso.
    function barraReal(f) {
      var r = f.real;
      if (!r) return '';
      var l = pos(r.ini.getTime()), d = pos(r.fin.getTime() + DIA);
      var tarde = r.abierta ? hoy > f.fin : r.fin > f.fin;
      var clase = tarde ? ' sx2-py-gantt__real--tarde' : (r.abierta ? ' sx2-py-gantt__real--curso' : ' sx2-py-gantt__real--ok');
      return '<span class="sx2-py-gantt__real' + clase + '" style="left:' + pct(l) + ';width:calc(' + pct(Math.max(0, d - l)) + ' + 2px)"></span>';
    }

    function filaTarea(f, i) {
      var tono = PY.tonoTarea(f.a);
      var izq = pos(f.ini.getTime()), der = pos(f.fin.getTime() + DIA);
      var avance = avanceDe(f);
      var resp = PY.persona(f.a.responsable_email, f.a.responsable_nombre);
      visibles[f.a.actividad_id] = true;
      var anchoPx = px ? (der - izq) / 100 * anchoPista : null;
      // Nombre junto a la barra (a la derecha): así se lee aunque la columna lo corte.
      // Si no cabe antes del borde, va a la izquierda de la barra (no ensancha la grilla).
      var etiqueta = '';
      if (!px || anchoPista > 500) {
        var anchoTotal = px ? anchoPista : (opts.anchoEstimado || 800);
        var largoEt = Math.min(260, f.a.titulo.length * 5.6) + 12;
        var cabeDer = (100 - der) / 100 * anchoTotal >= largoEt;
        var cabeIzq = izq / 100 * anchoTotal >= largoEt;
        etiqueta = (cabeDer || !cabeIzq)
          ? '<span class="sx2-py-gantt__et" style="left:calc(' + pct(der) + ' + 8px)">' + U.esc(f.a.titulo) + '</span>'
          : '<span class="sx2-py-gantt__et sx2-py-gantt__et--izq" style="right:calc(' + pct(100 - izq) + ' + 8px)">' + U.esc(f.a.titulo) + '</span>';
      }
      return '<div class="sx2-py-gantt__fila' + (PY.esTerminal(f.a) ? ' sx2-py-gantt__fila--cerrada' : '') + '" style="--i:' + Math.min(i, 14) + '" data-py2-tarea="' + U.esc(f.a.actividad_id) + '"' +
          (f.a.depende_de ? ' data-dep="' + U.esc(f.a.depende_de) + '"' : '') + ' tabindex="0">' +
        '<span class="sx2-py-gantt__nombre">' + U.avatar(resp, 'xs') + '<span class="sx2-cortar" title="' + U.esc(f.a.titulo) + '">' + U.esc(f.a.titulo) + '</span>' +
          (f.a.es_critica ? '<span class="sx2-py-gantt__critica" title="Ruta crítica">' + U.ico('rayo', 11) + '</span>' : '') + '</span>' +
        '<span class="sx2-py-gantt__pista">' +
          '<span class="sx2-py-gantt__barra sx2-tono-' + tono + (anchoPx !== null && anchoPx < 10 ? ' sx2-py-gantt__barra--punto' : '') + '" style="left:' + pct(izq) + ';width:' + pct(Math.max(0.2, der - izq)) + '">' +
            '<span class="sx2-py-gantt__relleno" style="width:' + Math.max(0, Math.min(100, avance)) + '%"></span>' +
          '</span>' +
          barraReal(f) + etiqueta +
        '</span>' +
      '</div>';
    }

    // Barra resumen del hito: de la primera a la última tarea, con su avance ponderado.
    function resumenHito(h, filasGrupo) {
      if (!filasGrupo.length) return '';
      var ini = Math.min.apply(null, filasGrupo.map(function (f) { return f.ini.getTime(); }));
      var fin = Math.max.apply(null, filasGrupo.map(function (f) { return f.fin.getTime(); }));
      var peso = { S: 1, M: 2, L: 3, XL: 5 }, tot = 0, hecho = 0;
      filasGrupo.forEach(function (f) { var w = peso[f.a.tamano] || 2; tot += w; hecho += w * avanceDe(f) / 100; });
      var av = tot ? Math.round(hecho / tot * 100) : 0;
      var l = pos(ini), d = pos(fin + DIA);
      return '<span class="sx2-py-gantt__resumen" style="left:' + pct(l) + ';width:' + pct(Math.max(0.3, d - l)) + '" title="' + U.esc((h ? h.nombre : 'Sin hito') + ' · ' + av + '% · ' + PY.fecha(new Date(ini).toISOString()) + ' → ' + PY.fecha(new Date(fin).toISOString())) + '">' +
        '<span class="sx2-py-gantt__resumen-av" style="width:' + av + '%"></span></span>';
    }

    var cuerpo = '', total = 0, limite = opts.limite || Infinity, i = 0;
    var ordenar = function (x, y) {
      var tx = PY.esTerminal(x.a) ? 1 : 0, ty = PY.esTerminal(y.a) ? 1 : 0;
      return (opts.agrupar ? 0 : (tx - ty)) || (x.ini - y.ini) || (x.fin - y.fin);
    };

    if (opts.agrupar) {
      // Los hitos en el orden del plan (no por fecha objetivo).
      var grupos = hitos.slice().sort(function (a, b) {
        return ((Number(a.orden) || 0) - (Number(b.orden) || 0)) || (new Date(a.fecha_objetivo || '9999-12-31') - new Date(b.fecha_objetivo || '9999-12-31'));
      }).map(function (h) { return { h: h, filas: filas.filter(function (f) { return f.a.hito_id === h.hito_id; }).sort(ordenar) }; });
      var idsHitos = {};
      hitos.forEach(function (h) { idsHitos[h.hito_id] = true; });
      var sueltas = filas.filter(function (f) { return !f.a.hito_id || !idsHitos[f.a.hito_id]; }).sort(ordenar);
      if (sueltas.length) grupos.push({ h: null, filas: sueltas });
      grupos.forEach(function (g) {
        var enRango = g.h && dia(g.h.fecha_objetivo) && dia(g.h.fecha_objetivo) >= desde && dia(g.h.fecha_objetivo) <= hasta;
        if (!g.filas.length && !enRango) return;
        var clave = g.h ? g.h.hito_id : '_';
        var cerrado = !!(PY.gruposCerrados && PY.gruposCerrados[clave]);
        var hechas = g.filas.filter(function (f) { return f.a.estado === 'TERMINADA'; }).length;
        cuerpo += '<div class="sx2-py-gantt__fila sx2-py-gantt__fila--grupo" data-py2-grupo="' + U.esc(clave) + '">' +
          '<span class="sx2-py-gantt__nombre"><button type="button" class="sx2-py-gantt__plegar" aria-expanded="' + (cerrado ? 'false' : 'true') + '" aria-label="' + (cerrado ? 'Mostrar' : 'Ocultar') + ' tareas del hito">' + U.ico(cerrado ? 'derecha' : 'abajo', 14) + '</button>' +
            (g.h ? U.ico('bandera', 13) : '') + '<span class="sx2-cortar" title="' + U.esc(g.h ? g.h.nombre : 'Sin hito') + '">' + U.esc(g.h ? g.h.nombre : 'Sin hito') + '</span>' +
            '<span class="sx2-py-gantt__n" title="Tareas terminadas / total">' + hechas + '/' + g.filas.length + '</span></span>' +
          '<span class="sx2-py-gantt__pista">' + resumenHito(g.h, g.filas) + (enRango ? marcaHito(g.h) : '') + '</span>' +
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

    // --- Cabecera: meses (con año) arriba · semanas o días abajo -----------------------
    var pxEst = px || ((opts.anchoEstimado || 800) / semanas);
    var mostrarSemanas = pxEst >= 22;
    var porDias = px >= 100;
    var meses = '', lineas = '';
    var m = new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), 1));
    var primero = true;
    while (m < hasta) {
      var sig = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
      var l = pos(Math.max(m.getTime(), desde.getTime())), r = pos(Math.min(sig.getTime(), hasta.getTime()));
      var anchoMesPx = (r - l) / 100 * (px ? anchoPista : (opts.anchoEstimado || 800));
      var nombre = anchoMesPx < 46 ? MESES[m.getUTCMonth()] : MESES_LARGOS[m.getUTCMonth()];
      var conAnio = primero || m.getUTCMonth() === 0;
      meses += '<span class="sx2-py-gantt__mes" style="left:' + pct(l) + ';width:' + pct(r - l) + '">' + nombre + (conAnio && anchoMesPx >= 60 ? ' <b>' + m.getUTCFullYear() + '</b>' : '') + '</span>';
      if (m > desde) lineas += '<span class="sx2-py-gantt__linea-mes" style="left:calc(var(--sx-gantt-et) + (100% - var(--sx-gantt-et)) * ' + pos(m.getTime()).toFixed(3) + ' / 100)"></span>';
      primero = false;
      m = sig;
    }
    var cab = '';
    if (mostrarSemanas) {
      for (var s = 0; s < semanas; s++) {
        var d = new Date(desde.getTime() + s * 7 * DIA);
        if (porDias) {
          cab += '<span class="sx2-py-gantt__sem sx2-py-gantt__sem--dias">' + DIAS.map(function (x, k) {
            var dd = new Date(d.getTime() + k * DIA);
            var esHoy = dd.getTime() === hoy.getTime();
            return '<i' + (k >= 5 ? ' class="sx2-py-gantt__finde"' : '') + (esHoy ? ' data-hoy' : '') + '>' + x + '<br>' + dd.getUTCDate() + '</i>';
          }).join('') + '</span>';
        } else {
          cab += '<span class="sx2-py-gantt__sem" title="Semana del ' + d.getUTCDate() + ' de ' + MESES_LARGOS[d.getUTCMonth()] + '">' + d.getUTCDate() + '</span>';
        }
      }
    }
    var mostrarHoy = opts.marcarHoy !== false && hoy >= desde && hoy <= hasta;
    var hoyPct = pos(hoy.getTime() + DIA / 2);
    var estilo = '--sx-semanas:' + semanas + (px ? ';min-width:calc(var(--sx-gantt-et) + ' + anchoPista + 'px)' : '');
    var clases = 'sx2-py-gantt' + (compacta ? ' sx2-py-gantt--compacta' : '') + (porDias ? ' sx2-py-gantt--dias' : '') +
      (!mostrarSemanas ? ' sx2-py-gantt--sin-semanas' : '') + (opts.quieto ? ' sx2-py-gantt--quieto' : '');

    return '<div class="sx2-py-gantt-scroll' + (px ? ' sx2-py-gantt-scroll--zoom' : '') + (opts.completa ? ' sx2-py-gantt-scroll--completa' : '') + '">' +
      '<div class="' + clases + '" style="' + estilo + '"' + (opts.completa ? ' data-completa' : '') + (opts.dependencias ? ' data-deps' : '') + '>' +
        '<div class="sx2-py-gantt__fila sx2-py-gantt__fila--cab">' +
          '<span class="sx2-py-gantt__nombre sx2-py-gantt__nombre--cab">' + (opts.agrupar ? 'Hito / tarea' : 'Tarea') + '</span>' +
          '<span class="sx2-py-gantt__tiempo">' +
            '<span class="sx2-py-gantt__meses">' + meses + (mostrarHoy ? '<span class="sx2-py-gantt__hoy-et" style="left:' + pct(hoyPct) + '">Hoy</span>' : '') + '</span>' +
            (mostrarSemanas ? '<span class="sx2-py-gantt__semanas">' + cab + '</span>' : '') +
          '</span>' +
        '</div>' +
        cuerpo +
        '<div class="sx2-py-gantt__lineas" aria-hidden="true">' + lineas +
          (mostrarHoy ? '<span class="sx2-py-gantt__hoy" style="left:calc(var(--sx-gantt-et) + (100% - var(--sx-gantt-et)) * ' + hoyPct.toFixed(3) + ' / 100)"></span>' : '') +
        '</div>' +
      '</div>' +
    '</div>' +
    (filas.length > total && !opts.agrupar ? '<p class="sx2-tenue" style="margin:12px 0 0;font-size:.8125rem">+ ' + (filas.length - total) + ' tareas más en este período.</p>' : '');
  }

  // --- Después de pintar: dependencias, ficha emergente, arrastre --------------------
  function dibujarDependencias(g) {
    var viejo = g.querySelector('.sx2-py-gantt__deps');
    if (viejo) viejo.remove();
    if (!g.hasAttribute('data-deps')) return;
    var base = g.getBoundingClientRect();
    var barras = {};
    g.querySelectorAll('.sx2-py-gantt__fila[data-py2-tarea]').forEach(function (fila) {
      var b = fila.querySelector('.sx2-py-gantt__barra');
      if (b) barras[fila.getAttribute('data-py2-tarea')] = b.getBoundingClientRect();
    });
    var paths = '';
    g.querySelectorAll('.sx2-py-gantt__fila[data-dep]').forEach(function (fila) {
      var de = fila.getAttribute('data-dep'), a = fila.getAttribute('data-py2-tarea');
      var r1 = barras[de], r2 = barras[a];
      if (!r1 || !r2) return;
      var x1 = r1.right - base.left, y1 = r1.top + r1.height / 2 - base.top;
      var x2 = r2.left - base.left, y2 = r2.top + r2.height / 2 - base.top;
      var d;
      if (x2 - x1 >= 14) d = 'M' + x1 + ' ' + y1 + ' H' + (x1 + 7) + ' V' + y2 + ' H' + (x2 - 1);
      else {
        var yMedio = y2 + (y2 > y1 ? -1 : 1) * (r2.height / 2 + 5);
        d = 'M' + x1 + ' ' + y1 + ' H' + (x1 + 7) + ' V' + yMedio + ' H' + (x2 - 9) + ' V' + y2 + ' H' + (x2 - 1);
      }
      paths += '<path d="' + d + '" data-de="' + U.esc(de) + '" data-a="' + U.esc(a) + '" marker-end="url(#py2-flecha)"/>';
    });
    if (!paths) return;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'sx2-py-gantt__deps');
    svg.setAttribute('width', g.scrollWidth);
    svg.setAttribute('height', g.offsetHeight);
    svg.innerHTML = '<defs><marker id="py2-flecha" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 z"/></marker></defs>' + paths;
    g.appendChild(svg);
  }

  var tip_ = null;
  function ficha(ctx, id) {
    var a = ctx.tareas.filter(function (x) { return x.actividad_id === id; })[0];
    if (!a) return '';
    var p = PY.planPorId(ctx)[id] || {};
    var t = tramo(a, p), r = tramoReal(a, p, dia(PY.hoyClave()));
    var desfase = '';
    if (t && r && !r.abierta) {
      var dd = Math.round((r.fin - t.fin) / DIA);
      desfase = dd === 0 ? 'en fecha' : (dd > 0 ? '+' + dd + ' d de atraso' : (-dd) + ' d antes');
    }
    var f = function (d) { return d ? PY.fecha(d.toISOString(), true) : '—'; };
    var avance = p.avance_real_pct !== undefined && p.avance_real_pct !== null ? Math.round(p.avance_real_pct) : (a.estado === 'TERMINADA' ? 100 : Math.round(Number(a.avance_pct) || 0));
    return '<strong>' + U.esc(a.titulo) + '</strong>' +
      '<span class="sx2-py-gantt-tip__fila">' + U.badge(a.semaforo_etiqueta || a.estado, PY.tonoTarea(a)) + '<span>' + U.esc(PY.persona(a.responsable_email, a.responsable_nombre).nombre) + '</span></span>' +
      '<dl><dt>Plan</dt><dd>' + (t ? f(t.ini) + ' → ' + f(t.fin) : '—') + '</dd>' +
      '<dt>Real</dt><dd>' + (r ? f(r.ini) + ' → ' + (r.abierta ? 'en curso' : f(r.fin)) : 'sin iniciar') + '</dd>' +
      (desfase ? '<dt>Desfase</dt><dd>' + desfase + '</dd>' : '') +
      '<dt>Avance</dt><dd>' + avance + '%</dd></dl>';
  }
  function montar(raiz) {
    if (tip_) tip_.hidden = true;
    var g = raiz && raiz.querySelector('.sx2-py-gantt[data-completa]');
    if (!g) return;
    dibujarDependencias(g);
    var sc = g.closest('.sx2-py-gantt-scroll');
    if (!tip_) {
      tip_ = document.createElement('div');
      tip_.className = 'sx2-py-gantt-tip';
      tip_.setAttribute('role', 'tooltip');
      tip_.hidden = true;
      document.body.appendChild(tip_);
    }
    var sobre = null;
    function ocultar() { tip_.hidden = true; sobre = null; g.querySelectorAll('.sx2-py-gantt__deps path.activa').forEach(function (p) { p.classList.remove('activa'); }); }
    g.addEventListener('mousemove', function (ev) {
      if (arrastre_) return;
      var fila = ev.target.closest('.sx2-py-gantt__fila[data-py2-tarea]');
      var enBarra = ev.target.closest('.sx2-py-gantt__barra, .sx2-py-gantt__real, .sx2-py-gantt__et');
      if (!fila || !enBarra) { if (sobre) ocultar(); return; }
      var id = fila.getAttribute('data-py2-tarea');
      if (sobre !== id) {
        sobre = id;
        tip_.innerHTML = ficha(PY.ctx(), id);
        tip_.hidden = false;
        g.querySelectorAll('.sx2-py-gantt__deps path').forEach(function (p) {
          p.classList.toggle('activa', p.getAttribute('data-de') === id || p.getAttribute('data-a') === id);
        });
      }
      var x = ev.clientX + 14, y = ev.clientY + 16;
      var w = tip_.offsetWidth, h = tip_.offsetHeight;
      if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
      if (y + h > window.innerHeight - 8) y = ev.clientY - h - 12;
      tip_.style.left = x + 'px';
      tip_.style.top = y + 'px';
    });
    g.addEventListener('mouseleave', ocultar);
    sc.addEventListener('scroll', function () { if (sobre) ocultar(); }, { passive: true });

    // Arrastrar el fondo para desplazarse (sin robar el clic de una barra).
    sc.addEventListener('mousedown', function (ev) {
      if (ev.button !== 0 || ev.target.closest('button, a, input, .sx2-py-gantt__nombre, .sx2-py-gantt__barra')) return;
      arrastre_ = { sc: sc, movio: false, x0: ev.clientX, y0: ev.clientY, sl: sc.scrollLeft, st: sc.scrollTop };
      sc.classList.add('sx2-py-gantt-scroll--arrastre');
      if (sobre) ocultar();
    });
    sc.addEventListener('click', function (ev) {
      if (sc.__movio) { ev.stopPropagation(); ev.preventDefault(); sc.__movio = false; }
    }, true);
  }
  // Un solo par de escuchas globales para el arrastre (no se acumulan al repintar).
  var arrastre_ = null;
  window.addEventListener('mousemove', function (ev) {
    if (!arrastre_) return;
    var dx = ev.clientX - arrastre_.x0, dy = ev.clientY - arrastre_.y0;
    if (Math.abs(dx) + Math.abs(dy) > 4) arrastre_.movio = true;
    arrastre_.sc.scrollLeft = arrastre_.sl - dx;
    arrastre_.sc.scrollTop = arrastre_.st - dy;
  });
  window.addEventListener('mouseup', function () {
    if (!arrastre_) return;
    arrastre_.sc.classList.remove('sx2-py-gantt-scroll--arrastre');
    arrastre_.sc.__movio = arrastre_.movio;
    arrastre_ = null;
  });

  // Lleva el scroll horizontal a "hoy" (Gantt con zoom).
  function centrarEnHoy(raiz) {
    var sc = raiz.querySelector('.sx2-py-gantt-scroll--zoom');
    var hoy = sc && sc.querySelector('.sx2-py-gantt__hoy');
    if (!sc || !hoy) return;
    sc.scrollLeft = Math.max(0, hoy.offsetLeft - sc.clientWidth * 0.45);
  }
  // Lleva el scroll al inicio del proyecto (lo primero planificado).
  function irAlInicio(raiz) {
    var sc = raiz.querySelector('.sx2-py-gantt-scroll--zoom');
    if (sc) sc.scrollLeft = 0;
  }

  window.addEventListener('resize', function () {
    var g = document.querySelector('.sx2-py-gantt[data-completa]');
    if (g) dibujarDependencias(g);
  });

  PY.gruposCerrados = PY.gruposCerrados || {};
  PY.gantt = gantt;
  PY.ganttRangoProyecto = rangoProyecto;
  PY.ganttCentrarEnHoy = centrarEnHoy;
  PY.ganttIrAlInicio = irAlInicio;
  PY.ganttMontar = montar;
  PY.lunes = lunes;
})();
