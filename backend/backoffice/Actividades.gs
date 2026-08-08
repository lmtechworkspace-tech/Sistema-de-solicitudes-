/**
 * Actividades.gs — v7.0 Fase 1 (Nucleo).
 * documentacion/SIGSO-v7.0-propuesta-modulo-gestion-operacional.md §4.2-4.3, Parte VI.
 *
 * Modulo de Gestion Operacional: compromisos de trabajo con check-in ligero.
 * NO es un sistema de vigilancia (§2.3 de la propuesta) -- el diseno entero
 * (check-in de un clic, "sin cambios" como respuesta valida, sin rankings
 * individuales) existe para que sirva TANTO al colaborador como a quien lo
 * supervisa, nunca solo al segundo.
 *
 * Reutiliza patrones ya existentes en SIGSO en vez de inventar nuevos:
 *   - JEFATURAS (Jefatura.gs) para el alcance de "mi equipo" (RN-707).
 *   - Una sola tabla de bitacora (ACTIVIDADES_BITACORA), igual espiritu que
 *     el LOG unificado de Pausas -- no el patron HISTORIAL_* x4 de
 *     Solicitudes (decision deliberada, ver §4.2 de la propuesta).
 *
 * Fase 1 = nucleo: CRUD, maquina de estados (§4.3), bitacora, permisos por
 * JEFATURAS. La UI (Mi trabajo / Actividades del equipo / Gerencia) es F2-F5.
 */

var Actividades = {
  // --- lectura, siempre acotada por RN-707 --------------------------------
  listar: function (filtros, contexto) {
    var alcance = alcanceActividades_(contexto);
    var filas = leerFilasSeguro_(SHEETS.ACTIVIDADES).filter(function (a) {
      return (a.activa === true || a.activa === 'TRUE' || a.activa === 1) &&
        (alcance.todas || alcance.emails[normalizarEmail_(a.responsable_email)]);
    });
    if (filtros && filtros.estado) {
      filas = filas.filter(function (a) { return a.estado === filtros.estado; });
    }
    if (filtros && filtros.responsable_email) {
      var email = normalizarEmail_(filtros.responsable_email);
      filas = filas.filter(function (a) { return normalizarEmail_(a.responsable_email) === email; });
    }
    return filas;
  },

  obtenerDetalle: function (data, contexto) {
    var actividad = buscarActividad_(data.actividad_id);
    if (!actividad) {
      return errorValidacion_('actividad_id', 'Actividad no encontrada.');
    }
    if (!puedeVerActividad_(actividad, contexto)) {
      return { _forbidden: true, message: 'No tienes acceso a esta actividad.' };
    }
    return {
      actividad: actividad,
      bitacora: leerFilasSeguro_(SHEETS.ACTIVIDADES_BITACORA)
        .filter(function (b) { return b.actividad_id === actividad.actividad_id; })
        .sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); })
    };
  },

  // --- creacion (RN-700/701/709/710) --------------------------------------
  crear: function (data, contexto) {
    var titulo = String(data.titulo || '').trim();
    if (!titulo) {
      return errorValidacion_('titulo', 'El titulo es obligatorio.');
    }
    var origen = ['ASIGNADA', 'PROPIA', 'EMERGENTE', 'SOLICITUD'].indexOf(data.origen) !== -1
      ? data.origen
      : 'PROPIA';
    var responsableEmail = normalizarEmail_(data.responsable_email || contexto.email);
    if (!responsableEmail) {
      return errorValidacion_('responsable_email', 'Falta el responsable.');
    }
    var esParaSiMismo = responsableEmail === normalizarEmail_(contexto.email);

    // RN-709: quien puede crear para quien.
    if (!esParaSiMismo && contexto.rol !== 'ADM') {
      var equipo = obtenerEquipoJefe_(contexto.email).map(normalizarEmail_);
      if (equipo.indexOf(responsableEmail) === -1) {
        return { _forbidden: true, message: 'Solo puedes crear actividades para tu equipo.' };
      }
    }

    var fecha = data.fecha_compromiso || data.fecha_propuesta;
    if (!fecha) {
      return errorValidacion_('fecha_compromiso', 'La fecha de compromiso es obligatoria.');
    }

    // RN-701: supervisor por defecto es el jefe del responsable en JEFATURAS.
    var supervisorEmail = normalizarEmail_(data.supervisor_email) || normalizarEmail_(jefeDeSubordinado_(responsableEmail));
    // RN-701: "si no lo tiene [jefe en JEFATURAS], se exige elegirlo
    // explicitamente" -- pero exigirlo como bloqueo duro rompe el caso mas
    // comun de "Mi trabajo" (§5.1): una persona sin JEFATURAS configurada
    // (ADM, GERENCIA, o una organizacion que recien empieza a usar el
    // modulo) jamas podria registrar ni una actividad propia. El default
    // practico es "quien crea, se hace cargo hasta que se le asigne un
    // supervisor real" -- nunca deja el campo vacio (RN-700 sigue exigiendo
    // los tres datos), y un ADM puede corregirlo despues desde JEFATURAS.
    if (!supervisorEmail) {
      supervisorEmail = normalizarEmail_(contexto.email);
    }

    var ahora = new Date();
    // §4.3.1: el propio responsable confirma en el mismo acto (PROPIA/
    // EMERGENTE, o cuando ADM/supervisor crean para si mismos). Si un
    // tercero crea para otra persona, la fecha queda "propuesta" hasta que
    // el responsable la confirme (RN-710).
    var confirmadaDeInmediato = esParaSiMismo;

    var actividad = {
      actividad_id: Utilities.getUuid(),
      titulo: titulo,
      descripcion: data.descripcion || '',
      origen: origen,
      solicitud_id: data.solicitud_id || '',
      responsable_email: responsableEmail,
      responsable_nombre: data.responsable_nombre || '',
      supervisor_email: supervisorEmail,
      area_id: data.area_id || '',
      cliente_id: data.cliente_id || '',
      proyecto: data.proyecto || '',
      prioridad: ORDEN_PRIORIDAD.indexOf(data.prioridad) !== -1 ? data.prioridad : PRIORIDAD_POR_DEFECTO,
      estado: ACTIVIDADES_ESTADOS.NO_INICIADA,
      tamano: ['S', 'M', 'L', 'XL'].indexOf(data.tamano) !== -1 ? data.tamano : 'M',
      fecha_propuesta: confirmadaDeInmediato ? '' : fecha,
      fecha_compromiso: confirmadaDeInmediato ? fecha : '',
      confirmada_en: confirmadaDeInmediato ? ahora.toISOString() : '',
      requiere_validacion: data.requiere_validacion === true,
      recurrencia: ['NINGUNA', 'SEMANAL', 'MENSUAL'].indexOf(data.recurrencia) !== -1 ? data.recurrencia : 'NINGUNA',
      recurrencia_origen_id: data.recurrencia_origen_id || '',
      fecha_inicio_plan: data.fecha_inicio_plan || '',
      fecha_terminada: '',
      confianza: 'VERDE',
      avance_pct: '',
      bloqueo_motivo: '',
      bloqueo_responsable_email: '',
      bloqueo_desde: '',
      ultima_actualizacion: ahora.toISOString(),
      reprogramaciones: 0,
      fecha_creacion: ahora.toISOString(),
      creado_por: contexto.email || '',
      activa: true
    };
    agregarFila_(SHEETS.ACTIVIDADES, actividad);
    registrarEventoActividad_(actividad.actividad_id, 'CREADA', contexto, '');
    return actividad;
  },

  // §4.3.1: el responsable confirma la fecha propuesta, o contrapropone otra
  // (RN-711, no es un rechazo). Ambos casos exigen ser el responsable.
  confirmar: function (data, contexto) {
    var actividad = buscarActividad_(data.actividad_id);
    if (!actividad) return errorValidacion_('actividad_id', 'Actividad no encontrada.');
    if (normalizarEmail_(actividad.responsable_email) !== normalizarEmail_(contexto.email)) {
      return { _forbidden: true, message: 'Solo el responsable puede confirmar su compromiso.' };
    }
    if (actividad.confirmada_en) {
      return errorValidacion_('actividad_id', 'Esta actividad ya fue confirmada.');
    }
    var fechaFinal = data.fecha_compromiso || actividad.fecha_propuesta;
    if (!fechaFinal) {
      return errorValidacion_('fecha_compromiso', 'Falta la fecha de compromiso.');
    }
    var esContrapropuesta = data.fecha_compromiso && data.fecha_compromiso !== actividad.fecha_propuesta;
    var ahora = new Date();
    var actualizado = reescribirActividad_(actividad.actividad_id, {
      fecha_compromiso: fechaFinal,
      fecha_propuesta: '',
      confirmada_en: ahora.toISOString(),
      ultima_actualizacion: ahora.toISOString()
    });
    registrarEventoActividad_(actividad.actividad_id, 'CREADA', contexto,
      esContrapropuesta ? ('Confirmo con contrapropuesta: ' + (data.motivo || '')) : 'Confirmo la fecha propuesta.');
    return actualizado;
  },

  // --- el check-in (§4.4): la accion diaria del responsable --------------
  checkin: function (data, contexto) {
    var actividad = buscarActividad_(data.actividad_id);
    if (!actividad) return errorValidacion_('actividad_id', 'Actividad no encontrada.');
    // RN-702: solo el responsable hace check-in de su actividad.
    if (normalizarEmail_(actividad.responsable_email) !== normalizarEmail_(contexto.email)) {
      return { _forbidden: true, message: 'Solo el responsable puede actualizar esta actividad.' };
    }
    if (esEstadoTerminal_(actividad.estado)) {
      return errorValidacion_('actividad_id', 'Esta actividad ya esta cerrada.');
    }

    var tipo = data.tipo; // 'avance' | 'sin_cambio' | 'bloqueo' | 'desbloqueo' | 'listo'
    var ahora = new Date();
    var cambios = { ultima_actualizacion: ahora.toISOString() };
    var eventoBitacora, notaBitacora = data.nota || '';

    switch (tipo) {
      case 'avance':
        cambios.estado = ACTIVIDADES_ESTADOS.EN_CURSO;
        if (data.confianza) cambios.confianza = data.confianza;
        if (data.avance_pct !== undefined && data.avance_pct !== '') cambios.avance_pct = data.avance_pct;
        eventoBitacora = 'CHECKIN_AVANCE';
        break;

      case 'sin_cambio':
        // §4.4: respuesta legitima y no penalizada. Igual mueve
        // ultima_actualizacion (RN-705: es un check-in real).
        if (actividad.estado === ACTIVIDADES_ESTADOS.NO_INICIADA) cambios.estado = ACTIVIDADES_ESTADOS.EN_CURSO;
        eventoBitacora = 'CHECKIN_SIN_CAMBIO';
        break;

      case 'bloqueo':
        var motivo = String(data.bloqueo_motivo || '').trim();
        if (!motivo) return errorValidacion_('bloqueo_motivo', 'Indica el motivo del bloqueo.'); // RN-704
        cambios.estado = ACTIVIDADES_ESTADOS.BLOQUEADA;
        cambios.bloqueo_motivo = motivo;
        cambios.bloqueo_responsable_email = normalizarEmail_(data.bloqueo_responsable_email) || '';
        cambios.bloqueo_desde = ahora.toISOString();
        eventoBitacora = 'BLOQUEO';
        notaBitacora = motivo;
        break;

      case 'desbloqueo':
        if (actividad.estado !== ACTIVIDADES_ESTADOS.BLOQUEADA) {
          return errorValidacion_('actividad_id', 'La actividad no esta bloqueada.');
        }
        cambios.estado = ACTIVIDADES_ESTADOS.EN_CURSO;
        cambios.bloqueo_motivo = '';
        cambios.bloqueo_responsable_email = '';
        cambios.bloqueo_desde = '';
        eventoBitacora = 'DESBLOQUEO';
        break;

      case 'listo':
        cambios.estado = actividad.requiere_validacion
          ? ACTIVIDADES_ESTADOS.EN_REVISION
          : ACTIVIDADES_ESTADOS.TERMINADA;
        if (cambios.estado === ACTIVIDADES_ESTADOS.TERMINADA) {
          cambios.fecha_terminada = ahora.toISOString();
        }
        eventoBitacora = 'ENTREGA';
        break;

      default:
        return errorValidacion_('tipo', 'Tipo de check-in invalido: ' + tipo);
    }

    var actualizado = reescribirActividad_(actividad.actividad_id, cambios);
    registrarEventoActividad_(actividad.actividad_id, eventoBitacora, contexto, notaBitacora,
      { avance_pct: cambios.avance_pct, confianza: cambios.confianza });

    // RN-713: al cerrar una recurrente, nace la siguiente instancia.
    if (cambios.estado === ACTIVIDADES_ESTADOS.TERMINADA && actividad.recurrencia && actividad.recurrencia !== 'NINGUNA') {
      crearSiguienteRecurrencia_(actualizado);
    }
    return actualizado;
  },

  // --- validacion del supervisor (EN_REVISION -> TERMINADA | EN_CURSO) ---
  validar: function (data, contexto) {
    var actividad = buscarActividad_(data.actividad_id);
    if (!actividad) return errorValidacion_('actividad_id', 'Actividad no encontrada.');
    if (actividad.estado !== ACTIVIDADES_ESTADOS.EN_REVISION) {
      return errorValidacion_('actividad_id', 'Esta actividad no esta en revision.');
    }
    if (!puedeSupervisar_(actividad, contexto)) {
      return { _forbidden: true, message: 'Solo el supervisor de esta actividad puede validarla.' };
    }
    var ahora = new Date();
    if (data.aprobar === false) {
      var actualizado = reescribirActividad_(actividad.actividad_id, {
        estado: ACTIVIDADES_ESTADOS.EN_CURSO,
        ultima_actualizacion: ahora.toISOString()
      });
      registrarEventoActividad_(actividad.actividad_id, 'VALIDACION', contexto, 'Devuelta: ' + (data.motivo || ''));
      return actualizado;
    }
    var cerrada = reescribirActividad_(actividad.actividad_id, {
      estado: ACTIVIDADES_ESTADOS.TERMINADA,
      fecha_terminada: ahora.toISOString(),
      ultima_actualizacion: ahora.toISOString()
    });
    registrarEventoActividad_(actividad.actividad_id, 'VALIDACION', contexto, 'Aprobada.');
    if (actividad.recurrencia && actividad.recurrencia !== 'NINGUNA') {
      crearSiguienteRecurrencia_(cerrada);
    }
    return cerrada;
  },

  // --- cancelacion (terminal, cualquier estado no cerrado) ----------------
  cancelar: function (data, contexto) {
    var actividad = buscarActividad_(data.actividad_id);
    if (!actividad) return errorValidacion_('actividad_id', 'Actividad no encontrada.');
    if (esEstadoTerminal_(actividad.estado)) {
      return errorValidacion_('actividad_id', 'Esta actividad ya esta cerrada.');
    }
    var motivo = String(data.motivo || '').trim();
    if (!motivo) return errorValidacion_('motivo', 'Indica el motivo de la cancelacion.');
    if (!puedeGestionar_(actividad, contexto)) {
      return { _forbidden: true, message: 'No puedes cancelar esta actividad.' };
    }
    var actualizado = reescribirActividad_(actividad.actividad_id, {
      estado: ACTIVIDADES_ESTADOS.CANCELADA,
      ultima_actualizacion: new Date().toISOString()
    });
    registrarEventoActividad_(actividad.actividad_id, 'CAMBIO_ESTADO', contexto, 'Cancelada: ' + motivo);
    return actualizado;
  },

  // --- reprogramacion (RN-703): mover fecha_compromiso de algo ya iniciado
  reprogramar: function (data, contexto) {
    var actividad = buscarActividad_(data.actividad_id);
    if (!actividad) return errorValidacion_('actividad_id', 'Actividad no encontrada.');
    if (esEstadoTerminal_(actividad.estado)) {
      return errorValidacion_('actividad_id', 'Esta actividad ya esta cerrada.');
    }
    var fechaNueva = data.fecha_compromiso;
    if (!fechaNueva) return errorValidacion_('fecha_compromiso', 'Falta la nueva fecha.');
    var motivo = String(data.motivo || '').trim();
    if (!motivo) return errorValidacion_('motivo', 'Toda reprogramacion exige un motivo.');
    if (!puedeGestionar_(actividad, contexto)) {
      return { _forbidden: true, message: 'No puedes reprogramar esta actividad.' };
    }
    var fechaAnterior = actividad.fecha_compromiso;
    var actualizado = reescribirActividad_(actividad.actividad_id, {
      fecha_compromiso: fechaNueva,
      reprogramaciones: (Number(actividad.reprogramaciones) || 0) + 1,
      ultima_actualizacion: new Date().toISOString()
    });
    registrarEventoActividad_(actividad.actividad_id, 'REPROGRAMACION', contexto,
      motivo, { fecha_anterior: fechaAnterior, fecha_nueva: fechaNueva });
    return actualizado;
  }
};

// --- maquina de estados (§4.3) ---------------------------------------------

var ACTIVIDADES_ESTADOS = {
  NO_INICIADA: 'NO_INICIADA',
  EN_CURSO: 'EN_CURSO',
  BLOQUEADA: 'BLOQUEADA',
  EN_REVISION: 'EN_REVISION',
  TERMINADA: 'TERMINADA',
  CANCELADA: 'CANCELADA'
};

var ACTIVIDADES_ESTADOS_TERMINALES = [ACTIVIDADES_ESTADOS.TERMINADA, ACTIVIDADES_ESTADOS.CANCELADA];

function esEstadoTerminal_(estado) {
  return ACTIVIDADES_ESTADOS_TERMINALES.indexOf(estado) !== -1;
}

// --- permisos (RN-707/708/709) ---------------------------------------------

// Alcance de lectura: ADM/GERENCIA ven todo; el resto ve lo suyo + su
// equipo (JEFATURAS) -- mismo criterio que Jefatura.getPanel.
function alcanceActividades_(contexto) {
  if (!contexto) return { todas: false, emails: {} };
  if (contexto.rol === 'ADM' || contexto.rol === 'GERENCIA') {
    return { todas: true, emails: {} };
  }
  var emails = {};
  emails[normalizarEmail_(contexto.email)] = true;
  obtenerEquipoJefe_(contexto.email).forEach(function (email) {
    emails[normalizarEmail_(email)] = true;
  });
  return { todas: false, emails: emails };
}

function puedeVerActividad_(actividad, contexto) {
  var alcance = alcanceActividades_(contexto);
  return alcance.todas || !!alcance.emails[normalizarEmail_(actividad.responsable_email)];
}

// El supervisor asignado de la actividad, o ADM.
function puedeSupervisar_(actividad, contexto) {
  if (contexto.rol === 'ADM') return true;
  return normalizarEmail_(actividad.supervisor_email) === normalizarEmail_(contexto.email);
}

// Responsable, supervisor asignado o ADM -- usado por cancelar/reprogramar,
// que no son el check-in exclusivo del responsable (RN-702) sino ajustes de
// gestion que el supervisor tambien puede necesitar hacer.
function puedeGestionar_(actividad, contexto) {
  if (contexto.rol === 'ADM') return true;
  var email = normalizarEmail_(contexto.email);
  return normalizarEmail_(actividad.responsable_email) === email ||
    normalizarEmail_(actividad.supervisor_email) === email;
}

function normalizarEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

// --- helpers internos --------------------------------------------------

function buscarActividad_(actividadId) {
  if (!actividadId) return null;
  var filas = leerFilasSeguro_(SHEETS.ACTIVIDADES);
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].actividad_id === actividadId) return filas[i];
  }
  return null;
}

function reescribirActividad_(actividadId, cambios) {
  return actualizarFilaPorId_(SHEETS.ACTIVIDADES, 'actividad_id', actividadId, cambios);
}

function registrarEventoActividad_(actividadId, tipo, contexto, nota, datos) {
  agregarFila_(SHEETS.ACTIVIDADES_BITACORA, {
    bitacora_id: Utilities.getUuid(),
    actividad_id: actividadId,
    tipo: tipo,
    autor_email: (contexto && contexto.email) || '',
    autor_nombre: (contexto && contexto.nombre) || '',
    nota: nota || '',
    avance_pct: (datos && datos.avance_pct !== undefined) ? datos.avance_pct : '',
    confianza: (datos && datos.confianza) || '',
    datos: datos ? JSON.stringify(datos) : '',
    timestamp: new Date().toISOString()
  });
}

// RN-713: al terminar una actividad recurrente, nace la siguiente -- mismos
// datos, fecha corrida, bitacora en blanco, encadenada por
// recurrencia_origen_id. Envuelto en try/catch: un fallo aqui no debe hacer
// perder el cierre de la actividad que si se completo.
function crearSiguienteRecurrencia_(actividadCerrada) {
  try {
    var siguienteFecha = correrFechaRecurrencia_(actividadCerrada.fecha_compromiso, actividadCerrada.recurrencia);
    if (!siguienteFecha) return null;
    var ahora = new Date();
    var siguiente = {
      actividad_id: Utilities.getUuid(),
      titulo: actividadCerrada.titulo,
      descripcion: actividadCerrada.descripcion || '',
      origen: actividadCerrada.origen,
      solicitud_id: actividadCerrada.solicitud_id || '',
      responsable_email: actividadCerrada.responsable_email,
      responsable_nombre: actividadCerrada.responsable_nombre || '',
      supervisor_email: actividadCerrada.supervisor_email,
      area_id: actividadCerrada.area_id || '',
      cliente_id: actividadCerrada.cliente_id || '',
      proyecto: actividadCerrada.proyecto || '',
      prioridad: actividadCerrada.prioridad,
      estado: ACTIVIDADES_ESTADOS.NO_INICIADA,
      tamano: actividadCerrada.tamano,
      fecha_propuesta: '',
      fecha_compromiso: siguienteFecha,
      confirmada_en: ahora.toISOString(),
      requiere_validacion: actividadCerrada.requiere_validacion === true,
      recurrencia: actividadCerrada.recurrencia,
      recurrencia_origen_id: actividadCerrada.actividad_id,
      fecha_inicio_plan: '',
      fecha_terminada: '',
      confianza: 'VERDE',
      avance_pct: '',
      bloqueo_motivo: '',
      bloqueo_responsable_email: '',
      bloqueo_desde: '',
      ultima_actualizacion: ahora.toISOString(),
      reprogramaciones: 0,
      fecha_creacion: ahora.toISOString(),
      creado_por: actividadCerrada.creado_por || '',
      activa: true
    };
    agregarFila_(SHEETS.ACTIVIDADES, siguiente);
    registrarEventoActividad_(siguiente.actividad_id, 'CREADA', { email: 'sistema', nombre: 'Recurrencia automatica' },
      'Generada automaticamente al cerrar ' + actividadCerrada.actividad_id + ' (RN-713).');
    return siguiente;
  } catch (err) {
    logError_(err, 'Actividades.crearSiguienteRecurrencia_');
    return null;
  }
}

// Aritmetica en UTC (no en hora local): fechaBase es una fecha de
// compromiso (sin hora), y el servidor puede ejecutarse en cualquier huso.
// Usar setDate/setMonth (locales) corre el resultado un dia segun el huso
// del proceso -- setUTCDate/setUTCMonth da el mismo resultado siempre.
function correrFechaRecurrencia_(fechaBase, recurrencia) {
  if (!fechaBase) return null;
  var f = new Date(fechaBase);
  if (isNaN(f.getTime())) return null;
  if (recurrencia === 'SEMANAL') {
    f.setUTCDate(f.getUTCDate() + 7);
  } else if (recurrencia === 'MENSUAL') {
    f.setUTCMonth(f.getUTCMonth() + 1);
  } else {
    return null;
  }
  return f.toISOString();
}
