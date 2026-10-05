/**
 * agenda-depto-v2.js — la AGENDA de cada departamento (2026-10-04).
 *
 *  - Hoy          lo que toca recordar hoy, lo atrasado y quién no respondió,
 *                 con el mensaje YA redactado. SIGSO no envía nada (costo
 *                 cero): WhatsApp se abre con el texto listo (wa.me) y queda
 *                 registrado; el correo se copia, se envía desde el correo
 *                 corporativo del área y se confirma aquí.
 *  - Calendario   el mes: vencimientos, recordatorios, escalamientos, tareas
 *                 internas, feriados y fechas propias del área.
 *  - Registro     cada recordatorio enviado y cada respuesta del cliente.
 *  - Por cliente  todo lo que se le ha recordado a un cliente.
 *  - Ajustes      fechas, escalones y mensajes (jefatura del área o superusuario).
 *  - avisoDelDia  el aviso llamativo al entrar (una vez al día).
 *
 * El servidor calcula todo (backend/logica/agendaDepto.js); aquí se pinta.
 * Cada vista recibe el contexto del módulo del área (control-interno-v2.js).
 */
(function () {
  'use strict';

  var U = UIv2;
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var DIAS_CORTOS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
  var CANAL = { WHATSAPP: { txt: 'WhatsApp', ico: 'comentario' }, CORREO: { txt: 'Correo', ico: 'correo' }, LLAMADA: { txt: 'Llamada', ico: 'persona' }, INTERNO: { txt: 'Tarea interna', ico: 'check' } };
  var ESTADO = {
    HOY: { txt: 'Para hoy', tono: 'info' }, ATRASADO: { txt: 'Atrasado', tono: 'critico' },
    SIN_RESPUESTA: { txt: 'Sin respuesta', tono: 'alerta' }, EN_SEGUIMIENTO: { txt: 'Respondió', tono: 'ok' }
  };
  var TIPO_EV = {
    LIMITE: { txt: 'Vencimiento', clase: 'limite' }, RECORDATORIO: { txt: 'Recordatorio', clase: 'recordatorio' },
    ESCALAMIENTO: { txt: 'Escalamiento', clase: 'escala' }, INTERNO: { txt: 'Tarea interna', clase: 'interno' },
    EVENTO: { txt: 'Fecha del área', clase: 'evento' }, CLIENTE: { txt: 'Cita de cliente', clase: 'cliente' }, FERIADO: { txt: 'Feriado', clase: 'feriado' }
  };
  var CORTO = { CONTABILIDAD: 'Contab.', RRHH: 'RR.HH.', PREVENCION: 'Prev.', MARKETING: 'Mkt.', COBRANZAS: 'Cobr.' };
  var est_ = {}; // por módulo: { hoy, filtro, mes, registro… }

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function st(x) { var k = x.opc.modulo; return est_[k] = est_[k] || { filtro: '', mes: '', reg: { mes: '', obligacion_id: '', q: '' } }; }
  function hoyClave() { return window.PYv2 && PYv2.hoyClave ? PYv2.hoyClave() : new Date().toISOString().slice(0, 10); }
  function periodoDe(f) { return f.slice(0, 4) + '-M' + f.slice(5, 7); }
  function dia(f) { return new Date(f + 'T12:00:00'); }
  function fechaLarga(f) { var d = dia(f); return ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][d.getDay()] + ' ' + d.getDate() + ' de ' + MESES[d.getMonth()]; }
  // Una fecha 'AAAA-MM-DD' es un día; una marca ISO con hora se lee en la hora local (Chile).
  function fechaCorta(f) { var s = String(f || ''), d = s.length > 10 ? new Date(s) : dia(s); return isNaN(d) ? s : d.getDate() + ' ' + MESES[d.getMonth()].slice(0, 3); }
  function hora(iso) { var d = new Date(iso); return isNaN(d) ? '' : ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function aviso(t, tipo) { if (window.Componentes && Componentes.aviso) Componentes.aviso({ texto: t, tipo: tipo || 'info' }); }
  function firma(x) { var yo = x.cfg && x.cfg.yo; return yo ? x.nombre(yo) : ''; }
  function conFirma(x, t) { return String(t || '').replace(/\{firma\}/g, firma(x) || 'Equipo HomePymes'); }
  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
  function habiles(n) { return n === 0 ? 'hoy' : (n === 1 ? 'mañana (1 día hábil)' : (n < 0 ? 'hace ' + plural(-n, 'día hábil', 'días hábiles') : 'en ' + plural(n, 'día hábil', 'días hábiles'))); }
  function copiar(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(texto).then(function () { return true; }, function () { return copiarViejo(texto); });
    return Promise.resolve(copiarViejo(texto));
  }
  function copiarViejo(texto) {
    var t = document.createElement('textarea');
    t.value = texto; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* sin permiso */ }
    document.body.removeChild(t);
    return ok;
  }
  function enlaceWa(tel, texto) { return 'https://wa.me/' + encodeURIComponent(tel) + '?text=' + encodeURIComponent(texto); }

  // =========================================================================================
  // HOY
  // =========================================================================================
  function hoy(x, silencioso) {
    var s = st(x);
    if (!silencioso) x.pagina(x.cabecera(x.modNombre, 'Hoy', 'Cargando…') + U.esqueleto('kpis', 4) + U.esqueleto('tabla', 6));
    return x.api('hoyAgenda', { depto: x.opc.depto }).then(function (r) {
      if (!r || !r.ok) { x.pagina(x.cabecera(x.modNombre, 'Hoy', '') + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || '' }) })); return; }
      s.hoy = r.data;
      pintarHoy(x, !!silencioso);
    });
  }
  function pintarHoy(x, silencioso) {
    var s = st(x), h = s.hoy, R = h.resumen;
    var filtro = s.filtro;
    var grupos = h.grupos.map(function (g) { return Object.assign({}, g, { filas: g.filas.filter(function (f) { return !filtro || f.estado === filtro; }) }); }).filter(function (g) { return g.filas.length; });
    var acciones = (h.puede_registrar ? U.boton({ texto: 'Agregar fecha', icono: 'nueva', clase: 'js-ag-evento' }) : '') +
      U.boton({ soloIcono: true, icono: 'calendario', titulo: 'Calendario', clase: 'js-ag-ir', datos: { ir: 'agenda:cal' } }) +
      U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-ag-recargar' });
    var html = x.cabecera(x.modNombre, 'Hoy, ' + h.fecha_texto, h.habil ? 'Los recordatorios del día con el mensaje listo. Se envían desde el WhatsApp o el correo del área; aquí queda el registro.' : 'Hoy no es día hábil: lo que vence se corre al siguiente hábil.', acciones) +
      franja(h) +
      '<div class="sx2-fila-kpis ag-kpis">' +
        U.kpi({ etiqueta: 'Para hoy', valor: R.por_enviar, icono: 'campana', tono: R.por_enviar ? 'info' : 'ok', filtro: 'HOY', activo: filtro === 'HOY', i: 1 }) +
        U.kpi({ etiqueta: 'Atrasados', valor: R.atrasados, icono: 'alerta', tono: R.atrasados ? 'critico' : 'ok', filtro: 'ATRASADO', activo: filtro === 'ATRASADO', i: 2, titulo: 'Recordatorios cuya fecha ya pasó y no se enviaron' }) +
        U.kpi({ etiqueta: 'Sin respuesta', valor: R.sin_respuesta, icono: 'reloj', tono: R.sin_respuesta ? 'alerta' : 'ok', filtro: 'SIN_RESPUESTA', activo: filtro === 'SIN_RESPUESTA', i: 3, titulo: 'Ya se les enviaron todos los avisos y no han cumplido' }) +
        U.kpi({ etiqueta: 'Enviados hoy', valor: R.enviados_hoy, icono: 'check', tono: 'ok', i: 4 }) +
      '</div>' +
      '<div class="ag-hoy">' +
        '<div class="ag-hoy__lista">' + (grupos.length ? grupos.map(function (g, k) { return grupo(x, h, g, k); }).join('') :
          U.card({ i: 2, cuerpo: U.vacio({ icono: 'check', titulo: filtro ? 'Nada en este filtro' : 'Todo al día', texto: filtro ? 'Quita el filtro para ver el resto.' : 'No hay recordatorios pendientes para hoy. Los próximos aparecen a la derecha.' }) })) + '</div>' +
        '<aside class="ag-hoy__lado">' + proximos(h) + '</aside>' +
      '</div>';
    x.pagina(html, silencioso);
  }
  /** La franja de arriba: la próxima fecha límite con cuenta regresiva; roja si quedan 3 días hábiles o menos. */
  function franja(h) {
    var p = h.proximo;
    if (!p) return '';
    var urgente = p.dias_habiles <= 3 && p.pendientes > 0;
    var pct = p.total ? Math.round(100 * (p.total - p.pendientes) / p.total) : 100;
    var tono = !p.pendientes ? 'ok' : (p.dias_habiles <= 1 ? 'critico' : (urgente ? 'alerta' : 'info'));
    return '<section class="ag-franja ag-franja--' + tono + (urgente ? ' ag-franja--pulso' : '') + ' sx2-entra">' +
      U.anillo(pct, { tam: 72, grosor: 7, tono: tono === 'info' ? 'primario' : tono, texto: p.dias_habiles === 0 ? 'HOY' : String(p.dias_habiles) }) +
      '<div class="ag-franja__txt"><span class="ag-franja__et">' + (p.dias_habiles === 0 ? 'Vence hoy' : 'Próximo vencimiento · ' + txt(habiles(p.dias_habiles))) + '</span>' +
        '<strong>' + txt(p.titulo) + ' · ' + txt(p.periodo_texto) + '</strong>' +
        '<span>' + txt(fechaLarga(p.fecha)) + ' · ' + (p.pendientes ? '<b>' + plural(p.pendientes, 'cliente pendiente', 'clientes pendientes') + '</b> de ' + p.total : 'todos cumplieron') + '</span></div>' +
    '</section>';
  }
  function proximos(h) {
    var l = h.proximos || [];
    return U.card({ i: 3, titulo: 'Próximos 14 días', icono: 'calendario', cuerpo: l.length ? '<ol class="ag-prox">' + l.map(function (p) {
      var t = p.es_limite ? 'limite' : (p.tipo === 'EVENTO' ? 'evento' : (p.tipo === 'INTERNO' ? 'interno' : 'recordatorio'));
      return '<li class="ag-prox__it ag-ev--' + t + '"><span class="ag-prox__f"><b>' + dia(p.fecha).getDate() + '</b>' + txt(MESES[dia(p.fecha).getMonth()].slice(0, 3)) + '</span>' +
        '<span class="ag-prox__t"><strong>' + txt(p.titulo) + '</strong><small>' + txt(habiles(p.dias_habiles)) + (p.hora ? ' · ' + txt(p.hora) : '') +
        (p.pendientes ? ' · ' + plural(p.pendientes, 'pendiente', 'pendientes') : '') + '</small></span></li>';
    }).join('') + '</ol>' : '<p class="sx2-tenue">Nada en los próximos 14 días.</p>' });
  }
  function grupo(x, h, g, k) {
    var atras = g.filas.some(function (f) { return f.estado === 'ATRASADO'; });
    var sinR = g.filas.some(function (f) { return f.estado === 'SIN_RESPUESTA'; });
    var vence = g.dias_habiles < 0 ? 'venció el ' + fechaLarga(g.fecha_limite) : 'vence ' + (g.dias_habiles === 0 ? 'hoy' : 'el ' + fechaLarga(g.fecha_limite)) + ' (' + habiles(g.dias_habiles) + ')';
    var cab = '<div class="ag-grupo__cab"><div><h2>' + txt(g.nombre) + ' <span class="sx2-tenue">· ' + txt(g.periodo_texto) + '</span></h2>' +
      '<span class="ag-grupo__sub">' + txt(vence) + (g.tipo === 'CLIENTE' ? ' · ' + g.cumplidos + ' de ' + g.total + ' cumplidos' : '') + '</span></div>' +
      (g.tipo === 'CLIENTE' && g.total ? U.barra(Math.round(100 * g.cumplidos / g.total), g.cumplidos === g.total ? 'ok' : 'primario') : '') + '</div>';
    var consecuencia = (atras && g.sin_recordatorio ? '<p class="ag-conse ag-conse--critico">' + U.ico('alerta', 14) + '<span><b>Si no se recuerda:</b> ' + txt(g.sin_recordatorio) + '</span></p>' : '') +
      (sinR && g.sin_respuesta ? '<p class="ag-conse ag-conse--alerta">' + U.ico('reloj', 14) + '<span><b>Si el cliente no responde:</b> ' + txt(g.sin_respuesta) + '</span></p>' : '');
    return '<section class="sx2-card ag-grupo sx2-entra" style="--i:' + (k + 2) + '">' + cab + consecuencia +
      '<ul class="ag-filas">' + g.filas.map(function (f, i) { return fila(x, h, g, f, i); }).join('') + '</ul></section>';
  }
  function fila(x, h, g, f, i) {
    var e = ESTADO[f.estado] || ESTADO.HOY, c = CANAL[f.escalon.canal] || CANAL.WHATSAPP;
    var ref = 'data-g="' + txt(g.obligacion_id) + '|' + txt(g.periodo) + '" data-i="' + txt(f.item_clave) + '"';
    var msg = conFirma(x, f.mensaje.texto);
    var contacto = f.interno ? '' : '<span class="ag-fila__contacto">' + (f.telefono ? U.ico('comentario', 12) + '+' + txt(f.telefono) : '<span class="sx2-tono-alerta">sin teléfono</span>') +
      (f.correo ? ' · ' + U.ico('correo', 12) + txt(f.correo) : '') + '</span>';
    var hechos = (f.enviados || []).length ? '<span class="ag-fila__hechos">Enviados: ' + f.enviados.map(function (s) { return txt(s.escalon_id) + ' ' + txt(fechaCorta(s.fecha)); }).join(', ') + '</span>' : '';
    var resp = f.respuesta ? '<span class="ag-fila__resp">' + U.ico('comentario', 12) + txt(f.respuesta.texto) + (f.respuesta.nota ? ': ' + txt(f.respuesta.nota) : '') + '</span>' : '';
    var acc = '';
    if (h.puede_registrar) {
      if (f.estado === 'HOY' || f.estado === 'ATRASADO') {
        if (f.escalon.canal === 'INTERNO') acc += U.boton({ texto: 'Hecho', icono: 'check', variante: 'primario', sm: true, clase: 'js-ag-hecho' });
        else if (f.escalon.canal === 'WHATSAPP' && f.telefono) acc += '<a class="sx2-boton sx2-boton--primario sx2-boton--sm ag-wa js-ag-wa" target="_blank" rel="noopener" href="' + txt(enlaceWa(f.telefono, msg)) + '">' + U.ico('comentario', 14) + 'WhatsApp</a>';
        else if (f.escalon.canal === 'LLAMADA') acc += U.boton({ texto: 'Registrar llamada', icono: 'persona', variante: 'primario', sm: true, clase: 'js-ag-llamada' });
        else acc += U.boton({ texto: 'Copiar ' + (f.escalon.canal === 'CORREO' ? 'correo' : 'mensaje'), icono: 'copiar', variante: 'primario', sm: true, clase: 'js-ag-copiar' });
      }
      acc += U.boton({ texto: 'Ver mensaje', icono: 'ojo', sm: true, clase: 'js-ag-ver' });
      if (!f.interno) acc += '<select class="sx2-select sx2-select--sm js-ag-resp" aria-label="Respuesta del cliente"><option value="">Respuesta…</option>' +
        Object.keys(h.respuestas).map(function (k) { return '<option value="' + k + '">' + txt(h.respuestas[k]) + '</option>'; }).join('') + '</select>';
    } else acc += U.boton({ texto: 'Ver mensaje', icono: 'ojo', sm: true, clase: 'js-ag-ver' });
    return '<li class="ag-fila ag-fila--' + f.estado.toLowerCase() + '" ' + ref + '>' +
      '<div class="ag-fila__quien"><strong>' + txt(f.interno ? f.mensaje.texto : f.cliente_nombre) + '</strong>' + (f.interno ? '' : contacto) + hechos + resp + '</div>' +
      '<div class="ag-fila__que">' + U.badge(e.txt, e.tono) + '<span class="ag-fila__esc">' + U.ico(c.ico, 13) + txt(f.escalon.nombre) + ' · ' + txt(c.txt) +
        (f.escalon.a_quien === 'JEFATURA' ? ' · jefatura' : '') + '</span>' +
        (f.interno ? '' : '<span class="ag-fila__prev">' + txt(msg.length > 150 ? msg.slice(0, 150) + '…' : msg) + '</span>') + '</div>' +
      '<div class="ag-fila__acc">' + acc + '</div></li>';
  }
  function filaDe(x, el) {
    var li = el.closest('.ag-fila'); if (!li) return null;
    var gk = li.getAttribute('data-g').split('|'), ik = li.getAttribute('data-i');
    var g = (st(x).hoy.grupos || []).filter(function (z) { return z.obligacion_id === gk[0] && z.periodo === gk[1]; })[0];
    var f = g && g.filas.filter(function (z) { return z.item_clave === ik; })[0];
    return f ? { g: g, f: f } : null;
  }
  function registrar(x, gf, extra) {
    var p = Object.assign({ obligacion_id: gf.g.obligacion_id, periodo: gf.g.periodo, fecha_limite: gf.g.fecha_limite, item_clave: gf.f.item_clave,
      cliente_id: gf.f.cliente_id, cliente_nombre: gf.f.cliente_nombre, escalon_id: gf.f.escalon.id, canal: gf.f.escalon.canal,
      destino: gf.f.escalon.canal === 'CORREO' ? gf.f.correo : (gf.f.telefono ? '+' + gf.f.telefono : ''), mensaje: conFirma(x, gf.f.mensaje.texto) }, extra || {});
    return x.api('registrarRecordatorio', p).then(function (r) {
      if (!r || !r.ok) { aviso((r && r.message) || 'No se pudo registrar.', 'error'); return null; }
      deshacerAviso(x, r.data);
      hoy(x, true);
      if (x.contadores) x.contadores();
      return r.data;
    });
  }
  /** Aviso con «Deshacer» (por si se tocó sin querer o el WhatsApp no salió). */
  function deshacerAviso(x, d) {
    var viejo = document.querySelector('.ag-deshacer'); if (viejo) viejo.remove();
    var el = document.createElement('div');
    el.className = 'sx2 ag-deshacer';
    el.innerHTML = U.ico('check', 16) + '<span>' + txt(d.message) + '</span>' + U.boton({ texto: 'Deshacer', variante: 'fantasma', sm: true, clase: 'js-ag-deshacer' });
    document.body.appendChild(el);
    var t = setTimeout(function () { el.remove(); }, 9000);
    el.querySelector('.js-ag-deshacer').addEventListener('click', function () {
      clearTimeout(t); el.remove();
      x.api('deshacerRecordatorio', { recordatorio_id: d.recordatorio_id }).then(function (r) {
        aviso(r && r.ok ? 'Deshecho.' : ((r && r.message) || 'No se pudo deshacer.'), r && r.ok ? 'info' : 'error');
        hoy(x, true); if (x.contadores) x.contadores();
      });
    });
  }
  /** Después de copiar un correo: la persona lo envía desde el correo del área y confirma. */
  function confirmarCorreo(x, gf, boton) {
    var acc = boton.closest('.ag-fila__acc');
    acc.innerHTML = '<span class="ag-pregunta">' + U.ico('correo', 14) + '¿Lo enviaste' + (gf.f.correo ? ' a ' + txt(gf.f.correo) : '') + '?</span>' +
      U.boton({ texto: 'Sí, registrar', icono: 'check', variante: 'primario', sm: true, clase: 'js-ag-envie' }) + U.boton({ texto: 'Todavía no', variante: 'fantasma', sm: true, clase: 'js-ag-recargar-suave' });
  }
  function verMensaje(x, gf) {
    var f = gf.f, h = st(x).hoy, esCorreo = f.escalon.canal === 'CORREO';
    var cuerpo = '<div class="sx2-form ag-msg">' +
      '<dl class="ag-msg__datos"><div><dt>Para</dt><dd>' + txt(f.cliente_nombre) + '</dd></div>' +
        (f.interno ? '' : '<div><dt>Teléfono</dt><dd>' + (f.telefono ? '+' + txt(f.telefono) : '<i>sin teléfono en el catálogo</i>') + '</dd></div><div><dt>Correo</dt><dd>' + (f.correo ? txt(f.correo) : '<i>sin correo en el catálogo</i>') + '</dd></div>') +
        '<div><dt>Recordatorio</dt><dd>' + txt(f.escalon.nombre) + ' · ' + txt((CANAL[f.escalon.canal] || {}).txt) + ' · ' + txt(fechaLarga(f.escalon.fecha)) + '</dd></div></dl>' +
      (esCorreo ? U.campo('Asunto', '<input class="sx2-input js-ag-asunto" value="' + txt(conFirma(x, f.mensaje.asunto)) + '">') : '') +
      U.campo('Mensaje', '<textarea class="sx2-input ag-msg__texto js-ag-texto" rows="11">' + txt(conFirma(x, f.mensaje.texto)) + '</textarea>', 'Puedes ajustarlo antes de enviarlo. Lo que se registra es el texto final.') +
      ((f.enviados || []).length ? '<div class="ag-msg__hist"><span class="sx2-campo__et">Ya enviados</span><ul>' + f.enviados.map(function (s) {
        return '<li>' + txt(s.escalon_id) + ' · ' + txt((CANAL[s.canal] || {}).txt || s.canal) + ' · ' + txt(fechaCorta(s.fecha)) + ' ' + txt(hora(s.fecha)) + ' · ' + txt(x.nombre(s.usuario_email)) + '</li>';
      }).join('') + '</ul></div>' : '') + '</div>';
    var pie = '<span style="flex:1"></span>' + U.boton({ texto: 'Copiar', icono: 'copiar', clase: 'js-agm-copiar' }) +
      (h.puede_registrar && !f.interno && f.telefono ? U.boton({ texto: 'Abrir WhatsApp', icono: 'comentario', clase: 'js-agm-wa' }) : '') +
      (h.puede_registrar ? U.boton({ texto: f.interno ? 'Marcar hecho' : 'Registrar como enviado', icono: 'check', variante: 'primario', clase: 'js-agm-reg' }) : '');
    var d = U.drawer({ titulo: f.interno ? 'Tarea interna' : 'Mensaje para ' + f.cliente_nombre, subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + txt(gf.g.nombre) + ' · ' + txt(gf.g.periodo_texto) + '</span>', cuerpo: cuerpo, pie: pie });
    function texto() { var a = d.el.querySelector('.js-ag-asunto'); return (a ? 'Asunto: ' + a.value + '\n\n' : '') + d.el.querySelector('.js-ag-texto').value; }
    d.el.addEventListener('click', function (ev) {
      if (ev.target.closest('.js-agm-copiar')) { copiar(texto()).then(function (ok) { aviso(ok ? 'Mensaje copiado. Pégalo en el correo o chat del área.' : 'No se pudo copiar: selecciona el texto y cópialo a mano.', ok ? 'exito' : 'error'); }); }
      if (ev.target.closest('.js-agm-wa')) { window.open(enlaceWa(f.telefono, d.el.querySelector('.js-ag-texto').value), '_blank', 'noopener'); d.cerrar(); registrar(x, gf, { canal: 'WHATSAPP', destino: '+' + f.telefono, mensaje: d.el.querySelector('.js-ag-texto').value }); }
      if (ev.target.closest('.js-agm-reg')) {
        if (f.interno) { d.cerrar(); registrar(x, gf); return; }
        var canal = f.escalon.canal === 'INTERNO' ? 'WHATSAPP' : f.escalon.canal;
        d.cerrar(); registrar(x, gf, { canal: canal, mensaje: texto() });
      }
    });
  }
  function llamada(x, gf, boton) {
    var acc = boton.closest('.ag-fila__acc');
    acc.innerHTML = '<span class="ag-pregunta">' + U.ico('persona', 14) + '¿Cómo fue la llamada?</span>' +
      U.boton({ texto: 'Se comprometió', sm: true, clase: 'js-ag-llam', datos: { r: 'CONFIRMO' } }) +
      U.boton({ texto: 'Ya cumplió', sm: true, clase: 'js-ag-llam', datos: { r: 'CUMPLIO' } }) +
      U.boton({ texto: 'No contesta', sm: true, clase: 'js-ag-llam', datos: { r: 'NO_CONTESTA' } }) +
      U.boton({ soloIcono: true, icono: 'equis', titulo: 'Cancelar', variante: 'fantasma', sm: true, clase: 'js-ag-recargar-suave' });
  }
  function responder(x, gf, respuesta, nota) {
    return x.api('responderRecordatorio', { obligacion_id: gf.g.obligacion_id, periodo: gf.g.periodo, item_clave: gf.f.item_clave, cliente_id: gf.f.cliente_id, cliente_nombre: gf.f.cliente_nombre, respuesta: respuesta, nota: nota || '' })
      .then(function (r) { aviso(r && r.ok ? r.data.message : ((r && r.message) || 'No se pudo.'), r && r.ok ? 'exito' : 'error'); hoy(x, true); if (x.contadores) x.contadores(); });
  }
  function pedirNota(titulo, ayuda) {
    return new Promise(function (resolver) {
      U.formulario({ titulo: titulo, boton: 'Guardar', campos: U.campo('Nota (opcional)', '<textarea class="sx2-input" name="nota" rows="3" maxlength="500"></textarea>', ayuda),
        enviar: function (v) { resolver(v.nota || ''); return Promise.resolve({ ok: true }); } });
    });
  }

  // =========================================================================================
  // FECHAS PROPIAS (reunión, cierre) y VENCIMIENTOS MANUALES (examen, pacto de horas extra)
  // =========================================================================================
  function nuevaFecha(x, fecha, listo) {
    x.api('ajustesAgenda', { depto: x.opc.depto }).then(function (r) {
      var manuales = r && r.ok ? r.data.obligaciones.filter(function (o) { return o.fuente === 'manual' && o.activa; }) : [];
      var jef = r && r.ok && r.data.puede_editar;
      var clientes = (x.cfg.clientes || []);
      var ops = [['', 'Fecha del área (reunión, cierre, visita…)']].concat(manuales.map(function (o) { return [o.obligacion_id, o.nombre + ' (con recordatorios al cliente)']; }));
      U.formulario({ titulo: 'Agregar al calendario', boton: 'Agregar',
        campos: U.campo('Qué es', '<select class="sx2-select js-agf-tipo" name="obligacion_id">' + ops.map(function (o) { return '<option value="' + txt(o[0]) + '">' + txt(o[1]) + '</option>'; }).join('') + '</select>') +
          '<div class="js-agf-area">' + U.campo('Título', '<input class="sx2-input" name="titulo" maxlength="160" placeholder="Ej.: Reunión de cierre del mes">') +
            U.campo('Para', '<select class="sx2-select" name="alcance"><option value="AREA"' + (jef ? '' : ' disabled') + '>Toda el área' + (jef ? '' : ' (la agrega la jefatura)') + '</option><option value="PERSONAL"' + (jef ? '' : ' selected') + '>Solo yo</option></select>') + '</div>' +
          '<div class="js-agf-cli" hidden>' + U.campo('Cliente', '<input class="sx2-input" name="cliente" list="agf-cli" autocomplete="off"><datalist id="agf-cli">' + clientes.map(function (c) { return '<option value="' + txt(c.nombre) + '"></option>'; }).join('') + '</datalist>') +
            U.campo('Trabajador', '<input class="sx2-input" name="trabajador" maxlength="160">', 'Para el examen ocupacional: a quién le toca.') +
            U.campo('Lugar', '<input class="sx2-input" name="lugar" maxlength="160">') + '</div>' +
          '<div class="sx2-form__fila">' + U.campo('Fecha', '<input class="sx2-input" type="date" name="fecha" value="' + txt(fecha || hoyClave()) + '">') + U.campo('Hora', '<input class="sx2-input" type="time" name="hora">') + '</div>' +
          U.campo('Nota', '<textarea class="sx2-input" name="nota" rows="2" maxlength="500"></textarea>'),
        alMontar: function (form) {
          var sel = form.querySelector('.js-agf-tipo');
          sel.addEventListener('change', function () { var m = !!sel.value; form.querySelector('.js-agf-area').hidden = m; form.querySelector('.js-agf-cli').hidden = !m; });
        },
        preparar: function (v) {
          var p = { depto: x.opc.depto, obligacion_id: v.obligacion_id, fecha: v.fecha, hora: v.hora, nota: v.nota };
          if (v.obligacion_id) {
            var c = clientes.filter(function (k) { return k.nombre === v.cliente; })[0];
            if (!v.cliente) return 'Elige el cliente.';
            p.cliente_id = c ? c.cliente_id : ''; p.cliente_nombre = v.cliente; p.trabajador = v.trabajador; p.lugar = v.lugar;
          } else { p.titulo = v.titulo; p.alcance = v.alcance; }
          return p;
        },
        enviar: function (p) { return x.api('guardarEventoAgenda', p); },
        aviso: function (r2) { return r2.data.message; },
        listo: function () { if (listo) listo(); }
      });
    });
  }

  // =========================================================================================
  // CALENDARIO
  // =========================================================================================
  function calendario(x, todas) {
    var s = st(x);
    if (!s.mes) s.mes = periodoDe(hoyClave());
    x.pagina(x.cabecera(x.modNombre, todas ? 'Agenda general' : 'Calendario', 'Cargando…') + U.esqueleto('tabla', 8));
    var p = { mes: s.mes };
    if (!todas) p.depto = x.opc.depto;
    x.api('calendarioAgenda', p).then(function (r) {
      if (!r || !r.ok) { x.pagina(x.cabecera(x.modNombre, 'Calendario', '') + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || '' }) })); return; }
      s.cal = r.data; s.calTodas = !!todas;
      pintarCal(x);
    });
  }
  function pintarCal(x) {
    var s = st(x), c = s.cal, todas = s.calTodas;
    var a = Number(c.mes.slice(0, 4)), m = Number(c.mes.slice(6)) - 1;
    var primero = new Date(a, m, 1), dias = new Date(a, m + 1, 0).getDate();
    var desfase = (primero.getDay() + 6) % 7;
    var areas = {};
    c.eventos.forEach(function (e) { if (e.depto_nombre && e.tipo !== 'FERIADO') areas[e.depto] = e.depto_nombre; });
    var eventos = c.eventos.filter(function (e) { return !s.calArea || e.tipo === 'FERIADO' || e.depto === s.calArea; });
    var porDia = {};
    eventos.forEach(function (e) { (porDia[e.fecha] = porDia[e.fecha] || []).push(e); });
    var celdas = '';
    for (var i = 0; i < desfase; i++) celdas += '<div class="ag-cal__dia ag-cal__dia--fuera"></div>';
    for (var d = 1; d <= dias; d++) {
      var f = a + '-' + ('0' + (m + 1)).slice(-2) + '-' + ('0' + d).slice(-2);
      var evs = (porDia[f] || []).slice().sort(ordenEv);
      var fer = evs.some(function (e) { return e.tipo === 'FERIADO'; });
      var finde = ((desfase + d - 1) % 7) >= 5;
      var visibles = evs.filter(function (e) { return e.tipo !== 'FERIADO'; });
      celdas += '<button type="button" class="ag-cal__dia' + (f === c.hoy ? ' ag-cal__dia--hoy' : '') + (fer || finde ? ' ag-cal__dia--inhabil' : '') + (f < c.hoy ? ' ag-cal__dia--pasado' : '') + '" data-f="' + f + '">' +
        '<span class="ag-cal__n">' + d + (fer ? '<small>Feriado</small>' : '') + '</span>' +
        visibles.slice(0, 3).map(function (e) { var t = TIPO_EV[e.tipo] || TIPO_EV.EVENTO; return '<span class="ag-cal__ev ag-ev--' + t.clase + '" title="' + txt(e.titulo) + '">' + (todas && e.depto_nombre ? '<b>' + txt(CORTO[e.depto] || e.depto_nombre) + '</b> ' : '') + txt(e.titulo) + (e.pendientes ? ' (' + e.pendientes + ')' : '') + '</span>'; }).join('') +
        (visibles.length > 3 ? '<span class="ag-cal__mas">+' + (visibles.length - 3) + ' más</span>' : '') + '</button>';
    }
    for (var j = (desfase + dias) % 7; j && j < 7; j++) celdas += '<div class="ag-cal__dia ag-cal__dia--fuera"></div>';
    var leyenda = Object.keys(TIPO_EV).map(function (k) { return '<span class="ag-ley"><i class="ag-ev--' + TIPO_EV[k].clase + '"></i>' + txt(TIPO_EV[k].txt) + '</span>'; }).join('');
    var nav = '<span class="ci2-periodo" role="group" aria-label="Mes">' + U.boton({ soloIcono: true, icono: 'izquierda', variante: 'fantasma', sm: true, titulo: 'Mes anterior', clase: 'js-ag-mes', datos: { n: -1 } }) +
      '<strong>' + txt(MESES[m].charAt(0).toUpperCase() + MESES[m].slice(1) + ' ' + a) + '</strong>' + U.boton({ soloIcono: true, icono: 'derecha', variante: 'fantasma', sm: true, titulo: 'Mes siguiente', clase: 'js-ag-mes', datos: { n: 1 } }) + '</span>';
    var filtroAreas = todas && Object.keys(areas).length > 1 ? '<div class="ag-chips">' + U.chip({ texto: 'Todas las áreas', activo: !s.calArea, clase: 'js-ag-area', datos: { a: '' } }) +
      Object.keys(areas).map(function (k) { return U.chip({ texto: areas[k], activo: s.calArea === k, clase: 'js-ag-area', datos: { a: k } }); }).join('') + '</div>' : '';
    x.pagina(x.cabecera(x.modNombre, todas ? 'Agenda general' : 'Calendario', todas ? 'Las fechas clave de todas las áreas.' : 'Vencimientos, recordatorios y fechas del área. Toca un día para ver el detalle.',
      nav + (!todas ? U.boton({ texto: 'Agregar fecha', icono: 'nueva', clase: 'js-ag-evento' }) : '')) +
      filtroAreas + '<div class="ag-leyenda">' + leyenda + '</div>' +
      '<div class="sx2-card ag-cal sx2-entra"><div class="ag-cal__cab">' + DIAS_CORTOS.map(function (n) { return '<span>' + n + '</span>'; }).join('') + '</div><div class="ag-cal__grilla">' + celdas + '</div></div>');
  }
  function ordenEv(a, b) { var o = { LIMITE: 0, ESCALAMIENTO: 1, RECORDATORIO: 2, CLIENTE: 3, EVENTO: 4, INTERNO: 5, FERIADO: 6 }; return (o[a.tipo] - o[b.tipo]) || String(a.hora || '').localeCompare(String(b.hora || '')); }
  function verDia(x, f) {
    var s = st(x), evs = s.cal.eventos.filter(function (e) { return e.fecha === f && (!s.calArea || e.tipo === 'FERIADO' || e.depto === s.calArea); }).sort(ordenEv);
    var cuerpo = evs.length ? '<ul class="ag-dia">' + evs.map(function (e) {
      var t = TIPO_EV[e.tipo] || TIPO_EV.EVENTO;
      return '<li class="ag-dia__it ag-ev-borde--' + t.clase + '"><div><span class="ag-dia__tipo">' + txt(t.txt) + (e.depto_nombre && s.calTodas ? ' · ' + txt(e.depto_nombre) : '') + (e.hora ? ' · ' + txt(e.hora) : '') + '</span>' +
        '<strong>' + txt(e.titulo) + '</strong>' +
        (e.periodo_texto ? '<small>' + txt(e.periodo_texto) + (e.total ? ' · ' + (e.pendientes ? plural(e.pendientes, 'pendiente', 'pendientes') + ' de ' + e.total : 'todo cumplido') : '') + '</small>' : '') +
        (e.cliente_nombre ? '<small>' + txt(e.cliente_nombre) + '</small>' : '') + (e.nota ? '<small>' + txt(e.nota) + '</small>' : '') + '</div>' +
        (e.evento_id ? U.boton({ soloIcono: true, icono: 'basura', titulo: 'Quitar', variante: 'fantasma', sm: true, clase: 'js-agd-quitar', datos: { id: e.evento_id } }) : '') + '</li>';
    }).join('') + '</ul>' : U.vacio({ icono: 'calendario', titulo: 'Sin fechas', texto: 'Nada programado este día.' });
    var d = U.drawer({ titulo: fechaLarga(f), cuerpo: cuerpo, pie: '<span style="flex:1"></span>' + (s.calTodas ? '' : U.boton({ texto: 'Agregar fecha este día', icono: 'nueva', variante: 'primario', clase: 'js-agd-nueva' })) });
    d.el.addEventListener('click', function (ev) {
      var b;
      if (ev.target.closest('.js-agd-nueva')) { d.cerrar(); nuevaFecha(x, f, function () { calendario(x, false); }); }
      if ((b = ev.target.closest('.js-agd-quitar'))) {
        U.confirmar({ titulo: '¿Quitar esta fecha?', texto: 'Deja de verse en el calendario y, si tenía recordatorios al cliente, ya no aparecen en Hoy.', boton: 'Quitar', peligro: true }).then(function (ok) {
          if (!ok) return;
          x.api('eliminarEventoAgenda', { evento_id: b.getAttribute('data-id') }).then(function (r) { aviso(r && r.ok ? r.data.message : ((r && r.message) || 'No se pudo.'), r && r.ok ? 'exito' : 'error'); d.cerrar(); calendario(x, s.calTodas); });
        });
      }
    });
  }

  // =========================================================================================
  // REGISTRO de recordatorios enviados y respuestas
  // =========================================================================================
  function registro(x) {
    var s = st(x), f = s.reg;
    if (!f.mes) f.mes = periodoDe(hoyClave());
    x.pagina(x.cabecera(x.modNombre, 'Recordatorios enviados', 'Cargando…') + U.esqueleto('tabla', 8));
    x.api('registroAgenda', { depto: x.opc.depto, mes: f.mes, obligacion_id: f.obligacion_id, q: f.q }).then(function (r) {
      if (!r || !r.ok) { x.pagina(x.cabecera(x.modNombre, 'Recordatorios enviados', '') + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || '' }) })); return; }
      s.regData = r.data;
      x.resolverPersonas(r.data.filas).then(function () { pintarRegistro(x); });
    });
  }
  function pintarRegistro(x) {
    var s = st(x), d = s.regData, f = s.reg, R = d.resumen;
    var meses = [];
    for (var i = 0; i < 12; i++) { var p = x.mover(periodoDe(hoyClave()), -i); meses.push([p, x.perTexto(p, true)]); }
    var filtros = '<div class="ag-filtros">' +
      '<select class="sx2-select js-agr-f" data-f="mes" aria-label="Mes">' + meses.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === f.mes ? ' selected' : '') + '>' + txt(o[1]) + '</option>'; }).join('') + '</select>' +
      '<select class="sx2-select js-agr-f" data-f="obligacion_id" aria-label="Obligación"><option value="">Todas las obligaciones</option>' + d.obligaciones.map(function (o) { return '<option value="' + txt(o.obligacion_id) + '"' + (o.obligacion_id === f.obligacion_id ? ' selected' : '') + '>' + txt(o.nombre) + '</option>'; }).join('') + '</select>' +
      '<input class="sx2-input js-agr-q" type="search" placeholder="Buscar cliente" value="' + txt(f.q) + '"></div>';
    var yo = x.cfg && x.cfg.yo;
    var tabla = d.filas.length ? '<div class="sx2-tabla-wrap"><table class="sx2-tabla ag-tabla"><thead><tr><th>Fecha</th><th>Cliente</th><th>Obligación</th><th>Qué</th><th>Canal / respuesta</th><th>Quién</th><th></th></tr></thead><tbody>' +
      d.filas.map(function (r) {
        return '<tr><td class="sx2-num">' + txt(fechaCorta(r.fecha)) + ' <span class="sx2-tenue">' + txt(hora(r.fecha)) + '</span></td><td>' + (r.cliente_nombre ? '<button type="button" class="sx2-enlace js-agr-cli" data-id="' + txt(r.cliente_id) + '" data-n="' + txt(r.cliente_nombre) + '">' + txt(r.cliente_nombre) + '</button>' : '—') + '</td>' +
          '<td>' + txt(r.obligacion) + ' <span class="sx2-tenue">' + txt(r.periodo_texto) + '</span></td>' +
          '<td>' + (r.tipo === 'RESPUESTA' ? U.badge('Respuesta', 'ok') : txt(r.escalon)) + '</td>' +
          '<td>' + (r.tipo === 'RESPUESTA' ? '<b>' + txt(r.respuesta_texto) + '</b>' + (r.nota ? ' · ' + txt(r.nota) : '') : txt((CANAL[r.canal] || {}).txt || r.canal) + (r.destino ? ' <span class="sx2-tenue">' + txt(r.destino) + '</span>' : '')) +
            (r.mensaje ? '<details class="ag-det"><summary>Mensaje</summary><p>' + txt(r.mensaje) + '</p></details>' : '') + '</td>' +
          '<td>' + txt(x.nombre(r.usuario_email)) + '</td>' +
          '<td>' + (r.usuario_email === yo ? U.boton({ soloIcono: true, icono: 'basura', titulo: 'Deshacer', variante: 'fantasma', sm: true, clase: 'js-agr-deshacer', datos: { id: r.recordatorio_id } }) : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : U.vacio({ icono: 'bandeja', titulo: 'Sin registros', texto: 'No hay recordatorios registrados con estos filtros.' });
    x.pagina(x.cabecera(x.modNombre, 'Recordatorios enviados', 'Todo lo que se recordó a los clientes, por qué medio, quién y qué respondieron.', U.boton({ texto: 'Excel', icono: 'descargar', clase: 'js-agr-excel', deshabilitado: !d.filas.length })) +
      '<div class="sx2-fila-kpis">' + U.kpi({ etiqueta: 'Recordatorios', valor: R.envios, icono: 'campana', i: 1 }) + U.kpi({ etiqueta: 'WhatsApp', valor: R.whatsapp, icono: 'comentario', i: 2 }) +
        U.kpi({ etiqueta: 'Correo', valor: R.correo, icono: 'correo', i: 3 }) + U.kpi({ etiqueta: 'Llamadas', valor: R.llamada, icono: 'persona', i: 4 }) + U.kpi({ etiqueta: 'Respuestas', valor: R.respuestas, icono: 'check', tono: 'ok', i: 5 }) + '</div>' +
      U.card({ i: 2, cuerpo: filtros + tabla }));
  }
  function excelRegistro(x) {
    var s = st(x), d = s.regData;
    if (!window.SigsoReportes || !d) return;
    var filas = d.filas.map(function (r) {
      var f = new Date(r.fecha);
      return [isNaN(f) ? String(r.fecha).slice(0, 10) : f.getFullYear() + '-' + ('0' + (f.getMonth() + 1)).slice(-2) + '-' + ('0' + f.getDate()).slice(-2), hora(r.fecha), r.cliente_nombre, r.obligacion, r.periodo_texto, r.tipo === 'RESPUESTA' ? 'Respuesta' : r.escalon,
        r.tipo === 'RESPUESTA' ? r.respuesta_texto : ((CANAL[r.canal] || {}).txt || r.canal), r.destino, r.nota, x.nombre(r.usuario_email), r.mensaje];
    });
    SigsoReportes.descargarExcelDeDatos({ titulo: 'Recordatorios · ' + x.modNombre + ' · ' + x.perTexto(s.reg.mes, true), subtitulo: x.modNombre,
      meta: [['Mes', x.perTexto(s.reg.mes, true)], ['Registros', String(filas.length)]],
      hojas: [{ nombre: 'Recordatorios', columnas: ['Fecha', 'Hora', 'Cliente', 'Obligación', 'Período', 'Qué', 'Canal / respuesta', 'Destino', 'Nota', 'Quién', 'Mensaje'], filas: filas }],
      nombreArchivo: 'Recordatorios ' + x.modNombre + ' ' + s.reg.mes }, { boton: x.raiz().querySelector('.js-agr-excel') });
  }

  // =========================================================================================
  // POR CLIENTE
  // =========================================================================================
  function cliente(x, elegido) {
    var s = st(x);
    if (elegido) s.cli = elegido;
    var clientes = x.cfg.clientes || [];
    var buscador = '<div class="ag-filtros"><input class="sx2-input js-agc-q" list="agc-lista" placeholder="Escribe el nombre del cliente" value="' + txt(s.cli ? s.cli.nombre : '') + '" autocomplete="off">' +
      '<datalist id="agc-lista">' + clientes.map(function (c) { return '<option value="' + txt(c.nombre) + '"></option>'; }).join('') + '</datalist>' + U.boton({ texto: 'Ver', icono: 'lupa', clase: 'js-agc-ver' }) + '</div>';
    var cab = x.cabecera(x.modNombre, 'Por cliente', 'Todo lo que se le ha recordado a un cliente y lo que tiene pendiente.');
    if (!s.cli) { x.pagina(cab + U.card({ i: 1, cuerpo: buscador + U.vacio({ icono: 'empresa', titulo: 'Elige un cliente', texto: 'Verás su contacto, lo pendiente y el historial de recordatorios y respuestas.' }) })); return; }
    x.pagina(cab + U.card({ i: 1, cuerpo: buscador + U.esqueleto('tabla', 5) }));
    x.api('porClienteAgenda', { depto: x.opc.depto, cliente_id: s.cli.cliente_id || '', cliente_nombre: s.cli.nombre }).then(function (r) {
      if (!r || !r.ok) { aviso((r && r.message) || 'No se pudo cargar.', 'error'); return; }
      var d = r.data;
      x.resolverPersonas(d.historial).then(function () {
        var c = d.cliente;
        var ficha = '<dl class="ag-ficha"><div><dt>Contacto</dt><dd>' + txt(c.contacto || '—') + '</dd></div><div><dt>Teléfono</dt><dd>' + txt(c.telefono || '—') + '</dd></div><div><dt>Correo</dt><dd>' + txt(c.correo || '—') + '</dd></div></dl>';
        var pend = d.pendientes.length ? '<ul class="ag-pend">' + d.pendientes.map(function (p) { var e = ESTADO[p.estado] || ESTADO.HOY; return '<li>' + U.badge(e.txt, e.tono) + '<span><b>' + txt(p.obligacion) + '</b> · ' + txt(p.periodo_texto) + ' · ' + txt(p.escalon) + ' · vence ' + txt(fechaCorta(p.fecha_limite)) + '</span></li>'; }).join('') + '</ul>' : '<p class="sx2-tenue">Nada pendiente hoy.</p>';
        var hist = d.historial.length ? '<ol class="ag-linea">' + d.historial.map(function (h) {
          return '<li class="ag-linea__it' + (h.tipo === 'RESPUESTA' ? ' ag-linea__it--resp' : '') + '"><span class="ag-linea__f">' + txt(fechaCorta(h.fecha)) + '<small>' + txt(hora(h.fecha)) + '</small></span><span class="ag-linea__t"><strong>' +
            (h.tipo === 'RESPUESTA' ? 'Respondió: ' + txt(h.respuesta_texto) : txt(h.escalon) + ' · ' + txt((CANAL[h.canal] || {}).txt || h.canal)) + '</strong><small>' + txt(h.obligacion) + ' · ' + txt(h.periodo_texto) + ' · ' + txt(x.nombre(h.usuario_email)) + '</small>' +
            (h.nota ? '<small>' + txt(h.nota) + '</small>' : '') + (h.mensaje ? '<details class="ag-det"><summary>Mensaje</summary><p>' + txt(h.mensaje) + '</p></details>' : '') + '</span></li>';
        }).join('') + '</ol>' : U.vacio({ icono: 'bandeja', titulo: 'Sin recordatorios registrados', texto: 'Cuando se le envíe uno, aparecerá aquí.' });
        x.pagina(cab + U.card({ i: 1, cuerpo: buscador }) + '<div class="ag-cli">' + U.card({ i: 2, titulo: c.nombre, icono: 'empresa', cuerpo: ficha + '<h3 class="ag-h3">Pendiente</h3>' + pend }) +
          U.card({ i: 3, titulo: 'Historial', icono: 'reloj', sub: plural(d.resumen.envios || 0, 'recordatorio', 'recordatorios') + ' · ' + plural(d.resumen.respuestas || 0, 'respuesta', 'respuestas'), cuerpo: hist }) + '</div>', true);
      });
    });
  }

  // =========================================================================================
  // AJUSTES: fechas, escalones y mensajes (jefatura o superusuario)
  // =========================================================================================
  var VARIABLES = '{contacto} {empresa} {periodo} {monto} {fecha_limite} {dias} {n_cuota} {n_factura} {trabajador} {hora} {lugar} {pendientes} {firma}';
  function reglaTexto(r) {
    if (!r || r.tipo === 'evento') return 'Según la fecha de cada caso (cuota, factura, examen o pacto).';
    var dia = r.dia === 'ultimo' ? 'el último día' + (r.habil !== false ? ' hábil' : '') : 'el día ' + r.dia + (r.habil !== false ? ' (o el hábil siguiente)' : '');
    if (r.tipo === 'anual') return 'Cada año, ' + dia + ' de ' + MESES[(r.mes || 1) - 1] + '.';
    return 'Cada mes, ' + dia + (r.mes ? (r.mes === 1 ? ' del mes siguiente' : ' de ' + r.mes + ' meses después') : ' del mismo mes') + '.';
  }
  function offsetTexto(n) { n = Number(n) || 0; return n === 0 ? 'el día del vencimiento' : (n < 0 ? plural(-n, 'día hábil antes', 'días hábiles antes') : plural(n, 'día hábil después', 'días hábiles después')); }
  var ORIGEN = { PROPUESTA: ['Propuesta inicial', 'neutro'], EDITADA: ['Editada', 'info'], PROPIA: ['Creada por el área', 'ok'] };
  function ajustes(x) {
    x.pagina(x.cabecera(x.modNombre, 'Recordatorios y fechas', 'Cargando…') + U.esqueleto('tarjetas', 4));
    x.api('ajustesAgenda', { depto: x.opc.depto }).then(function (r) {
      if (!r || !r.ok) { x.pagina(x.cabecera(x.modNombre, 'Recordatorios y fechas', '') + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || '' }) })); return; }
      st(x).aj = r.data;
      x.resolverPersonas(r.data.obligaciones.map(function (o) { return { email: o.actualizado_por }; })).then(function () { pintarAjustes(x); });
    });
  }
  function pintarAjustes(x) {
    var d = st(x).aj;
    var html = x.cabecera(x.modNombre, 'Recordatorios y fechas', 'Qué vence, cuándo, la escalera de recordatorios y sus mensajes. ' + (d.puede_editar ? 'Los cambios valen desde ahora y quedan en el historial.' : 'Solo la jefatura del área o el superusuario los editan.'),
      d.puede_editar ? U.boton({ texto: 'Nueva obligación', icono: 'nueva', variante: 'primario', clase: 'js-aga-nueva' }) : '') +
      '<div class="ag-obls">' + d.obligaciones.map(function (o, k) {
        var org = ORIGEN[o.origen] || ORIGEN.PROPUESTA;
        return '<section class="sx2-card ag-obl' + (o.activa ? '' : ' ag-obl--inactiva') + ' sx2-entra" style="--i:' + (k + 1) + '">' +
          '<div class="ag-obl__cab"><div><h2>' + txt(o.nombre) + '</h2><div class="ag-obl__chips">' + U.badge(o.tipo === 'CLIENTE' ? 'Recordatorio al cliente' : 'Tarea interna', o.tipo === 'CLIENTE' ? 'alerta' : 'info') +
            U.badge(org[0], org[1], true) + (o.activa ? '' : U.badge('Desactivada', 'neutro', true)) + (o.proceso ? '<span class="sx2-tenue">' + txt(o.proceso) + '</span>' : '') + '</div></div>' +
            (d.puede_editar ? '<div class="ag-obl__acc">' + U.boton({ texto: 'Editar', icono: 'editar', sm: true, clase: 'js-aga-editar', datos: { id: o.obligacion_id } }) +
              (o.origen === 'EDITADA' && o.propuesta ? U.boton({ texto: 'Restaurar', icono: 'tendencia', sm: true, variante: 'fantasma', clase: 'js-aga-restaurar', datos: { id: o.obligacion_id } }) : '') +
              U.boton({ soloIcono: true, icono: 'reloj', titulo: 'Historial de cambios', sm: true, variante: 'fantasma', clase: 'js-aga-hist', datos: { id: o.obligacion_id } }) + '</div>' : '') + '</div>' +
          (o.descripcion ? '<p class="ag-obl__desc">' + txt(o.descripcion) + '</p>' : '') +
          '<p class="ag-obl__regla">' + U.ico('calendario', 14) + '<span>' + txt(reglaTexto(o.regla)) + (o.ejemplo ? ' <span class="sx2-tenue">' + (o.ejemplo.anual ? 'Este año' : 'Este mes') + ': ' + txt(fechaLarga(o.ejemplo.fecha_limite)) + (o.ejemplo.anual ? '' : ' (' + txt(o.ejemplo.periodo_texto) + ')') + '.</span>' : '') + '</span></p>' +
          '<ol class="ag-esc">' + o.escalones.map(function (e) {
            var c = CANAL[e.canal] || CANAL.WHATSAPP;
            return '<li><span class="ag-esc__cuando">' + txt(offsetTexto(e.offset)) + '</span><span class="ag-esc__que"><b>' + txt(e.nombre) + '</b> · ' + U.ico(c.ico, 12) + txt(c.txt) + (e.a_quien === 'JEFATURA' ? ' · a la jefatura' : '') + '</span>' +
              '<details class="ag-det"><summary>Mensaje</summary>' + (e.asunto ? '<p><b>Asunto:</b> ' + txt(e.asunto) + '</p>' : '') + '<p>' + txt(e.texto) + '</p></details></li>';
          }).join('') + '</ol>' +
          (o.sin_recordatorio || o.sin_respuesta ? '<div class="ag-obl__conse">' + (o.sin_recordatorio ? '<p><b>Si no se recuerda:</b> ' + txt(o.sin_recordatorio) + '</p>' : '') + (o.sin_respuesta ? '<p><b>Si el cliente no responde:</b> ' + txt(o.sin_respuesta) + '</p>' : '') + '</div>' : '') +
          (o.actualizado_por ? '<p class="sx2-tenue ag-obl__pie">Último cambio: ' + txt(x.nombre(o.actualizado_por)) + ' · ' + txt(fechaCorta(o.fecha_actualizacion)) + '</p>' : '') +
        '</section>';
      }).join('') + '</div>';
    x.pagina(html);
  }
  function editarObligacion(x, id) {
    var d = st(x).aj, o = id ? d.obligaciones.filter(function (z) { return z.obligacion_id === id; })[0] : null;
    var nueva = !o;
    o = o || { nombre: '', descripcion: '', tipo: 'INTERNO', fuente: 'interno', regla: { tipo: 'mensual', mes: 0, dia: 'ultimo', habil: true }, escalones: [], sin_recordatorio: '', sin_respuesta: '', activa: true };
    var evento = o.regla && o.regla.tipo === 'evento';
    var escs = o.escalones.concat([{ id: '', nombre: '', offset: 0, canal: o.tipo === 'INTERNO' ? 'INTERNO' : 'WHATSAPP', a_quien: o.tipo === 'INTERNO' ? 'RESPONSABLE' : 'CLIENTE', asunto: '', texto: '' }]);
    function sel(nom, ops, v) { return '<select class="sx2-select" name="' + nom + '">' + ops.map(function (op) { return '<option value="' + txt(op[0]) + '"' + (String(op[0]) === String(v) ? ' selected' : '') + '>' + txt(op[1]) + '</option>'; }).join('') + '</select>'; }
    var r = o.regla || {};
    var campos = (nueva ? U.campo('Tipo', sel('fuente', [['interno', 'Tarea interna del área (fecha fija)'], ['manual', 'Recordatorio al cliente con fecha que se agrega a mano']], 'interno')) : '') +
      U.campo('Nombre', '<input class="sx2-input" name="nombre" maxlength="120" value="' + txt(o.nombre) + '">') +
      U.campo('Descripción', '<textarea class="sx2-input" name="descripcion" rows="2" maxlength="600">' + txt(o.descripcion) + '</textarea>') +
      '<fieldset class="ag-fs js-aga-regla"' + (evento ? ' hidden' : '') + '><legend>Cuándo vence</legend><div class="sx2-form__fila">' +
        U.campo('Frecuencia', sel('r_tipo', [['mensual', 'Cada mes'], ['anual', 'Cada año']], r.tipo === 'anual' ? 'anual' : 'mensual')) +
        U.campo('Mes', sel('r_mes', r.tipo === 'anual' ? MESES.map(function (m, i) { return [i + 1, m]; }) : [[0, 'El mismo mes'], [1, 'El mes siguiente'], [2, 'Dos meses después']], r.mes || (r.tipo === 'anual' ? 1 : 0))) +
        U.campo('Día', '<input class="sx2-input" name="r_dia" value="' + txt(r.dia === 'ultimo' ? 'último' : (r.dia || 1)) + '" placeholder="20 o último">') +
        U.campo('Si cae en día no hábil', sel('r_habil', [['1', 'Se corre al hábil'], ['0', 'Queda en esa fecha']], r.habil === false ? '0' : '1')) + '</div></fieldset>' +
      (evento ? '<p class="sx2-tenue">La fecha límite sale de cada caso (cuota, factura, examen o pacto).</p>' : '') +
      '<fieldset class="ag-fs"><legend>Escalera de recordatorios</legend><p class="sx2-tenue" style="margin:0 0 6px">Días en días hábiles respecto al vencimiento: −5 = cinco días hábiles antes, 0 = el mismo día, 1 = el día siguiente. Variables para el mensaje: <code>' + txt(VARIABLES) + '</code>. Deja el mensaje vacío para quitar un paso.</p>' +
        escs.map(function (e, k) {
          return '<div class="ag-esc-ed"><div class="ag-esc-ed__fila">' + U.campo('Paso', '<input class="sx2-input" name="e_nombre_' + k + '" maxlength="80" value="' + txt(e.nombre) + '" placeholder="Ej.: Quedan 2 días">') +
            U.campo('Día', '<input class="sx2-input" type="number" min="-60" max="60" name="e_offset_' + k + '" value="' + txt(e.offset) + '">') +
            U.campo('Canal', sel('e_canal_' + k, [['WHATSAPP', 'WhatsApp'], ['CORREO', 'Correo'], ['LLAMADA', 'Llamada'], ['INTERNO', 'Tarea interna']], e.canal)) +
            U.campo('A quién', sel('e_a_quien_' + k, [['CLIENTE', 'Cliente'], ['RESPONSABLE', 'Responsable'], ['JEFATURA', 'Jefatura']], e.a_quien)) + '</div>' +
            '<input type="hidden" name="e_id_' + k + '" value="' + txt(e.id) + '">' +
            U.campo('Asunto (correo)', '<input class="sx2-input" name="e_asunto_' + k + '" maxlength="200" value="' + txt(e.asunto) + '">') +
            U.campo('Mensaje', '<textarea class="sx2-input" name="e_texto_' + k + '" rows="4" maxlength="2000">' + txt(e.texto) + '</textarea>') + '</div>';
        }).join('') + '</fieldset>' +
      U.campo('Si no se recuerda', '<textarea class="sx2-input" name="sin_recordatorio" rows="2" maxlength="600">' + txt(o.sin_recordatorio) + '</textarea>', 'La consecuencia que se muestra cuando un recordatorio queda atrasado.') +
      U.campo('Si el cliente no responde', '<textarea class="sx2-input" name="sin_respuesta" rows="2" maxlength="600">' + txt(o.sin_respuesta) + '</textarea>') +
      '<label class="ag-check"><input type="checkbox" name="activa" value="1"' + (o.activa ? ' checked' : '') + '> Activa (aparece en Hoy y en el calendario)</label>';
    U.formulario({ titulo: nueva ? 'Nueva obligación' : 'Editar · ' + o.nombre, boton: 'Guardar', ancho: true, campos: campos,
      preparar: function (v) {
        var esc = escs.map(function (e, k) { return { id: v['e_id_' + k], nombre: v['e_nombre_' + k], offset: Number(v['e_offset_' + k]) || 0, canal: v['e_canal_' + k], a_quien: v['e_a_quien_' + k], asunto: v['e_asunto_' + k], texto: v['e_texto_' + k] }; })
          .filter(function (e) { return e.texto; });
        if (!esc.length) return 'Agrega al menos un recordatorio con su mensaje.';
        var dia = /^[uú]ltimo$/i.test(v.r_dia) ? 'ultimo' : Number(v.r_dia);
        return { obligacion_id: nueva ? '' : o.obligacion_id, depto: x.opc.depto, fuente: v.fuente, nombre: v.nombre, descripcion: v.descripcion,
          regla: { tipo: v.r_tipo, mes: Number(v.r_mes) || 0, dia: dia, habil: v.r_habil !== '0' }, escalones: esc,
          sin_recordatorio: v.sin_recordatorio, sin_respuesta: v.sin_respuesta, activa: v.activa === '1' };
      },
      alMontar: function (form) {
        // Al cambiar de mensual a anual, el selector de mes cambia de significado.
        var t = form.querySelector('[name=r_tipo]'), m = form.querySelector('[name=r_mes]'), f = form.querySelector('[name=fuente]');
        if (t) t.addEventListener('change', function () {
          var ops = t.value === 'anual' ? MESES.map(function (n, i) { return [i + 1, n]; }) : [[0, 'El mismo mes'], [1, 'El mes siguiente'], [2, 'Dos meses después']];
          m.innerHTML = ops.map(function (op) { return '<option value="' + op[0] + '">' + txt(op[1]) + '</option>'; }).join('');
        });
        if (f) f.addEventListener('change', function () { form.querySelector('.js-aga-regla').hidden = f.value === 'manual'; });
      },
      enviar: function (p) { return x.api('guardarObligacionAgenda', p); },
      aviso: function (r2) { return r2.data.message; },
      listo: function () { ajustes(x); if (x.contadores) x.contadores(); } });
  }
  function historialObl(x, id) {
    x.api('historialObligacionAgenda', { obligacion_id: id }).then(function (r) {
      if (!r || !r.ok) { aviso((r && r.message) || 'No se pudo.', 'error'); return; }
      var l = r.data.historial;
      x.resolverPersonas(l).then(function () {
        U.drawer({ titulo: 'Historial de cambios', cuerpo: l.length ? '<ol class="dr-hist">' + l.map(function (h) { return '<li><span class="dr-hist__punto"></span><span><b>' + txt(x.nombre(h.usuario_email)) + '</b> · ' + txt(fechaCorta(h.fecha)) + ' ' + txt(hora(h.fecha)) + '<br>' + txt(h.detalle) + '</span></li>'; }).join('') + '</ol>' : U.vacio({ icono: 'reloj', titulo: 'Sin cambios', texto: 'Sigue como la propuesta inicial.' }) });
      });
    });
  }

  // =========================================================================================
  // AVISO DEL DÍA (una vez al día, al entrar)
  // =========================================================================================
  function avisoDelDia(detalle) {
    var hoyK = hoyClave(), clave = 'sigso-agenda-aviso-' + hoyK;
    try { if (localStorage.getItem(clave)) return; } catch (e) { /* sin almacenamiento: se muestra */ }
    var areas = Object.keys(detalle || {}).map(function (k) { return Object.assign({ modulo: k }, detalle[k]); }).filter(function (a) { return a.por_enviar + a.atrasados > 0 || (a.proximo && a.proximo.dias_habiles <= 3 && a.proximo.pendientes); });
    if (!areas.length) return;
    try { localStorage.setItem(clave, '1'); } catch (e) { /* sin almacenamiento */ }
    var hayAtraso = areas.some(function (a) { return a.atrasados; });
    var el = document.createElement('div');
    el.className = 'sx2 ag-aviso' + (hayAtraso ? ' ag-aviso--critico' : '');
    el.setAttribute('role', 'status');
    el.innerHTML = '<div class="ag-aviso__cab">' + U.ico('campana', 18) + '<strong>Tu agenda de hoy</strong>' + U.boton({ soloIcono: true, icono: 'equis', titulo: 'Cerrar', variante: 'fantasma', sm: true, clase: 'js-ag-aviso-x' }) + '</div>' +
      '<ul>' + areas.map(function (a) {
        var n = a.por_enviar + a.atrasados;
        return '<li><button type="button" class="ag-aviso__area" data-mod="' + txt(a.modulo) + '"><span class="ag-aviso__t"><span><b>' + txt(a.nombre) + '</b>: ' + (n ? plural(n, 'recordatorio', 'recordatorios') : 'sin recordatorios hoy') +
          (a.atrasados ? ' <em>(' + plural(a.atrasados, 'atrasado', 'atrasados') + ')</em>' : '') + '</span>' +
          (a.proximo ? '<small>' + txt(a.proximo.titulo) + ' vence ' + txt(habiles(a.proximo.dias_habiles)) + (a.proximo.pendientes ? ' · ' + plural(a.proximo.pendientes, 'pendiente', 'pendientes') : '') + '</small>' : '') + '</span>' + U.ico('derecha', 14) + '</button></li>';
      }).join('') + '</ul>';
    document.body.appendChild(el);
    el.addEventListener('click', function (ev) {
      var b;
      if (ev.target.closest('.js-ag-aviso-x')) { el.remove(); return; }
      if ((b = ev.target.closest('.ag-aviso__area'))) { el.remove(); location.hash = '#/' + b.getAttribute('data-mod') + '/hoy'; }
    });
  }

  // =========================================================================================
  // Eventos (delegados en la raíz del módulo)
  // =========================================================================================
  function enlazar(x) {
    var c = x.raiz();
    if (!c || c.__agenda) return;
    c.__agenda = true;
    c.addEventListener('click', function (ev) {
      var t = ev.target, b, gf;
      if (!c.querySelector('.ag-hoy, .ag-cal, .ag-obls, .ag-tabla, .ag-filtros, .ag-kpis')) return;
      if (t.closest('.js-ag-recargar')) { hoy(x); return; }
      if (t.closest('.js-ag-recargar-suave')) { pintarHoy(x, true); return; }
      if ((b = t.closest('.js-ag-ir'))) { x.irAItem(b.getAttribute('data-ir')); return; }
      if (t.closest('.js-ag-evento')) { nuevaFecha(x, '', function () { if (st(x).cal && c.querySelector('.ag-cal')) calendario(x, false); else hoy(x, true); }); return; }
      if ((b = t.closest('.sx2-kpi--clic')) && c.querySelector('.ag-hoy')) { var fl = b.getAttribute('data-filtro'); st(x).filtro = st(x).filtro === fl ? '' : fl; pintarHoy(x, true); return; }
      if ((b = t.closest('.js-ag-wa')) && (gf = filaDe(x, b))) { setTimeout(function () { registrar(x, gf, { canal: 'WHATSAPP' }); }, 300); return; }
      if ((b = t.closest('.js-ag-copiar')) && (gf = filaDe(x, b))) {
        var m = conFirma(x, gf.f.mensaje.texto), asunto = gf.f.escalon.canal === 'CORREO' && gf.f.mensaje.asunto ? 'Asunto: ' + conFirma(x, gf.f.mensaje.asunto) + '\n\n' : '';
        copiar(asunto + m).then(function (ok) { aviso(ok ? 'Copiado. Envíalo desde el ' + (gf.f.escalon.canal === 'CORREO' ? 'correo' : 'WhatsApp') + ' del área y confirma aquí.' : 'No se pudo copiar: abre «Ver mensaje» y cópialo a mano.', ok ? 'exito' : 'error'); });
        confirmarCorreo(x, gf, b); return;
      }
      if ((b = t.closest('.js-ag-envie')) && (gf = filaDe(x, b))) { registrar(x, gf); return; }
      if ((b = t.closest('.js-ag-hecho')) && (gf = filaDe(x, b))) { registrar(x, gf, { canal: 'INTERNO' }); return; }
      if ((b = t.closest('.js-ag-llamada')) && (gf = filaDe(x, b))) { llamada(x, gf, b); return; }
      if ((b = t.closest('.js-ag-llam')) && (gf = filaDe(x, b))) {
        var resp = b.getAttribute('data-r');
        registrar(x, gf, { canal: 'LLAMADA', mensaje: '', nota: 'Llamada: ' + ({ CONFIRMO: 'se comprometió', CUMPLIO: 'ya cumplió', NO_CONTESTA: 'no contesta' })[resp] }).then(function (ok) { if (ok) responder(x, gf, resp); });
        return;
      }
      if ((b = t.closest('.js-ag-ver')) && (gf = filaDe(x, b))) { verMensaje(x, gf); return; }
      // Calendario
      if ((b = t.closest('.js-ag-mes'))) { st(x).mes = x.mover(st(x).mes, Number(b.getAttribute('data-n'))); calendario(x, st(x).calTodas); return; }
      if ((b = t.closest('.js-ag-area'))) { st(x).calArea = b.getAttribute('data-a'); pintarCal(x); return; }
      if ((b = t.closest('.ag-cal__dia[data-f]'))) { verDia(x, b.getAttribute('data-f')); return; }
      // Registro
      if (t.closest('.js-agr-excel')) { excelRegistro(x); return; }
      if ((b = t.closest('.js-agr-cli'))) { x.irAItem('agenda:cli'); cliente(x, { cliente_id: b.getAttribute('data-id'), nombre: b.getAttribute('data-n') }); return; }
      if ((b = t.closest('.js-agr-deshacer'))) {
        U.confirmar({ titulo: '¿Deshacer este registro?', texto: 'Se quita del registro. Úsalo si se registró por error.', boton: 'Deshacer', peligro: true }).then(function (ok) {
          if (ok) x.api('deshacerRecordatorio', { recordatorio_id: b.getAttribute('data-id') }).then(function (r) { aviso(r && r.ok ? 'Deshecho.' : ((r && r.message) || 'No se pudo.'), r && r.ok ? 'info' : 'error'); registro(x); });
        });
        return;
      }
      // Por cliente
      if (t.closest('.js-agc-ver')) { verCliente(x); return; }
      // Ajustes
      if (t.closest('.js-aga-nueva')) { editarObligacion(x, ''); return; }
      if ((b = t.closest('.js-aga-editar'))) { editarObligacion(x, b.getAttribute('data-id')); return; }
      if ((b = t.closest('.js-aga-hist'))) { historialObl(x, b.getAttribute('data-id')); return; }
      if ((b = t.closest('.js-aga-restaurar'))) {
        U.confirmar({ titulo: '¿Volver a la propuesta inicial?', texto: 'Se reemplazan las fechas, los escalones y los mensajes por los de la propuesta. Queda en el historial.', boton: 'Restaurar' }).then(function (ok) {
          if (ok) x.api('restaurarObligacionAgenda', { obligacion_id: b.getAttribute('data-id') }).then(function (r) { aviso(r && r.ok ? r.data.message : ((r && r.message) || 'No se pudo.'), r && r.ok ? 'exito' : 'error'); ajustes(x); });
        });
      }
    });
    c.addEventListener('change', function (ev) {
      var t = ev.target, gf;
      if (t.classList.contains('js-ag-resp') && t.value && (gf = filaDe(x, t))) {
        var v = t.value;
        if (v === 'PIDIO_PLAZO' || v === 'NO_CORRESPONDE') pedirNota(v === 'PIDIO_PLAZO' ? '¿Hasta cuándo pidió plazo?' : '¿Por qué no corresponde?', v === 'PIDIO_PLAZO' ? 'Ej.: paga el lunes 19.' : 'Ej.: lo paga otra oficina.').then(function (n) { responder(x, gf, v, n); });
        else responder(x, gf, v);
        return;
      }
      if (t.classList.contains('js-agr-f')) { st(x).reg[t.getAttribute('data-f')] = t.value; registro(x); return; }
      if (t.classList.contains('js-agc-q')) { verCliente(x); }
    });
    var tq = null;
    c.addEventListener('input', function (ev) {
      if (!ev.target.classList.contains('js-agr-q')) return;
      var v = ev.target.value;
      clearTimeout(tq);
      tq = setTimeout(function () { st(x).reg.q = v; registro(x); }, 400);
    });
    c.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && ev.target.classList.contains('js-agc-q')) { ev.preventDefault(); verCliente(x); } });
  }
  function verCliente(x) {
    var q = x.raiz().querySelector('.js-agc-q');
    var v = q ? q.value.trim() : '';
    if (!v) return;
    var c = (x.cfg.clientes || []).filter(function (k) { return k.nombre === v; })[0];
    cliente(x, c ? { cliente_id: c.cliente_id, nombre: c.nombre } : { cliente_id: '', nombre: v });
  }

  /** Punto de entrada desde el módulo del área: vista = hoy | agenda:cal | agenda:reg | agenda:cli | agenda:general | ajustes. */
  function mostrar(vista, x) {
    enlazar(x);
    if (vista === 'agenda:cal') return calendario(x, false);
    if (vista === 'agenda:general') return calendario(x, true);
    if (vista === 'agenda:reg') return registro(x);
    if (vista === 'agenda:cli') return cliente(x);
    if (vista === 'ajustes') return ajustes(x);
    return hoy(x);
  }

  window.SigsoAgenda = { mostrar: mostrar, avisoDelDia: avisoDelDia };
})();
