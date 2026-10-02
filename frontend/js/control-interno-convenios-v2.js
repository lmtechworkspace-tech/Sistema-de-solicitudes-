/**
 * control-interno-convenios-v2.js — Seguimiento de convenios TGR
 * (2026-10-01; backend/logica/controlInternoConvenios.js).
 *
 * Reemplaza la hoja impresa de Francisca: por cada folio, sus cuotas con lo
 * que dice la TGR (pagada sí/no), su revisión (pagada / vencida) y si está
 * contabilizada. Las cuotas se cargan PEGANDO la tabla de "Imprimir cuotas
 * de convenios vigentes" de la TGR. "Pasar a la matriz" llena la matriz
 * Convenios del mes con lo que hay aquí.
 *
 * Vistas: conv (lista) y conv:<id> (ficha). Las elige control-interno-v2.js.
 */
(function () {
  'use strict';

  var U = UIv2;
  var PY = window.PYv2;
  var x_ = null;
  var f_ = { q: '', estado: 'VIGENTE', alertas: false };
  var lista_ = null, ficha_ = null, sel_ = {}, turno_ = 0;
  var SIT = { PAGADA: ['Pagada', 'ok'], VENCIDA: ['Vencida', 'critico'], POR_VENCER: ['Por vencer', 'neutro'], AJUSTE: ['Cuota de ajuste', 'neutro'] };
  var EST = { VIGENTE: ['Vigente', 'info'], TERMINADO: ['Terminado', 'ok'], CAIDO: ['Caído', 'critico'] };
  var TIPOS = [['IVA', 'IVA'], ['RENTA', 'Renta'], ['IVA Y RENTA', 'IVA y Renta'], ['OTRO', 'Otro']];
  var AYUDA_PEGAR = 'En la TGR: Trámites › Imprimir cuotas de convenios vigentes → elige el folio → selecciona la tabla completa (desde “Cuota” hasta la última fila) → copia (Ctrl+C) → pégala aquí (Ctrl+V).';

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function pesos(v) { return v === '' || v == null || !isFinite(Number(v)) ? '—' : '$ ' + Number(v).toLocaleString('es-CL', { maximumFractionDigits: 0 }); }
  function fecha(v) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '')); return m ? m[3] + '-' + m[2] + '-' + m[1] : (v || '—'); }
  function badge(par) { return U.badge(par[0], par[1]); }
  function etiquetaConvenio(c) {
    var n = c.cuotas ? c.cuotas.length : null;
    return c.cliente_nombre + ' · folio ' + c.folio + (n === null ? '' : (n ? ' · ' + n + ' cuotas' : ' · sin cuotas')) + (c.estado && c.estado !== 'VIGENTE' ? ' · ' + c.estado.toLowerCase() : '');
  }
  function etiquetaCliente(c) { return c.nombre + (c.rut ? ' · ' + c.rut : ''); }
  function registra() { return !!(lista_ && lista_.puede_registrar); }
  function api(a, d) { return x_.api(a, d); }
  function aviso(tono, icono, html) { return '<div class="mj2-aviso sx2-tono-' + tono + ' sx2-entra">' + U.ico(icono, 16) + '<span>' + html + '</span></div>'; }

  // =========================================================================================
  // Lista
  // =========================================================================================
  function vistaLista(silencioso) {
    var t = ++turno_;
    if (!silencioso) x_.pagina(x_.cabecera('Control interno · Contabilidad · Convenios y postergaciones', 'Seguimiento de convenios TGR', 'Las cuotas de cada folio, como en la hoja impresa.') + U.esqueleto('kpis', 4) + U.esqueleto('tabla', 8));
    api('listarConveniosTGR', {}).then(function (r) {
      if (t !== turno_) return;
      if (!r || !r.ok) { x_.pagina(x_.cabecera('Control interno', 'Seguimiento de convenios TGR', '') + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || '' }) })); return; }
      lista_ = r.data;
      pintarLista(!!silencioso);
    });
  }
  function filtrados() {
    var q = norm(f_.q);
    return lista_.convenios.filter(function (c) {
      if (f_.estado && c.estado !== f_.estado) return false;
      if (f_.alertas && !(c.resumen.vencidas || c.resumen.por_contabilizar || !c.cuotas.length)) return false;
      if (q && norm(c.cliente_nombre + ' ' + c.cliente_rut + ' ' + c.folio).indexOf(q) === -1) return false;
      return true;
    });
  }
  function pintarLista(silencioso) {
    var k = lista_.kpis, reg = registra();
    var acciones = (reg ? U.boton({ texto: 'Nuevo convenio', icono: 'nueva', variante: 'primario', clase: 'js-cv-nuevo' }) +
      U.boton({ texto: 'Recibir desde la TGR', icono: 'descargar', clase: 'js-cv-recibir', titulo: 'Botón "Enviar a SIGSO" en la página de la TGR' }) +
      U.boton({ texto: 'Pasar a la matriz del mes', icono: 'tabla', clase: 'js-cv-amatriz', titulo: 'Llena la matriz Convenios del mes con lo que hay aquí' }) +
      U.boton({ soloIcono: true, icono: 'subir', titulo: 'Crear fichas desde la matriz Convenios', clase: 'js-cv-desde' }) : '') +
      U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-cv-recargar' });
    var kpis = '<div class="sx2-fila-kpis">' +
      U.kpi({ i: 0, etiqueta: 'Convenios vigentes', valor: k.vigentes, icono: 'documento', tono: 'primario' }) +
      U.kpi({ i: 1, etiqueta: 'Cuotas vencidas sin pagar', valor: k.cuotas_vencidas, icono: 'alerta', tono: k.cuotas_vencidas ? 'critico' : 'ok', unidad: k.convenios_con_vencidas + (k.convenios_con_vencidas === 1 ? ' convenio' : ' convenios') }) +
      U.kpi({ i: 2, etiqueta: 'Pagadas sin contabilizar', valor: k.por_contabilizar, icono: 'reloj', tono: k.por_contabilizar ? 'alerta' : 'ok' }) +
      U.kpi({ i: 3, etiqueta: 'Vencen en 7 días', valor: k.vencen_7_dias, icono: 'calendario', tono: k.vencen_7_dias ? 'alerta' : 'ok' }) + '</div>';
    var sinCuotas = k.sin_cuotas ? aviso('info', 'info', '<b>' + k.sin_cuotas + (k.sin_cuotas === 1 ? ' convenio vigente no tiene' : ' convenios vigentes no tienen') + ' sus cuotas cargadas.</b> Ábrelo y pega la tabla de la TGR.') : '';
    var barra = '<div class="sx2-card ci2-herr sx2-entra"><div class="sx2-barra-filtros">' +
      '<input class="sx2-input js-cv-q" type="search" placeholder="Buscar cliente, RUT o folio…" value="' + U.esc(f_.q) + '" aria-label="Buscar">' +
      '<select class="sx2-select js-cv-estado" aria-label="Estado">' + [['VIGENTE', 'Vigentes'], ['TERMINADO', 'Terminados'], ['CAIDO', 'Caídos'], ['', 'Todos']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === f_.estado ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      '<label class="cv-chk"><input type="checkbox" class="js-cv-alertas"' + (f_.alertas ? ' checked' : '') + '> Solo con algo pendiente</label></div></div>';
    var l = filtrados();
    var tabla = l.length ? '<div class="ci2-grilla-caja sx2-entra"><div class="ci2-grilla" style="max-height:none"><table class="ci2-tabla cv-tabla"><thead><tr>' +
      '<th>Cliente</th><th>Folio</th><th>Tipo</th><th>Cuotas pagadas</th><th class="ci2-th-numero">Vencidas</th><th class="ci2-th-numero">Por contabilizar</th><th>Próxima cuota</th><th>Revisado en TGR</th><th>Estado</th></tr></thead><tbody>' +
      l.map(function (c) {
        var r = c.resumen, pct = r.total ? Math.round(100 * r.pagadas / r.total) : 0;
        return '<tr class="cv-fila" data-id="' + U.esc(c.convenio_id) + '"><td><b>' + txt(c.cliente_nombre) + '</b>' + (c.cliente_id ? '' : ' <span class="ci2-fuera" title="No está en el catálogo">•</span>') + '</td><td>' + txt(c.folio) + '</td><td>' + txt(c.tipo || '—') + '</td>' +
          '<td>' + (c.cuotas.length ? '<span class="cv-av"><span>' + r.pagadas + ' de ' + r.total + '</span>' + U.barra(pct, r.todas_pagadas ? 'ok' : 'primario') + '</span>' : '<span class="sx2-tenue">sin cuotas</span>') + '</td>' +
          '<td class="ci2-td-numero">' + (r.vencidas ? U.badge(String(r.vencidas), 'critico') : '0') + '</td>' +
          '<td class="ci2-td-numero">' + (r.por_contabilizar ? U.badge(String(r.por_contabilizar), 'alerta') : '0') + '</td>' +
          '<td>' + (r.proxima ? 'N° ' + r.proxima.n + ' · ' + fecha(r.proxima.vencimiento) + ' · ' + pesos(r.proxima.monto) : '—') + '</td>' +
          '<td>' + (c.fecha_revision_tgr ? fecha(c.fecha_revision_tgr) : '<span class="sx2-tenue">nunca</span>') + '</td>' +
          '<td>' + badge(EST[c.estado] || EST.VIGENTE) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>'
      : U.card({ cuerpo: U.vacio({ icono: 'documento', titulo: lista_.convenios.length ? 'Ningún convenio calza con el filtro' : 'Todavía no hay convenios en el seguimiento', texto: lista_.convenios.length ? '' : 'Créalos desde la matriz Convenios (botón con la flecha) o uno por uno con "Nuevo convenio".' }) });
    x_.pagina(x_.cabecera('Control interno · Contabilidad · Convenios y postergaciones', 'Seguimiento de convenios TGR', 'Las cuotas de cada folio, como en la hoja impresa: lo que dice la TGR, tu revisión y si está contabilizada.', acciones) + kpis + sinCuotas + barra + tabla, silencioso);
  }

  // =========================================================================================
  // Ficha del convenio
  // =========================================================================================
  function vistaFicha(id, silencioso) {
    var t = ++turno_;
    if (!silencioso) x_.pagina(x_.cabecera('Control interno · Seguimiento de convenios TGR', 'Convenio', '') + U.esqueleto('kpis', 4) + U.esqueleto('tabla', 10));
    var p = lista_ ? Promise.resolve(null) : api('listarConveniosTGR', {}).then(function (r) { if (r && r.ok) lista_ = r.data; });
    p.then(function () { return api('getConvenioTGR', { convenio_id: id }); }).then(function (r) {
      if (t !== turno_) return;
      if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo abrir.', 'error'); x_.irAItem('conv'); return; }
      ficha_ = r.data;
      x_.resolverPersonas(ficha_.historial.map(function (h) { return { email: h.usuario_email }; })).then(function () { if (t === turno_) pintarFicha(!!silencioso); });
      pintarFicha(!!silencioso);
    });
  }
  function pintarFicha(silencioso) {
    var c = ficha_.convenio, r = c.resumen, reg = !!ficha_.puede_registrar;
    var nSel = Object.keys(sel_).filter(function (k) { return sel_[k]; }).length;
    var acciones = U.boton({ texto: 'Volver', icono: 'izquierda', variante: 'fantasma', clase: 'js-cv-volver' }) +
      (reg ? U.boton({ texto: 'Pegar desde la TGR', icono: 'copiar', variante: 'primario', clase: 'js-cv-pegar' }) + U.boton({ texto: 'Editar datos', icono: 'editar', clase: 'js-cv-editar' }) : '') +
      (reg && c.estado === 'VIGENTE' ? U.boton({ texto: 'Marcar caído', clase: 'js-cv-estado', datos: { estado: 'CAIDO' } }) + U.boton({ texto: 'Marcar terminado', clase: 'js-cv-estado', datos: { estado: 'TERMINADO' } }) : '') +
      (reg && c.estado !== 'VIGENTE' ? U.boton({ texto: 'Volver a vigente', clase: 'js-cv-estado', datos: { estado: 'VIGENTE' } }) : '');
    var datos = '<div class="sx2-card cv-datos sx2-entra"><dl>' +
      [['Cliente', c.cliente_nombre + (c.cliente_rut ? ' · ' + c.cliente_rut : '')], ['Folio', c.folio], ['Tipo', c.tipo || '—'], ['Fecha del convenio', fecha(c.fecha_convenio)], ['Pie', pesos(c.pie)], ['Deuda total', pesos(c.deuda_total)], ['Término', fecha(r.termino)], ['Revisado en la TGR', c.fecha_revision_tgr ? fecha(c.fecha_revision_tgr) : 'nunca']]
        .map(function (p) { return '<div><dt>' + txt(p[0]) + '</dt><dd>' + txt(p[1]) + '</dd></div>'; }).join('') +
      '<div><dt>Estado</dt><dd>' + badge(EST[c.estado] || EST.VIGENTE) + (c.motivo_estado ? ' <span class="sx2-tenue">' + txt(c.motivo_estado) + '</span>' : '') + '</dd></div></dl>' +
      (c.observaciones ? '<p class="sx2-tenue" style="margin:8px 0 0">' + txt(c.observaciones) + '</p>' : '') + '</div>';
    var alertas = '';
    if (!c.cuotas.length) alertas += aviso('info', 'copiar', 'Este convenio todavía no tiene sus cuotas. Usa <b>Pegar desde la TGR</b>. ' + txt(AYUDA_PEGAR));
    if (r.vencidas) alertas += aviso('critico', 'alerta', '<b>' + r.vencidas + (r.vencidas === 1 ? ' cuota vencida sin pagar' : ' cuotas vencidas sin pagar') + '</b> (N° ' + r.vencidas_n.join(', ') + '). Revisa en la TGR si el convenio sigue vigente.');
    if (r.todas_pagadas && c.estado === 'VIGENTE') alertas += aviso('ok', 'check', 'Todas las cuotas están pagadas: puedes marcar el convenio como terminado.');
    if (r.por_contabilizar) alertas += aviso('alerta', 'reloj', r.por_contabilizar + (r.por_contabilizar === 1 ? ' cuota pagada falta contabilizar.' : ' cuotas pagadas faltan contabilizar.'));
    var kpis = c.cuotas.length ? '<div class="sx2-fila-kpis">' +
      U.kpi({ i: 0, etiqueta: 'Pagadas', valor: r.pagadas, unidad: 'de ' + r.total, icono: 'check', tono: 'ok', progreso: r.total ? 100 * r.pagadas / r.total : 0 }) +
      U.kpi({ i: 1, etiqueta: 'Vencidas sin pagar', valor: r.vencidas, icono: 'alerta', tono: r.vencidas ? 'critico' : 'ok' }) +
      U.kpi({ i: 2, etiqueta: 'Por contabilizar', valor: r.por_contabilizar, icono: 'reloj', tono: r.por_contabilizar ? 'alerta' : 'ok' }) +
      U.kpi({ i: 3, etiqueta: 'Próxima cuota', valor: r.proxima ? 'N° ' + r.proxima.n : '—', unidad: r.proxima ? fecha(r.proxima.vencimiento) + ' · ' + pesos(r.proxima.monto) : '', icono: 'calendario', tono: 'primario' }) + '</div>' : '';
    var lote = reg && nSel ? '<div class="ci2-lote"><b>' + nSel + (nSel === 1 ? ' cuota marcada' : ' cuotas marcadas') + '</b>' +
      U.boton({ texto: 'Pagadas', sm: true, variante: 'primario', clase: 'js-cv-lote', datos: { campo: 'revision', valor: 'PAGADA' } }) +
      U.boton({ texto: 'Vencidas', sm: true, clase: 'js-cv-lote', datos: { campo: 'revision', valor: 'VENCIDA' } }) +
      U.boton({ texto: 'Contabilizadas', sm: true, clase: 'js-cv-lote', datos: { campo: 'contabilizada', valor: '1' } }) +
      U.boton({ texto: 'Quitar revisión', sm: true, variante: 'fantasma', clase: 'js-cv-lote', datos: { campo: 'revision', valor: '' } }) +
      U.boton({ texto: 'Desmarcar', sm: true, variante: 'fantasma', clase: 'js-cv-desmarcar' }) + '</div>' : '';
    var cuotas = c.cuotas.length ? '<div class="ci2-grilla-caja sx2-entra"><div class="ci2-grilla" style="max-height:none"><table class="ci2-tabla cv-cuotas"><thead><tr>' +
      (reg ? '<th class="ci2-col-sel"><input type="checkbox" class="js-cv-todas" aria-label="Marcar todas"></th>' : '') +
      '<th class="ci2-th-numero">Cuota</th><th>Vencimiento</th><th class="ci2-th-monto">Monto</th><th>TGR (pagada)</th><th>Revisión</th><th>Contabilizada</th><th>Situación</th></tr></thead><tbody>' +
      c.cuotas.map(function (q) {
        var s = SIT[q.situacion] || SIT.POR_VENCER;
        return '<tr data-n="' + q.n + '" class="cv-cuota--' + q.situacion.toLowerCase() + (sel_[q.n] ? ' ci2-fila--sel' : '') + '">' +
          (reg ? '<td class="ci2-col-sel"><input type="checkbox" class="js-cv-sel"' + (sel_[q.n] ? ' checked' : '') + ' aria-label="Marcar cuota ' + q.n + '"></td>' : '') +
          '<td class="ci2-td-numero"><b>' + q.n + '</b></td><td>' + fecha(q.vencimiento) + '</td><td class="ci2-td-monto">' + (q.ajuste ? '<span class="sx2-tenue">ajuste</span>' : pesos(q.monto)) + '</td>' +
          '<td>' + (q.tgr === 'SI' ? '<b class="cv-si">SÍ</b>' : (q.tgr === 'NO' ? 'NO' : '—')) + '</td>' +
          '<td>' + (reg ? '<span class="cv-seg" role="group" aria-label="Revisión cuota ' + q.n + '">' +
            '<button type="button" class="cv-seg__b' + (q.revision === 'PAGADA' ? ' is-pagada' : '') + ' js-cv-rev" data-valor="PAGADA" aria-pressed="' + (q.revision === 'PAGADA') + '" title="' + (q.revision === 'PAGADA' ? 'Marcada pagada el ' + fecha(q.fecha_revision) + ' · clic para quitar' : 'Marcar pagada') + '">Pagada</button>' +
            '<button type="button" class="cv-seg__b' + (q.revision === 'VENCIDA' ? ' is-vencida' : '') + ' js-cv-rev" data-valor="VENCIDA" aria-pressed="' + (q.revision === 'VENCIDA') + '" title="' + (q.revision === 'VENCIDA' ? 'Marcada vencida el ' + fecha(q.fecha_revision) + ' · clic para quitar' : 'Marcar vencida') + '">Vencida</button></span>' : txt(q.revision ? (q.revision === 'PAGADA' ? 'Pagada' : 'Vencida') : '—')) +
            '</td>' +
          '<td>' + (reg ? '<label class="cv-chk"><input type="checkbox" class="js-cv-cont"' + (q.contabilizada ? ' checked' : '') + ' aria-label="Cuota ' + q.n + ' contabilizada"><small class="cv-fcont">' + (q.contabilizada ? fecha(q.fecha_contabilizada) : '') + '</small></label>' : (q.contabilizada ? 'Sí ' + fecha(q.fecha_contabilizada) : 'No')) + '</td>' +
          '<td>' + U.badge(s[0], s[1]) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>' : '';
    var hist = '<div class="sx2-card sx2-entra"><h3 class="ci2-seccion">Historial</h3>' + (ficha_.historial.length ? '<ol class="ci2-hist">' + ficha_.historial.slice(0, 40).map(function (h) {
      return '<li><b>' + txt(x_.nombre(h.usuario_email)) + '</b> · ' + txt(PY.fecha(h.fecha, true)) + ' — ' + txt(h.detalle || h.accion) + '</li>';
    }).join('') + '</ol>' : '<p class="sx2-tenue">Sin movimientos.</p>') + '</div>';
    x_.pagina(x_.cabecera('Control interno · Seguimiento de convenios TGR', c.cliente_nombre + ' · folio ' + c.folio, (c.tipo ? 'Convenio por ' + c.tipo.toLowerCase().replace('iva', 'IVA') : 'Convenio') + (c.fecha_convenio ? ' del ' + fecha(c.fecha_convenio) : ''), acciones) +
      datos + alertas + kpis + lote + cuotas + hist, silencioso);
  }

  // --- formularios ------------------------------------------------------------------------
  function formConvenio(c) {
    var nuevo = !c, clientes = (lista_ && lista_.clientes) || [];
    var cliVal = c ? (c.cliente_id ? etiquetaCliente({ nombre: c.cliente_nombre, rut: c.cliente_rut }) : c.cliente_nombre) : '';
    U.formulario({
      titulo: nuevo ? 'Nuevo convenio' : 'Datos del convenio', boton: nuevo ? 'Crear' : 'Guardar', ancho: true,
      campos: U.campo('Cliente', '<input class="sx2-input" name="cliente" list="cv-dl-cli" value="' + U.esc(cliVal) + '" autocomplete="off" required><datalist id="cv-dl-cli">' + clientes.map(function (k) { return '<option value="' + U.esc(etiquetaCliente(k)) + '"></option>'; }).join('') + '</datalist>') +
        '<div class="sx2-form__fila">' + U.campo('Folio', '<input class="sx2-input" name="folio" inputmode="numeric" value="' + U.esc(c ? c.folio : '') + '" required>') +
        U.campo('Tipo', '<select class="sx2-select" name="tipo"><option value="">—</option>' + TIPOS.map(function (t) { return '<option value="' + t[0] + '"' + (c && c.tipo === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select>') + '</div>' +
        '<div class="sx2-form__fila">' + U.campo('Fecha del convenio', '<input class="sx2-input" type="date" name="fecha_convenio" value="' + U.esc(c ? c.fecha_convenio : '') + '">') +
        U.campo('Pie', '<input class="sx2-input" name="pie" inputmode="numeric" value="' + U.esc(c && c.pie !== '' ? c.pie : '') + '">') +
        U.campo('Deuda total', '<input class="sx2-input" name="deuda_total" inputmode="numeric" value="' + U.esc(c && c.deuda_total !== '' ? c.deuda_total : '') + '">') + '</div>' +
        (nuevo ? U.campo('Cuotas (opcional)', '<textarea class="sx2-input" name="texto" rows="6" placeholder="Pega aquí la tabla de la TGR"></textarea>', AYUDA_PEGAR) : '') +
        U.campo('Observaciones', '<textarea class="sx2-input" name="observaciones" rows="2">' + U.esc(c ? c.observaciones : '') + '</textarea>'),
      preparar: function (v) {
        var p = { folio: v.folio, tipo: v.tipo, fecha_convenio: v.fecha_convenio, pie: v.pie, deuda_total: v.deuda_total, observaciones: v.observaciones };
        if (c) p.convenio_id = c.convenio_id;
        var cli = String(v.cliente || '').trim();
        if (!c || cli !== cliVal) {
          var h = clientes.filter(function (k) { return etiquetaCliente(k) === cli; })[0];
          if (h) p.cliente_id = h.cliente_id; else { if (cli.length < 2) return 'Elige el cliente.'; p.cliente_id = ''; p.cliente_nombre = cli; }
        }
        if (v.texto) p.texto = v.texto;
        return p;
      },
      enviar: function (p) { return api('guardarConvenioTGR', p); },
      aviso: function (r) { return (r && r.data && r.data.message) || 'Guardado.'; },
      listo: function (r) { lista_ = null; var id = r && r.data && r.data.convenio && r.data.convenio.convenio_id; x_.irAItem(id ? 'conv:' + id : 'conv'); }
    });
  }
  function formPegar() {
    var c = ficha_.convenio;
    var dr = U.drawer({ titulo: 'Pegar desde la TGR · folio ' + c.folio, subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + txt(AYUDA_PEGAR) + '</span>', cuerpo: '', pie: ' ' });
    var est = { texto: '', prev: null, error: '' };
    function pintar() {
      dr.cuerpo('<div class="sx2-form">' + U.campo('Tabla copiada de la TGR', '<textarea class="sx2-input js-cv-pegado" rows="12" placeholder="Cuota   Fecha de Vencimiento   Monto ($)   Pagada&#10;(*) 1   31-03-2026   77.717   SI&#10;…">' + U.esc(est.texto) + '</textarea>') +
        (est.error ? '<p class="sx2-campo__error">' + txt(est.error) + '</p>' : '') +
        (est.prev ? aviso(est.prev.cambios.length ? 'info' : 'ok', 'info', '<b>' + est.prev.leidas + ' cuotas leídas</b>, ' + est.prev.pagadas_tgr + ' pagadas según la TGR. ' +
          (est.prev.cambios.length ? 'Cambios: ' + txt(est.prev.texto_cambios) + '.' : 'Sin cambios respecto de lo que ya estaba.')) : '') + '</div>');
      dr.el.querySelector('.sx2-drawer__pie').innerHTML = '<span style="flex:1"></span>' + U.boton({ texto: 'Cancelar', clase: 'js-sx2-drawer-cerrar' }) +
        (est.prev ? U.boton({ texto: 'Aplicar', icono: 'check', variante: 'primario', clase: 'js-cv-aplicar' }) : U.boton({ texto: 'Revisar', icono: 'lupa', variante: 'primario', clase: 'js-cv-revisar' }));
    }
    dr.el.addEventListener('input', function (ev) { if (ev.target.classList.contains('js-cv-pegado')) { est.texto = ev.target.value; if (est.prev) { est.prev = null; var pie = dr.el.querySelector('.sx2-drawer__pie'); pie.innerHTML = '<span style="flex:1"></span>' + U.boton({ texto: 'Cancelar', clase: 'js-sx2-drawer-cerrar' }) + U.boton({ texto: 'Revisar', icono: 'lupa', variante: 'primario', clase: 'js-cv-revisar' }); } } });
    dr.el.addEventListener('click', function (ev) {
      if (ev.target.closest('.js-cv-revisar')) {
        api('pegarCuotasTGR', { convenio_id: c.convenio_id, texto: est.texto, simular: true }).then(function (r) {
          if (!r || !r.ok) { est.error = (r && r.message) || 'No se pudo leer.'; est.prev = null; } else { est.error = ''; est.prev = r.data; }
          pintar();
        });
      } else if (ev.target.closest('.js-cv-aplicar')) {
        api('pegarCuotasTGR', { convenio_id: c.convenio_id, texto: est.texto }).then(function (r) {
          if (!r || !r.ok) { est.error = (r && r.message) || 'No se pudo guardar.'; pintar(); return; }
          PY.aviso(r.data.message, 'exito');
          dr.cerrar();
          lista_ = null;
          vistaFicha(c.convenio_id, true);
        });
      }
    });
    pintar();
    setTimeout(function () { var t = dr.el.querySelector('.js-cv-pegado'); if (t) t.focus(); }, 50);
  }
  function marcar(numeros, campo, valor) {
    api('marcarCuotasTGR', { convenio_id: ficha_.convenio.convenio_id, numeros: numeros, campo: campo, valor: valor }).then(function (r) {
      if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo.', 'error'); return; }
      ficha_.convenio = r.data.convenio;
      lista_ = null;
      sel_ = {};
      vistaFicha(ficha_.convenio.convenio_id, true);
    });
  }
  function periodoMenos(n) { return x_.mover(x_.periodoActual(), n); }
  function formMatriz(desde) {
    var opciones = [0, -1, -2].map(function (n) { var p = periodoMenos(n); return [p, x_.perTexto(p, true)]; });
    U.formulario({
      titulo: desde ? 'Crear fichas desde la matriz Convenios' : 'Pasar a la matriz Convenios', boton: desde ? 'Crear fichas' : 'Pasar a la matriz',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + (desde
        ? 'Cada folio de la matriz que no esté en el seguimiento entra con su fecha, pie, deuda y tipo. Las cuotas se completan pegando la tabla de la TGR.'
        : 'Llena la matriz Convenios del mes (Convenio 1…9: folio, pie, deuda, cuotas canceladas y vencidas, situación, término y tipo) con lo que hay aquí. Quién realiza y la fecha quedan a tu nombre y de hoy.') + '</span>',
      campos: U.campo('Mes', '<select class="sx2-select" name="periodo">' + (desde ? [-1, 0, -2].map(function (n) { var p = periodoMenos(n); return [p, x_.perTexto(p, true)]; }) : opciones).map(function (o) { return '<option value="' + o[0] + '">' + U.esc(o[1]) + '</option>'; }).join('') + '</select>') +
        '<div class="js-cv-prev"></div>',
      alMontar: function (form) {
        function prev() {
          var per = form.querySelector('[name="periodo"]').value, box = form.querySelector('.js-cv-prev');
          box.innerHTML = '<p class="sx2-tenue">Revisando…</p>';
          api(desde ? 'conveniosDesdeMatrizTGR' : 'conveniosAMatrizTGR', { periodo: per, simular: true }).then(function (r) {
            if (!r || !r.ok) { box.innerHTML = '<p class="sx2-campo__error">' + txt((r && r.message) || 'No se pudo revisar.') + '</p>'; return; }
            var d = r.data;
            box.innerHTML = desde
              ? aviso(d.nuevos ? 'info' : 'ok', 'info', d.nuevos ? '<b>' + d.nuevos + ' folios nuevos</b> en la matriz de ' + txt(x_.perTexto(d.periodo, true)) + ': ' + txt(d.ejemplos.join(', ')) + (d.nuevos > d.ejemplos.length ? '…' : '') : 'Todos los folios de ese mes ya están en el seguimiento.')
              : aviso('info', 'info', '<b>' + d.clientes + ' clientes</b> con convenios: ' + d.actualizadas + ' filas de la matriz se actualizan y ' + d.nuevas + ' se crean.' +
                (d.sin_cuotas ? '<br>' + d.sin_cuotas + (d.sin_cuotas === 1 ? ' convenio no tiene' : ' convenios no tienen') + ' sus cuotas cargadas: en esos se mantiene lo que la matriz ya dice de cuotas pagadas, vencidas y situación.' : '') +
                (d.conservados ? '<br>' + d.conservados + (d.conservados === 1 ? ' folio que está' : ' folios que están') + ' en la matriz y no en el seguimiento se ' + (d.conservados === 1 ? 'conserva' : 'conservan') + ' tal cual.' : '') +
                (d.mas_de_9 ? '<br><b>' + d.mas_de_9 + (d.mas_de_9 === 1 ? ' cliente tiene' : ' clientes tienen') + ' más de 9 convenios:</b> la planilla solo tiene 9 columnas; entran los 9 primeros.' : ''));
          });
        }
        form.querySelector('[name="periodo"]').addEventListener('change', prev);
        prev();
      },
      preparar: function (v) { return { periodo: v.periodo }; },
      enviar: function (p) { return api(desde ? 'conveniosDesdeMatrizTGR' : 'conveniosAMatrizTGR', p); },
      aviso: function (r) { return (r && r.data && r.data.message) || 'Listo.'; },
      listo: function () { lista_ = null; vistaLista(true); }
    });
  }
  function formEstado(estado) {
    var c = ficha_.convenio;
    var titulos = { CAIDO: 'Marcar el convenio como caído', TERMINADO: 'Marcar el convenio como terminado', VIGENTE: 'Volver a vigente' };
    U.formulario({
      titulo: titulos[estado], boton: 'Confirmar',
      campos: U.campo(estado === 'CAIDO' ? 'Motivo (obligatorio)' : 'Comentario', '<textarea class="sx2-input" name="motivo" rows="2"' + (estado === 'CAIDO' ? ' required placeholder="Ej.: 3 cuotas impagas, la TGR lo dio por caducado"' : '') + '></textarea>'),
      preparar: function (v) { return { convenio_id: c.convenio_id, estado: estado, motivo: v.motivo }; },
      enviar: function (p) { return api('estadoConvenioTGR', p); },
      aviso: function (r) { return (r && r.data && r.data.message) || 'Listo.'; },
      listo: function () { lista_ = null; vistaFicha(c.convenio_id, true); }
    });
  }

  // =========================================================================================
  // Eventos
  // =========================================================================================
  // =========================================================================================
  // Recibir desde la TGR (piloto "asistido en el navegador", 2026-10-01)
  // =========================================================================================
  // Francisca entra a la TGR con su sesión, abre "Imprimir cuotas de convenios
  // vigentes" y toca el marcador "Enviar a SIGSO": el marcador lee el texto de
  // la página y lo manda a esta pestaña con postMessage. SIGSO no guarda claves
  // ni se conecta a la TGR; solo acepta mensajes de los dominios de la TGR.
  // El marcador y la recepción de mensajes viven en control-interno-v2.js (sirven
  // también para el SII): aquí se toma el último envío de la TGR.
  var recibido_ = null, visto_ = 0, rec_ = { prev: null, crear: {}, asignar: {}, cliente: '', error: '', hecho: null };
  function tomarEnvio() {
    var e = x_.envio && x_.envio();
    if (!e || e.fuente !== 'tgr' || e.t === visto_) return;
    visto_ = e.t;
    recibido_ = e;
    rec_ = { prev: null, crear: {}, asignar: {}, cliente: '', error: '', hecho: null };
  }
  // --- Robot TGR semiautomático (2026-10-02): la Clave Tributaria se escribe
  // aquí, viaja una vez al servidor y no se guarda en ninguna parte. El robot
  // corre en el servidor; esta pantalla pregunta por su avance cada 2 s y, al
  // terminar, sus cuotas pasan por la misma revisión de abajo antes de aplicar.
  var robot_ = { trabajo: null, estado: '', paso: '', inicio: 0, resultado: null, cliente: '', rut: '' };
  // El robot corre en un PC de la oficina (la TGR rechaza al servidor): ¿está conectado?
  var oficina_ = null, oficinaT_ = 0;
  function consultarOficina(repintar) {
    api('robotTgrGeneral', {}).then(function (r) {
      oficina_ = r && r.ok ? r.data : null;
      oficinaT_ = Date.now();
      if (repintar && robot_.estado !== 'EN_CURSO') repintarSiRecibir();
    });
  }
  function oficinaHtml() {
    if (!oficina_ || oficina_.en_servidor) return '';
    var adm = !!(x_.cfg && x_.cfg.puede_administrar);
    return '<p class="cv-oficina ' + (oficina_.conectado ? 'is-on' : 'is-off') + '"><span class="cv-oficina__punto"></span>' +
      (oficina_.conectado ? 'Robot de la oficina <b>conectado</b>' + (oficina_.agentes_conectados.length ? ' (' + txt(oficina_.agentes_conectados.join(', ')) + ')' : '')
        : 'Robot de la oficina <b>no conectado</b>: enciende el programa en el PC de la oficina (o usa el marcador).') +
      (adm ? ' ' + U.boton({ texto: 'Robot de la oficina', icono: 'ajustes', sm: true, variante: 'fantasma', clase: 'js-cv-oficina' }) : '') + '</p>';
  }
  function abrirOficina() {
    var dr = U.drawer({ titulo: 'Robot de la oficina', subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">La TGR rechaza las conexiones del servidor de SIGSO, así que el robot corre en un PC de la oficina. Aquí se autoriza ese equipo.</span>', cuerpo: '', pie: ' ' });
    var llave = '';
    function pintar(lista) {
      dr.cuerpo(
        (llave ? '<div class="mj2-aviso sx2-tono-alerta">' + U.ico('llave', 16) + '<span><b>Llave del equipo (se muestra una sola vez).</b> Cópiala ahora y pégala en el PC cuando el programa la pida.</span></div>' +
          '<div class="cv-llave"><code class="js-cv-llave">' + U.esc(llave) + '</code>' + U.boton({ texto: 'Copiar', icono: 'copiar', sm: true, clase: 'js-cv-llave-copiar' }) + '</div>' +
          '<p style="margin:12px 0 4px"><b>En el PC</b>, desde la carpeta del proyecto SIGSO:</p><pre class="cv-cmd">node backend/herramientas/robot-oficina/agente.js configurar\nnode backend/herramientas/robot-oficina/agente.js --ventana</pre>' : '') +
        '<h3 class="ci2-seccion">Equipos autorizados</h3>' +
        (lista && lista.length ? '<ul class="cv-hechos">' + lista.map(function (a) {
          return '<li><span class="cv-oficina ' + (a.conectado ? 'is-on' : 'is-off') + '"><span class="cv-oficina__punto"></span></span><b>' + txt(a.nombre) + '</b> <span class="sx2-tenue">' + (a.conectado ? 'conectado' : (a.ultimo_contacto ? 'última señal ' + txt(PY.fecha(a.ultimo_contacto, true)) : 'nunca se conectó')) + '</span> ' +
            U.boton({ texto: 'Dar de baja', sm: true, variante: 'fantasma', clase: 'js-cv-agente-baja', datos: { id: a.agente_id } }) + '</li>';
        }).join('') + '</ul>' : '<p class="sx2-tenue">Todavía no hay equipos autorizados.</p>') +
        '<h3 class="ci2-seccion">Autorizar un equipo</h3><div class="sx2-form">' + U.campo('Nombre del equipo', '<input class="sx2-input js-cv-agente-nombre" placeholder="Ej.: PC de Luis (oficina)" maxlength="60">') +
        U.boton({ texto: 'Autorizar este equipo', icono: 'llave', variante: 'primario', clase: 'js-cv-agente-crear' }) + '</div>');
    }
    function cargar() { api('robotAgentes', {}).then(function (r) { pintar(r && r.ok ? r.data.agentes : []); }); }
    dr.el.addEventListener('click', function (ev) {
      var b;
      if (ev.target.closest('.js-cv-agente-crear')) {
        var n = dr.el.querySelector('.js-cv-agente-nombre');
        api('robotAgenteCrear', { nombre: n ? n.value : '' }).then(function (r) {
          if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo autorizar.', 'error'); return; }
          llave = r.data.llave;
          cargar();
        });
      } else if (ev.target.closest('.js-cv-llave-copiar')) {
        var c = dr.el.querySelector('.js-cv-llave');
        if (navigator.clipboard) navigator.clipboard.writeText(llave).then(function () { PY.aviso('Llave copiada.', 'exito'); }, function () { var rg = document.createRange(); rg.selectNodeContents(c); var sel = getSelection(); sel.removeAllRanges(); sel.addRange(rg); });
      } else if ((b = ev.target.closest('.js-cv-agente-baja'))) {
        U.confirmar({ titulo: '¿Dar de baja este equipo?', texto: 'Ya no podrá tomar revisiones del robot. Para volver a usarlo hay que autorizarlo de nuevo.', boton: 'Dar de baja', peligro: true }).then(function (ok) {
          if (ok) api('robotAgenteRevocar', { agente_id: b.getAttribute('data-id') }).then(function (r) { PY.aviso((r && (r.message || (r.data && r.data.message))) || 'Listo.', r && r.ok ? 'exito' : 'error'); cargar(); consultarOficina(true); });
        });
      }
    });
    pintar(null);
    cargar();
  }
  function clientePorEtiqueta(v) { return ((lista_ && lista_.clientes) || []).filter(function (k) { return etiquetaCliente(k) === v; })[0] || null; }
  function enRecibir() { return !!(x_ && x_.vista && x_.vista() === 'conv:tgr'); }
  function repintarSiRecibir() { if (enRecibir()) pintarRecibir(); }
  function iniciarRobot() {
    var raiz = x_.raiz();
    var inCli = raiz.querySelector('.js-cv-rob-cliente'), inRut = raiz.querySelector('.js-cv-rob-rut'), inClave = raiz.querySelector('.js-cv-rob-clave');
    if (!inCli || !inRut || !inClave) return;
    var clave = inClave.value;
    inClave.value = '';
    var cli = clientePorEtiqueta(inCli.value.trim());
    if (!inRut.value.trim()) { PY.aviso('Escribe el RUT con que el cliente entra al SII.', 'error'); return; }
    if (!clave) { PY.aviso('Escribe la Clave Tributaria del cliente.', 'error'); return; }
    robot_ = { trabajo: null, estado: 'EN_CURSO', paso: 'Enviando', inicio: Date.now(), resultado: null, cliente: inCli.value.trim(), rut: inRut.value.trim(), cliente_id: cli ? cli.cliente_id : '' };
    pintarRecibir();
    api('robotTgrRevisar', { cliente_id: robot_.cliente_id, rut: robot_.rut, clave: clave }).then(function (r) {
      if (!r || !r.ok) { robot_.estado = ''; PY.aviso((r && r.message) || 'No se pudo iniciar el robot.', 'error'); consultarOficina(true); return; }
      robot_.trabajo = r.data.trabajo_id;
      seguirRobot();
    });
    clave = '';
  }
  function seguirRobot() {
    var id = robot_.trabajo;
    setTimeout(function () {
      if (!id || robot_.trabajo !== id) return;
      api('robotTgrEstado', { trabajo_id: id }).then(function (r) {
        if (robot_.trabajo !== id) return;
        if (!r || !r.ok) { robot_.estado = 'DETENIDO'; robot_.resultado = { estado: 'ERROR', mensaje: (r && r.message) || 'Se perdió el contacto con el robot.', convenios: [] }; repintarSiRecibir(); return; }
        robot_.paso = r.data.paso;
        robot_.estado = r.data.estado;
        if (r.data.estado === 'EN_CURSO') { repintarSiRecibir(); seguirRobot(); return; }
        robot_.resultado = r.data.resultado;
        consultarOficina(false);
        if (r.data.estado === 'LISTO' && r.data.resultado.convenios.length) {
          recibido_ = { texto: r.data.resultado.texto, pagina: 'el robot TGR', t: Date.now(), fuente: 'tgr', origen: 'robot' };
          rec_ = { prev: null, crear: {}, asignar: {}, cliente: robot_.cliente, error: '', hecho: null };
          if (enRecibir()) revisarRecibido();
        } else repintarSiRecibir();
      });
    }, 2000);
  }
  function robotHtml() {
    var corriendo = robot_.estado === 'EN_CURSO', dis = corriendo ? ' disabled' : '';
    var r = robot_.resultado, estado = '';
    if (corriendo) estado = aviso('info', 'reloj', '<b>' + txt(robot_.paso || 'Trabajando') + '…</b> ' + Math.round((Date.now() - robot_.inicio) / 1000) + ' s. Puede tardar 1 a 2 minutos; no cierres esta pestaña.');
    else if (r && robot_.estado === 'DETENIDO') estado = aviso('critico', 'alerta', '<b>El robot se detuvo.</b> ' + txt(r.mensaje)) + diagnosticoHtml(r.diagnostico);
    else if (r && robot_.estado === 'LISTO') estado = aviso('ok', 'check', txt(r.mensaje) + (r.convenios.length ? ' Revisa abajo qué cambia y aplica.' : ''));
    return oficinaHtml() + '<p class="sx2-tenue" style="margin:0 0 10px">El robot entra a la TGR con la Clave Tributaria del cliente, lee todos sus convenios y cuotas, y te muestra qué cambia antes de aplicar. <b>La clave no se guarda</b>: se usa una vez y se borra.</p>' +
      '<div class="cv-rob">' +
      U.campo('Cliente', '<input class="sx2-input js-cv-rob-cliente" list="cv-dl-rob" value="' + U.esc(robot_.cliente) + '" placeholder="Busca por nombre o RUT" autocomplete="off"' + dis + '><datalist id="cv-dl-rob">' +
        ((lista_ && lista_.clientes) || []).map(function (k) { return '<option value="' + U.esc(etiquetaCliente(k)) + '"></option>'; }).join('') + '</datalist>') +
      U.campo('RUT de ingreso', '<input class="sx2-input js-cv-rob-rut" value="' + U.esc(robot_.rut) + '" placeholder="76123456-7" autocomplete="off"' + dis + '>') +
      U.campo('Clave Tributaria', '<input class="sx2-input js-cv-rob-clave" type="password" autocomplete="new-password" spellcheck="false"' + dis + '>') + '</div>' +
      U.boton({ texto: corriendo ? 'Revisando…' : 'Revisar en la TGR', icono: 'rayo', variante: 'primario', clase: 'js-cv-rob-ir', deshabilitado: corriendo }) + estado;
  }
  function diagnosticoHtml(dg) {
    if (!dg || (!dg.captura && !dg.url)) return '';
    return '<details class="cv-diag"><summary>Ver dónde se detuvo el robot</summary>' + (dg.url ? '<p class="sx2-tenue">' + txt(dg.url) + '</p>' : '') +
      (dg.captura ? '<img alt="Captura de la página donde se detuvo el robot" src="data:image/jpeg;base64,' + U.esc(dg.captura) + '">' : '') + '</details>';
  }
  function vistaRecibir() {
    tomarEnvio();
    if (Date.now() - oficinaT_ > 10000) consultarOficina(true);
    var t = ++turno_;
    var p = lista_ ? Promise.resolve() : api('listarConveniosTGR', {}).then(function (r) { if (r && r.ok) lista_ = r.data; });
    p.then(function () { if (t !== turno_) return; if (recibido_ && !rec_.prev && !rec_.error && !rec_.hecho) revisarRecibido(); else pintarRecibir(); });
  }
  function revisarRecibido() {
    var t = ++turno_;
    pintarRecibir(true);
    api('recibirTGR', { texto: recibido_.texto, simular: true, asignar: rec_.asignar }).then(function (r) {
      if (t !== turno_) return;
      rec_.prev = r && r.ok ? r.data : null;
      rec_.error = r && r.ok ? '' : ((r && r.message) || 'No se pudo leer la página.');
      rec_.crear = {};
      var conCliente = rec_.prev && (rec_.prev.cliente || (recibido_.origen === 'robot' && clientePorEtiqueta(rec_.cliente)));
      if (rec_.prev) rec_.prev.convenios.forEach(function (c) { if (c.nuevo && c.folio && conCliente) rec_.crear[c.folio] = true; });
      pintarRecibir();
    });
  }
  function pintarRecibir(cargando) {
    var reg = registra();
    var pasos = '<ol class="cv-pasos"><li>En la TGR, con tu sesión: <b>Pagos › Convenios de pago › Imprimir documentos › Imprimir cuotas de convenios vigentes</b>, y elige el convenio.</li>' +
      '<li>Toca el marcador <b>Enviar a SIGSO</b> (si seleccionas un trozo de la página, se envía solo eso).</li>' +
      '<li>Se abre esta pestaña con lo que cambió: revisa y <b>Aplica</b>. Repite con el siguiente cliente: llega a esta misma pestaña.</li></ol>';
    var instalar = U.card({ titulo: 'El marcador "Enviar a SIGSO"', icono: 'bandera', cuerpo:
      '<p class="sx2-tenue" style="margin:0 0 10px">Arrastra este botón a la barra de marcadores del navegador (Ctrl+Shift+B la muestra). Se instala una sola vez por computador.</p>' +
      '<a class="sx2-boton sx2-boton--primario cv-marcador js-cv-marcador" href="' + U.esc(x_.marcador()) + '" draggable="true">' + U.ico('bandera', 16) + 'Enviar a SIGSO</a>' + pasos +
      '<p class="sx2-tenue" style="font-size:.8125rem;margin:8px 0 0">SIGSO no guarda claves ni entra a la TGR: solo lee lo que la página ya muestra en tu pantalla, y solo acepta envíos desde los sitios de la TGR.</p>' }) ;
    var pegar = U.card({ titulo: 'Sin marcador: pega la página', icono: 'copiar', cuerpo:
      '<p class="sx2-tenue" style="margin:0 0 8px">En la página de cuotas de la TGR presiona Ctrl+A y Ctrl+C, y pega aquí (Ctrl+V). Puede traer varios convenios.</p>' +
      '<textarea class="sx2-input js-cv-rec-texto" rows="5" placeholder="Pega aquí la página de la TGR"></textarea>' +
      '<div style="margin-top:8px">' + U.boton({ texto: 'Revisar', icono: 'lupa', clase: 'js-cv-rec-pegar' }) + '</div>' });
    var cuerpo = '';
    if (cargando) cuerpo = U.esqueleto('tabla', 4);
    else if (rec_.hecho) {
      cuerpo = aviso('ok', 'check', txt(rec_.hecho.message)) +
        '<div class="sx2-card sx2-entra"><ul class="cv-hechos">' + rec_.prev.convenios.filter(function (c) { return c.convenio_id; }).map(function (c) {
          return '<li><b>' + txt(c.cliente_nombre) + '</b> · folio ' + txt(c.folio_convenio || c.folio) + (c.creado ? ' · <span class="sx2-tenue">nuevo en el seguimiento</span>' : '') + ' ' + U.boton({ texto: 'Abrir ficha', sm: true, variante: 'fantasma', clase: 'js-cv-rec-ficha', datos: { id: c.convenio_id } }) + '</li>';
        }).join('') + '</ul></div>';
    } else if (rec_.error) cuerpo = aviso('critico', 'alerta', txt(rec_.error));
    else if (rec_.prev) {
      var d = rec_.prev, hay = false;
      var cli = d.cliente ? '<b>' + txt(d.cliente.nombre) + '</b> (' + txt(d.cliente.rut) + ')' : (d.rut ? 'RUT ' + txt(d.rut) + ', que <b>no está en el catálogo</b>' : 'sin RUT reconocible');
      var filas = d.convenios.map(function (c, k) {
        var accion;
        // Sin folio en la página (o para corregirlo): se elige el convenio del seguimiento.
        var elegir = reg && (!c.folio || c.asignado || c.nuevo) ? '<div class="cv-asignar">' + U.campo(c.folio && !c.asignado ? 'O asígnalo a un convenio del seguimiento' : '¿De qué convenio son estas cuotas?',
          '<input class="sx2-input js-cv-rec-asignar" data-k="' + k + '" list="cv-dl-conv" value="' + U.esc(c.asignado ? etiquetaConvenio(((lista_ && lista_.convenios) || []).filter(function (x) { return x.convenio_id === c.convenio_id; })[0] || { cliente_nombre: c.cliente_nombre, folio: c.folio_convenio }) : '') + '" placeholder="Busca por cliente o folio" autocomplete="off">') + '</div>' : '';
        if (c.convenio_id) { hay = true; accion = (c.cambios.length ? '<b>' + txt(c.texto_cambios) + '</b>' : '<span class="sx2-tenue">Sin cambios (queda la fecha de revisión)</span>') + elegir; }
        else if (!c.folio) accion = (reg ? '<span class="sx2-tenue">La página no dice el folio.</span>' : '<span class="sx2-tenue">La página no dice el folio: usa "Pegar desde la TGR" en la ficha del convenio.</span>') + elegir;
        else {
          if (rec_.crear[c.folio]) hay = true;
          accion = (reg ? '<label class="cv-chk"><input type="checkbox" class="js-cv-rec-crear" data-folio="' + U.esc(c.folio) + '"' + (rec_.crear[c.folio] ? ' checked' : '') + '> No está en el seguimiento: crearlo</label>' : 'No está en el seguimiento.') + elegir;
        }
        return '<tr><td><b>' + txt(c.asignado ? c.folio_convenio : (c.folio || '—')) + '</b></td><td>' + txt(c.cliente_nombre || (c.nuevo ? (d.cliente ? d.cliente.nombre : '—') : '')) + '</td><td class="ci2-td-numero">' + c.leidas + '</td><td class="ci2-td-numero">' + c.pagadas_tgr + '</td><td>' + accion + '</td></tr>';
      }).join('');
      var faltaCliente = !d.cliente && d.convenios.some(function (c) { return c.nuevo && c.folio && rec_.crear[c.folio]; });
      var clientes = (lista_ && lista_.clientes) || [];
      cuerpo = '<div class="sx2-card sx2-entra"><p style="margin:0 0 10px">Recibido' + (recibido_.pagina ? ' de <b>' + txt(recibido_.pagina) + '</b>' : '') + ' a las ' + txt(new Date(recibido_.t).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })) + ' · contribuyente: ' + cli + '.</p>' +
        '<div class="ci2-grilla-caja"><div class="ci2-grilla" style="max-height:none"><table class="ci2-tabla"><thead><tr><th>Folio</th><th>Cliente</th><th class="ci2-th-numero">Cuotas leídas</th><th class="ci2-th-numero">Pagadas (TGR)</th><th>Qué pasa</th></tr></thead><tbody>' + filas + '</tbody></table></div></div>' +
        (faltaCliente && reg ? '<div style="margin-top:10px">' + U.campo('Cliente de los convenios nuevos', '<input class="sx2-input js-cv-rec-cliente" list="cv-dl-rec" value="' + U.esc(rec_.cliente) + '" placeholder="Busca por nombre o RUT" autocomplete="off"><datalist id="cv-dl-rec">' + clientes.map(function (k) { return '<option value="' + U.esc(etiquetaCliente(k)) + '"></option>'; }).join('') + '</datalist>') + '</div>' : '') +
        '<datalist id="cv-dl-conv">' + ((lista_ && lista_.convenios) || []).map(function (k) { return '<option value="' + U.esc(etiquetaConvenio(k)) + '"></option>'; }).join('') + '</datalist>' +
        '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">' + (reg ? U.boton({ texto: 'Aplicar', icono: 'check', variante: 'primario', clase: 'js-cv-rec-aplicar', deshabilitado: !hay }) : '') +
        U.boton({ texto: 'Descartar', variante: 'fantasma', clase: 'js-cv-rec-descartar' }) + '</div></div>';
    }
    var robot = reg ? U.card({ titulo: 'Robot TGR (semiautomático)', icono: 'rayo', clase: 'cv-robot', cuerpo: robotHtml() }) : '';
    x_.pagina(x_.cabecera('Control interno · Seguimiento de convenios TGR', 'Recibir desde la TGR', 'Las cuotas llegan desde la TGR con el robot, el marcador o pegando la página: sin imprimir ni copiar.',
      U.boton({ texto: 'Volver', icono: 'izquierda', variante: 'fantasma', clase: 'js-cv-volver-lista' })) + robot +
      (cuerpo ? cuerpo : aviso('info', 'info', 'Usa el robot, o deja esta pestaña abierta y envía la página con el marcador.')) +
      '<div class="cv-rec-2">' + instalar + pegar + '</div>', true);
  }
  function aplicarRecibido() {
    var d = rec_.prev, p = { texto: recibido_.texto, origen: recibido_.origen || '', asignar: rec_.asignar, crear: Object.keys(rec_.crear).filter(function (k) { return rec_.crear[k]; }) };
    if (!d.cliente && p.crear.length) {
      var h = ((lista_ && lista_.clientes) || []).filter(function (k) { return etiquetaCliente(k) === rec_.cliente; })[0];
      if (!h) { PY.aviso('Elige el cliente de los convenios nuevos.', 'error'); return; }
      p.cliente_id = h.cliente_id;
    }
    api('recibirTGR', p).then(function (r) {
      if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo aplicar.', 'error'); return; }
      rec_.hecho = r.data;
      rec_.prev = r.data;
      PY.aviso(r.data.message, (r.data.errores || []).length ? 'info' : 'exito');
      api('listarConveniosTGR', {}).then(function (l) { if (l && l.ok) lista_ = l.data; pintarRecibir(); });
    });
  }

  function mio(ev) { var c = document.getElementById('ci2'); return !!c && c.contains(ev.target) && !!x_; }
  function enFicha() { return /^conv:/.test(x_ && x_.vista ? x_.vista() : ''); }
  document.addEventListener('click', function (ev) {
    if (!mio(ev)) return;
    var t = ev.target, b;
    if (t.closest('.js-cv-recargar')) { lista_ = null; vistaLista(); return; }
    if (t.closest('.js-cv-recibir')) { x_.irAItem('conv:tgr'); return; }
    if (t.closest('.js-cv-rob-ir')) { iniciarRobot(); return; }
    if (t.closest('.js-cv-oficina')) { abrirOficina(); return; }
    if (t.closest('.js-cv-marcador')) { ev.preventDefault(); PY.aviso('Arrástralo a la barra de marcadores; se usa en la página de la TGR.', 'info'); return; }
    if (t.closest('.js-cv-volver-lista')) { x_.irAItem('conv'); return; }
    if (t.closest('.js-cv-rec-pegar')) {
      var ta = x_.raiz().querySelector('.js-cv-rec-texto');
      if (!ta || ta.value.trim().length < 10) { PY.aviso('Pega primero la página de la TGR.', 'error'); return; }
      recibido_ = { texto: ta.value.slice(0, 400000), pagina: '', t: Date.now(), fuente: 'tgr' };
      rec_ = { prev: null, crear: {}, asignar: {}, cliente: '', error: '', hecho: null };
      revisarRecibido();
      return;
    }
    if (t.closest('.js-cv-rec-aplicar')) { aplicarRecibido(); return; }
    if (t.closest('.js-cv-rec-descartar')) { recibido_ = null; rec_ = { prev: null, crear: {}, asignar: {}, cliente: '', error: '', hecho: null }; pintarRecibir(); return; }
    if ((b = t.closest('.js-cv-rec-ficha'))) { x_.irAItem('conv:' + b.getAttribute('data-id')); return; }
    if (t.closest('.js-cv-nuevo')) { formConvenio(null); return; }
    if (t.closest('.js-cv-amatriz')) { formMatriz(false); return; }
    if (t.closest('.js-cv-desde')) { formMatriz(true); return; }
    if ((b = t.closest('.cv-fila'))) { x_.irAItem('conv:' + b.getAttribute('data-id')); return; }
    if (!ficha_) return;
    if (t.closest('.js-cv-volver')) { sel_ = {}; x_.irAItem('conv'); return; }
    if (t.closest('.js-cv-pegar')) { formPegar(); return; }
    if (t.closest('.js-cv-editar')) { formConvenio(ficha_.convenio); return; }
    if ((b = t.closest('.js-cv-estado'))) { formEstado(b.getAttribute('data-estado')); return; }
    if ((b = t.closest('.js-cv-rev'))) {
      var n = Number(b.closest('tr').getAttribute('data-n'));
      var q = ficha_.convenio.cuotas.filter(function (k) { return k.n === n; })[0];
      var v = b.getAttribute('data-valor');
      marcar([n], 'revision', q && q.revision === v ? '' : v);
      return;
    }
    if ((b = t.closest('.js-cv-lote'))) {
      var nums = Object.keys(sel_).filter(function (k) { return sel_[k]; }).map(Number);
      var campo = b.getAttribute('data-campo'), valor = b.getAttribute('data-valor');
      marcar(nums, campo, campo === 'contabilizada' ? valor === '1' : valor);
      return;
    }
    if (t.closest('.js-cv-desmarcar')) { sel_ = {}; pintarFicha(true); }
  });
  document.addEventListener('change', function (ev) {
    if (!mio(ev)) return;
    var t = ev.target;
    if (t.classList.contains('js-cv-rec-crear')) { rec_.crear[t.getAttribute('data-folio')] = t.checked; pintarRecibir(); return; }
    if (t.classList.contains('js-cv-rec-cliente')) { rec_.cliente = t.value.trim(); return; }
    if (t.classList.contains('js-cv-rob-cliente')) {
      robot_.cliente = t.value.trim();
      var cr = clientePorEtiqueta(robot_.cliente), inRut = x_.raiz().querySelector('.js-cv-rob-rut');
      if (cr && cr.rut && inRut) { inRut.value = String(cr.rut).replace(/\./g, ''); robot_.rut = inRut.value; }
      return;
    }
    if (t.classList.contains('js-cv-rob-rut')) { robot_.rut = t.value.trim(); return; }
    if (t.classList.contains('js-cv-rec-asignar')) {
      var v = t.value.trim(), k = t.getAttribute('data-k');
      var cv = ((lista_ && lista_.convenios) || []).filter(function (x) { return etiquetaConvenio(x) === v; })[0];
      if (v && !cv) { PY.aviso('Elige un convenio de la lista.', 'error'); return; }
      if (cv) rec_.asignar[k] = cv.convenio_id; else delete rec_.asignar[k];
      revisarRecibido();
      return;
    }
    if (t.classList.contains('js-cv-estado')) { f_.estado = t.value; pintarLista(true); return; }
    if (t.classList.contains('js-cv-alertas')) { f_.alertas = t.checked; pintarLista(true); return; }
    if (!ficha_) return;
    if (t.classList.contains('js-cv-cont')) { marcar([Number(t.closest('tr').getAttribute('data-n'))], 'contabilizada', t.checked); return; }
    if (t.classList.contains('js-cv-sel')) { sel_[Number(t.closest('tr').getAttribute('data-n'))] = t.checked; pintarFicha(true); return; }
    if (t.classList.contains('js-cv-todas')) { ficha_.convenio.cuotas.forEach(function (q) { sel_[q.n] = t.checked; }); pintarFicha(true); }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && ev.target && ev.target.classList && ev.target.classList.contains('js-cv-rob-clave') && mio(ev)) { ev.preventDefault(); iniciarRobot(); }
  });
  var tq_ = null;
  document.addEventListener('input', function (ev) {
    if (!mio(ev) || !ev.target.classList.contains('js-cv-q')) return;
    var v = ev.target.value;
    clearTimeout(tq_);
    tq_ = setTimeout(function () { f_.q = v; pintarLista(true); var q = x_.raiz().querySelector('.js-cv-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 200);
  });
  void enFicha;

  window.SigsoCIConvenios = {
    mostrar: function (id, ctx) {
      x_ = ctx;
      if (id === 'tgr') { ficha_ = null; vistaRecibir(); } else if (id) { sel_ = {}; vistaFicha(id); } else { ficha_ = null; vistaLista(); }
    }
  };
})();
