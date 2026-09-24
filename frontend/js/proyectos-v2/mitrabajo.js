/**
 * proyectos-v2/mitrabajo.js — vista de módulo "Mi trabajo": lo que me toca a
 * MÍ en todos mis proyectos, en un solo lugar. Reemplaza en v1 "Mi trabajo
 * en proyectos" (Lista + Dedicación transversal).
 *
 * - Lista: tareas agrupadas por urgencia (atrasadas, esta semana, más
 *   adelante, sin fecha) + entregables pendientes. Cada tarea abre el MISMO
 *   panel de siempre (PY.abrirTareaDeProyecto carga su proyecto por detrás),
 *   así "Actualizar tarea" funciona sin salir de aquí.
 * - Mis horas: mapa de calor de 14 días por proyecto, solo lectura; un día
 *   lleva al panel de la tarea para corregirlo (mismo criterio que Equipo).
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var DIAS = 14;
  var f = { modo: 'lista', filtro: '', proyecto: '' };
  try { f.modo = localStorage.getItem('sigso_py2_modo_mitrabajo') || 'lista'; } catch (e) { /* sin storage */ }
  var grafico_ = null;

  function clave(v) {
    var d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function diffDias(k, hoy) {
    if (!k) return null;
    var a = k.split('-').map(Number), b = hoy.split('-').map(Number);
    return Math.round((Date.UTC(a[0], a[1] - 1, a[2]) - Date.UTC(b[0], b[1] - 1, b[2])) / 86400000);
  }
  function sumarDias(k, n) {
    var p = k.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
  }
  var fmtSantiago = (function () {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: (window.SIGSO_CONFIG || {}).TIMEZONE || 'America/Santiago' }); } catch (e) { return null; }
  })();
  function claveLocal(v) { var d = new Date(v); return isNaN(d.getTime()) ? '' : (fmtSantiago ? fmtSantiago.format(d) : clave(v)); }
  function cuando(dd) {
    if (dd === null) return 'Sin fecha';
    if (dd < 0) return 'Venció hace ' + (-dd) + (dd === -1 ? ' día' : ' días');
    if (dd === 0) return 'Vence hoy';
    if (dd === 1) return 'Vence mañana';
    return 'En ' + dd + ' días';
  }

  function abierta(a) { return a.estado !== 'TERMINADA' && a.estado !== 'CANCELADA'; }

  function cargar() {
    return Promise.all([
      PY.api('listarMisTareasProyectos', {}),
      PY.api('listarMiBitacoraProyectos', {})
    ]).then(function (r) {
      var d = (r[0] && r[0].ok && r[0].data) || { tareas: [], entregables: [] };
      return { tareas: d.tareas || [], entregables: d.entregables || [], bitacora: (r[1] && r[1].ok) ? (r[1].data || []) : [], error: !(r[0] && r[0].ok) ? ((r[0] && r[0].message) || 'No se pudo cargar tu trabajo.') : '' };
    });
  }

  // --- Lista ------------------------------------------------------------------------
  function grupos(tareas, hoy) {
    var g = { atrasadas: [], semana: [], despues: [], sinFecha: [] };
    tareas.forEach(function (a) {
      var dd = diffDias(clave(a.fecha_compromiso), hoy);
      a._dd = dd;
      if (a.semaforo === 'atrasada' || (dd !== null && dd < 0)) g.atrasadas.push(a);
      else if (dd === null) g.sinFecha.push(a);
      else if (dd <= 7) g.semana.push(a);
      else g.despues.push(a);
    });
    return g;
  }

  function fila(a, i) {
    var tono = PY.tonoTarea(a);
    var av = Number(a.avance_pct) || 0;
    return '<li class="sx2-py-mt-fila sx2-tono-' + tono + ' sx2-entra" style="--i:' + Math.min(i, 12) + '" data-py2-mt="' + U.esc(a.actividad_id) + '" data-proy="' + U.esc(a.proyecto_id) + '" tabindex="0">' +
      '<span class="sx2-py-punto"></span>' +
      '<span class="sx2-apilado" style="gap:4px;min-width:0;flex:1">' +
        '<strong class="sx2-cortar">' + U.esc(a.titulo) + '</strong>' +
        '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' +
          '<button type="button" class="sx2-py-ref" data-py2-proyecto="' + U.esc(a.proyecto_id) + '" title="Abrir el proyecto">' + U.ico('carpeta', 12) + '<span class="sx2-cortar">' + U.esc(a.proyecto_nombre) + '</span></button>' +
          U.badge(a.semaforo_etiqueta || a.estado, tono) +
          (a.soy_responsable === false ? U.badge('Colaboras', 'info', true) : '') +
          (a.prioridad === 'P1' || a.prioridad === 'P2' ? U.badge(a.prioridad, a.prioridad === 'P1' ? 'critico' : 'alerta', true) : '') +
        '</span>' +
        (a.estado === 'BLOQUEADA' && a.bloqueo_motivo ? '<span class="sx2-py-mt-bloqueo">' + U.ico('candado', 12) + U.esc(a.bloqueo_motivo) + '</span>' : '') +
      '</span>' +
      '<span class="sx2-py-mt-cuando' + (a._dd !== null && a._dd < 0 ? ' sx2-delta--mal' : '') + '">' + U.esc(cuando(a._dd)) +
        '<span class="sx2-py-mt-avance">' + U.barra(av, tono) + '<small>' + Math.round(av) + '%</small></span></span>' +
      U.boton({ texto: 'Actualizar', icono: 'tendencia', sm: true, variante: 'primario', clase: 'js-py2m-actualizar', datos: { id: a.actividad_id, proy: a.proyecto_id } }) +
    '</li>';
  }

  function tarjetaGrupo(titulo, icono, tono, lista, i, vacio) {
    if (!lista.length && !vacio) return '';
    return '<section class="sx2-card sx2-entra" style="--i:' + i + '">' +
      '<div class="sx2-card__cab"><h2 class="sx2-card__titulo"><span class="sx2-py-mt-ico sx2-tono-' + tono + '">' + U.ico(icono, 15) + '</span>' + U.esc(titulo) +
        ' <span class="sx2-card__sub">' + lista.length + '</span></h2></div>' +
      (lista.length ? '<ul class="sx2-py-mt-lista">' + lista.map(fila).join('') + '</ul>' : U.vacio({ icono: 'check', texto: vacio })) +
    '</section>';
  }

  function filtrar(d) {
    return d.tareas.filter(abierta).filter(function (a) {
      if (f.proyecto && a.proyecto_id !== f.proyecto) return false;
      if (f.filtro === 'bloqueadas') return a.estado === 'BLOQUEADA';
      return true;
    });
  }

  function vistaLista(d, hoy) {
    var lista = filtrar(d);
    var g = grupos(lista, hoy);
    var soloGrupo = f.filtro === 'atrasadas' ? 'atrasadas' : (f.filtro === 'semana' ? 'semana' : '');
    var cuerpo = !d.tareas.filter(abierta).length
      ? U.card({ cuerpo: U.vacio({ icono: 'check', titulo: 'No tienes tareas abiertas', texto: 'Cuando te asignen una tarea en un proyecto, aparecerá aquí.' }) })
      : ((!soloGrupo || soloGrupo === 'atrasadas') ? tarjetaGrupo('Atrasadas', 'alerta', 'critico', g.atrasadas, 2, soloGrupo ? 'Nada atrasado. ¡Bien!' : '') : '') +
        ((!soloGrupo || soloGrupo === 'semana') ? tarjetaGrupo('Esta semana', 'calendario', 'primario', g.semana, 3, soloGrupo ? 'Nada vence en los próximos 7 días.' : '') : '') +
        (!soloGrupo ? tarjetaGrupo('Más adelante', 'reloj', 'info', g.despues, 4) + tarjetaGrupo('Sin fecha', 'estado', 'neutro', g.sinFecha, 5) : '');

    var ents = d.entregables.filter(function (e) { return !f.proyecto || e.proyecto_id === f.proyecto; });
    var entHtml = ents.length ? '<ul class="sx2-py-entregables">' + ents.map(function (e) {
      var dd = diffDias(clave(e.fecha_comprometida), hoy);
      var tono = e.estado === 'OBSERVADO' ? 'alerta' : (dd !== null && dd < 0 ? 'critico' : (e.estado === 'ENTREGADO' ? 'primario' : 'neutro'));
      return '<li class="sx2-py-entregable sx2-tono-' + tono + '">' +
        '<strong class="sx2-py-entregable__nombre">' + U.esc(e.nombre) + '</strong>' +
        '<div class="sx2-py-entregable__meta"><button type="button" class="sx2-py-ref" data-py2-proyecto="' + U.esc(e.proyecto_id) + '" data-seccion="archivos">' + U.ico('carpeta', 12) + '<span class="sx2-cortar">' + U.esc(e.proyecto_nombre) + '</span></button>' +
          '<span class="' + (dd !== null && dd < 0 ? 'sx2-delta--mal' : 'sx2-tenue') + '">' + U.esc(cuando(dd)) + '</span></div>' +
        (e.estado === 'OBSERVADO' ? U.badge('Observado: corregir', 'alerta') : (e.estado === 'ENTREGADO' ? U.badge('Esperando revisión', 'primario') : '')) +
      '</li>';
    }).join('') + '</ul>' : U.vacio({ icono: 'bandera', texto: 'Sin entregables pendientes.' });

    // Mis tareas abiertas por proyecto: dónde está mi carga.
    var porProy = {};
    d.tareas.filter(abierta).forEach(function (a) {
      var x = porProy[a.proyecto_id] || (porProy[a.proyecto_id] = { id: a.proyecto_id, nombre: a.proyecto_nombre, n: 0, atr: 0 });
      x.n++; if (a.semaforo === 'atrasada') x.atr++;
    });
    var proys = Object.keys(porProy).map(function (k) { return porProy[k]; }).sort(function (a, b) { return b.n - a.n; });
    var max = Math.max.apply(null, proys.map(function (x) { return x.n; }).concat([1]));
    var carga = proys.length ? '<ul class="sx2-py-mt-proys">' + proys.map(function (x) {
      return '<li><button type="button" class="sx2-py-mt-proy" data-py2-proyecto="' + U.esc(x.id) + '">' +
        '<span class="sx2-entre"><span class="sx2-cortar">' + U.esc(x.nombre) + '</span><strong>' + x.n + (x.atr ? ' <span class="sx2-delta--mal">· ' + x.atr + ' atr.</span>' : '') + '</strong></span>' +
        U.barra(Math.round(x.n / max * 100), x.atr ? 'critico' : 'primario') + '</button></li>';
    }).join('') + '</ul>' : U.vacio({ icono: 'carpeta', texto: 'Sin proyectos con tareas tuyas.' });

    return '<div class="sx2-grid sx2-grid--estira">' +
      '<div class="sx2-col-8 sx2-apilado">' + cuerpo + '</div>' +
      '<div class="sx2-col-4 sx2-col--apila sx2-apilado">' +
        U.card({ titulo: 'Mis entregables', icono: 'bandera', sub: String(ents.length), i: 3, cuerpo: entHtml }) +
        U.card({ titulo: 'Por proyecto', icono: 'carpeta', sub: 'tareas abiertas', i: 4, cuerpo: carga }) +
      '</div>' +
    '</div>';
  }

  // --- Mis horas ----------------------------------------------------------------------
  // Por tarea y día manda el REGISTRO_DIA; si no hay, suman las horas de los
  // check-in (mismo criterio que v1 y que la sección Equipo).
  function horas(d, hoy) {
    var dias = [];
    for (var i = DIAS - 1; i >= 0; i--) dias.push(sumarDias(hoy, -i));
    var enV = {};
    dias.forEach(function (x) { enV[x] = true; });
    var tareas = {};
    d.tareas.forEach(function (a) { tareas[a.actividad_id] = a; });
    var reg = {}, chk = {};
    d.bitacora.forEach(function (b) {
      if (!tareas[b.actividad_id]) return;
      if (b.tipo === 'REGISTRO_DIA' && b.dia && enV[b.dia]) (reg[b.actividad_id] = reg[b.actividad_id] || {})[b.dia] = b;
      else if (b.tipo !== 'REGISTRO_DIA' && b.horas) {
        var k = claveLocal(b.timestamp);
        if (!enV[k]) return;
        var m = (chk[b.actividad_id] = chk[b.actividad_id] || {});
        m[k] = (m[k] || 0) + Number(b.horas);
      }
    });
    var porProy = {};
    Object.keys(tareas).forEach(function (id) {
      var a = tareas[id];
      dias.forEach(function (x) {
        var r = reg[id] && reg[id][x];
        var h = r ? (Number(r.horas) || 0) : ((chk[id] && chk[id][x]) || 0);
        if (!r && !h) return;
        var p = porProy[a.proyecto_id] || (porProy[a.proyecto_id] = { id: a.proyecto_id, nombre: a.proyecto_nombre, total: 0, porDia: {}, detalle: {} });
        p.total += h;
        p.porDia[x] = (p.porDia[x] || 0) + h;
        (p.detalle[x] = p.detalle[x] || []).push({ tarea: a, horas: h, estado: r ? r.estado_dia : '', nota: r ? r.nota : '' });
      });
    });
    return { dias: dias, porProy: porProy };
  }

  var LETRA = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
  function vistaHoras(d, hoy) {
    var h = horas(d, hoy);
    var proys = Object.keys(h.porProy).map(function (k) { return h.porProy[k]; }).sort(function (a, b) { return b.total - a.total; });
    var total = proys.reduce(function (s, p) { return s + p.total; }, 0);
    var porDia = h.dias.map(function (x) { return proys.reduce(function (s, p) { return s + (p.porDia[x] || 0); }, 0); });
    var semana = porDia.slice(-7).reduce(function (s, v) { return s + v; }, 0);
    var anterior = porDia.slice(0, 7).reduce(function (s, v) { return s + v; }, 0);
    var diasConReg = porDia.filter(function (v) { return v > 0; }).length;
    var r1 = function (v) { return Math.round(v * 10) / 10; };

    var kpis = '<div class="sx2-fila-kpis">' +
      U.kpi({ i: 0, icono: 'reloj', tono: 'primario', etiqueta: 'Últimos 7 días', valor: r1(semana), sufijo: ' h',
        tendencia: anterior ? { texto: (semana >= anterior ? '+' : '') + r1(semana - anterior) + ' h vs semana anterior', tono: semana >= anterior ? 'ok' : 'alerta', icono: semana >= anterior ? 'tendencia' : 'tendenciaBaja' } : null }) +
      U.kpi({ i: 1, icono: 'calendario', tono: 'info', etiqueta: '14 días', valor: r1(total), sufijo: ' h', unidad: diasConReg + (diasConReg === 1 ? ' día con registro' : ' días con registro') }) +
      U.kpi({ i: 2, icono: 'carpeta', tono: 'hito', etiqueta: 'Proyectos', valor: proys.length, unidad: 'con horas tuyas' }) +
      U.kpi({ i: 3, icono: 'rayo', tono: porDia.some(function (v) { return v > 9; }) ? 'alerta' : 'neutro', etiqueta: 'Días de más de 9 h', valor: porDia.filter(function (v) { return v > 9; }).length, unidad: 'en 14 días' }) +
    '</div>';

    if (!proys.length) {
      return kpis + U.card({ cuerpo: U.vacio({ icono: 'reloj', titulo: 'Sin horas en los últimos 14 días', texto: 'Registra horas con "Actualizar" en cualquiera de tus tareas.' }) });
    }
    var cab = h.dias.map(function (x) {
      var dt = new Date(x + 'T12:00:00Z'), w = dt.getUTCDay();
      return '<span class="sx2-py-calor__dia' + (w === 0 || w === 6 ? ' sx2-py-calor__dia--finde' : '') + (x === hoy ? ' sx2-py-calor__dia--hoy' : '') + '"><b>' + LETRA[w] + '</b>' + x.slice(8) + '</span>';
    }).join('');
    var mapa = '<div class="sx2-py-calor" style="--dias:' + h.dias.length + '">' +
      '<div class="sx2-py-calor__fila sx2-py-calor__fila--cab"><span></span>' + cab + '<span class="sx2-py-calor__total">Total</span></div>' +
      proys.map(function (p) {
        return '<div class="sx2-py-calor__fila"><span class="sx2-py-calor__persona"><span class="sx2-py-mt-ico sx2-tono-primario">' + U.ico('carpeta', 12) + '</span><span class="sx2-cortar">' + U.esc(p.nombre) + '</span></span>' +
          h.dias.map(function (x) {
            var v = p.porDia[x] || 0;
            var nivel = !p.detalle[x] ? 0 : (v > 9 ? 5 : (v > 6 ? 4 : (v > 3 ? 3 : (v > 0 ? 2 : 1))));
            return '<button type="button" class="sx2-py-calor__celda sx2-py-calor__celda--' + nivel + '"' +
              (p.detalle[x] ? ' data-py2m-celda="' + U.esc(p.id) + '|' + x + '"' : ' disabled') + ' title="' + U.esc(p.nombre + ' · ' + PY.fecha(x) + (v ? ' · ' + r1(v) + ' h' : '')) + '">' + (v ? r1(v) : '') + '</button>';
          }).join('') +
          '<span class="sx2-py-calor__total">' + r1(p.total) + ' h</span></div>';
      }).join('') +
      '<div class="sx2-py-calor__fila sx2-py-mt-totales"><span class="sx2-py-calor__persona"><strong>Total del día</strong></span>' +
        porDia.map(function (v) { return '<span class="sx2-py-calor__total' + (v > 9 ? ' sx2-delta--mal' : '') + '" style="text-align:center">' + (v ? r1(v) : '·') + '</span>'; }).join('') +
        '<span class="sx2-py-calor__total"><strong>' + r1(total) + ' h</strong></span></div>' +
    '</div>';

    return kpis + '<div class="sx2-grid sx2-grid--estira">' +
      '<div class="sx2-col-8">' + U.card({ titulo: 'Mi dedicación día a día', icono: 'calendario', sub: 'clic en un día para ver o corregir', i: 2, cuerpo: mapa }) + '</div>' +
      '<div class="sx2-col-4 sx2-col--apila">' + U.card({ titulo: 'Horas por día', icono: 'grafico', i: 3,
        cuerpo: '<div class="sx2-py-grafico sx2-py-grafico--alto"><canvas id="py2-grafico-mishoras" role="img" aria-label="Mis horas por día y proyecto"></canvas></div>' }) + '</div>' +
    '</div>';
  }

  // --- Pintado ---------------------------------------------------------------------
  function pintar(d) {
    var hoy = PY.hoyClave();
    var yo = PY.persona(PY.miEmail(), PY.miNombre());
    var abiertas = d.tareas.filter(abierta);
    var g = grupos(abiertas.slice(), hoy);
    var proyectos = {};
    abiertas.forEach(function (a) { proyectos[a.proyecto_id] = a.proyecto_nombre; });
    var nProy = Object.keys(proyectos).length;
    var bloqueadas = abiertas.filter(function (a) { return a.estado === 'BLOQUEADA'; }).length;
    var hora = Number(new Intl.DateTimeFormat('es-CL', { hour: 'numeric', hour12: false, timeZone: 'America/Santiago' }).format(new Date()));
    var saludo = hora < 12 ? 'Buenos días' : (hora < 20 ? 'Buenas tardes' : 'Buenas noches');

    var cabecera = '<header class="sx2-cabecera sx2-entra">' +
      '<div class="sx2-flex" style="gap:16px;align-items:center;min-width:0">' + U.avatar(yo, 'xl') +
        '<div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Proyectos</span>' +
          '<h1>' + saludo + (yo.nombre && yo.nombre !== yo.email ? ', ' + U.esc(String(yo.nombre).split(' ')[0]) : '') + '</h1>' +
          '<span class="sx2-tenue" style="font-size:.875rem">' + (abiertas.length
            ? 'Tienes ' + abiertas.length + (abiertas.length === 1 ? ' tarea abierta' : ' tareas abiertas') + ' en ' + nProy + (nProy === 1 ? ' proyecto' : ' proyectos') + (g.atrasadas.length ? ' · ' + g.atrasadas.length + ' atrasada' + (g.atrasadas.length === 1 ? '' : 's') : '') + '.'
            : 'No tienes tareas abiertas en proyectos.') + '</span>' +
        '</div></div>' +
      '<div class="sx2-cabecera__acciones">' + U.segmento([{ id: 'lista', texto: 'Mis tareas', icono: 'tareas' }, { id: 'horas', texto: 'Mis horas', icono: 'reloj' }], f.modo, 'js-py2m-modo') + '</div>' +
    '</header>';

    if (d.error) return cabecera + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: d.error }) });
    if (f.modo === 'horas') return cabecera + vistaHoras(d, hoy);

    var kpis = '<div class="sx2-fila-kpis">' +
      U.kpi({ i: 0, icono: 'tareas', tono: 'primario', etiqueta: 'Abiertas', valor: abiertas.length, unidad: 'en ' + nProy + (nProy === 1 ? ' proyecto' : ' proyectos'), filtro: 'todas', activo: !f.filtro }) +
      U.kpi({ i: 1, icono: 'alerta', tono: 'critico', etiqueta: 'Atrasadas', valor: g.atrasadas.length, unidad: 'atender primero', filtro: 'atrasadas', activo: f.filtro === 'atrasadas' }) +
      U.kpi({ i: 2, icono: 'calendario', tono: 'alerta', etiqueta: 'Esta semana', valor: g.semana.length, unidad: 'vencen en 7 días', filtro: 'semana', activo: f.filtro === 'semana' }) +
      U.kpi({ i: 3, icono: 'candado', tono: 'hito', etiqueta: 'Bloqueadas', valor: bloqueadas, unidad: 'esperan algo', filtro: 'bloqueadas', activo: f.filtro === 'bloqueadas' }) +
      U.kpi({ i: 4, icono: 'bandera', tono: 'ok', etiqueta: 'Entregables', valor: d.entregables.length, unidad: 'pendientes' }) +
    '</div>';
    var chips = nProy > 1 ? '<div class="sx2-chips sx2-entra" style="--i:1">' + U.chip({ texto: 'Todos mis proyectos', activo: !f.proyecto, clase: 'js-py2m-proy', datos: { id: '' } }) +
      Object.keys(proyectos).map(function (id) {
        return U.chip({ texto: proyectos[id], activo: f.proyecto === id, clase: 'js-py2m-proy', datos: { id: id }, n: abiertas.filter(function (a) { return a.proyecto_id === id; }).length });
      }).join('') + '</div>' : '';
    return cabecera + kpis + chips + vistaLista(d, hoy);
  }

  function colorVar(raiz, v) {
    var el = document.createElement('span');
    el.style.color = 'var(' + v + ')';
    el.style.display = 'none';
    raiz.appendChild(el);
    var c = getComputedStyle(el).color;
    el.remove();
    return c;
  }
  function dibujar(raiz, d) {
    if (grafico_) { grafico_.destroy(); grafico_ = null; }
    var c = raiz.querySelector('#py2-grafico-mishoras');
    if (!c || !window.Chart) return;
    var h = horas(d, PY.hoyClave());
    var proys = Object.keys(h.porProy).map(function (k) { return h.porProy[k]; }).sort(function (a, b) { return b.total - a.total; });
    var paleta = ['--sx-primario', '--sx-hito', '--sx-ok', '--sx-alerta', '--sx-info', '--sx-critico'].map(function (v) { return colorVar(raiz, v); });
    var t3 = colorVar(raiz, '--sx-texto-3');
    grafico_ = new Chart(c, {
      type: 'bar',
      data: { labels: h.dias.map(function (x) { return x.slice(8) + '/' + x.slice(5, 7); }),
        datasets: proys.slice(0, 6).map(function (p, i) {
          return { label: p.nombre, data: h.dias.map(function (x) { return Math.round((p.porDia[x] || 0) * 10) / 10; }), backgroundColor: paleta[i], borderRadius: 4, maxBarThickness: 18 };
        }) },
      options: {
        maintainAspectRatio: false, animation: U.reducirMovimiento() ? false : { duration: 700 },
        scales: { x: { stacked: true, grid: { display: false }, ticks: { color: t3, font: { size: 10 }, maxRotation: 0 } },
          y: { stacked: true, beginAtZero: true, grid: { color: colorVar(raiz, '--sx-borde-suave') }, ticks: { color: t3, font: { size: 10 } } } },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, color: colorVar(raiz, '--sx-texto-2'), font: { size: 11 } } } }
      }
    });
  }

  function abrirDia(d, proyId, dia) {
    var p = horas(d, PY.hoyClave()).porProy[proyId];
    var items = (p && p.detalle[dia]) || [];
    var dr = U.drawer({
      titulo: PY.fecha(dia, true),
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(p ? p.nombre : '') + '</span>',
      cuerpo: '<ul class="sx2-lista">' + items.map(function (it) {
        return '<li class="sx2-py-dia-item" data-act="' + U.esc(it.tarea.actividad_id) + '" tabindex="0">' +
          '<span class="sx2-apilado" style="gap:2px;flex:1;min-width:0"><strong class="sx2-cortar">' + U.esc(it.tarea.titulo) + '</strong>' +
            (it.nota ? '<span class="sx2-tenue" style="font-size:.78rem">' + U.esc(it.nota) + '</span>' : '') + '</span>' +
          '<span class="sx2-flex">' + (it.estado ? U.badge(it.estado.replace(/_/g, ' '), 'neutro', true) : '') + '<strong>' + (Math.round(it.horas * 10) / 10) + ' h</strong></span>' +
        '</li>';
      }).join('') + '</ul>',
      pie: '<span class="sx2-tenue" style="font-size:.8125rem;flex:1;align-self:center">Clic en una tarea para corregir ese día.</span>'
    });
    dr.el.addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-act]');
      if (!t) return;
      dr.cerrar(true);
      PY.abrirTareaDeProyecto(proyId, t.getAttribute('data-act'), { actualizar: true, dia: dia, alGuardar: PY.recargarVista });
    });
  }

  function alMontar(raiz, d) {
    dibujar(raiz, d);
    raiz.addEventListener('click', function (ev) {
      var t = ev.target, b;
      if ((b = t.closest('.js-py2m-modo'))) {
        f.modo = b.getAttribute('data-id');
        try { localStorage.setItem('sigso_py2_modo_mitrabajo', f.modo); } catch (e) { /* sin storage */ }
        PY.pintar();
        return;
      }
      if ((b = t.closest('.sx2-kpi[data-filtro]'))) { var k = b.getAttribute('data-filtro'); f.filtro = (k === 'todas' || f.filtro === k) ? '' : k; PY.pintar({ sinAnimacion: true }); return; }
      if ((b = t.closest('.js-py2m-proy'))) { f.proyecto = b.getAttribute('data-id'); PY.pintar({ sinAnimacion: true }); return; }
      if (t.closest('[data-py2-proyecto]')) return; // lo abre el núcleo
      if ((b = t.closest('.js-py2m-actualizar'))) {
        ev.stopPropagation();
        PY.abrirTareaDeProyecto(b.getAttribute('data-proy'), b.getAttribute('data-id'), { actualizar: true, alGuardar: PY.recargarVista });
        return;
      }
      if ((b = t.closest('[data-py2m-celda]'))) { var p = b.getAttribute('data-py2m-celda').split('|'); abrirDia(d, p[0], p[1]); return; }
      if ((b = t.closest('[data-py2-mt]'))) PY.abrirTareaDeProyecto(b.getAttribute('data-proy'), b.getAttribute('data-py2-mt'), { alGuardar: PY.recargarVista });
    });
    raiz.addEventListener('keydown', function (ev) {
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[data-py2-mt]')) { ev.preventDefault(); ev.target.click(); }
    });
    var calor = raiz.querySelector('.sx2-py-calor');
    if (calor) calor.scrollLeft = calor.scrollWidth;
  }

  PY.vistas.mitrabajo = {
    cargar: cargar, pintar: pintar, alMontar: alMontar,
    correos: function () { return [PY.miEmail()]; }
  };
})();
