/**
 * notificaciones-vivas.js — v7.1: canal de notificaciones "en vivo",
 * transversal a todo SIGSO (documentacion/SIGSO-v7.1-notificaciones-
 * vivas.md). Nace del feedback real de Pausas activas: "les llega correo y
 * esta bien, pero hay casos que no revisan el correo" -- este modulo es el
 * "espejo" en pantalla de lo que el backend ya encola con
 * encolarNotificacionApp_ (Notificaciones.gs) cada vez que manda un correo
 * relevante.
 *
 * Arquitectura (2 niveles, sin infraestructura nueva -- Apps Script no tiene
 * push server, asi que esto es polling, no push real):
 *  - Nivel 1 (siempre funciona): modal grande en pantalla + titulo/favicon
 *    parpadeando + sonido -- se ve si SIGSO esta abierto en alguna pestana,
 *    aunque el usuario este en otra pestana del navegador.
 *  - Nivel 2 (mejor esfuerzo): toast nativo del sistema operativo via la Web
 *    Notifications API, con requireInteraction para que no desaparezca solo.
 *    Requiere permiso del usuario (se pide en el primer clic real, nunca
 *    solo, porque el navegador ignora/bloquea el permiso pedido sin gesto).
 *
 * Limitacion honesta (documentada, no oculta): si el usuario cierra POR
 * COMPLETO el navegador (no solo la pestana), no llega nada -- no existe un
 * "SIGSO corriendo en segundo plano" sin servidor propio. Por eso el plan de
 * adopcion sigue pidiendo dejar SIGSO abierto en una pestana.
 *
 * Un solo archivo para los dos shells (igual criterio que dashboard.js/
 * detalle.js/novedades.js): detecta cual bridge de navegacion existe
 * (window.SigsoShell en el portal, window.SigsoApp en el Backoffice Google)
 * y lo usa al hacer clic en una notificacion.
 */
(function () {
  var INTERVALO_MS = 150000; // 2.5 min -- balance entre "se siente vivo" y cuota de Apps Script.
  var vistos_ = {}; // notif_id -> true, ya mostrados EN ESTA CARGA de pagina.
  var colaModales_ = [];
  var modalAbierto_ = false;
  var parpadeoTimer_ = null;
  var tituloOriginal_ = document.title;
  var faviconOriginal_ = null;
  var permisoPedido_ = false;

  function urlBackoffice_() {
    return (window.SIGSO_CONFIG || {}).BACKOFFICE_URL;
  }

  function api_(accion, datos) {
    return llamarApi(urlBackoffice_(), accion, datos || {});
  }

  // v7.1: la unica pagina donde "sin sesion" es un estado real y esperado es
  // el shell del portal ANTES de loguearse (plataforma.html renderiza
  // 'vista-login'). Si ese elemento no existe, estamos en app.html
  // (Backoffice Google) -- ahi SIEMPRE hay sesion si la pagina cargo, sea
  // que la llamada real viaje por google.script.run (produccion, HtmlService)
  // o por fetch sin token (dev-server local): no hay forma client-side de
  // distinguir "sin Google.script" de "sin sesion", asi que no se intenta.
  function haySesion_() {
    if (!document.getElementById('vista-login')) return true;
    try { return !!localStorage.getItem('sigso_portal_token'); } catch (err) { return false; }
  }

  function irAModulo_(moduloId) {
    if (!moduloId) return;
    if (window.SigsoShell && typeof window.SigsoShell.irAModulo === 'function') {
      window.SigsoShell.irAModulo(moduloId);
    } else if (window.SigsoApp && typeof window.SigsoApp.irAModulo === 'function') {
      window.SigsoApp.irAModulo(moduloId);
    }
  }

  function marcarLeida_(notifId) {
    api_('marcarNotificacionAppLeida', { notif_id: notifId }).catch(function () { /* best-effort */ });
  }

  // ---- Nivel 1: parpadeo de titulo + favicon mientras haya pendientes -----

  function favicon_() {
    if (!faviconOriginal_) {
      faviconOriginal_ = document.querySelector('link[rel~="icon"]');
    }
    return faviconOriginal_;
  }

  function iniciarParpadeo_(total) {
    detenerParpadeo_();
    var mostrandoAlerta = false;
    var href = favicon_() ? favicon_().href : null;
    parpadeoTimer_ = setInterval(function () {
      mostrandoAlerta = !mostrandoAlerta;
      document.title = mostrandoAlerta
        ? '(' + total + ') ¡Atención! — SIGSO'
        : tituloOriginal_;
    }, 1000);
  }

  function detenerParpadeo_() {
    if (parpadeoTimer_) {
      clearInterval(parpadeoTimer_);
      parpadeoTimer_ = null;
    }
    document.title = tituloOriginal_;
  }

  // ---- Nivel 1: sonido corto sintetizado (sin agregar un .mp3 al repo) ----

  function reproducirSonido_() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch (err) { /* audio no disponible (autoplay bloqueado, etc.) -- no es critico */ }
  }

  // ---- Nivel 1: modal grande, uno a la vez (cola si llegan varias juntas) --

  function encolarModal_(notif) {
    colaModales_.push(notif);
    if (!modalAbierto_) mostrarSiguienteModal_();
  }

  function mostrarSiguienteModal_() {
    var notif = colaModales_.shift();
    if (!notif) { modalAbierto_ = false; return; }
    modalAbierto_ = true;

    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo sigso-notifviva-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-notifviva" role="alertdialog" aria-modal="true" aria-labelledby="sigso-notifviva-titulo">' +
        '<h3 class="sigso-modal__titulo" id="sigso-notifviva-titulo">' + escaparHtml_(notif.titulo || 'Notificación') + '</h3>' +
        (notif.mensaje ? '<p class="sigso-modal__mensaje">' + escaparHtml_(notif.mensaje) + '</p>' : '') +
        '<div class="sigso-modal__acciones">' +
          Componentes.boton({ texto: 'Cerrar', variante: 'sutil', clase: 'js-notifviva-cerrar' }) +
          (notif.modulo_id
            ? Componentes.boton({ texto: notif.texto_accion || 'Ver', clase: 'js-notifviva-ir' })
            : '') +
        '</div>' +
      '</div>';

    function cerrar(navegar) {
      if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
      marcarLeida_(notif.notif_id);
      if (navegar) irAModulo_(notif.modulo_id);
      mostrarSiguienteModal_();
      if (!colaModales_.length) detenerParpadeo_();
    }
    fondo.querySelector('.js-notifviva-cerrar').addEventListener('click', function () { cerrar(false); });
    var btnIr = fondo.querySelector('.js-notifviva-ir');
    if (btnIr) btnIr.addEventListener('click', function () { cerrar(true); });

    document.body.appendChild(fondo);
  }

  function escaparHtml_(valor) {
    var div = document.createElement('div');
    div.textContent = String(valor === undefined || valor === null ? '' : valor);
    return div.innerHTML;
  }

  // ---- Nivel 2: toast nativo del sistema operativo ------------------------

  function pedirPermisoAlPrimerGesto_() {
    if (permisoPedido_ || typeof Notification === 'undefined') return;
    if (Notification.permission !== 'default') { permisoPedido_ = true; return; }
    var pedir = function () {
      permisoPedido_ = true;
      document.removeEventListener('click', pedir);
      document.removeEventListener('keydown', pedir);
      Notification.requestPermission();
    };
    document.addEventListener('click', pedir, { once: true });
    document.addEventListener('keydown', pedir, { once: true });
  }

  function mostrarToastNativo_(notif) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      var toast = new Notification(notif.titulo || 'SIGSO', {
        body: notif.mensaje || '',
        requireInteraction: true,
        tag: notif.notif_id // evita duplicar si el navegador vuelve a renderizar
      });
      toast.onclick = function () {
        window.focus();
        marcarLeida_(notif.notif_id);
        irAModulo_(notif.modulo_id);
        toast.close();
      };
    } catch (err) { /* algunos navegadores/SO bloquean silenciosamente -- el modal Nivel 1 igual se muestra */ }
  }

  // ---- Polling --------------------------------------------------------

  function procesarNuevas_(notificaciones) {
    var nuevas = notificaciones.filter(function (n) { return !vistos_[n.notif_id]; });
    if (!nuevas.length) return;
    nuevas.forEach(function (n) {
      vistos_[n.notif_id] = true;
      encolarModal_(n);
      mostrarToastNativo_(n);
    });
    reproducirSonido_();
    iniciarParpadeo_(notificaciones.length);
  }

  function sincronizar_() {
    if (!haySesion_()) return;
    api_('sincronizarNotificacionesApp', {}).then(function (resp) {
      if (resp && resp.ok && resp.data && resp.data.notificaciones) {
        procesarNuevas_(resp.data.notificaciones);
      }
    }).catch(function () { /* best-effort -- el proximo tick reintenta */ });
  }

  function iniciar_() {
    pedirPermisoAlPrimerGesto_();
    sincronizar_();
    setInterval(sincronizar_, INTERVALO_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar_);
  } else {
    iniciar_();
  }
})();
