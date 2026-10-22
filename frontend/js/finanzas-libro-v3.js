/**
 * finanzas-libro-v3.js — El libro del banco (Finanzas v3 «banco primero», 21-10-2026;
 * backend/logica/finanzasLibro.js y finanzasRegistro.js). Es la planilla BANCOS dentro
 * de SIGSO, y la pantalla donde se trabaja todos los días:
 *
 *  - ANOTAR: una fila por movimiento, con las mismas columnas que la planilla
 *    (fecha, nombre, plan de cuenta, OBS, monto + entra / − sale, detalle del banco).
 *    Se anota apenas pasa, sin esperar la cartola, o se pegan varias filas desde Excel.
 *  - CUADRAR CON EL BANCO: al subir la cartola, cada fila anotada se une sola con su
 *    movimiento (✓ en el banco); lo que la cartola trae y nadie anotó queda «falta
 *    anotar» (p. ej. un «pago en internet» sin detalle) para completarlo a mano.
 *  - Lo que SIGSO entiende de cada fila (honorario, gasto, fondos del cliente…), el
 *    saldo acumulado del mes (columna SALDO), el cuadre contra la cartola, los grupos
 *    de fondos (la fórmula de UNITARIO) y lo que no pasa por el banco, aparte.
 */
(function () {
  'use strict';

  var U = UIv2;
  var x_ = null, cat_ = null;
  var est_ = { periodo: '', cuenta: '', filtro: 'todos', busca: '', datos: null, sel: {}, ultimaFecha: '' };
  document.addEventListener('sigso-fin-cerrada', function () { est_.datos = null; est_.sel = {}; });

  // Las categorías con las palabras del Excel BANCOS, su explicación y su tono.
  var CAT = {
    ABONO: ['Honorario', 'Ingreso de la empresa (lo que en la planilla es ABONO)', 'ok'],
    'ABONO RENTA': ['Renta', 'Ingreso por servicio de renta (ABONO RENTA)', 'ok'],
    GASTO: ['Gasto', 'Gasto de la empresa: sueldos, arriendo, cuentas…', 'critico'],
    FONDOS: ['Fondos cliente', 'Plata del cliente para sus obligaciones (IVA, imposiciones, convenios): no es de la empresa', 'info'],
    TRASPASO: ['Traspaso', 'Entre cuentas propias', 'neutro'],
    PRESTAMO: ['Préstamo', 'Con otra empresa del grupo', 'neutro'],
    'SIN CLASIFICAR': ['Por revisar', 'Todavía no se sabe qué es', 'alerta']
  };
  // Qué significa cada OBS (lo mismo que en la planilla), para ayudar mientras se anota.
  var OBS_AYUDA = {
    '': 'Sin OBS: SIGSO propone qué es, o queda por revisar.',
    ABONO: 'ABONO: si entra, honorario de la empresa; si sale, gasto de la empresa.',
    'ABONO RENTA': 'ABONO RENTA: ingreso por el servicio de renta.',
    IMPOSICIONES: 'IMPOSICIONES: plata del cliente para pagar sus imposiciones (no es de la empresa).',
    IVA: 'IVA: plata del cliente para pagar su IVA (no es de la empresa).',
    SALDO: 'SALDO: plata del cliente; lo que sobre queda a su favor.',
    PENDIENTE: 'PENDIENTE: plata del cliente con algo aún por resolver.'
  };
  var FILTROS = [['todos', 'Todos'], ['falta', 'Falta anotar'], ['esperando', 'Esperando cartola'], ['revisar', 'Por revisar'], ['ABONO', 'Honorarios'], ['ABONO RENTA', 'Renta'], ['GASTO', 'Gastos'], ['FONDOS', 'Fondos de clientes'], ['otros', 'Traspasos y préstamos']];

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function plata(n) { var v = Math.round(Number(n) || 0); return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('es-CL'); }
  function corta(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '-' + p[1] : ''; }
  function mesLargo(p) { var m = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']; var a = String(p || '').split('-'); return a.length === 2 ? m[Number(a[1]) - 1] + ' ' + a[0] : p; }
  function hoy() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
  function hoyMes() { return hoy().slice(0, 7); }
  function opciones(l, actual, vacio) { return (vacio !== undefined ? '<option value="">' + txt(vacio) + '</option>' : '') + l.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return '<option value="' + txt(v) + '"' + (String(v) === String(actual) ? ' selected' : '') + '>' + txt(t) + '</option>'; }).join(''); }
  function catChip(c) { var k = CAT[c] || CAT['SIN CLASIFICAR']; return '<span class="fin3-cat fin3-cat--' + k[2] + '" title="' + txt(k[1]) + '">' + txt(k[0]) + '</span>'; }
  // «1.234.567», «-2.950.000», «$ 200.000» o «(5.000)» → número; '' si no se entiende.
  function leerMonto(s) {
    var t = String(s == null ? '' : s).replace(/\s|\$|CLP/gi, '');
    var neg = /^\(.*\)$/.test(t) || /^[-−]/.test(t);
    t = t.replace(/[()\-−+]/g, '').replace(/\./g, '').replace(',', '.');
    if (!t || isNaN(Number(t))) return '';
    var n = Math.round(Number(t));
    return neg ? -n : n;
  }
  function clienteDe(texto) { var v = String(texto || '').trim(); return (cat_.clientes || []).filter(function (c) { return c.nombre === v || c.rut === v; })[0] || null; }
  function cuentaUnica() { var c = est_.datos ? est_.datos.cuentas : []; return est_.cuenta || (c.length === 1 ? c[0].id : ''); }

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
  function recargar(enfocar) {
    var x = x_, t = x_.turno();
    var caja = x_.raiz().querySelector('.fin3-tabla-envoltura'), arriba = caja ? caja.scrollTop : 0, pagina = window.scrollY;
    return x_.api('finanzasLibro', { periodo: est_.periodo, cuenta_ref: est_.cuenta }).then(function (r) {
      if (!x.vigente(t) || !r || !r.ok) return;
      est_.datos = r.data; est_.sel = {};
      pintar();
      var c2 = x_.raiz().querySelector('.fin3-tabla-envoltura'); if (c2) c2.scrollTop = arriba;
      window.scrollTo(0, pagina);
      if (enfocar) { var n = x_.raiz().querySelector('.js-fa-alias'); if (n) n.focus(); }
    });
  }

  function visibles() {
    var d = est_.datos, q = est_.busca.toLowerCase();
    return d.lineas.filter(function (l) {
      var f = est_.filtro;
      if (f === 'revisar' && (l.estado === 'CONFIRMADO' || l.banco === 'falta_anotar')) return false;
      if (f === 'falta' && l.banco !== 'falta_anotar') return false;
      if (f === 'esperando' && l.banco !== 'esperando') return false;
      if (f === 'otros' && l.categoria !== 'TRASPASO' && l.categoria !== 'PRESTAMO') return false;
      if (CAT[f] && f !== 'SIN CLASIFICAR' && (l.categoria !== f || l.estado !== 'CONFIRMADO')) return false;
      var p = l.planilla || {};
      if (q && [l.quien, l.glosa, l.cliente, l.cuenta_concepto, p.plan, p.obs, p.glosa, Math.abs(l.monto)].join(' ').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function pintar() {
    var d = est_.datos;
    var meses = d.meses.slice();
    [hoyMes(), d.periodo].forEach(function (m) { if (meses.indexOf(m) === -1) meses.push(m); });
    meses.sort().reverse();
    var acciones = U.boton({ texto: 'Pegar desde Excel', icono: 'copiar', sm: true, variante: 'secundario', clase: 'js-fl-pegar', datos: { cap: 'REGISTRAR' } }) +
      U.boton({ texto: 'Subir cartola', icono: 'subir', sm: true, clase: 'js-fl-cargar', datos: { cap: 'REGISTRAR' } });
    x_.pagina(x_.cab('libro', acciones) +
      '<div class="sx2-pagina__cuerpo fin3">' +
        '<div class="fin3-barra">' +
          '<label class="fin2-campo fin2-campo--fila"><span>Mes</span><select class="fin2-input js-fl-mes">' + opciones(meses.map(function (m) { return [m, mesLargo(m)]; }), d.periodo) + '</select></label>' +
          (d.cuentas.length > 1 ? '<label class="fin2-campo fin2-campo--fila"><span>Cuenta</span><select class="fin2-input js-fl-cuenta">' + opciones(d.cuentas.map(function (c) { return [c.id, c.nombre + ' · ' + c.empresa]; }), est_.cuenta, 'Todas') + '</select></label>' : '') +
          '<label class="fin2-busca"><span class="sx2-oculto">Buscar</span>' + U.ico('lupa', 16) + '<input class="fin2-input js-fl-busca" placeholder="Nombre, plan, cliente o monto" value="' + txt(est_.busca) + '"></label>' +
        '</div>' +
        estadoMes(d) +
        anotar(d) +
        cuadre(d) + resumen(d) +
        '<div class="fin3-filtros" role="group" aria-label="Qué mostrar">' + FILTROS.map(function (f) { return U.chip({ texto: f[1], activo: est_.filtro === f[0], clase: 'js-fl-filtro', datos: { id: f[0] }, n: cuenta(f[0]) }); }).join('') + '</div>' +
        '<div class="fin3-lote js-fl-lote" hidden></div>' +
        '<div class="fin3-tabla-envoltura"><table class="fin3-libro fin3-libro--hoja">' +
          '<thead><tr><th class="fin3-chk"><input type="checkbox" class="js-fl-todas" aria-label="Marcar todas" data-cap="FONDOS"></th><th>Fecha</th><th>Nombre</th><th>Plan de cuenta</th><th>OBS</th><th class="fin2-der">Monto</th><th class="fin2-der">Saldo</th><th>Detalle banco</th><th>Qué es</th><th aria-label="Banco">Banco</th></tr></thead>' +
          '<tbody class="js-fl-filas">' + filas() + '</tbody></table></div>' +
        fueraBanco(d) +
      '</div>');
    x_.aplicarCapacidades(x_.raiz());
    pintarLote();
    ayudaAnotar();
  }
  function cuenta(f) { var a = est_.filtro; est_.filtro = f; var b = est_.busca; est_.busca = ''; var n = visibles().length; est_.filtro = a; est_.busca = b; return n; }

  // ---- cómo va el mes: anotado, en el banco, falta anotar, por revisar -------------------------
  function estadoMes(d) {
    var e = d.estado_banco || {}, rev = d.lineas.filter(function (l) { return l.estado !== 'CONFIRMADO' && l.banco !== 'falta_anotar'; }).length;
    function t(id, n, titulo, sub, tono, icono) {
      return '<button type="button" class="fin3-est-t fin3-est-t--' + tono + (n ? '' : ' fin3-est-t--cero') + ' js-fl-filtro" data-id="' + id + '">' + U.ico(icono, 18) + '<span><b>' + n + '</b> ' + txt(titulo) + '<small>' + txt(sub) + '</small></span></button>';
    }
    return '<section class="fin3-estado" aria-label="Cómo va el mes">' +
      t('todos', e.ok || 0, 'en el banco', 'anotadas y en la cartola', 'ok', 'check') +
      t('esperando', e.esperando || 0, 'esperando cartola', 'anotadas, aún no llega el banco', 'info', 'reloj') +
      t('falta', e.falta_anotar || 0, 'falta anotar', 'el banco las trae y nadie las anotó', e.falta_anotar ? 'alerta' : 'neutro', 'alerta') +
      t('revisar', rev, 'por revisar', 'anotadas, falta saber qué son', rev ? 'alerta' : 'neutro', 'lupa') +
    '</section>';
  }

  // ---- anotar una fila (como en la planilla) ---------------------------------------------------
  function fechaPorDefecto() {
    if (est_.ultimaFecha && est_.ultimaFecha.slice(0, 7) === est_.periodo) return est_.ultimaFecha;
    return est_.periodo === hoyMes() ? hoy() : est_.periodo + '-01';
  }
  function listas(d) {
    var nombres = {};
    (d.alias || []).forEach(function (a) { nombres[a.alias] = a.quien; });
    (cat_.clientes || []).forEach(function (c) { if (!nombres[c.nombre]) nombres[c.nombre] = c.rut || ''; });
    return '<datalist id="fl-nombres">' + Object.keys(nombres).sort().map(function (n) { return '<option value="' + txt(n) + '">' + txt(nombres[n]) + '</option>'; }).join('') + '</datalist>' +
      '<datalist id="fl-planes">' + (d.planes || []).map(function (p) { return '<option value="' + txt(p) + '">'; }).join('') + '</datalist>';
  }
  function anotar(d) {
    var cuentas = d.cuentas.length > 1 && !est_.cuenta ? '<label class="fin3-fa-c"><span>Cuenta</span><select class="fin2-input js-fa-cuenta" required>' + opciones(d.cuentas.map(function (c) { return [c.id, c.nombre]; }), '', 'Elige…') + '</select></label>' : '';
    return '<form class="fin3-anotar js-fl-anotar" data-cap="REGISTRAR" autocomplete="off">' +
      '<div class="fin3-anotar__t">' + U.ico('editar', 16) + '<b>Anotar movimiento</b><span class="fin2-ayuda">Como en la planilla: monto positivo si entró, negativo si salió. Enter guarda y deja lista la siguiente.</span></div>' +
      '<div class="fin3-anotar__fila">' + cuentas +
        '<label class="fin3-fa-f"><span>Fecha</span><input class="fin2-input" type="date" name="fecha" required value="' + txt(fechaPorDefecto()) + '"></label>' +
        '<label class="fin3-fa-n"><span>Nombre</span><input class="fin2-input js-fa-alias" name="alias" list="fl-nombres" required placeholder="Cliente, ARRIENDO, SUELDO…"></label>' +
        '<label class="fin3-fa-p"><span>Plan de cuenta</span><input class="fin2-input" name="plan" list="fl-planes" placeholder="Opcional"></label>' +
        '<label class="fin3-fa-o"><span>OBS</span><select class="fin2-input" name="obs">' + opciones((d.obs || []).map(function (o) { return [o, o]; }), '', '—') + '</select></label>' +
        '<label class="fin3-fa-m"><span>Monto</span><input class="fin2-input fin2-num" name="monto" required inputmode="decimal" placeholder="200.000 o -150.000"></label>' +
        '<label class="fin3-fa-g"><span>Detalle banco</span><input class="fin2-input" name="glosa" placeholder="Lo que dice el banco (opcional)"></label>' +
        '<button type="submit" class="sx2-boton sx2-boton--primario fin3-fa-b">' + U.ico('check', 16) + 'Anotar</button>' +
      '</div>' +
      '<p class="fin3-anotar__ayuda js-fa-ayuda" aria-live="polite"></p>' + listas(d) +
    '</form>';
  }
  // Lo que va a entender SIGSO, mientras se escribe.
  function ayudaAnotar() {
    var f = x_.raiz().querySelector('.js-fl-anotar'); if (!f) return;
    var el = f.querySelector('.js-fa-ayuda');
    var m = leerMonto(f.monto.value), obs = f.obs.value, n = f.alias.value.trim();
    var partes = [];
    if (m !== '') partes.push('<b class="' + (m < 0 ? 'fin2-neg' : 'fin2-pos') + '">' + (m < 0 ? 'Sale ' : 'Entra ') + plata(Math.abs(m)) + '</b>');
    else if (f.monto.value.trim()) partes.push('<b class="fin2-neg">No entiendo el monto</b>');
    var conocido = n && ((est_.datos.alias || []).filter(function (a) { return a.alias.toUpperCase() === n.toUpperCase(); })[0] || clienteDe(n));
    if (n) partes.push(conocido ? '«' + txt(n) + '» = ' + txt(conocido.quien || conocido.nombre) : '«' + txt(n) + '» es nuevo: si es un cliente, después te pregunto cuál');
    partes.push(txt(OBS_AYUDA[obs] || ''));
    el.innerHTML = partes.join(' · ');
  }
  function guardarAnotacion(form) {
    var m = leerMonto(form.monto.value);
    if (m === '' || !m) { x_.aviso('Escribe el monto: positivo si entró, negativo si salió.', 'error'); form.monto.focus(); return; }
    var cuentaRef = cuentaUnica() || (form.querySelector('.js-fa-cuenta') || {}).value;
    if (!cuentaRef) { x_.aviso('Elige la cuenta del banco.', 'error'); return; }
    var fila = { fecha: form.fecha.value, monto: m, alias: form.alias.value.trim(), plan: form.plan.value.trim(), obs: form.obs.value, glosa: form.glosa.value.trim() };
    var btn = form.querySelector('button[type="submit"]'); btn.disabled = true;
    x_.api('finanzasRegistroAnotar', { cuenta_ref: cuentaRef, filas: [fila] }).then(function (r) {
      btn.disabled = false;
      if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo anotar.', 'error'); return; }
      est_.ultimaFecha = fila.fecha;
      var f0 = r.data.filas[0] || {};
      x_.aviso((f0.en_banco ? 'Anotada y unida con el banco ✓' : 'Anotada: espera la cartola') + (f0.por_revisar ? ' · ' + (f0.motivo || 'queda por revisar') : ''), f0.por_revisar ? 'alerta' : 'exito');
      if (fila.fecha.slice(0, 7) !== est_.periodo) { est_.periodo = fila.fecha.slice(0, 7); x_.contexto({ periodo_libro: est_.periodo }); }
      recargar(true);
    });
  }

  // ---- cuadre y resumen -------------------------------------------------------------------------
  function cuadre(d) {
    var entra = 0, sale = 0, ok = 0, okE = 0, okS = 0;
    d.lineas.forEach(function (l) { if (l.monto > 0) entra += l.monto; else sale += l.monto; if (l.verificado) { if (l.monto > 0) okE += l.monto; else okS += l.monto; ok++; } });
    var c = d.cartola;
    var calc = c ? c.saldo_inicial + okE + okS : null;
    var cuadra = c && Math.round(calc) === Math.round(c.saldo_final);
    var estado = !d.lineas.length ? U.badge('Sin movimientos', 'neutro') : !d.verificados ? U.badge('Sin cartola todavía: lo anotado no está verificado', 'alerta') : cuadra ? U.badge('El banco cuadra con la cartola', 'ok') : U.badge('No cuadra con la cartola', 'critico');
    var nota = d.estado_banco && d.estado_banco.esperando ? '<span class="fin2-ayuda">' + d.estado_banco.esperando + ' fila(s) anotadas esperan la cartola (' + plata(entra + sale - okE - okS) + '): no entran al cuadre hasta que el banco las traiga.</span>' : '';
    return '<section class="fin3-cuadre" aria-label="Cuadre con el banco">' +
      '<div class="fin3-cuadre__t">' + U.ico('dinero', 18) + '<b>Cuadre del mes</b>' + estado + nota + '</div>' +
      '<div class="fin3-ecuacion">' +
        celda('Saldo inicial', c ? plata(c.saldo_inicial) : '—') + '<span class="fin3-op">+</span>' + celda('Entró', plata(c ? okE : entra), 'pos') + '<span class="fin3-op">−</span>' + celda('Salió', plata(-(c ? okS : sale)), 'neg') +
        '<span class="fin3-op">=</span>' + celda(c ? 'Saldo final' : 'Neto anotado', calc !== null ? plata(calc) : plata(entra + sale), cuadra ? 'ok' : '') + (c ? celda('Cartola dice', plata(c.saldo_final), '') : '') +
      '</div></section>';
  }
  function celda(t, v, tono) { return '<div class="fin3-celda' + (tono ? ' fin3-celda--' + tono : '') + '"><span>' + txt(t) + '</span><b>' + v + '</b></div>'; }

  function resumen(d) {
    var r = d.resumen, fb = d.fuera_banco.resumen;
    var orden = ['ABONO', 'ABONO RENTA', 'GASTO', 'FONDOS', 'TRASPASO', 'PRESTAMO', 'SIN CLASIFICAR'];
    return '<section class="fin3-resumen" aria-label="Resumen del mes por categoría">' + orden.filter(function (k) { return r[k] || fb[k] || k === 'ABONO' || k === 'FONDOS'; }).map(function (k) {
      var extra = fb[k] ? '<small>' + (fb[k] > 0 ? '+ ' : '') + plata(fb[k]) + ' sin banco</small>' : '';
      return '<button type="button" class="fin3-res fin3-res--' + CAT[k][2] + ' js-fl-filtro" data-id="' + txt(k === 'SIN CLASIFICAR' ? 'revisar' : k) + '" title="' + txt(CAT[k][1]) + '"><span>' + txt(CAT[k][0]) + '</span><b>' + plata(r[k]) + '</b>' + extra + '</button>';
    }).join('') + '<div class="fin3-res fin3-res--total"><span>Neto del mes</span><b>' + plata(d.neto) + '</b><small>= suma de las categorías</small></div></section>';
  }

  // ---- la hoja --------------------------------------------------------------------------------
  function filas() {
    var l = visibles();
    if (!l.length) return '<tr><td colspan="10">' + U.vacio({ icono: 'dinero', titulo: est_.datos.lineas.length ? 'Nada con este filtro' : 'Este mes no tiene movimientos', texto: est_.datos.lineas.length ? '' : 'Anota el primer movimiento arriba, o sube la cartola del banco.' }) + '</td></tr>';
    return l.map(function (x) {
      var p = x.planilla || {};
      var falta = x.banco === 'falta_anotar';
      var revisar = !falta && x.estado !== 'CONFIRMADO';
      var que = falta ? '<span class="fin2-ayuda">—</span>' : catChip(revisar ? 'SIN CLASIFICAR' : x.categoria) + (x.partes > 1 ? '<small class="fin2-ayuda"> +' + (x.partes - 1) + '</small>' : '') +
        (x.cliente || x.cuenta_concepto ? '<small class="fin3-que">' + txt(x.cliente || x.cuenta_concepto) + (x.cliente && x.cuenta_concepto ? ' · ' + txt(x.cuenta_concepto) : '') + '</small>' : '') +
        (x.grupo ? '<span class="fin3-grupo" title="Grupo de fondos">Grupo · ' + txt(x.grupo.obligacion) + (x.grupo.periodo ? ' ' + txt(x.grupo.periodo) : '') + '</span>' : '');
      var banco = x.banco === 'ok' ? '<span class="fin3-b fin3-b--ok" title="Está en la cartola del banco">' + U.ico('check', 14) + '</span>'
        : x.banco === 'esperando' ? '<span class="fin3-b fin3-b--esp" title="Anotada: falta que llegue en la cartola">esperando</span>'
        : '<button type="button" class="sx2-boton sx2-boton--sm sx2-boton--secundario js-fl-anotar-fila" data-id="' + txt(x.id) + '" data-cap="REGISTRAR">Anotar</button>';
      return '<tr class="fin3-fila' + (revisar ? ' fin3-fila--revisar' : '') + (falta ? ' fin3-fila--falta' : '') + (x.banco === 'esperando' ? ' fin3-fila--sincartola' : '') + '" data-id="' + txt(x.id) + '" tabindex="0">' +
        '<td class="fin3-chk"><input type="checkbox" class="js-fl-sel" data-id="' + txt(x.id) + '"' + (est_.sel[x.id] ? ' checked' : '') + ' aria-label="Marcar" data-cap="FONDOS"></td>' +
        '<td class="fin2-num">' + corta(x.fecha) + '</td>' +
        '<td class="fin3-mov">' + (falta ? '<span class="fin3-falta">Falta anotar</span>' : '<b>' + txt(p.alias || x.quien || x.cliente || x.cuenta_concepto) + '</b>') + (p.nota ? '<small class="fin3-glosa">' + txt(p.nota) + '</small>' : '') + '</td>' +
        '<td class="fin3-txt">' + txt(p.plan || '') + '</td>' +
        '<td class="fin3-txt">' + txt(p.obs || '') + '</td>' +
        '<td class="fin2-der fin2-num ' + (x.monto < 0 ? 'fin2-neg' : 'fin2-pos') + '">' + plata(x.monto) + '</td>' +
        '<td class="fin2-der fin2-num fin3-saldo">' + plata(x.saldo_mes) + '</td>' +
        '<td class="fin3-det"><span class="fin3-glosa">' + txt(x.banco === 'esperando' ? (p.glosa || '') : x.glosa) + '</span>' + (x.quien && x.quien !== p.alias && x.banco !== 'esperando' ? '<small class="fin3-glosa">' + txt(x.quien) + '</small>' : '') + '</td>' +
        '<td class="fin3-concepto">' + que + '</td>' +
        '<td class="fin3-est">' + banco + '</td>' +
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

  // ---- una fila: corregir lo anotado, qué es para SIGSO, grupo, borrar ---------------------------
  function linea(id) { return est_.datos.lineas.filter(function (x) { return x.id === id; })[0]; }
  function formAnotacion(l) {
    var p = l.planilla || {}, d = est_.datos, libre = l.banco === 'esperando';
    return '<form class="fin3-form js-ff-anot" autocomplete="off">' +
      (libre ? '<div class="fin3-form__2"><label class="fin2-campo"><span>Fecha</span><input class="fin2-input" type="date" name="fecha" value="' + txt(l.fecha) + '"></label>' +
        '<label class="fin2-campo"><span>Monto (+ entra / − sale)</span><input class="fin2-input fin2-num" name="monto" inputmode="decimal" value="' + txt(l.monto) + '"></label></div>' : '') +
      '<label class="fin2-campo"><span>Nombre</span><input class="fin2-input" name="alias" list="fl-nombres2" required value="' + txt(p.alias || '') + '" placeholder="Cliente, ARRIENDO, SUELDO…"></label>' +
      '<div class="fin3-form__2"><label class="fin2-campo"><span>Plan de cuenta</span><input class="fin2-input" name="plan" list="fl-planes2" value="' + txt(p.plan || '') + '"></label>' +
      '<label class="fin2-campo"><span>OBS</span><select class="fin2-input" name="obs">' + opciones((d.obs || []).map(function (o) { return [o, o]; }), p.obs || '', '—') + '</select></label></div>' +
      '<label class="fin2-campo"><span>Detalle banco</span><input class="fin2-input" name="glosa" value="' + txt(p.glosa || (l.banco === 'falta_anotar' ? l.glosa : '')) + '"></label>' +
      '<label class="fin2-campo"><span>Nota</span><input class="fin2-input" name="nota" value="' + txt(p.nota || '') + '" placeholder="Para recordar algo de esta fila (opcional)"></label>' +
      '<p class="fin2-ayuda js-ff-ayuda">' + txt(OBS_AYUDA[p.obs || ''] || '') + '</p>' +
      listas(d).replace('id="fl-nombres"', 'id="fl-nombres2"').replace('id="fl-planes"', 'id="fl-planes2"') +
    '</form>';
  }
  function panel(id) {
    var l = linea(id); if (!l) return;
    var falta = l.banco === 'falta_anotar';
    var p = l.planilla || {};
    var dl = '<dl class="fin3-dl"><dt>Banco</dt><dd>' + (l.banco === 'ok' ? 'En la cartola ✓' + (l.unida ? ' (se unió con lo anotado)' : '') : l.banco === 'esperando' ? 'Esperando la cartola' : 'En la cartola, sin anotar') + '</dd>' +
      (l.banco !== 'esperando' ? '<dt>El banco dice</dt><dd>' + txt(l.glosa) + (l.quien && l.quien !== p.alias ? ' · ' + txt(l.quien) : '') + '</dd>' : '') +
      (p.por ? '<dt>Anotó</dt><dd>' + txt(p.por) + '</dd>' : p.archivo ? '<dt>Viene de</dt><dd>' + txt(p.archivo) + '</dd>' : '') + '</dl>';
    var que = '';
    if (!falta) {
      var revisar = l.estado !== 'CONFIRMADO';
      // Falta saber el cliente cuando la OBS dice que es de un cliente (honorario que entra o plata para sus obligaciones).
      var sinCliente = revisar && !!p.alias && (((p.obs === 'ABONO' || p.obs === 'ABONO RENTA') && l.monto > 0) || ['IMPOSICIONES', 'IVA', 'SALDO', 'PENDIENTE'].indexOf(p.obs) !== -1 || /CONVENIO|IMPOSIC|IVA|PAGO DIFERIDO/.test(p.plan || ''));
      que = '<section class="fin3-que-sec"><h3>Qué es para SIGSO</h3>' +
        '<p>' + catChip(revisar ? 'SIN CLASIFICAR' : l.categoria) + ' ' + txt(l.cliente || '') + (l.cuenta_concepto ? ' · ' + txt(l.cuenta_concepto) : '') + '</p>' +
        (l.grupo ? '<p class="fin2-ayuda">En el grupo de fondos «' + txt(l.grupo.obligacion) + (l.grupo.periodo ? ' ' + txt(l.grupo.periodo) : '') + '».</p>' : '') +
        (revisar && sinCliente && p.alias ? '<div class="fin3-quien js-ff-quien" data-cap="REGLAS"><b>¿De qué cliente es «' + txt(p.alias) + '»?</b><span class="fin2-ayuda">SIGSO lo recordará para las próximas veces y clasificará las filas del mes con ese nombre.</span>' +
          '<div class="fin3-quien__f"><input class="fin2-input" name="cliente" list="fl-cli3" placeholder="Nombre o RUT del cliente"><datalist id="fl-cli3">' + (cat_.clientes || []).map(function (c) { return '<option value="' + txt(c.nombre) + '">' + txt(c.rut) + '</option>'; }).join('') + '</datalist>' +
          U.boton({ texto: 'Es este cliente', sm: true, variante: 'primario', clase: 'js-ff-ensenar' }) + '</div></div>' : '') +
        (revisar && !sinCliente ? '<p class="fin2-ayuda">' + txt(p.obs ? 'Revisa el nombre o dilo a mano.' : 'Ponle una OBS (ABONO, IMPOSICIONES, IVA…) o dilo a mano.') + '</p>' : '') +
        '<details class="fin3-amano"><summary>Decirlo a mano (casos especiales)</summary><div class="js-ff-amano"></div></details>' +
      '</section>';
    }
    var pie = U.boton({ texto: falta ? 'Anotar' : 'Guardar', icono: 'check', variante: 'primario', clase: 'js-ff-guardar', datos: { cap: 'REGISTRAR' } }) +
      (l.en_grupo ? U.boton({ texto: 'Sacar del grupo', variante: 'secundario', clase: 'js-ff-sacar', datos: { cap: 'FONDOS' } }) : '') +
      (!falta ? U.boton({ texto: l.banco === 'esperando' ? 'Borrar fila' : 'Borrar anotación', variante: 'fantasma', icono: 'basura', clase: 'js-ff-borrar', datos: { cap: 'REGISTRAR' } }) : '');
    var dr = U.drawer({ titulo: (l.monto > 0 ? 'Entró ' : 'Salió ') + plata(Math.abs(l.monto)), subtitulo: '<span class="fin2-ayuda">' + txt(l.fecha) + ' · ' + txt(l.cuenta) + '</span>',
      cuerpo: '<div class="fin2-p">' + dl + (falta ? '<p class="fin2-ayuda">Anótala como en la planilla: con el nombre, la OBS y el plan, SIGSO sabe qué es.</p>' : '') + formAnotacion(l) + que + '</div>', pie: pie });
    x_.aplicarCapacidades(dr.el);
    var form = dr.el.querySelector('.js-ff-anot');
    form.addEventListener('change', function (ev) { if (ev.target.name === 'obs') dr.el.querySelector('.js-ff-ayuda').textContent = OBS_AYUDA[ev.target.value] || ''; });
    var amano = dr.el.querySelector('.fin3-amano');
    if (amano) amano.addEventListener('toggle', function () { if (amano.open && !amano.dataset.listo) { amano.dataset.listo = '1'; clasificarAMano(l, dr); } });
    dr.el.querySelector('.js-ff-guardar').addEventListener('click', function (ev) {
      var b = ev.currentTarget;
      var fila = { alias: form.alias.value.trim(), plan: form.plan.value.trim(), obs: form.obs.value, glosa: form.glosa.value.trim(), nota: form.nota.value.trim() };
      if (!fila.alias) { x_.aviso('Escribe el nombre.', 'error'); return; }
      b.disabled = true;
      var pedido;
      if (falta) pedido = x_.api('finanzasRegistroAnotar', { cuenta_ref: l.cuenta_ref || cuentaDeLinea(l), filas: [Object.assign(fila, { fecha: l.fecha, monto: l.monto, mov_id: l.id })] });
      else {
        if (form.fecha) { fila.fecha = form.fecha.value; var m = leerMonto(form.monto.value); if (m === '' || !m) { b.disabled = false; x_.aviso('El monto no se entiende.', 'error'); return; } fila.monto = m; }
        pedido = x_.api('finanzasRegistroCorregir', Object.assign(fila, { id: l.id, expected_version: l.version }));
      }
      pedido.then(function (r) {
        b.disabled = false;
        if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo guardar.', 'error'); return; }
        var motivo = r.data.motivo || (r.data.filas && r.data.filas[0] && r.data.filas[0].motivo) || '';
        x_.aviso(motivo ? 'Guardado · ' + motivo : 'Guardado.', motivo ? 'alerta' : 'exito');
        dr.cerrar(); recargar();
      });
    });
    var ens = dr.el.querySelector('.js-ff-ensenar');
    if (ens) ens.addEventListener('click', function () {
      var cli = clienteDe(dr.el.querySelector('.js-ff-quien input').value);
      if (!cli) { x_.aviso('Elige el cliente de la lista.', 'error'); return; }
      ens.disabled = true;
      x_.api('finanzasGuardarNombres', { alias: [{ alias: p.alias, clase: 'cliente', cliente_id: cli.id }] }).then(function (r) {
        if (!r || !r.ok) { ens.disabled = false; x_.aviso((r && r.message) || 'No se pudo guardar.', 'error'); return; }
        return x_.api('finanzasLibroReaplicar', { periodo: est_.periodo }).then(function (q) {
          x_.aviso('«' + p.alias + '» = ' + cli.nombre + ' · ' + ((q && q.ok && q.data.clasificadas) || 0) + ' fila(s) clasificadas.', 'exito');
          dr.cerrar(); recargar();
        });
      });
    });
    var sacar = dr.el.querySelector('.js-ff-sacar');
    if (sacar) sacar.addEventListener('click', function () {
      sacar.disabled = true;
      x_.api('finanzasLibroSacarDeGrupo', { ids: [l.id] }).then(function (r) {
        if (!r || !r.ok) { sacar.disabled = false; x_.aviso((r && r.message) || 'No se pudo.', 'error'); return; }
        x_.aviso('Fila fuera del grupo.', 'exito'); dr.cerrar(); recargar();
      });
    });
    var borrar = dr.el.querySelector('.js-ff-borrar');
    if (borrar) borrar.addEventListener('click', function () {
      U.confirmar({ titulo: l.banco === 'esperando' ? '¿Borrar esta fila?' : '¿Borrar lo anotado?', texto: l.banco === 'esperando' ? 'La fila desaparece del libro.' : 'El movimiento del banco queda como «falta anotar».', boton: 'Borrar', peligro: true }).then(function (si) {
        if (!si) return;
        x_.api('finanzasRegistroBorrar', { id: l.id, expected_version: l.version }).then(function (r) {
          if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo borrar.', 'error'); return; }
          x_.aviso('Borrado.', 'exito'); dr.cerrar(); recargar();
        });
      });
    });
  }
  function cuentaDeLinea() { return cuentaUnica(); }

  // Casos especiales: decir el tipo y la cuenta a mano (reparto, préstamo, traspaso…).
  function clasificarAMano(l, dr) {
    var entra = l.monto > 0;
    var tipos = (cat_.tipos || []).filter(function (t) { return !t.sentido || t.sentido === (entra ? 'abono' : 'cargo'); });
    var cont = dr.el.querySelector('.js-ff-amano');
    cont.innerHTML = '<form class="js-fl-form"><fieldset class="fin3-tipos"><legend>¿Qué es?</legend>' + tipos.map(function (t) {
      return '<label class="fin3-tipo"><input type="radio" name="tipo" value="' + txt(t.id) + '"' + (l.estado === 'CONFIRMADO' && l.categoria === categoriaDe(t.id) ? ' checked' : '') + '><span>' + txt(t.nombre) + '</span></label>';
    }).join('') + '</fieldset><div class="js-fl-campos"></div>' + U.boton({ texto: 'Guardar qué es', icono: 'check', variante: 'secundario', sm: true, clase: 'js-fl-guardar', datos: { cap: 'CONFIRMAR' } }) + '</form>';
    x_.aplicarCapacidades(cont);
    var form = cont.querySelector('.js-fl-form');
    function campos() {
      var t = (form.querySelector('input[name="tipo"]:checked') || {}).value;
      var def = (cat_.tipos || []).filter(function (x) { return x.id === t; })[0];
      var c = cont.querySelector('.js-fl-campos');
      if (!def) { c.innerHTML = ''; return; }
      var cu = l.categoria === categoriaDe(t) ? l.cuenta_concepto : '';
      c.innerHTML = (def.cuentas && def.cuentas.length ? '<label class="fin2-campo"><span>' + (def.cliente ? 'Obligación' : 'Cuenta') + '</span><select class="fin2-input" name="cuenta">' + opciones(def.cuentas, cu, 'Elige…') + '</select></label>' : '') +
        (def.cliente || t === 'INGRESO' ? '<label class="fin2-campo"><span>Cliente' + (def.cliente ? '' : ' (opcional)') + '</span><input class="fin2-input" name="cliente" list="fl-cli2" placeholder="Nombre o RUT" value="' + txt(l.cliente || '') + '"><datalist id="fl-cli2">' + (cat_.clientes || []).map(function (k) { return '<option value="' + txt(k.nombre) + '">' + txt(k.rut) + '</option>'; }).join('') + '</datalist></label>' : '') +
        (def.empresa ? '<label class="fin2-campo"><span>Empresa</span><select class="fin2-input" name="empresa">' + opciones(cat_.empresas || [], '', 'Elige…') + '</select></label>' : '');
    }
    form.addEventListener('change', function (ev) { if (ev.target.name === 'tipo') campos(); });
    campos();
    cont.querySelector('.js-fl-guardar').addEventListener('click', function (ev) {
      var t = (form.querySelector('input[name="tipo"]:checked') || {}).value;
      if (!t) { x_.aviso('Elige qué es.', 'error'); return; }
      var it = { id: l.id, tipo: t, recordar: false };
      if (l.estado === 'CONFIRMADO') it.expected_version = l.version;
      if (form.cuenta) it.cuenta = form.cuenta.value;
      if (form.empresa) it.empresa = form.empresa.value;
      if (form.cliente && form.cliente.value.trim()) { var cli = clienteDe(form.cliente.value); if (!cli) { x_.aviso('Elige el cliente de la lista.', 'error'); return; } it.cliente_id = cli.id; }
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

  // ---- marcar varias: grupo de fondos (la fórmula de UNITARIO) ----------------------------------
  function marcadas() { return Object.keys(est_.sel).filter(function (k) { return est_.sel[k]; }); }
  function pintarLote() {
    var el = x_.raiz().querySelector('.js-fl-lote'); if (!el) return;
    var ids = marcadas();
    if (!ids.length) { el.hidden = true; el.innerHTML = ''; return; }
    var suma = 0, enGrupo = 0; est_.datos.lineas.forEach(function (l) { if (est_.sel[l.id]) { suma += l.monto; if (l.en_grupo) enGrupo++; } });
    el.hidden = false;
    el.innerHTML = '<span><b>' + ids.length + ' fila(s)</b> · suman ' + plata(suma) + (suma ? ' (eso es lo que sobra o falta en el grupo)' : ' (el grupo queda en cero)') + '</span>' +
      U.boton({ texto: 'Formar grupo de fondos', icono: 'enlace', variante: 'primario', sm: true, clase: 'js-fl-agrupar', datos: { cap: 'FONDOS' } }) +
      (enGrupo ? U.boton({ texto: 'Sacar del grupo', sm: true, variante: 'secundario', clase: 'js-fl-sacar', datos: { cap: 'FONDOS' } }) : '') +
      U.boton({ texto: 'Desmarcar', sm: true, variante: 'fantasma', clase: 'js-fl-desmarcar' });
  }
  function agrupar() {
    var ids = marcadas(); if (!ids.length) return;
    var sel = est_.datos.lineas.filter(function (l) { return est_.sel[l.id]; });
    if (sel.some(function (l) { return l.banco === 'falta_anotar'; })) { x_.aviso('Primero anota las filas que dicen «Falta anotar».', 'error'); return; }
    var versiones = {}; sel.forEach(function (l) { versiones[l.id] = l.version; });
    var primera = sel.filter(function (l) { return l.cliente; })[0] || sel[0] || {};
    var suma = sel.reduce(function (s, l) { return s + l.monto; }, 0);
    var oblig = ((cat_.tipos || []).filter(function (t) { return t.id === 'FONDO_RECIBIDO'; })[0] || {}).cuentas || [];
    var prev = (function () { var a = est_.periodo.split('-'); var dd = new Date(Date.UTC(+a[0], +a[1] - 2, 1)); return dd.toISOString().slice(0, 7); })();
    // Grupos que ya existen en el mes (por si el cliente mandó plata después).
    var grupos = {}; est_.datos.lineas.forEach(function (l) { if (l.grupo && !est_.sel[l.id]) grupos[l.grupo.id] = { id: l.grupo.id, txt: (l.cliente || '') + ' · ' + l.grupo.obligacion + (l.grupo.periodo ? ' ' + l.grupo.periodo : ''), cliente: l.cliente }; });
    var lg = Object.keys(grupos).map(function (k) { return grupos[k]; });
    var dr = U.drawer({ titulo: 'Grupo de fondos', subtitulo: '<span class="fin2-ayuda">' + ids.length + ' fila(s) · suman ' + plata(suma) + '. Es la fórmula de UNITARIO de la planilla: lo que el cliente mandó y lo que se pagó por él.</span>',
      cuerpo: '<form class="fin2-p js-fl-grupo">' +
        (lg.length ? '<label class="fin2-campo"><span>¿Grupo nuevo o uno que ya existe?</span><select class="fin2-input" name="gestion">' + opciones(lg.map(function (g) { return [g.id, 'Sumar a: ' + g.txt]; }), '', 'Grupo nuevo') + '</select></label>' : '') +
        '<div class="js-fg-nuevo">' +
          '<label class="fin2-campo"><span>Cliente</span><input class="fin2-input" name="cliente" list="fl-clientes" placeholder="Nombre o RUT" value="' + txt(primera.cliente || '') + '"><datalist id="fl-clientes">' + (cat_.clientes || []).map(function (c) { return '<option value="' + txt(c.nombre) + '">' + txt(c.rut) + '</option>'; }).join('') + '</datalist></label>' +
          '<label class="fin2-campo"><span>Obligación</span><select class="fin2-input" name="obligacion">' + opciones(oblig, primera.categoria === 'FONDOS' ? primera.cuenta_concepto : '', 'Elige…') + '</select></label>' +
          '<label class="fin2-campo"><span>Período de la obligación</span><input class="fin2-input" type="month" name="periodo" value="' + txt(prev) + '"></label>' +
        '</div>' +
        '<fieldset class="fin3-tipos"><legend>¿Qué pasa con lo que sobra' + (suma ? ' (' + plata(suma) + ')' : '') + '?</legend>' +
          '<label class="fin3-tipo"><input type="radio" name="remanente" value="PENDIENTE" checked><span><b>Pendiente</b> · el grupo sigue abierto</span></label>' +
          '<label class="fin3-tipo"><input type="radio" name="remanente" value="ABONO"><span><b>ABONO</b> · se cobra como honorario</span></label>' +
          '<label class="fin3-tipo"><input type="radio" name="remanente" value="ABONO RENTA"><span><b>ABONO RENTA</b> · honorario de renta</span></label>' +
          '<label class="fin3-tipo"><input type="radio" name="remanente" value="SALDO"><span><b>SALDO</b> · queda a favor del cliente</span></label>' +
        '</fieldset>' +
      '</form>',
      pie: U.boton({ texto: 'Guardar grupo', icono: 'check', variante: 'primario', clase: 'js-fl-grupo-ok' }) });
    var f = dr.el.querySelector('.js-fl-grupo');
    if (f.gestion) f.gestion.addEventListener('change', function () { dr.el.querySelector('.js-fg-nuevo').hidden = !!f.gestion.value; });
    dr.el.querySelector('.js-fl-grupo-ok').addEventListener('click', function (ev) {
      var gid = f.gestion ? f.gestion.value : '';
      var datos = { ids: ids, versiones: versiones, remanente: (f.querySelector('input[name="remanente"]:checked') || {}).value || '' };
      if (gid) { datos.gestion_id = gid; var gl = grupos[gid]; var c0 = clienteDe(gl.cliente); if (!c0) { x_.aviso('No encuentro el cliente de ese grupo.', 'error'); return; } datos.cliente_id = c0.id; }
      else {
        var cli = clienteDe(f.cliente.value);
        if (!cli) { x_.aviso('Elige el cliente de la lista.', 'error'); return; }
        if (!f.obligacion.value) { x_.aviso('Elige la obligación.', 'error'); return; }
        datos.cliente_id = cli.id; datos.obligacion = f.obligacion.value; datos.periodo_obligacion = f.periodo.value;
      }
      ev.currentTarget.disabled = true;
      x_.api('finanzasLibroAgrupar', datos).then(function (r) {
        if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo guardar el grupo.', 'error'); ev.currentTarget.disabled = false; return; }
        x_.aviso('Grupo de ' + r.data.cliente + ': ' + r.data.asignadas + ' fila(s)' + (r.data.honorario ? ' · ' + plata(r.data.honorario) + ' cobrados como honorario' : ' · queda ' + plata(r.data.saldo)) + '.', 'exito');
        dr.cerrar(); recargar();
      });
    });
  }
  function sacarMarcadas() {
    x_.api('finanzasLibroSacarDeGrupo', { ids: marcadas() }).then(function (r) {
      if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo.', 'error'); return; }
      x_.aviso(r.data.sacadas + ' fila(s) fuera del grupo.', 'exito'); recargar();
    });
  }

  // ---- pegar varias filas desde el Excel --------------------------------------------------------
  // Acepta lo copiado de la planilla BANCOS (TOTAL · SALDO · FECHA · DETALLE · PLAN · UNITARIO · OBS · DETALLE BANCO)
  // o en el orden de esta pantalla (FECHA · NOMBRE · PLAN · OBS · MONTO · DETALLE BANCO); con o sin encabezado.
  function fechaDe(v) {
    var s = String(v || '').trim(), m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    if ((m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(s))) { var a = m[3].length === 2 ? '20' + m[3] : m[3]; return a + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2); }
    return '';
  }
  function leerPegado(texto) {
    var lineas = String(texto || '').replace(/\r/g, '').split('\n').filter(function (l) { return l.trim(); }).map(function (l) { return l.split('\t'); });
    if (!lineas.length) return { filas: [], cols: null };
    var N = function (s) { return String(s || '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); };
    var cols = null, desde = 0;
    var cab = lineas[0].map(N);
    if (cab.indexOf('FECHA') !== -1) {
      var ix = function (l) { for (var i = 0; i < l.length; i++) { var k = cab.indexOf(l[i]); if (k !== -1) return k; } return -1; };
      cols = { fecha: ix(['FECHA']), alias: ix(['DETALLE', 'NOMBRE']), plan: ix(['PLAN DE CUENTA', 'PLAN']), obs: ix(['OBS']), monto: ix(['TOTAL', 'MONTO']), glosa: ix(['DETALLE BANCO']) };
      desde = 1;
    } else {
      var f0 = lineas[0].findIndex(function (c) { return fechaDe(c); });
      if (f0 >= 2) cols = { monto: f0 - 2, fecha: f0, alias: f0 + 1, plan: f0 + 2, obs: f0 + 4, glosa: f0 + 5 };
      else if (f0 >= 0) cols = { fecha: f0, alias: f0 + 1, plan: f0 + 2, obs: f0 + 3, monto: f0 + 4, glosa: f0 + 5 };
    }
    if (!cols || cols.fecha === -1 || cols.monto === -1) return { filas: [], cols: null };
    var obsOk = est_.datos.obs || [];
    var filas = lineas.slice(desde).map(function (c, i) {
      var g = function (k) { return cols[k] >= 0 ? String(c[cols[k]] == null ? '' : c[cols[k]]).trim() : ''; };
      var f = { fecha: fechaDe(g('fecha')), monto: leerMonto(g('monto')), alias: g('alias'), plan: g('plan'), obs: N(g('obs')), glosa: g('glosa'), n: i + 1 + desde };
      f.error = !f.fecha ? 'sin fecha' : (f.monto === '' || !f.monto) ? 'sin monto' : !f.alias ? 'sin nombre' : (f.obs && obsOk.indexOf(f.obs) === -1) ? 'OBS «' + f.obs + '» no válida' : '';
      return f;
    });
    return { filas: filas, cols: cols };
  }
  function pegar() {
    var d = est_.datos;
    var cuentas = d.cuentas.length > 1 && !est_.cuenta ? '<label class="fin2-campo"><span>Cuenta</span><select class="fin2-input js-fp-cuenta">' + opciones(d.cuentas.map(function (c) { return [c.id, c.nombre]; }), '', 'Elige…') + '</select></label>' : '';
    var dr = U.drawer({ titulo: 'Pegar filas desde Excel', subtitulo: '<span class="fin2-ayuda">Copia las filas de la planilla (desde TOTAL hasta DETALLE BANCO) y pégalas aquí. Revisa la vista previa antes de anotar.</span>',
      cuerpo: '<div class="fin2-p">' + cuentas + '<label class="fin2-campo"><span>Filas copiadas</span><textarea class="fin2-input fin3-pegado js-fp-texto" rows="7" placeholder="Pega aquí (Ctrl+V)"></textarea></label><div class="js-fp-vista"></div></div>',
      pie: U.boton({ texto: 'Anotar filas', icono: 'check', variante: 'primario', clase: 'js-fp-ok' }) });
    var lectura = { filas: [] };
    var area = dr.el.querySelector('.js-fp-texto'), vista = dr.el.querySelector('.js-fp-vista');
    area.addEventListener('input', function () {
      lectura = leerPegado(area.value);
      if (!lectura.cols) { vista.innerHTML = area.value.trim() ? '<p class="fin2-neg">No encuentro la columna de la fecha ni la del monto. Copia también el encabezado (FECHA, DETALLE, TOTAL, OBS…).</p>' : ''; return; }
      var ok = lectura.filas.filter(function (f) { return !f.error; });
      var malas = lectura.filas.filter(function (f) { return f.error; });
      var suma = ok.reduce(function (s, f) { return s + f.monto; }, 0);
      vista.innerHTML = '<p><b>' + ok.length + '</b> fila(s) para anotar · suman ' + plata(suma) + (malas.length ? ' · <span class="fin2-neg">' + malas.length + ' se saltan</span> (totales o filas incompletas)' : '') + '</p>' +
        '<div class="fin2-tabla-envoltura"><table class="fin2-tabla fin2-tabla--chica"><thead><tr><th>Fecha</th><th>Nombre</th><th>Plan</th><th>OBS</th><th class="fin2-der">Monto</th><th></th></tr></thead><tbody>' +
        lectura.filas.slice(0, 300).map(function (f) { return '<tr' + (f.error ? ' class="fin3-pg-mala"' : '') + '><td class="fin2-num">' + txt(f.fecha) + '</td><td>' + txt(f.alias) + '</td><td>' + txt(f.plan) + '</td><td>' + txt(f.obs) + '</td><td class="fin2-der fin2-num">' + (f.monto === '' ? '' : plata(f.monto)) + '</td><td class="fin2-ayuda">' + txt(f.error) + '</td></tr>'; }).join('') +
        '</tbody></table></div>';
    });
    dr.el.querySelector('.js-fp-ok').addEventListener('click', function (ev) {
      var ok = lectura.filas.filter(function (f) { return !f.error; });
      if (!ok.length) { x_.aviso('No hay filas para anotar.', 'error'); return; }
      var cuentaRef = cuentaUnica() || (dr.el.querySelector('.js-fp-cuenta') || {}).value;
      if (!cuentaRef) { x_.aviso('Elige la cuenta del banco.', 'error'); return; }
      var b = ev.currentTarget; b.disabled = true;
      var total = { anotadas: 0, en_banco: 0, clasificadas: 0 };
      var lotes = []; for (var i = 0; i < ok.length; i += 300) lotes.push(ok.slice(i, i + 300));
      lotes.reduce(function (p, lote) {
        return p.then(function (seguir) {
          if (!seguir) return false;
          return x_.api('finanzasRegistroAnotar', { cuenta_ref: cuentaRef, filas: lote.map(function (f) { return { fecha: f.fecha, monto: f.monto, alias: f.alias, plan: f.plan, obs: f.obs, glosa: f.glosa }; }) }).then(function (r) {
            if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo anotar.', 'error'); return false; }
            total.anotadas += r.data.anotadas; total.en_banco += r.data.en_banco; total.clasificadas += r.data.clasificadas; return true;
          });
        });
      }, Promise.resolve(true)).then(function () {
        b.disabled = false;
        if (!total.anotadas) return;
        x_.aviso(total.anotadas + ' fila(s) anotadas · ' + total.en_banco + ' unidas con el banco · ' + total.clasificadas + ' clasificadas.', 'exito');
        dr.cerrar(); recargar();
      });
    });
    area.focus();
  }

  // ---- eventos -----------------------------------------------------------------------------
  var enlazado_ = false;
  function enlazar() {
    if (enlazado_) return; enlazado_ = true;
    var raiz = document.getElementById('modulo-finanzas');
    raiz.addEventListener('change', function (ev) {
      if (!document.querySelector('.fin3-libro--hoja')) return;
      var t = ev.target;
      if (t.classList.contains('js-fl-mes')) { est_.periodo = t.value; x_.contexto({ periodo_libro: t.value }); ver(x_); }
      else if (t.classList.contains('js-fl-cuenta')) { est_.cuenta = t.value; x_.contexto({ cuenta_ref: t.value }); ver(x_); }
      else if (t.classList.contains('js-fl-sel')) { est_.sel[t.dataset.id] = t.checked; pintarLote(); }
      else if (t.classList.contains('js-fl-todas')) { visibles().forEach(function (l) { est_.sel[l.id] = t.checked; }); x_.raiz().querySelector('.js-fl-filas').innerHTML = filas(); pintarLote(); }
      else if (t.closest('.js-fl-anotar')) ayudaAnotar();
    });
    raiz.addEventListener('input', function (ev) {
      if (!document.querySelector('.fin3-libro--hoja')) return;
      if (ev.target.closest('.js-fl-anotar')) { ayudaAnotar(); return; }
      if (!ev.target.classList.contains('js-fl-busca')) return;
      est_.busca = ev.target.value;
      var tb = x_.raiz().querySelector('.js-fl-filas'); if (tb) tb.innerHTML = filas();
    });
    raiz.addEventListener('submit', function (ev) {
      var f = ev.target.closest('.js-fl-anotar'); if (!f) return;
      ev.preventDefault(); guardarAnotacion(f);
    });
    raiz.addEventListener('click', function (ev) {
      if (!document.querySelector('.fin3-libro--hoja')) return;
      var b = ev.target.closest('button, tr.fin3-fila');
      if (!b) return;
      if (b.classList.contains('js-fl-filtro')) { est_.filtro = b.dataset.id; pintar(); return; }
      if (b.classList.contains('js-fl-agrupar')) { agrupar(); return; }
      if (b.classList.contains('js-fl-sacar')) { sacarMarcadas(); return; }
      if (b.classList.contains('js-fl-desmarcar')) { est_.sel = {}; x_.raiz().querySelector('.js-fl-filas').innerHTML = filas(); pintarLote(); return; }
      if (b.classList.contains('js-fl-cargar')) { x_.ir('cargas'); return; }
      if (b.classList.contains('js-fl-pegar')) { pegar(); return; }
      if (b.classList.contains('js-fl-anotar-fila')) { panel(b.dataset.id); return; }
      if (b.tagName === 'TR' && !ev.target.closest('input')) panel(b.dataset.id);
    });
    raiz.addEventListener('keydown', function (ev) {
      var tr = ev.target.closest && ev.target.closest('tr.fin3-fila');
      if (tr && ev.key === 'Enter') { ev.preventDefault(); panel(tr.dataset.id); }
    });
  }

  window.SigsoFinanzasLibro = { ver: ver };
})();
