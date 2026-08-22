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

    // v10.0 "Tablero": conteos SOBRE LO VISIBLE PARA ESTA PERSONA, antes de
    // aplicar tipo/estado/busqueda -- para que el resumen de arriba no varie
    // cuando la persona solo esta filtrando la lista de abajo.
    var resumen = {
      total: visibles.length,
      vigentes: visibles.filter(function (d) { return d.estado === 'VIGENTE'; }).length,
      obsoletos: visibles.filter(function (d) { return d.estado === 'OBSOLETO'; }).length
    };

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
      // v10.0 "Accesos SGC": el frontend usa esto para no mostrar pestanas
      // que la persona no puede abrir (el backend igual bloquea cada una).
      secciones_visibles: seccionesVisiblesSgc_(contexto),
      pendientes_de_acuse: Object.keys(pendientesMios).length,
      resumen: resumen,
      // v10.0 Fase 6b: mismo catalogo que expone Auditorias.gs -- para que
      // el formulario de documento pueda ofrecer el selector de clausulas
      // ISO sin duplicar la lista en el frontend.
      catalogo_clausulas: CLAUSULAS_ISO9001,
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
          dias_para_acuse: d.fecha_limite_acuse ? diasHastaSgc_(d.fecha_limite_acuse, ahora) : null,
          clausulas_iso: parsearClausulasIsoSgc_(d.clausulas_iso)
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
      documento: Object.assign({}, doc, { clausulas_iso: parsearClausulasIsoSgc_(doc.clausulas_iso) }),
      puede_gestionar: gobierna,
      catalogo_clausulas: CLAUSULAS_ISO9001,
      debo_acusar: debeAcusar,
      mi_acuse: miAcuse ? miAcuse.acusado_en : '',
      versiones: versiones,
      destinatarios: doc.visibilidad === 'SELECCION'
        ? destinatarios.filter(function (x) { return x.documento_id === doc.documento_id; })
            .map(function (x) { return x.usuario_email; })
        : []
    };
  },

  /**
   * v11.0 Fase 5 (§7.5.3.2): carga los seis documentos de origen externo del
   * FO-PRO-01-01 (hoja "Externos"). Se ofrecen, no se siembran solos, igual
   * que el resto de las cargas iniciales del modulo.
   *
   * Nacen SIN archivo y sin elaborador/revisor/aprobador: de un documento
   * externo la organizacion no controla la version, solo lo identifica y
   * controla su distribucion.
   */
  sembrarDocumentosExternos: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede cargar el listado de documentos externos.' };
    }

    var existentes = leerFilasSeguro_(SHEETS.SGC_DOCUMENTOS).filter(esActivoSgc_);
    var porCodigo = {};
    existentes.forEach(function (d) { porCodigo[String(d.codigo || '').toUpperCase()] = true; });

    var ahora = new Date().toISOString();
    var creados = 0;
    var omitidos = [];

    DOCUMENTOS_EXTERNOS_FO0101.forEach(function (e) {
      if (porCodigo[e.codigo.toUpperCase()]) { omitidos.push(e.codigo); return; }
      agregarFila_(SHEETS.SGC_DOCUMENTOS, {
        documento_id: Utilities.getUuid(),
        codigo: e.codigo,
        nombre: e.nombre,
        descripcion: e.descripcion || '',
        tipo: 'EXTERNO',
        area_id: e.area_id || '',
        version_vigente: '',
        estado: 'VIGENTE',
        // Un texto legal o una norma la conoce quien la necesita para su
        // trabajo, no toda la organizacion: la distribucion se define
        // documento por documento, y por eso nace en SELECCION sin nadie.
        visibilidad: 'SELECCION',
        fecha_vigencia: '',
        proxima_revision: FECHA_REVISION_EXTERNOS_FO0101,
        elaborado_por: '',
        revisado_por: '',
        aprobado_por: '',
        archivo_id: '',
        archivo_nombre: '',
        archivo_mime: '',
        creado_por: (contexto && contexto.email) || '',
        fecha_creacion: ahora,
        activa: true,
        // Sin acuse: no se le puede exigir a nadie que confirme que "conoce"
        // el Codigo del Trabajo entero. El acuse es para los documentos que
        // la organizacion redacta y distribuye.
        requiere_acuse: false,
        fecha_limite_acuse: '',
        clausulas_iso: JSON.stringify([]),
        emisor: e.emisor || '',
        clase_externa: e.clase_externa || ''
      });
      creados++;
    });

    registrarLogSgc_('SGC_DOC_EXTERNOS_SEMBRADOS',
      creados + ' documentos externos del FO-PRO-01-01 cargados', contexto);
    return {
      ok: true, total: creados, omitidos: omitidos,
      message: creados
        ? creados + ' documento(s) externo(s) cargado(s).' +
          (omitidos.length ? ' Ya existían: ' + omitidos.join(', ') + '.' : '')
        : 'Ya estaban todos cargados.'
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
      fecha_limite_acuse: data.fecha_limite_acuse || '',
      // v10.0 Fase 6b: que clausulas ISO sustenta este documento como
      // evidencia (matriz de cobertura). Nace vacio -- taggearlo es un acto
      // deliberado del Encargado SGC, no una inferencia del sistema.
      clausulas_iso: JSON.stringify(clausulasIsoValidas_(data.clausulas_iso)),
      // v11.0 Fase 5: solo tienen sentido en un documento externo; en uno
      // interno quedan vacios y no estorban.
      emisor: String(data.emisor || '').trim(),
      clase_externa: String(data.clase_externa || '').trim()
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
    if (data.clausulas_iso !== undefined) {
      cambios.clausulas_iso = JSON.stringify(clausulasIsoValidas_(data.clausulas_iso));
    }

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
    // v10.0 "Accesos SGC": repartir accesos es admin-only (mas estricto que
    // gobiernaSgc_ a proposito -- ver esAdminSgc_).
    if (!esAdminSgc_(contexto)) {
      return { _forbidden: true, message: 'Solo el administrador del sistema puede ver los accesos del SGC.' };
    }
    return leerFilasSeguro_(SHEETS.SGC_ROLES).filter(esVerdaderoActivoSgc_);
  },

  gestionarRol: function (data, contexto) {
    if (!esAdminSgc_(contexto)) {
      return { _forbidden: true, message: 'Solo el administrador del sistema puede asignar accesos del SGC.' };
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
    registrarLogSgc_('SGC_ACCESO_ASIGNADO', data.rol_sgc + ' -> ' + email, contexto);
    return fila;
  },

  // v10.0 "Accesos SGC": el panel admin-only de "quien ve que". Cruza las
  // cuentas reales (portal + Google) con su rol SGC y su area, mas el
  // catalogo de roles/areas y un chequeo de enrolamiento para el go-live.
  listarAccesos: function (data, contexto) {
    if (!esAdminSgc_(contexto)) {
      return { _forbidden: true, message: 'Solo el administrador del sistema puede administrar los accesos del SGC.' };
    }
    var rolesPorEmail = {};
    leerFilasSeguro_(SHEETS.SGC_ROLES).filter(esVerdaderoActivoSgc_).forEach(function (r) {
      rolesPorEmail[normalizarEmailSgc_(r.usuario_email)] = r;
    });

    var cuentas = directorioPersonalActivo_().map(function (p) {
      var r = rolesPorEmail[normalizarEmailSgc_(p.email)];
      return {
        email: p.email,
        nombre: p.nombre,
        rol_sgc: r ? r.rol_sgc : '',
        area_id: r ? (r.area_id || '') : '',
        vigencia_hasta: r ? (r.vigencia_hasta || '') : '',
        rol_id: r ? r.rol_id : ''
      };
    }).sort(function (a, b) { return String(a.nombre || '').localeCompare(String(b.nombre || '')); });

    // Enrolamiento para el go-live: personas del alcance del SGC
    // (SGC_PERSONAS) que todavia no tienen cuenta con que entrar, y roles
    // asignados a un correo que ya no tiene cuenta activa (residuo a limpiar).
    var emailsCuenta = {};
    cuentas.forEach(function (c) { emailsCuenta[normalizarEmailSgc_(c.email)] = true; });
    var personasSinCuenta = leerFilasSeguro_(SHEETS.SGC_PERSONAS)
      .filter(function (p) { return esActivoSgc_(p) && p.estado !== 'DESVINCULADO' && p.usuario_email; })
      .filter(function (p) { return !emailsCuenta[normalizarEmailSgc_(p.usuario_email)]; })
      .map(function (p) { return { nombre: p.nombre, email: p.usuario_email }; });
    var rolesSinCuenta = leerFilasSeguro_(SHEETS.SGC_ROLES).filter(esVerdaderoActivoSgc_)
      .filter(function (r) { return !emailsCuenta[normalizarEmailSgc_(r.usuario_email)]; })
      .map(function (r) { return { email: r.usuario_email, rol_sgc: r.rol_sgc }; });

    return {
      cuentas: cuentas,
      areas: leerFilasSeguro_(SHEETS.CAT_AREAS).filter(esVerdaderoActivoSgc_)
        .map(function (a) { return { area_id: a.area_id, nombre: a.nombre }; }),
      roles: catalogoRolesSgc_(),
      enrolamiento: { personas_sin_cuenta: personasSinCuenta, roles_sin_cuenta: rolesSinCuenta }
    };
  },

  // "¿Que veria esta persona?" -- la "carpeta de acceso" completa de una
  // cuenta: rol, area, secciones, documentos (marcando los confidenciales y
  // si ya los confirmo), alcance de fichas, y su historial de descargas.
  // Es la red de seguridad del go-live (y le encanta al auditor). Admin-only.
  previsualizarAcceso: function (data, contexto) {
    if (!esAdminSgc_(contexto)) {
      return { _forbidden: true, message: 'Solo el administrador del sistema puede previsualizar accesos.' };
    }
    var email = normalizarEmailSgc_(data && data.email);
    if (!email) return errorValidacion_('email', 'Indica la cuenta a previsualizar.');

    // Contexto sintetico: la persona como PERSONAL (rol SIGSO neutro, no
    // admin/gerencia). Es el caso que importa para "el operativo no ve lo
    // ajeno". Pero si la cuenta ADEMAS tiene un rol de SIGSO (ADM/GERENCIA)
    // que le da lectura total, el "que ve" de aqui abajo se quedaria corto
    // -- por eso se informa aparte con rol_sistema/acceso_amplio_sistema,
    // en vez de simularlo como si no existiera.
    var ctx = { email: email, rol: '' };
    var rol = rolSgc_(ctx);
    var area = areaSgc_(ctx);
    var gobierna = gobiernaSgc_(ctx, rol);
    var veTodo = veTodoSgc_(ctx, rol, gobierna);
    var destinatarios = leerFilasSeguro_(SHEETS.SGC_DOC_DESTINATARIOS);
    var acuses = leerFilasSeguro_(SHEETS.SGC_DOC_ACUSES).filter(function (a) {
      return normalizarEmailSgc_(a.usuario_email) === email;
    });
    var acusoVersion = {};
    acuses.forEach(function (a) { acusoVersion[a.documento_id + '::' + a.version] = a.acusado_en; });

    var docs = leerFilasSeguro_(SHEETS.SGC_DOCUMENTOS).filter(esActivoSgc_)
      .filter(function (d) { return puedeVerDocumento_(d, ctx, rol, area, gobierna, destinatarios); })
      .map(function (d) {
        var requiereAcuse = esVerdaderoSgc_(d.requiere_acuse);
        return {
          codigo: d.codigo, nombre: d.nombre, visibilidad: d.visibilidad,
          confidencial: d.visibilidad === 'SELECCION',
          requiere_acuse: requiereAcuse,
          confirmado: requiereAcuse ? !!acusoVersion[d.documento_id + '::' + d.version_vigente] : null
        };
      })
      .sort(function (a, b) { return String(a.codigo || '').localeCompare(String(b.codigo || '')); });
    var pendientesAcuse = docs.filter(function (d) { return d.requiere_acuse && !d.confirmado; }).length;

    var personasScope;
    if (veTodo) {
      personasScope = 'todas las fichas';
    } else {
      var equipo = obtenerEquipoJefe_(email) || [];
      personasScope = equipo.length ? ('su propia ficha + su equipo (' + equipo.length + ')') : 'solo su propia ficha';
    }

    var rolSistema = rolCuentaSigsoPorEmail_(email);

    // Historial de descargas: registrarLogSgc_ escribe "<email> -> <detalle>"
    // en LOG_SISTEMA con contexto SGC_DOC_DESCARGADO -- se lee el mismo
    // formato, sin tocar el log (que es compartido con el resto de SIGSO).
    var descargas = leerFilasSeguro_(SHEETS.LOG_SISTEMA).filter(function (l) {
      return l.contexto === 'SGC_DOC_DESCARGADO' && normalizarEmailSgc_(String(l.mensaje || '').split(' → ')[0]) === email;
    }).sort(function (a, b) { return String(b.timestamp || '').localeCompare(String(a.timestamp || '')); })
      .slice(0, 15)
      .map(function (l) { return { timestamp: l.timestamp, detalle: String(l.mensaje || '').split(' → ')[1] || '' }; });

    return {
      email: email,
      rol_sgc: rol || '',
      area_id: area || '',
      rol_sistema: rolSistema || '',
      acceso_amplio_sistema: rolSistema === 'ADM' || rolSistema === 'GERENCIA',
      documentos: docs,
      total_documentos: docs.length,
      pendientes_acuse: pendientesAcuse,
      personas_scope: personasScope,
      secciones: seccionesVisiblesSgc_(ctx),
      descargas_recientes: descargas
    };
  },

  // v10.0 "Centro de Control de Accesos": matriz personas x documentos.
  // Responde de un vistazo "¿quien puede ver y quien ya confirmo cada
  // documento vigente?" -- la evidencia de distribucion que pide ISO
  // §7.5.3 y el tablero de control que el admin necesita para no tener que
  // abrir documento por documento. Admin-only (mismo poder que Accesos).
  getMatrizDistribucion: function (data, contexto) {
    if (!esAdminSgc_(contexto)) {
      return { _forbidden: true, message: 'Solo el administrador del sistema puede ver la matriz de distribución.' };
    }
    var destinatarios = leerFilasSeguro_(SHEETS.SGC_DOC_DESTINATARIOS);
    var acuses = leerFilasSeguro_(SHEETS.SGC_DOC_ACUSES);
    var docs = leerFilasSeguro_(SHEETS.SGC_DOCUMENTOS).filter(esActivoSgc_)
      .filter(function (d) { return d.estado === 'VIGENTE'; })
      .sort(function (a, b) { return String(a.codigo || '').localeCompare(String(b.codigo || '')); });

    var filas = directorioPersonalActivo_().map(function (p) {
      var email = normalizarEmailSgc_(p.email);
      var ctx = { email: p.email, rol: '' };
      var rol = rolSgc_(ctx);
      var area = areaSgc_(ctx);
      var gobierna = gobiernaSgc_(ctx, rol);
      var celdas = docs.map(function (d) {
        if (!puedeVerDocumento_(d, ctx, rol, area, gobierna, destinatarios)) return { estado: 'no' };
        if (!esVerdaderoSgc_(d.requiere_acuse)) return { estado: 'na' };
        var confirmado = acuses.some(function (a) {
          return a.documento_id === d.documento_id && a.version === d.version_vigente &&
            normalizarEmailSgc_(a.usuario_email) === email;
        });
        return { estado: confirmado ? 'confirmado' : 'pendiente' };
      });
      return { email: p.email, nombre: p.nombre, celdas: celdas };
    }).sort(function (a, b) { return String(a.nombre || '').localeCompare(String(b.nombre || '')); });

    return {
      documentos: docs.map(function (d) { return { codigo: d.codigo, nombre: d.nombre }; }),
      personas: filas
    };
  },

  // v10.0 "Centro de Control de Accesos": todos los documentos de acceso
  // restringido (SELECCION) y exactamente quien esta en cada lista -- para
  // revisar de un vistazo que nadie sobra antes de abrir el modulo.
  // Admin-only.
  getDocumentosConfidenciales: function (data, contexto) {
    if (!esAdminSgc_(contexto)) {
      return { _forbidden: true, message: 'Solo el administrador del sistema puede ver esto.' };
    }
    var destinatarios = leerFilasSeguro_(SHEETS.SGC_DOC_DESTINATARIOS);
    var nombrePorEmail = {};
    directorioPersonalActivo_().forEach(function (p) { nombrePorEmail[normalizarEmailSgc_(p.email)] = p.nombre; });

    return leerFilasSeguro_(SHEETS.SGC_DOCUMENTOS).filter(esActivoSgc_)
      .filter(function (d) { return d.visibilidad === 'SELECCION'; })
      .sort(function (a, b) { return String(a.codigo || '').localeCompare(String(b.codigo || '')); })
      .map(function (d) {
        var lista = destinatarios.filter(function (x) { return x.documento_id === d.documento_id; })
          .map(function (x) {
            var email = normalizarEmailSgc_(x.usuario_email);
            return { email: x.usuario_email, nombre: nombrePorEmail[email] || x.usuario_email };
          });
        return { documento_id: d.documento_id, codigo: d.codigo, nombre: d.nombre, estado: d.estado, destinatarios: lista };
      });
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

// --- v11.0 Fase 5 (§7.5.3.2): documentos de origen externo ------------------
//
// La norma los trata distinto que a los internos, y la diferencia importa:
// de un documento externo la organizacion NO controla la version -- no puede
// elaborarlo, revisarlo ni aprobarlo. Lo que tiene que hacer es
// IDENTIFICARLO y controlar su DISTRIBUCION. Por eso estos registros nacen
// sin elaborador/revisor/aprobador y, casi siempre, sin archivo adjunto:
// nadie sube el texto de la Ley 16.744 a un Drive.
//
// Lo que si tiene fecha real es la REVISION: hay que volver a mirarlos cada
// cierto tiempo para ver si salio una edicion nueva. El FO-PRO-01-01 fija
// esa revision al 2027-03-01 para los seis.
//
// La fecha de entrada en vigencia va vacia a proposito: el documento solo
// declara el AÑO de la edicion (2015, 1968...), que ya viaja en el codigo y
// el nombre. Inventar un dia y un mes seria poner en el sistema una
// precision que el documento no tiene.
var FECHA_REVISION_EXTERNOS_FO0101 = '2027-03-01';

var DOCUMENTOS_EXTERNOS_FO0101 = [
  {
    codigo: 'ISO 9001:2015',
    nombre: 'Sistemas de gestión de la calidad — Requisitos',
    clase_externa: 'Norma',
    emisor: 'ISO (Organización Internacional de Normalización)',
    area_id: 'CALIDAD',
    descripcion: 'Norma sobre la que se certifica el SGC. Edición 2015.'
  },
  {
    codigo: 'ISO 19011:2018',
    nombre: 'Directrices para la auditoría de los sistemas de gestión',
    clase_externa: 'Norma',
    emisor: 'ISO (Organización Internacional de Normalización)',
    area_id: 'CALIDAD',
    descripcion: 'Referencia metodológica para el programa de auditorías internas (PRO-03).'
  },
  {
    codigo: 'DS 44',
    nombre: 'Aprueba nuevo reglamento sobre gestión preventiva de los riesgos laborales para un entorno de trabajo seguro y saludable',
    clase_externa: 'Decreto',
    emisor: 'Ministerio del Trabajo y Previsión Social (Chile)',
    area_id: 'PREVENCION',
    descripcion: 'Vigente desde 2025.'
  },
  {
    codigo: 'Ley 16.744',
    nombre: 'Establece normas sobre accidentes del trabajo y enfermedades profesionales',
    clase_externa: 'Ley',
    emisor: 'Congreso Nacional de Chile',
    area_id: 'PREVENCION',
    descripcion: 'Vigente desde 1968.'
  },
  {
    codigo: 'DS 594',
    nombre: 'Aprueba reglamento sobre condiciones sanitarias y ambientales básicas en los lugares de trabajo',
    clase_externa: 'Decreto',
    emisor: 'Ministerio de Salud (Chile)',
    area_id: 'PREVENCION',
    descripcion: 'Vigente desde 2000.'
  },
  {
    codigo: 'Código del Trabajo',
    nombre: 'Derechos y obligaciones de los trabajadores',
    clase_externa: 'Código',
    emisor: 'Ministerio del Trabajo y Previsión Social (Chile)',
    area_id: 'RRHH',
    descripcion: 'Texto refundido vigente.'
  }
];

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

// v10.0 Fase 6b: etiquetado de un documento con las clausulas ISO que
// sustenta. CLAUSULAS_ISO9001 vive en Auditorias.gs (catalogo compartido de
// las 28 clausulas auditables) -- se referencia aca porque es la misma
// lista, no una copia: taggear con un codigo que la auditoria no reconoce
// rompe el cruce con la matriz de cobertura.
function clausulasIsoValidas_(valor) {
  var lista = Array.isArray(valor) ? valor : [];
  var codigos = CLAUSULAS_ISO9001.map(function (c) { return c.codigo; });
  var vistos = {};
  return lista
    .map(function (c) { return String(c || '').trim(); })
    .filter(function (c) { return c && codigos.indexOf(c) !== -1 && !vistos[c] && (vistos[c] = true); });
}

function parsearClausulasIsoSgc_(valor) {
  if (!valor) return [];
  try {
    var lista = JSON.parse(valor);
    return Array.isArray(lista) ? lista : [];
  } catch (err) { return []; }
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

// v10.0 "Accesos SGC": gate ESTRICTO, solo el administrador de SIGSO. Es
// deliberadamente mas cerrado que gobiernaSgc_: repartir accesos (quien ve
// que) es el poder mas sensible del modulo, y el cliente pidio que sea
// exclusivo de su cuenta -- ni siquiera un ENCARGADO_SGC puede hacerlo. Asi
// se separan dos poderes que antes iban juntos: gestionar el CONTENIDO
// (documentos, NC, etc. -> gobiernaSgc_) vs gestionar los ACCESOS (-> esto).
function esAdminSgc_(contexto) {
  return !!contexto && contexto.rol === 'ADM';
}

// Que SECCIONES del modulo puede abrir esta persona. El principio: el rol
// define las secciones, la visibilidad del documento define los documentos,
// y los datos personales son siempre solo-propios (o de equipo para una
// jefatura). Un operativo ve Documentos + su ficha, y solo las NC /
// auditorias / quejas donde figura. El resto (gobierno del SGC) es de
// gestion. El backend YA bloquea cada seccion por su cuenta; esto es lo que
// permite al frontend no mostrar pestanas que igual darian "sin acceso".
function seccionesVisiblesSgc_(contexto) {
  var rol = rolSgc_(contexto);
  var gobierna = gobiernaSgc_(contexto, rol);
  var veTodo = veTodoSgc_(contexto, rol, gobierna);
  var esAdmin = esAdminSgc_(contexto);
  var email = normalizarEmailSgc_(contexto && contexto.email);

  // NC / auditorias / quejas: quien gestiona las ve todas; el resto ve una
  // pestana solo si tiene al menos una donde figura (asi el operativo sin
  // nada asignado no ve pestanas vacias). El detalle de cada una lo sigue
  // filtrando su propio modulo.
  function tieneAlgunaAsignada_(hoja, campos) {
    if (veTodo) return true;
    if (!email) return false;
    return leerFilasSeguro_(hoja).some(function (fila) {
      if (!esVerdaderoSgc_(fila.activa)) return false;
      return campos.some(function (c) { return normalizarEmailSgc_(fila[c]) === email; });
    });
  }

  return {
    documentos: true,
    personas: true,
    // v11.0 Fase 1: el alcance lo ve cualquiera que entre a Calidad. §4.3 pide
    // que este "disponible" -- es lo mas publico que tiene un SGC, y saber
    // que cubre el sistema es lo primero que necesita quien trabaja en el.
    // Declararlo sigue siendo del Encargado (gobiernaSgc_ dentro del modulo).
    alcance: true,
    // v11.0 Fase 2: mismo criterio. Saber en que entorno opera la
    // organizacion y quienes son sus partes interesadas es toma de
    // conciencia (§7.3), no informacion reservada.
    contexto: true,
    // v11.0 Fase 3: la matriz de riesgos NO sigue ese criterio. Expone
    // debilidades del negocio (falta de contratos, dependencia de
    // plataformas) que no corresponde repartir a todo el personal, asi que
    // se restringe a quien ya tiene lectura amplia del SGC.
    riesgos: veTodo,
    // v11.0 Fase 4: el mapa de procesos si es de todos -- saber como
    // opera la organizacion es parte de la toma de conciencia (§7.3).
    procesos: true,
    nc: tieneAlgunaAsignada_(SHEETS.SGC_NC, ['responsable_email', 'detectada_por']),
    auditorias: tieneAlgunaAsignada_(SHEETS.SGC_AUDITORIAS, ['auditor_email']),
    quejas: veTodo, // el flujo de quejas es de gestion; el solicitante externo no entra al modulo
    capacitaciones: veTodo,
    proveedores: veTodo,
    revision: veTodo,
    objetivos: veTodo,
    cobertura: veTodo,
    accesos: esAdmin
  };
}

// Lectura total (incluye obsoletos): quien gobierna, mas Direccion,
// Gerencia y el auditor externo vigente. GERENCIA de SIGSO tambien, por el
// mismo criterio de solo-lectura transversal que el resto del sistema.
function veTodoSgc_(contexto, rol, gobierna) {
  if (gobierna) return true;
  if (contexto && contexto.rol === 'GERENCIA') return true;
  return ROLES_SGC_LECTURA_TOTAL.indexOf(rol) !== -1;
}

// v10.0 "Accesos SGC": los roles con etiqueta legible y una linea de que ve
// cada uno -- para que el panel del admin sea auto-explicativo y quede como
// evidencia de "el acceso esta definido por rol/responsabilidad" (lo que el
// auditor espera). El orden va de menor a mayor alcance.
function catalogoRolesSgc_() {
  return [
    { clave: 'OPERATIVO', etiqueta: 'Personal operativo', descripcion: 'Los documentos de acceso general y los de su área, su propia ficha, y solo las NC/auditorías donde figura. Nada más.' },
    { clave: 'JEFATURA_AREA', etiqueta: 'Jefatura de área', descripcion: 'Lo del personal operativo y, además, las fichas de su equipo.' },
    { clave: 'ENC_ADMIN', etiqueta: 'Encargada de Administración', descripcion: 'Personal operativo con foco administrativo (sin lectura total del SGC).' },
    { clave: 'ENCARGADO_SGC', etiqueta: 'Encargado del SGC', descripcion: 'Gestiona todo el contenido del SGC (documentos, personas, NC, auditorías…). NO reparte accesos: eso es exclusivo del administrador.' },
    { clave: 'DIRECCION', etiqueta: 'Dirección', descripcion: 'Lectura total del SGC, incluidos documentos obsoletos. No gestiona.' },
    { clave: 'GERENCIA_ADM', etiqueta: 'Gerencia / Administración', descripcion: 'Lectura total del SGC. No gestiona.' },
    { clave: 'AUDITOR_EXTERNO', etiqueta: 'Auditor externo', descripcion: 'Lectura total temporal (con fecha de vencimiento). No forma parte del personal ni acusa documentos.' }
  ];
}

// Rol REAL de la cuenta SIGSO (ADM/GERENCIA/DEV/ANA/... o el rol de una
// cuenta del portal) -- NO es el rol del SGC. Sirve para advertir en el
// Centro de Control cuando una cuenta, ademas de lo que le toque en el SGC,
// tiene un rol de SIGSO que igual le da lectura total (ADM ve todo por
// gobiernaSgc_, GERENCIA por veTodoSgc_) -- la previsualizacion con
// contexto neutro por si sola no lo cuenta.
function rolCuentaSigsoPorEmail_(email) {
  var norm = normalizarEmailSgc_(email);
  if (!norm) return '';
  var usuario = leerFilasSeguro_(SHEETS.USUARIOS).filter(function (r) {
    return normalizarEmailSgc_(r.email) === norm && esVerdaderoActivoSgc_(r);
  })[0];
  if (usuario) return usuario.rol || '';
  var cuenta = leerFilasSeguro_(SHEETS.CUENTAS_PORTAL).filter(function (c) {
    if (!esVerdaderoActivoSgc_(c)) return false;
    return parsearListaPortal_(c.emails).map(normalizarEmailSgc_).indexOf(norm) !== -1;
  })[0];
  return cuenta ? (cuenta.rol || '') : '';
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
