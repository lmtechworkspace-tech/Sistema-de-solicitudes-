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
  try { f.agrupar = localStorage.getItem('sigso_bj2_agrupar') === '1'; } catch (e) { /* sin storage */ }
  var graficos_ = [];

  function api(accion, datos) {
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, accion, datos || {}).catch(function (e) {
      return { ok: false, message: (e && e.message) || 'No se pudo conectar.' };
    });
  }
  function estadoTxt(c) { return window.formatearEstadoSigso ? formatearEstadoSigso(c) : c; }
  function tonoEstado(c) {
    if (c === 'S01' || c === 'S02') return 'info';
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
  function fechaCorta(v) { return v ? PY.fecha(v, true) : ''; }

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
    Promise.all([api('getColaSolicitudes', { verBandeja: f.verBandeja }), PY.cargarMiPerfil()]).then(function (r) {
      if (t !== turno_) return;
      if (!r[0] || !r[0].ok) {
        c.innerHTML = '<div class="sx2-pagina">' + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar la bandeja', texto: (r[0] && r[0].message) || 'Inténtalo de nuevo.',
          accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-bj2-reintentar' }) }) }) + '</div>';
        return;
      }
      datos_ = r[0].data;
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
    { id: 'por_revisar', etiqueta: 'Por revisar', icono: 'ojo', tono: 'info', unidad: 'nuevos o recibidos, sin triar', f: function (i) { return abierto(i) && (i.estado === 'S01' || i.estado === 'S02'); } },
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
        var t = [i.solicitud_id, i.titulo, i.empresa_nombre, i.solicitante_nombre, i.solicitante_email, i.modulo_nombre, i.tipo_nombre, i.asignado_nombre, i.empresa_cliente].join(' ').toLowerCase();
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
    var esAdm = d.rol_actual === 'ADM';
    var quien = esAdm
      ? '<select class="sx2-select js-bj2-ver" aria-label="Ver bandeja de"><option value="">Toda la bandeja</option>' + (d.responsables || []).map(function (r) {
          return '<option value="' + U.esc(r.email) + '"' + (String(r.email).toLowerCase() === String(f.verBandeja).toLowerCase() ? ' selected' : '') + '>Bandeja de ' + U.esc(PY.persona(r.email, r.nombre).nombre) + '</option>';
        }).join('') + '</select>'
      : '<span class="sx2-tenue" style="font-size:.875rem">Tu bandeja: lo asignado a ti' + (d.rol_actual === 'DEV' ? ' y lo huérfano en curso' : '') + '.</span>';
    return '<header class="sx2-cabecera sx2-entra">' +
      '<div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Solicitudes</span><h1>Bandeja de trabajo</h1>' + (esAdm ? '' : quien) + '</div>' +
      '<div class="sx2-cabecera__acciones">' + (esAdm ? quien : '') +
        U.segmento([{ id: 'cola', texto: 'Cola', icono: 'lista' }, { id: 'analisis', texto: 'Análisis', icono: 'grafico' }], f.vista, 'js-bj2-vista') +
        U.boton({ soloIcono: true, icono: 'exportar', titulo: 'Descargar Excel', clase: 'js-bj2-excel' }) +
        (esAdm && f.verBandeja ? U.boton({ texto: 'Pauta (PDF)', icono: 'documento', clase: 'js-bj2-pauta' }) : '') +
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

  // "Ponerse al día": aparece solo si hay un rezago real de ítems sin triar.
  function bannerRezago() {
    if (datos_.solo_lectura) return '';
    var viejos = datos_.items.filter(function (i) { return abierto(i) && (i.estado === 'S01' || i.estado === 'S02') && (Date.now() - new Date(i.fecha_creacion)) / 86400000 > 14; });
    if (viejos.length < 3) return '';
    var masViejo = Math.max.apply(null, viejos.map(function (i) { return Math.floor((Date.now() - new Date(i.fecha_creacion)) / 86400000); }));
    return '<div class="bj2-rezago sx2-entra" style="--i:1">' +
      '<span class="bj2-rezago__ico">' + U.ico('reloj', 20) + '</span>' +
      '<span class="sx2-apilado" style="gap:2px;flex:1;min-width:0"><strong>' + viejos.length + ' ítems llevan más de 2 semanas sin revisar</strong>' +
        '<span class="sx2-tenue" style="font-size:.8125rem">El más antiguo tiene ' + masViejo + ' días. Revísalos de a varios: recíbelos, asígnalos o ciérralos con su motivo.</span></span>' +
      U.boton({ texto: 'Ponerse al día', icono: 'rayo', variante: 'primario', clase: 'js-bj2-rezago' }) +
    '</div>';
  }

  function barraFiltros() {
    var empresas = {};
    datos_.items.forEach(function (i) { empresas[i.empresa_id] = i.empresa_nombre || i.empresa_id; });
    return '<div class="sx2-card sx2-py-herramientas sx2-entra" style="--i:2"><div class="sx2-barra-filtros">' +
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
      U.chip({ texto: 'Agrupar por solicitud', icono: 'capas', activo: f.agrupar, clase: 'js-bj2-agrupar' }) +
      U.chip({ texto: 'Ver todos (incl. cerrados)', activo: f.kpi === 'todos', clase: 'js-bj2-todos' }) +
    '</div></div>';
  }

  function fila(i, n) {
    var marcado = !!sel_[i.subsolicitud_id];
    var persona = i.asignado ? PY.persona(i.asignado, i.asignado_nombre) : null;
    return '<li class="bj2-fila sx2-tono-' + tonoPrioridad(i.prioridad) + (marcado ? ' bj2-fila--sel' : '') + ' sx2-entra" style="--i:' + Math.min(n, 12) + '" data-bj2-item="' + U.esc(i.subsolicitud_id) + '" data-sol="' + U.esc(i.solicitud_id) + '" tabindex="0">' +
      (datos_.solo_lectura ? '<span></span>' : '<label class="bj2-check" title="Seleccionar"><input type="checkbox" class="js-bj2-sel"' + (marcado ? ' checked' : '') + ' aria-label="Seleccionar ' + U.esc(i.titulo) + '"></label>') +
      '<span class="bj2-prio">' + U.esc(i.prioridad || '—') + '</span>' +
      '<span class="sx2-apilado bj2-fila__cuerpo">' +
        '<strong class="sx2-cortar">' + U.esc(i.titulo || '(sin título)') + '</strong>' +
        '<span class="sx2-flex bj2-fila__meta">' +
          '<span class="bj2-id">' + U.esc(i.solicitud_id) + (i.cantidad_items > 1 ? ' · ítem ' + i.numero_item + '/' + i.cantidad_items : '') + '</span>' +
          '<span class="sx2-cortar">' + U.esc(i.empresa_nombre || '') + (i.tipo_nombre ? ' · ' + U.esc(i.tipo_nombre) : '') + '</span>' +
          (i.es_cliente ? U.badge('Cliente' + (i.empresa_cliente ? ': ' + i.empresa_cliente : ''), 'hito', true) : '') +
          (i.respuesta_pendiente ? U.badge('Respondió', 'info') : '') +
        '</span>' +
      '</span>' +
      '<span class="bj2-fila__estado">' + U.badge(estadoTxt(i.estado), tonoEstado(i.estado)) + slaBadge(i) + '</span>' +
      '<span class="bj2-fila__quien">' + (persona
        ? U.avatar(persona, 'sm') + '<span class="sx2-apilado" style="gap:0;min-width:0"><span class="sx2-cortar">' + U.esc(persona.nombre) + '</span>' + (i.asignado_heredado ? '<small class="sx2-tenue">de la solicitud</small>' : '') + '</span>'
        : '<span class="bj2-sin">' + U.ico('persona', 14) + 'Sin asignar</span>') + '</span>' +
      '<span class="bj2-fila__fecha">' + (i.fecha_comprometida ? '<span>' + fechaCorta(i.fecha_comprometida) + '</span>' : '<span class="sx2-tenue">Sin fecha</span>') +
        '<small class="sx2-tenue">' + (i.dias_sin_movimiento ? i.dias_sin_movimiento + ' d sin mover' : 'hoy') + '</small></span>' +
      '<span class="bj2-fila__acc">' + (!datos_.solo_lectura && i.estado === 'S01' ? U.boton({ texto: 'Recibir', sm: true, variante: 'primario', clase: 'js-bj2-recibir', datos: { id: i.subsolicitud_id } }) : '') +
        U.boton({ soloIcono: true, icono: 'derecha', sm: true, variante: 'fantasma', titulo: 'Abrir', clase: 'js-bj2-abrir' }) + '</span>' +
    '</li>';
  }

  function lista() {
    var items = filtrados();
    if (!items.length) {
      return U.card({ i: 3, cuerpo: U.vacio({ icono: f.kpi === 'abiertos' && !f.texto ? 'check' : 'lupa',
        titulo: f.kpi === 'abiertos' && !f.texto && !f.empresa && !f.prioridad ? 'Bandeja al día' : 'Nada con estos filtros',
        texto: f.kpi === 'abiertos' && !f.texto ? 'No hay ítems en curso.' : 'Prueba quitando algún filtro.' }) });
    }
    var visibles = items.slice(0, mostrar_);
    var cuerpo;
    if (f.agrupar) {
      var grupos = [], porSol = {};
      visibles.forEach(function (i) {
        if (!porSol[i.solicitud_id]) { porSol[i.solicitud_id] = { id: i.solicitud_id, i: i, items: [] }; grupos.push(porSol[i.solicitud_id]); }
        porSol[i.solicitud_id].items.push(i);
      });
      cuerpo = grupos.map(function (g) {
        return '<li class="bj2-grupo"><button type="button" class="bj2-grupo__cab js-bj2-abrir-sol" data-sol="' + U.esc(g.id) + '">' +
          U.ico('capas', 15) + '<strong>' + U.esc(g.id) + '</strong><span class="sx2-tenue sx2-cortar">' + U.esc(g.i.empresa_nombre) + ' · ' + U.esc(g.i.solicitante_nombre || g.i.solicitante_email) + '</span>' +
          '<span class="sx2-tenue" style="margin-left:auto">' + g.items.length + ' de ' + g.i.cantidad_items + (g.i.cantidad_items === 1 ? ' ítem' : ' ítems') + '</span></button>' +
          '<ul class="bj2-lista">' + g.items.map(fila).join('') + '</ul></li>';
      }).join('');
      cuerpo = '<ul class="bj2-lista bj2-lista--grupos">' + cuerpo + '</ul>';
    } else {
      cuerpo = '<ul class="bj2-lista">' + visibles.map(fila).join('') + '</ul>';
    }
    var todosMarcados = !datos_.solo_lectura && visibles.length && visibles.every(function (i) { return sel_[i.subsolicitud_id]; });
    return '<section class="sx2-card sx2-card--sin-relleno sx2-entra" style="--i:3">' +
      '<div class="bj2-lista__cab">' +
        (datos_.solo_lectura ? '' : '<label class="bj2-check" title="Seleccionar todo lo visible"><input type="checkbox" class="js-bj2-sel-todo"' + (todosMarcados ? ' checked' : '') + ' aria-label="Seleccionar todo lo visible"></label>') +
        '<strong>' + items.length + (items.length === 1 ? ' ítem' : ' ítems') + '</strong><span class="sx2-tenue">' + U.esc(kpiDe(f.kpi).etiqueta.toLowerCase()) + '</span>' +
      '</div>' + cuerpo +
      (items.length > visibles.length ? '<div style="text-align:center;padding:12px">' + U.boton({ texto: 'Mostrar más (' + (items.length - visibles.length) + ')', icono: 'abajo', sm: true, variante: 'fantasma', clase: 'js-bj2-mas' }) + '</div>' : '') +
    '</section>';
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
      (f.vista === 'analisis' ? kpis() + analisis() : kpis() + bannerRezago() + barraFiltros() + lista()) +
    '</div>' + (f.vista === 'cola' ? barraLote() : '');
    if (silencioso) {
      c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; });
      window.scrollTo(0, y);
    }
    U.animar(c);
    if (f.vista === 'analisis') dibujarAnalisis(c);
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
      if (it.ref_credencial) ctx.push('Credencial: ' + it.ref_credencial);
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

  function lote(accion) {
    var lista = seleccionados();
    if (!lista.length) return;
    var n = lista.length + (lista.length === 1 ? ' ítem' : ' ítems');
    if (accion === 'recibir') {
      var nuevos = lista.filter(function (i) { return i.estado === 'S01'; });
      if (!nuevos.length) { PY.aviso('Ninguno de los seleccionados está en "' + estadoTxt('S01') + '".', 'error'); return; }
      U.confirmar({ titulo: '¿Recibir ' + nuevos.length + (nuevos.length === 1 ? ' ítem?' : ' ítems?'), texto: 'Pasan a "' + estadoTxt('S02') + '": el solicitante ve que el equipo ya lo tiene.' + (nuevos.length < lista.length ? ' Los que no están en "' + estadoTxt('S01') + '" se omiten.' : ''), boton: 'Recibir' })
        .then(function (si) { if (si) ejecutarLote(nuevos, function (i) { return api('actualizarEstado', { subsolicitud_id: i.subsolicitud_id, estado_nuevo: 'S02', comentario: '' }); }, 'Recibidos'); });
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
    comentario: { icono: 'comentario', tono: 'neutro' }, interno: { icono: 'candado', tono: 'neutro' }
  };

  function abrirDetalle(solicitudId, subFoco) {
    var d = U.drawer({ titulo: solicitudId, subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Cargando…</span>', cuerpo: U.esqueleto('tabla', 6), pie: ' ' });
    d.el.classList.add('bj2-drawer');
    var pestana = 'items', abiertoAcc = {}, detalle = null;

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

    function soloLectura() { return !detalle || detalle.rol_actual === 'GERENCIA' || detalle.rol_actual === 'JEFATURA'; }

    function pintarDetalle() {
      var s = detalle.solicitud, subs = detalle.subsolicitudes || [];
      d.el.querySelector('.sx2-drawer__titulo').textContent = s.solicitud_id + (subs[0] ? ' · ' + subs[0].titulo : '');
      var cab = d.el.querySelector('.sx2-drawer__cab > .sx2-drawer__fila-titulo .sx2-apilado');
      var sub = cab.querySelector('.bj2-det-sub') || cab.appendChild(Object.assign(document.createElement('span'), { className: 'bj2-det-sub sx2-flex' }));
      cab.querySelectorAll('.sx2-tenue').forEach(function (e) { if (!e.closest('.bj2-det-sub')) e.remove(); });
      sub.innerHTML = U.badge(estadoTxt(s.estado_derivado), tonoEstado(s.estado_derivado)) + U.badge(s.prioridad_derivada || '—', tonoPrioridad(s.prioridad_derivada), true) +
        '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(s.empresa_nombre || s.empresa_id || '') + ' · ' + U.esc(s.solicitante_nombre || s.solicitante_email || '') + '</span>';
      var tabs = [['items', 'Ítems (' + subs.length + ')'], ['ficha', 'Ficha'], ['actividad', 'Actividad'], ['archivos', 'Archivos (' + (detalle.archivos || []).length + ')']];
      var tabsHtml = '<div class="sx2-tabs bj2-tabs" role="tablist">' + tabs.map(function (t) {
        return '<button type="button" class="sx2-tabs__op js-bj2-tab" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === pestana ? 'true' : 'false') + '">' + t[1] + '</button>';
      }).join('') + '</div>';
      var cuerpo = pestana === 'ficha' ? ficha(s) : (pestana === 'actividad' ? actividad() : (pestana === 'archivos' ? archivos() : itemsHtml(subs)));
      d.cuerpo(tabsHtml + cuerpo);
      var pie = d.el.querySelector('.sx2-drawer__pie');
      pie.innerHTML = U.boton({ texto: 'Orden de trabajo', icono: 'documento', clase: 'js-bj2-ot' }) +
        (window.SigsoProyectosV2 && !s.proyecto_id && !soloLectura() ? U.boton({ texto: 'Convertir en proyecto', icono: 'capas', clase: 'js-bj2-proyecto' }) : '') +
        '<span style="flex:1"></span>' + U.boton({ texto: 'Cerrar', clase: 'js-sx2-drawer-cerrar' });
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

    function itemsHtml(subs) {
      var trans = detalle.transiciones_por_subsolicitud || {};
      return '<div class="sx2-apilado" style="gap:12px">' + subs.map(function (it) {
        var id = it.subsolicitud_id, acc = abiertoAcc[id] || '';
        var persona = it.desarrollador_asignado ? PY.persona(it.desarrollador_asignado) : null;
        var foco = subFoco === id;
        return '<article class="bj2-item' + (foco ? ' bj2-item--foco' : '') + '" data-bj2-det="' + U.esc(id) + '">' +
          '<div class="sx2-entre" style="align-items:flex-start"><strong>' + it.numero_item + '. ' + U.esc(it.titulo) + '</strong>' +
            '<span class="sx2-flex" style="gap:6px;flex:none">' + U.badge(it.prioridad || '—', tonoPrioridad(it.prioridad), true) + U.badge(estadoTxt(it.estado), tonoEstado(it.estado)) + '</span></div>' +
          '<span class="sx2-flex sx2-tenue" style="gap:10px;flex-wrap:wrap;font-size:.8125rem">' +
            (it.tipo_nombre ? '<span>' + U.esc(it.tipo_nombre) + '</span>' : '') + (it.modulo_nombre ? '<span>' + U.esc(it.modulo_nombre) + '</span>' : '') +
            '<span>' + (persona ? U.avatar(persona, 'xs') + ' ' + U.esc(persona.nombre) : 'Sin responsable propio') + '</span>' +
            '<span>' + U.ico('calendario', 12) + ' ' + (it.fecha_comprometida ? 'Comprometida ' + U.esc(PY.fecha(it.fecha_comprometida, true)) : 'Sin fecha') + '</span>' +
            slaBadge(it) +
          '</span>' +
          (it.descripcion ? '<p class="sx2-py-descripcion" style="margin:0">' + U.esc(it.descripcion) + '</p>' : '') +
          (it.contexto || it.resultado_esperado ? '<details class="bj2-mas"><summary>Contexto y resultado esperado</summary>' +
            (it.contexto ? '<p><b>Contexto:</b> ' + U.esc(it.contexto) + '</p>' : '') + (it.resultado_esperado ? '<p><b>Resultado esperado:</b> ' + U.esc(it.resultado_esperado) + '</p>' : '') + '</details>' : '') +
          (soloLectura() ? '' : '<div class="sx2-flex bj2-item__acc" style="gap:6px;flex-wrap:wrap">' +
            [['estado', 'Estado', 'estado'], ['fecha', 'Fecha', 'calendario'], ['prioridad', 'Prioridad', 'bandera'], ['derivar', 'Asignar', 'persona'], ['editar', 'Corregir', 'editar']].map(function (a) {
              return U.chip({ texto: a[1], icono: a[2], activo: acc === a[0], clase: 'js-bj2-acc', datos: { id: id, acc: a[0] } });
            }).join('') + '</div>' + (acc ? formItem(it, acc, trans[id] || []) : '')) +
        '</article>';
      }).join('') + '</div>';
    }

    function formItem(it, acc, trans) {
      var id = it.subsolicitud_id, campos = '', boton = 'Aplicar';
      if (acc === 'estado') {
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
      if (acc === 'estado') {
        var op = form.querySelector('[name=estado_nuevo]').selectedOptions[0];
        if (!op) return mal('No hay cambios de estado disponibles.');
        if (op.getAttribute('data-obl') === '1' && !x.comentario) return mal('Este cambio exige un comentario con el motivo.');
        accion = 'actualizarEstado'; datos.estado_nuevo = x.estado_nuevo; datos.comentario = x.comentario;
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
        PY.aviso('Listo.', 'exito');
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
      (detalle.comentarios || []).forEach(function (c) { var interno = c.es_interno === true || c.es_interno === 'TRUE'; ev.push({ ts: c.timestamp, tipo: interno ? 'interno' : 'comentario', usuario: c.usuario, txt: interno ? 'Nota interna' : 'Comentó', nota: c.texto, sub: c.subsolicitud_id }); });
      ev.sort(function (a, b) { return new Date(b.ts) - new Date(a.ts); });
      var nItem = {};
      (detalle.subsolicitudes || []).forEach(function (s) { nItem[s.subsolicitud_id] = s.numero_item; });
      var multi = (detalle.subsolicitudes || []).length > 1;
      return (soloLectura() ? '' : '<form class="sx2-py-sala-form js-bj2-comentar" novalidate>' +
          '<textarea class="sx2-input" name="texto" maxlength="4000" placeholder="Escribe un comentario…"></textarea>' +
          '<div class="sx2-entre"><label class="sx2-flex" style="gap:6px;font-size:.8125rem"><input type="checkbox" name="interno" checked> Nota interna (el solicitante no la ve)</label>' +
          U.boton({ texto: 'Comentar', icono: 'derecha', sm: true, variante: 'primario', tipo: 'submit' }) + '</div></form>') +
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
      if ((b = t.closest('.js-bj2-acc'))) { var id = b.getAttribute('data-id'); abiertoAcc[id] = abiertoAcc[id] === b.getAttribute('data-acc') ? '' : b.getAttribute('data-acc'); pintarDetalle(); return; }
      if ((b = t.closest('.js-bj2-acc-cerrar'))) { abiertoAcc[b.getAttribute('data-id')] = ''; pintarDetalle(); return; }
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
    d.el.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var form = ev.target;
      if (form.classList.contains('js-bj2-form-item')) { enviarItem(form); return; }
      if (form.classList.contains('js-bj2-comentar')) {
        var texto = form.texto.value.trim();
        if (!texto) return;
        var btn = form.querySelector('[type=submit]'); btn.disabled = true;
        api('agregarComentario', { solicitud_id: solicitudId, texto: texto, es_interno: form.interno.checked }).then(function (r) {
          btn.disabled = false;
          if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo comentar.', 'error'); return; }
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
    if ((b = t.closest('.js-bj2-vista'))) { f.vista = b.getAttribute('data-id'); pintar(); return; }
    if ((b = t.closest('.sx2-kpi[data-filtro]'))) { f.kpi = b.getAttribute('data-filtro'); f.vista = 'cola'; mostrar_ = POR_PAGINA; pintar(true); return; }
    if (t.closest('.js-bj2-todos')) { f.kpi = f.kpi === 'todos' ? 'abiertos' : 'todos'; pintar(true); return; }
    if (t.closest('.js-bj2-agrupar')) { f.agrupar = !f.agrupar; try { localStorage.setItem('sigso_bj2_agrupar', f.agrupar ? '1' : '0'); } catch (e) { /* sin storage */ } pintar(true); return; }
    if (t.closest('.js-bj2-rezago')) { f.kpi = 'por_revisar'; f.orden = 'antiguedad'; f.texto = ''; mostrar_ = POR_PAGINA; pintar(true); var l = raiz.querySelector('.bj2-lista'); if (l) l.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    if (t.closest('.js-bj2-mas')) { mostrar_ += POR_PAGINA; pintar(true); return; }
    if ((b = t.closest('.js-bj2-excel'))) { exportarExcel(b); return; }
    if ((b = t.closest('.js-bj2-pauta'))) { imprimirPauta(f.verBandeja, b); return; }
    if (t.closest('.js-bj2-limpiar')) { sel_ = {}; actualizarSeleccion(); return; }
    if ((b = t.closest('.js-bj2-lote'))) { lote(b.getAttribute('data-accion')); return; }
    if ((b = t.closest('.js-bj2-abrir-sol'))) { abrirDetalle(b.getAttribute('data-sol')); return; }
    if (t.closest('.bj2-check')) return; // el checkbox se maneja en 'change'
    if ((b = t.closest('.js-bj2-recibir'))) {
      ev.stopPropagation();
      b.disabled = true;
      api('actualizarEstado', { subsolicitud_id: b.getAttribute('data-id'), estado_nuevo: 'S02', comentario: '' }).then(function (r) {
        if (!r || !r.ok) { b.disabled = false; PY.aviso((r && r.message) || 'No se pudo recibir.', 'error'); return; }
        PY.aviso('Recibido: el solicitante ve que el equipo ya lo tiene.', 'exito');
        avisarCambio();
      });
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
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('#bandeja-v2 [data-bj2-item]')) { ev.preventDefault(); ev.target.click(); }
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
          U.badge(estadoTxt(i.estado), tonoEstado(i.estado)) +
          (i.situacion_sla === 'FUERA_DE_PLAZO' ? U.badge('Fuera de plazo', 'critico') : (i.situacion_sla === 'EN_RIESGO' ? U.badge('En riesgo', 'alerta') : '')) +
          (i.prioridad === 'P1' || i.prioridad === 'P2' ? U.badge(i.prioridad, tonoPrioridad(i.prioridad), true) : '') +
          (i.respuesta_pendiente ? U.badge('El solicitante respondió', 'info', true) : '') +
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
