/**
 * finanzas-v2.js — módulo Finanzas, Etapa 1: la bóveda (2026-10-06;
 * backend/logica/finanzasBoveda.js).
 *
 * Solo lo ven las cuentas de la lista fija del servidor (la sesión trae
 * `cuenta.finanzas === true`). Tres pantallas:
 *  - Registrar el autenticador (primera vez): contraseña de SIGSO → código
 *    QR / clave para Google Authenticator → primer código.
 *  - Bóveda cerrada: 6 dígitos del autenticador.
 *  - Bóveda abierta: estado de la seguridad, últimos ingresos y bitácora.
 *
 * El token de la bóveda vive en sessionStorage (cerrar la pestaña la
 * cierra) y el servidor la cierra sola a los 15 min sin uso.
 */
(function () {
  'use strict';

  var U = UIv2;
  var LLAVE_TOKEN = 'sigso_fin_boveda';
  var LLAVE_EQUIPO = 'sigso_fin_equipo';
  var QR_SRC = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
  var QR_SRI = 'sha384-8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k';
  var raiz_ = null, vista_ = 'inicio', turno_ = 0, reloj_ = null, ultimoUso_ = 0, inactividadMin_ = 15;
  var NOMBRES_ACCION = {
    ENTRAR: ['Abrió la bóveda', 'ok'], SALIR: ['Cerró la bóveda', 'neutro'], VER_BITACORA: ['Revisó la bitácora', 'info'],
    CODIGO_INCORRECTO: ['Código incorrecto', 'alerta'], AUTENTICADOR_PREPARADO: ['Generó la clave del autenticador', 'info'],
    AUTENTICADOR_ACTIVADO: ['Activó su autenticador', 'ok'], AUTENTICADOR_CLAVE_INCORRECTA: ['Contraseña incorrecta al registrar', 'alerta'],
    AUTENTICADOR_REINICIADO: ['Autenticador reiniciado en el servidor', 'alerta']
  };

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function token() { try { return sessionStorage.getItem(LLAVE_TOKEN) || ''; } catch (e) { return ''; } }
  function guardarToken(t) { try { if (t) sessionStorage.setItem(LLAVE_TOKEN, t); else sessionStorage.removeItem(LLAVE_TOKEN); } catch (e) { /* sin storage */ } }
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
      if (r && r.boveda_cerrada) { guardarToken(''); detenerReloj(); pintarCerrada('La bóveda se cerró por seguridad. Ingresa tu código de nuevo.'); }
      else if (r && r.ok) ultimoUso_ = Date.now();
      return r;
    }).catch(function (e) { return { ok: false, message: (e && e.message) || 'No se pudo conectar.' }; });
  }
  function fechaHora(iso) {
    if (!iso) return '';
    return new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  }
  function pagina(html) { if (raiz_) raiz_.innerHTML = '<div class="sx2 sx2-pagina fin2">' + html + '</div>'; }
  function cab(titulo, sub, acciones) {
    return '<header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Finanzas</span><h1>' + txt(titulo) + '</h1>' +
      (sub ? '<p>' + txt(sub) + '</p>' : '') + '</div><div class="sx2-cabecera__acciones">' + (acciones || '') + '</div></header>';
  }

  // --- Carga ---------------------------------------------------------------------------------
  function cargar() {
    raiz_ = document.getElementById('modulo-finanzas');
    if (!raiz_) return;
    enlazar();
    var t = ++turno_;
    pagina(U.esqueleto('tarjetas', 3));
    api('finanzasEstado').then(function (r) {
      if (t !== turno_) return;
      if (!r || !r.ok) { pagina(U.card({ cuerpo: U.vacio({ icono: 'candado', titulo: 'No se pudo abrir Finanzas', texto: (r && r.message) || 'Inténtalo de nuevo.' }) })); return; }
      var e = r.data;
      inactividadMin_ = e.inactividad_min || 15;
      if (!e.llave_configurada) return pintarSinLlave();
      if (!e.autenticador_activo) return pintarRegistro();
      if (!e.sesion_activa) { guardarToken(''); return pintarCerrada(''); }
      abrir();
    });
  }
  function refrescar() { if (token()) abrir(); else cargar(); }

  function pintarSinLlave() {
    pagina(cab('Bóveda en preparación') + U.card({ cuerpo: U.vacio({ icono: 'llave', titulo: 'Falta la llave de la bóveda en el servidor',
      texto: 'Los datos de Finanzas se guardan cifrados con una llave que solo existe en el servidor. Cuando se configure, aquí podrás registrar tu autenticador.' }) }));
  }

  // --- Candado (6 dígitos) --------------------------------------------------------------------
  function casillas(id) {
    var h = '<div class="fin2-digitos" id="' + id + '" role="group" aria-label="Código de 6 dígitos">';
    for (var i = 0; i < 6; i++) h += '<input class="fin2-digito" inputmode="numeric" autocomplete="one-time-code" aria-label="Dígito ' + (i + 1) + '" data-i="' + i + '">';
    return h + '</div>';
  }
  function leerCasillas(id) { return Array.prototype.map.call(document.querySelectorAll('#' + id + ' .fin2-digito'), function (i) { return i.value; }).join(''); }
  function limpiarCasillas(id) { var c = document.querySelectorAll('#' + id + ' .fin2-digito'); Array.prototype.forEach.call(c, function (i) { i.value = ''; }); if (c[0]) c[0].focus(); }

  function pintarCerrada(aviso) {
    pagina(
      '<div class="fin2-candado">' +
        '<div class="fin2-candado__aura" aria-hidden="true"></div>' +
        '<div class="fin2-candado__caja sx2-entra">' +
          '<span class="fin2-candado__ico">' + U.ico('candado', 30) + '</span>' +
          '<h1>Bóveda de Finanzas</h1>' +
          '<p class="fin2-candado__txt">Escribe el código de 6 dígitos que muestra Google Authenticator en tu teléfono.</p>' +
          (aviso ? '<p class="fin2-aviso">' + txt(aviso) + '</p>' : '') +
          '<form class="js-fin-entrar">' + casillas('fin-cod') +
            '<p class="fin2-error" id="fin-err" role="alert"></p>' +
            U.boton({ texto: 'Abrir bóveda', icono: 'llave', variante: 'primario', tipo: 'submit', clase: 'fin2-ancho' }) +
          '</form>' +
          '<p class="fin2-pie">' + U.ico('escudo', 14) + ' Solo 4 personas tienen acceso. Cada ingreso queda registrado.</p>' +
        '</div>' +
      '</div>');
    setTimeout(function () { var p = document.querySelector('#fin-cod .fin2-digito'); if (p) p.focus(); }, 60);
  }

  // --- Registro del autenticador -----------------------------------------------------------
  function pintarRegistro() {
    pagina(cab('Activa tu acceso a la bóveda', 'Una sola vez. Necesitas tu teléfono con Google Authenticator instalado.') +
      '<ol class="fin2-pasos">' +
        '<li class="fin2-paso fin2-paso--activo"><span>1</span>Confirma tu contraseña</li>' +
        '<li class="fin2-paso"><span>2</span>Escanea el código</li>' +
        '<li class="fin2-paso"><span>3</span>Escribe el primer código</li>' +
      '</ol>' +
      U.card({ clase: 'fin2-registro', cuerpo:
        '<form class="js-fin-clave fin2-form">' +
          '<label class="fin2-label" for="fin-pass">Tu contraseña de SIGSO</label>' +
          '<input id="fin-pass" type="password" class="fin2-input" autocomplete="current-password" required>' +
          '<p class="fin2-ayuda">Se pide de nuevo para que nadie con tu sesión abierta pueda registrar su propio teléfono.</p>' +
          '<p class="fin2-error" id="fin-err" role="alert"></p>' +
          U.boton({ texto: 'Continuar', icono: 'derecha', variante: 'primario', tipo: 'submit' }) +
        '</form>' }));
    setTimeout(function () { var p = document.getElementById('fin-pass'); if (p) p.focus(); }, 60);
  }
  function pintarQr(datos) {
    pagina(cab('Activa tu acceso a la bóveda', 'Una sola vez. Necesitas tu teléfono con Google Authenticator instalado.') +
      '<ol class="fin2-pasos">' +
        '<li class="fin2-paso fin2-paso--hecho"><span>✓</span>Confirma tu contraseña</li>' +
        '<li class="fin2-paso fin2-paso--activo"><span>2</span>Escanea el código</li>' +
        '<li class="fin2-paso fin2-paso--activo"><span>3</span>Escribe el primer código</li>' +
      '</ol>' +
      U.card({ clase: 'fin2-registro', cuerpo:
        '<div class="fin2-qr-fila">' +
          '<div class="fin2-qr" id="fin-qr" aria-label="Código QR para Google Authenticator">' + U.ico('candado', 28) + '</div>' +
          '<div class="fin2-qr-pasos">' +
            '<p><b>En Google Authenticator:</b> toca <b>+</b> → <b>Escanear un código QR</b> y apunta a este código.</p>' +
            '<p class="fin2-ayuda">¿No puedes escanear? Elige <b>Ingresar una clave de configuración</b>, nombre «SIGSO Finanzas», y escribe:</p>' +
            '<code class="fin2-clave">' + txt(datos.clave) + '</code>' +
            '<p class="fin2-ayuda">No compartas esta clave ni le saques captura: quien la tenga puede generar tus códigos.</p>' +
          '</div>' +
        '</div>' +
        '<form class="js-fin-activar fin2-form fin2-form--sep">' +
          '<label class="fin2-label">Código de 6 dígitos que muestra la app</label>' + casillas('fin-cod') +
          '<p class="fin2-error" id="fin-err" role="alert"></p>' +
          U.boton({ texto: 'Activar y abrir la bóveda', icono: 'check', variante: 'primario', tipo: 'submit' }) +
        '</form>' }));
    dibujarQr(datos.uri);
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
  function dibujarQr(uri) {
    cargarLibQr().then(function (qrcode) {
      var q = qrcode(0, 'M'); q.addData(uri); q.make();
      var el = document.getElementById('fin-qr');
      if (el) el.innerHTML = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
    }).catch(function () {
      var el = document.getElementById('fin-qr');
      if (el) el.innerHTML = '<p class="fin2-ayuda">No se pudo dibujar el código QR. Usa la clave de configuración de la derecha.</p>';
    });
  }

  // --- Bóveda abierta ------------------------------------------------------------------------
  function abrir() {
    ultimoUso_ = Date.now();
    iniciarReloj();
    if (vista_ === 'bitacora') return verBitacora();
    if (vista_ === 'cobranza' && window.SigsoFinanzasCobranza) return SigsoFinanzasCobranza.ver(ctxBancos());
    if ((vista_ === 'bancos' || vista_ === 'movimientos') && window.SigsoFinanzasBancos) {
      return vista_ === 'bancos' ? SigsoFinanzasBancos.verBancos(ctxBancos()) : SigsoFinanzasBancos.verMovimientos(ctxBancos());
    }
    var t = ++turno_;
    pagina(cabAbierta('Resumen') + U.esqueleto('kpis', 4));
    api('finanzasResumen').then(function (r) {
      if (t !== turno_ || !r) return;
      if (!r.ok) { if (!r.boveda_cerrada) pagina(cabAbierta('Resumen') + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: r.message || '' }) })); return; }
      pintarResumen(r.data);
    });
  }
  var TITULOS_ = {
    Resumen: ['Bóveda de Finanzas', ''], 'Bitácora': ['Bitácora de accesos', 'Todo lo que se hace en la bóveda, en orden y encadenado.'],
    Bancos: ['Bancos', 'Sube la cartola del banco y el sistema la clasifica.'], Movimientos: ['Movimientos', 'Revisa lo que el sistema propone; lo que corriges, lo aprende.'],
    Cobranza: ['Cobranza', 'Lo que falta cobrar y desde hace cuánto; los pagos del banco se cruzan solos con las facturas.']
  };
  // Lo que necesita finanzas-bancos-v2.js para pintarse dentro de la bóveda.
  function ctxBancos() {
    var t = ++turno_;
    return {
      api: api, pagina: pagina, cab: cabAbierta, raiz: function () { return raiz_; },
      turno: function () { return t; }, vigente: function (n) { return n === turno_; },
      ir: function (v) { vista_ = v; abrir(); }
    };
  }
  function cabAbierta(seccion) {
    var tt = TITULOS_[seccion] || TITULOS_.Resumen;
    return cab(tt[0], tt[1],
      '<span class="fin2-abierta" title="Se cierra sola sin uso">' + U.ico('reloj', 14) + '<span id="fin-reloj">' + inactividadMin_ + ':00</span></span>' +
      U.segmento([{ id: 'inicio', texto: 'Resumen', icono: 'panel' }, { id: 'bancos', texto: 'Bancos', icono: 'dinero' }, { id: 'movimientos', texto: 'Movimientos', icono: 'tabla' }, { id: 'cobranza', texto: 'Cobranza', icono: 'recibo' }, { id: 'bitacora', texto: 'Bitácora', icono: 'lista' }], vista_, 'js-fin-vista') +
      U.boton({ texto: 'Cerrar bóveda', icono: 'candado', clase: 'js-fin-salir' }));
  }
  function capa(ok, titulo, texto) {
    return '<li class="fin2-capa' + (ok ? ' fin2-capa--ok' : ' fin2-capa--pend') + '"><span class="fin2-capa__ico">' + U.ico(ok ? 'check' : 'reloj', 14) + '</span>' +
      '<div><b>' + txt(titulo) + '</b><span>' + txt(texto) + '</span></div></li>';
  }
  function pintarResumen(d) {
    var activos = d.autenticadores_activos || 0, total = d.personas_con_acceso || 0;
    var ingresos = (d.ultimos_ingresos || []).map(function (i) {
      return '<li><span class="fin2-ing__quien">' + txt(i.nombre) + '</span><span class="fin2-ing__cuando">' + txt(fechaHora(i.ts)) + '</span></li>';
    }).join('');
    pagina(cabAbierta('Resumen') +
      '<div class="fin2-hero sx2-entra">' +
        '<div><p class="fin2-hero__k">Hola, ' + txt(String(d.nombre || '').split(' ')[0]) + '</p>' +
        '<h2>La bóveda está cerrada para el resto de SIGSO.</h2>' +
        '<p>Ya se pueden subir las cartolas del banco en <b>Bancos</b> y revisarlas en <b>Movimientos</b>. Más adelante aparecerán aquí la caja, la cobranza y el resultado de cada empresa.</p></div>' +
        '<span class="fin2-hero__ico" aria-hidden="true">' + U.ico('escudo', 44) + '</span>' +
      '</div>' +
      '<div class="sx2-fila-kpis">' +
        U.kpi({ etiqueta: 'Personas con acceso', valor: total, icono: 'equipo', i: 0 }) +
        U.kpi({ etiqueta: 'Autenticadores activos', valor: activos + ' de ' + total, icono: 'llave', tono: activos < total ? 'alerta' : 'ok', i: 1 }) +
        U.kpi({ etiqueta: 'Bitácora', valor: d.cadena && d.cadena.ok ? 'Íntegra' : 'Alterada', icono: 'escudo', tono: d.cadena && d.cadena.ok ? 'ok' : 'critico', i: 2 }) +
        U.kpi({ etiqueta: 'Registros en la bitácora', valor: d.cadena ? d.cadena.filas : 0, icono: 'lista', i: 3 }) +
      '</div>' +
      '<div class="fin2-grid">' +
        U.card({ titulo: 'Capas de seguridad', icono: 'escudo', i: 1, cuerpo: '<ul class="fin2-capas">' +
          capa(true, 'Lista fija de personas', 'Vive en el servidor. Nadie puede darse acceso desde una pantalla.') +
          capa(true, 'Invisible para el resto', 'Quien no está en la lista no ve el módulo y el servidor responde «no existe».') +
          capa(true, 'Segundo factor', 'Código de Google Authenticator para abrir; un código no sirve dos veces.') +
          capa(true, 'Base propia y cifrada', 'Archivo aparte de SIGSO, cifrado con AES-256. Sin la llave del servidor no se lee.') +
          capa(true, 'Se cierra sola', inactividadMin_ + ' minutos sin uso, o al cerrar la pestaña.') +
          capa(activos >= total && total > 0, 'Todos con autenticador', activos >= total ? (total === 1 ? 'La única persona de la lista ya lo activó.' : 'Las ' + total + ' personas ya lo activaron.') : (total - activos === 1 ? 'Falta 1 persona por activar el suyo.' : 'Faltan ' + (total - activos) + ' personas por activar el suyo.')) +
        '</ul>' }) +
        U.card({ titulo: 'Últimos ingresos', icono: 'reloj', i: 2, accion: { texto: 'Ver bitácora', clase: 'js-fin-ir-bitacora' }, cuerpo:
          (ingresos ? '<ul class="fin2-ing">' + ingresos + '</ul>' : U.vacio({ icono: 'reloj', texto: 'Aún no hay ingresos.' })) }) +
        U.card({ titulo: 'Lo que viene', icono: 'capas', i: 3, cuerpo: '<ol class="fin2-etapas">' +
          '<li class="fin2-etapa--hecha"><b>E1 · La bóveda</b><span>Candado, autenticador y bitácora</span></li>' +
          '<li class="fin2-etapa--hecha"><b>E2 · Bancos y cartolas</b><span>Subir la cartola, cuadrar y clasificar</span></li>' +
          '<li class="fin2-etapa--hecha"><b>E3 · Clientes y cobranza</b><span>Facturas del SII, abonos y cartera real</span></li>' +
          '<li><b>E4 · Tablero de gerencia</b><span>Gráficos e informe mensual</span></li>' +
          '<li><b>E5 · Presupuesto</b><span>Proyectado vs. real</span></li>' +
          '<li><b>E6 · Retiro de la planilla</b><span>Un mes en paralelo y se archiva</span></li>' +
        '</ol>' }) +
      '</div>');
    if (U.animar) U.animar(raiz_);
  }

  function verBitacora() {
    vista_ = 'bitacora';
    var t = ++turno_;
    pagina(cabAbierta('Bitácora') + U.esqueleto('tabla', 8));
    api('finanzasBitacora', { limite: 300 }).then(function (r) {
      if (t !== turno_ || !r || !r.ok) return;
      var c = r.data.cadena;
      var filas = r.data.filas.map(function (f) {
        var a = NOMBRES_ACCION[f.accion] || [f.accion, 'neutro'];
        return '<tr><td class="fin2-num">' + txt(fechaHora(f.ts)) + '</td><td>' + txt(f.nombre || '—') + '</td><td>' + U.badge(a[0], a[1]) +
          (f.detalle ? ' <span class="fin2-det">' + txt(f.detalle) + '</span>' : '') + '</td><td class="fin2-mono">' + txt(f.ip) + '</td><td class="fin2-mono" title="' + txt(f.equipo) + '">' + txt(String(f.equipo || '').slice(0, 8)) + '</td></tr>';
      }).join('');
      pagina(cabAbierta('Bitácora') +
        '<div class="fin2-cadena ' + (c.ok ? 'fin2-cadena--ok' : 'fin2-cadena--mal') + ' sx2-entra">' + U.ico(c.ok ? 'escudo' : 'alerta', 18) +
          (c.ok ? '<span><b>Bitácora íntegra.</b> Las ' + c.filas + ' entradas están encadenadas: si alguien editara o borrara una, se notaría aquí.</span>'
                : '<span><b>Atención: la bitácora fue alterada</b> desde la entrada ' + c.rota_en + '. Avisa a Luis.</span>') + '</div>' +
        U.card({ sinRelleno: true, cuerpo: '<div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>Cuándo</th><th>Quién</th><th>Qué</th><th>IP</th><th>Equipo</th></tr></thead><tbody>' +
          (filas || '<tr><td colspan="5">Sin registros.</td></tr>') + '</tbody></table></div>' }));
    });
  }

  // --- Reloj de inactividad -----------------------------------------------------------------
  function iniciarReloj() {
    detenerReloj();
    reloj_ = setInterval(function () {
      var resta = inactividadMin_ * 60000 - (Date.now() - ultimoUso_);
      var el = document.getElementById('fin-reloj');
      if (resta <= 0) { detenerReloj(); guardarToken(''); pintarCerrada('La bóveda se cerró por inactividad.'); return; }
      if (el) {
        var m = Math.floor(resta / 60000), s = Math.floor((resta % 60000) / 1000);
        el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
        el.parentNode.classList.toggle('fin2-abierta--pronto', resta < 120000);
      }
    }, 1000);
  }
  function detenerReloj() { if (reloj_) { clearInterval(reloj_); reloj_ = null; } }

  // --- Eventos ----------------------------------------------------------------------------------
  function error(msg) { var e = document.getElementById('fin-err'); if (e) e.textContent = msg || ''; }
  function ocupado(form, si) { var b = form.querySelector('button[type=submit]'); if (b) b.disabled = !!si; }

  function enlazar() {
    if (!raiz_ || raiz_.dataset.finEnlazado) return;
    raiz_.dataset.finEnlazado = '1';
    raiz_.addEventListener('submit', function (ev) {
      var f = ev.target;
      if (f.classList.contains('js-fin-clave')) {
        ev.preventDefault(); ocupado(f, true); error('');
        api('finanzasPrepararAutenticador', { password: document.getElementById('fin-pass').value }).then(function (r) {
          ocupado(f, false);
          if (!r || !r.ok) return error((r && r.message) || 'No se pudo continuar.');
          pintarQr(r.data);
        });
      } else if (f.classList.contains('js-fin-activar') || f.classList.contains('js-fin-entrar')) {
        ev.preventDefault();
        var codigo = leerCasillas('fin-cod');
        if (codigo.length !== 6) return error('Escribe los 6 dígitos.');
        ocupado(f, true); error('');
        var activar = f.classList.contains('js-fin-activar');
        api(activar ? 'finanzasActivarAutenticador' : 'finanzasEntrar', { codigo: codigo }).then(function (r) {
          ocupado(f, false);
          if (!r || !r.ok) { error((r && r.message) || 'No se pudo abrir.'); limpiarCasillas('fin-cod'); var caja = document.querySelector('.fin2-digitos'); if (caja) { caja.classList.remove('fin2-sacude'); void caja.offsetWidth; caja.classList.add('fin2-sacude'); } return; }
          guardarToken(r.data.boveda_token);
          inactividadMin_ = r.data.inactividad_min || inactividadMin_;
          vista_ = 'inicio';
          var c = document.querySelector('.fin2-candado__caja');
          if (c) { c.classList.add('fin2-abre'); setTimeout(abrir, 420); } else abrir();
        });
      }
    });
    raiz_.addEventListener('input', function (ev) {
      var i = ev.target;
      if (!i.classList.contains('fin2-digito')) return;
      var v = i.value.replace(/\D/g, '');
      if (v.length > 1) { // pegó el código (o escribió rápido): se reparte desde esta casilla
        var todas = i.parentNode.querySelectorAll('.fin2-digito');
        var desde = v.length >= 6 ? 0 : Number(i.dataset.i) || 0;
        v.slice(0, 6 - desde).split('').forEach(function (d, k) { if (todas[desde + k]) todas[desde + k].value = d; });
        var ult = todas[Math.min(desde + v.length, 6) - 1]; if (ult) ult.focus();
      } else {
        i.value = v;
        if (v && i.nextElementSibling) i.nextElementSibling.focus();
      }
      if (leerCasillas(i.parentNode.id).length === 6) { var form = i.closest('form'); if (form && form.requestSubmit) form.requestSubmit(); }
    });
    raiz_.addEventListener('keydown', function (ev) {
      var i = ev.target;
      if (i.classList && i.classList.contains('fin2-digito') && ev.key === 'Backspace' && !i.value && i.previousElementSibling) i.previousElementSibling.focus();
    });
    raiz_.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      if (b.classList.contains('js-fin-salir')) {
        api('finanzasSalir').then(function () { guardarToken(''); detenerReloj(); pintarCerrada('Cerraste la bóveda.'); });
      } else if (b.classList.contains('js-fin-ir-bitacora')) {
        verBitacora();
      } else if (b.closest('.js-fin-vista') && b.dataset.id) {
        vista_ = b.dataset.id;
        if (vista_ === 'cobranza' && window.SigsoFinanzasCobranza) SigsoFinanzasCobranza.reiniciar();
        if (vista_ === 'bitacora') verBitacora(); else abrir();
      }
    });
  }

  window.SigsoFinanzas = { cargar: cargar, refrescar: refrescar };
})();
