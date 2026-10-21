/**
 * finanzas-informes-v2.js — Informes de Finanzas (2026-10-20; FIN-34 a
 * FIN-40; backend/logica/finanzasReportes.js y finanzasExportar.js).
 *
 * Todo sale del CONTRATO del reporte que arma el servidor: alcance, mes,
 * corte, base (caja bruta o documental neta), calidad del dato, revisión de
 * datos, métricas, comparaciones, series (los meses sin datos son huecos, no
 * ceros), desgloses y comentarios automáticos. La pantalla no recalcula
 * nada: muestra, compara y lleva a la evidencia.
 *
 *  - Cada comentario dice qué regla lo generó, su evidencia y sus límites, y
 *    ofrece «Cómo se calculó», «Ver qué cambió» y «Revisar pendientes».
 *  - El PDF lo arma el servidor desde el mismo contrato: si los datos
 *    cambiaron desde que se abrió la pantalla, pide recargar.
 *  - Exportar: CSV/XLSX con metadatos (filtros, corte, base, estado, revisión).
 *
 * 2026-10-20 (I09): lectura con los 3–4 hallazgos principales (el resto a un
 * clic); cada botón solo si tiene contenido; regla y versión en el detalle;
 * portafolio de informes (cascada, cuentas y caja, antigüedad de cobranza,
 * empresas con su cuadre, servicios/canales/vendedores con cobertura).
 */
(function () {
  'use strict';

  var U = UIv2;
  var x_ = null;
  var est_ = { periodo: '', empresa: '', base: 'CASH_GROSS', comparacion: 'PREVIOUS_PERIOD', c: null };
  // I12.2/I12.4: al cerrarse la bóveda, la pantalla olvida las cifras que tenía cargadas.
  document.addEventListener('sigso-fin-cerrada', function () { est_.c = null; });
  var ESTADO = { COMPLETO: ['Completo', 'ok'], PROVISIONAL: ['Provisorio', 'alerta'], INCOMPLETO: ['Incompleto', 'critico'] };
  // «Favorable» solo sale de reglas que calificaron con datos comparables (I09.4); no es una etiqueta genérica.
  var SEV = { critico: ['Crítico', 'critico', 'alerta'], alerta: ['Atención', 'alerta', 'alerta'], info: ['Para saber', 'info', 'info'], ok: ['Favorable', 'ok', 'check'] };
  var ACCION_TXT = { COMO_SE_CALCULO: 'Cómo se calculó', VER_QUE_CAMBIO: 'Ver qué cambió', REVISAR_PENDIENTES: 'Revisar pendientes' };
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function plata(n) { if (n === null || n === undefined) return 'Por determinar'; var v = Math.round(Number(n) || 0); return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('es-CL'); }
  function corto(n) { var a = Math.abs(Number(n) || 0), s = n < 0 ? '−' : ''; return a >= 1e6 ? s + '$' + (a / 1e6).toFixed(1).replace('.', ',') + ' M' : a >= 1e3 ? s + '$' + Math.round(a / 1e3) + ' mil' : s + '$' + Math.round(a); }
  function mesLargo(p) { var a = String(p || '').split('-'); return a.length === 2 ? MESES[Number(a[1]) - 1] + ' ' + a[0] : p; }
  function mesCorto(p) { var a = String(p || '').split('-'); return a.length === 2 ? MESES[Number(a[1]) - 1].slice(0, 3) + ' ' + a[0].slice(2) : p; }
  function descargar(b64, nombre, mime) {
    var bin = atob(b64), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    var url = URL.createObjectURL(new Blob([u], { type: mime }));
    var a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  // =====================================================================================
  function ver(x) {
    x_ = x; enlazar();
    var c = x.contexto();
    est_.periodo = c.periodo_informe || est_.periodo || '';
    est_.empresa = c.empresa_informe !== undefined ? c.empresa_informe : est_.empresa;
    est_.base = c.base || est_.base;
    est_.comparacion = c.comparacion || est_.comparacion;
    var t = x.turno();
    x.pagina(x.cab('tablero') + U.esqueleto('kpis', 4) + U.esqueleto('tarjetas', 3));
    x.api('finanzasReporte', { periodo: est_.periodo, empresa: est_.empresa, base: est_.base, comparacion: est_.comparacion }).then(function (r) {
      if (!x.vigente(t)) return;
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('tablero') + U.card({ cuerpo: U.vacio({ accion: '<button type="button" class="sx2-boton sx2-boton--secundario sx2-boton--sm js-fin-reintentar">Reintentar</button>', icono: 'alerta', titulo: 'No se pudo armar el informe', texto: (r && r.message) || '' }) })); return; }
      est_.c = r.data; est_.periodo = r.data.period;
      pintar();
    });
  }

  function controles(c) {
    var periodos = c.periodos && c.periodos.length ? c.periodos : [c.period];
    if (periodos.indexOf(c.period) === -1) periodos = [c.period].concat(periodos);
    return '<div class="fin2-ctx sx2-entra" role="group" aria-label="Qué informe ver">' +
      '<label class="fin2-campo fin2-campo--fila"><span>Mes</span><select class="fin2-input fin2-input--sm js-fini-mes">' + periodos.map(function (p) { return '<option value="' + txt(p) + '"' + (p === c.period ? ' selected' : '') + '>' + txt(mesLargo(p)) + '</option>'; }).join('') + '</select></label>' +
      '<label class="fin2-campo fin2-campo--fila"><span>Alcance</span><select class="fin2-input fin2-input--sm js-fini-emp"><option value="">Grupo (todas)</option>' + (c.scope.empresas || []).map(function (e) { return '<option' + (e === c.scope.empresa ? ' selected' : '') + '>' + txt(e) + '</option>'; }).join('') + '</select></label>' +
      '<span class="fin2-campo fin2-campo--fila"><span>Base</span>' + U.segmento(Object.keys(c.bases).map(function (k) { return { id: k, texto: c.bases[k] }; }), c.basis, 'js-fini-base') + '</span>' +
      '<label class="fin2-campo fin2-campo--fila"><span>Comparar con</span><select class="fin2-input fin2-input--sm js-fini-cmp">' + Object.keys(c.comparadores).map(function (k) { return '<option value="' + k + '"' + (k === c.comparison.type ? ' selected' : '') + '>' + txt(c.comparadores[k]) + '</option>'; }).join('') + '</select></label>' +
    '</div>';
  }
  function calidad(c) {
    var q = c.quality, e = ESTADO[q.status] || ['—', 'neutro'];
    return '<div class="fin2-cinta fin2-cinta--' + (q.status === 'COMPLETO' ? 'ok' : q.status === 'INCOMPLETO' ? 'critico' : 'alerta') + ' sx2-entra">' + U.ico(q.status === 'COMPLETO' ? 'escudoCheck' : 'alerta', 18) +
      '<div><b>Datos ' + txt({ COMPLETO: 'completos', PROVISIONAL: 'provisorios', INCOMPLETO: 'incompletos' }[q.status] || e[0].toLowerCase()) + (q.cerrado ? ' · mes cerrado' : '') + '</b> · corte ' + txt(c.as_of) + ' · ' + txt(c.bases[c.basis]) + ' · ' + txt(c.scope.alcance) +
      (q.reasons.length ? '<ul class="fin2-razones">' + q.reasons.map(function (r) { return '<li>' + txt(r.texto) + (r.evidencia && r.evidencia.vista ? ' <button type="button" class="sx2-enlace js-fini-ir" data-vista="' + txt(r.evidencia.vista) + '" data-filtros="' + txt(JSON.stringify(r.evidencia.filtros || {})) + '">Ir</button>' : '') + '</li>'; }).join('') + '</ul>' : '') +
      '<small class="fin2-ayuda">Revisión de datos ' + txt(c.data_revision) + '</small></div></div>';
  }
  function cmpDe(c, k) { var x = c.comparisons[k]; return x ? x[c.comparison.type] || null : null; }
  function tendencia(cmp, invertir) {
    if (!cmp) return null;
    if (cmp.estado !== 'COMPARABLE') return { texto: cmp.texto, tono: 'neutro' };
    // I03.4: sin comparabilidad o con datos provisorios se muestra la diferencia, sin color de «mejor/peor».
    if (cmp.evaluable === false) return { texto: cmp.texto + ' · sin calificar', tono: 'neutro', icono: cmp.diferencia >= 0 ? 'tendencia' : 'tendenciaBaja' };
    var bueno = invertir ? cmp.diferencia <= 0 : cmp.diferencia >= 0;
    return { texto: cmp.texto, tono: cmp.diferencia === 0 ? 'neutro' : bueno ? 'ok' : 'critico', icono: cmp.diferencia >= 0 ? 'tendencia' : 'tendenciaBaja' };
  }
  function kpis(c) {
    var m = c.metrics, d = c.definiciones;
    var l = [];
    if (c.basis === 'DOCUMENT_NET') l.push({ k: 'ventas_netas', v: m.ventas_netas, icono: 'recibo' });
    else l.push({ k: 'ingresos', v: m.ingresos, icono: 'tendencia' }, { k: 'egresos', v: m.egresos, icono: 'tendenciaBaja', inv: true }, { k: 'flujo_propio', v: m.flujo_propio, icono: 'dinero' });
    // I03.1: tres cifras distintas, cada una con su estado según la evaluación común.
    var ev = c.evaluacion || {};
    var nota = function (k, extra) { var e = ev[k]; if (!e) return extra || ''; return e.status === 'NOT_DETERMINABLE' ? 'No determinable' : e.status === 'PROVISIONAL' ? 'Provisoria' + (extra ? ' · ' + extra : '') : extra || ''; };
    var ref = ev.caja_libre && ev.caja_libre.referencial;
    var ultimaCartola = ((ev.caja && ev.caja.cuentas) || []).reduce(function (a, k) { return k.al > a ? k.al : a; }, '');
    l.push({ k: 'caja', v: m.caja, icono: 'caja', sinCmp: true, nota: nota('caja', ultimaCartola && ultimaCartola !== c.as_of ? 'última cartola al ' + ultimaCartola.slice(8) + '-' + ultimaCartola.slice(5, 7) : '') },
      { k: 'custodia', v: m.custodia_positiva, icono: 'escudo', sinCmp: true, nota: nota('custodia', m.custodia_deficit ? 'déficit aparte: ' + plata(m.custodia_deficit) : '') },
      { k: 'caja_libre', v: m.caja_libre, icono: 'llave', sinCmp: true, nota: nota('caja_libre') + (ref ? ' (referencia ' + corto(ref.monto) + ', no acreditada)' : '') });
    // I08.8: dos zonas: lo que pasó en el mes (cobros, pagos, flujo) y la liquidez al corte (saldo, fondos ajenos, disponibilidad).
    var tarjeta = function (o, i) {
      var cmp = o.sinCmp ? null : cmpDe(c, o.k);
      var tend = tendencia(cmp, o.inv);
      if (!tend && o.nota) tend = { texto: o.nota, tono: 'neutro' };
      if (!tend && (o.v === null || o.v === undefined)) tend = { texto: 'Por determinar', tono: 'neutro' };
      return U.kpi({ etiqueta: (d[o.k] || {}).nombre || o.k, valor: o.v === null || o.v === undefined ? '—' : plata(o.v), icono: o.icono, tendencia: tend, i: i, filtro: o.k, titulo: ((d[o.k] || {}).formula || '') + ' Clic: cómo se calculó.' });
    };
    var nFlujo = l.length - 3;
    return '<section class="fin2-zona" aria-label="Flujo del mes"><h2 class="fin2-zona__t">Flujo del mes</h2><div class="sx2-fila-kpis fin2-kpis fin2-kpis--3">' + l.slice(0, nFlujo).map(tarjeta).join('') + '</div></section>' +
      '<section class="fin2-zona" aria-label="Liquidez al corte"><h2 class="fin2-zona__t">Liquidez al ' + txt(c.as_of.slice(8) + '-' + c.as_of.slice(5, 7)) + '</h2><div class="sx2-fila-kpis fin2-kpis fin2-kpis--3">' + l.slice(nFlujo).map(function (o, i) { return tarjeta(o, i + nFlujo); }).join('') + '</div></section>';
  }
  /** I01: lo registrado que podría ser el mismo dinero que el banco no está sumado; se muestra aparte. */
  function pendienteIdentidad(c) {
    var p = c.metrics.pendiente_identidad;
    if (!p || !p.monto) return '';
    return '<div class="fin2-cinta fin2-cinta--critico">' + U.ico('alerta', 16) + '<span><b>Aparte, sin sumar: ' + plata(p.monto) + '</b> en ' + p.cantidad + ' operación(es) registrada(s) que podrían ser el mismo dinero que un movimiento del banco ya clasificado. Las cifras de arriba cuentan el banco.</span>' +
      '<button type="button" class="sx2-enlace js-fini-ir" data-vista="conciliacion" data-filtros="{}">Resolver en Conciliación</button></div>';
  }
  function insights(c) {
    if (!c.insights.length) return '';
    var prin = [], otros = [];
    c.insights.forEach(function (i, n) { (i.principal ? prin : otros).push(n); });
    return U.card({ titulo: 'Lectura del mes', icono: 'bombilla', sub: 'lo que cambia la interpretación primero; no atribuye causas', cuerpo: '<ul class="fin2-ins">' + prin.map(function (n) { return insightLi(c, n); }).join('') + '</ul>' +
      (otros.length ? '<details class="fin2-ins-otros"><summary>Ver los otros ' + otros.length + ' hallazgos</summary><ul class="fin2-ins">' + otros.map(function (n) { return insightLi(c, n); }).join('') + '</ul></details>' : '') });
  }
  // «Revisar pendientes» solo cuando lleva a pendientes; si no, dice adónde lleva.
  function etiquetaAccion(i, a) { return a === 'REVISAR_PENDIENTES' && i.rule_id !== 'DATOS_INCOMPLETOS' && i.hechos && i.hechos.revisar ? 'Ir a ' + i.hechos.revisar : ACCION_TXT[a] || a; }
  function insightLi(c, n) {
    var i = c.insights[n];
    {
      var s = SEV[i.severidad] || SEV.info;
      return '<li class="fin2-ins__item sx2-tono-' + s[1] + '"><span class="fin2-ins__ico">' + U.ico(s[2], 16) + '</span><div>' +
        '<p class="fin2-ins__txt">' + txt(i.texto) + '</p>' +
        (i.contribuciones && i.contribuciones.length ? '<p class="fin2-ins__contrib">' + i.contribuciones.slice(0, 4).map(function (k) { return '<span>' + txt(k.nombre) + ' ' + (k.diferencia !== undefined ? (k.diferencia >= 0 ? '+' : '') + plata(k.diferencia) : plata(k.monto)) + (k.dias ? ' · ' + k.dias + ' días' : '') + '</span>'; }).join('') + '</p>' : '') +
        (i.limites ? '<p class="fin2-ins__lim">' + txt(i.limites) + '</p>' : '') +
        '<div class="fin2-ins__acc">' + U.badge(s[0], s[1]) + (i.acciones || []).map(function (a) { return '<button type="button" class="sx2-enlace js-fini-acc" data-n="' + n + '" data-a="' + a + '">' + txt(etiquetaAccion(i, a)) + '</button>'; }).join('') + '</div></div></li>';
    }
  }
  /** Barras de los últimos meses: los meses sin datos se ven como hueco rotulado (FIN-37). */
  function grafico(c) {
    var s = c.series || [];
    if (!s.length) return '';
    var dos = c.basis === 'CASH_GROSS';
    var k1 = dos ? 'ingresos' : 'ventas_netas', k2 = dos ? 'egresos' : null, kp = 'ppto_ingresos';
    var vals = []; s.forEach(function (p) { [p[k1], k2 ? p[k2] : null, p[kp]].forEach(function (v) { if (v !== null && v !== undefined) vals.push(Math.abs(v)); }); });
    var mx = Math.max.apply(null, [1].concat(vals));
    var W = 720, H = 220, base = H - 34, bw = W / s.length, w = Math.max(4, Math.min(20, (bw - 12) / (k2 ? 2 : 1)));
    var y = function (v) { return 12 + (base - 12) * (1 - Math.max(0, v) / mx); };
    var svg = '<svg class="fin2-graf" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + txt(dos ? 'Cobros y pagos propios por mes' : 'Ventas netas por mes') + '">';
    s.forEach(function (p, i) {
      var x0 = i * bw + bw / 2;
      if (p.sin_datos) svg += '<rect x="' + (x0 - bw / 2 + 4) + '" y="12" width="' + (bw - 8) + '" height="' + (base - 12) + '" class="fin2-graf__hueco"/><text x="' + x0 + '" y="' + (base - 8) + '" class="fin2-graf__sin">sin datos</text>';
      else {
        var v1 = p[k1] || 0;
        svg += '<rect x="' + (k2 ? x0 - w - 1 : x0 - w / 2) + '" y="' + y(v1) + '" width="' + w + '" height="' + (base - y(v1)) + '" rx="2" class="fin2-graf__a"><title>' + txt(mesLargo(p.periodo) + ': ' + plata(v1)) + '</title></rect>';
        if (k2) { var v2 = p[k2] || 0; svg += '<rect x="' + (x0 + 1) + '" y="' + y(v2) + '" width="' + w + '" height="' + (base - y(v2)) + '" rx="2" class="fin2-graf__b"><title>' + txt(mesLargo(p.periodo) + ': ' + plata(v2)) + '</title></rect>'; }
      }
      if (p[kp] !== null && p[kp] !== undefined) svg += '<line x1="' + (x0 - bw / 2 + 6) + '" x2="' + (x0 + bw / 2 - 6) + '" y1="' + y(p[kp]) + '" y2="' + y(p[kp]) + '" class="fin2-graf__ppto"><title>Presupuesto ' + txt(plata(p[kp])) + '</title></line>';
      var enCurso = p.periodo === c.as_of.slice(0, 7);
      svg += '<text x="' + x0 + '" y="' + (H - 12) + '" class="fin2-graf__eje' + (p.periodo === c.period ? ' fin2-graf__eje--act' : '') + '">' + txt(mesCorto(p.periodo)) + '</text>';
      if (enCurso && !p.sin_datos) svg += '<text x="' + x0 + '" y="' + (H - 1) + '" class="fin2-graf__curso">en curso</text>';
    });
    svg += '<text x="4" y="' + (y(mx) + 10) + '" class="fin2-graf__escala">' + txt(corto(mx)) + '</text><text x="4" y="' + (base - 3) + '" class="fin2-graf__escala">$0</text>';
    svg += '<line x1="0" x2="' + W + '" y1="' + base + '" y2="' + base + '" class="fin2-graf__base"/></svg>';
    return U.card({ titulo: dos ? 'Cobros y pagos propios' : 'Ventas netas facturadas', icono: 'grafico', sub: 'últimos meses', cuerpo: svg +
      '<p class="fin2-leyenda"><span class="fin2-leyenda__a"></span>' + (dos ? 'Cobros propios' : 'Ventas netas') + (k2 ? '<span class="fin2-leyenda__b"></span>Pagos propios' : '') + '<span class="fin2-leyenda__p"></span>Presupuesto aprobado de ' + (dos ? 'cobros' : 'ventas') + ' (misma base)<span class="fin2-leyenda__h"></span>Mes sin datos (no es cero)</p>' +
      '<details class="fin2-tabla-equiv"><summary>Ver como tabla</summary><div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>Mes</th><th class="fin2-der">' + (dos ? 'Cobros propios' : 'Ventas netas') + '</th>' + (k2 ? '<th class="fin2-der">Pagos propios</th><th class="fin2-der">Flujo propio</th>' : '') + '<th class="fin2-der">Presupuesto de ' + (dos ? 'cobros' : 'ventas') + '</th></tr></thead><tbody>' +
      s.map(function (p) { return '<tr><td>' + txt(mesLargo(p.periodo)) + (p.periodo === c.as_of.slice(0, 7) ? ' (en curso)' : '') + '</td>' + (p.sin_datos ? '<td colspan="' + (k2 ? 3 : 1) + '" class="fin2-ayuda">sin datos (no es cero)</td>' : '<td class="fin2-der fin2-num">' + plata(p[k1]) + '</td>' + (k2 ? '<td class="fin2-der fin2-num">' + plata(p[k2]) + '</td><td class="fin2-der fin2-num">' + plata(p.flujo_propio) + '</td>' : '')) + '<td class="fin2-der fin2-num">' + (p[kp] === null || p[kp] === undefined ? '—' : plata(p[kp])) + '</td></tr>'; }).join('') + '</tbody></table></div></details>' });
  }
  function comparaciones(c) {
    var ks = Object.keys(c.comparisons);
    return U.card({ titulo: 'Comparaciones', icono: 'tabla', sub: 'cada una con su base', cuerpo: '<div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>Indicador</th><th class="fin2-der">' + txt(mesLargo(c.period)) + '</th>' +
      Object.keys(c.comparadores).map(function (k) { return '<th>' + txt(c.comparadores[k]) + '</th>'; }).join('') + '</tr></thead><tbody>' + ks.map(function (k) {
        var cmp = c.comparisons[k];
        return '<tr><td>' + txt((c.definiciones[k] || {}).nombre || k) + '</td><td class="fin2-der fin2-num">' + plata(c.metrics[k]) + '</td>' + Object.keys(c.comparadores).map(function (t) {
          var x = cmp[t];
          if (!x) return '<td class="fin2-ayuda">—</td>';
          return '<td class="' + (x.estado === 'COMPARABLE' ? '' : 'fin2-ayuda') + '">' + (x.base !== null && x.base !== undefined ? '<span class="fin2-num">' + plata(x.base) + '</span> · ' : '') + txt(x.texto) + (x.ejecucion_pct !== null && x.ejecucion_pct !== undefined ? ' · ' + String(x.ejecucion_pct).replace('.', ',') + ' %' : '') + (x.advertencia && x.advertencia.replace(/.$/, '') !== String(x.texto).replace(/.$/, '') ? '<br><small>' + txt(x.advertencia) + '</small>' : '') + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>' });
  }
  /** I09.2 · Qué informe responde qué pregunta y dónde está (en esta página o en su pantalla). */
  var PORTAFOLIO = [
    ['Resumen mensual', 'Qué ocurrió y qué se puede interpretar', '#fin-inf-lectura'], ['Comparación', 'Qué cambió frente a una base válida', '#fin-inf-cmp'],
    ['Cascada de flujo', 'Cómo se llega al flujo propio', '#fin-inf-cascada'], ['Presupuesto', 'Cómo va la ejecución', 'presupuesto'],
    ['Cuentas y caja', 'Cuánto muestra cada cuenta y a qué fecha', '#fin-inf-cuentas'], ['Fondos de clientes', 'Cuánto se administra y para qué', 'fondos'],
    ['Cobranza', 'Qué se debe y qué falta aplicar', '#fin-inf-cobranza'], ['Empresas', 'Cómo se reparte el grupo', '#fin-inf-empresas'],
    ['Préstamos y gastos compartidos', 'Qué relaciones internas siguen abiertas', 'prestamos'], ['Obligaciones y proyección', 'Qué viene y con qué supuestos', 'proyeccion'],
    ['Proyectos', 'Inversión, recuperación e ingresos atribuidos', 'proyectos'], ['Servicios, canales y vendedores', 'Cómo se reparte la actividad, con su cobertura', '#fin-inf-comercial']];
  function portafolio() {
    return U.card({ titulo: 'Informes', icono: 'lista', sub: 'cada uno responde una pregunta', cuerpo: '<ul class="fin2-portafolio">' + PORTAFOLIO.map(function (p) {
      return '<li><button type="button" class="fin2-portafolio__item js-fini-port" data-d="' + txt(p[2]) + '"><b>' + txt(p[0]) + '</b><small>' + txt(p[1]) + '</small><span class="fin2-ayuda">' + (p[2].charAt(0) === '#' ? 'en esta página' : 'abre su pantalla') + '</span></button></li>';
    }).join('') + '</ul>' });
  }
  function cascada(c) {
    var k = c.breakdowns.cascada;
    if (!k || !k.pasos.length) return '';
    var mx = Math.max.apply(null, [1].concat(k.pasos.map(function (x) { return x.monto; })));
    return '<div id="fin-inf-cascada">' + U.card({ titulo: 'Cascada del flujo propio', icono: 'grafico', sub: 'de los cobros y pagos por concepto al flujo; lo ajeno y lo interno, aparte', cuerpo:
      '<div class="fin2-tabla-envoltura"><table class="fin2-tabla fin2-cascada"><thead><tr><th>Concepto</th><th class="fin2-der">Aporte al flujo</th><th class="fin2-cascada__col" aria-hidden="true"></th><th></th></tr></thead><tbody>' +
      k.pasos.map(function (x) {
        return '<tr><td>' + txt(x.concepto) + ' <small class="fin2-ayuda">' + (x.signo > 0 ? 'cobro' : 'pago') + '</small></td><td class="fin2-der fin2-num ' + (x.signo > 0 ? 'fin2-pos' : 'fin2-neg') + '">' + plata(x.signo * x.monto) + '</td>' +
          '<td class="fin2-cascada__col" aria-hidden="true"><span class="fin2-cascada__barra fin2-cascada__barra--' + (x.signo > 0 ? 'a' : 'b') + '" style="width:' + Math.max(2, Math.round(x.monto / mx * 100)) + '%"></span></td>' +
          '<td><button type="button" class="sx2-enlace js-fini-det" data-metric="' + (x.signo > 0 ? 'ingresos' : 'egresos') + '" data-concepto="' + txt(x.concepto) + '">Ver</button></td></tr>';
      }).join('') + '<tr class="fin2-cascada__tot"><td>Flujo propio</td><td class="fin2-der fin2-num">' + plata(k.total) + '</td><td></td><td></td></tr></tbody></table></div>' +
      '<p class="fin2-ayuda">' + (k.cuadra ? U.ico('check', 12) + ' La suma de los conceptos cuadra con el flujo propio.' : '<b>La suma no cuadra con el flujo propio (' + plata(k.flujo_propio) + ').</b>') +
        (k.fuera.length ? ' Fuera del flujo propio: ' + k.fuera.map(function (x) { return txt(x.nombre) + ' ' + plata(x.monto); }).join(' · ') + '.' : '') + '</p>' }) + '</div>';
  }
  function cuentasCaja(c) {
    var l = c.breakdowns.cuentas_periodo || [];
    if (!l.length) return '';
    return '<div id="fin-inf-cuentas">' + U.card({ titulo: 'Cuentas y caja', icono: 'caja', sub: mesLargo(c.period) + ' · saldos por fecha del banco', accion: { texto: 'Ver cuentas', clase: 'js-fini-ir', datos: { vista: 'bancos' } }, cuerpo:
      '<div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>Cuenta</th><th class="fin2-der">Apertura</th><th class="fin2-der">Entradas</th><th class="fin2-der">Salidas</th><th class="fin2-der">Cierre</th><th>Cobertura</th><th class="fin2-der">Diferencia</th></tr></thead><tbody>' +
      l.map(function (x) {
        return '<tr><td>' + txt(x.cuenta) + '<span class="fin2-motivo">' + txt(x.empresa) + '</span></td><td class="fin2-der fin2-num">' + plata(x.apertura) + '</td><td class="fin2-der fin2-num">' + plata(x.entradas) + '</td><td class="fin2-der fin2-num">' + plata(x.salidas) + '</td>' +
          '<td class="fin2-der fin2-num">' + plata(x.cierre) + (x.al ? '<span class="fin2-motivo">al ' + txt(x.al) + '</span>' : '') + '</td><td>' + (x.completa ? U.badge('Completa', 'ok') : U.badge('Hasta ' + (x.cubierta_hasta || '—'), 'alerta')) + '</td>' +
          '<td class="fin2-der fin2-num">' + (x.diferencia === null ? '<span class="fin2-ayuda">' + txt(x.nota || '—') + '</span>' : x.diferencia === 0 ? '$0' : '<b class="fin2-neg">' + plata(x.diferencia) + '</b>') + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="fin2-ayuda">Apertura + entradas − salidas − cierre. Una diferencia distinta de cero indica movimientos que faltan o una cartola parcial.</p>' }) + '</div>';
  }
  function empresas(c) {
    var l = (c.breakdowns.por_empresa || []).filter(function (x) { return x.ingresos || x.egresos; }), q = c.breakdowns.cuadre_empresas;
    if (l.length < 2) return '';
    return '<div id="fin-inf-empresas">' + U.card({ titulo: 'Por empresa', icono: 'empresa', sub: 'gastos compartidos repartidos; internos fuera', cuerpo: '<div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>Empresa</th><th class="fin2-der">Cobros propios</th><th class="fin2-der">Pagos propios</th><th class="fin2-der">Flujo propio</th></tr></thead><tbody>' +
      l.map(function (x) { return '<tr><td>' + txt(x.empresa) + '</td><td class="fin2-der fin2-num">' + plata(x.ingresos) + '</td><td class="fin2-der fin2-num">' + plata(x.egresos) + '</td><td class="fin2-der fin2-num">' + plata(x.flujo_propio) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      (q ? '<p class="fin2-ayuda">' + (q.diferencia === 0 ? U.ico('check', 12) + ' La suma de las empresas (' + plata(q.suma_empresas) + ') es igual al grupo: nada se cuenta dos veces.' : '<b>La suma de las empresas (' + plata(q.suma_empresas) + ') difiere del grupo (' + plata(q.grupo) + ') en ' + plata(q.diferencia) + '.</b>') + '</p>' : '') }) + '</div>';
  }
  function comercial(c) {
    var k = c.breakdowns.comercial;
    if (!k) return '';
    var tabla = function (l, titulo) {
      if (!l.length) return '<p class="fin2-ayuda">Sin cobros con cliente en el mes.</p>';
      return '<h3 class="fin2-p-sec__t">' + txt(titulo) + '</h3><div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>' + txt(titulo) + '</th><th class="fin2-der">Cobros</th><th class="fin2-der">Clientes</th><th class="fin2-der">Monto</th></tr></thead><tbody>' +
        l.map(function (x) { return '<tr><td>' + (x.desconocido ? '<i>' + txt(x.valor) + '</i>' : txt(x.valor)) + '</td><td class="fin2-der fin2-num">' + x.cobros + '</td><td class="fin2-der fin2-num">' + x.clientes + '</td><td class="fin2-der fin2-num">' + plata(x.monto) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    };
    var cob = k.cobertura;
    return '<div id="fin-inf-comercial">' + U.card({ titulo: 'Servicios, canales y vendedores', icono: 'persona', sub: 'con su cobertura; lo que no tiene dato se muestra como tal', accion: { texto: 'Completar fichas', clase: 'js-fini-ir', datos: { vista: 'clientes' } }, cuerpo:
      '<p class="fin2-ayuda">' + txt(k.metrica) + '</p>' +
      '<p class="fin2-ayuda">Cobertura: ' + cob.clientes + ' cliente(s) con cobros en el mes; ' + cob.con_canal + ' con canal (' + (cob.clientes ? Math.round(cob.con_canal / cob.clientes * 100) : 0) + ' %) y ' + cob.con_vendedor + ' con vendedor (' + (cob.clientes ? Math.round(cob.con_vendedor / cob.clientes * 100) : 0) + ' %).</p>' +
      tabla(k.por_canal, 'Canal') + tabla(k.por_vendedor, 'Vendedor') +
      '<h3 class="fin2-p-sec__t">Servicios vigentes</h3><p class="fin2-ayuda">' + txt(k.servicios_metrica) + '</p>' + (k.servicios.length ? '<div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>Servicio</th><th class="fin2-der">Clientes</th><th class="fin2-der">Mensual neto</th></tr></thead><tbody>' +
        k.servicios.map(function (x) { return '<tr><td>' + txt(x.servicio) + '</td><td class="fin2-der fin2-num">' + x.clientes + '</td><td class="fin2-der fin2-num">' + plata(x.mensual_neto) + (x.sin_monto ? '<span class="fin2-motivo">' + x.sin_monto + ' sin monto</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="fin2-ayuda">No hay servicios vigentes registrados en las fichas.</p>') }) + '</div>';
  }
  function desgloses(c) {
    var b = c.breakdowns, out = '';
    var conceptos = function (l, titulo, metric) {
      if (!l || !l.length) return '';
      return U.card({ titulo: titulo, icono: 'lista', sub: 'contra ' + mesLargo(c.comparison.period), cuerpo: '<div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>Concepto</th><th class="fin2-der">Este mes</th><th class="fin2-der">Mes anterior</th><th class="fin2-der">Diferencia</th><th></th></tr></thead><tbody>' +
        l.slice(0, 12).map(function (x) { return '<tr><td>' + txt(x.concepto) + '</td><td class="fin2-der fin2-num">' + plata(x.actual) + '</td><td class="fin2-der fin2-num">' + (x.base === null ? '—' : plata(x.base)) + '</td><td class="fin2-der fin2-num ' + (x.diferencia > 0 ? 'fin2-pos' : x.diferencia < 0 ? 'fin2-neg' : '') + '">' + (x.diferencia === null ? '—' : plata(x.diferencia)) + '</td>' +
          '<td><button type="button" class="sx2-enlace js-fini-det" data-metric="' + metric + '" data-concepto="' + txt(x.concepto) + '">Ver</button></td></tr>'; }).join('') + '</tbody></table></div>' });
    };
    out += conceptos(b.ingresos_por_concepto, 'Cobros propios por concepto', 'ingresos');
    out += conceptos(b.egresos_por_concepto, 'Pagos propios por concepto', 'egresos');
    if (b.custodia_clientes && b.custodia_clientes.length) out += U.card({ titulo: 'Fondos de clientes', icono: 'escudo', sub: 'saldo por cliente al corte', accion: { texto: 'Ver fondos', clase: 'js-fini-ir', datos: { vista: 'fondos' } }, cuerpo: '<ul class="fin2-lista-saldos">' + b.custodia_clientes.slice(0, 8).map(function (x) {
      return '<li><span>' + txt(x.cliente) + (x.parcial ? ' ' + U.badge('sin saldo inicial', 'alerta') : '') + '</span><b class="fin2-num ' + (x.saldo < 0 ? 'fin2-neg' : '') + '">' + plata(x.saldo) + '</b></li>'; }).join('') + '</ul>' });
    if ((b.entre_empresas || []).length) out += U.card({ titulo: 'Entre empresas', icono: 'empresa', cuerpo: '<ul class="fin2-lista-saldos">' + b.entre_empresas.map(function (d) { return '<li><span>' + txt(d.debe) + ' le debe a ' + txt(d.a) + '</span><b class="fin2-num">' + plata(d.monto) + '</b></li>'; }).join('') + '</ul>' });
    if ((b.obligaciones || []).length || (b.compromisos || []).length) out += U.card({ titulo: 'Lo que viene', icono: 'calendario', sub: 'compromisos registrados y obligaciones estimadas', accion: { texto: 'Proyección', clase: 'js-fini-ir', datos: { vista: 'proyeccion' } }, cuerpo: '<ul class="fin2-lista-saldos">' +
      (b.compromisos || []).map(function (x) { return '<li><span>' + txt(x.nombre || x.concepto || 'Compromiso') + ' · ' + txt(x.fecha || '') + ' ' + U.badge('Confirmado', 'info') + '</span><b class="fin2-num">' + plata(x.monto) + '</b></li>'; }).join('') +
      (b.obligaciones || []).map(function (o) { return '<li><span>' + txt(o.nombre) + ' · ' + txt(o.fecha) + ' ' + U.badge(o.por_determinar ? 'Por determinar' : 'Estimado', o.por_determinar ? 'neutro' : 'alerta') + '</span><b class="fin2-num">' + (o.estimado === null ? '—' : '≈ ' + plata(o.estimado)) + '</b></li>'; }).join('') + '</ul>' });
    var cb = c.metrics.cobranza;
    if (cb) out += '<div id="fin-inf-cobranza">' + U.card({ titulo: 'Cobranza', icono: 'recibo', sub: 'corte: hoy (' + cb.corte + ')', accion: { texto: 'Ver cobranza', clase: 'js-fini-ir', datos: { vista: 'cobranza' } }, cuerpo: '<ul class="fin2-lista-saldos">' +
      '<li><span>Por cobrar</span><b class="fin2-num">' + plata(cb.por_cobrar) + '</b></li><li><span>· confirmado (sin sugerencias)</span><b class="fin2-num">' + plata(cb.por_cobrar_confirmado) + '</b></li>' +
      '<li><span>Vencido</span><b class="fin2-num fin2-neg">' + plata(cb.vencido) + '</b></li><li><span>Más de ' + cb.dias_antiguo + ' días</span><b class="fin2-num">' + plata(cb.antiguo) + '</b></li><li><span>Cobros sin aplicar a factura</span><b class="fin2-num">' + plata(cb.sin_aplicar) + '</b></li></ul>' +
      (cb.antiguedad ? '<h3 class="fin2-p-sec__t">Antigüedad del saldo confirmado</h3><ul class="fin2-lista-saldos">' + cb.antiguedad.map(function (x) { return '<li><span>' + txt(x.tramo) + ' <small class="fin2-ayuda">' + x.facturas + ' factura(s)</small></span><b class="fin2-num">' + plata(x.monto) + '</b></li>'; }).join('') + '</ul>' : '') }) + '</div>';
    return out ? '<div class="fin2-rejilla">' + out + '</div>' : '';
  }
  function pintar() {
    var c = est_.c;
    x_.pagina(x_.cab('tablero',
      U.boton({ texto: 'Exportar', icono: 'exportar', sm: true, clase: 'js-fini-a-exportar', datos: { cap: 'EXPORTAR' } }) +
      U.boton({ texto: 'Descargar PDF', icono: 'descargar', sm: true, variante: 'primario', clase: 'js-fini-pdf', datos: { cap: 'EXPORTAR' } })) +
      controles(c) + calidad(c) + kpis(c) + pendienteIdentidad(c) + '<div id="fin-inf-lectura">' + insights(c) + '</div>' + grafico(c) + cascada(c) + '<div id="fin-inf-cmp">' + comparaciones(c) + '</div>' +
      cuentasCaja(c) + desgloses(c) + empresas(c) + comercial(c) + portafolio() +
      U.card({ titulo: 'Cómo se calcula', icono: 'libro', cuerpo: '<dl class="fin2-defs">' + Object.keys(c.definiciones).map(function (k) { return '<dt>' + txt(c.definiciones[k].nombre) + '</dt><dd>' + fichaHtml(c.definiciones[k]) + '</dd>'; }).join('') + '</dl>' +
        '<details class="fin2-tabla-equiv"><summary>Reglas de los comentarios (v' + txt(c.rule_version) + ')</summary><ul class="fin2-notas">' + (c.reglas || []).map(function (r) { return '<li><b>' + txt(r.rule_id) + '</b>: exige ' + txt(r.exige.toLowerCase()) + '. ' + txt(r.califica) + '.</li>'; }).join('') + '</ul></details>' }));
    U.animar(x_.raiz());
  }

  function fichaHtml(d) {
    if (!d) return '';
    return txt(d.formula) + (d.fuentes ? '<br><small class="fin2-ayuda"><b>Fuentes:</b> ' + txt(d.fuentes) + '. <b>Excluye:</b> ' + txt(d.excluye) + '. <b>Fecha:</b> ' + txt(d.fecha) + '. <b>Moneda:</b> ' + txt(d.moneda || 'CLP') + '. <b>Calidad:</b> ' + txt(d.calidad || '') + '</small>' : '');
  }
  /** Estado de una cifra (I03.3): determinada, provisoria o no determinable, con razones accionables y la referencia aparte. */
  function evaluacionHtml(e) {
    if (!e) return '';
    var et = { DETERMINED: ['Determinada', 'ok'], PROVISIONAL: ['Provisoria', 'alerta'], NOT_DETERMINABLE: ['No determinable', 'critico'] }[e.status] || [e.status, 'neutro'];
    return '<p>' + U.badge(et[0], et[1]) + ' corte ' + txt(e.cutoff) + (e.amount !== null ? ' · ' + plata(e.amount) : '') + '</p>' +
      (e.detalle && e.detalle.length ? '<ul class="fin2-razones">' + e.detalle.map(function (r) { return '<li>' + txt(r.texto) + (r.evidencia && r.evidencia.vista ? ' <button type="button" class="sx2-enlace js-fini-ir" data-vista="' + txt(r.evidencia.vista) + '" data-filtros="' + txt(JSON.stringify(r.evidencia.filtros || {})) + '">Ir</button>' : '') + '</li>'; }).join('') + '</ul>' : '') +
      (e.referencial ? '<p class="fin2-ayuda">Referencia (no es disponibilidad acreditada): ' + txt(e.referencial.formula) + ' = <b>' + plata(e.referencial.monto) + '</b>.</p>' : '') +
      (e.cuentas && e.cuentas.length ? '<p class="fin2-ayuda">Cobertura: ' + e.cuentas.map(function (k) { return txt(k.cuenta) + (k.completa ? ' completa' : k.completa === false ? ' hasta ' + txt(k.cubierta_hasta || '—') : ''); }).join(' · ') + '</p>' : '');
  }

  // ---- detalle: cómo se calculó / qué cambió ------------------------------------------------
  function detalle(metric, concepto, comparar, titulo, extra) {
    var c = est_.c;
    var d = U.drawer({ titulo: titulo || 'Detalle', subtitulo: '<span class="fin2-ayuda">' + txt(mesLargo(c.period)) + ' · ' + txt(c.scope.alcance) + (concepto ? ' · ' + txt(concepto) : '') + '</span>', cuerpo: U.esqueleto('tabla', 6) });
    d.el.classList.add('fin2-panel', 'sx2-drawer--ancho');
    if (['ingresos', 'egresos', 'fondos_recibidos', 'fondos_pagados', 'pendientes'].indexOf(metric) === -1) {
      var def = c.definiciones[metric];
      var cas = metric === 'flujo_propio' && c.breakdowns.cascada;
      d.cuerpo('<p><b>' + txt(def ? def.nombre : metric) + ':</b> ' + fichaHtml(def) + '</p>' + (extra || '') +
        (cas ? '<ul class="fin2-lista-saldos">' + cas.pasos.map(function (x) { return '<li><span>' + txt(x.concepto) + ' <small class="fin2-ayuda">' + (x.signo > 0 ? 'cobro' : 'pago') + '</small></span><b class="fin2-num">' + plata(x.signo * x.monto) + '</b></li>'; }).join('') + '<li><span><b>Flujo propio</b>' + (cas.cuadra ? ' · cuadra' : ' · NO cuadra') + '</span><b class="fin2-num">' + plata(cas.total) + '</b></li></ul>'
          : '<p class="fin2-ayuda">Esta cifra no se arma de movimientos sueltos: sale de saldos (cartolas, saldos iniciales aprobados) al corte ' + txt(c.as_of) + '.</p>') +
        evaluacionHtml(c.evaluacion && c.evaluacion[metric]) +
        (metric === 'caja' || metric === 'caja_libre' ? '<ul class="fin2-lista-saldos">' + (c.breakdowns.cuentas || []).map(function (k) { return '<li><span>' + txt(k.banco + ' ···' + k.ultimos4 + ' · ' + k.empresa) + ' <small class="fin2-ayuda">al ' + txt(k.al) + '</small></span><b class="fin2-num">' + plata(k.saldo) + '</b></li>'; }).join('') + '</ul>' : ''));
      d.el.addEventListener('click', function (ev) { var b = ev.target.closest('.js-fini-ir'); if (!b) return; var f = {}; try { f = JSON.parse(b.dataset.filtros || '{}'); } catch (e) { f = {}; } d.cerrar(); x_.ir(b.dataset.vista, Object.assign({ periodo: c.period }, f)); });
      return;
    }
    x_.api('finanzasReporteDetalle', { periodo: c.period, empresa: c.scope.empresa, metric: metric, concepto: concepto || '', comparar: !!comparar }).then(function (r) {
      if (!r || !r.ok) { d.cuerpo(U.vacio({ icono: 'alerta', titulo: 'No se pudo abrir', texto: (r && r.message) || '' })); return; }
      var x = r.data;
      var tabla = function (l) {
        return l.length ? '<div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>Fecha</th><th>Detalle</th><th>Concepto</th><th>Dónde</th><th class="fin2-der">Monto</th></tr></thead><tbody>' + l.map(function (h) {
          return '<tr><td class="fin2-num">' + txt(h.fecha) + '</td><td>' + txt(h.glosa || '—') + (h.cliente ? '<br><small>' + txt(h.cliente) + '</small>' : '') + '</td><td>' + txt(h.concepto) + (h.compartido ? ' ' + U.badge('su parte', 'info') : '') + '</td>' +
            '<td>' + txt(h.fuente === 'REGISTRO' ? 'Registro' + (h.sin_banco ? ' (falta el banco)' : '') : h.cuenta) + '</td><td class="fin2-der fin2-num">' + plata(h.monto) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="fin2-ayuda">Sin registros.</p>';
      };
      d.cuerpo((x.definicion ? '<p class="fin2-p-caja fin2-p-caja--info">' + U.ico('libro', 16) + '<span><b>' + txt(x.definicion.nombre) + ':</b> ' + txt(x.definicion.formula) + '</span></p>' : '') +
        '<h3 class="fin2-p-sec__t">' + txt(mesLargo(x.periodo)) + ' · ' + x.hechos.length + ' registro(s) · ' + plata(x.total) + '</h3>' + tabla(x.hechos) +
        (x.comparacion ? '<h3 class="fin2-p-sec__t">' + txt(mesLargo(x.comparacion.periodo)) + ' · ' + x.comparacion.hechos.length + ' registro(s) · ' + plata(x.comparacion.total) + '</h3>' +
          '<p class="fin2-ayuda">Diferencia: <b>' + plata(x.total - x.comparacion.total) + '</b>. La lista muestra qué registros hay en cada mes; no explica por qué cambiaron.</p>' + tabla(x.comparacion.hechos) : ''));
    });
  }
  function cambiosFlujo(i) {
    var c = est_.c;
    var d = U.drawer({ titulo: 'Qué cambió en el flujo propio', subtitulo: '<span class="fin2-ayuda">' + txt(mesLargo(c.period)) + ' contra ' + txt(mesLargo(c.comparison.period)) + ' · ' + txt(c.scope.alcance) + '</span>', cuerpo:
      '<div class="fin2-p"><p class="fin2-ayuda">Efecto de cada concepto en el flujo (un pago mayor resta). Muestra qué cambió, no por qué.</p><div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>Concepto</th><th class="fin2-der">Efecto en el flujo</th><th></th></tr></thead><tbody>' +
      (i.contribuciones || []).map(function (k) { return '<tr><td>' + txt(k.nombre) + ' <small class="fin2-ayuda">' + (k.metric === 'ingresos' ? 'cobro' : 'pago') + '</small></td><td class="fin2-der fin2-num ' + (k.diferencia >= 0 ? 'fin2-pos' : 'fin2-neg') + '">' + (k.diferencia >= 0 ? '+' : '') + plata(k.diferencia) + '</td><td><button type="button" class="sx2-enlace js-fini-cdet" data-metric="' + txt(k.metric) + '" data-concepto="' + txt(k.nombre) + '">Ver registros</button></td></tr>'; }).join('') +
      '</tbody></table></div></div>' });
    d.el.classList.add('fin2-panel');
    d.el.addEventListener('click', function (ev) { var b = ev.target.closest('.js-fini-cdet'); if (!b) return; d.cerrar(); detalle(b.dataset.metric, b.dataset.concepto, true, 'Qué cambió'); });
  }
  function accionInsight(i, a) {
    if (a === 'VER_QUE_CAMBIO' && i.rule_id === 'FLUJO_PROPIO') { cambiosFlujo(i); return; }
    if (a === 'VER_QUE_CAMBIO' && i.evidencia && i.evidencia.vista === 'presupuesto') { x_.ir('presupuesto', { periodo: est_.c.period }); return; }
    var metric = { calidad: 'pendientes', por_cobrar: 'por_cobrar', custodia: 'custodia', meses_caja: 'meses_caja', caja: 'caja', entre_empresas: 'caja' }[i.metric] || i.metric;
    if (a === 'REVISAR_PENDIENTES') {
      var ev = i.evidencia || {};
      if (i.rule_id === 'DATOS_INCOMPLETOS' || !ev.vista) { x_.ir('pendientes', { periodo: est_.c.period }); return; }
      x_.ir(ev.vista, Object.assign({ periodo: est_.c.period }, ev.filtros || {}));
      return;
    }
    // Regla, versión y revisión técnica van aquí (no en la lectura principal).
    var meta = '<p class="fin2-ayuda">Comentario generado por la regla ' + txt(i.rule_id) + ' v' + txt(i.rule_version) + ' · base ' + txt(est_.c.bases[i.basis] || i.basis) + ' · corte ' + txt(i.corte) + ' · revisión de datos ' + txt(est_.c.data_revision) + '.</p>';
    detalle(metric, '', a === 'VER_QUE_CAMBIO', a === 'VER_QUE_CAMBIO' ? 'Qué cambió' : 'Cómo se calculó', meta);
  }

  function pdf(b) {
    var c = est_.c;
    b.disabled = true; b.setAttribute('aria-busy', 'true');
    x_.api('finanzasInformePdf', { periodo: c.period, empresa: c.scope.empresa, base: c.basis, comparacion: c.comparison.type, data_revision: c.data_revision }).then(function (r) {
      b.disabled = false; b.removeAttribute('aria-busy');
      if (r && r.ok && r.data && r.data.pdf_base64) { descargar(r.data.pdf_base64, r.data.filename || 'informe-financiero.pdf', 'application/pdf'); return; }
      if (r && r.codigo === 'CONFLICTO_VERSION') { x_.aviso('Los datos cambiaron desde que abriste el informe: se recargó. Descárgalo de nuevo.', 'alerta'); ver(x_); return; }
      x_.aviso((r && r.message) || 'No se pudo generar el PDF.', 'error');
    });
  }

  // ---- exportar (FIN-40) -----------------------------------------------------------------
  var TIPOS = [['movimientos', 'Movimientos del banco', 'Cada pieza confirmada o pendiente, con su clasificación.'], ['operaciones', 'Operaciones registradas', 'El registro diario, con estado y conciliación.'],
    ['aplicaciones', 'Aplicaciones a facturas', 'Qué cobro se aplicó a qué factura.'], ['cartera', 'Cartera por factura', 'Saldo de cada factura hoy (confirmado y sugerido).'],
    ['fondos', 'Fondos por gestión', 'Recibido, pagado y saldo por cliente y gestión.'], ['presupuesto', 'Presupuesto y real', 'Por concepto y mes, en la base del presupuesto.'], ['informe', 'Informe del mes', 'Las cifras del contrato del informe.']];
  function verExportar(x) {
    x_ = x; enlazar();
    var c = x.contexto();
    x.catalogo().then(function (cat) {
      x.pagina(x.cab('exportar') + '<div class="fin2-exp sx2-entra">' + U.card({ titulo: 'Qué exportar', icono: 'exportar', cuerpo:
        '<div class="fin2-exp__tipos" role="radiogroup" aria-label="Qué exportar">' + TIPOS.map(function (t, i) {
          return '<label class="fin2-exp__tipo"><input type="radio" name="fin-exp-tipo" value="' + t[0] + '"' + (i === 0 ? ' checked' : '') + '><span><b>' + txt(t[1]) + '</b><small>' + txt(t[2]) + '</small></span></label>';
        }).join('') + '</div>' +
        '<div class="fin2-form-grid">' + U.campo('Mes', '<input type="month" class="sx2-input js-fine-mes" value="' + txt(c.periodo || '') + '">', 'Se exporta el mes elegido. La cartera es de hoy; el presupuesto, del año.') +
          '<label class="sx2-campo fin2-check"><input type="checkbox" class="js-fine-todo"><span>Todo el historial (movimientos, operaciones o aplicaciones de todos los meses)</span></label>' +
          U.campo('Año (presupuesto)', '<input type="number" class="sx2-input js-fine-anio" min="2020" max="2100" value="' + txt((c.periodo || '').slice(0, 4) || new Date().getFullYear()) + '">') +
          U.campo('Empresa', '<select class="sx2-input js-fine-emp"><option value="">Todas</option>' + ((cat && cat.empresas) || []).map(function (e) { return '<option' + (e === c.empresa ? ' selected' : '') + '>' + txt(e) + '</option>'; }).join('') + '</select>') +
          U.campo('Formato', '<select class="sx2-input js-fine-fmt"><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV (;)</option></select>', 'El CSV neutraliza textos que Excel tomaría como fórmula.') + '</div>' +
        '<p class="fin2-ayuda">Cada archivo lleva sus metadatos: filtros, corte, base, estado de los datos, revisión y quién lo generó. Queda en la bitácora.</p>' +
        '<div class="fin2-acciones">' + U.boton({ texto: 'Descargar', icono: 'descargar', variante: 'primario', clase: 'js-fine-ir', datos: { cap: 'EXPORTAR' } }) + '</div>' }) + '</div>');
    });
  }
  function exportar(b) {
    var raiz = x_.raiz();
    var tipo = (raiz.querySelector('input[name="fin-exp-tipo"]:checked') || {}).value;
    var todo = raiz.querySelector('.js-fine-todo').checked;
    var f = { periodo: todo ? '' : raiz.querySelector('.js-fine-mes').value, empresa: raiz.querySelector('.js-fine-emp').value, anio: raiz.querySelector('.js-fine-anio').value, todo: todo,
      base: est_.base, comparacion: est_.comparacion };
    b.disabled = true;
    x_.api('finanzasExportar', { tipo: tipo, formato: raiz.querySelector('.js-fine-fmt').value, filtros: f }).then(function (r) {
      b.disabled = false;
      if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo exportar.', 'error'); return; }
      descargar(r.data.base64, r.data.nombre, r.data.mime);
      x_.aviso(r.data.filas + ' fila(s) exportadas.', 'exito');
    });
  }

  // =====================================================================================
  var enlazado_ = false;
  function enlazar() {
    var raiz = x_.raiz();
    if (enlazado_ || !raiz) return;
    enlazado_ = true;
    raiz.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.classList.contains('js-fini-mes')) { est_.periodo = t.value; x_.contexto({ periodo_informe: t.value }); ver(x_); }
      else if (t.classList.contains('js-fini-emp')) { est_.empresa = t.value; x_.contexto({ empresa_informe: t.value }); ver(x_); }
      else if (t.classList.contains('js-fini-cmp')) { est_.comparacion = t.value; x_.contexto({ comparacion: t.value }); est_.c.comparison.type = t.value; pintar(); }
    });
    raiz.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b || !raiz.contains(b)) return;
      if (b.classList.contains('js-fini-base')) { est_.base = b.dataset.id; x_.contexto({ base: b.dataset.id }); ver(x_); }
      else if (b.classList.contains('js-fini-pdf')) pdf(b);
      else if (b.classList.contains('js-fini-a-exportar')) x_.ir('exportar', { periodo: est_.c.period, empresa: est_.c.scope.empresa });
      else if (b.classList.contains('sx2-kpi--clic') && b.closest('.fin2-kpis')) detalle(b.dataset.filtro, '', false, 'Cómo se calculó');
      else if (b.classList.contains('js-fini-det')) detalle(b.dataset.metric, b.dataset.concepto, true, 'Qué cambió');
      else if (b.classList.contains('js-fini-acc')) accionInsight(est_.c.insights[Number(b.dataset.n)], b.dataset.a);
      else if (b.classList.contains('js-fini-port')) {
        var dst = b.dataset.d;
        if (dst.charAt(0) === '#') { var el = raiz.querySelector(dst); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); var foc = el.querySelector('h2, h3, .sx2-card__titulo'); if (foc) { foc.setAttribute('tabindex', '-1'); foc.focus({ preventScroll: true }); } } else x_.aviso('Ese informe no tiene datos en este mes.', 'info'); }
        else x_.ir(dst, { periodo: est_.c.period });
      }
      else if (b.classList.contains('js-fini-ir')) { var f = {}; try { f = JSON.parse(b.dataset.filtros || '{}'); } catch (e) { f = {}; } x_.ir(b.dataset.vista, Object.assign({ periodo: est_.c ? est_.c.period : '' }, f)); }
      else if (b.classList.contains('js-fine-ir')) exportar(b);
    });
  }

  window.SigsoFinanzasInformes = { ver: ver, verExportar: verExportar };
})();
