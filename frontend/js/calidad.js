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
    } else {
      if (documentoActivoId_) abrirDocumento_(documentoActivoId_); else cargarListado_();
    }
  }

  // Barra de secciones del modulo. Documentos y Personas son los dos
  // submodulos del SGC que existen hoy (PRO-01 y PRO-02).
  function barraSecciones_() {
    var secciones = [
      { id: 'documentos', texto: 'Documentos' },
      { id: 'personas', texto: 'Personas' }
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
        Componentes.aviso({ texto: 'Confirmado. Queda registrado con tu nombre y la fecha.', tipo: 'ok' });
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
      api_('actualizarDocumentoSgc', {
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
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        abrirDocumento_(d.documento_id);
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
      { id: 'induccion', texto: 'Inducción' }
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
      '</dl>' + acciones + historial;
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

  function wireFicha_(cont, data) {
    var p = data.persona;

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
          Componentes.campoTextarea({ id: 'sgc-de-responsabilidades', label: 'Responsabilidades' }) +
          Componentes.campoTextarea({ id: 'sgc-de-habilidades', label: 'Habilidades requeridas' }) +
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
})();
