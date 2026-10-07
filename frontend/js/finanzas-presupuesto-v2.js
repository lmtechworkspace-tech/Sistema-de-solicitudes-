/**
 * finanzas-presupuesto-v2.js — Finanzas, Etapa 5: presupuesto (2026-10-06;
 * backend/logica/finanzasPresupuesto.js). Pestaña «Presupuesto» de la bóveda:
 *
 *  - Comparar: lo presupuestado contra lo real del mes y del año, por cuenta,
 *    con cuánto se desvió y si es bueno o malo (más ingresos = bien, más
 *    gastos = mal). El grupo suma las empresas.
 *  - Editar: una grilla de 12 meses por cuenta, por empresa. «Repetir en todo
 *    el año» copia el primer mes con valor; los montos aceptan puntos.
 */
(function () {
  'use strict';

  var U = UIv2;
  var x_ = null;
  var hoy = new Date();
  var est_ = { anio: hoy.getFullYear(), empresa: '', mes: hoy.getMonth(), modo: 'comparar', datos: null, todas: false };
  var MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  var MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var PESO = '$', MENOS = '−';

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function plata(n) { var v = Math.round(Number(n) || 0); return (v < 0 ? MENOS : '') + PESO + Math.abs(v).toLocaleString('es-CL'); }
  function num(v) { return Math.round(Number(String(v == null ? '' : v).replace(/[^\d-]/g, '')) || 0); }
  function suma(a) { return a.reduce(function (s, v) { return s + v; }, 0); }
  var avisoT_ = null;
  function aviso(msg) {
    var el = document.getElementById('fin2-toast');
    if (!el) { el = document.createElement('div'); el.id = 'fin2-toast'; el.className = 'fin2-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('fin2-toast--on');
    clearTimeout(avisoT_); avisoT_ = setTimeout(function () { el.classList.remove('fin2-toast--on'); }, 4500);
  }

  function ver(x) {
    x_ = x; enlazar();
    if (est_.modo === 'editar' && !est_.empresa) est_.empresa = 'HomePymes';
    var t = x.turno();
    x.pagina(x.cab('Presupuesto', controles()) + U.esqueleto('tabla', 10));
    x.api('finanzasPresupuesto', { anio: est_.anio, empresa: est_.empresa }).then(function (r) {
      if (!x.vigente(t)) return;
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('Presupuesto', controles()) + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: r.message || '' }) })); return; }
      est_.datos = r.data;
      // Hasta que se elija otro, el mes es el último con movimientos (el mes en curso suele estar vacío).
      if (!est_.mesElegido && r.data.ultimo_mes_con_datos !== null && r.data.ultimo_mes_con_datos !== undefined && r.data.ultimo_mes_con_datos < est_.mes) est_.mes = r.data.ultimo_mes_con_datos;
      if (est_.modo === 'editar') pintarEditar(); else pintarComparar();
    });
  }

  function controles() {
    var anios = [est_.anio - 1, est_.anio, est_.anio + 1];
    var emps = (est_.datos && est_.datos.empresas) || ['HomePymes', 'Homeconsulting', 'HomePrevise', 'GDE', 'RLD', 'Virtual Base'];
    return U.segmento([{ id: 'comparar', texto: 'Comparar', icono: 'grafico' }, { id: 'editar', texto: 'Editar', icono: 'editar' }], est_.modo, 'js-finp-modo') +
      '<select class="fin2-input fin2-input--sm js-finp-anio" aria-label="Año">' + anios.map(function (a) { return '<option' + (a === est_.anio ? ' selected' : '') + '>' + a + '</option>'; }).join('') + '</select>' +
      '<select class="fin2-input fin2-input--sm js-finp-emp" aria-label="Empresa">' + (est_.modo === 'editar' ? '' : '<option value="">Grupo (suma)</option>') +
        emps.map(function (e) { return '<option' + (e === est_.empresa ? ' selected' : '') + '>' + txt(e) + '</option>'; }).join('') + '</select>' +
      (est_.modo === 'comparar' ? '<select class="fin2-input fin2-input--sm js-finp-mes" aria-label="Mes">' + MESES_L.map(function (m, i) { return '<option value="' + i + '"' + (i === est_.mes ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select>' : '');
  }

  // --- Comparar ----------------------------------------------------------------------------
  function desvio(real, ppto, tipo) {
    if (!ppto && !real) return { txt: '—', tono: 'neutro', pct: null };
    if (!ppto) return { txt: 'sin presupuesto', tono: 'neutro', pct: null };
    var d = real - ppto, pct = Math.round(real / ppto * 100);
    var bien = tipo === 'INGRESO' ? d >= 0 : d <= 0;
    return { txt: (d >= 0 ? '+' : MENOS) + plata(Math.abs(d)), tono: Math.abs(d) / ppto < 0.05 ? 'neutro' : bien ? 'ok' : 'critico', pct: pct };
  }
  function barra(pct, tono) {
    if (pct === null) return '';
    var w = Math.min(pct, 150) / 150 * 100;
    return '<span class="fin2-ejec"><i class="sx2-tono-' + tono + '" style="width:' + w + '%"></i><b style="left:' + (100 / 150 * 100) + '%"></b></span><span class="fin2-ayuda">' + pct + ' %</span>';
  }
  function pintarComparar() {
    var d = est_.datos, m = est_.mes;
    var acum = function (arr) { return suma(arr.slice(0, m + 1)); };
    var tot = { INGRESO: { pm: 0, rm: 0, pa: 0, ra: 0 }, EGRESO: { pm: 0, rm: 0, pa: 0, ra: 0 } };
    var filas = d.filas.filter(function (f) { return est_.todas || suma(f.ppto) || suma(f.real); });
    d.filas.forEach(function (f) { var o = tot[f.tipo]; o.pm += f.ppto[m]; o.rm += f.real[m]; o.pa += acum(f.ppto); o.ra += acum(f.real); });
    var resM = { p: tot.INGRESO.pm - tot.EGRESO.pm, r: tot.INGRESO.rm - tot.EGRESO.rm }, resA = { p: tot.INGRESO.pa - tot.EGRESO.pa, r: tot.INGRESO.ra - tot.EGRESO.ra };
    var fila = function (f) {
      var dm = desvio(f.real[m], f.ppto[m], f.tipo), da = desvio(acum(f.real), acum(f.ppto), f.tipo);
      return '<tr><td>' + txt(f.cuenta) + '</td><td class="fin2-num fin2-der">' + plata(f.ppto[m]) + '</td><td class="fin2-num fin2-der"><b>' + plata(f.real[m]) + '</b></td>' +
        '<td class="fin2-num fin2-der sx2-tono-' + dm.tono + ' fin2-desv">' + dm.txt + '</td><td class="fin2-ejec-c">' + barra(dm.pct, dm.tono) + '</td>' +
        '<td class="fin2-num fin2-der fin2-sep">' + plata(acum(f.ppto)) + '</td><td class="fin2-num fin2-der"><b>' + plata(acum(f.real)) + '</b></td><td class="fin2-num fin2-der sx2-tono-' + da.tono + ' fin2-desv">' + da.txt + '</td></tr>';
    };
    var seccion = function (tipo, titulo) {
      var lista = filas.filter(function (f) { return f.tipo === tipo; });
      var o = tot[tipo], dm = desvio(o.rm, o.pm, tipo), da = desvio(o.ra, o.pa, tipo);
      return '<tr class="fin2-sec"><td colspan="8">' + titulo + '</td></tr>' + (lista.map(fila).join('') || '<tr><td colspan="8" class="fin2-ayuda">Sin datos.</td></tr>') +
        '<tr class="fin2-tot"><td>Total ' + titulo.toLowerCase() + '</td><td class="fin2-num fin2-der">' + plata(o.pm) + '</td><td class="fin2-num fin2-der">' + plata(o.rm) + '</td><td class="fin2-num fin2-der sx2-tono-' + dm.tono + ' fin2-desv">' + dm.txt + '</td><td class="fin2-ejec-c">' + barra(dm.pct, dm.tono) + '</td>' +
        '<td class="fin2-num fin2-der fin2-sep">' + plata(o.pa) + '</td><td class="fin2-num fin2-der">' + plata(o.ra) + '</td><td class="fin2-num fin2-der sx2-tono-' + da.tono + ' fin2-desv">' + da.txt + '</td></tr>';
    };
    var kres = desvio(resM.r, resM.p, 'INGRESO'), kacu = desvio(resA.r, resA.p, 'INGRESO');
    x_.pagina(x_.cab('Presupuesto', controles()) +
      (!d.cargado ? '<div class="fin2-cinta sx2-entra">' + U.ico('info', 16) + '<span><b>No hay presupuesto ' + d.anio + ' cargado' + (d.empresa ? ' para ' + txt(d.empresa) : '') + '.</b> Lo real se muestra igual; cárgalo en «Editar» (por empresa).</span>' +
        U.boton({ texto: 'Cargar presupuesto', icono: 'editar', variante: 'primario', sm: true, clase: 'js-finp-ir-editar' }) + '</div>' : '') +
      (d.primer_mes_con_datos !== null && d.primer_mes_con_datos > 0 && m >= d.primer_mes_con_datos && d.cargado
        ? '<div class="fin2-cinta sx2-entra">' + U.ico('alerta', 16) + '<span>Los movimientos de ' + d.anio + ' empiezan en <b>' + MESES_L[d.primer_mes_con_datos] + '</b>: el «año a ' + MESES_L[m] + '» compara también los meses anteriores, que no tienen cartolas cargadas. Mira la columna del mes.</span></div>' : '') +
      (d.primer_mes_con_datos !== null && m < d.primer_mes_con_datos
        ? '<div class="fin2-cinta sx2-entra">' + U.ico('info', 16) + '<span>No hay cartolas cargadas de ' + MESES_L[m] + ' ' + d.anio + ': lo real aparece en cero.</span></div>' : '') +
      '<div class="sx2-fila-kpis fin2-kpis5">' +
        U.kpi({ etiqueta: 'Ingresos de ' + MESES_L[m], valor: plata(tot.INGRESO.rm), icono: 'dinero', i: 0, tendencia: tot.INGRESO.pm ? { texto: Math.round(tot.INGRESO.rm / tot.INGRESO.pm * 100) + ' % de lo presupuestado', tono: tot.INGRESO.rm >= tot.INGRESO.pm ? 'ok' : 'critico' } : null }) +
        U.kpi({ etiqueta: 'Gastos de ' + MESES_L[m], valor: plata(tot.EGRESO.rm), icono: 'recibo', i: 1, tendencia: tot.EGRESO.pm ? { texto: Math.round(tot.EGRESO.rm / tot.EGRESO.pm * 100) + ' % de lo presupuestado', tono: tot.EGRESO.rm <= tot.EGRESO.pm ? 'ok' : 'critico' } : null }) +
        U.kpi({ etiqueta: 'Resultado de ' + MESES_L[m], valor: plata(resM.r), icono: 'tendencia', i: 2, tendencia: resM.p ? { texto: 'presupuesto ' + plata(resM.p), tono: kres.tono } : null }) +
        U.kpi({ etiqueta: 'Resultado del año a ' + MESES_L[m], valor: plata(resA.r), icono: 'calendario', i: 3, tendencia: resA.p ? { texto: 'presupuesto ' + plata(resA.p), tono: kacu.tono } : null }) +
      '</div>' +
      U.card({ sinRelleno: true, cuerpo:
        '<div class="fin2-tabla-barra"><span class="fin2-ayuda">Ingresos: más que lo presupuestado es bueno. Gastos: más que lo presupuestado es malo. Los gastos compartidos cuentan la parte de cada empresa.</span>' +
          '<label class="fin2-ayuda" style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" class="js-finp-todas"' + (est_.todas ? ' checked' : '') + '>Ver todas las cuentas</label></div>' +
        '<div class="fin2-tabla-envoltura"><table class="fin2-tabla fin2-ppto"><thead>' +
          '<tr><th rowspan="2">Cuenta</th><th colspan="4" class="fin2-cen">' + txt(MESES_L[m]) + '</th><th colspan="3" class="fin2-cen fin2-sep">Año a ' + txt(MESES_L[m]) + '</th></tr>' +
          '<tr><th class="fin2-der">Presupuesto</th><th class="fin2-der">Real</th><th class="fin2-der">Diferencia</th><th>Ejecución</th><th class="fin2-der fin2-sep">Presupuesto</th><th class="fin2-der">Real</th><th class="fin2-der">Diferencia</th></tr>' +
        '</thead><tbody>' + seccion('INGRESO', 'Ingresos') + seccion('EGRESO', 'Gastos') +
          '<tr class="fin2-tot fin2-res"><td>Resultado</td><td class="fin2-num fin2-der">' + plata(resM.p) + '</td><td class="fin2-num fin2-der">' + plata(resM.r) + '</td><td class="fin2-num fin2-der sx2-tono-' + kres.tono + ' fin2-desv">' + kres.txt + '</td><td></td>' +
          '<td class="fin2-num fin2-der fin2-sep">' + plata(resA.p) + '</td><td class="fin2-num fin2-der">' + plata(resA.r) + '</td><td class="fin2-num fin2-der sx2-tono-' + kacu.tono + ' fin2-desv">' + kacu.txt + '</td></tr>' +
        '</tbody></table></div>' }));
    if (U.animar) U.animar(x_.raiz());
  }

  // --- Editar --------------------------------------------------------------------------------
  function pintarEditar() {
    var d = est_.datos;
    var cab = '<tr><th>Cuenta</th>' + MESES.map(function (m) { return '<th class="fin2-der">' + m + '</th>'; }).join('') + '<th class="fin2-der">Total año</th><th></th></tr>';
    var fila = function (f) {
      return '<tr class="js-finp-fila" data-tipo="' + f.tipo + '" data-cuenta="' + txt(f.cuenta) + '"><td class="fin2-ppto-cta">' + txt(f.cuenta) + '</td>' +
        f.ppto.map(function (v, i) { return '<td><input class="fin2-input fin2-input--sm fin2-celda js-finp-celda" inputmode="numeric" data-i="' + i + '" value="' + (v ? v.toLocaleString('es-CL') : '') + '" aria-label="' + txt(f.cuenta) + ' ' + MESES_L[i] + '"></td>'; }).join('') +
        '<td class="fin2-num fin2-der js-finp-total"><b>' + plata(suma(f.ppto)) + '</b></td>' +
        '<td>' + U.boton({ soloIcono: true, icono: 'copiar', sm: true, variante: 'fantasma', titulo: 'Repetir el primer mes con valor en todo el año', clase: 'js-finp-repetir' }) + '</td></tr>';
    };
    var sec = function (tipo, titulo) {
      return '<tr class="fin2-sec"><td colspan="15">' + titulo + '</td></tr>' + d.filas.filter(function (f) { return f.tipo === tipo; }).map(fila).join('');
    };
    x_.pagina(x_.cab('Presupuesto', controles()) +
      '<div class="fin2-cinta fin2-cinta--info sx2-entra">' + U.ico('info', 16) + '<span>Presupuesto <b>' + d.anio + '</b> de <b>' + txt(d.empresa) + '</b>. Escribe el monto de cada mes (sin IVA en los honorarios, igual que en la contabilidad). ' +
        (d.actualizado ? 'Última modificación: ' + txt(d.actualizado.actualizado_por) + '.' : 'Todavía no se ha cargado.') + '</span></div>' +
      U.card({ sinRelleno: true, cuerpo: '<div class="fin2-tabla-envoltura"><table class="fin2-tabla fin2-ppto-edit"><thead>' + cab + '</thead><tbody>' +
        sec('INGRESO', 'Ingresos') + sec('EGRESO', 'Gastos') + '</tbody></table></div>' +
        '<div class="fin2-acciones" style="padding:0 14px 14px">' + U.boton({ texto: 'Volver a comparar', clase: 'js-finp-cancelar' }) +
          U.boton({ texto: 'Guardar presupuesto', icono: 'check', variante: 'primario', clase: 'js-finp-guardar' }) + '</div>' }));
  }
  function recalcularFila(tr) {
    var tot = 0;
    tr.querySelectorAll('.js-finp-celda').forEach(function (i) { tot += num(i.value); });
    tr.querySelector('.js-finp-total').innerHTML = '<b>' + plata(tot) + '</b>';
  }
  function guardar(b) {
    var lineas = [];
    document.querySelectorAll('.js-finp-fila').forEach(function (tr) {
      var meses = Array.prototype.map.call(tr.querySelectorAll('.js-finp-celda'), function (i) { return num(i.value); });
      if (meses.some(function (v) { return v; })) lineas.push({ tipo: tr.dataset.tipo, cuenta: tr.dataset.cuenta, meses: meses });
    });
    b.disabled = true;
    x_.api('finanzasGuardarPresupuesto', { anio: est_.anio, empresa: est_.empresa, lineas: lineas }).then(function (r) {
      b.disabled = false;
      if (!r || !r.ok) { aviso((r && r.message) || 'No se pudo guardar.'); return; }
      aviso('Presupuesto ' + r.data.anio + ' de ' + r.data.empresa + ' guardado: ingresos ' + plata(r.data.ingresos_anio) + ' y gastos ' + plata(r.data.egresos_anio) + ' en el año.');
      est_.modo = 'comparar'; ver(x_);
    });
  }

  var enlazado_ = false;
  function enlazar() {
    var raiz = x_.raiz();
    if (enlazado_ || !raiz) return;
    enlazado_ = true;
    raiz.addEventListener('change', function (ev) {
      var e = ev.target;
      if (e.classList.contains('js-finp-anio')) { est_.anio = Number(e.value); ver(x_); }
      else if (e.classList.contains('js-finp-emp')) { est_.empresa = e.value; ver(x_); }
      else if (e.classList.contains('js-finp-mes')) { est_.mes = Number(e.value); est_.mesElegido = true; pintarComparar(); }
      else if (e.classList.contains('js-finp-todas')) { est_.todas = e.checked; pintarComparar(); }
    });
    raiz.addEventListener('input', function (ev) { if (ev.target.classList.contains('js-finp-celda')) recalcularFila(ev.target.closest('tr')); });
    raiz.addEventListener('focusout', function (ev) {
      var i = ev.target;
      if (i.classList && i.classList.contains('js-finp-celda')) { var v = num(i.value); i.value = v ? v.toLocaleString('es-CL') : ''; }
    });
    raiz.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      if (b.classList.contains('js-finp-modo') && b.dataset.id) { est_.modo = b.dataset.id; ver(x_); }
      else if (b.classList.contains('js-finp-ir-editar')) { est_.modo = 'editar'; ver(x_); }
      else if (b.classList.contains('js-finp-cancelar')) { est_.modo = 'comparar'; ver(x_); }
      else if (b.classList.contains('js-finp-guardar')) { guardar(b); }
      else if (b.classList.contains('js-finp-repetir')) {
        var tr = b.closest('tr'), celdas = tr.querySelectorAll('.js-finp-celda');
        var base = Array.prototype.map.call(celdas, function (i) { return num(i.value); }).filter(function (v) { return v; })[0] || 0;
        celdas.forEach(function (i) { i.value = base ? base.toLocaleString('es-CL') : ''; });
        recalcularFila(tr);
      }
    });
  }

  window.SigsoFinanzasPresupuesto = { ver: ver };
})();
