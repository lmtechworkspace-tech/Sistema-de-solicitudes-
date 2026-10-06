/**
 * rrhh-informes-v2.js — los dos informes internos de RR.HH. que arma SIGSO
 * (revisión del módulo con el área, 2026-10-05; backend/logica/rrhhInformes.js):
 *
 *  - inf:iusc         Impuesto único para Contabilidad, desde Remuneraciones,
 *                     cruzado con el Informe y pago de IVA del mismo mes.
 *  - inf:plataformas  Plataformas externas para Facturación y Cobranzas.
 *
 * Los ven RR.HH. y el área que recibe cada uno. Vistas `inf:*` (las elige
 * control-interno-v2.js).
 */
(function () {
  'use strict';

  var U = UIv2;
  var est_ = { iusc: { periodo: '', datos: null }, plataformas: { periodo: '', datos: null } };
  var turno_ = 0;
  var CRUCE = { IGUAL: ['Igual', 'ok'], DISTINTO: ['Distinto', 'alerta'], VACIO: ['Vacío en IVA', 'info'], SIN_FILA: ['Sin fila de IVA', 'neutro'] };

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function plata(v) { return '$ ' + Math.round(Number(v) || 0).toLocaleString('es-CL'); }
  function entero(v) { return Math.round(Number(v) || 0).toLocaleString('es-CL'); }

  function mostrar(tipo, x) {
    if (tipo !== 'iusc' && tipo !== 'plataformas') tipo = 'iusc';
    enlazar(x);
    var s = est_[tipo];
    if (!s.periodo) s.periodo = x.mover(x.periodoActual(), -1);
    cargar(tipo, x);
  }
  function titulo(tipo, x) {
    if (tipo === 'iusc') return x.opc.depto === 'RRHH' ? 'Impuesto único para Contabilidad' : 'Impuesto único de RR.HH.';
    return x.opc.depto === 'RRHH' ? 'Plataformas para Facturación' : 'Plataformas de RR.HH. (cobro)';
  }
  function cargar(tipo, x) {
    var s = est_[tipo], t = ++turno_;
    x.pagina(x.cabecera(x.modNombre, titulo(tipo, x), 'Cargando…', selector(tipo, x)) + U.esqueleto('tarjetas', 4));
    x.api(tipo === 'iusc' ? 'rrhhImpuestoUnico' : 'rrhhPlataformas', { periodo: s.periodo }).then(function (r) {
      if (t !== turno_) return;
      if (!r || !r.ok) {
        x.pagina(x.cabecera(x.modNombre, titulo(tipo, x), '', selector(tipo, x)) +
          U.card({ cuerpo: U.vacio({ icono: 'candado', titulo: 'No se pudo abrir el informe', texto: (r && r.message) || 'Inténtalo de nuevo.' }) }));
        return;
      }
      s.datos = r.data;
      if (tipo === 'iusc') pintarIusc(x); else pintarPlataformas(x);
    });
  }
  function selector(tipo, x) {
    var s = est_[tipo];
    return '<span class="ci2-periodo rh-inf" role="group" aria-label="Mes">' +
      U.boton({ soloIcono: true, icono: 'izquierda', variante: 'fantasma', sm: true, titulo: 'Mes anterior', clase: 'js-rhi-mes', datos: { n: -1, t: tipo } }) +
      '<strong>' + txt(x.perTexto(s.periodo, true).replace(' de ', ' ')) + '</strong>' +
      U.boton({ soloIcono: true, icono: 'derecha', variante: 'fantasma', sm: true, titulo: 'Mes siguiente', clase: 'js-rhi-mes', datos: { n: 1, t: tipo } }) + '</span>';
  }
  function acciones(tipo, x, hay) {
    return selector(tipo, x) + U.boton({ texto: 'Excel', icono: 'descargar', clase: 'js-rhi-excel', datos: { t: tipo }, deshabilitado: !hay });
  }

  // --- Impuesto único ---------------------------------------------------------------------------
  function pintarIusc(x) {
    var D = est_.iusc.datos, T = D.totales;
    // El 3 % de préstamo solidario casi ya no se usa: solo se muestra si el mes lo tiene.
    var tres = T.tres > 0;
    var kp = '<div class="sx2-fila-kpis rh-inf">' +
      U.kpi({ etiqueta: 'Clientes con sueldos', valor: T.clientes, icono: 'empresa', i: 1 }) +
      U.kpi({ etiqueta: 'Impuesto único', valor: plata(T.iusc), icono: 'dinero', i: 2 }) +
      (tres ? U.kpi({ etiqueta: '3 % préstamo solidario', valor: plata(T.tres), icono: 'dinero', i: 3 }) : '') +
      U.kpi({ etiqueta: 'Liquidaciones completas', valor: T.completos + ' de ' + T.clientes, icono: 'check', tono: T.clientes && T.completos === T.clientes ? 'ok' : 'alerta', i: 4,
        titulo: 'Clientes con todas sus obras con liquidación enviada: el informe del 13 es el definitivo cuando están todas.' }) +
      U.kpi({ etiqueta: 'Distinto a lo de Contabilidad', valor: T.distintos, icono: 'alerta', tono: T.distintos ? 'alerta' : 'ok', i: 5,
        titulo: 'Clientes cuyo impuesto único no coincide con el del Informe y pago de IVA (o que en IVA está vacío).' }) + '</div>';
    var tabla = D.filas.length ? '<div class="sx2-tabla-wrap"><table class="sx2-tabla rh-tabla"><thead><tr><th>Cliente</th><th class="sx2-num">Obras</th><th class="sx2-num">Trabajadores</th>' +
      '<th class="sx2-num">Impuesto único</th>' + (tres ? '<th class="sx2-num">3 % préstamo</th>' : '') + '<th>Liquidaciones</th><th>Información</th><th class="sx2-num">En IVA (Contabilidad)</th><th>Cruce</th></tr></thead><tbody>' +
      D.filas.map(function (f) {
        var c = CRUCE[f.cruce] || [f.cruce, 'neutro'];
        return '<tr><td>' + txt(f.cliente) + '</td><td class="sx2-num">' + f.obras + '</td><td class="sx2-num">' + entero(f.trabajadores) + '</td>' +
          '<td class="sx2-num"><b>' + plata(f.iusc) + '</b></td>' + (tres ? '<td class="sx2-num">' + plata(f.tres) + '</td>' : '') +
          '<td>' + (f.completo ? U.badge('Todas enviadas', 'ok') : U.badge(f.liquidaciones_enviadas + ' de ' + f.obras_registradas, 'alerta')) + '</td>' +
          '<td class="sx2-num">' + (f.ultima_recepcion ? txt(x.fechaCorta(f.ultima_recepcion)) : '—') + '</td>' +
          '<td class="sx2-num">' + (f.iva_contabilidad === null || f.iva_contabilidad === '' ? '—' : plata(f.iva_contabilidad)) + '</td>' +
          '<td>' + U.badge(c[0], c[1]) + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><th>Total</th><th></th><th class="sx2-num">' + entero(T.trabajadores) + '</th><th class="sx2-num">' + plata(T.iusc) + '</th>' + (tres ? '<th class="sx2-num">' + plata(T.tres) + '</th>' : '') + '<th colspan="4"></th></tr></tfoot></table></div>'
      : U.vacio({ icono: 'bandeja', titulo: 'Sin remuneraciones de ' + x.perTexto(D.periodo, true), texto: 'Todavía no hay filas de Remuneraciones para los sueldos de este mes.' });
    var faltan = D.sin_informacion.length ? U.card({ i: 3, titulo: 'Todavía sin información de este mes', sub: D.sin_informacion.length + (D.sin_informacion.length === 1 ? ' cliente' : ' clientes'),
      cuerpo: '<p class="sx2-tenue rh-nota">Tuvieron sueldos el mes anterior y aún no envían los de ' + txt(x.perTexto(D.periodo, true)) + ': su impuesto único no está en el informe.</p>' +
        '<p class="rh-lista">' + D.sin_informacion.map(txt).join(' · ') + '</p>' }) : '';
    x.pagina(x.cabecera(x.modNombre, titulo('iusc', x), 'Sueldos de ' + x.perTexto(D.periodo, true) + '. El 5-7 se envía un primer informe y el 13 el definitivo.', acciones('iusc', x, D.filas.length)) +
      kp + U.card({ i: 2, cuerpo: '<p class="sx2-tenue rh-nota">' + txt(D.definicion) + ' «Cruce» compara con el impuesto único que Contabilidad anotó en el Informe y pago de IVA del mismo mes.</p>' + tabla }) + faltan);
  }

  // --- Plataformas externas ---------------------------------------------------------------------
  function pintarPlataformas(x) {
    var D = est_.plataformas.datos, T = D.totales;
    var kp = '<div class="sx2-fila-kpis rh-inf">' +
      U.kpi({ etiqueta: 'Clientes', valor: T.clientes, icono: 'empresa', i: 1 }) +
      U.kpi({ etiqueta: 'Plataformas', valor: T.plataformas, icono: 'tabla', i: 2 }) +
      U.kpi({ etiqueta: 'Trabajadores para el cobro', valor: T.cobro, icono: 'equipo', tono: 'primario', i: 3 }) +
      U.kpi({ etiqueta: 'Finiquitados del mes', valor: T.finiquitados, icono: 'persona', i: 4 }) +
      U.kpi({ etiqueta: 'Subidas registradas', valor: T.subidas, icono: 'subir', i: 5 }) + '</div>';
    var tabla = D.filas.length ? '<div class="sx2-tabla-wrap"><table class="sx2-tabla rh-tabla"><thead><tr><th>Cliente</th><th>Plataforma</th><th>Empresa principal</th><th>Obras</th>' +
      '<th class="sx2-num">Para el cobro</th><th class="sx2-num">Trabajadores del mes</th><th class="sx2-num">Finiquitados</th><th class="sx2-num">Subidas</th><th class="sx2-num">Última subida</th></tr></thead><tbody>' +
      D.filas.map(function (f) {
        return '<tr><td>' + txt(f.cliente) + '</td><td>' + txt(f.plataforma) + '</td><td>' + txt(f.empresa_principal || '—') + '</td>' +
          '<td class="rh-obras">' + (f.obras.length ? txt(f.obras.join(', ')) : '—') + '</td>' +
          '<td class="sx2-num"><b>' + entero(f.cobro) + '</b></td><td class="sx2-num">' + entero(f.trabajadores_mes) + '</td><td class="sx2-num">' + entero(f.finiquitados) + '</td>' +
          '<td class="sx2-num">' + f.subidas + '</td><td class="sx2-num">' + (f.ultima_subida ? txt(x.fechaCorta(f.ultima_subida)) : '—') + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><th colspan="4">Total</th><th class="sx2-num">' + entero(T.cobro) + '</th><th></th><th class="sx2-num">' + entero(T.finiquitados) + '</th><th class="sx2-num">' + T.subidas + '</th><th></th></tr></tfoot></table></div>'
      : U.vacio({ icono: 'bandeja', titulo: 'Sin subidas en ' + x.perTexto(D.periodo, true), texto: 'La matriz Plataformas externas no tiene filas de este mes.' });
    x.pagina(x.cabecera(x.modNombre, titulo('plataformas', x), 'Subidas de ' + x.perTexto(D.periodo, true) + '. Se envía a Facturación y Cobranzas en los primeros 5 días del mes siguiente.', acciones('plataformas', x, D.filas.length)) +
      kp + U.card({ i: 2, cuerpo: '<p class="sx2-tenue rh-nota">' + txt(D.definicion) + '</p>' + tabla }));
  }

  // --- Excel ------------------------------------------------------------------------------------
  function excel(tipo, x, b) {
    var D = est_[tipo].datos;
    if (!D || !window.SigsoReportes) return;
    var archivo = 'sigso-' + (tipo === 'iusc' ? 'impuesto-unico' : 'plataformas') + '-' + D.periodo.replace('-M', '-');
    if (tipo === 'iusc') {
      SigsoReportes.descargarExcelDeDatos({ titulo: 'Impuesto único · ' + D.periodo_texto, subtitulo: 'Recursos Humanos → Contabilidad', nombreArchivo: archivo,
        meta: [['Sueldos de', D.periodo_texto], ['Clientes', String(D.totales.clientes)], ['Impuesto único', plata(D.totales.iusc)], ['3 % préstamo solidario', plata(D.totales.tres)], ['Distintos a IVA', String(D.totales.distintos)]],
        hojas: [
          { nombre: 'Por cliente', columnas: ['Cliente', 'Obras', 'Trabajadores', 'Impuesto único', '3 % préstamo solidario', 'Valor imposiciones', 'Liquidaciones enviadas', 'Obras registradas', 'Última información', 'En IVA (Contabilidad)', 'Cruce'],
            filas: D.filas.map(function (f) { return [f.cliente, f.obras, f.trabajadores, f.iusc, f.tres, f.imposiciones, f.liquidaciones_enviadas, f.obras_registradas, f.ultima_recepcion, f.iva_contabilidad === null ? '' : f.iva_contabilidad, (CRUCE[f.cruce] || [f.cruce])[0]]; }) },
          { nombre: 'Sin información', columnas: ['Cliente'], filas: D.sin_informacion.map(function (c) { return [c]; }) }
        ] }, { boton: b });
    } else {
      SigsoReportes.descargarExcelDeDatos({ titulo: 'Plataformas externas · ' + D.periodo_texto, subtitulo: 'Recursos Humanos → Facturación y Cobranzas', nombreArchivo: archivo,
        meta: [['Mes', D.periodo_texto], ['Clientes', String(D.totales.clientes)], ['Trabajadores para el cobro', String(D.totales.cobro)], ['Finiquitados', String(D.totales.finiquitados)]],
        hojas: [{ nombre: 'Por cliente y plataforma', columnas: ['Cliente', 'Plataforma', 'Empresa principal', 'Obras', 'Para el cobro', 'Trabajadores del mes', 'Finiquitados', 'Subidas', 'Última subida'],
          filas: D.filas.map(function (f) { return [f.cliente, f.plataforma, f.empresa_principal, f.obras.join(', '), f.cobro, f.trabajadores_mes, f.finiquitados, f.subidas, f.ultima_subida]; }) }] }, { boton: b });
    }
  }

  // --- Eventos (delegados en la raíz del módulo) ------------------------------------------------
  function enlazar(x) {
    var c = x.raiz();
    if (!c) return;
    c.__rhInfX = x;
    if (c.__rhInf) return;
    c.__rhInf = true;
    c.addEventListener('click', function (ev) {
      var b, y = c.__rhInfX;
      if (!c.querySelector('.rh-inf')) return;
      if ((b = ev.target.closest('.js-rhi-mes'))) {
        var t = b.getAttribute('data-t');
        est_[t].periodo = y.mover(est_[t].periodo, Number(b.getAttribute('data-n')));
        cargar(t, y);
        return;
      }
      if ((b = ev.target.closest('.js-rhi-excel'))) excel(b.getAttribute('data-t'), y, b);
    });
  }

  window.SigsoRRHHInformes = { mostrar: mostrar };
})();
