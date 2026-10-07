/**
 * bandeja-v2.js — Bandeja de trabajo v2 (SIGSO v2, Módulo 3A; análisis y
 * decisiones en documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 * Qué cambia respecto de la clásica (dashboard.js + detalle.js):
 *  - La cola lista ÍTEMS (lo que se asigna y se trabaja), agrupables por
 *    solicitud (backend getColaSolicitudes). Los KPIs se cuentan sobre
 *    ítems, así "Sin asignar" dice la verdad.
 *  - Triar sin salir de la lista: "Recibir" en un clic, y acciones en lote
 *    (recibir, asignar, prioridad, fecha comprometida, cambiar estado).
 *  - "Ponerse al día": lo que lleva semanas sin revisar, lo más viejo
 *    primero, listo para seleccionar.
 *  - El detalle se abre en un panel lateral ancho con pestañas (Ítems ·
 *    Ficha · Actividad · Archivos) y las mismas acciones de siempre, con
 *    las mismas reglas del backend (transiciones permitidas, motivos).
 *
 * Mismos endpoints que la clásica para todo lo que escribe
 * (actualizarEstado, comprometerFecha, derivarSolicitud, actualizarPrioridad,
 * editarContenidoSubsolicitud, agregarComentario, descargarOrdenTrabajo).
 * La clásica queda un ciclo con "Volver a la versión clásica".
 *
 * Etapa 4 de Solicitudes (2026-10-05): la cola se ve como TABLA densa (una
 * línea por ítem, ~44 px, con semáforo de plazo, quién pide, departamento,
 * responsable y antigüedad), como LISTA o POR ESTADO (columnas Nueva · En
 * curso · Esperando respuesta · Resuelta). Pestaña REPORTES: tiempos y
 * cumplimiento de plazo por departamento, servicio y persona
 * (reporteSolicitudes.js; lo mismo va al informe mensual del área). En el
 * detalle, la conversación queda en la vista principal y lo que no es el
 * paso siguiente, en el menú "Más".
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var POR_PAGINA = 60;
  var CERRADOS = ['S09', 'S10', 'S11'];
  var PRIORIDADES = ['P1', 'P2', 'P3', 'P4', 'P5'];
  var ORDEN_ESTADO = ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11'];

  var datos_ = null, turno_ = 0, mostrar_ = POR_PAGINA;
  var sel_ = {};  // subsolicitud_id -> true
  var f = { kpi: 'abiertos', texto: '', empresa: '', prioridad: '', orden: 'urgencia', agrupar: false, verBandeja: '', vista: 'cola' };
  // 2026-10-07 (Leo, soporte de plataformas: «las primeras 2 son iguales… hay duplicidad o se está
  // agrupando mal la información»): una solicitud con varios ítems se veía como filas repetidas con el
  // mismo número. Ahora se agrupa por solicitud por defecto (se puede desagrupar con el chip).
  f.agrupar = true;
  // 2026-10-07 (decisión D1 del dueño): la Bandeja SIEMPRE abre por solicitud. Apagarlo vale solo
  // mientras la pantalla está abierta (antes se guardaba, y quien lo apagó una vez seguía viendo ítems sueltos).
  try { localStorage.removeItem('sigso_bj2_agrupar_2'); localStorage.removeItem('sigso_bj2_agrupar'); } catch (e) { /* sin storage */ }
  // Etapa 2: '' = mi bandeja (o toda, ADM); 'CONTABILIDAD'… = cola de ese departamento.
  f.cola = '';
  // Etapa 4: cómo se ve la cola (tabla densa por defecto) y el reporte.
  f.densidad = 'tabla';
  try { f.densidad = localStorage.getItem('sigso_bj2_densidad') || 'tabla'; } catch (e) { /* sin storage */ }
  var rep_ = { datos: null, depto: null, periodo: '', cargando: false, error: '' };
  var colaElegida_ = false;
  try { var guardada = localStorage.getItem('sigso_bj2_cola'); f.cola = guardada || ''; colaElegida_ = guardada !== null; } catch (e) { /* sin storage */ }
  function elegirCola(clave) {
    f.cola = clave || ''; colaElegida_ = true; sel_ = {}; f.kpi = 'abiertos'; mostrar_ = POR_PAGINA;
    try { localStorage.setItem('sigso_bj2_cola', f.cola); } catch (e) { /* sin storage */ }
    cargar(false);
  }
  var graficos_ = [];

  function api(accion, datos) {
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, accion, datos || {}).catch(function (e) {
      return { ok: false, message: (e && e.message) || 'No se pudo conectar.' };
    });
  }
  function estadoTxt(c) { return window.formatearEstadoSigso ? formatearEstadoSigso(c) : c; }
  // Etapa 3: lo que se ve son 5 estados (utils.js); el código fino solo como
  // detalle en lo de Desarrollo / TI (Recibida, En revisión, Aprobada, En pruebas).
  function estadoVis(c) { return window.formatearEstadoVisibleSigso ? formatearEstadoVisibleSigso(c) : estadoTxt(c); }
  function visible(c) { return window.estadoVisibleSigso ? estadoVisibleSigso(c) : ''; }
  function badgeEstado(i) {
    var fino = !i.depto && ['S02', 'S03', 'S04', 'S07'].indexOf(i.estado) !== -1;
    return U.badge(estadoVis(i.estado), tonoEstado(i.estado)) + (fino ? '<span class="bj2-fino">' + U.esc(estadoTxt(i.estado)) + '</span>' : '');
  }
  function tonoEstado(c) {
    if (c === 'S01') return 'info';
    if (c === 'S06') return 'alerta';
    if (c === 'S08') return 'primario';
    if (c === 'S09') return 'ok';
    if (c === 'S10' || c === 'S11') return 'neutro';
    return 'hito';
  }
  function tonoPrioridad(p) { return p === 'P1' ? 'critico' : (p === 'P2' ? 'alerta' : (p === 'P3' ? 'info' : 'neutro')); }
  function slaBadge(i) {
    if (CERRADOS.indexOf(i.estado) !== -1 || i.estado === 'S08') return '';
    if (i.situacion_sla === 'FUERA_DE_PLAZO') return U.badge('Fuera de plazo', 'critico');
    if (i.situacion_sla === 'EN_RIESGO') return U.badge('En riesgo', 'alerta');
    if (i.sla_restante_horas !== null && i.sla_restante_horas !== undefined) return '<span class="sx2-tenue" style="font-size:.75rem">SLA ' + Math.round(i.sla_restante_horas) + ' h</span>';
    return '';
  }
  function abierto(i) { return CERRADOS.indexOf(i.estado) === -1 && i.estado !== 'S08'; }
  function vencida(i) {
    if (!i.fecha_comprometida || !abierto(i)) return false;
    var t = new Date(String(i.fecha_comprometida).replace(' ', 'T')).getTime();
    return !isNaN(t) && t < Date.now();
  }
  function fechaCorta(v) { return v ? PY.fecha(v, true) : ''; }
  // Semáforo del plazo del ítem: rojo pasó su plazo, ámbar por vencer, verde en plazo.
  function semaforo(i) {
    var t = !abierto(i) ? ['gris', i.estado === 'S08' ? 'Resuelta: espera al solicitante' : 'Terminado']
      : (i.situacion_sla === 'FUERA_DE_PLAZO' ? ['rojo', 'Pasó su plazo'] : (i.situacion_sla === 'EN_RIESGO' ? ['ambar', 'Por vencer su plazo'] : (i.situacion_sla ? ['verde', 'En plazo'] : ['gris', 'Sin plazo'])));
    return '<span class="bj2-sem bj2-sem--' + t[0] + '" title="' + t[1] + '" role="img" aria-label="' + t[1] + '"></span>';
  }
  function antiguedad(i) {
    var d = Math.floor((Date.now() - new Date(i.fecha_creacion).getTime()) / 86400000);
    return isNaN(d) ? '' : (d <= 0 ? 'hoy' : d + ' d');
  }
  function horasTxt(h) {
    if (h === null || h === undefined) return '—';
    return h < 9 ? (Math.round(h * 10) / 10).toLocaleString('es-CL') + ' h' : (Math.round(h / 9 * 10) / 10).toLocaleString('es-CL') + ' d';
  }

  // Algo cambió en una solicitud (desde la cola, el detalle o una fila de Mi
  // trabajo/Inicio): se refresca la cola si está montada y se avisa al resto.
  function avisarCambio() {
    if (document.getElementById('bandeja-v2')) cargar(true);
    document.dispatchEvent(new CustomEvent('sigso:solicitudes-cambio'));
  }

  // --- Montaje ----------------------------------------------------------------------
  function seccion() { return document.getElementById('modulo-bandeja'); }
  function contenedor() {
    var s = seccion();
    if (!s) return null;
    var c = document.getElementById('bandeja-v2');
    if (!c) {
      c = document.createElement('div');
      c.id = 'bandeja-v2';
      c.className = 'sx2';
      s.appendChild(c);
    }
    s.classList.add('bandeja-v2-activa');
    return c;
  }
  function desmontar() {
    var s = seccion();
    if (s) s.classList.remove('bandeja-v2-activa');
    var c = document.getElementById('bandeja-v2');
    if (c) c.remove();
    graficos_.forEach(function (g) { try { g.destroy(); } catch (e) { /* ya destruido */ } });
    graficos_ = [];
  }

  // --- Carga ---------------------------------------------------------------------------
  function cargar(silencioso) {
    var c = contenedor();
    if (!c) return;
    var t = ++turno_;
    if (!silencioso || !datos_) c.innerHTML = '<div class="sx2-pagina">' + U.esqueleto('kpis', 6) + U.esqueleto('tabla', 8) + '</div>';
    Promise.all([api('getColaSolicitudes', { verBandeja: f.cola ? '' : f.verBandeja, depto: f.cola }), PY.cargarMiPerfil()]).then(function (r) {
      if (t !== turno_) return;
      // Ya no está en la lista de ese departamento: vuelve a su bandeja.
      if (f.cola && r[0] && !r[0].ok && /departamento/i.test(r[0].message || '')) {
        f.cola = ''; try { localStorage.removeItem('sigso_bj2_cola'); } catch (e) { /* sin storage */ }
        cargar(silencioso); return;
      }
      if (!r[0] || !r[0].ok) {
        c.innerHTML = '<div class="sx2-pagina">' + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar la bandeja', texto: (r[0] && r[0].message) || 'Inténtalo de nuevo.',
          accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-bj2-reintentar' }) }) }) + '</div>';
        return;
      }
      datos_ = r[0].data;
      // Primera vez, sin nada propio y con un departamento: abre su cola.
      if (!f.cola && !colaElegida_ && (datos_.colas || []).length && !datos_.items.length && datos_.rol_actual !== 'ADM') {
        colaElegida_ = true; f.cola = datos_.colas[0].clave; cargar(silencioso); return;
      }
      var ids = {};
      datos_.items.forEach(function (i) { ids[i.subsolicitud_id] = true; });
      Object.keys(sel_).forEach(function (k) { if (!ids[k]) delete sel_[k]; });
      pintar(!!silencioso);
      var correos = datos_.items.map(function (i) { return i.asignado; }).filter(Boolean);
      Promise.all([window.SigsoDirectorio ? SigsoDirectorio.resolver(correos) : Promise.resolve(), U.precargarFotos(correos)])
        .then(function () { if (t === turno_) pintar(true); });
    });
  }

  // --- Filtro y orden --------------------------------------------------------------------
  var KPIS = [
    { id: 'abiertos', etiqueta: 'Abiertos', icono: 'bandeja', tono: 'primario', unidad: 'ítems en curso', f: abierto },
    { id: 'por_revisar', etiqueta: 'Nuevos', icono: 'ojo', tono: 'info', unidad: 'nadie los tomó ni empezó', f: function (i) { return abierto(i) && i.estado === 'S01'; } },
    { id: 'fuera_de_plazo', etiqueta: 'Fuera de plazo', icono: 'alerta', tono: 'critico', unidad: 'pasaron su SLA', f: function (i) { return abierto(i) && i.situacion_sla === 'FUERA_DE_PLAZO'; } },
    { id: 'sin_fecha', etiqueta: 'Sin fecha comprometida', icono: 'calendario', tono: 'alerta', unidad: 'nadie se comprometió', f: function (i) { return abierto(i) && !i.fecha_comprometida; } },
    { id: 'sin_asignar', etiqueta: 'Sin asignar', icono: 'persona', tono: 'hito', unidad: 'sin responsable', f: function (i) { return abierto(i) && !i.asignado; } },
    { id: 'por_validar', etiqueta: 'Por validar', icono: 'check', tono: 'ok', unidad: 'terminados, esperan al solicitante', f: function (i) { return i.estado === 'S08'; } },
    { id: 'todos', etiqueta: 'Todos', f: function () { return true; } }
  ];
  function kpiDe(id) { return KPIS.filter(function (k) { return k.id === id; })[0] || KPIS[0]; }

  function filtrados() {
    var q = f.texto.toLowerCase();
    var k = kpiDe(f.kpi);
    var lista = datos_.items.filter(function (i) {
      if (!k.f(i)) return false;
      if (f.empresa && i.empresa_id !== f.empresa) return false;
      if (f.prioridad && i.prioridad !== f.prioridad) return false;
      if (q) {
        var t = [i.solicitud_id, i.titulo, i.empresa_nombre, i.solicitante_nombre, i.solicitante_email, i.modulo_nombre, i.tipo_nombre, i.asignado_nombre, i.empresa_cliente, i.servicio_nombre, i.depto_nombre].join(' ').toLowerCase();
        if (t.indexOf(q) === -1) return false;
      }
      return true;
    });
    var ORD = { FUERA_DE_PLAZO: 0, EN_RIESGO: 1 };
    var ordenes = {
      urgencia: function (a, b) {
        var sa = ORD[a.situacion_sla] !== undefined ? ORD[a.situacion_sla] : 2, sb = ORD[b.situacion_sla] !== undefined ? ORD[b.situacion_sla] : 2;
        return (sa - sb) || (PRIORIDADES.indexOf(a.prioridad) - PRIORIDADES.indexOf(b.prioridad)) || (new Date(a.fecha_creacion) - new Date(b.fecha_creacion));
      },
      antiguedad: function (a, b) { return new Date(a.fecha_creacion) - new Date(b.fecha_creacion); },
      prioridad: function (a, b) { return (PRIORIDADES.indexOf(a.prioridad) - PRIORIDADES.indexOf(b.prioridad)) || (new Date(a.fecha_creacion) - new Date(b.fecha_creacion)); },
      movimiento: function (a, b) { return b.dias_sin_movimiento - a.dias_sin_movimiento; },
      recientes: function (a, b) { return new Date(b.fecha_creacion) - new Date(a.fecha_creacion); }
    };
    return lista.sort(ordenes[f.orden] || ordenes.urgencia);
  }

  // --- Pintado -------------------------------------------------------------------------
  function cabecera() {
    var d = datos_;
    var esAdm = d.rol_actual === 'ADM' && !f.cola;
    var colaActual = (d.colas || []).filter(function (c) { return c.clave === f.cola; })[0];
    var quien = esAdm
      ? '<select class="sx2-select js-bj2-ver" aria-label="Ver bandeja de"><option value="">Toda la bandeja</option>' + (d.responsables || []).map(function (r) {
          return '<option value="' + U.esc(r.email) + '"' + (String(r.email).toLowerCase() === String(f.verBandeja).toLowerCase() ? ' selected' : '') + '>Bandeja de ' + U.esc(PY.persona(r.email, r.nombre).nombre) + '</option>';
        }).join('') + '</select>'
      : (colaActual
        ? '<span class="sx2-tenue" style="font-size:.875rem">Lo que llega a ' + U.esc(colaActual.nombre) + '. ' + (colaActual.rol === 'JEFATURA' ? 'Repártelo o tómalo.' : (colaActual.rol === 'LECTURA' ? 'Acceso de solo lectura.' : 'Toma lo que esté sin asignar.')) + '</span>'
        : '<span class="sx2-tenue" style="font-size:.875rem">Tu bandeja: lo asignado a ti' + (d.rol_actual === 'DEV' ? ' y lo huérfano en curso' : '') + '.</span>');
    return '<header class="sx2-cabecera sx2-entra">' +
      '<div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Solicitudes · Bandeja de trabajo</span><h1>' + (colaActual ? 'Cola de ' + U.esc(colaActual.nombre) : 'Bandeja de trabajo') + '</h1>' + ((d.colas || []).length ? colas() : (esAdm ? '' : quien)) + '</div>' +
      '<div class="sx2-cabecera__acciones">' + (esAdm ? quien : '') +
        (colaActual && colaActual.rol === 'JEFATURA' ? U.boton({ texto: 'Servicios', icono: 'lista', clase: 'js-bj2-servicios', titulo: 'Catálogo de servicios de ' + colaActual.nombre }) : '') +
        U.segmento([{ id: 'cola', texto: 'Cola', icono: 'lista' }, { id: 'analisis', texto: 'Análisis', icono: 'grafico' }]
          .concat((d.colas || []).length || d.rol_actual === 'ADM' ? [{ id: 'reportes', texto: 'Reportes', icono: 'tendencia' }] : []), f.vista, 'js-bj2-vista') +
        U.boton({ soloIcono: true, icono: 'exportar', titulo: 'Descargar Excel', clase: 'js-bj2-excel' }) +
        (esAdm && f.verBandeja && !f.cola ? U.boton({ texto: 'Pauta (PDF)', icono: 'documento', clase: 'js-bj2-pauta' }) : '') +
        U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-bj2-reintentar' }) +
      '</div>' +
    '</header>';
  }

  function kpis() {
    var r = datos_.resumen || {};
    return '<div class="sx2-fila-kpis sx2-fila-kpis--6">' + KPIS.filter(function (k) { return k.id !== 'todos'; }).map(function (k, i) {
      var v = r[k.id] || 0;
      return U.kpi({ i: i, icono: k.icono, tono: v || k.id === 'abiertos' ? k.tono : 'neutro', etiqueta: k.etiqueta, valor: v, unidad: k.unidad, filtro: k.id, activo: f.kpi === k.id });
    }).join('') + '</div>';
  }

  // Etapa 2: pestañas entre "mi bandeja" y la cola de cada departamento de la persona.
  function colas() {
    var cs = datos_.colas || [];
    if (!cs.length) return '';
    var mia = datos_.rol_actual === 'ADM' ? 'Toda la bandeja' : 'Mi bandeja';
    return '<nav class="bj2-colas sx2-entra" aria-label="Colas">' +
      '<button type="button" class="bj2-colas__op js-bj2-cola' + (!f.cola ? ' is-activo' : '') + '" data-cola="" aria-pressed="' + !f.cola + '">' + U.ico('bandeja', 14) + U.esc(mia) + '</button>' +
      cs.map(function (c) {
        return '<button type="button" class="bj2-colas__op js-bj2-cola' + (f.cola === c.clave ? ' is-activo' : '') + '" data-cola="' + U.esc(c.clave) + '" aria-pressed="' + (f.cola === c.clave) + '">' +
          U.ico(c.icono || 'equipo', 14) + U.esc(c.nombre) + '<span class="bj2-colas__n" title="' + (c.rol === 'JEFATURA' ? 'Repártelo o tómalo' : (c.rol === 'LECTURA' ? 'Solo lectura' : 'Toma lo que esté sin asignar')) + '">' + c.abiertos + '</span>' +
          (c.sin_asignar ? '<span class="bj2-colas__sin" title="Sin asignar">' + c.sin_asignar + ' sin asignar</span>' : '') + '</button>';
      }).join('') + '</nav>';
  }

  // Etapa 1 (2026-10-05): en la Cola los indicadores son una banda de una
  // línea (antes 6 tarjetas de ~110 px empujaban la primera fila a 600 px).
  function banda() {
    var r = datos_.resumen || {};
    return '<div class="bj2-banda sx2-entra" role="group" aria-label="Filtrar la cola">' + KPIS.filter(function (k) { return k.id !== 'todos'; }).map(function (k) {
      var v = r[k.id] || 0;
      return '<button type="button" class="bj2-banda__op sx2-tono-' + (v || k.id === 'abiertos' ? k.tono : 'neutro') + (f.kpi === k.id ? ' is-activo' : '') + '" data-filtro="' + k.id + '" aria-pressed="' + (f.kpi === k.id) + '" title="' + U.esc(k.unidad) + '">' +
        '<span class="bj2-banda__n">' + v + '</span><span class="bj2-banda__et">' + U.esc(k.etiqueta) + '</span></button>';
    }).join('') + '</div>';
  }

  // "Ponerse al día": aparece solo si hay un rezago real de ítems sin triar.
  function bannerRezago() {
    if (datos_.solo_lectura) return '';
    var viejos = datos_.items.filter(function (i) { return abierto(i) && i.estado === 'S01' && (Date.now() - new Date(i.fecha_creacion)) / 86400000 > 14; });
    if (viejos.length < 3) return '';
    var masViejo = Math.max.apply(null, viejos.map(function (i) { return Math.floor((Date.now() - new Date(i.fecha_creacion)) / 86400000); }));
    return '<button type="button" class="bj2-rezago-chip js-bj2-rezago" title="' + viejos.length + ' ítems llevan más de 2 semanas sin que nadie los tome; el más antiguo tiene ' + masViejo + ' días. Revísalos de a varios: recíbelos, asígnalos o ciérralos con su motivo.">' +
      U.ico('reloj', 14) + '<b>' + viejos.length + ' sin tomar +2 sem.</b><span>Ponerse al día</span></button>';
  }

  function barraFiltros() {
    var empresas = {};
    datos_.items.forEach(function (i) { empresas[i.empresa_id] = i.empresa_nombre || i.empresa_id; });
    return '<div class="sx2-barra-filtros bj2-filtros">' +
      '<label class="sx2-buscar">' + U.ico('lupa', 16) + '<input class="sx2-input js-bj2-buscar" type="search" placeholder="Buscar por título, N°, solicitante, empresa…" value="' + U.esc(f.texto) + '"></label>' +
      '<select class="sx2-select js-bj2-empresa" aria-label="Empresa"><option value="">Todas las empresas</option>' + Object.keys(empresas).sort().map(function (e) {
        return '<option value="' + U.esc(e) + '"' + (f.empresa === e ? ' selected' : '') + '>' + U.esc(empresas[e]) + '</option>';
      }).join('') + '</select>' +
      '<select class="sx2-select js-bj2-prioridad" aria-label="Prioridad"><option value="">Toda prioridad</option>' + PRIORIDADES.map(function (p) {
        return '<option value="' + p + '"' + (f.prioridad === p ? ' selected' : '') + '>' + p + '</option>';
      }).join('') + '</select>' +
      '<select class="sx2-select js-bj2-orden" aria-label="Ordenar"><option value="urgencia"' + (f.orden === 'urgencia' ? ' selected' : '') + '>Más urgente primero</option>' +
        '<option value="antiguedad"' + (f.orden === 'antiguedad' ? ' selected' : '') + '>Más antiguo primero</option>' +
        '<option value="movimiento"' + (f.orden === 'movimiento' ? ' selected' : '') + '>Más tiempo sin movimiento</option>' +
        '<option value="prioridad"' + (f.orden === 'prioridad' ? ' selected' : '') + '>Por prioridad</option>' +
        '<option value="recientes"' + (f.orden === 'recientes' ? ' selected' : '') + '>Más recientes</option></select>' +
    '</div>';
  }

  // 2026-10-07 (decisiones del dueño tras los comentarios de Leo): el CAMINO de cada ítem.
  // Recibido → Con fecha → En curso → Resuelto → Confirmado. Cada ítem va a su ritmo y con su
  // fecha; el botón principal del detalle siempre es el paso que sigue.
  var PASOS_CAMINO = ['Recibido', 'Con fecha', 'En curso', 'Resuelto', 'Confirmado'];
  function caminoDe(it) {
    var e = it.estado;
    var hecho = [e !== 'S01', !!it.fecha_comprometida, ['S05', 'S06', 'S07', 'S08', 'S09'].indexOf(e) !== -1, e === 'S08' || e === 'S09', e === 'S09'];
    var primero = hecho.indexOf(false);
    return PASOS_CAMINO.map(function (nombre, k) {
      var est = hecho[k] ? 'hecho' : (k === primero ? 'actual' : 'pendiente');
      // Un paso que quedó atrás sin hacerse (p. ej. sin fecha pero ya en curso) se marca como falta.
      if (!hecho[k] && hecho.slice(k + 1).some(Boolean)) est = 'falta';
      if (k === 2 && e === 'S06') est = 'pausa';
      var nota = '';
      if (k === 1 && it.fecha_comprometida) nota = 'para el ' + PY.fecha(it.fecha_comprometida, true);
      if (k === 1 && est === 'falta') nota = 'sin fecha';
      if (k === 2 && e === 'S06') nota = 'esperando respuesta';
      if (k === 4 && e === 'S08') nota = 'espera a quien pidió';
      return { nombre: nombre, est: est, nota: nota };
    });
  }
  function caminoHtml(it) {
    if (['S10', 'S11'].indexOf(it.estado) !== -1) return '<p class="bj2-camino-fin">' + U.ico('equis', 13) + (it.estado === 'S10' ? 'Rechazado' : 'Cancelado') + ': salió del camino.</p>';
    return '<ol class="bj2-camino" aria-label="Camino del ítem">' + caminoDe(it).map(function (p) {
      return '<li class="bj2-camino__p bj2-camino__p--' + p.est + '"' + (p.est === 'actual' ? ' aria-current="step"' : '') + '><span>' + U.esc(p.nombre) + '</span>' + (p.nota ? '<small>' + U.esc(p.nota) + '</small>' : '') + '</li>';
    }).join('') + '</ol>';
  }
  // La fecha que se propone al recibir: el plazo del ítem en días hábiles (jornada de 9 h), mínimo 1.
  function fechaSugerida(it) {
    var dias = Math.max(1, Math.ceil((Number(it && it.sla_objetivo_horas) || 27) / 9));
    var d = new Date();
    while (dias > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) dias--; }
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function hoyIso() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  // «3 ítems: 1 nueva · 1 esperando respuesta · 1 resuelta (espera validación)».
  var VIS_TXT = { NUEVA: ['nueva', 'nuevas'], EN_CURSO: ['en curso', 'en curso'], ESPERANDO: ['esperando respuesta', 'esperando respuesta'], RESUELTA: ['resuelta (espera validación)', 'resueltas (esperan validación)'], CERRADA: ['cerrada', 'cerradas'] };
  // En qué va cada parte, desde una lista de ítems (el detalle también se abre desde Mi trabajo e Inicio, sin la cola cargada).
  function resumenItems(items) { return resumenDe(items, 0, false).replace(/^[^:]*: /, ''); }
  function resumenSolicitud(solId, corto) {
    return resumenDe(datos_.items.filter(function (x) { return x.solicitud_id === solId; }), 0, corto);
  }
  function resumenDe(todos, _, corto) {
    var cuenta = {}, orden = [];
    todos.forEach(function (x) {
      var v = CERRADOS.indexOf(x.estado) !== -1 ? 'CERRADA' : (visible(x.estado) || 'EN_CURSO');
      if (!cuenta[v]) { cuenta[v] = 0; orden.push(v); }
      cuenta[v]++;
    });
    var ORD = ['NUEVA', 'EN_CURSO', 'ESPERANDO', 'RESUELTA', 'CERRADA'];
    orden.sort(function (a, b) { return ORD.indexOf(a) - ORD.indexOf(b); });
    var n = Math.max(todos.length, (todos[0] && todos[0].cantidad_items) || 0);
    return n + (n === 1 ? ' ítem' : ' ítems') + ': ' + orden.map(function (v) { var t = VIS_TXT[v] || [v, v]; var x = cuenta[v] === 1 ? t[0] : t[1]; return cuenta[v] + ' ' + (corto ? x.replace(/ \(.*\)$/, '') : x); }).join(' · ');
  }
  // Los ítems visibles, en grupos por solicitud (en el orden de la lista: el grupo va donde aparece su ítem más urgente).
  function agrupar(visibles) {
    var grupos = [], porSol = {};
    visibles.forEach(function (i) {
      if (!porSol[i.solicitud_id]) { porSol[i.solicitud_id] = { id: i.solicitud_id, i: i, items: [] }; grupos.push(porSol[i.solicitud_id]); }
      porSol[i.solicitud_id].items.push(i);
    });
    return grupos;
  }
  function nItem(i) { return i.cantidad_items > 1 ? 'Ítem ' + i.numero_item + ' de ' + i.cantidad_items : ''; }

  function fila(i, n) {
    var marcado = !!sel_[i.subsolicitud_id];
    var persona = i.asignado ? PY.persona(i.asignado, i.asignado_nombre) : null;
    return '<li class="bj2-fila sx2-tono-' + tonoPrioridad(i.prioridad) + (marcado ? ' bj2-fila--sel' : '') + ' sx2-entra" style="--i:' + Math.min(n, 12) + '" data-bj2-item="' + U.esc(i.subsolicitud_id) + '" data-sol="' + U.esc(i.solicitud_id) + '" tabindex="0">' +
      (datos_.solo_lectura ? '<span></span>' : '<label class="bj2-check" title="Seleccionar"><input type="checkbox" class="js-bj2-sel"' + (marcado ? ' checked' : '') + ' aria-label="Seleccionar ' + U.esc(i.titulo) + '"></label>') +
      '<span class="bj2-prio">' + U.esc(i.prioridad || '—') + '</span>' +
      '<span class="sx2-apilado bj2-fila__cuerpo">' +
        '<strong class="sx2-cortar">' + U.esc(i.titulo || '(sin título)') + '</strong>' +
        '<span class="sx2-flex bj2-fila__meta">' +
          '<span class="bj2-id">' + (f.agrupar && i.cantidad_items > 1 ? U.esc(nItem(i)) : U.esc(i.solicitud_id) + (i.cantidad_items > 1 ? ' · ítem ' + i.numero_item + '/' + i.cantidad_items : '')) + '</span>' +
          '<span class="sx2-cortar">' + (i.solicitante_nombre ? '<b class="bj2-pide">' + U.esc(i.solicitante_nombre) + '</b> · ' : '') + (i.depto && !f.cola ? U.esc(i.depto_nombre) + ' · ' : '') + (i.servicio_nombre ? U.esc(i.servicio_nombre) : U.esc(i.empresa_nombre || '') + (i.tipo_nombre ? ' · ' + U.esc(i.tipo_nombre) : '')) + '</span>' +
          (i.es_cliente || i.empresa_cliente ? U.badge('Cliente' + (i.empresa_cliente ? ': ' + i.empresa_cliente : ''), 'hito', true) : '') +
          (i.respuesta_pendiente ? U.badge('Te escribió', 'info') : '') +
        '</span>' +
      '</span>' +
      '<span class="bj2-fila__estado">' + badgeEstado(i) + slaBadge(i) + '</span>' +
      '<span class="bj2-fila__quien">' + (persona
        ? U.avatar(persona, 'sm') + '<span class="sx2-apilado" style="gap:0;min-width:0"><span class="sx2-cortar">' + U.esc(persona.nombre) + '</span>' + (i.asignado_heredado ? '<small class="sx2-tenue">de la solicitud</small>' : '') + '</span>'
        : '<span class="bj2-sin">' + U.ico('persona', 14) + 'Sin asignar</span>') + '</span>' +
      '<span class="bj2-fila__fecha">' + (i.fecha_comprometida ? '<span' + (vencida(i) ? ' class="bj2-tarde" title="Fecha comprometida vencida"' : '') + '>' + (vencida(i) ? U.ico('alerta', 12) + ' ' : '') + fechaCorta(i.fecha_comprometida) + '</span>' : '<span class="sx2-tenue">Sin fecha</span>') +
        '<small class="sx2-tenue">' + (i.dias_sin_movimiento ? i.dias_sin_movimiento + ' d sin mover' : 'hoy') + '</small></span>' +
      '<span class="bj2-fila__acc">' + (datos_.solo_lectura ? '' : (i.puede_tomar
          ? U.boton({ texto: 'Tomar', icono: 'check', sm: true, variante: 'primario', clase: 'js-bj2-tomar', datos: { id: i.subsolicitud_id }, titulo: 'Queda a tu nombre' })
          : (i.estado === 'S01' && (!i.depto || i.puede_asignar || i.asignado === datos_.mi_email) ? U.boton({ texto: 'Recibir', sm: true, variante: 'primario', clase: 'js-bj2-recibir', datos: { id: i.subsolicitud_id } }) : ''))) +
        U.boton({ soloIcono: true, icono: 'derecha', sm: true, variante: 'fantasma', titulo: 'Abrir', clase: 'js-bj2-abrir' }) + '</span>' +
    '</li>';
  }

  function lista() {
    var items = filtrados();
    if (!items.length) {
      return '<section class="sx2-card sx2-card--sin-relleno sx2-entra" style="--i:3">' + barraFiltros() + '<div style="padding:var(--sx-e-5)">' + U.vacio({ icono: f.kpi === 'abiertos' && !f.texto ? 'check' : 'lupa',
        titulo: f.kpi === 'abiertos' && !f.texto && !f.empresa && !f.prioridad ? 'Bandeja al día' : 'Nada con estos filtros',
        texto: f.kpi === 'abiertos' && !f.texto ? 'No hay ítems en curso.' : 'Prueba quitando algún filtro.' }) + '</div></section>';
    }
    var visibles = items.slice(0, mostrar_);
    var cuerpo;
    // En pantallas angostas la tabla no cabe: se usa la lista.
    var dens = f.densidad === 'tabla' && window.innerWidth < 900 ? 'lista' : f.densidad;
    if (dens === 'estado') {
      cuerpo = tablero();
    } else if (dens === 'tabla') {
      cuerpo = tabla(visibles);
    } else if (f.agrupar) {
      cuerpo = agrupar(visibles).map(function (g) {
        if (g.i.cantidad_items <= 1) return '<li class="bj2-grupo bj2-grupo--solo"><ul class="bj2-lista">' + g.items.map(fila).join('') + '</ul></li>';
        return '<li class="bj2-grupo"><button type="button" class="bj2-grupo__cab js-bj2-abrir-sol" data-sol="' + U.esc(g.id) + '" title="Abrir la solicitud completa">' +
          U.ico('capas', 15) + '<strong>' + U.esc(g.id) + '</strong><span class="sx2-tenue sx2-cortar">' + U.esc(g.i.solicitante_nombre || g.i.solicitante_email) + ' · ' + U.esc(g.i.empresa_nombre || '') + '</span>' +
          '<span class="bj2-grupo__res">' + barraAvance(itemsDeSolicitud(g.id)) + U.esc(pasosTxt(itemsDeSolicitud(g.id)).texto) + '</span></button>' +
          '<ul class="bj2-lista">' + g.items.map(fila).join('') + '</ul></li>';
      }).join('');
      cuerpo = '<ul class="bj2-lista bj2-lista--grupos">' + cuerpo + '</ul>';
    } else {
      cuerpo = '<ul class="bj2-lista">' + visibles.map(fila).join('') + '</ul>';
    }
    var todosMarcados = !datos_.solo_lectura && visibles.length && visibles.every(function (i) { return sel_[i.subsolicitud_id]; });
    var nSol = Object.keys(items.reduce(function (m, i) { m[i.solicitud_id] = 1; return m; }, {})).length;
    return '<section class="sx2-card sx2-card--sin-relleno sx2-entra" style="--i:3">' + barraFiltros() +
      '<div class="bj2-lista__cab">' +
        (datos_.solo_lectura || dens === 'estado' ? '' : '<label class="bj2-check" title="Seleccionar todo lo visible"><input type="checkbox" class="js-bj2-sel-todo"' + (todosMarcados ? ' checked' : '') + ' aria-label="Seleccionar todo lo visible"></label>') +
        '<strong>' + (dens === 'estado' ? 'Por estado' : (f.agrupar ? nSol + (nSol === 1 ? ' solicitud' : ' solicitudes') + ' · ' : '') + items.length + (items.length === 1 ? ' ítem' : ' ítems')) + '</strong><span class="sx2-tenue">' + U.esc(dens === 'estado' ? 'lo que está en curso (lo resuelto espera al solicitante)' : kpiDe(f.kpi).etiqueta.toLowerCase()) + '</span>' +
        '<span class="bj2-lista__cab-acc">' + bannerRezago() + (dens === 'estado' ? '' : U.chip({ texto: 'Por solicitud', icono: 'capas', activo: f.agrupar, clase: 'js-bj2-agrupar', titulo: 'Una fila por solicitud, con sus ítems adentro (apágalo para ver cada ítem suelto)' }) +
          U.chip({ texto: 'Con cerrados', activo: f.kpi === 'todos', clase: 'js-bj2-todos', titulo: 'Incluir los cerrados, rechazados y cancelados' })) +
          U.segmento([{ id: 'tabla', texto: 'Tabla', icono: 'tabla' }, { id: 'lista', texto: 'Lista', icono: 'lista' }, { id: 'estado', texto: 'Por estado', icono: 'kanban' }], f.densidad, 'js-bj2-densidad') + '</span>' +
      '</div>' + cuerpo +
      (dens !== 'estado' && items.length > visibles.length ? '<div style="text-align:center;padding:12px">' + U.boton({ texto: 'Mostrar más (' + (items.length - visibles.length) + ')', icono: 'abajo', sm: true, variante: 'fantasma', clase: 'js-bj2-mas' }) + '</div>' : '') +
    '</section>';
  }

  // 2026-10-07 (Etapa 2 del camino, decisión D1 del dueño): la Bandeja muestra SOLICITUDES.
  // Una fila por solicitud con su número completo, quién pide, una barra con un tramo por ítem
  // (el color dice en qué paso va cada uno) y el paso que sigue. Al desplegarla, sus ítems con su
  // camino. Una solicitud de un solo ítem es una sola fila que se comporta como el ítem.
  var expandidas_ = {};
  function tramoDe(it) {
    if (it.estado === 'S06') return 'pausa';
    if (['S10', 'S11'].indexOf(it.estado) !== -1) return 'fuera';
    return 'c' + caminoDe(it).filter(function (p) { return p.est === 'hecho'; }).length;
  }
  function itemsDeSolicitud(solId) { return datos_.items.filter(function (x) { return x.solicitud_id === solId; }).sort(function (a, b) { return a.numero_item - b.numero_item; }); }
  // En palabras, cuántos ítems hay en cada paso: «2 por recibir · 1 en curso · 1 resuelto».
  function pasosTxt(items) {
    var c = { recibir: 0, fecha: 0, empezar: 0, curso: 0, pausa: 0, resuelto: 0, cerrado: 0 };
    items.forEach(function (it) {
      var e = it.estado;
      if (e === 'S01') c.recibir++;
      else if (['S09', 'S10', 'S11'].indexOf(e) !== -1) c.cerrado++;
      else if (e === 'S08') c.resuelto++;
      else if (e === 'S06') c.pausa++;
      else if (!it.fecha_comprometida) c.fecha++;
      else if (['S02', 'S03', 'S04'].indexOf(e) !== -1) c.empezar++;
      else c.curso++;
    });
    var t = [];
    if (c.recibir) t.push(c.recibir + ' por recibir');
    if (c.fecha) t.push(c.fecha + ' sin fecha');
    if (c.empezar) t.push(c.empezar + ' por empezar');
    if (c.curso) t.push(c.curso + ' en curso');
    if (c.pausa) t.push(c.pausa + ' esperando respuesta');
    if (c.resuelto) t.push(c.resuelto + (c.resuelto === 1 ? ' resuelto' : ' resueltos'));
    if (c.cerrado) t.push(c.cerrado + (c.cerrado === 1 ? ' cerrado' : ' cerrados'));
    return { texto: t.join(' · '), c: c };
  }
  function barraAvance(items) {
    return '<span class="bj2-avance" role="img" aria-label="' + U.esc(pasosTxt(items).texto) + '">' + items.map(function (it) {
      return '<i class="bj2-avance__t bj2-avance__t--' + tramoDe(it) + '" title="Ítem ' + it.numero_item + ': ' + U.esc(it.titulo || '') + '"></i>';
    }).join('') + '</span>';
  }
  var ORDEN_SEM = { rojo: 0, ambar: 1, verde: 2, gris: 3 };
  function semaforoPeor(items) {
    var peor = items.slice().sort(function (a, b) {
      var c = function (i) { return !abierto(i) ? 'gris' : (i.situacion_sla === 'FUERA_DE_PLAZO' ? 'rojo' : (i.situacion_sla === 'EN_RIESGO' ? 'ambar' : (i.situacion_sla ? 'verde' : 'gris'))); };
      return ORDEN_SEM[c(a)] - ORDEN_SEM[c(b)];
    })[0];
    return peor ? semaforo(peor) : '';
  }
  // El paso que sigue para la solicitud: recibir lo nuevo primero; después, lo que falta.
  function siguienteSolicitud(g, todos) {
    if (datos_.solo_lectura) return '';
    var nuevos = g.items.filter(function (i) { return i.estado === 'S01' && (i.puede_tomar || !i.depto || i.puede_asignar || i.asignado === datos_.mi_email); });
    if (nuevos.length) return U.boton({ texto: nuevos.length > 1 ? 'Recibir ' + nuevos.length : 'Recibir', icono: 'check', sm: true, variante: 'primario', clase: 'js-bj2-recibir-sol', datos: { sol: g.id, id: nuevos[0].subsolicitud_id, n: nuevos.length }, titulo: 'Recibir y dar fecha' });
    var p = pasosTxt(todos).c;
    var etiqueta = p.fecha ? 'Dar fecha' : (p.empezar ? 'Empezar' : (p.curso ? 'Resolver' : (p.pausa ? 'Esperando respuesta' : (p.resuelto ? 'Espera confirmación' : ''))));
    return etiqueta ? '<span class="bj2-sig' + (p.fecha ? ' bj2-sig--falta' : '') + '">' + U.esc(etiqueta) + '</span>' : '';
  }
  function tablaSolicitudes(visibles) {
    var grupos = agrupar(visibles);
    var buscando = !!f.texto;
    return '<div class="bj2-tabla-caja"><table class="bj2-tabla bj2-tabla--sol"><thead><tr>' +
      '<th class="bj2-tc-check"><span class="sx2-oculto-visual">Abrir o seleccionar</span></th><th class="bj2-tc-sem"><span class="sx2-oculto-visual">Plazo</span></th>' +
      '<th class="bj2-tc-n">N°</th><th>Pedido</th><th>Pide · ' + (f.cola ? 'servicio' : 'a quién') + '</th><th>Responsable</th><th class="bj2-tc-av">Avance</th><th class="bj2-tc-num" title="Desde que llegó">Antig.</th><th class="bj2-tc-acc">Sigue</th>' +
      '</tr></thead><tbody>' + grupos.map(function (g) {
        var todos = itemsDeSolicitud(g.id);
        var multi = todos.length > 1;
        if (!multi) return filaSolicitudSola(g.items[0], todos);
        var abierta = buscando || !!expandidas_[g.id];
        var i0 = g.i;
        var titulos = todos.map(function (x) { return x.numero_item + '. ' + (x.titulo || ''); });
        var personas = {}, lista = [];
        todos.forEach(function (x) { if (x.asignado && !personas[x.asignado]) { personas[x.asignado] = true; lista.push(PY.persona(x.asignado, x.asignado_nombre)); } });
        var donde = i0.depto ? (f.cola ? '' : i0.depto_nombre + ' · ') + (i0.servicio_nombre || 'Otro pedido') : (i0.empresa_nombre || '');
        var resumen = pasosTxt(todos).texto;
        return '<tr class="bj2-tr bj2-tr-sol' + (abierta ? ' bj2-tr-sol--abierta' : '') + '" data-sol="' + U.esc(g.id) + '" tabindex="0" title="Abrir la solicitud completa">' +
            '<td class="bj2-tc-check"><button type="button" class="bj2-expandir js-bj2-expandir" data-sol="' + U.esc(g.id) + '" aria-expanded="' + abierta + '" aria-label="' + (abierta ? 'Ocultar' : 'Ver') + ' los ' + todos.length + ' ítems de ' + U.esc(g.id) + '">' + U.ico('derecha', 14) + '</button></td>' +
            '<td class="bj2-tc-sem">' + semaforoPeor(g.items) + '</td>' +
            '<td class="bj2-tc-n"><span class="bj2-sol-n">' + U.esc(g.id) + '</span><small class="bj2-sol-cuenta">' + todos.length + ' ítems</small></td>' +
            '<td title="' + U.esc(titulos.join(' · ')) + '"><span class="bj2-tc-cortar"><span class="bj2-prio-mini sx2-tono-' + tonoPrioridad(i0.prioridad) + '">' + U.esc(i0.prioridad || '—') + '</span><strong>' + U.esc(todos[0].titulo || '') + '</strong><small class="sx2-tenue">' + (todos.length > 1 ? ' y ' + (todos.length - 1) + ' más' : '') + '</small>' +
              (g.items.some(function (x) { return x.respuesta_pendiente; }) ? U.badge('Te escribió', 'info', true) : '') + '</span></td>' +
            '<td title="' + U.esc((i0.solicitante_nombre || '') + (donde ? ' · ' + donde : '')) + '"><span class="bj2-tc-cortar"><b class="bj2-pide">' + U.esc(i0.solicitante_nombre || i0.solicitante_email || '') + '</b>' + (donde ? '<small class="sx2-tenue">· ' + U.esc(donde) + '</small>' : '') + '</span></td>' +
            '<td>' + (lista.length === 1 ? '<span class="bj2-tc-quien">' + U.avatar(lista[0], 'xs') + '<span class="bj2-tc-cortar">' + U.esc(lista[0].nombre) + '</span></span>'
              : (lista.length ? '<span class="bj2-tc-quien">' + U.avatares(lista, 3) + '<span class="bj2-tc-cortar">' + lista.length + ' personas</span></span>' : '<span class="bj2-sin">' + U.ico('persona', 13) + 'Sin asignar</span>')) + '</td>' +
            '<td class="bj2-tc-av" title="' + U.esc(resumen) + '">' + barraAvance(todos) + '<small class="bj2-avance__txt">' + U.esc(resumen) + '</small></td>' +
            '<td class="bj2-tc-num">' + antiguedad(todos.slice().sort(function (a, b) { return new Date(a.fecha_creacion) - new Date(b.fecha_creacion); })[0]) + '</td>' +
            '<td class="bj2-tc-acc">' + siguienteSolicitud(g, todos) + '</td></tr>' +
          (abierta ? todos.map(function (it) { return filaItemDeSolicitud(it, g.items.indexOf(it) !== -1); }).join('') : '');
      }).join('') + '</tbody></table></div>';
  }
  // Una solicitud de un solo ítem: una fila que se comporta como el ítem (se selecciona y se abre en él).
  function filaSolicitudSola(i, todos) {
    var marcado = !!sel_[i.subsolicitud_id];
    var persona = i.asignado ? PY.persona(i.asignado, i.asignado_nombre) : null;
    var donde = i.depto ? (f.cola ? '' : i.depto_nombre + ' · ') + (i.servicio_nombre || 'Otro pedido') : (i.empresa_nombre || '') + (i.tipo_nombre ? ' · ' + i.tipo_nombre : '');
    var paso = caminoDe(i).filter(function (p) { return p.est === 'actual' || p.est === 'falta'; })[0];
    return '<tr class="bj2-tr bj2-tr-sol bj2-tr-sol--uno' + (marcado ? ' bj2-fila--sel' : '') + '" data-bj2-item="' + U.esc(i.subsolicitud_id) + '" data-sol="' + U.esc(i.solicitud_id) + '" tabindex="0">' +
      '<td class="bj2-tc-check">' + (datos_.solo_lectura ? '' : '<label class="bj2-check" title="Seleccionar"><input type="checkbox" class="js-bj2-sel"' + (marcado ? ' checked' : '') + ' aria-label="Seleccionar ' + U.esc(i.titulo) + '"></label>') + '</td>' +
      '<td class="bj2-tc-sem">' + semaforo(i) + '</td>' +
      '<td class="bj2-tc-n"><span class="bj2-sol-n">' + U.esc(i.solicitud_id) + '</span></td>' +
      '<td class="bj2-tc-titulo"><span class="bj2-tc-cortar"><span class="bj2-prio-mini sx2-tono-' + tonoPrioridad(i.prioridad) + '" title="Prioridad ' + U.esc(i.prioridad || '') + '">' + U.esc(i.prioridad || '—') + '</span><strong>' + U.esc(i.titulo || '(sin título)') + '</strong>' +
        (i.respuesta_pendiente ? U.badge('Te escribió', 'info', true) : '') + (i.empresa_cliente ? '<small class="sx2-tenue"> · ' + U.esc(i.empresa_cliente) + '</small>' : '') + '</span></td>' +
      '<td title="' + U.esc((i.solicitante_nombre || i.solicitante_email || '') + (donde ? ' · ' + donde : '')) + '"><span class="bj2-tc-cortar"><b class="bj2-pide">' + U.esc(i.solicitante_nombre || i.solicitante_email || '') + '</b>' + (donde ? '<small class="sx2-tenue">· ' + U.esc(donde) + '</small>' : '') + '</span></td>' +
      '<td>' + (persona ? '<span class="bj2-tc-quien">' + U.avatar(persona, 'xs') + '<span class="bj2-tc-cortar">' + U.esc(persona.nombre) + '</span></span>' : '<span class="bj2-sin">' + U.ico('persona', 13) + 'Sin asignar</span>') + '</td>' +
      '<td class="bj2-tc-av">' + barraAvance(todos) + '<small class="bj2-avance__txt' + (notaPaso(i).falta ? ' bj2-avance__txt--falta' : '') + '">' + U.esc(notaPaso(i).t) + '</small></td>' +
      '<td class="bj2-tc-num">' + antiguedad(i) + '</td>' +
      '<td class="bj2-tc-acc">' + siguienteSolicitud({ id: i.solicitud_id, items: [i] }, todos) + '</td></tr>';
  }
  // Un ítem dentro de una solicitud desplegada: «Ítem n de N», su camino y su botón.
  function filaItemDeSolicitud(it, visible) {
    var marcado = !!sel_[it.subsolicitud_id];
    var persona = it.asignado ? PY.persona(it.asignado, it.asignado_nombre) : null;
    var paso = caminoDe(it).filter(function (p) { return p.est === 'actual' || p.est === 'falta'; })[0];
    var nota = it.estado === 'S06' ? 'esperando respuesta' : (it.estado === 'S08' ? 'resuelto: espera a quien pidió' : (paso ? (paso.est === 'falta' ? 'falta: ' : 'sigue: ') + paso.nombre.toLowerCase() : estadoVis(it.estado)));
    return '<tr class="bj2-tr bj2-tr--hijo' + (visible ? '' : ' bj2-tr--otro') + (marcado ? ' bj2-fila--sel' : '') + '" data-bj2-item="' + U.esc(it.subsolicitud_id) + '" data-sol="' + U.esc(it.solicitud_id) + '" tabindex="0">' +
      '<td class="bj2-tc-check">' + (datos_.solo_lectura || !visible ? '' : '<label class="bj2-check" title="Seleccionar"><input type="checkbox" class="js-bj2-sel"' + (marcado ? ' checked' : '') + ' aria-label="Seleccionar ' + U.esc(it.titulo) + '"></label>') + '</td>' +
      '<td class="bj2-tc-sem">' + semaforo(it) + '</td>' +
      '<td class="bj2-tc-n"><span class="bj2-nitem">Ítem ' + it.numero_item + ' de ' + it.cantidad_items + '</span></td>' +
      '<td class="bj2-tc-titulo"><span class="bj2-tc-cortar"><span class="bj2-prio-mini sx2-tono-' + tonoPrioridad(it.prioridad) + '">' + U.esc(it.prioridad || '—') + '</span><strong>' + U.esc(it.titulo || '(sin título)') + '</strong></span></td>' +
      '<td><span class="bj2-tc-cortar sx2-tenue">' + (it.fecha_comprometida ? U.ico('calendario', 12) + ' para el ' + U.esc(fechaCorta(it.fecha_comprometida)) : '') + '</span></td>' +
      '<td>' + (persona ? '<span class="bj2-tc-quien">' + U.avatar(persona, 'xs') + '<span class="bj2-tc-cortar">' + U.esc(persona.nombre) + '</span></span>' : '<span class="bj2-sin">' + U.ico('persona', 13) + 'Sin asignar</span>') + '</td>' +
      '<td class="bj2-tc-av">' + caminoMini(it) + '<small class="bj2-avance__txt' + (notaPaso(it).falta ? ' bj2-avance__txt--falta' : '') + '">' + U.esc(notaPaso(it).t) + '</small></td>' +
      '<td class="bj2-tc-num">' + antiguedad(it) + '</td>' +
      '<td class="bj2-tc-acc">' + (datos_.solo_lectura || it.estado !== 'S01' ? '' : U.boton({ texto: 'Recibir', sm: true, variante: 'primario', clase: 'js-bj2-recibir', datos: { id: it.subsolicitud_id }, titulo: 'Recibir y dar fecha' })) + '</td></tr>';
  }
  // El camino del ítem en cinco tramos finos (el mismo del detalle).
  var SIGUE_TXT = { 'Recibido': 'por recibir', 'Con fecha': 'por dar fecha', 'En curso': 'por empezar', 'Resuelto': 'en curso', 'Confirmado': 'espera confirmación' };
  var FALTA_TXT = { 'Recibido': 'falta recibirlo', 'Con fecha': 'falta la fecha', 'En curso': 'falta empezarlo' };
  function notaPaso(it) {
    if (it.estado === 'S06') return { t: 'esperando respuesta', falta: false };
    if (it.estado === 'S08') return { t: 'resuelto: espera a quien pidió', falta: false };
    if (['S09', 'S10', 'S11'].indexOf(it.estado) !== -1) return { t: estadoVis(it.estado).toLowerCase(), falta: false };
    var c = caminoDe(it), falta = c.filter(function (p) { return p.est === 'falta'; })[0], actual = c.filter(function (p) { return p.est === 'actual'; })[0];
    if (falta) return { t: FALTA_TXT[falta.nombre] || 'falta: ' + falta.nombre.toLowerCase(), falta: true };
    return { t: actual ? SIGUE_TXT[actual.nombre] || actual.nombre.toLowerCase() : estadoVis(it.estado), falta: false };
  }
  function caminoMini(it) {
    return '<span class="bj2-mini" role="img" aria-label="Camino: ' + U.esc(caminoDe(it).map(function (p) { return p.nombre + ' ' + (p.est === 'hecho' ? 'hecho' : p.est); }).join(', ')) + '">' +
      caminoDe(it).map(function (p) { return '<i class="bj2-mini__t bj2-mini__t--' + p.est + '" title="' + U.esc(p.nombre) + '"></i>'; }).join('') + '</span>';
  }

  // Etapa 4: una línea por ítem (~44 px). Las mismas acciones que la lista.
  function tabla(visibles) {
    if (f.agrupar) return tablaSolicitudes(visibles);
    return '<div class="bj2-tabla-caja"><table class="bj2-tabla"><thead><tr>' +
      '<th class="bj2-tc-check"><span class="sx2-oculto-visual">Seleccionar</span></th><th class="bj2-tc-sem"><span class="sx2-oculto-visual">Plazo</span></th>' +
      '<th>N°</th><th>Pedido</th><th>Pide · ' + (f.cola ? 'servicio' : 'a quién') + '</th><th>Responsable</th><th>Estado</th><th class="bj2-tc-num" title="Desde que llegó">Antig.</th><th class="bj2-tc-comp">Compromiso</th><th class="bj2-tc-acc"><span class="sx2-oculto-visual">Acciones</span></th>' +
      '</tr></thead><tbody>' + (f.agrupar ? agrupar(visibles) : visibles.map(function (i) { return { id: i.solicitud_id, i: i, items: [i], suelto: true }; })).map(function (g) {
        var multi = !g.suelto && g.i.cantidad_items > 1;
        // La fila de la solicitud usa las mismas columnas (una celda a lo ancho desordenaba los anchos):
        // N° en N°, en qué van sus ítems en Pedido y quién pide en su columna. Un clic abre la solicitud.
        var res = resumenSolicitud(g.id), resCorto = resumenSolicitud(g.id, true);
        return (multi ? '<tr class="bj2-tr-grupo js-bj2-abrir-sol" data-sol="' + U.esc(g.id) + '" tabindex="0" title="Abrir la solicitud completa">' +
            '<td class="bj2-tc-check">' + U.ico('capas', 14) + '</td><td class="bj2-tc-sem"></td>' +
            '<td class="bj2-id"><strong class="bj2-tr-grupo__id">' + U.esc(g.id) + '</strong></td>' +
            '<td title="' + U.esc(res) + '"><span class="bj2-tc-cortar bj2-grupo__res">' + U.esc(resCorto) + '</span></td>' +
            '<td><span class="bj2-tc-cortar"><b class="bj2-pide">' + U.esc(g.i.solicitante_nombre || g.i.solicitante_email || '') + '</b>' + (g.i.empresa_nombre ? '<small class="sx2-tenue">· ' + U.esc(g.i.empresa_nombre) + '</small>' : '') + '</span></td>' +
            '<td></td><td></td><td></td><td class="bj2-tc-comp"></td><td class="bj2-tc-acc"></td></tr>' : '') +
          g.items.map(function (i) { return filaTabla(i, multi); }).join('');
      }).join('') + '</tbody></table></div>';
  }
  function filaTabla(i, enGrupo) {
        var marcado = !!sel_[i.subsolicitud_id];
        var persona = i.asignado ? PY.persona(i.asignado, i.asignado_nombre) : null;
        var donde = i.depto ? (f.cola ? '' : i.depto_nombre + ' · ') + (i.servicio_nombre || 'Otro pedido') : (i.empresa_nombre || '') + (i.tipo_nombre ? ' · ' + i.tipo_nombre : '');
        return '<tr class="bj2-tr' + (enGrupo ? ' bj2-tr--hijo' : '') + (marcado ? ' bj2-fila--sel' : '') + '" data-bj2-item="' + U.esc(i.subsolicitud_id) + '" data-sol="' + U.esc(i.solicitud_id) + '" tabindex="0">' +
          '<td class="bj2-tc-check">' + (datos_.solo_lectura ? '' : '<label class="bj2-check" title="Seleccionar"><input type="checkbox" class="js-bj2-sel"' + (marcado ? ' checked' : '') + ' aria-label="Seleccionar ' + U.esc(i.titulo) + '"></label>') + '</td>' +
          '<td class="bj2-tc-sem">' + semaforo(i) + '</td>' +
          '<td class="bj2-id">' + (enGrupo ? '<span class="bj2-nitem">' + U.esc(nItem(i)) + '</span>' : U.esc(i.solicitud_id) + (i.cantidad_items > 1 ? '<small> · ítem ' + i.numero_item + '</small>' : '')) + '</td>' +
          '<td class="bj2-tc-titulo"><span class="bj2-tc-cortar"><span class="bj2-prio-mini sx2-tono-' + tonoPrioridad(i.prioridad) + '" title="Prioridad ' + U.esc(i.prioridad || '') + '">' + U.esc(i.prioridad || '—') + '</span><strong>' + U.esc(i.titulo || '(sin título)') + '</strong>' +
            (i.respuesta_pendiente ? U.badge('Te escribió', 'info', true) : '') + (i.empresa_cliente ? '<small class="sx2-tenue"> · ' + U.esc(i.empresa_cliente) + '</small>' : '') + '</span></td>' +
          '<td title="' + U.esc((i.solicitante_nombre || i.solicitante_email || '') + (donde ? ' · ' + donde : '')) + '"><span class="bj2-tc-cortar"><b class="bj2-pide">' + U.esc(i.solicitante_nombre || i.solicitante_email || '') + '</b>' + (donde ? '<small class="sx2-tenue">· ' + U.esc(donde) + '</small>' : '') + '</span></td>' +
          '<td>' + (persona ? '<span class="bj2-tc-quien">' + U.avatar(persona, 'xs') + '<span class="bj2-tc-cortar">' + U.esc(persona.nombre) + '</span></span>' : '<span class="bj2-sin">' + U.ico('persona', 13) + 'Sin asignar</span>') + '</td>' +
          '<td>' + badgeEstado(i) + '</td>' +
          '<td class="bj2-tc-num">' + antiguedad(i) + '</td>' +
          '<td class="bj2-tc-comp">' + (i.fecha_comprometida ? '<span' + (vencida(i) ? ' class="bj2-tarde" title="Fecha comprometida vencida"' : '') + '>' + fechaCorta(i.fecha_comprometida) + '</span>' : '<span class="sx2-tenue">—</span>') + '</td>' +
          '<td class="bj2-tc-acc">' + (datos_.solo_lectura ? '' : (i.puede_tomar
            ? U.boton({ texto: 'Tomar', sm: true, variante: 'primario', clase: 'js-bj2-tomar', datos: { id: i.subsolicitud_id }, titulo: 'Queda a tu nombre' })
            : (i.estado === 'S01' && (!i.depto || i.puede_asignar || i.asignado === datos_.mi_email) ? U.boton({ texto: 'Recibir', sm: true, variante: 'primario', clase: 'js-bj2-recibir', datos: { id: i.subsolicitud_id } }) : ''))) + '</td>' +
        '</tr>';
  }

  // Etapa 4: por estado visible. Sin arrastrar: cada cambio se hace con su botón en el detalle.
  function tablero() {
    var q = f.texto.toLowerCase();
    var base = datos_.items.filter(function (i) {
      if (CERRADOS.indexOf(i.estado) !== -1 || i.estado === 'S08') return false;
      if (f.empresa && i.empresa_id !== f.empresa) return false;
      if (f.prioridad && i.prioridad !== f.prioridad) return false;
      if (q && [i.solicitud_id, i.titulo, i.solicitante_nombre, i.asignado_nombre, i.servicio_nombre, i.depto_nombre, i.empresa_cliente].join(' ').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var COLS = [['NUEVA', 'Nueva', 'info'], ['EN_CURSO', 'En curso', 'hito'], ['ESPERANDO', 'Esperando respuesta', 'alerta']];
    var MAX = 40;
    var resueltas = datos_.items.filter(function (i) { return i.estado === 'S08'; }).length;
    return (resueltas ? '<p class="bj2-resueltas">' + U.ico('check', 14) + '<span><b>' + resueltas + (resueltas === 1 ? ' resuelta espera' : ' resueltas esperan') + '</b> que quien pidió confirme (si no responde, se cierra sola a los 5 días hábiles). Ya no están en tu lista de trabajo.</span>' +
        U.boton({ texto: 'Ver por validar', sm: true, variante: 'fantasma', clase: 'js-bj2-ver-validar' }) + '</p>' : '') +
      '<div class="bj2-tablero">' + COLS.map(function (c) {
      var lista = base.filter(function (i) { return visible(i.estado) === c[0]; }).sort(function (a, b) {
        var ORD = { FUERA_DE_PLAZO: 0, EN_RIESGO: 1 };
        var sa = ORD[a.situacion_sla] !== undefined ? ORD[a.situacion_sla] : 2, sb = ORD[b.situacion_sla] !== undefined ? ORD[b.situacion_sla] : 2;
        return (sa - sb) || (new Date(a.fecha_creacion) - new Date(b.fecha_creacion));
      });
      return '<section class="bj2-col sx2-tono-' + c[2] + '"><header class="bj2-col__cab"><strong>' + c[1] + '</strong><span class="bj2-col__n">' + lista.length + '</span></header>' +
        '<ul class="bj2-col__lista">' + lista.slice(0, MAX).map(function (i) {
          var persona = i.asignado ? PY.persona(i.asignado, i.asignado_nombre) : null;
          return '<li class="bj2-tarj" data-bj2-item="' + U.esc(i.subsolicitud_id) + '" data-sol="' + U.esc(i.solicitud_id) + '" tabindex="0">' +
            '<span class="bj2-tarj__cab">' + semaforo(i) + '<span class="bj2-id">' + U.esc(i.solicitud_id) + (i.cantidad_items > 1 ? ' · ítem ' + i.numero_item + ' de ' + i.cantidad_items : '') + '</span><span class="sx2-tenue bj2-tarj__edad">' + antiguedad(i) + '</span></span>' +
            '<strong class="bj2-tarj__tit">' + U.esc(i.titulo || '(sin título)') + '</strong>' +
            '<span class="sx2-tenue bj2-tarj__meta">' + U.esc(i.solicitante_nombre || '') + (i.servicio_nombre ? ' · ' + U.esc(i.servicio_nombre) : '') + '</span>' +
            '<span class="bj2-tarj__pie">' + (persona ? U.avatar(persona, 'xs') + '<span class="sx2-cortar">' + U.esc(persona.nombre) + '</span>' : '<span class="bj2-sin">' + U.ico('persona', 12) + 'Sin asignar</span>') +
              (i.respuesta_pendiente ? U.badge('Te escribió', 'info', true) : '') + '</span>' +
          '</li>';
        }).join('') + (lista.length > MAX ? '<li class="sx2-tenue bj2-col__mas">y ' + (lista.length - MAX) + ' más: usa la tabla o un filtro.</li>' : '') +
        (lista.length ? '' : '<li class="sx2-tenue bj2-col__vacia">Nada aquí.</li>') + '</ul></section>';
    }).join('') + '</div>';
  }

  // =========================================================================
  // Etapa 4 — Reportes: tiempos y cumplimiento por departamento, servicio y
  // persona (reporteSolicitudes.js). El mismo cálculo va al informe mensual.
  // =========================================================================
  function periodoActual() { var h = new Date(); return h.getFullYear() + '-M' + ('0' + (h.getMonth() + 1)).slice(-2); }
  function moverPeriodo(p, n) { var a = Number(p.slice(0, 4)), m = Number(p.slice(6)) - 1 + n; var y = a + Math.floor(m / 12); return y + '-M' + ('0' + ((((m % 12) + 12) % 12) + 1)).slice(-2); }
  var MESES_TXT = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function mesTxt(p) { return MESES_TXT[Number(p.slice(6)) - 1] + ' ' + p.slice(0, 4); }
  function cargarReporte() {
    if (rep_.depto === null) rep_.depto = f.cola || ((datos_.colas || [])[0] || {}).clave || '';
    if (!rep_.periodo) rep_.periodo = periodoActual();
    rep_.cargando = true; rep_.error = '';
    var t = ++turno_;
    api('reporteSolicitudes', { depto: rep_.depto, periodo: rep_.periodo }).then(function (r) {
      if (t !== turno_) return;
      rep_.cargando = false;
      if (!r || !r.ok) { rep_.error = (r && r.message) || 'No se pudo cargar el reporte.'; rep_.datos = null; }
      else rep_.datos = r.data;
      var correos = rep_.datos ? rep_.datos.por_persona.map(function (x) { return x.clave; }).filter(function (x) { return x && x !== 'SIN_ASIGNAR'; }) : [];
      (window.SigsoDirectorio && correos.length ? SigsoDirectorio.resolver(correos) : Promise.resolve()).then(function () { if (f.vista === 'reportes') pintar(true); });
    });
  }
  function tablaRep(cols, filas) {
    return '<div class="bj2-tabla-caja"><table class="bj2-tabla bj2-tabla--rep"><thead><tr>' + cols.map(function (c, k) { return '<th' + (k ? ' class="bj2-tc-num"' : '') + '>' + U.esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      filas.map(function (fl) { return '<tr>' + fl.map(function (v, k) { return '<td' + (k ? ' class="bj2-tc-num"' : '') + '>' + v + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  }
  function pctTxt(x) { return x === null || x === undefined ? '—' : String(x).replace('.', ',') + ' %'; }
  function reportes() {
    var R = rep_.datos;
    var deps = R ? R.departamentos : (datos_.colas || []).map(function (c) { return { clave: c.clave, nombre: c.nombre }; });
    var puedeTodos = R ? R.puede_todos : datos_.rol_actual === 'ADM';
    var meses = []; for (var k = 0; k < 12; k++) meses.push(moverPeriodo(periodoActual(), -k));
    var barra = '<div class="sx2-barra-filtros bj2-rep__barra">' +
      '<select class="sx2-select js-bj2-rep-depto" aria-label="Departamento">' + (puedeTodos ? '<option value="">Todos los departamentos</option>' : '') +
        deps.map(function (d) { return '<option value="' + U.esc(d.clave) + '"' + (rep_.depto === d.clave ? ' selected' : '') + '>' + U.esc(d.nombre) + '</option>'; }).join('') + '</select>' +
      '<select class="sx2-select js-bj2-rep-mes" aria-label="Mes">' + meses.map(function (p) { return '<option value="' + p + '"' + (rep_.periodo === p ? ' selected' : '') + '>' + mesTxt(p) + (p === periodoActual() ? ' (en curso)' : '') + '</option>'; }).join('') + '</select>' +
      '<span style="flex:1"></span>' + (R ? U.boton({ texto: 'Excel', icono: 'exportar', sm: true, clase: 'js-bj2-rep-excel' }) : '') + '</div>';
    if (rep_.error) return barra + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: rep_.error }) });
    if (!R || rep_.cargando && !R) return barra + U.esqueleto('kpis', 5) + U.esqueleto('tabla', 6);
    var T = R.total;
    var kp = '<div class="sx2-fila-kpis sx2-fila-kpis--5">' +
      U.kpi({ i: 0, icono: 'bandeja', tono: 'primario', etiqueta: 'Recibidos', valor: T.recibidos, unidad: T.rechazados ? T.rechazados + ' rechazados o cancelados' : 'en el mes' }) +
      U.kpi({ i: 1, icono: 'reloj', tono: T.mediana_tomar_h === null ? 'neutro' : (T.mediana_tomar_h <= 9 ? 'ok' : (T.mediana_tomar_h <= 18 ? 'alerta' : 'critico')), etiqueta: 'Hasta tomarlos', valor: horasTxt(T.mediana_tomar_h), unidad: 'mediana, en tiempo hábil' }) +
      U.kpi({ i: 2, icono: 'check', tono: 'ok', etiqueta: 'Resueltos', valor: T.resueltos, unidad: T.mediana_resolver_h === null ? 'en el mes' : 'la mitad en ' + horasTxt(T.mediana_resolver_h) }) +
      U.kpi({ i: 3, icono: 'diana', tono: T.pct_a_tiempo === null ? 'neutro' : (T.pct_a_tiempo >= 90 ? 'ok' : (T.pct_a_tiempo >= 75 ? 'alerta' : 'critico')), etiqueta: 'A tiempo', valor: pctTxt(T.pct_a_tiempo), unidad: T.con_plazo ? T.a_tiempo + ' de ' + T.con_plazo + ' con plazo' : 'sin resueltos con plazo' }) +
      U.kpi({ i: 4, icono: 'alerta', tono: T.atrasados ? 'critico' : 'ok', etiqueta: 'Atrasados', valor: T.atrasados, unidad: 'de ' + T.abiertos + ' abiertos' }) +
    '</div>';
    var nota = '<p class="sx2-tenue bj2-rep__nota">' + U.esc(R.depto_nombre) + ' · ' + U.esc(R.periodo_texto) + (R.en_curso ? ' (mes en curso: cifras parciales)' : '') +
      '. Horas hábiles (9 a 18 h, sin feriados). El tiempo «Esperando respuesta» no cuenta. Estas mismas cifras van al informe mensual del área, en «Pedidos internos».</p>';
    var porDep = R.por_departamento && R.por_departamento.length ? U.card({ titulo: 'Por departamento', icono: 'equipo', i: 2, sinRelleno: true, cuerpo: tablaRep(['Departamento', 'Recibidos', 'Resueltos', 'A tiempo', 'Hasta tomarlos', 'Abiertos', 'Atrasados'],
      R.por_departamento.map(function (x) { return [U.esc(x.nombre), x.recibidos, x.resueltos, pctTxt(x.pct_a_tiempo), horasTxt(x.mediana_tomar_h), x.abiertos, x.atrasados ? '<b class="bj2-tarde">' + x.atrasados + '</b>' : 0]; })) }) : '';
    var porServ = U.card({ titulo: 'Por servicio', icono: 'lista', i: 3, sinRelleno: true, cuerpo: R.por_servicio.length ? tablaRep(['Servicio', 'Recibidos', 'Resueltos', 'A tiempo', 'Resolución (mediana)', 'Abiertos', 'Atrasados'],
      R.por_servicio.map(function (x) { return [U.esc(x.nombre), x.recibidos, x.resueltos, pctTxt(x.pct_a_tiempo), horasTxt(x.mediana_resolver_h), x.abiertos, x.atrasados ? '<b class="bj2-tarde">' + x.atrasados + '</b>' : 0]; }))
      : '<div style="padding:16px">' + U.vacio({ icono: 'lista', titulo: 'Sin pedidos en el mes', texto: 'Cuando lleguen pedidos a este departamento, aquí se ven por servicio.' }) + '</div>' });
    var porPers = U.card({ titulo: 'Carga por persona', icono: 'persona', i: 4, sinRelleno: true, cuerpo: R.por_persona.length ? tablaRep(['Persona', 'Abiertos', 'Atrasados', 'Resueltos', 'A tiempo', 'Resolución (mediana)'],
      R.por_persona.map(function (x) {
        var nombre = x.clave === 'SIN_ASIGNAR' ? '<span class="bj2-sin">' + U.ico('persona', 13) + 'Sin asignar</span>' : U.esc(PY.persona(x.clave).nombre);
        return [nombre, x.abiertos, x.atrasados ? '<b class="bj2-tarde">' + x.atrasados + '</b>' : 0, x.resueltos, pctTxt(x.pct_a_tiempo), horasTxt(x.mediana_resolver_h)];
      })) : '<div style="padding:16px">' + U.vacio({ icono: 'persona', texto: 'Sin carga en el mes.' }) + '</div>' });
    var atr = R.atrasados.length ? U.card({ titulo: 'Atrasados al cierre', icono: 'alerta', i: 5, sinRelleno: true, cuerpo: '<ul class="bj2-rep__atr">' + R.atrasados.map(function (x) {
      return '<li><button type="button" class="bj2-rep__atr-op js-bj2-rep-abrir" data-sol="' + U.esc(x.solicitud_id) + '" data-sub="' + U.esc(x.subsolicitud_id) + '">' +
        '<span class="bj2-sem bj2-sem--rojo"></span><span class="bj2-id">' + U.esc(x.solicitud_id) + '</span><strong class="sx2-cortar">' + U.esc(x.titulo) + '</strong>' +
        '<span class="sx2-tenue sx2-cortar">' + U.esc((R.depto ? '' : x.depto_nombre + ' · ') + x.servicio) + ' · ' + (x.asignado ? U.esc(PY.persona(x.asignado).nombre) : 'sin asignar') + '</span>' +
        '<b class="bj2-tarde">' + String(x.dias_atraso).replace('.', ',') + ' d de atraso</b></button></li>';
    }).join('') + '</ul>' }) : '';
    var serie = U.card({ titulo: 'Últimos 6 meses', icono: 'grafico', i: 1, cuerpo: '<div class="sx2-py-grafico"><canvas id="bj2-g-rep"></canvas></div>' });
    return barra + kp + nota + '<div class="sx2-grid sx2-grid--estira">' +
      '<div class="sx2-col-12">' + serie + '</div>' + (porDep ? '<div class="sx2-col-12">' + porDep + '</div>' : '') +
      '<div class="sx2-col-7 sx2-col--apila">' + porServ + '</div><div class="sx2-col-5 sx2-col--apila">' + porPers + '</div>' +
      (atr ? '<div class="sx2-col-12">' + atr + '</div>' : '') + '</div>';
  }
  function dibujarReporte(raiz) {
    var R = rep_.datos, cv = raiz.querySelector('#bj2-g-rep');
    if (!R || !cv || !window.Chart) return;
    var t3 = colorVar(raiz, '--sx-texto-3'), borde = colorVar(raiz, '--sx-borde-suave'), prim = colorVar(raiz, '--sx-primario'), ok = colorVar(raiz, '--sx-ok'), hito = colorVar(raiz, '--sx-hito');
    graficos_.push(new Chart(cv, { data: { labels: R.serie.map(function (x) { return mesTxt(x.periodo).split(' ')[0].slice(0, 3); }),
      datasets: [
        { type: 'bar', label: 'Recibidos', data: R.serie.map(function (x) { return x.recibidos; }), backgroundColor: hito, borderRadius: 5, maxBarThickness: 22, yAxisID: 'y' },
        { type: 'bar', label: 'Resueltos', data: R.serie.map(function (x) { return x.resueltos; }), backgroundColor: prim, borderRadius: 5, maxBarThickness: 22, yAxisID: 'y' },
        { type: 'line', label: '% a tiempo', data: R.serie.map(function (x) { return x.pct_a_tiempo; }), borderColor: ok, backgroundColor: ok, tension: .3, spanGaps: true, yAxisID: 'y2' }
      ] },
      options: { maintainAspectRatio: false, animation: U.reducirMovimiento() ? false : { duration: 500 },
        plugins: { legend: { labels: { color: t3, boxWidth: 12, font: { size: 11 } } } },
        scales: { x: { grid: { display: false }, ticks: { color: t3 } }, y: { beginAtZero: true, ticks: { color: t3, precision: 0 }, grid: { color: borde } },
          y2: { position: 'right', min: 0, max: 100, grid: { display: false }, ticks: { color: t3, callback: function (v) { return v + ' %'; } } } } } }));
  }
  function excelReporte(b) {
    var R = rep_.datos;
    if (!R) return;
    var num = function (h) { return h === null || h === undefined ? '' : Math.round(h * 10) / 10; };
    SigsoReportes.descargarExcelDeDatos({ titulo: 'Pedidos · ' + R.depto_nombre + ' · ' + R.periodo_texto, nombreArchivo: 'sigso-pedidos-' + (R.depto || 'todos').toLowerCase() + '-' + R.periodo.replace('-M', '-'),
      meta: [['Departamento', R.depto_nombre], ['Mes', R.periodo_texto], ['Recibidos', String(R.total.recibidos)], ['A tiempo', R.total.pct_a_tiempo === null ? '—' : R.total.pct_a_tiempo + ' %'], ['Atrasados', String(R.total.atrasados)]],
      hojas: [
        { nombre: 'Por servicio', columnas: ['Servicio', 'Recibidos', 'Resueltos', 'A tiempo (%)', 'Hasta tomarlos (h háb.)', 'Resolución mediana (h háb.)', 'Abiertos', 'Atrasados'],
          filas: R.por_servicio.map(function (x) { return [x.nombre, x.recibidos, x.resueltos, x.pct_a_tiempo === null ? '' : x.pct_a_tiempo, num(x.mediana_tomar_h), num(x.mediana_resolver_h), x.abiertos, x.atrasados]; }) },
        { nombre: 'Por persona', columnas: ['Persona', 'Abiertos', 'Atrasados', 'Resueltos', 'A tiempo (%)', 'Resolución mediana (h háb.)'],
          filas: R.por_persona.map(function (x) { return [x.clave === 'SIN_ASIGNAR' ? 'Sin asignar' : PY.persona(x.clave).nombre, x.abiertos, x.atrasados, x.resueltos, x.pct_a_tiempo === null ? '' : x.pct_a_tiempo, num(x.mediana_resolver_h)]; }) },
        { nombre: 'Últimos 6 meses', columnas: ['Mes', 'Recibidos', 'Resueltos', 'A tiempo (%)', 'Atrasados al cierre'],
          filas: R.serie.map(function (x) { return [x.periodo_texto, x.recibidos, x.resueltos, x.pct_a_tiempo === null ? '' : x.pct_a_tiempo, x.atrasados]; }) },
        { nombre: 'Atrasados', columnas: ['Solicitud', 'Título', 'Servicio', 'Responsable', 'Días hábiles de atraso'],
          filas: R.atrasados.map(function (x) { return [x.solicitud_id, x.titulo, x.servicio, x.asignado ? PY.persona(x.asignado).nombre : 'Sin asignar', x.dias_atraso]; }) }
      ] }, { boton: b });
  }

  function barraLote() {
    var n = Object.keys(sel_).length;
    if (!n || datos_.solo_lectura) return '';
    return '<div class="bj2-lote" role="region" aria-label="Acciones sobre la selección">' +
      '<strong>' + n + (n === 1 ? ' seleccionado' : ' seleccionados') + '</strong>' +
      U.boton({ texto: 'Recibir', icono: 'check', sm: true, clase: 'js-bj2-lote', datos: { accion: 'recibir' } }) +
      U.boton({ texto: 'Asignar', icono: 'persona', sm: true, clase: 'js-bj2-lote', datos: { accion: 'asignar' } }) +
      U.boton({ texto: 'Prioridad', icono: 'bandera', sm: true, clase: 'js-bj2-lote', datos: { accion: 'prioridad' } }) +
      U.boton({ texto: 'Fecha', icono: 'calendario', sm: true, clase: 'js-bj2-lote', datos: { accion: 'fecha' } }) +
      U.boton({ texto: 'Estado', icono: 'estado', sm: true, clase: 'js-bj2-lote', datos: { accion: 'estado' } }) +
      U.boton({ soloIcono: true, icono: 'equis', sm: true, variante: 'fantasma', titulo: 'Quitar la selección', clase: 'js-bj2-limpiar' }) +
    '</div>';
  }

  function analisis() {
    var items = datos_.items;
    var ab = items.filter(abierto);
    var porResp = {};
    ab.forEach(function (i) { var k = i.asignado ? PY.persona(i.asignado, i.asignado_nombre).nombre : 'Sin asignar'; porResp[k] = (porResp[k] || 0) + 1; });
    var edades = { '0–7 días': 0, '8–30 días': 0, '31–60 días': 0, 'Más de 60 días': 0 };
    ab.forEach(function (i) {
      var d = (Date.now() - new Date(i.fecha_creacion)) / 86400000;
      edades[d <= 7 ? '0–7 días' : (d <= 30 ? '8–30 días' : (d <= 60 ? '31–60 días' : 'Más de 60 días'))]++;
    });
    return '<div class="sx2-grid sx2-grid--estira">' +
      '<div class="sx2-col-6 sx2-col--apila">' + U.card({ titulo: 'Abiertos por estado', icono: 'estado', i: 2, cuerpo: '<div class="sx2-py-grafico sx2-py-grafico--alto"><canvas id="bj2-g-estado"></canvas></div>' }) + '</div>' +
      '<div class="sx2-col-6 sx2-col--apila">' + U.card({ titulo: 'Antigüedad de lo abierto', icono: 'reloj', i: 3, cuerpo: '<div class="sx2-py-grafico sx2-py-grafico--alto"><canvas id="bj2-g-edad"></canvas></div>' }) + '</div>' +
      '<div class="sx2-col-6 sx2-col--apila">' + U.card({ titulo: 'Carga por responsable', icono: 'equipo', i: 4, cuerpo: '<div class="sx2-py-grafico sx2-py-grafico--alto"><canvas id="bj2-g-resp"></canvas></div>' }) + '</div>' +
      '<div class="sx2-col-6 sx2-col--apila">' + U.card({ titulo: 'Abiertos por prioridad', icono: 'bandera', i: 5, cuerpo: '<div class="sx2-py-grafico sx2-py-grafico--alto"><canvas id="bj2-g-prio"></canvas></div>' }) + '</div>' +
    '</div>' +
    '<script type="application/json" id="bj2-analisis-datos">' + JSON.stringify({ resp: porResp, edades: edades }).replace(/</g, '\\u003c') + '</script>';
  }

  function pintar(silencioso) {
    var c = contenedor();
    if (!c || !datos_) return;
    var y = window.scrollY;
    graficos_.forEach(function (g) { try { g.destroy(); } catch (e) { /* ya destruido */ } });
    graficos_ = [];
    c.innerHTML = '<div class="sx2-pagina">' + cabecera() +
      (f.vista === 'reportes' ? reportes() : (f.vista === 'analisis' ? kpis() + analisis() : banda() + lista())) +
    '</div>' + (f.vista === 'cola' ? barraLote() : '');
    if (silencioso) {
      c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; });
      window.scrollTo(0, y);
    }
    U.animar(c);
    if (f.vista === 'analisis') dibujarAnalisis(c);
    if (f.vista === 'reportes') dibujarReporte(c);
  }

  // Marcar casillas no repinta la página: solo la fila, la casilla general y
  // la barra de lote (conserva foco y scroll).
  function actualizarSeleccion() {
    var c = document.getElementById('bandeja-v2');
    if (!c) return;
    c.querySelectorAll('[data-bj2-item]').forEach(function (el) {
      var m = !!sel_[el.getAttribute('data-bj2-item')];
      el.classList.toggle('bj2-fila--sel', m);
      var cb = el.querySelector('.js-bj2-sel');
      if (cb) cb.checked = m;
    });
    var todo = c.querySelector('.js-bj2-sel-todo');
    if (todo) todo.checked = filtrados().slice(0, mostrar_).every(function (i) { return sel_[i.subsolicitud_id]; });
    var vieja = c.querySelector('.bj2-lote');
    var html = barraLote();
    if (vieja) vieja.outerHTML = html || '';
    else if (html) c.insertAdjacentHTML('beforeend', html);
  }

  function colorVar(raiz, v) {
    var el = document.createElement('span'); el.style.color = 'var(' + v + ')'; el.style.display = 'none';
    raiz.appendChild(el); var col = getComputedStyle(el).color; el.remove(); return col;
  }
  function dibujarAnalisis(raiz) {
    if (!window.Chart) return;
    var ab = datos_.items.filter(abierto);
    var extra = JSON.parse((raiz.querySelector('#bj2-analisis-datos') || {}).textContent || '{}');
    var t3 = colorVar(raiz, '--sx-texto-3'), borde = colorVar(raiz, '--sx-borde-suave');
    var prim = colorVar(raiz, '--sx-primario'), crit = colorVar(raiz, '--sx-critico'), alerta = colorVar(raiz, '--sx-alerta'), info = colorVar(raiz, '--sx-info'), hito = colorVar(raiz, '--sx-hito'), neutro = colorVar(raiz, '--sx-texto-3');
    function barra(id, etiquetas, valores, colores, horizontal) {
      var cv = raiz.querySelector('#' + id);
      if (!cv) return;
      graficos_.push(new Chart(cv, { type: 'bar', data: { labels: etiquetas, datasets: [{ data: valores, backgroundColor: colores, borderRadius: 6, maxBarThickness: 28 }] },
        options: { indexAxis: horizontal ? 'y' : 'x', maintainAspectRatio: false, animation: U.reducirMovimiento() ? false : { duration: 600 },
          plugins: { legend: { display: false } },
          scales: { x: { grid: { display: !!horizontal, color: borde }, ticks: { color: t3, font: { size: 11 } } }, y: { grid: { display: !horizontal, color: borde }, ticks: { color: t3, font: { size: 11 }, precision: 0 }, beginAtZero: true } } } }));
    }
    var porEstado = {};
    ab.forEach(function (i) { porEstado[i.estado] = (porEstado[i.estado] || 0) + 1; });
    var est = ORDEN_ESTADO.filter(function (e) { return porEstado[e]; });
    barra('bj2-g-estado', est.map(estadoTxt), est.map(function (e) { return porEstado[e]; }), prim);
    var edades = extra.edades || {};
    barra('bj2-g-edad', Object.keys(edades), Object.keys(edades).map(function (k) { return edades[k]; }), [info, prim, alerta, crit]);
    var resp = extra.resp || {};
    var nombres = Object.keys(resp).sort(function (a, b) { return resp[b] - resp[a]; }).slice(0, 8);
    barra('bj2-g-resp', nombres, nombres.map(function (k) { return resp[k]; }), nombres.map(function (k) { return k === 'Sin asignar' ? neutro : hito; }), true);
    var porPrio = {};
    ab.forEach(function (i) { porPrio[i.prioridad || '—'] = (porPrio[i.prioridad || '—'] || 0) + 1; });
    var ps = PRIORIDADES.filter(function (p) { return porPrio[p]; });
    barra('bj2-g-prio', ps, ps.map(function (p) { return porPrio[p]; }), ps.map(function (p) { return p === 'P1' ? crit : (p === 'P2' ? alerta : (p === 'P3' ? info : neutro)); }));
  }

  // --- Acciones de la cola -------------------------------------------------------------
  function item(id) { return datos_.items.filter(function (i) { return i.subsolicitud_id === id; })[0]; }
  function seleccionados() { return datos_.items.filter(function (i) { return sel_[i.subsolicitud_id]; }); }

  // R-4: Excel real en vez de CSV (fechas y días como valores, filtros, encabezado fijo).
  var SLA_EXCEL = { FUERA_DE_PLAZO: { v: 'Fuera de plazo', tono: 'critico' }, EN_RIESGO: { v: 'En riesgo', tono: 'alerta' }, EN_PLAZO: { v: 'En plazo', tono: 'ok' } };
  function exportarExcel(b) {
    var cols = ['Solicitud', 'Ítem', 'Título', 'Empresa', 'Tipo', 'Estado', 'Prioridad', 'Responsable', 'Fecha comprometida', 'Ingresada', 'Días sin movimiento', 'SLA', 'Solicitante'];
    var filas = filtrados().map(function (i) {
      return [i.solicitud_id, String(i.numero_item == null ? '' : i.numero_item), i.titulo, i.empresa_nombre, i.tipo_nombre, estadoTxt(i.estado), i.prioridad,
        i.asignado ? PY.persona(i.asignado, i.asignado_nombre).nombre : 'Sin asignar', i.fecha_comprometida ? PY.fecha(i.fecha_comprometida, true) : '', i.fecha_creacion ? PY.fecha(i.fecha_creacion, true) : '',
        i.dias_sin_movimiento == null ? '' : Number(i.dias_sin_movimiento), SLA_EXCEL[i.situacion_sla] || '', i.solicitante_nombre];
    });
    if (!filas.length) { PY.aviso('No hay ítems que exportar con estos filtros.', 'info'); return; }
    SigsoReportes.descargarExcelDeDatos({ titulo: 'Bandeja de trabajo', nombreArchivo: 'sigso-bandeja',
      meta: [['Ítems', String(filas.length)]], hojas: [{ nombre: 'Bandeja', columnas: cols, filas: filas }] }, { boton: b });
  }

  // --- Pauta de trabajo (una persona, para imprimir o guardar en PDF) -----------
  // El documento no está en pantalla: se arma en un contenedor hijo directo de
  // <body> y, solo mientras se imprime, body.bj2-modo-pauta oculta todo lo demás.
  function pautaHtml(p) {
    var items = p.items || [];
    var fila = function (it) {
      var ctx = [];
      if (it.url_modulo) ctx.push('URL: ' + it.url_modulo);
      if (it.usuario_prueba) ctx.push('Usuario de prueba: ' + it.usuario_prueba);
      // Impresa, la pauta sale de SIGSO: la credencial (a veces una contraseña) nunca va.
      if (it.ref_credencial) ctx.push('Credencial: registrada en SIGSO');
      return '<article class="bj2-pauta__item">' +
        '<h3>' + U.esc(it.solicitud_id) + '-' + U.esc(it.numero_item) + ' — ' + U.esc(it.titulo) + '</h3>' +
        '<p class="bj2-pauta__meta">' + U.badge(it.prioridad || '—', tonoPrioridad(it.prioridad)) + ' ' +
          U.esc(it.fecha_comprometida ? 'Comprometida: ' + String(it.fecha_comprometida).replace('T', ' ').slice(0, 16) : 'Sin fecha comprometida') + '</p>' +
        (it.descripcion ? '<p>' + U.esc(it.descripcion) + '</p>' : '') +
        (it.resultado_esperado ? '<p><strong>Resultado esperado:</strong> ' + U.esc(it.resultado_esperado) + '</p>' : '') +
        (ctx.length ? '<p class="bj2-pauta__ctx">' + U.esc(ctx.join(' · ')) + '</p>' : '') +
      '</article>';
    };
    return '<header class="bj2-pauta__cab"><span class="bj2-pauta__marca" aria-hidden="true">S</span><div>' +
        '<h1>Pauta de trabajo — ' + U.esc(PY.persona(p.desarrollador).nombre || p.desarrollador) + '</h1>' +
        '<p>' + items.length + ' pendiente(s) · Generada el ' + U.esc(new Date().toLocaleString('es-CL')) + '</p></div></header>' +
      (items.map(fila).join('') || '<p>Sin pendientes.</p>') +
      '<p class="bj2-pauta__pie">Para cerrar cada una: responde «LISTO &lt;N° de solicitud&gt;» por WhatsApp, o márcala Terminada en el sistema si ya tienes acceso.</p>';
  }
  function imprimirPauta(desarrollador, boton) {
    boton.disabled = true;
    api('getPautaTrabajo', { desarrollador: desarrollador }).then(function (r) {
      boton.disabled = false;
      if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo generar la pauta.', 'error'); return; }
      var cont = document.getElementById('bj2-pauta');
      if (!cont) { cont = document.createElement('div'); cont.id = 'bj2-pauta'; document.body.appendChild(cont); }
      cont.innerHTML = pautaHtml(r.data || {});
      document.body.classList.add('bj2-modo-pauta');
      window.addEventListener('afterprint', function fin() {
        document.body.classList.remove('bj2-modo-pauta');
        cont.innerHTML = '';
        window.removeEventListener('afterprint', fin);
      });
      window.print();
    });
  }

  // Ejecuta una acción ítem por ítem (el backend valida cada uno), muestra el
  // avance y al final resume qué no se pudo y por qué.
  function ejecutarLote(lista, accion, titulo) {
    var hechos = 0, fallas = [];
    PY.aviso(titulo + ': 0 de ' + lista.length + '…');
    return lista.reduce(function (p, i) {
      return p.then(function () {
        return accion(i).then(function (r) {
          if (r && r.ok) hechos++; else fallas.push(i.solicitud_id + (i.cantidad_items > 1 ? '-' + i.numero_item : '') + ': ' + ((r && r.message) || 'error'));
        });
      });
    }, Promise.resolve()).then(function () {
      sel_ = {};
      if (fallas.length) PY.aviso(hechos + ' listos · ' + fallas.length + ' no se pudieron: ' + fallas.slice(0, 3).join(' | ') + (fallas.length > 3 ? '…' : ''), 'error');
      else PY.aviso(titulo + ': ' + hechos + (hechos === 1 ? ' ítem listo.' : ' ítems listos.'), 'exito');
      avisarCambio();
    });
  }

  function formDrawer(o) {
    var d = U.drawer({
      titulo: o.titulo, subtitulo: o.subtitulo ? '<span class="sx2-tenue" style="font-size:.8125rem">' + o.subtitulo + '</span>' : '',
      cuerpo: '<form class="sx2-form js-bj2-form" novalidate>' + o.campos + '<p class="sx2-campo__error js-bj2-error" hidden></p></form>',
      pie: '<span style="flex:1"></span>' + U.boton({ texto: 'Cancelar', clase: 'js-sx2-drawer-cerrar' }) + U.boton({ texto: o.boton || 'Aplicar', icono: 'check', variante: 'primario', clase: 'js-bj2-ok' })
    });
    var form = d.el.querySelector('form'), err = d.el.querySelector('.js-bj2-error');
    function enviar(ev) {
      if (ev) ev.preventDefault();
      var x = {};
      new FormData(form).forEach(function (v, k) { x[k] = String(v).trim(); });
      var msg = o.validar ? o.validar(x) : '';
      if (msg) { err.textContent = msg; err.hidden = false; return; }
      d.cerrar();
      o.aplicar(x);
    }
    form.addEventListener('submit', enviar);
    d.el.querySelector('.js-bj2-ok').addEventListener('click', enviar);
    var primero = form.querySelector('input, select, textarea');
    if (primero) primero.focus();
  }
  function opcionesResponsables(actual) {
    return (datos_.responsables || []).map(function (r) {
      return '<option value="' + U.esc(r.email) + '"' + (String(r.email).toLowerCase() === String(actual || '').toLowerCase() ? ' selected' : '') + '>' + U.esc(PY.persona(r.email, r.nombre).nombre) + '</option>';
    }).join('');
  }

  // Etapa 2: catálogo de servicios del departamento. Lo administra su
  // jefatura: qué se le puede pedir, con qué plazo (días hábiles) y qué tiene
  // que indicar quien pide. Puede partir del mapa de procesos del SGC.
  var PRIORIDAD_TXT = { P1: 'P1 · Crítica', P2: 'P2 · Alta', P3: 'P3 · Media', P4: 'P4 · Baja', P5: 'P5 · Planificada' };
  function abrirServicios(depto) {
    var d = U.drawer({ titulo: 'Servicios', subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Cargando…</span>', cuerpo: U.esqueleto('tabla', 5), pie: ' ' });
    d.el.classList.add('bj2-drawer');
    var dep = null, disponibles = 0, editando = null;

    function cargarS() {
      return api('listarServiciosSolicitudAdmin', {}).then(function (r) {
        if (!r || !r.ok) { d.cuerpo(U.vacio({ icono: 'alerta', titulo: 'No se pudo abrir', texto: (r && r.message) || 'Inténtalo de nuevo.' })); return; }
        dep = (r.data.departamentos || []).filter(function (x) { return x.clave === depto; })[0];
        disponibles = (r.data.procesos_disponibles || {})[depto] || 0;
        if (!dep) { d.cuerpo(U.vacio({ icono: 'alerta', titulo: 'Sin acceso', texto: 'Solo la jefatura del departamento administra su catálogo.' })); return; }
        pintarS();
      });
    }
    function formS(sv) {
      sv = sv || { nombre: '', descripcion: '', ayuda: '', plazo_dias: 3, prioridad: 'P3', activa: true, pide_cliente: 'opcional' };
      var PIDE = [['opcional', 'Opcional'], ['si', 'Sí, es obligatorio'], ['no', 'No se pregunta']];
      return '<form class="sx2-form bj2-item__form js-srv-form" data-id="' + U.esc(sv.servicio_id || '') + '" novalidate>' +
        PY.campo('Nombre del servicio', '<input class="sx2-input" name="nombre" maxlength="120" value="' + U.esc(sv.nombre) + '" placeholder="Ej.: Certificado de antigüedad">') +
        PY.campo('Qué incluye (opcional)', '<textarea class="sx2-input" name="descripcion" maxlength="500">' + U.esc(sv.descripcion) + '</textarea>') +
        PY.campo('Qué debe indicar quien pide (opcional)', '<input class="sx2-input" name="ayuda" maxlength="300" value="' + U.esc(sv.ayuda) + '" placeholder="Ej.: nombre y RUT del trabajador, y para qué lo necesita">', 'Aparece como guía al escribir el pedido.') +
        '<div class="sx2-form__fila">' +
          PY.campo('Plazo (días hábiles)', '<input class="sx2-input" type="number" name="plazo_dias" min="1" max="60" step="1" value="' + U.esc(sv.plazo_dias) + '">') +
          PY.campo('Prioridad', '<select class="sx2-select" name="prioridad">' + PRIORIDADES.map(function (p) { return '<option value="' + p + '"' + (sv.prioridad === p ? ' selected' : '') + '>' + PRIORIDAD_TXT[p] + '</option>'; }).join('') + '</select>') +
        '</div>' +
        PY.campo('¿Pregunta para qué cliente?', '<select class="sx2-select" name="pide_cliente">' + PIDE.map(function (o) { return '<option value="' + o[0] + '"' + ((sv.pide_cliente || 'opcional') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>',
          'Obligatorio, por ejemplo, en un certificado F30; "No se pregunta" en un pedido interno del área.') +
        '<p class="sx2-campo__error js-srv-error" hidden></p>' +
        '<div class="sx2-flex" style="justify-content:flex-end;gap:6px">' + U.boton({ texto: 'Cancelar', sm: true, clase: 'js-srv-cancelar' }) +
          U.boton({ texto: sv.servicio_id ? 'Guardar' : 'Agregar', icono: 'check', sm: true, variante: 'primario', tipo: 'submit' }) + '</div></form>';
    }
    function pintarS() {
      d.el.querySelector('.sx2-drawer__titulo').textContent = 'Servicios de ' + dep.nombre;
      var cab = d.el.querySelector('.sx2-drawer__fila-titulo .sx2-apilado');
      if (cab) {
        cab.querySelectorAll('.sx2-tenue, .bj2-det-sub').forEach(function (e) { e.remove(); });
        cab.insertAdjacentHTML('beforeend', '<span class="bj2-det-sub sx2-tenue" style="font-size:.8125rem">Lo que se le puede pedir al departamento. "Otro pedido" existe siempre.</span>');
      }
      var lista = dep.servicios || [];
      var activos = lista.filter(function (x) { return x.activa; }).length;
      d.cuerpo(
        '<div class="sx2-entre" style="gap:8px;flex-wrap:wrap"><strong>' + activos + (activos === 1 ? ' servicio activo' : ' servicios activos') + '</strong>' +
          '<span class="sx2-flex" style="gap:6px">' +
            (disponibles ? U.boton({ texto: 'Traer del mapa de procesos', icono: 'capas', sm: true, clase: 'js-srv-importar', titulo: disponibles + ' servicios del SGC para este departamento' }) : '') +
            U.boton({ texto: 'Nuevo servicio', icono: 'nueva', sm: true, variante: 'primario', clase: 'js-srv-nuevo' }) +
          '</span></div>' +
        (editando === 'nuevo' ? formS(null) : '') +
        (lista.length ? '<ul class="bj2-servicios">' + lista.map(function (sv) {
          if (editando === sv.servicio_id) return '<li>' + formS(sv) + '</li>';
          return '<li class="bj2-servicio' + (sv.activa ? '' : ' is-inactivo') + '">' +
            '<span class="sx2-apilado" style="gap:2px;min-width:0;flex:1"><strong>' + U.esc(sv.nombre) + '</strong>' +
              '<span class="sx2-tenue" style="font-size:.75rem">' + sv.plazo_dias + (sv.plazo_dias === 1 ? ' día hábil' : ' días hábiles') + ' · ' + U.esc(PRIORIDAD_TXT[sv.prioridad] || sv.prioridad) +
                (sv.proceso_codigo ? ' · ' + U.esc(sv.proceso_codigo) : '') + (sv.pide_cliente === 'si' ? ' · pide el cliente' : (sv.pide_cliente === 'no' ? ' · sin cliente' : '')) + (sv.activa ? '' : ' · desactivado') + '</span>' +
              (sv.ayuda ? '<span class="sx2-tenue" style="font-size:.75rem">Pide: ' + U.esc(sv.ayuda) + '</span>' : '') + '</span>' +
            '<span class="sx2-flex" style="gap:4px;flex:none">' +
              U.boton({ texto: 'Editar', sm: true, variante: 'fantasma', clase: 'js-srv-editar', datos: { id: sv.servicio_id } }) +
              U.boton({ texto: sv.activa ? 'Desactivar' : 'Activar', sm: true, variante: 'fantasma', clase: 'js-srv-activar', datos: { id: sv.servicio_id, activa: sv.activa ? '0' : '1' } }) +
            '</span></li>';
        }).join('') + '</ul>'
          : (editando ? '' : U.vacio({ icono: 'lista', titulo: 'Sin servicios todavía', texto: 'Agrega los pedidos más comunes de ' + dep.nombre + (disponibles ? ', o tráelos del mapa de procesos del SGC.' : '.') + ' Mientras tanto, igual reciben "Otro pedido".' })))
      );
      d.el.querySelector('.sx2-drawer__pie').innerHTML = U.boton({ texto: 'Cerrar', clase: 'js-sx2-drawer-cerrar' });
      var f1 = d.el.querySelector('.js-srv-form input');
      if (f1) f1.focus();
    }
    function guardarS(datos, exito) {
      return api('guardarServicioSolicitud', datos).then(function (r) {
        if (!r || !r.ok) return (r && r.message) || 'No se pudo guardar.';
        editando = null;
        if (exito) PY.aviso(exito, 'exito');
        return cargarS().then(function () { return ''; });
      });
    }
    d.el.addEventListener('click', function (ev) {
      var t = ev.target, b;
      if (t.closest('.js-srv-nuevo')) { editando = 'nuevo'; pintarS(); return; }
      if (t.closest('.js-srv-cancelar')) { editando = null; pintarS(); return; }
      if ((b = t.closest('.js-srv-editar'))) { editando = b.getAttribute('data-id'); pintarS(); return; }
      if ((b = t.closest('.js-srv-activar'))) {
        b.disabled = true;
        guardarS({ servicio_id: b.getAttribute('data-id'), activa: b.getAttribute('data-activa') === '1' }).then(function (m) { if (m) { b.disabled = false; PY.aviso(m, 'error'); } });
        return;
      }
      if ((b = t.closest('.js-srv-importar'))) {
        b.disabled = true;
        api('importarServiciosSolicitudDesdeProcesos', { depto: depto }).then(function (r) {
          b.disabled = false;
          if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo traer.', 'error'); return; }
          PY.aviso(r.data.creados ? r.data.creados + (r.data.creados === 1 ? ' servicio agregado' : ' servicios agregados') + ' desde el mapa de procesos. Revisa sus plazos.' : 'Ya estaban todos en el catálogo.', 'exito');
          cargarS();
        });
      }
    });
    d.el.addEventListener('submit', function (ev) {
      if (!ev.target.classList.contains('js-srv-form')) return;
      ev.preventDefault();
      var form = ev.target, x = {};
      new FormData(form).forEach(function (v, k) { x[k] = String(v).trim(); });
      var err = form.querySelector('.js-srv-error');
      var id = form.getAttribute('data-id');
      var datos = { nombre: x.nombre, descripcion: x.descripcion, ayuda: x.ayuda, plazo_dias: Number(x.plazo_dias), prioridad: x.prioridad, pide_cliente: x.pide_cliente };
      if (id) datos.servicio_id = id; else datos.depto = depto;
      var btn = form.querySelector('[type=submit]'); btn.disabled = true;
      guardarS(datos, id ? 'Servicio actualizado.' : 'Servicio agregado.').then(function (m) {
        btn.disabled = false;
        if (m) { err.textContent = m; err.hidden = false; }
      });
    });
    cargarS();
    return d;
  }

  function lote(accion) {
    var lista = seleccionados();
    if (!lista.length) return;
    var n = lista.length + (lista.length === 1 ? ' ítem' : ' ítems');
    if (accion === 'recibir') {
      var nuevos = lista.filter(function (i) { return i.estado === 'S01'; });
      if (!nuevos.length) { PY.aviso('Ninguno de los seleccionados está en "' + estadoTxt('S01') + '".', 'error'); return; }
      formDrawer({ titulo: 'Recibir ' + nuevos.length + (nuevos.length === 1 ? ' ítem' : ' ítems') + ' y dar fecha', boton: 'Recibir y avisar',
        campos: PY.campo('¿Para cuándo estarán?', '<input class="sx2-input" type="date" name="fecha" min="' + hoyIso() + '" value="' + fechaSugerida(nuevos[0]) + '">',
          'La misma fecha para todos (después puedes cambiar la de cada uno). A cada solicitante le llega un aviso.' + (nuevos.length < lista.length ? ' Los que ya no están nuevos se omiten.' : '')),
        validar: function (x) { return x.fecha ? '' : 'Elige la fecha.'; },
        aplicar: function (x) {
          var porSol = {};
          nuevos.forEach(function (i) { (porSol[i.solicitud_id] = porSol[i.solicitud_id] || []).push({ subsolicitud_id: i.subsolicitud_id, fecha_comprometida: x.fecha }); });
          ejecutarLote(Object.keys(porSol).map(function (k) { return { solicitud_id: k }; }), function (g) { return api('recibirItemsSolicitud', { solicitud_id: g.solicitud_id, items: porSol[g.solicitud_id] }); }, 'Solicitudes recibidas');
        } });
      return;
    }
    if (accion === 'asignar') {
      formDrawer({ titulo: 'Asignar ' + n, boton: 'Asignar',
        campos: PY.campo('Responsable', '<select class="sx2-select" name="responsable">' + opcionesResponsables('') + '</select>') +
          PY.campo('Motivo', '<input class="sx2-input" name="motivo" maxlength="300" value="Asignado desde la bandeja">', 'Queda en el historial de asignación (mínimo 10 caracteres).'),
        validar: function (x) { return !x.responsable ? 'Elige a quién.' : (x.motivo.length < 10 ? 'El motivo debe tener al menos 10 caracteres.' : ''); },
        aplicar: function (x) { ejecutarLote(lista, function (i) { return api('derivarSolicitud', { solicitud_id: i.solicitud_id, subsolicitud_id: i.subsolicitud_id, responsable_nuevo: x.responsable, motivo: x.motivo }); }, 'Asignados'); } });
      return;
    }
    if (accion === 'prioridad') {
      formDrawer({ titulo: 'Cambiar prioridad de ' + n, boton: 'Cambiar',
        campos: PY.campo('Nueva prioridad', '<select class="sx2-select" name="prioridad">' + PRIORIDADES.map(function (p) { return '<option>' + p + '</option>'; }).join('') + '</select>') +
          PY.campo('Justificación', '<textarea class="sx2-input" name="justificacion" maxlength="500" placeholder="Por qué cambia (mínimo 20 caracteres)"></textarea>'),
        validar: function (x) { return x.justificacion.length < 20 ? 'La justificación debe tener al menos 20 caracteres.' : ''; },
        aplicar: function (x) { ejecutarLote(lista.filter(function (i) { return i.prioridad !== x.prioridad; }), function (i) { return api('actualizarPrioridad', { subsolicitud_id: i.subsolicitud_id, prioridad_nueva: x.prioridad, justificacion: x.justificacion }); }, 'Prioridad cambiada'); } });
      return;
    }
    if (accion === 'fecha') {
      var conFecha = lista.filter(function (i) { return i.fecha_comprometida; }).length;
      formDrawer({ titulo: 'Fecha comprometida para ' + n, boton: 'Comprometer',
        subtitulo: conFecha ? conFecha + ' ya tenían fecha: cambiarla exige un motivo.' : 'Queda como compromiso visible para el solicitante.',
        campos: PY.campo('Fecha', '<input class="sx2-input" type="date" name="fecha" min="' + PY.hoyClave() + '">') +
          (conFecha ? PY.campo('Motivo del cambio', '<textarea class="sx2-input" name="motivo" maxlength="500" placeholder="Mínimo 20 caracteres"></textarea>') : ''),
        validar: function (x) { return !x.fecha ? 'Elige la fecha.' : (conFecha && (x.motivo || '').length < 20 ? 'El motivo del cambio debe tener al menos 20 caracteres.' : ''); },
        aplicar: function (x) { ejecutarLote(lista, function (i) { return api('comprometerFecha', { subsolicitud_id: i.subsolicitud_id, fecha_comprometida: x.fecha, motivo: x.motivo || '' }); }, 'Fecha comprometida'); } });
      return;
    }
    if (accion === 'estado') {
      formDrawer({ titulo: 'Cambiar estado de ' + n, boton: 'Cambiar',
        subtitulo: 'Cada ítem se valida por separado: los que no admiten el cambio se informan al final.',
        campos: PY.campo('Nuevo estado', '<select class="sx2-select" name="estado">' + ORDEN_ESTADO.filter(function (e) { return e !== 'S01'; }).map(function (e) {
            return '<option value="' + e + '">' + U.esc(estadoTxt(e)) + '</option>';
          }).join('') + '</select>') +
          PY.campo('Comentario', '<textarea class="sx2-input" name="comentario" maxlength="1000" placeholder="Obligatorio para esperar información, rechazar, cancelar o cerrar"></textarea>', 'El solicitante lo ve en el historial de su solicitud.'),
        validar: function (x) { return ['S06', 'S09', 'S10', 'S11'].indexOf(x.estado) !== -1 && !x.comentario ? 'Este cambio exige un comentario con el motivo.' : ''; },
        aplicar: function (x) { ejecutarLote(lista.filter(function (i) { return i.estado !== x.estado; }), function (i) { return api('actualizarEstado', { subsolicitud_id: i.subsolicitud_id, estado_nuevo: x.estado, comentario: x.comentario }); }, 'Estado cambiado'); } });
    }
  }

  // --- Detalle en panel lateral -----------------------------------------------------------
  var TIPO_ACT = {
    estado: { icono: 'estado', tono: 'primario' }, prioridad: { icono: 'bandera', tono: 'alerta' },
    compromiso: { icono: 'calendario', tono: 'info' }, asignacion: { icono: 'persona', tono: 'hito' },
    comentario: { icono: 'correo', tono: 'info' }, interno: { icono: 'candado', tono: 'neutro' }
  };

  function abrirDetalle(solicitudId, subFoco, accInicial) {
    var d = U.drawer({ titulo: solicitudId, subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Cargando…</span>', cuerpo: U.esqueleto('tabla', 6), pie: ' ' });
    d.el.classList.add('bj2-drawer');
    var pestana = 'seguimiento', abiertoAcc = {}, detalle = null;
    if (subFoco && accInicial) { if (accInicial === '__todos') abiertoAcc.__todos = true; else abiertoAcc[subFoco] = accInicial; }

    function cargarDetalle() {
      return api('getSolicitudDetalle', { solicitud_id: solicitudId }).then(function (r) {
        if (!r || !r.ok) { d.cuerpo(U.vacio({ icono: 'alerta', titulo: 'No se pudo abrir', texto: (r && r.message) || 'Inténtalo de nuevo.' })); return; }
        detalle = r.data;
        var correos = [].concat(detalle.comentarios || [], detalle.historial_estados || [], detalle.historial_asignacion || []).map(function (e) { return e.usuario; })
          .concat((detalle.subsolicitudes || []).map(function (s) { return s.desarrollador_asignado; })).filter(Boolean);
        Promise.all([window.SigsoDirectorio ? SigsoDirectorio.resolver(correos) : Promise.resolve(), U.precargarFotos(correos)]).then(function () { if (detalle === r.data) pintarDetalle(); });
        pintarDetalle();
      });
    }

    function soloLectura() { return !detalle || (detalle.solo_lectura !== undefined ? !!detalle.solo_lectura : (detalle.rol_actual === 'GERENCIA' || detalle.rol_actual === 'JEFATURA')); }

    function pintarDetalle() {
      var s = detalle.solicitud, subs = detalle.subsolicitudes || [];
      // Con varios ítems, el título no es el del primero (parecía que la solicitud era solo eso) y el
      // estado de la solicitud (el del ítem menos avanzado) se reemplaza por en qué va cada parte.
      d.el.querySelector('.sx2-drawer__titulo').textContent = s.solicitud_id + (subs.length > 1 ? ' · ' + subs.length + ' ítems' : (subs[0] ? ' · ' + subs[0].titulo : ''));
      var cab = d.el.querySelector('.sx2-drawer__cab > .sx2-drawer__fila-titulo .sx2-apilado');
      var sub = cab.querySelector('.bj2-det-sub') || cab.appendChild(Object.assign(document.createElement('span'), { className: 'bj2-det-sub sx2-flex' }));
      cab.querySelectorAll('.sx2-tenue').forEach(function (e) { if (!e.closest('.bj2-det-sub')) e.remove(); });
      var mixto = subs.length > 1 && subs.some(function (x) { return x.estado !== subs[0].estado; });
      sub.innerHTML = (mixto ? '<span class="bj2-det-mixto">' + U.esc(resumenItems(subs)) + '</span>' : U.badge(estadoVis(s.estado_derivado), tonoEstado(s.estado_derivado))) +
        U.badge(s.prioridad_derivada || '—', tonoPrioridad(s.prioridad_derivada), true) +
        '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(s.empresa_nombre || s.empresa_id || '') + ' · ' + U.esc(s.solicitante_nombre || s.solicitante_email || '') + '</span>';
      var nConv = conversacion_().length;
      // Etapa 4: el ítem con su paso siguiente y, debajo, la conversación con quien pidió, en la misma vista.
      var tabs = [['seguimiento', 'Seguimiento' + (nConv ? ' · ' + nConv + (nConv === 1 ? ' mensaje' : ' mensajes') : '')], ['ficha', 'Ficha'], ['actividad', 'Actividad'], ['archivos', 'Archivos (' + (detalle.archivos || []).length + ')']];
      var tabsHtml = '<div class="sx2-tabs bj2-tabs" role="tablist">' + tabs.map(function (t) {
        return '<button type="button" class="sx2-tabs__op js-bj2-tab" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === pestana ? 'true' : 'false') + '">' + t[1] + '</button>';
      }).join('') + '</div>';
      var cuerpo = pestana === 'ficha' ? ficha(s) : (pestana === 'actividad' ? actividad() : (pestana === 'archivos' ? archivos() :
        itemsHtml(subs) + '<section class="bj2-det-conv" id="bj2-conv"><h3 class="sx2-seccion-drawer__titulo">' + U.ico('comentario', 15) + ' Conversación con ' + U.esc(s.solicitante_nombre || 'quien pidió') + '</h3>' + conversacionHtml(s) + '</section>'));
      d.cuerpo(tabsHtml + cuerpo);
      var pie = d.el.querySelector('.sx2-drawer__pie');
      pie.innerHTML = U.boton({ texto: 'Orden de trabajo', icono: 'documento', clase: 'js-bj2-ot' }) +
        (window.SigsoProyectosV2 && !s.proyecto_id && !soloLectura() ? U.boton({ texto: 'Convertir en proyecto', icono: 'capas', clase: 'js-bj2-proyecto' }) : '') +
        '<span style="flex:1"></span>' + U.boton({ texto: 'Cerrar', clase: 'js-sx2-drawer-cerrar' });
    }

    // Etapa 3: la conversación con el solicitante (lo que NO es nota interna),
    // en orden, de los dos lados. Escribir aquí siempre le llega.
    function conversacion_() {
      return (detalle.comentarios || []).filter(function (c) { return !(c.es_interno === true || c.es_interno === 'TRUE'); })
        .slice().sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });
    }
    function conversacionHtml(s) {
      var suyos = [String(s.solicitante_email || '').toLowerCase(), String(s.correo_cliente || '').toLowerCase()].filter(Boolean);
      var nItem = {};
      (detalle.subsolicitudes || []).forEach(function (x) { nItem[x.subsolicitud_id] = x.numero_item; });
      var multi = (detalle.subsolicitudes || []).length > 1;
      var ms = conversacion_();
      return '<div class="bj2-conv">' + (ms.length ? '<ul class="bj2-conv__lista">' + ms.map(function (c) {
          var delSolicitante = suyos.indexOf(String(c.usuario || '').toLowerCase()) !== -1;
          var p = PY.persona(c.usuario, delSolicitante ? s.solicitante_nombre : '');
          return '<li class="bj2-msj' + (delSolicitante ? ' bj2-msj--solicitante' : '') + '">' +
            '<span class="bj2-msj__quien">' + U.esc(p.nombre) + (delSolicitante ? ' · solicitante' : '') + (multi && nItem[c.subsolicitud_id] ? ' · ítem ' + nItem[c.subsolicitud_id] : '') +
              ' · <span class="sx2-tenue">' + U.esc(PY.haceTiempo(c.timestamp)) + '</span></span>' +
            '<p class="bj2-msj__texto">' + U.esc(c.texto) + '</p></li>';
        }).join('') + '</ul>'
        : U.vacio({ icono: 'comentario', titulo: 'Sin mensajes', texto: 'Lo que escribas aquí le llega por correo a ' + U.esc(s.solicitante_nombre || 'quien pidió') + ', y su respuesta aparece en esta conversación.' })) +
        (soloLectura() ? '' : '<form class="sx2-py-sala-form js-bj2-comentar bj2-conv__form" data-destino="solicitante" novalidate>' +
          '<textarea class="sx2-input" name="texto" maxlength="4000" placeholder="Escribe a ' + U.esc(s.solicitante_nombre || 'quien pidió') + '…"></textarea>' +
          '<div class="sx2-entre"><small class="bj2-destino__ayuda">Le llega por correo y lo ve en Mis solicitudes. Para algo solo del equipo, usa una nota interna en Actividad.</small>' +
          U.boton({ texto: 'Enviar', icono: 'derecha', sm: true, variante: 'primario', tipo: 'submit' }) + '</div></form>') +
      '</div>';
    }

    function dato(et, v) { return v ? '<dt>' + U.esc(et) + '</dt><dd>' + v + '</dd>' : ''; }
    function ficha(s) {
      return '<section class="sx2-seccion-drawer"><h3 class="sx2-seccion-drawer__titulo">Solicitud</h3><dl class="sx2-dato">' +
          dato('Ingresada', U.esc(PY.fecha(s.fecha_creacion, true))) + dato('Empresa', U.esc(s.empresa_nombre || s.empresa_id)) +
          dato('Plataforma', U.esc(s.plataforma_nombre || s.plataforma)) + dato('Módulo', U.esc(s.modulo_nombre || s.modulo)) +
          dato('Tipo', U.esc(s.tipo_nombre || s.tipo)) + dato('Urgencia reportada', U.esc(s.urgencia_cliente)) +
        '</dl></section>' +
        '<section class="sx2-seccion-drawer"><h3 class="sx2-seccion-drawer__titulo">Quién la pide</h3>' +
          U.persona(PY.persona(s.solicitante_email, s.solicitante_nombre), 'lg') +
          '<dl class="sx2-dato" style="margin-top:10px">' + dato('Cargo', U.esc(s.solicitante_cargo)) + dato('Correo', '<a class="sx2-enlace" href="mailto:' + U.esc(s.solicitante_email) + '">' + U.esc(s.solicitante_email) + '</a>') + dato('Con copia', U.esc(s.cc)) + '</dl>' +
        '</section>' +
        ((s.es_cliente === true || s.es_cliente === 'TRUE') ? '<section class="sx2-seccion-drawer"><h3 class="sx2-seccion-drawer__titulo">Cliente</h3><dl class="sx2-dato">' +
          dato('Cliente', U.esc(s.empresa_cliente)) + dato('Mandante', U.esc(s.cliente_mandante)) + dato('Obra', U.esc(s.cliente_obra)) +
          dato('Contacto', U.esc([s.contacto_cliente, s.correo_cliente, s.telefono_cliente].filter(Boolean).join(' · '))) + dato('RUT', U.esc(s.rut_cliente)) +
        '</dl></section>' : '') +
        (s.observaciones_generales ? '<section class="sx2-seccion-drawer"><h3 class="sx2-seccion-drawer__titulo">Observaciones</h3><p class="sx2-py-descripcion">' + U.esc(s.observaciones_generales) + '</p></section>' : '');
    }

    // 2026-10-07 (Leo: «los drive que comparten no se comparten, hay que pedir acceso… que suban el
    // archivo mejor»): los enlaces del ítem a la vista; los de Drive, marcados, con un botón que deja
    // escrito el pedido del archivo en la conversación (se revisa y se envía).
    function enlacesDe(it) {
      var out = [];
      if (it.url_modulo) out.push({ titulo: 'Dónde ocurre', url: it.url_modulo });
      var extra = [];
      try { extra = typeof it.urls_adicionales === 'string' ? JSON.parse(it.urls_adicionales || '[]') : (it.urls_adicionales || []); } catch (e) { extra = []; }
      (extra || []).forEach(function (u) {
        if (!u || !u.url) return;
        var t = String(u.titulo || '').trim();
        if (/^https?:\/\/\S+$/i.test(t)) { if (t !== u.url) out.push({ titulo: 'Enlace', url: t }); out.push({ titulo: 'Enlace', url: u.url }); return; }
        out.push({ titulo: t || 'Enlace', url: u.url });
      });
      [it.descripcion, it.contexto, it.resultado_esperado, it.observaciones].join(' ').replace(/https?:\/\/[^\s<>"']+/g, function (u) {
        u = u.replace(/[.,;:)]+$/, '');
        if (!out.some(function (x) { return x.url === u; })) out.push({ titulo: 'En el texto', url: u });
        return u;
      });
      return out;
    }
    function esDrive(u) { return /(^|\/\/)(drive|docs|sheets|slides)\.google\.com\//i.test(u); }
    function enlacesHtml(it) {
      var ls = enlacesDe(it);
      if (!ls.length) return '';
      var drive = ls.filter(function (l) { return esDrive(l.url); }).length;
      return '<div class="bj2-enlaces"><span class="bj2-enlaces__tit">' + U.ico('enlace', 13) + ' Enlaces</span><ul>' + ls.map(function (l) {
          return '<li>' + (esDrive(l.url) ? U.badge('Drive', 'alerta', true) : '') + '<a class="sx2-enlace" href="' + U.esc(l.url) + '" target="_blank" rel="noopener">' + U.esc(l.titulo !== 'Enlace' && l.titulo !== l.url ? l.titulo + ': ' : '') + U.esc(l.url.length > 70 ? l.url.slice(0, 67) + '…' : l.url) + '</a></li>';
        }).join('') + '</ul>' +
        (drive && !soloLectura() && abierto(it) ? '<p class="bj2-enlaces__drive">' + U.ico('alerta', 13) + '<span>Un enlace de Drive solo se abre si quien pidió lo compartió contigo. Si te pide acceso, pídele el archivo:</span>' +
          U.boton({ texto: 'Pedir el archivo', icono: 'comentario', sm: true, variante: 'secundario', clase: 'js-bj2-pedir-archivo', datos: { id: it.subsolicitud_id, n: it.numero_item } }) + '</p>' : '') +
      '</div>';
    }

    function itemsHtml(subs) {
      var trans = detalle.transiciones_por_subsolicitud || {};
      var nuevos = subs.filter(function (it) { return it.estado === 'S01'; });
      var todos = !soloLectura() && nuevos.length > 1
        ? '<div class="bj2-todos">' + (abiertoAcc.__todos
            ? '<form class="sx2-form js-bj2-form-todos" novalidate><strong>Recibir ' + nuevos.length + ' ítems y dar fecha</strong>' +
                nuevos.map(function (it) { return PY.campo(it.numero_item + '. ' + it.titulo, '<input class="sx2-input" type="date" name="f_' + U.esc(it.subsolicitud_id) + '" min="' + hoyIso() + '" value="' + fechaSugerida(it) + '">'); }).join('') +
                '<p class="sx2-tenue" style="margin:0;font-size:.8125rem">A ' + U.esc((detalle.solicitud || {}).solicitante_nombre || 'quien pidió') + ' le llega un solo aviso con la fecha de cada ítem.</p>' +
                '<p class="sx2-campo__error js-bj2-item-error" hidden></p>' +
                '<div class="sx2-flex" style="justify-content:flex-end;gap:6px">' + U.boton({ texto: 'Cancelar', sm: true, clase: 'js-bj2-todos' }) + U.boton({ texto: 'Recibir y avisar', icono: 'check', sm: true, variante: 'primario', tipo: 'submit' }) + '</div></form>'
            : '<span>' + U.ico('bandeja', 15) + '<b>' + nuevos.length + ' ítems por recibir</b> en esta solicitud.</span>' + U.boton({ texto: 'Recibir los ' + nuevos.length + ' y dar fecha', icono: 'check', sm: true, variante: 'primario', clase: 'js-bj2-todos' })) +
          '</div>'
        : '';
      return '<div class="sx2-apilado" style="gap:12px">' + todos + subs.map(function (it) {
        var id = it.subsolicitud_id, acc = abiertoAcc[id] || '';
        var persona = it.desarrollador_asignado ? PY.persona(it.desarrollador_asignado) : null;
        var foco = subFoco === id;
        return '<article class="bj2-item' + (foco ? ' bj2-item--foco' : '') + '" data-bj2-det="' + U.esc(id) + '">' +
          '<div class="sx2-entre" style="align-items:flex-start"><strong>' + it.numero_item + '. ' + U.esc(it.titulo) + '</strong>' +
            '<span class="sx2-flex" style="gap:6px;flex:none;align-items:center">' + U.badge(it.prioridad || '—', tonoPrioridad(it.prioridad), true) + badgeEstado(it) + '</span></div>' +
          '<span class="sx2-flex sx2-tenue" style="gap:10px;flex-wrap:wrap;font-size:.8125rem">' +
            (it.tipo_nombre ? '<span>' + U.esc(it.tipo_nombre) + '</span>' : '') + (it.modulo_nombre ? '<span>' + U.esc(it.modulo_nombre) + '</span>' : '') +
            '<span>' + (persona ? U.avatar(persona, 'xs') + ' ' + U.esc(persona.nombre) : 'Sin responsable propio') + '</span>' +
            '<span>' + U.ico('calendario', 12) + ' ' + (it.fecha_comprometida ? 'Comprometida ' + U.esc(PY.fecha(it.fecha_comprometida, true)) : 'Sin fecha') + '</span>' +
            slaBadge(it) +
          '</span>' +
          (it.descripcion ? '<p class="sx2-py-descripcion" style="margin:0">' + U.esc(it.descripcion) + '</p>' : '') +
          enlacesHtml(it) +
          (it.contexto || it.resultado_esperado ? '<details class="bj2-mas"><summary>Contexto y resultado esperado</summary>' +
            (it.contexto ? '<p><b>Contexto:</b> ' + U.esc(it.contexto) + '</p>' : '') + (it.resultado_esperado ? '<p><b>Resultado esperado:</b> ' + U.esc(it.resultado_esperado) + '</p>' : '') + '</details>' : '') +
          caminoHtml(it) +
          (soloLectura() ? '' : pasos(it, acc) + (acc ? formItem(it, acc, trans[id] || []) : '')) +
        '</article>';
      }).join('') + '</div>';
    }

    // Etapa 3: el paso siguiente según el estado visible ("Nueva → En curso ⇄
    // Esperando respuesta → Resuelta → Cerrada"). Lo demás va en "Más".
    function pasos(it, acc) {
      var v = visible(it.estado), id = it.subsolicitud_id, b = [], nota = '';
      var paso = function (texto, icono, estado, primario) { return U.boton({ texto: texto, icono: icono, sm: true, variante: primario ? 'primario' : 'secundario', clase: 'js-bj2-paso', datos: { id: id, estado: estado } }); };
      var form = function (texto, icono, a, primario) { return U.boton({ texto: texto, icono: icono, sm: true, variante: primario ? 'primario' : 'secundario', clase: 'js-bj2-acc' + (acc === a ? ' is-activo' : ''), datos: { id: id, acc: a } }); };
      var sinResponsable = !it.desarrollador_asignado;
      // Si quien pidió escribió último, lo primero es responderle.
      var ms = conversacion_(), ult = ms[ms.length - 1], s0 = detalle.solicitud || {};
      var suyos = [String(s0.solicitante_email || '').toLowerCase(), String(s0.correo_cliente || '').toLowerCase()].filter(Boolean);
      if (ult && suyos.indexOf(String(ult.usuario || '').toLowerCase()) !== -1 && ['NUEVA', 'EN_CURSO', 'ESPERANDO'].indexOf(v) !== -1) {
        b.push(U.boton({ texto: 'Responder', icono: 'comentario', sm: true, variante: 'primario', clase: 'js-bj2-responder' }));
      }
      var sinFecha = !it.fecha_comprometida;
      if (it.estado === 'S01') {
        b.push(form('Recibir y dar fecha', 'check', 'recibir', true), form('Marcar resuelta', 'check', 'resolver'));
        nota = sinResponsable ? 'Nadie lo ha recibido: al recibirlo queda a tu nombre.' : 'Paso 1: recíbelo y di para cuándo estará.';
      } else if (['S02', 'S03', 'S04'].indexOf(it.estado) !== -1) {
        if (sinFecha) { b.push(form('Dar fecha', 'calendario', 'fecha', true), paso('Empezar', 'derecha', 'S05')); nota = 'Falta decir para cuándo estará.'; }
        else { b.push(paso('Empezar', 'derecha', 'S05', true), form('Marcar resuelta', 'check', 'resolver')); }
      } else if (v === 'EN_CURSO') {
        b.push(form('Marcar resuelta', 'check', 'resolver', true), form('Pedir información', 'comentario', 'preguntar'));
        if (sinFecha) { b.push(form('Dar fecha', 'calendario', 'fecha')); nota = 'Está en curso sin fecha comprometida.'; }
      } else if (v === 'ESPERANDO') {
        b.push(paso('Retomar', 'derecha', 'S05', true));
        nota = 'Esperando que el solicitante responda: cuando escriba, vuelve solo a En curso.';
      } else if (v === 'RESUELTA') {
        b.push(form('Reabrir', 'derivar', 'reabrir'));
        nota = 'Esperando que el solicitante confirme' + (it.fecha_terminada ? ' (se cierra solo a los 5 días hábiles)' : '') + '.';
      } else {
        b.push(form('Reabrir', 'derivar', 'reabrir'));
      }
      // Lo que no es el paso siguiente, en el menú "Más".
      var mas = '<details class="bj2-menu"><summary class="sx2-boton sx2-boton--secundario sx2-boton--sm">' + U.ico('menu', 14) + 'Más</summary><div class="bj2-menu__lista" role="menu">' +
        masAcciones(it).map(function (a) {
          return '<button type="button" role="menuitem" class="bj2-menu__op js-bj2-acc' + (acc === a[0] ? ' is-activo' : '') + '" data-id="' + U.esc(id) + '" data-acc="' + a[0] + '">' + U.ico(a[2], 14) + U.esc(a[1]) + '</button>';
        }).join('') + '</div></details>';
      return '<div class="bj2-pasos">' + b.join('') + mas + (nota ? '<span class="sx2-tenue bj2-pasos__nota">' + U.esc(nota) + '</span>' : '') + '</div>';
    }
    function masAcciones(it) {
      var v = visible(it.estado), cerrado = ['CERRADA', 'RECHAZADA', 'CANCELADA'].indexOf(v) !== -1;
      var a = [['fecha', 'Fecha', 'calendario'], ['prioridad', 'Prioridad', 'bandera'], ['derivar', 'Asignar', 'persona'], ['editar', 'Corregir', 'editar']];
      if (!cerrado) a.push(['rechazar', 'Rechazar', 'equis'], ['cancelar', 'Cancelar', 'basura']);
      // El selector completo de los 11 estados: Desarrollo / TI y el administrador.
      if (!it.depto || detalle.rol_actual === 'ADM') a.push(['estado', 'Otro estado', 'estado']);
      return a;
    }

    function formItem(it, acc, trans) {
      var id = it.subsolicitud_id, campos = '', boton = 'Aplicar';
      if (acc === 'recibir') {
        campos = PY.campo('¿Para cuándo estará?', '<input class="sx2-input" type="date" name="fecha" min="' + hoyIso() + '" value="' + fechaSugerida(it) + '">',
          'A ' + ((detalle.solicitud || {}).solicitante_nombre || 'quien pidió') + ' le llega un aviso: que lo recibiste y para cuándo estará. Si nadie lo tenía, queda a tu nombre.');
        boton = 'Recibir y avisar';
      } else if (acc === 'resolver') {
        var falta = [];
        if (it.estado === 'S01') falta.push('recibido');
        if (!it.fecha_comprometida) falta.push('con fecha comprometida hoy');
        campos = (falta.length ? '<p class="bj2-completa">' + U.ico('info', 14) + '<span>Este ítem no estaba ' + falta.join(' ni ') + '. Al resolverlo queda registrado como <b>' + falta.join(' y ') + '</b> (resuelto el mismo día), para que el camino quede completo.</span></p>' : '') +
          PY.campo('¿Qué se hizo? (opcional)', '<textarea class="sx2-input" name="comentario" maxlength="1000" placeholder="Lo ve el solicitante en el correo y en la conversación"></textarea>', 'Le pedimos que confirme; si no responde, se cierra solo a los 5 días hábiles.');
        boton = 'Marcar resuelta';
      } else if (acc === 'preguntar') {
        campos = PY.campo('¿Qué necesitas saber?', '<textarea class="sx2-input" name="comentario" maxlength="1000" placeholder="Le llega escrita por correo"></textarea>', 'El ítem queda en "Esperando respuesta" y vuelve solo a "En curso" cuando conteste.');
        boton = 'Pedir información';
      } else if (acc === 'rechazar' || acc === 'cancelar') {
        campos = PY.campo('Motivo', '<textarea class="sx2-input" name="comentario" maxlength="1000" placeholder="Lo ve el solicitante"></textarea>');
        boton = acc === 'rechazar' ? 'Rechazar' : 'Cancelar el ítem';
      } else if (acc === 'reabrir') {
        campos = PY.campo('Por qué se reabre', '<textarea class="sx2-input" name="comentario" maxlength="1000" placeholder="Queda en el historial del equipo"></textarea>');
        boton = 'Reabrir';
      } else if (acc === 'estado') {
        campos = PY.campo('Nuevo estado', '<select class="sx2-select" name="estado_nuevo">' + trans.map(function (t) {
            return '<option value="' + t.estado + '" data-obl="' + (t.comentario_obligatorio ? '1' : '0') + '">' + U.esc(estadoTxt(t.estado)) + (t.comentario_obligatorio ? ' (pide motivo)' : '') + '</option>';
          }).join('') + '</select>') +
          PY.campo('Comentario', '<textarea class="sx2-input" name="comentario" maxlength="1000" placeholder="El solicitante lo ve en su historial"></textarea>');
        boton = 'Cambiar estado';
      } else if (acc === 'fecha') {
        campos = PY.campo('Fecha comprometida', '<input class="sx2-input" type="date" name="fecha_comprometida" value="' + (it.fecha_comprometida ? String(it.fecha_comprometida).slice(0, 10) : '') + '">') +
          (it.fecha_comprometida ? PY.campo('Motivo del cambio', '<textarea class="sx2-input" name="motivo" maxlength="500" placeholder="Mínimo 20 caracteres"></textarea>') : '');
        boton = it.fecha_comprometida ? 'Recomprometer' : 'Comprometer';
      } else if (acc === 'prioridad') {
        campos = PY.campo('Prioridad', '<select class="sx2-select" name="prioridad_nueva">' + PRIORIDADES.map(function (p) { return '<option' + (p === it.prioridad ? ' selected' : '') + '>' + p + '</option>'; }).join('') + '</select>') +
          PY.campo('Justificación', '<textarea class="sx2-input" name="justificacion" maxlength="500" placeholder="Mínimo 20 caracteres"></textarea>');
      } else if (acc === 'derivar') {
        campos = PY.campo('Responsable', '<select class="sx2-select" name="responsable_nuevo">' + (detalle.responsables || []).map(function (r) {
            return '<option value="' + U.esc(r.email) + '"' + (String(r.email).toLowerCase() === String(it.desarrollador_asignado || '').toLowerCase() ? ' selected' : '') + '>' + U.esc(PY.persona(r.email, r.nombre).nombre) + '</option>';
          }).join('') + '</select>') +
          PY.campo('Motivo', '<input class="sx2-input" name="motivo" maxlength="300" placeholder="Mínimo 10 caracteres">');
        boton = 'Asignar';
      } else if (acc === 'editar') {
        campos = PY.campo('Título', '<input class="sx2-input" name="titulo" maxlength="200" value="' + U.esc(it.titulo || '') + '">') +
          PY.campo('Descripción', '<textarea class="sx2-input" name="descripcion" rows="4">' + U.esc(it.descripcion || '') + '</textarea>') +
          PY.campo('Contexto', '<textarea class="sx2-input" name="contexto">' + U.esc(it.contexto || '') + '</textarea>') +
          PY.campo('Resultado esperado', '<textarea class="sx2-input" name="resultado_esperado">' + U.esc(it.resultado_esperado || '') + '</textarea>');
        boton = 'Guardar corrección';
      }
      return '<form class="sx2-form bj2-item__form js-bj2-form-item" data-id="' + U.esc(id) + '" data-acc="' + acc + '" novalidate>' + campos +
        '<p class="sx2-campo__error js-bj2-item-error" hidden></p>' +
        '<div class="sx2-flex" style="justify-content:flex-end;gap:6px">' + U.boton({ texto: 'Cancelar', sm: true, clase: 'js-bj2-acc-cerrar', datos: { id: id } }) +
          U.boton({ texto: boton, icono: 'check', sm: true, variante: 'primario', tipo: 'submit' }) + '</div></form>';
    }

    function enviarItem(form) {
      var id = form.getAttribute('data-id'), acc = form.getAttribute('data-acc');
      var it = (detalle.subsolicitudes || []).filter(function (x) { return x.subsolicitud_id === id; })[0];
      var x = {};
      new FormData(form).forEach(function (v, k) { x[k] = String(v).trim(); });
      var err = form.querySelector('.js-bj2-item-error');
      function mal(m) { err.textContent = m; err.hidden = false; }
      var accion, datos = { subsolicitud_id: id };
      var DESTINO = { resolver: 'S08', preguntar: 'S06', rechazar: 'S10', cancelar: 'S11', reabrir: 'S05' };
      if (DESTINO[acc]) {
        if (acc !== 'resolver' && !x.comentario && (acc !== 'reabrir' || ['S09', 'S10', 'S11'].indexOf(it.estado) !== -1)) {
          return mal(acc === 'preguntar' ? 'Escribe la pregunta.' : (acc === 'reabrir' ? 'Cuenta por qué se reabre.' : 'Indica el motivo.'));
        }
        accion = 'actualizarEstado'; datos.estado_nuevo = DESTINO[acc]; datos.comentario = x.comentario || '';
        datos.comentario_al_solicitante = acc === 'resolver' || acc === 'rechazar' || acc === 'cancelar';
      } else if (acc === 'estado') {
        var op = form.querySelector('[name=estado_nuevo]').selectedOptions[0];
        if (!op) return mal('No hay cambios de estado disponibles.');
        if (op.getAttribute('data-obl') === '1' && !x.comentario) return mal('Este cambio exige un comentario con el motivo.');
        accion = 'actualizarEstado'; datos.estado_nuevo = x.estado_nuevo; datos.comentario = x.comentario;
      } else if (acc === 'recibir') {
        if (!x.fecha) return mal('Elige para cuándo estará.');
        accion = 'recibirItemsSolicitud'; datos = { solicitud_id: solicitudId, items: [{ subsolicitud_id: id, fecha_comprometida: x.fecha }] };
      } else if (acc === 'fecha') {
        if (!x.fecha_comprometida) return mal('Elige la fecha.');
        if (it.fecha_comprometida && (x.motivo || '').length < 20) return mal('El motivo del cambio debe tener al menos 20 caracteres.');
        accion = 'comprometerFecha'; datos.fecha_comprometida = x.fecha_comprometida; datos.motivo = x.motivo || '';
      } else if (acc === 'prioridad') {
        if (x.prioridad_nueva === it.prioridad) return mal('Elige una prioridad distinta a la actual.');
        if (x.justificacion.length < 20) return mal('La justificación debe tener al menos 20 caracteres.');
        accion = 'actualizarPrioridad'; datos.prioridad_nueva = x.prioridad_nueva; datos.justificacion = x.justificacion;
      } else if (acc === 'derivar') {
        if (x.motivo.length < 10) return mal('El motivo debe tener al menos 10 caracteres.');
        accion = 'derivarSolicitud'; datos.solicitud_id = solicitudId; datos.responsable_nuevo = x.responsable_nuevo; datos.motivo = x.motivo;
      } else if (acc === 'editar') {
        if (!x.titulo) return mal('El título no puede quedar vacío.');
        accion = 'editarContenidoSubsolicitud';
        ['titulo', 'descripcion', 'contexto', 'resultado_esperado'].forEach(function (k) { if (x[k] !== String(it[k] || '')) datos[k] = x[k]; });
        if (Object.keys(datos).length === 1) return mal('No cambiaste nada.');
      }
      var btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      api(accion, datos).then(function (r) {
        btn.disabled = false;
        if (!r || !r.ok) return mal((r && r.message) || 'No se pudo aplicar.');
        abiertoAcc[id] = '';
        var completo = r.data && r.data.completado && r.data.completado.length;
        PY.aviso(acc === 'recibir' ? 'Recibido: le avisamos a quien pidió para cuándo estará.' : (completo ? 'Resuelta. El camino quedó completo: recibido y con fecha hoy.' : 'Listo.'), 'exito');
        cargarDetalle();
        avisarCambio();
      });
    }
    // «Recibir los N y dar fecha»: un envío, un aviso a quien pidió.
    function enviarTodos(form) {
      var err = form.querySelector('.js-bj2-item-error');
      var items = [], falta = false;
      (detalle.subsolicitudes || []).filter(function (it) { return it.estado === 'S01'; }).forEach(function (it) {
        var v = (form.querySelector('[name="f_' + it.subsolicitud_id + '"]') || {}).value || '';
        if (!v) falta = true;
        items.push({ subsolicitud_id: it.subsolicitud_id, fecha_comprometida: v });
      });
      if (falta) { err.textContent = 'Indica la fecha de cada ítem.'; err.hidden = false; return; }
      var btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      api('recibirItemsSolicitud', { solicitud_id: solicitudId, items: items }).then(function (r) {
        btn.disabled = false;
        if (!r || !r.ok) { err.textContent = (r && r.message) || 'No se pudo recibir.'; err.hidden = false; return; }
        abiertoAcc.__todos = false;
        PY.aviso(items.length + ' ítems recibidos: le avisamos a quien pidió con la fecha de cada uno.', 'exito');
        cargarDetalle();
        avisarCambio();
      });
    }

    function actividad() {
      var ev = [];
      (detalle.historial_estados || []).forEach(function (h) { ev.push({ ts: h.timestamp, tipo: 'estado', usuario: h.usuario, txt: (h.estado_anterior ? estadoTxt(h.estado_anterior) + ' → ' : 'Ingresó en ') + estadoTxt(h.estado_nuevo), nota: h.comentario, sub: h.subsolicitud_id }); });
      (detalle.historial_prioridad || []).forEach(function (h) { ev.push({ ts: h.timestamp, tipo: 'prioridad', usuario: h.usuario, txt: 'Prioridad ' + (h.prioridad_anterior || '—') + ' → ' + h.prioridad_nueva, nota: h.justificacion, sub: h.subsolicitud_id }); });
      (detalle.historial_compromiso || []).forEach(function (h) { ev.push({ ts: h.timestamp, tipo: 'compromiso', usuario: h.usuario, txt: (h.fecha_anterior ? 'Fecha ' + PY.fecha(h.fecha_anterior, true) + ' → ' : 'Comprometió para el ') + PY.fecha(h.fecha_nueva, true), nota: h.motivo, sub: h.subsolicitud_id }); });
      (detalle.historial_asignacion || []).forEach(function (h) { ev.push({ ts: h.timestamp, tipo: 'asignacion', usuario: h.usuario, txt: 'Asignó a ' + PY.persona(h.responsable_nuevo).nombre, nota: h.motivo, sub: h.subsolicitud_id }); });
      (detalle.comentarios || []).forEach(function (c) { var interno = c.es_interno === true || c.es_interno === 'TRUE'; ev.push({ ts: c.timestamp, tipo: interno ? 'interno' : 'comentario', usuario: c.usuario, txt: interno ? 'Nota interna' : 'Escribió al solicitante', nota: c.texto, sub: c.subsolicitud_id }); });
      ev.sort(function (a, b) { return new Date(b.ts) - new Date(a.ts); });
      var nItem = {};
      (detalle.subsolicitudes || []).forEach(function (s) { nItem[s.subsolicitud_id] = s.numero_item; });
      var multi = (detalle.subsolicitudes || []).length > 1;
      return (soloLectura() ? '' : '<form class="sx2-py-sala-form js-bj2-comentar" novalidate>' +
          '<div class="bj2-destino" role="radiogroup" aria-label="¿Para quién es?">' +
            '<label><input type="radio" name="destino" value="interno" checked>' + U.ico('candado', 13) + 'Nota interna</label>' +
            '<label><input type="radio" name="destino" value="solicitante">' + U.ico('correo', 13) + 'Mensaje al solicitante</label>' +
          '</div>' +
          '<textarea class="sx2-input" name="texto" maxlength="4000" placeholder="Escribe aquí…"></textarea>' +
          '<div class="sx2-entre"><small class="bj2-destino__ayuda"><span class="bj2-destino__si-interno">Solo la ve el equipo.</span><span class="bj2-destino__si-solicitante">Le llega por correo y la ve en Mis solicitudes.</span></small>' +
          '<button type="submit" class="sx2-boton sx2-boton--primario sx2-boton--sm">' + U.ico('derecha', 14) + '<span class="bj2-destino__si-interno">Guardar nota</span><span class="bj2-destino__si-solicitante">Enviar al solicitante</span></button></div></form>') +
        (ev.length ? '<ul class="sx2-lista" style="gap:0">' + ev.map(function (e) {
          var p = PY.persona(e.usuario), t = TIPO_ACT[e.tipo];
          return '<li class="sx2-py-sala-ev">' + U.avatar(p, 'sm') +
            '<div class="sx2-apilado" style="gap:2px;flex:1;min-width:0"><span class="sx2-flex" style="gap:6px;flex-wrap:wrap"><strong style="font-size:.8125rem">' + U.esc(p.nombre) + '</strong>' +
              '<span class="bj2-act-ico sx2-tono-' + t.tono + '">' + U.ico(t.icono, 11) + '</span><span style="font-size:.8125rem">' + U.esc(e.txt) + '</span>' +
              (multi && e.sub && nItem[e.sub] ? U.badge('Ítem ' + nItem[e.sub], 'neutro', true) : '') +
              '<span class="sx2-tenue" style="font-size:.75rem">' + U.esc(PY.haceTiempo(e.ts)) + '</span></span>' +
              (e.nota ? '<p class="sx2-py-sala-ev__cuerpo">' + U.esc(e.nota) + '</p>' : '') + '</div></li>';
        }).join('') + '</ul>' : U.vacio({ icono: 'comentario', texto: 'Sin actividad todavía.' }));
    }

    function archivos() {
      var as = detalle.archivos || [];
      if (!as.length) return U.vacio({ icono: 'carpeta', titulo: 'Sin archivos', texto: 'El solicitante no adjuntó imágenes ni documentos.' });
      var nItem = {};
      (detalle.subsolicitudes || []).forEach(function (s) { nItem[s.subsolicitud_id] = s.numero_item; });
      return '<ul class="bj2-archivos">' + as.map(function (a) {
        var img = /^image\//.test(a.tipo_mime || '');
        return '<li><a class="bj2-archivo" href="' + U.esc(a.url) + '" target="_blank" rel="noopener noreferrer">' +
          '<span class="bj2-archivo__ico sx2-tono-' + (img ? 'hito' : 'info') + '">' + U.ico(img ? 'imagen' : 'documento', 18) + '</span>' +
          '<span class="sx2-apilado" style="gap:2px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(a.nombre_original || 'Archivo') + '</strong>' +
            '<span class="sx2-tenue" style="font-size:.75rem">' + (nItem[a.subsolicitud_id] ? 'Ítem ' + nItem[a.subsolicitud_id] + ' · ' : '') + U.esc(PY.fecha(a.fecha_subida, true)) +
            (a.tamano_bytes ? ' · ' + Math.max(1, Math.round(Number(a.tamano_bytes) / 1024)) + ' KB' : '') + '</span></span>' + U.ico('derecha', 14) + '</a></li>';
      }).join('') + '</ul>';
    }

    d.el.addEventListener('click', function (ev) {
      var t = ev.target, b;
      if ((b = t.closest('.js-bj2-tab'))) { pestana = b.getAttribute('data-tab'); pintarDetalle(); return; }
      if (t.closest('.js-bj2-responder')) {
        var conv = d.el.querySelector('#bj2-conv');
        if (conv) { conv.scrollIntoView({ block: 'start', behavior: 'smooth' }); var ta = conv.querySelector('textarea'); if (ta) setTimeout(function () { ta.focus(); }, 250); }
        return;
      }
      if ((b = t.closest('.js-bj2-acc'))) { var id = b.getAttribute('data-id'); abiertoAcc[id] = abiertoAcc[id] === b.getAttribute('data-acc') ? '' : b.getAttribute('data-acc'); pintarDetalle(); return; }
      if ((b = t.closest('.js-bj2-acc-cerrar'))) { abiertoAcc[b.getAttribute('data-id')] = ''; pintarDetalle(); return; }
      if ((b = t.closest('.js-bj2-paso'))) {
        b.disabled = true;
        api('actualizarEstado', { subsolicitud_id: b.getAttribute('data-id'), estado_nuevo: b.getAttribute('data-estado'), comentario: '' }).then(function (r) {
          b.disabled = false;
          if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo cambiar.', 'error'); return; }
          PY.aviso('Listo: ' + estadoVis(b.getAttribute('data-estado')) + '.', 'exito');
          cargarDetalle(); avisarCambio();
        });
        return;
      }
      if ((b = t.closest('.js-bj2-tomar-det'))) {
        b.disabled = true;
        api('tomarItemSolicitud', { subsolicitud_id: b.getAttribute('data-id') }).then(function (r) {
          b.disabled = false;
          if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo tomar.', 'error'); cargarDetalle(); return; }
          PY.aviso('Es tuyo: quedó a tu nombre y en curso.', 'exito');
          cargarDetalle(); avisarCambio();
        });
        return;
      }
      if ((b = t.closest('.js-bj2-ot'))) {
        b.disabled = true;
        api('descargarOrdenTrabajo', { solicitud_id: solicitudId }).then(function (r) {
          b.disabled = false;
          if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo generar la orden de trabajo.', 'error'); return; }
          PY.descargarBase64(r.data.pdf_base64, r.data.filename || ('OT-' + solicitudId + '.pdf'), 'application/pdf');
        });
        return;
      }
      if (t.closest('.js-bj2-proyecto')) {
        var s = detalle.solicitud, p = (detalle.subsolicitudes || [])[0];
        d.cerrar(true);
        SigsoProyectosV2.abrirFormularioDesdeSolicitud({
          nombre: (p && p.titulo) || ('Proyecto desde la solicitud ' + s.solicitud_id),
          descripcion: (s.solicitante_nombre ? 'Solicitante original: ' + s.solicitante_nombre + (s.solicitante_email ? ' <' + s.solicitante_email + '>' : '') + '. ' : '') + ((p && p.descripcion) || ''),
          solicitud_id: s.solicitud_id
        });
      }
    });
    d.el.addEventListener('click', function (ev) {
      if (ev.target.closest('.js-bj2-todos')) { abiertoAcc.__todos = !abiertoAcc.__todos; pintarDetalle(); return; }
      var b = ev.target.closest('.js-bj2-pedir-archivo');
      if (!b) return;
      var form = d.el.querySelector('.js-bj2-comentar[data-destino="solicitante"]');
      if (!form) return;
      var multi = (detalle.subsolicitudes || []).length > 1;
      form.texto.value = 'Hola, no tengo acceso al enlace de Drive' + (multi ? ' del ítem ' + b.getAttribute('data-n') : '') + '. ¿Puedes subir el archivo en SIGSO? En Mis solicitudes abre esta solicitud y usa «Adjuntar archivos», junto a la conversación. O compártelo como «Cualquier persona con el enlace». Gracias.';
      form.scrollIntoView({ block: 'center', behavior: 'smooth' });
      form.texto.focus();
    });
    d.el.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var form = ev.target;
      if (form.classList.contains('js-bj2-form-item')) { enviarItem(form); return; }
      if (form.classList.contains('js-bj2-form-todos')) { enviarTodos(form); return; }
      if (form.classList.contains('js-bj2-comentar')) {
        var texto = form.texto.value.trim();
        if (!texto) return;
        var btn = form.querySelector('[type=submit]'); btn.disabled = true;
        var alSolicitante = form.getAttribute('data-destino') === 'solicitante' || !!form.querySelector('[name=destino][value=solicitante]:checked');
        api('agregarComentario', { solicitud_id: solicitudId, texto: texto, es_interno: !alSolicitante }).then(function (r) {
          btn.disabled = false;
          if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo guardar.', 'error'); return; }
          PY.aviso(alSolicitante ? 'Mensaje enviado al solicitante.' : 'Nota interna guardada.', 'exito');
          cargarDetalle();
        });
      }
    });

    cargarDetalle().then(function () {
      var foco = subFoco && d.el.querySelector('.bj2-item--foco');
      if (foco && (detalle.subsolicitudes || []).length > 1) foco.scrollIntoView({ block: 'nearest' });
    });
    return d;
  }

  // --- Eventos ----------------------------------------------------------------------------
  var buscarT_ = null;
  document.addEventListener('click', function (ev) {
    var raiz = document.getElementById('bandeja-v2');
    if (!raiz || !raiz.contains(ev.target)) return;
    var t = ev.target, b;
    if (t.closest('.js-bj2-reintentar')) { cargar(!!datos_); return; }
    if (!datos_) return;
    if ((b = t.closest('.js-bj2-cola'))) { elegirCola(b.getAttribute('data-cola')); return; }
    if (t.closest('.js-bj2-servicios')) { abrirServicios(f.cola); return; }
    if ((b = t.closest('.js-bj2-tomar'))) {
      ev.stopPropagation();
      b.disabled = true;
      api('tomarItemSolicitud', { subsolicitud_id: b.getAttribute('data-id') }).then(function (r) {
        if (!r || !r.ok) { b.disabled = false; PY.aviso((r && r.message) || 'No se pudo tomar.', 'error'); avisarCambio(); return; }
        PY.aviso('Es tuyo: quedó a tu nombre y el solicitante ve que ya lo recibieron.', 'exito');
        avisarCambio();
      });
      return;
    }
    if ((b = t.closest('.js-bj2-vista'))) { f.vista = b.getAttribute('data-id'); pintar(); if (f.vista === 'reportes' && !rep_.datos) cargarReporte(); return; }
    if ((b = t.closest('.js-bj2-densidad'))) { f.densidad = b.getAttribute('data-id'); try { localStorage.setItem('sigso_bj2_densidad', f.densidad); } catch (e) { /* sin storage */ } pintar(true); return; }
    if ((b = t.closest('.js-bj2-rep-excel'))) { excelReporte(b); return; }
    if ((b = t.closest('.js-bj2-rep-abrir'))) { abrirDetalle(b.getAttribute('data-sol'), b.getAttribute('data-sub')); return; }
    if ((b = t.closest('.sx2-kpi[data-filtro], .bj2-banda__op[data-filtro]'))) { f.kpi = b.getAttribute('data-filtro'); f.vista = 'cola'; mostrar_ = POR_PAGINA; pintar(true); return; }
    if (t.closest('.js-bj2-todos')) { f.kpi = f.kpi === 'todos' ? 'abiertos' : 'todos'; pintar(true); return; }
    if (t.closest('.js-bj2-ver-validar')) { f.kpi = 'por_validar'; f.densidad = 'tabla'; try { localStorage.setItem('sigso_bj2_densidad', 'tabla'); } catch (e) { /* sin storage */ } mostrar_ = POR_PAGINA; pintar(true); return; }
    if (t.closest('.js-bj2-agrupar')) { f.agrupar = !f.agrupar; pintar(true); return; }
    if (t.closest('.js-bj2-rezago')) { f.kpi = 'por_revisar'; f.orden = 'antiguedad'; f.texto = ''; mostrar_ = POR_PAGINA; pintar(true); var l = raiz.querySelector('.bj2-lista'); if (l) l.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    if (t.closest('.js-bj2-mas')) { mostrar_ += POR_PAGINA; pintar(true); return; }
    if ((b = t.closest('.js-bj2-excel'))) { exportarExcel(b); return; }
    if ((b = t.closest('.js-bj2-pauta'))) { imprimirPauta(f.verBandeja, b); return; }
    if (t.closest('.js-bj2-limpiar')) { sel_ = {}; actualizarSeleccion(); return; }
    if ((b = t.closest('.js-bj2-lote'))) { lote(b.getAttribute('data-accion')); return; }
    if ((b = t.closest('.js-bj2-abrir-sol'))) { abrirDetalle(b.getAttribute('data-sol')); return; }
    if (t.closest('.bj2-check')) return; // el checkbox se maneja en 'change'
    if ((b = t.closest('.js-bj2-expandir'))) {
      ev.stopPropagation();
      var sid = b.getAttribute('data-sol');
      expandidas_[sid] = !expandidas_[sid];
      pintar(true);
      var bt = document.querySelector('.js-bj2-expandir[data-sol="' + sid + '"]');
      if (bt) bt.focus();
      return;
    }
    if ((b = t.closest('.js-bj2-recibir-sol'))) {
      ev.stopPropagation();
      var n = Number(b.getAttribute('data-n')) || 1;
      var dt = abrirDetalle(b.getAttribute('data-sol'), b.getAttribute('data-id'), n > 1 ? '__todos' : 'recibir');
      return;
    }
    if ((b = t.closest('tr.bj2-tr-sol:not([data-bj2-item])'))) { abrirDetalle(b.getAttribute('data-sol')); return; }
    if ((b = t.closest('.js-bj2-recibir'))) {
      ev.stopPropagation();
      // El camino: recibir va junto con la fecha (decisión del dueño, 2026-10-07).
      var it0 = item(b.getAttribute('data-id'));
      if (it0) abrirDetalle(it0.solicitud_id, it0.subsolicitud_id, 'recibir');
      return;
    }
    if ((b = t.closest('[data-bj2-item]'))) abrirDetalle(b.getAttribute('data-sol'), b.getAttribute('data-bj2-item'));
  });
  document.addEventListener('change', function (ev) {
    var raiz = document.getElementById('bandeja-v2');
    if (!raiz || !raiz.contains(ev.target) || !datos_) return;
    var t = ev.target;
    if (t.classList.contains('js-bj2-sel')) {
      var id = t.closest('[data-bj2-item]').getAttribute('data-bj2-item');
      if (t.checked) sel_[id] = true; else delete sel_[id];
      actualizarSeleccion();
      return;
    }
    if (t.classList.contains('js-bj2-sel-todo')) {
      filtrados().slice(0, mostrar_).forEach(function (i) { if (t.checked) sel_[i.subsolicitud_id] = true; else delete sel_[i.subsolicitud_id]; });
      actualizarSeleccion();
      return;
    }
    if (t.classList.contains('js-bj2-ver')) { f.verBandeja = t.value; sel_ = {}; cargar(false); return; }
    if (t.classList.contains('js-bj2-rep-depto')) { rep_.depto = t.value; rep_.datos = null; pintar(true); cargarReporte(); return; }
    if (t.classList.contains('js-bj2-rep-mes')) { rep_.periodo = t.value; rep_.datos = null; pintar(true); cargarReporte(); return; }
    if (t.classList.contains('js-bj2-empresa')) { f.empresa = t.value; pintar(true); return; }
    if (t.classList.contains('js-bj2-prioridad')) { f.prioridad = t.value; pintar(true); return; }
    if (t.classList.contains('js-bj2-orden')) { f.orden = t.value; pintar(true); }
  });
  document.addEventListener('input', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('js-bj2-buscar')) return;
    var v = ev.target.value;
    clearTimeout(buscarT_);
    buscarT_ = setTimeout(function () {
      f.texto = v.trim(); mostrar_ = POR_PAGINA;
      pintar(true);
      var n = document.querySelector('.js-bj2-buscar');
      if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    }, 220);
  });
  document.addEventListener('keydown', function (ev) {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('#bandeja-v2 [data-bj2-item], #bandeja-v2 tr.js-bj2-abrir-sol, #bandeja-v2 tr.bj2-tr-sol')) { ev.preventDefault(); ev.target.click(); }
    if ((ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') && ev.target.matches && ev.target.matches('#bandeja-v2 tr.bj2-tr-sol:not([data-bj2-item])')) {
      var sid2 = ev.target.getAttribute('data-sol');
      if ((ev.key === 'ArrowRight') !== !!expandidas_[sid2]) { ev.preventDefault(); expandidas_[sid2] = ev.key === 'ArrowRight'; pintar(true); var tr = document.querySelector('#bandeja-v2 tr.bj2-tr-sol[data-sol="' + sid2 + '"]'); if (tr) tr.focus(); }
    }
  });
  // La tabla densa no cabe en pantallas angostas: al cruzar los 900 px se repinta con la vista que corresponde.
  var angosta_ = window.innerWidth < 900;
  window.addEventListener('resize', function () {
    var ahora = window.innerWidth < 900;
    if (ahora === angosta_) return;
    angosta_ = ahora;
    if (datos_ && document.getElementById('bandeja-v2') && f.vista === 'cola' && f.densidad === 'tabla') pintar(true);
  });

  // =========================================================================
  // Módulo 3B — "Solicitudes a tu cargo" en Mi trabajo e Inicio. Mismo
  // formato de fila que las tareas (.sx2-py-mt-fila); el clic abre el MISMO
  // detalle en panel lateral, sin importar desde dónde.
  // =========================================================================
  function ordenarMios(items) {
    var peso = function (i) {
      if (i.respuesta_pendiente) return 0;           // el solicitante contestó: te toca
      if (i.situacion_sla === 'FUERA_DE_PLAZO') return 1;
      if (i.estado === 'S01') return 2;              // aún no lo recibes
      if (i.situacion_sla === 'EN_RIESGO') return 3;
      return 4;
    };
    return items.slice().sort(function (a, b) {
      return (peso(a) - peso(b)) || (PRIORIDADES.indexOf(a.prioridad) - PRIORIDADES.indexOf(b.prioridad)) ||
        (new Date(a.fecha_creacion) - new Date(b.fecha_creacion));
    });
  }
  function resumenMios(items) {
    var r = { total: items.length, fuera: 0, recibir: 0, respondieron: 0, sinFecha: 0, atencion: 0 };
    items.forEach(function (i) {
      var fuera = i.situacion_sla === 'FUERA_DE_PLAZO';
      if (fuera) r.fuera++;
      if (i.estado === 'S01') r.recibir++;
      if (i.respuesta_pendiente) r.respondieron++;
      if (!i.fecha_comprometida) r.sinFecha++;
      if (fuera || i.estado === 'S01' || i.respuesta_pendiente || !i.fecha_comprometida) r.atencion++;
    });
    return r;
  }
  function filaMia(i, n) {
    var hoy = PY.hoyClave();
    var tono = i.situacion_sla === 'FUERA_DE_PLAZO' ? 'critico' : (i.situacion_sla === 'EN_RIESGO' ? 'alerta' : (i.respuesta_pendiente ? 'info' : 'primario'));
    var fc = i.fecha_comprometida ? String(i.fecha_comprometida).slice(0, 10) : '';
    var vencida = fc && fc < hoy;
    return '<li class="sx2-py-mt-fila sx2-tono-' + tono + ' sx2-entra" style="--i:' + Math.min((n || 0) + 2, 12) + '" data-bj2-mio="' + U.esc(i.subsolicitud_id) + '" data-sol="' + U.esc(i.solicitud_id) + '" tabindex="0">' +
      '<span class="sx2-py-punto"></span>' +
      '<span class="sx2-apilado" style="gap:4px;min-width:0;flex:1">' +
        '<strong class="sx2-cortar">' + U.esc(i.titulo || '(sin título)') + '</strong>' +
        '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' +
          '<span class="sx2-py-ref sx2-py-ref--sol" title="' + U.esc((i.empresa_nombre || '') + (i.solicitante_nombre ? ' · ' + i.solicitante_nombre : '')) + '">' + U.ico('bandeja', 12) +
            '<span class="sx2-cortar">' + U.esc(i.solicitud_id) + (i.cantidad_items > 1 ? ' · ítem ' + i.numero_item + '/' + i.cantidad_items : '') + '</span></span>' +
          U.badge(estadoVis(i.estado), tonoEstado(i.estado)) +
          (i.situacion_sla === 'FUERA_DE_PLAZO' ? U.badge('Fuera de plazo', 'critico') : (i.situacion_sla === 'EN_RIESGO' ? U.badge('En riesgo', 'alerta') : '')) +
          (i.prioridad === 'P1' || i.prioridad === 'P2' ? U.badge(i.prioridad, tonoPrioridad(i.prioridad), true) : '') +
          (i.respuesta_pendiente ? U.badge('Te escribió el solicitante', 'info', true) : '') +
        '</span>' +
      '</span>' +
      '<span class="sx2-py-mt-cuando' + (vencida ? ' sx2-delta--mal' : '') + '">' +
        (fc ? (vencida ? 'Comprometida para el ' : 'Comprometida: ') + PY.fecha(fc) : 'Sin fecha comprometida') +
        '<small class="sx2-tenue">' + (i.dias_sin_movimiento ? i.dias_sin_movimiento + ' d sin movimiento' : 'Movido hoy') + '</small></span>' +
      (i.estado === 'S01'
        ? U.boton({ texto: 'Recibir', icono: 'check', sm: true, variante: 'primario', clase: 'js-bj2m-recibir', datos: { id: i.subsolicitud_id } })
        : U.boton({ texto: 'Abrir', icono: 'derecha', sm: true, variante: 'primario', clase: 'js-bj2m-abrir' })) +
    '</li>';
  }
  // Las filas viven fuera de #bandeja-v2 (Mi trabajo, Inicio): un solo manejador.
  document.addEventListener('click', function (ev) {
    var t = ev.target, b;
    if (!t.closest || t.closest('#bandeja-v2')) return;
    if ((b = t.closest('.js-bj2m-recibir'))) {
      ev.stopPropagation();
      b.disabled = true;
      api('actualizarEstado', { subsolicitud_id: b.getAttribute('data-id'), estado_nuevo: 'S02', comentario: '' }).then(function (r) {
        if (!r || !r.ok) { b.disabled = false; PY.aviso((r && r.message) || 'No se pudo recibir.', 'error'); return; }
        PY.aviso('Recibido: el solicitante ve que ya lo tienes.', 'exito');
        avisarCambio();
      });
      return;
    }
    if ((b = t.closest('[data-bj2-mio]'))) { ev.stopPropagation(); abrirDetalle(b.getAttribute('data-sol'), b.getAttribute('data-bj2-mio')); }
  }, true);
  document.addEventListener('keydown', function (ev) {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('[data-bj2-mio]')) { ev.preventDefault(); ev.target.click(); }
  });

  // 2026-09-25: la versión clásica se retiró; la v2 es la única.
  function activo() { return true; }
  function usarVersion() { /* sin versión clásica */ }

  window.SigsoBandejaV2 = {
    cargar: function () { cargar(false); },
    refrescar: function () { cargar(true); },
    abrirSolicitud: function (id, subId) { return abrirDetalle(id, subId); },
    ordenarMios: ordenarMios, resumenMios: resumenMios, filaMia: filaMia,
    activo: activo, usarVersion: usarVersion, desmontar: desmontar
  };
})();
