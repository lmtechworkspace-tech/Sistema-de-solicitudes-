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

    // Agrupar es solo de presentacion (no dispara una nueva consulta al
    // backend): reordena lo que ya se cargo.
    document.getElementById('filtro-agrupar').addEventListener('change', renderRecientes_);
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
      recientesActuales = respuesta.data.recientes;
      renderRecientes_();
      return respuesta;
    });
  }

  var recientesActuales = [];

  function renderKpis_(resumen) {
    document.getElementById('contenedor-kpis').innerHTML =
      Componentes.kpi({ valor: resumen.total_abiertas, etiqueta: 'Abiertas', titulo: 'Solicitudes que aun no estan cerradas, rechazadas ni canceladas.' }) +
      Componentes.kpi({ valor: resumen.criticas_activas, etiqueta: 'Criticas activas', alerta: true, titulo: 'Solicitudes abiertas de prioridad P1 (la mas alta).' }) +
      Componentes.kpi({ valor: resumen.sla_vencido, etiqueta: 'Fuera de plazo', alerta: true, titulo: 'Items que ya pasaron su tiempo objetivo de respuesta segun la prioridad (P1: 2h, P2: 24h, P3: 72h, P4: 120h; en horas habiles).' }) +
      Componentes.kpi({ valor: resumen.del_dia, etiqueta: 'Ingresadas hoy', titulo: 'Solicitudes creadas hoy.' });
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

  // Fase 10 (rediseno UX): Leo debe entender una solicitud en <10s desde la
  // fila, sin entrar al detalle -- cantidad de items, SLA restante y a
  // quien esta asignada (ya vienen enriquecidos desde Dashboard.gs).
  function renderRecientes_() {
    var contenedor = document.getElementById('lista-recientes');
    var campoAgrupar = document.getElementById('filtro-agrupar').value;

    if (!campoAgrupar) {
      contenedor.innerHTML = recientesActuales.map(renderFilaReciente_).join('') ||
        Componentes.vacio('No hay solicitudes que coincidan con los filtros.');
    } else {
      contenedor.innerHTML = agruparPara_(campoAgrupar).map(function (grupo) {
        return '<h4 class="sigso-grupo__titulo">' + Componentes.escaparHtml(grupo.etiqueta) + ' (' + grupo.filas.length + ')</h4>' +
          grupo.filas.map(renderFilaReciente_).join('');
      }).join('') || Componentes.vacio('No hay solicitudes que coincidan con los filtros.');
    }

    contenedor.querySelectorAll('[data-id]').forEach(function (fila) {
      fila.addEventListener('click', function () {
        if (typeof window.SigsoApp !== 'undefined') {
          window.SigsoApp.mostrarDetalle(fila.getAttribute('data-id'));
        }
      });
    });
  }

  function agruparPara_(campo) {
    var etiquetador = campo === 'estado_derivado' ? formatearEstadoSigso : function (v) { return v; };
    var grupos = {};
    recientesActuales.forEach(function (s) {
      var clave = s[campo] || '(sin dato)';
      if (!grupos[clave]) grupos[clave] = [];
      grupos[clave].push(s);
    });
    return Object.keys(grupos).map(function (clave) {
      return { etiqueta: etiquetador(clave), filas: grupos[clave] };
    });
  }

  function renderFilaReciente_(s) {
    var sla = renderIndicadorSla_(s.sla_restante_horas);
    return '<div class="sigso-fila-reciente" data-id="' + s.solicitud_id + '">' +
      '<div class="sigso-fila-reciente__principal">' +
      Componentes.badgePrioridad(s.prioridad_derivada) + ' ' +
      '<strong>' + s.solicitud_id + '</strong> ' +
      Componentes.badgeEstado(s.estado_derivado) +
      '</div>' +
      '<div class="sigso-fila-reciente__meta">' +
      s.empresa_id + ' &middot; ' + s.plataforma + ' / ' + s.modulo + ' &middot; ' +
      s.cantidad_items + ' item(s) &middot; ' +
      (s.asignado_a ? Componentes.escaparHtml(s.asignado_a) : 'Sin asignar') +
      (sla ? ' &middot; ' + sla : '') +
      '</div>' +
      '</div>';
  }

  function renderIndicadorSla_(horas) {
    if (horas === null || horas === undefined) return '';
    if (horas < 0) return Componentes.badge('Fuera de plazo', 'P1');
    return 'Vence en ' + horas + 'h';
  }
})();
