/**
 * finanzas-conciliacion-v2.js — Conciliación banco ↔ registro (2026-10-20;
 * FIN-19 y prueba T28; corrección v2 I01/I02; backend/logica/finanzasConciliacion.js).
 *
 * Una operación registrada a mano y el movimiento que después trae la
 * cartola son el MISMO dinero: vincularlos no duplica nada (la operación
 * deja de contar sola y cuenta por el banco, con la clasificación que ya
 * tenía). Cada vínculo lleva un IMPORTE:
 *  - Exacto (uno contra uno, uno contra varios, varios contra uno): directo.
 *  - Parcial o varios contra varios: «Indicar importes» abre una tabla
 *    movimiento × operación con lo disponible de cada lado; nada se reparte a
 *    ciegas y el resto queda pendiente (no se inventa un ajuste).
 *  - Posibles duplicados (registro ↔ movimiento ya clasificado) aparte, con
 *    «Es el mismo: vincular» y «Son distintos».
 * Lo sugerido nunca se concilia solo: la persona revisa y acepta.
 */
(function () {
  'use strict';

  var U = UIv2;
  var x_ = null;
  var est_ = { periodo: '', dias: 0, d: null, movs: {}, ops: {} };
  // I12.2/I12.4: al cerrarse la bóveda, la pantalla olvida las cifras que tenía cargadas.
  document.addEventListener('sigso-fin-cerrada', function () { est_.d = null; est_.movs = {}; est_.ops = {}; });

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function plata(n) { var v = Math.round(Number(n) || 0); return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('es-CL'); }
  function montoDe(v) { var s = String(v || '').replace(/[^0-9]/g, ''); return s ? Number(s) : 0; }
  function hoyIso() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
  function uuid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); }
  function mov(id) { return est_.d.movimientos.filter(function (m) { return m.id === id; })[0]; }
  function op(id) { return est_.d.operaciones.filter(function (o) { return o.id === id; })[0]; }
  function montoMov(m) { return m.abono || m.cargo; }
  function dispMov(m) { return m.disponible !== undefined ? m.disponible : montoMov(m); }
  function dispOp(o) { return o.disponible !== undefined ? o.disponible : o.monto; }
  function resumenOp(o) { return (o.distribuciones || []).map(function (p) { return [p.cuenta, p.cliente].filter(Boolean).join(' · '); }).join(' + '); }
  function marcados(mapa) { return Object.keys(mapa).filter(function (k) { return mapa[k]; }); }

  function ver(x) {
    x_ = x; enlazar();
    var c = x.contexto();
    est_.periodo = c.periodo || est_.periodo || hoyIso().slice(0, 7);
    est_.movs = {}; est_.ops = {};
    var t = x.turno();
    x.pagina(x.cab('conciliacion') + U.esqueleto('tabla', 8));
    x.api('finanzasConciliacion', { periodo: est_.periodo, dias: est_.dias || undefined }).then(function (r) {
      if (!x.vigente(t)) return;
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('conciliacion') + U.card({ cuerpo: U.vacio({ accion: '<button type="button" class="sx2-boton sx2-boton--secundario sx2-boton--sm js-fin-reintentar">Reintentar</button>', icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || '' }) })); return; }
      est_.d = r.data;
      pintar();
    });
  }

  function pintar() {
    var d = est_.d;
    var sm = marcados(est_.movs), so = marcados(est_.ops);
    var tm = sm.reduce(function (s, id) { var m = mov(id); return s + (m ? dispMov(m) : 0); }, 0), to = so.reduce(function (s, id) { var o = op(id); return s + (o ? dispOp(o) : 0); }, 0);
    // I01: un par cuyo movimiento ya estaba clasificado es un POSIBLE DUPLICADO (se muestra aparte).
    var sug = d.sugeridas.filter(function (s) { return !esDuplicado(s); });
    var exacto = sm.length && so.length && !(sm.length > 1 && so.length > 1) && tm === to;
    var hayAmbos = sm.length && so.length;
    var motivo = !hayAmbos ? 'Marca al menos un movimiento del banco y una operación.' : exacto ? 'Cuadra exacto.' :
      (sm.length > 1 && so.length > 1 ? 'Varios contra varios: indica cuánto va de cada movimiento a cada operación.' : 'No cuadra (diferencia ' + plata(tm - to) + '): si es un pago parcial, indica los importes; el resto queda pendiente.');
    x_.pagina(x_.cab('conciliacion', U.boton({ texto: 'Revisar y aceptar sugeridas (' + sug.length + ')', icono: 'check', sm: true, variante: 'primario', clase: 'js-finc-todas', datos: { cap: 'CONCILIAR' }, deshabilitado: !sug.length })) +
      '<div class="fin2-ctx sx2-entra"><label class="fin2-campo fin2-campo--fila"><span>Mes</span><input type="month" class="fin2-input fin2-input--sm js-finc-mes" value="' + txt(est_.periodo) + '"></label>' +
        '<label class="fin2-campo fin2-campo--fila"><span>Buscar a ±</span><select class="fin2-input fin2-input--sm js-finc-dias">' + [10, 20, 30, 45, 60, 90].map(function (n) { return '<option value="' + n + '"' + (n === (d.dias || 10) ? ' selected' : '') + '>' + n + ' días</option>'; }).join('') + '</select></label>' +
        '<span class="fin2-ayuda">Amplía la búsqueda si un pago llegó con demora. ' + d.conciliados_total + ' movimiento(s) ya conciliados en total.</span></div>' +
      seccionDuplicados(d) +
      (sug.length ? U.card({ titulo: 'Sugeridas', icono: 'destello', sub: sug.length + ' par(es) con monto exacto y sin empate', cuerpo: '<ul class="fin2-sug">' + d.sugeridas.map(function (s, i) {
        var m = mov(s.movimiento_id), o = op(s.operacion_id);
        if (!m || !o || esDuplicado(s)) return '';
        return '<li class="fin2-sug__item"><div class="fin2-sug__lado"><small>Banco · ' + txt(m.cuenta.banco + ' ···' + m.cuenta.ultimos4) + '</small><b>' + txt(m.fecha) + ' · ' + plata(dispMov(m)) + '</b><span>' + txt(m.glosa) + '</span></div>' +
          '<span class="fin2-sug__igual" aria-hidden="true">' + U.ico('enlace', 16) + '</span>' +
          '<div class="fin2-sug__lado"><small>Registro</small><b>' + txt(o.fecha) + ' · ' + plata(dispOp(o)) + '</b><span>' + txt(o.tercero || '') + ' · ' + txt(resumenOp(o)) + '</span></div>' +
          '<div class="fin2-sug__acc"><span class="fin2-ayuda">' + txt(s.motivos.join(' · ')) + '</span>' + U.boton({ texto: 'Conciliar', icono: 'check', sm: true, clase: 'js-finc-una', datos: { i: i, cap: 'CONCILIAR' } }) + '</div></li>';
      }).join('') + '</ul>' }) : '') +
      '<div class="fin2-conc">' +
        U.card({ titulo: 'Banco por vincular', icono: 'caja', sub: d.movimientos.length + ' movimiento(s)', cuerpo: lista(d.movimientos.map(function (m) {
          return { id: m.id, tipo: 'mov', fecha: m.fecha, monto: dispMov(m), total: montoMov(m), entra: m.abono > 0, titulo: m.glosa,
            sub: m.cuenta.banco + ' ···' + m.cuenta.ultimos4 + ' · ' + (m.parcial ? 'vinculado en parte' : m.estado === 'CONFIRMADO' ? 'ya clasificado' : 'por revisar'), sel: est_.movs[m.id] };
        }), 'Sin movimientos por vincular en este mes.') }) +
        U.card({ titulo: 'Registro sin banco', icono: 'tabla', sub: d.operaciones.length + ' operación(es) confirmadas', cuerpo: lista(d.operaciones.map(function (o) {
          return { id: o.id, tipo: 'op', fecha: o.fecha, monto: dispOp(o), total: o.monto, entra: o.sentido === 'ENTRADA', titulo: o.tercero || resumenOp(o) || '—',
            sub: o.empresa + ' · ' + resumenOp(o) + (o.conciliacion === 'PARCIAL' ? ' · vinculada en parte' : ''), sel: est_.ops[o.id] };
        }), 'Todo lo registrado ya tiene su movimiento del banco.') }) +
      '</div>' +
      '<div class="fin2-conc__barra' + (exacto ? ' fin2-conc__barra--ok' : '') + '" role="status"><span>Banco <b>' + plata(tm) + '</b> (' + sm.length + ') · Registro <b>' + plata(to) + '</b> (' + so.length + ')</span><span class="fin2-ayuda">' + txt(motivo) + '</span>' +
        (hayAmbos && !exacto ? U.boton({ texto: 'Indicar importes…', icono: 'editar', sm: true, clase: 'js-finc-importes', datos: { cap: 'CONCILIAR' } }) : '') +
        U.boton({ texto: 'Vincular lo marcado', icono: 'enlace', variante: 'primario', sm: true, clase: 'js-finc-manual', datos: { cap: 'CONCILIAR' }, deshabilitado: !exacto }) + '</div>');
  }
  function esDuplicado(s) { return (est_.d.conflictos || []).some(function (c) { return c.operacion_id === s.operacion_id && c.movimientos.indexOf(s.movimiento_id) !== -1; }); }
  /** Posibles duplicados (I01): operación registrada ↔ movimiento del banco que alguien ya clasificó por su cuenta. */
  function seccionDuplicados(d) {
    var l = d.conflictos || [];
    if (!l.length) return '';
    return U.card({ titulo: 'Posibles duplicados', icono: 'alerta', sub: 'lo registrado y el banco podrían ser el mismo dinero', clase: 'fin2-dup-card', cuerpo:
      '<p class="fin2-ayuda">Mientras no se decida, las cifras cuentan el movimiento del banco y la operación registrada queda aparte. Si son el mismo dinero, vincúlalos; si son pagos distintos (iguales por casualidad), márcalo y contarán los dos.</p>' +
      '<ul class="fin2-sug">' + l.map(function (c) {
        var o = op(c.operacion_id);
        return c.movimientos.map(function (mid) {
          var m = mov(mid);
          if (!o || !m) return '';
          return '<li class="fin2-sug__item"><div class="fin2-sug__lado"><small>Banco · ya clasificado · ' + txt(m.cuenta.banco + ' ···' + m.cuenta.ultimos4) + '</small><b>' + txt(m.fecha) + ' · ' + plata(montoMov(m)) + '</b><span>' + txt(m.glosa) + '</span></div>' +
            '<span class="fin2-sug__igual" aria-hidden="true">' + U.ico('alerta', 16) + '</span>' +
            '<div class="fin2-sug__lado"><small>Registro</small><b>' + txt(o.fecha) + ' · ' + plata(o.monto) + '</b><span>' + txt(o.tercero || '') + ' · ' + txt(resumenOp(o)) + '</span></div>' +
            '<div class="fin2-sug__acc" data-cap="CONCILIAR">' + U.boton({ texto: 'Es el mismo: vincular', icono: 'enlace', sm: true, variante: 'primario', clase: 'js-finc-dup-vincular', datos: { m: mid, o: c.operacion_id } }) +
              U.boton({ texto: 'Son distintos', sm: true, clase: 'js-finc-dup-distintas', datos: { m: mid, o: c.operacion_id } }) + '</div></li>';
        }).join('');
      }).join('') + '</ul>' });
  }
  function lista(items, vacio) {
    if (!items.length) return U.vacio({ icono: 'check', texto: vacio });
    return '<ul class="fin2-conc__lista">' + items.map(function (it) {
      return '<li><label class="fin2-conc__item' + (it.sel ? ' fin2-conc__item--sel' : '') + '"><input type="checkbox" class="js-finc-sel" data-tipo="' + it.tipo + '" data-id="' + txt(it.id) + '"' + (it.sel ? ' checked' : '') + '>' +
        '<span class="fin2-num">' + txt(it.fecha) + '</span><span class="fin2-conc__txt"><b>' + txt(it.titulo) + '</b><small>' + txt(it.sub) + '</small></span>' +
        '<b class="fin2-num ' + (it.entra ? 'fin2-pos' : '') + '">' + (it.entra ? '' : '−') + plata(it.monto) + (it.total !== it.monto ? '<small class="fin2-ayuda"> de ' + plata(it.total) + '</small>' : '') + '</b></label></li>';
    }).join('') + '</ul>';
  }
  function conciliar(movIds, opIds) {
    return x_.api('finanzasConciliar', { idempotency_key: uuid(),
      movimientos: movIds.map(function (id) { var m = mov(id); return { id: id, expected_version: m ? m.version : undefined }; }),
      operaciones: opIds.map(function (id) { var o = op(id); return { id: id, expected_version: o ? o.version : undefined }; }) });
  }

  // ---- importes explícitos (parcial y varios contra varios) --------------------------------
  function abrirImportes() {
    var sm = marcados(est_.movs).map(mov).filter(Boolean), so = marcados(est_.ops).map(op).filter(Boolean);
    // Propuesta inicial: llena cada operación con los movimientos en orden, sin pasarse de lo disponible.
    var resto = sm.map(dispMov), prop = {};
    so.forEach(function (o) {
      var falta = dispOp(o);
      sm.forEach(function (m, i) { var v = Math.min(falta, resto[i]); if (v > 0) { prop[m.id + '|' + o.id] = v; falta -= v; resto[i] -= v; } });
    });
    var celda = function (m, o) { var v = prop[m.id + '|' + o.id] || 0; return '<td><input class="fin2-input fin2-input--sm fin2-der js-fca-celda" inputmode="numeric" data-m="' + txt(m.id) + '" data-o="' + txt(o.id) + '" value="' + (v ? v.toLocaleString('es-CL') : '') + '" aria-label="Del movimiento ' + txt(m.fecha) + ' a la operación ' + txt(o.tercero || o.fecha) + '"></td>'; };
    var d = U.drawer({ titulo: 'Indicar importes', subtitulo: '<span class="fin2-ayuda">Cuánto de cada movimiento del banco corresponde a cada operación. Lo que no asignes queda pendiente.</span>',
      cuerpo: '<div class="fin2-p"><div class="fin2-tabla-envoltura"><table class="fin2-tabla fin2-asig"><thead><tr><th>Banco ↓ · Registro →</th>' + so.map(function (o) {
          return '<th class="fin2-der">' + txt(o.fecha) + '<br>' + txt(o.tercero || resumenOp(o)) + '<br><small>disponible ' + plata(dispOp(o)) + '</small></th>';
        }).join('') + '<th class="fin2-der">Queda del movimiento</th></tr></thead><tbody>' + sm.map(function (m) {
          return '<tr><th>' + txt(m.fecha) + ' · ' + txt(m.glosa) + '<br><small>disponible ' + plata(dispMov(m)) + '</small></th>' + so.map(function (o) { return celda(m, o); }).join('') + '<td class="fin2-der fin2-num js-fca-resto-m" data-m="' + txt(m.id) + '"></td></tr>';
        }).join('') + '<tr class="fin2-tot"><th>Queda de la operación</th>' + so.map(function (o) { return '<td class="fin2-der fin2-num js-fca-resto-o" data-o="' + txt(o.id) + '"></td>'; }).join('') + '<td></td></tr></tbody></table></div>' +
        '<p class="fin2-ayuda js-fca-msg" aria-live="polite"></p></div>',
      pie: '<span style="flex:1"></span>' + U.boton({ texto: 'Vincular estos importes', icono: 'enlace', variante: 'primario', clase: 'js-fca-ok' }) });
    d.el.classList.add('fin2-panel', 'sx2-drawer--ancho');
    var recalcular = function () {
      var asig = [], err = '';
      var porM = {}, porO = {};
      d.el.querySelectorAll('.js-fca-celda').forEach(function (i) { var v = montoDe(i.value); if (v) { asig.push({ movimiento_id: i.dataset.m, operacion_id: i.dataset.o, monto: v }); porM[i.dataset.m] = (porM[i.dataset.m] || 0) + v; porO[i.dataset.o] = (porO[i.dataset.o] || 0) + v; } });
      sm.forEach(function (m) { var q = dispMov(m) - (porM[m.id] || 0); var c = d.el.querySelector('.js-fca-resto-m[data-m="' + m.id + '"]'); c.textContent = plata(q); c.className = 'fin2-der fin2-num js-fca-resto-m' + (q < 0 ? ' fin2-neg' : ''); if (q < 0) err = 'Un movimiento quedó con más de lo que tiene.'; });
      so.forEach(function (o) { var q = dispOp(o) - (porO[o.id] || 0); var c = d.el.querySelector('.js-fca-resto-o[data-o="' + o.id + '"]'); c.textContent = plata(q); c.className = 'fin2-der fin2-num js-fca-resto-o' + (q < 0 ? ' fin2-neg' : ''); if (q < 0) err = 'Una operación quedó con más de lo que le falta.'; });
      var total = asig.reduce(function (s, a) { return s + a.monto; }, 0);
      d.el.querySelector('.js-fca-msg').innerHTML = err ? '<span class="fin2-neg">' + txt(err) + '</span>' : asig.length ? 'Se vincularán <b>' + plata(total) + '</b> en ' + asig.length + ' vínculo(s). Lo que queda sigue pendiente, a la vista.' : 'Escribe al menos un importe.';
      d.el.querySelector('.js-fca-ok').disabled = !!err || !asig.length;
      return asig;
    };
    d.el.addEventListener('input', function (ev) { if (ev.target.classList.contains('js-fca-celda')) recalcular(); });
    d.el.addEventListener('focusout', function (ev) { if (ev.target.classList.contains('js-fca-celda')) { var v = montoDe(ev.target.value); ev.target.value = v ? v.toLocaleString('es-CL') : ''; } });
    d.el.addEventListener('click', function (ev) {
      var b = ev.target.closest('.js-fca-ok'); if (!b) return;
      var asig = recalcular(); if (!asig.length) return;
      b.disabled = true;
      x_.api('finanzasConciliar', { idempotency_key: uuid(), asignaciones: asig,
        movimientos: sm.map(function (m) { return { id: m.id, expected_version: m.version }; }), operaciones: so.map(function (o) { return { id: o.id, expected_version: o.version }; }) }).then(function (r) {
        b.disabled = false;
        if (!r || !r.ok) { d.el.querySelector('.js-fca-msg').innerHTML = '<span class="fin2-neg">' + txt((r && r.message) || 'No se pudo vincular.') + '</span>'; return; }
        var parciales = (r.data.estados || []).filter(function (e) { return e.conciliacion === 'PARCIAL'; });
        x_.aviso('Vinculado ' + plata(r.data.monto) + (parciales.length ? ' · ' + parciales.length + ' operación(es) quedan en parte (falta ' + plata(parciales.reduce(function (s, e) { return s + e.pendiente; }, 0)) + ')' : '') + '.', 'exito');
        d.cerrar(); ver(x_);
      });
    });
    recalcular();
  }

  var enlazado_ = false;
  function enlazar() {
    var raiz = x_.raiz();
    if (enlazado_ || !raiz) return;
    enlazado_ = true;
    raiz.addEventListener('change', function (ev) {
      var t = ev.target;
      if (!raiz.querySelector('.fin2-conc')) return;
      if (t.classList.contains('js-finc-mes') && /^\d{4}-\d{2}$/.test(t.value)) { x_.contexto({ periodo: t.value }); est_.periodo = t.value; ver(x_); }
      else if (t.classList.contains('js-finc-dias')) { est_.dias = Number(t.value); ver(x_); }
      else if (t.classList.contains('js-finc-sel')) { (t.dataset.tipo === 'mov' ? est_.movs : est_.ops)[t.dataset.id] = t.checked; var y = window.scrollY; pintar(); window.scrollTo(0, y); }
    });
    raiz.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b || !raiz.querySelector('.fin2-conc')) return;
      if (b.classList.contains('js-finc-dup-vincular')) {
        conciliar([b.dataset.m], [b.dataset.o]).then(function (r) { if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo.', 'error'); return; } x_.aviso('Vinculado: es un solo hecho.', 'exito'); ver(x_); });
      } else if (b.classList.contains('js-finc-dup-distintas')) {
        var o2 = op(b.dataset.o);
        U.formulario({ titulo: 'Son pagos distintos', boton: 'Guardar decisión', campos: U.campo('Por qué son distintos', '<input name="motivo" class="sx2-input" required maxlength="300">', 'Desde ahora cuentan los dos. Queda en la historia de la operación.'),
          enviar: function (dd) { return x_.api('finanzasMarcarDistintas', { operacion_id: b.dataset.o, movimiento_id: b.dataset.m, expected_version: o2 ? o2.version : undefined, motivo: dd.motivo }); },
          aviso: 'Decisión guardada.', listo: function () { ver(x_); } });
      } else if (b.classList.contains('js-finc-una')) {
        var s = est_.d.sugeridas[Number(b.dataset.i)];
        b.disabled = true;
        conciliar([s.movimiento_id], [s.operacion_id]).then(function (r) { if (!r || !r.ok) { b.disabled = false; x_.aviso((r && r.message) || 'No se pudo.', 'error'); return; } x_.aviso('Conciliado.', 'exito'); ver(x_); });
      } else if (b.classList.contains('js-finc-importes')) abrirImportes();
      else if (b.classList.contains('js-finc-manual')) {
        var sm = marcados(est_.movs), so = marcados(est_.ops);
        U.confirmar({ titulo: 'Vincular ' + sm.length + ' movimiento(s) con ' + so.length + ' operación(es)', texto: 'El movimiento del banco toma la clasificación de lo registrado y la operación deja de contar sola. Se puede deshacer con motivo.', boton: 'Vincular' }).then(function (si) {
          if (!si) return;
          conciliar(sm, so).then(function (r) { if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo.', 'error'); return; } x_.aviso('Conciliado.', 'exito'); ver(x_); });
        });
      } else if (b.classList.contains('js-finc-todas')) {
        var l = est_.d.sugeridas.filter(function (s2) { return !esDuplicado(s2); });
        var total = l.reduce(function (t2, s2) { var m = mov(s2.movimiento_id); return t2 + (m ? dispMov(m) : 0); }, 0);
        U.confirmar({ titulo: 'Aceptar ' + l.length + ' sugerencia(s) por ' + plata(total), texto: l.map(function (s2) { var m = mov(s2.movimiento_id), o = op(s2.operacion_id); return (m ? m.fecha + ' ' + plata(dispMov(m)) + ' ' + m.glosa : '') + ' ↔ ' + (o ? (o.tercero || '') : ''); }).slice(0, 8).join(' · ') + (l.length > 8 ? ' · …' : '') + '. Cada par se concilia por separado y el servidor vuelve a validar versiones y montos: si uno cambió, se salta y se avisa.', boton: 'Aceptar estas' }).then(function (si) {
          if (!si) return;
          var ok = 0, mal = 0;
          l.reduce(function (p, s2) { return p.then(function () { return conciliar([s2.movimiento_id], [s2.operacion_id]).then(function (r) { if (r && r.ok) ok++; else mal++; }); }); }, Promise.resolve())
            .then(function () { x_.aviso(ok + ' conciliada(s)' + (mal ? ' · ' + mal + ' no (revísalas a mano)' : ''), mal ? 'alerta' : 'exito'); ver(x_); });
        });
      }
    });
  }

  window.SigsoFinanzasConciliacion = { ver: ver };
})();
