/**
 * novedades.js — modulo Novedades (v6.5).
 *
 * Feed compartido por las dos vias de acceso (plataforma.js con token y
 * app.js con login Google), igual que dashboard.js/detalle.js: un solo
 * archivo, sin duplicar logica entre los dos hosts.
 *
 * DECISION DE DISEÑO (viene del backend, ver Novedades.gs): el area es
 * ETIQUETA, no audiencia. SIGSO no modela a que area pertenece cada
 * persona, asi que TODO lo publicado aparece para TODOS -- el area sirve
 * para filtrar, no para restringir. Por eso ninguna tarjeta se oculta ni se
 * "destaca como tuya": todas se ven igual, el filtro de area es una
 * eleccion del lector, no del sistema.
 */
(function () {
  window.SigsoNovedades = { cargar: cargarNovedades_, actualizarBadge: actualizarBadgeStandalone_ };

  var ultimoFeed_ = [];
  var filtroTipo_ = '';
  var puedePublicar_ = false;
  var areasPropias_ = [];
  var tiposCatalogo_ = [];
  var puedeGeneral_ = false;

  function urlBackoffice_() {
    return (window.SIGSO_CONFIG || {}).BACKOFFICE_URL;
  }
  function api_(accion, datos) {
    return llamarApi(urlBackoffice_(), accion, datos || {});
  }

  // "hace 2 días" en vez de una fecha ISO pelada -- mas facil de escanear en
  // un feed que se recorre rapido.
  function relativo_(iso) {
    if (!iso) return '';
    var ms = Date.now() - new Date(iso).getTime();
    var dias = Math.floor(ms / 86400000);
    if (dias <= 0) return 'Hoy';
    if (dias === 1) return 'Ayer';
    if (dias < 7) return 'Hace ' + dias + ' días';
    if (dias < 31) return 'Hace ' + Math.floor(dias / 7) + ' semana(s)';
    return new Date(iso).toLocaleDateString('es-CL');
  }

  // Cuenta atras a la fecha de vigencia (leyes/normativas): es el
  // diferenciador del modulo -- convierte "hay una ley nueva" (pasado) en
  // "esto rige en 12 dias" (accionable, con urgencia creciente).
  function chipVigencia_(fechaVigencia) {
    if (!fechaVigencia) return '';
    var dias = Math.ceil((new Date(fechaVigencia).getTime() - Date.now()) / 86400000);
    var variante = dias <= 0 ? 'critico' : (dias <= 7 ? 'alerta' : 'info');
    var texto = dias > 0
      ? 'Entra en vigencia en ' + dias + ' día(s)'
      : (dias === 0 ? 'Entra en vigencia hoy' : 'Vigente desde hace ' + (-dias) + ' día(s)');
    return '<span class="sigso-situacion sigso-situacion--' + variante + '">' +
      Iconos.svg('calendario', { tam: 12 }) + ' ' + Componentes.escaparHtml(texto) + '</span>';
  }

  function tarjeta_(n) {
    var avatar = window.SigsoPerfil
      ? SigsoPerfil.avatarDe(n.autor_nombre, n.autor_email, { tam: 'sm' })
      : '';
    return '<article class="sigso-novedad-card' + (n.leida ? '' : ' sigso-novedad-card--no-leida') +
      '" data-novedad="' + n.novedad_id + '" tabindex="0" role="button" ' +
      'aria-label="Abrir: ' + Componentes.escaparHtml(n.titulo) + '">' +
      '<div class="sigso-novedad-card__franja sigso-novedad-card__franja--' + n.tipo_color + '"></div>' +
      '<div class="sigso-novedad-card__cuerpo">' +
        '<div class="sigso-novedad-card__meta-top">' +
          '<span class="sigso-badge sigso-badge--' + n.tipo_color + '">' + Componentes.escaparHtml(n.tipo_etiqueta) + '</span>' +
          (n.area_nombre ? '<span class="sigso-novedad-card__area">' + Componentes.escaparHtml(n.area_nombre) + '</span>' : '<span class="sigso-novedad-card__area">General</span>') +
          (n.tiene_adjunto ? '<span title="Tiene adjunto">' + Iconos.svg('adjunto', { tam: 13 }) + '</span>' : '') +
          (!n.leida && n.requiere_acuse ? '<span class="sigso-punto-no-leido" aria-hidden="true"></span>' : '') +
        '</div>' +
        '<h3 class="sigso-novedad-card__titulo">' + Componentes.escaparHtml(n.titulo) + '</h3>' +
        '<p class="sigso-novedad-card__resumen">' + Componentes.escaparHtml(n.resumen) + '</p>' +
        chipVigencia_(n.fecha_vigencia) +
        '<div class="sigso-novedad-card__meta-bottom">' +
          avatar +
          '<span>' + Componentes.escaparHtml(n.autor_nombre) + '</span>' +
          '<span aria-hidden="true">·</span>' +
          '<span>' + relativo_(n.fecha_publicacion) + '</span>' +
          (n.requiere_acuse
            ? (n.leida
                ? '<span class="sigso-novedad-card__leida">' + Iconos.svg('check', { tam: 13 }) + ' Enterado</span>'
                : '<span class="sigso-novedad-card__pendiente">Requiere acuse</span>')
            : '') +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function renderChipsTipo_(cont) {
    var chips = [{ tipo: '', etiqueta: 'Todas' }].concat(
      tiposCatalogo_.map(function (t) { return { tipo: t.tipo, etiqueta: t.etiqueta }; })
    );
    cont.innerHTML = chips.map(function (c) {
      var activo = c.tipo === filtroTipo_ ? ' sigso-chip--activo' : '';
      return '<button type="button" class="sigso-chip' + activo + '" data-chip-tipo="' + c.tipo + '">' +
        Componentes.escaparHtml(c.etiqueta) + '</button>';
    }).join('');
    cont.querySelectorAll('[data-chip-tipo]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        filtroTipo_ = chip.getAttribute('data-chip-tipo');
        cargarFeed_();
      });
    });
  }

  function renderFeed_(datos) {
    var cont = document.getElementById('novedades-contenido');
    if (!cont) return;
    ultimoFeed_ = datos.recientes;

    var correos = datos.recientes.map(function (n) { return n.autor_email; });
    var pintarConAvatares = function () {
      cont.querySelector('.sigso-novedades__lista').innerHTML = datos.recientes.length
        ? datos.recientes.map(tarjeta_).join('')
        : Componentes.vacio({
            icono: 'campana',
            texto: 'Todavía no hay novedades' + (filtroTipo_ ? ' de este tipo' : '') + '.',
            detalle: puedePublicar_ ? 'Publica la primera con el botón de arriba.' : 'Vuelve pronto: cada área va a ir sumando lo suyo.'
          });
      cont.querySelectorAll('[data-novedad]').forEach(function (card) {
        card.addEventListener('click', function () { abrirDetalle_(card.getAttribute('data-novedad')); });
        card.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); card.click(); }
        });
      });
    };

    if (window.SigsoPerfil) {
      SigsoPerfil.precargarFotos(correos).then(pintarConAvatares);
    } else {
      pintarConAvatares();
    }
  }

  // Actualiza CUALQUIER badge de "novedades" presente en la pagina --
  // funciona igual en el nav de plataforma.js (que ya genera
  // [data-badge="novedades"] para todo modulo, ver renderNav_) y en el
  // boton de app.html (Backoffice con login Google), sin que ninguno de los
  // dos hosts tenga que conocer al otro.
  function actualizarBadge_(pendientes) {
    document.querySelectorAll('[data-badge="novedades"]').forEach(function (badge) {
      badge.textContent = pendientes > 99 ? '99+' : String(pendientes);
      badge.classList.toggle('sigso-oculto', !pendientes);
    });
  }

  /**
   * Se llama desde Home (o desde donde convenga) para que el badge de
   * pendientes aparezca SIN que el usuario haya entrado todavia al modulo --
   * mismo criterio que "pendientes_validar" de Mis solicitudes. No toca el
   * DOM del feed (que puede no existir todavia).
   */
  function actualizarBadgeStandalone_() {
    api_('getFeedNovedades', {}).then(function (respuesta) {
      if (respuesta && respuesta.ok) actualizarBadge_(respuesta.data.resumen.pendientes);
    }).catch(function () { /* sin badge si falla: no es critico */ });
  }

  function cargarFeed_() {
    var cont = document.getElementById('novedades-contenido');
    if (!cont) return;
    var lista = cont.querySelector('.sigso-novedades__lista');
    if (lista) lista.innerHTML = Componentes.cargando('Cargando novedades...');

    api_('getFeedNovedades', { tipo: filtroTipo_ }).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        if (lista) lista.innerHTML = Componentes.alerta(
          (respuesta && respuesta.message) || 'No se pudieron cargar las novedades.', 'error'
        );
        return;
      }
      renderFeed_(respuesta.data);
      actualizarBadge_(respuesta.data.resumen.pendientes);
    }).catch(function () {
      if (lista) lista.innerHTML = Componentes.alerta('No se pudo conectar para cargar las novedades.', 'error');
    });
  }

  /**
   * Punto de entrada, llamado por plataforma.js (mostrarModulo_) y por
   * app.js al mostrar la seccion. Idempotente: puede llamarse cada vez que
   * se entra al modulo sin duplicar listeners (el markup se reemplaza
   * completo en cada carga).
   */
  function cargarNovedades_() {
    var cont = document.getElementById('novedades-contenido');
    if (!cont) return;

    cont.innerHTML =
      '<div class="sigso-novedades__cabecera">' +
        '<div class="sigso-novedades__chips" id="novedades-chips-tipo"></div>' +
        '<button type="button" class="sigso-boton sigso-boton--con-icono sigso-oculto" id="btn-publicar-novedad">' +
          Iconos.svg('mas', { tam: 15 }) + 'Publicar' +
        '</button>' +
      '</div>' +
      '<div class="sigso-novedades__lista">' + Componentes.cargando('Cargando novedades...') + '</div>';

    api_('listarAreasPublicablesNovedad', {}).then(function (respuesta) {
      if (respuesta && respuesta.ok) {
        areasPropias_ = respuesta.data.areas;
        tiposCatalogo_ = respuesta.data.tipos;
        puedeGeneral_ = respuesta.data.puede_general;
        puedePublicar_ = areasPropias_.length > 0 || puedeGeneral_;
        var btn = document.getElementById('btn-publicar-novedad');
        if (btn && puedePublicar_) {
          btn.classList.remove('sigso-oculto');
          btn.addEventListener('click', abrirFormularioPublicar_);
        }
      }
      renderChipsTipo_(document.getElementById('novedades-chips-tipo'));
      cargarFeed_();
    }).catch(function () {
      renderChipsTipo_(document.getElementById('novedades-chips-tipo'));
      cargarFeed_();
    });
  }

  // --- Detalle + acuse ------------------------------------------------------

  function abrirDetalle_(novedadId) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<div class="js-detalle-cuerpo">' + Componentes.cargando('Cargando...') + '</div>' +
      '</div>';
    function cerrar() {
      document.removeEventListener('keydown', alTeclado);
      if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
    }
    function alTeclado(ev) { if (ev.key === 'Escape') cerrar(); }
    fondo.addEventListener('click', function (ev) { if (ev.target === fondo) cerrar(); });
    document.addEventListener('keydown', alTeclado);
    document.body.appendChild(fondo);

    api_('getDetalleNovedad', { novedad_id: novedadId }).then(function (respuesta) {
      var cuerpo = fondo.querySelector('.js-detalle-cuerpo');
      if (!respuesta || !respuesta.ok) {
        cuerpo.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar.', 'error');
        return;
      }
      renderDetalle_(cuerpo, respuesta.data, cerrar);
    }).catch(function () {
      fondo.querySelector('.js-detalle-cuerpo').innerHTML =
        Componentes.alerta('No se pudo conectar.', 'error');
    });
  }

  function renderDetalle_(cuerpo, n, cerrar) {
    var avatar = window.SigsoPerfil
      ? SigsoPerfil.avatarDe(n.autor_nombre, n.autor_email, { tam: 'md' })
      : '';
    cuerpo.innerHTML =
      '<div class="sigso-novedad-detalle">' +
        '<div class="sigso-novedad-card__meta-top">' +
          '<span class="sigso-badge sigso-badge--' + n.tipo_color + '">' + Componentes.escaparHtml(n.tipo_etiqueta) + '</span>' +
          (n.area_nombre ? '<span class="sigso-novedad-card__area">' + Componentes.escaparHtml(n.area_nombre) + '</span>' : '<span class="sigso-novedad-card__area">General</span>') +
        '</div>' +
        '<h2 class="sigso-novedad-detalle__titulo">' + Componentes.escaparHtml(n.titulo) + '</h2>' +
        chipVigencia_(n.fecha_vigencia) +
        '<div class="sigso-novedad-detalle__autor">' + avatar +
          '<div><strong>' + Componentes.escaparHtml(n.autor_nombre) + '</strong>' +
          '<div class="sigso-ayuda">' + relativo_(n.fecha_publicacion) + '</div></div>' +
        '</div>' +
        '<div class="sigso-novedad-detalle__cuerpo">' + Componentes.escaparHtml(n.cuerpo || n.resumen).replace(/\n/g, '<br>') + '</div>' +
        (n.tiene_adjunto
          ? Componentes.boton({ texto: 'Descargar adjunto', icono: 'descargar', variante: 'secundario', clase: 'js-descargar-adjunto' })
          : '') +
        '<div class="sigso-novedad-detalle__acciones">' +
          (n.requiere_acuse && !n.leida
            ? Componentes.boton({ texto: 'Enterado', icono: 'check', clase: 'js-marcar-leida' })
            : (n.requiere_acuse
                ? '<span class="sigso-novedad-card__leida">' + Iconos.svg('check', { tam: 14 }) + ' Ya diste acuse de esta novedad</span>'
                : '')) +
          (n.puede_gestionar
            ? Componentes.boton({ texto: 'Retirar', variante: 'sutil', clase: 'sigso-boton--destructivo-sutil js-retirar-novedad' })
            : '') +
        '</div>' +
      '</div>';

    var btnLeida = cuerpo.querySelector('.js-marcar-leida');
    if (btnLeida) {
      btnLeida.addEventListener('click', function () {
        btnLeida.disabled = true;
        btnLeida.innerHTML = '<span class="sigso-spinner"></span>Guardando...';
        api_('marcarLeidaNovedad', { novedad_id: n.novedad_id }).then(function (respuesta) {
          if (!respuesta || !respuesta.ok) {
            Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo registrar el acuse.', tipo: 'error' });
            btnLeida.disabled = false;
            btnLeida.innerHTML = Iconos.svg('check', { tam: 15 }) + 'Enterado';
            return;
          }
          Componentes.aviso({ texto: 'Acuse registrado.', tipo: 'exito' });
          cerrar();
          cargarFeed_();
        }).catch(function () {
          Componentes.aviso({ texto: 'No se pudo conectar.', tipo: 'error' });
          btnLeida.disabled = false;
          btnLeida.innerHTML = Iconos.svg('check', { tam: 15 }) + 'Enterado';
        });
      });
    }

    var btnAdjunto = cuerpo.querySelector('.js-descargar-adjunto');
    if (btnAdjunto) {
      btnAdjunto.addEventListener('click', function () {
        api_('descargarAdjuntoNovedad', { novedad_id: n.novedad_id }).then(function (respuesta) {
          if (!respuesta || !respuesta.ok) {
            Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo descargar el adjunto.', tipo: 'error' });
            return;
          }
          descargarBase64_(respuesta.data.contenido_base64, respuesta.data.nombre_archivo, respuesta.data.mime);
        });
      });
    }

    var btnRetirar = cuerpo.querySelector('.js-retirar-novedad');
    if (btnRetirar) {
      btnRetirar.addEventListener('click', function () {
        Componentes.confirmar({
          titulo: 'Retirar esta novedad',
          mensaje: 'Dejará de verse en el feed. No se puede deshacer desde aquí.',
          confirmar: 'Retirar', peligro: true
        }).then(function (confirmado) {
          if (!confirmado) return;
          api_('despublicarNovedad', { novedad_id: n.novedad_id }).then(function (respuesta) {
            if (!respuesta || !respuesta.ok) {
              Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo retirar.', tipo: 'error' });
              return;
            }
            Componentes.aviso({ texto: 'Novedad retirada.', tipo: 'exito' });
            cerrar();
            cargarFeed_();
          });
        });
      });
    }
  }

  function descargarBase64_(base64, nombre, mime) {
    var bytes = atob(base64);
    var arr = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    var blob = new Blob([arr], { type: mime || 'application/pdf' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = nombre || 'adjunto.pdf';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  // --- Publicar --------------------------------------------------------------

  function abrirFormularioPublicar_() {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    var opcionesArea = (puedeGeneral_ ? ['<option value="">General (todos)</option>'] : [])
      .concat(areasPropias_.map(function (a) {
        return '<option value="' + Componentes.escaparHtml(a.area_id) + '">' + Componentes.escaparHtml(a.nombre) + '</option>';
      })).join('');

    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Publicar novedad</h3>' +
        '<form id="form-publicar-novedad" class="sigso-novedad-form">' +
          '<div class="sigso-campo"><label>Tipo</label><select id="np-tipo" required>' +
            tiposCatalogo_.map(function (t) {
              return '<option value="' + t.tipo + '">' + Componentes.escaparHtml(t.etiqueta) + '</option>';
            }).join('') +
          '</select></div>' +
          '<div class="sigso-campo"><label>Área</label><select id="np-area">' + opcionesArea + '</select></div>' +
          '<div class="sigso-campo"><label>Título</label><input type="text" id="np-titulo" maxlength="140" required></div>' +
          '<div class="sigso-campo"><label>Resumen (1-2 líneas)</label><textarea id="np-resumen" rows="2" maxlength="240" required></textarea></div>' +
          '<div class="sigso-campo"><label>Detalle completo</label><textarea id="np-cuerpo" rows="6"></textarea></div>' +
          '<div class="sigso-campo"><label>Entra en vigencia (opcional)</label><input type="date" id="np-vigencia"></div>' +
          '<div class="sigso-campo"><label>Adjunto PDF (opcional)</label><input type="file" id="np-archivo" accept="application/pdf"></div>' +
          '<label class="sigso-campo-check"><input type="checkbox" id="np-requiere-acuse" checked> Exigir acuse de lectura ("Enterado")</label>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-cancelar-publicar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Publicar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';

    function cerrar() {
      document.removeEventListener('keydown', alTeclado);
      if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
    }
    function alTeclado(ev) { if (ev.key === 'Escape') cerrar(); }
    fondo.addEventListener('click', function (ev) { if (ev.target === fondo) cerrar(); });
    document.addEventListener('keydown', alTeclado);
    document.body.appendChild(fondo);

    fondo.querySelector('.js-cancelar-publicar').addEventListener('click', cerrar);

    var form = document.getElementById('form-publicar-novedad');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var botonSubmit = form.querySelector('button[type="submit"]');
      var archivo = document.getElementById('np-archivo').files[0];

      function enviar(contenidoBase64, nombreArchivo) {
        botonSubmit.disabled = true;
        botonSubmit.textContent = 'Publicando...';
        api_('publicarNovedad', {
          tipo: document.getElementById('np-tipo').value,
          area_id: document.getElementById('np-area').value,
          titulo: document.getElementById('np-titulo').value,
          resumen: document.getElementById('np-resumen').value,
          cuerpo: document.getElementById('np-cuerpo').value,
          fecha_vigencia: document.getElementById('np-vigencia').value,
          requiere_acuse: document.getElementById('np-requiere-acuse').checked,
          contenido_base64: contenidoBase64,
          nombre_archivo: nombreArchivo
        }).then(function (respuesta) {
          if (!respuesta || !respuesta.ok) {
            Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo publicar.', tipo: 'error' });
            botonSubmit.disabled = false;
            botonSubmit.textContent = 'Publicar';
            return;
          }
          Componentes.aviso({ texto: 'Novedad publicada.', tipo: 'exito' });
          cerrar();
          cargarFeed_();
        }).catch(function () {
          Componentes.aviso({ texto: 'No se pudo conectar.', tipo: 'error' });
          botonSubmit.disabled = false;
          botonSubmit.textContent = 'Publicar';
        });
      }

      if (archivo) {
        var lector = new FileReader();
        lector.onload = function () {
          var base64 = lector.result.slice(lector.result.indexOf(',') + 1);
          enviar(base64, archivo.name);
        };
        lector.readAsDataURL(archivo);
      } else {
        enviar(null, null);
      }
    });
  }
})();
