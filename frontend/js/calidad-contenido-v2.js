/**
 * calidad-contenido-v2.js — Calidad: el documento ESCRITO en SIGSO (2026-09-29).
 *
 *  - Leer: el documento tal como sale en papel (encabezado con el logo de la
 *    empresa, código, versión y vigencia), en un iframe aislado con el mismo
 *    CSS que usa el PDF — lo que se ve es lo que se descarga.
 *  - Descargar PDF: lo genera el servidor (documentosVivosSgc.js) con el
 *    formato de los documentos originales.
 *  - Editar (quien gobierna el SGC): secciones con título y texto, control de
 *    cambios y el enlace a la copia de trabajo en Google Drive. Si la versión
 *    vigente ya fue confirmada por alguien, lo editado queda como BORRADOR y
 *    se publica como versión nueva (PRO-01, ISO 7.5).
 *  - Los documentos que se arman con datos (FODA, riesgos, DOC-10…13, listado
 *    maestro…) no se escriben aquí: se editan en su sección y el documento
 *    sale siempre al día. Aquí solo se agregan notas propias.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var AYUDA = 'Línea en blanco = párrafo nuevo · "- " viñeta · "1. " o "a) " lista · "### " subtítulo · **negrita** · tablas con "| col | col |" (la primera fila es el encabezado).';

  function C() { return window.SigsoCalidadV2.util; }
  function api(a, d) { return C().api(a, d); }
  function uid() { return 's' + Math.random().toString(36).slice(2, 10); }

  function descargarPdf(id, extra, boton) {
    if (boton) boton.disabled = true;
    PY.aviso('Generando el PDF…', 'info');
    return api('descargarDocumentoPdfSgc', Object.assign({ documento_id: id }, extra || {})).then(function (r) {
      if (boton) boton.disabled = false;
      if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo generar el PDF.', 'error'); return; }
      PY.descargarBase64(r.data.contenido_base64, r.data.nombre_archivo || 'documento.pdf', 'application/pdf');
    });
  }

  // Documento completo para el iframe: encabezado corporativo (sin número de
  // página) + el mismo cuerpo y CSS del PDF.
  function papel(x) {
    var cab = String(x.cabecera || '').replace(/<span class="pageNumber"><\/span> de <span class="totalPages"><\/span>/, '—');
    return '<!doctype html><html lang="es"><head><meta charset="utf-8"><style>' + x.css +
      'html{background:#e9ecef}body{background:#fff;max-width:210mm;margin:12px auto;padding:10mm 14mm 16mm;box-shadow:0 2px 12px rgba(0,0,0,.18)}' +
      '.cab{margin:0 -14mm 8mm}.portada__titulo{height:70mm}a{pointer-events:none}' +
      '@media (max-width:640px){body{padding:6mm}.cab{margin:0 -6mm 6mm}}</style></head><body>' +
      '<div class="cab">' + cab + '</div>' + x.html + '</body></html>';
  }
  function iframe(x) {
    var f = document.createElement('iframe');
    f.className = 'dv2-papel';
    f.setAttribute('title', 'Vista del documento ' + x.codigo);
    f.setAttribute('sandbox', 'allow-same-origin');
    f.srcdoc = papel(x);
    f.addEventListener('load', function () {
      try { f.style.height = (f.contentDocument.documentElement.scrollHeight + 8) + 'px'; } catch (e) { /* sin acceso: queda la altura base */ }
    });
    return f;
  }

  // --- Leer ------------------------------------------------------------------------
  function leer(id) {
    var d = U.drawer({ titulo: 'Documento', subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Cargando…</span>', cuerpo: U.esqueleto('tabla', 6), pie: ' ' });
    d.el.classList.add('dv2-drawer');
    var x = null;
    function cargar() {
      api('getContenidoDocumentoSgc', { documento_id: id }).then(function (r) {
        if (!d.el.isConnected) return;
        if (!r || !r.ok) { d.cuerpo(U.vacio({ icono: 'alerta', titulo: 'No se pudo abrir', texto: (r && r.message) || 'Inténtalo de nuevo.' })); return; }
        x = r.data;
        pintar();
      });
    }
    function pintar() {
      d.el.querySelector('.sx2-drawer__titulo').textContent = x.nombre;
      var sub = d.el.querySelector('.sx2-drawer__fila-titulo .sx2-apilado');
      sub.querySelectorAll('.sx2-tenue, .dv2-sub').forEach(function (e) { e.remove(); });
      sub.insertAdjacentHTML('beforeend', '<span class="dv2-sub sx2-flex" style="gap:8px;flex-wrap:wrap">' + U.badge(C().TIPO[x.tipo] || x.tipo, 'info') +
        '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(x.codigo + ' · versión ' + (x.meta.version || '—') + (x.meta.vigencia ? ' · vigente desde ' + x.meta.vigencia : '')) + '</span>' +
        (x.fuente ? U.badge('Se arma con ' + x.fuente_info.etiqueta, 'primario', true) : '') + (x.borrador ? U.badge('Hay un borrador sin publicar', 'alerta', true) : '') + '</span>');
      var aviso = !x.tiene_contenido
        ? '<div class="dv2-aviso sx2-tono-alerta">' + U.ico('documento', 15) + '<span>Este documento todavía no tiene su texto en SIGSO.' + (x.puede_editar ? ' Usa <b>Escribir en SIGSO</b> para cargarlo.' : '') + (x.enlace_drive ? ' Mientras tanto, puedes abrir la copia en Google Drive.' : '') + '</span></div>'
        : (x.fuente ? '<div class="dv2-aviso sx2-tono-info">' + U.ico('destello', 15) + '<span>Este documento se arma con los datos de <b>' + U.esc(x.fuente_info.etiqueta) + '</b>: para cambiarlo, edita esa sección y el documento se actualiza solo.</span>' +
          (x.puede_editar ? U.boton({ texto: 'Ir a ' + x.fuente_info.etiqueta, sm: true, clase: 'js-dv2-ir', datos: { ir: x.fuente_info.seccion } }) : '') + '</div>' : '');
      d.cuerpo(aviso + '<div class="dv2-marco"></div>');
      if (x.tiene_contenido) d.el.querySelector('.dv2-marco').appendChild(iframe(x));
      d.el.querySelector('.sx2-drawer__pie').innerHTML =
        (x.tiene_contenido ? U.boton({ texto: 'Descargar PDF', icono: 'descargar', variante: 'primario', clase: 'js-dv2-pdf' }) : '') +
        (x.enlace_drive ? '<a class="sx2-boton sx2-boton--secundario" href="' + U.esc(x.enlace_drive) + '" target="_blank" rel="noopener noreferrer">' + U.ico('enlace', 16) + 'Abrir en Google Drive</a>' : '') +
        (x.puede_editar ? U.boton({ texto: x.tiene_contenido && !x.fuente ? 'Editar texto' : (x.fuente ? 'Notas y enlace' : 'Escribir en SIGSO'), icono: 'editar', clase: 'js-dv2-editar' }) : '') +
        (x.puede_editar && x.borrador ? U.boton({ texto: 'PDF del borrador', icono: 'ojo', variante: 'fantasma', clase: 'js-dv2-pdf-borrador' }) : '') +
        U.boton({ texto: 'Cerrar', clase: 'js-sx2-drawer-cerrar' });
    }
    d.el.addEventListener('click', function (ev) {
      var b, t = ev.target;
      if ((b = t.closest('.js-dv2-pdf'))) { descargarPdf(id, null, b); return; }
      if ((b = t.closest('.js-dv2-pdf-borrador'))) { descargarPdf(id, { borrador: true }, b); return; }
      if (t.closest('.js-dv2-editar')) { d.cerrar(true); editar(id); return; }
      if ((b = t.closest('.js-dv2-ir'))) { d.cerrar(true); if (window.SigsoCalidad) SigsoCalidad.irAItem(b.getAttribute('data-ir')); }
    });
    cargar();
    return d;
  }

  // --- Editar ------------------------------------------------------------------------
  function editar(id) {
    var d = U.drawer({ titulo: 'Editar documento', subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Cargando…</span>', cuerpo: U.esqueleto('tabla', 6), pie: ' ' });
    d.el.classList.add('dv2-drawer');
    var x = null, c = null, sucio = false;

    api('getContenidoDocumentoSgc', { documento_id: id }).then(function (r) {
      if (!d.el.isConnected) return;
      if (!r || !r.ok) { d.cuerpo(U.vacio({ icono: 'alerta', titulo: 'No se pudo abrir', texto: (r && r.message) || 'Inténtalo de nuevo.' })); return; }
      x = r.data;
      if (!x.puede_editar) { d.cuerpo(U.vacio({ icono: 'candado', titulo: 'Sin permiso', texto: 'Solo el Encargado del SGC puede editar documentos.' })); return; }
      var base = x.borrador || x.contenido || (x.fuente ? { secciones: [], control_cambios: [] } : x.plantilla);
      c = JSON.parse(JSON.stringify(base));
      c.secciones = (c.secciones || []).map(function (s) { return { id: s.id || uid(), titulo: s.titulo || '', texto: s.texto || '' }; });
      c.control_cambios = c.control_cambios || [];
      pintar();
    });

    function pintar() {
      d.el.querySelector('.sx2-drawer__titulo').textContent = x.nombre;
      var sub = d.el.querySelector('.sx2-drawer__fila-titulo .sx2-apilado');
      sub.querySelectorAll('.sx2-tenue, .dv2-sub').forEach(function (e) { e.remove(); });
      sub.insertAdjacentHTML('beforeend', '<span class="dv2-sub sx2-tenue" style="font-size:.8125rem">' + U.esc(x.codigo + ' · versión vigente ' + (x.meta.version || '—')) +
        (x.borrador ? ' · editando el borrador' : '') + '</span>');
      var h = '';
      if (x.version_confirmada && !x.fuente) {
        h += '<div class="dv2-aviso sx2-tono-info">' + U.ico('candado', 15) + '<span>Alguien ya confirmó la lectura de la versión vigente: lo que guardes queda como <b>borrador</b> y rige cuando lo publiques como versión nueva.</span></div>';
      }
      if (x.fuente) {
        h += '<div class="dv2-aviso sx2-tono-info">' + U.ico('destello', 15) + '<span>El cuerpo de este documento se arma con los datos de <b>' + U.esc(x.fuente_info.etiqueta) + '</b>. Aquí puedes agregar notas propias (alcance, criterios, observaciones), que van a continuación.</span></div>';
      }
      h += '<label class="dv2-campo"><span>Copia de trabajo en Google Drive</span><input type="url" class="sx2-input js-dv2-drive" placeholder="https://docs.google.com/…" value="' + U.esc(x.enlace_drive || '') + '">' +
        '<small class="sx2-tenue">Se muestra como “Abrir en Google Drive” mientras el documento se termina de mudar a SIGSO.</small></label>';
      h += '<div class="dv2-ayuda">' + U.ico('info', 14) + '<span>' + U.esc(AYUDA) + '</span></div>';
      h += '<ol class="dv2-secciones">' + c.secciones.map(function (s, i) {
        return '<li class="dv2-sec" data-i="' + i + '">' +
          '<div class="dv2-sec__cab"><span class="dv2-sec__n">' + (i + 1) + '</span>' +
            '<input type="text" class="sx2-input js-dv2-titulo" value="' + U.esc(s.titulo) + '" placeholder="Título de la sección" aria-label="Título de la sección ' + (i + 1) + '">' +
            U.boton({ soloIcono: true, icono: 'arriba', sm: true, variante: 'fantasma', titulo: 'Subir', clase: 'js-dv2-subir', deshabilitado: i === 0 }) +
            U.boton({ soloIcono: true, icono: 'abajo', sm: true, variante: 'fantasma', titulo: 'Bajar', clase: 'js-dv2-bajar', deshabilitado: i === c.secciones.length - 1 }) +
            U.boton({ soloIcono: true, icono: 'basura', sm: true, variante: 'fantasma', titulo: 'Quitar sección', clase: 'js-dv2-quitar' }) + '</div>' +
          '<textarea class="sx2-input dv2-texto js-dv2-texto" rows="' + Math.min(18, Math.max(4, String(s.texto).split('\n').length + 1)) + '" aria-label="Texto de la sección ' + (i + 1) + '">' + U.esc(s.texto) + '</textarea></li>';
      }).join('') + '</ol>';
      h += '<div>' + U.boton({ texto: 'Agregar sección', icono: 'mas', sm: true, clase: 'js-dv2-agregar' }) + '</div>';
      h += '<section class="sx2-seccion-drawer"><h3 class="sx2-seccion-drawer__titulo">Control de cambios</h3>' +
        '<p class="sx2-tenue" style="margin:0;font-size:.8125rem">Historial previo a SIGSO. Las versiones que publiques aquí se agregan solas.</p>' +
        '<ul class="dv2-cc">' + c.control_cambios.map(function (f, i) {
          return '<li data-i="' + i + '"><input type="text" class="sx2-input js-dv2-cc-v" value="' + U.esc(f.version) + '" placeholder="01" aria-label="Versión">' +
            '<input type="text" class="sx2-input js-dv2-cc-f" value="' + U.esc(f.fecha) + '" placeholder="Junio 2026" aria-label="Fecha">' +
            '<input type="text" class="sx2-input js-dv2-cc-d" value="' + U.esc(f.descripcion) + '" placeholder="Qué cambió" aria-label="Modificación">' +
            U.boton({ soloIcono: true, icono: 'basura', sm: true, variante: 'fantasma', titulo: 'Quitar', clase: 'js-dv2-cc-quitar' }) + '</li>';
        }).join('') + '</ul>' + U.boton({ texto: 'Agregar fila', icono: 'mas', sm: true, variante: 'fantasma', clase: 'js-dv2-cc-agregar' }) + '</section>';
      if (x.borrador) {
        h += '<section class="sx2-seccion-drawer dv2-publicar"><h3 class="sx2-seccion-drawer__titulo">Publicar el borrador como versión nueva</h3>' +
          '<div class="dv2-publicar__fila"><label><span>Nueva versión</span><input type="text" class="sx2-input js-dv2-pub-v" placeholder="v0' + (Number(String(x.meta.version).replace(/\D/g, '')) + 1 || 2) + '"></label>' +
          '<label style="flex:1"><span>Qué cambió</span><input type="text" class="sx2-input js-dv2-pub-c" placeholder="Queda en el control de cambios"></label></div>' +
          '<div class="sx2-flex" style="gap:8px">' + U.boton({ texto: 'Publicar versión', icono: 'check', variante: 'primario', clase: 'js-dv2-publicar' }) +
          U.boton({ texto: 'Descartar borrador', variante: 'fantasma', clase: 'js-dv2-descartar' }) + '</div></section>';
      }
      d.cuerpo(h);
      d.el.querySelector('.sx2-drawer__pie').innerHTML =
        U.boton({ texto: 'Guardar', icono: 'check', variante: 'primario', clase: 'js-dv2-guardar' }) +
        (!x.fuente && !x.version_confirmada ? U.boton({ texto: 'Guardar como borrador', clase: 'js-dv2-guardar-borrador' }) : '') +
        U.boton({ texto: 'Ver documento', icono: 'ojo', variante: 'fantasma', clase: 'js-dv2-ver' }) +
        U.boton({ texto: 'Cerrar', clase: 'js-dv2-cerrar' });
    }

    // Lee el formulario al modelo (antes de reordenar, agregar o guardar).
    function leerForm() {
      d.el.querySelectorAll('.dv2-sec').forEach(function (li) {
        var s = c.secciones[Number(li.getAttribute('data-i'))];
        if (!s) return;
        s.titulo = li.querySelector('.js-dv2-titulo').value;
        s.texto = li.querySelector('.js-dv2-texto').value;
      });
      d.el.querySelectorAll('.dv2-cc li').forEach(function (li) {
        var f = c.control_cambios[Number(li.getAttribute('data-i'))];
        if (!f) return;
        f.version = li.querySelector('.js-dv2-cc-v').value;
        f.fecha = li.querySelector('.js-dv2-cc-f').value;
        f.descripcion = li.querySelector('.js-dv2-cc-d').value;
      });
    }
    function guardar(modo, boton) {
      leerForm();
      var drive = (d.el.querySelector('.js-dv2-drive') || {}).value || '';
      boton.disabled = true;
      return api('guardarContenidoDocumentoSgc', { documento_id: id, contenido: c, modo: modo, enlace_drive: drive.trim() }).then(function (r) {
        boton.disabled = false;
        if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo guardar.', 'error'); return false; }
        sucio = false;
        PY.aviso(r.data.message || 'Guardado.', 'exito');
        if (window.SigsoCalidadV2) SigsoCalidadV2.refrescarDocumentos();
        return r.data;
      });
    }
    function cerrar() {
      if (!sucio) { d.cerrar(); return; }
      U.confirmar({ titulo: 'Hay cambios sin guardar', texto: 'Si cierras, se pierden.', boton: 'Cerrar sin guardar', peligro: true }).then(function (si) { if (si) d.cerrar(); });
    }

    d.el.addEventListener('input', function () { sucio = true; });
    d.el.addEventListener('click', function (ev) {
      var b, t = ev.target, li;
      if (t.closest('.js-dv2-cerrar')) { cerrar(); return; }
      if ((b = t.closest('.js-dv2-agregar'))) { leerForm(); c.secciones.push({ id: uid(), titulo: '', texto: '' }); sucio = true; pintar(); var ts = d.el.querySelectorAll('.js-dv2-titulo'); if (ts.length) ts[ts.length - 1].focus(); return; }
      if ((b = t.closest('.js-dv2-subir, .js-dv2-bajar, .js-dv2-quitar'))) {
        leerForm();
        li = b.closest('.dv2-sec');
        var i = Number(li.getAttribute('data-i'));
        if (b.classList.contains('js-dv2-quitar')) {
          U.confirmar({ titulo: 'Quitar sección', texto: 'Se quita "' + (c.secciones[i].titulo || 'sin título') + '" del documento (al guardar).', boton: 'Quitar', peligro: true }).then(function (si) {
            if (!si) return;
            c.secciones.splice(i, 1); sucio = true; pintar();
          });
          return;
        }
        var j = b.classList.contains('js-dv2-subir') ? i - 1 : i + 1;
        var tmp = c.secciones[i]; c.secciones[i] = c.secciones[j]; c.secciones[j] = tmp;
        sucio = true; pintar();
        return;
      }
      if (t.closest('.js-dv2-cc-agregar')) { leerForm(); c.control_cambios.push({ version: '', fecha: '', descripcion: '' }); sucio = true; pintar(); return; }
      if ((b = t.closest('.js-dv2-cc-quitar'))) { leerForm(); c.control_cambios.splice(Number(b.closest('li').getAttribute('data-i')), 1); sucio = true; pintar(); return; }
      if ((b = t.closest('.js-dv2-guardar'))) { guardar('vigente', b).then(function (ok) { if (ok) { d.cerrar(true); leer(id); } }); return; }
      if ((b = t.closest('.js-dv2-guardar-borrador'))) { guardar('borrador', b).then(function (ok) { if (ok) { d.cerrar(true); editar(id); } }); return; }
      if (t.closest('.js-dv2-ver')) {
        if (sucio) { PY.aviso('Guarda primero para ver el documento con tus cambios.', 'info'); return; }
        d.cerrar(true); leer(id); return;
      }
      if ((b = t.closest('.js-dv2-publicar'))) {
        var v = d.el.querySelector('.js-dv2-pub-v').value.trim(), cam = d.el.querySelector('.js-dv2-pub-c').value.trim();
        if (!v || !cam) { PY.aviso('Indica la nueva versión y qué cambió.', 'error'); return; }
        var publicar = function () {
          b.disabled = true;
          api('publicarContenidoDocumentoSgc', { documento_id: id, version: v, cambios: cam }).then(function (r) {
            b.disabled = false;
            if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo publicar.', 'error'); return; }
            PY.aviso(r.data.message, 'exito');
            if (window.SigsoCalidadV2) SigsoCalidadV2.refrescarDocumentos();
            d.cerrar(true); leer(id);
          });
        };
        if (sucio) { var g = d.el.querySelector('.js-dv2-guardar-borrador') || d.el.querySelector('.js-dv2-guardar'); guardar('borrador', g).then(function (ok) { if (ok) publicar(); }); } else publicar();
        return;
      }
      if (t.closest('.js-dv2-descartar')) {
        U.confirmar({ titulo: 'Descartar borrador', texto: 'Se pierde lo editado desde la versión vigente.', boton: 'Descartar', peligro: true }).then(function (si) {
          if (!si) return;
          api('descartarBorradorDocumentoSgc', { documento_id: id }).then(function (r) {
            if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo descartar.', 'error'); return; }
            PY.aviso('Borrador descartado.', 'exito');
            d.cerrar(true); editar(id);
          });
        });
      }
    });
    return d;
  }

  // --- Carga desde Drive (solo super admin) ------------------------------------------
  // Recibe el paquete .json armado con la información del Drive del SGC,
  // primero lo SIMULA (el servidor hace todo y lo revierte: muestra cómo
  // quedaría la cobertura) y solo con la confirmación lo guarda.
  var ETIQUETAS_CONTEO = {
    documentos_actualizados: 'Documentos con enlace, cláusulas o estado al día', documentos_escritos: 'Documentos con su texto escrito en SIGSO',
    versiones: 'Versiones nuevas registradas', factores: 'Factores de contexto nuevos', riesgos: 'Riesgos nuevos', lecturas: 'Mediciones de objetivos',
    auditorias: 'Auditorías internas', hallazgos: 'Hallazgos de auditoría', nc: 'No conformidades', acuerdos: 'Acuerdos de revisión por la dirección',
    tareas: 'Tareas asignadas (Mi trabajo)', inducciones: 'Ítems de inducción completados', capacitaciones: 'Capacitaciones programadas',
    procesos_renombrados: 'Procesos con nombre corregido', procesos_nuevos: 'Procesos de servicio nuevos', procesos_con_responsable: 'Procesos con responsable asignado',
    prestaciones: 'Servicios prestados registrados', desvinculadas: 'Personas desvinculadas'
  };
  var ESTADO_COB = { COMPLETO: 'completa', PARCIAL: 'parcial', FALTANTE: 'faltante', NO_APLICA: 'no aplica' };
  function lista_(titulo, items, tono) {
    if (!items || !items.length) return '';
    return '<details class="dv2-carga__lista"' + (tono === 'alerta' ? ' open' : '') + '><summary>' + U.esc(titulo) + ' (' + items.length + ')</summary><ul>' +
      items.map(function (x) { return '<li>' + U.esc(x) + '</li>'; }).join('') + '</ul></details>';
  }
  function resultado_(r) {
    var a = r.cobertura_antes || {}, b = r.cobertura_despues || {};
    var cambian = Object.keys(b.por_clausula || {}).filter(function (k) { return (a.por_clausula || {})[k] !== b.por_clausula[k]; });
    var conteo = Object.keys(r.conteo || {}).filter(function (k) { return r.conteo[k]; });
    return '<div class="dv2-carga__cob">' +
        '<div><span class="dv2-carga__pct">' + (a.pct || 0) + '%</span><small>Cobertura ISO hoy</small></div>' + U.ico('derecha', 20) +
        '<div><span class="dv2-carga__pct dv2-carga__pct--ok">' + (b.pct || 0) + '%</span><small>' + (r.simulacion ? 'Quedaría' : 'Queda') + ' en</small></div>' +
        '<p>' + b.completo + ' cláusulas completas · ' + b.parcial + ' parciales · ' + b.faltante + ' faltantes</p></div>' +
      (cambian.length ? '<p class="dv2-carga__nota">' + cambian.map(function (k) { return '<b>' + U.esc(k) + '</b> ' + ESTADO_COB[(a.por_clausula || {})[k]] + ' → ' + ESTADO_COB[b.por_clausula[k]]; }).join(' · ') + '</p>' : '') +
      (conteo.length ? '<ul class="dv2-carga__conteo">' + conteo.map(function (k) { return '<li><span>' + U.esc(ETIQUETAS_CONTEO[k] || k) + '</span><b>' + r.conteo[k] + '</b></li>'; }).join('') + '</ul>'
        : '<p class="dv2-carga__nota">No hay nada nuevo que cargar: todo ya estaba en SIGSO.</p>') +
      lista_('Revisar', r.avisos, 'alerta') + lista_('Ya estaba (no se tocó)', r.omitidos) + lista_('Detalle de lo cargado', r.hechos);
  }
  function cargaDrive(alGuardar) {
    var guardado = false;
    var d = U.drawer({ titulo: 'Cargar información desde Drive', cuerpo: '', pie: ' ', alCerrar: function () { if (guardado && alGuardar) alGuardar(); } });
    d.el.classList.add('dv2-drawer');
    var paquete = null;
    function pie(html) { d.el.querySelector('.sx2-drawer__pie').innerHTML = html + U.boton({ texto: 'Cerrar', clase: 'js-sx2-drawer-cerrar' }); }
    function inicio(msg) {
      d.cuerpo('<div class="dv2-aviso sx2-tono-info">' + U.ico('info', 15) + '<span>Elige el archivo del paquete (<b>.json</b>). Primero se <b>simula</b>: verás cómo quedaría el módulo sin guardar nada. Recién al confirmar se guarda.</span></div>' +
        (msg ? '<div class="dv2-aviso sx2-tono-critico">' + U.ico('alerta', 15) + '<span>' + U.esc(msg) + '</span></div>' : '') +
        '<label class="dv2-carga__archivo"><input type="file" accept=".json,application/json" class="js-dv2-archivo"><span>' + U.ico('subir', 18) + 'Elegir paquete .json</span></label>');
      pie('');
    }
    function ejecutar(simular, boton) {
      if (boton) boton.disabled = true;
      d.cuerpo(U.esqueleto('tabla', 5));
      api('importarCargaDriveSgc', { paquete: paquete, simular: simular }).then(function (r) {
        if (!d.el.isConnected) return;
        if (!r || !r.ok) { inicio((r && r.message) || 'No se pudo procesar el paquete.'); return; }
        var ok = r.data;
        if (!simular) guardado = true;
        d.cuerpo((simular ? '<div class="dv2-aviso sx2-tono-alerta">' + U.ico('ojo', 15) + '<span><b>Simulación:</b> todavía no se guardó nada.</span></div>'
          : '<div class="dv2-aviso sx2-tono-ok">' + U.ico('check', 15) + '<span><b>Carga guardada.</b> Ya puedes revisar cada sección del módulo.</span></div>') + resultado_(ok));
        pie(simular ? U.boton({ texto: 'Confirmar y guardar', icono: 'check', variante: 'primario', clase: 'js-dv2-confirmar' }) : '');
        if (!simular) PY.aviso('Carga desde Drive guardada.', 'exito');
      });
    }
    d.el.addEventListener('change', function (ev) {
      var inp = ev.target.closest('.js-dv2-archivo');
      if (!inp || !inp.files || !inp.files[0]) return;
      var lector = new FileReader();
      lector.onload = function () {
        try { paquete = JSON.parse(String(lector.result)); } catch (e) { inicio('El archivo no es un JSON válido.'); return; }
        ejecutar(true);
      };
      lector.readAsText(inp.files[0], 'utf-8');
    });
    d.el.addEventListener('click', function (ev) {
      var b = ev.target.closest('.js-dv2-confirmar');
      if (!b) return;
      U.confirmar({ titulo: 'Guardar la carga', texto: 'Se escribe en SIGSO todo lo que mostró la simulación. Se puede volver a correr sin duplicar nada.', boton: 'Guardar' }).then(function (si) { if (si) ejecutar(false, b); });
    });
    inicio('');
    return d;
  }

  window.SigsoCalidadContenido = { leer: leer, editar: editar, descargarPdf: descargarPdf, cargaDrive: cargaDrive };
})();
