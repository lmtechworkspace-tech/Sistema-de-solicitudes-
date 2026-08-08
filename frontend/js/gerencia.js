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

  // v4.1 (documentacion/SIGSO-v4.1-propuestas-panel-gerencia.md): datos del
  // ultimo panel cargado (recurrencia/tendencia/ciclo/carga), para poder
  // re-renderizar esas pestañas sin volver a pedirlos al servidor.
  var panelActual = null;
  // G1-c: "Vista: Compacta/Completa" -- compacta oculta el bloque de
  // contenido (¿que pasa?/¿que deberia pasar?) para un PDF de solo plazos.
  var densidad = 'completa';
  // G1-a: filas expandidas del tablero (clave = solicitud_id-numero_item).
  var expandidos = {};
  // G2: clic en una fila de Recurrencia filtra el tablero a ese grupo
  // Modulo x Tipo, sin volver a pedir datos al servidor.
  var recurrenciaFiltro = null;
  var graficosGerencia = {};

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

  // v4.1 (G1): tipo/modulo/titulo YA viajaban desde Gerencia.gs, solo
  // faltaba pintarlos -- son cortos, entran como columna normal (a
  // diferencia de descripcion/resultado_esperado, que van en la fila
  // expandible por ser texto largo, ver filaTablero_).
  var COLUMNAS_TABLERO = [
    { campo: 'solicitud_id', etiqueta: 'Solicitud' },
    { campo: 'titulo', etiqueta: 'Título' },
    { campo: 'tipo_nombre', etiqueta: 'Tipo' },
    { campo: 'modulo_nombre', etiqueta: 'Módulo' },
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
    // v5.2 (§4.1): Reporte Ejecutivo -- una hoja simple, distinta del
    // tablero detallado de arriba. sigso-modo-ejecutivo (dashboard.css)
    // oculta todo #vista-gerencia menos ese bloque mientras se imprime.
    var botonEjecutivo = document.getElementById('btn-imprimir-ejecutivo');
    if (botonEjecutivo) {
      botonEjecutivo.addEventListener('click', function () {
        if (panelActual) renderReporteEjecutivo_(panelActual);
        document.body.classList.add('sigso-modo-ejecutivo');
        window.print();
      });
      window.addEventListener('afterprint', function () {
        document.body.classList.remove('sigso-modo-ejecutivo');
      });
    }
    // v5.2 (§4.2): envio manual, complementa el trigger semanal/mensual
    // (Notificaciones.enviarResumenSemanal/enviarReporteMensual, Triggers.gs)
    // -- solo lo ve/usa el Administrador (gate real en el backend tambien).
    var botonEnviarAhora = document.getElementById('btn-enviar-gerencia-ahora');
    if (botonEnviarAhora) {
      botonEnviarAhora.addEventListener('click', function () {
        botonEnviarAhora.disabled = true;
        var textoOriginal = botonEnviarAhora.textContent;
        botonEnviarAhora.textContent = 'Enviando…';
        llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'enviarReporteGerenciaAhora', {})
          .then(function (respuesta) {
            if (respuesta.ok) {
              var total = respuesta.data && respuesta.data.enviados;
              Componentes.aviso({
                texto: total ? 'Reporte enviado a ' + total + ' destinatario(s).' : 'No hay destinatarios de Gerencia configurados.',
                tipo: total ? 'exito' : 'info'
              });
            } else {
              Componentes.aviso({ texto: respuesta.message || 'No se pudo enviar el reporte.', tipo: 'error' });
            }
          })
          .catch(function () {
            Componentes.aviso({ texto: 'No se pudo conectar con el servidor. Intenta nuevamente.', tipo: 'error' });
          })
          .finally(function () {
            botonEnviarAhora.disabled = false;
            botonEnviarAhora.textContent = textoOriginal;
          });
      });
    }
    // G1-c: compacta oculta el bloque de contenido -- al volver a compacta,
    // colapsa cualquier fila que hubiera quedado abierta.
    var selectorDensidad = document.getElementById('ger-densidad');
    if (selectorDensidad) {
      selectorDensidad.addEventListener('change', function () {
        densidad = selectorDensidad.value;
        if (densidad === 'compacta') expandidos = {};
        renderTodo_();
      });
    }
    document.querySelectorAll('[data-ger-tab]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        document.querySelectorAll('[data-ger-tab]').forEach(function (b) {
          b.classList.remove('sigso-tabs__boton--activo');
        });
        boton.classList.add('sigso-tabs__boton--activo');
        var tab = boton.getAttribute('data-ger-tab');
        document.getElementById('ger-panel-tablero').classList.toggle('sigso-oculto', tab !== 'tablero');
        document.getElementById('ger-panel-gantt').classList.toggle('sigso-oculto', tab !== 'gantt');
        var panelRecurrencia = document.getElementById('ger-panel-recurrencia');
        var panelTendencia = document.getElementById('ger-panel-tendencia');
        var panelCarga = document.getElementById('ger-panel-carga');
        if (panelRecurrencia) panelRecurrencia.classList.toggle('sigso-oculto', tab !== 'recurrencia');
        if (panelTendencia) panelTendencia.classList.toggle('sigso-oculto', tab !== 'tendencia');
        if (panelCarga) panelCarga.classList.toggle('sigso-oculto', tab !== 'carga');
        // v6.0 Fase P5: pestaña de Pausas activas (su propio endpoint).
        var panelPausas = document.getElementById('ger-panel-pausas');
        if (panelPausas) panelPausas.classList.toggle('sigso-oculto', tab !== 'pausas');
        // v7.0 Fase 5: pestaña de Actividades (su propio endpoint).
        var panelActividades = document.getElementById('ger-panel-actividades');
        if (panelActividades) panelActividades.classList.toggle('sigso-oculto', tab !== 'actividades');
        // Chart.js no dibuja bien en un canvas que estaba con display:none;
        // al entrar a la pestaña de Tendencia, se re-renderiza con las
        // dimensiones ya visibles.
        if (tab === 'tendencia' && panelActual) renderTendencia_(panelActual.tendencia, panelActual.ciclo_por_etapa);
        if (tab === 'pausas') cargarPausasGerencia_();
        if (tab === 'actividades') cargarActividadesGerencia_();
      });
    });
    inicializarFiltrosActividadesGerencia_();
  }

  // v6.0 (mejora #6): pausas del ultimo reporte cargado, para el boton
  // "Exportar CSV" (exporta exactamente lo que se esta viendo).
  var pausasActuales = [];

  // v6.0 Fase P5: reporte de cumplimiento de pausas activas (todas las
  // empresas). Su propio endpoint (getReporteGerenciaPausas), no viene con el
  // panel principal. Se carga al entrar a la pestaña.
  function cargarPausasGerencia_() {
    var cont = document.getElementById('ger-contenedor-pausas');
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Calculando el cumplimiento de pausas…');
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'getReporteGerenciaPausas', {}).then(function (r) {
      if (!r.ok) { cont.innerHTML = Componentes.alerta(r.message || 'No se pudo cargar.', 'error'); return; }
      var d = r.data;
      if (d.sin_datos) {
        cont.innerHTML = '<p class="sigso-ayuda">Aún no hay pausas activas configuradas.</p>';
        return;
      }
      pausasActuales = d.pausas || [];
      var k = d.kpis;
      cont.innerHTML =
        '<div class="sigso-admin-cab"><p class="sigso-ayuda" style="margin:0;">Periodo: ' +
        Componentes.escaparHtml(d.periodo.desde) + ' a ' + Componentes.escaparHtml(d.periodo.hasta) + '</p>' +
        '<button type="button" class="sigso-boton sigso-boton--secundario" id="btn-exportar-csv-pausas">Exportar CSV</button></div>' +
        '<div class="sigso-kpis">' +
        Componentes.kpi({ etiqueta: 'Cumplimiento', valor: (k.pct_cumplimiento == null ? '—' : k.pct_cumplimiento + '%') }) +
        Componentes.kpi({ etiqueta: 'Programadas', valor: k.programadas }) +
        Componentes.kpi({ etiqueta: 'Realizadas', valor: k.realizadas }) +
        Componentes.kpi({ etiqueta: 'No realizadas', valor: k.no_realizadas }) +
        Componentes.kpi({ etiqueta: 'Participaciones', valor: k.participaciones }) +
        Componentes.kpi({ etiqueta: 'Justificaciones', valor: k.justificaciones }) +
        '</div>' +
        '<h4>Tendencia semanal</h4><div class="sigso-grafico-contenedor"><canvas id="ger-grafico-tendencia-pausas" height="90"></canvas></div>' +
        '<h4>Motivos de inasistencia</h4>' + tablaPausasGerencia_(d.motivos, 'motivo', 'cantidad', 'Sin justificaciones en el periodo.') +
        '<h4>Participación por área</h4>' + tablaPausasGerencia_(d.por_area, 'area', 'participaciones', 'Sin participaciones en el periodo.');
      document.getElementById('btn-exportar-csv-pausas').addEventListener('click', exportarCsvPausas_);
      renderTendenciaPausas_(d.tendencia);
    }).catch(function (e) { cont.innerHTML = Componentes.alerta((e && e.message) || 'Error de conexión.', 'error'); });
  }

  // v6.0 (mejora #6): mismo patron que renderTendencia_ (barras + linea de
  // %), pero semanal en vez de mensual -- las pausas son diarias, el
  // panorama mensual diluiria demasiado la senal.
  function renderTendenciaPausas_(tendencia) {
    var canvas = document.getElementById('ger-grafico-tendencia-pausas');
    if (!canvas || !tendencia || !tendencia.length) return;
    if (graficosGerencia.tendenciaPausas) graficosGerencia.tendenciaPausas.destroy();
    graficosGerencia.tendenciaPausas = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: tendencia.map(function (m) { return m.etiqueta; }),
        datasets: [
          { type: 'bar', label: 'Realizadas', data: tendencia.map(function (m) { return m.realizadas; }), backgroundColor: '#1F7A55' },
          { type: 'bar', label: 'No realizadas', data: tendencia.map(function (m) { return m.no_realizadas; }), backgroundColor: '#C0392B' },
          {
            type: 'line', label: '% cumplimiento', yAxisID: 'y1',
            data: tendencia.map(function (m) { return m.pct_cumplimiento; }),
            borderColor: '#E8622A', backgroundColor: '#E8622A', spanGaps: true
          }
        ]
      },
      options: {
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'Pausas' } },
          y1: { beginAtZero: true, max: 100, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '% cumplimiento' } }
        }
      }
    });
  }

  // v6.0 (mejora #6): exporta exactamente el listado de pausas del periodo
  // actual -- mismo patron que exportarCSV_ de Solicitudes (dashboard.js).
  function exportarCsvPausas_() {
    var encabezado = ['pausa_id', 'empresa_id', 'fecha', 'hora_programada', 'estado'];
    var lineas = [encabezado.join(',')].concat(pausasActuales.map(function (p) {
      return encabezado.map(function (campo) {
        return '"' + String(p[campo] || '').replace(/"/g, '""') + '"';
      }).join(',');
    }));
    var blob = new Blob([lineas.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(blob);
    enlace.download = 'sigso-pausas-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
  }

  function tablaPausasGerencia_(filas, a, b, vacio) {
    if (!filas || filas.length === 0) return '<p class="sigso-ayuda">' + Componentes.escaparHtml(vacio) + '</p>';
    var cuerpo = filas.map(function (f) {
      return '<tr><td>' + Componentes.escaparHtml(String(f[a])) + '</td><td>' + Componentes.escaparHtml(String(f[b])) + '</td></tr>';
    }).join('');
    return '<table class="sigso-tabla"><tbody>' + cuerpo + '</tbody></table>';
  }

  function irATablero_() {
    var botonTablero = document.getElementById('ger-tab-tablero');
    if (botonTablero) botonTablero.click();
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
    // v5.0 F4 (§6.3): esqueleto mientras se pide getPanelGerencia -- mismo
    // patron que Bandeja (dashboard.js), KPI sueltos para que la grilla
    // reparta las 4 tarjetas como a las reales.
    document.getElementById('ger-contenedor-kpis').innerHTML = new Array(4).fill(
      '<div class="sigso-kpi sigso-esq__tarjeta" aria-busy="true">' +
      '<span class="sigso-esq__barra" style="width:40%;height:22px;margin:0 auto 0.5rem"></span>' +
      '<span class="sigso-esq__barra" style="width:65%;height:10px;margin:0 auto"></span></div>'
    ).join('');
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'getPanelGerencia', leerFiltrosServidor_())
      .then(function (respuesta) {
        if (!respuesta.ok) {
          document.getElementById('ger-contenedor-kpis').innerHTML =
            Componentes.alerta(respuesta.message || 'No se pudo cargar el panel.', 'error');
          return respuesta;
        }
        itemsActuales = respuesta.data.items;
        panelActual = respuesta.data;
        recurrenciaFiltro = null;
        renderKpis_(respuesta.data.kpis, respuesta.data.atenciones_directas);
        renderTodo_();
        renderRecurrencia_(respuesta.data.recurrencia);
        renderTendencia_(respuesta.data.tendencia, respuesta.data.ciclo_por_etapa);
        renderCarga_(respuesta.data.carga);
        // v5.2 (§4.2): "Enviar a Gerencia ahora" solo lo ve el Administrador
        // -- rol_actual viaja SIEMPRE fresco (nunca desde el cache del panel,
        // ver Gerencia.gs), asi que esto no se equivoca aunque el panel venga
        // cacheado de una sesion de otro rol.
        var botonEnviarAhora = document.getElementById('btn-enviar-gerencia-ahora');
        if (botonEnviarAhora) {
          botonEnviarAhora.classList.toggle('sigso-oculto', respuesta.data.rol_actual !== 'ADM');
        }
        return respuesta;
      });
  }

  // G7: badge de variacion vs. el periodo anterior (ultimos 30 dias vs. los
  // 30 previos, ver Gerencia.resolverVentanaPeriodo_). null = sin dato
  // comparable (no se puede decir "bajo a 0%" si el periodo anterior no
  // tuvo ninguna entrega) -- no se muestra nada, en vez de mostrar "+0".
  function deltaBadge_(delta, subeEsBueno) {
    if (delta === null || delta === undefined) return '';
    if (delta === 0) return '<span class="sigso-kpi__delta">= vs. período anterior</span>';
    var esBueno = subeEsBueno ? delta > 0 : delta < 0;
    var flecha = delta > 0 ? '▲' : '▼';
    var clase = esBueno ? 'sigso-kpi__delta--bueno' : 'sigso-kpi__delta--malo';
    return '<span class="sigso-kpi__delta ' + clase + '">' + flecha + ' ' + Math.abs(delta) + ' vs. período anterior</span>';
  }

  // Componentes.kpi escapa "valor" entero como texto -- no sirve para
  // meter el badge de delta (necesita ser HTML). Se arma la misma
  // estructura/clases a mano solo para las tarjetas con comparativo.
  function tarjetaKpiConDelta_(opts) {
    return '<div class="sigso-kpi' + (opts.alerta ? ' sigso-kpi--alerta' : '') + '"' +
      (opts.titulo ? ' title="' + Componentes.escaparHtml(opts.titulo) + '"' : '') + '>' +
      '<div class="sigso-kpi__valor">' + Componentes.escaparHtml(opts.valor) + '</div>' +
      opts.delta +
      '<div class="sigso-kpi__etiqueta">' + Componentes.escaparHtml(opts.etiqueta) + '</div>' +
      '</div>';
  }

  function renderKpis_(kpis, atencionesDirectas) {
    var cmp = kpis.comparativo || {};
    document.getElementById('ger-contenedor-kpis').innerHTML =
      tarjetaKpiConDelta_({
        valor: kpis.pct_cumplimiento_desarrollador === null ? '—' : kpis.pct_cumplimiento_desarrollador + '%',
        delta: deltaBadge_(cmp.pct_cumplimiento_desarrollador, true),
        etiqueta: 'Cumplimiento del desarrollador',
        titulo: 'Entregadas a tiempo ÷ entregadas (fecha comprometida vs. cuándo se marcó Terminada).'
      }) +
      tarjetaKpiConDelta_({
        valor: kpis.atrasadas_activas,
        delta: deltaBadge_(cmp.atrasadas_activas, false),
        etiqueta: 'Atrasadas activas', alerta: kpis.atrasadas_activas > 0,
        titulo: 'Pasaron su fecha comprometida y aún no se entregan.'
      }) +
      // v3.0 (Fase 4, §6.2): KPI propio del lado del SOLICITANTE, separado
      // del "% cumplimiento del desarrollador" -- antes solo existia como
      // "esperando validacion", con el mismo peso visual que cualquier otro
      // KPI; ahora se nombra explicitamente como lo pidio Gerencia.
      tarjetaKpiConDelta_({
        valor: kpis.esperando_validacion,
        delta: deltaBadge_(cmp.esperando_validacion, false),
        etiqueta: 'Solicitantes en mora',
        alerta: kpis.esperando_validacion > 0,
        titulo: 'Ítems entregados (Terminada) que el solicitante todavía no valida. Promedio: ' + kpis.esperando_validacion_promedio_dias + ' día(s) hábil(es) esperando.'
      }) +
      tarjetaKpiConDelta_({
        valor: kpis.atraso_promedio_dias,
        delta: deltaBadge_(cmp.atraso_promedio_dias, false),
        etiqueta: 'Atraso promedio (días)', titulo: 'Promedio de días hábiles de atraso entre atrasadas activas y cerradas con atraso.'
      }) +
      tarjetaKpiConDelta_({
        valor: kpis.sin_comprometer,
        delta: deltaBadge_(cmp.sin_comprometer, false),
        etiqueta: 'Sin comprometer', titulo: 'Cola que el desarrollador todavía no revisó/comprometió.'
      }) +
      // v3.1 (§1.6): quedan FUERA de los KPIs de arriba (nunca tuvieron
      // fecha comprometida), pero su volumen es en si un dato de gestion:
      // cuanto se esta resolviendo por telefono, fuera del proceso.
      Componentes.kpi({
        valor: atencionesDirectas || 0,
        etiqueta: 'Atenciones directas',
        titulo: 'Solicitudes resueltas fuera del flujo (por teléfono) y registradas después. No entran en los indicadores de cumplimiento porque nunca tuvieron fecha comprometida.'
      });
  }

  // v5.2 (§4.1, propuesta de adopcion): Reporte Ejecutivo -- UNA hoja, sin
  // tablero ni filtros: numeros grandes, un semaforo y 3-5 lineas en texto
  // plano de "que necesita tu atencion". Distinto a proposito del informe
  // detallado de arriba (ese es para quien SI quiere navegar el detalle).
  function renderReporteEjecutivo_(panel) {
    var contenedor = document.getElementById('ger-reporte-ejecutivo-imprimir');
    if (!contenedor) return;
    var kpis = panel.kpis || {};
    var items = panel.items || [];
    var atrasadas = items.filter(function (i) { return i.cumplimiento.codigo === 'ATRASADA_DESARROLLADOR'; }).length;
    var enRiesgo = items.filter(function (i) { return i.cumplimiento.codigo === 'EN_RIESGO'; }).length;

    var semaforo = atrasadas > 0
      ? '🔴 Hay solicitudes atrasadas que necesitan atención'
      : (enRiesgo > 0 ? '🟡 Al día, pero hay ítems cerca de vencer' : '🟢 Todo al día');

    var lineas = [];
    lineas.push((kpis.atrasadas_activas || 0) + ' solicitud(es) ya pasaron su fecha comprometida y siguen sin entregarse.');
    lineas.push((kpis.esperando_validacion || 0) + ' ítem(s) están listos y esperan que el solicitante confirme que quedaron bien.');
    lineas.push((kpis.sin_comprometer || 0) + ' solicitud(es) todavía no tienen fecha comprometida por el equipo.');
    if (kpis.pct_cumplimiento_desarrollador !== null && kpis.pct_cumplimiento_desarrollador !== undefined) {
      lineas.push('De lo entregado, el ' + kpis.pct_cumplimiento_desarrollador + '% se entregó a tiempo.');
    }

    contenedor.innerHTML =
      '<div class="sigso-encabezado-reporte">' +
      '<svg class="sigso-marca" width="34" height="34" viewBox="0 0 32 32" aria-hidden="true">' +
      '<rect width="32" height="32" rx="8" fill="#6D5DF6"></rect>' +
      '<text x="16" y="23" font-family="Arial, sans-serif" font-weight="700" font-size="20" fill="#fff" text-anchor="middle">S</text>' +
      '</svg>' +
      '<div><h1>SIGSO — Reporte ejecutivo</h1>' +
      '<p>HomePymes / RLD · Generado el ' + Componentes.escaparHtml(new Date().toLocaleString('es-CL')) + '</p></div>' +
      '</div>' +
      '<p class="sigso-reporte-ejecutivo__semaforo">' + semaforo + '</p>' +
      '<div class="sigso-reporte-ejecutivo__numeros">' +
      numeroEjecutivo_(kpis.pct_cumplimiento_desarrollador === null || kpis.pct_cumplimiento_desarrollador === undefined ? '—' : kpis.pct_cumplimiento_desarrollador + '%', 'Cumplimiento') +
      numeroEjecutivo_(kpis.atrasadas_activas || 0, 'Atrasadas') +
      numeroEjecutivo_(kpis.esperando_validacion || 0, 'Por validar') +
      '</div>' +
      '<p><strong>Qué necesita tu atención:</strong></p>' +
      '<ul class="sigso-reporte-ejecutivo__lineas">' +
      lineas.map(function (l) { return '<li>' + Componentes.escaparHtml(l) + '</li>'; }).join('') +
      '</ul>';
  }

  function numeroEjecutivo_(valor, etiqueta) {
    return '<div class="sigso-reporte-ejecutivo__numero"><strong>' + Componentes.escaparHtml(String(valor)) +
      '</strong><span>' + Componentes.escaparHtml(etiqueta) + '</span></div>';
  }

  // Misma clave de agrupacion que Gerencia.calcularRecurrencia_ (Modulo x
  // Tipo, con el mismo texto de reemplazo para vacio) -- ver comentario en
  // renderTodo_.
  function claveRecurrencia_(i) {
    return (i.modulo_nombre || '(sin módulo)') + '␟' + (i.tipo_nombre || '(sin tipo)');
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
    // G2: si se hizo clic en un grupo de Recurrencia, el tablero (y solo el
    // tablero -- Gantt/control del solicitante siguen con su propio filtro)
    // se acota a ese Modulo x Tipo. Gerencia.calcularRecurrencia_ agrupa
    // usando '(sin módulo)'/'(sin tipo)' como clave cuando el campo viene
    // vacio -- hay que reproducir el mismo fallback aca para que el clic
    // matchee los items reales (que sí tienen '' crudo, no la etiqueta).
    var filtradosTablero = recurrenciaFiltro
      ? filtrados.filter(function (i) { return claveRecurrencia_(i) === recurrenciaFiltro; })
      : filtrados;
    renderTablero_(filtradosTablero);
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
    // G1-a/G1-c: la columna de expandir solo existe en modo Completo -- en
    // Compacto el tablero queda igual que antes (solo plazos).
    var mostrarExpandir = densidad === 'completa';
    var colspanTotal = COLUMNAS_TABLERO.length + (mostrarExpandir ? 1 : 0);
    var encabezado = '<tr>' + (mostrarExpandir ? '<th class="sigso-th-expandir"></th>' : '') +
      COLUMNAS_TABLERO.map(function (col) {
        var activo = ordenTablero.campo === col.campo ? ' data-orden-activo="' + ordenTablero.direccion + '"' : '';
        return '<th data-orden="' + col.campo + '"' + activo + '>' + Componentes.escaparHtml(col.etiqueta) + '</th>';
      }).join('') + '</tr>';

    var ordenados = ordenarTablero_(items);
    function filas_(lista) { return lista.map(function (i) { return filaTablero_(i, mostrarExpandir); }).join(''); }
    var cuerpo;
    if (!campoAgrupar) {
      cuerpo = filas_(ordenados);
    } else {
      cuerpo = agruparParaTablero_(ordenados, campoAgrupar).map(function (grupo) {
        return '<tr class="sigso-tabla-tablero__grupo"><td colspan="' + colspanTotal + '">' +
          Componentes.escaparHtml(grupo.etiqueta) + ' (' + grupo.filas.length + ')</td></tr>' +
          filas_(grupo.filas);
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

    contenedor.querySelectorAll('tr[data-id]').forEach(function (fila) {
      fila.addEventListener('click', function () {
        window.SigsoApp.mostrarDetalle(fila.getAttribute('data-id'));
      });
    });

    // G1-a: el toggle de expandir es un boton propio -- stopPropagation
    // evita que el clic tambien dispare la navegacion al detalle completo.
    contenedor.querySelectorAll('[data-expandir]').forEach(function (boton) {
      boton.addEventListener('click', function (evento) {
        evento.stopPropagation();
        var clave = boton.getAttribute('data-expandir');
        expandidos[clave] = !expandidos[clave];
        renderTablero_(items);
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

  // UI-1 (§6): el borde izquierdo coloreado lleva el ojo del gerente
  // directo a los problemas (rojo = atrasada, amarillo = en riesgo).
  function claseUrgenciaFila_(i) {
    if (i.cumplimiento.codigo === 'ATRASADA_DESARROLLADOR') return ' class="sigso-fila--atrasada"';
    if (i.cumplimiento.codigo === 'EN_RIESGO') return ' class="sigso-fila--riesgo"';
    return '';
  }

  // UI-4 (§7): data-label por celda -- en movil el tablero se ve como
  // tarjetas apiladas (CSS en dashboard.css), y cada celda necesita saber
  // que columna representa sin depender del <thead> (que no es visible ahi).
  // v4.1 (G1-a): trunca titulo/tipo/modulo en la celda corta -- el texto
  // completo va en el title (mouse) y, para descripcion/resultado_esperado
  // (mucho mas largos), en la fila expandible de abajo.
  function truncar_(texto, maxLargo) {
    var t = String(texto || '');
    return t.length > maxLargo ? t.slice(0, maxLargo - 1) + '…' : t;
  }

  function filaTablero_(i, mostrarExpandir) {
    var diasEsperando = i.cumplimiento.dias_esperando;
    var celdaEsperando = diasEsperando === null || diasEsperando === undefined
      ? '—'
      : (i.semaforo_solicitante ? i.semaforo_solicitante.emoji + ' ' : '') + diasEsperando + ' día(s)';
    var etq = {};
    COLUMNAS_TABLERO.forEach(function (col) { etq[col.campo] = col.etiqueta; });
    var clave = i.solicitud_id + '-' + i.numero_item;
    var expandido = mostrarExpandir && expandidos[clave];
    var celdaExpandir = mostrarExpandir
      ? '<td class="sigso-td-expandir"><button type="button" class="sigso-boton-expandir" data-expandir="' + Componentes.escaparHtml(clave) +
        '" aria-expanded="' + (expandido ? 'true' : 'false') + '" title="Ver ¿qué pasa? / ¿qué debería pasar?">' + (expandido ? '▾' : '▸') + '</button></td>'
      : '';
    var fila = '<tr data-id="' + i.solicitud_id + '"' + claseUrgenciaFila_(i) + '>' +
      celdaExpandir +
      '<td class="sigso-id" data-label="' + etq.solicitud_id + '">' + Componentes.escaparHtml(i.solicitud_id + '-' + i.numero_item) + '</td>' +
      '<td data-label="' + etq.titulo + '" title="' + Componentes.escaparHtml(i.titulo || '') + '">' + Componentes.escaparHtml(truncar_(i.titulo, 40)) + '</td>' +
      '<td data-label="' + etq.tipo_nombre + '">' + Componentes.escaparHtml(i.tipo_nombre || '—') + '</td>' +
      '<td data-label="' + etq.modulo_nombre + '">' + Componentes.escaparHtml(i.modulo_nombre || '—') + '</td>' +
      '<td data-label="' + etq.solicitante_nombre + '">' + Componentes.escaparHtml(i.solicitante_nombre || '') + '</td>' +
      // UI-1 (§6): nombre legible del responsable (el correo queda como
      // title al pasar el mouse) -- lo resuelve el backend en getPanel.
      '<td data-label="' + etq.desarrollador_asignado + '" title="' + Componentes.escaparHtml(i.desarrollador_asignado || '') + '">' +
      Componentes.escaparHtml(i.desarrollador_nombre || i.desarrollador_asignado || '—') + '</td>' +
      '<td data-label="' + etq.estado + '">' + Componentes.badgeEstado(i.estado) + '</td>' +
      '<td data-label="' + etq.prioridad + '">' + Componentes.badgePrioridad(i.prioridad) + '</td>' +
      '<td data-label="' + etq.dias_abierta + '">' + (i.dias_abierta === null || i.dias_abierta === undefined ? '—' : i.dias_abierta + ' d') + '</td>' +
      '<td data-label="' + etq.dias_desarrollador + '">' + (i.dias_desarrollador === null || i.dias_desarrollador === undefined ? '—' : i.dias_desarrollador + ' d') + '</td>' +
      '<td data-label="' + etq.dias_esperando_solicitante + '">' + celdaEsperando + '</td>' +
      '<td data-label="' + etq.fecha_comprometida + '">' + (i.fecha_comprometida ? Componentes.escaparHtml(String(i.fecha_comprometida).replace('T', ' ').slice(0, 16)) : '—') + '</td>' +
      '<td data-label="' + etq.semaforo + '">' + i.cumplimiento.emoji + ' ' + Componentes.escaparHtml(i.cumplimiento.etiqueta) + '</td>' +
      '</tr>';

    if (!expandido) return fila;

    var colspanContenido = COLUMNAS_TABLERO.length + 1;
    return fila + '<tr class="sigso-fila-contenido">' +
      '<td colspan="' + colspanContenido + '">' +
      '<div class="sigso-fila-contenido__bloque"><strong>¿Qué pasa?</strong> ' + Componentes.escaparHtml(i.descripcion || '—') + '</div>' +
      (i.resultado_esperado ? '<div class="sigso-fila-contenido__bloque"><strong>¿Qué debería pasar?</strong> ' + Componentes.escaparHtml(i.resultado_esperado) + '</div>' : '') +
      '</td></tr>';
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
        '<strong class="sigso-id">' + Componentes.escaparHtml(i.solicitud_id + '-' + i.numero_item) + '</strong> ' +
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

  // G2 (v4.1): "¿que se nos repite?" -- ranking Modulo x Tipo. Cada fila es
  // clicable y filtra el tablero (renderTodo_ ya sabe leer
  // recurrenciaFiltro_, ver arriba) para leer los "¿que pasa?" concretos
  // detras del numero.
  function renderRecurrencia_(recurrencia) {
    var contenedor = document.getElementById('ger-contenedor-recurrencia');
    if (!contenedor) return;
    if (!recurrencia || recurrencia.length === 0) {
      contenedor.innerHTML = Componentes.vacio('No hay datos de recurrencia con estos filtros.');
      return;
    }

    function tendenciaHtml_(t) {
      if (t === null || t === undefined) return '<span class="sigso-ayuda">—</span>';
      if (t === 0) return '<span class="sigso-kpi__delta">=</span>';
      var clase = t > 0 ? 'sigso-kpi__delta--malo' : 'sigso-kpi__delta--bueno';
      return '<span class="sigso-kpi__delta ' + clase + '">' + (t > 0 ? '▲ +' : '▼ ') + t + '</span>';
    }

    var filas = recurrencia.map(function (r) {
      var clave = r.modulo_nombre + '␟' + r.tipo_nombre;
      var activo = recurrenciaFiltro === clave;
      return '<tr data-clave="' + Componentes.escaparHtml(clave) + '"' + (activo ? ' class="sigso-fila--activa"' : '') + '>' +
        '<td>' + Componentes.escaparHtml(r.modulo_nombre) + '</td>' +
        '<td>' + Componentes.escaparHtml(r.tipo_nombre) + '</td>' +
        '<td>' + r.cantidad + '</td>' +
        '<td>' + r.pct_total + '%</td>' +
        '<td>' + tendenciaHtml_(r.tendencia) + '</td>' +
        '<td>' + (r.dias_promedio_resolucion === null ? '—' : r.dias_promedio_resolucion + ' d') + '</td>' +
        '<td>' + r.reaperturas + '</td>' +
        '</tr>';
    }).join('');

    contenedor.innerHTML = '<div style="overflow-x:auto"><table class="sigso-tabla-tablero">' +
      '<thead><tr><th>Módulo</th><th>Tipo</th><th>Cantidad</th><th>% del total</th>' +
      '<th>Tendencia</th><th>Días prom. resolución</th><th>Reaperturas</th></tr></thead>' +
      '<tbody>' + filas + '</tbody></table></div>' +
      (recurrenciaFiltro ? '<button type="button" class="sigso-boton--secundario" id="btn-quitar-filtro-recurrencia">Quitar filtro del tablero</button>' : '');

    contenedor.querySelectorAll('tr[data-clave]').forEach(function (fila) {
      fila.addEventListener('click', function () {
        var clave = fila.getAttribute('data-clave');
        recurrenciaFiltro = recurrenciaFiltro === clave ? null : clave;
        renderRecurrencia_(recurrencia);
        renderTodo_();
        if (recurrenciaFiltro) irATablero_();
      });
    });

    var btnQuitar = document.getElementById('btn-quitar-filtro-recurrencia');
    if (btnQuitar) {
      btnQuitar.addEventListener('click', function (evento) {
        evento.stopPropagation();
        recurrenciaFiltro = null;
        renderRecurrencia_(recurrencia);
        renderTodo_();
      });
    }
  }

  // G3+G4 (v4.1): "¿mejoramos o empeoramos?" (tendencia de 6 meses) y
  // "¿donde se pierde el tiempo?" (ciclo por etapa) -- ambas son fotos en
  // el tiempo, se agrupan en la misma pestaña "Tendencia".
  function renderTendencia_(tendencia, cicloPorEtapa) {
    var canvas = document.getElementById('ger-grafico-tendencia');
    if (canvas && tendencia && tendencia.length) {
      if (graficosGerencia.tendencia) graficosGerencia.tendencia.destroy();
      graficosGerencia.tendencia = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: tendencia.map(function (m) { return m.etiqueta; }),
          // v5.0 (F1): paleta del Design System (creadas indigo, cerradas
          // verde ok, linea de cumplimiento en el acento de marca).
          datasets: [
            { type: 'bar', label: 'Creadas', data: tendencia.map(function (m) { return m.creadas; }), backgroundColor: '#6D5DF6' },
            { type: 'bar', label: 'Cerradas', data: tendencia.map(function (m) { return m.cerradas; }), backgroundColor: '#1F7A55' },
            {
              type: 'line', label: '% cumplimiento', yAxisID: 'y1',
              data: tendencia.map(function (m) { return m.pct_cumplimiento; }),
              borderColor: '#E8622A', backgroundColor: '#E8622A', spanGaps: true
            }
          ]
        },
        options: {
          scales: {
            y: { beginAtZero: true, title: { display: true, text: 'Ítems' } },
            y1: { beginAtZero: true, max: 100, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '% cumplimiento' } }
          }
        }
      });
    }

    var contenedorCiclo = document.getElementById('ger-contenedor-ciclo');
    if (!contenedorCiclo) return;
    if (!cicloPorEtapa || cicloPorEtapa.every(function (c) { return c.muestras === 0; })) {
      contenedorCiclo.innerHTML = Componentes.vacio('Todavía no hay suficiente historial de estados para calcular el ciclo por etapa.');
      return;
    }

    var maxDias = Math.max.apply(null, cicloPorEtapa.map(function (c) { return c.dias_promedio || 0; }).concat([1]));
    contenedorCiclo.innerHTML = '<div class="sigso-carga-lista">' + cicloPorEtapa.map(function (c) {
      var pct = c.dias_promedio === null ? 0 : Math.max((c.dias_promedio / maxDias) * 100, 2);
      return '<div class="sigso-carga-fila">' +
        '<div class="sigso-carga-etiqueta">' + Componentes.escaparHtml(formatearEstadoSigso(c.estado_desde)) + ' → ' + Componentes.escaparHtml(formatearEstadoSigso(c.estado_hasta)) + '</div>' +
        '<div class="sigso-carga-barra-track"><div class="sigso-carga-barra" style="width:' + pct + '%"></div></div>' +
        '<div class="sigso-carga-valor">' + (c.dias_promedio === null ? '— (sin datos)' : c.dias_promedio + ' d (' + c.muestras + ' muestra' + (c.muestras === 1 ? '' : 's') + ')') + '</div>' +
        '</div>';
    }).join('') + '</div>';
  }

  // G6 (v4.1): "¿que sistema nos consume mas equipo?" -- distribucion por
  // empresa/plataforma/area, barras simples (mismo patron visual que el
  // ciclo por etapa de arriba, sin depender de Chart.js).
  function renderCarga_(carga) {
    var contenedor = document.getElementById('ger-contenedor-carga');
    if (!contenedor || !carga) return;

    function bloque_(titulo, filas) {
      if (!filas || filas.length === 0) return '<h4>' + Componentes.escaparHtml(titulo) + '</h4>' + Componentes.vacio('Sin datos.');
      var max = Math.max.apply(null, filas.map(function (f) { return f.cantidad; }));
      return '<h4>' + Componentes.escaparHtml(titulo) + '</h4><div class="sigso-carga-lista">' + filas.map(function (f) {
        var pct = Math.max((f.cantidad / max) * 100, 2);
        return '<div class="sigso-carga-fila">' +
          '<div class="sigso-carga-etiqueta">' + Componentes.escaparHtml(f.etiqueta) + '</div>' +
          '<div class="sigso-carga-barra-track"><div class="sigso-carga-barra" style="width:' + pct + '%"></div></div>' +
          '<div class="sigso-carga-valor">' + f.cantidad + '</div>' +
          '</div>';
      }).join('') + '</div>';
    }

    contenedor.innerHTML =
      bloque_('Por empresa', carga.por_empresa) +
      bloque_('Por plataforma', carga.por_plataforma) +
      bloque_('Por área', carga.por_area);
  }

  // ------------------------------------------------------------------------
  // v7.0 (Fase 5, §4.7/§4.8/§5.3): pestaña "Actividades" -- KPIs, mapa de
  // calor área×semana, criticas transversales, 3 motores de reporte
  // (Estado actual / Cumplimiento del período / Carga y capacidad) en
  // pantalla + CSV + PDF, y la Acta de reunión. Mismo patron que Pausas
  // (P5): su propio endpoint, se carga solo al entrar a la pestaña.
  // ------------------------------------------------------------------------

  // Ultimo reporte cargado -- el boton "Exportar CSV" exporta EXACTAMENTE
  // lo que se ve en pantalla (mismo criterio que exportarCsvPausas_).
  var reporteActividadesActual = null;

  function inicializarFiltrosActividadesGerencia_() {
    var btnVer = document.getElementById('btn-ver-reporte-actividades');
    if (btnVer) btnVer.addEventListener('click', cargarReporteActividadesGerencia_);
    var btnCsv = document.getElementById('btn-exportar-csv-actividades');
    if (btnCsv) btnCsv.addEventListener('click', exportarCsvActividadesGerencia_);
    var btnPdf = document.getElementById('btn-descargar-pdf-actividades');
    if (btnPdf) btnPdf.addEventListener('click', descargarPdfActividadesGerencia_);
    var btnActa = document.getElementById('btn-acta-reunion-actividades');
    if (btnActa) btnActa.addEventListener('click', descargarActaReunionGerencia_);
  }

  // Filtros comunes de §4.8 que se implementaron (área/prioridad/rango de
  // fechas) -- se leen una vez y se reusan tanto para el panel de KPIs como
  // para los reportes/PDF/acta, para que "lo que ves" sea "lo que exportas".
  function leerFiltrosActividadesGerencia_() {
    var desde = document.getElementById('ger-act-filtro-desde').value;
    var hasta = document.getElementById('ger-act-filtro-hasta').value;
    return {
      area_id: document.getElementById('ger-act-filtro-area').value,
      prioridad: document.getElementById('ger-act-filtro-prioridad').value,
      desde: desde ? new Date(desde).toISOString() : '',
      hasta: hasta ? new Date(hasta).toISOString() : ''
    };
  }

  function cargarActividadesGerencia_() {
    var cont = document.getElementById('ger-act-kpis');
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Calculando los KPIs de Actividades…');
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'getPanelGerenciaActividades', leerFiltrosActividadesGerencia_())
      .then(function (r) {
        if (!r.ok) { cont.innerHTML = Componentes.alerta(r.message || 'No se pudo cargar.', 'error'); return; }
        renderKpisActividadesGerencia_(r.data.kpis);
        renderHeatmapActividadesGerencia_(r.data.heatmap);
        renderCriticasActividadesGerencia_(r.data.criticas);
        poblarSelectAreasActividadesGerencia_(r.data.areas);
      })
      .catch(function (e) { cont.innerHTML = Componentes.alerta((e && e.message) || 'Error de conexión.', 'error'); });
  }

  // El catalogo de áreas viaja en la MISMA respuesta del panel (en vez de
  // pedirlo a otro endpoint aparte) -- un solo viaje de red para pintar todo
  // lo que necesita la pestaña. Se puebla una sola vez (si ya hay opciones
  // ademas de "Todas", no se repite).
  function poblarSelectAreasActividadesGerencia_(areas) {
    var select = document.getElementById('ger-act-filtro-area');
    if (!select || select.options.length > 1) return;
    (areas || []).forEach(function (a) {
      var opcion = document.createElement('option');
      opcion.value = a.area_id;
      opcion.textContent = a.nombre;
      select.appendChild(opcion);
    });
  }

  // §4.7: los 6 KPIs propuestos (el #5, carga por persona sin ranking, se ve
  // en detalle en el reporte "Carga y capacidad" en vez de repetirse aca
  // como una septima tarjeta). #1/#4/#6 son "de periodo" (con delta vs. el
  // periodo anterior, mismo componente que el resto del panel); #2/#3 son
  // "de HOY" (una foto, sin periodo anterior comparable -- ver Actividades.gs).
  function renderKpisActividadesGerencia_(kpis) {
    var cont = document.getElementById('ger-act-kpis');
    if (!cont) return;
    var cmp = kpis.comparativo || {};
    cont.innerHTML =
      tarjetaKpiConDelta_({
        valor: kpis.pct_cumplidas_a_tiempo === null ? '—' : kpis.pct_cumplidas_a_tiempo + '%',
        delta: deltaBadge_(cmp.pct_cumplidas_a_tiempo, true),
        etiqueta: 'Cumplidas a tiempo',
        titulo: 'De lo terminado en el período, % con fecha_terminada dentro del compromiso.'
      }) +
      Componentes.kpi({
        valor: kpis.antiguedad_media_dias,
        etiqueta: 'Antigüedad media (días)',
        titulo: 'Meta-KPI (§4.7): promedio de días hábiles sin check-in de las actividades activas. Si es alta, el resto del panel no es confiable.'
      }) +
      Componentes.kpi({
        valor: kpis.bloqueadas_actual + (kpis.bloqueadas_actual ? ' (' + kpis.bloqueo_promedio_dias + ' d prom.)' : ''),
        etiqueta: 'Bloqueadas ahora',
        alerta: kpis.bloqueadas_actual > 0,
        titulo: 'Actividades BLOQUEADA en este momento, con el promedio de días hábiles que llevan así.'
      }) +
      tarjetaKpiConDelta_({
        valor: kpis.reprogramaciones_promedio,
        delta: deltaBadge_(cmp.reprogramaciones_promedio, false),
        etiqueta: 'Reprogramaciones prom.',
        titulo: '1 es normal; varias indican mala estimación o alcance que crece.'
      }) +
      tarjetaKpiConDelta_({
        valor: kpis.pct_emergente === null ? '—' : kpis.pct_emergente + '%',
        delta: deltaBadge_(cmp.pct_emergente, false),
        etiqueta: '% trabajo emergente',
        titulo: 'De lo creado en el período, % que entró como EMERGENTE (no planificado). Si es sistemáticamente alto, planificar es teatro.'
      });
  }

  // §5.3: mapa de calor área×semana -- tabla simple con celdas coloreadas
  // (nada de gráficos decorativos), responde "¿dónde está el problema?" de
  // un vistazo. Sin datos comprometidos esa semana = celda gris ("—"), no
  // "0%" (0% sugeriría que hubo compromisos y todos fallaron).
  function renderHeatmapActividadesGerencia_(heatmap) {
    var cont = document.getElementById('ger-act-heatmap');
    if (!cont) return;
    if (!heatmap || heatmap.length === 0) {
      cont.innerHTML = Componentes.vacio('Sin actividades con fecha comprometida en las últimas semanas.');
      return;
    }
    var semanas = heatmap[0].semanas.map(function (s) { return s.etiqueta; });
    var encabezado = '<tr><th></th>' + semanas.map(function (s) {
      return '<th style="padding:6px;text-align:center;">' + Componentes.escaparHtml(s) + '</th>';
    }).join('') + '</tr>';
    var filas = heatmap.map(function (fila) {
      var celdas = fila.semanas.map(function (s) {
        var texto = s.total === 0 ? '—' : s.pct_cumplimiento + '%';
        return '<td style="background:' + colorHeatmapActividades_(s.total, s.pct_cumplimiento) +
          ';text-align:center;padding:6px;border-radius:4px;" title="' + s.total + ' comprometida(s) esta semana">' + texto + '</td>';
      }).join('');
      return '<tr><td style="padding:6px;font-weight:600;white-space:nowrap;">' + Componentes.escaparHtml(fila.area_nombre) + '</td>' + celdas + '</tr>';
    }).join('');
    cont.innerHTML = '<div style="overflow-x:auto;"><table style="border-collapse:separate;border-spacing:4px;width:100%;">' + encabezado + filas + '</table></div>';
  }

  function colorHeatmapActividades_(total, pct) {
    if (total === 0 || pct === null || pct === undefined) return '#EEF1F6';
    if (pct >= 80) return '#D7F2E3';
    if (pct >= 50) return '#FCEEC8';
    return '#F8D6D2';
  }

  // §5.3: tabla de actividades críticas -- P1/P2 atrasadas, en riesgo o
  // bloqueadas, transversal a todos los equipos (Actividades.getPanelGerencia
  // ya viene ordenada: atrasada primero, luego bloqueada, luego riesgo).
  function renderCriticasActividadesGerencia_(criticas) {
    var cont = document.getElementById('ger-act-criticas');
    if (!cont) return;
    if (!criticas || criticas.length === 0) {
      cont.innerHTML = Componentes.vacio('Sin actividades críticas: todo P1/P2 está al día.');
      return;
    }
    var filas = criticas.map(function (c) {
      return '<tr>' +
        '<td>' + Componentes.escaparHtml(c.titulo) + '</td>' +
        '<td>' + Componentes.escaparHtml(c.responsable_nombre) + '</td>' +
        '<td>' + Componentes.escaparHtml(c.area_nombre) + '</td>' +
        '<td>' + Componentes.escaparHtml(c.prioridad) + '</td>' +
        '<td>' + Componentes.escaparHtml(c.semaforo_etiqueta) + '</td>' +
        '<td>' + (c.fecha_compromiso ? Componentes.escaparHtml(fechaCortaActividadGerencia_(c.fecha_compromiso)) : '—') + '</td>' +
        '</tr>';
    }).join('');
    cont.innerHTML = '<table class="sigso-tabla"><thead><tr>' +
      '<th>Actividad</th><th>Responsable</th><th>Área</th><th>Prioridad</th><th>Semáforo</th><th>Vence</th>' +
      '</tr></thead><tbody>' + filas + '</tbody></table>';
  }

  function fechaCortaActividadGerencia_(iso) {
    return String(iso).replace('T', ' ').slice(0, 10);
  }

  // §4.8: "3 motores + filtros comunes" en pantalla. Mismo `reporte` (columnas
  // + filas + resumen) que arma el servidor sirve para pintar la tabla, para
  // el CSV (exportarCsvActividadesGerencia_) y, en el servidor, para el PDF.
  function cargarReporteActividadesGerencia_() {
    var cont = document.getElementById('ger-act-reporte');
    if (!cont) return;
    var tipo = document.getElementById('ger-act-tipo-reporte').value;
    var filtros = Object.assign({ tipo: tipo }, leerFiltrosActividadesGerencia_());
    cont.innerHTML = Componentes.cargando('Generando el reporte…');
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'generarReporteActividades', filtros)
      .then(function (r) {
        if (!r.ok) { cont.innerHTML = Componentes.alerta(r.message || 'No se pudo generar el reporte.', 'error'); return; }
        reporteActividadesActual = r.data;
        renderReporteActividadesGerencia_(r.data);
      })
      .catch(function (e) { cont.innerHTML = Componentes.alerta((e && e.message) || 'Error de conexión.', 'error'); });
  }

  function renderReporteActividadesGerencia_(reporte) {
    var cont = document.getElementById('ger-act-reporte');
    if (!cont) return;
    var resumenHtml = Object.keys(reporte.resumen || {}).map(function (clave) {
      var valor = reporte.resumen[clave];
      return '<span style="margin-right:16px;"><strong>' + Componentes.escaparHtml(clave.replace(/_/g, ' ')) + ':</strong> ' +
        Componentes.escaparHtml(valor === null || valor === undefined ? '—' : String(valor)) + '</span>';
    }).join('');
    if (!reporte.filas.length) {
      cont.innerHTML = '<p>' + resumenHtml + '</p>' + Componentes.vacio('Sin datos para los filtros elegidos.');
      return;
    }
    var encabezado = '<tr>' + reporte.columnas.map(function (c) {
      return '<th>' + Componentes.escaparHtml(c.etiqueta) + '</th>';
    }).join('') + '</tr>';
    var filas = reporte.filas.map(function (fila) {
      return '<tr>' + reporte.columnas.map(function (c) {
        var valor = fila[c.campo];
        return '<td>' + Componentes.escaparHtml(valor === null || valor === undefined || valor === '' ? '—' : String(valor)) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    cont.innerHTML = '<p>' + resumenHtml + '</p><div style="overflow-x:auto;"><table class="sigso-tabla"><thead>' + encabezado + '</thead><tbody>' + filas + '</tbody></table></div>';
  }

  // Mismo patron blob + <a download> que exportarCSV_ (dashboard.js) y
  // exportarCsvPausas_ (arriba en este archivo) -- exporta EXACTAMENTE el
  // reporte que se esta viendo, no vuelve a pedir datos al servidor.
  function exportarCsvActividadesGerencia_() {
    if (!reporteActividadesActual || !reporteActividadesActual.filas.length) {
      Componentes.aviso({ texto: 'Primero genera un reporte con "Ver".', tipo: 'error' });
      return;
    }
    var columnas = reporteActividadesActual.columnas;
    var lineas = [columnas.map(function (c) { return c.etiqueta; }).join(',')].concat(
      reporteActividadesActual.filas.map(function (fila) {
        return columnas.map(function (c) {
          var valor = fila[c.campo];
          return '"' + String(valor === null || valor === undefined ? '' : valor).replace(/"/g, '""') + '"';
        }).join(',');
      })
    );
    var blob = new Blob([lineas.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(blob);
    enlace.download = 'sigso-actividades-' + reporteActividadesActual.tipo + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
  }

  // §4.8 (formato PDF): el servidor arma el mismo reporte y lo convierte a
  // PDF (ReporteActividades.gs, mismo patron HTML->PDF que la Orden de
  // Trabajo, v5.2). Mismo decode base64 -> Blob -> <a download> que
  // descargarOrdenTrabajo_ (detalle.js).
  function descargarPdfActividadesGerencia_() {
    var tipo = document.getElementById('ger-act-tipo-reporte').value;
    var filtros = Object.assign({ tipo: tipo }, leerFiltrosActividadesGerencia_());
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'descargarReporteActividadesPdf', filtros)
      .then(function (r) {
        if (!r.ok) { Componentes.aviso({ texto: r.message || 'No se pudo generar el PDF.', tipo: 'error' }); return; }
        descargarPdfBase64ActividadesGerencia_(r.data.pdf_base64, r.data.filename);
      })
      .catch(function (e) { Componentes.aviso({ texto: (e && e.message) || 'Error de conexión.', tipo: 'error' }); });
  }

  // §4.8 ("extra propuesto"): la pauta de la reunión semanal, lista para
  // imprimir/proyectar -- venció / bloqueado / se reprogramó / vence la
  // semana entrante.
  function descargarActaReunionGerencia_() {
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'descargarActaReunionPdf', leerFiltrosActividadesGerencia_())
      .then(function (r) {
        if (!r.ok) { Componentes.aviso({ texto: r.message || 'No se pudo generar el acta.', tipo: 'error' }); return; }
        descargarPdfBase64ActividadesGerencia_(r.data.pdf_base64, r.data.filename);
      })
      .catch(function (e) { Componentes.aviso({ texto: (e && e.message) || 'Error de conexión.', tipo: 'error' }); });
  }

  function descargarPdfBase64ActividadesGerencia_(base64, filename) {
    var binario = atob(base64);
    var buffer = new Uint8Array(binario.length);
    for (var i = 0; i < binario.length; i++) buffer[i] = binario.charCodeAt(i);
    var blob = new Blob([buffer], { type: 'application/pdf' });
    var enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(blob);
    enlace.download = filename;
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
    setTimeout(function () { URL.revokeObjectURL(enlace.href); }, 1000);
  }
})();
