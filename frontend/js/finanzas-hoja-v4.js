/**
 * finanzas-hoja-v4.js — La planilla del banco (Finanzas v4, 22-10-2026; backend/logica/finanzasHoja.js).
 *
 * Se llena como el Excel BANCOS: una hoja por cuenta y mes, celdas que se escriben con el teclado
 * (Enter, Tab, flechas, Supr) y filas que se pegan desde Excel. Columnas: fecha, nombre, OBS, plan de
 * cuenta, monto (+ entra / − sale), grupo (la letra reemplaza la fórmula de UNITARIO) y N° de factura.
 * Lo que trae la cartola y nadie anotó aparece en naranjo dentro de la misma hoja.
 *
 * Arriba, el resumen como en el Excel (ABONO, ABONO RENTA, gastos, SALDO, PENDIENTE, TOTAL) y el banco.
 * Además, tres reportes que salen solos de la hoja: FLUJO (como SIGECO), saldo por cliente y cobranza.
 */
(function () {
  'use strict';

  var U = UIv2;
  var x_ = null, cat_ = null;
  var est_ = { periodo: '', cuenta: '', datos: null, sel: { r: 0, c: 1 }, editando: null, borrador: {}, filtro: 'todas', busca: '', extras: [], temporales: [], guardados: [], ultimaFecha: '', mensaje: null };
  document.addEventListener('sigso-fin-cerrada', function () { est_.datos = null; est_.borrador = {}; est_.temporales = []; est_.oferta = null; cerrarAc(); cerrarMeses(); cerrarAyudaCol(); });

  var COLS = [['fecha', 'Fecha'], ['nombre', 'Nombre'], ['obs', 'OBS'], ['plan', 'Plan de cuenta'], ['monto', 'Monto'], ['grupo', 'Grupo'], ['fact', 'N° factura'], ['glosa', 'Detalle banco']];
  var ATAJO_OBS = { A: 'ABONO', R: 'ABONO RENTA', I: 'IVA', M: 'IMPOSICIONES', S: 'SALDO', P: 'PENDIENTE' };
  var AYUDA_OBS = { ABONO: 'honorario si entra · gasto si sale', 'ABONO RENTA': 'honorario de renta', IVA: 'dinero del cliente para su IVA', IMPOSICIONES: 'dinero del cliente para imposiciones', SALDO: 'dinero del cliente a su favor', PENDIENTE: 'dinero del cliente por resolver' };
  // Ayuda de cada columna (el «?» de la cabecera): qué va, cómo se escribe y un ejemplo, en palabras simples.
  var AYUDA_COL = {
    fecha: { t: 'Fecha', que: 'El día en que pasó el dinero.', como: ['Escribe solo el día (12) o día y mes (12-09).', 'Si el banco lo registró un día después, igual se une: se aceptan 3 días hábiles de diferencia.'] },
    nombre: { t: 'Nombre', que: 'Quién mandó el dinero o a quién se le pagó.', como: ['El cliente, o el gasto: ARRIENDO, SUELDO, CAJA CHICA…', 'Escríbelo siempre igual para el mismo cliente: al escribir, SIGSO te ofrece los nombres ya usados.'] },
    obs: { t: 'OBS · de quién es el dinero', que: 'Dice si el dinero es de la empresa o del cliente. Es lo más importante de la fila.', como: ['<b>ABONO</b>: de la empresa. Si entra es un honorario; si sale, un gasto.', '<b>ABONO RENTA</b>: honorario de renta.', '<b>IVA</b> / <b>IMPOSICIONES</b>: dinero que el cliente manda para pagar su IVA o sus imposiciones.', '<b>SALDO</b>: dinero del cliente que queda a su favor.', '<b>PENDIENTE</b>: dinero del cliente que todavía no se sabe qué es.', 'Atajo: escribe una letra (A, R, I, M, S o P).'] },
    plan: { t: 'Plan de cuenta', que: 'En qué se gastó el dinero (o por qué entró).', como: ['Es <b>obligatorio en los gastos</b> (OBS ABONO y monto negativo): Sueldos, Arriendo Mensual, Comisión Banco, Caja Chica, Cuentas Básicas…', 'Con él se arma el FLUJO y los informes. Si falta, la fila queda «por completar».', 'SIGSO te sugiere uno cuando lo reconoce: Enter lo acepta.'] },
    monto: { t: 'Monto', que: 'Cuánto entró o salió de la cuenta.', como: ['<b class="fin2-pos">+ verde</b>: entró dinero.', '<b class="fin2-neg">− rojo</b>: salió dinero.', 'Al escribir: 450.000 si entró, −450.000 si salió.'] },
    grupo: { t: 'Grupo', que: 'Junta el dinero que mandó un cliente con lo que se pagó por él (lo que hacía UNITARIO).', como: ['La letra es solo un nombre, como las columnas del Excel: A, B… Z y después AA, AB, AC… <b>No significa otra cosa.</b>', 'Todas las filas con la misma letra son del mismo cliente. Al tocar una, se marcan las demás de su grupo.', 'Lo que sobra (entró − salió) se decide en el panel «Grupos de fondos».'] },
    fact: { t: 'N° factura', que: 'El número de la factura que paga este abono.', como: ['Así la cobranza la marca como pagada.', 'Si paga varias: 1052-1053.'] },
    glosa: { t: 'Detalle banco', que: 'Lo que dice la cartola del banco.', como: ['Viene del banco, no se escribe. Ayuda a saber quién es.'] },
    saldo: { t: 'Saldo', que: 'Lo que había en la cuenta después de este movimiento.', como: ['Lo informa el banco, no se escribe.'] },
    que: { t: 'Qué es', que: 'Lo que SIGSO entiende de la fila con su OBS y su monto. No se escribe.', como: ['<span class="fin2-pos">Honorario</span>: entró y es de la empresa.', '<span class="fin2-neg">Gasto</span>: salió y es de la empresa.', '<span class="fin4-que--info">Fondos cliente</span>: IVA, imposiciones, saldo…', 'En <b class="fin4-que--alerta">naranjo</b>, lo que falta (por ejemplo «falta el plan»). Tócalo y SIGSO te lleva a la celda para completarlo.'] },
    banco: { t: 'Banco', que: 'Si la fila ya coincide con la cartola.', como: ['<b>en banco</b>: coincide con la cartola.', '<b>esperando</b>: anotada; falta que llegue la cartola.', '<b>falta anotar</b>: el banco la trae y nadie la anotó.'] }
  };
  // Plan de cuenta que se reconoce por el nombre o el detalle del banco (solo sugerencia: se acepta con Enter).
  var CLAVES_PLAN = [[/COMISION/, 'Comisión Banco'], [/CAJA CHICA/, 'Caja Chica'], [/CUENTAS? BASICAS|\bENEL\b|AGUAS ANDINAS|METROGAS|ENTEL|MOVISTAR/, 'Cuentas Básicas'],
    [/ARRIENDO/, 'Arriendo Mensual'], [/SUELDO|REMUNERA/, 'Sueldos'], [/ANTICIPO/, 'Anticipos'], [/FINIQUITO/, 'Finiquitos'], [/PATENTE/, 'Patente Comercial'],
    [/PREVIRED|IMPOSICION/, 'Imposiciones'], [/CONVENIO/, 'Convenios'], [/\bIVA\b|TESORERIA/, 'IVA'], [/HOSTING|SERVIDOR/, 'Servidores y Sistemas']];
  // Letras de grupo como las columnas del Excel: A…Z, AA…AZ, BA…
  function letraGrupo(n) { var s = ''; n += 1; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  var QUE_TONO = { ing: 'ok', gas: 'critico', fon: 'info', tra: 'neutro', rev: 'alerta', falta: 'alerta' };
  var DECIS = [['PENDIENTE', 'PENDIENTE · sigue abierto'], ['ABONO', 'ABONO · se cobra como honorario'], ['ABONO RENTA', 'ABONO RENTA · honorario de renta'], ['SALDO', 'SALDO · queda a favor del cliente']];
  var MESES_ = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function plata(n, cero) { var v = Math.round(Number(n) || 0); if (!v && cero !== undefined) return cero; return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('es-CL'); }
  function corta(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '-' + p[1] : ''; }
  function mesCorto(p) { var a = String(p || '').split('-'); return a.length === 2 ? MESES_[Number(a[1]) - 1].slice(0, 3) + ' ' + a[0].slice(2) : p; }
  function mesLargo(p) { var a = String(p || '').split('-'); return a.length === 2 ? MESES_[Number(a[1]) - 1] + ' ' + a[0] : p; }
  function hoy() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
  function leerMonto(s) { var t = String(s == null ? '' : s).replace(/\s|\$|CLP/gi, ''); var neg = /^\(.*\)$/.test(t) || /^[-−]/.test(t); t = t.replace(/[()\-−+]/g, '').replace(/\./g, '').replace(',', '.'); if (!t || isNaN(Number(t))) return null; var n = Math.round(Number(t)); return neg ? -n : n; }
  function leerFecha(s, mes) {
    var t = String(s || '').trim(), m;
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    if ((m = /^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/.exec(t))) { var a = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : mes.slice(0, 4); return a + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2); }
    if ((m = /^(\d{1,2})$/.exec(t)) && Number(m[1]) >= 1 && Number(m[1]) <= 31) return mes + '-' + ('0' + m[1]).slice(-2);
    return null;
  }
  function puede(cap) { return !!(cat_ && (cat_.capacidades || []).indexOf(cap) !== -1); }
  function error(r, msg) { x_.aviso((r && r.message) || msg, 'error'); }
  function norm(s) { return String(s == null ? '' : s).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function iniciales(n) { var p = String(n || '?').replace(/\b(SPA|LTDA|S\.?A\.?|EIRL|Y|DE|DEL|LA|EL)\b/gi, ' ').trim().split(/\s+/); return ((p[0] || '?')[0] + ((p[1] || '')[0] || '')).toUpperCase(); }

  // ---- movimiento: cifras que corren, barras que crecen, el indicador de mes que se desliza --------------
  // Cada valor recuerda el anterior (por clave): al corregir una fila, los totales corren desde lo que había.
  var CIRC = 213.63; // 2πr del anillo (r = 34)
  var previo_ = {}, indPrev_ = null;
  function reducido() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function crece(clave, pct, prop) {
    pct = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    var a = previo_['c|' + clave]; previo_['c|' + clave] = pct;
    if (a === undefined || reducido()) a = reducido() ? pct : 0;
    var ini = prop === 'anillo' ? 'stroke-dashoffset:' + (CIRC * (1 - a / 100)).toFixed(2) : prop + ':' + a + '%';
    return ' style="' + ini + '" data-crece="' + prop + '" data-v="' + pct + '"';
  }
  function cuenta(clave, v, fmt) {
    return '<span class="fin5-num" data-clave="' + txt(clave) + '" data-fin="' + (Number(v) || 0) + '" data-fmt="' + (fmt || '$') + '">' + formatear(fmt || '$', Number(v) || 0) + '</span>';
  }
  function formatear(fmt, v) { return fmt === 'n' ? String(Math.round(v)) : fmt === '%' ? Math.round(v) + '%' : plata(v); }
  function activar(raiz) {
    if (!raiz) return;
    var red = reducido();
    Array.prototype.forEach.call(raiz.querySelectorAll('.fin5-num[data-clave]'), function (el) {
      var clave = 'n|' + el.getAttribute('data-clave'), fin = Number(el.getAttribute('data-fin')) || 0, fmt = el.getAttribute('data-fmt');
      var ini = previo_[clave]; previo_[clave] = fin;
      if (ini === fin) return;
      var card = el.closest('.fin5-kpi'); if (card && ini !== undefined) { card.classList.remove('fin5-pulso'); void card.offsetWidth; card.classList.add('fin5-pulso'); }
      if (red) return;
      if (ini === undefined) ini = 0;
      var t0 = 0, dur = 750;
      function paso(t) { if (!t0) t0 = t; var q = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - q, 3); el.textContent = formatear(fmt, ini + (fin - ini) * e); if (q < 1 && el.isConnected) requestAnimationFrame(paso); else el.textContent = formatear(fmt, fin); }
      el.textContent = formatear(fmt, ini);
      requestAnimationFrame(paso);
    });
    var crecen = raiz.querySelectorAll('[data-crece]');
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      Array.prototype.forEach.call(crecen, function (el) {
        var v = Number(el.getAttribute('data-v')), prop = el.getAttribute('data-crece');
        if (prop === 'anillo') el.style.strokeDashoffset = (CIRC * (1 - v / 100)).toFixed(2); else el.style[prop] = v + '%';
      });
    }); });
    moverIndicador(raiz);
  }
  function moverIndicador(raiz) {
    var cont = raiz.querySelector('.fin5-meses'); if (!cont) return;
    var ind = cont.querySelector('.fin5-meses__ind'), sel = cont.querySelector('[aria-selected="true"]'); if (!ind || !sel) return;
    var fin = { x: sel.offsetLeft, w: sel.offsetWidth };
    if (indPrev_ && !reducido()) { ind.style.transition = 'none'; ind.style.transform = 'translateX(' + indPrev_.x + 'px)'; ind.style.width = indPrev_.w + 'px'; void ind.offsetWidth; ind.style.transition = ''; }
    ind.style.transform = 'translateX(' + fin.x + 'px)'; ind.style.width = fin.w + 'px'; ind.style.opacity = '1';
    indPrev_ = fin;
  }
  function kpi(o, i) {
    var v = o.v;
    return '<article class="fin5-kpi fin5-kpi--' + (o.tono || 'neutro') + ' fin5-entra" style="--i:' + i + '">' +
      '<div class="fin5-kpi__cab"><span class="fin5-kpi__ico">' + U.ico(o.ico || 'dinero', 16) + '</span><span class="fin5-kpi__t">' + txt(o.t) + '</span></div>' +
      '<b class="fin5-kpi__v' + (typeof v === 'number' && v < 0 ? ' fin2-neg' : '') + '">' + (v === null || v === undefined ? txt(o.vacio || '—') : cuenta(o.clave, v, o.fmt)) + '</b>' +
      (o.barra || '') + (o.sub ? '<small class="fin5-kpi__sub">' + txt(o.sub) + '</small>' : '') + '</article>';
  }
  function vacioHtml(ico, titulo, texto, accion) { return '<div class="fin5-vacio fin5-entra"><span class="fin5-vacio__ico">' + U.ico(ico, 26) + '</span><h3>' + txt(titulo) + '</h3><p>' + txt(texto) + '</p>' + (accion || '') + '</div>'; }

  // La planilla del mes (filas, resumen y grupos) en Excel, como la hoja BANCOS.
  function descargarExcel(b) {
    b.disabled = true;
    x_.api('finanzasExportar', { tipo: 'planilla', formato: 'xlsx', filtros: { periodo: est_.periodo, cuenta_ref: est_.cuenta } }).then(function (r) {
      b.disabled = false;
      if (!r || !r.ok) { error(r, 'No se pudo descargar.'); return; }
      var bin = atob(r.data.base64), u = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([u], { type: r.data.mime }));
      var a = document.createElement('a'); a.href = url; a.download = r.data.nombre; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    });
  }

  function ver(x) {
    x_ = x; enlazar();
    var c = x.contexto();
    est_.periodo = c.periodo_hoja || est_.periodo || '';
    est_.cuenta = c.cuenta_ref || est_.cuenta || '';
    est_.extras = c.meses_extra || est_.extras || [];
    est_.editando = null; cerrarAc();
    var t = x.turno();
    // Ya en la planilla (cambio de mes o de cuenta): se atenúa lo que hay y se reemplaza al llegar, sin pantalla en blanco.
    var montada = cuerpoPlanilla();
    if (montada) montada.classList.add('fin5-cargando'); else x.pagina(x.cab('planilla') + U.esqueleto('tabla', 14));
    Promise.all([x.catalogo(), x.api('finanzasHoja', { periodo: est_.periodo, cuenta_ref: est_.cuenta })]).then(function (rs) {
      if (!x.vigente(t)) return;
      cat_ = rs[0];
      var r = rs[1];
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('planilla') + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo abrir la planilla', texto: (r && r.message) || '', accion: '<button type="button" class="sx2-boton sx2-boton--secundario sx2-boton--sm js-fin-reintentar">Reintentar</button>' }) })); return; }
      tomar(r.data);
      pintar(true);
      seleccionar(lineas().length - 1, editable() ? 0 : 1, true);
      if (r.data.filas && r.data.filas.length) setTimeout(function () { if (cuerpoPlanilla()) tour(false); }, 1100);
    });
  }
  function cuerpoPlanilla() { var r = x_ && x_.raiz(); return r ? r.querySelector('.fin5[data-vista="planilla"]') : null; }
  function tomar(d) { (d.filas || []).forEach(function (f, k) { f._n = k + 1; }); est_.datos = d; est_.temporales = []; est_.periodo = d.periodo; est_.cuenta = d.cuenta_ref; x_.contexto({ periodo_hoja: d.periodo, cuenta_ref: d.cuenta_ref }); }
  // Tras guardar: se piden los datos y se cambian solo las partes que cambiaron (sin repintar la página).
  function recargar(enfocarId, col, destello) {
    var x = x_, t = x_.turno();
    return x_.api('finanzasHoja', { periodo: est_.periodo, cuenta_ref: est_.cuenta }).then(function (r) {
      if (!x.vigente(t) || !r || !r.ok) return;
      tomar(r.data);
      if (!cuerpoPlanilla()) { pintar(false); return; }
      parchar([].concat(destello || [], enfocarId || []));
      var l = lineas(), i = enfocarId ? l.findIndex(function (z) { return z.f && z.f.id === enfocarId; }) : -1;
      if (!est_.editando) seleccionar(i === -1 ? Math.min(est_.sel.r, l.length - 1) : i, col === undefined ? est_.sel.c : col, true);
    });
  }
  function editable() { return puede('REGISTRAR') && est_.datos && !est_.datos.cerrado && est_.datos.cuenta_ref; }
  // Las líneas de la hoja: las filas del servidor, las que se están guardando y la fila nueva al final.
  function lineas() {
    var l = (est_.datos.filas || []).filter(function (f) { return pasaFiltro(f) && pasaBusca(f); }).map(function (f) { return { f: f }; });
    (est_.temporales || []).forEach(function (f) { l.push({ f: f }); });
    if (editable()) l.push({ nueva: true });
    return l;
  }
  // Filtros de la planilla (solo cambian lo que se ve; los totales siguen siendo del mes completo).
  var FILTROS = [['todas', 'Todas'], ['falta', 'Falta anotar'], ['completar', 'Por completar'], ['esperando', 'Esperan cartola'], ['ok', 'En el banco']];
  function pasaFiltro(f, k) {
    k = k || est_.filtro;
    if (k === 'falta') return f.banco === 'falta';
    if (k === 'completar') return !!(f.que && (f.que.k === 'rev' || / · sin /.test(f.que.t)));
    if (k === 'esperando') return f.banco === 'esperando';
    if (k === 'ok') return f.banco === 'ok';
    return true;
  }
  function pasaBusca(f) {
    var q = norm(est_.busca).trim(); if (!q) return true;
    var digitos = q.replace(/[^0-9]/g, '');
    var h = norm([f.nombre, f.obs, f.plan, f.glosa, f.fact, f.grupo, f.cliente, f.nota].join(' '));
    return h.indexOf(q) !== -1 || (digitos.length >= 3 && String(Math.abs(f.monto)).indexOf(digitos) !== -1);
  }

  function pintar(animar) {
    var d = est_.datos;
    var acciones = (editable() ? U.boton({ texto: 'Pegar desde Excel', icono: 'copiar', sm: true, variante: 'secundario', clase: 'js-f4-pegar' }) : '') +
      (d.cuenta_ref && d.filas.length ? U.boton({ texto: 'Descargar Excel', icono: 'descargar', sm: true, variante: 'secundario', clase: 'js-f4-excel', datos: { cap: 'EXPORTAR' } }) : '') +
      U.boton({ texto: 'Subir cartola', icono: 'subir', sm: true, variante: 'primario', clase: 'js-f4-cargar', datos: { cap: 'REGISTRAR' } });
    if (est_.filtro !== 'todas' && !d.filas.some(function (f) { return pasaFiltro(f); })) est_.filtro = 'todas';
    var interior = d.cuentas.length ? barraHtml(d, mesesVisibles(d)) + caminoHtml(d) + kpisHtml(d) +
        '<div class="fin5-planilla-env"><div class="fin5-planilla"><div class="fin5-principal">' + filtrosHtml(d) + guiaHtml(d) + hojaHtml(d, animar) + '</div>' +
        '<aside class="fin5-lado" aria-label="Banco y grupos">' + bancoHtml(d) + gruposHtml(d) + atajosHtml() + '</aside></div></div>'
      : vacioHtml('subir', 'Todavía no hay una cuenta del banco', 'Sube la primera cartola del banco: con ella se crea la cuenta y empieza la planilla.', U.boton({ texto: 'Subir cartola', icono: 'subir', variante: 'primario', clase: 'js-f4-cargar' }));
    var c = cuerpoPlanilla();
    if (c) {
      // Misma pantalla: solo cambia el cuerpo (la cabecera y la columna de navegación no se tocan ni se animan de nuevo).
      c.setAttribute('data-quieto', '1');
      c.innerHTML = interior;
      c.classList.remove('fin5-cargando');
      if (est_.accPrevias !== acciones) {
        var tmp = document.createElement('div'); tmp.innerHTML = x_.cab('planilla', acciones);
        var nuevas = tmp.querySelector('.sx2-cabecera__acciones'), viejas = x_.raiz().querySelector('.sx2-cabecera__acciones');
        if (nuevas && viejas) viejas.innerHTML = nuevas.innerHTML;
      }
    } else x_.pagina(x_.cab('planilla', acciones) + '<div class="sx2-pagina__cuerpo fin4 fin5" data-vista="planilla">' + interior + '</div>');
    est_.accPrevias = acciones;
    x_.aplicarCapacidades(x_.raiz());
    activar(cuerpoPlanilla() || x_.raiz());
    var sel = x_.raiz().querySelector('.fin5-mes[aria-selected="true"]'); if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  // Meses en las pestañas: los que tienen datos, los que se abrieron a mano y el elegido.
  function mesesVisibles(d) {
    var m = {}; (d.meses || []).concat(est_.extras || [], [d.periodo]).forEach(function (p) { if (/^\d{4}-\d{2}$/.test(p)) m[p] = 1; });
    return Object.keys(m).sort();
  }
  function barraHtml(d, meses) {
    return '<div class="fin5-barra fin5-entra" style="--i:0">' +
      '<div class="fin5-meses-env"><div class="fin5-meses" role="tablist" aria-label="Mes"><span class="fin5-meses__ind" aria-hidden="true"></span>' +
        meses.map(function (m) { return '<button type="button" role="tab" class="fin5-mes js-f4-mes" data-mes="' + m + '" aria-selected="' + (m === d.periodo) + '"' + ((d.meses || []).indexOf(m) === -1 ? ' data-vacio="1" title="Sin movimientos todavía"' : '') + '>' + txt(mesCorto(m)) + '</button>'; }).join('') + '</div>' +
        '<button type="button" class="fin5-mes-mas js-f5-mes-mas" aria-haspopup="dialog" title="Abrir otro mes"><b>+</b><span>Mes</span></button></div>' +
      (d.cuentas.length > 1 ? '<label class="fin5-select">' + U.ico('empresa', 15) + '<select class="js-f4-cuenta" aria-label="Cuenta del banco">' + d.cuentas.map(function (c) { return '<option value="' + txt(c.id) + '"' + (c.id === d.cuenta_ref ? ' selected' : '') + '>' + txt(c.empresa + ' · ' + c.nombre) + '</option>'; }).join('') + '</select></label>'
        : (d.cuentas[0] ? '<span class="fin5-pildora fin5-pildora--suave">' + U.ico('empresa', 14) + txt(d.cuentas[0].empresa + ' · ' + d.cuentas[0].nombre) + '</span>' : '')) +
      (d.cerrado ? '<span class="fin5-pildora fin5-pildora--neutro">' + U.ico('candado', 14) + 'Mes cerrado</span>' : '') +
      '<span class="fin5-barra__mes js-f5-barra-mes">' + txt(mesLargo(d.periodo)) + ' · ' + d.filas.length + ' fila(s)</span>' +
    '</div>';
  }
  function kpisHtml(d) {
    var t = d.totales, e = d.estado;
    var hon = t.HONORARIOS, gas = -t.GASTOS, base = hon + gas;
    var split = base ? '<div class="fin5-split" aria-hidden="true"><span class="fin5-split__a"' + crece('split-a', hon / base * 100, 'width') + '></span><span class="fin5-split__b"' + crece('split-b', gas / base * 100, 'width') + '></span></div>' : '';
    var l = [
      { clave: 'abono', t: 'ABONO', v: t.ABONO, ico: 'dinero', tono: 'ok', sub: 'entró ' + plata(hon) + ' · gastos ' + plata(gas), barra: split },
      { clave: 'renta', t: 'ABONO RENTA', v: t['ABONO RENTA'], ico: 'recibo', tono: 'info', sub: 'honorarios de renta' },
      { clave: 'saldo', t: 'SALDO', v: t.SALDO, ico: 'persona', tono: 'info', sub: 'a favor de clientes' },
      { clave: 'pend', t: 'PENDIENTE', v: t.PENDIENTE, ico: 'reloj', tono: 'alerta', sub: 'grupos abiertos' }
    ];
    if (t.FONDOS) l.push({ clave: 'fondos', t: 'IVA e imposiciones', v: t.FONDOS, ico: 'caja', tono: 'neutro', sub: 'dinero de clientes sin grupo' });
    if (t.OTRO_MES) l.push({ clave: 'otro', t: 'De otros meses', v: t.OTRO_MES, ico: 'calendario', tono: 'neutro', sub: 'grupos que cierran en otro mes' });
    if (t.TRASPASOS) l.push({ clave: 'tras', t: 'Traspasos', v: t.TRASPASOS, ico: 'derivar', tono: 'neutro', sub: 'entre empresas del grupo' });
    if (t.SIN_COMPLETAR) l.push({ clave: 'sinc', t: 'Sin completar', v: t.SIN_COMPLETAR, ico: 'alerta', tono: 'critico', sub: (e.por_completar + e.falta) + ' fila(s) por anotar' });
    l.push({ clave: 'total', t: 'TOTAL', v: t.TOTAL, ico: 'tendencia', tono: 'acento', sub: '= neto del banco del mes' });
    return '<section class="fin5-kpis" aria-label="Resumen del mes">' + l.map(function (o, i) { return kpi(o, i + 1); }).join('') + '</section>';
  }

  function bancoHtml(d) {
    var c = d.cartola, e = d.estado, n = e.ok + e.esperando + e.falta, p = n ? Math.round(e.ok / n * 100) : 0;
    var cuadra = c && !e.falta && !e.esperando;
    var m = !d.filas.length ? ['neutro', 'info', 'Sin movimientos en ' + txt(mesLargo(d.periodo)) + '. Escribe la primera fila o sube la cartola.']
      : !c ? ['alerta', 'reloj', '<b>Sin cartola todavía.</b> Lo anotado se comprueba cuando la subas.']
        : cuadra ? ['ok', 'check', '<b>Cuadra con la cartola.</b> Todo lo anotado está en el banco.']
          : ['alerta', 'alerta', '<b>Falta para cuadrar:</b> ' + [e.falta ? e.falta + ' del banco sin anotar' : '', e.esperando ? e.esperando + ' anotada(s) que el banco no trae' : ''].filter(Boolean).join(' · ') + '.'];
    function dato(t2, v, clave) { return '<div><dt>' + txt(t2) + '</dt><dd>' + (v === null || v === undefined ? '<span class="fin5-tenue">—</span>' : cuenta(clave, v)) + '</dd></div>'; }
    // Revisiones de la cartola: que esté completa (saldo inicial + movimientos = saldo final) y que la cadena de saldos
    // no se corte (un corte es un movimiento repetido o que falta), y lo que se ve en otro mes por su fecha.
    var notas = '';
    if (c && !c.cuadra) notas += '<div class="fin5-aviso fin5-aviso--critico">' + U.ico('alerta', 16) + '<span><b>La cartola no cuadra:</b> saldo inicial + movimientos no da el saldo final. Revisa que se haya subido completa.</span></div>';
    if (c && c.n_cortes) notas += '<div class="fin5-aviso fin5-aviso--critico">' + U.ico('alerta', 16) + '<span><b>La cadena de saldos se corta en ' + c.n_cortes + ' fila(s)</b> (la primera, ' + txt(corta(c.cortes[0].fecha)) + ' por ' + plata(c.cortes[0].monto) + '): puede haber movimientos repetidos o faltantes.' +
      (c.repetidos.length ? ' Se repiten: ' + c.repetidos.slice(0, 4).map(function (r) { return txt(corta(r.fecha)) + ' ' + plata(r.monto) + ' ×' + r.veces; }).join(', ') + '.' : '') + '</span></div>';
    if (c && c.cuadra && !c.n_cortes) notas += '<p class="fin5-nota fin5-nota--ok">' + U.ico('check', 13) + ' Cartola completa: ' + c.filas + ' movimientos, sin repetidos ni faltantes.</p>';
    var deOtro = d.filas.filter(function (f) { return f.fecha_banco && f.fecha_banco.slice(0, 7) !== d.periodo; });
    if (c && c.en_otro_mes && c.en_otro_mes.filas) notas += '<p class="fin5-nota">' + U.ico('calendario', 13) + ' ' + c.en_otro_mes.filas + ' movimiento(s) de esta cartola (' + plata(c.en_otro_mes.monto) + ') se ven en otro mes por su fecha de transacción.</p>';
    if (deOtro.length) notas += '<p class="fin5-nota">' + U.ico('calendario', 13) + ' ' + deOtro.length + ' fila(s) que el banco contabilizó en otro mes se ven aquí por su fecha.</p>';
    // Lo de los primeros días sin anotar y sin fecha de transacción: casi siempre es del último día del mes anterior.
    var ini = d.filas.filter(function (f) { return f.banco === 'falta' && !f.con_fecha_tx && !f.movida && Number(String(f.fecha).slice(8)) <= 3; });
    var ant = mesVecino(d.periodo, -1);
    var sug = ini.length && editable() ? '<div class="fin5-sugerencia"><span class="fin5-sugerencia__ico">' + U.ico('bombilla', 16) + '</span><div><b>' + ini.length + ' movimiento(s) sin anotar de los primeros días</b> (' + plata(ini.reduce(function (s, f) { return s + f.monto; }, 0)) + ') no tienen fecha de transacción. El banco suele contabilizar ahí lo del último día de ' + txt(MESES_[Number(ant.slice(5)) - 1]) + '.' +
      '<div class="fin5-sugerencia__acc"><button type="button" class="sx2-enlace js-f5-ver-ini">Ver cuáles</button><button type="button" class="sx2-boton sx2-boton--secundario sx2-boton--sm js-f5-mover-ini" data-p="' + ant + '" data-ids="' + txt(ini.map(function (f) { return f.id; }).join(',')) + '">Pasarlos a ' + txt(mesLargo(ant)) + '</button></div></div></div>' : '';
    return '<section class="fin5-card fin5-banco fin5-entra" style="--i:3">' +
      '<header class="fin5-card__cab"><h2>Banco · cartola</h2><span class="fin5-pildora fin5-pildora--' + m[0] + '">' + (cuadra ? U.ico('check', 13) + 'Cuadra' : c ? 'Por cuadrar' : 'Sin cartola') + '</span></header>' +
      '<div class="fin5-banco__cuerpo">' +
        '<div class="fin5-anillo" role="img" aria-label="' + p + '% de las filas ya está en el banco"><svg viewBox="0 0 80 80" aria-hidden="true"><circle class="fin5-anillo__fondo" cx="40" cy="40" r="34"/><circle class="fin5-anillo__valor fin5-anillo--' + m[0] + '" cx="40" cy="40" r="34"' + crece('anillo', p, 'anillo') + '/></svg>' +
          '<div class="fin5-anillo__txt"><b>' + cuenta('anillo-p', p, '%') + '</b><small>en banco</small></div></div>' +
        '<dl class="fin5-banco__cifras">' + dato('Saldo inicial', c ? c.saldo_inicial : null, 'b-ini') + dato('Movimientos', c ? c.movimientos : null, 'b-mov') + dato('Saldo final', c ? c.saldo_final : null, 'b-fin') + '</dl>' +
      '</div>' +
      '<div class="fin5-leyenda"><span><i class="fin5-pt fin5-pt--ok"></i>' + e.ok + ' en banco</span><span><i class="fin5-pt fin5-pt--info"></i>' + e.esperando + ' esperando</span><span><i class="fin5-pt fin5-pt--alerta"></i>' + e.falta + ' falta anotar</span></div>' +
      '<div class="fin5-aviso fin5-aviso--' + m[0] + '">' + U.ico(m[1], 16) + '<span>' + m[2] + '</span></div>' + notas + sug +
    '</section>';
  }
  // ---- El camino del mes: los pasos para dejarlo listo, con lo que falta en cada uno ---------------
  function faltaDe(f) {
    if (!f || f.temp || !f.que) return null;
    if (f.banco === 'falta') return { t: 'Falta anotar', col: 'nombre' };
    if (f.que.t === 'Falta OBS') return { t: 'Falta la OBS', col: 'obs', tipo: 'obs' };
    if (/ · sin plan/.test(f.que.t)) return { t: f.que.t.replace(' · sin plan', ' · falta el plan'), col: 'plan', tipo: 'plan' };
    if (/ · sin nombre/.test(f.que.t)) return { t: f.que.t.replace(' · sin nombre', ' · falta el nombre'), col: 'nombre', tipo: 'nombre' };
    return null;
  }
  function gruposAbiertos(d) { return (d.grupos || []).filter(function (g) { return g.decision === 'PENDIENTE' && g.suma; }); }
  function caminoHtml(d) {
    var e = d.estado, c = d.cartola, ed = editable();
    var comp = d.filas.filter(function (f) { return pasaFiltro(f, 'completar'); }).length, ga = gruposAbiertos(d).length;
    var cuadra = !!c && !e.falta && !e.esperando;
    var pasos = [
      { id: 'cartola', t: 'Sube la cartola', hecho: !!c, sub: c ? 'Cargada' : 'Del banco, en Excel', guia: 'Sube la cartola del banco en Excel (botón «Subir cartola» arriba). Con ella SIGSO comprueba cada fila.' },
      { id: 'falta', t: 'Anota lo del banco', hecho: !!c && !e.falta, n: e.falta, sub: e.falta ? e.falta + ' sin anotar' : c ? 'Todo anotado' : 'Espera la cartola', guia: 'El banco trae movimientos que nadie anotó (en naranjo). Escribe quién es y la OBS: SIGSO te sugiere el nombre.' },
      { id: 'completar', t: 'Completa los datos', hecho: !comp && d.filas.length > 0, n: comp, sub: comp ? comp + ' por completar' : d.filas.length ? 'Nada pendiente' : 'Sin filas', guia: 'A algunas filas les falta un dato. En la columna «Qué es» el texto naranjo dice cuál (el plan, la OBS o el nombre): tócalo y SIGSO te lleva a la celda.' },
      { id: 'grupos', t: 'Decide los grupos', hecho: !ga, n: ga, sub: ga ? ga + ' con dinero por decidir' : 'Todos resueltos', guia: 'Hay grupos donde sobró o faltó dinero. En el panel «Grupos de fondos» elige qué pasa con lo que sobra (se cobra o queda a favor del cliente).' },
      { id: 'esperando', t: 'Cuadra con el banco', hecho: cuadra, n: e.esperando, sub: cuadra ? 'Cuadra' : e.esperando ? e.esperando + ' esperan la cartola' : 'Faltan pasos', guia: e.esperando ? 'Hay filas anotadas que el banco no trae. Si ya subiste la cartola completa, revisa su fecha o su monto.' : 'Cuando todo lo anotado esté en el banco, el mes cuadra.' },
      { id: 'cierre', t: 'Revisa y cierra', hecho: !!d.cerrado, sub: d.cerrado ? 'Cerrado' : estadoRev(d) === 'EN_REVISION' ? 'En revisión' : estadoRev(d) === 'OBSERVADO' ? 'Con observaciones' : 'Al final', guia: estadoRev(d) === 'EN_REVISION' ? 'El mes está en revisión: quien revisa lo cierra o lo devuelve con observaciones.' : 'Todo listo: toca «Revisa y cierra» para ver la revisión final, enviarlo a revisión o cerrarlo.' }
    ];
    var actual = -1; pasos.forEach(function (p, i) { if (actual === -1 && !p.hecho) actual = i; });
    var listos = pasos.filter(function (p) { return p.hecho; }).length;
    var guia = actual === -1 ? 'El mes está completo y cerrado.' : pasos[actual].guia;
    return '<nav class="fin5-camino fin5-entra" style="--i:1" aria-label="Pasos para dejar listo el mes">' +
      '<div class="fin5-camino__cab"><b>Camino del mes</b><span>' + listos + ' de ' + pasos.length + ' pasos listos</span>' +
        '<span class="fin5-camino__barra" aria-hidden="true"><i style="width:' + Math.round(listos / pasos.length * 100) + '%"></i></span></div>' +
      '<ol class="fin5-camino__pasos">' + pasos.map(function (p, i) {
        var estado = p.hecho ? 'hecho' : i === actual ? 'actual' : 'pendiente';
        return '<li><button type="button" class="fin5-paso js-f5-paso" data-paso="' + p.id + '" data-estado="' + estado + '"' + (i === actual ? ' aria-current="step"' : '') + (!ed && p.id === 'cartola' ? ' disabled' : '') + '>' +
          '<span class="fin5-paso__n">' + (p.hecho ? U.ico('check', 14) : i + 1) + '</span><span class="fin5-paso__t"><b>' + txt(p.t) + '</b><small>' + txt(p.sub) + '</small></span></button></li>';
      }).join('') + '</ol>' +
      '<p class="fin5-camino__guia">' + U.ico(actual === -1 ? 'check' : 'bombilla', 15) + '<span>' + (actual === -1 ? '' : '<b>Ahora: ' + txt(pasos[actual].t) + '.</b> ') + txt(guia) + '</span>' +
        '<button type="button" class="sx2-enlace js-f5-revisar">Revisar el mes</button><button type="button" class="sx2-enlace js-f5-tour">Ver recorrido</button></p>' + estadoRevHtml(d) + '</nav>';
  }
  // Explicación sobre la tabla cuando se filtra por algo pendiente: qué significa y cómo se resuelve.
  function guiaHtml(d) {
    var f = est_.filtro, h = '';
    if (f === 'completar') {
      var cuenta_ = { plan: 0, obs: 0, nombre: 0 };
      d.filas.forEach(function (x) { var q = faltaDe(x); if (q && q.tipo) cuenta_[q.tipo]++; });
      var l = [];
      if (cuenta_.plan) l.push('<li><b>' + cuenta_.plan + ' gasto(s) sin plan de cuenta</b>: escribe en «Plan de cuenta» en qué se gastó (Sueldos, Comisión Banco, Caja Chica…). Si pones el mismo plan en varias parecidas, SIGSO te ofrece copiarlo a las demás.</li>');
      if (cuenta_.obs) l.push('<li><b>' + cuenta_.obs + ' fila(s) sin OBS</b>: escribe de quién es el dinero. Si es parte de un grupo, usa la misma OBS del resto del grupo.</li>');
      if (cuenta_.nombre) l.push('<li><b>' + cuenta_.nombre + ' fila(s) sin nombre</b>: escribe quién mandó o a quién se pagó.</li>');
      h = '<h3>Qué falta completar</h3><ul>' + l.join('') + '</ul><p>Toca el texto naranjo de «Qué es» en cada fila para ir directo a la celda.</p>';
    } else if (f === 'falta') h = '<h3>Movimientos del banco sin anotar</h3><p>Están en la cartola y nadie los escribió en la planilla. La fecha y el monto ya vienen del banco: completa <b>quién es</b> y la <b>OBS</b>. Si el nombre aparece sugerido, Enter lo acepta.</p>';
    else if (f === 'esperando') h = '<h3>Anotadas que el banco todavía no trae</h3><p>Si ya subiste la cartola completa del mes, revisa la fecha y el monto: puede haber un número mal escrito, o el banco lo registró en otro mes.</p>';
    return '<div class="fin5-guia"' + (h ? '' : ' hidden') + '>' + (h ? U.ico('bombilla', 18) + '<div>' + h + '</div>' : '') + '</div>';
  }
  function irPaso(id) {
    var raiz = x_.raiz();
    if (id === 'cartola') { x_.ir('cargas'); return; }
    if (id === 'cierre') { abrirRevision(); return; }
    if (id === 'grupos') {
      var ab = gruposAbiertos(est_.datos)[0], card = raiz.querySelector(ab ? '.fin5-grupo[data-letra="' + ab.letra + '"]' : '.fin5-grupos');
      if (card) { card.scrollIntoView({ block: 'center', behavior: reducido() ? 'auto' : 'smooth' }); card.classList.remove('fin5-resalta'); void card.offsetWidth; card.classList.add('fin5-resalta'); }
      return;
    }
    est_.filtro = est_.datos.filas.some(function (f) { return pasaFiltro(f, id); }) ? id : 'todas';
    filtrar();
    var t = raiz.querySelector('.fin5-filtros'); if (t) t.scrollIntoView({ block: 'start', behavior: reducido() ? 'auto' : 'smooth' });
    var l = lineas(), i = l.findIndex(function (z) { return z.f && faltaDe(z.f); });
    if (i >= 0) { var q = faltaDe(l[i].f); seleccionar(i, colDe(q.col), true); }
  }
  // ---- Revisión del mes: pasos, avisos, nombres parecidos y enviar / devolver / cerrar --------------------
  function estadoRev(d) { return (d && d.revision && d.revision.estado) || 'ABIERTO'; }
  function fechaCorta(iso) { return iso ? String(iso).slice(8, 10) + '-' + String(iso).slice(5, 7) : ''; }
  function estadoRevHtml(d) {
    var r = d.revision; if (!r || r.estado === 'ABIERTO' || r.estado === 'CERRADO') return '';
    var abiertas = (r.observaciones || []).filter(function (o) { return !o.resuelta; });
    if (r.estado === 'EN_REVISION') return '<div class="fin5-revest fin5-revest--info">' + U.ico('reloj', 16) + '<span><b>En revisión.</b> ' + txt((r.revision && r.revision.enviado_por) || 'Alguien') + ' lo envió el ' + txt(fechaCorta(r.revision && r.revision.en)) + (r.revision && r.revision.nota ? ': «' + txt(r.revision.nota) + '»' : '.') + (puede('CIERRE') ? ' Te toca revisarlo y cerrarlo, o devolverlo con observaciones.' : ' Quien revisa lo cerrará o lo devolverá con observaciones.') + '</span><button type="button" class="sx2-boton sx2-boton--secundario sx2-boton--sm js-f5-revisar">Abrir la revisión</button></div>';
    return '<div class="fin5-revest fin5-revest--alerta">' + U.ico('alerta', 16) + '<div><b>Devuelto con observaciones.</b> Corrige lo que se pide y márcalo como corregido:' +
      '<ul>' + abiertas.map(function (o) { return '<li>«' + txt(o.texto) + '» <small>— ' + txt(o.por) + ', ' + txt(fechaCorta(o.en)) + '</small>' + (puede('CONFIRMAR') ? ' <button type="button" class="fin5-mini js-f5-resolver" data-i="' + o.indice + '">' + U.ico('check', 12) + 'Corregido</button>' : '') + '</li>'; }).join('') + '</ul></div></div>';
  }
  var rev_ = null;
  function abrirRevision() {
    var dr = U.drawer({ titulo: 'Revisar ' + mesLargo(est_.periodo), subtitulo: '<span class="fin2-ayuda">Lo que hay que mirar antes de cerrar el mes</span>', cuerpo: U.esqueleto('lista', 6), alCerrar: function () { rev_ = null; } });
    dr.el.querySelector('.sx2-drawer__panel').classList.add('fin5-rev-panel');
    rev_ = { dr: dr, eleccion: {} };
    cargarRevision();
    dr.el.addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      if (b.classList.contains('js-rv-ir')) { var id = b.dataset.paso; dr.cerrar(); setTimeout(function () { irPaso(id); }, 240); }
      else if (b.classList.contains('js-rv-unificar')) unificar(+b.dataset.k);
      else if (b.classList.contains('js-rv-enviar')) accionRevision('enviar');
      else if (b.classList.contains('js-rv-observar')) accionRevision('observar');
      else if (b.classList.contains('js-rv-cerrar')) accionRevision('cerrar');
      else if (b.classList.contains('js-f5-resolver')) resolverObs(+b.dataset.i);
    });
    dr.el.addEventListener('change', function (ev) { var t = ev.target; if (t.name && t.name.indexOf('rv-par-') === 0) rev_.eleccion[t.name.slice(7)] = t.value; });
  }
  function cargarRevision() {
    if (!rev_) return;
    x_.api('finanzasHojaRevision', { periodo: est_.periodo, cuenta_ref: est_.cuenta }).then(function (r) {
      if (!rev_) return;
      if (!r || !r.ok) { rev_.dr.cuerpo(U.vacio({ icono: 'alerta', titulo: 'No se pudo revisar el mes', texto: (r && r.message) || '' })); return; }
      rev_.d = r.data; pintarRevision();
    });
  }
  function pintarRevision() {
    var v = rev_.d, c = v.cierre, pz = v.puede, ok = v.pasos.filter(function (p) { return p.ok; }).length;
    var pasos = v.pasos.map(function (p) {
      return '<li class="fin5-rv-paso" data-ok="' + p.ok + '"><span class="fin5-rv-paso__ico">' + U.ico(p.ok ? 'check' : 'alerta', 14) + '</span><div><b>' + txt(p.titulo) + '</b><small>' + txt(p.detalle) + '</small></div>' +
        (!p.ok && p.id !== 'cartola' ? '<button type="button" class="fin5-mini js-rv-ir" data-paso="' + p.id + '">Ir a corregir</button>' : !p.ok ? '<button type="button" class="fin5-mini js-rv-ir" data-paso="cartola">Subir cartola</button>' : '') + '</li>';
    }).join('');
    var par = v.parecidos.map(function (g, k) {
      var elegido = rev_.eleccion[k] || g.sugerido;
      return '<div class="fin5-rv-par"><p class="fin5-rv-par__motivo">' + txt(g.motivo) + '</p>' + g.nombres.map(function (n) {
        return '<label class="fin5-rv-op"><input type="radio" name="rv-par-' + k + '" value="' + txt(n.nombre) + '"' + (n.nombre === elegido ? ' checked' : '') + (pz.editar ? '' : ' disabled') + '><span>' + txt(n.nombre) + '</span><small>' + n.filas + ' fila(s)</small></label>';
      }).join('') + (pz.editar && !est_.datos.cerrado ? '<button type="button" class="fin5-mini fin5-mini--acento js-rv-unificar" data-k="' + k + '">Dejar todo con el nombre elegido</button>' : '') + '</div>';
    }).join('');
    var avisos = v.avisos.filter(function (a) { return a.id !== 'nombres'; }).map(function (a) { return '<li><b>' + txt(a.titulo) + '</b><small>' + txt(a.detalle) + '</small></li>'; }).join('');
    var otros = v.otros_pasos.length ? '<div class="fin5-aviso fin5-aviso--alerta">' + U.ico('alerta', 15) + '<span>Para cerrar el mes completo también falta: ' + txt(v.otros_pasos.join(', ').toLowerCase()) + '. Se ve en «Más → Cierre de meses».</span></div>' : '';
    var obs = (c.observaciones || []).length ? '<section class="fin5-rv-sec"><h3>Observaciones</h3><ul class="fin5-rv-obs">' + c.observaciones.map(function (o) {
      return '<li data-resuelta="' + !!o.resuelta + '">' + U.ico(o.resuelta ? 'check' : 'alerta', 13) + '<div>«' + txt(o.texto) + '» <small>' + txt(o.por) + ' · ' + txt(fechaCorta(o.en)) + (o.resuelta ? ' · corregida por ' + txt(o.resuelta_por || '') : '') + '</small></div>' +
        (!o.resuelta && pz.enviar ? '<button type="button" class="fin5-mini js-f5-resolver" data-i="' + o.indice + '">Corregido</button>' : '') + '</li>';
    }).join('') + '</ul></section>' : '';
    // Qué puede hacer cada quien: quien anota lo envía a revisión; quien revisa lo devuelve o lo cierra.
    var abiertas = (c.observaciones || []).filter(function (o) { return !o.resuelta; }).length;
    var acciones = '', estadoTxt = '';
    if (c.estado === 'CERRADO') estadoTxt = 'Cerrado por ' + (c.cerrado_por || '—') + ' el ' + fechaCorta(c.en) + '. Para cambiar algo hay que reabrirlo en «Más → Cierre de meses».';
    else {
      estadoTxt = c.estado === 'EN_REVISION' ? 'En revisión: lo envió ' + ((c.revision && c.revision.enviado_por) || '—') + ' el ' + fechaCorta(c.revision && c.revision.en) + '.' : c.estado === 'OBSERVADO' ? 'Devuelto con observaciones (' + abiertas + ' sin corregir).' : 'Abierto: se puede seguir anotando.';
      if (pz.enviar && c.estado !== 'EN_REVISION') acciones += U.boton({ texto: 'Enviar a revisión', icono: 'derivar', variante: v.listo ? 'primario' : 'secundario', clase: 'js-rv-enviar' });
      if (pz.revisar && c.estado === 'EN_REVISION') acciones += U.boton({ texto: 'Devolver con observaciones', icono: 'editar', variante: 'secundario', clase: 'js-rv-observar' });
      if (pz.revisar && (c.estado === 'EN_REVISION' || !c.politica.exige_revision)) acciones += U.boton({ texto: 'Cerrar el mes', icono: 'candado', variante: c.estado === 'EN_REVISION' ? 'primario' : 'secundario', clase: 'js-rv-cerrar' });
    }
    var resumen = v.listo ? '<div class="fin5-rv-res fin5-rv-res--ok">' + U.ico('check', 22) + '<div><b>La planilla de ' + txt(v.nombre_mes) + ' está lista.</b><span>' + txt(v.cuenta) + ' · los ' + v.pasos.length + ' pasos completos.</span></div></div>'
      : '<div class="fin5-rv-res">' + '<b class="fin5-rv-res__n">' + ok + '/' + v.pasos.length + '</b><div><b>' + (v.pasos.length - ok === 1 ? 'Falta 1 paso' : 'Faltan ' + (v.pasos.length - ok) + ' pasos') + ' para dejarla lista.</b><span>Toca «Ir a corregir» y SIGSO te lleva a las filas.</span></div></div>';
    rev_.dr.cuerpo('<div class="fin5-rv">' + resumen +
      '<section class="fin5-rv-sec"><h3>Pasos</h3><ul class="fin5-rv-pasos">' + pasos + '</ul></section>' +
      (par ? '<section class="fin5-rv-sec"><h3>Un mismo cliente escrito de varias formas</h3><p class="fin2-ayuda">Elige cómo queda el nombre: se cambia en todas sus filas de este mes. Así los saldos por cliente y los informes no lo cuentan como dos clientes distintos.</p>' + par + '</section>' : '') +
      (avisos ? '<section class="fin5-rv-sec"><h3>Para mirar (no impiden cerrar)</h3><ul class="fin5-rv-avisos">' + avisos + '</ul></section>' : '') +
      obs + otros +
      '<section class="fin5-rv-sec fin5-rv-estado"><h3>Estado del mes</h3><p>' + txt(estadoTxt) + '</p><p class="fin2-ayuda">' + txt(c.politica.texto) + '</p>' + (acciones ? '<div class="fin5-rv-acc">' + acciones + '</div>' : '') + '</section></div>');
  }
  function accionRevision(tipo) {
    var p = est_.periodo, fin = function () { cargarRevision(); recargar(null); };
    if (tipo === 'enviar') U.formulario({ titulo: 'Enviar ' + mesLargo(p) + ' a revisión', boton: 'Enviar', campos: U.campo('Nota para quien revisa (opcional)', '<input name="nota" class="sx2-input" maxlength="500" placeholder="Por ejemplo: quedó pendiente confirmar el grupo AD">', 'Quien revisa recibe un aviso en la campana de SIGSO.'),
      enviar: function (d) { return x_.api('finanzasEnviarRevision', { periodo: p, nota: d.nota }); }, aviso: 'Enviado a revisión.', listo: function () { abrirRevision(); recargar(null); } });
    else if (tipo === 'observar') U.formulario({ titulo: 'Devolver con observaciones', boton: 'Devolver', campos: U.campo('Qué hay que corregir', '<textarea name="observacion" class="sx2-input" rows="3" required></textarea>', 'Quien lo envió recibe un aviso. Mientras haya observaciones sin corregir, el mes no se puede cerrar.'),
      enviar: function (d) { return x_.api('finanzasObservarCierre', { periodo: p, observacion: d.observacion }); }, aviso: 'Devuelto con observaciones.', listo: function () { abrirRevision(); recargar(null); } });
    else U.confirmar({ titulo: '¿Cerrar ' + mesLargo(p) + '?', texto: 'El mes queda fijo: nadie podrá cambiar su planilla sin reabrirlo con un motivo. Se guarda una versión del informe tal como está.', boton: 'Cerrar el mes' }).then(function (si) {
      if (!si) return;
      x_.api('finanzasCerrarMes', { periodo: p }).then(function (r) { if (!r || !r.ok) { error(r, 'No se pudo cerrar.'); return; } x_.aviso(mesLargo(p) + ' quedó cerrado.', 'exito'); fin(); });
    });
  }
  function resolverObs(i) {
    x_.api('finanzasResolverObservacion', { periodo: est_.periodo, indice: i, respuesta: 'Corregido en la planilla' }).then(function (r) {
      if (!r || !r.ok) { error(r, 'No se pudo marcar.'); return; }
      mensaje('Observación marcada como corregida'); recargar(null); if (rev_) cargarRevision();
    });
  }
  // Unificar nombres: el elegido queda en todas las filas del mes que usan las otras formas.
  function unificar(k) {
    var g = rev_ && rev_.d.parecidos[k]; if (!g) return;
    var a = rev_.eleccion[k] || g.sugerido, otros = g.nombres.map(function (n) { return n.nombre; }).filter(function (n) { return n !== a; });
    var filas = est_.datos.filas.filter(function (f) { return otros.indexOf(norm(f.nombre)) !== -1 && f.banco !== 'falta'; });
    if (!filas.length) return;
    U.confirmar({ titulo: '¿Dejar «' + a + '»?', texto: 'Se cambia el nombre de ' + filas.length + ' fila(s) que dicen ' + otros.map(function (o) { return '«' + o + '»'; }).join(', ') + '.', boton: 'Unificar' }).then(function (si) {
      if (!si) return;
      var hechos = 0;
      filas.forEach(function (f) {
        encolar(function () {
          return x_.api('finanzasHojaGuardar', { id: f.id, expected_version: f.version, campos: { nombre: a } }).then(function (r) {
            if (!r || !r.ok) { error(r, 'No se pudo cambiar el nombre.'); return; }
            f.nombre = a; hechos++; if (r.data && r.data.version !== undefined) f.version = r.data.version; est_.guardados.push(f.id);
          });
        });
      });
      cola_.then(function () { mensaje(hechos + ' fila(s) quedaron como «' + a + '»'); delete rev_.eleccion[k]; cargarRevision(); });
    });
  }
  // ---- Recorrido de la primera vez: marca cada parte de la planilla y explica para qué sirve ----------------
  var TOUR_ = [
    ['.fin5-camino', 'El camino del mes', 'Son los pasos para dejar listo un mes. El que toca va marcado en azul y debajo dice qué hacer. Toca un paso para ir directo a lo que falta.'],
    ['.fin5-kpis', 'El resumen', 'Como arriba en el Excel: ABONO, ABONO RENTA, SALDO, PENDIENTE y el TOTAL. Se calcula solo con lo que anotas.'],
    ['.fin4-hoja thead', 'Las columnas y sus «?»', 'Cada columna tiene un «?»: tócalo y explica qué va ahí, cómo se escribe y un ejemplo.'],
    ['.fin4-fila--nueva', 'Aquí se anota', 'Haz clic en la fila nueva y escribe como en Excel: día, nombre, OBS (una letra basta) y monto. Enter guarda y baja.'],
    ['.js-f5-completar', 'Lo que falta, en naranjo', 'En «Qué es» lo pendiente sale en naranjo. Tócalo y SIGSO te lleva a la celda que hay que llenar.'],
    ['.fin5-banco', 'El banco', 'Muestra si lo anotado coincide con la cartola. Cuando todo está en el banco, dice «Cuadra».'],
    ['.fin5-grupos', 'Los grupos', 'Juntan lo que mandó un cliente con lo que se pagó por él. Si sobra o falta dinero, aquí se decide qué pasa.'],
    ['.js-f5-revisar', 'Revisar el mes', 'Al terminar, abre la revisión: muestra lo que falta, los nombres escritos distinto y permite enviar el mes a revisión o cerrarlo.']
  ];
  var tour_ = null;
  function tourVisto() { try { return !!localStorage.getItem('sigso_fin_tour_planilla_1'); } catch (e) { return true; } }
  function tourMarcar() { try { localStorage.setItem('sigso_fin_tour_planilla_1', '1'); } catch (e) { /* sin almacenamiento */ } }
  function tour(forzar) {
    if (tour_ || (!forzar && (tourVisto() || !editable()))) return;
    var pasos = TOUR_.filter(function (t) { return x_.raiz().querySelector(t[0]); });
    if (!pasos.length) return;
    var el = document.createElement('div'); el.className = 'fin5-tour'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Recorrido por la planilla');
    el.innerHTML = '<div class="fin5-tour__foco"></div><div class="fin5-tour__card" tabindex="-1"></div>';
    document.body.appendChild(el);
    tour_ = { el: el, i: 0, pasos: pasos };
    function fin() { tourMarcar(); window.removeEventListener('resize', ubicar); document.removeEventListener('scroll', ubicar, true); document.removeEventListener('keydown', tecla, true); if (el.parentNode) el.parentNode.removeChild(el); tour_ = null; }
    function ubicar() {
      if (!tour_) return;
      var t = x_.raiz().querySelector(pasos[tour_.i][0]); if (!t) return;
      var r = t.getBoundingClientRect(), foco = el.querySelector('.fin5-tour__foco'), card = el.querySelector('.fin5-tour__card');
      var alto = Math.min(r.height, window.innerHeight * 0.6);
      foco.style.cssText = 'top:' + (r.top - 6) + 'px;left:' + (r.left - 6) + 'px;width:' + (r.width + 12) + 'px;height:' + (alto + 12) + 'px';
      var cw = Math.min(360, window.innerWidth - 24), ch = card.offsetHeight || 180;
      var top = r.top + alto + 16 + ch < window.innerHeight ? r.top + alto + 16 : Math.max(12, r.top - ch - 16);
      card.style.cssText = 'top:' + top + 'px;left:' + Math.max(12, Math.min(r.left, window.innerWidth - cw - 12)) + 'px;width:' + cw + 'px';
    }
    function mostrar() {
      var p = pasos[tour_.i], t = x_.raiz().querySelector(p[0]);
      if (t) t.scrollIntoView({ block: 'center', behavior: 'auto' });
      var card = el.querySelector('.fin5-tour__card');
      card.innerHTML = '<small class="fin5-tour__n">Paso ' + (tour_.i + 1) + ' de ' + pasos.length + '</small><b>' + txt(p[1]) + '</b><p>' + txt(p[2]) + '</p>' +
        '<div class="fin5-tour__acc"><button type="button" class="sx2-enlace js-tour-fin">Saltar</button><span></span>' +
        (tour_.i ? '<button type="button" class="sx2-boton sx2-boton--secundario sx2-boton--sm js-tour-ant">Anterior</button>' : '') +
        '<button type="button" class="sx2-boton sx2-boton--primario sx2-boton--sm js-tour-sig">' + (tour_.i === pasos.length - 1 ? 'Listo' : 'Siguiente') + '</button></div>';
      requestAnimationFrame(ubicar);
      var sig = card.querySelector('.js-tour-sig'); if (sig) sig.focus();
    }
    function tecla(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); fin(); } else if (ev.key === 'ArrowRight') { ev.stopPropagation(); ev.preventDefault(); avanzar(1); } else if (ev.key === 'ArrowLeft') { ev.stopPropagation(); ev.preventDefault(); avanzar(-1); } }
    function avanzar(n) { var j = tour_.i + n; if (j >= pasos.length) { fin(); return; } if (j < 0) return; tour_.i = j; mostrar(); }
    el.addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      if (b.classList.contains('js-tour-fin')) fin(); else if (b.classList.contains('js-tour-sig')) avanzar(1); else if (b.classList.contains('js-tour-ant')) avanzar(-1);
    });
    window.addEventListener('resize', ubicar);
    document.addEventListener('scroll', ubicar, true);
    document.addEventListener('keydown', tecla, true);
    mostrar();
  }
  // ---- «?» de las columnas ------------------------------------------------------------------
  var popA_ = null;
  function cerrarAyudaCol() { if (popA_) { if (popA_.el.parentNode) popA_.el.parentNode.removeChild(popA_.el); popA_.btn.setAttribute('aria-expanded', 'false'); popA_ = null; } }
  function abrirAyudaCol(btn) {
    var mismo = popA_ && popA_.btn === btn; cerrarAyudaCol(); if (mismo) return;
    var a = AYUDA_COL[btn.dataset.col]; if (!a) return;
    var el = document.createElement('div'); el.className = 'fin5-pop-ayuda'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', a.t);
    el.innerHTML = '<b class="fin5-pop-ayuda__t">' + txt(a.t) + '</b><p>' + txt(a.que) + '</p><ul>' + a.como.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';
    document.body.appendChild(el);
    var r = btn.getBoundingClientRect();
    el.style.top = Math.min(r.bottom + 8, window.innerHeight - el.offsetHeight - 8) + 'px';
    el.style.left = Math.max(8, Math.min(r.left - 20, window.innerWidth - el.offsetWidth - 8)) + 'px';
    btn.setAttribute('aria-expanded', 'true');
    popA_ = { el: el, btn: btn };
  }
  // Plan sugerido para un gasto sin plan: el de la última vez con ese nombre o el que se reconoce en el texto.
  function sugerirPlan(f) {
    if (!f || f.plan || !(f.monto < 0) || !/^ABONO/.test(f.obs || '')) return '';
    var m = ((est_.datos && est_.datos.listas.memoria) || {})[norm(f.nombre).replace(/\s+/g, ' ').trim()];
    if (m && m.plan_gasto) return m.plan_gasto;
    var t = norm((f.nombre || '') + ' ' + (f.glosa || ''));
    for (var i = 0; i < CLAVES_PLAN.length; i++) if (CLAVES_PLAN[i][0].test(t)) return CLAVES_PLAN[i][1];
    return '';
  }
  // Después de poner un plan: las otras filas sin plan que se parecen (mismo detalle del banco y día, o mismo nombre).
  function ofrecerParecidas(f, plan) {
    var sim = est_.datos.filas.filter(function (g) {
      return g !== f && !g.plan && g.monto < 0 && /^ABONO/.test(g.obs || '') && !g.temp &&
        ((g.glosa && norm(g.glosa) === norm(f.glosa) && g.fecha === f.fecha) || (f.nombre && norm(g.nombre) === norm(f.nombre)));
    });
    est_.oferta = sim.length ? { plan: plan, ids: sim.map(function (g) { return g.id; }), hasta: Date.now() + 30000 } : null;
    ayuda();
  }
  function aplicarOferta() {
    var o = est_.oferta; if (!o) return;
    var filas = est_.datos.filas.filter(function (g) { return o.ids.indexOf(g.id) !== -1 && !g.plan; });
    est_.oferta = null;
    U.confirmar({ titulo: '¿Poner «' + o.plan + '» en ' + filas.length + ' fila(s) más?', texto: filas.slice(0, 8).map(function (g) { return corta(g.fecha) + ' · ' + (g.nombre || 'sin nombre') + ' · ' + plata(g.monto); }).join('; ') + (filas.length > 8 ? '; …' : '') + '.', boton: 'Poner el plan' }).then(function (si) {
      if (!si) { ayuda(); return; }
      filas.forEach(function (g) {
        g.plan = o.plan;
        encolar(function () {
          return x_.api('finanzasHojaGuardar', { id: g.id, expected_version: g.version, campos: { plan: o.plan } }).then(function (r) {
            if (!r || !r.ok) { g.plan = ''; error(r, 'No se pudo guardar.'); return; }
            if (r.data && r.data.version !== undefined) g.version = r.data.version;
            est_.guardados.push(g.id);
          });
        });
      });
      repintarHoja(); mensaje('Plan «' + o.plan + '» puesto en ' + filas.length + ' fila(s)');
    });
  }
  function mesVecino(p, n) { var a = String(p).split('-').map(Number); return new Date(Date.UTC(a[0], a[1] - 1 + n, 1)).toISOString().slice(0, 7); }
  function filtrosHtml(d) {
    return '<div class="fin5-filtros fin5-entra" style="--i:2">' + chipsHtml(d) +
      '<label class="fin5-buscar">' + U.ico('lupa', 15) + '<input type="search" class="js-f5-buscar" placeholder="Buscar nombre, monto, plan o factura…" value="' + txt(est_.busca) + '" aria-label="Buscar en la planilla"></label></div>';
  }
  function chipsHtml(d) {
    return '<div class="fin5-chips" role="group" aria-label="Filtrar filas">' +
      FILTROS.map(function (o) {
        var n = d.filas.filter(function (f) { return pasaFiltro(f, o[0]); }).length;
        if (o[0] !== 'todas' && !n) return '';
        return '<button type="button" class="fin5-chip js-f5-filtro' + (o[0] === 'falta' || o[0] === 'completar' ? ' fin5-chip--alerta' : '') + '" data-f="' + o[0] + '" aria-pressed="' + (est_.filtro === o[0]) + '">' + txt(o[1]) + '<span>' + n + '</span></button>';
      }).join('') + '</div>';
  }
  function hojaHtml(d, animar) {
    var ed = editable();
    return '<section class="fin5-card fin5-tabla fin5-entra" style="--i:3"><div class="fin4-hoja-env" tabindex="-1"><table class="fin4-hoja' + (animar && !reducido() ? ' fin5-hoja--entra' : '') + '" aria-label="Planilla de ' + txt(mesLargo(d.periodo)) + '"><thead><tr><th class="fin4-idx">#</th>' +
      COLS.concat([['saldo', 'Saldo'], ['que', 'Qué es'], ['banco', 'Banco']]).map(function (k) { return '<th class="' + (k[0] === 'monto' || k[0] === 'saldo' ? 'fin4-n' : '') + '"><span class="fin5-th">' + k[1] + '<button type="button" class="fin5-th-ayuda js-f5-col-ayuda" data-col="' + k[0] + '" aria-label="¿Qué va en ' + txt(k[1]) + '?" aria-haspopup="dialog">?</button></span></th>'; }).join('') + '</tr></thead><tbody>' +
      cuerpoHoja(ed) + '</tbody></table></div>' +
      '<footer class="fin5-tabla__pie"><span class="fin5-tabla__ico">' + U.ico(ed ? 'editar' : 'ojo', 14) + '</span><p class="fin4-ayuda js-f4-ayuda" aria-live="polite"></p>' +
      '<span class="fin5-acc-fila js-f5-acc-fila"></span><span class="fin5-guardado js-f5-guardado" aria-live="polite"></span>' +
      (ed ? '' : '<p class="fin5-nota">' + (d.cerrado ? 'El mes está cerrado: la planilla se ve, pero no se edita.' : 'Tu acceso es de lectura.') + '</p>') + '</footer></section>';
  }
  function cuerpoHoja(ed) {
    var l = lineas();
    var vacia = (est_.datos.filas || []).length && !l.some(function (z) { return z.f; });
    return (vacia ? '<tr class="fin5-sin"><td colspan="' + (COLS.length + 4) + '">' + U.ico('lupa', 16) + ' Ninguna fila coincide con el filtro. <button type="button" class="sx2-enlace js-f5-limpiar">Ver todas</button></td></tr>' : '') +
      l.map(function (z, i) { return filaHtml(z, i, ed); }).join('');
  }

  function atajosHtml() {
    if (!editable()) return '';
    return '<section class="fin5-card fin5-atajos fin5-entra" style="--i:5"><header class="fin5-card__cab"><h2>Atajos</h2></header>' +
      '<div class="fin5-atajos__obs">' + Object.keys(ATAJO_OBS).map(function (k) { return '<span title="' + txt(AYUDA_OBS[ATAJO_OBS[k]]) + '"><kbd>' + k + '</kbd>' + txt(ATAJO_OBS[k]) + '</span>'; }).join('') + '</div>' +
      '<ul class="fin5-atajos__teclas"><li><kbd>Enter</kbd> escribe · guarda y baja</li><li><kbd>Tab</kbd> siguiente celda</li><li><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> moverse</li><li><kbd>Supr</kbd> borra la celda</li><li><kbd>Ctrl</kbd>+<kbd>V</kbd> pega filas del Excel</li></ul></section>';
  }
  function valores(z) {
    if (z.nueva) { var b = est_.borrador; return { fecha: b.fecha ? corta(b.fecha) : '', nombre: b.nombre || '', obs: b.obs || '', plan: b.plan || '', monto: b.monto ? plata(b.monto) : '', grupo: b.grupo || '', fact: b.fact || '', glosa: b.glosa || '' }; }
    var f = z.f;
    return { fecha: corta(f.fecha), nombre: f.nombre, obs: f.obs, plan: f.plan, monto: plata(f.monto), grupo: f.grupo, fact: f.fact, glosa: f.glosa };
  }
  function bloqueada(z, campo) {
    if (z.nueva) return false;
    if (z.f.temp) return true;
    if (z.f.partes > 1 && campo === 'monto') return true;
    if (z.f.banco !== 'esperando' && (campo === 'fecha' || campo === 'monto' || campo === 'glosa')) return true;
    return false;
  }
  var OBS_TONO = { ABONO: 'ok', 'ABONO RENTA': 'info', IVA: 'violeta', IMPOSICIONES: 'violeta', SALDO: 'info', PENDIENTE: 'alerta' };
  function filaHtml(z, i, ed) {
    var f = z.f || {}, v = valores(z);
    var clase = z.nueva ? 'fin4-fila--nueva' : f.temp ? 'fin5-pendiente' : f.banco === 'falta' ? 'fin4-fila--falta' : (f.que && f.que.k === 'rev') ? 'fin4-fila--rev' : '';
    var sug = !z.nueva && f.banco === 'falta' && !f.nombre ? sugerirNombre(f) : '';
    var ph = z.nueva ? { fecha: 'día · ' + corta(fechaDefecto()), nombre: 'escribe aquí para anotar', obs: 'OBS', monto: '+ entra / − sale' } : f.banco === 'falta' ? { nombre: sug ? '¿' + sug + '? ↵' : '¿quién es?', obs: 'OBS' } : {};
    var falta = z.nueva ? null : faltaDe(f), sugPlan = falta && falta.tipo === 'plan' ? sugerirPlan(f) : '';
    if (falta && falta.tipo === 'plan') ph.plan = sugPlan ? '¿' + sugPlan + '? ↵' : 'falta: ¿en qué se gastó?';
    if (falta && falta.tipo === 'obs') ph.obs = 'falta la OBS';
    if (falta && falta.tipo === 'nombre') ph.nombre = 'falta el nombre';
    var grupo = !z.nueva && f.grupo ? (est_.datos.grupos || []).filter(function (g) { return g.letra === f.grupo; })[0] : null;
    var banco = z.nueva ? (listo() ? '<span class="fin4-chip fin4-chip--borr">Enter guarda</span>' : est_.borrador.fecha || est_.borrador.monto || est_.borrador.nombre ? '<span class="fin4-chip fin4-chip--borr">sin guardar</span>' : '')
      : f.temp ? '<span class="fin4-chip fin4-chip--esp"><i></i>guardando…</span>'
        : (f.banco === 'ok' ? '<span class="fin4-chip fin4-chip--ok"><i></i>en banco</span>' : f.banco === 'esperando' ? '<span class="fin4-chip fin4-chip--esp"><i></i>esperando</span>' : '<span class="fin4-chip fin4-chip--falta"><i></i>falta anotar</span>') +
          (f.fecha_banco ? '<small class="fin5-fbanco" title="El banco lo contabilizó el ' + txt(f.fecha_banco.split('-').reverse().join('-')) + '">banco ' + txt(corta(f.fecha_banco)) + '</small>' : '') +
          (f.movida ? '<small class="fin5-fbanco fin5-fbanco--movida" title="Pasada a este mes a mano">movida</small>' : '');
    var que = z.nueva || f.temp ? '' : (falta && ed ? '<button type="button" class="fin5-que-btn js-f5-completar" data-i="' + i + '" data-col="' + falta.col + '" title="Completar ahora">' + U.ico('editar', 12) + txt(falta.t) + '</button>'
      : '<span class="fin4-que fin4-que--' + (falta ? 'alerta' : QUE_TONO[f.que.k] || 'neutro') + '">' + txt(falta ? falta.t : f.que.t) + '</span>') + (f.cliente && f.cliente !== f.nombre ? '<small class="fin4-que-cli">' + txt(f.cliente) + '</small>' : '');
    var obs = z.nueva ? est_.borrador.obs : f.obs;
    var firma = z.nueva ? JSON.stringify(est_.borrador) + listo() : [f.version, f.saldo, f.banco, f.que && f.que.t, f.cliente, f.fecha, f.fecha_banco, f.movida, v.nombre, v.obs, v.plan, v.monto, v.grupo, v.fact, v.glosa, sug, sugPlan, grupo && grupo.cliente].join('|');
    return '<tr class="fin4-fila ' + clase + '" data-i="' + i + '"' + (f.id ? ' data-id="' + txt(f.id) + '"' : '') + (f.grupo ? ' data-grupo="' + txt(f.grupo) + '"' : '') + ' data-firma="' + txt(firma) + '" style="--i:' + Math.min(i, 24) + '"><td class="fin4-idx">' + (z.nueva ? '+' : f.temp ? '…' : f._n) + '</td>' +
      COLS.map(function (k, j) {
        var b = bloqueada(z, k[0]);
        var num = k[0] === 'monto';
        var tono = num && !z.nueva ? (f.monto < 0 ? ' fin2-neg' : ' fin2-pos') : num && est_.borrador.monto ? (est_.borrador.monto < 0 ? ' fin2-neg' : ' fin2-pos') : '';
        var extra = k[0] === 'obs' && obs ? ' fin5-obs fin5-obs--' + (OBS_TONO[obs] || 'neutro') : '';
        var m = num ? (z.nueva ? est_.borrador.monto : f.monto) : 0;
        // El monto se ve como en un estado de cuenta: verde con + si entró, rojo con − si salió.
        var contenido = num && m ? '<span class="fin5-mt fin5-mt--' + (m < 0 ? 'sale' : 'entra') + '" title="' + (m < 0 ? 'Salió de la cuenta' : 'Entró a la cuenta') + '"><i aria-hidden="true">' + (m < 0 ? '−' : '+') + '</i>' + txt(plata(Math.abs(m))) + '</span>'
          : k[0] === 'grupo' && v.grupo ? '<span class="fin5-gr" title="Grupo ' + txt(v.grupo) + (grupo ? ' · ' + txt(grupo.cliente || 'sin nombre') + ' · ' + grupo.filas + ' fila(s) · sobra ' + txt(plata(grupo.suma)) : '') + '">' + txt(v.grupo) + '</span>'
            : txt(v[k[0]]);
        return '<td class="fin4-cel fin4-c-' + k[0] + (num ? ' fin4-n' : '') + (b ? ' fin4-bloq' : '') + (k[0] === 'glosa' && !z.nueva && f.banco !== 'esperando' ? ' fin4-tenue' : '') + '" data-r="' + i + '" data-c="' + j + '" data-l="' + k[1] + '"' + (ed && !b ? '' : ' aria-readonly="true"') + '>' +
          '<span class="fin4-v' + (num ? '' : tono) + extra + (ph[k[0]] ? ' fin5-con-ph' : '') + '" data-ph="' + txt(ph[k[0]] || '') + '">' + contenido + '</span></td>';
      }).join('') +
      '<td class="fin4-n fin4-saldo" data-l="Saldo"><span class="fin4-v">' + (z.nueva || f.temp ? '' : plata(f.saldo)) + '</span></td>' +
      '<td class="fin4-c-que" data-l="Qué es"><span class="fin4-v">' + que + '</span></td>' +
      '<td class="fin4-c-banco" data-l="Banco"><span class="fin4-v">' + banco + '</span></td></tr>';
  }
  function gruposHtml(d) {
    var g = (d.grupos || []).slice().sort(function (a, b) { var pa = a.decision === 'PENDIENTE' && a.suma ? 0 : 1, pb = b.decision === 'PENDIENTE' && b.suma ? 0 : 1; return pa - pb; });
    var ab = gruposAbiertos(d).length;
    return '<section class="fin5-card fin5-grupos fin5-entra" style="--i:4" aria-label="Grupos de fondos"><header class="fin5-card__cab"><h2>Grupos de fondos <button type="button" class="fin5-th-ayuda js-f5-col-ayuda" data-col="grupo" aria-label="¿Qué es un grupo?">?</button></h2>' + (g.length ? '<span class="fin5-pildora fin5-pildora--' + (ab ? 'alerta' : 'suave') + '">' + (ab ? ab + ' por decidir' : g.length) + '</span>' : '') + '</header>' +
      (g.length ? '<p class="fin5-nota">Cada letra junta lo que mandó un cliente y lo que se pagó por él. Si entró lo mismo que salió, está cuadrado y no hay nada que decidir.</p><div class="fin5-grupos__lista">' + g.map(function (x) {
        var pct = x.entra ? x.sale / x.entra * 100 : 100, cuadrado = !x.suma;
        return '<article class="fin5-grupo' + (x.suma < 0 ? ' fin5-grupo--neg' : '') + (cuadrado ? ' fin5-grupo--cuadrado' : x.decision === 'PENDIENTE' ? ' fin5-grupo--abierto' : '') + '" data-letra="' + txt(x.letra) + '">' +
          '<div class="fin5-grupo__cab"><span class="fin5-grupo__letra">' + txt(x.letra) + '</span><div class="fin5-grupo__quien"><b>' + txt(x.cliente || 'sin nombre') + '</b><small>' + x.filas + ' fila(s)</small></div>' +
            '<div class="fin5-grupo__sobra"><small>sobra</small><b class="' + (x.suma < 0 ? 'fin2-neg' : '') + '">' + plata(x.suma) + '</b></div></div>' +
          '<div class="fin5-progreso" title="Se pagó el ' + Math.round(pct) + '% de lo recibido"><span' + crece('g-' + d.periodo + '-' + x.letra, pct, 'width') + '></span></div>' +
          '<div class="fin5-grupo__nums"><span>Entró <b>' + plata(x.entra) + '</b></span><span>Salió <b>' + plata(x.sale) + '</b></span></div>' +
          (cuadrado ? '<p class="fin5-grupo__ok">' + U.ico('check', 13) + 'Cuadrado: entró lo mismo que salió.</p>'
            : '<label class="fin5-grupo__dec"><span>' + (x.suma < 0 ? 'Se pagó más de lo que mandó (' + plata(-x.suma) + '): ¿qué pasa?' : '¿Qué pasa con lo que sobra?') + '</span><select class="fin2-input js-f4-decision" data-letra="' + txt(x.letra) + '"' + (editable() ? '' : ' disabled') + '>' +
            DECIS.map(function (o) { return '<option value="' + o[0] + '"' + (x.decision === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>') +
          (x.otro_mes ? '<small class="fin4-grupo__aviso">' + U.ico('alerta', 13) + ' Tiene filas de otro mes' + (x.remanente_excel !== null ? ': según el Excel sobran ' + plata(x.remanente_excel) : '') + '.</small>' : '') +
          (x.excel && !cuadrado ? '<small class="fin5-nota">Viene del Excel BANCOS (su fila de cierre decía ' + txt(x.decision) + ').</small>' : '') +
        '</article>';
      }).join('') + '</div>' : '<p class="fin5-nota">Pon la misma letra en la columna <b>Grupo</b> a lo que el cliente mandó y a lo que se pagó por él (la fórmula de UNITARIO, sin fórmulas). Lo que sobra se calcula solo y tú eliges qué pasa con eso.</p>') + '</section>';
  }

  // ---- selección y edición, como en una planilla ----------------------------------------
  function td(r, c) { return x_.raiz().querySelector('.fin4-hoja td.fin4-cel[data-r="' + r + '"][data-c="' + c + '"]'); }
  function seleccionar(r, c, sinScroll) {
    var l = lineas(); if (!l.length) return;
    var antes = est_.sel.r, deNueva = l[antes] && l[antes].nueva;
    var viejo = x_.raiz().querySelector('.fin4-hoja td.fin4-sel'); if (viejo) viejo.classList.remove('fin4-sel');
    est_.sel = { r: Math.max(0, Math.min(l.length - 1, r)), c: Math.max(0, Math.min(COLS.length - 1, c)) };
    var el = td(est_.sel.r, est_.sel.c);
    if (el) { el.classList.add('fin4-sel'); if (!sinScroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    marcarGrupo(l[est_.sel.r] && l[est_.sel.r].f ? l[est_.sel.r].f.grupo : '');
    ayuda();
    // Al salir de la fila nueva con fecha y monto, se guarda (como al bajar en el Excel).
    if (deNueva && !(l[est_.sel.r] && l[est_.sel.r].nueva) && listo()) guardarNueva();
  }
  function marcarGrupo(letra) {
    var raiz = x_.raiz();
    Array.prototype.forEach.call(raiz.querySelectorAll('.fin5-mismo-grupo'), function (e) { e.classList.remove('fin5-mismo-grupo'); });
    if (!letra) return;
    Array.prototype.forEach.call(raiz.querySelectorAll('tr[data-grupo="' + letra + '"], .fin5-grupo[data-letra="' + letra + '"]'), function (e) { e.classList.add('fin5-mismo-grupo'); });
  }
  // La línea de ayuda dice qué falta en la fila elegida y ofrece lo que se puede hacer con ella.
  function ayuda() {
    var el = x_.raiz().querySelector('.js-f4-ayuda'); if (!el) return;
    var acc = x_.raiz().querySelector('.js-f5-acc-fila');
    var z = lineas()[est_.sel.r]; if (!z) { el.textContent = ''; if (acc) acc.innerHTML = ''; return; }
    if (est_.mensaje && Date.now() < est_.mensaje.hasta) { el.innerHTML = '<span class="fin5-ayuda-ok">' + U.ico('check', 13) + txt(est_.mensaje.t) + '</span>'; }
    else {
      var campo = COLS[est_.sel.c][0];
      var t = '';
      if (z.nueva) t = listo() ? 'Lista: Enter (o bajar) la guarda.' + (est_.borrador.fecha ? '' : ' Va con fecha ' + corta(fechaDefecto()) + '.') : 'Fila nueva: el día (o Enter para ' + corta(fechaDefecto()) + '), el nombre, la OBS y el monto. Ctrl+D copia la celda de arriba.';
      else if (z.f.temp) t = 'Guardando esta fila…';
      else {
        var f = z.f;
        if (f.banco === 'falta') { var sg = sugerirNombre(f); t = 'El banco trae este movimiento y nadie lo anotó: escribe quién es y la OBS.' + (sg ? ' Sugerido: ' + sg + ' (Enter en Nombre).' : ''); }
        else if (faltaDe(f)) { var q = faltaDe(f), sp = q.tipo === 'plan' ? sugerirPlan(f) : ''; t = q.tipo === 'plan' ? 'Es un gasto de la empresa y le falta el plan de cuenta: escribe en qué se gastó (Sueldos, Comisión Banco, Caja Chica…).' + (sp ? ' Sugerido: ' + sp + ' (Enter en Plan de cuenta).' : '') : q.tipo === 'obs' ? 'Le falta la OBS (de quién es el dinero): A = ABONO, R = ABONO RENTA, I = IVA, M = IMPOSICIONES, S = SALDO, P = PENDIENTE.' + (f.grupo ? ' Está en el grupo ' + f.grupo + ': usa la misma OBS de las otras filas del grupo.' : '') : 'Le falta el nombre: el cliente, o el gasto (ARRIENDO, SUELDO…).'; }
        else if (f.banco === 'esperando') t = 'Anotada: falta que llegue en la cartola para comprobarla.';
        else t = f.que.t + (f.cliente ? ' · ' + f.cliente : '') + (f.plan ? ' · ' + f.plan : '') + (f.glosa ? ' · banco: ' + f.glosa : '');
        if (bloqueada(z, campo)) t += ' La fecha, el monto y el detalle vienen del banco.';
      }
      el.textContent = t;
    }
    // Pasar una fila del banco al mes vecino (lo contabilizado al día siguiente del cierre).
    if (acc) {
      var g = z.f && !z.f.temp && z.f.banco !== 'esperando' && editable() ? z.f : null;
      var of = est_.oferta && Date.now() < est_.oferta.hasta ? '<button type="button" class="fin5-mini fin5-mini--acento js-f5-oferta">' + U.ico('copiar', 13) + 'Poner «' + txt(est_.oferta.plan) + '» en ' + est_.oferta.ids.length + ' parecida(s)</button>' : '';
      acc.innerHTML = of + (!g ? '' : g.movida ? '<button type="button" class="fin5-mini js-f5-mover" data-id="' + txt(g.id) + '" data-p="">' + U.ico('calendario', 13) + 'Volver a su mes</button>'
        : '<button type="button" class="fin5-mini js-f5-mover" data-id="' + txt(g.id) + '" data-p="' + mesVecino(est_.periodo, -1) + '" title="Es del mes anterior">← ' + txt(mesCorto(mesVecino(est_.periodo, -1))) + '</button>' +
          '<button type="button" class="fin5-mini js-f5-mover" data-id="' + txt(g.id) + '" data-p="' + mesVecino(est_.periodo, 1) + '" title="Es del mes siguiente">' + txt(mesCorto(mesVecino(est_.periodo, 1))) + ' →</button>');
    }
  }
  function valorCrudo(z, campo) {
    if (z.nueva) { var b = est_.borrador; if (campo === 'fecha') return b.fecha ? corta(b.fecha) : ''; if (campo === 'monto') return b.monto ? String(b.monto) : ''; return b[campo] || ''; }
    var f = z.f;
    if (campo === 'fecha') return corta(f.fecha);
    if (campo === 'monto') return String(f.monto);
    return f[campo] || '';
  }
  function editar(inicial) {
    if (!editable()) return;
    var z = lineas()[est_.sel.r], campo = COLS[est_.sel.c][0], cel = td(est_.sel.r, est_.sel.c);
    if (!z || !cel) return;
    if (bloqueada(z, campo)) { avisoCelda(cel, z.f && z.f.temp ? 'Esta fila se está guardando.' : 'La fecha, el monto y el detalle vienen del banco: no se cambian aquí.'); return; }
    cel.insertAdjacentHTML('beforeend', '<input class="fin4-editor" autocomplete="off" spellcheck="false" aria-label="' + txt(COLS[est_.sel.c][1]) + '" aria-autocomplete="list"' + (campo === 'monto' ? ' inputmode="decimal"' : '') + '>');
    var inp = cel.querySelector('.fin4-editor');
    var valor = inicial !== undefined ? inicial : valorCrudo(z, campo);
    // Nombre de una fila del banco sin anotar: se propone quién es (del detalle del banco), listo para aceptar con Enter.
    if (inicial === undefined && campo === 'nombre' && !valor && z.f && z.f.banco === 'falta') valor = sugerirNombre(z.f);
    if (inicial === undefined && campo === 'plan' && !valor && z.f) valor = sugerirPlan(z.f);
    inp.value = valor;
    est_.editando = { r: est_.sel.r, c: est_.sel.c, inp: inp };
    inp.focus(); if (inicial === undefined) inp.select();
    inp.addEventListener('input', function () { if (ac_) ac_.i = -1; abrirAc(true); });
    abrirAc(true);
  }
  function cancelar() { var e = est_.editando; cerrarAc(); if (!e) return; est_.editando = null; if (e.inp.parentNode) e.inp.parentNode.removeChild(e.inp); }
  // Lee lo escrito en una celda; devuelve el valor para el servidor o null si no se entiende (con aviso en la celda).
  function interpretar(campo, v, cel) {
    if (campo === 'fecha') { if (!v) return ''; var d = leerFecha(v, est_.periodo); if (!d) { avisoCelda(cel, 'Escribe el día (12) o la fecha (12-10).'); return null; } return d; }
    if (campo === 'monto') { if (!v) return ''; var m = leerMonto(v); if (m === null || m === 0) { avisoCelda(cel, 'Escribe el monto: 450.000 si entró, -450.000 si salió.'); return null; } return m; }
    if (campo === 'obs') { var o = v.toUpperCase().trim(); if (ATAJO_OBS[o]) o = ATAJO_OBS[o]; var hit = (est_.datos.listas.obs || []).filter(function (x) { return x.indexOf(o) === 0; }); if (o && hit.length === 1) o = hit[0]; if (o && (est_.datos.listas.obs || []).indexOf(o) === -1) { avisoCelda(cel, 'La OBS es una de estas: ' + est_.datos.listas.obs.join(', ') + '.'); return null; } return o; }
    if (campo === 'nombre' || campo === 'grupo') return v.toUpperCase().replace(/\s+/g, ' ');
    if (campo === 'plan') { var p = planDelCatalogo(v); return p || v; }
    return v;
  }
  function planDelCatalogo(v) {
    var n = String(v || '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    var l = (est_.datos.listas.planes_ingreso || []).concat(est_.datos.listas.planes_egreso || [], est_.datos.listas.planes_fondos || []);
    return l.filter(function (p) { return p.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '') === n; })[0] || '';
  }
  function mover(r, c, hacia) {
    var l = lineas();
    if (hacia === 'abajo') seleccionar(r + 1, c);
    else if (hacia === 'derecha') { if (c >= COLS.length - 1) seleccionar(Math.min(r + 1, l.length - 1), 0); else seleccionar(r, c + 1); }
    else if (hacia === 'izquierda') seleccionar(r, c - 1);
    else seleccionar(r, c);
  }
  function confirmar(hacia) {
    var e = est_.editando; if (!e) return;
    var z = lineas()[e.r], campo = COLS[e.c][0], crudo = e.inp.value.trim();
    var antes = valorCrudo(z, campo), cel = td(e.r, e.c);
    cancelar();
    // Fila nueva: Enter en una fecha vacía usa la fecha propuesta.
    if (z && z.nueva && campo === 'fecha' && !crudo && hacia === 'abajo' && !est_.borrador.fecha) crudo = corta(fechaDefecto());
    if (crudo === antes) { if (z && z.nueva && hacia === 'abajo' && listo()) { guardarNueva(); return; } mover(e.r, e.c, hacia); return; }
    var v = interpretar(campo, crudo, cel);
    if (v === null) { seleccionar(e.r, e.c); editar(crudo); return; }
    if (!z) return;
    if (z.nueva) {
      var b = est_.borrador;
      if (v === '') delete b[campo]; else b[campo] = v;
      if (campo === 'fecha' && v) est_.ultimaFecha = v;
      if (campo === 'nombre' && v) { var hecho = completarDesdeMemoria(v, b, b, b.monto); if (hecho) mensaje('Como la última vez: ' + hecho); }
      repintarFila(e.r);
      // Se guarda al terminar la fila (Enter o salir de la última columna), no a mitad: así el nombre y la OBS van juntos.
      if (listo() && (hacia === 'abajo' || (hacia === 'derecha' && e.c >= COLS.length - 1))) { guardarNueva(); return; }
      mover(e.r, e.c, hacia); return;
    }
    // Pinta lo escrito de inmediato y guarda en orden (cola); si el servidor no lo acepta, vuelve atrás.
    var f = z.f, campos = {}; campos[campo] = v;
    if (campo === 'nombre' && v) { var h2 = completarDesdeMemoria(v, f, campos, f.monto); if (h2) mensaje('Como la última vez: ' + h2); }
    var previo = {}; Object.keys(campos).forEach(function (k) { previo[k] = f[k]; f[k] = campos[k]; });
    repintarFila(e.r);
    Object.keys(campos).forEach(function (k) { var c2 = td(e.r, colDe(k)); if (c2) c2.classList.add('fin5-guardando'); });
    mover(e.r, e.c, hacia);
    encolar(function () {
      return x_.api('finanzasHojaGuardar', { id: f.id, expected_version: f.version, campos: campos }).then(function (r) {
        if (!r || !r.ok) { Object.keys(previo).forEach(function (k) { f[k] = previo[k]; }); error(r, 'No se pudo guardar.'); return; }
        if (r.data && r.data.version !== undefined) f.version = r.data.version;
        est_.guardados.push(f.id);
      });
    });
    if (campo === 'plan' && v && f.monto < 0) ofrecerParecidas(f, v);
  }
  function colDe(campo) { for (var i = 0; i < COLS.length; i++) if (COLS[i][0] === campo) return i; return -1; }
  // La fila nueva se guarda en segundo plano: aparece de inmediato (en gris, «guardando…») y la siguiente queda lista.
  function guardarNueva() {
    var b = est_.borrador;
    if (!listo()) return;
    if (!b.fecha) b.fecha = fechaDefecto();
    if (b.fecha.slice(0, 7) !== est_.periodo) x_.aviso('La fecha es de otro mes (' + mesLargo(b.fecha.slice(0, 7)) + '): la fila quedará en ese mes.', 'alerta');
    est_.ultimaFecha = b.fecha;
    var tmp = { id: 'tmp-' + Date.now(), temp: true, fecha: b.fecha, monto: b.monto, nombre: b.nombre || '', obs: b.obs || '', plan: b.plan || '', grupo: b.grupo || '', fact: b.fact || '', glosa: b.glosa || '', banco: 'esperando', que: { k: 'rev', t: '' } };
    est_.temporales = (est_.temporales || []).concat([tmp]);
    est_.borrador = {};
    var campos = Object.assign({}, b);
    repintarHoja();
    seleccionar(lineas().length - 1, campos.fecha ? 1 : 0, false);
    encolar(function () {
      return x_.api('finanzasHojaGuardar', { cuenta_ref: est_.cuenta, campos: campos }).then(function (r) {
        if (!r || !r.ok) {
          est_.temporales = (est_.temporales || []).filter(function (t) { return t !== tmp; });
          if (!Object.keys(est_.borrador).length) est_.borrador = campos;
          error(r, 'No se pudo anotar la fila.'); repintarHoja(); return;
        }
        if (r.data.en_banco) mensaje('Anotada y unida con su movimiento del banco');
        est_.guardados.push(r.data.id);
        if (campos.fecha.slice(0, 7) !== est_.periodo) { est_.periodo = campos.fecha.slice(0, 7); est_.irAlMes = true; }
      });
    });
  }
  function repintarHoja() {
    var tb = x_.raiz().querySelector('.fin4-hoja tbody'); if (!tb) return;
    var ed = editable();
    tb.innerHTML = cuerpoHoja(ed);
    seleccionar(est_.sel.r, est_.sel.c, true);
  }
  // Repinta una sola fila (lo escrito se ve al instante, sin tocar el resto de la hoja).
  function repintarFila(i) {
    var tb = x_.raiz().querySelector('.fin4-hoja tbody'), z = lineas()[i]; if (!tb || !z) return;
    var tr = tb.querySelector('tr.fin4-fila[data-i="' + i + '"]'); if (!tr) { repintarHoja(); return; }
    var t = document.createElement('tbody'); t.innerHTML = filaHtml(z, i, editable());
    tr.parentNode.replaceChild(t.firstElementChild, tr);
    if (est_.sel.r === i) { var el = td(i, est_.sel.c); if (el) el.classList.add('fin4-sel'); }
  }
  // Aplica el filtro y la búsqueda sin recargar: las filas visibles se repintan y los chips se marcan.
  function filtrar(escribiendo) {
    if (est_.editando) cancelar();
    Array.prototype.forEach.call(x_.raiz().querySelectorAll('.js-f5-filtro'), function (c) { c.setAttribute('aria-pressed', String(c.dataset.f === est_.filtro)); });
    est_.sel.r = 0;
    var c = cuerpoPlanilla(); if (c) reemplazarEn(c, '.fin5-guia', guiaHtml(est_.datos));
    repintarHoja();
    if (!escribiendo) { var env = x_.raiz().querySelector('.fin4-hoja-env'); if (env) env.scrollTop = 0; }
  }
  function borrarCelda() {
    if (!editable()) return;
    var z = lineas()[est_.sel.r], campo = COLS[est_.sel.c][0];
    if (!z) return;
    if (z.nueva) { delete est_.borrador[campo]; repintarFila(est_.sel.r); return; }
    if (z.f.temp || z.f.banco === 'falta') return;
    if (campo === 'fecha' || campo === 'monto') {
      var f = z.f;
      U.confirmar({ titulo: f.banco === 'esperando' ? '¿Borrar esta fila?' : '¿Borrar lo anotado en esta fila?', texto: corta(f.fecha) + ' · ' + plata(f.monto) + (f.nombre ? ' · ' + f.nombre : '') + (f.banco === 'esperando' ? '' : '. El movimiento del banco queda «falta anotar».'), boton: 'Borrar', peligro: true }).then(function (si) {
        if (!si) return;
        encolar(function () { return x_.api('finanzasHojaBorrar', { id: f.id, expected_version: f.version }).then(function (r) { if (!r || !r.ok) error(r, 'No se pudo borrar.'); else mensaje('Borrado'); }); });
      });
      return;
    }
    if (bloqueada(z, campo) || !z.f[campo]) return;
    var campos = {}; campos[campo] = '';
    var g = z.f, previo = g[campo]; g[campo] = ''; repintarFila(est_.sel.r);
    encolar(function () { return x_.api('finanzasHojaGuardar', { id: g.id, expected_version: g.version, campos: campos }).then(function (r) { if (!r || !r.ok) { g[campo] = previo; error(r, 'No se pudo borrar.'); return; } if (r.data && r.data.version !== undefined) g.version = r.data.version; est_.guardados.push(g.id); }); });
  }

  // ---- guardar en orden, sin recargar la página --------------------------------------------------------
  // Cada cambio entra a una cola: se manda con la versión que dejó el anterior (no choca consigo mismo) y, cuando la
  // cola queda vacía, se piden los datos una vez y se cambian solo las filas y cifras que cambiaron.
  var cola_ = Promise.resolve(), enCola_ = 0;
  function encolar(fn) {
    enCola_++; estadoGuardado();
    cola_ = cola_.then(fn).catch(function () { /* el error ya se mostró */ }).then(function () {
      enCola_--; estadoGuardado();
      if (!enCola_) {
        var ids = est_.guardados.splice(0);
        if (est_.irAlMes) { est_.irAlMes = false; ver(x_); return; }
        recargar(null, undefined, ids);
      }
    });
    return cola_;
  }
  function estadoGuardado() {
    var el = x_ && x_.raiz() && x_.raiz().querySelector('.js-f5-guardado'); if (!el) return;
    clearTimeout(el._t);
    if (enCola_) { el.className = 'fin5-guardado fin5-guardado--on js-f5-guardado'; el.innerHTML = '<i class="fin5-giro"></i>Guardando…'; return; }
    el.className = 'fin5-guardado fin5-guardado--ok js-f5-guardado'; el.innerHTML = U.ico('check', 13) + 'Guardado';
    el._t = setTimeout(function () { el.className = 'fin5-guardado js-f5-guardado'; el.innerHTML = ''; }, 1800);
  }
  // Cambia en la página solo lo que cambió: cifras de arriba, chips, banco, grupos y las filas distintas.
  function parchar(destellar) {
    var c = cuerpoPlanilla(), d = est_.datos; if (!c) return;
    c.setAttribute('data-quieto', '1');
    [['.fin5-camino', caminoHtml(d)], ['.fin5-guia', guiaHtml(d)], ['.fin5-kpis', kpisHtml(d)], ['.fin5-chips', chipsHtml(d)], ['.fin5-banco', bancoHtml(d)], ['.fin5-grupos', gruposHtml(d)]].forEach(function (x) { reemplazarEn(c, x[0], x[1]); });
    var bm = c.querySelector('.js-f5-barra-mes'); if (bm) bm.textContent = mesLargo(d.periodo) + ' · ' + d.filas.length + ' fila(s)';
    var tb = c.querySelector('.fin4-hoja tbody');
    if (tb) {
      var ed = editable(), l = lineas(), viejas = Array.prototype.slice.call(tb.querySelectorAll('tr.fin4-fila'));
      var mismas = !tb.querySelector('.fin5-sin') && viejas.length === l.length && l.every(function (z, i) { return (viejas[i].getAttribute('data-id') || '') === (z.f ? z.f.id : ''); });
      if (!mismas) tb.innerHTML = cuerpoHoja(ed);
      else l.forEach(function (z, i) {
        if (est_.editando && est_.editando.r === i) return; // no se pisa la celda que se está escribiendo
        var html = filaHtml(z, i, ed), t = document.createElement('tbody'); t.innerHTML = html;
        var nueva = t.firstElementChild;
        if (viejas[i].getAttribute('data-firma') !== nueva.getAttribute('data-firma')) viejas[i].parentNode.replaceChild(nueva, viejas[i]);
      });
      (destellar || []).forEach(function (id) { var tr = tb.querySelector('tr[data-id="' + id + '"]'); if (tr) { tr.classList.remove('fin5-destello'); void tr.offsetWidth; tr.classList.add('fin5-destello'); } });
    }
    x_.aplicarCapacidades(c);
    activar(c);
  }
  function reemplazarEn(cont, sel, html) {
    var el = cont.querySelector(sel); if (!el) return;
    var t = document.createElement('div'); t.innerHTML = html;
    if (t.firstElementChild) el.parentNode.replaceChild(t.firstElementChild, el);
  }
  function mensaje(t) { est_.mensaje = { t: t, hasta: Date.now() + 3500 }; ayuda(); setTimeout(function () { if (est_.mensaje && Date.now() >= est_.mensaje.hasta) { est_.mensaje = null; ayuda(); } }, 3600); }
  // Un error en una celda se muestra en ella (sacudida y mensaje) en vez de un aviso flotante.
  function avisoCelda(cel, t) {
    if (cel) { cel.classList.remove('fin5-err'); void cel.offsetWidth; cel.classList.add('fin5-err'); }
    var el = x_.raiz().querySelector('.js-f4-ayuda'); if (el) el.innerHTML = '<span class="fin5-ayuda-err">' + U.ico('alerta', 13) + txt(t) + '</span>';
  }

  // ---- la fila nueva: fecha propuesta, lista para guardar, lo de la última vez -----------------------------
  function fechaDefecto() {
    if (est_.ultimaFecha && est_.ultimaFecha.slice(0, 7) === est_.periodo) return est_.ultimaFecha;
    var fs = (est_.datos && est_.datos.filas || []).map(function (f) { return f.fecha; }).filter(function (f) { return f && f.slice(0, 7) === est_.periodo; }).sort();
    if (fs.length) return fs[fs.length - 1];
    return hoy().slice(0, 7) === est_.periodo ? hoy() : est_.periodo + '-01';
  }
  function listo() { var b = est_.borrador || {}; return !!(b.monto && (b.fecha || b.nombre || b.obs)); }
  // Al escribir un nombre conocido, la OBS y el plan vacíos se completan como la última vez (si el sentido calza).
  function completarDesdeMemoria(nombre, actual, campos, monto) {
    var m = ((est_.datos && est_.datos.listas.memoria) || {})[norm(nombre).replace(/\s+/g, ' ').trim()];
    if (!m) return '';
    if (monto && m.signo && (monto < 0 ? -1 : 1) !== m.signo) return '';
    var hecho = [];
    if (!actual.obs && m.obs) { campos.obs = m.obs; hecho.push(m.obs); }
    if (!actual.plan && m.plan) { campos.plan = m.plan; hecho.push(m.plan); }
    return hecho.join(' · ');
  }
  // Quién es un movimiento del banco sin anotar: el pagador del detalle del banco o el nombre de la glosa, llevado al
  // nombre corto que ya se usa en la planilla si lo hay.
  function sugerirNombre(f) {
    var base = f.quien_banco || (/(?:TRANSFER(?:ENCIA)?\s+(?:RECIBIDA\s+)?DE|ENVIADA\s+A|ABONO\s+TERCEROS\s+[\dK.\-]+)\s+(.+)$/i.exec(f.glosa || '') || [])[1] || '';
    base = norm(base).replace(/[^A-Z0-9 ]/g, ' ').replace(/\b(SPA|LTDA|LIMITADA|EIRL|S A)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (base.length < 3) return '';
    var k = base.slice(0, Math.min(10, base.length));
    var nombres = (est_.datos.listas.nombres || []);
    var hit = nombres.filter(function (n) { return norm(n.n).indexOf(k) === 0 || norm(n.quien).indexOf(k) === 0; })[0];
    return hit ? hit.n : base.split(' ').slice(0, 3).join(' ');
  }
  // Ctrl+D: copia la celda de la fila de arriba (como rellenar hacia abajo en Excel).
  function copiarArriba() {
    if (!editable() || est_.editando) return;
    var l = lineas(), z = l[est_.sel.r], arriba = l[est_.sel.r - 1], campo = COLS[est_.sel.c][0];
    if (!z || !arriba || !arriba.f || bloqueada(z, campo)) return;
    var v = valorCrudo(arriba, campo); if (!v) return;
    editar(v); confirmar();
  }

  // ---- autocompletar al escribir (nombres, OBS, planes y grupos) -------------------------------------------
  var ac_ = null;
  function opcionesAc(campo, q, z) {
    var d = est_.datos, L = d.listas, nq = norm(q).replace(/\s+/g, ' ').trim();
    var monto = z && z.f ? z.f.monto : est_.borrador.monto, obs = z && z.f ? z.f.obs : est_.borrador.obs;
    var lista = [];
    if (campo === 'nombre') {
      var mem = L.memoria || {}, vistos = {};
      (L.nombres || []).forEach(function (n) { vistos[norm(n.n)] = 1; lista.push({ v: n.n, sub: n.quien, mem: mem[norm(n.n)] }); });
      Object.keys(mem).forEach(function (k) { if (!vistos[k]) lista.push({ v: k, sub: '', mem: mem[k] }); });
      if (!nq) {
        var sg = z && z.f && z.f.banco === 'falta' ? sugerirNombre(z.f) : '';
        lista = lista.filter(function (o) { return o.mem; }).sort(function (a, b) { return String(b.mem.fecha).localeCompare(String(a.mem.fecha)); }).slice(0, 6);
        if (sg) lista.unshift({ v: sg, sub: 'según el banco', sugerido: true, mem: mem[norm(sg)] });
        return lista;
      }
    } else if (campo === 'obs') {
      var letra = {}; Object.keys(ATAJO_OBS).forEach(function (k) { letra[ATAJO_OBS[k]] = k; });
      lista = (L.obs || []).map(function (o) { return { v: o, sub: AYUDA_OBS[o] || '', tecla: letra[o] }; });
      if (nq.length === 1 && ATAJO_OBS[nq]) return lista.filter(function (o) { return o.v === ATAJO_OBS[nq]; }).concat(lista.filter(function (o) { return o.v !== ATAJO_OBS[nq]; }));
      if (!nq) return lista;
    } else if (campo === 'plan') {
      var fondos = /^(IVA|IMPOSICIONES|SALDO|PENDIENTE)$/.test(obs || '');
      var l = fondos ? L.planes_fondos : monto < 0 ? L.planes_egreso : monto > 0 ? L.planes_ingreso : (L.planes_ingreso || []).concat(L.planes_egreso || []);
      lista = (l || []).map(function (p) { return { v: p, sub: fondos ? 'fondos del cliente' : monto < 0 ? 'gasto' : monto > 0 ? 'ingreso' : '' }; });
      var sp = z && z.f ? sugerirPlan(z.f) : '';
      if (sp) { lista = lista.filter(function (o) { return norm(o.v) !== norm(sp); }); lista.unshift({ v: sp, sub: 'sugerido para esta fila', sugerido: true }); }
      if (!nq) return lista.slice(0, 10);
    } else if (campo === 'grupo') {
      var gs = (d.grupos || []).map(function (g) { return { v: g.letra, sub: (g.cliente || 'sin nombre') + ' · ' + g.filas + ' fila(s) · sobra ' + plata(g.suma) }; });
      var usadas = gs.map(function (g) { return g.v; }), libre = ''; for (var n = 0; n < 702 && !libre; n++) if (usadas.indexOf(letraGrupo(n)) === -1) libre = letraGrupo(n);
      if (libre) gs.unshift({ v: libre, sub: 'grupo nuevo (la siguiente letra libre)' });
      lista = gs;
      if (!nq) return lista;
    } else return [];
    var pts = function (o) { var n = norm(o.v), s = norm(o.sub || ''); return n.indexOf(nq) === 0 ? 0 : (' ' + n).indexOf(' ' + nq) !== -1 ? 1 : n.indexOf(nq) !== -1 ? 2 : s.indexOf(nq) !== -1 ? 3 : 9; };
    return lista.map(function (o) { o.p = pts(o); return o; }).filter(function (o) { return o.p < 9; })
      .sort(function (a, b) { return a.p - b.p || ((b.mem && b.mem.veces) || 0) - ((a.mem && a.mem.veces) || 0) || a.v.localeCompare(b.v); }).slice(0, 8);
  }
  // Lo que se va entendiendo al escribir una fecha o un monto.
  function pistaAc(campo, q) {
    q = String(q || '').trim();
    if (campo === 'fecha') { if (!q) return 'Enter = ' + corta(fechaDefecto()); var f = leerFecha(q, est_.periodo); return f ? '→ ' + Number(f.slice(8)) + ' de ' + MESES_[Number(f.slice(5, 7)) - 1] + ' ' + f.slice(0, 4) : 'Escribe el día (12) o la fecha (12-07)'; }
    if (campo === 'monto') { if (!q) return '450.000 si entró · −450.000 si salió'; var m = leerMonto(q); return m ? (m > 0 ? '↓ entra ' : '↑ sale ') + plata(m) : 'Solo números (puntos y signo menos)'; }
    return '';
  }
  function marcar(v, q) {
    var nq = norm(q).trim(); if (!nq) return txt(v);
    var i = norm(v).indexOf(nq); if (i === -1) return txt(v);
    return txt(v.slice(0, i)) + '<mark>' + txt(v.slice(i, i + nq.length)) + '</mark>' + txt(v.slice(i + nq.length));
  }
  function abrirAc(nuevo) {
    var e = est_.editando; if (!e) { cerrarAc(); return; }
    var campo = COLS[e.c][0], z = lineas()[e.r], q = e.inp.value;
    var items = opcionesAc(campo, q, z), pista = pistaAc(campo, q);
    if (!items.length && !pista) { cerrarAc(); return; }
    if (!ac_) {
      var el = document.createElement('div'); el.className = 'fin5-ac'; el.setAttribute('role', 'listbox'); document.body.appendChild(el);
      ac_ = { el: el, i: -1, items: [] };
      el.addEventListener('mousedown', function (ev) { var it = ev.target.closest('[data-k]'); ev.preventDefault(); if (it) elegirAc(+it.dataset.k, 'derecha'); });
    }
    ac_.items = items; ac_.campo = campo;
    // Se marca la mejor opción cuando es inequívoca: Enter la acepta. En el nombre solo si lo escrito es su comienzo.
    if (nuevo || ac_.i >= items.length) {
      var nq = norm(q).trim();
      ac_.i = !items.length ? -1 : (campo === 'obs' || campo === 'plan' || campo === 'grupo') && nq ? 0 : campo === 'nombre' && (items[0].sugerido && !nq || nq.length >= 2 && norm(items[0].v).indexOf(nq) === 0) ? 0 : -1;
    }
    ac_.el.innerHTML = (pista ? '<div class="fin5-ac__pista">' + txt(pista) + '</div>' : '') + items.map(function (o, k) {
      var tag = o.tecla ? '<kbd>' + o.tecla + '</kbd>' : o.mem && campo === 'nombre' ? '<span class="fin5-ac__mem">' + txt(o.mem.obs + (o.mem.plan ? ' · ' + o.mem.plan : '')) + '</span>' : '';
      return '<div class="fin5-ac__op' + (k === ac_.i ? ' fin5-ac__op--sel' : '') + (o.sugerido ? ' fin5-ac__op--sug' : '') + '" role="option" data-k="' + k + '" aria-selected="' + (k === ac_.i) + '"><div><b>' + marcar(o.v, q) + '</b>' + (o.sub ? '<small>' + txt(o.sub) + '</small>' : '') + '</div>' + tag + '</div>';
    }).join('') + (items.length ? '<div class="fin5-ac__pie"><kbd>↑</kbd><kbd>↓</kbd> elegir · <kbd>Enter</kbd> aceptar · <kbd>Esc</kbd> cerrar</div>' : '');
    var r = e.inp.getBoundingClientRect(), alto = ac_.el.offsetHeight || 240;
    ac_.el.style.minWidth = Math.max(r.width, 280) + 'px';
    ac_.el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 280) - 8)) + 'px';
    ac_.el.style.top = (r.bottom + alto + 8 > window.innerHeight ? Math.max(8, r.top - alto - 6) : r.bottom + 4) + 'px';
    var sel = ac_.el.querySelector('.fin5-ac__op--sel'); if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
  }
  function cerrarAc() { if (ac_) { if (ac_.el.parentNode) ac_.el.parentNode.removeChild(ac_.el); ac_ = null; } }
  function elegirAc(k, hacia) { var it = ac_ && ac_.items[k]; if (!it || !est_.editando) return; est_.editando.inp.value = it.v; cerrarAc(); confirmar(hacia); }
  function moverAc(n) { if (!ac_ || !ac_.items.length) return false; ac_.i = (ac_.i + n + ac_.items.length) % ac_.items.length; abrirAc(false); return true; }

  // ---- pasar filas del banco a otro mes y abrir cualquier mes ---------------------------------------------------
  function moverFilas(ids, p) {
    if (!ids.length) return;
    encolar(function () {
      return x_.api('finanzasHojaMoverMes', { ids: ids, periodo: p }).then(function (r) {
        if (!r || !r.ok) { error(r, 'No se pudo mover.'); return; }
        mensaje(p ? r.data.movidas + ' fila(s) pasada(s) a ' + mesLargo(p) : 'La fila volvió a su mes');
      });
    });
  }
  function irMes(p) {
    if (!/^\d{4}-\d{2}$/.test(p)) return;
    cerrarMeses();
    est_.periodo = p; est_.borrador = {}; est_.temporales = [];
    if ((est_.datos && est_.datos.meses || []).indexOf(p) === -1 && (est_.extras || []).indexOf(p) === -1) est_.extras = (est_.extras || []).concat([p]);
    x_.contexto({ periodo_hoja: p, meses_extra: est_.extras });
    ver(x_);
  }
  var pop_ = null;
  function cerrarMeses() { if (pop_) { if (pop_.el.parentNode) pop_.el.parentNode.removeChild(pop_.el); pop_ = null; } }
  function abrirMeses(btn) {
    if (pop_) { cerrarMeses(); return; }
    var con = {}; (est_.datos.meses || []).forEach(function (m) { con[m] = 1; });
    var el = document.createElement('div'); el.className = 'fin5-pop-meses'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Abrir otro mes');
    document.body.appendChild(el);
    pop_ = { el: el, anio: Number(est_.periodo.slice(0, 4)) || Number(hoy().slice(0, 4)) };
    function pintarPop() {
      var a = pop_.anio, actual = est_.periodo, hoyM = hoy().slice(0, 7);
      el.innerHTML = '<div class="fin5-pop-meses__cab"><button type="button" class="fin5-mini js-pm-ant" aria-label="Año anterior">‹</button><b>' + a + '</b><button type="button" class="fin5-mini js-pm-sig" aria-label="Año siguiente">›</button></div>' +
        '<div class="fin5-pop-meses__grid">' + MESES_.map(function (n, i) {
          var p = a + '-' + ('0' + (i + 1)).slice(-2);
          return '<button type="button" class="fin5-pop-mes js-pm-mes' + (p === actual ? ' fin5-pop-mes--sel' : '') + (p === hoyM ? ' fin5-pop-mes--hoy' : '') + '" data-p="' + p + '">' + txt(n.slice(0, 3)) + (con[p] ? '<i title="Con movimientos"></i>' : '') + '</button>';
        }).join('') + '</div><p class="fin5-nota">Elige el mes que quieras anotar, aunque todavía no tenga movimientos. <i class="fin5-pt fin5-pt--acento"></i> con datos.</p>';
    }
    pintarPop();
    var r = btn.getBoundingClientRect();
    el.style.top = (r.bottom + 6) + 'px'; el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 280)) + 'px';
    el.addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      if (b.classList.contains('js-pm-ant')) { pop_.anio--; pintarPop(); }
      else if (b.classList.contains('js-pm-sig')) { pop_.anio++; pintarPop(); }
      else if (b.classList.contains('js-pm-mes')) irMes(b.dataset.p);
    });
    var primero = el.querySelector('.fin5-pop-mes--sel') || el.querySelector('.js-pm-mes'); if (primero) primero.focus();
  }
  // ---- pegar filas copiadas del Excel ---------------------------------------------------
  // Orden del Excel BANCOS (TOTAL · SALDO · FECHA · DETALLE · PLAN · UNITARIO · OBS · DETALLE BANCO) o el de esta hoja.
  function leerPegado(texto) {
    var filas = String(texto || '').replace(/\r/g, '').split('\n').filter(function (s) { return s.trim(); }).map(function (s) { return s.split('\t'); });
    if (!filas.length || filas[0].length < 3) return null;
    var cab = filas[0].map(function (c) { return String(c).trim().toUpperCase(); });
    var out = [], desde = 0, iF;
    if (cab.indexOf('FECHA') !== -1) { desde = 1; iF = cab.indexOf('FECHA'); } else iF = filas[0].findIndex(function (c) { return /[\/\-.]/.test(c) && leerFecha(c, est_.periodo); });
    if (iF === -1) return null;
    filas.slice(desde).forEach(function (c) {
      var bancos = iF >= 2;
      var f = bancos ? { monto: leerMonto(c[iF - 2]), fecha: leerFecha(c[iF], est_.periodo), alias: c[iF + 1], plan: c[iF + 2], obs: c[iF + 4], glosa: c[iF + 5] }
        : { fecha: leerFecha(c[iF], est_.periodo), alias: c[iF + 1], obs: c[iF + 2], plan: c[iF + 3], monto: leerMonto(c[iF + 4]), grupo: c[iF + 5], fact: c[iF + 6], glosa: c[iF + 7] };
      if (!f.fecha || !f.monto) return;
      var o = String(f.obs || '').trim().toUpperCase();
      f.obs = (est_.datos.listas.obs || []).indexOf(o) !== -1 ? o : '';
      f.alias = String(f.alias || '').trim(); f.plan = planDelCatalogo(f.plan) || String(f.plan || '').trim(); f.glosa = String(f.glosa || '').trim();
      out.push(f);
    });
    return out;
  }
  function pegar(texto) {
    var filas = leerPegado(texto);
    if (!filas) { x_.aviso('No encuentro la fecha en lo pegado. Copia desde la columna TOTAL hasta DETALLE BANCO del Excel.', 'error'); return; }
    if (!filas.length) { x_.aviso('Lo pegado no trae filas con fecha y monto.', 'error'); return; }
    var suma = filas.reduce(function (s, f) { return s + f.monto; }, 0);
    U.confirmar({ titulo: '¿Anotar ' + filas.length + ' fila(s)?', texto: 'Suman ' + plata(suma) + '. Las que ya estén en la cartola se unen solas con el banco.', boton: 'Anotar' }).then(function (si) {
      if (!si) return;
      var lotes = []; for (var i = 0; i < filas.length; i += 300) lotes.push(filas.slice(i, i + 300));
      var total = 0, banco = 0;
      lotes.reduce(function (p, l) { return p.then(function (ok) { if (!ok) return false; return x_.api('finanzasRegistroAnotar', { cuenta_ref: est_.cuenta, filas: l }).then(function (r) { if (!r || !r.ok) { error(r, 'No se pudo anotar.'); return false; } total += r.data.anotadas; banco += r.data.en_banco; return true; }); }); }, Promise.resolve(true))
        .then(function () { if (total) x_.aviso(total + ' fila(s) anotadas · ' + banco + ' unidas con el banco.', 'exito'); recargar(null); });
    });
  }
  function pegarDialogo() {
    var dr = U.drawer({ titulo: 'Pegar filas desde Excel', subtitulo: '<span class="fin2-ayuda">Copia las filas de la planilla BANCOS (desde TOTAL hasta DETALLE BANCO) y pégalas aquí. También puedes pegar directo en la planilla con Ctrl+V.</span>',
      cuerpo: '<div class="fin2-p"><label class="fin2-campo"><span>Filas copiadas</span><textarea class="fin2-input fin4-pegado js-f4-pegado" rows="9" placeholder="Pega aquí (Ctrl+V)"></textarea></label></div>',
      pie: U.boton({ texto: 'Revisar y anotar', icono: 'check', variante: 'primario', clase: 'js-f4-pegado-ok' }) });
    dr.el.querySelector('.js-f4-pegado-ok').addEventListener('click', function () { var t = dr.el.querySelector('.js-f4-pegado').value; dr.cerrar(); pegar(t); });
    dr.el.querySelector('.js-f4-pegado').focus();
  }

  // =====================================================================================
  //  Reportes: FLUJO, saldo por cliente y cobranza
  // =====================================================================================
  var rep_ = { hasta: '', meses: 6, empresa: '', periodo: '', facturas: 'abiertas', vacias: false, buscaCli: '', buscaFact: '', saldos: null, cobros: null };
  function selectorMes(clase, actual, meses, etiqueta) { return '<label class="fin5-select">' + U.ico('calendario', 15) + '<select class="' + clase + '" aria-label="' + txt(etiqueta || 'Mes') + '">' + meses.map(function (m) { return '<option value="' + m + '"' + (m === actual ? ' selected' : '') + '>' + txt(mesLargo(m)) + '</option>'; }).join('') + '</select></label>'; }
  function ultimosMeses(n) { var out = [], a = hoy().slice(0, 7).split('-').map(Number); for (var i = 0; i < n; i++) { var d = new Date(Date.UTC(a[0], a[1] - 1 - i, 1)); out.push(d.toISOString().slice(0, 7)); } return out; }
  // Mismo reporte con otro filtro: se atenúa lo que hay (sin pantalla en blanco) y se cambia solo el cuerpo al llegar.
  function atenuar(vista) { var c = x_.raiz() && x_.raiz().querySelector('.fin5[data-vista="' + vista + '"]'); if (c) c.classList.add('fin5-cargando'); return !!c; }
  function paginaVista(vista, html) {
    var c = x_.raiz() && x_.raiz().querySelector('.fin5[data-vista="' + vista + '"]');
    var t = document.createElement('div'); t.innerHTML = html;
    var cuerpo = t.querySelector('.sx2-pagina__cuerpo');
    if (c && cuerpo) { c.setAttribute('data-quieto', '1'); c.innerHTML = cuerpo.innerHTML; c.classList.remove('fin5-cargando'); return; }
    x_.pagina(html);
    var nuevo = x_.raiz().querySelector('.sx2-pagina__cuerpo.fin5'); if (nuevo) nuevo.setAttribute('data-vista', vista);
  }
  function falla(x, vista, titulo, r) { if (r && !r.boveda_cerrada) x.pagina(x.cab(vista) + vacioHtml('alerta', titulo, (r && r.message) || 'Inténtalo de nuevo.', '<button type="button" class="sx2-boton sx2-boton--secundario sx2-boton--sm js-fin-reintentar">Reintentar</button>')); }

  // ---- FLUJO ------------------------------------------------------------------------------
  function verFlujo(x) {
    x_ = x; enlazar();
    rep_.hasta = rep_.hasta || hoy().slice(0, 7);
    var t = x.turno();
    if (!atenuar('flujo')) x.pagina(x.cab('flujo') + U.esqueleto('tabla', 14));
    x.api('finanzasHojaFlujo', { hasta: rep_.hasta, meses: rep_.meses, empresa: rep_.empresa }).then(function (r) {
      if (!x.vigente(t)) return;
      if (!r || !r.ok) { falla(x, 'flujo', 'No se pudo armar el FLUJO', r); return; }
      rep_.flujo = r.data;
      pintarFlujo();
    });
  }
  function pintarFlujo() {
    var x = x_, d = rep_.flujo, M = d.meses;
    var tot = function (val) { return M.reduce(function (s, m) { return s + ((val || {})[m] || 0); }, 0); };
    function suma(lista) { var o = {}; lista.forEach(function (l) { M.forEach(function (m) { o[m] = (o[m] || 0) + (l.valores[m] || 0); }); }); return o; }
    var ti = suma(d.ingresos), te = suma(d.egresos), mg = {}; M.forEach(function (m) { mg[m] = (ti[m] || 0) - (te[m] || 0); });
    var ocultas = 0;
    function fila(nombre, val, clase, tono, siempre) {
      var vs = M.map(function (m) { return (val || {})[m] || 0; }), total = vs.reduce(function (a, b) { return a + b; }, 0);
      if (!siempre && !rep_.vacias && !vs.some(Boolean)) { ocultas++; return ''; }
      var max = Math.max.apply(null, vs.map(Math.abs).concat([1]));
      return '<tr' + (clase ? ' class="' + clase + '"' : '') + (tono ? ' data-tono="' + tono + '"' : '') + '><th>' + txt(nombre) + '</th>' +
        vs.map(function (v) { return '<td class="fin4-n' + (v ? '' : ' fin4-cero') + '"' + (v && tono && !clase ? ' style="--h:' + (Math.abs(v) / max).toFixed(2) + '"' : '') + '>' + plata(v, '—') + '</td>'; }).join('') +
        '<td class="fin4-n fin4-tot' + (total < 0 ? ' fin2-neg' : '') + '">' + plata(total, '—') + '</td></tr>';
    }
    var sec = function (t2, ico) { return '<tr class="fin4-sec"><th colspan="' + (M.length + 2) + '"><span>' + U.ico(ico, 14) + txt(t2) + '</span></th></tr>'; };
    var avisos = M.filter(function (m) { var z = d.resumen[m]; return z.por_completar || z.falta; }).map(function (m) { var z = d.resumen[m]; return mesLargo(m) + ': ' + [z.falta ? z.falta + ' del banco sin anotar' : '', z.por_completar ? z.por_completar + ' fila(s) por completar' : ''].filter(Boolean).join(', '); });
    var max = Math.max.apply(null, M.map(function (m) { return Math.max(ti[m] || 0, te[m] || 0); }).concat([1]));
    var tI = tot(ti), tE = tot(te), tM = tI - tE;
    var cuerpo = sec('Ingresos', 'tendencia') + d.ingresos.map(function (l) { return fila(l.plan, l.valores, '', 'ok'); }).join('') + fila('Total ingresos', ti, 'fin4-subt', '', true) +
      sec('Egresos', 'dinero') + d.egresos.map(function (l) { return fila(l.plan, l.valores, '', 'critico'); }).join('') + fila('Total egresos', te, 'fin4-subt', '', true) +
      fila('Margen del mes', mg, 'fin4-res', '', true) +
      sec('Fondos de clientes (no son de la empresa)', 'caja') + fila('Recibido de clientes', d.fondos.recibido, '', 'info') + fila('Pagado por cuenta de clientes', d.fondos.pagado, '', 'info') + fila('Lo que sobró, cobrado como honorario', d.fondos.honorario, '', 'ok') + fila('Lo que sobró, a favor del cliente', d.fondos.a_favor, '', 'info') +
      sec('Otros', 'capas') + fila('Traspasos y préstamos', d.otros.traspasos, '', 'neutro') + fila('Sin completar', d.otros.sin_completar, '', 'alerta');
    paginaVista('flujo', x.cab('flujo') + '<div class="sx2-pagina__cuerpo fin4 fin5">' +
      '<div class="fin5-barra fin5-entra" style="--i:0">' + selectorMes('js-f4-hasta', rep_.hasta, ultimosMeses(18), 'Hasta') +
        '<div class="fin5-seg" role="group" aria-label="Meses">' + [3, 6, 12].map(function (n) { return '<button type="button" class="js-f5-nmeses" data-n="' + n + '" aria-pressed="' + (n === rep_.meses) + '">' + n + ' meses</button>'; }).join('') + '</div>' +
        '<label class="fin5-select">' + U.ico('empresa', 15) + '<select class="js-f4-empresa" aria-label="Empresa"><option value="">Todo el grupo</option>' + d.empresas.map(function (e) { return '<option' + (e === rep_.empresa ? ' selected' : '') + '>' + txt(e) + '</option>'; }).join('') + '</select></label>' +
      '</div>' +
      '<section class="fin5-kpis" aria-label="Totales del período">' +
        kpi({ clave: 'fl-i', t: 'Ingresos', v: tI, ico: 'tendencia', tono: 'ok', sub: M.length + ' meses' }, 1) + kpi({ clave: 'fl-e', t: 'Egresos', v: -tE, ico: 'dinero', tono: 'critico', sub: 'gastos con plan de cuenta' }, 2) +
        kpi({ clave: 'fl-m', t: 'Margen', v: tM, ico: 'destello', tono: 'acento', sub: tI ? Math.round(tM / tI * 100) + '% de los ingresos' : '' }, 3) + kpi({ clave: 'fl-f', t: 'Fondos de clientes', v: tot(d.fondos.recibido), ico: 'caja', tono: 'info', sub: 'recibidos (aparte)' }, 4) +
      '</section>' +
      (avisos.length ? '<div class="fin5-aviso fin5-aviso--alerta fin5-entra" style="--i:4">' + U.ico('alerta', 16) + '<span><b>Hay filas sin completar</b> que todavía no entran al FLUJO. ' + txt(avisos.join(' · ')) + '</span></div>' : '') +
      '<section class="fin5-card fin5-entra" style="--i:5"><header class="fin5-card__cab"><h2>Ingresos y egresos por mes</h2><div class="fin5-leyenda"><span><i class="fin5-pt fin5-pt--ok"></i>Ingresos</span><span><i class="fin5-pt fin5-pt--critico"></i>Egresos</span><span><i class="fin5-pt fin5-pt--acento"></i>Margen</span></div></header>' +
        '<div class="fin5-graf" role="img" aria-label="Ingresos y egresos de los últimos ' + M.length + ' meses">' + M.map(function (m, k) {
          var a = ti[m] || 0, b = te[m] || 0, g = mg[m];
          return '<div class="fin5-graf__col" style="--i:' + k + '" tabindex="0"><div class="fin5-graf__barras">' +
            '<span class="fin5-bar fin5-bar--ing"' + crece('fi-' + m + rep_.empresa, a / max * 100, 'height') + '></span><span class="fin5-bar fin5-bar--egr"' + crece('fe-' + m + rep_.empresa, b / max * 100, 'height') + '></span>' +
            '<div class="fin5-graf__tip" role="tooltip"><b>' + txt(mesLargo(m)) + '</b><span><i class="fin5-pt fin5-pt--ok"></i>Ingresos ' + plata(a) + '</span><span><i class="fin5-pt fin5-pt--critico"></i>Egresos ' + plata(b) + '</span><span><i class="fin5-pt fin5-pt--acento"></i>Margen ' + plata(g) + '</span></div></div>' +
            '<b class="fin5-graf__m' + (g < 0 ? ' fin2-neg' : '') + '">' + (g > 0 ? '+' : '') + plata(g, '—') + '</b><span class="fin5-graf__mes">' + txt(mesCorto(m)) + '</span></div>';
        }).join('') + '</div></section>' +
      '<section class="fin5-card fin5-entra" style="--i:6"><header class="fin5-card__cab"><h2>Por plan de cuenta</h2><button type="button" class="fin5-chip js-f5-vacias" aria-pressed="' + rep_.vacias + '">' + U.ico(rep_.vacias ? 'ojo' : 'filtro', 13) + '<b class="js-f5-vacias-t"></b></button></header>' +
        '<div class="fin4-rep fin5-flujo"><table class="fin4-tab"><thead><tr><th>Plan de cuenta</th>' + M.map(function (m) { return '<th class="fin4-n">' + txt(mesCorto(m)) + '</th>'; }).join('') + '<th class="fin4-n">Total</th></tr></thead><tbody>' + cuerpo + '</tbody></table></div></section>' +
      '<p class="fin5-nota">Sale solo de la planilla: cada fila cae en su plan de cuenta. El dinero de los clientes (IVA, imposiciones) va aparte, para no inflar los ingresos ni los gastos.</p></div>');
    var bt = x.raiz().querySelector('.js-f5-vacias-t'); if (bt) bt.textContent = rep_.vacias ? 'Ocultar planes sin movimiento' : 'Mostrar ' + ocultas + ' plan(es) sin movimiento';
    activar(x.raiz());
  }

  // ---- Saldo por cliente ----------------------------------------------------------------
  function verSaldos(x) {
    x_ = x; enlazar();
    rep_.periodo = rep_.periodo || hoy().slice(0, 7);
    var t = x.turno();
    if (!atenuar('saldos')) x.pagina(x.cab('saldos') + U.esqueleto('tabla', 12));
    x.api('finanzasHojaClientes', { periodo: rep_.periodo }).then(function (r) {
      if (!x.vigente(t)) return;
      if (!r || !r.ok) { falla(x, 'saldos', 'No se pudo calcular', r); return; }
      rep_.saldos = r.data;
      var d = r.data, l = d.clientes;
      var tot = l.reduce(function (s, c) { s.saldo += c.saldo; s.deuda += c.deuda; s.hon += c.honorarios_mes; if (c.saldo < 0) s.neg++; return s; }, { saldo: 0, deuda: 0, hon: 0, neg: 0 });
      paginaVista('saldos', x.cab('saldos') + '<div class="sx2-pagina__cuerpo fin4 fin5">' +
        '<div class="fin5-barra fin5-entra" style="--i:0">' + selectorMes('js-f4-periodo', rep_.periodo, ultimosMeses(18), 'Hasta') + '<span class="fin5-barra__mes">Saldo acumulado desde ' + txt(mesLargo(d.desde)) + '</span></div>' +
        '<section class="fin5-kpis" aria-label="Totales">' +
          kpi({ clave: 'sc-s', t: 'Dinero de clientes en la cuenta', v: tot.saldo, ico: 'caja', tono: 'acento', sub: 'recibido − pagado − cobrado' }, 1) +
          kpi({ clave: 'sc-h', t: 'Honorarios de ' + mesLargo(d.periodo), v: tot.hon, ico: 'dinero', tono: 'ok' }, 2) +
          kpi({ clave: 'sc-d', t: 'Facturas por cobrar', v: tot.deuda, ico: 'recibo', tono: 'alerta' }, 3) +
          kpi({ clave: 'sc-n', t: 'Clientes en negativo', v: tot.neg, fmt: 'n', ico: 'alerta', tono: tot.neg ? 'critico' : 'neutro', sub: 'se pagó más de lo que mandaron' }, 4) +
        '</section>' +
        (l.length ? '<section class="fin5-card fin5-entra" style="--i:5"><header class="fin5-card__cab"><h2>' + l.length + ' cliente(s)</h2><label class="fin5-buscar">' + U.ico('lupa', 15) + '<input type="search" class="js-f5-buscar-cli" placeholder="Buscar cliente…" value="' + txt(rep_.buscaCli) + '" aria-label="Buscar cliente"></label></header>' +
          '<div class="fin4-rep"><table class="fin4-tab fin5-tab-cli"><thead><tr><th>Cliente</th><th class="fin4-n">Honorarios del mes</th><th class="fin4-n">Fondos recibidos</th><th class="fin4-n">Pagado por él</th><th class="fin4-n">Sobró, cobrado</th><th class="fin5-col-saldo">Saldo de fondos</th><th class="fin4-n">Debe en facturas</th></tr></thead><tbody class="js-f5-cli">' + cuerpoSaldos() + '</tbody></table></div></section>'
          : vacioHtml('equipo', 'Sin clientes con movimiento', 'Aparecen cuando la planilla tiene filas con su nombre.')) +
        '<p class="fin5-nota">Saldo de fondos = lo que el cliente mandó para sus obligaciones − lo que se pagó por él − lo que sobró y se cobró como honorario. Un saldo negativo es dinero que hay que pedirle. «Sin ficha»: el nombre de la planilla no está enlazado a un cliente de SIGSO.</p></div>');
      activar(x.raiz());
    });
  }
  function cuerpoSaldos() {
    var l = rep_.saldos.clientes, q = norm(rep_.buscaCli).trim();
    var max = Math.max.apply(null, l.map(function (c) { return Math.abs(c.saldo); }).concat([1]));
    var ver = l.filter(function (c) { return !q || norm(c.cliente).indexOf(q) !== -1; });
    if (!ver.length) return '<tr class="fin5-sin"><td colspan="7">' + U.ico('lupa', 16) + ' Ningún cliente coincide con «' + txt(rep_.buscaCli) + '».</td></tr>';
    return ver.map(function (c, i) {
      var pct = Math.abs(c.saldo) / max * 50;
      return '<tr style="--i:' + Math.min(i, 24) + '"><th><span class="fin5-cli"><span class="fin5-avatar" data-tono="' + (c.cliente.charCodeAt(0) % 5) + '">' + txt(iniciales(c.cliente)) + '</span><span class="fin5-cli__n">' + txt(c.cliente) + (c.sin_ficha ? '<small class="fin5-etq">sin ficha</small>' : '') + '</span></span></th>' +
        '<td class="fin4-n">' + plata(c.honorarios_mes, '—') + '</td><td class="fin4-n">' + plata(c.recibido, '—') + '</td><td class="fin4-n">' + plata(c.pagado, '—') + '</td><td class="fin4-n">' + plata(c.cobrado, '—') + '</td>' +
        '<td class="fin5-col-saldo"><div class="fin5-saldo"><div class="fin5-div"><span class="fin5-div__eje"></span><span class="fin5-div__bar fin5-div__bar--' + (c.saldo < 0 ? 'neg' : 'pos') + '" style="width:' + pct.toFixed(1) + '%"></span></div><b class="' + (c.saldo < 0 ? 'fin2-neg' : '') + '">' + plata(c.saldo, '—') + '</b></div></td>' +
        '<td class="fin4-n ' + (c.deuda ? 'fin2-neg' : '') + '">' + plata(c.deuda, '—') + (c.facturas ? ' <small class="fin5-etq">' + c.facturas + '</small>' : '') + '</td></tr>';
    }).join('');
  }

  // ---- Cobranza ---------------------------------------------------------------------------
  function verCobros(x) {
    x_ = x; enlazar();
    var t = x.turno();
    if (!atenuar('cobros')) x.pagina(x.cab('cobros') + U.esqueleto('tabla', 12));
    x.api('finanzasHojaCobranza', { estado: rep_.facturas }).then(function (r) {
      if (!x.vigente(t)) return;
      if (!r || !r.ok) { falla(x, 'cobros', 'No se pudo cargar la cobranza', r); return; }
      rep_.cobros = r.data;
      var d = r.data, T = d.totales;
      var porVencer = Math.max(0, T.por_cobrar - T.vencido), base = T.pagado + T.por_cobrar || 1;
      var seg = function (cl, v, clave) { return v ? '<span class="fin5-pila__' + cl + '"' + crece(clave, v / base * 100, 'width') + ' title="' + plata(v) + '"></span>' : ''; };
      paginaVista('cobros', x.cab('cobros', U.boton({ texto: 'Subir facturas o ventas del SII', icono: 'subir', sm: true, variante: 'primario', clase: 'js-f4-cargar', datos: { cap: 'REGISTRAR' } })) + '<div class="sx2-pagina__cuerpo fin4 fin5">' +
        '<section class="fin5-kpis" aria-label="Totales de cobranza">' +
          kpi({ clave: 'co-f', t: 'Facturado', v: T.facturado, ico: 'recibo', tono: 'neutro', sub: d.total_facturas + ' factura(s)' }, 1) +
          kpi({ clave: 'co-p', t: 'Pagado', v: T.pagado, ico: 'check', tono: 'ok', sub: T.facturado ? Math.round(T.pagado / T.facturado * 100) + '% de lo facturado' : '' }, 2) +
          kpi({ clave: 'co-c', t: 'Por cobrar', v: T.por_cobrar, ico: 'reloj', tono: 'acento' }, 3) +
          kpi({ clave: 'co-v', t: 'Vencido', v: T.vencido, ico: 'alerta', tono: T.vencido ? 'critico' : 'neutro', sub: T.por_cobrar ? Math.round(T.vencido / T.por_cobrar * 100) + '% de lo por cobrar' : '' }, 4) +
        '</section>' +
        (T.facturado ? '<section class="fin5-card fin5-entra" style="--i:5"><header class="fin5-card__cab"><h2>Estado de lo facturado</h2><div class="fin5-leyenda"><span><i class="fin5-pt fin5-pt--ok"></i>Pagado ' + plata(T.pagado) + '</span><span><i class="fin5-pt fin5-pt--info"></i>Por vencer ' + plata(porVencer) + '</span><span><i class="fin5-pt fin5-pt--critico"></i>Vencido ' + plata(T.vencido) + '</span></div></header>' +
          '<div class="fin5-pila" role="img" aria-label="Pagado ' + plata(T.pagado) + ', por vencer ' + plata(porVencer) + ', vencido ' + plata(T.vencido) + '">' + seg('ok', T.pagado, 'pila-p') + seg('info', porVencer, 'pila-v') + seg('critico', T.vencido, 'pila-x') + '</div></section>' : '') +
        '<section class="fin5-card fin5-entra" style="--i:6"><header class="fin5-card__cab">' + U.segmento([{ id: 'abiertas', texto: 'Por cobrar' }, { id: 'todas', texto: 'Todas' }], rep_.facturas, 'js-f4-fact') +
          '<span class="fin5-barra__mes">' + d.facturas.length + ' de ' + d.total_facturas + ' factura(s)</span>' +
          '<label class="fin5-buscar">' + U.ico('lupa', 15) + '<input type="search" class="js-f5-buscar-fact" placeholder="Buscar folio, cliente o empresa…" value="' + txt(rep_.buscaFact) + '" aria-label="Buscar factura"></label></header>' +
          (d.facturas.length ? '<div class="fin4-rep"><table class="fin4-tab fin5-tab-fact"><thead><tr><th>N°</th><th>Cliente</th><th>Empresa</th><th>Emisión</th><th>Vence</th><th class="fin4-n">Total</th><th class="fin5-col-pago">Pagado</th><th class="fin4-n">Saldo</th><th>Estado</th></tr></thead><tbody class="js-f5-fact">' + cuerpoCobros() + '</tbody></table></div>'
            : vacioHtml('recibo', rep_.facturas === 'abiertas' ? 'No hay facturas por cobrar' : 'Todavía no hay facturas', 'Las facturas entran con el Registro de Ventas del SII o la hoja FACTURAS de la planilla, en «Subir archivos».')) +
        '</section>' +
        '<p class="fin5-nota">Una factura queda pagada cuando, en la planilla, la fila del abono lleva su número en la columna «N° factura» (varias: «1052-1053»). No hay otra hoja de pagos que llenar.</p></div>');
      x.aplicarCapacidades(x.raiz());
      activar(x.raiz());
    });
  }
  function diasDesde(iso) { var a = Date.parse(iso + 'T00:00:00Z'), b = Date.parse(hoy() + 'T00:00:00Z'); return isNaN(a) ? 0 : Math.round((b - a) / 864e5); }
  function cuerpoCobros() {
    var q = norm(rep_.buscaFact).trim();
    var tono = { Pagada: 'ok', Parcial: 'info', Vencida: 'critico', Pendiente: 'neutro', Incobrable: 'neutro' };
    var ver = rep_.cobros.facturas.filter(function (f) { return !q || norm([f.folio, f.cliente, f.empresa].join(' ')).indexOf(q) !== -1; });
    if (!ver.length) return '<tr class="fin5-sin"><td colspan="9">' + U.ico('lupa', 16) + ' Ninguna factura coincide con «' + txt(rep_.buscaFact) + '».</td></tr>';
    return ver.map(function (f, i) {
      var pct = f.total ? Math.min(100, f.pagado / f.total * 100) : 0, dias = f.estado === 'Vencida' ? diasDesde(f.vence) : 0;
      return '<tr style="--i:' + Math.min(i, 24) + '"' + (f.estado === 'Vencida' ? ' class="fin5-fila-vencida"' : '') + '><th class="fin5-folio">' + txt(f.folio) + '</th>' +
        '<td><span class="fin5-cli"><span class="fin5-avatar" data-tono="' + (String(f.cliente || '?').charCodeAt(0) % 5) + '">' + txt(iniciales(f.cliente)) + '</span><span class="fin5-cli__n">' + txt(f.cliente) + '</span></span></td>' +
        '<td><span class="fin5-etq">' + txt(f.empresa) + '</span></td><td class="fin2-num">' + txt(corta(f.fecha) + '-' + String(f.fecha).slice(2, 4)) + '</td>' +
        '<td class="fin2-num">' + txt(f.vence ? corta(f.vence) + '-' + String(f.vence).slice(2, 4) : '') + (dias > 0 ? '<small class="fin5-atraso">hace ' + dias + ' d</small>' : '') + '</td>' +
        '<td class="fin4-n">' + plata(f.total) + '</td>' +
        '<td class="fin5-col-pago"><div class="fin5-progreso fin5-progreso--' + (pct >= 100 ? 'ok' : 'info') + '"><span style="width:' + pct.toFixed(1) + '%"></span></div><small>' + plata(f.pagado, '—') + '</small></td>' +
        '<td class="fin4-n"><b>' + plata(f.saldo, '—') + '</b></td><td>' + U.badge(f.estado, tono[f.estado] || 'neutro') + '</td></tr>';
    }).join('');
  }

  // =====================================================================================
  //  Eventos
  // =====================================================================================
  var enlazado_ = false;
  function enHoja() { return !!(x_ && x_.raiz() && x_.raiz().querySelector('.fin4-hoja')); }
  function enlazar() {
    if (enlazado_) return; enlazado_ = true;
    var raiz = document.getElementById('modulo-finanzas');
    raiz.addEventListener('click', function (ev) {
      var t = ev.target;
      var b = t.closest('button');
      if (b && b.classList.contains('js-f4-mes')) { if (b.dataset.mes !== est_.periodo) irMes(b.dataset.mes); return; }
      if (b && b.classList.contains('js-f5-mes-mas')) { abrirMeses(b); return; }
      if (b && b.classList.contains('js-f5-col-ayuda')) { ev.stopPropagation(); abrirAyudaCol(b); return; }
      if (b && b.classList.contains('js-f5-paso')) { irPaso(b.dataset.paso); return; }
      if (b && b.classList.contains('js-f5-revisar')) { abrirRevision(); return; }
      if (b && b.classList.contains('js-f5-resolver')) { resolverObs(+b.dataset.i); return; }
      if (b && b.classList.contains('js-f5-tour')) { tour(true); return; }
      if (b && b.classList.contains('js-f5-oferta')) { aplicarOferta(); return; }
      if (b && b.classList.contains('js-f5-completar')) { if (est_.editando) confirmar(); seleccionar(+b.dataset.i, colDe(b.dataset.col)); editar(); return; }
      if (b && b.classList.contains('js-f5-mover')) { moverFilas([b.dataset.id], b.dataset.p); return; }
      if (b && b.classList.contains('js-f5-ver-ini')) { est_.filtro = 'falta'; filtrar(); return; }
      if (b && b.classList.contains('js-f5-mover-ini')) {
        var ids = String(b.dataset.ids || '').split(',').filter(Boolean), p = b.dataset.p;
        U.confirmar({ titulo: '¿Pasar ' + ids.length + ' movimiento(s) a ' + mesLargo(p) + '?', texto: 'Se verán en la planilla de ' + mesLargo(p) + ' (la cartola no cambia). Cada uno se puede devolver a su mes desde la fila.', boton: 'Pasar' }).then(function (si) { if (si) moverFilas(ids, p); });
        return;
      }
      if (b && b.classList.contains('js-f4-cargar')) { x_.ir('cargas'); return; }
      if (b && b.classList.contains('js-f4-pegar')) { pegarDialogo(); return; }
      if (b && b.classList.contains('js-f4-excel')) { descargarExcel(b); return; }
      if (b && b.classList.contains('js-f4-fact')) { rep_.facturas = b.dataset.id || rep_.facturas; verCobros(x_); return; }
      if (b && b.classList.contains('js-f5-filtro')) { est_.filtro = b.dataset.f; filtrar(); return; }
      if (b && b.classList.contains('js-f5-limpiar')) { est_.filtro = 'todas'; est_.busca = ''; var bi = x_.raiz().querySelector('.js-f5-buscar'); if (bi) bi.value = ''; filtrar(); return; }
      if (b && b.classList.contains('js-f5-vacias')) { rep_.vacias = !rep_.vacias; pintarFlujo(); return; }
      if (b && b.classList.contains('js-f5-nmeses')) { rep_.meses = Number(b.dataset.n); verFlujo(x_); return; }
      var cel = t.closest('.fin4-hoja td.fin4-cel');
      if (cel && !t.closest('input')) {
        if (est_.editando) confirmar();
        seleccionar(+cel.dataset.r, +cel.dataset.c, true);
        if (ev.detail >= 2) editar();
      }
    });
    // Fuera de la celda en edición o del selector de meses: se cierran (lo escrito se guarda, como en Excel).
    document.addEventListener('mousedown', function (ev) {
      if (pop_ && !pop_.el.contains(ev.target) && !ev.target.closest('.js-f5-mes-mas')) cerrarMeses();
      if (popA_ && !popA_.el.contains(ev.target) && !ev.target.closest('.js-f5-col-ayuda')) cerrarAyudaCol();
      if (est_.editando && !ev.target.closest('.fin4-editor') && !ev.target.closest('.fin5-ac') && !ev.target.closest('.fin4-hoja td.fin4-cel')) confirmar();
    });
    window.addEventListener('resize', function () { if (ac_) abrirAc(false); cerrarMeses(); cerrarAyudaCol(); });
    document.addEventListener('scroll', function (ev) { if (ac_) abrirAc(false); if (popA_ && !popA_.el.contains(ev.target)) cerrarAyudaCol(); }, true);
    raiz.addEventListener('input', function (ev) {
      var t = ev.target;
      if (t.classList.contains('js-f5-buscar')) { est_.busca = t.value; filtrar(true); }
      else if (t.classList.contains('js-f5-buscar-cli')) { rep_.buscaCli = t.value; var tb = x_.raiz().querySelector('.js-f5-cli'); if (tb) tb.innerHTML = cuerpoSaldos(); }
      else if (t.classList.contains('js-f5-buscar-fact')) { rep_.buscaFact = t.value; var tf = x_.raiz().querySelector('.js-f5-fact'); if (tf) tf.innerHTML = cuerpoCobros(); }
    });
    raiz.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.classList.contains('js-f4-cuenta')) { est_.cuenta = t.value; est_.borrador = {}; x_.contexto({ cuenta_ref: t.value }); ver(x_); }
      else if (t.classList.contains('js-f4-decision')) {
        x_.api('finanzasHojaGrupo', { cuenta_ref: est_.cuenta, periodo: est_.periodo, letra: t.dataset.letra, decision: t.value }).then(function (r) { if (!r || !r.ok) error(r, 'No se pudo guardar.'); recargar(null); });
      }
      else if (t.classList.contains('js-f4-hasta')) { rep_.hasta = t.value; verFlujo(x_); }
      else if (t.classList.contains('js-f4-empresa')) { rep_.empresa = t.value; verFlujo(x_); }
      else if (t.classList.contains('js-f4-periodo')) { rep_.periodo = t.value; verSaldos(x_); }
    });
    // Teclado de planilla: solo cuando la hoja está en pantalla y no hay un diálogo abierto.
    document.addEventListener('keydown', function (ev) {
      if (pop_ && ev.key === 'Escape') { cerrarMeses(); return; }
      if (popA_ && ev.key === 'Escape') { var bA = popA_.btn; cerrarAyudaCol(); bA.focus(); return; }
      if (!enHoja() || document.querySelector('.sx2-drawer, .sx2-dialogo')) return;
      if (est_.editando) {
        var abierta = ac_ && ac_.items.length;
        if (abierta && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) { ev.preventDefault(); moverAc(ev.key === 'ArrowDown' ? 1 : -1); }
        else if (ev.key === 'Enter') { ev.preventDefault(); if (abierta && ac_.i >= 0) elegirAc(ac_.i, 'abajo'); else confirmar('abajo'); }
        else if (ev.key === 'Tab') { ev.preventDefault(); if (abierta && ac_.i >= 0 && !ev.shiftKey) elegirAc(ac_.i, 'derecha'); else confirmar(ev.shiftKey ? 'izquierda' : 'derecha'); }
        else if (ev.key === 'Escape') { ev.preventDefault(); if (abierta && ac_.i >= 0) { ac_.i = -1; cerrarAc(); } else { cancelar(); seleccionar(est_.sel.r, est_.sel.c); } }
        return;
      }
      var a = document.activeElement;
      if (a && a !== document.body && !x_.raiz().contains(a)) return;
      if (a && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(a.tagName)) return;
      var k = ev.key, s = est_.sel;
      if (k === 'ArrowDown') { ev.preventDefault(); seleccionar(s.r + 1, s.c); }
      else if (k === 'ArrowUp') { ev.preventDefault(); seleccionar(s.r - 1, s.c); }
      else if (k === 'ArrowRight' || (k === 'Tab' && !ev.shiftKey)) { ev.preventDefault(); seleccionar(s.r, s.c + 1); }
      else if (k === 'ArrowLeft' || (k === 'Tab' && ev.shiftKey)) { ev.preventDefault(); seleccionar(s.r, s.c - 1); }
      else if ((k === 'd' || k === 'D') && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); copiarArriba(); }
      else if (k === 'Enter' && lineas()[s.r] && lineas()[s.r].nueva && listo()) { ev.preventDefault(); guardarNueva(); }
      else if (k === 'Enter' || k === 'F2') { ev.preventDefault(); editar(); }
      else if (k === 'Delete' || k === 'Backspace') { ev.preventDefault(); borrarCelda(); }
      else if (k.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) { ev.preventDefault(); editar(k); }
    });
    document.addEventListener('paste', function (ev) {
      if (!enHoja() || est_.editando || !editable() || document.querySelector('.sx2-drawer, .sx2-dialogo')) return;
      var a = document.activeElement; if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName)) return;
      var t = (ev.clipboardData || window.clipboardData).getData('text');
      if (/\t/.test(t)) { ev.preventDefault(); pegar(t); }
    });
  }
  window.SigsoFinanzasHoja = { ver: ver, verFlujo: verFlujo, verSaldos: verSaldos, verCobros: verCobros };
})();
