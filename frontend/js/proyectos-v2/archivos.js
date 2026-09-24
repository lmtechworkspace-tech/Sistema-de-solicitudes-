/**
 * proyectos-v2/archivos.js — sección "Archivos": documentos (repositorio
 * formal con versiones) y entregables, juntos. Reemplaza en v1 las pestañas
 * Documentos y Entregables.
 *
 * Mismas acciones y permisos que v1 (pintarDocumentos_/pintarEntregables_):
 * aportar (subir, nueva versión, editar, eliminar documento; crear y marcar
 * entregado) = PY.puedeAportar; gestionar (marcar versión vigente, aprobar/
 * observar y eliminar entregables) = detalle.puede_gestionar.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;

  var CATEGORIA = {
    REQUISITOS: 'Requisitos', 'DISEÑO': 'Diseño', CONTRATO: 'Contrato',
    ACTA: 'Acta', APROBACION: 'Aprobación', ENTREGABLE: 'Entregable', OTRO: 'Otro'
  };
  var ENTREGABLE = {
    PENDIENTE: { texto: 'Pendiente', tono: 'neutro' },
    ENTREGADO: { texto: 'Por revisar', tono: 'primario' },
    EN_REVISION: { texto: 'En revisión', tono: 'primario' },
    APROBADO: { texto: 'Aprobado', tono: 'ok' },
    OBSERVADO: { texto: 'Observado', tono: 'alerta' },
    CANCELADO: { texto: 'Cancelado', tono: 'neutro' }
  };
  var ACEPTA = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.webp';

  var f = { texto: '', categoria: '', entregables: '' }; // entregables: '' | revisar | observados | vencidos

  function tamano(bytes) {
    bytes = Number(bytes) || 0;
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB';
    return (Math.round(bytes / 104857.6) / 10) + ' MB';
  }
  function extension(nombre) {
    var m = /\.([a-z0-9]+)$/i.exec(String(nombre || ''));
    return m ? m[1].toLowerCase() : '';
  }
  function tipoArchivo(nombre) {
    var ext = extension(nombre);
    if (ext === 'pdf') return { tono: 'critico', icono: 'documento', ext: 'PDF' };
    if (/^docx?$/.test(ext)) return { tono: 'info', icono: 'documento', ext: 'DOC' };
    if (/^(xlsx?|csv)$/.test(ext)) return { tono: 'ok', icono: 'tabla', ext: ext === 'csv' ? 'CSV' : 'XLS' };
    if (/^pptx?$/.test(ext)) return { tono: 'alerta', icono: 'grafico', ext: 'PPT' };
    if (/^(jpe?g|png|webp|gif)$/.test(ext)) return { tono: 'hito', icono: 'imagen', ext: ext.toUpperCase().replace('JPEG', 'JPG') };
    return { tono: 'neutro', icono: 'documento', ext: (ext || 'ARCH').toUpperCase().slice(0, 4) };
  }
  function tipoHtml(nombre, grande) {
    var t = tipoArchivo(nombre);
    return '<span class="sx2-py-doc__tipo' + (grande ? ' sx2-py-doc__tipo--grande' : '') + ' sx2-tono-' + t.tono + '">' +
      U.ico(t.icono, grande ? 26 : 20) + '<b>' + t.ext + '</b></span>';
  }
  // Texto escapado con los enlaces clicables (muchas descripciones son un link a Drive).
  function conEnlaces(texto) {
    return U.esc(texto).replace(/https?:\/\/[^\s<]+/g, function (url) {
      return '<a class="sx2-enlace" href="' + url + '" target="_blank" rel="noopener noreferrer">' + (url.length > 60 ? url.slice(0, 57) + '…' : url) + '</a>';
    });
  }
  function vencido(e) {
    return (e.estado === 'PENDIENTE' || e.estado === 'OBSERVADO') && e.fecha_comprometida &&
      String(e.fecha_comprometida).slice(0, 10) < PY.hoyClave();
  }

  // "Relacionado con": tarea / hito / reunión / decisión.
  function referencia(ctx, d) {
    if (!d.ref_tipo || !d.ref_id) return null;
    if (d.ref_tipo === 'ACTIVIDAD') {
      var a = ctx.tareas.filter(function (x) { return x.actividad_id === d.ref_id; })[0];
      return a ? { texto: a.titulo, icono: 'tareas', tipo: 'ACTIVIDAD', id: a.actividad_id } : null;
    }
    if (d.ref_tipo === 'HITO') {
      var h = (ctx.detalle.hitos || []).filter(function (x) { return x.hito_id === d.ref_id; })[0];
      return h ? { texto: h.nombre, icono: 'bandera', tipo: 'HITO', id: h.hito_id } : null;
    }
    if (d.ref_tipo === 'REUNION') return { texto: 'Una reunión', icono: 'equipo', tipo: 'REUNION', id: d.ref_id };
    if (d.ref_tipo === 'DECISION') return { texto: 'Una decisión', icono: 'check', tipo: 'DECISION', id: d.ref_id };
    return null;
  }
  function refChip(ref) {
    if (!ref) return '';
    return '<button type="button" class="sx2-py-ref js-py2a-ref" data-tipo="' + U.esc(ref.tipo) + '" data-id="' + U.esc(ref.id) + '" title="' + U.esc(ref.texto) + '">' +
      U.ico(ref.icono, 12) + '<span class="sx2-cortar">' + U.esc(ref.texto) + '</span></button>';
  }
  function irAReferencia(tipo, id) {
    if (tipo === 'ACTIVIDAD') { PY.abrirTarea(id); return; }
    PY.subSeguimiento = (tipo === 'HITO') ? 'hitos' : 'reuniones';
    PY.irSeccion('seguimiento');
  }
  function opcionesReferencia(ctx, actual) {
    var reuniones = PY.extra('reuniones', 'listarReunionesProyecto') || [];
    var decisiones = PY.extra('decisiones', 'listarDecisionesProyecto') || [];
    var ops = ctx.tareas.map(function (a) { return ['ACTIVIDAD::' + a.actividad_id, 'Tarea: ' + a.titulo]; })
      .concat((ctx.detalle.hitos || []).map(function (h) { return ['HITO::' + h.hito_id, 'Hito: ' + h.nombre]; }))
      .concat(reuniones.map(function (r) { return ['REUNION::' + r.reunion_id, 'Reunión: ' + r.titulo]; }))
      .concat(decisiones.map(function (x) { return ['DECISION::' + x.decision_id, 'Decisión: ' + String(x.descripcion || '').slice(0, 50)]; }));
    return '<select class="sx2-select" name="ref"><option value="">Ninguna</option>' + ops.map(function (o) {
      return '<option value="' + U.esc(o[0]) + '"' + (o[0] === actual ? ' selected' : '') + '>' + U.esc(o[1]) + '</option>';
    }).join('') + '</select>';
  }
  function separarRef(datos) {
    var p = datos.ref ? datos.ref.split('::') : ['', ''];
    delete datos.ref;
    datos.ref_tipo = p[0]; datos.ref_id = p[1] || '';
    return datos;
  }
  function selectCategoria(actual) {
    return '<select class="sx2-select" name="categoria">' + Object.keys(CATEGORIA).map(function (c) {
      return '<option value="' + c + '"' + (c === (actual || 'OTRO') ? ' selected' : '') + '>' + CATEGORIA[c] + '</option>';
    }).join('') + '</select>';
  }
  function selectIntegrantes(ctx, nombre, actual) {
    return '<select class="sx2-select" name="' + nombre + '">' + (ctx.detalle.integrantes || []).map(function (i) {
      var p = PY.persona(i.usuario_email, i.usuario_nombre);
      return '<option value="' + U.esc(i.usuario_email) + '"' + (String(i.usuario_email).toLowerCase() === String(actual || '').toLowerCase() ? ' selected' : '') + '>' +
        U.esc(p.nombre + (p.cargo ? ' — ' + p.cargo : '')) + '</option>';
    }).join('') + '</select>';
  }

  // Zona para soltar/elegir un archivo (dentro de un formulario).
  function zonaArchivo() {
    return '<label class="sx2-py-soltar js-py2a-soltar">' +
      '<input type="file" name="archivo" accept="' + ACEPTA + '" class="sx2-oculto-visual">' +
      '<span class="sx2-py-soltar__ico">' + U.ico('subir', 22) + '</span>' +
      '<span class="sx2-py-soltar__txt js-py2a-soltar-txt"><strong>Arrastra un archivo aquí</strong> o haz clic para elegirlo' +
        '<small>PDF, Word, Excel, PowerPoint o imagen</small></span>' +
    '</label>';
  }
  function engancharZona(form, alElegir) {
    var zona = form.querySelector('.js-py2a-soltar');
    var input = zona.querySelector('input[type=file]');
    function mostrar() {
      var a = input.files[0];
      zona.classList.toggle('sx2-py-soltar--lleno', !!a);
      zona.querySelector('.js-py2a-soltar-txt').innerHTML = a
        ? '<strong>' + U.esc(a.name) + '</strong><small>' + tamano(a.size) + ' · clic para cambiarlo</small>'
        : '<strong>Arrastra un archivo aquí</strong> o haz clic para elegirlo<small>PDF, Word, Excel, PowerPoint o imagen</small>';
      if (a && alElegir) alElegir(a);
    }
    input.addEventListener('change', mostrar);
    ['dragenter', 'dragover'].forEach(function (t) {
      zona.addEventListener(t, function (ev) { ev.preventDefault(); zona.classList.add('sx2-py-soltar--encima'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      zona.addEventListener(t, function () { zona.classList.remove('sx2-py-soltar--encima'); });
    });
    zona.addEventListener('drop', function (ev) {
      ev.preventDefault();
      if (ev.dataTransfer && ev.dataTransfer.files.length) { input.files = ev.dataTransfer.files; mostrar(); }
    });
    return { input: input, poner: function (files) { input.files = files; mostrar(); } };
  }

  // --- Pintado --------------------------------------------------------------------
  function tarjetaDoc(ctx, d, i) {
    return '<article class="sx2-py-doc sx2-entra" style="--i:' + Math.min(i, 12) + '" data-py2-doc="' + U.esc(d.documento_id) + '" tabindex="0">' +
      '<div class="sx2-py-doc__top">' + tipoHtml(d.archivo_nombre || d.nombre) +
        U.boton({ soloIcono: true, icono: 'descargar', sm: true, variante: 'fantasma', titulo: 'Descargar', clase: 'sx2-py-doc__rapido js-py2a-bajar', datos: { id: d.documento_id } }) +
      '</div>' +
      '<strong class="sx2-py-doc__nombre">' + U.esc(d.nombre) + '</strong>' +
      '<span class="sx2-flex" style="flex-wrap:wrap;gap:6px">' + U.badge(CATEGORIA[d.categoria] || d.categoria || 'Otro', 'neutro', true) +
        (d.version_vigente ? '<span class="sx2-py-doc__version">' + U.esc(d.version_vigente) + '</span>' : '') + '</span>' +
      '<span class="sx2-py-doc__meta">' + tamano(d.tamano_bytes) + ' · ' + PY.fecha(d.fecha_creacion, true) + '</span>' +
      refChip(referencia(ctx, d)) +
    '</article>';
  }

  function listaDocs(ctx) {
    var todos = ctx.detalle.documentos || [];
    var q = f.texto.toLowerCase();
    var docs = todos.filter(function (d) {
      if (f.categoria && d.categoria !== f.categoria) return false;
      return !q || String(d.nombre || '').toLowerCase().indexOf(q) !== -1 || String(d.descripcion || '').toLowerCase().indexOf(q) !== -1 ||
        String(d.archivo_nombre || '').toLowerCase().indexOf(q) !== -1;
    }).sort(function (a, b) { return String(b.fecha_creacion || '').localeCompare(String(a.fecha_creacion || '')); });
    if (!todos.length) {
      return U.vacio({ icono: 'carpeta', titulo: 'Todavía no hay documentos', texto: PY.puedeAportar(ctx.detalle) ? 'Arrastra un archivo a esta tarjeta o usa "Subir documento".' : 'Cuando el equipo suba documentos aparecerán aquí.' });
    }
    if (!docs.length) return U.vacio({ icono: 'lupa', texto: 'Ningún documento coincide con la búsqueda.' });
    return '<div class="sx2-py-docs">' + docs.map(function (d, i) { return tarjetaDoc(ctx, d, i); }).join('') + '</div>';
  }

  function tarjetaDocumentos(ctx) {
    var todos = ctx.detalle.documentos || [];
    var cuenta = {};
    todos.forEach(function (d) { cuenta[d.categoria] = (cuenta[d.categoria] || 0) + 1; });
    var aporta = PY.puedeAportar(ctx.detalle);
    return '<section class="sx2-card sx2-entra sx2-py-zona-docs js-py2a-docs" style="--i:2">' +
      '<div class="sx2-card__cab">' +
        '<h2 class="sx2-card__titulo">' + U.ico('carpeta', 18) + 'Documentos <span class="sx2-card__sub">' + todos.length + '</span></h2>' +
        (aporta ? U.boton({ texto: 'Subir documento', icono: 'subir', variante: 'primario', sm: true, clase: 'js-py2a-subir' }) : '') +
      '</div>' +
      (todos.length ? '<div class="sx2-py-herramientas-docs">' +
        '<label class="sx2-buscar">' + U.ico('lupa', 16) + '<input class="sx2-input js-py2a-buscar" type="search" placeholder="Buscar documento…" aria-label="Buscar documento" value="' + U.esc(f.texto) + '"></label>' +
        '<div class="sx2-chips">' + U.chip({ texto: 'Todas', activo: !f.categoria, clase: 'js-py2a-cat', datos: { cat: '' }, n: todos.length }) +
          Object.keys(CATEGORIA).filter(function (c) { return cuenta[c]; }).map(function (c) {
            return U.chip({ texto: CATEGORIA[c], activo: f.categoria === c, clase: 'js-py2a-cat', datos: { cat: c }, n: cuenta[c] });
          }).join('') + '</div>' +
      '</div>' : '') +
      '<div class="js-py2a-lista-docs">' + listaDocs(ctx) + '</div>' +
      (aporta ? '<div class="sx2-py-zona-docs__telon">' + U.ico('subir', 28) + '<strong>Suelta para subir</strong></div>' : '') +
    '</section>';
  }

  function itemEntregable(ctx, e, gestiona, aporta, i) {
    var est = ENTREGABLE[e.estado] || { texto: e.estado, tono: 'neutro' };
    var tarde = vencido(e);
    var p = PY.persona(e.responsable_email);
    var acciones = [];
    if (aporta && (e.estado === 'PENDIENTE' || e.estado === 'OBSERVADO')) acciones.push(U.boton({ texto: 'Marcar entregado', icono: 'check', sm: true, clase: 'js-py2a-e-marcar', datos: { id: e.entregable_id } }));
    if (gestiona && e.estado === 'ENTREGADO') {
      acciones.push(U.boton({ texto: 'Aprobar', icono: 'check', sm: true, variante: 'primario', clase: 'js-py2a-e-aprobar', datos: { id: e.entregable_id } }));
      acciones.push(U.boton({ texto: 'Observar', icono: 'alerta', sm: true, clase: 'js-py2a-e-observar', datos: { id: e.entregable_id } }));
    }
    if (gestiona && e.estado === 'PENDIENTE') acciones.push(U.boton({ soloIcono: true, icono: 'basura', sm: true, variante: 'fantasma', titulo: 'Eliminar entregable', clase: 'js-py2a-e-eliminar', datos: { id: e.entregable_id, nombre: e.nombre } }));
    return '<li class="sx2-py-entregable sx2-tono-' + (tarde ? 'critico' : est.tono) + ' sx2-entra" style="--i:' + Math.min(i, 12) + '">' +
      '<div class="sx2-entre" style="gap:8px;align-items:flex-start"><strong class="sx2-py-entregable__nombre">' + U.esc(e.nombre) + '</strong>' + U.badge(est.texto, est.tono) + '</div>' +
      (e.descripcion ? '<p class="sx2-py-entregable__desc">' + U.esc(e.descripcion) + '</p>' : '') +
      '<div class="sx2-py-entregable__meta">' + U.avatar(p, 'xs') + '<span class="sx2-cortar">' + U.esc(p.nombre) + '</span>' +
        '<span class="' + (tarde ? 'sx2-delta--mal' : 'sx2-tenue') + '">' + U.ico('calendario', 12) + ' ' + PY.fecha(e.fecha_comprometida, true) + (tarde ? ' · vencido' : '') + '</span></div>' +
      (e.estado === 'OBSERVADO' && e.observaciones ? '<div class="sx2-py-aviso sx2-tono-alerta">' + U.ico('alerta', 14) + '<span>' + U.esc(e.observaciones) + '</span></div>' : '') +
      (e.url_evidencia ? '<a class="sx2-enlace" href="' + U.esc(e.url_evidencia) + '" target="_blank" rel="noopener noreferrer">' + U.ico('enlace', 13) + 'Ver evidencia</a>' : '') +
      (acciones.length ? '<div class="sx2-flex" style="flex-wrap:wrap;gap:6px">' + acciones.join('') + '</div>' : '') +
    '</li>';
  }

  function tarjetaEntregables(ctx) {
    var todos = ctx.detalle.entregables || [];
    var gestiona = !!ctx.detalle.puede_gestionar, aporta = PY.puedeAportar(ctx.detalle);
    var lista = todos.filter(function (e) {
      if (f.entregables === 'revisar') return e.estado === 'ENTREGADO';
      if (f.entregables === 'observados') return e.estado === 'OBSERVADO';
      if (f.entregables === 'vencidos') return vencido(e);
      return true;
    });
    // Lo que pide acción primero; lo cerrado al final.
    var ORDEN = { ENTREGADO: 0, OBSERVADO: 1, PENDIENTE: 2, EN_REVISION: 3, APROBADO: 4, CANCELADO: 5 };
    lista.sort(function (a, b) {
      return (ORDEN[a.estado] - ORDEN[b.estado]) || String(a.fecha_comprometida || '').localeCompare(String(b.fecha_comprometida || ''));
    });
    var filtro = f.entregables ? '<button type="button" class="sx2-chip js-py2a-e-filtro" data-f="" aria-pressed="true">' +
      ({ revisar: 'Por revisar', observados: 'Observados', vencidos: 'Vencidos' })[f.entregables] + U.ico('equis', 12) + '</button>' : '';
    var cuerpo = !todos.length
      ? U.vacio({ icono: 'bandera', titulo: 'Sin entregables', texto: aporta ? 'Define qué se entrega, quién y para cuándo.' : 'Todavía no hay entregables definidos.' })
      : (lista.length ? '<ul class="sx2-py-entregables">' + lista.map(function (e, i) { return itemEntregable(ctx, e, gestiona, aporta, i); }).join('') + '</ul>'
        : U.vacio({ icono: 'check', texto: 'Nada en este filtro.' }));
    return '<section class="sx2-card sx2-entra" style="--i:3">' +
      '<div class="sx2-card__cab">' +
        '<h2 class="sx2-card__titulo">' + U.ico('bandera', 18) + 'Entregables <span class="sx2-card__sub">' + todos.length + '</span></h2>' +
        (aporta ? U.boton({ texto: 'Nuevo', icono: 'nueva', sm: true, clase: 'js-py2a-e-nuevo' }) : '') +
      '</div>' + (filtro ? '<div style="margin-bottom:12px">' + filtro + '</div>' : '') + cuerpo +
    '</section>';
  }

  function pintar(ctx) {
    var docs = ctx.detalle.documentos || [];
    var ents = ctx.detalle.entregables || [];
    var cats = {};
    docs.forEach(function (d) { cats[d.categoria] = true; });
    var porRevisar = ents.filter(function (e) { return e.estado === 'ENTREGADO'; }).length;
    var observados = ents.filter(function (e) { return e.estado === 'OBSERVADO'; }).length;
    var vencidos = ents.filter(vencido).length;
    var aprobados = ents.filter(function (e) { return e.estado === 'APROBADO'; }).length;
    var pctAprob = ents.length ? Math.round(aprobados / ents.length * 100) : 0;
    return '<div class="sx2-fila-kpis">' +
        U.kpi({ i: 0, icono: 'carpeta', tono: 'primario', etiqueta: 'Documentos', valor: docs.length, unidad: Object.keys(cats).length + (Object.keys(cats).length === 1 ? ' categoría' : ' categorías') }) +
        U.kpi({ i: 1, icono: 'bandera', tono: 'ok', etiqueta: 'Entregables aprobados', valor: aprobados, unidad: 'de ' + ents.length, progreso: pctAprob }) +
        U.kpi({ i: 2, icono: 'ojo', tono: 'info', etiqueta: 'Por revisar', valor: porRevisar, unidad: 'esperan aprobación', filtro: 'revisar', activo: f.entregables === 'revisar' }) +
        U.kpi({ i: 3, icono: 'alerta', tono: 'alerta', etiqueta: 'Observados', valor: observados, unidad: 'hay que corregir', filtro: 'observados', activo: f.entregables === 'observados' }) +
        U.kpi({ i: 4, icono: 'reloj', tono: 'critico', etiqueta: 'Vencidos', valor: vencidos, unidad: 'sin entregar a tiempo', filtro: 'vencidos', activo: f.entregables === 'vencidos' }) +
      '</div>' +
      '<div class="sx2-grid sx2-grid--estira">' +
        '<div class="sx2-col-8">' + tarjetaDocumentos(ctx) + '</div>' +
        '<div class="sx2-col-4 sx2-col--apila">' + tarjetaEntregables(ctx) + '</div>' +
      '</div>';
  }

  // --- Documentos: drawers -----------------------------------------------------------
  function descargarDoc(id, btn) {
    if (btn) btn.disabled = true;
    PY.api('descargarDocumentoProyecto', { proyecto_id: PY.estado().proyectoId, documento_id: id }).then(function (r) {
      if (btn) btn.disabled = false;
      if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo descargar el documento.', 'error'); return; }
      PY.descargarBase64(r.data.contenido_base64, r.data.nombre_archivo, r.data.mime);
    });
  }

  function abrirSubir(ctx, archivos) {
    return PY.formulario({
      titulo: 'Subir documento',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Queda como versión v1; las siguientes se suben desde el documento.</span>',
      boton: 'Subir',
      campos: zonaArchivo() +
        PY.campo('Nombre', '<input class="sx2-input" name="nombre" maxlength="160" required placeholder="Se completa con el nombre del archivo">') +
        '<div class="sx2-form__fila">' + PY.campo('Categoría', selectCategoria('OTRO')) + PY.campo('Relacionado con', opcionesReferencia(ctx, '')) + '</div>' +
        PY.campo('Descripción', '<textarea class="sx2-input" name="descripcion" maxlength="1000" placeholder="Opcional: qué es y para qué sirve"></textarea>'),
      alMontar: function (form) {
        var nombre = form.querySelector('[name=nombre]');
        var z = engancharZona(form, function (a) {
          if (!nombre.value.trim()) nombre.value = a.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
        });
        if (archivos && archivos.length) z.poner(archivos);
      },
      preparar: function (datos, form) {
        var archivo = form.querySelector('[name=archivo]').files[0];
        if (!archivo) return 'Elige un archivo.';
        if (!datos.nombre) return 'Ponle un nombre al documento.';
        return PY.leerBase64(archivo).then(function (b64) {
          separarRef(datos);
          datos.nombre_archivo = archivo.name;
          datos.contenido_base64 = b64;
          return datos;
        });
      },
      accion: 'gestionarDocumentoProyecto',
      aviso: 'Documento subido.'
    });
  }

  function abrirNuevaVersion(doc) {
    PY.formulario({
      titulo: 'Nueva versión',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(doc.nombre) + ' · vigente hoy: ' + U.esc(doc.version_vigente || '—') + '</span>',
      boton: 'Subir versión',
      campos: zonaArchivo() + PY.campo('Qué cambió', '<textarea class="sx2-input" name="comentario" maxlength="1000" placeholder="Opcional, pero ayuda a quien lea el historial"></textarea>'),
      alMontar: function (form) { engancharZona(form); },
      preparar: function (datos, form) {
        var archivo = form.querySelector('[name=archivo]').files[0];
        if (!archivo) return 'Elige el archivo de la nueva versión.';
        return PY.leerBase64(archivo).then(function (b64) {
          datos.documento_id = doc.documento_id;
          datos.nombre_archivo = archivo.name;
          datos.contenido_base64 = b64;
          return datos;
        });
      },
      accion: 'subirVersionDocumentoProyecto',
      aviso: 'Nueva versión subida.'
    });
  }

  function abrirEditarDoc(ctx, doc) {
    PY.formulario({
      titulo: 'Editar documento',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Solo los datos; el archivo se cambia con "Nueva versión".</span>',
      campos: PY.campo('Nombre', '<input class="sx2-input" name="nombre" maxlength="160" value="' + U.esc(doc.nombre) + '">') +
        '<div class="sx2-form__fila">' + PY.campo('Categoría', selectCategoria(doc.categoria)) +
          PY.campo('Relacionado con', opcionesReferencia(ctx, doc.ref_tipo && doc.ref_id ? doc.ref_tipo + '::' + doc.ref_id : '')) + '</div>' +
        PY.campo('Descripción', '<textarea class="sx2-input" name="descripcion" maxlength="1000">' + U.esc(doc.descripcion || '') + '</textarea>'),
      preparar: function (datos) {
        if (!datos.nombre) return 'El nombre no puede quedar vacío.';
        datos.documento_id = doc.documento_id;
        return separarRef(datos);
      },
      accion: 'gestionarDocumentoProyecto',
      aviso: 'Documento actualizado.',
      eliminar: {
        texto: 'Eliminar', titulo: '¿Eliminar "' + doc.nombre + '"?', mensaje: 'Sale de la lista; su historial de versiones se conserva.',
        enviar: function () { return PY.api('gestionarDocumentoProyecto', { proyecto_id: PY.estado().proyectoId, accion: 'eliminar', documento_id: doc.documento_id }); }
      }
    });
  }

  function abrirDoc(ctx, id) {
    var doc = (ctx.detalle.documentos || []).filter(function (x) { return x.documento_id === id; })[0];
    if (!doc) return;
    var aporta = PY.puedeAportar(ctx.detalle), gestiona = !!ctx.detalle.puede_gestionar;
    var ref = referencia(ctx, doc);
    var d = U.drawer({
      titulo: doc.nombre,
      subtitulo: '<span class="sx2-flex" style="flex-wrap:wrap">' + U.badge(CATEGORIA[doc.categoria] || doc.categoria || 'Otro', 'neutro', true) +
        (doc.version_vigente ? '<span class="sx2-py-doc__version">' + U.esc(doc.version_vigente) + ' vigente</span>' : '') + '</span>',
      cuerpo: '<div class="sx2-flex" style="gap:14px;align-items:center">' + tipoHtml(doc.archivo_nombre || doc.nombre, true) +
          '<div class="sx2-apilado" style="gap:2px;min-width:0"><strong class="sx2-cortar">' + U.esc(doc.archivo_nombre || '') + '</strong>' +
          '<span class="sx2-tenue" style="font-size:.8125rem">' + tamano(doc.tamano_bytes) + ' · subido ' + PY.fecha(doc.fecha_creacion, true) + '</span></div></div>' +
        (doc.descripcion ? '<div class="sx2-seccion-drawer"><h3 class="sx2-seccion-drawer__titulo">Descripción</h3><p class="sx2-py-descripcion" style="overflow-wrap:anywhere">' + conEnlaces(doc.descripcion) + '</p></div>' : '') +
        (ref ? '<div class="sx2-seccion-drawer"><h3 class="sx2-seccion-drawer__titulo">Relacionado con</h3>' + refChip(ref) + '</div>' : '') +
        '<div class="sx2-seccion-drawer"><h3 class="sx2-seccion-drawer__titulo">Versiones</h3><div class="js-py2a-versiones">' + U.esqueleto('tabla', 3) + '</div></div>',
      pie: (aporta ? U.boton({ texto: 'Editar', icono: 'editar', clase: 'js-py2a-d-editar' }) + U.boton({ texto: 'Nueva versión', icono: 'subir', clase: 'js-py2a-d-version' }) : '') +
        '<span style="flex:1"></span>' + U.boton({ texto: 'Descargar', icono: 'descargar', variante: 'primario', clase: 'js-py2a-d-bajar' })
    });

    function cargarVersiones() {
      PY.api('listarVersionesDocumentoProyecto', { proyecto_id: PY.estado().proyectoId, documento_id: doc.documento_id }).then(function (r) {
        var cont = d.el.querySelector('.js-py2a-versiones');
        if (!cont) return;
        if (!r || !r.ok) { cont.innerHTML = '<p class="sx2-tenue">No se pudo cargar el historial.</p>'; return; }
        var vs = r.data || [];
        var correos = vs.map(function (v) { return v.subido_por; }).filter(Boolean);
        return Promise.resolve(window.SigsoDirectorio ? SigsoDirectorio.resolver(correos) : null).catch(function () { /* sin directorio: correos */ })
          .then(function () { pintarVersiones(cont, vs); });
      });
    }
    function pintarVersiones(cont, vs) {
        cont.innerHTML = vs.length ? '<ol class="sx2-py-versiones">' + vs.map(function (v) {
          var p = PY.persona(v.subido_por);
          return '<li class="sx2-py-version' + (v.vigente ? ' sx2-py-version--vigente' : '') + '">' +
            '<span class="sx2-py-version__punto"></span>' +
            '<div class="sx2-apilado" style="gap:2px;flex:1;min-width:0">' +
              '<span class="sx2-flex" style="gap:6px"><strong>' + U.esc(v.version) + '</strong>' + (v.vigente ? U.badge('Vigente', 'ok', true) : '') + '</span>' +
              (v.comentario ? '<span style="font-size:.8125rem">' + U.esc(v.comentario) + '</span>' : '') +
              '<span class="sx2-tenue" style="font-size:.75rem">' + U.esc(p.nombre) + ' · ' + PY.fecha(v.fecha, true) + ' · ' + tamano(v.tamano_bytes) + '</span>' +
            '</div>' +
            '<span class="sx2-flex" style="gap:4px">' +
              (!v.vigente && gestiona ? U.boton({ texto: 'Hacer vigente', sm: true, variante: 'fantasma', clase: 'js-py2a-v-vigente', datos: { id: v.version_id, version: v.version } }) : '') +
              U.boton({ soloIcono: true, icono: 'descargar', sm: true, variante: 'fantasma', titulo: 'Descargar ' + v.version, clase: 'js-py2a-v-bajar', datos: { id: v.version_id } }) +
            '</span>' +
          '</li>';
        }).join('') + '</ol>' : '<p class="sx2-tenue">Sin versiones.</p>';
    }
    cargarVersiones();

    d.el.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t.closest('.js-py2a-d-bajar')) { descargarDoc(doc.documento_id, t.closest('button')); return; }
      if (t.closest('.js-py2a-d-editar')) { abrirEditarDoc(ctx, doc); return; }
      if (t.closest('.js-py2a-d-version')) { abrirNuevaVersion(doc); return; }
      var r = t.closest('.js-py2a-ref');
      if (r) { d.cerrar(true); irAReferencia(r.getAttribute('data-tipo'), r.getAttribute('data-id')); return; }
      var vb = t.closest('.js-py2a-v-bajar');
      if (vb) {
        vb.disabled = true;
        PY.api('descargarVersionDocumentoProyecto', { proyecto_id: PY.estado().proyectoId, version_id: vb.getAttribute('data-id') }).then(function (rd) {
          vb.disabled = false;
          if (!rd || !rd.ok) { PY.aviso((rd && rd.message) || 'No se pudo descargar.', 'error'); return; }
          PY.descargarBase64(rd.data.contenido_base64, rd.data.nombre_archivo, rd.data.mime);
        });
        return;
      }
      var vv = t.closest('.js-py2a-v-vigente');
      if (vv) {
        PY.accionConfirmada({
          titulo: '¿Hacer vigente la ' + vv.getAttribute('data-version') + '?', texto: 'Será la versión que se descarga por defecto. Las demás se conservan.', boton: 'Hacer vigente',
          accion: 'marcarVersionVigenteProyecto', datos: { documento_id: doc.documento_id, version_id: vv.getAttribute('data-id') },
          aviso: 'Versión vigente actualizada.',
          listo: function () { cargarVersiones(); PY.recargarProyecto(); }
        });
      }
    });
  }

  // --- Entregables: drawers ---------------------------------------------------------
  function abrirNuevoEntregable(ctx) {
    var hitos = ctx.detalle.hitos || [];
    PY.formulario({
      titulo: 'Nuevo entregable',
      boton: 'Crear',
      campos: PY.campo('Nombre', '<input class="sx2-input" name="nombre" maxlength="160" placeholder="Ej: Informe de diagnóstico firmado">') +
        PY.campo('Descripción', '<textarea class="sx2-input" name="descripcion" maxlength="1000" placeholder="Opcional: criterio de aceptación"></textarea>') +
        PY.campo('Responsable', selectIntegrantes(ctx, 'responsable_email', PY.miEmail())) +
        '<div class="sx2-form__fila">' +
          PY.campo('Fecha comprometida', '<input class="sx2-input" type="date" name="fecha_comprometida">') +
          (hitos.length ? PY.campo('Hito', '<select class="sx2-select" name="hito_id"><option value="">Sin hito</option>' + hitos.map(function (h) {
            return '<option value="' + U.esc(h.hito_id) + '">' + U.esc(h.nombre) + '</option>';
          }).join('') + '</select>') : '') +
        '</div>',
      preparar: function (datos) {
        if (!datos.nombre) return 'Escribe el nombre del entregable.';
        if (!datos.fecha_comprometida) return 'Indica la fecha comprometida.';
        return datos;
      },
      accion: 'gestionarEntregableProyecto',
      aviso: 'Entregable creado.'
    });
  }

  function entregablePorId(ctx, id) { return (ctx.detalle.entregables || []).filter(function (e) { return e.entregable_id === id; })[0]; }

  function abrirMarcarEntregado(ctx, id) {
    var e = entregablePorId(ctx, id);
    if (!e) return;
    PY.formulario({
      titulo: 'Marcar como entregado',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(e.nombre) + '</span>',
      boton: 'Marcar entregado',
      campos: PY.campo('Link de evidencia', '<input class="sx2-input" type="url" name="url_evidencia" placeholder="https://… (opcional)">',
        'Si el archivo está en SIGSO, súbelo como documento de categoría "Entregable".'),
      preparar: function (datos) { datos.accion = 'marcarEntregado'; datos.entregable_id = id; return datos; },
      accion: 'gestionarEntregableProyecto',
      aviso: 'Entregable marcado como entregado.'
    });
  }

  function abrirObservar(ctx, id) {
    var e = entregablePorId(ctx, id);
    if (!e) return;
    PY.formulario({
      titulo: 'Observar entregable',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(e.nombre) + '</span>',
      boton: 'Enviar observación',
      campos: PY.campo('Qué falta corregir', '<textarea class="sx2-input" name="observaciones" maxlength="1000" placeholder="Sé concreto: quien lo recibe tiene que poder corregirlo sin preguntar"></textarea>'),
      preparar: function (datos) {
        if (!datos.observaciones) return 'Indica qué falta corregir.';
        datos.entregable_id = id; datos.resultado = 'OBSERVADO';
        return datos;
      },
      accion: 'revisarEntregableProyecto',
      aviso: 'Observación enviada.'
    });
  }

  // --- Eventos ---------------------------------------------------------------------
  function repintarDocs(raiz, ctx) {
    var cont = raiz.querySelector('.js-py2a-lista-docs');
    if (!cont) return;
    cont.innerHTML = listaDocs(ctx);
    cont.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; });
  }

  function alMontar(raiz, ctx) {
    var buscar = raiz.querySelector('.js-py2a-buscar');
    if (buscar) buscar.addEventListener('input', function () { f.texto = buscar.value.trim(); repintarDocs(raiz, ctx); });

    raiz.addEventListener('click', function (ev) {
      var t = ev.target;
      var k = t.closest('[data-filtro]');
      if (k) { f.entregables = f.entregables === k.getAttribute('data-filtro') ? '' : k.getAttribute('data-filtro'); PY.pintar({ sinAnimacion: true }); return; }
      var ef = t.closest('.js-py2a-e-filtro');
      if (ef) { f.entregables = ''; PY.pintar({ sinAnimacion: true }); return; }
      var cat = t.closest('.js-py2a-cat');
      if (cat) { f.categoria = cat.getAttribute('data-cat'); PY.pintar({ sinAnimacion: true }); return; }
      if (t.closest('.js-py2a-subir')) { abrirSubir(ctx); return; }
      var bajar = t.closest('.js-py2a-bajar');
      if (bajar) { ev.stopPropagation(); descargarDoc(bajar.getAttribute('data-id'), bajar); return; }
      var ref = t.closest('.js-py2a-ref');
      if (ref) { ev.stopPropagation(); irAReferencia(ref.getAttribute('data-tipo'), ref.getAttribute('data-id')); return; }
      var doc = t.closest('[data-py2-doc]');
      if (doc) { abrirDoc(ctx, doc.getAttribute('data-py2-doc')); return; }
      if (t.closest('.js-py2a-e-nuevo')) { abrirNuevoEntregable(ctx); return; }
      var m = t.closest('.js-py2a-e-marcar');
      if (m) { abrirMarcarEntregado(ctx, m.getAttribute('data-id')); return; }
      var ob = t.closest('.js-py2a-e-observar');
      if (ob) { abrirObservar(ctx, ob.getAttribute('data-id')); return; }
      var ap = t.closest('.js-py2a-e-aprobar');
      if (ap) {
        var e = entregablePorId(ctx, ap.getAttribute('data-id'));
        PY.accionConfirmada({ titulo: '¿Aprobar "' + (e ? e.nombre : '') + '"?', texto: 'Queda como aceptado y se le avisa al responsable.', boton: 'Aprobar',
          accion: 'revisarEntregableProyecto', datos: { entregable_id: ap.getAttribute('data-id'), resultado: 'APROBADO' }, aviso: 'Entregable aprobado.' });
        return;
      }
      var el = t.closest('.js-py2a-e-eliminar');
      if (el) {
        PY.accionConfirmada({ titulo: '¿Eliminar "' + el.getAttribute('data-nombre') + '"?', boton: 'Eliminar', peligro: true,
          accion: 'gestionarEntregableProyecto', datos: { accion: 'eliminar', entregable_id: el.getAttribute('data-id') }, aviso: 'Entregable eliminado.' });
      }
    });
    raiz.addEventListener('keydown', function (ev) {
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[data-py2-doc]')) { ev.preventDefault(); abrirDoc(ctx, ev.target.getAttribute('data-py2-doc')); }
    });

    // Arrastrar archivos sobre la tarjeta de documentos abre "Subir" con el archivo.
    var zona = raiz.querySelector('.js-py2a-docs');
    if (zona && PY.puedeAportar(ctx.detalle)) {
      var profundidad = 0;
      function conArchivos(ev) { return ev.dataTransfer && Array.prototype.indexOf.call(ev.dataTransfer.types || [], 'Files') !== -1; }
      zona.addEventListener('dragenter', function (ev) { if (!conArchivos(ev)) return; ev.preventDefault(); profundidad++; zona.classList.add('sx2-py-zona-docs--arrastre'); });
      zona.addEventListener('dragover', function (ev) { if (conArchivos(ev)) ev.preventDefault(); });
      zona.addEventListener('dragleave', function () { if (--profundidad <= 0) { profundidad = 0; zona.classList.remove('sx2-py-zona-docs--arrastre'); } });
      zona.addEventListener('drop', function (ev) {
        if (!conArchivos(ev)) return;
        ev.preventDefault();
        profundidad = 0;
        zona.classList.remove('sx2-py-zona-docs--arrastre');
        if (ev.dataTransfer.files.length) abrirSubir(ctx, ev.dataTransfer.files);
      });
    }
  }

  PY.secciones.archivos = { pintar: pintar, alMontar: alMontar };
})();
