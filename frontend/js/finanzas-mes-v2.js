/**
 * finanzas-mes-v2.js — Finanzas, Etapa B (2026-10-07): «El mes, paso a paso»
 * (backend/logica/finanzasMes.js). La portada de quien opera: qué toca ahora,
 * el camino completo del mes con su fecha y las fechas que vienen. Todo se
 * calcula solo; nada se marca a mano.
 */
(function () {
  'use strict';

  var U = UIv2;
  var x_ = null;
  var periodo_ = '', elegido_ = false;   // el mes lo propone el servidor hasta que la persona elige otro

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function fechaLarga(iso) {
    var p = String(iso || '').split('-');
    if (p.length !== 3) return '';
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  var cat_ = null, libro_ = null, nombres_ = [];
  function plata(n) { var v = Math.round(Number(n) || 0); return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('es-CL'); }
  function capital(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

  function ver(x) {
    x_ = x; enlazar();
    var t = x.turno();
    x.pagina(x.cab('El mes') + U.esqueleto('tarjetas', 3));
    x.api('finanzasElMes', { periodo: elegido_ ? periodo_ : '' }).then(function (r) {
      if (!x.vigente(t)) return;
      if (r && r.ok) {
        // v3: el cuadre con el banco y los nombres que faltan enseñar, del mismo mes.
        return Promise.all([x.catalogo(), x.api('finanzasLibro', { periodo: r.data.periodo }), x.api('finanzasLibroNombres', { periodo: r.data.periodo })]).then(function (rs) {
          if (!x.vigente(t)) return;
          cat_ = rs[0]; libro_ = rs[1] && rs[1].ok ? rs[1].data : null; nombres_ = rs[2] && rs[2].ok ? rs[2].data.nombres : [];
          periodo_ = r.data.periodo; pintar(r.data);
        });
      }
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('El mes') + U.card({ cuerpo: U.vacio({ accion: '<button type="button" class="sx2-boton sx2-boton--secundario sx2-boton--sm js-fin-reintentar">Reintentar</button>', icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || '' }) })); return; }
      periodo_ = r.data.periodo;
      pintar(r.data);
    });
  }

  function plazo(p, soloFecha) {
    if (!p || !p.texto) return '';
    if (soloFecha) return '<span class="fin2m-plazo">' + U.ico('calendario', 13) + 'Hasta el ' + txt(fechaLarga(p.fecha)) + '</span>';
    var tono = { atrasado: 'critico', hoy: 'alerta', pronto: 'alerta', a_tiempo: 'neutro' }[p.estado] || 'neutro';
    return '<span class="fin2m-plazo sx2-tono-' + tono + '">' + U.ico('calendario', 13) + 'Hasta el ' + txt(fechaLarga(p.fecha)) + ' · ' + txt(p.texto) + '</span>';
  }
  function barra(a) {
    if (!a || !a.total) return '';
    var pct = Math.round(a.n / a.total * 100);
    return '<div class="fin2m-barra" title="' + a.n + ' de ' + a.total + '"><span style="width:' + pct + '%"></span></div>';
  }

  function paso(p, i) {
    var num = p.estado === 'hecho' ? U.ico('check', 16) : String(i + 1);
    return '<li class="fin2m-paso fin2m-paso--' + p.estado + (p.opcional ? ' fin2m-paso--opcional' : '') + ' sx2-entra" style="--i:' + i + '">' +
      '<span class="fin2m-paso__num" aria-hidden="true">' + num + '</span>' +
      '<div class="fin2m-paso__cuerpo">' +
        '<div class="fin2m-paso__cab"><b>' + txt(p.titulo) + '</b>' +
          (p.estado === 'hecho' ? U.badge('Listo', 'ok') : p.estado === 'ahora' ? U.badge('Toca ahora', 'info') : p.opcional ? U.badge('Opcional', 'neutro') : '') +
          plazo(p.plazo, p.estado !== 'ahora') + '</div>' +
        '<p class="fin2m-paso__det">' + txt(p.detalle) + '</p>' + barra(p.avance) +
        (p.estado === 'hecho' || p.estado === 'ahora' ? '' : '<div class="fin2m-paso__acc">' + U.boton({ texto: p.boton, icono: 'derecha', sm: true, variante: 'fantasma', clase: 'js-fin2m-ir', datos: { ir: p.ir } }) + '</div>') +
      '</div></li>';
  }

  function ahora(d) {
    var p = d.pasos.filter(function (q) { return q.id === d.siguiente; })[0];
    if (d.cerrado) return '<div class="fin2m-ahora fin2m-ahora--ok sx2-entra">' + U.ico('candado', 28) + '<div><b>' + txt(capital(d.nombre)) + ' está cerrado.</b><span>Quedó firme: el tablero y los informes de este mes ya no cambian.</span></div></div>';
    if (!p) return '<div class="fin2m-ahora fin2m-ahora--ok sx2-entra">' + U.ico('check', 28) + '<div><b>Todo listo para cerrar ' + txt(d.nombre) + '.</b><span>Revisa el resumen en «Cierre» y ciérralo.</span></div>' +
      U.boton({ texto: 'Ir a cerrar', icono: 'derecha', variante: 'primario', clase: 'js-fin2m-ir', datos: { ir: 'cierre' } }) + '</div>';
    var extra = '';
    if (p.id === 'revisar' && p.conteos) {
      var c = p.conteos;
      extra = '<div class="fin2m-ahora__nums">' +
        (c.seguras ? '<span><b>' + c.seguras + '</b> seguras · se confirman de una vez</span>' : '') +
        (c.con_propuesta ? '<span><b>' + c.con_propuesta + '</b> con propuesta · revisar y confirmar</span>' : '') +
        (c.sin_pista ? '<span><b>' + c.sin_pista + '</b> sin pista · hay que decir qué son</span>' : '') + '</div>';
    }
    return '<div class="fin2m-ahora sx2-entra">' +
      '<span class="fin2m-ahora__eti">Lo que toca ahora</span>' +
      '<h2>' + txt(p.titulo) + '</h2><p>' + txt(p.que) + '</p>' + extra +
      '<div class="fin2m-ahora__pie">' + U.boton({ texto: p.boton, icono: 'derecha', variante: 'primario', clase: 'js-fin2m-ir', datos: { ir: p.ir } }) + plazo(p.plazo) + '</div></div>';
  }

  function atras(l) {
    if (!l.length) return '';
    return '<div class="fin2-cinta sx2-entra">' + U.ico('alerta', 16) + '<span>Quedó algo abierto de antes: ' + l.map(function (m) {
      return '<button type="button" class="fin2-enlace js-fin2m-atras" data-periodo="' + txt(m.periodo) + '">' + txt(m.nombre) + ' (' + m.pendientes + ' por revisar)</button>';
    }).join(', ') + '. Suele ser el borde de una cartola: revísalo cuando puedas.</span></div>';
  }
  function fechas(lista) {
    if (!lista.length) return '';
    return U.card({ titulo: 'Fechas que vienen', icono: 'calendario', cuerpo: '<ul class="fin2m-fechas">' + lista.map(function (f) {
      var tono = f.dias <= 2 ? 'alerta' : 'neutro';
      return '<li><span class="fin2m-fechas__dia sx2-tono-' + tono + '"><b>' + Number(f.fecha.slice(8)) + '</b><small>' + txt(fechaLarga(f.fecha).split(' ').pop()) + '</small></span>' +
        '<span class="fin2m-fechas__txt">' + txt(f.titulo) + '<small>' + (f.dias === 0 ? 'hoy' : f.dias === 1 ? 'mañana' : 'en ' + f.dias + ' días') + (f.tipo === 'clientes' ? ' · de los clientes' : ' · nuestro') + '</small></span></li>';
    }).join('') + '</ul>' }) +
    U.card({ titulo: 'Así se trabaja cada mes', icono: 'bombilla', cuerpo:
      '<ol class="fin2m-guia"><li>Del 1 al 3: bajar del banco la cartola y «Mis Movimientos» del mes que terminó y subirlos.</li>' +
      '<li>Hasta el 5: revisar los movimientos (las seguras se confirman de una vez) y cerrar el mes.</li>' +
      '<li>Antes del 10 y del 20: mirar en Bancos que la plata de los clientes para Previred e IVA haya llegado.</li></ol>' });
  }

  function pintar(d) {
    var oblig = d.pasos.filter(function (p) { return !p.opcional; });
    var hechos = oblig.filter(function (p) { return p.estado === 'hecho'; }).length;
    var sel = '<select class="fin2-input fin2-input--sm js-fin2m-mes" aria-label="Mes">' + d.periodos.map(function (p) {
      return '<option value="' + txt(p.periodo) + '"' + (p.periodo === d.periodo ? ' selected' : '') + '>' + txt(capital(p.nombre)) + (p.cerrado ? ' · cerrado' : '') + '</option>';
    }).join('') + '</select>';
    x_.pagina(x_.cab('El mes') +
      '<div class="fin2m-cab sx2-entra"><div><span class="fin2m-cab__eti">Trabajando en</span>' + sel + '</div>' +
        '<div class="fin2m-cab__avance">' + U.anillo(Math.round(hechos / oblig.length * 100), { tam: 52, texto: hechos + '/' + oblig.length }) +
        '<span>pasos listos<br><small>hoy es ' + txt(fechaLarga(d.hoy)) + '</small></span></div></div>' +
      '<div class="fin2m-grid"><div class="fin2m-principal">' + atras(d.meses_atras || []) + cuadreMes() + ahora(d) + nombresCard() +
        '<ol class="fin2m-pasos">' + d.pasos.map(paso).join('') + '</ol></div>' +
        '<aside class="fin2m-lado">' + fechas(d.fechas) + '</aside></div>');
    if (U.animar) U.animar(x_.raiz());
  }

  // ---- v3: el banco del mes (resumen con las palabras del Excel BANCOS) ---------------------
  function cuadreMes() {
    var l = libro_; if (!l || !l.lineas.length) return '';
    var entra = 0, sale = 0; l.lineas.forEach(function (x) { if (x.monto > 0) entra += x.monto; else sale += x.monto; });
    var c = l.cartola, ok = c && Math.round(c.saldo_inicial + entra + sale) === Math.round(c.saldo_final);
    var r = l.resumen, fb = l.fuera_banco.resumen;
    var porRevisar = l.lineas.filter(function (x) { return x.estado !== 'CONFIRMADO'; }).length;
    return '<section class="fin3-mes sx2-entra"><div class="fin3-mes__cab"><b>' + U.ico('dinero', 18) + ' El banco este mes</b>' +
        (l.sin_cartola && !l.verificados ? U.badge('Sin cartola: viene de la planilla, sin verificar', 'alerta') : ok ? U.badge('Cuadra con la cartola', 'ok') : U.badge('No cuadra con la cartola', 'critico')) +
        '<button type="button" class="sx2-enlace js-fin2m-ir" data-ir="libro">Abrir el libro →</button></div>' +
      '<div class="fin3-mes__nums">' +
        '<div><span>Entró</span><b class="fin2-pos">' + plata(entra) + '</b></div><div><span>Salió</span><b class="fin2-neg">' + plata(-sale) + '</b></div>' +
        (c ? '<div><span>Saldo final</span><b>' + plata(c.saldo_final) + '</b></div>' : '') +
        '<div><span>Honorarios</span><b>' + plata(r.ABONO + r['ABONO RENTA'] + (fb.ABONO || 0) + (fb['ABONO RENTA'] || 0)) + '</b></div>' +
        '<div><span>Gastos</span><b>' + plata(r.GASTO) + '</b></div>' +
        '<div><span>Fondos de clientes</span><b>' + plata(r.FONDOS + (fb.FONDOS || 0)) + '</b></div>' +
        '<div class="' + (porRevisar ? 'fin3-mes__alerta' : '') + '"><span>Por revisar</span><b>' + porRevisar + '</b></div>' +
      '</div></section>';
  }

  // ---- v3: nombres cortos de la planilla que SIGSO no conoce todavía (se enseñan una vez) ----
  function nombresCard() {
    if (!nombres_ || !nombres_.length) return '';
    var clientes = (cat_ && cat_.clientes) || [];
    var gastos = ((cat_ && cat_.tipos) || []).filter(function (t) { return t.id === 'EGRESO'; })[0];
    var filas = nombres_.reduce(function (t, n) { return t + n.filas; }, 0);
    return '<details class="fin3-nombres sx2-entra"><summary class="fin3-mes__cab"><b>' + U.ico('persona', 18) + ' ' + nombres_.length + ' nombre(s) de la planilla por enseñar · ' + filas + ' fila(s)</b>' +
      '<span class="fin2-ayuda">Ábrelo para decir de quién es cada uno. Se enseña una sola vez: después SIGSO clasifica solo esas filas (y las de los meses que vienen).</span></summary>' +
      '<datalist id="fin3m-clientes">' + clientes.map(function (c) { return '<option value="' + txt(c.nombre) + '">' + txt(c.rut) + '</option>'; }).join('') + '</datalist>' +
      '<div class="fin2-tabla-envoltura"><table class="fin2-tabla fin2-tabla--chica fin3-nombres__t"><thead><tr><th>Nombre en la planilla</th><th>Filas</th><th>Quién pagó (banco)</th><th>Es…</th></tr></thead><tbody>' +
      nombres_.map(function (n, i) {
        var prop = n.propuesta_clara ? n.candidatos[0] : null;
        var clase = n.empresa ? 'empresa' : prop ? 'cliente' : '';
        return '<tr data-i="' + i + '"><td><b>' + txt(n.alias) + '</b><small class="fin2-ayuda"> ' + txt(n.obs.join(', ')) + '</small></td><td class="fin2-num">' + n.filas + '<small class="fin2-ayuda"> · ' + plata(n.entra - n.sale) + '</small></td>' +
          '<td><small>' + txt(n.quien_paga.join(' · ') || '—') + '</small></td>' +
          '<td class="fin3-nombres__que"><select class="fin2-input fin2-input--sm js-fin3m-clase" aria-label="Qué es «' + txt(n.alias) + '»">' +
            '<option value="">Decidir después</option><option value="cliente"' + (clase === 'cliente' ? ' selected' : '') + '>Un cliente</option><option value="empresa"' + (clase === 'empresa' ? ' selected' : '') + '>Empresa del grupo</option>' +
            '<option value="gasto">Gasto de la empresa</option><option value="ignorar">Nadie (ignorar)</option></select>' +
          '<input class="fin2-input fin2-input--sm js-fin3m-cliente" list="fin3m-clientes" placeholder="Cliente" value="' + txt(prop ? prop.nombre : '') + '"' + (clase === 'cliente' ? '' : ' hidden') + '>' +
          '<select class="fin2-input fin2-input--sm js-fin3m-empresa"' + (clase === 'empresa' ? '' : ' hidden') + '>' + ((cat_ && cat_.empresas) || []).map(function (e) { return '<option' + (e === n.empresa ? ' selected' : '') + '>' + txt(e) + '</option>'; }).join('') + '</select>' +
          '<select class="fin2-input fin2-input--sm js-fin3m-gasto" hidden>' + ((gastos && gastos.cuentas) || []).map(function (c) { return '<option>' + txt(c) + '</option>'; }).join('') + '</select>' +
          (prop ? '<small class="fin2-ayuda">propuesto por parecido: confírmalo</small>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="fin2-acciones">' + U.boton({ texto: 'Guardar y clasificar esas filas', icono: 'check', variante: 'primario', sm: true, clase: 'js-fin3m-ensenar', datos: { cap: 'REGLAS' } }) + '</div></details>';
  }
  function campos(tr) {
    var c = tr.querySelector('.js-fin3m-clase').value;
    tr.querySelector('.js-fin3m-cliente').hidden = c !== 'cliente';
    tr.querySelector('.js-fin3m-empresa').hidden = c !== 'empresa';
    tr.querySelector('.js-fin3m-gasto').hidden = c !== 'gasto';
  }
  function ensenar(btn) {
    var lista = [], err = '';
    x_.raiz().querySelectorAll('.fin3-nombres__t tbody tr').forEach(function (tr) {
      var n = nombres_[Number(tr.dataset.i)], c = tr.querySelector('.js-fin3m-clase').value;
      if (!c) return;
      var it = { alias: n.alias, clase: c };
      if (c === 'cliente') {
        var v = tr.querySelector('.js-fin3m-cliente').value.trim();
        var cli = ((cat_ && cat_.clientes) || []).filter(function (k) { return k.nombre === v || k.rut === v; })[0];
        if (!cli) { err = err || 'Elige de la lista el cliente de «' + n.alias + '».'; return; }
        it.cliente_id = cli.id;
      }
      if (c === 'empresa') it.empresa = tr.querySelector('.js-fin3m-empresa').value;
      if (c === 'gasto') it.cuenta = tr.querySelector('.js-fin3m-gasto').value;
      lista.push(it);
    });
    if (err) { x_.aviso(err, 'error'); return; }
    if (!lista.length) { x_.aviso('No hay nada decidido todavía.', 'alerta'); return; }
    btn.disabled = true;
    x_.api('finanzasGuardarNombres', { alias: lista }).then(function (r) {
      if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo guardar.', 'error'); btn.disabled = false; return; }
      return x_.api('finanzasLibroReaplicar', { periodo: periodo_ }).then(function (q) {
        x_.aviso(r.data.guardados + ' nombre(s) enseñados · ' + ((q && q.ok && q.data.clasificadas) || 0) + ' fila(s) clasificadas.', 'exito');
        ver(x_);
      });
    });
  }

  var enlazado_ = false;
  function enlazar() {
    var raiz = x_.raiz();
    if (enlazado_ || !raiz) return;
    enlazado_ = true;
    raiz.addEventListener('change', function (ev) {
      if (ev.target.classList.contains('js-fin2m-mes')) { periodo_ = ev.target.value; elegido_ = true; ver(x_); }
      if (ev.target.classList.contains('js-fin3m-clase')) campos(ev.target.closest('tr'));
    });
    raiz.addEventListener('click', function (ev) {
      var a = ev.target.closest('.js-fin2m-atras');
      if (a) { periodo_ = a.dataset.periodo; elegido_ = true; ver(x_); return; }
      var e3 = ev.target.closest('.js-fin3m-ensenar'); if (e3) { ensenar(e3); return; }
      var b = ev.target.closest('.js-fin2m-ir');
      if (!b) return;
      if (b.dataset.ir === 'libro') x_.contexto({ periodo_libro: periodo_ });
      x_.ir(b.dataset.ir);
    });
  }

  window.SigsoFinanzasMes = { ver: ver, periodo: function () { return periodo_; } };
})();
