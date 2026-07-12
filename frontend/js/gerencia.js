/**
 * gerencia.js — v2.1 (Fase C, documentacion/SIGSO-v2.1-plazos-y-control.md
 * §7): Panel de Control de Gerencia. Consume Gerencia.getPanel (Backoffice)
 * -- ya trae el semaforo calculado (Cumplimiento.gs, Fase B) por item, este
 * archivo solo agrupa/dibuja. Drill-down reutiliza SigsoDetalle/SigsoApp
 * (mismo detalle que ya usa Leo, ahora con el historial de compromiso
 * visible, ver detalle.js).
 */
(function () {
  window.SigsoGerencia = { cargar: cargarGerencia_, inicializarFiltros: inicializarFiltrosGerencia_ };

  var itemsActuales = [];
  var categoriaActiva = null;

  var CATEGORIAS = [
    { codigo: 'ATRASADA_DESARROLLADOR', emoji: '🔴', etiqueta: 'Atrasadas (desarrollador)' },
    { codigo: 'EN_RIESGO', emoji: '🟡', etiqueta: 'En riesgo' },
    { codigo: 'ESPERANDO_VALIDACION', emoji: '🔵', etiqueta: 'Esperando validación' },
    { codigo: 'EN_PLAZO', emoji: '🟢', etiqueta: 'En plazo' },
    { codigo: 'SIN_COMPROMISO', emoji: '⚪', etiqueta: 'Sin comprometer' },
    { codigo: 'CERRADA_A_TIEMPO', emoji: '✅', etiqueta: 'Cerradas a tiempo' },
    { codigo: 'CERRADA_CON_ATRASO', emoji: '❌', etiqueta: 'Cerradas con atraso' }
  ];

  // v3.0 (Fase 4, §6.1): orden actual del tablero -- se conserva entre
  // renders (filtro nuevo, cambio de categoria, etc.) para no perder el
  // criterio que el gerente ya eligio.
  var ordenTablero = { campo: 'fecha_creacion', direccion: 'desc' };

  var COLUMNAS_TABLERO = [
    { campo: 'solicitud_id', etiqueta: 'Solicitud' },
    { campo: 'solicitante_nombre', etiqueta: 'Solicitante' },
    { campo: 'desarrollador_asignado', etiqueta: 'Responsable' },
    { campo: 'estado', etiqueta: 'Estado' },
    { campo: 'prioridad', etiqueta: 'Prioridad' },
    { campo: 'dias_abierta', etiqueta: 'Días abierta' },
    { campo: 'dias_desarrollador', etiqueta: 'Días con el desarrollador' },
    { campo: 'dias_esperando_solicitante', etiqueta: 'Días esperando al solicitante' },
    { campo: 'fecha_comprometida', etiqueta: 'Fecha comprometida' },
    { campo: 'semaforo', etiqueta: 'Semáforo' }
  ];

  function inicializarFiltrosGerencia_() {
    var selectEmpresa = document.getElementById('ger-filtro-empresa');
    if (selectEmpresa.options.length <= 1) {
      ['HP', 'RLD'].forEach(function (id) {
        var opcion = document.createElement('option');
        opcion.value = id;
        opcion.textContent = id;
        selectEmpresa.appendChild(opcion);
      });
    }
    document.getElementById('ger-filtro-tipo').addEventListener('input', renderTodo_);
    document.getElementById('ger-agrupar').addEventListener('change', renderTodo_);
    document.getElementById('btn-imprimir-gerencia').addEventListener('click', function () {
      document.getElementById('ger-fecha-reporte').textContent =
        'Reporte generado el ' + new Date().toLocaleString('es-CL');
      window.print();
    });
    document.querySelectorAll('[data-ger-tab]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        document.querySelectorAll('[data-ger-tab]').forEach(function (b) {
          b.classList.remove('sigso-tabs__boton--activo');
        });
        boton.classList.add('sigso-tabs__boton--activo');
        var tab = boton.getAttribute('data-ger-tab');
        document.getElementById('ger-panel-tablero').classList.toggle('sigso-oculto', tab !== 'tablero');
        document.getElementById('ger-panel-gantt').classList.toggle('sigso-oculto', tab !== 'gantt');
      });
    });
  }

  function leerFiltrosServidor_() {
    return {
      empresa_id: document.getElementById('ger-filtro-empresa').value,
      desarrollador: document.getElementById('ger-filtro-desarrollador').value.trim(),
      solicitante: document.getElementById('ger-filtro-solicitante').value.trim()
    };
  }

  function cargarGerencia_() {
    categoriaActiva = null;
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'getPanelGerencia', leerFiltrosServidor_())
      .then(function (respuesta) {
        if (!respuesta.ok) {
          document.getElementById('ger-contenedor-kpis').innerHTML =
            Componentes.alerta(respuesta.message || 'No se pudo cargar el panel.', 'error');
          return respuesta;
        }
        itemsActuales = respuesta.data.items;
        renderKpis_(respuesta.data.kpis);
        renderTodo_();
        return respuesta;
      });
  }

  function renderKpis_(kpis) {
    document.getElementById('ger-contenedor-kpis').innerHTML =
      Componentes.kpi({
        valor: kpis.pct_cumplimiento_desarrollador === null ? '—' : kpis.pct_cumplimiento_desarrollador + '%',
        etiqueta: 'Cumplimiento del desarrollador',
        titulo: 'Entregadas a tiempo ÷ entregadas (fecha comprometida vs. cuándo se marcó Terminada).'
      }) +
      Componentes.kpi({ valor: kpis.atrasadas_activas, etiqueta: 'Atrasadas activas', alerta: kpis.atrasadas_activas > 0, titulo: 'Pasaron su fecha comprometida y aún no se entregan.' }) +
      // v3.0 (Fase 4, §6.2): KPI propio del lado del SOLICITANTE, separado
      // del "% cumplimiento del desarrollador" -- antes solo existia como
      // "esperando validacion", con el mismo peso visual que cualquier otro
      // KPI; ahora se nombra explicitamente como lo pidio Gerencia.
      Componentes.kpi({
        valor: kpis.esperando_validacion,
        etiqueta: 'Solicitantes en mora',
        alerta: kpis.esperando_validacion > 0,
        titulo: 'Ítems entregados (Terminada) que el solicitante todavía no valida. Promedio: ' + kpis.esperando_validacion_promedio_dias + ' día(s) hábil(es) esperando.'
      }) +
      Componentes.kpi({ valor: kpis.atraso_promedio_dias, etiqueta: 'Atraso promedio (días)', titulo: 'Promedio de días hábiles de atraso entre atrasadas activas y cerradas con atraso.' }) +
      Componentes.kpi({ valor: kpis.sin_comprometer, etiqueta: 'Sin comprometer', titulo: 'Cola que el desarrollador todavía no revisó/comprometió.' });
  }

  // Aplica el filtro de tipo (texto, client-side -- ver nota en app.html:
  // no hay catalogo de tipos cargado en esta pantalla, se busca por nombre).
  function itemsConFiltroTipo_() {
    var texto = document.getElementById('ger-filtro-tipo').value.trim().toLowerCase();
    if (!texto) return itemsActuales;
    return itemsActuales.filter(function (i) {
      return String(i.tipo_nombre || '').toLowerCase().indexOf(texto) !== -1;
    });
  }

  function renderTodo_() {
    var base = itemsConFiltroTipo_();
    renderSemaforo_(base);
    var filtrados = categoriaActiva ? base.filter(function (i) { return i.cumplimiento.codigo === categoriaActiva; }) : base;
    renderTablero_(filtrados);
    renderGantt_(filtrados);
    renderControlSolicitante_(filtrados);
  }

  // §7B: tarjetas por categoria, clicables para filtrar el Gantt y el
  // panel del solicitante sin volver a pedir datos al servidor.
  function renderSemaforo_(items) {
    var contenedor = document.getElementById('ger-contenedor-semaforo');
    contenedor.innerHTML = '<div class="sigso-semaforo">' + CATEGORIAS.map(function (cat) {
      var cantidad = items.filter(function (i) { return i.cumplimiento.codigo === cat.codigo; }).length;
      var activa = categoriaActiva === cat.codigo ? ' sigso-semaforo-tarjeta--activa' : '';
      return '<button type="button" class="sigso-semaforo-tarjeta' + activa + '" data-codigo="' + cat.codigo + '">' +
        '<span class="sigso-semaforo-tarjeta__emoji">' + cat.emoji + '</span>' +
        '<span class="sigso-semaforo-tarjeta__cantidad">' + cantidad + '</span>' +
        '<span class="sigso-semaforo-tarjeta__etiqueta">' + Componentes.escaparHtml(cat.etiqueta) + '</span>' +
        '</button>';
    }).join('') + '</div>';

    contenedor.querySelectorAll('[data-codigo]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        var codigo = boton.getAttribute('data-codigo');
        categoriaActiva = categoriaActiva === codigo ? null : codigo;
        renderTodo_();
      });
    });
  }

  // v3.0 (Fase 4, §6.1): tablero de seguimiento -- vista PRINCIPAL del
  // panel (reemplaza la Gantt). Ordenable por columna (clic en el
  // encabezado) y agrupable (mismo patron que "Solicitudes recientes" del
  // Dashboard, ver dashboard.js:agruparPara_) -- todo client-side, sobre
  // los items ya cargados.
  function renderTablero_(items) {
    var contenedor = document.getElementById('ger-contenedor-tablero');
    if (items.length === 0) {
      contenedor.innerHTML = Componentes.vacio('No hay ítems que coincidan con los filtros.');
      return;
    }

    var campoAgrupar = document.getElementById('ger-agrupar').value;
    var encabezado = '<tr>' + COLUMNAS_TABLERO.map(function (col) {
      var activo = ordenTablero.campo === col.campo ? ' data-orden-activo="' + ordenTablero.direccion + '"' : '';
      return '<th data-orden="' + col.campo + '"' + activo + '>' + Componentes.escaparHtml(col.etiqueta) + '</th>';
    }).join('') + '</tr>';

    var ordenados = ordenarTablero_(items);
    var cuerpo;
    if (!campoAgrupar) {
      cuerpo = ordenados.map(filaTablero_).join('');
    } else {
      cuerpo = agruparParaTablero_(ordenados, campoAgrupar).map(function (grupo) {
        return '<tr class="sigso-tabla-tablero__grupo"><td colspan="' + COLUMNAS_TABLERO.length + '">' +
          Componentes.escaparHtml(grupo.etiqueta) + ' (' + grupo.filas.length + ')</td></tr>' +
          grupo.filas.map(filaTablero_).join('');
      }).join('');
    }

    contenedor.innerHTML = '<div style="overflow-x:auto"><table class="sigso-tabla-tablero"><thead>' + encabezado + '</thead><tbody>' + cuerpo + '</tbody></table></div>';

    contenedor.querySelectorAll('th[data-orden]').forEach(function (th) {
      th.addEventListener('click', function () {
        var campo = th.getAttribute('data-orden');
        if (ordenTablero.campo === campo) {
          ordenTablero.direccion = ordenTablero.direccion === 'asc' ? 'desc' : 'asc';
        } else {
          ordenTablero.campo = campo;
          ordenTablero.direccion = 'asc';
        }
        renderTablero_(items);
      });
    });

    contenedor.querySelectorAll('[data-id]').forEach(function (fila) {
      fila.addEventListener('click', function () {
        window.SigsoApp.mostrarDetalle(fila.getAttribute('data-id'));
      });
    });
  }

  // Los campos calculados (dias_*) no vienen planos en el item -- se
  // extraen aca para que ordenarTablero_/agruparParaTablero_ trabajen sobre
  // un valor unico por columna, sin repetir esta logica en cada uno.
  function valorColumna_(item, campo) {
    if (campo === 'dias_esperando_solicitante') return item.cumplimiento.dias_esperando;
    if (campo === 'estado') return formatearEstadoSigso(item.estado);
    if (campo === 'semaforo') return item.cumplimiento.emoji + ' ' + item.cumplimiento.etiqueta;
    return item[campo];
  }

  function ordenarTablero_(items) {
    var campo = ordenTablero.campo;
    var signo = ordenTablero.direccion === 'asc' ? 1 : -1;
    return items.slice().sort(function (a, b) {
      var va = valorColumna_(a, campo);
      var vb = valorColumna_(b, campo);
      if (va === null || va === undefined || va === '') return vb === null || vb === undefined || vb === '' ? 0 : 1;
      if (vb === null || vb === undefined || vb === '') return -1;
      if (campo === 'fecha_comprometida') { va = new Date(va).getTime(); vb = new Date(vb).getTime(); }
      if (va < vb) return -1 * signo;
      if (va > vb) return 1 * signo;
      return 0;
    });
  }

  function agruparParaTablero_(items, campo) {
    var etiquetador = campo === 'estado' ? formatearEstadoSigso : function (v) { return v || '(sin dato)'; };
    var grupos = {};
    items.forEach(function (i) {
      var clave = i[campo] || '(sin dato)';
      if (!grupos[clave]) grupos[clave] = [];
      grupos[clave].push(i);
    });
    return Object.keys(grupos).map(function (clave) {
      return { etiqueta: etiquetador(clave), filas: grupos[clave] };
    });
  }

  function filaTablero_(i) {
    var diasEsperando = i.cumplimiento.dias_esperando;
    var celdaEsperando = diasEsperando === null || diasEsperando === undefined
      ? '—'
      : (i.semaforo_solicitante ? i.semaforo_solicitante.emoji + ' ' : '') + diasEsperando + ' día(s)';
    return '<tr data-id="' + i.solicitud_id + '">' +
      '<td>' + Componentes.escaparHtml(i.solicitud_id + '-' + i.numero_item) + '</td>' +
      '<td>' + Componentes.escaparHtml(i.solicitante_nombre || '') + '</td>' +
      '<td>' + Componentes.escaparHtml(i.desarrollador_asignado || '—') + '</td>' +
      '<td>' + Componentes.badgeEstado(i.estado) + '</td>' +
      '<td>' + Componentes.badgePrioridad(i.prioridad) + '</td>' +
      '<td>' + (i.dias_abierta === null || i.dias_abierta === undefined ? '—' : i.dias_abierta + ' d') + '</td>' +
      '<td>' + (i.dias_desarrollador === null || i.dias_desarrollador === undefined ? '—' : i.dias_desarrollador + ' d') + '</td>' +
      '<td>' + celdaEsperando + '</td>' +
      '<td>' + (i.fecha_comprometida ? Componentes.escaparHtml(String(i.fecha_comprometida).replace('T', ' ').slice(0, 16)) : '—') + '</td>' +
      '<td>' + i.cumplimiento.emoji + ' ' + Componentes.escaparHtml(i.cumplimiento.etiqueta) + '</td>' +
      '</tr>';
  }

  // §7C: carta Gantt liviana -- barras posicionadas por CSS (sin libreria
  // Gantt), una fila por item que tenga fecha comprometida (sin compromiso
  // no tiene fecha que dibujar). Barra = creacion -> compromiso; si esta
  // atrasada, se extiende en rojo hasta hoy; linea tenue = fecha original
  // (antes del primer re-compromiso), si la hubo.
  function renderGantt_(items) {
    var contenedor = document.getElementById('ger-contenedor-gantt');
    var conFecha = items.filter(function (i) { return i.fecha_comprometida; });
    if (conFecha.length === 0) {
      contenedor.innerHTML = Componentes.vacio('No hay ítems comprometidos que coincidan con los filtros.');
      return;
    }

    var ahora = new Date();
    var tiempos = conFecha.map(function (i) { return new Date(i.fecha_creacion).getTime(); })
      .concat(conFecha.map(function (i) { return new Date(i.fecha_comprometida).getTime(); }))
      .concat([ahora.getTime()]);
    var minTime = Math.min.apply(null, tiempos);
    var maxTime = Math.max.apply(null, tiempos);
    var rango = Math.max(maxTime - minTime, 1);

    function pct_(fecha) {
      return Math.min(100, Math.max(0, ((new Date(fecha).getTime() - minTime) / rango) * 100));
    }

    var hoyPct = pct_(ahora);

    var filas = conFecha.map(function (i) {
      var inicioPct = pct_(i.fecha_creacion);
      var finPct = pct_(i.fecha_comprometida);
      var claseColor = 'sigso-gantt-barra--' + i.cumplimiento.codigo.toLowerCase().replace(/_/g, '-');
      var extraAtraso = '';
      if (i.cumplimiento.codigo === 'ATRASADA_DESARROLLADOR' && hoyPct > finPct) {
        extraAtraso = '<div class="sigso-gantt-barra sigso-gantt-barra--atraso" style="left:' + finPct + '%; width:' + (hoyPct - finPct) + '%"></div>';
      }
      var lineaOriginal = '';
      if (i.re_compromisos > 0 && i.fecha_original && i.fecha_original !== i.fecha_comprometida) {
        lineaOriginal = '<div class="sigso-gantt-original" style="left:' + pct_(i.fecha_original) + '%" title="Fecha original antes de re-comprometer: ' + Componentes.escaparHtml(String(i.fecha_original)) + '"></div>';
      }
      return '<div class="sigso-gantt-fila" data-id="' + i.solicitud_id + '">' +
        '<div class="sigso-gantt-etiqueta">' + Componentes.escaparHtml(i.solicitud_id + '-' + i.numero_item) + ' — ' + Componentes.escaparHtml(i.titulo) +
        (i.re_compromisos > 0 ? ' <span class="sigso-ayuda">(re-comprometida ' + i.re_compromisos + 'x)</span>' : '') + '</div>' +
        '<div class="sigso-gantt-track">' +
        '<div class="sigso-gantt-barra ' + claseColor + '" style="left:' + inicioPct + '%; width:' + Math.max(finPct - inicioPct, 0.5) + '%"></div>' +
        extraAtraso + lineaOriginal +
        '</div></div>';
    }).join('');

    contenedor.innerHTML =
      '<div class="sigso-gantt">' +
      '<div class="sigso-gantt-hoy" style="left:' + hoyPct + '%" title="Hoy"></div>' +
      filas +
      '</div>';

    contenedor.querySelectorAll('[data-id]').forEach(function (fila) {
      fila.addEventListener('click', function () {
        window.SigsoApp.mostrarDetalle(fila.getAttribute('data-id'));
      });
    });
  }

  // §7D: "el desarrollador la terminó pero el solicitante nunca la prueba"
  // -- lista de items en ESPERANDO_VALIDACION, ordenada por dias esperando
  // (los mas urgentes de validar primero).
  function renderControlSolicitante_(items) {
    var contenedor = document.getElementById('ger-contenedor-solicitante');
    var esperando = items
      .filter(function (i) { return i.cumplimiento.codigo === 'ESPERANDO_VALIDACION'; })
      .sort(function (a, b) { return (b.cumplimiento.dias_esperando || 0) - (a.cumplimiento.dias_esperando || 0); });

    if (esperando.length === 0) {
      contenedor.innerHTML = Componentes.vacio('Nada entregado pendiente de validación con estos filtros.');
      return;
    }

    contenedor.innerHTML = esperando.map(function (i) {
      return '<div class="sigso-fila-reciente" data-id="' + i.solicitud_id + '">' +
        '<div class="sigso-fila-reciente__principal">' +
        '<strong>' + Componentes.escaparHtml(i.solicitud_id + '-' + i.numero_item) + '</strong> ' +
        Componentes.escaparHtml(i.titulo) + ' ' +
        Componentes.badge(i.cumplimiento.dias_esperando + ' día(s) esperando', i.cumplimiento.dias_esperando > 5 ? 'P1' : '') +
        '</div>' +
        '<div class="sigso-fila-reciente__meta">Debe probar: ' + Componentes.escaparHtml(i.solicitante_nombre) + ' (' + Componentes.escaparHtml(i.solicitante_email) + ')</div>' +
        '</div>';
    }).join('');

    contenedor.querySelectorAll('[data-id]').forEach(function (fila) {
      fila.addEventListener('click', function () {
        window.SigsoApp.mostrarDetalle(fila.getAttribute('data-id'));
      });
    });
  }
})();
