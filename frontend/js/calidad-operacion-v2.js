/**
 * calidad-operacion-v2.js — Calidad: "Operación" 100 % v2 (SIGSO v2, R9 del
 * retiro de la versión clásica; ver documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 *  - Servicios prestados (§8.1, §8.5-8.7): registro de lo entregado a cada
 *    cliente, filtros por período (elegido de una lista), cliente, proceso y
 *    estado; liberar (trazado a quien autoriza), marcar salida no conforme,
 *    abrir la no conformidad y anular.
 *  - Proveedores (§8.4, PRO-04): listado con estado, única/o, última nota y
 *    próxima evaluación; ficha lateral con la evaluación por criterio (1 a
 *    10, promedio calculado en vivo) e historial; alta, edición y baja.
 * Mismos endpoints que calidad.js.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  function C() { return window.SigsoCalidadV2.util; }
  function api(a, d) {
    return C().api(a, d).then(function (r) {
      if (r && r.ok && r.data && r.data.ok === false) return { ok: false, message: r.data.message || 'No se pudo guardar.' };
      return r;
    });
  }
  var ESTADO_PRS = { PRESTADO: ['Prestado, sin liberar', 'alerta'], LIBERADO: ['Liberado', 'ok'], NO_CONFORME: ['Salida no conforme', 'critico'] };
  var ESTADO_PROV = { APROBADO: ['Aprobado', 'ok'], REPROBADO: ['Reprobado', 'critico'], SIN_EVALUAR: ['Sin evaluar', 'neutro'] };
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  var prs_ = { datos: null, f: { periodo: '', cliente_id: '', proceso_id: '', estado: '' } };
  var prov_ = { datos: null, q: '', filtro: '' };
  var vista_ = '', turno_ = 0;

  function fecha(v) { if (!v) return '—'; var s = String(v); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? PY.fecha(s, true) : (C().fechaChile(s) || PY.fecha(s, true)); }
  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function esCorreo(t) { return !t || /^[^\s@]+@[^\s@]+$/.test(String(t).trim()); }
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function aviso(tono, icono, texto) { return '<div class="mj2-aviso sx2-tono-' + tono + ' sx2-entra">' + U.ico(icono, 16) + '<span>' + texto + '</span></div>'; }
  function dato(et, v) { return v ? '<dt>' + U.esc(et) + '</dt><dd>' + v + '</dd>' : ''; }
  function input(n, v, extra) { return '<input class="sx2-input" name="' + n + '" value="' + U.esc(v == null ? '' : v) + '"' + (extra || '') + '>'; }
  function area(n, v, filas, extra) { return '<textarea class="sx2-input" name="' + n + '" rows="' + (filas || 3) + '"' + (extra || '') + '>' + U.esc(v == null ? '' : v) + '</textarea>'; }
  function select(n, ops, v, extra) { return '<select class="sx2-select" name="' + n + '"' + (extra || '') + '>' + ops.map(function (o) { return '<option value="' + U.esc(o[0]) + '"' + (String(o[0]) === String(v == null ? '' : v) ? ' selected' : '') + '>' + U.esc(o[1]) + '</option>'; }).join('') + '</select>'; }
  function fila2(a, b) { return '<div class="sx2-form__fila">' + a + b + '</div>'; }
  function persona(email) { if (!email) return '—'; var p = PY.persona(email); return '<span class="sx2-flex" style="gap:6px;align-items:center">' + U.avatar(p, 'xs') + U.esc(p.nombre) + '</span>'; }
  // Últimos 18 meses como períodos mensuales (2026-M08…), para no escribirlos a mano.
  function periodosMes() {
    var l = [], d = new Date();
    for (var i = 0; i < 18; i++) {
      var y = d.getFullYear(), m = d.getMonth() + 1;
      l.push([y + '-M' + ('0' + m).slice(-2), MESES[m - 1] + ' ' + y]);
      d.setMonth(d.getMonth() - 1);
    }
    return l;
  }

  function cabecera(titulo, sub, acciones) {
    return '<header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Calidad · Operación</span><h1>' + U.esc(titulo) + '</h1>' +
      '<span class="sx2-tenue" style="font-size:.875rem">' + U.esc(sub) + '</span></div><div class="sx2-cabecera__acciones">' + (acciones || '') +
      U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-op2-recargar' }) + '</div></header>';
  }
  function pagina(html, silencioso) {
    var c = C().contenedor(vista_);
    if (!c) return;
    var y = window.scrollY, foco = document.activeElement && document.activeElement.classList.contains('js-op2-q');
    c.innerHTML = '<div class="sx2-pagina">' + html + '</div>';
    if (silencioso) { c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; }); window.scrollTo(0, y); }
    if (foco) { var q = c.querySelector('.js-op2-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
    U.animar(c);
  }
  function paso(o) {
    U.formulario({ titulo: o.titulo, subtitulo: o.sub ? '<span class="sx2-tenue" style="font-size:.8125rem">' + o.sub + '</span>' : '', boton: o.boton || 'Guardar', ancho: o.ancho,
      campos: o.campos, alMontar: o.alMontar, preparar: o.preparar, enviar: o.enviar,
      aviso: o.aviso || function (r) { return (r && r.data && r.data.message) || 'Guardado.'; },
      listo: function (r) { cargar(true); if (o.listo) o.listo(r); } });
  }
  function error(titulo, sub, r) {
    pagina(cabecera(titulo, sub) + U.card({ i: 1, cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || '', accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-op2-recargar' }) }) }));
  }
  function cargar(silencioso) { if (vista_ === 'servicios') cargarPrs(silencioso); else if (vista_ === 'proveedores') cargarProv(silencioso); }

  // =========================================================================================
  // Servicios prestados
  // =========================================================================================
  var PRS_SUB = 'Lo que efectivamente se entregó a cada cliente (§8.1, §8.5), quién autorizó la liberación (§8.6) y qué salió no conforme (§8.7).';
  function cargarPrs(silencioso) {
    var t = ++turno_;
    if (!C().contenedor('servicios')) return;
    if (!silencioso || !prs_.datos) pagina(cabecera('Servicios prestados', PRS_SUB) + U.esqueleto('kpis', 5) + U.esqueleto('tabla', 5));
    api('listarPrestacionesSgc', prs_.f).then(function (r) {
      if (t !== turno_ || vista_ !== 'servicios' || !C().ocupa('servicios')) return;
      if (!r || !r.ok) { error('Servicios prestados', PRS_SUB, r); return; }
      prs_.datos = r.data;
      pintarPrs(!!silencioso);
    });
  }
  // Lo que la persona puede hacer con cada fila: el Encargado todo; la
  // jefatura del área libera y marca no conforme (nunca libera lo que ella
  // prestó); quien registró anula lo suyo mientras no esté liberado.
  function yo() { return String(prs_.datos.yo || '').toLowerCase(); }
  function puedeLiberarFila(p) {
    var d = prs_.datos;
    return !!d.puede_liberar && p.estado === 'PRESTADO' && (!!d.puede_gestionar || String(p.responsable_email || '').toLowerCase() !== yo());
  }
  function puedeAnularFila(p) {
    return !!prs_.datos.puede_gestionar || (p.estado === 'PRESTADO' && String(p.creado_por || '').toLowerCase() === yo());
  }
  // Para registrar solo se ofrecen los servicios del área propia: quien solo
  // está designada para liberar un área la ve, pero no registra en ella.
  function registrables(d) { return (d.procesos || []).filter(function (p) { return p.registra !== false; }); }
  // Una línea con quién libera cada área visible (§8.6: la liberación tiene dueño conocido).
  function quienLibera(d) {
    var l = d.liberadores || [];
    if (!l.length) return '';
    return aviso('info', 'check', '<b>Quién libera:</b> ' + l.map(function (a) {
      return txt(a.area_nombre) + ' — ' + (a.emails.length ? a.emails.map(function (e) { return txt(PY.persona(e).nombre); }).join(', ') : '<i>sin asignar (solo la jefatura del área o el Encargado del SGC)</i>');
    }).join(' · '));
  }
  function formLiberadores() {
    var d = prs_.datos, POR_AREA = 3;
    paso({ titulo: 'Quién libera cada área', boton: 'Guardar', ancho: true,
      sub: 'La persona que revisa y autoriza los servicios del área (§8.6). Puede ser de otra área o de gerencia; cuando cambie, se reemplaza aquí sin tocar su rol. Nadie libera lo que prestó él mismo.',
      campos: (d.liberadores || []).map(function (a, i) {
        var filas = [];
        for (var k = 0; k < POR_AREA; k++) filas.push(input('lib_' + i + '_' + k, a.emails[k] || '', ' type="email" data-persona'));
        return '<fieldset class="op2-lib"><legend>' + txt(a.area_nombre) + '</legend>' + filas.join('') + '</fieldset>';
      }).join(''),
      preparar: function (x) {
        var malo = '';
        var areas = (d.liberadores || []).map(function (a, i) {
          var emails = [];
          for (var k = 0; k < POR_AREA; k++) { var e = (x['lib_' + i + '_' + k] || '').trim(); if (e) { if (!esCorreo(e)) malo = a.area_nombre; emails.push(e); } }
          return { area_clave: a.area_clave, emails: emails };
        });
        return malo ? 'Revisa las personas de ' + malo + '.' : { areas: areas };
      },
      enviar: function (x) { return api('guardarLiberadoresSgc', x); } });
  }
  function pintarPrs(silencioso) {
    var d = prs_.datos, puede = !!d.puede_gestionar, r = d.resumen || {}, v = d.volumen || {};
    var porLiberar = (d.prestaciones || []).filter(puedeLiberarFila);
    if (!d.procesos.length) {
      pagina(cabecera('Servicios prestados', PRS_SUB) + aviso('alerta', 'alerta', 'No hay procesos de servicio cargados. Cárgalos primero en <b>Mapa de procesos</b>: sin ellos no hay qué registrar.'), silencioso);
      return;
    }
    var f = prs_.f;
    var filtros = '<div class="sx2-card sx2-py-herramientas sx2-entra" style="--i:2"><div class="sx2-barra-filtros">' +
      '<select class="sx2-select js-op2-f" data-f="periodo" aria-label="Período">' + [['', 'Todos los períodos']].concat(periodosMes()).map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === f.periodo ? ' selected' : '') + '>' + U.esc(o[1]) + '</option>'; }).join('') + '</select>' +
      '<select class="sx2-select js-op2-f" data-f="cliente_id" aria-label="Cliente"><option value="">Todos los clientes</option>' + (d.clientes || []).map(function (c) { return '<option value="' + U.esc(c.cliente_id) + '"' + (c.cliente_id === f.cliente_id ? ' selected' : '') + '>' + txt(c.nombre) + '</option>'; }).join('') + '</select>' +
      '<select class="sx2-select js-op2-f" data-f="proceso_id" aria-label="Proceso"><option value="">Todos los procesos</option>' + (d.procesos || []).map(function (p) { return '<option value="' + U.esc(p.proceso_id) + '"' + (p.proceso_id === f.proceso_id ? ' selected' : '') + '>' + txt(p.codigo + ' — ' + p.nombre) + '</option>'; }).join('') + '</select>' +
      '<select class="sx2-select js-op2-f" data-f="estado" aria-label="Estado"><option value="">Todos los estados</option>' + (d.estados || []).map(function (e) { return '<option value="' + U.esc(e) + '"' + (e === f.estado ? ' selected' : '') + '>' + txt((ESTADO_PRS[e] || [e])[0]) + '</option>'; }).join('') + '</select>' +
      (f.periodo || f.cliente_id || f.proceso_id || f.estado ? U.chip({ texto: 'Quitar filtros', icono: 'equis', clase: 'js-op2-limpiar' }) : '') + '</div></div>';
    var acciones = (porLiberar.length ? U.boton({ texto: 'Liberar (' + porLiberar.length + ')', icono: 'check', clase: 'js-op2-lib-lote', titulo: 'Liberar de una vez lo que se ve en la lista' }) : '') +
      (d.puede_registrar ? U.boton({ texto: 'Registrar una', icono: 'nueva', clase: 'js-op2-prs-nueva' }) +
        U.boton({ texto: 'Registrar el mes', icono: 'calendario', variante: 'primario', clase: 'js-op2-prs-lote' }) : '') +
      (d.puede_asignar_liberadores ? U.boton({ texto: 'Quién libera', icono: 'llave', clase: 'js-op2-liberadores', titulo: 'Asignar quién libera los servicios de cada área' }) : '');
    pagina(cabecera('Servicios prestados', PRS_SUB, acciones) +
      '<div class="sx2-fila-kpis">' + U.kpi({ i: 0, etiqueta: 'Prestaciones', valor: r.total || 0, icono: 'caja', tono: 'primario' }) +
        U.kpi({ i: 1, etiqueta: 'Liberadas', valor: r.liberado || 0, icono: 'check', tono: 'ok' }) +
        U.kpi({ i: 2, etiqueta: 'Sin liberar', valor: r.prestado || 0, icono: 'reloj', tono: r.prestado ? 'alerta' : 'ok', titulo: '§8.6 pide que la liberación quede trazada a quien la autoriza.' }) +
        U.kpi({ i: 3, etiqueta: 'No conformes', valor: r.no_conforme || 0, icono: 'alerta', tono: r.no_conforme ? 'critico' : 'ok' }) +
        U.kpi({ i: 4, etiqueta: 'Sin evidencia', valor: r.sin_evidencia || 0, icono: 'documento', tono: r.sin_evidencia ? 'alerta' : 'ok' }) + '</div>' +
      (v.aviso ? aviso('critico', 'alerta', txt(v.aviso)) : '') + quienLibera(d) + filtros +
      (d.acotada && d.total_filtrado > d.tope ? aviso('info', 'info', 'Sin filtro se muestran las últimas ' + d.tope + ' de ' + d.total_filtrado + '. Filtra por período o cliente para ver el resto.') : '') +
      (d.prestaciones.length ? '<section class="sx2-card sx2-card--sin-relleno sx2-entra" style="--i:3"><ul class="md2-inds">' + d.prestaciones.map(function (p) {
        var e = ESTADO_PRS[p.estado] || [p.estado, 'neutro'];
        return '<li class="md2-ind sx2-tono-' + e[1] + '"><div class="sx2-apilado" style="gap:5px;flex:1;min-width:0">' +
          '<span class="sx2-flex" style="gap:8px;flex-wrap:wrap;align-items:center"><code class="mj2-cod">' + txt(p.proceso_codigo) + '</code><strong class="mj2-fila__tit">' + txt(p.cliente_nombre) + '</strong>' + U.badge(e[0], e[1]) +
            (p.periodo ? U.badge(periodoTexto(p.periodo), 'neutro', true) : '') + (p.liberada_por_el_mismo ? U.badge('Liberó quien prestó', 'alerta', true) : '') + (p.nc_id ? U.badge('Con NC', 'critico', true) : '') + '</span>' +
          '<span class="sx2-tenue mj2-fila__txt">' + txt(p.proceso_nombre) + '</span>' +
          '<span class="mj2-meta"><span>' + U.ico('calendario', 12) + 'Prestado ' + txt(fecha(p.fecha_prestacion)) + '</span><span>' + persona(p.responsable_email) + '</span>' +
            (p.liberado_por ? '<span>' + U.ico('check', 12) + 'Liberó ' + txt(PY.persona(p.liberado_por).nombre) + ' · ' + txt(fecha(p.fecha_liberacion)) + '</span>' : '') +
            '<span>' + U.ico('documento', 12) + (p.evidencia ? txt(p.evidencia) : '<i>Sin evidencia registrada</i>') + '</span></span>' +
          (p.observaciones ? '<span class="mj2-ayuda" style="margin:0">' + txt(p.observaciones) + '</span>' : '') + '</div>' +
          (puede || d.puede_liberar || puedeAnularFila(p) ? '<span class="mj2-acciones" style="margin:0;flex:none">' +
            (puedeLiberarFila(p) ? U.boton({ texto: 'Liberar', icono: 'check', sm: true, variante: 'primario', clase: 'js-op2-liberar', datos: { id: p.prestacion_id } }) : '') +
            (d.puede_liberar && p.estado !== 'NO_CONFORME' ? U.boton({ texto: 'No conforme', sm: true, clase: 'js-op2-noconf', datos: { id: p.prestacion_id } }) : '') +
            (puede && p.estado === 'NO_CONFORME' && !p.nc_id ? U.boton({ texto: 'Abrir NC', sm: true, variante: 'primario', clase: 'js-op2-nc', datos: { id: p.prestacion_id } }) : '') +
            (puedeAnularFila(p) ? U.boton({ soloIcono: true, icono: 'basura', sm: true, variante: 'fantasma', titulo: 'Anular', clase: 'js-op2-anular', datos: { id: p.prestacion_id } }) : '') + '</span>' : '') + '</li>';
      }).join('') + '</ul></section>' : U.card({ i: 3, cuerpo: U.vacio({ icono: 'caja', titulo: 'No hay prestaciones con esos filtros', texto: 'Un registro por servicio efectivamente entregado.' }) })), silencioso);
  }
  function prestacion(id) { return (prs_.datos.prestaciones || []).filter(function (p) { return p.prestacion_id === id; })[0]; }
  function formPrestacion() {
    var d = prs_.datos;
    paso({ titulo: 'Registrar prestación', boton: 'Registrar', ancho: true, sub: 'Un registro por servicio efectivamente entregado. No se generan por adelantado.',
      campos: U.campo('Cliente', select('cliente_id', [['', 'Elige el cliente…']].concat((d.clientes || []).map(function (c) { return [c.cliente_id, c.nombre + (c.rut ? ' (' + c.rut + ')' : '')]; })), '')) +
        U.campo('Proceso de servicio', select('proceso_id', [['', 'Elige el proceso…']].concat(registrables(d).map(function (p) { return [p.proceso_id, p.codigo + ' — ' + p.nombre]; })), '')) +
        fila2(U.campo('Período (si es recurrente)', select('periodo', [['', 'Puntual (sin período)']].concat(periodosMes()), '')), U.campo('Fecha de prestación', input('fecha_prestacion', PY.hoyClave(), ' type="date" required max="' + PY.hoyClave() + '"'))) +
        U.campo('Quién lo prestó', input('responsable_email', d.yo || '', ' type="email" required data-persona')) +
        U.campo('Evidencia', area('evidencia', '', 2), 'Folio, número de formulario, enlace al archivo… lo que permita encontrarlo después.'),
      preparar: function (x) {
        if (!x.cliente_id || !x.proceso_id) return 'Elige cliente y proceso.';
        if (!x.fecha_prestacion) return 'Indica la fecha.';
        return x.responsable_email && esCorreo(x.responsable_email) ? x : 'Indica el correo de quien lo prestó.';
      },
      enviar: function (x) { return api('registrarPrestacionSgc', x); } });
  }
  // El Encargado puede registrar la liberación que autorizó otra persona; la
  // jefatura del área libera siempre a su propio nombre.
  function campoAutoriza() {
    return prs_.datos.puede_gestionar ? U.campo('Autoriza', input('liberado_por', '', ' type="email" required data-persona')) : '';
  }
  function formLiberar(p) {
    var gestor = !!prs_.datos.puede_gestionar;
    paso({ titulo: 'Liberar el servicio', boton: 'Liberar', sub: txt(p.proceso_codigo + ' → ' + p.cliente_nombre) + '. §8.6 pide trazabilidad a quien autoriza la liberación (la jefatura de cada área, según el DOC-01).' + (gestor ? '' : ' Queda liberado a tu nombre.'),
      campos: campoAutoriza() + U.campo('Fecha de liberación', input('fecha_liberacion', PY.hoyClave(), ' type="date" max="' + PY.hoyClave() + '"')),
      alMontar: function (form) { var el = form.querySelector('[name=liberado_por]'); if (!el) return; el.addEventListener('change', function () { var h = form.querySelector('.js-op2-mismo'); if (h) h.remove(); if (el.value.trim().toLowerCase() === String(p.responsable_email || '').toLowerCase()) el.insertAdjacentHTML('afterend', '<span class="sx2-campo__ayuda js-op2-mismo" style="color:var(--sx-alerta)">Es la misma persona que lo prestó: quedará marcado.</span>'); }); },
      preparar: function (x) { return !gestor || (x.liberado_por && esCorreo(x.liberado_por)) ? x : 'Indica quién autoriza.'; },
      enviar: function (x) { x.prestacion_id = p.prestacion_id; return api('liberarPrestacionSgc', x); } });
  }

  // --- Por lote: el mes completo de un servicio (Etapa A del control interno) ------------
  // '2026-M09' → 'sep 2026' (el código del período queda para los filtros).
  function periodoTexto(per) { var m = /^(\d{4})-M(\d{2})$/.exec(per || ''); return m ? MESES[+m[2] - 1] + ' ' + m[1] : String(per || ''); }
  function mesAnterior(per) {
    var m = /^(\d{4})-M(\d{2})$/.exec(per || '');
    if (!m) return '';
    var y = +m[1], n = +m[2] - 1;
    if (!n) { y--; n = 12; }
    return y + '-M' + ('0' + n).slice(-2);
  }
  function omitidasTexto(r) {
    var o = (r && r.data && r.data.omitidas) || [];
    if (!o.length) return '';
    return ' ' + o.slice(0, 3).map(function (x) { return (x.cliente_nombre || 'Sin nombre') + ': ' + x.motivo; }).join(' · ') + (o.length > 3 ? ' · y ' + (o.length - 3) + ' más.' : '');
  }
  // Lista de casillas sin `name`: FormData no la recoge y `preparar` arma los ids.
  function bloqueLista(titulo, barra) {
    return '<div class="sx2-campo"><span class="sx2-campo__et">' + U.esc(titulo) + ' · <b class="js-op2-cuenta">0</b> marcados</span>' + (barra || '') +
      '<div class="op2-lote__lista js-op2-lote-lista" role="group" aria-label="' + U.esc(titulo) + '"></div><span class="sx2-campo__ayuda js-op2-lote-estado"></span></div>';
  }
  function formLote() {
    var d = prs_.datos, hoy = PY.hoyClave(), lote = { ya: {}, anterior: [], marcados: {} };
    var clientes = d.clientes || [];
    paso({ titulo: 'Registrar el mes', boton: 'Registrar', ancho: true, ocupado: 'Registrando…',
      sub: 'Un registro por cliente atendido en el período, igual que la hoja mensual de la matriz. Lo ya registrado se respeta y no se duplica.',
      campos: U.campo('Proceso de servicio', select('proceso_id', [['', 'Elige el proceso…']].concat(registrables(d).map(function (p) { return [p.proceso_id, p.codigo + ' — ' + p.nombre]; })), prs_.f.proceso_id)) +
        fila2(U.campo('Período', select('periodo', periodosMes(), prs_.f.periodo || periodosMes()[1][0])), U.campo('Fecha de prestación', input('fecha_prestacion', hoy, ' type="date" required max="' + hoy + '"'))) +
        fila2(U.campo('Quién lo prestó', input('responsable_email', d.yo || '', ' type="email" required data-persona')),
          U.campo('Evidencia', input('evidencia', '', ' placeholder="Enlace a la matriz del mes o a la carpeta"'), 'Se guarda en cada cliente del lote.')) +
        bloqueLista('Clientes', '<div class="op2-lote__barra"><input class="sx2-input js-op2-lote-q" type="search" placeholder="Buscar por nombre o RUT" aria-label="Buscar cliente">' +
          U.boton({ texto: 'Marcar visibles', sm: true, clase: 'js-op2-lote-todos', tipo: 'button' }) + U.boton({ texto: 'Desmarcar', sm: true, clase: 'js-op2-lote-ninguno', tipo: 'button' }) +
          U.boton({ texto: 'Copiar mes anterior', icono: 'calendario', sm: true, clase: 'js-op2-lote-anterior', tipo: 'button' }) + '</div>'),
      alMontar: function (form) {
        var lista = form.querySelector('.js-op2-lote-lista'), q = form.querySelector('.js-op2-lote-q');
        var cuenta = form.querySelector('.js-op2-cuenta'), estado = form.querySelector('.js-op2-lote-estado');
        var btnAnt = form.querySelector('.js-op2-lote-anterior');
        var selProc = form.querySelector('[name=proceso_id]'), selPer = form.querySelector('[name=periodo]');
        function contar() { cuenta.textContent = Object.keys(lote.marcados).filter(function (id) { return lote.marcados[id] && !lote.ya[id]; }).length; }
        function pintar() {
          var t = norm(q.value);
          var vis = clientes.filter(function (c) { return !t || norm(c.nombre + ' ' + c.rut).indexOf(t) !== -1; });
          lista.innerHTML = vis.length ? vis.map(function (c) {
            var ya = !!lote.ya[c.cliente_id];
            return '<label class="op2-lote__cli' + (ya ? ' is-ya' : '') + '"><input type="checkbox" class="js-op2-cli" data-id="' + U.esc(c.cliente_id) + '"' + (ya ? ' disabled' : '') + (lote.marcados[c.cliente_id] && !ya ? ' checked' : '') + '>' +
              '<span>' + txt(c.nombre) + '</span>' + (c.rut ? '<small>' + txt(c.rut) + '</small>' : '') + (ya ? U.badge('Ya registrado', 'neutro', true) : '') + '</label>';
          }).join('') : '<p class="sx2-tenue" style="margin:8px">Ningún cliente coincide con la búsqueda.</p>';
          contar();
        }
        function refrescar() {
          var pid = selProc.value, per = selPer.value;
          lote.ya = {}; lote.anterior = [];
          btnAnt.disabled = true;
          estado.textContent = '';
          pintar();
          if (!pid || !per) return;
          estado.textContent = 'Revisando lo ya registrado…';
          Promise.all([api('listarPrestacionesSgc', { proceso_id: pid, periodo: per }), api('listarPrestacionesSgc', { proceso_id: pid, periodo: mesAnterior(per) })]).then(function (rs) {
            if (selProc.value !== pid || selPer.value !== per) return;
            var de = function (r) { return (r && r.ok && r.data && r.data.prestaciones) || []; };
            de(rs[0]).forEach(function (p) { lote.ya[p.cliente_id] = true; });
            lote.anterior = de(rs[1]).map(function (p) { return p.cliente_id; });
            btnAnt.disabled = !lote.anterior.length;
            var n = Object.keys(lote.ya).length;
            estado.textContent = (n ? n + ' ya registrado' + (n === 1 ? '' : 's') + ' en este período. ' : '') +
              (lote.anterior.length ? 'El mes anterior se registraron ' + lote.anterior.length + ': "Copiar mes anterior" los marca.' : 'El mes anterior no tiene registros de este servicio.');
            pintar();
          });
        }
        lista.addEventListener('change', function (ev) {
          var cb = ev.target.closest('.js-op2-cli');
          if (cb) { lote.marcados[cb.getAttribute('data-id')] = cb.checked; contar(); }
        });
        form.addEventListener('click', function (ev) {
          if (ev.target.closest('.js-op2-lote-todos')) { lista.querySelectorAll('.js-op2-cli:not(:disabled)').forEach(function (cb) { lote.marcados[cb.getAttribute('data-id')] = true; }); pintar(); }
          else if (ev.target.closest('.js-op2-lote-ninguno')) { lote.marcados = {}; pintar(); }
          else if (ev.target.closest('.js-op2-lote-anterior')) { lote.anterior.forEach(function (id) { lote.marcados[id] = true; }); pintar(); }
        });
        // Enter en la búsqueda no envía el formulario.
        q.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') ev.preventDefault(); });
        q.addEventListener('input', pintar);
        selProc.addEventListener('change', refrescar);
        selPer.addEventListener('change', refrescar);
        refrescar();
      },
      preparar: function (x) {
        if (!x.proceso_id) return 'Elige el proceso de servicio.';
        if (!x.fecha_prestacion) return 'Indica la fecha.';
        if (!x.responsable_email || !esCorreo(x.responsable_email)) return 'Indica el correo de quien lo prestó.';
        var ids = Object.keys(lote.marcados).filter(function (id) { return lote.marcados[id] && !lote.ya[id]; });
        if (!ids.length) return 'Marca al menos un cliente.';
        if (ids.length > (d.tope_lote || 300)) return 'Son ' + ids.length + ' clientes; el máximo por vez es ' + (d.tope_lote || 300) + '.';
        x.cliente_ids = ids;
        return x;
      },
      enviar: function (x) {
        return api('registrarLotePrestacionesSgc', x).then(function (r) {
          // Al volver, la lista queda en lo recién registrado: listo para liberar.
          if (r && r.ok) prs_.f = { periodo: x.periodo, cliente_id: '', proceso_id: x.proceso_id, estado: '' };
          return r;
        });
      },
      aviso: function (r) { return ((r && r.data && r.data.message) || 'Registrado.') + omitidasTexto(r); } });
  }
  function formLiberarLote() {
    var d = prs_.datos, hoy = PY.hoyClave();
    var lista = (d.prestaciones || []).filter(puedeLiberarFila);
    paso({ titulo: 'Liberar servicios', boton: 'Liberar marcadas', ancho: true, ocupado: 'Liberando…',
      sub: 'La revisión de la jefatura (§8.6): cada una queda trazada a quien autoriza y la fecha.' + (d.puede_gestionar ? '' : ' Quedan liberadas a tu nombre. Lo que prestaste tú no aparece: lo libera otra jefatura o el Encargado del SGC.'),
      campos: campoAutoriza() + U.campo('Fecha de liberación', input('fecha_liberacion', hoy, ' type="date" max="' + hoy + '"')) + bloqueLista('Prestaciones por liberar'),
      alMontar: function (form) {
        var el = form.querySelector('.js-op2-lote-lista'), cuenta = form.querySelector('.js-op2-cuenta');
        el.innerHTML = lista.map(function (p) {
          return '<label class="op2-lote__cli"><input type="checkbox" class="js-op2-cli" data-id="' + U.esc(p.prestacion_id) + '" checked>' +
            '<span><code class="mj2-cod">' + txt(p.proceso_codigo) + '</code> ' + txt(p.cliente_nombre) + '</span>' +
            '<small>' + txt(p.periodo ? periodoTexto(p.periodo) : fecha(p.fecha_prestacion)) + ' · ' + txt(PY.persona(p.responsable_email).nombre) + '</small></label>';
        }).join('');
        function contar() { cuenta.textContent = el.querySelectorAll('.js-op2-cli:checked').length; }
        el.addEventListener('change', contar);
        contar();
        form.querySelector('.js-op2-lote-estado').textContent = d.acotada && d.total_filtrado > d.tope ? 'Solo las que se ven en la lista: filtra por período y proceso para revisar un mes completo.' : '';
      },
      preparar: function (x, form) {
        if (d.puede_gestionar && !(x.liberado_por && esCorreo(x.liberado_por))) return 'Indica quién autoriza.';
        var ids = [].map.call(form.querySelectorAll('.js-op2-cli:checked'), function (cb) { return cb.getAttribute('data-id'); });
        if (!ids.length) return 'Marca al menos una prestación.';
        x.prestacion_ids = ids;
        return x;
      },
      enviar: function (x) { return api('liberarLotePrestacionesSgc', x); },
      aviso: function (r) { return ((r && r.data && r.data.message) || 'Liberadas.') + omitidasTexto(r); } });
  }
  function formNoConforme(p) {
    paso({ titulo: 'Marcar salida no conforme', boton: 'Marcar', sub: txt(p.proceso_codigo + ' → ' + p.cliente_nombre) + '. Si estaba liberada, deja de estarlo: §8.7 pide no entregarla hasta corregirla.',
      campos: U.campo('En qué no conformó', area('observaciones', '', 3, ' required'), 'Sin esto no hay nada que tratar después.'),
      preparar: function (x) { return (x.observaciones || '').length >= 10 ? x : 'Explica en qué no conformó (mínimo 10 caracteres).'; },
      enviar: function (x) { return api('marcarNoConformePrestacionSgc', { prestacion_id: p.prestacion_id, observaciones: x.observaciones }); } });
  }

  // =========================================================================================
  // Proveedores
  // =========================================================================================
  var PROV_SUB = 'Listado de proveedores aprobados (FO-PRO-04-01). La evaluación es anual; reprueba con promedio menor o igual al corte.';
  function cargarProv(silencioso) {
    var t = ++turno_;
    if (!C().contenedor('proveedores')) return;
    if (!silencioso || !prov_.datos) pagina(cabecera('Proveedores', PROV_SUB) + U.esqueleto('kpis', 5) + U.esqueleto('tabla', 5));
    api('listarProveedoresSgc', {}).then(function (r) {
      if (t !== turno_ || vista_ !== 'proveedores' || !C().ocupa('proveedores')) return;
      if (!r || !r.ok) { error('Proveedores', PROV_SUB, r); return; }
      prov_.datos = r.data;
      pintarProv(!!silencioso);
    });
  }
  function pintarProv(silencioso) {
    var d = prov_.datos, ind = d.indicadores || {}, puede = d.puede_gestionar === true;
    var todos = d.proveedores || [];
    var l = todos.filter(function (p) {
      if (prov_.filtro === 'POR_EVALUAR' && !p.evaluacion_vencida) return false;
      if (prov_.filtro && prov_.filtro !== 'POR_EVALUAR' && p.estado !== prov_.filtro) return false;
      return !prov_.q || norm([p.nombre, p.producto_servicio, p.rut, p.nombre_contacto].join(' ')).indexOf(norm(prov_.q)) !== -1;
    });
    var kpi = function (i, et, n, ico, tono, f) { return U.kpi({ i: i, etiqueta: et, valor: n || 0, icono: ico, tono: tono, filtro: f, activo: prov_.filtro === f }); };
    pagina(cabecera('Proveedores', PROV_SUB.replace('al corte', 'a ' + (d.corte_aprobacion || 5)), puede ? U.boton({ texto: 'Nuevo proveedor', icono: 'nueva', variante: 'primario', clase: 'js-op2-prov-nuevo' }) : '') +
      '<div class="sx2-fila-kpis">' + kpi(0, 'Aprobados', ind.aprobados, 'check', 'ok', 'APROBADO') + kpi(1, 'Reprobados', ind.reprobados, 'alerta', ind.reprobados ? 'critico' : 'neutro', 'REPROBADO') +
        kpi(2, 'Sin evaluar', ind.sin_evaluar, 'reloj', ind.sin_evaluar ? 'alerta' : 'neutro', 'SIN_EVALUAR') + kpi(3, 'Por evaluar', ind.por_evaluar, 'calendario', ind.por_evaluar ? 'alerta' : 'ok', 'POR_EVALUAR') + '</div>' +
      (ind.unicos_reprobados ? aviso('alerta', 'alerta', ind.unicos_reprobados + (ind.unicos_reprobados === 1 ? ' proveedor único está reprobado' : ' proveedores únicos están reprobados') + '. No corresponde reemplazarlos: hay que pedirles una reunión para exigir mejoras (PRO-04 §6.2).') : '') +
      '<div class="sx2-card sx2-py-herramientas sx2-entra" style="--i:4"><div class="sx2-barra-filtros"><label class="sx2-buscar">' + U.ico('lupa', 16) + '<input class="sx2-input js-op2-q" type="search" placeholder="Buscar por nombre, producto, RUT o contacto…" value="' + U.esc(prov_.q) + '"></label>' +
        (prov_.filtro ? U.chip({ texto: 'Quitar filtro', icono: 'equis', clase: 'js-op2-sinfiltro' }) : '') + '</div></div>' +
      (l.length ? '<section class="sx2-card sx2-card--sin-relleno sx2-entra" style="--i:5"><ul class="mj2-lista">' + l.map(function (p) {
        var e = ESTADO_PROV[p.estado] || [p.estado, 'neutro'];
        return '<li class="mj2-fila mj2-fila--marca sx2-tono-' + e[1] + '" data-op2-prov="' + U.esc(p.proveedor_id) + '" tabindex="0"><span class="sx2-apilado" style="gap:5px;min-width:0;flex:1">' +
          '<span class="sx2-flex" style="gap:8px;flex-wrap:wrap;align-items:center"><strong class="mj2-fila__tit">' + txt(p.nombre) + '</strong>' + U.badge(e[0], e[1]) + (p.es_unico ? U.badge('Único', 'info', true) : '') + (p.evaluacion_vencida ? U.badge('Por evaluar', 'alerta', true) : '') + '</span>' +
          '<span class="sx2-tenue mj2-fila__txt">' + txt(p.producto_servicio || '') + '</span>' +
          '<span class="mj2-meta">' + (p.rut ? '<span>' + txt(p.rut) + '</span>' : '') + (p.ultima_evaluacion_promedio != null ? '<span>Última nota <b>' + p.ultima_evaluacion_promedio + '</b>' + (p.ultima_evaluacion_resultado ? ' (' + txt(p.ultima_evaluacion_resultado) + ')' : '') + '</span>' : '<span>Nunca evaluado</span>') +
            (p.proxima_evaluacion ? '<span>' + U.ico('calendario', 12) + 'Próxima ' + txt(fecha(p.proxima_evaluacion)) + '</span>' : '') + '</span></span>' + U.ico('derecha', 16) + '</li>';
      }).join('') + '</ul></section>' : U.card({ i: 5, cuerpo: U.vacio({ icono: 'caja', titulo: todos.length ? 'Nada con este filtro' : 'Todavía no hay proveedores', texto: todos.length ? '' : 'El listado maestro registra a quién se le compra y si está aprobado.' }) })), silencioso);
  }
  function abrirProv(id) {
    var dr = U.drawer({ titulo: 'Proveedor', cuerpo: U.esqueleto('tabla', 5) });
    dr.el.classList.add('sx2-drawer--ancho');
    api('getDetalleProveedorSgc', { proveedor_id: id }).then(function (r) {
      if (!r || !r.ok) { dr.cuerpo(U.vacio({ icono: 'alerta', titulo: 'No se pudo abrir', texto: (r && r.message) || '' })); return; }
      dr.cerrar(true);
      fichaProv(r.data);
    });
  }
  function fichaProv(data) {
    var p = data.proveedor, ev = data.evaluaciones || [], puede = data.puede_gestionar === true;
    var e = ESTADO_PROV[p.estado] || [p.estado, 'neutro'];
    var reabrir = function () { abrirProv(p.proveedor_id); };
    var dr = U.drawer({ titulo: p.nombre,
      subtitulo: '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + U.badge(e[0], e[1]) + (p.es_unico ? U.badge('Proveedor único', 'info') : '') + '</span>',
      cuerpo: (p.estado === 'REPROBADO' ? aviso(p.es_unico ? 'alerta' : 'critico', 'alerta', p.es_unico ? 'Reprobado, pero es proveedor único: PRO-04 §6.2 no permite desecharlo. Corresponde pedirle una reunión para exigir mejoras.' : 'Reprobado: según PRO-04 §6.2 corresponde dejar de comprarle y buscar un reemplazo.') : '') +
        '<dl class="sx2-dato mj2-datos">' + dato('Producto o servicio', txt(p.producto_servicio)) + dato('RUT', txt(p.rut)) + dato('Contacto', txt(p.nombre_contacto)) + dato('Correo', txt(p.email)) +
          dato('Teléfono', txt(p.telefono)) + dato('Dirección', txt(p.direccion)) + dato('Última evaluación', p.ultima_evaluacion_fecha ? txt(fecha(p.ultima_evaluacion_fecha)) : '') + dato('Próxima evaluación', p.proxima_evaluacion ? txt(fecha(p.proxima_evaluacion)) : '') + '</dl>' +
        (puede ? '<div class="mj2-acciones">' + U.boton({ texto: 'Evaluar', icono: 'diana', sm: true, variante: 'primario', clase: 'js-op2-evaluar' }) + U.boton({ texto: 'Editar datos', icono: 'editar', sm: true, clase: 'js-op2-editar' }) + '</div>' : '') +
        '<h3 class="mj2-sub">Evaluaciones (FO-PRO-04-02)</h3>' + (ev.length ? '<ul class="mj2-hallazgos">' + ev.map(function (x) {
          return '<li class="mj2-hallazgo sx2-tono-' + (x.aprobado ? 'ok' : 'critico') + '"><div class="sx2-flex" style="gap:8px;flex-wrap:wrap;align-items:center"><strong style="font-size:1.25rem">' + x.promedio + '</strong>' + U.badge(x.resultado, x.aprobado ? 'ok' : 'critico') + '<span class="sx2-tenue">' + txt(fecha(x.fecha)) + '</span></div>' +
            '<ul class="op2-notas">' + (x.calificaciones || []).map(function (c) { return '<li><span>' + txt(c.etiqueta) + '</span>' + U.barra(c.valor * 10, c.valor <= (data.corte_aprobacion || 5) ? 'critico' : (c.valor >= 8 ? 'ok' : 'alerta')) + '<b>' + c.valor + '</b></li>'; }).join('') + '</ul>' +
            (x.orden_compra ? '<p>Orden de compra ' + txt(x.orden_compra) + '</p>' : '') + (x.observaciones ? '<p>' + txt(x.observaciones) + '</p>' : '') +
            '<p>Evaluó ' + txt(PY.persona(x.evaluador_email).nombre) + (x.proxima_evaluacion ? ' · próxima ' + txt(fecha(x.proxima_evaluacion)) : '') + '</p></li>';
        }).join('') + '</ul>' : U.vacio({ icono: 'diana', titulo: 'Todavía no se ha evaluado', texto: 'PRO-04 §6.2 pide evaluarlo cada 12 meses. Sin evaluación no puede quedar aprobado.' })),
      pie: (puede ? U.boton({ texto: 'Dar de baja', icono: 'basura', variante: 'texto-peligro', clase: 'js-op2-baja' }) + '<span style="flex:1"></span>' : '') + U.boton({ texto: 'Cerrar', clase: 'js-sx2-drawer-cerrar' }) });
    dr.el.classList.add('sx2-drawer--ancho');
    dr.el.addEventListener('click', function (ev2) {
      var t = ev2.target;
      if (t.closest('.js-op2-evaluar')) formEvaluar(p, data, reabrir);
      else if (t.closest('.js-op2-editar')) formProveedor(p, reabrir);
      else if (t.closest('.js-op2-baja')) paso({ titulo: 'Dar de baja a ' + p.nombre, boton: 'Dar de baja', sub: 'Sale del listado, pero sus evaluaciones se conservan: son la evidencia de que el control de proveedores se aplicaba.',
        campos: U.campo('Motivo', area('motivo', '', 3, ' required')),
        preparar: function (x) { return (x.motivo || '').length >= 5 ? x : 'Indica el motivo.'; },
        enviar: function (x) { return api('desactivarProveedorSgc', { proveedor_id: p.proveedor_id, motivo: x.motivo }); }, aviso: 'Proveedor dado de baja.' });
    });
  }
  function formProveedor(p, despues) {
    var nuevo = !p;
    p = p || {};
    paso({ titulo: nuevo ? 'Nuevo proveedor' : 'Editar proveedor', ancho: true,
      campos: U.campo('Nombre o razón social', input('nombre', p.nombre, ' required')) + U.campo('Producto o servicio que provee', input('producto_servicio', p.producto_servicio, ' required')) +
        fila2(U.campo('RUT', input('rut', p.rut)), U.campo('Nombre de contacto', input('nombre_contacto', p.nombre_contacto))) +
        fila2(U.campo('Correo', input('email', p.email, ' type="email"')), U.campo('Teléfono', input('telefono', p.telefono))) + U.campo('Dirección', input('direccion', p.direccion)) +
        '<label class="nv2-check"><input type="checkbox" name="es_unico"' + (p.es_unico ? ' checked' : '') + '> Es proveedor único</label>' +
        '<p class="mj2-ayuda">Márcalo si no hay con quién reemplazarlo: si reprueba, en vez de dejar de comprarle se le pide una reunión de mejora (PRO-04 §6.2).</p>',
      preparar: function (x, form) { if (!x.nombre || !x.producto_servicio) return 'Completa nombre y producto o servicio.'; if (!esCorreo(x.email)) return 'Revisa el correo.'; x.es_unico = form.querySelector('[name=es_unico]').checked; if (!nuevo) x.proveedor_id = p.proveedor_id; return x; },
      enviar: function (x) { return api('guardarProveedorSgc', x); }, aviso: nuevo ? 'Proveedor agregado.' : 'Datos guardados.',
      listo: function (r) { if (despues) despues(); else if (nuevo && r && r.data && r.data.proveedor_id) abrirProv(r.data.proveedor_id); } });
  }
  function formEvaluar(p, data, reabrir) {
    var crit = data.criterios || [], escala = data.escala || [], corte = data.corte_aprobacion || 5;
    paso({ titulo: 'Evaluar a ' + p.nombre, boton: 'Guardar evaluación', ancho: true,
      sub: 'Califica cada ítem de 1 a 10 (FO-PRO-04-02). ' + escala.map(function (e) { return txt(e.etiqueta) + ': ' + e.desde + ' a ' + e.hasta; }).join(' · '),
      campos: U.campo('Orden de compra N° (opcional)', input('orden_compra', '')) +
        crit.map(function (c) { return '<div class="fc2-item"><span>' + txt(c.etiqueta) + '</span><input class="sx2-input op2-nota" type="number" min="1" max="10" step="1" name="' + U.esc(c.campo) + '" required style="width:90px"></div>'; }).join('') +
        '<p class="op2-promedio js-op2-promedio">Promedio: —</p>' + U.campo('Observaciones', area('observaciones', '', 3)),
      alMontar: function (form) {
        var out = form.querySelector('.js-op2-promedio');
        form.addEventListener('input', function () {
          var v = crit.map(function (c) { return Number(form.querySelector('[name="' + c.campo + '"]').value); }).filter(function (n) { return n >= 1 && n <= 10; });
          if (v.length !== crit.length) { out.textContent = 'Promedio: —'; out.className = 'op2-promedio js-op2-promedio'; return; }
          var prom = Math.round(v.reduce(function (a, b) { return a + b; }, 0) / v.length * 10) / 10;
          out.textContent = 'Promedio: ' + prom + (prom <= corte ? ' — reprobaría' : ' — aprobaría');
          out.className = 'op2-promedio js-op2-promedio ' + (prom <= corte ? 'op2-promedio--mal' : 'op2-promedio--bien');
        });
      },
      preparar: function (x) {
        for (var i = 0; i < crit.length; i++) { var n = Number(x[crit[i].campo]); if (!(n >= 1 && n <= 10) || Math.round(n) !== n) return 'Califica "' + crit[i].etiqueta + '" con un entero de 1 a 10.'; x[crit[i].campo] = n; }
        x.proveedor_id = p.proveedor_id;
        return x;
      },
      enviar: function (x) { return api('evaluarProveedorSgc', x); },
      aviso: function (r) {
        var d = (r && r.data) || {}, e = d.evaluacion || {};
        if (d.consecuencia === 'REUNION_MEJORA') return 'Promedio ' + e.promedio + ': reprobado. Es proveedor único: corresponde pedirle una reunión de mejora.';
        if (d.consecuencia === 'DESECHAR') return 'Promedio ' + e.promedio + ': reprobado. Corresponde dejar de comprarle (PRO-04 §6.2).';
        return 'Promedio ' + e.promedio + (e.resultado ? ' (' + e.resultado + ')' : '') + ': aprobado.';
      },
      listo: reabrir });
  }

  // --- Eventos -------------------------------------------------------------------------------
  function mio() { var c = document.getElementById('calidad-v2'); return !!c && (c.getAttribute('data-vista') === 'servicios' || c.getAttribute('data-vista') === 'proveedores'); }
  document.addEventListener('click', function (ev) {
    var raiz = document.getElementById('calidad-v2');
    if (!raiz || !raiz.contains(ev.target) || !mio()) return;
    var t = ev.target, b;
    if (t.closest('.js-op2-recargar')) { cargar(true); return; }
    // Servicios
    if (t.closest('.js-op2-prs-nueva')) { formPrestacion(); return; }
    if (t.closest('.js-op2-prs-lote')) { formLote(); return; }
    if (t.closest('.js-op2-lib-lote')) { formLiberarLote(); return; }
    if (t.closest('.js-op2-liberadores')) { formLiberadores(); return; }
    if (t.closest('.js-op2-limpiar')) { prs_.f = { periodo: '', cliente_id: '', proceso_id: '', estado: '' }; cargarPrs(true); return; }
    if ((b = t.closest('.js-op2-liberar'))) { formLiberar(prestacion(b.getAttribute('data-id'))); return; }
    if ((b = t.closest('.js-op2-noconf'))) { formNoConforme(prestacion(b.getAttribute('data-id'))); return; }
    if ((b = t.closest('.js-op2-nc'))) {
      var p = prestacion(b.getAttribute('data-id'));
      U.confirmar({ titulo: '¿Abrir una no conformidad?', texto: 'Sigue el mismo ciclo que las quejas y los hallazgos: corrección, causa raíz, acción correctiva y eficacia.', boton: 'Abrirla' }).then(function (ok) {
        if (ok) api('abrirNcPrestacionSgc', { prestacion_id: p.prestacion_id, responsable_email: p.responsable_email }).then(function (r) { if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo abrir.', 'error'); return; } PY.aviso((r.data && r.data.message) || 'No conformidad abierta.', 'exito'); cargarPrs(true); });
      });
      return;
    }
    if ((b = t.closest('.js-op2-anular'))) {
      var pa = prestacion(b.getAttribute('data-id'));
      U.confirmar({ titulo: '¿Anular esta prestación?', texto: 'Deja de contar como evidencia. Úsalo solo si se registró por error.', boton: 'Anular', peligro: true }).then(function (ok) {
        if (ok) api('anularPrestacionSgc', { prestacion_id: pa.prestacion_id }).then(function (r) { if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo anular.', 'error'); return; } PY.aviso('Prestación anulada.', 'exito'); cargarPrs(true); });
      });
      return;
    }
    // Proveedores
    if (t.closest('.js-op2-prov-nuevo')) { formProveedor(null); return; }
    if (t.closest('.js-op2-sinfiltro')) { prov_.filtro = ''; pintarProv(true); return; }
    if ((b = t.closest('.sx2-kpi--clic')) && vista_ === 'proveedores') { var f = b.getAttribute('data-filtro'); prov_.filtro = prov_.filtro === f ? '' : f; pintarProv(true); return; }
    if ((b = t.closest('[data-op2-prov]'))) abrirProv(b.getAttribute('data-op2-prov'));
  });
  document.addEventListener('change', function (ev) {
    if (ev.target.classList && ev.target.classList.contains('js-op2-f') && mio()) { prs_.f[ev.target.getAttribute('data-f')] = ev.target.value; cargarPrs(true); }
  });
  document.addEventListener('keydown', function (ev) {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('#calidad-v2 [data-op2-prov]')) { ev.preventDefault(); ev.target.click(); }
  });
  var tq_ = null;
  document.addEventListener('input', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('js-op2-q') || !mio()) return;
    var v = ev.target.value;
    clearTimeout(tq_);
    tq_ = setTimeout(function () { prov_.q = v; pintarProv(true); }, 160);
  });

  window.SigsoCalidadOperacionV2 = {
    mostrar: function (v) { vista_ = v; if (v === 'servicios') cargarPrs(!!prs_.datos && C().ocupa('servicios')); else cargarProv(!!prov_.datos && C().ocupa('proveedores')); },
    vistas: ['servicios', 'proveedores']
  };
})();
