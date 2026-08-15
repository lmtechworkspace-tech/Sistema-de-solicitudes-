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
    cargar: cargarListado_,
    refrescar: function () {
      if (documentoActivoId_) abrirDocumento_(documentoActivoId_); else cargarListado_();
    }
  };

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

  var documentoActivoId_ = null;
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

    var cabecera = '<div class="sgc-cabecera">' +
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
