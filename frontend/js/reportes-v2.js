/**
 * reportes-v2.js — motor de reportes de SIGSO con salida v2 (R4b del retiro
 * de la versión clásica; ver documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 * MISMA API y MISMAS REGLAS que reportes.js (registrar, catálogo, filtros,
 * rango de período, cumplimiento, resbalón, documento, CSV): solo cambia el
 * HTML que produce, que ahora usa los componentes v2 (tarjetas, KPIs, tablas
 * sx2, barras, tendencia con área). La plataforma carga este archivo; el
 * clásico reportes.js queda solo para app.html.
 *
 * Reglas heredadas (no cambian):
 *  1. Un reporte declara de qué dato real sale; si falta, dice qué le falta.
 *  2. Solo se muestran los filtros que aplican a cada reporte.
 *  3. No decide permisos: el backend manda.
 *  4. El cumplimiento se mide SOLO sobre lo entregado con fecha comprometida;
 *     sin entregas es "sin entregas", nunca 0 %.
 */
(function () {
  'use strict';

  var U = window.UIv2;
  var TIPOS = {
    ESTADO: { etiqueta: 'Estado', filtros: ['periodo', 'area', 'responsable', 'estado'] },
    CUMPLIMIENTO: { etiqueta: 'Cumplimiento', filtros: ['periodo', 'area', 'responsable'] },
    TENDENCIA: { etiqueta: 'Tendencia', filtros: ['desde', 'hasta', 'area'] },
    COMPARACION: { etiqueta: 'Comparación', filtros: ['periodo', 'periodo_previo', 'area'] },
    RANKING: { etiqueta: 'Ranking', filtros: ['periodo', 'dimension'] },
    DETALLE: { etiqueta: 'Detalle', filtros: ['periodo', 'area', 'responsable', 'estado'] }
  };
  var ICONO_TIPO = { ESTADO: 'estado', CUMPLIMIENTO: 'diana', TENDENCIA: 'tendencia', COMPARACION: 'grafico', RANKING: 'lista', DETALLE: 'tabla' };
  var ETIQUETA_ESTADO = { LISTO: 'Disponible', SIN_DATOS: 'Sin datos aún', PENDIENTE: 'Requiere desarrollo' };
  var TONO_ESTADO = { LISTO: 'ok', SIN_DATOS: 'alerta', PENDIENTE: 'neutro' };
  var registro_ = {};

  function esc_(t) { return U.esc(t == null ? '' : t); }
  function vacio_(texto) { return '<div class="rp2-vacio">' + U.vacio({ icono: 'grafico', titulo: '', texto: texto }) + '</div>'; }

  function registrar(moduloId, definicion) { registro_[moduloId] = definicion; }
  function obtener(moduloId) { return registro_[moduloId] || null; }
  function buscarReporte(moduloId, reporteId) {
    var def = obtener(moduloId), hallado = null;
    if (!def) return null;
    (def.grupos || []).forEach(function (g) { (g.reportes || []).forEach(function (r) { if (r.id === reporteId) hallado = r; }); });
    return hallado;
  }

  // --- Catálogo -----------------------------------------------------------------------
  function pintarCatalogo(opts) {
    var cont = opts.contenedor;
    var def = obtener(opts.modulo);
    if (!cont || !def) return;
    var visible = function (r) { return typeof opts.visible !== 'function' || opts.visible(r) !== false; };
    var listos = 0, total = 0;
    (def.grupos || []).forEach(function (g) { (g.reportes || []).forEach(function (r) { if (!visible(r)) return; total++; if (r.estado === 'LISTO') listos++; }); });
    cont.innerHTML = (opts.encabezado || '') +
      '<div class="rp2">' +
        '<div class="rp2-intro sx2-entra">' +
          '<div class="sx2-apilado" style="gap:4px"><h2 class="rp2-intro__tit">' + esc_(def.titulo || 'Centro de reportes') + '</h2>' +
          '<span class="sx2-tenue" style="font-size:.875rem">' + listos + ' de ' + total + ' reportes se arman hoy con datos reales; el resto dice qué le falta.</span></div>' +
          '<span class="rp2-intro__n">' + U.anillo(total ? listos * 100 / total : 0, { tam: 54, grosor: 6, tono: 'primario', texto: listos + '/' + total }) + '</span>' +
        '</div>' +
        (def.nota ? '<p class="rp2-nota sx2-entra">' + U.ico('info', 15) + '<span>' + esc_(def.nota) + '</span></p>' : '') +
        (def.grupos || []).map(function (g, gi) {
          var reportes = (g.reportes || []).filter(visible);
          if (!reportes.length) return '';
          return '<section class="rp2-grupo sx2-entra" style="--i:' + (gi + 2) + '">' +
            '<h3 class="rp2-grupo__tit">' + (g.icono ? U.ico(g.icono, 16) : '') + '<span>' + esc_(g.grupo) + '</span><span class="rp2-grupo__n">' + reportes.length + '</span></h3>' +
            '<div class="rp2-lista">' + reportes.map(tarjeta_).join('') + '</div></section>';
        }).join('') +
      '</div>';
    cont.querySelectorAll('[data-reporte]').forEach(function (card) {
      function abrir() {
        var id = card.getAttribute('data-reporte');
        var seccion = card.getAttribute('data-seccion');
        if (seccion && typeof opts.onIrASeccion === 'function') { opts.onIrASeccion(seccion); return; }
        if (typeof opts.onAbrir === 'function') opts.onAbrir(id);
      }
      card.addEventListener('click', abrir);
      card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } });
    });
    U.animar(cont);
  }
  function tarjeta_(r) {
    var activa = r.estado === 'LISTO';
    var tipo = TIPOS[r.tipo];
    return '<article class="rp2-card' + (activa ? ' rp2-card--activa' : '') + '"' +
        (activa ? ' tabindex="0" role="button" data-reporte="' + esc_(r.id) + '" data-seccion="' + esc_(r.seccion || '') + '"' : '') + '>' +
      '<div class="rp2-card__cab"><span class="rp2-card__ico">' + U.ico(ICONO_TIPO[r.tipo] || 'grafico', 16) + '</span>' +
        '<strong>' + esc_(r.nombre) + '</strong>' + U.badge(ETIQUETA_ESTADO[r.estado] || r.estado, TONO_ESTADO[r.estado] || 'neutro') + '</div>' +
      '<p class="rp2-card__desc">' + esc_(r.desc) + '</p>' +
      '<div class="rp2-card__pie">' + (tipo ? '<span class="rp2-card__tipo">' + esc_(tipo.etiqueta) + '</span>' : '') +
        (r.falta ? '<span class="rp2-card__falta">Falta: ' + esc_(r.falta) + '</span>' : (activa ? '<span class="rp2-card__abrir">Abrir' + U.ico('derecha', 14) + '</span>' : '')) + '</div>' +
    '</article>';
  }

  // --- Filtros ------------------------------------------------------------------------
  var ETIQUETAS_FILTRO = {
    periodo: 'Período', periodo_previo: 'Comparado con', desde: 'Desde', hasta: 'Hasta',
    area: 'Área', responsable: 'Responsable', estado: 'Estado', dimension: 'Agrupado por', proceso: 'Proceso'
  };
  var PERIODOS_POR_DEFECTO = [
    { valor: 'mes', texto: 'Este mes' }, { valor: 'trimestre', texto: 'Este trimestre' },
    { valor: 'anio', texto: 'Este año' }, { valor: 'todo', texto: 'Todo' }
  ];
  function etiquetaFiltro_(reporte, nombre) {
    if (nombre === 'periodo' && reporte && reporte.etiquetaPeriodo) return reporte.etiquetaPeriodo;
    return ETIQUETAS_FILTRO[nombre] || nombre;
  }
  function filtrosParaCabecera(reporte, opciones, valores) {
    valores = valores || {};
    opciones = opciones || {};
    var lista = (reporte && (reporte.filtros || (TIPOS[reporte.tipo] || {}).filtros)) || [];
    return lista.map(function (nombre) {
      var bruto = valores[nombre];
      if (bruto === undefined || bruto === null || bruto === '') return null;
      if (bruto === 'todo' && (nombre === 'periodo' || nombre === 'periodo_previo')) return null;
      var catalogo = opciones[nombre] || (nombre === 'periodo' || nombre === 'periodo_previo' ? PERIODOS_POR_DEFECTO : []);
      var elegida = (catalogo || []).filter(function (o) { return String(o && o.valor !== undefined ? o.valor : o) === String(bruto); })[0];
      return { etiqueta: etiquetaFiltro_(reporte, nombre), valor: elegida && elegida.texto !== undefined ? elegida.texto : bruto };
    }).filter(Boolean);
  }
  function pintarFiltros(reporte, opciones, valores) {
    var lista = reporte.filtros || (TIPOS[reporte.tipo] || {}).filtros || [];
    if (!lista.length) return '';
    valores = valores || {};
    opciones = opciones || {};
    var campos = lista.map(function (f) {
      if (f === 'periodo') return select_('periodo', etiquetaFiltro_(reporte, 'periodo'), opciones.periodo || PERIODOS_POR_DEFECTO, valores.periodo || 'todo');
      if (f === 'periodo_previo') return select_('periodo_previo', 'Comparar con', opciones.periodo || PERIODOS_POR_DEFECTO, valores.periodo_previo || 'todo');
      if (f === 'desde') return fecha_('desde', 'Desde', valores.desde);
      if (f === 'hasta') return fecha_('hasta', 'Hasta', valores.hasta);
      if (f === 'area') return select_('area', 'Área', opciones.area || [], valores.area, 'Todas');
      if (f === 'responsable') return select_('responsable', 'Responsable', opciones.responsable || [], valores.responsable, 'Todos');
      if (f === 'estado') return select_('estado', 'Estado', opciones.estado || [], valores.estado, 'Todos');
      if (f === 'dimension') return select_('dimension', 'Agrupar por', opciones.dimension || [], valores.dimension);
      if (f === 'proceso') return select_('proceso', 'Proceso', opciones.proceso || [], valores.proceso, 'Todos');
      return '';
    }).filter(Boolean).join('');
    return '<form class="rp2-filtros" id="rep-filtros">' + campos +
      U.boton({ texto: 'Aplicar', icono: 'filtro', variante: 'primario', tipo: 'submit' }) + '</form>';
  }
  function select_(nombre, etiqueta, opciones, valor, textoVacio) {
    var opts = (textoVacio ? '<option value="">' + esc_(textoVacio) + '</option>' : '') +
      (opciones || []).map(function (o) {
        var v = o.valor !== undefined ? o.valor : o, t = o.texto !== undefined ? o.texto : o;
        return '<option value="' + esc_(v) + '"' + (String(v) === String(valor || '') ? ' selected' : '') + '>' + esc_(t) + '</option>';
      }).join('');
    return '<label class="rp2-filtro"><span>' + esc_(etiqueta) + '</span><select class="sx2-select" name="' + esc_(nombre) + '">' + opts + '</select></label>';
  }
  function fecha_(nombre, etiqueta, valor) {
    return '<label class="rp2-filtro"><span>' + esc_(etiqueta) + '</span><input type="date" class="sx2-input" name="' + esc_(nombre) + '" value="' + esc_(valor || '') + '"></label>';
  }
  function leerFiltros(contenedor) {
    var form = contenedor.querySelector('#rep-filtros');
    if (!form) return {};
    var out = {};
    Array.prototype.forEach.call(form.elements, function (el) { if (el.name) out[el.name] = el.value; });
    return out;
  }
  function alAplicarFiltros(contenedor, fn) {
    var form = contenedor.querySelector('#rep-filtros');
    if (!form) return;
    form.addEventListener('submit', function (e) { e.preventDefault(); fn(leerFiltros(contenedor)); });
  }

  // --- Aplicar filtros (misma lógica que reportes.js) ------------------------------------------
  function dos_(n) { return (n < 10 ? '0' : '') + n; }
  function finDeMes_(anio, mes) { return new Date(Date.UTC(Number(anio), mes, 0)).toISOString().slice(0, 10); }
  function rangoDePeriodo(periodo, hoyISO) {
    var hoy = String(hoyISO || new Date().toISOString()).slice(0, 10);
    var anio = hoy.slice(0, 4), mes = Number(hoy.slice(5, 7));
    if (periodo === 'mes') return { desde: hoy.slice(0, 7) + '-01', hasta: finDeMes_(anio, mes) };
    if (periodo === 'trimestre') {
      var primerMes = Math.floor((mes - 1) / 3) * 3 + 1;
      return { desde: anio + '-' + dos_(primerMes) + '-01', hasta: finDeMes_(anio, primerMes + 2) };
    }
    if (periodo === 'anio') return { desde: anio + '-01-01', hasta: anio + '-12-31' };
    return { desde: '', hasta: '' };
  }
  function campoValor_(campo) { return (campo && campo.valor) || campo; }
  function campoTexto_(campo) { return (campo && campo.texto) || campoValor_(campo); }
  function coincide_(item, campo, valor) {
    if (!campo || valor === undefined || valor === null || valor === '') return true;
    return String(item[campoValor_(campo)] || '') === String(valor);
  }
  function filtrarItems(items, valores, opciones) {
    items = items || []; valores = valores || {}; opciones = opciones || {};
    var campos = opciones.campos || {};
    var rango = (valores.desde || valores.hasta)
      ? { desde: String(valores.desde || '').slice(0, 10), hasta: String(valores.hasta || '').slice(0, 10) }
      : rangoDePeriodo(valores.periodo, opciones.hoy);
    var campoFecha = opciones.campoFecha, hayRango = !!(rango.desde || rango.hasta);
    return items.filter(function (i) {
      if (hayRango && campoFecha) {
        var f = String(i[campoFecha] || '').slice(0, 10);
        if (!f) return false;
        if (rango.desde && f < rango.desde) return false;
        if (rango.hasta && f > rango.hasta) return false;
      }
      return coincide_(i, campos.area, valores.area) && coincide_(i, campos.responsable, valores.responsable) && coincide_(i, campos.estado, valores.estado);
    });
  }
  function opcionesDeItems(items, campos) {
    var salida = {};
    Object.keys(campos || {}).forEach(function (filtro) {
      var cValor = campoValor_(campos[filtro]), cTexto = campoTexto_(campos[filtro]), textoPorValor = {};
      (items || []).forEach(function (i) {
        var v = String(i[cValor] || '').trim();
        if (v && textoPorValor[v] === undefined) textoPorValor[v] = String(i[cTexto] || '').trim() || v;
      });
      salida[filtro] = Object.keys(textoPorValor).map(function (v) { return { valor: v, texto: textoPorValor[v] }; })
        .sort(function (a, b) { return a.texto.localeCompare(b.texto, 'es'); });
    });
    return salida;
  }

  // --- Piezas visuales v2 ---------------------------------------------------------------
  // kpis: [{ etiqueta, valor, alerta, titulo, variante }] (formato de Componentes.kpi)
  function kpis(lista) {
    if (!lista || !lista.length) return '';
    return '<div class="sx2-fila-kpis rp2-kpis">' + lista.map(function (k, i) {
      var tono = k.alerta ? 'critico' : (k.variante === 'P1' ? 'critico' : (k.variante === 'P4' ? 'ok' : (k.variante === 'P3' ? 'alerta' : 'primario')));
      return U.kpi({ i: i, etiqueta: k.etiqueta, valor: k.valor, tono: tono, titulo: k.titulo });
    }).join('') + '</div>';
  }
  function tabla(columnas, filas, opts) {
    opts = opts || {};
    if (!filas || !filas.length) return vacio_(opts.vacio || 'No hay datos para este corte.');
    return '<div class="sx2-tabla-wrap rp2-tabla"><table class="sx2-tabla" id="' + esc_(opts.id || 'rep-tabla') + '"><thead><tr>' +
      columnas.map(function (c) { return '<th' + (c.alinear === 'derecha' ? ' class="sx2-num"' : '') + '>' + esc_(c.titulo) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + filas.map(function (f) {
        return '<tr>' + columnas.map(function (c) {
          var v = f[c.campo];
          return '<td' + (c.alinear === 'derecha' ? ' class="sx2-num"' : '') + '>' + (c.html ? (v == null ? '' : v) : esc_(v == null ? '' : v)) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }
  // opts.max: escala común (p. ej. el total, para leer proporciones); opts.sinPosicion:
  // para composiciones (Crítico/En riesgo/Sano), donde un 1-2-3 sugeriría un orden.
  function ranking(filas, opts) {
    opts = opts || {};
    if (!filas || !filas.length) return vacio_(opts.vacio || 'No hay datos para este ranking.');
    var max = opts.max || filas.reduce(function (m, f) { return Math.max(m, Number(f.valor) || 0); }, 0) || 1;
    return '<ol class="rp2-ranking' + (opts.sinPosicion ? ' rp2-ranking--comp' : '') + '">' + filas.map(function (f, i) {
      var pct = Math.round((Number(f.valor) || 0) / max * 100);
      return '<li>' + (opts.sinPosicion ? '' : '<span class="rp2-ranking__pos">' + (i + 1) + '</span>') + '<span class="rp2-ranking__etq" title="' + esc_(f.etiqueta) + '">' + esc_(f.etiqueta) + '</span>' +
        U.barra(pct, f.tono || 'primario') + '<strong class="rp2-ranking__val">' + esc_(f.texto !== undefined ? f.texto : f.valor) + '</strong></li>';
    }).join('') + '</ol>';
  }
  var nTendencia_ = 0;
  function tendencia(puntos, opts) {
    opts = opts || {};
    if (!puntos || puntos.length < 2) return vacio_(opts.vacio || 'Hacen falta al menos dos períodos medidos para dibujar una tendencia.');
    var an = 640, al = 200, m = { i: 40, d: 16, s: 18, b: 30 };
    var valores = puntos.map(function (p) { return Number(p.valor) || 0; });
    var max = Math.max.apply(null, valores), min = Math.min(0, Math.min.apply(null, valores));
    if (opts.meta !== undefined && opts.meta !== null && opts.meta !== '') max = Math.max(max, Number(opts.meta));
    if (max === min) max = min + 1;
    var ax = an - m.i - m.d, ay = al - m.s - m.b;
    var x = function (i) { return m.i + (i / (puntos.length - 1)) * ax; };
    var y = function (v) { return m.s + ay - ((v - min) / (max - min)) * ay; };
    var linea = puntos.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(Number(p.valor) || 0).toFixed(1); }).join(' ');
    var area = linea + ' L' + x(puntos.length - 1).toFixed(1) + ' ' + (m.s + ay) + ' L' + x(0).toFixed(1) + ' ' + (m.s + ay) + ' Z';
    var id = 'rp2g' + (++nTendencia_);
    var grid = [0, 0.5, 1].map(function (f) {
      var v = min + (max - min) * f, yy = y(v).toFixed(1);
      return '<line x1="' + m.i + '" y1="' + yy + '" x2="' + (an - m.d) + '" y2="' + yy + '" class="rp2-g-rejilla"/>' +
        '<text x="' + (m.i - 8) + '" y="' + (Number(yy) + 4) + '" class="rp2-g-tick" text-anchor="end">' + esc_(Math.round(v * 10) / 10) + '</text>';
    }).join('');
    var meta = opts.meta !== undefined && opts.meta !== null && opts.meta !== ''
      ? '<line x1="' + m.i + '" y1="' + y(Number(opts.meta)).toFixed(1) + '" x2="' + (an - m.d) + '" y2="' + y(Number(opts.meta)).toFixed(1) + '" class="rp2-g-meta"/>' +
        '<text x="' + (an - m.d) + '" y="' + (y(Number(opts.meta)) - 5).toFixed(1) + '" class="rp2-g-meta-txt" text-anchor="end">meta ' + esc_(opts.meta) + '</text>' : '';
    var salto = Math.ceil(puntos.length / 8);
    var ult = puntos.length - 1;
    return '<figure class="rp2-tendencia"><svg viewBox="0 0 ' + an + ' ' + al + '" role="img" aria-label="' + esc_(opts.titulo || 'Serie temporal') + '">' +
      '<defs><linearGradient id="' + id + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" class="rp2-g-stop1"/><stop offset="100%" class="rp2-g-stop2"/></linearGradient></defs>' +
      grid + meta +
      '<path d="' + area + '" fill="url(#' + id + ')"/>' +
      '<path d="' + linea + '" class="rp2-g-linea" fill="none"/>' +
      puntos.map(function (p, i) {
        return '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(Number(p.valor) || 0).toFixed(1) + '" r="' + (i === ult ? 5 : 3) + '" class="rp2-g-punto' + (i === ult ? ' rp2-g-punto--fin' : '') + '"><title>' + esc_(p.etiqueta) + ': ' + esc_(p.valor) + '</title></circle>';
      }).join('') +
      puntos.map(function (p, i) {
        if (i % salto !== 0 && i !== ult) return '';
        return '<text x="' + x(i).toFixed(1) + '" y="' + (al - 8) + '" class="rp2-g-tick" text-anchor="middle">' + esc_(p.etiqueta) + '</text>';
      }).join('') +
      '</svg><figcaption class="rp2-tendencia__pie">' + puntos.map(function (p) { return esc_(p.etiqueta) + ': ' + esc_(p.valor); }).join(' · ') + '</figcaption></figure>';
  }
  function comparacion(filas, opts) {
    opts = opts || {};
    if (!filas || !filas.length) return vacio_(opts.vacio || 'No hay datos para comparar.');
    return '<div class="sx2-tabla-wrap rp2-tabla"><table class="sx2-tabla"><thead><tr><th>' + esc_(opts.dimension || 'Concepto') + '</th>' +
      '<th class="sx2-num">' + esc_(opts.etiquetaPrevio || 'Período anterior') + '</th><th class="sx2-num">' + esc_(opts.etiquetaActual || 'Período actual') + '</th><th class="sx2-num">Variación</th></tr></thead><tbody>' +
      filas.map(function (f) {
        var a = Number(f.previo) || 0, b = Number(f.actual) || 0, d = b - a;
        var bueno = opts.menosEsMejor ? d < 0 : d > 0;
        var tono = d === 0 ? 'neutro' : (bueno ? 'ok' : 'critico');
        return '<tr><td>' + esc_(f.etiqueta) + '</td><td class="sx2-num">' + esc_(a) + '</td><td class="sx2-num">' + esc_(b) + '</td>' +
          '<td class="sx2-num">' + U.badge((d > 0 ? '+' : (d < 0 ? '−' : '=')) + ' ' + Math.abs(d), tono, true) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  // --- Cumplimiento (misma regla que reportes.js) ---------------------------------------------
  function agruparCumplimiento(items, campo, etiquetaVacia) {
    var grupos = {};
    (items || []).forEach(function (i) {
      var k = i[campo] || etiquetaVacia || '(sin dato)';
      if (!grupos[k]) grupos[k] = { total: 0, entregados: 0, aTiempo: 0, abiertos: 0 };
      grupos[k].total++;
      if (i.fecha_terminada && i.fecha_comprometida) {
        grupos[k].entregados++;
        if (new Date(i.fecha_terminada) <= new Date(i.fecha_comprometida)) grupos[k].aTiempo++;
      } else if (!i.fecha_terminada) grupos[k].abiertos++;
    });
    return Object.keys(grupos).map(function (k) {
      var g = grupos[k];
      return { etiqueta: k, total: g.total, entregados: g.entregados, aTiempo: g.aTiempo, abiertos: g.abiertos, pct: g.entregados ? Math.round(g.aTiempo / g.entregados * 100) : null };
    }).sort(function (a, b) {
      if (a.pct === null && b.pct === null) return b.total - a.total;
      if (a.pct === null) return 1;
      if (b.pct === null) return -1;
      return b.pct - a.pct;
    });
  }
  function tablaCumplimiento(filas, etiquetaDimension) {
    return tabla([
      { campo: 'etiqueta', titulo: etiquetaDimension }, { campo: 'total', titulo: 'Ítems', alinear: 'derecha' },
      { campo: 'abiertos', titulo: 'Abiertos', alinear: 'derecha' }, { campo: 'entregados', titulo: 'Entregados', alinear: 'derecha' },
      { campo: 'aTiempo', titulo: 'A tiempo', alinear: 'derecha' }, { campo: 'pctHtml', titulo: 'Cumplimiento', alinear: 'derecha', html: true }
    ], filas.map(function (f) {
      var o = {};
      Object.keys(f).forEach(function (k) { o[k] = f[k]; });
      o.pctHtml = f.pct === null ? '<span class="sx2-tenue">sin entregas</span>' : U.badge(f.pct + '%', f.pct >= 90 ? 'ok' : (f.pct >= 70 ? 'alerta' : 'critico'), true);
      return o;
    }), { vacio: 'No hay ítems en este corte.' });
  }
  function sub_(t) { return '<h3 class="rp2-sub">' + esc_(t) + '</h3>'; }
  function cuerpoCumplimientoPor(items, opts) {
    opts = opts || {};
    var filas = agruparCumplimiento(items, opts.campo, opts.etiquetaVacia);
    var medibles = filas.filter(function (f) { return f.pct !== null; });
    return kpis([
      { etiqueta: opts.etiquetaTotal || (opts.dimension + 's'), valor: filas.length },
      { etiqueta: 'Ítems considerados', valor: (items || []).length },
      { etiqueta: 'Ya medibles', valor: medibles.length, titulo: 'Solo se puede medir cumplimiento donde hay entregas con fecha comprometida.' }
    ]) +
    sub_('Cumplimiento') +
    ranking(medibles.map(function (f) { return { etiqueta: f.etiqueta, valor: f.pct, texto: f.pct + '%', tono: f.pct >= 90 ? 'ok' : (f.pct >= 70 ? 'alerta' : 'critico') }; }),
      { vacio: 'Todavía no hay entregas con fecha comprometida: no hay cumplimiento que medir.' }) +
    sub_('Detalle') + tablaCumplimiento(filas, opts.dimension || 'Grupo');
  }
  function cuerpoEntradaSalida(serie) {
    serie = serie || [];
    if (!serie.length) return vacio_('Sin datos de los últimos meses.');
    var entraron = serie.reduce(function (s, t) { return s + (Number(t.creadas) || 0); }, 0);
    var cerradas = serie.reduce(function (s, t) { return s + (Number(t.cerradas) || 0); }, 0);
    var saldo = entraron - cerradas;
    return kpis([
      { etiqueta: 'Entraron', valor: entraron }, { etiqueta: 'Se cerraron', valor: cerradas },
      { etiqueta: 'Saldo de la cola', valor: (saldo > 0 ? '+' : '') + saldo, alerta: saldo > 0, titulo: 'Positivo = entra más de lo que sale: la cola crece.' }
    ]) +
    '<div class="rp2-dos">' +
      '<div>' + sub_('Entradas por mes') + tendencia(serie.map(function (t) { return { etiqueta: t.etiqueta, valor: t.creadas }; }), { titulo: 'Creadas por mes' }) + '</div>' +
      '<div>' + sub_('Cierres por mes') + tendencia(serie.map(function (t) { return { etiqueta: t.etiqueta, valor: t.cerradas }; }), { titulo: 'Cerradas por mes' }) + '</div>' +
    '</div>' +
    sub_('Detalle') + tabla([{ campo: 'etiqueta', titulo: 'Mes' }, { campo: 'creadas', titulo: 'Entraron', alinear: 'derecha' }, { campo: 'cerradas', titulo: 'Se cerraron', alinear: 'derecha' }], serie);
  }
  function cuerpoResbalon(items, opts) {
    opts = opts || {};
    items = items || [];
    var movidos = items.filter(function (i) { return Number(i.re_compromisos) > 0 || Number(i.reaperturas) > 0; })
      .sort(function (a, b) { return (Number(b.re_compromisos) + Number(b.reaperturas)) - (Number(a.re_compromisos) + Number(a.reaperturas)); });
    var totalRe = items.reduce(function (s, i) { return s + (Number(i.re_compromisos) || 0); }, 0);
    var totalReab = items.reduce(function (s, i) { return s + (Number(i.reaperturas) || 0); }, 0);
    var columnas = [{ campo: 'titulo', titulo: 'Ítem' }].concat(opts.columnasExtra || []).concat([
      { campo: 'desarrollador_nombre', titulo: 'Responsable' }, { campo: 're_compromisos', titulo: 'Movió fecha', alinear: 'derecha' },
      { campo: 'reaperturas', titulo: 'Reaperturas', alinear: 'derecha' }, { campo: 'fecha_original', titulo: 'Fecha original' },
      { campo: 'fecha_comprometida', titulo: 'Fecha vigente' }
    ]);
    return kpis([
      { etiqueta: 'Ítems que movieron fecha', valor: items.filter(function (i) { return Number(i.re_compromisos) > 0; }).length },
      { etiqueta: 'Re-compromisos', valor: totalRe },
      { etiqueta: 'Reaperturas', valor: totalReab, alerta: totalReab > 0, titulo: 'Un ítem que se cerró y volvió a abrirse: el % de cumplimiento no lo captura.' }
    ]) + tabla(columnas, movidos, { vacio: 'Ningún ítem movió su fecha ni se reabrió. Nada que revisar.' });
  }

  // --- Documento -----------------------------------------------------------------------
  function cabeceraDocumento(opts) {
    opts = opts || {};
    var cuando;
    try { cuando = new Date().toLocaleString('es-CL', { dateStyle: 'long', timeStyle: 'short' }); } catch (e) { cuando = new Date().toISOString().slice(0, 16).replace('T', ' '); }
    var filtros = (opts.filtros || []).filter(function (f) { return f && f.valor; });
    var meta = [];
    if (opts.modulo) meta.push(['Módulo', opts.modulo]);
    if (opts.periodo) meta.push(['Período', opts.periodo]);
    if (opts.generadoPor) meta.push(['Generado por', opts.generadoPor]);
    filtros.forEach(function (f) { meta.push([f.etiqueta, f.valor]); });
    return '<header class="rp2-doc sx2-entra">' +
      '<div class="rp2-doc__cab"><span class="rp2-doc__marca"><span class="rp2-doc__logo">S</span><span class="sx2-apilado" style="gap:0"><strong>SIGSO</strong>' +
        '<span class="sx2-tenue" style="font-size:.75rem">' + esc_(opts.organizacion || 'Asesorías Integrales AyS SpA') + '</span></span></span>' +
        '<span class="rp2-doc__ref">' + (opts.codigo ? '<span>' + esc_(opts.codigo) + '</span>' : '') + '<span>' + esc_(cuando) + '</span></span></div>' +
      '<h1 class="rp2-doc__tit">' + esc_(opts.titulo || 'Reporte') + '</h1>' +
      (opts.subtitulo ? '<p class="rp2-doc__sub">' + esc_(opts.subtitulo) + '</p>' : '') +
      (meta.length ? '<dl class="rp2-doc__meta">' + meta.map(function (m) { return '<div><dt>' + esc_(m[0]) + '</dt><dd>' + esc_(m[1]) + '</dd></div>'; }).join('') + '</dl>' : '') +
    '</header>';
  }
  function pieDocumento(nota) {
    return '<footer class="rp2-doc-pie">' + esc_(nota || 'Documento generado por SIGSO a partir de los datos vigentes al momento de su emisión.') + '</footer>';
  }

  // --- Acciones y exportación -------------------------------------------------------------
  function barraAcciones(opts) {
    opts = opts || {};
    return '<div class="rp2-acciones">' +
      (opts.volver !== false ? U.boton({ texto: 'Centro de reportes', icono: 'izquierda', variante: 'fantasma', clase: 'js-rep-volver' }) : '') +
      '<span style="flex:1"></span>' +
      U.boton({ texto: 'Descargar Excel', icono: 'exportar', clase: 'js-rep-excel' }) +
      U.boton({ soloIcono: true, icono: 'imprimir', titulo: 'Imprimir desde el navegador', clase: 'js-rep-imprimir' }) +
      U.boton({ texto: 'Descargar PDF', icono: 'descargar', variante: 'primario', clase: 'js-rep-pdf' }) +
    '</div>';
  }
  function wireAcciones(contenedor, opts) {
    opts = opts || {};
    contenedor.querySelectorAll('.js-rep-volver').forEach(function (b) { b.addEventListener('click', function () { if (opts.onVolver) opts.onVolver(); }); });
    contenedor.querySelectorAll('.js-rep-excel').forEach(function (b) {
      b.addEventListener('click', function () {
        var tit = contenedor.querySelector('.rp2-doc__tit');
        descargarExcel(contenedor, { titulo: opts.titulo || (tit ? tit.textContent : 'Reporte'), nombreArchivo: opts.nombreArchivo, boton: b });
      });
    });
    contenedor.querySelectorAll('.js-rep-imprimir').forEach(function (b) { b.addEventListener('click', function () { window.print(); }); });
    contenedor.querySelectorAll('.js-rep-pdf').forEach(function (b) {
      b.addEventListener('click', function () {
        var tit = contenedor.querySelector('.rp2-doc__tit');
        descargarPdf(contenedor, { titulo: opts.titulo || (tit ? tit.textContent : 'Reporte'), nombreArchivo: opts.nombreArchivo, boton: b });
      });
    });
    U.animar(contenedor);
  }
  // --- PDF en el servidor (R-3 de la auditoría de reportes) ----------------------------------
  // Se manda el reporte TAL COMO SE VE (HTML + el CSS v2 que lo pinta) y el servidor lo
  // imprime con Chromium (backend/logica/reportePdf.js): papel idéntico a la pantalla. Si
  // el servidor aún no tiene el motor, cae a la impresión del navegador.
  //
  // El CSS no se elige por archivo (frágil: la base de un ícono vive en main.css, el de
  // una tarjeta en el CSS del módulo): se recorren TODAS las hojas de la página, en su
  // orden, y se guardan solo las reglas que tocan al reporte o a la cadena de elementos
  // que lo contiene. Es exactamente lo que lo pinta, y pesa una fracción del total.
  //
  // Se filtra el TEXTO ORIGINAL de cada hoja, no el CSSOM: Chrome no puede re-serializar
  // un atajo con variable seguido de una propiedad larga (`font: var(--x);
  // font-variant-numeric: …` sale como `font-size: ;`) y la regla se perdería.
  var PSEUDO_ = /::?(before|after|placeholder|marker|selection|first-line|first-letter|backdrop|-webkit-[a-z-]+|-moz-[a-z-]+)|:(hover|focus|focus-visible|focus-within|active|visited|checked|disabled|enabled|target)/g;
  // Bloques de primer nivel de un texto CSS: [{ pre: 'selector o @regla', cuerpo }].
  function bloquesCss_(txt) {
    var out = [], i = 0, n = txt.length;
    while (i < n) {
      var j = i, q = null;
      while (j < n && (q || (txt[j] !== '{' && txt[j] !== ';' && txt[j] !== '}'))) {
        if (q) { if (txt[j] === q && txt[j - 1] !== '\\') q = null; } else if (txt[j] === '"' || txt[j] === "'") q = txt[j];
        j++;
      }
      if (j >= n) break;
      if (txt[j] !== '{') { i = j + 1; continue; } // @import/@charset sueltos o llaves huérfanas
      var k = j + 1, prof = 1; q = null;
      while (k < n && prof) {
        var ch = txt[k];
        if (q) { if (ch === q && txt[k - 1] !== '\\') q = null; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '{') prof++; else if (ch === '}') prof--;
        k++;
      }
      out.push({ pre: txt.slice(i, j).trim(), cuerpo: txt.slice(j + 1, k - 1) });
      i = k;
    }
    return out;
  }
  // Separa "a, :is(b, c)" en ["a", ":is(b, c)"]: solo las comas de primer nivel.
  function partirSelector_(s) {
    var out = [], prof = 0, ini = 0;
    for (var i = 0; i < s.length; i++) {
      if (s[i] === '(' || s[i] === '[') prof++; else if (s[i] === ')' || s[i] === ']') prof--;
      else if (s[i] === ',' && !prof) { out.push(s.slice(ini, i)); ini = i + 1; }
    }
    out.push(s.slice(ini));
    return out;
  }
  function filtrarCss_(txt, toca) {
    return bloquesCss_(txt).map(function (b) {
      if (b.pre.charAt(0) === '@') {
        if (/^@(media|supports|container|layer)\b/i.test(b.pre)) { var sub = filtrarCss_(b.cuerpo, toca); return sub ? b.pre + '{' + sub + '}' : ''; }
        if (/^@property\b/i.test(b.pre)) return b.pre + '{' + b.cuerpo + '}'; // variables animables (arcos)
        return ''; // @font-face la pone el servidor; @keyframes no aplican en papel.
      }
      return partirSelector_(b.pre).some(toca) ? b.pre + '{' + b.cuerpo + '}' : '';
    }).filter(Boolean).join('\n');
  }
  // Textos originales de las hojas de la página, en orden (normalmente ya en caché).
  function textosCss_() {
    return Promise.all(Array.prototype.map.call(document.styleSheets, function (h) {
      if (!h.href) return Promise.resolve(h.ownerNode ? h.ownerNode.textContent || '' : '');
      if (h.href.indexOf(location.origin) !== 0) return Promise.resolve(''); // Google Fonts: la fuente la pone el servidor
      return fetch(h.href).then(function (r) { return r.ok ? r.text() : ''; }).catch(function () { return ''; });
    }));
  }
  function cssParaPdf_(raiz, textos) {
    function toca(sel) {
      var s = sel.replace(PSEUDO_, '').trim() || '*';
      try { return raiz.matches(s) || !!raiz.closest(s) || !!raiz.querySelector(s); } catch (e) { return false; }
    }
    return textos.map(function (t) { return filtrarCss_(String(t || '').replace(/\/\*[\s\S]*?\*\//g, ''), toca); }).filter(Boolean).join('\n');
  }
  // La cadena de ancestros del reporte viaja como "cascarones" (mismo tag, id y
  // clases, sin contenido propio): así los selectores del tipo `#gerencia-v2 .x`
  // siguen aplicando en el papel. El servidor los neutraliza (sin márgenes, rejilla
  // ni fondo) para que no desarmen la página.
  function cascarones_(raiz) {
    var cadena = [];
    for (var el = raiz.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) cadena.unshift(el);
    function abre(e) {
      var t = e.tagName.toLowerCase();
      if (!/^(div|section|main|article|aside|header|footer|nav|ul|ol|li)$/.test(t)) t = 'div';
      return { abre: '<' + t + (e.id ? ' id="' + esc_(e.id) + '"' : '') + (e.className && typeof e.className === 'string' ? ' class="' + esc_(e.className) + '"' : '') + ' data-rp2-cascaron>', cierra: '</' + t + '>' };
    }
    var partes = cadena.map(abre);
    return { abre: partes.map(function (p) { return p.abre; }).join(''), cierra: partes.reverse().map(function (p) { return p.cierra; }).join('') };
  }
  function htmlParaPdf_(raiz, cabecera) {
    var c = raiz.cloneNode(true);
    // Lo plegado en pantalla no se imprime (en papel no se puede desplegar); lo abierto
    // sí. Así quien descarga decide, p. ej., si el ánimo por persona va en el documento.
    Array.prototype.forEach.call(c.querySelectorAll('.rp2-acciones, .rp2-filtros, form, button, script, .js-no-pdf, details:not([open])'), function (el) { el.remove(); });
    // Lo que se anima en pantalla va con su valor final (no el cuadro a medio contar).
    Array.prototype.forEach.call(c.querySelectorAll('[data-sx-cifra]'), function (el) { el.textContent = el.getAttribute('data-sx-cifra') + (el.getAttribute('data-sx-sufijo') || ''); });
    Array.prototype.forEach.call(c.querySelectorAll('[data-sx-pct]'), function (el) { el.style.width = el.getAttribute('data-sx-pct') + '%'; });
    Array.prototype.forEach.call(c.querySelectorAll('[data-sx-arco]'), function (el) { el.setAttribute('stroke-dashoffset', el.getAttribute('data-sx-arco')); });
    // El reporte mismo también va como su elemento (con sus clases), no solo su interior.
    var cas = cascarones_(raiz);
    c.innerHTML = (cabecera || '') + c.innerHTML;
    return cas.abre + c.outerHTML + cas.cierra;
  }
  // raiz: el elemento del reporte. opts: { titulo, nombreArchivo, cabecera (html de
  // cabeceraDocumento, si la pantalla no la tiene), horizontal, boton }.
  function descargarPdf(raiz, opts) {
    opts = opts || {};
    var PY = window.PYv2;
    if (!raiz || !PY || !PY.api) { window.print(); return Promise.resolve(false); }
    var b = opts.boton;
    if (b) { b.disabled = true; b.setAttribute('aria-busy', 'true'); }
    return textosCss_().then(function (textos) {
      // La cabecera documental se inserta un instante en la página para que sus reglas
      // entren en la selección de CSS; se quita en el mismo tick, antes de pintar nada.
      var temp = [];
      if (opts.cabecera) {
        var t = document.createElement('div');
        t.innerHTML = opts.cabecera;
        var ref = raiz.firstChild;
        while (t.firstChild) { temp.push(t.firstChild); raiz.insertBefore(t.firstChild, ref); }
      }
      var css = cssParaPdf_(raiz, textos);
      temp.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
      return PY.api('generarPdfReporte', {
        html: htmlParaPdf_(raiz, opts.cabecera), css: css, titulo: opts.titulo || 'Reporte',
        nombre_archivo: opts.nombreArchivo || opts.titulo, horizontal: !!opts.horizontal
      });
    }).then(function (r) {
      if (b) { b.disabled = false; b.removeAttribute('aria-busy'); }
      if (r && r.ok && r.data && r.data.pdf_base64) { PY.descargarBase64(r.data.pdf_base64, r.data.filename, 'application/pdf'); return true; }
      var sinMotor = r && r.fields && r.fields[0] && r.fields[0].campo === 'motor' && /todavía no tiene/.test(r.message || '');
      if (PY.aviso) PY.aviso((r && r.message) || 'No se pudo generar el PDF.', sinMotor ? 'info' : 'error');
      if (sinMotor) window.print();
      return false;
    });
  }

  // --- Excel (R-4 de la auditoría de reportes) ----------------------------------------------
  // Reemplaza los CSV. Del reporte TAL COMO SE VE se arma una especificación — el resumen
  // (niveles 1–2) y cada tabla, ranking, agenda o gráfico de columnas como hoja — y el
  // servidor arma el .xlsx (backend/logica/libroExcel.js): números, porcentajes y fechas
  // como valores, estados con su color, filtros y barras en las celdas de porcentaje.
  // Mismo criterio que el PDF: lo plegado (<details> cerrado) no se exporta.
  var MIME_XLSX_ = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  function textoDe_(el, sinSel) {
    if (!el) return '';
    var c = el.cloneNode(true);
    if (sinSel) Array.prototype.forEach.call(c.querySelectorAll(sinSel), function (x) { x.remove(); });
    return String(c.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function tonoDe_(el) {
    var m = el && String(el.className || '').match(/sx2-tono-(ok|alerta|critico|info|neutro|primario)/);
    return m ? m[1] : '';
  }
  function visible_(el, raiz) {
    for (var e = el; e && e !== raiz; e = e.parentElement) if (e.tagName === 'DETAILS' && !e.open) return false;
    return true;
  }
  // Título de la hoja: el subtítulo más cercano hacia atrás DENTRO de su nivel, o el del
  // nivel (al llegar al nivel se corta: el subtítulo de un nivel anterior no es suyo).
  function nombreHoja_(el, raiz) {
    for (var e = el; e && e !== raiz; e = e.parentElement) {
      if (e.classList && e.classList.contains('rp2-nivel')) return textoDe_(e.querySelector('.rp2-nivel__tit'), '.rp2-nivel__nota').split(' · ')[0];
      for (var p = e.previousElementSibling; p; p = p.previousElementSibling) {
        if (p.matches && p.matches('h3.rp2-sub')) return textoDe_(p, '.sx2-tenue');
        var h = p.querySelector && p.querySelectorAll('h3.rp2-sub');
        if (h && h.length) return textoDe_(h[h.length - 1], '.sx2-tenue');
      }
    }
    return '';
  }
  function celdaExcel_(td) {
    if (td.querySelector('.rp2-escribir')) return '';
    var item = td.querySelector('.rp2-item');
    if (item) {
      var sub = textoDe_(item.querySelector('small'));
      return textoDe_(item.querySelector('strong')) + (sub && sub !== '(sin área)' ? ' · ' + sub : '');
    }
    // Las acotaciones tenues ("(43 d)", "sin cerrar") son de lectura en pantalla: fuera,
    // para que la fecha quede como fecha y el estado conserve su color.
    var texto = textoDe_(td, '.sx2-tenue');
    var badge = td.querySelector('.sx2-badge');
    if (badge && textoDe_(badge) === texto) return { v: texto, tono: tonoDe_(badge) || 'neutro' };
    return texto;
  }
  function hojasDe_(raiz) {
    var hojas = [];
    Array.prototype.forEach.call(raiz.querySelectorAll('table, ol.rp2-ranking, ul.rp2-agenda, figure.rp2-cols'), function (el) {
      if (!visible_(el, raiz)) return;
      var nombre = nombreHoja_(el, raiz), h;
      if (el.tagName === 'TABLE') {
        h = { nombre: nombre, columnas: Array.prototype.map.call(el.querySelectorAll('thead th'), function (th) { return textoDe_(th); }),
          filas: Array.prototype.map.call(el.querySelectorAll('tbody tr'), function (tr) { return Array.prototype.map.call(tr.children, celdaExcel_); }) };
      } else if (el.classList.contains('rp2-ranking')) {
        // "4/9 · 44%" en columnas separadas: así el porcentaje es un número (y lleva su barra).
        var filasR = Array.prototype.map.call(el.children, function (li) {
          return [textoDe_(li.querySelector('.rp2-ranking__etq'))].concat(textoDe_(li.querySelector('.rp2-ranking__val')).split(' · '));
        });
        var anchoR = filasR.reduce(function (m, f) { return Math.max(m, f.length); }, 2);
        h = { nombre: nombre, columnas: [nombre || 'Etiqueta', 'Valor'].concat(anchoR > 2 ? ['Detalle'] : [], anchoR > 3 ? Array(anchoR - 3).fill('') : []), filas: filasR };
      } else if (el.classList.contains('rp2-agenda')) {
        h = { nombre: nombre, columnas: ['Fecha', 'Qué', 'Detalle'], filas: Array.prototype.map.call(el.children, function (li) {
          return [textoDe_(li.querySelector('time')), textoDe_(li.querySelector('strong')), textoDe_(li.querySelector('small'))]; }) };
      } else {
        var series = Array.prototype.map.call(el.querySelectorAll('.rp2-cols__ley span'), function (s) { return textoDe_(s); });
        var conPie = el.classList.contains('rp2-cols--pie');
        h = { nombre: nombre, columnas: ['Período'].concat(conPie ? ['%'] : [], series), filas: Array.prototype.map.call(el.querySelectorAll('.rp2-cols__grupo'), function (g) {
          var et = g.querySelector('.rp2-cols__et');
          var vals = Array.prototype.map.call(g.querySelectorAll('.rp2-cols__b'), function (b) { return (String(b.getAttribute('title') || '').match(/:\s*(-?[\d.,]+)\s*$/) || [0, ''])[1]; });
          return [textoDe_(et, 'b')].concat(conPie ? [textoDe_(et && et.querySelector('b'))] : [], vals);
        }) };
      }
      if (h.filas.length) hojas.push(h);
    });
    return hojas;
  }
  // Especificación del libro a partir de lo que se ve. cabecera: html de cabeceraDocumento
  // para las vistas que no la muestran.
  function especExcel_(raiz, opts) {
    var cab = document.createElement('div');
    cab.innerHTML = opts.cabecera || '';
    var q = function (sel) { return raiz.querySelector(sel) || cab.querySelector(sel); };
    var meta = [];
    [cab, raiz].forEach(function (r) {
      Array.prototype.forEach.call(r.querySelectorAll('.rp2-doc__meta > div'), function (d) { meta.push([textoDe_(d.querySelector('dt')), textoDe_(d.querySelector('dd'))]); });
    });
    var linea = raiz.querySelector('.rp2-linea'), resumen = null;
    if (linea || raiz.querySelector('.rp2-alerta, .rp2-sinalertas, .rp2-kpis')) {
      resumen = {
        estado: linea ? (tonoDe_(linea) || 'ok') : '',
        frase: linea ? textoDe_(linea.querySelector('.rp2-linea__frase'), '.rp2-linea__estado') : '',
        kpis: Array.prototype.map.call(raiz.querySelectorAll('.rp2-linea .sx2-kpi, .rp2-kpis .sx2-kpi'), function (k) {
          var cifra = k.querySelector('[data-sx-cifra]');
          var unidad = textoDe_(k.querySelector('.sx2-kpi__unidad'));
          return { etiqueta: textoDe_(k.querySelector('.sx2-kpi__etiqueta')),
            valor: cifra ? cifra.getAttribute('data-sx-cifra') + (cifra.getAttribute('data-sx-sufijo') || '') : textoDe_(k.querySelector('.sx2-kpi__valor'), '.sx2-kpi__unidad'),
            nota: [unidad, textoDe_(k.querySelector('.sx2-kpi__tendencia'))].filter(Boolean).join(' · ') };
        }),
        alertas: raiz.querySelector('.rp2-alerta, .rp2-sinalertas') ? Array.prototype.map.call(raiz.querySelectorAll('.rp2-alerta'), function (a) {
          return { severidad: a.classList.contains('sx2-tono-critico') ? 'critico' : 'alerta', cantidad: textoDe_(a.querySelector('.rp2-alerta__cant')),
            titulo: textoDe_(a.querySelector('.rp2-alerta__txt strong')), detalle: textoDe_(a.querySelector('.rp2-alerta__txt > span')),
            dueno: textoDe_(a.querySelector('.rp2-alerta__dueno')) };
        }) : undefined,
        bien: Array.prototype.map.call(raiz.querySelectorAll('.rp2-bien li'), function (li) { return textoDe_(li); })
      };
    }
    return { titulo: opts.titulo || textoDe_(q('.rp2-doc__tit')) || 'Reporte', subtitulo: textoDe_(q('.rp2-doc__sub')),
      meta: meta, resumen: resumen, hojas: hojasDe_(raiz), nombre_archivo: opts.nombreArchivo || opts.titulo };
  }
  function pedirExcel_(espec, boton) {
    var PY = window.PYv2;
    if (!PY || !PY.api) return Promise.resolve(false);
    if (boton) { boton.disabled = true; boton.setAttribute('aria-busy', 'true'); }
    return PY.api('generarExcelReporte', espec).then(function (r) {
      if (boton) { boton.disabled = false; boton.removeAttribute('aria-busy'); }
      if (r && r.ok && r.data && r.data.xlsx_base64) { PY.descargarBase64(r.data.xlsx_base64, r.data.filename, MIME_XLSX_); return true; }
      if (PY.aviso) PY.aviso((r && r.message) || 'No se pudo generar el Excel.', 'error');
      return false;
    });
  }
  // raiz: el elemento del reporte. opts: { titulo, nombreArchivo, cabecera, boton }.
  function descargarExcel(raiz, opts) {
    opts = opts || {};
    return pedirExcel_(especExcel_(raiz, opts), opts.boton);
  }
  // Para listados que ya están en datos (bandeja, analítica…): espec = { titulo,
  // subtitulo, meta, hojas: [{ nombre, columnas, filas }], nombreArchivo }, opts = { boton }.
  function descargarExcelDeDatos(espec, opts) {
    espec = Object.assign({}, espec || {});
    espec.nombre_archivo = espec.nombreArchivo || espec.titulo;
    delete espec.nombreArchivo;
    return pedirExcel_(espec, (opts || {}).boton);
  }

  // --- Anatomía en 4 niveles (auditoría de reportes, 2026-09-25) ------------------------------
  // Todo reporte se lee igual: En una línea · Lo que requiere decisión · Panorama
  // · Detalle. Lo crítico va SEGUNDO: la mayoría lee solo la primera página, y es
  // lo que obliga a decidir. Ver documentacion/SIGSO-v2-reportes-auditoria.md.
  function fmtNum_(n) {
    try { return Number(n).toLocaleString('es-CL', { maximumFractionDigits: 1 }); } catch (e) { return String(n); }
  }
  function nivel(titulo, cuerpo, opts) {
    opts = opts || {};
    return '<section class="rp2-nivel' + (opts.clase ? ' ' + opts.clase : '') + '">' +
      '<h2 class="rp2-nivel__tit">' + esc_(titulo) + (opts.nota ? '<span class="rp2-nivel__nota">' + esc_(opts.nota) + '</span>' : '') + '</h2>' +
      cuerpo + '</section>';
  }
  var ESTADO_GENERAL_ = { ok: 'En control', alerta: 'Requiere atención', critico: 'Crítico', neutro: 'Sin actividad' };
  // o: { estado: 'ok'|'alerta'|'critico', frase, comparaCon, kpis: [{ etiqueta, valor,
  // sufijo, unidad, icono, tono, delta, deltaSufijo, menosEsMejor, nota, titulo, progreso }] }
  function enUnaLinea(o) {
    o = o || {};
    var est = ESTADO_GENERAL_[o.estado] ? o.estado : 'ok';
    var kp = (o.kpis || []).map(function (k, i) {
      var t = null;
      if (typeof k.delta === 'number' && isFinite(k.delta)) {
        var mejora = k.delta === 0 ? null : (k.menosEsMejor ? k.delta < 0 : k.delta > 0);
        t = {
          texto: (k.delta > 0 ? '+' : (k.delta < 0 ? '−' : '=')) + (k.delta === 0 ? '' : fmtNum_(Math.abs(k.delta)) + (k.deltaSufijo || '')) + ' ' + (o.comparaCon || 'vs. período anterior'),
          tono: mejora === null ? 'neutro' : (mejora ? 'ok' : 'critico'),
          icono: k.delta === 0 ? '' : (k.delta > 0 ? 'tendencia' : 'tendenciaBaja')
        };
      } else if (k.nota) {
        t = { texto: k.nota, tono: 'neutro' };
      }
      return U.kpi({ i: i, etiqueta: k.etiqueta, valor: k.valor, sufijo: k.sufijo, unidad: k.unidad, icono: k.icono,
        tono: k.tono || 'neutro', titulo: k.titulo, progreso: k.progreso, tendencia: t });
    }).join('');
    return '<div class="rp2-linea sx2-tono-' + est + '">' +
      '<p class="rp2-linea__frase"><span class="rp2-linea__estado">' + esc_(ESTADO_GENERAL_[est]) + '</span>' + esc_(o.frase || '') + '</p>' +
      (kp ? '<div class="rp2-linea__kpis">' + kp + '</div>' : '') +
    '</div>';
  }
  // alertas: [{ severidad: 'critico'|'alerta', titulo, detalle, cantidad, dueno }]. Se
  // ordenan por severidad y luego por cantidad; se muestran como máximo opts.max (7).
  // La severidad va también en texto: el color nunca es la única señal.
  function requiereDecision(alertas, opts) {
    opts = opts || {};
    function peso(a) { return a.severidad === 'critico' ? 0 : 1; }
    // opts.conservarOrden: la fuente ya las trae priorizadas con más matices que
    // crítico/atención (p. ej. el tablero SGC: CRITICA > ALTA > MEDIA).
    var lista = (alertas || []).filter(Boolean).slice();
    if (!opts.conservarOrden) lista.sort(function (a, b) {
      return (peso(a) - peso(b)) || ((b.cantidad || 0) - (a.cantidad || 0));
    });
    if (!lista.length) {
      return '<div class="rp2-sinalertas">' + U.ico('check', 18) + '<span><strong>Nada requiere una decisión en este corte.</strong>' +
        (opts.vacio ? ' ' + esc_(opts.vacio) : '') + '</span></div>';
    }
    var max = opts.max || 7, resto = lista.length - max;
    return '<ul class="rp2-alertas">' + lista.slice(0, max).map(function (a) {
      var sev = a.severidad === 'critico' ? 'critico' : 'alerta';
      return '<li class="rp2-alerta sx2-tono-' + sev + '">' +
        '<span class="rp2-alerta__cant">' + (a.cantidad !== undefined && a.cantidad !== null ? esc_(a.cantidad) : U.ico('alerta', 16)) + '</span>' +
        '<span class="rp2-alerta__txt"><strong>' + esc_(a.titulo) + '</strong>' + (a.detalle ? '<span>' + esc_(a.detalle) + '</span>' : '') + '</span>' +
        (a.dueno ? '<span class="rp2-alerta__dueno">' + esc_(a.dueno) + '</span>' : '') +
        '<span class="rp2-alerta__sev">' + (sev === 'critico' ? 'Crítico' : 'Atención') + '</span>' +
      '</li>';
    }).join('') + '</ul>' +
    (resto > 0 ? '<p class="rp2-alertas__mas">Y ' + resto + ' alerta' + (resto === 1 ? '' : 's') + ' más: están en el detalle.</p>' : '');
  }
  // Una o dos líneas de lo que va bien: con lo bueno se decide poco, pero se reconoce.
  function loQueVaBien(lineas) {
    lineas = (lineas || []).filter(Boolean);
    if (!lineas.length) return '';
    return '<ul class="rp2-bien">' + lineas.map(function (l) { return '<li>' + U.ico('check', 14) + '<span>' + esc_(l) + '</span></li>'; }).join('') + '</ul>';
  }
  // Columnas agrupadas por período (p. ej. entraron vs se cerraron por mes).
  // filas: [{ etiqueta, <campo>: n }], series: [{ campo, etiqueta, tono }].
  // f.pie (opcional): segunda línea bajo la etiqueta, p. ej. el % de la semana;
  // f.pieTono la colorea.
  function columnas(filas, series, opts) {
    opts = opts || {};
    var conPie = (filas || []).some(function (f) { return f.pie !== undefined && f.pie !== ''; });
    if (!filas || !filas.length) return vacio_(opts.vacio || 'Sin datos para graficar.');
    var max = filas.reduce(function (m, f) { return series.reduce(function (mm, s) { return Math.max(mm, Number(f[s.campo]) || 0); }, m); }, 0) || 1;
    return '<figure class="rp2-cols' + (conPie ? ' rp2-cols--pie' : '') + '">' +
      '<div class="rp2-cols__graf" role="img" aria-label="' + esc_(opts.titulo || 'Gráfico de columnas') + '">' + filas.map(function (f) {
        return '<div class="rp2-cols__grupo"><div class="rp2-cols__barras">' + series.map(function (s) {
          var v = Number(f[s.campo]) || 0;
          return '<span class="rp2-cols__b sx2-tono-' + (s.tono || 'primario') + '" style="height:' + Math.max(v ? 3 : 0, Math.round(v / max * 100)) + '%" title="' + esc_(s.etiqueta + ': ' + v) + '"><em>' + (v || '') + '</em></span>';
        }).join('') + '</div><span class="rp2-cols__et">' + esc_(f.etiqueta) +
          (conPie ? '<b' + (f.pieTono ? ' class="sx2-tono-' + f.pieTono + '"' : '') + '>' + esc_(f.pie === undefined ? '' : f.pie) + '</b>' : '') + '</span></div>';
      }).join('') + '</div>' +
      '<figcaption class="rp2-cols__ley">' + series.map(function (s) {
        return '<span><i class="sx2-tono-' + (s.tono || 'primario') + '"></i>' + esc_(s.etiqueta) + '</span>';
      }).join('') + '</figcaption>' +
    '</figure>';
  }

  window.SigsoReportes = {
    TIPOS: TIPOS, registrar: registrar, obtener: obtener, buscarReporte: buscarReporte,
    pintarCatalogo: pintarCatalogo, pintarFiltros: pintarFiltros, leerFiltros: leerFiltros, alAplicarFiltros: alAplicarFiltros,
    rangoDePeriodo: rangoDePeriodo, filtrarItems: filtrarItems, opcionesDeItems: opcionesDeItems,
    kpis: kpis, tabla: tabla, ranking: ranking, tendencia: tendencia, comparacion: comparacion,
    agruparCumplimiento: agruparCumplimiento, tablaCumplimiento: tablaCumplimiento,
    cuerpoCumplimientoPor: cuerpoCumplimientoPor, cuerpoEntradaSalida: cuerpoEntradaSalida, cuerpoResbalon: cuerpoResbalon,
    cabeceraDocumento: cabeceraDocumento, filtrosParaCabecera: filtrosParaCabecera, pieDocumento: pieDocumento,
    barraAcciones: barraAcciones, wireAcciones: wireAcciones,
    descargarExcel: descargarExcel, descargarExcelDeDatos: descargarExcelDeDatos,
    // Anatomía en 4 niveles.
    nivel: nivel, enUnaLinea: enUnaLinea, requiereDecision: requiereDecision, loQueVaBien: loQueVaBien, columnas: columnas,
    formatearNumero: fmtNum_,
    descargarPdf: descargarPdf,
    // Lo usa el servidor (backend/logica/documentoV2.js) para armar los PDF sin
    // pantalla con este mismo archivo: mismo filtrado de CSS, no una copia.
    _css: { filtrar: filtrarCss_, pseudo: PSEUDO_ }
  };
})();
