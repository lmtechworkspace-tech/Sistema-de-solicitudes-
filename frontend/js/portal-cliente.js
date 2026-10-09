/**
 * portal-cliente.js — Portal de clientes de SIGSO (2026-10-07). La aplicación
 * del contratista de HomePymes, pensada para el teléfono y para personas a las
 * que no les gusta la tecnología: letra grande, botones de dedo, una cosa por
 * pantalla, palabras de obra y ayuda en cada pantalla.
 *
 * Habla con el servidor SOLO por las acciones `cliente*` con su propio token
 * (backend/logica/portalClientes.js): un token de esta página no abre nada de
 * la plataforma interna. El servidor acota todo a la empresa del contratista.
 */
(function () {
  'use strict';

  var API = (window.SIGSO_CONFIG && window.SIGSO_CONFIG.NODE_API_URL) || 'https://api.ctrly.cl/v1/accion';
  var LLAVE = 'sigso_cliente_token';
  var app = document.getElementById('app'), capa = document.getElementById('capa');

  // ---------- Íconos (trazo simple, 24x24) ----------
  var I = {
    casa: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    mas: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    edificio: '<path d="M4 21V5l8-3v19M12 8h8v13M7 8h2M7 12h2M7 16h2M15 12h2M15 16h2"/>',
    personas: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20c-.5-2.6-1.9-4.3-3.8-5"/>',
    casco: '<path d="M3 17h18v2H3z"/><path d="M5 17a7 7 0 0 1 14 0"/><path d="M12 6v5"/>',
    calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h1M12 11h1M16 11h0M8 15h1M12 15h1M8 18h8"/>',
    globo: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
    flecha: '<path d="M9 5l7 7-7 7"/>',
    atras: '<path d="M15 5l-7 7 7 7"/>',
    ayuda: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7"/><path d="M12 17h0"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    camara: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    enviar: '<path d="M4 12l16-8-6 16-2.5-6.5z"/>',
    doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>',
    subir: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
    bajar: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 16v4h16v-4"/>',
    alerta: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5h0"/>',
    reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    salir: '<path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/>',
    candado: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    obra: '<path d="M3 21h18M5 21V9l7-5 7 5v12"/><path d="M9 21v-6h6v6"/>',
    campana: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    telefono: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    lupa: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    carpeta: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'
  };
  var ICONO_AREA = { RRHH: 'personas', CONTABILIDAD: 'calc', PREVENCION: 'casco' };
  // Cada área con su color, igual en el inicio y en la lista de pedidos: se reconoce sin leer.
  var TONO_AREA = { RRHH: 'info', CONTABILIDAD: 'ok', PREVENCION: 'warn' };
  function ico(n, px) { return '<svg viewBox="0 0 24 24"' + (px ? ' style="width:' + px + 'px;height:' + px + 'px;vertical-align:-3px"' : '') + ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + I[n] + '</svg>'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function inicial(n) { return String(n || '?').trim().split(/\s+/).slice(0, 2).map(function (x) { return x.charAt(0); }).join('').toUpperCase(); }
  function primerNombre(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }
  function fecha(v, conHora) {
    if (!v) return '';
    var s = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { var p = s.split('-'); return p[2] + '-' + p[1] + '-' + p[0]; }
    var d = new Date(s); if (isNaN(d)) return s;
    var f = ('0' + d.getDate()).slice(-2) + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
    return conHora ? f + ' · ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) : f + '-' + d.getFullYear();
  }
  function dispositivo() { var u = navigator.userAgent || ''; return /iPhone|iPad/.test(u) ? 'iPhone' : (/Android/.test(u) ? 'Android' : (/Windows/.test(u) ? 'Windows' : (/Mac/.test(u) ? 'Mac' : 'Navegador'))); }

  // ---------- Sesión y servidor ----------
  // Auditoría Codex 2026-10-08 (D-005, E1-2): la sesión vive primero en memoria de la
  // pestaña; cada almacenamiento se usa por separado, para que un navegador que bloquea
  // uno (o los dos) no deje al contratista entrando sin sesión.
  var TOKEN_MEM = '';
  function leerAlm(alm) { try { return window[alm].getItem(LLAVE) || ''; } catch (e) { return ''; } }
  function token() { if (!TOKEN_MEM) TOKEN_MEM = leerAlm('localStorage') || leerAlm('sessionStorage'); return TOKEN_MEM; }
  function guardarToken(t, recordar) {
    TOKEN_MEM = t || '';
    ['localStorage', 'sessionStorage'].forEach(function (alm) { try { window[alm].removeItem(LLAVE); } catch (e) { /* bloqueado */ } });
    if (t) { try { window[recordar ? 'localStorage' : 'sessionStorage'].setItem(LLAVE, t); } catch (e) { /* queda en memoria */ } }
  }
  // Con tiempo límite: con mala señal en la obra, una subida no puede quedar «Subiendo…»
  // para siempre. Los archivos tienen más margen que el resto.
  function api(accion, datos, ms) {
    var d = Object.assign({ cliente_token: token() }, datos || {});
    var ctl = window.AbortController ? new AbortController() : null, vencio = false;
    var reloj = ctl ? setTimeout(function () { vencio = true; ctl.abort(); }, ms || 30000) : null;
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: accion, data: d }), signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        clearTimeout(reloj);
        if (r && !r.ok && /sesi[oó]n termin[oó]/i.test(r.message || '')) { guardarToken(''); S.dentro = false; pintar(); }
        return r;
      })
      .catch(function () {
        clearTimeout(reloj);
        return { ok: false, message: vencio ? 'La señal está muy lenta y no alcanzó. Inténtalo de nuevo donde tengas mejor señal.' : 'Sin conexión. Revisa tu señal e inténtalo de nuevo.' };
      });
  }
  var MS_ARCHIVO = 150000;

  // ---------- Estado ----------
  var S = { err: {}, dentro: false, vista: 'inicio', perfil: null, cat: null, pedidos: [], trab: [], pedido: null, detalle: null, pedir: null, trabId: null, desde: null, invitacion: null, ocupado: false };

  function cargarTodo() {
    return Promise.all([api('clienteSesion'), api('clienteCatalogo'), api('clientePedidos'), api('clienteTrabajadores'), api('clienteDocumentos')]).then(function (r) {
      if (!r[0] || !r[0].ok) { S.dentro = false; return; }
      S.perfil = r[0].data;
      // D-005 (E1-6/E3-1): un recurso que falla NO se vuelve lista vacía: se marca con su
      // error (y se conservan los datos que ya había) para ofrecer «Intentar de nuevo».
      aplicar('cat', r[1]); aplicar('pedidos', r[2]); aplicar('trab', r[3]); aplicar('docs', r[4]);
      S.dentro = true;
      if (AV.sub) api('clientePushSuscribir', { suscripcion: AV.sub.toJSON(), dispositivo: dispositivo() });
    });
  }
  var RECURSOS = {
    cat: ['clienteCatalogo', function (d) { S.cat = d; }, 'los servicios que puedes pedir'],
    pedidos: ['clientePedidos', function (d) { S.pedidos = d.pedidos; }, 'tus pedidos'],
    trab: ['clienteTrabajadores', function (d) { S.trab = d.trabajadores; }, 'tus trabajadores'],
    docs: ['clienteDocumentos', function (d) { S.docs = d.documentos; }, 'tus documentos']
  };
  function aplicar(clave, r) {
    if (r && r.ok) { RECURSOS[clave][1](r.data); S.err[clave] = ''; return true; }
    S.err[clave] = (r && r.message) || 'Sin conexión.';
    if (clave === 'cat' && !S.cat) S.cat = { areas: [], documentos: [] };
    if (clave === 'pedidos' && !S.pedidos) S.pedidos = [];
    if (clave === 'trab' && !S.trab) S.trab = [];
    return false;
  }
  function recargar(clave) { return api(RECURSOS[clave][0]).then(function (r) { return aplicar(clave, r); }); }
  // Aviso de carga fallida, con reintento (solo ese recurso; no se pierde lo escrito).
  function fallo(clave) {
    if (!S.err[clave]) return '';
    return '<div class="error-caja falla-carga" role="alert"><span>No pudimos cargar ' + RECURSOS[clave][2] + '. ' + esc(S.err[clave]) + '</span>' +
      '<button type="button" class="btn btn-sec" data-reintentar="' + clave + '">' + ico('reloj') + 'Intentar de nuevo</button></div>';
  }
  function refrescarPedidos() { return recargar('pedidos'); }
  function refrescarTrab() { return recargar('trab'); }

  // ---------- Piezas ----------
  var ESTADOS = { TU: ['e-tu', 'Te toca a ti'], ENVIADO: ['e-rec', 'Enviado'], CURSO: ['e-cur', 'Lo estamos haciendo'], LISTO: ['e-ok', 'Listo'], CERRADO: ['e-gris', 'Cerrado'] };
  var EST_TRAB = { ACTIVO: ['e-ok', 'Trabajando'], TRAMITE: ['e-cur', 'Contrato en trámite'], FINIQUITADO: ['e-gris', 'Ya no trabaja'] };
  function chip(e) { var x = ESTADOS[e] || ESTADOS.ENVIADO; return '<span class="estado ' + x[0] + '"><span class="punto"></span>' + x[1] + '</span>'; }
  function nombreArea(clave) { var a = ((S.cat || {}).areas || []).filter(function (x) { return x.clave === clave; })[0]; return a ? a.nombre : (clave === 'RRHH' ? 'Recursos Humanos' : clave === 'CONTABILIDAD' ? 'Contabilidad' : clave === 'PREVENCION' ? 'Prevención' : 'Otra cosa'); }
  function notaPedido(p) {
    if (p.estado === 'TU') return p.preguntas ? 'Te hicieron una pregunta' : (p.por_confirmar ? (p.por_confirmar === 1 ? 'Está listo: confírmanos que está bien' : p.por_confirmar + ' listos: confírmanos que están bien') : 'Necesita tu respuesta');
    if (p.estado === 'ENVIADO') return 'Esperando que lo reciban';
    if (p.estado === 'CURSO') return p.para_el ? 'Estará para el ' + fecha(p.para_el) : 'Lo recibieron';
    if (p.estado === 'LISTO') return p.items > 1 ? 'Los ' + p.items + ' están listos' : 'Listo';
    return 'Cerrado';
  }
  function itemPedido(p) {
    return '<button type="button" class="item" data-estado="' + esc(p.estado) + '" data-pedido="' + esc(p.solicitud_id) + '"><span class="ico" data-tono="' + (TONO_AREA[p.area] || '') + '">' + ico(ICONO_AREA[p.area] || 'doc') + '</span><span class="grow"><b>' + esc(p.titulo) + '</b>' + chip(p.estado) +
      '<span class="sub">' + esc(notaPedido(p)) + '</span></span><span class="flecha">' + ico('flecha') + '</span></button>';
  }
  function nav() {
    var tuyos = S.pedidos.filter(function (p) { return p.estado === 'TU'; }).length;
    var actual = { pedido: 'pedidos', pedir: 'pedir', trab: 'trabajadores', documentos: S.docDesde === 'empresa' ? 'empresa' : 'inicio' }[S.vista] || S.vista;
    var b = function (id, txt, icono, extra) { return '<button type="button" data-ir="' + id + '"' + (actual === id ? ' aria-current="page"' : '') + '>' + ico(icono) + txt + (extra || '') + '</button>'; };
    return '<nav class="nav" aria-label="Menú">' + b('inicio', 'Inicio', 'casa') + b('pedir', 'Pedir', 'mas') + b('pedidos', 'Pedidos', 'chat', tuyos ? '<span class="badge">' + tuyos + '</span>' : '') + b('trabajadores', 'Trabajadores', 'personas') + b('empresa', 'Mi empresa', 'edificio') + '</nav>';
  }
  function top(titulo, sub, atras) {
    return '<header class="top"><div class="sello"><b>SIGSO</b>Portal de clientes de HomePymes</div><div class="top-fila">' + (atras ? '<button type="button" class="ico-btn" data-atras aria-label="Volver">' + ico('atras') + '</button>' : '') +
      '<div class="grow"><h1>' + esc(titulo) + '</h1>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>' +
      '<button type="button" class="ico-btn" data-ayuda aria-label="Ayuda">' + ico('ayuda') + '</button></div></header>';
  }
  function botonMandar() {
    if (!((S.cat || {}).documentos || []).length) return '';
    return '<button type="button" class="mandar" data-area="__doc"><span class="mandar__ico">' + ico('subir') + '</span><span><b>Mandar un documento</b><small>' + esc(S.cat.documentos.slice(0, 3).map(function (d) { return d.nombre.toLowerCase(); }).join(', ').replace(/^./, function (c) { return c.toUpperCase(); })) + '…</small></span></button>';
  }
  function botonDocumentos() {
    var n = (S.docs || []).filter(function (a) { return a.del_equipo; }).length;
    return '<button type="button" class="mandar mandar--claro" data-documentos><span class="mandar__ico">' + ico('carpeta') + '</span><span><b>Mis documentos' + (n ? ' (' + n + ')' : '') + '</b><small>Contratos, certificados y todo lo que te entregamos</small></span></button>';
  }
  function areasHtml() {
    var as = ((S.cat || {}).areas || []).map(function (a) {
      return '<button type="button" class="area" data-area="' + esc(a.clave) + '"><span class="area__ico" data-tono="' + (TONO_AREA[a.clave] || '') + '">' + ico(ICONO_AREA[a.clave] || 'doc') + '</span>' + esc(a.nombre) + '<small>' + esc(a.servicios.slice(0, 3).map(function (s) { return s.nombre.split(' ')[0]; }).join(', ')) + '</small></button>';
    });
    as.push('<button type="button" class="area" data-area="__otra"><span class="area__ico">' + ico('globo') + '</span>Otra cosa<small>Escríbenos con tus palabras</small></button>');
    return '<div class="areas">' + as.join('') + '</div>';
  }
  function errorHtml(m) { return m ? '<p class="error-caja" role="alert">' + esc(m) + '</p>' : ''; }
  // La clave se ve como 6 casillas (como en el banco); el input real va encima, invisible.
  function pinHtml(id, nombre, auto) {
    return '<div class="pin-caja"><input class="pin-real" id="' + id + '" name="' + nombre + '" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="' + auto + '">' +
      '<div class="pin-puntos" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div></div>';
  }
  function pintarPin(inp) {
    var caja = inp.closest('.pin-caja'); if (!caja) return;
    var n = inp.value.length, foco = document.activeElement === inp;
    [].forEach.call(caja.querySelectorAll('.pin-puntos i'), function (c, k) { c.classList.toggle('lleno', k < n); c.classList.toggle('actual', foco && k === Math.min(n, 5)); });
    caja.classList.toggle('completo', n === 6);
  }
  function formatoRut(v) {
    var c = String(v).replace(/[^0-9kK]/g, '').toUpperCase().slice(0, 9);
    if (c.length < 2) return c;
    return c.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + c.slice(-1);
  }
  function saludo() { var h = new Date().getHours(); return h < 12 ? 'Buenos días' : (h < 20 ? 'Buenas tardes' : 'Buenas noches'); }
  function vibrar(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* sin vibración */ } }
  function peso(b) { b = Number(b) || 0; return b >= 1048576 ? (Math.round(b / 104857.6) / 10).toString().replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }

  // ---------- Archivos: se ven DENTRO del portal ----------
  // 2026-10-08: antes «Abrir» bajaba el archivo y recién ahí abría una pestaña nueva.
  // El iPhone y el navegador de WhatsApp (por donde entra el contratista con la
  // invitación) bloquean esa pestaña en silencio: el archivo «no se veía». Ahora se
  // muestra en un visor propio (foto con zoom, PDF página por página) y desde ahí se
  // guarda o se comparte, siempre dentro del mismo toque de la persona.
  var ARCH = {}, ARCH_LISTO = {}, colaMini = Promise.resolve();
  var MAX_MINI = 1.5 * 1024 * 1024;
  function esImagen(t) { return /^image\//.test(t || ''); }
  function esPdf(t) { return t === 'application/pdf'; }
  function traerArchivo(id, miniatura) {
    if (ARCH[id]) return ARCH[id];
    ARCH[id] = api('clienteArchivo', { archivo_id: id, miniatura: !!miniatura }, MS_ARCHIVO).then(function (r) {
      if (!r || !r.ok) { delete ARCH[id]; throw new Error((r && r.message) || 'No se pudo abrir el archivo.'); }
      var bin = atob(r.data.contenido_base64), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var blob = new Blob([bytes], { type: r.data.tipo_mime || 'application/octet-stream' });
      ARCH_LISTO[id] = { url: URL.createObjectURL(blob), blob: blob, tipo: r.data.tipo_mime || '', nombre: r.data.nombre || 'archivo', miniatura: !!miniatura };
      return ARCH_LISTO[id];
    });
    return ARCH[id];
  }
  // Las fotos se pintan solas en miniatura, de a una (sin ahogar la señal); las muy
  // pesadas esperan a que la persona las toque.
  function hidratarVistas() {
    [].forEach.call(app.querySelectorAll('img[data-vista]:not([src])'), function (img) {
      var id = img.getAttribute('data-vista');
      if (ARCH_LISTO[id]) { img.src = ARCH_LISTO[id].url; return; }
      colaMini = colaMini.then(function () { return traerArchivo(id, true); }).then(function (x) {
        [].forEach.call(app.querySelectorAll('img[data-vista="' + id + '"]'), function (i2) { i2.src = x.url; });
      }, function () {
        [].forEach.call(app.querySelectorAll('img[data-vista="' + id + '"]'), function (i2) { var m = i2.closest('.mini'); if (m) m.classList.add('mini--sin'); });
      });
    });
  }
  function archivosDelPedido() {
    var d = S.detalle, out = [];
    if (d) d.subsolicitudes.forEach(function (it) { (it.archivos || []).forEach(function (a) { out.push(a); }); });
    return out;
  }
  // Una miniatura (foto) o una ficha (PDF, Word, Excel), tocable para abrir el visor.
  function archivoHtml(a, grande) {
    var quien = a.del_equipo ? 'Te lo mandó ' + esc(a.quien) : 'Lo mandaste tú';
    if (esImagen(a.tipo_mime) && Number(a.tamano_bytes || 0) <= MAX_MINI) {
      var u = ARCH_LISTO[a.archivo_id];
      return '<button type="button" class="mini' + (grande ? ' mini--grande' : '') + (a.del_equipo ? ' del-equipo' : '') + '" data-ver="' + esc(a.archivo_id) + '" aria-label="Ver la foto ' + esc(a.nombre) + '">' +
        '<img data-vista="' + esc(a.archivo_id) + '"' + (u ? ' src="' + esc(u.url) + '"' : '') + ' alt="">' + (grande ? '' : '<span class="mini__pie">' + quien + '</span>') + '</button>';
    }
    return '<button type="button" class="doc' + (a.del_equipo ? ' del-equipo' : '') + '" data-ver="' + esc(a.archivo_id) + '">' +
      '<span class="doc__tipo">' + (esPdf(a.tipo_mime) ? 'PDF' : (esImagen(a.tipo_mime) ? ico('camara') : (/sheet|excel/.test(a.tipo_mime) ? 'XLS' : 'DOC'))) + '</span>' +
      '<span class="grow">' + esc(a.nombre) + '<small>' + quien + ' · ' + esc(fecha(a.fecha, true)) + (a.tamano_bytes ? ' · ' + peso(a.tamano_bytes) : '') + '</small></span>' +
      '<span class="doc__ver">Ver</span></button>';
  }

  var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  var pdfJsCarga = null;
  function cargarPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfJsCarga) return pdfJsCarga;
    pdfJsCarga = new Promise(function (ok, mal) {
      var s = document.createElement('script'); s.src = PDFJS + 'pdf.min.js';
      s.onload = function () { if (!window.pdfjsLib) { pdfJsCarga = null; mal(new Error('sin visor')); return; } window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; ok(window.pdfjsLib); };
      s.onerror = function () { pdfJsCarga = null; s.remove(); mal(new Error('sin visor')); };
      document.head.appendChild(s);
    });
    return pdfJsCarga;
  }
  // Cada página del PDF como imagen, al ancho de la pantalla (hasta 40 páginas).
  function pintarPdf(cont, x) {
    return Promise.all([cargarPdfJs(), x.blob.arrayBuffer()]).then(function (r) {
      return r[0].getDocument({ data: new Uint8Array(r[1]), isEvalSupported: false }).promise;
    }).then(function (pdf) {
      cont.innerHTML = '<p class="visor__nota">' + pdf.numPages + (pdf.numPages === 1 ? ' página' : ' páginas') + (pdf.numPages > 40 ? ' (se muestran las primeras 40; guárdalo para ver el resto)' : '') + '</p>';
      var ancho = Math.min(cont.clientWidth || 360, 900), dpr = Math.min(window.devicePixelRatio || 1, 2), cadena = Promise.resolve();
      for (var n = 1; n <= Math.min(pdf.numPages, 40); n++) (function (n) {
        cadena = cadena.then(function () {
          if (!cont.isConnected) return;
          return pdf.getPage(n).then(function (pg) {
            var vp0 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: (ancho / vp0.width) * dpr });
            var c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height); c.className = 'visor__pagina';
            c.setAttribute('aria-label', 'Página ' + n);
            cont.appendChild(c);
            return pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
          });
        });
      })(n);
      return cadena;
    });
  }
  function visorSinVista(cont, x, motivo) {
    cont.innerHTML = '<div class="visor__otro"><span class="visor__icono">' + ico('doc', 56) + '</span><b>' + esc(x.nombre) + '</b><p>' + esc(motivo) + '</p></div>';
  }
  function abrirVisor(id) {
    var a = archivosDelPedido().concat(S.docs || []).filter(function (z) { return z.archivo_id === id; })[0] || { archivo_id: id, nombre: 'Archivo', tipo_mime: '' };
    var puedeCompartir = !!(navigator.share && navigator.canShare), yaAbierto = !!capa.querySelector('.visor');
    capa.innerHTML = '<div class="visor" role="dialog" aria-modal="true" aria-labelledby="vs-t" data-visor="' + esc(id) + '">' +
      '<header class="visor__cab"><button type="button" class="visor__btn" data-cerrar-capa aria-label="Cerrar">' + ico('atras') + '</button>' +
        '<div class="grow"><b id="vs-t">' + esc(a.nombre) + '</b><small>' + (a.del_equipo ? 'Te lo mandó ' + esc(a.quien) : 'Lo mandaste tú') + (a.fecha ? ' · ' + esc(fecha(a.fecha, true)) : '') + '</small></div></header>' +
      '<div class="visor__cuerpo' + (esImagen(a.tipo_mime) ? ' visor__cuerpo--foto' : '') + '"><div class="cargando"><span class="rueda"></span>Abriendo…</div></div>' +
      '<footer class="visor__pie"><button type="button" class="btn btn-main" data-guardar disabled>' + ico('bajar') + 'Guardar</button>' +
        (puedeCompartir ? '<button type="button" class="btn btn-sec" data-compartir disabled>' + ico('enviar') + 'Compartir</button>' : '') + '</footer></div>';
    if (!yaAbierto) empujarHistoria();
    var cuerpo = capa.querySelector('.visor__cuerpo');
    var previo = ARCH_LISTO[id];
    traerArchivo(id, false).then(function (x) {
      if (!cuerpo.isConnected) return;
      // Lo que ya estaba en miniatura también queda registrado como «abierto».
      if (previo && previo.miniatura) { previo.miniatura = false; api('clienteArchivo', { archivo_id: id, solo_registro: true }); }
      [].forEach.call(capa.querySelectorAll('[data-guardar],[data-compartir]'), function (b) { b.disabled = false; });
      if (esImagen(x.tipo)) { cuerpo.innerHTML = '<img class="visor__foto" src="' + esc(x.url) + '" alt="' + esc(x.nombre) + '">'; return; }
      if (esPdf(x.tipo)) {
        cuerpo.innerHTML = '<div class="cargando"><span class="rueda"></span>Preparando las páginas…</div>';
        pintarPdf(cuerpo, x).catch(function () { if (cuerpo.isConnected) visorSinVista(cuerpo, x, 'No se pudo mostrar aquí. Toca «Guardar» y se abre con el lector de PDF del teléfono.'); });
        return;
      }
      visorSinVista(cuerpo, x, 'Este archivo (Word o Excel) se abre con su aplicación: toca «Guardar».');
    }, function (e) {
      if (cuerpo.isConnected) cuerpo.innerHTML = '<div class="visor__otro"><span class="visor__icono">' + ico('alerta', 56) + '</span><b>No se pudo abrir</b><p>' + esc(e.message) + '</p><button type="button" class="btn btn-sec btn-chico" data-ver="' + esc(id) + '" style="width:auto">Intentar de nuevo</button></div>';
    });
  }
  // Guardar: un enlace de descarga tocado en el mismo gesto (sin pestañas nuevas).
  function guardarArchivo(id) {
    var x = ARCH_LISTO[id]; if (!x) return;
    var a = document.createElement('a'); a.href = x.url; a.download = x.nombre; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    toast('Listo. Si no lo ves, búscalo en «Descargas» o «Archivos» de tu teléfono.');
  }
  function compartirArchivo(id) {
    var x = ARCH_LISTO[id]; if (!x) return;
    var f; try { f = new File([x.blob], x.nombre, { type: x.tipo }); } catch (e) { f = null; }
    if (!f || !navigator.canShare || !navigator.canShare({ files: [f] })) { guardarArchivo(id); return; }
    navigator.share({ files: [f], title: x.nombre }).catch(function () { /* la persona canceló */ });
  }

  // ---------- App instalada y avisos al teléfono (2026-10-08) ----------
  // El contratista se enteraba de una respuesta solo si entraba al portal. Ahora el
  // teléfono le avisa (Web Push, portalPush.js) y el aviso abre el pedido. En iPhone
  // los avisos web exigen tener el portal instalado en la pantalla de inicio; en el
  // navegador interno de WhatsApp no existen: se le explica cómo salir de ahí.
  var AV = { soporta: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window, reg: null, sub: null, instalar: null, ocupado: false };
  var LLAVE_AV_NO = 'sigso_cliente_avisos_no';
  function esIOS() { return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function instalada() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
  function enWebView() { var u = navigator.userAgent || ''; return /; wv\)|FBAN|FBAV|Instagram|WhatsApp/.test(u) || (esIOS() && !/Safari\//.test(u) && !instalada()); }
  function estadoAvisos() {
    if (AV.sub && typeof Notification !== 'undefined' && Notification.permission === 'granted') return 'activo';
    if (enWebView()) return 'webview';
    if (esIOS() && !instalada()) return 'instalar-ios';
    if (!AV.soporta) return 'no-soporta';
    if (Notification.permission === 'denied') return 'bloqueado';
    return 'apagado';
  }
  function avisosPospuestos() { try { return Number(localStorage.getItem(LLAVE_AV_NO) || 0) > Date.now(); } catch (e) { return false; } }
  function posponerAvisos() { try { localStorage.setItem(LLAVE_AV_NO, String(Date.now() + 7 * 864e5)); } catch (e) { /* sin almacenamiento */ } }
  function bytesDeB64u(s) { var b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function prepararAvisos() {
    if (!AV.soporta) return Promise.resolve();
    navigator.serviceWorker.addEventListener('message', function (ev) { var d = ev.data || {}; if (d.tipo === 'abrir-pedido' && d.pedido && S.dentro) abrirPedido(d.pedido); });
    return navigator.serviceWorker.register('portal-sw.js', { scope: './portal.html' }).then(function (reg) {
      AV.reg = reg; return reg.pushManager.getSubscription();
    }).then(function (sub) {
      AV.sub = sub;
      // Se vuelve a informar al servidor: si el navegador renovó la suscripción, queda al día.
      if (sub && S.dentro) api('clientePushSuscribir', { suscripcion: sub.toJSON(), dispositivo: dispositivo() });
    }).catch(function () { AV.soporta = false; });
  }
  window.addEventListener('beforeinstallprompt', function (ev) { ev.preventDefault(); AV.instalar = ev; if (S.dentro && (S.vista === 'inicio' || S.vista === 'empresa')) pintar(); });
  window.addEventListener('appinstalled', function () { AV.instalar = null; toast('¡Listo! El portal quedó en tu pantalla de inicio.'); });
  function instalarApp() {
    if (!AV.instalar) return;
    AV.instalar.prompt();
    AV.instalar.userChoice.then(function () { AV.instalar = null; pintar(); }).catch(function () { /* nada */ });
  }
  function activarAvisos() {
    if (AV.ocupado || !AV.soporta) return;
    AV.ocupado = true; pintar();
    // El permiso se pide en el mismo toque (Safari lo exige).
    Notification.requestPermission().then(function (p) {
      if (p !== 'granted') throw new Error(p === 'denied' ? 'bloqueado' : 'cancelado');
      return (AV.reg ? Promise.resolve(AV.reg) : navigator.serviceWorker.register('portal-sw.js', { scope: './portal.html' }));
    }).then(function (reg) {
      AV.reg = reg;
      return api('clientePushClave').then(function (r) {
        if (!r || !r.ok) throw new Error((r && r.message) || 'sin clave');
        return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytesDeB64u(r.data.publica) });
      });
    }).then(function (sub) {
      AV.sub = sub;
      return api('clientePushSuscribir', { suscripcion: sub.toJSON(), dispositivo: dispositivo() });
    }).then(function (r) {
      AV.ocupado = false;
      if (!r || !r.ok) { toast((r && r.message) || 'No se pudo activar los avisos.'); pintar(); return; }
      vibrar([20, 40, 20]); toast('¡Listo! Te mandamos un aviso de prueba.');
      api('clientePushProbar', { endpoint: AV.sub.endpoint }); pintar();
    }).catch(function (e) {
      AV.ocupado = false;
      toast(e && e.message === 'bloqueado' ? 'No se pudo: los avisos están bloqueados para esta página. Mira en «Mi empresa» cómo activarlos.' : 'No se activaron los avisos. Puedes intentarlo cuando quieras.');
      pintar();
    });
  }
  function apagarAvisos() {
    var sub = AV.sub; if (!sub) return Promise.resolve();
    AV.sub = null;
    return api('clientePushQuitar', { endpoint: sub.endpoint }).then(function () { return sub.unsubscribe().catch(function () { /* ya no estaba */ }); });
  }
  // Tarjeta en Inicio: solo si sirve (no activos, no pospuestos) y con el paso que toca.
  function tarjetaAvisos() {
    var e = estadoAvisos(), inst = AV.instalar && !instalada();
    if (e === 'activo' && !inst) return '';
    if (avisosPospuestos() || e === 'no-soporta' || e === 'bloqueado') return inst ? tarjetaInstalar() : '';
    var cuerpo, botones;
    if (e === 'webview') {
      cuerpo = 'Estás dentro de WhatsApp. Para que te lleguen avisos al teléfono, abre el portal en ' + (esIOS() ? 'Safari' : 'Chrome') + ': toca los tres puntos ' + (esIOS() ? 'o el ícono de la brújula' : '⋮') + ' y elige «Abrir en el navegador».';
      botones = '<button type="button" class="btn btn-sec btn-chico" data-copiar-enlace>Copiar el enlace</button>';
    } else if (e === 'instalar-ios') {
      cuerpo = 'En iPhone, los avisos llegan con el portal en tu pantalla de inicio: toca <b>Compartir</b> ' + ico('subir', 18) + ' abajo y luego <b>«Agregar a inicio»</b>. Después ábrelo desde el ícono nuevo.';
      botones = '';
    } else {
      cuerpo = 'Te avisamos en el teléfono cuando te respondan, te pregunten algo o te manden un documento. Sin abrir el portal.';
      botones = '<button type="button" class="btn btn-main btn-chico" data-activar-avisos' + (AV.ocupado ? ' disabled' : '') + '>' + ico('campana') + (AV.ocupado ? 'Activando…' : 'Activar avisos') + '</button>';
    }
    return '<section class="card avisos"><div class="avisos__cab"><span class="avisos__ico">' + ico('campana') + '</span><h3>Recibe avisos en tu teléfono</h3></div><p>' + cuerpo + '</p>' +
      '<div class="fila" style="flex-wrap:wrap;gap:8px">' + botones + '<button type="button" class="quitar" data-avisos-no>Ahora no</button></div></section>' + (inst ? tarjetaInstalar() : '');
  }
  function tarjetaInstalar() {
    return '<button type="button" class="mandar mandar--claro" data-instalar><span class="mandar__ico">' + ico('telefono') + '</span><span><b>Instalar la app</b><small>Queda un ícono en tu teléfono, como WhatsApp</small></span></button>';
  }
  function seccionAvisos() {
    var e = estadoAvisos(), txt = {
      activo: 'Los avisos están <b>activados</b> en este teléfono.',
      apagado: 'Los avisos están apagados en este teléfono.',
      bloqueado: 'Los avisos están <b>bloqueados</b> para esta página. Para activarlos: toca el candado ' + ico('candado', 16) + ' junto a la dirección (o Ajustes del teléfono › Notificaciones) y permite las notificaciones. Después vuelve aquí.',
      'instalar-ios': 'En iPhone, primero agrega el portal a tu pantalla de inicio (Compartir › «Agregar a inicio») y ábrelo desde el ícono.',
      webview: 'Estás dentro de WhatsApp: abre el portal en el navegador para activar los avisos.',
      'no-soporta': 'Este navegador no permite avisos. Prueba abriendo el portal en Chrome (Android) o Safari (iPhone).'
    }[e];
    return '<section class="card"><h3>' + ico('campana', 22) + ' Avisos y app</h3><p class="sub">' + txt + '</p><div class="fila" style="flex-wrap:wrap;gap:8px">' +
      (e === 'apagado' ? '<button type="button" class="btn btn-main btn-chico" data-activar-avisos' + (AV.ocupado ? ' disabled' : '') + '>Activar avisos</button>' : '') +
      (e === 'activo' ? '<button type="button" class="btn btn-sec btn-chico" data-probar-aviso style="width:auto">Mandar un aviso de prueba</button><button type="button" class="quitar" data-apagar-avisos>Apagar avisos</button>' : '') +
      (e === 'webview' ? '<button type="button" class="btn btn-sec btn-chico" data-copiar-enlace style="width:auto">Copiar el enlace</button>' : '') +
      '</div>' + (AV.instalar && !instalada() ? tarjetaInstalar() : '') + '</section>';
  }

  // ---------- Mis documentos (2026-10-08) ----------
  // Todo lo que el equipo le entregó (contratos, F30, liquidaciones…) y lo que él
  // mandó, de todos sus pedidos, por mes, con buscador. Antes había que entrar
  // pedido por pedido.
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  // Revisión Codex Tanda 1 (hallazgo 4): misma carga con estado de error que el resto.
  function cargarDocs() { return recargar('docs'); }
  function sinTildes(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function docsFiltrados() {
    var F = S.docFiltro || {}, q = sinTildes(F.q).trim();
    return (S.docs || []).filter(function (a) {
      if (!!a.del_equipo !== (F.lado !== 'tu')) return false;
      if (F.trab && a.trabajador_id !== F.trab) return false;
      return !q || sinTildes([a.nombre, a.pedido, a.trabajador, a.quien, nombreArea(a.area)].join(' ')).indexOf(q) !== -1;
    });
  }
  function docFila(a) {
    var foto = esImagen(a.tipo_mime) && Number(a.tamano_bytes || 0) <= MAX_MINI, u = ARCH_LISTO[a.archivo_id];
    return '<button type="button" class="doc doc--fila' + (a.del_equipo ? ' del-equipo' : '') + '" data-ver="' + esc(a.archivo_id) + '">' +
      '<span class="doc__tipo">' + (foto ? '<img data-vista="' + esc(a.archivo_id) + '"' + (u ? ' src="' + esc(u.url) + '"' : '') + ' alt="">' : (esPdf(a.tipo_mime) ? 'PDF' : (esImagen(a.tipo_mime) ? ico('camara') : (/sheet|excel/.test(a.tipo_mime) ? 'XLS' : 'DOC')))) + '</span>' +
      '<span class="grow">' + esc(a.nombre) + '<small>' + esc([a.trabajador, a.pedido && a.pedido.split(' · ')[0]].filter(Boolean).join(' · ') || nombreArea(a.area)) + '</small>' +
      '<small>' + (a.del_equipo ? 'De ' + esc(a.quien) : 'Lo mandaste tú') + ' · ' + esc(fecha(a.fecha, true)) + '</small></span><span class="flecha">' + ico('flecha') + '</span></button>';
  }
  function listaDocsHtml() {
    var ds = docsFiltrados(), F = S.docFiltro || {};
    if (!ds.length) return '<div class="vacio"><span class="vacio__ico">' + ico('doc') + '</span><b>' + (F.q ? 'No encontramos nada con «' + esc(F.q) + '»' : (F.lado === 'tu' ? 'Todavía no has mandado documentos' : 'Todavía no te hemos entregado documentos')) + '</b>' +
      (F.lado !== 'tu' && !F.q ? '<span>Aquí quedan guardados los contratos, certificados y liquidaciones que te mandemos.</span>' : '') + '</div>';
    var grupos = [], porMes = {};
    ds.forEach(function (a) { var k = String(a.fecha).slice(0, 7); if (!porMes[k]) { porMes[k] = []; grupos.push(k); } porMes[k].push(a); });
    return grupos.map(function (k) {
      var p = k.split('-'), titulo = (MESES[+p[1] - 1] || '') + ' ' + p[0];
      return '<section class="docs-mes"><h2>' + esc(titulo.charAt(0).toUpperCase() + titulo.slice(1)) + ' <small>(' + porMes[k].length + ')</small></h2><div class="lista">' + porMes[k].map(docFila).join('') + '</div></section>';
    }).join('');
  }
  function documentosVista() {
    var F = S.docFiltro = S.docFiltro || { lado: 'equipo', q: '' };
    if (!S.docs && S.err.docs) return top('Mis documentos', 'Lo que te entregamos y lo que mandaste', true) + '<main>' + fallo('docs') + '</main>' + nav();
    if (!S.docs) return top('Mis documentos', 'Lo que te entregamos y lo que mandaste', true) + '<main aria-busy="true"><section class="card"><div class="esq esq-linea"></div><div class="esq esq-linea esq-corta"></div></section><section class="card"><div class="esq esq-linea"></div><div class="esq esq-linea esq-corta"></div></section></main>' + nav();
    var nEq = S.docs.filter(function (a) { return a.del_equipo; }).length, nTu = S.docs.length - nEq;
    var t = F.trab ? S.trab.filter(function (x) { return x.trabajador_id === F.trab; })[0] : null;
    // Con datos anteriores y una recarga fallida: se muestran, pero con el aviso y el reintento.
    return top('Mis documentos', S.perfil.cliente.razon_social, true) + '<main>' + fallo('docs') +
      '<div class="segmento" role="tablist"><button type="button" role="tab" data-doc-lado="equipo" aria-selected="' + (F.lado !== 'tu') + '">Te entregamos (' + nEq + ')</button><button type="button" role="tab" data-doc-lado="tu" aria-selected="' + (F.lado === 'tu') + '">Mandaste (' + nTu + ')</button></div>' +
      '<label class="buscar" for="doc-q">' + ico('lupa') + '<input class="inp" id="doc-q" type="search" placeholder="Buscar: Juan, contrato, F30…" value="' + esc(F.q || '') + '" autocomplete="off" aria-label="Buscar un documento"></label>' +
      (t ? '<div class="chips"><button type="button" class="chip chip--quitar" data-doc-trab="">De ' + esc(t.nombre) + ' <span aria-hidden="true">×</span><span class="oculto-visual">Quitar filtro</span></button></div>' : '') +
      '<div id="doc-lista" style="display:flex;flex-direction:column;gap:16px">' + listaDocsHtml() + '</div></main>' + nav();
  }
  function irDocumentos(trabId) {
    S.docDesde = S.vista === 'documentos' ? S.docDesde : S.vista;
    S.docFiltro = { lado: 'equipo', q: '', trab: trabId || '' };
    ir('documentos', 'adelante');
    cargarDocs().then(function () { if (S.vista === 'documentos') pintar(); });
  }

  // ---------- Entrada ----------
  function pantallaEntrar(error) {
    return '<div class="login">' +
      '<div class="logo"><span class="marca-s">S</span><div><h2>SIGSO</h2><p class="sub">Pide tus trámites y sigue cómo van</p></div></div>' +
      '<div class="inquilino">' + ico('edificio', 22) + '<span>Portal de clientes de <b>HomePymes</b></span></div>' +
      '<form id="f-entrar" class="card" novalidate>' + errorHtml(error) +
        '<label class="campo" for="l-rut">Tu RUT<em>El mismo de tu carnet</em><input class="inp" id="l-rut" name="rut" inputmode="text" autocomplete="username" placeholder="12.345.678-9"></label>' +
        '<div class="campo-g"><label for="l-pin">Tu clave de 6 números</label><em>La elegiste la primera vez que entraste</em>' + pinHtml('l-pin', 'pin', 'current-password') + '</div>' +
        '<label class="fila ojo" for="l-rec"><input type="checkbox" id="l-rec" name="recordar" checked style="width:24px;height:24px"> Recordar este teléfono por 90 días</label>' +
        '<button class="btn btn-main" type="submit"' + (S.ocupado ? ' disabled' : '') + '>' + (S.ocupado ? 'Entrando…' : 'Entrar') + '</button>' +
      '</form>' +
      '<p class="sub" style="text-align:center">¿Olvidaste tu clave? Pídele un enlace nuevo a tu encargado.<br>Cada ingreso queda registrado para tu seguridad.</p>' +
      '<p class="pie-marca"><b>SIGSO</b> · Portal de clientes de HomePymes</p></div>';
  }
  function pantallaActivar(info, error) {
    if (!info) return '<div class="login"><div class="logo"><span class="marca-s">S</span><div><h2>SIGSO</h2><p class="sub">Portal de clientes de HomePymes</p></div></div>' +
      errorHtml(error || 'Este enlace ya no sirve. Pídele uno nuevo a tu encargado.') + '<button type="button" class="btn btn-sec" data-ir-entrar>Ya tengo mi clave: entrar</button></div>';
    return '<div class="login">' +
      '<div class="logo"><span class="marca-s">S</span><div><h2>Hola, ' + esc(primerNombre(info.nombre)) + '</h2><p class="sub">Bienvenido al portal de clientes de HomePymes</p></div></div>' +
      '<div class="inquilino">' + ico('edificio', 22) + '<span>Entrarás por <b>' + esc(info.empresa) + '</b><br><span class="sub">con tu RUT ' + esc(info.rut) + '</span></span></div>' +
      '<form id="f-activar" class="card" novalidate>' + errorHtml(error) +
        '<p><b>Elige tu clave de 6 números.</b> La usarás cada vez que entres, junto con tu RUT.</p>' +
        '<div class="campo-g"><label for="a-pin">Tu clave nueva</label><em>Que no sea 123456 ni el mismo número repetido</em>' + pinHtml('a-pin', 'pin', 'new-password') + '</div>' +
        '<div class="campo-g"><label for="a-pin2">Escríbela otra vez</label>' + pinHtml('a-pin2', 'pin2', 'new-password') + '</div>' +
        '<label class="fila ojo" for="a-rec"><input type="checkbox" id="a-rec" name="recordar" checked style="width:24px;height:24px"> Recordar este teléfono por 90 días</label>' +
        '<button class="btn btn-main" type="submit"' + (S.ocupado ? ' disabled' : '') + '>' + (S.ocupado ? 'Guardando…' : 'Guardar mi clave y entrar') + '</button>' +
      '</form>' +
      '<div class="nota-seg">' + ico('candado') + '<span>Tu clave es solo tuya. Nadie de HomePymes te la va a pedir.</span></div></div>';
  }

  // ---------- Inicio ----------
  function inicio() {
    var tuyos = S.pedidos.filter(function (p) { return p.estado === 'TU'; });
    var curso = S.pedidos.filter(function (p) { return p.estado === 'CURSO' || p.estado === 'ENVIADO'; }).length;
    var mes = new Date().toISOString().slice(0, 7);
    var delMes = S.pedidos.filter(function (p) { return String(p.fecha_creacion).slice(0, 7) === mes; });
    var listosMes = delMes.filter(function (p) { return p.estado === 'LISTO'; }).length;
    var activos = S.trab.filter(function (t) { return t.estado !== 'FINIQUITADO'; }).length;
    var nombreMes = new Date().toLocaleDateString('es-CL', { month: 'long' });
    var baldosa = function (n, txt, ir, tono) { return '<button type="button" class="stat" data-ir="' + ir + '"' + (tono ? ' data-tono="' + tono + '"' : '') + '><b>' + n + '</b><span>' + txt + '</span></button>'; };
    return top(saludo() + ', ' + primerNombre(S.perfil.contacto.nombre), S.perfil.cliente.razon_social) + '<main>' + fallo('pedidos') + fallo('trab') +
      (tuyos.length ? '<section class="card toca"><div class="toca-cab"><span class="latido"></span>Te toca a ti (' + tuyos.length + ')</div><div class="lista">' + tuyos.map(itemPedido).join('') + '</div></section>' : '') +
      tarjetaAvisos() +
      '<section style="display:flex;flex-direction:column;gap:12px"><h2>¿Qué necesitas?</h2>' + areasHtml() + botonMandar() + botonDocumentos() + '</section>' +
      '<section class="card"><div class="mes-cab"><h3>Este mes</h3><small>' + esc(nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1)) + '</small></div><div class="stats">' +
        baldosa(delMes.length, delMes.length === 1 ? 'pedido hecho' : 'pedidos hechos', 'pedidos', 'gris') +
        baldosa(listosMes, listosMes === 1 ? 'listo' : 'listos', 'pedidos', 'ok') +
        baldosa(curso, 'en curso', 'pedidos', 'info') +
        (tuyos.length ? baldosa(tuyos.length, tuyos.length === 1 ? 'espera tu respuesta' : 'esperan tu respuesta', 'pedidos', '') : baldosa(activos, activos === 1 ? 'trabajador en tus obras' : 'trabajadores en tus obras', 'trabajadores', 'gris')) +
        '</div><button type="button" class="btn btn-sec btn-chico" data-ir="pedidos">Ver todos mis pedidos</button></section>' +
    '</main>' + nav();
  }

  // ---------- Pedir ----------
  function plantillasDe(area) {
    if (area === '__doc') return (S.cat.documentos || []);
    var a = (S.cat.areas || []).filter(function (x) { return x.clave === area; })[0];
    return a ? a.servicios : [];
  }
  function plantillaActual() {
    var P = S.pedir;
    if (P.plantilla === 'otra') return { id: 'otra', nombre: P.area === '__otra' ? 'Otra cosa' : 'Otra cosa de ' + nombreArea(P.area), tipo: 'libre', campos: [], depto: P.area === '__otra' ? '' : P.area, plazo_dias: 2, foto: 'Puedes mandar fotos o documentos' };
    return plantillasDe(P.area).filter(function (s) { return s.id === P.plantilla; })[0];
  }
  function pedirAreas() {
    return top('Pedir', 'Elige a qué área', false) + '<main>' + fallo('cat') + '<p class="sub">Toca el área. Si no sabes cuál es, elige «Otra cosa» y cuéntanos con tus palabras.</p>' + areasHtml() + botonMandar() + '</main>' + nav();
  }
  function pedirServicios() {
    var P = S.pedir, esDoc = P.area === '__doc';
    var ps = plantillasDe(P.area);
    var a = esDoc ? null : (S.cat.areas || []).filter(function (x) { return x.clave === P.area; })[0];
    return top(esDoc ? 'Mandar un documento' : nombreArea(P.area), esDoc ? '¿Qué nos mandas?' : '¿Qué necesitas?', true) + '<main>' +
      (esDoc ? '<p class="sub">Lo que antes mandabas por WhatsApp o correo. Queda guardado y te avisamos que lo recibimos.</p>' : (a && a.encargado ? '<p class="sub">Lo que pidas aquí le llega a <b>' + esc(a.encargado) + '</b>.</p>' : '')) +
      '<div class="lista">' + ps.map(function (s) {
        return '<button type="button" class="item" data-plantilla="' + esc(s.id) + '"><span class="ico">' + ico(esDoc ? 'subir' : (s.tipo === 'nuevos' || s.tipo === 'elegir' ? 'personas' : 'doc')) + '</span><span class="grow"><b>' + esc(s.nombre) + '</b><span class="sub">' + esc(s.ayuda) + '</span>' +
          (esDoc ? '' : '<span class="sub">' + ico('reloj', 16) + ' Listo en ' + s.plazo_dias + (s.plazo_dias === 1 ? ' día hábil' : ' días hábiles') + '</span>') + '</span><span class="flecha">' + ico('flecha') + '</span></button>';
      }).join('') +
      (esDoc ? '' : '<button type="button" class="item" data-plantilla="otra"><span class="ico">' + ico('globo') + '</span><span class="grow"><b>Otra cosa de ' + esc(nombreArea(P.area)) + '</b><span class="sub">Cuéntanos con tus palabras</span></span><span class="flecha">' + ico('flecha') + '</span></button>') +
    '</div></main>' + nav();
  }
  function pasosTotal(s) { return s.foto ? 3 : 2; }
  function cabPasos(n, total, t) {
    var b = ''; for (var i = 1; i <= total; i++) b += '<span' + (i <= n ? ' class="on' + (i === n && n > 1 ? ' nuevo' : '') + '"' : '') + '></span>';
    return '<div style="display:flex;flex-direction:column;gap:8px"><span class="paso-txt">Paso ' + n + ' de ' + total + ': ' + t + '</span><div class="pasos">' + b + '</div></div>';
  }
  function obras() { return (S.perfil && S.perfil.obras) || []; }
  function selObra(P) {
    if (!obras().length) return '';
    return '<div class="campo-g">¿En qué obra?<div class="chips-sel">' + obras().map(function (o) { return '<button type="button" class="chip-sel" data-obra="' + esc(o.obra_id) + '" aria-pressed="' + (P.obra_id === o.obra_id) + '">' + esc(o.nombre) + '</button>'; }).join('') + '</div></div>';
  }
  function pedirDatos() {
    var P = S.pedir, s = plantillaActual(), total = pasosTotal(s), cuerpo = '';
    if (s.tipo === 'nuevos') {
      cuerpo = '<p class="sub">Una ficha por persona. Quedan guardados en «Trabajadores» para la próxima vez.</p>' + selObra(P) +
        P.personas.map(function (per, k) {
          return '<div class="persona"><div class="persona-cab"><span class="num">' + (k + 1) + '</span>Persona ' + (k + 1) + (P.personas.length > 1 ? '<button type="button" class="quitar" data-quitar="' + k + '">Quitar</button>' : '') + '</div>' +
            s.campos.map(function (c) { return '<label class="campo" for="c-' + k + '-' + c.clave + '">' + esc(c.etiqueta) + '<input class="inp" id="c-' + k + '-' + c.clave + '" data-per="' + k + '" data-campo="' + c.clave + '" placeholder="' + esc(c.ejemplo) + '" value="' + esc(per[c.clave] || '') + '"' + (c.clave === 'sueldo' ? ' inputmode="numeric"' : '') + '></label>'; }).join('') + '</div>';
        }).join('') +
        '<button type="button" class="btn btn-sec" data-agregar>' + ico('mas') + 'Agregar otra persona</button>';
    } else if (s.tipo === 'elegir') {
      var activos = S.trab.filter(function (t) { return t.estado !== 'FINIQUITADO'; });
      var nombreObra = {}; obras().forEach(function (o) { nombreObra[o.obra_id] = o.nombre; });
      cuerpo = activos.length ? '<div class="campo-g">' + (s.uno ? '¿De quién?' : '¿Para quién? Puedes elegir varios') + '<em>Toca para marcar.</em><div class="opciones">' +
          activos.map(function (t) { return '<button type="button" class="opcion" data-elegir="' + esc(t.trabajador_id) + '" aria-pressed="' + (P.elegidos.indexOf(t.trabajador_id) !== -1) + '"><span class="marca">' + ico('check') + '</span><span>' + esc(t.nombre) + '<small>' + esc([t.cargo, nombreObra[t.obra_id]].filter(Boolean).join(' · ')) + '</small></span></button>'; }).join('') +
        '</div></div>'
        : '<div class="error-caja">Todavía no tienes trabajadores guardados. Agrégalos en «Trabajadores» o pide un contrato.</div><button type="button" class="btn btn-sec" data-ir="trabajadores">Ir a Trabajadores</button>';
      cuerpo += (s.obra ? selObra(P) : '') + s.campos.map(function (c) { return '<label class="campo" for="c-' + c.clave + '">' + esc(c.etiqueta) + '<em>' + esc(c.ejemplo) + '</em><input class="inp" id="c-' + c.clave + '" data-campo="' + c.clave + '" value="' + esc(P.datos[c.clave] || '') + '"></label>'; }).join('') +
        (s.motivo ? '<div class="campo-g">¿Por qué termina?<div class="chips-sel">' + s.motivo.map(function (m) { return '<button type="button" class="chip-sel" data-motivo="' + esc(m) + '" aria-pressed="' + (P.motivo === m) + '">' + esc(m) + '</button>'; }).join('') + '</div></div>' : '');
    } else if (s.tipo === 'campos') {
      cuerpo = (s.repetir ? '<button type="button" class="btn btn-sec" data-repetir>' + ico('reloj') + 'Igual que el mes pasado</button>' : '') + (s.obra ? selObra(P) : '') +
        s.campos.map(function (c) { return '<label class="campo" for="c-' + c.clave + '">' + esc(c.etiqueta) + '<em>' + esc(c.ejemplo) + '</em><input class="inp" id="c-' + c.clave + '" data-campo="' + c.clave + '" value="' + esc(P.datos[c.clave] || '') + '"></label>'; }).join('');
    } else {
      cuerpo = (P.area === '__otra' ? '<div class="campo-g">¿A qué área va?<div class="chips-sel">' + (S.cat.areas || []).map(function (a) { return '<button type="button" class="chip-sel" data-depto="' + esc(a.clave) + '" aria-pressed="' + (P.depto === a.clave) + '">' + esc(a.nombre) + '</button>'; }).join('') + '</div></div>' : '') +
        '<label class="campo" for="c-texto">' + (P.area === '__doc' ? 'Cuéntanos qué es (opcional)' : 'Cuéntanos qué necesitas') + '<em>Como se lo dirías por WhatsApp</em><textarea class="inp" id="c-texto" data-campo="texto">' + esc(P.datos.texto || '') + '</textarea></label>';
    }
    var sub = P.area === '__doc' ? 'Mandar un documento' : 'Listo en ' + s.plazo_dias + (s.plazo_dias === 1 ? ' día hábil' : ' días hábiles');
    return top(s.nombre, sub, true) + '<main>' + cabPasos(1, total, 'los datos') + cuerpo + errorHtml(P.error) +
      '<button type="button" class="btn btn-main" data-siguiente>Siguiente</button></main>' + nav();
  }
  function pedirFoto() {
    var P = S.pedir, s = plantillaActual();
    return top(s.nombre, 'Respaldo', true) + '<main>' + cabPasos(2, 3, s.foto_obligatoria ? 'la foto' : 'el respaldo') +
      '<p>' + esc(s.foto) + (s.foto_obligatoria ? '.' : ' (si no tienes, puedes seguir).') + '</p>' +
      '<div class="tomar"><label class="foto foto--cam" for="f-foto-cam">' + ico('camara') + '<span>Sacar foto<br><span class="sub">Abre la cámara</span></span><input type="file" id="f-foto-cam" accept="image/*" capture="environment"></label>' +
        '<label class="foto" for="f-foto">' + ico('doc') + '<span>Elegir de la galería o archivos<br><span class="sub">Fotos, PDF, Word o Excel. Varios a la vez.</span></span><input type="file" id="f-foto" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx" multiple></label></div>' +
      (P.progreso ? '<p class="subiendo">' + esc(P.progreso) + '</p>' : '') +
      (P.fotos.length ? '<div class="miniaturas">' + P.fotos.map(function (f, k) {
        return '<span class="miniatura">' + (f.vista ? '<img src="' + f.vista + '" alt="' + esc(f.nombre) + '">' : '<span class="miniatura__doc">' + ico('doc') + '<small>' + esc(f.nombre) + '</small></span>') +
          '<button type="button" class="miniatura__x" data-quitar-foto="' + k + '" aria-label="Quitar ' + esc(f.nombre) + '">×</button></span>';
      }).join('') + '</div><p class="sub">' + P.fotos.length + (P.fotos.length === 1 ? ' archivo listo' : ' archivos listos') + '. Puedes agregar más.</p>' : '') +
      errorHtml(P.error) +
      '<button type="button" class="btn btn-main" data-siguiente' + (s.foto_obligatoria && !P.fotos.length ? ' disabled' : '') + '>' + (P.fotos.length || s.foto_obligatoria ? 'Siguiente' : 'Seguir sin foto') + '</button></main>' + nav();
  }
  function resumenFilas() {
    var P = S.pedir, s = plantillaActual(), filas = [];
    var obra = obras().filter(function (o) { return o.obra_id === P.obra_id; })[0];
    if (s.tipo === 'nuevos') { if (obra) filas.push(['Obra', obra.nombre]); P.personas.forEach(function (x, k) { filas.push(['Persona ' + (k + 1), (x.nombre || '(sin nombre)') + (x.rut ? ' · ' + x.rut : '')]); }); }
    else if (s.tipo === 'elegir') {
      P.elegidos.forEach(function (id, k) { var t = S.trab.filter(function (x) { return x.trabajador_id === id; })[0]; filas.push([k ? '' : (s.uno ? 'Trabajador' : 'Trabajadores'), t ? t.nombre : '']); });
      if (obra && s.obra) filas.push(['Obra', obra.nombre]);
      s.campos.forEach(function (c) { if (P.datos[c.clave]) filas.push([c.etiqueta, P.datos[c.clave]]); });
      if (P.motivo) filas.push(['Motivo', P.motivo]);
    } else if (s.tipo === 'campos') { if (obra && s.obra) filas.push(['Obra', obra.nombre]); s.campos.forEach(function (c) { if (P.datos[c.clave]) filas.push([c.etiqueta, P.datos[c.clave]]); }); }
    else { if (P.area === '__otra' && P.depto) filas.push(['Área', nombreArea(P.depto)]); if (P.datos.texto) filas.push(['Lo que nos cuentas', P.datos.texto]); }
    if (P.fotos.length) filas.push(['Archivos', String(P.fotos.length)]);
    return filas;
  }
  function pedirRevisar() {
    var P = S.pedir, s = plantillaActual(), total = pasosTotal(s), filas = resumenFilas();
    var depto = s.depto || P.depto || P.area;
    var a = (S.cat.areas || []).filter(function (x) { return x.clave === depto; })[0];
    return top('Revisa y envía', s.nombre, true) + '<main>' + cabPasos(total, total, 'revisar') +
      '<section class="card"><h3>' + esc(s.nombre) + '</h3><div class="resumen">' +
        (filas.length ? filas.map(function (f) { return '<div><span>' + esc(f[0]) + '</span><span>' + esc(f[1]) + '</span></div>'; }).join('') : '<p class="sub">No escribiste datos. Puedes enviarlo igual: te escribiremos para preguntarte.</p>') +
      '</div></section>' +
      '<p class="sub">Le llega a <b>' + esc(a && a.encargado ? a.encargado : nombreArea(depto)) + '</b>. Te avisamos cuando lo reciba' + (P.area === '__doc' ? '.' : ' y para cuándo estará.') + '</p>' +
      errorHtml(P.error) + (P.progreso ? '<p class="subiendo">' + esc(P.progreso) + '</p>' : '') +
      '<button type="button" class="btn btn-main" data-enviar' + (S.ocupado ? ' disabled' : '') + '>' + ico('enviar') + (S.ocupado ? 'Enviando…' : (P.area === '__doc' ? 'Enviar documento' : 'Enviar pedido')) + '</button></main>' + nav();
  }
  function pedirListo() {
    var P = S.pedir, r = P.resultado || {};
    var chispas = ''; for (var k = 0; k < 10; k++) chispas += '<i style="--r:' + (k * 36) + 'deg"></i>';
    return top(P.area === '__doc' ? 'Documento enviado' : 'Pedido enviado', '', false) + '<main><section class="card listo"><span class="gran"><svg class="dibujo" viewBox="0 0 52 52" aria-hidden="true"><circle class="circulo" cx="26" cy="26" r="24"/><path class="palomita" d="M15 27l7 7 15-16"/></svg><span class="chispas">' + chispas + '</span></span><h2>¡Listo! Lo enviamos</h2>' +
      '<p>' + esc(r.recibe || 'El equipo') + (P.area === '__doc' ? ' lo recibirá y te confirmará aquí.' : ' lo verá y te dirá para cuándo. El plazo normal es de <b>' + esc(r.plazo_dias) + (r.plazo_dias === 1 ? ' día hábil' : ' días hábiles') + '</b>.') + '</p>' +
      (P.fallas && P.fallas.length ? '<div class="error-caja"><p>' + (P.fallas.length === 1 ? 'Un archivo no se pudo subir' : P.fallas.length + ' archivos no se pudieron subir') + '. Mándalos desde la conversación del pedido (botón de la cámara).</p><ul>' +
        P.fallas.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul></div>' : '') +
      '<p class="mono">' + esc(r.solicitud_id) + '</p></section>' +
      '<button type="button" class="btn btn-main" data-pedido="' + esc(r.solicitud_id) + '">Ver la conversación</button>' +
      '<button type="button" class="btn btn-sec" data-ir="inicio">Volver al inicio</button></main>' + nav();
  }

  // ---------- Pedidos ----------
  function pedidos() {
    var grupos = [['TU', 'Te toca a ti'], ['ENVIADO', 'Enviados'], ['CURSO', 'Los estamos haciendo'], ['LISTO', 'Listos'], ['CERRADO', 'Cerrados']];
    if (!S.pedidos.length && S.err.pedidos) return top('Mis pedidos', S.perfil.cliente.razon_social, false) + '<main>' + fallo('pedidos') + '</main>' + nav();
    if (!S.pedidos.length) return top('Mis pedidos', S.perfil.cliente.razon_social, false) + '<main><div class="vacio"><span class="vacio__ico">' + ico('chat') + '</span><b>Todavía no has pedido nada</b><span>Toca «Pedir» abajo para hacer tu primer pedido.</span></div></main>' + nav();
    return top('Mis pedidos', S.perfil.cliente.razon_social, false) + '<main>' + fallo('pedidos') + grupos.map(function (g) {
      var ps = S.pedidos.filter(function (p) { return p.estado === g[0]; });
      return ps.length ? '<section style="display:flex;flex-direction:column;gap:10px"><h2>' + g[1] + ' (' + ps.length + ')</h2><div class="lista">' + ps.map(itemPedido).join('') + '</div></section>' : '';
    }).join('') + '</main>' + nav();
  }
  var EST_ITEM = { ENVIADO: 'Enviado: esperando que lo reciban', CURSO: 'Lo estamos haciendo', TU: '', LISTO: 'Listo', CERRADO: 'Cerrado' };
  function pedido() {
    var d = S.detalle;
    if (!d) {
      var p0 = S.pedidos.filter(function (x) { return x.solicitud_id === S.pedido; })[0];
      return top(p0 ? p0.titulo : 'Pedido', S.pedido || '', true) + '<main aria-busy="true"><span class="oculto-visual">Cargando el pedido…</span>' +
        '<section class="card"><div class="esq esq-titulo"></div><div class="fila" style="justify-content:space-between"><span class="esq esq-bola"></span><span class="esq esq-bola"></span><span class="esq esq-bola"></span></div></section>' +
        '<section class="card"><div class="esq esq-titulo"></div><div class="esq esq-linea"></div><div class="esq esq-linea esq-corta"></div></section>' +
        '<section class="card"><div class="esq esq-linea"></div><div class="esq esq-linea esq-corta"></div></section></main>' + nav();
    }
    var p = S.pedidos.filter(function (x) { return x.solicitud_id === d.solicitud_id; })[0] || { titulo: d.solicitud_id, estado: 'ENVIADO' };
    // El camino: Enviado → Haciéndolo → Listo. Listo y Cerrado completan los tres.
    var paso = p.estado === 'ENVIADO' ? 1 : (p.estado === 'LISTO' || p.estado === 'CERRADO' ? 4 : 2);
    var b = '<ol class="camino' + (paso === 4 ? ' todo' : '') + '">' + ['Enviado', 'Haciéndolo', 'Listo'].map(function (t, k) {
      var n = k + 1, cl = n < paso ? 'hecho' : (n === paso ? 'actual' : '');
      return '<li' + (cl ? ' class="' + cl + '"' : '') + (n === paso ? ' aria-current="step"' : '') + '><span class="bola">' + (n < paso ? ico('check') : n) + '</span>' + t + '</li>';
    }).join('') + '</ol>';
    var multi = d.subsolicitudes.length > 1;
    var items = d.subsolicitudes.map(function (it) {
      var est = it.estado_cliente;
      var nota = it.estado === 'S06' ? 'Te preguntaron: ' + (it.pregunta_pendiente || 'revisa la conversación') : (it.estado === 'S08' ? 'Está listo. ¿Quedó bien?' : (EST_ITEM[est] || '') + (it.fecha_comprometida && est === 'CURSO' ? ' · para el ' + fecha(String(it.fecha_comprometida).slice(0, 10)) : ''));
      return '<div class="item-sub"><b>' + esc(multi ? it.titulo.split(' · ').slice(1).join(' · ') || it.titulo : it.titulo) + '</b>' + chip(est) + '<span class="sub">' + esc(nota) + (it.responsable_nombre && est !== 'ENVIADO' ? ' · ' + esc(it.responsable_nombre) : '') + '</span>' +
        archivosItemHtml(it.archivos || []) +
        (it.estado === 'S08' ? '<div class="fila" style="flex-wrap:wrap;gap:8px"><button type="button" class="btn btn-ok btn-chico" data-confirmar="' + esc(it.subsolicitud_id) + '">' + ico('check') + 'Sí, quedó bien</button><button type="button" class="btn btn-sec btn-chico" data-algo-mal="' + esc(it.subsolicitud_id) + '" style="width:auto">Algo está mal</button></div>' : '') +
      '</div>';
    }).join('');
    var nombres = {}; d.subsolicitudes.forEach(function (it) { nombres[it.subsolicitud_id] = it.titulo.split(' · ').slice(1).join(' · '); });
    // Como WhatsApp: separador por día, iniciales de quien escribe, y lo que llegó desde la
    // última vez que se pintó este pedido aparece con una entrada suave.
    var ms = d.mensajes || [];
    var visto = S.chatVisto && S.chatVisto.id === d.solicitud_id ? S.chatVisto.n : ms.length;
    S.chatVisto = { id: d.solicitud_id, n: ms.length };
    var diaDe = function (v) { var x = new Date(v); return isNaN(x) ? '' : x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2) + '-' + ('0' + x.getDate()).slice(-2); };
    var hoy = diaDe(new Date()), ayer = diaDe(Date.now() - 864e5);
    var horaDe = function (v) { var x = new Date(v); return isNaN(x) ? '' : ('0' + x.getHours()).slice(-2) + ':' + ('0' + x.getMinutes()).slice(-2); };
    var evs = eventosChat(ms);
    var chat = evs.map(function (ev, k) {
      var m = ev.m, mio = m.autor === 'tu', ant = (evs[k - 1] || {}).m, dia = diaDe(m.timestamp);
      var nuevoDia = !ant || diaDe(ant.timestamp) !== dia;
      var sigue = !nuevoDia && ant && ant.autor === m.autor && (ant.nombre || '') === (m.nombre || '');
      return (nuevoDia && dia ? '<div class="dia">' + (dia === hoy ? 'Hoy' : (dia === ayer ? 'Ayer' : esc(fecha(dia)))) + '</div>' : '') +
        '<div class="msg' + (mio ? ' mio-fila' : '') + (sigue ? ' sigue' : '') + (ev.k >= visto ? ' nueva' : '') + '">' +
        (!mio ? '<span class="av' + (sigue ? ' oculto' : '') + '" aria-hidden="true">' + esc(inicial(m.nombre || 'Equipo')) + '</span>' : '') +
        '<div class="burbuja ' + (mio ? 'mio' : 'de-ellos') + (ev.archivos.length ? ' con-archivo' : '') + '">' + (!mio && !sigue ? '<small><b>' + esc(m.nombre || 'El equipo') + '</b></small>' : '') + (multi && m.subsolicitud_id && nombres[m.subsolicitud_id] ? '<small>Sobre ' + esc(nombres[m.subsolicitud_id]) + '</small>' : '') +
        ev.archivos.map(function (a) { return archivoHtml(a, true); }).join('') +
        (ev.texto ? '<span style="white-space:pre-wrap">' + esc(ev.texto) + '</span>' : '') + '<small class="hora">' + esc(horaDe(m.timestamp) || fecha(m.timestamp, true)) + '</small></div></div>';
    }).join('');
    var abierto = d.subsolicitudes.some(function (it) { return ['S09', 'S10', 'S11'].indexOf(it.estado) === -1; });
    return top(p.titulo, d.solicitud_id, true) + '<main>' +
      '<section class="card">' + chip(p.estado) + b + '</section>' +
      '<section class="card"><h3>' + (multi ? 'Cada parte de tu pedido' : 'Tu pedido') + '</h3>' + items + '</section>' +
      '<section style="display:flex;flex-direction:column;gap:10px"><h2>Conversación</h2>' + (chat ? '<div class="chat">' + chat + '</div>' : '<p class="sub">Aquí aparece lo que te escriban. Puedes escribir cuando quieras.</p>') + '</section>' +
      (abierto ? '<form class="composer" id="f-chat" novalidate><button type="button" class="redondo" data-foto-chat aria-label="Mandar foto o archivo">' + ico('camara') + '</button><input type="file" id="f-foto-chat" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx" multiple class="oculto-visual" tabindex="-1">' +
        '<textarea class="inp" id="c-msg" rows="1" placeholder="Escribe aquí…" aria-label="Mensaje"></textarea><button type="submit" class="redondo enviar" aria-label="Enviar">' + ico('enviar') + '</button></form>' : '') +
    '</main>' + nav();
  }

  // En cada ítem: las fotos en una fila de miniaturas y los documentos como fichas.
  // Primero lo que entregó el equipo (es lo que el contratista viene a buscar).
  function archivosItemHtml(as) {
    if (!as.length) return '';
    as = as.slice().sort(function (x, y) { return (y.del_equipo ? 1 : 0) - (x.del_equipo ? 1 : 0); });
    var fotos = as.filter(function (a) { return esImagen(a.tipo_mime) && Number(a.tamano_bytes || 0) <= MAX_MINI; });
    var docs = as.filter(function (a) { return fotos.indexOf(a) === -1; });
    return (docs.length ? '<div class="docs">' + docs.map(function (a) { return archivoHtml(a); }).join('') + '</div>' : '') +
      (fotos.length ? '<div class="galeria">' + fotos.map(function (a) { return archivoHtml(a); }).join('') + '</div>' : '');
  }
  // La conversación mezcla mensajes y archivos por hora, como WhatsApp. Un mensaje
  // automático «Te mandé un archivo: X» se vuelve la foto o el documento X; si el
  // equipo escribió algo propio («Aquí va tu contrato: X»), queda como texto al pie.
  function eventosChat(ms) {
    var archs = archivosDelPedido().slice().sort(function (x, y) { return String(x.fecha).localeCompare(String(y.fecha)); });
    var usados = {};
    var evs = ms.map(function (m, k) {
      var ev = { m: m, k: k, texto: m.texto, archivos: [] };
      var mm = /^([\s\S]*?):\s+([^\n]+)$/.exec(String(m.texto || ''));
      if (mm) {
        var f = archs.filter(function (a) { return !usados[a.archivo_id] && a.nombre === mm[2].trim() && (m.autor === 'tu') === !a.del_equipo; })[0];
        if (f) { usados[f.archivo_id] = true; ev.archivos.push(f); ev.texto = /^Te mandé (un archivo|un documento)$/i.test(mm[1].trim()) ? '' : mm[1].trim(); }
      }
      return ev;
    });
    archs.filter(function (a) { return !usados[a.archivo_id]; }).forEach(function (a) {
      evs.push({ m: { autor: a.del_equipo ? 'equipo' : 'tu', nombre: a.del_equipo ? a.quien : '', timestamp: a.fecha, subsolicitud_id: a.subsolicitud_id }, k: -1, texto: '', archivos: [a] });
    });
    return evs.sort(function (x, y) { return String(x.m.timestamp).localeCompare(String(y.m.timestamp)); });
  }

  // ---------- Trabajadores ----------
  function trabajadores() {
    var activos = S.trab.filter(function (t) { return t.estado !== 'FINIQUITADO'; });
    var porObra = {}; activos.forEach(function (t) { (porObra[t.obra_id || ''] = porObra[t.obra_id || ''] || []).push(t); });
    var bloques = obras().map(function (o) { return [o.obra_id, o.nombre + (o.comuna ? ' · ' + o.comuna : '')]; }).concat([['', 'Sin obra asignada']]);
    var fila = function (t) {
      var e = EST_TRAB[t.estado] || EST_TRAB.ACTIVO;
      return '<button type="button" class="item" data-trab="' + esc(t.trabajador_id) + '"><span class="inicial">' + esc(inicial(t.nombre)) + '</span><span class="grow"><b>' + esc(t.nombre) + '</b><span class="sub">' + esc([t.cargo, t.fecha_inicio ? 'desde ' + t.fecha_inicio : ''].filter(Boolean).join(' · ') || 'Datos por completar') + '</span><span class="estado ' + e[0] + '"><span class="punto"></span>' + e[1] + '</span></span><span class="flecha">' + ico('flecha') + '</span></button>';
    };
    var fini = S.trab.filter(function (t) { return t.estado === 'FINIQUITADO'; });
    return top('Mis trabajadores', activos.length + (activos.length === 1 ? ' en tus obras' : ' en tus obras'), false) + '<main>' +
      fallo('trab') + '<p class="sub">Sus datos quedan aquí: no tienes que escribirlos de nuevo para un finiquito, un anexo o una licencia.</p>' +
      (activos.length || S.err.trab ? bloques.map(function (b) { var ts = porObra[b[0]] || []; return ts.length ? '<section style="display:flex;flex-direction:column;gap:10px"><h2>' + ico('obra', 22) + ' ' + esc(b[1]) + ' (' + ts.length + ')</h2><div class="lista">' + ts.map(fila).join('') + '</div></section>' : ''; }).join('')
        : '<div class="vacio"><span class="vacio__ico">' + ico('personas') + '</span><b>Todavía no hay trabajadores</b><span>Se agregan solos cuando pides un contrato, o agrégalos tú.</span></div>') +
      (fini.length ? '<details class="card"><summary style="font-weight:700;cursor:pointer;min-height:32px">Ya no trabajan contigo (' + fini.length + ')</summary><div class="lista">' + fini.map(fila).join('') + '</div></details>' : '') +
      '<button type="button" class="btn btn-main" data-nuevo-contrato>' + ico('mas') + 'Contratar a alguien nuevo</button>' +
      '<button type="button" class="btn btn-sec" data-agregar-trab>Agregar a alguien que ya trabaja conmigo</button>' +
    '</main>' + nav();
  }
  function trabajador() {
    var t = S.trab.filter(function (x) { return x.trabajador_id === S.trabId; })[0];
    if (!t) { S.vista = 'trabajadores'; return trabajadores(); }
    var e = EST_TRAB[t.estado] || EST_TRAB.ACTIVO;
    var obra = obras().filter(function (o) { return o.obra_id === t.obra_id; })[0];
    var acciones = [['doc_licencia', '__doc', 'Mandar una licencia médica'], ['anexo', 'RRHH', 'Pedir un anexo (cambio de sueldo, obra u horario)'], ['constancia', 'RRHH', 'Dejar una constancia'], ['finiquito', 'RRHH', 'Pedir el finiquito']]
      .filter(function (a) { return plantillasDe(a[1]).some(function (s) { return s.id === a[0]; }); });
    var suyos = S.pedidos.filter(function (p) { return p.titulo.indexOf(t.nombre) !== -1; });
    return top(t.nombre, t.cargo || '', true) + '<main>' +
      '<section class="card"><span class="estado ' + e[0] + '"><span class="punto"></span>' + e[1] + '</span><dl class="datos">' +
        '<dt>RUT</dt><dd>' + esc(t.rut || '—') + '</dd><dt>Obra</dt><dd>' + esc(obra ? obra.nombre : '—') + '</dd><dt>Desde</dt><dd>' + esc(t.fecha_inicio || '—') + '</dd>' +
        '<dt>AFP</dt><dd>' + esc(t.afp || '—') + '</dd><dt>Salud</dt><dd>' + esc(t.salud || '—') + '</dd>' +
      '</dl><button type="button" class="btn btn-sec btn-chico" data-editar-trab="' + esc(t.trabajador_id) + '">Corregir sus datos</button></section>' +
      (t.estado !== 'FINIQUITADO' && acciones.length ? '<section class="card"><h3>¿Qué necesitas para ' + esc(primerNombre(t.nombre)) + '?</h3><div class="lista">' +
        acciones.map(function (a) { return '<button type="button" class="opcion" data-accion-trab="' + a[0] + '" data-accion-area="' + a[1] + '"><span>' + esc(a[2]) + '</span></button>'; }).join('') + '</div></section>' : '') +
      ((S.docs || []).some(function (a) { return a.trabajador_id === t.trabajador_id; }) ? '<button type="button" class="btn btn-sec" data-documentos-trab="' + esc(t.trabajador_id) + '">' + ico('carpeta') + 'Ver sus documentos (' + S.docs.filter(function (a) { return a.trabajador_id === t.trabajador_id; }).length + ')</button>' : '') +
      (suyos.length ? '<section style="display:flex;flex-direction:column;gap:10px"><h2>Sus pedidos</h2><div class="lista">' + suyos.map(itemPedido).join('') + '</div></section>' : '') +
    '</main>' + nav();
  }
  function formTrabajador(t) {
    t = t || {};
    capa.innerHTML = '<div class="ayuda-fondo"><form class="ayuda" id="f-trab" role="dialog" aria-modal="true" aria-labelledby="ft-t" novalidate><h2 id="ft-t">' + (t.trabajador_id ? 'Corregir datos' : 'Agregar un trabajador') + '</h2>' +
      '<input type="hidden" name="trabajador_id" value="' + esc(t.trabajador_id || '') + '">' +
      [['nombre', 'Nombre completo', 'Ej: Juan Pérez Soto'], ['rut', 'RUT', 'Ej: 12.345.678-5'], ['cargo', 'Cargo', 'Ej: Maestro'], ['fecha_inicio', 'Desde cuándo trabaja', 'Ej: 14-10-2026'], ['afp', 'AFP', 'Ej: Modelo'], ['salud', 'Salud', 'Ej: Fonasa']]
        .map(function (c) { return '<label class="campo" for="ft-' + c[0] + '">' + c[1] + '<input class="inp" id="ft-' + c[0] + '" name="' + c[0] + '" placeholder="' + c[2] + '" value="' + esc(t[c[0]] || '') + '"></label>'; }).join('') +
      (obras().length ? '<label class="campo" for="ft-obra">Obra<select class="inp" id="ft-obra" name="obra_id"><option value="">Sin obra</option>' + obras().map(function (o) { return '<option value="' + esc(o.obra_id) + '"' + (o.obra_id === t.obra_id ? ' selected' : '') + '>' + esc(o.nombre) + '</option>'; }).join('') + '</select></label>' : '') +
      '<p class="error-caja" data-error hidden></p>' +
      '<button type="submit" class="btn btn-main">Guardar</button><button type="button" class="btn btn-sec" data-cerrar-capa>Cancelar</button></form></div>';
    empujarHistoria();
    var p = capa.querySelector('input[name=nombre]'); if (p) p.focus();
  }

  // ---------- Mi empresa ----------
  function empresa() {
    var c = S.perfil.cliente, yo = S.perfil.contacto;
    return top('Mi empresa', c.razon_social, false) + '<main>' +
      '<section class="card"><h3>Tus datos</h3><dl class="datos">' +
        '<dt>Empresa</dt><dd>' + esc(c.razon_social) + '</dd><dt>RUT</dt><dd>' + esc(c.rut) + '</dd>' +
        (c.representante ? '<dt>Representante</dt><dd>' + esc(c.representante) + '</dd>' : '') +
        (c.correo ? '<dt>Correo</dt><dd>' + esc(c.correo) + '</dd>' : '') + (c.telefono ? '<dt>Teléfono</dt><dd>' + esc(c.telefono) + '</dd>' : '') + (c.direccion ? '<dt>Dirección</dt><dd>' + esc(c.direccion) + '</dd>' : '') +
        '<dt>Entras tú</dt><dd>' + esc(yo.nombre) + (yo.rol === 'ADMIN' ? ' · administras la cuenta' : '') + '</dd>' +
      '</dl><p class="sub">¿Algo cambió? Escríbele a tu encargado por un pedido de «Otra cosa».</p></section>' +
      '<section class="card"><h3>Tus obras</h3>' + (obras().length ? obras().map(function (o) { var n = S.trab.filter(function (t) { return t.obra_id === o.obra_id && t.estado !== 'FINIQUITADO'; }).length; return '<div class="fila">' + ico('obra', 24) + '<div class="grow"><b>' + esc(o.nombre) + '</b><p class="sub">' + esc([o.comuna, n + (n === 1 ? ' trabajador' : ' trabajadores')].filter(Boolean).join(' · ')) + '</p></div></div>'; }).join('') : '<p class="sub">Aún no hay obras.</p>') +
        '<form class="fila" id="f-obra" novalidate style="flex-wrap:wrap"><input class="inp" name="nombre" placeholder="Nueva obra (ej: Los Robles)" aria-label="Nombre de la obra" style="flex:1;min-width:180px"><input class="inp" name="comuna" placeholder="Comuna" aria-label="Comuna" style="flex:1;min-width:120px"><button type="submit" class="btn btn-sec btn-chico">Agregar</button></form></section>' +
      '<section class="card"><h3>Lo que tienes contratado</h3><div class="chips">' + (c.servicios || []).map(function (s) { return '<span class="chip">' + esc(nombreArea(s)) + '</span>'; }).join('') + '</div></section>' +
      ((S.perfil.encargados || []).length ? '<section class="card"><h3>Quién te atiende</h3>' + S.perfil.encargados.map(function (e) { return '<div class="fila"><span class="inicial">' + esc(inicial(e.nombre)) + '</span><div class="grow"><b>' + esc(e.nombre) + '</b><p class="sub">' + esc(e.area_nombre) + (e.cargo ? ' · ' + esc(e.cargo) : '') + '</p></div></div>'; }).join('') + '</section>' : '') +
      '<button type="button" class="mandar mandar--claro" data-documentos><span class="mandar__ico">' + ico('carpeta') + '</span><span><b>Mis documentos</b><small>Todo lo que te entregamos, por mes</small></span></button>' +
      seccionAvisos() +
      '<div class="nota-seg">' + ico('candado') + '<span><b>Nunca te pediremos claves por aquí</b> (SII, Previred, TGR ni bancos). Si alguien te las pide por el portal, avísale a tu encargado.</span></div>' +
      '<button type="button" class="btn btn-sec" data-salir>' + ico('salir') + 'Salir</button>' +
      '<p class="pie-marca"><b>SIGSO</b> · Portal de clientes de HomePymes</p>' +
    '</main>' + nav();
  }

  // ---------- Ayuda ----------
  var AYUDAS = {
    entrar: ['Escribe tu RUT como aparece en tu carnet.', 'La clave son 6 números. Si la olvidaste, pídele a tu encargado un enlace nuevo.', 'Si marcas «Recordar este teléfono», no tendrás que escribirla cada vez.'],
    activar: ['Elige 6 números fáciles de recordar para ti, pero que no sean 123456 ni el mismo número repetido.', 'Después entrarás con tu RUT y esa clave.'],
    inicio: ['Arriba, en naranjo, está lo que necesita tu respuesta.', 'Para pedir algo, toca el área.', 'Para mandarnos un papel (asistencia, licencia, comprobante), toca «Mandar un documento».'],
    pedir: ['Elige el área y después lo que necesitas.', 'Cada pedido te dice en cuántos días está listo.', 'Si te equivocas, toca la flecha de arriba para volver.'],
    pedido: ['Aquí conversas con quien hace tu pedido, como en WhatsApp.', 'Con la cámara mandas fotos o documentos.', 'Cuando esté listo, aparece el documento con el botón «Abrir». Si está bien, toca «Sí, quedó bien».'],
    pedidos: ['Tus pedidos, ordenados: primero lo que necesita tu respuesta.', 'Toca uno para ver la conversación y los documentos.'],
    trabajadores: ['Tus trabajadores, por obra.', 'Toca uno para ver sus datos y pedir algo para él (finiquito, anexo, licencia).'],
    trab: ['Los datos de este trabajador. Los botones hacen el pedido con sus datos ya puestos.'],
    empresa: ['Tus datos, tus obras y quién te atiende.', 'En «Avisos y app» activas los avisos al teléfono.', 'Nunca te pediremos claves por el portal.'],
    documentos: ['Aquí quedan todos los documentos que te entregamos (contratos, certificados, liquidaciones) y los que tú nos mandaste.', 'Escribe en el buscador el nombre del trabajador o del documento.', 'Toca uno para verlo; desde ahí lo guardas o lo compartes por WhatsApp.']
  };
  function ayuda() {
    var clave = !S.dentro ? (S.invitacion ? 'activar' : 'entrar') : S.vista;
    var lista = AYUDAS[clave] || AYUDAS.inicio;
    var enc = S.perfil && (S.perfil.encargados || [])[0];
    capa.innerHTML = '<div class="ayuda-fondo" data-cerrar-ayuda><div class="ayuda" role="dialog" aria-modal="true" aria-labelledby="ay-t"><h2 id="ay-t">¿Cómo se usa esta pantalla?</h2><ul>' + lista.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
      (enc ? '<h3>¿Necesitas ayuda de una persona?</h3><p class="sub">Escríbele a ' + esc(enc.nombre) + ' (' + esc(enc.area_nombre) + ') con un pedido de «Otra cosa», o llama a la oficina de HomePymes.</p>' : '') +
      '<button type="button" class="btn btn-main" data-cerrar-ayuda>Entendido</button></div></div>';
    empujarHistoria();
  }
  // Aviso que sube desde abajo. El tipo se deduce del texto si no se indica: los errores
  // del portal empiezan con «No se pudo», «Sin conexión»…
  function toast(t, tipo) {
    tipo = tipo || (/^(No se pudo|Sin conexi|Un archivo|La señal|Recursos Humanos no|Esta foto|Se alcanzó|El archivo)/.test(t) ? 'error' : (/^(¡|Listo|Guardado|Entraste|Archivo enviado|Archivos enviados|Obra agregada|Lo enviamos|Avisos apagados)/.test(t) ? 'ok' : 'info'));
    [].forEach.call(document.querySelectorAll('.toast'), function (v) { v.remove(); });
    var el = document.createElement('div'); el.className = 'toast t-' + tipo; el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
    el.innerHTML = ico(tipo === 'error' ? 'alerta' : (tipo === 'ok' ? 'check' : 'reloj')) + '<span>' + esc(t) + '</span>';
    document.body.appendChild(el);
    if (tipo === 'error') vibrar([30, 60, 30]); else if (tipo === 'ok') vibrar(20);
    setTimeout(function () { el.classList.add('sale'); setTimeout(function () { el.remove(); }, 240); }, tipo === 'error' ? 4200 : 3000);
  }
  // Las hojas de abajo se van bajando, no desaparecen de golpe.
  // El botón «atrás» del teléfono: cada pantalla que avanza y cada hoja que se abre deja
  // una marca en el historial, así «atrás» retrocede dentro del portal (o cierra la foto)
  // en vez de salir de la página o volver a WhatsApp.
  var prof = 0, capaHist = false;
  function empujarHistoria(esCapa) { try { history.pushState({ sigso: ++prof }, ''); if (esCapa !== false) capaHist = !!capa.innerHTML; } catch (e) { /* sin historial */ } }
  function volver() { if (prof > 0 && !capa.innerHTML) history.back(); else atras(); }
  window.addEventListener('popstate', function (ev) {
    prof = (ev.state && ev.state.sigso) || 0;
    if (capa.innerHTML) { capaHist = false; cerrarCapaAnim(); return; }
    if (S.dentro) atras();
  });
  function cerrarCapa() {
    if (capaHist) { capaHist = false; history.back(); return; }
    cerrarCapaAnim();
  }
  function cerrarCapaAnim() {
    if (!capa.innerHTML || capa.classList.contains('cerrando')) return;
    capa.classList.add('cerrando');
    setTimeout(function () { capa.innerHTML = ''; capa.classList.remove('cerrando'); }, 190);
  }

  // ---------- Pintar ----------
  function pintar() {
    var h;
    if (!S.dentro) h = S.invitacion ? pantallaActivar(S.invitacion.info, S.invitacion.error) : pantallaEntrar(S.errorEntrar);
    else if (S.vista === 'inicio') h = inicio();
    else if (S.vista === 'pedidos') h = pedidos();
    else if (S.vista === 'pedido') h = pedido();
    else if (S.vista === 'empresa') h = empresa();
    else if (S.vista === 'trabajadores') h = trabajadores();
    else if (S.vista === 'trab') h = trabajador();
    else if (S.vista === 'documentos') h = documentosVista();
    else if (S.vista === 'pedir') {
      var P = S.pedir;
      if (!P || !P.area) h = pedirAreas();
      else if (!P.plantilla) h = pedirServicios();
      else if (P.paso === 'datos') h = pedirDatos();
      else if (P.paso === 'foto') h = pedirFoto();
      else if (P.paso === 'revisar') h = pedirRevisar();
      else h = pedirListo();
    }
    // Lo que se está escribiendo en el chat sobrevive a un repintado (refrescos en segundo plano).
    var ta = document.getElementById('c-msg'), borrador = ta ? ta.value : '';
    app.innerHTML = h;
    hidratarVistas();
    if (borrador) { var ta2 = document.getElementById('c-msg'); if (ta2) { ta2.value = borrador; crecer(ta2); } }
    animarCambio();
  }
  // Transiciones: solo cuando cambia la pantalla (no en cada repintado). Adelante entra
  // desde la derecha, Atrás desde la izquierda y las pestañas de abajo suben suave.
  var ultimaPantalla = '', ultimaPestana = '';
  function claveDePantalla() {
    var P = S.pedir || {};
    return [S.dentro ? 'd' : (S.invitacion ? 'i' : 'e'), S.vista, P.area, P.plantilla, P.paso, S.vista === 'trab' ? S.trabId : '', S.vista === 'pedido' ? S.pedido + (S.detalle ? '+' : '') : ''].join('|');
  }
  function animarCambio() {
    var clave = claveDePantalla(), dir = S.dir || 'fade';
    var pest = { pedido: 'pedidos', pedir: 'pedir', trab: 'trabajadores', documentos: S.docDesde === 'empresa' ? 'empresa' : 'inicio' }[S.vista] || S.vista;
    var n = app.querySelector('.nav');
    if (n && ultimaPestana && pest !== ultimaPestana) n.classList.add('cambio');
    ultimaPestana = S.dentro ? pest : '';
    S.dir = null;
    if (clave === ultimaPantalla) return;
    var antes = ultimaPantalla; ultimaPantalla = clave;
    if (dir === 'adelante' && S.dentro) empujarHistoria(false);
    var login = app.querySelector('.login');
    if (login) { login.classList.add('entra'); return; }
    if (!antes) dir = 'fade';
    // El pedido que termina de cargar no "entra" de nuevo: solo aparece.
    if (antes.replace(/\+$/, '') === clave.replace(/\+$/, '')) dir = 'fade';
    var m = app.querySelector('main');
    if (!m) return;
    [].forEach.call(m.children, function (c, k) { c.style.setProperty('--i', Math.min(k, 8)); });
    m.classList.add('anim-' + dir);
    var t = app.querySelector('.top'); if (t && dir !== 'fade') t.classList.add('top-anim');
  }
  function crecer(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 4, 160) + 'px'; }
  function ir(vista, dir) { S.vista = vista; S.dir = dir || S.dir || 'fade'; pintar(); window.scrollTo(0, 0); }
  function nuevoPedir(area, plantilla, elegidos) {
    // D-005 (E1-3): un identificador por pedido; se repite en cada reintento para que
    // una respuesta perdida por mala señal no cree el pedido dos veces.
    S.pedir = { intento: idIntento(), area: area, plantilla: plantilla || (area === '__otra' ? 'otra' : null), paso: 'datos', personas: [{}], elegidos: elegidos || [], obra_id: null, datos: {}, fotos: [], motivo: null, depto: area === '__otra' ? '' : area, error: '' };
    if (elegidos && elegidos.length) { var t = S.trab.filter(function (x) { return x.trabajador_id === elegidos[0]; })[0]; if (t && t.obra_id) S.pedir.obra_id = t.obra_id; }
    if (obras().length === 1) S.pedir.obra_id = S.pedir.obra_id || obras()[0].obra_id;
    ir('pedir', 'adelante');
  }
  function guardarCampos() {
    var P = S.pedir; if (!P) return;
    app.querySelectorAll('[data-campo]').forEach(function (inp) {
      var k = inp.getAttribute('data-campo');
      if (inp.hasAttribute('data-per')) P.personas[+inp.getAttribute('data-per')][k] = inp.value.trim(); else P.datos[k] = inp.value.trim();
    });
  }
  function abrirPedido(id) {
    S.desde = S.vista === 'pedido' ? S.desde : (S.vista === 'pedir' ? 'pedidos' : S.vista);
    S.pedido = id; S.detalle = null; ir('pedido', 'adelante');
    api('clientePedido', { solicitud_id: id }).then(function (r) {
      if (S.pedido !== id) return;
      if (!r || !r.ok) { toast((r && r.message) || 'No se pudo abrir.'); S.vista = S.desde || 'pedidos'; S.dir = 'atras'; pintar(); return; }
      S.detalle = r.data; pintar();
    });
  }
  // Vuelve a leer el pedido abierto sin pasar por el esqueleto (después de escribir,
  // confirmar o mandar un archivo, y cada tanto mientras está abierto).
  function recargarPedido(alTerminar) {
    var id = S.pedido;
    return api('clientePedido', { solicitud_id: id }).then(function (r) {
      if (S.pedido !== id || S.vista !== 'pedido' || !r || !r.ok) return;
      S.detalle = r.data; pintar();
      if (alTerminar) {
        var u = app.querySelectorAll('.chat .msg'); if (u.length) u[u.length - 1].scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
  }
  function atras() {
    var P = S.pedir;
    capa.innerHTML = ''; capaHist = false;
    S.dir = 'atras';
    if (S.vista === 'pedido') return ir(S.desde || 'pedidos');
    if (S.vista === 'trab') return ir('trabajadores');
    if (S.vista === 'documentos') return ir(S.docDesde && S.docDesde !== 'documentos' ? S.docDesde : 'inicio');
    if (S.vista === 'pedir' && P) {
      guardarCampos(); P.error = '';
      if (P.paso === 'revisar') P.paso = plantillaActual().foto ? 'foto' : 'datos';
      else if (P.paso === 'foto') P.paso = 'datos';
      else if (P.paso === 'datos' && P.plantilla && P.area !== '__otra') P.plantilla = null;
      else S.pedir = null;
      pintar(); window.scrollTo(0, 0); return;
    }
    ir('inicio');
  }

  // Las fotos se achican en el teléfono antes de subir (de ~4 MB a ~300 KB): menos datos móviles y menos espacio.
  // 2026-10-08: TODA foto se convierte a JPG (también las HEIC del iPhone y las WebP):
  // el servidor solo acepta JPG/PNG/GIF y antes una HEIC llegaba tal cual y se rechazaba
  // sin explicar. Fondo blanco (una captura PNG transparente no queda negra). Devuelve
  // { nombre, base64, vista, tamano } o { error } con una frase que la persona entiende.
  var DOCS_OK = /\.(pdf|docx?|xlsx?)$/i;
  function prepararArchivo(f) {
    var nombre = String(f.name || 'archivo');
    var heic = /hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(nombre);
    var esImg = /^image\//.test(f.type) || (!f.type && /\.(jpe?g|png|gif|webp|hei[cf])$/i.test(nombre));
    var leerBase64 = function () {
      return new Promise(function (ok) {
        var lector = new FileReader();
        lector.onload = function () { var u = String(lector.result); ok(u.slice(u.indexOf(',') + 1)); };
        lector.onerror = function () { ok(''); };
        lector.readAsDataURL(f);
      });
    };
    if (!esImg) {
      if (!DOCS_OK.test(nombre)) return Promise.resolve({ error: nombre + ': ese tipo de archivo no se puede mandar. Sirven fotos, PDF, Word o Excel.' });
      if (f.size > 10 * 1024 * 1024) return Promise.resolve({ error: nombre + ' pesa más de 10 MB. Mándalo en partes o como fotos.' });
      return leerBase64().then(function (b) { return b ? { nombre: nombre, base64: b, vista: '', tamano: f.size } : { error: nombre + ' no se pudo leer. Inténtalo de nuevo.' }; });
    }
    return new Promise(function (resolver) {
      var url = URL.createObjectURL(f), img = new Image();
      img.onload = function () {
        var max = 1600, w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, k = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
        var g = c.getContext('2d'); g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var jpg = c.toDataURL('image/jpeg', 0.8);
        resolver({ nombre: nombre.replace(/\.[a-z0-9]{2,5}$/i, '') + '.jpg', base64: jpg.slice(jpg.indexOf(',') + 1), vista: jpg, tamano: Math.round(jpg.length * 0.75) });
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        if (heic) { resolver({ error: 'Esta foto está en formato HEIC y este teléfono no la deja convertir. Sácala de nuevo con «Sacar foto» o mándale una captura de pantalla.' }); return; }
        if (/^image\/(jpeg|png|gif)$/.test(f.type) && f.size <= 5 * 1024 * 1024) { leerBase64().then(function (b) { resolver(b ? { nombre: nombre, base64: b, vista: '', tamano: f.size } : { error: nombre + ' no se pudo leer.' }); }); return; }
        resolver({ error: nombre + ': esta foto no se pudo leer. Sácala de nuevo.' });
      };
      img.src = url;
    });
  }
  // Sube de a uno y junta el motivo de lo que falló (lo dice el servidor: tamaño, tipo, tope).
  function subirArchivos(solicitudId, subId, archivos, alAvanzar) {
    var fallas = [];
    return archivos.reduce(function (p, a, i) {
      return p.then(function () {
        if (alAvanzar) alAvanzar(i + 1, archivos.length);
        return api('clienteSubirArchivo', { solicitud_id: solicitudId, subsolicitud_id: subId, nombre_archivo: a.nombre, contenido_base64: a.base64 }, MS_ARCHIVO)
          .then(function (r) { if (!r || !r.ok) fallas.push(a.nombre + ': ' + ((r && r.message) || 'no se pudo subir')); });
      });
    }, Promise.resolve()).then(function () { return fallas; });
  }
  function idIntento() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, ''); } catch (e) { /* sin crypto */ }
    return Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
  function enviarPedido() {
    var P = S.pedir, s = plantillaActual();
    if (S.ocupado) return;
    S.ocupado = true; P.error = ''; P.progreso = 'Enviando el pedido…'; pintar();
    var datos = { plantilla_id: s.id === 'otra' ? 'otra' : s.id, depto: s.id === 'otra' ? (P.depto || (S.cat.areas[0] || {}).clave) : undefined, datos: P.datos, personas: P.personas,
      trabajadores: P.elegidos, obra_id: P.obra_id || '', motivo: P.motivo || '', texto: P.datos.texto || '', con_archivos: P.fotos.length > 0, intento_id: P.intento };
    api('clienteCrearPedido', datos).then(function (r) {
      if (!r || !r.ok) { S.ocupado = false; P.progreso = ''; P.error = (r && r.message) || 'No se pudo enviar.'; pintar(); return null; }
      P.resultado = r.data;
      return subirArchivos(r.data.solicitud_id, r.data.primer_item, P.fotos, function (i, n) { P.progreso = 'Subiendo archivo ' + i + ' de ' + n + '…'; pintar(); })
        .then(function (fallas) {
          P.fallas = fallas; S.ocupado = false; P.progreso = ''; P.paso = 'listo'; S.dir = 'adelante'; vibrar([20, 50, 40]);
          return Promise.all([refrescarPedidos(), refrescarTrab()]);
        }).then(function () { pintar(); window.scrollTo(0, 0); });
    });
  }
  // ---------- Eventos ----------
  document.addEventListener('click', function (ev) {
    var t = ev.target, b;
    if (t.closest('[data-cerrar-ayuda]') && (t.hasAttribute('data-cerrar-ayuda') || t.closest('button[data-cerrar-ayuda]'))) { cerrarCapa(); return; }
    if (t.closest('[data-cerrar-capa]') || t.classList.contains('ayuda-fondo')) { cerrarCapa(); return; }
    if (t.closest('[data-ayuda]')) { ayuda(); return; }
    if (t.closest('[data-ir-entrar]')) { S.invitacion = null; history.replaceState(null, '', location.pathname); pintar(); return; }
    if (t.closest('[data-atras]')) { volver(); return; }
    if ((b = t.closest('[data-ir]'))) { var v = b.getAttribute('data-ir'); if (v === 'pedir') S.pedir = null; capa.innerHTML = ''; capaHist = false; ir(v); if (v === 'pedidos' || v === 'inicio') refrescarPedidos().then(function () { if (S.vista === v) pintar(); }); return; }
    if ((b = t.closest('[data-area]'))) { nuevoPedir(b.getAttribute('data-area')); return; }
    if ((b = t.closest('[data-plantilla]'))) { S.pedir.plantilla = b.getAttribute('data-plantilla'); S.pedir.paso = 'datos'; S.pedir.personas = [{}]; S.pedir.datos = {}; S.pedir.error = ''; S.dir = 'adelante'; pintar(); window.scrollTo(0, 0); return; }
    if ((b = t.closest('[data-trab]'))) { S.trabId = b.getAttribute('data-trab'); ir('trab', 'adelante'); return; }
    if ((b = t.closest('[data-accion-trab]'))) { nuevoPedir(b.getAttribute('data-accion-area'), b.getAttribute('data-accion-trab'), [S.trabId]); return; }
    if (t.closest('[data-nuevo-contrato]')) { if (plantillasDe('RRHH').some(function (s) { return s.id === 'contrato'; })) nuevoPedir('RRHH', 'contrato'); else toast('Recursos Humanos no está en lo que tienes contratado.'); return; }
    if (t.closest('[data-agregar-trab]')) { formTrabajador(); return; }
    if ((b = t.closest('[data-editar-trab]'))) { formTrabajador(S.trab.filter(function (x) { return x.trabajador_id === b.getAttribute('data-editar-trab'); })[0]); return; }
    if (t.closest('[data-agregar]')) { guardarCampos(); S.pedir.personas.push({}); pintar(); var u = app.querySelectorAll('.persona'); if (u.length) u[u.length - 1].scrollIntoView({ block: 'center' }); return; }
    if ((b = t.closest('[data-quitar]'))) { guardarCampos(); S.pedir.personas.splice(+b.getAttribute('data-quitar'), 1); pintar(); return; }
    if ((b = t.closest('[data-quitar-foto]'))) { S.pedir.fotos.splice(+b.getAttribute('data-quitar-foto'), 1); S.pedir.error = ''; pintar(); return; }
    if ((b = t.closest('[data-elegir]'))) {
      guardarCampos(); var id = b.getAttribute('data-elegir'), s0 = plantillaActual(), L = S.pedir.elegidos, k = L.indexOf(id);
      if (s0.uno) S.pedir.elegidos = k === -1 ? [id] : []; else if (k === -1) L.push(id); else L.splice(k, 1);
      pintar(); return;
    }
    if ((b = t.closest('[data-obra]'))) { guardarCampos(); S.pedir.obra_id = b.getAttribute('data-obra'); pintar(); return; }
    if ((b = t.closest('[data-depto]'))) { guardarCampos(); S.pedir.depto = b.getAttribute('data-depto'); pintar(); return; }
    if ((b = t.closest('[data-motivo]'))) { guardarCampos(); S.pedir.motivo = b.getAttribute('data-motivo'); pintar(); return; }
    if (t.closest('[data-repetir]')) {
      var ant = S.pedidos.filter(function (p) { return /^Liquidaciones/.test(p.titulo); })[0];
      S.pedir.datos.cambios = ant ? 'Igual que el mes pasado (' + ant.solicitud_id + '), sin cambios' : 'Igual que el mes pasado, sin cambios';
      pintar(); toast('Listo. Cambia lo que haga falta.'); return;
    }
    if (t.closest('[data-siguiente]')) {
      guardarCampos();
      var s = plantillaActual(), P0 = S.pedir; P0.error = '';
      if (P0.paso === 'datos') {
        if (s.tipo === 'elegir' && !P0.elegidos.length) { P0.error = s.uno ? 'Toca el nombre del trabajador.' : 'Toca al menos un trabajador.'; pintar(); return; }
        if (s.tipo === 'nuevos' && !P0.personas.some(function (x) { return x.nombre; })) { P0.error = 'Escribe al menos el nombre de una persona.'; pintar(); return; }
        if (P0.area === '__otra' && !P0.depto) { P0.error = 'Elige a qué área va.'; pintar(); return; }
        if (s.tipo === 'libre' && !P0.datos.texto && !s.foto) { P0.error = 'Cuéntanos qué necesitas.'; pintar(); return; }
        P0.paso = s.foto ? 'foto' : 'revisar';
      } else if (P0.paso === 'foto') {
        if (s.foto_obligatoria && !P0.fotos.length) { P0.error = 'Saca la foto o elige el archivo.'; pintar(); return; }
        P0.paso = 'revisar';
      }
      if (!P0.error) S.dir = 'adelante';
      pintar(); window.scrollTo(0, 0); return;
    }
    if (t.closest('[data-enviar]')) { enviarPedido(); return; }
    if ((b = t.closest('[data-pedido]'))) { abrirPedido(b.getAttribute('data-pedido')); return; }
    if ((b = t.closest('[data-ver]'))) { abrirVisor(b.getAttribute('data-ver')); return; }
    if (t.closest('[data-documentos]')) { capa.innerHTML = ''; capaHist = false; irDocumentos(); return; }
    if ((b = t.closest('[data-documentos-trab]'))) { irDocumentos(b.getAttribute('data-documentos-trab')); return; }
    if ((b = t.closest('[data-doc-lado]'))) { S.docFiltro.lado = b.getAttribute('data-doc-lado'); pintar(); return; }
    if ((b = t.closest('[data-doc-trab]'))) { S.docFiltro.trab = ''; pintar(); return; }
    if (t.closest('[data-activar-avisos]')) { activarAvisos(); return; }
    if (t.closest('[data-avisos-no]')) { posponerAvisos(); pintar(); return; }
    if (t.closest('[data-instalar]')) { instalarApp(); return; }
    if (t.closest('[data-apagar-avisos]')) { apagarAvisos().then(function () { toast('Avisos apagados en este teléfono.'); pintar(); }); return; }
    if (t.closest('[data-probar-aviso]')) { api('clientePushProbar', { endpoint: AV.sub && AV.sub.endpoint }).then(function (r) { toast(r && r.ok ? 'Listo: debería llegarte un aviso en unos segundos.' : ((r && r.message) || 'No se pudo.')); }); return; }
    if (t.closest('[data-copiar-enlace]')) {
      var enlace = location.origin + location.pathname;
      (navigator.clipboard ? navigator.clipboard.writeText(enlace) : Promise.reject()).then(function () { toast('Listo: pega el enlace en ' + (esIOS() ? 'Safari' : 'Chrome') + '.'); }, function () { toast(enlace); });
      return;
    }
    if (t.closest('[data-guardar]')) { guardarArchivo((t.closest('[data-visor]') || {}).getAttribute('data-visor')); return; }
    if (t.closest('[data-compartir]')) { compartirArchivo((t.closest('[data-visor]') || {}).getAttribute('data-visor')); return; }
    if ((b = t.closest('[data-confirmar]'))) {
      b.disabled = true;
      api('clienteConfirmar', { solicitud_id: S.pedido, subsolicitud_id: b.getAttribute('data-confirmar'), accion: 'confirmar' }).then(function (r) {
        if (!r || !r.ok) { b.disabled = false; toast((r && r.message) || 'No se pudo.'); return; }
        toast('¡Gracias! Quedó registrado.'); refrescarPedidos().then(function () { recargarPedido(); });
      });
      return;
    }
    if ((b = t.closest('[data-algo-mal]'))) {
      var subId = b.getAttribute('data-algo-mal');
      capa.innerHTML = '<div class="ayuda-fondo"><form class="ayuda" id="f-reabrir" data-sub="' + esc(subId) + '" role="dialog" aria-modal="true" aria-labelledby="fr-t" novalidate><h2 id="fr-t">¿Qué está mal?</h2>' +
        '<label class="campo" for="fr-txt">Cuéntanos qué falta o qué hay que corregir<textarea class="inp" id="fr-txt" name="comentario"></textarea></label><p class="error-caja" data-error hidden></p>' +
        '<button type="submit" class="btn btn-main">Enviar</button><button type="button" class="btn btn-sec" data-cerrar-capa>Cancelar</button></form></div>';
      empujarHistoria(); capa.querySelector('textarea').focus(); return;
    }
    if (t.closest('[data-foto-chat]')) { document.getElementById('f-foto-chat').click(); return; }
    // D-005 (E1-6/E3-1): reintentar solo el recurso que falló, sin perder lo escrito.
    var rein = t.closest('[data-reintentar]');
    if (rein) {
      rein.disabled = true; rein.setAttribute('aria-busy', 'true');
      recargar(rein.getAttribute('data-reintentar')).then(function () { pintar(); });
      return;
    }
    if (t.closest('[data-salir]')) { apagarAvisos().then(function () { return api('clienteSalir'); }).then(function () { guardarToken(''); S.dentro = false; S.perfil = null; pintar(); }); return; }
  });

  document.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target;
    if (f.id === 'f-entrar') {
      var rut = f.rut.value.trim(), pin = f.pin.value.trim(), recordar = f.recordar.checked;
      if (!rut || !/^\d{6}$/.test(pin)) { S.errorEntrar = 'Escribe tu RUT y tu clave de 6 números.'; pintar(); return; }
      S.ocupado = true; S.errorEntrar = ''; pintar();
      api('clienteEntrar', { rut: rut, pin: pin, recordar: recordar, dispositivo: dispositivo() }).then(function (r) {
        S.ocupado = false;
        if (!r || !r.ok) { S.errorEntrar = (r && r.message) || 'No se pudo entrar.'; vibrar([30, 60, 30]); pintar(); var i = document.getElementById('l-rut'); if (i) i.value = rut; return; }
        guardarToken(r.data.cliente_token, recordar);
        cargarTodo().then(function () { S.vista = 'inicio'; pintar(); toast('Entraste. Este ingreso quedó registrado.'); abrirPendiente(); });
      });
      return;
    }
    if (f.id === 'f-activar') {
      var pin1 = f.pin.value.trim(), pin2 = f.pin2.value.trim(), rec = f.recordar.checked;
      if (!/^\d{6}$/.test(pin1)) { S.invitacion.error = 'La clave son 6 números.'; pintar(); return; }
      if (pin1 !== pin2) { S.invitacion.error = 'Las dos claves no son iguales. Escríbelas de nuevo.'; pintar(); return; }
      S.ocupado = true; S.invitacion.error = ''; pintar();
      api('clienteActivar', { invitacion: S.invitacion.codigo, pin: pin1, pin2: pin2, recordar: rec, dispositivo: dispositivo() }).then(function (r) {
        S.ocupado = false;
        if (!r || !r.ok) { S.invitacion.error = (r && r.message) || 'No se pudo guardar.'; pintar(); return; }
        guardarToken(r.data.cliente_token, rec); S.invitacion = null; history.replaceState(null, '', location.pathname);
        cargarTodo().then(function () { S.vista = 'inicio'; pintar(); toast('¡Listo! Ya tienes tu clave. Desde ahora entras con tu RUT y esa clave.'); });
      });
      return;
    }
    if (f.id === 'f-chat') {
      var ta = document.getElementById('c-msg'), txt = ta.value.trim(); if (!txt) return;
      var boton = f.querySelector('[type=submit]'); boton.disabled = true;
      // Se ve al tiro como enviado (gris) y se confirma cuando responde el servidor.
      var chat = app.querySelector('.chat');
      if (!chat) { var cab = [].filter.call(app.querySelectorAll('main h2'), function (h) { return h.textContent === 'Conversación'; })[0]; if (cab) { var vacio = cab.nextElementSibling; chat = document.createElement('div'); chat.className = 'chat'; if (vacio && vacio.tagName === 'P') vacio.replaceWith(chat); else cab.after(chat); } }
      var fila = document.createElement('div'); fila.className = 'msg mio-fila nueva';
      fila.innerHTML = '<div class="burbuja mio enviando"><span style="white-space:pre-wrap">' + esc(txt) + '</span><small class="hora">Enviando…</small></div>';
      if (chat) { chat.appendChild(fila); fila.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      ta.value = ''; crecer(ta); vibrar(15);
      api('clienteMensaje', { solicitud_id: S.pedido, texto: txt }).then(function (r) {
        boton.disabled = false;
        if (!r || !r.ok) {
          var bb = fila.querySelector('.burbuja'); bb.classList.add('fallo'); bb.querySelector('.hora').textContent = 'No se envió';
          var ta3 = document.getElementById('c-msg'); if (ta3 && !ta3.value) { ta3.value = txt; crecer(ta3); }
          toast((r && r.message) || 'No se pudo enviar.'); return;
        }
        recargarPedido(true); refrescarPedidos();
      });
      return;
    }
    if (f.id === 'f-reabrir') {
      var com = f.comentario.value.trim(), err = f.querySelector('[data-error]');
      if (!com) { err.textContent = 'Cuéntanos qué está mal.'; err.hidden = false; return; }
      api('clienteConfirmar', { solicitud_id: S.pedido, subsolicitud_id: f.getAttribute('data-sub'), accion: 'reabrir', comentario: com }).then(function (r) {
        if (!r || !r.ok) { err.textContent = (r && r.message) || 'No se pudo.'; err.hidden = false; return; }
        cerrarCapa(); toast('Lo enviamos. Lo van a corregir.'); refrescarPedidos().then(function () { recargarPedido(); });
      });
      return;
    }
    if (f.id === 'f-trab') {
      var d = {}; new FormData(f).forEach(function (v, k) { d[k] = String(v).trim(); });
      var e2 = f.querySelector('[data-error]');
      if (!d.nombre) { e2.textContent = 'Escribe el nombre.'; e2.hidden = false; return; }
      if (!d.trabajador_id) delete d.trabajador_id;
      api('clienteGuardarTrabajador', d).then(function (r) {
        if (!r || !r.ok) { e2.textContent = (r && r.message) || 'No se pudo guardar.'; e2.hidden = false; return; }
        cerrarCapa(); refrescarTrab().then(function () { pintar(); toast('Guardado.'); });
      });
      return;
    }
    if (f.id === 'f-obra') {
      var n = f.nombre.value.trim(); if (!n) return;
      api('clienteGuardarObra', { nombre: n, comuna: f.comuna.value.trim() }).then(function (r) {
        if (!r || !r.ok) { toast((r && r.message) || 'No se pudo.'); return; }
        api('clienteSesion').then(function (rr) { if (rr && rr.ok) S.perfil = rr.data; pintar(); toast('Obra agregada.'); });
      });
    }
  });

  document.addEventListener('change', function (ev) {
    var inp = ev.target;
    if (inp.id === 'f-foto' || inp.id === 'f-foto-cam') {
      var fs = [].slice.call(inp.files || []); inp.value = '';
      if (!fs.length) return;
      S.pedir.error = ''; S.pedir.progreso = fs.length === 1 ? 'Preparando el archivo…' : 'Preparando ' + fs.length + ' archivos…'; pintar();
      Promise.all(fs.map(prepararArchivo)).then(function (xs) {
        var errores = xs.filter(function (x) { return x.error; }).map(function (x) { return x.error; });
        xs.filter(function (x) { return !x.error; }).forEach(function (x) { S.pedir.fotos.push(x); });
        S.pedir.error = errores.join(' ');
        S.pedir.progreso = ''; pintar();
      });
    } else if (inp.id === 'f-foto-chat') {
      var fc = [].slice.call(inp.files || []); inp.value = '';
      if (!fc.length || !S.detalle) return;
      // Va al ítem que está esperando algo del contratista (o al primero abierto).
      var its = S.detalle.subsolicitudes, destino = its.filter(function (it) { return it.estado === 'S06'; })[0] ||
        its.filter(function (it) { return ['S09', 'S10', 'S11'].indexOf(it.estado) === -1; })[0] || its[0];
      var subId = destino ? destino.subsolicitud_id : '';
      var chatEl = app.querySelector('.chat'), fila = null;
      Promise.all(fc.map(prepararArchivo)).then(function (xs) {
        var buenos = xs.filter(function (x) { return !x.error; }), malos = xs.filter(function (x) { return x.error; });
        if (malos.length) toast(malos[0].error);
        if (!buenos.length) return;
        if (chatEl) {
          fila = document.createElement('div'); fila.className = 'msg mio-fila nueva';
          fila.innerHTML = '<div class="burbuja mio enviando con-archivo">' + buenos.map(function (x) { return x.vista ? '<span class="mini mini--grande"><img src="' + x.vista + '" alt=""></span>' : '<span class="doc"><span class="doc__tipo">' + ico('doc') + '</span><span class="grow">' + esc(x.nombre) + '</span></span>'; }).join('') +
            '<small class="hora">Subiendo…</small></div>';
          chatEl.appendChild(fila); fila.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } else toast('Subiendo…');
        subirArchivos(S.pedido, subId, buenos, function (i, n) { if (fila && n > 1) fila.querySelector('.hora').textContent = 'Subiendo ' + i + ' de ' + n + '…'; }).then(function (fallas) {
          var subidos = buenos.filter(function (x) { return !fallas.some(function (m) { return m.indexOf(x.nombre + ':') === 0; }); });
          if (fallas.length) { toast('No se pudo subir: ' + fallas.join(' · ')); if (fila && !subidos.length) { fila.querySelector('.burbuja').classList.add('fallo'); fila.querySelector('.hora').textContent = 'No se envió'; } }
          if (!subidos.length) return;
          // Un aviso por archivo: así al equipo le llega «te escribió» y aquí se ve la foto en su lugar.
          subidos.reduce(function (p, x) { return p.then(function () { return api('clienteMensaje', { solicitud_id: S.pedido, subsolicitud_id: subId, texto: 'Te mandé un archivo: ' + x.nombre }); }); }, Promise.resolve())
            .then(function () { if (!fallas.length) toast(subidos.length === 1 ? 'Archivo enviado.' : 'Archivos enviados.'); refrescarPedidos(); recargarPedido(true); });
        });
      });
    }
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && capa.innerHTML) cerrarCapa(); });

  // D-005 (E3-3): mientras #capa tiene algo (ayuda, visor, formularios) es un diálogo
  // de verdad: el resto queda `inert`, el foco entra y Tab no se escapa. Al vaciarse,
  // el foco vuelve a quien la abrió (o a su equivalente si la pantalla se repintó).
  // Se observa #capa porque varias rutas la llenan y vacían directamente.
  var ENFOCABLES = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  var capaPrevio = null, capaHuella = null, capaAbierta = false;
  function enfocablesCapa() { return [].filter.call(capa.querySelectorAll(ENFOCABLES), function (n) { return n.getClientRects().length > 0; }); }
  function huella(n) {
    if (!n || n === document.body || !n.getAttribute) return null;
    if (n.id) return '#' + n.id;
    var a = [].find.call(n.attributes, function (x) { return /^data-/.test(x.name) && x.value; });
    return a ? n.tagName.toLowerCase() + '[' + a.name + '="' + String(a.value).replace(/["\\]/g, '\\$&') + '"]' : null;
  }
  // Revisión Codex Tanda 1 (hallazgo 6): algunos formularios enfocan su campo apenas
  // abren, antes de que el observador corra; por eso el activador se anota en el
  // momento (último foco o toque fuera de la capa), no al abrir.
  var ultimoFuera = null;
  function anotarFuera(ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest(ENFOCABLES) || ev.target : null;
    if (t && t !== document.body && !capa.contains(t)) ultimoFuera = t;
  }
  document.addEventListener('focusin', anotarFuera, true);
  document.addEventListener('click', anotarFuera, true);
  function vigilarCapa() {
    var abierta = !!capa.firstElementChild;
    if (abierta && !capaAbierta) {
      capaAbierta = true;
      var a = document.activeElement;
      capaPrevio = a && a !== document.body && !capa.contains(a) ? a : ultimoFuera; capaHuella = huella(capaPrevio);
      app.inert = true;
    } else if (!abierta && capaAbierta) {
      capaAbierta = false; app.inert = false;
      var destino = capaPrevio && document.contains(capaPrevio) ? capaPrevio : null;
      if (!destino && capaHuella) { try { destino = app.querySelector(capaHuella); } catch (e) { destino = null; } }
      if (!destino) { destino = app.querySelector('h1, h2'); if (destino && !destino.hasAttribute('tabindex')) destino.setAttribute('tabindex', '-1'); }
      if (destino) { try { destino.focus({ preventScroll: true }); } catch (e) { /* ya no está */ } }
      capaPrevio = capaHuella = null;
    }
    // Abrir (o repintar el visor) puede dejar el foco fuera: se lleva al primer control.
    if (abierta && !capa.contains(document.activeElement)) { var l = enfocablesCapa(); if (l[0]) l[0].focus(); }
  }
  if (window.MutationObserver) new MutationObserver(vigilarCapa).observe(capa, { childList: true });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Tab' || !capa.firstElementChild) return;
    var l = enfocablesCapa(); if (!l.length) { ev.preventDefault(); return; }
    var a = document.activeElement, primero = l[0], ultimo = l[l.length - 1];
    if (!capa.contains(a)) { ev.preventDefault(); (ev.shiftKey ? ultimo : primero).focus(); }
    else if (ev.shiftKey && a === primero) { ev.preventDefault(); ultimo.focus(); }
    else if (!ev.shiftKey && a === ultimo) { ev.preventDefault(); primero.focus(); }
  }, true);

  // Mientras se escribe: la clave solo acepta números y llena sus casillas, el RUT se
  // ordena con puntos y guion, y el cuadro del chat crece con el texto.
  document.addEventListener('input', function (ev) {
    var inp = ev.target;
    if (inp.classList.contains('pin-real')) {
      var v = inp.value.replace(/\D/g, '').slice(0, 6); if (v !== inp.value) inp.value = v;
      pintarPin(inp);
      if (v.length === 6) { vibrar(10); if (inp.id === 'a-pin') { var otro = document.getElementById('a-pin2'); if (otro && !otro.value) otro.focus(); } }
    } else if (inp.id === 'l-rut' && inp.selectionStart === inp.value.length) {
      inp.value = formatoRut(inp.value);
    } else if (inp.id === 'c-msg') crecer(inp);
    else if (inp.id === 'doc-q') { S.docFiltro.q = inp.value; var l = document.getElementById('doc-lista'); if (l) { l.innerHTML = listaDocsHtml(); hidratarVistas(); } }
  });
  document.addEventListener('focusin', function (ev) { if (ev.target.classList && ev.target.classList.contains('pin-real')) pintarPin(ev.target); });
  document.addEventListener('focusout', function (ev) { if (ev.target.classList && ev.target.classList.contains('pin-real')) setTimeout(function () { pintarPin(ev.target); }, 0); });

  // La cabecera se achica al bajar, para dejar más pantalla al contenido.
  var compacto = false;
  window.addEventListener('scroll', function () {
    var c = window.scrollY > 36;
    if (c !== compacto) { compacto = c; app.classList.toggle('compacto', c); }
  }, { passive: true });

  // Al volver a la aplicación (o cada 30 s con un pedido abierto) se traen las novedades,
  // sin interrumpir si la persona está escribiendo o tiene una hoja abierta.
  function escribiendo() { var a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) || !!capa.innerHTML; }
  function novedades() {
    if (!S.dentro || document.visibilityState !== 'visible' || escribiendo() || S.ocupado) return;
    if (S.vista === 'pedido' && S.detalle) { refrescarPedidos(); recargarPedido(); }
    else if (S.vista === 'inicio' || S.vista === 'pedidos') refrescarPedidos().then(function () { if ((S.vista === 'inicio' || S.vista === 'pedidos') && !escribiendo()) pintar(); });
  }
  document.addEventListener('visibilitychange', novedades);
  setInterval(function () { if (S.vista === 'pedido') novedades(); }, 30000);

  // ---------- Arranque ----------
  function arrancar() {
    // Un aviso tocado abre portal.html#pedido=<id>: se abre ese pedido apenas haya sesión.
    var mp = /#pedido=([A-Za-z0-9_-]+)/.exec(location.hash || '');
    if (mp) { S.pedidoPendiente = decodeURIComponent(mp[1]); history.replaceState(null, '', location.pathname + location.search); }
    prepararAvisos();
    var m = /#invitacion=([A-Za-z0-9_-]+)/.exec(location.hash || '');
    if (m) {
      S.invitacion = { codigo: m[1], info: null, error: '' };
      api('clienteVerInvitacion', { invitacion: m[1] }).then(function (r) {
        if (r && r.ok) S.invitacion.info = r.data; else S.invitacion.error = (r && r.message) || '';
        pintar();
      });
      return;
    }
    if (!token()) { pintar(); return; }
    cargarTodo().then(function () { pintar(); abrirPendiente(); });
  }
  // Con el portal ya abierto, un enlace #pedido=<id> (de un aviso) también abre el pedido.
  window.addEventListener('hashchange', function () {
    var mp = /#pedido=([A-Za-z0-9_-]+)/.exec(location.hash || '');
    if (!mp) return;
    S.pedidoPendiente = decodeURIComponent(mp[1]); history.replaceState(null, '', location.pathname + location.search);
    abrirPendiente();
  });
  function abrirPendiente() { if (S.dentro && S.pedidoPendiente) { var id = S.pedidoPendiente; S.pedidoPendiente = null; abrirPedido(id); } }
  arrancar();
})();
