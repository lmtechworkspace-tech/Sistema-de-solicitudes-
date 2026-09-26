/**
 * gerencia-vistas-v2.js — Panel de gerencia 100 % v2 (SIGSO v2, R6 del
 * retiro de la versión clásica; ver documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 * El "Resumen ejecutivo" vive en gerencia-v2.js; aquí están el resto de las
 * vistas, que comparten el contenedor #gerencia-v2:
 *  - Tablero de seguimiento: KPIs con variación, semáforo de cumplimiento,
 *    filtros (empresa, responsable, solicitante, búsqueda), agrupación,
 *    orden por columna, "esperando al solicitante", imprimir y "Enviar a
 *    Gerencia ahora" (solo ADM). Cada ítem se abre en el panel lateral de la
 *    Bandeja v2.
 *  - Línea de tiempo: creación → fecha comprometida, hoy, atraso y fecha
 *    original si hubo re-compromiso.
 *  - Actividades: KPIs, mapa de calor área × semana, críticas, los 3 motores
 *    de reporte (tabla, CSV, PDF) y el acta de reunión.
 *  - Pausas activas: cumplimiento de todas las empresas, clima, motivos,
 *    áreas, PDF y CSV.
 *  - Centro de reportes (motor v2), Tendencia y ciclo, Recurrencia y Carga.
 * Mismos endpoints que antes (getPanelGerencia, enviarReporteGerenciaAhora,
 * getReporteGerenciaPausas, descargarReporteGerenciaPausasPdf,
 * getPanelGerenciaActividades, generarReporteActividades,
 * descargarReporteActividadesPdf, descargarActaReunionPdf). Define
 * window.SigsoGerencia: la plataforma ya no carga gerencia.js (queda para app.html).
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var CATEGORIAS = [
    { codigo: 'ATRASADA_DESARROLLADOR', tono: 'critico', etiqueta: 'Atrasadas' },
    { codigo: 'EN_RIESGO', tono: 'alerta', etiqueta: 'En riesgo' },
    { codigo: 'ESPERANDO_VALIDACION', tono: 'info', etiqueta: 'Esperando validación' },
    { codigo: 'EN_PLAZO', tono: 'ok', etiqueta: 'En plazo' },
    { codigo: 'SIN_COMPROMISO', tono: 'neutro', etiqueta: 'Sin comprometer' },
    { codigo: 'CERRADA_A_TIEMPO', tono: 'ok', etiqueta: 'Cerradas a tiempo' },
    { codigo: 'CERRADA_CON_ATRASO', tono: 'critico', etiqueta: 'Cerradas con atraso' }
  ];
  var TONO_CUMPL = {};
  CATEGORIAS.forEach(function (c) { TONO_CUMPL[c.codigo] = c.tono; });
  var COLUMNAS = [
    { campo: 'solicitud_id', titulo: 'Solicitud' }, { campo: 'titulo', titulo: 'Título' },
    { campo: 'solicitante_nombre', titulo: 'Solicitante' }, { campo: 'desarrollador_nombre', titulo: 'Responsable' },
    { campo: 'estado', titulo: 'Estado' }, { campo: 'prioridad', titulo: 'Prioridad' },
    { campo: 'dias_abierta', titulo: 'Días abierta', num: true }, { campo: 'dias_desarrollador', titulo: 'Días vs. compromiso', num: true, ayuda: 'Días hábiles desde la fecha comprometida (negativo = aún en plazo).' },
    { campo: 'dias_esperando', titulo: 'Esperando al solicitante', num: true },
    { campo: 'fecha_comprometida', titulo: 'Comprometida' }, { campo: 'semaforo', titulo: 'Semáforo' }
  ];
  var AGRUPAR = [
    { id: '', texto: 'Sin agrupar' }, { id: 'estado', texto: 'Estado' }, { id: 'desarrollador_nombre', texto: 'Responsable' },
    { id: 'solicitante_nombre', texto: 'Solicitante' }, { id: 'empresa_id', texto: 'Empresa' }, { id: 'area_nombre', texto: 'Área' },
    { id: 'modulo_nombre', texto: 'Módulo' }, { id: 'prioridad', texto: 'Prioridad' }
  ];
  var TIPOS_REPORTE_ACT = [
    { id: 'estado_actual', texto: 'Estado actual' }, { id: 'cumplimiento_periodo', texto: 'Cumplimiento del período' }, { id: 'carga_capacidad', texto: 'Carga y capacidad' }
  ];
  var VISTAS = {
    tablero: ['Tablero de seguimiento', 'Cada ítem de solicitud con su semáforo de cumplimiento.'],
    gantt: ['Línea de tiempo', 'Desde que se creó cada ítem hasta su fecha comprometida.'],
    actividades: ['Actividades', 'Gestión operacional de las tareas de toda la organización.'],
    pausas: ['Pausas activas', 'Cumplimiento del programa en todas las empresas.'],
    reportes: ['Centro de reportes', 'Analiza el desempeño del área.'],
    tendencia: ['Tendencia y ciclo', '¿Mejoramos o empeoramos? Y dónde se va el tiempo.'],
    recurrencia: ['Recurrencia', 'Qué módulo y tipo se repite: lo que conviene resolver de raíz.'],
    carga: ['Carga', 'Qué empresa, plataforma y área consumen más solicitudes.']
  };
  var DEL_PANEL = ['tablero', 'gantt', 'tendencia', 'recurrencia', 'carga'];
  var ARQUITECTURA = [
    { id: 'resumen', nombre: 'Resumen', icono: 'panel', items: [{ id: 'resumen', nombre: 'Resumen ejecutivo' }] },
    { id: 'seguimiento', nombre: 'Seguimiento', icono: 'lista', items: [
      { id: 'tablero', nombre: 'Tablero de seguimiento' }, { id: 'gantt', nombre: 'Línea de tiempo' }
    ] },
    { id: 'operacion', nombre: 'Operación', icono: 'reloj', items: [
      { id: 'actividades', nombre: 'Actividades' }, { id: 'pausas', nombre: 'Pausas activas' }
    ] },
    { id: 'reportes', nombre: 'Reportes', icono: 'grafico', descripcion: 'Analiza el desempeño del área', items: [
      { id: 'reportes', nombre: 'Centro de reportes' }, { id: 'tendencia', nombre: 'Tendencia y ciclo' },
      { id: 'recurrencia', nombre: 'Recurrencia' }, { id: 'carga', nombre: 'Carga' }
    ] }
  ];
  var CAMPOS_FILTRO = { area: 'area_nombre' };
  var COHORTE = 'Ítems creados en';
  var SERVICIO = 'ger-servicio';
  var REPORTES = [
    { grupo: 'Resumen', icono: 'diana', reportes: [
      { id: SERVICIO, nombre: 'Estado del servicio', tipo: 'ESTADO', estado: 'LISTO', desc: 'La conclusión, lo que requiere decisión, el panorama y el detalle de lo abierto, en una sola lectura.', fuente: 'getPanelGerencia', filtros: ['periodo', 'area'], etiquetaPeriodo: 'Período', campos: CAMPOS_FILTRO }
    ] },
    { grupo: 'Cumplimiento', icono: 'escudo', reportes: [
      { id: 'ger-area', nombre: 'Cumplimiento por área', tipo: 'CUMPLIMIENTO', estado: 'LISTO', desc: 'Qué áreas entregan dentro de la fecha comprometida y cuáles no.', fuente: 'getPanelGerencia', filtros: ['periodo'], etiquetaPeriodo: COHORTE, campos: CAMPOS_FILTRO },
      { id: 'ger-responsable', nombre: 'Cumplimiento por responsable', tipo: 'RANKING', estado: 'LISTO', desc: 'Entregas a tiempo por cada responsable, sobre lo que ya cerró.', fuente: 'getPanelGerencia', filtros: ['periodo', 'area'], etiquetaPeriodo: COHORTE, campos: CAMPOS_FILTRO },
      { id: 'ger-resbalon', nombre: 'Resbalón de compromisos', tipo: 'DETALLE', estado: 'LISTO', desc: 'Ítems que movieron su fecha comprometida, y cuántas veces se reabrieron.', fuente: 'getPanelGerencia', filtros: ['periodo', 'area'], etiquetaPeriodo: COHORTE, campos: CAMPOS_FILTRO }
    ] },
    { grupo: 'Evolución', icono: 'grafico', reportes: [
      { id: 'ger-throughput', nombre: 'Entrada vs salida por mes', tipo: 'TENDENCIA', estado: 'LISTO', desc: 'Cuánto entra y cuánto se cierra cada mes: dice si la cola crece o baja.', fuente: 'getPanelGerencia', filtros: [] },
      { id: 'ger-tendencia', nombre: 'Tendencia y ciclo por etapa', tipo: 'TENDENCIA', estado: 'LISTO', desc: 'Los gráficos de seis meses y dónde se va el tiempo.', fuente: 'getPanelGerencia', seccion: 'tendencia' },
      { id: 'ger-recurrencia', nombre: 'Recurrencia', tipo: 'RANKING', estado: 'LISTO', desc: 'Qué módulo y tipo se repite: lo que conviene resolver de raíz.', fuente: 'getPanelGerencia', seccion: 'recurrencia' },
      { id: 'ger-carga', nombre: 'Carga', tipo: 'RANKING', estado: 'LISTO', desc: 'Qué empresa, plataforma y área consumen más solicitudes.', fuente: 'getPanelGerencia', seccion: 'carga' }
    ] },
    { grupo: 'Comparación', icono: 'lista', reportes: [
      { id: 'ger-comparativo', nombre: 'Período actual vs anterior', tipo: 'COMPARACION', estado: 'LISTO', desc: 'Cómo cambiaron los indicadores respecto de la ventana anterior.', fuente: 'getPanelGerencia', filtros: [] }
    ] }
  ];
  var KPI_META = {
    pct_cumplimiento_desarrollador: { texto: 'Cumplimiento del desarrollador (%)', menosEsMejor: false },
    atrasadas_activas: { texto: 'Atrasadas activas', menosEsMejor: true },
    esperando_validacion: { texto: 'Esperando validación', menosEsMejor: true },
    atraso_promedio_dias: { texto: 'Atraso promedio (días)', menosEsMejor: true },
    sin_comprometer: { texto: 'Sin comprometer', menosEsMejor: true }
  };

  var vista_ = 'resumen', turno_ = 0;
  // Panel (tablero, línea de tiempo, tendencia, recurrencia, carga).
  var panel_ = null, filtros_ = { empresa_id: '', desarrollador: '', solicitante: '' };
  var categoria_ = '', recurrencia_ = '', q_ = '', agrupar_ = '', orden_ = { campo: 'fecha_creacion', dir: 'desc' };
  var empresas_ = {}, responsables_ = {}, areas_ = [];
  // Otras vistas.
  var act_ = null, filtrosAct_ = { tipo: 'estado_actual', area_id: '', prioridad: '', desde: '', hasta: '' }, repAct_ = null;
  var pausas_ = null;
  var reporteAbierto_ = null, filtrosRep_ = {}, panelRep_ = null;

  function api(accion, datos) {
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, accion, datos || {}).catch(function (e) {
      return { ok: false, message: (e && e.message) || 'No se pudo conectar.' };
    });
  }
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
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
  function nulo(v) { return v === null || v === undefined || v === ''; }
  function fechaHora(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Santiago' }).format(d).replace(/-/g, ' ');
  }
  function aIsoInicio(fecha) { return fecha ? new Date(fecha + 'T00:00:00').toISOString() : ''; }
  function aIsoFin(fecha) { return fecha ? new Date(fecha + 'T23:59:59').toISOString() : ''; }
  function resolverPersonas(correos, t) {
    correos = correos.filter(Boolean);
    Promise.all([window.SigsoDirectorio ? SigsoDirectorio.resolver(correos) : Promise.resolve(), U.precargarFotos(correos)])
      .then(function () { if (t === turno_) pintar(true); });
  }

  // --- Marco -----------------------------------------------------------------------------
  function registrarArbol() {
    if (!window.SigsoNav) return;
    SigsoNav.registrar('gerencia', { nombre: 'Panel de gerencia', submodulos: ARQUITECTURA });
    if (window.SigsoShell && SigsoShell.refrescarArbol) SigsoShell.refrescarArbol();
  }
  function contenedor() {
    var s = document.getElementById('modulo-bandeja');
    if (!s) return null;
    var c = document.getElementById('gerencia-v2');
    if (!c) {
      c = document.createElement('div');
      c.id = 'gerencia-v2';
      c.className = 'sx2';
      s.appendChild(c);
    }
    s.classList.add('gerencia-v2-activa');
    return c;
  }
  function cabecera(acciones) {
    var v = VISTAS[vista_];
    return '<header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Panel de gerencia</span><h1>' + U.esc(v[0]) + '</h1>' +
      '<span class="sx2-tenue" style="font-size:.875rem">' + U.esc(v[1]) + '</span></div>' +
      '<div class="sx2-cabecera__acciones">' + (acciones || '') + U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-gv2-recargar' }) + '</div></header>';
  }
  function pagina(c, cuerpo, silencioso, acciones) {
    var y = window.scrollY;
    var foco = document.activeElement && document.activeElement.classList.contains('js-gv2-q');
    c.innerHTML = '<div class="sx2-pagina">' + cabecera(acciones) + cuerpo + '</div>';
    if (silencioso) {
      c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; });
      window.scrollTo(0, y);
    }
    if (foco) { var q = c.querySelector('.js-gv2-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
    U.animar(c);
  }
  function errorEn(c, r) {
    pagina(c, U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || 'Inténtalo de nuevo.',
      accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-gv2-recargar' }) }) }));
  }
  function barras(filas, tono) {
    if (!filas || !filas.length) return U.vacio({ icono: 'grafico', titulo: 'Sin datos', texto: '' });
    var max = filas.reduce(function (m, f) { return Math.max(m, Number(f.valor) || 0); }, 0) || 1;
    return '<ul class="cv2-barras">' + filas.map(function (f) {
      return '<li><span class="cv2-barras__et" title="' + U.esc(f.etiqueta) + '">' + U.esc(f.etiqueta) + '</span>' + U.barra((Number(f.valor) || 0) * 100 / max, f.tono || tono) +
        '<strong class="cv2-barras__v">' + U.esc(f.texto !== undefined ? f.texto : String(f.valor)) + '</strong></li>';
    }).join('') + '</ul>';
  }

  // --- Datos del panel ---------------------------------------------------------------------
  function recordar(items) {
    (items || []).forEach(function (i) {
      if (i.empresa_id) empresas_[i.empresa_id] = true;
      if (i.desarrollador_asignado) responsables_[i.desarrollador_asignado] = i.desarrollador_nombre || responsables_[i.desarrollador_asignado] || i.desarrollador_asignado;
      var a = String(i.area_nombre || '').trim();
      if (a && !areas_.some(function (x) { return x.area_nombre === a; })) areas_.push({ area_nombre: a });
    });
  }
  function cargarPanel(silencioso) {
    var c = contenedor();
    if (!c) return;
    var t = ++turno_, v = vista_;
    if (!silencioso || !panel_) pagina(c, U.esqueleto('kpis', 5) + U.esqueleto('tabla', 8));
    api('getPanelGerencia', filtros_).then(function (r) {
      if (t !== turno_ || v !== vista_) return;
      if (!r || !r.ok) { errorEn(c, r); return; }
      panel_ = r.data;
      recordar(panel_.items);
      pintar(!!silencioso);
      resolverPersonas((panel_.items || []).map(function (i) { return i.desarrollador_asignado; }), t);
    });
  }
  function pintar(silencioso) {
    var c = contenedor();
    if (!c || vista_ === 'resumen') return;
    if (vista_ === 'actividades') { if (act_) pagina(c, vistaActividades(), silencioso, accionesActividades()); return; }
    if (vista_ === 'pausas') { if (pausas_) pagina(c, vistaPausas(), silencioso, accionesPausas()); return; }
    if (vista_ === 'reportes') { pintarReportes(silencioso); return; }
    if (!panel_) return;
    if (vista_ === 'tablero') pagina(c, vistaTablero(), silencioso, accionesTablero());
    else if (vista_ === 'gantt') pagina(c, vistaGantt(), silencioso);
    else if (vista_ === 'tendencia') pagina(c, vistaTendencia(), silencioso);
    else if (vista_ === 'recurrencia') pagina(c, vistaRecurrencia(), silencioso);
    else pagina(c, vistaCarga(), silencioso);
  }

  // Filtros del servidor (empresa / responsable / solicitante): valen para
  // todas las vistas que salen del panel.
  function barraFiltros() {
    var emp = Object.keys(empresas_).sort();
    if (filtros_.empresa_id && emp.indexOf(filtros_.empresa_id) === -1) emp.push(filtros_.empresa_id);
    var resp = Object.keys(responsables_).map(function (e) { return { email: e, nombre: PY.persona(e, responsables_[e]).nombre }; })
      .sort(function (a, b) { return a.nombre.localeCompare(b.nombre); });
    var activos = (filtros_.empresa_id ? 1 : 0) + (filtros_.desarrollador ? 1 : 0) + (filtros_.solicitante ? 1 : 0);
    return '<div class="gv2-filtros sx2-entra">' +
      '<label class="gv2-filtro"><span>Empresa</span><select class="sx2-select js-gv2-fs" data-f="empresa_id"><option value="">Todas</option>' +
        emp.map(function (e) { return '<option value="' + U.esc(e) + '"' + (e === filtros_.empresa_id ? ' selected' : '') + '>' + U.esc(e) + '</option>'; }).join('') + '</select></label>' +
      '<label class="gv2-filtro"><span>Responsable</span><select class="sx2-select js-gv2-fs" data-f="desarrollador"><option value="">Todos</option>' +
        resp.map(function (p) { return '<option value="' + U.esc(p.email) + '"' + (p.email === filtros_.desarrollador ? ' selected' : '') + '>' + U.esc(p.nombre) + '</option>'; }).join('') + '</select></label>' +
      '<label class="gv2-filtro"><span>Solicitante</span><input type="search" class="sx2-input js-gv2-fs" data-f="solicitante" placeholder="Nombre o correo" value="' + U.esc(filtros_.solicitante) + '"></label>' +
      (activos ? U.boton({ texto: 'Quitar filtros', icono: 'equis', variante: 'fantasma', sm: true, clase: 'js-gv2-limpiar' }) : '') +
    '</div>';
  }
  function filtrosTexto() {
    var f = [];
    if (filtros_.empresa_id) f.push({ etiqueta: 'Empresa', valor: filtros_.empresa_id });
    if (filtros_.desarrollador) f.push({ etiqueta: 'Responsable', valor: PY.persona(filtros_.desarrollador, responsables_[filtros_.desarrollador]).nombre });
    if (filtros_.solicitante) f.push({ etiqueta: 'Solicitante', valor: filtros_.solicitante });
    return f;
  }

  // --- Tablero de seguimiento ----------------------------------------------------------------
  function tendenciaKpi(delta, subeEsBueno) {
    if (nulo(delta)) return null;
    if (delta === 0) return { texto: '= vs. anterior', tono: 'neutro' };
    var bueno = subeEsBueno ? delta > 0 : delta < 0;
    return { texto: (delta > 0 ? '+' : '−') + Math.abs(delta) + ' vs. anterior', tono: bueno ? 'ok' : 'critico', icono: delta > 0 ? 'arriba' : 'abajo' };
  }
  function kpisPanel() {
    var k = panel_.kpis || {}, cmp = k.comparativo || {};
    var pct = k.pct_cumplimiento_desarrollador;
    return '<div class="sx2-fila-kpis">' +
      U.kpi({ i: 0, etiqueta: 'Entregado a tiempo', valor: nulo(pct) ? '—' : pct, sufijo: nulo(pct) ? '' : '%', icono: 'diana',
        tono: nulo(pct) ? 'neutro' : (pct >= 90 ? 'ok' : (pct >= 70 ? 'alerta' : 'critico')), progreso: nulo(pct) ? null : pct,
        tendencia: tendenciaKpi(cmp.pct_cumplimiento_desarrollador, true), titulo: 'Entregadas a tiempo ÷ entregadas (fecha comprometida vs. cuándo se marcó Terminada).' }) +
      U.kpi({ i: 1, etiqueta: 'Atrasadas activas', valor: k.atrasadas_activas || 0, icono: 'alerta', tono: k.atrasadas_activas ? 'critico' : 'ok',
        filtro: 'ATRASADA_DESARROLLADOR', activo: categoria_ === 'ATRASADA_DESARROLLADOR', tendencia: tendenciaKpi(cmp.atrasadas_activas, false), titulo: 'Pasaron su fecha comprometida y aún no se entregan.' }) +
      U.kpi({ i: 2, etiqueta: 'Solicitantes en mora', valor: k.esperando_validacion || 0, icono: 'reloj', tono: k.esperando_validacion ? 'alerta' : 'ok',
        filtro: 'ESPERANDO_VALIDACION', activo: categoria_ === 'ESPERANDO_VALIDACION', tendencia: tendenciaKpi(cmp.esperando_validacion, false),
        titulo: 'Ítems entregados que el solicitante todavía no valida. Promedio: ' + (k.esperando_validacion_promedio_dias || 0) + ' día(s) hábil(es) esperando.' }) +
      U.kpi({ i: 3, etiqueta: 'Atraso promedio', valor: k.atraso_promedio_dias || 0, unidad: 'días', icono: 'calendario', tono: k.atraso_promedio_dias ? 'alerta' : 'neutro',
        tendencia: tendenciaKpi(cmp.atraso_promedio_dias, false), titulo: 'Promedio de días hábiles de atraso entre atrasadas activas y cerradas con atraso.' }) +
      U.kpi({ i: 4, etiqueta: 'Sin comprometer', valor: k.sin_comprometer || 0, icono: 'bandera', tono: k.sin_comprometer ? 'info' : 'neutro',
        filtro: 'SIN_COMPROMISO', activo: categoria_ === 'SIN_COMPROMISO', tendencia: tendenciaKpi(cmp.sin_comprometer, false), titulo: 'Cola que el desarrollador todavía no revisó ni comprometió.' }) +
    '</div>';
  }
  function itemsBase() {
    var palabras = norm(q_).split(/\s+/).filter(Boolean);
    return (panel_.items || []).filter(function (i) {
      if (!palabras.length) return true;
      var h = norm([i.solicitud_id + '-' + i.numero_item, i.titulo, i.tipo_nombre, i.modulo_nombre, i.solicitante_nombre, i.desarrollador_nombre, i.area_nombre, i.empresa_id].join(' '));
      return palabras.every(function (w) { return h.indexOf(w) !== -1; });
    });
  }
  function claveRecurrencia(i) { return (i.modulo_nombre || '(sin módulo)') + '␟' + (i.tipo_nombre || '(sin tipo)'); }
  function itemsFiltrados(base) {
    return base.filter(function (i) {
      if (categoria_ && (!i.cumplimiento || i.cumplimiento.codigo !== categoria_)) return false;
      if (recurrencia_ && claveRecurrencia(i) !== recurrencia_) return false;
      return true;
    });
  }
  function semaforo(base) {
    return '<div class="dc2-chips gv2-semaforo sx2-entra">' +
      U.chip({ texto: 'Todos', n: base.length, activo: !categoria_, clase: 'js-gv2-cat', datos: { c: '' } }) +
      CATEGORIAS.map(function (cat) {
        var n = base.filter(function (i) { return i.cumplimiento && i.cumplimiento.codigo === cat.codigo; }).length;
        return U.chip({ texto: cat.etiqueta, n: n, tono: cat.tono, activo: categoria_ === cat.codigo, clase: 'js-gv2-cat', datos: { c: cat.codigo } });
      }).join('') + '</div>';
  }
  function buscador() {
    return '<label class="dc2-buscar">' + U.ico('lupa', 16) + '<input type="search" class="js-gv2-q" placeholder="Buscar por número, título, tipo, módulo o persona…" value="' + U.esc(q_) + '" aria-label="Buscar ítem"></label>';
  }
  function avisoRecurrencia() {
    if (!recurrencia_) return '';
    var p = recurrencia_.split('␟');
    return '<div class="gv2-aviso sx2-entra">' + U.ico('filtro', 14) + '<span>Solo <b>' + U.esc(p[0]) + ' · ' + U.esc(p[1]) + '</b> (desde Recurrencia).</span>' +
      U.boton({ texto: 'Quitar', variante: 'fantasma', sm: true, clase: 'js-gv2-sin-rec' }) + '</div>';
  }
  function valorOrden(i, campo) {
    if (campo === 'dias_esperando') return i.cumplimiento ? i.cumplimiento.dias_esperando : null;
    if (campo === 'semaforo') return i.cumplimiento ? i.cumplimiento.etiqueta : '';
    if (campo === 'estado') return estadoTxt(i.estado);
    if (campo === 'desarrollador_nombre') return i.desarrollador_asignado ? PY.persona(i.desarrollador_asignado, i.desarrollador_nombre).nombre : '';
    if (campo === 'fecha_comprometida' || campo === 'fecha_creacion') return i[campo] ? new Date(i[campo]).getTime() : null;
    return i[campo];
  }
  function ordenar(items) {
    var s = orden_.dir === 'asc' ? 1 : -1, campo = orden_.campo;
    return items.slice().sort(function (a, b) {
      var va = valorOrden(a, campo), vb = valorOrden(b, campo);
      if (nulo(va)) return nulo(vb) ? 0 : 1;
      if (nulo(vb)) return -1;
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb, 'es') * s;
      return (va < vb ? -1 : (va > vb ? 1 : 0)) * s;
    });
  }
  function filaItem(i) {
    var cu = i.cumplimiento || {};
    var resp = i.desarrollador_asignado ? PY.persona(i.desarrollador_asignado, i.desarrollador_nombre) : null;
    var esp = cu.dias_esperando;
    var sol = i.semaforo_solicitante && i.semaforo_solicitante.codigo;
    return '<tr class="sx2-fila--clic js-gv2-sol' + (cu.codigo === 'ATRASADA_DESARROLLADOR' ? ' gv2-fila--critico' : (cu.codigo === 'EN_RIESGO' ? ' gv2-fila--alerta' : '')) + '" data-sol="' + U.esc(i.solicitud_id) + '" data-sub="' + U.esc(i.subsolicitud_id || '') + '" tabindex="0">' +
      '<td><span class="jv2-cod">' + U.esc(i.solicitud_id + '-' + i.numero_item) + '</span></td>' +
      '<td class="jv2-titulo"><span class="sx2-cortar" title="' + U.esc(i.titulo) + '">' + U.esc(i.titulo) + '</span><span class="sx2-tenue">' + U.esc([i.tipo_nombre, i.modulo_nombre, i.empresa_id].filter(Boolean).join(' · ')) + '</span></td>' +
      '<td>' + U.esc(i.solicitante_nombre || '') + '</td>' +
      '<td>' + (resp ? '<span class="sx2-flex" style="gap:6px;align-items:center">' + U.avatar(resp, 'xs') + U.esc(resp.nombre) + '</span>' : '<span class="sx2-tenue">Sin asignar</span>') + '</td>' +
      '<td>' + U.badge(estadoTxt(i.estado), tonoEstado(i.estado)) + '</td>' +
      '<td>' + (i.prioridad ? U.badge(i.prioridad, tonoPrioridad(i.prioridad), true) : '') + '</td>' +
      '<td class="sx2-num">' + (nulo(i.dias_abierta) ? '—' : i.dias_abierta) + '</td>' +
      '<td class="sx2-num">' + (nulo(i.dias_desarrollador) ? '—' : i.dias_desarrollador) + '</td>' +
      '<td class="sx2-num">' + (nulo(esp) ? '—' : U.badge(esp + ' d', sol === 'CERCA_CIERRE_AUTOMATICO' ? 'critico' : (sol === 'ESPERANDO' ? 'alerta' : 'neutro'), true)) + '</td>' +
      '<td>' + (i.fecha_comprometida ? U.esc(fechaHora(i.fecha_comprometida)) + (i.re_compromisos ? ' <span class="gv2-recomp" title="Re-comprometida ' + i.re_compromisos + ' vez/veces">↻' + i.re_compromisos + '</span>' : '') : '<span class="sx2-tenue">—</span>') + '</td>' +
      '<td>' + U.badge(cu.etiqueta || '—', TONO_CUMPL[cu.codigo] || 'neutro') + '</td></tr>';
  }
  function tablaItems(items) {
    if (!items.length) return U.vacio({ icono: 'lupa', titulo: 'Nada con estos filtros', texto: 'Cambia el semáforo, la búsqueda o los filtros.' });
    var cab = '<tr>' + COLUMNAS.map(function (col) {
      var activo = orden_.campo === col.campo;
      return '<th class="gv2-th' + (col.num ? ' sx2-num' : '') + '"' + (col.ayuda ? ' title="' + U.esc(col.ayuda) + '"' : '') + '><button type="button" class="gv2-orden js-gv2-orden" data-campo="' + col.campo + '"' +
        (activo ? ' aria-sort="' + (orden_.dir === 'asc' ? 'ascending' : 'descending') + '"' : '') + '>' + U.esc(col.titulo) +
        (activo ? U.ico(orden_.dir === 'asc' ? 'arriba' : 'abajo', 12) : '') + '</button></th>';
    }).join('') + '</tr>';
    var ordenados = ordenar(items), cuerpo;
    if (!agrupar_) cuerpo = ordenados.map(filaItem).join('');
    else {
      var grupos = {}, claves = [];
      ordenados.forEach(function (i) {
        var k = agrupar_ === 'desarrollador_nombre' ? (i.desarrollador_asignado ? PY.persona(i.desarrollador_asignado, i.desarrollador_nombre).nombre : '(sin asignar)')
          : (agrupar_ === 'estado' ? estadoTxt(i.estado) : (i[agrupar_] || '(sin dato)'));
        if (!grupos[k]) { grupos[k] = []; claves.push(k); }
        grupos[k].push(i);
      });
      claves.sort(function (a, b) { return grupos[b].length - grupos[a].length || a.localeCompare(b, 'es'); });
      cuerpo = claves.map(function (k) {
        return '<tr class="gv2-grupo"><td colspan="' + COLUMNAS.length + '">' + U.esc(k) + ' <span class="sx2-chip__n">' + grupos[k].length + '</span></td></tr>' + grupos[k].map(filaItem).join('');
      }).join('');
    }
    return '<div class="sx2-tabla-wrap gv2-tabla-wrap"><table class="sx2-tabla gv2-tabla"><thead>' + cab + '</thead><tbody>' + cuerpo + '</tbody></table></div>';
  }
  function esperandoSolicitante(items) {
    var l = items.filter(function (i) { return i.cumplimiento && i.cumplimiento.codigo === 'ESPERANDO_VALIDACION'; })
      .sort(function (a, b) { return (b.cumplimiento.dias_esperando || 0) - (a.cumplimiento.dias_esperando || 0); });
    if (!l.length) return '';
    return U.card({ titulo: 'Esperando que el solicitante valide', icono: 'reloj', sub: l.length + (l.length === 1 ? ' ítem' : ' ítems'), i: 8, cuerpo:
      '<ul class="ge2-lista">' + l.slice(0, 12).map(function (i) {
        var d = i.cumplimiento.dias_esperando || 0;
        return '<li><button type="button" class="ge2-fila js-gv2-sol" data-sol="' + U.esc(i.solicitud_id) + '" data-sub="' + U.esc(i.subsolicitud_id || '') + '">' +
          '<span class="sx2-apilado" style="gap:2px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(i.solicitud_id + '-' + i.numero_item + ' · ' + i.titulo) + '</strong>' +
          '<span class="sx2-tenue sx2-cortar" style="font-size:.75rem">Debe probar: ' + U.esc(i.solicitante_nombre || '') + (i.solicitante_email ? ' (' + U.esc(i.solicitante_email) + ')' : '') + '</span></span>' +
          U.badge(d + (d === 1 ? ' día' : ' días'), d > 5 ? 'critico' : (d > 2 ? 'alerta' : 'neutro'), true) + '</button></li>';
      }).join('') + '</ul>' + (l.length > 12 ? '<p class="sx2-tenue" style="margin:8px 0 0;font-size:.75rem">Y ' + (l.length - 12) + ' más: usa el semáforo "Esperando validación".</p>' : '') });
  }
  function accionesTablero() {
    return U.boton({ texto: 'Imprimir', icono: 'descargar', variante: 'fantasma', clase: 'js-gv2-imprimir', titulo: 'Imprimir o guardar como PDF' }) +
      (panel_ && panel_.rol_actual === 'ADM' ? U.boton({ texto: 'Enviar a Gerencia ahora', icono: 'correo', clase: 'js-gv2-enviar' }) : '');
  }
  function vistaTablero() {
    var base = itemsBase(), lista = itemsFiltrados(base);
    return '<div class="gv2-imprimir">' + (window.SigsoReportes ? SigsoReportes.cabeceraDocumento({
        titulo: 'Informe de gestión y control', subtitulo: 'Tablero de seguimiento de solicitudes', modulo: 'Gerencia — Panel de dirección',
        codigo: 'SIGSO-REP-GER-TABLERO', generadoPor: PY.miNombre() || '',
        filtros: filtrosTexto().concat(categoria_ ? [{ etiqueta: 'Semáforo', valor: CATEGORIAS.filter(function (c) { return c.codigo === categoria_; })[0].etiqueta }] : [])
      }) : '') + '</div>' +
      barraFiltros() + kpisPanel() + semaforo(base) + avisoRecurrencia() +
      '<div class="gv2-barra sx2-entra">' + buscador() +
        '<label class="gv2-filtro gv2-filtro--linea"><span>Agrupar por</span><select class="sx2-select js-gv2-agrupar">' +
          AGRUPAR.map(function (a) { return '<option value="' + a.id + '"' + (a.id === agrupar_ ? ' selected' : '') + '>' + U.esc(a.texto) + '</option>'; }).join('') + '</select></label>' +
        '<span class="sx2-tenue gv2-cuenta">' + lista.length + (lista.length === 1 ? ' ítem' : ' ítems') +
          '<span title="Resueltas fuera del flujo (por teléfono) y registradas después. No entran en los indicadores porque nunca tuvieron fecha comprometida."> · ' +
          (panel_.atenciones_directas || 0) + ((panel_.atenciones_directas || 0) === 1 ? ' atención directa' : ' atenciones directas') + ' fuera del semáforo</span></span></div>' +
      U.card({ sinRelleno: true, i: 7, cuerpo: tablaItems(lista) }) +
      esperandoSolicitante(itemsFiltrados(base));
  }
  function enviarAhora(b) {
    U.confirmar({ titulo: 'Enviar el reporte de Gerencia ahora', texto: 'Se envía por correo a todos los destinatarios de Gerencia configurados, sin esperar el envío programado.', boton: 'Enviar' }).then(function (si) {
      if (!si) return;
      b.disabled = true;
      api('enviarReporteGerenciaAhora', {}).then(function (r) {
        b.disabled = false;
        if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo enviar el reporte.', 'error'); return; }
        var total = r.data && r.data.enviados;
        PY.aviso(total ? 'Reporte enviado a ' + total + ' destinatario(s).' : 'No hay destinatarios de Gerencia configurados.', total ? 'exito' : 'info');
      });
    });
  }

  // --- Línea de tiempo -------------------------------------------------------------------------
  function vistaGantt() {
    var base = itemsBase(), lista = itemsFiltrados(base).filter(function (i) { return i.fecha_comprometida; });
    var cuerpo;
    if (!lista.length) cuerpo = U.vacio({ icono: 'gantt', titulo: 'No hay ítems comprometidos con estos filtros', texto: 'Solo aparecen los ítems que tienen fecha comprometida.' });
    else {
      lista = lista.slice().sort(function (a, b) { return new Date(a.fecha_comprometida) - new Date(b.fecha_comprometida); });
      var ahora = Date.now();
      var ts = [ahora];
      lista.forEach(function (i) { ts.push(new Date(i.fecha_creacion).getTime(), new Date(i.fecha_comprometida).getTime()); if (i.fecha_original) ts.push(new Date(i.fecha_original).getTime()); });
      ts = ts.filter(function (x) { return !isNaN(x); });
      var min = Math.min.apply(null, ts), max = Math.max.apply(null, ts), rango = Math.max(max - min, 1);
      var p = function (f) { var x = new Date(f).getTime(); return Math.min(100, Math.max(0, (x - min) / rango * 100)); };
      var hoy = p(ahora);
      // Marcas de mes en el eje.
      var marcas = [], d = new Date(min); d.setDate(1); d.setHours(0, 0, 0, 0); d.setMonth(d.getMonth() + 1);
      var paso = Math.max(1, Math.ceil(((max - min) / 2.63e9) / 8));
      while (d.getTime() <= max) {
        marcas.push('<span class="gv2-gantt__mes" style="left:' + p(d) + '%">' + U.esc(new Intl.DateTimeFormat('es-CL', { month: 'short', year: '2-digit' }).format(d)) + '</span>');
        d.setMonth(d.getMonth() + paso);
      }
      cuerpo = '<div class="gv2-gantt"><div class="gv2-gantt__eje"><span></span><div class="gv2-gantt__meses">' + marcas.join('') + '</div></div>' +
        lista.map(function (i) {
          var cu = i.cumplimiento || {}, ini = p(i.fecha_creacion), fin = p(i.fecha_comprometida);
          var atraso = cu.codigo === 'ATRASADA_DESARROLLADOR' && hoy > fin ? '<span class="gv2-gantt__atraso" style="left:' + fin + '%;width:' + (hoy - fin) + '%"></span>' : '';
          var orig = i.re_compromisos > 0 && i.fecha_original && i.fecha_original !== i.fecha_comprometida
            ? '<span class="gv2-gantt__orig" style="left:' + p(i.fecha_original) + '%" title="Fecha original: ' + U.esc(fechaHora(i.fecha_original)) + '"></span>' : '';
          return '<button type="button" class="gv2-gantt__fila js-gv2-sol" data-sol="' + U.esc(i.solicitud_id) + '" data-sub="' + U.esc(i.subsolicitud_id || '') + '" title="' + U.esc(i.titulo + ' · comprometida ' + fechaHora(i.fecha_comprometida)) + '">' +
            '<span class="gv2-gantt__et"><span class="jv2-cod">' + U.esc(i.solicitud_id + '-' + i.numero_item) + '</span><span class="sx2-cortar">' + U.esc(i.titulo) + '</span>' +
              (i.re_compromisos ? '<span class="gv2-recomp">↻' + i.re_compromisos + '</span>' : '') + '</span>' +
            '<span class="gv2-gantt__pista"><span class="gv2-gantt__hoy" style="left:' + hoy + '%"></span>' +
              '<span class="gv2-gantt__barra sx2-tono-' + (TONO_CUMPL[cu.codigo] || 'neutro') + '" style="left:' + ini + '%;width:' + Math.max(fin - ini, 0.6) + '%"></span>' + atraso + orig + '</span></button>';
        }).join('') + '</div>';
    }
    return barraFiltros() + semaforo(base) +
      '<div class="gv2-barra sx2-entra">' + buscador() + '<span class="sx2-tenue gv2-cuenta">' + lista.length + ' con fecha comprometida</span></div>' +
      U.card({ i: 3, cuerpo: '<div class="gv2-ley"><span><i class="gv2-ley__hoy"></i>Hoy</span><span><i class="gv2-ley__atraso"></i>Atraso</span><span><i class="gv2-ley__orig"></i>Fecha original (re-compromiso)</span>' +
        CATEGORIAS.slice(0, 5).map(function (c) { return '<span><i class="gv2-ley__barra sx2-tono-' + c.tono + '"></i>' + U.esc(c.etiqueta) + '</span>'; }).join('') + '</div>' + cuerpo });
  }

  // --- Tendencia y ciclo --------------------------------------------------------------------------
  function graficoMeses(serie) {
    if (!serie || !serie.length) return U.vacio({ icono: 'grafico', titulo: 'Sin datos de los últimos meses', texto: '' });
    var max = serie.reduce(function (m, s) { return Math.max(m, s.creadas || 0, s.cerradas || 0); }, 0) || 1;
    return '<div class="gv2-meses">' + serie.map(function (s) {
      return '<div class="gv2-meses__col"><div class="gv2-meses__barras">' +
          '<span class="gv2-meses__b gv2-meses__b--in" style="height:' + Math.max((s.creadas || 0) / max * 100, 1) + '%" title="Creadas: ' + (s.creadas || 0) + '"><b>' + (s.creadas || 0) + '</b></span>' +
          '<span class="gv2-meses__b gv2-meses__b--out" style="height:' + Math.max((s.cerradas || 0) / max * 100, 1) + '%" title="Cerradas: ' + (s.cerradas || 0) + '"><b>' + (s.cerradas || 0) + '</b></span>' +
        '</div><span class="gv2-meses__et">' + U.esc(s.etiqueta) + '</span>' +
        '<span class="gv2-meses__pct">' + (nulo(s.pct_cumplimiento) ? '—' : s.pct_cumplimiento + '%') + '</span></div>';
    }).join('') + '</div><div class="gv2-ley"><span><i class="gv2-meses__b--in"></i>Creadas</span><span><i class="gv2-meses__b--out"></i>Cerradas</span><span>% = cumplimiento del mes</span></div>';
  }
  function vistaTendencia() {
    var t = panel_.tendencia || [], ciclo = panel_.ciclo_por_etapa || [];
    var conPct = t.filter(function (x) { return !nulo(x.pct_cumplimiento); }).map(function (x) { return { etiqueta: x.etiqueta, valor: x.pct_cumplimiento }; });
    var hayCiclo = ciclo.some(function (c) { return c.muestras > 0; });
    var cicloHtml = hayCiclo ? barras(ciclo.map(function (c) {
      return { etiqueta: estadoTxt(c.estado_desde) + ' → ' + estadoTxt(c.estado_hasta), valor: c.dias_promedio || 0,
        texto: nulo(c.dias_promedio) ? '— sin datos' : c.dias_promedio + ' d · ' + c.muestras + (c.muestras === 1 ? ' muestra' : ' muestras') };
    }), 'primario') + '<p class="sx2-tenue" style="margin:8px 0 0;font-size:.75rem">Días hábiles promedio entre cada estado, contando la primera vez que el ítem entró a cada uno: un rebote no infla el promedio.</p>'
      : U.vacio({ icono: 'reloj', titulo: 'Todavía no hay historial suficiente', texto: 'Hace falta que los ítems pasen por varios estados para calcular el ciclo.' });
    return barraFiltros() +
      '<div class="sx2-grid sx2-grid--estira">' +
        '<div class="sx2-col-6">' + U.card({ titulo: 'Creadas vs. cerradas', icono: 'grafico', sub: 'últimos 6 meses', i: 1, cuerpo: graficoMeses(t) }) + '</div>' +
        '<div class="sx2-col-6">' + U.card({ titulo: '% de cumplimiento por mes', icono: 'diana', i: 2, cuerpo: window.SigsoReportes ? SigsoReportes.tendencia(conPct, { titulo: '% cumplimiento', meta: 90 }) : '' }) + '</div>' +
        '<div class="sx2-col-12">' + U.card({ titulo: 'Tiempo de ciclo por etapa', icono: 'reloj', sub: 'dónde se va el tiempo', i: 3, cuerpo: cicloHtml }) + '</div>' +
      '</div>';
  }

  // --- Recurrencia ---------------------------------------------------------------------------------
  function vistaRecurrencia() {
    var rec = panel_.recurrencia || [];
    var tend = function (t) {
      if (nulo(t)) return '<span class="sx2-tenue">—</span>';
      if (t === 0) return U.badge('=', 'neutro', true);
      return U.badge((t > 0 ? '▲ +' : '▼ ') + t, t > 0 ? 'critico' : 'ok', true);
    };
    return barraFiltros() +
      U.card({ sinRelleno: true, i: 1, cuerpo: rec.length
        ? '<div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr><th>Módulo</th><th>Tipo</th><th class="sx2-num">Cantidad</th><th class="sx2-num">% del total</th><th class="sx2-num">Tendencia</th><th class="sx2-num">Días prom. resolución</th><th class="sx2-num">Reaperturas</th><th></th></tr></thead><tbody>' +
          rec.map(function (r) {
            var clave = r.modulo_nombre + '␟' + r.tipo_nombre;
            return '<tr class="sx2-fila--clic js-gv2-rec" data-clave="' + U.esc(clave) + '" tabindex="0"><td><strong>' + U.esc(r.modulo_nombre) + '</strong></td><td>' + U.esc(r.tipo_nombre) + '</td>' +
              '<td class="sx2-num">' + r.cantidad + '</td><td class="sx2-num"><span class="gv2-pct">' + U.barra(r.pct_total, 'primario') + r.pct_total + '%</span></td>' +
              '<td class="sx2-num">' + tend(r.tendencia) + '</td><td class="sx2-num">' + (nulo(r.dias_promedio_resolucion) ? '—' : r.dias_promedio_resolucion + ' d') + '</td>' +
              '<td class="sx2-num">' + (r.reaperturas ? U.badge(String(r.reaperturas), 'alerta', true) : '0') + '</td>' +
              '<td class="sx2-num"><span class="sx2-enlace" style="white-space:nowrap">Ver ítems' + U.ico('derecha', 14) + '</span></td></tr>';
          }).join('') + '</tbody></table></div>'
        : U.vacio({ icono: 'grafico', titulo: 'Sin datos de recurrencia', texto: 'No hay ítems en la ventana actual con estos filtros.' }) }) +
      '<p class="sx2-tenue" style="margin:0;font-size:.8125rem">Ranking módulo × tipo de la ventana actual. La tendencia compara con la ventana anterior (▲ = se repite más). Un clic abre esos ítems en el tablero.</p>';
  }

  // --- Carga ---------------------------------------------------------------------------------------
  function vistaCarga() {
    var cg = panel_.carga || {};
    var f = function (l) { return (l || []).map(function (x) { return { etiqueta: x.etiqueta, valor: x.cantidad }; }); };
    return barraFiltros() + '<div class="sx2-grid sx2-grid--estira">' +
      '<div class="sx2-col-4">' + U.card({ titulo: 'Por empresa', icono: 'empresa', i: 1, cuerpo: barras(f(cg.por_empresa), 'primario') }) + '</div>' +
      '<div class="sx2-col-4">' + U.card({ titulo: 'Por plataforma', icono: 'capas', i: 2, cuerpo: barras(f(cg.por_plataforma), 'info') }) + '</div>' +
      '<div class="sx2-col-4">' + U.card({ titulo: 'Por área', icono: 'equipo', i: 3, cuerpo: barras(f(cg.por_area), 'hito') }) + '</div></div>';
  }

  // --- Actividades ----------------------------------------------------------------------------------
  function paramsAct(conTipo) {
    var p = { area_id: filtrosAct_.area_id, prioridad: filtrosAct_.prioridad, desde: aIsoInicio(filtrosAct_.desde), hasta: aIsoFin(filtrosAct_.hasta) };
    if (conTipo) p.tipo = filtrosAct_.tipo;
    return p;
  }
  function cargarActividades(silencioso) {
    var c = contenedor();
    if (!c) return;
    var t = ++turno_;
    if (!silencioso || !act_) pagina(c, U.esqueleto('kpis', 5) + U.esqueleto('tabla', 6));
    // El panel trae KPI, calor y comparativo; el estado actual, cada actividad viva
    // (con él se agrupa lo atrasado por persona). Mismos filtros de área y prioridad.
    Promise.all([api('getPanelGerenciaActividades', paramsAct(false)),
      api('generarReporteActividades', Object.assign(paramsAct(false), { tipo: 'estado_actual' }))]).then(function (rs) {
      var r = rs[0];
      if (t !== turno_ || vista_ !== 'actividades') return;
      if (!r || !r.ok) { errorEn(c, r); return; }
      act_ = r.data;
      act_.vivas = rs[1] && rs[1].ok ? (rs[1].data.filas || []) : null;
      pintar(!!silencioso);
      resolverPersonas((act_.criticas || []).map(function (x) { return x.responsable_email; })
        .concat((act_.vivas || []).map(function (x) { return x.responsable_email || x.responsable; })), t);
    });
  }
  function colorCalor(total, pct) {
    if (!total || nulo(pct)) return 'vacio';
    return pct >= 80 ? 'ok' : (pct >= 50 ? 'alerta' : 'critico');
  }
  function accionesActividades() {
    return U.boton({ texto: 'Acta de reunión', icono: 'documento', variante: 'fantasma', clase: 'js-gv2-acta', titulo: 'PDF para la reunión de seguimiento' });
  }
  function vistaActividades() {
    var k = act_.kpis || {}, cmp = k.comparativo || {};
    var areas = act_.areas || [];
    var pct = k.pct_cumplidas_a_tiempo;
    var filtros = '<div class="gv2-filtros sx2-entra">' +
      '<label class="gv2-filtro"><span>Área</span><select class="sx2-select js-gv2-fa" data-f="area_id"><option value="">Todas</option>' +
        areas.map(function (a) { return '<option value="' + U.esc(a.area_id) + '"' + (a.area_id === filtrosAct_.area_id ? ' selected' : '') + '>' + U.esc(a.nombre) + '</option>'; }).join('') + '</select></label>' +
      '<label class="gv2-filtro"><span>Prioridad</span><select class="sx2-select js-gv2-fa" data-f="prioridad"><option value="">Todas</option>' +
        ['P1', 'P2', 'P3', 'P4', 'P5'].map(function (p) { return '<option' + (p === filtrosAct_.prioridad ? ' selected' : '') + '>' + p + '</option>'; }).join('') + '</select></label>' +
      '<label class="gv2-filtro"><span>Desde</span><input type="date" class="sx2-input js-gv2-fa" data-f="desde" value="' + U.esc(filtrosAct_.desde) + '"></label>' +
      '<label class="gv2-filtro"><span>Hasta</span><input type="date" class="sx2-input js-gv2-fa" data-f="hasta" value="' + U.esc(filtrosAct_.hasta) + '"></label>' +
    '</div>';
    var hm = act_.heatmap || [], calor;
    if (!hm.length) calor = U.vacio({ icono: 'rejilla', titulo: 'Sin actividades con fecha comprometida en las últimas semanas', texto: '' });
    else {
      calor = '<div class="sx2-tabla-wrap"><table class="gv2-calor"><thead><tr><th></th>' + hm[0].semanas.map(function (s) { return '<th>' + U.esc(s.etiqueta) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        hm.map(function (f) {
          return '<tr><th scope="row">' + U.esc(f.area_nombre) + '</th>' + f.semanas.map(function (s) {
            return '<td class="gv2-calor--' + colorCalor(s.total, s.pct_cumplimiento) + '" title="' + s.total + ' comprometida(s) esa semana">' + (s.total ? s.pct_cumplimiento + '%' : '—') + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="gv2-ley"><span><i class="gv2-calor--ok"></i>≥ 80 %</span><span><i class="gv2-calor--alerta"></i>50–79 %</span><span><i class="gv2-calor--critico"></i>&lt; 50 %</span><span><i class="gv2-calor--vacio"></i>Sin compromisos</span></div>';
    }
    return filtros +
      '<div class="sx2-card sx2-entra" style="--i:1">' + cuerpoActividades(k, cmp, pct, calor) + '</div>' +
      U.card({ titulo: 'Reportes tabulares', icono: 'documento', sub: 'para exportar', i: 7, cuerpo:
        '<div class="gv2-barra">' + U.segmento(TIPOS_REPORTE_ACT, filtrosAct_.tipo, 'js-gv2-tipo-act') +
          '<span class="sx2-flex" style="gap:8px;margin-left:auto">' +
            U.boton({ texto: 'Ver', icono: 'ojo', variante: 'primario', sm: true, clase: 'js-gv2-rep-ver' }) +
            U.boton({ texto: 'CSV', icono: 'exportar', sm: true, clase: 'js-gv2-rep-csv' }) +
            U.boton({ texto: 'PDF', icono: 'descargar', sm: true, clase: 'js-gv2-rep-pdf' }) + '</span></div>' +
        '<div class="gv2-rep-act">' + reporteActividades() + '</div>' });
  }
  // Anatomía en 4 niveles (auditoría de reportes, R-2): ¿qué está atrasado o bloqueado?
  // Lo crítico va AGRUPADO POR PERSONA: la reunión de seguimiento pregunta a quién.
  var SITUACION_ACT = { Atrasada: ['Atrasada', 'critico', 0], Bloqueada: ['Bloqueada', 'critico', 1], 'Vence hoy': ['Vence hoy', 'alerta', 2], 'Vence mañana': ['Vence mañana', 'alerta', 3],
    'Por confirmar': ['Por confirmar', 'info', 4], 'En revisión': ['En revisión', 'info', 5], 'Al día': ['Al día', 'ok', 6] };
  function diasDesde_(iso) {
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    var h = new Date(), hoy = Date.UTC(h.getFullYear(), h.getMonth(), h.getDate());
    return Math.round((hoy - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86400000);
  }
  function cuerpoActividades(k, cmp, pct, calor) {
    var R = SigsoReportes;
    var todas = act_.vivas;
    if (!todas) return R.nivel('En una línea', R.enUnaLinea({ estado: 'neutro', frase: 'No se pudo leer el estado de cada actividad; recarga la vista.' }));
    var vivas = todas.filter(function (a) { return a.semaforo !== 'Terminada'; });
    var atr = vivas.filter(function (a) { return a.semaforo === 'Atrasada'; });
    var blo = vivas.filter(function (a) { return a.semaforo === 'Bloqueada'; });
    var alta = function (a) { return a.prioridad === 'P1' || a.prioridad === 'P2'; };
    // Clave = correo (unas filas traen nombre y otras correo). Si dos cuentas distintas se
    // llaman igual, el correo va entre paréntesis para no leerlas como una persona repetida.
    function clave(a) { return String(a.responsable_email || a.responsable || '').toLowerCase(); }
    // Si el directorio no conoce el correo, vale el nombre que trae la propia actividad.
    var claves = {}, nombreFila = {};
    todas.forEach(function (a) { var kx = clave(a); claves[kx] = true; if (a.responsable && !/@/.test(a.responsable)) nombreFila[kx] = a.responsable.trim(); });
    function nombreBase(kx) { var n = PY.persona(kx).nombre; return /@/.test(n) && nombreFila[kx] ? nombreFila[kx] : n; }
    var porNombre = {};
    Object.keys(claves).forEach(function (kx) { var n = kx ? nombreBase(kx) : ''; (porNombre[n] = porNombre[n] || []).push(kx); });
    function nombre(kx) {
      if (!kx) return '(sin responsable)';
      var n = nombreBase(kx);
      return (porNombre[n] || []).length > 1 && /@/.test(kx) ? n + ' (' + kx + ')' : n;
    }

    // 1 · En una línea
    var mal = atr.length + blo.length;
    var estado = !vivas.length ? 'neutro' : (atr.filter(alta).length || blo.length || (!nulo(pct) && pct < 50) ? 'critico' : (mal || (!nulo(pct) && pct < 80) || k.antiguedad_media_dias > 5 ? 'alerta' : 'ok'));
    var frase = !vivas.length ? 'No hay actividades abiertas con estos filtros.' :
      'De ' + vivas.length + ' actividades abiertas, ' + (mal ? atr.length + ' están atrasadas' + (blo.length ? ' y ' + blo.length + ' bloqueadas' : '') : 'ninguna está atrasada ni bloqueada') +
      (atr.filter(alta).length ? ' (' + atr.filter(alta).length + ' son P1/P2)' : '') +
      (nulo(pct) ? '' : '; de lo terminado en el período, ' + pct + ' % se cumplió a tiempo') +
      (k.antiguedad_media_dias > 5 ? '; llevan en promedio ' + R.formatearNumero(k.antiguedad_media_dias) + ' días hábiles sin check-in, así que el panel puede estar desactualizado' : '') + '.';
    var sinFecha = vivas.filter(function (a) { return !a.fecha_compromiso; }).length;
    var linea = R.enUnaLinea({ estado: estado, frase: frase, comparaCon: 'vs. período anterior', kpis: [
      { etiqueta: 'Abiertas', valor: vivas.length, icono: 'lista', tono: 'primario', nota: sinFecha ? sinFecha + ' sin fecha comprometida' : 'todas con fecha' },
      { etiqueta: 'Atrasadas', valor: atr.length, icono: 'alerta', tono: atr.length ? 'critico' : 'ok', nota: vivas.length ? Math.round(atr.length / vivas.length * 100) + ' % de las abiertas' : '' },
      { etiqueta: 'Bloqueadas', valor: blo.length, icono: 'pausado', tono: blo.length ? 'critico' : 'ok', nota: blo.length ? R.formatearNumero(k.bloqueo_promedio_dias || 0) + ' días hábiles en promedio' : 'ninguna' },
      { etiqueta: 'Cumplidas a tiempo', valor: nulo(pct) ? '—' : pct, sufijo: nulo(pct) ? '' : '%', icono: 'diana', progreso: nulo(pct) ? null : pct,
        tono: nulo(pct) ? 'neutro' : (pct >= 80 ? 'ok' : (pct >= 50 ? 'alerta' : 'critico')), delta: nulo(cmp.pct_cumplidas_a_tiempo) ? undefined : cmp.pct_cumplidas_a_tiempo, deltaSufijo: ' pp',
        nota: 'de lo terminado en el período', titulo: 'De lo terminado en el período, % terminado dentro del compromiso.' }
    ] });

    // 2 · Lo que requiere decisión: una fila por persona con atrasos o bloqueos.
    var porPersona = {};
    atr.concat(blo).forEach(function (a) {
      var kx = clave(a);
      var p = porPersona[kx] = porPersona[kx] || { r: kx, atr: 0, blo: 0, altas: 0, masVieja: 0, ej: [] };
      if (a.semaforo === 'Atrasada') { p.atr++; p.masVieja = Math.max(p.masVieja, diasDesde_(a.fecha_compromiso) || 0); } else p.blo++;
      if (alta(a)) p.altas++;
      if (p.ej.length < 2 || alta(a)) p.ej.push(a);
    });
    var alertas = Object.keys(porPersona).map(function (kx) {
      var p = porPersona[kx], n = p.atr + p.blo;
      var ej = [];
      p.ej.sort(function (a, b) { return (alta(b) ? 1 : 0) - (alta(a) ? 1 : 0); }).forEach(function (a) { var t = '«' + a.titulo + '»'; if (ej.length < 2 && ej.indexOf(t) === -1) ej.push(t); });
      return { severidad: p.altas || p.blo || n >= 5 || p.masVieja > 10 ? 'critico' : 'alerta', cantidad: n, titulo: nombre(p.r),
        detalle: [p.atr ? p.atr + (p.atr === 1 ? ' atrasada' : ' atrasadas') + (p.masVieja ? ', la más antigua venció hace ' + p.masVieja + ' días' : '') : '',
          p.blo ? p.blo + (p.blo === 1 ? ' bloqueada' : ' bloqueadas') : '', p.altas ? p.altas + ' P1/P2' : ''].filter(Boolean).join(' · ') + (ej.length ? ' — ' + ej.join(', ') : ''), };
    });
    if (k.antiguedad_media_dias > 5) alertas.push({ severidad: 'alerta', cantidad: Math.round(k.antiguedad_media_dias), titulo: 'Días hábiles sin check-in, en promedio',
      detalle: 'Si nadie actualiza sus actividades, lo de arriba puede estar desfasado. Pide el check-in antes de decidir.', dueno: 'Todos los equipos' });
    if (k.reprogramaciones_promedio > 1) alertas.push({ severidad: 'alerta', cantidad: R.formatearNumero(k.reprogramaciones_promedio), titulo: 'Reprogramaciones por actividad, en promedio',
      detalle: '1 es normal; más indica mala estimación o alcance que crece.' });
    var decision = R.requiereDecision(alertas, { vacio: 'Nadie tiene actividades atrasadas ni bloqueadas.' });

    // 3 · Panorama: carga por persona (abiertas, con cuántas atrasadas) y cumplimiento por área × semana.
    var carga = {};
    vivas.forEach(function (a) { var kx = clave(a); var c = carga[kx] = carga[kx] || { r: kx, n: 0, atr: 0 }; c.n++; if (a.semaforo === 'Atrasada') c.atr++; });
    var filasCarga = Object.keys(carga).map(function (kx) { return carga[kx]; }).sort(function (a, b) { return b.n - a.n; });
    var panorama = '<h3 class="rp2-sub">Carga por persona <span class="sx2-tenue" style="font-weight:500;font-size:.8125rem">(abiertas · de ellas, atrasadas)</span></h3>' +
      R.ranking(filasCarga.map(function (c) {
        return { etiqueta: nombre(c.r), valor: c.n, texto: c.n + (c.atr ? ' · ' + c.atr + ' atr.' : ''), tono: c.atr > c.n / 2 ? 'critico' : (c.atr ? 'alerta' : 'ok') };
      }), { vacio: 'Sin actividades abiertas.' }) +
      '<h3 class="rp2-sub">Cumplimiento por área × semana</h3>' + calor;
    var bien = [];
    var alDia = filasCarga.filter(function (c) { return !c.atr && c.n >= 2; });
    if (alDia.length) bien.push(alDia.slice(0, 4).map(function (c) { return nombre(c.r); }).join(', ') + (alDia.length === 1 ? ' tiene' : ' tienen') + ' todo al día.');
    if (!nulo(k.pct_emergente) && k.pct_emergente <= 20) bien.push('Solo ' + R.formatearNumero(k.pct_emergente) + ' % del trabajo del período entró sin planificar.');
    panorama += R.loQueVaBien(bien);

    // 4 · Detalle: cada actividad abierta, de la más grave a la al día.
    var filas = vivas.slice().sort(function (a, b) {
      var sa = (SITUACION_ACT[a.semaforo] || [0, 0, 9])[2], sb = (SITUACION_ACT[b.semaforo] || [0, 0, 9])[2];
      return (sa - sb) || ((alta(b) ? 1 : 0) - (alta(a) ? 1 : 0)) || String(a.fecha_compromiso || '9').localeCompare(String(b.fecha_compromiso || '9'));
    }).map(function (a) {
      var s = SITUACION_ACT[a.semaforo] || [a.semaforo || '—', 'neutro'], d = a.semaforo === 'Atrasada' ? diasDesde_(a.fecha_compromiso) : null;
      return { actividad: '<span class="rp2-item"><strong>' + U.esc(a.titulo) + '</strong><small>' + U.esc(a.area || '') + '</small></span>',
        resp: U.esc(nombre(clave(a))), prio: U.badge(a.prioridad || '—', tonoPrioridad(a.prioridad), true), sit: U.badge(s[0], s[1], true),
        vence: a.fecha_compromiso ? U.esc(PY.fecha(a.fecha_compromiso, true)) + (d ? ' <span class="sx2-tenue" style="font-size:.75rem">(' + d + ' d)</span>' : '') : '—' };
    });
    var detalle = '<div class="rp2-detalle">' + R.tabla([
      { campo: 'actividad', titulo: 'Actividad', html: true }, { campo: 'resp', titulo: 'Responsable', html: true }, { campo: 'prio', titulo: 'Prior.', html: true },
      { campo: 'sit', titulo: 'Situación', html: true }, { campo: 'vence', titulo: 'Vence', html: true }
    ], filas, { vacio: 'Sin actividades abiertas.' }) + '</div>';

    return R.nivel('En una línea', linea) +
      R.nivel('Lo que requiere decisión', decision, { nota: alertas.length ? 'por persona · la cifra es cuántas' : '' }) +
      R.nivel('Panorama', panorama) +
      R.nivel('Detalle · de la más grave a la al día', detalle, { clase: 'rp2-nivel--detalle', nota: vivas.length + (vivas.length === 1 ? ' actividad abierta' : ' actividades abiertas') });
  }
  function reporteActividades() {
    if (!repAct_) return '<p class="sx2-tenue" style="margin:12px 0 0;font-size:.8125rem">Elige el tipo y pulsa "Ver". Se usan los mismos filtros de arriba (área, prioridad y fechas).</p>';
    if (repAct_.cargando) return U.esqueleto('tabla', 4);
    var r = repAct_.datos;
    var resumen = Object.keys(r.resumen || {}).map(function (k) {
      var v = r.resumen[k];
      return '<span class="gv2-resumen"><span>' + U.esc(k.replace(/_/g, ' ')) + '</span><b>' + U.esc(nulo(v) ? '—' : String(v)) + '</b></span>';
    }).join('');
    return '<div class="gv2-resumenes">' + resumen + '</div>' + ((r.filas || []).length
      ? '<div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr>' + r.columnas.map(function (c) { return '<th>' + U.esc(c.etiqueta) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        r.filas.map(function (f) { return '<tr>' + r.columnas.map(function (c) { return '<td>' + U.esc(celdaAct(f[c.campo])) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>'
      : U.vacio({ icono: 'lupa', titulo: 'Sin datos para estos filtros', texto: '' }));
  }
  // Fechas ISO y correos del reporte, legibles (el CSV y el PDF quedan con el dato crudo).
  function celdaAct(v) {
    if (nulo(v)) return '—';
    var t = String(v);
    if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(t)) return PY.fecha(t, true);
    if (/^[^\s@]+@[^\s@]+$/.test(t)) return PY.persona(t).nombre;
    return t;
  }
  function verReporteAct() {
    repAct_ = { cargando: true };
    var cont = document.querySelector('#gerencia-v2 .gv2-rep-act');
    if (cont) cont.innerHTML = reporteActividades();
    api('generarReporteActividades', paramsAct(true)).then(function (r) {
      if (vista_ !== 'actividades') return;
      if (!r || !r.ok) { repAct_ = null; PY.aviso((r && r.message) || 'No se pudo generar el reporte.', 'error'); pintar(true); return; }
      repAct_ = { datos: r.data };
      var c2 = document.querySelector('#gerencia-v2 .gv2-rep-act');
      if (c2) { c2.innerHTML = reporteActividades(); U.animar(c2); }
    });
  }
  function csvReporteAct() {
    if (!repAct_ || !repAct_.datos || !(repAct_.datos.filas || []).length) { PY.aviso('Primero genera el reporte con "Ver".', 'info'); return; }
    var r = repAct_.datos;
    SigsoReportes.descargarCsvDeFilas([r.columnas.map(function (c) { return c.etiqueta; })].concat(r.filas.map(function (f) {
      return r.columnas.map(function (c) { return nulo(f[c.campo]) ? '' : f[c.campo]; });
    })), 'sigso-actividades-' + r.tipo);
  }
  function pdf(accion, datos, b, nombre) {
    b.disabled = true;
    api(accion, datos).then(function (r) {
      b.disabled = false;
      if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo generar el PDF.', 'error'); return; }
      PY.descargarBase64(r.data.pdf_base64, r.data.filename || nombre, 'application/pdf');
    });
  }

  // --- Pausas activas ------------------------------------------------------------------------------
  function cargarPausas(silencioso) {
    var c = contenedor();
    if (!c) return;
    var t = ++turno_;
    if (!silencioso || !pausas_) pagina(c, U.esqueleto('kpis', 5) + U.esqueleto('tarjetas', 2));
    api('getReporteGerenciaPausas', {}).then(function (r) {
      if (t !== turno_ || vista_ !== 'pausas') return;
      if (!r || !r.ok) { errorEn(c, r); return; }
      pausas_ = r.data;
      pintar(!!silencioso);
    });
  }
  function accionesPausas() {
    if (!pausas_ || pausas_.sin_datos) return '';
    return U.boton({ texto: 'CSV', icono: 'exportar', variante: 'fantasma', clase: 'js-gv2-pausas-csv' }) + U.boton({ texto: 'Descargar PDF', icono: 'descargar', clase: 'js-gv2-pausas-pdf' });
  }
  // Anatomía en 4 niveles: la definición es compartida con Coordinación (reporte-pausas-v2.js).
  function vistaPausas() {
    var d = pausas_;
    if (d.sin_datos) return U.card({ i: 1, cuerpo: U.vacio({ icono: 'reloj', titulo: 'Aún no hay pausas activas configuradas', texto: 'Se configuran en Administración → Pausas activas.' }) });
    return '<p class="sx2-tenue sx2-entra" style="margin:0;font-size:.8125rem">Período: ' + U.esc(PY.fecha(d.periodo.desde, true)) + ' al ' + U.esc(PY.fecha(d.periodo.hasta, true)) + ' · todas las empresas.</p>' +
      '<div class="sx2-card sx2-entra">' + SigsoReportePausas.cuerpo(d, { multiempresa: true }) + '</div>';
  }
  function csvPausas() {
    var campos = ['pausa_id', 'empresa_id', 'fecha', 'hora_programada', 'estado'];
    SigsoReportes.descargarCsvDeFilas([campos].concat((pausas_.pausas || []).map(function (p) {
      return campos.map(function (c) { return nulo(p[c]) ? '' : p[c]; });
    })), 'sigso-pausas');
  }

  // --- Centro de reportes (motor v2) -----------------------------------------------------------------
  function registrarReportes() {
    if (!window.SigsoReportes || registrarReportes.hecho) return;
    SigsoReportes.registrar('gerencia', {
      titulo: 'Reportes de Gerencia',
      nota: 'Todos se arman con lo que ya devuelve el panel: lo que se ve aquí y lo que se ve en el tablero salen del mismo conjunto, con los mismos filtros de empresa, responsable y solicitante.',
      grupos: REPORTES
    });
    registrarReportes.hecho = true;
  }
  function filtrosServidorRep() {
    var f = filtrosRep_ || {}, s = Object.assign({}, filtros_);
    if (f.area) s.area = f.area;
    // Estado del servicio mide el período y el anterior sobre el mismo conjunto:
    // pide los ítems sin recorte de fecha y corta en el navegador.
    if (reporteAbierto_ === SERVICIO) return s;
    var rango = SigsoReportes.rangoDePeriodo(f.periodo);
    if (f.desde || rango.desde) s.desde = f.desde || rango.desde;
    if (f.hasta || rango.hasta) s.hasta = f.hasta || rango.hasta;
    return s;
  }
  function cargarReportes(silencioso) {
    registrarReportes();
    var c = contenedor();
    if (!c) return;
    var t = ++turno_;
    if (!silencioso || !panelRep_) pagina(c, U.esqueleto('tarjetas', 3));
    api('getPanelGerencia', filtrosServidorRep()).then(function (r) {
      if (t !== turno_ || vista_ !== 'reportes') return;
      if (!r || !r.ok) { errorEn(c, r); return; }
      panelRep_ = r.data;
      recordar(panelRep_.items);
      pintarReportes(!!silencioso);
    });
  }
  function cuerpoComparativo(p) {
    var cmp = (p.kpis || {}).comparativo;
    if (!cmp) return U.vacio({ icono: 'grafico', titulo: 'El panel no trajo el comparativo de períodos', texto: '' });
    var v = p.ventana || {};
    var filas = Object.keys(cmp).map(function (k) {
      var meta = KPI_META[k] || { texto: k.replace(/_/g, ' '), menosEsMejor: false };
      var d = cmp[k], ok = !nulo(d);
      var mejora = ok && d !== 0 && (meta.menosEsMejor ? d < 0 : d > 0);
      return {
        indicador: meta.texto,
        variacion: ok ? U.badge((d > 0 ? '+' : (d < 0 ? '−' : '=')) + ' ' + Math.abs(d), d === 0 ? 'neutro' : (mejora ? 'ok' : 'critico'), true) : U.badge('sin comparación', 'neutro', true),
        lectura: !ok ? 'Una de las dos ventanas no tenía datos.' : (d === 0 ? 'Igual que la ventana anterior.' : (mejora ? 'Mejora respecto de la ventana anterior.' : 'Empeora respecto de la ventana anterior.'))
      };
    });
    return '<p class="rp2-nota">' + U.ico('info', 16) + '<span>Compara ' + U.esc(PY.fecha(v.desde, true)) + ' — ' + U.esc(PY.fecha(v.hasta, true)) + ' contra ' +
        U.esc(PY.fecha(v.desde_anterior, true)) + ' — ' + U.esc(PY.fecha(v.hasta_anterior, true)) + '. Se muestra la variación ya calculada sobre esas dos ventanas, no un valor anterior.</span></p>' +
      SigsoReportes.tabla([
        { campo: 'indicador', titulo: 'Indicador' }, { campo: 'variacion', titulo: 'Variación', alinear: 'derecha', html: true }, { campo: 'lectura', titulo: 'Cómo se lee' }
      ], filas, { vacio: 'No hay indicadores comparables en esta ventana.' });
  }
  function pintarReportes(silencioso) {
    var c = contenedor();
    if (!c || !panelRep_ || vista_ !== 'reportes') return;
    pagina(c, '<div class="sx2-card sx2-entra gv2-rep" style="--i:1"></div>', silencioso);
    var cont = c.querySelector('.gv2-rep');
    if (!reporteAbierto_) {
      SigsoReportes.pintarCatalogo({
        contenedor: cont, modulo: 'gerencia',
        onAbrir: function (id) { reporteAbierto_ = id; filtrosRep_ = {}; cargarReportes(false); },
        onIrASeccion: function (v) { irA(v); }
      });
      return;
    }
    var r = SigsoReportes.buscarReporte('gerencia', reporteAbierto_);
    if (!r) { reporteAbierto_ = null; pintarReportes(); return; }
    var items = panelRep_.items || [];
    var opciones = SigsoReportes.opcionesDeItems(areas_, r.campos || {});
    var cuerpo = '';
    if (r.id === SERVICIO) {
      // Período por defecto: este mes (sin período no hay contra qué comparar).
      filtrosRep_ = Object.assign({ periodo: 'mes' }, filtrosRep_);
      cuerpo = SigsoReporteServicio.cuerpo(items, {
        periodo: filtrosRep_.periodo, tendencia: panelRep_.tendencia,
        dimension: { campo: 'area_nombre', titulo: 'Área', vacia: '(sin área)' }
      });
    } else if (r.id === 'ger-area') cuerpo = SigsoReportes.cuerpoCumplimientoPor(items, { campo: 'area_nombre', etiquetaVacia: '(sin área)', dimension: 'Área', etiquetaTotal: 'Áreas con actividad' });
    else if (r.id === 'ger-responsable') cuerpo = SigsoReportes.cuerpoCumplimientoPor(items, { campo: 'desarrollador_nombre', etiquetaVacia: '(sin asignar)', dimension: 'Responsable', etiquetaTotal: 'Responsables' });
    else if (r.id === 'ger-resbalon') cuerpo = SigsoReportes.cuerpoResbalon(items, { columnasExtra: [{ campo: 'area_nombre', titulo: 'Área' }] });
    else if (r.id === 'ger-throughput') cuerpo = SigsoReportes.cuerpoEntradaSalida(panelRep_.tendencia || []);
    else if (r.id === 'ger-comparativo') cuerpo = cuerpoComparativo(panelRep_);
    cont.innerHTML = SigsoReportes.barraAcciones({}) +
      SigsoReportes.cabeceraDocumento({
        titulo: r.nombre, subtitulo: r.desc, modulo: 'Gerencia — Panel de dirección',
        codigo: 'SIGSO-REP-GER-' + String(r.id).replace(/^[a-z]+-/, '').toUpperCase(),
        generadoPor: PY.miNombre() || '', filtros: filtrosTexto().concat(SigsoReportes.filtrosParaCabecera(r, opciones, filtrosRep_))
      }) +
      SigsoReportes.pintarFiltros(r, opciones, filtrosRep_) + cuerpo + SigsoReportes.pieDocumento();
    SigsoReportes.wireAcciones(cont, { nombreArchivo: 'sigso-gerencia-' + r.id, onVolver: function () { reporteAbierto_ = null; filtrosRep_ = {}; pintarReportes(); } });
    SigsoReportes.alAplicarFiltros(cont, function (valores) { filtrosRep_ = valores; cargarReportes(false); });
  }

  // --- Navegación ------------------------------------------------------------------------------------
  function irA(v) {
    vista_ = v === 'resumen' || VISTAS[v] ? v : 'resumen';
    if (vista_ !== 'reportes') { reporteAbierto_ = null; filtrosRep_ = {}; }
    registrarArbol();
    if (window.SigsoShell && SigsoShell.publicarItem) SigsoShell.publicarItem(vista_);
    if (vista_ === 'resumen') { if (window.SigsoGerenciaV2) SigsoGerenciaV2.mostrar(); return; }
    var hay = !!document.getElementById('gerencia-v2');
    if (vista_ === 'actividades') { cargarActividades(!!act_ && hay); return; }
    if (vista_ === 'pausas') { cargarPausas(!!pausas_ && hay); return; }
    if (vista_ === 'reportes') { cargarReportes(!!panelRep_ && hay); return; }
    if (panel_ && hay) { ++turno_; pintar(false); return; }
    cargarPanel(false);
  }
  function recargar() {
    if (vista_ === 'actividades') cargarActividades(true);
    else if (vista_ === 'pausas') cargarPausas(true);
    else if (vista_ === 'reportes') cargarReportes(true);
    else cargarPanel(true);
  }

  document.addEventListener('click', function (ev) {
    var raiz = document.getElementById('gerencia-v2');
    if (!raiz || !raiz.contains(ev.target) || vista_ === 'resumen') return;
    var t = ev.target, b;
    if (t.closest('.js-gv2-recargar')) { recargar(); return; }
    if ((b = t.closest('.js-gv2-sol'))) { if (window.SigsoBandejaV2) SigsoBandejaV2.abrirSolicitud(b.getAttribute('data-sol'), b.getAttribute('data-sub')); return; }
    if ((b = t.closest('.js-gv2-cat'))) { categoria_ = b.getAttribute('data-c') || ''; pintar(true); return; }
    if ((b = t.closest('.sx2-kpi--clic'))) { var f = b.getAttribute('data-filtro'); categoria_ = categoria_ === f ? '' : f; pintar(true); return; }
    if ((b = t.closest('.js-gv2-orden'))) {
      var campo = b.getAttribute('data-campo');
      orden_ = orden_.campo === campo ? { campo: campo, dir: orden_.dir === 'asc' ? 'desc' : 'asc' } : { campo: campo, dir: 'asc' };
      pintar(true);
      return;
    }
    if (t.closest('.js-gv2-sin-rec')) { recurrencia_ = ''; pintar(true); return; }
    if ((b = t.closest('.js-gv2-rec'))) { recurrencia_ = b.getAttribute('data-clave'); categoria_ = ''; irA('tablero'); return; }
    if (t.closest('.js-gv2-limpiar')) { filtros_ = { empresa_id: '', desarrollador: '', solicitante: '' }; cargarPanel(true); return; }
    if (t.closest('.js-gv2-imprimir')) { window.print(); return; }
    if ((b = t.closest('.js-gv2-enviar'))) { enviarAhora(b); return; }
    if ((b = t.closest('.js-gv2-tipo-act'))) {
      filtrosAct_.tipo = b.getAttribute('data-id');
      b.parentNode.querySelectorAll('.sx2-segmento__op').forEach(function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
      if (repAct_ && repAct_.datos) verReporteAct();
      return;
    }
    if (t.closest('.js-gv2-rep-ver')) { verReporteAct(); return; }
    if (t.closest('.js-gv2-rep-csv')) { csvReporteAct(); return; }
    if ((b = t.closest('.js-gv2-rep-pdf'))) { pdf('descargarReporteActividadesPdf', paramsAct(true), b, 'reporte-actividades.pdf'); return; }
    if ((b = t.closest('.js-gv2-acta'))) { pdf('descargarActaReunionPdf', paramsAct(false), b, 'acta-reunion.pdf'); return; }
    if (t.closest('.js-gv2-pausas-csv')) { csvPausas(); return; }
    if ((b = t.closest('.js-gv2-pausas-pdf'))) pdf('descargarReporteGerenciaPausasPdf', {}, b, 'pausas-gerencia.pdf');
  });
  document.addEventListener('keydown', function (ev) {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('#gerencia-v2 tr.js-gv2-sol, #gerencia-v2 tr.js-gv2-rec')) { ev.preventDefault(); ev.target.click(); }
  });
  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (!el.closest || !el.closest('#gerencia-v2')) return;
    if (el.classList.contains('js-gv2-fs')) { filtros_[el.getAttribute('data-f')] = String(el.value || '').trim(); cargarPanel(true); return; }
    if (el.classList.contains('js-gv2-agrupar')) { agrupar_ = el.value; pintar(true); return; }
    if (el.classList.contains('js-gv2-fa')) { filtrosAct_[el.getAttribute('data-f')] = el.value; repAct_ = null; cargarActividades(true); }
  });
  var tq_ = null;
  document.addEventListener('input', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('js-gv2-q')) return;
    q_ = ev.target.value;
    clearTimeout(tq_);
    tq_ = setTimeout(function () { pintar(true); }, 150);
  });
  // Un cambio hecho en el panel de la solicitud (derivar, cerrar…) actualiza el tablero.
  document.addEventListener('sigso:solicitudes-cambio', function () {
    var c = document.getElementById('gerencia-v2');
    if (c && c.offsetParent !== null && DEL_PANEL.indexOf(vista_) !== -1) cargarPanel(true);
  });

  window.SigsoGerencia = {
    cargar: function () {
      var pedida = (window.SigsoShell && SigsoShell.tomarItemDeRuta) ? SigsoShell.tomarItemDeRuta() : '';
      irA(pedida || vista_);
    },
    irAItem: irA,
    registrarArbol: registrarArbol,
    // gerencia-v2.js (Resumen ejecutivo) pregunta si sigue siendo la vista activa antes de pintar.
    vista: function () { return vista_; }
  };
  registrarArbol();
})();
