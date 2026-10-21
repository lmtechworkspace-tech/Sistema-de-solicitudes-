/**
 * finanzas-clientes-v2.js — Clientes de Finanzas (2026-10-20; FIN-03, FIN-04,
 * FIN-21, FIN-27; backend/logica/finanzasClientes.js).
 *
 * El maestro de clientes sigue siendo el de SIGSO: aquí se agrega lo
 * comercial (alias, código de la planilla, canal, vendedor, empresa que
 * factura), los servicios con su historia, los documentos (nota de venta,
 * contrato…) con adjuntos cifrados y la asignación a proyectos con
 * porcentaje y vigencia. La ficha muestra cobranza y fondos POR SEPARADO:
 * lo que el cliente debe y la plata suya que la empresa administra no se
 * compensan.
 */
(function () {
  'use strict';

  var U = UIv2;
  var x_ = null, cat_ = null;
  var est_ = { d: null, busca: '', filtro: '', f: null };
  // I12.2/I12.4: al cerrarse la bóveda, la pantalla olvida las cifras que tenía cargadas.
  document.addEventListener('sigso-fin-cerrada', function () { est_.d = null; est_.f = null; });

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function plata(n) { if (n === null || n === undefined) return '—'; var v = Math.round(Number(n) || 0); return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('es-CL'); }
  function opciones(l, actual, vacio) { return (vacio !== undefined ? '<option value="">' + txt(vacio) + '</option>' : '') + l.map(function (o) { var id = Array.isArray(o) ? o[0] : o, n = Array.isArray(o) ? o[1] : o; return '<option value="' + txt(id) + '"' + (String(id) === String(actual) ? ' selected' : '') + '>' + txt(n) + '</option>'; }).join(''); }
  function nombres(tipo) { return ((cat_ && cat_[tipo]) || []).map(function (x) { return [x.nombre || x.id, x.nombre || x.id]; }); }

  function ver(x) {
    x_ = x; enlazar();
    var t = x.turno();
    x.pagina(x.cab('clientes') + U.esqueleto('tabla', 10));
    Promise.all([x.catalogo(), x.api('finanzasClientes', { busca: est_.busca, estado: est_.filtro })]).then(function (rs) {
      if (!x.vigente(t)) return;
      cat_ = rs[0];
      var r = rs[1];
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('clientes') + U.card({ cuerpo: U.vacio({ accion: '<button type="button" class="sx2-boton sx2-boton--secundario sx2-boton--sm js-fin-reintentar">Reintentar</button>', icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || '' }) })); return; }
      est_.d = r.data;
      pintar();
      var abrir = x.contexto().cliente_ficha;
      if (abrir) { x.contexto({ cliente_ficha: '' }); ficha(abrir); }
    });
  }
  function pintar() {
    var d = est_.d;
    x_.pagina(x_.cab('clientes') +
      '<div class="fin2-ctx"><label class="fin2-busca">' + U.ico('lupa', 14) + '<input class="js-fcl-busca" type="search" placeholder="Nombre, RUT, alias o código" value="' + txt(est_.busca) + '" aria-label="Buscar cliente"></label>' +
        '<label class="fin2-campo fin2-campo--fila"><span>Estado</span><select class="fin2-input fin2-input--sm js-fcl-estado">' + opciones(d.estados, est_.filtro, 'Todos') + '</select></label>' +
        '<span class="fin2-ayuda">' + d.total + ' cliente(s) de SIGSO</span></div>' +
      U.card({ sinRelleno: true, cuerpo: d.clientes.length ? '<div class="fin2-tabla-envoltura"><table class="fin2-tabla fin2-tabla--clic"><thead><tr><th>Cliente</th><th>RUT</th><th>Alias / código</th><th>Factura</th><th>Canal · vendedor</th><th class="fin2-der">Mensual neto</th><th>Estado</th></tr></thead><tbody>' +
        d.clientes.map(function (c) {
          return '<tr class="js-fcl-cli" data-id="' + txt(c.cliente_id) + '" tabindex="0"><td><b>' + txt(c.cliente) + '</b></td><td class="fin2-num">' + txt(c.rut) + (c.rut_valido ? '' : ' ' + U.badge('RUT no válido', 'alerta')) + '</td>' +
            '<td>' + txt(c.alias.slice(0, 3).join(', ')) + (c.codigo_legado ? ' <small class="fin2-ayuda">' + txt(c.codigo_legado) + '</small>' : '') + '</td><td>' + txt(c.empresa_facturadora || '—') + '</td>' +
            '<td>' + txt([c.canal, c.vendedor].filter(Boolean).join(' · ') || '—') + '</td><td class="fin2-der fin2-num">' + (c.mensual_neto ? plata(c.mensual_neto) : '—') + '</td><td>' + (c.estado ? U.badge(c.estado, c.estado === 'Activo' ? 'ok' : 'neutro') : '<span class="fin2-ayuda">sin ficha</span>') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : U.vacio({ icono: 'persona', titulo: 'Sin clientes', texto: 'Ajusta la búsqueda. Los clientes se crean en SIGSO; aquí se completa lo comercial.' }) }));
  }

  // ---- ficha 360 ---------------------------------------------------------------------------
  function ficha(id) {
    if (!est_.f || est_.f.cliente_id !== id) est_.pestana = 'resumen';
    Promise.all([x_.api('finanzasCliente', { cliente_id: id }), x_.api('finanzasProyectos')]).then(function (rs) {
      var r = rs[0];
      if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo abrir.', 'error'); return; }
      est_.f = r.data; est_.proyectos = rs[1] && rs[1].ok ? rs[1].data.proyectos : [];
      pintarFicha();
    });
  }
  function pintarFicha() {
    var f = est_.f, fi = f.ficha || {};
    var nomProy = function (id) { var p = (est_.proyectos || []).filter(function (y) { return y.id === id; })[0]; return p ? (p.codigo ? p.codigo + ' · ' : '') + p.nombre : id; };
    var SECC = [['resumen', 'Resumen'], ['cobranza', 'Cobranza'], ['fondos', 'Fondos'], ['servicios', 'Servicios y documentos'], ['historial', 'Historial']];
    var pest = SECC.some(function (p) { return p[0] === est_.pestana; }) ? est_.pestana : 'resumen';
    var sec = function (id, html) { return '<div class="fin2-ficha-sec" role="tabpanel" id="fcl-sec-' + id + '" aria-labelledby="fcl-tab-' + id + '"' + (id === pest ? '' : ' hidden') + '>' + html + '</div>'; };
    var facts = (f.cobranza && f.cobranza.facturas) || [];
    var cuerpo = '<div class="fin2-p">' +
      '<div class="fin2-ficha-grid">' +
        '<div class="fin2-ficha-caja"><small>Cobranza (lo que debe)</small>' + (f.cobranza ? '<b class="fin2-num">' + plata(f.cobranza.por_cobrar) + '</b><span>Vencido ' + plata(f.cobranza.vencido) + ' · ' + f.cobranza.facturas_abiertas + ' factura(s) abiertas' + (f.cobranza.sin_aplicar ? ' · ' + plata(f.cobranza.sin_aplicar) + ' cobrados sin aplicar' : '') + '</span>' +
          '<button type="button" class="sx2-enlace js-fcl-ir" data-vista="cobranza">Ver cobranza</button>' : '<span class="fin2-ayuda">Sin facturas.</span>') + '</div>' +
        '<div class="fin2-ficha-caja"><small>Fondos del cliente (plata de él)</small>' + (f.fondos ? '<b class="fin2-num ' + (f.fondos.saldo < 0 ? 'fin2-neg' : '') + '">' + plata(f.fondos.saldo) + '</b><span>' + f.fondos.abiertas + ' gestión(es) abiertas' + (f.fondos.parcial ? ' · ' + U.badge('Parcial', 'alerta') : '') + '</span>' +
          '<button type="button" class="sx2-enlace js-fcl-ir" data-vista="fondos">Ver fondos</button>' : '<span class="fin2-ayuda">Sin fondos.</span>') + '</div>' +
      '</div><p class="fin2-ayuda">Son cuentas distintas: un saldo a favor en fondos no paga sus facturas, ni al revés.</p>' +
      '<div class="fin2-ficha-tabs" role="tablist" aria-label="Secciones de la ficha">' + SECC.map(function (p) {
        return '<button type="button" role="tab" id="fcl-tab-' + p[0] + '" class="fin2-ficha-tab js-fcl-tab" data-id="' + p[0] + '" aria-controls="fcl-sec-' + p[0] + '" aria-selected="' + (p[0] === pest) + '" tabindex="' + (p[0] === pest ? '0' : '-1') + '">' + txt(p[1]) +
          (p[0] === 'cobranza' && facts.length ? ' <span class="fin2-chip__n">' + facts.length + '</span>' : '') + '</button>';
      }).join('') + '</div>' +
      sec('resumen', '<section class="fin2-p-sec"><h3>Ficha comercial</h3><form class="fin2-form-grid js-fcl-ficha">' +
        U.campo('Estado', '<select name="estado" class="sx2-input">' + opciones(f.estados_cliente, fi.estado, '—') + '</select>') +
        U.campo('Empresa que factura', '<select name="empresa_facturadora" class="sx2-input">' + opciones((cat_.empresas || []), fi.empresa_facturadora, '—') + '</select>') +
        U.campo('Canal', '<select name="canal" class="sx2-input">' + opciones(nombres('canales'), fi.canal, '—') + '</select>') +
        U.campo('Vendedor', '<select name="vendedor" class="sx2-input">' + opciones(nombres('vendedores'), fi.vendedor, '—') + '</select>') +
        U.campo('Fecha de ingreso', '<input type="date" name="fecha_ingreso" class="sx2-input" value="' + txt(fi.fecha_ingreso || '') + '">') +
        U.campo('Código de la planilla', '<input name="codigo_legado" class="sx2-input" value="' + txt(fi.codigo_legado || '') + '">') +
        U.campo('Alias (cómo aparece en el banco; separados por coma)', '<input name="alias" class="sx2-input" value="' + txt((fi.alias || []).join(', ')) + '">', 'Un alias no puede ser de dos clientes: así no se mezclan.') +
        U.campo('Observaciones', '<input name="obs" class="sx2-input" value="' + txt(fi.obs || '') + '">') +
        '<div class="fin2-acciones" data-cap="CLIENTES">' + U.boton({ texto: 'Guardar ficha', icono: 'check', sm: true, variante: 'primario', clase: 'js-fcl-guardar' }) + '</div></form>' +
        (fi.rut_original && fi.rut_original !== f.rut ? '<p class="fin2-ayuda">RUT en la planilla original: ' + txt(fi.rut_original) + '</p>' : '') + '</section>') +
      sec('cobranza', '<section class="fin2-p-sec"><h3>Facturas</h3>' + (facts.length ? '<ul class="fin2-lista-saldos">' + facts.map(function (x) {
        return '<li><span><b>' + txt(x.empresa + ' · F ' + x.folio) + '</b> ' + U.badge(x.situacion || '—', x.saldo_confirmado > 0 ? 'alerta' : 'ok') + '<small>Emitida ' + txt(x.fecha || '') + ' · total ' + plata(x.total) + '</small></span><b class="fin2-num">' + plata(x.saldo_confirmado) + '</b></li>';
      }).join('') + '</ul>' : '<p class="fin2-ayuda">Sin facturas.</p>') +
        (f.cobranza ? '<button type="button" class="sx2-enlace js-fcl-ir" data-vista="cobranza">Abrir en Cobranza para aplicar cobros</button>' : '') + '</section>') +
      sec('fondos', '<section class="fin2-p-sec"><h3>Fondos administrados</h3>' + (f.fondos ? '<p>Saldo <b class="fin2-num ' + (f.fondos.saldo < 0 ? 'fin2-neg' : '') + '">' + plata(f.fondos.saldo) + '</b> · ' + f.fondos.abiertas + ' gestión(es) abiertas' + (f.fondos.parcial ? ' · ' + U.badge('Parcial', 'alerta') : '') + '</p>' +
        '<button type="button" class="sx2-enlace js-fcl-ir" data-vista="fondos">Abrir en Fondos (gestiones, saldos iniciales, remanentes)</button>' : '<p class="fin2-ayuda">Este cliente no tiene fondos administrados.</p>') + '</section>') +
      sec('servicios', '<section class="fin2-p-sec"><h3>Servicios</h3>' + (f.servicios.length ? '<ul class="fin2-lista-saldos">' + f.servicios.map(function (s) {
        return '<li><span><b>' + txt(s.servicio) + '</b> ' + U.badge(s.estado === 'VIGENTE' ? 'Vigente' : s.estado === 'TERMINADO' ? 'Terminado' : 'Anulado', s.estado === 'VIGENTE' ? 'ok' : 'neutro') +
          '<small>' + txt(s.modalidad === 'MENSUAL' ? 'Mensual' : 'Única') + (s.dia_facturacion ? ' · factura el día ' + s.dia_facturacion : '') + (s.empresa ? ' · ' + txt(s.empresa) : '') + ' · ' + txt(s.desde || '¿desde?') + ' → ' + txt(s.hasta || 'sin término') + (s.historial && s.historial.length ? ' · ' + s.historial.length + ' cambio(s)' : '') + '</small></span>' +
          '<b class="fin2-num">' + (s.monto_neto === null ? '—' : plata(s.monto_neto)) + '</b>' + U.boton({ texto: 'Editar', sm: true, variante: 'fantasma', clase: 'js-fcl-serv', datos: { id: s.id, cap: 'CLIENTES' } }) + '</li>';
      }).join('') + '</ul>' : '<p class="fin2-ayuda">Sin servicios registrados.</p>') + U.boton({ texto: 'Agregar servicio', icono: 'nueva', sm: true, clase: 'js-fcl-serv', datos: { cap: 'CLIENTES' } }) + '</section>' +
      '<section class="fin2-p-sec"><h3>Documentos</h3>' + (f.documentos.length ? '<ul class="fin2-lista-saldos">' + f.documentos.map(function (d) {
        return '<li><span><b>' + txt(f.tipos_documento[d.tipo]) + (d.numero ? ' N° ' + txt(d.numero) : '') + '</b> ' + U.badge(f.estados_documento[d.estado], d.estado === 'VIGENTE' ? 'ok' : d.estado === 'BORRADOR' ? 'info' : 'neutro') +
          (d.emitido_externamente ? ' ' + U.badge('Emitido fuera: ' + d.referencia_externa, 'neutro') : '') + '<small>' + txt(d.titulo || '') + ' · ' + txt(d.fecha || '') + '</small>' +
          ((d.factura_ids || []).length && f.cobranza && f.cobranza.facturas ? '<small>Facturas: ' + d.factura_ids.map(function (id) { var x = f.cobranza.facturas.filter(function (y) { return y.id === id; })[0]; return x ? txt(x.empresa + ' F ' + x.folio + ' (' + x.situacion + ')') : ''; }).filter(Boolean).join(' · ') + '</small>' : '') +
          ((d.adjuntos || []).length ? '<small>' + d.adjuntos.map(function (a) { return '<button type="button" class="sx2-enlace js-fcl-adj" data-id="' + txt(a.id) + '">' + U.ico('adjunto', 12) + txt(a.nombre) + '</button>'; }).join(' ') + '</small>' : '') + '</span>' +
          '<span class="fin2-acciones-min" data-cap="CLIENTES">' + U.boton({ texto: 'Adjuntar', sm: true, variante: 'fantasma', clase: 'js-fcl-subir', datos: { id: d.id } }) + U.boton({ texto: 'Editar', sm: true, variante: 'fantasma', clase: 'js-fcl-doc', datos: { id: d.id } }) + '</span></li>';
      }).join('') + '</ul>' : '<p class="fin2-ayuda">Sin documentos.</p>') + U.boton({ texto: 'Agregar documento', icono: 'nueva', sm: true, clase: 'js-fcl-doc', datos: { cap: 'CLIENTES' } }) +
        '<p class="fin2-ayuda">Un documento aquí NO es una factura emitida: la emisión tributaria se hace en su sistema; si se emitió fuera, se marca con su referencia.</p></section>' +
      '<section class="fin2-p-sec"><h3>Proyectos</h3>' + (f.asignaciones.length ? '<ul class="fin2-lista-saldos">' + f.asignaciones.map(function (a) {
        return '<li><span>' + txt(nomProy(a.proyecto_id)) + '<small>' + txt(a.desde || '¿desde?') + ' → ' + txt(a.hasta || 'vigente') + '</small></span><b class="fin2-num">' + txt(String(a.porcentaje).replace('.', ',')) + ' %</b></li>';
      }).join('') + '</ul>' : '<p class="fin2-ayuda">Sin proyectos asignados.</p>') + U.boton({ texto: 'Asignar a proyecto', icono: 'nueva', sm: true, clase: 'js-fcl-asig', datos: { cap: 'CLIENTES' } }) + '</section>') +
      sec('historial', '<section class="fin2-p-sec"><h3>Últimos movimientos</h3>' + (f.operaciones.length ? '<ul class="fin2-piezas">' + f.operaciones.map(function (o) {
        return '<li><span class="fin2-num">' + txt(o.fecha) + '</span><span>' + txt(o.cuenta || o.tipo) + '<small>' + txt(o.glosa || '') + ' · ' + txt(o.fuente === 'REGISTRO' ? 'registro' : 'banco') + ' · ' + txt(o.empresa) + '</small></span><b class="fin2-num ' + (o.monto > 0 ? 'fin2-pos' : '') + '">' + plata(o.monto) + '</b></li>';
      }).join('') + '</ul>' : '<p class="fin2-ayuda">Sin movimientos con este cliente.</p>') + '</section>') +
    '</div>';
    var d = U.drawer({ titulo: f.cliente, subtitulo: '<span class="fin2-ayuda">' + txt(f.rut) + (f.rut_valido ? '' : ' · RUT no válido (se conserva tal cual)') + '</span>', cuerpo: cuerpo });
    d.el.classList.add('fin2-panel', 'sx2-drawer--ancho');
    x_.aplicarCapacidades(d.el);
    var reabrir = function () { ficha(f.cliente_id); };
    var elegir = function (id, foco) {
      est_.pestana = id;
      Array.prototype.forEach.call(d.el.querySelectorAll('.js-fcl-tab'), function (t) { var on = t.dataset.id === id; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; if (on && foco) t.focus(); });
      Array.prototype.forEach.call(d.el.querySelectorAll('.fin2-ficha-sec'), function (p) { p.hidden = p.id !== 'fcl-sec-' + id; });
    };
    d.el.addEventListener('keydown', function (ev) {
      var t = ev.target.closest && ev.target.closest('.js-fcl-tab'); if (!t || (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft')) return;
      var tabs = Array.prototype.slice.call(d.el.querySelectorAll('.js-fcl-tab')), i = tabs.indexOf(t) + (ev.key === 'ArrowRight' ? 1 : -1);
      ev.preventDefault(); elegir(tabs[(i + tabs.length) % tabs.length].dataset.id, true);
    });
    d.el.addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      if (b.classList.contains('js-fcl-tab')) { elegir(b.dataset.id); return; }
      if (b.classList.contains('js-fcl-guardar')) {
        var form = d.el.querySelector('.js-fcl-ficha'), v = {};
        new FormData(form).forEach(function (val, k) { v[k] = String(val).trim(); });
        b.disabled = true;
        x_.api('finanzasGuardarFicha', Object.assign(v, { cliente_id: f.cliente_id, expected_version: fi.version })).then(function (r) {
          b.disabled = false;
          if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo guardar.', r && r.codigo === 'CONFLICTO_VERSION' ? 'alerta' : 'error'); if (r && r.codigo === 'CONFLICTO_VERSION') reabrir(); return; }
          x_.aviso('Ficha guardada.', 'exito'); x_.catalogo(true); reabrir();
        });
      } else if (b.classList.contains('js-fcl-serv')) formServicio(f, f.servicios.filter(function (s) { return s.id === b.dataset.id; })[0], reabrir);
      else if (b.classList.contains('js-fcl-doc')) formDocumento(f, f.documentos.filter(function (s) { return s.id === b.dataset.id; })[0], reabrir);
      else if (b.classList.contains('js-fcl-asig')) formAsignacion(f, reabrir);
      else if (b.classList.contains('js-fcl-subir')) subir(b.dataset.id, reabrir);
      else if (b.classList.contains('js-fcl-adj')) x_.api('finanzasDescargarAdjunto', { id: b.dataset.id }).then(function (r) { if (r && r.ok) descargar(r.data.base64, r.data.nombre, r.data.tipo); else x_.aviso((r && r.message) || 'No se pudo.', 'error'); });
      else if (b.classList.contains('js-fcl-ir')) {
        // I08.7: al volver desde Cobranza o Fondos se reabre esta misma ficha.
        d.cerrar(true);
        x_.ir(b.dataset.vista, Object.assign({ volver_a: 'clientes', cliente_ficha: f.cliente_id }, b.dataset.vista === 'fondos' ? { cliente_fondos: f.cliente_id } : { cliente_cobranza: f.cliente_id }));
      }
    });
  }
  function descargar(b64, nombre, mime) {
    var bin = atob(b64), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    var url = URL.createObjectURL(new Blob([u], { type: mime || 'application/octet-stream' }));
    var a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function formServicio(f, s, listo) {
    s = s || {};
    U.formulario({ titulo: s.id ? 'Editar servicio' : 'Nuevo servicio', boton: 'Guardar', ancho: true,
      campos: '<div class="fin2-form-grid">' + U.campo('Servicio', '<input name="servicio" class="sx2-input" required value="' + txt(s.servicio || '') + '">') +
        U.campo('Modalidad', '<select name="modalidad" class="sx2-input">' + opciones([['MENSUAL', 'Mensual'], ['UNICA', 'Única']], s.modalidad || 'MENSUAL') + '</select>') +
        U.campo('Monto neto', '<input name="monto_neto" class="sx2-input" inputmode="numeric" value="' + txt(s.monto_neto === null || s.monto_neto === undefined ? '' : s.monto_neto) + '">') +
        U.campo('Día de facturación', '<input name="dia_facturacion" type="number" min="1" max="31" class="sx2-input" value="' + txt(s.dia_facturacion || '') + '">') +
        U.campo('Empresa', '<select name="empresa" class="sx2-input">' + opciones((cat_.empresas || []), s.empresa, '—') + '</select>') +
        U.campo('Estado', '<select name="estado" class="sx2-input">' + opciones([['VIGENTE', 'Vigente'], ['TERMINADO', 'Terminado'], ['ANULADO', 'Anulado']], s.estado || 'VIGENTE') + '</select>') +
        U.campo('Desde', '<input type="date" name="desde" class="sx2-input" value="' + txt(s.desde || '') + '">') + U.campo('Hasta', '<input type="date" name="hasta" class="sx2-input" value="' + txt(s.hasta || '') + '">') +
        U.campo('Nota', '<input name="nota" class="sx2-input" value="' + txt(s.nota || '') + '">') + '</div>' +
        (s.id ? '<p class="fin2-ayuda">Para cambiar el precio de un servicio con historia, termínalo y crea uno nuevo: así el pasado no cambia.</p>' : ''),
      preparar: function (v) { return Object.assign(v, { cliente_id: f.cliente_id, id: s.id, expected_version: s.version }); },
      enviar: function (v) { return x_.api('finanzasGuardarServicio', v); }, aviso: 'Servicio guardado.', listo: listo });
  }
  function formDocumento(f, d, listo) {
    d = d || {};
    U.formulario({ titulo: d.id ? 'Editar documento' : 'Nuevo documento', boton: 'Guardar', ancho: true,
      campos: '<div class="fin2-form-grid">' + U.campo('Tipo', '<select name="tipo" class="sx2-input" required>' + opciones(Object.keys(f.tipos_documento).map(function (k) { return [k, f.tipos_documento[k]]; }), d.tipo || 'NOTA_VENTA') + '</select>') +
        U.campo('Estado', '<select name="estado" class="sx2-input">' + opciones(Object.keys(f.estados_documento).map(function (k) { return [k, f.estados_documento[k]]; }), d.estado || 'BORRADOR') + '</select>') +
        U.campo('Número', '<input name="numero" class="sx2-input" value="' + txt(d.numero || '') + '">') + U.campo('Fecha', '<input type="date" name="fecha" class="sx2-input" value="' + txt(d.fecha || '') + '">') +
        U.campo('Título', '<input name="titulo" class="sx2-input" value="' + txt(d.titulo || '') + '">') +
        U.campo('Vigencia desde', '<input type="date" name="vigencia_desde" class="sx2-input" value="' + txt(d.vigencia_desde || '') + '">') + U.campo('Vigencia hasta', '<input type="date" name="vigencia_hasta" class="sx2-input" value="' + txt(d.vigencia_hasta || '') + '">') +
        U.campo('Servicios que cubre', '<select name="servicio_ids" class="sx2-input" multiple size="3">' + f.servicios.map(function (s) { return '<option value="' + txt(s.id) + '"' + ((d.servicio_ids || []).indexOf(s.id) !== -1 ? ' selected' : '') + '>' + txt(s.servicio) + '</option>'; }).join('') + '</select>') +
        U.campo('Facturas relacionadas', '<select name="factura_ids" class="sx2-input" multiple size="4">' + ((f.cobranza && f.cobranza.facturas) || []).map(function (x) { return '<option value="' + txt(x.id) + '"' + ((d.factura_ids || []).indexOf(x.id) !== -1 ? ' selected' : '') + '>' + txt(x.empresa + ' · F ' + x.folio + ' · ' + x.fecha) + '</option>'; }).join('') + '</select>', 'Opcional: no toda recepción necesita una nota de venta. Relacionarla no emite ni paga la factura.') +
        '<label class="sx2-campo fin2-check"><input type="checkbox" name="emitido_externamente" value="1"' + (d.emitido_externamente ? ' checked' : '') + '><span>Se emitió fuera de SIGSO</span></label>' +
        U.campo('Referencia externa (folio, sistema, fecha)', '<input name="referencia_externa" class="sx2-input" value="' + txt(d.referencia_externa || '') + '">') +
        U.campo('Nota', '<input name="nota" class="sx2-input" value="' + txt(d.nota || '') + '">') + '</div>',
      preparar: function (v, form) {
        v.servicio_ids = Array.prototype.map.call(form.querySelectorAll('[name="servicio_ids"] option:checked'), function (o) { return o.value; });
        var fsel = Array.prototype.map.call(form.querySelectorAll('[name="factura_ids"] option:checked'), function (o) { return o.value; });
        v.emitido_externamente = v.emitido_externamente === '1';
        return Object.assign(v, { cliente_id: f.cliente_id, id: d.id, expected_version: d.version, factura_ids: fsel, operacion_ids: d.operacion_ids || [] });
      },
      enviar: function (v) { return x_.api('finanzasGuardarDocumento', v); }, aviso: 'Documento guardado.', listo: listo });
  }
  function formAsignacion(f, listo) {
    U.formulario({ titulo: 'Asignar a un proyecto', boton: 'Guardar',
      campos: U.campo('Proyecto', '<select name="proyecto_id" class="sx2-input" required>' + opciones((est_.proyectos || []).map(function (p) { return [p.id, (p.codigo ? p.codigo + ' · ' : '') + p.nombre + ' (' + p.fuente + ')']; }), '', 'Elige…') + '</select>') +
        U.campo('Porcentaje', '<input name="porcentaje" class="sx2-input" required placeholder="0 a 100">', '0 % es 0 %: queda registrado, no se toma como «sin dato».') +
        U.campo('Desde', '<input type="date" name="desde" class="sx2-input">', 'Si ya tenía un porcentaje, el anterior se cierra el día antes.') + U.campo('Nota', '<input name="nota" class="sx2-input">'),
      preparar: function (v) { return Object.assign(v, { cliente_id: f.cliente_id }); },
      enviar: function (v) { return x_.api('finanzasGuardarAsignacion', v); }, aviso: 'Asignación guardada.', listo: listo });
  }
  function subir(docId, listo) {
    var inp = document.createElement('input'); inp.type = 'file';
    inp.addEventListener('change', function () {
      var a = inp.files && inp.files[0]; if (!a) return;
      if (a.size > 5 * 1024 * 1024) { x_.aviso('El archivo pesa más de 5 MB.', 'error'); return; }
      U.leerBase64(a).then(function (b64) { return x_.api('finanzasSubirAdjunto', { documento_id: docId, nombre: a.name, tipo: a.type, base64: b64 }); })
        .then(function (r) { if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo subir.', 'error'); return; } x_.aviso('Adjunto guardado (cifrado).', 'exito'); listo(); });
    });
    inp.click();
  }

  var enlazado_ = false;
  function enlazar() {
    var raiz = x_.raiz();
    if (enlazado_ || !raiz) return;
    enlazado_ = true;
    raiz.addEventListener('input', function (ev) {
      if (!ev.target.classList.contains('js-fcl-busca')) return;
      clearTimeout(est_.bt); var v = ev.target.value;
      est_.bt = setTimeout(function () {
        est_.busca = v;
        x_.api('finanzasClientes', { busca: v, estado: est_.filtro }).then(function (r) { if (r && r.ok && document.querySelector('.js-fcl-busca')) { est_.d = r.data; pintar(); var b = document.querySelector('.js-fcl-busca'); b.focus(); b.setSelectionRange(v.length, v.length); } });
      }, 250);
    });
    raiz.addEventListener('change', function (ev) { if (ev.target.classList.contains('js-fcl-estado')) { est_.filtro = ev.target.value; ver(x_); } });
    raiz.addEventListener('click', function (ev) { var tr = ev.target.closest('.js-fcl-cli'); if (tr) ficha(tr.dataset.id); });
    raiz.addEventListener('keydown', function (ev) { var tr = ev.target.closest && ev.target.closest('.js-fcl-cli'); if (tr && ev.key === 'Enter') ficha(tr.dataset.id); });
  }

  window.SigsoFinanzasClientes = { ver: ver, ficha: ficha };
})();
