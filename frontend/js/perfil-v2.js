/**
 * perfil-v2.js — "Mi perfil" (v2) y servicio de fotos de perfil.
 *
 * Reemplaza a perfil.js en la plataforma (perfil.js queda solo para app.html
 * y admin.html). Mismo window.SigsoPerfil, así que nada que lo use cambia:
 *  - fotoDe / precargarFotos: el caché de miniaturas que leen los avatares
 *    v2 de toda la plataforma (UIv2.avatar).
 *  - abrir: el panel "Mi perfil", ahora un drawer v2 con foto (subir,
 *    recortar, eliminar), datos de la cuenta y cambio de contraseña.
 *
 * El recorte se hace con Canvas nativo: el backend no redimensiona, así que
 * la miniatura sale de aquí y viaja junto al original (el backend la vuelve
 * a validar por firma binaria, no confía en ella).
 */
(function () {
  'use strict';

  var U = window.UIv2;
  var LADO_THUMB = 160;          // cubre el avatar más grande en pantallas 2x
  var CALIDAD_THUMB = 0.85;
  var MAX_BYTES = 5 * 1024 * 1024;
  var TIPOS_OK = ['image/jpeg', 'image/png', 'image/webp'];
  var LADO_RECORTE = 260;

  var ETIQUETA_ROL = {
    ADM: 'Administrador', ANA: 'Analista', DEV: 'Desarrollador',
    GERENCIA: 'Gerencia', JEFATURA: 'Jefatura', SOLICITANTE: 'Solicitante'
  };

  // --- Caché de fotos (correo -> miniatura) ---------------------------------------
  // En memoria + sessionStorage con 10 min de vigencia: una lista de
  // comentarios no dispara una llamada por autor, y un cambio de foto se ve
  // sin cerrar la pestaña. null = "sabemos que no tiene foto".
  var LLAVE_CACHE = 'sigso_fotos_perfil';
  var VIGENCIA_MS = 10 * 60 * 1000;
  var fotos_ = leerCache_();
  var perfilActual_ = null;

  function leerCache_() {
    try {
      var g = JSON.parse(sessionStorage.getItem(LLAVE_CACHE) || 'null');
      return g && (Date.now() - g.ts) <= VIGENCIA_MS ? (g.fotos || {}) : {};
    } catch (e) { return {}; }
  }
  function guardarCache_() {
    try { sessionStorage.setItem(LLAVE_CACHE, JSON.stringify({ ts: Date.now(), fotos: fotos_ })); } catch (e) { /* cuota llena: queda en memoria */ }
  }
  function norm(c) { return String(c || '').trim().toLowerCase(); }

  function api(accion, datos) {
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, accion, datos || {}).catch(function (e) {
      return { ok: false, message: (e && e.message) || 'No se pudo conectar.' };
    });
  }
  function aviso(texto, tipo) { if (window.PYv2 && PYv2.aviso) PYv2.aviso(texto, tipo); }

  // Pide en UNA llamada las miniaturas que faltan.
  function precargarFotos(correos) {
    var faltan = (correos || []).map(norm).filter(function (c, i, l) { return c && fotos_[c] === undefined && l.indexOf(c) === i; });
    if (!faltan.length) return Promise.resolve(fotos_);
    return api('getFotosPerfil', { emails: faltan }).then(function (r) {
      var f = (r && r.ok && r.data && r.data.fotos) || {};
      faltan.forEach(function (c) { fotos_[c] = f[c] || null; });
      guardarCache_();
      return fotos_;
    });
  }
  function fotoDe(correo) { return fotos_[norm(correo)] || ''; }
  function avatarDe(nombre, correo, opts) {
    var tam = opts && opts.tam;
    return U.avatar({ nombre: nombre || correo, email: correo, foto: fotoDe(correo) }, tam === 'md' ? 'lg' : tam);
  }

  // --- Imagen ----------------------------------------------------------------------
  function leerDataUrl(archivo) {
    return new Promise(function (ok, mal) {
      var l = new FileReader();
      l.onload = function () { ok(l.result); };
      l.onerror = function () { mal(new Error('No se pudo leer el archivo.')); };
      l.readAsDataURL(archivo);
    });
  }
  function cargarImagen(dataUrl) {
    return new Promise(function (ok, mal) {
      var img = new Image();
      img.onload = function () { ok(img); };
      img.onerror = function () { mal(new Error('El archivo no es una imagen que el navegador pueda abrir.')); };
      img.src = dataUrl;
    });
  }
  function soloBase64(dataUrl) { var i = String(dataUrl || '').indexOf(','); return i === -1 ? '' : dataUrl.slice(i + 1); }
  // Solo para avisar al tiro; la validación que protege está en el backend.
  function validarArchivo(a) {
    if (!a) return 'No se seleccionó ningún archivo.';
    if (TIPOS_OK.indexOf(a.type) === -1) return 'Formato no permitido. Usa una imagen JPG, PNG o WebP.';
    if (a.size > MAX_BYTES) return 'La imagen pesa ' + (a.size / 1048576).toFixed(1) + ' MB y el máximo es 5 MB. Prueba con una más liviana.';
    return null;
  }

  // Recortador: arrastrar para encuadrar, zoom 1x-3x sobre la escala que
  // cubre justo el círculo (nunca quedan franjas vacías).
  function montarRecortador(raiz, imagen) {
    var lienzo = raiz.querySelector('canvas');
    var zona = raiz.querySelector('.pf2-recorte__lienzo');
    var zoom = raiz.querySelector('.js-pf2-zoom');
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    lienzo.width = LADO_RECORTE * dpr;
    lienzo.height = LADO_RECORTE * dpr;
    var ctx = lienzo.getContext('2d');
    var escalaMin = Math.max(LADO_RECORTE / imagen.width, LADO_RECORTE / imagen.height);
    var escala = escalaMin;
    var d = { x: 0, y: 0 };

    function pintar() {
      var mx = Math.max(0, (imagen.width * escala - LADO_RECORTE) / 2);
      var my = Math.max(0, (imagen.height * escala - LADO_RECORTE) / 2);
      d.x = Math.max(-mx, Math.min(mx, d.x));
      d.y = Math.max(-my, Math.min(my, d.y));
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, LADO_RECORTE, LADO_RECORTE);
      var w = imagen.width * escala, h = imagen.height * escala;
      ctx.drawImage(imagen, (LADO_RECORTE - w) / 2 + d.x, (LADO_RECORTE - h) / 2 + d.y, w, h);
      ctx.restore();
    }
    var arrastrando = false, ultimo = { x: 0, y: 0 };
    zona.addEventListener('pointerdown', function (ev) { arrastrando = true; ultimo = { x: ev.clientX, y: ev.clientY }; zona.setPointerCapture(ev.pointerId); });
    zona.addEventListener('pointermove', function (ev) {
      if (!arrastrando) return;
      d.x += ev.clientX - ultimo.x; d.y += ev.clientY - ultimo.y;
      ultimo = { x: ev.clientX, y: ev.clientY };
      pintar();
    });
    ['pointerup', 'pointercancel'].forEach(function (n) {
      zona.addEventListener(n, function (ev) {
        arrastrando = false;
        if (zona.hasPointerCapture && zona.hasPointerCapture(ev.pointerId)) zona.releasePointerCapture(ev.pointerId);
      });
    });
    zoom.addEventListener('input', function () { escala = escalaMin * (parseFloat(zoom.value) || 1); pintar(); });
    zona.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var n = Math.max(1, Math.min(3, (escala / escalaMin) * (ev.deltaY < 0 ? 1.08 : 1 / 1.08)));
      zoom.value = String(n); escala = escalaMin * n; pintar();
    }, { passive: false });
    pintar();

    return function generarThumb() {
      var s = document.createElement('canvas');
      s.width = LADO_THUMB; s.height = LADO_THUMB;
      var sc = s.getContext('2d');
      sc.fillStyle = '#FFFFFF'; // un PNG transparente pasado a JPEG quedaría negro
      sc.fillRect(0, 0, LADO_THUMB, LADO_THUMB);
      var k = LADO_THUMB / LADO_RECORTE;
      var w = imagen.width * escala * k, h = imagen.height * escala * k;
      sc.drawImage(imagen, (LADO_THUMB - w) / 2 + d.x * k, (LADO_THUMB - h) / 2 + d.y * k, w, h);
      return s.toDataURL('image/jpeg', CALIDAD_THUMB);
    };
  }

  // --- Panel -----------------------------------------------------------------------
  function fechaHora(iso) {
    var f = iso ? new Date(iso) : null;
    return f && !isNaN(f.getTime()) ? f.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  }
  function dato(et, valor) { return '<div class="pf2-dato"><dt>' + U.esc(et) + '</dt><dd>' + U.esc(valor || '—') + '</dd></div>'; }
  function campoClave(id, etiqueta, auto, ayuda) {
    return '<div class="sx2-campo"><label class="sx2-campo__et" for="' + id + '">' + U.esc(etiqueta) + '</label>' +
      '<input class="sx2-input" type="password" id="' + id + '" autocomplete="' + auto + '" required>' +
      (ayuda ? '<span class="sx2-campo__ayuda">' + U.esc(ayuda) + '</span>' : '') + '</div>';
  }

  function vistaHtml(p) {
    var portal = p.origen === 'PORTAL';
    return '<div class="pf2">' +
      '<section class="pf2-id">' +
        '<div class="pf2-foto">' + U.avatar({ nombre: p.nombre, foto: p.foto_thumb }, 'xl') + '</div>' +
        '<div class="pf2-id__txt">' +
          '<p class="pf2-id__nombre">' + U.esc(p.nombre) + '</p>' +
          U.badge(ETIQUETA_ROL[p.rol] || p.rol, 'primario') +
          '<div class="pf2-id__acciones">' +
            U.boton({ texto: p.tiene_foto ? 'Cambiar foto' : 'Subir foto', icono: 'camara', variante: 'primario', sm: true, clase: 'js-pf2-foto' }) +
            (p.tiene_foto ? U.boton({ texto: 'Eliminar foto', icono: 'basura', variante: 'fantasma', sm: true, clase: 'js-pf2-eliminar pf2-peligro' }) : '') +
          '</div>' +
        '</div>' +
      '</section>' +
      '<section class="pf2-seccion">' +
        '<h3 class="pf2-seccion__tit">Tu cuenta</h3>' +
        '<dl class="pf2-datos">' +
          dato('Correo', p.email) +
          (p.cargo ? dato('Cargo', p.cargo) : '') +
          dato('Empresa', p.empresa_nombre || p.empresa_id) +
          // Último acceso solo existe para cuentas del portal (usuario/clave).
          (portal ? dato('Último acceso', p.ultimo_acceso ? fechaHora(p.ultimo_acceso) : 'Nunca entró') : '') +
        '</dl>' +
        '<p class="pf2-nota">' + U.ico('candado', 14) + '<span>Estos datos los administra el equipo de SIGSO. Si algo no corresponde, avisa a un administrador.</span></p>' +
      '</section>' +
      // Una sesión Google (legado) no tiene contraseña de SIGSO que cambiar.
      (portal ?
        '<section class="pf2-seccion">' +
          '<div class="pf2-seccion__cab"><h3 class="pf2-seccion__tit">Seguridad</h3>' +
            U.boton({ texto: 'Cambiar contraseña', icono: 'candado', sm: true, clase: 'js-pf2-clave-abrir' }) + '</div>' +
          '<form class="sx2-form pf2-clave js-pf2-clave" novalidate hidden>' +
            campoClave('pf2-clave-actual', 'Contraseña actual', 'current-password') +
            campoClave('pf2-clave-nueva', 'Contraseña nueva', 'new-password', 'Mínimo 8 caracteres, distinta de la actual.') +
            campoClave('pf2-clave-repetir', 'Repite la contraseña nueva', 'new-password') +
            '<p class="sx2-campo__error js-pf2-clave-error" role="alert" hidden></p>' +
            '<div class="pf2-clave__acciones">' +
              U.boton({ texto: 'Cancelar', clase: 'js-pf2-clave-cancelar' }) +
              U.boton({ texto: 'Guardar contraseña', icono: 'check', variante: 'primario', tipo: 'submit', clase: 'js-pf2-clave-guardar' }) +
            '</div>' +
          '</form>' +
        '</section>' : '') +
      '<input type="file" accept="image/jpeg,image/png,image/webp" class="js-pf2-archivo" hidden>' +
    '</div>';
  }

  function recorteHtml() {
    return '<div class="pf2-recorte">' +
      '<p class="sx2-tenue">Arrastra la imagen para encuadrar tu cara; así se verá tu foto.</p>' +
      '<div class="pf2-recorte__lienzo"><canvas></canvas></div>' +
      '<label class="pf2-recorte__zoom">' + U.ico('lupa', 16) + '<span class="sx2-oculto-visual">Zoom</span>' +
        '<input type="range" class="js-pf2-zoom" min="1" max="3" step="0.01" value="1" aria-label="Zoom"></label>' +
      '<div class="pf2-clave__acciones">' +
        U.boton({ texto: 'Cancelar', clase: 'js-pf2-rec-cancelar' }) +
        U.boton({ texto: 'Guardar foto', icono: 'check', variante: 'primario', clase: 'js-pf2-rec-guardar' }) +
      '</div>' +
    '</div>';
  }

  function abrir() {
    var dr = U.drawer({
      titulo: 'Mi perfil',
      cuerpo: '<div class="sx2-pagina">' + U.esqueleto('tarjetas', 2) + '</div>'
    });
    api('getMiPerfil', {}).then(function (r) {
      if (!r || !r.ok) { dr.cuerpo(U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar tu perfil', texto: (r && r.message) || '' })); return; }
      perfilActual_ = r.data;
      pintarVista(dr, r.data);
    });
    return { cerrar: function () { dr.cerrar(); } };
  }

  function pintarVista(dr, p) {
    dr.cuerpo(vistaHtml(p));
    var raiz = dr.el.querySelector('.pf2');
    var archivo = raiz.querySelector('.js-pf2-archivo');

    raiz.querySelector('.js-pf2-foto').addEventListener('click', function () { archivo.value = ''; archivo.click(); });
    archivo.addEventListener('change', function () {
      var a = archivo.files && archivo.files[0];
      var error = validarArchivo(a);
      if (error) { aviso(error, 'error'); return; }
      leerDataUrl(a).then(cargarImagen).then(function (img) { pintarRecorte(dr, p, a, img); })
        .catch(function (e) { aviso(e.message || 'No se pudo abrir la imagen.', 'error'); });
    });

    var eliminar = raiz.querySelector('.js-pf2-eliminar');
    if (eliminar) eliminar.addEventListener('click', function () {
      U.confirmar({ titulo: 'Eliminar tu foto de perfil', texto: 'Volverás a aparecer con tus iniciales. Tus datos de usuario no cambian.', boton: 'Eliminar foto', peligro: true })
        .then(function (si) {
          if (!si) return;
          eliminar.disabled = true;
          api('eliminarFotoPerfil', {}).then(function (r) {
            eliminar.disabled = false;
            if (!r || !r.ok) { aviso((r && r.message) || 'No se pudo eliminar la foto.', 'error'); return; }
            aplicarCambio(dr, p, '', 'Foto eliminada. Ahora apareces con tus iniciales.');
          });
        });
    });

    var form = raiz.querySelector('.js-pf2-clave');
    if (form) cablearClave(raiz, form);
  }

  function cablearClave(raiz, form) {
    var abrirBtn = raiz.querySelector('.js-pf2-clave-abrir');
    var error = form.querySelector('.js-pf2-clave-error');
    var guardar = form.querySelector('.js-pf2-clave-guardar');
    function mostrarError(t) { error.textContent = t || ''; error.hidden = !t; }
    function alternar(ver) {
      form.hidden = !ver;
      abrirBtn.hidden = ver;
      if (ver) form.querySelector('#pf2-clave-actual').focus();
      else { form.reset(); mostrarError(''); }
    }
    abrirBtn.addEventListener('click', function () { alternar(true); });
    form.querySelector('.js-pf2-clave-cancelar').addEventListener('click', function () { alternar(false); });
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var actual = form.querySelector('#pf2-clave-actual').value;
      var nueva = form.querySelector('#pf2-clave-nueva').value;
      if (nueva.length < 8) { mostrarError('La contraseña nueva debe tener al menos 8 caracteres.'); return; }
      if (nueva !== form.querySelector('#pf2-clave-repetir').value) { mostrarError('Las contraseñas nuevas no coinciden.'); return; }
      mostrarError('');
      guardar.disabled = true;
      var token = null;
      try { token = localStorage.getItem('sigso_portal_token'); } catch (e) { /* sin storage */ }
      api('portalCambiarPassword', { token: token, password_actual: actual, password_nueva: nueva }).then(function (r) {
        guardar.disabled = false;
        if (!r || !r.ok) { mostrarError((r && r.message) || 'No se pudo cambiar la contraseña.'); return; }
        alternar(false);
        aviso('Contraseña actualizada.', 'exito');
      });
    });
  }

  function pintarRecorte(dr, p, archivo, imagen) {
    dr.cuerpo(recorteHtml());
    var raiz = dr.el.querySelector('.pf2-recorte');
    var generarThumb = montarRecortador(raiz, imagen);
    raiz.querySelector('.js-pf2-rec-cancelar').addEventListener('click', function () { pintarVista(dr, p); });
    var guardar = raiz.querySelector('.js-pf2-rec-guardar');
    guardar.addEventListener('click', function () {
      guardar.disabled = true;
      var thumb = generarThumb();
      leerDataUrl(archivo).then(function (original) {
        return api('guardarFotoPerfil', { contenido_base64: soloBase64(original), thumb_base64: soloBase64(thumb), nombre_archivo: archivo.name || 'foto' });
      }).then(function (r) {
        guardar.disabled = false;
        if (!r || !r.ok) { aviso((r && r.message) || 'No se pudo guardar la foto.', 'error'); return; }
        aplicarCambio(dr, p, r.data.foto_thumb, 'Foto actualizada.');
      }, function () { guardar.disabled = false; aviso('No se pudo conectar para guardar la foto.', 'error'); });
    });
  }

  // Un solo lugar donde se refleja "la foto cambió": panel, caché y aviso al
  // resto de la interfaz (el menú de usuario y los avatares se repintan).
  function aplicarCambio(dr, p, foto, mensaje) {
    p.foto_thumb = foto;
    p.tiene_foto = !!foto;
    perfilActual_ = p;
    var c = norm(p.email);
    if (c) { fotos_[c] = foto || null; guardarCache_(); }
    pintarVista(dr, p);
    aviso(mensaje, 'exito');
    document.dispatchEvent(new CustomEvent('sigso:perfil-actualizado', { detail: { email: c, foto: foto } }));
  }

  window.SigsoPerfil = {
    abrir: abrir,
    precargarFotos: precargarFotos,
    fotoDe: fotoDe,
    avatarDe: avatarDe,
    perfilActual: function () { return perfilActual_; }
  };
})();
