/**
 * proyectos-v2/equipo.js — sección "Equipo": personas (con foto), su carga,
 * horas del equipo por día (Chart.js) y la Dedicación día a día como mapa de
 * calor de SOLO LECTURA. Reemplaza en v1: Equipo, Dedicación y Registro
 * diario.
 *
 * La dedicación ya no se edita en una grilla aparte (era la "segunda
 * puerta" que hacía que Tareas y Dedicación se contagiaran): una celda
 * muestra qué se registró ese día y lleva al panel de la tarea, donde se
 * actualiza con la acción única.
 *
 * Horas: mismo criterio que v1 (pintarWorkloadProyecto_) -- por tarea y día
 * manda el REGISTRO_DIA; si no hay, suman las horas de los check-in. Se
 * atribuyen al responsable de la tarea.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var DIAS_VENTANA = 14;
  var JORNADA_HORAS = 9; // mismo umbral de sobrecarga que v1 (WORKLOAD_JORNADA_HORAS_)
  var ROL = { LIDER: 'Líder', INTEGRANTE: 'Integrante', COLABORADOR: 'Colaborador', OBSERVADOR: 'Observador' };
  var ROL_TONO = { LIDER: 'hito', INTEGRANTE: 'primario', COLABORADOR: 'info', OBSERVADOR: 'neutro' };
  var grafico_ = null;

  var fmtDia = (function () {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: (window.SIGSO_CONFIG || {}).TIMEZONE || 'America/Santiago' }); } catch (e) { return null; }
  })();
  function claveDe(valor) {
    var d = new Date(valor);
    if (isNaN(d.getTime())) return '';
    return fmtDia ? fmtDia.format(d) : d.toISOString().slice(0, 10);
  }
  function sumarDias(clave, n) {
    var p = clave.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
  }

  // { dias: [clave...], porPersona: { email: { total, porDia: {clave: horas}, detalle: {clave: [{tarea, horas, estado, nota}]} } } }
  function horas(ctx) {
    var hoy = PY.hoyClave();
    var dias = [];
    for (var i = DIAS_VENTANA - 1; i >= 0; i--) dias.push(sumarDias(hoy, -i));
    var enVentana = {};
    dias.forEach(function (d) { enVentana[d] = true; });

    var tareas = {};
    ctx.tareas.forEach(function (a) { tareas[a.actividad_id] = a; });
    var registro = {}, checkin = {};
    ctx.bitacora.forEach(function (b) {
      if (!tareas[b.actividad_id]) return;
      if (b.tipo === 'REGISTRO_DIA' && b.dia && enVentana[b.dia]) {
        (registro[b.actividad_id] = registro[b.actividad_id] || {})[b.dia] = b;
      } else if (b.tipo !== 'REGISTRO_DIA' && b.horas) {
        var k = claveDe(b.timestamp);
        if (!enVentana[k]) return;
        var m = (checkin[b.actividad_id] = checkin[b.actividad_id] || {});
        m[k] = (m[k] || 0) + Number(b.horas);
      }
    });

    var porPersona = {};
    Object.keys(tareas).forEach(function (id) {
      var a = tareas[id];
      var email = String(a.responsable_email || '').toLowerCase();
      if (!email) return;
      dias.forEach(function (d) {
        var reg = registro[id] && registro[id][d];
        var h = reg ? (Number(reg.horas) || 0) : ((checkin[id] && checkin[id][d]) || 0);
        if (!reg && !h) return;
        var x = porPersona[email] || (porPersona[email] = { total: 0, porDia: {}, detalle: {} });
        x.total += h;
        x.porDia[d] = (x.porDia[d] || 0) + h;
        (x.detalle[d] = x.detalle[d] || []).push({ tarea: a, horas: h, estado: reg ? reg.estado_dia : '', nota: reg ? reg.nota : '' });
      });
    });
    return { dias: dias, porPersona: porPersona };
  }

  // Integrantes + responsables que no son integrantes (tareas heredadas).
  function personas(ctx) {
    var mapa = {};
    (ctx.detalle.integrantes || []).forEach(function (i) {
      var e = String(i.usuario_email || '').toLowerCase();
      mapa[e] = { email: e, nombre: i.usuario_nombre, rol: i.rol_proyecto, responsabilidad: i.responsabilidad, integranteId: i.integrante_id, abiertas: 0, hechas: 0, atrasadas: 0 };
    });
    ctx.tareas.forEach(function (a) {
      var e = String(a.responsable_email || '').toLowerCase();
      if (!e || a.estado === 'CANCELADA') return;
      var x = mapa[e] || (mapa[e] = { email: e, nombre: a.responsable_nombre, rol: '', abiertas: 0, hechas: 0, atrasadas: 0 });
      if (a.estado === 'TERMINADA') x.hechas++;
      else { x.abiertas++; if (a.semaforo === 'atrasada') x.atrasadas++; }
    });
    return Object.keys(mapa).map(function (k) {
      var x = mapa[k];
      var p = PY.persona(x.email, x.nombre);
      x.nombre = p.nombre; x.cargo = p.cargo;
      return x;
    });
  }

  function tarjetaPersona(x, h, maxAbiertas, gestiona, i) {
    var pct = maxAbiertas ? Math.round(x.abiertas / maxAbiertas * 100) : 0;
    var tono = pct >= 85 ? 'critico' : (pct >= 60 ? 'alerta' : 'primario');
    var horas14 = h ? Math.round(h.total * 10) / 10 : 0;
    return '<article class="sx2-card sx2-card--interactiva sx2-py-persona sx2-entra" style="--i:' + Math.min(i, 12) + '" data-py2-persona="' + U.esc(x.email) + '" tabindex="0">' +
      '<div class="sx2-py-persona__cab">' + U.avatar(x, 'xl') +
        '<div class="sx2-apilado" style="gap:4px;min-width:0;flex:1">' +
          '<strong class="sx2-cortar sx2-py-persona__nombre">' + U.esc(x.nombre) + '</strong>' +
          (x.cargo ? '<span class="sx2-tenue sx2-cortar" style="font-size:.8125rem">' + U.esc(x.cargo) + '</span>' : '') +
          '<span class="sx2-flex">' + (x.rol ? U.badge(ROL[x.rol] || x.rol, ROL_TONO[x.rol] || 'neutro', true) : U.badge('Fuera del equipo', 'neutro', true)) + '</span>' +
        '</div>' +
        (gestiona && x.integranteId ? U.boton({ soloIcono: true, icono: 'equis', sm: true, variante: 'fantasma', titulo: 'Quitar del equipo', clase: 'js-py2e-quitar', datos: { id: x.integranteId, nombre: x.nombre } }) : '') +
      '</div>' +
      (x.responsabilidad ? '<p class="sx2-tenue sx2-py-persona__resp">' + U.esc(x.responsabilidad) + '</p>' : '') +
      '<div class="sx2-py-persona__cifras">' +
        '<span><strong>' + x.abiertas + '</strong>abiertas</span>' +
        '<span><strong>' + x.hechas + '</strong>hechas</span>' +
        '<span class="' + (x.atrasadas ? 'sx2-delta--mal' : '') + '"><strong>' + x.atrasadas + '</strong>atrasadas</span>' +
        '<span><strong>' + horas14 + '</strong>h · 14 d</span>' +
      '</div>' +
      '<div><div class="sx2-entre sx2-tenue" style="font-size:.75rem;margin-bottom:4px"><span>Carga relativa</span><span>' + pct + '%</span></div>' + U.barra(pct, tono) + '</div>' +
    '</article>';
  }

  var DIA_LETRA = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
  function mapaCalor(gente, h) {
    var hoy = PY.hoyClave();
    var cab = h.dias.map(function (d) {
      var dt = new Date(d + 'T12:00:00Z');
      var finde = dt.getUTCDay() === 0 || dt.getUTCDay() === 6;
      return '<span class="sx2-py-calor__dia' + (finde ? ' sx2-py-calor__dia--finde' : '') + (d === hoy ? ' sx2-py-calor__dia--hoy' : '') + '">' +
        '<b>' + DIA_LETRA[dt.getUTCDay()] + '</b>' + d.slice(8) + '</span>';
    }).join('');
    if (!Object.keys(h.porPersona).length) {
      return U.vacio({ icono: 'reloj', titulo: 'Sin horas registradas en 14 días', texto: 'Cuando alguien actualice una tarea con las horas del día, aparecerá aquí.' });
    }
    // Todo el equipo, no solo quien registró: una fila vacía también informa.
    var vacia = { total: 0, porDia: {}, detalle: {} };
    var filas = gente.slice().sort(function (a, b) {
      return (h.porPersona[b.email] || vacia).total - (h.porPersona[a.email] || vacia).total || String(a.nombre).localeCompare(String(b.nombre), 'es');
    });
    return '<div class="sx2-py-calor" style="--dias:' + h.dias.length + '">' +
      '<div class="sx2-py-calor__fila sx2-py-calor__fila--cab"><span></span>' + cab + '<span class="sx2-py-calor__total">Total</span></div>' +
      filas.map(function (x) {
        var hp = h.porPersona[x.email] || vacia;
        return '<div class="sx2-py-calor__fila">' +
          '<span class="sx2-py-calor__persona">' + U.avatar(x, 'xs') + '<span class="sx2-cortar">' + U.esc(x.nombre) + '</span></span>' +
          h.dias.map(function (d) {
            var v = hp.porDia[d] || 0;
            var nivel = !hp.detalle[d] ? 0 : (v > JORNADA_HORAS ? 5 : (v > 6 ? 4 : (v > 3 ? 3 : (v > 0 ? 2 : 1))));
            return '<button type="button" class="sx2-py-calor__celda sx2-py-calor__celda--' + nivel + '"' +
              (hp.detalle[d] ? ' data-py2-celda="' + U.esc(x.email) + '|' + d + '"' : ' disabled') +
              ' title="' + U.esc(x.nombre + ' · ' + PY.fecha(d) + (hp.detalle[d] ? ' · ' + (Math.round(v * 10) / 10) + ' h' : ' · sin registro')) + '">' +
              (v ? (Math.round(v * 10) / 10) : '') + '</button>';
          }).join('') +
          '<span class="sx2-py-calor__total">' + (Math.round(hp.total * 10) / 10) + ' h</span>' +
        '</div>';
      }).join('') +
    '</div>' +
    '<div class="sx2-py-calor__leyenda"><span>Menos</span>' + [1, 2, 3, 4].map(function (n) { return '<i class="sx2-py-calor__celda--' + n + '"></i>'; }).join('') +
      '<span>Más</span><i class="sx2-py-calor__celda--5"></i><span>Más de ' + JORNADA_HORAS + ' h (sobrecarga)</span></div>';
  }

  function pintar(ctx) {
    var gente = personas(ctx);
    var h = horas(ctx);
    var gestiona = !!ctx.detalle.puede_gestionar;
    var maxAb = Math.max.apply(null, gente.map(function (x) { return x.abiertas; }).concat([1]));
    var totalHoras = Object.keys(h.porPersona).reduce(function (s, k) { return s + h.porPersona[k].total; }, 0);
    var sobrecargas = 0;
    Object.keys(h.porPersona).forEach(function (k) {
      Object.keys(h.porPersona[k].porDia).forEach(function (d) { if (h.porPersona[k].porDia[d] > JORNADA_HORAS) sobrecargas++; });
    });
    var activas = Object.keys(h.porPersona).length;

    var kpis = '<div class="sx2-fila-kpis">' +
      U.kpi({ i: 0, icono: 'equipo', tono: 'primario', etiqueta: 'Personas', valor: gente.length, unidad: (ctx.detalle.integrantes || []).length + ' en el equipo' }) +
      U.kpi({ i: 1, icono: 'tareas', tono: 'info', etiqueta: 'Tareas abiertas', valor: gente.reduce(function (s, x) { return s + x.abiertas; }, 0), unidad: 'asignadas' }) +
      U.kpi({ i: 2, icono: 'reloj', tono: 'ok', etiqueta: 'Horas (14 días)', valor: Math.round(totalHoras * 10) / 10, unidad: activas + (activas === 1 ? ' persona registró' : ' personas registraron') }) +
      U.kpi({ i: 3, icono: 'alerta', tono: 'critico', etiqueta: 'Atrasadas', valor: gente.reduce(function (s, x) { return s + x.atrasadas; }, 0), unidad: 'del equipo' }) +
      U.kpi({ i: 4, icono: 'rayo', tono: sobrecargas ? 'alerta' : 'neutro', etiqueta: 'Días con sobrecarga', valor: sobrecargas, unidad: 'más de ' + JORNADA_HORAS + ' h' }) +
    '</div>';

    var tarjetas = gente.slice().sort(function (a, b) { return b.abiertas - a.abiertas || String(a.nombre).localeCompare(String(b.nombre), 'es'); })
      .map(function (x, i) { return tarjetaPersona(x, h.porPersona[x.email], maxAb, gestiona, i); }).join('');

    return kpis +
      '<div class="sx2-entre sx2-entra" style="--i:2"><h2 class="sx2-card__titulo">' + U.ico('equipo', 18) + 'Personas</h2>' +
        (gestiona ? U.boton({ texto: 'Agregar integrante', icono: 'nueva', variante: 'primario', clase: 'js-py2e-agregar' }) : '') + '</div>' +
      '<div class="sx2-py-personas">' + tarjetas + '</div>' +
      '<div class="sx2-grid sx2-grid--estira">' +
        '<div class="sx2-col-8">' + U.card({ titulo: 'Dedicación día a día', icono: 'calendario', sub: 'últimos ' + DIAS_VENTANA + ' días · clic en un día para ver el detalle', i: 3, cuerpo: mapaCalor(gente, h) }) + '</div>' +
        '<div class="sx2-col-4">' + U.card({ titulo: 'Horas del equipo por día', icono: 'grafico', i: 4,
          cuerpo: totalHoras ? '<div class="sx2-py-grafico sx2-py-grafico--alto"><canvas id="py2-grafico-horas" role="img" aria-label="Horas registradas por día y persona"></canvas></div>' : U.vacio({ icono: 'grafico', texto: 'Sin horas en el período.' }) }) + '</div>' +
      '</div>';
  }

  function colorVar(nombre, raiz) { return getComputedStyle(raiz).getPropertyValue(nombre).trim() || '#888'; }

  function dibujarGrafico(raiz, ctx) {
    if (grafico_) { grafico_.destroy(); grafico_ = null; }
    var canvas = raiz.querySelector('#py2-grafico-horas');
    if (!canvas || !window.Chart) return;
    var h = horas(ctx);
    var gente = personas(ctx).filter(function (x) { return h.porPersona[x.email]; })
      .sort(function (a, b) { return h.porPersona[b.email].total - h.porPersona[a.email].total; });
    var paleta = ['--sx-primario', '--sx-hito', '--sx-ok', '--sx-alerta', '--sx-info', '--sx-critico'].map(function (v) { return colorVar(v, raiz); });
    var top = gente.slice(0, 5);
    var otros = gente.slice(5);
    var datasets = top.map(function (x, i) {
      return { label: x.nombre, data: h.dias.map(function (d) { return Math.round((h.porPersona[x.email].porDia[d] || 0) * 10) / 10; }), backgroundColor: paleta[i], borderRadius: 4, maxBarThickness: 18 };
    });
    if (otros.length) {
      datasets.push({ label: 'Otros', backgroundColor: colorVar('--sx-neutro', raiz), borderRadius: 4, maxBarThickness: 18,
        data: h.dias.map(function (d) { return otros.reduce(function (s, x) { return s + (h.porPersona[x.email].porDia[d] || 0); }, 0); }) });
    }
    var texto3 = colorVar('--sx-texto-3', raiz), borde = colorVar('--sx-borde-suave', raiz);
    grafico_ = new Chart(canvas, {
      type: 'bar',
      data: { labels: h.dias.map(function (d) { return d.slice(8) + '/' + d.slice(5, 7); }), datasets: datasets },
      options: {
        maintainAspectRatio: false,
        animation: U.reducirMovimiento() ? false : { duration: 700 },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: texto3, font: { size: 10 }, maxRotation: 0, autoSkip: true } },
          y: { stacked: true, beginAtZero: true, grid: { color: borde }, ticks: { color: texto3, font: { size: 10 } }, title: { display: true, text: 'horas', color: texto3, font: { size: 10 } } }
        },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, color: colorVar('--sx-texto-2', raiz), font: { size: 11 } } } }
      }
    });
  }

  // Detalle de una celda: qué registró esa persona ese día, tarea por tarea.
  function abrirDia(ctx, email, dia) {
    var h = horas(ctx);
    var items = (h.porPersona[email] && h.porPersona[email].detalle[dia]) || [];
    var p = personas(ctx).filter(function (x) { return x.email === email; })[0] || PY.persona(email);
    var d = U.drawer({
      titulo: PY.fecha(dia, true),
      subtitulo: U.persona(p, 'sm'),
      cuerpo: items.length ? '<ul class="sx2-lista">' + items.map(function (it) {
        return '<li class="sx2-py-dia-item" data-py2-tarea="' + U.esc(it.tarea.actividad_id) + '" tabindex="0">' +
          '<span class="sx2-apilado" style="gap:2px;flex:1;min-width:0"><strong class="sx2-cortar">' + U.esc(it.tarea.titulo) + '</strong>' +
            (it.nota ? '<span class="sx2-tenue" style="font-size:.78rem">' + U.esc(it.nota) + '</span>' : '') + '</span>' +
          '<span class="sx2-flex">' + (it.estado ? U.badge(it.estado.replace(/_/g, ' '), 'neutro', true) : '') + '<strong>' + (Math.round(it.horas * 10) / 10) + ' h</strong></span>' +
        '</li>';
      }).join('') + '</ul>' : U.vacio({ icono: 'reloj', texto: 'Sin registros.' }),
      pie: '<span class="sx2-tenue" style="font-size:.8125rem;flex:1;align-self:center">Clic en una tarea para abrirla y corregir ese día.</span>'
    });
    d.el.addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-py2-tarea]');
      if (!t) return;
      d.cerrar(true);
      PY.abrirTarea(t.getAttribute('data-py2-tarea'), { actualizar: true, dia: dia });
    });
  }

  function abrirAgregar(ctx) {
    var d = U.drawer({
      titulo: 'Agregar integrante',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(ctx.proyecto.nombre) + '</span>',
      cuerpo: '<form class="sx2-form js-py2e-form" novalidate>' +
        PY.campo('Correo', '<input class="sx2-input" type="email" name="usuario_email" required placeholder="nombre@empresa.cl">') +
        PY.campo('Nombre', '<input class="sx2-input" name="usuario_nombre" placeholder="Opcional: se completa con el directorio">') +
        PY.campo('Rol en el proyecto', '<select class="sx2-select" name="rol_proyecto">' + Object.keys(ROL).map(function (r) {
          return '<option value="' + r + '"' + (r === 'INTEGRANTE' ? ' selected' : '') + '>' + ROL[r] + '</option>';
        }).join('') + '</select>') +
        PY.campo('Responsabilidad', '<input class="sx2-input" name="responsabilidad" maxlength="160" placeholder="Opcional: qué le toca en el proyecto">') +
        '<p class="sx2-campo__error js-py2e-error" hidden></p>' +
      '</form>',
      pie: U.boton({ texto: 'Cancelar', clase: 'js-sx2-drawer-cerrar' }) + U.boton({ texto: 'Agregar', icono: 'check', variante: 'primario', clase: 'js-py2e-guardar' })
    });
    var form = d.el.querySelector('form'), btn = d.el.querySelector('.js-py2e-guardar'), err = d.el.querySelector('.js-py2e-error');
    function enviar(ev) {
      if (ev) ev.preventDefault();
      var datos = { proyecto_id: ctx.proyecto.proyecto_id };
      new FormData(form).forEach(function (v, k) { datos[k] = String(v).trim(); });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(datos.usuario_email)) { err.textContent = 'Escribe un correo válido.'; err.hidden = false; return; }
      btn.disabled = true;
      PY.api('gestionarIntegranteProyecto', datos).then(function (r) {
        btn.disabled = false;
        if (!r || !r.ok) { err.textContent = (r && r.message) || 'No se pudo agregar.'; err.hidden = false; return; }
        d.cerrar();
        PY.aviso('Integrante agregado.', 'exito');
        PY.recargarProyecto();
      });
    }
    form.addEventListener('submit', enviar);
    btn.addEventListener('click', enviar);
  }

  function quitar(ctx, id, nombre) {
    if (!window.confirm('¿Quitar a ' + nombre + ' del equipo? Sus tareas no se borran.')) return;
    PY.api('gestionarIntegranteProyecto', { proyecto_id: ctx.proyecto.proyecto_id, accion: 'quitar', integrante_id: id }).then(function (r) {
      if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo quitar.', 'error'); return; }
      PY.aviso(nombre + ' ya no está en el equipo.', 'exito');
      PY.recargarProyecto();
    });
  }

  function alMontar(raiz, ctx) {
    dibujarGrafico(raiz, ctx);
    // En pantallas angostas el mapa desborda: que abra mostrando hoy, no hace 14 días.
    var calor = raiz.querySelector('.sx2-py-calor');
    if (calor) calor.scrollLeft = calor.scrollWidth;
    raiz.addEventListener('click', function (ev) {
      var t = ev.target;
      var q = t.closest('.js-py2e-quitar');
      if (q) { ev.stopPropagation(); quitar(ctx, q.getAttribute('data-id'), q.getAttribute('data-nombre')); return; }
      if (t.closest('.js-py2e-agregar')) { abrirAgregar(ctx); return; }
      var c = t.closest('[data-py2-celda]');
      if (c) { var p = c.getAttribute('data-py2-celda').split('|'); abrirDia(ctx, p[0], p[1]); return; }
      var per = t.closest('[data-py2-persona]');
      if (per) { PY.responsableTrabajo = per.getAttribute('data-py2-persona'); PY.modoTrabajo = 'tabla'; PY.filtroTrabajo = 'todas'; PY.irSeccion('trabajo'); }
    });
    raiz.addEventListener('keydown', function (ev) {
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[data-py2-persona]')) {
        ev.preventDefault();
        ev.target.click();
      }
    });
  }

  PY.secciones.equipo = { pintar: pintar, alMontar: alMontar };
})();
