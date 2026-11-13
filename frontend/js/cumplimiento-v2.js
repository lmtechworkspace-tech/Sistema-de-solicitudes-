/**
 * cumplimiento-v2.js — pantallas del ÍNDICE DE CUMPLIMIENTO por responsable
 * (Plan de control y certificación, P3; backend getCumplimientoResponsables).
 *
 * Un solo componente que se pinta en tres lugares:
 *  - Mi trabajo → «Mi cumplimiento» (alcance 'yo'): cada persona ve su número
 *    antes que nadie, con qué lo sube y qué lo baja.
 *  - Mi departamento / Equipo del área → «Cumplimiento del equipo» ('equipo').
 *  - Panel de gerencia → «Cumplimiento por responsable» ('empresa').
 * En las listas, un clic en una persona abre su detalle (con «Volver»).
 *
 * v2 visual (13-11-2026): el titular explica el número en puntos (cuánto
 * aporta y cuánto resta cada componente), con la tendencia de 6 meses; lo
 * que bajó el índice va primero, con los días de atraso; las listas llevan el
 * reparto verde/amarillo/rojo, la variación contra el mes anterior, filtros y
 * celdas con color por componente. En el celular la tabla pasa a tarjetas.
 *
 * Reglas de la pantalla (decisiones del dueño): cada número se abre hasta la
 * tarea; las señales se muestran siempre; la lista va en orden alfabético,
 * nunca como ranking.
 *
 * Uso: SigsoCumplimiento.montar(elemento, { alcance: 'yo'|'equipo'|'empresa' })
 * o un marcador <div data-cumpl-host data-alcance="…"> + montarPendientes().
 */
(function () {
  'use strict';

  var U = window.UIv2;
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var TONO = { ok: 'ok', alerta: 'alerta', critico: 'critico', sin_dato: 'neutro' };
  var ESTADO_TXT = { ok: 'Cumple', alerta: 'En observación', critico: 'Bajo lo esperado', sin_dato: 'Sin datos suficientes' };
  var ICONO_COMP = { A: 'calendario', B: 'tareas', C: 'escudo', D: 'documento' };
  var MALOS = { 'Tarde': 1, 'Atrasada': 1, 'Sin hacer': 1, 'Dormida': 1 };
  var FILTROS = [
    { id: '', texto: 'Todos' },
    { id: 'critico', texto: 'Bajo 75 %' },
    { id: 'alerta', texto: 'En observación' },
    { id: 'dormidas', texto: 'Con tareas dormidas' }
  ];

  function api(accion, datos) {
    return llamarApi((window.SIGSO_CONFIG || {}).BACKOFFICE_URL, accion, datos || {}).catch(function (e) {
      return { ok: false, message: (e && e.message) || 'No se pudo conectar.' };
    });
  }
  var esc = function (s) { return U.esc(s); };
  function hoyClave() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
  function hoyPeriodo() { return hoyClave().slice(0, 7); }
  function moverPeriodo(p, k) {
    var a = Number(p.slice(0, 4)), m = Number(p.slice(5, 7)) - 1 + k;
    a += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return a + '-' + String(m + 1).padStart(2, '0');
  }
  function nombrePeriodo(p) { return MESES[Number(p.slice(5, 7)) - 1] + ' ' + p.slice(0, 4); }
  function mesCorto(p) { return MES_CORTO[Number(p.slice(5, 7)) - 1]; }
  function fecha(d) { return d ? d.slice(8, 10) + '-' + d.slice(5, 7) + '-' + d.slice(0, 4) : '—'; }
  function fechaCorta(d) { return d ? Number(d.slice(8, 10)) + ' ' + MES_CORTO[Number(d.slice(5, 7)) - 1] : '—'; }
  function num(n) { return String(Math.round(n * 10) / 10).replace('.', ','); }
  function pctTxt(p) { return p === null || p === undefined ? '—' : num(p) + ' %'; }
  function dias(desde, hasta) { return Math.round((Date.parse(hasta + 'T00:00:00Z') - Date.parse(desde + 'T00:00:00Z')) / 864e5); }
  function tonoDe(p) { return p === null || p === undefined ? 'neutro' : (p >= 90 ? 'ok' : (p >= 75 ? 'alerta' : 'critico')); }
  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }

  /** Cuánto aporta cada componente al índice: puntos ganados y perdidos sobre 100. */
  function aportes(r) {
    var usados = r.componentes.filter(function (c) { return c.aplica; });
    var total = usados.reduce(function (s, c) { return s + c.peso; }, 0);
    return r.componentes.map(function (c) {
      var cuota = c.aplica && total ? c.peso * 100 / total : 0;
      var gana = cuota * (c.pct || 0) / 100;
      return { clave: c.clave, nombre: c.nombre, cuota: cuota, gana: gana, pierde: cuota - gana, aplica: c.aplica };
    });
  }
  /** Atraso legible de un caso que salió mal. */
  function atraso(x, hoy) {
    var meta = x.meta || x.plazo || x.fecha;
    var hecho = x.entregada || x.hecho;
    if (x.estado === 'Dormida') return 'sin movimiento';
    if (!meta) return '';
    if (hecho) { var d1 = dias(meta, hecho); return d1 > 0 ? plural(d1, 'día tarde', 'días tarde') : ''; }
    var d2 = dias(meta, hoy);
    return d2 > 0 ? 'vencida hace ' + plural(d2, 'día', 'días') : '';
  }

  // --- piezas comunes -----------------------------------------------------------------
  function selectorPeriodo(st) {
    var esActual = st.periodo >= hoyPeriodo();
    return '<div class="cu2-periodo" role="group" aria-label="Mes">' +
      U.boton({ soloIcono: true, icono: 'izquierda', titulo: 'Mes anterior', clase: 'js-cu2-mes', datos: { k: -1 }, sm: true }) +
      '<strong class="cu2-periodo__txt">' + esc(nombrePeriodo(st.periodo)) + '</strong>' +
      U.boton({ soloIcono: true, icono: 'derecha', titulo: 'Mes siguiente', clase: 'js-cu2-mes', datos: { k: 1 }, sm: true, deshabilitado: esActual }) +
      (esActual ? '' : U.boton({ texto: 'Este mes', variante: 'fantasma', sm: true, clase: 'js-cu2-hoy' })) +
    '</div>';
  }
  function variacion(actual, anterior, etiqueta) {
    if (actual === null || actual === undefined || anterior === null || anterior === undefined) return '';
    var d = Math.round((actual - anterior) * 10) / 10;
    if (Math.abs(d) < 0.1) return '<span class="cu2-var cu2-var--igual" title="' + esc(etiqueta) + '">= igual que ' + esc(etiqueta) + '</span>';
    var sube = d > 0;
    return '<span class="cu2-var cu2-var--' + (sube ? 'sube' : 'baja') + '" title="Contra ' + esc(etiqueta) + '">' +
      U.ico(sube ? 'arriba' : 'abajo', 12) + (sube ? '+' : '−') + num(Math.abs(d)) + ' pts vs ' + esc(etiqueta) + '</span>';
  }

  /** Variación compacta para la tabla: solo la flecha y los puntos (nada si no cambió). */
  function varCorta(actual, anterior, etiqueta) {
    if (actual === null || actual === undefined || anterior === null || anterior === undefined) return '';
    var d = Math.round((actual - anterior) * 10) / 10;
    if (Math.abs(d) < 0.1) return '';
    var sube = d > 0;
    return '<span class="cu2-var cu2-var--' + (sube ? 'sube' : 'baja') + '" title="' + esc((sube ? '+' : '−') + num(Math.abs(d)) + ' pts contra ' + etiqueta) + '">' +
      U.ico(sube ? 'arriba' : 'abajo', 11) + num(Math.abs(d)) + '</span>';
  }

  /** Tendencia de 6 meses en SVG (escala fija 0-100 con las líneas de 75 y 90). */
  function tendencia(historial) {
    // Las etiquetas 75 y 90 van a la IZQUIERDA (PL): a la derecha chocaban con el último punto.
    var W = 270, H = 96, PL = 28, PR = 12, PT = 12, PB = 22;
    var n = historial.length;
    var x = function (i) { return PL + (n === 1 ? (W - PL - PR) / 2 : i * (W - PL - PR) / (n - 1)); };
    var y = function (v) { return PT + (100 - v) * (H - PT - PB) / 100; };
    var pts = historial.map(function (h, i) { return h.indice === null ? null : { x: x(i), y: y(h.indice), h: h }; });
    var tramos = [], actual = [];
    pts.forEach(function (p) { if (p) actual.push(p); else if (actual.length) { tramos.push(actual); actual = []; } });
    if (actual.length) tramos.push(actual);
    var linea = tramos.map(function (t) { return '<polyline class="cu2-tend__linea" points="' + t.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ') + '"/>'; }).join('');
    var area = tramos.filter(function (t) { return t.length > 1; }).map(function (t) {
      return '<polygon class="cu2-tend__area" points="' + t[0].x.toFixed(1) + ',' + y(0).toFixed(1) + ' ' + t.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ') + ' ' + t[t.length - 1].x.toFixed(1) + ',' + y(0).toFixed(1) + '"/>';
    }).join('');
    var puntos = pts.map(function (p, i) {
      if (!p) return '';
      var ultimo = i === n - 1;
      return '<circle class="cu2-tend__punto cu2-tend__punto--' + TONO[p.h.estado] + (ultimo ? ' cu2-tend__punto--ult' : '') + '" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (ultimo ? 4.5 : 3) + '">' +
        '<title>' + esc(nombrePeriodo(p.h.periodo) + ': ' + pctTxt(p.h.indice)) + '</title></circle>';
    }).join('');
    var etiquetas = historial.map(function (h, i) {
      return '<text class="cu2-tend__mes" x="' + x(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(mesCorto(h.periodo)) + '</text>';
    }).join('');
    var guias = [90, 75].map(function (v) {
      return '<line class="cu2-tend__guia cu2-tend__guia--' + (v === 90 ? 'ok' : 'alerta') + '" x1="' + PL + '" x2="' + (W - PR) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>' +
        '<text class="cu2-tend__eje" x="' + (PL - 6) + '" y="' + (y(v) + 3).toFixed(1) + '" text-anchor="end">' + v + '</text>';
    }).join('');
    var hay = pts.filter(Boolean).length;
    return '<svg class="cu2-tend" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Índice de los últimos ' + n + ' meses">' +
      guias + area + linea + puntos + etiquetas + '</svg>' +
      (hay < 2 ? '<p class="cu2-tend__nota">La tendencia se completa a medida que haya meses con índice.</p>' : '');
  }

  // --- vista de una persona -------------------------------------------------------------
  function barraAportes(r) {
    var a = aportes(r);
    var segs = a.filter(function (x) { return x.aplica && x.cuota > 0; }).map(function (x) {
      var c = r.componentes.find(function (k) { return k.clave === x.clave; });
      var tono = tonoDe(c.pct);
      return '<span class="cu2-aporte__seg sx2-tono-' + tono + '" style="flex:' + x.cuota.toFixed(2) + '" title="' + esc(x.nombre + ': aporta ' + num(x.gana) + ' de ' + num(x.cuota) + ' pts') + '">' +
        '<span class="cu2-aporte__gana" style="width:' + (x.cuota ? (x.gana * 100 / x.cuota) : 0).toFixed(1) + '%"></span>' +
        '<span class="cu2-aporte__eti">' + esc(x.clave) + '</span></span>';
    }).join('');
    var peor = a.filter(function (x) { return x.aplica && x.pierde > 0.05; }).sort(function (p, q) { return q.pierde - p.pierde; })[0];
    var frase = r.indice === null ? esc(r.explicacion)
      : 'Sumaste <strong>' + num(r.indice) + ' de 100 puntos</strong>.' + (peor ? ' Lo que más resta: <strong>' + esc(peor.nombre) + '</strong> (−' + num(peor.pierde) + ' pts).' : ' No perdiste puntos este mes.');
    return '<div class="cu2-aporte">' +
      (segs ? '<div class="cu2-aporte__barra" role="img" aria-label="Puntos que aporta cada componente">' + segs + '</div>' : '') +
      '<p class="cu2-aporte__frase">' + frase + '</p></div>';
  }

  function senales(s) {
    function item(n, icono, texto, tono, destino, ayuda) {
      var activo = n > 0;
      return '<button type="button" class="cu2-senal sx2-tono-' + (activo ? tono : 'neutro') + (destino && activo ? ' js-cu2-ir' : '') + '"' +
        (destino && activo ? ' data-destino="' + destino + '"' : ' disabled') + ' title="' + esc(ayuda) + '">' +
        U.ico(icono, 14) + '<strong>' + n + '</strong><span>' + esc(texto) + '</span></button>';
    }
    return '<div class="cu2-senales" role="group" aria-label="Señales que no entran a la fórmula">' +
      item(s.sin_fecha, 'calendario', s.sin_fecha === 1 ? 'sin fecha' : 'sin fecha', 'alerta', 'cu2-sin-fecha', 'Tareas abiertas sin fecha comprometida: nunca se atrasan, por eso se muestran aparte.') +
      item(s.dormidas, 'reloj', s.dormidas === 1 ? 'dormida' : 'dormidas', 'alerta', 'cu2-dormidas', 'Tareas abiertas sin ningún movimiento en 14 días.') +
      item(s.reprogramaciones, 'derivar', s.reprogramaciones === 1 ? 'reprogramación' : 'reprogramaciones', 'info', '', 'Cambios de fecha registrados en el mes.') +
      (s.reprogramaciones_que_no_cuentan ? item(s.reprogramaciones_que_no_cuentan, 'alerta', 'no movieron la meta', 'critico', '', 'Reprogramaciones hechas por la misma persona o después de vencer: el atraso se mide contra la fecha original.') : '') +
    '</div>';
  }

  function tarjetaComponente(c, i, st, aporte) {
    var tono = c.aplica ? tonoDe(c.pct) : 'neutro';
    var malos = c.detalle.filter(function (x) { return !x.ok; }).length;
    var abierto = st.componente === c.clave;
    var pie = !c.casos ? 'Sin casos este mes'
      : (c.aplica ? (malos ? plural(malos, 'pendiente o tarde', 'pendientes o tarde') : 'Todo a tiempo') : 'Menos de ' + 3 + ' casos: no cuenta');
    return '<button type="button" class="cu2-comp sx2-tono-' + tono + ' sx2-entra js-cu2-comp' + (abierto ? ' cu2-comp--abierto' : '') + '" data-clave="' + esc(c.clave) + '"' +
      ' aria-expanded="' + (abierto ? 'true' : 'false') + '" style="--i:' + (i + 2) + '">' +
      '<span class="cu2-comp__cab"><span class="cu2-comp__ico">' + U.ico(ICONO_COMP[c.clave] || 'lista', 16) + '</span>' +
        '<span class="cu2-comp__nombre">' + esc(c.nombre) + '</span><span class="cu2-comp__peso" title="Peso en la fórmula">' + c.peso + ' %</span></span>' +
      '<span class="cu2-comp__fila"><span class="cu2-comp__valor">' + (c.casos ? esc(pctTxt(c.pct)) : '—') + '</span>' +
        (c.casos ? '<span class="cu2-comp__casos">' + c.cumplidos + '/' + c.casos + '</span>' : '') + '</span>' +
      U.barra(c.pct || 0, tono) +
      '<span class="cu2-comp__pie">' + (malos && c.aplica ? U.ico('alerta', 12) : '') + esc(pie) +
        (aporte && aporte.aplica && aporte.pierde > 0.05 ? '<span class="cu2-comp__resta">−' + num(aporte.pierde) + ' pts</span>' : '') + '</span>' +
      '<span class="cu2-comp__ver">' + (abierto ? 'Ocultar detalle' : 'Ver detalle') + U.ico(abierto ? 'arriba' : 'abajo', 12) + '</span>' +
    '</button>';
  }

  function filaCaso(x, hoy) {
    var que = x.titulo || x.tarea || x.tipo || '';
    var subs = [];
    if (x.referencia && x.referencia !== que) subs.push(esc(x.referencia));
    if (x.area) subs.push(esc(x.area));
    if (x.tipo && x.tarea === undefined && x.titulo === undefined && x.referencia) { /* tipo ya es el título */ }
    var avisos = (x.reprogramaciones || []).filter(function (rp) { return !rp.cuenta && rp.a; }).map(function (rp) {
      return '<span class="cu2-caso__aviso">' + U.ico('alerta', 12) + 'Reprogramada al ' + esc(fecha(rp.a)) + ': no cuenta, ' + esc(rp.motivo_no_cuenta) + '</span>';
    }).join('');
    var meta = x.meta || x.plazo || x.fecha || '';
    var hecho = x.entregada || x.hecho || '';
    var orig = x.fecha_original && x.fecha_original !== x.meta ? ' <span class="cu2-caso__orig">(original ' + esc(fechaCorta(x.fecha_original)) + ')</span>' : '';
    var malo = !!MALOS[x.estado];
    var tono = x.estado === 'Atrasada' || x.estado === 'Sin hacer' ? 'critico' : (malo ? 'alerta' : 'ok');
    var at = malo ? atraso(x, hoy) : '';
    return '<li class="cu2-caso sx2-tono-' + tono + '">' +
      '<span class="cu2-caso__estado">' + U.badge(x.estado, tono) + (at ? '<span class="cu2-caso__atraso">' + esc(at) + '</span>' : '') + '</span>' +
      '<span class="cu2-caso__que"><strong>' + esc(que) + '</strong>' + (subs.length ? '<span class="cu2-caso__sub">' + subs.join(' · ') + '</span>' : '') + avisos + '</span>' +
      '<span class="cu2-caso__fechas"><span><em>Meta</em>' + esc(meta ? fechaCorta(meta) : '—') + orig + '</span><span><em>Hecho</em>' + esc(hecho ? fechaCorta(hecho) : '—') + '</span></span>' +
    '</li>';
  }

  function detalleComponente(c, st, hoy) {
    var malos = c.detalle.filter(function (x) { return !x.ok; });
    var buenos = c.detalle.filter(function (x) { return x.ok; });
    var neutras = c.neutras || [];
    if (!c.detalle.length && !neutras.length) return U.card({ titulo: c.nombre, icono: ICONO_COMP[c.clave], i: 6, cuerpo: '<p class="cu2-nada">Nada que medir este mes en este componente.</p>' });
    var html = '';
    html += malos.length
      ? '<h3 class="cu2-sub cu2-sub--malo">' + U.ico('alerta', 14) + 'Lo que bajó el índice <span>' + malos.length + '</span></h3><ul class="cu2-casos">' + malos.map(function (x) { return filaCaso(x, hoy); }).join('') + '</ul>'
      : '<p class="cu2-felicita">' + U.ico('check', 16) + 'Todo lo de este componente se cumplió a tiempo.</p>';
    if (buenos.length) {
      html += '<details class="cu2-buenos"' + (malos.length ? '' : ' open') + '><summary>' + U.ico('check', 14) + 'Cumplido a tiempo <span>' + buenos.length + '</span></summary>' +
        '<ul class="cu2-casos">' + buenos.map(function (x) { return filaCaso(x, hoy); }).join('') + '</ul></details>';
    }
    if (neutras.length) {
      html += '<h3 class="cu2-sub">' + U.ico('candado', 14) + 'Neutras (bloqueadas por otra persona) <span>' + neutras.length + '</span></h3><ul class="cu2-casos">' + neutras.map(function (x) {
        return '<li class="cu2-caso sx2-tono-neutro"><span class="cu2-caso__estado">' + U.badge('Neutra', 'neutro') + '</span><span class="cu2-caso__que"><strong>' + esc(x.titulo) + '</strong><span class="cu2-caso__sub">' + esc(x.motivo) + '</span></span>' +
          '<span class="cu2-caso__fechas"><span><em>Meta</em>' + esc(fechaCorta(x.meta)) + '</span></span></li>';
      }).join('') + '</ul>';
    }
    return '<section class="sx2-card cu2-detalle sx2-entra" id="cu2-detalle" style="--i:6">' +
      '<div class="cu2-detalle__cab"><h2 class="sx2-card__titulo">' + U.ico(ICONO_COMP[c.clave], 18) + esc(c.nombre) + '</h2>' +
      '<span class="cu2-detalle__resumen">' + (c.casos ? c.cumplidos + ' de ' + c.casos + ' a tiempo · pesa ' + c.peso + ' %' + (c.aplica ? '' : ' · no cuenta (menos de 3 casos)') : 'sin casos') + '</span>' +
      U.boton({ soloIcono: true, icono: 'equis', titulo: 'Cerrar detalle', variante: 'fantasma', sm: true, clase: 'js-cu2-cerrar' }) + '</div>' +
      html + '</section>';
  }

  function listaTareas(items, id, titulo, icono, sub, vacio, hoy, campoFecha) {
    var cuerpo = !items.length ? '<p class="cu2-felicita">' + U.ico('check', 16) + esc(vacio) + '</p>'
      : '<ul class="cu2-mini">' + items.map(function (x) {
        var extra = campoFecha && x[campoFecha] ? '<span class="cu2-mini__dias" title="Último movimiento: ' + esc(fecha(x[campoFecha])) + '">' + esc(plural(dias(x[campoFecha], hoy), 'día', 'días')) + '</span>' : '';
        return '<li><span class="cu2-mini__punto"></span><span class="cu2-mini__txt">' + esc(x.titulo) + '</span>' + extra + '</li>';
      }).join('') + '</ul>';
    return '<section class="sx2-card cu2-panel sx2-entra" id="' + id + '" style="--i:7"><div class="sx2-card__cab"><h2 class="sx2-card__titulo">' + U.ico(icono, 18) + esc(titulo) +
      ' <span class="sx2-card__sub">' + esc(sub) + '</span></h2>' + (items.length ? U.badge(String(items.length), 'alerta', true) : '') + '</div>' + cuerpo + '</section>';
  }

  function vistaPersona(st, r) {
    var tono = TONO[r.estado] || 'neutro';
    var hoy = r.corte || hoyClave();
    var esMes = r.periodo === hoyPeriodo();
    var hist = r.historial || [];
    var previo = hist.length > 1 ? hist[hist.length - 2] : null;
    var cab = (st.volver ? '<div class="cu2-volver">' + U.boton({ texto: 'Volver a la lista', icono: 'izquierda', variante: 'fantasma', sm: true, clase: 'js-cu2-volver' }) + '</div>' : '') +
      '<div class="cu2-barra sx2-entra">' +
        (st.volver || st.alcance !== 'yo' ? U.persona({ nombre: r.nombre, email: r.email }, 'lg') : '<span class="cu2-barra__txt">Tu índice de cumplimiento</span>') +
        selectorPeriodo(st) +
      '</div>';
    var titular = '<section class="sx2-card cu2-hero sx2-entra sx2-tono-' + tono + '" style="--i:1">' +
      '<div class="cu2-hero__indice">' +
        U.anillo(r.indice || 0, { tam: 132, grosor: 12, tono: tono, texto: r.indice === null ? '—' : pctTxt(r.indice) }) +
        '<span class="cu2-hero__estado">' + esc(ESTADO_TXT[r.estado] || '') + '</span>' +
        (previo ? variacion(r.indice, previo.indice, mesCorto(previo.periodo)) : '') +
      '</div>' +
      '<div class="cu2-hero__centro">' +
        '<span class="cu2-hero__eti">' + esc(nombrePeriodo(r.periodo)) + (esMes ? ' · medido al ' + esc(fechaCorta(r.corte)) : ' · mes cerrado') + '</span>' +
        barraAportes(r) +
        senales(r.senales) +
      '</div>' +
      (hist.length ? '<div class="cu2-hero__tend"><span class="cu2-hero__eti">Últimos ' + hist.length + ' meses</span>' + tendencia(hist) + '</div>' : '') +
    '</section>';
    var ap = aportes(r);
    var comps = '<div class="cu2-comps">' + r.componentes.map(function (c, i) {
      return tarjetaComponente(c, i, st, ap.find(function (x) { return x.clave === c.clave; }));
    }).join('') + '</div>';
    var abierto = r.componentes.find(function (c) { return c.clave === st.componente; });
    var detalle = abierto ? detalleComponente(abierto, st, hoy) : '';
    var extras = '<div class="cu2-paneles">' +
      listaTareas(r.senales.detalle_dormidas, 'cu2-dormidas', 'Tareas dormidas', 'reloj', 'sin movimiento en ' + r.dias_dormida + ' días', 'Ninguna tarea dormida.', hoy, 'sin_movimiento_desde') +
      listaTareas(r.senales.detalle_sin_fecha, 'cu2-sin-fecha', 'Tareas sin fecha', 'calendario', 'ponles fecha para poder cumplirlas', 'Todas tus tareas abiertas tienen fecha.', hoy) +
    '</div>';
    var como = '<details class="cu2-como sx2-entra" style="--i:9"><summary>' + U.ico('info', 14) + 'Cómo se calcula</summary><div class="cu2-como__grid">' +
      '<div><b>' + U.ico('calendario', 14) + 'Compromisos con fecha · 35 %</b><p>Tareas que vencieron en el mes y se entregaron a tiempo. Se mide contra la fecha original: una reprogramación solo mueve la meta si la hizo tu jefatura o supervisor antes de que venciera.</p></div>' +
      '<div><b>' + U.ico('tareas', 14) + 'Obligaciones del área · 25 %</b><p>Tareas internas de la Agenda de tu área marcadas hechas a tiempo.</p></div>' +
      '<div><b>' + U.ico('escudo', 14) + 'Responsabilidades del cargo y SGC · 20 %</b><p>Las responsabilidades de tu mapa que se comprueban con evidencia (semanales y mensuales), los acuses de documentos y las etapas de no conformidades, dentro de su plazo.</p></div>' +
      '<div><b>' + U.ico('documento', 14) + 'Reportabilidad · 20 %</b><p>El reporte mensual del área a tiempo y tus tareas abiertas con movimiento en los últimos ' + r.dias_dormida + ' días.</p></div>' +
    '</div><p class="cu2-como__nota">Un componente cuenta desde ' + r.min_casos + ' casos. Verde desde ' + r.cortes.ok + ' %, amarillo desde ' + r.cortes.alerta + ' %. Lo que vence hoy todavía no es atraso; una tarea bloqueada por otra persona queda neutra.</p></details>';
    return cab + titular + comps + detalle + extras + como;
  }

  // --- vista de lista (equipo / empresa) ---------------------------------------------------
  function reparto(rs) {
    var rep = rs.reparto || {};
    var total = (rep.ok || 0) + (rep.alerta || 0) + (rep.critico || 0) + (rep.sin_dato || 0);
    var partes = [['ok', 'Cumplen'], ['alerta', 'En observación'], ['critico', 'Bajo 75 %'], ['sin_dato', 'Sin datos']];
    var barra = total ? partes.filter(function (p) { return rep[p[0]]; }).map(function (p) {
      return '<span class="cu2-rep__seg sx2-tono-' + TONO[p[0]] + '" style="flex:' + rep[p[0]] + '" title="' + esc(p[1] + ': ' + rep[p[0]]) + '"></span>';
    }).join('') : '';
    var leyenda = partes.map(function (p) {
      return '<button type="button" class="cu2-rep__ley sx2-tono-' + TONO[p[0]] + (p[0] !== 'sin_dato' && p[0] !== 'ok' ? ' js-cu2-filtro' : '') + '"' +
        (p[0] === 'alerta' || p[0] === 'critico' ? ' data-f="' + p[0] + '"' : ' disabled') + '><i></i>' + esc(p[1]) + ' <strong>' + (rep[p[0]] || 0) + '</strong></button>';
    }).join('');
    return '<section class="sx2-card cu2-rep sx2-entra" style="--i:2"><span class="cu2-hero__eti">Cómo está el ' + (total === 1 ? 'equipo' : 'grupo') + '</span>' +
      '<div class="cu2-rep__barra">' + barra + '</div><div class="cu2-rep__leyenda">' + leyenda + '</div></section>';
  }

  function celdaComp(c) {
    var tono = c.aplica ? tonoDe(c.pct) : 'neutro';
    return '<td class="cu2-celda" data-et="' + esc(c.clave + ' · ' + c.nombre) + '"><span class="cu2-celda__v sx2-tono-' + tono + (c.aplica ? '' : ' cu2-celda__v--no') + '"' +
      ' title="' + esc(c.nombre + (c.casos ? ': ' + c.casos + ' casos' : ': sin casos') + (c.casos && !c.aplica ? ' (no cuenta)' : '')) + '">' + esc(c.casos ? pctTxt(c.pct) : '—') + '</span></td>';
  }

  function vistaLista(st, r) {
    var rs = r.resumen || {};
    var etAnt = rs.periodo_anterior ? mesCorto(rs.periodo_anterior) : '';
    var promedio = '<section class="sx2-card cu2-prom sx2-entra sx2-tono-' + (TONO[rs.estado] || 'neutro') + '" style="--i:1">' +
      '<span class="cu2-hero__eti">Índice promedio</span>' +
      '<span class="cu2-prom__fila">' + U.anillo(rs.indice_promedio || 0, { tam: 76, grosor: 8, tono: TONO[rs.estado] || 'neutro', texto: rs.indice_promedio === null ? '—' : num(rs.indice_promedio) }) +
        '<span class="cu2-prom__txt"><strong>' + esc(ESTADO_TXT[rs.estado] || '') + '</strong>' + variacion(rs.indice_promedio, rs.indice_promedio_anterior, etAnt) +
        '<span class="cu2-prom__sub">' + (rs.con_indice || 0) + ' de ' + (rs.personas || 0) + ' personas con índice</span></span></span></section>';
    var alertas = '<section class="sx2-card cu2-alertas sx2-entra" style="--i:3"><span class="cu2-hero__eti">Señales del ' + (st.alcance === 'empresa' ? 'mes' : 'equipo') + '</span>' +
      '<button type="button" class="cu2-alerta-n js-cu2-filtro sx2-tono-' + (rs.dormidas ? 'alerta' : 'ok') + '" data-f="dormidas">' + U.ico('reloj', 16) + '<strong>' + (rs.dormidas || 0) + '</strong><span>tareas dormidas</span></button>' +
      '<span class="cu2-alerta-n sx2-tono-' + (rs.sin_fecha ? 'alerta' : 'ok') + '">' + U.ico('calendario', 16) + '<strong>' + (rs.sin_fecha || 0) + '</strong><span>tareas sin fecha</span></span></section>';
    var barra = '<div class="cu2-barra sx2-entra"><span class="cu2-barra__txt">' +
      esc(st.alcance === 'empresa' ? 'Toda la empresa' : 'Tu equipo') + ' <span class="sx2-tenue">· en orden alfabético</span></span>' + selectorPeriodo(st) + '</div>';
    if (!r.personas.length) {
      return barra + U.card({ cuerpo: U.vacio({ icono: 'equipo', titulo: st.alcance === 'equipo' ? 'No tienes un equipo asignado' : 'Nadie con trabajo medible este mes',
        texto: st.alcance === 'equipo' ? 'El equipo sale de Jefaturas y de las listas de cada departamento.' : 'Aparecerá quien tenga tareas, obligaciones o plazos en el mes.' }) });
    }
    var visibles = r.personas.filter(function (p) {
      if (st.filtro === 'dormidas') return p.senales.dormidas > 0;
      if (st.filtro) return p.estado === st.filtro;
      return true;
    });
    var chips = '<div class="cu2-filtros" role="group" aria-label="Filtrar personas">' + FILTROS.map(function (f) {
      var n = f.id === 'dormidas' ? r.personas.filter(function (p) { return p.senales.dormidas > 0; }).length
        : (f.id ? r.personas.filter(function (p) { return p.estado === f.id; }).length : r.personas.length);
      return U.chip({ texto: f.texto, n: n, activo: st.filtro === f.id, clase: 'js-cu2-filtro', datos: { f: f.id } });
    }).join('') + '</div>';
    var comps = r.personas[0].componentes || [];
    var filas = visibles.map(function (p) {
      var tono = TONO[p.estado] || 'neutro';
      return '<tr class="sx2-fila--clic js-cu2-persona cu2-fila sx2-tono-' + tono + '" tabindex="0" data-email="' + esc(p.email) + '">' +
        '<td class="cu2-fila__persona">' + U.persona({ nombre: p.nombre, email: p.email }) + '</td>' +
        '<td class="cu2-indice" data-et="Índice"><span class="cu2-indice__fila"><span class="cu2-indice__n">' + esc(p.indice === null ? '—' : pctTxt(p.indice)) + '</span>' +
          varCorta(p.indice, p.indice_anterior, etAnt) + '</span>' + U.barra(p.indice || 0, tono) + '</td>' +
        p.componentes.map(celdaComp).join('') +
        '<td class="cu2-num" data-et="Dormidas">' + (p.senales.dormidas ? U.badge(String(p.senales.dormidas), 'alerta', true) : '<span class="cu2-cero">0</span>') + '</td>' +
        '<td class="cu2-num" data-et="Sin fecha">' + (p.senales.sin_fecha ? U.badge(String(p.senales.sin_fecha), 'alerta', true) : '<span class="cu2-cero">0</span>') + '</td>' +
        '<td class="cu2-fila__ir" aria-hidden="true">' + U.ico('derecha', 16) + '</td>' +
      '</tr>';
    }).join('');
    var tabla = '<section class="sx2-card sx2-card--sin-relleno cu2-tabla-card sx2-entra" style="--i:4">' +
      '<div class="sx2-card__cab"><h2 class="sx2-card__titulo">' + U.ico('equipo', 18) + 'Por persona <span class="sx2-card__sub">abre una fila para ver qué lo forma</span></h2>' + chips + '</div>' +
      (visibles.length ? '<div class="sx2-tabla-wrap"><table class="sx2-tabla cu2-tabla"><thead><tr><th>Persona</th><th>Índice</th>' +
        comps.map(function (c) { return '<th class="cu2-num" title="' + esc(c.nombre) + '">' + U.ico(ICONO_COMP[c.clave], 13) + ' ' + esc(c.clave) + '</th>'; }).join('') +
        '<th class="cu2-num" title="Tareas sin movimiento en 14 días">Dormidas</th><th class="cu2-num">Sin fecha</th><th></th></tr></thead><tbody>' + filas + '</tbody></table></div>'
        : '<div class="cu2-vacio-filtro">' + U.vacio({ icono: 'check', titulo: 'Nadie en este filtro', texto: 'Prueba con «Todos».' }) + '</div>') +
      '<p class="cu2-leyenda">' + comps.map(function (c) { return '<span>' + U.ico(ICONO_COMP[c.clave], 12) + '<b>' + esc(c.clave) + '</b> ' + esc(c.nombre.toLowerCase()) + '</span>'; }).join('') +
        '<span class="cu2-leyenda__no">En gris: menos de 3 casos, no cuenta.</span></p>' +
    '</section>';
    return barra + '<div class="cu2-resumen">' + promedio + reparto(rs) + alertas + '</div>' + tabla;
  }

  // --- carga y eventos ------------------------------------------------------------------
  function esqueleto() {
    return '<div class="cu2 cu2--cargando"><div class="cu2-barra"><span class="sx2-esq sx2-esq--texto" style="width:180px"></span><span class="sx2-esq sx2-esq--texto" style="width:150px"></span></div>' +
      '<div class="sx2-card cu2-hero"><span class="sx2-esq" style="width:132px;height:132px;border-radius:50%"></span><div style="flex:1;display:grid;gap:12px"><span class="sx2-esq sx2-esq--texto" style="width:40%"></span><span class="sx2-esq" style="height:22px;border-radius:8px"></span><span class="sx2-esq sx2-esq--texto" style="width:70%"></span></div></div>' +
      U.esqueleto('kpis', 4) + '</div>';
  }
  function dibujar(el, animar) {
    var st = el._cu2, d = st.ultimo;
    var html = (st.persona || st.alcance === 'yo') ? vistaPersona(Object.assign({}, st, { volver: !!st.persona }), d) : vistaLista(st, d);
    el.innerHTML = '<div class="cu2">' + html + '</div>';
    U.animar(el);
    if (!animar) el.querySelectorAll('.sx2-entra').forEach(function (n) { n.style.animation = 'none'; });
  }
  function pintar(el) {
    var st = el._cu2;
    var t = ++st.turno;
    el.innerHTML = esqueleto();
    var pide = st.persona ? { email: st.persona, periodo: st.periodo }
      : (st.alcance === 'yo' ? { periodo: st.periodo } : { alcance: st.alcance, periodo: st.periodo });
    api('getCumplimientoResponsables', pide).then(function (r) {
      if (t !== st.turno || !el.isConnected) return;
      if (!r || !r.ok) {
        el.innerHTML = '<div class="cu2">' + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar el cumplimiento',
          texto: (r && r.message) || 'Inténtalo de nuevo.', accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-cu2-recargar' }) }) }) + '</div>';
        return;
      }
      st.ultimo = r.data;
      dibujar(el, true);
      var correos = r.data.personas ? r.data.personas.map(function (p) { return p.email; }) : [r.data.email];
      U.precargarFotos(correos).then(function () { if (t === st.turno && el.isConnected && st.ultimo) dibujar(el, false); });
    });
  }

  function montar(el, opciones) {
    if (!el) return;
    var o = opciones || {};
    el._cu2 = { alcance: o.alcance || 'yo', periodo: o.periodo || hoyPeriodo(), persona: '', componente: '', filtro: '', turno: 0, ultimo: null };
    el.setAttribute('data-cumpl-montado', '1');
    if (!el._cu2Eventos) {
      el._cu2Eventos = true;
      el.addEventListener('click', function (ev) {
        var st = el._cu2, t = ev.target, b;
        if ((b = t.closest('.js-cu2-mes'))) { if (b.disabled) return; st.periodo = moverPeriodo(st.periodo, Number(b.getAttribute('data-k'))); st.componente = ''; pintar(el); return; }
        if (t.closest('.js-cu2-hoy')) { st.periodo = hoyPeriodo(); st.componente = ''; pintar(el); return; }
        if ((b = t.closest('.js-cu2-comp'))) {
          var k = b.getAttribute('data-clave');
          st.componente = st.componente === k ? '' : k;
          dibujar(el, false);
          var det = el.querySelector('#cu2-detalle');
          if (det) det.scrollIntoView({ block: 'nearest', behavior: U.reducirMovimiento() ? 'auto' : 'smooth' });
          return;
        }
        if (t.closest('.js-cu2-cerrar')) { st.componente = ''; dibujar(el, false); return; }
        if ((b = t.closest('.js-cu2-ir'))) {
          var dest = el.querySelector('#' + b.getAttribute('data-destino'));
          if (dest) { dest.scrollIntoView({ block: 'center', behavior: U.reducirMovimiento() ? 'auto' : 'smooth' }); dest.classList.remove('cu2-resalta'); void dest.offsetWidth; dest.classList.add('cu2-resalta'); }
          return;
        }
        if ((b = t.closest('.js-cu2-filtro'))) { var f = b.getAttribute('data-f') || ''; st.filtro = st.filtro === f && f ? '' : f; dibujar(el, false); return; }
        if ((b = t.closest('.js-cu2-persona'))) { st.persona = b.getAttribute('data-email'); st.componente = ''; pintar(el); window.scrollTo(0, 0); return; }
        if (t.closest('.js-cu2-volver')) { st.persona = ''; st.componente = ''; pintar(el); return; }
        if (t.closest('.js-cu2-recargar')) { pintar(el); }
      });
      el.addEventListener('keydown', function (ev) {
        if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('tr.js-cu2-persona')) { ev.preventDefault(); ev.target.click(); }
      });
    }
    pintar(el);
  }
  function montarPendientes(raiz) {
    (raiz || document).querySelectorAll('[data-cumpl-host]:not([data-cumpl-montado])').forEach(function (el) {
      montar(el, { alcance: el.getAttribute('data-alcance') || 'yo' });
    });
  }
  function recargar(raiz) {
    (raiz || document).querySelectorAll('[data-cumpl-montado]').forEach(function (el) { if (el._cu2) pintar(el); });
  }

  window.SigsoCumplimiento = { montar: montar, montarPendientes: montarPendientes, recargar: recargar };
})();
