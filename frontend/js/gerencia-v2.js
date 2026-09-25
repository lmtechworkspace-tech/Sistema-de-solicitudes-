/**
 * gerencia-v2.js — Resumen ejecutivo de Gerencia (SIGSO v2, Módulo 4A;
 * análisis y decisiones en documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 * Una portada que junta solicitudes, proyectos, tareas, personas y pausas
 * (backend getResumenGerencia). Es el primer ítem de "Panel de gerencia";
 * las vistas que ya existían (tablero, línea de tiempo, actividades,
 * pausas, reportes) viven en gerencia-vistas-v2.js y son el detalle de cada bloque.
 *
 * El atraso se muestra con AMBAS medidas (decisión del dueño): "Fuera de
 * plazo (SLA)" como titular y, al lado, "atrasadas vs. fecha comprometida" y
 * "sin fecha comprometida", cada una explicada.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var datos_ = null, turno_ = 0;

  function api(accion, datos) {
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, accion, datos || {}).catch(function (e) {
      return { ok: false, message: (e && e.message) || 'No se pudo conectar.' };
    });
  }
  function estadoTxt(c) { return window.formatearEstadoSigso ? formatearEstadoSigso(c) : c; }
  function tiene(m) { return !!(window.SigsoShell && SigsoShell.tieneModulo && SigsoShell.tieneModulo(m)); }
  function pct(n, d) { return d ? Math.round(n * 100 / d) : 0; }
  function irDetalle(item) { if (window.SigsoGerencia) SigsoGerencia.irAItem(item); }
  // Las demás vistas (gerencia-vistas-v2.js) comparten el contenedor: una
  // respuesta que llega tarde no debe pintar encima de otra vista.
  function esResumen() { return !window.SigsoGerencia || !SigsoGerencia.vista || SigsoGerencia.vista() === 'resumen'; }

  // --- Montaje ----------------------------------------------------------------------
  function seccion() { return document.getElementById('modulo-bandeja'); }
  function contenedor() {
    var s = seccion();
    if (!s) return null;
    var c = document.getElementById('gerencia-v2');
    if (!c) {
      c = document.createElement('div');
      c.id = 'gerencia-v2';
      c.className = 'sx2';
      s.appendChild(c);
    }
    s.classList.add('gerencia-v2-activa');
    return c;
  }
  function desmontar() {
    var s = seccion();
    if (s) s.classList.remove('gerencia-v2-activa');
    var c = document.getElementById('gerencia-v2');
    if (c) c.remove();
  }

  function cargar(silencioso) {
    var c = contenedor();
    if (!c) return;
    var t = ++turno_;
    if (!silencioso || !datos_) c.innerHTML = '<div class="sx2-pagina">' + cabecera(null) + U.esqueleto('kpis', 4) + U.esqueleto('tarjetas', 3) + '</div>';
    Promise.all([api('getResumenGerencia', {}), PY.cargarMiPerfil()]).then(function (r) {
      if (t !== turno_ || !esResumen()) return;
      if (!r[0] || !r[0].ok) {
        c.innerHTML = '<div class="sx2-pagina">' + cabecera(null) + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar el resumen',
          texto: (r[0] && r[0].message) || 'Inténtalo de nuevo.', accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-ge2-recargar' }) }) }) + '</div>';
        return;
      }
      datos_ = r[0].data;
      pintar(!!silencioso);
      var correos = [];
      if (datos_.personas.ok) correos = datos_.personas.data.map(function (p) { return p.email; });
      if (datos_.proyectos.ok) correos = correos.concat(datos_.proyectos.data.atencion.map(function (p) { return p.lider_email; }));
      Promise.all([window.SigsoDirectorio ? SigsoDirectorio.resolver(correos) : Promise.resolve(), U.precargarFotos(correos)])
        .then(function () { if (t === turno_ && esResumen()) pintar(true); });
    });
  }

  // --- Pintado ------------------------------------------------------------------------
  function cabecera(d) {
    var hora = d ? new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Santiago' }).format(new Date(d.generado_en)) : '';
    return '<header class="sx2-cabecera sx2-entra">' +
      '<div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Panel de gerencia</span><h1>Resumen ejecutivo</h1>' +
        '<span class="sx2-tenue" style="font-size:.875rem">Toda la organización' + (hora ? ' · actualizado a las ' + hora : '') + '.</span></div>' +
      '<div class="sx2-cabecera__acciones">' + (d ? U.boton({ texto: 'Imprimir', icono: 'descargar', variante: 'fantasma', clase: 'js-ge2-imprimir', titulo: 'Imprimir o guardar como PDF' }) : '') + U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-ge2-recargar' }) + '</div>' +
    '</header>';
  }

  function falla(titulo, icono, i) {
    return U.card({ titulo: titulo, icono: icono, i: i, cuerpo: U.vacio({ icono: 'alerta', texto: 'No se pudo calcular esta parte. Las demás sí están al día.' }) });
  }

  // Lo que pide una decisión, en frases cortas y con su destino.
  function atencion(d) {
    var xs = [];
    var s = d.solicitudes.ok && d.solicitudes.data, p = d.proyectos.ok && d.proyectos.data, t = d.tareas.ok && d.tareas.data, pe = d.personas.ok && d.personas.data;
    if (s && s.resumen.criticos) xs.push({ tono: 'critico', icono: 'alerta', txt: s.resumen.criticos + (s.resumen.criticos === 1 ? ' ítem crítico (P1) abierto' : ' ítems críticos (P1) abiertos'), ir: 'tablero' });
    if (s && s.abiertos_mas_60) xs.push({ tono: 'alerta', icono: 'reloj', txt: s.abiertos_mas_60 + ' de ' + s.resumen.abiertos + ' solicitudes abiertas llevan más de 60 días', ir: 'tablero' });
    if (p && p.por_salud.critico) xs.push({ tono: 'critico', icono: 'capas', txt: p.por_salud.critico + (p.por_salud.critico === 1 ? ' proyecto en estado crítico' : ' proyectos en estado crítico'), proyectos: true });
    if (p && p.por_estado.PLANIFICACION && p.total && p.por_estado.PLANIFICACION >= p.total / 2) {
      xs.push({ tono: 'info', icono: 'calendario', txt: p.por_estado.PLANIFICACION + ' de ' + p.total + ' proyectos siguen en "Planificación"' + (p.sin_tareas ? ' (' + p.sin_tareas + ' sin ninguna tarea)' : ''), proyectos: true });
    }
    if (t && t.criticas) xs.push({ tono: 'alerta', icono: 'tareas', txt: t.criticas + (t.criticas === 1 ? ' tarea importante (P1/P2) atrasada o en riesgo' : ' tareas importantes (P1/P2) atrasadas o en riesgo'), ir: 'actividades' });
    if (pe && pe.length > 1) {
      var total = pe.reduce(function (a, x) { return a + x.tareas + x.items; }, 0), top = pe[0];
      var parte = pct(top.tareas + top.items, total);
      if (parte >= 40) xs.push({ tono: 'hito', icono: 'persona', txt: PY.persona(top.email, top.nombre).nombre + ' concentra el ' + parte + ' % del trabajo abierto', ancla: 'personas' });
    }
    if (!xs.length) return '';
    return '<section class="sx2-card ge2-atencion sx2-entra" style="--i:1"><div class="sx2-card__cab"><h2 class="sx2-card__titulo">' + U.ico('rayo', 16) + 'Requiere tu atención</h2></div>' +
      '<ul class="ge2-atencion__lista">' + xs.map(function (x) {
        var dest = x.ir ? ' data-ge2-ir="' + x.ir + '"' : (x.proyectos ? ' data-ge2-proyectos="1"' : (x.ancla ? ' data-ge2-ancla="' + x.ancla + '"' : ''));
        return '<li><button type="button" class="ge2-atencion__item sx2-tono-' + x.tono + '"' + dest + '><span class="ge2-atencion__ico">' + U.ico(x.icono, 16) + '</span>' +
          '<span>' + U.esc(x.txt) + '</span>' + U.ico('derecha', 14) + '</button></li>';
      }).join('') + '</ul></section>';
  }

  function cifra(valor, etiqueta, explica, tono, destacado) {
    return '<div class="ge2-cifra' + (destacado ? ' ge2-cifra--titular' : '') + ' sx2-tono-' + (tono || 'neutro') + '">' +
      '<span class="ge2-cifra__valor">' + U.esc(valor) + '</span><span class="ge2-cifra__et">' + U.esc(etiqueta) + '</span>' +
      (explica ? '<span class="ge2-cifra__exp">' + U.esc(explica) + '</span>' : '') + '</div>';
  }

  function tarjetaSolicitudes(x) {
    if (!x.ok) return falla('Solicitudes', 'bandeja', 2);
    var s = x.data, r = s.resumen;
    var cuerpo = '<div class="ge2-cifras">' +
      cifra(r.fuera_de_plazo, 'fuera de plazo (SLA)', 'de ' + r.abiertos + ' abiertas: superaron el plazo de respuesta según su prioridad', r.fuera_de_plazo ? 'critico' : 'ok', true) +
      cifra(s.atrasadas_compromiso, 'atrasadas vs. fecha comprometida', 'solo cuenta las que tienen fecha comprometida' + (s.pct_cumplimiento_compromiso !== null ? ' · ' + s.pct_cumplimiento_compromiso + ' % cumplidas a tiempo' : ''), s.atrasadas_compromiso ? 'alerta' : 'neutro') +
      cifra(r.sin_fecha, 'sin fecha comprometida', 'nadie se comprometió con una fecha: no entran en la medida anterior', r.sin_fecha ? 'alerta' : 'neutro') +
      cifra(r.por_revisar, 'sin triar', 'nuevas o recibidas, todavía no evaluadas', r.por_revisar ? 'info' : 'neutro') +
    '</div>' +
    '<p class="ge2-flujo">' + U.ico('tendencia', 14) + ' Últimos 30 días: <b>' + s.ingresados_30 + '</b> ' + (s.ingresados_30 === 1 ? 'ítem ingresó' : 'ítems ingresaron') +
      ' y <b>' + s.cerrados_30 + '</b> ' + (s.cerrados_30 === 1 ? 'se cerró' : 'se cerraron') +
      (s.ingresados_30 > s.cerrados_30 ? ' — la cola crece.' : (s.ingresados_30 < s.cerrados_30 ? ' — la cola baja.' : '.')) + '</p>' +
    (s.criticos.length ? '<h3 class="ge2-sub">Críticos abiertos (P1)</h3><ul class="ge2-lista">' + s.criticos.map(function (i) {
      return '<li><button type="button" class="ge2-fila" data-ge2-sol="' + U.esc(i.solicitud_id) + '" data-ge2-item="' + U.esc(i.subsolicitud_id) + '">' +
        '<span class="sx2-apilado" style="gap:2px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(i.titulo) + '</strong>' +
        '<span class="sx2-tenue" style="font-size:.75rem">' + U.esc(i.solicitud_id + ' · ' + (i.empresa_nombre || '') + ' · ' + (i.asignado ? PY.persona(i.asignado, i.asignado_nombre).nombre : 'sin responsable')) + '</span></span>' +
        U.badge(estadoTxt(i.estado), 'neutro', true) + '<span class="ge2-dias">' + i.dias_abierto + ' d</span></button></li>';
    }).join('') + '</ul>' : '');
    return U.card({ titulo: 'Solicitudes', icono: 'bandeja', i: 2, accion: { texto: 'Ver tablero', clase: 'js-ge2-ir', datos: { ir: 'tablero' } }, cuerpo: cuerpo });
  }

  function tarjetaProyectos(x) {
    if (!x.ok) return falla('Proyectos', 'capas', 3);
    var p = x.data;
    if (!p.total) return U.card({ titulo: 'Proyectos', icono: 'capas', i: 3, cuerpo: U.vacio({ icono: 'capas', texto: 'No hay proyectos activos.' }) });
    var seg = [['critico', 'Crítico', 'critico'], ['riesgo', 'En riesgo', 'alerta'], ['normal', 'Normal', 'ok']];
    var barra = '<div class="ge2-salud">' + seg.map(function (sg) {
      var n = p.por_salud[sg[0]] || 0;
      return n ? '<span class="sx2-tono-' + sg[2] + '" style="flex:' + n + '" title="' + sg[1] + ': ' + n + '"></span>' : '';
    }).join('') + '</div><div class="ge2-salud__ley">' + seg.map(function (sg) {
      return '<span><i class="sx2-tono-' + sg[2] + '"></i>' + sg[1] + ' <b>' + (p.por_salud[sg[0]] || 0) + '</b></span>';
    }).join('') + '</div>';
    var cuerpo = '<div class="sx2-flex" style="gap:16px;align-items:center">' +
        U.anillo(p.avance_promedio || 0, { tam: 72, grosor: 8, tono: 'primario' }) +
        '<span class="sx2-apilado" style="gap:2px"><strong style="font-size:1.25rem">' + p.total + ' activos</strong>' +
        '<span class="sx2-tenue" style="font-size:.8125rem">Avance promedio de los que tienen tareas' + (p.sin_tareas ? ' · ' + p.sin_tareas + ' sin tareas' : '') + '</span></span></div>' +
      barra +
      (p.atencion.length ? '<h3 class="ge2-sub">Necesitan atención</h3><ul class="ge2-lista">' + p.atencion.map(function (q) {
        var lider = PY.persona(q.lider_email);
        return '<li><button type="button" class="ge2-fila' + (tiene('proyectos') ? '' : ' ge2-fila--fija') + '" data-ge2-proyecto="' + U.esc(q.proyecto_id) + '">' +
          '<span class="sx2-apilado" style="gap:2px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(q.nombre) + '</strong>' +
          '<span class="sx2-tenue sx2-cortar" style="font-size:.75rem">' + U.esc(lider.nombre + (q.motivos.length ? ' · ' + q.motivos.join(' · ') : '')) + '</span></span>' +
          U.badge(q.salud_etiqueta, q.salud === 'critico' ? 'critico' : 'alerta') + '</button></li>';
      }).join('') + '</ul>' : '');
    return U.card({ titulo: 'Proyectos', icono: 'capas', i: 3, accion: tiene('proyectos') ? { texto: 'Portafolio', clase: 'js-ge2-portafolio' } : null, cuerpo: cuerpo });
  }

  function tarjetaTareas(x) {
    if (!x.ok) return falla('Tareas', 'tareas', 4);
    var t = x.data;
    var cuerpo = '<div class="ge2-cifras ge2-cifras--4">' +
      cifra(t.abiertas, 'abiertas', '', 'primario') +
      cifra(t.atrasadas, 'atrasadas', '', t.atrasadas ? 'critico' : 'neutro') +
      cifra(t.por_confirmar, 'fechas por confirmar', '', t.por_confirmar ? 'info' : 'neutro') +
      cifra((t.pct_cumplidas_a_tiempo === null || t.pct_cumplidas_a_tiempo === undefined ? '—' : t.pct_cumplidas_a_tiempo + ' %'), 'terminadas a tiempo', 'últimos 30 días', 'ok') +
    '</div>' +
    (t.criticas_top.length ? '<h3 class="ge2-sub">Importantes atrasadas o en riesgo</h3><ul class="ge2-lista">' + t.criticas_top.map(function (a) {
      return '<li class="ge2-fila ge2-fila--fija"><span class="sx2-apilado" style="gap:2px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(a.titulo) + '</strong>' +
        '<span class="sx2-tenue" style="font-size:.75rem">' + U.esc(PY.persona(a.responsable_nombre).nombre) + (a.fecha_compromiso ? ' · comprometida ' + U.esc(PY.fecha(a.fecha_compromiso, true)) : '') + '</span></span>' +
        U.badge(a.semaforo_etiqueta, a.semaforo === 'atrasada' ? 'critico' : 'alerta') + '</li>';
    }).join('') + '</ul>' : '');
    return U.card({ titulo: 'Tareas', icono: 'tareas', i: 4, accion: { texto: 'Ver actividades', clase: 'js-ge2-ir', datos: { ir: 'actividades' } }, cuerpo: cuerpo });
  }

  function tarjetaPersonas(x) {
    if (!x.ok) return falla('Quién carga el trabajo', 'equipo', 5);
    var ps = x.data;
    if (!ps.length) return U.card({ titulo: 'Quién carga el trabajo', icono: 'equipo', i: 5, cuerpo: U.vacio({ icono: 'equipo', texto: 'No hay trabajo abierto asignado.' }) });
    var max = Math.max.apply(null, ps.map(function (p) { return p.tareas + p.items; }).concat([1]));
    return '<section id="ge2-personas" class="sx2-card sx2-entra" style="--i:5"><div class="sx2-card__cab"><h2 class="sx2-card__titulo">' + U.ico('equipo', 16) + 'Quién carga el trabajo</h2>' +
      '<span class="sx2-tenue" style="font-size:.75rem">tareas + ítems de solicitudes abiertos</span></div>' +
      '<ul class="ge2-personas">' + ps.map(function (p) {
        var per = PY.persona(p.email, p.nombre);
        var atrasado = p.tareas_atrasadas + p.items_fuera_sla;
        return '<li>' + U.avatar(per, 'sm') +
          '<span class="sx2-apilado" style="gap:4px;min-width:0;flex:1"><span class="sx2-entre"><strong class="sx2-cortar">' + U.esc(per.nombre) + '</strong>' +
            '<span class="sx2-tenue" style="font-size:.75rem;flex:none">' + p.tareas + (p.tareas === 1 ? ' tarea' : ' tareas') + ' · ' + p.items + (p.items === 1 ? ' ítem' : ' ítems') + '</span></span>' +
            '<span class="ge2-carga"><span class="ge2-carga__t" style="width:' + pct(p.tareas, max) + '%"></span><span class="ge2-carga__i" style="width:' + pct(p.items, max) + '%"></span></span>' +
            (atrasado ? '<span class="ge2-atraso">' + U.ico('alerta', 12) + atrasado + ' atrasado' + (atrasado === 1 ? '' : 's') + '</span>' : '') +
          '</span></li>';
      }).join('') + '</ul>' +
      '<div class="ge2-ley"><span><i class="ge2-carga__t"></i>Tareas</span><span><i class="ge2-carga__i"></i>Ítems de solicitudes</span></div></section>';
  }

  function tarjetaPausas(x) {
    if (!x.ok) return falla('Pausas activas', 'reloj', 6);
    var p = x.data, k = p.kpis || {};
    if (p.sin_datos) return U.card({ titulo: 'Pausas activas', icono: 'reloj', i: 6, cuerpo: U.vacio({ icono: 'reloj', texto: 'Sin pausas programadas en el período.' }) });
    return U.card({ titulo: 'Pausas activas', icono: 'reloj', i: 6, accion: { texto: 'Detalle', clase: 'js-ge2-ir', datos: { ir: 'pausas' } }, cuerpo:
      '<div class="sx2-flex" style="gap:16px;align-items:center">' +
        U.anillo(k.pct_cumplimiento || 0, { tam: 72, grosor: 8, tono: (k.pct_cumplimiento || 0) >= 80 ? 'ok' : ((k.pct_cumplimiento || 0) >= 50 ? 'alerta' : 'critico') }) +
        '<span class="sx2-apilado" style="gap:2px"><strong>' + (k.realizadas || 0) + ' de ' + (k.programadas || 0) + ' realizadas</strong>' +
        '<span class="sx2-tenue" style="font-size:.8125rem">Últimos 30 días · ' + (k.participaciones || 0) + ' participaciones' +
          (k.animo_promedio ? ' · ánimo ' + k.animo_promedio + '/5' : '') + '</span></span></div>' });
  }

  function pintar(silencioso) {
    if (!esResumen()) return;
    var c = contenedor();
    if (!c || !datos_) return;
    var y = window.scrollY, d = datos_;
    c.innerHTML = '<div class="sx2-pagina">' + cabecera(d) + atencion(d) +
      '<div class="sx2-grid sx2-grid--estira">' +
        '<div class="sx2-col-7 sx2-col--apila">' + tarjetaSolicitudes(d.solicitudes) + '</div>' +
        '<div class="sx2-col-5 sx2-col--apila">' + tarjetaProyectos(d.proyectos) + '</div>' +
        '<div class="sx2-col-7 sx2-col--apila">' + tarjetaTareas(d.tareas) + '</div>' +
        '<div class="sx2-col-5 sx2-col--apila">' + tarjetaPausas(d.pausas) + '</div>' +
        '<div class="sx2-col-12">' + tarjetaPersonas(d.personas) + '</div>' +
      '</div></div>';
    if (silencioso) {
      c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; });
      window.scrollTo(0, y);
    }
    U.animar(c);
  }

  // --- Eventos ------------------------------------------------------------------------
  function abrirProyecto(id) {
    if (!tiene('proyectos')) return;
    SigsoShell.irAModulo('proyectos');
    if (window.SigsoProyectosV2 && SigsoProyectosV2.activo() && id) PY.abrirProyecto(id);
  }
  document.addEventListener('click', function (ev) {
    var raiz = document.getElementById('gerencia-v2');
    if (!raiz || !raiz.contains(ev.target) || !esResumen()) return;
    var t = ev.target, b;
    if (t.closest('.js-ge2-recargar')) { cargar(!!datos_); return; }
    if (t.closest('.js-ge2-imprimir')) { window.print(); return; }
    if ((b = t.closest('.js-ge2-ir, [data-ge2-ir]'))) { irDetalle(b.getAttribute('data-ir') || b.getAttribute('data-ge2-ir')); return; }
    if (t.closest('.js-ge2-portafolio') || t.closest('[data-ge2-proyectos]')) { abrirProyecto(''); return; }
    if ((b = t.closest('[data-ge2-proyecto]'))) { abrirProyecto(b.getAttribute('data-ge2-proyecto')); return; }
    if ((b = t.closest('[data-ge2-ancla]'))) { var el = document.getElementById('ge2-' + b.getAttribute('data-ge2-ancla')); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if ((b = t.closest('[data-ge2-sol]')) && window.SigsoBandejaV2) SigsoBandejaV2.abrirSolicitud(b.getAttribute('data-ge2-sol'), b.getAttribute('data-ge2-item'));
  });

  // 2026-09-25: la versión clásica se retiró; la v2 es la única.
  function activo() { return true; }
  function usarVersion() { /* sin versión clásica */ }

  window.SigsoGerenciaV2 = {
    // Lo llama gerencia-vistas-v2.js al entrar al ítem "Resumen ejecutivo".
    mostrar: function () { cargar(!!datos_ && !!document.getElementById('gerencia-v2')); },
    // Lo llama el shell al cambiar de versión: entra (o sale) del resumen.
    cargar: function () { if (window.SigsoGerencia) SigsoGerencia.irAItem('resumen'); },
    refrescar: function () { cargar(true); },
    activo: activo, usarVersion: usarVersion, desmontar: desmontar
  };
  // El árbol del sidebar se registró antes de que este archivo existiera:
  // se vuelve a registrar para que aparezca "Resumen".
  if (window.SigsoGerencia && SigsoGerencia.registrarArbol) SigsoGerencia.registrarArbol();
})();
