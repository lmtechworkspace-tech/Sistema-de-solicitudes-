/**
 * finanzas-fondos-v2.js — Fondos de clientes (2026-10-20; FIN-13 a FIN-16;
 * backend/logica/finanzasFondos.js).
 *
 * El dinero que los clientes mandan para sus obligaciones NO es de la
 * empresa. Aquí se ve por cliente: saldo inicial aprobado + recibido +
 * reintegros − pagado − devuelto ± reasignado, separado por GESTIÓN
 * (obligación y período: «imposiciones de julio»). Un cliente con déficit
 * no compensa a otro con saldo a favor.
 *
 *  - Saldo inicial (apertura): se propone con su fuente y lo aprueba otra
 *    persona con la capacidad APERTURA; sin él, el saldo es PARCIAL.
 *  - Asignar a una gestión no cambia montos ni la clasificación.
 *  - Reasignar pasa saldo entre gestiones del MISMO cliente, con motivo.
 *  - El remanente se decide por escrito; devolver o cobrar se registran aparte.
 */
(function () {
  'use strict';

  var U = UIv2;
  var x_ = null, cat_ = null;
  var est_ = { d: null, filtro: 'todos', busca: '', ficha: null, sel: {} };
  // I12.2/I12.4: al cerrarse la bóveda, la pantalla olvida las cifras que tenía cargadas.
  document.addEventListener('sigso-fin-cerrada', function () { est_.d = null; est_.ficha = null; est_.sel = {}; });
  var CLASE = { recibido: 'Recibido', reintegros: 'Reintegro', pagado: 'Pagado', devuelto: 'Devuelto' };

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function plata(n) { if (n === null || n === undefined) return '—'; var v = Math.round(Number(n) || 0); return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('es-CL'); }
  function uuid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); }
  function opciones(l, actual, vacio) { return (vacio !== undefined ? '<option value="">' + txt(vacio) + '</option>' : '') + l.map(function (o) { return '<option value="' + txt(o[0]) + '"' + (String(o[0]) === String(actual) ? ' selected' : '') + '>' + txt(o[1]) + '</option>'; }).join(''); }
  function obligaciones() { var t = ((cat_ && cat_.tipos) || []).filter(function (y) { return y.id === 'FONDO_PAGADO'; })[0]; return t ? t.cuentas : []; }
  function empresas() { return ((cat_ && cat_.empresas) || []).map(function (e) { return [e, e]; }); }

  function ver(x) {
    x_ = x; enlazar();
    var t = x.turno();
    x.pagina(x.cab('fondos') + U.esqueleto('kpis', 3) + U.esqueleto('tabla', 8));
    Promise.all([x.catalogo(), x.api('finanzasFondos', { empresa: x.contexto().empresa || '' })]).then(function (rs) {
      if (!x.vigente(t)) return;
      cat_ = rs[0];
      var r = rs[1];
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('fondos') + U.card({ cuerpo: U.vacio({ accion: '<button type="button" class="sx2-boton sx2-boton--secundario sx2-boton--sm js-fin-reintentar">Reintentar</button>', icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || '' }) })); return; }
      est_.d = r.data;
      pintar();
      var abrir = x.contexto().cliente_fondos;
      if (abrir) { x.contexto({ cliente_fondos: '' }); ficha(abrir); }
    });
  }
  function visibles() {
    var q = est_.busca.toLowerCase();
    return est_.d.clientes.filter(function (c) {
      if (q && (c.cliente + ' ' + c.rut).toLowerCase().indexOf(q) === -1) return false;
      if (est_.filtro === 'favor') return c.saldo > 0;
      if (est_.filtro === 'deficit') return c.saldo < 0;
      if (est_.filtro === 'parcial') return c.parcial;
      if (est_.filtro === 'gestiones') return c.gestiones_abiertas > 0;
      return true;
    });
  }
  function pintar() {
    var d = est_.d, l = visibles();
    var n = function (f) { var a = est_.filtro; est_.filtro = f; var k = visibles().length; est_.filtro = a; return k; };
    x_.pagina(x_.cab('fondos', U.boton({ texto: 'Cargar saldos iniciales', icono: 'subir', sm: true, clase: 'js-fo-lote', datos: { cap: 'FONDOS' } }) +
      (d.aperturas_propuestas ? U.boton({ texto: 'Por aprobar (' + d.aperturas_propuestas + ')', icono: 'check', sm: true, clase: 'js-fo-por-aprobar', datos: { cap: 'APERTURA' } }) : '') +
      U.boton({ texto: 'Nueva gestión', icono: 'nueva', sm: true, variante: 'primario', clase: 'js-fo-nueva', datos: { cap: 'FONDOS' } })) +
      '<div class="sx2-fila-kpis">' +
        U.kpi({ etiqueta: 'En custodia (saldos a favor)', valor: plata(d.positivos), icono: 'escudo', tono: 'info', titulo: 'Suma de los clientes con saldo a favor: es dinero de ellos.' }) +
        U.kpi({ etiqueta: 'Déficit (clientes en negativo)', valor: plata(d.negativos), icono: 'alerta', tono: d.negativos < 0 ? 'critico' : 'neutro', i: 1, titulo: 'No se compensa con el saldo de otros clientes.' }) +
        U.kpi({ etiqueta: 'Sin saldo inicial aprobado', valor: d.sin_apertura, icono: 'reloj', tono: d.sin_apertura ? 'alerta' : 'ok', i: 2, titulo: 'Sin apertura el saldo es parcial.' }) +
      '</div>' +
      (d.politica ? '<p class="fin2-ayuda">' + U.ico('escudo', 12) + ' <b>Política de saldos iniciales:</b> ' + txt(d.politica.texto) + ' Pueden aprobar: ' + txt(d.politica.aprobadores.join(', ') || 'nadie con ese permiso') + '. Se cambia en Configuración › Parámetros.</p>' : '') +
      (d.parcial ? '<div class="fin2-cinta fin2-cinta--alerta">' + U.ico('alerta', 16) + '<span>Hay clientes <b>sin saldo inicial aprobado</b>: su saldo puede no incluir lo que mandaron antes de la primera cartola. Antes de concluir que la empresa puso dinero, registra y aprueba el saldo inicial.</span></div>' : '') +
      '<div class="fin2-ctx"><label class="fin2-busca">' + U.ico('lupa', 14) + '<input class="js-fo-busca" type="search" placeholder="Cliente o RUT" value="' + txt(est_.busca) + '" aria-label="Buscar cliente"></label>' +
        '<div class="fin2-filtros">' + [['todos', 'Todos'], ['favor', 'A favor'], ['deficit', 'En negativo'], ['parcial', 'Sin saldo inicial'], ['gestiones', 'Con gestiones abiertas']].map(function (f) {
          return U.chip({ texto: f[1], n: n(f[0]), activo: est_.filtro === f[0], clase: 'js-fo-filtro', datos: { id: f[0] } });
        }).join('') + '</div></div>' +
      U.card({ sinRelleno: true, cuerpo: l.length ? '<div class="fin2-tabla-envoltura"><table class="fin2-tabla fin2-tabla--clic"><thead><tr><th>Cliente</th><th>RUT</th><th class="fin2-der">Saldo</th><th>Gestiones abiertas</th><th>Estado</th></tr></thead><tbody>' + l.map(function (c) {
        return '<tr class="js-fo-cli" data-id="' + txt(c.cliente_id) + '" tabindex="0"><td><b>' + txt(c.cliente) + '</b></td><td class="fin2-num">' + txt(c.rut) + '</td><td class="fin2-der fin2-num ' + (c.saldo < 0 ? 'fin2-neg' : '') + '">' + plata(c.saldo) + '</td><td>' + (c.gestiones_abiertas || '—') + '</td><td>' +
          (c.parcial ? U.badge('Parcial: falta saldo inicial', 'alerta') : c.saldo < 0 ? U.badge('Déficit', 'critico') : U.badge('Con saldo inicial', 'ok')) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : U.vacio({ icono: 'escudo', titulo: 'Sin clientes en este filtro', texto: 'Los fondos aparecen al confirmar movimientos u operaciones como «Fondo del cliente recibido» o «Pago por cuenta del cliente».' }) }));
  }

  // ---- ficha del cliente --------------------------------------------------------------------
  function ficha(id) {
    est_.sel = {};
    x_.api('finanzasFichaFondos', { cliente_id: id }).then(function (r) {
      if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo abrir.', 'error'); return; }
      est_.ficha = r.data;
      pintarFicha();
    });
  }
  function desglose(s) {
    return '<dl class="fin2-desglose">' + [['Saldo inicial', s.apertura], ['Recibido', s.recibido], ['Reintegros', s.reintegros], ['Pagado', -s.pagado], ['Devuelto', -s.devuelto], ['Reasignado (entra)', s.reasignado_entra], ['Reasignado (sale)', -s.reasignado_sale]]
      .filter(function (p) { return p[1]; }).map(function (p) { return '<div><dt>' + p[0] + '</dt><dd class="fin2-num">' + plata(p[1]) + '</dd></div>'; }).join('') + '<div class="fin2-desglose__total"><dt>Saldo</dt><dd class="fin2-num ' + (s.saldo < 0 ? 'fin2-neg' : '') + '">' + plata(s.saldo) + '</dd></div></dl>';
  }
  function piezas(l, conSel, conSugerencias) {
    if (!l.length) return '<p class="fin2-ayuda">Sin movimientos.</p>';
    return '<ul class="fin2-piezas">' + l.map(function (p) {
      return '<li>' + (conSel ? '<input type="checkbox" class="js-fo-pieza" value="' + txt(p.ref) + '"' + (est_.sel[p.ref] ? ' checked' : '') + ' aria-label="Marcar">' : '') +
        '<span class="fin2-num">' + txt(p.fecha) + '</span><span>' + U.badge(CLASE[p.clase] || p.clase, p.monto >= 0 ? 'ok' : 'neutro') + ' ' + txt(p.concepto || '') + (p.periodo_obligacion ? ' · ' + txt(p.periodo_obligacion) : '') + (p.destino ? ' · ' + txt(p.destino) : '') +
        '<small>' + txt(p.glosa || p.pagador) + ' · ' + txt(p.fuente === 'REGISTRO' ? 'registro' : p.cuenta) + '</small>' +
        (conSugerencias ? '<span class="fin2-acciones-min" data-cap="FONDOS">' + (p.sugerencias || []).map(function (sg) { return U.boton({ texto: 'Asignar a ' + sg.nombre, sm: true, clase: 'js-fo-sug', datos: { ref: p.ref, g: sg.gestion_id }, titulo: sg.motivos.join(', ') }); }).join('') +
          U.boton({ texto: 'Crear gestión con este movimiento', sm: true, variante: 'fantasma', clase: 'js-fo-desde', datos: { ref: p.ref } }) + '</span>' : '') +
        '</span><b class="fin2-num ' + (p.monto < 0 ? '' : 'fin2-pos') + '">' + plata(p.monto) + '</b></li>';
    }).join('') + '</ul>';
  }
  function pintarFicha() {
    var f = est_.ficha;
    var gest = f.gestiones;
    var aps = f.aperturas.filter(function (a) { return a.estado !== 'ANULADA'; });
    var ff = est_.ffiltro || 'todas';
    if (ff !== 'todas' && ff !== 'sin_asignacion') gest = gest.filter(function (g) { return g.banderas && g.banderas[ff]; });
    var cuerpo = '<div class="fin2-p">' +
      '<div class="fin2-ficha-cab"><div><small>Saldo total al día</small><b class="fin2-num ' + (f.saldo < 0 ? 'fin2-neg' : '') + '">' + plata(f.saldo) + '</b></div>' + (f.apertura === 'CONOCIDA' ? U.badge('Saldo inicial conocido', 'ok') : f.apertura === 'PROPUESTA' ? U.badge('Saldo inicial propuesto (aún no cuenta)', 'alerta') : U.badge('Parcial: saldo inicial desconocido', 'alerta')) + '</div>' +
      '<div class="fin2-filtros" role="group" aria-label="Qué gestiones mostrar">' + [['todas', 'Todas'], ['pendiente_ejecutar', 'Por ejecutar'], ['deficit', 'Con déficit'], ['remanente_sin_decidir', 'Remanente sin decidir'], ['sin_asignacion', 'Sin asignar']].map(function (x) {
        return U.chip({ texto: x[1], n: x[0] === 'todas' ? gest.length : f.filtros[x[0]], activo: (est_.ffiltro || 'todas') === x[0], clase: 'js-fo-ffiltro', datos: { id: x[0] } });
      }).join('') + '</div>' +
      (f.nota_parcial ? '<div class="fin2-p-caja fin2-p-caja--alerta">' + U.ico('alerta', 16) + '<span>' + txt(f.nota_parcial) + '</span></div>' : '') +
      '<section class="fin2-p-sec"><h3>Saldo inicial</h3>' + (aps.length ? '<ul class="fin2-lista-saldos">' + aps.map(function (a) {
        return '<li' + (a.estado === 'REEMPLAZADA' ? ' class="fin2-tenue"' : '') + '><span>Al ' + txt(a.fecha_corte) + ' · ' + txt(a.empresa) + ' ' + U.badge(a.estado === 'APROBADA' ? 'Aprobada por ' + (a.aprobado_por || '') + (a.misma_persona ? ' (misma persona que propuso)' : '') : a.estado === 'REEMPLAZADA' ? 'Reemplazada por una versión nueva' : 'Propuesta por ' + a.creado_por + (a.reemplaza ? ' · corrige la anterior' : ''), a.estado === 'APROBADA' ? 'ok' : a.estado === 'REEMPLAZADA' ? 'neutro' : 'alerta') +
          '<small>Fuente: ' + txt(a.fuente) + (a.monto === 0 ? ' · cero conocido (no es lo mismo que no saberlo)' : '') + (a.motivo_correccion ? ' · motivo: ' + txt(a.motivo_correccion) : '') + '</small></span><b class="fin2-num">' + plata(a.monto) + '</b>' +
          (a.estado === 'APROBADA' ? '<span class="fin2-acciones-min">' + U.boton({ texto: 'Corregir (nueva versión)', sm: true, variante: 'fantasma', clase: 'js-fo-corregir', datos: { id: a.id, v: a.version, cap: 'FONDOS' } }) + '</span>' : '') +
          (a.estado === 'PROPUESTA' ? '<span class="fin2-acciones-min">' + U.boton({ texto: 'Aprobar', sm: true, clase: 'js-fo-ap', datos: { id: a.id, v: a.version, accion: 'APROBAR', cap: 'APERTURA' } }) + U.boton({ texto: 'Anular', sm: true, variante: 'fantasma', clase: 'js-fo-ap', datos: { id: a.id, v: a.version, accion: 'ANULAR', cap: 'FONDOS' } }) + '</span>' : '') + '</li>';
      }).join('') + '</ul>' : '<p class="fin2-ayuda">Sin saldo inicial: no se sabe cuánto tenía antes del primer mes cargado. Regístralo con su fuente (cartola o planilla). Si es un cliente nuevo sin historia, un saldo inicial $0 documentado también vale. ' + txt((f.politica || {}).texto || '') + '</p>') +
      U.boton({ texto: 'Proponer saldo inicial', icono: 'nueva', sm: true, clase: 'js-fo-nueva-ap', datos: { cap: 'FONDOS' } }) + '</section>' +
      '<section class="fin2-p-sec"><h3>Gestiones</h3>' + (gest.length ? gest.map(function (g) {
        return '<details class="fin2-gest"' + (g.estado === 'ABIERTA' ? ' open' : '') + '><summary><b>' + txt(g.obligacion) + (g.periodo_obligacion ? ' · ' + txt(g.periodo_obligacion) : '') + '</b> ' + U.badge(g.estado === 'ABIERTA' ? 'Abierta' : 'Cerrada', g.estado === 'ABIERTA' ? 'info' : 'neutro') + '<span class="fin2-num ' + (g.saldo < 0 ? 'fin2-neg' : '') + '">' + plata(g.saldo) + '</span></summary>' +
          '<div class="fin2-gest__cuerpo">' + desglose(g) +
          (g.solicitado ? '<p class="fin2-ayuda">Pedido: ' + plata(g.solicitado) + ' · falta ejecutar ' + plata(g.pendiente_ejecutar) + ' (aparte del disponible).</p>' : '') +
          (g.destinos && g.destinos.length ? '<p class="fin2-ayuda">Destinos: ' + g.destinos.map(function (d) { return txt(d.nombre) + (d.monto !== null ? ' ' + plata(d.monto) : '') + ' (pagado ' + plata(d.pagado) + ')'; }).join(' · ') + '</p>' : '') +
          (g.remanente ? '<div class="fin2-p-caja fin2-p-caja--info">' + U.ico('info', 14) + '<span>Remanente: ' + txt(f.decisiones[g.remanente.decision]) + ' · ' + plata(g.remanente.monto_al_decidir) + ' · ' + txt(g.remanente.por) + (g.remanente.respaldo ? ' · respaldo: ' + txt(g.remanente.respaldo) : '') + ' ' +
            (g.remanente_estado === 'EJECUTADA' ? U.badge('Ejecutada', 'ok') : U.badge('Decidida: falta registrarla', 'alerta')) +
            (g.remanente_estado !== 'EJECUTADA' ? '<br><small>' + (g.remanente.decision === 'HONORARIO' ? 'Convertir crea la salida de los fondos del cliente y el cobro propio, sin pasar por el banco.' : g.remanente.decision === 'DEVOLVER' ? 'Registra la devolución en el Registro (Formulario guiado › Devolver fondos al cliente) con esta gestión.' : g.remanente.decision === 'REASIGNAR' ? 'Usa «Reasignar saldo» a otra gestión del mismo cliente.' : '') + '</small>' : '') + '</span>' +
            (g.remanente.decision === 'HONORARIO' && g.remanente_estado !== 'EJECUTADA' && g.saldo > 0 ? U.boton({ texto: 'Convertir en honorario', sm: true, variante: 'primario', clase: 'js-fo-convertir', datos: { id: g.id, v: g.version, saldo: g.saldo, cap: 'FONDOS' } }) : '') + '</div>' : '') +
          piezas(g.piezas, true) +
          '<div class="fin2-acciones-min" data-cap="FONDOS">' + U.boton({ texto: 'Editar', icono: 'editar', sm: true, clase: 'js-fo-editar', datos: { id: g.id } }) +
            (g.saldo ? U.boton({ texto: 'Decidir remanente', sm: true, clase: 'js-fo-rem', datos: { id: g.id, v: g.version } }) : '') +
            U.boton({ texto: g.estado === 'ABIERTA' ? 'Cerrar' : 'Reabrir', sm: true, clase: 'js-fo-estado', datos: { id: g.id, v: g.version, estado: g.estado === 'ABIERTA' ? 'CERRADA' : 'ABIERTA' } }) +
            (!g.piezas.length ? U.boton({ texto: 'Anular', sm: true, variante: 'fantasma', clase: 'js-fo-estado', datos: { id: g.id, v: g.version, estado: 'ANULADA' } }) : '') + '</div></div></details>';
      }).join('') : '<p class="fin2-ayuda">Sin gestiones. Una gestión agrupa lo recibido y pagado para UNA obligación y período (p. ej. imposiciones de julio).</p>') + '</section>' +
      (ff === 'todas' || ff === 'sin_asignacion' ? '<section class="fin2-p-sec"><h3>Sin gestión asignada</h3><p class="fin2-ayuda">Este dinero cuenta en el saldo del cliente aunque no tenga gestión; asignarla no la cuenta dos veces.</p>' + desglose(f.sin_gestion) + piezas(f.sin_gestion.piezas, true, true) + '</section>' : '') +
      (f.reasignaciones.length ? '<section class="fin2-p-sec"><h3>Reasignaciones</h3><ul class="fin2-lista-saldos">' + f.reasignaciones.map(function (r) {
        var nom = function (id) { if (id === 'SIN_GESTION') return 'Sin gestión'; var g = gest.filter(function (y) { return y.id === id; })[0]; return g ? g.obligacion + ' ' + (g.periodo_obligacion || '') : '?'; };
        return '<li><span>' + txt(r.fecha) + ' · ' + txt(nom(r.desde_gestion)) + ' → ' + txt(nom(r.hacia_gestion)) + '<small>' + txt(r.motivo) + ' · ' + txt(r.creado_por) + '</small></span><b class="fin2-num">' + plata(r.monto) + '</b>' + U.boton({ texto: 'Deshacer', sm: true, variante: 'fantasma', clase: 'js-fo-desreas', datos: { id: r.id, cap: 'FONDOS' } }) + '</li>';
      }).join('') + '</ul></section>' : '') +
    '</div>';
    var pie = '<span class="fin2-ayuda js-fo-selinfo">Marca movimientos para asignarlos a una gestión.</span><span style="flex:1"></span>' +
      U.boton({ texto: 'Reasignar saldo', icono: 'derivar', sm: true, clase: 'js-fo-reas', datos: { cap: 'FONDOS' }, deshabilitado: !gest.length }) +
      U.boton({ texto: 'Asignar a gestión', icono: 'check', variante: 'primario', sm: true, clase: 'js-fo-asignar', datos: { cap: 'FONDOS' } });
    var d = U.drawer({ titulo: f.cliente, subtitulo: '<span class="fin2-ayuda">' + txt(f.rut) + ' · fondos del cliente</span>', cuerpo: cuerpo, pie: pie });
    d.el.classList.add('fin2-panel', 'sx2-drawer--ancho');
    est_.panel = d;
    x_.aplicarCapacidades(d.el);
    d.el.addEventListener('change', function (ev) { if (ev.target.classList.contains('js-fo-pieza')) { est_.sel[ev.target.value] = ev.target.checked; var n = Object.keys(est_.sel).filter(function (k) { return est_.sel[k]; }).length; d.el.querySelector('.js-fo-selinfo').textContent = n ? n + ' movimiento(s) marcados.' : 'Marca movimientos para asignarlos a una gestión.'; } });
    d.el.addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      var reabrir = function () { ficha(f.cliente_id); recargarLista(); };
      if (b.classList.contains('js-fo-ap')) {
        if (b.dataset.accion === 'APROBAR') U.confirmar({ titulo: 'Aprobar saldo inicial', texto: 'Desde ahora cuenta en el saldo del cliente y en la custodia. Revisa la fuente antes de aprobar.', boton: 'Aprobar' }).then(function (si) { if (si) x_.api('finanzasDecidirApertura', { id: b.dataset.id, expected_version: Number(b.dataset.v), accion: 'APROBAR' }).then(resultado(reabrir, 'Saldo inicial aprobado.')); });
        else U.formulario({ titulo: 'Anular saldo inicial', boton: 'Anular', campos: U.campo('Motivo', '<input name="motivo" class="sx2-input" required>'), enviar: function (v) { return x_.api('finanzasDecidirApertura', { id: b.dataset.id, expected_version: Number(b.dataset.v), accion: 'ANULAR', motivo: v.motivo }); }, aviso: 'Anulado.', listo: reabrir });
      } else if (b.classList.contains('js-fo-nueva-ap')) formApertura(f, reabrir);
      else if (b.classList.contains('js-fo-editar')) formGestion(f.gestiones.filter(function (g) { return g.id === b.dataset.id; })[0], f.cliente_id, reabrir);
      else if (b.classList.contains('js-fo-rem')) formRemanente(f, b.dataset.id, Number(b.dataset.v), reabrir);
      else if (b.classList.contains('js-fo-estado')) {
        var anular = b.dataset.estado === 'ANULADA';
        U.formulario({ titulo: anular ? 'Anular gestión' : b.dataset.estado === 'CERRADA' ? 'Cerrar gestión' : 'Reabrir gestión', boton: 'Listo', campos: U.campo('Motivo' + (anular ? '' : ' (opcional)'), '<input name="motivo" class="sx2-input"' + (anular ? ' required' : '') + '>'),
          enviar: function (v) { return x_.api('finanzasEstadoGestion', { id: b.dataset.id, expected_version: Number(b.dataset.v), estado: b.dataset.estado, motivo: v.motivo }); }, aviso: 'Gestión actualizada.', listo: reabrir });
      } else if (b.classList.contains('js-fo-asignar')) {
        var refs = Object.keys(est_.sel).filter(function (k) { return est_.sel[k]; });
        if (!refs.length) { x_.aviso('Marca primero los movimientos.', 'alerta'); return; }
        U.formulario({ titulo: 'Asignar ' + refs.length + ' movimiento(s)', boton: 'Asignar',
          campos: U.campo('Gestión', '<select name="gestion_id" class="sx2-input">' + opciones(f.gestiones.filter(function (g) { return g.estado !== 'ANULADA'; }).map(function (g) { return [g.id, g.obligacion + ' ' + (g.periodo_obligacion || '') + ' · ' + plata(g.saldo)]; }), '', 'Quitar de su gestión') + '</select>', 'No cambia montos ni la naturaleza: solo dice a qué obligación corresponde ese dinero.') +
            U.campo('Destino (opcional)', '<input name="destino" class="sx2-input" placeholder="Obra, trabajador…">'),
          enviar: function (v) { var dd = { refs: refs, gestion_id: v.gestion_id }; if (v.destino) dd.destino = v.destino; return x_.api('finanzasAsignarGestion', dd).then(function (r) { if (r && r.ok && r.data.errores.length) x_.aviso(r.data.errores.length + ' no se asignaron: ' + r.data.errores[0].mensaje, 'alerta'); return r; }); },
          aviso: function (r) { return r.data.hechos + ' asignado(s).'; }, listo: reabrir });
      } else if (b.classList.contains('js-fo-reas')) formReasignar(f, reabrir);
      else if (b.classList.contains('js-fo-ffiltro')) { est_.ffiltro = b.dataset.id; d.cerrar(true); pintarFicha(); }
      else if (b.classList.contains('js-fo-sug')) x_.api('finanzasAsignarGestion', { refs: [b.dataset.ref], gestion_id: b.dataset.g }).then(resultado(reabrir, 'Asignado a la gestión.'));
      else if (b.classList.contains('js-fo-desde')) x_.api('finanzasGestionDesdePieza', { ref: b.dataset.ref, cliente_id: f.cliente_id, idempotency_key: uuid() }).then(resultado(reabrir, 'Gestión creada con los datos del movimiento.'));
      else if (b.classList.contains('js-fo-corregir')) {
        U.formulario({ titulo: 'Corregir saldo inicial', boton: 'Proponer corrección', campos: '<p class="fin2-ayuda">No se sobrescribe: se propone una versión nueva. La actual sigue vigente hasta que se apruebe la nueva.</p>' +
          U.campo('Saldo correcto', '<input name="monto" class="sx2-input" required>') + U.campo('Fecha de corte (si cambia)', '<input type="date" name="fecha_corte" class="sx2-input">') +
          U.campo('Fuente', '<input name="fuente" class="sx2-input" placeholder="Si cambia la fuente">') + U.campo('Motivo', '<input name="motivo" class="sx2-input" required>'),
          enviar: function (v) { return x_.api('finanzasCorregirApertura', Object.assign(v, { id: b.dataset.id, expected_version: Number(b.dataset.v) })); }, aviso: 'Corrección propuesta: falta aprobarla.', listo: reabrir });
      } else if (b.classList.contains('js-fo-convertir')) {
        U.formulario({ titulo: 'Convertir el remanente en honorario', boton: 'Convertir', campos: '<p class="fin2-ayuda">Se registran dos operaciones de compensación (no pasan por el banco): sale ' + plata(Number(b.dataset.saldo)) + ' de los fondos del cliente y entra como cobro propio, que después se aplica a su factura en Cobranza.</p>' +
          U.campo('Monto', '<input name="monto" class="sx2-input" value="' + Number(b.dataset.saldo).toLocaleString('es-CL') + '">') + U.campo('Fecha', '<input type="date" name="fecha" class="sx2-input" required>') +
          U.campo('Concepto del cobro', '<select name="cuenta" class="sx2-input">' + opciones(['Servicio Mensual', 'Servicio Renta', 'Otros Ingresos'].map(function (c) { return [c, c]; }), 'Servicio Mensual') + '</select>'),
          enviar: function (v) { return x_.api('finanzasConvertirRemanente', Object.assign(v, { gestion_id: b.dataset.id, expected_version: Number(b.dataset.v), idempotency_key: uuid() })); }, aviso: 'Remanente convertido: el cobro ya está en Cobranza.', listo: reabrir });
      }
      else if (b.classList.contains('js-fo-desreas')) U.formulario({ titulo: 'Deshacer reasignación', boton: 'Deshacer', campos: U.campo('Motivo', '<input name="motivo" class="sx2-input" required>'), enviar: function (v) { return x_.api('finanzasAnularReasignacion', { id: b.dataset.id, motivo: v.motivo }); }, aviso: 'Reasignación deshecha.', listo: reabrir });
    });
  }
  function resultado(listo, msg) { return function (r) { if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo.', 'error'); return; } x_.aviso(msg, 'exito'); listo(); }; }
  function recargarLista() { x_.api('finanzasFondos', { empresa: x_.contexto().empresa || '' }).then(function (r) { if (r && r.ok && document.querySelector('.js-fo-busca')) { est_.d = r.data; pintar(); } }); }

  function formGestion(g, clienteId, listo) {
    g = g || {};
    var cli = clienteId || g.cliente_id;
    U.formulario({ titulo: g.id ? 'Editar gestión' : 'Nueva gestión', boton: 'Guardar', ancho: true,
      campos: '<div class="fin2-form-grid">' +
        (cli ? '<input type="hidden" name="cliente_id" value="' + txt(cli) + '">' : U.campo('Cliente', '<select name="cliente_id" class="sx2-input" required>' + opciones(((cat_ && cat_.clientes) || []).map(function (c) { return [c.id, c.nombre + ' · ' + c.rut]; }), '', 'Elige…') + '</select>')) +
        U.campo('Empresa que administra', '<select name="empresa" class="sx2-input" required>' + opciones(empresas(), g.empresa || x_.contexto().empresa || '', 'Elige…') + '</select>') +
        U.campo('Obligación', '<select name="obligacion" class="sx2-input" required>' + opciones(obligaciones().map(function (o) { return [o, o]; }), g.obligacion, 'Elige…') + '</select>') +
        U.campo('Período de la obligación', '<input type="month" name="periodo_obligacion" class="sx2-input" value="' + txt(g.periodo_obligacion || '') + '">') +
        U.campo('Monto pedido (opcional)', '<input name="solicitado" class="sx2-input" inputmode="numeric" value="' + txt(g.solicitado || '') + '">', 'Lo que falta ejecutar se muestra aparte del saldo disponible.') +
        U.campo('Responsable', '<input name="responsable" class="sx2-input" value="' + txt(g.responsable || '') + '">') +
        U.campo('Destinos (uno por línea: nombre; monto opcional)', '<textarea name="destinos" class="sx2-input" rows="3" placeholder="Obra Los Andes; 1500000">' + txt((g.destinos || []).map(function (d) { return d.nombre + (d.monto !== null && d.monto !== undefined ? '; ' + d.monto : ''); }).join('\n')) + '</textarea>') +
        U.campo('Nota', '<input name="nota" class="sx2-input" value="' + txt(g.nota || '') + '">') + '</div>',
      preparar: function (v) {
        v.destinos = String(v.destinos || '').split('\n').map(function (l) { var p = l.split(';'); return { nombre: (p[0] || '').trim(), monto: (p[1] || '').trim() }; }).filter(function (d) { return d.nombre; });
        if (g.id) { v.id = g.id; v.expected_version = g.version; } else v.idempotency_key = uuid();
        return v;
      },
      enviar: function (v) { return x_.api('finanzasGuardarGestion', v); }, aviso: 'Gestión guardada.', listo: function (r) { if (listo) listo(r); } });
  }
  function formApertura(f, listo) {
    U.formulario({ titulo: 'Proponer saldo inicial', subtitulo: '<span class="fin2-ayuda">' + txt(f.cliente) + '</span>', boton: 'Proponer', ancho: true,
      campos: '<div class="fin2-form-grid">' + U.campo('Empresa', '<select name="empresa" class="sx2-input" required>' + opciones(empresas(), '', 'Elige…') + '</select>') +
        U.campo('Fecha de corte', '<input type="date" name="fecha_corte" class="sx2-input" required>', 'El día antes de la primera cartola cargada.') +
        U.campo('Saldo a esa fecha', '<input name="monto" class="sx2-input" required placeholder="Negativo si el cliente debía">') +
        U.campo('Gestión (opcional)', '<select name="gestion_id" class="sx2-input">' + opciones(f.gestiones.map(function (g) { return [g.id, g.obligacion + ' ' + (g.periodo_obligacion || '')]; }), '', 'Sin gestión') + '</select>') +
        U.campo('Fuente', '<input name="fuente" class="sx2-input" required placeholder="Cartola de junio, planilla SIGECO, confirmación del cliente…">') +
        U.campo('Nota', '<input name="nota" class="sx2-input">') + '</div><p class="fin2-ayuda">Queda PROPUESTO: no cuenta hasta que otra persona con permiso de aprobar saldos iniciales lo apruebe.</p>',
      preparar: function (v) { return Object.assign(v, { cliente_id: f.cliente_id, idempotency_key: uuid() }); },
      enviar: function (v) { return x_.api('finanzasGuardarApertura', v); }, aviso: 'Saldo inicial propuesto.', listo: listo });
  }
  function formRemanente(f, gid, v, listo) {
    U.formulario({ titulo: 'Qué se hace con el remanente', boton: 'Guardar decisión',
      campos: U.campo('Decisión', '<select name="decision" class="sx2-input" required>' + opciones(Object.keys(f.decisiones).map(function (k) { return [k, f.decisiones[k]]; }), '', 'Elige…') + '</select>', 'No mueve dinero: la devolución o el cobro se registran aparte.') +
        U.campo('Respaldo (obligatorio para cobrarlo como honorario)', '<input name="respaldo" class="sx2-input" placeholder="Correo del cliente del 12-08, factura 1234…">') + U.campo('Nota', '<input name="nota" class="sx2-input">'),
      preparar: function (d) { return Object.assign(d, { gestion_id: gid, expected_version: v }); },
      enviar: function (d) { return x_.api('finanzasDecidirRemanente', d); }, aviso: 'Decisión guardada.', listo: listo });
  }
  function formReasignar(f, listo) {
    var ops = [['SIN_GESTION', 'Sin gestión · ' + plata(f.sin_gestion.saldo)]].concat(f.gestiones.filter(function (g) { return g.estado !== 'ANULADA'; }).map(function (g) { return [g.id, g.obligacion + ' ' + (g.periodo_obligacion || '') + ' · ' + plata(g.saldo)]; }));
    U.formulario({ titulo: 'Reasignar saldo', subtitulo: '<span class="fin2-ayuda">Entre gestiones del mismo cliente. No crea dinero.</span>', boton: 'Reasignar',
      campos: U.campo('Desde', '<select name="desde" class="sx2-input" required>' + opciones(ops, '') + '</select>') + U.campo('Hacia', '<select name="hacia" class="sx2-input" required>' + opciones(ops, ops[1] ? ops[1][0] : '') + '</select>') +
        U.campo('Monto', '<input name="monto" class="sx2-input" required inputmode="numeric">') + U.campo('Motivo', '<input name="motivo" class="sx2-input" required>'),
      preparar: function (d) { return Object.assign(d, { idempotency_key: uuid() }); },
      enviar: function (d) { return x_.api('finanzasReasignar', d); }, aviso: 'Saldo reasignado.', listo: listo });
  }

  /** Saldos iniciales en lote (I06.3): pegar o subir la tabla, revisar, proponer las filas aceptadas. */
  function cargaLote() {
    var est = { filas: [], rev: null };
    var d = U.drawer({ titulo: 'Cargar saldos iniciales', subtitulo: '<span class="fin2-ayuda">Una fila por cliente: cliente (RUT o nombre), empresa, gestión (opcional), fecha de corte, monto, moneda y fuente. Quedan PROPUESTOS.</span>',
      cuerpo: '<div class="fin2-p"><textarea class="fin2-input fin2-pegar js-fl-txt" rows="6" placeholder="Pega aquí desde Excel, con la fila de títulos…"></textarea>' +
        '<label class="sx2-boton sx2-boton--secundario" style="cursor:pointer;margin-top:8px"><input type="file" accept=".xlsx" class="js-fl-xlsx" hidden>' + U.ico('documento', 16) + 'O sube un Excel</label><div class="js-fl-rev"></div></div>',
      pie: '<span style="flex:1"></span>' + U.boton({ texto: 'Revisar', icono: 'lupa', clase: 'js-fl-revisar' }) + U.boton({ texto: 'Proponer las aceptadas', icono: 'check', variante: 'primario', clase: 'js-fl-proponer', deshabilitado: true }) });
    d.el.classList.add('fin2-panel', 'sx2-drawer--ancho');
    var revisar = function () {
      if (est.filas.length < 2) { x_.aviso('Incluye la fila de títulos y al menos una apertura.', 'error'); return; }
      x_.api('finanzasRevisarAperturas', { filas: est.filas }).then(function (r) {
        var z = d.el.querySelector('.js-fl-rev');
        if (!r || !r.ok) { z.innerHTML = '<p class="fin2-error">' + txt((r && r.message) || 'No se pudo revisar.') + '</p>'; return; }
        est.rev = r.data;
        z.innerHTML = '<div class="fin2-cinta fin2-cinta--info">' + U.ico('info', 16) + '<span><b>' + r.data.aceptadas + ' aceptada(s), ' + r.data.incidentes + ' con incidentes.</b> Totales por empresa: ' + (Object.keys(r.data.totales_por_empresa).map(function (k) { return txt(k) + ' ' + plata(r.data.totales_por_empresa[k]); }).join(' · ') || '—') + '</span></div>' +
          '<div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>Fila</th><th>Cliente</th><th>Empresa</th><th>Corte</th><th class="fin2-der">Monto</th><th>Resultado</th></tr></thead><tbody>' + r.data.revision.map(function (x) {
            return '<tr class="' + (x.ok ? '' : 'fin2-peg-mala') + '"><td>' + x.fila + '</td><td>' + txt(x.cliente) + '</td><td>' + txt(x.empresa) + '</td><td>' + txt(x.fecha_corte) + '</td><td class="fin2-der fin2-num">' + plata(x.monto) + '</td><td>' +
              (x.ok ? U.badge('Aceptada', 'ok') + (x.avisos.length ? ' <small class="fin2-ayuda">' + txt(x.avisos.join(' ')) + '</small>' : '') : '<span class="fin2-neg">' + txt(x.errores.join(' · ')) + '</span>') + '</td></tr>';
          }).join('') + '</tbody></table></div>';
        var bp = d.el.querySelector('.js-fl-proponer'); bp.disabled = !r.data.aceptadas; bp.lastChild.textContent = 'Proponer ' + r.data.aceptadas + ' aceptada(s)';
      });
    };
    d.el.addEventListener('input', function (ev) { if (ev.target.classList.contains('js-fl-txt')) { est.filas = String(ev.target.value).replace(/\r/g, '').split('\n').filter(function (l) { return l.trim(); }).map(function (l) { return l.split('\t'); }); est.rev = null; d.el.querySelector('.js-fl-proponer').disabled = true; } });
    d.el.addEventListener('change', function (ev) {
      if (!ev.target.classList.contains('js-fl-xlsx') || !ev.target.files[0]) return;
      SigsoLectorXlsx.leer(ev.target.files[0]).then(function (hojas) { est.filas = (hojas[0] || {}).filas || []; revisar(); }).catch(function () { x_.aviso('El archivo no es un Excel válido.', 'error'); });
    });
    d.el.addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      if (b.classList.contains('js-fl-revisar')) revisar();
      else if (b.classList.contains('js-fl-proponer') && est.rev) {
        b.disabled = true;
        x_.api('finanzasProponerAperturas', { filas: est.filas, token: est.rev.token, idempotency_key: uuid() }).then(function (r) {
          if (!r || !r.ok) { b.disabled = false; x_.aviso((r && r.message) || 'No se pudo.', 'error'); if (r && r.codigo === 'CONFLICTO_VERSION') revisar(); return; }
          x_.aviso(r.data.propuestas + ' saldo(s) inicial(es) propuesto(s)' + (r.data.incidentes ? ' · ' + r.data.incidentes + ' fila(s) quedaron fuera' : '') + '. Falta aprobarlos.', 'exito');
          d.cerrar(); recargarLista();
        });
      }
    });
  }
  /** Propuestas por aprobar (I06.3/I06.4): se aprueban las marcadas; el servidor aplica la política activa a cada una. */
  function porAprobar() {
    var l = est_.d.aperturas_pendientes || [];
    var pol = est_.d.politica || {};
    U.formulario({ titulo: 'Saldos iniciales por aprobar', boton: 'Aprobar las marcadas', ancho: true,
      campos: '<p class="fin2-ayuda">' + txt(pol.texto || '') + '</p><ul class="fin2-lista-saldos">' + l.map(function (a) {
        return '<li><label class="fin2-check"><input type="checkbox" name="ap_' + txt(a.id) + '" value="' + a.version + '"' + (pol.dos_personas && a.creado_por === (x_.yo ? x_.yo() : '') ? ' disabled' : ' checked') + '> <b>' + txt(a.cliente) + '</b> · ' + txt(a.empresa) + ' · al ' + txt(a.fecha_corte) + (a.reemplaza ? ' · corrige otra' : '') + '</label><small>Fuente: ' + txt(a.fuente) + ' · propuso ' + txt(a.creado_por) + '</small><b class="fin2-num">' + plata(a.monto) + '</b></li>';
      }).join('') + '</ul>',
      enviar: function (v) {
        var ids = Object.keys(v).filter(function (k) { return /^ap_/.test(k) && v[k]; });
        var ok = 0, malos = [];
        return ids.reduce(function (pr, k) { return pr.then(function () { return x_.api('finanzasDecidirApertura', { id: k.slice(3), expected_version: Number(v[k]), accion: 'APROBAR' }).then(function (r) { if (r && r.ok) ok++; else malos.push((r && r.message) || '?'); }); }); }, Promise.resolve())
          .then(function () { return { ok: true, data: { ok: ok, malos: malos } }; });
      },
      aviso: function (r) { return r.data.ok + ' aprobado(s)' + (r.data.malos.length ? ' · ' + r.data.malos.length + ' no: ' + r.data.malos[0] : ''); }, listo: function () { recargarLista(); } });
  }

  var enlazado_ = false;
  function enlazar() {
    var raiz = x_.raiz();
    if (enlazado_ || !raiz) return;
    enlazado_ = true;
    raiz.addEventListener('input', function (ev) {
      if (!ev.target.classList.contains('js-fo-busca')) return;
      clearTimeout(est_.bt); var v = ev.target.value;
      est_.bt = setTimeout(function () { est_.busca = v; pintar(); var b = document.querySelector('.js-fo-busca'); if (b) { b.focus(); b.setSelectionRange(v.length, v.length); } }, 200);
    });
    raiz.addEventListener('click', function (ev) {
      var tr = ev.target.closest('.js-fo-cli');
      if (tr) { ficha(tr.dataset.id); return; }
      var b = ev.target.closest('button'); if (!b) return;
      if (b.classList.contains('js-fo-filtro')) { est_.filtro = b.dataset.id; pintar(); }
      else if (b.classList.contains('js-fo-nueva')) formGestion(null, '', function () { recargarLista(); });
      else if (b.classList.contains('js-fo-lote')) cargaLote();
      else if (b.classList.contains('js-fo-por-aprobar')) porAprobar();
    });
    raiz.addEventListener('keydown', function (ev) { var tr = ev.target.closest && ev.target.closest('.js-fo-cli'); if (tr && ev.key === 'Enter') ficha(tr.dataset.id); });
  }

  window.SigsoFinanzasFondos = { ver: ver, ficha: ficha };
})();
