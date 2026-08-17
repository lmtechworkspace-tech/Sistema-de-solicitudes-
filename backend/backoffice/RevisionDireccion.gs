/**
 * RevisionDireccion.gs — v10.0 Fase 5b, PRO-05 (§9.3 de la norma).
 *
 * El registro es el FO-PRO-05-01 "Informe de revisión por la gerencia": una
 * reunion anual donde la Direccion revisa el SGC completo. Trece entradas
 * obligatorias, tres salidas obligatorias.
 *
 * ── LO QUE HACE DISTINTA A ESTA FASE ──────────────────────────────────────
 * Las entradas de §9.3.2 no se preguntan en blanco. Cinco de las trece las
 * responde el sistema SOLO, porque ya tiene los datos:
 *
 *   Item 1  ← los acuerdos de la revision anterior y en que quedaron
 *   Item 7  ← las quejas del periodo (satisfaccion del cliente)
 *   Item 10 ← las no conformidades y sus acciones correctivas
 *   Item 12 ← las auditorias internas del periodo
 *   Item 13 ← el desempeño de los proveedores externos
 *
 * Eso es exactamente lo que hace que la revision por la direccion deje de
 * ser "juntar carpetas la semana antes". El resumen no reemplaza el juicio
 * de la Direccion: se ofrece como texto inicial en el campo Observaciones,
 * editable. El sistema aporta el DATO; la conclusion la escribe quien
 * preside. Si el sistema opinara por ella, el registro dejaria de ser
 * evidencia de que la Direccion revisó.
 *
 * El item 8 (grado de logro de los objetivos de calidad) se prellenara
 * cuando exista el tablero de objetivos (DOC-07, Fase 6). Hasta entonces
 * queda en blanco, declarado como pendiente y no como si no existiera.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * LOS ACUERDOS SON ACTIVIDADES. Igual que la accion correctiva de una NC:
 * la tabla 3 del formulario tiene "Responsable actividad" y "Plazo
 * establecido", que es literalmente una tarea. Se crean con el motor v7.0 y
 * le aparecen al responsable en "Mi trabajo". Un acuerdo de directorio que
 * vive solo dentro del acta es un acuerdo que nadie cumple.
 *
 * PLAZO DE CONVOCATORIA EN DIAS HABILES. PRO-05 §6 pide avisar a los
 * asistentes con al menos 10 dias habiles de anticipacion. Se calcula con
 * las mismas primitivas que el resto del SGC y se avisa ANTES, no se
 * constata despues que no se cumplio.
 */

var RevisionDireccion = {

  listar: function (data, contexto) {
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    if (!(gobierna || veTodoSgc_(contexto, rol, gobierna))) {
      return { _forbidden: true, message: 'No tienes acceso a las revisiones por la dirección.' };
    }

    var ahora = new Date();
    var todas = leerFilasSeguro_(SHEETS.SGC_REVISIONES).filter(esActivoSgc_);
    var acuerdos = leerFilasSeguro_(SHEETS.SGC_REVISION_ACUERDOS).filter(esActivoSgc_);

    return {
      puede_gestionar: gobierna,
      dias_convocatoria: DIAS_CONVOCATORIA_REVISION,
      meses_frecuencia: MESES_FRECUENCIA_REVISION,
      // Que tan atrasada esta la organizacion respecto de su propia regla de
      // 12 meses. Es el dato que la Direccion necesita ver primero.
      vigencia: vigenciaRevision_(todas, ahora),
      revisiones: todas.map(function (r) {
        return resumenRevision_(r, acuerdos, ahora);
      }).sort(function (a, b) {
        return new Date(b.fecha_programada || 0) - new Date(a.fecha_programada || 0);
      })
    };
  },

  getDetalle: function (data, contexto) {
    var revision = buscarRevision_(data.revision_id);
    if (!revision) return errorValidacion_('revision_id', 'Revisión no encontrada.');
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    if (!(gobierna || veTodoSgc_(contexto, rol, gobierna))) {
      return { _forbidden: true, message: 'No tienes acceso a esta revisión.' };
    }

    var acuerdos = leerFilasSeguro_(SHEETS.SGC_REVISION_ACUERDOS).filter(esActivoSgc_);
    var actividades = leerFilasSeguro_(SHEETS.ACTIVIDADES);

    return {
      revision: resumenRevision_(revision, acuerdos, new Date()),
      puede_gestionar: gobierna,
      dias_convocatoria: DIAS_CONVOCATORIA_REVISION,
      // El catalogo de las 13 entradas y las 3 salidas viaja al frontend:
      // la pantalla no guarda su propia copia de la norma.
      catalogo_entradas: ENTRADAS_REVISION,
      catalogo_acuerdos: TIPOS_ACUERDO_REVISION,
      entradas: entradasDeRevision_(revision),
      acuerdos: acuerdos.filter(function (a) {
        return a.revision_id === revision.revision_id;
      }).map(function (a) {
        var act = actividades.filter(function (x) { return x.actividad_id === a.actividad_id; })[0];
        return {
          acuerdo_id: a.acuerdo_id,
          tipo: a.tipo,
          tipo_etiqueta: etiquetaAcuerdoRevision_(a.tipo),
          observaciones: a.observaciones,
          responsable_email: a.responsable_email,
          plazo: a.plazo,
          tarea: tareaResumen_(act)
        };
      })
    };
  },

  // --- Programar la reunion (§9.3 + PRO-05 §6) ------------------------------
  programar: function (data, contexto) {
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden programar la revisión.' };
    }
    var fechaProgramada = String(data.fecha_programada || '').trim();
    if (!fechaProgramada) {
      return errorValidacion_('fecha_programada', 'Indica la fecha de la reunión.');
    }
    var fecha = new Date(fechaProgramada);
    if (isNaN(fecha.getTime())) {
      return errorValidacion_('fecha_programada', 'La fecha de la reunión no es válida.');
    }

    var ahora = new Date();
    var revision = {
      revision_id: Utilities.getUuid(),
      correlativo: siguienteCorrelativoRevision_(fecha),
      anio: fecha.getFullYear(),
      fecha_programada: fecha.toISOString(),
      // La fecha limite para avisar: 10 dias habiles ANTES de la reunion.
      // Se guarda para poder recordarlo mientras todavia se puede cumplir.
      aviso_plazo: restarDiasHabilesSgc_(fecha.toISOString(), DIAS_CONVOCATORIA_REVISION),
      fecha_convocatoria: '',
      fecha_reunion: '',
      asistentes: JSON.stringify([]),
      entradas: JSON.stringify([]),
      conclusiones: '',
      anexos: String(data.anexos || '').trim(),
      director_email: normalizarEmailSgc_(data.director_email || ''),
      responsable_calidad_email: normalizarEmailSgc_(data.responsable_calidad_email || (contexto && contexto.email) || ''),
      estado: 'PROGRAMADA',
      fecha_cierre: '', cerrada_por: '',
      creada_por: (contexto && contexto.email) || '',
      fecha_creacion: ahora.toISOString(),
      activa: true
    };
    agregarFila_(SHEETS.SGC_REVISIONES, revision);
    registrarLogSgc_('SGC_REVISION_PROGRAMADA', revision.correlativo, contexto);
    return revision;
  },

  // --- Convocar: avisar a los asistentes con la agenda ----------------------
  convocar: function (data, contexto) {
    var revision = buscarRevision_(data.revision_id);
    if (!revision) return errorValidacion_('revision_id', 'Revisión no encontrada.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden convocar.' };
    }
    var asistentes = normalizarAsistentes_(data.asistentes);
    if (!asistentes.length) {
      return errorValidacion_('asistentes', 'Indica al menos un asistente (nombre y cargo).');
    }
    var correos = (data.correos || []).map(normalizarEmailSgc_).filter(Boolean);
    if (!correos.length) {
      return errorValidacion_('correos',
        'Indica a qué correos se envía la convocatoria: PRO-05 §6 exige notificar a los asistentes.');
    }

    var ahora = new Date().toISOString();
    // La agenda que se envia son los 13 temas de la norma: es lo que PRO-05
    // §6 llama "los temas a tratar", no una lista libre.
    var agenda = ENTRADAS_REVISION.map(function (e) { return e.numero + '. ' + e.titulo; }).join('\n');
    var cuerpo = 'Se convoca a la revisión por la dirección del Sistema de Gestión de Calidad.\n\n' +
      'Fecha: ' + String(revision.fecha_programada).slice(0, 10) + '\n' +
      'Correlativo: ' + revision.correlativo + '\n\n' +
      'Temas a tratar (ISO 9001 §9.3.2):\n' + agenda;

    correos.forEach(function (email) {
      enviarCorreo_(revision.revision_id, email, 'SGC_REVISION_CONVOCATORIA_' + revision.revision_id,
        'SIGSO — Convocatoria: revisión por la dirección ' + revision.correlativo, cuerpo);
    });

    var actualizada = actualizarFilaPorId_(SHEETS.SGC_REVISIONES, 'revision_id', revision.revision_id, {
      asistentes: JSON.stringify(asistentes),
      fecha_convocatoria: ahora,
      estado: 'CONVOCADA'
    });
    registrarLogSgc_('SGC_REVISION_CONVOCADA',
      revision.correlativo + ' → ' + correos.length + ' asistente(s)', contexto);
    return actualizada;
  },

  // --- El resumen que el sistema arma solo ---------------------------------
  // Se expone como accion propia (y no solo dentro de getDetalle) para que
  // la pantalla pueda ofrecerlo como "traer los datos del sistema" en el
  // momento de llenar el acta, y para poder recalcularlo si la reunion se
  // corre de fecha.
  getResumenAutomatico: function (data, contexto) {
    var revision = buscarRevision_(data.revision_id);
    if (!revision) return errorValidacion_('revision_id', 'Revisión no encontrada.');
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    if (!(gobierna || veTodoSgc_(contexto, rol, gobierna))) {
      return { _forbidden: true, message: 'No tienes acceso a esta revisión.' };
    }
    return { revision_id: revision.revision_id, resumen: resumenAutomaticoRevision_(revision) };
  },

  // --- Registrar el acta (tabla 2 del formulario) --------------------------
  registrarActa: function (data, contexto) {
    var revision = buscarRevision_(data.revision_id);
    if (!revision) return errorValidacion_('revision_id', 'Revisión no encontrada.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden registrar el acta.' };
    }
    if (revision.estado === 'CERRADA') {
      return errorValidacion_('revision_id', 'La revisión ya está cerrada.');
    }

    var fechaReunion = String(data.fecha_reunion || '').trim();
    if (!fechaReunion) return errorValidacion_('fecha_reunion', 'Indica la fecha en que se realizó la reunión.');

    var entradas = normalizarEntradasRevision_(data.entradas);
    // Las 13 entradas son obligatorias por norma. Se exige que TODAS tengan
    // observacion: dejar una en blanco es exactamente el hallazgo que un
    // auditor levanta sobre §9.3.2.
    var vacias = ENTRADAS_REVISION.filter(function (e) {
      return !String(entradas[e.numero] || '').trim();
    });
    if (vacias.length) {
      return errorValidacion_('entradas',
        'Faltan observaciones en ' + vacias.length + ' de los 13 temas obligatorios (§9.3.2). ' +
        'El primero sin completar es el ' + vacias[0].numero + ': ' + vacias[0].titulo);
    }

    var asistentes = normalizarAsistentes_(data.asistentes);
    if (!asistentes.length) {
      return errorValidacion_('asistentes', 'Registra quiénes asistieron (nombre y cargo).');
    }

    var actualizada = actualizarFilaPorId_(SHEETS.SGC_REVISIONES, 'revision_id', revision.revision_id, {
      fecha_reunion: new Date(fechaReunion).toISOString(),
      asistentes: JSON.stringify(asistentes),
      entradas: JSON.stringify(ENTRADAS_REVISION.map(function (e) {
        return { item: e.numero, observaciones: String(entradas[e.numero] || '').trim() };
      })),
      conclusiones: String(data.conclusiones || '').trim(),
      anexos: String(data.anexos || revision.anexos || '').trim(),
      director_email: normalizarEmailSgc_(data.director_email || revision.director_email || ''),
      estado: 'REALIZADA'
    });
    registrarLogSgc_('SGC_REVISION_ACTA', revision.correlativo, contexto);
    return actualizada;
  },

  // --- Acuerdos: cada uno es una ACTIVIDAD ---------------------------------
  registrarAcuerdo: function (data, contexto) {
    var revision = buscarRevision_(data.revision_id);
    if (!revision) return errorValidacion_('revision_id', 'Revisión no encontrada.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden registrar acuerdos.' };
    }
    if (TIPOS_ACUERDO_REVISION.map(function (t) { return t.tipo; }).indexOf(data.tipo) === -1) {
      return errorValidacion_('tipo', 'El acuerdo debe ser de mejora, de cambio en el SGC o de recursos (§9.3.3).');
    }
    var observaciones = String(data.observaciones || '').trim();
    if (observaciones.length < 10) {
      return errorValidacion_('observaciones', 'Describe el acuerdo (mínimo 10 caracteres).');
    }
    var responsable = normalizarEmailSgc_(data.responsable_email || '');
    if (!responsable) {
      return errorValidacion_('responsable_email',
        'Indica el responsable: el formulario pide "Responsable actividad" para cada acuerdo.');
    }
    var plazo = String(data.plazo || '').trim();
    if (!plazo) {
      return errorValidacion_('plazo', 'Indica el plazo establecido para el acuerdo.');
    }

    var etiqueta = etiquetaAcuerdoRevision_(data.tipo);
    // La decision central: el acuerdo es una tarea real, con el mismo motor
    // que todo lo demas que la persona tiene que hacer.
    var tarea = crearTareaSgc_({
      titulo: 'Acuerdo de revisión por la dirección — ' + etiqueta,
      descripcion: observaciones + '\n\n(Acuerdo de la revisión ' + revision.correlativo + ', ISO 9001 §9.3.3.)',
      responsable_email: responsable,
      fecha_compromiso: new Date(plazo).toISOString(),
      origen_tipo: 'REVISION_ACUERDO',
      origen_id: revision.revision_id
    }, contexto);
    if (tarea && tarea._validationError) return tarea;

    var acuerdo = {
      acuerdo_id: Utilities.getUuid(),
      revision_id: revision.revision_id,
      tipo: data.tipo,
      observaciones: observaciones,
      responsable_email: responsable,
      plazo: new Date(plazo).toISOString(),
      actividad_id: tarea ? tarea.actividad_id : '',
      creado_por: (contexto && contexto.email) || '',
      fecha_creacion: new Date().toISOString(),
      activa: true
    };
    agregarFila_(SHEETS.SGC_REVISION_ACUERDOS, acuerdo);
    registrarLogSgc_('SGC_REVISION_ACUERDO', revision.correlativo + ' — ' + etiqueta, contexto);
    return { acuerdo: acuerdo, tarea: tareaResumen_(tarea) };
  },

  // --- Cierre ---------------------------------------------------------------
  cerrar: function (data, contexto) {
    var revision = buscarRevision_(data.revision_id);
    if (!revision) return errorValidacion_('revision_id', 'Revisión no encontrada.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden cerrar la revisión.' };
    }
    if (revision.estado !== 'REALIZADA') {
      return errorValidacion_('revision_id', 'Primero hay que registrar el acta de la reunión.');
    }
    if (!String(revision.conclusiones || '').trim()) {
      return errorValidacion_('conclusiones',
        'PRO-05 §6.2 pide concluir si el SGC es adecuado y eficaz, y si hay recursos para las mejoras.');
    }
    // §9.3.3 exige que la revision produzca decisiones y acciones. Cerrarla
    // sin ningun acuerdo es declarar que no salio nada de una revision
    // anual completa: es justo lo que un auditor cuestiona.
    var acuerdos = leerFilasSeguro_(SHEETS.SGC_REVISION_ACUERDOS).filter(function (a) {
      return a.revision_id === revision.revision_id && esActivoSgc_(a);
    });
    if (!acuerdos.length) {
      return errorValidacion_('acuerdos',
        'No se puede cerrar sin acuerdos: §9.3.3 exige que la revisión produzca decisiones y acciones.');
    }

    var actualizada = actualizarFilaPorId_(SHEETS.SGC_REVISIONES, 'revision_id', revision.revision_id, {
      estado: 'CERRADA',
      fecha_cierre: new Date().toISOString(),
      cerrada_por: (contexto && contexto.email) || ''
    });
    registrarLogSgc_('SGC_REVISION_CERRADA', revision.correlativo, contexto);
    return actualizada;
  },

  anular: function (data, contexto) {
    var revision = buscarRevision_(data.revision_id);
    if (!revision) return errorValidacion_('revision_id', 'Revisión no encontrada.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden anular.' };
    }
    var motivo = String(data.motivo || '').trim();
    if (motivo.length < 10) return errorValidacion_('motivo', 'Explica por qué se anula (mínimo 10 caracteres).');

    var actualizada = actualizarFilaPorId_(SHEETS.SGC_REVISIONES, 'revision_id', revision.revision_id, {
      estado: 'ANULADA', activa: false
    });
    registrarLogSgc_('SGC_REVISION_ANULADA', revision.correlativo + ' — ' + motivo, contexto);
    return actualizada;
  }
};

// --- Alertas (coladas en la pasada diaria, sin trigger propio) --------------
RevisionDireccion.recordatorioPendientes = function () {
  var ahora = new Date();
  var hoy = ahora.toISOString().slice(0, 10);
  var encargados = encargadosSgc_();
  if (!encargados.length) return { avisos: 0 };

  var activas = leerFilasSeguro_(SHEETS.SGC_REVISIONES).filter(esActivoSgc_);
  var avisos = 0;

  // 1. Convocatoria: hay que avisar 10 dias habiles antes. Se recuerda
  // MIENTRAS todavia se puede cumplir, no cuando ya se paso.
  activas.forEach(function (r) {
    if (r.estado !== 'PROGRAMADA' || !r.aviso_plazo) return;
    var limite = new Date(r.aviso_plazo);
    if (isNaN(limite.getTime()) || limite > ahora) return;
    var cuerpo = 'La revisión por la dirección ' + r.correlativo + ' está programada para el ' +
      String(r.fecha_programada).slice(0, 10) + ' y todavía no se ha convocado.\n\n' +
      'PRO-05 §6 exige avisar a los asistentes con al menos ' + DIAS_CONVOCATORIA_REVISION +
      ' días hábiles de anticipación.';
    encargados.forEach(function (email) {
      enviarCorreo_(r.revision_id, email, 'SGC_REVISION_CONVOCAR:' + hoy,
        'SIGSO — Falta convocar la revisión por la dirección ' + r.correlativo, cuerpo);
      encolarNotificacionApp_(email, 'SGC_REVISION', 'Falta convocar la revisión por la dirección',
        r.correlativo + ' se realiza el ' + String(r.fecha_programada).slice(0, 10) + '.',
        'calidad', 'Ver revisiones', 72);
      avisos++;
    });
  });

  // 2. Frecuencia: PRO-05 pide una revision al menos cada 12 meses. Si la
  // ultima cerrada quedo fuera de plazo -- o nunca hubo -- se avisa.
  var vig = vigenciaRevision_(activas, ahora);
  if (vig.vencida) {
    var cuerpoV = vig.ultima_fecha
      ? 'La última revisión por la dirección fue el ' + String(vig.ultima_fecha).slice(0, 10) +
        '. PRO-05 §6 pide una al menos cada ' + MESES_FRECUENCIA_REVISION + ' meses.'
      : 'Todavía no se ha registrado ninguna revisión por la dirección. La norma (§9.3) la exige.';
    encargados.forEach(function (email) {
      enviarCorreo_('SGC-REVISION', email, 'SGC_REVISION_VENCIDA:' + hoy,
        'SIGSO — Revisión por la dirección pendiente', cuerpoV);
      avisos++;
    });
  }

  return { avisos: avisos, convocatoria_pendiente: activas.filter(function (r) {
    return r.estado === 'PROGRAMADA' && r.aviso_plazo && new Date(r.aviso_plazo) <= ahora;
  }).length, frecuencia_vencida: vig.vencida };
};

// --- constantes -------------------------------------------------------------

// Las 13 entradas de §9.3.2, en el orden y con la redaccion del
// FO-PRO-05-01. `auto` marca cuales resuelve el sistema con sus propios
// datos; `pendiente_fase` deja declarado lo que todavia no puede resolver,
// para no hacerlo pasar por "no aplica".
var ENTRADAS_REVISION = [
  { numero: 1, titulo: 'El estado de las acciones de las revisiones por la dirección previas', auto: true },
  { numero: 2, titulo: 'Los cambios en las cuestiones externas e internas que sean pertinentes al sistema de gestión de la calidad', auto: false },
  { numero: 3, titulo: 'La adecuación de los recursos', auto: false },
  { numero: 4, titulo: 'La eficacia de las acciones tomadas para abordar los riesgos y las oportunidades', auto: false },
  { numero: 5, titulo: 'Las oportunidades de mejora', auto: false },
  { numero: 6, titulo: 'La información sobre el desempeño y la eficacia del sistema de gestión de la calidad', auto: false },
  { numero: 7, titulo: 'La satisfacción del cliente y la retroalimentación de las partes interesadas pertinentes', auto: true },
  // v10.0 Fase 6a: dejo de estar pendiente -- ya existe el tablero de DOC-07.
  { numero: 8, titulo: 'El grado en que se han logrado los objetivos de la calidad', auto: true },
  { numero: 9, titulo: 'El desempeño de los procesos y conformidad de los productos y servicios', auto: false },
  { numero: 10, titulo: 'Las no conformidades y acciones correctivas', auto: true },
  { numero: 11, titulo: 'Los resultados de seguimiento y medición', auto: false },
  { numero: 12, titulo: 'Los resultados de las auditorías', auto: true },
  { numero: 13, titulo: 'El desempeño de los proveedores externos', auto: true }
];

// Las 3 salidas de §9.3.3, tal como las lista la tabla 3 del formulario.
var TIPOS_ACUERDO_REVISION = [
  { tipo: 'MEJORA', etiqueta: 'Las oportunidades de mejora' },
  { tipo: 'CAMBIO_SGC', etiqueta: 'Cualquier necesidad de cambio en el sistema de gestión de la calidad' },
  { tipo: 'RECURSOS', etiqueta: 'Las necesidades de recursos' }
];

var DIAS_CONVOCATORIA_REVISION = 10;   // dias HABILES (PRO-05 §6)
var MESES_FRECUENCIA_REVISION = 12;

// --- el resumen automatico ---------------------------------------------------

/**
 * Arma el texto inicial de las entradas que el sistema puede responder con
 * sus propios datos. Devuelve { numero: texto }.
 *
 * El periodo es el año de la revision: es el corte natural de una revision
 * anual y el que hace comparables dos actas consecutivas.
 */
function resumenAutomaticoRevision_(revision) {
  var anio = Number(revision.anio) || new Date(revision.fecha_programada || Date.now()).getFullYear();
  var desde = new Date(Date.UTC(anio, 0, 1));
  var hasta = new Date(Date.UTC(anio, 11, 31, 23, 59, 59));
  var enPeriodo = function (valor) {
    var f = new Date(valor);
    return !isNaN(f.getTime()) && f >= desde && f <= hasta;
  };

  var resumen = {};

  // Item 1 — acuerdos de la revision anterior y en que quedaron.
  var previas = leerFilasSeguro_(SHEETS.SGC_REVISIONES).filter(function (r) {
    return esActivoSgc_(r) && r.revision_id !== revision.revision_id && r.estado === 'CERRADA';
  }).sort(function (a, b) { return new Date(b.fecha_reunion || 0) - new Date(a.fecha_reunion || 0); });
  if (!previas.length) {
    resumen[1] = 'Es la primera revisión por la dirección registrada: no hay acuerdos previos que revisar.';
  } else {
    var anterior = previas[0];
    var acuerdosPrevios = leerFilasSeguro_(SHEETS.SGC_REVISION_ACUERDOS).filter(function (a) {
      return a.revision_id === anterior.revision_id && esActivoSgc_(a);
    });
    var actividades = leerFilasSeguro_(SHEETS.ACTIVIDADES);
    var terminados = 0;
    acuerdosPrevios.forEach(function (a) {
      var act = actividades.filter(function (x) { return x.actividad_id === a.actividad_id; })[0];
      if (act && act.estado === 'TERMINADA') terminados++;
    });
    resumen[1] = 'Revisión anterior: ' + anterior.correlativo + ' (' +
      String(anterior.fecha_reunion || '').slice(0, 10) + '). ' +
      acuerdosPrevios.length + ' acuerdo(s), ' + terminados + ' cumplido(s) y ' +
      (acuerdosPrevios.length - terminados) + ' pendiente(s).';
  }

  // Item 7 — satisfaccion del cliente: las quejas del periodo.
  var quejas = leerFilasSeguro_(SHEETS.SGC_QUEJAS).filter(function (q) {
    return esVerdaderoSgc_(q.activa) && enPeriodo(q.fecha_envio);
  });
  var porTipo = { QUEJA: 0, RECLAMACION: 0, FELICITACION: 0, CONSULTA: 0 };
  var conformes = 0, medidos = 0;
  quejas.forEach(function (q) {
    if (porTipo[q.tipo] !== undefined) porTipo[q.tipo]++;
    if (q.cliente_conforme !== '' && q.cliente_conforme !== undefined && q.fecha_seguimiento) {
      medidos++;
      if (esVerdaderoSgc_(q.cliente_conforme)) conformes++;
    }
  });
  resumen[7] = quejas.length
    ? 'En ' + anio + ' se recibieron ' + quejas.length + ' mensajes: ' +
      porTipo.QUEJA + ' quejas, ' + porTipo.RECLAMACION + ' reclamaciones, ' +
      porTipo.FELICITACION + ' felicitaciones y ' + porTipo.CONSULTA + ' consultas. ' +
      (medidos
        ? 'De los casos con seguimiento cerrado, ' + conformes + ' de ' + medidos + ' clientes quedaron conformes.'
        : 'Todavía no hay seguimientos cerrados que midan conformidad.')
    : 'En ' + anio + ' no se recibieron quejas, felicitaciones ni consultas por el canal formal.';

  // Item 8 — grado de logro de los objetivos de calidad (Fase 6a). El texto
  // lo arma Objetivos.gs, que es el que sabe leer una meta y una lectura.
  resumen[8] = Objetivos.resumenParaRevision(anio);

  // Item 10 — no conformidades y acciones correctivas.
  var ncs = leerFilasSeguro_(SHEETS.SGC_NC).filter(function (n) {
    return esVerdaderoSgc_(n.activa) && enPeriodo(n.fecha_deteccion || n.fecha_creacion);
  });
  var cerradas = ncs.filter(function (n) { return n.estado === 'CERRADA'; }).length;
  var eficaces = ncs.filter(function (n) { return n.eficacia_resultado === 'EFICAZ'; }).length;
  resumen[10] = ncs.length
    ? 'En ' + anio + ' se levantaron ' + ncs.length + ' no conformidades: ' + cerradas +
      ' cerradas y ' + (ncs.length - cerradas) + ' en curso. ' + eficaces +
      ' verificaron su acción correctiva como eficaz.'
    : 'En ' + anio + ' no se levantaron no conformidades.';

  // Item 12 — auditorias internas.
  var auds = leerFilasSeguro_(SHEETS.SGC_AUDITORIAS).filter(function (a) {
    return esVerdaderoSgc_(a.activa) && (Number(a.anio) === anio || enPeriodo(a.fecha_programada));
  });
  var ejecutadas = auds.filter(function (a) { return a.fecha_ejecucion; }).length;
  var hallazgos = leerFilasSeguro_(SHEETS.SGC_AUD_HALLAZGOS).filter(function (h) {
    if (!esVerdaderoActivoSgc_(h)) return false;
    return auds.some(function (a) { return a.auditoria_id === h.auditoria_id; });
  });
  var noConformes = hallazgos.filter(function (h) { return h.resultado === 'NO_CONFORMIDAD'; }).length;
  resumen[12] = auds.length
    ? 'Programa ' + anio + ': ' + auds.length + ' auditoría(s), ' + ejecutadas + ' ejecutada(s). ' +
      'Se registraron ' + hallazgos.length + ' hallazgos, de los cuales ' + noConformes + ' fueron no conformidades.'
    : 'En ' + anio + ' no se registraron auditorías internas en el programa.';

  // Item 13 — desempeño de proveedores externos (Fase 5a).
  var provs = leerFilasSeguro_(SHEETS.SGC_PROVEEDORES).filter(esActivoSgc_);
  var aprob = provs.filter(function (p) { return p.estado === 'APROBADO'; }).length;
  var reprob = provs.filter(function (p) { return p.estado === 'REPROBADO'; }).length;
  var sinEval = provs.filter(function (p) { return p.estado === 'SIN_EVALUAR'; }).length;
  resumen[13] = provs.length
    ? provs.length + ' proveedores en el listado: ' + aprob + ' aprobados, ' + reprob +
      ' reprobados y ' + sinEval + ' sin evaluar.' +
      (reprob ? ' Los reprobados requieren decisión de la Dirección (PRO-04 §6.2).' : '')
    : 'No hay proveedores externos registrados en el listado.';

  return resumen;
}

// --- helpers ----------------------------------------------------------------

function buscarRevision_(revisionId) {
  if (!revisionId) return null;
  return leerFilasSeguro_(SHEETS.SGC_REVISIONES).filter(function (r) {
    return r.revision_id === revisionId && esActivoSgc_(r);
  })[0] || null;
}

function siguienteCorrelativoRevision_(fecha) {
  var anio = new Date(fecha).getFullYear();
  if (isNaN(anio)) anio = new Date().getFullYear();
  var delAnio = leerFilasSeguro_(SHEETS.SGC_REVISIONES).filter(function (r) {
    return Number(r.anio) === anio;
  }).length;
  return 'RD-' + anio + '-' + ('0' + (delAnio + 1)).slice(-2);
}

function etiquetaAcuerdoRevision_(tipo) {
  var t = TIPOS_ACUERDO_REVISION.filter(function (x) { return x.tipo === tipo; })[0];
  return t ? t.etiqueta : tipo;
}

// Acepta [{nombre, cargo}] o texto "Nombre - Cargo" por linea, que es como
// se copia desde el acta en papel.
function normalizarAsistentes_(valor) {
  var lista = valor;
  if (typeof lista === 'string') {
    lista = lista.split('\n').map(function (linea) {
      var partes = String(linea).split(/\s+[-–]\s+/);
      return { nombre: (partes[0] || '').trim(), cargo: (partes[1] || '').trim() };
    });
  }
  if (Object.prototype.toString.call(lista) !== '[object Array]') return [];
  return lista.map(function (a) {
    return { nombre: String((a && a.nombre) || '').trim(), cargo: String((a && a.cargo) || '').trim() };
  }).filter(function (a) { return a.nombre; });
}

// Acepta { "1": "texto", ... } o [{item, observaciones}].
function normalizarEntradasRevision_(valor) {
  var salida = {};
  if (!valor) return salida;
  if (Object.prototype.toString.call(valor) === '[object Array]') {
    valor.forEach(function (e) {
      if (e && e.item !== undefined) salida[Number(e.item)] = e.observaciones;
    });
    return salida;
  }
  Object.keys(valor).forEach(function (k) { salida[Number(k)] = valor[k]; });
  return salida;
}

function entradasDeRevision_(revision) {
  var guardadas = {};
  try {
    var parsed = JSON.parse(revision.entradas || '[]');
    if (Object.prototype.toString.call(parsed) === '[object Array]') {
      parsed.forEach(function (e) { guardadas[Number(e.item)] = e.observaciones; });
    }
  } catch (err) { /* celda editada a mano: se trata como vacia */ }

  return ENTRADAS_REVISION.map(function (e) {
    return {
      numero: e.numero,
      titulo: e.titulo,
      auto: !!e.auto,
      pendiente_fase: e.pendiente_fase || '',
      observaciones: guardadas[e.numero] || ''
    };
  });
}

function asistentesDeRevision_(revision) {
  try {
    var parsed = JSON.parse(revision.asistentes || '[]');
    return Object.prototype.toString.call(parsed) === '[object Array]' ? parsed : [];
  } catch (err) { return []; }
}

function resumenRevision_(r, acuerdos, ahora) {
  var mios = (acuerdos || []).filter(function (a) { return a.revision_id === r.revision_id; });
  var entradas = entradasDeRevision_(r);
  return {
    revision_id: r.revision_id,
    correlativo: r.correlativo,
    anio: Number(r.anio) || null,
    fecha_programada: r.fecha_programada,
    aviso_plazo: r.aviso_plazo,
    fecha_convocatoria: r.fecha_convocatoria,
    fecha_reunion: r.fecha_reunion,
    asistentes: asistentesDeRevision_(r),
    conclusiones: r.conclusiones,
    anexos: r.anexos,
    director_email: r.director_email,
    responsable_calidad_email: r.responsable_calidad_email,
    estado: r.estado,
    fecha_cierre: r.fecha_cierre,
    total_acuerdos: mios.length,
    entradas_completas: entradas.filter(function (e) { return !!e.observaciones; }).length,
    total_entradas: ENTRADAS_REVISION.length,
    // Señal calculada: falta convocar y ya se paso el plazo de 10 dias
    // habiles. No se persiste para que nunca quede desfasada.
    convocatoria_atrasada: r.estado === 'PROGRAMADA' && !!r.aviso_plazo &&
      new Date(r.aviso_plazo) < ahora,
    dias_para_convocar: r.aviso_plazo ? diasHastaSgc_(r.aviso_plazo, ahora) : null
  };
}

// Cuando vencio (o vence) la obligacion de hacer la proxima revision.
function vigenciaRevision_(revisiones, ahora) {
  var cerradas = (revisiones || []).filter(function (r) {
    return r.estado === 'CERRADA' && r.fecha_reunion;
  }).sort(function (a, b) { return new Date(b.fecha_reunion) - new Date(a.fecha_reunion); });

  if (!cerradas.length) {
    // Nunca se hizo una: esta vencida por definicion, no "al dia por no
    // tener antecedentes".
    return { vencida: true, ultima_fecha: '', proxima: '', dias_restantes: null };
  }
  var ultima = cerradas[0].fecha_reunion;
  var proxima = sumarMesesSgc_(ultima, MESES_FRECUENCIA_REVISION);
  return {
    vencida: new Date(proxima) < ahora,
    ultima_fecha: ultima,
    proxima: proxima,
    dias_restantes: diasHastaSgc_(proxima, ahora)
  };
}

// Resta N dias HABILES a una fecha. Es el inverso de sumarDiasHabilesSgc_ y
// hace falta para el plazo de convocatoria, que se cuenta hacia atras desde
// la reunion (PRO-05 §6).
function restarDiasHabilesSgc_(fecha, dias) {
  var inicio = new Date(fecha);
  if (isNaN(inicio.getTime())) return '';
  var tz = getConfig_().timezone;
  // Mismo armado del set de feriados que sumarDiasHabilesSgc_: esDiaHabil_
  // lo espera como parametro, no lo lee solo.
  var feriadosSet = {};
  (obtenerFeriados_() || []).forEach(function (f) {
    var clave = typeof f === 'string' ? f.slice(0, 10) : claveDia_(new Date(f), tz);
    feriadosSet[clave] = true;
  });

  var clave = claveDia_(inicio, tz);
  var restantes = dias;
  var guarda = 0;
  while (restantes > 0 && guarda < 400) {
    clave = anteriorDiaClave_(clave);
    if (esDiaHabil_(clave, feriadosSet)) restantes--;
    guarda++;
  }
  var partes = clave.split('-').map(Number);
  return new Date(Date.UTC(partes[0], partes[1] - 1, partes[2], 0, 0, 0)).toISOString();
}

// Espejo exacto de siguienteDiaClave_ (Utils.gs): aritmetica UTC pura y
// toISOString, NO claveDia_. Volver a formatear con zona horaria aca
// descontaria un dia extra en husos al oeste de UTC -- la clave es una
// etiqueta de dia, no un instante que haya que reinterpretar.
function anteriorDiaClave_(claveDia) {
  var partes = claveDia.split('-').map(Number);
  var anterior = new Date(Date.UTC(partes[0], partes[1] - 1, partes[2] - 1));
  return anterior.toISOString().slice(0, 10);
}
