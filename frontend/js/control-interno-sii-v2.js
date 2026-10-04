/**
 * control-interno-sii-v2.js — Recibir desde el SII: F29 y Registro de
 * Compras y Ventas (2026-10-01; backend/logica/controlInternoSII.js).
 *
 * Llega por el marcador "Enviar a SIGSO" (la página que la persona tiene
 * abierta en el SII), por el CSV de "Descargar detalles" del RCV (o su .gz) o
 * pegando la página. SIGSO muestra contra qué fila de qué matriz se compara y
 * qué cambia; se aplica solo lo marcado. Vista `sii` (la elige control-interno-v2.js).
 */
(function () {
  'use strict';

  var U = UIv2;
  var PY = window.PYv2;
  var x_ = null;
  var entrada_ = null, visto_ = 0, turno_ = 0;
  var sel_ = { cliente: '', periodo: '', tipo: '' }, rev_ = null, error_ = '', hecho_ = '', usar_ = {}, crear_ = {};
  var MATRIZ = { IVA: 'Informe y pago de IVA', ACUSE: 'Acuse de recibo', FACTURACION: 'Facturación mensual' };
  var ESTADO = { vacio: ['Vacío en la matriz', 'info'], igual: ['Igual', 'ok'], distinto: ['Distinto', 'alerta'] };

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function api(a, d) { return x_.api(a, d); }
  function aviso(tono, icono, html) { return '<div class="mj2-aviso sx2-tono-' + tono + ' sx2-entra">' + U.ico(icono, 16) + '<span>' + html + '</span></div>'; }
  function valor(v) {
    if (v === '' || v === null || v === undefined) return '—';
    if (typeof v === 'number') return Math.abs(v) < 100 && v % 1 ? String(v).replace('.', ',') : '$ ' + Math.round(v).toLocaleString('es-CL');
    return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? x_.fechaCorta(v) : String(v);
  }
  function clientes() { return (x_.cfg && x_.cfg.clientes) || []; }
  function etiquetaCliente(c) { return c.nombre + (c.rut ? ' · ' + c.rut : ''); }
  function reiniciar() { sel_ = { cliente: '', periodo: '', tipo: '' }; rev_ = null; error_ = ''; hecho_ = ''; usar_ = {}; crear_ = {}; }

  function tomarEnvio() {
    var e = x_.envio && x_.envio();
    if (!e || e.fuente !== 'sii' || e.t === visto_) return false;
    visto_ = e.t;
    entrada_ = { texto: e.texto, nombre: '', pagina: e.pagina, t: e.t };
    reiniciar();
    return true;
  }

  // --- revisar y aplicar ------------------------------------------------------------------------
  function pedido() {
    var p = { texto: entrada_.texto, nombre: entrada_.nombre };
    var h = clientes().filter(function (k) { return etiquetaCliente(k) === sel_.cliente; })[0];
    if (h) p.cliente_id = h.cliente_id;
    if (sel_.periodo) p.periodo = sel_.periodo;
    if (sel_.tipo) p.tipo = sel_.tipo;
    return p;
  }
  function revisar() {
    var t = ++turno_;
    pintar(true);
    api('revisarSII', pedido()).then(function (r) {
      if (t !== turno_) return;
      if (!r || !r.ok) { rev_ = null; error_ = (r && r.message) || 'No se pudo leer.'; pintar(); return; }
      error_ = '';
      rev_ = r.data;
      if (rev_.cliente && !sel_.cliente) sel_.cliente = etiquetaCliente(rev_.cliente);
      if (rev_.periodo && !sel_.periodo) sel_.periodo = rev_.periodo;
      if (rev_.leido.nivel === 'resumen' && !sel_.tipo) sel_.tipo = rev_.leido.tipo;
      usar_ = {}; crear_ = {};
      var c = rev_.comparacion;
      if (c && c.campos) c.campos.forEach(function (k) { if (k.estado === 'vacio') usar_[k.columna] = true; });
      if (c && c.faltan) c.faltan.forEach(function (k) { crear_[k.folio] = true; });
      pintar();
    });
  }
  function aplicar() {
    var p = pedido();
    p.usar = Object.keys(usar_).filter(function (k) { return usar_[k]; });
    p.crear = Object.keys(crear_).filter(function (k) { return crear_[k]; });
    var b = x_.raiz().querySelector('.js-sii-aplicar');
    if (b) b.disabled = true;
    api('aplicarSII', p).then(function (r) {
      if (!r || !r.ok) { if (b) b.disabled = false; PY.aviso((r && r.message) || 'No se pudo aplicar.', 'error'); return; }
      PY.aviso(r.data.message, (r.data.errores || []).length ? 'info' : 'exito');
      hecho_ = r.data.message;
      revisar();
    });
  }

  // --- leer archivos ------------------------------------------------------------------------------
  function leerArchivo(f) {
    var buf = f.arrayBuffer();
    if (/\.gz$/i.test(f.name)) {
      if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('Este navegador no abre .gz: usa Chrome o Edge actualizados.'));
      buf = buf.then(function (b) { return new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); });
    }
    return buf.then(function (b) {
      var t = new TextDecoder('utf-8').decode(b);
      // El SII suele exportar en Latin-1: si UTF-8 deja caracteres rotos, se relee.
      if (t.indexOf('�') !== -1) t = new TextDecoder('windows-1252').decode(b);
      return t;
    });
  }

  // --- pantalla -----------------------------------------------------------------------------------
  function opcionesMeses() {
    var out = [], p = x_.periodoActual();
    for (var i = 0; i < 24; i++) { var q = x_.mover(p, -i); out.push([q, x_.perTexto(q, true)]); }
    return out;
  }
  function tablaCampos(c, reg) {
    return '<div class="ci2-grilla-caja"><div class="ci2-grilla" style="max-height:none"><table class="ci2-tabla"><thead><tr>' +
      (reg ? '<th class="ci2-col-sel">Usar</th>' : '') + '<th>Columna de la matriz</th><th>En el SII</th><th class="ci2-th-monto">Valor SII</th><th class="ci2-th-monto">En la matriz</th><th>Situación</th></tr></thead><tbody>' +
      c.campos.map(function (k) {
        var e = ESTADO[k.estado];
        return '<tr>' + (reg ? '<td class="ci2-col-sel"><input type="checkbox" class="js-sii-usar" data-col="' + U.esc(k.columna) + '"' + (usar_[k.columna] ? ' checked' : '') + (k.estado === 'igual' ? ' disabled' : '') + ' aria-label="Usar el valor del SII"></td>' : '') +
          '<td><b>' + txt(k.etiqueta) + '</b></td><td>' + (k.codigo ? 'Cód. ' + k.codigo + ' · ' : '') + txt(k.glosa || '') + '</td>' +
          '<td class="ci2-td-monto">' + txt(valor(k.sii)) + '</td><td class="ci2-td-monto">' + txt(valor(k.matriz)) + '</td><td>' + U.badge(e[0], e[1]) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }
  function listaInfo(info) {
    return info && info.length ? '<ul class="sii-info">' + info.map(function (k) { return '<li>' + (k.codigo ? 'Cód. ' + k.codigo + ' · ' : '') + txt(k.glosa) + ': <b>' + txt(typeof k.valor === 'number' && Math.abs(k.valor) >= 100 ? valor(k.valor) : String(k.valor)) + '</b></li>'; }).join('') + '</ul>' : '';
  }
  function bloqueFacturacion(c, reg) {
    var kpis = '<div class="sx2-fila-kpis">' +
      U.kpi({ i: 0, etiqueta: 'Coinciden', valor: c.iguales, icono: 'check', tono: 'ok' }) +
      U.kpi({ i: 1, etiqueta: 'Faltan en la matriz', valor: c.faltan.length, icono: 'nueva', tono: c.faltan.length ? 'alerta' : 'ok' }) +
      U.kpi({ i: 2, etiqueta: 'Monto distinto', valor: c.distintos.length, icono: 'alerta', tono: c.distintos.length ? 'critico' : 'ok' }) +
      U.kpi({ i: 3, etiqueta: 'En la matriz y no en el SII', valor: c.sobran.length, icono: 'info', tono: c.sobran.length ? 'alerta' : 'ok' }) + '</div>';
    var faltan = c.faltan.length ? '<h3 class="ci2-seccion">Faltan en la matriz (se agregan los marcados)</h3><div class="ci2-grilla-caja"><div class="ci2-grilla" style="max-height:420px"><table class="ci2-tabla"><thead><tr>' +
      (reg ? '<th class="ci2-col-sel"><input type="checkbox" class="js-sii-todos" aria-label="Marcar todos"' + (c.faltan.every(function (k) { return crear_[k.folio]; }) ? ' checked' : '') + '></th>' : '') +
      '<th>Tipo</th><th class="ci2-th-numero">Folio</th><th>Fecha</th><th>Cliente del documento (mandante)</th><th class="ci2-th-monto">Neto</th><th class="ci2-th-monto">Total</th></tr></thead><tbody>' +
      c.faltan.map(function (k) {
        return '<tr>' + (reg ? '<td class="ci2-col-sel"><input type="checkbox" class="js-sii-crear" data-folio="' + U.esc(k.folio) + '"' + (crear_[k.folio] ? ' checked' : '') + '></td>' : '') +
          '<td>' + txt(k.tipo) + '</td><td class="ci2-td-numero">' + txt(k.folio) + '</td><td>' + txt(x_.fechaCorta(k.fecha)) + '</td><td>' + txt(k.razon_social) + (k.rut ? ' <small class="sx2-tenue">' + txt(k.rut) + '</small>' : '') + '</td>' +
          '<td class="ci2-td-monto">' + txt(valor(k.neto)) + '</td><td class="ci2-td-monto">' + txt(valor(k.total)) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>' : '';
    var distintos = c.distintos.length ? '<h3 class="ci2-seccion">Monto total distinto</h3><ul class="sii-info">' + c.distintos.map(function (k) { return '<li>Folio <b>' + txt(k.folio) + '</b>: SII ' + txt(valor(k.sii)) + ' · matriz ' + txt(valor(k.matriz)) + '</li>'; }).join('') + '</ul>' : '';
    var sobran = c.sobran.length ? '<h3 class="ci2-seccion">En la matriz y no en el SII</h3><ul class="sii-info">' + c.sobran.map(function (k) { return '<li>Folio <b>' + txt(k.folio) + '</b> ' + txt(k.tipo) + ' · ' + txt(valor(k.total)) + '</li>'; }).join('') + '</ul>' : '';
    return kpis + faltan + distintos + sobran;
  }
  function pintar(cargando) {
    var cuerpo = '';
    if (!entrada_) cuerpo = aviso('info', 'info', 'Esperando un envío desde el SII. Deja esta pestaña abierta, o sube el CSV del Registro de Compras y Ventas.');
    else if (cargando) cuerpo = U.esqueleto('tabla', 5);
    else if (error_) cuerpo = aviso('critico', 'alerta', txt(error_));
    else if (rev_) {
      var l = rev_.leido, c = rev_.comparacion, reg = !!(c && c.puede_registrar);
      var que = l.fuente === 'f29' ? 'Formulario 29' + (l.folio ? ' (folio ' + txt(l.folio) + ')' : '') + ' · ' + l.codigos + ' códigos leídos'
        : 'Registro de ' + (l.tipo === 'compras' ? 'Compras' : 'Ventas') + ' · ' + (l.nivel === 'detalle' ? l.documentos + ' documentos (detalle)' : 'resumen de la página');
      var origen = entrada_.nombre ? 'archivo <b>' + txt(entrada_.nombre) + '</b>' : (entrada_.pagina ? '<b>' + txt(entrada_.pagina) + '</b>' : 'texto pegado');
      var controles = '<div class="sii-sel">' +
        U.campo('Cliente', '<input class="sx2-input js-sii-cliente" list="sii-dl-cli" value="' + U.esc(sel_.cliente) + '" placeholder="Busca por nombre o RUT" autocomplete="off"><datalist id="sii-dl-cli">' + clientes().map(function (k) { return '<option value="' + U.esc(etiquetaCliente(k)) + '"></option>'; }).join('') + '</datalist>',
          l.rut ? (rev_.cliente ? 'Reconocido por el RUT ' + l.rut + '.' : 'El RUT ' + l.rut + ' no está en el catálogo.') : 'La página no trae RUT: elígelo.') +
        U.campo('Mes', '<select class="sx2-select js-sii-periodo"><option value="">Elige el mes</option>' + opcionesMeses().map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === sel_.periodo ? ' selected' : '') + '>' + txt(o[1]) + '</option>'; }).join('') + '</select>',
          l.periodo_detectado ? 'Leído: ' + x_.perTexto(l.periodo_detectado, true) + '.' : 'No se leyó el mes: elígelo.') +
        (l.nivel === 'resumen' ? U.campo('Es el registro de', '<select class="sx2-select js-sii-tipo"><option value="ventas"' + (sel_.tipo === 'ventas' ? ' selected' : '') + '>Ventas</option><option value="compras"' + (sel_.tipo === 'compras' ? ' selected' : '') + '>Compras</option></select>') : '') +
        '<div class="sii-sel__b">' + U.boton({ texto: 'Revisar de nuevo', icono: 'tendencia', clase: 'js-sii-revisar' }) + '</div></div>';
      var comp = '';
      if (rev_.falta) comp = aviso('alerta', 'alerta', txt(rev_.message || 'Falta elegir el cliente o el mes.'));
      else if (c) {
        var titulo = 'Contra ' + (MATRIZ[c.matriz] || c.matriz) + ' · ' + txt(rev_.cliente ? rev_.cliente.nombre : '') + ' · ' + txt(x_.perTexto(rev_.periodo, true));
        var fila = c.matriz === 'FACTURACION' ? '' : (c.registro_id ? '' : aviso('info', 'info', 'El cliente no tiene fila en este mes: al aplicar se crea.'));
        var detalle = c.campos ? tablaCampos(c, reg) : (c.faltan ? bloqueFacturacion(c, reg) : '');
        var resumen = c.resumen ? '<div class="ci2-grilla-caja"><div class="ci2-grilla" style="max-height:none"><table class="ci2-tabla"><thead><tr><th>Tipo de documento</th><th class="ci2-th-numero">Documentos</th><th class="ci2-th-monto">Neto</th><th class="ci2-th-monto">IVA</th><th class="ci2-th-monto">Total</th></tr></thead><tbody>' +
          c.resumen.map(function (k) { return '<tr><td>' + txt(k.nombre) + ' (' + k.tipo_doc + ')</td><td class="ci2-td-numero">' + k.documentos + '</td><td class="ci2-td-monto">' + txt(valor(k.neto)) + '</td><td class="ci2-td-monto">' + txt(valor(k.iva)) + '</td><td class="ci2-td-monto">' + txt(valor(k.total)) + '</td></tr>'; }).join('') + '</tbody></table></div></div>' : '';
        var hay = Object.keys(usar_).some(function (k) { return usar_[k]; }) || Object.keys(crear_).some(function (k) { return crear_[k]; });
        comp = '<h2 class="sii-h">' + titulo + '</h2>' + fila + detalle + resumen + listaInfo(c.info) + (c.nota ? '<p class="sx2-tenue">' + txt(c.nota) + '</p>' : '') +
          '<div class="sii-botones">' + (reg ? U.boton({ texto: 'Aplicar lo marcado', icono: 'check', variante: 'primario', clase: 'js-sii-aplicar', deshabilitado: !hay }) : '') +
          U.boton({ texto: 'Descartar', variante: 'fantasma', clase: 'js-sii-descartar' }) +
          U.boton({ soloIcono: true, icono: 'tabla', titulo: 'Abrir la matriz', clase: 'js-sii-matriz', datos: { m: c.matriz } }) + '</div>';
      }
      cuerpo = (hecho_ ? aviso('ok', 'check', txt(hecho_)) : '') +
        '<div class="sx2-card sx2-entra"><p style="margin:0 0 10px">' + que + ' · desde ' + origen + '.</p>' + controles + comp + '</div>';
    }
    var instalar = U.card({ titulo: 'El marcador "Enviar a SIGSO"', icono: 'bandera', cuerpo:
      '<p class="sx2-tenue" style="margin:0 0 10px">El mismo de la TGR: arrástralo una vez a la barra de marcadores (Ctrl+Shift+B la muestra).</p>' +
      '<a class="sx2-boton sx2-boton--primario cv-marcador js-sii-marcador" href="' + U.esc(x_.marcador()) + '" draggable="true">' + U.ico('bandera', 16) + 'Enviar a SIGSO</a>' +
      '<ol class="cv-pasos"><li><b>F29:</b> en el SII, con la clave del cliente, abre el formulario del mes (Consulta integral F29 › ver el formulario) y toca el marcador.</li>' +
      '<li><b>Compras y ventas:</b> en el Registro de Compras y Ventas, el mes y la pestaña (Compras o Ventas): el marcador manda el resumen; para comparar folio por folio sube el CSV de "Descargar detalles".</li>' +
      '<li>Revisa qué cambia y aplica solo lo que corresponde.</li></ol>' +
      '<p class="sx2-tenue" style="font-size:.8125rem;margin:8px 0 0">SIGSO no guarda claves ni entra al SII: solo lee lo que ya ves en tu pantalla.</p>' });
    var subir = U.card({ titulo: 'Subir el CSV del Registro de Compras y Ventas', icono: 'subir', cuerpo:
      '<p class="sx2-tenue" style="margin:0 0 8px">El archivo de "Descargar detalles" (.csv, o .gz si el SII lo manda comprimido). El nombre trae el RUT y el mes.</p>' +
      '<input type="file" class="sx2-input js-sii-archivo" accept=".csv,.gz,.txt">' +
      '<p class="sx2-tenue" style="margin:12px 0 6px">O pega la página (Ctrl+A y Ctrl+C en el SII):</p><textarea class="sx2-input js-sii-texto" rows="3" placeholder="Pega aquí"></textarea>' +
      '<div style="margin-top:8px">' + U.boton({ texto: 'Revisar lo pegado', icono: 'lupa', clase: 'js-sii-pegar' }) + '</div>' });
    x_.pagina(x_.cabecera(x_.modNombre + ' · Informe y pago de IVA', 'Recibir desde el SII', 'F29 y Registro de Compras y Ventas, comparados con las matrices: sin copiar ni tipear.') + cuerpo + '<div class="cv-rec-2">' + instalar + subir + '</div>', true);
  }

  // --- eventos ------------------------------------------------------------------------------------
  function mio(ev) { var c = x_ && x_.raiz(); return !!c && c.contains(ev.target) && x_.vista && x_.vista() === 'sii'; }
  document.addEventListener('click', function (ev) {
    if (!mio(ev)) return;
    var t = ev.target, b;
    if (t.closest('.js-sii-marcador')) { ev.preventDefault(); PY.aviso('Arrástralo a la barra de marcadores; se usa en la página del SII o de la TGR.', 'info'); return; }
    if (t.closest('.js-sii-revisar')) { revisar(); return; }
    if (t.closest('.js-sii-aplicar')) { aplicar(); return; }
    if (t.closest('.js-sii-descartar')) { entrada_ = null; reiniciar(); pintar(); return; }
    if ((b = t.closest('.js-sii-matriz'))) { x_.irAItem('m:' + b.getAttribute('data-m')); return; }
    if (t.closest('.js-sii-pegar')) {
      var ta = x_.raiz().querySelector('.js-sii-texto');
      if (!ta || ta.value.trim().length < 20) { PY.aviso('Pega primero la página del SII.', 'error'); return; }
      entrada_ = { texto: ta.value.slice(0, 3000000), nombre: '', pagina: '', t: Date.now() };
      reiniciar(); revisar();
    }
  });
  document.addEventListener('change', function (ev) {
    if (!mio(ev)) return;
    var t = ev.target;
    if (t.classList.contains('js-sii-archivo') && t.files && t.files[0]) {
      var f = t.files[0];
      if (f.size > 25 * 1024 * 1024) { PY.aviso('El archivo es demasiado grande.', 'error'); return; }
      leerArchivo(f).then(function (texto) { entrada_ = { texto: texto, nombre: f.name, pagina: '', t: Date.now() }; reiniciar(); revisar(); },
        function (e) { PY.aviso((e && e.message) || 'No se pudo leer el archivo.', 'error'); });
      return;
    }
    if (t.classList.contains('js-sii-usar')) { usar_[t.getAttribute('data-col')] = t.checked; pintar(); return; }
    if (t.classList.contains('js-sii-crear')) { crear_[t.getAttribute('data-folio')] = t.checked; pintar(); return; }
    if (t.classList.contains('js-sii-todos')) { (rev_.comparacion.faltan || []).forEach(function (k) { crear_[k.folio] = t.checked; }); pintar(); return; }
    if (t.classList.contains('js-sii-cliente')) { sel_.cliente = t.value.trim(); return; }
    if (t.classList.contains('js-sii-periodo')) { sel_.periodo = t.value; return; }
    if (t.classList.contains('js-sii-tipo')) { sel_.tipo = t.value; }
  });

  window.SigsoCISII = {
    mostrar: function (ctx) {
      x_ = ctx;
      if (tomarEnvio()) revisar(); else pintar();
    }
  };
})();
