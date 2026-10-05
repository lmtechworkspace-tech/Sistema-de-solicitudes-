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
      '<header class="ind-alerta__cab"><strong>' + txt(a.titulo) + '</strong><span class="ind-alerta__cifra">' + txt(a.cifra || '') + '</span>' + (a.area ? '<span class="sx2-tenue">' + txt(a.area) + '</span>' : '') +
        (a.nueva === true ? U.badge('Nueva', 'info', true) : (a.nueva === false ? U.badge('Viene del mes anterior', 'neutro', true) : '')) + '</header>' +
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

  // =========================================================================================
  // El reporte en TRES CAPAS (2026-10-04, auditoría · etapa 2):
  //  1. portada   una pantalla: titular del mes, 4 cifras clave, lo que pide decisión, lo que va bien
  //  2. temas     los indicadores agrupados en pestañas; cada uno abre su detalle al lado
  //  3. anexo     todas las tablas y la calidad del dato, cerrado (completo al imprimir)
  // =========================================================================================
  // Qué tablas respaldan cada indicador (se muestran en su panel, no al final).
  var DET_DE = {
    f29_a_tiempo: ['f29_atrasos_mes'], f29_sin_registro: ['f29_sin_registro'], f29_reincidentes: ['f29_reincidentes'],
    avance_contable: ['contabilizacion_pendiente_mes', 'contabilizacion_atrasada'], atraso_contable: ['contabilizacion_atrasada'],
    facturacion: ['facturacion_top'], concentracion: ['facturacion_top'], convenios_vencidos: ['convenios_vencidos'], notificaciones_sii: ['notificaciones_abiertas'],
    rle_pendiente: ['rle_pendiente'], anexos_pendientes: [], liquidaciones: ['liquidaciones_por_cliente'], salidas_por_entrada: ['causales'],
    cartera_vencida: ['morosos'], clientes_sin_respuesta: ['clientes_sin_respuesta'], dependencia: ['carga_por_persona'],
    tareas_a_tiempo: ['tareas_area'], citas_avisadas: ['citas_clientes']
  };
  var DET_EXTRA = {
    contabilizacion_pendiente_mes: ['Clientes sin cerrar la contabilización del mes', [{ t: 'Cliente', v: 'cliente' }, { t: 'Situación', v: 'situacion' }]],
    tareas_area: ['Fechas del área en el mes', [{ t: 'Tarea', v: 'tarea' }, { t: 'Fecha', v: 'fecha' }, { t: 'Estado', v: 'estado' }, { t: 'Hecha el', v: 'hecho' }]],
    citas_clientes: ['Citas de clientes del mes', [{ t: 'Cita', v: 'cita' }, { t: 'Cliente', v: 'cliente' }, { t: 'Fecha', v: 'fecha' }, { t: 'Avisada', v: 'avisada' }]],
    carga_por_persona: ['Registros por persona (12 meses)', [{ t: 'Persona', v: function (f) { return persona(f.email); } }, { t: 'Registros', v: 'registros', num: true }, { t: '%', v: function (f) { return f.participacion + ' %'; }, num: true }]]
  };
  function persona(e) {
    if (!e) return '—';
    if (/^txt:/.test(e)) return e.slice(4).toLowerCase().replace(/(^|\s)\S/g, function (m) { return m.toUpperCase(); });
    return window.PYv2 && PYv2.persona ? PYv2.persona(e).nombre : e;
  }
  function defTabla(clave) {
    var x = DETALLES.filter(function (d) { return d[0] === clave; })[0];
    return x ? [x[1], x[2]] : DET_EXTRA[clave] || null;
  }
  var REG = {}, nReg = 0;
  function kDe(r, clave) { return (r.kpis || []).filter(function (k) { return k.clave === clave; })[0] || null; }
  /** Diferencia contra el mes anterior, en palabras cortas (↑ 3 pts). */
  function diferencia(k) {
    if (k.preliminar) return 'cifra preliminar';
    if (k.valor === null || k.valor === undefined || k.anterior === null || k.anterior === undefined) return '';
    var d = k.valor - k.anterior;
    if (Math.abs(d) < 1e-9) return '= mes anterior';
    var txtD = k.formato === 'pct' ? n1(Math.abs(d)) + (Math.abs(Math.abs(d) - 1) < 1e-9 ? ' pt' : ' pts') : valor(k, Math.abs(d));
    var bueno = k.sentido === 'menor' ? d < 0 : (k.sentido === 'mayor' ? d > 0 : null);
    return '<span class="ip-dif' + (bueno === true ? ' ip-dif--bien' : (bueno === false ? ' ip-dif--mal' : '')) + '">' + (d > 0 ? '↑ ' : '↓ ') + U.esc(txtD) + '</span> vs mes anterior';
  }
  function portadaDe(r) {
    if (r.portada) return r.portada;
    // Reportes congelados antes de la portada: se arma con lo que hay.
    var g = (r.kpis || []).filter(function (k) { return k.gerencia; }).slice(0, 4).map(function (k) { return k.clave; });
    return { titular: '', cifras: g, decisiones: (r.alertas || []).slice(0, 3).map(function (a) { return a.clave; }), bien: [] };
  }
  function grande(k, id) {
    return '<button type="button" class="ip-cifra ip-cifra--' + U.esc(k.estado) + ' js-ip-ver" data-ind="' + id + '" data-k="' + U.esc(k.clave) + '">' +
      '<span class="ip-cifra__cab"><span class="ip-cifra__nom">' + txt(k.nombre) + '</span>' + chip(k.estado) + '</span>' +
      (k.mide ? '<span class="ip-cifra__mide">' + txt(k.mide) + '</span>' : '') +
      '<span class="ip-cifra__v">' + txt(valor(k, k.valor)) + '</span>' +
      '<span class="ip-cifra__pie">' + (k.meta_texto ? '<span>Meta ' + txt(k.meta_texto) + '</span>' : '') + '<span>' + diferencia(k) + '</span></span>' +
      linea(k.serie || []) + '</button>';
  }
  function portada(r, id) {
    var p = portadaDe(r);
    var cifras = p.cifras.map(function (c) { return kDe(r, c); }).filter(Boolean);
    var alertas = p.decisiones.map(function (c) { return (r.alertas || []).filter(function (a) { return a.clave === c; })[0]; }).filter(Boolean);
    var nCal = ((r.detalle || {}).calidad || []).length;
    return '<section class="ip-portada sx2-entra">' +
      (p.titular ? '<p class="ip-titular">' + txt(p.titular) + '</p>' : '') +
      (cifras.length ? '<div class="ip-cifras">' + cifras.map(function (k) { return grande(k, id); }).join('') + '</div>' : '') +
      '<div class="ip-dos"><div class="ip-bloque"><h3 class="ip-h">Requiere decisión</h3>' +
        (alertas.length ? '<ul class="ip-decs">' + alertas.map(function (a) {
          return '<li class="ip-dec ip-dec--' + U.esc(a.nivel) + '"><div><strong>' + txt(a.titulo) + '</strong><span class="ip-dec__cifra">' + txt(a.breve || a.cifra || '') + '</span>' +
            (a.decision ? '<span class="ip-dec__sug"><b>Sugerido:</b> ' + txt(a.decision) + '</span>' : '') + '</div>' +
            (kDe(r, a.clave) ? '<button type="button" class="sx2-enlace js-ip-ver" data-ind="' + id + '" data-k="' + U.esc(a.clave) + '">Ver por qué' + U.ico('derecha', 14) + '</button>' : '') + '</li>';
        }).join('') + '</ul>' + ((r.alertas || []).length > alertas.length ? '<p class="ip-nota">Y ' + ((r.alertas || []).length - alertas.length) + ' más para vigilar en las pestañas de abajo.</p>' : '')
          : '<p class="ind-ok">' + U.ico('check', 16) + ' Nada que requiera decisión este mes.</p>') + '</div>' +
      '<div class="ip-bloque"><h3 class="ip-h">Va bien</h3>' + (p.bien.length ? '<ul class="ip-bien">' + p.bien.map(function (b) { return '<li>' + U.ico('check', 14) + '<span>' + txt(b) + '</span></li>'; }).join('') + '</ul>' : '<p class="ip-nota">Ningún indicador en meta este mes.</p>') +
        (nCal ? '<h3 class="ip-h">Calidad del dato</h3><p class="ip-nota">' + nCal + (nCal === 1 ? ' punto' : ' puntos') + ' por corregir para que las cifras sean confiables. <button type="button" class="sx2-enlace js-ip-anexo" data-ind="' + id + '">Ver en el anexo</button></p>' : '') +
      '</div></div></section>';
  }
  function mini(k, id) {
    return '<button type="button" class="ip-mini ip-mini--' + U.esc(k.estado) + ' js-ip-ver" data-ind="' + id + '" data-k="' + U.esc(k.clave) + '">' +
      '<span class="ip-mini__cab"><span class="ip-mini__nom">' + txt(k.nombre) + '</span>' + chip(k.estado) + '</span>' +
      '<span class="ip-mini__fila"><span class="ip-mini__v">' + txt(valor(k, k.valor)) + '</span>' + linea(k.serie || []) + '</span>' +
      '<span class="ip-mini__exp">' + txt(k.explicacion || k.nota || '') + '</span><span class="ip-mini__ver">Ver detalle' + U.ico('derecha', 13) + '</span></button>';
  }
  function temas(r, id) {
    var orden = [], por = {};
    (r.kpis || []).forEach(function (k) { var t = k.tema || 'Otros'; if (!por[t]) { por[t] = []; orden.push(t); } por[t].push(k); });
    if (!orden.length) return '';
    var malos = function (t) { return por[t].filter(function (k) { return k.estado === 'alerta' || k.estado === 'critico'; }).length; };
    return '<section class="ip-temas sx2-entra"><h2 class="rp2-sub">Indicadores por tema</h2>' +
      '<div class="ip-tabs" role="tablist">' + orden.map(function (t, i) {
        var m = malos(t);
        return '<button type="button" role="tab" class="ip-tab js-ip-tab" data-ind="' + id + '" data-t="' + i + '" aria-selected="' + (i === 0 ? 'true' : 'false') + '">' + txt(t) +
          '<span class="ip-tab__n' + (m ? ' ip-tab__n--mal' : '') + '">' + (m || por[t].length) + '</span></button>';
      }).join('') + '</div>' +
      orden.map(function (t, i) { return '<div class="ip-panel" role="tabpanel" data-t="' + i + '"' + (i ? ' hidden' : '') + '><h3 class="ip-panel__tit">' + txt(t) + '</h3><div class="ip-minis">' + por[t].map(function (k) { return mini(k, id); }).join('') + '</div></div>'; }).join('') +
      '</section>';
  }
  function anexo(r, id) {
    var d = r.detalle || {};
    var tablas = DETALLES.map(function (x) { return tabla(x[1], x[2], d[x[0]]); }).join('') +
      Object.keys(DET_EXTRA).map(function (c) { return tabla(DET_EXTRA[c][0], DET_EXTRA[c][1], d[c]); }).join('');
    var n = DETALLES.concat(Object.keys(DET_EXTRA).map(function (c) { return [c]; })).filter(function (x) { return (d[x[0]] || []).length; }).length;
    if (!n) return '';
    return '<section class="ip-anexo-sec"><button type="button" class="ip-anexo-btn js-ip-anexo" data-ind="' + id + '" aria-expanded="false">' + U.ico('tabla', 16) +
      '<span><strong>Anexo</strong> · ' + n + (n === 1 ? ' tabla' : ' tablas') + ' con el detalle, incluida la calidad del dato</span>' + U.ico('abajo', 16) + '</button>' +
      '<div class="ip-anexo" hidden><div class="ind-detalles">' + tablas + '</div></div></section>';
  }
  /** El panel lateral de un indicador: su gráfico grande, la comparación, por qué y las tablas que lo respaldan. */
  function panelIndicador(r, k) {
    var a = (r.alertas || []).filter(function (x) { return x.clave === k.clave; })[0];
    var comp = [['Este mes', valor(k, k.valor)], ['Mes anterior', k.anterior == null ? '—' : valor(k, k.anterior)], ['Promedio 12 meses', k.promedio_12 == null ? '—' : valor(k, k.promedio_12)],
      ['Hace un año', k.anio_anterior == null ? '—' : valor(k, k.anio_anterior)], ['Meta', k.meta_texto || '—']];
    var tablas = (DET_DE[k.clave] || []).map(function (c) { var t = defTabla(c); return t ? tablaCompleta(t[0], t[1], (r.detalle || {})[c]) : ''; }).join('');
    var g = grafico(k);
    return '<div class="ip-det">' +
      '<div class="ip-det__v"><span>' + txt(valor(k, k.valor)) + '</span>' + chip(k.estado) + '</div>' +
      '<dl class="ip-comp">' + comp.filter(function (c, i) { return i === 0 || c[1] !== '—'; }).map(function (c) { return '<div><dt>' + txt(c[0]) + '</dt><dd>' + txt(c[1]) + '</dd></div>'; }).join('') + '</dl>' +
      (g ? '<figure class="ind-fig ip-det__fig"><figcaption><strong>Últimos 12 meses</strong>' + (k.preliminar ? '<span>El último mes todavía se registra (punteado).</span>' : '') + '</figcaption>' + g + '</figure>' : '') +
      '<p class="ip-det__exp">' + txt(k.explicacion || k.nota || '') + '</p>' +
      (a ? alerta(a.que_pasa === k.explicacion ? Object.assign({}, a, { que_pasa: '' }) : a) : '') + tablas +
      (k.definicion ? '<p class="ip-det__def"><b>Cómo se calcula:</b> ' + txt(k.definicion) + '</p>' : '') + '</div>';
  }
  function tablaCompleta(titulo, columnas, filas) {
    if (!filas || !filas.length) return '';
    return '<section class="ind-tabla"><h3>' + txt(titulo) + ' <small class="sx2-tenue">(' + filas.length + ')</small></h3><div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr>' +
      columnas.map(function (c) { return '<th' + (c.num ? ' class="sx2-num"' : '') + '>' + txt(c.t) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      filas.slice(0, 200).map(function (f) { return '<tr>' + columnas.map(function (c) { var v = typeof c.v === 'function' ? c.v(f) : f[c.v]; return '<td' + (c.num ? ' class="sx2-num"' : '') + '>' + txt(v) + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div></section>';
  }
  /** El bloque completo de un área, en tres capas. opts.sinPortada: solo temas y anexo. */
  function bloqueArea(r, opts) {
    opts = opts || {};
    if (!r || !r.con_indicadores) return '';
    var id = 'i' + (++nReg);
    REG[id] = r;
    return '<section class="ind-area" data-ind="' + id + '">' + (opts.sinPortada ? '' : portada(r, id)) + temas(r, id) + (opts.sinDetalle ? '' : anexo(r, id)) + '</section>';
  }
  function bloquePortada(r) { if (!r || !r.con_indicadores) return ''; var id = 'i' + (++nReg); REG[id] = r; return '<div data-ind="' + id + '">' + portada(r, id) + '</div>'; }

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('.js-ip-ver, .js-ip-tab, .js-ip-anexo');
    if (!b) return;
    var r = REG[b.getAttribute('data-ind')];
    if (!r) return;
    var raiz = document.querySelector('.ind-area[data-ind="' + b.getAttribute('data-ind') + '"]') || b.closest('[data-ind]');
    if (b.classList.contains('js-ip-tab')) {
      var t = b.getAttribute('data-t'), sec = b.closest('.ip-temas');
      sec.querySelectorAll('.js-ip-tab').forEach(function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
      sec.querySelectorAll('.ip-panel').forEach(function (p) { p.hidden = p.getAttribute('data-t') !== t; });
      return;
    }
    if (b.classList.contains('js-ip-anexo')) {
      var ax = (raiz && raiz.querySelector('.ip-anexo')) || (b.closest('.rp2-documento, .ci2') || document).querySelector('.ip-anexo');
      if (!ax) return;
      var btn = ax.parentNode.querySelector('.ip-anexo-btn');
      if (b === btn) { ax.hidden = !ax.hidden; btn.setAttribute('aria-expanded', ax.hidden ? 'false' : 'true'); }
      else { ax.hidden = false; if (btn) btn.setAttribute('aria-expanded', 'true'); ax.scrollIntoView({ behavior: U.reducirMovimiento() ? 'auto' : 'smooth', block: 'start' }); }
      return;
    }
    var k = kDe(r, b.getAttribute('data-k'));
    if (!k) return;
    var d = U.drawer({ titulo: k.nombre, subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + txt([k.tema, k.mide, r.nombre].filter(Boolean).join(' · ')) + '</span>', cuerpo: panelIndicador(r, k) });
    d.el.classList.add('sx2-drawer--ancho');
  });

  // =========================================================================================
  // EXCEL POR TEMA (2026-10-05): Resumen (la portada), una hoja por tema con sus
  // indicadores, «Tendencias 12 meses» en formato largo (sirve para tablas dinámicas),
  // una hoja por cada tabla de detalle y «Calidad del dato». Los valores van como
  // números (no como texto formateado) para poder calcular con ellos.
  // =========================================================================================
  // Nombres cortos de hoja (Excel corta en 31 caracteres).
  var HOJA_CORTA = { f29_atrasos_mes: 'F29 fuera de plazo', f29_reincidentes: 'Reincidentes en el F29', f29_sin_registro: 'Sin F29 registrado', contabilizacion_atrasada: 'Contabilidad atrasada',
    facturacion_top: 'Mayores clientes', convenios_vencidos: 'Convenios vencidos', notificaciones_abiertas: 'Notificaciones SII', contabilizacion_pendiente_mes: 'Sin cerrar este mes',
    carga_por_persona: 'Registros por persona', rle_pendiente: 'RLE pendiente', liquidaciones_por_cliente: 'Liquidaciones por cliente', causales: 'Causales de término',
    morosos: 'Facturas vencidas', clientes_sin_respuesta: 'Clientes sin respuesta', tareas_area: 'Fechas del área', citas_clientes: 'Citas de clientes' };
  var MES_LARGO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function mesAnio(p) { var m = /^(\d{4})-M(\d{2})$/.exec(p || ''); return m ? MES_LARGO[+m[2] - 1] + ' ' + m[1] : String(p || ''); }
  function unidadDe(k) { return k.formato === 'pct' ? '%' : (k.formato === 'monto' ? '$' : (k.formato === 'ratio' ? 'veces' : (k.unidad || ''))); }
  function num(v) { return v === null || v === undefined || v === '' || !isFinite(Number(v)) ? '' : Number(v); }
  var TONO_X = { ok: 'ok', alerta: 'alerta', critico: 'critico', info: 'info', en_curso: 'neutro', sin_dato: 'neutro' };
  function estadoCelda(k) { return { v: ESTADO_TXT[k.estado] || k.estado || '', tono: TONO_X[k.estado] || 'neutro' }; }
  function textoCelda(c, f) { var v = typeof c.v === 'function' ? c.v(f) : f[c.v]; return v === null || v === undefined ? '' : (typeof v === 'number' ? v : String(v)); }
  /**
   * r: el bloque de indicadores del área. o: { titulo, subtitulo, meta: [[k, v]], hojasExtra: [{ nombre, columnas, filas }] }
   * Devuelve la especificación para SigsoReportes.descargarExcelDeDatos.
   */
  function excel(r, o) {
    o = o || {};
    var p = portadaDe(r), kpis = r.kpis || [], d = r.detalle || {};
    var cifras = p.cifras.map(function (c) { return kDe(r, c); }).filter(Boolean);
    var resumen = {
      estado: r.semaforo === 'critico' ? 'critico' : (r.semaforo === 'alerta' ? 'alerta' : 'ok'), frase: p.titular || '',
      kpis: cifras.map(function (k) { return { etiqueta: k.nombre, valor: valor(k, k.valor), nota: [ESTADO_TXT[k.estado], k.mide].filter(Boolean).join(' · ') }; }),
      alertas: (r.alertas || []).map(function (a) { return { severidad: a.nivel === 'critico' ? 'critico' : 'alerta', cantidad: a.breve || a.cifra || '', titulo: a.titulo,
        detalle: [a.que_pasa, a.por_que ? 'Por qué: ' + a.por_que : '', a.impacto ? 'Impacto: ' + a.impacto : '', a.decision ? 'Decisión sugerida: ' + a.decision : ''].filter(Boolean).join(' '), dueno: a.area || '' }; }),
      bien: p.bien || []
    };
    var hojas = [];
    // Una hoja por tema, en el orden del reporte.
    var orden = [], por = {};
    kpis.forEach(function (k) { var t = k.tema || 'Otros'; if (!por[t]) { por[t] = []; orden.push(t); } por[t].push(k); });
    orden.forEach(function (t) {
      hojas.push({ nombre: t, columnas: ['Indicador', 'Qué mide', 'Valor', 'Unidad', 'Estado', 'Meta', 'Mes anterior', 'Promedio 12 meses', 'Explicación', 'Cómo se calcula'],
        filas: por[t].map(function (k) { return [k.nombre, k.mide || '', num(k.valor), unidadDe(k), estadoCelda(k), k.meta_texto || '', num(k.anterior), num(k.promedio_12), k.explicacion || k.nota || '', k.definicion || '']; }) });
    });
    // Tendencias en formato largo.
    var tend = [];
    kpis.forEach(function (k) { (k.serie || []).forEach(function (x, i, arr) { if (x.valor === null || x.valor === undefined) return; tend.push([k.tema || 'Otros', k.nombre, mesAnio(x.periodo), num(x.valor), unidadDe(k), k.preliminar && i === arr.length - 1 ? 'Preliminar' : '']); }); });
    if (tend.length) hojas.push({ nombre: 'Tendencias 12 meses', columnas: ['Tema', 'Indicador', 'Mes', 'Valor', 'Unidad', 'Nota'], filas: tend });
    // Las tablas de detalle, cada una en su hoja (completas, sin el tope de pantalla).
    var tablas = DETALLES.map(function (x) { return { clave: x[0], titulo: x[1], cols: x[2] }; })
      .concat(Object.keys(DET_EXTRA).map(function (c) { return { clave: c, titulo: DET_EXTRA[c][0], cols: DET_EXTRA[c][1] }; }))
      .filter(function (t) { return t.clave !== 'calidad' && (d[t.clave] || []).length; });
    var cupo = 20 - 1 - hojas.length - (o.hojasExtra || []).length - ((d.calidad || []).length ? 1 : 0);
    tablas.slice(0, Math.max(0, cupo)).forEach(function (t) {
      hojas.push({ nombre: HOJA_CORTA[t.clave] || t.titulo, columnas: t.cols.map(function (c) { return c.t; }), filas: d[t.clave].map(function (fl) { return t.cols.map(function (c) { return textoCelda(c, fl); }); }) });
    });
    if ((d.calidad || []).length) hojas.push({ nombre: 'Calidad del dato', columnas: ['Dónde', 'Último mes', 'Qué hay que corregir'], filas: d.calidad.map(function (x) { return [x.area ? x.area + ' · ' + x.matriz : x.matriz, x.ultimo_mes || '', x.problema]; }) });
    return { titulo: o.titulo || ('Indicadores · ' + (r.nombre || '')), subtitulo: o.subtitulo || '', meta: o.meta || [['Mes', r.periodo_texto || '']], resumen: resumen, hojas: (o.hojasExtra || []).concat(hojas) };
  }

  window.SigsoIndicadores = { excel: excel, tarjeta: tarjeta, grafico: grafico, figura: figura, alerta: alerta, tabla: tabla, detalle: detalle, bloqueArea: bloqueArea, bloquePortada: bloquePortada, portada: portada, valor: valor, chip: chip, ESTADO_TXT: ESTADO_TXT };
})();
