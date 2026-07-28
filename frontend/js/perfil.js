/**
 * perfil.js — panel "Mi perfil" y gestion de la foto (v6.4).
 *
 * Se implementa como MODAL autocontenido a proposito: asi el mismo codigo
 * sirve al shell por token (plataforma.html) y al Backoffice con login
 * Google (app.html), que tienen layouts completamente distintos y donde
 * meter una "pantalla" mas habria significado dos implementaciones.
 *
 * EL RECORTE se hace con Canvas nativo, sin ninguna libreria. Apps Script no
 * tiene API de redimensionado de imagenes, asi que la miniatura la genera
 * este archivo y viaja junto al original; el backend la vuelve a validar por
 * firma binaria (no confia en ella) -- ver Perfiles.gs.
 *
 * Expone window.SigsoPerfil = { abrir, avatarDe, precargarFotos, fotoDe }.
 */
(function () {
  // Lado de la miniatura. 160px cubre de sobra el avatar mas grande que se
  // muestra (116px) incluso en pantallas 2x, y deja el base64 en ~8-14k
  // caracteres, lejos del limite de 50.000 de una celda de Sheets.
  var LADO_THUMB = 160;
  var CALIDAD_THUMB = 0.85;
  var MAX_BYTES = 5 * 1024 * 1024;
  var TIPOS_OK = ['image/jpeg', 'image/png', 'image/webp'];

  // Cache en memoria de correo -> miniatura, para que una lista de
  // comentarios no dispare una llamada por autor.
  var fotosPorCorreo_ = {};
  var perfilActual_ = null;

  function urlBackoffice_() {
    var cfg = window.SIGSO_CONFIG || {};
    return cfg.BACKOFFICE_URL;
  }

  function api_(accion, datos) {
    return llamarApi(urlBackoffice_(), accion, datos || {});
  }

  // --- Utilidades de imagen ----------------------------------------------

  function leerComoDataUrl_(archivo) {
    return new Promise(function (resolver, rechazar) {
      var lector = new FileReader();
      lector.onload = function () { resolver(lector.result); };
      lector.onerror = function () { rechazar(new Error('No se pudo leer el archivo.')); };
      lector.readAsDataURL(archivo);
    });
  }

  function cargarImagen_(dataUrl) {
    return new Promise(function (resolver, rechazar) {
      var img = new Image();
      img.onload = function () { resolver(img); };
      img.onerror = function () { rechazar(new Error('El archivo no es una imagen que el navegador pueda abrir.')); };
      img.src = dataUrl;
    });
  }

  function soloBase64_(dataUrl) {
    var coma = String(dataUrl || '').indexOf(',');
    return coma === -1 ? '' : dataUrl.slice(coma + 1);
  }

  // Validacion en el navegador. NO es la que protege el sistema (esa esta en
  // Perfiles.gs, por firma binaria): esta solo existe para dar un mensaje
  // inmediato y no subir 5 MB para nada.
  function validarArchivo_(archivo) {
    if (!archivo) return 'No se selecciono ningun archivo.';
    if (TIPOS_OK.indexOf(archivo.type) === -1) {
      return 'Formato no permitido. Usa una imagen JPG, PNG o WebP.';
    }
    if (archivo.size > MAX_BYTES) {
      var mb = (archivo.size / (1024 * 1024)).toFixed(1);
      return 'La imagen pesa ' + mb + ' MB y el maximo es 5 MB. Prueba con una mas liviana.';
    }
    return null;
  }

  // --- Recorte con Canvas -------------------------------------------------

  /**
   * Monta el recortador dentro de `contenedor`. El usuario arrastra la
   * imagen y ajusta el zoom; el area visible es un circulo, que es
   * exactamente como se vera despues.
   * Devuelve { generarThumb } -> data URL JPEG de LADO_THUMB x LADO_THUMB.
   */
  function montarRecortador_(contenedor, imagen) {
    var lienzo = contenedor.querySelector('.sigso-recorte__lienzo canvas');
    var deslizador = contenedor.querySelector('.js-zoom');
    // Se dibuja a resolucion del dispositivo para que no se vea borroso en
    // pantallas retina.
    var LADO_CSS = 260;
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    lienzo.width = LADO_CSS * dpr;
    lienzo.height = LADO_CSS * dpr;
    var ctx = lienzo.getContext('2d');

    // escalaMin = la escala a la que la imagen cubre justo el circulo. Nunca
    // se permite bajar de ahi: asi no pueden quedar franjas vacias.
    var escalaMin = Math.max(LADO_CSS / imagen.width, LADO_CSS / imagen.height);
    var escala = escalaMin;
    var desplazamiento = { x: 0, y: 0 };

    function limitar_() {
      // El borde de la imagen nunca puede entrar en el circulo.
      var maxX = Math.max(0, (imagen.width * escala - LADO_CSS) / 2);
      var maxY = Math.max(0, (imagen.height * escala - LADO_CSS) / 2);
      desplazamiento.x = Math.max(-maxX, Math.min(maxX, desplazamiento.x));
      desplazamiento.y = Math.max(-maxY, Math.min(maxY, desplazamiento.y));
    }

    function pintar_() {
      limitar_();
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, LADO_CSS, LADO_CSS);
      var ancho = imagen.width * escala;
      var alto = imagen.height * escala;
      ctx.drawImage(
        imagen,
        (LADO_CSS - ancho) / 2 + desplazamiento.x,
        (LADO_CSS - alto) / 2 + desplazamiento.y,
        ancho, alto
      );
      ctx.restore();
    }

    // Pointer events cubren raton, dedo y lapiz con un solo camino. El CSS
    // pone touch-action:none, sin lo cual el navegador se quedaria el gesto
    // para hacer scroll y en movil no se podria mover la foto.
    var arrastrando = false;
    var ultimo = { x: 0, y: 0 };
    var zona = contenedor.querySelector('.sigso-recorte__lienzo');

    zona.addEventListener('pointerdown', function (ev) {
      arrastrando = true;
      ultimo = { x: ev.clientX, y: ev.clientY };
      zona.setPointerCapture(ev.pointerId);
    });
    zona.addEventListener('pointermove', function (ev) {
      if (!arrastrando) return;
      desplazamiento.x += ev.clientX - ultimo.x;
      desplazamiento.y += ev.clientY - ultimo.y;
      ultimo = { x: ev.clientX, y: ev.clientY };
      pintar_();
    });
    ['pointerup', 'pointercancel'].forEach(function (evento) {
      zona.addEventListener(evento, function (ev) {
        arrastrando = false;
        if (zona.hasPointerCapture && zona.hasPointerCapture(ev.pointerId)) {
          zona.releasePointerCapture(ev.pointerId);
        }
      });
    });

    // El deslizador va de 1x a 3x sobre la escala minima.
    deslizador.addEventListener('input', function () {
      escala = escalaMin * (parseFloat(deslizador.value) || 1);
      pintar_();
    });

    // Rueda del raton: el mismo gesto que espera cualquiera sobre una foto.
    zona.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var factor = ev.deltaY < 0 ? 1.08 : 1 / 1.08;
      var nuevo = Math.max(1, Math.min(3, (escala / escalaMin) * factor));
      deslizador.value = String(nuevo);
      escala = escalaMin * nuevo;
      pintar_();
    }, { passive: false });

    pintar_();

    return {
      generarThumb: function () {
        var salida = document.createElement('canvas');
        salida.width = LADO_THUMB;
        salida.height = LADO_THUMB;
        var sctx = salida.getContext('2d');
        // Fondo blanco: si la imagen tiene transparencia (PNG), al pasar a
        // JPEG el alfa se volveria negro.
        sctx.fillStyle = '#FFFFFF';
        sctx.fillRect(0, 0, LADO_THUMB, LADO_THUMB);

        var k = LADO_THUMB / LADO_CSS;
        var ancho = imagen.width * escala * k;
        var alto = imagen.height * escala * k;
        sctx.drawImage(
          imagen,
          (LADO_THUMB - ancho) / 2 + desplazamiento.x * k,
          (LADO_THUMB - alto) / 2 + desplazamiento.y * k,
          ancho, alto
        );
        return salida.toDataURL('image/jpeg', CALIDAD_THUMB);
      }
    };
  }

  // --- Panel --------------------------------------------------------------

  var ETIQUETA_ROL = {
    ADM: 'Administrador', ANA: 'Analista', DEV: 'Desarrollador',
    GERENCIA: 'Gerencia', JEFATURA: 'Jefatura', SOLICITANTE: 'Solicitante'
  };

  function abrir() {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true" aria-labelledby="perfil-titulo">' +
        '<h3 class="sigso-modal__titulo" id="perfil-titulo">Mi perfil</h3>' +
        '<div class="js-perfil-cuerpo">' + Componentes.cargando('Cargando tu perfil...') + '</div>' +
        '<div class="sigso-modal__acciones">' +
          Componentes.boton({ texto: 'Cerrar', variante: 'sutil', clase: 'js-perfil-cerrar' }) +
        '</div>' +
      '</div>';

    function cerrar() {
      document.removeEventListener('keydown', alTeclado);
      if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
    }
    function alTeclado(ev) { if (ev.key === 'Escape') cerrar(); }

    fondo.addEventListener('click', function (ev) { if (ev.target === fondo) cerrar(); });
    fondo.querySelector('.js-perfil-cerrar').addEventListener('click', cerrar);
    document.addEventListener('keydown', alTeclado);
    document.body.appendChild(fondo);

    var cuerpo = fondo.querySelector('.js-perfil-cuerpo');

    api_('getMiPerfil', {}).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cuerpo.innerHTML = Componentes.alerta(
          (respuesta && respuesta.message) || 'No se pudo cargar tu perfil.', 'error'
        );
        return;
      }
      perfilActual_ = respuesta.data;
      renderVista_(cuerpo, respuesta.data);
    }).catch(function () {
      cuerpo.innerHTML = Componentes.alerta('No se pudo conectar para cargar tu perfil.', 'error');
    });

    return { cerrar: cerrar };
  }

  function renderVista_(cuerpo, perfil) {
    cuerpo.innerHTML =
      '<div class="sigso-perfil">' +
        '<div class="sigso-perfil__foto">' +
          Componentes.avatar({ nombre: perfil.nombre, foto: perfil.foto_thumb }, { tam: 'xl' }) +
          '<div class="sigso-perfil__acciones">' +
            // Accion primaria: es lo unico editable de esta pantalla, asi
            // que no tiene sentido dejarla en secundario compitiendo con
            // nada. El icono de camara la hace reconocible sin leer.
            Componentes.boton({
              texto: perfil.tiene_foto ? 'Cambiar foto' : 'Subir foto',
              icono: 'camara', clase: 'js-cambiar'
            }) +
            // "Eliminar foto" solo aparece cuando hay algo que eliminar, y
            // como enlace destructivo: debe reconocerse como peligrosa sin
            // pesar visualmente lo mismo que la accion principal.
            (perfil.tiene_foto
              ? Componentes.boton({
                  texto: 'Eliminar foto', icono: 'basura',
                  variante: 'sutil', clase: 'sigso-boton--destructivo-sutil js-eliminar'
                })
              : '') +
          '</div>' +
        '</div>' +
        '<div class="sigso-perfil__datos">' +
          '<div class="sigso-perfil__encabezado">' +
            '<p class="sigso-perfil__nombre">' + Componentes.escaparHtml(perfil.nombre) + '</p>' +
            // El rol sube a badge junto al nombre en vez de ser una fila mas
            // de la ficha: es identidad, no un dato de contacto.
            '<span class="sigso-perfil__rol">' +
              Componentes.escaparHtml(ETIQUETA_ROL[perfil.rol] || perfil.rol) + '</span>' +
          '</div>' +
          '<dl class="sigso-perfil__campos">' +
            campo_('Correo', perfil.email) +
            (perfil.cargo ? campo_('Cargo', perfil.cargo) : '') +
            campo_('Empresa', perfil.empresa_nombre || perfil.empresa_id) +
          '</dl>' +
          '<p class="sigso-perfil__nota">' +
            Iconos.svg('candado', { tam: 13 }) +
            '<span>Estos datos los administra el equipo de SIGSO. ' +
            'Si algo no corresponde, avisa a un administrador.</span>' +
          '</p>' +
        '</div>' +
      '</div>' +
      '<input type="file" accept="image/jpeg,image/png,image/webp" class="sigso-oculto js-archivo">';

    var inputArchivo = cuerpo.querySelector('.js-archivo');

    cuerpo.querySelector('.js-cambiar').addEventListener('click', function () {
      inputArchivo.value = '';   // permite reelegir el mismo archivo
      inputArchivo.click();
    });

    inputArchivo.addEventListener('change', function () {
      var archivo = inputArchivo.files && inputArchivo.files[0];
      var error = validarArchivo_(archivo);
      if (error) {
        Componentes.aviso({ texto: error, tipo: 'error' });
        return;
      }
      leerComoDataUrl_(archivo)
        .then(cargarImagen_)
        .then(function (imagen) { renderRecorte_(cuerpo, perfil, archivo, imagen); })
        .catch(function (err) {
          Componentes.aviso({ texto: err.message || 'No se pudo abrir la imagen.', tipo: 'error' });
        });
    });

    var botonEliminar = cuerpo.querySelector('.js-eliminar');
    if (botonEliminar) {
      botonEliminar.addEventListener('click', function () {
        Componentes.confirmar({
          titulo: 'Eliminar tu foto de perfil',
          mensaje: 'Volveras a aparecer con tus iniciales. Tus datos de usuario no cambian.',
          confirmar: 'Eliminar foto',
          peligro: true
        }).then(function (confirmado) {
          if (!confirmado) return;
          // innerHTML y no textContent: textContent borraria el SVG del
          // icono y el boton volveria como texto pelado tras un error.
          function restaurarBoton_() {
            botonEliminar.disabled = false;
            botonEliminar.innerHTML = Iconos.svg('basura', { tam: 15 }) + 'Eliminar foto';
          }
          botonEliminar.disabled = true;
          botonEliminar.innerHTML = '<span class="sigso-spinner"></span>Eliminando...';
          api_('eliminarFotoPerfil', {}).then(function (respuesta) {
            if (!respuesta || !respuesta.ok) {
              Componentes.aviso({
                texto: (respuesta && respuesta.message) || 'No se pudo eliminar la foto.', tipo: 'error'
              });
              restaurarBoton_();
              return;
            }
            aplicarCambio_(cuerpo, perfil, '', 'Foto eliminada. Ahora apareces con tus iniciales.');
          }).catch(function () {
            Componentes.aviso({ texto: 'No se pudo conectar para eliminar la foto.', tipo: 'error' });
            restaurarBoton_();
          });
        });
      });
    }
  }

  function campo_(etiqueta, valor) {
    return '<dt>' + Componentes.escaparHtml(etiqueta) + '</dt>' +
      '<dd>' + Componentes.escaparHtml(valor || '—') + '</dd>';
  }

  function renderRecorte_(cuerpo, perfil, archivo, imagen) {
    cuerpo.innerHTML =
      '<div class="sigso-recorte">' +
        '<div class="sigso-recorte__lienzo"><canvas></canvas></div>' +
        '<div class="sigso-recorte__zoom">' +
          '<label for="perfil-zoom" class="sigso-recorte__ayuda">Zoom</label>' +
          '<input type="range" id="perfil-zoom" class="js-zoom" min="1" max="3" step="0.01" value="1">' +
        '</div>' +
        '<p class="sigso-recorte__ayuda">Arrastra la imagen para encuadrar tu cara.</p>' +
        '<div class="sigso-recorte__botones">' +
          Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-cancelar' }) +
          Componentes.boton({ texto: 'Guardar foto', icono: 'check', clase: 'js-guardar' }) +
        '</div>' +
      '</div>';

    var recortador = montarRecortador_(cuerpo, imagen);

    cuerpo.querySelector('.js-cancelar').addEventListener('click', function () {
      renderVista_(cuerpo, perfil);
    });

    cuerpo.querySelector('.js-guardar').addEventListener('click', function () {
      var boton = cuerpo.querySelector('.js-guardar');
      var cancelar = cuerpo.querySelector('.js-cancelar');
      function restaurarBoton_() {
        boton.disabled = false;
        cancelar.disabled = false;
        boton.innerHTML = Iconos.svg('check', { tam: 15 }) + 'Guardar foto';
      }
      boton.disabled = true;
      cancelar.disabled = true;
      boton.innerHTML = '<span class="sigso-spinner"></span>Guardando...';

      var thumbDataUrl = recortador.generarThumb();

      leerComoDataUrl_(archivo).then(function (originalDataUrl) {
        return api_('guardarFotoPerfil', {
          contenido_base64: soloBase64_(originalDataUrl),
          thumb_base64: soloBase64_(thumbDataUrl),
          nombre_archivo: archivo.name || 'foto'
        });
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({
            texto: (respuesta && respuesta.message) || 'No se pudo guardar la foto.', tipo: 'error'
          });
          restaurarBoton_();
          return;
        }
        aplicarCambio_(cuerpo, perfil, respuesta.data.foto_thumb, 'Foto actualizada.');
      }).catch(function () {
        Componentes.aviso({ texto: 'No se pudo conectar para guardar la foto.', tipo: 'error' });
        restaurarBoton_();
      });
    });
  }

  // Un solo sitio donde se refleja "la foto cambio": actualiza el panel, el
  // cache y avisa al resto de la interfaz.
  function aplicarCambio_(cuerpo, perfil, nuevaFoto, mensaje) {
    perfil.foto_thumb = nuevaFoto;
    perfil.tiene_foto = !!nuevaFoto;
    perfilActual_ = perfil;

    var correo = String(perfil.email || '').trim().toLowerCase();
    if (correo) {
      if (nuevaFoto) fotosPorCorreo_[correo] = nuevaFoto;
      else delete fotosPorCorreo_[correo];
    }

    renderVista_(cuerpo, perfil);
    Componentes.aviso({ texto: mensaje, tipo: 'exito' });

    // Quien pinte avatares (header, comentarios) escucha esto y se repinta:
    // no hace falta recargar la pagina.
    document.dispatchEvent(new CustomEvent('sigso:perfil-actualizado', {
      detail: { email: correo, foto: nuevaFoto }
    }));
  }

  // --- API para el resto del frontend -------------------------------------

  /**
   * Pide en UNA sola llamada las miniaturas de una lista de correos y las
   * deja en cache. Es lo que evita que una lista de comentarios haga una
   * peticion por autor.
   */
  function precargarFotos(correos) {
    var faltantes = (correos || [])
      .map(function (c) { return String(c || '').trim().toLowerCase(); })
      .filter(function (c, i, lista) {
        return c && fotosPorCorreo_[c] === undefined && lista.indexOf(c) === i;
      });
    if (!faltantes.length) return Promise.resolve(fotosPorCorreo_);

    return api_('getFotosPerfil', { emails: faltantes }).then(function (respuesta) {
      var fotos = (respuesta && respuesta.ok && respuesta.data && respuesta.data.fotos) || {};
      faltantes.forEach(function (correo) {
        // Se cachea tambien el "no tiene foto" (null) para no volver a
        // preguntar por el mismo correo en cada render.
        fotosPorCorreo_[correo] = fotos[correo] || null;
      });
      return fotosPorCorreo_;
    }).catch(function () {
      // Sin fotos se ven las iniciales: no es motivo para romper la vista.
      return fotosPorCorreo_;
    });
  }

  function fotoDe(correo) {
    return fotosPorCorreo_[String(correo || '').trim().toLowerCase()] || '';
  }

  // Avatar de una persona identificada por correo, usando el cache.
  function avatarDe(nombre, correo, opts) {
    return Componentes.avatar({ nombre: nombre || correo, foto: fotoDe(correo) }, opts);
  }

  /**
   * v6.4: identidad en el header del Backoffice con login de Google
   * (app.html / admin.html). Esas paginas NO tenian ninguna: el header solo
   * mostraba marca y navegacion, y no habia donde colgar "Mi perfil". Aqui
   * se monta el equivalente al menu de usuario del shell.
   *
   * No hay boton de cerrar sesion: la sesion es la de Google, y se cierra
   * desde la propia cuenta de Google, no desde SIGSO.
   */
  function montarHeaderUsuario() {
    var hueco = document.getElementById('sigso-header-usuario');
    if (!hueco) return Promise.resolve();

    return api_('getMiPerfil', {}).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) return;   // sin sesion valida: header sin identidad
      var perfil = respuesta.data;
      perfilActual_ = perfil;

      var correo = String(perfil.email || '').trim().toLowerCase();
      if (correo) fotosPorCorreo_[correo] = perfil.foto_thumb || null;

      function pintar() {
        hueco.innerHTML =
          '<button type="button" class="sigso-header__usuario-btn js-abrir-perfil" ' +
            'title="Mi perfil" aria-label="Mi perfil">' +
            Componentes.avatar({ nombre: perfil.nombre, foto: perfil.foto_thumb }, { tam: 'md' }) +
            '<span class="sigso-header__usuario-txt">' +
              '<span class="sigso-header__usuario-nombre">' +
                Componentes.escaparHtml(perfil.nombre) + '</span>' +
              '<span class="sigso-header__usuario-rol">' +
                Componentes.escaparHtml(ETIQUETA_ROL[perfil.rol] || perfil.rol) + '</span>' +
            '</span>' +
          '</button>';
        hueco.querySelector('.js-abrir-perfil').addEventListener('click', abrir);
      }

      pintar();
      document.addEventListener('sigso:perfil-actualizado', function (ev) {
        perfil.foto_thumb = (ev.detail && ev.detail.foto) || '';
        perfil.tiene_foto = !!perfil.foto_thumb;
        pintar();
      });
    }).catch(function () {
      // El header se queda sin identidad; el resto de la pagina funciona.
    });
  }

  window.SigsoPerfil = {
    abrir: abrir,
    montarHeaderUsuario: montarHeaderUsuario,
    precargarFotos: precargarFotos,
    fotoDe: fotoDe,
    avatarDe: avatarDe,
    perfilActual: function () { return perfilActual_; }
  };
})();
