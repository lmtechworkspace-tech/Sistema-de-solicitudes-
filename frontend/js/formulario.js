/**
 * formulario.js — formulario publico progresivo (§12.2).
 *
 * Sin frameworks (§2.2): estado en un objeto plano + render manual del
 * acordeon de subsolicitudes. subirArchivo no esta implementado todavia
 * (Fase 4, §5.3): este formulario no incluye adjuntos.
 */
(function () {
  var LLAVE_BORRADOR = 'sigso_borrador_solicitud';
  var MAX_SUBSOLICITUDES = 10;
  var MIN_SUBSOLICITUDES = 1;

  var estado = {
    catalogos: null,
    subsolicitudActivaIdx: 0,
    subsolicitudes: [nuevaSubsolicitud_()]
  };

  function nuevaSubsolicitud_() {
    return {
      titulo: '', descripcion: '', contexto: '', resultado_esperado: '', impacto: '',
      url_modulo: '', usuario_prueba: '', centro_costos: '', url_video: '',
      observaciones: '', estimacion_horas: ''
    };
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof renderHeaderSigso === 'function') {
      renderHeaderSigso('formulario');
    }
    cargarBorrador_();
    cargarCatalogos_();
    renderSubsolicitudes_();
    actualizarProgreso_();

    document.getElementById('form-solicitud').addEventListener('submit', manejarSubmit_);
    document.getElementById('campo-es-cliente').addEventListener('change', alternarBloqueCliente_);
    document.getElementById('btn-agregar-subsolicitud').addEventListener('click', agregarSubsolicitud_);
    document.getElementById('campo-empresa').addEventListener('change', function () {
      poblarPlataformas_();
      poblarModulos_();
    });
    document.getElementById('campo-plataforma').addEventListener('change', poblarModulos_);
    document.getElementById('campo-modulo').addEventListener('change', actualizarCascadaSubmodulo_);
    document.getElementById('campo-submodulo').addEventListener('change', actualizarCascadaItem_);

    ['campo-empresa', 'campo-plataforma', 'campo-modulo', 'campo-submodulo', 'campo-item', 'campo-tipo',
      'campo-solicitante-nombre', 'campo-solicitante-cargo', 'campo-solicitante-email',
      'campo-empresa-cliente', 'campo-cliente-mandante', 'campo-cliente-obra',
      'campo-contacto-cliente', 'campo-correo-cliente', 'campo-telefono-cliente',
      'campo-urgencia-cliente', 'campo-observaciones-generales'
    ].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', function () {
          actualizarProgreso_();
          guardarBorrador_();
        });
      }
    });
  });

  function cargarCatalogos_() {
    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'getCatalogos', {}).then(function (respuesta) {
      if (!respuesta.ok) {
        return;
      }
      estado.catalogos = respuesta.data;
      poblarSelect_('campo-empresa', estado.catalogos.empresas, 'empresa_id', 'nombre');
      poblarSelect_('campo-tipo', estado.catalogos.tipos, 'tipo_id', 'nombre');
      poblarPlataformas_();
      poblarModulos_();
    });
  }

  function poblarSelect_(idSelect, opciones, campoValor, campoTexto, valorPrevio) {
    var select = document.getElementById(idSelect);
    var actual = valorPrevio !== undefined ? valorPrevio : select.value;
    select.innerHTML = '<option value="">Selecciona...</option>' +
      opciones.map(function (o) {
        return '<option value="' + o[campoValor] + '">' + o[campoTexto] + '</option>';
      }).join('');
    if (actual) {
      select.value = actual;
    }
  }

  function poblarPlataformas_() {
    if (!estado.catalogos) {
      return;
    }
    var empresaId = document.getElementById('campo-empresa').value;
    var plataformas = estado.catalogos.plataformas.filter(function (p) {
      return !empresaId || p.empresa_id === empresaId;
    });
    poblarSelect_('campo-plataforma', plataformas, 'plataforma_id', 'nombre');
  }

  // Jerarquia real de hasta 3 niveles (modulo principal > submodulo > item,
  // post-Fase 8, ver mapa de procesos de HomePymes/GDE/Intranet): un modulo
  // es "raiz" cuando modulo_padre_id viene vacio. Submodulo/item aparecen
  // solo si el nivel anterior efectivamente tiene hijos -- muchos modulos
  // no tienen ninguno, y el formulario no debe mostrar selects vacios.
  function poblarModulos_() {
    if (!estado.catalogos) {
      return;
    }
    var plataformaId = document.getElementById('campo-plataforma').value;
    var raices = estado.catalogos.modulos.filter(function (m) {
      return (!plataformaId || m.plataforma_id === plataformaId) && !m.modulo_padre_id;
    });
    poblarSelect_('campo-modulo', raices, 'modulo_id', 'nombre');
    actualizarCascadaSubmodulo_();
  }

  function actualizarCascadaSubmodulo_() {
    actualizarNivelHijo_('campo-modulo', 'bloque-submodulo', 'campo-submodulo');
    actualizarCascadaItem_();
  }

  function actualizarCascadaItem_() {
    actualizarNivelHijo_('campo-submodulo', 'bloque-item', 'campo-item');
  }

  function actualizarNivelHijo_(idPadre, idBloqueHijo, idSelectHijo) {
    var bloque = document.getElementById(idBloqueHijo);
    var selectHijo = document.getElementById(idSelectHijo);
    var padreId = document.getElementById(idPadre).value;
    var hijos = (estado.catalogos ? estado.catalogos.modulos : []).filter(function (m) {
      return !!padreId && m.modulo_padre_id === padreId;
    });

    if (hijos.length === 0) {
      bloque.classList.add('sigso-oculto');
      selectHijo.innerHTML = '';
      selectHijo.required = false;
      return;
    }
    bloque.classList.remove('sigso-oculto');
    selectHijo.required = true;
    poblarSelect_(idSelectHijo, hijos, 'modulo_id', 'nombre');
  }

  // El valor final que se guarda en SOLICITUDES.modulo es siempre el del
  // nivel mas profundo con una seleccion real, sin importar cuantos
  // niveles tenga ese modulo en particular.
  function moduloSeleccionadoFinal_() {
    var item = document.getElementById('campo-item').value;
    if (item) return item;
    var submodulo = document.getElementById('campo-submodulo').value;
    if (submodulo) return submodulo;
    return document.getElementById('campo-modulo').value;
  }

  function alternarBloqueCliente_() {
    var visible = document.getElementById('campo-es-cliente').checked;
    var bloque = document.getElementById('bloque-cliente');
    bloque.classList.toggle('sigso-bloque-cliente--visible', visible);
    // RN-005: solo empresa/contacto/correo son obligatorios; mandante, obra,
    // telefono y urgencia quedan opcionales (RF-002 de v1.0).
    ['campo-empresa-cliente', 'campo-contacto-cliente', 'campo-correo-cliente'].forEach(function (id) {
      document.getElementById(id).required = visible;
    });
    actualizarProgreso_();
    guardarBorrador_();
  }

  // --- Acordeon de subsolicitudes (min 1, max 10, un solo item expandido) -

  function renderSubsolicitudes_() {
    var contenedor = document.getElementById('lista-subsolicitudes');
    contenedor.innerHTML = estado.subsolicitudes.map(function (item, idx) {
      var activa = idx === estado.subsolicitudActivaIdx;
      var puedeQuitar = estado.subsolicitudes.length > MIN_SUBSOLICITUDES;
      return (
        '<div class="sigso-acordeon-item' + (activa ? ' sigso-acordeon-item--activo' : '') + '" data-idx="' + idx + '">' +
        '<div class="sigso-acordeon-item__cabecera" data-accion="expandir" data-idx="' + idx + '">' +
        '<span>' + (idx + 1) + '. ' + (item.titulo || 'Nueva subsolicitud') + '</span>' +
        (puedeQuitar ? '<button type="button" class="sigso-acordeon-item__quitar" data-accion="quitar" data-idx="' + idx + '">Quitar</button>' : '') +
        '</div>' +
        '<div class="sigso-acordeon-item__cuerpo">' +
        '<div class="sigso-campo"><label>T&iacute;tulo</label>' +
        '<input type="text" data-campo="titulo" data-idx="' + idx + '" value="' + escaparHtml_(item.titulo) + '" required></div>' +
        '<div class="sigso-campo"><label>Descripci&oacute;n</label>' +
        '<textarea data-campo="descripcion" data-idx="' + idx + '" required>' + escaparHtml_(item.descripcion) + '</textarea></div>' +
        '<div class="sigso-campo"><label>Contexto (opcional)</label>' +
        '<textarea data-campo="contexto" data-idx="' + idx + '">' + escaparHtml_(item.contexto) + '</textarea></div>' +
        '<div class="sigso-campo"><label>Resultado esperado (opcional)</label>' +
        '<textarea data-campo="resultado_esperado" data-idx="' + idx + '">' + escaparHtml_(item.resultado_esperado) + '</textarea></div>' +
        '<div class="sigso-campo"><label>Impacto</label>' +
        '<select data-campo="impacto" data-idx="' + idx + '">' +
        opcionesImpacto_(item.impacto) +
        '</select></div>' +
        '<div class="sigso-campo"><label>URL del m&oacute;dulo (opcional)</label>' +
        '<input type="text" data-campo="url_modulo" data-idx="' + idx + '" value="' + escaparHtml_(item.url_modulo) + '"></div>' +
        '<div class="sigso-campo"><label>Usuario de prueba (opcional)</label>' +
        '<input type="text" data-campo="usuario_prueba" data-idx="' + idx + '" value="' + escaparHtml_(item.usuario_prueba) + '"></div>' +
        '<div class="sigso-campo"><label>Centro de costos (opcional)</label>' +
        '<input type="text" data-campo="centro_costos" data-idx="' + idx + '" value="' + escaparHtml_(item.centro_costos) + '"></div>' +
        '<div class="sigso-campo"><label>Video explicativo (opcional)</label>' +
        '<input type="text" data-campo="url_video" data-idx="' + idx + '" value="' + escaparHtml_(item.url_video) + '"></div>' +
        '<div class="sigso-campo"><label>Estimaci&oacute;n en horas (opcional)</label>' +
        '<input type="text" data-campo="estimacion_horas" data-idx="' + idx + '" value="' + escaparHtml_(item.estimacion_horas) + '"></div>' +
        '<div class="sigso-campo"><label>Observaciones del item (opcional)</label>' +
        '<textarea data-campo="observaciones" data-idx="' + idx + '">' + escaparHtml_(item.observaciones) + '</textarea></div>' +
        '</div>' +
        '</div>'
      );
    }).join('');

    contenedor.querySelectorAll('[data-accion="expandir"]').forEach(function (el) {
      el.addEventListener('click', function () {
        estado.subsolicitudActivaIdx = Number(el.getAttribute('data-idx'));
        renderSubsolicitudes_();
      });
    });
    contenedor.querySelectorAll('[data-accion="quitar"]').forEach(function (el) {
      el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        quitarSubsolicitud_(Number(el.getAttribute('data-idx')));
      });
    });
    contenedor.querySelectorAll('[data-campo]').forEach(function (el) {
      el.addEventListener('input', function () {
        var idx = Number(el.getAttribute('data-idx'));
        var campo = el.getAttribute('data-campo');
        estado.subsolicitudes[idx][campo] = el.value;
        actualizarProgreso_();
        guardarBorrador_();
        if (campo === 'titulo') {
          var cabecera = contenedor.querySelector('.sigso-acordeon-item[data-idx="' + idx + '"] .sigso-acordeon-item__cabecera span');
          if (cabecera) {
            cabecera.textContent = (idx + 1) + '. ' + (el.value || 'Nueva subsolicitud');
          }
        }
      });
    });

    document.getElementById('btn-agregar-subsolicitud').disabled = estado.subsolicitudes.length >= MAX_SUBSOLICITUDES;
  }

  function opcionesImpacto_(seleccionado) {
    var opciones = [
      ['', 'No especificado'],
      ['SISTEMA_CAIDO', 'Sistema caido'],
      ['PERDIDA_DATOS', 'Perdida de datos'],
      ['BLOQUEO_OPERATIVO', 'Bloqueo operativo'],
      ['DEGRADACION_IMPORTANTE', 'Degradacion importante'],
      ['PARCIAL_CON_WORKAROUND', 'Parcial, con workaround'],
      ['PLANIFICADO', 'Planificado (no urgente)']
    ];
    return opciones.map(function (o) {
      var sel = o[0] === (seleccionado || '') ? ' selected' : '';
      return '<option value="' + o[0] + '"' + sel + '>' + o[1] + '</option>';
    }).join('');
  }

  function agregarSubsolicitud_() {
    if (estado.subsolicitudes.length >= MAX_SUBSOLICITUDES) {
      return;
    }
    estado.subsolicitudes.push(nuevaSubsolicitud_());
    estado.subsolicitudActivaIdx = estado.subsolicitudes.length - 1;
    renderSubsolicitudes_();
    actualizarProgreso_();
    guardarBorrador_();
  }

  function quitarSubsolicitud_(idx) {
    if (estado.subsolicitudes.length <= MIN_SUBSOLICITUDES) {
      return;
    }
    estado.subsolicitudes.splice(idx, 1);
    estado.subsolicitudActivaIdx = 0;
    renderSubsolicitudes_();
    actualizarProgreso_();
    guardarBorrador_();
  }

  // --- Progreso, borrador, envio -------------------------------------

  function recolectarDatos_() {
    var esCliente = document.getElementById('campo-es-cliente').checked;
    return {
      empresa_id: document.getElementById('campo-empresa').value,
      plataforma: document.getElementById('campo-plataforma').value,
      modulo: moduloSeleccionadoFinal_(),
      tipo: document.getElementById('campo-tipo').value,
      es_cliente: esCliente,
      empresa_cliente: esCliente ? document.getElementById('campo-empresa-cliente').value : '',
      cliente_mandante: esCliente ? document.getElementById('campo-cliente-mandante').value : '',
      cliente_obra: esCliente ? document.getElementById('campo-cliente-obra').value : '',
      contacto_cliente: esCliente ? document.getElementById('campo-contacto-cliente').value : '',
      correo_cliente: esCliente ? document.getElementById('campo-correo-cliente').value : '',
      telefono_cliente: esCliente ? document.getElementById('campo-telefono-cliente').value : '',
      urgencia_cliente: esCliente ? document.getElementById('campo-urgencia-cliente').value : '',
      solicitante_nombre: document.getElementById('campo-solicitante-nombre').value,
      solicitante_cargo: document.getElementById('campo-solicitante-cargo').value,
      solicitante_email: document.getElementById('campo-solicitante-email').value,
      observaciones_generales: document.getElementById('campo-observaciones-generales').value,
      subsolicitudes: estado.subsolicitudes
    };
  }

  function actualizarProgreso_() {
    var datos = recolectarDatos_();
    var requeridos = [
      datos.empresa_id, datos.plataforma, datos.modulo, datos.tipo,
      datos.solicitante_nombre, datos.solicitante_cargo, datos.solicitante_email
    ];
    if (datos.es_cliente) {
      requeridos.push(datos.empresa_cliente, datos.contacto_cliente, datos.correo_cliente);
    }
    var completos = requeridos.filter(function (v) { return v && String(v).trim() !== ''; }).length;
    var subsolicitudesCompletas = datos.subsolicitudes.filter(function (s) {
      return s.titulo.trim() !== '' && s.descripcion.trim() !== '';
    }).length;

    var totalPasos = requeridos.length + datos.subsolicitudes.length;
    var pasosCompletos = completos + subsolicitudesCompletas;
    var porcentaje = totalPasos === 0 ? 0 : Math.round((pasosCompletos / totalPasos) * 100);
    document.getElementById('barra-progreso').style.width = porcentaje + '%';
  }

  function guardarBorrador_() {
    try {
      window.localStorage.setItem(LLAVE_BORRADOR, JSON.stringify(recolectarDatos_()));
    } catch (err) {
      // localStorage puede fallar en modo privado; no es critico para el envio.
    }
  }

  function cargarBorrador_() {
    var crudo;
    try {
      crudo = window.localStorage.getItem(LLAVE_BORRADOR);
    } catch (err) {
      return;
    }
    if (!crudo) {
      return;
    }
    try {
      var datos = JSON.parse(crudo);
      document.getElementById('campo-empresa').value = datos.empresa_id || '';
      document.getElementById('campo-plataforma').value = datos.plataforma || '';
      document.getElementById('campo-modulo').value = datos.modulo || '';
      document.getElementById('campo-tipo').value = datos.tipo || '';
      document.getElementById('campo-solicitante-nombre').value = datos.solicitante_nombre || '';
      document.getElementById('campo-solicitante-cargo').value = datos.solicitante_cargo || '';
      document.getElementById('campo-solicitante-email').value = datos.solicitante_email || '';
      document.getElementById('campo-observaciones-generales').value = datos.observaciones_generales || '';
      if (datos.es_cliente) {
        document.getElementById('campo-es-cliente').checked = true;
        document.getElementById('campo-empresa-cliente').value = datos.empresa_cliente || '';
        document.getElementById('campo-cliente-mandante').value = datos.cliente_mandante || '';
        document.getElementById('campo-cliente-obra').value = datos.cliente_obra || '';
        document.getElementById('campo-contacto-cliente').value = datos.contacto_cliente || '';
        document.getElementById('campo-correo-cliente').value = datos.correo_cliente || '';
        document.getElementById('campo-telefono-cliente').value = datos.telefono_cliente || '';
        document.getElementById('campo-urgencia-cliente').value = datos.urgencia_cliente || '';
        alternarBloqueCliente_();
      }
      if (Array.isArray(datos.subsolicitudes) && datos.subsolicitudes.length > 0) {
        estado.subsolicitudes = datos.subsolicitudes;
      }
    } catch (err) {
      // Borrador corrupto: se ignora y se empieza de cero.
    }
  }

  function limpiarBorrador_() {
    try {
      window.localStorage.removeItem(LLAVE_BORRADOR);
    } catch (err) {
      // Sin efecto si localStorage no esta disponible.
    }
  }

  function manejarSubmit_(evento) {
    evento.preventDefault();
    var boton = document.getElementById('btn-enviar');
    var datos = recolectarDatos_();

    ocultarResultado_();
    boton.disabled = true;
    boton.innerHTML = '<span class="sigso-spinner"></span> Enviando...';

    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'crearSolicitud', datos)
      .then(function (respuesta) {
        if (respuesta.ok) {
          limpiarBorrador_();
          mostrarExito_(respuesta.data);
          document.getElementById('form-solicitud').classList.add('sigso-oculto');
        } else {
          mostrarError_(respuesta);
        }
      })
      .catch(function () {
        mostrarError_({ error: 'internal', message: 'No se pudo conectar con el servidor. Intenta nuevamente.' });
      })
      .finally(function () {
        boton.disabled = false;
        boton.textContent = 'Enviar solicitud';
      });
  }

  function mostrarExito_(data) {
    var contenedor = document.getElementById('resultado');
    var aviso = data.posible_duplicado
      ? '<p><strong>Nota:</strong> ya existe una solicitud abierta parecida (' + data.posible_duplicado.solicitud_id + ').</p>'
      : '';
    contenedor.innerHTML =
      '<div class="sigso-resultado-exito">' +
      '<p>Solicitud registrada:</p>' +
      '<p class="sigso-numero-solicitud">' + data.solicitud_id + '</p>' +
      aviso +
      '<p>Resumen para compartir por WhatsApp:</p>' +
      '<pre class="sigso-resumen-whatsapp">' + escaparHtml_(data.resumen_whatsapp) + '</pre>' +
      '<button type="button" class="sigso-boton--secundario" id="btn-copiar-resumen">Copiar resumen</button>' +
      '</div>';
    var btnCopiar = document.getElementById('btn-copiar-resumen');
    if (btnCopiar) {
      btnCopiar.addEventListener('click', function () {
        navigator.clipboard.writeText(data.resumen_whatsapp).catch(function () {});
        btnCopiar.textContent = 'Copiado';
      });
    }
    contenedor.classList.remove('sigso-oculto');
  }

  function mostrarError_(respuesta) {
    var mensaje = respuesta.message || 'No se pudo registrar la solicitud.';
    var detalle = '';
    if (respuesta.error === 'validation' && Array.isArray(respuesta.fields)) {
      detalle = '<ul>' + respuesta.fields.map(function (f) {
        return '<li>' + escaparHtml_(f.mensaje || f.campo) + '</li>';
      }).join('') + '</ul>';
    }
    var contenedor = document.getElementById('resultado');
    contenedor.innerHTML = '<div class="sigso-resultado-error"><p>' + escaparHtml_(mensaje) + '</p>' + detalle + '</div>';
    contenedor.classList.remove('sigso-oculto');
  }

  function ocultarResultado_() {
    var contenedor = document.getElementById('resultado');
    contenedor.classList.add('sigso-oculto');
    contenedor.innerHTML = '';
  }

  function escaparHtml_(texto) {
    var div = document.createElement('div');
    div.textContent = texto || '';
    return div.innerHTML;
  }
})();
