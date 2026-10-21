/**
 * finanzas-plan-v2.js — Planificación de Finanzas (2026-10-20; FIN-25 a
 * FIN-30; backend/logica/finanzasPlanificacion.js).
 *
 *  - Gastos compartidos: reparto en partes iguales, por porcentaje o montos
 *    fijos, con vista previa EXACTA (los pesos del redondeo tienen dueño).
 *    Al vincularlo con su pago, el gasto se cuenta una vez, ya repartido.
 *  - Préstamos entre empresas: saldo = monto − devoluciones; cada pierna se
 *    cuenta una vez aunque aparezca en las dos cuentas.
 *  - Proyectos: inversión prevista, real y recuperación con su fórmula.
 *  - Provisiones (vacaciones, años de servicio): no mueven caja; el método
 *    lo escribe quien la calcula.
 *  - Compromisos y proyección: escenario con supuestos a la vista; lo
 *    estimado nunca se muestra como deuda confirmada.
 */
(function () {
  'use strict';

  var U = UIv2;
  var x_ = null, cat_ = null;
  // I12.2/I12.4: al cerrarse la bóveda, la pantalla olvida las cifras que tenía cargadas.
  document.addEventListener('sigso-fin-cerrada', function () { cat_ = null; });

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function plata(n) { if (n === null || n === undefined) return '—'; var v = Math.round(Number(n) || 0); return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('es-CL'); }
  function opciones(l, actual, vacio) { return (vacio !== undefined ? '<option value="">' + txt(vacio) + '</option>' : '') + l.map(function (o) { var id = Array.isArray(o) ? o[0] : o, n = Array.isArray(o) ? o[1] : o; return '<option value="' + txt(id) + '"' + (String(id) === String(actual) ? ' selected' : '') + '>' + txt(n) + '</option>'; }).join(''); }
  function hoyIso() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
  function error(vista, r) { if (r && !r.boveda_cerrada) x_.pagina(x_.cab(vista) + U.card({ cuerpo: U.vacio({ accion: '<button type="button" class="sx2-boton sx2-boton--secundario sx2-boton--sm js-fin-reintentar">Reintentar</button>', icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || '' }) })); }
  /** Carga común: catálogo + la acción de la vista. */
  function cargar(x, vista, accion, datos, pintar) {
    x_ = x;
    var t = x.turno();
    x.pagina(x.cab(vista) + U.esqueleto('tabla', 8));
    return Promise.all([x.catalogo(), x.api(accion, datos || {})]).then(function (rs) {
      if (!x.vigente(t)) return;
      cat_ = rs[0];
      if (!rs[1] || !rs[1].ok) { error(vista, rs[1]); return; }
      pintar(rs[1].data);
    });
  }
  function enlazarPagina(fn) {
    var raiz = x_.raiz();
    var h = function (ev) { var b = ev.target.closest('button'); if (b && raiz.contains(b) && /(^| )js-fp-/.test(b.className)) fn(b, ev); };
    if (raiz._finPlan) raiz.removeEventListener('click', raiz._finPlan);
    raiz._finPlan = h;
    raiz.addEventListener('click', h);
  }

  // ================================================================ gastos compartidos
  function verGastos(x) {
    var periodo = x.contexto().periodo || hoyIso().slice(0, 7);
    cargar(x, 'gastos', 'finanzasGastosCompartidos', { periodo: periodo }, function (d) {
      x_.pagina(x_.cab('gastos', U.boton({ texto: 'Nuevo gasto compartido', icono: 'nueva', sm: true, variante: 'primario', clase: 'js-fp-gasto', datos: { cap: 'PLANIFICAR' } })) + '<div class="fin2-plan">' +
        '<div class="fin2-ctx"><label class="fin2-campo fin2-campo--fila"><span>Mes</span><input type="month" class="fin2-input fin2-input--sm js-fp-mes" value="' + txt(periodo) + '"></label>' +
          '<span class="fin2-ayuda">Un gasto que paga una empresa y se reparte. Al vincularlo con su pago real, cada empresa ve solo su parte.</span></div>' +
        U.card({ sinRelleno: true, cuerpo: d.gastos.length ? '<div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>Concepto</th><th>Paga</th><th class="fin2-der">Monto</th><th>Reparto</th><th>Estado</th><th></th></tr></thead><tbody>' + d.gastos.map(function (g) {
          return '<tr><td><b>' + txt(g.concepto) + '</b>' + (g.obs ? '<br><small class="fin2-ayuda">' + txt(g.obs) + '</small>' : '') + (g.paz && g.paz.pendiente ? '<br>' + U.badge('Columna PAZ: por decidir', 'alerta') : '') + '</td><td>' + txt(g.pagadora) + '</td><td class="fin2-der fin2-num">' + plata(g.monto) + '</td>' +
            '<td>' + g.partes.map(function (p) { return txt(p.empresa) + ' ' + plata(p.monto); }).join('<br>') + '</td><td>' + (g.estado === 'VINCULADO' ? U.badge('Vinculado al pago', 'ok') : U.badge('Sin pago vinculado', 'alerta')) + '</td>' +
            '<td class="fin2-acciones-min" data-cap="PLANIFICAR">' + (g.estado !== 'VINCULADO' ? U.boton({ texto: 'Vincular pago', sm: true, clase: 'js-fp-vincular', datos: { id: g.id } }) + U.boton({ texto: 'Editar', sm: true, variante: 'fantasma', clase: 'js-fp-gasto', datos: { id: g.id } }) : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : U.vacio({ icono: 'empresa', titulo: 'Sin gastos compartidos este mes', texto: 'Arriendo, contador, internet… lo que paga una empresa por todas.' }) }) + '</div>');
      var raiz = x_.raiz();
      raiz.querySelector('.js-fp-mes').addEventListener('change', function (ev) { if (/^\d{4}-\d{2}$/.test(ev.target.value)) { x_.contexto({ periodo: ev.target.value }); verGastos(x_); } });
      enlazarPagina(function (b) {
        if (b.classList.contains('js-fp-gasto')) formGasto(d.gastos.filter(function (g) { return g.id === b.dataset.id; })[0], periodo);
        else if (b.classList.contains('js-fp-vincular')) vincularGasto(d.gastos.filter(function (g) { return g.id === b.dataset.id; })[0]);
      });
    });
  }
  function filaReparto(p, modo) {
    return '<div class="fin2-rep-fila"><select class="sx2-input js-fp-rep-emp">' + opciones(cat_.empresas || [], p.empresa, 'Empresa…') + '</select>' +
      (modo === 'IGUALES' ? '' : '<input class="sx2-input js-fp-rep-val" placeholder="' + (modo === 'PORCENTAJE' ? '%' : '$') + '" value="' + txt(p.valor === undefined ? '' : p.valor) + '">') +
      '<button type="button" class="sx2-boton sx2-boton--fantasma sx2-boton--sm sx2-boton--icono js-fp-rep-quitar" title="Quitar" aria-label="Quitar">' + U.ico('equis', 14) + '</button></div>';
  }
  function formGasto(g, periodo) {
    g = g || {};
    var rep = g.reparto || { modo: 'IGUALES', partes: [] };
    var d = U.formulario({ titulo: g.id ? 'Editar gasto compartido' : 'Nuevo gasto compartido', boton: 'Guardar', ancho: true,
      campos: '<div class="fin2-form-grid">' + U.campo('Concepto', '<input name="concepto" class="sx2-input" required value="' + txt(g.concepto || '') + '">') +
        U.campo('Mes', '<input type="month" name="periodo" class="sx2-input" required value="' + txt(g.periodo || periodo) + '">') +
        U.campo('Empresa que paga', '<select name="pagadora" class="sx2-input" required>' + opciones(cat_.empresas || [], g.pagadora, 'Elige…') + '</select>') +
        U.campo('Monto total', '<input name="monto" class="sx2-input js-fp-monto" required inputmode="numeric" value="' + txt(g.monto || '') + '">') +
        U.campo('Regla guardada (opcional)', '<select class="sx2-input js-fp-regla">' + opciones((cat_.repartos || []).map(function (r) { return [r.id, r.nombre]; }), '', 'Elegir a mano') + '</select>') +
        U.campo('Cómo se reparte', '<select class="sx2-input js-fp-modo">' + opciones([['IGUALES', 'Partes iguales'], ['PORCENTAJE', 'Por porcentaje'], ['FIJO', 'Montos fijos']], rep.modo) + '</select>') + '</div>' +
        '<div class="js-fp-rep">' + (rep.partes.length ? rep.partes : [{}, {}]).map(function (p) { return filaReparto(p, rep.modo); }).join('') + '</div>' +
        '<button type="button" class="sx2-enlace js-fp-rep-mas">+ Agregar empresa</button>' +
        '<div class="fin2-p-caja fin2-p-caja--info js-fp-previa" aria-live="polite">' + U.ico('info', 14) + '<span>Completa el monto y las empresas para ver cuánto le toca a cada una.</span></div>' +
        U.campo('Observación', '<input name="obs" class="sx2-input" value="' + txt(g.obs || '') + '">'),
      preparar: function (v, form) { return Object.assign(v, { id: g.id, expected_version: g.version, reparto: leerReparto(form) }); },
      enviar: function (v) { return x_.api('finanzasGuardarGastoCompartido', v); }, aviso: 'Gasto guardado.', listo: function () { verGastos(x_); } });
    var el = d.el, t = null;
    var previa = function () {
      clearTimeout(t);
      t = setTimeout(function () {
        var rr = leerReparto(el), m = el.querySelector('.js-fp-monto').value;
        if (!m || rr.partes.length < 2) return;
        x_.api('finanzasPrevisualizarReparto', { monto: m, reparto: rr }).then(function (r) {
          var c = el.querySelector('.js-fp-previa'); if (!c) return;
          c.innerHTML = r && r.ok ? U.ico('check', 14) + '<span>' + r.data.partes.map(function (p) { return '<b>' + txt(p.empresa) + '</b> ' + plata(p.monto); }).join(' · ') + ' = ' + plata(r.data.suma) + '<br><small>' + txt(r.data.criterio) + '</small></span>'
            : U.ico('alerta', 14) + '<span>' + txt((r && r.message) || 'Revisa el reparto.') + '</span>';
        });
      }, 300);
    };
    el.addEventListener('input', previa);
    el.addEventListener('change', function (ev) {
      if (ev.target.classList.contains('js-fp-modo')) { var p = leerReparto(el).partes; el.querySelector('.js-fp-rep').innerHTML = (p.length ? p : [{}, {}]).map(function (q) { return filaReparto(q, ev.target.value); }).join(''); }
      if (ev.target.classList.contains('js-fp-regla')) {
        var r = (cat_.repartos || []).filter(function (y) { return y.id === ev.target.value; })[0];
        if (r) { el.querySelector('.js-fp-modo').value = r.modo; el.querySelector('.js-fp-rep').innerHTML = r.partes.map(function (q) { return filaReparto(q, r.modo); }).join(''); }
      }
      previa();
    });
    el.addEventListener('click', function (ev) {
      if (ev.target.closest('.js-fp-rep-mas')) { el.querySelector('.js-fp-rep').insertAdjacentHTML('beforeend', filaReparto({}, el.querySelector('.js-fp-modo').value)); }
      var q = ev.target.closest('.js-fp-rep-quitar'); if (q) { q.closest('.fin2-rep-fila').remove(); previa(); }
    });
    previa();
  }
  function leerReparto(el) {
    var modo = el.querySelector('.js-fp-modo').value;
    return { modo: modo, partes: Array.prototype.map.call(el.querySelectorAll('.fin2-rep-fila'), function (f) { var v = f.querySelector('.js-fp-rep-val'); return { empresa: f.querySelector('.js-fp-rep-emp').value, valor: v ? v.value : undefined }; }).filter(function (p) { return p.empresa; }) };
  }
  function vincularGasto(g) {
    x_.api('finanzasReporteDetalle', { periodo: g.periodo, empresa: g.pagadora, metric: 'egresos' }).then(function (r) {
      var l = r && r.ok ? r.data.hechos.filter(function (h) { return h.monto_total === g.monto && h.empresa === g.pagadora && !h.gasto_compartido_id; }) : [];
      U.formulario({ titulo: 'Vincular «' + g.concepto + '» con su pago', boton: 'Vincular',
        campos: l.length ? '<p class="fin2-ayuda">Pagos confirmados de ' + txt(g.pagadora) + ' en ' + txt(g.periodo) + ' por ' + plata(g.monto) + ':</p>' + l.map(function (h, i) {
          return '<label class="fin2-exp__tipo"><input type="radio" name="ref" value="' + txt(h.ref) + '"' + (i === 0 ? ' checked' : '') + '><span><b>' + txt(h.fecha) + ' · ' + plata(h.monto_total) + '</b><small>' + txt(h.glosa) + ' · ' + txt(h.concepto) + ' · ' + txt(h.cuenta) + '</small></span></label>';
        }).join('') + '<p class="fin2-ayuda">El reparto pasa al pago: desde ahí cada empresa cuenta solo su parte.</p>'
          : '<p class="fin2-ayuda">No hay un pago confirmado de ' + txt(g.pagadora) + ' por exactamente ' + plata(g.monto) + ' en ' + txt(g.periodo) + '. Confirma primero el pago en Bancos o en el Registro.</p>',
        preparar: function (v) { return v.ref ? { id: g.id, ref: v.ref } : 'Elige el pago.'; },
        enviar: function (v) { return x_.api('finanzasVincularGasto', v); }, aviso: 'Gasto vinculado: ya cuenta repartido.', listo: function () { verGastos(x_); } });
    });
  }

  // ================================================================ préstamos
  function verPrestamos(x) {
    cargar(x, 'prestamos', 'finanzasPrestamos', {}, function (d) {
      x_.pagina(x_.cab('prestamos', U.boton({ texto: 'Nuevo préstamo', icono: 'nueva', sm: true, variante: 'primario', clase: 'js-fp-prest', datos: { cap: 'PLANIFICAR' } })) + '<div class="fin2-plan">' +
        // I10.2: deuda reconocida (con desembolso vinculado) y lo planificado sin desembolso, aparte.
        '<div class="sx2-fila-kpis">' + U.kpi({ etiqueta: 'Saldo reconocido entre empresas', valor: plata(d.total_reconocido), icono: 'empresa', tono: 'info', i: 0 }) +
          U.kpi({ etiqueta: 'Planificado sin desembolso vinculado', valor: plata(d.total_sin_desembolso), icono: 'reloj', tono: 'neutro', i: 1 }) + '</div>' +
        U.card({ sinRelleno: true, cuerpo: d.prestamos.length ? '<div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>Presta → recibe</th><th>Fecha</th><th class="fin2-der">Planificado</th><th class="fin2-der">Desembolsado</th><th class="fin2-der">Devuelto</th><th class="fin2-der">Saldo reconocido</th><th>Evidencia</th><th></th></tr></thead><tbody>' + d.prestamos.map(function (p) {
          var EST = { SIN_DESEMBOLSO: ['Sin desembolso', 'neutro'], DESEMBOLSADO: ['Desembolsado', 'info'], DEVUELTO_EN_PARTE: ['Devuelto en parte', 'info'], DEVUELTO: ['Devuelto', 'ok'], ANULADO: ['Anulado', 'neutro'] }[p.estado_real] || ['—', 'neutro'];
          var ev = p.evidencias || [];
          // El estado va bajo las empresas: así no queda tapado por la columna de acciones en pantallas medianas.
          return '<tr><td><b>' + txt(p.origen) + '</b> → <b>' + txt(p.destino) + '</b>' + (p.concepto ? '<br><small class="fin2-ayuda">' + txt(p.concepto) + '</small>' : '') + '<br>' + U.badge(EST[0], EST[1]) + (p.estado === 'PAGADO' && p.estado_real !== 'DEVUELTO' ? '<span class="fin2-motivo">marcado pagado en la ficha</span>' : '') + '</td><td class="fin2-num">' + txt(p.fecha || '—') + '</td><td class="fin2-der fin2-num">' + plata(p.planificado) + '</td>' +
            '<td class="fin2-der fin2-num">' + (p.desembolsado ? plata(p.desembolsado) + (p.diferencia_banco ? '<span class="fin2-motivo">difiere ' + plata(p.diferencia_banco) + ' de lo planificado</span>' : '') : '—') + '</td><td class="fin2-der fin2-num">' + plata(p.devuelto) + '</td>' +
            '<td class="fin2-der fin2-num"><b>' + (p.saldo_reconocido === null ? '—' : plata(p.saldo_reconocido)) + '</b></td>' +
            '<td>' + (ev.length ? ev.map(function (e) { return txt(e.fuente + ' · ' + (e.rol === 'DEVOLUCION' ? 'devolución' : 'desembolso') + ' · ' + e.empresa); }).join('<br>') : '<span class="fin2-ayuda" title="Que no haya un movimiento vinculado no significa que el préstamo no exista: vincúlalo cuando lo encuentres.">Ninguna vinculada</span>') + '</td>' +
            '<td class="fin2-acciones-min" data-cap="PLANIFICAR">' + U.boton({ texto: 'Vincular', sm: true, clase: 'js-fp-pvinc', datos: { id: p.id }, titulo: 'Vincular un movimiento (desembolso o devolución)' }) + U.boton({ texto: 'Editar', sm: true, variante: 'fantasma', clase: 'js-fp-prest', datos: { id: p.id } }) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : U.vacio({ icono: 'empresa', titulo: 'Sin préstamos registrados', texto: 'Lo que una empresa del grupo le presta a otra, con sus devoluciones.' }) }) + '</div>');
      enlazarPagina(function (b) {
        var p = d.prestamos.filter(function (y) { return y.id === b.dataset.id; })[0];
        if (b.classList.contains('js-fp-prest')) formPrestamo(p);
        else if (b.classList.contains('js-fp-pvinc')) vincularPrestamo(p);
      });
    });
  }
  function formPrestamo(p) {
    p = p || {};
    U.formulario({ titulo: p.id ? 'Editar préstamo' : 'Nuevo préstamo', boton: 'Guardar', ancho: true,
      campos: '<div class="fin2-form-grid">' + U.campo('Empresa que presta', '<select name="origen" class="sx2-input" required>' + opciones(cat_.empresas || [], p.origen, 'Elige…') + '</select>') +
        U.campo('Empresa que recibe', '<select name="destino" class="sx2-input" required>' + opciones(cat_.empresas || [], p.destino, 'Elige…') + '</select>') +
        U.campo('Monto', '<input name="monto" class="sx2-input" required inputmode="numeric" value="' + txt(p.monto || '') + '">') + U.campo('Fecha', '<input type="date" name="fecha" class="sx2-input" value="' + txt(p.fecha || '') + '">') +
        U.campo('Devolución prevista', '<input type="date" name="fecha_devolucion" class="sx2-input" value="' + txt(p.fecha_devolucion || '') + '">') +
        U.campo('Estado', '<select name="estado" class="sx2-input">' + opciones([['VIGENTE', 'Vigente'], ['PAGADO', 'Pagado'], ['ANULADO', 'Anulado']], p.estado || 'VIGENTE') + '</select>') +
        U.campo('Concepto', '<input name="concepto" class="sx2-input" value="' + txt(p.concepto || '') + '">') + U.campo('Observación', '<input name="obs" class="sx2-input" value="' + txt(p.obs || '') + '">') + '</div>',
      preparar: function (v) { return Object.assign(v, { id: p.id, expected_version: p.version }); },
      enviar: function (v) { return x_.api('finanzasGuardarPrestamo', v); }, aviso: 'Préstamo guardado.', listo: function () { verPrestamos(x_); } });
  }
  function vincularPrestamo(p) {
    var mes = (p.fecha || hoyIso()).slice(0, 7);
    var abrir = function (periodo) {
      x_.api('finanzasReporteDetalle', { periodo: periodo, metric: 'prestamos' }).then(function (r) {
        var l = r && r.ok ? r.data.hechos.filter(function (h) { return [p.origen, p.destino].indexOf(h.empresa) !== -1 && [p.origen, p.destino].indexOf(h.contraparte) !== -1; }) : [];
        U.formulario({ titulo: 'Vincular movimiento al préstamo', subtitulo: '<span class="fin2-ayuda">' + txt(p.origen) + ' → ' + txt(p.destino) + ' · ' + plata(p.monto) + '</span>', boton: 'Vincular', ancho: true,
          campos: U.campo('Mes de los movimientos', '<input type="month" class="sx2-input js-fp-pmes" value="' + txt(periodo) + '">') +
            (l.length ? l.map(function (h, i) {
              return '<label class="fin2-exp__tipo"><input type="radio" name="ref" value="' + txt(h.ref) + '"' + (i === 0 ? ' checked' : '') + '><span><b>' + txt(h.fecha) + ' · ' + txt(h.empresa) + ' · ' + (h.sentido === 'entra' ? 'entra ' : 'sale ') + plata(h.monto_total) + '</b><small>' + txt(h.glosa) + ' · ' + txt(h.cuenta) + (h.prestamo_id ? ' · ya vinculado' : '') + '</small></span></label>';
            }).join('') : '<p class="fin2-ayuda">No hay movimientos clasificados como préstamo entre estas empresas en ese mes.</p>') +
            U.campo('Es', '<select name="rol" class="sx2-input">' + opciones([['DESEMBOLSO', 'El desembolso (la plata que se presta)'], ['DEVOLUCION', 'Una devolución']], 'DESEMBOLSO') + '</select>', 'Si el mismo préstamo se ve en las dos cuentas, vincula ambas piernas: se cuenta una vez.'),
          preparar: function (v) { return v.ref ? { prestamo_id: p.id, ref: v.ref, rol: v.rol } : 'Elige el movimiento.'; },
          enviar: function (v) { return x_.api('finanzasVincularPrestamo', v); }, aviso: 'Movimiento vinculado.', listo: function () { verPrestamos(x_); },
          alMontar: function (form) { form.querySelector('.js-fp-pmes').addEventListener('change', function (ev) { if (/^\d{4}-\d{2}$/.test(ev.target.value)) abrir(ev.target.value); }); } });
      });
    };
    abrir(mes);
  }

  // ================================================================ proyectos
  function verProyectos(x) {
    cargar(x, 'proyectos', 'finanzasProyectos', {}, function (d) {
      x_.pagina(x_.cab('proyectos', U.boton({ texto: 'Proyecto de la planilla', icono: 'nueva', sm: true, clase: 'js-fp-proy', datos: { cap: 'PLANIFICAR' } })) + '<div class="fin2-plan">' +
        '<p class="fin2-ayuda">' + Object.keys(d.formulas).map(function (k) { return '<b>' + txt(k.replace(/_/g, ' ')) + ':</b> ' + txt(d.formulas[k]); }).join(' · ') + '. Para sumar un gasto o ingreso a un proyecto, elige el proyecto al clasificarlo.</p>' +
        U.card({ sinRelleno: true, cuerpo: d.proyectos.length ? '<div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>Proyecto</th><th>Fuente</th><th class="fin2-der">Inversión prevista</th><th class="fin2-der">Inversión real</th><th class="fin2-der">Ingresos atribuidos</th><th class="fin2-der">Recuperación</th><th>Clientes</th><th></th></tr></thead><tbody>' + d.proyectos.map(function (p) {
          return '<tr><td><b>' + txt((p.codigo ? p.codigo + ' · ' : '') + p.nombre) + '</b>' + (p.estado ? '<br><small class="fin2-ayuda">' + txt(p.estado) + '</small>' : '') + '</td><td>' + txt(p.fuente) + '</td><td class="fin2-der fin2-num">' + plata(p.inversion_prevista) + '</td>' +
            '<td class="fin2-der fin2-num">' + plata(p.inversion_real) + (p.avance_inversion_pct !== null ? '<br><small>' + String(p.avance_inversion_pct).replace('.', ',') + ' % de lo previsto</small>' : '') + '</td><td class="fin2-der fin2-num">' + plata(p.ingresos_atribuidos) + '</td>' +
            '<td class="fin2-der fin2-num">' + (p.recuperacion_pct === null ? '<span class="fin2-ayuda">sin base</span>' : String(p.recuperacion_pct).replace('.', ',') + ' %') + '</td><td>' + (p.clientes_asignados.length || '—') + '</td>' +
            '<td>' + (p.legado_id ? U.boton({ texto: 'Editar', sm: true, variante: 'fantasma', clase: 'js-fp-proy', datos: { id: p.legado_id, cap: 'PLANIFICAR' } }) : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : U.vacio({ icono: 'maletin', titulo: 'Sin proyectos', texto: 'Los proyectos del módulo Proyectos de SIGSO aparecen aquí; los de la planilla SIGECO se cargan desde Migración.' }) }) + '</div>');
      enlazarPagina(function (b) {
        if (!b.classList.contains('js-fp-proy')) return;
        var p = d.proyectos.filter(function (y) { return y.legado_id === b.dataset.id; })[0] || {};
        U.formulario({ titulo: p.legado_id ? 'Editar proyecto' : 'Proyecto de la planilla', boton: 'Guardar', ancho: true,
          campos: '<div class="fin2-form-grid">' + U.campo('ID', '<input name="codigo" class="sx2-input" required value="' + txt(p.codigo || '') + '">') + U.campo('Nombre', '<input name="nombre" class="sx2-input" required value="' + txt(p.nombre || '') + '">') +
            U.campo('Tipo', '<select name="tipo" class="sx2-input">' + opciones(((cat_.tipos_proyecto) || []).map(function (y) { return y.nombre; }), p.tipo, '—') + '</select>') + U.campo('Empresa', '<select name="empresa" class="sx2-input">' + opciones(cat_.empresas || [], p.empresa, '—') + '</select>') +
            U.campo('Inversión presupuestada', '<input name="inversion_presupuestada" class="sx2-input" value="' + txt(p.inversion_prevista === null || p.inversion_prevista === undefined ? '' : p.inversion_prevista) + '">') + U.campo('Inicio', '<input type="date" name="fecha_inicio" class="sx2-input" value="' + txt(p.fecha_inicio || '') + '">') +
            U.campo('Estado', '<input name="estado" class="sx2-input" value="' + txt(p.estado || '') + '">') +
            U.campo('Proyecto de SIGSO equivalente', '<select name="sigso_id" class="sx2-input">' + opciones((cat_.proyectos || []).map(function (y) { return [y.id, (y.codigo ? y.codigo + ' · ' : '') + y.nombre]; }), '', 'Ninguno') + '</select>', 'Si ya existe en SIGSO, se une a ese y no se duplica.') + '</div>',
          preparar: function (v) { return Object.assign(v, { id: p.legado_id, expected_version: p.legado_id ? p.legado_version : undefined }); },
          enviar: function (v) { return x_.api('finanzasGuardarProyecto', v); }, aviso: 'Proyecto guardado.', listo: function () { verProyectos(x_); } });
      });
    });
  }

  // ================================================================ provisiones
  function verProvisiones(x) {
    var anio = (x.contexto().periodo || hoyIso()).slice(0, 4);
    cargar(x, 'provisiones', 'finanzasProvisiones', { anio: anio }, function (d) {
      x_.pagina(x_.cab('provisiones', U.boton({ texto: 'Nueva provisión', icono: 'nueva', sm: true, variante: 'primario', clase: 'js-fp-prov', datos: { cap: 'PLANIFICAR' } })) + '<div class="fin2-plan">' +
        '<div class="fin2-cinta fin2-cinta--info">' + U.ico('info', 16) + '<span>' + txt(d.nota) + '</span></div>' +
        U.card({ sinRelleno: true, cuerpo: d.provisiones.length ? '<div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>Mes</th><th>Empresa</th><th>Concepto</th><th class="fin2-der">Monto</th><th>Método / fuente</th><th>Responsable</th><th>Estado</th><th></th></tr></thead><tbody>' + d.provisiones.map(function (p) {
          return '<tr><td class="fin2-num">' + txt(p.periodo) + '</td><td>' + txt(p.empresa) + '</td><td>' + txt(p.concepto) + '</td><td class="fin2-der fin2-num">' + plata(p.monto) + '</td><td>' + txt(p.metodo) + (p.fuente ? '<br><small class="fin2-ayuda">' + txt(p.fuente) + '</small>' : '') + '</td><td>' + txt(p.registrado_por || '—') + '</td>' +
            '<td>' + U.badge(p.estado === 'PAGADA' ? 'Pagada' : p.estado === 'APROBADA' ? 'Aprobada · ' + p.aprobado_por : 'Propuesta', p.estado === 'PROPUESTA' ? 'info' : 'ok') + '</td><td>' + U.boton({ texto: 'Editar', sm: true, variante: 'fantasma', clase: 'js-fp-prov', datos: { id: p.id, cap: 'PLANIFICAR' } }) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : U.vacio({ icono: 'calendario', titulo: 'Sin provisiones en ' + anio, texto: 'Vacaciones y años de servicio: monto y método los define quien corresponde.' }) }) + '</div>');
      enlazarPagina(function (b) {
        if (!b.classList.contains('js-fp-prov')) return;
        var p = d.provisiones.filter(function (y) { return y.id === b.dataset.id; })[0] || {};
        U.formulario({ titulo: p.id ? 'Editar provisión' : 'Nueva provisión', boton: 'Guardar', ancho: true,
          campos: '<div class="fin2-form-grid">' + U.campo('Mes', '<input type="month" name="periodo" class="sx2-input" required value="' + txt(p.periodo || hoyIso().slice(0, 7)) + '">') +
            U.campo('Empresa', '<select name="empresa" class="sx2-input" required>' + opciones(cat_.empresas || [], p.empresa, 'Elige…') + '</select>') +
            U.campo('Concepto', '<select name="concepto" class="sx2-input" required>' + opciones(d.conceptos, p.concepto, 'Elige…') + '</select>') + U.campo('Monto', '<input name="monto" class="sx2-input" required value="' + txt(p.monto === undefined ? '' : p.monto) + '">') +
            U.campo('Método de cálculo', '<input name="metodo" class="sx2-input" required value="' + txt(p.metodo || '') + '">', 'No se calcula solo: escribe cómo se obtuvo.') + U.campo('Fuente', '<input name="fuente" class="sx2-input" value="' + txt(p.fuente || '') + '">') +
            U.campo('Estado', '<select name="estado" class="sx2-input">' + opciones([['PROPUESTA', 'Propuesta'], ['APROBADA', 'Aprobada'], ['ANULADA', 'Anulada']], p.estado === 'PAGADA' ? 'APROBADA' : p.estado || 'PROPUESTA') + '</select>') +
            U.campo('Observación', '<input name="obs" class="sx2-input" value="' + txt(p.obs || '') + '">') + '</div>',
          preparar: function (v) { return Object.assign(v, { id: p.id, expected_version: p.version, pago_ref: p.pago_ref || '' }); },
          enviar: function (v) { return x_.api('finanzasGuardarProvision', v); }, aviso: 'Provisión guardada.', listo: function () { verProvisiones(x_); } });
      });
    });
  }

  // ================================================================ compromisos y proyección
  function verProyeccion(x) {
    var c = x.contexto();
    var pct = c.pct_cobranza || 100, meses = c.meses_proyeccion || 3;
    x_ = x;
    var t = x.turno();
    x.pagina(x.cab('proyeccion') + U.esqueleto('tabla', 8));
    Promise.all([x.catalogo(), x.api('finanzasProyeccion', { empresa: c.empresa || '', pct_cobranza: pct, meses: meses }), x.api('finanzasCompromisos')]).then(function (rs) {
      if (!x.vigente(t)) return;
      cat_ = rs[0];
      if (!rs[1] || !rs[1].ok) { error('proyeccion', rs[1]); return; }
      var d = rs[1].data, com = rs[2] && rs[2].ok ? rs[2].data.compromisos : [];
      x_.pagina(x_.cab('proyeccion', U.boton({ texto: 'Nuevo compromiso', icono: 'nueva', sm: true, variante: 'primario', clase: 'js-fp-com', datos: { cap: 'PLANIFICAR' } })) + '<div class="fin2-plan">' +
        '<div class="fin2-ctx"><label class="fin2-campo fin2-campo--fila"><span>Empresa</span><select class="fin2-input fin2-input--sm js-fp-pemp">' + opciones(cat_.empresas || [], d.empresa, 'Todas') + '</select></label>' +
          '<label class="fin2-campo fin2-campo--fila"><span>Meses</span><select class="fin2-input fin2-input--sm js-fp-pmeses">' + opciones([1, 2, 3, 6, 12], meses) + '</select></label>' +
          '<label class="fin2-campo fin2-campo--fila"><span>Cobranza esperada</span><select class="fin2-input fin2-input--sm js-fp-ppct">' + opciones([[100, '100 %'], [90, '90 %'], [75, '75 %'], [50, '50 %'], [0, '0 % (no contar)']], pct) + '</select></label></div>' +
        // I03.5: el punto de partida dice si es disponibilidad propia determinada o solo una referencia; la suficiencia, si se puede evaluar.
        '<div class="fin2-cinta fin2-cinta--' + (d.suficiencia && d.suficiencia.evaluable ? (d.suficiencia.alcanza ? 'ok' : 'critico') : 'alerta') + '">' + U.ico(d.suficiencia && d.suficiencia.evaluable && d.suficiencia.alcanza ? 'escudoCheck' : 'alerta', 16) + '<div><b>' + txt(d.suficiencia ? d.suficiencia.texto : '') + '</b><br><span class="fin2-ayuda">' + txt(d.advertencia) + '</span>' +
          (d.inicio && !d.inicio.determinada && d.inicio.razones.length ? '<ul class="fin2-razones">' + d.inicio.razones.map(function (r) { return '<li>' + txt(r.texto) + '</li>'; }).join('') + '</ul>' : '') + '</div></div>' +
        U.card({ titulo: 'Proyección', icono: 'tendencia', sub: (d.inicio && d.inicio.determinada ? 'parte de la disponibilidad propia ' : 'escenario parcial · parte de la referencia ') + (d.inicio && d.inicio.monto !== null ? plata(d.inicio.monto) : '—') + (d.corte ? ' al ' + d.corte : '') + ' · saldo bancario ' + (d.caja_inicial === null ? '—' : plata(d.caja_inicial)), sinRelleno: true, cuerpo: '<div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>Mes</th><th class="fin2-der">Cobranza</th><th class="fin2-der">Otras entradas</th><th class="fin2-der">Compromisos</th><th class="fin2-der">Estimado</th><th class="fin2-der">Saldo proyectado</th><th>Por determinar</th></tr></thead><tbody>' +
          d.serie.map(function (s) {
            return '<tr><td>' + txt(s.periodo) + '</td><td class="fin2-der fin2-num">' + plata(s.cobranza) + '</td><td class="fin2-der fin2-num">' + plata(s.compromisos_entrada) + '</td><td class="fin2-der fin2-num">' + plata(s.compromisos_salida) + '</td>' +
              '<td class="fin2-der fin2-num">' + plata(s.estimado_salida) + ' <small class="fin2-ayuda">≈</small></td><td class="fin2-der fin2-num"><b class="' + (s.saldo_proyectado < 0 ? 'fin2-neg' : '') + '">' + (s.saldo_proyectado === null ? '—' : plata(s.saldo_proyectado)) + '</b>' + (d.inicio && !d.inicio.determinada ? '<br><small class="fin2-ayuda">referencial</small>' : '') + '</td><td>' + (s.por_determinar.length ? U.badge(s.por_determinar.join(', '), 'neutro') : '—') + '</td></tr>' +
              (s.sustituciones.length || s.atrasados.length || s.facturas.length ? '<tr class="fin2-proy-det"><td></td><td colspan="6"><small class="fin2-ayuda">' +
                [s.facturas.length ? 'Cobranza: ' + s.facturas.slice(0, 5).map(function (f) { return f.cliente + (f.folio ? ' F' + f.folio : '') + ' ' + plata(f.esperado) + (f.vencida ? ' (vencida)' : ' vence ' + f.vence); }).join(' · ') + (s.facturas_total > 5 ? ' · y ' + (s.facturas_total - 5) + ' más' : '') : '',
                 s.sustituciones.map(function (x) { return x.obligacion + ': el compromiso de ' + plata(x.compromiso) + ' reemplaza la estimación' + (x.estimado !== null ? ' de ' + plata(x.estimado) : ''); }).join(' · '),
                 s.atrasados.length ? 'Atrasados (fecha pasada sin pagar): ' + s.atrasados.map(function (a) { return a.concepto + ' ' + plata(a.monto) + ' del ' + a.fecha; }).join(' · ') : ''].filter(Boolean).map(txt).join('<br>') + '</small></td></tr>' : '');
          }).join('') + '</tbody></table></div>' }) +
        U.card({ titulo: 'Supuestos', icono: 'libro', cuerpo: '<ul class="fin2-razones">' + d.supuestos.map(function (s) { return '<li>' + txt(s) + '</li>'; }).join('') + '</ul>' }) +
        U.card({ titulo: 'Compromisos', icono: 'calendario', sub: 'confirmados y estimados, aparte', sinRelleno: true, cuerpo: com.length ? '<div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>Fecha</th><th>Concepto</th><th>Empresa</th><th>Tipo</th><th class="fin2-der">Monto</th><th>Estado</th><th></th></tr></thead><tbody>' + com.map(function (k) {
          return '<tr><td class="fin2-num">' + txt(k.fecha) + (k.recurrencia === 'MENSUAL' ? '<br><small class="fin2-ayuda">mensual</small>' : '') + '</td><td>' + txt(k.concepto) + '</td><td>' + txt(k.empresa) + '</td><td>' + U.badge(k.tipo === 'CONFIRMADO' ? 'Confirmado' : 'Estimado', k.tipo === 'CONFIRMADO' ? 'info' : 'neutro') + ' ' + txt(k.sentido === 'ENTRADA' ? 'entra' : 'sale') + '</td>' +
            '<td class="fin2-der fin2-num">' + plata(k.monto) + '</td><td>' + txt(k.estado === 'PAGADO' ? 'Pagado' : 'Pendiente') + '</td><td>' + U.boton({ texto: 'Editar', sm: true, variante: 'fantasma', clase: 'js-fp-com', datos: { id: k.id, cap: 'PLANIFICAR' } }) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : U.vacio({ icono: 'calendario', texto: 'Sin compromisos registrados.' }) }) + '</div>');
      var raiz = x_.raiz();
      raiz.querySelector('.js-fp-pemp').addEventListener('change', function (ev) { x_.contexto({ empresa: ev.target.value }); verProyeccion(x_); });
      raiz.querySelector('.js-fp-pmeses').addEventListener('change', function (ev) { x_.contexto({ meses_proyeccion: Number(ev.target.value) }); verProyeccion(x_); });
      raiz.querySelector('.js-fp-ppct').addEventListener('change', function (ev) { x_.contexto({ pct_cobranza: Number(ev.target.value) }); verProyeccion(x_); });
      enlazarPagina(function (b) {
        if (!b.classList.contains('js-fp-com')) return;
        var k = com.filter(function (y) { return y.id === b.dataset.id; })[0] || {};
        U.formulario({ titulo: k.id ? 'Editar compromiso' : 'Nuevo compromiso', boton: 'Guardar', ancho: true,
          campos: '<div class="fin2-form-grid">' + U.campo('Concepto', '<input name="concepto" class="sx2-input" required value="' + txt(k.concepto || '') + '">') + U.campo('Fecha esperada', '<input type="date" name="fecha" class="sx2-input" required value="' + txt(k.fecha || '') + '">') +
            U.campo('Empresa', '<select name="empresa" class="sx2-input" required>' + opciones(cat_.empresas || [], k.empresa, 'Elige…') + '</select>') + U.campo('Monto', '<input name="monto" class="sx2-input" required value="' + txt(k.monto || '') + '">') +
            U.campo('Entra o sale', '<select name="sentido" class="sx2-input">' + opciones([['SALIDA', 'Sale'], ['ENTRADA', 'Entra']], k.sentido || 'SALIDA') + '</select>') +
            U.campo('Tipo', '<select name="tipo" class="sx2-input">' + opciones([['CONFIRMADO', 'Confirmado (hay una deuda o acuerdo)'], ['ESTIMADO', 'Estimado']], k.tipo || 'CONFIRMADO') + '</select>') +
            U.campo('Se repite', '<select name="recurrencia" class="sx2-input">' + opciones([['NINGUNA', 'No'], ['MENSUAL', 'Cada mes']], k.recurrencia || 'NINGUNA') + '</select>') +
            U.campo('Estado', '<select name="estado" class="sx2-input">' + opciones([['PENDIENTE', 'Pendiente'], ['PAGADO', 'Pagado'], ['ANULADO', 'Anulado']], k.estado || 'PENDIENTE') + '</select>') +
            U.campo('Nota', '<input name="nota" class="sx2-input" value="' + txt(k.nota || '') + '">') + '</div>',
          preparar: function (v) { return Object.assign(v, { id: k.id, expected_version: k.version, pago_ref: k.pago_ref || '' }); },
          enviar: function (v) { return x_.api('finanzasGuardarCompromiso', v); }, aviso: 'Compromiso guardado.', listo: function () { verProyeccion(x_); } });
      });
    });
  }

  window.SigsoFinanzasPlan = { verGastos: verGastos, verPrestamos: verPrestamos, verProyectos: verProyectos, verProvisiones: verProvisiones, verProyeccion: verProyeccion };
})();
