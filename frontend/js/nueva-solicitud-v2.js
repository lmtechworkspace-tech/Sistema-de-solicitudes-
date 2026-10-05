/**
 * nueva-solicitud-v2.js — Nueva solicitud v2 (SIGSO v2, Módulo 3D).
 *
 * Decisión del dueño (2026-09-24): PIEL v2 sobre la lógica actual. El
 * formulario técnico sigue siendo formulario.js (catálogos, módulos en
 * cascada, clientes, borrador, adjuntos, envío) y el CSS
 * css/v2/nueva-solicitud-v2.css lo viste.
 *
 * Solicitudes, etapa 2 (2026-10-05, decisión del dueño: el módulo es para
 * TODOS los departamentos): antes del formulario se elige A QUIÉN se le pide.
 *  - Un departamento (Contabilidad, RR.HH., …) → uno de sus servicios (o
 *    "Otro pedido") → un formulario corto: qué necesitas, el detalle, para
 *    qué cliente, para cuándo y adjuntos. Llega a la cola del departamento
 *    (serviciosSolicitud.js), con la prioridad y el plazo del servicio.
 *  - "Soporte de plataformas" (Desarrollo / TI) → el formulario técnico de
 *    siempre, sin cambios.
 *
 * La pregunta de gravedad en un toque (obligatoria dentro de la plataforma)
 * vive en formulario.js, porque es un dato -- no depende de la versión.
 */
(function () {
  'use strict';

  var MAX_ADJUNTOS = 5;
  var MAX_BYTES = 10 * 1024 * 1024;
  var catalogo_ = null, clientes_ = null;
  var e = { paso: 'destino', depto: null, servicio: null, enviando: false, archivos: [], resultado: null };

  function U() { return window.UIv2; }
  function esc(t) { return U() ? U().esc(t) : String(t == null ? '' : t); }
  function ico(n, t) { return U() ? U().ico(n, t || 16) : ''; }
  function api(accion, datos) {
    return llamarApi(window.SIGSO_CONFIG.INTAKE_URL, accion, datos || {}).catch(function (err) {
      return { ok: false, message: (err && err.message) || 'No se pudo conectar.' };
    });
  }
  function cuenta() {
    try { return JSON.parse(localStorage.getItem('sigso_portal_cuenta') || '{}') || {}; } catch (err) { return {}; }
  }
  function aviso(m, tipo) { if (window.PYv2 && PYv2.aviso) PYv2.aviso(m, tipo); }
  function campo(etiqueta, control, ayuda) {
    return '<label class="sx2-campo"><span class="sx2-campo__et">' + esc(etiqueta) + '</span>' + control +
      (ayuda ? '<span class="sx2-campo__ayuda">' + esc(ayuda) + '</span>' : '') + '</label>';
  }

  function seccion() { return document.getElementById('modulo-nueva_solicitud'); }
  function raiz() {
    var s = seccion();
    if (!s) return null;
    var r = document.getElementById('ns2-pedido');
    if (!r) {
      r = document.createElement('div');
      r.id = 'ns2-pedido';
      s.insertBefore(r, s.firstChild);
    }
    return r;
  }

  // --- Pintado -----------------------------------------------------------------------------
  function pintar() {
    var s = seccion(), r = raiz();
    if (!s || !r) return;
    // Mientras se elige destino o se pide a un departamento, el formulario técnico se oculta.
    s.classList.toggle('ns2-modo-depto', e.paso !== 'tecnico');
    if (e.paso === 'tecnico') {
      r.innerHTML = '<div class="ns2-volver"><button type="button" class="sx2-boton sx2-boton--fantasma sx2-boton--sm js-ns2-destino">' + ico('izquierda', 14) + 'Cambiar a quién le pides</button>' +
        '<span class="sx2-tenue">Soporte de plataformas (Desarrollo / TI)</span></div>';
      return;
    }
    if (e.paso === 'listo') { r.innerHTML = vistaListo(); return; }
    if (!catalogo_) { r.innerHTML = '<div class="ns2-pedido">' + (U() ? U().esqueleto('kpis', 4) : '') + '</div>'; return; }
    r.innerHTML = '<div class="ns2-pedido">' +
      '<header class="ns2-pedido__cab"><span class="sx2-cabecera__migas">Solicitudes</span><h1>Nueva solicitud</h1>' +
        '<p class="sx2-tenue">' + (e.paso === 'destino' ? '¿A quién le pides? Elige el departamento; ellos lo reciben en su cola y te avisan cuando esté listo.' : 'Pedido a ' + esc(e.depto.nombre) + '.') + '</p></header>' +
      (e.paso === 'destino' ? vistaDestino() : vistaPedido()) + '</div>';
    var foco = r.querySelector('.js-ns2-foco');
    if (foco) foco.focus();
  }

  function vistaDestino() {
    var deps = catalogo_.departamentos || [];
    return '<div class="ns2-destinos">' + deps.map(function (d) {
      var n = (d.servicios || []).length;
      return '<button type="button" class="ns2-destino js-ns2-depto" data-depto="' + esc(d.clave) + '">' +
        '<span class="ns2-destino__ico">' + ico(d.icono || 'equipo', 20) + '</span>' +
        '<span class="ns2-destino__txt"><strong>' + esc(d.nombre) + '</strong>' +
        '<small>' + (n ? n + (n === 1 ? ' servicio' : ' servicios') : 'Cuéntales qué necesitas') + '</small></span></button>';
    }).join('') +
      '<button type="button" class="ns2-destino ns2-destino--tecnico js-ns2-tecnico">' +
        '<span class="ns2-destino__ico">' + ico('ajustes', 20) + '</span>' +
        '<span class="ns2-destino__txt"><strong>Soporte de plataformas</strong><small>Errores o mejoras de un sistema (Desarrollo / TI)</small></span></button>' +
    '</div>';
  }

  function vistaPedido() {
    var d = e.depto, sv = e.servicio;
    var servicios = (d.servicios || []).concat([{ servicio_id: '', nombre: 'Otro pedido', descripcion: 'Algo que no está en la lista.', plazo_dias: 0 }]);
    var lista = '<div class="ns2-servicios" role="radiogroup" aria-label="Servicio">' + servicios.map(function (x) {
      var activo = sv && sv.servicio_id === x.servicio_id;
      return '<button type="button" role="radio" aria-checked="' + !!activo + '" class="ns2-servicio js-ns2-servicio' + (activo ? ' is-activo' : '') + '" data-id="' + esc(x.servicio_id) + '">' +
        '<strong>' + esc(x.nombre) + '</strong>' +
        (x.descripcion ? '<small>' + esc(x.descripcion) + '</small>' : '') +
        (x.plazo_dias ? '<small class="ns2-servicio__plazo">' + ico('reloj', 12) + ' ' + x.plazo_dias + (x.plazo_dias === 1 ? ' día hábil' : ' días hábiles') + '</small>' : '') +
      '</button>';
    }).join('') + '</div>';
    return '<div class="ns2-pasos"><button type="button" class="sx2-boton sx2-boton--fantasma sx2-boton--sm js-ns2-destino">' + ico('izquierda', 14) + 'Otro departamento</button></div>' +
      '<section class="ns2-bloque"><h2>¿Qué le pides a ' + esc(d.nombre) + '?</h2>' + lista + '</section>' +
      (sv ? formulario() : '');
  }

  function formulario() {
    var sv = e.servicio;
    var hoy = new Date(); var min = hoy.getFullYear() + '-' + ('0' + (hoy.getMonth() + 1)).slice(-2) + '-' + ('0' + hoy.getDate()).slice(-2);
    var opcionesClientes = (clientes_ || []).slice(0, 2000).map(function (c) {
      return '<option value="' + esc(c.razon_social + (c.rut ? ' — ' + c.rut : '')) + '"></option>';
    }).join('');
    return '<form class="ns2-bloque ns2-form js-ns2-form" novalidate><h2>Tu pedido</h2>' +
      campo('¿Qué necesitas?', '<input class="sx2-input js-ns2-foco" name="titulo" maxlength="200" value="' + esc(sv.servicio_id ? sv.nombre : '') + '" placeholder="En una línea">') +
      campo('Detalle', '<textarea class="sx2-input" name="descripcion" rows="4" maxlength="4000" placeholder="' + esc(sv.ayuda || 'Cuéntales lo necesario para que no tengan que preguntarte.') + '"></textarea>', sv.ayuda ? 'Indica: ' + sv.ayuda : '') +
      '<div class="sx2-form__fila">' +
        campo('¿Para qué cliente? (opcional)', '<input class="sx2-input" name="cliente" list="ns2-clientes" maxlength="200" placeholder="Escribe para buscar" autocomplete="off"><datalist id="ns2-clientes">' + opcionesClientes + '</datalist>') +
        campo('¿Para cuándo lo necesitas? (opcional)', '<input class="sx2-input" type="date" name="fecha" min="' + min + '">', sv.plazo_dias ? 'Plazo habitual: ' + sv.plazo_dias + (sv.plazo_dias === 1 ? ' día hábil.' : ' días hábiles.') : '') +
      '</div>' +
      '<label class="ns2-urgente"><input type="checkbox" name="urgente"> <span><b>Es urgente</b> <small class="sx2-tenue">Solo si de verdad no puede esperar el plazo habitual.</small></span></label>' +
      campo('Adjuntos (opcional)', '<input class="sx2-input" type="file" name="archivos" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt">', 'Hasta ' + MAX_ADJUNTOS + ' archivos de 10 MB.') +
      '<p class="sx2-campo__error js-ns2-error" hidden></p>' +
      '<div class="ns2-acciones"><button type="submit" class="sx2-boton sx2-boton--primario"' + (e.enviando ? ' disabled' : '') + '>' + ico('derecha', 16) + (e.enviando ? 'Enviando…' : 'Enviar a ' + esc(e.depto.nombre)) + '</button></div>' +
    '</form>';
  }

  function vistaListo() {
    var r = e.resultado || {};
    var conMis = window.SigsoShell && SigsoShell.tieneModulo('mis_solicitudes');
    return '<div class="ns2-pedido"><section class="ns2-bloque ns2-listo">' +
      '<span class="ns2-listo__ico">' + ico('check', 26) + '</span>' +
      '<h1>Listo: tu pedido llegó a ' + esc(r.depto || '') + '</h1>' +
      '<p>Número <b>' + esc(r.solicitud_id || '') + '</b>. Te avisaremos por correo cuando empiecen, si necesitan algo de ti y cuando esté resuelto.</p>' +
      (r.fallasAdjuntos ? '<p class="sx2-tenue">' + r.fallasAdjuntos + ' adjunto(s) no se pudieron subir: agrégalos desde Mis solicitudes.</p>' : '') +
      '<div class="ns2-acciones">' +
        (conMis ? '<button type="button" class="sx2-boton sx2-boton--primario js-ns2-mis">' + ico('lista', 16) + 'Ver en Mis solicitudes</button>' : '') +
        '<button type="button" class="sx2-boton sx2-boton--secundario js-ns2-otra">' + ico('nueva', 16) + 'Hacer otro pedido</button>' +
      '</div></section></div>';
  }

  // --- Datos -------------------------------------------------------------------------------
  function cargarCatalogo() {
    if (catalogo_) return Promise.resolve();
    return api('catalogoServiciosSolicitud', {}).then(function (r) {
      catalogo_ = r && r.ok ? r.data : { departamentos: [] };
      if (!r || !r.ok) aviso((r && r.message) || 'No se pudo cargar la lista de departamentos.', 'error');
    });
  }
  function cargarClientes() {
    if (clientes_) return;
    api('getClientes', {}).then(function (r) {
      clientes_ = r && r.ok && Array.isArray(r.data) ? r.data : [];
      var dl = document.getElementById('ns2-clientes');
      if (dl) dl.innerHTML = clientes_.slice(0, 2000).map(function (c) { return '<option value="' + esc(c.razon_social + (c.rut ? ' — ' + c.rut : '')) + '"></option>'; }).join('');
    });
  }
  function clienteDe(texto) {
    var t = String(texto || '').trim();
    if (!t) return null;
    var c = (clientes_ || []).filter(function (x) { return (x.razon_social + (x.rut ? ' — ' + x.rut : '')) === t; })[0];
    return c ? { nombre: c.razon_social, rut: c.rut || '', codigo: c.codigo_cliente || '' } : { nombre: t, rut: '', codigo: '' };
  }
  function leerBase64(file) {
    return new Promise(function (ok, mal) {
      var l = new FileReader();
      l.onload = function () { ok(String(l.result).split(',')[1] || ''); };
      l.onerror = mal;
      l.readAsDataURL(file);
    });
  }

  function enviar(form) {
    var err = form.querySelector('.js-ns2-error');
    function mal(m) { err.textContent = m; err.hidden = false; }
    var titulo = form.titulo.value.trim(), descripcion = form.descripcion.value.trim();
    if (titulo.length < 3) return mal('Escribe en una línea qué necesitas.');
    if (descripcion.length < 5) return mal('Agrega el detalle: lo que el equipo necesita saber.');
    var archivos = [].slice.call(form.archivos.files || []);
    if (archivos.length > MAX_ADJUNTOS) return mal('Puedes adjuntar hasta ' + MAX_ADJUNTOS + ' archivos.');
    if (archivos.some(function (f) { return f.size > MAX_BYTES; })) return mal('Cada archivo puede pesar hasta 10 MB.');
    var c = cuenta(), email = (c.emails || [])[0] || '';
    if (!email) return mal('Tu sesión no tiene correo. Vuelve a ingresar.');
    var cli = clienteDe(form.cliente.value);
    var datos = {
      empresa_id: c.empresa_id || 'HP', asociada_plataforma: false, plataforma: '',
      solicitante_nombre: c.nombre || email, solicitante_cargo: c.cargo || 'Sin cargo', solicitante_email: email,
      fecha_propuesta: form.fecha.value ? form.fecha.value + 'T18:00' : '',
      empresa_cliente: cli ? cli.nombre : '', rut_cliente: cli ? cli.rut : '', codigo_cliente: cli ? cli.codigo : '',
      subsolicitudes: [{
        titulo: titulo, descripcion: descripcion, depto: e.depto.clave,
        servicio_id: e.servicio.servicio_id || '', urgente: !!form.urgente.checked
      }]
    };
    e.enviando = true;
    var btn = form.querySelector('[type=submit]');
    btn.disabled = true; btn.lastChild.textContent = 'Enviando…';
    err.hidden = true;
    api('crearSolicitud', datos).then(function (r) {
      if (!r || !r.ok) {
        e.enviando = false; btn.disabled = false; btn.lastChild.textContent = 'Enviar a ' + e.depto.nombre;
        var detalle = r && r.fields && r.fields.length ? ' (' + r.fields.map(function (x) { return x.mensaje; }).join('; ') + ')' : '';
        return mal(((r && r.message) || 'No se pudo enviar.') + detalle);
      }
      var id = r.data.solicitud_id, subId = id + '-01', fallas = 0;
      return archivos.reduce(function (p, f) {
        return p.then(function () {
          return leerBase64(f).then(function (b64) {
            return api('subirArchivo', { solicitud_id: id, subsolicitud_id: subId, nombre_archivo: f.name, contenido_base64: b64 });
          }).then(function (x) { if (!x || !x.ok) fallas++; }).catch(function () { fallas++; });
        });
      }, Promise.resolve()).then(function () {
        e.enviando = false;
        e.resultado = { solicitud_id: id, depto: e.depto.nombre, fallasAdjuntos: fallas };
        e.paso = 'listo';
        pintar();
        document.dispatchEvent(new CustomEvent('sigso:solicitudes-cambio'));
      });
    });
  }

  // --- Eventos -----------------------------------------------------------------------------
  document.addEventListener('click', function (ev) {
    var r = document.getElementById('ns2-pedido');
    if (!r || !r.contains(ev.target)) return;
    var t = ev.target, b;
    if ((b = t.closest('.js-ns2-depto'))) {
      e.depto = (catalogo_.departamentos || []).filter(function (d) { return d.clave === b.getAttribute('data-depto'); })[0];
      e.servicio = null; e.paso = 'pedido';
      // Con un solo camino ("Otro pedido"), se elige solo.
      if (e.depto && !(e.depto.servicios || []).length) e.servicio = { servicio_id: '', nombre: 'Otro pedido', plazo_dias: 0 };
      pintar(); cargarClientes();
      return;
    }
    if ((b = t.closest('.js-ns2-servicio'))) {
      var id = b.getAttribute('data-id');
      e.servicio = id ? (e.depto.servicios || []).filter(function (x) { return x.servicio_id === id; })[0] : { servicio_id: '', nombre: 'Otro pedido', plazo_dias: 0 };
      pintar();
      var f = r.querySelector('.js-ns2-form');
      if (f) f.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    if (t.closest('.js-ns2-destino')) { e.paso = 'destino'; e.depto = null; e.servicio = null; pintar(); return; }
    if (t.closest('.js-ns2-tecnico')) { e.paso = 'tecnico'; pintar(); window.scrollTo(0, 0); return; }
    if (t.closest('.js-ns2-otra')) { e.paso = 'destino'; e.depto = null; e.servicio = null; e.resultado = null; pintar(); return; }
    if (t.closest('.js-ns2-mis') && window.SigsoShell) { SigsoShell.irAModulo('mis_solicitudes'); }
  });
  document.addEventListener('submit', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('js-ns2-form')) return;
    ev.preventDefault();
    if (!e.enviando) enviar(ev.target);
  });

  function montar() {
    var s = seccion();
    if (!s) return;
    s.classList.add('sx2', 'ns2');
    pintar();
    cargarCatalogo().then(pintar);
  }
  function desmontar() {
    var s = seccion();
    if (s) s.classList.remove('sx2', 'ns2', 'ns2-modo-depto');
    var r = document.getElementById('ns2-pedido');
    if (r) r.remove();
    e = { paso: 'destino', depto: null, servicio: null, enviando: false, archivos: [], resultado: null };
  }
  // 2026-09-25: la versión clásica se retiró; la v2 es la única.
  function activo() { return true; }
  function usarVersion() { /* sin versión clásica */ }

  window.SigsoNuevaSolicitudV2 = {
    cargar: montar, refrescar: function () { if (!document.getElementById('ns2-pedido')) montar(); },
    activo: activo, usarVersion: usarVersion, desmontar: desmontar
  };
})();
