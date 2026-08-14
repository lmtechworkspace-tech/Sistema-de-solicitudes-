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
    // v7.0 Fase 3: "Actividades del equipo" necesita ordenar/filtrar por
    // urgencia -- se clasifica aca (una sola vez, en el servidor) para que
    // "Mi trabajo" y la vista del supervisor usen SIEMPRE el mismo criterio,
    // en vez de reimplementarlo en cada modulo de frontend.
    return filas.map(function (a) {
      var s = semaforoActividad_(a);
      a.semaforo = s.codigo;
      a.semaforo_etiqueta = s.etiqueta;
      return a;
    });
  },

  // v7.0 Fase 3 (§5.2): "Actividades del equipo" -- lo mismo que listar(),
  // mas el desglose por persona para la carga del equipo. RN-707 ya acota
  // el alcance (si contexto no tiene equipo, todo sale vacio); no hace falta
  // un permiso nuevo.
  panelEquipo: function (filtros, contexto) {
    var items = Actividades.listar(filtros, contexto).filter(function (a) {
      // La vista del supervisor es sobre "mi gente", no sobre si mismo --
      // evita que el propio jefe se vea duplicado en su propia bandeja de
      // equipo (ya tiene "Mi trabajo" para eso).
      return normalizarEmail_(a.responsable_email) !== normalizarEmail_(contexto && contexto.email);
    });
    var porPersona = {};
    items.forEach(function (a) {
      var email = normalizarEmail_(a.responsable_email);
      if (!porPersona[email]) {
        porPersona[email] = { email: email, nombre: a.responsable_nombre || email, total: 0, en_riesgo: 0, bloqueadas: 0 };
      }
      porPersona[email].total++;
      if (a.semaforo === 'atrasada' || a.semaforo === 'riesgo') porPersona[email].en_riesgo++;
      if (a.semaforo === 'bloqueada') porPersona[email].bloqueadas++;
    });
    return {
      items: items,
      por_persona: Object.keys(porPersona).map(function (k) { return porPersona[k]; })
        .sort(function (a, b) { return b.total - a.total; })
    };
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

    // RN-709: quien puede crear para quien. v9.0 (Modulo de Proyectos):
    // ademas del equipo por JEFATURAS, un LIDER/INTEGRANTE/COLABORADOR del
    // proyecto (data.proyecto_id) puede crear tareas para cualquier otro
    // integrante de ESE MISMO proyecto -- la membresia del proyecto es su
    // propio circulo de confianza, independiente de la jerarquia formal.
    // rolEnProyecto_ vive en Proyectos.gs (mismo scope global de Apps
    // Script); si no hay proyecto_id, este bloque no cambia nada del
    // comportamiento de siempre.
    if (!esParaSiMismo && contexto.rol !== 'ADM') {
      var equipo = obtenerEquipoJefe_(contexto.email).map(normalizarEmail_);
      var esDelEquipoJefatura = equipo.indexOf(responsableEmail) !== -1;
      var esDelEquipoProyecto = data.proyecto_id &&
        !!rolEnProyecto_(data.proyecto_id, contexto) &&
        !!rolEnProyecto_(data.proyecto_id, { email: responsableEmail });
      if (!esDelEquipoJefatura && !esDelEquipoProyecto) {
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
      activa: true,
      // v9.0 (Modulo de Proyectos): aditivo -- una tarea de proyecto trae
      // proyecto_id/hito_id; una actividad suelta de "Mi trabajo" los deja
      // vacios, exactamente igual que antes (ver Proyectos.crearTarea).
      proyecto_id: data.proyecto_id || '',
      hito_id: data.hito_id || ''
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
  },

  // v7.0 Fase 3 (§5.2): el supervisor mueve una actividad de su equipo a
  // otra persona de su equipo. La nueva persona AUN no se comprometio a esa
  // fecha (RN-710) -- se reabre a "pendiente de confirmar", igual que una
  // asignacion nueva, en vez de heredar en silencio un compromiso que nadie
  // de los dos acordo.
  reasignar: function (data, contexto) {
    var actividad = buscarActividad_(data.actividad_id);
    if (!actividad) return errorValidacion_('actividad_id', 'Actividad no encontrada.');
    if (esEstadoTerminal_(actividad.estado) || actividad.estado === ACTIVIDADES_ESTADOS.EN_REVISION) {
      return errorValidacion_('actividad_id', 'Esta actividad ya esta cerrada o en revision.');
    }
    var nuevoResponsable = normalizarEmail_(data.responsable_nuevo);
    if (!nuevoResponsable) return errorValidacion_('responsable_nuevo', 'Indica a quien se reasigna.');
    if (nuevoResponsable === normalizarEmail_(actividad.responsable_email)) {
      return errorValidacion_('responsable_nuevo', 'Esa persona ya es la responsable.');
    }
    var motivo = String(data.motivo || '').trim();
    if (!motivo) return errorValidacion_('motivo', 'Indica el motivo de la reasignacion.');
    if (!puedeGestionarEquipo_(actividad, nuevoResponsable, contexto)) {
      return { _forbidden: true, message: 'No puedes reasignar esta actividad a esa persona.' };
    }
    var responsableAnterior = actividad.responsable_email;
    var ahora = new Date();
    var actualizado = reescribirActividad_(actividad.actividad_id, {
      responsable_email: nuevoResponsable,
      responsable_nombre: data.responsable_nuevo_nombre || '',
      supervisor_email: normalizarEmail_(jefeDeSubordinado_(nuevoResponsable)) || actividad.supervisor_email,
      estado: ACTIVIDADES_ESTADOS.NO_INICIADA,
      fecha_propuesta: actividad.fecha_compromiso || actividad.fecha_propuesta,
      fecha_compromiso: '',
      confirmada_en: '',
      ultima_actualizacion: ahora.toISOString()
    });
    registrarEventoActividad_(actividad.actividad_id, 'REASIGNACION', contexto,
      motivo, { responsable_anterior: responsableAnterior, responsable_nuevo: nuevoResponsable });
    return actualizado;
  },

  // v7.0 Fase 3 (§5.2): accion de un clic del supervisor -- un correo
  // inmediato (no cuelga de ningun trigger nuevo, presupuesto de triggers
  // en 0, §4.6) y una nota en la bitacora, sin tocar el estado. Es la
  // alternativa a "preguntarle" que es el problema que origino el modulo.
  // v7.0 (Fase 4, §4.6): agrupa TODAS las alertas del dia por destinatario --
  // "un solo correo diario por persona, agrupando todo" es la regla de oro
  // (aprendida de Novedades). Devuelve el calculo puro (sin enviar nada) para
  // poder probarlo sin mocks de correo; Notificaciones.enviarAlertasActividades
  // lo formatea y envia. Presupuesto de triggers en 0 (§4.6): no crea un
  // trigger propio, se cuelga del trigger diario de las 09:00 (Triggers.gs).
  calcularAlertas: function () {
    var feriados = obtenerFeriados_();
    var ahora = new Date();
    var porPersona = {};

    function bucket(email) {
      var normalizado = normalizarEmail_(email);
      if (!normalizado) return null;
      if (!porPersona[normalizado]) {
        porPersona[normalizado] = {
          sin_novedad: [], sin_confirmar: [], compromiso_proximo: [], vencidas: [], bloqueo_estancado: []
        };
      }
      return porPersona[normalizado];
    }

    leerFilasSeguro_(SHEETS.ACTIVIDADES).forEach(function (a) {
      var activa = a.activa === true || a.activa === 'TRUE' || a.activa === 1;
      if (!activa || esEstadoTerminal_(a.estado)) return;

      var pendienteConfirmar = a.fecha_propuesta && !a.confirmada_en;

      if (pendienteConfirmar) {
        // Alerta "Sin confirmar": el supervisor asigno y nadie confirmo.
        var diasAsignada = diasHabilesEntreFechas_(a.fecha_creacion, ahora, feriados);
        if (diasAsignada >= ACTIVIDADES_UMBRAL_SIN_CONFIRMAR_DIAS) {
          var bSupSinConfirmar = bucket(a.supervisor_email);
          if (bSupSinConfirmar) bSupSinConfirmar.sin_confirmar.push(a);
        }
      } else if (a.estado !== ACTIVIDADES_ESTADOS.EN_REVISION) {
        // Alerta "Sin novedad": umbral escalonado (§4.6.1) -- 2 dias habiles
        // si el compromiso esta cerca (<=5 dias habiles) o esta BLOQUEADA;
        // 5 dias habiles si esta lejos o sin fecha aun. El primer aviso es
        // solo para el colaborador (tono recordatorio); si pasa un SEGUNDO
        // ciclo del mismo largo sin novedad, se suma el supervisor.
        var diasSinActualizar = diasHabilesEntreFechas_(a.ultima_actualizacion || a.fecha_creacion, ahora, feriados);
        var compromisoCerca = a.fecha_compromiso &&
          diasHabilesEntreFechas_(ahora, a.fecha_compromiso, feriados) <= ACTIVIDADES_UMBRAL_COMPROMISO_CERCA_DIAS;
        var umbral = (a.estado === ACTIVIDADES_ESTADOS.BLOQUEADA || compromisoCerca)
          ? ACTIVIDADES_UMBRAL_SIN_NOVEDAD_CERCA_DIAS
          : ACTIVIDADES_UMBRAL_SIN_NOVEDAD_LEJOS_DIAS;
        if (diasSinActualizar >= umbral * 2) {
          var bColSegundoCiclo = bucket(a.responsable_email);
          if (bColSegundoCiclo) bColSegundoCiclo.sin_novedad.push(a);
          var bSupSegundoCiclo = bucket(a.supervisor_email);
          if (bSupSegundoCiclo) bSupSegundoCiclo.sin_novedad.push(a);
        } else if (diasSinActualizar >= umbral) {
          var bColPrimerCiclo = bucket(a.responsable_email);
          if (bColPrimerCiclo) bColPrimerCiclo.sin_novedad.push(a);
        }
      }

      if (a.fecha_compromiso && a.estado !== ACTIVIDADES_ESTADOS.TERMINADA) {
        var vencida = new Date(a.fecha_compromiso).getTime() < ahora.getTime();
        if (vencida) {
          var bVencida = bucket(a.supervisor_email);
          if (bVencida) bVencida.vencidas.push(a);
        } else {
          var diasHastaVencer = diasHabilesEntreFechas_(ahora, a.fecha_compromiso, feriados);
          if (diasHastaVencer <= ACTIVIDADES_UMBRAL_COMPROMISO_PROXIMO_DIAS && a.confianza !== 'VERDE') {
            var bProximo = bucket(a.supervisor_email);
            if (bProximo) bProximo.compromiso_proximo.push(a);
          }
        }
      }

      if (a.estado === ACTIVIDADES_ESTADOS.BLOQUEADA && a.bloqueo_desde) {
        var diasBloqueada = diasHabilesEntreFechas_(a.bloqueo_desde, ahora, feriados);
        if (diasBloqueada >= ACTIVIDADES_UMBRAL_BLOQUEO_ESTANCADO_DIAS) {
          var bSupBloqueo = bucket(a.supervisor_email);
          if (bSupBloqueo) bSupBloqueo.bloqueo_estancado.push(a);
          if (normalizarEmail_(a.bloqueo_responsable_email) &&
            normalizarEmail_(a.bloqueo_responsable_email) !== normalizarEmail_(a.supervisor_email)) {
            var bDestrabe = bucket(a.bloqueo_responsable_email);
            if (bDestrabe) bDestrabe.bloqueo_estancado.push(a);
          }
        }
      }
    });

    return porPersona;
  },

  pedirActualizacion: function (data, contexto) {
    var actividad = buscarActividad_(data.actividad_id);
    if (!actividad) return errorValidacion_('actividad_id', 'Actividad no encontrada.');
    if (esEstadoTerminal_(actividad.estado)) {
      return errorValidacion_('actividad_id', 'Esta actividad ya esta cerrada.');
    }
    if (!puedeGestionar_(actividad, contexto)) {
      return { _forbidden: true, message: 'No puedes pedir una actualizacion de esta actividad.' };
    }
    var nota = String(data.nota || '').trim();
    registrarEventoActividad_(actividad.actividad_id, 'COMENTARIO', contexto,
      'Pidio una actualizacion.' + (nota ? ' ' + nota : ''));
    var envio = { enviado: false, motivo: 'sin_responsable' };
    if (actividad.responsable_email) {
      var cuerpo = '<p>' + escaparHtmlCorreo_((contexto && contexto.nombre) || contexto.email) +
        ' pidió una actualización de tu actividad:</p>' +
        '<p style="font-weight:600">' + escaparHtmlCorreo_(actividad.titulo) + '</p>' +
        (nota ? '<p>' + escaparHtmlCorreo_(nota) + '</p>' : '') +
        '<p>Entra a "Mi trabajo" para responder -- "Sin cambios" también cuenta.</p>';
      envio = enviarCorreo_(actividad.actividad_id, actividad.responsable_email, 'PEDIR_ACTUALIZACION_ACTIVIDAD',
        'Te piden una actualización: ' + actividad.titulo,
        'Te piden una actualización de "' + actividad.titulo + '". Entra a Mi trabajo para responder.',
        1, { htmlBody: plantillaCorreoHtml_('Actualización pedida', cuerpo) });
      // v7.1 (notificaciones vivas): prueba de que el canal es transversal,
      // no exclusivo de Pausas -- mismo espejo del correo.
      encolarNotificacionApp_(actividad.responsable_email, 'PEDIR_ACTUALIZACION_ACTIVIDAD',
        'Te piden una actualización',
        'Te piden una actualización de "' + actividad.titulo + '".' + (nota ? ' ' + nota : ''),
        'mi_trabajo', 'Responder en Mi trabajo', 48);
    }
    return { actividad_id: actividad.actividad_id, enviado: envio.enviado };
  },

  // v7.0 (Fase 5, §5.3/§4.7): pestaña de Gerencia -- KPIs, mapa de calor
  // área×semana y actividades críticas transversales a todos los equipos.
  // Sin gate de rol propio: como Gerencia.getPanel, se apoya en el gate de
  // modulo 'gerencia' (Code.gs) para el camino de portal; el camino Google
  // sigue autorizado por rol de siempre.
  getPanelGerencia: function (filtros, contexto) {
    return calcularPanelGerenciaActividades_(filtros || {});
  },

  // v7.0 (Fase 5, §4.8): "3 motores + filtros comunes" -- un solo punto de
  // entrada que arma la tabla (columnas + filas + resumen) para los tres
  // tipos. El mismo resultado alimenta la vista en pantalla, el CSV
  // (armado en el cliente) y el PDF (ReporteActividades.gs).
  generarReporte: function (data, contexto) {
    var tipo = data && data.tipo;
    if (['estado_actual', 'cumplimiento_periodo', 'carga_capacidad'].indexOf(tipo) === -1) {
      return errorValidacion_('tipo', 'Tipo de reporte inválido.');
    }
    return construirReporteActividades_(tipo, data || {});
  },

  // v7.0 (Fase 5, §4.8, "extra propuesto"): la pauta de la reunion semanal
  // de seguimiento -- que vencio, que esta bloqueado, que se reprogramo
  // esta semana y que vence la semana entrante, en ese orden.
  generarActaReunion: function (filtros, contexto) {
    return construirActaReunion_(filtros || {});
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

// v7.0 Fase 3: reasignar es una decision de "gestion de equipo", no solo del
// supervisor puntual asignado -- ADM, o cualquiera que tenga tanto al
// responsable ACTUAL como al NUEVO dentro de su equipo (JEFATURAS). Evita
// que un jefe mueva trabajo hacia/desde gente que no es suya.
function puedeGestionarEquipo_(actividad, nuevoResponsableEmail, contexto) {
  if (contexto.rol === 'ADM') return true;
  var equipo = obtenerEquipoJefe_(contexto.email).map(normalizarEmail_);
  var esDeSuEquipo = function (email) { return equipo.indexOf(normalizarEmail_(email)) !== -1; };
  return esDeSuEquipo(actividad.responsable_email) && esDeSuEquipo(nuevoResponsableEmail);
}

function normalizarEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

// --- alertas (§4.6): umbrales -----------------------------------------

// Constantes de codigo, no hoja de configuracion -- mismo criterio que
// DIAS_HABILES_CIERRE_AUTOMATICO/UMBRAL_RECORDATORIO_DIAS_HABILES en
// Triggers.gs. Si algun cliente necesitara ajustarlos, se vuelven filas de
// config mas adelante (no hay pedido de eso todavia).
var ACTIVIDADES_UMBRAL_SIN_NOVEDAD_CERCA_DIAS = 2;
var ACTIVIDADES_UMBRAL_SIN_NOVEDAD_LEJOS_DIAS = 5;
var ACTIVIDADES_UMBRAL_COMPROMISO_CERCA_DIAS = 5;
var ACTIVIDADES_UMBRAL_SIN_CONFIRMAR_DIAS = 2;
var ACTIVIDADES_UMBRAL_COMPROMISO_PROXIMO_DIAS = 2;
var ACTIVIDADES_UMBRAL_BLOQUEO_ESTANCADO_DIAS = 2;

// Utils.horasHabilesEntre devuelve 0 si `hasta` es anterior o igual a
// `desde` (§10) -- por eso "vencida" (fecha_compromiso ya paso) se detecta
// aparte con una comparacion de fechas directa, no con este helper.
function diasHabilesEntreFechas_(desde, hasta, feriados) {
  if (!desde) return 0;
  return Utils.horasHabilesEntre(desde, hasta, { feriados: feriados }) / 9;
}

// --- Fase 5 (§4.7/§4.8): panel de Gerencia y motores de reporte -----------

function areasPorId_() {
  var mapa = {};
  try {
    leerFilas_(SHEETS.CAT_AREAS).forEach(function (a) { mapa[a.area_id] = a.nombre; });
  } catch (err) {
    // Instalaciones sin CAT_AREAS todavia (o hoja recien creada): sin
    // nombres, no debe tumbar el panel -- mismo criterio que
    // mapaNombresUsuarios_ (Gerencia.gs).
  }
  return mapa;
}

function actividadesActivasNoCanceladas_() {
  return leerFilasSeguro_(SHEETS.ACTIVIDADES).filter(function (a) {
    var activa = a.activa === true || a.activa === 'TRUE' || a.activa === 1;
    return activa && a.estado !== ACTIVIDADES_ESTADOS.CANCELADA;
  });
}

// Filtros comunes de Gerencia (§4.8): de los ocho documentados, se
// implementan área y prioridad -- los que responden "dónde está el
// problema" sin abrir un formulario de filtros propio. Rango de fechas
// vive aparte (resolverVentanaPeriodo_, reusado de Gerencia.gs).
function coincideFiltroGerenciaActividad_(a, filtros) {
  if (filtros.area_id && a.area_id !== filtros.area_id) return false;
  if (filtros.prioridad && a.prioridad !== filtros.prioridad) return false;
  return true;
}

function calcularPanelGerenciaActividades_(filtrosBase) {
  var nombresArea = areasPorId_();
  var todas = actividadesActivasNoCanceladas_().filter(function (a) {
    return coincideFiltroGerenciaActividad_(a, filtrosBase);
  });
  var ahora = new Date();

  // resolverVentanaPeriodo_/dentroDeRango_ (Gerencia.gs): calculo generico
  // de fechas, sin nada especifico de Solicitudes -- se reusa tal cual.
  var ventana = resolverVentanaPeriodo_(filtrosBase);
  var creadasVentana = todas.filter(function (a) { return dentroDeRango_(a.fecha_creacion, ventana.desde, ventana.hasta); });
  var creadasVentanaAnterior = todas.filter(function (a) { return dentroDeRango_(a.fecha_creacion, ventana.desdeAnterior, ventana.hastaAnterior); });

  var criticas = todas
    .filter(function (a) {
      var s = semaforoActividad_(a);
      return ['P1', 'P2'].indexOf(a.prioridad) !== -1 && ['atrasada', 'riesgo', 'bloqueada'].indexOf(s.codigo) !== -1;
    })
    .map(function (a) {
      var s = semaforoActividad_(a);
      return {
        actividad_id: a.actividad_id,
        titulo: a.titulo,
        responsable_nombre: a.responsable_nombre || a.responsable_email,
        area_nombre: nombresArea[a.area_id] || '(sin área)',
        prioridad: a.prioridad,
        semaforo: s.codigo,
        semaforo_etiqueta: s.etiqueta,
        fecha_compromiso: a.fecha_compromiso || ''
      };
    })
    .sort(function (x, y) {
      var orden = { atrasada: 0, bloqueada: 1, riesgo: 2 };
      var porSemaforo = orden[x.semaforo] - orden[y.semaforo];
      if (porSemaforo !== 0) return porSemaforo;
      return new Date(x.fecha_compromiso || 0) - new Date(y.fecha_compromiso || 0);
    });

  return {
    kpis: calcularKpisGerenciaActividades_(todas, creadasVentana, creadasVentanaAnterior, ahora),
    heatmap: calcularHeatmapActividades_(todas, nombresArea),
    criticas: criticas,
    areas: Object.keys(nombresArea).map(function (id) { return { area_id: id, nombre: nombresArea[id] }; }),
    ventana: { desde: ventana.desde.toISOString(), hasta: ventana.hasta.toISOString() }
  };
}

// §4.7: los 6 KPIs propuestos. #1 (cumplidas a tiempo), #4 (reprogramaciones)
// y #6 (% emergente) son "de periodo" (comparables contra la ventana
// anterior, mismo patron que calcularComparativoKpis_ en Gerencia.gs). #2
// (antigüedad media) y #3 (bloqueadas + tiempo de desbloqueo) son "de HOY":
// una foto del momento, sin periodo anterior comparable -- comparar
// "bloqueadas ahora" contra "bloqueadas hace 30 dias" no responde nada util.
// #5 (carga por persona, sin ranking) es la distribucion completa, no un
// numero -- la UI decide como mostrarla, aca solo se cuenta.
function calcularKpisPeriodoActividades_(creadas) {
  var terminadas = creadas.filter(function (a) {
    return a.estado === ACTIVIDADES_ESTADOS.TERMINADA && a.fecha_terminada && a.fecha_compromiso;
  });
  var aTiempo = terminadas.filter(function (a) { return new Date(a.fecha_terminada) <= new Date(a.fecha_compromiso); });
  var emergentes = creadas.filter(function (a) { return a.origen === 'EMERGENTE'; });
  return {
    pct_cumplidas_a_tiempo: terminadas.length === 0 ? null : Math.round((aTiempo.length / terminadas.length) * 1000) / 10,
    reprogramaciones_promedio: promedio_(creadas.map(function (a) { return Number(a.reprogramaciones) || 0; })),
    pct_emergente: creadas.length === 0 ? null : Math.round((emergentes.length / creadas.length) * 1000) / 10
  };
}

function calcularKpisGerenciaActividades_(todas, creadasVentana, creadasVentanaAnterior, ahora) {
  var feriados = obtenerFeriados_();
  var activasNoTerminales = todas.filter(function (a) { return !esEstadoTerminal_(a.estado); });
  var bloqueadas = todas.filter(function (a) { return a.estado === ACTIVIDADES_ESTADOS.BLOQUEADA; });

  var porPersona = {};
  todas.forEach(function (a) {
    var email = a.responsable_email || '(sin responsable)';
    porPersona[email] = (porPersona[email] || 0) + 1;
  });

  var actual = calcularKpisPeriodoActividades_(creadasVentana);
  var anterior = calcularKpisPeriodoActividades_(creadasVentanaAnterior);
  function delta_(a, b) {
    if (a === null || a === undefined || b === null || b === undefined) return null;
    return Math.round((a - b) * 10) / 10;
  }

  return {
    pct_cumplidas_a_tiempo: actual.pct_cumplidas_a_tiempo,
    antiguedad_media_dias: promedio_(activasNoTerminales.map(function (a) {
      return Utils.horasHabilesEntre(a.ultima_actualizacion || a.fecha_creacion, ahora, { feriados: feriados }) / 9;
    })),
    bloqueadas_actual: bloqueadas.length,
    bloqueo_promedio_dias: promedio_(bloqueadas.map(function (a) {
      return Utils.horasHabilesEntre(a.bloqueo_desde || a.ultima_actualizacion, ahora, { feriados: feriados }) / 9;
    })),
    reprogramaciones_promedio: actual.reprogramaciones_promedio,
    pct_emergente: actual.pct_emergente,
    carga_por_persona: Object.keys(porPersona)
      .map(function (email) { return { email: email, total: porPersona[email] }; })
      .sort(function (x, y) { return y.total - x.total; }),
    comparativo: {
      pct_cumplidas_a_tiempo: delta_(actual.pct_cumplidas_a_tiempo, anterior.pct_cumplidas_a_tiempo),
      reprogramaciones_promedio: delta_(actual.reprogramaciones_promedio, anterior.reprogramaciones_promedio),
      pct_emergente: delta_(actual.pct_emergente, anterior.pct_emergente)
    }
  };
}

// §5.3: mapa de calor área × semana -- responde "¿dónde está el problema?"
// sin leer filas. 6 semanas (lunes a domingo, UTC -- mismo criterio de
// aritmetica en UTC que correrFechaRecurrencia_, para no correr un dia
// segun el huso del servidor). % cumplimiento = TERMINADA a tiempo ÷ total
// comprometido esa semana; lo aun no resuelto pesa como "no cumplido
// todavia" en el numero de hoy (se corrige solo cuando se cierra).
function calcularHeatmapActividades_(todas, nombresArea) {
  var SEMANAS_HEATMAP = 6;
  var ahora = new Date();
  var lunesActual = inicioSemanaUTC_(ahora);

  var semanas = [];
  for (var i = SEMANAS_HEATMAP - 1; i >= 0; i--) {
    var inicio = new Date(lunesActual.getTime() - i * 7 * 24 * 3600 * 1000);
    semanas.push({ inicio: inicio, fin: new Date(inicio.getTime() + 7 * 24 * 3600 * 1000), etiqueta: etiquetaSemana_(inicio) });
  }

  var porArea = {};
  todas.forEach(function (a) {
    if (!a.fecha_compromiso) return;
    var t = new Date(a.fecha_compromiso).getTime();
    var semana = null;
    for (var j = 0; j < semanas.length; j++) {
      if (t >= semanas[j].inicio.getTime() && t < semanas[j].fin.getTime()) { semana = semanas[j]; break; }
    }
    if (!semana) return;
    var areaNombre = nombresArea[a.area_id] || '(sin área)';
    if (!porArea[areaNombre]) {
      porArea[areaNombre] = {};
      semanas.forEach(function (s) { porArea[areaNombre][s.etiqueta] = { total: 0, cumplidas: 0 }; });
    }
    var celda = porArea[areaNombre][semana.etiqueta];
    celda.total++;
    if (a.estado === ACTIVIDADES_ESTADOS.TERMINADA && a.fecha_terminada && new Date(a.fecha_terminada) <= new Date(a.fecha_compromiso)) {
      celda.cumplidas++;
    }
  });

  return Object.keys(porArea).sort().map(function (areaNombre) {
    return {
      area_nombre: areaNombre,
      semanas: semanas.map(function (s) {
        var celda = porArea[areaNombre][s.etiqueta];
        return {
          etiqueta: s.etiqueta,
          total: celda.total,
          pct_cumplimiento: celda.total === 0 ? null : Math.round((celda.cumplidas / celda.total) * 1000) / 10
        };
      })
    };
  });
}

function inicioSemanaUTC_(fecha) {
  var diaSemana = fecha.getUTCDay(); // 0 = domingo
  var offsetLunes = (diaSemana + 6) % 7;
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate() - offsetLunes));
}

function etiquetaSemana_(inicioLunes) {
  return ('0' + inicioLunes.getUTCDate()).slice(-2) + '/' + ('0' + (inicioLunes.getUTCMonth() + 1)).slice(-2);
}

// §4.8: "3 motores + filtros comunes", un solo despachador. Cada tipo
// devuelve { columnas, filas, resumen } -- misma forma para los tres, asi
// la tabla en pantalla, el CSV y el PDF (ReporteActividades.gs) comparten
// un unico contrato en vez de tres formatos distintos.
function construirReporteActividades_(tipo, filtros) {
  var nombresArea = areasPorId_();
  var ventana = resolverVentanaPeriodo_(filtros);
  var todas = actividadesActivasNoCanceladas_().filter(function (a) {
    return coincideFiltroGerenciaActividad_(a, filtros);
  });

  if (tipo === 'estado_actual') {
    var filasEstado = todas.map(function (a) {
      var s = semaforoActividad_(a);
      return {
        titulo: a.titulo,
        responsable: a.responsable_nombre || a.responsable_email,
        area: nombresArea[a.area_id] || '(sin área)',
        prioridad: a.prioridad,
        estado: a.estado,
        semaforo: s.etiqueta,
        fecha_compromiso: a.fecha_compromiso || ''
      };
    });
    return {
      tipo: tipo,
      columnas: [
        { campo: 'titulo', etiqueta: 'Actividad' },
        { campo: 'responsable', etiqueta: 'Responsable' },
        { campo: 'area', etiqueta: 'Área' },
        { campo: 'prioridad', etiqueta: 'Prioridad' },
        { campo: 'estado', etiqueta: 'Estado' },
        { campo: 'semaforo', etiqueta: 'Semáforo' },
        { campo: 'fecha_compromiso', etiqueta: 'Vence' }
      ],
      filas: filasEstado,
      resumen: { total: filasEstado.length }
    };
  }

  if (tipo === 'cumplimiento_periodo') {
    var enPeriodo = todas.filter(function (a) { return dentroDeRango_(a.fecha_compromiso, ventana.desde, ventana.hasta); });
    var ahoraCump = new Date();
    var filasCump = enPeriodo.map(function (a) {
      var cumplida = a.estado === ACTIVIDADES_ESTADOS.TERMINADA
        ? (a.fecha_terminada && new Date(a.fecha_terminada) <= new Date(a.fecha_compromiso) ? 'Sí' : 'No')
        : 'Pendiente';
      return {
        titulo: a.titulo,
        responsable: a.responsable_nombre || a.responsable_email,
        area: nombresArea[a.area_id] || '(sin área)',
        fecha_compromiso: a.fecha_compromiso || '',
        fecha_terminada: a.fecha_terminada || '',
        cumplida: cumplida,
        reprogramaciones: Number(a.reprogramaciones) || 0
      };
    });
    var terminadasConFecha = enPeriodo.filter(function (a) {
      return a.estado === ACTIVIDADES_ESTADOS.TERMINADA && a.fecha_terminada;
    });
    var aTiempoCump = terminadasConFecha.filter(function (a) { return new Date(a.fecha_terminada) <= new Date(a.fecha_compromiso); });
    var vencidasCump = enPeriodo.filter(function (a) {
      return a.estado !== ACTIVIDADES_ESTADOS.TERMINADA && new Date(a.fecha_compromiso) < ahoraCump;
    });
    return {
      tipo: tipo,
      columnas: [
        { campo: 'titulo', etiqueta: 'Actividad' },
        { campo: 'responsable', etiqueta: 'Responsable' },
        { campo: 'area', etiqueta: 'Área' },
        { campo: 'fecha_compromiso', etiqueta: 'Comprometida' },
        { campo: 'fecha_terminada', etiqueta: 'Terminada' },
        { campo: 'cumplida', etiqueta: 'Cumplida a tiempo' },
        { campo: 'reprogramaciones', etiqueta: 'Reprogramaciones' }
      ],
      filas: filasCump,
      resumen: {
        comprometidas: enPeriodo.length,
        cumplidas_a_tiempo: aTiempoCump.length,
        pct_cumplimiento: terminadasConFecha.length === 0 ? null : Math.round((aTiempoCump.length / terminadasConFecha.length) * 1000) / 10,
        vencidas: vencidasCump.length,
        reprogramaciones_promedio: promedio_(enPeriodo.map(function (a) { return Number(a.reprogramaciones) || 0; }))
      }
    };
  }

  // carga_capacidad
  var creadasEnPeriodo = todas.filter(function (a) { return dentroDeRango_(a.fecha_creacion, ventana.desde, ventana.hasta); });
  var porPersonaCarga = {};
  creadasEnPeriodo.forEach(function (a) {
    var email = a.responsable_email || '(sin responsable)';
    if (!porPersonaCarga[email]) {
      porPersonaCarga[email] = {
        nombre: a.responsable_nombre || email,
        area: nombresArea[a.area_id] || '(sin área)',
        total: 0,
        emergentes: 0
      };
    }
    porPersonaCarga[email].total++;
    if (a.origen === 'EMERGENTE') porPersonaCarga[email].emergentes++;
  });
  var filasCarga = Object.keys(porPersonaCarga).map(function (email) {
    var p = porPersonaCarga[email];
    return {
      responsable: p.nombre,
      area: p.area,
      total: p.total,
      planificadas: p.total - p.emergentes,
      emergentes: p.emergentes,
      pct_emergente: p.total === 0 ? 0 : Math.round((p.emergentes / p.total) * 1000) / 10
    };
  }).sort(function (a, b) { return b.total - a.total; });
  var totalEmergentesCarga = creadasEnPeriodo.filter(function (a) { return a.origen === 'EMERGENTE'; }).length;
  return {
    tipo: tipo,
    columnas: [
      { campo: 'responsable', etiqueta: 'Responsable' },
      { campo: 'area', etiqueta: 'Área' },
      { campo: 'total', etiqueta: 'Total' },
      { campo: 'planificadas', etiqueta: 'Planificadas' },
      { campo: 'emergentes', etiqueta: 'Emergentes' },
      { campo: 'pct_emergente', etiqueta: '% emergente' }
    ],
    filas: filasCarga,
    resumen: {
      total: creadasEnPeriodo.length,
      emergentes: totalEmergentesCarga,
      pct_emergente: creadasEnPeriodo.length === 0 ? null : Math.round((totalEmergentesCarga / creadasEnPeriodo.length) * 1000) / 10
    }
  };
}

// §4.8 ("extra propuesto"): la pauta de la reunion semanal, en el orden en
// que la propuesta la pide -- vencio / bloqueado / se reprogramo / vence la
// semana entrante. "Se reprogramo esta semana" sale de la bitacora
// (REPROGRAMACION), no de las actividades: una actividad puede haberse
// reprogramado varias veces, solo interesa si hubo un evento ESTA semana.
function construirActaReunion_(filtros) {
  var nombresArea = areasPorId_();
  var todas = actividadesActivasNoCanceladas_().filter(function (a) { return coincideFiltroGerenciaActividad_(a, filtros); });
  var ahora = new Date();
  var inicioSemana = inicioSemanaUTC_(ahora);
  var finSemana = new Date(inicioSemana.getTime() + 7 * 24 * 3600 * 1000);
  var finSemanaEntrante = new Date(finSemana.getTime() + 7 * 24 * 3600 * 1000);

  function resumenActa_(a) {
    return {
      actividad_id: a.actividad_id,
      titulo: a.titulo,
      responsable: a.responsable_nombre || a.responsable_email,
      area: nombresArea[a.area_id] || '(sin área)',
      fecha_compromiso: a.fecha_compromiso || ''
    };
  }

  var vencidas = todas
    .filter(function (a) { return a.estado !== ACTIVIDADES_ESTADOS.TERMINADA && a.fecha_compromiso && new Date(a.fecha_compromiso) < ahora; })
    .map(resumenActa_);

  var bloqueadas = todas
    .filter(function (a) { return a.estado === ACTIVIDADES_ESTADOS.BLOQUEADA; })
    .map(function (a) {
      var r = resumenActa_(a);
      r.motivo = a.bloqueo_motivo || '';
      return r;
    });

  var idsEnAlcance = {};
  todas.forEach(function (a) { idsEnAlcance[a.actividad_id] = a; });
  var vistos = {};
  var reprogramadas = [];
  leerFilasSeguro_(SHEETS.ACTIVIDADES_BITACORA).forEach(function (b) {
    if (b.tipo !== 'REPROGRAMACION') return;
    var t = new Date(b.timestamp);
    if (t < inicioSemana || t >= finSemana) return;
    if (vistos[b.actividad_id] || !idsEnAlcance[b.actividad_id]) return;
    vistos[b.actividad_id] = true;
    var r = resumenActa_(idsEnAlcance[b.actividad_id]);
    r.motivo = b.nota || '';
    reprogramadas.push(r);
  });

  var venceSemanaEntrante = todas
    .filter(function (a) {
      return a.fecha_compromiso && a.estado !== ACTIVIDADES_ESTADOS.TERMINADA &&
        new Date(a.fecha_compromiso) >= finSemana && new Date(a.fecha_compromiso) < finSemanaEntrante;
    })
    .map(resumenActa_);

  return {
    generado_en: ahora.toISOString(),
    vencidas: vencidas,
    bloqueadas: bloqueadas,
    reprogramadas_semana: reprogramadas,
    vence_semana_entrante: venceSemanaEntrante
  };
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

// v7.0 Fase 3: clasificacion de urgencia -- espejo servidor del semaforo_
// que ya vivia solo en frontend/js/actividades.js ("Mi trabajo", Fase 2).
// Se mueve aca para que "Actividades del equipo" (Fase 3) y cualquier vista
// futura (Gerencia, Fase 5) usen SIEMPRE el mismo criterio, en vez de que
// cada modulo de frontend reimplemente su propia nocion de "en riesgo".
// Calendario UTC (no dias habiles): alcanza para ordenar/filtrar una lista;
// el semaforo formal de cumplimiento (dias habiles, feriados) es de
// Solicitudes/Cumplimiento.gs y no aplica aca (§8.3 de la propuesta).
function semaforoActividad_(a) {
  if (a.estado === 'TERMINADA') return { codigo: 'terminada', etiqueta: 'Terminada' };
  if (a.estado === 'CANCELADA') return { codigo: 'cancelada', etiqueta: 'Cancelada' };
  if (a.estado === 'BLOQUEADA') return { codigo: 'bloqueada', etiqueta: 'Bloqueada' };
  if (a.estado === 'EN_REVISION') return { codigo: 'revision', etiqueta: 'En revisión' };
  if (a.fecha_propuesta && !a.confirmada_en) return { codigo: 'pendiente', etiqueta: 'Por confirmar' };
  if (!a.fecha_compromiso) return { codigo: 'al-dia', etiqueta: 'Al día' };
  var hoyUTC = Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  var f = new Date(a.fecha_compromiso);
  var venceUTC = Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate());
  var dias = Math.round((venceUTC - hoyUTC) / 86400000);
  if (dias < 0) return { codigo: 'atrasada', etiqueta: 'Atrasada' };
  if (dias <= 1) return { codigo: 'riesgo', etiqueta: dias === 0 ? 'Vence hoy' : 'Vence mañana' };
  return { codigo: 'al-dia', etiqueta: 'Al día' };
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
