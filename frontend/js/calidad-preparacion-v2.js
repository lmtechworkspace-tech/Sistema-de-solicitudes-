/**
 * calidad-preparacion-v2.js — Calidad › «¿Listos para certificar?» (Plan de
 * control y certificación, P6; backend preparacionSgc.js).
 *
 * Una ronda de evaluación con cuatro pestañas:
 *  - Resumen: la recomendación global y la cuenta regresiva a la auditoría;
 *    una tarjeta por área con su veredicto, sus números y sus brechas (cada
 *    brecha se vuelve tarea con responsable y fecha); y «Lo que dice el
 *    sistema» (salud del SGC por capítulo y sus alertas).
 *  - Entrevistas: la entrevista guiada de 8 preguntas por responsable
 *    (respuesta, evidencia vista, puntaje 0-3, autoevaluación).
 *  - Muestras: los registros que SIGSO sorteó en las matrices de cada área,
 *    para anotar quién hizo, revisó y liberó.
 *  - Informe: el documento para gerencia, con la conclusión, «Emitir» (que
 *    lo congela) y «Descargar PDF» (motor de reportes v2).
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  function C() { return window.SigsoCalidadV2.util; }
  function api(a, d) {
    return C().api(a, d).then(function (r) {
      if (r && r.ok && r.data && r.data._validationError) return { ok: false, message: r.data.message };
      return r;
    });
  }
  var esc = function (s) { return U.esc(s); };
  var VISTA = 'preparacion';
  var VER = {
    LISTA: ['Lista', 'ok', 'check'], LISTA_CON_RIESGOS: ['Lista con riesgos', 'alerta', 'alerta'],
    NO_LISTA: ['No lista', 'critico', 'equis'], SIN_EVALUAR: ['Sin evaluar', 'neutro', 'reloj']
  };
  var RECO = {
    IR: ['Se puede ir a la auditoría', 'ok', 'check'], IR_CON_RIESGOS: ['Se puede ir, cerrando las brechas', 'alerta', 'alerta'],
    NO_IR: ['Todavía no estamos listos', 'critico', 'alerta'], FALTA_EVALUAR: ['Falta evaluar áreas', 'info', 'reloj'], SIN_EVALUAR: ['Evaluación por empezar', 'neutro', 'reloj']
  };
  var MUE = { CONFORME: ['Completa', 'ok'], PARCIAL: ['Parcial', 'alerta'], NO_CONFORME: ['Falta', 'critico'] };
  var AUTO = { LISTA: 'Lista', CON_RIESGOS: 'Con riesgos', NO_LISTA: 'No lista' };
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  var st_ = { lista: null, datos: null, informe: '', tab: 'resumen', turno: 0 };

  function fechaLarga(d) { return d ? Number(d.slice(8, 10)) + ' de ' + MESES[Number(d.slice(5, 7)) - 1] + ' de ' + d.slice(0, 4) : ''; }
  function fechaCorta(d) { return d ? d.slice(8, 10) + '-' + d.slice(5, 7) + '-' + d.slice(0, 4) : '—'; }
  /** '2026-M10' (período de las matrices) → 'octubre 2026'. */
  function periodoTxt(p) { var m = /^(\d{4})-M(\d{2})$/.exec(String(p || '')); return m ? MESES[Number(m[2]) - 1] + ' ' + m[1] : String(p || ''); }
  function num(n) { return n === null || n === undefined ? '—' : String(n).replace('.', ','); }
  function puede() { return !!(st_.datos && st_.datos.puede_gestionar); }

  function cabecera(acciones) {
    return '<header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Calidad · Certificación ISO 9001</span>' +
      '<h1>¿Listos para certificar?</h1><span class="sx2-tenue" style="font-size:.875rem">Entrevistas, muestras y datos del sistema, con un veredicto por área antes de la auditoría.</span></div>' +
      '<div class="sx2-cabecera__acciones">' + (acciones || '') + U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-pr2-recargar' }) + '</div></header>';
  }
  function pagina(html, silencioso) {
    var c = C().contenedor(VISTA);
    if (!c) return;
    var y = window.scrollY;
    c.innerHTML = '<div class="sx2-pagina pr2">' + html + '</div>';
    if (silencioso) { c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; }); window.scrollTo(0, y); }
    U.animar(c);
  }

  // --- carga --------------------------------------------------------------------------
  function cargar(silencioso) {
    var t = ++st_.turno;
    if (!C().contenedor(VISTA)) return;
    if (!silencioso || !st_.datos) pagina(cabecera() + U.esqueleto('kpis', 3) + U.esqueleto('tarjetas', 3));
    Promise.all([api('listarPreparacionSgc', {}), api('getPreparacionSgc', st_.informe ? { informe_id: st_.informe } : {})]).then(function (r) {
      if (t !== st_.turno || !C().ocupa(VISTA)) return;
      if (!r[0] || !r[0].ok) { pagina(cabecera() + U.card({ cuerpo: U.vacio({ icono: 'candado', titulo: 'No se pudo abrir', texto: (r[0] && r[0].message) || 'Inténtalo de nuevo.' }) })); return; }
      st_.lista = r[0].data;
      st_.datos = r[1] && r[1].ok ? r[1].data : null;
      if (st_.datos && st_.datos.informe) st_.informe = st_.datos.informe.informe_id;
      pintar(!!silencioso);
    });
  }

  // --- vistas -------------------------------------------------------------------------
  function pintar(silencioso) {
    var L = st_.lista, d = st_.datos;
    var gestiona = L && L.puede_gestionar;
    if (!d || !d.informe) {
      pagina(cabecera() + U.card({ i: 1, cuerpo: U.vacio({ icono: 'escudo', titulo: 'Todavía no hay una evaluación de preparación',
        texto: 'Una evaluación junta lo que dice el sistema, una entrevista guiada a cada responsable y una revisión de registros al azar, y entrega un veredicto por área para gerencia. Se puede repetir: versión 1 antes de las vacaciones, versión 2 en enero.',
        accion: gestiona ? U.boton({ texto: 'Iniciar la primera evaluación', icono: 'nueva', variante: 'primario', clase: 'js-pr2-nueva' }) : '' }) }), silencioso);
      return;
    }
    var sel = L.informes.length > 1 ? '<select class="sx2-select js-pr2-ronda" aria-label="Evaluación">' + L.informes.map(function (i) {
      return '<option value="' + esc(i.informe_id) + '"' + (i.informe_id === d.informe.informe_id ? ' selected' : '') + '>' + esc(i.correlativo + ' · ' + i.titulo) + '</option>';
    }).join('') + '</select>' : '';
    var acciones = sel + (gestiona ? U.boton({ texto: 'Nueva evaluación', icono: 'nueva', variante: 'fantasma', clase: 'js-pr2-nueva' }) : '');
    var tabs = '<div class="pr2-tabs sx2-entra">' + U.segmento([
      { id: 'resumen', texto: 'Resumen', icono: 'panel' }, { id: 'entrevistas', texto: 'Entrevistas (' + d.entrevistas.length + ')', icono: 'equipo' },
      { id: 'muestras', texto: 'Muestras (' + d.muestras.filter(function (m) { return m.resultado; }).length + '/' + d.muestras.length + ')', icono: 'lupa' },
      { id: 'informe', texto: 'Informe', icono: 'documento' }], st_.tab, 'js-pr2-tab') + '</div>';
    var cuerpo = st_.tab === 'entrevistas' ? vistaEntrevistas(d) : (st_.tab === 'muestras' ? vistaMuestras(d) : (st_.tab === 'informe' ? vistaInforme(d) : vistaResumen(d)));
    pagina(cabecera(acciones) + banner(d) + tabs + cuerpo, silencioso);
  }

  function banner(d) {
    var r = RECO[d.recomendacion.codigo] || RECO.SIN_EVALUAR;
    var i = d.informe;
    var cuenta = i.fecha_auditoria
      ? (d.dias_para_auditoria > 0 ? '<strong class="pr2-cuenta__n">' + d.dias_para_auditoria + '</strong><span>días para la auditoría<br>' + esc(fechaLarga(i.fecha_auditoria)) + '</span>'
        : (d.dias_para_auditoria === 0 ? '<strong class="pr2-cuenta__n">Hoy</strong><span>es la auditoría</span>' : '<span>Auditoría del ' + esc(fechaLarga(i.fecha_auditoria)) + '</span>'))
      : '<span>Fecha de auditoría<br>por definir</span>';
    var estado = i.estado === 'EMITIDO' ? U.badge('Emitido el ' + fechaCorta(String(i.fecha_emision).slice(0, 10)), 'ok') : U.badge('Borrador', 'neutro');
    var conteo = { LISTA: 0, LISTA_CON_RIESGOS: 0, NO_LISTA: 0, SIN_EVALUAR: 0 };
    d.areas.forEach(function (a) { conteo[a.veredicto]++; });
    var chips = Object.keys(conteo).filter(function (k) { return conteo[k]; }).map(function (k) {
      return '<span class="pr2-chip sx2-tono-' + VER[k][1] + '">' + U.ico(VER[k][2], 13) + conteo[k] + ' ' + esc(VER[k][0].toLowerCase()) + '</span>';
    }).join('');
    return '<section class="sx2-card pr2-banner sx2-tono-' + r[1] + ' sx2-entra" style="--i:1">' +
      '<span class="pr2-banner__ico">' + U.ico(r[2], 26) + '</span>' +
      '<div class="pr2-banner__txt"><span class="pr2-eti">' + esc(i.correlativo + ' · ' + i.titulo) + ' ' + estado + '</span>' +
        '<h2>' + esc(r[0]) + '</h2><p>' + esc(d.recomendacion.texto) + '</p><div class="pr2-chips">' + chips + '</div></div>' +
      '<div class="pr2-cuenta">' + cuenta + (puede() ? U.boton({ texto: i.fecha_auditoria ? 'Cambiar fecha' : 'Poner fecha', variante: 'fantasma', sm: true, clase: 'js-pr2-fecha' }) : '') + '</div>' +
    '</section>';
  }

  function metrica(etiqueta, valor, tono, ayuda) {
    return '<div class="pr2-met sx2-tono-' + tono + '" title="' + esc(ayuda || '') + '"><span>' + esc(etiqueta) + '</span><strong>' + valor + '</strong></div>';
  }
  function tonoNum(v, ok, mal, mayor) {
    if (v === null || v === undefined) return 'neutro';
    if (mayor) return v >= ok ? 'ok' : (v >= mal ? 'alerta' : 'critico');
    return v <= ok ? 'ok' : (v <= mal ? 'alerta' : 'critico');
  }
  function vistaResumen(d) {
    var R = d.reglas;
    var tarjetas = d.areas.map(function (a, i) {
      var v = VER[a.veredicto];
      var en = a.entrevista, mu = a.muestras, da = a.datos;
      var mets = '<div class="pr2-mets">' +
        metrica('Entrevista', en.respondidas ? num(en.promedio) + '<small>/3</small>' : '—', en.respondidas ? tonoNum(en.promedio, R.entrevista_lista, R.entrevista_no, true) : 'neutro', 'Promedio de los puntajes (0 a 3). Se pide ' + R.entrevista_lista + '.') +
        metrica('Evidencia vista', en.evidencia_pct === null ? '—' : num(en.evidencia_pct) + '<small>%</small>', tonoNum(en.evidencia_pct, R.evidencia_lista, 50, true), 'Respuestas donde se vio el registro. Se pide ' + R.evidencia_lista + ' %.') +
        metrica('Cumplimiento', da.cumplimiento === null ? '—' : num(da.cumplimiento) + '<small>%</small>', tonoNum(da.cumplimiento, R.cumplimiento_lista, R.cumplimiento_no, true), 'Índice de cumplimiento del mes de la gente del área.') +
        metrica('NC vencidas', String(da.nc_vencidas.length), da.nc_vencidas.length ? 'critico' : 'ok', 'No conformidades con una etapa vencida.') +
        metrica('Sin acusar', String(da.acuses_pendientes), da.acuses_pendientes ? 'alerta' : 'ok', 'Documentos vigentes que alguien del área no ha acusado.') +
        metrica('Muestras', mu.total ? (mu.revisadas ? num(mu.conformes_pct) + '<small>%</small>' : '0/' + mu.total) : '—', mu.revisadas ? tonoNum(mu.conformes_pct, R.muestras_lista, R.muestras_no, true) : 'neutro', 'Registros revisados con la trazabilidad completa.') +
      '</div>';
      var brechas = a.brechas.length ? '<ul class="pr2-brechas">' + a.brechas.map(function (b, k) {
        return '<li><span>' + esc(b) + '</span>' + (puede() && a.veredicto !== 'SIN_EVALUAR' ? U.boton({ texto: 'Crear tarea', icono: 'nueva', variante: 'fantasma', sm: true, clase: 'js-pr2-tarea', datos: { area: a.clave, k: k } }) : '') + '</li>';
      }).join('') + '</ul>' : '<p class="pr2-ok">' + U.ico('check', 14) + 'Sin brechas.</p>';
      var resp = a.responsables.length ? a.responsables.map(function (p) { return esc(p.nombre); }).join(', ') : 'Sin responsables en la lista del área';
      return '<section class="sx2-card pr2-area sx2-tono-' + v[1] + ' sx2-entra" style="--i:' + (i + 3) + '">' +
        '<div class="pr2-area__cab"><div><h3>' + esc(a.nombre) + '</h3><span class="pr2-area__resp">' + resp + '</span></div>' +
          '<span class="pr2-ver sx2-tono-' + v[1] + '">' + U.ico(v[2], 14) + esc(v[0]) + '</span></div>' +
        mets + brechas +
        (puede() ? '<div class="pr2-area__pie">' + U.boton({ texto: a.entrevistas ? 'Otra entrevista' : 'Entrevistar', icono: 'equipo', sm: true, clase: 'js-pr2-entrevistar', datos: { area: a.clave } }) + '</div>' : '') +
      '</section>';
    }).join('');
    return '<div class="pr2-areas">' + tarjetas + '</div>' + vistaSistema(d);
  }

  function vistaSistema(d) {
    var s = d.sistema || {};
    if (!s.salud) return '';
    var caps = (s.salud.capitulos || []).map(function (c) {
      var p = c.pct === undefined ? c.pct_listo : c.pct;
      return '<li><span class="pr2-cap__n">' + esc(String(c.capitulo || c.numero || '')) + '</span><span class="pr2-cap__nom">' + esc(c.nombre || c.titulo || '') + '</span>' +
        U.barra(p || 0, (p || 0) >= 80 ? 'ok' : ((p || 0) >= 50 ? 'alerta' : 'critico')) + '<strong>' + num(Math.round(p || 0)) + ' %</strong></li>';
    }).join('');
    var alertas = (s.alertas || []).slice(0, 8).map(function (a) {
      var tono = a.severidad === 'CRITICA' ? 'critico' : (a.severidad === 'ALTA' ? 'alerta' : 'info');
      return '<li class="sx2-tono-' + tono + '"><span class="pr2-al__p"></span><span><strong>' + esc(a.titulo) + '</strong>' + (a.cantidad ? ' <small>(' + a.cantidad + ')</small>' : '') + '</span></li>';
    }).join('');
    return '<section class="sx2-card pr2-sistema sx2-entra" style="--i:9"><div class="sx2-card__cab"><h2 class="sx2-card__titulo">' + U.ico('escudo', 18) + 'Lo que dice el sistema</h2>' +
      '<span class="pr2-salud">' + num(Math.round(s.salud.pct || 0)) + ' %<small> de evidencia en SIGSO</small></span></div>' +
      '<div class="pr2-sistema__grid"><ul class="pr2-caps">' + caps + '</ul>' + (alertas ? '<div><h4 class="pr2-eti">Alertas del SGC</h4><ul class="pr2-alertas">' + alertas + '</ul></div>' : '') + '</div>' +
      '<p class="pr2-aviso">' + esc(s.salud.aviso || '') + '</p></section>';
  }

  function vistaEntrevistas(d) {
    if (!d.entrevistas.length) return U.card({ i: 3, cuerpo: U.vacio({ icono: 'equipo', titulo: 'Sin entrevistas todavía', texto: 'Entrevista a la jefatura y a un operativo de cada proceso. Son 8 preguntas; por cada una anotas la respuesta, si viste la evidencia y un puntaje de 0 a 3.',
      accion: puede() ? U.boton({ texto: 'Nueva entrevista', icono: 'nueva', variante: 'primario', clase: 'js-pr2-entrevistar' }) : '' }) });
    var porArea = {};
    d.entrevistas.forEach(function (e) { (porArea[e.area] = porArea[e.area] || []).push(e); });
    var html = d.areas.filter(function (a) { return porArea[a.clave]; }).map(function (a, i) {
      var filas = porArea[a.clave].map(function (e) {
        var pts = (e.respuestas || []).filter(function (r) { return r.puntaje !== '' && r.puntaje !== null; }).map(function (r) { return Number(r.puntaje); });
        var prom = pts.length ? Math.round(pts.reduce(function (s, x) { return s + x; }, 0) / pts.length * 10) / 10 : null;
        return '<tr class="sx2-fila--clic js-pr2-ver-entrevista" data-id="' + esc(e.entrevista_id) + '" tabindex="0"><td>' + U.persona({ nombre: e.persona_nombre, email: e.persona_email, cargo: e.cargo }) + '</td>' +
          '<td>' + esc(fechaCorta(e.fecha)) + '</td><td class="pr2-num"><strong>' + num(prom) + '</strong><small>/3</small></td>' +
          '<td>' + (e.autoevaluacion ? U.badge(AUTO[e.autoevaluacion], e.autoevaluacion === 'LISTA' ? 'ok' : (e.autoevaluacion === 'NO_LISTA' ? 'critico' : 'alerta')) : '—') + '</td>' +
          '<td class="sx2-tenue">' + esc(e.entrevistador_nombre || '') + '</td></tr>';
      }).join('');
      return U.card({ titulo: a.nombre, icono: 'equipo', i: i + 3, sinRelleno: true, cuerpo: '<div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr><th>Persona</th><th>Fecha</th><th class="pr2-num">Puntaje</th><th>Se ve</th><th>Entrevistó</th></tr></thead><tbody>' + filas + '</tbody></table></div>' });
    }).join('');
    return (puede() ? '<div class="pr2-barra">' + U.boton({ texto: 'Nueva entrevista', icono: 'nueva', variante: 'primario', clase: 'js-pr2-entrevistar' }) + '</div>' : '') + html;
  }

  function vistaMuestras(d) {
    if (!d.muestras.length) return U.card({ i: 3, cuerpo: U.vacio({ icono: 'lupa', titulo: 'No hay registros para revisar', texto: 'La muestra sale de las matrices de los departamentos del mes cerrado. Si el mes anterior no tiene registros cargados, no hay qué sortear.' }) });
    var porArea = {};
    d.muestras.forEach(function (m) { (porArea[m.area] = porArea[m.area] || []).push(m); });
    var revisadas = d.muestras.some(function (m) { return m.resultado; });
    var html = d.areas.filter(function (a) { return porArea[a.clave]; }).map(function (a, i) {
      var filas = porArea[a.clave].map(function (m) {
        var r = MUE[m.resultado];
        return '<tr class="' + (puede() ? 'sx2-fila--clic js-pr2-muestra' : '') + '" data-id="' + esc(m.muestra_id) + '" tabindex="0"><td><strong>' + esc(m.descripcion) + '</strong><span class="pr2-sub">' + esc(periodoTxt(m.periodo)) + '</span></td>' +
          '<td>' + esc(m.hizo_nombre || '—') + '</td><td>' + esc(m.reviso || '—') + '</td><td>' + esc(m.libero_nombre || '—') + '</td>' +
          '<td>' + (r ? U.badge(r[0], r[1]) : '<span class="sx2-tenue">Por revisar</span>') + '</td></tr>';
      }).join('');
      return U.card({ titulo: a.nombre, icono: 'lupa', i: i + 3, sinRelleno: true, sub: 'quién hizo, revisó y liberó cada registro',
        cuerpo: '<div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr><th>Registro</th><th>Hizo</th><th>Revisó</th><th>Liberó</th><th>Trazabilidad</th></tr></thead><tbody>' + filas + '</tbody></table></div>' });
    }).join('');
    return '<div class="pr2-barra"><p class="sx2-tenue">SIGSO eligió estos registros al azar. Abre cada uno, búscalo en la matriz o en el Drive y anota si se ve quién lo hizo, quién lo revisó y quién lo liberó.</p>' +
      (puede() && !revisadas ? U.boton({ texto: 'Sortear de nuevo', icono: 'tendencia', variante: 'fantasma', sm: true, clase: 'js-pr2-sortear' }) : '') + '</div>' + html;
  }

  function vistaInforme(d) {
    var i = d.informe, r = RECO[d.recomendacion.codigo] || RECO.SIN_EVALUAR;
    var filas = d.areas.map(function (a) {
      var v = VER[a.veredicto];
      return '<tr><td><strong>' + esc(a.nombre) + '</strong></td><td>' + U.badge(v[0], v[1]) + '</td><td>' +
        (a.brechas.length ? '<ul class="pr2-doc-ul">' + a.brechas.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>' : 'Sin brechas.') + '</td></tr>';
    }).join('');
    var conclusion = puede()
      ? '<label class="sx2-campo"><span class="sx2-campo__et">Conclusión para gerencia</span><textarea class="sx2-input js-pr2-conclusion" rows="5" placeholder="¿Estamos preparados? Qué está bien, qué falta, qué se necesita de gerencia.">' + esc(i.conclusion) + '</textarea></label>' +
        '<div class="pr2-barra">' + U.boton({ texto: 'Guardar conclusión', icono: 'check', clase: 'js-pr2-guardar-concl' }) + U.boton({ texto: 'Emitir informe', icono: 'escudo', variante: 'primario', clase: 'js-pr2-emitir' }) + '</div>'
      : '';
    var doc = '<div class="pr2-doc js-pr2-doc">' +
      '<section class="pr2-doc__sec"><h2>Recomendación</h2><p class="pr2-doc__reco sx2-tono-' + r[1] + '"><strong>' + esc(r[0]) + '.</strong> ' + esc(i.recomendacion_texto || d.recomendacion.texto) + '</p>' +
        (i.fecha_auditoria ? '<p>Auditoría de certificación: <strong>' + esc(fechaLarga(i.fecha_auditoria)) + '</strong>' + (d.dias_para_auditoria > 0 ? ' (faltan ' + d.dias_para_auditoria + ' días)' : '') + '.</p>' : '') + '</section>' +
      (i.conclusion ? '<section class="pr2-doc__sec"><h2>Conclusión</h2><p class="pr2-doc__concl">' + esc(i.conclusion).replace(/\n/g, '<br>') + '</p></section>' : '') +
      '<section class="pr2-doc__sec"><h2>Veredicto por área</h2><table class="sx2-tabla pr2-doc-tabla"><thead><tr><th>Área</th><th>Veredicto</th><th>Brechas</th></tr></thead><tbody>' + filas + '</tbody></table></section>' +
      '<section class="pr2-doc__sec"><h2>Cómo se evaluó</h2><p>Entrevista guiada de 8 preguntas a ' + d.entrevistas.length + (d.entrevistas.length === 1 ? ' responsable' : ' responsables') +
        ', revisión de ' + d.muestras.filter(function (m) { return m.resultado; }).length + ' de ' + d.muestras.length + ' registros elegidos al azar en las matrices, y los datos del SGC en SIGSO' +
        (d.sistema && d.sistema.salud ? ' (' + Math.round(d.sistema.salud.pct || 0) + ' % de la evidencia cargada)' : '') + '. Un área está lista con entrevista ≥ ' + num(d.reglas.entrevista_lista) +
        ', evidencia vista ≥ ' + d.reglas.evidencia_lista + ' %, cumplimiento ≥ ' + d.reglas.cumplimiento_lista + ' %, sin no conformidades vencidas y muestras ≥ ' + d.reglas.muestras_lista + ' % completas.</p></section>' +
    '</div>';
    return '<div class="pr2-informe">' + U.card({ i: 3, titulo: i.estado === 'EMITIDO' ? 'Informe emitido' : 'Informe para gerencia', icono: 'documento',
      accion: { texto: 'Descargar PDF', clase: 'js-pr2-pdf' }, cuerpo: (i.estado === 'EMITIDO' ? '' : conclusion) + doc }) + '</div>';
  }

  // --- formularios ------------------------------------------------------------------------
  function opcionesAreas(sel) {
    return (st_.datos.areas || []).map(function (a) { return '<option value="' + esc(a.clave) + '"' + (a.clave === sel ? ' selected' : '') + '>' + esc(a.nombre) + '</option>'; }).join('');
  }
  function formEntrevista(area, previa) {
    var d = st_.datos, e = previa || {};
    var resp = {};
    (e.respuestas || []).forEach(function (r) { resp[r.pregunta_id] = r; });
    var personas = {};
    d.areas.forEach(function (a) { a.responsables.forEach(function (p) { personas[p.email] = p.nombre; }); });
    var lista = '<datalist id="pr2-personas">' + Object.keys(personas).map(function (k) { return '<option value="' + esc(k) + '">' + esc(personas[k]) + '</option>'; }).join('') + '</datalist>';
    var preguntas = d.preguntas.map(function (p, i) {
      var r = resp[p.id] || {};
      var ev = ['', 'SI', 'PARCIAL', 'NO'].map(function (x) { return '<option value="' + x + '"' + (r.evidencia === x ? ' selected' : '') + '>' + (x ? { SI: 'Sí, la vi', PARCIAL: 'En parte', NO: 'No' }[x] : '—') + '</option>'; }).join('');
      var pt = ['', '0', '1', '2', '3'].map(function (x) { return '<option value="' + x + '"' + (String(r.puntaje) === x && r.puntaje !== '' ? ' selected' : '') + '>' + (x === '' ? '—' : x + ' · ' + ['No sabe / no existe', 'Débil', 'Suficiente', 'Sólido con evidencia'][Number(x)]) + '</option>'; }).join('');
      return '<fieldset class="pr2-preg"><legend><span class="pr2-preg__n">' + (i + 1) + '</span><span><strong>' + esc(p.bloque) + '</strong> <small>§' + esc(p.clausulas) + '</small><br>' + esc(p.texto) + '</span></legend>' +
        '<textarea class="sx2-input" name="r_' + p.id + '" rows="2" placeholder="Lo que respondió">' + esc(r.respuesta || '') + '</textarea>' +
        '<div class="pr2-preg__fila"><label>Evidencia<select class="sx2-select" name="e_' + p.id + '">' + ev + '</select></label><label>Puntaje<select class="sx2-select" name="p_' + p.id + '">' + pt + '</select></label></div></fieldset>';
    }).join('');
    var auto = ['', 'LISTA', 'CON_RIESGOS', 'NO_LISTA'].map(function (x) { return '<option value="' + x + '"' + (e.autoevaluacion === x ? ' selected' : '') + '>' + (x ? AUTO[x] : '—') + '</option>'; }).join('');
    U.formulario({
      titulo: previa ? 'Entrevista a ' + (e.persona_nombre || e.persona_email) : 'Nueva entrevista', ancho: true, boton: 'Guardar entrevista',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Puntaje: 0 no sabe o no existe · 1 débil · 2 suficiente · 3 sólido y con evidencia a la vista.</span>',
      campos: '<div class="pr2-form-cab">' + U.campo('Área', '<select class="sx2-select" name="area" required>' + opcionesAreas(e.area || area) + '</select>') +
        U.campo('Persona (correo)', '<input class="sx2-input" name="persona_email" list="pr2-personas" value="' + esc(e.persona_email || '') + '" required>' + lista) +
        U.campo('Cargo', '<input class="sx2-input" name="cargo" value="' + esc(e.cargo || '') + '">') +
        U.campo('Fecha', '<input class="sx2-input" type="date" name="fecha" value="' + esc(e.fecha || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())) + '">') + '</div>' +
        preguntas +
        '<div class="pr2-form-cab">' + U.campo('Autoevaluación del responsable', '<select class="sx2-select" name="autoevaluacion">' + auto + '</select>') +
        U.campo('¿Por qué?', '<input class="sx2-input" name="autoevaluacion_motivo" value="' + esc(e.autoevaluacion_motivo || '') + '">') + '</div>' +
        U.campo('Comentario del entrevistador', '<textarea class="sx2-input" name="comentario" rows="2">' + esc(e.comentario || '') + '</textarea>'),
      preparar: function (v) {
        var respuestas = d.preguntas.map(function (p) { return { pregunta_id: p.id, respuesta: v['r_' + p.id] || '', evidencia: v['e_' + p.id] || '', puntaje: v['p_' + p.id] === undefined ? '' : v['p_' + p.id] }; });
        if (!respuestas.some(function (r) { return r.puntaje !== ''; })) return 'Califica al menos una pregunta.';
        return { informe_id: d.informe.informe_id, entrevista_id: e.entrevista_id || '', area: v.area, persona_email: v.persona_email, persona_nombre: personas[String(v.persona_email || '').toLowerCase()] || '',
          cargo: v.cargo, fecha: v.fecha, respuestas: respuestas, autoevaluacion: v.autoevaluacion, autoevaluacion_motivo: v.autoevaluacion_motivo, comentario: v.comentario };
      },
      enviar: function (datos) { return api('guardarEntrevistaPreparacionSgc', datos); },
      aviso: 'Entrevista guardada.',
      listo: function () { cargar(true); }
    });
  }
  function verEntrevista(id) {
    var e = st_.datos.entrevistas.filter(function (x) { return x.entrevista_id === id; })[0];
    if (!e) return;
    if (puede()) { formEntrevista(e.area, e); return; }
    var resp = {};
    (e.respuestas || []).forEach(function (r) { resp[r.pregunta_id] = r; });
    U.drawer({ titulo: 'Entrevista a ' + (e.persona_nombre || e.persona_email), cuerpo: '<div class="pr2-lectura">' + st_.datos.preguntas.map(function (p, i) {
      var r = resp[p.id] || {};
      return '<div class="pr2-preg"><p><strong>' + (i + 1) + '. ' + esc(p.bloque) + '</strong> — ' + esc(p.texto) + '</p><p>' + esc(r.respuesta || '—') + '</p><p class="sx2-tenue">Evidencia: ' + esc(r.evidencia || '—') + ' · Puntaje: ' + esc(r.puntaje === '' ? '—' : String(r.puntaje)) + '</p></div>';
    }).join('') + '</div>' });
  }
  function formMuestra(id) {
    var m = st_.datos.muestras.filter(function (x) { return x.muestra_id === id; })[0];
    if (!m || !puede()) return;
    var res = ['CONFORME', 'PARCIAL', 'NO_CONFORME'].map(function (x) { return '<option value="' + x + '"' + (m.resultado === x ? ' selected' : '') + '>' + { CONFORME: 'Completa: se ve quién hizo, revisó y liberó', PARCIAL: 'Parcial: falta una parte', NO_CONFORME: 'No se puede rastrear' }[x] + '</option>'; }).join('');
    U.formulario({ titulo: m.descripcion, subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Período ' + esc(periodoTxt(m.periodo)) + '. Búscalo en la matriz o en el Drive del área.</span>', boton: 'Guardar revisión',
      campos: U.campo('Quién lo hizo', '<input class="sx2-input" name="hizo" value="' + esc(m.hizo_nombre || m.hizo || '') + '">') +
        U.campo('Quién lo revisó', '<input class="sx2-input" name="reviso" value="' + esc(m.reviso || '') + '">') +
        U.campo('Quién lo liberó', '<input class="sx2-input" name="libero" value="' + esc(m.libero_nombre || m.libero || '') + '">', 'Si la matriz tiene la columna «Liberado por», SIGSO ya la trajo.') +
        U.campo('Trazabilidad', '<select class="sx2-select" name="resultado" required><option value="">—</option>' + res + '</select>') +
        U.campo('Observación', '<textarea class="sx2-input" name="observacion" rows="2">' + esc(m.observacion || '') + '</textarea>'),
      preparar: function (v) { if (!v.resultado) return 'Indica cómo está la trazabilidad.'; v.muestra_id = m.muestra_id; return v; },
      enviar: function (v) { return api('guardarMuestraPreparacionSgc', v); }, aviso: 'Revisión guardada.', listo: function () { cargar(true); } });
  }
  function formTarea(area, k) {
    var a = st_.datos.areas.filter(function (x) { return x.clave === area; })[0];
    if (!a) return;
    var opciones = a.responsables.map(function (p) { return '<option value="' + esc(p.email) + '">' + esc(p.nombre) + '</option>'; }).join('');
    U.formulario({ titulo: 'Tarea para cerrar la brecha', subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + esc(a.nombre) + ' · entra al índice de cumplimiento del responsable.</span>', boton: 'Crear tarea',
      campos: U.campo('Qué hay que hacer', '<textarea class="sx2-input" name="texto" rows="3" required>' + esc(a.brechas[k] || '') + '</textarea>') +
        U.campo('Responsable', opciones ? '<select class="sx2-select" name="responsable_email">' + opciones + '</select>' : '<input class="sx2-input" name="responsable_email" placeholder="correo@empresa.cl">') +
        U.campo('Fecha', '<input class="sx2-input" type="date" name="fecha_compromiso" required>', 'Antes de la auditoría.'),
      enviar: function (v) { v.informe_id = st_.datos.informe.informe_id; v.area = area; return api('crearTareaBrechaPreparacionSgc', v); },
      aviso: 'Tarea creada: ya está en Mi trabajo del responsable.' });
  }
  function formNueva() {
    var n = (st_.lista && st_.lista.informes.length || 0) + 1;
    var mes = MESES[new Date().getMonth()] + ' ' + new Date().getFullYear();
    U.formulario({ titulo: 'Nueva evaluación de preparación', boton: 'Iniciar evaluación',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">SIGSO sorteará 5 registros por área en las matrices del mes cerrado.</span>',
      campos: U.campo('Nombre', '<input class="sx2-input" name="titulo" value="Versión ' + n + ' — ' + esc(mes) + '" required>') +
        U.campo('Fecha de la auditoría (Etapa II)', '<input class="sx2-input" type="date" name="fecha_auditoria">', 'Si todavía no está confirmada, déjala en blanco y la pones después.'),
      enviar: function (v) { return api('crearPreparacionSgc', v); },
      listo: function (r) { st_.informe = r.data && r.data.informe ? r.data.informe.informe_id : ''; st_.tab = 'resumen'; cargar(false); } });
  }
  function formFecha() {
    var i = st_.datos.informe;
    U.formulario({ titulo: 'Fecha de la auditoría', boton: 'Guardar',
      campos: U.campo('Etapa II (auditoría en terreno)', '<input class="sx2-input" type="date" name="fecha_auditoria" value="' + esc(i.fecha_auditoria || '') + '">'),
      enviar: function (v) { v.informe_id = i.informe_id; return api('actualizarPreparacionSgc', v); }, listo: function () { cargar(true); } });
  }

  // --- eventos ----------------------------------------------------------------------------
  document.addEventListener('click', function (ev) {
    var raiz = document.getElementById('calidad-v2');
    if (!raiz || raiz.getAttribute('data-vista') !== VISTA || !raiz.contains(ev.target)) return;
    var t = ev.target, b;
    if (t.closest('.js-pr2-recargar')) { cargar(true); return; }
    if (t.closest('.js-pr2-nueva')) { formNueva(); return; }
    if ((b = t.closest('.js-pr2-tab'))) { st_.tab = b.getAttribute('data-id'); pintar(true); return; }
    if (t.closest('.js-pr2-fecha')) { formFecha(); return; }
    if ((b = t.closest('.js-pr2-entrevistar'))) { formEntrevista(b.getAttribute('data-area') || ''); return; }
    if ((b = t.closest('.js-pr2-ver-entrevista'))) { verEntrevista(b.getAttribute('data-id')); return; }
    if ((b = t.closest('.js-pr2-muestra'))) { formMuestra(b.getAttribute('data-id')); return; }
    if ((b = t.closest('.js-pr2-tarea'))) { formTarea(b.getAttribute('data-area'), Number(b.getAttribute('data-k'))); return; }
    if (t.closest('.js-pr2-sortear')) {
      api('sortearMuestrasPreparacionSgc', { informe_id: st_.datos.informe.informe_id }).then(function (r) { if (!r || !r.ok) PY.aviso((r && r.message) || 'No se pudo sortear.', 'error'); cargar(true); });
      return;
    }
    if ((b = t.closest('.js-pr2-guardar-concl'))) {
      var txt = raiz.querySelector('.js-pr2-conclusion');
      b.disabled = true;
      api('actualizarPreparacionSgc', { informe_id: st_.datos.informe.informe_id, conclusion: txt ? txt.value : '' }).then(function (r) {
        b.disabled = false;
        if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo guardar.', 'error'); return; }
        PY.aviso('Conclusión guardada.', 'exito'); cargar(true);
      });
      return;
    }
    if (t.closest('.js-pr2-emitir')) {
      var c = raiz.querySelector('.js-pr2-conclusion');
      U.confirmar({ titulo: 'Emitir el informe', texto: 'Al emitirlo queda congelado tal como está hoy: lo que reciba gerencia no cambia después. Para volver a medir se abre una evaluación nueva.', boton: 'Emitir' }).then(function (si) {
        if (!si) return;
        api('emitirPreparacionSgc', { informe_id: st_.datos.informe.informe_id, conclusion: c ? c.value : '' }).then(function (r) {
          if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo emitir.', 'error'); return; }
          PY.aviso('Informe emitido.', 'exito'); cargar(true);
        });
      });
      return;
    }
    if ((b = t.closest('.js-pr2-pdf'))) {
      var doc = raiz.querySelector('.js-pr2-doc');
      if (!doc || !window.SigsoReportes) return;
      var i = st_.datos.informe;
      SigsoReportes.descargarPdf(doc, { boton: b, titulo: '¿Estamos preparados para certificar?', nombreArchivo: 'sigso-preparacion-' + i.correlativo,
        cabecera: SigsoReportes.cabeceraDocumento({ titulo: '¿Estamos preparados para certificar?', subtitulo: i.titulo, modulo: 'Calidad · ISO 9001', codigo: i.correlativo,
          periodo: i.estado === 'EMITIDO' ? 'Emitido el ' + fechaCorta(String(i.fecha_emision).slice(0, 10)) : 'Borrador al ' + fechaCorta(st_.datos.fecha), generadoPor: (PY.miNombre && PY.miNombre()) || '' }) });
    }
  });
  document.addEventListener('change', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('js-pr2-ronda')) return;
    st_.informe = ev.target.value; st_.tab = 'resumen'; cargar(false);
  });
  document.addEventListener('keydown', function (ev) {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('#calidad-v2 tr.js-pr2-ver-entrevista, #calidad-v2 tr.js-pr2-muestra')) { ev.preventDefault(); ev.target.click(); }
  });

  window.SigsoCalidadPreparacionV2 = {
    mostrar: function () { cargar(!!st_.datos && C().ocupa(VISTA)); },
    vistas: [VISTA]
  };
})();
