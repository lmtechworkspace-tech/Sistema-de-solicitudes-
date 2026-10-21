/**
 * finanzas-pendientes-v2.js — Finanzas › Trabajo diario › Pendientes
 * (corrección v2, I08.6, 2026-10-20; backend/logica/finanzasPendientes.js).
 *
 * Una sola lista con lo que falta resolver en otras pantallas: movimientos del
 * banco sin clasificar, posibles duplicados, registros por completar,
 * operaciones sin su banco, cobros sin aplicar, fondos sin gestión y saldos
 * iniciales por aprobar. No guarda nada propio: cada fila abre su origen y,
 * desde ahí, «Volver a Pendientes» regresa al mismo filtro y a la fila
 * siguiente.
 */
(function () {
  'use strict';

  var U = UIv2;
  var x_ = null;
  var est_ = { tipo: '', datos: null, ultimo: '' };
  // I12.2/I12.4: al cerrarse la bóveda, la pantalla olvida las cifras que tenía cargadas.
  document.addEventListener('sigso-fin-cerrada', function () { est_.datos = null; });
  var PESO = '$', MENOS = '−';
  var TONO = { MOVIMIENTO: 'critico', DUPLICADO: 'critico', DATOS: 'alerta', SIN_BANCO: 'alerta', COBRO: 'info', FONDOS: 'info', APERTURA: 'info' };

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function plata(n) { var v = Math.round(Number(n) || 0); return (v < 0 ? MENOS : '') + PESO + Math.abs(v).toLocaleString('es-CL'); }
  function corta(iso) { return iso ? String(iso).slice(8, 10) + '-' + String(iso).slice(5, 7) + '-' + String(iso).slice(2, 4) : '—'; }

  function ver(x) {
    x_ = x; enlazar();
    var t = x.turno();
    x.pagina(x.cab('pendientes') + U.esqueleto('tabla', 8));
    x.api('finanzasPendientes', { tipo: est_.tipo }).then(function (r) {
      if (!x.vigente(t)) return;
      // Un error de carga no se muestra como «no hay pendientes».
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('pendientes') + U.card({ cuerpo: U.vacio({ accion: '<button type="button" class="sx2-boton sx2-boton--secundario sx2-boton--sm js-fin-reintentar">Reintentar</button>', icono: 'alerta', titulo: 'No se pudieron cargar los pendientes', texto: (r && r.message) || '' }) })); return; }
      est_.datos = r.data;
      pintar();
    });
  }

  function pintar() {
    var d = est_.datos;
    var total = Object.keys(d.por_tipo).reduce(function (a, k) { return a + d.por_tipo[k]; }, 0);
    var chips = [{ id: '', texto: 'Todos', n: total }].concat(d.tipos.filter(function (t) { return d.por_tipo[t.id]; }).map(function (t) { return { id: t.id, texto: t.nombre, n: d.por_tipo[t.id] }; }));
    var filas = d.items.map(function (it) {
      return '<tr class="fin2-pend' + (it.id === est_.ultimo ? ' fin2-pend--ultimo' : '') + '" data-id="' + txt(it.id) + '">' +
        '<td>' + U.badge(it.tipo_nombre, TONO[it.tipo] || 'neutro') + (it.bloquea_cierre ? '<span class="fin2-motivo">impide cerrar el mes</span>' : '') + '</td>' +
        '<td><b>' + txt(it.cliente || it.empresa || '—') + '</b>' + (it.cliente && it.empresa ? '<span class="fin2-motivo">' + txt(it.empresa) + '</span>' : '') + '</td>' +
        '<td class="fin2-pend__motivo">' + txt(it.motivo) + '</td>' +
        '<td class="fin2-num">' + corta(it.fecha) + (it.antiguedad_dias != null ? '<span class="fin2-motivo">hace ' + it.antiguedad_dias + ' d</span>' : '') + '</td>' +
        '<td class="fin2-num fin2-der">' + (it.importe ? plata(it.importe) : '—') + '</td>' +
        '<td class="fin2-acc">' + U.boton({ texto: it.accion.texto, sm: true, clase: 'js-fpe-abrir', datos: { id: it.id } }) + '</td></tr>';
    }).join('');
    x_.pagina(x_.cab('pendientes') +
      (d.fuentes_con_error.length ? '<div class="fin2-cinta fin2-cinta--alerta">' + U.ico('alerta', 16) + '<span>No se pudo leer una parte (' + txt(d.fuentes_con_error.join(', ')) + '): la lista puede estar incompleta.</span></div>' : '') +
      '<div class="fin2-fila-filtros"><div class="fin2-filtros">' + chips.map(function (c) {
        return U.chip({ texto: c.texto, n: c.n, activo: c.id === est_.tipo, clase: 'js-fpe-tipo', datos: { id: c.id } });
      }).join('') + '</div></div>' +
      '<p class="fin2-ayuda fin2-alcance">' + txt(d.orden) + ' Corte ' + corta(d.corte) + '.' + (d.truncado ? ' Se muestran 500 de ' + d.total + '.' : '') + '</p>' +
      U.card({ sinRelleno: true, cuerpo: d.items.length
        ? '<div class="fin2-tabla-envoltura"><table class="fin2-tabla fin2-pend-tabla"><thead><tr><th>Qué es</th><th>Cliente o empresa</th><th>Motivo</th><th>Fecha</th><th class="fin2-der">Importe</th><th></th></tr></thead><tbody>' + filas + '</tbody></table></div>'
        : U.vacio({ icono: 'check', titulo: est_.tipo ? 'Nada de este tipo' : 'No hay pendientes', texto: est_.tipo ? 'Elige «Todos» para ver el resto.' : 'Todo lo registrado y lo del banco está resuelto.' }) }));
    var ult = x_.raiz().querySelector('.fin2-pend--ultimo .js-fpe-abrir');
    if (ult) { ult.scrollIntoView({ block: 'center' }); ult.focus(); }
  }

  /** Abre el origen con su contexto y deja dicho cómo volver. */
  function abrir(id) {
    var it = est_.datos.items.filter(function (i) { return i.id === id; })[0];
    if (!it) return;
    // Al volver, el foco queda en la fila siguiente (la resuelta ya no estará).
    var idx = est_.datos.items.indexOf(it), sig = est_.datos.items[idx + 1];
    est_.ultimo = sig ? sig.id : '';
    var c = it.accion.contexto || {}, v = it.accion.vista, cambios = { volver_a: 'pendientes' };
    if (c.periodo) cambios.periodo = c.periodo;
    if (v === 'registro') cambios.filtro_registro = 'incompletas';
    if (v === 'cobranza' && c.cliente_id) cambios.cliente_cobranza = c.cliente_id;
    if (v === 'fondos' && c.cliente_id) cambios.cliente_fondos = c.cliente_id;
    if (v === 'movimientos' && window.SigsoFinanzasBancos) SigsoFinanzasBancos.periodo(c.periodo || '');
    x_.ir(v, cambios);
  }

  var enlazado_ = false;
  function enlazar() {
    var raiz = x_.raiz();
    if (enlazado_ || !raiz) return;
    enlazado_ = true;
    raiz.addEventListener('click', function (ev) {
      if (!document.querySelector('.fin2-pend-tabla, .js-fpe-tipo')) return;
      var b = ev.target.closest('button');
      if (!b) return;
      if (b.classList.contains('js-fpe-tipo')) { est_.tipo = b.dataset.id; est_.ultimo = ''; ver(x_); }
      else if (b.classList.contains('js-fpe-abrir')) abrir(b.dataset.id);
    });
  }

  window.SigsoFinanzasPendientes = { ver: ver };
})();
