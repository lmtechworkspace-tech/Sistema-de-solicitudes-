/**
 * finanzas-cobranza-v2.js — Finanzas, Etapa 3: facturas y cobranza
 * (2026-10-06; backend/logica/finanzasCobranza.js). Vista «Cobranza» dentro
 * de la bóveda (la monta finanzas-v2.js):
 *
 *  - Cuánto falta por cobrar, cuánto está vencido y desde hace cuánto.
 *  - Clientes ordenados por lo vencido; cada uno abre su cuenta corriente
 *    (facturas con lo que falta de cada una y sus pagos).
 *  - Subir el Registro de Ventas del SII (CSV o .gz) o traer la hoja FACTURAS
 *    de la planilla SIGECO.
 * Los pagos no se vinculan a mano: los del banco cubren las facturas del
 * cliente de la más antigua a la más nueva.
 */
(function () {
  'use strict';

  var U = UIv2;
  var x_ = null;
  var est_ = { datos: null, filtro: 'deuda', busca: '', ficha: null, ventas: null, editando: '' };
  var EMPRESAS = ['HomePymes', 'Homeconsulting', 'HomePrevise', 'GDE', 'RLD', 'Virtual Base'];
  var TONO_SIT = { Pagada: 'ok', 'Pago parcial': 'alerta', Vencida: 'critico', 'Por vencer': 'info', Incobrable: 'neutro' };

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function plata(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('es-CL'); }
  function corta(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '-' + p[1] + '-' + p[0].slice(2) : ''; }
  var avisoT_ = null;
  function aviso(msg) {
    var el = document.getElementById('fin2-toast');
    if (!el) { el = document.createElement('div'); el.id = 'fin2-toast'; el.className = 'fin2-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('fin2-toast--on');
    clearTimeout(avisoT_); avisoT_ = setTimeout(function () { el.classList.remove('fin2-toast--on'); }, 4500);
  }

  // =====================================================================================
  function ver(x) {
    x_ = x; enlazar();
    if (est_.ficha) return verFicha(est_.ficha);
    var t = x.turno();
    x.pagina(x.cab('Cobranza') + U.esqueleto('kpis', 5));
    x.api('finanzasCobranza').then(function (r) {
      if (!x.vigente(t)) return;
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('Cobranza') + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: r.message || '' }) })); return; }
      est_.datos = r.data;
      pintar();
    });
  }

  function antiguedad(tramos) {
    var total = tramos.reduce(function (s, t) { return s + t.monto; }, 0);
    var colores = ['var(--sx-ok)', 'var(--fin2-a1)', 'var(--fin2-a2)', 'var(--fin2-a3)', 'var(--sx-critico)'];
    if (!total) return U.vacio({ icono: 'check', titulo: 'Nada por cobrar', texto: 'Todas las facturas están pagadas.' });
    return '<div class="fin2-antig" role="img" aria-label="Antigüedad de lo que falta por cobrar">' + tramos.map(function (t, i) {
      return t.monto ? '<i style="flex:' + t.monto + ';background:' + colores[i] + '" title="' + txt(t.nombre) + ': ' + plata(t.monto) + '"></i>' : '';
    }).join('') + '</div>' +
      '<ul class="fin2-antig__ley">' + tramos.map(function (t, i) {
        return '<li><span class="fin2-antig__pt" style="background:' + colores[i] + '"></span>' + txt(t.nombre) + '<b>' + plata(t.monto) + '</b><span class="fin2-ayuda">' + Math.round(t.monto / total * 100) + ' %</span></li>';
      }).join('') + '</ul>';
  }

  function lectura(d) {
    var T = d.totales, L = [];
    var top = d.clientes.filter(function (c) { return c.vencido > 0; }).slice(0, 3);
    if (T.mas_60 > 0) L.push(['!', 'critico', '<b>' + plata(T.mas_60) + ' llevan más de 60 días vencidos.</b> ' + (top.length ? 'Lo más grande: ' + top.map(function (c) { return txt(c.cliente) + ' (' + plata(c.vencido) + ')'; }).join(', ') + '.' : '')]);
    else if (T.vencido > 0) L.push(['!', 'alerta', '<b>' + plata(T.vencido) + ' vencido</b>, todo con menos de 60 días.']);
    else L.push(['✓', 'ok', '<b>No hay facturas vencidas.</b>']);
    if (T.saldo_a_favor > 0) L.push(['i', 'info', '<b>' + plata(T.saldo_a_favor) + ' pagados por clientes que todavía no tienen factura</b> (los «abonos»). Se aplican solos a la próxima factura de cada uno.']);
    var fuera = d.clientes.filter(function (c) { return !c.en_sigso; });
    if (fuera.length) L.push(['?', 'alerta', '<b>' + fuera.length + ' cliente(s) facturados que no están en SIGSO.</b> Sus pagos no se pueden cruzar hasta crearlos (Administración › Clientes) con el mismo RUT.']);
    return '<div class="lectura fin2-lectura">' + L.map(function (l) { return '<div><span class="fin2-lectura__ic sx2-tono-' + l[1] + '">' + l[0] + '</span><span>' + l[2] + '</span></div>'; }).join('') + '</div>';
  }

  function pintar() {
    var d = est_.datos, T = d.totales;
    var subir = U.card({ titulo: 'Facturas', icono: 'recibo', cuerpo:
      '<p class="fin2-ayuda">Sube el <b>Registro de Ventas del SII</b> de cada mes: en el SII, Registro de Compras y Ventas › Ventas › <b>Descargar detalles</b> (CSV). Las facturas no se digitan.</p>' +
      '<div class="fin2-fila-bot">' +
        '<label class="sx2-boton sx2-boton--primario" style="cursor:pointer"><input type="file" accept=".csv,.gz,.txt" class="js-finc-ventas" hidden>' + U.ico('subir', 16) + 'Subir ventas del SII</label>' +
        '<label class="sx2-boton sx2-boton--secundario" style="cursor:pointer"><input type="file" accept=".xlsx" class="js-finc-planilla" hidden>' + U.ico('documento', 16) + 'Traer de la planilla SIGECO</label>' +
      '</div><div id="finc-ventas"></div>' });
    if (d.sin_facturas) {
      x_.pagina(x_.cab('Cobranza') + subir + U.card({ cuerpo: U.vacio({ icono: 'recibo', titulo: 'Todavía no hay facturas', texto: 'Sube el Registro de Ventas del SII o trae las facturas de la planilla SIGECO. Los pagos ya confirmados en Movimientos se cruzarán solos.' }) }));
      pintarVentas();
      return;
    }
    var lista = d.clientes.filter(function (c) {
      if (est_.filtro === 'deuda' && !(c.por_cobrar > 0)) return false;
      if (est_.filtro === 'favor' && !(c.saldo_a_favor > 0)) return false;
      return !est_.busca || (c.cliente + ' ' + c.rut).toLowerCase().indexOf(est_.busca.toLowerCase()) !== -1;
    });
    var nDeuda = d.clientes.filter(function (c) { return c.por_cobrar > 0; }).length, nFavor = d.clientes.filter(function (c) { return c.saldo_a_favor > 0; }).length;
    x_.pagina(x_.cab('Cobranza') +
      '<div class="sx2-fila-kpis fin2-kpis5">' +
        U.kpi({ etiqueta: 'Por cobrar', valor: plata(T.por_cobrar), icono: 'recibo', i: 0 }) +
        U.kpi({ etiqueta: 'Vencido', valor: plata(T.vencido), icono: 'alerta', tono: T.vencido > 0 ? 'critico' : 'ok', i: 1 }) +
        U.kpi({ etiqueta: 'Más de 60 días', valor: plata(T.mas_60), icono: 'reloj', tono: T.mas_60 > 0 ? 'critico' : 'ok', i: 2 }) +
        U.kpi({ etiqueta: 'Pagado sin factura (a favor)', valor: plata(T.saldo_a_favor), icono: 'dinero', tono: 'info', i: 3 }) +
        U.kpi({ etiqueta: 'Cobrado este mes', valor: plata(T.cobrado_mes), icono: 'tendencia', i: 4 }) +
      '</div>' +
      U.card({ titulo: 'Lo que conviene mirar', icono: 'bombilla', cuerpo: lectura(d) }) +
      '<div class="fin2-grid fin2-grid--2">' +
        U.card({ titulo: '¿Desde hace cuánto se debe?', icono: 'reloj', sub: 'días desde el vencimiento (30 días)', cuerpo: antiguedad(d.tramos) }) +
        subir +
      '</div>' +
      U.card({ sinRelleno: true, cuerpo:
        '<div class="fin2-tabla-barra">' +
          U.segmento([{ id: 'deuda', texto: 'Con deuda · ' + nDeuda }, { id: 'favor', texto: 'Con saldo a favor · ' + nFavor }, { id: 'todos', texto: 'Todos · ' + d.clientes.length }], est_.filtro, 'js-finc-filtro') +
          '<input class="fin2-input fin2-input--sm js-finc-busca" placeholder="Buscar cliente o RUT" value="' + txt(est_.busca) + '" aria-label="Buscar cliente">' +
        '</div>' +
        '<div class="fin2-tabla-envoltura"><table class="fin2-tabla fin2-clientes"><thead><tr><th>Cliente</th><th class="fin2-der">Facturas abiertas</th><th class="fin2-der">Por cobrar</th><th class="fin2-der">Vencido</th><th class="fin2-der">Días</th><th class="fin2-der">A favor</th><th>Último pago</th></tr></thead><tbody>' +
        (lista.map(function (c) {
          return '<tr class="fin2-clic js-finc-cliente" data-clave="' + txt(c.clave) + '" tabindex="0">' +
            '<td><b>' + txt(c.cliente) + '</b>' + (c.en_sigso ? '' : ' ' + U.badge('No está en SIGSO', 'alerta')) + '<span class="fin2-motivo">' + txt(c.rut) + '</span></td>' +
            '<td class="fin2-num fin2-der">' + c.facturas_abiertas + '</td><td class="fin2-num fin2-der">' + plata(c.por_cobrar) + '</td>' +
            '<td class="fin2-num fin2-der' + (c.vencido > 0 ? ' fin2-neg' : '') + '">' + (c.vencido > 0 ? plata(c.vencido) : '—') + '</td>' +
            '<td class="fin2-num fin2-der">' + (c.dias_max > 0 ? c.dias_max : '—') + '</td>' +
            '<td class="fin2-num fin2-der">' + (c.saldo_a_favor > 0 ? plata(c.saldo_a_favor) : '—') + '</td>' +
            '<td class="fin2-num">' + (c.ultimo_pago ? corta(c.ultimo_pago) : '—') + '</td></tr>';
        }).join('') || '<tr><td colspan="7">' + U.vacio({ icono: 'check', texto: 'Nadie en esta vista.' }) + '</td></tr>') +
        '</tbody></table></div>' }));
    pintarVentas();
    if (U.animar) U.animar(x_.raiz());
  }

  // --- Subir el Registro de Ventas -------------------------------------------------------
  function leerTexto(f) {
    var buf = f.arrayBuffer();
    if (/\.gz$/i.test(f.name)) {
      if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('Este navegador no abre .gz: usa Chrome o Edge actualizados.'));
      buf = buf.then(function (b) { return new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); });
    }
    return buf.then(function (b) {
      var t = new TextDecoder('utf-8').decode(b);
      if (t.indexOf('�') !== -1) t = new TextDecoder('windows-1252').decode(b); // el SII suele mandar Latin-1
      return t;
    });
  }
  function subirVentas(f) {
    est_.ventas = { nombre: f.name, estado: 'leyendo' };
    pintarVentas();
    leerTexto(f).then(function (texto) {
      est_.ventas.texto = texto;
      return x_.api('finanzasRevisarVentas', { texto: texto, nombre: f.name }).then(function (r) {
        if (r && r.ok) { est_.ventas.estado = 'lista'; est_.ventas.rev = r.data; est_.ventas.empresa = r.data.empresa_sugerida || 'HomePymes'; }
        else { est_.ventas.estado = 'error'; est_.ventas.error = (r && r.message) || 'No se pudo leer.'; }
      });
    }).catch(function (e) { est_.ventas.estado = 'error'; est_.ventas.error = e.message || 'No se pudo leer el archivo.'; }).then(pintarVentas);
  }
  function pintarVentas() {
    var el = document.getElementById('finc-ventas'), v = est_.ventas;
    if (!el) return;
    if (!v) { el.innerHTML = ''; return; }
    if (v.estado === 'leyendo') { el.innerHTML = '<p class="fin2-ayuda">Leyendo ' + txt(v.nombre) + '…</p>'; return; }
    if (v.estado === 'error') { el.innerHTML = '<p class="fin2-error">' + txt(v.error) + '</p>'; return; }
    var r = v.rev;
    el.innerHTML = '<div class="fin2-rev" style="margin-top:12px">' +
      '<div class="fin2-rev__cab"><b>' + txt(v.nombre) + '</b><span>' + txt(corta(r.desde)) + ' al ' + txt(corta(r.hasta)) + '</span></div>' +
      '<div class="fin2-rev__nums"><span>Facturas <b>' + r.facturas + '</b></span><span>Notas de crédito <b>' + r.notas_credito + '</b></span><span>Total <b>' + plata(r.total) + '</b></span><span>Nuevas <b>' + r.nuevas + '</b></span></div>' +
      (r.sin_cliente ? '<p class="fin2-ayuda">⚠ ' + r.sin_cliente + ' documento(s) de clientes que no están en SIGSO: ' + txt(r.ejemplos_sin_cliente.join(', ')) + '. Se guardan igual y aparecen marcados.</p>' : '<p class="fin2-ayuda">Todos los clientes se reconocieron por su RUT.</p>') +
      '<label class="fin2-label">Empresa que emitió estas facturas' + (r.empresa_sugerida ? ' (recordada)' : '') +
        '<select class="fin2-input js-finc-empresa">' + EMPRESAS.map(function (e) { return '<option' + (e === v.empresa ? ' selected' : '') + '>' + txt(e) + '</option>'; }).join('') + '</select></label>' +
      '<div class="fin2-acciones">' + U.boton({ texto: 'Descartar', clase: 'js-finc-descartar' }) +
        U.boton({ texto: r.nuevas ? 'Importar ' + r.nuevas + ' documento(s)' : 'Nada nuevo', icono: 'check', variante: 'primario', clase: 'js-finc-importar', deshabilitado: !r.nuevas }) + '</div></div>';
  }
  function traerPlanilla(f) {
    SigsoLectorXlsx.leer(f, { hojas: function (n) { return n === 'FACTURAS'; } }).then(function (hojas) {
      if (!hojas.length) { aviso('Ese Excel no tiene la hoja FACTURAS.'); return; }
      return x_.api('finanzasImportarFacturasPlanilla', { filas: hojas[0].filas }).then(function (r) {
        if (!r || !r.ok) { aviso((r && r.message) || 'No se pudo leer la planilla.'); return; }
        aviso(r.data.nuevas + ' factura(s) traídas de la planilla' + (r.data.sin_cliente ? ' · ' + r.data.sin_cliente + ' sin cliente reconocido' : '') + '.');
        ver(x_);
      });
    }).catch(function () { aviso('El archivo no es un Excel válido.'); });
  }

  // --- Ficha de un cliente ----------------------------------------------------------------
  function verFicha(clave) {
    est_.ficha = clave;
    var t = x_.turno();
    x_.pagina(x_.cab('Cobranza') + U.esqueleto('tabla', 6));
    x_.api('finanzasFichaCliente', { clave: clave }).then(function (r) {
      if (!x_.vigente(t)) return;
      if (!r || !r.ok) { est_.ficha = null; if (r && !r.boveda_cerrada) ver(x_); return; }
      pintarFicha(r.data);
    });
  }
  function accionesFactura(f) {
    if (est_.editando && est_.editando.split('|')[0] === f.id) {
      var estado = est_.editando.split('|')[1];
      return '<div class="fin2-editar"><input class="fin2-input fin2-input--sm js-finc-motivo" placeholder="Motivo (obligatorio)" maxlength="300">' +
        U.boton({ texto: estado === 'ANULADA' ? 'Anular' : 'Marcar incobrable', sm: true, variante: 'primario', clase: 'js-finc-guardar-estado', datos: { id: f.id, estado: estado } }) +
        U.boton({ texto: 'Cancelar', sm: true, variante: 'fantasma', clase: 'js-finc-cancelar' }) + '</div>';
    }
    if (f.estado === 'INCOBRABLE') return U.boton({ texto: 'Reactivar', sm: true, variante: 'fantasma', clase: 'js-finc-estado', datos: { id: f.id, estado: 'VIGENTE' } });
    return f.saldo > 0 ? U.boton({ texto: 'Anular', sm: true, variante: 'fantasma', clase: 'js-finc-estado', datos: { id: f.id, estado: 'ANULADA' } }) +
      U.boton({ texto: 'Incobrable', sm: true, variante: 'fantasma', clase: 'js-finc-estado', datos: { id: f.id, estado: 'INCOBRABLE' } }) : '';
  }
  function pintarFicha(d) {
    est_.fichaDatos = d;
    x_.pagina(x_.cab('Cobranza') +
      '<div class="fin2-ficha-cab sx2-entra">' + U.boton({ texto: 'Volver a la cobranza', icono: 'izquierda', variante: 'fantasma', clase: 'js-finc-volver' }) +
        '<div><h2>' + txt(d.cliente) + '</h2><span class="fin2-ayuda">' + txt(d.rut) + (d.en_sigso ? '' : ' · no está en SIGSO: sus pagos no se pueden cruzar') + '</span></div></div>' +
      '<div class="sx2-fila-kpis">' +
        U.kpi({ etiqueta: 'Facturado', valor: plata(d.facturado), icono: 'recibo', i: 0 }) +
        U.kpi({ etiqueta: 'Pagado (con notas de crédito)', valor: plata(d.pagado), icono: 'dinero', i: 1 }) +
        U.kpi({ etiqueta: 'Por cobrar', valor: plata(d.por_cobrar), icono: 'alerta', tono: d.vencido > 0 ? 'critico' : 'ok', i: 2 }) +
        U.kpi({ etiqueta: 'A favor del cliente', valor: plata(d.saldo_a_favor), icono: 'check', tono: 'info', i: 3 }) +
      '</div>' +
      '<div class="fin2-pila">' +
        U.card({ titulo: 'Facturas', icono: 'recibo', sinRelleno: false, cuerpo: '<div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>N°</th><th>Emitida</th><th>Vence</th><th class="fin2-der">Total</th><th class="fin2-der">Falta</th><th>Situación</th><th></th></tr></thead><tbody>' +
          (d.facturas.map(function (f) {
            var nc = Number(f.tipo_doc) === 61;
            return '<tr><td class="fin2-num"><b>' + txt(f.folio) + '</b>' + (nc ? ' ' + U.badge('Nota de crédito', 'info') : '') + '<span class="fin2-motivo">' + txt(f.empresa) + (f.origen === 'planilla' ? ' · de la planilla' : '') + (f.nota ? ' · ' + txt(f.nota) : '') + '</span></td>' +
              '<td class="fin2-num">' + corta(f.fecha) + '</td><td class="fin2-num">' + (nc ? '—' : corta(f.vence)) + '</td>' +
              '<td class="fin2-num fin2-der">' + (nc ? '−' : '') + plata(f.total) + '</td><td class="fin2-num fin2-der">' + (nc ? '—' : plata(f.saldo)) + '</td>' +
              '<td>' + (nc ? '' : U.badge(f.situacion + (f.dias > 0 && f.saldo > 0 ? ' · ' + f.dias + ' d' : ''), TONO_SIT[f.situacion] || 'neutro')) + '</td>' +
              '<td class="fin2-acc">' + (nc ? '' : accionesFactura(f)) + '</td></tr>';
          }).join('') || '<tr><td colspan="7">Sin facturas.</td></tr>') + '</tbody></table></div>' }) +
        U.card({ titulo: 'Pagos recibidos', icono: 'dinero', sub: 'desde el banco', cuerpo: d.pagos.length ? '<ul class="fin2-pagos">' + d.pagos.map(function (p) {
          return '<li><span class="fin2-num">' + corta(p.fecha) + '</span><span class="fin2-glosa">' + txt(p.glosa) + (p.nota ? '<span class="fin2-motivo">' + txt(p.nota) + '</span>' : '') + '</span><b class="fin2-num fin2-pos">+' + plata(p.monto) + '</b></li>';
        }).join('') + '</ul>' : U.vacio({ icono: 'dinero', texto: 'Sin pagos confirmados como «Ingreso de la empresa» para este cliente.' }) }) +
      '</div>' +
      '<p class="fin2-ayuda">Los pagos cubren las facturas de la más antigua a la más nueva. Lo que sobra queda a favor del cliente y se aplica solo a la próxima.</p>');
  }

  // =====================================================================================
  var enlazado_ = false;
  function enlazar() {
    var raiz = x_.raiz();
    if (enlazado_ || !raiz) return;
    enlazado_ = true;
    raiz.addEventListener('change', function (ev) {
      var e = ev.target;
      if (e.classList.contains('js-finc-ventas')) { if (e.files[0]) subirVentas(e.files[0]); e.value = ''; }
      else if (e.classList.contains('js-finc-planilla')) { if (e.files[0]) traerPlanilla(e.files[0]); e.value = ''; }
      else if (e.classList.contains('js-finc-empresa') && est_.ventas) { est_.ventas.empresa = e.value; }
    });
    raiz.addEventListener('input', function (ev) {
      if (ev.target.classList.contains('js-finc-busca')) {
        est_.busca = ev.target.value;
        var pos = ev.target.selectionStart;
        pintar();
        var b = raiz.querySelector('.js-finc-busca'); if (b) { b.focus(); b.setSelectionRange(pos, pos); }
      }
    });
    raiz.addEventListener('keydown', function (ev) {
      var tr = ev.target.closest && ev.target.closest('.js-finc-cliente');
      if (tr && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); verFicha(tr.dataset.clave); }
    });
    raiz.addEventListener('click', function (ev) {
      var tr = ev.target.closest('.js-finc-cliente');
      if (tr) { verFicha(tr.dataset.clave); return; }
      var b = ev.target.closest('button');
      if (!b) return;
      if (b.classList.contains('js-finc-filtro') && b.dataset.id) { est_.filtro = b.dataset.id; pintar(); }
      else if (b.classList.contains('js-finc-volver')) { est_.ficha = null; est_.editando = ''; ver(x_); }
      else if (b.classList.contains('js-finc-descartar')) { est_.ventas = null; pintarVentas(); }
      else if (b.classList.contains('js-finc-importar')) {
        b.disabled = true;
        x_.api('finanzasImportarVentas', { texto: est_.ventas.texto, nombre: est_.ventas.nombre, empresa: est_.ventas.empresa }).then(function (r) {
          if (!r || !r.ok) { b.disabled = false; aviso((r && r.message) || 'No se pudo importar.'); return; }
          aviso(r.data.nuevas + ' documento(s) nuevos' + (r.data.actualizadas ? ', ' + r.data.actualizadas + ' actualizados desde el SII' : '') + '.');
          est_.ventas = null; ver(x_);
        });
      } else if (b.classList.contains('js-finc-estado')) {
        if (b.dataset.estado === 'VIGENTE') {
          x_.api('finanzasEstadoFactura', { id: b.dataset.id, estado: 'VIGENTE' }).then(function (r) { if (r && r.ok) verFicha(est_.ficha); });
        } else { est_.editando = b.dataset.id + '|' + b.dataset.estado; pintarFicha(est_.fichaDatos); var m = raiz.querySelector('.js-finc-motivo'); if (m) m.focus(); }
      } else if (b.classList.contains('js-finc-cancelar')) { est_.editando = ''; pintarFicha(est_.fichaDatos); }
      else if (b.classList.contains('js-finc-guardar-estado')) {
        var motivo = (raiz.querySelector('.js-finc-motivo') || {}).value || '';
        x_.api('finanzasEstadoFactura', { id: b.dataset.id, estado: b.dataset.estado, nota: motivo }).then(function (r) {
          if (!r || !r.ok) { aviso((r && r.message) || 'No se pudo guardar.'); return; }
          est_.editando = ''; aviso('Factura actualizada.'); verFicha(est_.ficha);
        });
      }
    });
  }

  window.SigsoFinanzasCobranza = { ver: ver, reiniciar: function () { est_.ficha = null; est_.editando = ''; } };
})();
