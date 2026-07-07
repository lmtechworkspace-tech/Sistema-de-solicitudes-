/**
 * components.js — libreria de componentes reutilizable (Fase 10, rediseno
 * UX). Funciones puras que devuelven strings HTML, mismo estilo que ya
 * usaban admin.js/detalle.js (sin framework, §2.2) -- aqui se formalizan
 * para no repetir el mismo HTML/CSS en cada pantalla nueva.
 *
 * Usa los proto-componentes que ya existian en main.css/dashboard.css
 * (.sigso-card, .sigso-boton, .sigso-badge, .sigso-galeria, etc.) en vez de
 * inventar clases nuevas donde ya habia una que servia; components.css solo
 * agrega lo que de verdad es nuevo (stepper, chips de tipo, alerta).
 */
(function () {
  function escaparHtml(texto) {
    var div = document.createElement('div');
    div.textContent = texto === undefined || texto === null ? '' : String(texto);
    return div.innerHTML;
  }

  function atributos(obj) {
    return Object.keys(obj || {})
      .filter(function (k) { return obj[k] !== undefined && obj[k] !== null && obj[k] !== false; })
      .map(function (k) { return obj[k] === true ? k : k + '="' + escaparHtml(obj[k]) + '"'; })
      .join(' ');
  }

  var Componentes = {
    escaparHtml: escaparHtml,

    boton: function (opts) {
      opts = opts || {};
      var clase = 'sigso-boton' + (opts.variante === 'secundario' ? ' sigso-boton--secundario' : '');
      if (opts.clase) clase += ' ' + opts.clase;
      var attrs = atributos({
        type: opts.tipo || 'button', id: opts.id, class: clase, disabled: !!opts.disabled,
        'data-accion': opts.accion, 'data-idx': opts.idx
      });
      var contenido = opts.cargando
        ? '<span class="sigso-spinner"></span>' + escaparHtml(opts.textoCargando || opts.texto)
        : escaparHtml(opts.texto);
      return '<button ' + attrs + '>' + contenido + '</button>';
    },

    campoTexto: function (opts) {
      return campoBase_(opts, function (attrs) {
        return '<input type="' + (opts.tipo || 'text') + '" value="' + escaparHtml(opts.valor) + '" ' + attrs + '>';
      });
    },

    campoTextarea: function (opts) {
      return campoBase_(opts, function (attrs) {
        return '<textarea ' + attrs + '>' + escaparHtml(opts.valor) + '</textarea>';
      });
    },

    campoSelect: function (opts) {
      opts = opts || {};
      var opciones = (opts.opciones || []).map(function (o) {
        var sel = String(o.valor) === String(opts.valor || '') ? ' selected' : '';
        return '<option value="' + escaparHtml(o.valor) + '"' + sel + '>' + escaparHtml(o.texto) + '</option>';
      }).join('');
      return campoBase_(opts, function (attrs) {
        return '<select ' + attrs + '>' + (opts.placeholder !== false ? '<option value="">' + escaparHtml(opts.placeholder || 'Selecciona...') + '</option>' : '') + opciones + '</select>';
      });
    },

    tarjeta: function (html, opts) {
      opts = opts || {};
      var clase = 'sigso-card' + (opts.clase ? ' ' + opts.clase : '');
      var attrs = atributos({ class: clase, id: opts.id });
      return '<div ' + attrs + '>' + html + '</div>';
    },

    badge: function (texto, variante) {
      return '<span class="sigso-badge' + (variante ? ' sigso-badge--' + variante : '') + '">' + escaparHtml(texto) + '</span>';
    },

    badgeEstado: function (codigo) {
      var texto = (typeof SIGSO_ESTADOS_LABEL !== 'undefined' && SIGSO_ESTADOS_LABEL[codigo]) || codigo;
      return '<span class="sigso-badge sigso-badge--estado">' + escaparHtml(texto) + '</span>';
    },

    badgePrioridad: function (codigo) {
      return Componentes.badge(codigo, codigo);
    },

    alerta: function (texto, tipo) {
      var clase = tipo === 'error' ? 'sigso-resultado-error' : (tipo === 'exito' ? 'sigso-resultado-exito' : 'sigso-alerta');
      return '<div class="' + clase + '"><p>' + escaparHtml(texto) + '</p></div>';
    },

    // pasos: [{ id, texto }], activo: id del paso actual. Los pasos antes
    // del activo se marcan "hecho", el activo "actual", el resto "pendiente".
    stepper: function (pasos, activo) {
      var activoIdx = pasos.findIndex(function (p) { return p.id === activo; });
      var items = pasos.map(function (p, idx) {
        var estado = idx < activoIdx ? 'hecho' : (idx === activoIdx ? 'actual' : 'pendiente');
        return '<div class="sigso-stepper__paso sigso-stepper__paso--' + estado + '">' +
          '<span class="sigso-stepper__numero">' + (idx + 1) + '</span>' +
          '<span class="sigso-stepper__texto">' + escaparHtml(p.texto) + '</span>' +
          '</div>';
      }).join('<div class="sigso-stepper__linea"></div>');
      return '<div class="sigso-stepper">' + items + '</div>';
    },

    galeriaImagenes: function (imagenes, opts) {
      opts = opts || {};
      if (!imagenes || imagenes.length === 0) {
        return opts.vacioTexto ? Componentes.vacio(opts.vacioTexto) : '';
      }
      return '<div class="sigso-galeria">' + imagenes.map(function (img, idx) {
        var quitar = opts.editable
          ? '<button type="button" class="sigso-galeria__quitar" data-accion="quitar-imagen" data-idx="' + opts.idx + '" data-img-idx="' + idx + '">&times;</button>'
          : '';
        var src = img.previewUrl || img.url || '';
        var nombre = img.nombre || img.nombre_original || '';
        var contenidoImg = src ? '<img src="' + escaparHtml(src) + '" alt="' + escaparHtml(nombre) + '">' : escaparHtml(nombre);
        var descripcionHtml = opts.editable
          ? '<input type="text" class="sigso-galeria__descripcion" data-campo="imagen-descripcion" data-idx="' + opts.idx + '" data-img-idx="' + idx + '" value="' + escaparHtml(img.descripcion) + '" placeholder="Descripcion breve">'
          : (img.descripcion ? '<p class="sigso-galeria__descripcion-texto">' + escaparHtml(img.descripcion) + '</p>' : '');
        return '<div class="sigso-galeria__item">' + quitar +
          '<a href="' + escaparHtml(src) + '" target="_blank" rel="noopener">' + contenidoImg + '</a>' +
          descripcionHtml +
          '</div>';
      }).join('') + '</div>';
    },

    cargando: function (texto) {
      return '<p class="sigso-cargando"><span class="sigso-spinner"></span>' + escaparHtml(texto || 'Cargando...') + '</p>';
    },

    // Fase 10 (pulido): reemplaza las 4 tarjetas de KPI que vivian como
    // HTML estatico repetido en app.html.
    kpi: function (opts) {
      opts = opts || {};
      return '<div class="sigso-kpi' + (opts.alerta ? ' sigso-kpi--alerta' : '') + '"' +
        (opts.id ? ' id="' + opts.id + '"' : '') +
        (opts.titulo ? ' title="' + escaparHtml(opts.titulo) + '"' : '') + '>' +
        '<div class="sigso-kpi__valor">' + escaparHtml(opts.valor === undefined ? '—' : opts.valor) + '</div>' +
        '<div class="sigso-kpi__etiqueta">' + escaparHtml(opts.etiqueta) + '</div>' +
        '</div>';
    },

    vacio: function (texto) {
      return '<p class="sigso-vacio">' + escaparHtml(texto || 'Nada por aqui todavia.') + '</p>';
    }
  };

  function campoBase_(opts, renderInput) {
    opts = opts || {};
    var attrs = atributos({
      id: opts.id, class: opts.claseInput, required: !!opts.requerido,
      placeholder: opts.placeholder,
      'data-campo': opts.dataCampo, 'data-idx': opts.idx
    });
    var ayuda = opts.ayuda ? '<p class="sigso-ayuda">' + escaparHtml(opts.ayuda) + '</p>' : '';
    var error = opts.error ? '<p class="sigso-campo__error">' + escaparHtml(opts.error) + '</p>' : '';
    return '<div class="sigso-campo' + (opts.claseCampo ? ' ' + opts.claseCampo : '') + '">' +
      (opts.label ? '<label' + (opts.id ? ' for="' + opts.id + '"' : '') + '>' + escaparHtml(opts.label) + '</label>' : '') +
      renderInput(attrs) + ayuda + error +
      '</div>';
  }

  window.Componentes = Componentes;
})();
