/**
 * finanzas-cobranza-v2.js — Cobranza por factura (2026-10-06; corrección v2 I04 del
 * 2026-10-20; backend/logica/finanzasCobranza.js). Vista «Cobranza» de la bóveda:
 *
 *  - Bandeja por FACTURA (emisor + tipo + folio): filtros por emisor, cliente,
 *    estado, vencimiento y búsqueda (folio, RUT o nombre). Los totales son lo
 *    CONFIRMADO; lo que SIGSO propone (FIFO) va aparte y no reduce la deuda.
 *  - Aplicar: se marcan facturas, se eligen uno o varios cobros elegibles y se
 *    reparten importes; el servidor valida todo y responde con los saldos.
 *  - Factura: aplicaciones (desaplicar con motivo), vencimiento por fecha o
 *    condición comercial (con historia), anular/incobrable, nota de crédito.
 *  - Relaciones de cobro por terceros con alcance, vigencia y quién autoriza.
 *  - Subir el Registro de Ventas del SII o la hoja FACTURAS de la planilla.
 * Cobro recibido ≠ aplicación propuesta ≠ factura pagada: SIGSO propone, la
 * persona revisa y confirma.
 */
(function () {
  'use strict';

  var U = UIv2;
  var x_ = null, cat_ = null;
  var est_ = { empresa: '', clave: '', estado: 'abiertas', busca: '', vence_hasta: '', sel: {}, datos: null, ventas: null };
  // I12.2/I12.4: al cerrarse la bóveda, la pantalla olvida las cifras que tenía cargadas.
  document.addEventListener('sigso-fin-cerrada', function () { est_.datos = null; est_.sel = {}; });
  var TONO_SIT = { Pagada: 'ok', 'Pago parcial': 'alerta', 'Aplicación sugerida': 'info', Vencida: 'critico', 'Por vencer': 'neutro', Incobrable: 'neutro' };
  var ESTADOS = [['abiertas', 'Abiertas'], ['vencidas', 'Vencidas'], ['sugeridas', 'Con propuesta'], ['pagadas', 'Pagadas'], ['incobrables', 'Incobrables'], ['todas', 'Todas']];
  var ORIGEN_VENCE = { documento: 'del documento', manual: 'fecha acordada', condicion: 'condición comercial', parametro: 'plazo por defecto (no es un acuerdo del cliente)' };

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function plata(n) { var v = Math.round(Number(n) || 0); return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('es-CL'); }
  function corta(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '-' + p[1] + '-' + p[0].slice(2) : ''; }
  function montoDe(v) { var s = String(v || '').replace(/[^0-9]/g, ''); return s ? Number(s) : 0; }
  function uuid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); }
  function hoyIso() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
  function doc(f) { return (Number(f.tipo_doc) === 61 ? 'NC ' : 'F ') + f.folio; }
  function opciones(l, actual, vacio) { return (vacio !== undefined ? '<option value="">' + txt(vacio) + '</option>' : '') + l.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return '<option value="' + txt(v) + '"' + (String(v) === String(actual) ? ' selected' : '') + '>' + txt(t) + '</option>'; }).join(''); }
  function marcadas() { return Object.keys(est_.sel).filter(function (k) { return est_.sel[k]; }); }

  // =====================================================================================
  function ver(x) {
    x_ = x; enlazar();
    var c = x.contexto();
    if (c.cliente_cobranza) { est_.clave = c.cliente_cobranza; est_.estado = 'todas'; x.contexto({ cliente_cobranza: '' }); }
    var t = x.turno();
    x.pagina(x.cab('cobranza') + U.esqueleto('tabla', 8));
    Promise.all([x.catalogo(), x.api('finanzasFacturas', { empresa: est_.empresa, clave: est_.clave, estado: est_.estado, busca: est_.busca, vence_hasta: est_.vence_hasta })]).then(function (rs) {
      if (!x.vigente(t)) return;
      cat_ = rs[0];
      var r = rs[1];
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('cobranza') + U.card({ cuerpo: U.vacio({ accion: '<button type="button" class="sx2-boton sx2-boton--secundario sx2-boton--sm js-fin-reintentar">Reintentar</button>', icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || '' }) })); return; }
      est_.datos = r.data;
      Object.keys(est_.sel).forEach(function (k) { if (!r.data.facturas.some(function (f) { return f.id === k; })) delete est_.sel[k]; });
      pintar();
    });
  }
  function recargar() { ver(x_); }

  function pintar() {
    var d = est_.datos, T = d.totales, n = marcadas().length;
    var cliente = est_.clave ? (cat_.clientes || []).filter(function (c) { return c.id === est_.clave; })[0] : null;
    x_.pagina(x_.cab('cobranza',
      U.boton({ texto: 'Relaciones de terceros', icono: 'enlace', sm: true, clase: 'js-fcb-rel' }) +
      U.boton({ texto: n ? 'Aplicar cobro a ' + n + ' factura(s)' : 'Aplicar cobro', icono: 'dinero', sm: true, variante: 'primario', clase: 'js-fcb-aplicar-sel', datos: { cap: 'APLICAR' }, deshabilitado: !n })) +
      '<div class="fin2-ctx sx2-entra" role="group" aria-label="Qué facturas ver">' +
        '<label class="fin2-campo fin2-campo--fila"><span>Emisor</span><select class="fin2-input fin2-input--sm js-fcb-emp">' + opciones(cat_.empresas || [], est_.empresa, 'Todos') + '</select></label>' +
        '<label class="fin2-campo fin2-campo--fila"><span>Cliente</span><select class="fin2-input fin2-input--sm js-fcb-cli">' + opciones((cat_.clientes || []).map(function (c) { return [c.id, c.nombre]; }), est_.clave, 'Todos') + '</select></label>' +
        '<label class="fin2-campo fin2-campo--fila"><span>Vence hasta</span><input type="date" class="fin2-input fin2-input--sm js-fcb-vence" value="' + txt(est_.vence_hasta) + '"></label>' +
        '<label class="fin2-busca">' + U.ico('lupa', 14) + '<input class="js-fcb-busca" type="search" placeholder="Folio, RUT o nombre" value="' + txt(est_.busca) + '" aria-label="Buscar factura"></label>' +
      '</div>' +
      // I08: resumen compacto (una línea por cifra) para llegar antes a la tabla; la explicación, plegable.
      '<div class="fin2-tiras">' +
        tira('Facturado · ' + T.documentos + ' doc.', plata(T.facturado), 'neutro', 'Total de los documentos en esta vista.') +
        tira('Saldo confirmado', plata(T.saldo_confirmado), 'info', 'Descuenta solo lo aplicado y confirmado y los créditos.') +
        tira('Vencido al ' + corta(d.corte), plata(T.vencido_confirmado), T.vencido_confirmado > 0 ? 'critico' : 'ok', 'Saldo confirmado de facturas con vencimiento pasado.') +
        tira('Cobros sin aplicar', plata(T.sin_aplicar), 'neutro', 'Cobros propios todavía sin factura; los fondos de clientes no pagan facturas.') +
        tira('Propuesto por SIGSO (aparte)', plata(T.propuesto), 'alerta', 'No reduce la deuda hasta que una persona lo confirma.') +
      '</div>' +
      '<details class="fin2-explica"><summary>Cobro recibido, aplicación propuesta y factura pagada: ¿qué es cada uno?</summary><p class="fin2-ayuda"><b>Cobro recibido</b>: el dinero que llegó (banco o registro). <b>Aplicación propuesta</b>: SIGSO sugiere a qué factura va (de la más antigua a la más nueva) y una persona la revisa. <b>Factura pagada</b>: solo cuando lo aplicado y confirmado cubre su saldo.</p></details>' +
      (cliente ? '<div class="fin2-cinta fin2-cinta--info">' + U.ico('equipo', 16) + '<span>Viendo a <b>' + txt(cliente.nombre) + '</b>. ' + U.boton({ texto: 'Revisar propuestas del cliente', sm: true, clase: 'js-fcb-sug', datos: { clave: cliente.id, cap: 'APLICAR' } }) + ' ' + U.boton({ texto: 'Ver todos', sm: true, variante: 'fantasma', clase: 'js-fcb-todos' }) + '</span></div>' : '') +
      U.card({ sinRelleno: true, cuerpo:
        '<div class="fin2-tabla-barra">' + U.segmento(ESTADOS.map(function (e) { return { id: e[0], texto: e[1] }; }), est_.estado, 'js-fcb-estado') + '</div>' +
        '<div class="fin2-tabla-envoltura"><table class="fin2-tabla fin2-fact"><thead><tr><th class="fin2-fact__chk" aria-label="Marcar"></th><th>Cliente</th><th>Documento</th><th>Vence</th>' +
          '<th class="fin2-der">Total</th><th class="fin2-der">Aplicado y créditos</th><th class="fin2-der">Saldo</th><th>Estado</th><th></th></tr></thead><tbody>' +
        (d.facturas.map(fila).join('') || '<tr><td colspan="9">' + U.vacio({ icono: 'check', texto: d.estado === 'abiertas' ? 'No hay facturas abiertas con estos filtros.' : 'Nada en esta vista.' }) + '</td></tr>') +
        '</tbody></table></div>' + (d.truncado ? '<p class="fin2-ayuda">Se muestran las primeras 500: afina los filtros.</p>' : '') }) +
      tarjetaSubir());
    pintarVentas();
    if (x_.aplicarCapacidades) x_.aplicarCapacidades();
  }
  function tira(t, v, tono, ayuda) { return '<div class="fin2-tira sx2-tono-' + tono + '" title="' + txt(ayuda) + '"><span>' + txt(t) + '</span><b>' + v + '</b><small class="sx2-oculto-visual">' + txt(ayuda) + '</small></div>'; }
  function fila(f) {
    var nc = Number(f.tipo_doc) === 61;
    var abre = f.saldo_confirmado > 0 && f.estado !== 'INCOBRABLE' && !nc && f.en_sigso;
    return '<tr' + (est_.sel[f.id] ? ' class="fin2-fila--sel"' : '') + '><td>' + (abre ? '<input type="checkbox" class="js-fcb-sel" data-id="' + txt(f.id) + '"' + (est_.sel[f.id] ? ' checked' : '') + ' aria-label="Marcar ' + txt(doc(f)) + '">' : '') + '</td>' +
      '<td><b>' + txt(f.cliente) + '</b>' + (f.en_sigso ? '' : ' ' + U.badge('No está en SIGSO', 'alerta')) + '<span class="fin2-motivo">' + txt(f.rut) + '</span></td>' +
      '<td class="fin2-num"><b>' + txt(doc(f)) + '</b><span class="fin2-motivo">' + txt(f.empresa) + ' · emitida ' + corta(f.fecha) + '</span>' + (f.conflicto_fuente ? U.badge('Revisar: el SII trae otro total', 'critico') : '') + '</td>' +
      '<td class="fin2-num" title="' + txt(ORIGEN_VENCE[f.vence_origen] || '') + '">' + (nc ? '—' : corta(f.vence) + (f.vence_origen === 'parametro' ? '<span class="fin2-motivo">por defecto</span>' : f.vence_origen === 'condicion' ? '<span class="fin2-motivo">' + f.condicion_dias + ' días</span>' : '')) + '</td>' +
      '<td class="fin2-num fin2-der">' + (nc ? '−' : '') + plata(f.total) + '</td>' +
      '<td class="fin2-num fin2-der">' + (f.aplicado ? plata(f.aplicado) : '—') + (f.creditos ? '<span class="fin2-motivo">NC ' + plata(f.creditos) + '</span>' : '') + (f.sugerido ? '<span class="fin2-motivo">+' + plata(f.sugerido) + ' propuesto</span>' : '') + '</td>' +
      '<td class="fin2-num fin2-der"><b>' + (nc ? '—' : plata(f.saldo_confirmado)) + '</b></td>' +
      '<td>' + (nc ? U.badge(f.situacion, 'info') : U.badge(f.situacion + (f.dias > 0 ? ' · ' + f.dias + ' d' : ''), TONO_SIT[f.situacion] || 'neutro')) + '</td>' +
      '<td class="fin2-acc">' + U.boton({ texto: 'Ver', sm: true, variante: 'fantasma', clase: 'js-fcb-ver', datos: { id: f.id } }) +
        (abre ? U.boton({ texto: 'Aplicar', sm: true, clase: 'js-fcb-aplicar', datos: { id: f.id, cap: 'APLICAR' } }) : '') + '</td></tr>';
  }
  function factura(id) { return est_.datos.facturas.filter(function (f) { return f.id === id; })[0]; }

  // ---- aplicar: uno o varios cobros a una o varias facturas ---------------------------------
  function abrirAplicar(ids) {
    var d = U.drawer({ titulo: 'Aplicar cobro', subtitulo: '<span class="fin2-ayuda">Elige los cobros y reparte los importes. El servidor vuelve a validar todo al confirmar.</span>', cuerpo: U.esqueleto('tabla', 5),
      pie: '<span style="flex:1"></span>' + U.boton({ texto: 'Confirmar aplicación', icono: 'check', variante: 'primario', clase: 'js-fca2-ok', deshabilitado: true }) });
    d.el.classList.add('fin2-panel', 'sx2-drawer--ancho');
    x_.api('finanzasCobrosElegibles', { factura_ids: ids }).then(function (r) {
      if (!r || !r.ok) { d.cuerpo(U.vacio({ icono: 'alerta', titulo: 'No se pudo abrir', texto: (r && r.message) || '' })); return; }
      pintarAplicar(d, r.data);
    });
  }
  function pintarAplicar(d, data) {
    var fs = data.facturas, cs = data.cobros, clave = uuid(), elegidos = {};
    var celdas = function () {
      var el = elegidos, lista = cs.filter(function (c) { return el[c.ref]; });
      if (!lista.length) return '<p class="fin2-ayuda">Marca uno o más cobros de arriba para repartirlos.</p>';
      return '<div class="fin2-tabla-envoltura"><table class="fin2-tabla fin2-asig"><thead><tr><th>Cobro ↓ · Factura →</th>' + fs.map(function (f) { return '<th class="fin2-der">' + txt(f.empresa + ' ' + doc(f)) + '<br><small>saldo ' + plata(f.saldo_confirmado) + '</small></th>'; }).join('') + '<th class="fin2-der">Queda sin aplicar</th></tr></thead><tbody>' +
        lista.map(function (c) { return '<tr><th>' + corta(c.fecha) + ' · ' + plata(c.disponible) + '<br><small>' + txt(c.cliente) + '</small></th>' + fs.map(function (f) { return '<td><input class="fin2-input fin2-input--sm fin2-der js-fca2" inputmode="numeric" data-r="' + txt(c.ref) + '" data-f="' + txt(f.id) + '" aria-label="Del cobro del ' + txt(corta(c.fecha)) + ' a ' + txt(doc(f)) + '"></td>'; }).join('') + '<td class="fin2-der fin2-num js-fca2-rc" data-r="' + txt(c.ref) + '"></td></tr>'; }).join('') +
        '<tr class="fin2-tot"><th>Saldo que queda</th>' + fs.map(function (f) { return '<td class="fin2-der fin2-num js-fca2-rf" data-f="' + txt(f.id) + '"></td>'; }).join('') + '<td></td></tr></tbody></table></div>';
    };
    d.cuerpo('<div class="fin2-p">' +
      '<section class="fin2-p-sec"><h3>Facturas</h3><ul class="fin2-lista-saldos">' + fs.map(function (f) { return '<li><span><b>' + txt(f.empresa + ' · ' + doc(f)) + '</b> ' + txt(f.cliente) + ' <small class="fin2-ayuda">emitida ' + corta(f.fecha) + ' · vence ' + corta(f.vence) + '</small></span><b class="fin2-num">' + plata(f.saldo_confirmado) + '</b></li>'; }).join('') + '</ul>' +
        '<p class="fin2-ayuda">Corte ' + corta(data.corte) + '. Total pendiente: <b>' + plata(fs.reduce(function (s, f) { return s + f.saldo_confirmado; }, 0)) + '</b>.</p></section>' +
      '<section class="fin2-p-sec"><h3>Cobros elegibles</h3>' + (cs.length ? '<ul class="fin2-conc__lista">' + cs.map(function (c) {
        return '<li><label class="fin2-conc__item"><input type="checkbox" class="js-fca2-cobro" data-r="' + txt(c.ref) + '"><span class="fin2-num">' + corta(c.fecha) + '</span>' +
          '<span class="fin2-conc__txt"><b>' + txt(c.cliente) + ' · ' + txt(c.glosa || c.origen) + '</b><small>' + txt([c.origen, c.cuenta, c.empresa].filter(Boolean).join(' · ')) + ' · cobro ' + plata(c.monto) + (c.aplicado ? ', aplicado ' + plata(c.aplicado) : '') + '</small>' +
          (c.terceros.length ? '<small class="fin2-terceros">' + U.badge('Por terceros', 'info') + ' ' + txt(c.terceros.join(' · ')) + '</small>' : '') + '</span><b class="fin2-num fin2-pos">' + plata(c.disponible) + '</b></label></li>';
      }).join('') + '</ul>' : U.vacio({ icono: 'dinero', texto: 'No hay cobros propios con saldo disponible que se puedan aplicar a estas facturas (mismo cliente y emisor, o una relación de terceros vigente).' })) + '</section>' +
      '<section class="fin2-p-sec"><h3>Importes</h3><label class="fin2-campo fin2-campo--fila"><span>Fecha de aplicación</span><input type="date" class="fin2-input fin2-input--sm js-fca2-fecha" value="' + hoyIso() + '"></label>' +
        '<p class="fin2-ayuda">La fecha del cobro no cambia; esta es la fecha en que se registra la aplicación. Aplicar no toca el banco ni suma ingresos.</p><div class="js-fca2-tabla">' + celdas() + '</div><p class="fin2-ayuda js-fca2-msg" aria-live="polite"></p></section></div>');
    var recalcular = function () {
      var porF = {}, porR = {}, grupos = {}, err = '';
      d.el.querySelectorAll('.js-fca2').forEach(function (i) { var v = montoDe(i.value); if (!v) return; porF[i.dataset.f] = (porF[i.dataset.f] || 0) + v; porR[i.dataset.r] = (porR[i.dataset.r] || 0) + v; (grupos[i.dataset.r] = grupos[i.dataset.r] || []).push({ factura_id: i.dataset.f, monto: v, expected_version: (fs.filter(function (f) { return f.id === i.dataset.f; })[0] || {}).version }); });
      cs.forEach(function (c) { var el = d.el.querySelector('.js-fca2-rc[data-r="' + c.ref + '"]'); if (!el) return; var q = c.disponible - (porR[c.ref] || 0); el.textContent = plata(q); el.classList.toggle('fin2-neg', q < 0); if (q < 0) err = 'Un cobro quedó con más de lo que tiene disponible.'; });
      fs.forEach(function (f) { var el = d.el.querySelector('.js-fca2-rf[data-f="' + f.id + '"]'); if (!el) return; var q = f.saldo_confirmado - (porF[f.id] || 0); el.textContent = plata(q); el.classList.toggle('fin2-neg', q < 0); if (q < 0) err = 'A una factura se le aplica más que su saldo.'; });
      var total = Object.keys(porF).reduce(function (s, k) { return s + porF[k]; }, 0);
      d.el.querySelector('.js-fca2-msg').innerHTML = err ? '<span class="fin2-neg">' + txt(err) + '</span>' : total ? 'Se aplicarán <b>' + plata(total) + '</b>. Saldos y remanentes: como se ve arriba; el servidor confirma los definitivos.' : '';
      d.el.querySelector('.js-fca2-ok').disabled = !!err || !total;
      return Object.keys(grupos).map(function (r) { return { recepcion_ref: r, aplicaciones: grupos[r] }; });
    };
    var proponer = function () {
      // Propuesta inicial visible y editable: cada cobro elegido llena las facturas en orden, sin pasarse.
      var libres = {}; cs.forEach(function (c) { libres[c.ref] = c.disponible; });
      fs.forEach(function (f) {
        var falta = f.saldo_confirmado;
        cs.forEach(function (c) { if (!elegidos[c.ref] || falta <= 0) return; var v = Math.min(libres[c.ref], falta); if (v > 0) { var i = d.el.querySelector('.js-fca2[data-r="' + c.ref + '"][data-f="' + f.id + '"]'); if (i) i.value = v.toLocaleString('es-CL'); libres[c.ref] -= v; falta -= v; } });
      });
      recalcular();
    };
    d.el.addEventListener('change', function (ev) {
      if (!ev.target.classList.contains('js-fca2-cobro')) return;
      elegidos[ev.target.dataset.r] = ev.target.checked;
      d.el.querySelector('.js-fca2-tabla').innerHTML = celdas(); proponer();
    });
    d.el.addEventListener('input', function (ev) { if (ev.target.classList.contains('js-fca2')) recalcular(); });
    d.el.addEventListener('focusout', function (ev) { if (ev.target.classList.contains('js-fca2')) { var v = montoDe(ev.target.value); ev.target.value = v ? v.toLocaleString('es-CL') : ''; } });
    d.el.addEventListener('click', function (ev) {
      var b = ev.target.closest('.js-fca2-ok'); if (!b) return;
      var grupos = recalcular(); if (!grupos.length) return;
      b.disabled = true;
      x_.api('finanzasAplicar', { idempotency_key: clave, grupos: grupos, fecha_aplicacion: d.el.querySelector('.js-fca2-fecha').value }).then(function (r) {
        if (!r || !r.ok) { b.disabled = false; d.el.querySelector('.js-fca2-msg').innerHTML = '<span class="fin2-neg">' + txt((r && r.message) || 'No se pudo aplicar.') + '</span>'; return; }
        var res = r.data;
        x_.aviso('Aplicado ' + plata(res.aplicado) + '. ' + res.facturas.map(function (f) { return doc(f) + ': ' + (f.saldo_confirmado ? 'queda ' + plata(f.saldo_confirmado) : 'pagada'); }).join(' · '), 'exito');
        est_.sel = {}; d.cerrar(); recargar();
      });
    });
  }

  // ---- panel de una factura -----------------------------------------------------------------
  function abrirFactura(id) {
    var f = factura(id);
    if (f && Number(f.tipo_doc) === 61) { abrirNota(f); return; }
    var d = U.drawer({ titulo: (f ? f.empresa + ' · ' + doc(f) : 'Factura'), subtitulo: '<span class="fin2-ayuda">' + txt(f ? f.cliente : '') + '</span>', cuerpo: U.esqueleto('tabla', 5) });
    d.el.classList.add('fin2-panel', 'sx2-drawer--ancho');
    x_.api('finanzasFichaCliente', { clave: f.clave }).then(function (r) {
      if (!r || !r.ok) { d.cuerpo(U.vacio({ icono: 'alerta', titulo: 'No se pudo abrir', texto: (r && r.message) || '' })); return; }
      var x = r.data.facturas.filter(function (y) { return y.id === id; })[0];
      if (!x) { d.cuerpo(U.vacio({ icono: 'alerta', texto: 'La factura ya no está.' })); return; }
      pintarFactura(d, x, f, r.data);
    });
  }
  function pintarFactura(d, x, f, ficha) {
    var nc = Number(x.tipo_doc) === 61;
    d.cuerpo('<div class="fin2-p">' +
      '<div class="fin2-p-caja"><span>Total <b>' + plata(x.total) + '</b> · créditos ' + plata(x.nc) + ' · aplicado ' + plata(x.aplicado_confirmado) + (x.aplicado_sugerido ? ' · propuesto ' + plata(x.aplicado_sugerido) + ' (sin confirmar)' : '') + ' · <b>saldo ' + plata(x.saldo_confirmado) + '</b> ' + U.badge(x.situacion, TONO_SIT[x.situacion] || 'neutro') + '</span></div>' +
      (f.conflicto_fuente ? '<div class="fin2-p-caja fin2-p-caja--alerta">' + U.ico('alerta', 16) + '<span>El Registro de Ventas del SII trae esta factura por ' + plata(f.conflicto_fuente.total_nuevo) + ', pero ya tiene ' + plata(f.conflicto_fuente.aplicado) + ' aplicado. No se sobrescribió: desaplica lo que sobra y vuelve a subir el archivo.</span></div>' : '') +
      '<section class="fin2-p-sec"><h3>Datos</h3><p>Emitida ' + corta(x.fecha) + (nc ? '' : ' · vence <b>' + corta(x.vence) + '</b> <small class="fin2-ayuda">(' + txt(ORIGEN_VENCE[x.vence_origen] || x.vence_origen) + ')</small>') + ' · origen ' + txt(x.origen === 'planilla' ? 'planilla SIGECO' : 'Registro de Ventas del SII') + (x.estado_legado ? ' · estado en la planilla: ' + txt(x.estado_legado) : '') + '</p>' +
        (x.concepto ? '<p class="fin2-ayuda">' + txt(x.concepto) + '</p>' : '') + (x.nota ? '<p class="fin2-ayuda">Nota: ' + txt(x.nota) + '</p>' : '') +
        '<div class="fin2-acciones" data-cap="APLICAR">' + (nc ? U.boton({ texto: 'Factura de referencia', icono: 'editar', sm: true, clase: 'js-fcf-ref' }) : U.boton({ texto: 'Cambiar vencimiento', icono: 'calendario', sm: true, clase: 'js-fcf-vence' })) +
          (x.estado === 'INCOBRABLE' ? U.boton({ texto: 'Reactivar', sm: true, clase: 'js-fcf-estado', datos: { estado: 'VIGENTE' } })
            : x.saldo_confirmado > 0 ? U.boton({ texto: 'Marcar incobrable', sm: true, variante: 'fantasma', clase: 'js-fcf-estado', datos: { estado: 'INCOBRABLE' } }) + U.boton({ texto: 'Anular', sm: true, variante: 'fantasma', clase: 'js-fcf-estado', datos: { estado: 'ANULADA' } }) : '') +
          (ficha.cliente_id ? U.boton({ texto: 'Abrir cliente', icono: 'equipo', sm: true, variante: 'fantasma', clase: 'js-fcf-cliente' }) : '') + '</div></section>' +
      (nc ? '' : '<section class="fin2-p-sec"><h3>Aplicaciones</h3>' + (x.aplicaciones.length ? '<ul class="fin2-hist">' + x.aplicaciones.map(function (a) {
        return '<li><b>' + plata(a.monto) + '</b> del cobro del ' + corta(a.fecha_recepcion) + ' (' + txt(a.cuenta || '') + (a.glosa ? ' · ' + txt(a.glosa) : '') + ') · aplicado el ' + corta(a.fecha_aplicacion) + ' por ' + txt(a.por) +
          ' ' + U.boton({ texto: 'Desaplicar', sm: true, variante: 'fantasma', clase: 'js-fcf-desap', datos: { id: a.id, v: a.version, m: a.monto, cap: 'APLICAR' } }) + '</li>';
      }).join('') + '</ul>' : '<p class="fin2-ayuda">Sin aplicaciones confirmadas.</p>') +
        (x.saldo_confirmado > 0 && x.estado !== 'INCOBRABLE' ? U.boton({ texto: 'Aplicar cobro', icono: 'dinero', sm: true, variante: 'primario', clase: 'js-fcf-aplicar', datos: { cap: 'APLICAR' } }) : '') + '</section>') +
      '</div>');
    if (x_.aplicarCapacidades) x_.aplicarCapacidades(d.el);
    var cerrarY = function () { d.cerrar(); recargar(); };
    d.el.addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      if (b.classList.contains('js-fcf-aplicar')) { d.cerrar(); abrirAplicar([x.id]); }
      else if (b.classList.contains('js-fcf-cliente')) { d.cerrar(); x_.ir('clientes', { cliente_ficha: ficha.cliente_id }); }
      else if (b.classList.contains('js-fcf-desap')) {
        U.formulario({ titulo: 'Desaplicar ' + plata(Number(b.dataset.m)), boton: 'Desaplicar', campos: U.campo('Motivo', '<input name="motivo" class="sx2-input" required maxlength="300">', 'La factura recupera ' + plata(Number(b.dataset.m)) + ' de saldo y ese importe vuelve a estar disponible en el cobro (con su fecha original). El cobro y su evidencia del banco no se tocan.'),
          enviar: function (v) { return x_.api('finanzasDesaplicar', { id: b.dataset.id, expected_version: Number(b.dataset.v), motivo: v.motivo }); },
          aviso: 'Aplicación deshecha.', listo: cerrarY });
      } else if (b.classList.contains('js-fcf-vence')) {
        U.formulario({ titulo: 'Vencimiento de ' + doc(x), boton: 'Guardar',
          campos: '<p class="fin2-ayuda">Hoy: ' + corta(x.vence) + ' (' + txt(ORIGEN_VENCE[x.vence_origen] || '') + '). Usa una fecha acordada o una condición comercial (días desde la emisión); si no hay acuerdo, déjalo por defecto. Queda en la historia.</p>' +
            U.campo('Fecha acordada', '<input type="date" name="vence" class="sx2-input">') + U.campo('o condición (días desde la emisión)', '<input type="number" name="condicion_dias" min="0" max="365" class="sx2-input">') +
            U.campo('Respaldo', '<input name="respaldo" class="sx2-input" maxlength="200" placeholder="Orden de compra, contrato, correo del cliente…">'),
          enviar: function (v) { var o = { id: x.id, expected_version: x.version, respaldo: v.respaldo }; if (v.vence) o.vence = v.vence; else if (v.condicion_dias !== '') o.condicion_dias = v.condicion_dias; else o.vence = ''; return x_.api('finanzasEditarFactura', o); },
          aviso: 'Vencimiento guardado.', listo: cerrarY });
      } else if (b.classList.contains('js-fcf-ref')) {
        U.formulario({ titulo: 'Factura que rebaja ' + doc(x), boton: 'Guardar', campos: U.campo('Folio de la factura (mismo emisor)', '<input name="referencia" class="sx2-input" value="' + txt(x.referencia || '') + '">', 'La nota de crédito rebaja ESA factura una sola vez; sin referencia queda como crédito del cliente.'),
          enviar: function (v) { return x_.api('finanzasEditarFactura', { id: x.id, expected_version: x.version, referencia: v.referencia }); }, aviso: 'Referencia guardada.', listo: cerrarY });
      } else if (b.classList.contains('js-fcf-estado')) {
        var e = b.dataset.estado;
        if (e === 'VIGENTE') { x_.api('finanzasEstadoFactura', { id: x.id, estado: e, expected_version: x.version }).then(function (r) { if (r && r.ok) { x_.aviso('Factura reactivada.', 'exito'); cerrarY(); } else x_.aviso((r && r.message) || 'No se pudo.', 'error'); }); return; }
        U.formulario({ titulo: e === 'ANULADA' ? 'Anular ' + doc(x) : 'Marcar incobrable ' + doc(x), boton: e === 'ANULADA' ? 'Anular' : 'Marcar incobrable', campos: U.campo('Motivo', '<input name="nota" class="sx2-input" required maxlength="300">', e === 'ANULADA' ? 'Con abonos aplicados no se anula: primero se desaplican.' : 'Sale de la cartera por cobrar; queda en la historia.'),
          enviar: function (v) { return x_.api('finanzasEstadoFactura', { id: x.id, estado: e, nota: v.nota, expected_version: x.version }); }, aviso: 'Factura actualizada.', listo: cerrarY });
      }
    });
  }

  /** Nota de crédito: rebaja UNA factura del mismo emisor una sola vez; sin referencia queda como crédito del cliente. */
  function abrirNota(f) {
    U.formulario({ titulo: f.empresa + ' · ' + doc(f) + ' · ' + plata(f.total), boton: 'Guardar referencia',
      campos: '<p class="fin2-ayuda">' + txt(f.cliente) + ' · emitida ' + corta(f.fecha) + ' · hoy: ' + txt(f.situacion) + '.</p>' +
        U.campo('Folio de la factura que rebaja (mismo emisor)', '<input name="referencia" class="sx2-input" value="' + txt(f.referencia || '') + '">', 'Se descuenta una sola vez, aunque el archivo se vuelva a subir. Vacío: queda como crédito del cliente.'),
      enviar: function (v) { return x_.api('finanzasEditarFactura', { id: f.id, expected_version: f.version, referencia: v.referencia }); }, aviso: 'Referencia guardada.', listo: recargar });
  }

  // ---- propuestas (FIFO) de un cliente: se revisan y se aceptan tal cual se vieron ----------
  function revisarSugeridas(clave) {
    x_.api('finanzasFichaCliente', { clave: clave }).then(function (r) {
      if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo.', 'error'); return; }
      var s = r.data.sugerencias;
      if (!s.length) { x_.aviso('Este cliente no tiene propuestas pendientes.', 'info'); return; }
      var recs = {}; r.data.recepciones.forEach(function (p) { recs[p.ref] = p; });
      U.confirmar({ titulo: 'Aceptar ' + s.length + ' aplicación(es) propuesta(s) · ' + plata(s.reduce(function (t, y) { return t + y.monto; }, 0)),
        texto: s.map(function (y) { var p = recs[y.recepcion_ref]; return plata(y.monto) + ' del cobro del ' + (p ? corta(p.fecha) : '?') + ' → F ' + y.folio; }).join(' · ') + '. Se confirman exactamente estas; si algo cambió, se pide revisar de nuevo.', boton: 'Aceptar estas' }).then(function (si) {
        if (!si) return;
        x_.api('finanzasAceptarSugeridasCobro', { clave: clave, digest: r.data.sugerencias_digest }).then(function (q) {
          if (!q || !q.ok) { x_.aviso((q && q.message) || 'No se pudo.', 'error'); return; }
          x_.aviso(q.data.hechos + ' aplicación(es) confirmadas por ' + plata(q.data.monto) + '.', 'exito'); recargar();
        });
      });
    });
  }

  // ---- relaciones de cobro por terceros ---------------------------------------------------
  function abrirRelaciones() {
    var d = U.drawer({ titulo: 'Relaciones de cobro por terceros', subtitulo: '<span class="fin2-ayuda">Habilitan aplicar el cobro de un cliente a facturas de otro, o un cobro que entró a una empresa a facturas de otra. Nada más.</span>', cuerpo: U.esqueleto('tabla', 4) });
    d.el.classList.add('fin2-panel', 'sx2-drawer--ancho');
    var cargar = function () {
      x_.api('finanzasRelacionesCobro', {}).then(function (r) {
        var l = r && r.ok ? r.data.relaciones : [];
        d.cuerpo('<div class="fin2-p">' + (l.length ? '<ul class="fin2-hist">' + l.map(function (y) {
          return '<li><b>' + txt(y.tipo === 'CLIENTE' ? y.pagador + ' paga por ' + y.beneficiario + (y.emisor ? ' (facturas de ' + y.emisor + ')' : ' (cualquier emisor)') : y.recibe + ' cobra facturas de ' + y.emite) + '</b><br>' +
            '<small class="fin2-ayuda">Vigencia ' + (y.desde ? corta(y.desde) : 'sin inicio') + ' → ' + (y.hasta ? corta(y.hasta) : 'sin término') + ' · autorizó ' + txt(y.autorizado_por || y.creado_por) + ' · respaldo: ' + txt(y.motivo) + '</small> ' +
            U.boton({ texto: 'Terminar', sm: true, variante: 'fantasma', clase: 'js-frel-fin', datos: { id: y.id, cap: 'APLICAR' } }) + '</li>';
        }).join('') + '</ul>' : U.vacio({ icono: 'enlace', texto: 'Sin relaciones activas: cada cobro solo paga facturas de su propio cliente y emisor.' })) +
          U.boton({ texto: 'Nueva relación', icono: 'nueva', sm: true, variante: 'primario', clase: 'js-frel-nueva', datos: { cap: 'APLICAR' } }) + '</div>');
        if (x_.aplicarCapacidades) x_.aplicarCapacidades(d.el);
      });
    };
    d.el.addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      if (b.classList.contains('js-frel-fin')) {
        U.formulario({ titulo: 'Terminar relación', boton: 'Terminar', campos: U.campo('Motivo', '<input name="motivo" class="sx2-input" required>', 'Las aplicaciones ya hechas se conservan.'),
          enviar: function (v) { return x_.api('finanzasAnularRelacionCobro', { id: b.dataset.id, motivo: v.motivo }); }, aviso: 'Relación terminada.', listo: cargar });
      } else if (b.classList.contains('js-frel-nueva')) {
        var cl = (cat_.clientes || []).map(function (c) { return [c.id, c.nombre]; });
        U.formulario({ titulo: 'Nueva relación de cobro', boton: 'Guardar', ancho: true,
          campos: '<div class="fin2-form-grid">' + U.campo('Tipo', '<select name="tipo" class="sx2-input">' + opciones([['CLIENTE', 'Un cliente paga por otro'], ['EMPRESA', 'Una empresa cobra facturas de otra']], 'CLIENTE') + '</select>') +
            U.campo('Cliente que paga', '<select name="pagador_id" class="sx2-input">' + opciones(cl, '', '—') + '</select>') + U.campo('Cliente beneficiario', '<select name="beneficiario_id" class="sx2-input">' + opciones(cl, '', '—') + '</select>') +
            U.campo('Solo facturas de (emisor)', '<select name="emisor" class="sx2-input">' + opciones(cat_.empresas || [], '', 'Cualquier emisor') + '</select>') +
            U.campo('Empresa que recibe el cobro', '<select name="recibe" class="sx2-input">' + opciones(cat_.empresas || [], '', '—') + '</select>') + U.campo('Empresa que emite la factura', '<select name="emite" class="sx2-input">' + opciones(cat_.empresas || [], '', '—') + '</select>') +
            U.campo('Vigente desde', '<input type="date" name="desde" class="sx2-input">') + U.campo('Vigente hasta', '<input type="date" name="hasta" class="sx2-input">') +
            U.campo('Autorizado por', '<input name="autorizado_por" class="sx2-input" required>') + U.campo('Respaldo', '<input name="motivo" class="sx2-input" required placeholder="Contrato, instrucción por escrito…">') + '</div>' +
            '<p class="fin2-ayuda">Tipo «cliente»: completa pagador, beneficiario y (si aplica) emisor. Tipo «empresa»: completa quién recibe y quién emite.</p>',
          enviar: function (v) { return x_.api('finanzasGuardarRelacionCobro', v); }, aviso: 'Relación guardada.', listo: cargar });
      }
    });
    cargar();
  }

  // ---- subir facturas -----------------------------------------------------------------------
  function tarjetaSubir() {
    return U.card({ titulo: 'Subir facturas', icono: 'recibo', cuerpo:
      '<p class="fin2-ayuda">Sube el <b>Registro de Ventas del SII</b> de cada mes (Registro de Compras y Ventas › Ventas › <b>Descargar detalles</b>, CSV) o trae la hoja FACTURAS de la planilla SIGECO. Las facturas no se digitan. Después, SIGSO <b>propondrá</b> a qué factura va cada cobro y una persona lo revisará.</p>' +
      '<div class="fin2-fila-bot" data-cap="REGISTRAR">' +
        '<label class="sx2-boton sx2-boton--primario" style="cursor:pointer"><input type="file" accept=".csv,.gz,.txt" class="js-fcb-ventas" hidden>' + U.ico('subir', 16) + 'Subir ventas del SII</label>' +
        '<label class="sx2-boton sx2-boton--secundario" style="cursor:pointer"><input type="file" accept=".xlsx" class="js-fcb-planilla" hidden>' + U.ico('documento', 16) + 'Traer de la planilla SIGECO</label>' +
      '</div><div id="fcb-ventas"></div>' });
  }
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
        if (r && r.ok) { est_.ventas.estado = 'lista'; est_.ventas.rev = r.data; est_.ventas.empresa = r.data.empresa_sugerida || ''; }
        else { est_.ventas.estado = 'error'; est_.ventas.error = (r && r.message) || 'No se pudo leer.'; }
      });
    }).catch(function (e) { est_.ventas.estado = 'error'; est_.ventas.error = e.message || 'No se pudo leer el archivo.'; }).then(pintarVentas);
  }
  function pintarVentas() {
    var el = document.getElementById('fcb-ventas'), v = est_.ventas;
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
        '<select class="fin2-input js-fcb-vemp">' + opciones(cat_.empresas || [], v.empresa, 'Elige…') + '</select></label>' +
      '<div class="fin2-acciones">' + U.boton({ texto: 'Descartar', clase: 'js-fcb-descartar' }) +
        U.boton({ texto: r.nuevas ? 'Importar ' + r.nuevas + ' documento(s)' : 'Nada nuevo', icono: 'check', variante: 'primario', clase: 'js-fcb-importar', deshabilitado: !r.nuevas }) + '</div></div>';
  }
  function traerPlanilla(f) {
    SigsoLectorXlsx.leer(f, { hojas: function (n) { return n === 'FACTURAS'; } }).then(function (hojas) {
      if (!hojas.length) { x_.aviso('Ese Excel no tiene la hoja FACTURAS.', 'error'); return; }
      return x_.api('finanzasImportarFacturasPlanilla', { filas: hojas[0].filas, archivo: f.name }).then(function (r) {
        if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo leer la planilla.', 'error'); return; }
        x_.aviso(r.data.nuevas + ' factura(s) traídas de la planilla' + (r.data.sin_cliente ? ' · ' + r.data.sin_cliente + ' sin cliente reconocido' : '') + '.', 'exito');
        recargar();
      });
    }).catch(function () { x_.aviso('El archivo no es un Excel válido.', 'error'); });
  }

  // =====================================================================================
  var enlazado_ = false, buscaT_ = null;
  function enlazar() {
    var raiz = x_.raiz();
    if (enlazado_ || !raiz) return;
    enlazado_ = true;
    var activa = function () { return !!raiz.querySelector('.fin2-fact') || !!raiz.querySelector('#fcb-ventas'); };
    raiz.addEventListener('change', function (ev) {
      var e = ev.target;
      if (!activa()) return;
      if (e.classList.contains('js-fcb-ventas')) { if (e.files[0]) subirVentas(e.files[0]); e.value = ''; }
      else if (e.classList.contains('js-fcb-planilla')) { if (e.files[0]) traerPlanilla(e.files[0]); e.value = ''; }
      else if (e.classList.contains('js-fcb-vemp') && est_.ventas) est_.ventas.empresa = e.value;
      else if (e.classList.contains('js-fcb-emp')) { est_.empresa = e.value; recargar(); }
      else if (e.classList.contains('js-fcb-cli')) { est_.clave = e.value; recargar(); }
      else if (e.classList.contains('js-fcb-vence')) { est_.vence_hasta = e.value; recargar(); }
      else if (e.classList.contains('js-fcb-sel')) { est_.sel[e.dataset.id] = e.checked; var y = window.scrollY; pintar(); window.scrollTo(0, y); }
    });
    raiz.addEventListener('input', function (ev) {
      if (!ev.target.classList.contains('js-fcb-busca')) return;
      est_.busca = ev.target.value;
      clearTimeout(buscaT_); buscaT_ = setTimeout(recargar, 350);
    });
    raiz.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b || !activa()) return;
      if (b.classList.contains('js-fcb-estado') && b.dataset.id) { est_.estado = b.dataset.id; recargar(); }
      else if (b.classList.contains('js-fcb-ver')) abrirFactura(b.dataset.id);
      else if (b.classList.contains('js-fcb-aplicar')) abrirAplicar([b.dataset.id]);
      else if (b.classList.contains('js-fcb-aplicar-sel')) {
        var ids = marcadas();
        var clis = {}; ids.forEach(function (id) { var f = factura(id); if (f) clis[f.cliente_id + '|' + f.empresa] = 1; });
        if (Object.keys(clis).length > 1) x_.aviso('Marcaste facturas de distintos clientes o emisores: solo verás los cobros que sirvan para TODAS (por una relación de terceros).', 'info');
        abrirAplicar(ids);
      }
      else if (b.classList.contains('js-fcb-rel')) abrirRelaciones();
      else if (b.classList.contains('js-fcb-sug')) revisarSugeridas(b.dataset.clave);
      else if (b.classList.contains('js-fcb-todos')) { est_.clave = ''; est_.estado = 'abiertas'; recargar(); }
      else if (b.classList.contains('js-fcb-descartar')) { est_.ventas = null; pintarVentas(); }
      else if (b.classList.contains('js-fcb-importar')) {
        if (!est_.ventas.empresa) { x_.aviso('Elige la empresa que emitió estas facturas.', 'error'); return; }
        b.disabled = true;
        x_.api('finanzasImportarVentas', { texto: est_.ventas.texto, nombre: est_.ventas.nombre, empresa: est_.ventas.empresa }).then(function (r) {
          if (!r || !r.ok) { b.disabled = false; x_.aviso((r && r.message) || 'No se pudo importar.', 'error'); return; }
          var c = r.data.conflictos || [];
          x_.aviso(r.data.nuevas + ' documento(s) nuevos' + (r.data.actualizadas ? ', ' + r.data.actualizadas + ' actualizados desde el SII' : '') + (c.length ? ' · ' + c.length + ' factura(s) NO se actualizaron porque tienen más aplicado que el total nuevo (F ' + c.map(function (y) { return y.folio; }).join(', F ') + '): revísalas.' : '') + '.', c.length ? 'info' : 'exito');
          est_.ventas = null; recargar();
        });
      }
    });
  }

  window.SigsoFinanzasCobranza = { ver: ver, reiniciar: function () { est_.sel = {}; } };
})();
