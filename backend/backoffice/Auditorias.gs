/**
 * Auditorias.gs — v10.0 Fase 3b: auditoría interna (PRO-03, ISO 9001 §9.2).
 *
 * La otra mitad del motor de mejora. La Fase 3a construyó qué pasa cuando
 * algo sale mal; ésta construye el mecanismo por el que la organización
 * ENCUENTRA lo que sale mal, antes de que se lo encuentre el auditor de
 * certificación.
 *
 * El ciclo, tal como lo pide PRO-03:
 *
 *   PROGRAMADA ──plan──► PLANIFICADA ──se realiza──► EJECUTADA
 *        │                                              │
 *   (programa anual)                          (10 días hábiles)
 *                                                       ▼
 *                    CERRADA ◄──todos los hallazgos── INFORMADA
 *                                 canalizados
 *
 * DOS DECISIONES QUE VALE LA PENA EXPLICAR
 *
 * 1) La lista de verificación Y los hallazgos son la misma tabla. Una
 *    cláusula revisada y CONFORME no es un vacío: es evidencia de que se
 *    revisó. Separarlas obligaría a duplicar la cláusula y el aspecto en
 *    dos lados y dejaría sin respuesta la pregunta que el auditor sí hace:
 *    "¿revisaron 7.2? ¿qué vieron?".
 *
 * 2) Un hallazgo de tipo NO_CONFORMIDAD se convierte en una NC de la Fase
 *    3a con un clic, y de ahí en una ACTIVIDAD en "Mi trabajo" de alguien.
 *    Ésa es la cadena completa que el auditor recorre:
 *
 *      auditoría ─► hallazgo ─► no conformidad ─► acción correctiva (= tarea)
 *
 *    Una auditoría no se puede cerrar mientras un hallazgo de no
 *    conformidad siga sin NC. Es justo el punto donde los SGC de papel se
 *    rompen: se levantan hallazgos y nadie los convierte en nada.
 */

var Auditorias = {

  // --- Programa anual ---------------------------------------------------------
  listar: function (data, contexto) {
    var filtros = data || {};
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    var email = normalizarEmailSgc_(contexto.email);
    var miArea = areaSgc_(contexto);

    var todas = leerFilasSeguro_(SHEETS.SGC_AUDITORIAS).filter(esActivoSgc_);
    // Quien gobierna el SGC (y Dirección/Gerencia) ve todo el programa. El
    // auditor ve las suyas, y el personal ve las de su área: si te van a
    // auditar, tienes que poder ver la auditoría y sus hallazgos.
    var visibles = todas.filter(function (a) {
      if (veTodoSgc_(contexto, rol, gobierna)) return true;
      if (normalizarEmailSgc_(a.auditor_email) === email) return true;
      if (miArea && a.area_id === miArea) return true;
      return auditadosDe_(a).indexOf(email) !== -1;
    });

    if (filtros.anio) {
      visibles = visibles.filter(function (a) { return String(a.anio) === String(filtros.anio); });
    }
    if (filtros.abiertas) {
      visibles = visibles.filter(function (a) { return ESTADOS_AUD_ABIERTAS.indexOf(a.estado) !== -1; });
    }

    var hallazgos = leerFilasSeguro_(SHEETS.SGC_AUD_HALLAZGOS).filter(esVerdaderoActivoSgc_);
    var ahora = new Date();

    return {
      puede_gestionar: gobierna,
      anios: aniosConAuditorias_(todas),
      // El catálogo viaja también acá (no solo en el detalle) para que se
      // pueda programar una auditoría sin haber abierto ninguna ficha, y
      // sin que la pantalla tenga que mantener su propia copia de la norma.
      clausulas_catalogo: CLAUSULAS_ISO9001,
      indicadores: indicadoresAud_(todas, hallazgos, ahora),
      auditorias: visibles.map(function (a) {
        return resumenAud_(a, hallazgos, ahora);
      }).sort(function (a, b) {
        return new Date(a.fecha_programada || 0) - new Date(b.fecha_programada || 0);
      })
    };
  },

  getDetalle: function (data, contexto) {
    var aud = buscarAuditoria_(data.auditoria_id);
    if (!aud) return errorValidacion_('auditoria_id', 'Auditoría no encontrada.');
    if (!puedeVerAuditoria_(aud, contexto)) {
      return { _forbidden: true, message: 'No tienes acceso a esta auditoría.' };
    }
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    var todos = leerFilasSeguro_(SHEETS.SGC_AUD_HALLAZGOS).filter(esVerdaderoActivoSgc_);
    var mios = todos.filter(function (h) { return h.auditoria_id === aud.auditoria_id; });
    var ncs = leerFilasSeguro_(SHEETS.SGC_NC);
    var ncPorId = {};
    ncs.forEach(function (nc) { ncPorId[nc.nc_id] = nc; });

    // Resumen de NC para el informe (FO-PRO-03-02: "Resumen de no
    // conformidades" con punto normativo y evidencia objetiva). Se arma al
    // leer, no se guarda: son datos que ya viven en el hallazgo y en la NC.
    var informeNc = mios.filter(function (h) { return h.nc_id; }).map(function (h) {
      var nc = ncPorId[h.nc_id];
      return {
        nc_correlativo: nc ? nc.correlativo : '',
        punto_normativo: h.clausula,
        no_conformidad: nc ? nc.descripcion : h.descripcion,
        evidencia_objetiva: h.evidencia
      };
    });

    return {
      auditoria: Object.assign({}, aud, {
        coauditores: coauditoresDe_(aud),
        personas_entrevistadas: personasEntrevistadasDe_(aud)
      }),
      puede_gestionar: gobierna,
      // El auditor asignado (o cualquier coauditor) registra hallazgos
      // aunque no gobierne el SGC: es quien está haciendo la auditoría. Sin
      // esto habría que ser Encargado SGC para auditar, que es justo lo
      // contrario de lo que pide §9.2.2 (imparcialidad).
      puede_auditar: puedeAuditar_(aud, contexto),
      clausulas_catalogo: CLAUSULAS_ISO9001,
      preguntas_catalogo: PREGUNTAS_VERIFICACION_ISO9001,
      clausulas_alcance: clausulasDe_(aud),
      auditados: auditadosDe_(aud),
      resumen: resumenAud_(aud, todos, new Date()),
      informe_resumen_nc: informeNc,
      hallazgos: mios.map(function (h) {
        var nc = h.nc_id ? ncPorId[h.nc_id] : null;
        return {
          hallazgo_id: h.hallazgo_id,
          clausula: h.clausula,
          clausula_titulo: tituloClausula_(h.clausula),
          aspecto_verificado: h.aspecto_verificado,
          evidencia: h.evidencia,
          resultado: h.resultado,
          descripcion: h.descripcion,
          nc_id: h.nc_id,
          nc_correlativo: nc ? nc.correlativo : '',
          nc_estado: nc ? nc.estado : '',
          registrado_por: h.registrado_por,
          fecha_registro: h.fecha_registro
        };
      }).sort(function (a, b) { return ordenClausula_(a.clausula) - ordenClausula_(b.clausula); })
    };
  },

  // --- 1) Programar (plan anual) ----------------------------------------------
  programar: function (data, contexto) {
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden programar auditorías.' };
    }
    var proceso = String(data.proceso || '').trim();
    if (!proceso) return errorValidacion_('proceso', 'Indica qué proceso se va a auditar.');
    if (!data.fecha_programada) {
      return errorValidacion_('fecha_programada', 'Indica en qué fecha se planea auditar.');
    }
    var auditor = normalizarEmailSgc_(data.auditor_email);
    if (!auditor) return errorValidacion_('auditor_email', 'Asigna un auditor.');

    var areaId = String(data.area_id || '').trim();
    var conflicto = conflictoDeInteres_(auditor, areaId, []);
    if (conflicto) return conflicto;

    var clausulas = normalizarClausulas_(data.clausulas);
    if (!clausulas.length) {
      return errorValidacion_('clausulas', 'Elige al menos una cláusula de la norma a auditar.');
    }

    var ahora = new Date();
    var anio = new Date(data.fecha_programada).getFullYear() || ahora.getFullYear();
    var aud = {
      auditoria_id: Utilities.getUuid(),
      correlativo: siguienteCorrelativoAud_(anio),
      anio: anio,
      area_id: areaId,
      proceso: proceso,
      clausulas: JSON.stringify(clausulas),
      auditor_email: auditor,
      auditados: JSON.stringify([]),
      objetivo: '', alcance: '', criterios: '',
      fecha_programada: data.fecha_programada,
      fecha_plan: '', fecha_ejecucion: '',
      estado: 'PROGRAMADA',
      informe_plazo: '', informe_fecha: '', informe_conclusion: '',
      fecha_cierre: '', cerrada_por: '',
      creada_por: normalizarEmailSgc_(contexto.email),
      fecha_creacion: ahora.toISOString(),
      activa: true
    };
    agregarFila_(SHEETS.SGC_AUDITORIAS, aud);
    registrarLogSgc_('SGC_AUDITORIA_PROGRAMADA', aud.correlativo + ': ' + proceso, contexto);
    encolarNotificacionApp_(auditor, 'SGC_AUDITORIA', 'Te asignaron una auditoría interna',
      aud.correlativo + ': ' + proceso + '. Prepara el plan.', 'calidad', 'Ver auditoría', 120);
    return aud;
  },

  // --- 2) Planificar (FO-PRO-03-02) -------------------------------------------
  planificar: function (data, contexto) {
    var aud = buscarAuditoria_(data.auditoria_id);
    if (!aud) return errorValidacion_('auditoria_id', 'Auditoría no encontrada.');
    if (!puedeAuditar_(aud, contexto)) {
      return { _forbidden: true, message: 'Solo el auditor asignado o el Encargado SGC pueden planificar esta auditoría.' };
    }
    if (['PROGRAMADA', 'PLANIFICADA'].indexOf(aud.estado) === -1) {
      return errorValidacion_('auditoria_id', 'Esta auditoría ya se ejecutó: el plan no se puede cambiar.');
    }
    var objetivo = String(data.objetivo || '').trim();
    if (!objetivo) return errorValidacion_('objetivo', 'Escribe el objetivo de la auditoría.');
    var alcance = String(data.alcance || '').trim();
    if (!alcance) return errorValidacion_('alcance', 'Define el alcance: qué queda dentro y qué no.');
    if (!data.fecha_ejecucion) {
      return errorValidacion_('fecha_ejecucion', 'Indica en qué fecha se realizará.');
    }

    var auditados = (data.auditados || []).map(normalizarEmailSgc_).filter(Boolean);
    // v10.0 Tanda A: PRO-03 habla de "equipo auditor" (plural). auditor_email
    // sigue siendo el lider; coauditores es el resto del equipo, y se define
    // aca (junto con los auditados) porque el conflicto de interes se valida
    // contra ambas listas a la vez.
    var coauditores = (data.coauditores || []).map(normalizarEmailSgc_).filter(Boolean);
    var conflicto = conflictoDeInteres_(aud.auditor_email, aud.area_id, auditados) ||
      coauditoresConConflicto_(coauditores, aud.area_id, auditados);
    if (conflicto) return conflicto;

    var ahora = new Date();
    var actualizada = actualizarFilaPorId_(SHEETS.SGC_AUDITORIAS, 'auditoria_id', aud.auditoria_id, {
      objetivo: objetivo,
      alcance: alcance,
      criterios: String(data.criterios || '').trim(),
      auditados: JSON.stringify(auditados),
      coauditores: JSON.stringify(coauditores),
      fecha_ejecucion: data.fecha_ejecucion,
      fecha_plan: ahora.toISOString(),
      estado: 'PLANIFICADA'
    });
    registrarLogSgc_('SGC_AUDITORIA_PLANIFICADA', aud.correlativo, contexto);

    // El plan se COMUNICA: si nadie lo recibe, no es un plan.
    auditados.forEach(function (email) {
      encolarNotificacionApp_(email, 'SGC_AUDITORIA', 'Auditoría interna programada',
        aud.correlativo + ' — ' + aud.proceso + '. Se realizará el ' +
        String(data.fecha_ejecucion).slice(0, 10) + '.', 'calidad', 'Ver auditoría', 120);
    });
    return actualizada;
  },

  // --- 3) Lista de verificación / hallazgos ------------------------------------
  // Un solo punto de entrada para crear Y editar: llenar una lista de
  // verificación es un ir y venir, no un formulario que se envía una vez.
  registrarHallazgo: function (data, contexto) {
    var aud = buscarAuditoria_(data.auditoria_id);
    if (!aud) return errorValidacion_('auditoria_id', 'Auditoría no encontrada.');
    if (!puedeAuditar_(aud, contexto)) {
      return { _forbidden: true, message: 'Solo el auditor asignado o el Encargado SGC pueden registrar hallazgos.' };
    }
    if (['PLANIFICADA', 'EJECUTADA'].indexOf(aud.estado) === -1) {
      return errorValidacion_('auditoria_id',
        aud.estado === 'PROGRAMADA'
          ? 'Primero planifica la auditoría (objetivo, alcance y fecha).'
          : 'El informe ya se emitió: la lista de verificación queda cerrada.');
    }
    if (!tituloClausula_(data.clausula)) {
      return errorValidacion_('clausula', 'Indica qué cláusula de la norma se está verificando.');
    }
    if (RESULTADOS_HALLAZGO.indexOf(data.resultado) === -1) {
      return errorValidacion_('resultado', 'Indica el resultado de la verificación.');
    }
    var aspecto = String(data.aspecto_verificado || '').trim();
    if (!aspecto) return errorValidacion_('aspecto_verificado', 'Escribe qué se verificó concretamente.');
    // Un "no conforme" sin descripción no le sirve a nadie: es lo que
    // después hay que convertir en no conformidad.
    if (data.resultado !== 'CONFORME' && !String(data.descripcion || '').trim()) {
      return errorValidacion_('descripcion', 'Describe el hallazgo: es lo que después se convierte en no conformidad.');
    }

    var campos = {
      clausula: String(data.clausula),
      aspecto_verificado: aspecto,
      evidencia: String(data.evidencia || '').trim(),
      resultado: data.resultado,
      descripcion: String(data.descripcion || '').trim()
    };

    if (data.hallazgo_id) {
      var previo = buscarHallazgo_(data.hallazgo_id);
      if (!previo) return errorValidacion_('hallazgo_id', 'Hallazgo no encontrado.');
      // Ya convertido en NC: cambiarle el resultado dejaría a la NC
      // huérfana de su origen. Se corrige en la NC, no acá.
      if (previo.nc_id && campos.resultado !== previo.resultado) {
        return errorValidacion_('resultado',
          'Este hallazgo ya generó la no conformidad; su resultado no se puede cambiar.');
      }
      var editado = actualizarFilaPorId_(SHEETS.SGC_AUD_HALLAZGOS, 'hallazgo_id', data.hallazgo_id, campos);
      registrarLogSgc_('SGC_HALLAZGO_EDITADO', aud.correlativo + ' / ' + campos.clausula, contexto);
      return editado;
    }

    var hallazgo = {
      hallazgo_id: Utilities.getUuid(),
      auditoria_id: aud.auditoria_id,
      clausula: campos.clausula,
      aspecto_verificado: campos.aspecto_verificado,
      evidencia: campos.evidencia,
      resultado: campos.resultado,
      descripcion: campos.descripcion,
      nc_id: '',
      registrado_por: normalizarEmailSgc_(contexto.email),
      fecha_registro: new Date().toISOString(),
      activo: true
    };
    agregarFila_(SHEETS.SGC_AUD_HALLAZGOS, hallazgo);
    registrarLogSgc_('SGC_HALLAZGO_REGISTRADO',
      aud.correlativo + ' / ' + campos.clausula + ': ' + campos.resultado, contexto);
    return hallazgo;
  },

  eliminarHallazgo: function (data, contexto) {
    var hallazgo = buscarHallazgo_(data.hallazgo_id);
    if (!hallazgo) return errorValidacion_('hallazgo_id', 'Hallazgo no encontrado.');
    var aud = buscarAuditoria_(hallazgo.auditoria_id);
    if (!aud || !puedeAuditar_(aud, contexto)) {
      return { _forbidden: true, message: 'No puedes modificar los hallazgos de esta auditoría.' };
    }
    if (hallazgo.nc_id) {
      return errorValidacion_('hallazgo_id',
        'Este hallazgo ya generó una no conformidad. Si fue un error, anula la no conformidad.');
    }
    if (['PLANIFICADA', 'EJECUTADA'].indexOf(aud.estado) === -1) {
      return errorValidacion_('hallazgo_id', 'El informe ya se emitió: la lista de verificación queda cerrada.');
    }
    // Baja lógica, como todo en el SGC: la fila queda.
    var borrado = actualizarFilaPorId_(SHEETS.SGC_AUD_HALLAZGOS, 'hallazgo_id', hallazgo.hallazgo_id, {
      activo: false
    });
    registrarLogSgc_('SGC_HALLAZGO_ELIMINADO', aud.correlativo + ' / ' + hallazgo.clausula, contexto);
    return borrado;
  },

  // --- 4) Cerrar la ejecución: arranca el reloj del informe --------------------
  cerrarEjecucion: function (data, contexto) {
    var aud = buscarAuditoria_(data.auditoria_id);
    if (!aud) return errorValidacion_('auditoria_id', 'Auditoría no encontrada.');
    if (!puedeAuditar_(aud, contexto)) {
      return { _forbidden: true, message: 'Solo el auditor asignado o el Encargado SGC pueden cerrar la ejecución.' };
    }
    if (aud.estado !== 'PLANIFICADA') {
      return errorValidacion_('auditoria_id', 'La auditoría no está en ejecución.');
    }
    var hallazgos = hallazgosDe_(aud.auditoria_id);
    if (!hallazgos.length) {
      return errorValidacion_('auditoria_id',
        'Registra al menos una cláusula verificada: una auditoría sin lista de verificación no es evidencia de nada.');
    }
    var ahora = new Date();
    var ejecutada = actualizarFilaPorId_(SHEETS.SGC_AUDITORIAS, 'auditoria_id', aud.auditoria_id, {
      estado: 'EJECUTADA',
      // Si el plan decía otra fecha y se hizo hoy, vale la de hoy: el
      // registro tiene que decir lo que pasó, no lo que se planeó.
      fecha_ejecucion: aud.fecha_ejecucion || ahora.toISOString(),
      informe_plazo: sumarDiasHabilesSgc_(ahora, DIAS_INFORME_AUDITORIA)
    });
    registrarLogSgc_('SGC_AUDITORIA_EJECUTADA',
      aud.correlativo + ' (' + hallazgos.length + ' verificaciones)', contexto);
    return ejecutada;
  },

  // --- 5) Informe (FO-PRO-03-03) ----------------------------------------------
  emitirInforme: function (data, contexto) {
    var aud = buscarAuditoria_(data.auditoria_id);
    if (!aud) return errorValidacion_('auditoria_id', 'Auditoría no encontrada.');
    if (!puedeAuditar_(aud, contexto)) {
      return { _forbidden: true, message: 'Solo el auditor asignado o el Encargado SGC pueden emitir el informe.' };
    }
    if (aud.estado !== 'EJECUTADA') {
      return errorValidacion_('auditoria_id', 'El informe se emite después de ejecutar la auditoría.');
    }
    var conclusion = String(data.conclusion || '').trim();
    if (!conclusion) {
      return errorValidacion_('conclusion', 'Escribe la conclusión: es el informe de auditoría.');
    }

    // FO-PRO-03-02 trae una seccion "Personas entrevistadas - Cargo": solo
    // se sabe al terminar de auditar, no antes. Llega como arreglo de
    // strings ("Nombre - Cargo"); se limpia igual que un item de descriptor.
    var entrevistados = (data.personas_entrevistadas || [])
      .map(function (s) { return String(s || '').trim(); }).filter(Boolean);

    var ahora = new Date();
    var informada = actualizarFilaPorId_(SHEETS.SGC_AUDITORIAS, 'auditoria_id', aud.auditoria_id, {
      estado: 'INFORMADA',
      informe_fecha: ahora.toISOString(),
      informe_conclusion: conclusion,
      personas_entrevistadas: JSON.stringify(entrevistados)
    });
    registrarLogSgc_('SGC_AUDITORIA_INFORMADA', aud.correlativo, contexto);

    var pendientes = hallazgosDe_(aud.auditoria_id).filter(function (h) {
      return h.resultado === 'NO_CONFORMIDAD' && !h.nc_id;
    });
    var destinatarios = auditadosDe_(aud).concat(encargadosSgc_());
    destinatarios.forEach(function (email) {
      encolarNotificacionApp_(email, 'SGC_AUDITORIA', 'Informe de auditoría emitido',
        aud.correlativo + ' — ' + aud.proceso +
        (pendientes.length ? '. Hay ' + pendientes.length + ' no conformidad(es) por levantar.' : '.'),
        'calidad', 'Ver informe', 120);
    });
    return informada;
  },

  // --- 6) Hallazgo -> no conformidad ------------------------------------------
  // El eslabón que hace que una auditoría sirva de algo. Crea la NC de la
  // Fase 3a con la fuente y el origen ya puestos, y deja el vínculo en los
  // dos sentidos.
  convertirHallazgoEnNc: function (data, contexto) {
    var hallazgo = buscarHallazgo_(data.hallazgo_id);
    if (!hallazgo) return errorValidacion_('hallazgo_id', 'Hallazgo no encontrado.');
    var aud = buscarAuditoria_(hallazgo.auditoria_id);
    if (!aud) return errorValidacion_('hallazgo_id', 'Auditoría no encontrada.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden levantar no conformidades.' };
    }
    if (hallazgo.nc_id) {
      return errorValidacion_('hallazgo_id', 'Este hallazgo ya tiene su no conformidad.');
    }
    if (['NO_CONFORMIDAD', 'OBSERVACION'].indexOf(hallazgo.resultado) === -1) {
      return errorValidacion_('hallazgo_id',
        'Solo un hallazgo de no conformidad u observación se convierte en no conformidad.');
    }

    var nc = NoConformidades.crear({
      descripcion: hallazgo.descripcion || hallazgo.aspecto_verificado,
      fuente: 'AUDITORIA_INTERNA',
      origen_ref: hallazgo.hallazgo_id,
      // El punto normativo ya se sabe: es la clausula del hallazgo. Sin
      // esto habria que volver a escribirlo a mano en la NC.
      referencia_normativa: hallazgo.clausula,
      area_id: aud.area_id,
      // Por defecto la asume el auditado responsable del proceso; si no
      // hay, el Encargado SGC la reasigna desde la ficha de la NC.
      responsable_email: normalizarEmailSgc_(data.responsable_email) || auditadosDe_(aud)[0] || aud.auditor_email,
      fecha_deteccion: aud.fecha_ejecucion || new Date().toISOString()
    }, contexto);
    if (nc && (nc._validationError || nc._forbidden)) return nc;

    actualizarFilaPorId_(SHEETS.SGC_AUD_HALLAZGOS, 'hallazgo_id', hallazgo.hallazgo_id, { nc_id: nc.nc_id });
    registrarLogSgc_('SGC_HALLAZGO_A_NC',
      aud.correlativo + ' / ' + hallazgo.clausula + ' -> ' + nc.correlativo, contexto);
    return { hallazgo_id: hallazgo.hallazgo_id, nc: nc };
  },

  // --- 7) Cerrar la auditoría --------------------------------------------------
  cerrar: function (data, contexto) {
    var aud = buscarAuditoria_(data.auditoria_id);
    if (!aud) return errorValidacion_('auditoria_id', 'Auditoría no encontrada.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden cerrar una auditoría.' };
    }
    if (aud.estado !== 'INFORMADA') {
      return errorValidacion_('auditoria_id', 'Primero emite el informe de la auditoría.');
    }
    // AQUÍ está el valor de la fase: sin esto se levantan hallazgos y
    // nadie los convierte en nada, que es como mueren los SGC de papel.
    var sinNc = hallazgosDe_(aud.auditoria_id).filter(function (h) {
      return h.resultado === 'NO_CONFORMIDAD' && !h.nc_id;
    });
    if (sinNc.length) {
      return errorValidacion_('auditoria_id',
        (sinNc.length === 1 ? 'Falta 1 no conformidad por levantar: ' :
          'Faltan ' + sinNc.length + ' no conformidades por levantar: ') +
        sinNc.map(function (h) { return h.clausula; }).join(', ') + '.');
    }

    var ahora = new Date().toISOString();
    var cerrada = actualizarFilaPorId_(SHEETS.SGC_AUDITORIAS, 'auditoria_id', aud.auditoria_id, {
      estado: 'CERRADA', fecha_cierre: ahora, cerrada_por: normalizarEmailSgc_(contexto.email)
    });
    registrarLogSgc_('SGC_AUDITORIA_CERRADA', aud.correlativo, contexto);
    return cerrada;
  },

  anular: function (data, contexto) {
    var aud = buscarAuditoria_(data.auditoria_id);
    if (!aud) return errorValidacion_('auditoria_id', 'Auditoría no encontrada.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden anular una auditoría.' };
    }
    var motivo = String(data.motivo || '').trim();
    if (!motivo) return errorValidacion_('motivo', 'Explica por qué se anula: queda en el registro.');
    if (aud.estado === 'CERRADA') {
      return errorValidacion_('auditoria_id', 'Una auditoría cerrada no se anula.');
    }
    // Baja lógica: la auditoría no se borra nunca. Poder borrarlas es
    // justo lo que un auditor busca que no se pueda hacer.
    var anulada = actualizarFilaPorId_(SHEETS.SGC_AUDITORIAS, 'auditoria_id', aud.auditoria_id, {
      estado: 'ANULADA', fecha_cierre: new Date().toISOString(),
      cerrada_por: normalizarEmailSgc_(contexto.email)
    });
    registrarLogSgc_('SGC_AUDITORIA_ANULADA', aud.correlativo + ': ' + motivo, contexto);
    return anulada;
  }
};

// --- avisos diarios ---------------------------------------------------------
// Cuelga del trigger de las 09:00 (Triggers.gs), sin gastar un slot nuevo:
// el límite de 20 de Apps Script ya está copado.
//
// Cuatro cosas que se pierden en silencio si nadie las mira:
//   informe fuera de plazo   -> auditor + Encargado SGC (diario)
//   NC sin redactar (15 dh)  -> auditados + Encargado SGC (diario)
//   auditoría que se acerca  -> auditor + auditados (una vez por semana)
//   proceso sin auditar 12m  -> Encargado SGC (una vez por semana)
//
// El último es el que un auditor de certificación pregunta textual: "¿todos
// los procesos fueron auditados en el período?".
Auditorias.recordatorioPendientes = function () {
  var todas = leerFilasSeguro_(SHEETS.SGC_AUDITORIAS).filter(esActivoSgc_);
  var hallazgos = leerFilasSeguro_(SHEETS.SGC_AUD_HALLAZGOS).filter(esVerdaderoActivoSgc_);
  var ahora = new Date();
  var hoy = ahora.toISOString().slice(0, 10);
  var semana = inicioSemanaUTC_(ahora);
  var encargados = encargadosSgc_();
  var avisos = 0;

  // 1) Informe fuera del plazo de 10 días hábiles.
  todas.filter(function (a) {
    return a.estado === 'EJECUTADA' && a.informe_plazo && new Date(a.informe_plazo) < ahora;
  }).forEach(function (a) {
    var dias = Math.floor((ahora - new Date(a.informe_plazo)) / 86400000);
    var destinos = [normalizarEmailSgc_(a.auditor_email)].concat(encargados);
    destinos.forEach(function (email) {
      if (!email) return;
      var asunto = 'SIGSO - Informe de auditoría ' + a.correlativo + ' fuera de plazo';
      var texto = 'La auditoría ' + a.correlativo + ' (' + a.proceso + ') se ejecutó y el informe ' +
        'lleva ' + dias + ' día(s) de atraso.\n\nEntra a SIGSO > Calidad > Auditorías.';
      var html = plantillaCorreoHtml_('Informe de auditoría fuera de plazo',
        '<p>La auditoría <strong>' + escaparHtmlCorreo_(a.correlativo) + '</strong> (' +
        escaparHtmlCorreo_(a.proceso) + ') se ejecutó y el informe lleva <strong>' + dias +
        ' día(s)</strong> de atraso.</p><p>PRO-03 da 10 días hábiles desde la ejecución.</p>');
      var r = enviarCorreo_('SGC_AUDITORIA', email, 'SGC_AUD_INFORME:' + a.auditoria_id + ':' + hoy,
        asunto, texto, null, { htmlBody: html });
      if (r && r.enviado) avisos++;
      encolarNotificacionApp_(email, 'SGC_AUDITORIA', 'Informe de auditoría atrasado',
        a.correlativo + ': ' + dias + ' día(s) de atraso.', 'calidad', 'Ver auditoría', 72);
    });
  });

  // 2) NC sin redactar dentro de los 15 días hábiles desde el informe
  //    (PRO-03 §6.5). Solo importa mientras la auditoría siga INFORMADA:
  //    una vez CERRADA ya no puede haber hallazgos pendientes (cerrar lo
  //    exige), y ANULADA no cuenta.
  todas.filter(function (a) {
    return a.estado === 'INFORMADA' && a.informe_fecha;
  }).forEach(function (a) {
    var plazo = sumarDiasHabilesSgc_(a.informe_fecha, DIAS_REDACCION_NC_AUDITORIA);
    if (!plazo || new Date(plazo) >= ahora) return;
    var pendientes = hallazgos.filter(function (h) {
      return h.auditoria_id === a.auditoria_id && h.resultado === 'NO_CONFORMIDAD' && !h.nc_id;
    });
    if (!pendientes.length) return;
    var dias = Math.floor((ahora - new Date(plazo)) / 86400000);
    var destinos = auditadosDe_(a).concat(encargados);
    destinos.forEach(function (email) {
      if (!email) return;
      var asunto = 'SIGSO - No conformidades sin redactar de la auditoría ' + a.correlativo;
      var texto = 'La auditoría ' + a.correlativo + ' (' + a.proceso + ') tiene ' + pendientes.length +
        ' hallazgo(s) de no conformidad sin redactar, ' + dias + ' día(s) fuera del plazo de 15 hábiles.\n\n' +
        'Entra a SIGSO > Calidad > Auditorías.';
      var html = plantillaCorreoHtml_('No conformidades sin redactar',
        '<p>La auditoría <strong>' + escaparHtmlCorreo_(a.correlativo) + '</strong> (' +
        escaparHtmlCorreo_(a.proceso) + ') tiene <strong>' + pendientes.length +
        ' hallazgo(s)</strong> de no conformidad sin redactar, ' + dias +
        ' día(s) fuera del plazo de 15 días hábiles (PRO-03 §6.5).</p>');
      var r = enviarCorreo_('SGC_AUDITORIA', email, 'SGC_AUD_NC_PENDIENTE:' + a.auditoria_id + ':' + hoy,
        asunto, texto, null, { htmlBody: html });
      if (r && r.enviado) avisos++;
      encolarNotificacionApp_(email, 'SGC_AUDITORIA', 'No conformidades sin redactar',
        a.correlativo + ': ' + pendientes.length + ' hallazgo(s) sin NC.', 'calidad', 'Ver auditoría', 72);
    });
  });

  // 3) Auditoría planificada que se acerca. Semanal: recordar todos los
  //    días una fecha que no cambió es ruido, y el ruido se ignora.
  var proximas = 0;
  todas.filter(function (a) {
    if (a.estado !== 'PLANIFICADA' || !a.fecha_ejecucion) return false;
    var dias = Math.ceil((new Date(a.fecha_ejecucion) - ahora) / 86400000);
    return dias >= 0 && dias <= DIAS_AVISO_AUDITORIA;
  }).forEach(function (a) {
    proximas++;
    var destinos = [normalizarEmailSgc_(a.auditor_email)].concat(auditadosDe_(a));
    destinos.forEach(function (email) {
      if (!email) return;
      encolarNotificacionApp_(email, 'SGC_AUDITORIA', 'Auditoría interna próxima',
        a.correlativo + ' — ' + a.proceso + ', el ' + String(a.fecha_ejecucion).slice(0, 10) + '.',
        'calidad', 'Ver auditoría', 120);
      var asunto = 'SIGSO - Auditoría interna ' + a.correlativo + ' próxima';
      var texto = 'La auditoría ' + a.correlativo + ' de ' + a.proceso + ' se realizará el ' +
        String(a.fecha_ejecucion).slice(0, 10) + '.\n\nObjetivo: ' + (a.objetivo || '-') +
        '\nAlcance: ' + (a.alcance || '-');
      var html = plantillaCorreoHtml_('Auditoría interna próxima',
        '<p>La auditoría <strong>' + escaparHtmlCorreo_(a.correlativo) + '</strong> de ' +
        escaparHtmlCorreo_(a.proceso) + ' se realizará el <strong>' +
        escaparHtmlCorreo_(String(a.fecha_ejecucion).slice(0, 10)) + '</strong>.</p>' +
        '<p><strong>Objetivo:</strong> ' + escaparHtmlCorreo_(a.objetivo || '-') + '<br>' +
        '<strong>Alcance:</strong> ' + escaparHtmlCorreo_(a.alcance || '-') + '</p>');
      var r = enviarCorreo_('SGC_AUDITORIA', email, 'SGC_AUD_PROXIMA:' + a.auditoria_id + ':' + semana,
        asunto, texto, null, { htmlBody: html });
      if (r && r.enviado) avisos++;
    });
  });

  // 4) Procesos sin auditar en 12 meses.
  var atrasados = procesosSinAuditar_(todas, ahora);
  if (atrasados.length) {
    var items = atrasados.map(function (p) {
      return '<li><strong>' + escaparHtmlCorreo_(p.proceso) + '</strong> — ' +
        (p.ultima ? 'última auditoría ' + escaparHtmlCorreo_(p.ultima.slice(0, 10)) : 'nunca auditado') +
        '</li>';
    }).join('');
    encargados.forEach(function (email) {
      var asunto = 'SIGSO - ' + atrasados.length + ' proceso(s) sin auditar en 12 meses';
      var texto = 'Estos procesos llevan más de 12 meses sin auditoría interna:\n' +
        atrasados.map(function (p) {
          return '- ' + p.proceso + (p.ultima ? ' (última: ' + p.ultima.slice(0, 10) + ')' : ' (nunca)');
        }).join('\n') +
        '\n\nEs lo primero que revisa una auditoría de certificación del §9.2.';
      var html = plantillaCorreoHtml_('Procesos sin auditar en 12 meses',
        '<p>Estos procesos llevan más de 12 meses sin auditoría interna:</p>' +
        '<ul style="margin:0 0 12px 18px;padding:0;">' + items + '</ul>' +
        '<p>Es lo primero que revisa una auditoría de certificación del §9.2.</p>');
      var r = enviarCorreo_('SGC_AUDITORIA', email, 'SGC_AUD_CICLO:' + semana,
        asunto, texto, null, { htmlBody: html });
      if (r && r.enviado) avisos++;
      encolarNotificacionApp_(email, 'SGC_AUDITORIA', 'Procesos sin auditar',
        atrasados.length + ' proceso(s) llevan más de 12 meses sin auditoría.',
        'calidad', 'Ver auditorías', 120);
    });
  }

  return { avisos: avisos, proximas: proximas, sin_auditar: atrasados.length };
};

// --- constantes -------------------------------------------------------------

// Las cláusulas auditables de ISO 9001:2015. Las 1-3 (objeto, referencias,
// términos) no son requisitos, por eso no están: no hay nada que verificar.
// Si la organización usa otro desglose, se edita acá y la pantalla se
// actualiza sola: los hallazgos guardan el código, no el texto.
var CLAUSULAS_ISO9001 = [
  { codigo: '4.1', titulo: 'Comprensión de la organización y su contexto' },
  { codigo: '4.2', titulo: 'Necesidades y expectativas de las partes interesadas' },
  { codigo: '4.3', titulo: 'Alcance del sistema de gestión de la calidad' },
  { codigo: '4.4', titulo: 'Sistema de gestión de la calidad y sus procesos' },
  { codigo: '5.1', titulo: 'Liderazgo y compromiso' },
  { codigo: '5.2', titulo: 'Política de la calidad' },
  { codigo: '5.3', titulo: 'Roles, responsabilidades y autoridades' },
  { codigo: '6.1', titulo: 'Acciones para abordar riesgos y oportunidades' },
  { codigo: '6.2', titulo: 'Objetivos de la calidad y planificación' },
  { codigo: '6.3', titulo: 'Planificación de los cambios' },
  { codigo: '7.1', titulo: 'Recursos' },
  { codigo: '7.2', titulo: 'Competencia' },
  { codigo: '7.3', titulo: 'Toma de conciencia' },
  { codigo: '7.4', titulo: 'Comunicación' },
  { codigo: '7.5', titulo: 'Información documentada' },
  { codigo: '8.1', titulo: 'Planificación y control operacional' },
  { codigo: '8.2', titulo: 'Requisitos para los productos y servicios' },
  { codigo: '8.3', titulo: 'Diseño y desarrollo' },
  { codigo: '8.4', titulo: 'Control de procesos, productos y servicios externos' },
  { codigo: '8.5', titulo: 'Producción y provisión del servicio' },
  { codigo: '8.6', titulo: 'Liberación de los productos y servicios' },
  { codigo: '8.7', titulo: 'Control de las salidas no conformes' },
  { codigo: '9.1', titulo: 'Seguimiento, medición, análisis y evaluación' },
  { codigo: '9.2', titulo: 'Auditoría interna' },
  { codigo: '9.3', titulo: 'Revisión por la dirección' },
  { codigo: '10.1', titulo: 'Mejora — generalidades' },
  { codigo: '10.2', titulo: 'No conformidad y acción correctiva' },
  { codigo: '10.3', titulo: 'Mejora continua' }
];

// v10.0 Tanda A: las preguntas reales de la lista de verificación
// (FO-PRO-03-04), copiadas tal como están en el documento -- no una
// redacción propia. Se ofrecen como sugerencia al registrar un hallazgo
// (el auditor puede elegir una o escribir otra cosa si lo que encontró no
// calza con ninguna). 4.4 no tiene preguntas: el FO-PRO-03-04 de la
// empresa no la desarrolla (salta de 4.3 a 5.1); queda como cláusula del
// catálogo por completitud de la norma, pero sin banco de preguntas.
var PREGUNTAS_VERIFICACION_ISO9001 = {
  '4.1': [
    '¿Dispone la organización de una metodología para el análisis, seguimiento y revisión del contexto interno y externo?',
    '¿Ha detectado la organización todos los factores externos que afectan al desempeño de la organización?',
    '¿Ha detectado la organización todos los factores internos que afectan al desempeño de la organización?',
    '¿Se han tenido en cuenta los factores empleados en la definición y planificación del sistema de gestión?'
  ],
  '4.2': [
    '¿Dispone la organización de una metodología para la detección y el análisis de expectativas y necesidades de las partes interesadas?',
    '¿Se han detectado todas las necesidades y expectativas de las partes interesadas que puedan afectar al desempeño del sistema de gestión?',
    '¿Se realiza el seguimiento y la revisión de la información relacionada con las partes interesadas y sus requisitos pertinentes?',
    '¿Se han tenido en cuenta las necesidades y expectativas de las partes interesadas en la definición del sistema y su planificación de actividades?'
  ],
  '4.3': [
    '¿Tiene documentado la organización el alcance del sistema de gestión?',
    '¿Se han delimitado claramente los límites físicos y las actividades del sistema?',
    '¿Se han justificado adecuadamente la no aplicabilidad de los requisitos señalados por la organización?',
    '¿Los requisitos no aplicables no afectan a la calidad de los productos o la satisfacción de los clientes?'
  ],
  '4.4': [],
  '5.1': [
    'La alta dirección debe demostrar liderazgo y compromiso con respecto al sistema de gestión de la calidad',
    'La alta dirección debe demostrar liderazgo y compromiso con respecto al enfoque al cliente'
  ],
  '5.2': [
    '¿Mantiene la organización una política de la calidad apropiada al propósito y contexto de la organización?',
    '¿Incluye la política los compromisos de cumplimiento de requisitos y mejora continua?',
    '¿Existe una relación entre la política y los objetivos de la calidad?',
    '¿La política se encuentra disponible para las partes interesadas?',
    '¿La política es comunicada y entendida dentro de la organización?'
  ],
  '5.3': [
    '¿Existe evidencia de la definición de responsabilidades y autoridades para cada uno de los roles de la organización?',
    '¿Estas responsabilidades y autoridades han sido comunicadas y entendidas en toda la organización?',
    '¿Ha asignado la alta dirección la responsabilidad para el aseguramiento del cumplimiento de los requisitos de la norma, el correcto funcionamiento de los procesos, etc.?'
  ],
  '6.1': [
    '¿Se han identificado los riesgos y oportunidades relacionados con el análisis de contexto, las necesidades y expectativas de las partes interesadas y los procesos?',
    '¿Se han evaluado estos riesgos y oportunidades para determinar acciones proporcionales al impacto potencial?',
    '¿Se han planificado acciones para abordar los riesgos y las oportunidades?'
  ],
  '6.2': [
    '¿Se han establecido objetivos coherentes con la política de la calidad?',
    '¿Los objetivos están relacionados con la conformidad del producto y con el aumento de la satisfacción del cliente?',
    '¿Los objetivos son medibles y disponen de metodología de seguimiento?',
    '¿La planificación de los objetivos contempla las actividades, los recursos, los plazos y las responsabilidades para su realización?',
    '¿Se han comunicado los objetivos en la organización en los niveles pertinentes?'
  ],
  '6.3': [
    '¿Los cambios realizados en el sistema de gestión de calidad han sido planificados?',
    '¿Los cambios a realizar tienen en cuenta las consecuencias potenciales y la integridad del sistema de gestión de la calidad?',
    '¿Los cambios tienen en cuenta la necesidad de recursos y la asignación de responsabilidades?'
  ],
  '7.1': [
    '¿La organización dispone de los recursos necesarios para el correcto desempeño de los procesos?',
    '¿La organización ha determinado y proporcionado las personas necesarias para la implementación eficaz del sistema de gestión de la calidad?'
  ],
  '7.2': [
    '¿Se han determinado las competencias necesarias de las personas para realizar las tareas del sistema de gestión de la calidad?',
    '¿Se han emprendido acciones para asegurar o mejorar la competencia del personal de la organización?',
    '¿Existen evidencias documentadas de la competencia necesaria?'
  ],
  '7.3': [
    '¿Se han realizado acciones para asegurar que las personas tomen conciencia de la política de la calidad y los objetivos de calidad?',
    '¿Se ha comunicado su contribución a la eficacia del sistema y los beneficios de una mejora del desempeño?',
    '¿Se han realizado acciones para que las personas tomen conciencia de las consecuencias de incumplir los requisitos del sistema de gestión de calidad?'
  ],
  '7.4': [
    '¿Se han determinado las comunicaciones internas y externas pertinentes al sistema de gestión de la calidad?',
    '¿Se encuentra definido qué, cuándo, a quién, cómo y quién realiza cada comunicación?'
  ],
  '7.5': [
    '¿Se ha identificado la documentación requerida por la norma y el propio sistema de gestión?',
    '¿La identificación y descripción de los documentos es apropiada?',
    '¿Se encuentra definido el formato y soporte de cada documento?',
    '¿Existe una metodología de revisión y aprobación adecuada?',
    '¿La documentación está disponible en los puntos de uso para su consulta?',
    '¿La documentación está protegida adecuadamente contra pérdida o uso inadecuado?',
    '¿Se han definido metodologías para la distribución, acceso, recuperación y uso de los documentos?',
    '¿Se contemplan actividades para el almacenamiento y preservación de los documentos (copias de seguridad)?',
    '¿Existe un control de cambios en los documentos del sistema?',
    '¿Se ha identificado la documentación de origen externo necesaria para el desempeño de los procesos?'
  ],
  '8.1': [
    '¿Se han identificado los procesos necesarios para cumplir los requisitos de los clientes?',
    '¿Se han establecido criterios para la operación de los procesos?',
    '¿Se controlan los procesos contratados externamente?'
  ],
  '8.2': [
    '¿Se han determinado cuáles son las comunicaciones necesarias con los clientes?',
    '¿Se determinan los requisitos de los clientes y adicionales de los productos y servicios a ofrecer?',
    '¿Se revisa la definición de requisitos y la posibilidad de cumplimiento de las condiciones por la organización?',
    '¿Se han tenido en cuenta los requisitos legales asociados a los productos y servicios?',
    '¿Se conserva toda la información documentada sobre las comunicaciones, requisitos y revisiones con los clientes (presupuestos, contratos, etc.)?',
    '¿Existe una metodología para realizar cambios, su revisión y comunicación de las modificaciones?'
  ],
  '8.3': [
    '¿Existe una planificación del diseño y desarrollo?',
    '¿Existe una metodología definida para la identificación de entradas para el diseño?',
    '¿Existen controles establecidos para cada una de las etapas del diseño?',
    '¿Existe una metodología para validar las salidas del diseño y desarrollo?',
    '¿Existe una metodología para el control de cambios en el diseño y desarrollo?'
  ],
  '8.4': [
    'La organización debe asegurarse de que los procesos, productos y servicios suministrados externamente son conformes a los requisitos',
    'La organización debe determinar los controles a aplicar a los procesos, productos y servicios suministrados externamente',
    'La organización debe determinar y aplicar criterios para la evaluación, la selección, el seguimiento del desempeño y la reevaluación de los proveedores externos',
    'La organización debe asegurarse de que los procesos, productos y servicios suministrados externamente no afectan de manera adversa a la capacidad de la organización de entregar productos y servicios conformes de manera coherente a sus clientes',
    'La organización debe asegurarse de la adecuación de los requisitos antes de su comunicación al proveedor externo'
  ],
  '8.5': [
    '¿Están la producción y provisión del servicio bajo condiciones controladas?',
    '¿Se dispone de la información documentada y recursos necesarios para la operación?',
    '¿Existen etapas de implementación de actividades de seguimiento y medición, especialmente previas a la liberación y a la entrega?',
    '¿Se aplican métodos adecuados para la identificación y trazabilidad de las salidas para asegurar la conformidad de los productos?',
    '¿Existen requisitos de trazabilidad que se desarrollan de acuerdo a los requisitos?',
    '¿Se cuida, identifica y protege la propiedad perteneciente a clientes y proveedores externos?',
    '¿Las condiciones de preservación de los productos son las adecuadas?',
    '¿Se cumplen con las actividades posteriores a la entrega cuando existan y sea un requisito?',
    '¿En caso de cambios los mismos son justificados por información documentada?'
  ],
  '8.6': [
    '¿Se han establecido los controles oportunos para la liberación del producto?',
    '¿Se han determinado las responsabilidades para la liberación de los productos?',
    '¿Existe información documentada que evidencie la liberación y que permita la trazabilidad de la misma?'
  ],
  '8.7': [
    '¿Las salidas no conformes son identificadas para prevenir su uso o entrega no intencionada?',
    '¿Se emprenden las acciones oportunas sobre el producto no conforme: corrección, separación, información al cliente, etc.?',
    '¿Se mantiene la información documentada de cada salida no conforme?'
  ],
  '9.1': [
    '¿La organización evalúa el desempeño y la eficacia del sistema de gestión de la calidad?',
    '¿Existe una metodología definida para realizar el seguimiento de las percepciones de los clientes del grado en el que se cumplen sus necesidades y expectativas?',
    '¿Los resultados de esta retroalimentación de la percepción del cliente permiten evidenciar la mejora en la satisfacción del cliente?',
    '¿Los clientes analizados son suficientemente representativos para conocer la satisfacción general de los clientes?'
  ],
  '9.2': [
    '¿Las auditorías internas se realizan de forma planificada?',
    '¿Se garantiza la competencia e independencia de los auditores internos?',
    '¿El alcance de la auditoría y los métodos son apropiados para evaluar la eficacia del sistema de gestión de la calidad?',
    '¿La dirección pertinente es informada de los resultados de auditoría?',
    '¿Se emprenden acciones para solventar los incumplimientos detectados en las auditorías internas?'
  ],
  '9.3': [
    '¿Se han incluido todas las entradas de la revisión presentes en la norma de referencia?',
    '¿Se han tratado todas las salidas necesarias requeridas por la norma de referencia?',
    '¿Existe una metodología definida y una planificación para la realización de las revisiones por la dirección?',
    '¿Se está empleando la revisión por la dirección como una herramienta de mejora del sistema de gestión de la calidad?'
  ],
  '10.1': [
    '¿La organización planifica acciones para la mejora de la satisfacción del cliente y del desempeño del sistema de gestión de la calidad?',
    '¿Se contemplan para la mejora las necesidades y expectativas de las partes interesadas?',
    '¿Se contemplan los riesgos y oportunidades para emprender acciones para la mejora?'
  ],
  '10.2': [
    '¿Existe una metodología para el tratamiento de las no conformidades y las quejas?',
    '¿Se está realizando análisis de las causas de las no conformidades para emprender acciones correctivas?',
    '¿Existe análisis de la repetitividad de las no conformidades para emprender acciones correctivas?',
    '¿La documentación de las no conformidades y acciones correctivas es adecuada para conocer las causas, responsabilidades, resultados y análisis de la eficacia?'
  ],
  '10.3': [
    '¿La organización dispone de las herramientas adecuadas para favorecer la mejora continua (objetivos, acciones, salidas de la revisión, etc.)?',
    '¿Existen evidencias de estas mejoras planificadas por la organización?',
    '¿Las mejoras a emprender tienen en cuenta las necesidades y expectativas de las partes interesadas, el análisis de contexto y los riesgos y oportunidades?'
  ]
};

var RESULTADOS_HALLAZGO = ['CONFORME', 'OBSERVACION', 'NO_CONFORMIDAD', 'OPORTUNIDAD'];
var ESTADOS_AUD_ABIERTAS = ['PROGRAMADA', 'PLANIFICADA', 'EJECUTADA', 'INFORMADA'];

// PRO-03: el informe se emite dentro de 10 días hábiles de la ejecución.
var DIAS_INFORME_AUDITORIA = 10;
// PRO-03 §6.5: el responsable del área auditada tiene 15 días hábiles desde
// el informe para redactar (levantar) las no conformidades encontradas.
var DIAS_REDACCION_NC_AUDITORIA = 15;
// PRO-03: el plan se comunica con 5 días hábiles de anticipación. El
// sistema NO bloquea si son menos (bloquear empuja a falsear fechas), pero
// deja el dato a la vista.
var DIAS_ANTICIPACION_PLAN = 5;
// Días naturales de antelación con que se avisa una auditoría próxima.
var DIAS_AVISO_AUDITORIA = 7;
// §9.2.2: el programa debe cubrir todos los procesos. 12 meses es el ciclo
// habitual y el que revisa la auditoría de certificación.
var MESES_CICLO_AUDITORIA = 12;

// --- helpers ----------------------------------------------------------------

function buscarAuditoria_(auditoriaId) {
  if (!auditoriaId) return null;
  var filas = leerFilasSeguro_(SHEETS.SGC_AUDITORIAS);
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].auditoria_id === auditoriaId && esActivoSgc_(filas[i])) return filas[i];
  }
  return null;
}

function buscarHallazgo_(hallazgoId) {
  if (!hallazgoId) return null;
  var filas = leerFilasSeguro_(SHEETS.SGC_AUD_HALLAZGOS);
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].hallazgo_id === hallazgoId && esVerdaderoActivoSgc_(filas[i])) return filas[i];
  }
  return null;
}

// SGC_AUD_HALLAZGOS usa 'activo' (no 'activa') como el resto de tablas de
// detalle del SGC. esVerdaderoActivoSgc_ (Calidad.gs) ya mira ese campo.
function hallazgosDe_(auditoriaId) {
  return leerFilasSeguro_(SHEETS.SGC_AUD_HALLAZGOS).filter(function (h) {
    return h.auditoria_id === auditoriaId && esVerdaderoActivoSgc_(h);
  });
}

function clausulasDe_(aud) {
  return parsearListaSgc_(aud && aud.clausulas);
}

function auditadosDe_(aud) {
  return parsearListaSgc_(aud && aud.auditados).map(normalizarEmailSgc_).filter(Boolean);
}

// v10.0 Tanda A: el resto del "equipo auditor" (PRO-03), ademas del lider
// en auditor_email.
function coauditoresDe_(aud) {
  return parsearListaSgc_(aud && aud.coauditores).map(normalizarEmailSgc_).filter(Boolean);
}

function personasEntrevistadasDe_(aud) {
  return parsearListaSgc_(aud && aud.personas_entrevistadas).map(String);
}

// Las listas se guardan como JSON en una celda. Una hoja de cálculo editada
// a mano puede dejar ahí cualquier cosa, así que nunca se confía en el
// parseo: una celda corrupta no puede tumbar el listado completo.
function parsearListaSgc_(valor) {
  if (!valor) return [];
  if (Object.prototype.toString.call(valor) === '[object Array]') return valor;
  try {
    var parsed = JSON.parse(valor);
    return Object.prototype.toString.call(parsed) === '[object Array]' ? parsed : [];
  } catch (err) {
    return [];
  }
}

function normalizarClausulas_(lista) {
  var pedidas = parsearListaSgc_(lista);
  return pedidas.map(String).filter(function (c) { return !!tituloClausula_(c); });
}

function tituloClausula_(codigo) {
  if (!codigo) return '';
  for (var i = 0; i < CLAUSULAS_ISO9001.length; i++) {
    if (CLAUSULAS_ISO9001[i].codigo === String(codigo)) return CLAUSULAS_ISO9001[i].titulo;
  }
  return '';
}

// "10.2" va DESPUÉS de "9.3", no antes: ordenar por texto pondría la
// cláusula 10 entre la 1 y la 2.
function ordenClausula_(codigo) {
  var partes = String(codigo || '').split('.');
  return (Number(partes[0]) || 0) * 100 + (Number(partes[1]) || 0);
}

function siguienteCorrelativoAud_(anio) {
  var delAnio = leerFilasSeguro_(SHEETS.SGC_AUDITORIAS).filter(function (a) {
    return String(a.anio) === String(anio);
  }).length;
  return 'AI-' + anio + '-' + ('00' + (delAnio + 1)).slice(-3);
}

function encargadosSgc_() {
  return leerFilasSeguro_(SHEETS.SGC_ROLES)
    .filter(function (r) { return esVerdaderoActivoSgc_(r) && r.rol_sgc === 'ENCARGADO_SGC'; })
    .map(function (r) { return normalizarEmailSgc_(r.usuario_email); })
    .filter(Boolean);
}

// §9.2.2 c): "los auditores no auditarán su propio trabajo". Es la regla
// que hace creíble una auditoría interna, y la que un auditor externo
// verifica mirando quién firmó qué. Se valida contra el área declarada en
// SGC_ROLES y contra la lista de auditados.
function conflictoDeInteres_(auditorEmail, areaId, auditados) {
  var auditor = normalizarEmailSgc_(auditorEmail);
  if (!auditor) return null;
  if (areaId && areaSgc_({ email: auditor }) === areaId) {
    return errorValidacion_('auditor_email',
      'El auditor pertenece a esa área: nadie audita su propio trabajo (ISO 9001 §9.2.2).');
  }
  if ((auditados || []).map(normalizarEmailSgc_).indexOf(auditor) !== -1) {
    return errorValidacion_('auditados',
      'El auditor no puede estar en la lista de auditados: nadie se audita a sí mismo.');
  }
  return null;
}

// Mismo control que conflictoDeInteres_, aplicado a cada coauditor: ningun
// miembro del equipo audita su propia area ni figura como auditado.
function coauditoresConConflicto_(coauditores, areaId, auditados) {
  for (var i = 0; i < coauditores.length; i++) {
    var conflicto = conflictoDeInteres_(coauditores[i], areaId, auditados);
    if (conflicto) return conflicto;
  }
  return null;
}

function puedeAuditar_(aud, contexto) {
  if (gobiernaSgc_(contexto, rolSgc_(contexto))) return true;
  var email = normalizarEmailSgc_(contexto && contexto.email);
  if (normalizarEmailSgc_(aud.auditor_email) === email) return true;
  return coauditoresDe_(aud).indexOf(email) !== -1;
}

function puedeVerAuditoria_(aud, contexto) {
  var rol = rolSgc_(contexto);
  var gobierna = gobiernaSgc_(contexto, rol);
  if (veTodoSgc_(contexto, rol, gobierna)) return true;
  var email = normalizarEmailSgc_(contexto && contexto.email);
  if (normalizarEmailSgc_(aud.auditor_email) === email) return true;
  if (coauditoresDe_(aud).indexOf(email) !== -1) return true;
  if (auditadosDe_(aud).indexOf(email) !== -1) return true;
  var miArea = areaSgc_(contexto);
  return !!miArea && aud.area_id === miArea;
}

// Días hábiles de anticipación con que se comunicó el plan. Se calcula (no
// se guarda) para que no quede desfasado si cambia la fecha de ejecución.
function anticipacionPlanAud_(aud) {
  if (!aud.fecha_plan || !aud.fecha_ejecucion) return null;
  var plan = new Date(aud.fecha_plan);
  var ejec = new Date(aud.fecha_ejecucion);
  if (isNaN(plan.getTime()) || isNaN(ejec.getTime())) return null;
  var limite = sumarDiasHabilesSgc_(plan, DIAS_ANTICIPACION_PLAN);
  return { dias_naturales: Math.round((ejec - plan) / 86400000), suficiente: !!limite && ejec >= new Date(limite) };
}

function resumenAud_(aud, hallazgos, ahora) {
  var mios = hallazgos.filter(function (h) { return h.auditoria_id === aud.auditoria_id; });
  function contar_(resultado) {
    return mios.filter(function (h) { return h.resultado === resultado; }).length;
  }
  var informeVencido = aud.estado === 'EJECUTADA' && aud.informe_plazo &&
    new Date(aud.informe_plazo) < ahora;
  return {
    auditoria_id: aud.auditoria_id,
    correlativo: aud.correlativo,
    anio: aud.anio,
    area_id: aud.area_id,
    proceso: aud.proceso,
    auditor_email: aud.auditor_email,
    estado: aud.estado,
    fecha_programada: aud.fecha_programada,
    fecha_ejecucion: aud.fecha_ejecucion,
    informe_plazo: aud.informe_plazo,
    informe_vencido: !!informeVencido,
    anticipacion_plan: anticipacionPlanAud_(aud),
    clausulas: clausulasDe_(aud),
    verificaciones: mios.length,
    conformes: contar_('CONFORME'),
    observaciones: contar_('OBSERVACION'),
    no_conformidades: contar_('NO_CONFORMIDAD'),
    oportunidades: contar_('OPORTUNIDAD'),
    // Lo que impide cerrar la auditoría, calculado acá para que la pantalla
    // pueda decirlo ANTES de que el usuario intente cerrar y falle.
    nc_pendientes: mios.filter(function (h) {
      return h.resultado === 'NO_CONFORMIDAD' && !h.nc_id;
    }).length
  };
}

function aniosConAuditorias_(todas) {
  var vistos = {};
  todas.forEach(function (a) { if (a.anio) vistos[a.anio] = true; });
  var anio = new Date().getFullYear();
  vistos[anio] = true;
  return Object.keys(vistos).sort().reverse();
}

// Procesos que llevan más de MESES_CICLO_AUDITORIA sin una auditoría
// EJECUTADA. Solo mira procesos que alguna vez entraron al programa: no se
// puede reclamar por un proceso que nadie declaró.
function procesosSinAuditar_(todas, ahora) {
  var limite = new Date(ahora);
  limite.setMonth(limite.getMonth() - MESES_CICLO_AUDITORIA);
  var ultimaPorProceso = {};
  todas.forEach(function (a) {
    if (a.estado === 'ANULADA') return;
    var proceso = String(a.proceso || '').trim();
    if (!proceso) return;
    if (!(proceso in ultimaPorProceso)) ultimaPorProceso[proceso] = '';
    var ejecutada = ['EJECUTADA', 'INFORMADA', 'CERRADA'].indexOf(a.estado) !== -1;
    if (!ejecutada || !a.fecha_ejecucion) return;
    if (!ultimaPorProceso[proceso] || new Date(a.fecha_ejecucion) > new Date(ultimaPorProceso[proceso])) {
      ultimaPorProceso[proceso] = a.fecha_ejecucion;
    }
  });

  var atrasados = [];
  Object.keys(ultimaPorProceso).forEach(function (proceso) {
    var ultima = ultimaPorProceso[proceso];
    // Un proceso con una auditoría PROGRAMADA a futuro no está atrasado
    // todavía: el programa anual justamente sirve para eso.
    var tienePlan = todas.some(function (a) {
      return String(a.proceso || '').trim() === proceso &&
        ESTADOS_AUD_ABIERTAS.indexOf(a.estado) !== -1 &&
        ['EJECUTADA', 'INFORMADA'].indexOf(a.estado) === -1;
    });
    if (tienePlan) return;
    if (!ultima || new Date(ultima) < limite) {
      atrasados.push({ proceso: proceso, ultima: ultima });
    }
  });
  return atrasados;
}

function indicadoresAud_(todas, hallazgos, ahora) {
  var anio = ahora.getFullYear();
  var delAnio = todas.filter(function (a) {
    return String(a.anio) === String(anio) && a.estado !== 'ANULADA';
  });
  var ejecutadas = delAnio.filter(function (a) {
    return ['EJECUTADA', 'INFORMADA', 'CERRADA'].indexOf(a.estado) !== -1;
  });
  var idsDelAnio = {};
  delAnio.forEach(function (a) { idsDelAnio[a.auditoria_id] = true; });
  var hallazgosAnio = hallazgos.filter(function (h) { return idsDelAnio[h.auditoria_id]; });

  return {
    programadas: delAnio.length,
    ejecutadas: ejecutadas.length,
    // % de cumplimiento del programa anual: es el indicador que pide la
    // especificación y el que Dirección mira en la revisión.
    pct_cumplimiento: delAnio.length
      ? Math.round((ejecutadas.length / delAnio.length) * 1000) / 10
      : null,
    informes_vencidos: delAnio.filter(function (a) {
      return a.estado === 'EJECUTADA' && a.informe_plazo && new Date(a.informe_plazo) < ahora;
    }).length,
    no_conformidades: hallazgosAnio.filter(function (h) { return h.resultado === 'NO_CONFORMIDAD'; }).length,
    nc_pendientes: hallazgosAnio.filter(function (h) {
      return h.resultado === 'NO_CONFORMIDAD' && !h.nc_id;
    }).length,
    procesos_sin_auditar: procesosSinAuditar_(todas, ahora).length
  };
}
