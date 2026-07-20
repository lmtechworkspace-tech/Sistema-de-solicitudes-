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

    // variante: 'primario' (default) | 'secundario' | 'sutil' | 'peligro'.
    // v4.0 Frente 2: antes solo habia primario/secundario, asi que acciones
    // sin retorno (derivar en lote, desactivar cuenta) se pintaban igual que
    // "Guardar" y no habia forma de bajarle el peso a una accion terciaria.
    boton: function (opts) {
      opts = opts || {};
      var VARIANTES = { secundario: 1, sutil: 1, peligro: 1 };
      var clase = 'sigso-boton' + (VARIANTES[opts.variante] ? ' sigso-boton--' + opts.variante : '');
      if (opts.icono) clase += ' sigso-boton--con-icono';
      if (opts.clase) clase += ' ' + opts.clase;
      var attrs = atributos({
        type: opts.tipo || 'button', id: opts.id, class: clase, disabled: !!opts.disabled,
        'data-accion': opts.accion, 'data-idx': opts.idx
      });
      var contenido = opts.cargando
        ? '<span class="sigso-spinner"></span>' + escaparHtml(opts.textoCargando || opts.texto)
        : (ico_(opts.icono) + escaparHtml(opts.texto));
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

    // v4.0 Frente 2: la pastilla de estado deja de ser un badge azul plano
    // igual para los 11 estados. Ahora el color dice en que FAMILIA esta la
    // solicitud (en curso / esperando al solicitante / cerrada bien / cerrada
    // mal) y un punto al inicio le da forma propia, para no confundirla con
    // el badge de prioridad, que es el otro elemento redondo de la fila.
    badgeEstado: function (codigo) {
      var texto = (typeof SIGSO_ESTADOS_LABEL !== 'undefined' && SIGSO_ESTADOS_LABEL[codigo]) || codigo;
      return '<span class="sigso-pastilla sigso-pastilla--' + familiaEstado_(codigo) + '">' +
        '<span class="sigso-pastilla__punto"></span>' + escaparHtml(texto) + '</span>';
    },

    badgePrioridad: function (codigo) {
      return Componentes.badge(codigo, codigo);
    },

    // v4.0 Frente 4: reemplaza el semaforo de emoji (🔴🟡🟢) y el texto suelto
    // "Vence en Xh" -- una barra que se llena con la urgencia se escanea en
    // una fila de tabla mas rapido que leer un numero. horas null/undefined
    // (item sin SLA, ej. atencion directa) no renderiza nada.
    barraSla: function (horas) {
      if (horas === null || horas === undefined) return '';
      var vencido = horas < 0;
      var nivel = vencido ? 'critico' : (horas < 24 ? 'alerta' : 'ok');
      // Ventana de referencia de 72h: mas alla de eso ya no aporta escanear
      // el detalle, solo importa que esta "sano".
      var pct = vencido ? 100 : Math.max(8, Math.min(100, Math.round(100 - (horas / 72) * 100)));
      var texto = vencido ? 'Fuera de plazo' : ('Vence en ' + horas + 'h');
      return '<span class="sigso-sla sigso-sla--' + nivel + '" title="' + escaparHtml(texto) + '">' +
        '<span class="sigso-sla__barra"><span class="sigso-sla__relleno" style="width:' + pct + '%"></span></span>' +
        '<span class="sigso-sla__texto">' + escaparHtml(texto) + '</span>' +
        '</span>';
    },

    // v4.0 Frente 4: barra de flujo S01..S09 en la ficha del detalle -- de un
    // vistazo se ve cuanto camino lleva la solicitud, no solo el estado
    // puntual. S10/S11 son ramas de salida (rechazo/cancelacion), no un paso
    // mas del flujo feliz, asi que se muestran aparte.
    flujoEstados: function (codigoActual) {
      var ORDEN = ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09'];
      var etiquetas = typeof SIGSO_ESTADOS_LABEL !== 'undefined' ? SIGSO_ESTADOS_LABEL : {};
      if (codigoActual === 'S10' || codigoActual === 'S11') {
        return '<div class="sigso-flujo-estados sigso-flujo-estados--interrumpido">' +
          ico_('equis', 14) + ' Flujo interrumpido en: ' + escaparHtml(etiquetas[codigoActual] || codigoActual) +
          '</div>';
      }
      var idx = ORDEN.indexOf(codigoActual);
      var segmentos = ORDEN.map(function (cod, i) {
        var estado = idx === -1 ? 'pendiente' : (i < idx ? 'hecho' : (i === idx ? 'actual' : 'pendiente'));
        return '<span class="sigso-flujo-estados__seg sigso-flujo-estados__seg--' + estado + '" title="' + escaparHtml(etiquetas[cod] || cod) + '"></span>';
      }).join('');
      return '<div class="sigso-flujo-estados">' +
        '<div class="sigso-flujo-estados__barra">' + segmentos + '</div>' +
        '<span class="sigso-flujo-estados__etiqueta">' + escaparHtml(etiquetas[codigoActual] || codigoActual) + '</span>' +
        '</div>';
    },

    alerta: function (texto, tipo) {
      var clase = tipo === 'error' ? 'sigso-resultado-error' : (tipo === 'exito' ? 'sigso-resultado-exito' : 'sigso-alerta');
      return '<div class="' + clase + '"><p>' + escaparHtml(texto) + '</p></div>';
    },

    // pasos: [{ id, texto }], activo: id del paso actual. Los pasos antes
    // del activo se marcan "hecho", el activo "actual", el resto "pendiente".
    // v4.0 Frente 5: suma una linea de progreso ("Paso 2 de 3") debajo de los
    // circulos -- los circulos dicen EN CUAL paso estas, la linea dice
    // CUANTO FALTA, que es la pregunta que de verdad importa a mitad del
    // formulario.
    stepper: function (pasos, activo) {
      var activoIdx = pasos.findIndex(function (p) { return p.id === activo; });
      var items = pasos.map(function (p, idx) {
        var estado = idx < activoIdx ? 'hecho' : (idx === activoIdx ? 'actual' : 'pendiente');
        return '<div class="sigso-stepper__paso sigso-stepper__paso--' + estado + '">' +
          '<span class="sigso-stepper__numero">' + (idx + 1) + '</span>' +
          '<span class="sigso-stepper__texto">' + escaparHtml(p.texto) + '</span>' +
          '</div>';
      }).join('<div class="sigso-stepper__linea"></div>');
      var pct = pasos.length > 1 ? Math.round((Math.max(activoIdx, 0) / (pasos.length - 1)) * 100) : 100;
      var progreso = pasos.length > 1
        ? '<div class="sigso-stepper__progreso">' +
          '<span class="sigso-stepper__progreso-barra"><span class="sigso-stepper__progreso-relleno" style="width:' + pct + '%"></span></span>' +
          '<span class="sigso-stepper__progreso-texto">Paso ' + (Math.max(activoIdx, 0) + 1) + ' de ' + pasos.length + '</span>' +
          '</div>'
        : '';
      return '<div class="sigso-stepper">' + items + '</div>' + progreso;
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
        // v4.0 Frente 4: mientras se esta subiendo (editable) o el archivo no
        // es una imagen (documento), el clic sigue abriendo en pestana
        // nueva. Una imagen ya subida abre el lightbox -- ampliarla sin
        // perder el contexto de la solicitud detras.
        var esImagen = img.esImagen !== undefined ? img.esImagen : true;
        var envoltorio = (opts.editable || !esImagen || !src)
          ? '<a href="' + escaparHtml(src) + '" target="_blank" rel="noopener">' + contenidoImg + '</a>'
          : '<button type="button" class="sigso-galeria__ver">' + contenidoImg + '</button>';
        return '<div class="sigso-galeria__item">' + quitar +
          envoltorio +
          descripcionHtml +
          '</div>';
      }).join('') + '</div>';
    },

    cargando: function (texto) {
      return '<p class="sigso-cargando"><span class="sigso-spinner"></span>' + escaparHtml(texto || 'Cargando...') + '</p>';
    },

    // Fase 10 (pulido): reemplaza las 4 tarjetas de KPI que vivian como
    // HTML estatico repetido en app.html.
    // UI-5 (§4): si opts.filtro viene, el KPI se renderiza como <button> --
    // permite filtrar la lista de abajo con un clic (KPI "accionable") en
    // vez de ser solo un numero decorativo. opts.activo resalta el filtro
    // actualmente aplicado.
    kpi: function (opts) {
      opts = opts || {};
      var tag = opts.filtro ? 'button' : 'div';
      var clases = 'sigso-kpi' + (opts.alerta ? ' sigso-kpi--alerta' : '') + (opts.filtro ? ' sigso-kpi--clicable' : '') + (opts.activo ? ' sigso-kpi--activo' : '');
      return '<' + tag + ' class="' + clases + '"' +
        (tag === 'button' ? ' type="button" data-filtro-kpi="' + escaparHtml(opts.filtro) + '"' : '') +
        (opts.id ? ' id="' + opts.id + '"' : '') +
        (opts.titulo ? ' title="' + escaparHtml(opts.titulo) + '"' : '') + '>' +
        '<div class="sigso-kpi__valor">' + escaparHtml(opts.valor === undefined ? '—' : opts.valor) + '</div>' +
        '<div class="sigso-kpi__etiqueta">' + escaparHtml(opts.etiqueta) + '</div>' +
        '</' + tag + '>';
    },

    // Acepta el string de siempre (todos los llamadores previos) o un objeto
    // { texto, detalle, icono, accion:{texto,accion} } -- v4.0 Frente 2: un
    // parrafo gris no distingue "no hay nada" de "todavia esta cargando" ni
    // dice que hacer al respecto.
    vacio: function (texto) {
      var o = typeof texto === 'string' || texto === undefined || texto === null
        ? { texto: texto } : texto;
      var cta = o.accion
        ? Componentes.boton({ texto: o.accion.texto, variante: 'secundario', accion: o.accion.accion, id: o.accion.id })
        : '';
      return '<div class="sigso-vacio">' +
        '<div class="sigso-vacio__icono">' + ico_(o.icono || 'caja', 26) + '</div>' +
        '<p class="sigso-vacio__texto">' + escaparHtml(o.texto || 'Nada por aqui todavia.') + '</p>' +
        (o.detalle ? '<p class="sigso-vacio__detalle">' + escaparHtml(o.detalle) + '</p>' : '') +
        cta + '</div>';
    },

    // Esqueleto de carga: bloques con la forma del contenido que viene, en
    // vez de un spinner que no dice cuanto falta ni de que tamano. `filas`
    // repite el bloque; `variante` 'tabla' | 'tarjeta' | 'lineas'.
    esqueleto: function (opts) {
      opts = opts || {};
      var filas = opts.filas || 3;
      var bloque = opts.variante === 'tarjeta'
        ? '<div class="sigso-esq__tarjeta"><span class="sigso-esq__barra" style="width:45%"></span>' +
          '<span class="sigso-esq__barra" style="width:80%"></span>' +
          '<span class="sigso-esq__barra" style="width:60%"></span></div>'
        : '<div class="sigso-esq__fila">' +
          '<span class="sigso-esq__barra" style="width:22%"></span>' +
          '<span class="sigso-esq__barra" style="width:48%"></span>' +
          '<span class="sigso-esq__barra" style="width:18%"></span></div>';
      var html = '';
      for (var i = 0; i < filas; i++) { html += bloque; }
      return '<div class="sigso-esq" aria-busy="true" aria-label="Cargando">' + html + '</div>';
    },

    /**
     * Aviso flotante (toast). Reemplaza los alert() del navegador, que
     * bloquean la pagina, no se pueden copiar comodo y salen con el titulo
     * "script.google.com dice:" -- pesimo para mostrar una clave temporal.
     *
     * @param {{texto:string, detalle?:string, tipo?:'exito'|'error'|'info',
     *          copiar?:string, duracion?:number}} opts
     *        copiar: texto que el aviso ofrece copiar al portapapeles (y por
     *        el que NO se auto-cierra: la clave debe quedar hasta que la
     *        guarden).
     */
    aviso: function (opts) {
      opts = typeof opts === 'string' ? { texto: opts } : (opts || {});
      var cont = contenedorAvisos_();
      var tipo = opts.tipo || 'info';
      var iconos = { exito: 'check', error: 'alerta', info: 'info' };

      var el = document.createElement('div');
      el.className = 'sigso-aviso sigso-aviso--' + tipo;
      el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
      el.innerHTML =
        '<span class="sigso-aviso__icono">' + ico_(iconos[tipo] || 'info', 18) + '</span>' +
        '<div class="sigso-aviso__cuerpo">' +
          '<p class="sigso-aviso__texto">' + escaparHtml(opts.texto) + '</p>' +
          (opts.detalle ? '<p class="sigso-aviso__detalle">' + escaparHtml(opts.detalle) + '</p>' : '') +
          (opts.copiar
            ? '<code class="sigso-aviso__valor">' + escaparHtml(opts.copiar) + '</code>' +
              '<button type="button" class="sigso-boton sigso-boton--secundario sigso-boton--con-icono sigso-aviso__copiar">' +
              ico_('copiar') + 'Copiar</button>'
            : '') +
        '</div>' +
        '<button type="button" class="sigso-aviso__cerrar" aria-label="Cerrar aviso">' + ico_('equis', 16) + '</button>';

      function cerrar() {
        el.classList.add('sigso-aviso--saliendo');
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
      }
      el.querySelector('.sigso-aviso__cerrar').addEventListener('click', cerrar);

      var btnCopiar = el.querySelector('.sigso-aviso__copiar');
      if (btnCopiar) {
        btnCopiar.addEventListener('click', function () {
          copiarAlPortapapeles_(opts.copiar).then(function (ok) {
            btnCopiar.innerHTML = ico_(ok ? 'check' : 'equis') + (ok ? 'Copiada' : 'No se pudo');
            setTimeout(function () { btnCopiar.innerHTML = ico_('copiar') + 'Copiar'; }, 2000);
          });
        });
      }

      cont.appendChild(el);
      // Con `copiar` no hay auto-cierre: la clave temporal solo existe aqui.
      var duracion = opts.duracion !== undefined ? opts.duracion : (opts.copiar ? 0 : 5000);
      if (duracion > 0) { setTimeout(cerrar, duracion); }
      return { cerrar: cerrar, elemento: el };
    },

    /**
     * Confirmacion propia. Devuelve una Promise<boolean> -- reemplaza a
     * window.confirm, que ademas de feo no permite marcar la accion como
     * destructiva ni recordar el conteo en el boton.
     * @param {{titulo:string, mensaje?:string, confirmar?:string,
     *          cancelar?:string, peligro?:boolean}} opts
     */
    confirmar: function (opts) {
      opts = opts || {};
      return new Promise(function (resolver) {
        var fondo = document.createElement('div');
        fondo.className = 'sigso-modal-fondo';
        fondo.innerHTML =
          '<div class="sigso-modal" role="dialog" aria-modal="true" aria-labelledby="sigso-modal-titulo">' +
            '<h3 class="sigso-modal__titulo" id="sigso-modal-titulo">' + escaparHtml(opts.titulo) + '</h3>' +
            (opts.mensaje ? '<p class="sigso-modal__mensaje">' + escaparHtml(opts.mensaje) + '</p>' : '') +
            '<div class="sigso-modal__acciones">' +
              Componentes.boton({ texto: opts.cancelar || 'Cancelar', variante: 'sutil', clase: 'js-modal-no' }) +
              Componentes.boton({
                texto: opts.confirmar || 'Confirmar',
                variante: opts.peligro ? 'peligro' : undefined,
                clase: 'js-modal-si'
              }) +
            '</div>' +
          '</div>';

        function cerrar(valor) {
          document.removeEventListener('keydown', alTeclado);
          if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
          resolver(valor);
        }
        function alTeclado(ev) { if (ev.key === 'Escape') cerrar(false); }

        fondo.querySelector('.js-modal-no').addEventListener('click', function () { cerrar(false); });
        fondo.querySelector('.js-modal-si').addEventListener('click', function () { cerrar(true); });
        // Clic en el velo = cancelar; clic dentro del cuadro, no.
        fondo.addEventListener('click', function (ev) { if (ev.target === fondo) cerrar(false); });
        document.addEventListener('keydown', alTeclado);

        document.body.appendChild(fondo);
        fondo.querySelector('.js-modal-si').focus();
      });
    },

    /**
     * v4.0 Frente 5: pide un valor de texto en un modal propio. Devuelve una
     * Promise<string|null> (null = cancelado). Se usa para "Renombrar
     * usuario" y "Asignar clave" en la administracion de cuentas -- acciones
     * puntuales que no ameritan un formulario aparte en la pantalla.
     * @param {{titulo:string, mensaje?:string, placeholder?:string,
     *          valorInicial?:string, tipo?:'text'|'password',
     *          confirmar?:string, cancelar?:string,
     *          validar?:(valor:string)=>string|null}} opts
     *        validar: si devuelve un string, se muestra como error y NO se
     *        cierra el modal; si devuelve null/undefined, se acepta.
     */
    prompt: function (opts) {
      opts = opts || {};
      return new Promise(function (resolver) {
        var fondo = document.createElement('div');
        fondo.className = 'sigso-modal-fondo';
        fondo.innerHTML =
          '<div class="sigso-modal" role="dialog" aria-modal="true" aria-labelledby="sigso-prompt-titulo">' +
            '<h3 class="sigso-modal__titulo" id="sigso-prompt-titulo">' + escaparHtml(opts.titulo) + '</h3>' +
            (opts.mensaje ? '<p class="sigso-modal__mensaje">' + escaparHtml(opts.mensaje) + '</p>' : '') +
            '<input type="' + (opts.tipo || 'text') + '" class="sigso-prompt__input" value="' + escaparHtml(opts.valorInicial || '') + '"' +
              (opts.placeholder ? ' placeholder="' + escaparHtml(opts.placeholder) + '"' : '') + '>' +
            '<p class="sigso-campo__error sigso-oculto js-prompt-error"></p>' +
            '<div class="sigso-modal__acciones">' +
              Componentes.boton({ texto: opts.cancelar || 'Cancelar', variante: 'sutil', clase: 'js-modal-no' }) +
              Componentes.boton({ texto: opts.confirmar || 'Guardar', clase: 'js-modal-si' }) +
            '</div>' +
          '</div>';

        var input = fondo.querySelector('.sigso-prompt__input');
        var error = fondo.querySelector('.js-prompt-error');

        function cerrar(valor) {
          document.removeEventListener('keydown', alTeclado);
          if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
          resolver(valor);
        }

        function intentarAceptar() {
          var valor = input.value.trim();
          var problema = opts.validar ? opts.validar(valor) : null;
          if (problema) {
            error.textContent = problema;
            error.classList.remove('sigso-oculto');
            input.focus();
            return;
          }
          cerrar(valor);
        }

        function alTeclado(ev) {
          if (ev.key === 'Escape') { cerrar(null); return; }
          if (ev.key === 'Enter') { ev.preventDefault(); intentarAceptar(); }
        }

        fondo.querySelector('.js-modal-no').addEventListener('click', function () { cerrar(null); });
        fondo.querySelector('.js-modal-si').addEventListener('click', intentarAceptar);
        fondo.addEventListener('click', function (ev) { if (ev.target === fondo) cerrar(null); });
        document.addEventListener('keydown', alTeclado);

        document.body.appendChild(fondo);
        input.focus();
        input.select();
      });
    }
  };

  // Familias de estado (§8). S01-S02 entran recien, S03-S07 estan en curso,
  // S08 espera al solicitante, S09 cerro bien, S10/S11 cerraron sin entregar.
  var FAMILIA_ESTADO = {
    S01: 'nueva', S02: 'nueva',
    S03: 'curso', S04: 'curso', S05: 'curso', S06: 'curso', S07: 'curso',
    S08: 'espera',
    S09: 'ok', S10: 'no', S11: 'no'
  };

  function familiaEstado_(codigo) {
    return FAMILIA_ESTADO[codigo] || 'curso';
  }

  // iconos.js se carga DESPUES que este archivo en todas las paginas, asi que
  // la referencia se resuelve al invocar (no al definir). Si faltara, se
  // degrada a texto sin icono en vez de romper la pantalla.
  function ico_(nombre, tam) {
    if (!nombre || typeof Iconos === 'undefined') return '';
    return Iconos.svg(nombre, { tam: tam || 16 });
  }

  function contenedorAvisos_() {
    var cont = document.getElementById('sigso-avisos');
    if (!cont) {
      cont = document.createElement('div');
      cont.id = 'sigso-avisos';
      cont.className = 'sigso-avisos';
      document.body.appendChild(cont);
    }
    return cont;
  }

  // navigator.clipboard exige contexto seguro (https o localhost). El
  // Backoffice se sirve dentro de un iframe de googleusercontent, donde a
  // veces no esta disponible: por eso el respaldo con execCommand.
  function copiarAlPortapapeles_(texto) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(texto)
        .then(function () { return true; })
        .catch(function () { return respaldoCopiar_(texto); });
    }
    return Promise.resolve(respaldoCopiar_(texto));
  }

  function respaldoCopiar_(texto) {
    try {
      var area = document.createElement('textarea');
      area.value = texto;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch (e) {
      return false;
    }
  }

  // v4.0 Frente 4: lightbox de imagenes. Delegado a nivel de documento (se
  // registra una sola vez al cargar el script) en vez de que cada pantalla
  // que use galeriaImagenes tenga que cablearlo -- mismo espiritu que el
  // resto de Componentes, que se auto-manejan (aviso, confirmar).
  document.addEventListener('click', function (ev) {
    var boton = ev.target.closest && ev.target.closest('.sigso-galeria__ver');
    if (!boton) return;
    var galeria = boton.closest('.sigso-galeria');
    if (!galeria) return;
    var botones = [].slice.call(galeria.querySelectorAll('.sigso-galeria__ver'));
    var imagenes = botones.map(function (b) {
      var img = b.querySelector('img');
      return { src: img ? img.src : '', alt: img ? img.alt : '' };
    });
    abrirLightbox_(imagenes, botones.indexOf(boton));
  });

  function abrirLightbox_(imagenes, indiceInicial) {
    var actual = indiceInicial;
    var fondo = document.createElement('div');
    fondo.className = 'sigso-lightbox-fondo';

    function marco() {
      var img = imagenes[actual];
      var varias = imagenes.length > 1;
      return '<div class="sigso-lightbox" role="dialog" aria-modal="true" aria-label="Imagen ampliada">' +
        '<button type="button" class="sigso-lightbox__cerrar" aria-label="Cerrar">' + ico_('equis', 20) + '</button>' +
        (varias ? '<button type="button" class="sigso-lightbox__nav sigso-lightbox__nav--prev" aria-label="Imagen anterior">' + ico_('izquierda', 22) + '</button>' : '') +
        '<img src="' + escaparHtml(img.src) + '" alt="' + escaparHtml(img.alt) + '">' +
        (varias ? '<button type="button" class="sigso-lightbox__nav sigso-lightbox__nav--next" aria-label="Imagen siguiente">' + ico_('derecha', 22) + '</button>' : '') +
        (varias ? '<div class="sigso-lightbox__contador">' + (actual + 1) + ' / ' + imagenes.length + '</div>' : '') +
        '</div>';
    }

    function pintar() {
      fondo.innerHTML = marco();
      fondo.querySelector('.sigso-lightbox__cerrar').addEventListener('click', cerrar);
      var prev = fondo.querySelector('.sigso-lightbox__nav--prev');
      var next = fondo.querySelector('.sigso-lightbox__nav--next');
      if (prev) prev.addEventListener('click', function (e) { e.stopPropagation(); mover_(-1); });
      if (next) next.addEventListener('click', function (e) { e.stopPropagation(); mover_(1); });
    }

    function mover_(delta) {
      actual = (actual + delta + imagenes.length) % imagenes.length;
      pintar();
    }

    function cerrar() {
      document.removeEventListener('keydown', alTeclado);
      if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
    }

    function alTeclado(ev) {
      if (ev.key === 'Escape') { cerrar(); return; }
      if (imagenes.length < 2) return;
      if (ev.key === 'ArrowLeft') mover_(-1);
      if (ev.key === 'ArrowRight') mover_(1);
    }

    fondo.addEventListener('click', function (ev) { if (ev.target === fondo) cerrar(); });
    document.addEventListener('keydown', alTeclado);
    pintar();
    document.body.appendChild(fondo);
  }

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
