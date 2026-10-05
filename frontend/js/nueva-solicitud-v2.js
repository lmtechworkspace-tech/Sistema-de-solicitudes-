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
 *
 * Etapa 4 (2026-10-05): TODO EN UNA PANTALLA. "¿Qué necesitas?" con un
 * buscador sobre los servicios de todos los departamentos ("certificado F30",
 * "liquidación"), filtros por departamento y, al elegir, el formulario corto
 * debajo, sin cambiar de paso. El cliente aparece solo si el servicio lo pide
 * (pide_cliente: no / opcional / si).
 */
(function () {
  'use strict';

  var MAX_ADJUNTOS = 5;
  var MAX_BYTES = 10 * 1024 * 1024;
  var catalogo_ = null, clientes_ = null;
  var e = { paso: 'destino', depto: null, servicio: null, enviando: false, archivos: [], resultado: null, q: '', filtro: '' };
  // Para buscar sin importar tildes ni mayúsculas.
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  function plazoTxt(d) { return d ? d + (d === 1 ? ' día hábil' : ' días hábiles') : ''; }
  function otroPedido(d) { return { servicio_id: '', nombre: 'Otro pedido', descripcion: 'Algo que no está en la lista de ' + d.nombre + '.', plazo_dias: 0, pide_cliente: 'opcional' }; }

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
    // Mientras se pide a un departamento, el formulario técnico se oculta.
    s.classList.toggle('ns2-modo-depto', e.paso !== 'tecnico');
    if (e.paso === 'tecnico') {
      r.innerHTML = '<div class="ns2-volver"><button type="button" class="sx2-boton sx2-boton--fantasma sx2-boton--sm js-ns2-destino">' + ico('izquierda', 14) + 'Cambiar a quién le pides</button>' +
        '<span class="sx2-tenue">Soporte de plataformas (Desarrollo / TI)</span></div>';
      return;
    }
    if (e.paso === 'listo') { r.innerHTML = vistaListo(); return; }
    if (!catalogo_) { r.innerHTML = '<div class="ns2-pedido">' + (U() ? U().esqueleto('kpis', 4) : '') + '</div>'; return; }
    r.innerHTML = '<div class="ns2-pedido ns2-una">' +
      '<header class="ns2-pedido__cab"><span class="sx2-cabecera__migas">Solicitudes</span><h1>¿Qué necesitas?</h1>' +
        '<p class="sx2-tenue">Busca el servicio o elige el departamento. Llega a su cola y te avisan por correo cuando lo tomen, si necesitan algo de ti y cuando esté listo.</p></header>' +
      (e.servicio ? elegido() + formulario() : buscador() + '<div class="js-ns2-res" aria-live="polite">' + resultados() + '</div>') +
    '</div>';
    var foco = r.querySelector('.js-ns2-foco');
    if (foco) { foco.focus(); if (foco.setSelectionRange && foco.value) foco.setSelectionRange(foco.value.length, foco.value.length); }
  }

  function buscador() {
    var deps = catalogo_.departamentos || [];
    var chip = function (id, texto, icono) {
      var on = e.filtro === id;
      return '<button type="button" class="ns2-chip js-ns2-filtro' + (on ? ' is-activo' : '') + '" data-filtro="' + esc(id) + '" aria-pressed="' + on + '">' + (icono ? ico(icono, 14) : '') + esc(texto) + '</button>';
    };
    return '<div class="ns2-busca"><label class="ns2-busca__caja">' + ico('lupa', 18) +
        '<input type="search" class="sx2-input js-ns2-q js-ns2-foco" value="' + esc(e.q) + '" placeholder="Por ejemplo: certificado F30, liquidación, error en la intranet" aria-label="¿Qué necesitas?" autocomplete="off"></label>' +
      '<div class="ns2-chips" role="group" aria-label="Departamento">' + chip('', 'Todos') +
        deps.map(function (d) { return chip(d.clave, d.nombre, d.icono || 'equipo'); }).join('') + chip('TECNICO', 'Soporte de plataformas', 'ajustes') + '</div></div>';
  }

  // Los servicios que calzan con lo escrito (todas las palabras, sin tildes), agrupados por departamento.
  function coincidencias() {
    var palabras = norm(e.q).split(/\s+/).filter(Boolean);
    var deps = (catalogo_.departamentos || []).filter(function (d) { return !e.filtro || e.filtro === d.clave; });
    return deps.map(function (d) {
      var lista = (d.servicios || []).filter(function (x) {
        if (!palabras.length) return true;
        var t = norm([x.nombre, x.descripcion, x.ayuda, d.nombre, x.proceso_codigo].join(' '));
        return palabras.every(function (p) { return t.indexOf(p) !== -1; });
      }).sort(function (a, b) {
        // Lo que calza en el nombre, primero.
        var na = palabras.every(function (p) { return norm(a.nombre).indexOf(p) !== -1; }) ? 0 : 1;
        var nb = palabras.every(function (p) { return norm(b.nombre).indexOf(p) !== -1; }) ? 0 : 1;
        return na - nb;
      });
      return { d: d, lista: lista };
    });
  }

  function tarjeta(d, x, conDepto) {
    return '<button type="button" class="ns2-servicio js-ns2-servicio" data-depto="' + esc(d.clave) + '" data-id="' + esc(x.servicio_id) + '">' +
      '<strong>' + esc(x.nombre) + '</strong>' +
      (conDepto ? '<small class="ns2-servicio__depto">' + ico(d.icono || 'equipo', 12) + ' ' + esc(d.nombre) + '</small>' : '') +
      (x.descripcion ? '<small>' + esc(x.descripcion) + '</small>' : '') +
      (x.plazo_dias ? '<small class="ns2-servicio__plazo">' + ico('reloj', 12) + ' ' + plazoTxt(x.plazo_dias) + '</small>' : '') +
    '</button>';
  }
  function tecnico() {
    return '<button type="button" class="ns2-destino ns2-destino--tecnico js-ns2-tecnico">' +
      '<span class="ns2-destino__ico">' + ico('ajustes', 20) + '</span>' +
      '<span class="ns2-destino__txt"><strong>Soporte de plataformas</strong><small>Errores o mejoras de un sistema (Desarrollo / TI): el formulario técnico.</small></span></button>';
  }

  function resultados() {
    if (e.filtro === 'TECNICO') return '<div class="ns2-grupo">' + tecnico() + '</div>';
    var grupos = coincidencias();
    var hay = grupos.some(function (g) { return g.lista.length; });
    if (e.q && !hay) {
      var deps = grupos.map(function (g) { return g.d; });
      return '<div class="ns2-sin">' + U().vacio({ icono: 'lupa', titulo: 'No hay un servicio con «' + esc(e.q) + '»', texto: 'Pídelo como «Otro pedido» al departamento que corresponda, o a Soporte de plataformas si es un sistema.' }) +
        '<div class="ns2-otros">' + deps.map(function (d) {
          return '<button type="button" class="ns2-chip js-ns2-servicio" data-depto="' + esc(d.clave) + '" data-id="">' + ico(d.icono || 'equipo', 14) + 'Otro pedido a ' + esc(d.nombre) + '</button>';
        }).join('') + '</div>' + tecnico() + '</div>';
    }
    // Con búsqueda: lista plana de lo que calza, con su departamento. Sin búsqueda: por departamento.
    if (e.q) {
      var planos = [];
      grupos.forEach(function (g) { g.lista.forEach(function (x) { planos.push(tarjeta(g.d, x, true)); }); });
      return '<p class="sx2-tenue ns2-cuenta">' + planos.length + (planos.length === 1 ? ' servicio' : ' servicios') + '</p><div class="ns2-servicios">' + planos.join('') + '</div>' +
        '<p class="sx2-tenue ns2-nota">¿No es ninguno? Borra la búsqueda y elige «Otro pedido» en el departamento.</p>';
    }
    return grupos.map(function (g) {
      return '<section class="ns2-grupo"><h2 class="ns2-grupo__tit">' + ico(g.d.icono || 'equipo', 16) + esc(g.d.nombre) +
          (g.d.con_equipo === false ? ' <small class="sx2-tenue">· todavía sin equipo: lo recibe Administración</small>' : '') + '</h2>' +
        '<div class="ns2-servicios">' + g.lista.map(function (x) { return tarjeta(g.d, x, false); }).join('') + tarjeta(g.d, otroPedido(g.d), false) + '</div></section>';
    }).join('') + (e.filtro ? '' : '<section class="ns2-grupo"><h2 class="ns2-grupo__tit">' + ico('ajustes', 16) + 'Sistemas</h2>' + tecnico() + '</section>');
  }

  // El servicio elegido, arriba del formulario, con su plazo y cómo cambiarlo.
  function elegido() {
    var d = e.depto, sv = e.servicio;
    return '<div class="ns2-elegido"><span class="ns2-destino__ico">' + ico(d.icono || 'equipo', 18) + '</span>' +
      '<span class="ns2-elegido__txt"><small class="sx2-tenue">Pedido a ' + esc(d.nombre) + '</small><strong>' + esc(sv.nombre) + '</strong>' +
        (sv.plazo_dias ? '<small class="sx2-tenue">' + ico('reloj', 12) + ' Plazo habitual: ' + plazoTxt(sv.plazo_dias) + '</small>' : '') + '</span>' +
      '<button type="button" class="sx2-boton sx2-boton--fantasma sx2-boton--sm js-ns2-cambiar">' + ico('izquierda', 14) + 'Elegir otro</button></div>';
  }

  function formulario() {
    var sv = e.servicio;
    var hoy = new Date(); var min = hoy.getFullYear() + '-' + ('0' + (hoy.getMonth() + 1)).slice(-2) + '-' + ('0' + hoy.getDate()).slice(-2);
    var opcionesClientes = (clientes_ || []).slice(0, 2000).map(function (c) {
      return '<option value="' + esc(c.razon_social + (c.rut ? ' — ' + c.rut : '')) + '"></option>';
    }).join('');
    return '<form class="ns2-bloque ns2-form js-ns2-form" novalidate>' +
      campo('¿Qué necesitas?', '<input class="sx2-input js-ns2-foco" name="titulo" maxlength="200" value="' + esc(sv.servicio_id ? sv.nombre : '') + '" placeholder="En una línea">') +
      campo('Detalle', '<textarea class="sx2-input" name="descripcion" rows="4" maxlength="4000" placeholder="' + esc(sv.ayuda || 'Cuéntales lo necesario para que no tengan que preguntarte.') + '"></textarea>', sv.ayuda ? 'Indica: ' + sv.ayuda : '') +
      '<div class="sx2-form__fila">' +
        (sv.pide_cliente === 'no' ? '' : campo(sv.pide_cliente === 'si' ? '¿Para qué cliente?' : '¿Para qué cliente? (opcional)', '<input class="sx2-input" name="cliente" list="ns2-clientes" maxlength="200" placeholder="Escribe para buscar" autocomplete="off"' + (sv.pide_cliente === 'si' ? ' required' : '') + '><datalist id="ns2-clientes">' + opcionesClientes + '</datalist>')) +
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
    var cli = form.cliente ? clienteDe(form.cliente.value) : null;
    if (e.servicio.pide_cliente === 'si' && !cli) return mal('Este pedido necesita el cliente: escríbelo o búscalo en la lista.');
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
    if ((b = t.closest('.js-ns2-filtro'))) { e.filtro = b.getAttribute('data-filtro'); pintar(); return; }
    if ((b = t.closest('.js-ns2-servicio'))) {
      var id = b.getAttribute('data-id');
      e.depto = (catalogo_.departamentos || []).filter(function (d) { return d.clave === b.getAttribute('data-depto'); })[0];
      if (!e.depto) return;
      e.servicio = id ? (e.depto.servicios || []).filter(function (x) { return x.servicio_id === id; })[0] : otroPedido(e.depto);
      e.paso = 'pedido';
      pintar(); cargarClientes();
      window.scrollTo(0, 0);
      return;
    }
    if (t.closest('.js-ns2-cambiar')) { e.servicio = null; e.depto = null; e.paso = 'destino'; pintar(); return; }
    if (t.closest('.js-ns2-destino')) { e.paso = 'destino'; e.depto = null; e.servicio = null; pintar(); return; }
    if (t.closest('.js-ns2-tecnico')) { e.paso = 'tecnico'; pintar(); window.scrollTo(0, 0); return; }
    if (t.closest('.js-ns2-otra')) { e.paso = 'destino'; e.depto = null; e.servicio = null; e.resultado = null; e.q = ''; e.filtro = ''; pintar(); return; }
    if (t.closest('.js-ns2-mis') && window.SigsoShell) { SigsoShell.irAModulo('mis_solicitudes'); }
  });
  // Buscar mientras se escribe: solo se repintan los resultados (el foco queda en la caja).
  document.addEventListener('input', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('js-ns2-q')) return;
    e.q = ev.target.value;
    var res = document.querySelector('#ns2-pedido .js-ns2-res');
    if (res) res.innerHTML = resultados();
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
    e = { paso: 'destino', depto: null, servicio: null, enviando: false, archivos: [], resultado: null, q: '', filtro: '' };
  }
  // 2026-09-25: la versión clásica se retiró; la v2 es la única.
  function activo() { return true; }
  function usarVersion() { /* sin versión clásica */ }

  window.SigsoNuevaSolicitudV2 = {
    cargar: montar, refrescar: function () { if (!document.getElementById('ns2-pedido')) montar(); },
    activo: activo, usarVersion: usarVersion, desmontar: desmontar
  };
})();
