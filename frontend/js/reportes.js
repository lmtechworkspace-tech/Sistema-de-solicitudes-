/**
 * reportes.js — motor de reportes de SIGSO (v12.2, Fase 2 del encargo).
 *
 * QUÉ RESUELVE
 * Hasta la v12.1, "Reportes" era un submódulo con un catálogo declarativo que
 * vivía dentro de calidad.js. Funcionaba, pero cada módulo que quisiera
 * reportes tendría que reescribir lo mismo: el catálogo, los filtros, la
 * exportación y las piezas visuales.
 *
 * Este archivo es esa base compartida. NO trae reportes: trae con qué
 * construirlos.
 *
 * LAS TRES REGLAS QUE LO ORDENAN
 *
 * 1. UN REPORTE DECLARA DE QUÉ DATO REAL SALE.
 *    Si el dato no existe todavía, el reporte aparece igual pero marcado
 *    PENDIENTE y diciendo qué le falta. Nunca se dibuja un gráfico con datos
 *    inventados para llenar la pantalla: en un SGC lo que se muestra es
 *    evidencia frente a un auditor, y un reporte que miente es peor que uno
 *    que falta.
 *
 * 2. SÓLO SE MUESTRAN LOS FILTROS QUE APLICAN.
 *    Cada reporte declara sus filtros. Un selector de "área" en un reporte
 *    que no desagrega por área no es neutro: promete un corte que no existe.
 *
 * 3. NO DECIDE PERMISOS.
 *    Igual que navegacion.js: recibe un predicado y lo obedece. El backend
 *    sigue siendo quien manda.
 *
 * DEPENDENCIAS: ninguna externa. Las tendencias y los rankings se dibujan con
 * SVG inline y CSS, no con Chart.js -- así el motor funciona también en
 * admin.html, que no carga la librería.
 */
(function () {
  'use strict';

  // --- Tipos de reporte (§13 del encargo) ------------------------------------
  // El tipo NO es decorativo: determina qué filtros tienen sentido por defecto
  // y con qué pieza visual se dibuja el resultado.
  var TIPOS = {
    ESTADO: { etiqueta: 'Estado', filtros: ['periodo', 'area', 'responsable', 'estado'] },
    CUMPLIMIENTO: { etiqueta: 'Cumplimiento', filtros: ['periodo', 'area', 'responsable'] },
    TENDENCIA: { etiqueta: 'Tendencia', filtros: ['desde', 'hasta', 'area'] },
    COMPARACION: { etiqueta: 'Comparación', filtros: ['periodo', 'periodo_previo', 'area'] },
    RANKING: { etiqueta: 'Ranking', filtros: ['periodo', 'dimension'] },
    DETALLE: { etiqueta: 'Detalle', filtros: ['periodo', 'area', 'responsable', 'estado'] }
  };

  var ETIQUETA_ESTADO = {
    LISTO: 'Disponible',
    SIN_DATOS: 'Sin datos aún',
    PENDIENTE: 'Requiere desarrollo'
  };
  var TONO_ESTADO = { LISTO: 'ok', SIN_DATOS: 'alerta', PENDIENTE: 'neutro' };

  var registro_ = {};

  function esc_(t) {
    return window.Componentes ? window.Componentes.escaparHtml(t) : String(t == null ? '' : t);
  }
  function icono_(n, tam) {
    if (!n || !window.Iconos || !window.Iconos.svg) return '';
    return window.Iconos.svg(n, { tam: tam || 16 });
  }

  /**
   * Registra el catálogo de reportes de un módulo.
   * @param {string} moduloId
   * @param {{grupos:Array, abrir:Function}} definicion
   *   grupos: [{ grupo, icono, reportes: [{id,nombre,tipo,estado,desc,fuente,falta,filtros,seccion}] }]
   *   abrir:  function (reporteId, filtros, contenedor) -> pinta el reporte
   */
  function registrar(moduloId, definicion) {
    registro_[moduloId] = definicion;
  }

  function obtener(moduloId) { return registro_[moduloId] || null; }

  function buscarReporte(moduloId, reporteId) {
    var def = obtener(moduloId);
    if (!def) return null;
    var hallado = null;
    (def.grupos || []).forEach(function (g) {
      (g.reportes || []).forEach(function (r) { if (r.id === reporteId) hallado = r; });
    });
    return hallado;
  }

  // ==========================================================================
  // CATÁLOGO
  // ==========================================================================
  function pintarCatalogo(opts) {
    var cont = opts.contenedor;
    var def = obtener(opts.modulo);
    if (!cont || !def) return;

    var listos = 0, total = 0;
    (def.grupos || []).forEach(function (g) {
      (g.reportes || []).forEach(function (r) {
        if (typeof opts.visible === 'function' && opts.visible(r) === false) return;
        total++;
        if (r.estado === 'LISTO') listos++;
      });
    });

    cont.innerHTML =
      (opts.encabezado || '') +
      '<div class="sgc-cabecera"><div>' +
        '<h2>' + esc_(def.titulo || 'Centro de reportes') + '</h2>' +
        '<p class="sigso-ayuda">' + listos + ' de ' + total + ' reportes se arman hoy con datos reales ' +
        'del sistema; el resto dice qué le falta.</p>' +
      '</div></div>' +
      (def.nota ? window.Componentes.alerta(def.nota, 'info') : '') +
      (def.grupos || []).map(function (g) {
        var reportes = (g.reportes || []).filter(function (r) {
          return typeof opts.visible !== 'function' || opts.visible(r) !== false;
        });
        if (!reportes.length) return '';
        return '<section class="sgc-rep-grupo">' +
          '<h3 class="sgc-rep-grupo__tit">' + icono_(g.icono, 16) +
            '<span>' + esc_(g.grupo) + '</span></h3>' +
          '<div class="sgc-rep-lista">' + reportes.map(tarjeta_).join('') + '</div>' +
        '</section>';
      }).join('');

    cont.querySelectorAll('[data-reporte]').forEach(function (card) {
      function abrir() {
        var id = card.getAttribute('data-reporte');
        var seccion = card.getAttribute('data-seccion');
        // Un reporte que ya vive dentro de una sección no se duplica: se
        // navega a ella. Duplicarlo sería crear la segunda versión de algo
        // que ya existe.
        if (seccion && typeof opts.onIrASeccion === 'function') { opts.onIrASeccion(seccion); return; }
        if (typeof opts.onAbrir === 'function') opts.onAbrir(id);
      }
      card.addEventListener('click', abrir);
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); }
      });
    });
  }

  function tarjeta_(r) {
    var accionable = r.estado === 'LISTO';
    var tipo = TIPOS[r.tipo];
    return '<article class="sgc-rep-card' + (accionable ? ' sgc-rep-card--activa' : '') + '"' +
        (accionable ? ' tabindex="0" role="button" data-reporte="' + esc_(r.id) + '"' +
          ' data-seccion="' + esc_(r.seccion || '') + '"' : '') + '>' +
      '<div class="sgc-rep-card__cab">' +
        '<h4>' + esc_(r.nombre) + '</h4>' +
        window.Componentes.badge(ETIQUETA_ESTADO[r.estado], TONO_ESTADO[r.estado]) +
      '</div>' +
      (tipo ? '<span class="sgc-rep-card__tipo">' + esc_(tipo.etiqueta) + '</span>' : '') +
      '<p class="sgc-rep-card__desc">' + esc_(r.desc) + '</p>' +
      (r.falta
        ? '<p class="sgc-rep-card__falta"><strong>Falta:</strong> ' + esc_(r.falta) + '</p>'
        : '<p class="sgc-rep-card__fuente">Sale de: <code>' + esc_(r.fuente || '') + '</code></p>') +
    '</article>';
  }

  // ==========================================================================
  // FILTROS
  // ==========================================================================
  // Sólo se dibujan los que el reporte declara. Cada uno sabe qué opciones
  // ofrecer; las dinámicas (áreas, responsables) las provee el módulo.
  function pintarFiltros(reporte, opciones, valores) {
    var lista = reporte.filtros || (TIPOS[reporte.tipo] || {}).filtros || [];
    if (!lista.length) return '';
    valores = valores || {};
    opciones = opciones || {};

    var campos = lista.map(function (f) {
      if (f === 'periodo') return select_('periodo', 'Período', opciones.periodo || PERIODOS_POR_DEFECTO, valores.periodo);
      if (f === 'periodo_previo') return select_('periodo_previo', 'Comparar con', opciones.periodo || PERIODOS_POR_DEFECTO, valores.periodo_previo);
      if (f === 'desde') return fecha_('desde', 'Desde', valores.desde);
      if (f === 'hasta') return fecha_('hasta', 'Hasta', valores.hasta);
      if (f === 'area') return select_('area', 'Área', opciones.area || [], valores.area, 'Todas');
      if (f === 'responsable') return select_('responsable', 'Responsable', opciones.responsable || [], valores.responsable, 'Todos');
      if (f === 'estado') return select_('estado', 'Estado', opciones.estado || [], valores.estado, 'Todos');
      if (f === 'dimension') return select_('dimension', 'Agrupar por', opciones.dimension || [], valores.dimension);
      if (f === 'proceso') return select_('proceso', 'Proceso', opciones.proceso || [], valores.proceso, 'Todos');
      return '';
    }).filter(Boolean).join('');

    return '<form class="sigso-rep-filtros" id="rep-filtros">' + campos +
      '<button type="submit" class="sigso-boton sigso-boton--secundario">Aplicar</button>' +
      '</form>';
  }

  var PERIODOS_POR_DEFECTO = [
    { valor: 'mes', texto: 'Este mes' },
    { valor: 'trimestre', texto: 'Este trimestre' },
    { valor: 'anio', texto: 'Este año' },
    { valor: 'todo', texto: 'Todo' }
  ];

  function select_(nombre, etiqueta, opciones, valor, textoVacio) {
    var opts = (textoVacio ? '<option value="">' + esc_(textoVacio) + '</option>' : '') +
      (opciones || []).map(function (o) {
        var v = o.valor !== undefined ? o.valor : o;
        var t = o.texto !== undefined ? o.texto : o;
        return '<option value="' + esc_(v) + '"' + (String(v) === String(valor || '') ? ' selected' : '') + '>' +
          esc_(t) + '</option>';
      }).join('');
    return '<label class="sigso-rep-filtro"><span>' + esc_(etiqueta) + '</span>' +
      '<select name="' + esc_(nombre) + '">' + opts + '</select></label>';
  }

  function fecha_(nombre, etiqueta, valor) {
    return '<label class="sigso-rep-filtro"><span>' + esc_(etiqueta) + '</span>' +
      '<input type="date" name="' + esc_(nombre) + '" value="' + esc_(valor || '') + '"></label>';
  }

  function leerFiltros(contenedor) {
    var form = contenedor.querySelector('#rep-filtros');
    if (!form) return {};
    var out = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (el.name) out[el.name] = el.value;
    });
    return out;
  }

  function alAplicarFiltros(contenedor, fn) {
    var form = contenedor.querySelector('#rep-filtros');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      fn(leerFiltros(contenedor));
    });
  }

  // ==========================================================================
  // PIEZAS VISUALES
  // ==========================================================================

  /** Fila de KPIs. Reusa Componentes.kpi para no inventar un segundo estilo. */
  function kpis(lista) {
    if (!lista || !lista.length) return '';
    return '<div class="sgc-kpis">' + lista.map(function (k) {
      return window.Componentes.kpi(k);
    }).join('') + '</div>';
  }

  /**
   * Tabla con exportación. `columnas` = [{campo, titulo, alinear}].
   * Se declara la tabla una vez y de ahí sale el CSV: así lo exportado es
   * exactamente lo que se ve, y no una segunda consulta que podría diferir.
   */
  function tabla(columnas, filas, opts) {
    opts = opts || {};
    if (!filas || !filas.length) {
      return window.Componentes.vacio(opts.vacio || 'No hay datos para este corte.');
    }
    var id = opts.id || 'rep-tabla';
    return '<div class="sigso-rep-tabla-caja">' +
      '<table class="sigso-tabla" id="' + esc_(id) + '"><thead><tr>' +
        columnas.map(function (c) {
          return '<th' + (c.alinear === 'derecha' ? ' class="sigso-rep-num"' : '') + '>' + esc_(c.titulo) + '</th>';
        }).join('') +
      '</tr></thead><tbody>' +
        filas.map(function (f) {
          return '<tr>' + columnas.map(function (c) {
            var v = f[c.campo];
            return '<td' + (c.alinear === 'derecha' ? ' class="sigso-rep-num"' : '') + '>' +
              (c.html ? (v == null ? '' : v) : esc_(v == null ? '' : v)) + '</td>';
          }).join('') + '</tr>';
        }).join('') +
      '</tbody></table></div>';
  }

  /**
   * Ranking: barras horizontales en CSS puro. El ancho es proporcional al
   * máximo, y el valor va SIEMPRE escrito -- una barra sin número obliga a
   * estimar a ojo, que es justo lo que un reporte no debe pedir.
   */
  function ranking(filas, opts) {
    opts = opts || {};
    if (!filas || !filas.length) {
      return window.Componentes.vacio(opts.vacio || 'No hay datos para este ranking.');
    }
    var max = filas.reduce(function (m, f) { return Math.max(m, Number(f.valor) || 0); }, 0) || 1;
    return '<ol class="sigso-rep-ranking">' + filas.map(function (f, i) {
      var pct = Math.round((Number(f.valor) || 0) / max * 100);
      return '<li class="sigso-rep-ranking__fila">' +
        '<span class="sigso-rep-ranking__pos">' + (i + 1) + '</span>' +
        '<span class="sigso-rep-ranking__etq">' + esc_(f.etiqueta) + '</span>' +
        '<span class="sigso-rep-ranking__barra"><span style="width:' + pct + '%"></span></span>' +
        '<span class="sigso-rep-ranking__val">' + esc_(f.texto !== undefined ? f.texto : f.valor) + '</span>' +
      '</li>';
    }).join('') + '</ol>';
  }

  /**
   * Serie temporal en SVG inline. `puntos` = [{etiqueta, valor}].
   * SVG y no Chart.js para que el motor sirva también donde la librería no
   * está cargada (admin.html), y para que el reporte se imprima bien.
   */
  function tendencia(puntos, opts) {
    opts = opts || {};
    if (!puntos || puntos.length < 2) {
      return window.Componentes.vacio(opts.vacio ||
        'Hacen falta al menos dos períodos medidos para dibujar una tendencia.');
    }
    var an = 640, al = 180, m = { i: 44, d: 12, s: 16, b: 28 };
    var valores = puntos.map(function (p) { return Number(p.valor) || 0; });
    var max = Math.max.apply(null, valores);
    var min = Math.min.apply(null, valores);
    if (max === min) { max = max + 1; min = Math.max(0, min - 1); }
    var ax = an - m.i - m.d, ay = al - m.s - m.b;
    var x = function (i) { return m.i + (puntos.length === 1 ? ax / 2 : (i / (puntos.length - 1)) * ax); };
    var y = function (v) { return m.s + ay - ((v - min) / (max - min)) * ay; };

    var linea = puntos.map(function (p, i) {
      return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(Number(p.valor) || 0).toFixed(1);
    }).join(' ');

    var meta = opts.meta !== undefined && opts.meta !== null && opts.meta !== ''
      ? '<line x1="' + m.i + '" y1="' + y(Number(opts.meta)).toFixed(1) + '" x2="' + (an - m.d) +
        '" y2="' + y(Number(opts.meta)).toFixed(1) + '" class="sigso-rep-meta"/>' +
        '<text x="' + (an - m.d) + '" y="' + (y(Number(opts.meta)) - 4).toFixed(1) +
        '" class="sigso-rep-meta-txt" text-anchor="end">meta ' + esc_(opts.meta) + '</text>'
      : '';

    return '<figure class="sigso-rep-tendencia">' +
      '<svg viewBox="0 0 ' + an + ' ' + al + '" role="img" aria-label="' +
        esc_(opts.titulo || 'Serie temporal') + '">' +
        '<line x1="' + m.i + '" y1="' + m.s + '" x2="' + m.i + '" y2="' + (m.s + ay) + '" class="sigso-rep-eje"/>' +
        '<line x1="' + m.i + '" y1="' + (m.s + ay) + '" x2="' + (an - m.d) + '" y2="' + (m.s + ay) + '" class="sigso-rep-eje"/>' +
        '<text x="' + (m.i - 6) + '" y="' + (m.s + 4) + '" class="sigso-rep-tick" text-anchor="end">' + esc_(max) + '</text>' +
        '<text x="' + (m.i - 6) + '" y="' + (m.s + ay) + '" class="sigso-rep-tick" text-anchor="end">' + esc_(min) + '</text>' +
        meta +
        '<path d="' + linea + '" class="sigso-rep-linea"/>' +
        puntos.map(function (p, i) {
          return '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(Number(p.valor) || 0).toFixed(1) +
            '" r="3.5" class="sigso-rep-punto"><title>' + esc_(p.etiqueta) + ': ' + esc_(p.valor) + '</title></circle>';
        }).join('') +
        puntos.map(function (p, i) {
          // Con muchos períodos las etiquetas se pisan: se muestra una de cada N.
          var salto = Math.ceil(puntos.length / 8);
          if (i % salto !== 0 && i !== puntos.length - 1) return '';
          return '<text x="' + x(i).toFixed(1) + '" y="' + (al - 8) + '" class="sigso-rep-tick" text-anchor="middle">' +
            esc_(p.etiqueta) + '</text>';
        }).join('') +
      '</svg>' +
      // La tabla es la versión accesible del gráfico: un lector de pantalla no
      // puede leer un <path>, y además permite exportar lo mismo que se ve.
      '<figcaption class="sigso-rep-tendencia__pie">' +
        puntos.map(function (p) { return esc_(p.etiqueta) + ': ' + esc_(p.valor); }).join(' · ') +
      '</figcaption>' +
    '</figure>';
  }

  /**
   * Comparación de dos períodos. Muestra ambos valores y la variación, con
   * el signo escrito -- el color solo no basta (§20 del encargo).
   */
  function comparacion(filas, opts) {
    opts = opts || {};
    if (!filas || !filas.length) {
      return window.Componentes.vacio(opts.vacio || 'No hay datos para comparar.');
    }
    return '<table class="sigso-tabla sigso-rep-comparacion"><thead><tr>' +
      '<th>' + esc_(opts.dimension || 'Concepto') + '</th>' +
      '<th class="sigso-rep-num">' + esc_(opts.etiquetaPrevio || 'Período anterior') + '</th>' +
      '<th class="sigso-rep-num">' + esc_(opts.etiquetaActual || 'Período actual') + '</th>' +
      '<th class="sigso-rep-num">Variación</th>' +
      '</tr></thead><tbody>' +
      filas.map(function (f) {
        var a = Number(f.previo) || 0, b = Number(f.actual) || 0;
        var d = b - a;
        // "mejor" invierte el sentido: en "no conformidades abiertas" bajar es bueno.
        var bueno = opts.menosEsMejor ? d < 0 : d > 0;
        var tono = d === 0 ? 'neutro' : (bueno ? 'ok' : 'critico');
        var signo = d > 0 ? '+' : (d < 0 ? '−' : '=');
        return '<tr>' +
          '<td>' + esc_(f.etiqueta) + '</td>' +
          '<td class="sigso-rep-num">' + esc_(a) + '</td>' +
          '<td class="sigso-rep-num">' + esc_(b) + '</td>' +
          '<td class="sigso-rep-num"><span class="sigso-rep-var sigso-rep-var--' + tono + '">' +
            signo + ' ' + esc_(Math.abs(d)) + '</span></td>' +
        '</tr>';
      }).join('') +
      '</tbody></table>';
  }

  // ==========================================================================
  // CUMPLIMIENTO SOBRE ÍTEMS CON FECHA (v12.4)
  //
  // Se promueve al motor porque Gerencia y Jefatura la necesitan igual, y
  // porque la REGLA de qué se cuenta no debe poder divergir entre módulos:
  // si un panel midiera distinto que el otro, los dos números serían
  // sospechosos y no habría forma de saber cuál creer.
  //
  // LA REGLA: el cumplimiento se mide SOLO sobre lo entregado CON fecha
  // comprometida. Un ítem sin comprometer no cuenta como incumplido -- no hay
  // promesa que romper todavía, y meterlo hundiría el porcentaje de quien
  // recién recibió trabajo. Quien no tiene entregas queda con pct = null, que
  // se muestra como "sin entregas" y NUNCA como 0%.
  // ==========================================================================

  function agruparCumplimiento(items, campo, etiquetaVacia) {
    var grupos = {};
    (items || []).forEach(function (i) {
      var k = i[campo] || etiquetaVacia || '(sin dato)';
      if (!grupos[k]) grupos[k] = { total: 0, entregados: 0, aTiempo: 0, abiertos: 0 };
      grupos[k].total++;
      if (i.fecha_terminada && i.fecha_comprometida) {
        grupos[k].entregados++;
        if (new Date(i.fecha_terminada) <= new Date(i.fecha_comprometida)) grupos[k].aTiempo++;
      } else if (!i.fecha_terminada) {
        grupos[k].abiertos++;
      }
    });
    return Object.keys(grupos).map(function (k) {
      var g = grupos[k];
      return {
        etiqueta: k, total: g.total, entregados: g.entregados,
        aTiempo: g.aTiempo, abiertos: g.abiertos,
        pct: g.entregados ? Math.round(g.aTiempo / g.entregados * 100) : null
      };
    }).sort(function (a, b) {
      // Los que no tienen entregas van al final: no se pueden ordenar por un
      // porcentaje que no existe.
      if (a.pct === null && b.pct === null) return b.total - a.total;
      if (a.pct === null) return 1;
      if (b.pct === null) return -1;
      return b.pct - a.pct;
    });
  }

  function tablaCumplimiento(filas, etiquetaDimension) {
    return tabla([
      { campo: 'etiqueta', titulo: etiquetaDimension },
      { campo: 'total', titulo: 'Ítems', alinear: 'derecha' },
      { campo: 'abiertos', titulo: 'Abiertos', alinear: 'derecha' },
      { campo: 'entregados', titulo: 'Entregados', alinear: 'derecha' },
      { campo: 'aTiempo', titulo: 'A tiempo', alinear: 'derecha' },
      { campo: 'pctTexto', titulo: 'Cumplimiento', alinear: 'derecha' }
    ], filas.map(function (f) {
      var o = {};
      Object.keys(f).forEach(function (k) { o[k] = f[k]; });
      o.pctTexto = f.pct === null ? 'sin entregas' : f.pct + '%';
      return o;
    }), { vacio: 'No hay ítems en este corte.' });
  }

  /**
   * Cuerpo completo de un reporte de cumplimiento por una dimensión.
   * @param {Array} items
   * @param {Object} opts { campo, etiquetaVacia, dimension, etiquetaTotal }
   */
  function cuerpoCumplimientoPor(items, opts) {
    opts = opts || {};
    var filas = agruparCumplimiento(items, opts.campo, opts.etiquetaVacia);
    var medibles = filas.filter(function (f) { return f.pct !== null; });
    return kpis([
      { etiqueta: opts.etiquetaTotal || (opts.dimension + 's'), valor: filas.length },
      { etiqueta: 'Ítems considerados', valor: (items || []).length },
      { etiqueta: 'Ya medibles', valor: medibles.length,
        titulo: 'Sólo se puede medir cumplimiento donde hay entregas con fecha comprometida.' }
    ]) +
    ranking(medibles.map(function (f) {
      return { etiqueta: f.etiqueta, valor: f.pct, texto: f.pct + '%' };
    }), { vacio: 'Todavía no hay entregas con fecha comprometida: no hay cumplimiento que medir.' }) +
    '<h4>Detalle</h4>' +
    tablaCumplimiento(filas, opts.dimension || 'Grupo');
  }

  /**
   * Entrada vs salida por mes. `serie` = [{etiqueta, creadas, cerradas, ...}],
   * el formato que ya devuelven calcularTendenciaTemporal_ (Gerencia) y
   * calcularTendenciaJefatura_.
   */
  function cuerpoEntradaSalida(serie) {
    serie = serie || [];
    if (!serie.length) return window.Componentes.vacio('Sin datos de los últimos meses.');
    var entraron = serie.reduce(function (s, t) { return s + (Number(t.creadas) || 0); }, 0);
    var cerradas = serie.reduce(function (s, t) { return s + (Number(t.cerradas) || 0); }, 0);
    var saldo = entraron - cerradas;
    return kpis([
      { etiqueta: 'Entraron', valor: entraron },
      { etiqueta: 'Se cerraron', valor: cerradas },
      { etiqueta: 'Saldo de la cola', valor: (saldo > 0 ? '+' : '') + saldo, alerta: saldo > 0,
        titulo: 'Positivo = entra más de lo que sale: la cola crece.' }
    ]) +
    '<h4>Entradas por mes</h4>' +
    tendencia(serie.map(function (t) { return { etiqueta: t.etiqueta, valor: t.creadas }; }),
      { titulo: 'Creadas por mes' }) +
    '<h4>Cierres por mes</h4>' +
    tendencia(serie.map(function (t) { return { etiqueta: t.etiqueta, valor: t.cerradas }; }),
      { titulo: 'Cerradas por mes' }) +
    '<h4>Detalle</h4>' +
    tabla([
      { campo: 'etiqueta', titulo: 'Mes' },
      { campo: 'creadas', titulo: 'Entraron', alinear: 'derecha' },
      { campo: 'cerradas', titulo: 'Se cerraron', alinear: 'derecha' }
    ], serie);
  }

  // ==========================================================================
  // EXPORTACIÓN (§13)
  // ==========================================================================
  // El CSV sale de la TABLA YA PINTADA, no de una segunda consulta: así lo que
  // se descarga es exactamente lo que la persona está viendo. Si saliera de
  // otra consulta podrían diferir, y en un reporte de gestión eso es grave.
  function barraAcciones(opts) {
    opts = opts || {};
    return '<div class="sigso-rep-acciones">' +
      (opts.volver !== false
        ? '<button type="button" class="sigso-boton--sutil js-rep-volver">← Centro de reportes</button>' : '') +
      '<span class="sigso-rep-acciones__sep"></span>' +
      '<button type="button" class="sigso-boton--secundario js-rep-csv">Exportar CSV</button>' +
      '<button type="button" class="sigso-boton--secundario js-rep-imprimir">Imprimir / PDF</button>' +
    '</div>';
  }

  function wireAcciones(contenedor, opts) {
    opts = opts || {};
    contenedor.querySelectorAll('.js-rep-volver').forEach(function (b) {
      b.addEventListener('click', function () { if (opts.onVolver) opts.onVolver(); });
    });
    contenedor.querySelectorAll('.js-rep-csv').forEach(function (b) {
      b.addEventListener('click', function () {
        var tabla = contenedor.querySelector('table');
        if (!tabla) {
          window.Componentes.aviso({ texto: 'Este reporte no tiene una tabla que exportar.', tipo: 'aviso' });
          return;
        }
        descargarCsv_(tabla, opts.nombreArchivo || 'sigso-reporte');
      });
    });
    contenedor.querySelectorAll('.js-rep-imprimir').forEach(function (b) {
      b.addEventListener('click', function () { window.print(); });
    });
  }

  function descargarCsv_(tabla, nombre) {
    var lineas = [];
    Array.prototype.forEach.call(tabla.querySelectorAll('tr'), function (tr) {
      var celdas = Array.prototype.map.call(tr.querySelectorAll('th,td'), function (c) {
        // El texto visible, no el HTML: lo que se exporta es lo que se lee.
        return '"' + String(c.innerText || '').trim().replace(/"/g, '""') + '"';
      });
      if (celdas.length) lineas.push(celdas.join(','));
    });
    // El primer caracter del literal de abajo es un BOM (U+FEFF). Es
    // INVISIBLE en el editor, asi que no lo borres: sin el, Excel en Windows
    // abre el CSV con los acentos rotos y hay que importarlo a mano.
    var blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombre + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  window.SigsoReportes = {
    TIPOS: TIPOS,
    registrar: registrar,
    obtener: obtener,
    buscarReporte: buscarReporte,
    pintarCatalogo: pintarCatalogo,
    pintarFiltros: pintarFiltros,
    leerFiltros: leerFiltros,
    alAplicarFiltros: alAplicarFiltros,
    kpis: kpis,
    tabla: tabla,
    ranking: ranking,
    tendencia: tendencia,
    comparacion: comparacion,
    agruparCumplimiento: agruparCumplimiento,
    tablaCumplimiento: tablaCumplimiento,
    cuerpoCumplimientoPor: cuerpoCumplimientoPor,
    cuerpoEntradaSalida: cuerpoEntradaSalida,
    barraAcciones: barraAcciones,
    wireAcciones: wireAcciones
  };
})();
