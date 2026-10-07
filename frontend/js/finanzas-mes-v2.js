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
  function capital(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

  function ver(x) {
    x_ = x; enlazar();
    var t = x.turno();
    x.pagina(x.cab('El mes') + U.esqueleto('tarjetas', 3));
    x.api('finanzasElMes', { periodo: elegido_ ? periodo_ : '' }).then(function (r) {
      if (!x.vigente(t)) return;
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('El mes') + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || '' }) })); return; }
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
        (p.estado === 'hecho' ? '' : '<p class="fin2m-paso__que">' + txt(p.que) + '</p>') +
        '<p class="fin2m-paso__det">' + txt(p.detalle) + '</p>' + barra(p.avance) +
        (p.estado === 'hecho' ? '' : '<div class="fin2m-paso__acc">' + U.boton({ texto: p.boton, icono: 'derecha', sm: true, variante: p.estado === 'ahora' ? 'primario' : 'secundario', clase: 'js-fin2m-ir', datos: { ir: p.ir } }) + '</div>') +
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
      '<div class="fin2m-grid"><div class="fin2m-principal">' + atras(d.meses_atras || []) + ahora(d) +
        '<ol class="fin2m-pasos">' + d.pasos.map(paso).join('') + '</ol></div>' +
        '<aside class="fin2m-lado">' + fechas(d.fechas) + '</aside></div>');
    if (U.animar) U.animar(x_.raiz());
  }

  var enlazado_ = false;
  function enlazar() {
    var raiz = x_.raiz();
    if (enlazado_ || !raiz) return;
    enlazado_ = true;
    raiz.addEventListener('change', function (ev) {
      if (ev.target.classList.contains('js-fin2m-mes')) { periodo_ = ev.target.value; elegido_ = true; ver(x_); }
    });
    raiz.addEventListener('click', function (ev) {
      var a = ev.target.closest('.js-fin2m-atras');
      if (a) { periodo_ = a.dataset.periodo; elegido_ = true; ver(x_); return; }
      var b = ev.target.closest('.js-fin2m-ir');
      if (!b) return;
      if (b.dataset.ir === 'movimientos' && window.SigsoFinanzasBancos && SigsoFinanzasBancos.periodo) SigsoFinanzasBancos.periodo(periodo_);
      x_.ir(b.dataset.ir);
    });
  }

  window.SigsoFinanzasMes = { ver: ver, periodo: function () { return periodo_; } };
})();
