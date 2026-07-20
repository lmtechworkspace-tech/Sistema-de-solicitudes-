/**
 * formulario.js — formulario publico en 3 pasos (Fase 10, rediseno UX de
 * producto): Contexto -> Items -> Revisar y enviar. Sin frameworks (§2.2):
 * estado en un objeto plano + render manual usando js/components.js.
 *
 * Decision central del rediseno (auditoria de producto): el "tipo" y el
 * "modulo" dejan de ser una pregunta unica de la solicitud y pasan a
 * pedirse POR ITEM -- una solicitud real mezcla Error+Mejora+Nuevo modulo,
 * cada uno en un modulo distinto (confirmado con datos reales de Camila
 * Pena/Lisseth Vilchez, Fase 9). Cada item es una mini "hoja de ruta".
 *
 * "Estimacion de horas" se retira del formulario publico (el solicitante
 * no puede estimar esfuerzo de desarrollo) y se reemplaza por Frecuencia +
 * Personas afectadas, insumos reales de priorizacion.
 *
 * Imagenes: subirArchivo (Drive.gs) necesita el solicitud_id ya generado,
 * asi que se capturan por item en el navegador (con su descripcion) y se
 * suben recien despues de crearSolicitud, en el mismo orden -- el
 * subsolicitud_id de cada item se reconstruye del lado del cliente
 * (solicitud_id + '-0' + numero_item), mismo esquema de numeracion que
 * Solicitudes.gs ya usa al escribir SUBSOLICITUDES.
 */
(function () {
  var LLAVE_BORRADOR = 'sigso_borrador_solicitud';
  var MAX_SUBSOLICITUDES = 10;
  var MIN_SUBSOLICITUDES = 1;
  // Idea 2: adjuntos POR ITEM (espejo del backend Drive.gs, que es la
  // autoridad). Antes era 5 imagenes por SOLICITUD completa.
  var MAX_IMAGENES_ITEM = 5;
  var MAX_DOCUMENTOS_ITEM = 3;
  // Extensiones de documento aceptadas (el backend re-valida por firma de
  // bytes + extension). Mismo set que EXTENSIONES_DOCUMENTO de Drive.gs.
  var EXTENSIONES_DOC = ['pdf', 'xlsx', 'xls', 'docx', 'doc', 'pptx'];
  var PASOS = [
    { id: 'contexto', texto: 'Contexto' },
    { id: 'items', texto: 'Que necesitas' },
    { id: 'revision', texto: 'Revisar y enviar' }
  ];
  // Tipos para los que tiene sentido pedir donde/como reproducir (URL,
  // usuario de prueba, credencial). NMO (modulo nuevo) y CON (consulta) no
  // reproducen nada existente.
  var TIPOS_CON_ACCESO = ['ERR', 'MOD', 'MEJ', 'DES', 'MIG'];

  var estado = {
    paso: 'contexto',
    // P1 (v2.0, Sprint 1): 'rapido' muestra solo tipo/modulo/titulo/que pasa
    // /evidencia; 'completo' agrega contexto, impacto, acceso, frecuencia,
    // etc. El modo es global al formulario (no por item): mas simple de
    // entender para el solicitante que un flag por item.
    modo: 'rapido',
    // v3.0 (Fase 5): true = solicitud asociada a una plataforma (elige
    // plataforma + modulo por item, flujo de siempre); false = otro tipo de
    // pedido (sin plataforma ni modulo, se clasifica por tipo + area).
    asociadaPlataforma: true,
    catalogos: null,
    // Buscador de clientes (Idea 1): cartera GDE/HomePymes cargada lazy
    // (recien al marcar "es cliente" con empresa GDE/HP). clienteElegido
    // guarda rut/codigo del cliente seleccionado para trazabilidad (van a
    // recolectarDatos_); '' si se escribio manual sin elegir de la lista.
    clientes: null,
    clienteElegido: { rut: '', codigo: '' },
    subsolicitudActivaIdx: 0,
    subsolicitudes: [nuevaSubsolicitud_()],
    imagenesPorItem: { 0: [] },
    // Idea 2: documentos (PDF/Word/Excel) por item, paralelo a imagenesPorItem.
    documentosPorItem: { 0: [] },
    // v2.1 (Fase A, "dos promesas, dos relojes"): lo que el solicitante
    // propone -- una sola fecha (y hora, si aplica) por SOLICITUD, no por
    // item; el desarrollador la confirma/ajusta despues en el Backoffice.
    fechaPropuesta: { fecha: '', hora: '' }
  };

  function nuevaSubsolicitud_() {
    return {
      tipo: '', modulo: '', submodulo: '', item: '', subitem: '',
      titulo: '', descripcion: '', contexto: '', resultado_esperado: '', impacto: '',
      url_modulo: '', usuario_prueba: '', ref_credencial: '', centro_costos: '',
      urls_adicionales: [],
      frecuencia: '', personas_afectadas: '',
      observaciones: ''
    };
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof renderHeaderSigso === 'function') {
      renderHeaderSigso('formulario');
    }
    cargarBorrador_();
    cargarCatalogos_();
    renderStepper_();
    renderSelectorModo_();
    renderSelectorPlataformaAsociada_();
    renderSubsolicitudes_();

    document.getElementById('form-solicitud').addEventListener('submit', manejarSubmit_);
    document.querySelectorAll('#selector-modo [data-modo]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        estado.modo = boton.getAttribute('data-modo');
        renderSelectorModo_();
        renderSubsolicitudes_();
        guardarBorrador_();
      });
    });
    // v3.0 (Fase 5): al cambiar "asociada a plataforma?" se muestra/oculta el
    // selector de plataforma y la cascada de modulo por item.
    document.querySelectorAll('#selector-plataforma-asociada [data-asociada]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        estado.asociadaPlataforma = boton.getAttribute('data-asociada') === 'si';
        renderSelectorPlataformaAsociada_();
        renderSubsolicitudes_();
        guardarBorrador_();
      });
    });
    document.getElementById('campo-es-cliente').addEventListener('change', alternarBloqueCliente_);
    document.getElementById('btn-agregar-subsolicitud').addEventListener('click', agregarSubsolicitud_);
    document.getElementById('campo-plataforma').addEventListener('change', function () {
      renderSubsolicitudes_(); // las opciones de modulo dependen de la plataforma
    });
    document.getElementById('campo-empresa').addEventListener('change', function () {
      poblarPlataformas_();
      actualizarBuscadorCliente_(); // el buscador solo aplica a GDE/HP
    });
    wireBuscadorCliente_();
    wireAtencionDirecta_();

    document.getElementById('btn-paso1-siguiente').addEventListener('click', irAPaso2_);
    document.getElementById('btn-paso2-atras').addEventListener('click', function () { cambiarPaso_('contexto'); });
    document.getElementById('btn-paso2-siguiente').addEventListener('click', irAPaso3_);
    document.getElementById('btn-paso3-atras').addEventListener('click', function () { cambiarPaso_('items'); });

    ['campo-empresa', 'campo-plataforma', 'campo-area', 'campo-solicitante-nombre', 'campo-solicitante-cargo',
      'campo-solicitante-email', 'campo-cc', 'campo-avisar-leo',
      'campo-empresa-cliente', 'campo-cliente-mandante', 'campo-cliente-obra',
      'campo-contacto-cliente', 'campo-correo-cliente', 'campo-telefono-cliente',
      'campo-urgencia-cliente', 'campo-observaciones-generales'
    ].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', guardarBorrador_);
      }
    });
  });

  // --- Navegacion entre pasos ------------------------------------------

  function cambiarPaso_(paso) {
    estado.paso = paso;
    PASOS.forEach(function (p) {
      document.getElementById('paso-' + p.id).classList.toggle('sigso-oculto', p.id !== paso);
    });
    renderStepper_();
    window.scrollTo(0, 0);
  }

  function renderStepper_() {
    document.getElementById('contenedor-stepper').innerHTML = Componentes.stepper(PASOS, estado.paso);
  }

  // P1: resalta el modo activo en el selector Rápido/Completo.
  function renderSelectorModo_() {
    document.querySelectorAll('#selector-modo [data-modo]').forEach(function (boton) {
      boton.classList.toggle('sigso-chip--activo', boton.getAttribute('data-modo') === estado.modo);
    });
  }

  // v3.0 (Fase 5): resalta el chip activo y muestra/oculta el select de
  // plataforma. Cuando no está asociada a plataforma, el select deja de ser
  // obligatorio (y la cascada de módulo desaparece de cada item).
  function renderSelectorPlataformaAsociada_() {
    document.querySelectorAll('#selector-plataforma-asociada [data-asociada]').forEach(function (boton) {
      var activo = (boton.getAttribute('data-asociada') === 'si') === estado.asociadaPlataforma;
      boton.classList.toggle('sigso-chip--activo', activo);
    });
    var fila = document.getElementById('fila-plataforma');
    var select = document.getElementById('campo-plataforma');
    fila.classList.toggle('sigso-oculto', !estado.asociadaPlataforma);
    select.required = estado.asociadaPlataforma;
    if (!estado.asociadaPlataforma) {
      select.value = '';
    }
  }

  function irAPaso2_() {
    var camposObligatorios = ['campo-empresa'];
    if (estado.asociadaPlataforma) {
      camposObligatorios.push('campo-plataforma');
    }
    camposObligatorios.push('campo-solicitante-nombre', 'campo-solicitante-cargo', 'campo-solicitante-email');
    if (document.getElementById('campo-es-cliente').checked) {
      camposObligatorios.push('campo-empresa-cliente', 'campo-contacto-cliente', 'campo-correo-cliente');
    }
    for (var i = 0; i < camposObligatorios.length; i++) {
      var el = document.getElementById(camposObligatorios[i]);
      if (!el.checkValidity()) {
        el.reportValidity();
        return;
      }
    }
    document.getElementById('alerta-paso1').innerHTML = '';
    cambiarPaso_('items');
  }

  function irAPaso3_() {
    var faltantes = estado.subsolicitudes.some(function (item) {
      var faltaModulo = estado.asociadaPlataforma && !moduloSeleccionadoFinalItem_(item);
      return !item.titulo.trim() || !item.descripcion.trim() || !item.tipo || faltaModulo;
    });
    if (faltantes) {
      var mensaje = estado.asociadaPlataforma
        ? 'Completa título, descripción, tipo y módulo de todos los items antes de continuar.'
        : 'Completa título, descripción y tipo de todos los items antes de continuar.';
      document.getElementById('alerta-paso2').innerHTML = Componentes.alerta(mensaje, 'error');
      return;
    }
    document.getElementById('alerta-paso2').innerHTML = '';
    renderRevision_();
    renderFechaPropuesta_();
    cambiarPaso_('revision');
  }

  // v2.1 (Fase A, §4 de la especificacion): la hora importa cuando la
  // solicitud puede resolverse en horas/minutos -- cliente (siempre) o
  // cualquier item con impacto que deriva P1. Mismo criterio que
  // requiereFechaHoraPropuesta_ en backend/intake/Solicitudes.gs.
  var IMPACTOS_P1 = ['SISTEMA_CAIDO', 'PERDIDA_DATOS', 'BLOQUEO_OPERATIVO'];
  function requiereFechaHoraPropuesta_() {
    if (document.getElementById('campo-es-cliente').checked) return true;
    return estado.subsolicitudes.some(function (item) {
      return IMPACTOS_P1.indexOf(item.impacto) !== -1;
    });
  }

  // --- Catalogos --------------------------------------------------------

  // v3.0 (optimizacion): "stale-while-revalidate" -- si hay catalogos
  // guardados de una visita anterior (localStorage), el formulario se dibuja
  // AL INSTANTE con esos, y en paralelo se piden los frescos al servidor
  // (que ademas ya los sirve cacheados, ver backend/intake/Catalogos.gs).
  // Antes el formulario quedaba con selects vacios hasta que respondia
  // Apps Script (varios segundos en frio).
  var LLAVE_CACHE_CATALOGOS = 'sigso_cache_catalogos';

  function aplicarCatalogos_(catalogos) {
    estado.catalogos = catalogos;
    poblarSelect_('campo-empresa', estado.catalogos.empresas, 'empresa_id', 'nombre');
    poblarPlataformas_();
    poblarAreas_();
    renderSubsolicitudes_();
  }

  function cargarCatalogos_() {
    try {
      var guardado = window.localStorage.getItem(LLAVE_CACHE_CATALOGOS);
      if (guardado) {
        aplicarCatalogos_(JSON.parse(guardado));
      }
    } catch (err) {
      // cache local corrupto o no disponible: se espera la respuesta fresca.
    }
    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'getCatalogos', {}).then(function (respuesta) {
      if (!respuesta.ok) {
        return;
      }
      try {
        window.localStorage.setItem(LLAVE_CACHE_CATALOGOS, JSON.stringify(respuesta.data));
      } catch (err) {
        // localStorage lleno o en modo privado: no es critico.
      }
      aplicarCatalogos_(respuesta.data);
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

  // v3.0 (Fase 1): puebla el selector de area. Si no hay areas configuradas
  // (instalacion previa a v3.0 o catalogo vacio), oculta el campo -- el
  // backend rutea al responsable por defecto sin que el solicitante elija.
  function poblarAreas_() {
    var fila = document.getElementById('fila-area');
    var select = document.getElementById('campo-area');
    var areas = (estado.catalogos && estado.catalogos.areas) || [];
    if (areas.length === 0) {
      fila.classList.add('sigso-oculto');
      return;
    }
    var actual = select.value;
    select.innerHTML = '<option value="">No estoy seguro (que lo derive el equipo)</option>' +
      areas.map(function (a) {
        return '<option value="' + a.area_id + '">' + Componentes.escaparHtml(a.nombre) + '</option>';
      }).join('');
    if (actual) {
      select.value = actual;
    }
    fila.classList.remove('sigso-oculto');
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
    renderSubsolicitudes_();
  }

  // Jerarquia real de hasta 4 niveles (modulo principal > submodulo > item >
  // sub-item, post-Fase 8). Fase 10: esta cascada ahora vive POR ITEM, no
  // una sola vez para toda la solicitud.
  function raicesModulo_() {
    if (!estado.catalogos) return [];
    var plataformaId = document.getElementById('campo-plataforma').value;
    return estado.catalogos.modulos.filter(function (m) {
      return (!plataformaId || m.plataforma_id === plataformaId) && !m.modulo_padre_id;
    });
  }

  function hijosModulo_(padreId) {
    if (!estado.catalogos || !padreId) return [];
    return estado.catalogos.modulos.filter(function (m) { return m.modulo_padre_id === padreId; });
  }

  // El valor final que se guarda en SUBSOLICITUDES.modulo es siempre el del
  // nivel mas profundo con una seleccion real de ese item en particular.
  function moduloSeleccionadoFinalItem_(item) {
    return item.subitem || item.item || item.submodulo || item.modulo;
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
    // El aviso a desarrollo es automatico para clientes: se oculta el check
    // manual y se muestra la nota (el backend lo fuerza igual).
    document.querySelector('#fila-avisar-leo .sigso-toggle').style.display = visible ? 'none' : '';
    document.getElementById('nota-avisar-leo-cliente').style.display = visible ? '' : 'none';
    actualizarBuscadorCliente_();
    guardarBorrador_();
  }

  // --- Buscador de clientes (Idea 1: GDE/HomePymes) ---------------------

  // Los clientes de la cartera solo aplican a GDE y HomePymes (comparten la
  // misma). Para otras empresas (RLD) el buscador no aparece y se escriben
  // los datos a mano, sin romper nada.
  var EMPRESAS_CON_CLIENTES = ['GDE', 'HP'];
  var LLAVE_CACHE_CLIENTES = 'sigso_cache_clientes';
  var idxClienteActivo = -1;
  var resultadosClienteActuales = [];

  // Muestra u oculta el buscador segun (es_cliente && empresa GDE/HP) y carga
  // la cartera de forma lazy la primera vez que hace falta.
  function actualizarBuscadorCliente_() {
    var fila = document.getElementById('fila-buscar-cliente');
    if (!fila) return;
    var esCliente = document.getElementById('campo-es-cliente').checked;
    var empresa = document.getElementById('campo-empresa').value;
    var aplica = esCliente && EMPRESAS_CON_CLIENTES.indexOf(empresa) !== -1;
    fila.classList.toggle('sigso-oculto', !aplica);
    if (aplica && estado.clientes === null) {
      cargarClientes_();
    }
  }

  function cargarClientes_() {
    // stale-while-revalidate: pinta al instante desde cache local si existe,
    // y refresca en paralelo (mismo patron que cargarCatalogos_).
    try {
      var guardado = window.localStorage.getItem(LLAVE_CACHE_CLIENTES);
      if (guardado) {
        estado.clientes = JSON.parse(guardado);
      }
    } catch (err) {
      // cache local corrupto: se espera la respuesta fresca.
    }
    if (estado.clientes === null) {
      estado.clientes = []; // evita recargar en cada toggle mientras llega la respuesta
    }
    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'getClientes', {}).then(function (respuesta) {
      if (!respuesta.ok || !Array.isArray(respuesta.data)) {
        return;
      }
      estado.clientes = respuesta.data;
      try {
        window.localStorage.setItem(LLAVE_CACHE_CLIENTES, JSON.stringify(respuesta.data));
      } catch (err) {
        // localStorage lleno o modo privado: no es critico.
      }
    });
  }

  function normalizarBusqueda_(texto) {
    return String(texto || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos (marcas combinantes)
      .replace(/[.\s-]/g, ''); // ignora puntos/espacios/guiones (util para RUT)
  }

  function filtrarClientes_(texto) {
    var q = normalizarBusqueda_(texto);
    if (q.length < 2) return [];
    return (estado.clientes || []).filter(function (c) {
      return normalizarBusqueda_(c.razon_social).indexOf(q) !== -1 ||
        normalizarBusqueda_(c.rut).indexOf(q) !== -1 ||
        normalizarBusqueda_(c.codigo_cliente).indexOf(q) !== -1 ||
        normalizarBusqueda_(c.contacto).indexOf(q) !== -1;
    }).slice(0, 8);
  }

  function badgeEstadoCliente_(c) {
    var bloqueado = String(c.bloqueo || '').toLowerCase() === 'bloqueado';
    var inactivo = String(c.estado || '').toLowerCase() === 'inactivo';
    if (bloqueado) return '<span class="sigso-badge sigso-badge--P1">Bloqueado</span>';
    if (inactivo) return '<span class="sigso-badge sigso-badge--P3">Inactivo</span>';
    return '';
  }

  function renderResultadosCliente_() {
    var lista = document.getElementById('resultados-cliente');
    var input = document.getElementById('campo-buscar-cliente');
    if (resultadosClienteActuales.length === 0) {
      lista.innerHTML = '';
      lista.classList.add('sigso-oculto');
      input.setAttribute('aria-expanded', 'false');
      return;
    }
    lista.innerHTML = resultadosClienteActuales.map(function (c, i) {
      var activo = i === idxClienteActivo ? ' sigso-autocomplete__opcion--activa' : '';
      return '<li class="sigso-autocomplete__opcion' + activo + '" role="option" data-idx="' + i + '" id="opcion-cliente-' + i + '"' +
        (i === idxClienteActivo ? ' aria-selected="true"' : '') + '>' +
        '<strong>' + Componentes.escaparHtml(c.razon_social) + '</strong> ' + badgeEstadoCliente_(c) +
        '<br><span class="sigso-autocomplete__meta">' + Componentes.escaparHtml(c.rut || 's/rut') +
        (c.codigo_cliente ? ' &middot; ' + Componentes.escaparHtml(c.codigo_cliente) : '') +
        (c.contacto ? ' &middot; ' + Componentes.escaparHtml(c.contacto) : '') + '</span>' +
        '</li>';
    }).join('');
    lista.classList.remove('sigso-oculto');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', idxClienteActivo >= 0 ? 'opcion-cliente-' + idxClienteActivo : '');
  }

  function cerrarResultadosCliente_() {
    resultadosClienteActuales = [];
    idxClienteActivo = -1;
    renderResultadosCliente_();
  }

  function elegirCliente_(cliente) {
    if (!cliente) return;
    document.getElementById('campo-empresa-cliente').value = cliente.razon_social || '';
    document.getElementById('campo-contacto-cliente').value = cliente.contacto || '';
    document.getElementById('campo-correo-cliente').value = cliente.correo || '';
    document.getElementById('campo-telefono-cliente').value = cliente.telefono || '';
    estado.clienteElegido = { rut: cliente.rut || '', codigo: cliente.codigo_cliente || '' };
    document.getElementById('campo-buscar-cliente').value = cliente.razon_social || '';
    cerrarResultadosCliente_();
    guardarBorrador_();
  }

  function wireBuscadorCliente_() {
    var input = document.getElementById('campo-buscar-cliente');
    if (!input) return;
    input.addEventListener('input', function () {
      resultadosClienteActuales = filtrarClientes_(input.value);
      idxClienteActivo = -1;
      renderResultadosCliente_();
    });
    input.addEventListener('keydown', function (ev) {
      if (resultadosClienteActuales.length === 0) return;
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        idxClienteActivo = Math.min(idxClienteActivo + 1, resultadosClienteActuales.length - 1);
        renderResultadosCliente_();
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        idxClienteActivo = Math.max(idxClienteActivo - 1, 0);
        renderResultadosCliente_();
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        elegirCliente_(resultadosClienteActuales[idxClienteActivo >= 0 ? idxClienteActivo : 0]);
      } else if (ev.key === 'Escape') {
        cerrarResultadosCliente_();
      }
    });
    document.getElementById('resultados-cliente').addEventListener('mousedown', function (ev) {
      // mousedown (no click) para que se dispare antes del blur del input.
      var li = ev.target.closest('[data-idx]');
      if (li) {
        ev.preventDefault();
        elegirCliente_(resultadosClienteActuales[Number(li.getAttribute('data-idx'))]);
      }
    });
    input.addEventListener('blur', function () {
      // Cierra al perder foco (con un pequeno delay para no matar el click).
      setTimeout(cerrarResultadosCliente_, 150);
    });
    // "Escribir manualmente": oculta el buscador y limpia el cliente elegido
    // para que los campos de abajo se llenen a mano sin trazabilidad de id.
    document.getElementById('link-cliente-manual').addEventListener('click', function (ev) {
      ev.preventDefault();
      document.getElementById('fila-buscar-cliente').classList.add('sigso-oculto');
      estado.clienteElegido = { rut: '', codigo: '' };
      cerrarResultadosCliente_();
      document.getElementById('campo-empresa-cliente').focus();
    });
  }

  // --- Acordeon de items (min 1, max 10, un solo item expandido) --------

  function renderSubsolicitudes_() {
    var contenedor = document.getElementById('lista-subsolicitudes');
    contenedor.innerHTML = estado.subsolicitudes.map(function (item, idx) {
      var activa = idx === estado.subsolicitudActivaIdx;
      var puedeQuitar = estado.subsolicitudes.length > MIN_SUBSOLICITUDES;
      return (
        '<div class="sigso-acordeon-item' + (activa ? ' sigso-acordeon-item--activo' : '') + '" data-idx="' + idx + '">' +
        '<div class="sigso-acordeon-item__cabecera" data-accion="expandir" data-idx="' + idx + '">' +
        '<span>' + (idx + 1) + '. ' + (tituloResumenItem_(item)) + '</span>' +
        (puedeQuitar ? '<button type="button" class="sigso-acordeon-item__quitar" data-accion="quitar" data-idx="' + idx + '">Quitar</button>' : '') +
        '</div>' +
        '<div class="sigso-acordeon-item__cuerpo">' + (activa ? renderCuerpoItem_(item, idx) : '') + '</div>' +
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

    if (contenedor.querySelector('.sigso-acordeon-item--activo')) {
      wireCuerpoItem_(contenedor, estado.subsolicitudActivaIdx);
    }

    document.getElementById('btn-agregar-subsolicitud').disabled = estado.subsolicitudes.length >= MAX_SUBSOLICITUDES;
  }

  function tituloResumenItem_(item) {
    var etiquetaTipo = etiquetaTipo_(item.tipo);
    var prefijo = etiquetaTipo ? '[' + etiquetaTipo + '] ' : '';
    return prefijo + Componentes.escaparHtml(item.titulo || 'Nuevo item');
  }

  function etiquetaTipo_(tipoId) {
    if (!estado.catalogos || !tipoId) return '';
    var tipo = estado.catalogos.tipos.find(function (t) { return t.tipo_id === tipoId; });
    return tipo ? tipo.nombre : '';
  }

  // El cuerpo de un item: chips de tipo, cascada de modulo propia, campos
  // "hoja de ruta" (que pasa/que deberia pasar), acceso condicional segun
  // tipo, frecuencia/personas afectadas, evidencia con descripcion propia.
  //
  // P1 (v2.0, Sprint 1): en modo "rapido" solo se muestran tipo, modulo,
  // titulo, "que pasa" y evidencia -- el resto (resultado esperado,
  // contexto, impacto, acceso, frecuencia, personas afectadas, centro de
  // costos, observaciones) se OCULTA pero NO se borra (si el usuario ya
  // habia escrito algo y vuelve a Completo, lo sigue viendo).
  function renderCuerpoItem_(item, idx) {
    var completo = estado.modo === 'completo';
    var mostrarAcceso = completo && TIPOS_CON_ACCESO.indexOf(item.tipo) !== -1;
    var imagenes = (estado.imagenesPorItem[idx] || []).map(function (img) {
      return { previewUrl: img.previewUrl, descripcion: img.descripcion, nombre: img.file.name };
    });

    var documentos = (estado.documentosPorItem[idx] || []);
    // v4.0 Frente 5: dropzone -- el <input type=file> sigue ahi (oculto),
    // solo se envuelve en un area mas grande que acepta arrastrar y soltar
    // ademas del clic de siempre; wireCuerpoItem_ cablea el drag&drop.
    var evidencia =
      '<div class="sigso-campo"><label>Im&aacute;genes (capturas de pantalla, opcional)</label>' +
      '<label class="sigso-dropzone" data-dropzone="imagenes" data-idx="' + idx + '">' +
      Iconos.svg('imagen', { tam: 22 }) +
      '<span>Arrastra imagenes aqu&iacute; o haz clic para elegir</span>' +
      '<input type="file" class="sigso-dropzone__input" data-accion="input-imagenes" data-idx="' + idx + '" accept="image/png,image/jpeg,image/gif" multiple>' +
      '</label>' +
      Componentes.galeriaImagenes(imagenes, { editable: true, idx: idx }) +
      '</div>' +
      '<div class="sigso-campo"><label>Documentos (PDF, Word o Excel, opcional)</label>' +
      '<label class="sigso-dropzone" data-dropzone="documentos" data-idx="' + idx + '">' +
      Iconos.svg('documento', { tam: 22 }) +
      '<span>Arrastra documentos aqu&iacute; o haz clic para elegir</span>' +
      '<input type="file" class="sigso-dropzone__input" data-accion="input-documentos" data-idx="' + idx + '" accept=".pdf,.xlsx,.xls,.docx,.doc,.pptx" multiple>' +
      '</label>' +
      renderListaDocumentos_(documentos, idx) +
      '<div class="sigso-campo__error sigso-oculto" data-error-doc="' + idx + '"></div>' +
      '</div>';

    var basico =
      '<div class="sigso-campo"><label>Tipo de trabajo</label>' + renderChipsTipo_(item, idx) + '</div>' +
      renderCascadaModuloItem_(item, idx) +
      Componentes.campoTexto({ dataCampo: 'titulo', idx: idx, valor: item.titulo, requerido: true, label: 'Título corto' }) +
      Componentes.campoTextarea({ dataCampo: 'descripcion', idx: idx, valor: item.descripcion, requerido: true, label: completo ? '¿Qué pasa hoy?' : '¿Qué pasa?', ayuda: 'Describe el problema o lo que necesitas.' });

    if (!completo) {
      return basico + evidencia + renderAlternarModo_();
    }

    return (
      basico +
      Componentes.campoTextarea({ dataCampo: 'resultado_esperado', idx: idx, valor: item.resultado_esperado, label: '¿Qué debería pasar?' }) +
      Componentes.campoTextarea({ dataCampo: 'contexto', idx: idx, valor: item.contexto, label: 'Contexto (opcional)', ayuda: 'Antecedentes de cómo se llegó a esto.' }) +
      Componentes.campoSelect({ dataCampo: 'impacto', idx: idx, valor: item.impacto, label: 'Impacto', opciones: opcionesImpacto_(), placeholder: 'No especificado' }) +
      (mostrarAcceso ? renderBloqueAcceso_(item, idx) : '') +
      '<div class="sigso-campo"><label>¿Con qué frecuencia pasa?</label>' + renderChipsFrecuencia_(item, idx) + '</div>' +
      Componentes.campoTexto({ dataCampo: 'personas_afectadas', idx: idx, valor: item.personas_afectadas, tipo: 'number', label: '¿A cuántas personas afecta? (opcional)' }) +
      Componentes.campoTexto({ dataCampo: 'centro_costos', idx: idx, valor: item.centro_costos, label: 'Centro de costos (opcional)' }) +
      evidencia +
      Componentes.campoTextarea({ dataCampo: 'observaciones', idx: idx, valor: item.observaciones, label: 'Observaciones (opcional)' })
    );
  }

  function renderAlternarModo_() {
    return '<div class="sigso-campo"><button type="button" class="sigso-boton--secundario" data-accion="ir-a-completo">+ Agregar más detalles (modo Completo)</button></div>';
  }

  // Idea 2: lista simple de documentos adjuntos del item (nombre + quitar).
  // Un icono por tipo ayuda a distinguir de un vistazo (los docs, a
  // diferencia de las imagenes, no tienen preview).
  function iconoDocumento_(nombre) {
    var ext = String(nombre).split('.').pop().toLowerCase();
    if (ext === 'pdf') return '📕';
    if (ext === 'doc' || ext === 'docx') return '📘';
    if (ext === 'xls' || ext === 'xlsx') return '📗';
    if (ext === 'ppt' || ext === 'pptx') return '📙';
    return '📄';
  }

  function renderListaDocumentos_(documentos, idx) {
    if (!documentos || documentos.length === 0) return '';
    return '<ul class="sigso-lista-documentos">' + documentos.map(function (doc, docIdx) {
      return '<li class="sigso-lista-documentos__item">' +
        '<span class="sigso-lista-documentos__nombre">' + iconoDocumento_(doc.file.name) + ' ' + Componentes.escaparHtml(doc.file.name) + '</span>' +
        '<button type="button" class="sigso-lista-documentos__quitar" data-accion="quitar-documento" data-idx="' + idx + '" data-doc-idx="' + docIdx + '">Quitar</button>' +
        '</li>';
    }).join('') + '</ul>';
  }

  // P2 (v2.0, Sprint 2): los tipos urgentes por naturaleza (CAT_TIPOS.es_urgente,
  // p.ej. Error/Bug) se marcan visualmente -- el solicitante ve que ese tipo
  // ya entra con prioridad alta, sin depender solo de lo que el mismo declare
  // como impacto ("todos van a poner alta porque todo es urgente").
  function renderChipsTipo_(item, idx) {
    var tipos = estado.catalogos ? estado.catalogos.tipos : [];
    return '<div class="sigso-chips">' + tipos.map(function (t) {
      var activo = t.tipo_id === item.tipo ? ' sigso-chip--activo' : '';
      var esUrgente = t.es_urgente === true || t.es_urgente === 'TRUE' || t.es_urgente === 1;
      var etiquetaUrgente = esUrgente ? ' <span class="sigso-badge sigso-badge--P1">Urgente</span>' : '';
      return '<button type="button" class="sigso-chip' + activo + '" data-accion="elegir-tipo" data-idx="' + idx + '" data-tipo="' + t.tipo_id + '">' + Componentes.escaparHtml(t.nombre) + etiquetaUrgente + '</button>';
    }).join('') + '</div>';
  }

  function renderChipsFrecuencia_(item, idx) {
    var opciones = [['SIEMPRE', 'Siempre'], ['A_VECES', 'A veces'], ['UNA_VEZ', 'Una vez']];
    return '<div class="sigso-chips">' + opciones.map(function (o) {
      var activo = o[0] === item.frecuencia ? ' sigso-chip--activo' : '';
      return '<button type="button" class="sigso-chip' + activo + '" data-accion="elegir-frecuencia" data-idx="' + idx + '" data-frecuencia="' + o[0] + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }

  function renderBloqueAcceso_(item, idx) {
    return Componentes.campoTexto({ dataCampo: 'url_modulo', idx: idx, valor: item.url_modulo, label: 'URL principal (opcional)' }) +
      renderUrlsAdicionales_(item, idx) +
      Componentes.campoTexto({ dataCampo: 'usuario_prueba', idx: idx, valor: item.usuario_prueba, label: 'Usuario de prueba (opcional)' }) +
      Componentes.campoTexto({
        dataCampo: 'ref_credencial', idx: idx, valor: item.ref_credencial, label: 'Credencial de prueba (opcional)',
        placeholder: 'Referencia al gestor de credenciales, nunca la contraseña',
        ayuda: 'Indica dónde encontrar la clave. Nunca escribas la contraseña aquí.'
      });
  }

  function renderCascadaModuloItem_(item, idx) {
    // v3.0 (Fase 5): sin plataforma asociada no hay módulo que elegir.
    if (!estado.asociadaPlataforma) {
      return '';
    }
    var raices = raicesModulo_();
    var submodulos = hijosModulo_(item.modulo);
    var items2 = hijosModulo_(item.submodulo);
    var subitems = hijosModulo_(item.item);

    var html = selectCascada_('modulo', 'Módulo', raices, item.modulo, idx, true);
    if (submodulos.length > 0) html += selectCascada_('submodulo', 'Submodulo', submodulos, item.submodulo, idx, true);
    if (items2.length > 0) html += selectCascada_('item', 'Item', items2, item.item, idx, true);
    if (subitems.length > 0) html += selectCascada_('subitem', 'Sub-item', subitems, item.subitem, idx, true);
    return html;
  }

  function selectCascada_(campo, label, opciones, valor, idx, requerido) {
    return Componentes.campoSelect({
      dataCampo: campo, idx: idx, valor: valor, label: label, requerido: requerido,
      opciones: opciones.map(function (o) { return { valor: o.modulo_id, texto: o.nombre }; }),
      claseInput: 'sigso-cascada-modulo'
    }).replace('<select ', '<select data-cascada="1" ');
  }

  function renderUrlsAdicionales_(item, idx) {
    var filas = (item.urls_adicionales || []).map(function (u, urlIdx) {
      return (
        '<div class="sigso-url-item">' +
        '<input type="text" data-url-campo="titulo" data-idx="' + idx + '" data-url-idx="' + urlIdx + '" ' +
        'value="' + Componentes.escaparHtml(u.titulo) + '" placeholder="Ej: modal de validaci&oacute;n">' +
        '<input type="text" data-url-campo="url" data-idx="' + idx + '" data-url-idx="' + urlIdx + '" ' +
        'value="' + Componentes.escaparHtml(u.url) + '" placeholder="https://...">' +
        '<button type="button" class="sigso-url-item__quitar" data-accion="quitar-url" data-idx="' + idx + '" data-url-idx="' + urlIdx + '">Quitar</button>' +
        '</div>'
      );
    }).join('');
    return (
      '<div class="sigso-campo"><label>URLs adicionales (opcional)</label>' +
      filas +
      '<button type="button" class="sigso-boton--secundario" data-accion="agregar-url" data-idx="' + idx + '">+ Agregar URL</button>' +
      '</div>'
    );
  }

  function opcionesImpacto_() {
    return [
      ['SISTEMA_CAIDO', 'Sistema caido'],
      ['PERDIDA_DATOS', 'Perdida de datos'],
      ['BLOQUEO_OPERATIVO', 'Bloqueo operativo'],
      ['DEGRADACION_IMPORTANTE', 'Degradacion importante'],
      ['PARCIAL_CON_WORKAROUND', 'Parcial, con workaround'],
      ['PLANIFICADO', 'Planificado (no urgente)']
    ].map(function (o) { return { valor: o[0], texto: o[1] }; });
  }

  // Cablea los eventos SOLO del item activo (el resto no esta en el DOM,
  // renderCuerpoItem_ solo dibuja el item expandido).
  function wireCuerpoItem_(contenedor, idx) {
    var cuerpo = contenedor.querySelector('.sigso-acordeon-item--activo .sigso-acordeon-item__cuerpo');
    if (!cuerpo) return;

    cuerpo.querySelectorAll('[data-campo]').forEach(function (el) {
      el.addEventListener('input', function () {
        var campo = el.getAttribute('data-campo');
        estado.subsolicitudes[idx][campo] = el.value;
        guardarBorrador_();
        if (campo === 'titulo') {
          var cabecera = contenedor.querySelector('.sigso-acordeon-item[data-idx="' + idx + '"] .sigso-acordeon-item__cabecera span');
          if (cabecera) cabecera.innerHTML = tituloResumenItem_(estado.subsolicitudes[idx]);
        }
      });
    });

    // Cascada de modulo: al cambiar un nivel se limpian los niveles hijos y
    // se vuelve a dibujar (las opciones de los hijos cambian).
    cuerpo.querySelectorAll('[data-cascada]').forEach(function (el) {
      el.addEventListener('change', function () {
        var campo = el.getAttribute('data-campo');
        var item = estado.subsolicitudes[idx];
        if (campo === 'modulo') { item.submodulo = ''; item.item = ''; item.subitem = ''; }
        if (campo === 'submodulo') { item.item = ''; item.subitem = ''; }
        if (campo === 'item') { item.subitem = ''; }
        renderSubsolicitudes_();
      });
    });

    cuerpo.querySelectorAll('[data-accion="elegir-tipo"]').forEach(function (el) {
      el.addEventListener('click', function () {
        estado.subsolicitudes[idx].tipo = el.getAttribute('data-tipo');
        renderSubsolicitudes_();
        guardarBorrador_();
      });
    });
    var btnIrACompleto = cuerpo.querySelector('[data-accion="ir-a-completo"]');
    if (btnIrACompleto) {
      btnIrACompleto.addEventListener('click', function () {
        estado.modo = 'completo';
        renderSelectorModo_();
        renderSubsolicitudes_();
        guardarBorrador_();
      });
    }
    cuerpo.querySelectorAll('[data-accion="elegir-frecuencia"]').forEach(function (el) {
      el.addEventListener('click', function () {
        estado.subsolicitudes[idx].frecuencia = el.getAttribute('data-frecuencia');
        renderSubsolicitudes_();
        guardarBorrador_();
      });
    });

    cuerpo.querySelectorAll('[data-url-campo]').forEach(function (el) {
      el.addEventListener('input', function () {
        var urlIdx = Number(el.getAttribute('data-url-idx'));
        var campo = el.getAttribute('data-url-campo');
        estado.subsolicitudes[idx].urls_adicionales[urlIdx][campo] = el.value;
        guardarBorrador_();
      });
    });
    cuerpo.querySelectorAll('[data-accion="agregar-url"]').forEach(function (el) {
      el.addEventListener('click', function () {
        estado.subsolicitudes[idx].urls_adicionales.push({ titulo: '', url: '' });
        renderSubsolicitudes_();
        guardarBorrador_();
      });
    });
    cuerpo.querySelectorAll('[data-accion="quitar-url"]').forEach(function (el) {
      el.addEventListener('click', function () {
        var urlIdx = Number(el.getAttribute('data-url-idx'));
        estado.subsolicitudes[idx].urls_adicionales.splice(urlIdx, 1);
        renderSubsolicitudes_();
        guardarBorrador_();
      });
    });

    var inputImagenes = cuerpo.querySelector('[data-accion="input-imagenes"]');
    if (inputImagenes) {
      inputImagenes.addEventListener('change', function (ev) {
        agregarImagenes_(idx, ev.target.files);
        inputImagenes.value = '';
      });
    }
    cuerpo.querySelectorAll('[data-accion="quitar-imagen"]').forEach(function (el) {
      el.addEventListener('click', function () {
        quitarImagen_(idx, Number(el.getAttribute('data-img-idx')));
      });
    });

    var inputDocumentos = cuerpo.querySelector('[data-accion="input-documentos"]');
    if (inputDocumentos) {
      inputDocumentos.addEventListener('change', function (ev) {
        agregarDocumentos_(idx, ev.target.files);
        inputDocumentos.value = '';
      });
    }

    // v4.0 Frente 5: arrastrar y soltar sobre el dropzone -- reusa las
    // mismas funciones que ya validan limite/tipo/tamano (no hay un camino
    // "sin validar" para el drag&drop).
    wireDropzone_(cuerpo.querySelector('[data-dropzone="imagenes"]'), function (files) {
      agregarImagenes_(idx, files);
    });
    wireDropzone_(cuerpo.querySelector('[data-dropzone="documentos"]'), function (files) {
      agregarDocumentos_(idx, files);
    });
    cuerpo.querySelectorAll('[data-accion="quitar-documento"]').forEach(function (el) {
      el.addEventListener('click', function () {
        quitarDocumento_(idx, Number(el.getAttribute('data-doc-idx')));
      });
    });
    cuerpo.querySelectorAll('[data-campo="imagen-descripcion"]').forEach(function (el) {
      el.addEventListener('input', function () {
        var imgIdx = Number(el.getAttribute('data-img-idx'));
        estado.imagenesPorItem[idx][imgIdx].descripcion = el.value;
      });
    });
  }

  // --- Imagenes y documentos (Idea 2: hasta 5 img / 3 doc POR ITEM) ------

  // v4.0 Frente 5: dropzone generica -- resalta al arrastrar encima y llama
  // a `alSoltar` con los archivos, sea cual sea el input que envuelva.
  function wireDropzone_(zona, alSoltar) {
    if (!zona) return;
    ['dragenter', 'dragover'].forEach(function (tipo) {
      zona.addEventListener(tipo, function (ev) {
        ev.preventDefault();
        zona.classList.add('sigso-dropzone--sobre');
      });
    });
    ['dragleave', 'drop'].forEach(function (tipo) {
      zona.addEventListener(tipo, function () {
        zona.classList.remove('sigso-dropzone--sobre');
      });
    });
    zona.addEventListener('drop', function (ev) {
      ev.preventDefault();
      if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) {
        alSoltar(ev.dataTransfer.files);
      }
    });
  }

  function agregarImagenes_(idx, fileList) {
    if (!estado.imagenesPorItem[idx]) estado.imagenesPorItem[idx] = [];
    var disponibles = MAX_IMAGENES_ITEM - estado.imagenesPorItem[idx].length;
    var archivos = Array.prototype.slice.call(fileList, 0, Math.max(disponibles, 0));
    archivos.forEach(function (file) {
      estado.imagenesPorItem[idx].push({ file: file, descripcion: '', previewUrl: URL.createObjectURL(file) });
    });
    renderSubsolicitudes_();
  }

  function quitarImagen_(idx, imgIdx) {
    estado.imagenesPorItem[idx].splice(imgIdx, 1);
    renderSubsolicitudes_();
  }

  function agregarDocumentos_(idx, fileList) {
    if (!estado.documentosPorItem[idx]) estado.documentosPorItem[idx] = [];
    var archivos = Array.prototype.slice.call(fileList, 0);
    var rechazadosTipo = 0;
    var rechazadosLimite = 0;
    archivos.forEach(function (file) {
      var ext = String(file.name).split('.').pop().toLowerCase();
      if (EXTENSIONES_DOC.indexOf(ext) === -1) {
        rechazadosTipo++;
      } else if (estado.documentosPorItem[idx].length >= MAX_DOCUMENTOS_ITEM) {
        rechazadosLimite++;
      } else {
        estado.documentosPorItem[idx].push({ file: file });
      }
    });
    // renderSubsolicitudes_ vuelve a dibujar el item (incluye el span de
    // error), asi que el mensaje se aplica DESPUES de redibujar.
    renderSubsolicitudes_();
    var errorEl = document.querySelector('[data-error-doc="' + idx + '"]');
    if (errorEl) {
      var msjs = [];
      if (rechazadosTipo > 0) msjs.push(rechazadosTipo + ' archivo(s) ignorado(s): solo se aceptan PDF, Word o Excel.');
      if (rechazadosLimite > 0) msjs.push('Maximo ' + MAX_DOCUMENTOS_ITEM + ' documentos por item.');
      errorEl.textContent = msjs.join(' ');
      errorEl.classList.toggle('sigso-oculto', msjs.length === 0);
    }
  }

  function quitarDocumento_(idx, docIdx) {
    estado.documentosPorItem[idx].splice(docIdx, 1);
    renderSubsolicitudes_();
  }

  // --- Agregar/quitar items ----------------------------------------------

  function agregarSubsolicitud_() {
    if (estado.subsolicitudes.length >= MAX_SUBSOLICITUDES) {
      return;
    }
    estado.subsolicitudes.push(nuevaSubsolicitud_());
    estado.subsolicitudActivaIdx = estado.subsolicitudes.length - 1;
    estado.imagenesPorItem[estado.subsolicitudActivaIdx] = [];
    estado.documentosPorItem[estado.subsolicitudActivaIdx] = [];
    renderSubsolicitudes_();
    guardarBorrador_();
  }

  function quitarSubsolicitud_(idx) {
    if (estado.subsolicitudes.length <= MIN_SUBSOLICITUDES) {
      return;
    }
    estado.subsolicitudes.splice(idx, 1);
    // Reindexa imagenes y documentos (las claves son posicionales).
    var reindexImg = {};
    var reindexDoc = {};
    estado.subsolicitudes.forEach(function (_, nuevoIdx) {
      var viejoIdx = nuevoIdx >= idx ? nuevoIdx + 1 : nuevoIdx;
      reindexImg[nuevoIdx] = estado.imagenesPorItem[viejoIdx] || [];
      reindexDoc[nuevoIdx] = estado.documentosPorItem[viejoIdx] || [];
    });
    estado.imagenesPorItem = reindexImg;
    estado.documentosPorItem = reindexDoc;
    estado.subsolicitudActivaIdx = 0;
    renderSubsolicitudes_();
    guardarBorrador_();
  }

  // --- Paso 3: revision ---------------------------------------------------

  function renderRevision_() {
    var filas = estado.subsolicitudes.map(function (item, idx) {
      var cantImagenes = (estado.imagenesPorItem[idx] || []).length;
      var cantDocs = (estado.documentosPorItem[idx] || []).length;
      var partes = [];
      if (cantImagenes > 0) partes.push(cantImagenes + ' imagen(es)');
      if (cantDocs > 0) partes.push(cantDocs + ' documento(s)');
      return '<tr>' +
        '<td>' + (idx + 1) + '</td>' +
        '<td>' + Componentes.escaparHtml(etiquetaTipo_(item.tipo)) + '</td>' +
        '<td>' + Componentes.escaparHtml(item.titulo) + '</td>' +
        '<td>' + (partes.length ? partes.join(', ') : 'Sin evidencia') + '</td>' +
        '</tr>';
    }).join('');

    var sinEvidencia = estado.subsolicitudes.some(function (_, idx) {
      return (estado.imagenesPorItem[idx] || []).length === 0 && (estado.documentosPorItem[idx] || []).length === 0;
    });
    var avisoEvidencia = sinEvidencia
      ? Componentes.alerta('Uno o más items no tienen evidencia adjunta. Puedes enviar igual si no aplica.', 'aviso')
      : '';

    var cc = document.getElementById('campo-cc').value;
    var avisoCc = cc ? '<p>Se enviará copia a: ' + Componentes.escaparHtml(cc) + '</p>' : '';

    document.getElementById('contenedor-revision').innerHTML =
      '<p>Empresa: ' + Componentes.escaparHtml(document.getElementById('campo-empresa').selectedOptions[0].textContent) + '</p>' +
      '<p>Solicitante: ' + Componentes.escaparHtml(document.getElementById('campo-solicitante-nombre').value) + '</p>' +
      '<table class="sigso-revision-tabla"><thead><tr><th>#</th><th>Tipo</th><th>Título</th><th>Evidencia</th></tr></thead>' +
      '<tbody>' + filas + '</tbody></table>' +
      avisoEvidencia + avisoCc;
  }

  // v2.1 (Fase A): se dibuja en el paso de revision (ahi ya se conoce
  // es_cliente + el impacto de todos los items) -- el desarrollador es
  // quien fija la fecha DEFINITIVA despues (Backoffice); esto es solo lo
  // que el solicitante pide.
  function renderFechaPropuesta_() {
    var requerida = requiereFechaHoraPropuesta_();
    var nota = requerida
      ? 'Es obligatoria (fecha y hora) porque es una solicitud de cliente o de impacto crítico: se puede resolver en horas.'
      : 'Opcional. El desarrollador confirmará o ajustará la fecha final.';
    document.getElementById('contenedor-fecha-propuesta').innerHTML =
      '<div class="sigso-campo"><label>¿Para cuándo necesitas esto resuelto?' + (requerida ? ' *' : '') + '</label>' +
      '<p class="sigso-ayuda">' + nota + '</p>' +
      '<div class="sigso-fecha-propuesta">' +
      '<input type="date" id="campo-fecha-propuesta-fecha" value="' + Componentes.escaparHtml(estado.fechaPropuesta.fecha) + '"' + (requerida ? ' required' : '') + '>' +
      (requerida ? '<input type="time" id="campo-fecha-propuesta-hora" value="' + Componentes.escaparHtml(estado.fechaPropuesta.hora) + '" required>' : '') +
      '</div>' +
      '<div id="alerta-fecha-propuesta"></div>' +
      '</div>';

    document.getElementById('campo-fecha-propuesta-fecha').addEventListener('input', function (ev) {
      estado.fechaPropuesta.fecha = ev.target.value;
      guardarBorrador_();
    });
    var campoHora = document.getElementById('campo-fecha-propuesta-hora');
    if (campoHora) {
      campoHora.addEventListener('input', function (ev) {
        estado.fechaPropuesta.hora = ev.target.value;
        guardarBorrador_();
      });
    }
  }

  // Devuelve el string ISO a enviar (o '' si no aplica), y valida que si es
  // obligatoria (cliente/P1) venga con fecha+hora completas.
  function validarYArmarFechaPropuesta_() {
    var requerida = requiereFechaHoraPropuesta_();
    var fecha = estado.fechaPropuesta.fecha;
    var hora = estado.fechaPropuesta.hora;
    var alerta = document.getElementById('alerta-fecha-propuesta');

    if (requerida && (!fecha || !hora)) {
      if (alerta) {
        alerta.innerHTML = Componentes.alerta('Indica fecha y hora: es obligatorio en solicitudes de cliente o de impacto crítico.', 'error');
      }
      return { valido: false, valor: '' };
    }
    if (alerta) {
      alerta.innerHTML = '';
    }
    if (!fecha) {
      return { valido: true, valor: '' };
    }
    return { valido: true, valor: requerida ? (fecha + 'T' + hora) : fecha };
  }

  // --- Progreso, borrador, envio -------------------------------------

  // v3.1 (§1.3A): lee el bloque de atencion directa. El backend re-valida
  // todo; aca solo se arma la estructura.
  function recolectarAtencionDirecta_() {
    var activo = document.getElementById('campo-atencion-directa');
    return {
      activo: !!(activo && activo.checked),
      resuelto_por: valorCampo_('campo-atencion-resuelto-por'),
      fecha_resolucion: valorCampo_('campo-atencion-fecha'),
      detalle: valorCampo_('campo-atencion-detalle')
    };
  }

  function valorCampo_(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }

  // Mostrar/ocultar los campos del registro, y esconder "fecha propuesta":
  // proponer una fecha de entrega para algo que ya se entrego no tiene
  // sentido y solo confunde.
  function wireAtencionDirecta_() {
    var check = document.getElementById('campo-atencion-directa');
    if (!check) return;
    check.addEventListener('change', function () {
      document.getElementById('bloque-atencion-directa')
        .classList.toggle('sigso-oculto', !check.checked);
      var fecha = document.getElementById('contenedor-fecha-propuesta');
      if (fecha) {
        fecha.classList.toggle('sigso-oculto', check.checked);
      }
    });
  }

  function recolectarDatos_() {
    var esCliente = document.getElementById('campo-es-cliente').checked;
    return {
      // P1: solo se persiste en el borrador local -- no se envia al backend
      // (crearSolicitud no necesita saber en que modo se cargo el formulario).
      _modo: estado.modo,
      empresa_id: document.getElementById('campo-empresa').value,
      // v3.0 (Fase 5): false = otro tipo de solicitud (sin plataforma ni
      // módulo). El backend usa esta bandera para no exigir plataforma/módulo.
      asociada_plataforma: estado.asociadaPlataforma,
      plataforma: estado.asociadaPlataforma ? document.getElementById('campo-plataforma').value : '',
      // v3.0 (Fase 1): area a la que va dirigida la solicitud (default para
      // todos los items). '' = "No estoy seguro" -> bandeja de triage.
      area: document.getElementById('campo-area').value,
      es_cliente: esCliente,
      empresa_cliente: esCliente ? document.getElementById('campo-empresa-cliente').value : '',
      cliente_mandante: esCliente ? document.getElementById('campo-cliente-mandante').value : '',
      cliente_obra: esCliente ? document.getElementById('campo-cliente-obra').value : '',
      contacto_cliente: esCliente ? document.getElementById('campo-contacto-cliente').value : '',
      correo_cliente: esCliente ? document.getElementById('campo-correo-cliente').value : '',
      telefono_cliente: esCliente ? document.getElementById('campo-telefono-cliente').value : '',
      urgencia_cliente: esCliente ? document.getElementById('campo-urgencia-cliente').value : '',
      // Trazabilidad del cliente elegido del buscador (Idea 1): '' si se
      // escribio manual o no es cliente.
      rut_cliente: esCliente ? estado.clienteElegido.rut : '',
      codigo_cliente: esCliente ? estado.clienteElegido.codigo : '',
      solicitante_nombre: document.getElementById('campo-solicitante-nombre').value,
      solicitante_cargo: document.getElementById('campo-solicitante-cargo').value,
      solicitante_email: document.getElementById('campo-solicitante-email').value,
      cc: document.getElementById('campo-cc').value,
      // Aviso a desarrollo: para clientes el backend lo fuerza; para internas
      // lo decide este check (el solicitante elige si avisar a Leo).
      avisar_leo: document.getElementById('campo-avisar-leo').checked,
      observaciones_generales: document.getElementById('campo-observaciones-generales').value,
      // v2.1 (Fase A): '' si no se ha llegado al paso de revision todavia o
      // el solicitante no indico nada (es opcional salvo cliente/P1).
      fecha_propuesta: validarYArmarFechaPropuesta_().valor,
      // v3.1 (§1.3A): bloque de atencion directa. Siempre se manda el objeto
      // (con activo true/false) para que el backend distinga "no marcado" de
      // "marcado sin llenar" -- eso ultimo debe fallar, no pasar de largo.
      atencion_directa: recolectarAtencionDirecta_(),
      subsolicitudes: estado.subsolicitudes.map(function (item, idx) {
        // Las descripciones ya se conocen antes de subir los archivos (el
        // orden coincide con subirImagenesDeTodosLosItems_, que sube en el
        // mismo orden de estado.imagenesPorItem[idx]).
        var descripciones = (estado.imagenesPorItem[idx] || []).map(function (img) { return img.descripcion; });
        return Object.assign({}, item, {
          modulo: moduloSeleccionadoFinalItem_(item),
          imagen_descripciones: descripciones
        });
      })
    };
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
      estado.modo = datos._modo === 'completo' ? 'completo' : 'rapido';
      // v3.0 (Fase 5): borradores viejos no traen la bandera -> true (asociada).
      estado.asociadaPlataforma = datos.asociada_plataforma !== false;
      document.getElementById('campo-empresa').value = datos.empresa_id || '';
      document.getElementById('campo-plataforma').value = datos.plataforma || '';
      // v3.0 (Fase 1): el valor se re-aplica; poblarAreas_ (tras cargar
      // catalogos) respeta el valor ya presente en el select.
      document.getElementById('campo-area').value = datos.area || '';
      document.getElementById('campo-solicitante-nombre').value = datos.solicitante_nombre || '';
      document.getElementById('campo-solicitante-cargo').value = datos.solicitante_cargo || '';
      document.getElementById('campo-solicitante-email').value = datos.solicitante_email || '';
      document.getElementById('campo-cc').value = datos.cc || '';
      document.getElementById('campo-avisar-leo').checked = !!datos.avisar_leo;
      document.getElementById('campo-observaciones-generales').value = datos.observaciones_generales || '';
      // v2.1 (Fase A): fecha_propuesta viene combinada ('YYYY-MM-DD' o
      // 'YYYY-MM-DDTHH:MM'); se separa para precargar los inputs cuando se
      // llegue al paso de revision (renderFechaPropuesta_).
      if (datos.fecha_propuesta) {
        var partes = String(datos.fecha_propuesta).split('T');
        estado.fechaPropuesta = { fecha: partes[0] || '', hora: partes[1] || '' };
      }
      if (datos.es_cliente) {
        document.getElementById('campo-es-cliente').checked = true;
        document.getElementById('campo-empresa-cliente').value = datos.empresa_cliente || '';
        document.getElementById('campo-cliente-mandante').value = datos.cliente_mandante || '';
        document.getElementById('campo-cliente-obra').value = datos.cliente_obra || '';
        document.getElementById('campo-contacto-cliente').value = datos.contacto_cliente || '';
        document.getElementById('campo-correo-cliente').value = datos.correo_cliente || '';
        document.getElementById('campo-telefono-cliente').value = datos.telefono_cliente || '';
        document.getElementById('campo-urgencia-cliente').value = datos.urgencia_cliente || '';
        // Idea 1: restaura el cliente elegido del buscador (trazabilidad).
        estado.clienteElegido = {
          rut: datos.rut_cliente || '',
          codigo: datos.codigo_cliente || ''
        };
        alternarBloqueCliente_();
      }
      if (Array.isArray(datos.subsolicitudes) && datos.subsolicitudes.length > 0) {
        // Normaliza borradores guardados antes de la Fase 10 (sin
        // tipo/frecuencia/personas_afectadas todavia). Las imagenes nunca se
        // persisten (File no es serializable).
        estado.subsolicitudes = datos.subsolicitudes.map(function (item) {
          return Object.assign(nuevaSubsolicitud_(), item, {
            urls_adicionales: Array.isArray(item.urls_adicionales) ? item.urls_adicionales : []
          });
        });
        estado.imagenesPorItem = {};
        estado.documentosPorItem = {};
        estado.subsolicitudes.forEach(function (_, idx) {
          estado.imagenesPorItem[idx] = [];
          estado.documentosPorItem[idx] = [];
        });
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
    // v3.1: con atencion directa el campo "fecha propuesta" esta oculto (no
    // se propone una entrega para algo ya entregado), asi que su validacion
    // -- obligatoria para cliente/P1 -- bloquearia el envio por un campo que
    // el usuario ni siquiera ve.
    var atencion = recolectarAtencionDirecta_();
    if (!atencion.activo && !validarYArmarFechaPropuesta_().valido) {
      return;
    }
    var boton = document.getElementById('btn-enviar');
    var datos = recolectarDatos_();

    ocultarResultado_();
    boton.disabled = true;
    boton.innerHTML = '<span class="sigso-spinner"></span> Enviando...';

    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'crearSolicitud', datos)
      .then(function (respuesta) {
        if (!respuesta.ok) {
          mostrarError_(respuesta);
          return;
        }
        limpiarBorrador_();
        document.getElementById('form-solicitud').classList.add('sigso-oculto');
        return subirAdjuntosDeTodosLosItems_(respuesta.data.solicitud_id).then(function (resultadoAdjuntos) {
          mostrarExito_(respuesta.data, resultadoAdjuntos);
        });
      })
      .catch(function () {
        mostrarError_({ error: 'internal', message: 'No se pudo conectar con el servidor. Intenta nuevamente.' });
      })
      .finally(function () {
        boton.disabled = false;
        boton.textContent = 'Enviar solicitud';
      });
  }

  // subirArchivo (Drive.gs) necesita el solicitud_id ya generado. El
  // subsolicitud_id de cada item se reconstruye con la misma numeracion que
  // usa Solicitudes.gs al escribir SUBSOLICITUDES (numero_item = idx+1).
  // Idea 2: sube imagenes Y documentos de cada item (misma cola secuencial y
  // el mismo manejo de fallo por archivo).
  function subirAdjuntosDeTodosLosItems_(solicitudId) {
    var tareas = [];
    estado.subsolicitudes.forEach(function (item, idx) {
      var subsolicitudId = solicitudId + '-' + ('0' + (idx + 1)).slice(-2);
      (estado.imagenesPorItem[idx] || []).forEach(function (img) {
        tareas.push({ subsolicitudId: subsolicitudId, file: img.file });
      });
      (estado.documentosPorItem[idx] || []).forEach(function (doc) {
        tareas.push({ subsolicitudId: subsolicitudId, file: doc.file });
      });
    });
    if (tareas.length === 0) {
      return Promise.resolve({ intentadas: 0, subidas: 0 });
    }
    var subidas = 0;
    return tareas.reduce(function (promesa, tarea) {
      return promesa.then(function () {
        return leerArchivoBase64_(tarea.file).then(function (base64) {
          return llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'subirArchivo', {
            solicitud_id: solicitudId,
            subsolicitud_id: tarea.subsolicitudId,
            nombre_archivo: tarea.file.name,
            contenido_base64: base64
          });
        }).then(function (respuesta) {
          if (respuesta && respuesta.ok) {
            subidas++;
          }
        }).catch(function () {
          // Un adjunto fallido no debe bloquear los demas ni el aviso final.
        });
      });
    }, Promise.resolve()).then(function () {
      return { intentadas: tareas.length, subidas: subidas };
    });
  }

  function leerArchivoBase64_(archivo) {
    return new Promise(function (resolve, reject) {
      var lector = new FileReader();
      lector.onload = function () {
        // dataURL viene como "data:<mime>;base64,<contenido>" -- Drive.gs
        // solo necesita la parte base64.
        resolve(String(lector.result).split(',')[1] || '');
      };
      lector.onerror = reject;
      lector.readAsDataURL(archivo);
    });
  }

  function mostrarExito_(data, resultadoAdjuntos) {
    var contenedor = document.getElementById('resultado');
    var aviso = data.posible_duplicado
      ? '<p><strong>Nota:</strong> ya existe una solicitud abierta parecida (' + data.posible_duplicado.solicitud_id + ').</p>'
      : '';
    var avisoImagenes = '';
    if (resultadoAdjuntos && resultadoAdjuntos.intentadas > 0) {
      avisoImagenes = resultadoAdjuntos.subidas === resultadoAdjuntos.intentadas
        ? '<p>' + resultadoAdjuntos.subidas + ' adjunto(s) subido(s) correctamente.</p>'
        : '<p><strong>Nota:</strong> se subieron ' + resultadoAdjuntos.subidas + ' de ' + resultadoAdjuntos.intentadas + ' adjuntos (revisa tama&ntilde;o/formato de los restantes).</p>';
    }
    // v3.1: una atencion directa nace cerrada -- prometerle al solicitante
    // una fecha de entrega y una validacion posterior seria falso.
    var queSigue = data.atencion_directa
      ? '<h3>¿Qué sigue?</h3>' +
        '<p>Nada: esta solicitud quedó <strong>cerrada</strong>, registrada como atención directa. ' +
        'Recibirá un correo de confirmación con el detalle de lo que se hizo.</p>'
      : '<h3>¿Qué sigue?</h3>' +
        '<ol class="sigso-pasos-siguientes">' +
        '<li>Recibirá un <strong>correo de confirmación</strong> con el detalle de su solicitud.</li>' +
        '<li>El equipo responsable la revisará y <strong>comprometerá una fecha de entrega</strong> (se le avisará por correo).</li>' +
        '<li>Cuando el trabajo esté terminado, deberá <strong>validarlo</strong> desde <a href="estado.html">Consultar estado</a>.</li>' +
        '</ol>';

    contenedor.innerHTML =
      '<div class="sigso-resultado-exito">' +
      '<h2>' + (data.atencion_directa
        ? 'Registro guardado correctamente'
        : 'Su solicitud fue registrada correctamente') + '</h2>' +
      '<p>Guarde este número para hacer seguimiento:</p>' +
      '<p class="sigso-numero-solicitud">' + data.solicitud_id + '</p>' +
      aviso +
      avisoImagenes +
      queSigue +
      '<p class="sigso-ayuda">También puede ver todas sus solicitudes en Consultar estado &rarr; pestaña "Mis solicitudes", con su correo.</p>' +
      '<p>Resumen para compartir por WhatsApp:</p>' +
      '<pre class="sigso-resumen-whatsapp">' + Componentes.escaparHtml(data.resumen_whatsapp) + '</pre>' +
      '<button type="button" class="sigso-boton--secundario" id="btn-copiar-resumen">Copiar resumen</button> ' +
      '<a class="sigso-boton" href="estado.html?id=' + encodeURIComponent(data.solicitud_id) + '">Ir a Consultar estado</a>' +
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
        return '<li>' + Componentes.escaparHtml(f.mensaje || f.campo) + '</li>';
      }).join('') + '</ul>';
    }
    var contenedor = document.getElementById('resultado');
    contenedor.innerHTML = '<div class="sigso-resultado-error"><p>' + Componentes.escaparHtml(mensaje) + '</p>' + detalle + '</div>';
    contenedor.classList.remove('sigso-oculto');
  }

  function ocultarResultado_() {
    var contenedor = document.getElementById('resultado');
    contenedor.classList.add('sigso-oculto');
    contenedor.innerHTML = '';
  }
})();
