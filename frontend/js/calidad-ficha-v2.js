/**
 * calidad-ficha-v2.js — Calidad: ficha de la persona y Capacitaciones 100 %
 * v2 (SIGSO v2, R8b del retiro de la versión clásica; ver
 * documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 *  - Ficha (PRO-02): cabecera con la persona y sus alertas, y cinco
 *    pestañas: Datos, Descriptor de cargo (versiones, archivo, criterios de
 *    evaluación), Documentos (CV, título, contrato…), Inducción y
 *    Competencias (horas del año contra la meta, evaluación con escala e
 *    historial). Todo se edita en formularios v2.
 *  - Capacitaciones (Objetivo de Calidad N°4): programa del año, registrar
 *    realización con asistentes, eficacia a los 60 días por persona y horas
 *    de formación de cada uno contra la meta.
 * Mismos endpoints que calidad.js; el backend decide qué ficha ve cada quien
 * (el personal operativo, solo la suya).
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  function C() { return window.SigsoCalidadV2.util; }
  function api(a, d) { return C().api(a, d); }

  var TIPO_PERSONA = { INT: 'Interno', EXT: 'Externo' };
  var TIPO_DOC = { CV: 'CV', TITULO: 'Título / diploma', ISO9001: 'Curso ISO 9001', CONTRATO: 'Contrato o anexo', CERTIFICADO: 'Certificado de capacitación', OTRO: 'Otro' };
  var PESTANAS = [
    { id: 'datos', texto: 'Datos', icono: 'persona' }, { id: 'descriptor', texto: 'Descriptor de cargo', icono: 'portapapeles' },
    { id: 'documentos', texto: 'Documentos', icono: 'documento' }, { id: 'induccion', texto: 'Inducción', icono: 'tareas' },
    { id: 'competencias', texto: 'Competencias', icono: 'diana' }
  ];
  var ACEPTA = '.pdf,.doc,.docx,.xls,.xlsx';

  var ficha_ = { id: null, datos: null, tab: 'datos', sinListado: false }, turno_ = 0;
  var cap_ = { datos: null, q: '' };

  function fecha(v) { if (!v) return '—'; var s = String(v); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? PY.fecha(s, true) : (C().fechaChile(s) || PY.fecha(s, true)); }
  function iso(v) { var m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : ''; }
  function si(v) { return v === true || v === 'TRUE' || v === 'true'; }
  function lineas(t) { return String(t || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); }
  function esCorreo(t) { return !t || /^[^\s@]+@[^\s@]+$/.test(String(t).trim()); }
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function persona(email) {
    if (!email) return '<span class="sx2-tenue">—</span>';
    var p = PY.persona(email);
    return '<span class="sx2-flex" style="gap:6px;align-items:center;min-width:0">' + U.avatar(p, 'xs') + '<span class="sx2-cortar">' + U.esc(p.nombre) + '</span></span>';
  }
  function dato(et, v) { return '<dt>' + U.esc(et) + '</dt><dd>' + (v || '<span class="sx2-tenue">—</span>') + '</dd>'; }
  function ayuda(t) { return '<p class="mj2-ayuda">' + t + '</p>'; }
  function aviso(tono, icono, texto) { return '<div class="mj2-aviso sx2-tono-' + tono + ' sx2-entra">' + U.ico(icono, 16) + '<span>' + texto + '</span></div>'; }
  function archivoCampo(nombre, etiqueta, ayudaTxt, requerido) {
    return U.campo(etiqueta, '<input class="sx2-input" type="file" name="' + nombre + '" accept="' + ACEPTA + '"' + (requerido ? ' required' : '') + '>', ayudaTxt || 'PDF, Word o Excel · máx. 10 MB.');
  }
  function leerArchivo(form, nombre) {
    var f = form.querySelector('[name="' + nombre + '"]').files[0];
    if (!f) return Promise.resolve(null);
    if (f.size > 10 * 1024 * 1024) return Promise.reject(new Error('El archivo pesa más de 10 MB.'));
    return U.leerBase64(f).then(function (b64) { return { b64: b64, nombre: f.name }; });
  }
  // Formulario que termina reabriendo la ficha.
  function paso(o) {
    U.formulario({
      titulo: o.titulo, subtitulo: o.sub ? '<span class="sx2-tenue" style="font-size:.8125rem">' + o.sub + '</span>' : '', boton: o.boton || 'Guardar', ocupado: o.ocupado,
      campos: o.campos, ancho: o.ancho, alMontar: o.alMontar, preparar: o.preparar,
      enviar: function (x, form) { return Promise.resolve(o.enviar(x, form)).catch(function (e) { return { ok: false, message: C().errorSubida(e) }; }); },
      aviso: o.aviso, listo: o.listo || function () { recargarFicha(); }
    });
  }
  function accionSimple(accion, datos, exito, despues) {
    return api(accion, datos).then(function (r) {
      if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo aplicar.', 'error'); return; }
      if (exito) PY.aviso(exito, 'exito');
      (despues || recargarFicha)();
    });
  }

  // =========================================================================================
  // Ficha
  // =========================================================================================
  function abrir(id, sinListado) {
    if (ficha_.id !== id) { ficha_.datos = null; ficha_.tab = 'datos'; }
    ficha_.id = id;
    ficha_.sinListado = !!sinListado;
    var c = C().contenedor('ficha');
    if (!c) return;
    window.scrollTo(0, 0);
    cargarFicha(false);
  }
  function recargarFicha() { if (C().ocupa('ficha')) cargarFicha(true); }
  function cargarFicha(silencioso) {
    var id = ficha_.id, t = ++turno_;
    var c = C().contenedor('ficha');
    if (!silencioso || !ficha_.datos) c.innerHTML = '<div class="sx2-pagina"><div class="sx2-card sx2-entra">' + U.esqueleto('tabla', 4) + '</div>' + U.esqueleto('tarjetas', 2) + '</div>';
    api('getFichaPersonaSgc', { persona_id: id }).then(function (r) {
      if (t !== turno_ || id !== ficha_.id || !C().ocupa('ficha')) return;
      if (!r || !r.ok) {
        c.innerHTML = '<div class="sx2-pagina">' + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo abrir la ficha', texto: (r && r.message) || '',
          accion: ficha_.sinListado ? '' : U.boton({ texto: 'Volver a Personal', icono: 'izquierda', clase: 'js-fc2-volver' }) }) }) + '</div>';
        return;
      }
      ficha_.datos = r.data;
      pintarFicha(!!silencioso);
      var d = r.data, p = d.persona || {};
      var cs = [p.usuario_email, p.jefatura_email, p.subrogante_email].concat((d.evaluaciones || []).map(function (e) { return e.evaluador_email; }), (d.induccion || []).map(function (i) { return i.relator_email; })).filter(Boolean);
      Promise.all([window.SigsoDirectorio ? SigsoDirectorio.resolver(cs) : Promise.resolve(), U.precargarFotos(cs)]).then(function () { if (t === turno_) pintarFicha(true); });
    });
  }
  function pintarFicha(silencioso) {
    var c = document.getElementById('calidad-v2');
    if (!c || !C().ocupa('ficha') || !ficha_.datos) return;
    var d = ficha_.datos, p = d.persona, baja = p.estado === 'DESVINCULADO', y = window.scrollY;
    var ind = d.induccion || [], hechas = ind.filter(function (i) { return i.estado === 'COMPLETADA'; }).length;
    var cumpleHoras = d.horas_formacion_anio >= d.meta_horas_formacion;
    var chips = '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + U.badge(TIPO_PERSONA[p.tipo] || p.tipo || '—', 'neutro', true) + (baja ? U.badge('Desvinculado', 'critico') : '') +
      (ind.length ? U.badge('Inducción ' + hechas + '/' + ind.length, hechas === ind.length ? 'ok' : 'alerta') : '') +
      (d.descriptor_vigente ? U.badge('Descriptor ' + d.descriptor_vigente.version, 'ok') : U.badge('Sin descriptor', 'alerta')) +
      (d.ultima_evaluacion ? (d.evaluacion_vencida ? U.badge('Evaluación vencida', 'critico') : U.badge('Evaluado', 'ok')) : U.badge('Sin evaluación', 'alerta')) +
      U.badge(d.horas_formacion_anio + ' de ' + d.meta_horas_formacion + ' h de formación', cumpleHoras ? 'ok' : 'alerta') + '</span>';
    var per = PY.persona(p.usuario_email, p.nombre);
    var cuerpo = ficha_.tab === 'descriptor' ? tabDescriptor(d) : (ficha_.tab === 'documentos' ? tabDocumentos(d) : (ficha_.tab === 'induccion' ? tabInduccion(d) : (ficha_.tab === 'competencias' ? tabCompetencias(d) : tabDatos(d))));
    c.innerHTML = '<div class="sx2-pagina">' +
      '<header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Calidad · Personas' + (ficha_.sinListado ? '' : ' · <button type="button" class="sx2-enlace js-fc2-volver">Personal</button>') + '</span>' +
        '<div class="fc2-cab">' + U.avatar(per, 'lg') + '<div class="sx2-apilado" style="gap:6px;min-width:0"><h1>' + U.esc(p.nombre) + '</h1>' +
        '<span class="sx2-tenue" style="font-size:.875rem">' + U.esc([p.cargo, p.area_id].filter(Boolean).join(' · ') || 'Sin cargo registrado') + '</span>' + chips + '</div></div></div>' +
        '<div class="sx2-cabecera__acciones">' + (ficha_.sinListado ? '' : U.boton({ texto: 'Personal', icono: 'izquierda', variante: 'fantasma', clase: 'js-fc2-volver' })) + U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-fc2-recargar' }) + '</div></header>' +
      (baja ? aviso('alerta', 'info', 'Esta persona ya no está vigente. Su ficha se conserva como historial del SGC.') : '') +
      '<div class="sx2-tabs fc2-tabs sx2-entra" role="tablist" style="--i:1">' + PESTANAS.map(function (t) {
        return '<button type="button" role="tab" class="sx2-tabs__op js-fc2-tab" data-tab="' + t.id + '" aria-selected="' + (t.id === ficha_.tab ? 'true' : 'false') + '">' + U.ico(t.icono, 15) + U.esc(t.texto) + '</button>';
      }).join('') + '</div>' + cuerpo + '</div>';
    if (silencioso) { c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; }); window.scrollTo(0, y); }
    U.animar(c);
  }

  function tabDatos(d) {
    var p = d.persona, puede = d.puede_gestionar === true;
    return '<div class="sx2-grid sx2-grid--estira">' +
      '<div class="sx2-col-6">' + U.card({ titulo: 'Información laboral', icono: 'empresa', i: 2, cuerpo: '<dl class="sx2-dato">' + dato('Tipo', U.esc(TIPO_PERSONA[p.tipo] || p.tipo || '')) + dato('Cargo', U.esc(p.cargo || '')) +
        dato('Área', U.esc(p.area_id || '')) + dato('Fecha de ingreso', p.fecha_ingreso ? U.esc(fecha(p.fecha_ingreso)) : '') + (p.estado === 'DESVINCULADO' ? dato('Desvinculación', U.esc(fecha(p.fecha_desvinculacion))) : '') + '</dl>' }) + '</div>' +
      '<div class="sx2-col-6">' + U.card({ titulo: 'Contacto y jefatura', icono: 'equipo', i: 3, cuerpo: '<dl class="sx2-dato">' + dato('Correo', U.esc(p.usuario_email || '')) + dato('RUT', U.esc(p.rut || '')) +
        dato('Jefatura directa', p.jefatura_email ? persona(p.jefatura_email) : '') + dato('Subrogante', p.subrogante_email ? persona(p.subrogante_email) : '') + '</dl>' }) + '</div></div>' +
      (puede ? '<div class="mj2-acciones sx2-entra">' + U.boton({ texto: 'Editar datos', icono: 'editar', clase: 'js-fc2-editar' }) +
        (p.estado === 'DESVINCULADO' ? U.boton({ texto: 'Reactivar', icono: 'check', clase: 'js-fc2-reactivar' }) : U.boton({ texto: 'Desvincular', icono: 'salir', variante: 'texto-peligro', clase: 'js-fc2-desvincular' })) +
        U.boton({ texto: 'Quitar del alcance del SGC', icono: 'equis', variante: 'fantasma', clase: 'js-fc2-alcance' }) + '</div>' : '');
  }

  function tabDescriptor(d) {
    var v = d.descriptor_vigente, puede = d.puede_gestionar === true;
    var gestion = puede ? (v ? U.boton({ texto: 'Corregir versión vigente', icono: 'editar', variante: 'fantasma', clase: 'js-fc2-desc-editar' }) : '') +
      U.boton({ texto: v ? 'Nueva versión' : 'Crear descriptor', icono: 'nueva', variante: v ? 'secundario' : 'primario', clase: 'js-fc2-desc-nuevo' }) : '';
    if (!v) return U.card({ i: 2, cuerpo: U.vacio({ icono: 'portapapeles', titulo: 'Todavía no tiene descriptor de cargo', texto: 'El descriptor (FO-PRO-02-01) define qué se espera del cargo: es la base para evaluar competencia.', accion: gestion }) });
    var largo = function (t, x) { return x ? '<div class="fc2-bloque"><h3>' + U.esc(t) + '</h3><p>' + U.esc(x) + '</p></div>' : ''; };
    var items = function (t, l) { return l && l.length ? '<div class="fc2-bloque"><h3>' + U.esc(t) + '</h3><ol class="mj2-porques">' + l.map(function (x) { return '<li>' + U.esc(x) + '</li>'; }).join('') + '</ol></div>' : ''; };
    var anteriores = (d.descriptores || []).filter(function (x) { return !si(x.vigente); });
    return '<div class="sx2-grid sx2-grid--estira"><div class="sx2-col-8">' +
      U.card({ titulo: 'Descriptor ' + v.version, icono: 'portapapeles', sub: 'vigente · ' + fecha(v.fecha), i: 2, cuerpo:
        (v.archivo_id ? '<div class="mj2-acciones" style="margin:0 0 12px">' + (v.archivo_mime === 'application/pdf' ? U.boton({ texto: 'Ver', icono: 'ojo', sm: true, clase: 'js-fc2-desc-ver' }) : '') +
          U.boton({ texto: 'Descargar archivo', icono: 'descargar', sm: true, variante: 'fantasma', clase: 'js-fc2-desc-bajar' }) + '</div>' : '') +
        largo('Objetivo del cargo', v.objetivo) + largo('Funciones', v.funciones) + largo('Responsabilidades', v.responsabilidades) + largo('Habilidades requeridas', v.habilidades) +
        '<dl class="sx2-dato">' + dato('Nivel educacional', U.esc(v.nivel_educacional || '')) + dato('Formación técnica', U.esc(v.formacion_tecnica || '')) + dato('Experiencia requerida', U.esc(v.experiencia || '')) + '</dl>' +
        (gestion ? '<div class="mj2-acciones">' + gestion + '</div>' : '') }) + '</div>' +
      '<div class="sx2-col-4">' + U.card({ titulo: 'Cómo se evalúa este cargo', icono: 'diana', i: 3, cuerpo:
        ((v.items_responsabilidades || []).length || (v.items_habilidades || []).length ? items('Funciones a evaluar', v.items_responsabilidades) + items('Habilidades a evaluar', v.items_habilidades)
          : aviso('alerta', 'alerta', 'Faltan las funciones y habilidades como lista: sin ellas no se puede evaluar.')) }) +
      (anteriores.length ? U.card({ titulo: 'Versiones anteriores', icono: 'capas', i: 4, cuerpo: '<ul class="fc2-versiones">' + anteriores.map(function (x) { return '<li><code class="mj2-cod">' + U.esc(x.version) + '</code>' + U.badge('Archivada', 'neutro', true) + '<span class="sx2-tenue">' + U.esc(fecha(x.fecha)) + '</span></li>'; }).join('') + '</ul>' }) : '') +
      '</div></div>';
  }

  function tabDocumentos(d) {
    var docs = d.documentos || [], puede = d.puede_gestionar === true;
    return U.card({ titulo: 'Documentos', icono: 'documento', sub: docs.length + (docs.length === 1 ? ' archivo' : ' archivos'), i: 2, accion: puede ? { texto: 'Cargar documento', clase: 'js-fc2-doc-nuevo' } : null, sinRelleno: !!docs.length,
      cuerpo: docs.length ? '<ul class="fc2-docs">' + docs.map(function (x) {
        return '<li><span class="fc2-docs__ico">' + U.ico('documento', 16) + '</span><span class="sx2-apilado" style="gap:2px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(x.nombre || x.archivo_nombre) + '</strong>' +
          '<span class="sx2-flex" style="gap:6px;align-items:center">' + U.badge(TIPO_DOC[x.tipo] || x.tipo, 'info', true) + '<small class="sx2-tenue">' + U.esc(fecha(x.fecha)) + '</small></span></span>' +
          '<span class="mj2-acciones" style="margin:0">' + (x.archivo_mime === 'application/pdf' ? U.boton({ texto: 'Ver', icono: 'ojo', sm: true, clase: 'js-fc2-doc-ver', datos: { id: x.doc_id } }) : '') +
            U.boton({ soloIcono: true, icono: 'descargar', sm: true, variante: 'fantasma', titulo: 'Descargar', clase: 'js-fc2-doc-bajar', datos: { id: x.doc_id } }) +
            (d.puede_reemplazar_archivo ? U.boton({ soloIcono: true, icono: 'subir', sm: true, variante: 'fantasma', titulo: 'Reemplazar archivo', clase: 'js-fc2-doc-reemplazar', datos: { id: x.doc_id } }) : '') +
            (puede ? U.boton({ soloIcono: true, icono: 'basura', sm: true, variante: 'fantasma', titulo: 'Quitar', clase: 'js-fc2-doc-quitar', datos: { id: x.doc_id } }) : '') + '</span></li>';
      }).join('') + '</ul>' : U.vacio({ icono: 'documento', titulo: 'Sin documentos cargados', texto: 'CV, título, contrato, certificados.' }) });
  }

  function tabInduccion(d) {
    var items = d.induccion || [], hechas = items.filter(function (i) { return i.estado === 'COMPLETADA'; }).length;
    if (!items.length) return U.card({ i: 2, cuerpo: U.vacio({ icono: 'tareas', titulo: 'Sin registro de inducción', texto: '' }) });
    return U.card({ titulo: 'Inducción al SGC', icono: 'tareas', sub: 'FO-PRO-02-02 · ' + hechas + ' de ' + items.length, i: 2, cuerpo:
      U.barra(hechas * 100 / items.length, hechas === items.length ? 'ok' : 'alerta') +
      '<ul class="fc2-induccion">' + items.map(function (i) {
        var hecha = i.estado === 'COMPLETADA';
        return '<li class="' + (hecha ? 'fc2-ok' : '') + '"><span class="fc2-check">' + U.ico(hecha ? 'check' : 'reloj', 14) + '</span><span class="sx2-apilado" style="gap:2px;flex:1;min-width:0"><strong>' + U.esc(i.item) + '</strong>' +
          (hecha ? '<small class="sx2-tenue">' + U.esc(fecha(i.fecha)) + (i.relator_email ? ' · relator ' + U.esc(PY.persona(i.relator_email).nombre) : '') + '</small>' : '<small class="sx2-tenue">Pendiente</small>') + '</span>' +
          (d.puede_gestionar_induccion && !hecha ? U.boton({ texto: 'Registrar', icono: 'check', sm: true, clase: 'js-fc2-induccion', datos: { id: i.induccion_id, item: i.item } }) : '') + '</li>';
      }).join('') + '</ul>' });
  }

  function tabCompetencias(d) {
    var ultima = d.ultima_evaluacion, cumple = d.horas_formacion_anio >= d.meta_horas_formacion;
    var pct = d.meta_horas_formacion ? Math.min(100, d.horas_formacion_anio * 100 / d.meta_horas_formacion) : 0;
    var evaluar = d.puede_evaluar ? U.boton({ texto: ultima ? 'Nueva evaluación' : 'Registrar evaluación', icono: 'diana', variante: 'primario', clase: 'js-fc2-evaluar' }) : '';
    return '<div class="sx2-grid sx2-grid--estira"><div class="sx2-col-4">' +
      U.card({ titulo: 'Formación este año', icono: 'tendencia', i: 2, cuerpo: '<div class="sx2-flex" style="gap:14px;align-items:center">' + U.anillo(pct, { tam: 72, grosor: 8, tono: cumple ? 'ok' : 'alerta', texto: d.horas_formacion_anio + ' h' }) +
        '<span class="sx2-apilado" style="gap:2px"><strong>' + d.horas_formacion_anio + ' de ' + d.meta_horas_formacion + ' horas</strong><span class="sx2-tenue" style="font-size:.8125rem">' + (cumple ? 'Cumple la meta anual.' : 'Bajo la meta del Objetivo de Calidad N°4.') + '</span></span></div>' }) +
      '</div><div class="sx2-col-8">' +
      U.card({ titulo: 'Evaluación de competencias', icono: 'diana', sub: 'FO-PRO-02-04 · cada 12 meses', i: 3, cuerpo:
        (d.evaluacion_vencida ? aviso('critico', 'alerta', 'La evaluación está vencida: corresponde una nueva.') : '') +
        (ultima ? '<ul class="mj2-hallazgos">' + (d.evaluaciones || []).map(function (e) {
          var bajo = si(e.requiere_capacitacion);
          return '<li class="mj2-hallazgo sx2-tono-' + (bajo ? 'alerta' : 'ok') + '"><div class="sx2-flex" style="gap:8px;flex-wrap:wrap;align-items:center"><strong>' + U.esc(e.fecha ? fecha(e.fecha) : 'Sin fecha registrada') + '</strong>' +
            U.badge('Funciones ' + e.promedio_responsabilidades, 'neutro', true) + U.badge('Habilidades ' + e.promedio_habilidades, 'neutro', true) + (bajo ? U.badge('Requiere capacitación', 'alerta') : U.badge('Conforme', 'ok')) + '</div>' +
            '<p>Evaluó ' + U.esc(PY.persona(e.evaluador_email).nombre) + (e.proxima_evaluacion ? ' · próxima ' + U.esc(fecha(e.proxima_evaluacion)) : '') + '</p>' +
            (e.observaciones ? '<p>' + U.esc(e.observaciones) + '</p>' : '') + (e.recomendado_por ? '<p>Recomienda capacitación: ' + U.esc(e.recomendado_por) + '</p>' : '') + '</li>';
        }).join('') + '</ul>' : U.vacio({ icono: 'diana', titulo: 'Todavía no tiene evaluación', texto: 'La registra la jefatura directa, según el descriptor de cargo vigente.' })) +
        (evaluar ? '<div class="mj2-acciones">' + evaluar + '</div>' : '') }) + '</div></div>';
  }

  // --- Formularios de la ficha ------------------------------------------------------------
  function formPersona(p) {
    var nueva = !p;
    p = p || {};
    paso({ titulo: nueva ? 'Nueva persona' : 'Editar datos', boton: nueva ? 'Crear ficha' : 'Guardar', ancho: true,
      campos: U.campo('Nombre completo', '<input class="sx2-input" name="nombre" required value="' + U.esc(p.nombre || '') + '">') +
        '<div class="sx2-form__fila">' + U.campo('Correo', '<input class="sx2-input" type="email" name="usuario_email" required value="' + U.esc(p.usuario_email || '') + '"' + (!nueva && p.usuario_email ? ' readonly' : '') + '>') +
          U.campo('RUT', '<input class="sx2-input" name="rut" value="' + U.esc(p.rut || '') + '" placeholder="12.345.678-9">') + '</div>' +
        '<div class="sx2-form__fila">' + U.campo('Cargo según organigrama', '<input class="sx2-input" name="cargo" value="' + U.esc(p.cargo || '') + '">') +
          U.campo('Tipo', '<select class="sx2-select" name="tipo"><option value="INT"' + (p.tipo !== 'EXT' ? ' selected' : '') + '>Interno</option><option value="EXT"' + (p.tipo === 'EXT' ? ' selected' : '') + '>Externo</option></select>') + '</div>' +
        '<div class="sx2-form__fila">' + U.campo('Área', '<input class="sx2-input" name="area_id" value="' + U.esc(p.area_id || '') + '" placeholder="Ej.: PREVENCION">') +
          U.campo('Fecha de ingreso', '<input class="sx2-input" type="date" name="fecha_ingreso" max="' + PY.hoyClave() + '" value="' + U.esc(iso(p.fecha_ingreso)) + '">') + '</div>' +
        '<div class="sx2-form__fila">' + U.campo('Jefatura directa (correo)', '<input class="sx2-input" type="email" name="jefatura_email" value="' + U.esc(p.jefatura_email || '') + '">') +
          U.campo('Subrogante (correo)', '<input class="sx2-input" type="email" name="subrogante_email" value="' + U.esc(p.subrogante_email || '') + '">') + '</div>',
      preparar: function (x) {
        if (!x.nombre) return 'Indica el nombre.';
        if (!x.usuario_email || !esCorreo(x.usuario_email)) return 'Indica un correo válido.';
        if (!esCorreo(x.jefatura_email) || !esCorreo(x.subrogante_email)) return 'Revisa los correos de jefatura y subrogante.';
        if (x.jefatura_email && x.jefatura_email.toLowerCase() === x.usuario_email.toLowerCase()) return 'Una persona no puede ser su propia jefatura.';
        if (!nueva) x.persona_id = p.persona_id;
        return x;
      },
      enviar: function (x) { return api('guardarPersonaSgc', x); },
      aviso: nueva ? 'Ficha creada.' : 'Datos guardados.',
      listo: function (r) {
        if (window.SigsoCalidad && SigsoCalidad.invalidar) SigsoCalidad.invalidar();
        if (nueva) { var id = r && r.data && r.data.persona_id; if (id) abrir(id); else if (window.SigsoCalidad) SigsoCalidad.irAItem('personas'); }
        else recargarFicha();
      } });
  }
  function formDescriptor(p, v, editar) {
    var corregir = !!(editar && v), base = corregir ? v : {};
    paso({ titulo: (corregir ? 'Corregir descriptor ' : 'Descriptor de cargo') + (corregir ? v.version : ''), boton: corregir ? 'Guardar cambios' : 'Guardar descriptor', ocupado: 'Guardando…', ancho: true,
      sub: corregir ? 'Corrige la versión vigente sin crear una nueva. Para un cambio real de contenido, usa "Nueva versión".' : (v ? 'La versión ' + U.esc(v.version) + ' quedará archivada (no se elimina) y esta pasa a ser la vigente.' : ''),
      campos: U.campo('Versión', '<input class="sx2-input" name="version" required value="' + U.esc(corregir ? v.version : (v ? '' : 'v01')) + '" placeholder="Ej.: v02"' + (corregir ? ' readonly' : '') + '>') +
        U.campo('Objetivo general del cargo', '<textarea class="sx2-input" name="objetivo" rows="3" required>' + U.esc(base.objetivo || '') + '</textarea>') +
        U.campo('Funciones', '<textarea class="sx2-input" name="funciones" rows="3">' + U.esc(base.funciones || '') + '</textarea>') +
        U.campo('Responsabilidades (texto, tal como está en el documento)', '<textarea class="sx2-input" name="responsabilidades" rows="3">' + U.esc(base.responsabilidades || '') + '</textarea>') +
        U.campo('Habilidades requeridas (texto)', '<textarea class="sx2-input" name="habilidades" rows="3">' + U.esc(base.habilidades || '') + '</textarea>') +
        U.campo('Funciones a evaluar (una por línea)', '<textarea class="sx2-input" name="items_resp" rows="4">' + U.esc(v && v.items_responsabilidades ? v.items_responsabilidades.join('\n') : '') + '</textarea>', 'La evaluación de competencias califica cada una por separado.') +
        U.campo('Habilidades a evaluar (una por línea)', '<textarea class="sx2-input" name="items_hab" rows="4">' + U.esc(v && v.items_habilidades ? v.items_habilidades.join('\n') : '') + '</textarea>') +
        '<div class="sx2-form__fila">' + U.campo('Nivel educacional', '<input class="sx2-input" name="nivel_educacional" value="' + U.esc(base.nivel_educacional || '') + '">') +
          U.campo('Formación técnica', '<input class="sx2-input" name="formacion_tecnica" value="' + U.esc(base.formacion_tecnica || '') + '">') + '</div>' +
        U.campo('Experiencia laboral requerida', '<textarea class="sx2-input" name="experiencia" rows="2">' + U.esc(base.experiencia || '') + '</textarea>') +
        archivoCampo('archivo', corregir && v.archivo_id ? 'Reemplazar el archivo (opcional)' : 'Archivo del descriptor (opcional)', corregir && v.archivo_id ? 'Actual: ' + (v.archivo_nombre || 'sin nombre') + '. Déjalo vacío para no cambiarlo.' : ''),
      preparar: function (x) {
        if (!x.version) return 'Indica la versión.';
        if (!corregir && (ficha_.datos.descriptores || []).some(function (dd) { return String(dd.version).toLowerCase() === x.version.toLowerCase(); })) return 'Ya existe la versión ' + x.version + '.';
        return (x.objetivo || '').length >= 10 ? x : 'Escribe el objetivo del cargo.';
      },
      enviar: function (x, form) {
        return leerArchivo(form, 'archivo').then(function (a) {
          var datos = { persona_id: p.persona_id, version: x.version, objetivo: x.objetivo, funciones: x.funciones, responsabilidades: x.responsabilidades, habilidades: x.habilidades,
            items_responsabilidades: lineas(x.items_resp), items_habilidades: lineas(x.items_hab), nivel_educacional: x.nivel_educacional, formacion_tecnica: x.formacion_tecnica, experiencia: x.experiencia };
          if (a) { datos.contenido_base64 = a.b64; datos.nombre_archivo = a.nombre; }
          if (corregir) { datos.descriptor_id = v.descriptor_id; return api('actualizarDescriptorSgc', datos); }
          return api('guardarDescriptorSgc', datos);
        });
      },
      aviso: 'Descriptor guardado.' });
  }
  function formDocumento(p) {
    paso({ titulo: 'Cargar documento', boton: 'Cargar', ocupado: 'Subiendo…', sub: U.esc(p.nombre),
      campos: U.campo('Tipo de documento', '<select class="sx2-select" name="tipo">' + Object.keys(TIPO_DOC).map(function (k) { return '<option value="' + k + '">' + U.esc(TIPO_DOC[k]) + '</option>'; }).join('') + '</select>') +
        U.campo('Nombre (opcional)', '<input class="sx2-input" name="nombre" placeholder="Si lo dejas vacío, se usa el nombre del archivo">') + archivoCampo('archivo', 'Archivo', '', true),
      preparar: function (x, form) { return form.querySelector('[name=archivo]').files[0] ? x : 'Elige el archivo.'; },
      enviar: function (x, form) {
        return leerArchivo(form, 'archivo').then(function (a) {
          return api('guardarDocumentoPersonaSgc', { persona_id: p.persona_id, tipo: x.tipo, nombre: x.nombre || a.nombre, nombre_archivo: a.nombre, contenido_base64: a.b64 });
        });
      },
      aviso: 'Documento cargado.' });
  }
  function formReemplazo(p, doc) {
    paso({ titulo: 'Reemplazar archivo', boton: 'Reemplazar', ocupado: 'Subiendo…',
      sub: 'No crea un documento nuevo: sigue siendo "' + U.esc(doc.nombre || doc.archivo_nombre) + '" (' + U.esc(TIPO_DOC[doc.tipo] || doc.tipo) + '); solo cambia el archivo adjunto.',
      campos: archivoCampo('archivo', 'Archivo nuevo', '', true),
      preparar: function (x, form) { return form.querySelector('[name=archivo]').files[0] ? x : 'Elige el archivo.'; },
      enviar: function (x, form) { return leerArchivo(form, 'archivo').then(function (a) { return api('reemplazarArchivoDocumentoPersonaSgc', { persona_id: p.persona_id, doc_id: doc.doc_id, nombre_archivo: a.nombre, contenido_base64: a.b64 }); }); },
      aviso: 'Archivo reemplazado.' });
  }
  function formInduccion(p, id, item) {
    var ingreso = iso(p.fecha_ingreso), hoy = PY.hoyClave();
    paso({ titulo: 'Registrar inducción', boton: 'Registrar', sub: U.esc(item),
      campos: U.campo('Fecha en que se hizo', '<input class="sx2-input" type="date" name="fecha" required max="' + hoy + '" value="' + (ingreso && ingreso <= hoy ? ingreso : hoy) + '">', 'Por defecto, la fecha de ingreso. Nunca una fecha futura.') +
        U.campo('Relator (correo, opcional)', '<input class="sx2-input" type="email" name="relator_email" placeholder="Si lo dejas vacío, quedas tú">'),
      preparar: function (x) { if (!x.fecha || x.fecha > hoy) return 'La fecha no puede ser futura.'; return esCorreo(x.relator_email) ? x : 'Revisa el correo del relator.'; },
      enviar: function (x) { return api('registrarInduccionSgc', { persona_id: p.persona_id, induccion_id: id, estado: 'COMPLETADA', fecha: x.fecha + 'T12:00:00Z', relator_email: x.relator_email }); },
      aviso: 'Inducción registrada.' });
  }
  function formEvaluacion(d) {
    var p = d.persona, ir = d.items_responsabilidades || [], ih = d.items_habilidades || [], escala = d.escala_evaluacion || [];
    if (!ir.length || !ih.length) { PY.aviso('El descriptor vigente no tiene funciones y habilidades como lista. Complétalo antes de evaluar.', 'error'); return; }
    var opciones = function (nombre) {
      return '<div class="fc2-escala" role="radiogroup">' + escala.map(function (e) {
        return '<label title="' + U.esc(e.texto) + '"><input type="radio" name="' + nombre + '" value="' + e.valor + '"' + (String(e.valor) === '3' ? ' checked' : '') + '><span>' + e.valor + '</span></label>';
      }).join('') + '</div>';
    };
    var bloque = function (titulo, items, pref) {
      return '<h3 class="mj2-sub">' + U.esc(titulo) + '</h3>' + items.map(function (t, i) { return '<div class="fc2-item"><span>' + U.esc(t) + '</span>' + opciones(pref + i) + '</div>'; }).join('');
    };
    paso({ titulo: 'Evaluación de competencias', boton: 'Guardar evaluación', ancho: true,
      sub: U.esc(p.nombre) + ' · ' + escala.map(function (e) { return e.valor + ' = ' + U.esc(e.texto); }).join(' · ') + '. El sistema calcula los promedios y si requiere capacitación (promedio bajo 3).',
      campos: bloque('Principales funciones', ir, 'r') + bloque('Habilidades', ih, 'h') +
        U.campo('Observaciones', '<textarea class="sx2-input" name="observaciones" rows="3"></textarea>') +
        '<div class="sx2-form__fila">' + U.campo('¿Quién recomienda capacitación? (opcional)', '<input class="sx2-input" name="recomendado_por">') +
          U.campo('Fecha de la evaluación', '<input class="sx2-input" type="date" name="fecha" max="' + PY.hoyClave() + '" value="' + PY.hoyClave() + '">') + '</div>',
      preparar: function (x) { return x; },
      enviar: function (x, form) {
        var val = function (n) { var el = form.querySelector('[name="' + n + '"]:checked'); return el ? Number(el.value) : 3; };
        var datos = { persona_id: p.persona_id, observaciones: x.observaciones, recomendado_por: x.recomendado_por,
          respuestas_responsabilidades: ir.map(function (_, i) { return val('r' + i); }), respuestas_habilidades: ih.map(function (_, i) { return val('h' + i); }) };
        if (x.fecha) datos.fecha = x.fecha;
        return api('registrarEvaluacionSgc', datos);
      },
      aviso: function (r) { var d2 = r && r.data; return d2 && d2.requiere_capacitacion ? 'Guardada. Promedios ' + d2.promedio_responsabilidades + ' / ' + d2.promedio_habilidades + ': requiere capacitación.' : 'Evaluación guardada.'; } });
  }

  // =========================================================================================
  // Capacitaciones
  // =========================================================================================
  function mostrarCapacitaciones() { cargarCap(!!cap_.datos && C().ocupa('capacitaciones')); }
  function cargarCap(silencioso) {
    var c = C().contenedor('capacitaciones');
    if (!c) return;
    var t = ++turno_;
    if (!silencioso || !cap_.datos) c.innerHTML = '<div class="sx2-pagina">' + cabCap(false) + U.esqueleto('kpis', 4) + U.esqueleto('tabla', 5) + '</div>';
    api('listarCapacitacionesSgc', {}).then(function (r) {
      if (t !== turno_ || !C().ocupa('capacitaciones')) return;
      if (!r || !r.ok) { c.innerHTML = '<div class="sx2-pagina">' + cabCap(false) + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar el programa', texto: (r && r.message) || '' }) }) + '</div>'; return; }
      cap_.datos = r.data;
      pintarCap(!!silencioso);
    });
  }
  function cabCap(puede) {
    return '<header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Calidad · Personas</span><h1>Capacitaciones</h1>' +
      '<span class="sx2-tenue" style="font-size:.875rem">Programa anual y horas de formación por persona (Objetivo de Calidad N°4).</span></div>' +
      '<div class="sx2-cabecera__acciones">' + (puede ? U.boton({ texto: 'Programar capacitación', icono: 'nueva', variante: 'primario', clase: 'js-fc2-cap-nueva' }) : '') +
      U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-fc2-cap-recargar' }) + '</div></header>';
  }
  function pintarCap(silencioso) {
    var c = document.getElementById('calidad-v2');
    if (!c || !C().ocupa('capacitaciones') || !cap_.datos) return;
    var d = cap_.datos, caps = d.capacitaciones || [], puede = d.puede_gestionar === true, horas = d.horas_por_persona || [], y = window.scrollY;
    var realizadas = caps.filter(function (x) { return x.estado === 'REALIZADA'; });
    var bajo = horas.filter(function (h) { return !h.cumple_meta; });
    var pendEf = 0;
    caps.forEach(function (x) { (x.asistentes || []).forEach(function (a) { if (a.asistio && a.eficacia_pendiente && !a.eficacia_resultado) pendEf++; }); });
    var q = norm(cap_.q);
    var lista = caps.filter(function (x) { return !q || norm([x.nombre, x.relator, x.descripcion].join(' ')).indexOf(q) !== -1; })
      .sort(function (a, b) { return (a.estado === 'REALIZADA') - (b.estado === 'REALIZADA') || String(b.fecha_realizada || b.fecha_programada || '').localeCompare(String(a.fecha_realizada || a.fecha_programada || '')); });
    var maxH = horas.reduce(function (m, h) { return Math.max(m, h.horas, d.meta_horas || 5); }, 5);
    c.innerHTML = '<div class="sx2-pagina">' + cabCap(puede) +
      '<div class="sx2-fila-kpis">' +
        U.kpi({ i: 0, etiqueta: 'Realizadas ' + (d.anio || ''), valor: realizadas.length, unidad: 'de ' + caps.length + ' en el programa', icono: 'check', tono: 'ok' }) +
        U.kpi({ i: 1, etiqueta: 'Bajo la meta de horas', valor: bajo.length, unidad: 'de ' + horas.length + ' personas', icono: 'alerta', tono: bajo.length ? 'alerta' : 'ok' }) +
        U.kpi({ i: 2, etiqueta: 'Eficacia por evaluar', valor: pendEf, unidad: 'asistentes (a los 60 días)', icono: 'diana', tono: pendEf ? 'alerta' : 'neutro' }) +
      '</div>' +
      '<div class="sx2-grid sx2-grid--estira"><div class="sx2-col-7">' +
      '<div class="sx2-card sx2-py-herramientas sx2-entra" style="--i:3"><div class="sx2-barra-filtros">' + '<label class="sx2-buscar">' + U.ico('lupa', 16) + '<input class="sx2-input js-fc2-cap-q" type="search" placeholder="Buscar curso o relator…" value="' + U.esc(cap_.q) + '"></label></div></div>' +
      (lista.length ? lista.map(function (x, i) {
        var hecha = x.estado === 'REALIZADA', asist = (x.asistentes || []).filter(function (a) { return a.asistio; });
        return '<section class="sx2-card fc2-cap sx2-entra' + (hecha ? '' : ' fc2-cap--prog') + '" style="--i:' + Math.min(i + 4, 12) + '">' +
          '<div class="sx2-flex" style="gap:8px;flex-wrap:wrap;align-items:center"><strong class="fc2-cap__tit">' + U.esc(x.nombre) + '</strong>' + U.badge(hecha ? 'Realizada' : 'Programada', hecha ? 'ok' : 'info') +
            U.badge(x.horas + ' h', 'neutro', true) + (x.eficacia_pendiente ? U.badge('Eficacia pendiente', 'alerta', true) : '') + '</div>' +
          '<span class="mj2-meta">' + (x.relator ? '<span>' + U.ico('persona', 12) + U.esc(x.relator) + '</span>' : '') +
            '<span>' + U.ico('calendario', 12) + (hecha ? 'Realizada ' + U.esc(fecha(x.fecha_realizada)) : (x.fecha_programada ? 'Programada ' + U.esc(fecha(x.fecha_programada)) : 'Sin fecha')) + '</span>' +
            (hecha ? '<span>' + U.ico('equipo', 12) + x.total_asistieron + (x.total_asistieron === 1 ? ' asistente' : ' asistentes') + '</span>' : '') + '</span>' +
          (x.descripcion ? '<p class="mj2-ayuda">' + U.esc(x.descripcion) + '</p>' : '') +
          (hecha && asist.length ? '<ul class="fc2-asist">' + asist.map(function (a) {
            var ef = a.eficacia_resultado ? U.badge(a.eficacia_resultado === 'EFICAZ' ? 'Eficaz' : 'No eficaz', a.eficacia_resultado === 'EFICAZ' ? 'ok' : 'critico')
              : (a.eficacia_pendiente ? U.badge('Por evaluar', 'alerta') : U.badge('Aún no toca', 'neutro', true));
            return '<li><span class="sx2-cortar" style="flex:1">' + U.esc(a.nombre) + '</span>' + ef +
              (puede && !a.eficacia_resultado ? U.boton({ texto: 'Evaluar', sm: true, variante: 'fantasma', clase: 'js-fc2-cap-eficacia', datos: { cap: x.capacitacion_id, persona: a.persona_id, nombre: a.nombre } }) : '') + '</li>';
          }).join('') + '</ul>' : '') +
          (puede && !hecha ? '<div class="mj2-acciones">' + U.boton({ texto: 'Registrar realización', icono: 'check', sm: true, clase: 'js-fc2-cap-realizar', datos: { id: x.capacitacion_id, relator: x.relator || '' } }) + '</div>' : '') + '</section>';
      }).join('') : U.card({ i: 4, cuerpo: U.vacio({ icono: 'tendencia', titulo: caps.length ? 'Nada con esa búsqueda' : 'Todavía no hay capacitaciones', texto: puede && !caps.length ? 'Programa la primera del año.' : '' }) })) +
      '</div><div class="sx2-col-5">' +
      U.card({ titulo: 'Horas de formación ' + (d.anio || ''), icono: 'reloj', sub: 'meta ' + (d.meta_horas || 5) + ' h por persona', i: 4, cuerpo: horas.length
        ? '<ul class="cv2-barras">' + horas.slice().sort(function (a, b) { return a.horas - b.horas; }).map(function (h) {
            return '<li><span class="cv2-barras__et" title="' + U.esc(h.nombre) + '">' + U.esc(h.nombre) + '</span>' + U.barra(h.horas * 100 / maxH, h.cumple_meta ? 'ok' : 'alerta') + '<strong class="cv2-barras__v">' + h.horas + ' h</strong></li>';
          }).join('') + '</ul>' : U.vacio({ icono: 'reloj', titulo: 'Sin personal registrado', texto: '' }) }) +
      '</div></div></div>';
    if (silencioso) { c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; }); window.scrollTo(0, y); }
    U.animar(c);
  }
  function formCapacitacion() {
    paso({ titulo: 'Programar capacitación', boton: 'Programar',
      campos: U.campo('Nombre del curso', '<input class="sx2-input" name="nombre" required>') + U.campo('Descripción', '<textarea class="sx2-input" name="descripcion" rows="3"></textarea>') +
        '<div class="sx2-form__fila">' + U.campo('Horas', '<input class="sx2-input" type="number" name="horas" min="0.5" step="0.5" value="4" required>') + U.campo('Fecha programada', '<input class="sx2-input" type="date" name="fecha_programada">') + '</div>' +
        U.campo('Relator', '<input class="sx2-input" name="relator">'),
      preparar: function (x) { if (!x.nombre) return 'Indica el nombre del curso.'; return Number(x.horas) > 0 ? x : 'Indica las horas.'; },
      enviar: function (x) { x.horas = Number(x.horas); return api('guardarCapacitacionSgc', x); },
      aviso: 'Capacitación programada.', listo: function () { cargarCap(true); } });
  }
  function formRealizacion(id, relator) {
    api('listarPersonasSgc', {}).then(function (r) {
      if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo cargar el personal.', 'error'); return; }
      var personas = (r.data.personas || []).slice().sort(function (a, b) { return String(a.nombre).localeCompare(String(b.nombre), 'es'); });
      paso({ titulo: 'Registrar realización', boton: 'Registrar', ancho: true, sub: 'Marca quiénes asistieron: las horas del año solo se suman a ellos.',
        campos: '<div class="sx2-form__fila">' + U.campo('Fecha de realización', '<input class="sx2-input" type="date" name="fecha_realizada" required max="' + PY.hoyClave() + '" value="' + PY.hoyClave() + '">') +
            U.campo('Relator', '<input class="sx2-input" name="relator" value="' + U.esc(relator || '') + '">') + '</div>' +
          '<div class="sx2-campo"><span class="sx2-campo__et">Asistentes <small class="sx2-tenue js-fc2-n">0 marcados</small></span>' +
          '<label class="sx2-buscar" style="margin-bottom:6px">' + U.ico('lupa', 16) + '<input class="sx2-input js-fc2-buscar-p" type="search" placeholder="Buscar persona…"></label>' +
          '<div class="mj2-clausulas js-fc2-personas">' + personas.map(function (p) {
            return '<label class="nv2-check" data-n="' + U.esc(norm(p.nombre + ' ' + (p.area_id || ''))) + '"><input type="checkbox" name="as_' + U.esc(p.persona_id) + '"> ' + U.esc(p.nombre) + (p.area_id ? ' <small class="sx2-tenue">' + U.esc(p.area_id) + '</small>' : '') + '</label>';
          }).join('') + '</div></div>',
        alMontar: function (form) {
          var n = form.querySelector('.js-fc2-n');
          form.addEventListener('change', function () { n.textContent = form.querySelectorAll('.js-fc2-personas input:checked').length + ' marcados'; });
          form.querySelector('.js-fc2-buscar-p').addEventListener('input', function (ev) {
            var q = norm(ev.target.value);
            form.querySelectorAll('.js-fc2-personas label').forEach(function (l) { l.hidden = !!q && l.getAttribute('data-n').indexOf(q) === -1; });
          });
        },
        preparar: function (x, form) {
          if (!x.fecha_realizada || x.fecha_realizada > PY.hoyClave()) return 'La fecha no puede ser futura.';
          var as = [].slice.call(form.querySelectorAll('.js-fc2-personas input:checked')).map(function (el) { return el.name.slice(3); });
          return as.length ? { fecha_realizada: x.fecha_realizada, relator: x.relator, asistentes: as } : 'Marca al menos un asistente.';
        },
        enviar: function (x) { x.capacitacion_id = id; return api('registrarRealizacionCapacitacionSgc', x); },
        aviso: 'Realización registrada.', listo: function () { cargarCap(true); } });
    });
  }
  function formEficaciaCap(cap, personaId, nombre) {
    paso({ titulo: 'Eficacia de la capacitación', sub: U.esc(nombre || '') + ' · a los 60 días: ¿le sirvió?',
      campos: U.campo('Resultado', '<select class="sx2-select" name="resultado"><option value="EFICAZ">Eficaz</option><option value="NO_EFICAZ">No eficaz</option></select>') +
        U.campo('Observaciones', '<textarea class="sx2-input" name="observaciones" rows="3"></textarea>', 'Obligatorio si no fue eficaz: justifica la siguiente acción.'),
      preparar: function (x) { return x.resultado === 'NO_EFICAZ' && (x.observaciones || '').length < 10 ? 'Si no fue eficaz, explica por qué (mínimo 10 caracteres).' : x; },
      enviar: function (x) { return api('registrarEficaciaCapacitacionSgc', { capacitacion_id: cap, persona_id: personaId, resultado: x.resultado, observaciones: x.observaciones }); },
      aviso: 'Eficacia registrada.', listo: function () { cargarCap(true); } });
  }

  // --- Eventos ------------------------------------------------------------------------------
  document.addEventListener('click', function (ev) {
    var raiz = document.getElementById('calidad-v2');
    if (!raiz || !raiz.contains(ev.target)) return;
    var t = ev.target, b, vista = raiz.getAttribute('data-vista');
    if (vista === 'capacitaciones') {
      if (t.closest('.js-fc2-cap-recargar')) { cargarCap(true); return; }
      if (t.closest('.js-fc2-cap-nueva')) { formCapacitacion(); return; }
      if ((b = t.closest('.js-fc2-cap-realizar'))) { formRealizacion(b.getAttribute('data-id'), b.getAttribute('data-relator')); return; }
      if ((b = t.closest('.js-fc2-cap-eficacia'))) formEficaciaCap(b.getAttribute('data-cap'), b.getAttribute('data-persona'), b.getAttribute('data-nombre'));
      return;
    }
    if (vista !== 'ficha') return;
    var d = ficha_.datos, p = d && d.persona;
    if (t.closest('.js-fc2-volver')) { if (window.SigsoCalidad) SigsoCalidad.irAItem('personas'); return; }
    if (t.closest('.js-fc2-recargar')) { cargarFicha(true); return; }
    if ((b = t.closest('.js-fc2-tab'))) { ficha_.tab = b.getAttribute('data-tab'); pintarFicha(true); return; }
    if (!d) return;
    if (t.closest('.js-fc2-editar')) { formPersona(p); return; }
    if (t.closest('.js-fc2-desvincular')) {
      U.confirmar({ titulo: '¿Desvincular a ' + p.nombre + '?', texto: 'Deja de aparecer en el personal vigente. Su ficha e historial se conservan como evidencia del SGC.', boton: 'Desvincular', peligro: true })
        .then(function (ok) { if (ok) accionSimple('desvincularPersonaSgc', { persona_id: p.persona_id }, 'Desvinculada.'); });
      return;
    }
    if (t.closest('.js-fc2-reactivar')) { accionSimple('desvincularPersonaSgc', { persona_id: p.persona_id, reactivar: true }, 'Reactivada.'); return; }
    if (t.closest('.js-fc2-alcance')) {
      U.confirmar({ titulo: '¿Quitar del alcance del SGC?', texto: 'Para cuando ' + p.nombre + ' nunca debió estar aquí (por ejemplo, una carga por error). No es lo mismo que desvincular a alguien que sí trabajó en la empresa.', boton: 'Quitar del alcance', peligro: true })
        .then(function (ok) { if (ok) accionSimple('quitarPersonaAlcanceSgc', { persona_id: p.persona_id }, p.nombre + ' se quitó del alcance del SGC.', function () { if (window.SigsoCalidad) { SigsoCalidad.invalidar(); SigsoCalidad.irAItem('personas'); } }); });
      return;
    }
    if (t.closest('.js-fc2-desc-nuevo')) { formDescriptor(p, d.descriptor_vigente, false); return; }
    if (t.closest('.js-fc2-desc-editar')) { formDescriptor(p, d.descriptor_vigente, true); return; }
    if (t.closest('.js-fc2-desc-ver')) { C().verArchivo('descargarDescriptorSgc', { persona_id: p.persona_id, descriptor_id: d.descriptor_vigente.descriptor_id }); return; }
    if (t.closest('.js-fc2-desc-bajar')) { C().descargarArchivo('descargarDescriptorSgc', { persona_id: p.persona_id, descriptor_id: d.descriptor_vigente.descriptor_id }); return; }
    if (t.closest('.js-fc2-doc-nuevo')) { formDocumento(p); return; }
    if ((b = t.closest('.js-fc2-doc-ver'))) { C().verArchivo('descargarDocumentoPersonaSgc', { persona_id: p.persona_id, doc_id: b.getAttribute('data-id') }); return; }
    if ((b = t.closest('.js-fc2-doc-bajar'))) { C().descargarArchivo('descargarDocumentoPersonaSgc', { persona_id: p.persona_id, doc_id: b.getAttribute('data-id') }); return; }
    if ((b = t.closest('.js-fc2-doc-reemplazar'))) { var doc = (d.documentos || []).filter(function (x) { return x.doc_id === b.getAttribute('data-id'); })[0]; if (doc) formReemplazo(p, doc); return; }
    if ((b = t.closest('.js-fc2-doc-quitar'))) {
      var did = b.getAttribute('data-id');
      U.confirmar({ titulo: '¿Quitar el documento de la ficha?', texto: 'Deja de aparecer en la ficha.', boton: 'Quitar', peligro: true })
        .then(function (ok) { if (ok) accionSimple('guardarDocumentoPersonaSgc', { persona_id: p.persona_id, accion: 'eliminar', doc_id: did }, 'Documento quitado.'); });
      return;
    }
    if ((b = t.closest('.js-fc2-induccion'))) { formInduccion(p, b.getAttribute('data-id'), b.getAttribute('data-item')); return; }
    if (t.closest('.js-fc2-evaluar')) formEvaluacion(d);
  });
  var tq_ = null;
  document.addEventListener('input', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('js-fc2-cap-q')) return;
    var v = ev.target.value;
    clearTimeout(tq_);
    tq_ = setTimeout(function () {
      cap_.q = v; pintarCap(true);
      var n = document.querySelector('.js-fc2-cap-q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    }, 160);
  });

  window.SigsoCalidadFichaV2 = {
    abrir: abrir,
    nueva: function () { formPersona(null); },
    mostrarCapacitaciones: mostrarCapacitaciones
  };
})();
