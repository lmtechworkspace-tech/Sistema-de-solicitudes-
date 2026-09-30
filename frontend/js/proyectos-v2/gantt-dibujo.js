/**
 * proyectos-v2/gantt-dibujo.js — el DIBUJO de la Carta Gantt, sin navegador.
 *
 * Auditoría 2026-09-29 (etapa 2, "una sola Carta Gantt"): antes la pantalla, el
 * PDF y el Excel tenían tres Gantt distintos (colores, inicio de las barras,
 * lo real, el avance). Este archivo es la ÚNICA forma de dibujarla en HTML:
 *  - En la plataforma lo usa gantt.js (que agrega lo interactivo: flechas de
 *    dependencias, ficha emergente y arrastre).
 *  - En el servidor lo corre documentoV2.js dentro de un `vm` para el PDF
 *    (igual que ui-v2.js y reportes-v2.js), así el papel sale idéntico.
 * Por eso aquí no se toca el DOM ni `window.addEventListener`: solo se arma
 * texto. Lo que necesita de PYv2 (nombres, tono, "hoy") se consulta al llamar
 * y tiene un respaldo propio si no está (en el servidor no hay nucleo.js).
 *
 * Posiciones en % dentro de la pista. Dos modos:
 *  - compacto (sin pxSemana): la pista ocupa el ancho disponible.
 *  - con zoom (pxSemana): la grilla mide semanas × pxSemana, scroll propio.
 *
 * opts: { tareas, desde (Date), semanas, pxSemana, agrupar (por hito), limite,
 *         marcarHoy (true), densidad ('comoda'|'compacta'), dependencias (bool),
 *         completa (área con scroll y cabecera fija), quieto (sin animación),
 *         anchoEstimado (px de la pista si no hay pxSemana),
 *         lineaBase (dibuja la línea base congelada sobre cada barra),
 *         reprogramable (fn(tarea) → bool: agrega el asa para arrastrar el término) }
 *
 * Etapa 4 de la auditoría: las subtareas van bajo su tarea padre, con sangría.
 */
(function (global) {
  'use strict';

  var DIA = 86400000;
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  // Mismo mapa que TONO_SEMAFORO de nucleo.js (un test vigila que coincidan).
  var TONO_SEMAFORO = {
    terminada: 'ok', 'al-dia': 'info', riesgo: 'alerta', atrasada: 'critico',
    bloqueada: 'hito', pendiente: 'neutro', revision: 'primario', cancelada: 'neutro'
  };

  // --- Lo que se toma de PYv2 si está, con respaldo para el servidor --------------
  function PY() { return global.PYv2 || {}; }
  function U() { return global.UIv2; }
  function planPorId(ctx) {
    if (PY().planPorId) return PY().planPorId(ctx);
    var m = {};
    ((ctx.rendimiento && ctx.rendimiento.plan_seguimiento) || []).forEach(function (t) { m[t.actividad_id] = t; });
    return m;
  }
  function hoyClave() {
    if (PY().hoyClave) return PY().hoyClave();
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); } catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  function tonoTarea(a) { return PY().tonoTarea ? PY().tonoTarea(a) : (TONO_SEMAFORO[a && a.semaforo] || 'neutro'); }
  function esTerminal(a) { return a.estado === 'TERMINADA' || a.estado === 'CANCELADA'; }
  function persona(email, nombre) { return PY().persona ? PY().persona(email, nombre) : { email: email || '', nombre: nombre || email || 'Sin asignar' }; }
  function fecha(valor, conAnio) {
    if (PY().fecha) return PY().fecha(valor, conAnio);
    var d = new Date(valor);
    if (!valor || isNaN(d.getTime())) return '—';
    return String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') + (conAnio ? '/' + d.getUTCFullYear() : '');
  }
  function cerrados() { return PY().gruposCerrados || {}; }

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
    var plan = planPorId(ctx);
    var hoy = dia(hoyClave());
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

  // Arma las piezas: la cabecera, las filas (cada una sabe a qué hito pertenece)
  // y las líneas de fondo. html() las junta en un Gantt; paginas() las reparte.
  function piezas(ctx, opts) {
    opts = opts || {};
    var UI = U();
    var plan = planPorId(ctx);
    var hoy = dia(hoyClave());
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
        ' title="' + UI.esc('Hito: ' + h.nombre + ' · objetivo ' + fecha(h.fecha_objetivo, true)) + '"></span>';
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
      var tono = tonoTarea(f.a);
      var izq = pos(f.ini.getTime()), der = pos(f.fin.getTime() + DIA);
      var avance = avanceDe(f);
      var resp = persona(f.a.responsable_email, f.a.responsable_nombre);
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
          ? '<span class="sx2-py-gantt__et" style="left:calc(' + pct(der) + ' + 8px)">' + UI.esc(f.a.titulo) + '</span>'
          : '<span class="sx2-py-gantt__et sx2-py-gantt__et--izq" style="right:calc(' + pct(100 - izq) + ' + 8px)">' + UI.esc(f.a.titulo) + '</span>';
      }
      // Línea base congelada: una raya fina sobre la barra de plan (G4).
      var base = '';
      if (opts.lineaBase && f.p.baseline_fin) {
        var bi = dia(f.p.baseline_inicio) || dia(f.p.baseline_fin), bf = dia(f.p.baseline_fin);
        if (bi && bf && bf >= desde && bi <= hasta) {
          var bl = pos(bi.getTime()), bd = pos(bf.getTime() + DIA);
          base = '<span class="sx2-py-gantt__base" style="left:' + pct(bl) + ';width:' + pct(Math.max(0.2, bd - bl)) + '" title="' + UI.esc('Línea base: ' + fecha(f.p.baseline_inicio || f.p.baseline_fin) + ' → ' + fecha(f.p.baseline_fin)) + '"></span>';
        }
      }
      // Asa para arrastrar el término (reprogramar, con motivo) (G3).
      var asa = (!esTerminal(f.a) && typeof opts.reprogramable === 'function' && opts.reprogramable(f.a))
        ? '<span class="sx2-py-gantt__asa" data-asa title="Arrastra para reprogramar el término"></span>' : '';
      return '<div class="sx2-py-gantt__fila' + (esTerminal(f.a) ? ' sx2-py-gantt__fila--cerrada' : '') + (f.sub ? ' sx2-py-gantt__fila--sub' : '') + '" style="--i:' + Math.min(i, 14) + '" data-py2-tarea="' + UI.esc(f.a.actividad_id) + '"' +
          (f.a.depende_de ? ' data-dep="' + UI.esc(f.a.depende_de) + '"' : '') + ' tabindex="0">' +
        '<span class="sx2-py-gantt__nombre">' + UI.avatar(resp, 'xs') + '<span class="sx2-cortar" title="' + UI.esc(f.a.titulo) + '">' + UI.esc(f.a.titulo) + '</span>' +
          (f.a.es_critica ? '<span class="sx2-py-gantt__critica" title="Ruta crítica">' + UI.ico('rayo', 11) + '</span>' : '') + '</span>' +
        '<span class="sx2-py-gantt__pista">' + base +
          '<span class="sx2-py-gantt__barra sx2-tono-' + tono + (anchoPx !== null && anchoPx < 10 ? ' sx2-py-gantt__barra--punto' : '') + '" style="left:' + pct(izq) + ';width:' + pct(Math.max(0.2, der - izq)) + '">' +
            '<span class="sx2-py-gantt__relleno" style="width:' + Math.max(0, Math.min(100, avance)) + '%"></span>' + asa +
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
      return '<span class="sx2-py-gantt__resumen" style="left:' + pct(l) + ';width:' + pct(Math.max(0.3, d - l)) + '" title="' + UI.esc((h ? h.nombre : 'Sin hito') + ' · ' + av + '% · ' + fecha(new Date(ini).toISOString()) + ' → ' + fecha(new Date(fin).toISOString())) + '">' +
        '<span class="sx2-py-gantt__resumen-av" style="width:' + av + '%"></span></span>';
    }

    // Subtareas justo debajo de su tarea padre (si la padre está en el mismo bloque).
    function anidar(ordenadas) {
      var ids = {}, hijas = {}, raiz = [], out = [];
      ordenadas.forEach(function (f) { ids[f.a.actividad_id] = true; });
      ordenadas.forEach(function (f) {
        var pid = f.a.tarea_padre_id;
        if (pid && ids[pid]) (hijas[pid] = hijas[pid] || []).push(f); else raiz.push(f);
      });
      raiz.forEach(function (f) { out.push(f); (hijas[f.a.actividad_id] || []).forEach(function (h) { h.sub = true; out.push(h); }); });
      return out;
    }

    // Cada fila: { html, grupo (html de la fila del hito al que pertenece), esGrupo }.
    var lista = [], total = 0, limite = opts.limite || Infinity, i = 0;
    var ordenar = function (x, y) {
      var tx = esTerminal(x.a) ? 1 : 0, ty = esTerminal(y.a) ? 1 : 0;
      return (opts.agrupar ? 0 : (tx - ty)) || (x.ini - y.ini) || (x.fin - y.fin);
    };

    if (opts.agrupar) {
      // Los hitos en el orden del plan (no por fecha objetivo).
      var grupos = hitos.slice().sort(function (a, b) {
        return ((Number(a.orden) || 0) - (Number(b.orden) || 0)) || (new Date(a.fecha_objetivo || '9999-12-31') - new Date(b.fecha_objetivo || '9999-12-31'));
      }).map(function (h) { return { h: h, filas: anidar(filas.filter(function (f) { return f.a.hito_id === h.hito_id; }).sort(ordenar)) }; });
      var idsHitos = {};
      hitos.forEach(function (h) { idsHitos[h.hito_id] = true; });
      var sueltas = anidar(filas.filter(function (f) { return !f.a.hito_id || !idsHitos[f.a.hito_id]; }).sort(ordenar));
      if (sueltas.length) grupos.push({ h: null, filas: sueltas });
      grupos.forEach(function (g) {
        var enRango = g.h && dia(g.h.fecha_objetivo) && dia(g.h.fecha_objetivo) >= desde && dia(g.h.fecha_objetivo) <= hasta;
        if (!g.filas.length && !enRango) return;
        var clave = g.h ? g.h.hito_id : '_';
        var cerrado = !opts.sinPlegar && !!cerrados()[clave];
        var hechas = g.filas.filter(function (f) { return f.a.estado === 'TERMINADA'; }).length;
        var nombreGrupo = g.h ? g.h.nombre : 'Sin hito';
        var cabGrupo = function (cont) {
          return '<div class="sx2-py-gantt__fila sx2-py-gantt__fila--grupo" data-py2-grupo="' + UI.esc(clave) + '">' +
            '<span class="sx2-py-gantt__nombre">' + (opts.sinPlegar ? '' : '<button type="button" class="sx2-py-gantt__plegar" aria-expanded="' + (cerrado ? 'false' : 'true') + '" aria-label="' + (cerrado ? 'Mostrar' : 'Ocultar') + ' tareas del hito">' + UI.ico(cerrado ? 'derecha' : 'abajo', 14) + '</button>') +
              (g.h ? UI.ico('bandera', 13) : '') + '<span class="sx2-cortar" title="' + UI.esc(nombreGrupo) + '">' + UI.esc(nombreGrupo + (cont ? ' (continúa)' : '')) + '</span>' +
              '<span class="sx2-py-gantt__n" title="Tareas terminadas / total">' + hechas + '/' + g.filas.length + '</span></span>' +
            '<span class="sx2-py-gantt__pista">' + resumenHito(g.h, g.filas) + (enRango ? marcaHito(g.h) : '') + '</span>' +
          '</div>';
        };
        var cab = cabGrupo(false);
        lista.push({ html: cab, esGrupo: true });
        var cont = cabGrupo(true);
        if (!cerrado) g.filas.forEach(function (f) { if (total < limite) { lista.push({ html: filaTarea(f, i++), grupo: cont }); total++; } });
      });
    } else {
      if (hitosEnRango.length) {
        lista.push({ html: '<div class="sx2-py-gantt__fila sx2-py-gantt__fila--hitos"><span class="sx2-py-gantt__nombre sx2-tenue">' + UI.ico('bandera', 14) + 'Hitos</span>' +
          '<span class="sx2-py-gantt__pista">' + hitosEnRango.map(marcaHito).join('') + '</span></div>', esGrupo: true });
      }
      anidar(filas.sort(ordenar)).forEach(function (f) { if (total < limite) { lista.push({ html: filaTarea(f, i++) }); total++; } });
    }

    // --- Cabecera: meses (con año) arriba · semanas o días abajo -----------------------
    var pxEst = px || ((opts.anchoEstimado || 800) / semanas);
    var mostrarSemanas = pxEst >= 22;
    var porDias = px >= 100;
    var meses = '', lineas = '';
    var mostrarHoy = opts.marcarHoy !== false && hoy >= desde && hoy <= hasta;
    var hoyPct = pos(hoy.getTime() + DIA / 2);
    // La etiqueta "Hoy" vive en la fila de meses: si choca con el nombre de un mes,
    // ese nombre se corre a la derecha de la etiqueta (o se acorta / se oculta).
    var anchoTotal = px ? anchoPista : (opts.anchoEstimado || 800);
    var hoyPx = mostrarHoy ? hoyPct / 100 * anchoTotal : null;
    var m = new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), 1));
    var primero = true;
    while (m < hasta) {
      var sig = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
      var l = pos(Math.max(m.getTime(), desde.getTime())), r = pos(Math.min(sig.getTime(), hasta.getTime()));
      var anchoMesPx = (r - l) / 100 * anchoTotal;
      var nombre = anchoMesPx < 46 ? MESES[m.getUTCMonth()] : MESES_LARGOS[m.getUTCMonth()];
      var conAnio = (primero || m.getUTCMonth() === 0) && anchoMesPx >= 60;
      var relleno = '';
      if (hoyPx !== null) {
        var ini = l / 100 * anchoTotal;
        var largo = function (n, anio) { return n.length * 6.8 + (anio ? 34 : 0); };
        var chipI = hoyPx - 22, chipD = hoyPx + 22;
        if (chipI < ini + 6 + largo(nombre, conAnio) && chipD > ini + 6) {
          var corrido = chipD - ini;
          if (corrido + largo(nombre, conAnio) > anchoMesPx) { nombre = MESES[m.getUTCMonth()]; conAnio = false; }
          if (corrido + largo(nombre, false) <= anchoMesPx) relleno = ';padding-left:' + Math.round(corrido) + 'px';
          else if (chipI - ini - 6 >= largo(nombre, false)) relleno = '';
          else nombre = '';
        }
      }
      meses += '<span class="sx2-py-gantt__mes" style="left:' + pct(l) + ';width:' + pct(r - l) + relleno + '" title="' + MESES_LARGOS[m.getUTCMonth()] + ' ' + m.getUTCFullYear() + '">' + nombre + (conAnio && nombre ? ' <b>' + m.getUTCFullYear() + '</b>' : '') + '</span>';
      if (m > desde) lineas += '<span class="sx2-py-gantt__linea-mes" style="left:calc(var(--sx-gantt-et) + (100% - var(--sx-gantt-et)) * ' + pos(m.getTime()).toFixed(3) + ' / 100)"></span>';
      primero = false;
      m = sig;
    }
    // En papel, la grilla semanal va como líneas de 1px (el degradado repetido de
    // la pista se imprime como franjas gruesas en Chromium).
    if (opts.lineasSemana && mostrarSemanas) {
      for (var w = 1; w < semanas; w++) {
        lineas += '<span class="sx2-py-gantt__linea-sem" style="left:calc(var(--sx-gantt-et) + (100% - var(--sx-gantt-et)) * ' + (w / semanas * 100).toFixed(3) + ' / 100)"></span>';
      }
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
    var estilo = '--sx-semanas:' + semanas + (px ? ';min-width:calc(var(--sx-gantt-et) + ' + anchoPista + 'px)' : '');
    var clases = 'sx2-py-gantt' + (compacta ? ' sx2-py-gantt--compacta' : '') + (porDias ? ' sx2-py-gantt--dias' : '') +
      (!mostrarSemanas ? ' sx2-py-gantt--sin-semanas' : '') + (opts.quieto ? ' sx2-py-gantt--quieto' : '');
    var cabecera = '<div class="sx2-py-gantt__fila sx2-py-gantt__fila--cab">' +
        '<span class="sx2-py-gantt__nombre sx2-py-gantt__nombre--cab">' + (opts.agrupar ? 'Hito / tarea' : 'Tarea') + '</span>' +
        '<span class="sx2-py-gantt__tiempo">' +
          '<span class="sx2-py-gantt__meses">' + meses + (mostrarHoy ? '<span class="sx2-py-gantt__hoy-et" style="left:' + pct(hoyPct) + '">Hoy</span>' : '') + '</span>' +
          (mostrarSemanas ? '<span class="sx2-py-gantt__semanas">' + cab + '</span>' : '') +
        '</span>' +
      '</div>';
    var fondo = '<div class="sx2-py-gantt__lineas" aria-hidden="true">' + lineas +
        (mostrarHoy ? '<span class="sx2-py-gantt__hoy" style="left:calc(var(--sx-gantt-et) + (100% - var(--sx-gantt-et)) * ' + hoyPct.toFixed(3) + ' / 100)"></span>' : '') +
      '</div>';
    return {
      vacio: !filas.length && !hitosEnRango.length, filas: lista, sobran: filas.length - total,
      abrir: '<div class="' + clases + '" style="' + estilo + '" data-desde="' + desde.toISOString().slice(0, 10) + '" data-semanas="' + semanas + '"' +
        (opts.completa ? ' data-completa' : '') + (opts.dependencias ? ' data-deps' : '') + '>' + cabecera,
      cerrar: fondo + '</div>',
      px: px, completa: opts.completa, agrupar: opts.agrupar
    };
  }

  function vacio() {
    return U().vacio({ icono: 'gantt', titulo: 'Nada planificado en este período', texto: 'Las tareas con fecha comprometida aparecen aquí.' });
  }

  // La Carta Gantt entera (pantalla).
  function html(ctx, opts) {
    var P = piezas(ctx, opts);
    if (P.vacio) return vacio();
    return '<div class="sx2-py-gantt-scroll' + (P.px ? ' sx2-py-gantt-scroll--zoom' : '') + (P.completa ? ' sx2-py-gantt-scroll--completa' : '') + '">' +
      P.abrir + P.filas.map(function (f) { return f.html; }).join('') + P.cerrar +
    '</div>' +
    (P.sobran > 0 && !P.agrupar ? '<p class="sx2-tenue" style="margin:12px 0 0;font-size:.8125rem">+ ' + P.sobran + ' tareas más en este período.</p>' : '');
  }

  // La misma Carta Gantt repartida en bloques de `porPagina` filas, cada uno con
  // su cabecera de meses/semanas (para el PDF: el papel no repite encabezados de
  // un <div>). Un bloque que empieza a mitad de un hito repite el hito
  // "(continúa)". Devuelve un arreglo de HTML (vacío si no hay nada que dibujar).
  // `primera` (opcional): filas de la primera página, que comparte espacio con la
  // cabecera del documento.
  function paginas(ctx, opts, porPagina, primera) {
    var P = piezas(ctx, Object.assign({}, opts, { sinPlegar: true }));
    if (P.vacio) return [];
    var bloques = [], actual = [];
    var cabe = function () { return bloques.length === 0 && primera ? primera : porPagina; };
    P.filas.forEach(function (f, k) {
      // Un hito no queda solo al pie de una página: se lleva a la siguiente.
      var siguienteEsDeOtro = !P.filas[k + 1] || P.filas[k + 1].esGrupo;
      if (actual.length >= cabe() || (f.esGrupo && actual.length >= cabe() - 1 && !siguienteEsDeOtro)) { bloques.push(actual); actual = []; }
      if (!actual.length && !f.esGrupo && f.grupo) actual.push(f.grupo);
      actual.push(f.html);
    });
    if (actual.length) bloques.push(actual);
    return bloques.map(function (b) { return P.abrir + b.join('') + P.cerrar; });
  }

  // Leyenda de colores (la misma en pantalla y en el PDF).
  function leyenda(opts) {
    opts = opts || {};
    return '<div class="sx2-py-leyenda-gantt">' +
      [['info', 'En curso'], ['ok', 'Terminada'], ['alerta', 'En riesgo'], ['critico', 'Atrasada'], ['hito', 'Bloqueada'], ['neutro', 'Pendiente']].map(function (x) {
        return '<span class="sx2-tono-' + x[0] + '"><i></i>' + x[1] + '</span>';
      }).join('') +
      '<span class="sx2-py-leyenda-gantt__sep"></span>' +
      '<span><i class="sx2-py-leyenda-gantt__real sx2-py-leyenda-gantt__real--ok"></i>Real a tiempo</span>' +
      '<span><i class="sx2-py-leyenda-gantt__real sx2-py-leyenda-gantt__real--tarde"></i>Real con atraso</span>' +
      '<span><i class="sx2-py-leyenda-gantt__resumen"></i>Resumen del hito</span>' +
      (opts.lineaBase ? '<span><i class="sx2-py-leyenda-gantt__base"></i>Línea base</span>' : '') +
      '<span class="sx2-tono-hito"><i class="sx2-py-leyenda-gantt__hito"></i>Hito</span>' +
      '<span><i class="sx2-py-leyenda-gantt__hoy"></i>Hoy</span>' +
      (opts.papel ? '<span class="sx2-tenue">El relleno de cada barra es su avance.</span>' : '<span class="sx2-tenue">Arrastra para moverte · Ctrl + rueda para acercar o alejar</span>') +
    '</div>';
  }

  // Lo que el Gantt NO puede dibujar bien, dicho (auditoría C2/G1):
  // - tareas abiertas sin inicio planificado de verdad (ni propio ni por una
  //   tarea de la que dependan): su barra parte el día en que se cargaron;
  // - tareas sin fecha comprometida: no tienen barra y no aparecen.
  function aviso(ctx) {
    var plan = planPorId(ctx);
    var vivas = ctx.tareas.filter(function (a) { return a.estado !== 'CANCELADA'; });
    var sinInicio = vivas.filter(function (a) {
      var o = (plan[a.actividad_id] || {}).plan_inicio_origen;
      return !esTerminal(a) && a.fecha_compromiso && (o === 'creacion' || o === 'proyecto' || o === 'compromiso');
    }).length;
    var sinFecha = vivas.filter(function (a) { return !a.fecha_compromiso && !a.fecha_propuesta; }).length;
    if (!sinInicio && !sinFecha) return '';
    var partes = [];
    if (sinInicio) partes.push('<strong>' + sinInicio + (sinInicio === 1 ? ' tarea abierta no tiene' : ' tareas abiertas no tienen') + ' inicio planificado</strong>: su barra parte el día en que se cargó. Indica su inicio o de qué tarea depende para que el plan muestre la secuencia.');
    if (sinFecha) partes.push('<strong>' + sinFecha + (sinFecha === 1 ? ' tarea no aparece' : ' tareas no aparecen') + '</strong> porque no tienen fecha comprometida.');
    return '<p class="sx2-py-gantt-aviso" role="note">' + U().ico('info', 15) + '<span>' + partes.join(' ') + '</span></p>';
  }

  global.SigsoGantt = {
    html: html, paginas: paginas, leyenda: leyenda, aviso: aviso,
    rango: rangoProyecto, lunes: lunes, dia: dia, tramo: tramo, tramoReal: tramoReal,
    TONO_SEMAFORO: TONO_SEMAFORO
  };
})(typeof window !== 'undefined' ? window : this);
