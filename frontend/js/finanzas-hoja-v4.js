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
  var est_ = { periodo: '', cuenta: '', datos: null, sel: { r: 0, c: 1 }, editando: null, borrador: {}, guardando: false };
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
  function cifra(t, v, sub, clase, vacio) { return '<div class="fin4-cifra' + (clase ? ' ' + clase : '') + '"><span>' + txt(t) + '</span><b class="' + (v < 0 ? 'fin2-neg' : '') + '">' + (v === null || v === undefined ? txt(vacio || '—') : plata(v)) + '</b>' + (sub ? '<small>' + txt(sub) + '</small>' : '') + '</div>'; }
  function error(r, msg) { x_.aviso((r && r.message) || msg, 'error'); }

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
      pintar();
      seleccionar(lineas().length - 1, 0, true);
    });
  }
  function tomar(d) { est_.datos = d; est_.periodo = d.periodo; est_.cuenta = d.cuenta_ref; x_.contexto({ periodo_hoja: d.periodo, cuenta_ref: d.cuenta_ref }); }
  function recargar(enfocarId, col) {
    var x = x_, t = x_.turno();
    return x_.api('finanzasHoja', { periodo: est_.periodo, cuenta_ref: est_.cuenta }).then(function (r) {
      if (!x.vigente(t) || !r || !r.ok) return;
      var caja = x_.raiz().querySelector('.fin4-hoja-env'), arriba = caja ? caja.scrollTop : 0, izq = caja ? caja.scrollLeft : 0;
      tomar(r.data); pintar();
      var c2 = x_.raiz().querySelector('.fin4-hoja-env'); if (c2) { c2.scrollTop = arriba; c2.scrollLeft = izq; }
      var l = lineas(), i = enfocarId ? l.findIndex(function (z) { return z.f && z.f.id === enfocarId; }) : -1;
      seleccionar(i === -1 ? Math.min(est_.sel.r, l.length - 1) : i, col === undefined ? est_.sel.c : col, true);
    });
  }
  function editable() { return puede('REGISTRAR') && est_.datos && !est_.datos.cerrado && est_.datos.cuenta_ref; }
  // Las líneas de la hoja: las filas del servidor (anotadas y del banco sin anotar) y la fila nueva al final.
  function lineas() { var l = (est_.datos.filas || []).map(function (f) { return { f: f }; }); if (editable()) l.push({ nueva: true }); return l; }

  function pintar() {
    var d = est_.datos;
    var acciones = (editable() ? U.boton({ texto: 'Pegar desde Excel', icono: 'copiar', sm: true, variante: 'secundario', clase: 'js-f4-pegar' }) : '') +
      U.boton({ texto: 'Subir cartola', icono: 'subir', sm: true, clase: 'js-f4-cargar', datos: { cap: 'REGISTRAR' } });
    var meses = d.meses.slice(-8);
    if (meses.indexOf(d.periodo) === -1) meses.push(d.periodo);
    x_.pagina(x_.cab('planilla', acciones) +
      '<div class="sx2-pagina__cuerpo fin4">' +
        '<div class="fin4-barra">' +
          '<div class="fin4-meses" role="tablist" aria-label="Mes">' + meses.map(function (m) { return '<button type="button" role="tab" class="fin4-mes js-f4-mes" data-mes="' + m + '" aria-selected="' + (m === d.periodo) + '">' + txt(mesCorto(m)) + '</button>'; }).join('') + '</div>' +
          (d.cuentas.length > 1 ? '<label class="fin4-cuenta"><span>Cuenta</span><select class="fin2-input js-f4-cuenta">' + d.cuentas.map(function (c) { return '<option value="' + txt(c.id) + '"' + (c.id === d.cuenta_ref ? ' selected' : '') + '>' + txt(c.empresa + ' · ' + c.nombre) + '</option>'; }).join('') + '</select></label>' : (d.cuentas[0] ? '<span class="fin4-cuenta-1">' + txt(d.cuentas[0].empresa + ' · ' + d.cuentas[0].nombre) + '</span>' : '')) +
          '<span class="fin4-obs" aria-label="Atajos de OBS">OBS: ' + Object.keys(ATAJO_OBS).map(function (k) { return '<span title="' + txt(AYUDA_OBS[ATAJO_OBS[k]]) + '"><kbd>' + k + '</kbd> ' + txt(ATAJO_OBS[k]) + '</span>'; }).join('') + '</span>' +
        '</div>' +
        (d.cuentas.length ? franja(d) + hojaHtml(d) + gruposHtml(d) : U.card({ cuerpo: U.vacio({ icono: 'subir', titulo: 'Todavía no hay una cuenta del banco', texto: 'Sube la primera cartola del banco: con ella se crea la cuenta y empieza la planilla.', accion: U.boton({ texto: 'Subir cartola', icono: 'subir', variante: 'primario', clase: 'js-f4-cargar' }) }) })) +
      '</div>');
    x_.aplicarCapacidades(x_.raiz());
    ponerListas();
  }

  function franja(d) {
    var t = d.totales, c = d.cartola, e = d.estado;
    var cuadra = c && !e.falta && !e.esperando;
    var estado = !d.filas.length ? '<div class="fin4-estado fin4-estado--neutro">' + U.ico('info', 16) + '<span>Sin movimientos en ' + txt(mesLargo(d.periodo)) + '. Escribe la primera fila abajo o sube la cartola.</span></div>'
      : !c ? '<div class="fin4-estado fin4-estado--alerta">' + U.ico('reloj', 16) + '<span><b>Sin cartola todavía.</b> Lo anotado se comprueba cuando la subas.</span></div>'
        : cuadra ? '<div class="fin4-estado fin4-estado--ok">' + U.ico('check', 16) + '<span><b>Cuadra con la cartola.</b> Todo lo anotado está en el banco.</span></div>'
          : '<div class="fin4-estado fin4-estado--alerta">' + U.ico('alerta', 16) + '<span><b>Falta para cuadrar:</b> ' + [e.falta ? e.falta + ' del banco sin anotar (en naranjo)' : '', e.esperando ? e.esperando + ' anotada(s) que el banco no trae' : ''].filter(Boolean).join(' · ') + '</span></div>';
    return '<section class="fin4-franja" aria-label="Totales del mes">' +
      '<div class="fin4-caja"><h2>Resumen del mes</h2><div class="fin4-resumen">' +
        cifra('ABONO', t.ABONO, 'entró ' + plata(t.HONORARIOS) + ' · gastos ' + plata(-t.GASTOS)) + cifra('ABONO RENTA', t['ABONO RENTA']) +
        cifra('SALDO', t.SALDO, 'a favor de clientes') + cifra('PENDIENTE', t.PENDIENTE, 'grupos abiertos') +
        (t.FONDOS ? cifra('IVA e imposiciones', t.FONDOS, 'plata de clientes sin grupo') : '') +
        (t.OTRO_MES ? cifra('De otros meses', t.OTRO_MES, 'grupos que cierran en otro mes') : '') +
        (t.TRASPASOS ? cifra('Traspasos', t.TRASPASOS) : '') + (t.SIN_COMPLETAR ? cifra('Sin completar', t.SIN_COMPLETAR, e.por_completar + e.falta + ' fila(s)', 'fin4-cifra--alerta') : '') +
        cifra('TOTAL', t.TOTAL, '= neto del banco', 'fin4-cifra--total') +
      '</div></div>' +
      '<div class="fin4-caja"><h2>Banco · cartola</h2><div class="fin4-banco">' +
        cifra('Saldo inicial', c ? c.saldo_inicial : null) + cifra('Movimientos', c ? c.movimientos : null, null, '', 'sin cartola') + cifra('Saldo final', c ? c.saldo_final : null) +
        estado + '</div></div></section>';
  }

  function hojaHtml(d) {
    var l = lineas();
    var ed = editable();
    return '<div class="fin4-hoja-env" tabindex="-1"><table class="fin4-hoja" aria-label="Planilla de ' + txt(mesLargo(d.periodo)) + '"><thead><tr><th class="fin4-idx">#</th>' +
      COLS.map(function (k) { return '<th class="' + (k[0] === 'monto' ? 'fin4-n' : '') + '">' + k[1] + '</th>'; }).join('') + '<th class="fin4-n">Saldo</th><th>Qué es</th><th>Banco</th></tr></thead><tbody>' +
      l.map(function (z, i) { return filaHtml(z, i, ed); }).join('') + '</tbody></table></div>' +
      '<div class="fin4-pie-hoja"><p class="fin4-ayuda js-f4-ayuda" aria-live="polite"></p>' +
      (ed ? '<p class="fin4-teclas"><span><kbd>Enter</kbd> escribe · guarda y baja</span><span><kbd>Tab</kbd> siguiente</span><span><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> moverse</span><span><kbd>Supr</kbd> borra la celda</span><span><kbd>Ctrl</kbd>+<kbd>V</kbd> pega filas del Excel</span></p>'
        : '<p class="fin4-teclas">' + (d.cerrado ? 'El mes está cerrado: la planilla se ve, pero no se edita.' : 'Tu acceso es de lectura.') + '</p>') + '</div>';
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
  function filaHtml(z, i, ed) {
    var f = z.f || {}, v = valores(z);
    var clase = z.nueva ? 'fin4-fila--nueva' : f.banco === 'falta' ? 'fin4-fila--falta' : (f.que && f.que.k === 'rev') ? 'fin4-fila--rev' : '';
    var ph = z.nueva ? { fecha: 'día', nombre: 'escribe aquí para anotar', obs: 'OBS', monto: '+ entra / − sale' } : f.banco === 'falta' ? { nombre: '¿quién es?', obs: 'OBS' } : {};
    var banco = z.nueva ? (est_.borrador.fecha || est_.borrador.monto ? '<span class="fin4-chip fin4-chip--borr">sin guardar</span>' : '')
      : f.banco === 'ok' ? '<span class="fin4-chip fin4-chip--ok">✓ banco</span>' : f.banco === 'esperando' ? '<span class="fin4-chip fin4-chip--esp">esperando</span>' : '<span class="fin4-chip fin4-chip--falta">falta anotar</span>';
    var que = z.nueva ? '' : '<span class="fin4-que fin4-que--' + (QUE_TONO[f.que.k] || 'neutro') + '">' + txt(f.que.t) + '</span>' + (f.cliente && f.cliente !== f.nombre ? '<small class="fin4-que-cli">' + txt(f.cliente) + '</small>' : '');
    return '<tr class="fin4-fila ' + clase + '" data-i="' + i + '"><td class="fin4-idx">' + (z.nueva ? '+' : i + 1) + '</td>' +
      COLS.map(function (k, j) {
        var b = bloqueada(z, k[0]);
        var num = k[0] === 'monto';
        var tono = num && !z.nueva ? (f.monto < 0 ? ' fin2-neg' : ' fin2-pos') : num && est_.borrador.monto ? (est_.borrador.monto < 0 ? ' fin2-neg' : ' fin2-pos') : '';
        return '<td class="fin4-cel fin4-c-' + k[0] + (num ? ' fin4-n' : '') + (b ? ' fin4-bloq' : '') + (k[0] === 'glosa' && !z.nueva && f.banco !== 'esperando' ? ' fin4-tenue' : '') + '" data-r="' + i + '" data-c="' + j + '"' + (ed && !b ? '' : ' aria-readonly="true"') + '>' +
          '<span class="fin4-v' + tono + '" data-ph="' + txt(ph[k[0]] || '') + '">' + txt(v[k[0]]) + '</span></td>';
      }).join('') +
      '<td class="fin4-n fin4-saldo"><span class="fin4-v">' + (z.nueva ? '' : plata(f.saldo)) + '</span></td>' +
      '<td class="fin4-c-que"><span class="fin4-v">' + que + '</span></td>' +
      '<td class="fin4-c-banco"><span class="fin4-v">' + banco + '</span></td></tr>';
  }
  function gruposHtml(d) {
    var g = d.grupos || [];
    return '<section class="fin4-caja fin4-grupos" aria-label="Grupos de fondos"><h2>Grupos de fondos</h2>' +
      '<p class="fin4-sub">Pon la misma letra en la columna Grupo a lo que el cliente mandó y a lo que se pagó por él (es la fórmula de UNITARIO, sin fórmulas). Lo que sobra se calcula solo; tú eliges qué pasa con eso.</p>' +
      (g.length ? '<div class="fin4-grupos__lista">' + g.map(function (x) {
        return '<div class="fin4-grupo"><div class="fin4-grupo__cab"><b>Grupo ' + txt(x.letra) + '</b><span>' + txt(x.cliente || 'sin nombre') + '</span></div>' +
          '<div class="fin4-grupo__nums"><span>Entró <b>' + plata(x.entra) + '</b></span><span>Salió <b>' + plata(x.sale) + '</b></span><span>Sobra <b class="' + (x.suma < 0 ? 'fin2-neg' : '') + '">' + plata(x.suma) + '</b></span></div>' +
          '<label class="fin4-grupo__dec"><span>Lo que sobra</span><select class="fin2-input js-f4-decision" data-letra="' + txt(x.letra) + '"' + (editable() ? '' : ' disabled') + '>' +
            DECIS.map(function (o) { return '<option value="' + o[0] + '"' + (x.decision === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
          (x.otro_mes ? '<small class="fin4-grupo__aviso">' + U.ico('alerta', 13) + ' Tiene filas de otro mes' + (x.remanente_excel !== null ? ': según el Excel sobran ' + plata(x.remanente_excel) : '') + '.</small>' : '') +
          (x.excel ? '<small class="fin4-sub">Viene del Excel BANCOS (su fila de cierre decía ' + txt(x.decision) + ').</small>' : '') +
        '</div>';
      }).join('') + '</div>' : '<p class="fin4-sub">Este mes no tiene grupos.</p>') + '</section>';
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
      if (!r || !r.ok) { f[campo] = previo; error(r, 'No se pudo guardar.'); }
      recargar(null);
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
    tb.innerHTML = lineas().map(function (z, i) { return filaHtml(z, i, ed); }).join('');
    seleccionar(est_.sel.r, est_.sel.c, true);
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
        x_.api('finanzasHojaBorrar', { id: f.id }).then(function (r) { if (!r || !r.ok) error(r, 'No se pudo borrar.'); else x_.aviso('Borrado.', 'exito'); recargar(null); });
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
  var rep_ = { hasta: '', meses: 6, empresa: '', periodo: '', facturas: 'abiertas' };
  function selectorMes(clase, actual, meses) { return '<select class="fin2-input ' + clase + '">' + meses.map(function (m) { return '<option value="' + m + '"' + (m === actual ? ' selected' : '') + '>' + txt(mesLargo(m)) + '</option>'; }).join('') + '</select>'; }
  function ultimosMeses(n) { var out = [], a = hoy().slice(0, 7).split('-').map(Number); for (var i = 0; i < n; i++) { var d = new Date(Date.UTC(a[0], a[1] - 1 - i, 1)); out.push(d.toISOString().slice(0, 7)); } return out; }

  function verFlujo(x) {
    x_ = x; enlazar();
    rep_.hasta = rep_.hasta || hoy().slice(0, 7);
    var t = x.turno();
    x.pagina(x.cab('flujo') + U.esqueleto('tabla', 14));
    x.api('finanzasHojaFlujo', { hasta: rep_.hasta, meses: rep_.meses, empresa: rep_.empresa }).then(function (r) {
      if (!x.vigente(t)) return;
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('flujo') + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo armar el FLUJO', texto: (r && r.message) || '' }) })); return; }
      var d = r.data, M = d.meses;
      function fila(nombre, val, clase) { var tot = M.reduce(function (s, m) { return s + ((val || {})[m] || 0); }, 0); return '<tr' + (clase ? ' class="' + clase + '"' : '') + '><th>' + txt(nombre) + '</th>' + M.map(function (m) { var v = (val || {})[m] || 0; return '<td class="fin4-n' + (v ? '' : ' fin4-cero') + '">' + plata(v, '—') + '</td>'; }).join('') + '<td class="fin4-n fin4-tot">' + plata(tot, '—') + '</td></tr>'; }
      function suma(lista) { var o = {}; lista.forEach(function (l) { M.forEach(function (m) { o[m] = (o[m] || 0) + (l.valores[m] || 0); }); }); return o; }
      var ti = suma(d.ingresos), te = suma(d.egresos), mg = {}; M.forEach(function (m) { mg[m] = (ti[m] || 0) - (te[m] || 0); });
      var sec = function (t2) { return '<tr class="fin4-sec"><th colspan="' + (M.length + 2) + '">' + txt(t2) + '</th></tr>'; };
      var avisos = M.filter(function (m) { var z = d.resumen[m]; return z.por_completar || z.falta; }).map(function (m) { var z = d.resumen[m]; return mesLargo(m) + ': ' + [z.falta ? z.falta + ' del banco sin anotar' : '', z.por_completar ? z.por_completar + ' fila(s) por completar' : ''].filter(Boolean).join(', '); });
      x.pagina(x.cab('flujo') + '<div class="sx2-pagina__cuerpo fin4">' +
        '<div class="fin4-barra">' +
          '<label class="fin4-cuenta"><span>Hasta</span>' + selectorMes('js-f4-hasta', rep_.hasta, ultimosMeses(18)) + '</label>' +
          '<label class="fin4-cuenta"><span>Meses</span><select class="fin2-input js-f4-nmeses">' + [3, 6, 12].map(function (n) { return '<option' + (n === rep_.meses ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
          '<label class="fin4-cuenta"><span>Empresa</span><select class="fin2-input js-f4-empresa"><option value="">Todo el grupo</option>' + d.empresas.map(function (e) { return '<option' + (e === rep_.empresa ? ' selected' : '') + '>' + txt(e) + '</option>'; }).join('') + '</select></label>' +
        '</div>' +
        (avisos.length ? '<div class="fin4-estado fin4-estado--alerta">' + U.ico('alerta', 16) + '<span><b>Hay filas sin completar</b> que todavía no entran al FLUJO. ' + txt(avisos.join(' · ')) + '</span></div>' : '') +
        '<div class="fin4-rep"><table class="fin4-tab"><thead><tr><th>Plan de cuenta</th>' + M.map(function (m) { return '<th class="fin4-n">' + txt(mesCorto(m)) + '</th>'; }).join('') + '<th class="fin4-n">Total</th></tr></thead><tbody>' +
          sec('Ingresos') + d.ingresos.map(function (l) { return fila(l.plan, l.valores); }).join('') + fila('Total ingresos', ti, 'fin4-subt') +
          sec('Egresos') + d.egresos.map(function (l) { return fila(l.plan, l.valores); }).join('') + fila('Total egresos', te, 'fin4-subt') +
          fila('Margen del mes', mg, 'fin4-res') +
          sec('Fondos de clientes (no son de la empresa)') + fila('Recibido de clientes', d.fondos.recibido) + fila('Pagado por cuenta de clientes', d.fondos.pagado) + fila('Lo que sobró, cobrado como honorario', d.fondos.honorario) + fila('Lo que sobró, a favor del cliente', d.fondos.a_favor) +
          sec('Otros') + fila('Traspasos y préstamos', d.otros.traspasos) + fila('Sin completar', d.otros.sin_completar) +
        '</tbody></table></div><p class="fin4-sub">Sale solo de la planilla: cada fila cae en su plan de cuenta. El dinero de los clientes (IVA, imposiciones) va aparte, para no inflar los ingresos ni los gastos.</p></div>');
    });
  }

  function verSaldos(x) {
    x_ = x; enlazar();
    rep_.periodo = rep_.periodo || hoy().slice(0, 7);
    var t = x.turno();
    x.pagina(x.cab('saldos') + U.esqueleto('tabla', 12));
    x.api('finanzasHojaClientes', { periodo: rep_.periodo }).then(function (r) {
      if (!x.vigente(t)) return;
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('saldos') + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo calcular', texto: (r && r.message) || '' }) })); return; }
      var d = r.data, l = d.clientes;
      var tot = l.reduce(function (s, c) { s.saldo += c.saldo; s.deuda += c.deuda; s.hon += c.honorarios_mes; if (c.saldo < 0) s.neg++; return s; }, { saldo: 0, deuda: 0, hon: 0, neg: 0 });
      x.pagina(x.cab('saldos') + '<div class="sx2-pagina__cuerpo fin4">' +
        '<div class="fin4-barra"><label class="fin4-cuenta"><span>Hasta</span>' + selectorMes('js-f4-periodo', rep_.periodo, ultimosMeses(18)) + '</label><span class="fin4-sub">Saldo acumulado desde ' + txt(mesLargo(d.desde)) + '.</span></div>' +
        '<div class="fin4-tarjetas">' +
          '<div class="fin4-caja">' + cifra('Plata de clientes en la cuenta', tot.saldo, 'recibido − pagado − cobrado') + '</div>' +
          '<div class="fin4-caja">' + cifra('Honorarios de ' + mesLargo(d.periodo), tot.hon) + '</div>' +
          '<div class="fin4-caja">' + cifra('Facturas por cobrar', tot.deuda) + '</div>' +
          '<div class="fin4-caja' + (tot.neg ? ' fin4-caja--alerta' : '') + '">' + '<div class="fin4-cifra"><span>Clientes en negativo</span><b>' + tot.neg + '</b><small>se pagó más de lo que mandaron</small></div></div>' +
        '</div>' +
        (l.length ? '<div class="fin4-rep"><table class="fin4-tab"><thead><tr><th>Cliente</th><th class="fin4-n">Honorarios del mes</th><th class="fin4-n">Fondos recibidos</th><th class="fin4-n">Pagado por él</th><th class="fin4-n">Sobró, cobrado</th><th class="fin4-n">Saldo de fondos</th><th class="fin4-n">Debe en facturas</th></tr></thead><tbody>' +
          l.map(function (c) { return '<tr><th>' + txt(c.cliente) + (c.sin_ficha ? ' <small class="fin4-sub">sin ficha</small>' : '') + '</th><td class="fin4-n">' + plata(c.honorarios_mes, '—') + '</td><td class="fin4-n">' + plata(c.recibido, '—') + '</td><td class="fin4-n">' + plata(c.pagado, '—') + '</td><td class="fin4-n">' + plata(c.cobrado, '—') + '</td><td class="fin4-n ' + (c.saldo < 0 ? 'fin2-neg' : '') + '"><b>' + plata(c.saldo, '—') + '</b></td><td class="fin4-n ' + (c.deuda ? 'fin2-neg' : '') + '">' + plata(c.deuda, '—') + (c.facturas ? ' <small>(' + c.facturas + ')</small>' : '') + '</td></tr>'; }).join('') +
          '</tbody></table></div>' : U.card({ cuerpo: U.vacio({ icono: 'equipo', titulo: 'Sin clientes con movimiento', texto: 'Aparecen cuando la planilla tiene filas con su nombre.' }) })) +
        '<p class="fin4-sub">Saldo de fondos = lo que el cliente mandó para sus obligaciones − lo que se pagó por él − lo que sobró y se cobró como honorario. Un saldo negativo es plata que hay que pedirle. «Sin ficha»: el nombre de la planilla no está enlazado a un cliente de SIGSO (se enseña en la planilla, al abrir la fila).</p></div>');
    });
  }

  function verCobros(x) {
    x_ = x; enlazar();
    var t = x.turno();
    x.pagina(x.cab('cobros') + U.esqueleto('tabla', 12));
    x.api('finanzasHojaCobranza', { estado: rep_.facturas }).then(function (r) {
      if (!x.vigente(t)) return;
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('cobros') + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar la cobranza', texto: (r && r.message) || '' }) })); return; }
      var d = r.data, T = d.totales;
      var tono = { Pagada: 'ok', Parcial: 'info', Vencida: 'critico', Pendiente: 'neutro', Incobrable: 'neutro' };
      x.pagina(x.cab('cobros', U.boton({ texto: 'Subir facturas o ventas del SII', icono: 'subir', sm: true, clase: 'js-f4-cargar', datos: { cap: 'REGISTRAR' } })) + '<div class="sx2-pagina__cuerpo fin4">' +
        '<div class="fin4-tarjetas">' +
          '<div class="fin4-caja">' + cifra('Facturado', T.facturado) + '</div><div class="fin4-caja">' + cifra('Pagado', T.pagado) + '</div>' +
          '<div class="fin4-caja">' + cifra('Por cobrar', T.por_cobrar) + '</div><div class="fin4-caja' + (T.vencido ? ' fin4-caja--alerta' : '') + '">' + cifra('Vencido', T.vencido) + '</div>' +
        '</div>' +
        '<div class="fin4-barra">' + U.segmento([{ id: 'abiertas', texto: 'Por cobrar' }, { id: 'todas', texto: 'Todas' }], rep_.facturas, 'js-f4-fact') + '<span class="fin4-sub">' + d.facturas.length + ' de ' + d.total_facturas + ' factura(s)</span></div>' +
        (d.facturas.length ? '<div class="fin4-rep"><table class="fin4-tab"><thead><tr><th>N°</th><th>Cliente</th><th>Empresa</th><th>Emisión</th><th>Vence</th><th class="fin4-n">Total</th><th class="fin4-n">Pagado</th><th class="fin4-n">Saldo</th><th>Estado</th></tr></thead><tbody>' +
          d.facturas.map(function (f) { return '<tr><th>' + txt(f.folio) + '</th><td>' + txt(f.cliente) + '</td><td>' + txt(f.empresa) + '</td><td class="fin2-num">' + txt(f.fecha) + '</td><td class="fin2-num">' + txt(f.vence || '') + '</td><td class="fin4-n">' + plata(f.total) + '</td><td class="fin4-n">' + plata(f.pagado, '—') + '</td><td class="fin4-n"><b>' + plata(f.saldo, '—') + '</b></td><td>' + U.badge(f.estado, tono[f.estado] || 'neutro') + '</td></tr>'; }).join('') +
          '</tbody></table></div>' : U.card({ cuerpo: U.vacio({ icono: 'recibo', titulo: rep_.facturas === 'abiertas' ? 'No hay facturas por cobrar' : 'Todavía no hay facturas', texto: 'Las facturas entran con el Registro de Ventas del SII o la hoja FACTURAS de la planilla, en «Subir archivos».' }) })) +
        '<p class="fin4-sub">Una factura queda pagada cuando, en la planilla, la fila del abono lleva su número en la columna «N° factura». No hay otra hoja de pagos que llenar.</p></div>');
      x.aplicarCapacidades(x.raiz());
    });
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
      if (b && b.classList.contains('js-f4-fact')) { rep_.facturas = b.dataset.id || rep_.facturas; verCobros(x_); return; }
      var cel = t.closest('.fin4-hoja td.fin4-cel');
      if (cel && !t.closest('input')) {
        if (est_.editando) confirmar();
        seleccionar(+cel.dataset.r, +cel.dataset.c, true);
        if (ev.detail >= 2) editar();
      }
    });
    raiz.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.classList.contains('js-f4-cuenta')) { est_.cuenta = t.value; est_.borrador = {}; x_.contexto({ cuenta_ref: t.value }); ver(x_); }
      else if (t.classList.contains('js-f4-decision')) {
        x_.api('finanzasHojaGrupo', { cuenta_ref: est_.cuenta, periodo: est_.periodo, letra: t.dataset.letra, decision: t.value }).then(function (r) { if (!r || !r.ok) error(r, 'No se pudo guardar.'); recargar(null); });
      }
      else if (t.classList.contains('js-f4-hasta')) { rep_.hasta = t.value; verFlujo(x_); }
      else if (t.classList.contains('js-f4-nmeses')) { rep_.meses = Number(t.value); verFlujo(x_); }
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
