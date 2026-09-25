/**
 * calidad-documentos-v2.js — Calidad: Documentos v2 (SIGSO v2, Módulo 8B;
 * análisis y decisiones en documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 *  - Lista con buscador instantáneo, tipos y "por confirmar"; el documento se
 *    abre en un panel lateral (el mismo que usa el Inicio de SIGSO).
 *  - Quien gobierna el SGC ve en cada documento lo que le falta para estar
 *    controlado (backend alertasControlSgc_) y lo arregla desde el panel, y
 *    tiene la pestaña "Control documental" para arreglarlo EN LOTE:
 *    revisión y aprobación (7.5.2), copia controlada en PDF en vez de un
 *    enlace editable (7.5.3), normas externas que quedaron obsoletas y la
 *    revisión anual.
 *  - Cargar, nueva versión, editar y cláusulas usan los formularios de
 *    calidad.js (SigsoCalidad.formulario): mismas validaciones.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var ICONO = { DOC: 'documento', PRO: 'estado', INS: 'lista', FO: 'etiqueta', EXTERNO: 'empresa' };
  var PLURAL = { DOC: 'Documentos maestros', PRO: 'Procedimientos', INS: 'Instructivos', FO: 'Formularios', EXTERNO: 'Normas y leyes' };
  var ALERTA = {
    sin_aprobacion: { txt: 'Falta aprobación', tono: 'alerta', ico: 'check' },
    sin_copia: { txt: 'Sin copia controlada', tono: 'alerta', ico: 'candado' },
    externo_fuera: { txt: '¿Sigue vigente?', tono: 'critico', ico: 'alerta' },
    revision: { txt: 'Revisión anual', tono: 'info', ico: 'calendario' }
  };
  var MAX_MB = 10;
  var docs_ = null, control_ = null, sinControl_ = false, turno_ = 0;
  var tab_ = 'lista', q_ = '', tipo_ = '', estado_ = 'VIGENTE', soloPend_ = false, soloControl_ = false;
  var selAprob_ = null, selExt_ = null;

  function C() { return window.SigsoCalidadV2.util; }
  function api(a, d) { return C().api(a, d); }
  function TIPO() { return C().TIPO; }
  function gestiona() { return !!(docs_ && docs_.puede_gestionar); }
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  // En una norma externa la "versión" es el año de la edición (ISO 9001:2015 → 2015).
  function version(v, tipo) { v = String(v || '').trim(); if (!v) return ''; if (tipo === 'EXTERNO') return 'Ed. ' + v; return v.charAt(0) === 'v' ? v : 'v' + v; }
  function editable(url) { return /docs\.google\.com\/.+\/edit/.test(url || ''); }
  function avisarCambio() { document.dispatchEvent(new CustomEvent('sigso:sgc-acuse')); }

  function leerArchivo(file) {
    return new Promise(function (ok, mal) {
      if (!file) { mal(new Error('Elige un archivo.')); return; }
      if (file.size > MAX_MB * 1024 * 1024) { mal(new Error('El archivo supera ' + MAX_MB + ' MB.')); return; }
      var r = new FileReader();
      r.onload = function () { ok({ contenido_base64: String(r.result).split(',')[1] || '', nombre_archivo: file.name }); };
      r.onerror = function () { mal(new Error('No se pudo leer el archivo.')); };
      r.readAsDataURL(file);
    });
  }
  function elegirArchivo() {
    return new Promise(function (ok) {
      var inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.pdf,.docx,.doc,.xlsx,.xls';
      inp.addEventListener('change', function () { ok(inp.files && inp.files[0]); });
      inp.click();
    });
  }
  // Adjunta el archivo a la versión VIGENTE (actualizarDocumentoSgc): el
  // backend lo rechaza si alguien ya confirmó esa versión.
  function subirCopia(id, alTerminar) {
    elegirArchivo().then(function (f) {
      if (!f) return;
      return leerArchivo(f).then(function (a) {
        PY.aviso('Subiendo ' + a.nombre_archivo + '…', 'info');
        return api('actualizarDocumentoSgc', { documento_id: id, contenido_base64: a.contenido_base64, nombre_archivo: a.nombre_archivo });
      }).then(function (r) {
        if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo subir el archivo.', 'error'); return; }
        PY.aviso('Copia controlada cargada.', 'exito');
        if (alTerminar) alTerminar();
        refrescar();
      }, function (e) { PY.aviso(e.message, 'error'); });
    });
  }
  function lote(ids, cambios) {
    return api('actualizarDocumentosEnLoteSgc', { documento_ids: ids, cambios: cambios }).then(function (r) {
      if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo guardar.', 'error'); return null; }
      var n = r.data.aplicados;
      PY.aviso(n + ' documento' + (n === 1 ? '' : 's') + ' actualizado' + (n === 1 ? '' : 's') + (r.data.fallas.length ? ' · ' + r.data.fallas.length + ' con error' : ''), r.data.fallas.length ? 'error' : 'exito');
      if (window.SigsoCalidad && SigsoCalidad.invalidar) SigsoCalidad.invalidar();
      return r.data;
    });
  }
  function formulario(nombre, d, extra) {
    if (!window.SigsoCalidad || !SigsoCalidad.formulario) { PY.aviso('Abre Calidad para usar esta acción.', 'error'); return; }
    SigsoCalidad.formulario(nombre, d, extra);
  }
  function datalistFirmantes(id) {
    var f = (control_ && control_.firmantes) || [];
    return '<datalist id="' + id + '">' + f.map(function (n) { return '<option value="' + U.esc(n) + '">'; }).join('') + '</datalist>';
  }

  // --- Panel del documento (Documentos, Inicio de Calidad e Inicio de SIGSO) ---------
  function abrir(id) {
    var d = U.drawer({ titulo: 'Documento', subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Cargando…</span>', cuerpo: U.esqueleto('tabla', 5), pie: ' ' });
    d.el.classList.add('bj2-drawer', 'cq2-drawer');
    var x = null, cumpl = null;

    function cargarDoc() {
      return api('getDocumentoSgc', { documento_id: id }).then(function (r) {
        if (!r || !r.ok) { d.cuerpo(U.vacio({ icono: 'alerta', titulo: 'No se pudo abrir', texto: (r && r.message) || 'Inténtalo de nuevo.' })); return; }
        x = r.data;
        pintar();
        if (x.puede_gestionar && x.documento.requiere_acuse && !cumpl) {
          api('getCumplimientoDocumentoSgc', { documento_id: id }).then(function (c) {
            if (!c || !c.ok || !d.el.isConnected) return;
            cumpl = c.data;
            var correos = cumpl.pendientes.concat(cumpl.confirmados.map(function (p) { return p.usuario_email; }));
            (window.SigsoDirectorio ? SigsoDirectorio.resolver(correos) : Promise.resolve()).then(function () { if (d.el.isConnected) pintar(); });
          });
        }
      });
    }

    function pintar() {
      var doc = x.documento, gest = x.puede_gestionar, obsoleto = doc.estado === 'OBSOLETO';
      d.el.querySelector('.sx2-drawer__titulo').textContent = doc.nombre;
      var cab = d.el.querySelector('.sx2-drawer__fila-titulo .sx2-apilado');
      cab.querySelectorAll('.sx2-tenue, .bj2-det-sub').forEach(function (e) { e.remove(); });
      cab.insertAdjacentHTML('beforeend', '<span class="bj2-det-sub sx2-flex">' + U.badge(TIPO()[doc.tipo] || doc.tipo, 'info') +
        (obsoleto ? U.badge('Obsoleto', 'critico') : '') +
        '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(doc.codigo + (version(doc.version_vigente, doc.tipo) ? ' · ' + version(doc.version_vigente, doc.tipo) : '')) + '</span></span>');
      var p = C().plazo(doc.fecha_limite_acuse ? C().diasHasta(doc.fecha_limite_acuse) : null);
      var enlaces = (doc.enlaces || []).filter(function (e) { return e && /^https?:\/\//i.test(e.url || ''); });
      var h =
        (x.debo_acusar ? '<p class="nv2-acuse sx2-tono-' + p.tono + '">' + U.ico('reloj', 15) + 'Te piden confirmar que lo leíste' + (doc.fecha_limite_acuse ? ' · ' + p.txt : '') + '.</p>'
          : (x.mi_acuse ? '<p class="nv2-acuse sx2-tono-ok">' + U.ico('check', 15) + 'Confirmaste la lectura el ' + U.esc(C().fechaChile(x.mi_acuse)) + '.</p>' : '')) +
        (obsoleto && doc.tipo !== 'EXTERNO' ? '<p class="nv2-acuse sx2-tono-critico">' + U.ico('alerta', 15) + 'Fuera de circulación: se conserva para trazabilidad y no debe usarse.</p>' : '') +
        (gest ? bloqueControl(x.control || [], doc, enlaces) : '') +
        (doc.descripcion ? '<p class="nv2-resumen">' + U.esc(doc.descripcion) + '</p>' : '') +
        bloqueArchivo(doc, enlaces) +
        '<dl class="cq2-ficha">' +
          fila('Vigente desde', doc.fecha_vigencia ? PY.fecha(doc.fecha_vigencia, true) : '') +
          (gest ? fila('Próxima revisión', doc.proxima_revision ? PY.fecha(doc.proxima_revision, true) : '') : '') +
          fila('Área', doc.area_id) +
          (doc.emisor ? fila('Emisor', doc.emisor) : '') +
          fila('Elaborado por', doc.elaborado_por) +
          fila('Revisado por', doc.revisado_por) +
          fila('Aprobado por', doc.aprobado_por ? doc.aprobado_por + (doc.fecha_aprobacion ? ' · ' + C().fechaChile(doc.fecha_aprobacion) : '') : '') +
        '</dl>' +
        bloqueClausulas(doc, gest) +
        (gest && doc.requiere_acuse ? bloqueCumplimiento() : '') +
        (gest && (x.versiones || []).length ? bloqueVersiones(x.versiones) : '');
      d.cuerpo(h);
      d.el.querySelector('.sx2-drawer__pie').innerHTML =
        (x.debo_acusar ? U.boton({ texto: 'Confirmo que lo leí', icono: 'check', variante: 'primario', clase: 'js-dc2-confirmar' }) : '') +
        (gest && window.SigsoCalidad ? U.boton({ texto: 'Editar', icono: 'editar', clase: 'js-dc2-editar' }) +
          U.boton({ texto: 'Nueva versión', icono: 'subir', clase: 'js-dc2-version' }) : '') +
        (gest ? (obsoleto ? U.boton({ texto: 'Volver a vigente', clase: 'js-dc2-vigente' }) : U.boton({ texto: 'Marcar obsoleto', variante: 'fantasma', clase: 'js-dc2-obsoleto' })) : '') +
        U.boton({ texto: 'Cerrar', clase: 'js-sx2-drawer-cerrar' });
    }
    function fila(k, v) { return v ? '<dt>' + U.esc(k) + '</dt><dd>' + U.esc(v) + '</dd>' : ''; }

    function bloqueControl(alertas, doc, enlaces) {
      if (!alertas.length) return '';
      return '<section class="dc2-control">' + alertas.map(function (a) {
        var t = ALERTA[a];
        if (a === 'sin_aprobacion') {
          return '<div class="dc2-alerta sx2-tono-' + t.tono + '"><strong>' + U.ico(t.ico, 15) + 'Falta registrar la revisión y aprobación (ISO 7.5.2)</strong>' +
            '<div class="dc2-aprob">' +
              '<label><span>Revisado por</span><input type="text" class="js-dc2-rev" list="dc2-firmantes-d" value="' + U.esc(doc.revisado_por || '') + '"></label>' +
              '<label><span>Aprobado por</span><input type="text" class="js-dc2-apr" list="dc2-firmantes-d" value="' + U.esc(doc.aprobado_por || '') + '"></label>' +
              U.boton({ texto: 'Registrar', sm: true, variante: 'primario', clase: 'js-dc2-aprobar' }) +
            '</div>' + datalistFirmantes('dc2-firmantes-d') + '</div>';
        }
        if (a === 'sin_copia') {
          var ed = enlaces.some(function (e) { return editable(e.url); });
          return '<div class="dc2-alerta sx2-tono-' + t.tono + '"><strong>' + U.ico(t.ico, 15) + 'Sin copia controlada (ISO 7.5.3)</strong>' +
            '<span>' + (enlaces.length ? (ed ? 'Se abre por un enlace de Google Docs editable: cualquiera con el enlace puede cambiarlo y la versión no queda protegida.' : 'Se abre solo por un enlace externo.') : 'No tiene archivo ni enlace: nadie puede consultarlo.') +
              ' Sube el PDF de la versión vigente; el enlace se conserva para consulta.</span>' +
            U.boton({ texto: 'Subir PDF', icono: 'subir', sm: true, variante: 'primario', clase: 'js-dc2-subir' }) + '</div>';
        }
        if (a === 'externo_fuera') {
          return '<div class="dc2-alerta sx2-tono-' + t.tono + '"><strong>' + U.ico(t.ico, 15) + 'Norma externa fuera de circulación</strong>' +
            '<span>Está marcada obsoleta, así que el personal no la ve. Si sigue rigiendo, devuélvela a vigente.</span>' +
            U.boton({ texto: 'Volver a vigente', sm: true, variante: 'primario', clase: 'js-dc2-vigente' }) + '</div>';
        }
        var dias = C().diasHasta(doc.proxima_revision);
        return '<div class="dc2-alerta sx2-tono-' + (dias < 0 ? 'critico' : t.tono) + '"><strong>' + U.ico(t.ico, 15) + (dias < 0 ? 'Revisión anual vencida hace ' + (-dias) + ' días' : 'Revisión anual en ' + dias + ' días') + '</strong>' +
          '<span>Revísalo y, si cambia, sube una versión nueva; si sigue igual, edítalo para renovar la fecha de vigencia.</span></div>';
      }).join('') + '</section>';
    }
    function bloqueArchivo(doc, enlaces) {
      var h = '';
      if (doc.archivo_id) {
        var pdf = doc.archivo_mime === 'application/pdf';
        h += '<div class="dc2-archivo">' +
          '<span class="bj2-archivo__ico sx2-tono-info">' + U.ico('documento', 18) + '</span>' +
          '<span class="sx2-apilado" style="gap:2px;flex:1;min-width:0"><strong class="sx2-cortar">' + U.esc(doc.archivo_nombre || 'Archivo') + '</strong>' +
            '<span class="sx2-tenue" style="font-size:.75rem">Copia controlada · ' + U.esc(version(doc.version_vigente, doc.tipo) || 'versión vigente') + '</span></span>' +
          (pdf && window.SigsoCalidad && SigsoCalidad.ver ? U.boton({ texto: 'Ver', icono: 'ojo', sm: true, clase: 'js-dc2-ver' }) : '') +
          U.boton({ texto: 'Descargar', icono: 'descargar', sm: true, variante: pdf ? 'secundario' : 'primario', clase: 'js-dc2-descargar' }) + '</div>';
      }
      if (enlaces.length) {
        h += '<ul class="dc2-enlaces">' + enlaces.map(function (e) {
          return '<li>' + U.ico('enlace', 14) + '<a class="sx2-enlace" href="' + U.esc(e.url) + '" target="_blank" rel="noopener noreferrer">' + U.esc(e.titulo || (doc.archivo_id ? 'Consultar en línea' : 'Abrir documento')) + '</a>' +
            (editable(e.url) && x.puede_gestionar ? U.badge('Editable', 'alerta', true) : '') + '</li>';
        }).join('') + '</ul>';
      }
      if (!h) h = '<p class="sx2-tenue" style="margin:0">Este documento aún no tiene archivo ni enlace.</p>';
      return h;
    }
    function bloqueClausulas(doc, gest) {
      var cl = doc.clausulas_iso || [];
      if (!cl.length && !gest) return '';
      return '<section class="sx2-seccion-drawer"><h3 class="sx2-seccion-drawer__titulo">Cláusulas ISO que respalda</h3>' +
        '<div class="sx2-flex" style="gap:6px;flex-wrap:wrap;align-items:center">' +
        (cl.length ? cl.map(function (c) { return U.badge(c, 'primario', true); }).join('') : '<span class="sx2-tenue" style="font-size:.8125rem">Sin etiquetar: no cuenta como evidencia en la cobertura ISO.</span>') +
        (gest && window.SigsoCalidad ? U.boton({ texto: cl.length ? 'Cambiar' : 'Etiquetar', sm: true, variante: 'fantasma', clase: 'js-dc2-clausulas' }) : '') +
        '</div></section>';
    }
    function bloqueCumplimiento() {
      if (!cumpl) return '<section class="sx2-seccion-drawer"><h3 class="sx2-seccion-drawer__titulo">Confirmación de lectura</h3>' + U.esqueleto('tabla', 2) + '</section>';
      var total = cumpl.confirmados.length + cumpl.pendientes.length;
      var pct = total ? Math.round(cumpl.confirmados.length * 100 / total) : 100;
      var persona = function (email, extra) { var pp = PY.persona(email); return '<li>' + U.avatar(pp, 'xs') + '<span class="sx2-cortar">' + U.esc(pp.nombre) + '</span>' + (extra || '') + '</li>'; };
      return '<section class="sx2-seccion-drawer"><h3 class="sx2-seccion-drawer__titulo">Confirmación de lectura · ' + U.esc(version(cumpl.version)) + '</h3>' +
        '<div class="sx2-flex" style="gap:12px;align-items:center">' + U.barra(pct, pct === 100 ? 'ok' : 'primario', true) + '<strong style="flex:none">' + cumpl.confirmados.length + ' de ' + total + '</strong></div>' +
        (cumpl.pendientes.length ? '<p class="sx2-tenue" style="margin:0;font-size:.75rem">Faltan (' + cumpl.pendientes.length + '):</p><ul class="nv2-gente">' + cumpl.pendientes.map(function (e) { return persona(e); }).join('') + '</ul>' : '') +
      '</section>';
    }
    function bloqueVersiones(vs) {
      return '<section class="sx2-seccion-drawer"><h3 class="sx2-seccion-drawer__titulo">Historial de versiones</h3><ul class="dc2-versiones">' + vs.map(function (v) {
        var vig = v.vigente === true || v.vigente === 'TRUE';
        return '<li><span class="sx2-apilado" style="gap:2px;flex:1;min-width:0"><strong>' + U.esc(version(v.version)) + (vig ? ' ' + U.badge('Vigente', 'ok', true) : '') + '</strong>' +
          '<span class="sx2-tenue" style="font-size:.75rem">' + U.esc(PY.fecha(v.fecha, true) + (v.cambios ? ' · ' + v.cambios : '')) + '</span></span>' +
          (!vig && v.archivo_id ? U.boton({ texto: 'Descargar', icono: 'descargar', sm: true, variante: 'fantasma', clase: 'js-dc2-desc-version', datos: { version: v.version_id } }) : '') + '</li>';
      }).join('') + '</ul></section>';
    }

    function descargar(versionId, b) {
      if (b) b.disabled = true;
      var datos = { documento_id: id };
      if (versionId) datos.version_id = versionId;
      api('descargarDocumentoSgc', datos).then(function (r) {
        if (b) b.disabled = false;
        if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo descargar.', 'error'); return; }
        PY.descargarBase64(r.data.contenido_base64, r.data.nombre_archivo || 'documento.pdf', r.data.mime || 'application/pdf');
      });
    }
    function cambiarEstado(estado) {
      api('actualizarDocumentoSgc', { documento_id: id, estado: estado }).then(function (r) {
        if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo actualizar.', 'error'); return; }
        PY.aviso(estado === 'VIGENTE' ? 'El documento volvió a estar vigente.' : 'Documento marcado obsoleto.', 'exito');
        cargarDoc();
        refrescar();
      });
    }

    d.el.addEventListener('click', function (ev) {
      var b, t = ev.target;
      if ((b = t.closest('.js-dc2-confirmar'))) {
        b.disabled = true;
        api('acusarDocumentoSgc', { documento_id: id }).then(function (r) {
          if (!r || !r.ok) { b.disabled = false; PY.aviso((r && r.message) || 'No se pudo registrar la confirmación.', 'error'); return; }
          PY.aviso('Lectura confirmada. ¡Gracias!', 'exito');
          x.debo_acusar = false;
          x.mi_acuse = new Date().toISOString();
          pintar();
          avisarCambio();
          refrescar();
        });
        return;
      }
      if ((b = t.closest('.js-dc2-descargar'))) { descargar(null, b); return; }
      if ((b = t.closest('.js-dc2-desc-version'))) { descargar(b.getAttribute('data-version'), b); return; }
      if (t.closest('.js-dc2-ver')) { SigsoCalidad.ver(id, null); return; }
      if (t.closest('.js-dc2-subir')) { subirCopia(id, cargarDoc); return; }
      if (t.closest('.js-dc2-vigente')) { cambiarEstado('VIGENTE'); return; }
      if (t.closest('.js-dc2-obsoleto')) {
        U.confirmar({ titulo: 'Marcar como obsoleto', texto: 'Saldrá de circulación y el personal dejará de verlo. No se elimina: queda archivado para trazabilidad.', boton: 'Marcar obsoleto', peligro: true })
          .then(function (si) { if (si) cambiarEstado('OBSOLETO'); });
        return;
      }
      if ((b = t.closest('.js-dc2-aprobar'))) {
        var rev = d.el.querySelector('.js-dc2-rev').value.trim(), apr = d.el.querySelector('.js-dc2-apr').value.trim();
        if (!rev || !apr) { PY.aviso('Indica quién revisó y quién aprobó.', 'error'); return; }
        b.disabled = true;
        lote([id], { revisado_por: rev, aprobado_por: apr }).then(function (r) { b.disabled = false; if (r) { cargarDoc(); refrescar(); } });
        return;
      }
      if (t.closest('.js-dc2-editar')) { d.cerrar(true); formulario('editar', x.documento, x.destinatarios); return; }
      if (t.closest('.js-dc2-version')) { d.cerrar(true); formulario('version', x.documento); return; }
      if (t.closest('.js-dc2-clausulas')) { d.cerrar(true); formulario('clausulas', x.documento, x.catalogo_clausulas); }
    });
    cargarDoc();
    return d;
  }

  // --- Vista Documentos ----------------------------------------------------------------
  function mostrar(o) {
    o = o || {};
    // Entrar por otro tipo (árbol o enlace documentos:PRO) empieza una búsqueda nueva.
    if (o.tipo !== undefined && (o.tipo || '') !== tipo_) { tipo_ = o.tipo || ''; q_ = ''; }
    cargar(!!docs_ && C().ocupa('documentos'));
    if (o.abrir) abrir(o.abrir);
  }
  function refrescar() { if (C().ocupa('documentos')) cargar(true); }

  function cargar(silencioso) {
    var c = C().contenedor('documentos');
    if (!c) return;
    var t = ++turno_;
    if (!silencioso || !docs_) c.innerHTML = '<div class="sx2-pagina">' + cabecera() + U.esqueleto('tabla', 8) + '</div>';
    Promise.all([api('listarDocumentosSgc', {}), sinControl_ ? Promise.resolve(null) : api('getControlDocumentalSgc', {})]).then(function (r) {
      if (t !== turno_ || !C().ocupa('documentos')) return;
      if (r[1] && r[1].error === 'forbidden') sinControl_ = true;
      if (!r[0] || !r[0].ok) {
        c.innerHTML = '<div class="sx2-pagina">' + cabecera() + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudieron cargar los documentos',
          texto: (r[0] && r[0].message) || 'Inténtalo de nuevo.', accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-dc2-recargar' }) }) }) + '</div>';
        return;
      }
      docs_ = r[0].data;
      control_ = r[1] && r[1].ok ? r[1].data : null;
      if (window.SigsoCalidad && SigsoCalidad.usarSecciones) SigsoCalidad.usarSecciones(docs_.secciones_visibles);
      if (!gestiona()) { tab_ = 'lista'; estado_ = ''; }
      pintar(!!silencioso);
    });
  }

  function cabecera() {
    var g = gestiona();
    return '<header class="sx2-cabecera sx2-entra">' +
      '<div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Calidad · ISO 9001</span><h1>Documentos</h1>' +
        '<span class="sx2-tenue" style="font-size:.875rem">Procedimientos, instructivos, formularios y las normas que aplican.</span></div>' +
      (g && window.SigsoCalidad ? '<div class="sx2-cabecera__acciones">' + U.boton({ texto: 'Cargar documento', icono: 'mas', variante: 'primario', clase: 'js-dc2-nuevo' }) + '</div>' : '') +
    '</header>';
  }

  function pintar(silencioso) {
    var c = document.getElementById('calidad-v2');
    if (!c || !docs_ || !C().ocupa('documentos')) return;
    var y = window.scrollY;
    var foco = document.activeElement && document.activeElement.classList.contains('js-dc2-q');
    var g = gestiona();
    var nCtrl = control_ ? control_.total : 0;
    var h = '<div class="sx2-pagina">' + cabecera() +
      (g && control_ ? '<div class="dc2-tabs sx2-entra">' + U.segmento([{ id: 'lista', texto: 'Documentos', icono: 'documento' },
        { id: 'control', texto: 'Control documental' + (nCtrl ? ' · ' + nCtrl : ''), icono: 'escudoCheck' }], tab_, 'js-dc2-tab') + '</div>' : '') +
      (tab_ === 'control' && control_ ? vistaControl() : vistaLista()) + '</div>';
    c.innerHTML = h;
    if (silencioso) {
      c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; });
      window.scrollTo(0, y);
    }
    if (foco) { var q = c.querySelector('.js-dc2-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
    U.animar(c);
  }

  // Filtra en el cliente: el listado ya llega completo y filtrado por permisos.
  function filtrados() {
    var palabras = norm(q_).split(/\s+/).filter(Boolean);
    return (docs_.documentos || []).filter(function (d) {
      if (tipo_ && d.tipo !== tipo_) return false;
      if (estado_ && d.estado !== estado_) return false;
      if (soloPend_ && !d.debo_acusar) return false;
      if (soloControl_ && !(d.control || []).length) return false;
      if (!palabras.length) return true;
      var heno = norm([d.codigo, d.nombre, d.descripcion, d.area_id, TIPO()[d.tipo]].join(' '));
      return palabras.every(function (p) { return heno.indexOf(p) !== -1; });
    }).sort(function (a, b) {
      if (!!a.debo_acusar !== !!b.debo_acusar) return a.debo_acusar ? -1 : 1;
      return String(a.codigo || '').localeCompare(String(b.codigo || ''));
    });
  }

  function vistaLista() {
    var g = gestiona();
    var todos = (docs_.documentos || []).filter(function (d) { return !estado_ || d.estado === estado_; });
    var porTipo = {};
    todos.forEach(function (d) { porTipo[d.tipo] = (porTipo[d.tipo] || 0) + 1; });
    var pend = (docs_.documentos || []).filter(function (d) { return d.debo_acusar; }).length;
    var conCtrl = (docs_.documentos || []).filter(function (d) { return (d.control || []).length; }).length;
    var lista = filtrados();
    var chipsTipo = [U.chip({ texto: 'Todos', n: todos.length, activo: !tipo_, clase: 'js-dc2-tipo', datos: { tipo: '' } })].concat(
      ['DOC', 'PRO', 'INS', 'FO', 'EXTERNO'].filter(function (t) { return porTipo[t] || tipo_ === t; }).map(function (t) {
        return U.chip({ texto: PLURAL[t], n: porTipo[t] || 0, activo: tipo_ === t, clase: 'js-dc2-tipo', datos: { tipo: t } });
      })).join('');
    var hayFiltro = !!(q_ || tipo_ || soloPend_ || soloControl_ || (g && estado_ !== 'VIGENTE'));
    return (pend ? '<button type="button" class="dc2-pend sx2-entra js-dc2-pend' + (soloPend_ ? ' dc2-pend--activo' : '') + '">' + U.ico('reloj', 16) +
        '<span><strong>' + pend + (pend === 1 ? ' documento espera' : ' documentos esperan') + ' tu confirmación de lectura.</strong> Ábrelo, léelo y confírmalo.</span>' +
        '<span class="sx2-enlace">' + (soloPend_ ? 'Ver todos' : 'Ver solo esos') + '</span></button>' : '') +
      '<div class="dc2-barra sx2-entra">' +
        '<label class="dc2-buscar">' + U.ico('lupa', 16) + '<input type="search" class="js-dc2-q" placeholder="Buscar por nombre, código o palabra: extintor, reclamo, vacaciones…" value="' + U.esc(q_) + '" aria-label="Buscar un documento"></label>' +
        (g ? '<span class="dc2-estado">' + U.segmento([{ id: 'VIGENTE', texto: 'Vigentes' }, { id: 'OBSOLETO', texto: 'Obsoletos' }, { id: '', texto: 'Todos' }], estado_, 'js-dc2-estado') + '</span>' : '') +
      '</div>' +
      '<div class="dc2-chips sx2-entra">' + chipsTipo +
        (g && conCtrl ? U.chip({ texto: 'Con pendientes de control', icono: 'escudoCheck', n: conCtrl, activo: soloControl_, tono: 'alerta', clase: 'js-dc2-solo-ctrl' }) : '') +
        (hayFiltro ? U.boton({ texto: 'Limpiar', sm: true, variante: 'fantasma', clase: 'js-dc2-limpiar' }) : '') +
      '</div>' +
      U.card({ sinRelleno: true, i: 3, cuerpo: lista.length ? '<ul class="dc2-lista">' + lista.map(filaDoc).join('') + '</ul>'
        : U.vacio({ icono: soloPend_ ? 'check' : 'lupa', titulo: soloPend_ ? 'No te queda nada por confirmar' : (hayFiltro ? 'Ningún documento coincide' : 'Todavía no hay documentos'),
          texto: soloPend_ ? 'Usa "Ver todos" para volver al listado completo.' : (hayFiltro ? 'Prueba con otra palabra o limpia los filtros.' : (g ? 'Carga el primero para empezar.' : 'El Encargado SGC los irá publicando.')) }) }) +
      '<p class="sx2-tenue dc2-cuenta">' + lista.length + (lista.length === 1 ? ' documento' : ' documentos') + (hayFiltro ? ' con los filtros aplicados' : '') + '</p>';
  }

  function filaDoc(d) {
    var ctrl = d.control || [];
    var tono = d.estado === 'OBSOLETO' ? 'neutro' : (d.debo_acusar ? 'alerta' : 'info');
    var senales = (d.debo_acusar ? U.badge('Por confirmar', 'alerta') : '') +
      (d.estado === 'OBSOLETO' ? U.badge('Obsoleto', 'neutro') : '') +
      ctrl.map(function (a) { return U.badge(ALERTA[a].txt, ALERTA[a].tono); }).join('');
    return '<li class="dc2-fila' + (d.estado === 'OBSOLETO' ? ' dc2-fila--off' : '') + '" data-dc2-doc="' + U.esc(d.documento_id) + '" tabindex="0">' +
      '<span class="dc2-fila__ico sx2-tono-' + tono + '">' + U.ico(ICONO[d.tipo] || 'documento', 17) + '</span>' +
      '<span class="sx2-apilado" style="gap:4px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(d.nombre) + '</strong>' +
        '<span class="dc2-fila__meta"><span class="dc2-cod">' + U.esc(d.codigo) + '</span><span>' + U.esc(TIPO()[d.tipo] || d.tipo) + '</span>' +
          (version(d.version_vigente, d.tipo) ? '<span>' + U.esc(version(d.version_vigente, d.tipo)) + '</span>' : '') +
          (d.tiene_archivo ? '' : (d.enlaces_n ? '<span>' + U.ico('enlace', 12) + ' enlace</span>' : '')) + '</span></span>' +
      '<span class="dc2-fila__senales">' + senales + '</span>' + U.ico('derecha', 16) + '</li>';
  }

  // --- Control documental (quien gobierna) ------------------------------------------------
  function vistaControl() {
    var gr = control_.grupos, tt = control_.totales;
    if (!control_.total) {
      return U.card({ i: 2, cuerpo: U.vacio({ icono: 'check', titulo: 'Todo en regla', texto: 'Los documentos vigentes tienen revisión, aprobación y copia controlada, y ninguna revisión anual está por vencer.' }) });
    }
    if (!selAprob_) { selAprob_ = {}; gr.sin_aprobacion.forEach(function (x) { selAprob_[x.documento_id] = true; }); }
    if (!selExt_) { selExt_ = {}; gr.externo_fuera.forEach(function (x) { selExt_[x.documento_id] = true; }); }
    var kpis = '<div class="sx2-fila-kpis">' +
      U.kpi({ etiqueta: 'Sin revisión/aprobación', valor: tt.sin_aprobacion, icono: 'check', tono: tt.sin_aprobacion ? 'alerta' : 'ok', i: 2 }) +
      U.kpi({ etiqueta: 'Sin copia controlada', valor: tt.sin_copia, icono: 'candado', tono: tt.sin_copia ? 'alerta' : 'ok', i: 3 }) +
      U.kpi({ etiqueta: 'Normas fuera de circulación', valor: tt.externo_fuera, icono: 'alerta', tono: tt.externo_fuera ? 'critico' : 'ok', i: 4 }) +
      U.kpi({ etiqueta: 'Revisión anual (60 días)', valor: tt.revision, icono: 'calendario', tono: tt.revision ? 'info' : 'ok', i: 5 }) + '</div>';
    return kpis + '<div class="sx2-grid sx2-grid--estira">' +
      (gr.sin_aprobacion.length ? '<div class="sx2-col-6">' + cardAprobacion(gr.sin_aprobacion) + '</div>' : '') +
      (gr.sin_copia.length ? '<div class="sx2-col-6">' + cardCopia(gr.sin_copia) + '</div>' : '') +
      (gr.externo_fuera.length ? '<div class="sx2-col-6">' + cardExternos(gr.externo_fuera) + '</div>' : '') +
      (gr.revision.length ? '<div class="sx2-col-6">' + cardRevision(gr.revision) + '</div>' : '') +
    '</div>';
  }
  function marca(sel, x) {
    return '<label class="dc2-marca"><input type="checkbox" class="js-dc2-sel" data-grupo="' + (sel === selAprob_ ? 'aprob' : 'ext') + '" data-id="' + U.esc(x.documento_id) + '"' + (sel[x.documento_id] ? ' checked' : '') + '>' +
      '<span class="sx2-apilado" style="gap:2px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(x.nombre) + '</strong><span class="sx2-tenue" style="font-size:.75rem">' + U.esc(x.codigo) + '</span></span></label>';
  }
  function nSel(sel) { return Object.keys(sel).filter(function (k) { return sel[k]; }).length; }
  function cardAprobacion(items) {
    var n = nSel(selAprob_);
    return U.card({ titulo: 'Revisión y aprobación', icono: 'check', sub: 'ISO 7.5.2 · ' + items.length, i: 6, cuerpo:
      '<p class="sx2-tenue dc2-ayuda">La norma pide evidencia de que cada documento fue revisado y aprobado antes de usarse. Marca los que correspondan y registra quién lo hizo.</p>' +
      '<div class="dc2-todos">' + U.boton({ texto: n === items.length ? 'Quitar todos' : 'Marcar todos', sm: true, variante: 'fantasma', clase: 'js-dc2-todos', datos: { grupo: 'aprob' } }) + '</div>' +
      '<div class="dc2-marcas">' + items.map(function (x) { return marca(selAprob_, x); }).join('') + '</div>' +
      '<div class="dc2-aprob dc2-aprob--lote">' +
        '<label><span>Revisado por</span><input type="text" class="js-dc2-lote-rev" list="dc2-firmantes-l" placeholder="Nombre y cargo"></label>' +
        '<label><span>Aprobado por</span><input type="text" class="js-dc2-lote-apr" list="dc2-firmantes-l" placeholder="Nombre y cargo"></label>' +
      '</div>' + datalistFirmantes('dc2-firmantes-l') +
      '<div class="cq2-mas">' + U.boton({ texto: 'Registrar en ' + n + ' documento' + (n === 1 ? '' : 's'), icono: 'check', variante: 'primario', clase: 'js-dc2-lote-aprobar', deshabilitado: !n }) + '</div>' });
  }
  function cardCopia(items) {
    var ed = items.filter(function (x) { return x.enlace_editable; }).length;
    return U.card({ titulo: 'Sin copia controlada', icono: 'candado', sub: 'ISO 7.5.3 · ' + items.length, i: 7, cuerpo:
      '<p class="sx2-tenue dc2-ayuda">' + (ed ? ed + ' se abren por un Google Docs editable: cualquiera con el enlace puede cambiarlos y la versión vigente no queda protegida. ' : '') +
        'Sube el PDF de la versión vigente de cada uno; el enlace se conserva para consulta.</p>' +
      '<ul class="dc2-mini">' + items.map(function (x) {
        return '<li><span class="sx2-apilado" style="gap:2px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(x.nombre) + '</strong>' +
          '<span class="sx2-flex" style="gap:6px;align-items:center"><span class="sx2-tenue" style="font-size:.75rem">' + U.esc(x.codigo) + '</span>' +
          (x.enlace ? (x.enlace_editable ? U.badge('Google Docs editable', 'alerta', true) : U.badge('Enlace externo', 'neutro', true)) : U.badge('Sin archivo ni enlace', 'critico', true)) + '</span></span>' +
          (x.enlace ? '<a class="sx2-boton sx2-boton--fantasma sx2-boton--sm" href="' + U.esc(x.enlace) + '" target="_blank" rel="noopener noreferrer">' + U.ico('enlace', 14) + 'Abrir</a>' : '') +
          U.boton({ texto: 'Subir PDF', icono: 'subir', sm: true, clase: 'js-dc2-subir-l', datos: { id: x.documento_id } }) + '</li>';
      }).join('') + '</ul>' });
  }
  function cardExternos(items) {
    var n = nSel(selExt_);
    return U.card({ titulo: 'Normas externas fuera de circulación', icono: 'alerta', sub: items.length, i: 8, cuerpo:
      '<p class="sx2-tenue dc2-ayuda">Están marcadas obsoletas, así que el personal no las ve. Si siguen rigiendo (lo normal para una ley o una norma ISO vigente), devuélvelas a vigente.</p>' +
      '<div class="dc2-marcas">' + items.map(function (x) { return marca(selExt_, x); }).join('') + '</div>' +
      '<div class="cq2-mas">' + U.boton({ texto: 'Volver a vigente ' + n, icono: 'check', variante: 'primario', clase: 'js-dc2-lote-vigente', deshabilitado: !n }) + '</div>' });
  }
  function cardRevision(items) {
    return U.card({ titulo: 'Revisión anual', icono: 'calendario', sub: items.length, i: 9, cuerpo:
      '<p class="sx2-tenue dc2-ayuda">Cada documento se revisa una vez al año (PRO-01). Si cambia, sube una versión nueva; si sigue igual, renueva su fecha de vigencia.</p>' +
      '<ul class="dc2-mini">' + items.map(function (x) {
        return '<li data-dc2-doc="' + U.esc(x.documento_id) + '" tabindex="0" style="cursor:pointer"><span class="sx2-apilado" style="gap:2px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(x.nombre) + '</strong>' +
          '<span class="sx2-tenue" style="font-size:.75rem">' + U.esc(x.codigo) + '</span></span>' +
          U.badge(x.dias < 0 ? 'Vencida hace ' + (-x.dias) + ' d' : 'En ' + x.dias + ' d', x.dias < 0 ? 'critico' : 'info') + '</li>';
      }).join('') + '</ul>' });
  }

  // --- Eventos ------------------------------------------------------------------------
  document.addEventListener('click', function (ev) {
    var t = ev.target, b;
    var raiz = document.getElementById('calidad-v2');
    if (!raiz || !raiz.contains(t) || !C().ocupa('documentos')) return;
    if ((b = t.closest('.js-dc2-tab'))) { tab_ = b.getAttribute('data-id'); pintar(true); return; }
    if (t.closest('.js-dc2-recargar')) { cargar(); return; }
    if (t.closest('.js-dc2-nuevo')) { formulario('nuevo'); return; }
    if ((b = t.closest('.js-dc2-tipo'))) {
      tipo_ = b.getAttribute('data-tipo') || '';
      if (window.SigsoShell && SigsoShell.publicarItem) SigsoShell.publicarItem(tipo_ ? 'documentos:' + tipo_ : 'documentos');
      pintar(true);
      return;
    }
    if ((b = t.closest('.js-dc2-estado'))) { estado_ = b.getAttribute('data-id') || ''; pintar(true); return; }
    if (t.closest('.js-dc2-pend')) { soloPend_ = !soloPend_; pintar(true); return; }
    if (t.closest('.js-dc2-solo-ctrl')) { soloControl_ = !soloControl_; pintar(true); return; }
    if (t.closest('.js-dc2-limpiar')) { q_ = ''; tipo_ = ''; soloPend_ = false; soloControl_ = false; estado_ = gestiona() ? 'VIGENTE' : ''; pintar(true); return; }
    if ((b = t.closest('.js-dc2-todos'))) {
      var todosSel = nSel(selAprob_) === control_.grupos.sin_aprobacion.length;
      control_.grupos.sin_aprobacion.forEach(function (x) { selAprob_[x.documento_id] = !todosSel; });
      pintar(true);
      return;
    }
    if ((b = t.closest('.js-dc2-subir-l'))) { subirCopia(b.getAttribute('data-id')); return; }
    if ((b = t.closest('.js-dc2-lote-aprobar'))) {
      var rev = raiz.querySelector('.js-dc2-lote-rev').value.trim(), apr = raiz.querySelector('.js-dc2-lote-apr').value.trim();
      var ids = Object.keys(selAprob_).filter(function (k) { return selAprob_[k]; });
      if (!rev || !apr) { PY.aviso('Indica quién revisó y quién aprobó.', 'error'); return; }
      U.confirmar({ titulo: 'Registrar revisión y aprobación', boton: 'Registrar',
        texto: ids.length + ' documento' + (ids.length === 1 ? '' : 's') + ': revisado por ' + rev + ', aprobado por ' + apr + ', con fecha de hoy. Queda en el registro de cada documento.' }).then(function (si) {
        if (!si) return;
        b.disabled = true;
        lote(ids, { revisado_por: rev, aprobado_por: apr }).then(function (r) { b.disabled = false; if (r) { selAprob_ = null; cargar(true); } });
      });
      return;
    }
    if ((b = t.closest('.js-dc2-lote-vigente'))) {
      var idsE = Object.keys(selExt_).filter(function (k) { return selExt_[k]; });
      U.confirmar({ titulo: 'Volver a vigente', boton: 'Volver a vigente',
        texto: idsE.length + ' norma' + (idsE.length === 1 ? '' : 's') + ' externa' + (idsE.length === 1 ? '' : 's') + ' vuelven a estar vigentes y el personal podrá verlas.' }).then(function (si) {
        if (!si) return;
        b.disabled = true;
        lote(idsE, { estado: 'VIGENTE' }).then(function (r) { b.disabled = false; if (r) { selExt_ = null; cargar(true); } });
      });
      return;
    }
    if ((b = t.closest('[data-dc2-doc]'))) abrir(b.getAttribute('data-dc2-doc'));
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t.classList || !t.classList.contains('js-dc2-sel')) return;
    var sel = t.getAttribute('data-grupo') === 'aprob' ? selAprob_ : selExt_;
    sel[t.getAttribute('data-id')] = t.checked;
    var raiz = document.getElementById('calidad-v2');
    var n = nSel(sel);
    var btn = raiz && raiz.querySelector(t.getAttribute('data-grupo') === 'aprob' ? '.js-dc2-lote-aprobar' : '.js-dc2-lote-vigente');
    if (btn) {
      btn.disabled = !n;
      btn.lastChild.textContent = t.getAttribute('data-grupo') === 'aprob' ? 'Registrar en ' + n + ' documento' + (n === 1 ? '' : 's') : 'Volver a vigente ' + n;
    }
  });
  var tq_ = null;
  document.addEventListener('input', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('js-dc2-q')) return;
    q_ = ev.target.value;
    clearTimeout(tq_);
    tq_ = setTimeout(function () { pintar(true); }, 150);
  });
  document.addEventListener('keydown', function (ev) {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('#calidad-v2 [data-dc2-doc]')) { ev.preventDefault(); ev.target.click(); }
  });
  document.addEventListener('sigso:sgc-acuse', function () {
    var c = document.getElementById('calidad-v2');
    if (c && c.offsetParent !== null && C().ocupa('documentos')) cargar(true);
  });

  window.SigsoCalidadDocsV2 = { mostrar: mostrar, refrescar: refrescar, abrir: abrir };
})();
