/**
 * calidad-admin-v2.js — Calidad: Reportes, Accesos y formularios de
 * Documentos 100 % v2 (SIGSO v2, R10 del retiro de la versión clásica; ver
 * documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 *  - Centro de reportes del SGC (motor v2): cumplimiento general, ranking de
 *    capítulos, estado documental, cláusulas, tendencia de un indicador y
 *    evolución de la cobertura; los que viven en otra pantalla llevan a ella
 *    y los que no tienen dato dicen qué falta.
 *  - Accesos: rol SGC de cada cuenta (asignar, cambiar, quitar, "¿qué ve?"),
 *    matriz de distribución (quién ve y quién confirmó cada documento) y
 *    documentos confidenciales.
 *  - Formularios de Documentos: cargar, nueva versión, editar, cláusulas ISO
 *    y reemplazar archivo (los abre calidad-documentos-v2.js).
 * Mismos endpoints que calidad.js.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  function C() { return window.SigsoCalidadV2.util; }
  function api(a, d) { return C().api(a, d); }

  var TIPOS = [['DOC', 'Documento maestro'], ['PRO', 'Procedimiento'], ['INS', 'Instructivo'], ['FO', 'Formulario'], ['EXTERNO', 'Documento externo']];
  var VISIBILIDAD = [['TODOS', 'Todo el personal'], ['AREA', 'Solo su área'], ['SELECCION', 'Personas específicas']];
  var COB = { COMPLETO: ['Completo', 'ok'], PARCIAL: ['Parcial', 'alerta'], FALTANTE: ['Faltante', 'critico'], NO_APLICA: ['No aplica', 'neutro'] };
  var NIVEL = { gobierno: ['Gobierno del SGC', 'critico'], lectura: ['Lectura total', 'info'], operativo: ['Acceso acotado', 'neutro'] };
  var SECCION_ACCESO = { documentos: 'Documentos', personas: 'Personas (su ficha)', capacitaciones: 'Capacitaciones', nc: 'No conformidades', auditorias: 'Auditorías',
    quejas: 'Quejas', proveedores: 'Proveedores', revision: 'Revisión por la dirección', objetivos: 'Objetivos de calidad', cobertura: 'Cobertura ISO' };
  var MATRIZ = { confirmado: ['✓', 'ok', 'Puede verlo y ya confirmó la lectura'], pendiente: ['○', 'alerta', 'Puede verlo, aún no confirma'], no: ['—', 'neutro', 'No le corresponde'], na: ['·', 'info', 'Puede verlo (no requiere confirmación)'] };

  var vista_ = '', turno_ = 0;
  var rep_ = { abierto: null, filtros: {} };
  var acc_ = { sub: 'personas', datos: {}, grupo: '', q: '' };

  function fecha(v) { if (!v) return '—'; var s = String(v); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? PY.fecha(s, true) : (C().fechaChile(s) || PY.fecha(s, true)); }
  function iso(v) { var m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : ''; }
  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function esCorreo(t) { return /^[^\s@]+@[^\s@]+$/.test(String(t || '').trim()); }
  function aviso(tono, icono, texto) { return '<div class="mj2-aviso sx2-tono-' + tono + ' sx2-entra">' + U.ico(icono, 16) + '<span>' + texto + '</span></div>'; }
  function dato(et, v) { return v ? '<dt>' + U.esc(et) + '</dt><dd>' + v + '</dd>' : ''; }
  function input(n, v, extra) { return '<input class="sx2-input" name="' + n + '" value="' + U.esc(v == null ? '' : v) + '"' + (extra || '') + '>'; }
  function area(n, v, filas, extra) { return '<textarea class="sx2-input" name="' + n + '" rows="' + (filas || 3) + '"' + (extra || '') + '>' + U.esc(v == null ? '' : v) + '</textarea>'; }
  function select(n, ops, v) { return '<select class="sx2-select" name="' + n + '">' + ops.map(function (o) { return '<option value="' + U.esc(o[0]) + '"' + (String(o[0]) === String(v == null ? '' : v) ? ' selected' : '') + '>' + U.esc(o[1]) + '</option>'; }).join('') + '</select>'; }
  function fila2(a, b) { return '<div class="sx2-form__fila">' + a + b + '</div>'; }
  function lista(t) { return String(t || '').split(/[\n,;]+/).map(function (x) { return x.trim(); }).filter(Boolean); }

  function pagina(html, silencioso) {
    var c = C().contenedor(vista_);
    if (!c) return null;
    var y = window.scrollY, foco = document.activeElement && document.activeElement.classList.contains('js-ca2-q');
    c.innerHTML = '<div class="sx2-pagina">' + html + '</div>';
    if (silencioso) { c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; }); window.scrollTo(0, y); }
    if (foco) { var q = c.querySelector('.js-ca2-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
    U.animar(c);
    return c;
  }
  function cabecera(titulo, sub, migas, acciones) {
    return '<header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Calidad' + (migas ? ' · ' + U.esc(migas) : '') + '</span><h1>' + U.esc(titulo) + '</h1>' +
      (sub ? '<span class="sx2-tenue" style="font-size:.875rem">' + sub + '</span>' : '') + '</div><div class="sx2-cabecera__acciones">' + (acciones || '') +
      U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-ca2-recargar' }) + '</div></header>';
  }

  // =========================================================================================
  // Centro de reportes del SGC
  // =========================================================================================
  var REPORTES = [
    { grupo: 'Cumplimiento', icono: 'escudo', reportes: [
      { id: 'cump-general', nombre: 'Cumplimiento general', tipo: 'CUMPLIMIENTO', estado: 'LISTO', desc: 'Indicador interno de gestión y su desglose por capítulo de la norma.', fuente: 'resumenTableroSgc', filtros: [] },
      { id: 'cump-clausula', nombre: 'Por cláusula', tipo: 'DETALLE', estado: 'LISTO', desc: 'Las cláusulas del catálogo con su estado y qué evidencia las sustenta.', fuente: 'listarMatrizCoberturaSgc', filtros: ['estado'] },
      { id: 'rank-capitulo', nombre: 'Ranking de capítulos', tipo: 'RANKING', estado: 'LISTO', desc: 'Qué capítulos de la norma van más avanzados y cuáles quedaron atrás.', fuente: 'resumenTableroSgc', filtros: [] },
      { id: 'cump-area', nombre: 'Por área', tipo: 'CUMPLIMIENTO', estado: 'PENDIENTE', desc: 'Cumplimiento desagregado por área de la organización.', falta: 'Las cláusulas no se atribuyen a un área: la cobertura se mide por evidencia del sistema, no por unidad organizacional.' },
      { id: 'cump-proceso', nombre: 'Por proceso', tipo: 'CUMPLIMIENTO', estado: 'PENDIENTE', desc: 'Cumplimiento de cada proceso del mapa (§4.4).', falta: 'Requiere enlazar cada cláusula con los procesos que la sustentan. Hoy solo los indicadores tienen proceso.' },
      { id: 'cump-responsable', nombre: 'Por responsable', tipo: 'CUMPLIMIENTO', estado: 'PENDIENTE', desc: 'Qué tiene pendiente cada responsable del SGC.', falta: 'Los procesos del mapa no tienen responsable asignado todavía.' }
    ] },
    { grupo: 'Indicadores y objetivos', icono: 'grafico', reportes: [
      { id: 'ind-tendencia', nombre: 'Tendencia de un indicador', tipo: 'TENDENCIA', estado: 'LISTO', desc: 'Cómo evolucionó un indicador período a período, contra su meta.', fuente: 'listarIndicadoresSgc', filtros: [] },
      { id: 'ind-objetivos', nombre: 'Objetivos de calidad', tipo: 'ESTADO', estado: 'LISTO', desc: 'Meta, mediciones del año y si cumple.', fuente: 'listarObjetivosSgc', seccion: 'objetivos' },
      { id: 'ind-proceso', nombre: 'Indicadores de proceso', tipo: 'ESTADO', estado: 'LISTO', desc: 'Indicadores §9.1.1 con su última lectura y evaluación.', fuente: 'listarIndicadoresSgc', seccion: 'indicadores' }
    ] },
    { grupo: 'Documentación', icono: 'documento', reportes: [
      { id: 'doc-estado', nombre: 'Estado documental', tipo: 'ESTADO', estado: 'LISTO', desc: 'Vigentes, de origen externo, próximos a revisión y vencidos.', fuente: 'resumenTableroSgc', filtros: [] },
      { id: 'doc-distribucion', nombre: 'Distribución documental', tipo: 'DETALLE', estado: 'LISTO', desc: 'Quién debe acusar cada documento controlado y quién ya lo hizo.', fuente: 'getMatrizDistribucionSgc', seccion: 'accesos' },
      { id: 'doc-acuses', nombre: 'Cumplimiento de acuses', tipo: 'CUMPLIMIENTO', estado: 'LISTO', desc: 'Por documento: cuántos destinatarios confirmaron lectura.', fuente: 'getCumplimientoDocumentoSgc', seccion: 'documentos' }
    ] },
    { grupo: 'Auditorías y mejora', icono: 'lupa', reportes: [
      { id: 'aud-estado', nombre: 'Auditorías y hallazgos', tipo: 'ESTADO', estado: 'LISTO', desc: 'Programadas, ejecutadas y hallazgos abiertos.', fuente: 'listarAuditoriasSgc', seccion: 'auditorias' },
      { id: 'nc-abiertas', nombre: 'No conformidades', tipo: 'ESTADO', estado: 'LISTO', desc: 'Abiertas por etapa, con acciones y verificación de eficacia.', fuente: 'listarNcSgc', seccion: 'nc' },
      { id: 'quejas-estado', nombre: 'Quejas', tipo: 'ESTADO', estado: 'LISTO', desc: 'Recibidas, en investigación y resueltas.', fuente: 'listarQuejasSgc', seccion: 'quejas' }
    ] },
    { grupo: 'Riesgos', icono: 'alerta', reportes: [
      { id: 'riesgo-nivel', nombre: 'Riesgos por nivel', tipo: 'ESTADO', estado: 'LISTO', desc: 'Magnitud y banda de cada riesgo, antes y después de los controles.', fuente: 'listarRiesgosSgc', seccion: 'riesgos' },
      { id: 'riesgo-evolucion', nombre: 'Evolución del riesgo', tipo: 'TENDENCIA', estado: 'PENDIENTE', desc: 'Cómo cambió la valoración a lo largo del tiempo.', falta: 'La matriz guarda la valoración vigente, no su historia: requiere versionar cada revisión.' }
    ] },
    { grupo: 'Personas', icono: 'persona', reportes: [
      { id: 'per-competencia', nombre: 'Competencia (§7.2)', tipo: 'CUMPLIMIENTO', estado: 'LISTO', desc: 'Quién tiene descriptor vigente y evaluación registrada.', fuente: 'listarPersonasSgc', seccion: 'personas' },
      { id: 'per-induccion', nombre: 'Inducciones (§7.3)', tipo: 'CUMPLIMIENTO', estado: 'LISTO', desc: 'Avance de los cinco ítems de inducción, persona por persona.', fuente: 'listarPersonasSgc', seccion: 'personas' },
      { id: 'per-capacitacion', nombre: 'Capacitación', tipo: 'ESTADO', estado: 'LISTO', desc: 'Cursos realizados, asistencia y verificación de eficacia.', fuente: 'listarCapacitacionesSgc', seccion: 'capacitaciones' }
    ] },
    { grupo: 'Dirección', icono: 'estado', reportes: [
      { id: 'dir-revision', nombre: 'Revisión por la dirección', tipo: 'ESTADO', estado: 'LISTO', desc: 'Las entradas del §9.3 reunidas para el acta.', fuente: 'getResumenRevisionSgc', seccion: 'revision' },
      { id: 'dir-proveedores', nombre: 'Proveedores', tipo: 'ESTADO', estado: 'LISTO', desc: 'Evaluación y reevaluación de proveedores críticos (§8.4).', fuente: 'listarProveedoresSgc', seccion: 'proveedores' }
    ] },
    { grupo: 'Comparaciones', icono: 'lista', reportes: [
      { id: 'comp-periodo', nombre: 'Cobertura: cómo evoluciona', tipo: 'COMPARACION', estado: 'LISTO', desc: 'Cómo cambió el indicador interno semana a semana, y en qué capítulos.', fuente: 'listarCoberturaHistoricoSgc', filtros: [] }
    ] }
  ];
  var ACCION_REP = { 'cump-general': 'resumenTableroSgc', 'rank-capitulo': 'resumenTableroSgc', 'doc-estado': 'resumenTableroSgc', 'cump-clausula': 'listarMatrizCoberturaSgc', 'ind-tendencia': 'listarIndicadoresSgc', 'comp-periodo': 'listarCoberturaHistoricoSgc' };
  function registrarReportes() {
    if (!window.SigsoReportes || registrarReportes.hecho) return;
    SigsoReportes.registrar('calidad', { titulo: 'Centro de reportes del SGC', grupos: REPORTES,
      nota: 'Cada reporte declara de dónde sale su dato. Los marcados como "Requiere desarrollo" no se muestran vacíos ni con datos de ejemplo: se indica qué información habría que empezar a guardar.' });
    registrarReportes.hecho = true;
  }
  function mostrarReportes(abierto) {
    vista_ = 'reportes';
    if (abierto !== undefined) { rep_.abierto = abierto || null; rep_.filtros = {}; }
    registrarReportes();
    var t = ++turno_;
    var c = pagina(cabecera('Reportes', 'Evidencia para la auditoría: cada reporte sale de un dato real del sistema.', 'Reportes') + '<div class="sx2-card sx2-entra ca2-rep" style="--i:1"></div>');
    if (!c) return;
    var cont = c.querySelector('.ca2-rep');
    if (!rep_.abierto) {
      SigsoReportes.pintarCatalogo({ contenedor: cont, modulo: 'calidad',
        onAbrir: function (id) { publicar('reportes:' + id); mostrarReportes(id); },
        onIrASeccion: function (s) { if (window.SigsoCalidad) SigsoCalidad.irAItem(s); } });
      return;
    }
    var r = SigsoReportes.buscarReporte('calidad', rep_.abierto), accion = ACCION_REP[rep_.abierto];
    if (!r || !accion) { rep_.abierto = null; mostrarReportes(); return; }
    cont.innerHTML = U.esqueleto('tabla', 5);
    api(accion, {}).then(function (resp) {
      if (t !== turno_ || vista_ !== 'reportes') return;
      if (!resp || !resp.ok) { cont.innerHTML = U.vacio({ icono: 'alerta', titulo: 'No se pudo armar el reporte', texto: (resp && resp.message) || '' }); return; }
      pintarReporte(cont, r, resp.data);
    });
  }
  function publicar(item) { if (window.SigsoShell && SigsoShell.publicarItem) SigsoShell.publicarItem(item); }
  function pintarReporte(cont, r, data) {
    var opciones = {}, cuerpo = '';
    if (r.id === 'cump-general') cuerpo = cuerpoGeneral(data);
    else if (r.id === 'rank-capitulo') cuerpo = cuerpoRanking(data);
    else if (r.id === 'doc-estado') cuerpo = cuerpoDocumental(data);
    else if (r.id === 'cump-clausula') { opciones.estado = Object.keys(COB).map(function (k) { return { valor: k, texto: COB[k][0] }; }); cuerpo = cuerpoClausulas(data, rep_.filtros); }
    else if (r.id === 'ind-tendencia') cuerpo = cuerpoTendencia(data, rep_.filtros);
    else if (r.id === 'comp-periodo') cuerpo = cuerpoEvolucion(data);
    cont.innerHTML = SigsoReportes.barraAcciones({}) +
      SigsoReportes.cabeceraDocumento({ titulo: r.nombre, subtitulo: r.desc, modulo: 'Calidad — Sistema de Gestión ISO 9001', codigo: 'SIGSO-REP-' + String(r.id).toUpperCase(),
        generadoPor: PY.miNombre() || '', filtros: SigsoReportes.filtrosParaCabecera(r, opciones, rep_.filtros) }) +
      SigsoReportes.pintarFiltros(r, opciones, rep_.filtros) + cuerpo + SigsoReportes.pieDocumento();
    SigsoReportes.wireAcciones(cont, { nombreArchivo: 'sigso-calidad-' + r.id, onVolver: function () { publicar('reportes'); mostrarReportes(null); } });
    SigsoReportes.alAplicarFiltros(cont, function (v) { rep_.filtros = v; pintarReporte(cont, r, data); });
  }
  function vacioRep(t) { return '<div class="rp2-vacio">' + U.vacio({ icono: 'grafico', titulo: '', texto: t }) + '</div>'; }
  function nota(t) { return t ? '<p class="rp2-nota">' + U.ico('info', 16) + '<span>' + txt(t) + '</span></p>' : ''; }
  function cuerpoGeneral(data) {
    var s = data.salud || {}, c = data.conteos || {};
    return SigsoReportes.kpis([{ etiqueta: 'Indicador interno', valor: (s.pct || 0) + '%' }, { etiqueta: 'Cláusulas aplicables', valor: s.aplicables || 0 },
      { etiqueta: 'No conformidades abiertas', valor: c.nc_abiertas || 0, alerta: !!c.nc_abiertas }, { etiqueta: 'Documentos vigentes', valor: c.documentos_vigentes || 0 }]) + nota(s.aviso) +
      '<h3 class="rp2-sub">Por capítulo de la norma</h3>' + SigsoReportes.tabla([{ campo: 'capitulo', titulo: 'Capítulo' }, { campo: 'aplicables', titulo: 'Aplicables', alinear: 'derecha' },
        { campo: 'completo', titulo: 'Completas', alinear: 'derecha' }, { campo: 'parcial', titulo: 'Parciales', alinear: 'derecha' }, { campo: 'pct', titulo: 'Avance', alinear: 'derecha' }],
        (s.capitulos || []).map(function (x) { return { capitulo: x.numero + ' ' + x.titulo, aplicables: x.aplicables, completo: x.completo, parcial: x.parcial, pct: x.pct + '%' }; }));
  }
  function cuerpoRanking(data) {
    var caps = ((data.salud || {}).capitulos || []).slice().sort(function (a, b) { return b.pct - a.pct; });
    return SigsoReportes.ranking(caps.map(function (x) { return { etiqueta: x.numero + ' ' + x.titulo, valor: x.pct, texto: x.pct + '%', tono: x.pct >= 80 ? 'ok' : (x.pct >= 50 ? 'alerta' : 'critico') }; }), { vacio: 'Todavía no hay cláusulas evaluadas.' }) +
      '<h3 class="rp2-sub">Detalle</h3>' + SigsoReportes.tabla([{ campo: 'capitulo', titulo: 'Capítulo' }, { campo: 'pct', titulo: 'Avance', alinear: 'derecha' }, { campo: 'faltan', titulo: 'Cláusulas sin completar', alinear: 'derecha' }],
        caps.map(function (x) { return { capitulo: x.numero + ' ' + x.titulo, pct: x.pct + '%', faltan: (x.aplicables || 0) - (x.completo || 0) }; }));
  }
  function cuerpoDocumental(data) {
    var c = data.conteos || {}, al = (data.alertas || []).filter(function (a) { return /document/i.test(a.titulo || ''); });
    return SigsoReportes.kpis([{ etiqueta: 'Vigentes', valor: c.documentos_vigentes || 0 }, { etiqueta: 'De origen externo', valor: c.documentos_externos || 0 }]) +
      '<h3 class="rp2-sub">Alertas documentales</h3>' + SigsoReportes.tabla([{ campo: 'titulo', titulo: 'Alerta' }, { campo: 'severidad', titulo: 'Severidad' }, { campo: 'total', titulo: 'Cuántos', alinear: 'derecha' }], al, { vacio: 'Ningún documento vencido ni próximo a revisión.' });
  }
  function cuerpoClausulas(data, f) {
    var r = data.resumen || {}, l = (data.clausulas || []).filter(function (x) { return !f.estado || x.estado === f.estado; });
    return SigsoReportes.kpis([{ etiqueta: 'Aplicables', valor: r.aplicables || 0 }, { etiqueta: 'Completas', valor: r.completo || 0 }, { etiqueta: 'Parciales', valor: r.parcial || 0 }, { etiqueta: 'Faltantes', valor: r.faltante || 0, alerta: !!r.faltante }]) +
      SigsoReportes.tabla([{ campo: 'clausula', titulo: 'Cláusula' }, { campo: 'estado', titulo: 'Estado', html: true }, { campo: 'resumen', titulo: 'Qué hay hoy' }],
        l.map(function (x) { var e = COB[x.estado] || [x.estado, 'neutro']; return { clausula: x.codigo + ' ' + x.titulo, estado: U.badge(e[0], e[1]), resumen: x.resumen || '' }; }), { vacio: 'Ninguna cláusula en ese estado.' });
  }
  function cuerpoTendencia(data, f) {
    var inds = (data.indicadores || []).filter(function (i) { return (i.lecturas || []).length > 0; });
    if (!inds.length) return vacioRep('Todavía no hay lecturas registradas. Una tendencia necesita al menos dos períodos medidos: regístralas en Medición › Indicadores.');
    var el = inds.filter(function (i) { return i.indicador_id === f.indicador; })[0] || inds[0];
    var pts = (el.lecturas || []).slice().sort(function (a, b) { return String(a.periodo).localeCompare(String(b.periodo)); }).map(function (l) { return { etiqueta: l.periodo, valor: l.valor }; });
    return '<form class="rp2-filtros" id="rep-filtros"><label class="rp2-filtro"><span>Indicador</span><select class="sx2-select" name="indicador">' + inds.map(function (i) {
        return '<option value="' + U.esc(i.indicador_id) + '"' + (i.indicador_id === el.indicador_id ? ' selected' : '') + '>' + txt(i.codigo + ' — ' + i.nombre) + '</option>'; }).join('') + '</select></label>' +
      U.boton({ texto: 'Ver', icono: 'filtro', variante: 'primario', tipo: 'submit' }) + '</form>' +
      SigsoReportes.kpis([{ etiqueta: 'Períodos medidos', valor: pts.length }, { etiqueta: 'Última lectura', valor: pts.length ? pts[pts.length - 1].valor : '—' },
        { etiqueta: 'Meta', valor: el.meta_texto || el.meta_valor }, { etiqueta: 'Pendientes de medir', valor: el.lecturas_pendientes || 0, alerta: !!el.lecturas_pendientes }]) +
      SigsoReportes.tendencia(pts, { meta: el.meta_valor, titulo: 'Evolución de ' + el.codigo }) +
      SigsoReportes.tabla([{ campo: 'periodo', titulo: 'Período' }, { campo: 'valor', titulo: 'Valor', alinear: 'derecha' }, { campo: 'veredicto', titulo: 'Resultado' }, { campo: 'observaciones', titulo: 'Observaciones' }],
        (el.lecturas || []).slice().sort(function (a, b) { return String(b.periodo).localeCompare(String(a.periodo)); }));
  }
  function cuerpoEvolucion(data) {
    var fotos = (data && data.fotos) || [], actual = (data && data.actual) || {};
    if (!fotos.length) {
      return SigsoReportes.kpis([{ etiqueta: 'Indicador interno hoy', valor: (actual.pct_listo || 0) + '%' }]) +
        (data && data.hoja_lista === false ? nota('Falta un paso de instalación: la tabla del histórico de cobertura no existe, así que la foto semanal no se guarda.') : '') +
        vacioRep('Todavía no hay ninguna foto archivada. Se guarda una por semana; a partir de la segunda se ve la evolución.');
    }
    var ult = fotos[fotos.length - 1], prev = fotos.length > 1 ? fotos[fotos.length - 2] : null, delta = prev ? ult.pct_listo - prev.pct_listo : null;
    var k = [{ etiqueta: 'Indicador interno hoy', valor: (actual.pct_listo || 0) + '%' }, { etiqueta: 'Última foto (' + ult.periodo + ')', valor: ult.pct_listo + '%' }];
    if (delta !== null) k.push({ etiqueta: 'Variación vs. semana anterior', valor: (delta > 0 ? '+' : (delta < 0 ? '−' : '=')) + Math.abs(delta) + ' pts', alerta: delta < 0 });
    k.push({ etiqueta: 'Semanas registradas', valor: fotos.length });
    var porNum = {};
    if (prev) (prev.capitulos || []).forEach(function (c) { porNum[c.numero] = c.pct; });
    return SigsoReportes.kpis(k) + nota(data && data.aviso) +
      SigsoReportes.tendencia(fotos.map(function (f) { return { etiqueta: f.periodo, valor: f.pct_listo }; }), { vacio: 'Hace falta una segunda foto para dibujar la evolución.' }) +
      (prev ? SigsoReportes.comparacion((ult.capitulos || []).map(function (c) { return { etiqueta: 'Capítulo ' + c.numero, previo: porNum[c.numero] || 0, actual: c.pct }; }),
        { dimension: 'Capítulo de la norma', etiquetaPrevio: prev.periodo, etiquetaActual: ult.periodo }) : '');
  }

  // =========================================================================================
  // Accesos
  // =========================================================================================
  var ACC_SUB = [{ id: 'personas', texto: 'Personas y roles', icono: 'persona' }, { id: 'matriz', texto: 'Matriz de distribución', icono: 'rejilla' }, { id: 'confidenciales', texto: 'Confidenciales', icono: 'candado' }];
  var ACC_ACCION = { personas: 'listarAccesosSgc', matriz: 'getMatrizDistribucionSgc', confidenciales: 'getDocumentosConfidencialesSgc' };
  function nivelRol(clave) { if (clave === 'ENCARGADO_SGC') return 'gobierno'; if (['DIRECCION', 'GERENCIA_ADM', 'AUDITOR_EXTERNO'].indexOf(clave) !== -1) return 'lectura'; return 'operativo'; }
  function rolTxt(clave, roles) { if (!clave) return 'Sin rol · solo documentos generales'; var r = (roles || []).filter(function (x) { return x.clave === clave; })[0]; return r ? r.etiqueta : clave; }
  function diasA(v) { var k = iso(v); if (!k) return null; return Math.round((Date.parse(k + 'T12:00:00Z') - Date.parse(PY.hoyClave() + 'T12:00:00Z')) / 86400000); }
  function mostrarAccesos(silencioso) {
    vista_ = 'accesos';
    var t = ++turno_, sub = acc_.sub;
    if (!silencioso || !acc_.datos[sub]) pagina(cabeceraAcc() + segAcc() + U.esqueleto('tarjetas', 3));
    api(ACC_ACCION[sub], {}).then(function (r) {
      if (t !== turno_ || vista_ !== 'accesos' || sub !== acc_.sub || !C().ocupa('accesos')) return;
      if (!r || !r.ok) { pagina(cabeceraAcc() + segAcc() + U.card({ i: 2, cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || '' }) })); return; }
      acc_.datos[sub] = r.data;
      pintarAccesos(!!silencioso);
      if (sub === 'personas') {
        var cs = ((r.data.cuentas) || []).map(function (c) { return c.email; });
        U.precargarFotos(cs).then(function () { if (t === turno_) pintarAccesos(true); });
      }
    });
  }
  function cabeceraAcc() { return cabecera('Accesos al SGC', 'Qué ve cada persona en Calidad. El rol decide secciones y alcance; los confidenciales se restringen documento por documento. Panel exclusivo del administrador.', 'Administración'); }
  function segAcc() { return '<div class="sx2-entra av2-subnav" style="--i:1">' + U.segmento(ACC_SUB, acc_.sub, 'js-ca2-acc-sub') + '</div>'; }
  function pintarAccesos(silencioso) {
    if (vista_ !== 'accesos') return;
    var d = acc_.datos[acc_.sub];
    if (!d) return;
    var cuerpo;
    if (acc_.sub === 'personas') cuerpo = cuerpoPersonas(d);
    else if (acc_.sub === 'matriz') cuerpo = cuerpoMatriz(d);
    else cuerpo = cuerpoConfidenciales(d);
    pagina(cabeceraAcc() + segAcc() + cuerpo, silencioso);
  }
  function cuerpoPersonas(d) {
    var cuentas = d.cuentas || [], roles = d.roles || [], enr = d.enrolamiento || {}, sinCuenta = enr.personas_sin_cuenta || [], areas = {};
    (d.areas || []).forEach(function (a) { areas[a.area_id] = a.nombre; });
    var porVencer = function (c) { var x = diasA(c.vigencia_hasta); return x !== null && x <= 30; };
    var n = { conRol: cuentas.filter(function (c) { return !!c.rol_sgc; }).length, porVencer: cuentas.filter(porVencer).length };
    var g = acc_.grupo, q = norm(acc_.q);
    var kpi = function (i, et, v, ico, tono, f) { return U.kpi({ i: i + 2, etiqueta: et, valor: v, icono: ico, tono: tono, filtro: f, activo: g === f }); };
    var html = '<div class="sx2-fila-kpis">' + kpi(0, 'Con rol asignado', n.conRol, 'check', 'ok', 'con-rol') + kpi(1, 'Sin rol', cuentas.length - n.conRol, 'persona', 'neutro', 'sin-rol') +
      kpi(2, 'Por vencer', n.porVencer, 'reloj', n.porVencer ? 'alerta' : 'neutro', 'por-vencer') + kpi(3, 'Sin cuenta', sinCuenta.length, 'alerta', sinCuenta.length ? 'alerta' : 'neutro', 'sin-cuenta') + '</div>' +
      ((enr.roles_sin_cuenta || []).length ? aviso('info', 'info', enr.roles_sin_cuenta.length + ' rol(es) asignado(s) a un correo sin cuenta activa (residuo a limpiar): ' + txt(enr.roles_sin_cuenta.map(function (r) { return r.email; }).join(', ')) + '.') : '') +
      '<details class="cv2-detalle sx2-entra"><summary>Qué ve cada rol</summary><ul class="ca2-roles">' + roles.map(function (r) { var nv = NIVEL[nivelRol(r.clave)]; return '<li>' + U.badge(r.etiqueta, nv[1]) + '<span>' + txt(r.descripcion) + '</span></li>'; }).join('') + '</ul></details>' +
      '<div class="sx2-card sx2-py-herramientas sx2-entra"><div class="sx2-barra-filtros"><label class="sx2-buscar">' + U.ico('lupa', 16) + '<input class="sx2-input js-ca2-q" type="search" placeholder="Buscar por nombre o correo…" value="' + U.esc(acc_.q) + '"></label>' +
        '<select class="sx2-select js-ca2-rol" aria-label="Rol"><option value="">Todos los roles</option><option value="rol:__sin"' + (g === 'rol:__sin' ? ' selected' : '') + '>Sin rol</option>' +
        roles.map(function (r) { return '<option value="rol:' + U.esc(r.clave) + '"' + (g === 'rol:' + r.clave ? ' selected' : '') + '>' + txt(r.etiqueta) + '</option>'; }).join('') + '</select>' +
        (g ? U.chip({ texto: 'Quitar filtro', icono: 'equis', clase: 'js-ca2-sinfiltro' }) : '') + '</div></div>';
    if (g === 'sin-cuenta') {
      return html + (sinCuenta.length ? '<p class="mj2-ayuda">Personas en el alcance del SGC sin cuenta para entrar. Créales una en Administración › Cuentas plataforma para asignarles un rol.</p><div class="ca2-cuentas">' +
        sinCuenta.map(function (p) { return '<div class="sx2-card ca2-cuenta">' + U.avatar(PY.persona(p.email || p.nombre, p.nombre), 'sm') + '<span class="sx2-apilado" style="gap:2px;flex:1;min-width:0"><strong>' + txt(p.nombre) + '</strong><small class="sx2-tenue">' + txt(p.email || 'sin correo') + '</small></span>' + U.badge('Sin cuenta', 'alerta', true) + '</div>'; }).join('') + '</div>'
        : aviso('ok', 'check', 'Todas las personas del alcance del SGC ya tienen cuenta.'));
    }
    var l = cuentas.filter(function (c) {
      if (g === 'con-rol' && !c.rol_sgc) return false;
      if (g === 'sin-rol' && c.rol_sgc) return false;
      if (g === 'por-vencer' && !porVencer(c)) return false;
      if (g.indexOf('rol:') === 0) { var k = g.slice(4); if (k === '__sin' ? !!c.rol_sgc : c.rol_sgc !== k) return false; }
      return !q || norm(c.nombre + ' ' + c.email).indexOf(q) !== -1;
    });
    return html + (l.length ? '<div class="ca2-cuentas">' + l.map(function (c, i) {
      var nv = NIVEL[nivelRol(c.rol_sgc)], dd = diasA(c.vigencia_hasta);
      return '<div class="sx2-card ca2-cuenta sx2-entra sx2-tono-' + nv[1] + '" style="--i:' + Math.min(i + 6, 12) + '">' + U.avatar(PY.persona(c.email, c.nombre), 'sm') +
        '<span class="sx2-apilado" style="gap:4px;flex:1;min-width:0"><strong class="sx2-cortar">' + txt(c.nombre) + '</strong><small class="sx2-tenue sx2-cortar">' + txt(c.email) + '</small>' +
          '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + U.badge(rolTxt(c.rol_sgc, d.roles), c.rol_sgc ? nv[1] : 'neutro') + (c.area_id ? U.badge(areas[c.area_id] || c.area_id, 'neutro', true) : '') +
            (dd !== null ? U.badge((dd < 0 ? 'Venció ' : 'Vence ') + fecha(c.vigencia_hasta), dd < 0 ? 'critico' : (dd <= 30 ? 'alerta' : 'neutro'), true) : '') + '</span></span>' +
        '<span class="ca2-cuenta__acc">' + U.boton({ texto: c.rol_sgc ? 'Cambiar rol' : 'Asignar rol', sm: true, clase: 'js-ca2-rol-editar', datos: { email: c.email } }) +
          U.boton({ texto: '¿Qué ve?', icono: 'ojo', sm: true, variante: 'fantasma', clase: 'js-ca2-previa', datos: { email: c.email } }) +
          (c.rol_id ? U.boton({ soloIcono: true, icono: 'basura', sm: true, variante: 'fantasma', titulo: 'Quitar rol', clase: 'js-ca2-rol-quitar', datos: { id: c.rol_id } }) : '') + '</span></div>';
    }).join('') + '</div>' : U.card({ i: 6, cuerpo: U.vacio({ icono: 'lupa', titulo: 'Nadie con este filtro', texto: '' }) }));
  }
  function cuerpoMatriz(d) {
    var docs = d.documentos || [], per = d.personas || [];
    if (!docs.length || !per.length) return aviso('info', 'info', 'Aún no hay documentos vigentes o personal con cuenta para mostrar en la matriz.');
    return '<p class="mj2-ayuda sx2-entra">Quién puede ver y quién ya confirmó cada documento vigente: la evidencia de distribución para la auditoría (§7.5.3).</p>' +
      '<div class="gv2-ley sx2-entra">' + Object.keys(MATRIZ).map(function (k) { return '<span><i class="ca2-celda sx2-tono-' + MATRIZ[k][1] + '">' + MATRIZ[k][0] + '</i>' + MATRIZ[k][2] + '</span>'; }).join('') + '</div>' +
      '<section class="sx2-card sx2-card--sin-relleno sx2-entra"><div class="sx2-tabla-wrap ca2-matriz-wrap"><table class="sx2-tabla ca2-matriz"><thead><tr><th>Persona</th>' + docs.map(function (x) { return '<th title="' + U.esc(x.nombre) + '"><span>' + txt(x.codigo) + '</span></th>'; }).join('') + '</tr></thead><tbody>' +
      per.map(function (p) {
        return '<tr><th scope="row">' + txt(p.nombre) + '</th>' + (p.celdas || []).map(function (c) { var m = MATRIZ[c.estado] || ['', 'neutro', '']; return '<td class="ca2-celda sx2-tono-' + m[1] + '" title="' + U.esc(m[2]) + '">' + m[0] + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div></section>';
  }
  function cuerpoConfidenciales(docs) {
    docs = docs || [];
    if (!docs.length) return aviso('info', 'candado', 'No hay documentos con visibilidad restringida a personas específicas.');
    return '<p class="mj2-ayuda sx2-entra">Documentos de acceso restringido a personas específicas, y quién está en cada lista. Se cambia editando el documento.</p><div class="si2-partes">' + docs.map(function (x, i) {
      return '<section class="sx2-card si2-parte sx2-entra" style="--i:' + Math.min(i + 3, 12) + '"><div class="sx2-flex" style="gap:8px;align-items:center;flex-wrap:wrap"><code class="mj2-cod">' + txt(x.codigo) + '</code><strong style="flex:1">' + txt(x.nombre) + '</strong>' +
        (x.estado === 'OBSOLETO' ? U.badge('Obsoleto', 'neutro', true) : '') + U.badge((x.destinatarios || []).length + ' con acceso', 'info', true) + '</div>' +
        ((x.destinatarios || []).length ? '<ul class="ca2-dest">' + x.destinatarios.map(function (y) { return '<li>' + U.avatar(PY.persona(y.email, y.nombre), 'xs') + '<span>' + txt(y.nombre) + ' <small class="sx2-tenue">' + txt(y.email) + '</small></span></li>'; }).join('') + '</ul>' : '<p class="mj2-ayuda">Sin destinatarios asignados todavía.</p>') + '</section>';
    }).join('') + '</div>';
  }
  function formRol(c) {
    var d = acc_.datos.personas;
    U.formulario({ titulo: 'Rol de ' + c.nombre, subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + txt(c.email) + '</span>', boton: 'Guardar',
      campos: U.campo('Rol en el SGC', '<select class="sx2-select" name="rol_sgc"><option value="">Sin rol (solo documentos generales)</option>' + (d.roles || []).map(function (r) { return '<option value="' + U.esc(r.clave) + '"' + (r.clave === c.rol_sgc ? ' selected' : '') + '>' + txt(r.etiqueta) + '</option>'; }).join('') + '</select>') +
        '<div class="js-ca2-rol-desc mj2-ayuda"></div>' +
        U.campo('Área (define qué documentos "de área" ve)', '<select class="sx2-select" name="area_id"><option value="">Sin área</option>' + (d.areas || []).map(function (a) { return '<option value="' + U.esc(a.area_id) + '"' + (a.area_id === c.area_id ? ' selected' : '') + '>' + txt(a.nombre) + '</option>'; }).join('') + '</select>') +
        '<div class="js-ca2-vig">' + U.campo('Vence el (solo auditor externo, opcional)', input('vigencia_hasta', iso(c.vigencia_hasta), ' type="date" min="' + PY.hoyClave() + '"')) + '</div>',
      alMontar: function (form) {
        var s = form.querySelector('[name=rol_sgc]'), desc = form.querySelector('.js-ca2-rol-desc'), vig = form.querySelector('.js-ca2-vig');
        var act = function () { var r = (d.roles || []).filter(function (x) { return x.clave === s.value; })[0]; desc.textContent = r ? r.descripcion : 'Verá solo los documentos de acceso general y su propia ficha.'; vig.hidden = s.value !== 'AUDITOR_EXTERNO'; };
        s.addEventListener('change', act); act();
      },
      preparar: function (x) { return x; },
      enviar: function (x) {
        if (!x.rol_sgc) return c.rol_id ? api('gestionarRolSgc', { accion: 'quitar', rol_id: c.rol_id }) : Promise.resolve({ ok: true });
        return api('gestionarRolSgc', { usuario_email: c.email, rol_sgc: x.rol_sgc, area_id: x.area_id, vigencia_hasta: x.rol_sgc === 'AUDITOR_EXTERNO' ? x.vigencia_hasta : '' });
      },
      aviso: 'Acceso actualizado.', listo: function () { mostrarAccesos(true); } });
  }
  function previa(email) {
    var dr = U.drawer({ titulo: 'Qué vería ' + email, cuerpo: U.esqueleto('tabla', 5) });
    dr.el.classList.add('sx2-drawer--ancho');
    api('previsualizarAccesoSgc', { email: email }).then(function (r) {
      if (!r || !r.ok) { dr.cuerpo(U.vacio({ icono: 'alerta', titulo: 'No se pudo previsualizar', texto: (r && r.message) || '' })); return; }
      var d = r.data, secc = d.secciones || {};
      dr.cuerpo((d.acceso_amplio_sistema ? aviso('alerta', 'info', 'Esta cuenta además es ' + (d.rol_sistema === 'ADM' ? 'Administradora' : 'Gerencia') + ' de SIGSO: en la práctica ve TODO el SGC, más allá de esta previsualización.') : '') +
        '<dl class="sx2-dato mj2-datos">' + dato('Rol en el SGC', txt(rolTxt(d.rol_sgc, (acc_.datos.personas || {}).roles))) + dato('Fichas de personas', txt(d.personas_scope)) + dato('Documentos por confirmar', String(d.pendientes_acuse || 0)) + '</dl>' +
        '<h3 class="mj2-sub">Secciones que puede abrir</h3><div class="si2-chips">' + Object.keys(SECCION_ACCESO).filter(function (k) { return secc[k] === true; }).map(function (k) { return '<span class="si2-chip">' + SECCION_ACCESO[k] + '</span>'; }).join('') + '</div>' +
        '<h3 class="mj2-sub">Documentos que vería (' + (d.total_documentos || 0) + ')</h3>' + ((d.documentos || []).length ? '<ul class="ca2-dest">' + d.documentos.map(function (x) {
          return '<li><code class="mj2-cod">' + txt(x.codigo) + '</code><span style="flex:1">' + txt(x.nombre) + '</span>' + (x.confidencial ? U.badge('Confidencial', 'info', true) : '') +
            (x.requiere_acuse ? (x.confirmado ? U.badge('Confirmado', 'ok', true) : U.badge('Sin confirmar', 'alerta', true)) : '') + '</li>';
        }).join('') + '</ul>' : '<p class="mj2-ayuda">Ningún documento.</p>') +
        '<h3 class="mj2-sub">Últimas descargas</h3>' + ((d.descargas_recientes || []).length ? '<ul class="ca2-dest">' + d.descargas_recientes.map(function (l) { return '<li><span class="sx2-tenue" style="white-space:nowrap">' + txt(fecha(l.timestamp)) + '</span><span>' + txt(l.detalle) + '</span></li>'; }).join('') + '</ul>' : '<p class="mj2-ayuda">Sin descargas registradas.</p>'));
    });
  }

  // =========================================================================================
  // Formularios de Documentos
  // =========================================================================================
  function docsRefrescar(id) {
    if (window.SigsoCalidad && SigsoCalidad.invalidar) SigsoCalidad.invalidar();
    if (window.SigsoCalidadDocsV2) { SigsoCalidadDocsV2.refrescar(); if (id) SigsoCalidadDocsV2.abrir(id); }
  }
  function archivoCampo(nombre, etiqueta, ayuda, req) { return U.campo(etiqueta, '<input class="sx2-input" type="file" name="' + nombre + '" accept=".pdf,.doc,.docx,.xls,.xlsx"' + (req ? ' required' : '') + '>', ayuda || 'PDF, Word o Excel · máx. 10 MB.'); }
  function leerArchivo(form, nombre) {
    var f = form.querySelector('[name="' + nombre + '"]').files[0];
    if (!f) return Promise.resolve(null);
    if (f.size > 10 * 1024 * 1024) return Promise.reject(new Error('El archivo pesa más de 10 MB.'));
    return U.leerBase64(f).then(function (b64) { return { b64: b64, nombre: f.name }; });
  }
  function enlacesTexto(l) { return (l || []).map(function (e) { return e && e.titulo ? e.titulo + ' | ' + e.url : (e && e.url ? e.url : ''); }).filter(Boolean).join('\n'); }
  function leerEnlaces(t) { return String(t || '').split(/\n+/).map(function (l) { l = l.trim(); if (!l) return null; var i = l.indexOf('|'); return i !== -1 ? { titulo: l.slice(0, i).trim(), url: l.slice(i + 1).trim() } : { titulo: '', url: l }; }).filter(Boolean); }
  function camposComunes(d, destinatarios) {
    d = d || {};
    return fila2(U.campo('Código', input('codigo', d.codigo, ' required placeholder="Ej.: DOC-01, PRO-07, FO-PRO-02-01"' + (d.documento_id ? ' readonly' : ''))), U.campo('Nombre', input('nombre', d.nombre, ' required placeholder="Ej.: Manual de Calidad"'))) +
      U.campo('Descripción (opcional)', area('descripcion', d.descripcion, 2)) +
      fila2(U.campo('Tipo', select('tipo', TIPOS, d.tipo || 'DOC')), U.campo('Área (opcional)', input('area_id', d.area_id, ' placeholder="Ej.: PREVENCION"'))) +
      U.campo('¿Quién puede verlo?', select('visibilidad', VISIBILIDAD, d.visibilidad || 'TODOS')) +
      '<div class="js-ca2-dest">' + U.campo('Correos autorizados', area('destinatarios', (destinatarios || []).join('\n'), 3), 'Uno por línea. Solo aplica con "Personas específicas".') + '</div>' +
      '<div class="sx2-form__fila">' + U.campo('Elaborado por', input('elaborado_por', d.elaborado_por)) + U.campo('Revisado por', input('revisado_por', d.revisado_por)) + U.campo('Aprobado por', input('aprobado_por', d.aprobado_por)) + '</div>' +
      U.campo('Enlaces de consulta (opcional)', area('enlaces', enlacesTexto(d.enlaces), 2), 'Uno por línea: «Título | https://…» o solo la URL. No reemplazan al archivo controlado.') +
      '<label class="nv2-check"><input type="checkbox" name="requiere_acuse"' + (d.documento_id && d.requiere_acuse === false ? '' : ' checked') + '> Exigir confirmación de lectura ("Enterado")</label>' +
      U.campo('Plazo para confirmar (opcional)', input('fecha_limite_acuse', iso(d.fecha_limite_acuse), ' type="date"'));
  }
  function montarComunes(form) {
    var vis = form.querySelector('[name=visibilidad]'), dest = form.querySelector('.js-ca2-dest');
    var act = function () { dest.hidden = vis.value !== 'SELECCION'; };
    vis.addEventListener('change', act); act();
  }
  function prepararComunes(x, form) {
    if (!x.codigo || !x.nombre) return 'Completa código y nombre.';
    var dest = x.visibilidad === 'SELECCION' ? lista(x.destinatarios) : [];
    if (x.visibilidad === 'SELECCION' && !dest.length) return 'Indica al menos un correo autorizado.';
    var mal = dest.filter(function (e) { return !esCorreo(e); });
    if (mal.length) return 'Revisa estos correos: ' + mal.join(', ');
    var enl = leerEnlaces(x.enlaces), malE = enl.filter(function (e) { return !/^https?:\/\//i.test(e.url); });
    if (malE.length) return 'Los enlaces deben empezar con http:// o https://';
    x.destinatarios = dest; x.enlaces = enl; x.requiere_acuse = form.querySelector('[name=requiere_acuse]').checked;
    return x;
  }
  function paso(o) {
    U.formulario({ titulo: o.titulo, subtitulo: o.sub ? '<span class="sx2-tenue" style="font-size:.8125rem">' + o.sub + '</span>' : '', boton: o.boton || 'Guardar', ocupado: o.ocupado || 'Guardando…', ancho: o.ancho,
      campos: o.campos, alMontar: o.alMontar, preparar: o.preparar,
      enviar: function (x, form) { return Promise.resolve(o.enviar(x, form)).catch(function (e) { return { ok: false, message: C().errorSubida(e) }; }); },
      aviso: o.aviso, listo: o.listo });
  }
  var FORMS = {
    nuevo: function () {
      paso({ titulo: 'Cargar documento del SGC', boton: 'Cargar documento', ocupado: 'Subiendo…', ancho: true, sub: 'Sube el archivo que ya tienes y registra su control documental.',
        campos: camposComunes(null) + '<div class="js-ca2-interno">' + fila2(U.campo('Versión', input('version_vigente', 'v01')), U.campo('Vigente desde', input('fecha_vigencia', PY.hoyClave(), ' type="date"'))) + '</div>' +
          '<div class="js-ca2-externo">' + fila2(U.campo('Emisor', input('emisor', '', ' placeholder="Ej.: ISO, Ministerio del Trabajo"')), U.campo('Clase', input('clase_externa', '', ' placeholder="Ej.: Norma, Decreto, Ley, Código"'))) + '</div>' +
          archivoCampo('archivo', 'Archivo', 'Obligatorio salvo para un documento externo (nadie sube el texto de una ley). PDF, Word o Excel · máx. 10 MB.'),
        alMontar: function (form) {
          montarComunes(form);
          var tipo = form.querySelector('[name=tipo]'), ext = form.querySelector('.js-ca2-externo'), int = form.querySelector('.js-ca2-interno');
          var act = function () { var e = tipo.value === 'EXTERNO'; ext.hidden = !e; int.hidden = e; };
          tipo.addEventListener('change', act); act();
        },
        preparar: function (x, form) {
          var e = x.tipo === 'EXTERNO';
          if (!e && !form.querySelector('[name=archivo]').files[0]) return 'Selecciona el archivo del documento.';
          if (!e && (!x.version_vigente || !x.fecha_vigencia)) return 'Indica versión y fecha de vigencia.';
          return prepararComunes(x, form);
        },
        enviar: function (x, form) {
          return leerArchivo(form, 'archivo').then(function (a) {
            x.nombre_archivo = a ? a.nombre : ''; x.contenido_base64 = a ? a.b64 : '';
            delete x.archivo;
            return api('crearDocumentoSgc', x);
          });
        },
        aviso: 'Documento cargado.', listo: function (r) { docsRefrescar(r && r.data && r.data.documento_id); } });
    },
    version: function (d) {
      paso({ titulo: 'Nueva versión de ' + d.codigo, boton: 'Subir versión', ocupado: 'Subiendo…', sub: 'La versión ' + txt(d.version_vigente) + ' quedará archivada (no se elimina) y esta pasa a ser la vigente.',
        campos: fila2(U.campo('Nueva versión', input('version', '', ' required placeholder="Ej.: v02"')), U.campo('Vigente desde', input('fecha_vigencia', PY.hoyClave(), ' type="date" required'))) +
          U.campo('Descripción del cambio', area('cambios', '', 3, ' required placeholder="¿Qué cambió respecto de la versión anterior?"')) + archivoCampo('archivo', 'Archivo de la nueva versión', '', true),
        preparar: function (x, form) {
          if (!x.version || String(x.version).toLowerCase() === String(d.version_vigente || '').toLowerCase()) return 'Indica una versión distinta de la vigente.';
          if ((x.cambios || '').length < 5) return 'Describe el cambio.';
          return form.querySelector('[name=archivo]').files[0] ? x : 'Selecciona el archivo.';
        },
        enviar: function (x, form) { return leerArchivo(form, 'archivo').then(function (a) { return api('nuevaVersionDocumentoSgc', { documento_id: d.documento_id, version: x.version, fecha_vigencia: x.fecha_vigencia, cambios: x.cambios, nombre_archivo: a.nombre, contenido_base64: a.b64 }); }); },
        aviso: 'Nueva versión vigente.', listo: function () { docsRefrescar(d.documento_id); } });
    },
    reemplazar: function (d) {
      paso({ titulo: 'Reemplazar archivo de ' + d.codigo, boton: 'Reemplazar', ocupado: 'Subiendo…', sub: 'No crea una versión nueva: sigue siendo ' + txt(d.version_vigente) + '; solo cambia el archivo adjunto.',
        campos: archivoCampo('archivo', 'Archivo', '', true),
        preparar: function (x, form) { return form.querySelector('[name=archivo]').files[0] ? x : 'Selecciona el archivo.'; },
        enviar: function (x, form) { return leerArchivo(form, 'archivo').then(function (a) { return api('reemplazarArchivoVersionVigenteSgc', { documento_id: d.documento_id, nombre_archivo: a.nombre, contenido_base64: a.b64 }); }); },
        aviso: 'Archivo reemplazado.', listo: function () { docsRefrescar(d.documento_id); } });
    },
    editar: function (d, destinatarios) {
      paso({ titulo: 'Editar ' + d.codigo, ancho: true,
        campos: camposComunes(d, destinatarios) + U.campo('Vigente desde', input('fecha_vigencia', iso(d.fecha_vigencia), ' type="date"')) +
          archivoCampo('archivo', d.archivo_id ? 'Reemplazar el archivo (opcional)' : 'Adjuntar el archivo', d.archivo_id ? 'Actual: ' + (d.archivo_nombre || 'sin nombre') + '. Déjalo vacío para no cambiarlo. Si alguien ya confirmó esta versión, usa "Nueva versión".' : 'Este documento todavía no tiene archivo: sin él, el personal no puede consultarlo.'),
        alMontar: montarComunes,
        preparar: function (x, form) { return prepararComunes(x, form); },
        enviar: function (x, form) {
          return leerArchivo(form, 'archivo').then(function (a) {
            var datos = { documento_id: d.documento_id, nombre: x.nombre, descripcion: x.descripcion, tipo: x.tipo, area_id: x.area_id, visibilidad: x.visibilidad, destinatarios: x.destinatarios, enlaces: x.enlaces,
              fecha_vigencia: x.fecha_vigencia, elaborado_por: x.elaborado_por, revisado_por: x.revisado_por, aprobado_por: x.aprobado_por, requiere_acuse: x.requiere_acuse, fecha_limite_acuse: x.fecha_limite_acuse };
            if (a) { datos.nombre_archivo = a.nombre; datos.contenido_base64 = a.b64; }
            return api('actualizarDocumentoSgc', datos);
          });
        },
        aviso: 'Cambios guardados.', listo: function () { docsRefrescar(d.documento_id); } });
    },
    clausulas: function (d, catalogo) {
      var sel = {};
      (d.clausulas_iso || []).forEach(function (c) { sel[c] = true; });
      paso({ titulo: 'Cláusulas ISO que sustenta ' + d.codigo, ancho: true,
        sub: 'Marca las cláusulas para las que este documento es evidencia. Solo los documentos etiquetados aquí aparecen en la Cobertura ISO: el sistema no lo adivina por el nombre.',
        campos: '<div class="mj2-clausulas" style="max-height:none">' + (catalogo || []).map(function (c) { return '<label class="nv2-check"><input type="checkbox" name="cl_' + U.esc(c.codigo) + '"' + (sel[c.codigo] ? ' checked' : '') + '> <b>' + txt(c.codigo) + '</b> ' + txt(c.titulo) + '</label>'; }).join('') + '</div>',
        preparar: function (x, form) { return { clausulas_iso: (catalogo || []).filter(function (c) { var el = form.querySelector('[name="cl_' + c.codigo + '"]'); return el && el.checked; }).map(function (c) { return c.codigo; }) }; },
        enviar: function (x) { return api('actualizarDocumentoSgc', { documento_id: d.documento_id, clausulas_iso: x.clausulas_iso }); },
        aviso: function (r) { return 'Cláusulas guardadas.'; }, listo: function () { docsRefrescar(d.documento_id); } });
    }
  };

  // --- Eventos ------------------------------------------------------------------------------
  function mio() { var c = document.getElementById('calidad-v2'); return !!c && (c.getAttribute('data-vista') === 'reportes' || c.getAttribute('data-vista') === 'accesos'); }
  document.addEventListener('click', function (ev) {
    var raiz = document.getElementById('calidad-v2');
    if (!raiz || !raiz.contains(ev.target) || !mio()) return;
    var t = ev.target, b;
    if (t.closest('.js-ca2-recargar')) { if (vista_ === 'reportes') mostrarReportes(); else mostrarAccesos(true); return; }
    if ((b = t.closest('.js-ca2-acc-sub'))) { acc_.sub = b.getAttribute('data-id'); acc_.grupo = ''; mostrarAccesos(false); return; }
    if ((b = t.closest('.sx2-kpi--clic')) && vista_ === 'accesos') { var f = b.getAttribute('data-filtro'); acc_.grupo = acc_.grupo === f ? '' : f; pintarAccesos(true); return; }
    if (t.closest('.js-ca2-sinfiltro')) { acc_.grupo = ''; pintarAccesos(true); return; }
    if ((b = t.closest('.js-ca2-rol-editar'))) { var c = (acc_.datos.personas.cuentas || []).filter(function (x) { return x.email === b.getAttribute('data-email'); })[0]; if (c) formRol(c); return; }
    if ((b = t.closest('.js-ca2-previa'))) { previa(b.getAttribute('data-email')); return; }
    if ((b = t.closest('.js-ca2-rol-quitar'))) {
      var id = b.getAttribute('data-id');
      U.confirmar({ titulo: '¿Quitar el acceso?', texto: 'La persona vuelve a ver solo los documentos de acceso general. No se borra nada de su ficha.', boton: 'Quitar', peligro: true }).then(function (ok) {
        if (ok) api('gestionarRolSgc', { accion: 'quitar', rol_id: id }).then(function (r) { if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo quitar.', 'error'); return; } PY.aviso('Acceso quitado.', 'exito'); mostrarAccesos(true); });
      });
    }
  });
  document.addEventListener('change', function (ev) {
    if (ev.target.classList && ev.target.classList.contains('js-ca2-rol') && mio()) { acc_.grupo = ev.target.value; pintarAccesos(true); }
  });
  var tq_ = null;
  document.addEventListener('input', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('js-ca2-q') || !mio()) return;
    var v = ev.target.value;
    clearTimeout(tq_);
    tq_ = setTimeout(function () { acc_.q = v; pintarAccesos(true); }, 160);
  });

  window.SigsoCalidadAdminV2 = {
    mostrarReportes: function (abierto) { mostrarReportes(abierto === undefined ? null : abierto); },
    mostrarAccesos: function () { vista_ = 'accesos'; mostrarAccesos(!!acc_.datos[acc_.sub] && C().ocupa('accesos')); },
    formulario: function (nombre, d, extra) { if (FORMS[nombre]) FORMS[nombre](d, extra); }
  };
})();
