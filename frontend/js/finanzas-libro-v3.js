/**
 * finanzas-libro-v3.js — El libro del banco (Finanzas v3 «banco primero», 21-10-2026;
 * backend/logica/finanzasLibro.js). Es la pantalla principal de Finanzas: una fila
 * por movimiento de la cuenta, como en el Excel BANCOS, con:
 *
 *  - quién (nombre corto o pagador), lo que dice el banco, la CATEGORÍA (ABONO,
 *    ABONO RENTA, GASTO, FONDOS de clientes, TRASPASO, PRÉSTAMO o sin clasificar),
 *    el cliente o concepto, el GRUPO de fondos y el saldo acumulado del mes;
 *  - el cuadre del mes contra la cartola (saldo inicial + entradas − salidas =
 *    saldo final) y el resumen por categoría, con los mismos nombres de la planilla;
 *  - clasificar una fila (panel), marcar varias y formar un grupo de fondos
 *    (la fórmula de UNITARIO del Excel), y lo que no pasa por el banco
 *    (efectivo, compensaciones y remanentes cobrados como honorario) aparte.
 */
(function () {
  'use strict';

  var U = UIv2;
  var x_ = null, cat_ = null;
  var est_ = { periodo: '', cuenta: '', filtro: 'todos', busca: '', datos: null, sel: {} };
  document.addEventListener('sigso-fin-cerrada', function () { est_.datos = null; est_.sel = {}; });

  // Las categorías con las palabras del Excel BANCOS, su explicación y su tono.
  var CAT = {
    ABONO: ['Honorario', 'Ingreso de la empresa (lo que en la planilla es ABONO)', 'ok'],
    'ABONO RENTA': ['Renta', 'Ingreso por servicio de renta (ABONO RENTA)', 'ok'],
    GASTO: ['Gasto', 'Gasto de la empresa: sueldos, arriendo, cuentas…', 'critico'],
    FONDOS: ['Fondos cliente', 'Plata del cliente para sus obligaciones (IVA, imposiciones, convenios): no es de la empresa', 'info'],
    TRASPASO: ['Traspaso', 'Entre cuentas propias', 'neutro'],
    PRESTAMO: ['Préstamo', 'Con otra empresa del grupo', 'neutro'],
    'SIN CLASIFICAR': ['Por revisar', 'Todavía no se dice qué es', 'alerta']
  };
  var FILTROS = [['todos', 'Todos'], ['revisar', 'Por revisar'], ['ABONO', 'Honorarios'], ['ABONO RENTA', 'Renta'], ['GASTO', 'Gastos'], ['FONDOS', 'Fondos de clientes'], ['otros', 'Traspasos y préstamos'], ['sincartola', 'Sin cartola']];

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function plata(n) { var v = Math.round(Number(n) || 0); return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('es-CL'); }
  function corta(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '-' + p[1] : ''; }
  function mesLargo(p) { var m = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']; var a = String(p || '').split('-'); return a.length === 2 ? m[Number(a[1]) - 1] + ' ' + a[0] : p; }
  function hoyMes() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()).slice(0, 7); }
  function opciones(l, actual, vacio) { return (vacio !== undefined ? '<option value="">' + txt(vacio) + '</option>' : '') + l.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return '<option value="' + txt(v) + '"' + (String(v) === String(actual) ? ' selected' : '') + '>' + txt(t) + '</option>'; }).join(''); }
  function catChip(c) { var k = CAT[c] || CAT['SIN CLASIFICAR']; return '<span class="fin3-cat fin3-cat--' + k[2] + '" title="' + txt(k[1]) + '">' + txt(k[0]) + '</span>'; }

  // =====================================================================================
  function ver(x) {
    x_ = x; enlazar();
    var c = x.contexto();
    est_.periodo = c.periodo_libro || est_.periodo || '';
    est_.cuenta = c.cuenta_ref || est_.cuenta || '';
    var t = x.turno();
    x.pagina(x.cab('libro') + U.esqueleto('tabla', 12));
    Promise.all([x.catalogo(), x.api('finanzasLibro', { periodo: est_.periodo || hoyMes(), cuenta_ref: est_.cuenta })]).then(function (rs) {
      if (!x.vigente(t)) return;
      cat_ = rs[0];
      var r = rs[1];
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('libro') + U.card({ cuerpo: U.vacio({ accion: '<button type="button" class="sx2-boton sx2-boton--secundario sx2-boton--sm js-fin-reintentar">Reintentar</button>', icono: 'alerta', titulo: 'No se pudo cargar el libro', texto: (r && r.message) || '' }) })); return; }
      // Sin datos en el mes pedido: se abre el último mes con movimientos.
      if (!est_.periodo && !r.data.lineas.length && r.data.meses.length) { est_.periodo = r.data.meses[0]; x.contexto({ periodo_libro: est_.periodo }); return ver(x); }
      est_.periodo = r.data.periodo;
      est_.datos = r.data; est_.sel = {};
      pintar();
    });
  }
  function recargar() { var x = x_, t = x_.turno(); return x_.api('finanzasLibro', { periodo: est_.periodo, cuenta_ref: est_.cuenta }).then(function (r) { if (!x.vigente(t) || !r || !r.ok) return; est_.datos = r.data; est_.sel = {}; pintar(); }); }

  function visibles() {
    var d = est_.datos, q = est_.busca.toLowerCase();
    return d.lineas.filter(function (l) {
      var f = est_.filtro;
      if (f === 'revisar' && l.estado === 'CONFIRMADO') return false;
      if (f === 'sincartola' && l.verificado) return false;
      if (f === 'otros' && l.categoria !== 'TRASPASO' && l.categoria !== 'PRESTAMO') return false;
      if (CAT[f] && f !== 'SIN CLASIFICAR' && l.categoria !== f) return false;
      if (q && (l.quien + ' ' + l.glosa + ' ' + l.cliente + ' ' + l.cuenta_concepto + ' ' + Math.abs(l.monto)).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function pintar() {
    var d = est_.datos;
    var meses = d.meses.indexOf(d.periodo) === -1 ? [d.periodo].concat(d.meses) : d.meses;
    var acciones = U.boton({ texto: 'Subir cartola o planilla', icono: 'subir', sm: true, clase: 'js-fl-cargar', datos: { cap: 'REGISTRAR' } });
    x_.pagina(x_.cab('libro', acciones) +
      '<div class="sx2-pagina__cuerpo fin3">' +
        '<div class="fin3-barra">' +
          '<label class="fin2-campo fin2-campo--fila"><span>Mes</span><select class="fin2-input js-fl-mes">' + opciones(meses.map(function (m) { return [m, mesLargo(m)]; }), d.periodo) + '</select></label>' +
          '<label class="fin2-campo fin2-campo--fila"><span>Cuenta</span><select class="fin2-input js-fl-cuenta">' + opciones(d.cuentas.map(function (c) { return [c.id, c.nombre + ' · ' + c.empresa]; }), est_.cuenta, 'Todas') + '</select></label>' +
          '<label class="fin2-busca"><span class="sx2-oculto">Buscar</span>' + U.ico('lupa', 16) + '<input class="fin2-input js-fl-busca" placeholder="Nombre, cliente o monto" value="' + txt(est_.busca) + '"></label>' +
        '</div>' +
        cuadre(d) + resumen(d) +
        '<div class="fin3-filtros" role="group" aria-label="Qué mostrar">' + FILTROS.map(function (f) { return U.chip({ texto: f[1], activo: est_.filtro === f[0], clase: 'js-fl-filtro', datos: { id: f[0] }, n: cuenta(f[0]) }); }).join('') + '</div>' +
        '<div class="fin3-lote js-fl-lote" hidden></div>' +
        '<div class="fin3-tabla-envoltura"><table class="fin3-libro">' +
          '<thead><tr><th class="fin3-chk"><input type="checkbox" class="js-fl-todas" aria-label="Marcar todas" data-cap="FONDOS"></th><th>Fecha</th><th>Movimiento</th><th>Categoría</th><th>Cliente · concepto</th><th class="fin2-der">Monto</th><th class="fin2-der">Saldo del mes</th><th aria-label="Estado"></th></tr></thead>' +
          '<tbody class="js-fl-filas">' + filas() + '</tbody></table></div>' +
        fueraBanco(d) +
      '</div>');
    x_.aplicarCapacidades(x_.raiz());
    pintarLote();
  }
  function cuenta(f) { var a = est_.filtro; est_.filtro = f; var b = est_.busca; est_.busca = ''; var n = visibles().length; est_.filtro = a; est_.busca = b; return n; }

  function cuadre(d) {
    var entra = 0, sale = 0;
    d.lineas.forEach(function (l) { if (l.monto > 0) entra += l.monto; else sale += l.monto; });
    var c = d.cartola;
    var calc = c ? c.saldo_inicial + entra + sale : null;
    var ok = c && Math.round(calc) === Math.round(c.saldo_final);
    var estado = !d.lineas.length ? U.badge('Sin movimientos', 'neutro') : d.sin_cartola && !d.verificados ? U.badge('Sin cartola: no verificado contra el banco', 'alerta') : ok ? U.badge('Cuadra con la cartola', 'ok') : U.badge('No cuadra con la cartola', 'critico');
    return '<section class="fin3-cuadre" aria-label="Cuadre con el banco">' +
      '<div class="fin3-cuadre__t">' + U.ico('dinero', 18) + '<b>Cuadre del mes</b>' + estado + (d.sin_cartola && d.verificados ? '<span class="fin2-ayuda">' + d.sin_cartola + ' fila(s) sin cartola</span>' : '') + '</div>' +
      '<div class="fin3-ecuacion">' +
        celda('Saldo inicial', c ? plata(c.saldo_inicial) : '—') + '<span class="fin3-op">+</span>' + celda('Entró', plata(entra), 'pos') + '<span class="fin3-op">−</span>' + celda('Salió', plata(-sale), 'neg') +
        '<span class="fin3-op">=</span>' + celda('Saldo final', calc !== null ? plata(calc) : plata(entra + sale), ok ? 'ok' : '') + (c ? celda('Cartola dice', plata(c.saldo_final), '') : '') +
      '</div></section>';
  }
  function celda(t, v, tono) { return '<div class="fin3-celda' + (tono ? ' fin3-celda--' + tono : '') + '"><span>' + txt(t) + '</span><b>' + v + '</b></div>'; }

  function resumen(d) {
    var r = d.resumen, fb = d.fuera_banco.resumen;
    var orden = ['ABONO', 'ABONO RENTA', 'GASTO', 'FONDOS', 'TRASPASO', 'PRESTAMO', 'SIN CLASIFICAR'];
    return '<section class="fin3-resumen" aria-label="Resumen del mes por categoría">' + orden.filter(function (k) { return r[k] || fb[k] || k === 'ABONO' || k === 'FONDOS'; }).map(function (k) {
      var extra = fb[k] ? '<small>' + (fb[k] > 0 ? '+ ' : '') + plata(fb[k]) + ' sin banco</small>' : '';
      return '<button type="button" class="fin3-res fin3-res--' + CAT[k][2] + ' js-fl-filtro" data-id="' + txt(k === 'SIN CLASIFICAR' ? 'revisar' : k) + '" title="' + txt(CAT[k][1]) + '"><span>' + txt(CAT[k][0]) + '</span><b>' + plata(r[k]) + '</b>' + extra + '</button>';
    }).join('') + '<div class="fin3-res fin3-res--total"><span>Neto del banco</span><b>' + plata(d.neto) + '</b><small>= suma de las categorías</small></div></section>';
  }

  function filas() {
    var l = visibles();
    if (!l.length) return '<tr><td colspan="8">' + U.vacio({ icono: 'dinero', titulo: est_.datos.lineas.length ? 'Nada con este filtro' : 'Este mes no tiene movimientos', texto: est_.datos.lineas.length ? '' : 'Sube la cartola del banco (o la planilla BANCOS del mes) para empezar.' }) + '</td></tr>';
    return l.map(function (x) {
      var revisar = x.estado !== 'CONFIRMADO';
      var concepto = x.cliente ? '<b>' + txt(x.cliente) + '</b>' + (x.cuenta_concepto ? '<small>' + txt(x.cuenta_concepto) + '</small>' : '') : (x.cuenta_concepto ? txt(x.cuenta_concepto) : '<span class="fin2-ayuda">—</span>');
      var plan = x.planilla && revisar ? '<small class="fin3-plan">Planilla: ' + txt([x.planilla.alias, x.planilla.obs, x.planilla.plan].filter(Boolean).join(' · ')) + '</small>' : '';
      return '<tr class="fin3-fila' + (revisar ? ' fin3-fila--revisar' : '') + (x.verificado ? '' : ' fin3-fila--sincartola') + '" data-id="' + txt(x.id) + '" tabindex="0">' +
        '<td class="fin3-chk"><input type="checkbox" class="js-fl-sel" data-id="' + txt(x.id) + '"' + (est_.sel[x.id] ? ' checked' : '') + ' aria-label="Marcar" data-cap="FONDOS"></td>' +
        '<td class="fin2-num">' + corta(x.fecha) + '</td>' +
        '<td class="fin3-mov">' + (x.quien ? '<b>' + txt(x.quien) + '</b>' : '') + '<span class="fin3-glosa">' + txt(x.glosa) + '</span>' + plan + '</td>' +
        '<td>' + catChip(revisar ? 'SIN CLASIFICAR' : x.categoria) + (x.partes > 1 ? '<small class="fin2-ayuda"> +' + (x.partes - 1) + '</small>' : '') + '</td>' +
        '<td class="fin3-concepto">' + concepto + (x.grupo ? '<span class="fin3-grupo" title="Grupo de fondos">Grupo · ' + txt(x.grupo.obligacion) + (x.grupo.periodo ? ' ' + txt(x.grupo.periodo) : '') + '</span>' : '') + '</td>' +
        '<td class="fin2-der fin2-num ' + (x.monto < 0 ? 'fin2-neg' : 'fin2-pos') + '">' + plata(x.monto) + '</td>' +
        '<td class="fin2-der fin2-num fin3-saldo">' + plata(x.saldo_mes) + '</td>' +
        '<td class="fin3-est">' + (x.verificado ? '<span title="Está en la cartola del banco">' + U.ico('check', 14) + '</span>' : '<span class="fin3-sc" title="Viene de la planilla: falta la cartola para verificarlo">sin cartola</span>') + '</td>' +
      '</tr>';
    }).join('');
  }

  function fueraBanco(d) {
    var l = d.fuera_banco.lineas;
    if (!l.length) return '';
    return U.card({ titulo: 'Fuera del banco', icono: 'caja', sub: 'efectivo, compensaciones y remanentes cobrados como honorario: no mueven el saldo de la cuenta', sinRelleno: true,
      cuerpo: '<div class="fin2-tabla-envoltura"><table class="fin2-tabla fin2-tabla--chica"><thead><tr><th>Fecha</th><th>Qué</th><th>Categoría</th><th>Cliente · concepto</th><th class="fin2-der">Monto</th></tr></thead><tbody>' +
        l.map(function (x) { return '<tr><td class="fin2-num">' + corta(x.fecha) + '</td><td>' + txt(x.glosa) + '<small class="fin2-ayuda"> · ' + txt(x.medio.toLowerCase()) + '</small></td><td>' + catChip(x.categoria) + '</td><td>' + txt(x.cliente) + ' <small class="fin2-ayuda">' + txt(x.cuenta_concepto) + '</small></td><td class="fin2-der fin2-num ' + (x.monto < 0 ? 'fin2-neg' : 'fin2-pos') + '">' + plata(x.monto) + '</td></tr>'; }).join('') +
      '</tbody></table></div>' });
  }

  // ---- marcar varias y formar un grupo de fondos -------------------------------------------
  function marcadas() { return Object.keys(est_.sel).filter(function (k) { return est_.sel[k]; }); }
  function pintarLote() {
    var el = x_.raiz().querySelector('.js-fl-lote'); if (!el) return;
    var ids = marcadas();
    if (!ids.length) { el.hidden = true; el.innerHTML = ''; return; }
    var suma = 0; est_.datos.lineas.forEach(function (l) { if (est_.sel[l.id]) suma += l.monto; });
    el.hidden = false;
    el.innerHTML = '<span><b>' + ids.length + ' fila(s)</b> · suman ' + plata(suma) + (suma ? ' (eso queda como remanente del grupo)' : ' (el grupo queda en cero)') + '</span>' +
      U.boton({ texto: 'Formar grupo de fondos', icono: 'enlace', variante: 'primario', sm: true, clase: 'js-fl-agrupar', datos: { cap: 'FONDOS' } }) +
      U.boton({ texto: 'Desmarcar', sm: true, variante: 'fantasma', clase: 'js-fl-desmarcar' });
  }
  function agrupar() {
    var ids = marcadas(); if (!ids.length) return;
    var versiones = {}; est_.datos.lineas.forEach(function (l) { if (est_.sel[l.id]) versiones[l.id] = l.version; });
    var primera = est_.datos.lineas.filter(function (l) { return est_.sel[l.id]; })[0] || {};
    var oblig = ((cat_.tipos || []).filter(function (t) { return t.id === 'FONDO_RECIBIDO'; })[0] || {}).cuentas || [];
    var prev = (function () { var a = est_.periodo.split('-'); var dd = new Date(Date.UTC(+a[0], +a[1] - 2, 1)); return dd.toISOString().slice(0, 7); })();
    var dr = U.drawer({ titulo: 'Formar grupo de fondos', subtitulo: '<span class="fin2-ayuda">' + ids.length + ' fila(s) del libro: lo que el cliente mandó y lo que se pagó por él</span>',
      cuerpo: '<form class="fin2-p js-fl-grupo">' +
        '<label class="fin2-campo"><span>Cliente</span><input class="fin2-input" name="cliente" list="fl-clientes" required placeholder="Nombre o RUT" value="' + txt(primera.cliente || '') + '"><datalist id="fl-clientes">' + (cat_.clientes || []).map(function (c) { return '<option value="' + txt(c.nombre) + '">' + txt(c.rut) + '</option>'; }).join('') + '</datalist></label>' +
        '<label class="fin2-campo"><span>Obligación</span><select class="fin2-input" name="obligacion" required>' + opciones(oblig, primera.cuenta_concepto || '', 'Elige…') + '</select></label>' +
        '<label class="fin2-campo"><span>Período de la obligación</span><input class="fin2-input" type="month" name="periodo" value="' + txt(prev) + '"></label>' +
        '<p class="fin2-ayuda">Las filas quedan como plata del cliente (lo que entra, recibido; lo que sale, pagado por él). Lo que sobre o falte se ve en su ficha de fondos, donde se decide qué hacer con el remanente.</p>' +
      '</form>',
      pie: U.boton({ texto: 'Formar el grupo', icono: 'check', variante: 'primario', clase: 'js-fl-grupo-ok' }) });
    dr.el.querySelector('.js-fl-grupo-ok').addEventListener('click', function (ev) {
      var f = dr.el.querySelector('.js-fl-grupo');
      var nombre = f.cliente.value.trim();
      var cli = (cat_.clientes || []).filter(function (c) { return c.nombre === nombre || c.rut === nombre; })[0];
      if (!cli) { x_.aviso('Elige el cliente de la lista.', 'error'); return; }
      if (!f.obligacion.value) { x_.aviso('Elige la obligación.', 'error'); return; }
      ev.currentTarget.disabled = true;
      x_.api('finanzasLibroAgrupar', { ids: ids, versiones: versiones, cliente_id: cli.id, obligacion: f.obligacion.value, periodo_obligacion: f.periodo.value }).then(function (r) {
        if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo formar el grupo.', 'error'); ev.currentTarget.disabled = false; return; }
        x_.aviso('Grupo de ' + r.data.cliente + ': ' + r.data.asignadas + ' fila(s). Remanente ' + plata(r.data.saldo) + '.', 'exito');
        dr.cerrar(); recargar();
      });
    });
  }

  // ---- clasificar una fila -----------------------------------------------------------------
  function panel(id) {
    var l = est_.datos.lineas.filter(function (x) { return x.id === id; })[0]; if (!l) return;
    var entra = l.monto > 0;
    var tipos = (cat_.tipos || []).filter(function (t) { return !t.sentido || t.sentido === (entra ? 'abono' : 'cargo'); });
    var sug = l.sugerencia || {};
    var actual = l.estado === 'CONFIRMADO' ? null : sug;
    var dr = U.drawer({ titulo: (entra ? 'Entró ' : 'Salió ') + plata(Math.abs(l.monto)), subtitulo: '<span class="fin2-ayuda">' + txt(l.fecha) + ' · ' + txt(l.cuenta) + (l.verificado ? '' : ' · sin cartola') + '</span>',
      cuerpo: '<div class="fin2-p">' +
        '<dl class="fin3-dl"><dt>El banco dice</dt><dd>' + txt(l.glosa) + '</dd>' + (l.quien ? '<dt>Quién</dt><dd>' + txt(l.quien) + '</dd>' : '') +
          (l.planilla ? '<dt>La planilla decía</dt><dd>' + txt([l.planilla.alias, l.planilla.obs, l.planilla.plan].filter(Boolean).join(' · ')) + '</dd>' : '') +
          (actual && actual.motivo ? '<dt>SIGSO propone</dt><dd>' + txt(actual.motivo) + '</dd>' : '') + '</dl>' +
        '<form class="js-fl-form">' +
          '<fieldset class="fin3-tipos"><legend>¿Qué es?</legend>' + tipos.map(function (t) {
            var marcado = (actual && actual.tipo === t.id) || (!actual && l.categoria === categoriaDe(t.id));
            return '<label class="fin3-tipo"><input type="radio" name="tipo" value="' + txt(t.id) + '"' + (marcado ? ' checked' : '') + '><span>' + txt(t.nombre) + '</span></label>';
          }).join('') + '</fieldset>' +
          '<div class="js-fl-campos"></div>' +
        '</form></div>',
      pie: U.boton({ texto: 'Guardar', icono: 'check', variante: 'primario', clase: 'js-fl-guardar', datos: { cap: 'CONFIRMAR' } }) });
    var form = dr.el.querySelector('.js-fl-form');
    function campos() {
      var t = (form.querySelector('input[name="tipo"]:checked') || {}).value;
      var def = (cat_.tipos || []).filter(function (x) { return x.id === t; })[0];
      var cont = dr.el.querySelector('.js-fl-campos');
      if (!def) { cont.innerHTML = ''; return; }
      var cu = (actual && actual.tipo === t && actual.cuenta) || (l.categoria === categoriaDe(t) ? l.cuenta_concepto : '');
      cont.innerHTML = (def.cuentas && def.cuentas.length ? '<label class="fin2-campo"><span>' + (def.cliente ? 'Obligación' : 'Cuenta') + '</span><select class="fin2-input" name="cuenta">' + opciones(def.cuentas, cu, 'Elige…') + '</select></label>' : '') +
        (def.cliente || t === 'INGRESO' ? '<label class="fin2-campo"><span>Cliente' + (def.cliente ? '' : ' (opcional)') + '</span><input class="fin2-input" name="cliente" list="fl-cli2" placeholder="Nombre o RUT" value="' + txt((actual && actual.cliente) || l.cliente || '') + '"><datalist id="fl-cli2">' + (cat_.clientes || []).map(function (c) { return '<option value="' + txt(c.nombre) + '">' + txt(c.rut) + '</option>'; }).join('') + '</datalist></label>' : '') +
        (def.empresa ? '<label class="fin2-campo"><span>Empresa</span><select class="fin2-input" name="empresa">' + opciones(cat_.empresas || [], (actual && actual.empresa) || '', 'Elige…') + '</select></label>' : '') +
        (l.quien && (def.cliente || t === 'INGRESO') ? '<label class="fin2-check"><input type="checkbox" name="recordar" checked> Recordar que «' + txt(l.quien) + '» es de este cliente</label>' : '');
    }
    form.addEventListener('change', function (ev) { if (ev.target.name === 'tipo') campos(); });
    campos();
    dr.el.querySelector('.js-fl-guardar').addEventListener('click', function (ev) {
      var t = (form.querySelector('input[name="tipo"]:checked') || {}).value;
      if (!t) { x_.aviso('Elige qué es.', 'error'); return; }
      var it = { id: l.id, tipo: t, recordar: !!(form.recordar && form.recordar.checked) };
      if (l.estado === 'CONFIRMADO') it.expected_version = l.version;
      if (form.cuenta) it.cuenta = form.cuenta.value;
      if (form.empresa) it.empresa = form.empresa.value;
      if (form.cliente && form.cliente.value.trim()) {
        var cli = (cat_.clientes || []).filter(function (c) { return c.nombre === form.cliente.value.trim() || c.rut === form.cliente.value.trim(); })[0];
        if (!cli) { x_.aviso('Elige el cliente de la lista.', 'error'); return; }
        it.cliente_id = cli.id;
      }
      if (t === 'FONDO_RECIBIDO') it.subtipo = 'RECEPCION';
      if (t === 'FONDO_PAGADO') it.subtipo = 'PAGO_OBLIGACION';
      ev.currentTarget.disabled = true;
      x_.api('finanzasClasificar', { items: [it] }).then(function (r) {
        var err = r && r.ok && r.data.errores && r.data.errores[0];
        if (!r || !r.ok || err) { x_.aviso((err && err.mensaje) || (r && r.message) || 'No se pudo guardar.', 'error'); ev.currentTarget.disabled = false; return; }
        x_.aviso('Guardado.', 'exito'); dr.cerrar(); recargar();
      });
    });
  }
  function categoriaDe(tipo) { return { INGRESO: 'ABONO', EGRESO: 'GASTO', FONDO_RECIBIDO: 'FONDOS', FONDO_PAGADO: 'FONDOS', TRASPASO: 'TRASPASO', PRESTAMO: 'PRESTAMO' }[tipo] || ''; }

  // ---- eventos -----------------------------------------------------------------------------
  var enlazado_ = false;
  function enlazar() {
    if (enlazado_) return; enlazado_ = true;
    var raiz = document.getElementById('modulo-finanzas');
    raiz.addEventListener('change', function (ev) {
      if (!document.querySelector('.fin3-libro')) return;
      var t = ev.target;
      if (t.classList.contains('js-fl-mes')) { est_.periodo = t.value; x_.contexto({ periodo_libro: t.value }); ver(x_); }
      else if (t.classList.contains('js-fl-cuenta')) { est_.cuenta = t.value; x_.contexto({ cuenta_ref: t.value }); ver(x_); }
      else if (t.classList.contains('js-fl-sel')) { est_.sel[t.dataset.id] = t.checked; pintarLote(); }
      else if (t.classList.contains('js-fl-todas')) { visibles().forEach(function (l) { est_.sel[l.id] = t.checked; }); x_.raiz().querySelector('.js-fl-filas').innerHTML = filas(); pintarLote(); }
    });
    raiz.addEventListener('input', function (ev) {
      if (!ev.target.classList.contains('js-fl-busca')) return;
      est_.busca = ev.target.value;
      var tb = x_.raiz().querySelector('.js-fl-filas'); if (tb) tb.innerHTML = filas();
    });
    raiz.addEventListener('click', function (ev) {
      if (!document.querySelector('.fin3-libro')) return;
      var b = ev.target.closest('button, tr.fin3-fila');
      if (!b) return;
      if (b.classList.contains('js-fl-filtro')) { est_.filtro = b.dataset.id; pintar(); return; }
      if (b.classList.contains('js-fl-agrupar')) { agrupar(); return; }
      if (b.classList.contains('js-fl-desmarcar')) { est_.sel = {}; x_.raiz().querySelector('.js-fl-filas').innerHTML = filas(); pintarLote(); return; }
      if (b.classList.contains('js-fl-cargar')) { x_.ir('cargas'); return; }
      if (b.tagName === 'TR' && !ev.target.closest('input')) panel(b.dataset.id);
    });
    raiz.addEventListener('keydown', function (ev) {
      var tr = ev.target.closest && ev.target.closest('tr.fin3-fila');
      if (tr && ev.key === 'Enter') { ev.preventDefault(); panel(tr.dataset.id); }
    });
  }

  window.SigsoFinanzasLibro = { ver: ver };
})();
