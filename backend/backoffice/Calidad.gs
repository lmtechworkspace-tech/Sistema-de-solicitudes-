/**
 * Calidad.gs — Modulo SGC ISO 9001:2015, Fase 1.
 * documentacion/SIGSO-v10.0-propuesta-modulo-sgc-iso9001.md.
 *
 * REPOSITORIO DOCUMENTAL CONTROLADO. El punto de partida real del cliente
 * es que los documentos del SGC YA EXISTEN (PDF/Word/Excel, ya elaborados,
 * revisados y aprobados en papel): lo que faltaba no era redactarlos en el
 * sistema, sino SUBIRLOS con su metadata de control y que cada persona vea
 * solo los que le corresponden. Por eso esta fase es un repositorio con
 * control de acceso y versionado, no un flujo de redaccion.
 *
 * Patron de permisos (igual que Proyectos/Actividades/Novedades): el modulo
 * 'calidad' es el gate GRUESO (MODULO_POR_ACCION, Code.gs); el rol dentro
 * del SGC (SGC_ROLES) es el gate FINO. NO se crean roles globales nuevos:
 * los roles de SIGSO (ADM/GERENCIA/JEFATURA/...) no se tocan, igual que el
 * rol de proyecto vive dentro del proyecto (v9.0).
 *
 * Regla ISO que se refleja en el codigo: un documento OBSOLETO no se borra
 * (trazabilidad) pero SI se retira de circulacion -- solo lo ven quienes
 * gobiernan el SGC. Nadie del personal puede toparse por accidente con una
 * version que ya no rige (PRO-01 §4.3).
 *
 * Archivos: la carpeta de Drive NUNCA se hace publica. La descarga pasa
 * por descargarDocumento(), que valida permisos y sirve el base64 -- mismo
 * criterio que Novedades.descargarAdjunto (ver nota en DriveRepo.gs).
 */

var Calidad = {

  // --- Listado maestro (FO-PRO-01-01) -------------------------------------
  // Devuelve SOLO lo que quien pregunta puede ver. El filtrado de
  // visibilidad se hace aca, en el servidor: esconder en el frontend no
  // protege nada.
  listarDocumentos: function (data, contexto) {
    var filtros = data || {};
    var todos = leerFilasSeguro_(SHEETS.SGC_DOCUMENTOS).filter(esActivoSgc_);
    var destinatarios = leerFilasSeguro_(SHEETS.SGC_DOC_DESTINATARIOS);
    var rol = rolSgc_(contexto);
    var area = areaSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);

    var visibles = todos.filter(function (d) {
      return puedeVerDocumento_(d, contexto, rol, area, gobierna, destinatarios);
    });

    if (filtros.tipo) {
      visibles = visibles.filter(function (d) { return d.tipo === filtros.tipo; });
    }
    if (filtros.area_id) {
      visibles = visibles.filter(function (d) { return d.area_id === filtros.area_id; });
    }
    if (filtros.estado) {
      visibles = visibles.filter(function (d) { return d.estado === filtros.estado; });
    }
    if (filtros.busqueda) {
      var q = String(filtros.busqueda).trim().toLowerCase();
      visibles = visibles.filter(function (d) {
        return String(d.codigo || '').toLowerCase().indexOf(q) !== -1 ||
          String(d.nombre || '').toLowerCase().indexOf(q) !== -1;
      });
    }

    var ahora = new Date();
    // v10.0 Fase 1b: que me falta confirmar. Se resuelve UNA vez para toda
    // la lista (no una consulta por documento) -- misma leccion de
    // rendimiento que Novedades aprendio en v6.9 con su trigger diario.
    var acuses = leerFilasSeguro_(SHEETS.SGC_DOC_ACUSES);
    var pendientesMios = {};
    documentosPendientesDeAcuse_(contexto.email, visibles, acuses).forEach(function (d) {
      pendientesMios[d.documento_id] = true;
    });

    return {
      puede_gestionar: gobierna,
      rol_sgc: rol || 'OPERATIVO',
      pendientes_de_acuse: Object.keys(pendientesMios).length,
      documentos: visibles.map(function (d) {
        return {
          documento_id: d.documento_id,
          codigo: d.codigo,
          nombre: d.nombre,
          descripcion: d.descripcion,
          tipo: d.tipo,
          area_id: d.area_id,
          version_vigente: d.version_vigente,
          estado: d.estado,
          visibilidad: d.visibilidad,
          fecha_vigencia: d.fecha_vigencia,
          proxima_revision: d.proxima_revision,
          elaborado_por: d.elaborado_por,
          revisado_por: d.revisado_por,
          aprobado_por: d.aprobado_por,
          archivo_nombre: d.archivo_nombre,
          archivo_mime: d.archivo_mime,
          tiene_archivo: !!d.archivo_id,
          // Señal calculada, no persistida: PRO-01 exige revision cada 12
          // meses. Se recalcula al leer para que nunca quede desfasada.
          revision_vencida: esRevisionVencida_(d.proxima_revision, ahora),
          dias_para_revision: diasHastaSgc_(d.proxima_revision, ahora),
          requiere_acuse: esVerdaderoSgc_(d.requiere_acuse),
          fecha_limite_acuse: d.fecha_limite_acuse || '',
          debo_acusar: !!pendientesMios[d.documento_id],
          dias_para_acuse: d.fecha_limite_acuse ? diasHastaSgc_(d.fecha_limite_acuse, ahora) : null
        };
      }).sort(function (a, b) {
        return String(a.codigo || '').localeCompare(String(b.codigo || ''));
      })
    };
  },

  // --- Detalle + historial de versiones ------------------------------------
  getDocumento: function (data, contexto) {
    var doc = buscarDocumentoSgc_(data.documento_id);
    if (!doc) return errorValidacion_('documento_id', 'Documento no encontrado.');
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    var destinatarios = leerFilasSeguro_(SHEETS.SGC_DOC_DESTINATARIOS);
    if (!puedeVerDocumento_(doc, contexto, rol, areaSgc_(contexto), gobierna, destinatarios)) {
      return { _forbidden: true, message: 'No tienes acceso a este documento.' };
    }

    var versiones = leerFilasSeguro_(SHEETS.SGC_DOC_VERSIONES)
      .filter(function (v) { return v.documento_id === doc.documento_id; })
      .sort(function (a, b) { return new Date(b.fecha || 0) - new Date(a.fecha || 0); });

    var acuses = leerFilasSeguro_(SHEETS.SGC_DOC_ACUSES);
    var debeAcusar = documentosPendientesDeAcuse_(contexto.email, [doc], acuses).length > 0;
    var miAcuse = acuses.filter(function (a) {
      return a.documento_id === doc.documento_id && a.version === doc.version_vigente &&
        normalizarEmailSgc_(a.usuario_email) === normalizarEmailSgc_(contexto.email);
    })[0];

    return {
      documento: doc,
      puede_gestionar: gobierna,
      debo_acusar: debeAcusar,
      mi_acuse: miAcuse ? miAcuse.acusado_en : '',
      versiones: versiones,
      destinatarios: doc.visibilidad === 'SELECCION'
        ? destinatarios.filter(function (x) { return x.documento_id === doc.documento_id; })
            .map(function (x) { return x.usuario_email; })
        : []
    };
  },

  // --- Crear documento (subir el archivo que ya existe) --------------------
  crearDocumento: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden cargar documentos.' };
    }
    var codigo = String(data.codigo || '').trim().toUpperCase();
    if (!codigo) return errorValidacion_('codigo', 'El código del documento es obligatorio.');
    var nombre = String(data.nombre || '').trim();
    if (!nombre) return errorValidacion_('nombre', 'El nombre del documento es obligatorio.');
    if (TIPOS_DOC_SGC.indexOf(data.tipo) === -1) {
      return errorValidacion_('tipo', 'Tipo de documento inválido.');
    }
    if (VISIBILIDAD_SGC.indexOf(data.visibilidad) === -1) {
      return errorValidacion_('visibilidad', 'Visibilidad inválida.');
    }
    // El codigo es la identidad del documento en el SGC (DOC-01, PRO-07...):
    // duplicarlo rompe el listado maestro y confunde al auditor.
    var yaExiste = leerFilasSeguro_(SHEETS.SGC_DOCUMENTOS).filter(function (d) {
      return esActivoSgc_(d) && String(d.codigo || '').toUpperCase() === codigo;
    })[0];
    if (yaExiste) return errorValidacion_('codigo', 'Ya existe un documento con el código ' + codigo + '.');

    var archivo = { archivo_id: '', archivo_nombre: '', archivo_mime: '' };
    if (data.contenido_base64) {
      var subido = subirArchivoSgc_(data, codigo);
      if (subido._validationError) return subido;
      archivo = subido;
    }

    var ahora = new Date();
    var version = String(data.version_vigente || 'v01').trim();
    var documento = {
      documento_id: Utilities.getUuid(),
      codigo: codigo,
      nombre: nombre,
      descripcion: data.descripcion || '',
      tipo: data.tipo,
      area_id: data.area_id || '',
      version_vigente: version,
      estado: 'VIGENTE',
      visibilidad: data.visibilidad,
      fecha_vigencia: data.fecha_vigencia || ahora.toISOString(),
      proxima_revision: proximaRevisionSgc_(data.fecha_vigencia || ahora.toISOString()),
      elaborado_por: data.elaborado_por || '',
      revisado_por: data.revisado_por || '',
      aprobado_por: data.aprobado_por || '',
      archivo_id: archivo.archivo_id,
      archivo_nombre: archivo.archivo_nombre,
      archivo_mime: archivo.archivo_mime,
      creado_por: contexto.email || '',
      fecha_creacion: ahora.toISOString(),
      activa: true,
      // v10.0 Fase 1b: por defecto SI exige acuse -- mismo criterio que
      // Novedades ("el punto de partida es que alguien se haga responsable
      // de que la info llegue, y eso se demuestra con el acuse").
      requiere_acuse: data.requiere_acuse === false ? false : true,
      fecha_limite_acuse: data.fecha_limite_acuse || ''
    };
    agregarFila_(SHEETS.SGC_DOCUMENTOS, documento);

    if (archivo.archivo_id) {
      registrarVersionSgc_(documento.documento_id, version, data.cambios || 'Carga inicial', archivo, contexto, true);
    }
    guardarDestinatariosSgc_(documento.documento_id, data.visibilidad, data.destinatarios);
    registrarLogSgc_('SGC_DOC_CREADO', documento.codigo + ' ' + documento.nombre, contexto);
    return documento;
  },

  // --- Nueva version (la anterior queda archivada, nunca se borra) ---------
  nuevaVersion: function (data, contexto) {
    var doc = buscarDocumentoSgc_(data.documento_id);
    if (!doc) return errorValidacion_('documento_id', 'Documento no encontrado.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden subir una nueva versión.' };
    }
    var version = String(data.version || '').trim();
    if (!version) return errorValidacion_('version', 'Indica el número de la nueva versión (ej. v02).');
    if (version === doc.version_vigente) {
      return errorValidacion_('version', 'Esa ya es la versión vigente.');
    }
    if (!data.contenido_base64) {
      return errorValidacion_('contenido_base64', 'Adjunta el archivo de la nueva versión.');
    }
    var archivo = subirArchivoSgc_(data, doc.codigo);
    if (archivo._validationError) return archivo;

    // La version anterior deja de ser la vigente pero se conserva (ISO
    // exige poder demostrar que version regia en que fecha).
    leerFilasSeguro_(SHEETS.SGC_DOC_VERSIONES).forEach(function (v) {
      if (v.documento_id === doc.documento_id && esVerdaderoSgc_(v.vigente)) {
        actualizarFilaPorId_(SHEETS.SGC_DOC_VERSIONES, 'version_id', v.version_id, { vigente: false });
      }
    });
    registrarVersionSgc_(doc.documento_id, version, data.cambios || '', archivo, contexto, true);

    var fechaVigencia = data.fecha_vigencia || new Date().toISOString();
    var actualizado = actualizarFilaPorId_(SHEETS.SGC_DOCUMENTOS, 'documento_id', doc.documento_id, {
      version_vigente: version,
      fecha_vigencia: fechaVigencia,
      proxima_revision: proximaRevisionSgc_(fechaVigencia),
      archivo_id: archivo.archivo_id,
      archivo_nombre: archivo.archivo_nombre,
      archivo_mime: archivo.archivo_mime,
      estado: 'VIGENTE'
    });
    registrarLogSgc_('SGC_DOC_NUEVA_VERSION', doc.codigo + ' → ' + version, contexto);
    return actualizado;
  },

  // --- Editar metadata / visibilidad / obsolescencia -----------------------
  actualizarDocumento: function (data, contexto) {
    var doc = buscarDocumentoSgc_(data.documento_id);
    if (!doc) return errorValidacion_('documento_id', 'Documento no encontrado.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden editar documentos.' };
    }
    var cambios = {};
    ['nombre', 'descripcion', 'area_id', 'elaborado_por', 'revisado_por', 'aprobado_por'].forEach(function (campo) {
      if (data[campo] !== undefined) cambios[campo] = data[campo];
    });
    if (data.tipo !== undefined) {
      if (TIPOS_DOC_SGC.indexOf(data.tipo) === -1) return errorValidacion_('tipo', 'Tipo de documento inválido.');
      cambios.tipo = data.tipo;
    }
    if (data.visibilidad !== undefined) {
      if (VISIBILIDAD_SGC.indexOf(data.visibilidad) === -1) return errorValidacion_('visibilidad', 'Visibilidad inválida.');
      cambios.visibilidad = data.visibilidad;
      guardarDestinatariosSgc_(doc.documento_id, data.visibilidad, data.destinatarios);
    }
    if (data.fecha_vigencia !== undefined && data.fecha_vigencia) {
      cambios.fecha_vigencia = data.fecha_vigencia;
      cambios.proxima_revision = proximaRevisionSgc_(data.fecha_vigencia);
    }
    if (data.requiere_acuse !== undefined) cambios.requiere_acuse = data.requiere_acuse === true;
    if (data.fecha_limite_acuse !== undefined) cambios.fecha_limite_acuse = data.fecha_limite_acuse || '';

    // v10.0: adjuntar (o corregir) el archivo de la version que YA rige, sin
    // inventar una version nueva. Hace falta porque un documento puede nacer
    // sin archivo -- la carga inicial del listado maestro entra asi, y antes
    // quedaba sin ninguna forma de subir el PDF: "nueva version" exige un
    // numero distinto al vigente, y editar no tocaba el archivo.
    //
    // El limite es el acuse: mientras nadie haya confirmado la version, el
    // archivo todavia se esta armando y reemplazarlo no altera evidencia.
    // Una vez que alguien la confirmo, cambiar el archivo por debajo haria
    // que su "Enterado" apunte a algo que ya no existe, y eso SI exige una
    // version nueva (§7.5.2: identificar y controlar los cambios).
    if (data.contenido_base64) {
      var yaConfirmada = leerFilasSeguro_(SHEETS.SGC_DOC_ACUSES).filter(function (a) {
        return a.documento_id === doc.documento_id && String(a.version) === String(doc.version_vigente);
      })[0];
      if (yaConfirmada) {
        return errorValidacion_('contenido_base64',
          'Alguien ya confirmó la versión ' + doc.version_vigente + ': su archivo es evidencia y no se reemplaza. ' +
          'Sube una versión nueva para dejar el cambio trazado.');
      }
      var archivoNuevo = subirArchivoSgc_(data, doc.codigo);
      if (archivoNuevo._validationError) return archivoNuevo;
      cambios.archivo_id = archivoNuevo.archivo_id;
      cambios.archivo_nombre = archivoNuevo.archivo_nombre;
      cambios.archivo_mime = archivoNuevo.archivo_mime;
      sincronizarArchivoVersionSgc_(doc, archivoNuevo, contexto);
    }

    if (data.estado !== undefined) {
      if (['VIGENTE', 'OBSOLETO'].indexOf(data.estado) === -1) {
        return errorValidacion_('estado', 'Estado inválido.');
      }
      // Marcar obsoleto lo RETIRA de circulacion (deja de verlo el
      // personal) pero no lo borra: sigue disponible para el auditor.
      cambios.estado = data.estado;
    }
    var actualizado = actualizarFilaPorId_(SHEETS.SGC_DOCUMENTOS, 'documento_id', doc.documento_id, cambios);
    // Adjuntar el archivo se registra aparte: es lo que convierte al
    // documento en consultable, no un cambio de metadata mas.
    registrarLogSgc_(cambios.archivo_id ? 'SGC_DOC_ARCHIVO_ADJUNTADO' : 'SGC_DOC_EDITADO',
      doc.codigo + (cambios.archivo_id ? ' ' + doc.version_vigente : ''), contexto);
    return actualizado;
  },

  // --- Descarga (valida permisos y sirve el base64) ------------------------
  descargarDocumento: function (data, contexto) {
    var doc = buscarDocumentoSgc_(data.documento_id);
    if (!doc) return errorValidacion_('documento_id', 'Documento no encontrado.');
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    var destinatarios = leerFilasSeguro_(SHEETS.SGC_DOC_DESTINATARIOS);
    if (!puedeVerDocumento_(doc, contexto, rol, areaSgc_(contexto), gobierna, destinatarios)) {
      return { _forbidden: true, message: 'No tienes acceso a este documento.' };
    }

    // Se puede pedir una version historica concreta (solo quien gobierna el
    // SGC: para el personal, la version anterior ya no rige).
    var archivoId = doc.archivo_id, nombre = doc.archivo_nombre, mime = doc.archivo_mime;
    if (data.version_id) {
      if (!gobierna) {
        return { _forbidden: true, message: 'Solo el Encargado SGC puede descargar versiones anteriores.' };
      }
      var v = leerFilasSeguro_(SHEETS.SGC_DOC_VERSIONES).filter(function (x) {
        return x.version_id === data.version_id && x.documento_id === doc.documento_id;
      })[0];
      if (!v) return errorValidacion_('version_id', 'Versión no encontrada.');
      archivoId = v.archivo_id; nombre = v.archivo_nombre; mime = v.archivo_mime;
    }
    if (!archivoId) return errorValidacion_('documento_id', 'Este documento no tiene archivo cargado.');

    var archivo = DriveApp.getFileById(archivoId);
    // §15.2 de la especificacion pide log de descargas. Se registra la
    // DESCARGA (no cada visualizacion): es lo que el auditor pregunta, y
    // loguear cada lectura haria explotar LOG_SISTEMA.
    registrarLogSgc_('SGC_DOC_DESCARGADO', doc.codigo + ' ' + (nombre || ''), contexto);
    return {
      contenido_base64: Utilities.base64Encode(archivo.getBlob().getBytes()),
      nombre_archivo: nombre || archivo.getName(),
      mime: mime || 'application/octet-stream'
    };
  },

  // --- Acuse de recibo (Fase 1b) -------------------------------------------
  // ISO 9001 §7.5.3: hay que poder demostrar que la informacion documentada
  // llego a quien corresponde. El acuse se guarda POR VERSION: si el
  // documento pasa a v02, el acuse de la v01 deja de valer y todos deben
  // confirmar la nueva. Sin eso, "confirmado" solo significaria "confirmo
  // algo alguna vez", que no es evidencia de nada.
  acusarDocumento: function (data, contexto) {
    var doc = buscarDocumentoSgc_(data.documento_id);
    if (!doc) return errorValidacion_('documento_id', 'Documento no encontrado.');
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    var destinatarios = leerFilasSeguro_(SHEETS.SGC_DOC_DESTINATARIOS);
    // No se puede confirmar lo que no se puede ver.
    if (!puedeVerDocumento_(doc, contexto, rol, areaSgc_(contexto), gobierna, destinatarios)) {
      return { _forbidden: true, message: 'No tienes acceso a este documento.' };
    }
    if (!esVerdaderoSgc_(doc.requiere_acuse)) {
      return errorValidacion_('documento_id', 'Este documento no exige confirmación de lectura.');
    }
    var email = normalizarEmailSgc_(contexto.email);
    var yaAcuso = leerFilasSeguro_(SHEETS.SGC_DOC_ACUSES).filter(function (a) {
      return a.documento_id === doc.documento_id && a.version === doc.version_vigente &&
        normalizarEmailSgc_(a.usuario_email) === email;
    })[0];
    if (yaAcuso) return yaAcuso; // idempotente: confirmar dos veces no duplica

    var acuse = {
      acuse_id: Utilities.getUuid(),
      documento_id: doc.documento_id,
      version: doc.version_vigente,
      usuario_email: email,
      acusado_en: new Date().toISOString()
    };
    agregarFila_(SHEETS.SGC_DOC_ACUSES, acuse);
    registrarLogSgc_('SGC_DOC_ACUSE', doc.codigo + ' ' + doc.version_vigente, contexto);
    return acuse;
  },

  // Panel de cumplimiento de un documento: quien confirmo y quien falta.
  // Es lo que el Encargado SGC le muestra al auditor.
  getCumplimiento: function (data, contexto) {
    var doc = buscarDocumentoSgc_(data.documento_id);
    if (!doc) return errorValidacion_('documento_id', 'Documento no encontrado.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden ver el cumplimiento.' };
    }
    var obligados = audienciaDocumentoSgc_(doc);
    var acusaron = {};
    leerFilasSeguro_(SHEETS.SGC_DOC_ACUSES).forEach(function (a) {
      if (a.documento_id === doc.documento_id && a.version === doc.version_vigente) {
        acusaron[normalizarEmailSgc_(a.usuario_email)] = a.acusado_en;
      }
    });
    return {
      documento_id: doc.documento_id,
      codigo: doc.codigo,
      version: doc.version_vigente,
      requiere_acuse: esVerdaderoSgc_(doc.requiere_acuse),
      fecha_limite_acuse: doc.fecha_limite_acuse || '',
      confirmados: obligados.filter(function (e) { return !!acusaron[e]; })
        .map(function (e) { return { usuario_email: e, acusado_en: acusaron[e] }; }),
      pendientes: obligados.filter(function (e) { return !acusaron[e]; })
    };
  },

  // --- Roles del SGC --------------------------------------------------------
  listarRoles: function (data, contexto) {
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden ver los roles del SGC.' };
    }
    return leerFilasSeguro_(SHEETS.SGC_ROLES).filter(esVerdaderoActivoSgc_);
  },

  gestionarRol: function (data, contexto) {
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden gestionar los roles del SGC.' };
    }
    if (data.accion === 'quitar') {
      if (!data.rol_id) return errorValidacion_('rol_id', 'Falta indicar el rol.');
      return actualizarFilaPorId_(SHEETS.SGC_ROLES, 'rol_id', data.rol_id, { activo: false });
    }
    var email = normalizarEmailSgc_(data.usuario_email);
    if (!email) return errorValidacion_('usuario_email', 'Falta el correo de la persona.');
    if (ROLES_SGC.indexOf(data.rol_sgc) === -1) return errorValidacion_('rol_sgc', 'Rol del SGC inválido.');

    var existente = leerFilasSeguro_(SHEETS.SGC_ROLES).filter(function (r) {
      return normalizarEmailSgc_(r.usuario_email) === email;
    })[0];
    if (existente) {
      return actualizarFilaPorId_(SHEETS.SGC_ROLES, 'rol_id', existente.rol_id, {
        rol_sgc: data.rol_sgc,
        area_id: data.area_id || '',
        vigencia_hasta: data.vigencia_hasta || '',
        activo: true
      });
    }
    var fila = {
      rol_id: Utilities.getUuid(),
      usuario_email: email,
      rol_sgc: data.rol_sgc,
      area_id: data.area_id || '',
      vigencia_hasta: data.vigencia_hasta || '',
      activo: true,
      fecha_creacion: new Date().toISOString()
    };
    agregarFila_(SHEETS.SGC_ROLES, fila);
    return fila;
  }
};

// --- motor diario de vencimientos del SGC (Fase 1b) ------------------------
//
// SIN TRIGGER PROPIO. Apps Script limita a 20 triggers de tiempo por script
// y SIGSO ya los tiene todos usados (ver la nota en Triggers.gs); esta
// pasada se cuelga del slot diario de las 09:00, igual que ya hacen el
// recordatorio de Novedades y las alertas de Actividades.
//
// Y la restriccion resulta mejor producto: en vez de una alerta suelta por
// cada cosa, cada persona recibe UN SOLO correo con todo lo suyo. Es lo que
// evita que el personal empiece a filtrar los correos del SGC a los dos
// meses -- que es como muere un sistema de gestion.
Calidad.recordatorioPendientes = function () {
  var docs = leerFilasSeguro_(SHEETS.SGC_DOCUMENTOS).filter(esActivoSgc_);
  if (!docs.length) return { acuses: 0, revisiones: 0 };
  var acuses = leerFilasSeguro_(SHEETS.SGC_DOC_ACUSES);
  var hoy = new Date().toISOString().slice(0, 10);
  var ahora = new Date();

  // 1) Acuses pendientes, agrupados por persona.
  var pendientesPorPersona = {};
  docs.forEach(function (d) {
    if (d.estado !== 'VIGENTE' || !esVerdaderoSgc_(d.requiere_acuse)) return;
    var yaAcuso = {};
    acuses.forEach(function (a) {
      if (a.documento_id === d.documento_id && a.version === d.version_vigente) {
        yaAcuso[normalizarEmailSgc_(a.usuario_email)] = true;
      }
    });
    audienciaDocumentoSgc_(d).forEach(function (email) {
      if (yaAcuso[email]) return;
      if (!pendientesPorPersona[email]) pendientesPorPersona[email] = [];
      pendientesPorPersona[email].push(d);
    });
  });

  var enviadosAcuse = 0;
  Object.keys(pendientesPorPersona).forEach(function (email) {
    var lista = pendientesPorPersona[email];
    function plazo_(d) {
      if (!d.fecha_limite_acuse) return '';
      var dias = diasHastaSgc_(d.fecha_limite_acuse, ahora);
      if (dias === null) return '';
      return dias < 0 ? ' (VENCIDO hace ' + (-dias) + ' día(s))' : ' (vence en ' + dias + ' día(s))';
    }
    var asunto = 'SIGSO - Tienes ' + lista.length + ' documento(s) del SGC por confirmar';
    var cuerpoTexto = 'Tienes ' + lista.length + ' documento(s) del Sistema de Gestion de Calidad que aun no confirmas como leidos:\n' +
      lista.map(function (d) { return '- ' + d.codigo + ' ' + d.nombre + ' (' + d.version_vigente + ')' + plazo_(d); }).join('\n') +
      '\n\nEntra a SIGSO > Calidad para revisarlos y marcar "Enterado".';
    var cuerpoHtml = plantillaCorreoHtml_('Documentos del SGC por confirmar',
      '<p>Tienes <strong>' + lista.length + '</strong> documento(s) del Sistema de Gestión de Calidad que aún no confirmas como leídos:</p>' +
      '<ul style="margin:0 0 12px 18px;padding:0;">' +
      lista.map(function (d) {
        return '<li><strong>' + escaparHtmlCorreo_(d.codigo) + '</strong> — ' + escaparHtmlCorreo_(d.nombre) +
          ' <em>(' + escaparHtmlCorreo_(d.version_vigente) + ')</em>' + escaparHtmlCorreo_(plazo_(d)) + '</li>';
      }).join('') +
      '</ul><p>Entra a SIGSO &gt; Calidad para revisarlos y marcar &quot;Enterado&quot;.</p>');

    // El evento lleva la fecha: si la pasada se repite el mismo dia (o se
    // fuerza a mano), enviarCorreo_ no manda el mismo aviso dos veces.
    var resultado = enviarCorreo_('SGC_DIGEST', email, 'SGC_ACUSE_RECORDATORIO:' + hoy,
      asunto, cuerpoTexto, null, { htmlBody: cuerpoHtml });
    if (resultado && resultado.enviado) enviadosAcuse++;
    encolarNotificacionApp_(email, 'SGC_ACUSE_PENDIENTE', 'Documentos del SGC por confirmar',
      lista.length + ' documento(s) esperan tu confirmación.', 'calidad', 'Ver documentos', 72);
  });

  // 2) Revision a 12 meses: se avisa 30 dias antes (§13 de la
  // especificacion) y se sigue avisando si ya vencio. Va al Encargado SGC
  // -- y al elaborador original solo si quedo registrado como correo, ya
  // que ese campo admite texto libre (un nombre no sirve para notificar).
  var porRevisar = docs.filter(function (d) {
    if (d.estado !== 'VIGENTE' || !d.proxima_revision) return false;
    var dias = diasHastaSgc_(d.proxima_revision, ahora);
    return dias !== null && dias <= 30;
  });
  var enviadosRevision = 0;
  if (porRevisar.length) {
    var encargados = leerFilasSeguro_(SHEETS.SGC_ROLES)
      .filter(function (r) { return esVerdaderoActivoSgc_(r) && r.rol_sgc === 'ENCARGADO_SGC'; })
      .map(function (r) { return normalizarEmailSgc_(r.usuario_email); });
    porRevisar.forEach(function (d) {
      var elaborador = normalizarEmailSgc_(d.elaborado_por);
      if (elaborador.indexOf('@') !== -1 && encargados.indexOf(elaborador) === -1) encargados.push(elaborador);
    });

    var itemsTexto = porRevisar.map(function (d) {
      var dias = diasHastaSgc_(d.proxima_revision, ahora);
      return '- ' + d.codigo + ' ' + d.nombre + (dias < 0 ? ' (revisión VENCIDA hace ' + (-dias) + ' día(s))' : ' (a revisar en ' + dias + ' día(s))');
    }).join('\n');
    var itemsHtml = porRevisar.map(function (d) {
      var dias = diasHastaSgc_(d.proxima_revision, ahora);
      return '<li><strong>' + escaparHtmlCorreo_(d.codigo) + '</strong> — ' + escaparHtmlCorreo_(d.nombre) +
        (dias < 0 ? ' <span style="color:#B42318;">(revisión VENCIDA hace ' + (-dias) + ' día(s))</span>'
                  : ' (a revisar en ' + dias + ' día(s))') + '</li>';
    }).join('');
    var asuntoRev = 'SIGSO - ' + porRevisar.length + ' documento(s) del SGC por revisar';
    var textoRev = 'Estos documentos del SGC cumplen su revisión periódica (PRO-01, cada 12 meses):\n' +
      itemsTexto + '\n\nEntra a SIGSO > Calidad para revisarlos y, si corresponde, subir una nueva versión.';
    var htmlRev = plantillaCorreoHtml_('Documentos del SGC por revisar',
      '<p>Estos documentos cumplen su <strong>revisión periódica</strong> (PRO-01, cada 12 meses):</p>' +
      '<ul style="margin:0 0 12px 18px;padding:0;">' + itemsHtml + '</ul>' +
      '<p>Entra a SIGSO &gt; Calidad para revisarlos y, si corresponde, subir una nueva versión.</p>');

    encargados.forEach(function (email) {
      if (!email) return;
      var r = enviarCorreo_('SGC_REVISION', email, 'SGC_REVISION_RECORDATORIO:' + hoy,
        asuntoRev, textoRev, null, { htmlBody: htmlRev });
      if (r && r.enviado) enviadosRevision++;
      encolarNotificacionApp_(email, 'SGC_REVISION_PENDIENTE', 'Documentos del SGC por revisar',
        porRevisar.length + ' documento(s) cumplen su revisión de 12 meses.', 'calidad', 'Ver documentos', 72);
    });
  }

  return { acuses: enviadosAcuse, revisiones: enviadosRevision };
};

// --- constantes del modulo -------------------------------------------------

var TIPOS_DOC_SGC = ['DOC', 'PRO', 'INS', 'FO', 'EXTERNO'];
var VISIBILIDAD_SGC = ['TODOS', 'AREA', 'SELECCION'];
var ROLES_SGC = [
  'ENCARGADO_SGC', 'DIRECCION', 'GERENCIA_ADM', 'JEFATURA_AREA',
  'ENC_ADMIN', 'OPERATIVO', 'AUDITOR_EXTERNO'
];
// Quienes ven TODO el SGC, incluidos los documentos obsoletos.
var ROLES_SGC_LECTURA_TOTAL = ['ENCARGADO_SGC', 'DIRECCION', 'GERENCIA_ADM', 'AUDITOR_EXTERNO'];
// Quienes ademas pueden cargar/editar documentos.
var ROLES_SGC_GESTION = ['ENCARGADO_SGC'];

var MAX_ARCHIVO_SGC_BYTES = 10 * 1024 * 1024;

// Firmas de archivo aceptadas. La especificacion pide PDF, DOCX y XLSX
// (mas los legados DOC/XLS que siguen circulando en la empresa). Se valida
// por BYTES, no por la extension del nombre: la extension la escribe el
// usuario y se puede equivocar (o mentir).
var FIRMA_PDF_SGC = [0x25, 0x50, 0x44, 0x46];              // %PDF
var FIRMA_ZIP_SGC = [0x50, 0x4B, 0x03, 0x04];              // PK.. (docx/xlsx)
var FIRMA_OLE_SGC = [0xD0, 0xCF, 0x11, 0xE0];              // doc/xls legado

// --- permisos --------------------------------------------------------------

function normalizarEmailSgc_(email) {
  return String(email || '').trim().toLowerCase();
}

function esVerdaderoSgc_(valor) {
  return valor === true || valor === 'TRUE' || valor === 1;
}

function esActivoSgc_(fila) {
  return esVerdaderoSgc_(fila.activa);
}

function esVerdaderoActivoSgc_(fila) {
  return esVerdaderoSgc_(fila.activo);
}

// Rol dentro del SGC. Sin fila en SGC_ROLES la persona es OPERATIVO: ve los
// documentos de acceso general y los de su area, nada mas. Un AUDITOR_EXTERNO
// con vigencia_hasta pasada deja de tener rol automaticamente -- acceso
// temporal que expira solo, sin depender de acordarse de desactivarlo.
function rolSgc_(contexto) {
  var email = normalizarEmailSgc_(contexto && contexto.email);
  if (!email) return '';
  var fila = leerFilasSeguro_(SHEETS.SGC_ROLES).filter(function (r) {
    return normalizarEmailSgc_(r.usuario_email) === email && esVerdaderoActivoSgc_(r);
  })[0];
  if (!fila) return '';
  if (fila.vigencia_hasta) {
    var hasta = new Date(fila.vigencia_hasta);
    if (!isNaN(hasta.getTime()) && hasta < new Date()) return '';
  }
  return fila.rol_sgc || '';
}

function areaSgc_(contexto) {
  var email = normalizarEmailSgc_(contexto && contexto.email);
  if (!email) return '';
  var fila = leerFilasSeguro_(SHEETS.SGC_ROLES).filter(function (r) {
    return normalizarEmailSgc_(r.usuario_email) === email && esVerdaderoActivoSgc_(r);
  })[0];
  return fila ? (fila.area_id || '') : '';
}

// Gestion (cargar, editar, versionar): ENCARGADO_SGC o ADM de SIGSO.
function gobiernaSgc_(contexto, rol) {
  if (!contexto) return false;
  if (contexto.rol === 'ADM') return true;
  return ROLES_SGC_GESTION.indexOf(rol) !== -1;
}

// Lectura total (incluye obsoletos): quien gobierna, mas Direccion,
// Gerencia y el auditor externo vigente. GERENCIA de SIGSO tambien, por el
// mismo criterio de solo-lectura transversal que el resto del sistema.
function veTodoSgc_(contexto, rol, gobierna) {
  if (gobierna) return true;
  if (contexto && contexto.rol === 'GERENCIA') return true;
  return ROLES_SGC_LECTURA_TOTAL.indexOf(rol) !== -1;
}

function puedeVerDocumento_(doc, contexto, rol, area, gobierna, destinatarios) {
  if (veTodoSgc_(contexto, rol, gobierna)) return true;
  // Retirado de circulacion: el personal no debe poder toparse con una
  // version que ya no rige (PRO-01 §4.3).
  if (doc.estado === 'OBSOLETO') return false;

  if (doc.visibilidad === 'TODOS') return true;
  if (doc.visibilidad === 'AREA') {
    return !!area && String(doc.area_id || '') === String(area);
  }
  if (doc.visibilidad === 'SELECCION') {
    var email = normalizarEmailSgc_(contexto && contexto.email);
    return (destinatarios || []).some(function (d) {
      return d.documento_id === doc.documento_id && normalizarEmailSgc_(d.usuario_email) === email;
    });
  }
  return false;
}

// --- audiencia obligada a acusar (Fase 1b) ---------------------------------

// Quienes DEBEN confirmar que conocen el documento. Se deriva de la
// visibilidad, no se declara aparte: si alguien no puede ver el documento,
// exigirle el acuse seria absurdo (y un hallazgo de auditoria al reves).
//
//  - SELECCION -> exactamente las personas indicadas.
//  - TODOS/AREA -> el personal registrado en SGC_ROLES (que es, por
//    definicion, "el personal en alcance del SGC"), filtrado por area.
//
// Se excluye siempre al AUDITOR_EXTERNO (no forma parte del personal: no
// tiene por que acusar documentos internos) y a quien cargo el documento
// (mismo criterio que Novedades con el autor).
function audienciaDocumentoSgc_(doc) {
  var creador = normalizarEmailSgc_(doc.creado_por);
  if (doc.visibilidad === 'SELECCION') {
    return leerFilasSeguro_(SHEETS.SGC_DOC_DESTINATARIOS)
      .filter(function (d) { return d.documento_id === doc.documento_id; })
      .map(function (d) { return normalizarEmailSgc_(d.usuario_email); })
      .filter(function (e) { return e && e !== creador; });
  }
  var vistos = {};
  return leerFilasSeguro_(SHEETS.SGC_ROLES)
    .filter(function (r) {
      if (!esVerdaderoActivoSgc_(r)) return false;
      if (r.rol_sgc === 'AUDITOR_EXTERNO') return false;
      if (doc.visibilidad === 'AREA') return String(r.area_id || '') === String(doc.area_id || '');
      return true; // TODOS
    })
    .map(function (r) { return normalizarEmailSgc_(r.usuario_email); })
    .filter(function (e) {
      if (!e || e === creador || vistos[e]) return false;
      vistos[e] = true;
      return true;
    });
}

// Documentos VIGENTES que exigen acuse y que esta persona todavia no
// confirmo en su version vigente.
function documentosPendientesDeAcuse_(email, docs, acuses) {
  var normalizado = normalizarEmailSgc_(email);
  var yaAcuso = {};
  (acuses || []).forEach(function (a) {
    if (normalizarEmailSgc_(a.usuario_email) === normalizado) {
      yaAcuso[a.documento_id + '|' + a.version] = true;
    }
  });
  return (docs || []).filter(function (d) {
    if (!esActivoSgc_(d) || d.estado !== 'VIGENTE' || !esVerdaderoSgc_(d.requiere_acuse)) return false;
    if (yaAcuso[d.documento_id + '|' + d.version_vigente]) return false;
    return audienciaDocumentoSgc_(d).indexOf(normalizado) !== -1;
  });
}

// --- helpers ---------------------------------------------------------------

function buscarDocumentoSgc_(documentoId) {
  if (!documentoId) return null;
  var filas = leerFilasSeguro_(SHEETS.SGC_DOCUMENTOS);
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].documento_id === documentoId && esActivoSgc_(filas[i])) return filas[i];
  }
  return null;
}

// PRO-01: revision periodica cada 12 meses.
function proximaRevisionSgc_(fechaVigencia) {
  var f = new Date(fechaVigencia);
  if (isNaN(f.getTime())) return '';
  var proxima = new Date(f.getTime());
  proxima.setFullYear(proxima.getFullYear() + 1);
  return proxima.toISOString();
}

function esRevisionVencida_(proximaRevision, ahora) {
  if (!proximaRevision) return false;
  var f = new Date(proximaRevision);
  if (isNaN(f.getTime())) return false;
  return f < (ahora || new Date());
}

function diasHastaSgc_(fecha, ahora) {
  if (!fecha) return null;
  var f = new Date(fecha);
  if (isNaN(f.getTime())) return null;
  return Math.round((f - (ahora || new Date())) / 86400000);
}

// Valida por bytes y sube a la carpeta privada del SGC en Drive.
function subirArchivoSgc_(data, codigo) {
  if (!data.nombre_archivo) {
    return errorValidacion_('nombre_archivo', 'Falta el nombre del archivo.');
  }
  var bytes;
  try {
    bytes = Utilities.base64Decode(data.contenido_base64);
  } catch (err) {
    return errorValidacion_('contenido_base64', 'El archivo no es base64 válido.');
  }
  if (!bytes.length) return errorValidacion_('contenido_base64', 'El archivo está vacío.');
  if (bytes.length > MAX_ARCHIVO_SGC_BYTES) {
    return errorValidacion_('contenido_base64',
      'El archivo supera el tamaño máximo (' + Math.round(MAX_ARCHIVO_SGC_BYTES / (1024 * 1024)) + ' MB).');
  }
  var mime = mimeArchivoSgc_(bytes, data.nombre_archivo);
  if (!mime) {
    return errorValidacion_('contenido_base64', 'Formato no admitido. Se aceptan PDF, Word (.docx/.doc) y Excel (.xlsx/.xls).');
  }
  var carpeta = obtenerCarpetaCalidad_();
  var nombreFinal = codigo ? (codigo + ' - ' + data.nombre_archivo) : data.nombre_archivo;
  var archivoDrive = carpeta.createFile(Utilities.newBlob(bytes, mime, nombreFinal));
  return {
    archivo_id: archivoDrive.getId(),
    archivo_nombre: data.nombre_archivo,
    archivo_mime: mime
  };
}

function coincideFirmaSgc_(bytes, firma) {
  if (!bytes || bytes.length < firma.length) return false;
  for (var i = 0; i < firma.length; i++) {
    // base64Decode devuelve bytes con signo (-128..127); se normaliza.
    if ((bytes[i] & 0xFF) !== firma[i]) return false;
  }
  return true;
}

// El tipo real lo decide la FIRMA del archivo; la extension solo desempata
// entre docx y xlsx, que comparten firma ZIP.
function mimeArchivoSgc_(bytes, nombre) {
  var ext = String(nombre || '').toLowerCase().split('.').pop();
  if (coincideFirmaSgc_(bytes, FIRMA_PDF_SGC)) return 'application/pdf';
  if (coincideFirmaSgc_(bytes, FIRMA_ZIP_SGC)) {
    if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (ext === 'pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    return '';
  }
  if (coincideFirmaSgc_(bytes, FIRMA_OLE_SGC)) {
    if (ext === 'doc') return 'application/msword';
    if (ext === 'xls') return 'application/vnd.ms-excel';
    return '';
  }
  return '';
}

function registrarVersionSgc_(documentoId, version, cambios, archivo, contexto, vigente) {
  var fila = {
    version_id: Utilities.getUuid(),
    documento_id: documentoId,
    version: version,
    cambios: cambios || '',
    archivo_id: archivo.archivo_id,
    archivo_nombre: archivo.archivo_nombre,
    archivo_mime: archivo.archivo_mime,
    subido_por: (contexto && contexto.email) || '',
    fecha: new Date().toISOString(),
    vigente: !!vigente
  };
  agregarFila_(SHEETS.SGC_DOC_VERSIONES, fila);
  return fila;
}

// Deja el historial de versiones apuntando al archivo recien adjuntado.
// Si la version vigente ya tiene fila, se le actualiza el archivo; si no
// existe (documento cargado directo en la planilla, sin pasar por la app),
// se crea -- de otro modo el detalle mostraria un documento con archivo
// pero sin ninguna version que lo respalde.
function sincronizarArchivoVersionSgc_(doc, archivo, contexto) {
  var fila = leerFilasSeguro_(SHEETS.SGC_DOC_VERSIONES).filter(function (v) {
    return v.documento_id === doc.documento_id &&
      String(v.version) === String(doc.version_vigente);
  })[0];

  if (!fila) {
    return registrarVersionSgc_(doc.documento_id, doc.version_vigente,
      'Archivo adjuntado a la versión vigente.', archivo, contexto, true);
  }
  return actualizarFilaPorId_(SHEETS.SGC_DOC_VERSIONES, 'version_id', fila.version_id, {
    archivo_id: archivo.archivo_id,
    archivo_nombre: archivo.archivo_nombre,
    archivo_mime: archivo.archivo_mime,
    subido_por: (contexto && contexto.email) || '',
    fecha: new Date().toISOString(),
    vigente: true
  });
}

// Reescribe la lista de destinatarios explicitos. Solo aplica a
// visibilidad SELECCION; en TODOS/AREA se limpia para que no queden filas
// huerfanas que confundan despues.
function guardarDestinatariosSgc_(documentoId, visibilidad, destinatarios) {
  var actuales = leerFilasSeguro_(SHEETS.SGC_DOC_DESTINATARIOS)
    .filter(function (d) { return d.documento_id === documentoId; });
  var deseados = {};
  if (visibilidad === 'SELECCION') {
    (destinatarios || []).forEach(function (email) {
      var normalizado = normalizarEmailSgc_(email);
      if (normalizado) deseados[normalizado] = true;
    });
  }
  actuales.forEach(function (d) {
    var email = normalizarEmailSgc_(d.usuario_email);
    if (deseados[email]) {
      delete deseados[email]; // ya estaba, no duplicar
    } else {
      // No hay borrado fisico en SheetsRepo: se vacia el vinculo.
      actualizarFilaPorId_(SHEETS.SGC_DOC_DESTINATARIOS, 'destinatario_id', d.destinatario_id, { documento_id: '' });
    }
  });
  Object.keys(deseados).forEach(function (email) {
    agregarFila_(SHEETS.SGC_DOC_DESTINATARIOS, {
      destinatario_id: Utilities.getUuid(),
      documento_id: documentoId,
      usuario_email: email
    });
  });
}

// §15.2 de la especificacion: log de auditoria del SGC. Mismo patron de
// escritura directa a LOG_SISTEMA que usa el resto de SIGSO.
function registrarLogSgc_(accion, detalle, contexto) {
  try {
    agregarFila_(SHEETS.LOG_SISTEMA, {
      log_id: Utilities.getUuid(),
      timestamp: new Date().toISOString(),
      contexto: accion,
      mensaje: ((contexto && contexto.email) || '') + ' → ' + detalle,
      ref: 'SGC'
    });
  } catch (err) {
    // El log es trazabilidad, no el flujo principal: si falla, la accion
    // del usuario no debe caerse (mismo criterio que el resto de SIGSO).
  }
}
