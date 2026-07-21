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

    // UI-5 (§4): tabs Resumen/Analisis -- los graficos (tendencias) no son
    // el trabajo del dia a dia, se sacan de la vista principal.
    document.getElementById('tabs-dashboard').querySelectorAll('[data-tab]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        var tab = boton.getAttribute('data-tab');
        document.getElementById('tabs-dashboard').querySelectorAll('[data-tab]').forEach(function (b) {
          b.classList.toggle('sigso-tabs__boton--activo', b === boton);
        });
        document.getElementById('tab-resumen').classList.toggle('sigso-oculto', tab !== 'resumen');
        document.getElementById('tab-analisis').classList.toggle('sigso-oculto', tab !== 'analisis');
      });
    });

    wireDerivarLote_();
  }

  function leerFiltros_() {
    return {
      empresa_id: document.getElementById('filtro-empresa').value,
      estado: document.getElementById('filtro-estado').value,
      prioridad: document.getElementById('filtro-prioridad').value,
      solicitante: document.getElementById('buscar-recientes').value.trim(),
      // v3.0 (Fase 2): solo tiene efecto para ADM/GERENCIA (Dashboard.
      // aplicarAmbitoRol_) -- un responsable individual ya esta acotado a
      // su propia bandeja sin importar este valor.
      verBandeja: document.getElementById('filtro-bandeja').value
    };
  }

  function cargarDashboard_() {
    var filtros = leerFiltros_();
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'getDashboardData', filtros).then(function (respuesta) {
      if (!respuesta.ok) {
        // Antes un error del backend dejaba el dashboard en blanco sin avisar
        // (parecia "no hay solicitudes"). Ahora se muestra el error para que
        // se distinga un fallo real de una lista vacia legitima.
        document.getElementById('lista-recientes').innerHTML =
          Componentes.alerta((respuesta.message || 'No se pudieron cargar las solicitudes.') +
            ' Reintenta con "Actualizar"; si persiste, avisa a soporte.', 'error');
        return respuesta;
      }
      renderKpis_(respuesta.data.resumen);
      renderAlertasPatron_(respuesta.data.alertas_patron || []);
      renderGrafico_('grafico-estado', 'bar', respuesta.data.por_estado);
      renderGrafico_('grafico-prioridad', 'doughnut', respuesta.data.por_prioridad);
      renderGrafico_('grafico-empresa', 'bar', respuesta.data.por_empresa);
      recientesActuales = respuesta.data.recientes;
      renderRequierenAccion_();
      renderRecientes_();
      // v2.1 (Fase C): el Panel de Gerencia es "su vista principal" -- el
      // boton de acceso solo aparece para ese rol (el backend ya no
      // restringe la accion en si, pero no tiene sentido ofrecersela a
      // quien no es Gerencia).
      document.getElementById('btn-ver-gerencia').classList.toggle('sigso-oculto', respuesta.data.rol_actual !== 'GERENCIA');
      // v4.2: mismo criterio para el acceso a "Mi departamento".
      var botonJefatura = document.getElementById('btn-ver-jefatura');
      if (botonJefatura) botonJefatura.classList.toggle('sigso-oculto', respuesta.data.rol_actual !== 'JEFATURA');
      renderSelectorBandeja_(respuesta.data);
      return respuesta;
    });
  }

  // v3.0 (Fase 2, multi-bandeja): un responsable individual (DEV) ya viene
  // auto-acotado del backend -- solo se le avisa.
  // v4.1.1 (hallazgo real: Gerencia veia TODAS las solicitudes en su
  // bandeja): solo ADM recibe la lista de responsables activos
  // (Dashboard.getData) y puede elegir de quien mirar la bandeja, o
  // "Todas" para ver sin acotar. Cualquier otro rol (GERENCIA incluida)
  // queda igual de auto-acotado que DEV -- Gerencia sigue viendo todo
  // desde el Panel de Gerencia, no desde aca.
  function renderSelectorBandeja_(data) {
    var filaSelector = document.getElementById('fila-bandeja');
    var aviso = document.getElementById('aviso-mi-bandeja');
    var select = document.getElementById('filtro-bandeja');

    if (data.rol_actual !== 'ADM') {
      filaSelector.classList.add('sigso-oculto');
      aviso.classList.remove('sigso-oculto');
      return;
    }
    aviso.classList.add('sigso-oculto');

    if (!data.responsables || data.responsables.length === 0) {
      filaSelector.classList.add('sigso-oculto');
      return;
    }
    // Repuebla preservando la seleccion actual (mismo patron que
    // poblarSelect_ en formulario.js) -- evita perder el filtro elegido
    // cada vez que "Actualizar" vuelve a traer datos.
    var actual = select.value;
    select.innerHTML = '<option value="">Todas (sin acotar)</option>' +
      data.responsables.map(function (r) {
        return '<option value="' + r.email + '">' + Componentes.escaparHtml(r.nombre) + '</option>';
      }).join('');
    select.value = actual;
    filaSelector.classList.remove('sigso-oculto');
    renderDerivarLote_(data);
  }

  // v3.1 (§2.6): el traspaso masivo de una bandeja a otra. Solo se ofrece
  // con una bandeja concreta elegida -- "Todas" derivaria trabajo de gente
  // distinta de una sola vez, que nunca es lo que se quiere.
  function renderDerivarLote_(data) {
    var bloque = document.getElementById('bloque-derivar-lote');
    if (!bloque) return;

    var bandeja = document.getElementById('filtro-bandeja').value;
    var puedeDerivar = data.rol_actual === 'ADM' || data.rol_actual === 'ANA';
    var abiertas = solicitudesAbiertasVisibles_();

    if (!bandeja || !puedeDerivar || abiertas.length === 0) {
      bloque.classList.add('sigso-oculto');
      return;
    }

    var select = document.getElementById('lote-responsable');
    var actual = select.value;
    select.innerHTML = '<option value="">Elige responsable…</option>' +
      (data.responsables || [])
        .filter(function (r) { return r.email !== bandeja; })
        .map(function (r) {
          return '<option value="' + r.email + '">' + Componentes.escaparHtml(r.nombre) + '</option>';
        }).join('');
    select.value = actual;

    document.getElementById('resumen-derivar-lote').textContent =
      'Hay ' + abiertas.length + ' solicitud' + (abiertas.length === 1 ? '' : 'es') +
      ' abierta' + (abiertas.length === 1 ? '' : 's') + ' en esta bandeja.';
    bloque.classList.remove('sigso-oculto');
  }

  // Solo las abiertas: derivar una solicitud ya cerrada no le sirve a nadie
  // y ensuciaria el historial del nuevo responsable.
  function solicitudesAbiertasVisibles_() {
    return recientesActuales.filter(function (s) {
      return ESTADOS_CERRADOS_CLIENTE.indexOf(s.estado_derivado) === -1;
    });
  }

  function wireDerivarLote_() {
    var boton = document.getElementById('btn-derivar-lote');
    if (!boton) return;
    boton.addEventListener('click', function () {
      var responsable = document.getElementById('lote-responsable').value;
      var motivo = document.getElementById('lote-motivo').value;
      var salida = document.getElementById('resultado-derivar-lote');
      var abiertas = solicitudesAbiertasVisibles_();

      if (!responsable) { salida.textContent = 'Elige a quién derivar.'; return; }
      if (motivo.trim().length < 10) { salida.textContent = 'El motivo debe tener al menos 10 caracteres.'; return; }
      if (abiertas.length === 0) { salida.textContent = 'No hay solicitudes abiertas que derivar.'; return; }

      // Confirmacion con el conteo explicito: es la accion mas masiva del
      // Backoffice y no hay "deshacer". Por eso va marcada como peligro.
      var texto = document.getElementById('lote-responsable').selectedOptions[0].textContent;
      Componentes.confirmar({
        titulo: 'Derivar ' + abiertas.length + ' solicitudes',
        mensaje: 'Pasaran a ' + texto + '. Esta accion no se puede deshacer.',
        confirmar: 'Derivar ' + abiertas.length,
        peligro: true
      }).then(function (confirmado) {
        if (confirmado) { derivar_(boton, salida, abiertas, responsable, motivo); }
      });
    });
  }

  function derivar_(boton, salida, abiertas, responsable, motivo) {
    boton.disabled = true;
    salida.textContent = 'Derivando…';
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'derivarSolicitud', {
      solicitud_ids: abiertas.map(function (s) { return s.solicitud_id; }),
      responsable_nuevo: responsable,
      motivo: motivo
    }).then(function (respuesta) {
      boton.disabled = false;
      if (!respuesta.ok) {
        salida.textContent = respuesta.message || 'No se pudo derivar.';
        Componentes.aviso({ tipo: 'error', texto: respuesta.message || 'No se pudo derivar.' });
        return;
      }
      salida.textContent = '';
      Componentes.aviso({ tipo: 'exito', texto: respuesta.data.total + ' solicitudes derivadas.' });
      document.getElementById('lote-motivo').value = '';
      cargarDashboard_();
    }).catch(function () {
      boton.disabled = false;
      salida.textContent = 'No se pudo conectar con el servidor. Intenta nuevamente.';
    });
  }

  var recientesActuales = [];
  // UI-5 (§4): KPI accionable -- clic filtra "Solicitudes recientes" abajo
  // sin golpear el backend de nuevo (mismo patron que categoriaActiva en
  // gerencia.js). null = sin filtro de KPI activo.
  var kpiActivo = null;
  var ESTADOS_CERRADOS_CLIENTE = ['S09', 'S10', 'S11'];

  function renderKpis_(resumen) {
    document.getElementById('contenedor-kpis').innerHTML =
      Componentes.kpi({ valor: resumen.total_abiertas, etiqueta: 'Abiertas', titulo: 'Solicitudes que aun no estan cerradas, rechazadas ni canceladas. Clic para filtrar.', filtro: 'abiertas', activo: kpiActivo === 'abiertas' }) +
      Componentes.kpi({ valor: resumen.criticas_activas, etiqueta: 'Criticas activas', alerta: true, titulo: 'Solicitudes abiertas de prioridad P1 (la mas alta). Clic para filtrar.', filtro: 'criticas', activo: kpiActivo === 'criticas' }) +
      Componentes.kpi({ valor: resumen.sla_vencido, etiqueta: 'Fuera de plazo', alerta: true, titulo: 'Items que ya pasaron su tiempo objetivo de respuesta segun la prioridad (P1: 2h, P2: 24h, P3: 72h, P4: 120h; en horas habiles). Clic para filtrar.', filtro: 'fuera_plazo', activo: kpiActivo === 'fuera_plazo' }) +
      Componentes.kpi({ valor: resumen.del_dia, etiqueta: 'Ingresadas hoy', titulo: 'Solicitudes creadas hoy. Clic para filtrar.', filtro: 'hoy', activo: kpiActivo === 'hoy' });

    document.getElementById('contenedor-kpis').querySelectorAll('[data-filtro-kpi]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        var filtro = boton.getAttribute('data-filtro-kpi');
        kpiActivo = kpiActivo === filtro ? null : filtro;
        renderKpis_(resumen);
        renderRecientes_();
      });
    });
  }

  // UI-5 (§4): "Requieren tu accion" -- lo primero que Leo deberia ver, antes
  // que cualquier numero decorativo. Se arma client-side sobre lo ya cargado
  // (misma fuente que "Solicitudes recientes"), sin pedirle nada nuevo al
  // backend.
  function requierenAccion_() {
    return recientesActuales.filter(function (s) {
      return (s.sla_restante_horas !== null && s.sla_restante_horas !== undefined && s.sla_restante_horas < 0) ||
        s.respuesta_pendiente ||
        (s.prioridad_derivada === 'P1' && ESTADOS_CERRADOS_CLIENTE.indexOf(s.estado_derivado) === -1);
    });
  }

  function renderRequierenAccion_() {
    var contenedor = document.getElementById('contenedor-requieren-accion');
    var items = requierenAccion_();
    if (items.length === 0) {
      contenedor.innerHTML = '';
      return;
    }
    contenedor.innerHTML = Componentes.tarjeta(
      '<h3>Requieren tu acción (' + items.length + ')</h3>' +
      items.map(renderFilaReciente_).join('')
    );
    contenedor.querySelectorAll('[data-id]').forEach(function (fila) {
      fila.addEventListener('click', function () {
        if (typeof window.SigsoApp !== 'undefined') {
          window.SigsoApp.mostrarDetalle(fila.getAttribute('data-id'));
        }
      });
    });
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
          // v5.0 (F1): paleta categorial del Design System (indigo primero,
          // luego semanticos) -- antes usaba los hex de la marca 2023.
          backgroundColor: ['#6D5DF6', '#2563EB', '#1F7A55', '#CA9A04', '#C2362B', '#D97706', '#8A93A5']
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
    var filtradas = filtrarPorKpi_(filtrarPorTexto_(recientesActuales));

    if (!campoAgrupar) {
      contenedor.innerHTML = filtradas.map(renderFilaReciente_).join('') ||
        Componentes.vacio({
          icono: 'filtro',
          texto: 'Ninguna solicitud coincide con los filtros.',
          detalle: 'Limpia el buscador o vuelve a "Todos los estados" para ver la bandeja completa.'
        });
    } else {
      contenedor.innerHTML = agruparPara_(filtradas, campoAgrupar).map(function (grupo) {
        return '<h4 class="sigso-grupo__titulo">' + Componentes.escaparHtml(grupo.etiqueta) + ' (' + grupo.filas.length + ')</h4>' +
          grupo.filas.map(renderFilaReciente_).join('');
      }).join('') || Componentes.vacio({
          icono: 'filtro',
          texto: 'Ninguna solicitud coincide con los filtros.',
          detalle: 'Limpia el buscador o vuelve a "Todos los estados" para ver la bandeja completa.'
        });
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

  // UI-5 (§4): aplica el KPI accionable elegido arriba, sobre lo mismo que
  // ya filtro el buscador -- ambos filtros se combinan (AND), no se pisan.
  function filtrarPorKpi_(lista) {
    if (!kpiActivo) return lista;
    var hoy = new Date().toDateString();
    return lista.filter(function (s) {
      var abierta = ESTADOS_CERRADOS_CLIENTE.indexOf(s.estado_derivado) === -1;
      if (kpiActivo === 'abiertas') return abierta;
      if (kpiActivo === 'criticas') return abierta && s.prioridad_derivada === 'P1';
      if (kpiActivo === 'fuera_plazo') return s.sla_restante_horas !== null && s.sla_restante_horas !== undefined && s.sla_restante_horas < 0;
      if (kpiActivo === 'hoy') return new Date(s.fecha_creacion).toDateString() === hoy;
      return true;
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

  // v4.0 Frente 4: la fila gana jerarquia (ID + estado grandes, el resto
  // secundario) y una barra de SLA en vez del semaforo de emoji (🔴🟡🟢) --
  // una barra que se llena con la urgencia se escanea mas rapido que un
  // circulo de color o un numero suelto ("Vence en Xh").
  function renderFilaReciente_(s) {
    var sla = Componentes.barraSla(s.sla_restante_horas);
    // P5 (v2.0, Sprint 3): badge visual de "respuesta recibida" -- para que
    // Leo no dependa solo de encontrar el correo entre el resto de avisos.
    var badgeRespuesta = s.respuesta_pendiente ? ' ' + Componentes.badge('Respuesta recibida', 'P2') : '';
    return '<div class="sigso-fila-reciente" data-id="' + s.solicitud_id + '">' +
      '<div class="sigso-fila-reciente__principal">' +
      Componentes.badgePrioridad(s.prioridad_derivada) + ' ' +
      '<strong class="sigso-id">' + s.solicitud_id + '</strong> ' +
      Componentes.badgeEstado(s.estado_derivado) + badgeRespuesta +
      '</div>' +
      '<div class="sigso-fila-reciente__meta">' +
      s.empresa_id + ' &middot; ' + s.plataforma + ' / ' + s.modulo + ' &middot; ' +
      s.cantidad_items + ' item(s) &middot; ' +
      (s.asignado_a ? Componentes.escaparHtml(s.asignado_a) : 'Sin asignar') +
      '</div>' +
      (sla ? '<div class="sigso-fila-reciente__sla">' + sla + '</div>' : '') +
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
})();
