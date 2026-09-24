/**
 * proyectos-v2/calendario.js — vista de módulo "Calendario": el mes con las
 * fechas comprometidas de tareas, hitos y entregables de todos los proyectos
 * visibles (backend listarCalendarioProyectos). Reemplaza el Calendario de v1.
 *
 * Mes a pantalla completa con el título de cada ítem dentro del día (no solo
 * puntos) + agenda lateral del día elegido o de los próximos 7 días. Filtros
 * en el cliente (proyecto, tipo, "solo lo mío"), como v1: son pocos ítems.
 * Una tarea abre su panel sin salir del calendario; un hito o entregable
 * abre su proyecto en la sección donde vive.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  var DIAS_SEM = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  var TIPO = {
    tarea: { texto: 'Tareas', icono: 'tareas' },
    hito: { texto: 'Hitos', icono: 'bandera' },
    entregable: { texto: 'Entregables', icono: 'documento' }
  };
  var POR_CELDA = 3;
  var f = { anio: null, mes: null, proyecto: '', soloMio: false, tipos: { tarea: true, hito: true, entregable: true }, dia: '' };

  function clave(v) {
    var d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function k(anio, mes, dia) {
    var d = new Date(Date.UTC(anio, mes, dia));
    return d.toISOString().slice(0, 10);
  }

  function tono(it, hoy) {
    var vencido = clave(it.fecha) < hoy;
    if (it.tipo === 'tarea') return PY.TONO_SEMAFORO[it.semaforo] || 'info';
    if (it.tipo === 'hito') {
      if (it.estado === 'COMPLETADO') return 'ok';
      if (it.estado === 'CANCELADO') return 'neutro';
      return vencido ? 'critico' : 'hito';
    }
    if (it.estado === 'OBSERVADO') return 'alerta';
    return vencido ? 'critico' : 'primario';
  }

  function cargar() {
    return PY.api('listarCalendarioProyectos', {}).then(function (r) {
      if (!r || !r.ok) return { items: [], proyectos: [], error: (r && r.message) || 'No se pudo cargar el calendario.' };
      return { items: r.data.items || [], proyectos: r.data.proyectos || [], error: '' };
    });
  }

  function filtrados(d) {
    var yo = PY.miEmail();
    return d.items.filter(function (it) {
      if (!f.tipos[it.tipo]) return false;
      if (f.proyecto && it.proyecto_id !== f.proyecto) return false;
      if (f.soloMio && String(it.responsable_email || '').toLowerCase() !== yo) return false;
      return true;
    });
  }

  function pill(it, hoy) {
    var t = TIPO[it.tipo] || TIPO.tarea;
    return '<button type="button" class="sx2-py-cal-pill sx2-tono-' + tono(it, hoy) + '" data-py2c-item="' + U.esc(it._i) + '" title="' + U.esc(t.texto.slice(0, -1) + ': ' + it.titulo + ' · ' + it.proyecto_nombre) + '">' +
      U.ico(t.icono, 11) + '<span class="sx2-cortar">' + U.esc(it.titulo) + '</span></button>';
  }

  function agendaItem(it, hoy, conFecha) {
    var t = TIPO[it.tipo] || TIPO.tarea;
    var tn = tono(it, hoy);
    var resp = it.responsable_email ? PY.persona(it.responsable_email) : null;
    return '<li><button type="button" class="sx2-py-cal-agenda__item sx2-tono-' + tn + '" data-py2c-item="' + U.esc(it._i) + '">' +
      '<span class="sx2-py-cal-agenda__ico">' + U.ico(t.icono, 14) + '</span>' +
      '<span class="sx2-apilado" style="gap:2px;min-width:0;flex:1">' +
        '<strong class="sx2-cortar">' + U.esc(it.titulo) + '</strong>' +
        '<span class="sx2-tenue sx2-cortar" style="font-size:.75rem">' + (conFecha ? PY.fecha(it.fecha) + ' · ' : '') + U.esc(it.proyecto_nombre) + '</span>' +
      '</span>' +
      (resp ? U.avatar(resp, 'xs') : '') +
    '</button></li>';
  }

  function pintar(d) {
    var hoy = PY.hoyClave();
    if (f.anio === null) { f.anio = Number(hoy.slice(0, 4)); f.mes = Number(hoy.slice(5, 7)) - 1; }
    d.items.forEach(function (it, i) { it._i = i; });
    var items = filtrados(d);
    var porDia = {};
    items.forEach(function (it) { var c = clave(it.fecha); if (c) (porDia[c] = porDia[c] || []).push(it); });

    var cuenta = { tarea: 0, hito: 0, entregable: 0 };
    d.items.forEach(function (it) { if ((!f.proyecto || it.proyecto_id === f.proyecto)) cuenta[it.tipo] = (cuenta[it.tipo] || 0) + 1; });

    var cabecera = '<header class="sx2-cabecera sx2-entra">' +
      '<div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Proyectos</span>' +
        '<h1>Calendario</h1><span class="sx2-tenue" style="font-size:.875rem">Fechas comprometidas de tareas, hitos y entregables de tus proyectos.</span></div>' +
      '<div class="sx2-cabecera__acciones sx2-py-cal-nav">' +
        U.boton({ soloIcono: true, icono: 'izquierda', titulo: 'Mes anterior', clase: 'js-py2c-mes', datos: { d: -1 } }) +
        '<strong class="sx2-py-cal-nav__mes">' + MESES[f.mes] + ' ' + f.anio + '</strong>' +
        U.boton({ soloIcono: true, icono: 'derecha', titulo: 'Mes siguiente', clase: 'js-py2c-mes', datos: { d: 1 } }) +
        U.boton({ texto: 'Hoy', icono: 'calendario', clase: 'js-py2c-hoy' }) +
      '</div>' +
    '</header>';

    if (d.error) return cabecera + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: d.error }) });

    var filtros = '<div class="sx2-card sx2-py-herramientas sx2-entra" style="--i:1"><div class="sx2-barra-filtros">' +
      '<select class="sx2-select js-py2c-proyecto" aria-label="Proyecto"><option value="">Todos los proyectos</option>' + d.proyectos.map(function (p) {
        return '<option value="' + U.esc(p.proyecto_id) + '"' + (p.proyecto_id === f.proyecto ? ' selected' : '') + '>' + U.esc(p.nombre) + '</option>';
      }).join('') + '</select>' +
      '<span class="sx2-chips">' + Object.keys(TIPO).map(function (t) {
        return U.chip({ texto: TIPO[t].texto, icono: TIPO[t].icono, activo: f.tipos[t], n: cuenta[t] || 0, clase: 'js-py2c-tipo', datos: { t: t } });
      }).join('') + U.chip({ texto: 'Solo lo mío', icono: 'persona', activo: f.soloMio, clase: 'js-py2c-mio' }) + '</span>' +
    '</div></div>';

    // Rejilla de 6 semanas que empieza el lunes anterior al día 1.
    var primero = new Date(Date.UTC(f.anio, f.mes, 1));
    var desfase = (primero.getUTCDay() + 6) % 7;
    var celdas = '';
    for (var i = 0; i < 42; i++) {
      var dia = new Date(Date.UTC(f.anio, f.mes, 1 - desfase + i));
      var c = dia.toISOString().slice(0, 10);
      var delMes = dia.getUTCMonth() === f.mes;
      if (i === 35 && !delMes) break; // si la 6.ª semana es toda del mes siguiente, no se dibuja
      var its = porDia[c] || [];
      var w = dia.getUTCDay();
      celdas += '<div class="sx2-py-cal-celda' + (delMes ? '' : ' sx2-py-cal-celda--fuera') + (w === 0 || w === 6 ? ' sx2-py-cal-celda--finde' : '') +
          (c === hoy ? ' sx2-py-cal-celda--hoy' : '') + (c === f.dia ? ' sx2-py-cal-celda--sel' : '') + '" data-py2c-dia="' + c + '">' +
        '<span class="sx2-py-cal-celda__num">' + dia.getUTCDate() + '</span>' +
        '<div class="sx2-py-cal-celda__items">' + its.slice(0, POR_CELDA).map(function (it) { return pill(it, hoy); }).join('') +
          (its.length > POR_CELDA ? '<span class="sx2-py-cal-mas">+' + (its.length - POR_CELDA) + ' más</span>' : '') + '</div>' +
        (its.length ? '<span class="sx2-py-cal-puntos">' + its.slice(0, 4).map(function (it) { return '<i class="sx2-tono-' + tono(it, hoy) + '"></i>'; }).join('') + '</span>' : '') +
      '</div>';
    }
    var mes = '<section class="sx2-card sx2-card--sin-relleno sx2-py-cal sx2-entra" style="--i:2">' +
      '<div class="sx2-py-cal__cab">' + DIAS_SEM.map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</div>' +
      '<div class="sx2-py-cal__rejilla">' + celdas + '</div>' +
    '</section>';

    // Agenda: el día elegido o, si no hay, lo que viene en 7 días + lo vencido.
    var agenda;
    if (f.dia) {
      var delDia = porDia[f.dia] || [];
      agenda = U.card({ titulo: PY.fecha(f.dia, true), icono: 'calendario', sub: delDia.length + (delDia.length === 1 ? ' ítem' : ' ítems'), i: 3,
        accion: { texto: 'Semana', clase: 'js-py2c-sin-dia' },
        cuerpo: delDia.length ? '<ul class="sx2-py-cal-agenda">' + delDia.map(function (it) { return agendaItem(it, hoy, false); }).join('') + '</ul>' : U.vacio({ icono: 'check', texto: 'Nada para este día.' }) });
    } else {
      var limite = k(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)) - 1, Number(hoy.slice(8, 10)) + 7);
      var prox = items.filter(function (it) { var c = clave(it.fecha); return c >= hoy && c <= limite; })
        .sort(function (a, b) { return clave(a.fecha).localeCompare(clave(b.fecha)); });
      var vencidos = items.filter(function (it) { return clave(it.fecha) < hoy && tono(it, hoy) === 'critico'; });
      agenda = U.card({ titulo: 'Próximos 7 días', icono: 'reloj', sub: String(prox.length), i: 3,
        cuerpo: (prox.length ? '<ul class="sx2-py-cal-agenda">' + prox.map(function (it) { return agendaItem(it, hoy, true); }).join('') + '</ul>' : U.vacio({ icono: 'check', texto: 'Nada vence en los próximos 7 días.' })) +
          (vencidos.length ? '<div class="sx2-py-aviso sx2-tono-critico" style="margin-top:12px">' + U.ico('alerta', 16) + '<span>' + vencidos.length + (vencidos.length === 1 ? ' ítem vencido' : ' ítems vencidos') + ' sin cerrar en estos filtros.</span></div>' : '') });
    }

    var leyenda = '<div class="sx2-py-leyenda-gantt sx2-entra" style="--i:4">' +
      [['info', 'En plazo'], ['alerta', 'En riesgo / observado'], ['critico', 'Atrasado / vencido'], ['ok', 'Completado'], ['hito', 'Hito']].map(function (x) {
        return '<span><i class="sx2-py-cal-ley sx2-tono-' + x[0] + '"></i>' + x[1] + '</span>';
      }).join('') + '</div>';

    return cabecera + filtros +
      '<div class="sx2-grid sx2-grid--estira">' +
        '<div class="sx2-col-9">' + mes + leyenda + '</div>' +
        '<div class="sx2-col-3 sx2-col--apila">' + agenda + '</div>' +
      '</div>';
  }

  function abrirItem(it) {
    if (!it) return;
    if (it.tipo === 'tarea' && it.actividad_id) {
      PY.abrirTareaDeProyecto(it.proyecto_id, it.actividad_id, { alGuardar: PY.recargarVista });
      return;
    }
    if (it.tipo === 'hito') PY.subSeguimiento = 'hitos';
    PY.abrirProyecto(it.proyecto_id, { seccion: it.tipo === 'hito' ? 'seguimiento' : (it.tipo === 'entregable' ? 'archivos' : 'trabajo') });
  }

  function alMontar(raiz, d) {
    var sel = raiz.querySelector('.js-py2c-proyecto');
    if (sel) sel.addEventListener('change', function () { f.proyecto = sel.value; PY.pintar({ sinAnimacion: true }); });
    raiz.addEventListener('click', function (ev) {
      var t = ev.target, b;
      if ((b = t.closest('.js-py2c-mes'))) {
        f.mes += Number(b.getAttribute('data-d'));
        if (f.mes < 0) { f.mes = 11; f.anio--; } else if (f.mes > 11) { f.mes = 0; f.anio++; }
        f.dia = '';
        PY.pintar({ sinAnimacion: true });
        return;
      }
      if (t.closest('.js-py2c-hoy')) {
        var hoy = PY.hoyClave();
        f.anio = Number(hoy.slice(0, 4)); f.mes = Number(hoy.slice(5, 7)) - 1; f.dia = hoy;
        PY.pintar({ sinAnimacion: true });
        return;
      }
      if ((b = t.closest('.js-py2c-tipo'))) { var tp = b.getAttribute('data-t'); f.tipos[tp] = !f.tipos[tp]; PY.pintar({ sinAnimacion: true }); return; }
      if (t.closest('.js-py2c-mio')) { f.soloMio = !f.soloMio; PY.pintar({ sinAnimacion: true }); return; }
      if (t.closest('.js-py2c-sin-dia')) { f.dia = ''; PY.pintar({ sinAnimacion: true }); return; }
      if ((b = t.closest('[data-py2c-item]'))) { ev.stopPropagation(); abrirItem(d.items[Number(b.getAttribute('data-py2c-item'))]); return; }
      if ((b = t.closest('[data-py2c-dia]'))) {
        var dia = b.getAttribute('data-py2c-dia');
        f.dia = f.dia === dia ? '' : dia;
        // Un día de otro mes lleva a ese mes.
        var m = Number(dia.slice(5, 7)) - 1;
        if (m !== f.mes) { f.mes = m; f.anio = Number(dia.slice(0, 4)); }
        PY.pintar({ sinAnimacion: true });
      }
    });
  }

  PY.vistas.calendario = {
    cargar: cargar, pintar: pintar, alMontar: alMontar,
    correos: function (d) { return d.items.map(function (it) { return it.responsable_email; }); }
  };
})();
