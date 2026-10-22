/**
 * finanzas-hoja-v4.js — La planilla del banco (Finanzas v4, 22-10-2026; backend/logica/finanzasHoja.js).
 *
 * Se llena como el Excel BANCOS: una hoja por cuenta y mes, celdas que se escriben con el teclado
 * (Enter, Tab, flechas, Supr) y filas que se pegan desde Excel. Columnas: fecha, nombre, OBS, plan de
 * cuenta, monto (+ entra / − sale), grupo (la letra reemplaza la fórmula de UNITARIO) y N° de factura.
 * Lo que trae la cartola y nadie anotó aparece en naranjo dentro de la misma hoja.
 *
 * Arriba, el resumen como en el Excel (ABONO, ABONO RENTA, gastos, SALDO, PENDIENTE, TOTAL) y el banco.
 * Además, tres reportes que salen solos de la hoja: FLUJO (como SIGECO), saldo por cliente y cobranza.
 */
(function () {
  'use strict';

  var U = UIv2;
  var x_ = null, cat_ = null;
  var est_ = { periodo: '', cuenta: '', datos: null, sel: { r: 0, c: 1 }, editando: null, borrador: {}, guardando: false, filtro: 'todas', busca: '' };
  document.addEventListener('sigso-fin-cerrada', function () { est_.datos = null; est_.borrador = {}; });

  var COLS = [['fecha', 'Fecha'], ['nombre', 'Nombre'], ['obs', 'OBS'], ['plan', 'Plan de cuenta'], ['monto', 'Monto'], ['grupo', 'Grupo'], ['fact', 'N° factura'], ['glosa', 'Detalle banco']];
  var ATAJO_OBS = { A: 'ABONO', R: 'ABONO RENTA', I: 'IVA', M: 'IMPOSICIONES', S: 'SALDO', P: 'PENDIENTE' };
  var AYUDA_OBS = { ABONO: 'honorario si entra · gasto si sale', 'ABONO RENTA': 'honorario de renta', IVA: 'plata del cliente para su IVA', IMPOSICIONES: 'plata del cliente para imposiciones', SALDO: 'plata del cliente a su favor', PENDIENTE: 'plata del cliente por resolver' };
  var QUE_TONO = { ing: 'ok', gas: 'critico', fon: 'info', tra: 'neutro', rev: 'alerta', falta: 'alerta' };
  var DECIS = [['PENDIENTE', 'PENDIENTE · sigue abierto'], ['ABONO', 'ABONO · se cobra como honorario'], ['ABONO RENTA', 'ABONO RENTA · honorario de renta'], ['SALDO', 'SALDO · queda a favor del cliente']];
  var MESES_ = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function plata(n, cero) { var v = Math.round(Number(n) || 0); if (!v && cero !== undefined) return cero; return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('es-CL'); }
  function corta(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '-' + p[1] : ''; }
  function mesCorto(p) { var a = String(p || '').split('-'); return a.length === 2 ? MESES_[Number(a[1]) - 1].slice(0, 3) + ' ' + a[0].slice(2) : p; }
  function mesLargo(p) { var a = String(p || '').split('-'); return a.length === 2 ? MESES_[Number(a[1]) - 1] + ' ' + a[0] : p; }
  function hoy() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
  function leerMonto(s) { var t = String(s == null ? '' : s).replace(/\s|\$|CLP/gi, ''); var neg = /^\(.*\)$/.test(t) || /^[-−]/.test(t); t = t.replace(/[()\-−+]/g, '').replace(/\./g, '').replace(',', '.'); if (!t || isNaN(Number(t))) return null; var n = Math.round(Number(t)); return neg ? -n : n; }
  function leerFecha(s, mes) {
    var t = String(s || '').trim(), m;
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    if ((m = /^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/.exec(t))) { var a = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : mes.slice(0, 4); return a + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2); }
    if ((m = /^(\d{1,2})$/.exec(t)) && Number(m[1]) >= 1 && Number(m[1]) <= 31) return mes + '-' + ('0' + m[1]).slice(-2);
    return null;
  }
  function puede(cap) { return !!(cat_ && (cat_.capacidades || []).indexOf(cap) !== -1); }
  function error(r, msg) { x_.aviso((r && r.message) || msg, 'error'); }
  function norm(s) { return String(s == null ? '' : s).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function iniciales(n) { var p = String(n || '?').replace(/\b(SPA|LTDA|S\.?A\.?|EIRL|Y|DE|DEL|LA|EL)\b/gi, ' ').trim().split(/\s+/); return ((p[0] || '?')[0] + ((p[1] || '')[0] || '')).toUpperCase(); }

  // ---- movimiento: cifras que corren, barras que crecen, el indicador de mes que se desliza --------------
  // Cada valor recuerda el anterior (por clave): al corregir una fila, los totales corren desde lo que había.
  var CIRC = 213.63; // 2πr del anillo (r = 34)
  var previo_ = {}, indPrev_ = null;
  function reducido() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function crece(clave, pct, prop) {
    pct = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    var a = previo_['c|' + clave]; previo_['c|' + clave] = pct;
    if (a === undefined || reducido()) a = reducido() ? pct : 0;
    var ini = prop === 'anillo' ? 'stroke-dashoffset:' + (CIRC * (1 - a / 100)).toFixed(2) : prop + ':' + a + '%';
    return ' style="' + ini + '" data-crece="' + prop + '" data-v="' + pct + '"';
  }
  function cuenta(clave, v, fmt) {
    return '<span class="fin5-num" data-clave="' + txt(clave) + '" data-fin="' + (Number(v) || 0) + '" data-fmt="' + (fmt || '$') + '">' + formatear(fmt || '$', Number(v) || 0) + '</span>';
  }
  function formatear(fmt, v) { return fmt === 'n' ? String(Math.round(v)) : fmt === '%' ? Math.round(v) + '%' : plata(v); }
  function activar(raiz) {
    if (!raiz) return;
    var red = reducido();
    Array.prototype.forEach.call(raiz.querySelectorAll('.fin5-num[data-clave]'), function (el) {
      var clave = 'n|' + el.getAttribute('data-clave'), fin = Number(el.getAttribute('data-fin')) || 0, fmt = el.getAttribute('data-fmt');
      var ini = previo_[clave]; previo_[clave] = fin;
      if (ini === fin) return;
      var card = el.closest('.fin5-kpi'); if (card && ini !== undefined) { card.classList.remove('fin5-pulso'); void card.offsetWidth; card.classList.add('fin5-pulso'); }
      if (red) return;
      if (ini === undefined) ini = 0;
      var t0 = 0, dur = 750;
      function paso(t) { if (!t0) t0 = t; var q = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - q, 3); el.textContent = formatear(fmt, ini + (fin - ini) * e); if (q < 1 && el.isConnected) requestAnimationFrame(paso); else el.textContent = formatear(fmt, fin); }
      el.textContent = formatear(fmt, ini);
      requestAnimationFrame(paso);
    });
    var crecen = raiz.querySelectorAll('[data-crece]');
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      Array.prototype.forEach.call(crecen, function (el) {
        var v = Number(el.getAttribute('data-v')), prop = el.getAttribute('data-crece');
        if (prop === 'anillo') el.style.strokeDashoffset = (CIRC * (1 - v / 100)).toFixed(2); else el.style[prop] = v + '%';
      });
    }); });
    moverIndicador(raiz);
  }
  function moverIndicador(raiz) {
    var cont = raiz.querySelector('.fin5-meses'); if (!cont) return;
    var ind = cont.querySelector('.fin5-meses__ind'), sel = cont.querySelector('[aria-selected="true"]'); if (!ind || !sel) return;
    var fin = { x: sel.offsetLeft, w: sel.offsetWidth };
    if (indPrev_ && !reducido()) { ind.style.transition = 'none'; ind.style.transform = 'translateX(' + indPrev_.x + 'px)'; ind.style.width = indPrev_.w + 'px'; void ind.offsetWidth; ind.style.transition = ''; }
    ind.style.transform = 'translateX(' + fin.x + 'px)'; ind.style.width = fin.w + 'px'; ind.style.opacity = '1';
    indPrev_ = fin;
  }
  function kpi(o, i) {
    var v = o.v;
    return '<article class="fin5-kpi fin5-kpi--' + (o.tono || 'neutro') + ' fin5-entra" style="--i:' + i + '">' +
      '<div class="fin5-kpi__cab"><span class="fin5-kpi__ico">' + U.ico(o.ico || 'dinero', 16) + '</span><span class="fin5-kpi__t">' + txt(o.t) + '</span></div>' +
      '<b class="fin5-kpi__v' + (typeof v === 'number' && v < 0 ? ' fin2-neg' : '') + '">' + (v === null || v === undefined ? txt(o.vacio || '—') : cuenta(o.clave, v, o.fmt)) + '</b>' +
      (o.barra || '') + (o.sub ? '<small class="fin5-kpi__sub">' + txt(o.sub) + '</small>' : '') + '</article>';
  }
  function vacioHtml(ico, titulo, texto, accion) { return '<div class="fin5-vacio fin5-entra"><span class="fin5-vacio__ico">' + U.ico(ico, 26) + '</span><h3>' + txt(titulo) + '</h3><p>' + txt(texto) + '</p>' + (accion || '') + '</div>'; }

  // La planilla del mes (filas, resumen y grupos) en Excel, como la hoja BANCOS.
  function descargarExcel(b) {
    b.disabled = true;
    x_.api('finanzasExportar', { tipo: 'planilla', formato: 'xlsx', filtros: { periodo: est_.periodo, cuenta_ref: est_.cuenta } }).then(function (r) {
      b.disabled = false;
      if (!r || !r.ok) { error(r, 'No se pudo descargar.'); return; }
      var bin = atob(r.data.base64), u = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([u], { type: r.data.mime }));
      var a = document.createElement('a'); a.href = url; a.download = r.data.nombre; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    });
  }

  // =====================================================================================
  //  La planilla
  // =====================================================================================
  function ver(x) {
    x_ = x; enlazar();
    var c = x.contexto();
    est_.periodo = c.periodo_hoja || est_.periodo || '';
    est_.cuenta = c.cuenta_ref || est_.cuenta || '';
    est_.editando = null;
    var t = x.turno();
    x.pagina(x.cab('planilla') + U.esqueleto('tabla', 14));
    Promise.all([x.catalogo(), x.api('finanzasHoja', { periodo: est_.periodo, cuenta_ref: est_.cuenta })]).then(function (rs) {
      if (!x.vigente(t)) return;
      cat_ = rs[0];
      var r = rs[1];
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('planilla') + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo abrir la planilla', texto: (r && r.message) || '', accion: '<button type="button" class="sx2-boton sx2-boton--secundario sx2-boton--sm js-fin-reintentar">Reintentar</button>' }) })); return; }
      tomar(r.data);
      pintar(true);
      seleccionar(lineas().length - 1, 0, true);
    });
  }
  function tomar(d) { (d.filas || []).forEach(function (f, k) { f._n = k + 1; }); est_.datos = d; est_.periodo = d.periodo; est_.cuenta = d.cuenta_ref; x_.contexto({ periodo_hoja: d.periodo, cuenta_ref: d.cuenta_ref }); }
  function recargar(enfocarId, col, destello) {
    var x = x_, t = x_.turno();
    return x_.api('finanzasHoja', { periodo: est_.periodo, cuenta_ref: est_.cuenta }).then(function (r) {
      if (!x.vigente(t) || !r || !r.ok) return;
      var caja = x_.raiz().querySelector('.fin4-hoja-env'), arriba = caja ? caja.scrollTop : 0, izq = caja ? caja.scrollLeft : 0;
      tomar(r.data); pintar(false);
      var c2 = x_.raiz().querySelector('.fin4-hoja-env'); if (c2) { c2.scrollTop = arriba; c2.scrollLeft = izq; }
      var brilla = destello || enfocarId;
      var tr = brilla ? x_.raiz().querySelector('.fin4-hoja tr[data-id="' + brilla + '"]') : null;
      if (tr) tr.classList.add('fin5-destello');
      var l = lineas(), i = enfocarId ? l.findIndex(function (z) { return z.f && z.f.id === enfocarId; }) : -1;
      seleccionar(i === -1 ? Math.min(est_.sel.r, l.length - 1) : i, col === undefined ? est_.sel.c : col, true);
    });
  }
  function editable() { return puede('REGISTRAR') && est_.datos && !est_.datos.cerrado && est_.datos.cuenta_ref; }
  // Las líneas de la hoja: las filas del servidor (anotadas y del banco sin anotar) y la fila nueva al final.
  function lineas() { var l = (est_.datos.filas || []).filter(function (f) { return pasaFiltro(f) && pasaBusca(f); }).map(function (f) { return { f: f }; }); if (editable()) l.push({ nueva: true }); return l; }
  // Filtros de la planilla (solo cambian lo que se ve; los totales siguen siendo del mes completo).
  var FILTROS = [['todas', 'Todas'], ['falta', 'Falta anotar'], ['completar', 'Por completar'], ['esperando', 'Esperan cartola'], ['ok', 'En el banco']];
  function pasaFiltro(f, k) {
    k = k || est_.filtro;
    if (k === 'falta') return f.banco === 'falta';
    if (k === 'completar') return !!(f.que && (f.que.k === 'rev' || / · sin /.test(f.que.t)));
    if (k === 'esperando') return f.banco === 'esperando';
    if (k === 'ok') return f.banco === 'ok';
    return true;
  }
  function pasaBusca(f) {
    var q = norm(est_.busca).trim(); if (!q) return true;
    var digitos = q.replace(/[^0-9]/g, '');
    var h = norm([f.nombre, f.obs, f.plan, f.glosa, f.fact, f.grupo, f.cliente, f.nota].join(' '));
    return h.indexOf(q) !== -1 || (digitos.length >= 3 && String(Math.abs(f.monto)).indexOf(digitos) !== -1);
  }

  function pintar(animar) {
    var d = est_.datos;
    var acciones = (editable() ? U.boton({ texto: 'Pegar desde Excel', icono: 'copiar', sm: true, variante: 'secundario', clase: 'js-f4-pegar' }) : '') +
      (d.cuenta_ref && d.filas.length ? U.boton({ texto: 'Descargar Excel', icono: 'descargar', sm: true, variante: 'secundario', clase: 'js-f4-excel', datos: { cap: 'EXPORTAR' } }) : '') +
      U.boton({ texto: 'Subir cartola', icono: 'subir', sm: true, variante: 'primario', clase: 'js-f4-cargar', datos: { cap: 'REGISTRAR' } });
    var meses = d.meses.slice(-8);
    if (meses.indexOf(d.periodo) === -1) meses.push(d.periodo);
    if (est_.filtro !== 'todas' && !d.filas.some(function (f) { return pasaFiltro(f); })) est_.filtro = 'todas';
    x_.pagina(x_.cab('planilla', acciones) +
      '<div class="sx2-pagina__cuerpo fin4 fin5">' +
        (d.cuentas.length ? barraHtml(d, meses) + kpisHtml(d) +
          '<div class="fin5-planilla-env"><div class="fin5-planilla"><div class="fin5-principal">' + filtrosHtml(d) + hojaHtml(d, animar) + '</div>' +
          '<aside class="fin5-lado" aria-label="Banco y grupos">' + bancoHtml(d) + gruposHtml(d) + atajosHtml() + '</aside></div></div>'
          : vacioHtml('subir', 'Todavía no hay una cuenta del banco', 'Sube la primera cartola del banco: con ella se crea la cuenta y empieza la planilla.', U.boton({ texto: 'Subir cartola', icono: 'subir', variante: 'primario', clase: 'js-f4-cargar' }))) +
      '</div>');
    x_.aplicarCapacidades(x_.raiz());
    ponerListas();
    activar(x_.raiz());
  }

  function barraHtml(d, meses) {
    return '<div class="fin5-barra fin5-entra" style="--i:0">' +
      '<div class="fin5-meses" role="tablist" aria-label="Mes"><span class="fin5-meses__ind" aria-hidden="true"></span>' +
        meses.map(function (m) { return '<button type="button" role="tab" class="fin5-mes js-f4-mes" data-mes="' + m + '" aria-selected="' + (m === d.periodo) + '">' + txt(mesCorto(m)) + '</button>'; }).join('') + '</div>' +
      (d.cuentas.length > 1 ? '<label class="fin5-select">' + U.ico('empresa', 15) + '<select class="js-f4-cuenta" aria-label="Cuenta del banco">' + d.cuentas.map(function (c) { return '<option value="' + txt(c.id) + '"' + (c.id === d.cuenta_ref ? ' selected' : '') + '>' + txt(c.empresa + ' · ' + c.nombre) + '</option>'; }).join('') + '</select></label>'
        : (d.cuentas[0] ? '<span class="fin5-pildora fin5-pildora--suave">' + U.ico('empresa', 14) + txt(d.cuentas[0].empresa + ' · ' + d.cuentas[0].nombre) + '</span>' : '')) +
      (d.cerrado ? '<span class="fin5-pildora fin5-pildora--neutro">' + U.ico('candado', 14) + 'Mes cerrado</span>' : '') +
      '<span class="fin5-barra__mes">' + txt(mesLargo(d.periodo)) + ' · ' + d.filas.length + ' fila(s)</span>' +
    '</div>';
  }

  function kpisHtml(d) {
    var t = d.totales, e = d.estado;
    var hon = t.HONORARIOS, gas = -t.GASTOS, base = hon + gas;
    var split = base ? '<div class="fin5-split" aria-hidden="true"><span class="fin5-split__a"' + crece('split-a', hon / base * 100, 'width') + '></span><span class="fin5-split__b"' + crece('split-b', gas / base * 100, 'width') + '></span></div>' : '';
    var l = [
      { clave: 'abono', t: 'ABONO', v: t.ABONO, ico: 'dinero', tono: 'ok', sub: 'entró ' + plata(hon) + ' · gastos ' + plata(gas), barra: split },
      { clave: 'renta', t: 'ABONO RENTA', v: t['ABONO RENTA'], ico: 'recibo', tono: 'info', sub: 'honorarios de renta' },
      { clave: 'saldo', t: 'SALDO', v: t.SALDO, ico: 'persona', tono: 'info', sub: 'a favor de clientes' },
      { clave: 'pend', t: 'PENDIENTE', v: t.PENDIENTE, ico: 'reloj', tono: 'alerta', sub: 'grupos abiertos' }
    ];
    if (t.FONDOS) l.push({ clave: 'fondos', t: 'IVA e imposiciones', v: t.FONDOS, ico: 'caja', tono: 'neutro', sub: 'plata de clientes sin grupo' });
    if (t.OTRO_MES) l.push({ clave: 'otro', t: 'De otros meses', v: t.OTRO_MES, ico: 'calendario', tono: 'neutro', sub: 'grupos que cierran en otro mes' });
    if (t.TRASPASOS) l.push({ clave: 'tras', t: 'Traspasos', v: t.TRASPASOS, ico: 'derivar', tono: 'neutro', sub: 'entre empresas del grupo' });
    if (t.SIN_COMPLETAR) l.push({ clave: 'sinc', t: 'Sin completar', v: t.SIN_COMPLETAR, ico: 'alerta', tono: 'critico', sub: (e.por_completar + e.falta) + ' fila(s) por anotar' });
    l.push({ clave: 'total', t: 'TOTAL', v: t.TOTAL, ico: 'tendencia', tono: 'acento', sub: '= neto del banco del mes' });
    return '<section class="fin5-kpis" aria-label="Resumen del mes">' + l.map(function (o, i) { return kpi(o, i + 1); }).join('') + '</section>';
  }

  function bancoHtml(d) {
    var c = d.cartola, e = d.estado, n = e.ok + e.esperando + e.falta, p = n ? Math.round(e.ok / n * 100) : 0;
    var cuadra = c && !e.falta && !e.esperando;
    var m = !d.filas.length ? ['neutro', 'info', 'Sin movimientos en ' + txt(mesLargo(d.periodo)) + '. Escribe la primera fila o sube la cartola.']
      : !c ? ['alerta', 'reloj', '<b>Sin cartola todavía.</b> Lo anotado se comprueba cuando la subas.']
        : cuadra ? ['ok', 'check', '<b>Cuadra con la cartola.</b> Todo lo anotado está en el banco.']
          : ['alerta', 'alerta', '<b>Falta para cuadrar:</b> ' + [e.falta ? e.falta + ' del banco sin anotar' : '', e.esperando ? e.esperando + ' anotada(s) que el banco no trae' : ''].filter(Boolean).join(' · ') + '.'];
    function dato(t2, v, clave) { return '<div><dt>' + txt(t2) + '</dt><dd>' + (v === null || v === undefined ? '<span class="fin5-tenue">—</span>' : cuenta(clave, v)) + '</dd></div>'; }
    return '<section class="fin5-card fin5-banco fin5-entra" style="--i:3">' +
      '<header class="fin5-card__cab"><h2>Banco · cartola</h2><span class="fin5-pildora fin5-pildora--' + m[0] + '">' + (cuadra ? U.ico('check', 13) + 'Cuadra' : c ? 'Por cuadrar' : 'Sin cartola') + '</span></header>' +
      '<div class="fin5-banco__cuerpo">' +
        '<div class="fin5-anillo" role="img" aria-label="' + p + '% de las filas ya está en el banco"><svg viewBox="0 0 80 80" aria-hidden="true"><circle class="fin5-anillo__fondo" cx="40" cy="40" r="34"/><circle class="fin5-anillo__valor fin5-anillo--' + m[0] + '" cx="40" cy="40" r="34"' + crece('anillo', p, 'anillo') + '/></svg>' +
          '<div class="fin5-anillo__txt"><b>' + cuenta('anillo-p', p, '%') + '</b><small>en banco</small></div></div>' +
        '<dl class="fin5-banco__cifras">' + dato('Saldo inicial', c ? c.saldo_inicial : null, 'b-ini') + dato('Movimientos', c ? c.movimientos : null, 'b-mov') + dato('Saldo final', c ? c.saldo_final : null, 'b-fin') + '</dl>' +
      '</div>' +
      '<div class="fin5-leyenda"><span><i class="fin5-pt fin5-pt--ok"></i>' + e.ok + ' en banco</span><span><i class="fin5-pt fin5-pt--info"></i>' + e.esperando + ' esperando</span><span><i class="fin5-pt fin5-pt--alerta"></i>' + e.falta + ' falta anotar</span></div>' +
      '<div class="fin5-aviso fin5-aviso--' + m[0] + '">' + U.ico(m[1], 16) + '<span>' + m[2] + '</span></div>' +
    '</section>';
  }

  function filtrosHtml(d) {
    return '<div class="fin5-filtros fin5-entra" style="--i:2"><div class="fin5-chips" role="group" aria-label="Filtrar filas">' +
      FILTROS.map(function (o) {
        var n = d.filas.filter(function (f) { return pasaFiltro(f, o[0]); }).length;
        if (o[0] !== 'todas' && !n) return '';
        return '<button type="button" class="fin5-chip js-f5-filtro' + (o[0] === 'falta' || o[0] === 'completar' ? ' fin5-chip--alerta' : '') + '" data-f="' + o[0] + '" aria-pressed="' + (est_.filtro === o[0]) + '">' + txt(o[1]) + '<span>' + n + '</span></button>';
      }).join('') + '</div>' +
      '<label class="fin5-buscar">' + U.ico('lupa', 15) + '<input type="search" class="js-f5-buscar" placeholder="Buscar nombre, monto, plan o factura…" value="' + txt(est_.busca) + '" aria-label="Buscar en la planilla"></label></div>';
  }

  function hojaHtml(d, animar) {
    var ed = editable();
    return '<section class="fin5-card fin5-tabla fin5-entra" style="--i:3"><div class="fin4-hoja-env" tabindex="-1"><table class="fin4-hoja' + (animar && !reducido() ? ' fin5-hoja--entra' : '') + '" aria-label="Planilla de ' + txt(mesLargo(d.periodo)) + '"><thead><tr><th class="fin4-idx">#</th>' +
      COLS.map(function (k) { return '<th class="' + (k[0] === 'monto' ? 'fin4-n' : '') + '">' + k[1] + '</th>'; }).join('') + '<th class="fin4-n">Saldo</th><th>Qué es</th><th>Banco</th></tr></thead><tbody>' +
      cuerpoHoja(ed) + '</tbody></table></div>' +
      '<footer class="fin5-tabla__pie"><span class="fin5-tabla__ico">' + U.ico(ed ? 'editar' : 'ojo', 14) + '</span><p class="fin4-ayuda js-f4-ayuda" aria-live="polite"></p>' +
      (ed ? '' : '<p class="fin5-nota">' + (d.cerrado ? 'El mes está cerrado: la planilla se ve, pero no se edita.' : 'Tu acceso es de lectura.') + '</p>') + '</footer></section>';
  }
  function cuerpoHoja(ed) {
    var l = lineas();
    var vacia = (est_.datos.filas || []).length && !l.some(function (z) { return z.f; });
    return (vacia ? '<tr class="fin5-sin"><td colspan="' + (COLS.length + 4) + '">' + U.ico('lupa', 16) + ' Ninguna fila coincide con el filtro. <button type="button" class="sx2-enlace js-f5-limpiar">Ver todas</button></td></tr>' : '') +
      l.map(function (z, i) { return filaHtml(z, i, ed); }).join('');
  }

  function atajosHtml() {
    if (!editable()) return '';
    return '<section class="fin5-card fin5-atajos fin5-entra" style="--i:5"><header class="fin5-card__cab"><h2>Atajos</h2></header>' +
      '<div class="fin5-atajos__obs">' + Object.keys(ATAJO_OBS).map(function (k) { return '<span title="' + txt(AYUDA_OBS[ATAJO_OBS[k]]) + '"><kbd>' + k + '</kbd>' + txt(ATAJO_OBS[k]) + '</span>'; }).join('') + '</div>' +
      '<ul class="fin5-atajos__teclas"><li><kbd>Enter</kbd> escribe · guarda y baja</li><li><kbd>Tab</kbd> siguiente celda</li><li><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> moverse</li><li><kbd>Supr</kbd> borra la celda</li><li><kbd>Ctrl</kbd>+<kbd>V</kbd> pega filas del Excel</li></ul></section>';
  }
  function valores(z) {
    if (z.nueva) { var b = est_.borrador; return { fecha: b.fecha ? corta(b.fecha) : '', nombre: b.nombre || '', obs: b.obs || '', plan: b.plan || '', monto: b.monto ? plata(b.monto) : '', grupo: b.grupo || '', fact: b.fact || '', glosa: b.glosa || '' }; }
    var f = z.f;
    return { fecha: corta(f.fecha), nombre: f.nombre, obs: f.obs, plan: f.plan, monto: plata(f.monto), grupo: f.grupo, fact: f.fact, glosa: f.glosa };
  }
  function bloqueada(z, campo) {
    if (z.nueva) return false;
    if (z.f.partes > 1 && campo === 'monto') return true;
    if (z.f.banco !== 'esperando' && (campo === 'fecha' || campo === 'monto' || campo === 'glosa')) return true;
    return false;
  }
  var OBS_TONO = { ABONO: 'ok', 'ABONO RENTA': 'info', IVA: 'violeta', IMPOSICIONES: 'violeta', SALDO: 'info', PENDIENTE: 'alerta' };
  function filaHtml(z, i, ed) {
    var f = z.f || {}, v = valores(z);
    var clase = z.nueva ? 'fin4-fila--nueva' : f.banco === 'falta' ? 'fin4-fila--falta' : (f.que && f.que.k === 'rev') ? 'fin4-fila--rev' : '';
    var ph = z.nueva ? { fecha: 'día', nombre: 'escribe aquí para anotar', obs: 'OBS', monto: '+ entra / − sale' } : f.banco === 'falta' ? { nombre: '¿quién es?', obs: 'OBS' } : {};
    var banco = z.nueva ? (est_.borrador.fecha || est_.borrador.monto ? '<span class="fin4-chip fin4-chip--borr">sin guardar</span>' : '')
      : f.banco === 'ok' ? '<span class="fin4-chip fin4-chip--ok"><i></i>en banco</span>' : f.banco === 'esperando' ? '<span class="fin4-chip fin4-chip--esp"><i></i>esperando</span>' : '<span class="fin4-chip fin4-chip--falta"><i></i>falta anotar</span>';
    var que = z.nueva ? '' : '<span class="fin4-que fin4-que--' + (QUE_TONO[f.que.k] || 'neutro') + '">' + txt(f.que.t) + '</span>' + (f.cliente && f.cliente !== f.nombre ? '<small class="fin4-que-cli">' + txt(f.cliente) + '</small>' : '');
    var obs = z.nueva ? est_.borrador.obs : f.obs;
    return '<tr class="fin4-fila ' + clase + '" data-i="' + i + '"' + (f.id ? ' data-id="' + txt(f.id) + '"' : '') + ' style="--i:' + Math.min(i, 24) + '"><td class="fin4-idx">' + (z.nueva ? '+' : f._n) + '</td>' +
      COLS.map(function (k, j) {
        var b = bloqueada(z, k[0]);
        var num = k[0] === 'monto';
        var tono = num && !z.nueva ? (f.monto < 0 ? ' fin2-neg' : ' fin2-pos') : num && est_.borrador.monto ? (est_.borrador.monto < 0 ? ' fin2-neg' : ' fin2-pos') : '';
        var extra = k[0] === 'obs' && obs ? ' fin5-obs fin5-obs--' + (OBS_TONO[obs] || 'neutro') : '';
        return '<td class="fin4-cel fin4-c-' + k[0] + (num ? ' fin4-n' : '') + (b ? ' fin4-bloq' : '') + (k[0] === 'glosa' && !z.nueva && f.banco !== 'esperando' ? ' fin4-tenue' : '') + '" data-r="' + i + '" data-c="' + j + '"' + (ed && !b ? '' : ' aria-readonly="true"') + '>' +
          '<span class="fin4-v' + tono + extra + '" data-ph="' + txt(ph[k[0]] || '') + '">' + txt(v[k[0]]) + '</span></td>';
      }).join('') +
      '<td class="fin4-n fin4-saldo"><span class="fin4-v">' + (z.nueva ? '' : plata(f.saldo)) + '</span></td>' +
      '<td class="fin4-c-que"><span class="fin4-v">' + que + '</span></td>' +
      '<td class="fin4-c-banco"><span class="fin4-v">' + banco + '</span></td></tr>';
  }
  function gruposHtml(d) {
    var g = d.grupos || [];
    return '<section class="fin5-card fin5-grupos fin5-entra" style="--i:4" aria-label="Grupos de fondos"><header class="fin5-card__cab"><h2>Grupos de fondos</h2>' + (g.length ? '<span class="fin5-pildora fin5-pildora--suave">' + g.length + '</span>' : '') + '</header>' +
      (g.length ? '<div class="fin5-grupos__lista">' + g.map(function (x) {
        var pct = x.entra ? x.sale / x.entra * 100 : 100;
        return '<article class="fin5-grupo' + (x.suma < 0 ? ' fin5-grupo--neg' : '') + '">' +
          '<div class="fin5-grupo__cab"><span class="fin5-grupo__letra">' + txt(x.letra) + '</span><div class="fin5-grupo__quien"><b>' + txt(x.cliente || 'sin nombre') + '</b><small>' + x.filas + ' fila(s)</small></div>' +
            '<div class="fin5-grupo__sobra"><small>sobra</small><b class="' + (x.suma < 0 ? 'fin2-neg' : '') + '">' + plata(x.suma) + '</b></div></div>' +
          '<div class="fin5-progreso" title="Se pagó el ' + Math.round(pct) + '% de lo recibido"><span' + crece('g-' + d.periodo + '-' + x.letra, pct, 'width') + '></span></div>' +
          '<div class="fin5-grupo__nums"><span>Entró <b>' + plata(x.entra) + '</b></span><span>Salió <b>' + plata(x.sale) + '</b></span></div>' +
          '<label class="fin5-grupo__dec"><span>Lo que sobra</span><select class="fin2-input js-f4-decision" data-letra="' + txt(x.letra) + '"' + (editable() ? '' : ' disabled') + '>' +
            DECIS.map(function (o) { return '<option value="' + o[0] + '"' + (x.decision === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
          (x.otro_mes ? '<small class="fin4-grupo__aviso">' + U.ico('alerta', 13) + ' Tiene filas de otro mes' + (x.remanente_excel !== null ? ': según el Excel sobran ' + plata(x.remanente_excel) : '') + '.</small>' : '') +
          (x.excel ? '<small class="fin5-nota">Viene del Excel BANCOS (su fila de cierre decía ' + txt(x.decision) + ').</small>' : '') +
        '</article>';
      }).join('') + '</div>' : '<p class="fin5-nota">Pon la misma letra en la columna <b>Grupo</b> a lo que el cliente mandó y a lo que se pagó por él (la fórmula de UNITARIO, sin fórmulas). Lo que sobra se calcula solo y tú eliges qué pasa con eso.</p>') + '</section>';
  }

  // ---- selección y edición, como en una planilla ----------------------------------------
  function td(r, c) { return x_.raiz().querySelector('.fin4-hoja td.fin4-cel[data-r="' + r + '"][data-c="' + c + '"]'); }
  function seleccionar(r, c, sinScroll) {
    var l = lineas(); if (!l.length) return;
    var viejo = x_.raiz().querySelector('.fin4-hoja td.fin4-sel'); if (viejo) viejo.classList.remove('fin4-sel');
    est_.sel = { r: Math.max(0, Math.min(l.length - 1, r)), c: Math.max(0, Math.min(COLS.length - 1, c)) };
    var el = td(est_.sel.r, est_.sel.c);
    if (el) { el.classList.add('fin4-sel'); if (!sinScroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    ayuda();
  }
  // La línea de ayuda dice qué falta en la fila elegida.
  function ayuda() {
    var el = x_.raiz().querySelector('.js-f4-ayuda'); if (!el) return;
    var z = lineas()[est_.sel.r]; if (!z) { el.textContent = ''; return; }
    var campo = COLS[est_.sel.c][0];
    var t = '';
    if (z.nueva) t = est_.borrador.fecha || est_.borrador.monto ? 'Fila nueva: se guarda cuando tenga fecha y monto.' : 'Fila nueva: escribe el día (o la fecha), el nombre, la OBS y el monto. Se guarda cuando tenga fecha y monto.';
    else {
      var f = z.f;
      if (f.banco === 'falta') t = 'El banco trae este movimiento y nadie lo anotó: escribe quién es y la OBS.';
      else if (f.que.k === 'rev') t = f.que.t === 'Falta plan' ? 'Es un gasto: escribe el plan de cuenta (Arriendo Mensual, Sueldos, Cuentas Básicas…).' : f.que.t === 'Falta OBS' ? 'Ponle la OBS: A = ABONO, R = ABONO RENTA, I = IVA, M = IMPOSICIONES, S = SALDO, P = PENDIENTE.' : 'Falta el nombre: el cliente, ARRIENDO, SUELDO…';
      else if (f.banco === 'esperando') t = 'Anotada: falta que llegue en la cartola para comprobarla.';
      else t = f.que.t + (f.cliente ? ' · ' + f.cliente : '') + (f.plan ? ' · ' + f.plan : '') + (f.glosa ? ' · banco: ' + f.glosa : '');
      if (bloqueada(z, campo)) t += ' La fecha, el monto y el detalle vienen del banco.';
    }
    if (campo === 'obs' && !bloqueada(z, campo)) t += ' OBS: ' + Object.keys(ATAJO_OBS).map(function (k) { return k + ' = ' + ATAJO_OBS[k]; }).join(', ') + '.';
    el.textContent = t;
  }
  function valorCrudo(z, campo) {
    if (z.nueva) { var b = est_.borrador; if (campo === 'fecha') return b.fecha ? corta(b.fecha) : ''; if (campo === 'monto') return b.monto ? String(b.monto) : ''; return b[campo] || ''; }
    var f = z.f;
    if (campo === 'fecha') return corta(f.fecha);
    if (campo === 'monto') return String(f.monto);
    return f[campo] || '';
  }
  function editar(inicial) {
    if (!editable()) return;
    var z = lineas()[est_.sel.r], campo = COLS[est_.sel.c][0], cel = td(est_.sel.r, est_.sel.c);
    if (!z || !cel) return;
    if (bloqueada(z, campo)) { x_.aviso('La fecha, el monto y el detalle vienen del banco: no se cambian aquí.', 'alerta'); return; }
    var lista = campo === 'nombre' ? 'f4-dl-nombres' : campo === 'obs' ? 'f4-dl-obs' : campo === 'plan' ? 'f4-dl-planes' : '';
    cel.insertAdjacentHTML('beforeend', '<input class="fin4-editor" autocomplete="off" aria-label="' + txt(COLS[est_.sel.c][1]) + '"' + (lista ? ' list="' + lista + '"' : '') + (campo === 'monto' ? ' inputmode="decimal"' : '') + '>');
    var inp = cel.querySelector('.fin4-editor');
    inp.value = inicial !== undefined ? inicial : valorCrudo(z, campo);
    est_.editando = { r: est_.sel.r, c: est_.sel.c, inp: inp };
    inp.focus(); if (inicial === undefined) inp.select();
  }
  function cancelar() { var e = est_.editando; if (!e) return; est_.editando = null; if (e.inp.parentNode) e.inp.parentNode.removeChild(e.inp); }
  // Lee lo escrito en una celda; devuelve el valor para el servidor o null si no se entiende (con aviso).
  function interpretar(campo, v) {
    if (campo === 'fecha') { if (!v) return ''; var d = leerFecha(v, est_.periodo); if (!d) { x_.aviso('Escribe el día (12) o la fecha (12-10).', 'error'); return null; } return d; }
    if (campo === 'monto') { if (!v) return ''; var m = leerMonto(v); if (m === null || m === 0) { x_.aviso('Escribe el monto: 450.000 si entró, -450.000 si salió.', 'error'); return null; } return m; }
    if (campo === 'obs') { var o = v.toUpperCase().trim(); if (ATAJO_OBS[o]) o = ATAJO_OBS[o]; if (o && (est_.datos.listas.obs || []).indexOf(o) === -1) { x_.aviso('La OBS es una de estas: ' + est_.datos.listas.obs.join(', ') + '.', 'error'); return null; } return o; }
    if (campo === 'nombre' || campo === 'grupo') return v.toUpperCase();
    if (campo === 'plan') { var p = planDelCatalogo(v); return p || v; }
    return v;
  }
  function planDelCatalogo(v) {
    var n = String(v || '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    var l = (est_.datos.listas.planes_ingreso || []).concat(est_.datos.listas.planes_egreso || [], est_.datos.listas.planes_fondos || []);
    return l.filter(function (p) { return p.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '') === n; })[0] || '';
  }
  function mover(r, c, hacia) {
    var l = lineas();
    if (hacia === 'abajo') seleccionar(r + 1, c);
    else if (hacia === 'derecha') { if (c >= COLS.length - 1) seleccionar(Math.min(r + 1, l.length - 1), 0); else seleccionar(r, c + 1); }
    else if (hacia === 'izquierda') seleccionar(r, c - 1);
    else seleccionar(r, c);
  }
  function confirmar(hacia) {
    var e = est_.editando; if (!e) return;
    var z = lineas()[e.r], campo = COLS[e.c][0], crudo = e.inp.value.trim();
    var antes = valorCrudo(z, campo);
    cancelar();
    if (crudo === antes) { mover(e.r, e.c, hacia); return; }
    var v = interpretar(campo, crudo);
    if (v === null) { seleccionar(e.r, e.c); return; }
    if (z.nueva) {
      if (v === '') delete est_.borrador[campo]; else est_.borrador[campo] = v;
      if (est_.borrador.fecha && est_.borrador.monto) return guardarNueva(e.c, hacia);
      repintarHoja(); mover(e.r, e.c, hacia); return;
    }
    // Pinta lo escrito de inmediato y guarda; si el servidor no lo acepta, vuelve atrás.
    var f = z.f, previo = f[campo];
    f[campo] = v;
    var cel = td(e.r, e.c); if (cel) cel.querySelector('.fin4-v').textContent = campo === 'fecha' ? corta(v) : campo === 'monto' ? plata(v) : v;
    mover(e.r, e.c, hacia);
    var campos = {}; campos[campo] = v;
    x_.api('finanzasHojaGuardar', { id: f.id, expected_version: f.version, campos: campos }).then(function (r) {
      if (!r || !r.ok) { f[campo] = previo; error(r, 'No se pudo guardar.'); recargar(null); return; }
      recargar(null, undefined, f.id);
    });
  }
  function guardarNueva(col, hacia) {
    if (est_.guardando) return;
    var b = est_.borrador;
    if (b.fecha.slice(0, 7) !== est_.periodo) { x_.aviso('La fecha es de otro mes (' + mesLargo(b.fecha.slice(0, 7)) + '): la fila quedará en ese mes.', 'alerta'); }
    est_.guardando = true;
    x_.api('finanzasHojaGuardar', { cuenta_ref: est_.cuenta, campos: b }).then(function (r) {
      est_.guardando = false;
      if (!r || !r.ok) { error(r, 'No se pudo anotar la fila.'); return; }
      est_.borrador = {};
      if (r.data.en_banco) x_.aviso('Anotada y unida con su movimiento del banco ✓', 'exito');
      if (b.fecha.slice(0, 7) !== est_.periodo) { est_.periodo = b.fecha.slice(0, 7); }
      recargar(r.data.id, hacia === 'derecha' ? Math.min(col + 1, COLS.length - 1) : col).then(function () {
        if (hacia === 'abajo') seleccionar(lineas().length - 1, 0);
      });
    });
  }
  function repintarHoja() {
    var tb = x_.raiz().querySelector('.fin4-hoja tbody'); if (!tb) return;
    var ed = editable();
    tb.innerHTML = cuerpoHoja(ed);
    seleccionar(est_.sel.r, est_.sel.c, true);
  }
  // Aplica el filtro y la búsqueda sin recargar: las filas visibles se repintan y los chips se marcan.
  function filtrar(escribiendo) {
    if (est_.editando) cancelar();
    Array.prototype.forEach.call(x_.raiz().querySelectorAll('.js-f5-filtro'), function (c) { c.setAttribute('aria-pressed', String(c.dataset.f === est_.filtro)); });
    est_.sel.r = 0;
    repintarHoja();
    if (!escribiendo) { var env = x_.raiz().querySelector('.fin4-hoja-env'); if (env) env.scrollTop = 0; }
  }
  function borrarCelda() {
    if (!editable()) return;
    var z = lineas()[est_.sel.r], campo = COLS[est_.sel.c][0];
    if (!z) return;
    if (z.nueva) { delete est_.borrador[campo]; repintarHoja(); return; }
    if (z.f.banco === 'falta') return;
    if (campo === 'fecha' || campo === 'monto') {
      var f = z.f;
      U.confirmar({ titulo: f.banco === 'esperando' ? '¿Borrar esta fila?' : '¿Borrar lo anotado en esta fila?', texto: corta(f.fecha) + ' · ' + plata(f.monto) + (f.nombre ? ' · ' + f.nombre : '') + (f.banco === 'esperando' ? '' : '. El movimiento del banco queda «falta anotar».'), boton: 'Borrar', peligro: true }).then(function (si) {
        if (!si) return;
        x_.api('finanzasHojaBorrar', { id: f.id, expected_version: f.version }).then(function (r) { if (!r || !r.ok) error(r, 'No se pudo borrar.'); else x_.aviso('Borrado.', 'exito'); recargar(null); });
      });
      return;
    }
    if (bloqueada(z, campo) || !z.f[campo]) return;
    var campos = {}; campos[campo] = '';
    var previo = z.f[campo]; z.f[campo] = ''; repintarHoja();
    x_.api('finanzasHojaGuardar', { id: z.f.id, expected_version: z.f.version, campos: campos }).then(function (r) { if (!r || !r.ok) { z.f[campo] = previo; error(r, 'No se pudo borrar.'); } recargar(null); });
  }

  // ---- pegar filas copiadas del Excel ---------------------------------------------------
  // Orden del Excel BANCOS (TOTAL · SALDO · FECHA · DETALLE · PLAN · UNITARIO · OBS · DETALLE BANCO) o el de esta hoja.
  function leerPegado(texto) {
    var filas = String(texto || '').replace(/\r/g, '').split('\n').filter(function (s) { return s.trim(); }).map(function (s) { return s.split('\t'); });
    if (!filas.length || filas[0].length < 3) return null;
    var cab = filas[0].map(function (c) { return String(c).trim().toUpperCase(); });
    var out = [], desde = 0, iF;
    if (cab.indexOf('FECHA') !== -1) { desde = 1; iF = cab.indexOf('FECHA'); } else iF = filas[0].findIndex(function (c) { return /[\/\-.]/.test(c) && leerFecha(c, est_.periodo); });
    if (iF === -1) return null;
    filas.slice(desde).forEach(function (c) {
      var bancos = iF >= 2;
      var f = bancos ? { monto: leerMonto(c[iF - 2]), fecha: leerFecha(c[iF], est_.periodo), alias: c[iF + 1], plan: c[iF + 2], obs: c[iF + 4], glosa: c[iF + 5] }
        : { fecha: leerFecha(c[iF], est_.periodo), alias: c[iF + 1], obs: c[iF + 2], plan: c[iF + 3], monto: leerMonto(c[iF + 4]), grupo: c[iF + 5], fact: c[iF + 6], glosa: c[iF + 7] };
      if (!f.fecha || !f.monto) return;
      var o = String(f.obs || '').trim().toUpperCase();
      f.obs = (est_.datos.listas.obs || []).indexOf(o) !== -1 ? o : '';
      f.alias = String(f.alias || '').trim(); f.plan = planDelCatalogo(f.plan) || String(f.plan || '').trim(); f.glosa = String(f.glosa || '').trim();
      out.push(f);
    });
    return out;
  }
  function pegar(texto) {
    var filas = leerPegado(texto);
    if (!filas) { x_.aviso('No encuentro la fecha en lo pegado. Copia desde la columna TOTAL hasta DETALLE BANCO del Excel.', 'error'); return; }
    if (!filas.length) { x_.aviso('Lo pegado no trae filas con fecha y monto.', 'error'); return; }
    var suma = filas.reduce(function (s, f) { return s + f.monto; }, 0);
    U.confirmar({ titulo: '¿Anotar ' + filas.length + ' fila(s)?', texto: 'Suman ' + plata(suma) + '. Las que ya estén en la cartola se unen solas con el banco.', boton: 'Anotar' }).then(function (si) {
      if (!si) return;
      var lotes = []; for (var i = 0; i < filas.length; i += 300) lotes.push(filas.slice(i, i + 300));
      var total = 0, banco = 0;
      lotes.reduce(function (p, l) { return p.then(function (ok) { if (!ok) return false; return x_.api('finanzasRegistroAnotar', { cuenta_ref: est_.cuenta, filas: l }).then(function (r) { if (!r || !r.ok) { error(r, 'No se pudo anotar.'); return false; } total += r.data.anotadas; banco += r.data.en_banco; return true; }); }); }, Promise.resolve(true))
        .then(function () { if (total) x_.aviso(total + ' fila(s) anotadas · ' + banco + ' unidas con el banco.', 'exito'); recargar(null); });
    });
  }
  function pegarDialogo() {
    var dr = U.drawer({ titulo: 'Pegar filas desde Excel', subtitulo: '<span class="fin2-ayuda">Copia las filas de la planilla BANCOS (desde TOTAL hasta DETALLE BANCO) y pégalas aquí. También puedes pegar directo en la planilla con Ctrl+V.</span>',
      cuerpo: '<div class="fin2-p"><label class="fin2-campo"><span>Filas copiadas</span><textarea class="fin2-input fin4-pegado js-f4-pegado" rows="9" placeholder="Pega aquí (Ctrl+V)"></textarea></label></div>',
      pie: U.boton({ texto: 'Revisar y anotar', icono: 'check', variante: 'primario', clase: 'js-f4-pegado-ok' }) });
    dr.el.querySelector('.js-f4-pegado-ok').addEventListener('click', function () { var t = dr.el.querySelector('.js-f4-pegado').value; dr.cerrar(); pegar(t); });
    dr.el.querySelector('.js-f4-pegado').focus();
  }

  // =====================================================================================
  //  Reportes: FLUJO, saldo por cliente y cobranza
  // =====================================================================================
  var rep_ = { hasta: '', meses: 6, empresa: '', periodo: '', facturas: 'abiertas', vacias: false, buscaCli: '', buscaFact: '', saldos: null, cobros: null };
  function selectorMes(clase, actual, meses, etiqueta) { return '<label class="fin5-select">' + U.ico('calendario', 15) + '<select class="' + clase + '" aria-label="' + txt(etiqueta || 'Mes') + '">' + meses.map(function (m) { return '<option value="' + m + '"' + (m === actual ? ' selected' : '') + '>' + txt(mesLargo(m)) + '</option>'; }).join('') + '</select></label>'; }
  function ultimosMeses(n) { var out = [], a = hoy().slice(0, 7).split('-').map(Number); for (var i = 0; i < n; i++) { var d = new Date(Date.UTC(a[0], a[1] - 1 - i, 1)); out.push(d.toISOString().slice(0, 7)); } return out; }
  function falla(x, vista, titulo, r) { if (r && !r.boveda_cerrada) x.pagina(x.cab(vista) + vacioHtml('alerta', titulo, (r && r.message) || 'Inténtalo de nuevo.', '<button type="button" class="sx2-boton sx2-boton--secundario sx2-boton--sm js-fin-reintentar">Reintentar</button>')); }

  // ---- FLUJO ------------------------------------------------------------------------------
  function verFlujo(x) {
    x_ = x; enlazar();
    rep_.hasta = rep_.hasta || hoy().slice(0, 7);
    var t = x.turno();
    x.pagina(x.cab('flujo') + U.esqueleto('tabla', 14));
    x.api('finanzasHojaFlujo', { hasta: rep_.hasta, meses: rep_.meses, empresa: rep_.empresa }).then(function (r) {
      if (!x.vigente(t)) return;
      if (!r || !r.ok) { falla(x, 'flujo', 'No se pudo armar el FLUJO', r); return; }
      rep_.flujo = r.data;
      pintarFlujo();
    });
  }
  function pintarFlujo() {
    var x = x_, d = rep_.flujo, M = d.meses;
    var tot = function (val) { return M.reduce(function (s, m) { return s + ((val || {})[m] || 0); }, 0); };
    function suma(lista) { var o = {}; lista.forEach(function (l) { M.forEach(function (m) { o[m] = (o[m] || 0) + (l.valores[m] || 0); }); }); return o; }
    var ti = suma(d.ingresos), te = suma(d.egresos), mg = {}; M.forEach(function (m) { mg[m] = (ti[m] || 0) - (te[m] || 0); });
    var ocultas = 0;
    function fila(nombre, val, clase, tono, siempre) {
      var vs = M.map(function (m) { return (val || {})[m] || 0; }), total = vs.reduce(function (a, b) { return a + b; }, 0);
      if (!siempre && !rep_.vacias && !vs.some(Boolean)) { ocultas++; return ''; }
      var max = Math.max.apply(null, vs.map(Math.abs).concat([1]));
      return '<tr' + (clase ? ' class="' + clase + '"' : '') + (tono ? ' data-tono="' + tono + '"' : '') + '><th>' + txt(nombre) + '</th>' +
        vs.map(function (v) { return '<td class="fin4-n' + (v ? '' : ' fin4-cero') + '"' + (v && tono && !clase ? ' style="--h:' + (Math.abs(v) / max).toFixed(2) + '"' : '') + '>' + plata(v, '—') + '</td>'; }).join('') +
        '<td class="fin4-n fin4-tot' + (total < 0 ? ' fin2-neg' : '') + '">' + plata(total, '—') + '</td></tr>';
    }
    var sec = function (t2, ico) { return '<tr class="fin4-sec"><th colspan="' + (M.length + 2) + '"><span>' + U.ico(ico, 14) + txt(t2) + '</span></th></tr>'; };
    var avisos = M.filter(function (m) { var z = d.resumen[m]; return z.por_completar || z.falta; }).map(function (m) { var z = d.resumen[m]; return mesLargo(m) + ': ' + [z.falta ? z.falta + ' del banco sin anotar' : '', z.por_completar ? z.por_completar + ' fila(s) por completar' : ''].filter(Boolean).join(', '); });
    var max = Math.max.apply(null, M.map(function (m) { return Math.max(ti[m] || 0, te[m] || 0); }).concat([1]));
    var tI = tot(ti), tE = tot(te), tM = tI - tE;
    var cuerpo = sec('Ingresos', 'tendencia') + d.ingresos.map(function (l) { return fila(l.plan, l.valores, '', 'ok'); }).join('') + fila('Total ingresos', ti, 'fin4-subt', '', true) +
      sec('Egresos', 'dinero') + d.egresos.map(function (l) { return fila(l.plan, l.valores, '', 'critico'); }).join('') + fila('Total egresos', te, 'fin4-subt', '', true) +
      fila('Margen del mes', mg, 'fin4-res', '', true) +
      sec('Fondos de clientes (no son de la empresa)', 'caja') + fila('Recibido de clientes', d.fondos.recibido, '', 'info') + fila('Pagado por cuenta de clientes', d.fondos.pagado, '', 'info') + fila('Lo que sobró, cobrado como honorario', d.fondos.honorario, '', 'ok') + fila('Lo que sobró, a favor del cliente', d.fondos.a_favor, '', 'info') +
      sec('Otros', 'capas') + fila('Traspasos y préstamos', d.otros.traspasos, '', 'neutro') + fila('Sin completar', d.otros.sin_completar, '', 'alerta');
    x.pagina(x.cab('flujo') + '<div class="sx2-pagina__cuerpo fin4 fin5">' +
      '<div class="fin5-barra fin5-entra" style="--i:0">' + selectorMes('js-f4-hasta', rep_.hasta, ultimosMeses(18), 'Hasta') +
        '<div class="fin5-seg" role="group" aria-label="Meses">' + [3, 6, 12].map(function (n) { return '<button type="button" class="js-f5-nmeses" data-n="' + n + '" aria-pressed="' + (n === rep_.meses) + '">' + n + ' meses</button>'; }).join('') + '</div>' +
        '<label class="fin5-select">' + U.ico('empresa', 15) + '<select class="js-f4-empresa" aria-label="Empresa"><option value="">Todo el grupo</option>' + d.empresas.map(function (e) { return '<option' + (e === rep_.empresa ? ' selected' : '') + '>' + txt(e) + '</option>'; }).join('') + '</select></label>' +
      '</div>' +
      '<section class="fin5-kpis" aria-label="Totales del período">' +
        kpi({ clave: 'fl-i', t: 'Ingresos', v: tI, ico: 'tendencia', tono: 'ok', sub: M.length + ' meses' }, 1) + kpi({ clave: 'fl-e', t: 'Egresos', v: -tE, ico: 'dinero', tono: 'critico', sub: 'gastos con plan de cuenta' }, 2) +
        kpi({ clave: 'fl-m', t: 'Margen', v: tM, ico: 'destello', tono: 'acento', sub: tI ? Math.round(tM / tI * 100) + '% de los ingresos' : '' }, 3) + kpi({ clave: 'fl-f', t: 'Fondos de clientes', v: tot(d.fondos.recibido), ico: 'caja', tono: 'info', sub: 'recibidos (aparte)' }, 4) +
      '</section>' +
      (avisos.length ? '<div class="fin5-aviso fin5-aviso--alerta fin5-entra" style="--i:4">' + U.ico('alerta', 16) + '<span><b>Hay filas sin completar</b> que todavía no entran al FLUJO. ' + txt(avisos.join(' · ')) + '</span></div>' : '') +
      '<section class="fin5-card fin5-entra" style="--i:5"><header class="fin5-card__cab"><h2>Ingresos y egresos por mes</h2><div class="fin5-leyenda"><span><i class="fin5-pt fin5-pt--ok"></i>Ingresos</span><span><i class="fin5-pt fin5-pt--critico"></i>Egresos</span><span><i class="fin5-pt fin5-pt--acento"></i>Margen</span></div></header>' +
        '<div class="fin5-graf" role="img" aria-label="Ingresos y egresos de los últimos ' + M.length + ' meses">' + M.map(function (m, k) {
          var a = ti[m] || 0, b = te[m] || 0, g = mg[m];
          return '<div class="fin5-graf__col" style="--i:' + k + '" tabindex="0"><div class="fin5-graf__barras">' +
            '<span class="fin5-bar fin5-bar--ing"' + crece('fi-' + m + rep_.empresa, a / max * 100, 'height') + '></span><span class="fin5-bar fin5-bar--egr"' + crece('fe-' + m + rep_.empresa, b / max * 100, 'height') + '></span>' +
            '<div class="fin5-graf__tip" role="tooltip"><b>' + txt(mesLargo(m)) + '</b><span><i class="fin5-pt fin5-pt--ok"></i>Ingresos ' + plata(a) + '</span><span><i class="fin5-pt fin5-pt--critico"></i>Egresos ' + plata(b) + '</span><span><i class="fin5-pt fin5-pt--acento"></i>Margen ' + plata(g) + '</span></div></div>' +
            '<b class="fin5-graf__m' + (g < 0 ? ' fin2-neg' : '') + '">' + (g > 0 ? '+' : '') + plata(g, '—') + '</b><span class="fin5-graf__mes">' + txt(mesCorto(m)) + '</span></div>';
        }).join('') + '</div></section>' +
      '<section class="fin5-card fin5-entra" style="--i:6"><header class="fin5-card__cab"><h2>Por plan de cuenta</h2><button type="button" class="fin5-chip js-f5-vacias" aria-pressed="' + rep_.vacias + '">' + U.ico(rep_.vacias ? 'ojo' : 'filtro', 13) + '<b class="js-f5-vacias-t"></b></button></header>' +
        '<div class="fin4-rep fin5-flujo"><table class="fin4-tab"><thead><tr><th>Plan de cuenta</th>' + M.map(function (m) { return '<th class="fin4-n">' + txt(mesCorto(m)) + '</th>'; }).join('') + '<th class="fin4-n">Total</th></tr></thead><tbody>' + cuerpo + '</tbody></table></div></section>' +
      '<p class="fin5-nota">Sale solo de la planilla: cada fila cae en su plan de cuenta. El dinero de los clientes (IVA, imposiciones) va aparte, para no inflar los ingresos ni los gastos.</p></div>');
    var bt = x.raiz().querySelector('.js-f5-vacias-t'); if (bt) bt.textContent = rep_.vacias ? 'Ocultar planes sin movimiento' : 'Mostrar ' + ocultas + ' plan(es) sin movimiento';
    activar(x.raiz());
  }

  // ---- Saldo por cliente ----------------------------------------------------------------
  function verSaldos(x) {
    x_ = x; enlazar();
    rep_.periodo = rep_.periodo || hoy().slice(0, 7);
    var t = x.turno();
    x.pagina(x.cab('saldos') + U.esqueleto('tabla', 12));
    x.api('finanzasHojaClientes', { periodo: rep_.periodo }).then(function (r) {
      if (!x.vigente(t)) return;
      if (!r || !r.ok) { falla(x, 'saldos', 'No se pudo calcular', r); return; }
      rep_.saldos = r.data;
      var d = r.data, l = d.clientes;
      var tot = l.reduce(function (s, c) { s.saldo += c.saldo; s.deuda += c.deuda; s.hon += c.honorarios_mes; if (c.saldo < 0) s.neg++; return s; }, { saldo: 0, deuda: 0, hon: 0, neg: 0 });
      x.pagina(x.cab('saldos') + '<div class="sx2-pagina__cuerpo fin4 fin5">' +
        '<div class="fin5-barra fin5-entra" style="--i:0">' + selectorMes('js-f4-periodo', rep_.periodo, ultimosMeses(18), 'Hasta') + '<span class="fin5-barra__mes">Saldo acumulado desde ' + txt(mesLargo(d.desde)) + '</span></div>' +
        '<section class="fin5-kpis" aria-label="Totales">' +
          kpi({ clave: 'sc-s', t: 'Plata de clientes en la cuenta', v: tot.saldo, ico: 'caja', tono: 'acento', sub: 'recibido − pagado − cobrado' }, 1) +
          kpi({ clave: 'sc-h', t: 'Honorarios de ' + mesLargo(d.periodo), v: tot.hon, ico: 'dinero', tono: 'ok' }, 2) +
          kpi({ clave: 'sc-d', t: 'Facturas por cobrar', v: tot.deuda, ico: 'recibo', tono: 'alerta' }, 3) +
          kpi({ clave: 'sc-n', t: 'Clientes en negativo', v: tot.neg, fmt: 'n', ico: 'alerta', tono: tot.neg ? 'critico' : 'neutro', sub: 'se pagó más de lo que mandaron' }, 4) +
        '</section>' +
        (l.length ? '<section class="fin5-card fin5-entra" style="--i:5"><header class="fin5-card__cab"><h2>' + l.length + ' cliente(s)</h2><label class="fin5-buscar">' + U.ico('lupa', 15) + '<input type="search" class="js-f5-buscar-cli" placeholder="Buscar cliente…" value="' + txt(rep_.buscaCli) + '" aria-label="Buscar cliente"></label></header>' +
          '<div class="fin4-rep"><table class="fin4-tab fin5-tab-cli"><thead><tr><th>Cliente</th><th class="fin4-n">Honorarios del mes</th><th class="fin4-n">Fondos recibidos</th><th class="fin4-n">Pagado por él</th><th class="fin4-n">Sobró, cobrado</th><th class="fin5-col-saldo">Saldo de fondos</th><th class="fin4-n">Debe en facturas</th></tr></thead><tbody class="js-f5-cli">' + cuerpoSaldos() + '</tbody></table></div></section>'
          : vacioHtml('equipo', 'Sin clientes con movimiento', 'Aparecen cuando la planilla tiene filas con su nombre.')) +
        '<p class="fin5-nota">Saldo de fondos = lo que el cliente mandó para sus obligaciones − lo que se pagó por él − lo que sobró y se cobró como honorario. Un saldo negativo es plata que hay que pedirle. «Sin ficha»: el nombre de la planilla no está enlazado a un cliente de SIGSO.</p></div>');
      activar(x.raiz());
    });
  }
  function cuerpoSaldos() {
    var l = rep_.saldos.clientes, q = norm(rep_.buscaCli).trim();
    var max = Math.max.apply(null, l.map(function (c) { return Math.abs(c.saldo); }).concat([1]));
    var ver = l.filter(function (c) { return !q || norm(c.cliente).indexOf(q) !== -1; });
    if (!ver.length) return '<tr class="fin5-sin"><td colspan="7">' + U.ico('lupa', 16) + ' Ningún cliente coincide con «' + txt(rep_.buscaCli) + '».</td></tr>';
    return ver.map(function (c, i) {
      var pct = Math.abs(c.saldo) / max * 50;
      return '<tr style="--i:' + Math.min(i, 24) + '"><th><span class="fin5-cli"><span class="fin5-avatar" data-tono="' + (c.cliente.charCodeAt(0) % 5) + '">' + txt(iniciales(c.cliente)) + '</span><span class="fin5-cli__n">' + txt(c.cliente) + (c.sin_ficha ? '<small class="fin5-etq">sin ficha</small>' : '') + '</span></span></th>' +
        '<td class="fin4-n">' + plata(c.honorarios_mes, '—') + '</td><td class="fin4-n">' + plata(c.recibido, '—') + '</td><td class="fin4-n">' + plata(c.pagado, '—') + '</td><td class="fin4-n">' + plata(c.cobrado, '—') + '</td>' +
        '<td class="fin5-col-saldo"><div class="fin5-saldo"><div class="fin5-div"><span class="fin5-div__eje"></span><span class="fin5-div__bar fin5-div__bar--' + (c.saldo < 0 ? 'neg' : 'pos') + '" style="width:' + pct.toFixed(1) + '%"></span></div><b class="' + (c.saldo < 0 ? 'fin2-neg' : '') + '">' + plata(c.saldo, '—') + '</b></div></td>' +
        '<td class="fin4-n ' + (c.deuda ? 'fin2-neg' : '') + '">' + plata(c.deuda, '—') + (c.facturas ? ' <small class="fin5-etq">' + c.facturas + '</small>' : '') + '</td></tr>';
    }).join('');
  }

  // ---- Cobranza ---------------------------------------------------------------------------
  function verCobros(x) {
    x_ = x; enlazar();
    var t = x.turno();
    x.pagina(x.cab('cobros') + U.esqueleto('tabla', 12));
    x.api('finanzasHojaCobranza', { estado: rep_.facturas }).then(function (r) {
      if (!x.vigente(t)) return;
      if (!r || !r.ok) { falla(x, 'cobros', 'No se pudo cargar la cobranza', r); return; }
      rep_.cobros = r.data;
      var d = r.data, T = d.totales;
      var porVencer = Math.max(0, T.por_cobrar - T.vencido), base = T.pagado + T.por_cobrar || 1;
      var seg = function (cl, v, clave) { return v ? '<span class="fin5-pila__' + cl + '"' + crece(clave, v / base * 100, 'width') + ' title="' + plata(v) + '"></span>' : ''; };
      x.pagina(x.cab('cobros', U.boton({ texto: 'Subir facturas o ventas del SII', icono: 'subir', sm: true, variante: 'primario', clase: 'js-f4-cargar', datos: { cap: 'REGISTRAR' } })) + '<div class="sx2-pagina__cuerpo fin4 fin5">' +
        '<section class="fin5-kpis" aria-label="Totales de cobranza">' +
          kpi({ clave: 'co-f', t: 'Facturado', v: T.facturado, ico: 'recibo', tono: 'neutro', sub: d.total_facturas + ' factura(s)' }, 1) +
          kpi({ clave: 'co-p', t: 'Pagado', v: T.pagado, ico: 'check', tono: 'ok', sub: T.facturado ? Math.round(T.pagado / T.facturado * 100) + '% de lo facturado' : '' }, 2) +
          kpi({ clave: 'co-c', t: 'Por cobrar', v: T.por_cobrar, ico: 'reloj', tono: 'acento' }, 3) +
          kpi({ clave: 'co-v', t: 'Vencido', v: T.vencido, ico: 'alerta', tono: T.vencido ? 'critico' : 'neutro', sub: T.por_cobrar ? Math.round(T.vencido / T.por_cobrar * 100) + '% de lo por cobrar' : '' }, 4) +
        '</section>' +
        (T.facturado ? '<section class="fin5-card fin5-entra" style="--i:5"><header class="fin5-card__cab"><h2>Estado de lo facturado</h2><div class="fin5-leyenda"><span><i class="fin5-pt fin5-pt--ok"></i>Pagado ' + plata(T.pagado) + '</span><span><i class="fin5-pt fin5-pt--info"></i>Por vencer ' + plata(porVencer) + '</span><span><i class="fin5-pt fin5-pt--critico"></i>Vencido ' + plata(T.vencido) + '</span></div></header>' +
          '<div class="fin5-pila" role="img" aria-label="Pagado ' + plata(T.pagado) + ', por vencer ' + plata(porVencer) + ', vencido ' + plata(T.vencido) + '">' + seg('ok', T.pagado, 'pila-p') + seg('info', porVencer, 'pila-v') + seg('critico', T.vencido, 'pila-x') + '</div></section>' : '') +
        '<section class="fin5-card fin5-entra" style="--i:6"><header class="fin5-card__cab">' + U.segmento([{ id: 'abiertas', texto: 'Por cobrar' }, { id: 'todas', texto: 'Todas' }], rep_.facturas, 'js-f4-fact') +
          '<span class="fin5-barra__mes">' + d.facturas.length + ' de ' + d.total_facturas + ' factura(s)</span>' +
          '<label class="fin5-buscar">' + U.ico('lupa', 15) + '<input type="search" class="js-f5-buscar-fact" placeholder="Buscar folio, cliente o empresa…" value="' + txt(rep_.buscaFact) + '" aria-label="Buscar factura"></label></header>' +
          (d.facturas.length ? '<div class="fin4-rep"><table class="fin4-tab fin5-tab-fact"><thead><tr><th>N°</th><th>Cliente</th><th>Empresa</th><th>Emisión</th><th>Vence</th><th class="fin4-n">Total</th><th class="fin5-col-pago">Pagado</th><th class="fin4-n">Saldo</th><th>Estado</th></tr></thead><tbody class="js-f5-fact">' + cuerpoCobros() + '</tbody></table></div>'
            : vacioHtml('recibo', rep_.facturas === 'abiertas' ? 'No hay facturas por cobrar' : 'Todavía no hay facturas', 'Las facturas entran con el Registro de Ventas del SII o la hoja FACTURAS de la planilla, en «Subir archivos».')) +
        '</section>' +
        '<p class="fin5-nota">Una factura queda pagada cuando, en la planilla, la fila del abono lleva su número en la columna «N° factura» (varias: «1052-1053»). No hay otra hoja de pagos que llenar.</p></div>');
      x.aplicarCapacidades(x.raiz());
      activar(x.raiz());
    });
  }
  function diasDesde(iso) { var a = Date.parse(iso + 'T00:00:00Z'), b = Date.parse(hoy() + 'T00:00:00Z'); return isNaN(a) ? 0 : Math.round((b - a) / 864e5); }
  function cuerpoCobros() {
    var q = norm(rep_.buscaFact).trim();
    var tono = { Pagada: 'ok', Parcial: 'info', Vencida: 'critico', Pendiente: 'neutro', Incobrable: 'neutro' };
    var ver = rep_.cobros.facturas.filter(function (f) { return !q || norm([f.folio, f.cliente, f.empresa].join(' ')).indexOf(q) !== -1; });
    if (!ver.length) return '<tr class="fin5-sin"><td colspan="9">' + U.ico('lupa', 16) + ' Ninguna factura coincide con «' + txt(rep_.buscaFact) + '».</td></tr>';
    return ver.map(function (f, i) {
      var pct = f.total ? Math.min(100, f.pagado / f.total * 100) : 0, dias = f.estado === 'Vencida' ? diasDesde(f.vence) : 0;
      return '<tr style="--i:' + Math.min(i, 24) + '"' + (f.estado === 'Vencida' ? ' class="fin5-fila-vencida"' : '') + '><th class="fin5-folio">' + txt(f.folio) + '</th>' +
        '<td><span class="fin5-cli"><span class="fin5-avatar" data-tono="' + (String(f.cliente || '?').charCodeAt(0) % 5) + '">' + txt(iniciales(f.cliente)) + '</span><span class="fin5-cli__n">' + txt(f.cliente) + '</span></span></td>' +
        '<td><span class="fin5-etq">' + txt(f.empresa) + '</span></td><td class="fin2-num">' + txt(corta(f.fecha) + '-' + String(f.fecha).slice(2, 4)) + '</td>' +
        '<td class="fin2-num">' + txt(f.vence ? corta(f.vence) + '-' + String(f.vence).slice(2, 4) : '') + (dias > 0 ? '<small class="fin5-atraso">hace ' + dias + ' d</small>' : '') + '</td>' +
        '<td class="fin4-n">' + plata(f.total) + '</td>' +
        '<td class="fin5-col-pago"><div class="fin5-progreso fin5-progreso--' + (pct >= 100 ? 'ok' : 'info') + '"><span style="width:' + pct.toFixed(1) + '%"></span></div><small>' + plata(f.pagado, '—') + '</small></td>' +
        '<td class="fin4-n"><b>' + plata(f.saldo, '—') + '</b></td><td>' + U.badge(f.estado, tono[f.estado] || 'neutro') + '</td></tr>';
    }).join('');
  }

  // =====================================================================================
  //  Eventos
  // =====================================================================================
  var enlazado_ = false;
  function enHoja() { return !!(x_ && x_.raiz() && x_.raiz().querySelector('.fin4-hoja')); }
  function enlazar() {
    if (enlazado_) return; enlazado_ = true;
    var raiz = document.getElementById('modulo-finanzas');
    document.body.insertAdjacentHTML('beforeend', '<div hidden id="f4-listas"></div>');
    raiz.addEventListener('click', function (ev) {
      var t = ev.target;
      var b = t.closest('button');
      if (b && b.classList.contains('js-f4-mes')) { est_.periodo = b.dataset.mes; est_.borrador = {}; x_.contexto({ periodo_hoja: est_.periodo }); ver(x_); return; }
      if (b && b.classList.contains('js-f4-cargar')) { x_.ir('cargas'); return; }
      if (b && b.classList.contains('js-f4-pegar')) { pegarDialogo(); return; }
      if (b && b.classList.contains('js-f4-excel')) { descargarExcel(b); return; }
      if (b && b.classList.contains('js-f4-fact')) { rep_.facturas = b.dataset.id || rep_.facturas; verCobros(x_); return; }
      if (b && b.classList.contains('js-f5-filtro')) { est_.filtro = b.dataset.f; filtrar(); return; }
      if (b && b.classList.contains('js-f5-limpiar')) { est_.filtro = 'todas'; est_.busca = ''; var bi = x_.raiz().querySelector('.js-f5-buscar'); if (bi) bi.value = ''; filtrar(); return; }
      if (b && b.classList.contains('js-f5-vacias')) { rep_.vacias = !rep_.vacias; pintarFlujo(); return; }
      if (b && b.classList.contains('js-f5-nmeses')) { rep_.meses = Number(b.dataset.n); verFlujo(x_); return; }
      var cel = t.closest('.fin4-hoja td.fin4-cel');
      if (cel && !t.closest('input')) {
        if (est_.editando) confirmar();
        seleccionar(+cel.dataset.r, +cel.dataset.c, true);
        if (ev.detail >= 2) editar();
      }
    });
    raiz.addEventListener('input', function (ev) {
      var t = ev.target;
      if (t.classList.contains('js-f5-buscar')) { est_.busca = t.value; filtrar(true); }
      else if (t.classList.contains('js-f5-buscar-cli')) { rep_.buscaCli = t.value; var tb = x_.raiz().querySelector('.js-f5-cli'); if (tb) tb.innerHTML = cuerpoSaldos(); }
      else if (t.classList.contains('js-f5-buscar-fact')) { rep_.buscaFact = t.value; var tf = x_.raiz().querySelector('.js-f5-fact'); if (tf) tf.innerHTML = cuerpoCobros(); }
    });
    raiz.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.classList.contains('js-f4-cuenta')) { est_.cuenta = t.value; est_.borrador = {}; x_.contexto({ cuenta_ref: t.value }); ver(x_); }
      else if (t.classList.contains('js-f4-decision')) {
        x_.api('finanzasHojaGrupo', { cuenta_ref: est_.cuenta, periodo: est_.periodo, letra: t.dataset.letra, decision: t.value }).then(function (r) { if (!r || !r.ok) error(r, 'No se pudo guardar.'); recargar(null); });
      }
      else if (t.classList.contains('js-f4-hasta')) { rep_.hasta = t.value; verFlujo(x_); }
      else if (t.classList.contains('js-f4-empresa')) { rep_.empresa = t.value; verFlujo(x_); }
      else if (t.classList.contains('js-f4-periodo')) { rep_.periodo = t.value; verSaldos(x_); }
    });
    // Teclado de planilla: solo cuando la hoja está en pantalla y no hay un diálogo abierto.
    document.addEventListener('keydown', function (ev) {
      if (!enHoja() || document.querySelector('.sx2-drawer, .sx2-dialogo')) return;
      if (est_.editando) {
        if (ev.key === 'Enter') { ev.preventDefault(); confirmar('abajo'); }
        else if (ev.key === 'Tab') { ev.preventDefault(); confirmar(ev.shiftKey ? 'izquierda' : 'derecha'); }
        else if (ev.key === 'Escape') { ev.preventDefault(); cancelar(); seleccionar(est_.sel.r, est_.sel.c); }
        return;
      }
      var a = document.activeElement;
      if (a && a !== document.body && !x_.raiz().contains(a)) return;
      if (a && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(a.tagName)) return;
      var k = ev.key, s = est_.sel;
      if (k === 'ArrowDown') { ev.preventDefault(); seleccionar(s.r + 1, s.c); }
      else if (k === 'ArrowUp') { ev.preventDefault(); seleccionar(s.r - 1, s.c); }
      else if (k === 'ArrowRight' || (k === 'Tab' && !ev.shiftKey)) { ev.preventDefault(); seleccionar(s.r, s.c + 1); }
      else if (k === 'ArrowLeft' || (k === 'Tab' && ev.shiftKey)) { ev.preventDefault(); seleccionar(s.r, s.c - 1); }
      else if (k === 'Enter' || k === 'F2') { ev.preventDefault(); editar(); }
      else if (k === 'Delete' || k === 'Backspace') { ev.preventDefault(); borrarCelda(); }
      else if (k.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) { ev.preventDefault(); editar(k); }
    });
    document.addEventListener('paste', function (ev) {
      if (!enHoja() || est_.editando || !editable() || document.querySelector('.sx2-drawer, .sx2-dialogo')) return;
      var a = document.activeElement; if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName)) return;
      var t = (ev.clipboardData || window.clipboardData).getData('text');
      if (/\t/.test(t)) { ev.preventDefault(); pegar(t); }
    });
  }
  // Listas para escribir rápido (nombres conocidos, OBS y planes de cuenta).
  var listasPuestas_ = '';
  function ponerListas() {
    var d = est_.datos; if (!d || !d.listas) return;
    var cont = document.getElementById('f4-listas'); if (!cont) return;
    var firma = d.listas.nombres.length + '|' + d.listas.planes_egreso.length;
    if (listasPuestas_ === firma) return;
    listasPuestas_ = firma;
    cont.innerHTML = '<datalist id="f4-dl-nombres">' + d.listas.nombres.map(function (n) { return '<option value="' + txt(n.n) + '">' + txt(n.quien) + '</option>'; }).join('') + '</datalist>' +
      '<datalist id="f4-dl-obs">' + d.listas.obs.map(function (o) { return '<option value="' + txt(o) + '">' + txt(AYUDA_OBS[o] || '') + '</option>'; }).join('') + '</datalist>' +
      '<datalist id="f4-dl-planes">' + d.listas.planes_ingreso.concat(d.listas.planes_egreso, d.listas.planes_fondos).map(function (p) { return '<option value="' + txt(p) + '">'; }).join('') + '</datalist>';
  }
  window.SigsoFinanzasHoja = { ver: ver, verFlujo: verFlujo, verSaldos: verSaldos, verCobros: verCobros };
})();
