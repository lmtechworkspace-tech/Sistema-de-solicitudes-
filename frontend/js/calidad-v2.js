/**
 * calidad-v2.js — Calidad: Inicio "Camino a la certificación" (SIGSO v2,
 * Módulo 8A; análisis y decisiones en documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 *  - Quien gobierna el SGC (Encargado / ADM) ve el % listo para certificar,
 *    los capítulos 4-10, el PRÓXIMO PASO de cada cláusula con su "Ir a"
 *    (decisión del dueño: guía, no solo porcentaje), las etiquetas ISO que
 *    se pueden confirmar en un clic y quién falta por confirmar cada
 *    documento (backend getCaminoCertificacionSgc / aplicarEtiquetasSgc).
 *  - El resto ve "lo tuyo": los documentos que debe confirmar.
 *  - El panel del documento (lectura, acuse y gestión) vive en
 *    calidad-documentos-v2.js (8B) y es el mismo desde el Inicio de SIGSO
 *    (decisión: confirmar desde el Inicio, como Novedades).
 *
 * Se carga con el shell (no con calidad.js, que es diferido): el Inicio de
 * SIGSO lo necesita aunque nadie haya abierto Calidad. Documentos (8B) está
 * en calidad-documentos-v2.js; las demás secciones siguen en calidad.js.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var TIPO = { DOC: 'Documento maestro', PRO: 'Procedimiento', INS: 'Instructivo', FO: 'Formulario', EXTERNO: 'Documento externo' };
  var SECCION = {
    documentos: 'Documentos', personas: 'Personas', auditorias: 'Auditorías', revision: 'Revisión por la dirección',
    nc: 'No conformidades', indicadores: 'Indicadores', objetivos: 'Objetivos', alcance: 'Alcance', contexto: 'Contexto',
    procesos: 'Mapa de procesos', riesgos: 'Riesgos', servicios: 'Servicios prestados', proveedores: 'Proveedores'
  };
  var ESTADO = { COMPLETO: ['Lista', 'ok'], PARCIAL: ['Parcial', 'alerta'], FALTANTE: ['Falta', 'critico'], NO_APLICA: ['No aplica', 'neutro'] };
  var datos_ = null, turno_ = 0, sinCamino_ = false, capitulo_ = 0, quitadas_ = {}, verTodosPasos_ = false;

  function api(accion, datos) {
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, accion, datos || {}).catch(function (e) {
      return { ok: false, message: (e && e.message) || 'No se pudo conectar.' };
    });
  }
  function irA(seccion) { if (window.SigsoCalidad) SigsoCalidad.irAItem(seccion); }
  function avisarAcuse() { document.dispatchEvent(new CustomEvent('sigso:sgc-acuse')); }
  function plazo(dias) {
    if (dias === null || dias === undefined) return { txt: 'Sin plazo', tono: 'neutro' };
    if (dias < 0) return { txt: 'Venció hace ' + (-dias) + (dias === -1 ? ' día' : ' días'), tono: 'critico' };
    if (dias === 0) return { txt: 'Vence hoy', tono: 'critico' };
    if (dias <= 7) return { txt: 'Quedan ' + dias + (dias === 1 ? ' día' : ' días'), tono: 'alerta' };
    return { txt: 'Quedan ' + dias + ' días', tono: 'info' };
  }

  // --- Panel del documento: vive en calidad-documentos-v2.js (8B: lectura + gestión) ---
  function abrirDocumento(id) { return window.SigsoCalidadDocsV2 ? SigsoCalidadDocsV2.abrir(id) : null; }

  // Un instante (acusado_en) se muestra con el día de Chile, no el de UTC.
  function fechaChile(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    // Mismo formato que PY.fecha (dd/mm/aaaa); es-CL usa guiones.
    return new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d).replace(/-/g, '/');
  }
  function diasHasta(fecha) {
    var k = String(fecha || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return null;
    return Math.round((Date.parse(k + 'T12:00:00Z') - Date.parse(PY.hoyClave() + 'T12:00:00Z')) / 86400000);
  }

  // Filas para el Inicio de SIGSO (documentos por confirmar).
  function filasInicio(docs) {
    return (docs || []).map(function (x) {
      var p = plazo(x.dias_para_acuse);
      return '<li class="sx2-py-mt-fila sx2-tono-' + p.tono + '" data-cq2-doc="' + U.esc(x.documento_id) + '" tabindex="0"><span class="sx2-py-punto"></span>' +
        '<span class="sx2-apilado" style="gap:4px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(x.nombre) + '</strong>' +
        '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + U.badge(TIPO[x.tipo] || x.tipo, 'info') + '<span class="sx2-tenue" style="font-size:.75rem">' + U.esc(x.codigo) + '</span></span></span>' +
        '<span class="sx2-py-mt-cuando' + (p.tono === 'critico' ? ' sx2-delta--mal' : '') + '">' + U.esc(p.txt) + '</span>' +
        U.boton({ texto: 'Leer', icono: 'ojo', sm: true, variante: 'primario' }) + '</li>';
    }).join('');
  }

  // --- Montaje ----------------------------------------------------------------------
  function seccion() { return document.getElementById('modulo-calidad'); }
  // #calidad-v2 lo comparten el Inicio y Documentos (8B): data-vista dice quién
  // lo ocupa, para que una respuesta tardía de una vista no pinte sobre la otra.
  function contenedor(vista) {
    var s = seccion();
    if (!s) return null;
    var c = document.getElementById('calidad-v2');
    if (!c) {
      c = document.createElement('div');
      c.id = 'calidad-v2';
      c.className = 'sx2';
      s.appendChild(c);
    }
    c.setAttribute('data-vista', vista || 'inicio');
    s.classList.add('calidad-v2-activa');
    return c;
  }
  function ocupa(vista) { var c = document.getElementById('calidad-v2'); return !!c && c.getAttribute('data-vista') === vista; }
  function desmontar() {
    var s = seccion();
    if (s) s.classList.remove('calidad-v2-activa');
    var c = document.getElementById('calidad-v2');
    if (c) c.remove();
  }

  function cargar(silencioso) {
    var c = contenedor('inicio');
    if (!c) return;
    var t = ++turno_;
    if (!silencioso || !datos_) c.innerHTML = '<div class="sx2-pagina">' + cabecera(null) + U.esqueleto('kpis', 4) + U.esqueleto('tarjetas', 3) + '</div>';
    // Quien no supervisa el SGC recibe 403 del camino: se recuerda para no
    // repetir el viaje en cada entrada (el backend decide, no se adivina el rol).
    Promise.all([sinCamino_ ? Promise.resolve(null) : api('getCaminoCertificacionSgc', {}), api('listarDocumentosSgc', {})]).then(function (r) {
      if (t !== turno_ || !ocupa('inicio')) return;
      if (r[0] && r[0].error === 'forbidden') sinCamino_ = true;
      var camino = r[0] && r[0].ok ? r[0].data : null;
      var docs = r[1] && r[1].ok ? r[1].data : null;
      if (!camino && !docs) {
        c.innerHTML = '<div class="sx2-pagina">' + cabecera(null) + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar Calidad',
          texto: (r[1] && r[1].message) || 'Inténtalo de nuevo.', accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-cq2-recargar' }) }) }) + '</div>';
        return;
      }
      datos_ = { camino: camino, docs: docs };
      if (docs && window.SigsoCalidad && SigsoCalidad.usarSecciones) SigsoCalidad.usarSecciones(docs.secciones_visibles);
      pintar(!!silencioso);
      if (camino && window.SigsoDirectorio) {
        var correos = [];
        camino.acuses.forEach(function (a) { a.pendientes.forEach(function (p) { correos.push(p.email); }); correos = correos.concat(a.sin_cuenta); });
        if (correos.length) SigsoDirectorio.resolver(correos).then(function () { if (t === turno_) pintar(true); });
      }
    });
  }

  // --- Pintado ------------------------------------------------------------------------
  function cabecera(camino) {
    return '<header class="sx2-cabecera sx2-entra">' +
      '<div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Calidad · ISO 9001</span><h1>' + (camino ? 'Camino a la certificación' : 'Calidad') + '</h1>' +
        '<span class="sx2-tenue" style="font-size:.875rem">' + (camino ? 'Qué falta para certificar y cuál es el próximo paso de cada cláusula.' : 'Tus documentos del sistema de calidad.') + '</span></div>' +
      '<div class="sx2-cabecera__acciones">' + U.boton({ texto: 'Documentos', icono: 'documento', clase: 'js-cq2-ir', datos: { ir: 'documentos' } }) +
        (camino ? U.boton({ texto: 'Cobertura ISO', icono: 'escudoCheck', clase: 'js-cq2-ir', datos: { ir: 'cobertura' } }) : '') + '</div>' +
    '</header>';
  }

  function pintar(silencioso) {
    var c = document.getElementById('calidad-v2');
    if (!c || !datos_ || !ocupa('inicio')) return;
    var y = window.scrollY;
    var cm = datos_.camino;
    var mios = datos_.docs ? (datos_.docs.documentos || []).filter(function (x) { return x.debo_acusar; }) : [];
    var html = '<div class="sx2-pagina">' + cabecera(cm);
    if (cm) {
      html += bloqueAvance(cm) + '<div class="sx2-grid sx2-grid--estira">' +
        '<div class="sx2-col-7 sx2-apilado">' + bloquePasos(cm) + '</div>' +
        '<div class="sx2-col-5 sx2-apilado">' + bloqueEtiquetas(cm) + bloqueAcuses(cm) + (mios.length ? bloqueMios(mios) : '') + '</div>' +
      '</div>';
    } else {
      html += bloqueMios(mios) +
        U.card({ titulo: 'Atajos', icono: 'carpeta', i: 2, cuerpo: '<div class="cq2-atajos">' +
          U.boton({ texto: 'Buscar un documento', icono: 'lupa', clase: 'js-cq2-ir', datos: { ir: 'documentos' } }) +
          U.boton({ texto: 'Mi ficha', icono: 'persona', clase: 'js-cq2-ir', datos: { ir: 'personas' } }) + '</div>' });
    }
    c.innerHTML = html + '</div>';
    if (silencioso) {
      c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; });
      window.scrollTo(0, y);
    }
    U.animar(c);
  }

  function bloqueAvance(cm) {
    var r = cm.resumen;
    var tono = r.pct_listo >= 80 ? 'ok' : (r.pct_listo >= 50 ? 'alerta' : 'critico');
    var caps = cm.capitulos.map(function (k, i) {
      var aplic = k.completo + k.parcial + k.faltante;
      var pct = aplic ? Math.round((k.completo + k.parcial / 2) * 100 / aplic) : 100;
      return '<button type="button" class="cq2-cap sx2-entra js-cq2-cap" style="--i:' + (i + 2) + '" data-cap="' + k.capitulo + '" aria-pressed="' + (capitulo_ === k.capitulo) + '">' +
        '<span class="cq2-cap__n">' + k.capitulo + '</span>' +
        '<span class="sx2-apilado" style="gap:6px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(k.nombre) + '</strong>' +
          U.barra(pct, k.faltante ? (k.completo ? 'alerta' : 'critico') : 'ok') +
          '<span class="sx2-tenue" style="font-size:.75rem">' + k.completo + ' lista' + (k.completo === 1 ? '' : 's') +
            (k.parcial ? ' · ' + k.parcial + ' parcial' + (k.parcial === 1 ? '' : 'es') : '') +
            (k.faltante ? ' · ' + k.faltante + ' falta' + (k.faltante === 1 ? '' : 'n') : '') + '</span></span></button>';
    }).join('');
    return U.card({ clase: 'cq2-avance', i: 1, cuerpo:
      '<div class="cq2-avance__cab">' + U.anillo(r.pct_listo, { tam: 112, grosor: 10, tono: tono }) +
        '<div class="sx2-apilado" style="gap:6px;min-width:0"><strong class="cq2-avance__titulo">' + r.completo + ' de ' + r.aplicables + ' cláusulas listas para certificar</strong>' +
          '<span class="sx2-tenue">' + (r.parcial ? r.parcial + ' con evidencia parcial · ' : '') + r.faltante + ' sin evidencia' + (r.no_aplica ? ' · ' + r.no_aplica + ' no aplican' : '') + '</span>' +
          (efecto(cm) ? '<span class="cq2-pista sx2-tono-primario">' + U.ico('destello', 14) + U.esc(efecto(cm)) + '</span>' : '') +
        '</div></div>' +
      '<div class="cq2-caps">' + caps + '</div>' });
  }

  // El efecto real (simulado en el backend) de confirmar todas las sugerencias.
  function efecto(cm) {
    var e = cm.efecto_sugerencias;
    if (!e || !e.mejoran.length) return '';
    return 'Confirmar las etiquetas sugeridas te lleva de ' + cm.resumen.pct_listo + '% a ' + e.pct_listo + '% · mejoran ' + e.mejoran.length + ' cláusula' + (e.mejoran.length === 1 ? '' : 's') + ' (' + e.mejoran.map(function (m) { return m.codigo; }).join(', ') + ')';
  }

  function bloquePasos(cm) {
    var lista = cm.clausulas.filter(function (c) { return c.estado === 'FALTANTE' || c.estado === 'PARCIAL'; });
    if (capitulo_) lista = lista.filter(function (c) { return Number(String(c.codigo).split('.')[0]) === capitulo_; });
    lista.sort(function (a, b) { return (a.estado === 'FALTANTE' ? 0 : 1) - (b.estado === 'FALTANTE' ? 0 : 1) || orden(a.codigo) - orden(b.codigo); });
    var total = lista.length;
    var LIM = 8;
    var visibles = verTodosPasos_ || capitulo_ ? lista : lista.slice(0, LIM);
    var nombreCap = capitulo_ ? (cm.capitulos.filter(function (k) { return k.capitulo === capitulo_; })[0] || {}).nombre : '';
    var cuerpo = !total
      ? U.vacio({ icono: 'check', titulo: capitulo_ ? 'Este capítulo está listo' : 'Todas las cláusulas tienen evidencia', texto: capitulo_ ? 'Elige otro capítulo o quita el filtro.' : 'Mantén al día los registros para la auditoría.' })
      : '<ol class="cq2-pasos">' + visibles.map(function (c, i) {
        var e = ESTADO[c.estado] || [c.estado, 'neutro'];
        return '<li class="cq2-paso sx2-tono-' + e[1] + ' sx2-entra" style="--i:' + Math.min(i + 3, 12) + '">' +
          '<span class="cq2-paso__cod">' + U.esc(c.codigo) + '</span>' +
          '<span class="sx2-apilado" style="gap:4px;min-width:0;flex:1">' +
            '<span class="sx2-flex" style="gap:8px;flex-wrap:wrap"><strong>' + U.esc(c.titulo) + '</strong>' + U.badge(e[0], e[1]) + '</span>' +
            '<span class="cq2-paso__txt">' + U.esc(c.paso || c.resumen) + '</span>' +
            (c.nota ? '<span class="sx2-tenue" style="font-size:.75rem">' + U.esc(c.nota) + '</span>' : '') +
          '</span>' +
          (c.seccion ? U.boton({ texto: 'Ir a ' + (SECCION[c.seccion] || c.seccion), sm: true, clase: 'js-cq2-ir', datos: { ir: c.seccion } }) : '') +
        '</li>';
      }).join('') + '</ol>' +
      (!capitulo_ && total > LIM ? '<div class="cq2-mas">' + U.boton({ texto: verTodosPasos_ ? 'Ver menos' : 'Ver las ' + total + ' cláusulas pendientes', variante: 'fantasma', sm: true, clase: 'js-cq2-mas' }) + '</div>' : '');
    return U.card({ titulo: 'Próximos pasos', icono: 'lista', i: 3, sub: capitulo_ ? 'Capítulo ' + capitulo_ + ' · ' + nombreCap : total + ' cláusula' + (total === 1 ? '' : 's'),
      accion: capitulo_ ? { texto: 'Ver todos los capítulos', clase: 'js-cq2-cap', datos: { cap: '0' } } : null, cuerpo: cuerpo });
  }
  function orden(cod) { var p = String(cod).split('.'); return Number(p[0]) * 100 + Number(p[1] || 0); }

  function bloqueEtiquetas(cm) {
    if (!cm.sugerencias.length) return '';
    var n = 0;
    var filas = cm.sugerencias.map(function (s) {
      var chips = s.sugeridas.map(function (cl) {
        var fuera = quitadas_[s.documento_id + '|' + cl];
        if (!fuera) n++;
        return U.chip({ texto: cl, icono: fuera ? null : 'check', activo: !fuera, clase: 'js-cq2-etq', datos: { doc: s.documento_id, cl: cl } });
      }).join('');
      return '<li><span class="sx2-apilado" style="gap:2px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(s.nombre) + '</strong>' +
        '<span class="sx2-tenue" style="font-size:.75rem">' + U.esc(s.codigo) + (s.actuales.length ? ' · ya tiene ' + U.esc(s.actuales.join(', ')) : '') + '</span></span>' +
        '<span class="cq2-etq__chips">' + chips + '</span></li>';
    }).join('');
    return U.card({ titulo: 'Sube tu cobertura en un clic', icono: 'destello', i: 4, sub: cm.sugerencias.length + ' documento' + (cm.sugerencias.length === 1 ? '' : 's'), cuerpo:
      (efecto(cm) ? '<p class="cq2-pista sx2-tono-primario" style="margin:0 0 8px">' + U.ico('destello', 14) + U.esc(efecto(cm)) + '</p>' : '') +
      '<p class="sx2-tenue" style="margin:0 0 8px;font-size:.8125rem">Estos documentos existen pero no dicen a qué cláusula responden, así que la cobertura los cuenta como faltantes. Revisa la sugerencia (toca una cláusula para quitarla) y confírmala.</p>' +
      '<ul class="cq2-etq">' + filas + '</ul>' +
      '<div class="cq2-mas">' + U.boton({ texto: 'Aplicar ' + n + ' etiqueta' + (n === 1 ? '' : 's'), icono: 'check', variante: 'primario', clase: 'js-cq2-aplicar', deshabilitado: !n }) + '</div>' });
  }

  function bloqueAcuses(cm) {
    if (!cm.acuses.length) return '';
    var filas = cm.acuses.map(function (a) {
      var total = a.confirmados + a.pendientes.length;
      var pct = total ? Math.round(a.confirmados * 100 / total) : 100;
      return '<li class="cq2-acuse js-cq2-quien" data-doc="' + U.esc(a.documento_id) + '" tabindex="0">' +
        '<span class="sx2-apilado" style="gap:6px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(a.nombre) + '</strong>' +
          '<span class="sx2-flex" style="gap:8px;align-items:center">' + U.barra(pct, pct === 100 ? 'ok' : 'primario') +
          '<span class="sx2-tenue" style="flex:none;font-size:.75rem">' + a.confirmados + ' de ' + total + '</span></span></span>' +
        (a.pendientes.length ? U.badge('Faltan ' + a.pendientes.length, 'alerta') : U.badge('Completo', 'ok')) + '</li>';
    }).join('');
    return U.card({ titulo: 'Confirmaciones de lectura', icono: 'check', i: 5, sub: cm.acuses.length + ' documento' + (cm.acuses.length === 1 ? '' : 's'),
      cuerpo: '<ul class="cq2-acuses">' + filas + '</ul>' });
  }

  function bloqueMios(mios) {
    return U.card({ titulo: mios.length ? 'Te toca confirmar' : 'Estás al día', icono: mios.length ? 'reloj' : 'check', i: 6,
      sub: mios.length ? mios.length + ' documento' + (mios.length === 1 ? '' : 's') : '',
      cuerpo: mios.length ? '<ul class="sx2-py-mt-lista">' + filasInicio(mios) + '</ul>'
        : '<p class="sx2-tenue" style="margin:0">No tienes documentos pendientes de confirmar. Si se publica uno que te corresponda, aparecerá aquí y en tu Inicio.</p>' });
  }

  function abrirQuien(id) {
    var a = (datos_.camino.acuses || []).filter(function (x) { return x.documento_id === id; })[0];
    if (!a) return;
    var persona = function (email, extra) {
      var p = PY.persona(email);
      return '<li>' + U.avatar(p, 'xs') + '<span class="sx2-cortar">' + U.esc(p.nombre) + '</span>' + (extra || '') + '</li>';
    };
    U.drawer({ titulo: a.nombre, subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(a.codigo + (a.version ? ' · ' + a.version : '')) + ' · ' + a.confirmados + ' confirmaron</span>',
      cuerpo: '<section class="sx2-seccion-drawer"><h3 class="sx2-seccion-drawer__titulo">Faltan (' + a.pendientes.length + ')</h3>' +
        (a.pendientes.length ? '<ul class="nv2-gente">' + a.pendientes.map(function (p) { return persona(p.email, p.nunca_entro ? U.badge('Nunca entró a SIGSO', 'neutro', true) : ''); }).join('') + '</ul>'
          : '<p class="sx2-tenue" style="margin:0">Todas las personas con cuenta lo confirmaron.</p>') + '</section>' +
        (a.sin_cuenta.length ? '<section class="sx2-seccion-drawer"><h3 class="sx2-seccion-drawer__titulo">Sin cuenta activa en SIGSO (' + a.sin_cuenta.length + ')</h3>' +
          '<p class="sx2-tenue" style="margin:0;font-size:.75rem">No pueden confirmar y no cuentan como pendientes. Si deben conocer el documento, créales una cuenta en Administración.</p>' +
          '<ul class="nv2-gente nv2-gente--sin">' + a.sin_cuenta.map(function (e) { return persona(e); }).join('') + '</ul></section>' : ''),
      pie: U.boton({ texto: 'Abrir documento', icono: 'documento', clase: 'js-cq2-abrir-doc', datos: { doc: a.documento_id } }) + U.boton({ texto: 'Cerrar', clase: 'js-sx2-drawer-cerrar' })
    });
  }

  function aplicar() {
    var items = [];
    datos_.camino.sugerencias.forEach(function (s) {
      var cls = s.sugeridas.filter(function (cl) { return !quitadas_[s.documento_id + '|' + cl]; });
      if (cls.length) items.push({ documento_id: s.documento_id, clausulas: cls });
    });
    if (!items.length) return;
    var n = items.reduce(function (t, it) { return t + it.clausulas.length; }, 0);
    U.confirmar({ titulo: 'Aplicar ' + n + ' etiqueta' + (n === 1 ? '' : 's') + ' ISO', boton: 'Aplicar',
      texto: 'Se agregan a ' + items.length + ' documento' + (items.length === 1 ? '' : 's') + ' (las que ya tenían se conservan). Puedes cambiarlas después en la ficha de cada documento.' }).then(function (si) {
      if (!si) return;
      var b = document.querySelector('#calidad-v2 .js-cq2-aplicar');
      if (b) b.disabled = true;
      api('aplicarEtiquetasSgc', { items: items }).then(function (r) {
        if (!r || !r.ok) { if (b) b.disabled = false; PY.aviso((r && r.message) || 'No se pudieron aplicar.', 'error'); return; }
        var antes = datos_.camino.resumen.pct_listo;
        PY.aviso(r.data.aplicados + ' documento' + (r.data.aplicados === 1 ? '' : 's') + ' etiquetado' + (r.data.aplicados === 1 ? '' : 's') +
          ' · listo para certificar: ' + antes + '% → ' + r.data.resumen.pct_listo + '%' + (r.data.fallas.length ? ' · ' + r.data.fallas.length + ' con error' : ''), r.data.fallas.length ? 'error' : 'exito');
        quitadas_ = {};
        if (window.SigsoCalidad && SigsoCalidad.invalidar) SigsoCalidad.invalidar();
        cargar(true);
      });
    });
  }

  // --- Eventos ------------------------------------------------------------------------
  document.addEventListener('click', function (ev) {
    var t = ev.target, b;
    // Filas de documentos por confirmar (Inicio de SIGSO o este Inicio).
    if ((b = t.closest && t.closest('[data-cq2-doc]'))) { abrirDocumento(b.getAttribute('data-cq2-doc')); return; }
    if ((b = t.closest && t.closest('.js-cq2-abrir-doc'))) { abrirDocumento(b.getAttribute('data-doc')); return; }
    var raiz = document.getElementById('calidad-v2');
    if (!raiz || !raiz.contains(t)) return;
    if (t.closest('.js-cq2-recargar')) { cargar(); return; }
    if ((b = t.closest('.js-cq2-ir'))) { irA(b.getAttribute('data-ir')); return; }
    if ((b = t.closest('.js-cq2-cap'))) { var k = Number(b.getAttribute('data-cap')) || 0; capitulo_ = capitulo_ === k ? 0 : k; pintar(true); return; }
    if (t.closest('.js-cq2-mas')) { verTodosPasos_ = !verTodosPasos_; pintar(true); return; }
    if ((b = t.closest('.js-cq2-etq'))) {
      var llave = b.getAttribute('data-doc') + '|' + b.getAttribute('data-cl');
      if (quitadas_[llave]) delete quitadas_[llave]; else quitadas_[llave] = true;
      pintar(true);
      return;
    }
    if (t.closest('.js-cq2-aplicar')) { aplicar(); return; }
    if ((b = t.closest('.js-cq2-quien'))) abrirQuien(b.getAttribute('data-doc'));
  });
  document.addEventListener('keydown', function (ev) {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('[data-cq2-doc], #calidad-v2 .js-cq2-quien')) { ev.preventDefault(); ev.target.click(); }
  });
  document.addEventListener('sigso:sgc-acuse', function () {
    var c = document.getElementById('calidad-v2');
    if (c && c.offsetParent !== null && ocupa('inicio')) cargar(true);
  });

  // 2026-09-25: la versión clásica se retiró; la v2 es la única.
  function activo() { return true; }
  function usarVersion() { /* sin versión clásica */ }

  window.SigsoCalidadV2 = {
    // calidad.js llama aquí cuando la sección activa es 'inicio'.
    mostrarInicio: function () { cargar(!!datos_ && ocupa('inicio')); },
    // 8B: Documentos (calidad-documentos-v2.js).
    mostrarDocumentos: function (o) { if (window.SigsoCalidadDocsV2) SigsoCalidadDocsV2.mostrar(o); },
    refrescarDocumentos: function () { if (window.SigsoCalidadDocsV2 && ocupa('documentos')) SigsoCalidadDocsV2.refrescar(); },
    // 8C: Personas (calidad-personas-v2.js).
    mostrarPersonas: function () { if (window.SigsoCalidadPersonasV2) SigsoCalidadPersonasV2.mostrar(); },
    // Lo compartido con calidad-documentos-v2.js.
    util: { api: api, TIPO: TIPO, plazo: plazo, fechaChile: fechaChile, diasHasta: diasHasta, contenedor: contenedor, ocupa: ocupa, desmontar: desmontar },
    cargar: function () { if (window.SigsoCalidad) SigsoCalidad.recargar(); },
    refrescar: function () {
      if (ocupa('documentos')) { if (window.SigsoCalidadDocsV2) SigsoCalidadDocsV2.refrescar(); }
      else if (ocupa('personas')) { if (window.SigsoCalidadPersonasV2) SigsoCalidadPersonasV2.refrescar(); }
      else cargar(true);
    },
    abrirDocumento: abrirDocumento,
    filasInicio: filasInicio,
    activo: activo, usarVersion: usarVersion, desmontar: desmontar
  };
})();
