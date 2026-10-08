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
    alerta: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5h0"/>',
    reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    salir: '<path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/>',
    candado: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    obra: '<path d="M3 21h18M5 21V9l7-5 7 5v12"/><path d="M9 21v-6h6v6"/>'
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
  function token() { try { return localStorage.getItem(LLAVE) || sessionStorage.getItem(LLAVE) || ''; } catch (e) { return ''; } }
  function guardarToken(t, recordar) {
    try { localStorage.removeItem(LLAVE); sessionStorage.removeItem(LLAVE); if (t) (recordar ? localStorage : sessionStorage).setItem(LLAVE, t); } catch (e) { /* sin almacenamiento */ }
  }
  function api(accion, datos) {
    var d = Object.assign({ cliente_token: token() }, datos || {});
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: accion, data: d }) })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (r && !r.ok && /sesi[oó]n termin[oó]/i.test(r.message || '')) { guardarToken(''); S.dentro = false; pintar(); }
        return r;
      })
      .catch(function () { return { ok: false, message: 'Sin conexión. Revisa tu señal e inténtalo de nuevo.' }; });
  }

  // ---------- Estado ----------
  var S = { dentro: false, vista: 'inicio', perfil: null, cat: null, pedidos: [], trab: [], pedido: null, detalle: null, pedir: null, trabId: null, desde: null, invitacion: null, ocupado: false };

  function cargarTodo() {
    return Promise.all([api('clienteSesion'), api('clienteCatalogo'), api('clientePedidos'), api('clienteTrabajadores')]).then(function (r) {
      if (!r[0] || !r[0].ok) { S.dentro = false; return; }
      S.perfil = r[0].data; S.cat = r[1] && r[1].ok ? r[1].data : { areas: [], documentos: [] };
      S.pedidos = r[2] && r[2].ok ? r[2].data.pedidos : []; S.trab = r[3] && r[3].ok ? r[3].data.trabajadores : [];
      S.dentro = true;
    });
  }
  function refrescarPedidos() { return api('clientePedidos').then(function (r) { if (r && r.ok) S.pedidos = r.data.pedidos; }); }
  function refrescarTrab() { return api('clienteTrabajadores').then(function (r) { if (r && r.ok) S.trab = r.data.trabajadores; }); }

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
    var actual = { pedido: 'pedidos', pedir: 'pedir', trab: 'trabajadores' }[S.vista] || S.vista;
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
    return top(saludo() + ', ' + primerNombre(S.perfil.contacto.nombre), S.perfil.cliente.razon_social) + '<main>' +
      (tuyos.length ? '<section class="card toca"><div class="toca-cab"><span class="latido"></span>Te toca a ti (' + tuyos.length + ')</div><div class="lista">' + tuyos.map(itemPedido).join('') + '</div></section>' : '') +
      '<section style="display:flex;flex-direction:column;gap:12px"><h2>¿Qué necesitas?</h2>' + areasHtml() + botonMandar() + '</section>' +
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
    return top('Pedir', 'Elige a qué área', false) + '<main><p class="sub">Toca el área. Si no sabes cuál es, elige «Otra cosa» y cuéntanos con tus palabras.</p>' + areasHtml() + botonMandar() + '</main>' + nav();
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
      '<label class="foto" for="f-foto">' + ico('camara') + '<span>Sacar foto o elegir archivo<br><span class="sub">Fotos, PDF, Word o Excel. Puedes mandar varios.</span></span><input type="file" id="f-foto" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx" multiple></label>' +
      (P.fotos.length ? '<div class="miniaturas">' + P.fotos.map(function (f, k) { return (f.vista ? '<img src="' + f.vista + '" alt="' + esc(f.nombre) + '">' : '<span class="chip">' + esc(f.nombre) + '</span>') + ''; }).join('') + '</div><button type="button" class="quitar" data-quitar-fotos>Quitar los archivos</button>' : '') +
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
      (P.fallidos ? '<p class="error-caja">' + P.fallidos + (P.fallidos === 1 ? ' archivo no se pudo subir' : ' archivos no se pudieron subir') + '. Mándalos desde la conversación del pedido.</p>' : '') +
      '<p class="mono">' + esc(r.solicitud_id) + '</p></section>' +
      '<button type="button" class="btn btn-main" data-pedido="' + esc(r.solicitud_id) + '">Ver la conversación</button>' +
      '<button type="button" class="btn btn-sec" data-ir="inicio">Volver al inicio</button></main>' + nav();
  }

  // ---------- Pedidos ----------
  function pedidos() {
    var grupos = [['TU', 'Te toca a ti'], ['ENVIADO', 'Enviados'], ['CURSO', 'Los estamos haciendo'], ['LISTO', 'Listos'], ['CERRADO', 'Cerrados']];
    if (!S.pedidos.length) return top('Mis pedidos', S.perfil.cliente.razon_social, false) + '<main><div class="vacio"><span class="vacio__ico">' + ico('chat') + '</span><b>Todavía no has pedido nada</b><span>Toca «Pedir» abajo para hacer tu primer pedido.</span></div></main>' + nav();
    return top('Mis pedidos', S.perfil.cliente.razon_social, false) + '<main>' + grupos.map(function (g) {
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
        (it.archivos || []).slice().sort(function (x, y) { return (y.del_equipo ? 1 : 0) - (x.del_equipo ? 1 : 0); }).map(function (a) {
          return '<div class="doc' + (a.del_equipo ? ' del-equipo' : '') + '">' + ico(/^image\//.test(a.tipo_mime) ? 'camara' : 'doc') + '<span class="grow">' + esc(a.nombre) +
            '<small class="sub" style="display:block;font-weight:400">' + (a.del_equipo ? 'Te lo mandó ' + esc(a.quien) : 'Lo mandaste tú') + ' · ' + esc(fecha(a.fecha, true)) + '</small></span>' +
            '<button type="button" class="btn ' + (a.del_equipo ? 'btn-main' : 'btn-sec') + ' btn-chico" data-descargar="' + esc(a.archivo_id) + '" style="width:auto">Abrir</button></div>';
        }).join('') +
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
    var chat = ms.map(function (m, k) {
      var mio = m.autor === 'tu', ant = ms[k - 1], dia = diaDe(m.timestamp);
      var nuevoDia = !ant || diaDe(ant.timestamp) !== dia;
      var sigue = !nuevoDia && ant && ant.autor === m.autor && (ant.nombre || '') === (m.nombre || '');
      return (nuevoDia && dia ? '<div class="dia">' + (dia === hoy ? 'Hoy' : (dia === ayer ? 'Ayer' : esc(fecha(dia)))) + '</div>' : '') +
        '<div class="msg' + (mio ? ' mio-fila' : '') + (sigue ? ' sigue' : '') + (k >= visto ? ' nueva' : '') + '">' +
        (!mio ? '<span class="av' + (sigue ? ' oculto' : '') + '" aria-hidden="true">' + esc(inicial(m.nombre || 'Equipo')) + '</span>' : '') +
        '<div class="burbuja ' + (mio ? 'mio' : 'de-ellos') + '">' + (!mio && !sigue ? '<small><b>' + esc(m.nombre || 'El equipo') + '</b></small>' : '') + (multi && m.subsolicitud_id && nombres[m.subsolicitud_id] ? '<small>Sobre ' + esc(nombres[m.subsolicitud_id]) + '</small>' : '') +
        '<span style="white-space:pre-wrap">' + esc(m.texto) + '</span><small class="hora">' + esc(horaDe(m.timestamp) || fecha(m.timestamp, true)) + '</small></div></div>';
    }).join('');
    var abierto = d.subsolicitudes.some(function (it) { return ['S09', 'S10', 'S11'].indexOf(it.estado) === -1; });
    return top(p.titulo, d.solicitud_id, true) + '<main>' +
      '<section class="card">' + chip(p.estado) + b + '</section>' +
      '<section class="card"><h3>' + (multi ? 'Cada parte de tu pedido' : 'Tu pedido') + '</h3>' + items + '</section>' +
      '<section style="display:flex;flex-direction:column;gap:10px"><h2>Conversación</h2>' + (chat ? '<div class="chat">' + chat + '</div>' : '<p class="sub">Aquí aparece lo que te escriban. Puedes escribir cuando quieras.</p>') + '</section>' +
      (abierto ? '<form class="composer" id="f-chat" novalidate><button type="button" class="redondo" data-foto-chat aria-label="Mandar foto o archivo">' + ico('camara') + '</button><input type="file" id="f-foto-chat" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx" class="oculto-visual" tabindex="-1">' +
        '<textarea class="inp" id="c-msg" rows="1" placeholder="Escribe aquí…" aria-label="Mensaje"></textarea><button type="submit" class="redondo enviar" aria-label="Enviar">' + ico('enviar') + '</button></form>' : '') +
    '</main>' + nav();
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
      '<p class="sub">Sus datos quedan aquí: no tienes que escribirlos de nuevo para un finiquito, un anexo o una licencia.</p>' +
      (activos.length ? bloques.map(function (b) { var ts = porObra[b[0]] || []; return ts.length ? '<section style="display:flex;flex-direction:column;gap:10px"><h2>' + ico('obra', 22) + ' ' + esc(b[1]) + ' (' + ts.length + ')</h2><div class="lista">' + ts.map(fila).join('') + '</div></section>' : ''; }).join('')
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
    empresa: ['Tus datos, tus obras y quién te atiende.', 'Nunca te pediremos claves por el portal.']
  };
  function ayuda() {
    var clave = !S.dentro ? (S.invitacion ? 'activar' : 'entrar') : S.vista;
    var lista = AYUDAS[clave] || AYUDAS.inicio;
    var enc = S.perfil && (S.perfil.encargados || [])[0];
    capa.innerHTML = '<div class="ayuda-fondo" data-cerrar-ayuda><div class="ayuda" role="dialog" aria-modal="true" aria-labelledby="ay-t"><h2 id="ay-t">¿Cómo se usa esta pantalla?</h2><ul>' + lista.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
      (enc ? '<h3>¿Necesitas ayuda de una persona?</h3><p class="sub">Escríbele a ' + esc(enc.nombre) + ' (' + esc(enc.area_nombre) + ') con un pedido de «Otra cosa», o llama a la oficina de HomePymes.</p>' : '') +
      '<button type="button" class="btn btn-main" data-cerrar-ayuda>Entendido</button></div></div>';
  }
  // Aviso que sube desde abajo. El tipo se deduce del texto si no se indica: los errores
  // del portal empiezan con «No se pudo», «Sin conexión»…
  function toast(t, tipo) {
    tipo = tipo || (/^(No se pudo|Sin conexi|Un archivo|Recursos Humanos no)/.test(t) ? 'error' : (/^(¡|Listo|Guardado|Entraste|Archivo enviado|Obra agregada|Lo enviamos)/.test(t) ? 'ok' : 'info'));
    [].forEach.call(document.querySelectorAll('.toast'), function (v) { v.remove(); });
    var el = document.createElement('div'); el.className = 'toast t-' + tipo; el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
    el.innerHTML = ico(tipo === 'error' ? 'alerta' : (tipo === 'ok' ? 'check' : 'reloj')) + '<span>' + esc(t) + '</span>';
    document.body.appendChild(el);
    if (tipo === 'error') vibrar([30, 60, 30]); else if (tipo === 'ok') vibrar(20);
    setTimeout(function () { el.classList.add('sale'); setTimeout(function () { el.remove(); }, 240); }, tipo === 'error' ? 4200 : 3000);
  }
  // Las hojas de abajo se van bajando, no desaparecen de golpe.
  function cerrarCapa() {
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
    var pest = { pedido: 'pedidos', pedir: 'pedir', trab: 'trabajadores' }[S.vista] || S.vista;
    var n = app.querySelector('.nav');
    if (n && ultimaPestana && pest !== ultimaPestana) n.classList.add('cambio');
    ultimaPestana = S.dentro ? pest : '';
    S.dir = null;
    if (clave === ultimaPantalla) return;
    var antes = ultimaPantalla; ultimaPantalla = clave;
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
    S.pedir = { area: area, plantilla: plantilla || (area === '__otra' ? 'otra' : null), paso: 'datos', personas: [{}], elegidos: elegidos || [], obra_id: null, datos: {}, fotos: [], motivo: null, depto: area === '__otra' ? '' : area, error: '' };
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
    capa.innerHTML = '';
    S.dir = 'atras';
    if (S.vista === 'pedido') return ir(S.desde || 'pedidos');
    if (S.vista === 'trab') return ir('trabajadores');
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
  function prepararArchivo(f) {
    return new Promise(function (resolver) {
      var lector = new FileReader();
      lector.onload = function () {
        var dataUrl = String(lector.result);
        if (!/^image\/(jpeg|png|webp)/.test(f.type)) { resolver({ nombre: f.name, base64: dataUrl.slice(dataUrl.indexOf(',') + 1), vista: '', tamano: f.size }); return; }
        var img = new Image();
        img.onload = function () {
          var max = 1600, w = img.width, h = img.height, k = Math.min(1, max / Math.max(w, h));
          var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          var jpg = c.toDataURL('image/jpeg', 0.8);
          resolver({ nombre: f.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg', base64: jpg.slice(jpg.indexOf(',') + 1), vista: jpg, tamano: Math.round(jpg.length * 0.75) });
        };
        img.onerror = function () { resolver({ nombre: f.name, base64: dataUrl.slice(dataUrl.indexOf(',') + 1), vista: '', tamano: f.size }); };
        img.src = dataUrl;
      };
      lector.onerror = function () { resolver(null); };
      lector.readAsDataURL(f);
    });
  }
  function subirArchivos(solicitudId, subId, archivos, alAvanzar) {
    var fallidos = 0;
    return archivos.reduce(function (p, a, i) {
      return p.then(function () {
        if (alAvanzar) alAvanzar(i + 1, archivos.length);
        return api('clienteSubirArchivo', { solicitud_id: solicitudId, subsolicitud_id: subId, nombre_archivo: a.nombre, contenido_base64: a.base64 }).then(function (r) { if (!r || !r.ok) fallidos++; });
      });
    }, Promise.resolve()).then(function () { return fallidos; });
  }
  function enviarPedido() {
    var P = S.pedir, s = plantillaActual();
    if (S.ocupado) return;
    S.ocupado = true; P.error = ''; P.progreso = 'Enviando el pedido…'; pintar();
    var datos = { plantilla_id: s.id === 'otra' ? 'otra' : s.id, depto: s.id === 'otra' ? (P.depto || (S.cat.areas[0] || {}).clave) : undefined, datos: P.datos, personas: P.personas,
      trabajadores: P.elegidos, obra_id: P.obra_id || '', motivo: P.motivo || '', texto: P.datos.texto || '', con_archivos: P.fotos.length > 0 };
    api('clienteCrearPedido', datos).then(function (r) {
      if (!r || !r.ok) { S.ocupado = false; P.progreso = ''; P.error = (r && r.message) || 'No se pudo enviar.'; pintar(); return null; }
      P.resultado = r.data;
      return subirArchivos(r.data.solicitud_id, r.data.primer_item, P.fotos, function (i, n) { P.progreso = 'Subiendo archivo ' + i + ' de ' + n + '…'; pintar(); })
        .then(function (fallidos) {
          P.fallidos = fallidos; S.ocupado = false; P.progreso = ''; P.paso = 'listo'; S.dir = 'adelante'; vibrar([20, 50, 40]);
          return Promise.all([refrescarPedidos(), refrescarTrab()]);
        }).then(function () { pintar(); window.scrollTo(0, 0); });
    });
  }
  function descargar(archivoId) {
    toast('Abriendo…');
    api('clienteArchivo', { archivo_id: archivoId }).then(function (r) {
      if (!r || !r.ok) { toast((r && r.message) || 'No se pudo abrir.'); return; }
      var bin = atob(r.data.contenido_base64), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([bytes], { type: r.data.tipo_mime || 'application/octet-stream' }));
      var a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener';
      if (!/^(image\/|application\/pdf)/.test(r.data.tipo_mime || '')) a.download = r.data.nombre || 'archivo';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    });
  }

  // ---------- Eventos ----------
  document.addEventListener('click', function (ev) {
    var t = ev.target, b;
    if (t.closest('[data-cerrar-ayuda]') && (t.hasAttribute('data-cerrar-ayuda') || t.closest('button[data-cerrar-ayuda]'))) { cerrarCapa(); return; }
    if (t.closest('[data-cerrar-capa]') || t.classList.contains('ayuda-fondo')) { cerrarCapa(); return; }
    if (t.closest('[data-ayuda]')) { ayuda(); return; }
    if (t.closest('[data-ir-entrar]')) { S.invitacion = null; history.replaceState(null, '', location.pathname); pintar(); return; }
    if (t.closest('[data-atras]')) { atras(); return; }
    if ((b = t.closest('[data-ir]'))) { var v = b.getAttribute('data-ir'); if (v === 'pedir') S.pedir = null; capa.innerHTML = ''; ir(v); if (v === 'pedidos' || v === 'inicio') refrescarPedidos().then(function () { if (S.vista === v) pintar(); }); return; }
    if ((b = t.closest('[data-area]'))) { nuevoPedir(b.getAttribute('data-area')); return; }
    if ((b = t.closest('[data-plantilla]'))) { S.pedir.plantilla = b.getAttribute('data-plantilla'); S.pedir.paso = 'datos'; S.pedir.personas = [{}]; S.pedir.datos = {}; S.pedir.error = ''; S.dir = 'adelante'; pintar(); window.scrollTo(0, 0); return; }
    if ((b = t.closest('[data-trab]'))) { S.trabId = b.getAttribute('data-trab'); ir('trab', 'adelante'); return; }
    if ((b = t.closest('[data-accion-trab]'))) { nuevoPedir(b.getAttribute('data-accion-area'), b.getAttribute('data-accion-trab'), [S.trabId]); return; }
    if (t.closest('[data-nuevo-contrato]')) { if (plantillasDe('RRHH').some(function (s) { return s.id === 'contrato'; })) nuevoPedir('RRHH', 'contrato'); else toast('Recursos Humanos no está en lo que tienes contratado.'); return; }
    if (t.closest('[data-agregar-trab]')) { formTrabajador(); return; }
    if ((b = t.closest('[data-editar-trab]'))) { formTrabajador(S.trab.filter(function (x) { return x.trabajador_id === b.getAttribute('data-editar-trab'); })[0]); return; }
    if (t.closest('[data-agregar]')) { guardarCampos(); S.pedir.personas.push({}); pintar(); var u = app.querySelectorAll('.persona'); if (u.length) u[u.length - 1].scrollIntoView({ block: 'center' }); return; }
    if ((b = t.closest('[data-quitar]'))) { guardarCampos(); S.pedir.personas.splice(+b.getAttribute('data-quitar'), 1); pintar(); return; }
    if (t.closest('[data-quitar-fotos]')) { S.pedir.fotos = []; pintar(); return; }
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
    if ((b = t.closest('[data-descargar]'))) { descargar(b.getAttribute('data-descargar')); return; }
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
      capa.querySelector('textarea').focus(); return;
    }
    if (t.closest('[data-foto-chat]')) { document.getElementById('f-foto-chat').click(); return; }
    if (t.closest('[data-salir]')) { api('clienteSalir').then(function () { guardarToken(''); S.dentro = false; S.perfil = null; pintar(); }); return; }
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
        cargarTodo().then(function () { S.vista = 'inicio'; pintar(); toast('Entraste. Este ingreso quedó registrado.'); });
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
    if (inp.id === 'f-foto') {
      var fs = [].slice.call(inp.files || []);
      S.pedir.error = ''; S.pedir.progreso = 'Preparando…';
      Promise.all(fs.map(prepararArchivo)).then(function (xs) {
        if (xs.some(function (x) { return !x; })) S.pedir.error = 'Un archivo no se pudo leer. Prueba sacando la foto de nuevo.';
        xs.filter(Boolean).forEach(function (x) {
          if (x.tamano > 10 * 1024 * 1024) S.pedir.error = x.nombre + ' pesa más de 10 MB.';
          else S.pedir.fotos.push(x);
        });
        S.pedir.progreso = ''; pintar();
      });
    } else if (inp.id === 'f-foto-chat') {
      var f0 = (inp.files || [])[0]; if (!f0) return;
      toast('Subiendo…');
      prepararArchivo(f0).then(function (x) {
        if (!x) { toast('No se pudo leer el archivo.'); return; }
        var primer = S.detalle && S.detalle.subsolicitudes[0] ? S.detalle.subsolicitudes[0].subsolicitud_id : '';
        subirArchivos(S.pedido, primer, [x]).then(function (fallidos) {
          if (fallidos) { toast('No se pudo subir. Prueba con otra foto.'); return; }
          api('clienteMensaje', { solicitud_id: S.pedido, texto: 'Te mandé un archivo: ' + x.nombre }).then(function () { toast('Archivo enviado.'); recargarPedido(true); });
        });
      });
    }
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && capa.innerHTML) cerrarCapa(); });

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
    cargarTodo().then(function () { pintar(); });
  }
  arrancar();
})();
