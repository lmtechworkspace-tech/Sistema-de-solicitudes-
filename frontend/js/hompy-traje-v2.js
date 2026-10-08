/**
 * hompy-traje-v2.js — antes de salir y el traje de Hompy (2026-10-08;
 * backend/logica/hompy.js: guardarPreparacion, registrarTraje, traje_).
 *
 *  - «Antes de salir»: cada actividad tiene su lista de lo que hay que revisar
 *    (parte con la lista base del servidor y la ajustan). Se marca en el
 *    detalle de la actividad y la portada muestra lo de los próximos 2 días.
 *  - El traje: su estado vigente (lo último entre lo anotado a mano y el
 *    «¿cómo quedó el traje?» de cada reporte cerrado), su historial y los
 *    turnos: quién lo ha usado y cuántos minutos, para rotarlo parejo.
 *
 * Usa lo que comparte el módulo principal (SigsoHompy._interno).
 */
(function () {
  'use strict';

  var U = UIv2;
  function H() { return window.SigsoHompy._interno; }
  function D() { return H().datos(); }
  function txt(v) { return H().txt(v); }
  var EST = {
    BUENO: { t: 'En buen estado', tono: 'ok', ico: 'check', sub: 'Listo para salir.' },
    LIMPIEZA: { t: 'Necesita limpieza', tono: 'alerta', ico: 'info', sub: 'Conviene limpiarlo antes de la próxima salida.' },
    REPARACION: { t: 'Necesita reparación', tono: 'critico', ico: 'alerta', sub: 'Mejor no salir con él hasta repararlo.' }
  };
  var DIAS_ANTES = 2;

  // --- Antes de salir -------------------------------------------------------------------------
  function itemsDe(e) {
    return e.preparacion ? e.preparacion.items : (D().catalogos.preparacion || []).map(function (t) { return { t: t, hecho: false }; });
  }
  function avance(e) { var l = itemsDe(e); return { hechos: l.filter(function (i) { return i.hecho; }).length, total: l.length }; }
  function porPreparar() {
    var d = D(), hasta = H().sumarDias(d.hoy, DIAS_ANTES);
    return H().proximas().filter(function (e) { return e.fecha <= hasta; });
  }
  function barra(a) {
    var pct = a.total ? Math.round(a.hechos / a.total * 100) : 0;
    return '<span class="hp2p-barra' + (pct === 100 ? ' hp2p-barra--lista' : '') + '"><i style="width:' + pct + '%"></i></span>';
  }
  function itemHtml(i, k) {
    return '<li class="hp2p-item"><label><input type="checkbox" class="js-hp2p-item" data-i="' + k + '"' + (i.hecho ? ' checked' : '') + '><span class="hp2p-caja">' + U.ico('check', 12) + '</span>' +
      '<span class="hp2p-item__t">' + txt(i.t) + '</span></label>' +
      '<button type="button" class="hp2p-item__x js-hp2p-quitar" data-i="' + k + '" aria-label="Quitar «' + txt(i.t) + '»">' + U.ico('equis', 12) + '</button></li>';
  }
  /** La sección «Antes de salir» del detalle de una actividad (vacía si ya pasó o se canceló). */
  function bloqueEvento(e) {
    if (e.estado === 'CANCELADO' || e.fecha < D().hoy) return '';
    var l = itemsDe(e), a = avance(e), tr = D().traje || { estado: 'BUENO' };
    return '<section class="hp2p js-hp2p" data-id="' + txt(e.evento_id) + '">' +
      '<header class="hp2p__cab"><h3>' + U.ico('portapapeles', 15) + 'Antes de salir</h3><span class="hp2p__n js-hp2p-n">' + a.hechos + ' de ' + a.total + '</span></header>' +
      '<span class="js-hp2p-barra">' + barra(a) + '</span>' +
      (tr.estado !== 'BUENO' ? '<p class="hp2-nota hp2-nota--alerta">' + U.ico('alerta', 14) + 'El traje está marcado «' + txt(EST[tr.estado].t.toLowerCase()) + '»' + (tr.nota ? ': ' + txt(tr.nota) : '') + '.</p>' : '') +
      '<ul class="hp2p-lista js-hp2p-lista">' + l.map(itemHtml).join('') + '</ul>' +
      '<input class="sx2-input hp2p-nuevo js-hp2p-nuevo" maxlength="80" placeholder="+ Agregar algo a revisar (Enter)" aria-label="Agregar algo a revisar">' +
      '<p class="hp2p__estado js-hp2p-estado" aria-live="polite"></p>' +
    '</section>';
  }
  function leerItems(sec) {
    return Array.prototype.map.call(sec.querySelectorAll('.hp2p-item'), function (li) {
      return { t: li.querySelector('.hp2p-item__t').textContent, hecho: li.querySelector('input').checked };
    });
  }
  function reindexar(sec) {
    sec.querySelectorAll('.hp2p-item').forEach(function (li, k) { li.querySelector('input').setAttribute('data-i', k); li.querySelector('.js-hp2p-quitar').setAttribute('data-i', k); });
  }
  function guardar(sec) {
    var id = sec.getAttribute('data-id'), items = leerItems(sec), estado = sec.querySelector('.js-hp2p-estado');
    var a = { hechos: items.filter(function (i) { return i.hecho; }).length, total: items.length };
    sec.querySelector('.js-hp2p-n').textContent = a.hechos + ' de ' + a.total;
    sec.querySelector('.js-hp2p-barra').innerHTML = barra(a);
    estado.textContent = 'Guardando…';
    return H().api('hompyGuardarPreparacion', { evento_id: id, items: items }).then(function (r) {
      if (!r || !r.ok) { estado.textContent = (r && r.message) || 'No se pudo guardar.'; estado.classList.add('hp2p__estado--error'); return; }
      estado.classList.remove('hp2p__estado--error');
      estado.textContent = a.total && a.hechos === a.total ? '¡Todo listo para salir!' : 'Guardado';
      var evs = D().eventos, ix = evs.findIndex(function (x) { return x.evento_id === id; });
      if (ix !== -1) evs[ix] = r.data.evento;
      if (a.total && a.hechos === a.total) H().chispas(sec);
      // La tarjeta de la portada (si está a la vista) se pone al día sin repintar la página.
      var tp = document.querySelector('.js-hp2p-portada');
      if (tp) tp.outerHTML = tarjetaPortada();
    });
  }

  function tarjetaPortada() {
    var lista = porPreparar(), tr = D().traje || { estado: 'BUENO' }, est = EST[tr.estado] || EST.BUENO;
    var traje = '<button type="button" class="hp2p-traje sx2-tono-' + est.tono + ' js-hp2-ir" data-ir="traje">' +
      '<span class="hp2p-traje__ico">' + U.ico('casco', 18) + '</span><span><b>Traje: ' + txt(est.t.toLowerCase()) + '</b><small>' + txt(tr.nota || est.sub) + '</small></span>' + U.ico('derecha', 14) + '</button>';
    var filas = lista.map(function (e) {
      var a = avance(e);
      return '<li><button type="button" class="hp2p-fila js-hp2-evento" data-id="' + txt(e.evento_id) + '">' +
        '<span class="hp2p-fila__t"><b>' + txt(e.titulo) + '</b><small>' + txt(H().cuando(e.fecha)) + (e.hora_inicio ? ' · ' + txt(e.hora_inicio) : '') + '</small></span>' +
        '<span class="hp2p-fila__av">' + barra(a) + '<small>' + a.hechos + '/' + a.total + '</small></span></button></li>';
    }).join('');
    return '<section class="hp2p-portada sx2-card sx2-entra js-hp2p-portada" style="--i:6">' +
      '<header class="hp2p-portada__cab"><h2>' + U.ico('portapapeles', 17) + 'Antes de salir</h2><small>Próximos ' + DIAS_ANTES + ' días</small></header>' + traje +
      (filas ? '<ul class="hp2p-portada__lista">' + filas + '</ul>' : '<p class="sx2-tenue hp2p-portada__vacio">Nada que preparar en los próximos ' + DIAS_ANTES + ' días.</p>') +
    '</section>';
  }

  /** Lo que Hompy cuenta en la portada sobre el traje y lo que falta preparar. */
  function frases() {
    var f = [], tr = D().traje || { estado: 'BUENO' };
    if (tr.estado !== 'BUENO') f.push({ t: tr.estado === 'REPARACION' ? 'Mi traje necesita reparación' + (tr.nota ? ': ' + tr.nota.slice(0, 60) : '') + '. ¡No me saquen así!' : 'Mi traje necesita limpieza' + (tr.nota ? ' (' + tr.nota.slice(0, 50) + ')' : '') + '. ¿Me lo lavan?', acc: { texto: 'Ver el traje', ir: ['traje'] } });
    porPreparar().some(function (e) {
      var a = avance(e);
      if (a.hechos === a.total) return false;
      f.push({ t: 'Para «' + e.titulo.slice(0, 40) + '» (' + H().cuando(e.fecha).toLowerCase() + ') faltan ' + (a.total - a.hechos) + ' cosas por preparar.', acc: { texto: 'Preparar', fn: function () { H().abrirEvento(e.evento_id); } } });
      return true;
    });
    return f;
  }
  /** Aviso en el formulario de una actividad nueva si el traje no está bien. */
  function avisoFormulario() {
    var tr = D().traje || { estado: 'BUENO' };
    if (tr.estado === 'BUENO') return '';
    return '<p class="hp2-nota ' + (tr.estado === 'REPARACION' ? 'hp2-nota--alerta' : 'hp2-nota--neutro') + '">' + U.ico(tr.estado === 'REPARACION' ? 'alerta' : 'info', 14) +
      'El traje está marcado «' + txt(EST[tr.estado].t.toLowerCase()) + '»' + (tr.nota ? ': ' + txt(tr.nota) : '') + '. Se puede agendar igual; recuerden tenerlo listo antes.</p>';
  }

  // --- El traje (vista) -----------------------------------------------------------------------
  /** Quién ha usado el traje: usos, minutos y pausas, desde los reportes de salida. */
  function turnos() {
    var d = D(), por = {}, desde60 = H().sumarDias(d.hoy, -60);
    (d.salidas || []).forEach(function (s) {
      var quien = String(s.datos.traje || '').trim(), e = H().evento(s.evento_id);
      if (!quien || !e) return;
      var k = quien.toLowerCase(), p = por[k] = por[k] || { nombre: quien, usos: 0, minutos: 0, conMinutos: 0, pausas: 0, ultimo: '', min60: 0, calor: 0 };
      p.usos++;
      if (s.datos.minutos_traje != null) { p.minutos += s.datos.minutos_traje; p.conMinutos++; if (e.fecha >= desde60) p.min60 += s.datos.minutos_traje; }
      p.pausas += s.datos.pausas || 0;
      if (s.datos.minutos_traje > 40 && !s.datos.pausas) p.calor++;
      if (e.fecha > p.ultimo) p.ultimo = e.fecha;
    });
    return Object.keys(por).map(function (k) { return por[k]; }).sort(function (a, b) { return a.ultimo < b.ultimo ? 1 : -1; });
  }
  function leToca(l) {
    if (l.length < 2) return null;
    return l.slice().sort(function (a, b) { return (a.min60 - b.min60) || (a.ultimo < b.ultimo ? -1 : 1); })[0];
  }
  function vista() {
    var tr = D().traje || { estado: 'BUENO', historial: [] }, est = EST[tr.estado] || EST.BUENO;
    var origen = tr.fuente === 'SALIDA' ? 'Según el reporte de «' + tr.titulo + '»' : tr.fuente === 'MANUAL' ? 'Anotado a mano' : 'Sin registros todavía';
    var estado = '<section class="hp2t-estado sx2-card sx2-entra sx2-tono-' + est.tono + '">' +
      '<span class="hp2t-estado__ico">' + U.ico('casco', 30) + '</span>' +
      '<div class="hp2t-estado__txt"><span class="hp2t-estado__et">Estado del traje</span><h2>' + txt(est.t) + '</h2>' +
        '<p>' + txt(tr.nota || est.sub) + '</p><small>' + txt(origen) + (tr.fecha ? ' · ' + txt(H().horaDe(tr.fecha)) : '') + '</small></div>' +
      '<div class="hp2t-estado__acc">' +
        (tr.estado !== 'BUENO' ? U.boton({ texto: tr.estado === 'REPARACION' ? 'Ya está reparado' : 'Ya está limpio', icono: 'check', variante: 'primario', clase: 'js-hp2t-marcar hp2-boton-hompy', datos: { e: 'BUENO' } }) : '') +
        (tr.estado !== 'LIMPIEZA' ? U.boton({ texto: 'Necesita limpieza', icono: 'info', sm: true, clase: 'js-hp2t-marcar', datos: { e: 'LIMPIEZA' } }) : '') +
        (tr.estado !== 'REPARACION' ? U.boton({ texto: 'Necesita reparación', icono: 'alerta', sm: true, variante: 'fantasma', clase: 'js-hp2t-marcar', datos: { e: 'REPARACION' } }) : '') +
      '</div></section>';

    var l = turnos(), toca = leToca(l), calor = l.reduce(function (a, p) { return a + p.calor; }, 0);
    var tabla = l.length ? '<div class="hp2-tabla-cont"><table class="hp2-tabla hp2t-turnos"><thead><tr><th>Quién</th><th class="hp2-num">Salidas</th><th class="hp2-num">Minutos</th><th class="hp2-num">Promedio</th><th class="hp2-num">Pausas</th><th>Última vez</th></tr></thead><tbody>' +
      l.map(function (p) {
        var prom = p.conMinutos ? Math.round(p.minutos / p.conMinutos) : null;
        return '<tr><td><span class="hp2-persona">' + U.avatar({ nombre: p.nombre }, 'xs') + txt(p.nombre) + '</span>' + (p.calor ? ' ' + U.badge(p.calor + ' sin pausas', 'alerta') : '') + '</td>' +
          '<td class="hp2-num" data-et="Salidas">' + p.usos + '</td><td class="hp2-num" data-et="Minutos">' + p.minutos + '</td><td class="hp2-num" data-et="Promedio">' + (prom == null ? '—' : prom + ' min') + '</td><td class="hp2-num" data-et="Pausas">' + p.pausas + '</td>' +
          '<td data-et="Última vez">' + txt(H().cuando(p.ultimo)) + '</td></tr>';
      }).join('') + '</tbody></table></div>'
      : U.vacio({ icono: 'equipo', titulo: 'Todavía nadie ha usado el traje', texto: 'Cuando llenen el primer reporte de salida («¿Quién usó el traje?») aparecerá aquí.' });
    var cardTurnos = U.card({ titulo: 'Turnos del traje', icono: 'equipo', i: 2, cuerpo:
      (toca ? '<div class="hp2t-toca"><img src="assets/hompy/hompy-cara.webp" alt="" width="44" height="44"><p>Para repartir el calor, la próxima vez le toca a <b>' + txt(toca.nombre) + '</b>: es quien menos minutos lleva en los últimos 60 días.</p></div>' : '') +
      (calor ? '<p class="hp2-nota hp2-nota--alerta">' + U.ico('alerta', 14) + calor + (calor === 1 ? ' salida' : ' salidas') + ' con más de 40 minutos en el traje y sin pausas. Adentro hace calor: programen pausas.</p>' : '') + tabla });

    var hist = (tr.historial || []).map(function (h, i) {
      var x = EST[h.estado] || EST.BUENO;
      return '<li class="hp2t-hist__item sx2-entra" style="--i:' + Math.min(i, 10) + '"><span class="hp2t-hist__punto sx2-tono-' + x.tono + '">' + U.ico(x.ico, 12) + '</span><div>' +
        '<b>' + txt(x.t) + '</b> <small>' + txt(H().horaDe(h.fecha)) + '</small>' +
        '<p>' + (h.fuente === 'SALIDA' ? 'Reporte de «' + txt(h.titulo) + '»' + (h.usado_por ? ' · lo usó ' + txt(h.usado_por) : '') : 'Anotado por ' + txt(H().nombreDe(h.por))) + '</p>' +
        (h.nota ? '<p class="hp2t-hist__nota">' + txt(h.nota) + '</p>' : '') + '</div></li>';
    }).join('');
    var cardHist = U.card({ titulo: 'Historial', icono: 'reloj', i: 3, cuerpo: hist ? '<ol class="hp2t-hist">' + hist + '</ol>' : '<p class="sx2-tenue">Sin cambios registrados.</p>' });

    H().pagina(H().cabecera('El traje de Hompy', 'Su estado, quién lo ha usado y cuánto rato. Cuidar el traje es cuidar a quien va adentro.') +
      estado + '<div class="sx2-grid hp2-dos"><div class="sx2-col-7">' + cardTurnos + '</div><div class="sx2-col-5">' + cardHist + '</div></div>');
  }
  function marcar(estado) {
    var x = EST[estado];
    U.formulario({
      titulo: estado === 'BUENO' ? 'El traje está listo' : 'El traje ' + x.t.toLowerCase(), boton: 'Guardar',
      campos: U.campo(estado === 'BUENO' ? 'Nota (opcional)' : '¿Qué necesita?', '<textarea class="sx2-input hp2-area" name="nota" rows="3" maxlength="300"' + (estado === 'BUENO' ? '' : ' required') +
        ' placeholder="' + (estado === 'BUENO' ? 'Ej.: lavado en seco, quedó impecable' : 'Ej.: se soltó la costura del guante derecho') + '"></textarea>'),
      alMontar: function (form, d) { d.el.classList.add('hp2-drawer'); },
      enviar: function (datos) { return H().api('hompyRegistrarTraje', { estado: estado, nota: datos.nota }); },
      aviso: estado === 'BUENO' ? '¡Traje listo para salir!' : 'Anotado.',
      listo: function (r) { D().traje = r.data.traje; vista(); if (estado === 'BUENO') H().celebrar({ titulo: '¡Traje listo!', texto: 'Hompy ya puede volver a salir a terreno.' }); }
    });
  }

  // --- Eventos ----------------------------------------------------------------------------------
  document.addEventListener('change', function (ev) {
    var sec = ev.target.closest && ev.target.closest('.js-hp2p');
    if (sec && ev.target.classList.contains('js-hp2p-item')) guardar(sec);
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' || !ev.target.classList || !ev.target.classList.contains('js-hp2p-nuevo')) return;
    ev.preventDefault();
    var sec = ev.target.closest('.js-hp2p'), v = ev.target.value.trim();
    if (!v || sec.querySelectorAll('.hp2p-item').length >= 15) return;
    var ul = sec.querySelector('.js-hp2p-lista');
    ul.insertAdjacentHTML('beforeend', itemHtml({ t: v.slice(0, 80), hecho: false }, ul.children.length));
    ev.target.value = '';
    guardar(sec);
  });
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('button');
    if (!b) return;
    if (b.classList.contains('js-hp2p-quitar')) {
      var sec = b.closest('.js-hp2p');
      if (sec.querySelectorAll('.hp2p-item').length <= 1) { H().aviso('La lista necesita al menos una cosa por revisar.'); return; }
      b.closest('.hp2p-item').remove(); reindexar(sec); guardar(sec);
    } else if (b.classList.contains('js-hp2t-marcar')) marcar(b.getAttribute('data-e'));
  });

  window.SigsoHompyTraje = { vista: vista, bloqueEvento: bloqueEvento, tarjetaPortada: tarjetaPortada, frases: frases, avisoFormulario: avisoFormulario };
})();
