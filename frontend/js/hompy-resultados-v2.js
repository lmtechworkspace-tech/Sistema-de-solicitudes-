/**
 * hompy-resultados-v2.js — Resultados TikTok (2026-10-08).
 *
 * Con las métricas que anotan en cada video publicado (Estudio TikTok, etapa
 * «Publicado»: a las 24 h y a los 7 días) responde «qué tipo de video nos
 * funciona»: ranking de videos y promedios por objetivo, formato y duración,
 * más lo que Hompy saca en limpio. No pide nada nuevo al servidor.
 *
 * Vistas de un video = las de 7 días si están, si no las de 24 h.
 * Interacción = (me gusta + comentarios + compartidos + guardados) ÷ vistas.
 */
(function () {
  'use strict';

  var U = UIv2;
  function H() { return window.SigsoHompy._interno; }
  function D() { return H().datos(); }
  function txt(v) { return H().txt(v); }
  var OBJ = { EDUCAR: 'Educar', ENTRETENER: 'Entretener', MARCA: 'Marca', TENDENCIA: 'Tendencia' };
  var orden_ = 'vistas';

  function num(n) { return n == null ? '—' : Math.round(n).toLocaleString('es-CL'); }
  function pct(n) { return n == null ? '—' : n.toFixed(1).replace('.', ',') + ' %'; }
  function metricas(i) {
    var p = i.publicacion, m = p.d7 && p.d7.vistas != null ? p.d7 : p.h24;
    var vistas = m && m.vistas != null ? m.vistas : null;
    var inter = vistas ? (Number(m.me_gusta || 0) + Number(m.comentarios || 0) + Number(m.compartidos || 0) + Number(m.guardados || 0)) / vistas * 100 : null;
    var crec = p.h24.vistas && p.d7.vistas ? Math.round((p.d7.vistas / p.h24.vistas - 1) * 100) : null;
    return { vistas: vistas, inter: inter, v24: p.h24.vistas, v7: p.d7.vistas, crec: crec };
  }
  function publicados() { return (D().ideas || []).filter(function (i) { return i.etapa === 'PUBLICADO'; }); }
  function conMetricas() { return publicados().map(function (i) { return { i: i, m: metricas(i) }; }).filter(function (x) { return x.m.vistas != null; }); }
  /** Promedios por grupo (objetivo, formato o duración). */
  function grupos(l, clave, nombre) {
    var g = {};
    l.forEach(function (x) {
      var k = clave(x.i); if (k == null || k === '') return;
      var o = g[k] = g[k] || { k: k, n: nombre(k), videos: 0, vistas: 0, inter: 0, nInter: 0 };
      o.videos++; o.vistas += x.m.vistas;
      if (x.m.inter != null) { o.inter += x.m.inter; o.nInter++; }
    });
    return Object.keys(g).map(function (k) { var o = g[k]; o.promVistas = o.vistas / o.videos; o.promInter = o.nInter ? o.inter / o.nInter : null; return o; })
      .sort(function (a, b) { return b.promVistas - a.promVistas; });
  }
  function bloqueGrupo(titulo, ico, l) {
    if (!l.length) return '';
    var max = Math.max.apply(null, l.map(function (o) { return o.promVistas; })) || 1;
    var mejorInter = l.filter(function (o) { return o.promInter != null; }).sort(function (a, b) { return b.promInter - a.promInter; })[0];
    return '<div class="hp2r-grupo"><h3>' + U.ico(ico, 15) + txt(titulo) + '</h3><ul>' + l.map(function (o, k) {
      return '<li class="' + (k === 0 && l.length > 1 ? 'hp2r-grupo__mejor' : '') + '"><span class="hp2r-grupo__n">' + txt(o.n) + '<small>' + o.videos + ' video' + (o.videos === 1 ? '' : 's') + '</small></span>' +
        '<span class="hp2r-grupo__barra"><i style="width:' + Math.max(4, Math.round(o.promVistas / max * 100)) + '%"></i></span>' +
        '<span class="hp2r-grupo__v"><b>' + num(o.promVistas) + '</b><small>vistas prom.</small></span>' +
        '<span class="hp2r-grupo__v' + (mejorInter && mejorInter === o && l.length > 1 ? ' hp2r-grupo__v--top' : '') + '"><b>' + pct(o.promInter) + '</b><small>interacción</small></span></li>';
    }).join('') + '</ul></div>';
  }
  /** Lo que Hompy saca en limpio (solo comparaciones con al menos 2 grupos). */
  function conclusiones(l, gObj, gDur, gFor) {
    var c = [];
    if (gObj.length > 1 && gObj[gObj.length - 1].promVistas > 0) {
      var r = gObj[0].promVistas / gObj[gObj.length - 1].promVistas;
      c.push('Los videos para «' + gObj[0].n + '» promedian ' + num(gObj[0].promVistas) + ' vistas' + (r >= 1.5 ? ', ' + r.toFixed(1).replace('.', ',') + ' veces más que los de «' + gObj[gObj.length - 1].n + '».' : '.'));
    }
    var dI = gDur.filter(function (o) { return o.promInter != null; }).sort(function (a, b) { return b.promInter - a.promInter; });
    if (dI.length > 1) c.push('Los de ' + dI[0].n + ' son los que más interacción generan (' + pct(dI[0].promInter) + ').');
    if (gFor.length > 1) c.push('El formato que más se ve: «' + gFor[0].n + '».');
    var crec = l.filter(function (x) { return x.m.crec != null; }).sort(function (a, b) { return b.m.crec - a.m.crec; })[0];
    if (crec && crec.m.crec > 50) c.push('«' + crec.i.titulo + '» siguió creciendo: ' + (crec.m.crec >= 0 ? '+' : '') + crec.m.crec + ' % de vistas entre las 24 h y los 7 días.');
    var mejor = l.slice().sort(function (a, b) { return b.m.vistas - a.m.vistas; })[0];
    if (mejor && mejor.i.idea.gancho) c.push('El gancho del video más visto: «' + mejor.i.idea.gancho + '». ¡Inspírense en él!');
    return c;
  }

  function vista() {
    var pubs = publicados(), l = conMetricas(), sinMet = pubs.filter(function (i) { return metricas(i).vistas == null; });
    var cab = H().cabecera('Resultados TikTok', 'Qué videos funcionan y por qué, con las métricas que anotan en cada video publicado.',
      U.boton({ texto: 'Estudio', icono: 'camara', variante: 'fantasma', clase: 'js-hp2-ir', datos: { ir: 'estudio' } }));
    if (!l.length) {
      H().pagina(cab + U.card({ cuerpo: '<div class="hp2-todo-listo hp2-todo-listo--grande"><img src="assets/hompy/hompy-cara.webp" alt="" width="84" height="84"><p><b>Todavía no hay métricas.</b> ' +
        (pubs.length ? 'Hay ' + pubs.length + ' video' + (pubs.length === 1 ? '' : 's') + ' publicado' + (pubs.length === 1 ? '' : 's') + ': anoten sus vistas a las 24 horas y aquí verán qué les funciona.' : 'Cuando publiquen el primer video y anoten sus vistas, aquí verán qué tipo de video les funciona.') + '</p></div>' +
        listaSinMetricas(sinMet) }));
      return;
    }
    var totalV = l.reduce(function (a, x) { return a + x.m.vistas; }, 0);
    var inters = l.filter(function (x) { return x.m.inter != null; });
    var promI = inters.length ? inters.reduce(function (a, x) { return a + x.m.inter; }, 0) / inters.length : null;
    var mejor = l.slice().sort(function (a, b) { return b.m.vistas - a.m.vistas; })[0];
    var kpis = '<div class="sx2-fila-kpis hp2-kpis">' +
      U.kpi({ etiqueta: 'Videos con métricas', valor: l.length, icono: 'camara', i: 1 }) +
      U.kpi({ etiqueta: 'Vistas en total', valor: num(totalV), icono: 'ojo', i: 2 }) +
      U.kpi({ etiqueta: 'Interacción promedio', valor: promI == null ? '—' : pct(promI), icono: 'corazon', i: 3 }) +
      U.kpi({ etiqueta: 'El más visto', valor: num(mejor.m.vistas), unidad: 'vistas', icono: 'estrella', i: 4, titulo: mejor.i.titulo }) +
    '</div>';

    var gObj = grupos(l, function (i) { return i.idea.objetivo; }, function (k) { return OBJ[k] || k; });
    var gFor = grupos(l, function (i) { return i.idea.formato; }, function (k) { return k; });
    var gDur = grupos(l, function (i) { return i.idea.duracion; }, function (k) { return k + ' segundos'; });
    var c = conclusiones(l, gObj, gDur, gFor);
    var hompy = c.length ? '<section class="hp2r-hompy sx2-card sx2-entra" style="--i:5"><img src="assets/hompy/hompy-cara.webp" alt="" width="56" height="56"><div><b>Lo que yo saco en limpio</b><ul>' +
      c.map(function (x) { return '<li>' + txt(x) + '</li>'; }).join('') + '</ul>' + (l.length < 6 ? '<small>Con pocos videos esto es una pista, no una regla: mientras más publiquen, mejor la lectura.</small>' : '') + '</div></section>' : '';

    var ordenados = l.slice().sort(function (a, b) {
      if (orden_ === 'inter') return (b.m.inter || 0) - (a.m.inter || 0);
      if (orden_ === 'recientes') return (a.i.publicacion.fecha || '') < (b.i.publicacion.fecha || '') ? 1 : -1;
      return b.m.vistas - a.m.vistas;
    });
    var maxV = Math.max.apply(null, l.map(function (x) { return x.m.vistas; })) || 1;
    var filas = ordenados.map(function (x, k) {
      var i = x.i, m = x.m, med = orden_ !== 'recientes' && k < 3 ? ['🥇', '🥈', '🥉'][k] : (k + 1);
      return '<tr class="sx2-entra" style="--i:' + Math.min(k, 12) + '"><td class="hp2r-pos">' + med + '</td>' +
        '<td><button type="button" class="hp2r-video js-hp2r-abrir" data-id="' + txt(i.idea_id) + '"><b>' + txt(i.titulo) + '</b><small>' +
          [OBJ[i.idea.objetivo], i.idea.formato, i.idea.duracion ? i.idea.duracion + ' s' : '', i.publicacion.fecha ? H().fechaCorta(i.publicacion.fecha) : ''].filter(Boolean).map(txt).join(' · ') + '</small>' +
          '<span class="hp2r-video__barra"><i style="width:' + Math.round(m.vistas / maxV * 100) + '%"></i></span></button></td>' +
        '<td class="hp2-num" data-et="Vistas 24 h">' + num(m.v24) + '</td><td class="hp2-num" data-et="Vistas 7 días">' + num(m.v7) + '</td>' +
        '<td class="hp2-num" data-et="Crecimiento">' + (m.crec == null ? '—' : (m.crec >= 0 ? '+' : '') + m.crec + ' %') + '</td><td class="hp2-num" data-et="Interacción"><b>' + pct(m.inter) + '</b></td>' +
        '<td class="hp2-acc">' + (i.publicacion.url ? '<a class="sx2-boton sx2-boton--fantasma sx2-boton--sm sx2-boton--icono" href="' + txt(i.publicacion.url) + '" target="_blank" rel="noopener" title="Ver en TikTok" aria-label="Ver en TikTok">' + U.ico('enlace', 14) + '</a>' : '') + '</td></tr>';
    }).join('');
    var ranking = U.card({ titulo: 'Ranking de videos', icono: 'tendencia', i: 6, cuerpo:
      '<div class="hp2r-orden">' + U.segmento([{ id: 'vistas', texto: 'Más vistos', icono: 'ojo' }, { id: 'inter', texto: 'Más interacción', icono: 'corazon' }, { id: 'recientes', texto: 'Recientes', icono: 'calendario' }], orden_, 'js-hp2r-orden') + '</div>' +
      '<div class="hp2-tabla-cont"><table class="hp2-tabla hp2r-tabla"><thead><tr><th></th><th>Video</th><th class="hp2-num">Vistas 24 h</th><th class="hp2-num">Vistas 7 días</th><th class="hp2-num">Crecimiento</th><th class="hp2-num">Interacción</th><th></th></tr></thead><tbody>' + filas + '</tbody></table></div>' });
    var funciona = U.card({ titulo: '¿Qué nos funciona?', icono: 'bombilla', i: 7, cuerpo:
      bloqueGrupo('Por objetivo', 'estrella', gObj) + bloqueGrupo('Por formato', 'camara', gFor) + bloqueGrupo('Por duración', 'reloj', gDur) });

    H().pagina(cab + kpis + hompy + ranking + '<div class="sx2-grid hp2-dos"><div class="sx2-col-7">' + funciona + '</div><div class="sx2-col-5">' +
      U.card({ titulo: 'Les faltan métricas', icono: 'info', i: 8, cuerpo: listaSinMetricas(sinMet) || '<p class="sx2-tenue">Todos los videos publicados tienen sus métricas. ¡Bien!</p>' }) + '</div></div>');
  }
  function listaSinMetricas(l) {
    if (!l.length) return '';
    return '<ul class="hp2r-faltan">' + l.map(function (i) {
      return '<li><span>' + txt(i.titulo) + (i.publicacion.fecha ? '<small>Publicado ' + txt(H().cuando(i.publicacion.fecha).toLowerCase()) + '</small>' : '') + '</span>' +
        U.boton({ texto: 'Anotar métricas', icono: 'editar', sm: true, clase: 'js-hp2r-abrir', datos: { id: i.idea_id } }) + '</li>';
    }).join('') + '</ul>';
  }

  /** Para el ayudante: una frase sobre los resultados (o nada si no hay métricas). */
  function frase() {
    var l = conMetricas();
    if (!l.length) return null;
    var mejor = l.slice().sort(function (a, b) { return b.m.vistas - a.m.vistas; })[0];
    return { t: 'Mi video más visto es «' + mejor.i.titulo.slice(0, 40) + '» con ' + num(mejor.m.vistas) + ' vistas. ¿Vemos qué nos funciona?', acc: { texto: 'Ver resultados', ir: ['resultados'] } };
  }

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('button');
    var r = window.SigsoHompy && H().raiz();
    if (!b || !r || !r.contains(b)) return;
    if (b.classList.contains('js-hp2r-abrir')) H().ir('idea', b.getAttribute('data-id'));
    else if (b.classList.contains('js-hp2r-orden')) { orden_ = b.getAttribute('data-id'); vista(); }
  });

  window.SigsoHompyResultados = { vista: vista, frase: frase };
})();
