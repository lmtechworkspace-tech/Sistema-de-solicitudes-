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
    // v12.4: las 4 pestañas pasaron a la navegacion vertical. El cableado
    // ya no vive aca: lo hace onSeleccion de SigsoNav.
    pintarNavJefatura_();
  });

  function cargarJefatura_() {
    // v12.4: la vista puede venir de la URL (#/jefatura/reportes). Se valida
    // contra la arquitectura: una URL no puede inventar una vista.
    var pedidaJef = (window.SigsoShell && SigsoShell.tomarItemDeRuta)
      ? SigsoShell.tomarItemDeRuta() : '';
    if (pedidaJef && ARQUITECTURA_JEFATURA.some(function (sub) {
      return sub.items.some(function (it) { return it.id === pedidaJef; });
    })) {
      itemJefaturaActivo_ = pedidaJef;
    }
    irAVistaJefatura_(itemJefaturaActivo_);
    // v5.0 F4 (§6.3): mismo esqueleto que Gerencia/Bandeja mientras se pide
    // getPanelJefatura.
    document.getElementById('jef-contenedor-kpis').innerHTML = new Array(4).fill(
      '<div class="sigso-kpi sigso-esq__tarjeta" aria-busy="true">' +
      '<span class="sigso-esq__barra" style="width:40%;height:22px;margin:0 auto 0.5rem"></span>' +
      '<span class="sigso-esq__barra" style="width:65%;height:10px;margin:0 auto"></span></div>'
    ).join('');
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'getPanelJefatura', {})
      .then(function (respuesta) {
        if (!respuesta.ok) {
          document.getElementById('jef-contenedor-kpis').innerHTML =
            Componentes.alerta(respuesta.message || 'No se pudo cargar el panel.', 'error');
          return respuesta;
        }
        var datos = respuesta.data;
        // v12.4: se guarda para que el centro de reportes lo use sin volver
        // a pedirlo -- lo que se ve en el reporte y en el tablero sale del
        // MISMO conjunto ya acotado al equipo.
        panelJefatura_ = datos;
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
        // Si la persona esta parada en Reportes, hay que repintarlo ahora:
        // el catalogo pudo pintarse antes de que llegaran los datos.
        if (itemJefaturaActivo_ === 'reportes') renderReportesJefatura_();
        pintarNavJefatura_();
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

  // --- v7.0 Fase 3: "Actividades del equipo" -------------------------------
  // documentacion/SIGSO-v7.0-propuesta-modulo-gestion-operacional.md §5.2.
  // Datos propios de Actividades.gs (no de Jefatura.getPanel): el semaforo
  // ya viene calculado del servidor (semaforoActividad_), asi que esta
  // pantalla y "Mi trabajo" (actividades.js) usan siempre el mismo criterio.

  var ETIQUETA_TAMANO_JEF = { S: 'Chica', M: 'Mediana', L: 'Grande', XL: 'Muy grande' };

  function fechaCortaJef_(iso) {
    if (!iso) return '—';
    var f = new Date(iso);
    return new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate()))
      .toLocaleDateString('es-CL', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  function cargarActividadesEquipo_() {
    var resumen = document.getElementById('jef-act-resumen');
    var contenido = document.getElementById('jef-act-contenido');
    contenido.innerHTML = Componentes.cargando('Cargando actividades del equipo...');
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'panelEquipoActividades', {})
      .then(function (respuesta) {
        if (!respuesta.ok) {
          resumen.innerHTML = '';
          contenido.innerHTML = Componentes.alerta(respuesta.message || 'No se pudo cargar.', 'error');
          return;
        }
        renderActividadesEquipo_(respuesta.data);
      })
      .catch(function () {
        contenido.innerHTML = Componentes.alerta('No se pudo conectar para cargar las actividades del equipo.', 'error');
      });
  }

  function renderActividadesEquipo_(datos) {
    var items = datos.items || [];
    var conteo = { al_dia: 0, riesgo: 0, bloqueada: 0, pendiente: 0 };
    items.forEach(function (a) {
      if (a.semaforo === 'atrasada' || a.semaforo === 'riesgo') conteo.riesgo++;
      else if (a.semaforo === 'bloqueada') conteo.bloqueada++;
      else if (a.semaforo === 'pendiente') conteo.pendiente++;
      else if (a.semaforo === 'al-dia') conteo.al_dia++;
    });
    var resumen = document.getElementById('jef-act-resumen');
    resumen.innerHTML =
      '<div class="sigso-mt-resumen__item"><span class="sigso-mt-resumen__num" style="color:var(--ok)">' + conteo.al_dia + '</span><span class="sigso-mt-resumen__rot">Al día</span></div>' +
      '<div class="sigso-mt-resumen__item"><span class="sigso-mt-resumen__num" style="color:var(--alerta)">' + conteo.riesgo + '</span><span class="sigso-mt-resumen__rot">En riesgo</span></div>' +
      '<div class="sigso-mt-resumen__item"><span class="sigso-mt-resumen__num" style="color:var(--info)">' + conteo.bloqueada + '</span><span class="sigso-mt-resumen__rot">Bloqueadas</span></div>' +
      (conteo.pendiente ? '<div class="sigso-mt-resumen__item"><span class="sigso-mt-resumen__num" style="color:var(--texto-2)">' + conteo.pendiente + '</span><span class="sigso-mt-resumen__rot">Por confirmar</span></div>' : '');

    var contenido = document.getElementById('jef-act-contenido');
    if (items.length === 0) {
      contenido.innerHTML = Componentes.vacio('Tu equipo no tiene actividades registradas todavía.');
      return;
    }
    // Requieren atencion primero: bloqueadas/atrasadas/por confirmar arriba.
    var ORDEN = { atrasada: 0, riesgo: 1, bloqueada: 2, pendiente: 3, revision: 4, 'al-dia': 5, terminada: 6, cancelada: 7 };
    var ordenados = items.slice().sort(function (a, b) {
      return (ORDEN[a.semaforo] !== undefined ? ORDEN[a.semaforo] : 9) - (ORDEN[b.semaforo] !== undefined ? ORDEN[b.semaforo] : 9);
    });
    var encabezado = '<tr><th>Actividad</th><th>Responsable</th><th>Tamaño</th><th>Vence</th><th>Semáforo</th><th></th></tr>';
    var cuerpo = ordenados.map(function (a) {
      return '<tr>' +
        '<td title="' + Componentes.escaparHtml(a.titulo || '') + '">' + Componentes.escaparHtml(truncar_(a.titulo, 40)) +
        (a.bloqueo_motivo ? '<div class="sigso-ayuda">⏸ ' + Componentes.escaparHtml(truncar_(a.bloqueo_motivo, 60)) + '</div>' : '') + '</td>' +
        '<td>' + Componentes.escaparHtml(a.responsable_nombre || a.responsable_email) + '</td>' +
        '<td>' + Componentes.escaparHtml(ETIQUETA_TAMANO_JEF[a.tamano] || a.tamano || '—') + '</td>' +
        '<td>' + fechaCortaJef_(a.fecha_compromiso || a.fecha_propuesta) + '</td>' +
        '<td><span class="sigso-badge sigso-mt-badge--' + a.semaforo + '">' + Componentes.escaparHtml(a.semaforo_etiqueta) + '</span></td>' +
        '<td>' +
        (a.estado !== 'TERMINADA' && a.estado !== 'CANCELADA'
          ? '<button type="button" class="sigso-mt-pastilla" data-pedir="' + a.actividad_id + '">Pedir actualización</button> ' +
            '<button type="button" class="sigso-mt-pastilla" data-reasignar="' + a.actividad_id + '">Reasignar</button>'
          : '') +
        '</td>' +
        '</tr>';
    }).join('');
    contenido.innerHTML = '<div style="overflow-x:auto"><table class="sigso-tabla-tablero"><thead>' + encabezado + '</thead><tbody>' + cuerpo + '</tbody></table></div>';

    contenido.querySelectorAll('[data-pedir]').forEach(function (boton) {
      boton.addEventListener('click', function () { pedirActualizacionEquipo_(boton.getAttribute('data-pedir')); });
    });
    contenido.querySelectorAll('[data-reasignar]').forEach(function (boton) {
      boton.addEventListener('click', function () { reasignarEquipo_(boton.getAttribute('data-reasignar')); });
    });
  }

  function pedirActualizacionEquipo_(actividadId) {
    Componentes.prompt({
      titulo: 'Pedir una actualización',
      mensaje: 'Se le manda un correo de inmediato. Puedes agregar una nota (opcional).',
      placeholder: '¿Cómo vas con esto?'
    }).then(function (nota) {
      if (nota === null || nota === undefined) return; // cancelado
      llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'pedirActualizacionActividad', { actividad_id: actividadId, nota: nota })
        .then(function (respuesta) {
          if (!respuesta.ok) {
            Componentes.aviso({ texto: respuesta.message || 'No se pudo enviar.', tipo: 'error' });
            return;
          }
          Componentes.aviso({ texto: 'Se avisó por correo.', tipo: 'exito' });
        });
    });
  }

  function reasignarEquipo_(actividadId) {
    Componentes.prompt({
      titulo: 'Reasignar actividad',
      mensaje: 'Correo de la persona de tu equipo que se hará cargo.',
      placeholder: 'nombre@empresa.cl'
    }).then(function (correoNuevo) {
      if (!correoNuevo) return;
      Componentes.prompt({
        titulo: 'Motivo de la reasignación',
        mensaje: 'Queda en la bitácora de la actividad.'
      }).then(function (motivo) {
        if (!motivo) return;
        llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'reasignarActividad',
          { actividad_id: actividadId, responsable_nuevo: correoNuevo, motivo: motivo }
        ).then(function (respuesta) {
          if (!respuesta.ok) {
            Componentes.aviso({ texto: respuesta.message || 'No se pudo reasignar.', tipo: 'error' });
            return;
          }
          Componentes.aviso({ texto: 'Reasignada -- queda pendiente de que la confirme.', tipo: 'exito' });
          cargarActividadesEquipo_();
        });
      });
    });
  }

  // ==========================================================================
  // v12.4 (Fase 3) — Navegación y reportes de "Mi Departamento"
  //
  // Mismo criterio que Gerencia: sus cuatro pestañas eran navegación de
  // MÓDULO, no pestañas sobre una entidad.
  //
  // Los reportes reusan los cuerpos del MOTOR (SigsoReportes), los mismos que
  // usa Gerencia. Eso no es sólo ahorro de código: la regla de qué cuenta como
  // cumplimiento no puede divergir entre los dos paneles, porque entonces un
  // jefe y Gerencia verían números distintos del mismo equipo y no habría
  // forma de saber cuál creer.
  var ARQUITECTURA_JEFATURA = [
    { id: 'equipo', nombre: 'Mi equipo', icono: 'persona', items: [
      { id: 'tablero', nombre: 'Tablero' },
      { id: 'persona', nombre: 'Por persona' },
      { id: 'actividades', nombre: 'Actividades del equipo' }
    ] },
    { id: 'reportes', nombre: 'Reportes', icono: 'grafico',
      descripcion: 'Desempeño de tu equipo', items: [
      { id: 'reportes', nombre: 'Centro de reportes' },
      { id: 'carga', nombre: 'Carga por módulo y tipo' }
    ] }
  ];

  var PANEL_POR_ITEM_JEF = {
    tablero: 'jef-panel-tablero',
    persona: 'jef-panel-persona',
    carga: 'jef-panel-carga',
    actividades: 'jef-panel-actividades',
    reportes: 'jef-panel-reportes'
  };

  var itemJefaturaActivo_ = 'tablero';
  var reporteJefAbierto_ = null;
  var panelJefatura_ = null;

  function pintarNavJefatura_() {
    var cont = document.getElementById('jef-nav');
    if (!cont || !window.SigsoNav) return;
    SigsoNav.render({
      contenedor: cont,
      modulo: 'jefatura',
      submodulos: ARQUITECTURA_JEFATURA,
      activo: itemJefaturaActivo_,
      onSeleccion: function (id) { irAVistaJefatura_(id); }
    });
  }

  function irAVistaJefatura_(id) {
    itemJefaturaActivo_ = id;
    if (id !== 'reportes') reporteJefAbierto_ = null;
    pintarNavJefatura_();
    if (window.SigsoShell && SigsoShell.publicarItem) SigsoShell.publicarItem(id);

    Object.keys(PANEL_POR_ITEM_JEF).forEach(function (k) {
      var el = document.getElementById(PANEL_POR_ITEM_JEF[k]);
      if (el) el.classList.toggle('sigso-oculto', k !== id);
    });

    // Datos propios de Actividades.gs: se piden sólo al entrar, no en cada
    // carga del panel (mismo patrón que Pausas en Gerencia).
    if (id === 'actividades') cargarActividadesEquipo_();
    if (id === 'reportes') renderReportesJefatura_();
  }

  // --- Centro de reportes ----------------------------------------------------
  // Jefatura NO tiene area_nombre ni re_compromisos/reaperturas en sus items
  // (Gerencia sí). Los reportes que dependen de eso se declaran PENDIENTE con
  // el motivo, en vez de omitirse en silencio.
  var REPORTES_JEFATURA = [
    { grupo: 'Cumplimiento', icono: 'escudo', reportes: [
      { id: 'jef-responsable', nombre: 'Cumplimiento por persona', tipo: 'RANKING', estado: 'LISTO',
        desc: 'Entregas a tiempo de cada integrante, sobre lo que ya cerró.',
        fuente: 'getPanelJefatura', filtros: [] },
      { id: 'jef-modulo', nombre: 'Cumplimiento por módulo', tipo: 'CUMPLIMIENTO', estado: 'LISTO',
        desc: 'Qué módulos del sistema concentran los atrasos del equipo.',
        fuente: 'getPanelJefatura', filtros: [] },
      { id: 'jef-tipo', nombre: 'Cumplimiento por tipo', tipo: 'CUMPLIMIENTO', estado: 'LISTO',
        desc: 'Si el atraso se concentra en errores, mejoras o alguna otra clase.',
        fuente: 'getPanelJefatura', filtros: [] },
      { id: 'jef-resbalon', nombre: 'Resbalón de compromisos', tipo: 'DETALLE', estado: 'PENDIENTE',
        desc: 'Ítems que movieron su fecha comprometida o se reabrieron.',
        falta: 'getPanelJefatura no devuelve re_compromisos ni reaperturas — Gerencia sí los calcula (calcularPanelGerencia_). Habría que agregarlos a Jefatura.getPanel.' }
    ] },
    { grupo: 'Evolución', icono: 'grafico', reportes: [
      { id: 'jef-throughput', nombre: 'Entrada vs salida por mes', tipo: 'TENDENCIA', estado: 'LISTO',
        desc: 'Cuánto entra y cuánto cierra tu equipo cada mes.',
        fuente: 'getPanelJefatura', filtros: [] },
      { id: 'jef-carga', nombre: 'Carga por módulo y tipo', tipo: 'RANKING', estado: 'LISTO',
        desc: 'Qué se repite en tu equipo.',
        fuente: 'getPanelJefatura', seccion: 'carga' }
    ] }
  ];

  function registrarReportesJefatura_() {
    if (!window.SigsoReportes || registrarReportesJefatura_.hecho) return;
    SigsoReportes.registrar('jefatura', {
      titulo: 'Reportes de tu departamento',
      nota: 'Se arman con lo que ya devuelve el panel, siempre acotado a tu equipo. ' +
        'La regla de cumplimiento es la MISMA que usa Gerencia: sólo se mide sobre ' +
        'lo entregado con fecha comprometida.',
      grupos: REPORTES_JEFATURA
    });
    registrarReportesJefatura_.hecho = true;
  }

  function renderReportesJefatura_() {
    var cont = document.getElementById('jef-panel-reportes');
    if (!cont) return;
    registrarReportesJefatura_();
    if (!window.SigsoReportes) {
      cont.innerHTML = Componentes.alerta('El motor de reportes no está disponible.', 'error');
      return;
    }
    if (!panelJefatura_) {
      cont.innerHTML = Componentes.cargando('Esperando los datos del panel...');
      return;
    }
    if (reporteJefAbierto_) { pintarReporteJefatura_(cont); return; }
    SigsoReportes.pintarCatalogo({
      contenedor: cont,
      modulo: 'jefatura',
      onAbrir: function (id) { reporteJefAbierto_ = id; renderReportesJefatura_(); },
      onIrASeccion: function (vista) { irAVistaJefatura_(vista); }
    });
  }

  function pintarReporteJefatura_(cont) {
    var r = SigsoReportes.buscarReporte('jefatura', reporteJefAbierto_);
    if (!r) { reporteJefAbierto_ = null; renderReportesJefatura_(); return; }
    var items = panelJefatura_.items || [];
    var cuerpo = '';
    if (r.id === 'jef-responsable') {
      cuerpo = SigsoReportes.cuerpoCumplimientoPor(items, {
        campo: 'desarrollador_nombre', etiquetaVacia: '(sin asignar)',
        dimension: 'Persona', etiquetaTotal: 'Personas'
      });
    } else if (r.id === 'jef-modulo') {
      cuerpo = SigsoReportes.cuerpoCumplimientoPor(items, {
        campo: 'modulo_nombre', etiquetaVacia: '(sin módulo)',
        dimension: 'Módulo', etiquetaTotal: 'Módulos'
      });
    } else if (r.id === 'jef-tipo') {
      cuerpo = SigsoReportes.cuerpoCumplimientoPor(items, {
        campo: 'tipo_nombre', etiquetaVacia: '(sin tipo)',
        dimension: 'Tipo', etiquetaTotal: 'Tipos'
      });
    } else if (r.id === 'jef-throughput') {
      cuerpo = SigsoReportes.cuerpoEntradaSalida(panelJefatura_.tendencia || []);
    }

    cont.innerHTML =
      SigsoReportes.barraAcciones({}) +
      '<h3>' + Componentes.escaparHtml(r.nombre) + '</h3>' +
      '<p class="sigso-ayuda">' + Componentes.escaparHtml(r.desc) + '</p>' +
      cuerpo;

    SigsoReportes.wireAcciones(cont, {
      nombreArchivo: 'sigso-jefatura-' + r.id,
      onVolver: function () { reporteJefAbierto_ = null; renderReportesJefatura_(); }
    });
  }

})();
