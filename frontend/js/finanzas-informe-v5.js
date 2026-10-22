/**
 * finanzas-informe-v5.js — Informes de Finanzas (v5, 22-10-2026; backend/logica/finanzasInformes.js).
 *
 * Convierte la planilla en información. Dos modos:
 *   - Un mes: lo que pasó en una frase, cifras clave con su comparación y tendencia, comentarios automáticos (lo
 *     crítico primero), el recorrido del banco (saldo inicial → saldo final), gastos por plan, honorarios por cliente,
 *     fondos de clientes, cobranza y la verificación de lo anotado contra la cartola.
 *   - Comparar períodos: un rango de meses con el gráfico mes a mes, la tabla comparativa, tendencias, el mapa de
 *     gastos por plan, los clientes que más aportan y la evolución de la caja.
 * Cada cifra tiene «¿Cómo se calculó?»: qué es, la fórmula con los números reales y las filas de la planilla que la
 * componen (y desde ahí, ir a la planilla).
 */
(function () {
  'use strict';

  var U = UIv2;
  var x_ = null;
  var est_ = { modo: 'mes', mes: '', desde: '', hasta: '', empresa: '', datos: null };
  var MESES_ = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  // ---- formatos ----------------------------------------------------------------------------------------
  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function plata(n, cero) { var v = Math.round(Number(n) || 0); if (!v && cero !== undefined) return cero; return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('es-CL'); }
  // $8,1 M / $950 mil: para gráficos y frases (el monto exacto siempre está a un clic).
  function corta(n) {
    var v = Math.round(Number(n) || 0), a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a >= 1e6) return s + '$' + (a / 1e6).toLocaleString('es-CL', { maximumFractionDigits: a >= 1e8 ? 0 : 1 }) + ' M';
    if (a >= 1e3) return s + '$' + Math.round(a / 1e3).toLocaleString('es-CL') + ' mil';
    return s + '$' + a;
  }
  function pct(v) { return v === null || v === undefined || isNaN(v) ? '—' : (Math.round(v * 10) / 10).toLocaleString('es-CL') + ' %'; }
  function mesLargo(p) { var a = String(p || '').split('-'); return a.length === 2 ? MESES_[Number(a[1]) - 1] + ' ' + a[0] : p; }
  function mesCorto(p) { var a = String(p || '').split('-'); return a.length === 2 ? MESES_[Number(a[1]) - 1].slice(0, 3) + ' ' + a[0].slice(2) : p; }
  function mesNombre(p) { return MESES_[Number(String(p).slice(5, 7)) - 1] || p; }
  function mesMas(p, n) { var a = String(p).split('-').map(Number); return new Date(Date.UTC(a[0], a[1] - 1 + n, 1)).toISOString().slice(0, 7); }
  function diaMes(iso) { var a = String(iso || '').split('-'); return a.length === 3 ? a[2] + '-' + a[1] : ''; }
  function hoy() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
  function variacion(a, b) { if (b === null || b === undefined) return null; if (!b) return a ? { dif: a, pct: null } : { dif: 0, pct: 0 }; return { dif: a - b, pct: (a - b) / Math.abs(b) * 100 }; }
  function reducido() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }

  // ---- qué es cada cifra y cómo se calcula (lenguaje claro) ------------------------------------------------
  var DEF = {
    honorarios: { t: 'Honorarios', ico: 'dinero', que: 'El dinero que la empresa ganó por sus servicios.', como: 'Suma de las filas con OBS ABONO o ABONO RENTA que entraron al banco, más lo que sobró de un grupo de fondos y se decidió cobrar como honorario.', f: { c: ['hon', 'hon_grupo'] }, bueno: 'sube' },
    gastos: { t: 'Gastos', ico: 'recibo', que: 'Lo que la empresa pagó para funcionar: sueldos, arriendo, servicios, impuestos propios…', como: 'Suma de las filas con OBS ABONO que salieron del banco, agrupadas por su plan de cuenta.', f: { c: ['gas'] }, bueno: 'baja' },
    resultado: { t: 'Resultado', ico: 'tendencia', que: 'Lo que queda después de pagar los gastos con los honorarios. Si es negativo, el mes costó más de lo que dejó.', como: 'Honorarios − gastos. Es exactamente el ABONO + ABONO RENTA del resumen de la planilla, así que se puede comparar con el Excel.', f: { c: ['hon', 'hon_grupo', 'gas'] }, bueno: 'sube' },
    margen: { t: 'Margen', ico: 'dona', que: 'De cada $100 de honorarios, cuántos quedan después de pagar los gastos.', como: 'Resultado ÷ honorarios × 100.', f: { c: ['hon', 'hon_grupo', 'gas'] }, bueno: 'sube' },
    caja_libre: { t: 'Caja libre', ico: 'caja', que: 'El dinero del banco que de verdad es de la empresa (descontando la de los clientes).', como: 'Saldo final de la cartola − lo que los clientes tienen a su favor (fondos que mandaron y todavía no se usan). Solo se calcula con la cartola de todas las cuentas.', f: null, bueno: 'sube' },
    custodia: { t: 'Fondos de clientes', ico: 'equipo', que: 'Dinero de clientes que está en la cuenta para pagar sus obligaciones (imposiciones, IVA…). No es de la empresa.', como: 'Por cliente, acumulado: lo que mandó − lo que se pagó por él − lo que sobró y se cobró como honorario. Se suman los saldos a favor.', f: { c: ['fon_rec', 'fon_pag'] }, bueno: null },
    meses_caja: { t: 'Meses de caja', ico: 'calendario', que: 'Cuántos meses de gastos se podrían pagar solo con la caja libre.', como: 'Caja libre ÷ gasto promedio de los últimos 3 meses.', f: null, bueno: 'sube' },
    verificado: { t: 'Verificado con la cartola', ico: 'check', que: 'Qué parte de lo anotado ya confirmó el banco. Con menos de 100 %, las cifras son provisorias.', como: 'Filas que coinciden con un movimiento de la cartola (mismo monto, hasta 3 días de diferencia) ÷ filas del mes.', f: { b: ['falta', 'esperando'] }, bueno: 'sube' },
    por_cobrar: { t: 'Por cobrar', ico: 'reloj', que: 'Facturas emitidas que todavía no se pagan (corte: hoy).', como: 'Total de cada factura − lo pagado según la planilla (columna N° factura) o lo aplicado en Cobranza − notas de crédito.', f: null, bueno: 'baja' },
    recurrentes: { t: 'Honorarios mensuales', ico: 'tendencia', que: 'Los honorarios que se repiten todos los meses (igualas). Dan estabilidad.', como: 'Honorarios con plan «Servicio Mensual» (incluido lo cobrado de los grupos) ÷ honorarios del mes.', f: { c: ['hon', 'hon_grupo'] }, bueno: 'sube' },
    gastos_fijos: { t: 'Gastos fijos', ico: 'candado', que: 'Gastos que se pagan todos los meses aunque baje el trabajo: sueldos, arriendo, sistemas, servicios básicos.', como: 'Gastos cuyo plan de cuenta es Sueldos, Arriendo, Servidores y Sistemas, Cuentas Básicas, Internet o Patente. Es una estimación por el nombre del plan.', f: { c: ['gas'] }, bueno: null },
    fondos: { t: 'Movimiento de fondos de clientes', ico: 'equipo', que: 'Dinero de clientes que entró y que se pagó por ellos. Va aparte de honorarios y gastos.', como: 'Filas con OBS IVA, IMPOSICIONES, SALDO o PENDIENTE, y todas las filas que están en un grupo.', f: { c: ['fon_rec', 'fon_pag'] }, bueno: null }
  };
  var CAT_ = { hon: 'Honorario', hon_grupo: 'Honorario (sobrante de grupo)', gas: 'Gasto', fon_rec: 'Fondos recibidos', fon_pag: 'Pagado por clientes', favor: 'A favor del cliente', pend: 'Grupo abierto', tra: 'Traspaso / préstamo', sin: 'Sin completar' };
  var NIVEL_ = { critico: ['Crítico', 'alerta'], alerta: ['Atención', 'alerta'], ok: ['Bien', 'check'], info: ['Para saber', 'info'] };

  // =====================================================================================
  //  Carga
  // =====================================================================================
  function ver(x) {
    x_ = x; enlazar();
    var c = x.contexto();
    est_.modo = c.informe_modo || est_.modo;
    est_.mes = c.informe_mes || est_.mes;
    est_.desde = c.informe_desde || est_.desde;
    est_.hasta = c.informe_hasta || est_.hasta;
    est_.empresa = c.informe_empresa !== undefined ? c.informe_empresa : est_.empresa;
    pedir();
  }
  function cuerpo() { var r = x_ && x_.raiz(); return r ? r.querySelector('.fin5[data-vista="informe"]') : null; }
  function pedir() {
    var x = x_, t = x.turno();
    var c = cuerpo();
    if (c) c.classList.add('fin5-cargando'); else x.pagina(x.cab('informe') + U.esqueleto('kpis', 6));
    var data = est_.modo === 'rango' ? { desde: est_.desde, hasta: est_.hasta, empresa: est_.empresa } : { desde: est_.mes, hasta: est_.mes, empresa: est_.empresa };
    x.api('finanzasInforme', data).then(function (r) {
      if (!x.vigente(t)) return;
      if (!r || !r.ok) {
        if (r && !r.boveda_cerrada) x.pagina(x.cab('informe') + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo armar el informe', texto: (r && r.message) || '', accion: '<button type="button" class="sx2-boton sx2-boton--secundario sx2-boton--sm js-fin-reintentar">Reintentar</button>' }) }));
        return;
      }
      var d = r.data;
      est_.datos = d;
      if (est_.modo === 'mes') est_.mes = d.hasta; else { est_.desde = d.desde; est_.hasta = d.hasta; }
      x.contexto({ informe_modo: est_.modo, informe_mes: est_.mes, informe_desde: est_.desde, informe_hasta: est_.hasta, informe_empresa: est_.empresa });
      pintar();
    });
  }

  // =====================================================================================
  //  Pintar
  // =====================================================================================
  function pintar() {
    var d = est_.datos, x = x_;
    var acciones = U.boton({ texto: 'Ir a la planilla', icono: 'tabla', sm: true, variante: 'secundario', clase: 'js-inf-planilla' }) +
      U.boton({ texto: 'Imprimir o guardar PDF', icono: 'imprimir', sm: true, variante: 'primario', clase: 'js-inf-imprimir' });
    var interior = barra(d) + calidad(d) + (est_.modo === 'rango' ? vistaRango(d) : vistaMes(d)) + metodo();
    var c = cuerpo();
    if (c) { c.setAttribute('data-quieto', '1'); c.innerHTML = interior; c.classList.remove('fin5-cargando'); }
    else x.pagina(x.cab('informe', acciones) + '<div class="sx2-pagina__cuerpo fin4 fin5 fin5-inf" data-vista="informe">' + interior + '</div>');
    x.aplicarCapacidades(x.raiz());
    crecer(cuerpo());
  }
  // Las barras crecen al aparecer (y no si se pidió reducir el movimiento).
  function crecer(raiz) {
    if (!raiz) return;
    var els = raiz.querySelectorAll('[data-alto],[data-ancho]');
    var red = reducido();
    Array.prototype.forEach.call(els, function (el) { if (red) aplicar(el); });
    if (red) return;
    requestAnimationFrame(function () { requestAnimationFrame(function () { Array.prototype.forEach.call(els, aplicar); }); });
    function aplicar(el) { if (el.hasAttribute('data-alto')) el.style.height = el.getAttribute('data-alto') + '%'; if (el.hasAttribute('data-ancho')) el.style.width = el.getAttribute('data-ancho') + '%'; }
  }

  function barra(d) {
    var disp = (d.disponibles || []).slice();
    if (disp.indexOf(hoy().slice(0, 7)) === -1) disp.push(hoy().slice(0, 7));
    disp.sort();
    // Todos los meses entre el primero con datos (o el elegido) y hoy, del más nuevo al más antiguo.
    var desdeOp = [disp[0], d.desde].sort()[0], hastaOp = [disp[disp.length - 1], d.hasta].sort()[1], ops = [];
    for (var q = hastaOp; q >= desdeOp && ops.length < 120; q = mesMas(q, -1)) ops.push(q);
    var sel = function (clase, actual, etq) { return '<label class="fin5-select">' + U.ico('calendario', 15) + '<select class="' + clase + '" aria-label="' + txt(etq) + '">' + ops.map(function (m) { return '<option value="' + m + '"' + (m === actual ? ' selected' : '') + '>' + txt(mesLargo(m)) + '</option>'; }).join('') + '</select></label>'; };
    var ultimo = disp[disp.length - 1];
    var presets = [['3', 'Últimos 3'], ['6', 'Últimos 6'], ['12', 'Últimos 12'], ['anio', 'Este año']];
    return '<div class="fin5-barra fin5-entra fin5-no-imprimir" style="--i:0">' +
      U.segmento([{ id: 'mes', texto: 'Un mes', icono: 'calendario' }, { id: 'rango', texto: 'Comparar períodos', icono: 'grafico' }], est_.modo, 'js-inf-modo') +
      (est_.modo === 'mes'
        ? '<div class="fin5-inf-nav"><button type="button" class="fin5-mini js-inf-mes" data-p="' + mesMas(d.hasta, -1) + '" title="Mes anterior">‹</button>' + sel('js-inf-sel-mes', d.hasta, 'Mes') +
          '<button type="button" class="fin5-mini js-inf-mes" data-p="' + mesMas(d.hasta, 1) + '" title="Mes siguiente"' + (d.hasta >= ultimo ? ' disabled' : '') + '>›</button></div>'
        : '<div class="fin5-inf-nav"><span class="fin5-inf-etq">Desde</span>' + sel('js-inf-desde', d.desde, 'Desde') + '<span class="fin5-inf-etq">hasta</span>' + sel('js-inf-hasta', d.hasta, 'Hasta') + '</div>' +
          '<div class="fin5-chips">' + presets.map(function (p) { return '<button type="button" class="fin5-chip js-inf-preset" data-p="' + p[0] + '">' + p[1] + '</button>'; }).join('') + '</div>') +
      (d.empresas.length > 1 ? '<label class="fin5-select">' + U.ico('empresa', 15) + '<select class="js-inf-empresa" aria-label="Empresa"><option value="">Todo el grupo</option>' + d.empresas.map(function (e) { return '<option' + (e === d.empresa ? ' selected' : '') + '>' + txt(e) + '</option>'; }).join('') + '</select></label>' : '') +
    '</div>';
  }

  function calidad(d) {
    var q = d.calidad, ok = q.estado === 'COMPLETO';
    return '<div class="fin5-inf-calidad fin5-inf-calidad--' + (ok ? 'ok' : 'prov') + ' fin5-entra" style="--i:1">' + U.ico(ok ? 'check' : 'info', 16) +
      '<div><b>' + (ok ? 'Informe completo.' : 'Informe provisorio.') + '</b> ' + (ok ? 'Todo lo anotado está verificado con la cartola y no hay filas por completar.' : 'Las cifras pueden cambiar cuando se complete lo que falta:') +
      (ok ? '' : '<ul>' + q.razones.slice(0, 6).map(function (r) { return '<li>' + txt(r) + '</li>'; }).join('') + (q.razones.length > 6 ? '<li>y ' + (q.razones.length - 6) + ' más</li>' : '') + '</ul>') + '</div></div>';
  }

  // ---- piezas comunes ---------------------------------------------------------------------------------------
  function conDatos(m) { return !!(m && (m.honorarios || m.gastos)); }
  function serieDe(d, k, hasta) { return d.meses.filter(function (m) { return m.periodo <= hasta; }).slice(-6).map(function (m) { return conDatos(m) ? m[k] : null; }); }
  function sparkline(vals, tono) {
    var v = vals.filter(function (n) { return n !== null && n !== undefined; });
    if (v.length < 2) return '';
    var min = Math.min.apply(null, v), max = Math.max.apply(null, v), r = max - min || 1, W = 100, H = 28;
    var pts = vals.map(function (n, i) { return n === null || n === undefined ? null : [(i / (vals.length - 1)) * W, H - 3 - ((n - min) / r) * (H - 6)]; }).filter(Boolean);
    var ult = pts[pts.length - 1];
    return '<svg class="fin5-spark fin5-spark--' + (tono || 'acento') + '" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '" vector-effect="non-scaling-stroke"/><circle cx="' + ult[0].toFixed(1) + '" cy="' + ult[1].toFixed(1) + '" r="2.4"/></svg>';
  }
  function delta(v, bueno, unidad) {
    if (!v) return '<span class="fin5-inf-delta fin5-inf-delta--neutro">sin mes anterior</span>';
    if (v.pct === null) return '<span class="fin5-inf-delta fin5-inf-delta--neutro">nuevo</span>';
    var sube = v.dif > 0, cero = Math.abs(v.pct) < 0.5;
    var tono = cero || !bueno ? 'neutro' : (sube === (bueno === 'sube') ? 'bien' : 'mal');
    return '<span class="fin5-inf-delta fin5-inf-delta--' + tono + '">' + (cero ? '= ' : sube ? '▲ ' : '▼ ') + (unidad === 'pp' ? Math.abs(Math.round(v.dif * 10) / 10) + ' pts' : Math.abs(Math.round(v.pct)) + ' %') + ' <small>vs mes anterior</small></span>';
  }
  function kpi(clave, valor, o, i) {
    o = o || {};
    var D = DEF[clave] || { t: clave, ico: 'dinero' };
    var v = valor === null || valor === undefined ? '<span class="fin5-tenue">—</span>' : o.fmt === 'pct' ? pct(valor) : o.fmt === 'n' ? (Math.round(valor * 10) / 10).toLocaleString('es-CL') : plata(valor);
    return '<button type="button" class="fin5-kpi fin5-kpi--' + (o.tono || 'neutro') + ' fin5-inf-kpi fin5-entra js-inf-explicar" data-k="' + clave + '" style="--i:' + (i || 0) + '" title="¿Cómo se calculó?">' +
      '<div class="fin5-kpi__cab"><span class="fin5-kpi__ico">' + U.ico(D.ico, 16) + '</span><span class="fin5-kpi__t">' + txt(o.t || D.t) + '</span><span class="fin5-inf-q" aria-hidden="true">?</span></div>' +
      '<b class="fin5-kpi__v' + (typeof valor === 'number' && valor < 0 && o.fmt !== 'pct' ? ' fin2-neg' : '') + '">' + v + '</b>' +
      (o.delta !== undefined ? delta(o.delta, D.bueno, o.unidad) : '') +
      (o.sub ? '<small class="fin5-kpi__sub">' + txt(o.sub) + '</small>' : '') + (o.serie ? sparkline(o.serie, o.tono === 'acento' ? 'blanco' : o.tono) : '') + '</button>';
  }
  function seccion(titulo, sub, cuerpoHtml, i, clase) {
    return '<section class="fin5-card fin5-inf-sec fin5-entra' + (clase ? ' ' + clase : '') + '" style="--i:' + (i || 0) + '"><header class="fin5-card__cab"><div><h2>' + txt(titulo) + '</h2>' + (sub ? '<p class="fin5-inf-sub">' + sub + '</p>' : '') + '</div></header>' + cuerpoHtml + '</section>';
  }
  // Barras horizontales: cada una abre las filas que la componen.
  function barrasH(lista, total, filtroDe, tono, opts) {
    opts = opts || {};
    if (!lista.length) return '<p class="fin5-nota">' + txt(opts.vacio || 'Sin datos en el período.') + '</p>';
    var max = Math.max.apply(null, lista.map(function (x) { return Math.abs(x.v); }).concat([1]));
    return '<ol class="fin5-inf-barras">' + lista.map(function (x, i) {
      var p = total ? Math.abs(x.v) / total * 100 : 0;
      return '<li><button type="button" class="fin5-inf-barra js-inf-filas" data-f="' + txt(JSON.stringify(filtroDe(x))) + '" data-t="' + txt(x.k) + '" style="--i:' + i + '">' +
        '<span class="fin5-inf-barra__k">' + txt(x.k) + (x.sub ? '<small>' + x.sub + '</small>' : '') + '</span>' +
        '<span class="fin5-inf-barra__pista"><span class="fin5-inf-barra__lleno fin5-inf-barra__lleno--' + (tono || 'acento') + '" data-ancho="' + (Math.abs(x.v) / max * 100).toFixed(1) + '"></span></span>' +
        '<span class="fin5-inf-barra__v">' + plata(x.v) + (total ? '<small>' + pct(p) + '</small>' : '') + '</span></button></li>';
    }).join('') + '</ol>';
  }
  function topObj(o, n) { return Object.keys(o || {}).map(function (k) { return { k: k, v: o[k] }; }).filter(function (x) { return x.v; }).sort(function (a, b) { return b.v - a.v; }).slice(0, n || 99); }
  function comentarios(lista, i) {
    if (!lista.length) return '';
    return seccion('Lo que dicen los datos', 'Comentarios automáticos, lo más importante primero. Cada uno explica cómo se llegó a esa conclusión.',
      '<div class="fin5-inf-coms">' + lista.map(function (c, k) {
        var n = NIVEL_[c.nivel] || NIVEL_.info;
        var accion = c.filtro && (c.filtro.c || c.filtro.b) ? '<button type="button" class="sx2-enlace js-inf-filas" data-f="' + txt(JSON.stringify(c.filtro)) + '" data-t="' + txt(c.titulo) + '">Ver las filas</button>'
          : c.filtro && c.filtro.vista ? '<button type="button" class="sx2-enlace js-inf-ir" data-v="' + (c.filtro.vista === 'clientes' ? 'saldos' : 'cobros') + '">Abrir ' + (c.filtro.vista === 'clientes' ? 'Saldo por cliente' : 'Cobranza') + '</button>' : '';
        return '<article class="fin5-inf-com fin5-inf-com--' + c.nivel + '" style="--i:' + k + '"><span class="fin5-inf-com__ico">' + U.ico(n[1], 16) + '</span><div class="fin5-inf-com__txt">' +
          '<span class="fin5-inf-com__nivel">' + n[0] + '</span><h3>' + txt(c.titulo) + '</h3><p>' + txt(c.texto) + '</p>' +
          '<details><summary>¿Cómo se llegó a esto?</summary><p>' + txt(c.como) + '</p>' + accion + '</details></div></article>';
      }).join('') + '</div>', i);
  }

  // =====================================================================================
  //  Un mes
  // =====================================================================================
  function vistaMes(d) {
    var P = d.hasta, m = mesDe(d, P), a = mesDe(d, mesMas(P, -1));
    if (!m || !m.n_filas) return '<div class="fin5-vacio fin5-entra"><span class="fin5-vacio__ico">' + U.ico('grafico', 26) + '</span><h3>' + txt(mesLargo(P)) + ' no tiene movimientos</h3><p>Elige otro mes o anota los movimientos en la planilla: el informe se arma solo con lo que hay ahí.</p></div>';
    var av = conDatos(a) ? a : null;
    var html = '';
    html += heroMes(d, m, av);
    html += '<section class="fin5-kpis fin5-inf-kpis" aria-label="Cifras clave">' +
      kpi('honorarios', m.honorarios, { tono: 'ok', delta: av ? variacion(m.honorarios, av.honorarios) : null, serie: serieDe(d, 'honorarios', P), sub: pct(m.honorarios ? m.recurrentes / m.honorarios * 100 : null) + ' mensuales' }, 1) +
      kpi('gastos', m.gastos, { tono: 'critico', delta: av ? variacion(m.gastos, av.gastos) : null, serie: serieDe(d, 'gastos', P), sub: pct(m.gastos ? m.gastos_fijos / m.gastos * 100 : null) + ' fijos' }, 2) +
      kpi('resultado', m.resultado, { tono: 'acento', delta: av ? variacion(m.resultado, av.resultado) : null, serie: serieDe(d, 'resultado', P), sub: 'margen ' + pct(m.margen) }, 3) +
      kpi('caja_libre', m.caja_libre, { tono: m.caja_libre !== null && m.caja_libre < 0 ? 'critico' : 'info', delta: av && av.caja_libre !== null && m.caja_libre !== null ? variacion(m.caja_libre, av.caja_libre) : undefined, sub: m.caja_libre === null ? 'falta la cartola' : (m.meses_caja !== null ? m.meses_caja.toLocaleString('es-CL') + ' meses de gastos' : '') }, 4) +
      kpi('custodia', m.custodia, { tono: 'neutro', sub: m.n_clientes_deben ? m.n_clientes_deben + ' cliente(s) deben ' + corta(m.clientes_deben) : 'ningún cliente debe' }, 5) +
      kpi('verificado', m.verificado, { t: 'Verificado', tono: m.verificado === 100 ? 'ok' : 'alerta', fmt: 'pct', sub: (m.verif.falta + m.verif.esperando) ? (m.verif.falta + m.verif.esperando) + ' fila(s) sin verificar' : 'todo coincide con el banco' }, 6) +
    '</section>';
    html += comentarios(d.comentarios, 7);
    html += '<div class="fin5-inf-grid">' + cascada(m, 8) + verificacion(m, 9) + '</div>';
    html += '<div class="fin5-inf-grid">' +
      seccion('Gastos por plan de cuenta', 'En qué se fue el dinero de la empresa. Toca una barra para ver sus filas.', barrasH(topObj(m.gas_plan, 12).map(function (x) { return conDelta(x, av && av.gas_plan, true); }), m.gastos, function (x) { return { c: ['gas'], pl: x.k }; }, 'critico', { vacio: 'Sin gastos anotados.' }), 10) +
      seccion('Honorarios por cliente', 'Quién generó los ingresos del mes. ' + concentracion(m), barrasH(topObj(m.hon_cliente, 10), m.honorarios, function (x) { return { c: ['hon', 'hon_grupo'], n: x.k }; }, 'ok', { vacio: 'Sin honorarios anotados.' }), 11) +
    '</div>';
    html += '<div class="fin5-inf-grid">' + fondos(d, m, 12) + cobranza(d, 13) + '</div>';
    return html;
  }
  function mesDe(d, p) { for (var i = 0; i < d.meses.length; i++) if (d.meses[i].periodo === p) return d.meses[i]; return null; }
  function conDelta(x, base, gasto) {
    if (!base) return x;
    var b = base[x.k] || 0, v = variacion(x.v, b);
    if (!v || v.pct === null) { x.sub = b ? '' : 'nuevo este mes'; return x; }
    if (Math.abs(v.pct) >= 10) x.sub = (v.dif > 0 ? '▲ ' : '▼ ') + Math.abs(Math.round(v.pct)) + ' % vs mes anterior';
    return x;
  }
  function concentracion(m) {
    var t = topObj(m.hon_cliente, 3), tot = m.honorarios;
    if (!tot || !t.length) return '';
    return 'Los 3 mayores son el ' + pct(t.reduce(function (s, x) { return s + x.v; }, 0) / tot * 100) + ' del total.';
  }

  // La frase del mes: lo esencial, en palabras.
  function heroMes(d, m, a) {
    var P = mesLargo(m.periodo), frases = [];
    frases.push('En ' + P + ' la empresa ganó <b>' + corta(m.honorarios) + '</b> en honorarios y gastó <b>' + corta(m.gastos) + '</b>: ' +
      (m.resultado >= 0 ? 'quedó un resultado positivo de <b class="fin5-inf-ok">' + corta(m.resultado) + '</b> (de cada $100, quedaron $' + Math.round(m.margen || 0) + ').' : 'el mes cerró con una pérdida de <b class="fin2-neg">' + corta(-m.resultado) + '</b>.'));
    if (a) {
      var vh = variacion(m.honorarios, a.honorarios), vg = variacion(m.gastos, a.gastos);
      if (vh && vh.pct !== null && vg && vg.pct !== null) frases.push('Frente a ' + mesNombre(a.periodo) + ', los honorarios ' + (Math.abs(vh.pct) < 2 ? 'se mantuvieron' : (vh.dif > 0 ? 'subieron ' : 'bajaron ') + Math.abs(Math.round(vh.pct)) + ' %') + ' y los gastos ' + (Math.abs(vg.pct) < 2 ? 'se mantuvieron' : (vg.dif > 0 ? 'subieron ' : 'bajaron ') + Math.abs(Math.round(vg.pct)) + ' %') + '.');
    }
    if (m.banco.saldo_final_conocido) frases.push('En el banco quedaron <b>' + corta(m.banco.saldo_final) + '</b>; de eso, ' + corta(m.custodia) + ' es de clientes y <b>' + corta(m.caja_libre) + '</b> es caja libre de la empresa.');
    var crit = d.comentarios.filter(function (c) { return c.nivel === 'critico'; });
    return '<section class="fin5-inf-hero fin5-entra" style="--i:1"><div class="fin5-inf-hero__txt"><span class="fin5-inf-hero__ceja">' + U.ico('destello', 14) + 'Informe de ' + txt(P) + (d.empresa ? ' · ' + txt(d.empresa) : ' · todo el grupo') + '</span><p>' + frases.join(' ') + '</p></div>' +
      '<div class="fin5-inf-hero__semaforo">' + ['critico', 'alerta', 'ok'].map(function (n) { var k = d.comentarios.filter(function (c) { return c.nivel === n; }).length; return '<span class="fin5-inf-sem fin5-inf-sem--' + n + '"><b>' + k + '</b>' + NIVEL_[n][0].toLowerCase() + (n === 'critico' && k ? '' : '') + '</span>'; }).join('') + '</div>' +
      (crit.length ? '<p class="fin5-inf-hero__crit">' + U.ico('alerta', 14) + 'Lo primero a revisar: ' + txt(crit[0].titulo) + '.</p>' : '') + '</section>';
  }

  // Cómo se movió el banco: saldo inicial → cada tipo de movimiento → saldo final (y si calza con la cartola).
  function cascada(m, i) {
    if (!m.banco.saldo_final_conocido) return seccion('Cómo se movió el dinero del banco', 'Falta la cartola de ' + txt(m.banco.cuentas_sin_cartola.join(', ') || 'este mes') + ': sin ella no se conoce el saldo.', '<p class="fin5-nota">Sube la cartola en «Subir archivos» y este gráfico muestra cómo se pasó del saldo inicial al final.</p>', i);
    var pasos = [
      ['Saldo inicial', m.banco.saldo_inicial, 'total'], ['Honorarios', m.honorarios, 'mov', { c: ['hon'] }], ['Gastos', -m.gastos, 'mov', { c: ['gas'] }],
      ['Fondos recibidos', m.fondos_recibidos, 'mov', { c: ['fon_rec'] }], ['Pagado por clientes', -m.fondos_pagados, 'mov', { c: ['fon_pag'] }]
    ];
    // Lo cobrado de los grupos no pasa por el banco (ya entró como fondos): se descuenta de honorarios para el recorrido.
    var cobradoGrupos = 0; (est_.datos.filas || []).forEach(function (f) { if (f.p === m.periodo && f.c === 'hon_grupo') cobradoGrupos += f.m; });
    pasos[1][1] = m.honorarios - cobradoGrupos;
    if (m.traspasos) pasos.push(['Traspasos y préstamos', m.traspasos, 'mov', { c: ['tra'] }]);
    if (m.sin_completar) pasos.push(['Sin completar', m.sin_completar, 'mov', { c: ['sin'] }]);
    var acc = 0, puntos = [];
    pasos.forEach(function (p) { var ini = p[2] === 'total' ? 0 : acc; acc = p[2] === 'total' ? p[1] : acc + p[1]; puntos.push({ k: p[0], v: p[1], ini: ini, fin: acc, tipo: p[2], f: p[3] }); });
    var calculado = acc;
    puntos.push({ k: 'Saldo final', v: calculado, ini: 0, fin: calculado, tipo: 'total' });
    var vals = []; puntos.forEach(function (p) { vals.push(p.ini, p.fin); });
    var min = Math.min.apply(null, vals.concat([0])), max = Math.max.apply(null, vals), r = max - min || 1;
    var y = function (v) { return (v - min) / r * 100; };
    var dif = m.banco.saldo_final - calculado;
    return seccion('Cómo se movió el dinero del banco', 'Del saldo inicial al final, por tipo de movimiento (lo cobrado de los grupos no se suma aquí: ya entró como fondos). Toca una barra para ver sus filas.',
      '<div class="fin5-inf-cascada" role="img" aria-label="Saldo inicial ' + plata(m.banco.saldo_inicial) + ', saldo final ' + plata(calculado) + '">' + puntos.map(function (p, k) {
        var lo = Math.min(p.ini, p.fin), hi = Math.max(p.ini, p.fin);
        var tono = p.tipo === 'total' ? 'total' : p.v >= 0 ? 'sube' : 'baja';
        return '<button type="button" class="fin5-inf-cas' + (p.f ? ' js-inf-filas' : '') + '"' + (p.f ? ' data-f="' + txt(JSON.stringify(p.f)) + '" data-t="' + txt(p.k) + '"' : ' tabindex="-1"') + ' style="--i:' + k + '">' +
          '<span class="fin5-inf-cas__v' + (p.v < 0 ? ' fin2-neg' : '') + '">' + (p.tipo === 'total' ? '' : p.v >= 0 ? '+' : '') + corta(p.v) + '</span>' +
          '<span class="fin5-inf-cas__area"><span class="fin5-inf-cas__barra fin5-inf-cas__barra--' + tono + '" style="bottom:' + y(lo).toFixed(1) + '%" data-alto="' + Math.max(0.8, y(hi) - y(lo)).toFixed(1) + '"></span></span>' +
          '<span class="fin5-inf-cas__k">' + txt(p.k) + '</span></button>';
      }).join('') + '</div>' +
      '<p class="fin5-inf-cuadre fin5-inf-cuadre--' + (Math.abs(dif) < 1 ? 'ok' : 'dif') + '">' + U.ico(Math.abs(dif) < 1 ? 'check' : 'info', 14) + '<span>' +
        (Math.abs(dif) < 1 ? 'El saldo final calculado desde la planilla es igual al de la cartola (' + plata(m.banco.saldo_final) + ').'
          : 'Saldo final según la cartola: <b>' + plata(m.banco.saldo_final) + '</b>; según la planilla: <b>' + plata(calculado) + '</b>. La diferencia de ' + plata(dif) + ' se explica por: ' +
            [m.verif.m_esperando ? 'filas anotadas que el banco todavía no trae (' + plata(-m.verif.m_esperando) + ')' : '', Math.abs(dif + m.verif.m_esperando) >= 1 ? 'movimientos que se ven en otro mes por su fecha (' + plata(dif + m.verif.m_esperando) + ')' : ''].filter(Boolean).join(' y ') + '.') + '</span></p>', i);
  }

  // Lo anotado a mano contra la cartola: qué coincide, qué falta y qué parece mal digitado.
  function verificacion(m, i) {
    var v = m.verif, n = m.n_filas || 1, p = Math.round(v.ok / n * 100);
    var circ = 213.63;
    var item = function (ico, tono, t, cant, monto, f) {
      return '<button type="button" class="fin5-inf-ver js-inf-filas fin5-inf-ver--' + tono + '" data-f="' + txt(JSON.stringify(f)) + '" data-t="' + txt(t) + '"' + (cant ? '' : ' disabled') + '><span class="fin5-inf-ver__ico">' + U.ico(ico, 15) + '</span><span class="fin5-inf-ver__t">' + txt(t) + '</span><b>' + cant + '</b><small>' + plata(monto, '—') + '</small></button>';
    };
    return seccion('Verificación con la cartola', '¿Lo que se anotó a mano coincide con lo que dice el banco?',
      '<div class="fin5-inf-verif"><div class="fin5-anillo" role="img" aria-label="' + p + '% verificado"><svg viewBox="0 0 80 80" aria-hidden="true"><circle class="fin5-anillo__fondo" cx="40" cy="40" r="34"/><circle class="fin5-anillo__valor fin5-anillo--' + (p === 100 ? 'ok' : 'alerta') + '" cx="40" cy="40" r="34" style="stroke-dashoffset:' + (circ * (1 - p / 100)).toFixed(2) + '"/></svg><div class="fin5-anillo__txt"><b>' + p + '%</b><small>verificado</small></div></div>' +
        '<div class="fin5-inf-ver-lista">' +
          item('check', 'ok', 'Coincide con la cartola', v.ok, v.m_ok, { b: ['ok'] }) +
          item('reloj', 'info', 'Anotado, el banco no lo trae', v.esperando, v.m_esperando, { b: ['esperando'] }) +
          item('alerta', 'alerta', 'En el banco, sin anotar', v.falta, v.m_falta, { b: ['falta'] }) +
        '</div></div>' +
      (v.diferencias.length ? '<div class="fin5-inf-difs"><h3>' + U.ico('alerta', 14) + 'Posibles montos mal digitados</h3><ul>' + v.diferencias.map(function (x) {
        return '<li><span>' + txt(diaMes(x.anotada.fecha)) + ' · anotado <b>' + plata(x.anotada.monto) + '</b> (' + txt(x.anotada.nombre || 'sin nombre') + ')</span><span>banco <b>' + plata(x.banco.monto) + '</b> · ' + txt(x.banco.glosa) + '</span><em>diferencia ' + plata(x.diferencia) + '</em></li>';
      }).join('') + '</ul><p class="fin5-nota">Si es el mismo movimiento, corrige el monto en la planilla: se unirá con el banco.</p></div>' : '') +
      '<p class="fin5-inf-cuadre fin5-inf-cuadre--' + (m.banco.cuadra && !m.banco.cortes ? 'ok' : 'dif') + '">' + U.ico(m.banco.cuadra && !m.banco.cortes ? 'check' : 'alerta', 14) +
        (!m.banco.saldo_final_conocido ? 'Falta la cartola para revisar la cadena de saldos.' : m.banco.cuadra && !m.banco.cortes ? 'La cartola está completa: saldo inicial + movimientos = saldo final, sin repetidos ni faltantes.' : 'La cartola no cuadra: hay ' + m.banco.cortes + ' corte(s) en la cadena de saldos (movimientos repetidos o faltantes).') + '</p>', i);
  }

  function fondos(d, m, i) {
    var deben = d.clientes.deben || [], favor = d.clientes.a_favor || [];
    var fila = function (c) { return '<li><span>' + txt(c.cliente) + '</span><small>recibido ' + corta(c.recibido) + ' · pagado ' + corta(c.pagado) + (c.cobrado ? ' · cobrado ' + corta(c.cobrado) : '') + '</small><b class="' + (c.saldo < 0 ? 'fin2-neg' : '') + '">' + plata(c.saldo) + '</b></li>'; };
    return seccion('Fondos de clientes', 'Dinero de clientes en la cuenta (no es de la empresa). Saldos acumulados desde ' + txt(mesLargo(d.clientes.desde)) + '.',
      '<div class="fin5-inf-fondos"><div class="fin5-inf-mini"><span>Recibido en el mes</span><b>' + plata(m.fondos_recibidos) + '</b></div><div class="fin5-inf-mini"><span>Pagado por ellos</span><b>' + plata(m.fondos_pagados) + '</b></div><div class="fin5-inf-mini"><span>A favor de clientes</span><b>' + plata(m.custodia) + '</b></div></div>' +
      (deben.length ? '<h3 class="fin5-inf-h3 fin5-inf-h3--mal">' + U.ico('alerta', 14) + 'Clientes que deben (se pagó más de lo que mandaron)</h3><ul class="fin5-inf-lista">' + deben.slice(0, 8).map(fila).join('') + '</ul>' : '<p class="fin5-inf-cuadre fin5-inf-cuadre--ok">' + U.ico('check', 14) + 'Ningún cliente debe fondos.</p>') +
      (favor.length ? '<h3 class="fin5-inf-h3">Mayores saldos a favor</h3><ul class="fin5-inf-lista">' + favor.slice(0, 5).map(fila).join('') + '</ul>' : '') +
      '<button type="button" class="sx2-enlace js-inf-ir" data-v="saldos">Ver el saldo de todos los clientes →</button>', i);
  }

  function cobranza(d, i) {
    var c = d.cobranza, a = c.aging, tot = c.por_cobrar || 1;
    var seg = function (k, tono, t) { return a[k] ? '<span class="fin5-pila__' + tono + '" data-ancho="' + (a[k] / tot * 100).toFixed(1) + '" title="' + txt(t) + ': ' + plata(a[k]) + '"></span>' : ''; };
    return seccion('Cobranza (a hoy)', 'Facturas emitidas que faltan por pagar. ' + (c.dso ? 'Se demora en promedio unos <b>' + c.dso + ' días</b> en cobrar.' : ''),
      (c.por_cobrar ? '<div class="fin5-inf-fondos"><div class="fin5-inf-mini"><span>Por cobrar</span><b>' + plata(c.por_cobrar) + '</b></div><div class="fin5-inf-mini"><span>Vencido</span><b class="' + (c.vencido ? 'fin2-neg' : '') + '">' + plata(c.vencido) + '</b></div><div class="fin5-inf-mini"><span>Facturas abiertas</span><b>' + c.n_abiertas + '</b></div></div>' +
        '<div class="fin5-pila fin5-inf-pila">' + seg('por_vencer', 'info', 'Por vencer') + seg('d1_30', 'alerta', '1 a 30 días') + seg('d31_60', 'naranjo', '31 a 60 días') + seg('d61_90', 'critico', '61 a 90 días') + seg('d90', 'oscuro', 'más de 90 días') + '</div>' +
        '<div class="fin5-leyenda"><span><i class="fin5-pt fin5-pt--info"></i>por vencer ' + corta(a.por_vencer) + '</span><span><i class="fin5-pt fin5-pt--alerta"></i>1–30 días ' + corta(a.d1_30) + '</span><span><i class="fin5-pt fin5-inf-pt--naranjo"></i>31–60 ' + corta(a.d31_60) + '</span><span><i class="fin5-pt fin5-pt--critico"></i>61–90 ' + corta(a.d61_90) + '</span><span><i class="fin5-pt fin5-inf-pt--oscuro"></i>+90 ' + corta(a.d90) + '</span></div>' +
        (c.top_deudores.length ? '<h3 class="fin5-inf-h3">Quién debe más</h3><ul class="fin5-inf-lista">' + c.top_deudores.slice(0, 5).map(function (x) { return '<li><span>' + txt(x.cliente) + '</span><b>' + plata(x.saldo) + '</b></li>'; }).join('') + '</ul>' : '')
        : '<p class="fin5-inf-cuadre fin5-inf-cuadre--ok">' + U.ico('check', 14) + 'No hay facturas por cobrar.</p>') +
      '<button type="button" class="sx2-enlace js-inf-ir" data-v="cobros">Abrir Cobranza →</button>', i);
  }

  // =====================================================================================
  //  Comparar períodos
  // =====================================================================================
  function vistaRango(d) {
    var ms = d.rango.map(function (p) { return mesDe(d, p) || { periodo: p, honorarios: 0, gastos: 0, resultado: 0, n_filas: 0, gas_plan: {}, hon_cliente: {}, verif: { ok: 0, esperando: 0, falta: 0 }, banco: {} }; });
    var con = ms.filter(function (m) { return m.n_filas; });
    var datos = ms.filter(conDatos);
    if (!datos.length) return '<div class="fin5-vacio fin5-entra"><span class="fin5-vacio__ico">' + U.ico('grafico', 26) + '</span><h3>No hay movimientos entre ' + txt(mesLargo(d.desde)) + ' y ' + txt(mesLargo(d.hasta)) + '</h3><p>Elige otro período.</p></div>';
    var tot = function (k) { return ms.reduce(function (s, m) { return s + (m[k] || 0); }, 0); };
    var H = tot('honorarios'), G = tot('gastos'), R = H - G, n = Math.max(1, datos.length);
    var fin = ms[ms.length - 1], ini = ms[0];
    var html = '';
    var frases = ['Entre <b>' + txt(mesLargo(d.desde)) + '</b> y <b>' + txt(mesLargo(d.hasta)) + '</b> (' + (datos.length === ms.length ? ms.length + (ms.length === 1 ? ' mes' : ' meses') : datos.length + ' de ' + ms.length + ' meses con datos') + ') los honorarios sumaron <b>' + corta(H) + '</b> y los gastos <b>' + corta(G) + '</b>: ' +
      (R >= 0 ? 'un resultado acumulado de <b class="fin5-inf-ok">' + corta(R) + '</b>' : 'una pérdida acumulada de <b class="fin2-neg">' + corta(-R) + '</b>') + ', en promedio ' + corta(R / n) + ' al mes.'];
    var neg = datos.filter(function (m) { return m.resultado < 0; });
    frases.push(neg.length ? neg.length + ' mes(es) cerraron con pérdida.' : 'Ningún mes cerró con pérdida.');
    html += '<section class="fin5-inf-hero fin5-entra" style="--i:1"><div class="fin5-inf-hero__txt"><span class="fin5-inf-hero__ceja">' + U.ico('grafico', 14) + 'Comparación de ' + ms.length + (ms.length === 1 ? ' mes' : ' meses') + (d.empresa ? ' · ' + txt(d.empresa) : ' · todo el grupo') + '</span><p>' + frases.join(' ') + '</p></div></section>';
    html += '<section class="fin5-kpis fin5-inf-kpis" aria-label="Totales del período">' +
      kpi('honorarios', H, { tono: 'ok', sub: 'promedio ' + corta(H / n) + ' al mes', serie: ms.map(function (m) { return conDatos(m) ? m.honorarios : null; }) }, 1) +
      kpi('gastos', G, { tono: 'critico', sub: 'promedio ' + corta(G / n) + ' al mes', serie: ms.map(function (m) { return conDatos(m) ? m.gastos : null; }) }, 2) +
      kpi('resultado', R, { tono: 'acento', sub: 'margen ' + pct(H ? R / H * 100 : null), serie: ms.map(function (m) { return conDatos(m) ? m.resultado : null; }) }, 3) +
      kpi('caja_libre', fin.caja_libre, { tono: 'info', t: 'Caja libre', sub: ini.caja_libre !== null && fin.caja_libre !== null && ini.caja_libre !== undefined ? 'al inicio ' + corta(ini.caja_libre) : 'falta la cartola en algún mes', serie: ms.map(function (m) { return m.caja_libre; }) }, 4) +
      kpi('custodia', fin.custodia, { tono: 'neutro', t: 'Fondos de clientes', sub: 'al cierre del período', serie: ms.map(function (m) { return m.n_filas ? m.custodia : null; }) }, 5) +
      kpi('verificado', con.reduce(function (s, m) { return s + m.verif.ok; }, 0) / Math.max(1, con.reduce(function (s, m) { return s + m.n_filas; }, 0)) * 100, { tono: 'alerta', fmt: 'pct', t: 'Verificado', sub: 'en el período' }, 6) +
    '</section>';
    html += seccion('Mes a mes', 'Honorarios y gastos de cada mes; el punto es el resultado. Pasa el mouse para ver el detalle.', combo(ms), 7);
    html += comentarios(d.comentarios, 8);
    html += seccion('Tabla comparativa', 'Cada fila es una cifra; cada columna, un mes. Verde: el mejor mes; rojo: el peor.', tablaRango(ms), 9);
    html += '<div class="fin5-inf-grid">' + seccion('Gastos por plan de cuenta, mes a mes', 'Más intenso = más gasto. Toca una celda para ver sus filas.', mapaGastos(ms), 10) +
      seccion('Clientes que más aportan', 'Honorarios del período por cliente y su evolución.', clientesRango(ms, H), 11) + '</div>';
    html += seccion('Caja y fondos de clientes', 'Saldo del banco al cierre de cada mes, cuánto es de clientes y la caja libre.', lineas(ms), 12);
    return html;
  }

  // Barras de honorarios y gastos por mes con el resultado como punto (y la línea que los une).
  function combo(ms) {
    var max = Math.max.apply(null, ms.map(function (m) { return Math.max(m.honorarios, m.gastos); }).concat([1]));
    var pts = ms.map(function (m, i) { return conDatos(m) ? [(i + 0.5) / ms.length * 100, 100 - Math.max(0, m.resultado) / max * 100] : null; }).filter(Boolean);
    return '<div class="fin5-inf-combo"><div class="fin5-inf-combo__area">' +
      '<svg class="fin5-inf-combo__linea" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + pts.map(function (p) { return p[0].toFixed(2) + ',' + p[1].toFixed(2); }).join(' ') + '" vector-effect="non-scaling-stroke"/></svg>' +
      ms.map(function (m, i) {
        return '<div class="fin5-inf-combo__col" tabindex="0" style="--i:' + i + '"><div class="fin5-inf-combo__barras">' +
          '<span class="fin5-bar fin5-bar--ing" data-alto="' + (m.honorarios / max * 100).toFixed(1) + '"></span><span class="fin5-bar fin5-bar--egr" data-alto="' + (m.gastos / max * 100).toFixed(1) + '"></span>' +
          (conDatos(m) ? '<span class="fin5-inf-combo__punto' + (m.resultado < 0 ? ' fin5-inf-combo__punto--neg' : '') + '" style="bottom:' + (Math.max(0, m.resultado) / max * 100).toFixed(1) + '%"></span>' : '') +
          '<div class="fin5-graf__tip" role="tooltip"><b>' + txt(mesLargo(m.periodo)) + '</b><span><i class="fin5-pt fin5-pt--ok"></i>Honorarios ' + plata(m.honorarios) + '</span><span><i class="fin5-pt fin5-pt--critico"></i>Gastos ' + plata(m.gastos) + '</span><span><i class="fin5-pt fin5-pt--acento"></i>Resultado ' + plata(m.resultado) + '</span>' + (conDatos(m) ? '' : '<span>sin honorarios ni gastos anotados</span>') + '</div></div>' +
          '<b class="fin5-graf__m' + (m.resultado < 0 ? ' fin2-neg' : '') + '">' + (conDatos(m) ? corta(m.resultado) : 'sin datos') + '</b><span class="fin5-graf__mes">' + txt(mesCorto(m.periodo)) + '</span></div>';
      }).join('') + '</div>' +
      '<div class="fin5-leyenda"><span><i class="fin5-pt fin5-pt--ok"></i>Honorarios</span><span><i class="fin5-pt fin5-pt--critico"></i>Gastos</span><span><i class="fin5-pt fin5-pt--acento"></i>Resultado</span></div></div>';
  }

  function tablaRango(ms) {
    var filas = [
      ['Honorarios', 'honorarios', 'plata', 'sube'], ['· mensuales (recurrentes)', 'recurrentes', 'plata', 'sube'], ['Gastos', 'gastos', 'plata', 'baja'], ['· fijos', 'gastos_fijos', 'plata', 'baja'],
      ['Resultado', 'resultado', 'plata', 'sube', true], ['Margen', 'margen', 'pct', 'sube'], ['Fondos recibidos', 'fondos_recibidos', 'plata'], ['Pagado por clientes', 'fondos_pagados', 'plata'],
      ['Fondos de clientes (cierre)', 'custodia', 'plata'], ['Saldo del banco (cierre)', 'saldo', 'plata'], ['Caja libre (cierre)', 'caja_libre', 'plata', 'sube'], ['Verificado', 'verificado', 'pct', 'sube'], ['Filas sin verificar', 'sinverif', 'n', 'baja']
    ];
    var val = function (m, k) { if (!m.n_filas && k !== 'custodia') return null; if (!conDatos(m) && /honorarios|recurrentes|gastos|resultado|margen|fondos_/.test(k)) return null; if (k === 'saldo') return m.banco && m.banco.saldo_final_conocido ? m.banco.saldo_final : null; if (k === 'sinverif') return m.verif.falta + m.verif.esperando; return m[k] === undefined ? null : m[k]; };
    var fmt = function (v, t) { return v === null ? '<span class="fin5-tenue">—</span>' : t === 'pct' ? pct(v) : t === 'n' ? v : plata(v); };
    var esStock = function (k) { return /custodia|saldo|caja_libre|margen|verificado/.test(k); };
    return '<div class="fin4-rep fin5-inf-tabla"><table class="fin4-tab"><thead><tr><th>Cifra</th>' + ms.map(function (m) { return '<th class="fin4-n">' + txt(mesCorto(m.periodo)) + '</th>'; }).join('') + '<th class="fin4-n">Total / promedio</th><th class="fin4-n">Cambio</th></tr></thead><tbody>' +
      filas.map(function (f) {
        var vs = ms.map(function (m) { return val(m, f[1]); }), nums = vs.filter(function (v) { return v !== null; });
        var mejor = f[3] && nums.length > 1 ? (f[3] === 'sube' ? Math.max.apply(null, nums) : Math.min.apply(null, nums)) : null;
        var peor = f[3] && nums.length > 1 ? (f[3] === 'sube' ? Math.min.apply(null, nums) : Math.max.apply(null, nums)) : null;
        var resumen = !nums.length ? null : esStock(f[1]) ? nums[nums.length - 1] : nums.reduce(function (a, b) { return a + b; }, 0);
        var primero = nums[0], ultimo = nums[nums.length - 1], cambio = nums.length > 1 ? variacion(ultimo, primero) : null;
        return '<tr' + (f[4] ? ' class="fin4-res"' : '') + '><th>' + txt(f[0]) + '</th>' + vs.map(function (v) {
          var cl = v !== null && mejor !== peor && v === mejor ? ' fin5-inf-mejor' : v !== null && mejor !== peor && v === peor ? ' fin5-inf-peor' : '';
          return '<td class="fin4-n' + cl + (v !== null && v < 0 && f[2] !== 'pct' ? ' fin2-neg' : '') + '">' + fmt(v, f[2]) + '</td>';
        }).join('') + '<td class="fin4-n fin4-tot">' + fmt(resumen, f[2]) + (esStock(f[1]) || !nums.length ? '' : '<small class="fin5-inf-prom">prom. ' + fmt(resumen / nums.length, f[2]) + '</small>') + '</td>' +
          '<td class="fin4-n">' + (cambio && cambio.pct !== null && f[2] !== 'pct' && f[2] !== 'n' ? '<span class="fin5-inf-delta fin5-inf-delta--' + (!f[3] || Math.abs(cambio.pct) < 0.5 ? 'neutro' : (cambio.dif > 0) === (f[3] === 'sube') ? 'bien' : 'mal') + '">' + (cambio.dif > 0 ? '▲ ' : cambio.dif < 0 ? '▼ ' : '= ') + Math.abs(Math.round(cambio.pct)) + ' %</span>' : '<span class="fin5-tenue">—</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="fin5-nota">Total para los montos del mes; para saldos, margen y verificado se muestra el último mes. «Cambio»: último mes frente al primero.</p>';
  }

  function mapaGastos(ms) {
    var tot = {}; ms.forEach(function (m) { Object.keys(m.gas_plan || {}).forEach(function (k) { tot[k] = (tot[k] || 0) + m.gas_plan[k]; }); });
    var planes = topObj(tot, 12);
    if (!planes.length) return '<p class="fin5-nota">Sin gastos en el período.</p>';
    return '<div class="fin4-rep fin5-inf-mapa"><table class="fin4-tab"><thead><tr><th>Plan</th>' + ms.map(function (m) { return '<th class="fin4-n">' + txt(mesCorto(m.periodo)) + '</th>'; }).join('') + '<th class="fin4-n">Total</th></tr></thead><tbody>' +
      planes.map(function (p) {
        var max = Math.max.apply(null, ms.map(function (m) { return (m.gas_plan || {})[p.k] || 0; }).concat([1]));
        return '<tr><th>' + txt(p.k) + '</th>' + ms.map(function (m) { var v = (m.gas_plan || {})[p.k] || 0; return '<td class="fin4-n' + (v ? ' js-inf-filas fin5-inf-celda' : ' fin4-cero') + '"' + (v ? ' data-f="' + txt(JSON.stringify({ c: ['gas'], pl: p.k, p: m.periodo })) + '" data-t="' + txt(p.k + ' · ' + mesLargo(m.periodo)) + '" style="--h:' + (v / max).toFixed(2) + '"' : '') + '>' + (v ? corta(v) : '—') + '</td>'; }).join('') + '<td class="fin4-n fin4-tot">' + corta(p.v) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function clientesRango(ms, H) {
    var tot = {}; ms.forEach(function (m) { Object.keys(m.hon_cliente || {}).forEach(function (k) { tot[k] = (tot[k] || 0) + m.hon_cliente[k]; }); });
    var top = topObj(tot, 10);
    if (!top.length) return '<p class="fin5-nota">Sin honorarios en el período.</p>';
    return '<ol class="fin5-inf-clientes">' + top.map(function (c) {
      var serie = ms.map(function (m) { return (m.hon_cliente || {})[c.k] || 0; });
      var t = serie.length > 2 ? serie[serie.length - 1] - serie[0] : 0;
      return '<li><button type="button" class="js-inf-filas" data-f="' + txt(JSON.stringify({ c: ['hon', 'hon_grupo'], n: c.k })) + '" data-t="' + txt(c.k) + '"><span class="fin5-inf-clientes__n">' + txt(c.k) + '<small>' + pct(H ? c.v / H * 100 : null) + ' del período</small></span>' + sparkline(serie, 'ok') +
        '<span class="fin5-inf-clientes__v">' + plata(c.v) + '<small class="fin5-inf-delta fin5-inf-delta--' + (t > 0 ? 'bien' : t < 0 ? 'mal' : 'neutro') + '">' + (t > 0 ? '▲' : t < 0 ? '▼' : '=') + '</small></span></button></li>';
    }).join('') + '</ol>';
  }

  // Líneas: saldo del banco, fondos de clientes y caja libre al cierre de cada mes.
  function lineas(ms) {
    var series = [['Saldo del banco', function (m) { return m.banco && m.banco.saldo_final_conocido ? m.banco.saldo_final : null; }, 'acento'], ['Fondos de clientes', function (m) { return m.n_filas ? m.custodia : null; }, 'violeta'], ['Caja libre', function (m) { return m.caja_libre === undefined ? null : m.caja_libre; }, 'ok']];
    var todos = []; series.forEach(function (s) { ms.forEach(function (m) { var v = s[1](m); if (v !== null) todos.push(v); }); });
    if (!todos.length) return '<p class="fin5-nota">Falta la cartola de los meses del período: sin ella no se conoce el saldo.</p>';
    var min = Math.min.apply(null, todos.concat([0])), max = Math.max.apply(null, todos), r = max - min || 1, W = 100, Hh = 60;
    var X = function (i) { return ms.length === 1 ? 50 : 4 + i / (ms.length - 1) * 92; }, Y = function (v) { return 4 + (1 - (v - min) / r) * (Hh - 8); };
    var cero = min < 0 ? '<line class="fin5-inf-lin__cero" x1="0" x2="100" y1="' + Y(0).toFixed(2) + '" y2="' + Y(0).toFixed(2) + '" vector-effect="non-scaling-stroke"/>' : '';
    return '<div class="fin5-inf-lin"><svg viewBox="0 0 ' + W + ' ' + Hh + '" preserveAspectRatio="none" aria-hidden="true">' + cero + series.map(function (s) {
      var tramos = [], act = [];
      ms.forEach(function (m, i) { var v = s[1](m); if (v === null) { if (act.length) tramos.push(act); act = []; } else act.push(X(i).toFixed(2) + ',' + Y(v).toFixed(2)); });
      if (act.length) tramos.push(act);
      return tramos.map(function (t) { return '<polyline class="fin5-inf-lin__' + s[2] + '" points="' + t.join(' ') + '" vector-effect="non-scaling-stroke"/>'; }).join('');
    }).join('') + '</svg><div class="fin5-inf-lin__meses">' + ms.map(function (m) {
      return '<div class="fin5-inf-lin__mes" tabindex="0"><span>' + txt(mesCorto(m.periodo)) + '</span><div class="fin5-graf__tip" role="tooltip"><b>' + txt(mesLargo(m.periodo)) + '</b>' + series.map(function (s) { var v = s[1](m); return '<span><i class="fin5-pt fin5-inf-pt--' + s[2] + '"></i>' + s[0] + ' ' + (v === null ? '—' : plata(v)) + '</span>'; }).join('') + '</div></div>';
    }).join('') + '</div><div class="fin5-leyenda">' + series.map(function (s) { return '<span><i class="fin5-pt fin5-inf-pt--' + s[2] + '"></i>' + s[0] + '</span>'; }).join('') + '</div></div>';
  }

  // ---- cómo se lee este informe -------------------------------------------------------------------------------
  function metodo() {
    var claves = ['honorarios', 'gastos', 'resultado', 'margen', 'recurrentes', 'gastos_fijos', 'fondos', 'custodia', 'caja_libre', 'meses_caja', 'verificado', 'por_cobrar'];
    return '<details class="fin5-card fin5-inf-metodo fin5-entra" style="--i:14"><summary>' + U.ico('libro', 16) + '<b>Cómo se arma este informe</b><span>Definiciones y fórmulas de cada cifra</span></summary>' +
      '<p class="fin5-nota">Todo sale de la planilla del banco, con sus mismas reglas: el OBS dice qué es cada fila (ABONO = de la empresa; IVA, IMPOSICIONES, SALDO y PENDIENTE = de clientes) y la cartola confirma lo anotado. Los montos son en pesos, por la fecha de cada fila en la planilla.</p>' +
      '<dl class="fin5-inf-defs">' + claves.map(function (k) { var D = DEF[k]; return '<div><dt>' + U.ico(D.ico, 14) + txt(D.t) + '</dt><dd>' + txt(D.que) + ' <em>' + txt(D.como) + '</em></dd></div>'; }).join('') + '</dl></details>';
  }

  // =====================================================================================
  //  ¿Cómo se calculó? (cajón con la explicación y las filas)
  // =====================================================================================
  function filtrar(f) {
    var d = est_.datos;
    return (d.filas || []).filter(function (x) {
      if (f.c && f.c.indexOf(x.c) === -1) return false;
      if (f.b && f.b.indexOf(x.b) === -1) return false;
      if (f.pl && x.pl !== f.pl) return false;
      if (f.n && x.n !== f.n) return false;
      if (f.p && x.p !== f.p) return false;
      if (est_.modo === 'mes' && x.p !== d.hasta) return false;
      return true;
    });
  }
  function tablaFilas(l) {
    if (!l.length) return '<p class="fin5-nota">No hay filas.</p>';
    var orden = l.slice().sort(function (a, b) { return Math.abs(b.m) - Math.abs(a.m); });
    var total = l.reduce(function (s, x) { return s + x.m; }, 0);
    return '<div class="fin5-inf-filas"><table class="fin4-tab"><thead><tr><th>Fecha</th><th>Nombre</th><th>OBS</th><th>Plan</th><th class="fin4-n">Monto</th><th>Banco</th></tr></thead><tbody>' +
      orden.slice(0, 400).map(function (x) {
        return '<tr><td class="fin2-num">' + (x.f ? txt(diaMes(x.f)) : '<span class="fin5-tenue">grupo ' + txt(x.g) + '</span>') + (est_.modo === 'rango' ? '<small class="fin5-tenue"> ' + txt(mesCorto(x.p)) + '</small>' : '') + '</td><td><b>' + txt(x.n || x.nom || '—') + '</b><small class="fin5-inf-glosa">' + txt(x.gl) + '</small></td><td>' + txt(x.o) + '</td><td>' + txt(x.pl) + '</td>' +
          '<td class="fin4-n' + (x.m < 0 ? ' fin2-neg' : ' fin2-pos') + '">' + plata(x.m) + '</td><td>' + (x.b === 'ok' ? '<span class="fin4-chip fin4-chip--ok"><i></i>en banco</span>' : x.b === 'esperando' ? '<span class="fin4-chip fin4-chip--esp"><i></i>esperando</span>' : x.b === 'falta' ? '<span class="fin4-chip fin4-chip--falta"><i></i>sin anotar</span>' : '<span class="fin5-tenue">—</span>') + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><th colspan="4">' + l.length + ' fila(s)' + (l.length > 400 ? ' (se muestran las 400 de mayor monto)' : '') + '</th><th class="fin4-n">' + plata(total) + '</th><th></th></tr></tfoot></table></div>';
  }
  function abrirCajon(titulo, sub, cuerpoHtml, p) {
    var dr = U.drawer({ titulo: titulo, subtitulo: sub ? '<span class="fin2-ayuda">' + sub + '</span>' : '', cuerpo: '<div class="fin4 fin5 fin5-inf-cajon">' + cuerpoHtml + '</div>',
      pie: U.boton({ texto: 'Abrir ' + mesLargo(p) + ' en la planilla', icono: 'tabla', variante: 'secundario', clase: 'js-inf-cajon-planilla' }) });
    var b = dr.el.querySelector('.js-inf-cajon-planilla');
    if (b) b.addEventListener('click', function () { dr.cerrar(); x_.ir('planilla', { periodo_hoja: p }); });
  }
  function explicar(k) {
    var D = DEF[k]; if (!D) return;
    var d = est_.datos, P = d.hasta, m = mesDe(d, P) || {}, rng = est_.modo === 'rango';
    var ms = d.rango.map(function (p) { return mesDe(d, p); }).filter(Boolean);
    var sum = function (c) { return ms.reduce(function (s, x) { return s + (x[c] || 0); }, 0); };
    var M = rng ? { honorarios: sum('honorarios'), gastos: sum('gastos'), recurrentes: sum('recurrentes'), gastos_fijos: sum('gastos_fijos'), fondos_recibidos: sum('fondos_recibidos'), fondos_pagados: sum('fondos_pagados') } : m;
    var calc = {
      honorarios: 'Honorarios = ' + plata(M.honorarios) + (rng ? ' en ' + ms.length + ' meses' : ''),
      gastos: 'Gastos = ' + plata(M.gastos),
      resultado: plata(M.honorarios) + ' − ' + plata(M.gastos) + ' = <b>' + plata(M.honorarios - M.gastos) + '</b>',
      margen: plata(M.honorarios - M.gastos) + ' ÷ ' + plata(M.honorarios) + ' × 100 = <b>' + pct(M.honorarios ? (M.honorarios - M.gastos) / M.honorarios * 100 : null) + '</b>',
      caja_libre: m.caja_libre === null || m.caja_libre === undefined ? 'No se puede calcular: falta la cartola de ' + txt((m.banco && m.banco.cuentas_sin_cartola || []).join(', ') || 'alguna cuenta') + '.' : plata(m.banco.saldo_final) + ' (saldo de la cartola) − ' + plata(m.custodia) + ' (de clientes) = <b>' + plata(m.caja_libre) + '</b>',
      custodia: 'A favor de clientes al cierre de ' + mesLargo(P) + ': <b>' + plata(m.custodia) + '</b>' + (m.clientes_deben ? '. Además, ' + m.n_clientes_deben + ' cliente(s) deben ' + plata(m.clientes_deben) + ' (no se restan de lo anterior).' : ''),
      meses_caja: m.meses_caja === null || m.meses_caja === undefined ? 'No se puede calcular sin caja libre.' : plata(m.caja_libre) + ' ÷ ' + plata(m.gasto_prom) + ' (gasto promedio) = <b>' + m.meses_caja.toLocaleString('es-CL') + ' meses</b>',
      verificado: m.verif ? m.verif.ok + ' de ' + m.n_filas + ' filas coinciden con la cartola = <b>' + pct(m.verificado) + '</b>' : '',
      por_cobrar: 'Por cobrar hoy: <b>' + plata(d.cobranza.por_cobrar) + '</b> (vencido ' + plata(d.cobranza.vencido) + ')',
      recurrentes: plata(M.recurrentes) + ' ÷ ' + plata(M.honorarios) + ' = <b>' + pct(M.honorarios ? M.recurrentes / M.honorarios * 100 : null) + '</b>',
      gastos_fijos: plata(M.gastos_fijos) + ' de ' + plata(M.gastos) + ' = <b>' + pct(M.gastos ? M.gastos_fijos / M.gastos * 100 : null) + '</b>',
      fondos: 'Recibido ' + plata(M.fondos_recibidos) + ' · pagado por clientes ' + plata(M.fondos_pagados)
    }[k] || '';
    var filas = D.f ? filtrar(D.f) : [];
    if (k === 'recurrentes') filas = filas.filter(function (x) { return /MENSUAL/i.test(x.pl); });
    if (k === 'gastos_fijos') filas = filas.filter(function (x) { return /SUELDO|REMUNERAC|ARRIENDO|SERVIDOR|SISTEMA|INTERNET|TELEFON|CUENTAS B|PATENTE|LEASING|SEGURO|CONTADOR/i.test(String(x.pl).normalize('NFD').replace(/[̀-ͯ]/g, '')); });
    abrirCajon(D.t, rng ? mesLargo(d.desde) + ' a ' + mesLargo(d.hasta) : mesLargo(P),
      '<div class="fin5-inf-exp"><h3>Qué es</h3><p>' + txt(D.que) + '</p><h3>Cómo se calcula</h3><p>' + txt(D.como) + '</p>' + (calc ? '<div class="fin5-inf-formula">' + calc + '</div>' : '') + '</div>' +
      (D.f ? '<h3 class="fin5-inf-h3">Las filas de la planilla que la componen</h3>' + tablaFilas(filas) : ''), P);
  }
  function verFilas(f, titulo) {
    var d = est_.datos, l = filtrar(f);
    var cats = (f.c || []).map(function (c) { return CAT_[c]; }).join(', ');
    abrirCajon(titulo, (est_.modo === 'rango' && !f.p ? mesLargo(d.desde) + ' a ' + mesLargo(d.hasta) : mesLargo(f.p || d.hasta)) + (cats ? ' · ' + cats : ''), tablaFilas(l), f.p || d.hasta);
  }

  // =====================================================================================
  //  Eventos
  // =====================================================================================
  var enlazado_ = false;
  function enlazar() {
    if (enlazado_) return; enlazado_ = true;
    var raiz = document.getElementById('modulo-finanzas');
    raiz.addEventListener('click', function (ev) {
      if (!ev.target.closest('.fin5-inf') && !ev.target.closest('.js-inf-planilla, .js-inf-imprimir')) return;
      var b = ev.target.closest('button, td.js-inf-filas'); if (!b) return;
      if (b.classList.contains('js-inf-modo')) { var nm = b.dataset.id; if (nm === est_.modo) return; est_.modo = nm; if (nm === 'rango' && !est_.desde) { est_.hasta = est_.mes || est_.datos.hasta; var dsp = (est_.datos.disponibles || []).filter(function (p) { return p <= est_.hasta; }); est_.desde = dsp.length >= 3 ? dsp[dsp.length - 3] : (dsp[0] || mesMas(est_.hasta, -2)); } if (nm === 'mes') est_.mes = est_.hasta || est_.mes; pedir(); return; }
      if (b.classList.contains('js-inf-mes')) { est_.mes = b.dataset.p; pedir(); return; }
      if (b.classList.contains('js-inf-preset')) {
        var u = (est_.datos.disponibles || []).slice(-1)[0] || hoy().slice(0, 7), p = b.dataset.p;
        est_.hasta = u; est_.desde = p === 'anio' ? u.slice(0, 4) + '-01' : mesMas(u, -(Number(p) - 1)); pedir(); return;
      }
      if (b.classList.contains('js-inf-explicar')) { explicar(b.dataset.k); return; }
      if (b.classList.contains('js-inf-filas')) { try { verFilas(JSON.parse(b.dataset.f), b.dataset.t || 'Filas'); } catch (e) { /* filtro inválido */ } return; }
      if (b.classList.contains('js-inf-ir')) { x_.ir(b.dataset.v); return; }
      if (b.classList.contains('js-inf-planilla')) { x_.ir('planilla', { periodo_hoja: est_.modo === 'rango' ? est_.hasta : est_.mes }); return; }
      if (b.classList.contains('js-inf-imprimir')) { imprimir(); return; }
    });
    raiz.addEventListener('change', function (ev) {
      var t = ev.target; if (!t.closest('.fin5-inf')) return;
      if (t.classList.contains('js-inf-sel-mes')) { est_.mes = t.value; pedir(); }
      else if (t.classList.contains('js-inf-desde')) { est_.desde = t.value; if (est_.desde > est_.hasta) est_.hasta = est_.desde; pedir(); }
      else if (t.classList.contains('js-inf-hasta')) { est_.hasta = t.value; if (est_.desde > est_.hasta) est_.desde = est_.hasta; pedir(); }
      else if (t.classList.contains('js-inf-empresa')) { est_.empresa = t.value; pedir(); }
    });
  }
  // Para imprimir se abren los «¿cómo se llegó?» y la metodología: el papel no tiene clics.
  function imprimir() {
    var c = cuerpo(); if (!c) return;
    var cerrados = Array.prototype.filter.call(c.querySelectorAll('details'), function (d) { return !d.open; });
    cerrados.forEach(function (d) { d.open = true; });
    document.body.classList.add('fin5-imprimiendo');
    setTimeout(function () { window.print(); document.body.classList.remove('fin5-imprimiendo'); cerrados.forEach(function (d) { d.open = false; }); }, 50);
  }

  window.SigsoFinanzasInforme = { ver: ver };
})();
