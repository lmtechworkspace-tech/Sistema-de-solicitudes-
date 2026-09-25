/**
 * calidad-mejora-v2.js — Calidad: "Seguimiento y mejora" 100 % v2 (SIGSO v2,
 * R8 del retiro de la versión clásica; ver documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 * No conformidades (§10.2), Quejas (§9.1.2), Auditorías internas (§9.2) y
 * Revisión por la dirección (§9.3). Cada una: lista con KPIs, filtros y
 * búsqueda; la ficha se abre en un panel lateral ancho con sus etapas en
 * orden y, en cada etapa, solo la acción que corresponde a su estado.
 * Mismos endpoints que calidad.js (listar*, getDetalle*, registrar*, …);
 * los permisos los decide el backend (puede_gestionar / puede_auditar /
 * puede_investigar) y aquí solo se esconden botones.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  function C() { return window.SigsoCalidadV2.util; }
  function api(a, d) { return C().api(a, d); }

  // --- Etiquetas (mismas que calidad.js) ------------------------------------------------
  var FUENTE_NC = { AUDITORIA_INTERNA: 'Auditoría interna', AUDITORIA_EXTERNA: 'Auditoría externa', QUEJA: 'Queja / reclamo',
    REVISION_DIRECCION: 'Revisión por la dirección', PROCESO: 'Detectada en el proceso', OTRO: 'Otra' };
  var ESTADO_NC = { ABIERTA: ['Abierta', 'info'], EN_CORRECCION: ['En corrección', 'alerta'], EN_ACCION: ['En acción correctiva', 'alerta'],
    EN_VERIFICACION: ['Verificando eficacia', 'primario'], CERRADA: ['Cerrada', 'ok'], ANULADA: ['Anulada', 'neutro'] };
  var ESTADO_TAREA = { NO_INICIADA: 'Sin empezar', EN_CURSO: 'En curso', BLOQUEADA: 'Bloqueada', EN_REVISION: 'En revisión', TERMINADA: 'Terminada', CANCELADA: 'Cancelada' };
  var TONO_SEMAFORO = { atrasada: 'critico', riesgo: 'alerta', bloqueada: 'info', pendiente: 'neutro', revision: 'primario', 'al-dia': 'ok', terminada: 'ok', cancelada: 'neutro' };
  var ESTADO_AUD = { PROGRAMADA: ['Programada', 'neutro'], PLANIFICADA: ['Planificada', 'info'], EJECUTADA: ['Ejecutada', 'alerta'],
    INFORMADA: ['Informada', 'primario'], CERRADA: ['Cerrada', 'ok'], ANULADA: ['Anulada', 'neutro'] };
  var RESULTADO_H = { CONFORME: ['Conforme', 'ok'], OBSERVACION: ['Observación', 'alerta'], NO_CONFORMIDAD: ['No conformidad', 'critico'], OPORTUNIDAD: ['Oportunidad de mejora', 'info'] };
  var TIPO_QUEJA = { QUEJA: ['Queja', 'critico'], RECLAMACION: ['Reclamación', 'critico'], FELICITACION: ['Felicitación', 'ok'], CONSULTA: ['Consulta', 'info'] };
  var ESTADO_QUEJA = { RECIBIDA: ['Recibida', 'info'], NO_PROCEDE: ['No procede', 'neutro'], EN_INVESTIGACION: ['En investigación', 'alerta'],
    NO_VALIDA: ['No válida', 'neutro'], EN_RESOLUCION: ['En resolución', 'alerta'], RESUELTA: ['Resuelta', 'primario'], NOTIFICADA: ['Notificada', 'primario'],
    CERRADA: ['Cerrada', 'ok'], REABIERTA: ['Reabierta', 'critico'], ANULADA: ['Anulada', 'neutro'] };
  var AREA_QUEJA = { RRHH: 'RRHH', CONTABILIDAD: 'Contabilidad', PREVENCION: 'Prevención de Riesgos', MARKETING: 'Marketing', ADMINISTRACION: 'Administración', OTRO: 'Otro' };
  var ESTADO_REV = { PROGRAMADA: ['Programada', 'neutro'], CONVOCADA: ['Convocada', 'info'], REALIZADA: ['Realizada', 'alerta'], CERRADA: ['Cerrada', 'ok'], ANULADA: ['Anulada', 'neutro'] };
  var CERRADAS_QUEJA = ['CERRADA', 'NO_PROCEDE', 'NO_VALIDA', 'ANULADA'];
  var VISTAS = {
    nc: ['No conformidades', 'Ciclo de mejora: corregir, entender por qué pasó, evitar que se repita y verificar que funcionó.'],
    quejas: ['Quejas', 'Llegan solas desde el formulario público. El plazo de respuesta es de 30 días corridos desde que se valida.'],
    auditorias: ['Auditorías internas', 'El programa anual: qué proceso se audita, cuándo y quién lo audita. Nadie audita su propia área.'],
    revision: ['Revisión por la dirección', 'Se convoca con anticipación y se registra el acta con los 13 temas que exige la norma (§9.3).']
  };

  var est_ = {
    nc: { datos: null, filtro: 'abiertas', q: '' },
    quejas: { datos: null, filtro: 'abiertas', q: '' },
    auditorias: { datos: null, anio: '', q: '' },
    revision: { datos: null }
  };
  var vista_ = '', turno_ = 0;

  // --- Utilidades ------------------------------------------------------------------------
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function coincide(texto, q) { var ws = norm(q).split(/\s+/).filter(Boolean), h = norm(texto); return ws.every(function (w) { return h.indexOf(w) !== -1; }); }
  function fecha(v) {
    if (!v) return '—';
    var s = String(v);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? PY.fecha(s, true) : (C().fechaChile(s) || PY.fecha(s, true));
  }
  function iso(v) { var m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : ''; }
  function plural(n, s, p) { return n + ' ' + (n === 1 ? s : (p || s + 's')); }
  function si(v) { return v === true || v === 'TRUE' || v === 'true'; }
  function persona(email, extra) {
    if (!email) return '<span class="sx2-tenue">—</span>';
    var p = PY.persona(email);
    return '<span class="sx2-flex" style="gap:6px;align-items:center;min-width:0">' + U.avatar(p, 'xs') + '<span class="sx2-cortar">' + U.esc(p.nombre) + (extra ? ' <small class="sx2-tenue">' + U.esc(extra) + '</small>' : '') + '</span></span>';
  }
  function lineas(t) { return String(t || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); }
  function correos(t) { return String(t || '').split(/[,\n;]/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function esCorreo(t) { return /^[^\s@]+@[^\s@]+$/.test(String(t || '').trim()); }
  function badge(par) { return par ? U.badge(par[0], par[1]) : ''; }
  function plazoTxt(dias) {
    if (dias === null || dias === undefined || dias === '') return '';
    return dias < 0 ? 'vencida hace ' + (-dias) + ' d' : (dias === 0 ? 'vence hoy' : 'quedan ' + dias + ' d');
  }
  function resolverCorreos(lista, t) {
    lista = lista.filter(Boolean);
    if (!lista.length) return;
    Promise.all([window.SigsoDirectorio ? SigsoDirectorio.resolver(lista) : Promise.resolve(), U.precargarFotos(lista)])
      .then(function () { if (t === turno_) pintar(true); });
  }

  // --- Marco -----------------------------------------------------------------------------
  function cabecera(acciones) {
    var v = VISTAS[vista_];
    return '<header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Calidad · Seguimiento y mejora</span><h1>' + U.esc(v[0]) + '</h1>' +
      '<span class="sx2-tenue" style="font-size:.875rem">' + U.esc(v[1]) + '</span></div>' +
      '<div class="sx2-cabecera__acciones">' + (acciones || '') + U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-mj2-recargar' }) + '</div></header>';
  }
  function pagina(html, silencioso) {
    var c = C().contenedor(vista_);
    if (!c) return;
    var y = window.scrollY;
    var foco = document.activeElement && document.activeElement.classList.contains('js-mj2-q');
    c.innerHTML = '<div class="sx2-pagina">' + html + '</div>';
    if (silencioso) { c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; }); window.scrollTo(0, y); }
    if (foco) { var q = c.querySelector('.js-mj2-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
    U.animar(c);
  }
  function error(r) {
    pagina(cabecera() + U.card({ i: 1, cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || 'Inténtalo de nuevo.',
      accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-mj2-recargar' }) }) }));
  }
  function buscador(valor, ph) {
    return '<label class="sx2-buscar">' + U.ico('lupa', 16) + '<input class="sx2-input js-mj2-q" type="search" placeholder="' + U.esc(ph) + '" value="' + U.esc(valor || '') + '"></label>';
  }
  function fila(o) {
    // o: { id, codigo, titulo, badges, meta: [], texto, tono }
    return '<li class="mj2-fila' + (o.tono ? ' sx2-tono-' + o.tono + ' mj2-fila--marca' : '') + (o.apagada ? ' mj2-fila--off' : '') + '" data-mj2-id="' + U.esc(o.id) + '" tabindex="0">' +
      '<span class="sx2-apilado" style="gap:5px;min-width:0;flex:1">' +
        '<span class="sx2-flex" style="gap:8px;flex-wrap:wrap;align-items:center"><code class="mj2-cod">' + U.esc(o.codigo || '') + '</code><strong class="mj2-fila__tit">' + U.esc(o.titulo || '') + '</strong>' + (o.badges || '') + '</span>' +
        (o.texto ? '<span class="sx2-tenue mj2-fila__txt">' + U.esc(o.texto) + '</span>' : '') +
        (o.meta && o.meta.length ? '<span class="mj2-meta">' + o.meta.filter(Boolean).map(function (m) { return '<span>' + m + '</span>'; }).join('') + '</span>' : '') +
      '</span>' + U.ico('derecha', 16) + '</li>';
  }
  function lista(filas, vacio) {
    return filas.length ? '<section class="sx2-card sx2-card--sin-relleno sx2-entra" style="--i:3"><ul class="mj2-lista">' + filas.join('') + '</ul></section>'
      : U.card({ i: 3, cuerpo: U.vacio({ icono: 'check', titulo: vacio[0], texto: vacio[1] || '' }) });
  }

  // Panel de ficha: etapas numeradas.
  function etapa(n, titulo, hecho, cuerpo, acciones, actual) {
    return '<li class="mj2-etapa' + (hecho ? ' mj2-etapa--hecha' : '') + (actual ? ' mj2-etapa--actual' : '') + '">' +
      '<span class="mj2-etapa__num">' + (hecho ? U.ico('check', 14) : n) + '</span>' +
      '<div class="mj2-etapa__cuerpo"><h3>' + U.esc(titulo) + '</h3>' + cuerpo + (acciones ? '<div class="mj2-acciones">' + acciones + '</div>' : '') + '</div></li>';
  }
  function ayuda(t) { return '<p class="mj2-ayuda">' + t + '</p>'; }
  function dato(et, v) { return v ? '<dt>' + U.esc(et) + '</dt><dd>' + v + '</dd>' : ''; }
  function panel(titulo, sub, cuerpo, pie) {
    var d = U.drawer({ titulo: titulo, subtitulo: sub, cuerpo: cuerpo, pie: pie || '' });
    d.el.classList.add('sx2-drawer--ancho', 'mj2-panel');
    return d;
  }
  function panelCargando(titulo) { return panel(titulo, '', U.esqueleto('tabla', 6)); }
  function btn(texto, clase, datos, variante, icono) { return U.boton({ texto: texto, sm: true, variante: variante || 'primario', clase: clase, datos: datos, icono: icono }); }
  // Formulario de un paso; al terminar reabre la ficha.
  function paso(o, reabrir) {
    U.formulario({
      titulo: o.titulo, subtitulo: o.sub ? '<span class="sx2-tenue" style="font-size:.8125rem">' + o.sub + '</span>' : '',
      boton: o.boton || 'Guardar', campos: o.campos, ancho: o.ancho, alMontar: o.alMontar,
      preparar: o.preparar, enviar: function (x, form) { return api(o.accion, o.datos(x, form)); },
      aviso: o.aviso, listo: function (r) { recargarSilencioso(); if (reabrir) reabrir(r); }
    });
  }
  function anular(titulo, accion, datos, reabrir) {
    paso({ titulo: titulo, boton: 'Anular', sub: 'Queda registrado; no se borra.', accion: accion,
      campos: U.campo('Motivo', '<textarea class="sx2-input" name="motivo" rows="3" required maxlength="500"></textarea>'),
      preparar: function (x) { return (x.motivo || '').length >= 5 ? x : 'Explica el motivo (mínimo 5 caracteres).'; },
      datos: function (x) { var d = Object.assign({}, datos); d.motivo = x.motivo; return d; }, aviso: 'Anulada.' }, reabrir);
  }
  function confirmarY(o, accion, datos, reabrir) {
    U.confirmar({ titulo: o.titulo, texto: o.texto, boton: o.boton || 'Confirmar' }).then(function (ok) {
      if (!ok) return;
      api(accion, datos).then(function (r) {
        if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo guardar.', 'error'); return; }
        if (o.aviso) PY.aviso(o.aviso, 'exito');
        recargarSilencioso();
        if (reabrir) reabrir();
      });
    });
  }
  // Tras un cambio, la lista de atrás se actualiza en silencio (la ficha es un panel aparte).
  function recargarSilencioso() { if (est_[vista_] && C().ocupa(vista_)) cargar(true); }

  // --- Carga -------------------------------------------------------------------------------
  function datosLista(v) {
    if (v === 'nc') return est_.nc.filtro === 'abiertas' ? { abiertas: true } : {};
    if (v === 'quejas') return est_.quejas.filtro === 'abiertas' ? { abiertas: true } : {};
    if (v === 'auditorias') return est_.auditorias.anio ? { anio: est_.auditorias.anio } : {};
    return {};
  }
  var ACCION_LISTA = { nc: 'listarNcSgc', quejas: 'listarQuejasSgc', auditorias: 'listarAuditoriasSgc', revision: 'listarRevisionesSgc' };
  function cargar(silencioso) {
    var v = vista_, t = ++turno_;
    if (!C().contenedor(v)) return;
    if (!silencioso || !est_[v].datos) pagina(cabecera() + U.esqueleto('kpis', 5) + U.esqueleto('tabla', 6));
    api(ACCION_LISTA[v], datosLista(v)).then(function (r) {
      if (t !== turno_ || v !== vista_ || !C().ocupa(v)) return;
      if (!r || !r.ok) { error(r); return; }
      est_[v].datos = r.data;
      pintar(!!silencioso);
      var cs = [];
      if (v === 'nc') (r.data.no_conformidades || []).forEach(function (x) { cs.push(x.responsable_email); });
      if (v === 'auditorias') (r.data.auditorias || []).forEach(function (x) { cs.push(x.auditor_email); });
      if (v === 'quejas') (r.data.quejas || []).forEach(function (x) { cs.push(x.investigador_email); });
      resolverCorreos(cs, t);
    });
  }
  function pintar(silencioso) {
    if (!C().ocupa(vista_) || !est_[vista_] || !est_[vista_].datos) return;
    if (vista_ === 'nc') pintarNc(silencioso);
    else if (vista_ === 'quejas') pintarQuejas(silencioso);
    else if (vista_ === 'auditorias') pintarAuditorias(silencioso);
    else pintarRevisiones(silencioso);
  }
  function chipsFiltro(actual, abiertas) {
    return U.chip({ texto: 'Abiertas', n: abiertas, activo: actual === 'abiertas', clase: 'js-mj2-filtro', datos: { f: 'abiertas' } }) +
      U.chip({ texto: 'Todas', activo: actual !== 'abiertas', clase: 'js-mj2-filtro', datos: { f: 'todas' } });
  }

  // =========================================================================================
  // No conformidades
  // =========================================================================================
  function pintarNc(silencioso) {
    var d = est_.nc.datos, ind = d.indicadores || {}, puede = d.puede_gestionar === true;
    var l = (d.no_conformidades || []).filter(function (x) { return !est_.nc.q || coincide([x.correlativo, x.descripcion, x.responsable_email, PY.persona(x.responsable_email).nombre, x.area_id, x.referencia_normativa].join(' '), est_.nc.q); });
    var pct = ind.pct_eficacia_positiva;
    pagina(cabecera(puede ? U.boton({ texto: 'Registrar no conformidad', icono: 'nueva', variante: 'primario', clase: 'js-mj2-nueva' }) : '') +
      '<div class="sx2-fila-kpis">' +
        U.kpi({ i: 0, etiqueta: 'Abiertas', valor: ind.abiertas || 0, icono: 'alerta', tono: ind.abiertas ? 'alerta' : 'ok' }) +
        U.kpi({ i: 1, etiqueta: 'Con plazo vencido', valor: ind.vencidas || 0, icono: 'reloj', tono: ind.vencidas ? 'critico' : 'ok' }) +
        U.kpi({ i: 2, etiqueta: 'Cerradas', valor: ind.cerradas || 0, icono: 'check', tono: 'ok' }) +
        U.kpi({ i: 3, etiqueta: 'Días promedio', valor: ind.dias_promedio_resolucion == null ? '—' : ind.dias_promedio_resolucion, unidad: 'para resolver', icono: 'calendario', tono: 'info' }) +
        U.kpi({ i: 4, etiqueta: 'Eficacia', valor: pct == null ? '—' : pct, sufijo: pct == null ? '' : '%', icono: 'diana', tono: pct == null ? 'neutro' : (pct >= 80 ? 'ok' : 'alerta'), progreso: pct == null ? null : pct }) +
      '</div>' +
      '<div class="sx2-card sx2-py-herramientas sx2-entra" style="--i:2"><div class="sx2-barra-filtros">' + buscador(est_.nc.q, 'Buscar por código, descripción, responsable o cláusula…') + chipsFiltro(est_.nc.filtro, ind.abiertas || 0) + '</div></div>' +
      lista(l.map(function (x) {
        var cerrada = x.estado === 'CERRADA' || x.estado === 'ANULADA';
        return fila({ id: x.nc_id, codigo: x.correlativo, titulo: String(x.descripcion || '').slice(0, 120), apagada: cerrada, tono: x.vencida ? 'critico' : '',
          badges: badge(ESTADO_NC[x.estado]) + (x.vencida ? U.badge('Vencida', 'critico', true) : '') + (x.ciclo > 1 ? U.badge('Ciclo ' + x.ciclo, 'alerta', true) : ''),
          meta: [U.esc(FUENTE_NC[x.fuente] || x.fuente || ''), x.referencia_normativa ? '§ ' + U.esc(x.referencia_normativa) : '', x.area_id ? U.esc(x.area_id) : '', persona(x.responsable_email),
            'Detectada ' + U.esc(fecha(x.fecha_deteccion)), x.etapa_actual ? U.esc(x.etapa_actual + (plazoTxt(x.dias_para_plazo) ? ' · ' + plazoTxt(x.dias_para_plazo) : '')) : ''] });
      }), est_.nc.filtro === 'abiertas' ? ['No hay no conformidades abiertas', 'Se registran desde una auditoría, una queja, la revisión por la dirección o el día a día.'] : ['Todavía no hay no conformidades', '']), silencioso);
  }
  function tareaVinculada(t, etiqueta) {
    if (!t) return '';
    return '<div class="mj2-tarea">' + U.ico('tareas', 14) + '<span>' + U.esc(etiqueta) + ' en <b>Mi trabajo</b> de ' + U.esc(PY.persona(t.responsable_email).nombre) +
      (t.fecha_compromiso ? ' · vence ' + U.esc(fecha(t.fecha_compromiso)) : '') + '</span>' +
      U.badge(t.semaforo_etiqueta || '', TONO_SEMAFORO[t.semaforo] || 'neutro') + U.badge(ESTADO_TAREA[t.estado] || t.estado, t.terminada ? 'ok' : 'neutro', true) +
      (t.avance_pct !== '' && t.avance_pct != null ? '<small class="sx2-tenue">' + t.avance_pct + ' %</small>' : '') + '</div>';
  }
  function abrirNc(id) {
    var d = panelCargando('No conformidad');
    api('getDetalleNcSgc', { nc_id: id }).then(function (r) {
      if (!r || !r.ok) { d.cuerpo(U.vacio({ icono: 'alerta', titulo: 'No se pudo abrir', texto: (r && r.message) || '' })); return; }
      d.cerrar(true);
      fichaNc(r.data);
    });
  }
  function fichaNc(data) {
    var nc = data.nc, r = data.resumen || {}, puede = data.puede_gestionar === true;
    var cerrada = nc.estado === 'CERRADA' || nc.estado === 'ANULADA';
    var reabrir = function () { abrirNc(nc.nc_id); };
    var porques = [];
    for (var i = 1; i <= 5; i++) if (nc['porque_' + i]) porques.push('<li>' + U.esc(nc['porque_' + i]) + '</li>');
    var actual = !nc.correccion_fecha_cierre ? 1 : (!r.tiene_causa ? 2 : (!nc.accion_fecha_cierre ? 3 : 4));
    var e1 = etapa(1, 'Corrección inmediata', !!nc.correccion_fecha_cierre,
      nc.correccion_descripcion ? '<p>' + U.esc(nc.correccion_descripcion) + '</p>' + tareaVinculada(data.correccion_actividad, 'Corrección') +
        (nc.correccion_fecha_cierre ? ayuda('Cerrada el ' + U.esc(fecha(nc.correccion_fecha_cierre)) + '.') : '')
        : ayuda('Qué se hace ahora para contener el problema. Plazo: ' + U.esc(fecha(nc.correccion_plazo)) + ' (10 días hábiles).'),
      puede && !cerrada ? (!nc.correccion_actividad_id ? btn('Definir corrección', 'js-nc-correccion') : (!nc.correccion_fecha_cierre ? btn('Marcar corrección cerrada', 'js-nc-cerrar-correccion', null, 'secundario', 'check') : '')) : '', actual === 1 && !cerrada);
    var e2 = etapa(2, 'Análisis de causa (5 por qué)', !!r.tiene_causa,
      r.tiene_causa ? (porques.length ? '<ol class="mj2-porques">' + porques.join('') + '</ol>' : '') + '<p><b>Causa raíz:</b> ' + U.esc(nc.causa_raiz) + '</p>'
        : ayuda('Por qué ocurrió realmente. Sin esto, la acción correctiva ataca el síntoma.'),
      puede && !cerrada ? btn(r.tiene_causa ? 'Editar análisis' : 'Registrar análisis', 'js-nc-causa', null, r.tiene_causa ? 'secundario' : 'primario') : '', actual === 2 && !cerrada);
    var e3 = etapa(3, 'Acción correctiva', !!nc.accion_fecha_cierre,
      nc.accion_descripcion ? '<p>' + U.esc(nc.accion_descripcion) + '</p>' + tareaVinculada(data.accion_actividad, 'Acción correctiva') +
        (nc.accion_fecha_cierre ? ayuda('Implementada el ' + U.esc(fecha(nc.accion_fecha_cierre)) + '.') : '')
        : ayuda('Qué se cambia para que no vuelva a pasar. Plazo: 20 días hábiles desde la corrección.' + (!r.tiene_causa ? ' Primero va el análisis de causa.' : '')),
      puede && !cerrada && r.tiene_causa ? (!nc.accion_actividad_id ? btn('Definir acción correctiva', 'js-nc-accion') : (!nc.accion_fecha_cierre ? btn('Marcar acción implementada', 'js-nc-cerrar-accion', null, 'secundario', 'check') : '')) : '', actual === 3 && !cerrada);
    var e4 = etapa(4, 'Verificación de eficacia', nc.eficacia_resultado === 'EFICAZ',
      nc.eficacia_resultado ? '<p>' + (nc.eficacia_resultado === 'EFICAZ' ? U.badge('Eficaz', 'ok') : U.badge('No eficaz', 'critico')) + ' ' + U.esc(nc.eficacia_observaciones || '') + '</p>' +
        (r.ciclo > 1 && nc.estado !== 'CERRADA' ? ayuda('Resultado del ciclo ' + (r.ciclo - 1) + '. La verificación se repite con la acción correctiva nueva.') : '')
        : ayuda('¿Funcionó? Se verifica 60 días hábiles después de implementarla' + (nc.eficacia_plazo ? ', desde el ' + U.esc(fecha(nc.eficacia_plazo)) : '') + '.'),
      puede && nc.estado === 'EN_VERIFICACION' ? btn('Verificar eficacia', 'js-nc-eficacia') : '', actual === 4 && nc.estado === 'EN_VERIFICACION');
    var d = panel(nc.correlativo + ' · No conformidad',
      '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + badge(ESTADO_NC[nc.estado]) + (r.vencida ? U.badge('Plazo vencido', 'critico') : '') + (r.ciclo > 1 ? U.badge('Vuelta ' + r.ciclo + ' del ciclo', 'alerta') : '') + '</span>',
      (r.ciclo > 1 ? '<div class="mj2-aviso sx2-tono-alerta">' + U.ico('alerta', 16) + '<span>Esta es la vuelta ' + r.ciclo + ' del ciclo: la acción correctiva anterior no fue eficaz.</span></div>' : '') +
      '<p class="mj2-desc">' + U.esc(nc.descripcion) + '</p>' +
      '<dl class="sx2-dato mj2-datos">' + dato('Fuente', U.esc(FUENTE_NC[nc.fuente] || nc.fuente)) + dato('Referencia normativa', nc.referencia_normativa ? U.esc(nc.referencia_normativa) : '') +
        dato('Área', nc.area_id ? U.esc(nc.area_id) : '') + dato('Responsable', persona(nc.responsable_email)) + dato('Detectada', U.esc(fecha(nc.fecha_deteccion)) + (nc.detectada_por ? ' · ' + U.esc(PY.persona(nc.detectada_por).nombre) : '')) +
        (nc.fecha_cierre ? dato(nc.estado === 'ANULADA' ? 'Anulada' : 'Cerrada', U.esc(fecha(nc.fecha_cierre))) : '') + '</dl>' +
      '<ol class="mj2-etapas">' + e1 + e2 + e3 + e4 + '</ol>',
      puede && !cerrada ? U.boton({ texto: 'Anular', icono: 'basura', variante: 'texto-peligro', clase: 'js-nc-anular' }) + '<span style="flex:1"></span>' + U.boton({ texto: 'Cerrar', clase: 'js-sx2-drawer-cerrar' }) : U.boton({ texto: 'Cerrar', clase: 'js-sx2-drawer-cerrar' }));
    d.el.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t.closest('.js-nc-correccion')) formAccionNc(nc, 'CORRECCION', reabrir);
      else if (t.closest('.js-nc-accion')) formAccionNc(nc, 'ACCION', reabrir);
      else if (t.closest('.js-nc-causa')) formCausaNc(nc, reabrir);
      else if (t.closest('.js-nc-eficacia')) formEficaciaNc(nc, reabrir);
      else if (t.closest('.js-nc-cerrar-correccion')) confirmarY({ titulo: '¿La corrección ya se realizó?', texto: 'Después viene el análisis de causa.', boton: 'Marcar cerrada' }, 'cerrarEtapaNcSgc', { nc_id: nc.nc_id, etapa: 'CORRECCION' }, reabrir);
      else if (t.closest('.js-nc-cerrar-accion')) confirmarY({ titulo: '¿Marcar la acción como implementada?', texto: 'Arranca el plazo de 60 días hábiles para verificar si funcionó.', boton: 'Marcar implementada' }, 'cerrarEtapaNcSgc', { nc_id: nc.nc_id, etapa: 'ACCION' }, reabrir);
      else if (t.closest('.js-nc-anular')) anular('Anular ' + nc.correlativo, 'anularNcSgc', { nc_id: nc.nc_id }, reabrir);
    });
    resolverCorreos([nc.responsable_email], turno_);
  }
  function formNc() {
    paso({ titulo: 'Registrar no conformidad', boton: 'Registrar', accion: 'crearNcSgc', ancho: true,
      campos: U.campo('Qué pasó', '<textarea class="sx2-input" name="descripcion" rows="4" required placeholder="Describe la desviación con hechos concretos."></textarea>') +
        '<div class="sx2-form__fila">' + U.campo('¿De dónde salió?', '<select class="sx2-select" name="fuente">' + Object.keys(FUENTE_NC).map(function (k) { return '<option value="' + k + '"' + (k === 'PROCESO' ? ' selected' : '') + '>' + U.esc(FUENTE_NC[k]) + '</option>'; }).join('') + '</select>') +
          U.campo('Área', '<input class="sx2-input" name="area_id" placeholder="Ej.: RRHH">') + '</div>' +
        '<div class="sx2-form__fila">' + U.campo('Responsable', '<input class="sx2-input" type="email" name="responsable_email" required placeholder="A quién se le asigna resolverla">') +
          U.campo('Fecha de detección', '<input class="sx2-input" type="date" name="fecha_deteccion" value="' + PY.hoyClave() + '" max="' + PY.hoyClave() + '">') + '</div>' +
        U.campo('Referencia normativa (opcional)', '<input class="sx2-input" name="referencia_normativa" placeholder="Ej.: 7.5, si ya sabes qué cláusula se incumplió">'),
      preparar: function (x) { if ((x.descripcion || '').length < 10) return 'Describe qué pasó (mínimo 10 caracteres).'; return esCorreo(x.responsable_email) ? x : 'Indica el correo del responsable.'; },
      datos: function (x) { return x; }, aviso: 'No conformidad registrada.' }, function (r) { cargar(true); if (r && r.data && r.data.nc_id) abrirNc(r.data.nc_id); });
  }
  function formAccionNc(nc, tipo, reabrir) {
    var corr = tipo === 'CORRECCION';
    paso({ titulo: corr ? 'Definir corrección' : 'Definir acción correctiva', boton: 'Crear y asignar', accion: corr ? 'registrarCorreccionNcSgc' : 'registrarAccionNcSgc',
      sub: (corr ? 'Qué se hace ahora para contener el problema.' : 'Qué se cambia para que la causa raíz no vuelva a producirlo.') + ' Se crea como tarea en "Mi trabajo" del responsable.',
      campos: U.campo('Descripción', '<textarea class="sx2-input" name="descripcion" rows="4" required></textarea>') +
        '<div class="sx2-form__fila">' + U.campo('Responsable', '<input class="sx2-input" type="email" name="responsable_email" value="' + U.esc(nc.responsable_email || '') + '">') +
          U.campo('Fecha comprometida', '<input class="sx2-input" type="date" name="fecha_compromiso" value="' + U.esc(corr ? iso(nc.correccion_plazo) : '') + '">') + '</div>',
      preparar: function (x) { return (x.descripcion || '').length >= 5 ? x : 'Describe la acción.'; },
      datos: function (x) { var d = { nc_id: nc.nc_id, descripcion: x.descripcion, responsable_email: x.responsable_email }; if (x.fecha_compromiso) d.fecha_compromiso = x.fecha_compromiso; return d; },
      aviso: 'Creada y asignada: aparece en "Mi trabajo".' }, reabrir);
  }
  function formCausaNc(nc, reabrir) {
    var campos = '';
    for (var i = 1; i <= 5; i++) campos += U.campo('¿Por qué? (' + i + ')', '<input class="sx2-input" name="porque_' + i + '" value="' + U.esc(nc['porque_' + i] || '') + '" placeholder="' + (i === 1 ? '¿Por qué ocurrió?' : '¿Y por qué pasó eso?') + '">');
    paso({ titulo: 'Análisis de causa — 5 por qué', boton: 'Guardar análisis', accion: 'registrarCausaNcSgc', ancho: true,
      sub: 'Encadena los porqués hasta llegar a algo que puedas cambiar. No siempre hacen falta los cinco.',
      campos: campos + U.campo('Causa raíz', '<textarea class="sx2-input" name="causa_raiz" rows="3" required placeholder="La causa real, la que hay que atacar.">' + U.esc(nc.causa_raiz || '') + '</textarea>') +
        U.campo('Referencia normativa', '<input class="sx2-input" name="referencia_normativa" value="' + U.esc(nc.referencia_normativa || '') + '" placeholder="Ej.: 7.5">'),
      preparar: function (x) { if (!x.porque_1) return 'Responde al menos el primer "¿por qué?".'; return (x.causa_raiz || '').length >= 5 ? x : 'Indica la causa raíz.'; },
      datos: function (x) { x.nc_id = nc.nc_id; return x; }, aviso: 'Análisis guardado.' }, reabrir);
  }
  function formEficaciaNc(nc, reabrir) {
    paso({ titulo: 'Verificar eficacia', boton: 'Guardar', accion: 'verificarEficaciaNcSgc', sub: '¿La acción correctiva evitó que el problema se repitiera?',
      campos: U.campo('Resultado', '<select class="sx2-select" name="resultado"><option value="EFICAZ">Eficaz — se cierra la no conformidad</option><option value="NO_EFICAZ">No eficaz — se reabre con un ciclo nuevo</option></select>') +
        U.campo('Cómo lo verificaste', '<textarea class="sx2-input" name="observaciones" rows="4" required placeholder="Qué revisaste y qué encontraste. Es la evidencia de que se comprobó."></textarea>'),
      preparar: function (x) { return (x.observaciones || '').length >= 10 ? x : 'Cuenta cómo lo verificaste (mínimo 10 caracteres).'; },
      datos: function (x) { return { nc_id: nc.nc_id, resultado: x.resultado, observaciones: x.observaciones }; },
      aviso: function (r) { return r && r.data && r.data.estado === 'CERRADA' ? 'No conformidad cerrada.' : 'Guardado.'; } }, reabrir);
  }

  // =========================================================================================
  // Quejas
  // =========================================================================================
  function pintarQuejas(silencioso) {
    var d = est_.quejas.datos, ind = d.indicadores || {};
    var l = (d.quejas || []).filter(function (x) { return !est_.quejas.q || coincide([x.correlativo, x.nombre_completo, x.empresa, x.descripcion, x.investigador_email].join(' '), est_.quejas.q); });
    pagina(cabecera(U.boton({ texto: 'Formulario público', icono: 'enlace', variante: 'fantasma', clase: 'js-mj2-publico' })) +
      '<div class="sx2-fila-kpis">' +
        U.kpi({ i: 0, etiqueta: 'Este año', valor: ind.total_anio || 0, icono: 'bandeja', tono: 'primario', unidad: (ind.quejas_anio || 0) + ' quejas · ' + (ind.felicitaciones_anio || 0) + ' felicitaciones · ' + (ind.consultas_anio || 0) + ' consultas' }) +
        U.kpi({ i: 1, etiqueta: 'Abiertas', valor: ind.abiertas || 0, icono: 'alerta', tono: ind.abiertas ? 'alerta' : 'ok' }) +
        U.kpi({ i: 2, etiqueta: 'Con plazo vencido', valor: ind.vencidas || 0, icono: 'reloj', tono: ind.vencidas ? 'critico' : 'ok' }) +
      '</div>' +
      '<div class="sx2-card sx2-py-herramientas sx2-entra" style="--i:2"><div class="sx2-barra-filtros">' + buscador(est_.quejas.q, 'Buscar por código, cliente, empresa o texto…') + chipsFiltro(est_.quejas.filtro, ind.abiertas || 0) + '</div></div>' +
      lista(l.map(function (x) {
        var cerrada = CERRADAS_QUEJA.indexOf(x.estado) !== -1;
        return fila({ id: x.queja_id, codigo: x.correlativo, titulo: x.nombre_completo + (x.empresa ? ' (' + x.empresa + ')' : ''), apagada: cerrada, tono: x.vencida ? 'critico' : '',
          badges: badge(TIPO_QUEJA[x.tipo]) + badge(ESTADO_QUEJA[x.estado]) + (x.vencida ? U.badge('Vencida', 'critico', true) : '') + (x.tiene_nc ? U.badge('Con NC', 'alerta', true) : ''),
          texto: String(x.descripcion || '').slice(0, 160),
          meta: [U.esc(AREA_QUEJA[x.area] || x.area || ''), 'Recibida ' + U.esc(fecha(x.fecha_envio)), x.investigador_email ? 'Investiga ' + U.esc(PY.persona(x.investigador_email).nombre) : '',
            x.etapa_actual ? U.esc(x.etapa_actual + (plazoTxt(x.dias_para_plazo) ? ' · ' + plazoTxt(x.dias_para_plazo) : '')) : ''] });
      }), est_.quejas.filtro === 'abiertas' ? ['No hay quejas abiertas', 'Llegan solas desde el formulario público del sitio.'] : ['Todavía no hay quejas, felicitaciones ni consultas', '']), silencioso);
  }
  function abrirQueja(id) {
    var d = panelCargando('Queja');
    api('getDetalleQuejaSgc', { queja_id: id }).then(function (r) {
      if (!r || !r.ok) { d.cuerpo(U.vacio({ icono: 'alerta', titulo: 'No se pudo abrir', texto: (r && r.message) || '' })); return; }
      d.cerrar(true);
      fichaQueja(r.data);
    });
  }
  function fichaQueja(data) {
    var q = data.queja, puede = data.puede_gestionar === true, investiga = data.puede_investigar === true;
    var cerrada = CERRADAS_QUEJA.indexOf(q.estado) !== -1;
    var reabrir = function () { abrirQueja(q.queja_id); };
    var e1 = etapa(1, 'Recepción', !!q.fecha_recepcion,
      q.fecha_recepcion ? '<p>' + (si(q.procede) ? U.badge('Procede', 'ok') : U.badge('No procede', 'critico') + ' ' + U.esc(q.motivo_no_procede || '')) + '</p>' +
        ayuda('Registrada el ' + U.esc(fecha(q.fecha_recepcion)) + (q.registrado_por ? ' por ' + U.esc(PY.persona(q.registrado_por).nombre) : '') + '.')
        : ayuda('¿El servicio está vigente (o dentro de los 30 días post-término) y no suspendido por falta de pago?'),
      puede && q.estado === 'RECIBIDA' ? btn('Registrar recepción', 'js-q-recepcion') : '', q.estado === 'RECIBIDA');
    var e2 = etapa(2, 'Investigación', q.estado !== 'RECIBIDA' && q.estado !== 'NO_PROCEDE' && !!q.resultado_investigacion,
      q.estado === 'RECIBIDA' || q.estado === 'NO_PROCEDE' ? ayuda('Quién investiga no puede ser del área que originó la queja (PRO-07 §6.2).')
        : (q.investigador_email ? '<p>Investiga ' + persona(q.investigador_email) + '</p>' + (q.resultado_investigacion ? '<p>' + U.esc(q.resultado_investigacion) + '</p><p>' + (si(q.valida) ? U.badge('Válida', 'ok') : U.badge('No válida', 'critico')) + '</p>' : ayuda('Investigación en curso.'))
          : ayuda('Falta asignar quién investiga.')),
      puede && q.estado === 'EN_INVESTIGACION' && !q.investigador_email ? btn('Asignar investigador', 'js-q-investigador')
        : (investiga && q.estado === 'EN_INVESTIGACION' && q.investigador_email && !q.resultado_investigacion ? btn('Registrar resultado', 'js-q-resultado') : ''), q.estado === 'EN_INVESTIGACION');
    var e3 = etapa(3, 'Resolución', !!q.fecha_resolucion,
      q.accion_implementada && q.estado !== 'NO_VALIDA' ? '<p>' + U.esc(q.accion_implementada) + '</p>' + (q.fecha_resolucion ? ayuda('Resuelta el ' + U.esc(fecha(q.fecha_resolucion)) + '.') : '') +
        (data.nc_correlativo ? ayuda('→ ' + U.esc(data.nc_correlativo) + ' (' + U.esc((ESTADO_NC[data.nc_estado] || [data.nc_estado])[0]) + ')') : '')
        : ayuda('Qué se hizo para resolverlo. Plazo: 30 días corridos desde que se validó' + (q.resolucion_plazo ? ', vence el ' + U.esc(fecha(q.resolucion_plazo)) : '') + '.'),
      puede && q.estado === 'EN_RESOLUCION' ? btn('Registrar resolución', 'js-q-resolucion') : (puede && q.estado === 'RESUELTA' && !q.nc_id ? btn('Levantar no conformidad', 'js-q-a-nc', null, 'secundario') : ''), q.estado === 'EN_RESOLUCION');
    var e4 = etapa(4, 'Notificación al cliente', !!q.fecha_notificacion,
      q.fecha_notificacion ? ayuda('Notificada el ' + U.esc(fecha(q.fecha_notificacion)) + (q.revisado_por ? '. Revisó ' + U.esc(PY.persona(q.revisado_por).nombre) : '') + '.')
        : ayuda('Se envía al cliente la respuesta final. La decisión la revisa alguien no involucrado en el origen.'),
      puede && q.estado === 'RESUELTA' ? btn('Notificar al cliente', 'js-q-notificar') : '', q.estado === 'RESUELTA');
    var e5 = etapa(5, 'Seguimiento', !!q.fecha_seguimiento,
      q.fecha_seguimiento ? '<p>' + (si(q.cliente_conforme) ? U.badge('Cliente conforme', 'ok') : U.badge('No conforme — reabierta', 'critico')) + '</p>'
        : ayuda('30 días corridos después de la respuesta: ¿el cliente quedó conforme?' + (q.seguimiento_plazo ? ' Vence el ' + U.esc(fecha(q.seguimiento_plazo)) + '.' : '')),
      puede && (q.estado === 'NOTIFICADA' || q.estado === 'REABIERTA') ? btn('Registrar seguimiento', 'js-q-seguimiento') : '', q.estado === 'NOTIFICADA' || q.estado === 'REABIERTA');
    var d = panel(q.correlativo + ' · ' + q.nombre_completo,
      '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + badge(TIPO_QUEJA[q.tipo]) + badge(ESTADO_QUEJA[q.estado]) + (data.resumen && data.resumen.vencida ? U.badge('Plazo vencido', 'critico') : '') + '</span>',
      '<p class="mj2-desc">' + U.esc(q.descripcion) + '</p>' +
      '<dl class="sx2-dato mj2-datos">' + dato('Empresa', U.esc(q.empresa || '')) + dato('RUT', U.esc(q.rut || '')) + dato('Correo', q.email ? U.esc(q.email) : '') + dato('Teléfono', U.esc(q.telefono || '')) +
        dato('Área', U.esc(AREA_QUEJA[q.area] || q.area || '')) + dato('Canal', U.esc(q.canal || '')) + dato('Recibida', U.esc(fecha(q.fecha_envio))) + '</dl>' +
      '<ol class="mj2-etapas">' + e1 + e2 + e3 + e4 + e5 + '</ol>',
      puede && !cerrada ? U.boton({ texto: 'Anular', icono: 'basura', variante: 'texto-peligro', clase: 'js-q-anular' }) + '<span style="flex:1"></span>' + U.boton({ texto: 'Cerrar', clase: 'js-sx2-drawer-cerrar' }) : U.boton({ texto: 'Cerrar', clase: 'js-sx2-drawer-cerrar' }));
    d.el.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t.closest('.js-q-recepcion')) paso({ titulo: 'Registrar recepción', accion: 'registrarRecepcionQuejaSgc', sub: '¿El servicio está vigente (o dentro de los 30 días post-término) y no suspendido por falta de pago?',
        campos: U.campo('¿Procede?', '<select class="sx2-select" name="procede"><option value="SI">Sí, procede</option><option value="NO">No procede</option></select>') + U.campo('Motivo (si no procede)', '<textarea class="sx2-input" name="motivo" rows="3"></textarea>'),
        preparar: function (x) { return x.procede === 'NO' && (x.motivo || '').length < 5 ? 'Explica por qué no procede.' : x; },
        datos: function (x) { return { queja_id: q.queja_id, procede: x.procede === 'SI', motivo_no_procede: x.motivo || '' }; }, aviso: 'Recepción registrada.' }, reabrir);
      else if (t.closest('.js-q-investigador')) paso({ titulo: 'Asignar investigador', boton: 'Asignar', accion: 'registrarInvestigacionQuejaSgc',
        sub: 'No puede ser de la misma área que originó la queja (' + U.esc(AREA_QUEJA[q.area] || q.area || '') + ').',
        campos: U.campo('Investigador (correo)', '<input class="sx2-input" type="email" name="investigador_email" required>'),
        preparar: function (x) { return esCorreo(x.investigador_email) ? x : 'Indica el correo de quien investiga.'; },
        datos: function (x) { return { queja_id: q.queja_id, investigador_email: x.investigador_email }; }, aviso: 'Investigador asignado.' }, reabrir);
      else if (t.closest('.js-q-resultado')) paso({ titulo: 'Resultado de la investigación', accion: 'registrarResultadoQuejaSgc', ancho: true,
        campos: U.campo('Qué se encontró', '<textarea class="sx2-input" name="resultado" rows="4" required></textarea>') +
          U.campo('¿La queja es válida?', '<select class="sx2-select" name="valida"><option value="SI">Sí, es válida</option><option value="NO">No es válida</option></select>') +
          U.campo('Justificación (si no es válida)', '<textarea class="sx2-input" name="justificacion" rows="3"></textarea>', 'Se adjunta a la respuesta que recibe el cliente.'),
        preparar: function (x) { if ((x.resultado || '').length < 10) return 'Cuenta qué se encontró (mínimo 10 caracteres).'; return x.valida === 'NO' && !x.justificacion ? 'Justifica por qué no es válida.' : x; },
        datos: function (x) { return { queja_id: q.queja_id, resultado_investigacion: x.resultado, valida: x.valida === 'SI', justificacion: x.justificacion || '' }; }, aviso: 'Resultado registrado.' }, reabrir);
      else if (t.closest('.js-q-resolucion')) paso({ titulo: 'Registrar resolución', accion: 'registrarResolucionQuejaSgc',
        campos: U.campo('Acción o corrección implementada', '<textarea class="sx2-input" name="accion" rows="4" required></textarea>'),
        preparar: function (x) { return (x.accion || '').length >= 10 ? x : 'Describe la acción (mínimo 10 caracteres).'; },
        datos: function (x) { return { queja_id: q.queja_id, accion_implementada: x.accion }; }, aviso: 'Resolución registrada.' }, reabrir);
      else if (t.closest('.js-q-notificar')) paso({ titulo: 'Notificar al cliente', boton: 'Notificar', accion: 'registrarNotificacionQuejaSgc', sub: 'Se envía por correo la respuesta final con la acción implementada.',
        campos: U.campo('Revisado y aprobado por (correo)', '<input class="sx2-input" type="email" name="revisado_por" required placeholder="Persona no involucrada en el origen">'),
        preparar: function (x) { return esCorreo(x.revisado_por) ? x : 'Indica quién revisó la respuesta.'; },
        datos: function (x) { return { queja_id: q.queja_id, revisado_por: x.revisado_por }; }, aviso: 'Cliente notificado.' }, reabrir);
      else if (t.closest('.js-q-seguimiento')) paso({ titulo: 'Registrar seguimiento', accion: 'registrarSeguimientoQuejaSgc', sub: '30 días corridos después de la respuesta: ¿el cliente quedó conforme?',
        campos: U.campo('Resultado', '<select class="sx2-select" name="conforme"><option value="SI">Conforme — se cierra la queja</option><option value="NO">No conforme — reabrir el caso</option></select>'),
        datos: function (x) { return { queja_id: q.queja_id, cliente_conforme: x.conforme === 'SI' }; }, aviso: 'Seguimiento registrado.' }, reabrir);
      else if (t.closest('.js-q-a-nc')) confirmarY({ titulo: '¿Levantar una no conformidad?', texto: 'Se crea con esta queja como origen, y de ahí sale la acción correctiva.', boton: 'Levantar NC', aviso: 'No conformidad creada desde la queja.' },
        'convertirQuejaEnNcSgc', { queja_id: q.queja_id, responsable_email: q.investigador_email }, reabrir);
      else if (t.closest('.js-q-anular')) anular('Anular ' + q.correlativo, 'anularQuejaSgc', { queja_id: q.queja_id }, reabrir);
    });
  }

  // =========================================================================================
  // Auditorías internas
  // =========================================================================================
  var clausulas_ = [], preguntas_ = {};
  function pintarAuditorias(silencioso) {
    var d = est_.auditorias.datos, ind = d.indicadores || {}, puede = d.puede_gestionar === true;
    clausulas_ = d.clausulas_catalogo || clausulas_;
    var l = (d.auditorias || []).filter(function (x) { return !est_.auditorias.q || coincide([x.correlativo, x.proceso, x.area_id, x.auditor_email, PY.persona(x.auditor_email).nombre].join(' '), est_.auditorias.q); });
    var pct = ind.pct_cumplimiento;
    var anios = '<select class="sx2-select js-mj2-anio" aria-label="Año"><option value="">Todos los años</option>' + (d.anios || []).map(function (a) {
      return '<option value="' + a + '"' + (String(a) === String(est_.auditorias.anio) ? ' selected' : '') + '>' + a + '</option>'; }).join('') + '</select>';
    pagina(cabecera(puede ? U.boton({ texto: 'Programar auditoría', icono: 'nueva', variante: 'primario', clase: 'js-mj2-nueva' }) : '') +
      '<div class="sx2-fila-kpis">' +
        U.kpi({ i: 0, etiqueta: 'Programa ' + (est_.auditorias.anio || new Date().getFullYear()), valor: pct == null ? '—' : pct, sufijo: pct == null ? '' : '%', icono: 'diana', tono: pct == null ? 'neutro' : (pct >= 80 ? 'ok' : 'alerta'), progreso: pct == null ? null : pct, unidad: (ind.ejecutadas || 0) + ' de ' + (ind.programadas || 0) + ' ejecutadas' }) +
        U.kpi({ i: 1, etiqueta: 'Informes atrasados', valor: ind.informes_vencidos || 0, icono: 'reloj', tono: ind.informes_vencidos ? 'critico' : 'ok' }) +
        U.kpi({ i: 2, etiqueta: 'NC por levantar', valor: ind.nc_pendientes || 0, icono: 'alerta', tono: ind.nc_pendientes ? 'alerta' : 'ok' }) +
        U.kpi({ i: 3, etiqueta: 'Procesos sin auditar', valor: ind.procesos_sin_auditar || 0, icono: 'capas', tono: ind.procesos_sin_auditar ? 'alerta' : 'ok' }) +
      '</div>' +
      '<div class="sx2-card sx2-py-herramientas sx2-entra" style="--i:2"><div class="sx2-barra-filtros">' + buscador(est_.auditorias.q, 'Buscar por código, proceso, área o auditor…') + anios + '</div></div>' +
      lista(l.map(function (a) {
        var cerrada = a.estado === 'CERRADA' || a.estado === 'ANULADA';
        return fila({ id: a.auditoria_id, codigo: a.correlativo, titulo: a.proceso, apagada: cerrada, tono: a.informe_vencido ? 'critico' : '',
          badges: badge(ESTADO_AUD[a.estado]) + (a.informe_vencido ? U.badge('Informe atrasado', 'critico', true) : '') + (a.nc_pendientes ? U.badge(a.nc_pendientes + ' NC por levantar', 'alerta', true) : ''),
          meta: [a.area_id ? U.esc(a.area_id) : '', 'Auditor ' + persona(a.auditor_email), a.fecha_ejecucion ? 'Realizada ' + U.esc(fecha(a.fecha_ejecucion)) : 'Programada ' + U.esc(fecha(a.fecha_programada)),
            a.verificaciones ? plural(a.verificaciones, 'cláusula verificada', 'cláusulas verificadas') : plural((a.clausulas || []).length, 'cláusula') + ' en alcance',
            a.no_conformidades ? plural(a.no_conformidades, 'no conformidad', 'no conformidades') : ''] });
      }), ['Todavía no hay auditorías en el programa', 'El §9.2 pide auditar todos los procesos dentro del período.']), silencioso);
  }
  function abrirAuditoria(id) {
    var d = panelCargando('Auditoría');
    api('getDetalleAuditoriaSgc', { auditoria_id: id }).then(function (r) {
      if (!r || !r.ok) { d.cuerpo(U.vacio({ icono: 'alerta', titulo: 'No se pudo abrir', texto: (r && r.message) || '' })); return; }
      clausulas_ = r.data.clausulas_catalogo || clausulas_;
      preguntas_ = r.data.preguntas_catalogo || {};
      d.cerrar(true);
      fichaAuditoria(r.data);
    });
  }
  function fichaAuditoria(data) {
    var aud = data.auditoria, r = data.resumen || {}, audita = data.puede_auditar === true, gestiona = data.puede_gestionar === true;
    var cerrada = aud.estado === 'CERRADA' || aud.estado === 'ANULADA', enCurso = aud.estado === 'PLANIFICADA' || aud.estado === 'EJECUTADA';
    var planificada = aud.estado !== 'PROGRAMADA', ant = r.anticipacion_plan;
    var reabrir = function () { abrirAuditoria(aud.auditoria_id); };
    var e1 = etapa(1, 'Plan de auditoría', planificada,
      planificada ? '<dl class="sx2-dato mj2-datos">' + dato('Objetivo', U.esc(aud.objetivo || '')) + dato('Alcance', U.esc(aud.alcance || '')) + dato('Criterios', U.esc(aud.criterios || '')) +
          dato('Se realiza', U.esc(fecha(aud.fecha_ejecucion))) + dato('Auditados', (data.auditados || []).map(function (e) { return U.esc(PY.persona(e).nombre); }).join(', ')) + '</dl>' +
        (ant ? ayuda('Plan comunicado con ' + plural(ant.dias_naturales, 'día') + ' de anticipación' + (ant.suficiente ? '.' : ' — PRO-03 pide 5 días hábiles.')) : '')
        : ayuda('Objetivo, alcance, criterios y a quiénes se audita. Al guardarlo se les avisa.'),
      audita && ['PROGRAMADA', 'PLANIFICADA'].indexOf(aud.estado) !== -1 ? btn(planificada ? 'Editar plan' : 'Definir plan', 'js-aud-plan', null, planificada ? 'secundario' : 'primario') : '', aud.estado === 'PROGRAMADA');
    var editable = ['PLANIFICADA', 'EJECUTADA'].indexOf(aud.estado) !== -1;
    var hallazgos = (data.hallazgos || []).map(function (h) {
      var res = RESULTADO_H[h.resultado] || [h.resultado, 'neutro'];
      return '<li class="mj2-hallazgo sx2-tono-' + res[1] + '"><div class="sx2-flex" style="gap:8px;flex-wrap:wrap;align-items:center"><code class="mj2-cod">' + U.esc(h.clausula) + '</code><strong>' + U.esc(h.clausula_titulo || '') + '</strong>' + U.badge(res[0], res[1]) + '</div>' +
        '<p>' + U.esc(h.aspecto_verificado || '') + '</p>' + (h.evidencia ? ayuda('Evidencia: ' + U.esc(h.evidencia)) : '') + (h.descripcion ? '<p><b>Hallazgo:</b> ' + U.esc(h.descripcion) + '</p>' : '') +
        (h.nc_correlativo ? ayuda('→ ' + U.esc(h.nc_correlativo) + ' (' + U.esc((ESTADO_NC[h.nc_estado] || [h.nc_estado])[0]) + ')') : '') +
        '<div class="mj2-acciones">' + (gestiona && !h.nc_id && ['NO_CONFORMIDAD', 'OBSERVACION'].indexOf(h.resultado) !== -1 ? btn('Levantar no conformidad', 'js-aud-a-nc', { h: h.hallazgo_id }, h.resultado === 'NO_CONFORMIDAD' ? 'primario' : 'secundario') : '') +
          (audita && editable && !h.nc_id ? btn('Editar', 'js-aud-editar-h', { h: h.hallazgo_id }, 'fantasma', 'editar') + btn('Quitar', 'js-aud-quitar-h', { h: h.hallazgo_id }, 'fantasma', 'basura') : '') + '</div></li>';
    }).join('');
    var e2 = etapa(2, 'Lista de verificación', r.verificaciones > 0,
      r.verificaciones ? '<div class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + U.badge(plural(r.conformes || 0, 'conforme'), 'ok') + (r.observaciones ? U.badge(plural(r.observaciones, 'observación', 'observaciones'), 'alerta') : '') +
          (r.no_conformidades ? U.badge(plural(r.no_conformidades, 'no conformidad', 'no conformidades'), 'critico') : '') + (r.oportunidades ? U.badge(plural(r.oportunidades, 'oportunidad', 'oportunidades'), 'info') : '') + '</div>' +
        '<ul class="mj2-hallazgos">' + hallazgos + '</ul>'
        : ayuda('Cláusula por cláusula: qué se revisó, con qué evidencia y qué se encontró. Una cláusula conforme también se registra: es la evidencia de que se revisó.'),
      audita && enCurso ? btn('Verificar cláusula', 'js-aud-hallazgo', null, 'primario', 'mas') + (aud.estado === 'PLANIFICADA' && r.verificaciones ? btn('Terminar la auditoría', 'js-aud-ejecutada', null, 'secundario', 'check') : '') : '', aud.estado === 'PLANIFICADA');
    var entrevistados = aud.personas_entrevistadas || [], resumenNc = data.informe_resumen_nc || [];
    var e3 = etapa(3, 'Informe', !!aud.informe_fecha,
      aud.informe_fecha ? '<p>' + U.esc(aud.informe_conclusion || '') + '</p>' + ayuda('Emitido el ' + U.esc(fecha(aud.informe_fecha)) + '.') +
          (entrevistados.length ? ayuda('<b>Entrevistados:</b> ' + entrevistados.map(U.esc).join(' · ')) : '') +
          (resumenNc.length ? '<ul class="mj2-hallazgos">' + resumenNc.map(function (n) {
            return '<li class="mj2-hallazgo sx2-tono-critico"><div class="sx2-flex" style="gap:8px;flex-wrap:wrap"><code class="mj2-cod">' + U.esc(n.nc_correlativo) + '</code><strong>' + U.esc(n.punto_normativo || '') + '</strong></div><p>' + U.esc(n.no_conformidad || '') + '</p>' +
              (n.evidencia_objetiva ? ayuda('Evidencia: ' + U.esc(n.evidencia_objetiva)) : '') + '</li>';
          }).join('') + '</ul>' : '')
        : ayuda('La conclusión de la auditoría. PRO-03 da 10 días hábiles desde que se realiza' + (aud.informe_plazo ? ', vence el ' + U.esc(fecha(aud.informe_plazo)) : '') + '.'),
      audita && aud.estado === 'EJECUTADA' ? btn('Emitir informe', 'js-aud-informe') : '', aud.estado === 'EJECUTADA');
    var e4 = etapa(4, 'Cierre', aud.estado === 'CERRADA',
      aud.estado === 'CERRADA' ? ayuda('Cerrada el ' + U.esc(fecha(aud.fecha_cierre)) + '.')
        : (r.nc_pendientes ? '<div class="mj2-aviso sx2-tono-alerta">' + U.ico('alerta', 16) + '<span>' + (r.nc_pendientes === 1 ? 'Falta 1 no conformidad por levantar.' : 'Faltan ' + r.nc_pendientes + ' no conformidades por levantar.') + ' Una auditoría no se cierra dejando hallazgos sin canalizar.</span></div>'
          : ayuda('Se cierra cuando cada hallazgo de no conformidad ya tiene su NC.')),
      gestiona && aud.estado === 'INFORMADA' && !r.nc_pendientes ? btn('Cerrar auditoría', 'js-aud-cerrar') : '', aud.estado === 'INFORMADA');
    var d = panel(aud.correlativo + ' · ' + aud.proceso,
      '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + badge(ESTADO_AUD[aud.estado]) + (r.informe_vencido ? U.badge('Informe atrasado', 'critico') : '') + '</span>',
      '<dl class="sx2-dato mj2-datos">' + dato('Área', U.esc(aud.area_id || '')) + dato('Auditor líder', persona(aud.auditor_email)) +
        dato('Equipo auditor', (aud.coauditores || []).map(function (e) { return U.esc(PY.persona(e).nombre); }).join(', ')) + dato('Programada', U.esc(fecha(aud.fecha_programada))) +
        dato('Cláusulas en alcance', (data.clausulas_alcance || []).map(function (c) { return '<code class="mj2-cod">' + U.esc(c) + '</code>'; }).join(' ')) + '</dl>' +
      '<ol class="mj2-etapas">' + e1 + e2 + e3 + e4 + '</ol>',
      gestiona && !cerrada ? U.boton({ texto: 'Anular', icono: 'basura', variante: 'texto-peligro', clase: 'js-aud-anular' }) + '<span style="flex:1"></span>' + U.boton({ texto: 'Cerrar', clase: 'js-sx2-drawer-cerrar' }) : U.boton({ texto: 'Cerrar', clase: 'js-sx2-drawer-cerrar' }));
    var hallazgo = function (id) { return (data.hallazgos || []).filter(function (x) { return x.hallazgo_id === id; })[0]; };
    d.el.addEventListener('click', function (ev) {
      var t = ev.target, b;
      if (t.closest('.js-aud-plan')) formPlanAud(aud, data, reabrir);
      else if (t.closest('.js-aud-hallazgo')) formHallazgo(aud, data, null, reabrir);
      else if ((b = t.closest('.js-aud-editar-h'))) formHallazgo(aud, data, hallazgo(b.getAttribute('data-h')), reabrir);
      else if ((b = t.closest('.js-aud-quitar-h'))) U.confirmar({ titulo: '¿Quitar de la lista?', texto: 'Se saca de la lista de verificación. Queda en el registro del sistema.', boton: 'Quitar', peligro: true }).then(function (ok) {
        if (ok) api('eliminarHallazgoSgc', { hallazgo_id: b.getAttribute('data-h') }).then(function (res) { if (!res || !res.ok) { PY.aviso((res && res.message) || 'No se pudo quitar.', 'error'); return; } reabrir(); });
      });
      else if ((b = t.closest('.js-aud-a-nc'))) confirmarY({ titulo: '¿Levantar una no conformidad?', texto: 'Se crea con este hallazgo como origen, y de ahí sale la acción correctiva.', boton: 'Levantar NC', aviso: 'No conformidad creada desde el hallazgo.' },
        'convertirHallazgoEnNcSgc', { hallazgo_id: b.getAttribute('data-h') }, reabrir);
      else if (t.closest('.js-aud-ejecutada')) confirmarY({ titulo: '¿Terminar la auditoría?', texto: 'La lista sigue editable, pero arranca el plazo de 10 días hábiles para el informe.', boton: 'Terminar' }, 'cerrarEjecucionAuditoriaSgc', { auditoria_id: aud.auditoria_id }, reabrir);
      else if (t.closest('.js-aud-informe')) paso({ titulo: 'Informe de auditoría', boton: 'Emitir informe', accion: 'emitirInformeAuditoriaSgc', ancho: true,
        sub: 'La conclusión sobre el proceso auditado. Al emitirlo se avisa a los auditados y al Encargado SGC.',
        campos: U.campo('Conclusión', '<textarea class="sx2-input" name="conclusion" rows="5" required placeholder="¿El proceso cumple? ¿Qué es lo más relevante que se encontró?"></textarea>') +
          U.campo('Personas entrevistadas', '<textarea class="sx2-input" name="entrevistados" rows="4" placeholder="Una por línea: Nombre - Cargo"></textarea>'),
        preparar: function (x) { return (x.conclusion || '').length >= 20 ? x : 'Escribe la conclusión (mínimo 20 caracteres).'; },
        datos: function (x) { return { auditoria_id: aud.auditoria_id, conclusion: x.conclusion, personas_entrevistadas: lineas(x.entrevistados) }; }, aviso: 'Informe emitido.' }, reabrir);
      else if (t.closest('.js-aud-cerrar')) confirmarY({ titulo: '¿Cerrar la auditoría?', texto: 'Todos los hallazgos ya están canalizados. Queda como evidencia cerrada.', boton: 'Cerrar auditoría', aviso: 'Auditoría cerrada.' }, 'cerrarAuditoriaSgc', { auditoria_id: aud.auditoria_id }, reabrir);
      else if (t.closest('.js-aud-anular')) anular('Anular ' + aud.correlativo, 'anularAuditoriaSgc', { auditoria_id: aud.auditoria_id }, reabrir);
    });
    resolverCorreos([aud.auditor_email].concat(data.auditados || [], aud.coauditores || []), turno_);
  }
  function selectorClausulas(marcadas) {
    return '<div class="sx2-campo"><span class="sx2-campo__et">Cláusulas a auditar</span><div class="mj2-clausulas">' + clausulas_.map(function (c) {
      return '<label class="nv2-check"><input type="checkbox" name="cl_' + U.esc(c.codigo) + '"' + (marcadas.indexOf(c.codigo) !== -1 ? ' checked' : '') + '> <b>' + U.esc(c.codigo) + '</b> ' + U.esc(c.titulo) + '</label>';
    }).join('') + '</div></div>';
  }
  function formAuditoria() {
    paso({ titulo: 'Programar auditoría interna', boton: 'Programar', accion: 'programarAuditoriaSgc', ancho: true,
      campos: '<div class="sx2-form__fila">' + U.campo('Proceso a auditar', '<input class="sx2-input" name="proceso" required placeholder="Ej.: Gestión de personas">') + U.campo('Área', '<input class="sx2-input" name="area_id" placeholder="Ej.: RRHH">') + '</div>' +
        '<div class="sx2-form__fila">' + U.campo('Auditor (correo)', '<input class="sx2-input" type="email" name="auditor_email" required placeholder="De otra área: nadie audita su propio trabajo">') +
          U.campo('Fecha planeada', '<input class="sx2-input" type="date" name="fecha_programada" required>') + '</div>' + selectorClausulas([]),
      preparar: function (x, form) {
        if (!x.proceso) return 'Indica el proceso.';
        if (!esCorreo(x.auditor_email)) return 'Indica el correo del auditor.';
        if (!x.fecha_programada) return 'Indica la fecha.';
        var cl = clausulas_.filter(function (c) { var el = form.querySelector('[name="cl_' + c.codigo + '"]'); return el && el.checked; }).map(function (c) { return c.codigo; });
        if (!cl.length) return 'Elige al menos una cláusula.';
        return { proceso: x.proceso, area_id: x.area_id, auditor_email: x.auditor_email, fecha_programada: x.fecha_programada, clausulas: cl };
      },
      datos: function (x) { return x; }, aviso: 'Auditoría programada.' }, function (r) { cargar(true); if (r && r.data && r.data.auditoria_id) abrirAuditoria(r.data.auditoria_id); });
  }
  function formPlanAud(aud, data, reabrir) {
    paso({ titulo: 'Plan de auditoría', boton: 'Guardar y comunicar', accion: 'planificarAuditoriaSgc', ancho: true,
      sub: 'Al guardarlo se avisa a las personas auditadas. PRO-03 pide comunicarlo con 5 días hábiles de anticipación.',
      campos: U.campo('Objetivo', '<textarea class="sx2-input" name="objetivo" rows="3" required placeholder="¿Qué se quiere comprobar?">' + U.esc(aud.objetivo || '') + '</textarea>') +
        U.campo('Alcance', '<textarea class="sx2-input" name="alcance" rows="3" required placeholder="Qué queda dentro y qué no: período, sedes, registros.">' + U.esc(aud.alcance || '') + '</textarea>') +
        U.campo('Criterios', '<input class="sx2-input" name="criterios" value="' + U.esc(aud.criterios || '') + '" placeholder="Ej.: ISO 9001:2015, PRO-02">') +
        '<div class="sx2-form__fila">' + U.campo('Auditados (correos, separados por coma)', '<input class="sx2-input" name="auditados" value="' + U.esc((data.auditados || []).join(', ')) + '">') +
          U.campo('Fecha de realización', '<input class="sx2-input" type="date" name="fecha_ejecucion" required value="' + U.esc(iso(aud.fecha_ejecucion)) + '">') + '</div>' +
        U.campo('Resto del equipo auditor (correos, opcional)', '<input class="sx2-input" name="coauditores" value="' + U.esc((aud.coauditores || []).join(', ')) + '">', 'El auditor líder ya está definido.'),
      preparar: function (x) {
        if (!x.objetivo || !x.alcance) return 'Completa objetivo y alcance.';
        if (!x.fecha_ejecucion) return 'Indica la fecha de realización.';
        var mal = correos(x.auditados).concat(correos(x.coauditores)).filter(function (e) { return !esCorreo(e); });
        return mal.length ? 'Revisa estos correos: ' + mal.join(', ') : x;
      },
      datos: function (x) { return { auditoria_id: aud.auditoria_id, objetivo: x.objetivo, alcance: x.alcance, criterios: x.criterios, auditados: correos(x.auditados), coauditores: correos(x.coauditores), fecha_ejecucion: x.fecha_ejecucion }; },
      aviso: 'Plan guardado y comunicado a los auditados.' }, reabrir);
  }
  function formHallazgo(aud, data, h, reabrir) {
    var enAlcance = data.clausulas_alcance || [];
    var cl0 = h ? h.clausula : (enAlcance[0] || (clausulas_[0] || {}).codigo || '');
    var preguntasHtml = function (cl) {
      var ps = preguntas_[cl] || [];
      return ps.length ? U.campo('Elegir de la lista de verificación (opcional)', '<select class="sx2-select js-mj2-pregunta"><option value="">—</option>' + ps.map(function (p) { return '<option value="' + U.esc(p) + '">' + U.esc(p.length > 90 ? p.slice(0, 90) + '…' : p) + '</option>'; }).join('') + '</select>') : '';
    };
    paso({ titulo: h ? 'Editar verificación' : 'Verificar cláusula', accion: 'registrarHallazgoSgc', ancho: true,
      campos: '<div class="sx2-form__fila">' + U.campo('Cláusula', '<select class="sx2-select" name="clausula">' + clausulas_.map(function (c) {
          return '<option value="' + U.esc(c.codigo) + '"' + (c.codigo === cl0 ? ' selected' : '') + '>' + U.esc(c.codigo + ' — ' + c.titulo + (enAlcance.indexOf(c.codigo) === -1 ? ' (fuera del alcance)' : '')) + '</option>';
        }).join('') + '</select>') +
        U.campo('Resultado', '<select class="sx2-select" name="resultado">' + Object.keys(RESULTADO_H).map(function (k) { return '<option value="' + k + '"' + ((h ? h.resultado : 'CONFORME') === k ? ' selected' : '') + '>' + RESULTADO_H[k][0] + '</option>'; }).join('') + '</select>') + '</div>' +
        '<div class="js-mj2-preguntas">' + preguntasHtml(cl0) + '</div>' +
        U.campo('Qué se verificó', '<textarea class="sx2-input" name="aspecto_verificado" rows="3" required placeholder="Ej.: evaluaciones de competencia del personal del área.">' + U.esc(h ? h.aspecto_verificado : '') + '</textarea>') +
        U.campo('Evidencia revisada', '<textarea class="sx2-input" name="evidencia" rows="2" placeholder="Qué documentos o registros se miraron, y cuántos.">' + U.esc(h ? h.evidencia || '' : '') + '</textarea>') +
        U.campo('Hallazgo', '<textarea class="sx2-input" name="descripcion" rows="3" placeholder="Obligatorio si no es conforme: es lo que después se convierte en no conformidad.">' + U.esc(h ? h.descripcion || '' : '') + '</textarea>'),
      alMontar: function (form) {
        var cl = form.querySelector('[name=clausula]'), box = form.querySelector('.js-mj2-preguntas');
        cl.addEventListener('change', function () { box.innerHTML = preguntasHtml(cl.value); });
        form.addEventListener('change', function (ev) { if (ev.target.classList.contains('js-mj2-pregunta') && ev.target.value) form.querySelector('[name=aspecto_verificado]').value = ev.target.value; });
      },
      preparar: function (x) {
        if ((x.aspecto_verificado || '').length < 5) return 'Indica qué se verificó.';
        if (x.resultado !== 'CONFORME' && (x.descripcion || '').length < 10) return 'Si no es conforme, describe el hallazgo (mínimo 10 caracteres).';
        return x;
      },
      datos: function (x) { var d = { auditoria_id: aud.auditoria_id, clausula: x.clausula, resultado: x.resultado, aspecto_verificado: x.aspecto_verificado, evidencia: x.evidencia, descripcion: x.descripcion }; if (h) d.hallazgo_id = h.hallazgo_id; return d; },
      aviso: 'Verificación guardada.' }, reabrir);
  }

  // =========================================================================================
  // Revisión por la dirección
  // =========================================================================================
  function pintarRevisiones(silencioso) {
    var d = est_.revision.datos, vig = d.vigencia || {}, puede = d.puede_gestionar === true;
    var l = d.revisiones || [];
    var aviso = vig.vencida
      ? '<div class="mj2-aviso sx2-tono-critico sx2-entra">' + U.ico('alerta', 16) + '<span>' + (vig.ultima_fecha ? 'La última revisión fue el ' + U.esc(fecha(vig.ultima_fecha)) + '. PRO-05 pide una al menos cada ' + (d.meses_frecuencia || 12) + ' meses.'
        : 'Todavía no se ha registrado ninguna revisión por la dirección. La norma (§9.3) la exige.') + '</span></div>'
      : (vig.proxima ? '<div class="mj2-aviso sx2-tono-info sx2-entra">' + U.ico('calendario', 16) + '<span>Última revisión: ' + U.esc(fecha(vig.ultima_fecha)) + '. La próxima corresponde antes del <b>' + U.esc(fecha(vig.proxima)) + '</b>.</span></div>' : '');
    pagina(cabecera(puede ? U.boton({ texto: 'Programar revisión', icono: 'nueva', variante: 'primario', clase: 'js-mj2-nueva' }) : '') + aviso +
      lista(l.map(function (r) {
        return fila({ id: r.revision_id, codigo: r.correlativo, titulo: 'Reunión ' + fecha(r.fecha_reunion || r.fecha_programada), apagada: r.estado === 'ANULADA', tono: r.convocatoria_atrasada ? 'critico' : '',
          badges: badge(ESTADO_REV[r.estado]) + (r.convocatoria_atrasada ? U.badge('Falta convocar', 'critico', true) : ''),
          meta: [r.entradas_completas + ' de ' + r.total_entradas + ' temas', plural(r.total_acuerdos || 0, 'acuerdo')] });
      }), ['Todavía no hay revisiones registradas', 'La revisión por la dirección es anual y la ejecuta la Dirección (PRO-05 §4).']), silencioso);
  }
  function abrirRevision(id) {
    var d = panelCargando('Revisión por la dirección');
    api('getDetalleRevisionSgc', { revision_id: id }).then(function (r) {
      if (!r || !r.ok) { d.cuerpo(U.vacio({ icono: 'alerta', titulo: 'No se pudo abrir', texto: (r && r.message) || '' })); return; }
      d.cerrar(true);
      fichaRevision(r.data);
    });
  }
  function fichaRevision(data) {
    var r = data.revision, entradas = data.entradas || [], acuerdos = data.acuerdos || [], puede = data.puede_gestionar === true;
    var cerrada = r.estado === 'CERRADA' || r.estado === 'ANULADA';
    var reabrir = function () { abrirRevision(r.revision_id); };
    var completas = entradas.filter(function (e) { return e.observaciones; }).length;
    var acciones = puede && !cerrada ? (r.estado === 'PROGRAMADA' ? btn('Convocar', 'js-rev-convocar', null, 'primario', 'correo') : '') +
      btn('Registrar acta', 'js-rev-acta', null, r.estado === 'PROGRAMADA' ? 'secundario' : 'primario', 'documento') +
      (r.estado === 'REALIZADA' ? btn('Agregar acuerdo', 'js-rev-acuerdo', null, 'secundario', 'mas') + btn('Cerrar revisión', 'js-rev-cerrar', null, 'secundario', 'check') : '') : '';
    var d = panel(r.correlativo + ' · Revisión por la dirección',
      '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + badge(ESTADO_REV[r.estado]) + (r.convocatoria_atrasada ? U.badge('Falta convocar', 'critico') : '') + '</span>',
      '<dl class="sx2-dato mj2-datos">' + dato('Fecha programada', U.esc(fecha(r.fecha_programada))) + dato('Convocar antes de', r.aviso_plazo ? U.esc(fecha(r.aviso_plazo)) : '') +
        dato('Convocada el', r.fecha_convocatoria ? U.esc(fecha(r.fecha_convocatoria)) : '') + dato('Reunión realizada', r.fecha_reunion ? U.esc(fecha(r.fecha_reunion)) : '') +
        dato('Director', persona(r.director_email)) + dato('Responsable de calidad', persona(r.responsable_calidad_email)) + '</dl>' +
      (acciones ? '<div class="mj2-acciones">' + acciones + '</div>' : '') +
      '<h3 class="mj2-sub">Asistentes</h3>' + ((r.asistentes || []).length ? '<ul class="mj2-asistentes">' + r.asistentes.map(function (a) { return '<li><strong>' + U.esc(a.nombre) + '</strong>' + (a.cargo ? ' <span class="sx2-tenue">' + U.esc(a.cargo) + '</span>' : '') + '</li>'; }).join('') + '</ul>' : ayuda('Todavía no se registraron asistentes.')) +
      '<h3 class="mj2-sub">Información a tratar (§9.3.2) <span class="sx2-tenue">' + completas + ' de ' + entradas.length + '</span></h3>' + U.barra(entradas.length ? completas * 100 / entradas.length : 0, completas === entradas.length ? 'ok' : 'alerta') +
      '<ol class="mj2-temas">' + entradas.map(function (e) {
        return '<li class="' + (e.observaciones ? 'mj2-tema--ok' : '') + '"><div class="sx2-flex" style="gap:8px;flex-wrap:wrap;align-items:center"><strong>' + e.numero + '. ' + U.esc(e.titulo) + '</strong>' + (e.auto ? U.badge('Lo trae el sistema', 'info', true) : '') + '</div>' +
          (e.observaciones ? '<p>' + U.esc(e.observaciones) + '</p>' : ayuda(e.pendiente_fase ? 'Sin completar. Se podrá traer automáticamente cuando exista: ' + U.esc(e.pendiente_fase) + '.' : 'Sin completar.')) + '</li>';
      }).join('') + '</ol>' +
      (r.conclusiones ? '<h3 class="mj2-sub">Conclusiones</h3><p>' + U.esc(r.conclusiones) + '</p>' : '') +
      '<h3 class="mj2-sub">Acuerdos (§9.3.3)</h3>' + (acuerdos.length ? '<ul class="mj2-hallazgos">' + acuerdos.map(function (a) {
        var t = a.tarea;
        return '<li class="mj2-hallazgo sx2-tono-' + (t && t.terminada ? 'ok' : 'primario') + '"><div class="sx2-flex" style="gap:8px;flex-wrap:wrap"><strong>' + U.esc(a.tipo_etiqueta || a.tipo) + '</strong>' + (t ? U.badge(t.terminada ? 'Cumplido' : 'En curso', t.terminada ? 'ok' : 'alerta') : '') + '</div>' +
          '<p>' + U.esc(a.observaciones) + '</p>' + ayuda('Responsable ' + U.esc(PY.persona(a.responsable_email).nombre) + ' · plazo ' + U.esc(fecha(a.plazo)) + (t ? ' · está en su "Mi trabajo"' : '')) + '</li>';
      }).join('') + '</ul>' : '<div class="mj2-aviso sx2-tono-info">' + U.ico('info', 16) + '<span>Todavía no hay acuerdos. §9.3.3 exige que la revisión produzca decisiones: sin acuerdos no se puede cerrar.</span></div>') +
      (r.anexos ? '<h3 class="mj2-sub">Anexos</h3><p>' + U.esc(r.anexos) + '</p>' : ''),
      puede && !cerrada ? U.boton({ texto: 'Anular', icono: 'basura', variante: 'texto-peligro', clase: 'js-rev-anular' }) + '<span style="flex:1"></span>' + U.boton({ texto: 'Cerrar', clase: 'js-sx2-drawer-cerrar' }) : U.boton({ texto: 'Cerrar', clase: 'js-sx2-drawer-cerrar' }));
    d.el.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t.closest('.js-rev-convocar')) paso({ titulo: 'Convocar a ' + r.correlativo, boton: 'Enviar convocatoria', accion: 'convocarRevisionSgc', ancho: true, sub: 'Se envía por correo la agenda con los 13 temas que exige la norma.',
        campos: U.campo('Asistentes', '<textarea class="sx2-input" name="asistentes" rows="4" required placeholder="Uno por línea: Nombre - Cargo"></textarea>') +
          U.campo('Correos a convocar', '<textarea class="sx2-input" name="correos" rows="4" required placeholder="Uno por línea"></textarea>'),
        preparar: function (x) { var cs = correos(x.correos); if (!lineas(x.asistentes).length) return 'Indica los asistentes.'; if (!cs.length) return 'Indica al menos un correo.'; var mal = cs.filter(function (e) { return !esCorreo(e); }); return mal.length ? 'Revisa: ' + mal.join(', ') : x; },
        datos: function (x) { return { revision_id: r.revision_id, asistentes: x.asistentes, correos: correos(x.correos) }; }, aviso: 'Convocatoria enviada.' }, reabrir);
      else if (t.closest('.js-rev-acta')) formActa(r, entradas, reabrir);
      else if (t.closest('.js-rev-acuerdo')) paso({ titulo: 'Nuevo acuerdo', boton: 'Guardar acuerdo', accion: 'registrarAcuerdoRevisionSgc', sub: 'Se convierte en una tarea real: le aparece al responsable en "Mi trabajo", con su plazo.',
        campos: U.campo('Relacionado con', '<select class="sx2-select" name="tipo">' + (data.catalogo_acuerdos || []).map(function (c) { return '<option value="' + U.esc(c.tipo) + '">' + U.esc(c.etiqueta) + '</option>'; }).join('') + '</select>') +
          U.campo('Observaciones', '<textarea class="sx2-input" name="observaciones" rows="3" required></textarea>') +
          '<div class="sx2-form__fila">' + U.campo('Responsable (correo)', '<input class="sx2-input" type="email" name="responsable_email" required>') + U.campo('Plazo', '<input class="sx2-input" type="date" name="plazo" required min="' + PY.hoyClave() + '">') + '</div>',
        preparar: function (x) { if ((x.observaciones || '').length < 5) return 'Describe el acuerdo.'; if (!esCorreo(x.responsable_email)) return 'Indica el correo del responsable.'; return x.plazo ? x : 'Indica el plazo.'; },
        datos: function (x) { x.revision_id = r.revision_id; return x; }, aviso: 'Acuerdo registrado: ya está en "Mi trabajo" del responsable.' }, reabrir);
      else if (t.closest('.js-rev-cerrar')) confirmarY({ titulo: '¿Cerrar la revisión?', texto: 'Queda como registro definitivo del año.', boton: 'Cerrar revisión', aviso: 'Revisión cerrada.' }, 'cerrarRevisionSgc', { revision_id: r.revision_id }, reabrir);
      else if (t.closest('.js-rev-anular')) anular('Anular ' + r.correlativo, 'anularRevisionSgc', { revision_id: r.revision_id }, function () { cargar(true); });
    });
    resolverCorreos([r.director_email, r.responsable_calidad_email].concat(acuerdos.map(function (a) { return a.responsable_email; })), turno_);
  }
  function formActa(r, entradas, reabrir) {
    var fd = U.formulario({
      titulo: 'Acta de ' + r.correlativo, boton: 'Guardar acta', ancho: true,
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Los 13 temas son obligatorios (§9.3.2): dejar uno en blanco es un hallazgo de auditoría.</span>',
      campos: '<div class="mj2-acciones" style="margin:0 0 8px">' + U.boton({ texto: 'Traer datos del sistema', icono: 'descargar', sm: true, clase: 'js-rev-auto' }) + '</div>' +
        U.campo('Fecha en que se realizó', '<input class="sx2-input" type="date" name="fecha_reunion" required max="' + PY.hoyClave() + '" value="' + U.esc(iso(r.fecha_reunion || r.fecha_programada)) + '">') +
        U.campo('Asistentes', '<textarea class="sx2-input" name="asistentes" rows="3" required placeholder="Nombre - Cargo, uno por línea">' + U.esc((r.asistentes || []).map(function (a) { return a.nombre + (a.cargo ? ' - ' + a.cargo : ''); }).join('\n')) + '</textarea>') +
        entradas.map(function (e) { return U.campo(e.numero + '. ' + e.titulo + (e.auto ? ' (lo trae el sistema)' : ''), '<textarea class="sx2-input" name="e_' + e.numero + '" rows="2">' + U.esc(e.observaciones || '') + '</textarea>'); }).join('') +
        U.campo('Conclusiones', '<textarea class="sx2-input" name="conclusiones" rows="3" placeholder="¿El SGC es adecuado y eficaz? ¿Hay recursos?">' + U.esc(r.conclusiones || '') + '</textarea>') +
        U.campo('Anexos', '<textarea class="sx2-input" name="anexos" rows="2">' + U.esc(r.anexos || '') + '</textarea>'),
      alMontar: function (form) {
        form.querySelector('.js-rev-auto').addEventListener('click', function (ev) {
          var b = ev.currentTarget; b.disabled = true;
          api('getResumenRevisionSgc', { revision_id: r.revision_id }).then(function (res) {
            b.disabled = false;
            if (!res || !res.ok) { PY.aviso((res && res.message) || 'No se pudo traer el resumen.', 'error'); return; }
            var resumen = res.data.resumen || {}, n = 0;
            Object.keys(resumen).forEach(function (num) { var el = form.querySelector('[name="e_' + num + '"]'); if (el && !el.value.trim()) { el.value = resumen[num]; n++; } });
            PY.aviso(n ? 'Se completaron ' + n + ' tema(s) con datos del sistema. Revísalos.' : 'Esos temas ya estaban escritos: no se pisó nada.', 'exito');
          });
        });
      },
      preparar: function (x) { if (!x.fecha_reunion) return 'Indica la fecha.'; return lineas(x.asistentes).length ? x : 'Indica los asistentes.'; },
      enviar: function (x) {
        var obs = {};
        entradas.forEach(function (e) { obs[e.numero] = x['e_' + e.numero] || ''; });
        return api('registrarActaRevisionSgc', { revision_id: r.revision_id, fecha_reunion: x.fecha_reunion, asistentes: x.asistentes, entradas: obs, conclusiones: x.conclusiones, anexos: x.anexos });
      },
      aviso: function () { return 'Acta guardada.'; },
      listo: function () { recargarSilencioso(); reabrir(); }
    });
    return fd;
  }
  function formRevision() {
    paso({ titulo: 'Programar revisión por la dirección', boton: 'Programar', accion: 'programarRevisionSgc', sub: 'Mínimo una al año. El sistema calcula hasta cuándo hay plazo para convocar (10 días hábiles antes).',
      campos: U.campo('Fecha de la reunión', '<input class="sx2-input" type="date" name="fecha_programada" required min="' + PY.hoyClave() + '">') + U.campo('Correo del Director', '<input class="sx2-input" type="email" name="director_email">'),
      preparar: function (x) { if (!x.fecha_programada) return 'Indica la fecha.'; return !x.director_email || esCorreo(x.director_email) ? x : 'Revisa el correo del Director.'; },
      datos: function (x) { return x; }, aviso: 'Revisión programada.' }, function (r) { cargar(true); if (r && r.data && r.data.revision_id) abrirRevision(r.data.revision_id); });
  }

  // --- Eventos --------------------------------------------------------------------------------
  function abrir(id) {
    if (vista_ === 'nc') abrirNc(id);
    else if (vista_ === 'quejas') abrirQueja(id);
    else if (vista_ === 'auditorias') abrirAuditoria(id);
    else abrirRevision(id);
  }
  function mio() { var c = document.getElementById('calidad-v2'); return !!c && !!VISTAS[c.getAttribute('data-vista')]; }
  document.addEventListener('click', function (ev) {
    var raiz = document.getElementById('calidad-v2');
    if (!raiz || !raiz.contains(ev.target) || !mio()) return;
    var t = ev.target, b;
    if (t.closest('.js-mj2-recargar')) { cargar(true); return; }
    if (t.closest('.js-mj2-nueva')) { if (vista_ === 'nc') formNc(); else if (vista_ === 'auditorias') formAuditoria(); else if (vista_ === 'revision') formRevision(); return; }
    if (t.closest('.js-mj2-publico')) { window.open('quejas.html', '_blank', 'noopener'); return; }
    if ((b = t.closest('.js-mj2-filtro'))) { est_[vista_].filtro = b.getAttribute('data-f'); cargar(false); return; }
    if ((b = t.closest('[data-mj2-id]'))) abrir(b.getAttribute('data-mj2-id'));
  });
  document.addEventListener('keydown', function (ev) {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('#calidad-v2 [data-mj2-id]')) { ev.preventDefault(); ev.target.click(); }
  });
  document.addEventListener('change', function (ev) {
    if (ev.target.classList && ev.target.classList.contains('js-mj2-anio') && mio()) { est_.auditorias.anio = ev.target.value; cargar(false); }
  });
  var tq_ = null;
  document.addEventListener('input', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('js-mj2-q') || !mio()) return;
    var v = ev.target.value;
    clearTimeout(tq_);
    tq_ = setTimeout(function () { est_[vista_].q = v; pintar(true); }, 160);
  });

  window.SigsoCalidadMejoraV2 = {
    mostrar: function (v) {
      vista_ = v;
      cargar(!!est_[v].datos && C().ocupa(v));
    },
    vistas: Object.keys(VISTAS)
  };
})();
