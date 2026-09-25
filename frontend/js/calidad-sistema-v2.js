/**
 * calidad-sistema-v2.js — Calidad: "El sistema" 100 % v2 (SIGSO v2, R9 del
 * retiro de la versión clásica; ver documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 *  - Alcance (§4.3): identidad, declaración, áreas y ubicaciones, exclusiones
 *    con su justificación y versiones anteriores; declarar desde la propuesta
 *    del DOC-01, corregir o publicar una versión nueva.
 *  - Contexto (§4.1/§4.2): FODA en cuadrantes (interno/externo) y partes
 *    interesadas con impacto e influencia; registrar la revisión.
 *  - Mapa de procesos (§4.4): entradas → procesos por tipo → salidas; ficha
 *    lateral con bloques, pasos, procesos de servicio y riesgos del proceso.
 *  - Riesgos y oportunidades (§6.1): mapa de calor probabilidad × impacto,
 *    valoración inherente y tras controles, asignar la acción a Mi trabajo.
 *  - Cobertura ISO: las cláusulas auditables agrupadas por capítulo, con su
 *    evidencia y el PDF de evidencia por cláusula.
 * Mismos endpoints que calidad.js.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  function C() { return window.SigsoCalidadV2.util; }
  function api(a, d) {
    return C().api(a, d).then(function (r) {
      if (r && r.ok && r.data && r.data.ok === false) return { ok: false, message: r.data.message || 'No se pudo guardar.' };
      return r;
    });
  }
  var VISTAS = {
    alcance: ['Alcance del SGC', 'Qué cubre el sistema de gestión y qué cláusulas quedaron fuera. §4.3 pide mantenerlo documentado y justificar cada exclusión.'],
    contexto: ['Contexto y partes interesadas', 'El entorno en que opera la organización (§4.1) y quiénes esperan algo de ella (§4.2). La norma pide revisarlos periódicamente.'],
    procesos: ['Mapa de procesos', 'Los procesos del SGC y cómo se relacionan (§4.4). Los procesos de servicio son el detalle operativo que cuelga de cada uno.'],
    riesgos: ['Riesgos y oportunidades', 'La magnitud y su nivel los calcula el sistema desde probabilidad × impacto (§6.1): la etiqueta nunca contradice al número.'],
    cobertura: ['Cobertura ISO 9001', 'Las cláusulas auditables con el estado que hoy se puede sustentar con datos del sistema: ¿estamos listos para la auditoría?']
  };
  var FODA = { FORTALEZA: ['Fortalezas', 'ok', 'interna'], DEBILIDAD: ['Debilidades', 'alerta', 'interna'], OPORTUNIDAD: ['Oportunidades', 'info', 'externa'], AMENAZA: ['Amenazas', 'critico', 'externa'] };
  var TIPO_PROC = { ESTRATEGICO: ['Estratégicos', 'info'], OPERATIVO: ['Operativos', 'ok'], APOYO: ['De apoyo', 'neutro'] };
  var COB = { COMPLETO: ['Completo', 'ok'], PARCIAL: ['Parcial', 'alerta'], FALTANTE: ['Faltante', 'critico'], NO_APLICA: ['No aplica', 'neutro'] };
  var CAPITULOS = { 4: 'Contexto de la organización', 5: 'Liderazgo', 6: 'Planificación', 7: 'Apoyo', 8: 'Operación', 9: 'Evaluación del desempeño', 10: 'Mejora' };

  var est_ = { alcance: {}, contexto: { sub: 'foda' }, procesos: {}, riesgos: { sub: 'riesgos' }, cobertura: { filtro: '' } };
  var vista_ = '', turno_ = 0;
  var ACCION = { alcance: 'obtenerAlcanceSgc', contexto: 'obtenerContextoSgc', procesos: 'listarProcesosSgc', riesgos: 'listarRiesgosSgc', cobertura: 'listarMatrizCoberturaSgc' };

  function fecha(v) { if (!v) return '—'; var s = String(v); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? PY.fecha(s, true) : (C().fechaChile(s) || PY.fecha(s, true)); }
  function lineas(t) { return String(t || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); }
  function esCorreo(t) { return !t || /^[^\s@]+@[^\s@]+$/.test(String(t).trim()); }
  function aviso(tono, icono, texto) { return '<div class="mj2-aviso sx2-tono-' + tono + ' sx2-entra">' + U.ico(icono, 16) + '<span>' + texto + '</span></div>'; }
  function dato(et, v) { return v ? '<dt>' + U.esc(et) + '</dt><dd>' + v + '</dd>' : ''; }
  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function persona(email) { if (!email) return ''; var p = PY.persona(email); return '<span class="sx2-flex" style="gap:6px;align-items:center">' + U.avatar(p, 'xs') + U.esc(p.nombre) + '</span>'; }
  function input(n, v, extra) { return '<input class="sx2-input" name="' + n + '" value="' + U.esc(v == null ? '' : v) + '"' + (extra || '') + '>'; }
  function area(n, v, filas, extra) { return '<textarea class="sx2-input" name="' + n + '" rows="' + (filas || 3) + '"' + (extra || '') + '>' + U.esc(v == null ? '' : v) + '</textarea>'; }
  function select(n, ops, v) { return '<select class="sx2-select" name="' + n + '">' + ops.map(function (o) { return '<option value="' + U.esc(o[0]) + '"' + (String(o[0]) === String(v == null ? '' : v) ? ' selected' : '') + '>' + U.esc(o[1]) + '</option>'; }).join('') + '</select>'; }
  function fila2(a, b) { return '<div class="sx2-form__fila">' + a + b + '</div>'; }

  function cabecera(acciones) {
    var v = VISTAS[vista_];
    return '<header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Calidad · El sistema</span><h1>' + U.esc(v[0]) + '</h1>' +
      '<span class="sx2-tenue" style="font-size:.875rem">' + U.esc(v[1]) + '</span></div><div class="sx2-cabecera__acciones">' + (acciones || '') +
      U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-si2-recargar' }) + '</div></header>';
  }
  function pagina(html, silencioso) {
    var c = C().contenedor(vista_);
    if (!c) return;
    var y = window.scrollY;
    c.innerHTML = '<div class="sx2-pagina">' + html + '</div>';
    if (silencioso) { c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; }); window.scrollTo(0, y); }
    U.animar(c);
  }
  function paso(o) {
    U.formulario({ titulo: o.titulo, subtitulo: o.sub ? '<span class="sx2-tenue" style="font-size:.8125rem">' + o.sub + '</span>' : '', boton: o.boton || 'Guardar', ancho: o.ancho,
      campos: o.campos, alMontar: o.alMontar, preparar: o.preparar, enviar: o.enviar,
      aviso: o.aviso || function (r) { return (r && r.data && r.data.message) || 'Guardado.'; },
      listo: function (r) { if (o.listo) o.listo(r); else cargar(true); } });
  }
  function accion(a, datos, exito, despues) {
    return api(a, datos).then(function (r) {
      if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo aplicar.', 'error'); return; }
      PY.aviso((r.data && r.data.message) || exito, 'exito');
      (despues || function () { cargar(true); })();
    });
  }
  function confirmarY(o, a, datos, exito) {
    U.confirmar({ titulo: o.titulo, texto: o.texto, boton: o.boton, peligro: o.peligro }).then(function (ok) { if (ok) accion(a, datos, exito); });
  }
  function avisoRevision(r, meses, nombre) {
    if (!r || !r.ultima_revision) return '';
    return aviso(r.revision_vencida ? 'critico' : 'info', r.revision_vencida ? 'alerta' : 'calendario', 'Última revisión ' + nombre + ': <b>' + txt(fecha(r.ultima_revision)) + '</b>' +
      (r.meses_desde_revision != null ? ' (hace ' + r.meses_desde_revision + (r.meses_desde_revision === 1 ? ' mes)' : ' meses)') : '') + '. Frecuencia definida: cada ' + (meses || 12) + ' meses.' + (r.revision_vencida ? ' <b>Está vencida.</b>' : ''));
  }

  function cargar(silencioso) {
    var v = vista_, t = ++turno_;
    if (!C().contenedor(v)) return;
    if (!silencioso || !est_[v].datos) pagina(cabecera() + U.esqueleto('kpis', 4) + U.esqueleto('tarjetas', 3));
    api(ACCION[v], {}).then(function (r) {
      if (t !== turno_ || v !== vista_ || !C().ocupa(v)) return;
      if (!r || !r.ok) { pagina(cabecera() + U.card({ i: 1, cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || '', accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-si2-recargar' }) }) })); return; }
      est_[v].datos = r.data;
      pintar(!!silencioso);
    });
  }
  function pintar(silencioso) {
    if (!C().ocupa(vista_) || !est_[vista_] || !est_[vista_].datos) return;
    ({ alcance: pintarAlcance, contexto: pintarContexto, procesos: pintarProcesos, riesgos: pintarRiesgos, cobertura: pintarCobertura })[vista_](silencioso);
  }

  // =========================================================================================
  // Alcance
  // =========================================================================================
  function pintarAlcance(silencioso) {
    var d = est_.alcance.datos, a = d.alcance, puede = !!d.puede_gestionar;
    if (!a) {
      var p = d.propuesta || {};
      pagina(cabecera() + aviso('alerta', 'alerta', 'El alcance del SGC todavía no está declarado. Es lo primero que pide una auditoría de certificación (§4.3).') +
        (puede ? U.card({ titulo: 'Propuesta tomada del DOC-01 (Manual de calidad)', icono: 'documento', i: 2, cuerpo:
          '<p class="mj2-ayuda" style="margin:0 0 10px">Está transcrita del manual, no redactada por el sistema. Revísala antes de confirmar.</p>' +
          '<dl class="sx2-dato">' + dato('Razón social', txt(p.razon_social)) + dato('Nombre de fantasía', txt(p.nombre_fantasia)) + dato('RUT', txt(p.rut)) +
            dato('Áreas', txt((p.areas || []).join(' · '))) + dato('Ubicaciones', txt((p.ubicaciones || []).join(' · '))) + dato('Exclusiones propuestas', String((p.exclusiones || []).length)) + '</dl>' +
          (p.declaracion ? '<p class="mj2-desc">' + txt(p.declaracion) + '</p>' : '') +
          (p.advertencias || []).map(function (t) { return aviso('alerta', 'info', txt(t)); }).join('') +
          '<div class="mj2-acciones">' + U.boton({ texto: 'Revisar y declarar el alcance', icono: 'check', variante: 'primario', clase: 'js-si2-declarar' }) + '</div>' })
          : U.card({ i: 2, cuerpo: U.vacio({ icono: 'escudo', titulo: 'Sin alcance declarado', texto: 'El Encargado del SGC es quien lo declara.' }) })), silencioso);
      return;
    }
    var exc = d.exclusiones || [];
    pagina(cabecera(puede ? U.boton({ texto: 'Declarar exclusión', icono: 'mas', variante: 'fantasma', clase: 'js-si2-exc-nueva' }) + U.boton({ texto: 'Publicar nueva versión', icono: 'capas', variante: 'primario', clase: 'js-si2-version' }) : '') +
      '<div class="sx2-grid sx2-grid--estira"><div class="sx2-col-8">' +
      U.card({ titulo: 'Declaración de alcance', icono: 'escudo', sub: 'v' + a.version + (a.vigente_desde ? ' · vigente desde ' + fecha(a.vigente_desde) : ''), i: 1, accion: puede ? { texto: 'Corregir', clase: 'js-si2-corregir' } : null, cuerpo:
        '<p class="si2-declaracion">' + txt(a.declaracion) + '</p>' +
        '<h3 class="mj2-sub">Áreas incluidas</h3><div class="si2-chips">' + (a.areas || []).map(function (x) { return '<span class="si2-chip">' + txt(x) + '</span>'; }).join('') + '</div>' +
        '<h3 class="mj2-sub">Ubicaciones</h3><ul class="si2-ubic">' + (a.ubicaciones || []).map(function (x) { return '<li>' + U.ico('ubicacion', 14) + txt(x) + '</li>'; }).join('') + '</ul>' }) +
      '</div><div class="sx2-col-4">' +
      U.card({ titulo: 'Organización', icono: 'empresa', i: 2, cuerpo: '<dl class="sx2-dato">' + dato('Razón social', txt(a.razon_social)) + dato('Nombre de fantasía', txt(a.nombre_fantasia)) + dato('RUT', txt(a.rut)) +
        dato('Norma', txt(a.norma_codigo + ':' + a.norma_version)) + '</dl>' }) +
      ((d.historial || []).length ? U.card({ titulo: 'Versiones anteriores', icono: 'capas', i: 3, cuerpo: '<ul class="fc2-versiones">' + d.historial.map(function (h) {
        return '<li style="flex-wrap:wrap"><code class="mj2-cod">v' + txt(h.version) + '</code>' + U.badge('Reemplazada', 'neutro', true) + (h.observaciones ? '<small class="sx2-tenue" style="flex-basis:100%">Motivo: ' + txt(h.observaciones) + '</small>' : '') + '</li>';
      }).join('') + '</ul>' }) : '') +
      '</div></div>' +
      U.card({ titulo: 'Exclusiones declaradas', icono: 'equis', sub: exc.length ? exc.length + (exc.length === 1 ? ' cláusula' : ' cláusulas') : 'ninguna', i: 4, sinRelleno: !!exc.length,
        cuerpo: exc.length ? '<ul class="md2-inds">' + exc.map(function (e) {
          return '<li class="md2-ind sx2-tono-' + (e.total ? 'critico' : 'neutro') + '"><div class="sx2-apilado" style="gap:4px;flex:1;min-width:0"><span class="sx2-flex" style="gap:8px;flex-wrap:wrap;align-items:center"><code class="mj2-cod">' + txt(e.clausula) + '</code><strong>' + txt(e.titulo || '') + '</strong>' +
            U.badge(e.total ? 'Cláusula completa' : 'Parcial', e.total ? 'critico' : 'neutro', true) + '</span><span class="sx2-tenue mj2-fila__txt">' + txt(e.justificacion) + '</span></div>' +
            (puede ? '<span class="mj2-acciones" style="margin:0">' + U.boton({ soloIcono: true, icono: 'editar', sm: true, variante: 'fantasma', titulo: 'Corregir', clase: 'js-si2-exc-editar', datos: { id: e.exclusion_id } }) +
              U.boton({ soloIcono: true, icono: 'basura', sm: true, variante: 'fantasma', titulo: 'Retirar', clase: 'js-si2-exc-retirar', datos: { id: e.exclusion_id } }) + '</span>' : '') + '</li>';
        }).join('') + '</ul>' : '<p class="mj2-ayuda" style="margin:0">Ninguna: todas las cláusulas de la norma se consideran aplicables.</p>' }), silencioso);
  }
  function formAlcance(actual, propuesta, nuevaVersion) {
    var b = actual || propuesta || {};
    paso({ titulo: nuevaVersion ? 'Publicar nueva versión del alcance' : (actual ? 'Corregir el alcance' : 'Declarar el alcance del SGC'), ancho: true, boton: nuevaVersion ? 'Publicar versión' : 'Guardar',
      sub: nuevaVersion ? 'La versión actual se conserva como reemplazada; las exclusiones se copian a la nueva.' : (actual ? 'Para corregir un dato de la versión vigente. Si el alcance cambia de verdad, publica una versión nueva.' : 'Revisa cada campo: esto es lo que se muestra al auditor.'),
      campos: fila2(U.campo('Razón social', input('razon_social', b.razon_social, ' required')), U.campo('Nombre de fantasía', input('nombre_fantasia', b.nombre_fantasia))) +
        fila2(U.campo('RUT', input('rut', b.rut)), U.campo('Vigente desde', input('vigente_desde', String(b.vigente_desde || '').slice(0, 10), ' type="date"'))) +
        U.campo('Declaración de alcance', area('declaracion', b.declaracion, 4, ' required'), 'Qué servicios cubre el SGC y para qué tipo de clientes.') +
        U.campo('Áreas incluidas', area('areas', (b.areas || []).join('\n'), 4, ' required'), 'Una por línea.') +
        U.campo('Ubicaciones', area('ubicaciones', (b.ubicaciones || []).join('\n'), 3), 'Una por línea (las direcciones llevan comas).') +
        fila2(U.campo('Norma', input('norma_codigo', b.norma_codigo || 'ISO 9001', ' required')), U.campo('Edición de la norma', input('norma_version', b.norma_version || '2015', ' required'))) +
        (nuevaVersion ? U.campo('Por qué cambia el alcance', area('justificacion_cambio', '', 3, ' required'), 'Queda como trazabilidad junto a la versión que se reemplaza.') : ''),
      preparar: function (x) {
        if (!x.razon_social || (x.declaracion || '').length < 20) return 'Completa la razón social y la declaración (mínimo 20 caracteres).';
        if (!lineas(x.areas).length) return 'Indica al menos un área.';
        if (nuevaVersion && (x.justificacion_cambio || '').length < 10) return 'Explica por qué cambia el alcance.';
        x.areas = lineas(x.areas); x.ubicaciones = lineas(x.ubicaciones);
        return x;
      },
      enviar: function (x) { return api(nuevaVersion ? 'nuevaVersionAlcanceSgc' : 'guardarAlcanceSgc', x); },
      listo: function () {
        var pend = !actual && propuesta && propuesta.exclusiones ? propuesta.exclusiones.slice() : [];
        if (!pend.length) { cargar(true); return; }
        U.confirmar({ titulo: '¿Declarar también las ' + pend.length + ' exclusiones del DOC-01?', texto: pend.map(function (e) { return e.clausula + ' — ' + e.titulo; }).join(' · ') + '. Quedan con la justificación del manual; puedes editarlas después.', boton: 'Declararlas' })
          .then(function (ok) {
            if (!ok) { cargar(true); return; }
            var i = 0;
            (function sig() { if (i >= pend.length) { cargar(true); return; } api('guardarExclusionSgc', pend[i++]).then(sig, sig); })();
          });
      } });
  }
  function formExclusion(e) {
    var cat = est_.alcance.datos.clausulas_catalogo || [];
    e = e || {};
    paso({ titulo: e.exclusion_id ? 'Corregir exclusión' : 'Declarar exclusión',
      sub: 'Una sub-cláusula (7.1.5.2) excluye solo esa parte; una cláusula completa (8.3) la saca entera de la evaluación.',
      campos: U.campo('Cláusula excluida', '<input class="sx2-input" name="clausula" list="si2-clausulas" required value="' + U.esc(e.clausula || '') + '" placeholder="Ej.: 7.1.5.2, 8.5.1 f u 8.3">') +
        '<datalist id="si2-clausulas">' + cat.map(function (c) { return '<option value="' + U.esc(c.codigo) + '">' + U.esc(c.titulo) + '</option>'; }).join('') + '</datalist>' +
        U.campo('Título de la cláusula', input('titulo', e.titulo)) +
        U.campo('Justificación', area('justificacion', e.justificacion, 4, ' required'), 'Obligatoria: §4.3 exige explicar por qué no aplica.'),
      alMontar: function (form) {
        var cl = form.querySelector('[name=clausula]'), ti = form.querySelector('[name=titulo]');
        cl.addEventListener('change', function () { var c = cat.filter(function (x) { return x.codigo === cl.value.trim(); })[0]; if (c && !ti.value) ti.value = c.titulo; });
      },
      preparar: function (x) { if (!x.clausula) return 'Indica la cláusula.'; return (x.justificacion || '').length >= 15 ? x : 'Justifica la exclusión (mínimo 15 caracteres).'; },
      enviar: function (x) { x.exclusion_id = e.exclusion_id || ''; return api('guardarExclusionSgc', x); } });
  }

  // =========================================================================================
  // Contexto
  // =========================================================================================
  function pintarContexto(silencioso) {
    var d = est_.contexto.datos, puede = !!d.puede_gestionar, r = d.resumen || {}, sub = est_.contexto.sub;
    var seg = U.segmento([{ id: 'foda', texto: 'Análisis de contexto (FODA)', icono: 'rejilla' }, { id: 'partes', texto: 'Partes interesadas', icono: 'equipo' }], sub, 'js-si2-ctx-sub');
    var acciones = puede ? U.boton({ texto: 'Registrar revisión', icono: 'check', variante: 'fantasma', clase: 'js-si2-ctx-revisar' }) +
      U.boton({ texto: sub === 'foda' ? 'Agregar factor' : 'Agregar parte interesada', icono: 'nueva', variante: 'primario', clase: sub === 'foda' ? 'js-si2-factor-nuevo' : 'js-si2-parte-nueva' }) : '';
    var cuerpo;
    if (sub === 'foda') {
      if (!d.factores.length) {
        var pf = d.propuesta_foda || [];
        cuerpo = aviso('alerta', 'alerta', 'El análisis de contexto todavía no está cargado.') + (puede ? U.card({ titulo: 'Propuesta del DOC-02 (Análisis FODA)', icono: 'documento', i: 3, cuerpo:
          '<p class="mj2-ayuda" style="margin:0 0 8px">' + pf.length + ' factores transcritos del documento aprobado. Revísalos antes de cargarlos; después se editan uno a uno.</p>' +
          '<ul class="mj2-hallazgos">' + pf.slice(0, 4).map(function (f) { var t = FODA[f.tipo] || [f.tipo, 'neutro']; return '<li class="mj2-hallazgo sx2-tono-' + t[1] + '"><div class="sx2-flex" style="gap:8px"><code class="mj2-cod">' + txt(String(f.tipo).slice(0, 1) + f.numero) + '</code>' + U.badge(t[0], t[1], true) + '</div><p>' + txt(f.descripcion) + '</p></li>'; }).join('') + '</ul>' +
          (pf.length > 4 ? '<p class="mj2-ayuda">…y ' + (pf.length - 4) + ' más.</p>' : '') +
          '<div class="mj2-acciones">' + U.boton({ texto: 'Cargar los ' + pf.length + ' factores del DOC-02', icono: 'descargar', variante: 'primario', clase: 'js-si2-sembrar-foda' }) + '</div>' })
          : U.card({ i: 3, cuerpo: U.vacio({ icono: 'rejilla', titulo: 'Sin análisis cargado', texto: 'El Encargado del SGC es quien lo carga.' }) }));
      } else {
        var cuad = function (tipo) {
          var t = FODA[tipo], l = d.factores.filter(function (f) { return f.tipo === tipo; });
          return '<section class="sx2-card si2-cuad sx2-tono-' + t[1] + ' sx2-entra"><h2 class="si2-cuad__tit">' + t[0] + ' <span class="sx2-tenue">' + l.length + ' · ' + t[2] + (l.length === 1 ? '' : 's') + '</span></h2><ul class="si2-factores">' +
            (l.length ? l.map(function (f) {
              var sup = f.estado === 'SUPERADO';
              return '<li class="' + (sup ? 'mj2-fila--off' : '') + '"><code class="mj2-cod">' + txt(f.codigo) + '</code><span class="sx2-apilado" style="gap:2px;flex:1;min-width:0"><span>' + txt(f.descripcion) + '</span>' +
                (f.observaciones ? '<small class="sx2-tenue">' + txt(f.observaciones) + '</small>' : '') + (sup ? '<small>' + U.badge('Superado', 'neutro', true) + '</small>' : '') + '</span>' +
                (puede ? '<span class="si2-acc">' + U.boton({ soloIcono: true, icono: 'editar', sm: true, variante: 'fantasma', titulo: 'Editar', clase: 'js-si2-factor-editar', datos: { id: f.factor_id } }) +
                  U.boton({ soloIcono: true, icono: 'basura', sm: true, variante: 'fantasma', titulo: 'Quitar', clase: 'js-si2-factor-quitar', datos: { id: f.factor_id } }) + '</span>' : '') + '</li>';
            }).join('') : '<li class="sx2-tenue">Ninguna registrada.</li>') + '</ul></section>';
        };
        cuerpo = '<div class="si2-foda"><div class="si2-foda__eje">Internos</div>' + cuad('FORTALEZA') + cuad('DEBILIDAD') + '<div class="si2-foda__eje">Externos</div>' + cuad('OPORTUNIDAD') + cuad('AMENAZA') + '</div>';
      }
    } else {
      if (!d.partes.length) {
        var pp = d.propuesta_partes || [];
        cuerpo = aviso('alerta', 'alerta', 'Las partes interesadas todavía no están cargadas.') + (puede ? U.card({ titulo: 'Propuesta del DOC-04', icono: 'documento', i: 3, cuerpo:
          '<p class="mj2-ayuda" style="margin:0 0 8px">' + pp.length + ' partes: ' + txt(pp.map(function (x) { return x.nombre; }).join(' · ')) + '.</p>' +
          '<div class="mj2-acciones">' + U.boton({ texto: 'Cargar las ' + pp.length + ' partes del DOC-04', icono: 'descargar', variante: 'primario', clase: 'js-si2-sembrar-partes' }) + '</div>' })
          : U.card({ i: 3, cuerpo: U.vacio({ icono: 'equipo', titulo: 'Sin partes interesadas', texto: 'El Encargado del SGC es quien las carga.' }) }));
      } else {
        var nivel = function (n) { return n === 'Alto' ? 'critico' : (n === 'Medio' ? 'alerta' : 'neutro'); };
        cuerpo = '<div class="si2-partes">' + d.partes.map(function (p, i) {
          return '<section class="sx2-card si2-parte sx2-entra" style="--i:' + Math.min(i + 3, 12) + '"><div class="sx2-flex" style="gap:8px;align-items:flex-start"><strong style="flex:1">' + txt(p.nombre) + '</strong>' +
            (puede ? U.boton({ soloIcono: true, icono: 'editar', sm: true, variante: 'fantasma', titulo: 'Editar', clase: 'js-si2-parte-editar', datos: { id: p.parte_id } }) + U.boton({ soloIcono: true, icono: 'basura', sm: true, variante: 'fantasma', titulo: 'Quitar', clase: 'js-si2-parte-quitar', datos: { id: p.parte_id } }) : '') + '</div>' +
            '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + (p.categoria ? U.badge(p.categoria, 'neutro', true) : '') + U.badge('Impacto ' + (p.impacto || '—'), nivel(p.impacto)) + U.badge('Influencia ' + (p.influencia || '—'), nivel(p.influencia)) + '</span>' +
            '<dl class="sx2-dato">' + dato('Necesidades', txt(p.necesidades)) + dato('Expectativa', txt(p.expectativa)) + dato('Cómo afecta al SGC', txt(p.efecto_sgc)) +
              dato('Seguimiento', txt([p.metodo_seguimiento, p.frecuencia_seguimiento].filter(Boolean).join(' · '))) + dato('Responsable', persona(p.responsable_email)) + '</dl></section>';
        }).join('') + '</div><p class="mj2-ayuda">El DOC-04 no trae método, frecuencia ni responsable de seguimiento: se pueden completar, pero el sistema no los inventa.</p>';
      }
    }
    var pt = r.por_tipo || {};
    pagina(cabecera(acciones) + avisoRevision(r, d.meses_revision, 'del contexto') + '<div class="sx2-entra" style="--i:1">' + seg + '</div>' +
      (sub === 'foda' && d.factores.length ? '<div class="sx2-fila-kpis">' + ['FORTALEZA', 'DEBILIDAD', 'OPORTUNIDAD', 'AMENAZA'].map(function (k, i) { return U.kpi({ i: i + 2, etiqueta: FODA[k][0], valor: pt[k] || 0, tono: FODA[k][1] }); }).join('') + '</div>' : '') +
      cuerpo, silencioso);
  }
  function formFactor(f) {
    f = f || {};
    paso({ titulo: f.factor_id ? 'Editar ' + f.codigo : 'Agregar factor de contexto',
      campos: U.campo('Tipo', select('tipo', ['FORTALEZA', 'DEBILIDAD', 'OPORTUNIDAD', 'AMENAZA'].map(function (t) { return [t, FODA[t][0].replace(/s$/, '').replace(/de$/, 'd').replace(/Oportunidade$/, 'Oportunidad') + ' (' + FODA[t][2] + ')']; }), f.tipo || 'FORTALEZA')) +
        U.campo('Descripción del factor', area('descripcion', f.descripcion, 3, ' required')) + U.campo('Observaciones', area('observaciones', f.observaciones, 2)) +
        (f.factor_id ? U.campo('Estado', select('estado', [['VIGENTE', 'Vigente'], ['SUPERADO', 'Superado (se conserva, deja de contar)']], f.estado || 'VIGENTE')) : ''),
      preparar: function (x) { return (x.descripcion || '').length >= 5 ? x : 'Describe el factor.'; },
      enviar: function (x) { x.factor_id = f.factor_id || ''; x.estado = x.estado || 'VIGENTE'; return api('guardarFactorContextoSgc', x); } });
  }
  function formParte(p) {
    p = p || {};
    var niv = (est_.contexto.datos.niveles || ['Alto', 'Medio', 'Bajo']).map(function (n) { return [n, n]; });
    paso({ titulo: p.parte_id ? 'Editar parte interesada' : 'Agregar parte interesada', ancho: true,
      campos: fila2(U.campo('Parte interesada', input('nombre', p.nombre, ' required')), U.campo('Categoría', input('categoria', p.categoria, ' placeholder="Interna o externa, por ejemplo"'))) +
        U.campo('Necesidades y requisitos', area('necesidades', p.necesidades, 3, ' required')) + U.campo('Expectativa', area('expectativa', p.expectativa, 2)) + U.campo('Cómo afecta al SGC', area('efecto_sgc', p.efecto_sgc, 2)) +
        fila2(U.campo('Impacto', select('impacto', niv, p.impacto || 'Alto')), U.campo('Nivel de influencia', select('influencia', niv, p.influencia || 'Alto'))) +
        '<h3 class="mj2-sub">Seguimiento (opcional)</h3>' + fila2(U.campo('Método de seguimiento', input('metodo_seguimiento', p.metodo_seguimiento)), U.campo('Frecuencia', input('frecuencia_seguimiento', p.frecuencia_seguimiento))) +
        U.campo('Responsable (correo)', input('responsable_email', p.responsable_email, ' type="email"')),
      preparar: function (x) { if (!x.nombre || !x.necesidades) return 'Completa nombre y necesidades.'; return esCorreo(x.responsable_email) ? x : 'Revisa el correo del responsable.'; },
      enviar: function (x) { x.parte_id = p.parte_id || ''; return api('guardarParteInteresadaSgc', x); } });
  }

  // =========================================================================================
  // Mapa de procesos
  // =========================================================================================
  function pintarProcesos(silencioso) {
    var d = est_.procesos.datos, puede = !!d.puede_gestionar, r = d.resumen || {};
    if (!d.mapa.length) {
      pagina(cabecera() + aviso('alerta', 'alerta', 'El mapa de procesos todavía no está cargado.') + (puede ? U.card({ titulo: 'Propuesta del DOC-03 v02', icono: 'documento', i: 2, cuerpo:
        '<p class="mj2-ayuda" style="margin:0 0 8px">Son los ' + ((d.propuesta || {}).mapa || 0) + ' procesos del mapa (estratégicos, operativos y de apoyo). Los procesos de servicio se cargan aparte, por planilla.</p>' +
        '<div class="mj2-acciones">' + U.boton({ texto: 'Cargar el mapa del DOC-03', icono: 'descargar', variante: 'primario', clase: 'js-si2-sembrar-mapa' }) + '</div>' })
        : U.card({ i: 2, cuerpo: U.vacio({ icono: 'capas', titulo: 'Sin mapa cargado', texto: 'El Encargado del SGC es quien lo carga.' }) })), silencioso);
      return;
    }
    var flujo = d.flujo || {};
    var huerf = d.servicios.filter(function (s) { return !d.mapa.some(function (p) { return p.proceso_id === s.proceso_padre_id; }); });
    var col = function (tipo) {
      var t = TIPO_PROC[tipo], l = d.mapa.filter(function (p) { return p.tipo === tipo; });
      if (!l.length) return '';
      return '<section class="si2-col sx2-tono-' + t[1] + ' sx2-entra"><h2 class="si2-col__tit">Procesos ' + t[0].toLowerCase() + ' <span class="sx2-tenue">' + l.length + '</span></h2>' + l.map(function (p) {
        var hijos = d.servicios.filter(function (s) { return s.proceso_padre_id === p.proceso_id; }).length;
        return '<button type="button" class="si2-proc" data-si2-proc="' + U.esc(p.proceso_id) + '"><span class="sx2-flex" style="gap:6px;align-items:center;flex-wrap:wrap"><code class="mj2-cod">' + txt(p.codigo) + '</code>' +
          (p.responsable_email ? '' : U.badge('Sin responsable', 'alerta', true)) + '</span><strong>' + txt(p.nombre) + '</strong>' +
          '<span class="mj2-meta">' + (p.area ? '<span>' + U.ico('empresa', 12) + txt(p.area) + '</span>' : '') + (hijos ? '<span>' + U.ico('capas', 12) + hijos + ' de servicio</span>' : '') + '</span></button>';
      }).join('') + '</section>';
    };
    pagina(cabecera(puede ? U.boton({ texto: 'Registrar revisión', icono: 'check', variante: 'fantasma', clase: 'js-si2-proc-revisar' }) + U.boton({ texto: 'Agregar proceso', icono: 'nueva', variante: 'primario', clase: 'js-si2-proc-nuevo' }) : '') +
      avisoRevision(r, d.meses_revision, 'del mapa') +
      '<div class="sx2-fila-kpis">' + U.kpi({ i: 0, etiqueta: 'Procesos del mapa', valor: r.total_mapa || 0, icono: 'capas', tono: 'primario' }) + U.kpi({ i: 1, etiqueta: 'De servicio', valor: r.total_servicios || 0, icono: 'caja', tono: 'info' }) +
        U.kpi({ i: 2, etiqueta: 'Pasos definidos', valor: r.total_pasos || 0, icono: 'lista', tono: 'neutro' }) + U.kpi({ i: 3, etiqueta: 'Sin responsable', valor: r.sin_responsable || 0, icono: 'persona', tono: r.sin_responsable ? 'alerta' : 'ok', titulo: '§4.4.2 e) pide asignar responsabilidad y autoridad.' }) + '</div>' +
      (huerf.length ? aviso('critico', 'alerta', huerf.length + ' proceso(s) de servicio no cuelgan de ningún proceso del mapa. Revisa el código del proceso padre en la planilla.') : '') +
      '<div class="si2-mapa"><div class="si2-borde sx2-entra"><span class="si2-borde__tit">' + U.ico('derecha', 14) + txt((flujo.entrada || {}).titulo || 'Entradas') + '</span><span>' + txt(((flujo.entrada || {}).items || []).join(' · ')) + '</span></div>' +
        '<div class="si2-cols">' + col('ESTRATEGICO') + col('OPERATIVO') + col('APOYO') + '</div>' +
        '<div class="si2-borde si2-borde--salida sx2-entra"><span class="si2-borde__tit">' + txt((flujo.salida || {}).titulo || 'Salidas') + U.ico('derecha', 14) + '</span><span>' + txt(((flujo.salida || {}).items || []).join(' · ')) + '</span></div></div>' +
      (flujo.ciclo ? '<p class="mj2-ayuda">' + txt(flujo.ciclo) + '</p>' : ''), silencioso);
  }
  function abrirProceso(id) {
    var dr = U.drawer({ titulo: 'Proceso', cuerpo: U.esqueleto('tabla', 5) });
    dr.el.classList.add('sx2-drawer--ancho');
    api('getDetalleProcesoSgc', { proceso_id: id }).then(function (r) {
      if (!r || !r.ok) { dr.cuerpo(U.vacio({ icono: 'alerta', titulo: 'No se pudo abrir', texto: (r && r.message) || '' })); return; }
      dr.cerrar(true);
      fichaProceso(r.data);
    });
  }
  function fichaProceso(data) {
    var p = data.proceso, puede = !!data.puede_gestionar;
    var bloques = [['Objetivo', p.objetivo], ['Alcance', p.alcance], ['Entradas', p.entradas], ['Actividades', p.actividades], ['Salidas', p.salidas],
      ['Clientes', p.clientes], ['Proveedores', p.proveedores], ['Recursos', p.recursos], ['Documentos', p.documentos]].filter(function (b) { return String(b[1] || '').trim(); });
    var dr = U.drawer({ titulo: p.codigo + ' · ' + p.nombre,
      subtitulo: '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + U.badge(p.tipo_etiqueta || p.tipo, (TIPO_PROC[p.tipo] || [0, 'neutro'])[1]) + U.badge(p.nivel === 'SERVICIO' ? 'Proceso de servicio' : 'Proceso del mapa', 'neutro', true) + '</span>',
      cuerpo: '<dl class="sx2-dato mj2-datos">' + dato('Área', txt(p.area)) + dato('Responsable', p.responsable_email ? persona(p.responsable_email) : U.badge('Sin responsable', 'alerta', true)) + dato('Última revisión', p.fecha_ultima_revision ? txt(fecha(p.fecha_ultima_revision)) : '') + '</dl>' +
        (puede ? '<div class="mj2-acciones">' + U.boton({ texto: 'Editar proceso', icono: 'editar', sm: true, clase: 'js-si2-proc-editar' }) + '</div>' : '') +
        bloques.map(function (b) { return '<div class="fc2-bloque"><h3>' + b[0] + '</h3><p>' + txt(b[1]) + '</p></div>'; }).join('') +
        (data.subprocesos.length ? '<h3 class="mj2-sub">Procesos de servicio (' + data.subprocesos.length + ')</h3><ul class="ge2-lista">' + data.subprocesos.map(function (s) {
          return '<li><button type="button" class="ge2-fila js-si2-subproc" data-id="' + U.esc(s.proceso_id) + '"><code class="mj2-cod">' + txt(s.codigo) + '</code><span style="flex:1">' + txt(s.nombre) + '</span>' + U.ico('derecha', 14) + '</button></li>';
        }).join('') + '</ul>' : '') +
        (data.pasos.length ? '<h3 class="mj2-sub">Pasos (' + data.pasos.length + ')</h3><ol class="mj2-etapas">' + data.pasos.map(function (x) {
          return '<li class="mj2-etapa"><span class="mj2-etapa__num">' + x.numero + '</span><div class="mj2-etapa__cuerpo"><h3>' + txt(x.nombre || 'Paso ' + x.numero) + '</h3><dl class="sx2-dato">' +
            dato('Responsable', txt(x.responsable)) + dato('Input', txt(x.input)) + dato('Actividades', txt(x.actividades)) + dato('Evidencias', txt(x.evidencias)) + dato('Output', txt(x.output)) + '</dl></div></li>';
        }).join('') + '</ol>' : '') +
        (data.riesgos.length ? '<h3 class="mj2-sub">Riesgos y oportunidades del proceso (' + data.riesgos.length + ')</h3><ul class="mj2-hallazgos">' + data.riesgos.map(function (x) {
          var tono = x.clase === 'OPORTUNIDAD' ? 'ok' : (x.banda === 'Crítico' ? 'critico' : 'alerta');
          return '<li class="mj2-hallazgo sx2-tono-' + tono + '"><div class="sx2-flex" style="gap:8px;flex-wrap:wrap"><code class="mj2-cod">' + txt(x.codigo) + '</code><strong>' + txt(x.factor) + '</strong>' + U.badge(x.banda + ' · ' + x.magnitud, tono) + '</div></li>';
        }).join('') + '</ul>' : ''),
      pie: U.boton({ texto: 'Cerrar', clase: 'js-sx2-drawer-cerrar' }) });
    dr.el.classList.add('sx2-drawer--ancho');
    dr.el.addEventListener('click', function (ev) {
      var t = ev.target, b;
      if ((b = t.closest('.js-si2-subproc'))) abrirProceso(b.getAttribute('data-id'));
      else if (t.closest('.js-si2-proc-editar')) formProceso(p, function () { abrirProceso(p.proceso_id); });
    });
  }
  function formProceso(actual, despues) {
    var p = actual || {}, mapa = (est_.procesos.datos && est_.procesos.datos.mapa) || [];
    var padres = [['', 'Ninguno (proceso del mapa)']].concat(mapa.filter(function (m) { return m.proceso_id !== p.proceso_id; }).map(function (m) { return [m.proceso_id, m.codigo + ' — ' + m.nombre]; }));
    paso({ titulo: actual ? 'Editar ' + p.codigo : 'Agregar proceso', ancho: true,
      campos: fila2(U.campo('Nombre', input('nombre', p.nombre, ' required')), U.campo('Código', input('codigo', p.codigo), 'Si lo dejas vacío, el sistema lo asigna.')) +
        fila2(U.campo('Tipo', select('tipo', [['ESTRATEGICO', 'Estratégico'], ['OPERATIVO', 'Operativo'], ['APOYO', 'Apoyo']], p.tipo || 'OPERATIVO')), U.campo('Nivel', select('nivel', [['MAPA', 'Proceso del mapa'], ['SERVICIO', 'Proceso de servicio']], p.nivel || 'MAPA'))) +
        U.campo('Cuelga de', select('proceso_padre_id', padres, p.proceso_padre_id || ''), 'Obligatorio para un proceso de servicio; vacío para uno del mapa.') +
        fila2(U.campo('Área', input('area', p.area)), U.campo('Responsable (correo)', input('responsable_email', p.responsable_email, ' type="email"'), '§4.4.2 e) pide asignar responsabilidad y autoridad.')) +
        U.campo('Objetivo', area('objetivo', p.objetivo, 2)) + U.campo('Alcance', area('alcance', p.alcance, 2)) +
        fila2(U.campo('Entradas', area('entradas', p.entradas, 3)), U.campo('Salidas', area('salidas', p.salidas, 3))) + U.campo('Actividades', area('actividades', p.actividades, 3)) +
        fila2(U.campo('Clientes', input('clientes', p.clientes)), U.campo('Proveedores', input('proveedores', p.proveedores))) +
        fila2(U.campo('Recursos', input('recursos', p.recursos)), U.campo('Documentos', input('documentos', p.documentos))) + U.campo('Observaciones', area('observaciones', p.observaciones, 2)),
      preparar: function (x) {
        if (!x.nombre) return 'Indica el nombre.';
        if (x.nivel === 'SERVICIO' && !x.proceso_padre_id) return 'Un proceso de servicio tiene que colgar de un proceso del mapa.';
        return esCorreo(x.responsable_email) ? x : 'Revisa el correo del responsable.';
      },
      enviar: function (x) { x.proceso_id = p.proceso_id || ''; return api('guardarProcesoSgc', x); },
      listo: function () { cargar(true); if (despues) despues(); } });
  }

  // =========================================================================================
  // Riesgos y oportunidades
  // =========================================================================================
  function registro(id) { var d = est_.riesgos.datos; return [].concat(d.riesgos, d.oportunidades).filter(function (x) { return x.riesgo_id === id; })[0]; }
  function mapaCalor(lista, d) {
    var probs = (d.escala_probabilidad || []).slice().sort(function (a, b) { return a.valor - b.valor; });
    var imps = (d.escala_impacto || []).slice().sort(function (a, b) { return b.valor - a.valor; });
    if (!probs.length || !imps.length) return '';
    var celdas = {};
    lista.forEach(function (x) { var k = Number(x.probabilidad) + '|' + Number(x.impacto); (celdas[k] = celdas[k] || []).push(x); });
    // Mismas bandas que el backend (BANDAS_MAGNITUD de riesgosSgc.js): la celda
    // se pinta con el nivel que tendría un registro en ella.
    var tono = function (p, i) { var m = p * i; return m < 0.5 ? 'neutro' : (m < 2.5 ? 'ok' : (m < 10 ? 'info' : (m < 25 ? 'alerta' : 'critico'))); };
    var opo = est_.riesgos.sub === 'oportunidades';
    return '<div class="sx2-tabla-wrap"><table class="si2-calor"><thead><tr><th class="si2-calor__eje">Impacto ↓ · Probabilidad →</th>' + probs.map(function (p) { return '<th>' + txt(p.etiqueta) + '<small>' + p.valor + '</small></th>'; }).join('') + '</tr></thead><tbody>' +
      imps.map(function (im) {
        return '<tr><th>' + txt(im.etiqueta) + '<small>' + im.valor + '</small></th>' + probs.map(function (p) {
          var l = celdas[Number(p.valor) + '|' + Number(im.valor)] || [];
          var t = tono(p.valor, im.valor);
          if (opo) t = { critico: 'ok', alerta: 'ok', info: 'info', ok: 'neutro', neutro: 'neutro' }[t];
          return '<td class="sx2-tono-' + t + (l.length ? ' si2-calor--con' : '') + '" title="' + U.esc(l.map(function (x) { return x.codigo + ' ' + x.factor; }).join('\n')) + '">' + (l.length ? '<b>' + l.length + '</b><span>' + txt(l.map(function (x) { return x.codigo; }).join(' ')) + '</span>' : '') + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }
  function pintarRiesgos(silencioso) {
    var d = est_.riesgos.datos, puede = !!d.puede_gestionar, r = d.resumen || {}, sub = est_.riesgos.sub;
    if (!d.riesgos.length && !d.oportunidades.length) {
      var p = d.propuesta || {};
      pagina(cabecera() + aviso('alerta', 'alerta', 'La matriz de riesgos y oportunidades todavía no está cargada.') + (puede ? U.card({ titulo: 'Propuesta del DOC-08 v02', icono: 'documento', i: 2, cuerpo:
        '<p class="mj2-ayuda" style="margin:0 0 8px">' + (p.riesgos || 0) + ' riesgos y ' + (p.oportunidades || 0) + ' oportunidades transcritos del documento. Se cargan solo probabilidad e impacto: la magnitud y el nivel los calcula el sistema. Si el contexto ya está cargado, cada riesgo queda enlazado a su factor del FODA.</p>' +
        '<div class="mj2-acciones">' + U.boton({ texto: 'Cargar la matriz del DOC-08', icono: 'descargar', variante: 'primario', clase: 'js-si2-sembrar-riesgos' }) + '</div>' })
        : U.card({ i: 2, cuerpo: U.vacio({ icono: 'alerta', titulo: 'Sin matriz cargada', texto: 'El Encargado del SGC es quien la carga.' }) })), silencioso);
      return;
    }
    var lista = sub === 'oportunidades' ? d.oportunidades : d.riesgos;
    var val = function (v, tono, et) { return v ? '<span class="si2-val"><small>' + et + '</small>' + U.badge(v.banda + ' · ' + v.magnitud, tono) + '</span>' : '<span class="si2-val"><small>' + et + '</small>' + U.badge('Sin valorar', 'neutro', true) + '</span>'; };
    pagina(cabecera(puede ? U.boton({ texto: 'Registrar revisión', icono: 'check', variante: 'fantasma', clase: 'js-si2-rsg-revisar' }) + U.boton({ texto: 'Agregar registro', icono: 'nueva', variante: 'primario', clase: 'js-si2-rsg-nuevo' }) : '') +
      avisoRevision(r, d.meses_revision, 'de la matriz') +
      '<div class="sx2-fila-kpis">' + U.kpi({ i: 0, etiqueta: 'Riesgos', valor: r.total_riesgos || 0, icono: 'alerta', tono: 'primario' }) +
        U.kpi({ i: 1, etiqueta: 'Altos o críticos', valor: r.criticos_o_altos || 0, icono: 'alerta', tono: r.criticos_o_altos ? 'critico' : 'ok', titulo: 'Valoración inherente Alto o Crítico.' }) +
        U.kpi({ i: 2, etiqueta: 'Sin revalorar', valor: r.sin_tratar || 0, icono: 'reloj', tono: r.sin_tratar ? 'alerta' : 'ok', titulo: 'Altos o críticos sin valoración tras controles: una acción sin revalorar no demuestra que se abordó.' }) +
        U.kpi({ i: 3, etiqueta: 'Con actividad', valor: r.con_actividad || 0, icono: 'tareas', tono: 'info', titulo: 'Acciones asignadas como actividad de "Mi trabajo".' }) +
        U.kpi({ i: 4, etiqueta: 'Oportunidades', valor: r.total_oportunidades || 0, icono: 'destello', tono: 'ok' }) + '</div>' +
      '<div class="sx2-entra">' + U.segmento([{ id: 'riesgos', texto: 'Riesgos (' + d.riesgos.length + ')' }, { id: 'oportunidades', texto: 'Oportunidades (' + d.oportunidades.length + ')' }], sub, 'js-si2-rsg-sub') + '</div>' +
      U.card({ titulo: 'Mapa de calor', icono: 'rejilla', sub: 'valoración inherente · ' + lista.length + ' registros', i: 5, cuerpo: mapaCalor(lista, d) +
        (sub === 'oportunidades' ? '<p class="mj2-ayuda">En una oportunidad, una magnitud alta es buena: la revaloración debería subir tras las acciones. El semáforo se lee al revés.</p>' : '') }) +
      '<section class="sx2-card sx2-card--sin-relleno sx2-entra" style="--i:6"><ul class="md2-inds">' + lista.map(function (x) {
        var cambio = x.inherente && x.residual ? (x.mejora ? U.badge(x.favorable ? 'Mejora' : 'Reduce', 'ok', true) : U.badge('Sin cambio', 'neutro', true)) : '';
        return '<li class="md2-ind sx2-tono-' + (x.tono_inherente || 'neutro') + '"><div class="sx2-apilado" style="gap:5px;flex:1;min-width:0">' +
          '<span class="sx2-flex" style="gap:8px;flex-wrap:wrap;align-items:center"><code class="mj2-cod">' + txt(x.codigo) + '</code><strong class="mj2-fila__tit">' + txt(x.factor) + '</strong>' + U.badge(x.origen === 'EXTERNO' ? 'Externo' : 'Interno', 'neutro', true) + cambio + '</span>' +
          '<span class="sx2-tenue mj2-fila__txt">' + txt(x.descripcion) + '</span>' +
          '<span class="sx2-flex" style="gap:14px;flex-wrap:wrap">' + val(x.inherente, x.tono_inherente, 'Inherente') + val(x.residual, x.tono_residual, 'Tras controles') + '</span>' +
          '<span class="mj2-meta">' + (x.factor_contexto ? '<span>' + U.ico('rejilla', 12) + 'Contexto: ' + txt(x.factor_contexto) + '</span>' : '') + (x.accion ? '<span>' + U.ico('rayo', 12) + 'Acción: ' + txt(x.accion) + '</span>' : '') +
            (x.tarea ? '<span>' + U.ico('tareas', 12) + 'En Mi trabajo de ' + txt(PY.persona(x.tarea.responsable_email).nombre) + ' · ' + txt(x.tarea.estado) + '</span>' : '') + '</span></div>' +
          (puede ? '<span class="mj2-acciones" style="margin:0;flex:none">' + (x.accion_actividad_id ? '' : U.boton({ texto: 'Asignar acción', sm: true, clase: 'js-si2-rsg-asignar', datos: { id: x.riesgo_id } })) +
            U.boton({ soloIcono: true, icono: 'editar', sm: true, variante: 'fantasma', titulo: 'Editar', clase: 'js-si2-rsg-editar', datos: { id: x.riesgo_id } }) +
            U.boton({ soloIcono: true, icono: 'basura', sm: true, variante: 'fantasma', titulo: 'Quitar', clase: 'js-si2-rsg-quitar', datos: { id: x.riesgo_id } }) + '</span>' : '') + '</li>';
      }).join('') + '</ul></section>', silencioso);
  }
  function formRiesgo(actual) {
    var d = est_.riesgos.datos, x = actual || {};
    var probs = (d.escala_probabilidad || []).map(function (p) { return [p.valor, p.etiqueta + ' (' + p.valor + ')']; });
    var imps = (d.escala_impacto || []).map(function (i) { return [i.valor, i.etiqueta + ' (' + i.valor + ')']; });
    var fact = [['', 'Sin enlazar']].concat((d.factores_contexto || []).map(function (f) { return [f.factor_id, f.codigo + ' — ' + String(f.descripcion).slice(0, 60)]; }));
    paso({ titulo: actual ? 'Editar ' + x.codigo : 'Agregar riesgo u oportunidad', ancho: true,
      campos: fila2(U.campo('Tipo', select('clase', [['RIESGO', 'Riesgo'], ['OPORTUNIDAD', 'Oportunidad (alto = bueno)']], x.clase || (est_.riesgos.sub === 'oportunidades' ? 'OPORTUNIDAD' : 'RIESGO'))),
          U.campo('Origen', select('origen', [['INTERNO', 'Interno'], ['EXTERNO', 'Externo']], x.origen || 'INTERNO'))) +
        fila2(U.campo('Relación / actividad', input('relacion_actividad', x.relacion_actividad), 'El proceso o área donde ocurre.'), U.campo('Factor', input('factor', x.factor, ' required'), 'Título corto con el que se identifica.')) +
        U.campo('Descripción', area('descripcion', x.descripcion, 3, ' required')) + fila2(U.campo('Análisis de causa', area('analisis_causa', x.analisis_causa, 2)), U.campo('Procedencia', area('procedencia', x.procedencia, 2))) +
        U.campo('Factor del contexto que lo origina', select('factor_contexto_id', fact, x.factor_contexto_id || ''), 'Enlaza con el FODA.') +
        '<h3 class="mj2-sub">Valoración inherente</h3>' + fila2(U.campo('Probabilidad', select('probabilidad', probs, x.probabilidad || 0.5)), U.campo('Impacto', select('impacto', imps, x.impacto || 10))) +
        '<div class="js-si2-magnitud mj2-ayuda"></div>' +
        '<h3 class="mj2-sub">Tratamiento</h3>' + U.campo('Acción', area('accion', x.accion, 2)) +
        fila2(U.campo('Fecha de implementación', input('fecha_implementacion', x.fecha_implementacion), 'Texto libre: "Agosto 2026", "Continuo"…'), U.campo('Medidas de control', area('medidas_control', x.medidas_control, 2))) +
        '<h3 class="mj2-sub">Revaloración tras los controles (opcional)</h3>' +
        fila2(U.campo('Probabilidad residual', select('probabilidad_residual', [['', 'Sin revalorar']].concat(probs), x.probabilidad_residual || '')), U.campo('Impacto residual', select('impacto_residual', [['', 'Sin revalorar']].concat(imps), x.impacto_residual || ''))),
      alMontar: function (form) {
        var pr = form.querySelector('[name=probabilidad]'), im = form.querySelector('[name=impacto]'), out = form.querySelector('.js-si2-magnitud');
        var calc = function () { out.textContent = 'Magnitud inherente: ' + (Math.round(Number(pr.value) * Number(im.value) * 100) / 100) + ' (el nivel lo asigna el sistema).'; };
        pr.addEventListener('change', calc); im.addEventListener('change', calc); calc();
      },
      preparar: function (y) {
        if (!y.factor || (y.descripcion || '').length < 5) return 'Completa factor y descripción.';
        if (!!y.probabilidad_residual !== !!y.impacto_residual) return 'La revaloración lleva las dos: probabilidad e impacto residual.';
        return y;
      },
      enviar: function (y) { y.riesgo_id = x.riesgo_id || ''; return api('guardarRiesgoSgc', y); } });
  }
  function formAsignar(x) {
    paso({ titulo: 'Asignar la acción de ' + x.codigo, boton: 'Crear actividad', sub: txt(x.accion || '') + '<br>Se crea una actividad en "Mi trabajo" del responsable.',
      campos: U.campo('Responsable (correo)', input('responsable_email', x.responsable_email, ' type="email" required')) +
        U.campo('Fecha comprometida', input('fecha_compromiso', '', ' type="date" required min="' + PY.hoyClave() + '"'), x.fecha_implementacion ? 'El DOC-08 dice: ' + x.fecha_implementacion : ''),
      preparar: function (y) { if (!y.responsable_email || !esCorreo(y.responsable_email)) return 'Indica el correo del responsable.'; return y.fecha_compromiso ? y : 'Indica la fecha.'; },
      enviar: function (y) { y.riesgo_id = x.riesgo_id; return api('asignarAccionRiesgoSgc', y); } });
  }

  // =========================================================================================
  // Cobertura ISO
  // =========================================================================================
  function pintarCobertura(silencioso) {
    var d = est_.cobertura.datos, r = d.resumen || {}, f = est_.cobertura.filtro;
    var cl = d.clausulas || [];
    var grupos = {};
    cl.forEach(function (c) { var cap = String(c.codigo).split('.')[0]; (grupos[cap] = grupos[cap] || []).push(c); });
    var kpi = function (i, k, n) { return U.kpi({ i: i, etiqueta: COB[k][0], valor: n || 0, tono: COB[k][1], filtro: k, activo: f === k }); };
    pagina(cabecera() +
      '<div class="si2-cob-cab sx2-entra">' + U.anillo(r.pct_listo || 0, { tam: 96, grosor: 10, tono: (r.pct_listo || 0) >= 80 ? 'ok' : ((r.pct_listo || 0) >= 50 ? 'alerta' : 'critico') }) +
        '<div class="sx2-apilado" style="gap:4px"><strong style="font-size:1.125rem">Listos (estimado): ' + (r.pct_listo || 0) + ' %</strong><span class="sx2-tenue" style="font-size:.8125rem">Sobre ' + (r.aplicables || 0) + ' cláusulas aplicables de ' + (r.total || 0) + '. Indicador interno de gestión, no un porcentaje oficial de certificación.</span></div></div>' +
      '<div class="sx2-fila-kpis">' + kpi(0, 'COMPLETO', r.completo) + kpi(1, 'PARCIAL', r.parcial) + kpi(2, 'FALTANTE', r.faltante) + kpi(3, 'NO_APLICA', r.no_aplica) + '</div>' +
      Object.keys(grupos).sort(function (a, b) { return a - b; }).map(function (cap, i) {
        var l = grupos[cap].filter(function (c) { return !f || c.estado === f; });
        if (!l.length) return '';
        return U.card({ titulo: cap + '. ' + (CAPITULOS[cap] || ''), icono: 'escudo', sub: grupos[cap].filter(function (c) { return c.estado === 'COMPLETO'; }).length + ' de ' + grupos[cap].length + ' completas', i: i + 4, sinRelleno: true,
          cuerpo: '<ul class="mj2-lista">' + l.map(function (c) {
            var e = COB[c.estado] || [c.estado, 'neutro'];
            return '<li class="mj2-fila mj2-fila--marca sx2-tono-' + e[1] + '" data-si2-clausula="' + U.esc(c.codigo) + '" tabindex="0"><span class="sx2-apilado" style="gap:4px;min-width:0;flex:1">' +
              '<span class="sx2-flex" style="gap:8px;flex-wrap:wrap;align-items:center"><code class="mj2-cod">' + txt(c.codigo) + '</code><strong class="mj2-fila__tit">' + txt(c.titulo) + '</strong>' + U.badge(e[0], e[1]) + '</span>' +
              '<span class="sx2-tenue mj2-fila__txt">' + txt(c.resumen) + (c.exclusiones && c.estado !== 'NO_APLICA' ? ' · ' + c.exclusiones + ' exclusión(es) parcial(es)' : '') + '</span></span>' + U.ico('derecha', 16) + '</li>';
          }).join('') + '</ul>' });
      }).join('') + (f ? '<div class="mj2-acciones">' + U.chip({ texto: 'Ver todas las cláusulas', icono: 'equis', clase: 'js-si2-cob-todas' }) + '</div>' : ''), silencioso);
  }
  function abrirClausula(codigo) {
    var dr = U.drawer({ titulo: 'Cláusula ' + codigo, cuerpo: U.esqueleto('tabla', 4) });
    dr.el.classList.add('sx2-drawer--ancho');
    api('getDetalleClausulaCoberturaSgc', { codigo: codigo }).then(function (r) {
      if (!r || !r.ok) { dr.cuerpo(U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || '' })); return; }
      var c = r.data, e = COB[c.estado] || [c.estado, 'neutro'];
      dr.cerrar(true);
      var d2 = U.drawer({ titulo: c.codigo + ' · ' + c.titulo, subtitulo: U.badge(e[0], e[1]),
        cuerpo: '<p class="mj2-desc">' + txt(c.resumen) + '</p>' + (c.nota ? aviso('alerta', 'info', txt(c.nota)) : '') +
          ((c.evidencia || []).length ? '<h3 class="mj2-sub">Evidencia (' + c.evidencia.length + ')</h3><div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr><th>Tipo</th><th>Descripción</th><th>Fecha</th><th>Responsable</th></tr></thead><tbody>' +
            c.evidencia.map(function (x) { return '<tr><td>' + U.badge(x.tipo, 'info', true) + '</td><td>' + txt(x.descripcion) + '</td><td style="white-space:nowrap">' + txt(x.fecha ? fecha(x.fecha) : '—') + '</td><td>' + txt(x.responsable ? PY.persona(x.responsable).nombre : '—') + '</td></tr>'; }).join('') + '</tbody></table></div>'
            : U.vacio({ icono: 'documento', titulo: 'Sin evidencia registrada', texto: '' })),
        pie: U.boton({ texto: 'Cerrar', clase: 'js-sx2-drawer-cerrar' }) + U.boton({ texto: 'Descargar evidencia (PDF)', icono: 'descargar', variante: 'primario', clase: 'js-si2-evidencia' }) });
      d2.el.classList.add('sx2-drawer--ancho');
      d2.el.querySelector('.js-si2-evidencia').addEventListener('click', function (ev) {
        var b = ev.currentTarget; b.disabled = true;
        api('descargarEvidenciaClausulaSgc', { codigo: c.codigo }).then(function (res) {
          b.disabled = false;
          if (!res || !res.ok) { PY.aviso((res && res.message) || 'No se pudo generar el PDF.', 'error'); return; }
          PY.descargarBase64(res.data.pdf_base64, res.data.filename || 'evidencia.pdf', 'application/pdf');
        });
      });
    });
  }

  // --- Eventos -------------------------------------------------------------------------------
  function mio() { var c = document.getElementById('calidad-v2'); return !!c && !!VISTAS[c.getAttribute('data-vista')]; }
  document.addEventListener('click', function (ev) {
    var raiz = document.getElementById('calidad-v2');
    if (!raiz || !raiz.contains(ev.target) || !mio()) return;
    var t = ev.target, b, d = est_[vista_] && est_[vista_].datos;
    if (t.closest('.js-si2-recargar')) { cargar(true); return; }
    if (!d) return;
    // Alcance
    if (t.closest('.js-si2-declarar')) { formAlcance(null, d.propuesta, false); return; }
    if (t.closest('.js-si2-corregir')) { formAlcance(d.alcance, null, false); return; }
    if (t.closest('.js-si2-version')) { formAlcance(d.alcance, null, true); return; }
    if (t.closest('.js-si2-exc-nueva')) { formExclusion(null); return; }
    if ((b = t.closest('.js-si2-exc-editar'))) { formExclusion((d.exclusiones || []).filter(function (e) { return e.exclusion_id === b.getAttribute('data-id'); })[0]); return; }
    if ((b = t.closest('.js-si2-exc-retirar'))) {
      var ex = (d.exclusiones || []).filter(function (e) { return e.exclusion_id === b.getAttribute('data-id'); })[0];
      confirmarY({ titulo: '¿Retirar la exclusión de ' + ex.clausula + '?', texto: 'La cláusula vuelve a considerarse aplicable y se evalúa en la cobertura.', boton: 'Retirar', peligro: true }, 'anularExclusionSgc', { exclusion_id: ex.exclusion_id }, 'Exclusión retirada.');
      return;
    }
    // Contexto
    if ((b = t.closest('.js-si2-ctx-sub'))) { est_.contexto.sub = b.getAttribute('data-id'); pintar(true); return; }
    if (t.closest('.js-si2-sembrar-foda')) { accion('sembrarFodaSgc', {}, 'Contexto cargado.'); return; }
    if (t.closest('.js-si2-sembrar-partes')) { accion('sembrarPartesSgc', {}, 'Partes cargadas.'); return; }
    if (t.closest('.js-si2-ctx-revisar')) { confirmarY({ titulo: '¿Registrar la revisión del contexto?', texto: 'Deja constancia de que hoy se revisaron los factores y las partes interesadas, aunque no cambie nada.', boton: 'Registrar' }, 'registrarRevisionContextoSgc', {}, 'Revisión registrada.'); return; }
    if (t.closest('.js-si2-factor-nuevo')) { formFactor(null); return; }
    if ((b = t.closest('.js-si2-factor-editar'))) { formFactor(d.factores.filter(function (f) { return f.factor_id === b.getAttribute('data-id'); })[0]); return; }
    if ((b = t.closest('.js-si2-factor-quitar'))) {
      var fa = d.factores.filter(function (f) { return f.factor_id === b.getAttribute('data-id'); })[0];
      confirmarY({ titulo: '¿Quitar ' + fa.codigo + ' del análisis?', texto: 'Si dejó de aplicar pero quieres conservarlo, edítalo y márcalo como superado.', boton: 'Quitar', peligro: true }, 'anularFactorContextoSgc', { factor_id: fa.factor_id }, 'Factor quitado.');
      return;
    }
    if (t.closest('.js-si2-parte-nueva')) { formParte(null); return; }
    if ((b = t.closest('.js-si2-parte-editar'))) { formParte(d.partes.filter(function (p) { return p.parte_id === b.getAttribute('data-id'); })[0]); return; }
    if ((b = t.closest('.js-si2-parte-quitar'))) {
      var pa = d.partes.filter(function (p) { return p.parte_id === b.getAttribute('data-id'); })[0];
      confirmarY({ titulo: '¿Quitar a ' + pa.nombre + '?', texto: 'Deja de figurar entre las partes interesadas.', boton: 'Quitar', peligro: true }, 'anularParteInteresadaSgc', { parte_id: pa.parte_id }, 'Parte quitada.');
      return;
    }
    // Procesos
    if (t.closest('.js-si2-sembrar-mapa')) { accion('sembrarMapaProcesosSgc', {}, 'Mapa cargado.'); return; }
    if (t.closest('.js-si2-proc-revisar')) { confirmarY({ titulo: '¿Registrar la revisión del mapa?', texto: 'Deja constancia de que hoy se revisaron los procesos, aunque no cambie nada.', boton: 'Registrar' }, 'registrarRevisionProcesosSgc', {}, 'Revisión registrada.'); return; }
    if (t.closest('.js-si2-proc-nuevo')) { formProceso(null); return; }
    if ((b = t.closest('[data-si2-proc]'))) { abrirProceso(b.getAttribute('data-si2-proc')); return; }
    // Riesgos
    if ((b = t.closest('.js-si2-rsg-sub'))) { est_.riesgos.sub = b.getAttribute('data-id'); pintar(true); return; }
    if (t.closest('.js-si2-sembrar-riesgos')) { accion('sembrarRiesgosSgc', {}, 'Matriz cargada.'); return; }
    if (t.closest('.js-si2-rsg-revisar')) { confirmarY({ titulo: '¿Registrar la revisión de la matriz?', texto: 'Deja constancia de que hoy se revisaron los riesgos y oportunidades, aunque no cambie nada.', boton: 'Registrar' }, 'registrarRevisionRiesgosSgc', {}, 'Revisión registrada.'); return; }
    if (t.closest('.js-si2-rsg-nuevo')) { formRiesgo(null); return; }
    if ((b = t.closest('.js-si2-rsg-editar'))) { formRiesgo(registro(b.getAttribute('data-id'))); return; }
    if ((b = t.closest('.js-si2-rsg-asignar'))) { formAsignar(registro(b.getAttribute('data-id'))); return; }
    if ((b = t.closest('.js-si2-rsg-quitar'))) {
      var rg = registro(b.getAttribute('data-id'));
      confirmarY({ titulo: '¿Quitar ' + rg.codigo + ' de la matriz?', texto: 'Deja de contar en la evaluación de 6.1. La actividad asignada, si la hay, no se toca.', boton: 'Quitar', peligro: true }, 'anularRiesgoSgc', { riesgo_id: rg.riesgo_id }, 'Registro quitado.');
      return;
    }
    // Cobertura
    if ((b = t.closest('.sx2-kpi--clic')) && vista_ === 'cobertura') { var f = b.getAttribute('data-filtro'); est_.cobertura.filtro = est_.cobertura.filtro === f ? '' : f; pintar(true); return; }
    if (t.closest('.js-si2-cob-todas')) { est_.cobertura.filtro = ''; pintar(true); return; }
    if ((b = t.closest('[data-si2-clausula]'))) abrirClausula(b.getAttribute('data-si2-clausula'));
  });
  document.addEventListener('keydown', function (ev) {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('#calidad-v2 [data-si2-clausula]')) { ev.preventDefault(); ev.target.click(); }
  });

  window.SigsoCalidadSistemaV2 = {
    mostrar: function (v) { vista_ = v; cargar(!!est_[v].datos && C().ocupa(v)); },
    vistas: Object.keys(VISTAS)
  };
})();
