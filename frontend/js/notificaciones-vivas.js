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
 *  - Nivel 1 (siempre funciona): modal grande en pantalla + campana con
 *    contador + parpadeo del titulo de la pestana + sonido -- se ve si SIGSO
 *    esta abierto en alguna pestana, aunque el usuario este en otra.
 *  - Nivel 2 (mejor esfuerzo): toast nativo del sistema operativo via la Web
 *    Notifications API -- se ve aunque el usuario NO este en SIGSO.
 *
 * Pulido v7.1 (Bloque B, B1-B10):
 *  - B1: NO re-anuncia (sonido/modal/toast) al recargar -- guarda la marca de
 *        tiempo de lo ya anunciado en localStorage; lo pendiente reaparece
 *        callado en la campana, no a los gritos.
 *  - B2: campana flotante con contador de no-leidas + panel -- nada se pierde
 *        aunque cierren el modal o se pierdan el toast.
 *  - B3: desbloquea el AudioContext en el primer gesto (el navegador lo
 *        arranca "suspendido" hasta que hay interaccion) -- si no, el primer
 *        sonido -el mas importante- no suena.
 *  - B4: resincroniza al instante al volver a la pestana (visibilitychange/
 *        focus) -- el setInterval en segundo plano lo estrangula el navegador.
 *  - B6: "Cerrar" (posponer) NO marca leida; queda en la campana. Solo el
 *        click en la accion o "descartar" la marca leida.
 *  - B7: rafaga de N notificaciones -> un solo modal-resumen, no N modales.
 *  - B8: preferencia de sonido (silenciar) por dispositivo.
 *  - B9: modal accesible -- Escape, click fuera y foco.
 *  - B10: cierra/reemplaza los toasts del SO para que no se apilen.
 *
 * Limitacion honesta: si el navegador esta CERRADO por completo, no llega
 * nada -- no existe "SIGSO en segundo plano" sin servidor propio de push.
 *
 * Un solo archivo para los dos shells (portal + Backoffice Google): detecta
 * cual bridge de navegacion existe (window.SigsoShell / window.SigsoApp).
 */
(function () {
  var INTERVALO_MS = 150000;   // 2.5 min de polling con sesion activa.
  var VIGILA_SESION_MS = 12000; // chequeo local (sin red) de si ya hay sesion.
  var MAX_TOASTS_SO = 3;        // B10: tope de toasts nativos simultaneos.

  var LLAVE_ULTIMO = 'sigso_notif_ultimo_anuncio'; // B1
  var LLAVE_SONIDO = 'sigso_notif_sonido';         // B8 ('off' = silenciado)

  var estado = {
    pendientes: [],        // todas las no-leidas (para la campana).
    anunciados: {},        // notif_id -> true, ya anunciados en ESTA carga.
    panelAbierto: false,
    sesionActiva: false,
    audioCtx: null,
    audioListo: false,
    toastsVivos: [],       // referencias a Notification del SO (B10).
    parpadeoTimer: null,
    tituloOriginal: document.title
  };

  // ---- utilidades base -------------------------------------------------

  function urlBackoffice_() { return (window.SIGSO_CONFIG || {}).BACKOFFICE_URL; }
  function api_(accion, datos) { return llamarApi(urlBackoffice_(), accion, datos || {}); }

  // La unica pagina donde "sin sesion" es un estado real es el shell del
  // portal ANTES de loguearse (plataforma.html tiene 'vista-login'). Si ese
  // elemento no existe, es app.html (Backoffice Google): siempre hay sesion.
  function haySesion_() {
    if (!document.getElementById('vista-login')) return true;
    try { return !!localStorage.getItem('sigso_portal_token'); } catch (err) { return false; }
  }

  function claveDispositivo_(base) {
    var tok = '';
    try { tok = localStorage.getItem('sigso_portal_token') || ''; } catch (err) { /* sin storage */ }
    return base + (tok ? ':' + tok.slice(0, 8) : '');
  }
  function leerUltimoAnuncio_() {
    try { return Number(localStorage.getItem(claveDispositivo_(LLAVE_ULTIMO))) || 0; } catch (err) { return 0; }
  }
  function guardarUltimoAnuncio_(ts) {
    try { localStorage.setItem(claveDispositivo_(LLAVE_ULTIMO), String(ts)); } catch (err) { /* sin storage */ }
  }
  function sonidoActivo_() {
    try { return localStorage.getItem(LLAVE_SONIDO) !== 'off'; } catch (err) { return true; }
  }
  function setSonido_(activo) {
    try { localStorage.setItem(LLAVE_SONIDO, activo ? 'on' : 'off'); } catch (err) { /* sin storage */ }
  }

  function escaparHtml_(valor) {
    var div = document.createElement('div');
    div.textContent = String(valor === undefined || valor === null ? '' : valor);
    return div.innerHTML;
  }

  function relativo_(iso) {
    if (!iso) return '';
    var ms = Date.now() - new Date(iso).getTime();
    var min = Math.floor(ms / 60000);
    if (min < 1) return 'recién';
    if (min < 60) return 'hace ' + min + ' min';
    var h = Math.floor(min / 60);
    if (h < 24) return 'hace ' + h + ' h';
    return 'hace ' + Math.floor(h / 24) + ' d';
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
    // Optimista: sacar de la lista local ya, y avisar al backend.
    estado.pendientes = estado.pendientes.filter(function (n) { return n.notif_id !== notifId; });
    cerrarToastSO_(notifId);
    renderCampana_();
    api_('marcarNotificacionAppLeida', { notif_id: notifId }).catch(function () { /* best-effort */ });
  }

  function marcarTodas_() {
    estado.pendientes = [];
    estado.toastsVivos.forEach(function (t) { try { t.close(); } catch (e) { /* noop */ } });
    estado.toastsVivos = [];
    renderCampana_();
    detenerParpadeo_();
    api_('marcarTodasNotificacionesAppLeidas', {}).catch(function () { /* best-effort */ });
  }

  // ---- Nivel 1: parpadeo del titulo -----------------------------------

  function refrescarParpadeo_() {
    var total = estado.pendientes.length;
    if (!total) { detenerParpadeo_(); return; }
    if (estado.parpadeoTimer) return; // ya parpadeando
    var alterna = false;
    estado.parpadeoTimer = setInterval(function () {
      alterna = !alterna;
      document.title = alterna
        ? '(' + estado.pendientes.length + ') ¡Atención! — SIGSO'
        : estado.tituloOriginal;
    }, 1000);
  }
  function detenerParpadeo_() {
    if (estado.parpadeoTimer) { clearInterval(estado.parpadeoTimer); estado.parpadeoTimer = null; }
    document.title = estado.tituloOriginal;
  }

  // ---- Nivel 1: sonido (B3, desbloqueo por gesto) ----------------------

  function prepararAudio_() {
    if (estado.audioListo) return;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      estado.audioCtx = estado.audioCtx || new Ctx();
      if (estado.audioCtx.state === 'suspended') estado.audioCtx.resume();
      estado.audioListo = true;
    } catch (err) { /* audio no disponible */ }
  }

  function reproducirSonido_() {
    if (!sonidoActivo_() || !estado.audioCtx) return;
    try {
      if (estado.audioCtx.state === 'suspended') estado.audioCtx.resume();
      var osc = estado.audioCtx.createOscillator();
      var gain = estado.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, estado.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, estado.audioCtx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(estado.audioCtx.destination);
      osc.start();
      osc.stop(estado.audioCtx.currentTime + 0.35);
    } catch (err) { /* autoplay bloqueado -- no es critico, el modal igual sale */ }
  }

  // ---- Nivel 2: toasts del SO (B10, con referencias y tope) ------------

  function pedirPermisoAlPrimerGesto_() {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'default') return;
    var pedir = function () {
      document.removeEventListener('click', pedir);
      document.removeEventListener('keydown', pedir);
      try { Notification.requestPermission(); } catch (e) { /* noop */ }
    };
    document.addEventListener('click', pedir, { once: true });
    document.addEventListener('keydown', pedir, { once: true });
  }

  function cerrarToastSO_(notifId) {
    estado.toastsVivos = estado.toastsVivos.filter(function (t) {
      if (t._notifId === notifId) { try { t.close(); } catch (e) { /* noop */ } return false; }
      return true;
    });
  }

  function mostrarToastSO_(notif) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    // B10: si ya hay demasiados vivos, cierra el mas viejo antes de abrir otro.
    while (estado.toastsVivos.length >= MAX_TOASTS_SO) {
      var viejo = estado.toastsVivos.shift();
      try { viejo.close(); } catch (e) { /* noop */ }
    }
    try {
      var toast = new Notification(notif.titulo || 'SIGSO', {
        body: notif.mensaje || '',
        requireInteraction: true,
        tag: notif.notif_id
      });
      toast._notifId = notif.notif_id;
      toast.onclick = function () {
        window.focus();
        marcarLeida_(notif.notif_id);
        irAModulo_(notif.modulo_id);
        toast.close();
      };
      toast.onclose = function () {
        estado.toastsVivos = estado.toastsVivos.filter(function (t) { return t !== toast; });
      };
      estado.toastsVivos.push(toast);
    } catch (err) { /* algunos SO bloquean silenciosamente -- el modal Nivel 1 igual se muestra */ }
  }

  function toastResumenSO_(cantidad) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      var toast = new Notification('SIGSO', {
        body: 'Tienes ' + cantidad + ' notificaciones nuevas.',
        requireInteraction: true,
        tag: 'sigso-resumen'
      });
      toast.onclick = function () { window.focus(); abrirPanel_(); toast.close(); };
      estado.toastsVivos.push(toast);
    } catch (err) { /* noop */ }
  }

  // ---- Nivel 1: modal (B7 rafaga, B9 accesible) ------------------------

  function modalIndividual_(notif) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo sigso-notifviva-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-notifviva" role="alertdialog" aria-modal="true" aria-labelledby="sigso-notifviva-titulo">' +
        '<h3 class="sigso-modal__titulo" id="sigso-notifviva-titulo">' + escaparHtml_(notif.titulo || 'Notificación') + '</h3>' +
        (notif.mensaje ? '<p class="sigso-modal__mensaje">' + escaparHtml_(notif.mensaje) + '</p>' : '') +
        '<div class="sigso-modal__acciones">' +
          '<button type="button" class="sigso-boton sigso-boton--sutil js-notif-cerrar">Cerrar</button>' +
          (notif.modulo_id
            ? '<button type="button" class="sigso-boton js-notif-ir">' + escaparHtml_(notif.texto_accion || 'Ver') + '</button>'
            : '') +
        '</div>' +
      '</div>';
    montarModal_(fondo, function accion() {
      marcarLeida_(notif.notif_id);
      irAModulo_(notif.modulo_id);
    });
  }

  function modalResumen_(cantidad) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo sigso-notifviva-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-notifviva" role="alertdialog" aria-modal="true" aria-labelledby="sigso-notifviva-titulo">' +
        '<h3 class="sigso-modal__titulo" id="sigso-notifviva-titulo">Tienes ' + cantidad + ' notificaciones nuevas</h3>' +
        '<p class="sigso-modal__mensaje">Ábrelas desde la campana para revisarlas una por una.</p>' +
        '<div class="sigso-modal__acciones">' +
          '<button type="button" class="sigso-boton sigso-boton--sutil js-notif-cerrar">Cerrar</button>' +
          '<button type="button" class="sigso-boton js-notif-ir">Ver notificaciones</button>' +
        '</div>' +
      '</div>';
    montarModal_(fondo, abrirPanel_);
  }

  // B6: "Cerrar" (el velo, Escape o el boton Cerrar) solo cierra el modal --
  // NO marca leida; la notificacion sigue en la campana. Solo `onAccion`
  // (click en el boton de accion) marca leida / navega.
  function montarModal_(fondo, onAccion) {
    function cerrar() {
      document.removeEventListener('keydown', alTeclado);
      if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
    }
    function alTeclado(ev) { if (ev.key === 'Escape') cerrar(); }
    fondo.querySelector('.js-notif-cerrar').addEventListener('click', cerrar);
    var btnIr = fondo.querySelector('.js-notif-ir');
    if (btnIr) btnIr.addEventListener('click', function () { cerrar(); onAccion(); });
    fondo.addEventListener('click', function (ev) { if (ev.target === fondo) cerrar(); }); // click fuera
    document.addEventListener('keydown', alTeclado);
    document.body.appendChild(fondo);
    var foco = btnIr || fondo.querySelector('.js-notif-cerrar');
    if (foco) foco.focus();
  }

  // ---- B2: campana flotante + panel -----------------------------------

  var ICONO_CAMPANA = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>';

  function asegurarCampana_() {
    if (document.getElementById('sigso-notif-campana')) return;

    var boton = document.createElement('button');
    boton.id = 'sigso-notif-campana';
    boton.type = 'button';
    boton.setAttribute('aria-label', 'Notificaciones');
    boton.style.cssText = [
      'position:fixed', 'right:20px', 'bottom:20px', 'z-index:9998',
      'width:52px', 'height:52px', 'border-radius:50%', 'border:none', 'cursor:pointer',
      'background:var(--primario,#6D5DF6)', 'color:#fff',
      'box-shadow:0 6px 18px rgba(0,0,0,0.22)', 'display:none',
      'align-items:center', 'justify-content:center'
    ].join(';');
    boton.innerHTML = ICONO_CAMPANA + '<span id="sigso-notif-badge" style="' + [
      'position:absolute', 'top:-4px', 'right:-4px', 'min-width:20px', 'height:20px',
      'padding:0 5px', 'border-radius:10px', 'background:var(--alerta,#E5484D)', 'color:#fff',
      'font:700 12px/20px Arial,sans-serif', 'text-align:center', 'display:none'
    ].join(';') + '"></span>';
    boton.addEventListener('click', togglePanel_);
    document.body.appendChild(boton);

    var panel = document.createElement('div');
    panel.id = 'sigso-notif-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Panel de notificaciones');
    panel.style.cssText = [
      'position:fixed', 'right:20px', 'bottom:80px', 'z-index:9999',
      'width:340px', 'max-width:calc(100vw - 40px)', 'max-height:70vh', 'overflow:hidden',
      'display:none', 'flex-direction:column',
      'background:var(--superficie,#fff)', 'color:var(--texto,#0F172A)',
      'border:1px solid var(--borde,#E5E8EF)', 'border-radius:12px',
      'box-shadow:0 12px 32px rgba(0,0,0,0.24)'
    ].join(';');
    document.body.appendChild(panel);
  }

  function togglePanel_() { estado.panelAbierto ? cerrarPanel_() : abrirPanel_(); }
  function abrirPanel_() {
    asegurarCampana_();
    estado.panelAbierto = true;
    document.getElementById('sigso-notif-panel').style.display = 'flex';
    renderCampana_();
  }
  function cerrarPanel_() {
    estado.panelAbierto = false;
    var p = document.getElementById('sigso-notif-panel');
    if (p) p.style.display = 'none';
  }

  function renderCampana_() {
    var boton = document.getElementById('sigso-notif-campana');
    if (!boton) return;
    boton.style.display = estado.sesionActiva ? 'inline-flex' : 'none';

    var badge = document.getElementById('sigso-notif-badge');
    var n = estado.pendientes.length;
    if (badge) {
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.style.display = n ? 'block' : 'none';
    }

    if (!estado.panelAbierto) return;
    var panel = document.getElementById('sigso-notif-panel');
    var mudo = !sonidoActivo_();
    var cabecera =
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--borde,#E5E8EF)">' +
        '<strong style="font:600 15px Arial,sans-serif">Notificaciones</strong>' +
        '<span>' +
          '<button type="button" class="js-notif-mute" title="' + (mudo ? 'Activar sonido' : 'Silenciar') + '" style="background:none;border:none;cursor:pointer;font-size:16px;padding:4px">' + (mudo ? '🔕' : '🔔') + '</button>' +
          (n ? '<button type="button" class="js-notif-todas" style="background:none;border:none;cursor:pointer;color:var(--primario,#6D5DF6);font:600 12px Arial,sans-serif;padding:4px">Marcar todas</button>' : '') +
        '</span>' +
      '</div>';

    var cuerpo;
    if (!n) {
      cuerpo = '<div style="padding:28px 14px;text-align:center;color:var(--texto-2,#8A93A5);font:14px Arial,sans-serif">Sin notificaciones</div>';
    } else {
      cuerpo = '<div style="overflow-y:auto">' + estado.pendientes.map(function (notif) {
        return '<div style="padding:12px 14px;border-bottom:1px solid var(--borde,#EEF1F6)">' +
          '<div style="display:flex;justify-content:space-between;gap:8px">' +
            '<strong style="font:600 14px Arial,sans-serif">' + escaparHtml_(notif.titulo || '') + '</strong>' +
            '<span style="color:var(--texto-2,#8A93A5);font:12px Arial,sans-serif;white-space:nowrap">' + escaparHtml_(relativo_(notif.creada_en)) + '</span>' +
          '</div>' +
          (notif.mensaje ? '<div style="margin-top:2px;color:var(--texto-2,#5b6472);font:13px Arial,sans-serif">' + escaparHtml_(notif.mensaje) + '</div>' : '') +
          '<div style="margin-top:8px;display:flex;gap:12px">' +
            (notif.modulo_id ? '<button type="button" class="js-notif-item-ir" data-id="' + escaparHtml_(notif.notif_id) + '" data-mod="' + escaparHtml_(notif.modulo_id) + '" style="background:none;border:none;cursor:pointer;color:var(--primario,#6D5DF6);font:600 13px Arial,sans-serif;padding:0">' + escaparHtml_(notif.texto_accion || 'Ver') + '</button>' : '') +
            '<button type="button" class="js-notif-item-leida" data-id="' + escaparHtml_(notif.notif_id) + '" style="background:none;border:none;cursor:pointer;color:var(--texto-2,#8A93A5);font:13px Arial,sans-serif;padding:0">Marcar leída</button>' +
          '</div>' +
        '</div>';
      }).join('') + '</div>';
    }

    panel.innerHTML = cabecera + cuerpo;

    panel.querySelector('.js-notif-mute').addEventListener('click', function () {
      setSonido_(!sonidoActivo_()); renderCampana_();
    });
    var btnTodas = panel.querySelector('.js-notif-todas');
    if (btnTodas) btnTodas.addEventListener('click', marcarTodas_);
    panel.querySelectorAll('.js-notif-item-ir').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-id');
        irAModulo_(b.getAttribute('data-mod'));
        marcarLeida_(id);
        cerrarPanel_();
      });
    });
    panel.querySelectorAll('.js-notif-item-leida').forEach(function (b) {
      b.addEventListener('click', function () { marcarLeida_(b.getAttribute('data-id')); });
    });
  }

  // ---- procesamiento del poll -----------------------------------------

  function procesar_(notificaciones) {
    estado.pendientes = notificaciones.slice().sort(function (a, b) {
      return new Date(b.creada_en) - new Date(a.creada_en);
    });

    var ultimo = leerUltimoAnuncio_();
    // B1: "nuevas para anunciar" = creadas despues del ultimo anuncio Y no
    // anunciadas ya en esta carga. Lo demas (pendiente pero ya visto) solo se
    // refleja callado en la campana.
    var nuevas = estado.pendientes.filter(function (n) {
      var ts = new Date(n.creada_en).getTime();
      return ts > ultimo && !estado.anunciados[n.notif_id];
    });

    renderCampana_();
    refrescarParpadeo_();

    if (!nuevas.length) return;

    var maxTs = ultimo;
    nuevas.forEach(function (n) {
      estado.anunciados[n.notif_id] = true;
      var ts = new Date(n.creada_en).getTime();
      if (ts > maxTs) maxTs = ts;
    });
    guardarUltimoAnuncio_(maxTs);

    reproducirSonido_();

    // B7: 1 nueva -> modal + toast individual. 2+ -> un modal-resumen y un
    // solo toast-resumen del SO (no N modales ni N toasts apilados).
    if (nuevas.length === 1) {
      modalIndividual_(nuevas[0]);
      mostrarToastSO_(nuevas[0]);
    } else {
      modalResumen_(nuevas.length);
      toastResumenSO_(nuevas.length);
    }
  }

  function sincronizar_() {
    if (!haySesion_()) { estado.sesionActiva = false; renderCampana_(); return; }
    estado.sesionActiva = true;
    asegurarCampana_();
    renderCampana_();
    api_('sincronizarNotificacionesApp', {}).then(function (resp) {
      if (resp && resp.ok && resp.data && resp.data.notificaciones) {
        procesar_(resp.data.notificaciones);
      }
    }).catch(function () { /* best-effort -- el proximo tick reintenta */ });
  }

  // ---- arranque + resync (B4) -----------------------------------------

  function iniciar_() {
    pedirPermisoAlPrimerGesto_();
    // B3: desbloquea el audio en el primer gesto real del usuario.
    var desbloquear = function () {
      prepararAudio_();
      document.removeEventListener('click', desbloquear);
      document.removeEventListener('keydown', desbloquear);
    };
    document.addEventListener('click', desbloquear);
    document.addEventListener('keydown', desbloquear);

    sincronizar_();
    setInterval(sincronizar_, INTERVALO_MS);

    // B4: el setInterval en segundo plano lo estrangula el navegador y se
    // congela con el equipo suspendido -- resync inmediato al volver.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') sincronizar_();
    });
    window.addEventListener('focus', sincronizar_);

    // Portal: la sesion aparece DESPUES del login sin recargar la pagina.
    // Vigilancia local barata (sin red): al detectar que ya hay sesion,
    // dispara una sincronizacion inmediata en vez de esperar 2.5 min.
    setInterval(function () {
      var hay = haySesion_();
      if (hay && !estado.sesionActiva) sincronizar_();
      if (!hay && estado.sesionActiva) { estado.sesionActiva = false; renderCampana_(); }
    }, VIGILA_SESION_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar_);
  } else {
    iniciar_();
  }
})();
