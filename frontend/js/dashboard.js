/**
 * dashboard.js — Backoffice: KPIs, graficos y tabla de recientes (§12.4).
 */
(function () {
  var graficos = {};

  window.SigsoDashboard = { cargar: cargarDashboard_, inicializarFiltros: inicializarFiltros_ };

  function inicializarFiltros_() {
    var empresas = ['HP', 'RLD'];
    var selectEmpresa = document.getElementById('filtro-empresa');
    empresas.forEach(function (id) {
      var opcion = document.createElement('option');
      opcion.value = id;
      opcion.textContent = id;
      selectEmpresa.appendChild(opcion);
    });

    var selectEstado = document.getElementById('filtro-estado');
    Object.keys(SIGSO_ESTADOS_LABEL).forEach(function (codigo) {
      var opcion = document.createElement('option');
      opcion.value = codigo;
      opcion.textContent = codigo + ' — ' + SIGSO_ESTADOS_LABEL[codigo];
      selectEstado.appendChild(opcion);
    });
  }

  function leerFiltros_() {
    return {
      empresa_id: document.getElementById('filtro-empresa').value,
      estado: document.getElementById('filtro-estado').value,
      prioridad: document.getElementById('filtro-prioridad').value
    };
  }

  function cargarDashboard_() {
    var filtros = leerFiltros_();
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'getDashboardData', filtros).then(function (respuesta) {
      if (!respuesta.ok) {
        return respuesta;
      }
      renderKpis_(respuesta.data.resumen);
      renderGrafico_('grafico-estado', 'bar', respuesta.data.por_estado);
      renderGrafico_('grafico-prioridad', 'doughnut', respuesta.data.por_prioridad);
      renderGrafico_('grafico-empresa', 'bar', respuesta.data.por_empresa);
      renderTablaRecientes_(respuesta.data.recientes);
      return respuesta;
    });
  }

  function renderKpis_(resumen) {
    document.getElementById('kpi-abiertas').textContent = resumen.total_abiertas;
    document.getElementById('kpi-criticas').textContent = resumen.criticas_activas;
    document.getElementById('kpi-sla-vencido').textContent = resumen.sla_vencido;
    document.getElementById('kpi-del-dia').textContent = resumen.del_dia;
  }

  function renderGrafico_(idCanvas, tipo, datosAgrupados) {
    var ctx = document.getElementById(idCanvas);
    if (graficos[idCanvas]) {
      graficos[idCanvas].destroy();
    }
    graficos[idCanvas] = new Chart(ctx, {
      type: tipo,
      data: {
        labels: datosAgrupados.map(function (d) { return d.clave; }),
        datasets: [{
          data: datosAgrupados.map(function (d) { return d.total; }),
          backgroundColor: ['#E8622A', '#1F4E79', '#27AE60', '#F1C40F', '#C0392B', '#2980B9', '#E67E22']
        }]
      },
      options: { plugins: { legend: { display: tipo === 'doughnut' } } }
    });
  }

  function renderTablaRecientes_(recientes) {
    var cuerpo = document.getElementById('tabla-recientes');
    cuerpo.innerHTML = recientes.map(function (s) {
      return '<tr data-id="' + s.solicitud_id + '">' +
        '<td>' + s.solicitud_id + '</td>' +
        '<td>' + s.empresa_id + '</td>' +
        '<td>' + s.plataforma + ' / ' + s.modulo + '</td>' +
        '<td>' + formatearEstadoSigso(s.estado_derivado) + '</td>' +
        '<td><span class="sigso-badge sigso-badge--' + s.prioridad_derivada + '">' + s.prioridad_derivada + '</span></td>' +
        '</tr>';
    }).join('');

    cuerpo.querySelectorAll('tr').forEach(function (fila) {
      fila.addEventListener('click', function () {
        if (typeof window.SigsoApp !== 'undefined') {
          window.SigsoApp.mostrarDetalle(fila.getAttribute('data-id'));
        }
      });
    });
  }
})();
