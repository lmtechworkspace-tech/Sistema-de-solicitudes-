/**
 * proyectos-v2/portafolio.js — portafolio de Proyectos v2 (pantalla completa).
 *
 * KPIs del portafolio, filtros por salud (chips), búsqueda y orden, vista
 * tarjetas/lista, dona de salud (Chart.js, ya cargado por el shell) y carga
 * por persona. "Nuevo proyecto" es un drawer v2 propio sobre el MISMO
 * endpoint (crearProyecto) que v1 -- el modal de v1 no se reusa porque al
 * guardar repinta el portafolio v1 dentro del contenedor.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;

  var filtros = { salud: '', texto: '', orden: 'urgencia', vista: 'tarjetas' };
  var graficoSalud_ = null;
  try { filtros.vista = localStorage.getItem('sigso_py2_vista_portafolio') || 'tarjetas'; } catch (e) { /* sin storage */ }

  var ORDENES = {
    urgencia: function (a, b) {
      var o = { critico: 0, riesgo: 1, normal: 2 };
      return (o[a.salud] - o[b.salud]) || (new Date(a.fecha_objetivo || '9999-12-31') - new Date(b.fecha_objetivo || '9999-12-31'));
    },
    vence: function (a, b) { return new Date(a.fecha_objetivo || '9999-12-31') - new Date(b.fecha_objetivo || '9999-12-31'); },
    avance: function (a, b) { return (a.avance_pct || 0) - (b.avance_pct || 0); },
    nombre: function (a, b) { return String(a.nombre).localeCompare(String(b.nombre), 'es'); }
  };

  function cabeceraPortafolio() {
    return '<header class="sx2-cabecera sx2-entra">' +
      '<div class="sx2-cabecera__txt">' +
        '<h1>Proyectos</h1>' +
        '<p>Portafolio de proyectos internos: quién lidera cada uno, cómo va y qué necesita atención.</p>' +
      '</div>' +
      '<div class="sx2-cabecera__acciones">' +
        U.boton({ texto: 'Nuevo proyecto', icono: 'nueva', variante: 'primario', clase: 'js-py2-nuevo' }) +
      '</div>' +
    '</header>';
  }

  function visibles(proyectos) {
    var txt = filtros.texto.trim().toLowerCase();
    return proyectos.filter(function (p) {
      if (filtros.salud && p.salud !== filtros.salud) return false;
      if (!txt) return true;
      var lider = PY.persona(p.lider_email).nombre;
      return (p.nombre + ' ' + (p.codigo || '') + ' ' + (p.descripcion || '') + ' ' + lider).toLowerCase().indexOf(txt) !== -1;
    }).sort(ORDENES[filtros.orden] || ORDENES.urgencia);
  }

  function venceHtml(p) {
    var d = PY.diasHasta(p.fecha_objetivo);
    if (d === null) return '<span class="sx2-py-tarjeta__vence">' + U.ico('calendario', 13) + 'Sin fecha objetivo</span>';
    if (p.estado === 'CERRADO' || p.estado === 'CANCELADO') return '<span class="sx2-py-tarjeta__vence">' + U.ico('check', 13) + (PY.ETIQUETA_ESTADO_PROYECTO[p.estado]) + '</span>';
    var clase = d < 0 ? ' sx2-py-tarjeta__vence--vencido' : (d <= 14 ? ' sx2-py-tarjeta__vence--pronto' : '');
    var txt = d < 0 ? 'Venció hace ' + (-d) + ' d' : (d === 0 ? 'Vence hoy' : 'Vence en ' + d + ' d');
    return '<span class="sx2-py-tarjeta__vence' + clase + '">' + U.ico('reloj', 13) + txt + '</span>';
  }

  function tarjeta(p, i) {
    var tono = PY.TONO_SALUD[p.salud] || 'primario';
    var integrantes = (p.integrantes || []).map(function (x) { return PY.persona(x.email, x.nombre); });
    var cump = p.cumplimiento_tareas || {};
    return '<article class="sx2-card sx2-card--interactiva sx2-py-tarjeta sx2-entra sx2-tono-' + tono + '" style="--i:' + Math.min(i, 12) + '"' +
      ' data-py2-proyecto="' + U.esc(p.proyecto_id) + '" tabindex="0" role="link" aria-label="Abrir ' + U.esc(p.nombre) + '">' +
      '<div class="sx2-entre">' +
        '<span class="sx2-flex">' + U.badge(PY.ETIQUETA_SALUD[p.salud] || p.salud, tono) + U.badge(PY.ETIQUETA_ESTADO_PROYECTO[p.estado] || p.estado, 'neutro', true) + '</span>' +
        (p.codigo ? '<span class="sx2-tenue" style="font-size:.75rem">' + U.esc(p.codigo) + '</span>' : '') +
      '</div>' +
      '<h3 class="sx2-py-tarjeta__nombre">' + U.esc(p.nombre) + '</h3>' +
      '<p class="sx2-py-tarjeta__desc">' + U.esc(p.descripcion || 'Sin descripción.') + '</p>' +
      '<div class="sx2-py-tarjeta__avance">' +
        U.anillo(p.avance_pct || 0, { tam: 52, grosor: 6, tono: tono }) +
        '<div class="sx2-py-tarjeta__cifras">' +
          '<strong>' + (p.avance_pct === null || p.avance_pct === undefined ? 'Sin avance medido' : p.avance_pct + '% de avance') + '</strong>' +
          '<span>' + (p.total_tareas || 0) + ' tareas' + (cump.entregadas ? ' · ' + cump.a_tiempo + '/' + cump.entregadas + ' a tiempo' : '') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="sx2-entre sx2-py-tarjeta__pie">' +
        (integrantes.length ? U.avatares(integrantes, 4) : '<span class="sx2-tenue" style="font-size:.75rem">Sin equipo</span>') +
        venceHtml(p) +
      '</div>' +
    '</article>';
  }

  function lista(proyectos) {
    return U.card({ sinRelleno: true, cuerpo:
      '<div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr>' +
        '<th>Proyecto</th><th>Líder</th><th>Salud</th><th style="width:22%">Avance</th><th class="sx2-num">Tareas</th><th>Vence</th>' +
      '</tr></thead><tbody>' +
      proyectos.map(function (p) {
        var tono = PY.TONO_SALUD[p.salud] || 'primario';
        return '<tr class="sx2-fila--clic" data-py2-proyecto="' + U.esc(p.proyecto_id) + '" tabindex="0">' +
          '<td><strong>' + U.esc(p.nombre) + '</strong>' + (p.codigo ? '<div class="sx2-tenue" style="font-size:.75rem">' + U.esc(p.codigo) + '</div>' : '') + '</td>' +
          '<td>' + U.persona(PY.persona(p.lider_email)) + '</td>' +
          '<td>' + U.badge(PY.ETIQUETA_SALUD[p.salud] || p.salud, tono) + '</td>' +
          '<td><div class="sx2-flex" style="gap:10px"><span style="flex:1">' + U.barra(p.avance_pct || 0, tono) + '</span><span class="sx2-num" style="min-width:3ch">' + (p.avance_pct || 0) + '%</span></div></td>' +
          '<td class="sx2-num">' + (p.total_tareas || 0) + '</td>' +
          '<td>' + venceHtml(p) + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>' });
  }

  function lateral(port) {
    var r = port.resumen || {};
    var s = r.por_salud || { normal: 0, riesgo: 0, critico: 0 };
    var total = (s.normal || 0) + (s.riesgo || 0) + (s.critico || 0);
    var salud = U.card({ titulo: 'Salud del portafolio', icono: 'dona', i: 2, cuerpo:
      (total ? '<div class="sx2-py-grafico"><canvas id="py2-grafico-salud" aria-label="Distribución de salud de los proyectos activos" role="img"></canvas></div>' : U.vacio({ icono: 'dona', texto: 'Sin proyectos activos.' })) +
      '<div class="sx2-py-leyenda">' +
        [['critico', 'Crítico'], ['riesgo', 'En riesgo'], ['normal', 'Normal']].map(function (x) {
          return '<span class="sx2-py-leyenda__et sx2-tono-' + PY.TONO_SALUD[x[0]] + '">' + x[1] + '</span><span class="sx2-py-leyenda__n">' + (s[x[0]] || 0) + '</span>';
        }).join('') +
      '</div>' });

    var carga = (r.carga_por_persona || []).filter(function (c) { return c.email && c.email.indexOf('@') !== -1; }).slice(0, 6);
    var max = carga.length ? carga[0].carga_ponderada : 0;
    var equipo = U.card({ titulo: 'Carga del equipo', icono: 'equipo', sub: 'tareas abiertas', i: 3, cuerpo:
      (carga.length ? '<div class="sx2-py-carga">' + carga.map(function (c) {
        var pct = max ? Math.round(c.carga_ponderada / max * 100) : 0;
        var tono = pct >= 85 ? 'critico' : (pct >= 60 ? 'alerta' : 'primario');
        return '<div class="sx2-py-carga__fila">' + U.persona(PY.persona(c.email, c.nombre)) +
          '<span class="sx2-py-carga__n">' + c.total_tareas + '</span>' + U.barra(pct, tono) + '</div>';
      }).join('') + '</div>' : U.vacio({ icono: 'equipo', texto: 'Nadie tiene tareas abiertas.' })) });

    return salud + equipo;
  }

  function pintarPortafolio(port) {
    var todos = port.proyectos || [];
    var activos = todos.filter(function (p) { return p.estado !== 'CERRADO' && p.estado !== 'CANCELADO'; });
    var r = port.resumen || {};
    var s = r.por_salud || {};
    var cuenta = function (salud) { return todos.filter(function (p) { return p.salud === salud; }).length; };
    var vis = visibles(todos);

    var kpis = '<div class="sx2-fila-kpis">' +
      U.kpi({ i: 0, icono: 'capas', tono: 'primario', etiqueta: 'Proyectos activos', valor: r.total_proyectos !== undefined ? r.total_proyectos : activos.length, unidad: todos.length + ' en total' }) +
      U.kpi({ i: 1, icono: 'alerta', tono: 'critico', etiqueta: 'Críticos', valor: s.critico || 0, unidad: 'requieren acción', filtro: 'critico', activo: filtros.salud === 'critico' }) +
      U.kpi({ i: 2, icono: 'rayo', tono: 'alerta', etiqueta: 'En riesgo', valor: s.riesgo || 0, unidad: 'vigilar de cerca', filtro: 'riesgo', activo: filtros.salud === 'riesgo' }) +
      U.kpi({ i: 3, icono: 'check', tono: 'ok', etiqueta: 'En buen estado', valor: s.normal || 0, unidad: 'sin alertas', filtro: 'normal', activo: filtros.salud === 'normal' }) +
      U.kpi({ i: 4, icono: 'calendario', tono: 'info', etiqueta: 'Vencen en 14 días', valor: r.proximos_a_cerrar || 0, unidad: 'fecha objetivo cercana' }) +
      U.kpi({ i: 5, icono: 'reloj', tono: 'neutro', etiqueta: 'Sin novedad 7+ días', valor: r.sin_actualizacion_reciente || 0, unidad: 'sin actualizar' }) +
    '</div>';

    var barra = '<div class="sx2-entre sx2-entra" style="--i:1;flex-wrap:wrap">' +
      '<div class="sx2-chips">' +
        U.chip({ texto: 'Todos', icono: 'rejilla', n: todos.length, activo: !filtros.salud, clase: 'js-py2-salud', datos: { salud: '' } }) +
        U.chip({ texto: 'Críticos', icono: 'alerta', tono: 'critico', n: cuenta('critico'), activo: filtros.salud === 'critico', clase: 'js-py2-salud', datos: { salud: 'critico' } }) +
        U.chip({ texto: 'En riesgo', icono: 'rayo', tono: 'alerta', n: cuenta('riesgo'), activo: filtros.salud === 'riesgo', clase: 'js-py2-salud', datos: { salud: 'riesgo' } }) +
        U.chip({ texto: 'Normales', icono: 'check', tono: 'ok', n: cuenta('normal'), activo: filtros.salud === 'normal', clase: 'js-py2-salud', datos: { salud: 'normal' } }) +
      '</div>' +
      '<div class="sx2-barra-filtros">' +
        '<label class="sx2-buscar">' + U.ico('lupa', 16) + '<input class="sx2-input js-py2-buscar" type="search" placeholder="Buscar proyecto, código o líder…" aria-label="Buscar proyecto" value="' + U.esc(filtros.texto) + '"></label>' +
        '<select class="sx2-select js-py2-orden" aria-label="Ordenar">' +
          [['urgencia', 'Más urgentes primero'], ['vence', 'Vencen antes'], ['avance', 'Menos avanzados'], ['nombre', 'Nombre (A–Z)']].map(function (o) {
            return '<option value="' + o[0] + '"' + (filtros.orden === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
          }).join('') +
        '</select>' +
        U.segmento([{ id: 'tarjetas', texto: 'Tarjetas', icono: 'rejilla' }, { id: 'lista', texto: 'Lista', icono: 'lista' }], filtros.vista, 'js-py2-vista') +
      '</div>' +
    '</div>';

    var cuerpo = vis.length
      ? (filtros.vista === 'lista' ? lista(vis) : '<div class="sx2-py-tarjetas">' + vis.map(tarjeta).join('') + '</div>')
      : U.card({ cuerpo: U.vacio({ icono: 'lupa', titulo: 'Ningún proyecto coincide', texto: 'Prueba con otro filtro o búsqueda.',
          accion: U.boton({ texto: 'Limpiar filtros', icono: 'equis', clase: 'js-py2-limpiar' }) }) });

    return '<div class="sx2-pagina">' + cabeceraPortafolio() + kpis + barra +
      '<div class="sx2-grid">' +
        '<div class="sx2-col-9">' + cuerpo + '</div>' +
        '<aside class="sx2-col-3 sx2-apilado">' + lateral(port) + '</aside>' +
      '</div>' +
    '</div>';
  }

  function colorVar(nombre, raiz) {
    return getComputedStyle(raiz).getPropertyValue(nombre).trim() || '#888';
  }

  function dibujarGraficoSalud(raiz, port) {
    if (graficoSalud_) { graficoSalud_.destroy(); graficoSalud_ = null; }
    var canvas = raiz.querySelector('#py2-grafico-salud');
    if (!canvas || !window.Chart) return;
    var s = (port.resumen && port.resumen.por_salud) || {};
    var paleta = [colorVar('--sx-critico', raiz), colorVar('--sx-alerta', raiz), colorVar('--sx-ok', raiz)];
    graficoSalud_ = new Chart(canvas, {
      type: 'doughnut',
      data: { labels: ['Crítico', 'En riesgo', 'Normal'], datasets: [{ data: [s.critico || 0, s.riesgo || 0, s.normal || 0], backgroundColor: paleta, borderWidth: 0, hoverOffset: 6 }] },
      options: {
        cutout: '72%', maintainAspectRatio: false,
        animation: U.reducirMovimiento() ? false : { animateRotate: true, duration: 900 },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return ' ' + c.label + ': ' + c.parsed; } } } },
        onClick: function (ev, elementos) {
          if (!elementos.length) return;
          filtros.salud = ['critico', 'riesgo', 'normal'][elementos[0].index];
          PY.pintar();
        }
      }
    });
  }

  var tBusqueda_ = null;
  function alMontarPortafolio(raiz, port) {
    dibujarGraficoSalud(raiz, port);
    var buscar = raiz.querySelector('.js-py2-buscar');
    if (buscar) {
      buscar.addEventListener('input', function () {
        clearTimeout(tBusqueda_);
        tBusqueda_ = setTimeout(function () {
          filtros.texto = buscar.value;
          PY.pintar({ sinAnimacion: true });
          var nuevo = document.querySelector('.js-py2-buscar');
          if (nuevo) { nuevo.focus(); nuevo.setSelectionRange(nuevo.value.length, nuevo.value.length); }
        }, 220);
      });
    }
    var orden = raiz.querySelector('.js-py2-orden');
    if (orden) orden.addEventListener('change', function () { filtros.orden = orden.value; PY.pintar(); });
  }

  // Clicks del portafolio (delegado en el documento, filtrado por .sx2).
  document.addEventListener('click', function (ev) {
    var raiz = ev.target.closest('#proyectos-contenido.sx2');
    if (!raiz || PY.estado().vista !== 'portafolio') return;
    var t = ev.target;
    var ch = t.closest('.js-py2-salud');
    if (ch) { filtros.salud = ch.getAttribute('data-salud'); PY.pintar(); return; }
    var k = t.closest('.sx2-kpi[data-filtro]');
    if (k) { var f = k.getAttribute('data-filtro'); filtros.salud = filtros.salud === f ? '' : f; PY.pintar(); return; }
    var v = t.closest('.js-py2-vista');
    if (v) {
      filtros.vista = v.getAttribute('data-id');
      try { localStorage.setItem('sigso_py2_vista_portafolio', filtros.vista); } catch (e) { /* sin storage */ }
      PY.pintar();
      return;
    }
    if (t.closest('.js-py2-limpiar')) { filtros.salud = ''; filtros.texto = ''; PY.pintar(); return; }
    if (t.closest('.js-py2-nuevo')) { abrirNuevoProyecto(); return; }
  });

  // --- Nuevo proyecto (drawer) ----------------------------------------------------
  function abrirNuevoProyecto() {
    var hoy = new Date().toISOString().slice(0, 10);
    var d = U.drawer({
      titulo: 'Nuevo proyecto',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Después podrás sumar equipo, hitos y tareas.</span>',
      cuerpo:
        '<form class="sx2-form js-py2-form-nuevo" novalidate>' +
          campo('Nombre', '<input class="sx2-input" name="nombre" required maxlength="120" placeholder="Ej.: Estandarización del área comercial">') +
          campo('Descripción', '<textarea class="sx2-input" name="descripcion" maxlength="1000" placeholder="¿De qué se trata el proyecto?"></textarea>') +
          campo('Objetivo', '<textarea class="sx2-input" name="objetivo" maxlength="600" placeholder="¿Qué resultado esperan lograr?"></textarea>') +
          '<div class="sx2-form__fila">' +
            campo('Inicio', '<input class="sx2-input" type="date" name="fecha_inicio" required value="' + hoy + '">') +
            campo('Fecha objetivo', '<input class="sx2-input" type="date" name="fecha_objetivo" required>') +
          '</div>' +
          '<div class="sx2-form__fila">' +
            campo('Prioridad', '<select class="sx2-select" name="prioridad"><option value="P1">P1 · Crítica</option><option value="P2">P2 · Alta</option><option value="P3" selected>P3 · Media</option><option value="P4">P4 · Baja</option></select>') +
            campo('Plantilla', '<select class="sx2-select js-py2-plantillas" name="plantilla_id"><option value="">Sin plantilla</option></select>', 'Crea los hitos de la plantilla elegida.') +
          '</div>' +
          '<p class="sx2-campo__error js-py2-error" hidden></p>' +
        '</form>',
      pie: U.boton({ texto: 'Cancelar', clase: 'js-sx2-drawer-cerrar' }) +
        U.boton({ texto: 'Crear proyecto', icono: 'check', variante: 'primario', clase: 'js-py2-crear' })
    });

    PY.api('listarPlantillasProyecto', {}).then(function (r) {
      var sel = d.el.querySelector('.js-py2-plantillas');
      if (!sel || !r || !r.ok) return;
      (r.data || []).forEach(function (pl) {
        var op = document.createElement('option');
        op.value = pl.plantilla_id; op.textContent = pl.nombre;
        sel.appendChild(op);
      });
    });

    var form = d.el.querySelector('.js-py2-form-nuevo');
    var btn = d.el.querySelector('.js-py2-crear');
    var err = d.el.querySelector('.js-py2-error');
    function enviar(ev) {
      if (ev) ev.preventDefault();
      var fd = new FormData(form);
      var datos = {};
      fd.forEach(function (v, k) { datos[k] = String(v).trim(); });
      if (!datos.nombre || !datos.fecha_inicio || !datos.fecha_objetivo) {
        err.textContent = 'Completa nombre, inicio y fecha objetivo.'; err.hidden = false; return;
      }
      btn.disabled = true;
      PY.api('crearProyecto', datos).then(function (r) {
        btn.disabled = false;
        if (!r || !r.ok) { err.textContent = (r && r.message) || 'No se pudo crear el proyecto.'; err.hidden = false; return; }
        d.cerrar();
        PY.aviso('Proyecto creado.', 'exito');
        var id = r.data && (r.data.proyecto_id || (r.data.proyecto && r.data.proyecto.proyecto_id));
        if (id) PY.abrirProyecto(id); else PY.cargarPortafolio();
      });
    }
    form.addEventListener('submit', enviar);
    btn.addEventListener('click', enviar);
  }

  function campo(etiqueta, control, ayuda) {
    return '<label class="sx2-campo"><span class="sx2-campo__et">' + U.esc(etiqueta) + '</span>' + control +
      (ayuda ? '<span class="sx2-campo__ayuda">' + U.esc(ayuda) + '</span>' : '') + '</label>';
  }

  PY.cabeceraPortafolio = cabeceraPortafolio;
  PY.pintarPortafolio = pintarPortafolio;
  PY.alMontarPortafolio = alMontarPortafolio;
  PY.campo = campo;
})();
