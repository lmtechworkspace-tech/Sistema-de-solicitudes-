/**
 * calidad.js — modulo "Calidad" / SGC ISO 9001 (v10.0, Fase 1).
 * documentacion/SIGSO-v10.0-propuesta-modulo-sgc-iso9001.md.
 *
 * Compartido por las dos vias de acceso (plataforma.js con token y app.js
 * con login Google), mismo patron que proyectos.js/novedades.js.
 *
 * REGLA QUE ATRAVIESA TODO ESTE ARCHIVO: aca NUNCA se decide que documento
 * puede ver una persona. El backend (Calidad.gs) ya devuelve la lista
 * filtrada segun el rol SGC y la visibilidad de cada documento, y vuelve a
 * validar en cada descarga. Esconder un boton no protege nada -- y en este
 * modulo el control de acceso no es una preferencia de producto, es un
 * requisito de la norma.
 */
(function () {
  window.SigsoCalidad = {
    cargar: function () {
      seccionActiva_ = 'documentos';
      documentoActivoId_ = null;
      personaActivaId_ = null;
      render_();
    },
    // Respeta donde esta el usuario: el auto-refresco de fondo no debe
    // sacarlo del documento o la ficha que esta mirando (misma leccion que
    // proyectos.js aprendio en v9.0b).
    refrescar: render_
  };

  function render_() {
    if (seccionActiva_ === 'personas') {
      if (personaActivaId_) abrirPersona_(personaActivaId_); else cargarPersonas_();
    } else if (seccionActiva_ === 'capacitaciones') {
      cargarCapacitaciones_();
    } else if (seccionActiva_ === 'nc') {
      if (ncActivaId_) abrirNc_(ncActivaId_); else cargarNc_();
    } else if (seccionActiva_ === 'auditorias') {
      if (auditoriaActivaId_) abrirAuditoria_(auditoriaActivaId_); else cargarAuditorias_();
    } else if (seccionActiva_ === 'quejas') {
      if (quejaActivaId_) abrirQueja_(quejaActivaId_); else cargarQuejas_();
    } else {
      if (documentoActivoId_) abrirDocumento_(documentoActivoId_); else cargarListado_();
    }
  }

  // Barra de secciones del modulo. Documentos y Personas son los dos
  // submodulos del SGC que existen hoy (PRO-01 y PRO-02).
  function barraSecciones_() {
    var secciones = [
      { id: 'documentos', texto: 'Documentos' },
      { id: 'personas', texto: 'Personas' },
      { id: 'capacitaciones', texto: 'Capacitaciones' },
      { id: 'nc', texto: 'No conformidades' },
      { id: 'auditorias', texto: 'Auditorías' },
      { id: 'quejas', texto: 'Quejas' }
    ];
    return '<div class="sigso-tabs sgc-secciones">' + secciones.map(function (s) {
      return '<button type="button" class="sigso-tab js-sgc-seccion' +
        (s.id === seccionActiva_ ? ' sigso-tab--activo' : '') + '" data-sec="' + s.id + '">' + s.texto + '</button>';
    }).join('') + '</div>';
  }

  function wireSecciones_(cont) {
    cont.querySelectorAll('.js-sgc-seccion').forEach(function (btn) {
      btn.addEventListener('click', function () {
        seccionActiva_ = btn.getAttribute('data-sec');
        documentoActivoId_ = null;
        personaActivaId_ = null;
        ncActivaId_ = null;
        auditoriaActivaId_ = null;
        quejaActivaId_ = null;
        render_();
      });
    });
  }

  function urlBackoffice_() {
    return (window.SIGSO_CONFIG || {}).BACKOFFICE_URL;
  }
  function api_(accion, datos) {
    return llamarApi(urlBackoffice_(), accion, datos || {});
  }

  var TIPO_ETIQUETA = {
    DOC: 'Documento maestro', PRO: 'Procedimiento', INS: 'Instructivo',
    FO: 'Formulario', EXTERNO: 'Documento externo'
  };
  var VISIBILIDAD_ETIQUETA = {
    TODOS: 'Todo el personal', AREA: 'Solo su área', SELECCION: 'Personas específicas'
  };
  var ROL_SGC_ETIQUETA = {
    ENCARGADO_SGC: 'Encargado SGC', DIRECCION: 'Dirección', GERENCIA_ADM: 'Gerencia Adm.',
    JEFATURA_AREA: 'Jefatura de área', ENC_ADMIN: 'Enc. Administración',
    OPERATIVO: 'Personal operativo', AUDITOR_EXTERNO: 'Auditor externo'
  };
  var TIPOS = ['DOC', 'PRO', 'INS', 'FO', 'EXTERNO'];

  var seccionActiva_ = 'documentos';
  var documentoActivoId_ = null;
  var personaActivaId_ = null;
  var ncActivaId_ = null;
  var auditoriaActivaId_ = null;
  var quejaActivaId_ = null;
  var pestanaFicha_ = 'datos';
  var puedeGestionar_ = false;
  var filtroTipo_ = '';
  var filtroEstado_ = '';
  var filtroBusqueda_ = '';

  // --- listado maestro (FO-PRO-01-01) --------------------------------------

  function cargarListado_() {
    documentoActivoId_ = null;
    var cont = document.getElementById('calidad-contenido');
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando documentos...');
    var filtros = {};
    if (filtroTipo_) filtros.tipo = filtroTipo_;
    if (filtroEstado_) filtros.estado = filtroEstado_;
    if (filtroBusqueda_) filtros.busqueda = filtroBusqueda_;

    api_('listarDocumentosSgc', filtros).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar el listado de documentos.', 'error');
        return;
      }
      puedeGestionar_ = respuesta.data.puede_gestionar === true;
      pintarListado_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = Componentes.alerta('No se pudo conectar para cargar los documentos.', 'error');
    });
  }

  function pintarListado_(cont, data) {
    var docs = data.documentos || [];
    var hayFiltros = !!(filtroTipo_ || filtroEstado_ || filtroBusqueda_);

    // v10.0 Fase 1b: lo primero que ve la persona es lo que le falta
    // confirmar. Es la unica obligacion que el SGC le impone al personal
    // operativo, asi que va arriba y no escondida en el listado.
    var avisoAcuse = data.pendientes_de_acuse
      ? Componentes.alerta(
          'Tienes ' + data.pendientes_de_acuse + ' documento(s) que debes confirmar como leídos. ' +
          'Ábrelos y marca "Enterado".', 'aviso')
      : '';

    var cabecera = barraSecciones_() + '<div class="sgc-cabecera">' +
      '<p class="sigso-ayuda">Listado maestro: los documentos vigentes del SGC que te corresponden. ' +
        'Tu rol: <b>' + Componentes.escaparHtml(ROL_SGC_ETIQUETA[data.rol_sgc] || data.rol_sgc) + '</b>.</p>' +
      (puedeGestionar_ ? Componentes.boton({ texto: '+ Cargar documento', clase: 'js-sgc-nuevo' }) : '') +
      '</div>' + avisoAcuse +
      '<div class="sgc-filtros">' +
        Componentes.campoTexto({ id: 'sgc-f-busqueda', label: false, valor: filtroBusqueda_, placeholder: 'Buscar por código o nombre...' }) +
        Componentes.campoSelect({
          id: 'sgc-f-tipo', label: false, valor: filtroTipo_, placeholder: 'Todos los tipos',
          opciones: TIPOS.map(function (t) { return { valor: t, texto: TIPO_ETIQUETA[t] }; })
        }) +
        (puedeGestionar_
          ? Componentes.campoSelect({
              id: 'sgc-f-estado', label: false, valor: filtroEstado_, placeholder: 'Vigentes y obsoletos',
              opciones: [{ valor: 'VIGENTE', texto: 'Solo vigentes' }, { valor: 'OBSOLETO', texto: 'Solo obsoletos' }]
            })
          : '') +
        (hayFiltros ? Componentes.boton({ texto: 'Limpiar', variante: 'sutil', clase: 'js-sgc-limpiar', tipo: 'button' }) : '') +
      '</div>';

    function wire() {
      wireSecciones_(cont);
      var nuevo = cont.querySelector('.js-sgc-nuevo');
      if (nuevo) nuevo.addEventListener('click', abrirFormularioNuevo_);

      var busqueda = cont.querySelector('#sgc-f-busqueda');
      if (busqueda) {
        busqueda.addEventListener('change', function () { filtroBusqueda_ = this.value; cargarListado_(); });
        busqueda.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); filtroBusqueda_ = this.value; cargarListado_(); }
        });
      }
      var tipo = cont.querySelector('#sgc-f-tipo');
      if (tipo) tipo.addEventListener('change', function () { filtroTipo_ = this.value; cargarListado_(); });
      var estado = cont.querySelector('#sgc-f-estado');
      if (estado) estado.addEventListener('change', function () { filtroEstado_ = this.value; cargarListado_(); });
      var limpiar = cont.querySelector('.js-sgc-limpiar');
      if (limpiar) limpiar.addEventListener('click', function () {
        filtroTipo_ = ''; filtroEstado_ = ''; filtroBusqueda_ = '';
        cargarListado_();
      });
      cont.querySelectorAll('.js-sgc-abrir').forEach(function (btn) {
        btn.addEventListener('click', function () { abrirDocumento_(btn.getAttribute('data-id')); });
      });
    }

    if (docs.length === 0) {
      cont.innerHTML = cabecera + Componentes.vacio(hayFiltros
        ? { texto: 'Ningún documento coincide con estos filtros.' }
        : { texto: 'Todavía no hay documentos disponibles para ti.', detalle: puedeGestionar_ ? 'Carga el primero para empezar.' : 'El Encargado SGC los irá publicando.' });
      wire();
      return;
    }

    var filas = docs.map(function (d) {
      var obsoleto = d.estado === 'OBSOLETO';
      return '<button type="button" class="sgc-doc js-sgc-abrir' + (obsoleto ? ' sgc-doc--obsoleto' : '') + '" data-id="' + d.documento_id + '">' +
        '<div class="sgc-doc__top">' +
          '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(d.codigo) + '</span>' +
          '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(d.nombre) + '</span>' +
          Componentes.badge('v' === String(d.version_vigente).charAt(0) ? d.version_vigente : ('v' + d.version_vigente), 'neutro') +
          (obsoleto ? Componentes.badge('Obsoleto', 'critico') : '') +
          (d.debo_acusar ? Componentes.badge('Debes confirmar', 'alerta') : '') +
          (d.revision_vencida && !obsoleto ? Componentes.badge('Revisión vencida', 'alerta') : '') +
        '</div>' +
        '<div class="sgc-doc__meta">' +
          '<span>' + Componentes.escaparHtml(TIPO_ETIQUETA[d.tipo] || d.tipo) + '</span>' +
          (d.fecha_vigencia ? '<span>Vigente desde ' + fechaCorta_(d.fecha_vigencia) + '</span>' : '') +
          (d.proxima_revision ? '<span>Revisar ' + fechaCorta_(d.proxima_revision) + '</span>' : '') +
          (puedeGestionar_ ? '<span>' + Componentes.escaparHtml(VISIBILIDAD_ETIQUETA[d.visibilidad] || d.visibilidad) + '</span>' : '') +
        '</div>' +
      '</button>';
    }).join('');

    cont.innerHTML = cabecera + '<div class="sgc-lista">' + filas + '</div>';
    wire();
  }

  // --- detalle del documento ------------------------------------------------

  function abrirDocumento_(id) {
    documentoActivoId_ = id;
    var cont = document.getElementById('calidad-contenido');
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando documento...');
    api_('getDocumentoSgc', { documento_id: id }).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo abrir el documento.', 'error');
        return;
      }
      puedeGestionar_ = respuesta.data.puede_gestionar === true;
      pintarDetalle_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = Componentes.alerta('No se pudo conectar para abrir el documento.', 'error');
    });
  }

  function pintarDetalle_(cont, data) {
    var d = data.documento;
    var obsoleto = d.estado === 'OBSOLETO';

    var acciones = '<div class="sgc-acciones">' +
      (d.archivo_id ? Componentes.boton({ texto: '⬇ Descargar', clase: 'js-sgc-descargar' }) : '') +
      (puedeGestionar_ ? Componentes.boton({ texto: 'Nueva versión', variante: 'secundario', clase: 'js-sgc-version' }) : '') +
      (puedeGestionar_ ? Componentes.boton({ texto: 'Editar', variante: 'secundario', clase: 'js-sgc-editar' }) : '') +
      (puedeGestionar_ ? Componentes.boton({ texto: 'Ver quién confirmó', variante: 'secundario', clase: 'js-sgc-cumplimiento' }) : '') +
      (puedeGestionar_ && !obsoleto ? Componentes.boton({ texto: 'Marcar obsoleto', variante: 'peligro', clase: 'js-sgc-obsoleto' }) : '') +
      (puedeGestionar_ && obsoleto ? Componentes.boton({ texto: 'Volver a vigente', variante: 'secundario', clase: 'js-sgc-vigente' }) : '') +
      '</div>';

    // v10.0 Fase 1b: la confirmacion de lectura. Se muestra arriba, antes de
    // la ficha, porque es lo unico que esta persona TIENE que hacer aca.
    var bloqueAcuse = '';
    if (data.debo_acusar) {
      var plazo = d.fecha_limite_acuse
        ? ' Plazo: ' + fechaCorta_(d.fecha_limite_acuse) + '.'
        : '';
      bloqueAcuse = '<div class="sgc-acuse sgc-acuse--pendiente">' +
        '<p><b>Debes confirmar que conoces este documento.</b>' + Componentes.escaparHtml(plazo) +
          ' Descárgalo, léelo y marca "Enterado".</p>' +
        Componentes.boton({ texto: '✓ Enterado', clase: 'js-sgc-acusar' }) +
      '</div>';
    } else if (data.mi_acuse) {
      bloqueAcuse = '<div class="sgc-acuse sgc-acuse--hecho">' +
        '<p>✓ Confirmaste este documento (versión ' + Componentes.escaparHtml(d.version_vigente) +
          ') el ' + fechaCorta_(data.mi_acuse) + '.</p>' +
      '</div>';
    }

    var ficha = '<dl class="sgc-ficha">' +
      campoFicha_('Tipo', TIPO_ETIQUETA[d.tipo] || d.tipo) +
      campoFicha_('Versión vigente', d.version_vigente) +
      campoFicha_('Vigente desde', fechaCorta_(d.fecha_vigencia)) +
      campoFicha_('Próxima revisión', fechaCorta_(d.proxima_revision)) +
      (d.area_id ? campoFicha_('Área', d.area_id) : '') +
      (puedeGestionar_ ? campoFicha_('Visibilidad', VISIBILIDAD_ETIQUETA[d.visibilidad] || d.visibilidad) : '') +
      (d.elaborado_por ? campoFicha_('Elaborado por', d.elaborado_por) : '') +
      (d.revisado_por ? campoFicha_('Revisado por', d.revisado_por) : '') +
      (d.aprobado_por ? campoFicha_('Aprobado por', d.aprobado_por) : '') +
      '</dl>';

    var versiones = (data.versiones || []).length
      ? '<h3 class="sgc-sub">Historial de versiones</h3>' +
        '<div class="sgc-lista">' + (data.versiones || []).map(function (v) {
          var esVigente = v.vigente === true || v.vigente === 'TRUE';
          return '<div class="sgc-version">' +
            '<div class="sgc-doc__top">' +
              '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(v.version) + '</span>' +
              (esVigente ? Componentes.badge('Vigente', 'ok') : Componentes.badge('Archivada', 'neutro')) +
              '<span class="sigso-ayuda">' + fechaCorta_(v.fecha) + '</span>' +
            '</div>' +
            (v.cambios ? '<p class="sigso-ayuda">' + Componentes.escaparHtml(v.cambios) + '</p>' : '') +
            (puedeGestionar_ && !esVigente && v.archivo_id
              ? Componentes.boton({ texto: 'Descargar esta versión', variante: 'sutil', clase: 'js-sgc-descargar-version', idx: v.version_id })
              : '') +
          '</div>';
        }).join('') + '</div>'
      : '';

    cont.innerHTML =
      '<div class="sgc-detalle-cab">' +
        Componentes.boton({ texto: '← Listado', variante: 'sutil', clase: 'js-sgc-volver' }) +
        '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(d.codigo) + '</span>' +
        '<h1>' + Componentes.escaparHtml(d.nombre) + '</h1>' +
        (obsoleto ? Componentes.badge('Obsoleto', 'critico') : '') +
      '</div>' +
      (obsoleto
        ? Componentes.alerta('Este documento está fuera de circulación. Se conserva solo para trazabilidad; no debe usarse.', 'aviso')
        : '') +
      '<div class="sgc-cuerpo">' +
        bloqueAcuse +
        (d.descripcion ? '<p>' + Componentes.escaparHtml(d.descripcion) + '</p>' : '') +
        ficha +
        (d.archivo_nombre ? '<p class="sigso-ayuda">Archivo: ' + Componentes.escaparHtml(d.archivo_nombre) + '</p>' : '') +
        acciones +
        '<div class="js-sgc-cumplimiento-panel"></div>' +
        versiones +
      '</div>';

    cont.querySelector('.js-sgc-volver').addEventListener('click', cargarListado_);

    var btnDescargar = cont.querySelector('.js-sgc-descargar');
    if (btnDescargar) btnDescargar.addEventListener('click', function () { descargar_(d.documento_id, null); });

    cont.querySelectorAll('.js-sgc-descargar-version').forEach(function (btn) {
      btn.addEventListener('click', function () { descargar_(d.documento_id, btn.getAttribute('data-idx')); });
    });

    var btnVersion = cont.querySelector('.js-sgc-version');
    if (btnVersion) btnVersion.addEventListener('click', function () { abrirFormularioVersion_(d); });

    var btnEditar = cont.querySelector('.js-sgc-editar');
    if (btnEditar) btnEditar.addEventListener('click', function () { abrirFormularioEditar_(d, data.destinatarios || []); });

    var btnObsoleto = cont.querySelector('.js-sgc-obsoleto');
    if (btnObsoleto) btnObsoleto.addEventListener('click', function () {
      Componentes.confirmar({
        titulo: 'Marcar como obsoleto',
        mensaje: 'El documento saldrá de circulación y el personal dejará de verlo. No se elimina: queda archivado para trazabilidad.'
      }).then(function (ok) {
        if (!ok) return;
        cambiarEstado_(d.documento_id, 'OBSOLETO');
      });
    });

    var btnVigente = cont.querySelector('.js-sgc-vigente');
    if (btnVigente) btnVigente.addEventListener('click', function () { cambiarEstado_(d.documento_id, 'VIGENTE'); });

    var btnAcusar = cont.querySelector('.js-sgc-acusar');
    if (btnAcusar) btnAcusar.addEventListener('click', function () {
      btnAcusar.disabled = true;
      api_('acusarDocumentoSgc', { documento_id: d.documento_id }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          btnAcusar.disabled = false;
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo confirmar.', tipo: 'error' });
          return;
        }
        Componentes.aviso({ texto: 'Confirmado. Queda registrado con tu nombre y la fecha.', tipo: 'exito' });
        abrirDocumento_(d.documento_id);
      });
    });

    var btnCumplimiento = cont.querySelector('.js-sgc-cumplimiento');
    if (btnCumplimiento) btnCumplimiento.addEventListener('click', function () {
      var panel = cont.querySelector('.js-sgc-cumplimiento-panel');
      panel.innerHTML = Componentes.cargando('Cargando...');
      api_('getCumplimientoDocumentoSgc', { documento_id: d.documento_id }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          panel.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar.', 'error');
          return;
        }
        pintarCumplimiento_(panel, respuesta.data);
      }).catch(function () {
        panel.innerHTML = Componentes.alerta('No se pudo conectar.', 'error');
      });
    });
  }

  // Quién confirmó y quién falta, de la VERSIÓN VIGENTE. Es lo que el
  // Encargado SGC le muestra al auditor cuando pregunta cómo prueba que su
  // personal conoce el documento.
  function pintarCumplimiento_(panel, c) {
    if (!c.requiere_acuse) {
      panel.innerHTML = '<p class="sigso-ayuda">Este documento no exige confirmación de lectura.</p>';
      return;
    }
    var total = c.confirmados.length + c.pendientes.length;
    panel.innerHTML =
      '<h3 class="sgc-sub">Confirmación de lectura — versión ' + Componentes.escaparHtml(c.version) + '</h3>' +
      '<p class="sigso-ayuda">' + c.confirmados.length + ' de ' + total + ' persona(s) han confirmado' +
        (c.fecha_limite_acuse ? ' · plazo ' + fechaCorta_(c.fecha_limite_acuse) : '') + '.</p>' +
      '<div class="sgc-lista">' +
        (c.pendientes.length
          ? '<div class="sgc-version"><div class="sgc-doc__top">' +
              Componentes.badge('Falta confirmar (' + c.pendientes.length + ')', 'alerta') +
            '</div><p class="sigso-ayuda">' +
              c.pendientes.map(function (e) { return Componentes.escaparHtml(e); }).join(', ') +
            '</p></div>'
          : '') +
        (c.confirmados.length
          ? '<div class="sgc-version"><div class="sgc-doc__top">' +
              Componentes.badge('Confirmado (' + c.confirmados.length + ')', 'ok') +
            '</div>' +
            c.confirmados.map(function (x) {
              return '<p class="sigso-ayuda">' + Componentes.escaparHtml(x.usuario_email) +
                ' — ' + fechaCorta_(x.acusado_en) + '</p>';
            }).join('') +
            '</div>'
          : '') +
      '</div>';
  }

  function campoFicha_(etiqueta, valor) {
    if (valor === undefined || valor === null || valor === '') return '';
    return '<div class="sgc-ficha__campo"><dt>' + Componentes.escaparHtml(etiqueta) + '</dt>' +
      '<dd>' + Componentes.escaparHtml(String(valor)) + '</dd></div>';
  }

  function cambiarEstado_(documentoId, estado) {
    api_('actualizarDocumentoSgc', { documento_id: documentoId, estado: estado }).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo actualizar el documento.', tipo: 'error' });
        return;
      }
      abrirDocumento_(documentoId);
    });
  }

  function descargar_(documentoId, versionId) {
    var datos = { documento_id: documentoId };
    if (versionId) datos.version_id = versionId;
    api_('descargarDocumentoSgc', datos).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo descargar el documento.', tipo: 'error' });
        return;
      }
      descargarBase64Sgc_(respuesta.data.contenido_base64, respuesta.data.nombre_archivo, respuesta.data.mime);
    });
  }

  // --- formularios -----------------------------------------------------------

  function camposComunes_(d) {
    d = d || {};
    return Componentes.campoTexto({ id: 'sgc-codigo', label: 'Código', valor: d.codigo, requerido: true, placeholder: 'Ej: DOC-01, PRO-07, FO-PRO-02-01' }) +
      Componentes.campoTexto({ id: 'sgc-nombre', label: 'Nombre', valor: d.nombre, requerido: true, placeholder: 'Ej: Manual de Calidad' }) +
      Componentes.campoTextarea({ id: 'sgc-descripcion', label: 'Descripción (opcional)', valor: d.descripcion }) +
      '<div class="sgc-form-fila">' +
        Componentes.campoSelect({
          id: 'sgc-tipo', label: 'Tipo', valor: d.tipo || 'DOC', placeholder: false,
          opciones: TIPOS.map(function (t) { return { valor: t, texto: TIPO_ETIQUETA[t] }; })
        }) +
        Componentes.campoTexto({ id: 'sgc-area', label: 'Área (opcional)', valor: d.area_id, placeholder: 'Ej: PREVENCION' }) +
      '</div>' +
      Componentes.campoSelect({
        id: 'sgc-visibilidad', label: '¿Quién puede verlo?', valor: d.visibilidad || 'TODOS', placeholder: false,
        opciones: Object.keys(VISIBILIDAD_ETIQUETA).map(function (v) { return { valor: v, texto: VISIBILIDAD_ETIQUETA[v] }; })
      }) +
      Componentes.campoTextarea({
        id: 'sgc-destinatarios', label: 'Correos autorizados (uno por línea)',
        ayuda: 'Solo se usa si elegiste "Personas específicas".'
      }) +
      '<div class="sgc-form-fila">' +
        Componentes.campoTexto({ id: 'sgc-elaborado', label: 'Elaborado por', valor: d.elaborado_por }) +
        Componentes.campoTexto({ id: 'sgc-revisado', label: 'Revisado por', valor: d.revisado_por }) +
        Componentes.campoTexto({ id: 'sgc-aprobado', label: 'Aprobado por', valor: d.aprobado_por }) +
      '</div>' +
      // v10.0 Fase 1b: por defecto SÍ exige confirmación -- es lo que
      // convierte "lo publiqué" en evidencia de que la gente lo conoce.
      '<label class="sigso-campo-check"><input type="checkbox" id="sgc-requiere-acuse"' +
        (d.documento_id && d.requiere_acuse === false ? '' : ' checked') +
        '> Exigir confirmación de lectura ("Enterado")</label>' +
      Componentes.campoTexto({
        id: 'sgc-limite-acuse', label: 'Plazo para confirmar (opcional)', tipo: 'date',
        valor: fechaISO_(d.fecha_limite_acuse)
      });
  }

  function leerAcuse_() {
    var chk = document.getElementById('sgc-requiere-acuse');
    var limite = document.getElementById('sgc-limite-acuse');
    return {
      requiere_acuse: chk ? chk.checked : true,
      fecha_limite_acuse: limite ? limite.value : ''
    };
  }

  function leerDestinatarios_() {
    var el = document.getElementById('sgc-destinatarios');
    if (!el) return [];
    return el.value.split(/[\n,;]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function abrirFormularioNuevo_() {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Cargar documento del SGC</h3>' +
        '<p class="sigso-ayuda">Sube el archivo que ya tienes (PDF, Word o Excel) y registra su control documental.</p>' +
        '<form id="form-sgc-nuevo">' +
          camposComunes_(null) +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'sgc-version', label: 'Versión', valor: 'v01', requerido: true }) +
            Componentes.campoTexto({ id: 'sgc-vigencia', label: 'Vigente desde', tipo: 'date', requerido: true }) +
          '</div>' +
          '<div class="sigso-campo">' +
            '<label for="sgc-archivo">Archivo (PDF, Word o Excel · máx. 10 MB)</label>' +
            '<input type="file" id="sgc-archivo" accept=".pdf,.doc,.docx,.xls,.xlsx" required>' +
          '</div>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Cargar documento', tipo: 'submit', clase: 'js-sgc-guardar' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-sgc-nuevo').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var archivo = document.getElementById('sgc-archivo').files[0];
      if (!archivo) {
        Componentes.aviso({ texto: 'Selecciona el archivo del documento.', tipo: 'error' });
        return;
      }
      var boton = fondo.querySelector('.js-sgc-guardar');
      boton.disabled = true; boton.textContent = 'Subiendo...';

      leerArchivoBase64Sgc_(archivo).then(function (base64) {
        var acuse = leerAcuse_();
        return api_('crearDocumentoSgc', {
          codigo: document.getElementById('sgc-codigo').value,
          nombre: document.getElementById('sgc-nombre').value,
          descripcion: document.getElementById('sgc-descripcion').value,
          tipo: document.getElementById('sgc-tipo').value,
          area_id: document.getElementById('sgc-area').value,
          visibilidad: document.getElementById('sgc-visibilidad').value,
          destinatarios: leerDestinatarios_(),
          version_vigente: document.getElementById('sgc-version').value,
          fecha_vigencia: document.getElementById('sgc-vigencia').value,
          elaborado_por: document.getElementById('sgc-elaborado').value,
          revisado_por: document.getElementById('sgc-revisado').value,
          aprobado_por: document.getElementById('sgc-aprobado').value,
          requiere_acuse: acuse.requiere_acuse,
          fecha_limite_acuse: acuse.fecha_limite_acuse,
          nombre_archivo: archivo.name,
          contenido_base64: base64
        });
      }).then(function (respuesta) {
        boton.disabled = false; boton.textContent = 'Cargar documento';
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo cargar el documento.', tipo: 'error' });
          return;
        }
        cerrar();
        cargarListado_();
      }).catch(function () {
        boton.disabled = false; boton.textContent = 'Cargar documento';
        Componentes.aviso({ texto: 'No se pudo leer o subir el archivo.', tipo: 'error' });
      });
    });
  }

  function abrirFormularioVersion_(d) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Nueva versión de ' + Componentes.escaparHtml(d.codigo) + '</h3>' +
        '<p class="sigso-ayuda">La versión ' + Componentes.escaparHtml(d.version_vigente) +
          ' quedará archivada (no se elimina) y esta pasará a ser la vigente.</p>' +
        '<form id="form-sgc-version">' +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'sgc-v-version', label: 'Nueva versión', requerido: true, placeholder: 'Ej: v02' }) +
            Componentes.campoTexto({ id: 'sgc-v-vigencia', label: 'Vigente desde', tipo: 'date', requerido: true }) +
          '</div>' +
          Componentes.campoTextarea({ id: 'sgc-v-cambios', label: 'Descripción del cambio', requerido: true, placeholder: '¿Qué cambió respecto de la versión anterior?' }) +
          '<div class="sigso-campo">' +
            '<label for="sgc-v-archivo">Archivo de la nueva versión</label>' +
            '<input type="file" id="sgc-v-archivo" accept=".pdf,.doc,.docx,.xls,.xlsx" required>' +
          '</div>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Subir versión', tipo: 'submit', clase: 'js-sgc-guardar' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-sgc-version').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var archivo = document.getElementById('sgc-v-archivo').files[0];
      if (!archivo) return;
      var boton = fondo.querySelector('.js-sgc-guardar');
      boton.disabled = true; boton.textContent = 'Subiendo...';

      leerArchivoBase64Sgc_(archivo).then(function (base64) {
        return api_('nuevaVersionDocumentoSgc', {
          documento_id: d.documento_id,
          version: document.getElementById('sgc-v-version').value,
          fecha_vigencia: document.getElementById('sgc-v-vigencia').value,
          cambios: document.getElementById('sgc-v-cambios').value,
          nombre_archivo: archivo.name,
          contenido_base64: base64
        });
      }).then(function (respuesta) {
        boton.disabled = false; boton.textContent = 'Subir versión';
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo subir la nueva versión.', tipo: 'error' });
          return;
        }
        cerrar();
        abrirDocumento_(d.documento_id);
      }).catch(function () {
        boton.disabled = false; boton.textContent = 'Subir versión';
        Componentes.aviso({ texto: 'No se pudo leer o subir el archivo.', tipo: 'error' });
      });
    });
  }

  function abrirFormularioEditar_(d, destinatarios) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Editar ' + Componentes.escaparHtml(d.codigo) + '</h3>' +
        '<form id="form-sgc-editar">' +
          camposComunes_(d) +
          Componentes.campoTexto({ id: 'sgc-vigencia-ed', label: 'Vigente desde', tipo: 'date', valor: fechaISO_(d.fecha_vigencia) }) +
          // Un documento puede existir sin archivo (asi entra la carga
          // inicial del listado maestro): aca es donde se le adjunta, sin
          // tener que inventar una version nueva.
          '<div class="sigso-campo">' +
            '<label for="sgc-archivo-ed">' +
              (d.archivo_id ? 'Reemplazar el archivo (opcional)' : 'Adjuntar el archivo') +
            '</label>' +
            '<input type="file" id="sgc-archivo-ed" accept=".pdf,.doc,.docx,.xls,.xlsx">' +
            '<p class="sigso-ayuda">' +
              (d.archivo_id
                ? 'Actual: ' + Componentes.escaparHtml(d.archivo_nombre || 'sin nombre') +
                  '. Déjalo vacío para no cambiarlo. Si alguien ya confirmó esta versión, usa "Nueva versión".'
                : 'Este documento todavía no tiene archivo: sin él, el personal no puede consultarlo. ' +
                  'PDF, Word o Excel · máx. 10 MB.') +
            '</p>' +
          '</div>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    // El codigo identifica al documento en el listado maestro: cambiarlo
    // despues de creado confunde la trazabilidad, asi que se muestra pero
    // no se edita.
    document.getElementById('sgc-codigo').readOnly = true;
    document.getElementById('sgc-destinatarios').value = (destinatarios || []).join('\n');

    document.getElementById('form-sgc-editar').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var acuseEd = leerAcuse_();
      var archivoEd = document.getElementById('sgc-archivo-ed').files[0];
      var boton = fondo.querySelector('button[type="submit"]');
      var etiqueta = boton ? boton.textContent : '';
      if (boton && archivoEd) { boton.disabled = true; boton.textContent = 'Subiendo...'; }

      // Sin archivo nuevo no se toca el que ya esta: el backend solo lo
      // reemplaza si le llega contenido_base64.
      var leerlo = archivoEd ? leerArchivoBase64Sgc_(archivoEd) : Promise.resolve(null);

      leerlo.then(function (base64) {
        var datos = {
          documento_id: d.documento_id,
          nombre: document.getElementById('sgc-nombre').value,
          descripcion: document.getElementById('sgc-descripcion').value,
          tipo: document.getElementById('sgc-tipo').value,
          area_id: document.getElementById('sgc-area').value,
          visibilidad: document.getElementById('sgc-visibilidad').value,
          destinatarios: leerDestinatarios_(),
          fecha_vigencia: document.getElementById('sgc-vigencia-ed').value,
          elaborado_por: document.getElementById('sgc-elaborado').value,
          revisado_por: document.getElementById('sgc-revisado').value,
          aprobado_por: document.getElementById('sgc-aprobado').value,
          requiere_acuse: acuseEd.requiere_acuse,
          fecha_limite_acuse: acuseEd.fecha_limite_acuse
        };
        if (base64) {
          datos.nombre_archivo = archivoEd.name;
          datos.contenido_base64 = base64;
        }
        return api_('actualizarDocumentoSgc', datos);
      }).then(function (respuesta) {
        if (boton) { boton.disabled = false; boton.textContent = etiqueta; }
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        if (archivoEd) Componentes.aviso({ texto: 'Documento actualizado con su archivo.', tipo: 'exito' });
        abrirDocumento_(d.documento_id);
      }).catch(function () {
        if (boton) { boton.disabled = false; boton.textContent = etiqueta; }
        Componentes.aviso({ texto: 'No se pudo leer o subir el archivo.', tipo: 'error' });
      });
    });
  }

  // ==========================================================================
  // PERSONAS (Fase 2a, PRO-02) — la ficha del trabajador
  //
  // Recordatorio de diseño: el backend ya decide QUÉ fichas ve cada quien
  // (el personal operativo, solo la suya). Acá nunca se filtra por permiso.
  // ==========================================================================

  var TIPO_PERSONA_ETIQUETA = { INT: 'Interno', EXT: 'Externo' };
  var TIPO_DOC_PERSONA_ETIQUETA = {
    CV: 'CV', TITULO: 'Título / diploma', ISO9001: 'Curso ISO 9001',
    CONTRATO: 'Contrato o anexo', CERTIFICADO: 'Certificado de capacitación', OTRO: 'Otro'
  };

  var filtroPersonasArea_ = '';
  var incluirDesvinculados_ = false;

  function cargarPersonas_() {
    personaActivaId_ = null;
    var cont = document.getElementById('calidad-contenido');
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando personal...');
    var filtros = {};
    if (filtroPersonasArea_) filtros.area_id = filtroPersonasArea_;
    if (incluirDesvinculados_) filtros.incluir_desvinculados = true;

    api_('listarPersonasSgc', filtros).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar el personal.', 'error');
        return;
      }
      puedeGestionar_ = respuesta.data.puede_gestionar === true;
      pintarPersonas_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = Componentes.alerta('No se pudo conectar para cargar el personal.', 'error');
    });
  }

  function pintarPersonas_(cont, data) {
    var personas = data.personas || [];

    // El personal operativo solo se ve a sí mismo: mostrarle un "listado"
    // de una fila es ruido. Se entra directo a su ficha.
    if (!puedeGestionar_ && personas.length === 1) {
      personaActivaId_ = personas[0].persona_id;
      abrirPersona_(personas[0].persona_id);
      return;
    }

    var cabecera = barraSecciones_() + '<div class="sgc-cabecera">' +
      '<p class="sigso-ayuda">Personal en alcance del SGC: su ficha, descriptor de cargo, documentos e inducción.</p>' +
      (puedeGestionar_ ? Componentes.boton({ texto: '+ Nueva persona', clase: 'js-sgc-nueva-persona' }) : '') +
      '</div>' +
      (puedeGestionar_
        ? '<div class="sgc-filtros">' +
            Componentes.campoTexto({ id: 'sgc-p-area', label: false, valor: filtroPersonasArea_, placeholder: 'Filtrar por área...' }) +
            '<label class="sigso-campo-check"><input type="checkbox" id="sgc-p-desv"' +
              (incluirDesvinculados_ ? ' checked' : '') + '> Incluir desvinculados</label>' +
          '</div>'
        : '');

    function wire() {
      wireSecciones_(cont);
      var nueva = cont.querySelector('.js-sgc-nueva-persona');
      if (nueva) nueva.addEventListener('click', function () { abrirFormularioPersona_(null); });
      var area = cont.querySelector('#sgc-p-area');
      if (area) {
        area.addEventListener('change', function () { filtroPersonasArea_ = this.value; cargarPersonas_(); });
        area.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); filtroPersonasArea_ = this.value; cargarPersonas_(); }
        });
      }
      var desv = cont.querySelector('#sgc-p-desv');
      if (desv) desv.addEventListener('change', function () { incluirDesvinculados_ = this.checked; cargarPersonas_(); });
      cont.querySelectorAll('.js-sgc-abrir-persona').forEach(function (btn) {
        btn.addEventListener('click', function () { abrirPersona_(btn.getAttribute('data-id')); });
      });
    }

    if (personas.length === 0) {
      cont.innerHTML = cabecera + Componentes.vacio({
        texto: 'Todavía no hay personal registrado.',
        detalle: puedeGestionar_ ? 'Agrega a las personas en alcance del SGC.' : ''
      });
      wire();
      return;
    }

    var filas = personas.map(function (p) {
      var baja = p.estado === 'DESVINCULADO';
      var induccionCompleta = p.induccion_total > 0 && p.induccion_completadas >= p.induccion_total;
      return '<button type="button" class="sgc-doc js-sgc-abrir-persona' + (baja ? ' sgc-doc--obsoleto' : '') +
        '" data-id="' + p.persona_id + '">' +
        '<div class="sgc-doc__top">' +
          '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(p.nombre) + '</span>' +
          Componentes.badge(TIPO_PERSONA_ETIQUETA[p.tipo] || p.tipo, 'neutro') +
          (baja ? Componentes.badge('Desvinculado', 'critico') : '') +
          (!baja && !p.tiene_descriptor ? Componentes.badge('Sin descriptor', 'alerta') : '') +
          (!baja && !induccionCompleta ? Componentes.badge('Inducción pendiente', 'alerta') : '') +
        '</div>' +
        '<div class="sgc-doc__meta">' +
          (p.cargo ? '<span>' + Componentes.escaparHtml(p.cargo) + '</span>' : '') +
          (p.area_id ? '<span>' + Componentes.escaparHtml(p.area_id) + '</span>' : '') +
          (p.fecha_ingreso ? '<span>Ingreso ' + fechaCorta_(p.fecha_ingreso) + '</span>' : '') +
          '<span>Inducción ' + p.induccion_completadas + '/' + p.induccion_total + '</span>' +
        '</div>' +
      '</button>';
    }).join('');

    cont.innerHTML = cabecera + '<div class="sgc-lista">' + filas + '</div>';
    wire();
  }

  // --- ficha de la persona ---------------------------------------------------

  function abrirPersona_(id) {
    personaActivaId_ = id;
    var cont = document.getElementById('calidad-contenido');
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando ficha...');
    api_('getFichaPersonaSgc', { persona_id: id }).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo abrir la ficha.', 'error');
        return;
      }
      puedeGestionar_ = respuesta.data.puede_gestionar === true;
      pintarFicha_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = Componentes.alerta('No se pudo conectar para abrir la ficha.', 'error');
    });
  }

  function pintarFicha_(cont, data) {
    var p = data.persona;
    var baja = p.estado === 'DESVINCULADO';
    var PESTANAS = [
      { id: 'datos', texto: 'Datos' },
      { id: 'descriptor', texto: 'Descriptor de cargo' },
      { id: 'documentos', texto: 'Documentos' },
      { id: 'induccion', texto: 'Inducción' },
      { id: 'competencias', texto: 'Competencias' }
    ];
    var tabs = PESTANAS.map(function (t) {
      return '<button type="button" class="sigso-tab js-sgc-ficha-tab' +
        (t.id === pestanaFicha_ ? ' sigso-tab--activo' : '') + '" data-tab="' + t.id + '">' + t.texto + '</button>';
    }).join('');

    var cuerpo = '';
    if (pestanaFicha_ === 'datos') cuerpo = pintarDatosPersona_(data);
    else if (pestanaFicha_ === 'descriptor') cuerpo = pintarDescriptor_(data);
    else if (pestanaFicha_ === 'documentos') cuerpo = pintarDocsPersona_(data);
    else if (pestanaFicha_ === 'induccion') cuerpo = pintarInduccion_(data);
    else if (pestanaFicha_ === 'competencias') cuerpo = pintarCompetencias_(data);

    cont.innerHTML =
      '<div class="sgc-detalle-cab">' +
        Componentes.boton({ texto: '← Personal', variante: 'sutil', clase: 'js-sgc-volver-personas' }) +
        '<h1>' + Componentes.escaparHtml(p.nombre) + '</h1>' +
        Componentes.badge(TIPO_PERSONA_ETIQUETA[p.tipo] || p.tipo, 'neutro') +
        (baja ? Componentes.badge('Desvinculado', 'critico') : '') +
      '</div>' +
      (baja
        ? Componentes.alerta('Esta persona ya no está vigente. Su ficha se conserva como historial del SGC.', 'aviso')
        : '') +
      '<div class="sigso-tabs">' + tabs + '</div>' +
      '<div class="sgc-cuerpo">' + cuerpo + '</div>';

    cont.querySelector('.js-sgc-volver-personas').addEventListener('click', cargarPersonas_);
    cont.querySelectorAll('.js-sgc-ficha-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        pestanaFicha_ = btn.getAttribute('data-tab');
        pintarFicha_(cont, data);
      });
    });
    wireFicha_(cont, data);
  }

  function pintarDatosPersona_(data) {
    var p = data.persona;
    var acciones = puedeGestionar_
      ? '<div class="sgc-acciones">' +
          Componentes.boton({ texto: 'Editar datos', variante: 'secundario', clase: 'js-sgc-editar-persona' }) +
          (p.estado === 'DESVINCULADO'
            ? Componentes.boton({ texto: 'Reactivar', variante: 'secundario', clase: 'js-sgc-reactivar' })
            : Componentes.boton({ texto: 'Desvincular', variante: 'peligro', clase: 'js-sgc-desvincular' })) +
        '</div>'
      : '';
    return '<dl class="sgc-ficha">' +
      campoFicha_('Correo', p.usuario_email) +
      campoFicha_('RUT', p.rut) +
      campoFicha_('Cargo', p.cargo) +
      campoFicha_('Tipo', TIPO_PERSONA_ETIQUETA[p.tipo] || p.tipo) +
      campoFicha_('Área', p.area_id) +
      campoFicha_('Jefatura directa', p.jefatura_email) +
      campoFicha_('Subrogante', p.subrogante_email) +
      campoFicha_('Fecha de ingreso', p.fecha_ingreso ? fechaCorta_(p.fecha_ingreso) : '') +
      (p.estado === 'DESVINCULADO' ? campoFicha_('Desvinculación', fechaCorta_(p.fecha_desvinculacion)) : '') +
    '</dl>' + acciones;
  }

  function pintarDescriptor_(data) {
    var d = data.descriptor_vigente;
    var acciones = puedeGestionar_
      ? '<div class="sgc-acciones">' +
          Componentes.boton({ texto: d ? 'Nueva versión del descriptor' : '+ Crear descriptor', clase: 'js-sgc-descriptor' }) +
        '</div>'
      : '';
    if (!d) {
      return Componentes.vacio({
        texto: 'Esta persona todavía no tiene descriptor de cargo.',
        detalle: 'El descriptor (FO-PRO-02-01) define qué se espera del cargo: es la base para evaluar competencia.'
      }) + acciones;
    }
    var historial = (data.descriptores || []).length > 1
      ? '<h3 class="sgc-sub">Versiones anteriores</h3><div class="sgc-lista">' +
        (data.descriptores || []).filter(function (x) { return !(x.vigente === true || x.vigente === 'TRUE'); })
          .map(function (x) {
            return '<div class="sgc-version"><div class="sgc-doc__top">' +
              '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(x.version) + '</span>' +
              Componentes.badge('Archivada', 'neutro') +
              '<span class="sigso-ayuda">' + fechaCorta_(x.fecha) + '</span>' +
            '</div></div>';
          }).join('') + '</div>'
      : '';
    return '<div class="sgc-doc__top" style="margin-bottom:.8rem">' +
        '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(d.version) + '</span>' +
        Componentes.badge('Vigente', 'ok') +
        '<span class="sigso-ayuda">' + fechaCorta_(d.fecha) + '</span>' +
      '</div>' +
      '<dl class="sgc-ficha">' +
        campoFicha_('Objetivo del cargo', d.objetivo) +
        campoFicha_('Funciones', d.funciones) +
        campoFicha_('Responsabilidades', d.responsabilidades) +
        campoFicha_('Habilidades requeridas', d.habilidades) +
        campoFicha_('Nivel educacional', d.nivel_educacional) +
        campoFicha_('Formación técnica', d.formacion_tecnica) +
        campoFicha_('Experiencia requerida', d.experiencia) +
      '</dl>' +
      itemsDescriptorHtml_('Se califican en la evaluación (responsabilidades)', d.items_responsabilidades) +
      itemsDescriptorHtml_('Se califican en la evaluación (habilidades)', d.items_habilidades) +
      acciones + historial;
  }

  function itemsDescriptorHtml_(titulo, items) {
    if (!items || !items.length) return '';
    return '<h3 class="sgc-sub">' + Componentes.escaparHtml(titulo) + '</h3>' +
      '<ol class="sgc-porques">' + items.map(function (i) {
        return '<li>' + Componentes.escaparHtml(i) + '</li>';
      }).join('') + '</ol>';
  }

  function pintarDocsPersona_(data) {
    var docs = data.documentos || [];
    var acciones = puedeGestionar_
      ? '<div class="sgc-cabecera">' + Componentes.boton({ texto: '+ Cargar documento', clase: 'js-sgc-doc-persona' }) + '</div>'
      : '';
    if (docs.length === 0) {
      return acciones + Componentes.vacio({ texto: 'Sin documentos cargados.', detalle: 'CV, título, contrato, certificados.' });
    }
    return acciones + '<div class="sgc-lista">' + docs.map(function (x) {
      return '<div class="sgc-version">' +
        '<div class="sgc-doc__top">' +
          '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(x.nombre || x.archivo_nombre) + '</span>' +
          Componentes.badge(TIPO_DOC_PERSONA_ETIQUETA[x.tipo] || x.tipo, 'neutro') +
          '<span class="sigso-ayuda">' + fechaCorta_(x.fecha) + '</span>' +
        '</div>' +
        '<div class="sgc-acciones">' +
          Componentes.boton({ texto: '⬇ Descargar', variante: 'sutil', clase: 'js-sgc-bajar-doc', idx: x.doc_id }) +
          (puedeGestionar_ ? Componentes.boton({ texto: 'Quitar', variante: 'sutil', clase: 'js-sgc-quitar-doc', idx: x.doc_id }) : '') +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function pintarInduccion_(data) {
    var items = data.induccion || [];
    var completadas = items.filter(function (i) { return i.estado === 'COMPLETADA'; }).length;
    if (items.length === 0) return Componentes.vacio({ texto: 'Sin registro de inducción.' });
    return '<p class="sigso-ayuda">Inducción al SGC (FO-PRO-02-02): ' + completadas + ' de ' + items.length + ' completadas.</p>' +
      '<div class="sgc-lista">' + items.map(function (i) {
        var hecha = i.estado === 'COMPLETADA';
        return '<div class="sgc-version">' +
          '<div class="sgc-doc__top">' +
            '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(i.item) + '</span>' +
            (hecha ? Componentes.badge('Completada', 'ok') : Componentes.badge('Pendiente', 'alerta')) +
            (hecha && i.fecha ? '<span class="sigso-ayuda">' + fechaCorta_(i.fecha) + '</span>' : '') +
          '</div>' +
          (hecha && i.relator_email ? '<p class="sigso-ayuda">Relator: ' + Componentes.escaparHtml(i.relator_email) + '</p>' : '') +
          (data.puede_gestionar_induccion && !hecha
            ? Componentes.boton({ texto: '✓ Marcar completada', variante: 'sutil', clase: 'js-sgc-induccion', idx: i.induccion_id })
            : '') +
        '</div>';
      }).join('') + '</div>';
  }

  // --- competencias (Fase 2b) -------------------------------------------------

  function pintarCompetencias_(data) {
    var ultima = data.ultima_evaluacion;
    var acciones = data.puede_evaluar
      ? '<div class="sgc-acciones">' +
          Componentes.boton({ texto: ultima ? 'Nueva evaluación' : '+ Registrar evaluación', clase: 'js-sgc-evaluar' }) +
        '</div>'
      : '';

    // Horas de formación del año: es el Objetivo de Calidad N°4, y a la
    // persona le sirve verlo aunque no pueda evaluarse a sí misma.
    var cumple = data.horas_formacion_anio >= data.meta_horas_formacion;
    var horas = '<div class="sgc-acuse ' + (cumple ? 'sgc-acuse--hecho' : 'sgc-acuse--pendiente') + '">' +
      '<p><b>Formación este año: ' + data.horas_formacion_anio + ' de ' + data.meta_horas_formacion + ' horas.</b> ' +
      (cumple ? 'Cumple la meta anual.' : 'Bajo la meta del Objetivo de Calidad N°4.') + '</p>' +
    '</div>';

    if (!ultima) {
      return horas + Componentes.vacio({
        texto: 'Esta persona todavía no tiene evaluación de competencias.',
        detalle: 'La evaluación (FO-PRO-02-04) se hace cada 12 meses y la registra la jefatura directa.'
      }) + acciones;
    }

    var vencida = data.evaluacion_vencida;
    var historial = (data.evaluaciones || []).map(function (e) {
      var bajo = e.requiere_capacitacion === true || e.requiere_capacitacion === 'TRUE';
      return '<div class="sgc-version">' +
        '<div class="sgc-doc__top">' +
          '<span class="sgc-doc__codigo">Resp. ' + e.promedio_responsabilidades + ' · Hab. ' + e.promedio_habilidades + '</span>' +
          (bajo ? Componentes.badge('Requiere capacitación', 'alerta') : Componentes.badge('Conforme', 'ok')) +
          '<span class="sigso-ayuda">' + fechaCorta_(e.fecha) + '</span>' +
        '</div>' +
        '<p class="sigso-ayuda">Evaluó: ' + Componentes.escaparHtml(e.evaluador_email) +
          (e.proxima_evaluacion ? ' · próxima ' + fechaCorta_(e.proxima_evaluacion) : '') + '</p>' +
        (e.observaciones ? '<p>' + Componentes.escaparHtml(e.observaciones) + '</p>' : '') +
        (e.recomendado_por ? '<p class="sigso-ayuda">Recomienda capacitación: ' + Componentes.escaparHtml(e.recomendado_por) + '</p>' : '') +
      '</div>';
    }).join('');

    return horas +
      (vencida ? Componentes.alerta('La evaluación de competencias está vencida (se hace cada 12 meses).', 'aviso') : '') +
      acciones +
      '<h3 class="sgc-sub">Historial de evaluaciones</h3>' +
      '<div class="sgc-lista">' + historial + '</div>';
  }

  // v10.0 Tanda A: los items salen del descriptor VIGENTE de la persona
  // (FO-PRO-02-04 "segun descriptor de cargo"), no de una lista fija. Se
  // califican DOS bloques por separado -- responsabilidades y habilidades
  // -- cada uno con su propio promedio, como el formulario real.
  function abrirFormularioEvaluacion_(p, itemsResp, itemsHab, escala) {
    if (!itemsResp.length || !itemsHab.length) {
      Componentes.aviso({
        texto: 'Esta persona no tiene un descriptor de cargo con responsabilidades y habilidades cargadas como lista.',
        detalle: 'Completa esa parte del descriptor antes de evaluar.', tipo: 'error'
      });
      return;
    }
    var opciones = (escala || []).map(function (e) {
      return { valor: String(e.valor), texto: e.valor + ' — ' + e.texto };
    });
    function bloque(titulo, subtitulo, items, prefijo) {
      return '<h4 class="sgc-sub">' + Componentes.escaparHtml(titulo) + '</h4>' +
        '<p class="sigso-ayuda">' + Componentes.escaparHtml(subtitulo) + '</p>' +
        items.map(function (texto, i) {
          return Componentes.campoSelect({
            id: 'sgc-ev-' + prefijo + '-' + i, label: texto, valor: '3', placeholder: false, opciones: opciones
          });
        }).join('');
    }

    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Evaluación de competencias — ' + Componentes.escaparHtml(p.nombre) + '</h3>' +
        '<p class="sigso-ayuda">El promedio de cada bloque y la necesidad de capacitación los calcula el sistema.</p>' +
        '<form id="form-sgc-evaluacion">' +
          bloque('2.- Principales responsabilidades', 'Según el descriptor de cargo vigente.', itemsResp, 'r') +
          bloque('3.- Responsabilidades secundarias / habilidades', '', itemsHab, 'h') +
          Componentes.campoTextarea({ id: 'sgc-ev-obs', label: 'Observaciones' }) +
          Componentes.campoTexto({
            id: 'sgc-ev-recomendado', label: '¿Quién recomienda capacitación, si aplica? (opcional)'
          }) +
          Componentes.campoTexto({ id: 'sgc-ev-fecha', label: 'Fecha de la evaluación', tipo: 'date' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar evaluación', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-sgc-evaluacion').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var datos = {
        persona_id: p.persona_id,
        observaciones: document.getElementById('sgc-ev-obs').value,
        recomendado_por: document.getElementById('sgc-ev-recomendado').value,
        respuestas_responsabilidades: itemsResp.map(function (_, i) {
          return Number(document.getElementById('sgc-ev-r-' + i).value);
        }),
        respuestas_habilidades: itemsHab.map(function (_, i) {
          return Number(document.getElementById('sgc-ev-h-' + i).value);
        })
      };
      var fecha = document.getElementById('sgc-ev-fecha').value;
      if (fecha) datos.fecha = fecha;
      api_('registrarEvaluacionSgc', datos).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar la evaluación.', tipo: 'error' });
          return;
        }
        cerrar();
        if (respuesta.data.requiere_capacitacion) {
          Componentes.aviso({
            texto: 'Guardada. Promedios ' + respuesta.data.promedio_responsabilidades + ' / ' +
              respuesta.data.promedio_habilidades + ': se detectó necesidad de capacitación.',
            tipo: 'info'
          });
        }
        abrirPersona_(p.persona_id);
      });
    });
  }

  // --- capacitaciones (Fase 2b) -----------------------------------------------

  function cargarCapacitaciones_() {
    var cont = document.getElementById('calidad-contenido');
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando capacitaciones...');
    api_('listarCapacitacionesSgc', {}).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar el programa.', 'error');
        return;
      }
      puedeGestionar_ = respuesta.data.puede_gestionar === true;
      pintarCapacitaciones_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = Componentes.alerta('No se pudo conectar para cargar las capacitaciones.', 'error');
    });
  }

  function pintarCapacitaciones_(cont, data) {
    var caps = data.capacitaciones || [];
    var bajoMeta = (data.horas_por_persona || []).filter(function (h) { return !h.cumple_meta; });

    var cabecera = barraSecciones_() + '<div class="sgc-cabecera">' +
      '<p class="sigso-ayuda">Programa anual de capacitación y horas de formación por persona (Objetivo de Calidad N°4).</p>' +
      (puedeGestionar_ ? Componentes.boton({ texto: '+ Programar capacitación', clase: 'js-sgc-nueva-cap' }) : '') +
      '</div>';

    // Horas por persona: lo que de verdad importa del indicador es quién
    // está por debajo, así que eso va primero y con nombre.
    var panelHoras = (data.horas_por_persona || []).length
      ? '<h3 class="sgc-sub">Horas de formación ' + data.anio + '</h3>' +
        (bajoMeta.length
          ? Componentes.alerta(bajoMeta.length + ' persona(s) bajo la meta de 5 horas al año.', 'aviso')
          : Componentes.alerta('Todo el personal cumple la meta de 5 horas al año.', 'ok')) +
        '<div class="sgc-lista">' + (data.horas_por_persona || []).map(function (h) {
          return '<div class="sgc-version"><div class="sgc-doc__top">' +
            '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(h.nombre) + '</span>' +
            (h.cumple_meta ? Componentes.badge(h.horas + ' hrs', 'ok') : Componentes.badge(h.horas + ' hrs', 'alerta')) +
          '</div></div>';
        }).join('') + '</div>'
      : '';

    function wire() {
      wireSecciones_(cont);
      var nueva = cont.querySelector('.js-sgc-nueva-cap');
      if (nueva) nueva.addEventListener('click', function () { abrirFormularioCapacitacion_(null); });
      cont.querySelectorAll('.js-sgc-realizar').forEach(function (btn) {
        btn.addEventListener('click', function () {
          abrirFormularioRealizacion_(btn.getAttribute('data-idx'));
        });
      });
      cont.querySelectorAll('.js-sgc-eficacia').forEach(function (btn) {
        btn.addEventListener('click', function () {
          abrirFormularioEficacia_(
            btn.getAttribute('data-capacitacion'), btn.getAttribute('data-persona'), btn.getAttribute('data-nombre')
          );
        });
      });
    }

    if (caps.length === 0) {
      cont.innerHTML = cabecera + Componentes.vacio({
        texto: 'Todavía no hay capacitaciones registradas.',
        detalle: puedeGestionar_ ? 'Programa la primera del año.' : ''
      }) + panelHoras;
      wire();
      return;
    }

    var lista = caps.map(function (c) {
      var realizada = c.estado === 'REALIZADA';
      var asistieron = (c.asistentes || []).filter(function (a) { return a.asistio; });
      // v10.0 Tanda A: la eficacia (FO-PRO-02-05 §2) es POR PARTICIPANTE --
      // el mismo curso le puede servir a una persona y no a otra, asi que
      // cada asistente tiene su propio badge y su propio boton.
      var filasAsistentes = realizada && asistieron.length
        ? '<div class="sgc-lista sgc-lista--anidada">' + asistieron.map(function (a) {
            return '<div class="sgc-doc__top">' +
              '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(a.nombre) + '</span>' +
              (a.eficacia_resultado
                ? Componentes.badge(a.eficacia_resultado === 'EFICAZ' ? 'Eficaz' : 'No eficaz',
                    a.eficacia_resultado === 'EFICAZ' ? 'ok' : 'critico')
                : (a.eficacia_pendiente ? Componentes.badge('Eficacia pendiente', 'alerta') : Componentes.badge('Aún no toca (60 días)', 'neutro'))) +
              (puedeGestionar_ && !a.eficacia_resultado
                ? Componentes.boton({
                    texto: 'Evaluar', variante: 'sutil', clase: 'js-sgc-eficacia'
                  }).replace('<button ', '<button data-capacitacion="' + c.capacitacion_id +
                    '" data-persona="' + a.persona_id + '" data-nombre="' + Componentes.escaparHtml(a.nombre) + '" ')
                : '') +
            '</div>';
          }).join('') + '</div>'
        : '';
      return '<div class="sgc-version">' +
        '<div class="sgc-doc__top">' +
          '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(c.nombre) + '</span>' +
          Componentes.badge(realizada ? 'Realizada' : 'Programada', realizada ? 'ok' : 'neutro') +
          Componentes.badge(c.horas + ' hrs', 'neutro') +
          (c.eficacia_pendiente ? Componentes.badge('Eficacia pendiente', 'alerta') : '') +
        '</div>' +
        '<div class="sgc-doc__meta">' +
          (c.relator ? '<span>Relator: ' + Componentes.escaparHtml(c.relator) + '</span>' : '') +
          (realizada
            ? '<span>Realizada ' + fechaCorta_(c.fecha_realizada) + '</span>'
            : (c.fecha_programada ? '<span>Programada ' + fechaCorta_(c.fecha_programada) + '</span>' : '')) +
          (realizada ? '<span>' + c.total_asistieron + ' asistente(s)</span>' : '') +
        '</div>' +
        (c.descripcion ? '<p class="sigso-ayuda">' + Componentes.escaparHtml(c.descripcion) + '</p>' : '') +
        filasAsistentes +
        (puedeGestionar_ && !realizada
          ? '<div class="sgc-acciones">' +
              Componentes.boton({ texto: 'Registrar realización', variante: 'sutil', clase: 'js-sgc-realizar', idx: c.capacitacion_id }) +
            '</div>'
          : '') +
      '</div>';
    }).join('');

    cont.innerHTML = cabecera + '<div class="sgc-lista">' + lista + '</div>' + panelHoras;
    wire();
  }

  function abrirFormularioCapacitacion_() {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Programar capacitación</h3>' +
        '<form id="form-sgc-cap">' +
          Componentes.campoTexto({ id: 'sgc-c-nombre', label: 'Nombre del curso', requerido: true }) +
          Componentes.campoTextarea({ id: 'sgc-c-descripcion', label: 'Descripción' }) +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'sgc-c-horas', label: 'Horas', tipo: 'number', valor: '4', requerido: true }) +
            Componentes.campoTexto({ id: 'sgc-c-fecha', label: 'Fecha programada', tipo: 'date' }) +
          '</div>' +
          Componentes.campoTexto({ id: 'sgc-c-relator', label: 'Relator' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Programar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-sgc-cap').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('guardarCapacitacionSgc', {
        nombre: document.getElementById('sgc-c-nombre').value,
        descripcion: document.getElementById('sgc-c-descripcion').value,
        horas: Number(document.getElementById('sgc-c-horas').value),
        fecha_programada: document.getElementById('sgc-c-fecha').value,
        relator: document.getElementById('sgc-c-relator').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo programar.', tipo: 'error' });
          return;
        }
        cerrar();
        cargarCapacitaciones_();
      });
    });
  }

  // Registrar realización: se elige quién asistió de la lista de personal.
  function abrirFormularioRealizacion_(capacitacionId) {
    api_('listarPersonasSgc', {}).then(function (r) {
      var personas = (r && r.ok) ? (r.data.personas || []) : [];
      var fondo = document.createElement('div');
      fondo.className = 'sigso-modal-fondo';
      fondo.innerHTML =
        '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
          '<h3 class="sigso-modal__titulo">Registrar realización</h3>' +
          '<p class="sigso-ayuda">Marca quiénes asistieron. Las horas del año solo se suman a quienes asistieron.</p>' +
          '<form id="form-sgc-realizacion">' +
            Componentes.campoTexto({ id: 'sgc-r-fecha', label: 'Fecha de realización', tipo: 'date', requerido: true }) +
            Componentes.campoTexto({ id: 'sgc-r-relator', label: 'Relator' }) +
            '<div class="sigso-campo"><label>Asistentes</label>' +
              (personas.length
                ? personas.map(function (p) {
                    return '<label class="sigso-campo-check"><input type="checkbox" class="js-sgc-asistente" value="' +
                      p.persona_id + '"> ' + Componentes.escaparHtml(p.nombre) + '</label>';
                  }).join('')
                : '<p class="sigso-ayuda">No hay personal registrado todavía.</p>') +
            '</div>' +
            '<div class="sigso-modal__acciones">' +
              Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
              Componentes.boton({ texto: 'Registrar', tipo: 'submit' }) +
            '</div>' +
          '</form>' +
        '</div>';
      var cerrar = montarModal_(fondo);
      document.getElementById('form-sgc-realizacion').addEventListener('submit', function (evento) {
        evento.preventDefault();
        var asistentes = Array.prototype.slice.call(fondo.querySelectorAll('.js-sgc-asistente:checked'))
          .map(function (el) { return el.value; });
        api_('registrarRealizacionCapacitacionSgc', {
          capacitacion_id: capacitacionId,
          fecha_realizada: document.getElementById('sgc-r-fecha').value,
          relator: document.getElementById('sgc-r-relator').value,
          asistentes: asistentes
        }).then(function (respuesta) {
          if (!respuesta || !respuesta.ok) {
            Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo registrar.', tipo: 'error' });
            return;
          }
          cerrar();
          cargarCapacitaciones_();
        });
      });
    });
  }

  // v10.0 Tanda A: la eficacia es POR PARTICIPANTE (FO-PRO-02-05 §2) -- el
  // mismo curso puede servirle a una persona y no a otra.
  function abrirFormularioEficacia_(capacitacionId, personaId, nombre) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Evaluar eficacia — ' + Componentes.escaparHtml(nombre || '') + '</h3>' +
        '<p class="sigso-ayuda">A los 60 días de realizada: ¿le sirvió a esta persona?</p>' +
        '<form id="form-sgc-eficacia">' +
          Componentes.campoSelect({
            id: 'sgc-ef-resultado', label: 'Resultado', valor: 'EFICAZ', placeholder: false,
            opciones: [{ valor: 'EFICAZ', texto: 'Eficaz' }, { valor: 'NO_EFICAZ', texto: 'No eficaz' }]
          }) +
          Componentes.campoTextarea({
            id: 'sgc-ef-obs', label: 'Observaciones',
            ayuda: 'Obligatorio si no fue eficaz: es lo que justifica la siguiente acción.'
          }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-sgc-eficacia').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('registrarEficaciaCapacitacionSgc', {
        capacitacion_id: capacitacionId,
        persona_id: personaId,
        resultado: document.getElementById('sgc-ef-resultado').value,
        observaciones: document.getElementById('sgc-ef-obs').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        cargarCapacitaciones_();
      });
    });
  }

  function wireFicha_(cont, data) {
    var p = data.persona;

    var evaluar = cont.querySelector('.js-sgc-evaluar');
    if (evaluar) evaluar.addEventListener('click', function () {
      abrirFormularioEvaluacion_(p, data.items_responsabilidades, data.items_habilidades, data.escala_evaluacion);
    });

    var editar = cont.querySelector('.js-sgc-editar-persona');
    if (editar) editar.addEventListener('click', function () { abrirFormularioPersona_(p); });

    var desvincular = cont.querySelector('.js-sgc-desvincular');
    if (desvincular) desvincular.addEventListener('click', function () {
      Componentes.confirmar({
        titulo: 'Desvincular a ' + p.nombre,
        mensaje: 'Dejará de aparecer en el personal vigente. Su ficha e historial se conservan como evidencia del SGC.'
      }).then(function (ok) {
        if (!ok) return;
        api_('desvincularPersonaSgc', { persona_id: p.persona_id }).then(function (r) {
          if (!r || !r.ok) {
            Componentes.aviso({ texto: (r && r.message) || 'No se pudo desvincular.', tipo: 'error' });
            return;
          }
          abrirPersona_(p.persona_id);
        });
      });
    });

    var reactivar = cont.querySelector('.js-sgc-reactivar');
    if (reactivar) reactivar.addEventListener('click', function () {
      api_('desvincularPersonaSgc', { persona_id: p.persona_id, reactivar: true }).then(function () {
        abrirPersona_(p.persona_id);
      });
    });

    var descriptor = cont.querySelector('.js-sgc-descriptor');
    if (descriptor) descriptor.addEventListener('click', function () {
      abrirFormularioDescriptor_(p, data.descriptor_vigente);
    });

    var docPersona = cont.querySelector('.js-sgc-doc-persona');
    if (docPersona) docPersona.addEventListener('click', function () { abrirFormularioDocPersona_(p); });

    cont.querySelectorAll('.js-sgc-bajar-doc').forEach(function (btn) {
      btn.addEventListener('click', function () {
        api_('descargarDocumentoPersonaSgc', {
          persona_id: p.persona_id, doc_id: btn.getAttribute('data-idx')
        }).then(function (r) {
          if (!r || !r.ok) {
            Componentes.aviso({ texto: (r && r.message) || 'No se pudo descargar.', tipo: 'error' });
            return;
          }
          descargarBase64Sgc_(r.data.contenido_base64, r.data.nombre_archivo, r.data.mime);
        });
      });
    });

    cont.querySelectorAll('.js-sgc-quitar-doc').forEach(function (btn) {
      btn.addEventListener('click', function () {
        Componentes.confirmar({ titulo: 'Quitar documento', mensaje: '¿Confirmas quitarlo de la ficha?' }).then(function (ok) {
          if (!ok) return;
          api_('guardarDocumentoPersonaSgc', {
            persona_id: p.persona_id, accion: 'eliminar', doc_id: btn.getAttribute('data-idx')
          }).then(function () { abrirPersona_(p.persona_id); });
        });
      });
    });

    cont.querySelectorAll('.js-sgc-induccion').forEach(function (btn) {
      btn.addEventListener('click', function () {
        api_('registrarInduccionSgc', {
          persona_id: p.persona_id, induccion_id: btn.getAttribute('data-idx'), estado: 'COMPLETADA'
        }).then(function (r) {
          if (!r || !r.ok) {
            Componentes.aviso({ texto: (r && r.message) || 'No se pudo registrar.', tipo: 'error' });
            return;
          }
          abrirPersona_(p.persona_id);
        });
      });
    });
  }

  // --- formularios de personas -----------------------------------------------

  function abrirFormularioPersona_(p) {
    var esNueva = !p;
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">' + (esNueva ? 'Nueva persona' : 'Editar datos') + '</h3>' +
        '<form id="form-sgc-persona">' +
          Componentes.campoTexto({ id: 'sgc-pe-nombre', label: 'Nombre completo', valor: p && p.nombre, requerido: true }) +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'sgc-pe-email', label: 'Correo', tipo: 'email', valor: p && p.usuario_email, requerido: true }) +
            Componentes.campoTexto({ id: 'sgc-pe-rut', label: 'RUT', valor: p && p.rut }) +
          '</div>' +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'sgc-pe-cargo', label: 'Cargo según organigrama', valor: p && p.cargo }) +
            Componentes.campoSelect({
              id: 'sgc-pe-tipo', label: 'Tipo', valor: (p && p.tipo) || 'INT', placeholder: false,
              opciones: [{ valor: 'INT', texto: 'Interno' }, { valor: 'EXT', texto: 'Externo' }]
            }) +
          '</div>' +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'sgc-pe-area', label: 'Área', valor: p && p.area_id, placeholder: 'Ej: PREVENCION' }) +
            Componentes.campoTexto({ id: 'sgc-pe-ingreso', label: 'Fecha de ingreso', tipo: 'date', valor: fechaISO_(p && p.fecha_ingreso) }) +
          '</div>' +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'sgc-pe-jefatura', label: 'Jefatura directa (correo)', tipo: 'email', valor: p && p.jefatura_email }) +
            Componentes.campoTexto({ id: 'sgc-pe-subrogante', label: 'Subrogante (correo)', tipo: 'email', valor: p && p.subrogante_email }) +
          '</div>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: esNueva ? 'Crear ficha' : 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    // El correo enlaza la ficha con su cuenta y con todo su historial:
    // cambiarlo después partiría el registro en dos.
    if (!esNueva) document.getElementById('sgc-pe-email').readOnly = true;

    document.getElementById('form-sgc-persona').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var datos = {
        nombre: document.getElementById('sgc-pe-nombre').value,
        usuario_email: document.getElementById('sgc-pe-email').value,
        rut: document.getElementById('sgc-pe-rut').value,
        cargo: document.getElementById('sgc-pe-cargo').value,
        tipo: document.getElementById('sgc-pe-tipo').value,
        area_id: document.getElementById('sgc-pe-area').value,
        fecha_ingreso: document.getElementById('sgc-pe-ingreso').value,
        jefatura_email: document.getElementById('sgc-pe-jefatura').value,
        subrogante_email: document.getElementById('sgc-pe-subrogante').value
      };
      if (p) datos.persona_id = p.persona_id;
      api_('guardarPersonaSgc', datos).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        if (p) abrirPersona_(p.persona_id); else cargarPersonas_();
      });
    });
  }

  function abrirFormularioDescriptor_(p, vigente) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Descriptor de cargo — ' + Componentes.escaparHtml(p.nombre) + '</h3>' +
        (vigente
          ? '<p class="sigso-ayuda">La versión ' + Componentes.escaparHtml(vigente.version) +
            ' quedará archivada (no se elimina) y esta pasará a ser la vigente.</p>'
          : '') +
        '<form id="form-sgc-descriptor">' +
          Componentes.campoTexto({ id: 'sgc-de-version', label: 'Versión', requerido: true, valor: vigente ? '' : 'v01', placeholder: 'Ej: v01' }) +
          Componentes.campoTextarea({ id: 'sgc-de-objetivo', label: 'Objetivo general del cargo', requerido: true }) +
          Componentes.campoTextarea({ id: 'sgc-de-funciones', label: 'Funciones' }) +
          Componentes.campoTextarea({ id: 'sgc-de-responsabilidades', label: 'Responsabilidades (texto, tal como está en el documento)' }) +
          Componentes.campoTextarea({ id: 'sgc-de-habilidades', label: 'Habilidades requeridas (texto, tal como está en el documento)' }) +
          Componentes.campoTextarea({
            id: 'sgc-de-items-resp', label: 'Responsabilidades a evaluar (una por línea)',
            valor: (vigente && vigente.items_responsabilidades ? vigente.items_responsabilidades.join('\n') : ''),
            ayuda: 'La evaluación de competencias (FO-PRO-02-04) califica cada una por separado.'
          }) +
          Componentes.campoTextarea({
            id: 'sgc-de-items-hab', label: 'Habilidades a evaluar (una por línea)',
            valor: (vigente && vigente.items_habilidades ? vigente.items_habilidades.join('\n') : '')
          }) +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'sgc-de-nivel', label: 'Nivel educacional' }) +
            Componentes.campoTexto({ id: 'sgc-de-formacion', label: 'Formación técnica' }) +
          '</div>' +
          Componentes.campoTextarea({ id: 'sgc-de-experiencia', label: 'Experiencia laboral requerida' }) +
          '<div class="sigso-campo">' +
            '<label for="sgc-de-archivo">Archivo del descriptor (opcional)</label>' +
            '<input type="file" id="sgc-de-archivo" accept=".pdf,.doc,.docx,.xls,.xlsx">' +
          '</div>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar descriptor', tipo: 'submit', clase: 'js-sgc-guardar' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-sgc-descriptor').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var boton = fondo.querySelector('.js-sgc-guardar');
      boton.disabled = true; boton.textContent = 'Guardando...';
      var archivo = document.getElementById('sgc-de-archivo').files[0];

      function enviar(base64, nombreArchivo) {
        var datos = {
          persona_id: p.persona_id,
          version: document.getElementById('sgc-de-version').value,
          objetivo: document.getElementById('sgc-de-objetivo').value,
          funciones: document.getElementById('sgc-de-funciones').value,
          responsabilidades: document.getElementById('sgc-de-responsabilidades').value,
          habilidades: document.getElementById('sgc-de-habilidades').value,
          items_responsabilidades: lineasNoVacias_(document.getElementById('sgc-de-items-resp').value),
          items_habilidades: lineasNoVacias_(document.getElementById('sgc-de-items-hab').value),
          nivel_educacional: document.getElementById('sgc-de-nivel').value,
          formacion_tecnica: document.getElementById('sgc-de-formacion').value,
          experiencia: document.getElementById('sgc-de-experiencia').value
        };
        if (base64) { datos.contenido_base64 = base64; datos.nombre_archivo = nombreArchivo; }
        return api_('guardarDescriptorSgc', datos);
      }

      var promesa = archivo
        ? leerArchivoBase64Sgc_(archivo).then(function (b64) { return enviar(b64, archivo.name); })
        : enviar(null, null);

      promesa.then(function (respuesta) {
        boton.disabled = false; boton.textContent = 'Guardar descriptor';
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar el descriptor.', tipo: 'error' });
          return;
        }
        cerrar();
        abrirPersona_(p.persona_id);
      }).catch(function () {
        boton.disabled = false; boton.textContent = 'Guardar descriptor';
        Componentes.aviso({ texto: 'No se pudo guardar el descriptor.', tipo: 'error' });
      });
    });
  }

  function abrirFormularioDocPersona_(p) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Cargar documento — ' + Componentes.escaparHtml(p.nombre) + '</h3>' +
        '<form id="form-sgc-doc-persona">' +
          Componentes.campoSelect({
            id: 'sgc-dp-tipo', label: 'Tipo de documento', valor: 'CV', placeholder: false,
            opciones: Object.keys(TIPO_DOC_PERSONA_ETIQUETA).map(function (t) {
              return { valor: t, texto: TIPO_DOC_PERSONA_ETIQUETA[t] };
            })
          }) +
          Componentes.campoTexto({ id: 'sgc-dp-nombre', label: 'Nombre (opcional)' }) +
          '<div class="sigso-campo">' +
            '<label for="sgc-dp-archivo">Archivo (PDF, Word o Excel · máx. 10 MB)</label>' +
            '<input type="file" id="sgc-dp-archivo" accept=".pdf,.doc,.docx,.xls,.xlsx" required>' +
          '</div>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Cargar', tipo: 'submit', clase: 'js-sgc-guardar' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-sgc-doc-persona').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var archivo = document.getElementById('sgc-dp-archivo').files[0];
      if (!archivo) return;
      var boton = fondo.querySelector('.js-sgc-guardar');
      boton.disabled = true; boton.textContent = 'Subiendo...';

      leerArchivoBase64Sgc_(archivo).then(function (base64) {
        return api_('guardarDocumentoPersonaSgc', {
          persona_id: p.persona_id,
          tipo: document.getElementById('sgc-dp-tipo').value,
          nombre: document.getElementById('sgc-dp-nombre').value || archivo.name,
          nombre_archivo: archivo.name,
          contenido_base64: base64
        });
      }).then(function (respuesta) {
        boton.disabled = false; boton.textContent = 'Cargar';
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo cargar el documento.', tipo: 'error' });
          return;
        }
        cerrar();
        abrirPersona_(p.persona_id);
      }).catch(function () {
        boton.disabled = false; boton.textContent = 'Cargar';
        Componentes.aviso({ texto: 'No se pudo leer o subir el archivo.', tipo: 'error' });
      });
    });
  }

  // ==========================================================================
  // NO CONFORMIDADES (Fase 3a, PRO-06) — el motor de mejora
  //
  // La corrección y la acción correctiva NO se gestionan acá: son
  // ACTIVIDADES que el responsable ve en "Mi trabajo". Esta pantalla es
  // donde el Encargado SGC gobierna el ciclo, y muestra el estado real de
  // esas actividades sin duplicarlo.
  // ==========================================================================

  // Vocabulario alineado con el FO-PRO-06-01 real (marca con X entre
  // Auditoría / Revisión por la dirección / Reclamo / Otro). Se mantiene el
  // desglose interno/externo de auditoría porque distinguirlas es util y no
  // contradice el formulario -- ambas caen bajo "Auditoría".
  var FUENTE_NC_ETIQUETA = {
    AUDITORIA_INTERNA: 'Auditoría interna', AUDITORIA_EXTERNA: 'Auditoría externa',
    QUEJA: 'Queja / reclamo', REVISION_DIRECCION: 'Revisión por la dirección',
    PROCESO: 'Detectada en el proceso', OTRO: 'Otra'
  };
  var ESTADO_NC_ETIQUETA = {
    ABIERTA: 'Abierta', EN_CORRECCION: 'En corrección', EN_ACCION: 'En acción correctiva',
    EN_VERIFICACION: 'Verificando eficacia', CERRADA: 'Cerrada', ANULADA: 'Anulada'
  };

  // La tarea vinculada llega con el estado crudo de ACTIVIDADES; acá se
  // muestra en el idioma del resto del módulo.
  var ESTADO_TAREA_ETIQUETA = {
    NO_INICIADA: 'Sin empezar', EN_CURSO: 'En curso', BLOQUEADA: 'Bloqueada',
    EN_REVISION: 'En revisión', TERMINADA: 'Terminada', CANCELADA: 'Cancelada'
  };

  var filtroNcAbiertas_ = false;

  function cargarNc_() {
    ncActivaId_ = null;
    var cont = document.getElementById('calidad-contenido');
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando no conformidades...');
    api_('listarNcSgc', filtroNcAbiertas_ ? { abiertas: true } : {}).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar.', 'error');
        return;
      }
      puedeGestionar_ = respuesta.data.puede_gestionar === true;
      pintarNc_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = Componentes.alerta('No se pudo conectar para cargar las no conformidades.', 'error');
    });
  }

  function pintarNc_(cont, data) {
    var lista = data.no_conformidades || [];
    var ind = data.indicadores || {};

    var kpis = '<div class="sgc-kpis">' + [
      Componentes.kpi({ etiqueta: 'Abiertas', valor: ind.abiertas || 0 }),
      Componentes.kpi({ etiqueta: 'Con plazo vencido', valor: ind.vencidas || 0 }),
      Componentes.kpi({ etiqueta: 'Cerradas', valor: ind.cerradas || 0 }),
      Componentes.kpi({
        etiqueta: 'Días promedio',
        valor: ind.dias_promedio_resolucion === null || ind.dias_promedio_resolucion === undefined
          ? '—' : ind.dias_promedio_resolucion
      }),
      Componentes.kpi({
        etiqueta: '% eficacia',
        valor: ind.pct_eficacia_positiva === null || ind.pct_eficacia_positiva === undefined
          ? '—' : ind.pct_eficacia_positiva + '%'
      })
    ].join('') + '</div>';

    var cabecera = barraSecciones_() + '<div class="sgc-cabecera">' +
      '<p class="sigso-ayuda">Ciclo de mejora: corregir, entender por qué pasó, evitar que se repita y verificar que funcionó.</p>' +
      (puedeGestionar_ ? Componentes.boton({ texto: '+ Registrar no conformidad', clase: 'js-sgc-nueva-nc' }) : '') +
      '</div>' + kpis +
      '<div class="sgc-filtros">' +
        '<label class="sigso-campo-check"><input type="checkbox" id="sgc-nc-abiertas"' +
          (filtroNcAbiertas_ ? ' checked' : '') + '> Ver solo las abiertas</label>' +
      '</div>';

    function wire() {
      wireSecciones_(cont);
      var nueva = cont.querySelector('.js-sgc-nueva-nc');
      if (nueva) nueva.addEventListener('click', abrirFormularioNc_);
      var chk = cont.querySelector('#sgc-nc-abiertas');
      if (chk) chk.addEventListener('change', function () { filtroNcAbiertas_ = this.checked; cargarNc_(); });
      cont.querySelectorAll('.js-sgc-abrir-nc').forEach(function (btn) {
        btn.addEventListener('click', function () { abrirNc_(btn.getAttribute('data-id')); });
      });
    }

    if (lista.length === 0) {
      cont.innerHTML = cabecera + Componentes.vacio({
        texto: filtroNcAbiertas_ ? 'No hay no conformidades abiertas.' : 'Todavía no hay no conformidades registradas.',
        detalle: 'Se registran desde una auditoría, una queja, la revisión por la dirección o el día a día.'
      });
      wire();
      return;
    }

    var filas = lista.map(function (nc) {
      var cerrada = nc.estado === 'CERRADA' || nc.estado === 'ANULADA';
      return '<button type="button" class="sgc-doc js-sgc-abrir-nc' +
        (nc.vencida ? ' sgc-nc--vencida' : (cerrada ? ' sgc-doc--obsoleto' : '')) +
        '" data-id="' + nc.nc_id + '">' +
        '<div class="sgc-doc__top">' +
          '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(nc.correlativo) + '</span>' +
          '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(String(nc.descripcion).slice(0, 110)) + '</span>' +
          Componentes.badge(ESTADO_NC_ETIQUETA[nc.estado] || nc.estado, cerrada ? 'neutro' : 'info') +
          (nc.vencida ? Componentes.badge('Vencida', 'critico') : '') +
          (nc.ciclo > 1 ? Componentes.badge('Ciclo ' + nc.ciclo, 'alerta') : '') +
        '</div>' +
        '<div class="sgc-doc__meta">' +
          '<span>' + Componentes.escaparHtml(FUENTE_NC_ETIQUETA[nc.fuente] || nc.fuente) + '</span>' +
          (nc.referencia_normativa ? '<span>' + Componentes.escaparHtml(nc.referencia_normativa) + '</span>' : '') +
          (nc.area_id ? '<span>' + Componentes.escaparHtml(nc.area_id) + '</span>' : '') +
          '<span>' + Componentes.escaparHtml(nc.responsable_email) + '</span>' +
          '<span>Detectada ' + fechaCorta_(nc.fecha_deteccion) + '</span>' +
          (nc.etapa_actual
            ? '<span>' + Componentes.escaparHtml(nc.etapa_actual) +
              (nc.dias_para_plazo !== null
                ? (nc.dias_para_plazo < 0
                    ? ' · vencida hace ' + (-nc.dias_para_plazo) + ' d'
                    : ' · ' + nc.dias_para_plazo + ' d')
                : '') + '</span>'
            : '') +
        '</div>' +
      '</button>';
    }).join('');

    cont.innerHTML = cabecera + '<div class="sgc-lista">' + filas + '</div>';
    wire();
  }

  // --- ficha de la NC: el ciclo completo, en orden --------------------------

  function abrirNc_(id) {
    ncActivaId_ = id;
    var cont = document.getElementById('calidad-contenido');
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando no conformidad...');
    api_('getDetalleNcSgc', { nc_id: id }).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo abrir.', 'error');
        return;
      }
      puedeGestionar_ = respuesta.data.puede_gestionar === true;
      pintarFichaNc_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = Componentes.alerta('No se pudo conectar.', 'error');
    });
  }

  // Una etapa del ciclo. El orden importa y se muestra: no se puede definir
  // la acción correctiva antes de entender la causa.
  function etapaNc_(numero, titulo, hecho, cuerpo, acciones) {
    return '<div class="sgc-etapa' + (hecho ? ' sgc-etapa--hecha' : '') + '">' +
      '<div class="sgc-etapa__num">' + (hecho ? '✓' : numero) + '</div>' +
      '<div class="sgc-etapa__cuerpo">' +
        '<h3>' + Componentes.escaparHtml(titulo) + '</h3>' +
        cuerpo +
        (acciones || '') +
      '</div>' +
    '</div>';
  }

  function tareaVinculadaHtml_(tarea, etiqueta) {
    if (!tarea) return '';
    return '<div class="sgc-tarea-vinculada">' +
      '<p class="sigso-ayuda">' + Componentes.escaparHtml(etiqueta) + ' — asignada a <b>' +
        Componentes.escaparHtml(tarea.responsable_email) + '</b> en <b>Mi trabajo</b>' +
        (tarea.fecha_compromiso ? ', vence ' + fechaCorta_(tarea.fecha_compromiso) : '') + '</p>' +
      '<div class="sgc-doc__top">' +
        '<span class="sigso-badge sigso-mt-badge--' + tarea.semaforo + '">' +
          Componentes.escaparHtml(tarea.semaforo_etiqueta) + '</span>' +
        Componentes.badge(ESTADO_TAREA_ETIQUETA[tarea.estado] || tarea.estado,
          tarea.terminada ? 'ok' : 'neutro') +
        (tarea.avance_pct !== '' && tarea.avance_pct !== undefined && tarea.avance_pct !== null
          ? '<span class="sigso-ayuda">' + tarea.avance_pct + '% de avance</span>' : '') +
      '</div>' +
    '</div>';
  }

  function pintarFichaNc_(cont, data) {
    var nc = data.nc;
    var r = data.resumen;
    var puede = puedeGestionar_;
    var cerrada = nc.estado === 'CERRADA' || nc.estado === 'ANULADA';

    // 1) Corrección
    var e1 = etapaNc_(1, 'Corrección inmediata',
      !!nc.correccion_fecha_cierre,
      (nc.correccion_descripcion
        ? '<p>' + Componentes.escaparHtml(nc.correccion_descripcion) + '</p>' +
          tareaVinculadaHtml_(data.correccion_actividad, 'Corrección') +
          (nc.correccion_fecha_cierre
            ? '<p class="sigso-ayuda">Cerrada el ' + fechaCorta_(nc.correccion_fecha_cierre) + '.</p>' : '')
        : '<p class="sigso-ayuda">Qué se hace ahora para contener el problema. Plazo: ' +
          fechaCorta_(nc.correccion_plazo) + ' (10 días hábiles).</p>'),
      puede && !cerrada
        ? '<div class="sgc-acciones">' +
            (!nc.correccion_actividad_id
              ? Componentes.boton({ texto: 'Definir corrección', clase: 'js-nc-correccion' })
              : (!nc.correccion_fecha_cierre
                  ? Componentes.boton({ texto: '✓ Marcar corrección cerrada', variante: 'secundario', clase: 'js-nc-cerrar-correccion' })
                  : '')) +
          '</div>'
        : '');

    // 2) Causa raíz (5 por qué)
    var porques = [];
    for (var i = 1; i <= 5; i++) {
      if (nc['porque_' + i]) porques.push('<li>' + Componentes.escaparHtml(nc['porque_' + i]) + '</li>');
    }
    var e2 = etapaNc_(2, 'Análisis de causa (5 por qué)',
      r.tiene_causa,
      (r.tiene_causa
        ? (porques.length ? '<ol class="sgc-porques">' + porques.join('') + '</ol>' : '') +
          '<p><b>Causa raíz:</b> ' + Componentes.escaparHtml(nc.causa_raiz) + '</p>'
        : '<p class="sigso-ayuda">Por qué ocurrió realmente. Sin esto, la acción correctiva ataca el síntoma.</p>'),
      puede && !cerrada
        ? '<div class="sgc-acciones">' +
            Componentes.boton({
              texto: r.tiene_causa ? 'Editar análisis' : 'Registrar análisis',
              variante: r.tiene_causa ? 'secundario' : 'primario', clase: 'js-nc-causa'
            }) +
          '</div>'
        : '');

    // 3) Acción correctiva
    var e3 = etapaNc_(3, 'Acción correctiva',
      !!nc.accion_fecha_cierre,
      (nc.accion_descripcion
        ? '<p>' + Componentes.escaparHtml(nc.accion_descripcion) + '</p>' +
          tareaVinculadaHtml_(data.accion_actividad, 'Acción correctiva') +
          (nc.accion_fecha_cierre
            ? '<p class="sigso-ayuda">Implementada el ' + fechaCorta_(nc.accion_fecha_cierre) + '.</p>' : '')
        : '<p class="sigso-ayuda">Qué se cambia para que no vuelva a pasar. Plazo: 20 días hábiles desde la corrección.</p>'),
      puede && !cerrada && r.tiene_causa
        ? '<div class="sgc-acciones">' +
            (!nc.accion_actividad_id
              ? Componentes.boton({ texto: 'Definir acción correctiva', clase: 'js-nc-accion' })
              : (!nc.accion_fecha_cierre
                  ? Componentes.boton({ texto: '✓ Marcar acción implementada', variante: 'secundario', clase: 'js-nc-cerrar-accion' })
                  : '')) +
          '</div>'
        : '');

    // 4) Eficacia
    var e4 = etapaNc_(4, 'Verificación de eficacia',
      nc.eficacia_resultado === 'EFICAZ',
      (nc.eficacia_resultado
        ? '<p>' + (nc.eficacia_resultado === 'EFICAZ'
            ? Componentes.badge('Eficaz', 'ok') : Componentes.badge('No eficaz', 'critico')) +
          ' ' + Componentes.escaparHtml(nc.eficacia_observaciones || '') + '</p>' +
          // Tras un "no eficaz" la NC vuelve a la etapa 3: sin esta linea el
          // resultado del ciclo anterior se leeria como el estado de ahora.
          (r.ciclo > 1 && nc.estado !== 'CERRADA'
            ? '<p class="sigso-ayuda">Resultado del ciclo ' + (r.ciclo - 1) +
              '. La verificación se repetirá con la acción correctiva nueva.</p>'
            : '')
        : '<p class="sigso-ayuda">¿Funcionó? Se verifica 60 días hábiles después de implementarla' +
          (nc.eficacia_plazo ? ', desde el ' + fechaCorta_(nc.eficacia_plazo) : '') + '.</p>'),
      puede && nc.estado === 'EN_VERIFICACION'
        ? '<div class="sgc-acciones">' +
            Componentes.boton({ texto: 'Verificar eficacia', clase: 'js-nc-eficacia' }) +
          '</div>'
        : '');

    cont.innerHTML =
      '<div class="sgc-detalle-cab">' +
        Componentes.boton({ texto: '← No conformidades', variante: 'sutil', clase: 'js-nc-volver' }) +
        '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(nc.correlativo) + '</span>' +
        '<h1>' + Componentes.escaparHtml(String(nc.descripcion).slice(0, 90)) + '</h1>' +
        Componentes.badge(ESTADO_NC_ETIQUETA[nc.estado] || nc.estado, cerrada ? 'neutro' : 'info') +
        (r.vencida ? Componentes.badge('Plazo vencido', 'critico') : '') +
      '</div>' +
      (r.ciclo > 1
        ? Componentes.alerta('Esta es la vuelta ' + r.ciclo + ' del ciclo: la acción correctiva anterior no fue eficaz.', 'aviso')
        : '') +
      '<div class="sgc-cuerpo">' +
        '<dl class="sgc-ficha">' +
          campoFicha_('Fuente', FUENTE_NC_ETIQUETA[nc.fuente] || nc.fuente) +
          campoFicha_('Referencia normativa', nc.referencia_normativa) +
          campoFicha_('Área', nc.area_id) +
          campoFicha_('Responsable', nc.responsable_email) +
          campoFicha_('Detectada', fechaCorta_(nc.fecha_deteccion)) +
          campoFicha_('Detectada por', nc.detectada_por) +
          (nc.fecha_cierre
            ? campoFicha_(nc.estado === 'ANULADA' ? 'Anulada' : 'Cerrada', fechaCorta_(nc.fecha_cierre))
            : '') +
        '</dl>' +
        '<p>' + Componentes.escaparHtml(nc.descripcion) + '</p>' +
        '<div class="sgc-etapas">' + e1 + e2 + e3 + e4 + '</div>' +
        (puede && !cerrada
          ? '<div class="sgc-acciones">' +
              Componentes.boton({ texto: 'Anular', variante: 'peligro', clase: 'js-nc-anular' }) +
            '</div>'
          : '') +
      '</div>';

    cont.querySelector('.js-nc-volver').addEventListener('click', cargarNc_);
    wireFichaNc_(cont, nc);
  }

  function wireFichaNc_(cont, nc) {
    function accion_(selector, fn) {
      var b = cont.querySelector(selector);
      if (b) b.addEventListener('click', fn);
    }
    function enviar_(accion, datos, exito) {
      api_(accion, datos).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        if (exito) Componentes.aviso({ texto: exito, tipo: 'exito' });
        abrirNc_(nc.nc_id);
      });
    }

    accion_('.js-nc-correccion', function () { abrirFormularioAccionNc_(nc, 'CORRECCION'); });
    accion_('.js-nc-accion', function () { abrirFormularioAccionNc_(nc, 'ACCION'); });
    accion_('.js-nc-causa', function () { abrirFormularioCausaNc_(nc); });
    accion_('.js-nc-eficacia', function () { abrirFormularioEficaciaNc_(nc); });

    accion_('.js-nc-cerrar-correccion', function () {
      Componentes.confirmar({
        titulo: 'Cerrar la corrección',
        mensaje: '¿Confirmas que la corrección ya se realizó? Después viene el análisis de causa.'
      }).then(function (ok) {
        if (ok) enviar_('cerrarEtapaNcSgc', { nc_id: nc.nc_id, etapa: 'CORRECCION' });
      });
    });
    accion_('.js-nc-cerrar-accion', function () {
      Componentes.confirmar({
        titulo: 'Marcar acción implementada',
        mensaje: 'Arranca el plazo de 60 días hábiles para verificar si funcionó.'
      }).then(function (ok) {
        if (ok) enviar_('cerrarEtapaNcSgc', { nc_id: nc.nc_id, etapa: 'ACCION' });
      });
    });
    accion_('.js-nc-anular', function () {
      Componentes.prompt({
        titulo: 'Anular no conformidad',
        mensaje: '¿Por qué se anula? Queda registrado (la no conformidad no se borra).'
      }).then(function (motivo) {
        if (motivo && String(motivo).trim()) enviar_('anularNcSgc', { nc_id: nc.nc_id, motivo: motivo });
      });
    });
  }

  // --- formularios de NC -----------------------------------------------------

  function abrirFormularioNc_() {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Registrar no conformidad</h3>' +
        '<form id="form-nc">' +
          Componentes.campoTextarea({ id: 'nc-descripcion', label: 'Qué pasó', requerido: true,
            placeholder: 'Describe la desviación detectada, con hechos concretos.' }) +
          '<div class="sgc-form-fila">' +
            Componentes.campoSelect({
              id: 'nc-fuente', label: '¿De dónde salió?', valor: 'PROCESO', placeholder: false,
              opciones: Object.keys(FUENTE_NC_ETIQUETA).map(function (f) {
                return { valor: f, texto: FUENTE_NC_ETIQUETA[f] };
              })
            }) +
            Componentes.campoTexto({ id: 'nc-area', label: 'Área', placeholder: 'Ej: RRHH' }) +
          '</div>' +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'nc-responsable', label: 'Responsable', tipo: 'email', requerido: true,
              placeholder: 'A quién se le asigna resolverla' }) +
            Componentes.campoTexto({ id: 'nc-fecha', label: 'Fecha de detección', tipo: 'date' }) +
          '</div>' +
          Componentes.campoTexto({
            id: 'nc-referencia', label: 'Referencia normativa (opcional)',
            placeholder: 'Ej: 7.5, si ya sabes qué cláusula se incumplió'
          }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Registrar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-nc').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('crearNcSgc', {
        descripcion: document.getElementById('nc-descripcion').value,
        fuente: document.getElementById('nc-fuente').value,
        area_id: document.getElementById('nc-area').value,
        responsable_email: document.getElementById('nc-responsable').value,
        fecha_deteccion: document.getElementById('nc-fecha').value,
        referencia_normativa: document.getElementById('nc-referencia').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo registrar.', tipo: 'error' });
          return;
        }
        cerrar();
        cargarNc_();
      });
    });
  }

  // Corrección y acción correctiva comparten formulario: ambas crean una
  // ACTIVIDAD para el responsable, solo cambia el texto.
  function abrirFormularioAccionNc_(nc, tipo) {
    var esCorreccion = tipo === 'CORRECCION';
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">' + (esCorreccion ? 'Definir corrección' : 'Definir acción correctiva') + '</h3>' +
        '<p class="sigso-ayuda">' +
          (esCorreccion
            ? 'Qué se hace ahora para contener el problema.'
            : 'Qué se cambia para que la causa raíz no vuelva a producirlo.') +
          ' Se creará como una tarea en <b>Mi trabajo</b> del responsable.</p>' +
        '<form id="form-nc-accion">' +
          Componentes.campoTextarea({ id: 'nca-descripcion', label: 'Descripción', requerido: true }) +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'nca-responsable', label: 'Responsable', tipo: 'email',
              valor: nc.responsable_email }) +
            Componentes.campoTexto({ id: 'nca-fecha', label: 'Fecha comprometida', tipo: 'date',
              valor: fechaISO_(esCorreccion ? nc.correccion_plazo : '') }) +
          '</div>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Crear y asignar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-nc-accion').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var datos = {
        nc_id: nc.nc_id,
        descripcion: document.getElementById('nca-descripcion').value,
        responsable_email: document.getElementById('nca-responsable').value
      };
      var fecha = document.getElementById('nca-fecha').value;
      if (fecha) datos.fecha_compromiso = fecha;
      api_(esCorreccion ? 'registrarCorreccionNcSgc' : 'registrarAccionNcSgc', datos).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo crear.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({ texto: 'Creada y asignada. Le aparece en "Mi trabajo".', tipo: 'exito' });
        abrirNc_(nc.nc_id);
      });
    });
  }

  function abrirFormularioCausaNc_(nc) {
    var campos = '';
    for (var i = 1; i <= 5; i++) {
      campos += Componentes.campoTexto({
        id: 'ncc-porque-' + i, label: '¿Por qué? (' + i + ')', valor: nc['porque_' + i],
        requerido: i === 1,
        placeholder: i === 1 ? '¿Por qué ocurrió?' : '¿Y por qué pasó eso?'
      });
    }
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Análisis de causa — 5 por qué</h3>' +
        '<p class="sigso-ayuda">Encadena los porqués hasta llegar a algo que puedas cambiar. ' +
          'No siempre hacen falta los cinco.</p>' +
        '<form id="form-nc-causa">' +
          campos +
          Componentes.campoTextarea({ id: 'ncc-causa', label: 'Causa raíz', valor: nc.causa_raiz, requerido: true,
            placeholder: 'La causa real, la que hay que atacar.' }) +
          Componentes.campoTexto({
            id: 'ncc-referencia', label: 'Referencia normativa', valor: nc.referencia_normativa,
            placeholder: 'Ej: 7.5 — a veces solo queda clara después del análisis.'
          }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar análisis', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-nc-causa').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var datos = {
        nc_id: nc.nc_id, causa_raiz: document.getElementById('ncc-causa').value,
        referencia_normativa: document.getElementById('ncc-referencia').value
      };
      for (var j = 1; j <= 5; j++) datos['porque_' + j] = document.getElementById('ncc-porque-' + j).value;
      api_('registrarCausaNcSgc', datos).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        abrirNc_(nc.nc_id);
      });
    });
  }

  function abrirFormularioEficaciaNc_(nc) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Verificar eficacia</h3>' +
        '<p class="sigso-ayuda">¿La acción correctiva evitó que el problema se repitiera?</p>' +
        '<form id="form-nc-eficacia">' +
          Componentes.campoSelect({
            id: 'nce-resultado', label: 'Resultado', valor: 'EFICAZ', placeholder: false,
            opciones: [
              { valor: 'EFICAZ', texto: 'Eficaz — se cierra la no conformidad' },
              { valor: 'NO_EFICAZ', texto: 'No eficaz — se reabre con un ciclo nuevo' }
            ]
          }) +
          Componentes.campoTextarea({ id: 'nce-obs', label: 'Cómo lo verificaste', requerido: true,
            placeholder: 'Qué revisaste y qué encontraste. Es la evidencia de que se comprobó.' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-nc-eficacia').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var resultado = document.getElementById('nce-resultado').value;
      api_('verificarEficaciaNcSgc', {
        nc_id: nc.nc_id, resultado: resultado,
        observaciones: document.getElementById('nce-obs').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({
          texto: resultado === 'EFICAZ' ? 'No conformidad cerrada.' : 'Reabierta: hay que replantear la acción correctiva.',
          tipo: resultado === 'EFICAZ' ? 'exito' : 'info'
        });
        abrirNc_(nc.nc_id);
      });
    });
  }

  // ==========================================================================
  // AUDITORÍAS INTERNAS (Fase 3b, PRO-03) — cómo la empresa se encuentra
  // sus propios problemas.
  //
  // La pantalla sigue el ciclo del procedimiento: el programa anual arriba,
  // y dentro de cada auditoría el plan, la lista de verificación por
  // cláusula y el informe. El hallazgo de no conformidad se convierte en NC
  // con un botón: ahí es donde esta sección se conecta con la anterior.
  // ==========================================================================

  var ESTADO_AUD_ETIQUETA = {
    PROGRAMADA: 'Programada', PLANIFICADA: 'Planificada', EJECUTADA: 'Ejecutada',
    INFORMADA: 'Informada', CERRADA: 'Cerrada', ANULADA: 'Anulada'
  };
  var RESULTADO_HALLAZGO_ETIQUETA = {
    CONFORME: 'Conforme', OBSERVACION: 'Observación',
    NO_CONFORMIDAD: 'No conformidad', OPORTUNIDAD: 'Oportunidad de mejora'
  };
  var RESULTADO_HALLAZGO_TONO = {
    CONFORME: 'ok', OBSERVACION: 'alerta', NO_CONFORMIDAD: 'critico', OPORTUNIDAD: 'info'
  };

  var filtroAnioAud_ = '';
  var clausulasCatalogo_ = [];
  // v10.0 Tanda A: las 132 preguntas reales del FO-PRO-03-04, por clausula.
  // Solo viaja en el detalle (getDetalleAuditoriaSgc), no en el listado.
  var preguntasCatalogo_ = {};

  function cargarAuditorias_() {
    auditoriaActivaId_ = null;
    var cont = document.getElementById('calidad-contenido');
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando el programa de auditorías...');
    api_('listarAuditoriasSgc', filtroAnioAud_ ? { anio: filtroAnioAud_ } : {}).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar.', 'error');
        return;
      }
      puedeGestionar_ = respuesta.data.puede_gestionar === true;
      // La norma la define el backend (Auditorias.gs, CLAUSULAS_ISO9001):
      // la pantalla nunca guarda su propia copia.
      clausulasCatalogo_ = respuesta.data.clausulas_catalogo || [];
      pintarAuditorias_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = Componentes.alerta('No se pudo conectar para cargar las auditorías.', 'error');
    });
  }

  function pintarAuditorias_(cont, data) {
    var lista = data.auditorias || [];
    var ind = data.indicadores || {};

    var kpis = '<div class="sgc-kpis">' + [
      Componentes.kpi({ etiqueta: 'Programadas ' + new Date().getFullYear(), valor: ind.programadas || 0 }),
      Componentes.kpi({ etiqueta: 'Ejecutadas', valor: ind.ejecutadas || 0 }),
      Componentes.kpi({
        etiqueta: '% del programa',
        valor: ind.pct_cumplimiento === null || ind.pct_cumplimiento === undefined
          ? '—' : ind.pct_cumplimiento + '%'
      }),
      Componentes.kpi({ etiqueta: 'Informes atrasados', valor: ind.informes_vencidos || 0 }),
      Componentes.kpi({ etiqueta: 'NC por levantar', valor: ind.nc_pendientes || 0 }),
      Componentes.kpi({ etiqueta: 'Procesos sin auditar', valor: ind.procesos_sin_auditar || 0 })
    ].join('') + '</div>';

    var opciones = (data.anios || []).map(function (a) {
      return '<option value="' + a + '"' + (String(a) === String(filtroAnioAud_) ? ' selected' : '') + '>' + a + '</option>';
    }).join('');

    var cabecera = barraSecciones_() + '<div class="sgc-cabecera">' +
      '<p class="sigso-ayuda">El programa anual: qué proceso se audita, cuándo y quién lo audita. ' +
      'Nadie audita su propia área.</p>' +
      (puedeGestionar_ ? Componentes.boton({ texto: '+ Programar auditoría', clase: 'js-sgc-nueva-aud' }) : '') +
      '</div>' + kpis +
      '<div class="sgc-filtros">' +
        '<label class="sigso-campo"><span class="sigso-campo__label">Año</span>' +
        '<select id="sgc-aud-anio"><option value="">Todos</option>' + opciones + '</select></label>' +
      '</div>';

    function wire() {
      wireSecciones_(cont);
      var nueva = cont.querySelector('.js-sgc-nueva-aud');
      if (nueva) nueva.addEventListener('click', abrirFormularioAuditoria_);
      var sel = cont.querySelector('#sgc-aud-anio');
      if (sel) sel.addEventListener('change', function () { filtroAnioAud_ = this.value; cargarAuditorias_(); });
      cont.querySelectorAll('.js-sgc-abrir-aud').forEach(function (btn) {
        btn.addEventListener('click', function () { abrirAuditoria_(btn.getAttribute('data-id')); });
      });
    }

    if (lista.length === 0) {
      cont.innerHTML = cabecera + Componentes.vacio({
        texto: 'Todavía no hay auditorías en el programa.',
        detalle: 'El §9.2 de la norma pide auditar todos los procesos dentro del período.'
      });
      wire();
      return;
    }

    var filas = lista.map(function (a) {
      var cerrada = a.estado === 'CERRADA' || a.estado === 'ANULADA';
      return '<button type="button" class="sgc-doc js-sgc-abrir-aud' +
        (a.informe_vencido ? ' sgc-nc--vencida' : (cerrada ? ' sgc-doc--obsoleto' : '')) +
        '" data-id="' + a.auditoria_id + '">' +
        '<div class="sgc-doc__top">' +
          '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(a.correlativo) + '</span>' +
          '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(a.proceso) + '</span>' +
          Componentes.badge(ESTADO_AUD_ETIQUETA[a.estado] || a.estado, cerrada ? 'neutro' : 'info') +
          (a.informe_vencido ? Componentes.badge('Informe atrasado', 'critico') : '') +
          (a.nc_pendientes ? Componentes.badge(a.nc_pendientes + ' NC por levantar', 'alerta') : '') +
        '</div>' +
        '<div class="sgc-doc__meta">' +
          (a.area_id ? '<span>' + Componentes.escaparHtml(a.area_id) + '</span>' : '') +
          '<span>Auditor: ' + Componentes.escaparHtml(a.auditor_email) + '</span>' +
          '<span>' + (a.fecha_ejecucion
            ? 'Realizada ' + fechaCorta_(a.fecha_ejecucion)
            : 'Programada ' + fechaCorta_(a.fecha_programada)) + '</span>' +
          (a.verificaciones
            ? '<span>' + a.verificaciones + ' cláusula(s) verificada(s)</span>'
            : '<span>' + a.clausulas.length + ' cláusula(s) en alcance</span>') +
          (a.no_conformidades ? '<span>' + a.no_conformidades + ' no conformidad(es)</span>' : '') +
        '</div>' +
      '</button>';
    }).join('');

    cont.innerHTML = cabecera + '<div class="sgc-lista">' + filas + '</div>';
    wire();
  }

  // --- ficha de la auditoría --------------------------------------------------

  function abrirAuditoria_(id) {
    auditoriaActivaId_ = id;
    var cont = document.getElementById('calidad-contenido');
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando auditoría...');
    api_('getDetalleAuditoriaSgc', { auditoria_id: id }).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo abrir.', 'error');
        return;
      }
      clausulasCatalogo_ = respuesta.data.clausulas_catalogo || [];
      preguntasCatalogo_ = respuesta.data.preguntas_catalogo || {};
      puedeGestionar_ = respuesta.data.puede_gestionar === true;
      pintarFichaAuditoria_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = Componentes.alerta('No se pudo conectar.', 'error');
    });
  }

  function pintarFichaAuditoria_(cont, data) {
    var aud = data.auditoria;
    var r = data.resumen;
    var audita = data.puede_auditar === true;
    var gestiona = data.puede_gestionar === true;
    var cerrada = aud.estado === 'CERRADA' || aud.estado === 'ANULADA';
    var enCurso = aud.estado === 'PLANIFICADA' || aud.estado === 'EJECUTADA';

    // 1) Plan
    var planificada = aud.estado !== 'PROGRAMADA';
    var ant = r.anticipacion_plan;
    var e1 = etapaNc_(1, 'Plan de auditoría', planificada,
      (planificada
        ? '<dl class="sgc-ficha">' +
            campoFicha_('Objetivo', aud.objetivo) +
            campoFicha_('Alcance', aud.alcance) +
            campoFicha_('Criterios', aud.criterios) +
            campoFicha_('Se realiza', fechaCorta_(aud.fecha_ejecucion)) +
            campoFicha_('Auditados', (data.auditados || []).join(', ')) +
          '</dl>' +
          (ant
            ? '<p class="sigso-ayuda">Plan comunicado con ' + ant.dias_naturales + ' día(s) de anticipación' +
              (ant.suficiente ? '.' : ' — PRO-03 pide 5 días hábiles.') + '</p>'
            : '')
        : '<p class="sigso-ayuda">Objetivo, alcance, criterios y a quiénes se audita. Al guardarlo se les avisa.</p>'),
      audita && ['PROGRAMADA', 'PLANIFICADA'].indexOf(aud.estado) !== -1
        ? '<div class="sgc-acciones">' +
            Componentes.boton({
              texto: planificada ? 'Editar plan' : 'Definir plan',
              variante: planificada ? 'secundario' : 'primario', clase: 'js-aud-plan'
            }) +
          '</div>'
        : '');

    // 2) Lista de verificación
    var e2 = etapaNc_(2, 'Lista de verificación', r.verificaciones > 0,
      (r.verificaciones
        ? '<div class="sgc-conteos">' +
            Componentes.badge(r.conformes + ' conforme(s)', 'ok') +
            (r.observaciones ? Componentes.badge(r.observaciones + ' observación(es)', 'alerta') : '') +
            (r.no_conformidades ? Componentes.badge(r.no_conformidades + ' no conformidad(es)', 'critico') : '') +
            (r.oportunidades ? Componentes.badge(r.oportunidades + ' oportunidad(es)', 'info') : '') +
          '</div>' + tablaHallazgos_(data, audita, gestiona)
        : '<p class="sigso-ayuda">Cláusula por cláusula: qué se revisó, con qué evidencia y qué se encontró. ' +
          'Una cláusula conforme también se registra: es la evidencia de que se revisó.</p>'),
      audita && enCurso
        ? '<div class="sgc-acciones">' +
            Componentes.boton({ texto: '+ Verificar cláusula', clase: 'js-aud-hallazgo' }) +
            (aud.estado === 'PLANIFICADA' && r.verificaciones
              ? Componentes.boton({ texto: '✓ Terminar la auditoría', variante: 'secundario', clase: 'js-aud-ejecutada' })
              : '') +
          '</div>'
        : '');

    // 3) Informe
    var entrevistados = (aud.personas_entrevistadas || []);
    var resumenNc = data.informe_resumen_nc || [];
    var e3 = etapaNc_(3, 'Informe', !!aud.informe_fecha,
      (aud.informe_fecha
        ? '<p>' + Componentes.escaparHtml(aud.informe_conclusion) + '</p>' +
          '<p class="sigso-ayuda">Emitido el ' + fechaCorta_(aud.informe_fecha) + '.</p>' +
          (entrevistados.length
            ? '<p class="sigso-ayuda"><b>Personas entrevistadas:</b> ' +
              entrevistados.map(Componentes.escaparHtml).join(' · ') + '</p>'
            : '') +
          (resumenNc.length
            ? '<h4 class="sgc-sub">Resumen de no conformidades</h4>' +
              '<div class="sgc-hallazgos">' + resumenNc.map(function (n) {
                return '<div class="sgc-hallazgo sgc-hallazgo--no_conformidad">' +
                  '<div class="sgc-doc__top">' +
                    '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(n.nc_correlativo) + '</span>' +
                    '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(n.punto_normativo) + '</span>' +
                  '</div>' +
                  '<p>' + Componentes.escaparHtml(n.no_conformidad) + '</p>' +
                  (n.evidencia_objetiva ? '<p class="sigso-ayuda">Evidencia: ' + Componentes.escaparHtml(n.evidencia_objetiva) + '</p>' : '') +
                '</div>';
              }).join('') + '</div>'
            : '')
        : '<p class="sigso-ayuda">La conclusión de la auditoría. PRO-03 da 10 días hábiles desde que se realiza' +
          (aud.informe_plazo ? ', vence el ' + fechaCorta_(aud.informe_plazo) : '') + '.</p>'),
      audita && aud.estado === 'EJECUTADA'
        ? '<div class="sgc-acciones">' +
            Componentes.boton({ texto: 'Emitir informe', clase: 'js-aud-informe' }) +
          '</div>'
        : '');

    // 4) Cierre
    var e4 = etapaNc_(4, 'Cierre', aud.estado === 'CERRADA',
      (aud.estado === 'CERRADA'
        ? '<p class="sigso-ayuda">Cerrada el ' + fechaCorta_(aud.fecha_cierre) + '.</p>'
        : (r.nc_pendientes
            ? Componentes.alerta((r.nc_pendientes === 1
                ? 'Falta 1 no conformidad por levantar. '
                : 'Faltan ' + r.nc_pendientes + ' no conformidades por levantar. ') +
              'Una auditoría no se cierra dejando hallazgos sin canalizar.', 'aviso')
            : '<p class="sigso-ayuda">Se cierra cuando cada hallazgo de no conformidad ya tiene su NC.</p>')),
      gestiona && aud.estado === 'INFORMADA' && !r.nc_pendientes
        ? '<div class="sgc-acciones">' +
            Componentes.boton({ texto: 'Cerrar auditoría', clase: 'js-aud-cerrar' }) +
          '</div>'
        : '');

    cont.innerHTML =
      '<div class="sgc-detalle-cab">' +
        Componentes.boton({ texto: '← Auditorías', variante: 'sutil', clase: 'js-aud-volver' }) +
        '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(aud.correlativo) + '</span>' +
        '<h1>' + Componentes.escaparHtml(aud.proceso) + '</h1>' +
        Componentes.badge(ESTADO_AUD_ETIQUETA[aud.estado] || aud.estado, cerrada ? 'neutro' : 'info') +
        (r.informe_vencido ? Componentes.badge('Informe atrasado', 'critico') : '') +
      '</div>' +
      '<div class="sgc-cuerpo">' +
        '<dl class="sgc-ficha">' +
          campoFicha_('Área', aud.area_id) +
          campoFicha_('Auditor', aud.auditor_email) +
          campoFicha_('Equipo auditor', (aud.coauditores || []).join(', ')) +
          campoFicha_('Programada', fechaCorta_(aud.fecha_programada)) +
          campoFicha_('Cláusulas en alcance', (data.clausulas_alcance || []).join(' · ')) +
        '</dl>' +
        '<div class="sgc-etapas">' + e1 + e2 + e3 + e4 + '</div>' +
        (gestiona && !cerrada
          ? '<div class="sgc-acciones">' +
              Componentes.boton({ texto: 'Anular', variante: 'peligro', clase: 'js-aud-anular' }) +
            '</div>'
          : '') +
      '</div>';

    cont.querySelector('.js-aud-volver').addEventListener('click', cargarAuditorias_);
    wireFichaAuditoria_(cont, aud, data);
  }

  // La lista de verificación. Cada fila lleva su resultado y, si es una no
  // conformidad, el botón que la convierte en NC (o el enlace a la que ya
  // existe): ése es el eslabón que hace que la auditoría sirva de algo.
  function tablaHallazgos_(data, audita, gestiona) {
    var editable = ['PLANIFICADA', 'EJECUTADA'].indexOf(data.auditoria.estado) !== -1;
    return '<div class="sgc-hallazgos">' + (data.hallazgos || []).map(function (h) {
      return '<div class="sgc-hallazgo sgc-hallazgo--' + h.resultado.toLowerCase() + '">' +
        '<div class="sgc-doc__top">' +
          '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(h.clausula) + '</span>' +
          '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(h.clausula_titulo) + '</span>' +
          Componentes.badge(RESULTADO_HALLAZGO_ETIQUETA[h.resultado] || h.resultado,
            RESULTADO_HALLAZGO_TONO[h.resultado] || 'neutro') +
        '</div>' +
        '<p>' + Componentes.escaparHtml(h.aspecto_verificado) + '</p>' +
        (h.evidencia ? '<p class="sigso-ayuda">Evidencia: ' + Componentes.escaparHtml(h.evidencia) + '</p>' : '') +
        (h.descripcion ? '<p>' + Componentes.escaparHtml(h.descripcion) + '</p>' : '') +
        (h.nc_correlativo
          ? '<p class="sigso-ayuda">→ ' + Componentes.escaparHtml(h.nc_correlativo) + ' (' +
            Componentes.escaparHtml(ESTADO_NC_ETIQUETA[h.nc_estado] || h.nc_estado) + ')</p>'
          : '') +
        '<div class="sgc-acciones">' +
          (gestiona && !h.nc_id && ['NO_CONFORMIDAD', 'OBSERVACION'].indexOf(h.resultado) !== -1
            ? Componentes.boton({
                texto: 'Levantar no conformidad', clase: 'js-aud-a-nc',
                variante: h.resultado === 'NO_CONFORMIDAD' ? 'primario' : 'secundario'
              }).replace('<button ', '<button data-hallazgo="' + h.hallazgo_id + '" ')
            : '') +
          (audita && editable && !h.nc_id
            ? Componentes.boton({ texto: 'Editar', variante: 'sutil', clase: 'js-aud-editar-h' })
                .replace('<button ', '<button data-hallazgo="' + h.hallazgo_id + '" ') +
              Componentes.boton({ texto: 'Quitar', variante: 'sutil', clase: 'js-aud-quitar-h' })
                .replace('<button ', '<button data-hallazgo="' + h.hallazgo_id + '" ')
            : '') +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function wireFichaAuditoria_(cont, aud, data) {
    function accion_(selector, fn) {
      var b = cont.querySelector(selector);
      if (b) b.addEventListener('click', fn);
    }
    function enviar_(accion, datos, exito) {
      api_(accion, datos).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        if (exito) Componentes.aviso({ texto: exito, tipo: 'exito' });
        abrirAuditoria_(aud.auditoria_id);
      });
    }

    accion_('.js-aud-plan', function () { abrirFormularioPlanAud_(aud, data); });
    accion_('.js-aud-hallazgo', function () { abrirFormularioHallazgo_(aud, data, null); });
    accion_('.js-aud-informe', function () { abrirFormularioInformeAud_(aud); });

    accion_('.js-aud-ejecutada', function () {
      Componentes.confirmar({
        titulo: 'Terminar la auditoría',
        mensaje: 'Después de esto la lista de verificación sigue editable, pero arranca el plazo de 10 días hábiles para el informe.'
      }).then(function (ok) {
        if (ok) enviar_('cerrarEjecucionAuditoriaSgc', { auditoria_id: aud.auditoria_id });
      });
    });
    accion_('.js-aud-cerrar', function () {
      Componentes.confirmar({
        titulo: 'Cerrar la auditoría',
        mensaje: 'Todos los hallazgos ya están canalizados. La auditoría queda como evidencia cerrada.'
      }).then(function (ok) {
        if (ok) enviar_('cerrarAuditoriaSgc', { auditoria_id: aud.auditoria_id }, 'Auditoría cerrada.');
      });
    });
    accion_('.js-aud-anular', function () {
      Componentes.prompt({
        titulo: 'Anular auditoría',
        mensaje: '¿Por qué se anula? Queda registrado (la auditoría no se borra).'
      }).then(function (motivo) {
        if (motivo && String(motivo).trim()) {
          enviar_('anularAuditoriaSgc', { auditoria_id: aud.auditoria_id, motivo: motivo });
        }
      });
    });

    cont.querySelectorAll('.js-aud-a-nc').forEach(function (btn) {
      btn.addEventListener('click', function () {
        Componentes.confirmar({
          titulo: 'Levantar no conformidad',
          mensaje: 'Se crea la no conformidad con este hallazgo como origen, y de ahí sale la acción correctiva.'
        }).then(function (ok) {
          if (ok) {
            enviar_('convertirHallazgoEnNcSgc', { hallazgo_id: btn.getAttribute('data-hallazgo') },
              'No conformidad creada desde el hallazgo.');
          }
        });
      });
    });
    cont.querySelectorAll('.js-aud-editar-h').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-hallazgo');
        var h = (data.hallazgos || []).filter(function (x) { return x.hallazgo_id === id; })[0];
        abrirFormularioHallazgo_(aud, data, h);
      });
    });
    cont.querySelectorAll('.js-aud-quitar-h').forEach(function (btn) {
      btn.addEventListener('click', function () {
        Componentes.confirmar({
          titulo: 'Quitar de la lista',
          mensaje: 'Se saca de la lista de verificación. Queda en el registro del sistema.',
          peligro: true
        }).then(function (ok) {
          if (ok) enviar_('eliminarHallazgoSgc', { hallazgo_id: btn.getAttribute('data-hallazgo') });
        });
      });
    });
  }

  // --- formularios de auditoría -----------------------------------------------

  function selectorClausulas_(seleccionadas) {
    var marcadas = seleccionadas || [];
    return '<fieldset class="sgc-clausulas"><legend>Cláusulas de la norma a auditar</legend>' +
      clausulasCatalogo_.map(function (c) {
        return '<label class="sigso-campo-check"><input type="checkbox" class="js-aud-clausula" value="' +
          c.codigo + '"' + (marcadas.indexOf(c.codigo) !== -1 ? ' checked' : '') + '> <b>' +
          Componentes.escaparHtml(c.codigo) + '</b> ' + Componentes.escaparHtml(c.titulo) + '</label>';
      }).join('') + '</fieldset>';
  }

  function clausulasMarcadas_() {
    return Array.prototype.slice.call(document.querySelectorAll('.js-aud-clausula:checked'))
      .map(function (c) { return c.value; });
  }

  function abrirFormularioAuditoria_() {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Programar auditoría interna</h3>' +
        '<form id="form-aud">' +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'aud-proceso', label: 'Proceso a auditar', requerido: true,
              placeholder: 'Ej: Gestión de personas' }) +
            Componentes.campoTexto({ id: 'aud-area', label: 'Área', placeholder: 'Ej: RRHH' }) +
          '</div>' +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'aud-auditor', label: 'Auditor', tipo: 'email', requerido: true,
              placeholder: 'De otra área: nadie audita su propio trabajo' }) +
            Componentes.campoTexto({ id: 'aud-fecha', label: 'Fecha planeada', tipo: 'date', requerido: true }) +
          '</div>' +
          selectorClausulas_([]) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Programar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-aud').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var clausulas = clausulasMarcadas_();
      if (!clausulas.length) {
        Componentes.aviso({ texto: 'Elige al menos una cláusula a auditar.', tipo: 'error' });
        return;
      }
      api_('programarAuditoriaSgc', {
        proceso: document.getElementById('aud-proceso').value,
        area_id: document.getElementById('aud-area').value,
        auditor_email: document.getElementById('aud-auditor').value,
        fecha_programada: document.getElementById('aud-fecha').value,
        clausulas: clausulas
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo programar.', tipo: 'error' });
          return;
        }
        cerrar();
        cargarAuditorias_();
      });
    });
  }

  function abrirFormularioPlanAud_(aud, data) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Plan de auditoría</h3>' +
        '<p class="sigso-ayuda">Al guardarlo se le avisa a las personas auditadas. ' +
        'PRO-03 pide comunicarlo con 5 días hábiles de anticipación.</p>' +
        '<form id="form-aud-plan">' +
          Componentes.campoTextarea({ id: 'audp-objetivo', label: 'Objetivo', valor: aud.objetivo, requerido: true,
            placeholder: '¿Qué se quiere comprobar con esta auditoría?' }) +
          Componentes.campoTextarea({ id: 'audp-alcance', label: 'Alcance', valor: aud.alcance, requerido: true,
            placeholder: 'Qué queda dentro y qué no: período, sedes, registros.' }) +
          Componentes.campoTexto({ id: 'audp-criterios', label: 'Criterios', valor: aud.criterios,
            placeholder: 'Ej: ISO 9001:2015, PRO-02' }) +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'audp-auditados', label: 'Auditados (correos separados por coma)',
              valor: (data.auditados || []).join(', ') }) +
            Componentes.campoTexto({ id: 'audp-fecha', label: 'Fecha de realización', tipo: 'date',
              valor: fechaISO_(aud.fecha_ejecucion), requerido: true }) +
          '</div>' +
          Componentes.campoTexto({
            id: 'audp-coauditores', label: 'Resto del equipo auditor (correos separados por coma, opcional)',
            valor: (data.auditoria && data.auditoria.coauditores || []).join(', '),
            placeholder: 'El auditor líder ya está definido; aquí va el resto del equipo.'
          }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar y comunicar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-aud-plan').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var auditados = document.getElementById('audp-auditados').value
        .split(',').map(function (e) { return e.trim(); }).filter(Boolean);
      var coauditores = document.getElementById('audp-coauditores').value
        .split(',').map(function (e) { return e.trim(); }).filter(Boolean);
      api_('planificarAuditoriaSgc', {
        auditoria_id: aud.auditoria_id,
        objetivo: document.getElementById('audp-objetivo').value,
        alcance: document.getElementById('audp-alcance').value,
        criterios: document.getElementById('audp-criterios').value,
        auditados: auditados,
        coauditores: coauditores,
        fecha_ejecucion: document.getElementById('audp-fecha').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar el plan.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({ texto: 'Plan guardado y comunicado a los auditados.', tipo: 'exito' });
        abrirAuditoria_(aud.auditoria_id);
      });
    });
  }

  function abrirFormularioHallazgo_(aud, data, hallazgo) {
    var enAlcance = data.clausulas_alcance || [];
    // Se ofrecen primero las cláusulas del alcance, pero no se limita a
    // ellas: una auditoría puede encontrar algo fuera de lo planeado, y eso
    // no se puede perder.
    var opciones = clausulasCatalogo_.map(function (c) {
      return {
        valor: c.codigo,
        texto: c.codigo + ' — ' + c.titulo + (enAlcance.indexOf(c.codigo) === -1 ? ' (fuera del alcance)' : '')
      };
    });
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">' + (hallazgo ? 'Editar verificación' : 'Verificar cláusula') + '</h3>' +
        '<form id="form-aud-h">' +
          '<div class="sgc-form-fila">' +
            Componentes.campoSelect({ id: 'audh-clausula', label: 'Cláusula', placeholder: false,
              valor: hallazgo ? hallazgo.clausula : (enAlcance[0] || ''), opciones: opciones }) +
            Componentes.campoSelect({ id: 'audh-resultado', label: 'Resultado', placeholder: false,
              valor: hallazgo ? hallazgo.resultado : 'CONFORME',
              opciones: Object.keys(RESULTADO_HALLAZGO_ETIQUETA).map(function (k) {
                return { valor: k, texto: RESULTADO_HALLAZGO_ETIQUETA[k] };
              }) }) +
          '</div>' +
          '<div class="sigso-campo" id="audh-preguntas-cont"></div>' +
          Componentes.campoTextarea({ id: 'audh-aspecto', label: 'Qué se verificó', requerido: true,
            valor: hallazgo ? hallazgo.aspecto_verificado : '',
            placeholder: 'Ej: evaluaciones de competencia del personal del área.' }) +
          Componentes.campoTextarea({ id: 'audh-evidencia', label: 'Evidencia revisada',
            valor: hallazgo ? hallazgo.evidencia : '',
            placeholder: 'Qué documentos o registros se miraron, y cuántos.' }) +
          Componentes.campoTextarea({ id: 'audh-descripcion', label: 'Hallazgo',
            valor: hallazgo ? hallazgo.descripcion : '',
            placeholder: 'Obligatorio si no es conforme: es lo que después se convierte en no conformidad.' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    // Al elegir la cláusula, se ofrecen las preguntas reales del FO-PRO-03-04
    // como sugerencia -- elegir una copia su texto al campo "Qué se
    // verificó" (editable después). Si la cláusula no tiene preguntas en el
    // catálogo (ej. 4.4), el selector simplemente no aparece.
    function repoblarPreguntas_() {
      var clausula = document.getElementById('audh-clausula').value;
      var preguntas = preguntasCatalogo_[clausula] || [];
      var elCont = document.getElementById('audh-preguntas-cont');
      if (!preguntas.length) { elCont.innerHTML = ''; return; }
      elCont.innerHTML = Componentes.campoSelect({
        id: 'audh-pregunta', label: 'Elegir de la lista de verificación (opcional)',
        opciones: preguntas.map(function (p) { return { valor: p, texto: p.length > 90 ? p.slice(0, 90) + '…' : p }; })
      });
      document.getElementById('audh-pregunta').addEventListener('change', function () {
        if (this.value) document.getElementById('audh-aspecto').value = this.value;
      });
    }
    document.getElementById('audh-clausula').addEventListener('change', repoblarPreguntas_);
    repoblarPreguntas_();

    document.getElementById('form-aud-h').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var datos = {
        auditoria_id: aud.auditoria_id,
        clausula: document.getElementById('audh-clausula').value,
        resultado: document.getElementById('audh-resultado').value,
        aspecto_verificado: document.getElementById('audh-aspecto').value,
        evidencia: document.getElementById('audh-evidencia').value,
        descripcion: document.getElementById('audh-descripcion').value
      };
      if (hallazgo) datos.hallazgo_id = hallazgo.hallazgo_id;
      api_('registrarHallazgoSgc', datos).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        abrirAuditoria_(aud.auditoria_id);
      });
    });
  }

  function abrirFormularioInformeAud_(aud) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Informe de auditoría</h3>' +
        '<p class="sigso-ayuda">La conclusión sobre el proceso auditado. Al emitirlo se avisa a los auditados ' +
        'y al Encargado SGC, y la lista de verificación queda cerrada.</p>' +
        '<form id="form-aud-inf">' +
          Componentes.campoTextarea({ id: 'audi-conclusion', label: 'Conclusión', requerido: true,
            placeholder: '¿El proceso cumple los requisitos? ¿Qué es lo más relevante que se encontró?' }) +
          Componentes.campoTextarea({
            id: 'audi-entrevistados', label: 'Personas entrevistadas (una por línea: "Nombre - Cargo")',
            placeholder: 'Lisseth Vilchez - Encargada de Administración'
          }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Emitir informe', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-aud-inf').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('emitirInformeAuditoriaSgc', {
        auditoria_id: aud.auditoria_id,
        conclusion: document.getElementById('audi-conclusion').value,
        personas_entrevistadas: lineasNoVacias_(document.getElementById('audi-entrevistados').value)
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo emitir.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({ texto: 'Informe emitido.', tipo: 'exito' });
        abrirAuditoria_(aud.auditoria_id);
      });
    });
  }

  // ==========================================================================
  // QUEJAS, FELICITACIONES Y CONSULTAS (Fase 4, PRO-07) — la Parte 1 la
  // llena el cliente sin cuenta desde frontend/quejas.html; esta sección
  // gestiona las Partes 2 a 5: registro interno, investigación (con la
  // misma imparcialidad que la auditoría interna), resolución, notificación
  // y seguimiento.
  // ==========================================================================

  var TIPO_QUEJA_ETIQUETA = { QUEJA: 'Queja', RECLAMACION: 'Reclamación', FELICITACION: 'Felicitación', CONSULTA: 'Consulta' };
  var TIPO_QUEJA_TONO = { QUEJA: 'critico', RECLAMACION: 'critico', FELICITACION: 'ok', CONSULTA: 'info' };
  var ESTADO_QUEJA_ETIQUETA = {
    RECIBIDA: 'Recibida', NO_PROCEDE: 'No procede', EN_INVESTIGACION: 'En investigación',
    NO_VALIDA: 'No válida', EN_RESOLUCION: 'En resolución', RESUELTA: 'Resuelta',
    NOTIFICADA: 'Notificada', CERRADA: 'Cerrada', REABIERTA: 'Reabierta', ANULADA: 'Anulada'
  };
  var AREA_QUEJA_ETIQUETA = {
    RRHH: 'RRHH', CONTABILIDAD: 'Contabilidad', PREVENCION: 'Prevención de Riesgos',
    MARKETING: 'Marketing', ADMINISTRACION: 'Administración', OTRO: 'Otro'
  };

  var filtroQuejasAbiertas_ = false;

  function cargarQuejas_() {
    quejaActivaId_ = null;
    var cont = document.getElementById('calidad-contenido');
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando quejas...');
    api_('listarQuejasSgc', filtroQuejasAbiertas_ ? { abiertas: true } : {}).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar.', 'error');
        return;
      }
      puedeGestionar_ = respuesta.data.puede_gestionar === true;
      pintarQuejas_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = Componentes.alerta('No se pudo conectar para cargar las quejas.', 'error');
    });
  }

  function pintarQuejas_(cont, data) {
    var lista = data.quejas || [];
    var ind = data.indicadores || {};

    var kpis = '<div class="sgc-kpis">' + [
      Componentes.kpi({ etiqueta: 'Este año', valor: ind.total_anio || 0 }),
      Componentes.kpi({ etiqueta: 'Quejas/reclamos', valor: ind.quejas_anio || 0 }),
      Componentes.kpi({ etiqueta: 'Felicitaciones', valor: ind.felicitaciones_anio || 0 }),
      Componentes.kpi({ etiqueta: 'Consultas', valor: ind.consultas_anio || 0 }),
      Componentes.kpi({ etiqueta: 'Abiertas', valor: ind.abiertas || 0 }),
      Componentes.kpi({ etiqueta: 'Con plazo vencido', valor: ind.vencidas || 0 })
    ].join('') + '</div>';

    var cabecera = barraSecciones_() + '<div class="sgc-cabecera">' +
      '<p class="sigso-ayuda">Formulario público en <code>quejas.html</code>. El plazo de respuesta ' +
      'es de 30 días corridos desde que se valida la queja.</p>' +
      '</div>' + kpis +
      '<div class="sgc-filtros">' +
        '<label class="sigso-campo-check"><input type="checkbox" id="sgc-q-abiertas"' +
          (filtroQuejasAbiertas_ ? ' checked' : '') + '> Ver solo las abiertas</label>' +
      '</div>';

    function wire() {
      wireSecciones_(cont);
      var chk = cont.querySelector('#sgc-q-abiertas');
      if (chk) chk.addEventListener('change', function () { filtroQuejasAbiertas_ = this.checked; cargarQuejas_(); });
      cont.querySelectorAll('.js-sgc-abrir-queja').forEach(function (btn) {
        btn.addEventListener('click', function () { abrirQueja_(btn.getAttribute('data-id')); });
      });
    }

    if (lista.length === 0) {
      cont.innerHTML = cabecera + Componentes.vacio({
        texto: filtroQuejasAbiertas_ ? 'No hay quejas abiertas.' : 'Todavía no hay quejas, felicitaciones ni consultas registradas.',
        detalle: 'Llegan solas desde el formulario público del sitio.'
      });
      wire();
      return;
    }

    var filas = lista.map(function (q) {
      var cerrada = ['CERRADA', 'NO_PROCEDE', 'NO_VALIDA', 'ANULADA'].indexOf(q.estado) !== -1;
      return '<button type="button" class="sgc-doc js-sgc-abrir-queja' +
        (q.vencida ? ' sgc-nc--vencida' : (cerrada ? ' sgc-doc--obsoleto' : '')) +
        '" data-id="' + q.queja_id + '">' +
        '<div class="sgc-doc__top">' +
          '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(q.correlativo) + '</span>' +
          '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(q.nombre_completo) +
            (q.empresa ? ' (' + Componentes.escaparHtml(q.empresa) + ')' : '') + '</span>' +
          Componentes.badge(TIPO_QUEJA_ETIQUETA[q.tipo] || q.tipo, TIPO_QUEJA_TONO[q.tipo] || 'neutro') +
          Componentes.badge(ESTADO_QUEJA_ETIQUETA[q.estado] || q.estado, cerrada ? 'neutro' : 'info') +
          (q.vencida ? Componentes.badge('Vencida', 'critico') : '') +
          (q.tiene_nc ? Componentes.badge('Con NC', 'alerta') : '') +
        '</div>' +
        '<div class="sgc-doc__meta">' +
          '<span>' + Componentes.escaparHtml(AREA_QUEJA_ETIQUETA[q.area] || q.area) + '</span>' +
          '<span>Recibida ' + fechaCorta_(q.fecha_envio) + '</span>' +
          (q.investigador_email ? '<span>Investiga: ' + Componentes.escaparHtml(q.investigador_email) + '</span>' : '') +
          (q.etapa_actual
            ? '<span>' + Componentes.escaparHtml(q.etapa_actual) +
              (q.dias_para_plazo !== null
                ? (q.dias_para_plazo < 0 ? ' · vencida hace ' + (-q.dias_para_plazo) + ' d' : ' · ' + q.dias_para_plazo + ' d')
                : '') + '</span>'
            : '') +
        '</div>' +
        '<p class="sigso-ayuda">' + Componentes.escaparHtml(String(q.descripcion).slice(0, 140)) + '</p>' +
      '</button>';
    }).join('');

    cont.innerHTML = cabecera + '<div class="sgc-lista">' + filas + '</div>';
    wire();
  }

  // --- ficha de la queja: las cinco partes del FO-PRO-07-01 -------------------

  function abrirQueja_(id) {
    quejaActivaId_ = id;
    var cont = document.getElementById('calidad-contenido');
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando queja...');
    api_('getDetalleQuejaSgc', { queja_id: id }).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo abrir.', 'error');
        return;
      }
      puedeGestionar_ = respuesta.data.puede_gestionar === true;
      pintarFichaQueja_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = Componentes.alerta('No se pudo conectar.', 'error');
    });
  }

  function pintarFichaQueja_(cont, data) {
    var q = data.queja;
    var puede = data.puede_gestionar === true;
    var puedeInvestigar = data.puede_investigar === true;
    var cerrada = ['CERRADA', 'NO_PROCEDE', 'NO_VALIDA', 'ANULADA'].indexOf(q.estado) !== -1;

    // 1) Recepción
    var e1 = etapaNc_(1, 'Recepción', !!q.fecha_recepcion,
      (q.fecha_recepcion
        ? '<p>' + (q.procede === true || q.procede === 'TRUE'
            ? Componentes.badge('Procede', 'ok')
            : Componentes.badge('No procede', 'critico') + ' — ' + Componentes.escaparHtml(q.motivo_no_procede)) + '</p>' +
          '<p class="sigso-ayuda">Registrada el ' + fechaCorta_(q.fecha_recepcion) + ' por ' + Componentes.escaparHtml(q.registrado_por) + '.</p>'
        : '<p class="sigso-ayuda">¿El servicio está vigente (o dentro de los 30 días post-término) y no suspendido por falta de pago?</p>'),
      puede && q.estado === 'RECIBIDA'
        ? '<div class="sgc-acciones">' + Componentes.boton({ texto: 'Registrar recepción', clase: 'js-q-recepcion' }) + '</div>'
        : '');

    // 2) Investigación
    var e2 = etapaNc_(2, 'Investigación',
      q.estado !== 'RECIBIDA' && q.estado !== 'NO_PROCEDE' && !!q.resultado_investigacion,
      (q.estado === 'RECIBIDA' || q.estado === 'NO_PROCEDE'
        ? '<p class="sigso-ayuda">Quién investiga no puede ser del área que originó la queja (PRO-07 §6.2).</p>'
        : (q.investigador_email
            ? '<p class="sigso-ayuda">Investiga: <b>' + Componentes.escaparHtml(q.investigador_email) + '</b></p>' +
              (q.resultado_investigacion
                ? '<p>' + Componentes.escaparHtml(q.resultado_investigacion) + '</p>' +
                  '<p>' + (q.valida === true || q.valida === 'TRUE' ? Componentes.badge('Válida', 'ok') : Componentes.badge('No válida', 'critico')) + '</p>'
                : '<p class="sigso-ayuda">Investigación en curso.</p>')
            : '<p class="sigso-ayuda">Falta asignar quién investiga.</p>')),
      puede && q.estado === 'EN_INVESTIGACION' && !q.investigador_email
        ? '<div class="sgc-acciones">' + Componentes.boton({ texto: 'Asignar investigador', clase: 'js-q-investigador' }) + '</div>'
        : (puedeInvestigar && q.estado === 'EN_INVESTIGACION' && q.investigador_email && !q.resultado_investigacion
            ? '<div class="sgc-acciones">' + Componentes.boton({ texto: 'Registrar resultado', clase: 'js-q-resultado' }) + '</div>'
            : ''));

    // 3) Resolución
    var e3 = etapaNc_(3, 'Resolución', !!q.fecha_resolucion,
      (q.accion_implementada && q.estado !== 'NO_VALIDA'
        ? '<p>' + Componentes.escaparHtml(q.accion_implementada) + '</p>' +
          (q.fecha_resolucion ? '<p class="sigso-ayuda">Resuelta el ' + fechaCorta_(q.fecha_resolucion) + '.</p>' : '') +
          (data.nc_correlativo
            ? '<p class="sigso-ayuda">→ ' + Componentes.escaparHtml(data.nc_correlativo) + ' (' +
              Componentes.escaparHtml(ESTADO_NC_ETIQUETA[data.nc_estado] || data.nc_estado) + ')</p>'
            : '')
        : '<p class="sigso-ayuda">Qué se hizo para resolverlo. Plazo: 30 días corridos desde que se validó' +
          (q.resolucion_plazo ? ', vence el ' + fechaCorta_(q.resolucion_plazo) : '') + '.</p>'),
      puede && q.estado === 'EN_RESOLUCION'
        ? '<div class="sgc-acciones">' + Componentes.boton({ texto: 'Registrar resolución', clase: 'js-q-resolucion' }) + '</div>'
        : (puede && q.estado === 'RESUELTA' && !q.nc_id
            ? '<div class="sgc-acciones">' + Componentes.boton({ texto: 'Levantar no conformidad', variante: 'secundario', clase: 'js-q-a-nc' }) + '</div>'
            : ''));

    // 4) Notificación
    var e4 = etapaNc_(4, 'Notificación al cliente', !!q.fecha_notificacion,
      (q.fecha_notificacion
        ? '<p class="sigso-ayuda">Notificada el ' + fechaCorta_(q.fecha_notificacion) +
          '. Revisó: ' + Componentes.escaparHtml(q.revisado_por) + '.</p>'
        : '<p class="sigso-ayuda">Se le envía al cliente la respuesta final. La decisión la revisa alguien no involucrado en el origen.</p>'),
      puede && q.estado === 'RESUELTA'
        ? '<div class="sgc-acciones">' + Componentes.boton({ texto: 'Notificar al cliente', clase: 'js-q-notificar' }) + '</div>'
        : '');

    // 5) Seguimiento
    var e5 = etapaNc_(5, 'Seguimiento', !!q.fecha_seguimiento,
      (q.fecha_seguimiento
        ? '<p>' + (q.cliente_conforme === true || q.cliente_conforme === 'TRUE'
            ? Componentes.badge('Cliente conforme', 'ok') : Componentes.badge('No conforme — reabierta', 'critico')) + '</p>'
        : '<p class="sigso-ayuda">30 días corridos después de la respuesta: ¿el cliente quedó conforme?' +
          (q.seguimiento_plazo ? ' Vence el ' + fechaCorta_(q.seguimiento_plazo) + '.' : '') + '</p>'),
      puede && (q.estado === 'NOTIFICADA' || q.estado === 'REABIERTA')
        ? '<div class="sgc-acciones">' + Componentes.boton({ texto: 'Registrar seguimiento', clase: 'js-q-seguimiento' }) + '</div>'
        : '');

    cont.innerHTML =
      '<div class="sgc-detalle-cab">' +
        Componentes.boton({ texto: '← Quejas', variante: 'sutil', clase: 'js-q-volver' }) +
        '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(q.correlativo) + '</span>' +
        '<h1>' + Componentes.escaparHtml(q.nombre_completo) + '</h1>' +
        Componentes.badge(TIPO_QUEJA_ETIQUETA[q.tipo] || q.tipo, TIPO_QUEJA_TONO[q.tipo] || 'neutro') +
        Componentes.badge(ESTADO_QUEJA_ETIQUETA[q.estado] || q.estado, cerrada ? 'neutro' : 'info') +
        (data.resumen && data.resumen.vencida ? Componentes.badge('Plazo vencido', 'critico') : '') +
      '</div>' +
      '<div class="sgc-cuerpo">' +
        '<dl class="sgc-ficha">' +
          campoFicha_('Empresa', q.empresa) +
          campoFicha_('RUT', q.rut) +
          campoFicha_('Correo', q.email) +
          campoFicha_('Teléfono', q.telefono) +
          campoFicha_('Área', AREA_QUEJA_ETIQUETA[q.area] || q.area) +
          campoFicha_('Canal', q.canal) +
          campoFicha_('Recibida', fechaCorta_(q.fecha_envio)) +
        '</dl>' +
        '<p>' + Componentes.escaparHtml(q.descripcion) + '</p>' +
        '<div class="sgc-etapas">' + e1 + e2 + e3 + e4 + e5 + '</div>' +
        (puede && !cerrada
          ? '<div class="sgc-acciones">' + Componentes.boton({ texto: 'Anular', variante: 'peligro', clase: 'js-q-anular' }) + '</div>'
          : '') +
      '</div>';

    cont.querySelector('.js-q-volver').addEventListener('click', cargarQuejas_);
    wireFichaQueja_(cont, q, data);
  }

  function wireFichaQueja_(cont, q, data) {
    function accion_(selector, fn) {
      var b = cont.querySelector(selector);
      if (b) b.addEventListener('click', fn);
    }
    function enviar_(accion, datos, exito) {
      api_(accion, datos).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        if (exito) Componentes.aviso({ texto: exito, tipo: 'exito' });
        abrirQueja_(q.queja_id);
      });
    }

    accion_('.js-q-recepcion', function () { abrirFormularioRecepcionQueja_(q); });
    accion_('.js-q-investigador', function () { abrirFormularioInvestigadorQueja_(q); });
    accion_('.js-q-resultado', function () { abrirFormularioResultadoQueja_(q); });
    accion_('.js-q-resolucion', function () { abrirFormularioResolucionQueja_(q); });
    accion_('.js-q-notificar', function () { abrirFormularioNotificacionQueja_(q); });
    accion_('.js-q-seguimiento', function () { abrirFormularioSeguimientoQueja_(q); });

    accion_('.js-q-a-nc', function () {
      Componentes.confirmar({
        titulo: 'Levantar no conformidad',
        mensaje: 'Se crea la no conformidad con esta queja como origen, y de ahí sale la acción correctiva.'
      }).then(function (ok) {
        if (ok) {
          enviar_('convertirQuejaEnNcSgc', { queja_id: q.queja_id, responsable_email: q.investigador_email },
            'No conformidad creada desde la queja.');
        }
      });
    });
    accion_('.js-q-anular', function () {
      Componentes.prompt({
        titulo: 'Anular queja', mensaje: '¿Por qué se anula? Queda registrado (la queja no se borra).'
      }).then(function (motivo) {
        if (motivo && String(motivo).trim()) enviar_('anularQuejaSgc', { queja_id: q.queja_id, motivo: motivo });
      });
    });
  }

  // --- formularios de queja -----------------------------------------------------

  function abrirFormularioRecepcionQueja_(q) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Registrar recepción</h3>' +
        '<p class="sigso-ayuda">¿El servicio está vigente (o dentro de los 30 días post-término) y no suspendido por falta de pago?</p>' +
        '<form id="form-q-recepcion">' +
          Componentes.campoSelect({
            id: 'qr-procede', label: 'Procede', valor: 'SI', placeholder: false,
            opciones: [{ valor: 'SI', texto: 'Sí, procede' }, { valor: 'NO', texto: 'No procede' }]
          }) +
          Componentes.campoTextarea({ id: 'qr-motivo', label: 'Motivo (si no procede)' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-q-recepcion').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('registrarRecepcionQuejaSgc', {
        queja_id: q.queja_id,
        procede: document.getElementById('qr-procede').value === 'SI',
        motivo_no_procede: document.getElementById('qr-motivo').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        abrirQueja_(q.queja_id);
      });
    });
  }

  function abrirFormularioInvestigadorQueja_(q) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Asignar investigador</h3>' +
        '<p class="sigso-ayuda">No puede ser de la misma área que originó la queja (' +
          Componentes.escaparHtml(AREA_QUEJA_ETIQUETA[q.area] || q.area) + ').</p>' +
        '<form id="form-q-investigador">' +
          Componentes.campoTexto({ id: 'qi-email', label: 'Investigador', tipo: 'email', requerido: true }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Asignar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-q-investigador').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('registrarInvestigacionQuejaSgc', {
        queja_id: q.queja_id, investigador_email: document.getElementById('qi-email').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo asignar.', tipo: 'error' });
          return;
        }
        cerrar();
        abrirQueja_(q.queja_id);
      });
    });
  }

  function abrirFormularioResultadoQueja_(q) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Resultado de la investigación</h3>' +
        '<form id="form-q-resultado">' +
          Componentes.campoTextarea({ id: 'qres-resultado', label: 'Qué se encontró', requerido: true }) +
          Componentes.campoSelect({
            id: 'qres-valida', label: '¿La queja es válida?', valor: 'SI', placeholder: false,
            opciones: [{ valor: 'SI', texto: 'Sí, es válida' }, { valor: 'NO', texto: 'No es válida' }]
          }) +
          Componentes.campoTextarea({
            id: 'qres-justificacion', label: 'Justificación (si no es válida)',
            ayuda: 'Se adjunta a la respuesta que recibe el cliente.'
          }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-q-resultado').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('registrarResultadoQuejaSgc', {
        queja_id: q.queja_id,
        resultado_investigacion: document.getElementById('qres-resultado').value,
        valida: document.getElementById('qres-valida').value === 'SI',
        justificacion: document.getElementById('qres-justificacion').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        abrirQueja_(q.queja_id);
      });
    });
  }

  function abrirFormularioResolucionQueja_(q) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Registrar resolución</h3>' +
        '<form id="form-q-resolucion">' +
          Componentes.campoTextarea({ id: 'qsol-accion', label: 'Acción o corrección implementada', requerido: true }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-q-resolucion').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('registrarResolucionQuejaSgc', {
        queja_id: q.queja_id, accion_implementada: document.getElementById('qsol-accion').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        abrirQueja_(q.queja_id);
      });
    });
  }

  function abrirFormularioNotificacionQueja_(q) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Notificar al cliente</h3>' +
        '<p class="sigso-ayuda">Se envía por correo la respuesta final con la acción implementada.</p>' +
        '<form id="form-q-notificar">' +
          Componentes.campoTexto({
            id: 'qn-revisado', label: 'Revisado y aprobado por', tipo: 'email', requerido: true,
            placeholder: 'Persona no involucrada en el origen del mensaje'
          }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Notificar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-q-notificar').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('registrarNotificacionQuejaSgc', {
        queja_id: q.queja_id, revisado_por: document.getElementById('qn-revisado').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo notificar.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({ texto: 'Cliente notificado.', tipo: 'exito' });
        abrirQueja_(q.queja_id);
      });
    });
  }

  function abrirFormularioSeguimientoQueja_(q) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Registrar seguimiento</h3>' +
        '<p class="sigso-ayuda">30 días corridos después de la respuesta: ¿el cliente quedó conforme?</p>' +
        '<form id="form-q-seguimiento">' +
          Componentes.campoSelect({
            id: 'qseg-conforme', label: 'Resultado', valor: 'SI', placeholder: false,
            opciones: [
              { valor: 'SI', texto: 'Sí, conforme — se cierra la queja' },
              { valor: 'NO', texto: 'No conforme — reabrir el caso' }
            ]
          }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-q-seguimiento').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var conforme = document.getElementById('qseg-conforme').value === 'SI';
      api_('registrarSeguimientoQuejaSgc', {
        queja_id: q.queja_id, cliente_conforme: conforme
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({ texto: conforme ? 'Queja cerrada.' : 'Reabierta: hay que retomar la resolución.', tipo: conforme ? 'exito' : 'info' });
        abrirQueja_(q.queja_id);
      });
    });
  }

  // --- utilidades -------------------------------------------------------------

  function montarModal_(fondo) {
    function cerrar() {
      document.removeEventListener('keydown', alTeclado);
      if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
    }
    function alTeclado(ev) { if (ev.key === 'Escape') cerrar(); }
    fondo.addEventListener('click', function (ev) { if (ev.target === fondo) cerrar(); });
    document.addEventListener('keydown', alTeclado);
    document.body.appendChild(fondo);
    fondo.querySelector('.js-sgc-cancelar').addEventListener('click', cerrar);
    return cerrar;
  }

  // El dataURL viene como "data:<mime>;base64,<contenido>"; el backend solo
  // necesita la parte base64 (mismo criterio que formulario.js/novedades.js).
  function leerArchivoBase64Sgc_(archivo) {
    return new Promise(function (resolver, rechazar) {
      var lector = new FileReader();
      lector.onload = function () { resolver(String(lector.result).split(',')[1]); };
      lector.onerror = function () { rechazar(new Error('No se pudo leer el archivo.')); };
      lector.readAsDataURL(archivo);
    });
  }

  function descargarBase64Sgc_(base64, nombre, mime) {
    var bytes = atob(base64);
    var arr = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    var blob = new Blob([arr], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = nombre || 'documento';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function fechaCorta_(iso) {
    if (!iso) return '—';
    var f = new Date(iso);
    if (isNaN(f.getTime())) return '—';
    return ('0' + f.getUTCDate()).slice(-2) + '/' + ('0' + (f.getUTCMonth() + 1)).slice(-2) + '/' + f.getUTCFullYear();
  }

  function fechaISO_(iso) {
    if (!iso) return '';
    var f = new Date(iso);
    if (isNaN(f.getTime())) return '';
    return f.getUTCFullYear() + '-' + ('0' + (f.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + f.getUTCDate()).slice(-2);
  }

  // Un textarea "uno por línea" -> arreglo sin líneas vacías. Se usa para
  // los items del descriptor y para las personas entrevistadas de auditoría.
  function lineasNoVacias_(texto) {
    return String(texto || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  }
})();
