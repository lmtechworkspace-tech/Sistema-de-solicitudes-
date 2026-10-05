/**
 * informe-gestion-v2.js — el INFORME DE GESTIÓN del mes, en el módulo
 * Administración (2026-10-03). Lo que llega a gerencia, en una página y con
 * lo malo primero:
 *   1. estado de cada área (semáforo)
 *   2. lo que requiere su decisión (alertas con por qué, impacto y decisión)
 *   3. decisiones: las propone el Analista de Control y las acuerda Gerencia
 *   4. conclusión del Analista de Control
 *   5. indicadores clave con su tendencia y explicación
 *   6. lo que va bien · 7. reportes de las áreas · 8. comentarios de la cadena
 *
 * Arriba, la cadena de seis pasos con su plazo en días hábiles y las acciones
 * de quien mira (enviar, aprobar, devolver, cerrar). El servidor decide todo
 * (backend/logica/informesGestion.js); aquí solo se pinta.
 *
 * Vistas: informe (por defecto) y cadena (ADM: quién ocupa cada paso).
 */
(function () {
  'use strict';

  var U = UIv2;
  var I = function () { return window.SigsoIndicadores; };
  var R = function () { return window.SigsoReportes; };
  var x_ = null, est_ = { periodo: '', datos: null, turno: 0, hist: [] };

  var TONO_EST = { SIN_INICIAR: 'neutro', PREPARACION: 'info', EN_FINANZAS: 'alerta', EN_CONTROL: 'alerta', EN_GERENCIA: 'primario', CERRADO: 'ok' };
  var TONO_AREA = { critico: 'critico', alerta: 'alerta', ok: 'ok', sin_datos: 'neutro', en_curso: 'neutro' };
  var TXT_AREA = { critico: 'Atención', alerta: 'Vigilar', ok: 'En orden', sin_datos: 'Sin datos', en_curso: 'Mes en curso' };
  var EST_REP = { SIN_INICIAR: 'Sin iniciar', BORRADOR: 'En preparación', EN_REVISION: 'Por validar', OBSERVADO: 'Devuelto', VALIDADO: 'Por recibir', RECIBIDO: 'Recibido' };
  var TONO_REP = { SIN_INICIAR: 'neutro', BORRADOR: 'info', EN_REVISION: 'alerta', OBSERVADO: 'critico', VALIDADO: 'primario', RECIBIDO: 'ok' };
  var ACC_TXT = { INFORME_CREADO: 'lo empezó', INFORME_A_FINANZAS: 'lo envió a Finanzas y Cobranzas', INFORME_APROBADO_FINANZAS: 'lo aprobó (Finanzas)', INFORME_APROBADO_COBRANZAS: 'lo aprobó (Cobranzas)',
    INFORME_A_GERENCIA: 'lo envió a Gerencia', INFORME_DEVUELTO: 'lo devolvió', INFORME_CERRADO: 'lo cerró' };

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function nombre(e) { return e ? x_.nombre(e) : '—'; }
  function fecha(iso) { if (!iso) return ''; var d = new Date(iso); if (isNaN(d)) return String(iso); try { return d.toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return String(iso).slice(0, 16); } }
  function dia(f) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f || ''); return m ? m[3] + '-' + m[2] : ''; }
  function aviso(tono, icono, html) { return '<div class="mj2-aviso sx2-tono-' + tono + ' sx2-entra">' + U.ico(icono, 16) + '<span>' + html + '</span></div>'; }
  function resolver(correos) { if (!window.SigsoDirectorio || !SigsoDirectorio.resolver) return Promise.resolve(); return SigsoDirectorio.resolver(correos.filter(function (e) { return e && /@/.test(e); })).catch(function () {}); }
  function selectorMes() {
    return '<span class="ci2-periodo" role="group" aria-label="Mes">' +
      U.boton({ soloIcono: true, icono: 'izquierda', variante: 'fantasma', sm: true, titulo: 'Mes anterior', clase: 'js-ig-mes', datos: { n: -1 } }) +
      '<strong>' + txt(x_.perTexto(est_.periodo)) + '</strong>' +
      U.boton({ soloIcono: true, icono: 'derecha', variante: 'fantasma', sm: true, titulo: 'Mes siguiente', clase: 'js-ig-mes', datos: { n: 1 } }) + '</span>';
  }

  // =========================================================================================
  // Carga
  // =========================================================================================
  function mostrar(ctx) {
    x_ = ctx;
    if (!est_.periodo) est_.periodo = x_.mover(x_.periodoActual(), -1);
    var t = ++est_.turno;
    x_.pagina(x_.cabecera(x_.modNombre, 'Informe de gestión', 'Cargando…') + U.esqueleto('kpis', 4) + U.esqueleto('tarjetas', 4));
    Promise.all([x_.api('getInformeGestion', { periodo: est_.periodo }), x_.api('historialInformeGestion', { periodo: est_.periodo })]).then(function (rs) {
      if (t !== est_.turno) return;
      var r = rs[0];
      if (!r || !r.ok) { x_.pagina(x_.cabecera(x_.modNombre, 'Informe de gestión', '') + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar el informe', texto: (r && r.message) || '' }) })); return; }
      est_.datos = r.data;
      est_.hist = (rs[1] && rs[1].ok && rs[1].data.historial) || [];
      pintar();
      var d = est_.datos, c = [];
      Object.keys(d.cadena || {}).forEach(function (k) { c = c.concat(d.cadena[k]); });
      (d.ejecutivo.reportes_areas || []).forEach(function (a) { c.push(a.autor_email, a.validado_por, a.recibido_por); });
      ((d.informe || {}).comentarios || []).forEach(function (x) { c.push(x.email); });
      est_.hist.forEach(function (h) { c.push(h.usuario_email); });
      resolver(c).then(function () { if (t === est_.turno) pintar(true); });
    });
  }

  // =========================================================================================
  // La cadena: seis pasos con plazo
  // =========================================================================================
  function cadena(d) {
    var e = d.estado, inf = d.informe || {}, aprob = inf.aprobaciones || {};
    var areas = d.ejecutivo.reportes_areas || [];
    var recibidos = areas.filter(function (a) { return a.estado === 'RECIBIDO'; }).length;
    var actual = { SIN_INICIAR: 3, PREPARACION: 3, EN_FINANZAS: 4, EN_CONTROL: 5, EN_GERENCIA: 6, CERRADO: 7 }[e];
    var quien = function (rol) { return (d.cadena[rol] || []).map(nombre).join(', ') || 'sin asignar'; };
    var det = {
      OPERATIVO: areas.filter(function (a) { return a.fecha_envio; }).length + ' de ' + areas.length + ' áreas enviaron',
      JEFATURA: areas.filter(function (a) { return a.validado_por; }).length + ' de ' + areas.length + ' validados · ' + recibidos + ' recibidos',
      ADMINISTRACION: inf.fecha_envio_finanzas ? 'Envió ' + fecha(inf.fecha_envio_finanzas) : quien('ADMINISTRACION'),
      FINANZAS: (aprob.FINANZAS ? '✓ ' + nombre(aprob.FINANZAS.email) : quien('FINANZAS')) + ' · ' + (aprob.COBRANZAS ? '✓ ' + nombre(aprob.COBRANZAS.email) : quien('COBRANZAS')),
      CONTROL: inf.fecha_envio_gerencia ? 'Envió ' + fecha(inf.fecha_envio_gerencia) : quien('CONTROL'),
      GERENCIA: inf.fecha_cierre ? 'Cerró ' + fecha(inf.fecha_cierre) : quien('GERENCIA')
    };
    return '<ol class="ig-cadena sx2-entra">' + d.plazos.map(function (p) {
      // Pasos 1 y 2 (áreas y jefaturas) se cumplen cuando TODAS las áreas enviaron / validaron, no por el paso del informe.
      var hecho = p.paso === 1 ? !!areas.length && areas.every(function (a) { return a.fecha_envio; })
        : (p.paso === 2 ? !!areas.length && areas.every(function (a) { return a.validado_por; }) : p.paso < actual);
      var cls = hecho ? ' is-hecho' : (p.paso === actual ? ' is-actual' : '');
      return '<li class="ig-paso' + cls + (p.vencido && !hecho ? ' is-vencido' : '') + '"><span class="ig-paso__n">' + (hecho ? U.ico('check', 13) : p.paso) + '</span>' +
        '<span class="ig-paso__txt"><strong>' + txt(p.nombre) + '</strong><span>' + txt(det[p.clave] || '') + '</span>' +
        '<em>' + (p.vencido && !hecho ? 'Atrasado · ' : 'Plazo ') + txt(dia(p.fecha)) + '</em></span></li>';
    }).join('') + '</ol>';
  }

  // =========================================================================================
  // El documento
  // =========================================================================================
  function semaforo(ej) {
    return '<div class="ig-semaforo">' + (ej.semaforo || []).map(function (s) {
      return '<div class="ig-area ig-area--' + U.esc(s.nivel) + '"><strong>' + txt(s.nombre) + '</strong>' + U.badge(TXT_AREA[s.nivel] || s.nivel, TONO_AREA[s.nivel] || 'neutro') + '<span>' + txt(s.resumen) + '</span></div>';
    }).join('') + '</div>';
  }
  /** Las áreas lado a lado: cuántos indicadores en meta, para vigilar y críticos, con su cifra principal. */
  function comparativo(ej) {
    var a = ej.areas_resumen || [];
    if (!a.length) return '';
    return '<div class="ig-comp">' + a.map(function (x) {
      var c = x.cuenta || {}, t = (c.ok || 0) + (c.alerta || 0) + (c.critico || 0) + (c.otros || 0);
      var seg = function (n, cl, et) { return n ? '<span class="ig-comp__seg ig-comp__seg--' + cl + '" style="flex:' + n + '" title="' + U.esc(n + ' ' + et) + '"></span>' : ''; };
      return '<div class="ig-comp__fila"><span class="ig-comp__area"><strong>' + txt(x.nombre) + '</strong>' + U.badge(TXT_AREA[x.nivel] || x.nivel, TONO_AREA[x.nivel] || 'neutro') + '</span>' +
        '<span class="ig-comp__barra" role="img" aria-label="' + U.esc((c.ok || 0) + ' en meta, ' + (c.alerta || 0) + ' para vigilar, ' + (c.critico || 0) + ' críticos') + '">' +
          (t ? seg(c.critico, 'critico', 'críticos') + seg(c.alerta, 'alerta', 'para vigilar') + seg(c.ok, 'ok', 'en meta') + seg(c.otros, 'otros', 'informativos') : '<span class="ig-comp__vacia">Sin indicadores todavía</span>') + '</span>' +
        '<span class="ig-comp__cifra">' + (x.cifra ? txt(x.cifra.nombre) + ': <b>' + txt(x.cifra.valor) + '</b>' + (x.cifra.estado === 'en_curso' && x.cifra.valor !== 'en curso' ? ' <span class="sx2-tenue">(parcial)</span>' : '') : '<span class="sx2-tenue">—</span>') + '</span></div>';
    }).join('') + '<p class="ig-comp__ley"><i class="ig-comp__seg--critico"></i>Crítico <i class="ig-comp__seg--alerta"></i>Para vigilar <i class="ig-comp__seg--ok"></i>En meta <i class="ig-comp__seg--otros"></i>Informativo</p></div>';
  }
  /** Lo que Gerencia acordó el mes pasado, con su plazo. */
  function seguimiento(d) {
    var l = d.decisiones_anteriores || [];
    if (!l.length) return '';
    return '<section class="ci2-rep-sec"><h2 class="rp2-sub">Seguimiento de lo acordado el mes pasado</h2><ul class="ig-decisiones">' + l.map(function (x) {
      return '<li class="ig-dec">' + U.badge(x.vencida ? 'Plazo vencido' : 'En plazo', x.vencida ? 'critico' : 'info') + '<span><strong>' + txt(x.texto) + '</strong>' +
        (x.responsable || x.plazo ? '<em>' + txt([x.responsable, x.plazo ? 'plazo ' + x.plazo.split('-').reverse().join('-') : ''].filter(Boolean).join(' · ')) + '</em>' : '') + '</span></li>';
    }).join('') + '</ul></section>';
  }
  function decisiones(d, editable) {
    var inf = d.informe || {};
    var lista = (inf.decisiones && inf.decisiones.length) ? inf.decisiones : (d.decisiones_sugeridas || []);
    if (!editable) {
      if (!lista.length) return '<p class="sx2-tenue">Sin decisiones registradas.</p>';
      return '<ul class="ig-decisiones">' + lista.map(function (x) {
        return '<li class="ig-dec ig-dec--' + U.esc(x.estado.toLowerCase()) + '">' + U.badge(x.estado === 'ACORDADA' ? 'Acordada' : (x.estado === 'DESCARTADA' ? 'Descartada' : 'Propuesta'), x.estado === 'ACORDADA' ? 'ok' : (x.estado === 'DESCARTADA' ? 'neutro' : 'info')) +
          '<span><strong>' + txt(x.texto) + '</strong>' + (x.responsable || x.plazo ? '<em>' + txt([x.responsable, x.plazo ? 'plazo ' + x.plazo.split('-').reverse().join('-') : ''].filter(Boolean).join(' · ')) + '</em>' : '') + (x.origen ? '<small>Origen: ' + txt(x.origen) + '</small>' : '') + '</span></li>';
      }).join('') + '</ul>';
    }
    var ger = d.estado === 'EN_GERENCIA';
    return '<div class="ig-dec-ed js-ig-dec">' + lista.concat([{ texto: '', responsable: '', plazo: '', estado: ger ? 'ACORDADA' : 'PROPUESTA' }]).map(function (x, i) {
      return '<div class="ig-dec-fila" data-id="' + U.esc(x.id || '') + '" data-origen="' + U.esc(x.origen || '') + '" data-area="' + U.esc(x.area || '') + '">' +
        '<input class="sx2-input" data-c="texto" value="' + U.esc(x.texto) + '" placeholder="Decisión" aria-label="Decisión ' + (i + 1) + '">' +
        '<input class="sx2-input" data-c="responsable" value="' + U.esc(x.responsable) + '" placeholder="Responsable" aria-label="Responsable">' +
        '<input class="sx2-input" type="date" data-c="plazo" value="' + U.esc(x.plazo) + '" aria-label="Plazo">' +
        '<select class="sx2-select" data-c="estado" aria-label="Estado">' + [['PROPUESTA', 'Propuesta'], ['ACORDADA', 'Acordada'], ['DESCARTADA', 'Descartada']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === x.estado ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>';
    }).join('') + '<div class="ig-dec-acc">' + U.boton({ texto: 'Agregar decisión', icono: 'nueva', variante: 'fantasma', sm: true, clase: 'js-ig-dec-mas' }) +
      U.boton({ texto: 'Guardar decisiones', icono: 'check', sm: true, clase: 'js-ig-dec-guardar' }) + '</div></div>';
  }
  function leerDecisiones() {
    return [].slice.call(x_.raiz().querySelectorAll('.js-ig-dec .ig-dec-fila')).map(function (f) {
      var o = { id: f.getAttribute('data-id') || '', origen: f.getAttribute('data-origen') || '', area: f.getAttribute('data-area') || '' };
      f.querySelectorAll('[data-c]').forEach(function (i) { o[i.getAttribute('data-c')] = i.value.trim(); });
      return o;
    }).filter(function (o) { return o.texto; });
  }
  function areasReportes(ej) {
    var a = ej.reportes_areas || [];
    return '<div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr><th>Área</th><th>Reporte</th><th>Preparó</th><th>Validó (jefatura)</th><th>Comentarios</th><th></th></tr></thead><tbody>' +
      a.map(function (r) {
        var com = [r.comentario_area ? 'Área: ' + r.comentario_area : '', r.observacion_jefatura ? 'Jefatura: ' + r.observacion_jefatura : '', r.observacion_administracion ? 'Administración: ' + r.observacion_administracion : ''].filter(Boolean).join(' · ');
        return '<tr><td><strong>' + txt(r.nombre) + '</strong></td><td>' + U.badge(EST_REP[r.estado] || r.estado, TONO_REP[r.estado] || 'neutro') + '</td><td>' + txt(r.autor_email ? nombre(r.autor_email) : '—') + '</td><td>' + txt(r.validado_por ? nombre(r.validado_por) : '—') + '</td><td>' + (com ? txt(com) : '<span class="sx2-tenue">—</span>') + '</td>' +
          '<td>' + (r.reporte_id ? '<button type="button" class="sx2-enlace" data-dr-ir="reporte:' + U.esc(r.reporte_id) + '">Abrir</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function comentarios(d) {
    var lista = (d.informe || {}).comentarios || [];
    var mio = lista.filter(function (c) { return c.email === d.yo.email; })[0];
    var caja = d.acciones.comentar ? '<div class="ig-mi-com"><label class="dr-campo"><span class="dr-campo__tit">Tu comentario (opcional)</span>' +
      '<textarea class="sx2-input dr-texto js-ig-com" rows="2" placeholder="Si tienes algo que opinar del informe, déjalo aquí: llega hasta Gerencia.">' + U.esc(mio ? mio.texto : '') + '</textarea></label>' +
      U.boton({ texto: 'Guardar comentario', icono: 'comentario', sm: true, clase: 'js-ig-com-guardar' }) + '</div>' : '';
    return (lista.length ? '<ul class="ig-coms">' + lista.map(function (c) { return '<li><b>' + txt(c.rol_txt) + ' · ' + txt(nombre(c.email)) + '</b><span>' + txt(c.texto) + '</span><em>' + txt(fecha(c.fecha)) + '</em></li>'; }).join('') + '</ul>' : '<p class="sx2-tenue">Sin comentarios todavía.</p>') + caja;
  }
  function documento(d) {
    var ej = d.ejecutivo, inf = d.informe || {};
    var criticas = (ej.alertas || []).filter(function (a) { return a.nivel === 'critico'; }), vigilar = (ej.alertas || []).filter(function (a) { return a.nivel !== 'critico'; });
    var editDec = d.acciones.editar_decisiones;
    var concl = d.estado === 'EN_CONTROL' && d.acciones.enviar_gerencia
      ? '<textarea class="sx2-input dr-texto js-ig-concl" rows="3" placeholder="Lo que concluye Control del mes, en dos o tres frases.">' + U.esc(inf.conclusion || '') + '</textarea>'
      : (inf.conclusion ? '<p class="dr-parrafo">' + txt(inf.conclusion) + '</p>' : '<p class="sx2-tenue">La deja el Analista de Control antes de enviarlo a Gerencia.</p>');
    var cuerpo =
      (ej.titular ? '<p class="ip-titular ig-titular">' + txt(ej.titular) + '</p>' : '') +
      '<section class="ci2-rep-sec"><h2 class="rp2-sub">Las áreas en una mirada</h2>' + (ej.areas_resumen ? comparativo(ej) : semaforo(ej)) + '</section>' +
      '<section class="ci2-rep-sec"><h2 class="rp2-sub">Requiere su decisión</h2>' + (criticas.length ? '<div class="ind-alertas">' + criticas.map(I().alerta).join('') + '</div>' : '<p class="ind-ok">' + U.ico('check', 16) + ' Sin alertas críticas este mes.</p>') + '</section>' +
      (vigilar.length ? '<section class="ci2-rep-sec"><h2 class="rp2-sub">Para vigilar</h2><div class="ind-alertas">' + vigilar.map(I().alerta).join('') + '</div></section>' : '') +
      '<section class="ci2-rep-sec"><h2 class="rp2-sub">Decisiones' + (d.estado === 'EN_CONTROL' ? ' propuestas por Control' : '') + '</h2>' + decisiones(d, editDec) + '</section>' +
      seguimiento(d) +
      '<section class="ci2-rep-sec"><h2 class="rp2-sub">Conclusión del Analista de Control</h2>' + concl + '</section>' +
      '<section class="ci2-rep-sec"><h2 class="rp2-sub">Indicadores clave</h2><div class="ind-kpis">' + (ej.indicadores || []).map(I().tarjeta).join('') + '</div></section>' +
      ((ej.bien || []).length ? '<section class="ci2-rep-sec"><h2 class="rp2-sub">Lo que va bien</h2><ul class="ig-bien">' + ej.bien.map(function (b) { return '<li><b>' + txt(b.area) + ':</b> ' + txt(b.texto) + '</li>'; }).join('') + '</ul></section>' : '') +
      '<section class="ci2-rep-sec"><h2 class="rp2-sub">Reportes de las áreas</h2>' + areasReportes(ej) + ((ej.faltantes_al_enviar || []).length ? '<p class="sx2-tenue">Se envió sin el reporte de: ' + txt(ej.faltantes_al_enviar.join(', ')) + '.</p>' : '') + '</section>' +
      '<section class="ci2-rep-sec"><h2 class="rp2-sub">Comentarios de la cadena</h2>' + comentarios(d) + '</section>' +
      ((ej.calidad || []).length ? '<section class="ci2-rep-sec"><h2 class="rp2-sub">Calidad del dato</h2>' + I().tabla('Matrices con cifras a revisar', [{ t: 'Área', v: 'area' }, { t: 'Matriz', v: 'matriz' }, { t: 'Problema', v: 'problema' }], ej.calidad) + '</section>' : '');
    return '<div class="rp2-documento ci2-doc js-ig-doc">' + R().barraAcciones({ volver: false }) +
      R().cabeceraDocumento({ titulo: 'Informe de gestión · ' + x_.perTexto(d.periodo, true), subtitulo: d.estado_texto + (d.congelado ? ' · cifras congeladas al enviarlo' : ' · cifras en vivo'), modulo: 'Administración', periodo: x_.perTexto(d.periodo, true) }) +
      cuerpo + R().pieDocumento('Informe preparado por las áreas, validado por sus jefaturas, revisado por Administración, Finanzas y Cobranzas y el Analista de Control. Indicadores y explicaciones calculados por SIGSO.') + '</div>';
  }

  // =========================================================================================
  // Pintar
  // =========================================================================================
  function pintar(silencioso) {
    var d = est_.datos, a = d.acciones;
    var b = '';
    if (a.enviar_finanzas) b += U.boton({ texto: 'Enviar a Finanzas y Cobranzas', icono: 'derivar', variante: 'primario', clase: 'js-ig-enviar' });
    if (a.aprobar_finanzas) b += U.boton({ texto: 'Aprobar (Finanzas)', icono: 'escudoCheck', variante: 'primario', clase: 'js-ig-aprobar', datos: { rol: 'FINANZAS' } });
    if (a.aprobar_cobranzas) b += U.boton({ texto: 'Aprobar (Cobranzas)', icono: 'escudoCheck', variante: 'primario', clase: 'js-ig-aprobar', datos: { rol: 'COBRANZAS' } });
    if (a.enviar_gerencia) b += U.boton({ texto: 'Enviar a Gerencia', icono: 'derivar', variante: 'primario', clase: 'js-ig-gerencia' });
    if (a.cerrar) b += U.boton({ texto: 'Cerrar con estas decisiones', icono: 'check', variante: 'primario', clase: 'js-ig-cerrar' });
    if (a.devolver) b = U.boton({ texto: 'Devolver con observaciones', icono: 'comentario', clase: 'js-ig-devolver' }) + b;
    var inf = d.informe || {};
    var avisos = '';
    if (inf.motivo_devolucion && d.estado !== 'CERRADO' && inf.fecha_devolucion) avisos += aviso('critico', 'comentario', '<b>Devuelto por ' + txt(nombre(inf.devuelto_por)) + '</b> (' + txt(fecha(inf.fecha_devolucion)) + '): ' + txt(inf.motivo_devolucion));
    if (a.aprobar_finanzas || a.aprobar_cobranzas) avisos += aviso('info', 'escudoCheck', 'Revisa el informe, sobre todo facturación y cobranza. <b>Apruébalo</b> o devuélvelo a Administración con lo que hay que corregir.' + ((d.cadena.FINANZAS || []).indexOf(d.yo.email) !== -1 && a.aprobar_finanzas ? ' Tu validación como jefatura de Contabilidad ya está incluida: aquí apruebas una sola vez.' : ''));
    if (a.enviar_gerencia) avisos += aviso('info', 'lupa', 'Eres el filtro final: revisa que las cifras sean consistentes, deja tu <b>conclusión</b> y las <b>decisiones</b> que se le piden a Gerencia (vienen sugeridas desde las alertas).');
    if (a.cerrar) avisos += aviso('info', 'tendencia', 'Marca cada decisión como <b>acordada</b> o <b>descartada</b>, con su responsable y plazo, y cierra el informe. Se avisa a toda la cadena.');
    var hist = est_.hist.length ? '<ul class="dr-hist">' + est_.hist.slice().reverse().map(function (h) { return '<li><span class="dr-hist__punto"></span><span><strong>' + txt(nombre(h.usuario_email)) + '</strong> ' + txt(ACC_TXT[h.accion] || h.accion) + '<span class="sx2-tenue"> · ' + txt(fecha(h.fecha)) + '</span>' + (h.accion === 'INFORME_DEVUELTO' ? '<br><span class="sx2-tenue">' + txt(h.detalle) + '</span>' : '') + '</span></li>'; }).join('') + '</ul>' : '<p class="sx2-tenue">Todavía sin movimientos.</p>';
    x_.pagina(x_.cabecera(x_.modNombre, 'Informe de gestión · ' + x_.perTexto(d.periodo, true), 'Lo que llega a Gerencia: primero lo que requiere decisión.', selectorMes() +
        (d.yo.es_admin ? U.boton({ texto: 'Cadena', icono: 'equipo', variante: 'fantasma', clase: 'js-ig-cadena' }) : '') +
        U.boton({ texto: 'Reportes de las áreas', icono: 'bandeja', variante: 'fantasma', clase: 'js-ig-areas' })) +
      cadena(d) + avisos +
      '<div class="dr-barra sx2-entra">' + U.badge(d.estado_texto, TONO_EST[d.estado] || 'neutro') + '<span style="flex:1"></span>' + b + '</div>' +
      '<div class="dr-cols"><div class="dr-principal">' + documento(d) + '</div><aside class="dr-lateral">' + U.card({ i: 2, titulo: 'Historial', icono: 'reloj', cuerpo: hist }) + '</aside></div>', silencioso);
    var doc = x_.raiz().querySelector('.js-ig-doc');
    if (doc) R().wireAcciones(doc, { nombreArchivo: 'Informe de gestion ' + x_.perTexto(d.periodo) });
  }

  // =========================================================================================
  // Acciones
  // =========================================================================================
  function avanzar(datos, okMsg) {
    return x_.api('avanzarInformeGestion', Object.assign({ periodo: est_.periodo }, datos)).then(function (r) {
      if (!r || !r.ok) { window.PYv2.aviso((r && r.message) || 'No se pudo.', 'error'); return r; }
      window.PYv2.aviso((r.data && r.data.message) || okMsg || 'Listo.', 'exito');
      if (x_.contadores) x_.contadores();
      mostrar(x_);
      return r;
    });
  }
  function enviarFinanzas() {
    x_.api('avanzarInformeGestion', { periodo: est_.periodo, accion: 'enviar_finanzas' }).then(function (r) {
      if (r && r.ok) { window.PYv2.aviso(r.data.message, 'exito'); if (x_.contadores) x_.contadores(); mostrar(x_); return; }
      var faltan = r && r.data && r.data.faltan;
      if (!faltan) { window.PYv2.aviso((r && r.message) || 'No se pudo.', 'error'); return; }
      U.confirmar({ titulo: '¿Enviar sin todas las áreas?', texto: 'Aún no recibes el reporte de: ' + faltan.join(', ') + '. Si lo envías igual, el informe lo dirá.', boton: 'Enviar igual' }).then(function (ok) {
        if (ok) avanzar({ accion: 'enviar_finanzas', confirmar_faltantes: true });
      });
    });
  }
  function conNota(titulo, boton, obligatoria, datos, ayuda) {
    U.formulario({ titulo: titulo, boton: boton,
      campos: U.campo(obligatoria ? 'Qué hay que corregir' : 'Nota (opcional)', '<textarea class="sx2-input" name="observacion" rows="4"></textarea>', ayuda || ''),
      preparar: function (v) { if (obligatoria && !v.observacion) return 'Escribe qué hay que corregir.'; return Object.assign({ periodo: est_.periodo, observacion: v.observacion }, datos); },
      enviar: function (p) { return x_.api('avanzarInformeGestion', p); },
      aviso: function (r) { return (r && r.data && r.data.message) || 'Listo.'; },
      listo: function () { if (x_.contadores) x_.contadores(); mostrar(x_); } });
  }
  function guardarDecisiones(silencioso) {
    var concl = x_.raiz().querySelector('.js-ig-concl');
    var p = { periodo: est_.periodo, decisiones: leerDecisiones() };
    if (concl) p.conclusion = concl.value;
    return x_.api('decisionesInformeGestion', p).then(function (r) {
      if (!r || !r.ok) { window.PYv2.aviso((r && r.message) || 'No se pudo guardar.', 'error'); return false; }
      if (!silencioso) { window.PYv2.aviso('Decisiones guardadas.', 'exito'); mostrar(x_); }
      return true;
    });
  }

  // =========================================================================================
  // La cadena (ADM): quién ocupa cada paso
  // =========================================================================================
  function vistaCadena(ctx) {
    x_ = ctx;
    var t = ++est_.turno;
    x_.pagina(x_.cabecera(x_.modNombre, 'Cadena de reportes', 'Cargando…') + U.esqueleto('tarjetas', 3));
    x_.api('listarCadenaReportes', {}).then(function (r) {
      if (t !== est_.turno) return;
      if (!r || !r.ok) { x_.pagina(x_.cabecera(x_.modNombre, 'Cadena de reportes', '') + U.card({ cuerpo: U.vacio({ icono: 'candado', titulo: 'No se pudo cargar', texto: (r && r.message) || '' }) })); return; }
      var d = r.data, c = [];
      d.roles.forEach(function (x) { c = c.concat(x.personas); });
      resolver(c).then(function () {
        if (t !== est_.turno) return;
        x_.pagina(x_.cabecera(x_.modNombre, 'Cadena de reportes', 'Quién revisa el informe de gestión después de Administración. Los pasos 1 y 2 son la jefatura y el equipo de cada área (sus Accesos).',
          U.boton({ texto: 'Informe de gestión', icono: 'izquierda', variante: 'fantasma', clase: 'js-ig-volver' })) +
          '<div class="ci2-rep-grid">' + d.roles.map(function (x, i) {
            return U.card({ i: i + 1, titulo: x.nombre, icono: 'persona', accion: x.editable ? { texto: 'Editar', clase: 'js-ig-rol', datos: { rol: x.rol } } : null,
              cuerpo: (x.personas.length ? '<ul class="ci2-miembros">' + x.personas.map(function (e) { return '<li>' + txt(nombre(e)) + '</li>'; }).join('') + '</ul>' : '<p class="sx2-tenue">Sin asignar.</p>') +
                (x.editable ? '' : '<p class="sx2-tenue" style="margin:8px 0 0">Se define en Accesos de Administración.</p>') });
          }).join('') + '</div>' +
          U.card({ i: 6, titulo: 'Plazos de la cadena', icono: 'calendario', cuerpo: '<ul class="ig-plazos">' + d.plazos.map(function (p) { return '<li><b>Paso ' + p.paso + '.</b> ' + txt(p.nombre) + ' <span class="sx2-tenue">· día hábil ' + p.dia + ' del mes siguiente</span></li>'; }).join('') + '</ul>' }));
        x_.raiz().__cadena = d;
      });
    });
  }
  function editarRol(rol) {
    var d = x_.raiz().__cadena, x = d && d.roles.filter(function (r) { return r.rol === rol; })[0];
    if (!x) return;
    var filas = x.personas.concat(['', '']);
    U.formulario({ titulo: x.nombre, boton: 'Guardar',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Deja vacía una fila para quitar a esa persona.</span>',
      campos: filas.map(function (e, k) { return U.campo('Persona', '<input class="sx2-input" type="email" data-persona name="p_' + k + '" value="' + U.esc(e) + '">'); }).join(''),
      preparar: function (v) { var p = []; filas.forEach(function (e, k) { if (v['p_' + k]) p.push(v['p_' + k]); }); return { rol: rol, personas: p }; },
      enviar: function (p) { return x_.api('guardarCadenaReportes', p); },
      aviso: function (r) { return (r && r.data && r.data.message) || 'Guardado.'; },
      listo: function () { vistaCadena(x_); } });
  }

  // =========================================================================================
  // Eventos
  // =========================================================================================
  function mio(ev) { var c = x_ && x_.raiz(); return !!c && c.contains(ev.target); }
  document.addEventListener('click', function (ev) {
    if (!mio(ev)) return;
    var t = ev.target, b;
    if ((b = t.closest('.js-ig-mes'))) { est_.periodo = x_.mover(est_.periodo, Number(b.getAttribute('data-n'))); mostrar(x_); return; }
    if (t.closest('.js-ig-areas')) { x_.irAItem('areas'); return; }
    if (t.closest('.js-ig-cadena')) { x_.irAItem('cadena'); return; }
    if (t.closest('.js-ig-volver')) { x_.irAItem('inicio'); return; }
    if ((b = t.closest('.js-ig-rol'))) { editarRol(b.getAttribute('data-rol')); return; }
    if (t.closest('.js-ig-enviar')) { enviarFinanzas(); return; }
    if ((b = t.closest('.js-ig-aprobar'))) { conNota('Aprobar el informe', 'Aprobar', false, { accion: 'aprobar', rol: b.getAttribute('data-rol') }, 'Queda registrado que lo aprobaste.'); return; }
    if (t.closest('.js-ig-gerencia')) {
      guardarDecisiones(true).then(function (ok) { if (!ok) return; U.confirmar({ titulo: '¿Enviar a Gerencia?', texto: 'Le llega a Gerencia con tu conclusión y las decisiones propuestas.', boton: 'Enviar' }).then(function (si) { if (si) avanzar({ accion: 'enviar_gerencia' }); }); });
      return;
    }
    if (t.closest('.js-ig-cerrar')) {
      var dec = leerDecisiones();
      U.confirmar({ titulo: '¿Cerrar el informe?', texto: dec.filter(function (x) { return x.estado === 'ACORDADA'; }).length + ' decisiones acordadas. Se avisa a toda la cadena.', boton: 'Cerrar' }).then(function (si) { if (si) avanzar({ accion: 'cerrar', decisiones: dec }); });
      return;
    }
    if (t.closest('.js-ig-devolver')) { conNota('Devolver con observaciones', 'Devolver', true, { accion: 'devolver' }, 'Vuelve al paso anterior para que lo corrijan.'); return; }
    if (t.closest('.js-ig-dec-guardar')) { guardarDecisiones(false); return; }
    if (t.closest('.js-ig-dec-mas')) {
      var cont = x_.raiz().querySelector('.js-ig-dec'), filas = cont.querySelectorAll('.ig-dec-fila');
      var nueva = filas[filas.length - 1].cloneNode(true);
      nueva.setAttribute('data-id', ''); nueva.setAttribute('data-origen', ''); nueva.setAttribute('data-area', '');
      nueva.querySelectorAll('input').forEach(function (i) { i.value = ''; });
      filas[filas.length - 1].after(nueva);
      nueva.querySelector('input').focus();
      return;
    }
    if (t.closest('.js-ig-com-guardar')) {
      var tx = x_.raiz().querySelector('.js-ig-com');
      x_.api('comentarInformeGestion', { periodo: est_.periodo, texto: tx ? tx.value : '' }).then(function (r) {
        if (!r || !r.ok) { window.PYv2.aviso((r && r.message) || 'No se pudo.', 'error'); return; }
        window.PYv2.aviso(r.data.message, 'exito'); mostrar(x_);
      });
    }
  });

  window.SigsoInformeGestion = { mostrar: mostrar, cadena: vistaCadena };
})();
