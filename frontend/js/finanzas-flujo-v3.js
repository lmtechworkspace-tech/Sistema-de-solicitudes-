/**
 * finanzas-flujo-v3.js — Flujo por mes (Finanzas v3, 21-10-2026; backend finanzasLibro.flujo).
 * La misma lectura de las hojas «FLUJO» de la planilla SIGECO, pero calculada desde el
 * libro del banco: filas por concepto (honorarios, gastos por cuenta, fondos de clientes
 * por obligación, traspasos y préstamos), columnas por mes y un total. Abajo, el neto del
 * banco de cada mes y si ese mes está verificado contra la cartola.
 */
(function () {
  'use strict';

  var U = UIv2;
  var x_ = null;
  var est_ = { hasta: '', meses: 3, cuenta: '', d: null };
  document.addEventListener('sigso-fin-cerrada', function () { est_.d = null; });

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function plata(n) { if (!n) return '<span class="fin3-cero">—</span>'; var v = Math.round(Number(n) || 0); return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('es-CL'); }
  function mesCorto(p) { var m = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']; var a = String(p || '').split('-'); return a.length === 2 ? m[Number(a[1]) - 1] + ' ' + a[0].slice(2) : p; }
  function hoyMes() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()).slice(0, 7); }

  function ver(x) {
    x_ = x; enlazar();
    est_.hasta = est_.hasta || x.contexto().periodo_libro || hoyMes();
    var t = x.turno();
    x.pagina(x.cab('flujo') + U.esqueleto('tabla', 12));
    x.api('finanzasLibroFlujo', { hasta: est_.hasta, meses: est_.meses, cuenta_ref: est_.cuenta }).then(function (r) {
      if (!x.vigente(t)) return;
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('flujo') + U.card({ cuerpo: U.vacio({ accion: '<button type="button" class="sx2-boton sx2-boton--secundario sx2-boton--sm js-fin-reintentar">Reintentar</button>', icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || '' }) })); return; }
      est_.d = r.data; pintar();
    });
  }

  // Secciones del flujo: qué filas van en cada una y con qué nombre.
  var SECCIONES = [
    { id: 'ing', titulo: 'Ingresos de la empresa', filtro: function (f) { return f.categoria === 'ABONO' || f.categoria === 'ABONO RENTA'; }, nombre: function (f) { return f.cuenta || 'Honorarios'; } },
    { id: 'gas', titulo: 'Gastos de la empresa', filtro: function (f) { return f.categoria === 'GASTO'; }, nombre: function (f) { return f.cuenta || 'Gasto'; } },
    { id: 'res', titulo: 'Resultado propio', total: ['ing', 'gas'] },
    { id: 'fon', titulo: 'Fondos de clientes (no son de la empresa)', filtro: function (f) { return f.categoria === 'FONDOS'; }, nombre: function (f) { return (f.tipo === 'FONDO_RECIBIDO' ? 'Recibido · ' : 'Pagado por ellos · ') + (f.cuenta || ''); } },
    { id: 'otr', titulo: 'Traspasos y préstamos', filtro: function (f) { return f.categoria === 'TRASPASO' || f.categoria === 'PRESTAMO'; }, nombre: function (f) { return f.categoria === 'TRASPASO' ? 'Traspasos entre cuentas propias' : 'Préstamos entre empresas'; } },
    { id: 'sin', titulo: 'Por revisar', filtro: function (f) { return f.categoria === 'SIN CLASIFICAR'; }, nombre: function () { return 'Movimientos sin clasificar'; } }
  ];

  function pintar() {
    var d = est_.d, meses = d.meses;
    var sumas = {};
    var cuerpo = SECCIONES.map(function (s) {
      if (s.total) {
        var v = {}; meses.forEach(function (m) { v[m] = s.total.reduce(function (t, k) { return t + ((sumas[k] || {})[m] || 0); }, 0); });
        return fila(s.titulo, v, 'fin3-flujo__res');
      }
      var filas = d.filas.filter(s.filtro).sort(function (a, b) { return Math.abs(total(b.valores)) - Math.abs(total(a.valores)); });
      if (!filas.length) return '';
      var sub = {}; meses.forEach(function (m) { sub[m] = filas.reduce(function (t, f) { return t + (f.valores[m] || 0); }, 0); });
      sumas[s.id] = sub;
      return '<tr class="fin3-flujo__sec"><th colspan="' + (meses.length + 2) + '">' + txt(s.titulo) + '</th></tr>' +
        filas.map(function (f) { return fila(s.nombre(f), f.valores, ''); }).join('') + (filas.length > 1 ? fila('Subtotal', sub, 'fin3-flujo__sub') : '');
    }).join('');
    var neto = {}; meses.forEach(function (m) { neto[m] = (d.totales[m] || {}).neto || 0; });
    var verif = '<tr class="fin3-flujo__ver"><th>Contra el banco</th>' + meses.map(function (m) {
      var t = d.totales[m] || {};
      var e = !t.verificados && !t.sin_cartola ? '<span class="fin3-cero">sin datos</span>' : t.sin_cartola && !t.verificados ? '<span class="fin3-sc">sin cartola</span>' : t.por_revisar ? '<span class="fin3-sc">' + t.por_revisar + ' por revisar</span>' : '<span class="fin2-pos">' + U.ico('check', 12) + ' verificado</span>';
      return '<td class="fin2-der">' + e + '</td>';
    }).join('') + '<td></td></tr>';
    x_.pagina(x_.cab('flujo') +
      '<div class="fin3-barra">' +
        '<label class="fin2-campo fin2-campo--fila"><span>Hasta</span><input type="month" class="fin2-input js-ffl-hasta" value="' + txt(est_.hasta) + '"></label>' +
        U.segmento([{ id: '3', texto: '3 meses' }, { id: '6', texto: '6 meses' }, { id: '12', texto: '12 meses' }], String(est_.meses), 'js-ffl-meses') +
        '<span class="fin2-ayuda">Como las hojas FLUJO de la planilla, calculado desde el libro del banco (lo que no pasa por el banco, también).</span>' +
      '</div>' +
      '<div class="fin3-tabla-envoltura"><table class="fin3-libro fin3-flujo"><thead><tr><th>Concepto</th>' + meses.map(function (m) { return '<th class="fin2-der">' + txt(mesCorto(m)) + '</th>'; }).join('') + '<th class="fin2-der">Total</th></tr></thead>' +
        '<tbody>' + (cuerpo || '<tr><td colspan="' + (meses.length + 2) + '">' + U.vacio({ icono: 'grafico', titulo: 'Sin movimientos en estos meses' }) + '</td></tr>') + '</tbody>' +
        '<tfoot>' + fila('Neto del banco', neto, 'fin3-flujo__neto') + verif + '</tfoot></table></div>');
  }
  function total(v) { return Object.keys(v).reduce(function (t, k) { return t + (v[k] || 0); }, 0); }
  function fila(nombre, valores, clase) {
    var meses = est_.d.meses;
    return '<tr class="' + clase + '"><th>' + txt(nombre) + '</th>' + meses.map(function (m) { var v = valores[m] || 0; return '<td class="fin2-der fin2-num' + (v < 0 ? ' fin2-neg' : '') + '">' + plata(v) + '</td>'; }).join('') +
      '<td class="fin2-der fin2-num fin3-flujo__tot' + (total(valores) < 0 ? ' fin2-neg' : '') + '">' + plata(total(valores)) + '</td></tr>';
  }

  var enlazado_ = false;
  function enlazar() {
    if (enlazado_) return; enlazado_ = true;
    var raiz = document.getElementById('modulo-finanzas');
    raiz.addEventListener('change', function (ev) { if (ev.target.classList.contains('js-ffl-hasta') && /^\d{4}-\d{2}$/.test(ev.target.value)) { est_.hasta = ev.target.value; ver(x_); } });
    raiz.addEventListener('click', function (ev) { var b = ev.target.closest('.js-ffl-meses'); if (b && document.querySelector('.fin3-flujo')) { est_.meses = Number(b.dataset.id); ver(x_); } });
  }

  window.SigsoFinanzasFlujo = { ver: ver };
})();
