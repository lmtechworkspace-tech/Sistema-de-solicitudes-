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
    // Fase 10.1: busqueda por texto sobre lo ya cargado (recientesActuales),
    // sin golpear el backend en cada tecla -- igual que Agrupar. P6 (Sprint
    // 2): "Actualizar" SI manda este mismo texto como filtro de solicitante
    // al backend (Dashboard.coincideFiltros_), para buscar en TODAS las
    // solicitudes y no solo en las ultimas 50 (Gerencia necesita responder
    // "de que son los tickets de Juan" sin ese limite).
    document.getElementById('buscar-recientes').addEventListener('input', renderRecientes_);
    document.getElementById('btn-exportar-csv').addEventListener('click', exportarCSV_);
  }

  function leerFiltros_() {
    return {
      empresa_id: document.getElementById('filtro-empresa').value,
      estado: document.getElementById('filtro-estado').value,
      prioridad: document.getElementById('filtro-prioridad').value,
      solicitante: document.getElementById('buscar-recientes').value.trim()
    };
  }

  function cargarDashboard_() {
    var filtros = leerFiltros_();
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'getDashboardData', filtros).then(function (respuesta) {
      if (!respuesta.ok) {
        return respuesta;
      }
      renderKpis_(respuesta.data.resumen);
      renderAlertasPatron_(respuesta.data.alertas_patron || []);
      renderGrafico_('grafico-estado', 'bar', respuesta.data.por_estado);
      renderGrafico_('grafico-prioridad', 'doughnut', respuesta.data.por_prioridad);
      renderGrafico_('grafico-empresa', 'bar', respuesta.data.por_empresa);
      recientesActuales = respuesta.data.recientes;
      renderRecientes_();
      // v2.1 (Fase C): el Panel de Gerencia es "su vista principal" -- el
      // boton de acceso solo aparece para ese rol (el backend ya no
      // restringe la accion en si, pero no tiene sentido ofrecersela a
      // quien no es Gerencia).
      document.getElementById('btn-ver-gerencia').classList.toggle('sigso-oculto', respuesta.data.rol_actual !== 'GERENCIA');
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

  // P7 (v2.0, Sprint 3): "el modulo X acumula N reportes de tipo Error esta
  // semana -- posible causa raiz". Solo se muestra si hay algo que superar
  // umbral (no ensucia el dashboard cuando no hay patrones).
  function renderAlertasPatron_(alertas) {
    var contenedor = document.getElementById('contenedor-alertas-patron');
    if (!alertas.length) {
      contenedor.innerHTML = '';
      return;
    }
    contenedor.innerHTML = Componentes.tarjeta(
      '<h3>Alertas de patrón</h3>' +
      alertas.map(function (a) {
        return Componentes.alerta(
          '<strong>' + Componentes.escaparHtml(a.modulo) + '</strong> acumula ' + a.cantidad +
          ' reportes de tipo <strong>' + Componentes.escaparHtml(a.tipo) + '</strong> en los últimos 7 días (' +
          a.solicitantes_distintos + ' solicitantes distintos) — posible causa raíz.',
          'aviso'
        );
      }).join('')
    );
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
    var filtradas = filtrarPorTexto_(recientesActuales);

    if (!campoAgrupar) {
      contenedor.innerHTML = filtradas.map(renderFilaReciente_).join('') ||
        Componentes.vacio('No hay solicitudes que coincidan con los filtros.');
    } else {
      contenedor.innerHTML = agruparPara_(filtradas, campoAgrupar).map(function (grupo) {
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

  // Busqueda client-side sobre lo ya cargado: N de solicitud, solicitante,
  // correo, empresa y modulo (Fase 10.1, pedido explicito: "que sea facil
  // buscar" en Solicitudes recientes).
  function filtrarPorTexto_(lista) {
    var texto = document.getElementById('buscar-recientes').value.trim().toLowerCase();
    if (!texto) return lista;
    return lista.filter(function (s) {
      return [s.solicitud_id, s.solicitante_nombre, s.solicitante_email, s.empresa_id, s.modulo]
        .some(function (campo) { return String(campo || '').toLowerCase().indexOf(texto) !== -1; });
    });
  }

  function agruparPara_(lista, campo) {
    var etiquetador = campo === 'estado_derivado' ? formatearEstadoSigso : function (v) { return v; };
    var grupos = {};
    lista.forEach(function (s) {
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
    // P5 (v2.0, Sprint 3): badge visual de "respuesta recibida" -- para que
    // Leo no dependa solo de encontrar el correo entre el resto de avisos.
    var badgeRespuesta = s.respuesta_pendiente ? ' ' + Componentes.badge('Respuesta recibida', 'P2') : '';
    return '<div class="sigso-fila-reciente" data-id="' + s.solicitud_id + '">' +
      '<div class="sigso-fila-reciente__principal">' +
      Componentes.badgePrioridad(s.prioridad_derivada) + ' ' +
      '<strong>' + s.solicitud_id + '</strong> ' +
      Componentes.badgeEstado(s.estado_derivado) + badgeRespuesta +
      '</div>' +
      '<div class="sigso-fila-reciente__meta">' +
      s.empresa_id + ' &middot; ' + s.plataforma + ' / ' + s.modulo + ' &middot; ' +
      s.cantidad_items + ' item(s) &middot; ' +
      (s.asignado_a ? Componentes.escaparHtml(s.asignado_a) : 'Sin asignar') +
      (sla ? ' &middot; ' + sla : '') +
      '</div>' +
      '</div>';
  }

  // P6 (v2.0, Sprint 2): Gerencia necesita responderle a su jefe sin entrar
  // al sistema -- exporta exactamente lo que esta viendo (recientes +
  // filtro de texto ya aplicado), no un volcado completo aparte.
  function exportarCSV_() {
    var filas = filtrarPorTexto_(recientesActuales);
    var encabezado = ['solicitud_id', 'empresa_id', 'plataforma', 'modulo', 'estado_derivado', 'prioridad_derivada', 'solicitante_nombre', 'solicitante_email', 'asignado_a', 'cantidad_items', 'fecha_creacion'];
    var lineas = [encabezado.join(',')].concat(filas.map(function (s) {
      return encabezado.map(function (campo) {
        return '"' + String(s[campo] || '').replace(/"/g, '""') + '"';
      }).join(',');
    }));
    var blob = new Blob([lineas.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(blob);
    enlace.download = 'sigso-solicitudes-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
  }

  function renderIndicadorSla_(horas) {
    if (horas === null || horas === undefined) return '';
    if (horas < 0) return Componentes.badge('Fuera de plazo', 'P1');
    return 'Vence en ' + horas + 'h';
  }
})();
