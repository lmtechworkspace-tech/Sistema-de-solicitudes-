/**
 * departamentos-reportes-v2.js — el REPORTE MENSUAL de cada departamento
 * (2026-10-03). Organigrama de HomePymes: el área lo prepara, su jefatura lo
 * valida y Administración lo recibe (backend/logica/departamentosReportes.js
 * decide los permisos y el estado; aquí solo se pinta).
 *
 * Vistas, dentro de cada módulo de departamento (control-interno-v2.js):
 *  - reporte            el reporte mensual del mes elegido (por defecto, el
 *                       mes que acaba de cerrar): preparar, enviar, validar,
 *                       devolver o recibir, según quién mira.
 *  - reporte:<id>       un reporte puntual (también los extraordinarios).
 *  - panel              (Administración) las cuatro áreas: el mes elegido,
 *                       los últimos 6 meses y lo que espera recepción.
 *  - tarjeta            el aviso del reporte en el "Resumen del mes" del área.
 *
 * Plantilla común para las cuatro áreas: resumen, actividades, indicadores,
 * dificultades, pendientes y respaldos, más lo que SIGSO ya sabe del mes.
 */
(function () {
  'use strict';

  var U = UIv2;
  var x_ = null, est_ = { periodo: '', id: '', datos: null, lista: null, turno: 0, adminPeriodo: '' };
  var R = function () { return window.SigsoReportes; };

  var TONO = { SIN_INICIAR: 'neutro', BORRADOR: 'info', EN_REVISION: 'alerta', OBSERVADO: 'critico', VALIDADO: 'primario', RECIBIDO: 'ok' };
  var ETIQ = {
    SIN_INICIAR: 'Sin iniciar', BORRADOR: 'En preparación', EN_REVISION: 'Por validar (jefatura)',
    OBSERVADO: 'Devuelto con observaciones', VALIDADO: 'Por recibir (Administración)', RECIBIDO: 'Recibido'
  };
  var ACCION_TXT = {
    REPORTE_CREADO: 'Lo empezó', REPORTE_EDITADO: 'Guardó el borrador', REPORTE_ENVIADO: 'Lo envió a la jefatura',
    REPORTE_DEVUELTO: 'Lo devolvió', REPORTE_VALIDADO: 'Lo validó', REPORTE_RECIBIDO: 'Lo recibió'
  };

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function nombre(e) { return e ? x_.nombre(e) : '—'; }
  function fecha(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    try { return d.toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return String(iso).slice(0, 16).replace('T', ' '); }
  }
  function fechaCorta(v) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m ? m[3] + '-' + m[2] + '-' + m[1] : String(v || ''); }
  function parrafos(t) { return t ? txt(t).replace(/\n/g, '<br>') : '<span class="sx2-tenue">—</span>'; }
  function mesCerrado() { return x_.mover(x_.periodoActual(), -1); }
  function aviso(tono, icono, html) { return '<div class="mj2-aviso sx2-tono-' + tono + ' sx2-entra">' + U.ico(icono, 16) + '<span>' + html + '</span></div>'; }
  function selectorMes(periodo, clase) {
    return '<span class="ci2-periodo" role="group" aria-label="Mes">' +
      U.boton({ soloIcono: true, icono: 'izquierda', variante: 'fantasma', sm: true, titulo: 'Mes anterior', clase: clase, datos: { n: -1 } }) +
      '<strong>' + txt(x_.perTexto(periodo)) + '</strong>' +
      U.boton({ soloIcono: true, icono: 'derecha', variante: 'fantasma', sm: true, titulo: 'Mes siguiente', clase: clase, datos: { n: 1 } }) + '</span>';
  }
  function resolver(correos) {
    if (!window.SigsoDirectorio || !SigsoDirectorio.resolver) return Promise.resolve();
    return SigsoDirectorio.resolver(correos.filter(function (e) { return e && /@/.test(e); })).catch(function () { /* se ve el correo */ });
  }

  // =========================================================================================
  // Los tres pasos: área → jefatura → Administración
  // =========================================================================================
  function pasos(rep, jefaturas) {
    var e = rep.estado;
    var actual = (e === 'EN_REVISION') ? 2 : (e === 'VALIDADO' ? 3 : (e === 'RECIBIDO' ? 4 : 1));
    var jef = (jefaturas || []).map(nombre).join(', ');
    var items = [
      { t: 'El área lo prepara', d: rep.fecha_envio ? 'Envió ' + nombre(rep.autor_email) + ' · ' + fecha(rep.fecha_envio) : (e === 'OBSERVADO' ? 'Corrige lo observado y vuelve a enviarlo' : 'En preparación') },
      { t: 'La jefatura lo valida', d: rep.fecha_validacion ? 'Validó ' + nombre(rep.validado_por) + ' · ' + fecha(rep.fecha_validacion) : (jef ? jef : 'Sin jefatura asignada') },
      { t: 'Administración lo recibe', d: rep.fecha_recepcion ? 'Recibió ' + nombre(rep.recibido_por) + ' · ' + fecha(rep.fecha_recepcion) : 'Encargada de Administración' }
    ];
    return '<ol class="dr-pasos sx2-entra">' + items.map(function (it, i) {
      var n = i + 1, clase = n < actual ? ' is-hecho' : (n === actual ? (e === 'OBSERVADO' ? ' is-observado' : ' is-actual') : '');
      return '<li class="dr-paso' + clase + '"><span class="dr-paso__n">' + (n < actual ? U.ico('check', 14) : n) + '</span>' +
        '<span class="dr-paso__txt"><strong>' + txt(it.t) + '</strong><span>' + txt(it.d) + '</span></span></li>';
    }).join('') + '</ol>';
  }

  // =========================================================================================
  // Lo que SIGSO ya sabe del mes
  // =========================================================================================
  function bloqueAuto(a, congelado, rep) {
    if (!a) return '';
    var t = a.tareas || {}, s = a.solicitudes || {};
    var nota = congelado ? 'Congelado al enviarlo (' + fecha(rep.fecha_envio) + '): lo validado no cambia.' : 'Se actualiza solo mientras el reporte está en preparación.';
    var kp = '<div class="dr-kpis">' +
      U.kpi({ icono: 'check', etiqueta: 'Tareas terminadas', valor: t.terminadas || 0, tono: 'ok', i: 1 }) +
      U.kpi({ icono: 'tareas', etiqueta: 'Tareas abiertas', valor: t.abiertas || 0, i: 2 }) +
      U.kpi({ icono: 'alerta', etiqueta: 'Atrasadas', valor: t.atrasadas || 0, tono: t.atrasadas ? 'critico' : '', i: 3 }) +
      U.kpi({ icono: 'bandeja', etiqueta: 'Solicitudes cerradas', valor: s.cerradas || 0, i: 4 }) + '</div>';
    var mat = (a.matrices || []).length ? '<h3 class="dr-sub">Matrices del mes</h3><div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr><th>Matriz</th><th class="sx2-num">Filas</th><th class="sx2-num">Terminadas</th><th class="sx2-num">Sin terminar</th><th class="sx2-num">Por liberar</th><th class="sx2-num">Liberadas</th></tr></thead><tbody>' +
      a.matrices.map(function (m) { return '<tr><td>' + txt(m.nombre) + '</td><td class="sx2-num">' + m.total + '</td><td class="sx2-num">' + m.terminadas + '</td><td class="sx2-num">' + m.pendientes + '</td><td class="sx2-num">' + m.por_liberar + '</td><td class="sx2-num">' + m.liberadas + '</td></tr>'; }).join('') +
      '</tbody></table></div>' : '';
    var lista = (t.lista || []).length ? '<details class="dr-det"><summary>Tareas terminadas en ' + txt(x_.perTexto(a.periodo, true)) + ' (' + t.terminadas + ')</summary><ul class="dr-lista">' +
      t.lista.map(function (x) { return '<li><span>' + txt(x.titulo) + '</span><span class="sx2-tenue">' + txt(nombre(x.responsable)) + ' · ' + txt(fechaCorta(x.fecha)) + '</span></li>'; }).join('') +
      (t.mas ? '<li class="sx2-tenue">y ' + t.mas + ' más</li>' : '') + '</ul></details>' : '';
    return '<section class="dr-auto"><h2 class="rp2-sub">Lo que SIGSO registra del mes <small class="sx2-tenue">' + txt(nota) + '</small></h2>' + kp + mat + lista + '</section>';
  }

  // =========================================================================================
  // El reporte: documento (para leer, validar, recibir y descargar) y formulario (para prepararlo)
  // =========================================================================================
  function tablaDoc(cols, filas) {
    if (!filas.length) return '<p class="sx2-tenue">Sin registros.</p>';
    return '<div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr>' + cols.map(function (c) { return '<th>' + txt(c[1]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      filas.map(function (f) { return '<tr>' + cols.map(function (c) { return '<td>' + txt(f[c[0]]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  }
  var COLS_ACT = [['cliente', 'Cliente'], ['actividad', 'Actividad'], ['fecha', 'Fecha'], ['estado', 'Estado'], ['observacion', 'Observación']];
  var COLS_IND = [['indicador', 'Indicador'], ['meta', 'Meta'], ['resultado', 'Resultado'], ['comentario', 'Comentario']];
  function seccionDoc(titulo, cuerpo) { return '<section class="ci2-rep-sec"><h2 class="rp2-sub">' + txt(titulo) + '</h2>' + cuerpo + '</section>'; }
  function documento(d) {
    var rep = d.reporte, c = d.contenido;
    var firmas = '<dl class="dr-firmas">' +
      '<div><dt>Preparó</dt><dd>' + txt(nombre(rep.autor_email)) + (rep.fecha_envio ? ' · ' + txt(fecha(rep.fecha_envio)) : '') + '</dd></div>' +
      '<div><dt>Validó (jefatura)</dt><dd>' + (rep.validado_por ? txt(nombre(rep.validado_por)) + ' · ' + txt(fecha(rep.fecha_validacion)) + (rep.observacion_jefatura ? '<br><i>' + txt(rep.observacion_jefatura) + '</i>' : '') : '<span class="sx2-tenue">Pendiente</span>') + '</dd></div>' +
      '<div><dt>Recibió (Administración)</dt><dd>' + (rep.recibido_por ? txt(nombre(rep.recibido_por)) + ' · ' + txt(fecha(rep.fecha_recepcion)) + (rep.observacion_administracion ? '<br><i>' + txt(rep.observacion_administracion) + '</i>' : '') : '<span class="sx2-tenue">Pendiente</span>') + '</dd></div></dl>';
    var cuerpo = seccionDoc('Resumen del mes', '<p class="dr-parrafo">' + parrafos(c.resumen) + '</p>') +
      seccionDoc('Actividades realizadas', tablaDoc(COLS_ACT, c.actividades)) +
      seccionDoc('Indicadores', tablaDoc(COLS_IND, c.indicadores)) +
      seccionDoc('Dificultades y riesgos', '<p class="dr-parrafo">' + parrafos(c.dificultades) + '</p>') +
      seccionDoc('Pendientes para el próximo mes', '<p class="dr-parrafo">' + parrafos(c.pendientes) + '</p>') +
      seccionDoc('Respaldos', '<p class="dr-parrafo">' + parrafos(c.respaldos) + '</p>') +
      bloqueAuto(d.auto, d.congelado, rep) +
      seccionDoc('Validación', firmas);
    return '<div class="rp2-documento ci2-doc js-dr-doc">' + R().barraAcciones({ volver: false }) +
      R().cabeceraDocumento({ titulo: rep.titulo + ' · ' + rep.depto_nombre, subtitulo: x_.perTexto(rep.periodo, true) + ' · ' + (ETIQ[rep.estado] || rep.estado), modulo: rep.depto_nombre, periodo: x_.perTexto(rep.periodo, true) }) +
      cuerpo + R().pieDocumento('Reporte del área ' + rep.depto_nombre + ' · preparado por el área, validado por su jefatura y recibido por Administración, según el organigrama.') + '</div>';
  }

  function filaEditable(cols, f, i, tipo) {
    return '<tr data-fila="' + i + '">' + cols.map(function (c) {
      var largo = c[0] === 'actividad' || c[0] === 'observacion' || c[0] === 'comentario' || c[0] === 'indicador';
      return '<td><input class="sx2-input dr-celda' + (largo ? ' dr-celda--larga' : '') + '" data-' + tipo + '="' + c[0] + '" value="' + U.esc(f[c[0]] || '') + '"' + (c[0] === 'fecha' ? ' placeholder="dd-mm"' : '') + ' aria-label="' + U.esc(c[1]) + '"></td>';
    }).join('') + '<td class="dr-quitar">' + U.boton({ soloIcono: true, icono: 'basura', variante: 'fantasma', sm: true, titulo: 'Quitar la fila', clase: 'js-dr-quitar' }) + '</td></tr>';
  }
  function tablaEditable(cols, filas, tipo, vacias) {
    var todas = filas.concat(Array.apply(null, Array(Math.max(vacias - filas.length, 1))).map(function () { return {}; }));
    return '<div class="sx2-tabla-wrap"><table class="sx2-tabla dr-editable" data-tabla="' + tipo + '"><thead><tr>' + cols.map(function (c) { return '<th>' + txt(c[1]) + '</th>'; }).join('') + '<th></th></tr></thead><tbody>' +
      todas.map(function (f, i) { return filaEditable(cols, f, i, tipo); }).join('') + '</tbody></table></div>' +
      U.boton({ texto: 'Agregar fila', icono: 'nueva', variante: 'fantasma', sm: true, clase: 'js-dr-fila', datos: { tabla: tipo } });
  }
  function area(nombre_, titulo, valor, ayuda, filas) {
    return '<label class="dr-campo"><span class="dr-campo__tit">' + txt(titulo) + '</span>' + (ayuda ? '<span class="sx2-tenue dr-campo__ayuda">' + txt(ayuda) + '</span>' : '') +
      '<textarea class="sx2-input dr-texto" name="' + nombre_ + '" rows="' + (filas || 3) + '">' + U.esc(valor || '') + '</textarea></label>';
  }
  function formulario(d) {
    var c = d.contenido;
    return '<form class="dr-form sx2-entra js-dr-form" onsubmit="return false">' +
      area('resumen', 'Resumen del mes', c.resumen, 'Lo más importante del mes en el área: qué se hizo, qué cambió y cómo terminó. Obligatorio para enviarlo.', 5) +
      '<div class="dr-campo"><span class="dr-campo__tit">Actividades realizadas</span><span class="sx2-tenue dr-campo__ayuda">Una fila por actividad o servicio; el cliente es opcional.</span>' + tablaEditable(COLS_ACT, c.actividades, 'act', 3) + '</div>' +
      '<div class="dr-campo"><span class="dr-campo__tit">Indicadores</span><span class="sx2-tenue dr-campo__ayuda">Los indicadores del área (DOC-07): meta y resultado del mes.</span>' + tablaEditable(COLS_IND, c.indicadores, 'ind', 2) + '</div>' +
      area('dificultades', 'Dificultades y riesgos', c.dificultades, 'Lo que frenó el trabajo o puede frenarlo.') +
      area('pendientes', 'Pendientes para el próximo mes', c.pendientes) +
      area('respaldos', 'Respaldos', c.respaldos, 'Dónde están los documentos que respaldan el reporte (carpeta del Drive, enlaces).', 2) +
      '</form>';
  }
  function leerFormulario() {
    var f = x_.raiz().querySelector('.js-dr-form');
    if (!f) return null;
    function filas(tipo, cols) {
      return [].slice.call(f.querySelectorAll('[data-tabla="' + tipo + '"] tbody tr')).map(function (tr) {
        var o = {};
        cols.forEach(function (c) { var i = tr.querySelector('[data-' + tipo + '="' + c[0] + '"]'); o[c[0]] = i ? i.value.trim() : ''; });
        return o;
      }).filter(function (o) { return cols.some(function (c) { return o[c[0]]; }); });
    }
    return {
      resumen: f.querySelector('[name="resumen"]').value, dificultades: f.querySelector('[name="dificultades"]').value,
      pendientes: f.querySelector('[name="pendientes"]').value, respaldos: f.querySelector('[name="respaldos"]').value,
      actividades: filas('act', COLS_ACT), indicadores: filas('ind', COLS_IND)
    };
  }

  // =========================================================================================
  // Vista del reporte
  // =========================================================================================
  function migas() { return x_.modNombre + (x_.opc.recibe && est_.datos ? ' · ' + est_.datos.reporte.depto_nombre : ''); }
  function mostrar(id, ctx) {
    x_ = ctx;
    est_.id = id || '';
    if (!est_.periodo) est_.periodo = mesCerrado();
    var t = ++est_.turno;
    if (x_.opc.recibe && !est_.id) { panel(ctx); return; }
    x_.pagina(x_.cabecera(x_.modNombre, 'Reporte mensual', 'Cargando…') + U.esqueleto('kpis', 3) + U.esqueleto('tabla', 6));
    var pedido = est_.id ? { reporte_id: est_.id } : { depto: x_.opc.depto, periodo: est_.periodo };
    x_.api('getReporteDep', pedido).then(function (r) {
      if (t !== est_.turno) return;
      if (!r || !r.ok) { x_.pagina(x_.cabecera(x_.modNombre, 'Reporte mensual', '') + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar el reporte', texto: (r && r.message) || '' }) })); return; }
      est_.datos = r.data;
      if (est_.datos.reporte.periodo) est_.periodo = est_.datos.reporte.periodo;
      var rep = est_.datos.reporte, a = est_.datos.auto || {};
      var correos = [rep.autor_email, rep.validado_por, rep.recibido_por, rep.devuelto_por].concat(est_.datos.jefaturas || [], (est_.datos.historial || []).map(function (h) { return h.usuario_email; }), ((a.tareas || {}).lista || []).map(function (x) { return x.responsable; }));
      pintar();
      resolver(correos).then(function () { if (t === est_.turno) pintar(true); });
      if (!x_.opc.recibe) cargarLista(t);
    });
  }
  function cargarLista(t) {
    x_.api('listarReportesDep', { depto: x_.opc.depto, anio: est_.periodo.slice(0, 4) }).then(function (r) {
      if (t !== est_.turno || !r || !r.ok) return;
      est_.lista = r.data;
      var c = x_.raiz().querySelector('.js-dr-lista');
      if (c) c.innerHTML = listaAnio();
    });
  }
  function listaAnio() {
    var l = est_.lista;
    if (!l || !l.reportes.length) return '<p class="sx2-tenue">Todavía no hay reportes en ' + txt(est_.periodo.slice(0, 4)) + '.</p>';
    var actual = est_.datos && est_.datos.reporte.reporte_id;
    return '<ul class="dr-anio">' + l.reportes.map(function (r) {
      return '<li><button type="button" class="dr-anio__it' + (r.reporte_id === actual ? ' is-actual' : '') + '" data-dr-ir="reporte:' + U.esc(r.reporte_id) + '">' +
        '<span><strong>' + txt(x_.perTexto(r.periodo)) + '</strong> · ' + txt(r.tipo === 'MENSUAL' ? 'Mensual' : r.titulo) + '</span>' + U.badge(ETIQ[r.estado] || r.estado, TONO[r.estado]) + '</button></li>';
    }).join('') + '</ul>';
  }
  function pintar(silencioso) {
    var d = est_.datos, rep = d.reporte, ac = d.acciones || {};
    var editando = !!ac.editar;
    var esJefatura = !!(x_.cfg && x_.cfg.departamentos[0] && x_.cfg.departamentos[0].jefatura);
    var botones = '';
    if (ac.editar) botones += U.boton({ texto: 'Guardar borrador', icono: 'check', clase: 'js-dr-guardar' });
    if (ac.enviar) botones += U.boton({ texto: esJefatura ? 'Enviar a Administración' : 'Enviar a la jefatura', icono: 'derivar', variante: 'primario', clase: 'js-dr-enviar' });
    if (ac.devolver) botones += U.boton({ texto: 'Devolver con observaciones', icono: 'comentario', clase: 'js-dr-devolver' });
    if (ac.validar) botones += U.boton({ texto: 'Validar y entregar a Administración', icono: 'escudoCheck', variante: 'primario', clase: 'js-dr-validar' });
    if (ac.recibir) botones += U.boton({ texto: 'Recibir', icono: 'check', variante: 'primario', clase: 'js-dr-recibir' });
    var cab = x_.cabecera(migas(), (rep.tipo === 'EXTRAORDINARIO' ? rep.titulo : 'Reporte mensual') + ' · ' + x_.perTexto(rep.periodo, true),
      x_.opc.recibe ? 'Preparado por el área y validado por su jefatura.' : 'El área lo prepara, la jefatura lo valida y Administración lo recibe.',
      (x_.opc.recibe ? U.boton({ texto: 'Reportes de las áreas', icono: 'izquierda', variante: 'fantasma', clase: 'js-dr-panel' }) :
        selectorMes(est_.periodo, 'js-dr-mes') + U.boton({ texto: 'Extraordinario', icono: 'nueva', variante: 'fantasma', clase: 'js-dr-extra', titulo: 'Crear un reporte extraordinario de este mes' })));
    var avisos = '';
    if (rep.estado === 'OBSERVADO') avisos += aviso('critico', 'comentario', '<b>Devuelto por ' + txt(nombre(rep.devuelto_por)) + '</b> (' + txt(fecha(rep.fecha_devolucion)) + '): ' + txt(rep.motivo_devolucion));
    if (ac.enviar && !(d.jefaturas || []).length && !esJefatura) avisos += aviso('alerta', 'alerta', 'El área todavía no tiene <b>jefatura</b> asignada: no se podrá enviar hasta que el administrador la marque en Accesos.');
    if (ac.validar) avisos += aviso('info', 'escudoCheck', 'Revisa el reporte de tu área: <b>valídalo</b> para entregarlo a Administración, o <b>devuélvelo</b> con lo que hay que corregir.');
    if (ac.recibir) avisos += aviso('info', 'bandeja', 'La jefatura validó este reporte y te lo entregó. <b>Recíbelo</b> o devuélvelo al área con una observación.');
    var historial = (d.historial || []).length ? '<ul class="dr-hist">' + d.historial.slice().reverse().map(function (h) {
      return '<li><span class="dr-hist__punto"></span><span><strong>' + txt(nombre(h.usuario_email)) + '</strong> ' + txt((ACCION_TXT[h.accion] || h.accion).toLowerCase()) + '<span class="sx2-tenue"> · ' + txt(fecha(h.fecha)) + '</span>' +
        (h.accion === 'REPORTE_DEVUELTO' || h.accion === 'REPORTE_VALIDADO' || h.accion === 'REPORTE_RECIBIDO' ? '<br><span class="sx2-tenue">' + txt(h.detalle) + '</span>' : '') + '</span></li>';
    }).join('') + '</ul>' : '<p class="sx2-tenue">Todavía sin movimientos.</p>';
    var principal = editando ? U.card({ i: 1, titulo: 'Contenido del reporte', icono: 'documento', cuerpo: formulario(d) }) + U.card({ i: 2, cuerpo: bloqueAuto(d.auto, false, rep) }) : documento(d);
    var lateral = U.card({ i: 2, titulo: 'Historial', icono: 'reloj', cuerpo: historial }) +
      (x_.opc.recibe ? '' : U.card({ i: 3, titulo: 'Reportes de ' + est_.periodo.slice(0, 4), icono: 'calendario', cuerpo: '<div class="js-dr-lista">' + listaAnio() + '</div>' }));
    x_.pagina(cab + pasos(rep, d.jefaturas) + avisos +
      (botones ? '<div class="dr-barra sx2-entra">' + U.badge(ETIQ[rep.estado] || rep.estado, TONO[rep.estado]) + '<span style="flex:1"></span>' + botones + '</div>' : '<div class="dr-barra sx2-entra">' + U.badge(ETIQ[rep.estado] || rep.estado, TONO[rep.estado]) + '</div>') +
      '<div class="dr-cols"><div class="dr-principal">' + principal + '</div><aside class="dr-lateral">' + lateral + '</aside></div>', silencioso);
    var doc = x_.raiz().querySelector('.js-dr-doc');
    if (doc) R().wireAcciones(doc, { nombreArchivo: 'Reporte ' + rep.depto_nombre + ' ' + x_.perTexto(rep.periodo) });
  }

  // --- acciones -------------------------------------------------------------------------------
  function pedido() {
    var d = est_.datos, rep = d.reporte;
    return rep.reporte_id ? { reporte_id: rep.reporte_id } : { depto: rep.depto, periodo: rep.periodo, tipo: rep.tipo };
  }
  function trasAccion(r, irA) {
    if (!r || !r.ok) { window.PYv2.aviso((r && r.message) || 'No se pudo.', 'error'); return false; }
    window.PYv2.aviso((r.data && r.data.message) || 'Listo.', 'exito');
    if (x_.contadores) x_.contadores();
    x_.irAItem(irA || 'reporte:' + r.data.reporte.reporte_id);
    return true;
  }
  function guardar() {
    var c = leerFormulario();
    var b = x_.raiz().querySelector('.js-dr-guardar'); if (b) b.disabled = true;
    x_.api('guardarReporteDep', Object.assign(pedido(), { contenido: c })).then(function (r) { if (b) b.disabled = false; trasAccion(r); });
  }
  function enviar() {
    var c = leerFormulario();
    if (!c || !c.resumen.trim()) { window.PYv2.aviso('Escribe el resumen del mes antes de enviarlo.', 'error'); var t = x_.raiz().querySelector('[name="resumen"]'); if (t) t.focus(); return; }
    var esJefatura = !!(x_.cfg && x_.cfg.departamentos[0] && x_.cfg.departamentos[0].jefatura);
    U.confirmar({ titulo: esJefatura ? '¿Enviar a Administración?' : '¿Enviar a la jefatura?', texto: esJefatura
      ? 'Como jefatura del área, al enviarlo queda validado y llega a Administración. Ya no se podrá editar, salvo que lo devuelvan.'
      : 'Le llega a la jefatura del área para que lo valide. Ya no se podrá editar, salvo que te lo devuelvan.', boton: 'Enviar' }).then(function (ok) {
      if (ok) x_.api('enviarReporteDep', Object.assign(pedido(), { contenido: c })).then(function (r) { trasAccion(r); });
    });
  }
  function conObservacion(titulo, boton, obligatoria, accion, ayuda) {
    U.formulario({ titulo: titulo, boton: boton,
      campos: U.campo(obligatoria ? 'Qué hay que corregir' : 'Nota (opcional)', '<textarea class="sx2-input" name="observacion" rows="4"' + (obligatoria ? ' required' : '') + '></textarea>', ayuda || ''),
      preparar: function (v) { if (obligatoria && !v.observacion) return 'Escribe qué hay que corregir.'; return { reporte_id: est_.datos.reporte.reporte_id, observacion: v.observacion }; },
      enviar: function (p) { return x_.api(accion, p); },
      aviso: function (r) { return (r && r.data && r.data.message) || 'Listo.'; },
      listo: function (r) { if (x_.contadores) x_.contadores(); x_.irAItem('reporte:' + ((r && r.data && r.data.reporte && r.data.reporte.reporte_id) || est_.datos.reporte.reporte_id)); } });
  }
  function nuevoExtra() {
    U.formulario({ titulo: 'Reporte extraordinario · ' + x_.perTexto(est_.periodo, true), boton: 'Crear',
      campos: U.campo('Título', '<input class="sx2-input" name="titulo" maxlength="120" required placeholder="Ej.: Fiscalización de la DT">', 'Para un hecho puntual fuera del reporte mensual. Sigue el mismo camino: jefatura y Administración.'),
      preparar: function (v) { if (!v.titulo) return 'Ponle un título.'; return { depto: x_.opc.depto, periodo: est_.periodo, tipo: 'EXTRAORDINARIO', titulo: v.titulo, contenido: {} }; },
      enviar: function (p) { return x_.api('guardarReporteDep', p); },
      aviso: function () { return 'Reporte extraordinario creado.'; },
      listo: function (r) { if (r && r.data && r.data.reporte) x_.irAItem('reporte:' + r.data.reporte.reporte_id); } });
  }

  // =========================================================================================
  // Administración: los reportes de las cuatro áreas
  // =========================================================================================
  function panel(ctx) {
    x_ = ctx;
    if (!est_.adminPeriodo) est_.adminPeriodo = mesCerrado();
    var t = ++est_.turno;
    x_.pagina(x_.cabecera(x_.modNombre, 'Reportes de las áreas', 'Cargando…') + U.esqueleto('kpis', 4) + U.esqueleto('tarjetas', 4));
    x_.api('panelReportesDep', { periodo: est_.adminPeriodo }).then(function (r) {
      if (t !== est_.turno) return;
      if (!r || !r.ok) { x_.pagina(x_.cabecera(x_.modNombre, 'Reportes de las áreas', '') + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || '' }) })); return; }
      var d = r.data;
      var correos = [];
      d.areas.forEach(function (a) { correos = correos.concat(a.jefaturas); if (a.reporte) correos.push(a.reporte.autor_email, a.reporte.validado_por); });
      pintarPanel(d);
      resolver(correos).then(function () { if (t === est_.turno) pintarPanel(d, true); });
    });
  }
  function pintarPanel(d, silencioso) {
    var porValidar = d.areas.filter(function (a) { return a.estado === 'EN_REVISION'; }).length;
    var enCurso = d.areas.filter(function (a) { return a.estado === 'SIN_INICIAR' || a.estado === 'BORRADOR' || a.estado === 'OBSERVADO'; }).length;
    var kp = '<div class="dr-kpis">' +
      U.kpi({ icono: 'check', etiqueta: 'Recibidos', valor: d.cuenta.recibidos + ' de ' + d.cuenta.total, tono: d.cuenta.recibidos === d.cuenta.total ? 'ok' : '', i: 1 }) +
      U.kpi({ icono: 'bandeja', etiqueta: 'Por recibir', valor: d.cuenta.por_recibir, tono: d.cuenta.por_recibir ? 'primario' : '', i: 2 }) +
      U.kpi({ icono: 'escudoCheck', etiqueta: 'Por validar (jefatura)', valor: porValidar, tono: porValidar ? 'alerta' : '', i: 3 }) +
      U.kpi({ icono: 'editar', etiqueta: 'Sin enviar', valor: enCurso, titulo: 'Sin iniciar, en preparación o devueltos al área', i: 4 }) + '</div>';
    var pend = d.por_recibir.filter(function (r) { return r.periodo !== d.periodo || r.tipo !== 'MENSUAL'; });
    var avisoPend = pend.length ? aviso('info', 'bandeja', '<b>Esperan recepción de otros meses o extraordinarios:</b> ' + pend.map(function (r) {
      return '<button type="button" class="sx2-enlace" data-dr-ir="reporte:' + U.esc(r.reporte_id) + '">' + txt(r.depto_nombre + ' · ' + x_.perTexto(r.periodo) + (r.tipo === 'MENSUAL' ? '' : ' · ' + r.titulo)) + '</button>';
    }).join(', ')) : '';
    var i = 4;
    var tarjetas = '<div class="dr-areas">' + d.areas.map(function (a) {
      var rep = a.reporte;
      var cuerpo = '<div class="dr-area__estado">' + U.badge(d.etiquetas[a.estado] || a.estado, TONO[a.estado]) + '</div>' +
        '<dl class="dr-area__datos"><div><dt>Jefatura</dt><dd>' + (a.jefaturas.length ? txt(a.jefaturas.map(nombre).join(', ')) : '<i>sin asignar</i>') + '</dd></div>' +
        (rep && rep.fecha_envio ? '<div><dt>Envió</dt><dd>' + txt(nombre(rep.autor_email)) + ' · ' + txt(fecha(rep.fecha_envio)) + '</dd></div>' : '') +
        (rep && rep.fecha_validacion ? '<div><dt>Validó</dt><dd>' + txt(nombre(rep.validado_por)) + ' · ' + txt(fecha(rep.fecha_validacion)) + '</dd></div>' : '') + '</dl>' +
        '<div class="dr-area__hist" aria-label="Últimos 6 meses">' + a.historia.map(function (h) {
          return '<span class="dr-mes dr-mes--' + h.estado.toLowerCase() + '" title="' + U.esc(x_.perTexto(h.periodo, true) + ': ' + (d.etiquetas[h.estado] || h.estado)) + '">' + txt(x_.perTexto(h.periodo).split(' ')[0]) + '</span>';
        }).join('') + '</div>' +
        (a.extraordinarios.length ? '<p class="sx2-tenue" style="margin:8px 0 0">' + a.extraordinarios.map(function (x) { return '<button type="button" class="sx2-enlace" data-dr-ir="reporte:' + U.esc(x.reporte_id) + '">Extraordinario: ' + txt(x.titulo) + '</button>'; }).join(' · ') + '</p>' : '') +
        '<div class="dr-area__acc">' + (rep ? U.boton({ texto: a.estado === 'VALIDADO' && d.puede_recibir ? 'Revisar y recibir' : 'Abrir el reporte', icono: 'documento', variante: a.estado === 'VALIDADO' ? 'primario' : 'secundario', sm: true, datos: { 'dr-ir': 'reporte:' + rep.reporte_id } }) : '<span class="sx2-tenue">El área todavía no empieza su reporte.</span>') + '</div>';
      return U.card({ i: ++i, titulo: a.nombre, icono: a.icono, cuerpo: cuerpo, clase: 'dr-area dr-area--' + a.estado.toLowerCase() });
    }).join('') + '</div>';
    x_.pagina(x_.cabecera(x_.modNombre, 'Reportes de ' + x_.perTexto(d.periodo, true), 'Cada área prepara su reporte mensual, su jefatura lo valida y llega aquí para que lo recibas.', selectorMes(d.periodo, 'js-dr-mes-adm')) +
      kp + avisoPend + tarjetas +
      '<p class="sx2-tenue dr-leyenda"><span class="dr-mes dr-mes--recibido">mes</span> recibido · <span class="dr-mes dr-mes--validado">mes</span> por recibir · <span class="dr-mes dr-mes--en_revision">mes</span> por validar · <span class="dr-mes dr-mes--observado">mes</span> devuelto · <span class="dr-mes dr-mes--borrador">mes</span> en preparación · <span class="dr-mes dr-mes--sin_iniciar">mes</span> sin iniciar</p>', silencioso);
  }

  // =========================================================================================
  // Tarjeta en el "Resumen del mes" del área
  // =========================================================================================
  function tarjeta(ctx, cont) {
    if (!cont) return;
    var per = ctx.mover(ctx.periodoActual(), -1);
    ctx.api('listarReportesDep', { depto: ctx.opc.depto, anio: per.slice(0, 4) }).then(function (r) {
      if (!r || !r.ok || !cont.isConnected) return;
      var rep = r.data.reportes.filter(function (x) { return x.periodo === per && x.tipo === 'MENSUAL'; })[0];
      var estado = rep ? rep.estado : 'SIN_INICIAR';
      var pendientesJef = r.data.puede.jefatura ? r.data.reportes.filter(function (x) { return x.estado === 'EN_REVISION'; }).length : 0;
      var texto = { SIN_INICIAR: 'Todavía no se empieza.', BORRADOR: 'En preparación: falta enviarlo a la jefatura.', EN_REVISION: 'Enviado: espera la validación de la jefatura.', OBSERVADO: 'Devuelto con observaciones: corrígelo y vuelve a enviarlo.', VALIDADO: 'Validado: espera que Administración lo reciba.', RECIBIDO: 'Recibido por Administración.' }[estado];
      cont.innerHTML = '<div class="dr-tarjeta dr-tarjeta--' + estado.toLowerCase() + ' sx2-entra">' + U.ico('documento', 20) +
        '<span class="dr-tarjeta__txt"><strong>Reporte mensual de ' + txt(ctx.perTexto(per, true)) + '</strong><span>' + txt(texto) + (pendientesJef ? ' Tienes ' + pendientesJef + (pendientesJef === 1 ? ' reporte' : ' reportes') + ' por validar.' : '') + '</span></span>' +
        U.badge(ETIQ[estado], TONO[estado]) +
        U.boton({ texto: estado === 'SIN_INICIAR' ? 'Empezar' : 'Abrir', icono: 'derecha', variante: estado === 'RECIBIDO' ? 'secundario' : 'primario', sm: true, datos: { 'dr-ir': 'reporte' } }) + '</div>';
      U.animar(cont);
    });
  }

  // =========================================================================================
  // Eventos
  // =========================================================================================
  function mio(ev) { var c = x_ && x_.raiz(); return !!c && c.contains(ev.target); }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-dr-ir]');
    // La tarjeta del Resumen vive en el módulo aunque esta vista no se haya abierto todavía.
    if (b) {
      var mod = b.closest('.ci2');
      if (mod && window.SigsoDepartamentos) {
        var m = SigsoDepartamentos.modulo(mod.id.replace(/^ci2-/, ''));
        if (m) { if (b.getAttribute('data-dr-ir') === 'reporte') est_.periodo = ''; m.irAItem(b.getAttribute('data-dr-ir')); }
      }
      return;
    }
    if (!mio(ev)) return;
    var t = ev.target;
    if ((b = t.closest('.js-dr-mes'))) { est_.periodo = x_.mover(est_.periodo, Number(b.getAttribute('data-n'))); x_.irAItem('reporte'); return; }
    if ((b = t.closest('.js-dr-mes-adm'))) { est_.adminPeriodo = x_.mover(est_.adminPeriodo, Number(b.getAttribute('data-n'))); panel(x_); return; }
    if (t.closest('.js-dr-panel')) { x_.irAItem('inicio'); return; }
    if (t.closest('.js-dr-guardar')) { guardar(); return; }
    if (t.closest('.js-dr-enviar')) { enviar(); return; }
    if (t.closest('.js-dr-validar')) { conObservacion('Validar y entregar a Administración', 'Validar', false, 'validarReporteDep', 'Queda registrado que lo validaste; le llega a la Encargada de Administración.'); return; }
    if (t.closest('.js-dr-recibir')) { conObservacion('Recibir el reporte', 'Recibir', false, 'recibirReporteDep', 'Le avisa al área y a su jefatura que lo recibiste.'); return; }
    if (t.closest('.js-dr-devolver')) { conObservacion('Devolver con observaciones', 'Devolver', true, 'devolverReporteDep', 'Vuelve al área para que lo corrija y lo envíe de nuevo.'); return; }
    if (t.closest('.js-dr-extra')) { nuevoExtra(); return; }
    if ((b = t.closest('.js-dr-fila'))) {
      var tabla = x_.raiz().querySelector('[data-tabla="' + b.getAttribute('data-tabla') + '"] tbody');
      var tipo = b.getAttribute('data-tabla');
      if (tabla) { tabla.insertAdjacentHTML('beforeend', filaEditable(tipo === 'act' ? COLS_ACT : COLS_IND, {}, tabla.children.length, tipo)); var ult = tabla.lastElementChild.querySelector('input'); if (ult) ult.focus(); }
      return;
    }
    if ((b = t.closest('.js-dr-quitar'))) { var tr = b.closest('tr'); if (tr && tr.parentNode.children.length > 1) tr.remove(); else if (tr) tr.querySelectorAll('input').forEach(function (i) { i.value = ''; }); }
  });

  window.SigsoReporteDepto = { mostrar: mostrar, panel: panel, tarjeta: tarjeta };
})();
