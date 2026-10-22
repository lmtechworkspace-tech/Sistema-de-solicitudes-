/**
 * finanzas-registro-v2.js — Registro diario de Finanzas (2026-10-20; FIN-09
 * a FIN-12, FIN-16, FIN-33; backend/logica/finanzasOperaciones.js).
 *
 * La pantalla de las operadoras: cada gestión de dinero se anota UNA vez,
 * cuando se conoce (de qué cliente, qué obligación, qué período, qué
 * destino), y el banco después solo la confirma (Conciliación).
 *
 *  - Contexto arriba (empresa, cuenta, mes): no se vuelve a pedir en cada fila.
 *  - Tabla tipo planilla: las filas en borrador se editan en su lugar (Tab,
 *    Enter guarda y baja, Esc deshace, Ctrl+D duplica); al salir de la fila
 *    se guarda como borrador (en el servidor, cifrado). Lo que falta se marca.
 *  - Formulario guiado por acción (cobrar honorarios, recibir fondos, pagar
 *    una obligación, devolver, gasto propio, traspaso, préstamo), con la
 *    ayuda de cada caso y solo los campos que esa acción necesita.
 *  - Panel de detalle: todos los datos, varias partes que suman exacto,
 *    avisos antes de confirmar («Confirmar igual»), historial y vínculo con
 *    el banco.
 *  - Pegar desde Excel con revisión por celda, totales, repetidos y token;
 *    plantillas recurrentes que crean borradores; acciones por lote.
 *  - Corrección v2 I05: obligaciones de Control interno (IVA, imposiciones) como
 *    fuente del pago (sin volver a escribir cliente, concepto, período, destino);
 *    «Registro» y «Banco» en columnas separadas; duplicar en el servidor; vista
 *    previa de plantillas; campos según la acción sin borrar lo oculto;
 *    «Dividir importe»; orden sobre el conjunto completo.
 */
(function () {
  'use strict';

  var U = UIv2;
  var x_ = null, cat_ = null;
  // I12.4: filas con cambios que no alcanzaron a guardarse (al cerrar la bóveda o por un conflicto de versión).
  // Viven solo en la memoria de esta página (nunca en el navegador) y se ofrecen al volver: nada se pierde en silencio.
  var rescate_ = [];
  document.addEventListener('sigso-fin-cerrada', function () {
    try { document.querySelectorAll('.fin2-reg__fila--edit[data-sucio]').forEach(function (el) { var l = leerFilaEditada(el); if (!l.error && (l.datos.monto || l.datos.tercero)) rescate_.push({ datos: l.datos, motivo: 'cierre' }); }); } catch (e) { /* sin filas */ }
    if (est_) { est_.datos = null; est_.sel = {}; }
  });
  function rescateHtml() {
    if (!rescate_.length) return '';
    return '<div class="fin2-cinta fin2-cinta--alerta sx2-entra" role="status">' + U.ico('alerta', 16) + '<span><b>' + rescate_.length + ' cambio(s) sin guardar.</b> ' +
      rescate_.map(function (r) { return txt((r.datos.fecha || '') + ' · ' + (r.datos.tercero || 'sin tercero') + ' · ' + plata(r.datos.monto || 0) + (r.motivo === 'conflicto' ? ' (otra persona cambió esa fila)' : ' (quedó al cerrar la bóveda)')); }).join(' · ') + '</span>' +
      U.boton({ texto: 'Guardarlos ahora', sm: true, variante: 'primario', clase: 'js-finr-rescate-si', datos: { cap: 'REGISTRAR' }, titulo: 'En una fila que otra persona cambió, se aplica tu cambio sobre su última versión' }) +
      U.boton({ texto: 'Descartar', sm: true, variante: 'fantasma', clase: 'js-finr-rescate-no' }) + '</div>';
  }
  function guardarRescate() {
    var lista = rescate_.slice(); rescate_ = [];
    return lista.reduce(function (p, r) {
      return p.then(function () {
        var d = Object.assign({}, r.datos);
        // Decisión explícita: en un conflicto, el cambio se aplica sobre la versión que hay ahora.
        if (r.motivo === 'conflicto' && d.id) { var o = opDe(d.id); if (o) d.expected_version = o.version; }
        return x_.api('finanzasGuardarOperacion', d).then(function (res) { if (!res || !res.ok) rescate_.push(r); });
      });
    }, Promise.resolve()).then(function () {
      x_.aviso(rescate_.length ? 'Quedaron ' + rescate_.length + ' sin guardar: revisa el aviso.' : 'Cambios guardados.', rescate_.length ? 'alerta' : 'exito');
      return recargar(true);
    });
  }
  var est_ = { datos: null, sel: {}, filtro: 'todas', busca: '', abierta: '', nuevas: {}, guardando: {}, scroll: 0 };
  var TIPOS_UI = [
    ['INGRESO', 'Ingreso de la empresa'], ['FONDO_RECIBIDO', 'Fondo del cliente recibido'], ['FONDO_RECIBIDO:REINTEGRO', 'Reintegro a fondos del cliente'],
    ['EGRESO', 'Gasto de la empresa'], ['FONDO_PAGADO', 'Pago por cuenta del cliente'], ['FONDO_PAGADO:DEVOLUCION', 'Devolución al cliente'],
    ['TRASPASO', 'Traspaso entre cuentas propias'], ['PRESTAMO', 'Préstamo entre empresas']
  ];
  var SENTIDO_TIPO = { INGRESO: 'ENTRADA', FONDO_RECIBIDO: 'ENTRADA', EGRESO: 'SALIDA', FONDO_PAGADO: 'SALIDA' };
  var FILTROS = [['todas', 'Todas'], ['borradores', 'Borradores'], ['incompletas', 'Datos por completar'], ['sin_banco', 'Falta el banco'], ['confirmadas', 'Confirmadas'], ['anuladas', 'Anuladas']];

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function plata(n) { var v = Math.round(Number(n) || 0); return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('es-CL'); }
  function miles(n) { return n ? Math.round(Number(n)).toLocaleString('es-CL') : ''; }
  function montoDe(v) { var s = String(v || '').replace(/[^0-9]/g, ''); return s ? Number(s) : 0; }
  function corta(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '-' + p[1] : ''; }
  function hoyIso() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
  function uuid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); }
  function tipoNombre(t, sub) { var k = t + (sub && sub !== 'RECEPCION' && sub !== 'PAGO_OBLIGACION' ? ':' + sub : ''); var x = TIPOS_UI.filter(function (y) { return y[0] === k; })[0] || TIPOS_UI.filter(function (y) { return y[0] === t; })[0]; return x ? x[1] : (t || ''); }
  function cuentasDeTipo(t) { var x = (cat_ && cat_.tipos || []).filter(function (y) { return y.id === t; })[0]; return x ? x.cuentas : []; }
  function cliente(id) { return (cat_ && cat_.clientes || []).filter(function (c) { return c.id === id; })[0] || null; }
  /** Cliente desde lo escrito: «NOMBRE · RUT», RUT, nombre o alias exacto. */
  function clientePorTexto(t) {
    var s = String(t || '').trim();
    if (!s) return { id: '' };
    var base = s.split(' · ')[0].trim().toUpperCase();
    var rut = s.replace(/[^0-9kK]/g, '').toUpperCase();
    var lista = (cat_ && cat_.clientes) || [];
    var c = lista.filter(function (x) { return x.nombre.toUpperCase() === base; })[0] ||
      (rut.length >= 7 ? lista.filter(function (x) { return String(x.rut).replace(/[^0-9kK]/g, '').toUpperCase() === rut; })[0] : null) ||
      lista.filter(function (x) { return (x.alias || []).some(function (a) { return a.toUpperCase() === base; }); })[0];
    return c ? { id: c.id, nombre: c.nombre } : { id: '', error: 'Elige el cliente de la lista (nombre, RUT o alias).' };
  }
  function opciones(lista, actual, vacio) {
    return (vacio !== undefined ? '<option value="">' + txt(vacio) + '</option>' : '') + lista.map(function (o) {
      var id = typeof o === 'string' ? o : o[0] !== undefined ? o[0] : o.id, nom = typeof o === 'string' ? o : o[1] !== undefined ? o[1] : o.nombre;
      return '<option value="' + txt(id) + '"' + (String(id) === String(actual) ? ' selected' : '') + '>' + txt(nom) + '</option>';
    }).join('');
  }
  function datalistClientes() {
    return '<datalist id="finr-clientes">' + ((cat_ && cat_.clientes) || []).map(function (c) {
      return '<option value="' + txt(c.nombre + ' · ' + c.rut) + '">' + txt((c.alias || []).join(', ')) + '</option>';
    }).join('') + '</datalist>';
  }

  // =====================================================================================
  function ver(x) {
    x_ = x; enlazar();
    var t = x.turno();
    var c = x.contexto();
    est_.periodo = c.periodo || hoyIso().slice(0, 7);
    est_.empresa = c.empresa || '';
    est_.cuenta = c.cuenta_ref || '';
    est_.filtro = c.filtro_registro || 'todas';
    x.pagina(x.cab('registro') + U.esqueleto('tabla', 10));
    Promise.all([x.catalogo(), x.api('finanzasOperaciones', pedido()), x.api('finanzasResumenBancos')]).then(function (rs) {
      if (!x.vigente(t)) return;
      cat_ = rs[0];
      var r = rs[1];
      // Abrir el pago desde una obligación de Control interno (enlace desde la obligación).
      if (c.fuente_ci) { var fid = c.fuente_ci; x.contexto({ fuente_ci: '' }); setTimeout(function () { desdeFuenteId(fid); }, 0); }
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('registro') + U.card({ cuerpo: U.vacio({ accion: '<button type="button" class="sx2-boton sx2-boton--secundario sx2-boton--sm js-fin-reintentar">Reintentar</button>', icono: 'alerta', titulo: 'No se pudo cargar el registro', texto: (r && r.message) || '' }) })); return; }
      est_.datos = r.data; est_.cuentas = rs[2] && rs[2].ok ? rs[2].data.cuentas : [];
      if (!est_.empresa && cat_ && cat_.empresas.length) est_.empresa = '';
      pintar();
    });
  }
  var recargas_ = 0;
  function recargar(mantener) {
    var sc = window.scrollY, x = x_, t = x_.turno(), n = ++recargas_;
    return x_.api('finanzasOperaciones', pedido()).then(function (r) {
      // T32 (I13): solo pinta la última recarga y solo si la persona sigue en esta vista.
      if (n !== recargas_ || !x.vigente(t)) return r;
      if (r && r.ok) { est_.datos = r.data; if (!mantener) est_.sel = {}; pintar(); window.scrollTo(0, sc); }
      return r;
    });
  }
  function visibles() {
    var l = (est_.datos && est_.datos.operaciones) || [];
    var q = est_.busca.toLowerCase();
    return l.filter(function (o) {
      if (q && [o.tercero, o.referencia, o.nota, o.monto, (o.distribuciones || []).map(function (p) { return [p.cliente, p.cuenta, p.destino].join(' '); }).join(' ')].join(' ').toLowerCase().indexOf(q) === -1) return false;
      var f = est_.filtro;
      if (f === 'borradores') return o.estado === 'BORRADOR';
      if (f === 'incompletas') return !o.completa;
      if (f === 'sin_banco') return o.estado === 'CONFIRMADA' && (o.conciliacion === 'SIN_BANCO' || o.conciliacion === 'PARCIAL');
      if (f === 'confirmadas') return o.estado === 'CONFIRMADA';
      if (f === 'anuladas') return o.estado === 'ANULADA';
      return o.estado !== 'ANULADA';
    });
  }

  function barraContexto() {
    var cuentas = (est_.cuentas || []).filter(function (c) { return !est_.empresa || c.empresa === est_.empresa; });
    // I08.3: una cuenta de otra empresa no queda filtrando en silencio.
    if (est_.cuenta && est_.cuenta !== SIN_CUENTA && !cuentas.some(function (c) { return c.id === est_.cuenta; })) { est_.cuenta = ''; x_.contexto({ cuenta_ref: '' }); if (x_.aviso) x_.aviso('La cuenta elegida es de otra empresa: se muestran todas las cuentas de ' + (est_.empresa || 'todas las empresas') + '.', 'info'); }
    return '<div class="fin2-ctx sx2-entra" role="group" aria-label="Contexto del registro">' +
      '<label class="fin2-campo fin2-campo--fila"><span>Empresa</span><select class="fin2-input fin2-input--sm js-finr-empresa">' + opciones((cat_.empresas || []).map(function (e) { return [e, e]; }), est_.empresa, 'Todas') + '</select></label>' +
      '<label class="fin2-campo fin2-campo--fila"><span>Cuenta</span><select class="fin2-input fin2-input--sm js-finr-cuenta">' + opciones([[SIN_CUENTA, 'Sin cuenta asignada']].concat(cuentas.map(function (c) { return [c.id, c.banco + ' ···' + c.ultimos4 + ' · ' + c.empresa]; })), est_.cuenta, 'Todas las cuentas') + '</select></label>' +
      '<label class="fin2-campo fin2-campo--fila"><span>Mes</span><input type="month" class="fin2-input fin2-input--sm js-finr-mes" value="' + txt(est_.periodo) + '"></label>' +
      '<label class="fin2-busca">' + U.ico('lupa', 14) + '<input class="js-finr-busca" type="search" placeholder="Buscar tercero, cliente, monto…" value="' + txt(est_.busca) + '" aria-label="Buscar en el registro"></label>' +
    '</div>';
  }
  function pintar() {
    var d = est_.datos, T = d.totales;
    var l = visibles();
    var cuenta = {};
    FILTROS.forEach(function (f) { var a = est_.filtro; est_.filtro = f[0]; cuenta[f[0]] = visibles().length; est_.filtro = a; });
    var selIds = Object.keys(est_.sel).filter(function (k) { return est_.sel[k]; });
    var selE = 0, selS = 0;
    selIds.forEach(function (id) { var o = d.operaciones.filter(function (y) { return y.id === id; })[0]; if (o) { if (o.sentido === 'ENTRADA') selE += o.monto || 0; else selS += o.monto || 0; } });
    x_.pagina(x_.cab('registro',
      U.boton({ texto: 'Pegar desde Excel', icono: 'portapapeles', sm: true, clase: 'js-finr-pegar', datos: { cap: 'REGISTRAR' } }) +
      U.boton({ texto: 'Plantillas', icono: 'copiar', sm: true, clase: 'js-finr-plantillas', datos: { cap: 'REGISTRAR' } }) +
      U.boton({ texto: 'Formulario guiado', icono: 'nueva', variante: 'primario', sm: true, clase: 'js-finr-guiado', datos: { cap: 'REGISTRAR' } })) +
      rescateHtml() +
      barraContexto() +
      '<p class="fin2-ayuda fin2-alcance">Totales de ' + txt(est_.periodo) + ' · ' + txt(est_.empresa || 'todas las empresas') + (est_.cuenta === SIN_CUENTA ? ' · sin cuenta asignada' : est_.cuenta ? ' · una cuenta' : '') + ' (no cambian con los filtros ni la búsqueda).' + (d.total > d.operaciones.length ? ' Se muestran ' + d.operaciones.length + ' de ' + d.total + ': afina el mes o la búsqueda.' : '') + (est_.guardado ? ' <span class="fin2-guardado">' + U.ico('check', 12) + ' Guardado ' + txt(est_.guardado) + '</span>' : '') + '</p>' +
      '<div class="fin2-tiras">' +
        // QA-R12: lo confirmado y lo que está en borrador van separados (un borrador no es un hecho).
        tira('Entradas confirmadas', T.entradas, 'ok') + tira('Salidas confirmadas', T.salidas, 'critico') +
        '<div class="fin2-tira fin2-tira--doble sx2-tono-info"><span>En borrador (' + T.borradores + ')</span><b>' + (T.entradas_borrador ? '+' + plata(T.entradas_borrador) : '') + (T.entradas_borrador && T.salidas_borrador ? ' / ' : '') + (T.salidas_borrador ? '−' + plata(T.salidas_borrador) : '') + (!T.entradas_borrador && !T.salidas_borrador ? '—' : '') + '</b></div>' +
        (T.posibles_duplicados ? '<div class="fin2-tira sx2-tono-critico"><span>Posibles duplicados (' + T.posibles_duplicados + ')</span><b>' + plata(T.posibles_duplicados_monto) + '</b></div>' : '') +
        '<div class="fin2-tira sx2-tono-alerta"><span>Datos por completar</span><b>' + T.incompletas + '</b></div>' +
        '<div class="fin2-tira sx2-tono-neutro"><span>Confirmadas sin banco</span><b>' + T.sin_banco + '</b></div>' +
      '</div>' +
      // I08.4: filtros y «Nueva fila» en una sola línea; la barra de lote aparece solo al marcar filas.
      '<div class="fin2-fila-filtros"><div class="fin2-filtros" role="group" aria-label="Qué mostrar">' + FILTROS.map(function (f) {
        return U.chip({ texto: f[1], n: cuenta[f[0]], activo: est_.filtro === f[0], clase: 'js-finr-filtro', datos: { id: f[0] } });
      }).join('') + '</div>' + U.boton({ texto: 'Nueva fila', icono: 'nueva', sm: true, variante: 'secundario', clase: 'js-finr-nueva', titulo: 'Nueva fila (Alt+N)', datos: { cap: 'REGISTRAR' } }) + '</div>' +
      '<div class="fin2-lote" data-cap="REGISTRAR"' + (selIds.length ? '' : ' hidden') + '>' +
        '<span class="fin2-lote__sel">' + (selIds.length ? '<b>Selección: ' + selIds.length + '</b> · entra ' + plata(selE) + ' · sale ' + plata(selS) : 'Marca filas para actuar en lote') + '</span>' +
        U.boton({ texto: 'Confirmar', icono: 'check', sm: true, clase: 'js-finr-lote', datos: { accion: 'CONFIRMAR', cap: 'CONFIRMAR' }, deshabilitado: !selIds.length }) +
        U.boton({ texto: 'Cambiar…', icono: 'editar', sm: true, clase: 'js-finr-cambiar', deshabilitado: !selIds.length }) +
        U.boton({ texto: 'Duplicar', icono: 'copiar', sm: true, clase: 'js-finr-duplicar', deshabilitado: selIds.length !== 1 }) +
        U.boton({ texto: 'Descartar borradores', icono: 'basura', sm: true, variante: 'fantasma', clase: 'js-finr-lote', datos: { accion: 'DESCARTAR' }, deshabilitado: !selIds.length }) +
        U.boton({ texto: 'Anular', icono: 'equis', sm: true, variante: 'fantasma', clase: 'js-finr-anular', datos: { cap: 'CONFIRMAR' }, deshabilitado: !selIds.length }) +
      '</div>' +
      '<div class="fin2-reg sx2-entra' + (densidad() === 'compacta' ? ' fin2-reg--compacta' : '') + '" role="grid" aria-label="Registro del mes">' +
        '<div class="fin2-reg__cab" role="row"><span role="columnheader"><input type="checkbox" class="js-finr-todas" data-cap="REGISTRAR" aria-label="Marcar todas"></span>' + cabOrden('fecha', 'Fecha') + cabOrden('tercero', 'Quién paga / recibe') +
          '<span role="columnheader">Cliente</span><span role="columnheader">Naturaleza</span><span role="columnheader">Concepto</span>' + cabOrden('monto', 'Entrada', true) + '<span role="columnheader" class="fin2-der">Salida</span><span role="columnheader">Registro</span><span role="columnheader">Banco</span>' +
          '<span><button type="button" class="sx2-boton sx2-boton--fantasma sx2-boton--sm sx2-boton--icono js-finr-densidad" aria-pressed="' + (densidad() === 'compacta') + '" title="Filas compactas (más filas a la vista)" aria-label="Filas compactas">' + U.ico('tabla', 14) + '</button></span></div>' +
        (l.length ? l.map(fila).join('') : '<div class="fin2-reg__vacio">' + U.vacio({ icono: 'tabla', titulo: est_.filtro === 'todas' ? 'Sin operaciones en este mes' : 'Nada en este filtro', texto: 'Agrega una fila, usa el formulario guiado o pega desde Excel. Lo que ya está en el banco se clasifica en Bancos › Movimientos.' }) + '</div>') +
      '</div>' + datalistClientes() +
      '<p class="fin2-ayuda fin2-ayuda--teclas">Teclas: Tab avanza de celda · Enter guarda y baja · Esc deshace · Ctrl+D duplica · Alt+N fila nueva. Al salir de una fila en borrador se guarda sola.</p>');
    est_.guardando = {};
    var abierta = est_.foco && document.querySelector('.fin2-reg__fila[data-id="' + est_.foco.id + '"] [data-campo="' + est_.foco.campo + '"]');
    if (abierta) abierta.focus();
    est_.foco = null;
  }
  function cabOrden(campo, texto, der) {
    var act = est_.orden === campo;
    return '<span role="columnheader"' + (der ? ' class="fin2-der"' : '') + ' aria-sort="' + (act ? (est_.dir === 'desc' ? 'descending' : 'ascending') : 'none') + '"><button type="button" class="fin2-orden js-finr-orden" data-orden="' + campo + '">' + txt(texto) + (act ? (est_.dir === 'desc' ? ' ↓' : ' ↑') : '') + '</button></span>';
  }
  var SIN_CUENTA = '__SIN_CUENTA__';
  // I08.4: la densidad es una preferencia visual de cada persona (solo «comoda» o «compacta», nada financiero).
  var LLAVE_DENSIDAD = 'sigso_fin_densidad';
  function densidad() { try { return localStorage.getItem(LLAVE_DENSIDAD) === 'compacta' ? 'compacta' : 'comoda'; } catch (e) { return 'comoda'; } }
  function cambiarDensidad() { var d = densidad() === 'compacta' ? 'comoda' : 'compacta'; try { localStorage.setItem(LLAVE_DENSIDAD, d); } catch (e) { /* sin storage: queda la de siempre */ } return d; }
  /** La cuenta para una operación nueva: el filtro «Sin cuenta asignada» no es una cuenta. */
  function cuentaReal() { return est_.cuenta === SIN_CUENTA ? '' : est_.cuenta; }
  function pedido() { return { periodo: est_.periodo, empresa: est_.empresa, cuenta_ref: est_.cuenta, incluir_anuladas: est_.filtro === 'anuladas', por_pagina: 500, orden: est_.orden || 'fecha', dir: est_.dir || 'asc' }; }
  function tira(t, v, tono) { return '<div class="fin2-tira sx2-tono-' + tono + '"><span>' + txt(t) + '</span><b>' + plata(v) + '</b></div>'; }

  /** Estado del REGISTRO (borrador, datos por completar, confirmada, anulada). El medio y el banco van aparte. */
  function registroBadge(o) {
    if (o.estado === 'ANULADA') return U.badge('Anulada', 'neutro');
    if (o.estado === 'BORRADOR') return o.completa ? U.badge('Borrador listo', 'info') : '<span class="fin2-falta fin2-falta--corta" title="' + txt((o.faltantes || []).map(function (f) { return f.mensaje; }).join(' · ')) + '">' + U.ico('alerta', 12) + '<span>Por completar: ' + txt(((o.faltantes || [])[0] || {}).mensaje || '') + '</span></span>';
    return U.badge('Confirmada', 'ok');
  }
  /** Vínculo con el BANCO: solo tiene sentido para lo confirmado. «Efectivo» es un medio: no aplica banco. */
  function bancoBadge(o) {
    if (o.estado !== 'CONFIRMADA') return '<span class="fin2-ayuda">—</span>';
    if ((o.coincidencias_banco || []).length) return U.badge('Posible duplicado', 'critico');
    return o.conciliacion === 'CONCILIADA' ? U.badge('Con banco', 'ok') : o.conciliacion === 'PARCIAL' ? U.badge('En parte', 'alerta') : o.conciliacion === 'NO_APLICA' ? U.badge('No aplica · ' + (o.medio === 'COMPENSACION' ? 'compensación' : 'efectivo'), 'neutro') : U.badge('Falta el banco', 'alerta');
  }
  function estadoBadge(o) { return registroBadge(o) + (o.estado === 'CONFIRMADA' ? ' ' + bancoBadge(o) : ''); }
  /** Una fila: editable si es borrador con una sola parte; si no, texto (se abre el panel). */
  function fila(o) {
    var p = (o.distribuciones || [])[0] || {};
    var editable = o.estado === 'BORRADOR' && (o.distribuciones || []).length <= 1 && x_.puede('REGISTRAR');
    var varias = (o.distribuciones || []).length > 1;
    var cli = p.cliente_id ? (cliente(p.cliente_id) || { nombre: p.cliente, rut: '' }) : null;
    var tipoK = p.tipo ? p.tipo + (p.subtipo === 'REINTEGRO' || p.subtipo === 'DEVOLUCION' ? ':' + p.subtipo : '') : '';
    var cls = 'fin2-reg__fila' + (o.estado === 'ANULADA' ? ' fin2-reg__fila--anulada' : '') + (!o.completa ? ' fin2-reg__fila--falta' : '') + (est_.abierta === o.id ? ' fin2-reg__fila--abierta' : '');
    var chk = '<span><input type="checkbox" class="js-finr-chk" data-cap="REGISTRAR"' + (est_.sel[o.id] ? ' checked' : '') + ' aria-label="Marcar"></span>';
    var acc = '<span class="fin2-reg__acc">' + U.boton({ soloIcono: true, icono: 'derecha', sm: true, variante: 'fantasma', titulo: 'Abrir el detalle', clase: 'js-finr-abrir' }) + '</span>';
    if (!editable) {
      return '<div class="' + cls + '" role="row" data-id="' + txt(o.id) + '" data-version="' + o.version + '" tabindex="0">' + chk +
        '<span class="fin2-num">' + txt(corta(o.fecha)) + '</span><span class="fin2-reg__txt">' + txt(o.tercero || '—') + (o.referencia ? '<small>' + txt(o.referencia) + '</small>' : '') + '</span>' +
        '<span class="fin2-reg__txt">' + (varias ? '<i>' + (o.distribuciones || []).length + ' partes</i>' : txt(cli ? cli.nombre : '—')) + '</span>' +
        '<span>' + txt(varias ? 'Varias' : tipoNombre(p.tipo, p.subtipo)) + '</span><span>' + txt(varias ? '' : p.cuenta || '') + '</span>' +
        '<span class="fin2-der fin2-num fin2-pos">' + (o.sentido === 'ENTRADA' ? plata(o.monto) : '') + '</span><span class="fin2-der fin2-num">' + (o.sentido === 'SALIDA' ? plata(o.monto) : '') + '</span>' +
        '<span>' + registroBadge(o) + '</span><span>' + bancoBadge(o) + '</span>' + acc + '</div>';
    }
    return '<div class="' + cls + ' fin2-reg__fila--edit" role="row" data-id="' + txt(o.id) + '" data-version="' + o.version + '">' + chk +
      '<span><input class="fin2-rc js-finr-c" data-campo="fecha" type="date" value="' + txt(o.fecha) + '" aria-label="Fecha"></span>' +
      '<span><input class="fin2-rc js-finr-c" data-campo="tercero" value="' + txt(o.tercero) + '" placeholder="Quién paga o recibe" aria-label="Quién paga o recibe"></span>' +
      '<span><input class="fin2-rc js-finr-c" data-campo="cliente" list="finr-clientes" value="' + txt(cli ? cli.nombre + (cli.rut ? ' · ' + cli.rut : '') : '') + '" placeholder="Nombre, RUT o alias" aria-label="Cliente"></span>' +
      '<span><select class="fin2-rc js-finr-c" data-campo="tipo" aria-label="Naturaleza">' + opciones(TIPOS_UI, tipoK, '¿Qué es?') + '</select></span>' +
      '<span><select class="fin2-rc js-finr-c" data-campo="cuenta" aria-label="Concepto">' + opciones(cuentasDeTipo(p.tipo), p.cuenta, cuentasDeTipo(p.tipo).length ? 'Concepto' : '—') + '</select></span>' +
      '<span><input class="fin2-rc fin2-der js-finr-c" data-campo="entrada" inputmode="numeric" value="' + (o.sentido === 'ENTRADA' ? miles(o.monto) : '') + '" aria-label="Entrada"></span>' +
      '<span><input class="fin2-rc fin2-der js-finr-c" data-campo="salida" inputmode="numeric" value="' + (o.sentido === 'SALIDA' ? miles(o.monto) : '') + '" aria-label="Salida"></span>' +
      '<span class="js-finr-estado">' + registroBadge(o) + '</span><span>' + bancoBadge(o) + '</span>' + acc + '</div>';
  }

  // ---- guardar una fila editada (como borrador) -------------------------------------------
  function leerFilaEditada(el) {
    var v = function (c) { var e = el.querySelector('[data-campo="' + c + '"]'); return e ? e.value : ''; };
    var o = opDe(el.dataset.id) || {};
    var tipoSel = v('tipo').split(':');
    var ent = montoDe(v('entrada')), sal = montoDe(v('salida'));
    var cli = clientePorTexto(v('cliente'));
    return {
      error: cli.error || (ent && sal ? 'Una fila tiene entrada o salida, no las dos.' : ''),
      datos: {
        id: est_.nuevas[el.dataset.id] ? undefined : el.dataset.id, expected_version: est_.nuevas[el.dataset.id] ? undefined : Number(el.dataset.version),
        idempotency_key: est_.nuevas[el.dataset.id] ? est_.nuevas[el.dataset.id] : undefined,
        empresa: o.empresa && o.empresa !== 'SIN_EMPRESA' ? o.empresa : (est_.empresa || est_.empresaNueva), cuenta_ref: o.cuenta_ref || cuentaReal(), medio: o.medio || 'TRANSFERENCIA',
        fecha: v('fecha'), tercero: v('tercero'), referencia: o.referencia || '', nota: o.nota || '',
        sentido: ent ? 'ENTRADA' : sal ? 'SALIDA' : (SENTIDO_TIPO[tipoSel[0]] || o.sentido || ''), monto: ent || sal || '',
        tipo: tipoSel[0] || '', subtipo: tipoSel[1] || '', cuenta: v('cuenta'), cliente_id: cli.id || '',
        periodo_obligacion: ((o.distribuciones || [])[0] || {}).periodo_obligacion || '', destino: ((o.distribuciones || [])[0] || {}).destino || '',
        gestion_id: ((o.distribuciones || [])[0] || {}).gestion_id || '', proyecto_id: ((o.distribuciones || [])[0] || {}).proyecto_id || ''
      }
    };
  }
  function opDe(id) { return ((est_.datos && est_.datos.operaciones) || []).filter(function (o) { return o.id === id; })[0] || null; }
  function guardarFila(el, foco) {
    if (!el || !el.classList.contains('fin2-reg__fila--edit') || est_.guardando[el.dataset.id]) return Promise.resolve();
    if (!el.dataset.sucio) return Promise.resolve();
    var l = leerFilaEditada(el);
    var est = el.querySelector('.js-finr-estado');
    if (l.error) { if (est) est.innerHTML = '<span class="fin2-falta">' + U.ico('alerta', 12) + txt(l.error) + '</span>'; return Promise.resolve(); }
    est_.guardando[el.dataset.id] = true;
    if (est) est.innerHTML = '<span class="fin2-ayuda">Guardando…</span>';
    return x_.api('finanzasGuardarOperacion', l.datos).then(function (r) {
      est_.guardando[el.dataset.id] = false;
      if (!r || !r.ok) {
        // I12.4: el cambio de la persona no se descarta: queda en el aviso para aplicarlo sobre lo nuevo o descartarlo.
        if (r && r.codigo === 'CONFLICTO_VERSION') { rescate_.push({ datos: l.datos, motivo: 'conflicto' }); x_.aviso('Otra persona cambió esta fila: se cargó lo último y tu cambio quedó en el aviso de arriba.', 'alerta'); recargar(true); return; }
        if (est) est.innerHTML = '<span class="fin2-falta">' + U.ico('alerta', 12) + 'No guardado: ' + txt((r && r.message) || 'no se pudo guardar.') + ' Vuelve a salir de la fila para reintentar.</span>';
        return;
      }
      delete el.dataset.sucio;
      est_.guardado = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit' }).format(new Date());
      var eraNueva = !!est_.nuevas[el.dataset.id];
      if (eraNueva) delete est_.nuevas[el.dataset.id];
      if (r.data.coincidencias_banco && r.data.coincidencias_banco.length) x_.aviso('Ojo: ya hay un movimiento del banco clasificado igual (' + plata(r.data.coincidencias_banco[0].monto) + ', ' + r.data.coincidencias_banco[0].fecha + '). Ábrela para vincularlos o marcar que son distintos.', 'alerta');
      else if (r.data.duplicados && r.data.duplicados.length) x_.aviso('Ojo: hay ' + r.data.duplicados.length + ' operación(es) igual(es) ese día (' + plata(r.data.duplicados[0].monto) + '). Si son dos pagos distintos, está bien.', 'alerta');
      est_.foco = foco ? { id: r.data.id, campo: foco } : null;
      return recargar(true);
    });
  }
  function conEmpresa(fn) {
    if (est_.empresa || est_.empresaNueva) return fn();
    U.formulario({ titulo: '¿De qué empresa son las filas nuevas?', boton: 'Seguir', campos: U.campo('Empresa', '<select name="empresa" class="sx2-input" required>' + opciones((cat_.empresas || []).map(function (e) { return [e, e]; }), '', 'Elige…') + '</select>', 'Estás viendo todas las empresas: para crear hay que elegir una. Se recuerda mientras sigas en esta vista.'),
      enviar: function (d) { est_.empresaNueva = d.empresa; return Promise.resolve({ ok: true, data: {} }); }, listo: function () { fn(); } });
  }
  function nuevaFila(base) {
    if (!est_.empresa && !est_.empresaNueva && !(base && base.empresa)) { conEmpresa(function () { nuevaFila(base); }); return; }
    var id = 'nueva-' + uuid();
    est_.nuevas[id] = uuid();
    var o = Object.assign({ id: id, version: 0, estado: 'BORRADOR', conciliacion: 'SIN_BANCO', empresa: est_.empresa || est_.empresaNueva, cuenta_ref: cuentaReal(), fecha: est_.periodo === hoyIso().slice(0, 7) ? hoyIso() : est_.periodo + '-01',
      sentido: '', monto: 0, tercero: '', distribuciones: [{}], completa: false, faltantes: [{ campo: 'monto', mensaje: 'Completa la fila' }] }, base || {});
    est_.datos.operaciones.unshift(o);
    pintar();
    var f = document.querySelector('.fin2-reg__fila[data-id="' + id + '"]');
    if (f) { f.dataset.sucio = '1'; var c = f.querySelector('[data-campo="' + (base ? 'fecha' : 'fecha') + '"]'); if (c) c.focus(); }
  }

  // ---- panel de detalle --------------------------------------------------------------------
  function abrirPanel(id) {
    var o = opDe(id);
    if (!o || /^nueva-/.test(id)) { var f = document.querySelector('.fin2-reg__fila[data-id="' + id + '"]'); if (f) guardarFila(f).then(function () { x_.aviso('Guarda la fila primero (sal de la fila) y luego ábrela.'); }); return; }
    est_.abierta = id;
    x_.api('finanzasOperacion', { id: id }).then(function (r) {
      if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo abrir.', 'error'); return; }
      pintarPanel(r.data);
    });
  }
  // Qué campos pide cada naturaleza. Lo oculto se conserva tal cual (no se borra al ocultar).
  var VISIBLE = { cliente: ['INGRESO', 'FONDO_RECIBIDO', 'FONDO_PAGADO'], empresa: ['PRESTAMO'], periodo: ['FONDO_RECIBIDO', 'FONDO_PAGADO'], destino: ['FONDO_RECIBIDO', 'FONDO_PAGADO', 'EGRESO'], proyecto: ['INGRESO', 'EGRESO'] };
  var CAMPO_DE = { cliente: 'cliente_id', empresa: 'empresa', periodo: 'periodo_obligacion', destino: 'destino', proyecto: 'proyecto_id' };
  function aplicarVisibles(parte) {
    var b = (parte.querySelector('[data-campo="tipo"]').value || '').split(':')[0];
    Object.keys(VISIBLE).forEach(function (k) {
      var lab = parte.querySelector('[data-para="' + k + '"]'); if (!lab) return;
      var inp = lab.querySelector('.js-finr-p');
      lab.hidden = !(!b || VISIBLE[k].indexOf(b) !== -1 || (inp && inp.value));
    });
  }
  function campoParte(p, i, sentido, unaSola) {
    var tipos = TIPOS_UI.filter(function (t) { var b = t[0].split(':')[0]; return !SENTIDO_TIPO[b] || !sentido || SENTIDO_TIPO[b] === sentido; });
    var tk = p.tipo ? p.tipo + (p.subtipo === 'REINTEGRO' || p.subtipo === 'DEVOLUCION' ? ':' + p.subtipo : '') : '';
    var cli = p.cliente_id ? cliente(p.cliente_id) : null;
    var b = String(p.tipo || '').split(':')[0];
    var ver_ = function (k) { var v = VISIBLE[k]; return !b || v.indexOf(b) !== -1 || !!p[CAMPO_DE[k]]; };
    var oculto = function (k) { return ver_(k) ? '' : ' hidden'; };
    return '<div class="fin2-parte2 js-finr-parte" data-i="' + i + '">' +
      '<div class="fin2-parte2__fila"><label class="fin2-campo js-finr-montoparte"' + (unaSola ? ' hidden' : '') + '><span>Monto de la parte</span><input class="fin2-input fin2-input--sm fin2-der js-finr-p" data-campo="monto" inputmode="numeric" value="' + miles(p.monto) + '"></label>' +
      '<label class="fin2-campo"><span>Naturaleza</span><select class="fin2-input fin2-input--sm js-finr-p" data-campo="tipo">' + opciones(tipos, tk, '¿Qué es?') + '</select></label>' +
      '<label class="fin2-campo"><span>Concepto</span><select class="fin2-input fin2-input--sm js-finr-p" data-campo="cuenta">' + opciones(cuentasDeTipo(p.tipo), p.cuenta, cuentasDeTipo(p.tipo).length ? 'Elige…' : '—') + '</select></label></div>' +
      '<div class="fin2-parte2__fila"><label class="fin2-campo" data-para="cliente"' + oculto('cliente') + '><span>Cliente</span><input class="fin2-input fin2-input--sm js-finr-p" data-campo="cliente" list="finr-clientes" value="' + txt(cli ? cli.nombre + ' · ' + cli.rut : '') + '" placeholder="Nombre, RUT o alias"></label>' +
      '<label class="fin2-campo" data-para="empresa"' + oculto('empresa') + '><span>Empresa contraparte (préstamo)</span><select class="fin2-input fin2-input--sm js-finr-p" data-campo="empresa">' + opciones((cat_.empresas || []).map(function (e) { return [e, e]; }), p.empresa, '—') + '</select></label>' +
      '<label class="fin2-campo" data-para="periodo"' + oculto('periodo') + '><span>Período de la obligación</span><input type="month" class="fin2-input fin2-input--sm js-finr-p" data-campo="periodo_obligacion" value="' + txt(p.periodo_obligacion || '') + '"></label></div>' +
      '<div class="fin2-parte2__fila"><label class="fin2-campo" data-para="destino"' + oculto('destino') + '><span>Destino (obra, trabajador…)</span><input class="fin2-input fin2-input--sm js-finr-p" data-campo="destino" value="' + txt(p.destino || '') + '"></label>' +
      '<label class="fin2-campo" data-para="proyecto"' + oculto('proyecto') + '><span>Proyecto</span><select class="fin2-input fin2-input--sm js-finr-p" data-campo="proyecto_id">' + opciones((cat_.proyectos || []).map(function (y) { return [y.id, (y.codigo ? y.codigo + ' · ' : '') + y.nombre]; }), p.proyecto_id, '—') + '</select></label>' +
      '<input type="hidden" class="js-finr-p" data-campo="gestion_id" value="' + txt(p.gestion_id || '') + '">' +
      (i > 0 ? U.boton({ texto: 'Quitar parte', icono: 'equis', sm: true, variante: 'fantasma', clase: 'js-finr-quitar-parte' }) : '') + '</div></div>';
  }
  function pintarPanel(o) {
    var acc = (est_.datos.acciones || {})[o.accion] || null;
    var editable = o.estado !== 'ANULADA' && o.conciliacion !== 'CONCILIADA' && o.conciliacion !== 'PARCIAL' && x_.puede('REGISTRAR');
    var cuentas = (est_.cuentas || []).filter(function (c) { return c.empresa === o.empresa; });
    var medios = (cat_.medios || []).map(function (m) { return [m.id, m.nombre]; });
    var cuerpo = '<div class="fin2-p js-finr-panel" data-id="' + txt(o.id) + '" data-version="' + o.version + '">' +
      seccionDuplicado(o) +
      (acc ? '<div class="fin2-p-caja fin2-p-caja--info">' + U.ico('bombilla', 16) + '<span><b>' + txt(acc.nombre) + ':</b> ' + txt(acc.ayuda) + '</span></div>' : '') +
      (o.origen && o.origen.tipo === 'CONTROL_INTERNO' ? '<div class="fin2-p-caja">' + U.ico('enlace', 16) + '<span>Desde Control interno: ' + txt(o.origen.matriz === 'IVA' ? 'IVA (F29)' : 'Pago de imposiciones') + ' de ' + txt(o.origen.periodo_obligacion) + (o.origen.monto_esperado ? ' · esperado ' + plata(o.origen.monto_esperado) : '') + '.</span></div>' : '') +
      (o.fuente_cambio ? '<div class="fin2-p-caja fin2-p-caja--alerta">' + U.ico('alerta', 16) + '<span>' + txt(o.fuente_cambio.texto) + '</span></div>' : '') +
      (o.origen && o.origen.tipo === 'DUPLICADO' ? '<div class="fin2-p-caja">' + U.ico('copiar', 16) + '<span>Duplicada de una operación del ' + txt(o.origen.fecha_original || '') + '. Revisa fecha, monto y referencia antes de confirmar.</span></div>' : '') +
      '<section class="fin2-p-sec"><h3>La operación</h3><div class="fin2-parte2__fila">' +
        '<label class="fin2-campo"><span>Empresa</span><select class="fin2-input fin2-input--sm js-finr-o" data-campo="empresa"' + (editable ? '' : ' disabled') + '>' + opciones((cat_.empresas || []).map(function (e) { return [e, e]; }), o.empresa) + '</select></label>' +
        '<label class="fin2-campo"><span>Cuenta del banco</span><select class="fin2-input fin2-input--sm js-finr-o" data-campo="cuenta_ref"' + (editable ? '' : ' disabled') + '>' + opciones(cuentas.map(function (c) { return [c.id, c.banco + ' ···' + c.ultimos4]; }), o.cuenta_ref, 'Sin cuenta') + '</select></label>' +
        '<label class="fin2-campo"><span>Medio</span><select class="fin2-input fin2-input--sm js-finr-o" data-campo="medio"' + (editable ? '' : ' disabled') + '>' + opciones(medios, o.medio) + '</select></label></div>' +
      '<div class="fin2-parte2__fila">' +
        '<label class="fin2-campo"><span>Fecha efectiva</span><input type="date" class="fin2-input fin2-input--sm js-finr-o" data-campo="fecha" value="' + txt(o.fecha) + '"' + (editable ? '' : ' disabled') + '></label>' +
        '<label class="fin2-campo"><span>Entra o sale</span><select class="fin2-input fin2-input--sm js-finr-o" data-campo="sentido"' + (editable ? '' : ' disabled') + '>' + opciones([['ENTRADA', 'Entra dinero'], ['SALIDA', 'Sale dinero']], o.sentido) + '</select></label>' +
        '<label class="fin2-campo"><span>Monto total</span><input class="fin2-input fin2-input--sm fin2-der js-finr-o" data-campo="monto" inputmode="numeric" value="' + miles(o.monto) + '"' + (editable ? '' : ' disabled') + '></label></div>' +
      '<div class="fin2-parte2__fila">' +
        '<label class="fin2-campo"><span>Quién paga / recibe</span><input class="fin2-input fin2-input--sm js-finr-o" data-campo="tercero" value="' + txt(o.tercero) + '"' + (editable ? '' : ' disabled') + '><small class="fin2-ayuda">El pagador puede ser distinto del cliente.</small></label>' +
        '<label class="fin2-campo"><span>Referencia / N° doc.</span><input class="fin2-input fin2-input--sm js-finr-o" data-campo="referencia" value="' + txt(o.referencia) + '"' + (editable ? '' : ' disabled') + '></label></div>' +
      '</section>' +
      '<section class="fin2-p-sec"><h3>Cómo se reparte</h3><p class="fin2-ayuda">Una parte por cliente o concepto. Las partes suman exacto el total. La obligación puede ser de un mes anterior.</p>' +
        '<div class="js-finr-partes">' + (o.distribuciones && o.distribuciones.length ? o.distribuciones : [{}]).map(function (p, i, l) { return campoParte(p, i, o.sentido, l.length < 2); }).join('') + '</div>' +
        (editable ? '<div class="fin2-acciones" style="justify-content:space-between;align-items:center">' + U.boton({ texto: (o.distribuciones || []).length > 1 ? 'Agregar parte' : 'Dividir importe', icono: 'nueva', sm: true, clase: 'js-finr-mas-parte' }) + '<span class="fin2-ayuda js-finr-suma"></span></div>' : '') +
      '</section>' +
      '<label class="fin2-campo"><span>Nota</span><input class="fin2-input fin2-input--sm js-finr-o" data-campo="nota" value="' + txt(o.nota) + '" maxlength="500"' + (editable ? '' : ' disabled') + '></label>' +
      '<div class="js-finr-avisos" aria-live="polite"></div>' +
      (o.duplicados && o.duplicados.length ? '<div class="fin2-p-caja fin2-p-caja--alerta">' + U.ico('alerta', 16) + '<span>Hay ' + o.duplicados.length + ' operación(es) igual(es) en esas fechas. Si son pagos distintos, está bien; si es la misma, anula una.</span></div>' : '') +
      '<section class="fin2-p-sec"><h3>Banco</h3>' + (o.conciliacion === 'CONCILIADA' || o.conciliacion === 'PARCIAL' ? seccionVinculos(o)
        : o.conciliacion === 'NO_APLICA' ? '<p class="fin2-ayuda">No pasa por el banco (efectivo o compensación): no espera cartola.</p>'
          : '<p class="fin2-ayuda">Cuando llegue la cartola, el sistema propondrá unirla con el movimiento del banco.</p>' + (o.estado === 'CONFIRMADA' ? U.boton({ texto: 'Buscar en el banco', icono: 'lupa', sm: true, clase: 'js-finr-buscar-banco', datos: { cap: 'CONCILIAR' } }) : '')) + '</section>' +
      '<section class="fin2-p-sec"><h3>Historial</h3><ul class="fin2-hist">' + (o.historial || []).slice().reverse().map(function (h) { return '<li><b>' + txt(h.accion) + '</b> · ' + txt(h.por) + ' · ' + txt(String(h.en || '').slice(0, 16).replace('T', ' ')) + (h.motivo ? ' · ' + txt(h.motivo) : '') + '</li>'; }).join('') +
        (o.origen ? '<li>Origen: ' + txt(o.origen.tipo || '') + (o.origen.fila ? ' · fila ' + o.origen.fila : '') + '</li>' : '') + '</ul></section>' +
    '</div>';
    var pie = editable ? (U.boton({ texto: 'Anular', icono: 'equis', variante: 'fantasma', sm: true, clase: 'js-finr-p-anular', datos: { cap: 'CONFIRMAR' } }) +
      (o.estado === 'BORRADOR' ? U.boton({ texto: 'Descartar', icono: 'basura', variante: 'fantasma', sm: true, clase: 'js-finr-p-descartar' }) : '') +
      U.boton({ texto: 'Guardar como plantilla', icono: 'copiar', variante: 'fantasma', sm: true, clase: 'js-finr-p-plantilla' }) +
      '<span style="flex:1"></span>' +
      (o.estado === 'BORRADOR' ? U.boton({ texto: 'Guardar borrador', icono: 'check', clase: 'js-finr-p-borrador' }) : '') +
      U.boton({ texto: o.estado === 'CONFIRMADA' ? 'Guardar corrección' : 'Confirmar', icono: 'check', variante: 'primario', clase: 'js-finr-p-confirmar', datos: { cap: 'CONFIRMAR' } }))
      : '<span class="fin2-ayuda">' + (o.estado === 'ANULADA' ? 'Anulada: queda en la historia.' : o.conciliacion === 'CONCILIADA' || o.conciliacion === 'PARCIAL' ? 'Vinculada con el banco: deshaz la conciliación para corregirla.' : 'Solo lectura.') + '</span>';
    var d = U.drawer({ titulo: o.estado === 'BORRADOR' ? 'Operación en borrador' : 'Operación', subtitulo: '<span class="fin2-ayuda">' + txt(o.fecha || '') + ' · ' + estadoBadge(o) + '</span>', cuerpo: cuerpo, pie: pie,
      alCerrar: function () { est_.abierta = ''; } });
    d.el.classList.add('fin2-panel', 'sx2-drawer--ancho');
    est_.panel = d;
    enlazarPanel(d.el, o);
    actualizarSuma(d.el);
    revisar(d.el);
    x_.aplicarCapacidades(d.el);
  }
  /**
   * I01: esta operación podría ser el mismo dinero que un movimiento del banco ya clasificado.
   * Mientras nadie decida, cuenta el banco y esta queda aparte. La persona vincula o marca «distintas».
   */
  /** Vínculos con el banco (I02): cada movimiento con su importe; si queda resto, a la vista y con «Explicar diferencia». */
  function seccionVinculos(o) {
    var act = (o.vinculos || []).filter(function (v) { return v.estado === 'ACTIVA'; });
    var parcial = o.conciliacion === 'PARCIAL';
    return '<p>' + (parcial ? U.badge('Banco en parte', 'alerta') + ' llegó ' + plata(o.monto - (o.disponible || 0)) + ' de ' + plata(o.monto) + '; <b>falta ' + plata(o.disponible || 0) + '</b>.' : U.badge('Conciliada', 'ok') + ' con ' + act.length + ' movimiento(s) del banco.') + '</p>' +
      '<ul class="fin2-hist">' + act.map(function (v) { return '<li>' + txt(v.mov_fecha || '') + ' · ' + txt(v.mov_glosa || '') + ' · <b>' + plata(v.monto) + '</b>' + (v.mov_monto && v.mov_monto !== v.monto ? ' <span class="fin2-ayuda">de un movimiento de ' + plata(v.mov_monto) + '</span>' : '') + '</li>'; }).join('') + '</ul>' +
      (o.remanente_explicado ? '<p class="fin2-ayuda">Diferencia explicada: ' + plata(o.remanente_explicado.monto) + ' · ' + txt(o.remanente_explicado.motivo || '') + ' (respaldo: ' + txt(o.remanente_explicado.respaldo || '') + ').</p>' : '') +
      (parcial ? '<p class="fin2-ayuda">Si el resto llegará después, espera esa cartola y vincúlalo. Si no llegará porque es una comisión o retención comprobada, explícalo (queda como gasto propio, con respaldo; nunca un redondeo automático).</p>' : '') +
      '<div class="fin2-acciones" data-cap="CONCILIAR">' + (parcial ? U.boton({ texto: 'Buscar el resto en el banco', icono: 'lupa', sm: true, clase: 'js-finr-buscar-banco' }) + U.boton({ texto: 'Explicar diferencia', icono: 'editar', sm: true, clase: 'js-finr-remanente' }) : '') +
        U.boton({ texto: 'Deshacer la conciliación', icono: 'equis', sm: true, variante: 'fantasma', clase: 'js-finr-desconciliar' }) + '</div>';
  }
  function explicarRemanente(o) {
    U.formulario({ titulo: 'Explicar la diferencia de ' + plata(o.disponible || 0), boton: 'Guardar explicación',
      campos: U.campo('Concepto de gasto', '<select name="cuenta" class="sx2-input" required>' + opciones(cuentasDeTipo('EGRESO'), '', 'Elige…') + '</select>', 'Por ejemplo, comisión bancaria o retención.') +
        U.campo('Qué es la diferencia', '<input name="motivo" class="sx2-input" required maxlength="300" placeholder="Comisión de la transferencia internacional…">') +
        U.campo('Respaldo', '<input name="respaldo" class="sx2-input" required maxlength="200" placeholder="Liquidación del banco n.º…, comprobante de retención…">', 'Queda como una operación propia (compensación: no es caja) con tu nombre.'),
      enviar: function (d) { return x_.api('finanzasExplicarRemanente', { operacion_id: o.id, expected_version: o.version, cuenta: d.cuenta, motivo: d.motivo, respaldo: d.respaldo }); },
      aviso: 'Diferencia explicada: la operación queda conciliada.', listo: function () { if (est_.panel) est_.panel.cerrar(); recargar(true); } });
  }
  function seccionDuplicado(o) {
    var l = o.coincidencias_banco || [];
    if (!l.length) return '';
    return '<section class="fin2-p-sec fin2-dup" aria-label="Posible duplicado"><h3>¿Es el mismo dinero que el banco?</h3>' +
      '<p class="fin2-ayuda">Hay ' + (l.length === 1 ? 'un movimiento del banco ya clasificado' : l.length + ' movimientos del banco ya clasificados') + ' con el mismo monto, sentido y empresa. ' +
      'Mientras no se decida, las cifras cuentan el banco y esta operación queda aparte (no se suma dos veces).</p>' +
      l.map(function (m) {
        return '<div class="fin2-dup__mov"><div><b>' + txt(m.fecha) + ' · ' + plata(m.monto) + '</b><small>' + txt(m.glosa) + ' · ' + txt(m.cuenta) + ' · clasificado como ' + txt(m.clasificado_como || '—') + '</small></div>' +
          '<span class="fin2-acciones-min" data-cap="CONCILIAR">' +
            U.boton({ texto: 'Es el mismo: vincular', icono: 'enlace', sm: true, variante: 'primario', clase: 'js-finr-dup-vincular', datos: { mov: m.movimiento_id, v: m.version } }) +
            U.boton({ texto: 'Son pagos distintos', sm: true, clase: 'js-finr-dup-distintas', datos: { mov: m.movimiento_id } }) + '</span></div>';
      }).join('') + '</section>';
  }
  function leerPanel(el) {
    var o = {};
    el.querySelectorAll('.js-finr-o').forEach(function (i) { o[i.dataset.campo] = i.value; });
    o.monto = montoDe(o.monto);
    var partes = [];
    var error = '';
    el.querySelectorAll('.js-finr-parte').forEach(function (p) {
      var q = {};
      p.querySelectorAll('.js-finr-p').forEach(function (i) { q[i.dataset.campo] = i.value; });
      var t = String(q.tipo || '').split(':'); q.tipo = t[0]; q.subtipo = t[1] || '';
      var cli = clientePorTexto(q.cliente); if (cli.error) error = error || cli.error; q.cliente_id = cli.id || ''; delete q.cliente;
      q.monto = montoDe(q.monto);
      partes.push(q);
    });
    // Una sola parte con su monto oculto: es el total (no se pide dos veces).
    if (partes.length === 1 && (!partes[0].monto || el.querySelector('.js-finr-montoparte[hidden]'))) partes[0].monto = o.monto;
    o.distribuciones = partes;
    return { datos: o, error: error };
  }
  function actualizarSuma(el) {
    var s = el.querySelector('.js-finr-suma'); if (!s) return;
    var l = leerPanel(el).datos, suma = l.distribuciones.reduce(function (a, p) { return a + (p.monto || 0); }, 0), dif = (l.monto || 0) - suma;
    s.innerHTML = l.distribuciones.length < 2 ? '' : 'Total ' + plata(l.monto) + ' · asignado ' + plata(suma) + ' · ' + (dif === 0 ? '<span class="fin2-pos">✓ suma exacta</span>' : dif > 0 ? 'falta asignar <b>' + plata(dif) + '</b>' : '<span class="fin2-neg">te pasaste por ' + plata(-dif) + '</span>');
  }
  var revT_ = null;
  function revisar(el, luego) {
    clearTimeout(revT_);
    revT_ = setTimeout(function () {
      if (!el.isConnected) return;
      var l = leerPanel(el).datos;
      x_.api('finanzasRevisarOperacion', Object.assign({ id: el.querySelector('.js-finr-panel').dataset.id }, l)).then(function (r) {
        if (!r || !r.ok || !el.isConnected) return;
        var z = el.querySelector('.js-finr-avisos');
        var av = r.data.avisos || [];
        z.innerHTML = av.length ? '<div class="fin2-avisos' + (el.dataset.insiste ? ' fin2-avisos--insiste' : '') + '">' + (el.dataset.insiste ? '<b>Antes de confirmar, revisa esto.</b> Si está bien así, presiona «Confirmar igual».' : '') + '<ul>' + av.map(function (a) {
          return '<li class="fin2-aviso fin2-aviso--' + a.nivel + '">' + U.ico(a.nivel === 'alerta' ? 'alerta' : 'info', 14) + '<span>' + txt(a.texto) + '</span></li>';
        }).join('') + '</ul></div>' : '';
        el.dataset.alertas = String(r.data.alertas || 0);
      });
    }, luego || 0);
  }
  function guardarPanel(el, confirmar) {
    var panel = el.querySelector('.js-finr-panel');
    var l = leerPanel(el);
    if (l.error) { x_.aviso(l.error, 'alerta'); return; }
    if (confirmar && Number(el.dataset.alertas || 0) > 0 && !el.dataset.insiste) {
      el.dataset.insiste = '1'; revisar(el);
      var b = el.querySelector('.js-finr-p-confirmar'); if (b) b.lastChild.textContent = 'Confirmar igual';
      return;
    }
    var datos = Object.assign({ id: panel.dataset.id, expected_version: Number(panel.dataset.version), confirmar: !!confirmar }, l.datos);
    x_.api('finanzasGuardarOperacion', datos).then(function (r) {
      if (!r || !r.ok) {
        if (r && r.codigo === 'CONFLICTO_VERSION') { x_.aviso('Otra persona cambió esta operación: se reabrió con lo último.', 'alerta'); abrirPanel(panel.dataset.id); return; }
        x_.aviso((r && r.message) || 'No se pudo guardar.', 'error'); return;
      }
      if (r.data.coincidencias_banco && r.data.coincidencias_banco.length) x_.aviso('Guardada. Ojo: hay un movimiento del banco ya clasificado igual: vincúlalos o marca que son distintos (ábrela de nuevo).', 'alerta');
      else x_.aviso(confirmar ? 'Operación confirmada.' : 'Borrador guardado.', 'exito');
      if (est_.panel) est_.panel.cerrar();
      recargar(true);
    });
  }
  function enlazarPanel(el, o) {
    el.addEventListener('input', function (ev) { if (ev.target.dataset.campo === 'monto') actualizarSuma(el); el.dataset.insiste = ''; revisar(el, 450); });
    el.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.classList.contains('js-finr-p') && t.dataset.campo === 'tipo') {
        var p = t.closest('.js-finr-parte'), sel = p.querySelector('[data-campo="cuenta"]');
        var cuentas = cuentasDeTipo(t.value.split(':')[0]);
        sel.innerHTML = opciones(cuentas, '', cuentas.length ? 'Elige…' : '—');
        aplicarVisibles(p);
        var b = SENTIDO_TIPO[t.value.split(':')[0]]; var s = el.querySelector('[data-campo="sentido"]'); if (b && s) s.value = b;
      }
      if (t.classList.contains('js-finr-o') && t.dataset.campo === 'empresa') {
        var cs = el.querySelector('[data-campo="cuenta_ref"]');
        cs.innerHTML = opciones((est_.cuentas || []).filter(function (c) { return c.empresa === t.value; }).map(function (c) { return [c.id, c.banco + ' ···' + c.ultimos4]; }), '', 'Sin cuenta');
      }
      el.dataset.insiste = ''; revisar(el, 150);
    });
    el.addEventListener('focusout', function (ev) { if (ev.target.dataset && /monto/.test(ev.target.dataset.campo || '')) { var n = montoDe(ev.target.value); ev.target.value = n ? miles(n) : ''; } });
    el.addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      if (b.classList.contains('js-finr-mas-parte')) {
        // Dividir: el monto de cada parte aparece recién ahora (con una sola parte no se pide dos veces).
        var c = el.querySelector('.js-finr-partes');
        var tot = montoDe((el.querySelector('.js-finr-o[data-campo="monto"]') || {}).value);
        c.querySelectorAll('.js-finr-montoparte').forEach(function (m) { m.hidden = false; var i = m.querySelector('input'); if (!montoDe(i.value) && c.children.length === 1) i.value = tot ? miles(tot) : ''; });
        c.insertAdjacentHTML('beforeend', campoParte({}, c.children.length, el.querySelector('[data-campo="sentido"]').value, false));
        b.lastChild.textContent = 'Agregar parte';
        actualizarSuma(el);
      }
      else if (b.classList.contains('js-finr-quitar-parte')) { b.closest('.js-finr-parte').remove(); actualizarSuma(el); revisar(el, 100); }
      else if (b.classList.contains('js-finr-p-borrador')) guardarPanel(el, false);
      else if (b.classList.contains('js-finr-p-confirmar')) guardarPanel(el, true);
      else if (b.classList.contains('js-finr-p-anular')) anular([o.id]);
      else if (b.classList.contains('js-finr-p-descartar')) lote('DESCARTAR', [o.id]);
      else if (b.classList.contains('js-finr-p-plantilla')) guardarPlantilla(leerPanel(el).datos);
      else if (b.classList.contains('js-finr-desconciliar')) desconciliar(o.id);
      else if (b.classList.contains('js-finr-remanente')) explicarRemanente(o);
      else if (b.classList.contains('js-finr-dup-vincular')) {
        U.confirmar({ titulo: 'Vincular con el movimiento del banco', texto: 'Quedará un solo hecho: el movimiento del banco toma lo que sabe esta operación (cliente, obligación, período, destino). Se puede deshacer con motivo.', boton: 'Vincular' }).then(function (si) {
          if (!si) return;
          x_.api('finanzasConciliar', { idempotency_key: uuid(), movimientos: [{ id: b.dataset.mov, expected_version: Number(b.dataset.v) }], operaciones: [{ id: o.id, expected_version: o.version }] }).then(function (r) {
            if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo vincular.', 'error'); return; }
            x_.aviso('Vinculado: es un solo hecho.', 'exito'); if (est_.panel) est_.panel.cerrar(); recargar(true);
          });
        });
      }
      else if (b.classList.contains('js-finr-dup-distintas')) {
        U.formulario({ titulo: 'Son pagos distintos', boton: 'Guardar decisión',
          campos: U.campo('Por qué son distintos', '<input name="motivo" class="sx2-input" required maxlength="300" placeholder="Dos cuotas del mismo mes, otra factura…">', 'Desde ahora cuentan los dos. Queda en la historia con tu nombre y se puede quitar.'),
          enviar: function (d) { return x_.api('finanzasMarcarDistintas', { operacion_id: o.id, movimiento_id: b.dataset.mov, expected_version: o.version, motivo: d.motivo }); },
          aviso: 'Decisión guardada: son pagos distintos.', listo: function () { recargar(true); } });
      }
      else if (b.classList.contains('js-finr-buscar-banco')) { if (est_.panel) est_.panel.cerrar(); x_.ir('conciliacion', { periodo: o.periodo }); }
    });
  }

  // ---- lote, anular, cambiar ---------------------------------------------------------------
  function lote(accion, ids, extra) {
    ids = ids || Object.keys(est_.sel).filter(function (k) { return est_.sel[k]; });
    if (!ids.length) return;
    var versiones = {};
    ids.forEach(function (id) { var o = opDe(id); if (o) versiones[id] = o.version; });
    x_.api('finanzasAccionOperaciones', Object.assign({ accion: accion, ids: ids, versiones: versiones }, extra || {})).then(function (r) {
      if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo.', 'error'); return; }
      var malos = r.data.resultados.filter(function (y) { return !y.ok; });
      x_.aviso(r.data.hechos + ' hecha(s)' + (malos.length ? ' · ' + malos.length + ' no: ' + malos[0].mensaje : ''), malos.length ? 'alerta' : 'exito');
      if (est_.panel) est_.panel.cerrar();
      recargar();
    });
  }
  function anular(ids) {
    U.formulario({ titulo: 'Anular ' + ids.length + ' operación(es)', boton: 'Anular', campos: U.campo('Motivo', '<input name="motivo" class="sx2-input" required maxlength="300">', 'Queda en la historia de cada operación. Lo anulado no cuenta en ninguna cifra.'),
      enviar: function (d) { return x_.api('finanzasAccionOperaciones', { accion: 'ANULAR', ids: ids, motivo: d.motivo, versiones: ids.reduce(function (a, id) { var o = opDe(id); if (o) a[id] = o.version; return a; }, {}) }).then(function (r) { if (r && r.ok && r.data.errores) return { ok: false, message: r.data.resultados.filter(function (y) { return !y.ok; })[0].mensaje }; return r; }); },
      listo: function () { if (est_.panel) est_.panel.cerrar(); recargar(); }, aviso: 'Operación(es) anulada(s).' });
  }
  function cambiarLote() {
    var ids = Object.keys(est_.sel).filter(function (k) { return est_.sel[k]; });
    U.formulario({ titulo: 'Cambiar ' + ids.length + ' fila(s)', boton: 'Revisar y aplicar',
      campos: '<p class="fin2-ayuda">Solo se cambia lo que completes. Se aplica únicamente a las filas marcadas con una sola parte; las demás se avisan.</p>' +
        U.campo('Cliente', '<input name="cliente" class="sx2-input" list="finr-clientes" placeholder="Sin cambio">') +
        U.campo('Naturaleza', '<select name="tipo" class="sx2-input">' + opciones(TIPOS_UI, '', 'Sin cambio') + '</select>') +
        U.campo('Concepto', '<input name="cuenta" class="sx2-input" placeholder="Sin cambio (debe calzar con la naturaleza)">') +
        U.campo('Período de la obligación', '<input name="periodo_obligacion" type="month" class="sx2-input">') + datalistClientes(),
      preparar: function (d) {
        var c = {};
        if (d.cliente) { var cl = clientePorTexto(d.cliente); if (cl.error) return cl.error; c.cliente_id = cl.id; }
        if (d.tipo) { var t = d.tipo.split(':'); c.tipo = t[0]; c.subtipo = t[1] || ''; }
        if (d.cuenta) c.cuenta = d.cuenta;
        if (d.periodo_obligacion) c.periodo_obligacion = d.periodo_obligacion;
        if (!Object.keys(c).length) return 'No elegiste ningún cambio.';
        return U.confirmar({ titulo: 'Aplicar a ' + ids.length + ' fila(s)', texto: 'Se cambiará ' + Object.keys(c).join(', ') + ' en las filas marcadas. Las filas confirmadas se vuelven a validar completas.', boton: 'Aplicar' })
          .then(function (si) { return si ? c : 'Cancelado.'; });
      },
      enviar: function (c) { return x_.api('finanzasAccionOperaciones', { accion: 'CAMBIAR', ids: ids, cambios: c, versiones: ids.reduce(function (a, id) { var o = opDe(id); if (o) a[id] = o.version; return a; }, {}) }); },
      aviso: function (r) { return r.data.hechos + ' cambiada(s)' + (r.data.errores ? ' · ' + r.data.errores + ' no (ver detalle)' : ''); }, listo: function () { recargar(); } });
  }
  /** Duplicar (I05.2): borrador nuevo con lo reutilizable; sin referencia, vínculos ni aplicaciones. */
  function duplicarEnServidor(id) {
    var o = opDe(id); if (!o) return;
    U.formulario({ titulo: 'Duplicar como borrador', boton: 'Duplicar', campos: U.campo('Fecha del nuevo borrador', '<input type="date" name="fecha" class="sx2-input" required value="' + txt(o.fecha || '') + '">', 'Se copian empresa, cuenta, monto, quién paga/recibe y sus partes. No se copia la referencia, ni el vínculo con el banco, ni aplicaciones.'),
      enviar: function (d) { return x_.api('finanzasDuplicarOperacion', { id: id, fecha: d.fecha, idempotency_key: uuid() }); },
      aviso: 'Borrador duplicado: revísalo y confírmalo.', listo: function () { recargar(true); } });
  }
  function desconciliar(id) {
    U.formulario({ titulo: 'Deshacer la conciliación', boton: 'Deshacer', campos: U.campo('Motivo', '<input name="motivo" class="sx2-input" required>', 'El movimiento del banco vuelve a «por revisar» y la operación a «falta el banco». Queda en la historia.'),
      enviar: function (d) { return x_.api('finanzasDesconciliar', { operacion_id: id, motivo: d.motivo }); }, aviso: 'Conciliación deshecha.', listo: function () { if (est_.panel) est_.panel.cerrar(); recargar(); } });
  }

  // ---- formulario guiado por acción (FIN-10) ----------------------------------------------
  function guiado() {
    var acciones = est_.datos.acciones || {};
    var d = U.drawer({ titulo: 'Formulario guiado', subtitulo: '<span class="fin2-ayuda">¿Qué pasó con el dinero?</span>',
      cuerpo: '<button type="button" class="fin2-accion fin2-accion--fuente js-finr-fuentes"><b>' + U.ico('enlace', 14) + ' Pagar una obligación que ya está en Control interno</b><small>IVA (F29) o imposiciones: el cliente, el concepto, el período y el monto esperado vienen de la matriz. Solo confirmas fecha y monto real.</small></button>' +
        '<div class="fin2-acciones-grid">' + Object.keys(acciones).map(function (k) {
        return '<button type="button" class="fin2-accion js-finr-accion" data-id="' + k + '"><b>' + txt(acciones[k].nombre) + '</b><small>' + txt(acciones[k].ayuda) + '</small></button>';
      }).join('') + '</div>' });
    d.el.classList.add('fin2-panel');
    d.el.addEventListener('click', function (ev) {
      if (ev.target.closest('.js-finr-fuentes')) { d.cerrar(true); fuentes(); return; }
      var b = ev.target.closest('.js-finr-accion'); if (!b) return;
      d.cerrar(true); formAccion(b.dataset.id);
    });
  }
  /** Obligaciones de Control interno del mes (I05.5): se elige una y se abre el pago precompletado. */
  function fuentes(periodo) {
    var per = periodo || (function () { var p = est_.periodo.split('-').map(Number); var m = p[1] - 1 || 12, a = p[1] - 1 ? p[0] : p[0] - 1; return a + '-' + String(m).padStart(2, '0'); })();
    var d = U.drawer({ titulo: 'Obligaciones en Control interno', subtitulo: '<span class="fin2-ayuda">Elige la que vas a pagar. Se puede pagar en varias partes.</span>', cuerpo: U.esqueleto('tabla', 5) });
    d.el.classList.add('fin2-panel', 'sx2-drawer--ancho');
    var cargar = function (p) {
      x_.api('finanzasFuentesObligacion', { periodo: p }).then(function (r) {
        if (!r || !r.ok) { d.cuerpo(U.vacio({ icono: 'alerta', titulo: 'No se pudo leer', texto: (r && r.message) || '' })); return; }
        var l = r.data.fuentes;
        d.cuerpo('<div class="fin2-p"><label class="fin2-campo fin2-campo--fila"><span>Mes de la obligación</span><input type="month" class="fin2-input fin2-input--sm js-fte-mes" value="' + txt(p) + '"></label>' +
          (r.data.bloqueo ? '<p class="fin2-error">' + txt(r.data.bloqueo) + '</p>' : '') +
          (l.length ? '<ul class="fin2-conc__lista">' + l.map(function (f, i) {
            return '<li><button type="button" class="fin2-conc__item fin2-fuente js-fte" data-i="' + i + '"><span class="fin2-num">' + txt(f.periodo_obligacion) + '</span><span class="fin2-conc__txt"><b>' + txt(f.cliente) + ' · ' + txt(f.matriz_nombre) + '</b><small>' + txt(f.destino) + (f.estado_ci ? ' · en Control interno: ' + txt(f.estado_ci) : '') + (f.operaciones.length ? ' · ya registrado ' + plata(f.registrado) + (f.borradores ? ' (+' + f.borradores + ' borrador)' : '') : '') + '</small></span>' +
              '<b class="fin2-num">' + (f.monto_esperado === null ? 'sin monto' : f.pendiente === 0 ? U.badge('Pagada', 'ok') : plata(f.pendiente)) + '</b></button></li>';
          }).join('') + '</ul>' : U.vacio({ icono: 'check', texto: 'No hay obligaciones de IVA ni de imposiciones en Control interno para ese mes.' })) +
          (r.data.sin_monto ? '<p class="fin2-ayuda">' + r.data.sin_monto + ' sin monto en la matriz: el monto se escribe al pagar.</p>' : '') + '</div>');
        d.el.querySelectorAll('.js-fte').forEach(function (b) { b.addEventListener('click', function () { d.cerrar(true); abrirFuente(l[Number(b.dataset.i)]); }); });
        var m = d.el.querySelector('.js-fte-mes'); if (m) m.addEventListener('change', function () { if (/^\d{4}-\d{2}$/.test(m.value)) cargar(m.value); });
      });
    };
    cargar(per);
  }
  function abrirFuente(f) {
    formAccion('PAGAR_OBLIGACION', { origen: { tipo: 'CONTROL_INTERNO', registro_id: f.fuente_id }, matriz_nombre: f.matriz_nombre, cliente: f.cliente, cliente_id: f.cliente_id,
      cuenta: f.concepto, periodo_obligacion: f.periodo_obligacion, destino: f.destino, tercero: f.destino, monto: f.pendiente || f.monto_esperado || 0, monto_esperado: f.monto_esperado, registrado: f.registrado });
  }
  function desdeFuenteId(id) {
    x_.api('finanzasFuenteObligacion', { id: id }).then(function (r) { if (r && r.ok) abrirFuente(r.data); else x_.aviso((r && r.message) || 'No se encontró la obligación.', 'error'); });
  }
  function formAccion(id, pre) {
    pre = pre || {};
    var a = est_.datos.acciones[id];
    var cliPre = pre.cliente_id ? cliente(pre.cliente_id) : null;
    var conCliente = ['COBRAR_HONORARIOS', 'RECIBIR_FONDOS', 'PAGAR_OBLIGACION', 'DEVOLVER_FONDOS', 'REINTEGRO'].indexOf(id) !== -1;
    var conObligacion = ['RECIBIR_FONDOS', 'PAGAR_OBLIGACION', 'DEVOLVER_FONDOS', 'REINTEGRO'].indexOf(id) !== -1;
    var cuentas = cuentasDeTipo(a.tipo);
    var cuentasBanco = (est_.cuentas || []);
    var clave = uuid(); // una por formulario: un reintento no repite el evento
    U.formulario({
      titulo: a.nombre, subtitulo: '<span class="fin2-ayuda">' + txt(a.ayuda) + '</span>', boton: 'Guardar', ancho: true,
      campos: '<div class="fin2-form-grid">' +
        (pre.origen ? '<div class="fin2-p-caja" style="grid-column:1/-1">' + U.ico('enlace', 16) + '<span>Desde Control interno: <b>' + txt(pre.matriz_nombre) + '</b> de ' + txt(pre.cliente) + ', ' + txt(pre.periodo_obligacion) + (pre.monto_esperado ? ' · esperado ' + plata(pre.monto_esperado) + (pre.registrado ? ', ya registrado ' + plata(pre.registrado) : '') : ' · sin monto en la matriz') + '. Confirma la fecha y el monto REAL del pago (puede ser parcial).</span></div>' : '') +
        U.campo('Empresa', '<select name="empresa" class="sx2-input" required>' + opciones((cat_.empresas || []).map(function (e) { return [e, e]; }), est_.empresa || est_.empresaNueva || '', 'Elige…') + '</select>', est_.empresa ? '' : 'Estás viendo todas: elige de qué empresa es.') +
        U.campo('Cuenta del banco', '<select name="cuenta_ref" class="sx2-input">' + opciones(cuentasBanco.map(function (c) { return [c.id, c.banco + ' ···' + c.ultimos4 + ' · ' + c.empresa]; }), cuentaReal(), 'Sin cuenta (efectivo…)') + '</select>') +
        U.campo('Fecha', '<input name="fecha" type="date" class="sx2-input" required value="' + txt(est_.periodo === hoyIso().slice(0, 7) ? hoyIso() : est_.periodo + '-01') + '">') +
        U.campo('Monto', '<input name="monto" class="sx2-input" inputmode="numeric" required placeholder="$" value="' + (pre.monto ? miles(pre.monto) : '') + '">') +
        U.campo('Medio', '<select name="medio" class="sx2-input">' + opciones((cat_.medios || []).map(function (m) { return [m.id, m.nombre]; }), 'TRANSFERENCIA') + '</select>') +
        (conCliente ? U.campo('Cliente', '<input name="cliente" class="sx2-input" list="finr-clientes" required placeholder="Nombre, RUT o alias" value="' + txt(cliPre ? cliPre.nombre + ' · ' + cliPre.rut : '') + '">', id === 'COBRAR_HONORARIOS' ? 'El pagador puede ser distinto del cliente.' : 'Este dinero se administra por cuenta del cliente.') : '') +
        U.campo('Quién paga / recibe', '<input name="tercero" class="sx2-input" placeholder="Como aparece en el banco" value="' + txt(pre.tercero || '') + '">') +
        (cuentas.length ? U.campo(conObligacion ? 'Obligación' : 'Concepto', '<select name="cuenta" class="sx2-input" required>' + opciones(cuentas, pre.cuenta || a.cuenta || '', 'Elige…') + '</select>') : '') +
        (conObligacion ? U.campo('Período de la obligación', '<input name="periodo_obligacion" type="month" class="sx2-input" value="' + txt(pre.periodo_obligacion || '') + '">', 'La obligación puede corresponder a un mes anterior.') + U.campo('Destino', '<input name="destino" class="sx2-input" placeholder="Obra, trabajador…" value="' + txt(pre.destino || '') + '">') : '') +
        (a.tipo === 'PRESTAMO' ? U.campo('Con qué empresa del grupo', '<select name="empresa_contraparte" class="sx2-input" required>' + opciones((cat_.empresas || []).map(function (e) { return [e, e]; }), '', 'Elige…') + '</select>') : '') +
        U.campo('Referencia / N° doc.', '<input name="referencia" class="sx2-input">') +
        U.campo('Nota', '<input name="nota" class="sx2-input" maxlength="500">') +
        '<label class="sx2-campo fin2-check"><input type="checkbox" name="confirmar" value="1" data-cap="CONFIRMAR"><span>Confirmar ahora (si no, queda como borrador)</span></label>' +
      '</div>' + datalistClientes(),
      preparar: function (d) {
        var cli = conCliente ? clientePorTexto(d.cliente) : { id: '' };
        if (cli.error) return cli.error;
        if (!d.empresa) return 'Elige la empresa.';
        if (!est_.empresa) est_.empresaNueva = d.empresa;
        return Object.assign({}, d, { accion: id, tipo: a.tipo, subtipo: a.subtipo || '', sentido: a.sentido, cliente_id: cli.id, confirmar: d.confirmar === '1', idempotency_key: clave, cliente: undefined, origen: pre.origen || undefined });
      },
      enviar: function (d) { return x_.api('finanzasGuardarOperacion', d); },
      aviso: function (r) { if (r.data.coincidencias_banco && r.data.coincidencias_banco.length) return 'Guardada. Ojo: hay un movimiento del banco ya clasificado igual; ábrela en el registro para vincularlos o marcar que son distintos.'; return r.data.estado === 'CONFIRMADA' ? 'Operación confirmada.' : 'Guardada como borrador' + (r.data.faltantes && r.data.faltantes.length ? ' (le falta: ' + r.data.faltantes[0].mensaje + ')' : '') + '.'; },
      listo: function () { recargar(); }
    });
  }

  // ---- pegar desde Excel (FIN-11) -----------------------------------------------------------
  var peg_ = null;
  function adivinar(cab) {
    var n = String(cab || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (/FECHA/.test(n)) return 'fecha';
    if (/CLIENTE|RUT|RAZON/.test(n)) return 'cliente';
    if (/TIPO|NATURALEZA/.test(n)) return 'tipo';
    if (/CONCEPTO|CUENTA|PLAN/.test(n)) return 'concepto';
    if (/ENTRADA|INGRESO|ABONO/.test(n)) return 'entrada';
    if (/SALIDA|EGRESO|CARGO/.test(n)) return 'salida';
    if (/MONTO|TOTAL|VALOR/.test(n)) return 'monto';
    if (/REFER|DOC/.test(n)) return 'referencia';
    if (/DESTINO|OBRA/.test(n)) return 'destino';
    if (/PERIODO|MES/.test(n)) return 'periodo_obligacion';
    if (/DETALLE|GLOSA|PAGADOR|TERCERO|QUIEN/.test(n)) return 'tercero';
    if (/EMPRESA/.test(n)) return 'empresa';
    if (/MEDIO/.test(n)) return 'medio';
    if (/NOTA|OBS/.test(n)) return 'nota';
    return 'ignorar';
  }
  function pegar() {
    x_.api('finanzasPerfiles').then(function (r) {
      var perf = r && r.ok ? r.data : { mapeos: [], campos: {} };
      // Empresa y cuenta de lo pegado: las del contexto o, si está en «Todas», la primera (se puede cambiar aquí).
      peg_ = { perf: perf, filas: [], titulos: false, mapeo: {}, rev: null, sel: {}, empresa: est_.empresa || ((cat_ && cat_.empresas) || [])[0] || '', cuenta: cuentaReal() };
      var d = U.drawer({ titulo: 'Pegar desde Excel', subtitulo: '<span class="fin2-ayuda">Copia las filas en Excel y pégalas aquí. Nada se publica sin revisar.</span>',
        cuerpo: '<div class="js-finr-peg"><textarea class="fin2-input fin2-pegar js-finr-peg-txt" rows="7" placeholder="Pega aquí (Ctrl+V)…" aria-label="Filas pegadas"></textarea>' +
          '<div class="fin2-acciones" style="justify-content:flex-start;align-items:center;flex-wrap:wrap">' +
            '<label class="fin2-campo fin2-campo--fila"><span>Empresa</span><select class="fin2-input fin2-input--sm js-finr-peg-emp">' + opciones(((cat_ && cat_.empresas) || []).map(function (e) { return [e, e]; }), peg_.empresa) + '</select></label>' +
            '<label class="fin2-campo fin2-campo--fila"><span>Cuenta</span><select class="fin2-input fin2-input--sm js-finr-peg-cta">' + opciones((est_.cuentas || []).filter(function (c) { return c.empresa === peg_.empresa; }).map(function (c) { return [c.id, c.banco + ' ···' + c.ultimos4]; }), peg_.cuenta, 'Sin cuenta') + '</select></label>' +
            '<label class="fin2-check"><input type="checkbox" class="js-finr-peg-tit"> La primera fila trae los títulos</label>' +
          (perf.mapeos.length ? '<select class="fin2-input fin2-input--sm js-finr-peg-perfil">' + opciones(perf.mapeos.map(function (m) { return [m.id, m.nombre]; }), '', 'Usar un mapeo guardado…') + '</select>' : '') + '</div>' +
          '<div class="js-finr-peg-mapa"></div><div class="js-finr-peg-rev"></div></div>',
        pie: '<span style="flex:1"></span>' + U.boton({ texto: 'Revisar', icono: 'lupa', clase: 'js-finr-peg-revisar' }) +
          U.boton({ texto: 'Publicar como borrador', icono: 'check', clase: 'js-finr-peg-pub', datos: { como: 'BORRADOR' } }) +
          U.boton({ texto: 'Publicar y confirmar', icono: 'check', variante: 'primario', clase: 'js-finr-peg-pub', datos: { como: 'CONFIRMAR', cap: 'CONFIRMAR' } }) });
      d.el.classList.add('fin2-panel', 'sx2-drawer--ancho');
      est_.pegado = d;
      x_.aplicarCapacidades(d.el);
      enlazarPegado(d.el);
    });
  }
  function partirTsv(t) {
    return String(t || '').replace(/\r/g, '').split('\n').filter(function (l) { return l.trim(); }).map(function (l) { return l.split('\t').map(function (c) { return c.trim(); }); });
  }
  function pintarMapa(el) {
    var cont = el.querySelector('.js-finr-peg-mapa');
    if (!peg_.filas.length) { cont.innerHTML = ''; return; }
    var n = Math.max.apply(null, peg_.filas.map(function (f) { return f.length; }));
    var campos = peg_.perf.campos || {};
    var cab = peg_.titulos ? peg_.filas[0] : null;
    cont.innerHTML = '<h3 class="fin2-p-sec__t">¿Qué trae cada columna?</h3><div class="fin2-mapa">' + Array.from({ length: n }, function (_, i) {
      var m = peg_.mapeo[i] || (cab ? adivinar(cab[i]) : 'ignorar');
      peg_.mapeo[i] = m;
      return '<label class="fin2-campo"><span>Columna ' + (i + 1) + (cab ? ': ' + txt(cab[i]) : '') + '</span><select class="fin2-input fin2-input--sm js-finr-peg-col" data-i="' + i + '">' +
        opciones(Object.keys(campos).map(function (k) { return [k, campos[k]]; }), m) + '</select><small class="fin2-ayuda">' + txt((peg_.filas[cab ? 1 : 0] || [])[i] || '') + '</small></label>';
    }).join('') + '</div><div class="fin2-acciones" style="justify-content:flex-start">' + U.boton({ texto: 'Guardar este mapeo', icono: 'copiar', sm: true, variante: 'fantasma', clase: 'js-finr-peg-guardar-mapa' }) + '</div>';
  }
  function revisarPegado(el) {
    var filas = peg_.titulos ? peg_.filas.slice(1) : peg_.filas;
    if (!filas.length) { x_.aviso('Pega al menos una fila.', 'alerta'); return Promise.resolve(); }
    var req = { filas: filas, mapeo: peg_.mapeo, empresa: peg_.empresa, cuenta_ref: peg_.cuenta };
    return x_.api('finanzasRevisarPegado', req).then(function (r) {
      var cont = el.querySelector('.js-finr-peg-rev');
      if (!r || !r.ok) { cont.innerHTML = '<p class="fin2-error">' + txt((r && r.message) || 'No se pudo revisar.') + '</p>'; return; }
      peg_.rev = r.data; peg_.req = req; peg_.sel = {};
      r.data.revision.forEach(function (x) { if (!Object.keys(x.errores).length) peg_.sel[x.fila] = true; });
      var cols = Object.keys(peg_.mapeo).filter(function (k) { return peg_.mapeo[k] !== 'ignorar'; });
      cont.innerHTML = '<div class="fin2-cinta fin2-cinta--info">' + U.ico('info', 16) + '<span><b>' + r.data.validas + ' de ' + r.data.filas + ' filas listas.</b> Entradas ' + plata(r.data.totales.entradas) + ' · salidas ' + plata(r.data.totales.salidas) +
        (r.data.con_errores ? ' · ' + r.data.con_errores + ' con errores: corrige la celda marcada aquí mismo (se revisa de nuevo sola) o deja la fila sin marcar' : '') + '.</span></div>' +
        '<div class="fin2-tabla-envoltura"><table class="fin2-tabla fin2-peg-tabla"><thead><tr><th></th><th>Resultado</th>' + cols.map(function (k) { return '<th>' + txt((peg_.perf.campos || {})[peg_.mapeo[k]]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        r.data.revision.map(function (x) {
          var ok = !Object.keys(x.errores).length;
          return '<tr class="' + (ok ? '' : 'fin2-peg-mala') + '"><td><input type="checkbox" class="js-finr-peg-sel" data-f="' + x.fila + '"' + (ok ? ' checked' : ' disabled') + ' aria-label="Publicar fila ' + (x.fila + 1) + '"></td>' + resultado(x, ok) +
            cols.map(function (k) {
              var campo = peg_.mapeo[k]; var e = x.errores[campo === 'concepto' ? 'concepto' : campo]; var v = (peg_.req.filas[x.fila] || [])[k] || '';
              // I14 (QA-R15): la celda con error se corrige aquí; el original pegado cambia solo en esta revisión.
              return e ? '<td class="fin2-celda-mala" title="' + txt(e) + '"><input class="fin2-input fin2-input--sm js-finr-peg-fix" data-f="' + x.fila + '" data-k="' + k + '" value="' + txt(v) + '" aria-label="Corregir: ' + txt(e) + '"></td>' : '<td>' + txt(v) + '</td>';
            }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>';
    });
  }
  function resultado(x, ok) {
    return '<td class="fin2-peg-res">' + (ok ? (x.repetida_en_pegado !== null ? U.badge('Igual a la fila ' + (x.repetida_en_pegado + 1), 'alerta') : x.posibles_duplicados.length ? U.badge('Ya hay una igual registrada', 'alerta') : U.badge('Lista' + (x.cliente ? ' · ' + x.cliente : ''), 'ok'))
      : '<span class="fin2-neg">' + txt(Object.values(x.errores).join(' · ')) + '</span>') + '</td>';
  }
  function publicarPegado(el, como) {
    if (!peg_ || !peg_.rev) { x_.aviso('Primero revisa lo pegado.', 'alerta'); return; }
    var sel = Object.keys(peg_.sel).filter(function (k) { return peg_.sel[k]; }).map(Number);
    if (!sel.length) { x_.aviso('No hay filas marcadas para publicar.', 'alerta'); return; }
    U.confirmar({ titulo: 'Publicar ' + sel.length + ' fila(s)', texto: como === 'CONFIRMAR' ? 'Se registrarán y confirmarán. Lo confirmado cuenta en las cifras del mes.' : 'Se registrarán como borradores: no cuentan hasta confirmarlos.', boton: 'Publicar' }).then(function (si) {
      if (!si) return;
      x_.api('finanzasPublicarPegado', Object.assign({}, peg_.req, { token: peg_.rev.token, seleccion: sel, como: como })).then(function (r) {
        if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo publicar.', 'error'); if (r && r.codigo === 'CONFLICTO_VERSION') revisarPegado(el); return; }
        x_.aviso(r.data.publicadas + ' publicada(s)' + (r.data.repetidas ? ' · ' + r.data.repetidas + ' ya estaban' : '') + (r.data.errores ? ' · ' + r.data.errores + ' con error' : ''), r.data.errores ? 'alerta' : 'exito');
        if (est_.pegado) est_.pegado.cerrar();
        recargar();
      });
    });
  }
  function enlazarPegado(el) {
    el.addEventListener('input', function (ev) {
      if (ev.target.classList.contains('js-finr-peg-txt')) { peg_.filas = partirTsv(ev.target.value); peg_.rev = null; el.querySelector('.js-finr-peg-rev').innerHTML = ''; pintarMapa(el); }
    });
    el.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.classList.contains('js-finr-peg-tit')) { peg_.titulos = t.checked; peg_.mapeo = {}; pintarMapa(el); }
      else if (t.classList.contains('js-finr-peg-col')) { peg_.mapeo[t.dataset.i] = t.value; peg_.rev = null; }
      else if (t.classList.contains('js-finr-peg-emp')) {
        peg_.empresa = t.value; peg_.cuenta = ''; peg_.rev = null;
        el.querySelector('.js-finr-peg-cta').innerHTML = opciones((est_.cuentas || []).filter(function (c) { return c.empresa === peg_.empresa; }).map(function (c) { return [c.id, c.banco + ' ···' + c.ultimos4]; }), '', 'Sin cuenta');
        if (peg_.filas.length) revisarPegado(el);
      }
      else if (t.classList.contains('js-finr-peg-cta')) { peg_.cuenta = t.value; peg_.rev = null; if (peg_.filas.length) revisarPegado(el); }
      else if (t.classList.contains('js-finr-peg-sel')) peg_.sel[t.dataset.f] = t.checked;
      else if (t.classList.contains('js-finr-peg-fix')) {
        var fila = Number(t.dataset.f) + (peg_.titulos ? 1 : 0);
        if (peg_.filas[fila]) peg_.filas[fila][Number(t.dataset.k)] = t.value;
        var ta = el.querySelector('.js-finr-peg-txt'); if (ta) ta.value = peg_.filas.map(function (f) { return f.join('\t'); }).join('\n');
        peg_.rev = null; revisarPegado(el);
      }
      else if (t.classList.contains('js-finr-peg-perfil')) {
        var m = peg_.perf.mapeos.filter(function (y) { return y.id === t.value; })[0];
        if (m) {
          peg_.titulos = !!m.primera_fila_titulos; el.querySelector('.js-finr-peg-tit').checked = peg_.titulos;
          // I07.2: si el encabezado del archivo no es el que el perfil conoce, NO se aplican posiciones viejas:
          // se mapea por nombre de columna lo que calce y se avisa qué cambió.
          var cab = peg_.titulos && peg_.filas[0] ? peg_.filas[0].map(function (c) { return String(c).trim().toUpperCase(); }) : null;
          var conocido = (m.encabezado || []).map(function (c) { return String(c).trim().toUpperCase(); });
          if (cab && conocido.length && cab.join('|') !== conocido.join('|')) {
            peg_.mapeo = {};
            cab.forEach(function (c, i) { var j = conocido.indexOf(c); if (j !== -1 && m.mapeo[j]) peg_.mapeo[i] = m.mapeo[j]; });
            x_.aviso('El encabezado cambió desde que se guardó «' + m.nombre + '» (v' + (m.version || 1) + '): se usaron solo las columnas con el mismo nombre. Revisa el resto.', 'alerta');
          } else peg_.mapeo = Object.assign({}, m.mapeo);
          pintarMapa(el);
        }
      }
    });
    el.addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      if (b.classList.contains('js-finr-peg-revisar')) revisarPegado(el);
      else if (b.classList.contains('js-finr-peg-pub')) publicarPegado(el, b.dataset.como);
      else if (b.classList.contains('js-finr-peg-guardar-mapa')) {
        var nombre = window.prompt ? window.prompt('Nombre del mapeo (p. ej. «Excel BANCOS julio»)') : '';
        if (nombre) x_.api('finanzasGuardarPerfil', { tipo: 'MAPEO', nombre: nombre, mapeo: peg_.mapeo, primera_fila_titulos: peg_.titulos, encabezado: peg_.titulos ? peg_.filas[0] : [], ejemplo: peg_.filas[peg_.titulos ? 1 : 0] || [] }).then(function (r) { x_.aviso(r && r.ok ? 'Mapeo guardado.' : (r && r.message) || 'No se pudo.', r && r.ok ? 'exito' : 'error'); });
      }
    });
  }

  // ---- plantillas (FIN-12) -----------------------------------------------------------------
  function plantillas() {
    x_.api('finanzasPerfiles').then(function (r) {
      var pl = r && r.ok ? r.data.plantillas : [];
      var d = U.drawer({ titulo: 'Plantillas recurrentes', subtitulo: '<span class="fin2-ayuda">Crean BORRADORES del mes; alguien revisa el monto real y confirma. Nunca pagos ficticios.</span>',
        cuerpo: pl.length ? '<ul class="fin2-plantillas">' + pl.map(function (p) {
          var o = p.operacion || {};
          return '<li><label class="fin2-check"><input type="checkbox" class="js-finr-pl" value="' + txt(p.id) + '" checked> <b>' + txt(p.nombre) + '</b></label><span class="fin2-ayuda">Día ' + p.dia + ' · ' + txt(o.sentido === 'ENTRADA' ? 'entra' : 'sale') + ' ' + (o.monto ? plata(montoDe(o.monto)) : 'monto a completar') + ' · ' + txt(tipoNombre(o.tipo, o.subtipo)) + (o.cuenta ? ' · ' + txt(o.cuenta) : '') + '</span>' +
            U.boton({ texto: 'Quitar', sm: true, variante: 'fantasma', clase: 'js-finr-pl-quitar', datos: { id: p.id, nombre: p.nombre } }) + '</li>';
        }).join('') + '</ul><div class="js-finr-pl-prev"></div>' : U.vacio({ icono: 'copiar', titulo: 'Sin plantillas', texto: 'Abre una operación (arriendo, internet, sueldos…) y elige «Guardar como plantilla».' }),
        pie: '<span style="flex:1"></span>' + U.boton({ texto: 'Ver qué se crea en ' + est_.periodo, icono: 'lupa', variante: 'primario', clase: 'js-finr-pl-generar', deshabilitado: !pl.length }) });
      d.el.addEventListener('change', function (ev) { if (ev.target.classList.contains('js-finr-pl')) { var g = d.el.querySelector('.js-finr-pl-generar'); delete g.dataset.visto; g.disabled = false; g.lastChild.textContent = 'Ver qué se crea en ' + est_.periodo; d.el.querySelector('.js-finr-pl-prev').innerHTML = ''; } });
      d.el.classList.add('fin2-panel');
      d.el.addEventListener('click', function (ev) {
        var b = ev.target.closest('button'); if (!b) return;
        if (b.classList.contains('js-finr-pl-generar')) {
          var ids = Array.prototype.map.call(d.el.querySelectorAll('.js-finr-pl:checked'), function (i) { return i.value; });
          if (!b.dataset.visto) {
            // Primero la vista previa: qué se crea, qué ya existe y en qué difiere (nada se sobrescribe).
            x_.api('finanzasPrevisualizarPlantillas', { periodo: est_.periodo, ids: ids }).then(function (pv) {
              if (!pv || !pv.ok) { x_.aviso((pv && pv.message) || 'No se pudo.', 'error'); return; }
              var v = pv.data, z = d.el.querySelector('.js-finr-pl-prev');
              z.innerHTML = '<h3 class="fin2-p-sec__t">' + txt(est_.periodo) + ': ' + v.crear + ' nuevo(s) · ' + v.existen + ' ya existen</h3><ul class="fin2-hist">' + v.instancias.map(function (i) {
                return '<li>' + (i.existe ? U.badge('Ya existe · ' + (i.existe.estado === 'CONFIRMADA' ? 'confirmada' : 'borrador'), 'neutro') : U.badge('Se crea', 'info')) + ' <b>' + txt(i.nombre) + '</b> · ' + txt(i.fecha) + ' · ' + (i.monto ? plata(i.monto) : 'monto a completar') +
                  (i.existe && i.existe.diferencias.length ? '<br><small class="fin2-ayuda">Difiere de la plantilla actual: ' + txt(i.existe.diferencias.join(' · ')) + ' (no se cambia: edítalo si corresponde).</small>' : '') + '</li>';
              }).join('') + '</ul>';
              b.dataset.visto = '1'; b.lastChild.textContent = v.crear ? 'Crear ' + v.crear + ' borrador(es)' : 'Nada nuevo que crear'; b.disabled = !v.crear;
            });
            return;
          }
          x_.api('finanzasGenerarPlantillas', { periodo: est_.periodo, ids: ids }).then(function (rr) {
            if (!rr || !rr.ok) { x_.aviso((rr && rr.message) || 'No se pudo.', 'error'); return; }
            var nuevas = rr.data.resultados.filter(function (y) { return y.id; }).length, rep = rr.data.resultados.filter(function (y) { return y.repetida; }).length;
            x_.aviso(nuevas + ' borrador(es) creados' + (rep ? ' · ' + rep + ' ya existían este mes' : ''), 'exito'); d.cerrar(); recargar();
          });
        } else if (b.classList.contains('js-finr-pl-quitar')) {
          x_.api('finanzasGuardarPerfil', { tipo: 'PLANTILLA', id: b.dataset.id, nombre: b.dataset.nombre, activo: false, dia: 1, operacion: {} }).then(function () { d.cerrar(); plantillas(); });
        }
      });
    });
  }
  function guardarPlantilla(op) {
    U.formulario({ titulo: 'Guardar como plantilla', boton: 'Guardar plantilla',
      campos: U.campo('Nombre', '<input name="nombre" class="sx2-input" required placeholder="Arriendo oficina">') + U.campo('Día del mes', '<input name="dia" type="number" min="1" max="31" class="sx2-input" required value="' + Number(String(op.fecha || '').slice(8, 10) || 1) + '">') +
        '<label class="sx2-campo fin2-check"><input type="checkbox" name="sin_monto" value="1"><span>Sin monto fijo (se completa cada mes)</span></label>',
      enviar: function (d) {
        var o = Object.assign({}, op, { monto: d.sin_monto ? '' : op.monto }); delete o.fecha;
        var dist = (op.distribuciones || [])[0] || {};
        o.tipo = dist.tipo; o.subtipo = dist.subtipo; o.cuenta = dist.cuenta; o.cliente_id = dist.cliente_id; o.destino = dist.destino; delete o.distribuciones;
        return x_.api('finanzasGuardarPerfil', { tipo: 'PLANTILLA', nombre: d.nombre, dia: d.dia, operacion: o });
      }, aviso: 'Plantilla guardada.' });
  }

  // =====================================================================================
  var enlazado_ = false;
  function enlazar() {
    var raiz = x_.raiz();
    if (enlazado_ || !raiz) return;
    enlazado_ = true;
    // I05.2: salir con una fila editada sin guardar avisa (el navegador pide confirmar); al volver no hay nada a medias en el equipo.
    window.addEventListener('beforeunload', function (ev) {
      if (document.querySelector('.fin2-reg__fila[data-sucio]')) { ev.preventDefault(); ev.returnValue = ''; }
    });
    raiz.addEventListener('change', function (ev) {
      var t = ev.target;
      if (!t.closest || !t.closest('.fin2-ctx, .fin2-reg, .fin2-reg__cab')) return;
      if (t.classList.contains('js-finr-empresa')) { est_.empresa = t.value; est_.empresaNueva = ''; est_.cuenta = ''; x_.contexto({ empresa: t.value, cuenta_ref: '' }); ver(x_); }
      else if (t.classList.contains('js-finr-cuenta')) { est_.cuenta = t.value; x_.contexto({ cuenta_ref: t.value === SIN_CUENTA ? '' : t.value }); ver(x_); }
      else if (t.classList.contains('js-finr-mes')) { if (/^\d{4}-\d{2}$/.test(t.value)) { est_.periodo = t.value; x_.contexto({ periodo: t.value }); ver(x_); } }
      else if (t.classList.contains('js-finr-chk')) { est_.sel[t.closest('.fin2-reg__fila').dataset.id] = t.checked; pintar(); }
      else if (t.classList.contains('js-finr-todas')) { visibles().forEach(function (o) { est_.sel[o.id] = t.checked; }); pintar(); }
      else if (t.classList.contains('js-finr-c')) {
        var f = t.closest('.fin2-reg__fila'); f.dataset.sucio = '1';
        if (t.dataset.campo === 'tipo') {
          var b = t.value.split(':')[0]; var sel = f.querySelector('[data-campo="cuenta"]'); var cs = cuentasDeTipo(b);
          sel.innerHTML = opciones(cs, cs.length === 1 ? cs[0] : '', cs.length ? 'Concepto' : '—');
        }
      }
    });
    raiz.addEventListener('input', function (ev) {
      var t = ev.target;
      if (t.classList.contains('js-finr-busca')) { clearTimeout(est_.bt); var v = t.value; est_.bt = setTimeout(function () { est_.busca = v; pintar(); var b = document.querySelector('.js-finr-busca'); if (b) { b.focus(); b.setSelectionRange(v.length, v.length); } }, 200); }
      else if (t.classList.contains('js-finr-c')) t.closest('.fin2-reg__fila').dataset.sucio = '1';
    });
    // Al salir de una fila en edición (el foco ya no está dentro), se guarda como borrador.
    raiz.addEventListener('focusout', function (ev) {
      var f = ev.target.closest && ev.target.closest('.fin2-reg__fila--edit');
      if (!f) return;
      if (ev.target.dataset && (ev.target.dataset.campo === 'entrada' || ev.target.dataset.campo === 'salida')) { var n = montoDe(ev.target.value); ev.target.value = n ? miles(n) : ''; }
      setTimeout(function () { if (f.isConnected && !f.contains(document.activeElement)) guardarFila(f); }, 0);
    });
    raiz.addEventListener('keydown', function (ev) {
      var t = ev.target;
      if (ev.altKey && (ev.key === 'n' || ev.key === 'N') && raiz.querySelector('.fin2-reg')) { ev.preventDefault(); nuevaFila(); return; }
      var f = t.closest && t.closest('.fin2-reg__fila');
      if (!f) return;
      if (f.classList.contains('fin2-reg__fila--edit')) {
        if (ev.key === 'Enter' && t.tagName !== 'BUTTON') {
          ev.preventDefault();
          var campo = t.dataset.campo, sig = f.nextElementSibling;
          guardarFila(f, campo).then(function () {
            var s = sig && sig.querySelector('[data-campo="' + campo + '"]');
            if (s) s.focus();
          });
        } else if (ev.key === 'Escape') { ev.preventDefault(); delete f.dataset.sucio; if (est_.nuevas[f.dataset.id]) { est_.datos.operaciones = est_.datos.operaciones.filter(function (o) { return o.id !== f.dataset.id; }); delete est_.nuevas[f.dataset.id]; } pintar(); }
        else if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'd' || ev.key === 'D')) {
          ev.preventDefault();
          var l = leerFilaEditada(f).datos;
          nuevaFila({ fecha: l.fecha, tercero: l.tercero, sentido: l.sentido, monto: l.monto || 0, distribuciones: [{ tipo: l.tipo, subtipo: l.subtipo, cuenta: l.cuenta, cliente_id: l.cliente_id }] });
        }
      } else if (ev.key === 'Enter') { ev.preventDefault(); abrirPanel(f.dataset.id); }
      else if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'd' || ev.key === 'D')) { ev.preventDefault(); duplicarEnServidor(f.dataset.id); }
      else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); var o = ev.key === 'ArrowDown' ? f.nextElementSibling : f.previousElementSibling; if (o && o.classList.contains('fin2-reg__fila')) o.focus(); }
    });
    raiz.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) {
        var fila_ = ev.target.closest('.fin2-reg__fila');
        if (fila_ && !fila_.classList.contains('fin2-reg__fila--edit') && !ev.target.closest('input')) abrirPanel(fila_.dataset.id);
        return;
      }
      if (!raiz.querySelector('.fin2-reg')) return;
      if (b.classList.contains('js-finr-orden')) { var cmp = b.dataset.orden; est_.dir = est_.orden === cmp && est_.dir !== 'desc' ? 'desc' : 'asc'; est_.orden = cmp; recargar(true); return; }
      if (b.classList.contains('js-finr-filtro') && b.dataset.id) { est_.filtro = b.dataset.id; x_.contexto({ filtro_registro: b.dataset.id }); if (b.dataset.id === 'anuladas') ver(x_); else pintar(); }
      else if (b.classList.contains('js-finr-nueva')) nuevaFila();
      else if (b.classList.contains('js-finr-rescate-si')) { b.disabled = true; guardarRescate(); }
      else if (b.classList.contains('js-finr-rescate-no')) { rescate_ = []; pintar(); }
      else if (b.classList.contains('js-finr-densidad')) {
        var dn = cambiarDensidad(), reg = x_.raiz().querySelector('.fin2-reg');
        if (reg) reg.classList.toggle('fin2-reg--compacta', dn === 'compacta');
        b.setAttribute('aria-pressed', dn === 'compacta');
      }
      else if (b.classList.contains('js-finr-guiado')) guiado();
      else if (b.classList.contains('js-finr-pegar')) pegar();
      else if (b.classList.contains('js-finr-plantillas')) plantillas();
      else if (b.classList.contains('js-finr-abrir')) abrirPanel(b.closest('.fin2-reg__fila').dataset.id);
      else if (b.classList.contains('js-finr-lote')) {
        var acc = b.dataset.accion, n = Object.keys(est_.sel).filter(function (k) { return est_.sel[k]; }).length;
        U.confirmar({ titulo: (acc === 'CONFIRMAR' ? 'Confirmar ' : 'Descartar ') + n + ' fila(s)', texto: acc === 'CONFIRMAR' ? 'Cada una se valida completa; las que tengan algo pendiente quedan como estaban y se avisa por qué.' : 'Solo se descartan borradores que nunca se confirmaron; lo demás se mantiene.', boton: acc === 'CONFIRMAR' ? 'Confirmar' : 'Descartar', peligro: acc !== 'CONFIRMAR' })
          .then(function (si) { if (si) lote(acc); });
      }
      else if (b.classList.contains('js-finr-anular')) anular(Object.keys(est_.sel).filter(function (k) { return est_.sel[k]; }));
      else if (b.classList.contains('js-finr-cambiar')) cambiarLote();
      else if (b.classList.contains('js-finr-duplicar')) duplicarEnServidor(Object.keys(est_.sel).filter(function (k) { return est_.sel[k]; })[0]);
    });
  }

  window.SigsoFinanzasRegistro = { ver: ver };
})();
