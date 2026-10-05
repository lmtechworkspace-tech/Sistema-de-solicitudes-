/**
 * indicadores-v2.js — cómo se dibujan los indicadores de la reportabilidad
 * (2026-10-03). Lo comparten el reporte de cada área y el informe de gestión,
 * para que se lean igual en todos lados:
 *  - tarjeta(k)   el número, su estado, una mini tendencia, la meta y la
 *                 explicación automática ("bajó porque…").
 *  - grafico(k)   la serie de 12 meses a escala, con la línea de meta.
 *  - alerta(a)    lo que requiere decisión: qué pasa, por qué, impacto y
 *                 decisión sugerida, con una franja del color de su gravedad.
 *  - detalle(d)   las tablas que respaldan las alertas.
 * Los datos los arma el servidor (backend/logica/indicadoresDepto.js); aquí
 * solo se pinta. Colores solo con tokens v2: se ve igual en claro y oscuro.
 */
(function () {
  'use strict';

  var U = UIv2;
  var MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var TONO = { ok: 'ok', alerta: 'alerta', critico: 'critico', info: 'info', sin_dato: 'neutro', sin_datos: 'neutro', en_curso: 'neutro' };
  var ESTADO_TXT = { ok: 'En meta', alerta: 'Vigilar', critico: 'Crítico', info: 'Informativo', sin_dato: 'Sin dato', sin_datos: 'Sin datos', en_curso: 'En curso' };

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function n1(v, dec) { return Number(v).toLocaleString('es-CL', { maximumFractionDigits: dec == null ? 1 : dec }); }
  function valor(k, v) {
    if (v === null || v === undefined) return '—';
    if (k.formato === 'monto') return Math.abs(v) >= 1e6 ? '$' + n1(v / 1e6) + ' MM' : '$' + n1(v, 0);
    if (k.formato === 'pct') return n1(v) + ' %';
    if (k.formato === 'ratio') return n1(v) + '×';
    return n1(v, 0);
  }
  function corto(k, v) { return k.formato === 'monto' ? (Math.abs(v) >= 1e6 ? n1(v / 1e6, 0) : n1(v, 0)) : n1(v, k.formato === 'pct' || k.formato === 'ratio' ? 1 : 0); }
  function mesDe(p) { var m = /^(\d{4})-M(\d{2})$/.exec(p || ''); return m ? MES[+m[2] - 1] : ''; }
  function chip(estado) { return U.badge(ESTADO_TXT[estado] || estado, TONO[estado] || 'neutro'); }

  // --- SVG ----------------------------------------------------------------------------------
  function linea(serie) {
    var v = serie.map(function (x) { return x.valor; }).filter(function (x) { return x !== null && x !== undefined; });
    if (v.length < 2) return '';
    var min = Math.min.apply(null, v), max = Math.max.apply(null, v);
    if (max === min) { max += 1; min -= 1; }
    var W = 120, H = 30, n = serie.length;
    var pts = [];
    serie.forEach(function (x, i) { if (x.valor !== null && x.valor !== undefined) pts.push([2 + (W - 4) * i / (n - 1), H - 3 - (H - 6) * (x.valor - min) / (max - min)]); });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var u = pts[pts.length - 1];
    return '<svg class="ind-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + '" class="ind-spark__l" vector-effect="non-scaling-stroke"/><circle cx="' + u[0] + '" cy="' + u[1] + '" r="2.6" class="ind-spark__p"/></svg>';
  }
  /** Gráfico de 12 meses: barras para montos y cantidades; línea para porcentajes. */
  function grafico(k) {
    var s = k.serie || [];
    var vals = s.map(function (x) { return x.valor; }).filter(function (x) { return x !== null && x !== undefined; });
    if (vals.length < 2) return '';
    var W = 420, H = 190, L = 44, R = 10, T = 20, B = 26, n = s.length;
    var prel = !!k.preliminar; // el último mes todavía se registra: punteado
    var esPct = k.formato === 'pct';
    var max = Math.max.apply(null, vals.concat(k.umbrales && k.umbrales.meta != null ? [k.umbrales.meta] : []));
    var min = esPct ? Math.max(0, Math.floor((Math.min.apply(null, vals.concat(k.umbrales && k.umbrales.meta != null ? [k.umbrales.meta] : [])) - 5) / 5) * 5) : 0;
    max = esPct ? Math.min(100, Math.ceil((max + 2) / 5) * 5) : max * 1.15;
    if (max <= min) max = min + 1;
    var y = function (v) { return T + (H - T - B) * (1 - (v - min) / (max - min)); };
    var paso = (W - L - R) / n, x = function (i) { return L + paso * (i + 0.5); };
    var o = '<svg class="ind-graf" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + U.esc(k.nombre + ', últimos 12 meses') + '">';
    [min, (min + max) / 2, max].forEach(function (t) {
      o += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" class="ind-graf__eje"/>' +
        '<text x="' + (L - 6) + '" y="' + (y(t) + 3).toFixed(1) + '" text-anchor="end" class="ind-graf__t">' + U.esc(corto(k, t)) + '</text>';
    });
    s.forEach(function (p, i) { o += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle" class="ind-graf__t">' + mesDe(p.periodo) + '</text>'; });
    var meta = k.umbrales && k.umbrales.meta != null ? k.umbrales.meta : null;
    if (meta !== null && meta >= min && meta <= max) o += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(meta).toFixed(1) + '" y2="' + y(meta).toFixed(1) + '" class="ind-graf__meta"/><text x="' + (W - R) + '" y="' + (y(meta) - 4).toFixed(1) + '" text-anchor="end" class="ind-graf__mt">meta ' + U.esc(corto(k, meta)) + '</text>';
    var malo = function (v) { if (meta === null || v === null) return false; return k.sentido === 'menor' ? v > (k.umbrales.alerta != null ? k.umbrales.alerta : meta) : v < (k.umbrales.alerta != null ? k.umbrales.alerta : meta); };
    if (esPct || k.formato === 'ratio') {
      var d = '', ult = null;
      var pts = [];
      s.forEach(function (p, i) { if (p.valor === null || p.valor === undefined) return; pts.push([i, p.valor]); ult = [i, p.valor]; });
      var hasta = prel && pts.length > 1 ? pts.length - 1 : pts.length;
      pts.slice(0, hasta).forEach(function (q, j) { d += (j ? 'L' : 'M') + x(q[0]).toFixed(1) + ' ' + y(q[1]).toFixed(1) + ' '; });
      o += '<path d="' + d + '" class="ind-graf__l"/>';
      if (hasta < pts.length) { var a2 = pts[pts.length - 2], b2 = pts[pts.length - 1]; o += '<path d="M' + x(a2[0]).toFixed(1) + ' ' + y(a2[1]).toFixed(1) + ' L' + x(b2[0]).toFixed(1) + ' ' + y(b2[1]).toFixed(1) + '" class="ind-graf__l ind-graf__l--prel"/>'; }
      s.forEach(function (p, i) { if (p.valor === null || p.valor === undefined) return; o += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(p.valor).toFixed(1) + '" r="' + (i === n - 1 ? 4.5 : 3) + '" class="' + (malo(p.valor) ? 'ind-graf__pm' : 'ind-graf__p') + '"/>'; });
      if (ult) o += '<text x="' + x(ult[0]).toFixed(1) + '" y="' + (y(ult[1]) - 9).toFixed(1) + '" text-anchor="middle" class="ind-graf__v">' + U.esc(corto(k, ult[1])) + '</text>';
    } else {
      var bw = Math.min(28, paso * 0.66);
      s.forEach(function (p, i) {
        if (p.valor === null || p.valor === undefined) return;
        o += '<rect x="' + (x(i) - bw / 2).toFixed(1) + '" y="' + y(p.valor).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, y(min) - y(p.valor)).toFixed(1) + '" rx="2" class="' + (i === n - 1 ? 'ind-graf__b ind-graf__b--ult' + (prel ? ' ind-graf__b--prel' : '') : 'ind-graf__b') + '"/>';
      });
      var u = s[n - 1];
      if (u && u.valor !== null) o += '<text x="' + x(n - 1).toFixed(1) + '" y="' + (y(u.valor) - 5).toFixed(1) + '" text-anchor="middle" class="ind-graf__v">' + U.esc(corto(k, u.valor)) + '</text>';
    }
    return o + '</svg>';
  }

  // --- piezas -------------------------------------------------------------------------------
  function tarjeta(k, i) {
    return '<article class="ind-kpi ind-kpi--' + U.esc(k.estado) + ' sx2-entra" style="--i:' + (i || 0) + '">' +
      '<header class="ind-kpi__cab"><span class="ind-kpi__nom">' + txt(k.nombre) + (k.mide ? '<small class="ind-kpi__mide">' + txt(k.mide) + '</small>' : '') + '</span>' + chip(k.estado) + '</header>' +
      '<div class="ind-kpi__fila"><span class="ind-kpi__v">' + txt(valor(k, k.valor)) + '</span>' + linea(k.serie || []) + '</div>' +
      (k.meta_texto ? '<span class="ind-kpi__meta">Meta: ' + txt(k.meta_texto) + (k.confiable === false ? ' · <b>dato no confiable</b>' : '') + '</span>' : '') +
      '<p class="ind-kpi__exp">' + txt(k.explicacion || k.nota || '') + '</p>' +
      (k.definicion ? '<details class="ind-kpi__def"><summary>Cómo se calcula</summary><span>' + txt(k.definicion) + '</span></details>' : '') + '</article>';
  }
  function figura(k) {
    var g = grafico(k);
    if (!g) return '';
    return '<figure class="ind-fig"><figcaption><strong>' + txt(k.nombre) + '</strong><span>' + txt(k.definicion || '') + '</span></figcaption>' + g +
      '<p class="ind-fig__lec">' + txt(k.explicacion || '') + '</p></figure>';
  }
  function alerta(a) {
    return '<article class="ind-alerta ind-alerta--' + U.esc(a.nivel) + ' sx2-entra">' +
      '<header class="ind-alerta__cab"><strong>' + txt(a.titulo) + '</strong><span class="ind-alerta__cifra">' + txt(a.cifra || '') + '</span>' + (a.area ? '<span class="sx2-tenue">' + txt(a.area) + '</span>' : '') + '</header>' +
      (a.que_pasa ? '<p>' + txt(a.que_pasa) + '</p>' : '') +
      (a.por_que ? '<p class="ind-alerta__porque"><b>Por qué pasa:</b> ' + txt(a.por_que) + '</p>' : '') +
      '<div class="ind-alerta__pie">' + (a.impacto ? '<span><b>Impacto:</b> ' + txt(a.impacto) + '</span>' : '') + (a.decision ? '<span><b>Decisión sugerida:</b> ' + txt(a.decision) + '</span>' : '') + '</div></article>';
  }
  function tabla(titulo, columnas, filas, vacio) {
    if (!filas || !filas.length) return vacio ? '<section class="ind-tabla"><h3>' + txt(titulo) + '</h3><p class="sx2-tenue">' + txt(vacio) + '</p></section>' : '';
    return '<section class="ind-tabla"><h3>' + txt(titulo) + '</h3><div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr>' +
      columnas.map(function (c) { return '<th' + (c.num ? ' class="sx2-num"' : '') + '>' + txt(c.t) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      filas.slice(0, 25).map(function (f) { return '<tr>' + columnas.map(function (c) { var v = typeof c.v === 'function' ? c.v(f) : f[c.v]; return '<td' + (c.num ? ' class="sx2-num"' : '') + '>' + txt(v) + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div>' + (filas.length > 25 ? '<p class="sx2-tenue">y ' + (filas.length - 25) + ' más.</p>' : '') + '</section>';
  }
  var M = function (v) { return '$' + Number(v || 0).toLocaleString('es-CL'); };
  var DETALLES = [
    ['f29_atrasos_mes', 'F29 declarados después del vencimiento', [{ t: 'Cliente', v: 'cliente' }, { t: 'Declarado', v: 'declarado' }, { t: 'Días hábiles tarde', v: 'dias_habiles_tarde', num: true }, { t: 'Reincidente', v: function (f) { return f.reincidente ? 'Sí' : ''; } }, { t: 'Recordatorio antes', v: function (f) { return f.recordatorio || ''; } }]],
    ['clientes_sin_respuesta', 'Clientes que no respondieron a los recordatorios', [{ t: 'Cliente', v: 'cliente' }]],
    ['f29_reincidentes', 'Clientes que más se atrasan con el F29 (12 meses)', [{ t: 'Cliente', v: 'cliente' }, { t: 'Meses tarde', v: function (f) { return f.meses_tarde + ' de 12'; }, num: true }]],
    ['f29_sin_registro', 'Clientes sin declaración registrada', [{ t: 'Cliente', v: 'cliente' }, { t: 'Situación', v: 'situacion' }, { t: 'Estado de pago', v: 'estado_pago' }]],
    ['contabilizacion_atrasada', 'Contabilidad atrasada (2 meses o más)', [{ t: 'Cliente', v: 'cliente' }, { t: 'Meses sin cerrar', v: 'meses_pendientes', num: true }, { t: 'Desde', v: 'desde' }]],
    ['facturacion_top', 'Clientes con más facturación (12 meses)', [{ t: 'Cliente', v: 'cliente' }, { t: 'Monto', v: function (f) { return M(f.monto); }, num: true }, { t: '%', v: function (f) { return f.participacion + ' %'; }, num: true }]],
    ['convenios_vencidos', 'Clientes con cuotas de convenio vencidas', [{ t: 'Cliente', v: 'cliente' }]],
    ['notificaciones_abiertas', 'Notificaciones del SII abiertas este año', [{ t: 'Cliente', v: 'cliente' }, { t: 'Tipo', v: 'tipo' }, { t: 'Fecha', v: 'fecha' }]],
    ['rle_pendiente', 'Registros ante la DT pendientes', [{ t: 'Registro', v: 'registro' }, { t: 'Pendientes', v: 'pendientes', num: true }, { t: 'Clientes', v: 'clientes', num: true }, { t: 'Desde', v: 'desde' }]],
    ['liquidaciones_por_cliente', 'Clientes con más liquidaciones', [{ t: 'Cliente', v: 'cliente' }, { t: 'Liquidaciones', v: 'liquidaciones', num: true }]],
    ['causales', 'Causales de término (12 meses)', [{ t: 'Causal', v: 'causal' }, { t: 'Finiquitos', v: 'finiquitos', num: true }, { t: '%', v: function (f) { return f.participacion + ' %'; }, num: true }]],
    ['morosos', 'Clientes con facturas vencidas', [{ t: 'Cliente', v: 'cliente' }, { t: 'Saldo vencido', v: function (f) { return M(f.saldo_vencido); }, num: true }, { t: 'Facturas', v: 'facturas', num: true }, { t: 'Días (máx.)', v: 'dias_max', num: true }]],
    ['calidad', 'Calidad del dato', [{ t: 'Matriz', v: 'matriz' }, { t: 'Último mes', v: 'ultimo_mes' }, { t: 'Problema', v: 'problema' }]]
  ];
  function detalle(d) {
    d = d || {};
    return DETALLES.map(function (x) { return tabla(x[1], x[2], d[x[0]]); }).join('');
  }
  /** El bloque completo de un área: alertas primero, indicadores, gráficos y detalle. */
  function bloqueArea(r, opts) {
    opts = opts || {};
    if (!r || !r.con_indicadores) return '';
    var alertas = r.alertas || [];
    var conGraf = (r.kpis || []).filter(function (k) { return (k.serie || []).length >= 2; });
    return '<section class="ind-area">' +
      (alertas.length ? '<h2 class="rp2-sub">Requiere atención</h2><div class="ind-alertas">' + alertas.map(alerta).join('') + '</div>' : '<p class="ind-ok">' + U.ico('check', 16) + ' Sin alertas en el mes.</p>') +
      '<h2 class="rp2-sub">Indicadores del mes</h2><div class="ind-kpis">' + (r.kpis || []).map(tarjeta).join('') + '</div>' +
      (conGraf.length ? '<h2 class="rp2-sub">Tendencia de 12 meses</h2><div class="ind-figs">' + conGraf.map(figura).join('') + '</div>' : '') +
      (opts.sinDetalle ? '' : '<h2 class="rp2-sub">Detalle</h2><div class="ind-detalles">' + detalle(r.detalle) + '</div>') + '</section>';
  }

  window.SigsoIndicadores = { tarjeta: tarjeta, grafico: grafico, figura: figura, alerta: alerta, tabla: tabla, detalle: detalle, bloqueArea: bloqueArea, valor: valor, chip: chip, ESTADO_TXT: ESTADO_TXT };
})();
