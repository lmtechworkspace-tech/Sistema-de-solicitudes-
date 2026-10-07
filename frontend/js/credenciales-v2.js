/**
 * credenciales-v2.js — bóveda de credenciales de la empresa (2026-10-07;
 * backend/logica/credenciales.js).
 *
 * La ven el super admin y quien tenga acceso a alguna categoría (la sesión
 * trae `cuenta.credenciales === true`). La lista —plataforma, usuario, quién
 * tiene acceso, verificación en dos pasos, cuándo se cambió la clave— se ve
 * con la sesión de SIGSO; VER, crear o cambiar una clave pide abrir la bóveda
 * con el código de Google Authenticator (se cierra sola a los 15 min).
 *
 * Expone `SigsoCredenciales.montar(el, { categoria })`, que usa Hompy para su
 * sección «Redes sociales», y `abrirBoveda()`, que hace de candado en ambos.
 */
(function () {
  'use strict';

  var U = UIv2;
  var LLAVE_TOKEN = 'sigso_cred_boveda';
  var LLAVE_EQUIPO = 'sigso_fin_equipo';
  var QR_SRC = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
  var QR_SRI = 'sha384-8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k';
  var ROL = { ADMINISTRA: 'Administra', EDITA: 'Edita', PUBLICA: 'Publica', CONSULTA: 'Consulta' };
  var CADA = { 0: 'No se cambia', 30: 'Cada mes', 90: 'Cada 3 meses', 180: 'Cada 6 meses', 365: 'Cada año' };
  var MARCAS = [
    [/facebook|meta/i, '#1877F2', 'f'], [/instagram/i, '#D62976', 'ig'], [/tiktok/i, '#111111', 'tt'], [/linkedin/i, '#0A66C2', 'in'],
    [/youtube/i, '#E00000', 'yt'], [/whatsapp/i, '#1FA855', 'wa'], [/^x$|twitter/i, '#111111', 'x'], [/google|gmail/i, '#4285F4', 'g'],
    [/sii/i, '#0B4F8A', 'sii'], [/tgr|tesorer/i, '#7A1F2B', 'tgr'], [/previred/i, '#00838F', 'pr']
  ];
  var ACCIONES = {
    ENTRAR: ['Abrió la bóveda', 'ok'], SALIR: ['Cerró la bóveda', 'neutro'], CODIGO_INCORRECTO: ['Código incorrecto', 'alerta'],
    AUTENTICADOR_PREPARADO: ['Generó la clave del autenticador', 'info'], AUTENTICADOR_ACTIVADO: ['Activó su autenticador', 'ok'],
    AUTENTICADOR_CLAVE_INCORRECTA: ['Contraseña incorrecta al registrar', 'alerta'], VER_CLAVE: ['Vio una clave', 'alerta'],
    CREAR: ['Agregó una credencial', 'ok'], EDITAR: ['Editó una credencial', 'info'], CAMBIAR_CLAVE: ['Cambió una clave', 'ok'],
    MOVER: ['Cambió de categoría', 'info'], RETIRAR: ['Retiró una credencial', 'alerta'], REACTIVAR: ['Reactivó una credencial', 'info'],
    CREAR_CATEGORIA: ['Creó una categoría', 'info'], EDITAR_CATEGORIA: ['Editó una categoría', 'info'],
    DAR_ACCESO: ['Dio acceso', 'ok'], QUITAR_ACCESO: ['Quitó acceso', 'alerta'], VER_BITACORA: ['Revisó la bitácora', 'neutro']
  };

  var raiz_ = null, vista_ = 'cuentas', cat_ = '', d_ = null, turno_ = 0, reloj_ = null, ultimoUso_ = 0, inactividad_ = 15, verRetiradas_ = false;
  var montados_ = []; // vistas incrustadas (Hompy) que se repintan al guardar

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function aviso(t, tipo) { if (window.Componentes && Componentes.aviso) Componentes.aviso({ texto: t, tipo: tipo || 'info' }); }
  function token() { try { return sessionStorage.getItem(LLAVE_TOKEN) || ''; } catch (e) { return ''; } }
  function guardarToken(t) { try { if (t) sessionStorage.setItem(LLAVE_TOKEN, t); else sessionStorage.removeItem(LLAVE_TOKEN); } catch (e) { /* sin storage */ } pintarPildora(); }
  function equipo() {
    try {
      var e = localStorage.getItem(LLAVE_EQUIPO);
      if (!e) { e = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/[^\w-]/g, ''); localStorage.setItem(LLAVE_EQUIPO, e); }
      return e;
    } catch (err) { return 'sin-almacenamiento'; }
  }
  function api(accion, datos) {
    var d = Object.assign({ equipo: equipo(), boveda_token: token() }, datos || {});
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, accion, d).then(function (r) {
      if (r && r.boveda_cerrada) guardarToken('');
      else if (r && r.ok && d.boveda_token) ultimoUso_ = Date.now();
      return r;
    }).catch(function (e) { return { ok: false, message: (e && e.message) || 'No se pudo conectar.' }; });
  }
  /** Llama una acción que necesita la bóveda: la abre antes si hace falta y reintenta una vez si se cerró. */
  function conBoveda(accion, datos) {
    var antes = token() ? Promise.resolve(true) : abrirBoveda();
    return antes.then(function (ok) {
      if (!ok) return { ok: false, message: 'La bóveda sigue cerrada.', cancelado: true };
      return api(accion, datos).then(function (r) {
        if (!r || !r.boveda_cerrada) return r;
        return abrirBoveda().then(function (ok2) { return ok2 ? api(accion, datos) : r; });
      });
    });
  }
  function fecha(iso) { return iso ? String(iso).slice(0, 10).split('-').reverse().join('-') : ''; }
  function fechaHora(iso) {
    if (!iso) return '';
    return new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  }
  function hoy() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
  function marca(plataforma) {
    for (var i = 0; i < MARCAS.length; i++) if (MARCAS[i][0].test(plataforma)) return { color: MARCAS[i][1], sigla: MARCAS[i][2] };
    return { color: '', sigla: U.iniciales(String(plataforma).replace(/[^\p{L}\p{N}\s]/gu, ' ')).slice(0, 2).toLowerCase() };
  }
  function categoria(id) { return ((d_ && d_.categorias) || []).filter(function (c) { return c.id === id; })[0] || { id: id, nombre: id, icono: 'llave' }; }
  function copiar(texto, que) {
    var listo = function () { aviso((que || 'Texto') + ' copiado. Se borrará del portapapeles en 30 segundos.', 'exito'); setTimeout(function () { try { navigator.clipboard.writeText(''); } catch (e) { /* nada */ } }, 30000); };
    try { navigator.clipboard.writeText(texto).then(listo, function () { aviso('No se pudo copiar. Selecciónalo y cópialo a mano.', 'alerta'); }); }
    catch (e) { aviso('No se pudo copiar. Selecciónalo y cópialo a mano.', 'alerta'); }
  }

  // --- El candado: abrir la bóveda (y registrar el autenticador la primera vez) --------------
  function casillas() {
    var h = '<div class="fin2-digitos cr2-digitos" role="group" aria-label="Código de 6 dígitos">';
    for (var i = 0; i < 6; i++) h += '<input class="fin2-digito" inputmode="numeric" autocomplete="one-time-code" aria-label="Dígito ' + (i + 1) + '" data-i="' + i + '">';
    return h + '</div>';
  }
  function modal(html) {
    var el = document.createElement('div');
    el.className = 'sx2 sx2-dialogo cr2-modal';
    el.innerHTML = '<div class="sx2-drawer__telon js-cr-cerrar"></div><div class="sx2-dialogo__caja cr2-modal__caja" role="dialog" aria-modal="true">' + html + '</div>';
    document.body.appendChild(el);
    return el;
  }
  function enlazarCasillas(el, alCompletar) {
    el.addEventListener('input', function (ev) {
      var i = ev.target;
      if (!i.classList.contains('fin2-digito')) return;
      var v = i.value.replace(/\D/g, ''), todas = el.querySelectorAll('.fin2-digito');
      if (v.length > 1) {
        var desde = v.length >= 6 ? 0 : Number(i.dataset.i) || 0;
        v.slice(0, 6 - desde).split('').forEach(function (dd, k) { if (todas[desde + k]) todas[desde + k].value = dd; });
        var ult = todas[Math.min(desde + v.length, 6) - 1]; if (ult) ult.focus();
      } else { i.value = v; if (v && i.nextElementSibling) i.nextElementSibling.focus(); }
      var cod = Array.prototype.map.call(todas, function (x) { return x.value; }).join('');
      if (cod.length === 6) alCompletar(cod);
    });
    el.addEventListener('keydown', function (ev) {
      var i = ev.target;
      if (i.classList && i.classList.contains('fin2-digito') && ev.key === 'Backspace' && !i.value && i.previousElementSibling) i.previousElementSibling.focus();
    });
  }
  function limpiarCasillas(el, msg) {
    var c = el.querySelectorAll('.fin2-digito');
    Array.prototype.forEach.call(c, function (i) { i.value = ''; });
    if (c[0]) c[0].focus();
    var e = el.querySelector('.js-cr-err'); if (e) e.textContent = msg || '';
    var caja = el.querySelector('.fin2-digitos'); if (caja) { caja.classList.remove('fin2-sacude'); void caja.offsetWidth; caja.classList.add('fin2-sacude'); }
  }
  function cargarLibQr() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    return new Promise(function (ok, mal) {
      var s = document.createElement('script');
      s.src = QR_SRC; s.integrity = QR_SRI; s.crossOrigin = 'anonymous';
      s.onload = function () { window.qrcode ? ok(window.qrcode) : mal(); };
      s.onerror = mal;
      document.head.appendChild(s);
    });
  }

  var abriendo_ = null;
  /** Devuelve Promise<boolean>: true si la bóveda quedó abierta. */
  function abrirBoveda() {
    if (token()) return Promise.resolve(true);
    if (abriendo_) return abriendo_;
    abriendo_ = api('credEstado').then(function (r) {
      return new Promise(function (resolver) {
        var el, terminado = false;
        function fin(ok) {
          if (terminado) return; terminado = true;
          document.removeEventListener('keydown', esc);
          if (el && el.parentNode) el.parentNode.removeChild(el);
          abriendo_ = null; resolver(ok);
        }
        function esc(ev) { if (ev.key === 'Escape') fin(false); }
        document.addEventListener('keydown', esc);
        var cerrar = U.boton({ variante: 'fantasma', soloIcono: true, icono: 'equis', titulo: 'Cerrar', clase: 'js-cr-cerrar cr2-modal__x' });
        if (!r || !r.ok) {
          el = modal(cerrar + '<span class="cr2-modal__ico">' + U.ico('alerta', 26) + '</span><h2 class="sx2-dialogo__titulo">No se pudo abrir la bóveda</h2><p class="sx2-dialogo__texto">' + txt((r && r.message) || 'Inténtalo de nuevo.') + '</p>');
        } else if (!r.data.llave_configurada) {
          el = modal(cerrar + '<span class="cr2-modal__ico">' + U.ico('llave', 26) + '</span><h2 class="sx2-dialogo__titulo">Falta la llave de la bóveda</h2><p class="sx2-dialogo__texto">Las claves se guardan cifradas con una llave que solo existe en el servidor. Cuando esté configurada, aquí podrás abrir la bóveda.</p>');
        } else if (r.data.sesion_activa && token()) {
          return fin(true);
        } else if (r.data.autenticador_activo) {
          inactividad_ = r.data.inactividad_min || inactividad_;
          el = modal(cerrar +
            '<span class="cr2-modal__ico">' + U.ico('candado', 26) + '</span>' +
            '<h2 class="sx2-dialogo__titulo">Abrir la bóveda</h2>' +
            '<p class="sx2-dialogo__texto">Escribe el código de 6 dígitos de <b>Google Authenticator</b> («SIGSO Credenciales»).</p>' +
            casillas() + '<p class="fin2-error js-cr-err" role="alert"></p>' +
            '<p class="cr2-modal__pie">' + U.ico('escudo', 13) + ' Queda registrado quién abre y qué clave ve. Se cierra sola a los ' + inactividad_ + ' min.</p>');
          enlazarCasillas(el, function (cod) {
            el.querySelectorAll('.fin2-digito').forEach(function (i) { i.disabled = true; });
            api('credEntrar', { codigo: cod }).then(function (x) {
              el.querySelectorAll('.fin2-digito').forEach(function (i) { i.disabled = false; });
              if (!x || !x.ok) return limpiarCasillas(el, (x && x.message) || 'No se pudo abrir.');
              ultimoUso_ = Date.now(); inactividad_ = x.data.inactividad_min || inactividad_;
              guardarToken(x.data.boveda_token); iniciarReloj();
              el.querySelector('.cr2-modal__caja').classList.add('cr2-abre');
              setTimeout(function () { fin(true); }, 380);
            });
          });
        } else {
          el = modal(cerrar + registroHtml());
          enlazarRegistro(el, function () { fin(true); });
        }
        el.addEventListener('click', function (ev) { if (ev.target.closest('.js-cr-cerrar')) fin(false); });
        setTimeout(function () { var p = el.querySelector('.fin2-digito, input'); if (p) p.focus(); }, 60);
      });
    });
    return abriendo_;
  }
  function registroHtml() {
    return '<span class="cr2-modal__ico">' + U.ico('llave', 26) + '</span>' +
      '<h2 class="sx2-dialogo__titulo">Activa tu acceso a la bóveda</h2>' +
      '<p class="sx2-dialogo__texto">Una sola vez. Necesitas tu teléfono con <b>Google Authenticator</b>. Es distinto del de Finanzas.</p>' +
      '<form class="js-cr-clave cr2-reg">' +
        '<label class="fin2-label" for="cr-pass">Tu contraseña de SIGSO</label>' +
        '<input id="cr-pass" type="password" class="fin2-input" autocomplete="current-password" required>' +
        '<p class="fin2-ayuda">Se pide de nuevo para que nadie con tu sesión abierta registre su propio teléfono.</p>' +
        '<p class="fin2-error js-cr-err" role="alert"></p>' +
        U.boton({ texto: 'Continuar', icono: 'derecha', variante: 'primario', tipo: 'submit' }) +
      '</form>';
  }
  function enlazarRegistro(el, listo) {
    el.addEventListener('submit', function (ev) {
      if (!ev.target.classList.contains('js-cr-clave')) return;
      ev.preventDefault();
      var b = ev.target.querySelector('button'); b.disabled = true;
      api('credPrepararAutenticador', { password: el.querySelector('#cr-pass').value }).then(function (r) {
        b.disabled = false;
        if (!r || !r.ok) { el.querySelector('.js-cr-err').textContent = (r && r.message) || 'No se pudo continuar.'; return; }
        var caja = el.querySelector('.cr2-modal__caja');
        caja.classList.add('cr2-modal__caja--ancha');
        caja.innerHTML = U.boton({ variante: 'fantasma', soloIcono: true, icono: 'equis', titulo: 'Cerrar', clase: 'js-cr-cerrar cr2-modal__x' }) +
          '<h2 class="sx2-dialogo__titulo">Escanea el código</h2>' +
          '<div class="cr2-qr-fila"><div class="fin2-qr cr2-qr" id="cr-qr">' + U.ico('candado', 28) + '</div>' +
          '<div class="cr2-qr-txt"><p>En Google Authenticator toca <b>+</b> → <b>Escanear un código QR</b>.</p>' +
          '<p class="fin2-ayuda">¿No puedes escanear? Elige <b>Ingresar una clave de configuración</b>, nombre «SIGSO Credenciales», y escribe:</p>' +
          '<code class="fin2-clave">' + txt(r.data.clave) + '</code>' +
          '<p class="fin2-ayuda">No compartas esta clave ni le saques captura.</p></div></div>' +
          '<label class="fin2-label">Código de 6 dígitos que muestra la app</label>' + casillas() + '<p class="fin2-error js-cr-err" role="alert"></p>';
        cargarLibQr().then(function (qrcode) {
          var q = qrcode(0, 'M'); q.addData(r.data.uri); q.make();
          var c = el.querySelector('#cr-qr'); if (c) c.innerHTML = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
        }).catch(function () { var c = el.querySelector('#cr-qr'); if (c) c.innerHTML = '<p class="fin2-ayuda">No se pudo dibujar el QR. Usa la clave de configuración.</p>'; });
        enlazarCasillas(el, function (cod) {
          api('credActivarAutenticador', { codigo: cod }).then(function (x) {
            if (!x || !x.ok) return limpiarCasillas(el, (x && x.message) || 'No se pudo activar.');
            ultimoUso_ = Date.now(); guardarToken(x.data.boveda_token); iniciarReloj();
            aviso('Autenticador activado. La bóveda quedó abierta.', 'exito');
            listo();
          });
        });
        setTimeout(function () { var p = el.querySelector('.fin2-digito'); if (p) p.focus(); }, 60);
      });
    });
  }
  function cerrarBoveda() {
    api('credSalir').then(function () { guardarToken(''); detenerReloj(); aviso('Cerraste la bóveda.'); });
  }

  // --- Reloj de inactividad -----------------------------------------------------------------
  function iniciarReloj() {
    detenerReloj();
    reloj_ = setInterval(function () {
      if (!token()) { detenerReloj(); pintarPildora(); return; }
      var resta = inactividad_ * 60000 - (Date.now() - ultimoUso_);
      if (resta <= 0) { detenerReloj(); guardarToken(''); return; }
      document.querySelectorAll('.js-cr-reloj').forEach(function (el) {
        var m = Math.floor(resta / 60000), s = Math.floor((resta % 60000) / 1000);
        el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
        el.parentNode.classList.toggle('cr2-pildora--pronto', resta < 120000);
      });
    }, 1000);
  }
  function detenerReloj() { if (reloj_) { clearInterval(reloj_); reloj_ = null; } }
  function pildora() {
    return '<span class="js-cr-pildora">' + pildoraHtml() + '</span>';
  }
  function pildoraHtml() {
    return token()
      ? '<button type="button" class="cr2-pildora cr2-pildora--abierta js-cr-cerrar-boveda" title="Cerrar la bóveda ahora">' + U.ico('candado', 14) + 'Abierta · <span class="js-cr-reloj">' + inactividad_ + ':00</span></button>'
      : '<button type="button" class="cr2-pildora js-cr-abrir-boveda" title="Abrir con el código del teléfono">' + U.ico('candado', 14) + 'Bóveda cerrada</button>';
  }
  function pintarPildora() { document.querySelectorAll('.js-cr-pildora').forEach(function (el) { el.innerHTML = pildoraHtml(); }); }

  // --- Ver una clave ----------------------------------------------------------------------------
  function verClave(c) {
    conBoveda('credVerClave', { id: c.id }).then(function (r) {
      if (!r || !r.ok) { if (!r || !r.cancelado) aviso((r && r.message) || 'No se pudo ver la clave.', 'alerta'); return; }
      var m = marca(c.plataforma), clave = r.data.clave || '', segundos = 60;
      var el = modal(U.boton({ variante: 'fantasma', soloIcono: true, icono: 'equis', titulo: 'Cerrar', clase: 'js-cr-cerrar cr2-modal__x' }) +
        '<div class="cr2-ver__cab"><span class="cr2-logo" style="' + (m.color ? '--cr-marca:' + m.color : '') + '">' + txt(m.sigla) + '</span>' +
          '<div><h2 class="sx2-dialogo__titulo">' + txt(c.plataforma) + '</h2><p class="cr2-ver__cat">' + txt(categoria(c.categoria_id).nombre) + '</p></div></div>' +
        (c.usuario ? '<div class="cr2-ver__fila"><span class="cr2-ver__et">Usuario</span><code class="cr2-ver__valor">' + txt(c.usuario) + '</code>' +
          U.boton({ soloIcono: true, icono: 'copiar', titulo: 'Copiar usuario', sm: true, clase: 'js-cr-copiar-u' }) + '</div>' : '') +
        '<div class="cr2-ver__fila"><span class="cr2-ver__et">Clave</span>' +
          (clave ? '<code class="cr2-ver__valor cr2-ver__clave js-cr-clave-txt" data-oculta="1">' + '•'.repeat(Math.min(clave.length, 16)) + '</code>' +
            U.boton({ soloIcono: true, icono: 'ojo', titulo: 'Mostrar', sm: true, clase: 'js-cr-mostrar' }) + U.boton({ soloIcono: true, icono: 'copiar', titulo: 'Copiar clave', sm: true, clase: 'js-cr-copiar-c' })
            : '<span class="cr2-ver__vacio">No hay clave guardada.</span>') + '</div>' +
        (r.data.notas_privadas ? '<div class="cr2-ver__privadas"><span class="cr2-ver__et">Notas privadas</span><p>' + txt(r.data.notas_privadas) + '</p></div>' : '') +
        (c.dos_pasos ? '<p class="cr2-ver__2fa">' + U.ico('escudoCheck', 14) + ' Pide verificación en dos pasos' + (c.dos_pasos_donde ? ': llega a <b>' + txt(c.dos_pasos_donde) + '</b>' : '') + '.</p>' : '') +
        '<p class="cr2-modal__pie">' + U.ico('reloj', 13) + ' Esta ventana se cierra en <b class="js-cr-cuenta">' + segundos + '</b> s. Quedó registrado que la viste.</p>');
      var t = setInterval(function () { segundos--; var s = el.querySelector('.js-cr-cuenta'); if (s) s.textContent = segundos; if (segundos <= 0) cerrar(); }, 1000);
      function cerrar() { clearInterval(t); document.removeEventListener('keydown', esc); if (el.parentNode) el.parentNode.removeChild(el); }
      function esc(ev) { if (ev.key === 'Escape') cerrar(); }
      document.addEventListener('keydown', esc);
      el.addEventListener('click', function (ev) {
        if (ev.target.closest('.js-cr-cerrar')) return cerrar();
        if (ev.target.closest('.js-cr-copiar-u')) return copiar(c.usuario, 'Usuario');
        if (ev.target.closest('.js-cr-copiar-c')) return copiar(clave, 'Clave');
        var b = ev.target.closest('.js-cr-mostrar');
        if (b) {
          var x = el.querySelector('.js-cr-clave-txt'), oculta = x.dataset.oculta === '1';
          x.textContent = oculta ? clave : '•'.repeat(Math.min(clave.length, 16)); x.dataset.oculta = oculta ? '0' : '1';
          b.innerHTML = U.ico(oculta ? 'ojoTachado' : 'ojo', 14); b.title = oculta ? 'Ocultar' : 'Mostrar';
        }
      });
    });
  }

  // --- Formulario ------------------------------------------------------------------------------
  function generarClave() {
    var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#$%*?-_', a = new Uint32Array(18), s = '';
    crypto.getRandomValues(a);
    for (var i = 0; i < a.length; i++) s += abc[a[i] % abc.length];
    return s;
  }
  function filaPersona(p) {
    p = p || {};
    return '<div class="cr2-persona-fila">' +
      '<input class="sx2-input js-cr-p" data-k="nombre" list="cr-personas" maxlength="80" value="' + txt(p.nombre || '') + '" placeholder="Nombre" aria-label="Nombre">' +
      '<select class="sx2-select js-cr-p" data-k="rol" aria-label="Qué puede hacer">' + Object.keys(ROL).map(function (k) { return '<option value="' + k + '"' + ((p.rol || 'PUBLICA') === k ? ' selected' : '') + '>' + ROL[k] + '</option>'; }).join('') + '</select>' +
      '<input class="sx2-input js-cr-p" data-k="desde" type="date" value="' + txt(p.desde || '') + '" aria-label="Desde">' +
      U.boton({ soloIcono: true, icono: 'basura', titulo: 'Quitar', sm: true, variante: 'fantasma', clase: 'js-cr-quitar-p' }) +
    '</div>';
  }
  function abrirFormulario(c, catFija) {
    var nueva = !c; c = c || { categoria_id: catFija || cat_ || ((d_.categorias[0] || {}).id), personas: [], cambio_cada: 90, dos_pasos: false };
    var abrir = function () {
      var cats = d_.categorias.map(function (k) { return '<option value="' + txt(k.id) + '"' + (k.id === c.categoria_id ? ' selected' : '') + '>' + txt(k.nombre) + '</option>'; }).join('');
      U.formulario({
        titulo: nueva ? 'Nueva credencial' : 'Editar ' + c.plataforma, ancho: true,
        subtitulo: '<span class="cr2-form-sub">' + U.ico('candado', 13) + ' La clave y las notas privadas se guardan cifradas.</span>',
        boton: nueva ? 'Guardar credencial' : 'Guardar cambios',
        campos:
          '<div class="cr2-form-grid">' +
            U.campo('Categoría', '<select class="sx2-select" name="categoria_id">' + cats + '</select>') +
            U.campo('Plataforma o servicio', '<input class="sx2-input" name="plataforma" maxlength="80" required value="' + txt(c.plataforma || '') + '" placeholder="Facebook, Instagram, SII…" list="cr-plataformas">') +
            U.campo('Usuario o correo', '<input class="sx2-input" name="usuario" maxlength="160" autocomplete="off" value="' + txt(c.usuario || '') + '" placeholder="HomePymes / contacto@…">') +
            U.campo('Dirección web', '<input class="sx2-input" name="url" type="url" maxlength="500" value="' + txt(c.url || '') + '" placeholder="https://…">') +
          '</div>' +
          '<div class="cr2-clave-campo">' +
            U.campo(nueva ? 'Clave' : 'Clave nueva', '<span class="cr2-clave-input"><input class="sx2-input" name="clave" type="password" maxlength="500" autocomplete="new-password" placeholder="' + (nueva ? 'Escribe o genera una clave' : (c.tiene_clave ? 'Déjala vacía para no cambiarla' : 'No hay clave guardada')) + '">' +
              U.boton({ soloIcono: true, icono: 'ojo', titulo: 'Mostrar', sm: true, variante: 'fantasma', clase: 'js-cr-ver-input' }) +
              U.boton({ texto: 'Generar', icono: 'destello', sm: true, clase: 'js-cr-generar' }) + '</span>',
              'Si la cambias, la fecha de «último cambio» se pone sola en hoy.') +
          '</div>' +
          U.campo('Notas privadas (cifradas)', '<textarea class="sx2-input cr2-area" name="notas_privadas" rows="2" maxlength="2000" placeholder="Preguntas de seguridad, códigos de respaldo… Solo se ven con la bóveda abierta."></textarea>', nueva ? '' : 'Por seguridad no se muestran aquí: escribe solo si quieres reemplazarlas.') +
          '<h3 class="cr2-form-tit">' + U.ico('equipo', 15) + ' Quiénes tienen acceso a esta cuenta</h3>' +
          '<p class="cr2-form-ayuda">Las personas que conocen la clave o administran la cuenta (en la propia plataforma). Si alguien se va, aquí se ve qué claves cambiar.</p>' +
          '<div class="js-cr-personas">' + (c.personas.length ? c.personas : [{}]).map(filaPersona).join('') + '</div>' +
          U.boton({ texto: 'Agregar persona', icono: 'nueva', sm: true, variante: 'fantasma', clase: 'js-cr-mas-p' }) +
          '<datalist id="cr-personas">' + d_.personas.map(function (p) { return '<option value="' + txt(p.nombre) + '">'; }).join('') + '</datalist>' +
          '<datalist id="cr-plataformas">' + ['Facebook', 'Instagram', 'TikTok', 'LinkedIn', 'YouTube', 'X (Twitter)', 'WhatsApp Business', 'Google (Gmail)', 'Meta Business Suite', 'SII', 'TGR', 'Previred', 'Dirección del Trabajo', 'Mutual de Seguridad', 'Cloudflare', 'Canva'].map(function (p) { return '<option value="' + p + '">'; }).join('') + '</datalist>' +
          '<h3 class="cr2-form-tit">' + U.ico('escudo', 15) + ' Seguridad y recuperación</h3>' +
          '<div class="cr2-form-grid">' +
            '<label class="cr2-check"><input type="checkbox" name="dos_pasos"' + (c.dos_pasos ? ' checked' : '') + '><span><b>Tiene verificación en dos pasos</b><small>El código llega a un teléfono o app además de la clave.</small></span></label>' +
            U.campo('¿Dónde llega el código?', '<input class="sx2-input" name="dos_pasos_donde" maxlength="120" value="' + txt(c.dos_pasos_donde || '') + '" placeholder="Celular de Luis, app Authenticator…">') +
            U.campo('Correo o teléfono de recuperación', '<input class="sx2-input" name="recuperacion" maxlength="200" value="' + txt(c.recuperacion || '') + '" placeholder="Dónde llega «olvidé mi clave»">') +
            U.campo('Titular (a nombre de quién está)', '<input class="sx2-input" name="titular" maxlength="120" value="' + txt(c.titular || '') + '" placeholder="HomePymes SpA, Luis…">') +
            U.campo('Cambiar la clave', '<select class="sx2-select" name="cambio_cada">' + Object.keys(CADA).map(function (k) { return '<option value="' + k + '"' + (Number(k) === Number(c.cambio_cada) ? ' selected' : '') + '>' + CADA[k] + '</option>'; }).join('') + '</select>') +
            U.campo('Último cambio de clave', '<input class="sx2-input" name="clave_cambiada_en" type="date" max="' + hoy() + '" value="' + txt(c.clave_cambiada_en || '') + '">', 'Si no lo sabes, déjalo vacío: quedará como aviso.') +
            U.campo('Para qué se usa', '<input class="sx2-input" name="uso" maxlength="120" value="' + txt(c.uso || '') + '" placeholder="Publicaciones de Hompy, pagar cotizaciones…">') +
          '</div>' +
          U.campo('Notas', '<textarea class="sx2-input cr2-area" name="notas" rows="2" maxlength="1500" placeholder="Lo que conviene saber (sin escribir claves aquí).">' + txt(c.notas || '') + '</textarea>'),
        alMontar: function (form) {
          form.addEventListener('click', function (ev) {
            var b = ev.target.closest('button'); if (!b) return;
            var inp = form.querySelector('[name=clave]');
            if (b.classList.contains('js-cr-generar')) { inp.value = generarClave(); inp.type = 'text'; }
            else if (b.classList.contains('js-cr-ver-input')) { inp.type = inp.type === 'password' ? 'text' : 'password'; b.innerHTML = U.ico(inp.type === 'password' ? 'ojo' : 'ojoTachado', 14); }
            else if (b.classList.contains('js-cr-mas-p')) { form.querySelector('.js-cr-personas').insertAdjacentHTML('beforeend', filaPersona({ desde: hoy() })); }
            else if (b.classList.contains('js-cr-quitar-p')) { b.closest('.cr2-persona-fila').remove(); }
          });
        },
        preparar: function (datos, form) {
          if (!datos.plataforma) return 'Escribe la plataforma o el servicio.';
          if (/banco|bci|santander|chile|estado|scotiabank|itau|itaú|security|bice/i.test(datos.plataforma) && datos.clave && categoria(datos.categoria_id).id === 'bancos') {
            return 'Para bancos registra quién tiene acceso, pero no guardes la clave: deja ese campo vacío.';
          }
          datos.dos_pasos = !!form.querySelector('[name=dos_pasos]').checked;
          datos.personas = Array.prototype.map.call(form.querySelectorAll('.cr2-persona-fila'), function (f) {
            var p = {}; f.querySelectorAll('.js-cr-p').forEach(function (i) { p[i.dataset.k] = i.value.trim(); }); return p;
          }).filter(function (p) { return p.nombre; });
          if (!datos.clave) delete datos.clave;
          if (!datos.notas_privadas && !nueva) delete datos.notas_privadas;
          if (!nueva) datos.id = c.id;
          return datos;
        },
        enviar: function (datos) { return conBoveda('credGuardarCuenta', datos); },
        aviso: nueva ? 'Credencial guardada.' : 'Cambios guardados.',
        listo: recargarTodo
      });
    };
    // Abrir la bóveda antes de escribir la clave (y no después).
    abrirBoveda().then(function (ok) { if (ok) abrir(); });
  }
  function retirar(c) {
    var reactivar = c.estado === 'RETIRADA';
    U.confirmar({ titulo: reactivar ? '¿Reactivar ' + c.plataforma + '?' : '¿Retirar ' + c.plataforma + '?', boton: reactivar ? 'Reactivar' : 'Retirar', peligro: !reactivar,
      texto: reactivar ? 'Vuelve a la lista de cuentas activas.' : 'Úsalo cuando la cuenta se cerró o ya no se usa. No se borra: queda en «Retiradas» y en la bitácora.' })
      .then(function (ok) {
        if (!ok) return;
        conBoveda('credRetirarCuenta', { id: c.id, reactivar: reactivar }).then(function (r) {
          if (!r || !r.ok) { if (!r || !r.cancelado) aviso((r && r.message) || 'No se pudo.', 'alerta'); return; }
          aviso(reactivar ? 'Credencial reactivada.' : 'Credencial retirada.', 'exito'); recargarTodo();
        });
      });
  }

  // --- Tarjetas ---------------------------------------------------------------------------------
  function estadoClave(c) {
    if (!c.cambio_cada) return null;
    if (c.vence === '') return ['Sin fecha de cambio', 'alerta'];
    if (c.vence < hoy()) return ['Toca cambiarla', 'critico'];
    return ['Al día hasta ' + fecha(c.vence), 'ok'];
  }
  function tarjeta(c, i) {
    var m = marca(c.plataforma), e = estadoClave(c), retirada = c.estado === 'RETIRADA';
    var personas = c.personas.map(function (p) {
      return '<li class="cr2-quien">' + U.avatar({ nombre: p.nombre }, 'sm') + '<span class="cr2-quien__n">' + txt(p.nombre) + '</span><span class="cr2-quien__r">' + txt(ROL[p.rol] || p.rol) + '</span></li>';
    }).join('');
    return '<article class="cr2-tarjeta sx2-entra' + (retirada ? ' cr2-tarjeta--retirada' : '') + '" style="--i:' + (i || 0) + (m.color ? ';--cr-marca:' + m.color : '') + '" data-id="' + txt(c.id) + '">' +
      '<header class="cr2-tarjeta__cab">' +
        '<span class="cr2-logo">' + txt(m.sigla) + '</span>' +
        '<div class="cr2-tarjeta__tit"><h3>' + txt(c.plataforma) + '</h3>' + (c.usuario ? '<span class="cr2-tarjeta__u">' + txt(c.usuario) + '</span>' : '<span class="cr2-tarjeta__u cr2-tenue">Sin usuario</span>') + '</div>' +
        (c.url ? '<a class="sx2-boton sx2-boton--fantasma sx2-boton--icono sx2-boton--sm" href="' + txt(c.url) + '" target="_blank" rel="noopener noreferrer" title="Abrir el sitio" aria-label="Abrir el sitio">' + U.ico('enlace', 14) + '</a>' : '') +
      '</header>' +
      '<div class="cr2-tarjeta__sellos">' +
        (retirada ? U.badge('Retirada', 'neutro') : '') +
        (c.dos_pasos ? U.badge('Dos pasos', 'ok') : U.badge('Sin dos pasos', 'alerta')) +
        (e && !retirada ? U.badge(e[0], e[1]) : '') +
        (!c.tiene_clave ? U.badge('Sin clave guardada', 'neutro') : '') +
      '</div>' +
      '<div class="cr2-tarjeta__acceso"><span class="cr2-et">Quiénes tienen acceso</span>' +
        (personas ? '<ul class="cr2-quienes">' + personas + '</ul>' : '<p class="cr2-tenue">Nadie anotado todavía.</p>') + '</div>' +
      ((c.uso || c.recuperacion || c.titular) ? '<dl class="cr2-datos">' +
        (c.uso ? '<div><dt>Uso</dt><dd>' + txt(c.uso) + '</dd></div>' : '') +
        (c.titular ? '<div><dt>Titular</dt><dd>' + txt(c.titular) + '</dd></div>' : '') +
        (c.recuperacion ? '<div><dt>Recuperación</dt><dd>' + txt(c.recuperacion) + '</dd></div>' : '') + '</dl>' : '') +
      '<footer class="cr2-tarjeta__pie">' +
        (c.tiene_clave && !retirada ? U.boton({ texto: 'Ver clave', icono: 'llave', variante: 'primario', sm: true, clase: 'js-cr-ver', datos: { id: c.id } }) : '') +
        (c.usuario ? U.boton({ soloIcono: true, icono: 'copiar', titulo: 'Copiar usuario', sm: true, clase: 'js-cr-copiar', datos: { id: c.id } }) : '') +
        '<span class="cr2-flex"></span>' +
        U.boton({ soloIcono: true, icono: 'editar', titulo: 'Editar', sm: true, variante: 'fantasma', clase: 'js-cr-editar', datos: { id: c.id } }) +
        U.boton({ soloIcono: true, icono: retirada ? 'subir' : 'caja', titulo: retirada ? 'Reactivar' : 'Retirar', sm: true, variante: 'fantasma', clase: 'js-cr-retirar', datos: { id: c.id } }) +
      '</footer>' +
      '<p class="cr2-tarjeta__mod">Actualizada ' + txt(fecha(c.actualizada_en)) + (c.actualizado_por ? ' por ' + txt(c.actualizado_por) : '') + '</p>' +
    '</article>';
  }
  function avisosHtml(avisos, cuentas) {
    if (!avisos.length) return '';
    var porId = {}; cuentas.forEach(function (c) { porId[c.id] = c; });
    var ICO = { VENCIDA: 'reloj', SIN_FECHA: 'calendario', SIN_2FA: 'escudo', PERSONA_INACTIVA: 'persona' };
    var TONO = { VENCIDA: 'critico', SIN_FECHA: 'alerta', SIN_2FA: 'alerta', PERSONA_INACTIVA: 'critico' };
    var orden = { PERSONA_INACTIVA: 0, VENCIDA: 1, SIN_2FA: 2, SIN_FECHA: 3 };
    var lista = avisos.slice().sort(function (a, b) { return orden[a.tipo] - orden[b.tipo]; });
    return '<details class="cr2-avisos sx2-entra"' + (lista.length <= 4 ? ' open' : '') + '><summary>' + U.ico('alerta', 16) + '<b>' + lista.length + (lista.length === 1 ? ' cosa por revisar' : ' cosas por revisar') + '</b><span class="cr2-tenue">— para que ninguna clave quede en manos de quien ya no debe</span></summary><ul>' +
      lista.map(function (a) {
        var c = porId[a.credencial_id] || {};
        return '<li class="cr2-aviso cr2-aviso--' + TONO[a.tipo] + '">' + U.ico(ICO[a.tipo] || 'alerta', 15) + '<b>' + txt(c.plataforma || '') + '</b><span>' + txt(a.texto) + '</span>' +
          U.boton({ texto: 'Revisar', sm: true, variante: 'fantasma', clase: 'js-cr-editar', datos: { id: a.credencial_id } }) + '</li>';
      }).join('') + '</ul></details>';
  }
  function cuadricula(cuentas) {
    return cuentas.length ? '<div class="cr2-grid">' + cuentas.map(tarjeta).join('') + '</div>' : '';
  }

  // --- Vistas incrustadas (Hompy) ----------------------------------------------------------------
  /** Pinta las tarjetas de UNA categoría dentro de `el` (lo usa Hompy). */
  function montar(el, o) {
    o = o || {};
    var m = { el: el, categoria: o.categoria, intro: o.intro || '' };
    montados_ = montados_.filter(function (x) { return x.el !== el && document.body.contains(x.el); }).concat([m]);
    el.innerHTML = U.esqueleto('tarjetas', 3);
    enlazarEn(el);
    return traer().then(function () { pintarMontado(m); });
  }
  function pintarMontado(m) {
    var conModulo = !!(window.SigsoShell && SigsoShell.tieneModulo && SigsoShell.tieneModulo('credenciales'));
    if (!d_ || !d_.categorias.some(function (c) { return c.id === m.categoria; })) {
      m.el.innerHTML = U.card({ cuerpo: U.vacio({ icono: 'candado', titulo: 'Las claves de las redes están en la bóveda de la empresa',
        texto: 'Para verlas necesitas acceso a la categoría «Redes sociales». Pídeselo a Luis: él lo da desde Credenciales.' }) });
      return;
    }
    var cuentas = d_.cuentas.filter(function (c) { return c.categoria_id === m.categoria && c.estado === 'ACTIVA'; });
    var ids = {}; cuentas.forEach(function (c) { ids[c.id] = 1; });
    var avisos = d_.avisos.filter(function (a) { return ids[a.credencial_id]; });
    var acceso = d_.accesos.filter(function (a) { return a.categoria_id === m.categoria; });
    m.el.innerHTML =
      '<div class="cr2 cr2-incrustado">' +
        '<div class="cr2-barra">' +
          '<p class="cr2-barra__txt">' + U.ico('equipo', 15) + ' Ven esta sección en SIGSO: <b>' + (acceso.length ? acceso.map(function (a) { return txt(a.nombre); }).join(', ') : 'solo la administración') + '</b>' + (d_.es_admin ? '' : ' (y Luis)') + '.</p>' +
          pildora() +
          U.boton({ texto: 'Nueva cuenta', icono: 'nueva', variante: 'primario', sm: true, clase: 'js-cr-nueva', datos: { cat: m.categoria } }) +
        '</div>' +
        avisosHtml(avisos, cuentas) +
        (cuentas.length ? cuadricula(cuentas) : U.card({ cuerpo: U.vacio({ icono: 'llave', titulo: 'Todavía no hay cuentas aquí', texto: 'Agrega la primera: Facebook, Instagram, TikTok… La clave queda cifrada y se ve con el código del teléfono.' }) })) +
        '<p class="cr2-pie-incrustado">' + U.ico('escudo', 13) + ' Cada vez que alguien ve una clave queda en la bitácora. ' + (conModulo ? '<a href="#/credenciales" class="sx2-enlace">Ver todo en Credenciales</a>' : '') + '</p>' +
      '</div>';
    if (U.animar) U.animar(m.el);
    if (token()) iniciarReloj();
  }

  // --- Datos ---------------------------------------------------------------------------------------
  function traer() {
    return api('credDatos').then(function (r) {
      if (r && r.ok) { d_ = r.data; return d_; }
      d_ = null; return null;
    });
  }
  function recargarTodo() {
    return traer().then(function () {
      montados_ = montados_.filter(function (m) { return document.body.contains(m.el); });
      montados_.forEach(pintarMontado);
      if (raiz_ && document.body.contains(raiz_) && raiz_.querySelector('.cr2-modulo')) pintar();
    });
  }

  // --- Módulo ----------------------------------------------------------------------------------------
  function cargar() {
    raiz_ = document.getElementById('modulo-credenciales');
    if (!raiz_) return;
    enlazarEn(raiz_);
    var t = ++turno_;
    raiz_.innerHTML = '<div class="sx2 sx2-pagina cr2">' + U.esqueleto('kpis', 4) + U.esqueleto('tarjetas', 6) + '</div>';
    traer().then(function () {
      if (t !== turno_) return;
      if (!d_) { raiz_.innerHTML = '<div class="sx2 sx2-pagina cr2">' + U.card({ cuerpo: U.vacio({ icono: 'candado', titulo: 'No se pudo abrir Credenciales', texto: 'Inténtalo de nuevo.' }) }) + '</div>'; return; }
      pintar();
    });
  }
  function cabecera() {
    var ops = [{ id: 'cuentas', texto: 'Cuentas', icono: 'llave' }, { id: 'personas', texto: 'Por persona', icono: 'equipo' }];
    if (d_.es_admin) ops.push({ id: 'accesos', texto: 'Accesos', icono: 'escudoCheck' });
    ops.push({ id: 'bitacora', texto: 'Bitácora', icono: 'lista' });
    return '<header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Credenciales</span>' +
      '<h1>Credenciales de la empresa</h1><p>Dónde está cada cuenta, quién tiene acceso y cuándo se cambió la clave. Las claves se ven con el código del teléfono.</p></div>' +
      '<div class="sx2-cabecera__acciones">' + pildora() + U.segmento(ops, vista_, 'js-cr-vista') +
      U.boton({ texto: 'Nueva credencial', icono: 'nueva', variante: 'primario', clase: 'js-cr-nueva' }) + '</div></header>';
  }
  function pintar() {
    if (!raiz_ || !d_) return;
    if (vista_ === 'accesos' && !d_.es_admin) vista_ = 'cuentas';
    var cuerpo = vista_ === 'personas' ? vistaPersonas() : vista_ === 'accesos' ? vistaAccesos() : vista_ === 'bitacora' ? '<div class="js-cr-bitacora">' + U.esqueleto('tabla', 8) + '</div>' : vistaCuentas();
    raiz_.innerHTML = '<div class="sx2 sx2-pagina cr2 cr2-modulo">' + cabecera() + cuerpo + '</div>';
    if (U.animar) U.animar(raiz_);
    if (token()) iniciarReloj();
    if (vista_ === 'bitacora') cargarBitacora();
  }
  function vistaCuentas() {
    var activas = d_.cuentas.filter(function (c) { return c.estado === 'ACTIVA'; });
    var retiradas = d_.cuentas.filter(function (c) { return c.estado !== 'ACTIVA'; });
    var porCambiar = d_.avisos.filter(function (a) { return a.tipo === 'VENCIDA' || a.tipo === 'SIN_FECHA'; }).length;
    var sin2 = activas.filter(function (c) { return !c.dos_pasos; }).length;
    var nombres = {}; activas.forEach(function (c) { c.personas.forEach(function (p) { nombres[p.nombre.toLowerCase()] = 1; }); });
    if (cat_ && !d_.categorias.some(function (c) { return c.id === cat_; })) cat_ = '';
    var chips = '<div class="cr2-chips">' + U.chip({ texto: 'Todas', n: activas.length, activo: !cat_, clase: 'js-cr-cat', datos: { cat: '' } }) +
      d_.categorias.map(function (k) {
        return U.chip({ texto: k.nombre, icono: k.icono, n: activas.filter(function (c) { return c.categoria_id === k.id; }).length, activo: cat_ === k.id, clase: 'js-cr-cat', datos: { cat: k.id } });
      }).join('') + '</div>';
    var grupos = d_.categorias.filter(function (k) { return !cat_ || k.id === cat_; }).map(function (k) {
      var lista = activas.filter(function (c) { return c.categoria_id === k.id; });
      if (!lista.length && !cat_) return '';
      return '<section class="cr2-grupo"><div class="cr2-grupo__cab"><span class="cr2-grupo__ico">' + U.ico(k.icono || 'llave', 16) + '</span><h2>' + txt(k.nombre) + '</h2>' +
        '<span class="cr2-grupo__desc">' + txt(k.descripcion) + '</span>' +
        U.boton({ texto: 'Agregar', icono: 'nueva', sm: true, variante: 'fantasma', clase: 'js-cr-nueva', datos: { cat: k.id } }) + '</div>' +
        (k.id === 'bancos' ? '<p class="cr2-nota">' + U.ico('info', 14) + ' Para bancos anota quién tiene acceso y con qué clave dinámica, pero no guardes la clave: cada persona usa la suya.</p>' : '') +
        (lista.length ? cuadricula(lista) : '<p class="cr2-tenue cr2-grupo__vacio">Sin cuentas en esta categoría.</p>') + '</section>';
    }).join('');
    return '<div class="sx2-fila-kpis">' +
        U.kpi({ etiqueta: 'Cuentas registradas', valor: activas.length, icono: 'llave', i: 0 }) +
        U.kpi({ etiqueta: 'Personas con alguna clave', valor: Object.keys(nombres).length, icono: 'equipo', i: 1 }) +
        U.kpi({ etiqueta: 'Sin dos pasos', valor: sin2, icono: 'escudo', tono: sin2 ? 'alerta' : 'ok', i: 2 }) +
        U.kpi({ etiqueta: 'Claves por cambiar', valor: porCambiar, icono: 'reloj', tono: porCambiar ? 'alerta' : 'ok', i: 3 }) +
      '</div>' +
      avisosHtml(d_.avisos, d_.cuentas) + chips +
      (activas.length ? grupos : U.card({ cuerpo: U.vacio({ icono: 'llave', titulo: 'La bóveda está vacía', texto: 'Empieza por las redes sociales: agrega Facebook con su usuario, quiénes tienen la clave y si tiene verificación en dos pasos.', accion: U.boton({ texto: 'Agregar la primera', icono: 'nueva', variante: 'primario', clase: 'js-cr-nueva', datos: { cat: 'redes' } }) }) })) +
      (retiradas.length ? '<details class="cr2-retiradas"' + (verRetiradas_ ? ' open' : '') + '><summary>' + U.ico('caja', 15) + ' Retiradas (' + retiradas.length + ')</summary>' + cuadricula(retiradas) + '</details>' : '');
  }
  function vistaPersonas() {
    var activos = {}; d_.personas.forEach(function (p) { activos[p.nombre.toLowerCase()] = 1; });
    var mapa = {};
    d_.cuentas.filter(function (c) { return c.estado === 'ACTIVA'; }).forEach(function (c) {
      c.personas.forEach(function (p) {
        var k = p.nombre.toLowerCase();
        (mapa[k] = mapa[k] || { nombre: p.nombre, cuentas: [], sigso: [] }).cuentas.push({ c: c, rol: p.rol, desde: p.desde });
      });
    });
    d_.accesos.forEach(function (a) {
      var k = String(a.nombre || '').toLowerCase(); if (!k) return;
      (mapa[k] = mapa[k] || { nombre: a.nombre, cuentas: [], sigso: [] }).sigso.push(categoria(a.categoria_id).nombre);
    });
    var lista = Object.keys(mapa).map(function (k) { return mapa[k]; }).sort(function (a, b) { return b.cuentas.length - a.cuentas.length || a.nombre.localeCompare(b.nombre, 'es'); });
    if (!lista.length) return U.card({ cuerpo: U.vacio({ icono: 'equipo', titulo: 'Nadie anotado todavía', texto: 'Al registrar una cuenta, anota quiénes conocen la clave: aquí verás todo por persona.' }) });
    return '<p class="cr2-intro sx2-entra">' + U.ico('info', 15) + ' <span><b>Cuando alguien deja la empresa</b>, abre su nombre: son las claves que hay que cambiar y las cuentas donde hay que quitarle el acceso.</span></p>' +
      '<div class="cr2-personas">' + lista.map(function (p, i) {
        var activo = !!activos[p.nombre.toLowerCase()];
        return '<details class="cr2-pers sx2-entra" style="--i:' + i + '"' + (i < 3 ? ' open' : '') + '><summary>' + U.avatar({ nombre: p.nombre }) +
          '<span class="cr2-pers__n"><b>' + txt(p.nombre) + '</b><small>' + (activo ? 'Activa en SIGSO' : 'No aparece activa en SIGSO') + '</small></span>' +
          (activo ? '' : U.badge('Revisar', 'critico')) + '<span class="cr2-pers__k">' + p.cuentas.length + (p.cuentas.length === 1 ? ' cuenta' : ' cuentas') + '</span></summary>' +
          (p.cuentas.length ? '<ul class="cr2-pers__lista">' + p.cuentas.map(function (x) {
            var m = marca(x.c.plataforma);
            return '<li><span class="cr2-logo cr2-logo--sm" style="' + (m.color ? '--cr-marca:' + m.color : '') + '">' + txt(m.sigla) + '</span><b>' + txt(x.c.plataforma) + '</b><span class="cr2-tenue">' + txt(x.c.usuario) + '</span>' +
              U.badge(ROL[x.rol] || x.rol, 'neutro', true) + (x.desde ? '<span class="cr2-tenue">desde ' + txt(fecha(x.desde)) + '</span>' : '') + '</li>';
          }).join('') + '</ul>' : '') +
          (p.sigso.length ? '<p class="cr2-pers__sigso">' + U.ico('candado', 13) + ' Ve en SIGSO: ' + txt(p.sigso.join(', ')) + '</p>' : '') +
        '</details>';
      }).join('') + '</div>';
  }
  function vistaAccesos() {
    return '<p class="cr2-intro sx2-entra">' + U.ico('escudoCheck', 15) + ' <span>Quién puede <b>ver estas categorías en SIGSO</b>. Solo tú das y quitas acceso; quitarlo cierra su bóveda al instante. Hompy muestra «Redes sociales» a quien tenga esa categoría.</span></p>' +
      '<div class="cr2-accesos">' + d_.categorias.map(function (k, i) {
        var con = d_.accesos.filter(function (a) { return a.categoria_id === k.id; });
        var ids = {}; con.forEach(function (a) { ids[a.cuenta_id] = 1; });
        var opciones = d_.personas.filter(function (p) { return !ids[p.cuenta_id]; }).map(function (p) { return '<option value="' + txt(p.cuenta_id) + '">' + txt(p.nombre) + '</option>'; }).join('');
        return U.card({ titulo: k.nombre, icono: k.icono, i: i, sub: (function (n) { return n + (n === 1 ? ' cuenta' : ' cuentas'); })(d_.cuentas.filter(function (c) { return c.categoria_id === k.id && c.estado === 'ACTIVA'; }).length),
          accion: { texto: 'Editar', clase: 'js-cr-editar-cat', datos: { cat: k.id } }, cuerpo:
          '<ul class="cr2-acc-lista"><li class="cr2-acc cr2-acc--fija">' + U.ico('escudo', 14) + '<span class="cr2-acc__n">Administración (tú)</span>' + U.badge('Siempre', 'neutro', true) + '</li>' +
            con.map(function (a) { return '<li class="cr2-acc">' + U.avatar({ nombre: a.nombre }, 'sm') + '<span class="cr2-acc__n">' + txt(a.nombre) + '<small>desde ' + txt(fecha(a.desde)) + '</small></span>' +
              U.boton({ soloIcono: true, icono: 'equis', titulo: 'Quitar acceso a ' + a.nombre, sm: true, variante: 'fantasma', clase: 'js-cr-quitar', datos: { cat: k.id, cuenta: a.cuenta_id, nombre: a.nombre } }) + '</li>'; }).join('') + '</ul>' +
          '<div class="cr2-acc-dar"><select class="sx2-select js-cr-persona" aria-label="Persona"><option value="">Dar acceso a…</option>' + opciones + '</select>' +
            U.boton({ texto: 'Dar acceso', icono: 'nueva', sm: true, clase: 'js-cr-dar', datos: { cat: k.id } }) + '</div>' });
      }).join('') +
      '<button type="button" class="cr2-cat-nueva js-cr-nueva-cat">' + U.ico('nueva', 18) + '<span>Nueva categoría</span></button></div>';
  }
  function cargarBitacora() {
    var t = ++turno_;
    conBoveda('credBitacora', { limite: 300 }).then(function (r) {
      var el = raiz_ && raiz_.querySelector('.js-cr-bitacora');
      if (t !== turno_ || !el) return;
      if (!r || !r.ok) { el.innerHTML = U.card({ cuerpo: U.vacio({ icono: 'candado', titulo: 'La bitácora se ve con la bóveda abierta', accion: U.boton({ texto: 'Abrir la bóveda', icono: 'candado', variante: 'primario', clase: 'js-cr-reintentar-bit' }) }) }); return; }
      var c = r.data.cadena;
      var filas = r.data.filas.map(function (f) {
        var a = ACCIONES[f.accion] || [f.accion, 'neutro'];
        return '<tr><td class="fin2-num">' + txt(fechaHora(f.ts)) + '</td><td>' + txt(f.nombre || '—') + '</td><td>' + U.badge(a[0], a[1]) + '</td><td>' + txt(f.detalle || (f.categoria_id ? categoria(f.categoria_id).nombre : '')) + '</td></tr>';
      }).join('');
      el.innerHTML = '<div class="fin2-cadena ' + (c.ok ? 'fin2-cadena--ok' : 'fin2-cadena--mal') + ' sx2-entra">' + U.ico(c.ok ? 'escudo' : 'alerta', 18) +
          (c.ok ? '<span><b>Bitácora íntegra.</b> Las ' + c.filas + ' entradas están encadenadas: si alguien editara o borrara una, se notaría aquí.</span>'
                : '<span><b>Atención: la bitácora fue alterada</b> desde la entrada ' + c.rota_en + '.</span>') + '</div>' +
        U.card({ sinRelleno: true, cuerpo: '<div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>Cuándo</th><th>Quién</th><th>Qué</th><th>Detalle</th></tr></thead><tbody>' +
          (filas || '<tr><td colspan="4">Sin registros.</td></tr>') + '</tbody></table></div>' });
    });
  }
  function formCategoria(k) {
    var iconos = (d_.catalogos.iconos || []);
    abrirBoveda().then(function (ok) {
      if (!ok) return;
      U.formulario({
        titulo: k ? 'Editar categoría' : 'Nueva categoría',
        campos: U.campo('Nombre', '<input class="sx2-input" name="nombre" maxlength="60" required value="' + txt(k ? k.nombre : '') + '" placeholder="Ej.: Proveedores">') +
          U.campo('Descripción', '<input class="sx2-input" name="descripcion" maxlength="200" value="' + txt(k ? k.descripcion : '') + '">') +
          U.campo('Ícono', '<select class="sx2-select" name="icono">' + iconos.map(function (i) { return '<option value="' + i + '"' + (k && k.icono === i ? ' selected' : '') + '>' + i + '</option>'; }).join('') + '</select>'),
        preparar: function (dd) { if (!dd.nombre) return 'Ponle nombre.'; if (k) dd.id = k.id; return dd; },
        enviar: function (dd) { return conBoveda('credGuardarCategoria', dd); },
        aviso: 'Categoría guardada.', listo: recargarTodo
      });
    });
  }

  // --- Eventos (uno por contenedor) ---------------------------------------------------------------
  function buscar(id) { return ((d_ && d_.cuentas) || []).filter(function (c) { return c.id === id; })[0]; }
  function enlazarEn(el) {
    if (!el || el.dataset.crEnlazado) return;
    el.dataset.crEnlazado = '1';
    el.addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b || !el.contains(b)) return;
      var id = b.dataset.id, c = id ? buscar(id) : null;
      if (b.classList.contains('js-cr-ver') && c) verClave(c);
      else if (b.classList.contains('js-cr-copiar') && c) copiar(c.usuario, 'Usuario');
      else if (b.classList.contains('js-cr-editar') && c) abrirFormulario(c);
      else if (b.classList.contains('js-cr-retirar') && c) retirar(c);
      else if (b.classList.contains('js-cr-nueva')) abrirFormulario(null, b.dataset.cat);
      else if (b.classList.contains('js-cr-abrir-boveda')) abrirBoveda().then(function (ok) { if (ok) aviso('Bóveda abierta.', 'exito'); });
      else if (b.classList.contains('js-cr-cerrar-boveda')) cerrarBoveda();
      else if (b.classList.contains('js-cr-cat')) { cat_ = b.dataset.cat || ''; pintar(); }
      else if (b.closest('.js-cr-vista') && b.dataset.id) { vista_ = b.dataset.id; pintar(); }
      else if (b.classList.contains('js-cr-reintentar-bit')) cargarBitacora();
      else if (b.classList.contains('js-cr-nueva-cat')) formCategoria(null);
      else if (b.classList.contains('js-cr-editar-cat')) formCategoria(categoria(b.dataset.cat));
      else if (b.classList.contains('js-cr-dar')) {
        var sel = b.parentNode.querySelector('.js-cr-persona');
        if (!sel.value) { aviso('Elige a quién darle acceso.', 'alerta'); return; }
        conBoveda('credDarAcceso', { categoria_id: b.dataset.cat, cuenta_id: sel.value }).then(function (r) {
          if (!r || !r.ok) { if (!r || !r.cancelado) aviso((r && r.message) || 'No se pudo.', 'alerta'); return; }
          aviso('Acceso dado. Lo verá al volver a entrar a SIGSO.', 'exito'); recargarTodo();
        });
      } else if (b.classList.contains('js-cr-quitar')) {
        U.confirmar({ titulo: '¿Quitar el acceso a ' + b.dataset.nombre + '?', texto: 'Deja de ver «' + categoria(b.dataset.cat).nombre + '» en SIGSO y su bóveda se cierra. Si conocía claves, cámbialas en cada plataforma.', boton: 'Quitar acceso', peligro: true })
          .then(function (ok) {
            if (!ok) return;
            conBoveda('credQuitarAcceso', { categoria_id: b.dataset.cat, cuenta_id: b.dataset.cuenta }).then(function (r) {
              if (!r || !r.ok) { if (!r || !r.cancelado) aviso((r && r.message) || 'No se pudo.', 'alerta'); return; }
              aviso('Acceso quitado.', 'exito'); recargarTodo();
            });
          });
      }
    });
    el.addEventListener('toggle', function (ev) { if (ev.target.classList && ev.target.classList.contains('cr2-retiradas')) verRetiradas_ = ev.target.open; }, true);
  }

  window.SigsoCredenciales = { cargar: cargar, montar: montar, abrirBoveda: abrirBoveda };
})();
