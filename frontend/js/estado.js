/**
 * estado.js — consulta publica de estado por numero + correo (§3.2, §12.1).
 *
 * Version interina: el correo se envia y se compara directo contra el
 * registrado (ver nota en backend/intake/Solicitudes.gs, estadoPublico). El
 * magic link real (token por Gmail) llega en la Fase 4.
 */
(function () {
  var ESTADOS_CERRADOS_PUBLICO = ['S09', 'S10', 'S11'];
  // Fase 1 ("editar solicitud"): un ítem es editable por el solicitante solo
  // mientras no haya entrado a desarrollo (S01..S04). Espejo de la misma regla
  // del backend (Solicitudes.editarSubsolicitud).
  var EDITABLE_ESTADOS_ = ['S01', 'S02', 'S03', 'S04'];

  // v14.0 (piel nueva): punto de estado por token en vez del emoji que
  // manda el backend (item.cumplimiento.emoji). Mapea el `codigo`.
  var TONO_CUMPLIMIENTO_PUB = {
    ATRASADA_DESARROLLADOR: 'critico', EN_RIESGO: 'riesgo', ESPERANDO_VALIDACION: 'info',
    EN_PLAZO: 'ok', SIN_COMPROMISO: 'neutro', CERRADA_A_TIEMPO: 'ok', CERRADA_CON_ATRASO: 'critico'
  };

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof renderHeaderSigso === 'function') {
      renderHeaderSigso('estado');
    }

    // v3.3: este script tambien se carga en plataforma.html, que solo trae
    // el panel de Mis solicitudes (la consulta por numero y el flujo de
    // correo+codigo siguen viviendo en estado.html). Cada binding se hace
    // solo si su elemento existe -- asi el MISMO archivo sirve a ambas
    // paginas sin duplicarlo.
    var vincular = function (id, evento, handler) {
      var el = document.getElementById(id);
      if (el) el.addEventListener(evento, handler);
    };

    var parametros = new URLSearchParams(window.location.search);
    var idPrellenado = parametros.get('id');
    var campoNumero = document.getElementById('campo-numero-solicitud');
    if (idPrellenado && campoNumero) {
      campoNumero.value = idPrellenado;
    }

    vincular('form-estado', 'submit', manejarConsulta_);

    manejarTabs_();
    vincular('form-pedir-codigo', 'submit', manejarPedirCodigo_);
    vincular('form-verificar-codigo', 'submit', manejarVerificarCodigo_);
    vincular('btn-reenviar-codigo', 'click', function () {
      manejarPedirCodigo_({ preventDefault: function () {} });
    });
    if (document.getElementById('filtro-mis-estado')) {
      poblarFiltroEstados_();
    }
    ['filtro-mis-buscador', 'filtro-mis-estado', 'filtro-mis-desde', 'filtro-mis-hasta'].forEach(function (id) {
      vincular(id, 'input', renderListaFiltrada_);
    });
  });

  // Se recuerda la ultima consulta exitosa para poder recargar el estado
  // despues de que el solicitante responda una pregunta (sin pedirle de
  // nuevo el numero+correo). contenedorId distingue si el detalle vive en la
  // pestaña "Por numero" (#resultado) o en el drill-down de "Mis solicitudes"
  // (#detalle-mis-solicitudes) -- ambas reusan el mismo render/acciones.
  var ultimaConsulta = null;

  // v3.0 (Fase 3, §4): estado de la pestaña "Mis solicitudes".
  var correoParaCodigo_ = null;
  var sesionMisSolicitudes = null;
  var listaCompleta_ = [];

  function manejarTabs_() {
    document.querySelectorAll('.sigso-tabs__boton').forEach(function (boton) {
      boton.addEventListener('click', function () {
        document.querySelectorAll('.sigso-tabs__boton').forEach(function (b) {
          b.classList.remove('sigso-tabs__boton--activo');
        });
        boton.classList.add('sigso-tabs__boton--activo');
        var tab = boton.getAttribute('data-tab');
        document.getElementById('panel-numero').classList.toggle('sigso-oculto', tab !== 'numero');
        document.getElementById('panel-mis-solicitudes').classList.toggle('sigso-oculto', tab !== 'mis-solicitudes');
      });
    });
  }

  function manejarConsulta_(evento) {
    evento.preventDefault();
    var boton = document.getElementById('btn-consultar');
    var solicitudId = document.getElementById('campo-numero-solicitud').value.trim();
    var email = document.getElementById('campo-email-consulta').value.trim();

    ocultarResultado_();
    boton.disabled = true;
    boton.innerHTML = '<span class="sigso-spinner"></span> Consultando...';

    consultar_(solicitudId, email)
      .finally(function () {
        boton.disabled = false;
        boton.textContent = 'Consultar';
      });
  }

  // contenedorId: 'resultado' (pestaña "Por numero") o
  // 'detalle-mis-solicitudes' (drill-down de "Mis solicitudes") -- mismo
  // render y mismas acciones (responder/validar) en ambos casos.
  function consultar_(solicitudId, email, contenedorId) {
    var contenedor = contenedorId || 'resultado';
    return llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'consultarEstado', { solicitud_id: solicitudId, email: email })
      .then(function (respuesta) {
        if (respuesta.ok) {
          ultimaConsulta = { solicitud_id: solicitudId, email: email, contenedorId: contenedor };
          mostrarEstado_(respuesta.data, contenedor);
        } else {
          mostrarError_(respuesta, contenedor);
        }
      })
      .catch(function () {
        mostrarError_({ message: 'No se pudo conectar con el servidor. Intenta nuevamente.' }, contenedor);
      });
  }

  function mostrarEstado_(data, contenedorId) {
    var itemsHtml = data.subsolicitudes.map(function (s, idx) {
      var etiquetaTipo = s.tipo_nombre ? '[' + Componentes.escaparHtml(s.tipo_nombre) + '] ' : '';
      return '<div class="sigso-acordeon-item" data-idx="' + idx + '" data-pregunta-pendiente="' + (s.pregunta_pendiente ? '1' : '0') + '">' +
        '<div class="sigso-acordeon-item__cabecera" data-accion="expandir" data-idx="' + idx + '">' +
        '<span>' + etiquetaTipo + Componentes.escaparHtml(s.titulo) + '</span>' +
        Componentes.badgePrioridad(s.prioridad) + ' ' + Componentes.badgeEstado(s.estado) +
        '</div>' +
        '<div class="sigso-acordeon-item__cuerpo">' + cuerpoItem_(s) + '</div>' +
        '</div>';
    }).join('');

    var pdf = data.url_pdf ? '<p><a href="' + data.url_pdf + '" target="_blank" rel="noopener">Ver documento PDF</a></p>' : '';

    // P2 (v2.0, Sprint 2): "cuantas hay antes que yo" -- solo se muestra si
    // sigue abierta (posicion_cola es null cuando ya esta cerrada/rechazada).
    var cola = '';
    if (typeof data.posicion_cola === 'number') {
      cola = data.posicion_cola > 0
        ? '<p class="sigso-ayuda">Hay ' + data.posicion_cola + ' solicitud(es) de tu empresa con igual o mayor prioridad por delante.</p>'
        : '<p class="sigso-ayuda">Eres la solicitud de mayor prioridad en espera de tu empresa.</p>';
    }

    // v13 (Fase 3, "centro de revisión"): el detalle deja de ser un bloque
    // continuo y pasa a cabecera + progreso + banner (siempre visible) +
    // PESTAÑAS. Los adjuntos de todos los ítems se juntan en su propia
    // pestaña (antes vivían dentro de cada ítem). Los paneles inactivos se
    // OCULTAN por CSS (no se quitan del DOM): así todo el cableado de abajo
    // -- responder, validar, corregir, quitar adjunto -- sigue enganchando
    // igual con querySelectorAll.
    var archivosTab = archivosTab_(data);
    var totalArchivos = data.subsolicitudes.reduce(function (n, s) { return n + (s.archivos || []).length; }, 0);
    var pestanas = [
      { id: 'resumen', etiqueta: 'Resumen',
        html: renderFechaComprometidaResumen_(data) + cola + pdf + resumenSolicitud_(data) },
      { id: 'items', etiqueta: 'Ítems (' + data.subsolicitudes.length + ')', html: itemsHtml }
    ];
    if (archivosTab) pestanas.push({ id: 'archivos', etiqueta: 'Archivos (' + totalArchivos + ')', html: archivosTab });

    // Si hay algo que el solicitante debe HACER (validar / responder), se
    // arranca en la pestaña Ítems para que actúe de una; si no, en Resumen.
    var hayPendiente = data.subsolicitudes.some(function (s) { return s.estado === 'S08' || s.pregunta_pendiente; });
    var activa = hayPendiente ? 'items' : 'resumen';

    var contenedor = document.getElementById(contenedorId || 'resultado');
    contenedor.innerHTML =
      '<div class="sigso-resultado-exito">' +
      '<div class="sigso-detalle-cab">' +
        '<p class="sigso-numero-solicitud">' + data.solicitud_id + '</p>' +
        '<span class="sigso-detalle-cab__chips">' +
          Componentes.badgeEstado(data.estado_derivado) + ' ' + Componentes.badgePrioridad(data.prioridad_derivada) +
        '</span>' +
      '</div>' +
      renderHitos_(data.estado_derivado) +
      renderBannerAcciones_(data) +
      '<div class="sigso-detalle-tabs" role="tablist">' +
        pestanas.map(function (t) {
          return '<button type="button" class="sigso-detalle-tab' + (t.id === activa ? ' is-activa' : '') +
            '" data-tab="' + t.id + '" role="tab" aria-selected="' + (t.id === activa) + '">' + t.etiqueta + '</button>';
        }).join('') +
      '</div>' +
      pestanas.map(function (t) {
        return '<div class="sigso-detalle-panel' + (t.id === activa ? '' : ' sigso-oculto') + '" data-panel="' + t.id + '" role="tabpanel">' +
          t.html + '</div>';
      }).join('') +
      '</div>';

    // v13 (Fase 3): cambio de pestaña. Los paneles se ocultan/muestran; nada
    // se saca del DOM, así que el cableado de acciones no se ve afectado.
    contenedor.querySelectorAll('.sigso-detalle-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-tab');
        contenedor.querySelectorAll('.sigso-detalle-tab').forEach(function (b) {
          var act = b === btn;
          b.classList.toggle('is-activa', act);
          b.setAttribute('aria-selected', act);
        });
        contenedor.querySelectorAll('.sigso-detalle-panel').forEach(function (p) {
          p.classList.toggle('sigso-oculto', p.getAttribute('data-panel') !== id);
        });
      });
    });
    // El banner de acciones lleva a la pestaña Ítems de un clic.
    var irItems = contenedor.querySelector('[data-accion="ir-items"]');
    if (irItems) irItems.addEventListener('click', function () {
      var tabItems = contenedor.querySelector('.sigso-detalle-tab[data-tab="items"]');
      if (tabItems) tabItems.click();
    });

    // Expandir/colapsar el detalle de cada item al hacer clic en la cabecera.
    contenedor.querySelectorAll('[data-accion="expandir"]').forEach(function (el) {
      el.addEventListener('click', function () {
        el.parentElement.classList.toggle('sigso-acordeon-item--activo');
      });
    });

    // Fase 10.1: si el item esta "esperando informacion" (S06), Leo dejo una
    // pregunta -- se responde desde aqui mismo, sin llamar/escribir aparte.
    contenedor.querySelectorAll('[data-accion="enviar-respuesta"]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        enviarRespuesta_(boton.getAttribute('data-subsolicitud'));
      });
    });

    // RN-201: validacion del solicitante sobre un item "Terminada".
    contenedor.querySelectorAll('[data-accion="confirmar-cierre"]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        enviarValidacion_(boton.getAttribute('data-subsolicitud'), 'confirmar');
      });
    });
    contenedor.querySelectorAll('[data-accion="mostrar-reabrir"]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        var bloque = contenedor.querySelector('[data-bloque-reabrir="' + boton.getAttribute('data-subsolicitud') + '"]');
        bloque.classList.toggle('sigso-oculto');
      });
    });
    contenedor.querySelectorAll('[data-accion="enviar-reabrir"]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        var subId = boton.getAttribute('data-subsolicitud');
        var comentario = document.getElementById('motivo-reabrir-' + subId).value.trim();
        if (!comentario) {
          document.querySelector('[data-resultado-validacion="' + subId + '"]').innerHTML =
            Componentes.alerta('Cuéntanos qué falta antes de reabrir.', 'error');
          return;
        }
        enviarValidacion_(subId, 'reabrir', comentario);
      });
    });

    // v3.1 (§1.3B): cierre directo de un item que ya se resolvio por fuera.
    contenedor.querySelectorAll('[data-accion="cerrar-directo"]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        var subId = boton.getAttribute('data-subsolicitud');
        var salida = document.querySelector('[data-resultado-validacion="' + subId + '"]');
        var atencion = {
          activo: true,
          resuelto_por: document.getElementById('cd-quien-' + subId).value.trim(),
          fecha_resolucion: document.getElementById('cd-fecha-' + subId).value,
          detalle: document.getElementById('cd-detalle-' + subId).value.trim()
        };
        // Chequeo local para ahorrar el viaje redondo; el backend re-valida
        // los tres campos igual (son el registro, no un tramite).
        if (!atencion.resuelto_por || !atencion.fecha_resolucion || atencion.detalle.length < 10) {
          salida.innerHTML = Componentes.alerta(
            'Completa quién lo resolvió, cuándo, y qué se hizo (al menos 10 caracteres).', 'error');
          return;
        }
        enviarValidacion_(subId, 'cerrar_directo', '', atencion);
      });
    });

    // Fase 1 + Fase 4 ("flujo de corrección"): revisar (muestra el resumen
    // antes→después), confirmar (guarda de verdad), volver a editar, cancelar.
    contenedor.querySelectorAll('[data-accion="editar-revisar"]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        revisarEdicion_(boton.getAttribute('data-subsolicitud'));
      });
    });
    contenedor.querySelectorAll('[data-accion="editar-confirmar"]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        guardarEdicion_(boton.getAttribute('data-subsolicitud'), boton);
      });
    });
    contenedor.querySelectorAll('[data-accion="editar-volver"]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        volverAEditar_(boton.getAttribute('data-subsolicitud'));
      });
    });
    contenedor.querySelectorAll('[data-accion="quitar-adjunto"]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        quitarAdjunto_(boton.getAttribute('data-archivo'), boton);
      });
    });
    contenedor.querySelectorAll('[data-accion="editar-cancelar"]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        var det = boton.closest('.sigso-item-editar');
        if (det) det.removeAttribute('open');
      });
    });

    // Expande automaticamente items con pregunta pendiente: son los que mas
    // le importan al solicitante en ese momento.
    contenedor.querySelectorAll('.sigso-acordeon-item[data-pregunta-pendiente="1"]').forEach(function (el) {
      el.classList.add('sigso-acordeon-item--activo');
    });

    contenedor.classList.remove('sigso-oculto');
  }

  // UI-3 (§3): linea de tiempo horizontal de hitos -- el solicitante ve el
  // camino recorrido y cuanto falta, no solo una palabra de estado. Los
  // estados intermedios se agrupan en 5 hitos legibles; Rechazada/Cancelada
  // no siguen el camino, se muestran como aviso en vez de barra.
  var HITOS = ['Recibida', 'Aprobada', 'En desarrollo', 'Terminada', 'Cerrada'];
  var NIVEL_POR_ESTADO = {
    S01: 0, S02: 0, S03: 1, S04: 1, S05: 2, S06: 2, S07: 2, S08: 3, S09: 4
  };

  function renderHitos_(estadoDerivado) {
    if (estadoDerivado === 'S10' || estadoDerivado === 'S11') {
      return Componentes.alerta('Esta solicitud fue ' +
        (estadoDerivado === 'S10' ? 'rechazada' : 'cancelada') +
        '. Revisa el detalle de los ítems para ver el motivo.', 'aviso');
    }
    var nivel = NIVEL_POR_ESTADO[estadoDerivado];
    if (nivel === undefined) return '';
    var cerrada = estadoDerivado === 'S09';
    return '<div class="sigso-hitos">' + HITOS.map(function (nombre, idx) {
      var clase = 'sigso-hito';
      var marcador = idx + 1;
      if (idx < nivel || cerrada) { clase += ' sigso-hito--hecho'; marcador = '✓'; }
      else if (idx === nivel) { clase += ' sigso-hito--actual'; marcador = '●'; }
      return '<span class="' + clase + '"><span class="sigso-hito__n">' + marcador + '</span>' + nombre + '</span>';
    }).join('<span class="sigso-hito__union"></span>') + '</div>';
  }

  // UI-3 (§3): si el solicitante tiene algo que HACER (validar un item
  // Terminada, o responder una pregunta), se le dice arriba de todo -- es
  // lo unico realmente urgente de esta pantalla.
  function renderBannerAcciones_(data) {
    var porValidar = data.subsolicitudes.filter(function (s) { return s.estado === 'S08'; }).length;
    var porResponder = data.subsolicitudes.filter(function (s) { return s.pregunta_pendiente; }).length;
    var avisos = [];
    if (porValidar > 0) avisos.push(porValidar + ' ítem(s) esperando tu validación');
    if (porResponder > 0) avisos.push(porResponder + ' pregunta(s) del equipo por responder');
    if (avisos.length === 0) return '';
    // v13 (Fase 3): el banner es clickeable y lleva a la pestaña Ítems (donde
    // están las acciones), en vez de "más abajo".
    return '<button type="button" class="sigso-banner-accion" data-accion="ir-items">' +
      Iconos.svg('alerta', { tam: 16 }) + ' Tienes ' + avisos.join(' y ') +
      ' — revísalos en la pestaña Ítems.</button>';
  }

  // v13 (Fase 3): resumen chico de la solicitud para la pestaña Resumen --
  // cuántos ítems y cómo van, sin tener que abrir cada uno.
  function resumenSolicitud_(data) {
    var subs = data.subsolicitudes || [];
    var abiertos = subs.filter(function (s) { return ESTADOS_CERRADOS_PUBLICO.indexOf(s.estado) === -1 && s.estado !== 'S08'; }).length;
    var terminados = subs.filter(function (s) { return s.estado === 'S08'; }).length;
    var cerrados = subs.filter(function (s) { return ESTADOS_CERRADOS_PUBLICO.indexOf(s.estado) !== -1; }).length;
    var partes = [];
    if (abiertos) partes.push(abiertos + ' en curso');
    if (terminados) partes.push(terminados + ' por validar');
    if (cerrados) partes.push(cerrados + ' cerrado(s)');
    return '<p class="sigso-ayuda">' + subs.length + ' ítem(s)' +
      (partes.length ? ': ' + partes.join(' · ') : '') + '.</p>';
  }

  // v13 (Fase 3): pestaña Archivos -- junta los adjuntos de todos los ítems,
  // agrupados por ítem para no perder el contexto. Vacío si no hay ninguno.
  function archivosTab_(data) {
    var conArchivos = (data.subsolicitudes || []).filter(function (s) { return (s.archivos || []).length; });
    if (!conArchivos.length) return '';
    return conArchivos.map(function (s) {
      return '<div class="sigso-archivos-grupo">' +
        '<h4 class="sigso-archivos-grupo__titulo">' + Componentes.escaparHtml(s.titulo || 'Ítem') + '</h4>' +
        galeriaItemPublico_(s.archivos, true) +
      '</div>';
    }).join('');
  }

  // UI-3 (§3): la fecha comprometida mas proxima entre los items abiertos,
  // con su semaforo -- es lo que el solicitante realmente quiere saber.
  function renderFechaComprometidaResumen_(data) {
    var abiertosConFecha = data.subsolicitudes.filter(function (s) {
      return s.fecha_comprometida && ['S09', 'S10', 'S11'].indexOf(s.estado) === -1;
    }).sort(function (a, b) { return new Date(a.fecha_comprometida) - new Date(b.fecha_comprometida); });
    if (abiertosConFecha.length === 0) return '';
    var item = abiertosConFecha[0];
    var semaforo = item.cumplimiento
      ? ' <span class="sigso-semaforo-inline">' + Componentes.punto(TONO_CUMPLIMIENTO_PUB[item.cumplimiento.codigo] || 'neutro') + Componentes.escaparHtml(item.cumplimiento.etiqueta) + '</span>'
      : '';
    return '<div class="sigso-fecha-destacada">' + Iconos.svg('calendario', { tam: 15 }) + ' Próxima entrega comprometida: <strong>' +
      Componentes.escaparHtml(formatearFechaHora_(item.fecha_comprometida)) + '</strong>' + semaforo +
      (abiertosConFecha.length > 1 ? ' <span class="sigso-ayuda-inline">(+' + (abiertosConFecha.length - 1) + ' ítem(s) más con fecha)</span>' : '') +
      '</div>';
  }

  function cuerpoItem_(s) {
    var filas = '';
    if (s.modulo_nombre) filas += campo_('Módulo', s.modulo_nombre);
    if (s.descripcion) filas += campo_('Lo que reportaste', s.descripcion);
    if (s.resultado_esperado) filas += campo_('Resultado esperado', s.resultado_esperado);
    if (s.contexto) filas += campo_('Contexto', s.contexto);
    // v2.1 (Fase A): la fecha comprometida por el desarrollador es la
    // definitiva -- se muestra primero y con mas peso que la propuesta.
    if (s.fecha_comprometida) {
      filas += campo_('Fecha comprometida', formatearFechaHora_(s.fecha_comprometida));
    } else if (s.fecha_propuesta) {
      filas += '<p class="sigso-ayuda">Para cuándo lo pediste: ' + Componentes.escaparHtml(formatearFechaHora_(s.fecha_propuesta)) + ' (a confirmar por el equipo).</p>';
    }
    // v13 (Fase 3): los adjuntos ya NO se muestran dentro del ítem -- viven en
    // la pestaña Archivos del detalle (agrupados por ítem). Quitarlos de acá
    // evita duplicar y aligera el bloque del ítem.

    // Fase 1 ("editar solicitud"): si el ítem todavía es editable, se ofrece
    // corregir lo que se llenó con un error (título, descripción, contexto,
    // resultado) y agregar imágenes -- plegado, para no competir con la lectura.
    if (EDITABLE_ESTADOS_.indexOf(s.estado) !== -1) {
      filas += bloqueEdicion_(s);
    }

    if (s.pregunta_pendiente) {
      filas += Componentes.alerta('El equipo necesita más información: ' + s.pregunta_pendiente, 'aviso') +
        '<div class="sigso-campo">' +
        '<label for="respuesta-' + s.subsolicitud_id + '">Tu respuesta</label>' +
        '<textarea id="respuesta-' + s.subsolicitud_id + '" data-campo="respuesta" data-subsolicitud="' + s.subsolicitud_id + '"></textarea>' +
        '</div>' +
        '<button type="button" class="sigso-boton--secundario" data-accion="enviar-respuesta" data-subsolicitud="' + s.subsolicitud_id + '">Enviar respuesta</button>' +
        '<div data-resultado-respuesta="' + s.subsolicitud_id + '"></div>';
    }
    // RN-201 (v2.0, Sprint 1): un item "Terminada" (S08) espera la
    // validacion del solicitante -- confirmar que quedo resuelto (se cierra)
    // o indicar que falta (vuelve a En desarrollo). Si nadie valida, se
    // cierra solo tras unos dias (Triggers.cerrarInactivosTrigger, Backoffice).
    if (s.estado === 'S08') {
      filas += Componentes.alerta('Este ítem está terminado. Confírmalo si quedó resuelto, o cuéntanos si no.', 'aviso') +
        '<div class="sigso-acciones-item">' +
        '<button type="button" class="sigso-boton" data-accion="confirmar-cierre" data-subsolicitud="' + s.subsolicitud_id + '">Confirmar y cerrar</button> ' +
        '<button type="button" class="sigso-boton--secundario" data-accion="mostrar-reabrir" data-subsolicitud="' + s.subsolicitud_id + '">No quedó resuelto</button>' +
        '</div>' +
        '<div class="sigso-oculto" data-bloque-reabrir="' + s.subsolicitud_id + '">' +
        '<div class="sigso-campo">' +
        '<label for="motivo-reabrir-' + s.subsolicitud_id + '">Cuéntanos qué falta</label>' +
        '<textarea id="motivo-reabrir-' + s.subsolicitud_id + '" data-campo="motivo-reabrir" data-subsolicitud="' + s.subsolicitud_id + '"></textarea>' +
        '</div>' +
        '<button type="button" class="sigso-boton--secundario" data-accion="enviar-reabrir" data-subsolicitud="' + s.subsolicitud_id + '">Enviar</button>' +
        '</div>' +
        '<div data-resultado-validacion="' + s.subsolicitud_id + '"></div>';
    }
    // v3.1 (§1.3B): un item abierto que se termino resolviendo por telefono.
    // Sin esto habria que arrastrarlo por todo el flujo solo para cerrarlo, o
    // dejarlo abierto para siempre. Se ofrece plegado (<details>) porque es la
    // excepcion, no el camino normal.
    if (ESTADOS_CERRADOS_PUBLICO.indexOf(s.estado) === -1 && s.estado !== 'S08') {
      filas += '<details class="sigso-cierre-directo">' +
        '<summary>Ya se resolvió por fuera del sistema</summary>' +
        '<p class="sigso-ayuda">Si esto ya se solucionó (por ejemplo, llamando al desarrollador), ' +
        'ciérralo dejando el registro de lo que pasó.</p>' +
        '<div class="sigso-campo">' +
        '<label for="cd-quien-' + s.subsolicitud_id + '">¿Quién lo resolvió?</label>' +
        '<input type="text" id="cd-quien-' + s.subsolicitud_id + '" />' +
        '</div>' +
        '<div class="sigso-campo">' +
        '<label for="cd-fecha-' + s.subsolicitud_id + '">¿Cuándo se resolvió?</label>' +
        '<input type="datetime-local" id="cd-fecha-' + s.subsolicitud_id + '" />' +
        '</div>' +
        '<div class="sigso-campo">' +
        '<label for="cd-detalle-' + s.subsolicitud_id + '">¿Qué se hizo?</label>' +
        '<textarea id="cd-detalle-' + s.subsolicitud_id + '"></textarea>' +
        '</div>' +
        '<button type="button" class="sigso-boton--secundario" data-accion="cerrar-directo" data-subsolicitud="' + s.subsolicitud_id + '">Registrar y cerrar</button>' +
        '<div data-resultado-validacion="' + s.subsolicitud_id + '"></div>' +
        '</details>';
    }
    return filas || '<p class="sigso-ayuda">Sin detalle adicional.</p>';
  }

  function enviarRespuesta_(subsolicitudId) {
    var textarea = document.getElementById('respuesta-' + subsolicitudId);
    var boton = document.querySelector('[data-accion="enviar-respuesta"][data-subsolicitud="' + subsolicitudId + '"]');
    var contenedorResultado = document.querySelector('[data-resultado-respuesta="' + subsolicitudId + '"]');
    var texto = textarea.value.trim();
    if (!texto) {
      contenedorResultado.innerHTML = Componentes.alerta('Escribe una respuesta antes de enviar.', 'error');
      return;
    }

    boton.disabled = true;
    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'responderConsulta', {
      solicitud_id: ultimaConsulta.solicitud_id,
      subsolicitud_id: subsolicitudId,
      email: ultimaConsulta.email,
      texto: texto
    }).then(function (respuesta) {
      if (!respuesta.ok) {
        contenedorResultado.innerHTML = Componentes.alerta(respuesta.message || 'No se pudo enviar la respuesta.', 'error');
        boton.disabled = false;
        return;
      }
      // Recarga el estado: el item sigue en "esperando informacion" hasta
      // que Leo lo mueva, pero la respuesta ya quedo registrada.
      return consultar_(ultimaConsulta.solicitud_id, ultimaConsulta.email, ultimaConsulta.contenedorId);
    });
  }

  function enviarValidacion_(subsolicitudId, accion, comentario, atencionDirecta) {
    var contenedorResultado = document.querySelector('[data-resultado-validacion="' + subsolicitudId + '"]');
    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'validarCierre', {
      solicitud_id: ultimaConsulta.solicitud_id,
      subsolicitud_id: subsolicitudId,
      email: ultimaConsulta.email,
      accion: accion,
      comentario: comentario || '',
      // v3.1 (§1.3B): solo viaja en 'cerrar_directo'; el backend lo exige
      // completo en ese caso e ignora el resto.
      atencion_directa: atencionDirecta || null
    }).then(function (respuesta) {
      if (!respuesta.ok) {
        contenedorResultado.innerHTML = Componentes.alerta(respuesta.message || 'No se pudo aplicar la validacion.', 'error');
        return;
      }
      return consultar_(ultimaConsulta.solicitud_id, ultimaConsulta.email, ultimaConsulta.contenedorId);
    });
  }

  // Acepta 'YYYY-MM-DD' o 'YYYY-MM-DDTHH:MM' (ver Fase A, fecha_propuesta);
  // se muestra tal cual sin hora si no la trae, para no inventar un "00:00".
  function formatearFechaHora_(valor) {
    var partes = String(valor).split('T');
    if (partes.length < 2) return partes[0];
    return partes[0] + ' ' + partes[1].slice(0, 5);
  }

  function campo_(etiqueta, valor) {
    return '<p><strong>' + Componentes.escaparHtml(etiqueta) + ':</strong> ' + Componentes.escaparHtml(valor) + '</p>';
  }

  // Fase 1 ("editar solicitud") + v13 (Fase 4, "flujo de corrección"): bloque
  // de corrección por ítem, ahora en DOS fases claras -- editar y CONFIRMAR.
  // El valor original de cada campo queda en input.defaultValue (el value
  // precargado), así que el diff antes→después se calcula sin guardar nada
  // aparte. Guardar no persiste de una: primero muestra qué va a cambiar.
  function bloqueEdicion_(s) {
    var id = s.subsolicitud_id;
    return '<details class="sigso-item-editar">' +
      '<summary>' + Iconos.svg('editar', { tam: 14 }) + ' Corregir este ítem</summary>' +
      '<div class="sigso-item-editar__cuerpo">' +
        '<p class="sigso-ayuda">Estás modificando la información que enviaste para este ítem. Al guardar, verás un resumen de los cambios antes de confirmar.</p>' +
        '<div class="sigso-campo">' +
          '<label for="ed-titulo-' + id + '">Título</label>' +
          '<input type="text" id="ed-titulo-' + id + '" value="' + Componentes.escaparHtml(s.titulo || '') + '" />' +
        '</div>' +
        '<div class="sigso-campo">' +
          '<label for="ed-desc-' + id + '">Descripción</label>' +
          '<textarea id="ed-desc-' + id + '">' + Componentes.escaparHtml(s.descripcion || '') + '</textarea>' +
        '</div>' +
        '<div class="sigso-campo">' +
          '<label for="ed-ctx-' + id + '">Contexto (opcional)</label>' +
          '<textarea id="ed-ctx-' + id + '">' + Componentes.escaparHtml(s.contexto || '') + '</textarea>' +
        '</div>' +
        '<div class="sigso-campo">' +
          '<label for="ed-res-' + id + '">Resultado esperado (opcional)</label>' +
          '<textarea id="ed-res-' + id + '">' + Componentes.escaparHtml(s.resultado_esperado || '') + '</textarea>' +
        '</div>' +
        adjuntosActualesHtml_(s) +
        '<div class="sigso-campo">' +
          '<label for="ed-img-' + id + '">Agregar imágenes (opcional)</label>' +
          '<input type="file" id="ed-img-' + id + '" accept="image/png,image/jpeg,image/gif" multiple />' +
        '</div>' +
        // Fase de EDICIÓN: "Guardar cambios" no persiste; lleva a confirmar.
        '<div class="sigso-acciones-item" data-fase-editar="' + id + '">' +
          '<button type="button" class="sigso-boton" data-accion="editar-revisar" data-subsolicitud="' + id + '">Guardar cambios</button> ' +
          '<button type="button" class="sigso-boton--secundario" data-accion="editar-cancelar" data-subsolicitud="' + id + '">Cancelar</button>' +
        '</div>' +
        // Fase de CONFIRMACIÓN: resumen antes→después + confirmar/volver.
        '<div class="sigso-editar-confirmar sigso-oculto" data-fase-confirmar="' + id + '">' +
          '<p class="sigso-editar-confirmar__titulo">¿Confirmar corrección?</p>' +
          '<p class="sigso-ayuda">Se actualizará la información de este ítem. El cambio queda registrado y el equipo lo verá.</p>' +
          '<div class="sigso-editar-diff" data-diff="' + id + '"></div>' +
          '<div class="sigso-acciones-item">' +
            '<button type="button" class="sigso-boton" data-accion="editar-confirmar" data-subsolicitud="' + id + '">Confirmar corrección</button> ' +
            '<button type="button" class="sigso-boton--secundario" data-accion="editar-volver" data-subsolicitud="' + id + '">Volver a editar</button>' +
          '</div>' +
        '</div>' +
        '<div data-resultado-editar="' + id + '"></div>' +
      '</div>' +
    '</details>';
  }

  // v13 (Fase 4): al pulsar "Guardar cambios" se REVISA -- se valida, se
  // calcula el diff antes→después contra los valores originales (defaultValue)
  // y se muestra el resumen para confirmar. No persiste todavía.
  function revisarEdicion_(subId) {
    var salida = document.querySelector('[data-resultado-editar="' + subId + '"]');
    salida.innerHTML = '';
    var titulo = document.getElementById('ed-titulo-' + subId);
    var descripcion = document.getElementById('ed-desc-' + subId);
    if (titulo.value.trim().length < 3 || descripcion.value.trim().length < 5) {
      salida.innerHTML = Componentes.alerta('El título y la descripción no pueden quedar vacíos.', 'error');
      return;
    }
    var campos = [
      { el: titulo, label: 'Título' },
      { el: descripcion, label: 'Descripción' },
      { el: document.getElementById('ed-ctx-' + subId), label: 'Contexto' },
      { el: document.getElementById('ed-res-' + subId), label: 'Resultado esperado' }
    ];
    var cambios = campos.filter(function (c) { return c.el.defaultValue.trim() !== c.el.value.trim(); });
    var imgs = (document.getElementById('ed-img-' + subId).files || []).length;

    if (cambios.length === 0 && imgs === 0) {
      salida.innerHTML = Componentes.alerta('No cambiaste nada todavía.', 'aviso');
      return;
    }

    var diff = cambios.map(function (c) {
      return '<div class="sigso-editar-diff__campo">' +
        '<span class="sigso-editar-diff__l">' + c.label + '</span>' +
        '<span class="sigso-editar-diff__antes">' + Componentes.escaparHtml(recortar_(c.el.defaultValue) || '(vacío)') + '</span>' +
        '<span class="sigso-editar-diff__flecha">→</span>' +
        '<span class="sigso-editar-diff__despues">' + Componentes.escaparHtml(recortar_(c.el.value) || '(vacío)') + '</span>' +
      '</div>';
    }).join('');
    if (imgs > 0) {
      diff += '<div class="sigso-editar-diff__campo"><span class="sigso-editar-diff__l">Imágenes</span>' +
        '<span class="sigso-editar-diff__despues">+ ' + imgs + ' imagen(es) nueva(s)</span></div>';
    }
    document.querySelector('[data-diff="' + subId + '"]').innerHTML = diff;
    document.querySelector('[data-fase-editar="' + subId + '"]').classList.add('sigso-oculto');
    document.querySelector('[data-fase-confirmar="' + subId + '"]').classList.remove('sigso-oculto');
  }

  function volverAEditar_(subId) {
    document.querySelector('[data-fase-confirmar="' + subId + '"]').classList.add('sigso-oculto');
    document.querySelector('[data-fase-editar="' + subId + '"]').classList.remove('sigso-oculto');
  }

  function recortar_(texto) {
    texto = String(texto || '').trim().replace(/\s+/g, ' ');
    return texto.length > 90 ? texto.slice(0, 90) + '…' : texto;
  }

  // Fase 1 (cierre): adjuntos ya subidos, con opción de quitar el que se
  // subió por error. Confirmación en DOS toques, sin diálogo nativo.
  function adjuntosActualesHtml_(s) {
    var lista = s.archivos || [];
    if (!lista.length) return '';
    return '<div class="sigso-campo">' +
      '<label>Adjuntos actuales</label>' +
      lista.map(function (a) {
        return '<div class="sigso-adjunto-fila">' +
          '<span>' + Componentes.escaparHtml(a.nombre_original || 'archivo') + '</span>' +
          '<button type="button" class="sigso-boton--sutil sigso-adjunto-quitar" ' +
            'data-accion="quitar-adjunto" data-archivo="' + Componentes.escaparHtml(a.archivo_id || '') + '">Quitar</button>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  function quitarAdjunto_(archivoId, boton) {
    if (boton.dataset.armado !== '1') {
      boton.dataset.armado = '1';
      boton.textContent = '¿Confirmar?';
      boton.classList.add('is-armado');
      return;
    }
    boton.disabled = true;
    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'eliminarArchivo', {
      solicitud_id: ultimaConsulta.solicitud_id,
      archivo_id: archivoId,
      email: ultimaConsulta.email
    }).then(function (respuesta) {
      if (!respuesta.ok) {
        Componentes.aviso({ texto: respuesta.message || 'No se pudo quitar el adjunto.', tipo: 'error' });
        boton.disabled = false;
        boton.dataset.armado = '';
        boton.textContent = 'Quitar';
        boton.classList.remove('is-armado');
        return;
      }
      return consultar_(ultimaConsulta.solicitud_id, ultimaConsulta.email, ultimaConsulta.contenedorId);
    }).catch(function () {
      Componentes.aviso({ texto: 'No se pudo conectar. Intenta nuevamente.', tipo: 'error' });
      boton.disabled = false;
      boton.dataset.armado = '';
      boton.textContent = 'Quitar';
      boton.classList.remove('is-armado');
    });
  }

  function guardarEdicion_(subId, boton) {
    var salida = document.querySelector('[data-resultado-editar="' + subId + '"]');
    var titulo = document.getElementById('ed-titulo-' + subId).value.trim();
    var descripcion = document.getElementById('ed-desc-' + subId).value.trim();
    if (titulo.length < 3 || descripcion.length < 5) {
      salida.innerHTML = Componentes.alerta('El título y la descripción no pueden quedar vacíos.', 'error');
      return;
    }
    var archivos = (document.getElementById('ed-img-' + subId).files) || [];
    var textoPrevio = boton.textContent;
    boton.disabled = true;
    boton.innerHTML = '<span class="sigso-spinner"></span> Guardando...';

    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'editarSubsolicitud', {
      solicitud_id: ultimaConsulta.solicitud_id,
      subsolicitud_id: subId,
      email: ultimaConsulta.email,
      titulo: titulo,
      descripcion: descripcion,
      contexto: document.getElementById('ed-ctx-' + subId).value.trim(),
      resultado_esperado: document.getElementById('ed-res-' + subId).value.trim()
    }).then(function (respuesta) {
      if (!respuesta.ok) {
        salida.innerHTML = Componentes.alerta(respuesta.message || 'No se pudo guardar la corrección.', 'error');
        boton.disabled = false;
        boton.textContent = textoPrevio;
        return;
      }
      // Con la corrección ya guardada, suben las imágenes nuevas (si hay) y
      // recién ahí se recarga el estado para verlo todo actualizado.
      return subirImagenesEdicion_(ultimaConsulta.solicitud_id, subId, archivos).then(function () {
        // v13 (Fase 4): feedback explícito de que quedó guardado, además del
        // detalle recargado con los datos nuevos.
        Componentes.aviso({ tipo: 'exito', texto: 'Corrección guardada.' });
        return consultar_(ultimaConsulta.solicitud_id, ultimaConsulta.email, ultimaConsulta.contenedorId);
      });
    }).catch(function () {
      salida.innerHTML = Componentes.alerta('No se pudo conectar. Intenta nuevamente.', 'error');
      boton.disabled = false;
      boton.textContent = textoPrevio;
    });
  }

  // Sube las imágenes nuevas de una edición en serie, reusando subirArchivo
  // (mismo payload que el formulario de creación). Un fallo puntual no corta.
  function subirImagenesEdicion_(solicitudId, subId, fileList) {
    var files = [].slice.call(fileList || []);
    if (!files.length) return Promise.resolve();
    return files.reduce(function (p, file) {
      return p.then(function () {
        return leerArchivoBase64Estado_(file).then(function (base64) {
          return llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'subirArchivo', {
            solicitud_id: solicitudId, subsolicitud_id: subId,
            nombre_archivo: file.name, contenido_base64: base64
          });
        }).catch(function () { /* un adjunto fallido no bloquea los demás */ });
      });
    }, Promise.resolve());
  }

  function leerArchivoBase64Estado_(archivo) {
    return new Promise(function (resolve, reject) {
      var lector = new FileReader();
      lector.onload = function () { resolve(String(lector.result).split(',')[1] || ''); };
      lector.onerror = reject;
      lector.readAsDataURL(archivo);
    });
  }

  // Fase 1: galería de adjuntos del ítem (imágenes con lightbox + documentos
  // como lista). Mismo patrón que el detalle del staff (detalle.js), reusando
  // Componentes.galeriaImagenes / listaArchivos.
  function galeriaItemPublico_(archivos, sinTitulo) {
    var todos = archivos || [];
    if (!todos.length) return '';
    var imagenes = todos.filter(function (a) { return String(a.tipo_mime || '').indexOf('image/') === 0; });
    var documentos = todos.filter(function (a) { return String(a.tipo_mime || '').indexOf('image/') !== 0; });
    var partes = '';
    if (imagenes.length) {
      partes += Componentes.galeriaImagenes(imagenes.map(function (a) {
        return {
          url: a.url, nombre: a.nombre_original, descripcion: '', esImagen: true,
          meta: { tipo_mime: a.tipo_mime, tamano_bytes: a.tamano_bytes, fecha_subida: a.fecha_subida }
        };
      }));
    }
    if (documentos.length) partes += Componentes.listaArchivos(documentos);
    // v13 (Fase 3): en la pestaña Archivos, el título propio sobra (ya está el
    // nombre del ítem arriba); sinTitulo lo omite.
    return sinTitulo
      ? '<div class="sigso-adjuntos-item">' + partes + '</div>'
      : '<div class="sigso-adjuntos-item"><p><strong>Adjuntos que enviaste</strong></p>' + partes + '</div>';
  }

  function mostrarError_(respuesta, contenedorId) {
    var mensaje = respuesta.message || 'No se pudo consultar el estado.';
    var contenedor = document.getElementById(contenedorId || 'resultado');
    contenedor.innerHTML = Componentes.alerta(mensaje, 'error');
    contenedor.classList.remove('sigso-oculto');
  }

  function ocultarResultado_() {
    var contenedor = document.getElementById('resultado');
    contenedor.classList.add('sigso-oculto');
    contenedor.innerHTML = '';
  }

  // ------------------------------------------------------------------
  // v3.0 (Fase 3, §4): "Mis solicitudes" -- codigo de un solo uso, lista
  // filtrable con resumen y semaforo del solicitante, drill-down (reusa
  // consultar_/mostrarEstado_ de arriba, apuntando a #detalle-mis-solicitudes).
  // ------------------------------------------------------------------

  function manejarPedirCodigo_(evento) {
    evento.preventDefault();
    var email = document.getElementById('campo-email-mis-solicitudes').value.trim();
    if (!email) return;

    var boton = document.getElementById('btn-pedir-codigo');
    var resultado = document.getElementById('resultado-verificar-codigo');
    boton.disabled = true;

    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'solicitarCodigoAcceso', { email: email })
      .then(function () {
        correoParaCodigo_ = email;
        document.getElementById('form-pedir-codigo').classList.add('sigso-oculto');
        document.getElementById('form-verificar-codigo').classList.remove('sigso-oculto');
        document.getElementById('texto-codigo-enviado').textContent =
          'Te enviamos un código a ' + email + '. Puede tardar unos minutos en llegar.';
        resultado.innerHTML = '';
      })
      .catch(function () {
        resultado.innerHTML = Componentes.alerta('No se pudo enviar el código. Intenta nuevamente.', 'error');
      })
      .finally(function () {
        boton.disabled = false;
      });
  }

  function manejarVerificarCodigo_(evento) {
    evento.preventDefault();
    var codigo = document.getElementById('campo-codigo-acceso').value.trim();
    var boton = document.getElementById('btn-verificar-codigo');
    var resultado = document.getElementById('resultado-verificar-codigo');
    boton.disabled = true;

    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'misSolicitudes', { email: correoParaCodigo_, codigo: codigo })
      .then(function (respuesta) {
        if (!respuesta.ok) {
          resultado.innerHTML = Componentes.alerta(respuesta.message || 'Código inválido o expirado.', 'error');
          return;
        }
        sesionMisSolicitudes = { email: correoParaCodigo_ };
        listaCompleta_ = respuesta.data.solicitudes;
        document.getElementById('form-verificar-codigo').classList.add('sigso-oculto');
        document.getElementById('panel-lista-mis-solicitudes').classList.remove('sigso-oculto');
        renderResumenMisSolicitudes_(respuesta.data.resumen);
        renderListaFiltrada_();
      })
      .catch(function () {
        resultado.innerHTML = Componentes.alerta('No se pudo verificar el código.', 'error');
      })
      .finally(function () {
        boton.disabled = false;
      });
  }

  // v3.3 (plataforma): entrada directa con sesion de la plataforma -- sin
  // correo+codigo. Reusa TODO el render de Mis solicitudes (lista, filtros,
  // drill-down); lo unico que cambia es como se obtienen los datos. Lo llama
  // plataforma.js al abrir el modulo.
  window.SigsoMisSolicitudes = {
    cargarConToken: function (token) {
      var panel = document.getElementById('panel-lista-mis-solicitudes');
      var lista = document.getElementById('lista-mis-solicitudes');
      lista.innerHTML = Componentes.esqueleto({ filas: 4 });
      panel.classList.remove('sigso-oculto');
      var self = this;
      return llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'misSolicitudes', { token: token })
        .then(function (respuesta) {
          if (!respuesta.ok) {
            mostrarErrorMisSolicitudes_(lista, respuesta.message || 'No pudimos cargar tus solicitudes.',
              function () { self.cargarConToken(token); });
            return respuesta;
          }
          // Sin email global: el drill-down usa el email_coincidente por fila.
          sesionMisSolicitudes = { email: '' };
          listaCompleta_ = respuesta.data.solicitudes;
          renderResumenMisSolicitudes_(respuesta.data.resumen);
          renderListaFiltrada_();
          return respuesta;
        })
        .catch(function () {
          // v13 (Fase 2): un fallo de red también muestra el estado de error
          // con "Reintentar" -- antes quedaba el esqueleto girando sin salida.
          mostrarErrorMisSolicitudes_(lista, 'No pudimos conectar con el servidor.',
            function () { self.cargarConToken(token); });
        });
    }
  };

  // v13 (Fase 2): estado de error del listado, con acción de reintentar.
  function mostrarErrorMisSolicitudes_(contenedor, mensaje, reintentar) {
    contenedor.innerHTML =
      '<div class="sigso-estado-error">' +
        Iconos.svg('alerta', { tam: 22 }) +
        '<p>' + Componentes.escaparHtml(mensaje) + '</p>' +
        '<button type="button" class="sigso-boton--secundario js-mis-reintentar">Reintentar</button>' +
      '</div>';
    var boton = contenedor.querySelector('.js-mis-reintentar');
    if (boton) boton.addEventListener('click', reintentar);
  }

  // v13 (Fase 2, "piel del listado"): el resumen deja de ser una frase en
  // texto y pasa a KPIs compactos y escaneables (< 2 s para entender el
  // estado general). "Cerradas" no viene del backend -- se calcula acá desde
  // la lista completa (S09/S10/S11), sin pedir nada nuevo.
  function renderResumenMisSolicitudes_(resumen) {
    var cerradas = listaCompleta_.filter(function (s) {
      return ESTADOS_CERRADOS_PUBLICO.indexOf(s.estado_derivado) !== -1;
    }).length;
    var kpis = [
      { n: resumen.total, l: 'Total', cls: 'total' },
      { n: resumen.abiertas, l: 'Abiertas', cls: 'abiertas' },
      { n: resumen.en_desarrollo, l: 'En desarrollo', cls: 'desarrollo' },
      { n: resumen.pendientes_validar, l: 'Pendientes de validar', cls: 'pendientes', alerta: resumen.pendientes_validar > 0 },
      { n: cerradas, l: 'Cerradas', cls: 'cerradas' }
    ];
    document.getElementById('resumen-mis-solicitudes').innerHTML =
      '<div class="sigso-mis-kpis">' + kpis.map(function (k) {
        return '<div class="sigso-mis-kpi sigso-mis-kpi--' + k.cls + (k.alerta ? ' is-alerta' : '') + '">' +
          '<span class="sigso-mis-kpi__n">' + k.n + '</span>' +
          '<span class="sigso-mis-kpi__l">' + Componentes.escaparHtml(k.l) + '</span>' +
        '</div>';
      }).join('') + '</div>';
  }

  function poblarFiltroEstados_() {
    var select = document.getElementById('filtro-mis-estado');
    Object.keys(SIGSO_ESTADOS_LABEL).forEach(function (codigo) {
      var option = document.createElement('option');
      option.value = codigo;
      option.textContent = SIGSO_ESTADOS_LABEL[codigo];
      select.appendChild(option);
    });
  }

  function renderListaFiltrada_() {
    var texto = document.getElementById('filtro-mis-buscador').value.trim().toLowerCase();
    var estado = document.getElementById('filtro-mis-estado').value;
    var desde = document.getElementById('filtro-mis-desde').value;
    var hasta = document.getElementById('filtro-mis-hasta').value;

    var filtradas = listaCompleta_.filter(function (s) {
      if (estado && s.estado_derivado !== estado) return false;
      var fechaDia = String(s.fecha_creacion).slice(0, 10);
      if (desde && fechaDia < desde) return false;
      if (hasta && fechaDia > hasta) return false;
      if (texto) {
        var haystack = (s.solicitud_id + ' ' + (s.empresa_nombre || '')).toLowerCase();
        if (haystack.indexOf(texto) === -1) return false;
      }
      return true;
    });

    var contenedor = document.getElementById('lista-mis-solicitudes');
    // v13 (Fase 2): "no tienes solicitudes todavía" (vacío real) es distinto de
    // "ninguna coincide con el filtro" -- un mensaje que sirva para cada caso.
    if (listaCompleta_.length === 0) {
      contenedor.innerHTML = Componentes.vacio({
        icono: 'lista',
        texto: 'No tienes solicitudes todavía.',
        detalle: 'Cuando ingreses un pedido al equipo, aparecerá acá para que sigas su estado.'
      });
      return;
    }
    if (filtradas.length === 0) {
      contenedor.innerHTML = Componentes.vacio({
        icono: 'filtro',
        texto: 'No encontramos solicitudes con estos filtros.',
        detalle: 'Ajusta la búsqueda o vuelve a "Todos" para ver el listado completo.'
      });
      return;
    }

    contenedor.innerHTML = filtradas.map(function (s) {
      var semaforo = s.items_pendientes_validar > 0
        ? '<div class="sigso-bandeja__semaforo">' + Componentes.punto('info') + 'Llevas ' + (s.dias_esperando_max || 0) +
          ' día(s) sin revisar ' + s.items_pendientes_validar + ' ítem(s)</div>'
        : '';
      // v3.3: con sesion de la plataforma (cuenta multi-correo), cada
      // solicitud puede pertenecer a un correo DISTINTO de la cuenta -- el
      // drill-down (consultar_) valida por correo, asi que viaja por fila.
      return '<button type="button" class="sigso-bandeja__fila" data-solicitud="' + s.solicitud_id + '"' +
        ' data-email="' + Componentes.escaparHtml(s.email_coincidente || '') + '">' +
        '<div class="sigso-bandeja__fila-cabecera">' +
        '<strong class="sigso-id">' + Componentes.escaparHtml(s.solicitud_id) + '</strong>' +
        '<span>' + Componentes.badgePrioridad(s.prioridad_derivada) + ' ' + Componentes.badgeEstado(s.estado_derivado) + '</span>' +
        '</div>' +
        '<div class="sigso-bandeja__fila-meta">' +
        Componentes.escaparHtml(s.empresa_nombre || '') + ' — ' + formatearFechaHora_(s.fecha_creacion) +
        ' — ' + s.total_items + ' ítem(s)</div>' +
        semaforo +
        '</button>';
    }).join('');

    contenedor.querySelectorAll('[data-solicitud]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        contenedor.querySelectorAll('.sigso-bandeja__fila').forEach(function (fila) {
          fila.classList.remove('sigso-bandeja__fila--activa');
        });
        boton.classList.add('sigso-bandeja__fila--activa');
        var detalle = document.getElementById('detalle-mis-solicitudes');
        detalle.classList.remove('sigso-oculto');
        detalle.innerHTML = Componentes.esqueleto({ variante: 'tarjeta', filas: 1 });
        consultar_(
          boton.getAttribute('data-solicitud'),
          boton.getAttribute('data-email') || sesionMisSolicitudes.email,
          'detalle-mis-solicitudes'
        );
      });
    });
  }
})();
