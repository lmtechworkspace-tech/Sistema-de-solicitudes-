/**
 * finanzas-config-v2.js — Configuración de Finanzas (2026-10-20; FIN-03,
 * FIN-20; backend/logica/finanzasCatalogos.js y finanzasReglas.js).
 *
 *  - Catálogos: empresas (con alias), conceptos por grupo, medios, bancos,
 *    canales, vendedores, obligaciones del mes, repartos y parámetros. No se
 *    borra nada: se desactiva o se le pone fin de vigencia (la historia lo
 *    sigue referenciando).
 *  - Reglas: cada regla de sugerencia con su historia; antes de cambiarla o
 *    desactivarla se ve CUÁNTAS propuestas pendientes cambian. Lo confirmado
 *    no se reescribe.
 *  - Corrección v2 I07.6: crear y editar reglas por glosa exacta con alcance
 *    (empresa, cuenta, entra/sale), vigencia, evidencia y quién la creó; la
 *    vista previa dice cuántos pendientes calzan, cuáles cambian y cuáles
 *    chocan con algo más fuerte (operación registrada, pagador conocido).
 */
(function () {
  'use strict';

  var U = UIv2;
  var x_ = null, cat_ = null;
  var est_ = { tipo: 'CONCEPTO', d: null };
  // I12.2/I12.4: al cerrarse la bóveda, la pantalla olvida las cifras que tenía cargadas.
  document.addEventListener('sigso-fin-cerrada', function () { est_.d = null; });

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function opciones(l, actual, vacio) { return (vacio !== undefined ? '<option value="">' + txt(vacio) + '</option>' : '') + l.map(function (o) { var id = Array.isArray(o) ? o[0] : o, n = Array.isArray(o) ? o[1] : o; return '<option value="' + txt(id) + '"' + (String(id) === String(actual) ? ' selected' : '') + '>' + txt(n) + '</option>'; }).join(''); }
  var GRUPOS = [['INGRESO', 'Ingreso de la empresa'], ['EGRESO', 'Gasto de la empresa'], ['FONDO', 'Obligación de clientes (fondos)'], ['PROVISION', 'Provisión']];

  // ================================================================ catálogos
  function verCatalogos(x) {
    x_ = x;
    var t = x.turno();
    x.pagina(x.cab('catalogos') + U.esqueleto('tabla', 8));
    x.api('finanzasCatalogos').then(function (r) {
      if (!x.vigente(t)) return;
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('catalogos') + U.card({ cuerpo: U.vacio({ accion: '<button type="button" class="sx2-boton sx2-boton--secundario sx2-boton--sm js-fin-reintentar">Reintentar</button>', icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || '' }) })); return; }
      est_.d = r.data;
      pintarCatalogos();
    });
  }
  function detalleElem(tipo, e) {
    if (tipo === 'CONCEPTO') return (GRUPOS.filter(function (g) { return g[0] === e.grupo; })[0] || ['', e.grupo])[1];
    if (tipo === 'PARAMETRO') return 'Valor: ' + e.valor;
    if (tipo === 'OBLIGACION') return 'Día ' + e.dia + (e.conceptos && e.conceptos.length ? ' · ' + e.conceptos.join(', ') : '');
    if (tipo === 'MEDIO') return e.caja === false ? 'No mueve caja' : 'Mueve caja';
    if (tipo === 'REPARTO') return (e.modo || 'IGUALES') + ': ' + (e.partes || []).map(function (p) { return p.empresa + (p.valor !== undefined ? ' ' + p.valor : ''); }).join(', ');
    return (e.alias || []).length ? 'Alias: ' + e.alias.join(', ') : '';
  }
  function pintarCatalogos() {
    var tipos = est_.d.tipos, tp = tipos.filter(function (y) { return y.id === est_.tipo; })[0] || tipos[0];
    est_.tipo = tp.id;
    x_.pagina(x_.cab('catalogos', U.boton({ texto: 'Agregar', icono: 'nueva', sm: true, variante: 'primario', clase: 'js-fcf-nuevo', datos: { cap: 'CONFIGURAR' } })) + '<div class="fin2-config">' +
      '<div class="fin2-hojas" role="tablist" aria-label="Catálogos">' + tipos.map(function (y) {
        return '<button type="button" role="tab" class="fin2-hoja js-fcf-tipo' + (y.id === tp.id ? ' fin2-hoja--act' : '') + '" data-id="' + y.id + '" aria-selected="' + (y.id === tp.id) + '">' + txt(y.nombre) + ' <span class="sx2-chip__n">' + y.elementos.length + '</span></button>';
      }).join('') + '</div>' +
      (tp.id === 'EMPRESA' ? '<p class="fin2-ayuda">Una empresa nueva es una decisión (no se crea desde una planilla). Si un nombre del banco o de la planilla es la misma empresa, agrégalo como alias.</p>' : '') +
      U.card({ sinRelleno: true, cuerpo: tp.elementos.length ? '<div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>Nombre</th><th>Detalle</th><th>Vigencia</th><th>Estado</th><th></th></tr></thead><tbody>' + tp.elementos.map(function (e) {
        return '<tr' + (e.activo ? '' : ' class="fin2-fila-inactiva"') + '><td><b>' + txt(e.nombre) + '</b>' + (e.id !== e.nombre ? '<br><small class="fin2-ayuda">' + txt(e.id) + '</small>' : '') + '</td><td>' + txt(detalleElem(tp.id, e)) + '</td>' +
          '<td class="fin2-num">' + txt(e.vigente_desde || '') + (e.vigente_hasta ? ' → ' + txt(e.vigente_hasta) : '') + '</td><td>' + U.badge(e.activo ? 'Activo' : 'Inactivo', e.activo ? 'ok' : 'neutro') + '</td>' +
          '<td>' + U.boton({ texto: 'Editar', sm: true, variante: 'fantasma', clase: 'js-fcf-editar', datos: { id: e.id, cap: 'CONFIGURAR' } }) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : U.vacio({ icono: 'lista', texto: 'Sin elementos.' }) }) + '</div>');
    var raiz = x_.raiz();
    raiz.querySelector('.fin2-config').addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      if (b.classList.contains('js-fcf-tipo')) { est_.tipo = b.dataset.id; pintarCatalogos(); }
      else if (b.classList.contains('js-fcf-editar')) formElemento(tp, tp.elementos.filter(function (e) { return e.id === b.dataset.id; })[0]);
    });
    raiz.querySelector('.js-fcf-nuevo') && raiz.querySelector('.js-fcf-nuevo').addEventListener('click', function () { formElemento(tp, null); });
  }
  function formElemento(tp, e) {
    e = e || {};
    var extra = '';
    if (tp.id === 'CONCEPTO') extra = U.campo('Grupo', '<select name="grupo" class="sx2-input" required' + (e.id ? ' disabled' : '') + '>' + opciones(GRUPOS, e.grupo, 'Elige…') + '</select>', e.id ? 'Un concepto ya usado no cambia de grupo: crea uno nuevo.' : '');
    else if (tp.id === 'PARAMETRO') extra = U.campo('Valor', '<input name="valor" class="sx2-input" required value="' + txt(e.valor === undefined ? '' : e.valor) + '">');
    else if (tp.id === 'OBLIGACION') extra = U.campo('Día del mes', '<input name="dia" type="number" min="1" max="31" class="sx2-input" required value="' + txt(e.dia || '') + '">') +
      U.campo('Conceptos de gasto que la pagan (separados por coma)', '<input name="conceptos" class="sx2-input" value="' + txt((e.conceptos || []).join(', ')) + '">', 'Se usan para estimar la obligación con lo pagado antes.');
    else if (tp.id === 'MEDIO') extra = '<label class="sx2-campo fin2-check"><input type="checkbox" name="caja" value="1"' + (e.caja === false ? '' : ' checked') + '><span>Mueve caja (desmarca para compensaciones)</span></label>';
    if (tp.id !== 'PARAMETRO') extra += U.campo('Alias (separados por coma)', '<input name="alias" class="sx2-input" value="' + txt((e.alias || []).join(', ')) + '">');
    U.formulario({ titulo: (e.id ? 'Editar · ' : 'Agregar · ') + tp.nombre, boton: 'Guardar',
      campos: U.campo('Nombre', '<input name="nombre" class="sx2-input" required value="' + txt(e.nombre || '') + '">') + extra +
        U.campo('Vigente desde', '<input type="date" name="vigente_desde" class="sx2-input" value="' + txt(e.vigente_desde || '') + '">') +
        U.campo('Vigente hasta', '<input type="date" name="vigente_hasta" class="sx2-input" value="' + txt(e.vigente_hasta || '') + '">', 'Para retirarlo sin borrar la historia.') +
        '<label class="sx2-campo fin2-check"><input type="checkbox" name="activo" value="1"' + (e.id && !e.activo ? '' : ' checked') + '><span>Activo</span></label>',
      preparar: function (v) {
        var d = { tipo: tp.id, id: e.id, expected_version: e.id ? e.version : undefined, nombre: v.nombre, vigente_desde: v.vigente_desde, vigente_hasta: v.vigente_hasta, activo: v.activo === '1', grupo: v.grupo || e.grupo };
        if (v.alias !== undefined) d.alias = v.alias.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        if (tp.id === 'PARAMETRO') d.valor = v.valor;
        if (tp.id === 'OBLIGACION') { d.dia = v.dia; d.conceptos = (v.conceptos || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean); }
        if (tp.id === 'MEDIO') d.caja = v.caja === '1';
        return d;
      },
      enviar: function (d) { return x_.api('finanzasGuardarCatalogo', d); }, aviso: 'Guardado.', listo: function () { x_.catalogo(true); verCatalogos(x_); } });
  }

  // ================================================================ reglas
  function verReglas(x) {
    x_ = x;
    var t = x.turno();
    x.pagina(x.cab('reglas') + U.esqueleto('tabla', 8));
    Promise.all([x.catalogo(), x.api('finanzasReglas'), x.api('finanzasResumenBancos')]).then(function (rs) {
      if (!x.vigente(t)) return;
      cat_ = rs[0];
      est_.cuentas = rs[2] && rs[2].ok ? rs[2].data.cuentas : [];
      var r = rs[1];
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('reglas') + U.card({ cuerpo: U.vacio({ accion: '<button type="button" class="sx2-boton sx2-boton--secundario sx2-boton--sm js-fin-reintentar">Reintentar</button>', icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || '' }) })); return; }
      var d = r.data;
      var tipoNom = function (c) { var y = (cat_.tipos || []).filter(function (z) { return c && z.id === c.tipo; })[0]; return c ? (y ? y.nombre : c.tipo) + (c.cuenta ? ' · ' + c.cuenta : '') + (c.cliente ? ' · ' + c.cliente : '') : '—'; };
      x.pagina(x.cab('reglas') + '<div class="fin2-config">' +
        '<div class="fin2-cinta fin2-cinta--info">' + U.ico('info', 16) + '<span>' + txt(d.nota) + '</span></div>' +
        U.card({ titulo: 'Reglas de sugerencia', icono: 'rayo', sub: d.reglas.length + ' regla(s)', sinRelleno: true, accion: { texto: 'Nueva regla', clase: 'js-fcr-nueva', datos: { cap: 'REGLAS' } }, cuerpo: d.reglas.length ? '<div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>Cuando la glosa es</th><th>Propone</th><th>Alcance y vigencia</th><th>Usos</th><th>Origen</th><th>Estado</th><th></th></tr></thead><tbody>' + d.reglas.map(function (g) {
          est_.reglas = d.reglas;
          return '<tr' + (g.activa ? '' : ' class="fin2-fila-inactiva"') + '><td><code>' + txt(g.glosa) + '</code>' + (g.evidencia ? '<br><small class="fin2-ayuda">Evidencia: ' + txt(g.evidencia) + '</small>' : '') + '</td><td>' + txt(tipoNom(g.clasif)) + '</td>' +
            '<td><small>' + txt(alcanceTxt(g)) + '</small></td><td class="fin2-num">' + (g.usos || 0) + '</td><td>' + txt(g.creada_por || g.origen || '') + (g.historial.length ? '<br><small class="fin2-ayuda">' + g.historial.length + ' cambio(s) · v' + g.version + '</small>' : '') + '</td>' +
            '<td>' + U.badge(g.activa ? 'Activa' : 'Desactivada', g.activa ? 'ok' : 'neutro') + '</td><td class="fin2-acciones-min" data-cap="REGLAS">' + U.boton({ texto: 'Editar', sm: true, variante: 'fantasma', clase: 'js-fcr-editar', datos: { id: g.id } }) + U.boton({ texto: g.activa ? 'Desactivar' : 'Activar', sm: true, variante: 'fantasma', clase: 'js-fcr-act', datos: { id: g.id, v: g.version, activa: g.activa ? '0' : '1' } }) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : U.vacio({ icono: 'rayo', texto: 'Las reglas se crean al clasificar un movimiento y marcar «recordar», o con «Nueva regla».' }) }) +
        U.card({ titulo: 'Pagadores conocidos', icono: 'persona', sub: 'quién paga por qué cliente', sinRelleno: true, cuerpo: d.pagadores.length ? '<div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>Pagador</th><th>Clientes</th><th>Estado</th><th></th></tr></thead><tbody>' + d.pagadores.map(function (p) {
          return '<tr' + (p.activo ? '' : ' class="fin2-fila-inactiva"') + '><td><b>' + txt(p.nombre) + '</b></td><td>' + p.clientes.map(function (c) { return txt(c.cliente || c.cliente_id) + (c.veces ? ' (' + c.veces + ')' : ''); }).join(', ') + '</td><td>' + U.badge(p.activo ? 'Activo' : 'Desactivado', p.activo ? 'ok' : 'neutro') + '</td>' +
            '<td class="fin2-acciones-min" data-cap="REGLAS">' + U.boton({ texto: p.activo ? 'Desactivar' : 'Activar', sm: true, variante: 'fantasma', clase: 'js-fcr-pag', datos: { h: p.huella, activo: p.activo ? '0' : '1' } }) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : U.vacio({ icono: 'persona', texto: 'Se aprenden del detalle del banco.' }) }) +
        U.card({ titulo: 'Nombres cortos del Excel BANCOS', icono: 'etiqueta', sinRelleno: true, cuerpo: d.alias.length ? '<div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>Nombre corto</th><th>Significa</th><th>Estado</th><th></th></tr></thead><tbody>' + d.alias.map(function (a) {
          var de = a.destino || {};
          return '<tr' + (a.activo ? '' : ' class="fin2-fila-inactiva"') + '><td><b>' + txt(a.alias) + '</b></td><td>' + txt(de.clase === 'cliente' ? 'Cliente: ' + de.cliente : de.clase === 'empresa' ? 'Empresa: ' + de.empresa : de.clase === 'gasto' ? 'Gasto: ' + de.cuenta : '—') + '</td><td>' + U.badge(a.activo ? 'Activo' : 'Desactivado', a.activo ? 'ok' : 'neutro') + '</td>' +
            '<td class="fin2-acciones-min" data-cap="REGLAS">' + U.boton({ texto: a.activo ? 'Desactivar' : 'Activar', sm: true, variante: 'fantasma', clase: 'js-fcr-alias', datos: { h: a.huella, activo: a.activo ? '0' : '1' } }) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : U.vacio({ icono: 'etiqueta', texto: 'Se aprenden del Excel BANCOS.' }) }) + '</div>');
      x.aplicarCapacidades();
      x.raiz().querySelector('.fin2-config').addEventListener('click', function (ev) {
        var b = ev.target.closest('button'); if (!b) return;
        if (b.classList.contains('js-fcr-act')) cambiarRegla(b.dataset.id, Number(b.dataset.v), b.dataset.activa === '1');
        else if (b.classList.contains('js-fcr-nueva')) formRegla(null);
        else if (b.classList.contains('js-fcr-editar')) formRegla((est_.reglas || []).filter(function (g) { return g.id === b.dataset.id; })[0]);
        else if (b.classList.contains('js-fcr-pag')) conImpacto('finanzasGuardarPagador', { huella: b.dataset.h, activo: b.dataset.activo === '1' }, 'pagador');
        else if (b.classList.contains('js-fcr-alias')) x_.api('finanzasGuardarAliasRegla', { huella: b.dataset.h, activo: b.dataset.activo === '1' }).then(function (r) { x_.aviso(r && r.ok ? r.data.nota : (r && r.message) || 'No se pudo.', r && r.ok ? 'exito' : 'error'); verReglas(x_); });
      });
    });
  }
  /** Primero muestra cuántas propuestas pendientes cambian; luego aplica. */
  function conImpacto(accion, datos, que) {
    x_.api(accion, Object.assign({ previsualizar: true }, datos)).then(function (r) {
      if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo.', 'error'); return; }
      var imp = r.data.impacto || { pendientes: 0, cambian: [] };
      U.confirmar({ titulo: (que === 'regla nueva' ? 'Crear esta regla' : que === 'regla' ? 'Cambiar esta regla' : 'Cambiar este ' + que), texto: (imp.conflictos ? '⚠ ' + imp.conflictos + ' de ellos hoy los propone algo más fuerte (una operación registrada o un pagador conocido): revísalos. ' : '') + (r.data.ambigua ? '⚠ Varios clientes empiezan con ese nombre corto: la regla quedará como propuesta a revisar, nunca segura. ' : '') + 'Calzan ' + imp.pendientes + ' pendiente(s). ' + (imp.cambian.length ? 'Cambia la propuesta de ' + imp.cambian.length + ' movimiento(s) pendiente(s) (de ' + imp.pendientes + '): ' + imp.cambian.slice(0, 3).map(function (c) { return c.fecha + ' ' + c.glosa + ': ' + (c.antes || '—') + ' → ' + (c.despues || '—'); }).join(' · ') + '. Lo confirmado no cambia.' : 'No cambia ninguna propuesta pendiente. Lo confirmado no cambia.'), boton: 'Aplicar' })
        .then(function (si) { if (!si) return; x_.api(accion, datos).then(function (rr) { x_.aviso(rr && rr.ok ? 'Listo' + (rr.data.cambiadas ? ': ' + rr.data.cambiadas + ' propuesta(s) actualizadas.' : '.') : (rr && rr.message) || 'No se pudo.', rr && rr.ok ? 'exito' : 'error'); verReglas(x_); }); });
    });
  }
  function cambiarRegla(id, v, activa) { conImpacto('finanzasGuardarRegla', { id: id, expected_version: v, activa: activa }, 'regla'); }
  function alcanceTxt(g) {
    var a = g.alcance || {}, v = g.vigencia || {};
    var cta = a.cuenta_ref ? ((est_.cuentas || []).filter(function (c) { return c.id === a.cuenta_ref; })[0] || {}) : null;
    var l = [a.empresa ? 'Solo ' + a.empresa : 'Todas las empresas', cta ? 'cuenta ' + (cta.banco || '') + ' ···' + (cta.ultimos4 || '') : '', a.sentido ? (a.sentido === 'abono' ? 'solo lo que entra' : 'solo lo que sale') : '',
      v.desde || v.hasta ? 'vigente ' + (v.desde || '…') + ' → ' + (v.hasta || '…') : 'sin vencimiento'];
    return l.filter(Boolean).join(' · ');
  }
  /** Crear o editar una regla por glosa EXACTA: qué propone, dónde aplica, hasta cuándo y en qué se basa. */
  function formRegla(g) {
    g = g || {};
    var c = g.clasif || {}, a = g.alcance || {}, v = g.vigencia || {};
    var tipos = (cat_.tipos || []).map(function (y) { return [y.id, y.nombre]; });
    var cuentasTipo = function (t) { var y = (cat_.tipos || []).filter(function (z) { return z.id === t; })[0]; return y ? y.cuentas : []; };
    U.formulario({ titulo: g.id ? 'Editar regla' : 'Nueva regla', boton: 'Ver impacto', ancho: true,
      campos: '<p class="fin2-ayuda">Una regla propone la clasificación de los movimientos con esta glosa EXACTA. No se aceptan glosas genéricas (que no dicen quién es). Cambiarla solo recalcula lo pendiente; lo confirmado no se toca.</p><div class="fin2-form-grid">' +
        U.campo('Glosa exacta del banco', '<input name="glosa" class="sx2-input" required value="' + txt(g.glosa || '') + '"' + (g.id ? ' readonly' : '') + '>') +
        U.campo('Naturaleza', '<select name="tipo" class="sx2-input js-fcr-tipo" required>' + opciones(tipos, c.tipo || '', 'Elige…') + '</select>') +
        U.campo('Concepto', '<select name="cuenta" class="sx2-input js-fcr-cuenta">' + opciones(cuentasTipo(c.tipo).map(function (x) { return [x, x]; }), c.cuenta || '', '—') + '</select>') +
        U.campo('Cliente (si corresponde)', '<select name="cliente_id" class="sx2-input">' + opciones((cat_.clientes || []).map(function (x) { return [x.id, x.nombre]; }), c.cliente_id || '', '—') + '</select>') +
        U.campo('Solo para la empresa', '<select name="a_empresa" class="sx2-input">' + opciones((cat_.empresas || []).map(function (e) { return [e, e]; }), a.empresa || '', 'Todas') + '</select>') +
        U.campo('Solo para la cuenta', '<select name="a_cuenta" class="sx2-input">' + opciones((est_.cuentas || []).map(function (x) { return [x.id, (x.banco || '') + ' ···' + (x.ultimos4 || '') + ' · ' + (x.empresa || '')]; }), a.cuenta_ref || '', 'Todas') + '</select>') +
        U.campo('Entra o sale', '<select name="a_sentido" class="sx2-input">' + opciones([['abono', 'Solo lo que entra'], ['cargo', 'Solo lo que sale']], a.sentido || '', 'Ambos') + '</select>') +
        U.campo('Vigente desde', '<input type="date" name="desde" class="sx2-input" value="' + txt(v.desde || '') + '">') + U.campo('Vigente hasta', '<input type="date" name="hasta" class="sx2-input" value="' + txt(v.hasta || '') + '">') +
        U.campo('Evidencia', '<input name="evidencia" class="sx2-input" required value="' + txt(g.evidencia || '') + '" placeholder="Contrato, indicación de contabilidad…">') + '</div>',
      alMontar: function (form) { form.querySelector('.js-fcr-tipo').addEventListener('change', function (ev) { form.querySelector('.js-fcr-cuenta').innerHTML = opciones(cuentasTipo(ev.target.value).map(function (x) { return [x, x]; }), '', '—'); }); },
      enviar: function (d) {
        var datos = { clasif: { tipo: d.tipo, cuenta: d.cuenta, cliente_id: d.cliente_id }, alcance: { empresa: d.a_empresa, cuenta_ref: d.a_cuenta, sentido: d.a_sentido }, vigencia: { desde: d.desde, hasta: d.hasta }, evidencia: d.evidencia };
        if (g.id) Object.assign(datos, { id: g.id, expected_version: g.version }); else datos.glosa = d.glosa;
        conImpacto(g.id ? 'finanzasGuardarRegla' : 'finanzasCrearRegla', datos, g.id ? 'regla' : 'regla nueva');
        return Promise.resolve({ ok: true, data: {} });
      } });
  }

  window.SigsoFinanzasConfig = { verCatalogos: verCatalogos, verReglas: verReglas };
})();
