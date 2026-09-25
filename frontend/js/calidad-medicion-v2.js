/**
 * calidad-medicion-v2.js — Calidad: "Medición" 100 % v2 (SIGSO v2, R8b del
 * retiro de la versión clásica; ver documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 *  - Objetivos de calidad (§6.2, DOC-07): tablero del año en tarjetas con la
 *    última medición contra la meta; ficha lateral con los períodos del año
 *    (medido / sin medir / en curso), registrar medición (con "Traer datos
 *    del sistema" y cálculo del % desde numerador y denominador), anular una
 *    medición con motivo y editar el objetivo. "Abrir año" siembra los seis
 *    objetivos.
 *  - Indicadores por proceso (§9.1.1): lista con veredicto, fórmula, meta y
 *    tolerancia, y la serie de mediciones; medir eligiendo el período según
 *    la frecuencia (ya no se escribe "2026-M03" a mano), definir, editar y
 *    quitar.
 * Mismos endpoints que calidad.js.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  function C() { return window.SigsoCalidadV2.util; }
  // Algunos endpoints de indicadores responden { ok: true, data: { ok: false, message } }.
  function api(a, d) {
    return C().api(a, d).then(function (r) {
      if (r && r.ok && r.data && r.data.ok === false) return { ok: false, message: r.data.message || 'No se pudo guardar.' };
      return r;
    });
  }

  var SUFIJO = { PORCENTAJE: '%', HORAS: ' h', NUMERO: '' };
  var FUENTE = { AUTO: ['Lo calcula el sistema', 'ok'], ASISTIDA: ['El sistema aporta parte', 'info'], MANUAL: ['Registro manual', 'neutro'] };
  var VEREDICTO = { CUMPLE: ['Cumple', 'ok'], ALERTA: ['En alerta', 'alerta'], NO_CUMPLE: ['No cumple', 'critico'] };
  var OP = { MAYOR_IGUAL: '≥', MAYOR: '>', MENOR_IGUAL: '≤', MENOR: '<' };
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  var obj_ = { datos: null, anio: null }, ind_ = { datos: null, q: '', filtro: '' }, vista_ = '', turno_ = 0;

  function valor(v, unidad) { return v === null || v === undefined || v === '' ? '—' : v + (SUFIJO[unidad] !== undefined ? SUFIJO[unidad] : ''); }
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function esCorreo(t) { return !t || /^[^\s@]+@[^\s@]+$/.test(String(t).trim()); }
  function aviso(tono, icono, texto) { return '<div class="mj2-aviso sx2-tono-' + tono + ' sx2-entra">' + U.ico(icono, 16) + '<span>' + texto + '</span></div>'; }
  function dato(et, v) { return v ? '<dt>' + U.esc(et) + '</dt><dd>' + v + '</dd>' : ''; }
  function etiquetaPeriodo(clave) {
    var s = String(clave || ''), m = s.match(/^(\d{4})-M(\d{2})$/);
    if (m) return MESES[Number(m[2]) - 1] + ' ' + m[1];
    var t = s.match(/^(\d{4})-T(\d)$/); if (t) return 'trimestre ' + t[2] + ' de ' + t[1];
    var e = s.match(/^(\d{4})-S(\d)$/); if (e) return (e[2] === '1' ? 'primer' : 'segundo') + ' semestre de ' + e[1];
    return s;
  }
  // Mismo cálculo que el backend (periodosDelAnio_): el período está cerrado cuando terminó.
  function periodos(frecuencia, anio) {
    var hoy = new Date(), cerrado = function (finMes) { return hoy >= new Date(Date.UTC(anio, finMes, 1)); }, l = [];
    if (frecuencia === 'MENSUAL') for (var m = 1; m <= 12; m++) l.push({ clave: anio + '-M' + ('0' + m).slice(-2), cerrado: cerrado(m) });
    else if (frecuencia === 'TRIMESTRAL') for (var t = 1; t <= 4; t++) l.push({ clave: anio + '-T' + t, cerrado: cerrado(t * 3) });
    else if (frecuencia === 'SEMESTRAL') for (var s = 1; s <= 2; s++) l.push({ clave: anio + '-S' + s, cerrado: cerrado(s * 6) });
    else l.push({ clave: String(anio), cerrado: cerrado(12) });
    return l.map(function (p) { p.etiqueta = etiquetaPeriodo(p.clave); return p; });
  }
  function selectPeriodos(lista, medidos, nombre) {
    var primeroPendiente = (lista.filter(function (p) { return p.cerrado && !medidos[p.clave]; })[0] || lista.filter(function (p) { return !medidos[p.clave]; })[0] || lista[0] || {}).clave;
    return '<select class="sx2-select" name="' + (nombre || 'periodo') + '">' + lista.map(function (p) {
      return '<option value="' + U.esc(p.clave) + '"' + (p.clave === primeroPendiente ? ' selected' : '') + '>' + U.esc(p.etiqueta) + (p.cerrado ? '' : ' (en curso)') + (medidos[p.clave] ? ' — ya medido' : '') + '</option>';
    }).join('') + '</select>';
  }
  function opciones(lista, sel) { return (lista || []).map(function (x) { return '<option value="' + U.esc(x.clave) + '"' + (x.clave === sel ? ' selected' : '') + '>' + U.esc(x.etiqueta) + '</option>'; }).join(''); }
  // Mini serie de las mediciones (SVG, sin librería).
  function serie(lecturas, meta, unidad) {
    var l = (lecturas || []).filter(function (x) { return x.valor !== null && !isNaN(Number(x.valor)); });
    if (l.length < 2) return '';
    var vals = l.map(function (x) { return Number(x.valor); }).concat(meta !== null && meta !== undefined ? [Number(meta)] : []);
    var max = Math.max.apply(null, vals), min = Math.min.apply(null, vals.concat([0]));
    if (max === min) max = min + 1;
    var an = 140, al = 36, x = function (i) { return 2 + i * (an - 4) / (l.length - 1); }, y = function (v) { return al - 3 - (v - min) / (max - min) * (al - 6); };
    var linea = l.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(Number(p.valor)).toFixed(1); }).join(' ');
    return '<svg class="md2-serie" viewBox="0 0 ' + an + ' ' + al + '" role="img" aria-label="Serie de mediciones">' +
      (meta !== null && meta !== undefined ? '<line x1="0" x2="' + an + '" y1="' + y(Number(meta)).toFixed(1) + '" y2="' + y(Number(meta)).toFixed(1) + '" class="md2-serie__meta"/>' : '') +
      '<path d="' + linea + '" class="md2-serie__linea" fill="none"/>' +
      l.map(function (p, i) { var ok = p.veredicto ? p.veredicto === 'CUMPLE' : p.cumple; return '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(Number(p.valor)).toFixed(1) + '" r="2.6" class="md2-serie__p md2-serie__p--' + (ok ? 'ok' : 'mal') + '"><title>' + U.esc(etiquetaPeriodo(p.periodo) + ': ' + valor(p.valor, unidad)) + '</title></circle>'; }).join('') + '</svg>';
  }

  function cabecera(titulo, sub, acciones) {
    return '<header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Calidad · Medición</span><h1>' + U.esc(titulo) + '</h1>' +
      '<span class="sx2-tenue" style="font-size:.875rem">' + sub + '</span></div><div class="sx2-cabecera__acciones">' + (acciones || '') +
      U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-md2-recargar' }) + '</div></header>';
  }
  function pagina(html, silencioso) {
    var c = C().contenedor(vista_);
    if (!c) return;
    var y = window.scrollY, foco = document.activeElement && document.activeElement.classList.contains('js-md2-q');
    c.innerHTML = '<div class="sx2-pagina">' + html + '</div>';
    if (silencioso) { c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; }); window.scrollTo(0, y); }
    if (foco) { var q = c.querySelector('.js-md2-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
    U.animar(c);
  }
  function error(titulo, r) {
    pagina(cabecera(titulo, '') + U.card({ i: 1, cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || 'Inténtalo de nuevo.', accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-md2-recargar' }) }) }));
  }
  function paso(o, reabrir) {
    U.formulario({ titulo: o.titulo, subtitulo: o.sub ? '<span class="sx2-tenue" style="font-size:.8125rem">' + o.sub + '</span>' : '', boton: o.boton || 'Guardar', ancho: o.ancho,
      campos: o.campos, alMontar: o.alMontar, preparar: o.preparar, enviar: o.enviar, aviso: o.aviso,
      listo: function (r) { recargar(true); if (reabrir) reabrir(r); } });
  }
  function recargar(silencioso) { if (vista_ === 'objetivos') cargarObj(silencioso); else if (vista_ === 'indicadores') cargarInd(silencioso); }

  // =========================================================================================
  // Objetivos de calidad
  // =========================================================================================
  var OBJ_SUB = 'Objetivos de calidad (DOC-07). Cada uno se mide en su frecuencia y se compara solo contra su meta.';
  function cargarObj(silencioso) {
    var t = ++turno_;
    if (!C().contenedor('objetivos')) return;
    if (!silencioso || !obj_.datos) pagina(cabecera('Objetivos de calidad', OBJ_SUB) + U.esqueleto('kpis', 5) + U.esqueleto('tarjetas', 3));
    api('listarObjetivosSgc', obj_.anio ? { anio: obj_.anio } : {}).then(function (r) {
      if (t !== turno_ || vista_ !== 'objetivos' || !C().ocupa('objetivos')) return;
      if (!r || !r.ok) { error('Objetivos de calidad', r); return; }
      obj_.datos = r.data;
      obj_.anio = r.data.anio;
      pintarObj(!!silencioso);
    });
  }
  function pintarObj(silencioso) {
    var d = obj_.datos, ind = d.indicadores || {}, puede = d.puede_gestionar === true;
    var anios = (d.anios_disponibles || []).slice();
    if (anios.indexOf(d.anio) === -1) anios.unshift(d.anio);
    var sig = new Date().getFullYear() + 1;
    if (puede && anios.indexOf(sig) === -1) anios.unshift(sig);
    var sel = '<select class="sx2-select js-md2-anio" aria-label="Año">' + anios.map(function (a) { return '<option value="' + a + '"' + (a === d.anio ? ' selected' : '') + '>' + a + '</option>'; }).join('') + '</select>';
    if (!d.sembrado) {
      pagina(cabecera('Objetivos de calidad', OBJ_SUB, sel) + U.card({ i: 1, cuerpo: U.vacio({ icono: 'diana', titulo: 'El año ' + d.anio + ' todavía no tiene objetivos',
        texto: puede ? 'Al abrirlo se cargan los seis objetivos de DOC-07 con su indicador, meta, frecuencia y responsable (o se copian del año anterior). Después puedes ajustarlos.' : 'El Encargado SGC tiene que abrir el año antes de poder medir.',
        accion: puede ? U.boton({ texto: 'Abrir año ' + d.anio, icono: 'nueva', variante: 'primario', clase: 'js-md2-abrir-anio' }) : '' }) }), silencioso);
      return;
    }
    var l = d.objetivos || [];
    var pct = ind.total ? Math.round((ind.cumplen || 0) * 100 / ind.total) : null;
    pagina(cabecera('Objetivos de calidad', OBJ_SUB, sel) +
      '<div class="sx2-fila-kpis">' +
        U.kpi({ i: 0, etiqueta: 'Cumplen su meta', valor: ind.cumplen || 0, unidad: 'de ' + (ind.total || 0) + ' objetivos', icono: 'diana', tono: 'ok', progreso: pct }) +
        U.kpi({ i: 1, etiqueta: 'No cumplen', valor: ind.no_cumplen || 0, icono: 'alerta', tono: ind.no_cumplen ? 'critico' : 'ok' }) +
        U.kpi({ i: 2, etiqueta: 'Sin medir', valor: ind.sin_medir || 0, icono: 'reloj', tono: ind.sin_medir ? 'alerta' : 'ok' }) +
        U.kpi({ i: 3, etiqueta: 'Mediciones pendientes', valor: ind.lecturas_pendientes || 0, unidad: 'períodos cerrados', icono: 'calendario', tono: ind.lecturas_pendientes ? 'alerta' : 'ok' }) +
      '</div>' +
      (ind.lecturas_pendientes ? aviso('alerta', 'reloj', ind.lecturas_pendientes + ' período(s) ya cerrados siguen sin medir. No medir un objetivo es no evaluar el desempeño (§9.1.1).') : '') +
      (ind.no_cumplen ? aviso('critico', 'alerta', ind.no_cumplen + ' objetivo(s) no alcanzan su meta. Es entrada obligatoria de la revisión por la dirección (§9.3.2 e).') : '') +
      '<div class="md2-objs">' + l.map(function (o, i) {
        var u = o.ultima_lectura, tono = u ? (u.cumple ? 'ok' : 'critico') : 'neutro';
        return '<button type="button" class="sx2-card md2-obj sx2-tono-' + tono + ' sx2-entra" style="--i:' + Math.min(i + 3, 12) + '" data-md2-obj="' + U.esc(o.objetivo_id) + '">' +
          '<span class="md2-obj__cab"><span class="md2-obj__n">' + o.numero + '</span><strong>' + U.esc(o.objetivo_general) + '</strong></span>' +
          '<span class="md2-obj__ind">' + U.esc(o.indicador) + '</span>' + (o.meta_texto ? '<span class="md2-obj__meta">' + U.ico('diana', 12) + 'Meta: ' + U.esc(o.meta_texto) + '</span>' : '') +
          '<span class="md2-obj__valor"><b>' + U.esc(u ? valor(u.valor, o.unidad) : '—') + '</b><span class="sx2-tenue">' + (u ? U.esc(u.periodo_etiqueta || '') : 'nunca medido') + '</span></span>' +
          '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + (u ? U.badge(u.cumple ? 'Cumple' : 'No cumple', u.cumple ? 'ok' : 'critico') : U.badge('Sin medir', 'neutro')) +
            U.badge((FUENTE[o.fuente] || [o.fuente])[0], (FUENTE[o.fuente] || [0, 'neutro'])[1], true) +
            (o.lecturas_pendientes ? U.badge(o.lecturas_pendientes + ' por medir', 'alerta', true) : '') + '</span>' +
          '<span class="mj2-meta"><span>' + U.ico('calendario', 12) + U.esc(o.frecuencia_texto || o.frecuencia || '') + '</span>' + (o.responsable_texto ? '<span>' + U.ico('persona', 12) + U.esc(o.responsable_texto) + '</span>' : '') + '</span></button>';
      }).join('') + '</div>', silencioso);
  }
  function abrirObj(id) {
    var d = U.drawer({ titulo: 'Objetivo de calidad', cuerpo: U.esqueleto('tabla', 5) });
    d.el.classList.add('sx2-drawer--ancho');
    api('getDetalleObjetivoSgc', { objetivo_id: id }).then(function (r) {
      if (!r || !r.ok) { d.cuerpo(U.vacio({ icono: 'alerta', titulo: 'No se pudo abrir', texto: (r && r.message) || '' })); return; }
      d.cerrar(true);
      fichaObj(r.data);
    });
  }
  function fichaObj(data) {
    var o = data.objetivo, lecturas = data.lecturas || [], per = data.periodos || [], puede = data.puede_gestionar === true;
    var medidos = {};
    lecturas.forEach(function (l) { medidos[l.periodo] = l; });
    var reabrir = function () { abrirObj(o.objetivo_id); };
    var d = U.drawer({ titulo: o.numero + '. ' + o.objetivo_general,
      subtitulo: '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + U.badge((FUENTE[o.fuente] || [o.fuente])[0], (FUENTE[o.fuente] || [0, 'neutro'])[1]) + U.badge('Año ' + o.anio, 'neutro', true) + '</span>',
      cuerpo: (o.objetivo_especifico ? '<p class="mj2-desc">' + U.esc(o.objetivo_especifico) + '</p>' : '') +
        '<dl class="sx2-dato mj2-datos">' + dato('Indicador', U.esc(o.indicador)) + dato('Meta', U.esc(o.meta_texto || '')) + dato('Frecuencia', U.esc(o.frecuencia_texto || o.frecuencia)) +
          dato('Responsable', U.esc(o.responsable_texto || '')) + dato('Acciones para lograrlo', U.esc(o.acciones || '')) + '</dl>' +
        (puede ? '<div class="mj2-acciones">' + U.boton({ texto: 'Registrar medición', icono: 'mas', sm: true, variante: 'primario', clase: 'js-md2-medir' }) + U.boton({ texto: 'Editar objetivo', icono: 'editar', sm: true, clase: 'js-md2-editar' }) + '</div>' : '') +
        serie(lecturas.map(function (l) { return { periodo: l.periodo, valor: l.valor, cumple: l.cumple }; }), o.meta_valor, o.unidad).replace('md2-serie"', 'md2-serie md2-serie--grande"') +
        '<h3 class="mj2-sub">Mediciones de ' + o.anio + '</h3>' +
        '<div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr><th>Período</th><th class="sx2-num">Valor</th><th class="sx2-num">Detalle</th><th>Estado</th><th>Observaciones</th><th></th></tr></thead><tbody>' +
        per.map(function (p) {
          var l = medidos[p.clave];
          var est = l ? U.badge(l.cumple ? 'Cumple' : 'No cumple', l.cumple ? 'ok' : 'critico') : (p.cerrado ? U.badge('Sin medir', 'alerta') : U.badge('En curso', 'neutro', true));
          return '<tr><td>' + U.esc(p.etiqueta) + '</td><td class="sx2-num"><strong>' + U.esc(l ? valor(l.valor, o.unidad) : '—') + '</strong></td>' +
            '<td class="sx2-num sx2-tenue">' + (l && l.numerador !== null && l.denominador !== null && l.numerador !== '' ? U.esc(l.numerador + ' / ' + l.denominador) : '') + '</td><td>' + est + '</td>' +
            '<td class="sx2-tenue">' + U.esc((l && l.observaciones) || '') + '</td><td class="sx2-num">' + (l && puede ? U.boton({ texto: 'Anular', sm: true, variante: 'fantasma', clase: 'js-md2-anular', datos: { id: l.lectura_id } }) : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>',
      pie: U.boton({ texto: 'Cerrar', clase: 'js-sx2-drawer-cerrar' }) });
    d.el.classList.add('sx2-drawer--ancho');
    d.el.addEventListener('click', function (ev) {
      var t = ev.target, b;
      if (t.closest('.js-md2-medir')) formMedicionObj(o, per, medidos, reabrir);
      else if (t.closest('.js-md2-editar')) formObjetivo(o, data, reabrir);
      else if ((b = t.closest('.js-md2-anular'))) {
        var lid = b.getAttribute('data-id');
        paso({ titulo: 'Anular medición', boton: 'Anular', sub: 'Deja de contar en el tablero, pero queda registrada con el motivo.',
          campos: U.campo('Motivo', '<textarea class="sx2-input" name="motivo" rows="3" required></textarea>'),
          preparar: function (x) { return (x.motivo || '').length >= 5 ? x : 'Indica el motivo (mínimo 5 caracteres).'; },
          enviar: function (x) { return api('anularLecturaObjetivoSgc', { lectura_id: lid, motivo: x.motivo }); }, aviso: 'Medición anulada.' }, reabrir);
      }
    });
  }
  function formMedicionObj(o, per, medidos, reabrir) {
    var origen = 'MANUAL';
    paso({ titulo: 'Medir objetivo ' + o.numero, boton: 'Guardar medición', ancho: true,
      sub: U.esc(o.indicador) + '<br>Meta: <b>' + U.esc(o.meta_texto || '') + '</b>',
      campos: '<div class="sx2-form__fila">' + U.campo('Período', selectPeriodos(per, medidos)) +
          '<div class="sx2-campo"><span class="sx2-campo__et">&nbsp;</span>' + U.boton({ texto: 'Traer datos del sistema', icono: 'descargar', clase: 'js-md2-sugerir' }) + '</div></div>' +
        '<div class="js-md2-nota"></div>' +
        '<div class="sx2-form__fila">' + U.campo('Numerador (opcional)', '<input class="sx2-input" type="number" step="any" name="numerador">') + U.campo('Denominador (opcional)', '<input class="sx2-input" type="number" step="any" name="denominador">') + '</div>' +
        U.campo('Valor medido' + (SUFIJO[o.unidad] ? ' (' + SUFIJO[o.unidad].trim() + ')' : ''), '<input class="sx2-input" type="number" step="any" name="valor" required>', o.unidad === 'PORCENTAJE' ? 'Si pones numerador y denominador, se calcula solo.' : '') +
        U.campo('Observaciones (opcional)', '<textarea class="sx2-input" name="observaciones" rows="2"></textarea>'),
      alMontar: function (form) {
        var n = form.querySelector('[name=numerador]'), dd = form.querySelector('[name=denominador]'), v = form.querySelector('[name=valor]');
        var recalc = function () { if (o.unidad !== 'PORCENTAJE') return; var a = parseFloat(n.value), b = parseFloat(dd.value); if (isFinite(a) && isFinite(b) && b > 0) v.value = Math.round(a / b * 1000) / 10; };
        n.addEventListener('input', recalc); dd.addEventListener('input', recalc);
        v.addEventListener('input', function () { origen = 'MANUAL'; });
        form.querySelector('.js-md2-sugerir').addEventListener('click', function (ev) {
          var b = ev.currentTarget, caja = form.querySelector('.js-md2-nota');
          b.disabled = true;
          api('sugerirLecturaObjetivoSgc', { objetivo_id: o.objetivo_id, periodo: form.querySelector('[name=periodo]').value }).then(function (r) {
            b.disabled = false;
            if (!r || !r.ok) { caja.innerHTML = aviso('critico', 'alerta', U.esc((r && r.message) || 'No se pudo consultar.')); return; }
            var s = r.data;
            caja.innerHTML = aviso(s.completo ? 'info' : 'alerta', 'info', U.esc(s.nota || ''));
            if (s.numerador !== '' && s.numerador != null) n.value = s.numerador;
            if (s.denominador !== '' && s.denominador != null) dd.value = s.denominador;
            if (s.valor != null) { v.value = s.valor; origen = s.fuente === 'AUTO' ? 'AUTO' : 'MANUAL'; }
          });
        });
      },
      preparar: function (x) { return x.valor === '' || isNaN(Number(x.valor)) ? 'Indica el valor medido.' : x; },
      enviar: function (x) { return api('registrarLecturaObjetivoSgc', { objetivo_id: o.objetivo_id, periodo: x.periodo, valor: x.valor, numerador: x.numerador, denominador: x.denominador, observaciones: x.observaciones, origen: origen }); },
      aviso: function (r) { return r && r.data && r.data.cumple ? 'Medición registrada: alcanza la meta.' : 'Medición registrada: NO alcanza la meta.'; } }, reabrir);
  }
  function formObjetivo(o, data, reabrir) {
    var cat = data.catalogos || {};
    paso({ titulo: 'Editar objetivo ' + o.numero, ancho: true, sub: 'Son los datos de DOC-07. Ajustarlos aquí no cambia el documento: actualiza el documento y deja el tablero igual.',
      campos: U.campo('Objetivo general', '<input class="sx2-input" name="objetivo_general" required value="' + U.esc(o.objetivo_general || '') + '">') +
        U.campo('Objetivo específico', '<textarea class="sx2-input" name="objetivo_especifico" rows="2">' + U.esc(o.objetivo_especifico || '') + '</textarea>') +
        U.campo('Indicador', '<textarea class="sx2-input" name="indicador" rows="2" required>' + U.esc(o.indicador || '') + '</textarea>') +
        U.campo('Meta (como la escribe DOC-07)', '<input class="sx2-input" name="meta_texto" value="' + U.esc(o.meta_texto || '') + '">') +
        '<div class="sx2-form__fila">' + U.campo('Comparación', '<select class="sx2-select" name="meta_operador">' + opciones(cat.operadores, o.meta_operador) + '</select>') +
          U.campo('Valor de la meta', '<input class="sx2-input" type="number" step="any" name="meta_valor" required value="' + U.esc(o.meta_valor) + '">') +
          U.campo('Unidad', '<select class="sx2-select" name="unidad">' + opciones(cat.unidades, o.unidad) + '</select>') + '</div>' +
        '<div class="sx2-form__fila">' + U.campo('Frecuencia de seguimiento', '<select class="sx2-select" name="frecuencia">' + opciones(cat.frecuencias, o.frecuencia) + '</select>') +
          U.campo('Frecuencia (texto de DOC-07)', '<input class="sx2-input" name="frecuencia_texto" value="' + U.esc(o.frecuencia_texto || '') + '">') + '</div>' +
        U.campo('Acciones para lograrlo', '<textarea class="sx2-input" name="acciones" rows="2">' + U.esc(o.acciones || '') + '</textarea>') +
        '<div class="sx2-form__fila">' + U.campo('Responsable', '<input class="sx2-input" name="responsable_texto" value="' + U.esc(o.responsable_texto || '') + '">') +
          U.campo('Correo del responsable (opcional)', '<input class="sx2-input" type="email" name="responsable_email" value="' + U.esc(o.responsable_email || '') + '">') + '</div>',
      preparar: function (x) { if (!x.objetivo_general || !x.indicador) return 'Completa objetivo e indicador.'; if (x.meta_valor === '' || isNaN(Number(x.meta_valor))) return 'Indica el valor de la meta.'; return esCorreo(x.responsable_email) ? x : 'Revisa el correo del responsable.'; },
      enviar: function (x) { x.objetivo_id = o.objetivo_id; return api('guardarObjetivoSgc', x); }, aviso: 'Objetivo guardado.' }, reabrir);
  }

  // =========================================================================================
  // Indicadores por proceso
  // =========================================================================================
  var IND_SUB = 'Indicadores por proceso (§9.1.1): cómo va cada proceso, con su fórmula y su responsable. Los objetivos de calidad viven en su propia sección.';
  function metaTxt(i) {
    var op = OP[i.meta_operador] || '', suf = i.unidad === 'PORCENTAJE' ? '%' : '';
    return op + ' ' + i.meta_valor + suf + (i.tolerancia_valor !== null && i.tolerancia_valor !== undefined ? ' · tolerancia ' + op + ' ' + i.tolerancia_valor + suf : '');
  }
  function cargarInd(silencioso) {
    var t = ++turno_;
    if (!C().contenedor('indicadores')) return;
    if (!silencioso || !ind_.datos) pagina(cabecera('Indicadores', IND_SUB) + U.esqueleto('kpis', 5) + U.esqueleto('tabla', 5));
    api('listarIndicadoresSgc', {}).then(function (r) {
      if (t !== turno_ || vista_ !== 'indicadores' || !C().ocupa('indicadores')) return;
      if (!r || !r.ok) { error('Indicadores', r); return; }
      ind_.datos = r.data;
      pintarInd(!!silencioso);
      var cs = (r.data.indicadores || []).map(function (i) { return i.responsable_email; }).filter(Boolean);
      Promise.all([window.SigsoDirectorio ? SigsoDirectorio.resolver(cs) : Promise.resolve(), U.precargarFotos(cs)]).then(function () { if (t === turno_) pintarInd(true); });
    });
  }
  function pintarInd(silencioso) {
    var d = ind_.datos, r = d.resumen || {}, puede = !!d.puede_gestionar;
    var todos = d.indicadores || [];
    var l = todos.filter(function (i) {
      var v = i.ultima_lectura ? i.ultima_lectura.veredicto : 'SIN';
      if (ind_.filtro && v !== ind_.filtro) return false;
      return !ind_.q || norm([i.codigo, i.nombre, i.formula, i.proceso, i.objetivo, i.responsable_email].join(' ')).indexOf(norm(ind_.q)) !== -1;
    });
    var kpi = function (i, et, val, ico, tono, f) { return U.kpi({ i: i, etiqueta: et, valor: val || 0, icono: ico, tono: tono, filtro: f, activo: ind_.filtro === f }); };
    pagina(cabecera('Indicadores', IND_SUB, puede ? U.boton({ texto: 'Definir indicador', icono: 'nueva', variante: 'primario', clase: 'js-md2-ind-nuevo' }) : '') +
      '<div class="sx2-fila-kpis">' + kpi(0, 'Cumplen', r.cumplen, 'check', 'ok', 'CUMPLE') + kpi(1, 'En alerta', r.alerta, 'info', r.alerta ? 'alerta' : 'neutro', 'ALERTA') +
        kpi(2, 'No cumplen', r.no_cumplen, 'alerta', r.no_cumplen ? 'critico' : 'neutro', 'NO_CUMPLE') + kpi(3, 'Sin medir', r.sin_medir, 'reloj', r.sin_medir ? 'alerta' : 'neutro', 'SIN') + '</div>' +
      (r.procesos_mapa && r.procesos_sin_indicador ? aviso('alerta', 'capas', r.procesos_sin_indicador + ' de los ' + r.procesos_mapa + ' procesos del mapa no tienen ningún indicador (debilidad D1 del FODA y acción del riesgo R1).') : '') +
      '<div class="sx2-card sx2-py-herramientas sx2-entra" style="--i:4"><div class="sx2-barra-filtros"><label class="sx2-buscar">' + U.ico('lupa', 16) +
        '<input class="sx2-input js-md2-q" type="search" placeholder="Buscar por código, nombre, proceso o fórmula…" value="' + U.esc(ind_.q) + '"></label>' +
        (ind_.filtro ? U.chip({ texto: 'Quitar filtro', icono: 'equis', clase: 'js-md2-sinfiltro' }) : '') + '</div></div>' +
      (l.length ? '<section class="sx2-card sx2-card--sin-relleno sx2-entra" style="--i:5"><ul class="md2-inds">' + l.map(function (i) {
        var u = i.ultima_lectura, v = u ? (VEREDICTO[u.veredicto] || [u.veredicto, 'neutro']) : ['Sin medir', 'neutro'];
        return '<li class="md2-ind sx2-tono-' + v[1] + '"><div class="sx2-apilado" style="gap:5px;min-width:0;flex:1">' +
            '<span class="sx2-flex" style="gap:8px;flex-wrap:wrap;align-items:center"><code class="mj2-cod">' + U.esc(i.codigo) + '</code><strong class="mj2-fila__tit">' + U.esc(i.nombre) + '</strong>' + U.badge(v[0], v[1]) +
              (i.lecturas_pendientes ? U.badge(i.lecturas_pendientes + ' por medir', 'alerta', true) : '') + '</span>' +
            '<span class="sx2-tenue mj2-fila__txt">' + U.esc(i.formula || '') + '</span>' +
            '<span class="mj2-meta"><span>Meta ' + U.esc(metaTxt(i)) + '</span>' + (u ? '<span>Última: <b>' + U.esc(valor(u.valor, i.unidad)) + '</b> (' + U.esc(etiquetaPeriodo(u.periodo)) + ')</span>' : '') +
              (i.proceso ? '<span>' + U.ico('capas', 12) + U.esc(i.proceso) + '</span>' : '') + (i.objetivo ? '<span>' + U.ico('diana', 12) + 'Alimenta ' + U.esc(i.objetivo) + '</span>' : '') +
              (i.responsable_email ? '<span>' + U.avatar(PY.persona(i.responsable_email), 'xs') + U.esc(PY.persona(i.responsable_email).nombre) + '</span>' : '') + '</span></div>' +
          '<div class="md2-ind__der">' + serie(i.lecturas, i.meta_valor, i.unidad) +
            (puede ? '<span class="mj2-acciones" style="margin:0;justify-content:flex-end">' + U.boton({ texto: 'Medir', icono: 'mas', sm: true, variante: 'primario', clase: 'js-md2-ind-medir', datos: { id: i.indicador_id } }) +
              U.boton({ soloIcono: true, icono: 'editar', sm: true, variante: 'fantasma', titulo: 'Editar', clase: 'js-md2-ind-editar', datos: { id: i.indicador_id } }) +
              U.boton({ soloIcono: true, icono: 'basura', sm: true, variante: 'fantasma', titulo: 'Quitar', clase: 'js-md2-ind-quitar', datos: { id: i.indicador_id } }) + '</span>' : '') + '</div></li>';
      }).join('') + '</ul></section>'
        : U.card({ i: 5, cuerpo: U.vacio({ icono: 'grafico', titulo: todos.length ? 'Nada con este filtro' : 'Todavía no hay indicadores definidos', texto: todos.length ? '' : 'Cada indicador necesita una fórmula: sin ella, dos personas pueden medir lo mismo de forma distinta.' }) })), silencioso);
  }
  function indicador(id) { return ((ind_.datos && ind_.datos.indicadores) || []).filter(function (x) { return x.indicador_id === id; })[0]; }
  function formMedirInd(i) {
    var anio = (ind_.datos && ind_.datos.anio) || new Date().getFullYear();
    var medidos = {};
    (i.lecturas || []).forEach(function (l) { medidos[l.periodo] = l; });
    var per = periodos(i.frecuencia, anio);
    paso({ titulo: 'Medir ' + i.codigo, boton: 'Registrar medición', sub: U.esc(i.formula || '') + '<br>Meta: <b>' + U.esc(metaTxt(i)) + '</b>',
      campos: '<div class="sx2-form__fila">' + U.campo('Año', '<select class="sx2-select js-md2-anio-ind">' + [anio, anio - 1].map(function (a) { return '<option value="' + a + '">' + a + '</option>'; }).join('') + '</select>') +
          '<div class="js-md2-per">' + U.campo('Período', selectPeriodos(per, medidos)) + '</div></div>' +
        '<div class="sx2-form__fila">' + U.campo('Numerador', '<input class="sx2-input" type="number" step="any" name="numerador">', 'Opcional, pero deja el número auditable.') + U.campo('Denominador', '<input class="sx2-input" type="number" step="any" name="denominador">') + '</div>' +
        U.campo('O el valor directo', '<input class="sx2-input" type="number" step="any" name="valor">') +
        U.campo('Observaciones', '<textarea class="sx2-input" name="observaciones" rows="2"></textarea>'),
      alMontar: function (form) {
        form.querySelector('.js-md2-anio-ind').addEventListener('change', function (ev) {
          form.querySelector('.js-md2-per').innerHTML = U.campo('Período', selectPeriodos(periodos(i.frecuencia, Number(ev.target.value)), medidos));
        });
      },
      preparar: function (x) {
        var hayND = x.numerador !== '' && x.denominador !== '';
        if (!hayND && x.valor === '') return 'Indica numerador y denominador, o el valor directo.';
        if (hayND && Number(x.denominador) === 0) return 'El denominador no puede ser 0.';
        return x;
      },
      enviar: function (x) { return api('registrarLecturaIndicadorSgc', { indicador_id: i.indicador_id, periodo: x.periodo, numerador: x.numerador, denominador: x.denominador, valor: x.valor, observaciones: x.observaciones }); },
      aviso: function (r) { return (r && r.data && r.data.message) || 'Medición registrada.'; } });
  }
  function formIndicador(i) {
    var d = ind_.datos, cat = d.catalogos || {}, nuevo = !i;
    i = i || {};
    paso({ titulo: nuevo ? 'Definir indicador' : 'Editar ' + i.codigo, ancho: true,
      campos: U.campo('Nombre', '<input class="sx2-input" name="nombre" required value="' + U.esc(i.nombre || '') + '">') +
        U.campo('Fórmula de cálculo', '<textarea class="sx2-input" name="formula" rows="2" required>' + U.esc(i.formula || '') + '</textarea>', 'Sin fórmula, dos personas pueden medir lo mismo de forma distinta.') +
        U.campo('Descripción', '<textarea class="sx2-input" name="descripcion" rows="2">' + U.esc(i.descripcion || '') + '</textarea>') +
        '<div class="sx2-form__fila">' + U.campo('Proceso que mide', '<select class="sx2-select" name="proceso_id"><option value="">Sin proceso asociado</option>' + (d.procesos || []).map(function (p) { return '<option value="' + U.esc(p.proceso_id) + '"' + (p.proceso_id === i.proceso_id ? ' selected' : '') + '>' + U.esc(p.codigo + ' — ' + p.nombre) + '</option>'; }).join('') + '</select>') +
          U.campo('Objetivo de calidad que alimenta', '<select class="sx2-select" name="objetivo_id"><option value="">No alimenta ningún objetivo</option>' + (d.objetivos || []).map(function (o) { return '<option value="' + U.esc(o.objetivo_id) + '"' + (o.objetivo_id === i.objetivo_id ? ' selected' : '') + '>' + U.esc('OBJ-' + o.numero + ' (' + o.anio + '): ' + String(o.nombre).slice(0, 50)) + '</option>'; }).join('') + '</select>') + '</div>' +
        '<div class="sx2-form__fila">' + U.campo('La meta se cumple si el valor es', '<select class="sx2-select" name="meta_operador">' + opciones(cat.operadores, i.meta_operador || 'MAYOR_IGUAL') + '</select>') +
          U.campo('Meta', '<input class="sx2-input" type="number" step="any" name="meta_valor" required value="' + U.esc(i.meta_valor === undefined ? '' : i.meta_valor) + '">') +
          U.campo('Unidad', '<select class="sx2-select" name="unidad">' + opciones(cat.unidades, i.unidad || 'PORCENTAJE') + '</select>') + '</div>' +
        '<div class="sx2-form__fila">' + U.campo('Tolerancia (opcional)', '<input class="sx2-input" type="number" step="any" name="tolerancia_valor" value="' + U.esc(i.tolerancia_valor === null || i.tolerancia_valor === undefined ? '' : i.tolerancia_valor) + '">', 'Umbral más laxo que la meta: entre los dos, queda "en alerta".') +
          U.campo('Frecuencia de medición', '<select class="sx2-select" name="frecuencia">' + opciones(cat.frecuencias, i.frecuencia || 'MENSUAL') + '</select>') + '</div>' +
        '<div class="sx2-form__fila">' + U.campo('Responsable (correo)', '<input class="sx2-input" type="email" name="responsable_email" value="' + U.esc(i.responsable_email || '') + '">') +
          U.campo('Fuente del dato', '<input class="sx2-input" name="fuente" value="' + U.esc(i.fuente || '') + '" placeholder="Una planilla, el sistema, un informe">') + '</div>',
      preparar: function (x) {
        if (!x.nombre || !x.formula) return 'Completa nombre y fórmula.';
        if (x.meta_valor === '' || isNaN(Number(x.meta_valor))) return 'Indica la meta.';
        return esCorreo(x.responsable_email) ? x : 'Revisa el correo del responsable.';
      },
      enviar: function (x) { x.indicador_id = i.indicador_id || ''; return api('guardarIndicadorSgc', x); },
      aviso: function (r) { return (r && r.data && r.data.message) || 'Indicador guardado.'; } });
  }

  // --- Eventos -------------------------------------------------------------------------------
  function mio() { var c = document.getElementById('calidad-v2'); return !!c && (c.getAttribute('data-vista') === 'objetivos' || c.getAttribute('data-vista') === 'indicadores'); }
  document.addEventListener('click', function (ev) {
    var raiz = document.getElementById('calidad-v2');
    if (!raiz || !raiz.contains(ev.target) || !mio()) return;
    var t = ev.target, b;
    if (t.closest('.js-md2-recargar')) { recargar(true); return; }
    if (t.closest('.js-md2-abrir-anio')) {
      var anio = obj_.datos.anio;
      U.confirmar({ titulo: '¿Abrir el año ' + anio + '?', texto: 'Se cargan los seis objetivos de DOC-07 (o se copian del año anterior, con tus ajustes).', boton: 'Abrir año' }).then(function (ok) {
        if (!ok) return;
        api('sembrarAnioObjetivosSgc', { anio: anio }).then(function (r) {
          if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo abrir el año.', 'error'); return; }
          PY.aviso('Año ' + anio + ' abierto con ' + r.data.creados + ' objetivos.', 'exito');
          cargarObj(false);
        });
      });
      return;
    }
    if ((b = t.closest('[data-md2-obj]'))) { abrirObj(b.getAttribute('data-md2-obj')); return; }
    if (t.closest('.js-md2-ind-nuevo')) { formIndicador(null); return; }
    if ((b = t.closest('.js-md2-ind-medir'))) { formMedirInd(indicador(b.getAttribute('data-id'))); return; }
    if ((b = t.closest('.js-md2-ind-editar'))) { formIndicador(indicador(b.getAttribute('data-id'))); return; }
    if ((b = t.closest('.js-md2-ind-quitar'))) {
      var i = indicador(b.getAttribute('data-id'));
      U.confirmar({ titulo: '¿Quitar ' + i.codigo + '?', texto: 'Sus mediciones se conservan como historial.', boton: 'Quitar', peligro: true }).then(function (ok) {
        if (ok) api('anularIndicadorSgc', { indicador_id: i.indicador_id }).then(function (r) { if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo quitar.', 'error'); return; } PY.aviso('Indicador quitado.', 'exito'); cargarInd(true); });
      });
      return;
    }
    if (t.closest('.js-md2-sinfiltro')) { ind_.filtro = ''; pintarInd(true); return; }
    if ((b = t.closest('.sx2-kpi--clic')) && vista_ === 'indicadores') { var f = b.getAttribute('data-filtro'); ind_.filtro = ind_.filtro === f ? '' : f; pintarInd(true); }
  });
  document.addEventListener('change', function (ev) {
    if (ev.target.classList && ev.target.classList.contains('js-md2-anio') && mio()) { obj_.anio = Number(ev.target.value); cargarObj(false); }
  });
  var tq_ = null;
  document.addEventListener('input', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('js-md2-q') || !mio()) return;
    var v = ev.target.value;
    clearTimeout(tq_);
    tq_ = setTimeout(function () { ind_.q = v; pintarInd(true); }, 160);
  });

  window.SigsoCalidadMedicionV2 = {
    mostrar: function (v) {
      vista_ = v;
      if (v === 'objetivos') cargarObj(!!obj_.datos && C().ocupa('objetivos'));
      else cargarInd(!!ind_.datos && C().ocupa('indicadores'));
    },
    vistas: ['objetivos', 'indicadores']
  };
})();
