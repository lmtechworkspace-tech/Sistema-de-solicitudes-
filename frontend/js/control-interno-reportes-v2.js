/**
 * control-interno-reportes-v2.js — los reportes de Control interno
 * (2026-10-01; datos en backend/logica/controlInternoReportes.js).
 *
 *  - informe   "Informe proceso mensual": el que Contabilidad arma a mano por
 *              matriz. Realizado por, período, resumen, detalle; PDF y Excel.
 *  - panel     Panel histórico 2022-2026: por mes, año contra año, por matriz.
 *  - cliente   Ficha por cliente: todo lo suyo en todas las matrices.
 *  - personas  Personas y tiempos: carga, días de respuesta y antigüedad de
 *              lo pendiente.
 *
 * Se dibujan con el motor común (SigsoReportes: cabecera de documento, KPIs,
 * tendencia, tablas, PDF con Chromium y Excel) para que se vean y se
 * descarguen igual que el resto de los reportes de SIGSO.
 */
(function () {
  'use strict';

  var U = UIv2;
  var R = function () { return window.SigsoReportes; };
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var x_ = null; // contexto que entrega control-interno-v2.js
  var est_ = { informe: { matriz: '', periodo: '' }, panel: { alcance: '', desde: '2022-M01', hasta: '' }, cliente: { q: '', sel: null }, personas: { depto: '', meses: 12 } };
  var turno_ = 0;

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function n(v) { return v == null || v === '' ? '—' : Number(v).toLocaleString('es-CL', { maximumFractionDigits: 1 }); }
  function pct(v) { return v == null ? '—' : v + ' %'; }
  function pesos(v) { return '$ ' + Number(v || 0).toLocaleString('es-CL', { maximumFractionDigits: 0 }); }
  function quien(k) { if (!k || k === '(sin responsable)') return 'Sin responsable'; return /^txt:/.test(k) ? x_.titulo(k.slice(4)) : x_.nombre(k); }
  function sel(cls, ops, v, aria) {
    return '<select class="sx2-select ' + cls + '" aria-label="' + U.esc(aria || '') + '">' + ops.map(function (o) {
      if (o.grupo) return '<optgroup label="' + U.esc(o.grupo) + '">' + o.ops.map(function (q) { return '<option value="' + U.esc(q[0]) + '"' + (String(q[0]) === String(v) ? ' selected' : '') + '>' + U.esc(q[1]) + '</option>'; }).join('') + '</optgroup>';
      return '<option value="' + U.esc(o[0]) + '"' + (String(o[0]) === String(v) ? ' selected' : '') + '>' + U.esc(o[1]) + '</option>';
    }).join('') + '</select>';
  }
  function opcionesMatrices(sinListas) {
    return x_.cfg.departamentos.map(function (d) {
      return { grupo: d.nombre, ops: x_.cfg.matrices.filter(function (m) { return m.depto === d.clave && (!sinListas || m.tipo !== 'lista'); }).map(function (m) { return [m.clave, m.nombre]; }) };
    });
  }
  function opcionesMeses(desde, hasta) {
    var l = [], p = hasta;
    while (p >= desde && l.length < 80) { l.push([p, x_.perTexto(p, true)]); p = x_.mover(p, -1); }
    return l;
  }
  function herramientas(html) { return '<div class="sx2-card ci2-herr sx2-entra"><div class="sx2-barra-filtros">' + html + '</div></div>'; }
  function documento(cuerpo, opts) {
    return '<div class="rp2-documento ci2-doc js-ci2-doc">' + R().barraAcciones({ volver: false }) +
      R().cabeceraDocumento(opts) + cuerpo + R().pieDocumento(opts.pie) + '</div>';
  }
  function montar(nombreArchivo) {
    var doc = x_.raiz().querySelector('.js-ci2-doc');
    if (doc) R().wireAcciones(doc, { nombreArchivo: nombreArchivo });
  }
  function seccion(titulo, cuerpo, nota) { return '<section class="ci2-rep-sec"><h2 class="rp2-sub">' + txt(titulo) + (nota ? ' <small class="sx2-tenue">' + txt(nota) + '</small>' : '') + '</h2>' + cuerpo + '</section>'; }
  function cargando(titulo, sub, filtros) { x_.pagina(x_.cabecera(x_.modNombre + ' · Reportes', titulo, sub) + (filtros || '') + U.esqueleto('kpis', 4) + U.esqueleto('tabla', 6)); }
  function fallo(titulo, r) { x_.pagina(x_.cabecera(x_.modNombre + ' · Reportes', titulo, '') + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo armar el reporte', texto: (r && r.message) || '' }) })); }

  // =========================================================================================
  // 1. Informe mensual
  // =========================================================================================
  function informe() {
    var e = est_.informe;
    if (!e.matriz || !x_.matriz(e.matriz)) { var pm = x_.cfg.matrices.filter(function (m) { return m.tipo !== 'lista'; })[0]; e.matriz = pm ? pm.clave : ''; }
    if (!e.periodo) e.periodo = x_.mover(x_.periodoActual(), -1);
    var TIT = 'Informe mensual';
    var filtros = herramientas(sel('js-cir-inf-matriz', opcionesMatrices(true), e.matriz, 'Matriz') + sel('js-cir-inf-per', opcionesMeses('2022-M01', x_.periodoActual()), e.periodo, 'Mes'));
    if (!e.matriz) { x_.pagina(x_.cabecera(x_.modNombre + ' · Reportes', TIT, '') + U.card({ cuerpo: U.vacio({ titulo: 'Sin matrices visibles' }) })); return; }
    var t = ++turno_;
    cargando(TIT, 'El informe de proceso mensual que hoy se arma a mano, de cualquier matriz y mes.', filtros);
    x_.api('informeMensualCI', { matriz: e.matriz, periodo: e.periodo }).then(function (r) {
      if (t !== turno_) return;
      if (!r || !r.ok) { fallo(TIT, r); return; }
      var d = r.data;
      x_.resolverPersonas(d.por_responsable.map(function (p) { return { email: /@/.test(p.clave) ? p.clave : '' }; }).concat(d.detalle)).then(function () {
        if (t !== turno_) return;
        var m = x_.matriz(d.matriz), s = d.resumen, a = d.anterior;
        var realizado = d.por_responsable.filter(function (p) { return p.clave !== '(sin responsable)'; }).map(function (p) { return quien(p.clave); });
        var delta = a && a.filas ? (s.avance_pct - (a.avance_pct || 0)) : null;
        var kpis = R().kpis([
          { etiqueta: 'Clientes activos', valor: n(s.clientes_activos), titulo: s.clientes_nuevos ? s.clientes_nuevos + ' nuevos este mes' : '' },
          { etiqueta: 'Clientes nuevos', valor: n(s.clientes_nuevos || 0), titulo: 'Primera vez en esta matriz' },
          { etiqueta: m.unaPorCliente ? 'Clientes pendientes de cierre' : 'Filas sin terminar', valor: n(m.unaPorCliente ? s.clientes_pendientes : s.pendientes), alerta: (m.unaPorCliente ? s.clientes_pendientes : s.pendientes) > 0 },
          { etiqueta: m.unaPorCliente ? 'Clientes cerrados' : 'Filas terminadas', valor: n(m.unaPorCliente ? s.clientes_cerrados : s.terminados) },
          { etiqueta: 'Avance del mes', valor: pct(s.avance_pct), titulo: delta == null ? '' : 'Mes anterior: ' + pct(a.avance_pct) }
        ].concat(d.sin_liberacion ? [] : [{ etiqueta: 'Por liberar', valor: n(s.por_liberar), alerta: s.por_liberar > 0 }]));
        var resumenTxt = '<p class="ci2-rep-linea">' + txt(m.nombre) + ' de ' + txt(x_.perTexto(d.periodo, true)) + ': <b>' + n(s.filas) + '</b> ' + (s.filas === 1 ? 'fila' : 'filas') + ' de <b>' + n(s.clientes_activos) + '</b> clientes; ' +
          '<b>' + pct(s.avance_pct) + '</b> terminado' + (a && a.filas ? ' (el mes anterior, ' + pct(a.avance_pct) + ' de ' + n(a.filas) + ')' : '') + '.' +
          (s.liberados ? ' ' + n(s.liberados) + ' liberadas.' : '') +
          (s.clientes_nuevos ? ' Clientes nuevos: <b>' + n(s.clientes_nuevos) + '</b> (' + txt(d.clientes_nuevos.slice(0, 6).join(', ')) + (d.clientes_nuevos.length > 6 ? '…' : '') + ').' : '') + '</p>';
        var porEstado = R().ranking(m.estados.map(function (es) { return { etiqueta: es.etiqueta, valor: s.por_estado[es.clave] || 0, tono: es.tono === 'ok' ? 'ok' : (es.tono === 'alerta' ? 'alerta' : (es.tono === 'critico' ? 'critico' : 'primario')) }; }).filter(function (f) { return f.valor; }), { max: s.filas, sinPosicion: true });
        var montos = d.montos.length ? seccion('Montos del mes', R().tabla([{ titulo: 'Concepto', campo: 'c' }, { titulo: 'Total', campo: 't', alinear: 'derecha' }, { titulo: 'Filas con monto', campo: 'n', alinear: 'derecha' }],
          d.montos.map(function (x) { return { c: x.etiqueta, t: pesos(x.total), n: n(x.casos) }; }), { id: 'cir-montos' })) : '';
        var tiempos = d.tiempos && d.tiempos.casos ? seccion('Días de respuesta', '<p class="ci2-rep-linea">De “' + txt(d.tiempos.desde) + '” a “' + txt(d.tiempos.hasta) + '”: <b>' + n(d.tiempos.promedio) + '</b> días en promedio (mediana ' + n(d.tiempos.mediana) + ', máximo ' + n(d.tiempos.maximo) + ', ' + n(d.tiempos.casos) + ' casos).</p>' +
          R().ranking(d.tiempos.tramos.map(function (x) { return { etiqueta: x.etiqueta, valor: x.casos }; }), { max: d.tiempos.casos, sinPosicion: true })) : '';
        var resp = seccion('Por responsable', R().tabla([{ titulo: 'Responsable', campo: 'p' }, { titulo: 'Filas', campo: 't', alinear: 'derecha' }, { titulo: 'Terminadas', campo: 'f', alinear: 'derecha' }, { titulo: 'Sin terminar', campo: 'q', alinear: 'derecha' }],
          d.por_responsable.map(function (p) { return { p: quien(p.clave), t: n(p.total), f: n(p.terminados), q: n(p.pendientes) }; }), { id: 'cir-resp' }));
        var detalle = seccion('Detalle del período', R().tabla([{ titulo: 'Empresa', campo: 'e' }, { titulo: 'RUT', campo: 'r' }, { titulo: 'Realizado por', campo: 'q' }, { titulo: 'Proceso', campo: 's', html: true }].concat(d.sin_liberacion ? [] : [{ titulo: 'Liberado por', campo: 'l' }]),
          d.detalle.map(function (f) {
            var es = m.estados.filter(function (k) { return k.clave === f.estado; })[0] || { etiqueta: f.estado, tono: 'neutro' };
            return { e: f.cliente_nombre + (f.fuera_catalogo ? ' *' : '') + (f.nuevo ? ' (nuevo)' : ''), r: f.cliente_rut, q: f.responsable_email ? x_.nombre(f.responsable_email) : x_.titulo(f.responsable_texto) || '—', s: U.badge(es.etiqueta, es.tono), l: f.liberado_por ? x_.nombre(f.liberado_por) : '' };
          }), { id: 'cir-detalle' }), d.detalle.some(function (f) { return f.fuera_catalogo; }) ? '* fuera del catálogo de clientes' : '');
        var cuerpo = R().nivel('En una línea', resumenTxt) + kpis +
          R().nivel('Resumen del período', '<div class="ci2-rep-2">' + seccion('Situación de las filas', porEstado) + resp + '</div>' + montos + tiempos) +
          R().nivel('Detalle', detalle);
        x_.pagina(x_.cabecera(x_.modNombre + ' · Reportes', TIT, 'El informe de proceso mensual que hoy se arma a mano, de cualquier matriz y mes.') + filtros +
          documento(cuerpo, { titulo: 'Informe proceso mensual · ' + m.nombre, subtitulo: x_.depto(m.depto).nombre + ' · ' + m.seccion, codigo: m.codigo, modulo: x_.modNombre,
            periodo: x_.perTexto(d.periodo, true), generadoPor: realizado.length ? 'Realizado por: ' + realizado.join(', ') : '' }));
        montar('Informe ' + m.nombre + ' ' + x_.perTexto(d.periodo));
      });
    });
  }

  // =========================================================================================
  // 2. Panel histórico
  // =========================================================================================
  function panel() {
    var e = est_.panel;
    if (!e.hasta) e.hasta = x_.periodoActual();
    if (!e.alcance) e.alcance = 'd:' + (x_.cfg.departamentos[0] || {}).clave;
    var TIT = 'Panel histórico';
    var alcances = x_.cfg.departamentos.map(function (d) { return ['d:' + d.clave, d.nombre + ' (todas)']; });
    var ops = [{ grupo: 'Departamento', ops: alcances }].concat(opcionesMatrices(true).map(function (g) { return { grupo: g.grupo, ops: g.ops.map(function (o) { return ['m:' + o[0], o[1]]; }) }; }));
    var anios = []; for (var a = Number(x_.periodoActual().slice(0, 4)); a >= 2022; a--) anios.push([String(a) + '-M01', 'Desde ' + a]);
    var filtros = herramientas(sel('js-cir-pan-alc', ops, e.alcance, 'Qué mirar') + sel('js-cir-pan-desde', anios, e.desde, 'Desde'));
    var t = ++turno_;
    cargando(TIT, 'Cómo vienen los procesos mes a mes desde 2022: volumen, cierre, montos y tiempos.', filtros);
    var p = { desde: e.desde, hasta: e.hasta };
    if (/^m:/.test(e.alcance)) p.matriz = e.alcance.slice(2); else p.depto = e.alcance.slice(2);
    x_.api('panelHistoricoCI', p).then(function (r) {
      if (t !== turno_) return;
      if (!r || !r.ok) { fallo(TIT, r); return; }
      var d = r.data;
      // Desde el primer mes con datos (los vacíos del comienzo no aportan).
      var k0 = 0; while (k0 < d.serie.length - 1 && !d.serie[k0].total) k0++;
      var serie = d.serie.slice(k0);
      var tot = serie.reduce(function (o, s) { o.f += s.total; o.t += s.terminados; return o; }, { f: 0, t: 0 });
      var ult = serie[serie.length - 1] || {}, pen = serie[serie.length - 2] || {};
      var nombreAlc = p.matriz ? x_.matriz(p.matriz).nombre : x_.depto(p.depto).nombre;
      var kpis = R().kpis([
        { etiqueta: 'Filas en el período', valor: n(tot.f) },
        { etiqueta: 'Terminado (total)', valor: pct(tot.f ? Math.round(100 * tot.t / tot.f) : null) },
        { etiqueta: 'Último mes cerrado', valor: pct(pen.avance_pct), titulo: pen.periodo ? x_.perTexto(pen.periodo, true) : '' },
        { etiqueta: 'Mes en curso', valor: n(ult.total) + ' filas', titulo: ult.periodo ? x_.perTexto(ult.periodo, true) : '' }
      ]);
      var etq = function (per) { return MESES[Number(per.slice(6, 8)) - 1] + ' ' + per.slice(2, 4); };
      // Las curvas terminan en el último mes cerrado: el mes en curso, a medio registrar, dibujaba una caída falsa (auditoría A5).
      var cerrados = serie.filter(function (s) { return s.periodo < x_.periodoActual(); });
      var hastaK = function (per) { return per < x_.periodoActual(); };
      var volumen = seccion('Filas por mes', R().tendencia(cerrados.map(function (s) { return { etiqueta: etq(s.periodo), valor: s.total }; }), { titulo: 'Filas por mes' }));
      var cierre = seccion('% terminado por mes', R().tendencia(cerrados.filter(function (s) { return s.total; }).map(function (s) { return { etiqueta: etq(s.periodo), valor: s.avance_pct }; }), { titulo: '% terminado', meta: 90 }), 'meta 90 %');
      var yoy = seccion('Año contra año (filas por mes)', '<div class="sx2-tabla-wrap rp2-tabla"><table class="sx2-tabla" id="cir-yoy"><thead><tr><th>Año</th>' + MESES.map(function (mm) { return '<th class="sx2-num">' + mm + '</th>'; }).join('') + '<th class="sx2-num">Total</th></tr></thead><tbody>' +
        d.anio_contra_anio.filter(function (a2) { return a2.meses.some(function (v) { return v; }); }).map(function (a2) {
          var s = a2.meses.reduce(function (x, v) { return x + (v || 0); }, 0);
          return '<tr><td><b>' + txt(a2.anio) + '</b></td>' + a2.meses.map(function (v) { return '<td class="sx2-num">' + (v == null ? '' : n(v)) + '</td>'; }).join('') + '<td class="sx2-num"><b>' + n(s) + '</b></td></tr>';
        }).join('') + '</tbody></table></div>');
      var porMatriz = d.matrices.length > 1 ? seccion('Por matriz', R().tabla([{ titulo: 'Matriz', campo: 'm' }, { titulo: 'Filas', campo: 'f', alinear: 'derecha' }, { titulo: 'Clientes', campo: 'c', alinear: 'derecha' }, { titulo: 'Terminado', campo: 'p', alinear: 'derecha' }, { titulo: 'Sin terminar', campo: 'q', alinear: 'derecha' }, { titulo: 'Último mes', campo: 'u' }],
        d.matrices.map(function (x) { return { m: x.nombre, f: n(x.filas), c: n(x.clientes), p: pct(x.avance_pct), q: n(x.pendientes), u: x.ultimo_periodo ? x_.perTexto(x.ultimo_periodo) : '' }; }), { id: 'cir-matrices' })) : '';
      var extra = '';
      if (d.detalle_matriz) {
        var dm = d.detalle_matriz;
        extra = dm.montos.map(function (mo) {
          var pts = d.meses.slice(k0).map(function (per, i) { return { per: per, etiqueta: etq(per), valor: Math.round(mo.por_mes[k0 + i] || 0) }; }).filter(function (q) { return hastaK(q.per); });
          return seccion(mo.etiqueta + ' por mes', R().tendencia(pts, { titulo: mo.etiqueta }));
        }).join('') +
          (dm.tiempos ? seccion('Días de respuesta promedio por mes', R().tendencia(d.meses.slice(k0).map(function (per, i) { return { per: per, etiqueta: etq(per), valor: dm.tiempos.por_mes[k0 + i] }; }).filter(function (q) { return q.valor !== null && hastaK(q.per); }), { titulo: 'Días promedio' })) : '') +
          seccion('Clientes con filas por mes', R().tendencia(d.meses.slice(k0).map(function (per, i) { return { per: per, etiqueta: etq(per), valor: dm.clientes_por_mes[k0 + i] }; }).filter(function (q) { return hastaK(q.per); }), { titulo: 'Clientes' }));
      }
      var cuerpo = kpis + R().nivel('Tendencia', '<div class="ci2-rep-2">' + volumen + cierre + '</div>') + R().nivel('Año contra año', yoy) + (porMatriz ? R().nivel('Detalle por matriz', porMatriz) : '') + (extra ? R().nivel('Montos y tiempos', '<div class="ci2-rep-2">' + extra + '</div>') : '');
      x_.pagina(x_.cabecera(x_.modNombre + ' · Reportes', TIT, 'Cómo vienen los procesos mes a mes desde 2022: volumen, cierre, montos y tiempos.') + filtros +
        documento(cuerpo, { titulo: 'Panel histórico · ' + nombreAlc, modulo: x_.modNombre, periodo: x_.perTexto(serie[0] ? serie[0].periodo : d.desde, true) + ' a ' + x_.perTexto(d.hasta, true) }));
      montar('Panel histórico ' + nombreAlc);
    });
  }

  // =========================================================================================
  // 3. Ficha por cliente
  // =========================================================================================
  function cliente() {
    var e = est_.cliente;
    var TIT = 'Ficha por cliente';
    var buscador = herramientas('<input class="sx2-input js-cir-cli-q" type="search" placeholder="Busca el cliente por nombre o RUT…" value="' + U.esc(e.q) + '" aria-label="Buscar cliente" autocomplete="off">' +
      '<span class="sx2-tenue">Todo lo del cliente en las matrices de Contabilidad y RR.HH., desde 2022.</span>');
    if (!e.sel) {
      x_.pagina(x_.cabecera(x_.modNombre + ' · Reportes', TIT, 'Elige un cliente para ver su historia completa.') + buscador + '<div class="js-cir-cli-res"></div>');
      buscarClientes(e.q);
      var q = x_.raiz().querySelector('.js-cir-cli-q'); if (q) q.focus();
      return;
    }
    var t = ++turno_;
    cargando(TIT, '', buscador);
    x_.api('fichaClienteCI', e.sel).then(function (r) {
      if (t !== turno_) return;
      if (!r || !r.ok) { fallo(TIT, r); return; }
      var d = r.data;
      x_.resolverPersonas(d.pendientes).then(function () {
        if (t !== turno_) return;
        var pend = d.matrices.reduce(function (s, m) { return s + m.pendientes; }, 0);
        var kpis = R().kpis([
          { etiqueta: 'Filas en el módulo', valor: n(d.total_filas) },
          { etiqueta: 'Matrices donde aparece', valor: n(d.matrices.length) },
          { etiqueta: 'Sin terminar', valor: n(pend), alerta: pend > 0 },
          { etiqueta: 'Cliente desde', valor: d.desde ? x_.perTexto(d.desde) : '—' }
        ]);
        var tabla = d.deptos.map(function (dp) {
          return seccion(dp.nombre, R().tabla([{ titulo: 'Matriz', campo: 'm' }, { titulo: 'Filas', campo: 'f', alinear: 'derecha' }, { titulo: 'Últimos 12 meses', campo: 'u12', alinear: 'derecha' }, { titulo: 'Sin terminar', campo: 'p', alinear: 'derecha' }, { titulo: 'Último mes', campo: 'u' }, { titulo: 'Última situación', campo: 's' }],
            d.matrices.filter(function (m) { return m.depto === dp.clave; }).map(function (m) { return { m: m.nombre, f: n(m.filas), u12: n(m.ultimos_12), p: n(m.pendientes), u: m.ultimo_periodo ? x_.perTexto(m.ultimo_periodo) : (m.tipo === 'lista' ? 'lista' : ''), s: m.ultima_situacion_texto }; }), { id: 'cir-cli-' + dp.clave }));
        }).join('');
        var anios = {};
        d.matrices.forEach(function (m) { m.montos.forEach(function (mo) { Object.keys(mo.por_anio).forEach(function (a) { anios[a] = true; }); }); });
        var la = Object.keys(anios).sort();
        var montos = la.length ? seccion('Montos por año', '<div class="sx2-tabla-wrap rp2-tabla"><table class="sx2-tabla" id="cir-cli-montos"><thead><tr><th>Concepto</th>' + la.map(function (a) { return '<th class="sx2-num">' + a + '</th>'; }).join('') + '</tr></thead><tbody>' +
          d.matrices.map(function (m) { return m.montos.map(function (mo) { return '<tr><td>' + txt(m.nombre + ' · ' + mo.etiqueta) + '</td>' + la.map(function (a) { return '<td class="sx2-num">' + (mo.por_anio[a] ? pesos(mo.por_anio[a]) : '') + '</td>'; }).join('') + '</tr>'; }).join(''); }).join('') + '</tbody></table></div>') : '';
        var act = seccion('Actividad de los últimos 24 meses', R().tendencia(d.actividad.map(function (a) { return { etiqueta: MESES[Number(a.periodo.slice(6, 8)) - 1] + ' ' + a.periodo.slice(2, 4), valor: a.filas }; }), { titulo: 'Filas por mes' }));
        var pendientes = seccion('Lo que está sin terminar', R().tabla([{ titulo: 'Matriz', campo: 'm' }, { titulo: 'Mes', campo: 'p' }, { titulo: 'Situación', campo: 's' }, { titulo: 'Responsable', campo: 'r' }],
          d.pendientes.map(function (x) { return { m: x.matriz_nombre, p: x_.perTexto(x.periodo), s: x.estado_texto, r: x.responsable_email ? x_.nombre(x.responsable_email) : '—' }; }), { id: 'cir-cli-pend', vacio: 'Nada pendiente.' }));
        var cuerpo = kpis + R().nivel('Lo que requiere atención', pendientes) + R().nivel('Por matriz', tabla) + R().nivel('Historia', act + montos);
        x_.pagina(x_.cabecera(x_.modNombre + ' · Reportes', TIT, '', '<button type="button" class="sx2-boton sx2-boton--fantasma js-cir-cli-otro">Otro cliente</button>') + buscador +
          documento(cuerpo, { titulo: d.cliente_nombre, subtitulo: (d.cliente_rut ? 'RUT ' + d.cliente_rut + ' · ' : '') + (d.fuera_catalogo ? 'No está en el catálogo de clientes de SIGSO' : 'Cliente del catálogo'), modulo: x_.modNombre + ' · Ficha por cliente' }));
        montar('Ficha ' + d.cliente_nombre);
      });
    });
  }
  var tq_ = null;
  function buscarClientes(q) {
    clearTimeout(tq_);
    tq_ = setTimeout(function () {
      x_.api('buscarClientesCI', { q: q }).then(function (r) {
        var cont = x_.raiz().querySelector('.js-cir-cli-res');
        if (!cont || !r || !r.ok) return;
        var l = r.data.clientes;
        cont.innerHTML = l.length ? '<div class="ci2-cli-lista sx2-entra">' + l.map(function (c) {
          return '<button type="button" class="ci2-cli-item js-cir-cli-elegir" data-id="' + U.esc(c.cliente_id) + '" data-nombre="' + U.esc(c.cliente_nombre) + '"><b>' + txt(c.cliente_nombre) + '</b><span class="sx2-tenue">' + txt(c.cliente_rut || (c.cliente_id ? '' : 'fuera del catálogo')) + '</span><span class="ci2-cli-item__n">' + n(c.filas) + ' filas</span></button>';
        }).join('') + '</div>' : U.vacio({ icono: 'lupa', titulo: 'Ningún cliente calza', texto: 'Prueba con otra parte del nombre o el RUT.' });
      });
    }, q ? 250 : 0);
  }

  // =========================================================================================
  // 4. Personas y tiempos
  // =========================================================================================
  function personas() {
    var e = est_.personas;
    if (!e.depto) e.depto = (x_.cfg.departamentos[0] || {}).clave || '';
    var TIT = 'Personas y tiempos';
    var filtros = herramientas(sel('js-cir-per-depto', x_.cfg.departamentos.map(function (d) { return [d.clave, d.nombre]; }), e.depto, 'Departamento') +
      sel('js-cir-per-meses', [[3, 'Últimos 3 meses'], [6, 'Últimos 6 meses'], [12, 'Últimos 12 meses'], [24, 'Últimos 24 meses'], [48, 'Desde 2022']], e.meses, 'Rango'));
    var t = ++turno_;
    cargando(TIT, 'Quién hace qué, cuánto demora y qué quedó sin terminar.', filtros);
    var hasta = x_.periodoActual();
    x_.api('personasTiemposCI', { depto: e.depto, desde: x_.mover(hasta, -(e.meses - 1)), hasta: hasta }).then(function (r) {
      if (t !== turno_) return;
      if (!r || !r.ok) { fallo(TIT, r); return; }
      var d = r.data;
      x_.resolverPersonas(d.personas.map(function (p) { return { email: /@/.test(p.clave) ? p.clave : '' }; })).then(function () {
        if (t !== turno_) return;
        var tot = d.personas.reduce(function (o, p) { o.t += p.total; o.f += p.terminados; return o; }, { t: 0, f: 0 });
        var viejos = d.tramos_pendientes.filter(function (x) { return /180/.test(x.etiqueta) && /Más/.test(x.etiqueta); })[0];
        var kpis = R().kpis([
          { etiqueta: 'Filas en el rango', valor: n(tot.t) },
          { etiqueta: 'Personas con filas', valor: n(d.personas.filter(function (p) { return p.clave !== '(sin responsable)'; }).length) },
          { etiqueta: 'Sin terminar', valor: n(d.total_pendientes), alerta: d.total_pendientes > 0 },
          { etiqueta: 'Sin terminar hace más de 180 días', valor: n(viejos ? viejos.casos : 0), alerta: viejos && viejos.casos > 0 }
        ]);
        var tablaP = seccion('Por persona', R().tabla([{ titulo: 'Persona', campo: 'p' }, { titulo: 'Filas', campo: 't', alinear: 'derecha' }, { titulo: 'Terminado', campo: 'a', alinear: 'derecha' }, { titulo: 'Sin terminar', campo: 'q', alinear: 'derecha' }, { titulo: 'Días de respuesta (prom.)', campo: 'd', alinear: 'derecha' }, { titulo: 'Donde más trabaja', campo: 'm' }],
          d.personas.map(function (p) { return { p: quien(p.clave), t: n(p.total), a: pct(p.avance_pct), q: n(p.pendientes), d: p.casos_tiempo ? n(p.dias_promedio) : '—', m: p.matrices.slice(0, 2).map(function (x) { return x.nombre + ' (' + x.filas + ')'; }).join(', ') }; }), { id: 'cir-personas' }));
        var carga = seccion('Carga por persona (filas)', R().ranking(d.personas.slice(0, 12).map(function (p) { return { etiqueta: quien(p.clave), valor: p.total }; })));
        var tiempos = seccion('Días de respuesta por matriz', d.tiempos.length ? R().tabla([{ titulo: 'Matriz', campo: 'm' }, { titulo: 'Se mide', campo: 's' }, { titulo: 'Promedio', campo: 'p', alinear: 'derecha' }, { titulo: 'Mediana', campo: 'me', alinear: 'derecha' }, { titulo: 'Máximo', campo: 'mx', alinear: 'derecha' }, { titulo: 'Casos', campo: 'c', alinear: 'derecha' }],
          d.tiempos.map(function (x) { return { m: x.nombre, s: x.desde + ' → ' + x.hasta, p: n(x.promedio), me: n(x.mediana), mx: n(x.maximo), c: n(x.casos) }; }), { id: 'cir-tiempos' }) : '<p class="sx2-tenue">No hay filas con las dos fechas en este rango.</p>');
        var antig = seccion('Antigüedad de lo sin terminar', R().ranking(d.tramos_pendientes.map(function (x) { return { etiqueta: x.etiqueta, valor: x.casos, tono: /180/.test(x.etiqueta) && /Más/.test(x.etiqueta) ? 'critico' : (/91/.test(x.etiqueta) ? 'alerta' : 'primario') }; }), { max: d.total_pendientes || 1, sinPosicion: true }));
        var viejosT = seccion('Lo más antiguo sin terminar', R().tabla([{ titulo: 'Días', campo: 'd', alinear: 'derecha' }, { titulo: 'Matriz', campo: 'm' }, { titulo: 'Mes', campo: 'p' }, { titulo: 'Cliente', campo: 'c' }, { titulo: 'Responsable', campo: 'r' }, { titulo: 'Situación', campo: 's' }],
          d.pendientes_antiguos.map(function (x) { return { d: n(x.dias), m: x.matriz_nombre, p: x_.perTexto(x.periodo), c: x.cliente_nombre, r: quien(x.responsable), s: x.estado_texto }; }), { id: 'cir-antiguos', vacio: 'Nada pendiente.' }));
        var malas = (d.fechas_invalidas || []).length ? seccion('Fechas para corregir', R().tabla([{ titulo: 'Matriz', campo: 'm' }, { titulo: 'Mes', campo: 'p' }, { titulo: 'Cliente', campo: 'c' }, { titulo: 'Fecha escrita', campo: 'f' }],
          d.fechas_invalidas.map(function (x) { return { m: x.matriz_nombre, p: x_.perTexto(x.periodo), c: x.cliente_nombre, f: x.fecha }; }), { id: 'cir-fechas' }), 'Tienen un año imposible: no se usan para la antigüedad hasta corregirlas') : '';
        var cuerpo = kpis + R().nivel('Lo que requiere atención', '<div class="ci2-rep-2">' + antig + viejosT + '</div>') + R().nivel('Personas', '<div class="ci2-rep-2">' + carga + tiempos + '</div>' + tablaP) + (malas ? R().nivel('Calidad del dato', malas) : '');
        x_.pagina(x_.cabecera(x_.modNombre + ' · Reportes', TIT, 'Quién hace qué, cuánto demora y qué quedó sin terminar.') + filtros +
          documento(cuerpo, { titulo: 'Personas y tiempos · ' + x_.depto(e.depto).nombre, modulo: x_.modNombre, periodo: x_.perTexto(d.desde, true) + ' a ' + x_.perTexto(d.hasta, true) }));
        montar('Personas y tiempos ' + x_.depto(e.depto).nombre);
      });
    });
  }

  // =========================================================================================
  // Eventos y API
  // =========================================================================================
  function mio(ev) { var c = x_ && x_.raiz(); return !!c && c.contains(ev.target); }
  document.addEventListener('change', function (ev) {
    if (!mio(ev) || !x_) return;
    var t = ev.target;
    if (t.classList.contains('js-cir-inf-matriz')) { est_.informe.matriz = t.value; informe(); }
    else if (t.classList.contains('js-cir-inf-per')) { est_.informe.periodo = t.value; informe(); }
    else if (t.classList.contains('js-cir-pan-alc')) { est_.panel.alcance = t.value; panel(); }
    else if (t.classList.contains('js-cir-pan-desde')) { est_.panel.desde = t.value; panel(); }
    else if (t.classList.contains('js-cir-per-depto')) { est_.personas.depto = t.value; personas(); }
    else if (t.classList.contains('js-cir-per-meses')) { est_.personas.meses = Number(t.value) || 12; personas(); }
  });
  document.addEventListener('input', function (ev) {
    if (!mio(ev) || !x_ || !ev.target.classList.contains('js-cir-cli-q')) return;
    est_.cliente.q = ev.target.value;
    if (est_.cliente.sel) { est_.cliente.sel = null; cliente(); var q = x_.raiz().querySelector('.js-cir-cli-q'); if (q) { q.value = est_.cliente.q; q.focus(); } return; }
    buscarClientes(ev.target.value);
  });
  document.addEventListener('click', function (ev) {
    if (!mio(ev) || !x_) return;
    var b;
    if ((b = ev.target.closest('.js-cir-cli-elegir'))) { est_.cliente.sel = { cliente_id: b.getAttribute('data-id'), cliente_nombre: b.getAttribute('data-nombre') }; cliente(); }
    else if (ev.target.closest('.js-cir-cli-otro')) { est_.cliente.sel = null; cliente(); }
  });

  window.SigsoCIReportes = {
    mostrar: function (vista, ctx) {
      x_ = ctx;
      if (vista === 'panel') panel();
      else if (vista === 'cliente') cliente();
      else if (vista === 'personas') personas();
      else informe();
    },
    // Desde una matriz: "informe de este mes".
    prefijar: function (o) { if (o && o.matriz) est_.informe.matriz = o.matriz; if (o && /^\d{4}-M\d{2}$/.test(o.periodo || '')) est_.informe.periodo = o.periodo; }
  };
})();
