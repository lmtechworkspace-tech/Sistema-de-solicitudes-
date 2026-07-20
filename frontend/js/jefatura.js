/**
 * jefatura.js — v4.2 (documentacion/SIGSO-v4.2-propuestas-modulo-jefatura.md):
 * Panel de Jefatura, "Mi Departamento". Consume Jefatura.getPanel
 * (Backoffice) -- un "Gerencia acotado": misma clase de informacion que el
 * Panel de Gerencia, pero SIEMPRE recortada al equipo del jefe (nunca al
 * sistema completo). El aislamiento ya lo impone el servidor; este archivo
 * solo dibuja lo que llega.
 *
 * Drill-down reutiliza SigsoApp.mostrarDetalle (mismo detalle que Gerencia,
 * de solo lectura -- Solicitudes.getDetalle ademas valida que la solicitud
 * sea del equipo del jefe antes de devolverla).
 */
(function () {
  window.SigsoJefatura = { cargar: cargarJefatura_ };

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-jef-tab]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        document.querySelectorAll('[data-jef-tab]').forEach(function (b) {
          b.classList.remove('sigso-tabs__boton--activo');
        });
        boton.classList.add('sigso-tabs__boton--activo');
        var tab = boton.getAttribute('data-jef-tab');
        document.getElementById('jef-panel-tablero').classList.toggle('sigso-oculto', tab !== 'tablero');
        document.getElementById('jef-panel-persona').classList.toggle('sigso-oculto', tab !== 'persona');
        document.getElementById('jef-panel-carga').classList.toggle('sigso-oculto', tab !== 'carga');
      });
    });
  });

  function cargarJefatura_() {
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'getPanelJefatura', {})
      .then(function (respuesta) {
        if (!respuesta.ok) {
          document.getElementById('jef-contenedor-kpis').innerHTML =
            Componentes.alerta(respuesta.message || 'No se pudo cargar el panel.', 'error');
          return respuesta;
        }
        var datos = respuesta.data;
        if (datos.equipo.length === 0) {
          document.getElementById('jef-contenedor-kpis').innerHTML = '';
          document.getElementById('jef-panel-hoy').classList.add('sigso-oculto');
          document.getElementById('jef-contenedor-tablero').innerHTML = Componentes.vacio(
            'Todavía no tienes a nadie a cargo. Pídele al Administrador que te asigne tu equipo en Administración → Jefaturas.'
          );
          return respuesta;
        }
        document.getElementById('jef-panel-hoy').classList.remove('sigso-oculto');
        renderKpis_(datos.kpis);
        renderHoy_(datos.hoy);
        renderTablero_(datos.items);
        renderPorPersona_(datos.por_persona);
        renderCarga_(datos.carga);
        return respuesta;
      });
  }

  function renderKpis_(kpis) {
    document.getElementById('jef-contenedor-kpis').innerHTML =
      Componentes.kpi({ valor: kpis.abiertas, etiqueta: 'Abiertas del equipo' }) +
      Componentes.kpi({
        valor: kpis.en_riesgo_o_atrasadas, etiqueta: 'En riesgo o atrasadas',
        alerta: kpis.en_riesgo_o_atrasadas > 0
      }) +
      Componentes.kpi({
        valor: kpis.esperando_validacion, etiqueta: 'Esperando validación',
        alerta: kpis.esperando_validacion > 0,
        titulo: 'Entregado a alguien de tu equipo, todavía sin confirmar.'
      }) +
      Componentes.kpi({
        valor: kpis.pct_cumplimiento === null ? '—' : kpis.pct_cumplimiento + '%',
        etiqueta: '% cumplimiento del equipo'
      }) +
      Componentes.kpi({ valor: kpis.dias_promedio_resolucion, etiqueta: 'Días prom. resolución' });
  }

  // v4.2 (§4): "al finalizar el dia poder ver que ocurrio en su
  // departamento" -- lo que la jefatura pidio explicitamente.
  function renderHoy_(hoy) {
    var r = hoy.resumen;
    var contenedor = document.getElementById('jef-contenedor-hoy');
    var totalHoy = r.nuevas + r.avanzaron + r.cerradas + r.en_riesgo + r.requieren_accion;
    if (totalHoy === 0) {
      contenedor.innerHTML = Componentes.vacio('Sin novedades hoy en tu equipo.');
      return;
    }
    contenedor.innerHTML =
      bloqueHoy_('🆕 Nuevas (' + r.nuevas + ')', hoy.nuevas) +
      bloqueHoy_('➡️ Avanzaron (' + r.avanzaron + ')', hoy.avanzaron) +
      bloqueHoy_('✅ Cerradas hoy (' + r.cerradas + ')', hoy.cerradas) +
      bloqueHoy_('🔴 En riesgo o vencidas (' + r.en_riesgo + ')', hoy.en_riesgo_o_vencidas) +
      bloqueHoy_('⏳ Esperando validación de tu equipo (' + r.requieren_accion + ')', hoy.requieren_accion);
    contenedor.querySelectorAll('[data-id]').forEach(function (fila) {
      fila.addEventListener('click', function () {
        window.SigsoApp.mostrarDetalle(fila.getAttribute('data-id'));
      });
    });
  }

  function bloqueHoy_(titulo, items) {
    if (!items.length) return '';
    return '<div class="sigso-jefatura-bloque-hoy"><h4>' + Componentes.escaparHtml(titulo) + '</h4>' +
      items.map(function (i) {
        return '<div class="sigso-fila-reciente" data-id="' + i.solicitud_id + '">' +
          '<div class="sigso-fila-reciente__principal">' +
          '<strong class="sigso-id">' + Componentes.escaparHtml(i.solicitud_id + '-' + i.numero_item) + '</strong> ' +
          Componentes.escaparHtml(i.titulo) + ' — ' + i.semaforo +
          '</div>' +
          '<div class="sigso-fila-reciente__meta">' + Componentes.escaparHtml(i.solicitante_nombre || '') +
          (i.desarrollador_nombre ? ' · ' + Componentes.escaparHtml(i.desarrollador_nombre) : '') + '</div>' +
          '</div>';
      }).join('') + '</div>';
  }

  function truncar_(texto, maxLargo) {
    var t = String(texto || '');
    return t.length > maxLargo ? t.slice(0, maxLargo - 1) + '…' : t;
  }

  function renderTablero_(items) {
    var contenedor = document.getElementById('jef-contenedor-tablero');
    if (items.length === 0) {
      contenedor.innerHTML = Componentes.vacio('No hay solicitudes de tu equipo con estos filtros.');
      return;
    }
    var encabezado = '<tr><th>Solicitud</th><th>Título</th><th>Tipo</th><th>Módulo</th>' +
      '<th>Solicitante</th><th>Responsable</th><th>Estado</th><th>Prioridad</th><th>Semáforo</th></tr>';
    var cuerpo = items.map(function (i) {
      return '<tr data-id="' + i.solicitud_id + '">' +
        '<td class="sigso-id">' + Componentes.escaparHtml(i.solicitud_id + '-' + i.numero_item) + '</td>' +
        '<td title="' + Componentes.escaparHtml(i.titulo || '') + '">' + Componentes.escaparHtml(truncar_(i.titulo, 40)) + '</td>' +
        '<td>' + Componentes.escaparHtml(i.tipo_nombre || '—') + '</td>' +
        '<td>' + Componentes.escaparHtml(i.modulo_nombre || '—') + '</td>' +
        '<td' + (i.persona_solicitante ? ' style="font-weight:600"' : '') + '>' + Componentes.escaparHtml(i.solicitante_nombre || '') + '</td>' +
        '<td' + (i.persona_resolutor ? ' style="font-weight:600"' : '') + '>' + Componentes.escaparHtml(i.desarrollador_nombre || i.desarrollador_asignado || '—') + '</td>' +
        '<td>' + Componentes.badgeEstado(i.estado) + '</td>' +
        '<td>' + Componentes.badgePrioridad(i.prioridad) + '</td>' +
        '<td>' + i.cumplimiento.emoji + ' ' + Componentes.escaparHtml(i.cumplimiento.etiqueta) + '</td>' +
        '</tr>';
    }).join('');
    contenedor.innerHTML = '<div style="overflow-x:auto"><table class="sigso-tabla-tablero"><thead>' + encabezado + '</thead><tbody>' + cuerpo + '</tbody></table></div>';
    contenedor.querySelectorAll('[data-id]').forEach(function (fila) {
      fila.addEventListener('click', function () {
        window.SigsoApp.mostrarDetalle(fila.getAttribute('data-id'));
      });
    });
  }

  // v4.2 (§5): Lisseth ve a Vanessa individual.
  function renderPorPersona_(porPersona) {
    var contenedor = document.getElementById('jef-contenedor-persona');
    if (!porPersona.length) {
      contenedor.innerHTML = Componentes.vacio('Sin equipo.');
      return;
    }
    var encabezado = '<tr><th>Persona</th><th>Reportó (abiertas / total)</th><th>Esperando validar</th>' +
      '<th>Tiene asignado (abiertas / total)</th><th>En riesgo</th></tr>';
    var cuerpo = porPersona.map(function (p) {
      return '<tr>' +
        '<td>' + Componentes.escaparHtml(p.nombre) + '</td>' +
        '<td>' + p.solicitadas_abiertas + ' / ' + p.solicitadas_total + '</td>' +
        '<td>' + p.solicitadas_esperando_validacion + '</td>' +
        '<td>' + p.asignadas_abiertas + ' / ' + p.asignadas_total + '</td>' +
        '<td>' + p.asignadas_en_riesgo + '</td>' +
        '</tr>';
    }).join('');
    contenedor.innerHTML = '<div style="overflow-x:auto"><table class="sigso-tabla-tablero"><thead>' + encabezado + '</thead><tbody>' + cuerpo + '</tbody></table></div>';
  }

  // v4.2 (§6): que se repite en el equipo.
  function renderCarga_(carga) {
    var contenedor = document.getElementById('jef-contenedor-carga');
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
    contenedor.innerHTML = bloque_('Por módulo', carga.por_modulo) + bloque_('Por tipo', carga.por_tipo);
  }
})();
