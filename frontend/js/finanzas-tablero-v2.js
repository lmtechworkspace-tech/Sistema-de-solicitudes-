/**
 * finanzas-tablero-v2.js — Finanzas, Etapa 4: tablero de gerencia (2026-10-06;
 * backend/logica/finanzasTablero.js). Primera vista al abrir la bóveda.
 *
 * Que cualquiera entienda el mes en 30 segundos: lectura automática (lo malo
 * primero), cifras clave, ingresos vs. gastos de 12 meses, del ingreso al
 * resultado, comparación entre empresas, caja, obligaciones, cobranza y
 * plata de clientes en custodia. Gráficos en SVG propio (sin librerías), con
 * detalle al pasar el cursor; colores validados para daltonismo (dataviz).
 * «Informe del mes» lo imprime el motor de reportes de SIGSO por la bóveda,
 * con marca de agua.
 */
(function () {
  'use strict';

  var U = UIv2;
  var NS = 'http://www.w3.org/2000/svg';
  var x_ = null;
  var est_ = { periodo: '', empresa: '', datos: null };
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var COLOR_EMP = ['var(--fin2-ing)', 'var(--fin2-egr)', 'var(--fin2-s3)'];
  var PESO = '$', MENOS = '−';

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function plata(n) { var v = Math.round(Number(n) || 0); return (v < 0 ? MENOS : '') + PESO + Math.abs(v).toLocaleString('es-CL'); }
  function millones(n) {
    var a = Math.abs(n), s = n < 0 ? MENOS : '';
    return a >= 1e6 ? s + PESO + (a / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + ' M' : s + PESO + Math.round(a / 1e3).toLocaleString('es-CL') + ' mil';
  }
  function mesCorto(p) { return MESES[Number(p.split('-')[1]) - 1]; }
  function mesLargo(p) { var a = p.split('-'); return MESES_L[Number(a[1]) - 1] + ' ' + a[0]; }
  function nextMes(p) { var a = p.split('-').map(Number); return a[1] === 12 ? (a[0] + 1) + '-01' : a[0] + '-' + String(a[1] + 1).padStart(2, '0'); }
  function corta(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '-' + p[1] : ''; }

  // --- tooltip ----------------------------------------------------------------------------
  function tip() {
    var t = document.getElementById('fin2-tip');
    if (!t) { t = document.createElement('div'); t.id = 'fin2-tip'; t.className = 'fin2-tip'; document.body.appendChild(t); }
    return t;
  }
  function mostrarTip(ev, titulo, filas) {
    var t = tip();
    t.innerHTML = '<b>' + txt(titulo) + '</b>' + filas.map(function (f) {
      return '<div class="fin2-tip__f"><span><i style="background:' + f[2] + '"></i>' + txt(f[0]) + '</span><b>' + txt(f[1]) + '</b></div>';
    }).join('');
    t.classList.add('fin2-tip--on'); moverTip(ev);
  }
  function moverTip(ev) {
    var t = tip(), w = t.offsetWidth, h = t.offsetHeight, x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + w > innerWidth - 8) x = ev.clientX - w - 14;
    if (y + h > innerHeight - 8) y = ev.clientY - h - 14;
    t.style.left = x + 'px'; t.style.top = y + 'px';
  }
  function ocultarTip() { var t = document.getElementById('fin2-tip'); if (t) t.classList.remove('fin2-tip--on'); }

  // --- svg ---------------------------------------------------------------------------------
  function el(tag, a, padre) { var n = document.createElementNS(NS, tag); for (var k in a) n.setAttribute(k, a[k]); if (padre) padre.appendChild(n); return n; }
  function lienzo(host, w, h) { host.innerHTML = ''; var s = el('svg', { viewBox: '0 0 ' + w + ' ' + h, width: '100%', role: 'img', class: 'fin2-svg' }); host.appendChild(s); return s; }
  function topBar(x, y, w, h, r) { r = Math.min(r, w / 2, h); if (h <= 0) return ''; return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z'; }
  function redondo(v) { var p = Math.pow(10, Math.floor(Math.log10(v || 1))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
  function texto(s, a, contenido) { el('text', a, s).textContent = contenido; }

  function graficoFlujo(host, serie, elegido) {
    var W = 640, H = 240, L = 46, B = 24, T = 16;
    var s = lienzo(host, W, H);
    var mx = redondo(Math.max.apply(null, serie.map(function (m) { return Math.max(m.ingresos, m.egresos, m.ppto_ingresos || 0); }).concat([1])) * 1.08);
    var y = function (v) { return T + (H - T - B) * (1 - v / mx); }, bw = (W - L) / serie.length;
    // Etapa 5: ingresos presupuestados como línea punteada (misma escala).
    var conPpto = serie.filter(function (m) { return m.ppto_ingresos; });
    if (conPpto.length) {
      var pts = serie.map(function (m, i) { return m.ppto_ingresos ? (L + i * bw + bw / 2) + ',' + y(m.ppto_ingresos) : null; }).filter(Boolean);
      if (pts.length > 1) el('path', { d: 'M' + pts.join('L'), style: 'fill:none;stroke:var(--sx-texto);stroke-width:1.5;stroke-dasharray:4 4;opacity:.65' }, s);
      serie.forEach(function (m, i) { if (m.ppto_ingresos) el('circle', { cx: L + i * bw + bw / 2, cy: y(m.ppto_ingresos), r: 3, style: 'fill:var(--sx-superficie);stroke:var(--sx-texto);stroke-width:1.5' }, s); });
    }
    for (var g = 0; g <= 4; g++) {
      var v = mx * g / 4;
      el('line', { x1: L, x2: W, y1: y(v), y2: y(v), class: g ? 'fin2-grid-l' : 'fin2-base' }, s);
      texto(s, { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, v ? (v / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + ' M' : '0');
    }
    serie.forEach(function (m, i) {
      var x0 = L + i * bw, w = Math.max(4, Math.min(20, (bw - 12) / 2)), on = m.periodo === elegido;
      el('path', { d: topBar(x0 + bw / 2 - w - 1, y(m.ingresos), w, y(0) - y(m.ingresos), 4), style: 'fill:var(--fin2-ing);opacity:' + (on ? 1 : 0.5) + ';animation-delay:' + i * 40 + 'ms', class: 'fin2-crece' }, s);
      el('path', { d: topBar(x0 + bw / 2 + 1, y(m.egresos), w, y(0) - y(m.egresos), 4), style: 'fill:var(--fin2-egr);opacity:' + (on ? 1 : 0.5) + ';animation-delay:' + (i * 40 + 20) + 'ms', class: 'fin2-crece' }, s);
      texto(s, { x: x0 + bw / 2, y: H - 6, 'text-anchor': 'middle', class: on ? 'fin2-svg-val' : '' }, mesCorto(m.periodo));
      if (on) texto(s, { x: x0 + bw / 2, y: Math.max(12, y(Math.max(m.ingresos, m.egresos)) - 8), 'text-anchor': 'middle', class: 'fin2-svg-val' }, millones(m.resultado));
      var hit = el('rect', { x: x0, y: T, width: bw, height: H - T - B, class: 'fin2-hit' }, s);
      hit.addEventListener('mousemove', function (ev) {
        mostrarTip(ev, mesLargo(m.periodo), [['Ingresos de la empresa', plata(m.ingresos), 'var(--fin2-ing)'], ['Gastos de la empresa', plata(m.egresos), 'var(--fin2-egr)'], ['Resultado', plata(m.resultado), 'transparent']]
          .concat(m.ppto_ingresos ? [['Ingresos presupuestados', plata(m.ppto_ingresos), 'transparent'], ['Gastos presupuestados', plata(m.ppto_egresos), 'transparent']] : []).concat([
          ['Fondos de clientes recibidos', plata(m.fondos_recibidos), 'transparent']]).concat(m.pendientes ? [['Sin revisar', m.pendientes + ' movimientos', 'var(--sx-alerta)']] : []));
      });
      hit.addEventListener('mouseleave', ocultarTip);
      hit.addEventListener('click', function () { est_.periodo = m.periodo; ver(x_); });
    });
  }

  function graficoCascada(host, mes, gastos) {
    var W = 460, H = 240, L = 6, B = 40, T = 20;
    var s = lienzo(host, W, H);
    var top = gastos.slice(0, 5), resto = gastos.slice(5).reduce(function (a, g) { return a + g.monto; }, 0);
    var pasos = [{ n: 'Ingresos', v: mes.ingresos, t: 'i' }].concat(top.map(function (g) { return { n: g.cuenta, v: -g.monto, t: 'e' }; }));
    if (resto) pasos.push({ n: 'Otros gastos', v: -resto, t: 'e' });
    pasos.push({ n: 'Resultado', v: mes.resultado, t: 'r' });
    var mx = redondo(Math.max(mes.ingresos, mes.egresos, 1) * 1.08);
    var mn = Math.min(0, mes.resultado);
    var y = function (v) { return T + (H - T - B) * (1 - (v - mn) / (mx - mn)); }, bw = (W - L) / pasos.length, acc = 0;
    el('line', { x1: L, x2: W, y1: y(0), y2: y(0), class: 'fin2-base' }, s);
    pasos.forEach(function (p, i) {
      var arriba, abajo;
      if (p.t === 'i') { arriba = p.v; abajo = 0; acc = p.v; } else if (p.t === 'e') { arriba = acc; abajo = acc + p.v; acc = abajo; } else { arriba = Math.max(p.v, 0); abajo = Math.min(p.v, 0); }
      var x = L + i * bw + 5, w = bw - 10;
      var color = p.t === 'i' ? 'var(--fin2-ing)' : p.t === 'e' ? 'var(--fin2-egr)' : (p.v >= 0 ? 'var(--sx-texto)' : 'var(--sx-critico)');
      el('rect', { x: x, y: y(arriba), width: w, height: Math.max(2, y(abajo) - y(arriba)), rx: 3, style: 'fill:' + color + ';animation-delay:' + i * 70 + 'ms', class: 'fin2-crece' }, s);
      texto(s, { x: x + w / 2, y: y(arriba) - 5, 'text-anchor': 'middle', class: 'fin2-svg-val' }, (p.t === 'e' ? MENOS : '') + (Math.abs(p.v) / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 1 }));
      var etq = p.n.length > 10 ? p.n.slice(0, 9) + '…' : p.n;
      texto(s, { x: x + w / 2, y: H - 24, 'text-anchor': 'middle', class: 'fin2-svg-lbl' }, etq);
      var hit = el('rect', { x: L + i * bw, y: T, width: bw, height: H - T - B, class: 'fin2-hit' }, s);
      hit.addEventListener('mousemove', function (ev) { mostrarTip(ev, p.n, [['Monto', plata(p.v), color], ['% del ingreso', mes.ingresos ? Math.round(Math.abs(p.v) / mes.ingresos * 100) + ' %' : '—', 'transparent']]); });
      hit.addEventListener('mouseleave', ocultarTip);
    });
    texto(s, { x: W / 2, y: H - 4, 'text-anchor': 'middle' }, 'millones de pesos');
  }

  function graficoEmpresas(host, porEmpresa, elegido) {
    host.innerHTML = '';
    var todos = []; porEmpresa.forEach(function (e) { e.serie.forEach(function (m) { todos.push(m.resultado); }); });
    var mx = redondo(Math.max.apply(null, todos.map(Math.abs).concat([1])) * 1.1), mn = Math.min(0, Math.min.apply(null, todos.concat([0])));
    porEmpresa.forEach(function (e, k) {
      var d = document.createElement('div'); d.className = 'fin2-emp'; host.appendChild(d);
      var W = 200, H = 110, T = 26, B = 16, R = e.serie.map(function (m) { return m.resultado; });
      var s = lienzo(d, W, H), color = COLOR_EMP[k % COLOR_EMP.length];
      var y = function (v) { return T + (H - T - B) * (1 - (v - mn) / (mx - mn)); }, x = function (i) { return 4 + i * ((W - 8) / Math.max(1, R.length - 1)); };
      var ult = e.serie.findIndex(function (m) { return m.periodo === elegido; });
      texto(s, { x: 0, y: 12, class: 'fin2-svg-lbl' }, e.empresa);
      texto(s, { x: W, y: 12, 'text-anchor': 'end', class: 'fin2-svg-val' }, millones(R[ult >= 0 ? ult : R.length - 1] || 0));
      el('line', { x1: 0, x2: W, y1: y(0), y2: y(0), class: 'fin2-base' }, s);
      var dd = 'M' + R.map(function (v, i) { return x(i) + ',' + y(v); }).join('L');
      if (R.length > 1) {
        el('path', { d: dd + 'L' + x(R.length - 1) + ',' + y(0) + 'L' + x(0) + ',' + y(0) + 'Z', style: 'fill:' + color + ';opacity:.12' }, s);
        el('path', { d: dd, style: 'fill:none;stroke:' + color + ';stroke-width:2;stroke-linejoin:round;stroke-linecap:round' }, s);
      }
      R.forEach(function (v, i) {
        el('circle', { cx: x(i), cy: y(v), r: i === ult ? 4.5 : 2.5, style: 'fill:' + color + ';stroke:var(--sx-superficie);stroke-width:1.5' }, s);
        var hit = el('rect', { x: x(i) - 10, y: T, width: 20, height: H - T - B, class: 'fin2-hit' }, s);
        hit.addEventListener('mousemove', function (ev) { var m = e.serie[i]; mostrarTip(ev, e.empresa + ' · ' + mesLargo(m.periodo), [['Resultado', plata(m.resultado), color], ['Ingresos', plata(m.ingresos), 'transparent'], ['Gastos', plata(m.egresos), 'transparent']]); });
        hit.addEventListener('mouseleave', ocultarTip);
      });
    });
  }

  function barrasIngresos(lista) {
    if (!lista.length) return U.vacio({ icono: 'dinero', texto: 'Sin ingresos de la empresa confirmados este mes.' });
    var mx = lista[0].monto || 1, total = lista.reduce(function (s, g) { return s + g.monto; }, 0);
    return '<ul class="fin2-hbar">' + lista.map(function (g, i) {
      return '<li><span class="fin2-hbar__n">' + txt(g.cuenta) + '</span><b>' + plata(g.monto) + '</b><span class="fin2-hbar__pista"><i style="width:' + (g.monto / mx * 100) + '%;animation-delay:' + i * 60 + 'ms"></i></span><span class="fin2-ayuda">' + Math.round(g.monto / total * 100) + ' %</span></li>';
    }).join('') + '</ul>';
  }

  // =====================================================================================
  function ver(x) {
    x_ = x;
    var t = x.turno();
    x.pagina(x.cab('Tablero') + U.esqueleto('kpis', 5) + U.esqueleto('tarjetas', 3));
    x.api('finanzasTablero', { periodo: est_.periodo, empresa: est_.empresa }).then(function (r) {
      if (!x.vigente(t)) return;
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('Tablero') + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: r.message || '' }) })); return; }
      est_.datos = r.data;
      if (r.data.sin_datos) {
        x.pagina(x.cab('Tablero') + U.card({ cuerpo: U.vacio({ icono: 'grafico', titulo: 'El tablero se arma con las cartolas', texto: 'Sube la primera cartola en Bancos y confirma sus movimientos: aquí aparecerán el resultado, la caja, la cobranza y la plata de clientes.',
          accion: U.boton({ texto: 'Ir a Bancos', icono: 'derecha', variante: 'primario', clase: 'js-fint-ir', datos: { v: 'bancos' } }) }) }));
        enlazar();
        return;
      }
      est_.periodo = r.data.periodo; est_.empresa = r.data.empresa;
      pintar(r.data);
    });
  }

  function controles(d) {
    var ops = [{ id: '', texto: 'Grupo' }].concat(d.empresas.map(function (e) { return { id: e, texto: e }; }));
    return '<select class="fin2-input fin2-input--sm js-fint-mes" aria-label="Mes">' + d.periodos.map(function (p) { return '<option value="' + p + '"' + (p === d.periodo ? ' selected' : '') + '>' + txt(mesLargo(p)) + '</option>'; }).join('') + '</select>' +
      (d.empresas.length > 1 ? U.segmento(ops, d.empresa, 'js-fint-emp') : '') +
      U.boton({ texto: 'Informe del mes (PDF)', icono: 'descargar', variante: 'primario', clase: 'js-fint-pdf' });
  }

  function delta(actual, previo, bueno) {
    if (previo == null) return null;
    var dif = actual - previo;
    if (!dif) return { texto: 'igual que el mes anterior', tono: 'neutro' };
    var pct = previo ? Math.round(Math.abs(dif) / Math.abs(previo) * 100) : null;
    var mejor = bueno === 'sube' ? dif > 0 : dif < 0;
    return { texto: (dif > 0 ? '▲ ' : '▼ ') + millones(Math.abs(dif)) + (pct !== null ? ' (' + pct + ' %)' : '') + ' vs. mes anterior', tono: mejor ? 'ok' : 'critico' };
  }

  function cajaCuentas(d) {
    return d.cuentas.length ? '<ul class="fin2-mini">' + d.cuentas.map(function (c) {
      return '<li><span>' + txt(c.banco) + ' ···' + txt(c.ultimos4) + ' · ' + txt(c.empresa) + '<span class="fin2-motivo">al ' + txt(corta(c.al)) + '</span></span><b>' + plata(c.saldo) + '</b></li>';
    }).join('') + '</ul>' : U.vacio({ icono: 'maletin', texto: 'Sin cuentas.' });
  }

  function pintar(d) {
    var m = d.mes, a = d.mes_anterior;
    var alcance = d.empresa || 'Grupo (' + d.empresas.join(', ') + ')';
    var lectura = d.lectura.map(function (l) {
      var ic = { critico: '!', alerta: '!', ok: '✓', info: 'i' }[l.tono] || 'i';
      return '<div><span class="fin2-lectura__ic sx2-tono-' + l.tono + '">' + ic + '</span><span>' + txt(l.texto) + '</span></div>';
    }).join('');
    var oblig = d.obligaciones.map(function (o) {
      return '<li><span class="fin2-ob__dia">' + txt(corta(o.fecha)) + '</span><span>' + txt(o.nombre) + '</span><b>' + (o.estimado ? '≈ ' + plata(o.estimado) : '—') + '</b></li>';
    }).join('');
    var alcanza = d.caja >= d.total_obligaciones;
    var kpiCaja = d.meses_caja !== null && d.meses_caja !== undefined
      ? { texto: 'cubre ' + String(d.meses_caja).replace('.', ',') + ' meses de gastos' + (d.calidad.completo ? '' : ' (provisorio)'), tono: d.meses_caja < 2 ? 'critico' : (d.meses_caja < 4 || !d.calidad.completo) ? 'alerta' : 'ok' }
      : d.total_obligaciones ? { texto: alcanza ? 'alcanza para las obligaciones' : 'no alcanza para las obligaciones', tono: alcanza ? 'ok' : 'critico' } : { texto: 'sin datos para estimar obligaciones', tono: 'neutro' };
    var deudas = (d.entre_empresas || []).map(function (x) {
      return '<li><span><b>' + txt(x.debe) + '</b> le debe a <b>' + txt(x.a) + '</b></span><b>' + plata(x.monto) + '</b></li>';
    }).join('');
    var kpiCustodia = d.custodia < 0 ? { texto: 'se pagó más de lo que mandaron', tono: 'alerta' } : { texto: 'no se puede gastar', tono: 'neutro' };
    x_.pagina(x_.cab('Tablero', controles(d)) +
      '<div class="fin2-informe" id="fin2-informe">' +
        '<header class="fin2-inf-cab"><div><span class="fin2-hero__k">Informe financiero</span><h2>' + txt(mesLargo(d.periodo)) + ' · ' + txt(alcance) + '</h2></div>' +
          (d.calidad.completo ? U.badge('Mes revisado completo', 'ok') : U.badge('Provisorio: ' + d.calidad.pendientes + ' movimientos sin revisar', 'alerta')) + '</header>' +
        '<div class="sx2-fila-kpis fin2-kpis5">' +
          U.kpi({ etiqueta: 'Resultado del mes', valor: millones(m.resultado), icono: 'tendencia', tono: m.resultado < 0 ? 'critico' : '', i: 0, tendencia: delta(m.resultado, a && a.resultado, 'sube') }) +
          U.kpi({ etiqueta: 'Ingresos de la empresa', valor: millones(m.ingresos), icono: 'dinero', i: 1, tendencia: delta(m.ingresos, a && a.ingresos, 'sube') }) +
          U.kpi({ etiqueta: 'Gastos de la empresa', valor: millones(m.egresos), icono: 'recibo', i: 2, tendencia: delta(m.egresos, a && a.egresos, 'baja') }) +
          U.kpi({ etiqueta: 'Caja al cierre', valor: millones(d.caja), icono: 'maletin', i: 3, tendencia: kpiCaja }) +
          U.kpi({ etiqueta: 'Plata de clientes (custodia)', valor: millones(d.custodia), icono: 'equipo', i: 4, tono: d.custodia < 0 ? 'alerta' : '', tendencia: kpiCustodia }) +
        '</div>' +
        U.card({ titulo: 'Lectura del mes', icono: 'bombilla', sub: 'lo que conviene mirar primero', cuerpo: '<div class="fin2-lectura">' + lectura + '</div>' }) +
        '<div class="fin2-grid fin2-grid--2">' +
          U.card({ titulo: 'Ingresos y gastos de la empresa', icono: 'grafico', sub: 'sin la plata de clientes · clic en un mes para verlo', cuerpo: '<div id="fint-flujo"></div>' +
            '<div class="fin2-ley"><span style="--k:var(--fin2-ing)">Ingresos</span><span style="--k:var(--fin2-egr)">Gastos</span>' +
            (d.presupuesto_cargado ? '<span class="fin2-ley--linea">Ingresos presupuestados</span>' : '') + '</div>' }) +
          U.card({ titulo: 'Del ingreso al resultado', icono: 'capas', sub: 'de cada ' + PESO + '100 que entraron quedaron ' + PESO + (m.ingresos ? Math.round(m.resultado / m.ingresos * 100) : 0), cuerpo: '<div id="fint-cascada"></div>' }) +
        '</div>' +
        '<div class="fin2-grid">' +
          U.card({ titulo: 'Ingresos por cuenta', icono: 'dinero', cuerpo: barrasIngresos(d.ingresos) }) +
          U.card({ titulo: 'Cobranza hoy', icono: 'recibo', cuerpo:
            '<ul class="fin2-mini">' +
              '<li><span>Por cobrar</span><b>' + plata(d.cobranza.por_cobrar) + '</b></li>' +
              '<li><span>Vencido</span><b class="' + (d.cobranza.vencido ? 'fin2-neg' : '') + '">' + plata(d.cobranza.vencido) + '</b></li>' +
              '<li><span>Más de 60 días</span><b class="' + (d.cobranza.mas_60 ? 'fin2-neg' : '') + '">' + plata(d.cobranza.mas_60) + '</b></li>' +
              '<li><span>Pagado sin factura</span><b>' + plata(d.cobranza.saldo_a_favor) + '</b></li>' +
            '</ul>' + (d.cobranza.top.length ? '<p class="fin2-ayuda" style="margin-top:8px">Más vencidos: ' + d.cobranza.top.map(function (c) { return txt(c.cliente) + ' ' + plata(c.vencido); }).join(' · ') + '</p>' : '') }) +
          U.card({ titulo: 'Obligaciones de ' + mesLargo(nextMes(d.periodo)), icono: 'calendario', sub: 'estimadas con lo pagado este mes', cuerpo:
            '<ul class="fin2-ob">' + oblig + '</ul>' +
            (d.total_obligaciones ? '<p class="fin2-ob__tot ' + (alcanza ? 'fin2-pos' : 'fin2-neg') + '">' + (alcanza ? '✓ La caja alcanza' : '⚠ La caja no alcanza') + ' (' + plata(d.caja) + ' vs ≈ ' + plata(d.total_obligaciones) + ')</p>'
              : '<p class="fin2-ayuda" style="margin-top:10px">Sin sueldos, imposiciones ni IVA de la empresa confirmados este mes: no se puede estimar.</p>') }) +
        '</div>' +
        '<div class="fin2-grid fin2-grid--2">' +
          (d.por_empresa.length > 1 ? U.card({ titulo: 'Resultado por empresa', icono: 'empresa', sub: 'misma escala para comparar', cuerpo: '<div id="fint-empresas" class="fin2-emps"></div>' })
            : U.card({ titulo: 'Caja por cuenta', icono: 'maletin', cuerpo: cajaCuentas(d) })) +
          U.card({ titulo: 'Plata de clientes en custodia', icono: 'equipo', sub: d.clientes_con_fondos + ' cliente(s)', cuerpo:
            '<p class="fin2-ayuda">Lo que los clientes mandaron para sus imposiciones e IVA y todavía no se paga. Es de ellos.</p>' +
            '<p class="fin2-grande' + (d.custodia < 0 ? ' fin2-neg' : '') + '">' + plata(d.custodia) + '</p>' +
            (d.fondos_negativos.length ? '<p class="fin2-ayuda"><b class="fin2-neg">En negativo según lo registrado:</b> ' + d.fondos_negativos.map(function (f) { return txt(f.cliente) + ' ' + plata(f.saldo); }).join(' · ') + '</p>' : '<p class="fin2-ayuda">Ningún cliente en negativo.</p>') }) +
        '</div>' +
        (d.por_empresa.length > 1 ? U.card({ titulo: 'Caja por cuenta', icono: 'maletin', cuerpo: cajaCuentas(d) }) : '') +
        (deudas ? U.card({ titulo: 'Entre empresas', icono: 'derivar', sub: 'préstamos y gastos compartidos pagados por otra', cuerpo: '<ul class="fin2-mini">' + deudas + '</ul>' }) : '') +
        '<p class="fin2-ayuda fin2-pie-inf">Cifras de la bóveda de Finanzas. Resultado = ingresos menos gastos de la empresa; la plata de clientes, los traspasos entre cuentas propias y los préstamos entre empresas van aparte.' + (d.calidad.completo ? '' : ' Mes con movimientos sin revisar: las cifras pueden cambiar.') + '</p>' +
      '</div>');
    graficoFlujo(document.getElementById('fint-flujo'), d.serie, d.periodo);
    graficoCascada(document.getElementById('fint-cascada'), m, d.gastos);
    if (d.por_empresa.length > 1) graficoEmpresas(document.getElementById('fint-empresas'), d.por_empresa, d.periodo);
    if (U.animar) U.animar(x_.raiz());
    enlazar();
  }

  function descargar(boton) {
    var raiz = document.getElementById('fin2-informe');
    if (!raiz || !window.SigsoReportes || !SigsoReportes.descargarPdf) return;
    var d = est_.datos;
    SigsoReportes.descargarPdf(raiz, {
      titulo: 'Informe financiero ' + mesLargo(d.periodo) + ' · ' + (d.empresa || 'Grupo'),
      nombreArchivo: 'informe-financiero-' + d.periodo + (d.empresa ? '-' + d.empresa : ''), boton: boton,
      accion: 'finanzasInformePdf', extra: x_.credenciales()
    });
  }

  var enlazado_ = false;
  function enlazar() {
    var raiz = x_.raiz();
    if (enlazado_ || !raiz) return;
    enlazado_ = true;
    raiz.addEventListener('change', function (ev) {
      if (ev.target.classList.contains('js-fint-mes')) { est_.periodo = ev.target.value; ver(x_); }
    });
    raiz.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      if (b.classList.contains('js-fint-emp')) { est_.empresa = b.dataset.id || ''; ver(x_); }
      else if (b.classList.contains('js-fint-pdf')) { descargar(b); }
      else if (b.classList.contains('js-fint-ir')) { x_.ir(b.dataset.v); }
    });
    window.addEventListener('scroll', ocultarTip, { passive: true });
  }

  window.SigsoFinanzasTablero = { ver: ver };
})();
