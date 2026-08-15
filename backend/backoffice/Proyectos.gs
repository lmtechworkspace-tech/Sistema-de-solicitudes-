/**
 * Proyectos.gs — v9.0 MVP Fase 1.
 * documentacion/SIGSO-v9.0-propuesta-modulo-gestion-proyectos.md.
 *
 * Modulo de Gestion de Proyectos Internos. Decision central de la propuesta
 * (§0): las TAREAS de un proyecto NO son una entidad nueva -- son
 * ACTIVIDADES (Actividades.gs, motor de Gestion Operacional v7.0), extendida
 * con proyecto_id/hito_id. Este archivo es la capa contenedora + sala de
 * trabajo encima de ese motor ya probado: nunca reimplementa check-in,
 * estados, bloqueos, semaforo o reasignacion -- llama a Actividades.* tal
 * cual, con datos enriquecidos.
 *
 * Patron de permisos (igual que Actividades/Jefatura/Novedades): el modulo
 * 'proyectos' es el gate GRUESO (MODULO_POR_ACCION, Code.gs); la membresia
 * en PROYECTO_INTEGRANTES es el gate FINO (quien ve/edita que proyecto).
 * ADM y GERENCIA ven todo (GERENCIA de solo lectura, igual criterio que el
 * resto de SIGSO).
 *
 * Trazabilidad: PROYECTO_EVENTOS es la sala -- una sola tabla append-only
 * tipada, mismo espiritu que ACTIVIDADES_BITACORA (no HISTORIAL_* x N).
 */

var Proyectos = {
  // --- Portafolio ----------------------------------------------------------
  // ADM/GERENCIA ven todos los proyectos activos; el resto ve solo los
  // proyectos donde es integrante (cualquier rol_proyecto). Cada proyecto
  // sale con su salud calculada y motivos (§J de la propuesta).
  listar: function (filtros, contexto) {
    var todos = leerFilasSeguro_(SHEETS.PROYECTOS).filter(function (p) {
      return p.activa === true || p.activa === 'TRUE' || p.activa === 1;
    });
    var vePropios = contexto.rol !== 'ADM' && contexto.rol !== 'GERENCIA';
    var misProyectos = vePropios ? proyectosDelUsuario_(contexto.email) : null;

    var visibles = todos.filter(function (p) {
      return !vePropios || misProyectos.indexOf(p.proyecto_id) !== -1;
    });
    if (filtros && filtros.estado) {
      visibles = visibles.filter(function (p) { return p.estado === filtros.estado; });
    }
    if (filtros && filtros.area_id) {
      visibles = visibles.filter(function (p) { return p.area_id === filtros.area_id; });
    }

    var todasActividades = leerFilasSeguro_(SHEETS.ACTIVIDADES);
    var todosIntegrantes = leerFilasSeguro_(SHEETS.PROYECTO_INTEGRANTES);
    var todosHitos = leerFilasSeguro_(SHEETS.PROYECTO_HITOS);
    var todosEntregables = leerFilasSeguro_(SHEETS.PROYECTO_ENTREGABLES);

    return visibles.map(function (p) {
      var tareas = todasActividades.filter(function (a) { return a.proyecto_id === p.proyecto_id; });
      var hitos = todosHitos.filter(function (h) { return h.proyecto_id === p.proyecto_id; });
      var entregables = todosEntregables.filter(function (e) { return e.proyecto_id === p.proyecto_id; });
      var integrantes = todosIntegrantes.filter(function (i) {
        return i.proyecto_id === p.proyecto_id && esVerdaderoProyecto_(i.activo);
      });
      var salud = calcularSaludProyecto_(p, tareas, hitos, entregables);
      return {
        proyecto_id: p.proyecto_id,
        codigo: p.codigo,
        nombre: p.nombre,
        descripcion: p.descripcion,
        lider_email: p.lider_email,
        estado: p.estado,
        prioridad: p.prioridad,
        fecha_inicio: p.fecha_inicio,
        fecha_objetivo: p.fecha_objetivo,
        ultima_actualizacion: p.ultima_actualizacion,
        avance_pct: calcularAvanceProyecto_(tareas),
        total_integrantes: integrantes.length,
        total_tareas: tareas.filter(function (a) { return a.activa === true || a.activa === 'TRUE' || a.activa === 1; }).length,
        salud: salud.codigo,
        salud_etiqueta: salud.etiqueta,
        salud_motivos: salud.motivos
      };
    }).sort(function (a, b) {
      var orden = { critico: 0, riesgo: 1, normal: 2 };
      var porSalud = orden[a.salud] - orden[b.salud];
      if (porSalud !== 0) return porSalud;
      return new Date(b.ultima_actualizacion || 0) - new Date(a.ultima_actualizacion || 0);
    });
  },

  // --- Detalle de un proyecto (Resumen / Sala / Tareas / Hitos / Equipo) --
  getDetalle: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeVerProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
    }
    var tareas = leerFilasSeguro_(SHEETS.ACTIVIDADES).filter(function (a) { return a.proyecto_id === proyecto.proyecto_id; });
    var hitos = leerFilasSeguro_(SHEETS.PROYECTO_HITOS).filter(function (h) { return h.proyecto_id === proyecto.proyecto_id; })
      .sort(function (a, b) { return (Number(a.orden) || 0) - (Number(b.orden) || 0); });
    var integrantes = leerFilasSeguro_(SHEETS.PROYECTO_INTEGRANTES)
      .filter(function (i) { return i.proyecto_id === proyecto.proyecto_id && esVerdaderoProyecto_(i.activo); });
    // v9.4 (Fase 2/3): entregables y riesgos. No se filtran por estado --
    // igual criterio que hitos (CANCELADO/CERRADO siguen visibles con su
    // badge, nunca se ocultan datos existentes).
    var entregables = leerFilasSeguro_(SHEETS.PROYECTO_ENTREGABLES).filter(function (e) { return e.proyecto_id === proyecto.proyecto_id; });
    var riesgos = leerFilasSeguro_(SHEETS.PROYECTO_RIESGOS).filter(function (r) { return r.proyecto_id === proyecto.proyecto_id; });
    var salud = calcularSaludProyecto_(proyecto, tareas, hitos, entregables);

    return {
      proyecto: proyecto,
      rol_actual: rolEnProyecto_(proyecto.proyecto_id, contexto),
      // v9.2: capacidad de gestion resuelta en el backend (no reimplementada
      // en el frontend). Cubre al LIDER del proyecto Y al ADM (que puede
      // gestionar cualquier proyecto aunque no sea integrante) -- antes el
      // frontend solo miraba rol_actual==='LIDER', dejando al ADM sin
      // controles en proyectos ajenos. GERENCIA siempre false (solo lectura).
      puede_gestionar: puedeGestionarProyecto_(proyecto, contexto),
      integrantes: integrantes,
      hitos: hitos.map(function (h) {
        var tareasHito = tareas.filter(function (a) { return a.hito_id === h.hito_id; });
        return {
          hito_id: h.hito_id, nombre: h.nombre, descripcion: h.descripcion,
          fecha_objetivo: h.fecha_objetivo, estado: h.estado, orden: h.orden,
          total_tareas: tareasHito.length,
          avance_pct: calcularAvanceProyecto_(tareasHito)
        };
      }),
      entregables: entregables,
      riesgos: riesgos,
      avance_pct: calcularAvanceProyecto_(tareas),
      salud: salud.codigo,
      salud_etiqueta: salud.etiqueta,
      salud_motivos: salud.motivos,
      requiere_atencion: calcularRequiereAtencion_(tareas, hitos, integrantes)
    };
  },

  // --- CRUD del proyecto ---------------------------------------------------
  crear: function (data, contexto) {
    var nombre = String(data.nombre || '').trim();
    if (!nombre) return errorValidacion_('nombre', 'El nombre es obligatorio.');
    var liderEmail = normalizarEmailProyecto_(data.lider_email || contexto.email);
    if (!liderEmail) return errorValidacion_('lider_email', 'Falta el líder del proyecto.');
    if (!data.fecha_inicio) return errorValidacion_('fecha_inicio', 'La fecha de inicio es obligatoria.');
    if (!data.fecha_objetivo) return errorValidacion_('fecha_objetivo', 'La fecha objetivo es obligatoria.');

    var ahora = new Date();
    var proyecto = {
      proyecto_id: Utilities.getUuid(),
      codigo: String(data.codigo || '').trim(),
      nombre: nombre,
      descripcion: data.descripcion || '',
      objetivo: data.objetivo || '',
      resultado_esperado: data.resultado_esperado || '',
      lider_email: liderEmail,
      area_id: data.area_id || '',
      cliente_id: data.cliente_id || '',
      categoria: data.categoria || '',
      prioridad: ORDEN_PRIORIDAD.indexOf(data.prioridad) !== -1 ? data.prioridad : PRIORIDAD_POR_DEFECTO,
      estado: PROYECTOS_ESTADOS.PLANIFICACION,
      fecha_inicio: data.fecha_inicio,
      fecha_objetivo: data.fecha_objetivo,
      fecha_cierre_real: '',
      salud_override: '',
      salud_override_motivo: '',
      ultima_actualizacion: ahora.toISOString(),
      creado_por: contexto.email || '',
      fecha_creacion: ahora.toISOString(),
      activa: true
    };
    agregarFila_(SHEETS.PROYECTOS, proyecto);

    // El lider queda como integrante LIDER automaticamente (RN implicita:
    // todo proyecto tiene al menos un LIDER con acceso). Si quien crea es
    // otra persona (p.ej. ADM armando el proyecto para un tercero), tambien
    // queda como INTEGRANTE para poder seguir configurandolo.
    agregarIntegrante_(proyecto.proyecto_id, liderEmail, data.lider_nombre || '', 'LIDER', '', contexto);
    if (normalizarEmailProyecto_(contexto.email) !== liderEmail) {
      agregarIntegrante_(proyecto.proyecto_id, contexto.email, contexto.nombre || '', 'INTEGRANTE', 'Creador del proyecto', contexto);
    }
    registrarEventoProyecto_(proyecto.proyecto_id, 'ACTUALIZACION', contexto, 'Proyecto creado', '', '', '');
    return proyecto;
  },

  actualizar: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeGestionarProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'Solo el líder del proyecto o un administrador pueden editarlo.' };
    }
    var camposEditables = [
      'nombre', 'descripcion', 'objetivo', 'resultado_esperado', 'area_id',
      'cliente_id', 'categoria', 'fecha_inicio', 'fecha_objetivo', 'codigo'
    ];
    var cambios = { ultima_actualizacion: new Date().toISOString() };
    camposEditables.forEach(function (campo) {
      if (data[campo] !== undefined) cambios[campo] = data[campo];
    });
    if (data.prioridad && ORDEN_PRIORIDAD.indexOf(data.prioridad) !== -1) cambios.prioridad = data.prioridad;

    var notaEstado = '';
    if (data.estado && data.estado !== proyecto.estado) {
      if (Object.keys(PROYECTOS_ESTADOS).indexOf(data.estado) === -1) {
        return errorValidacion_('estado', 'Estado de proyecto inválido.');
      }
      // Cerrar es un PROCESO, no un toggle (§30 de la propuesta): exige un
      // motivo/resumen de cierre, igual que cancelar una actividad exige
      // motivo. El detalle rico del checklist de cierre queda para Fase 3;
      // por ahora se deja trazado en la sala.
      if (data.estado === PROYECTOS_ESTADOS.CERRADO) {
        if (!String(data.motivo || '').trim()) {
          return errorValidacion_('motivo', 'Cerrar un proyecto exige un resumen de cierre.');
        }
        cambios.fecha_cierre_real = new Date().toISOString();
      }
      cambios.estado = data.estado;
      notaEstado = 'Estado: ' + proyecto.estado + ' → ' + data.estado + (data.motivo ? '. ' + data.motivo : '');
    }

    if (data.salud_override !== undefined) {
      // Correccion manual excepcional (§J): exige motivo, queda en la sala.
      if (data.salud_override && !String(data.motivo_salud || '').trim()) {
        return errorValidacion_('motivo_salud', 'Fijar la salud manualmente exige un motivo.');
      }
      cambios.salud_override = data.salud_override || '';
      cambios.salud_override_motivo = data.salud_override ? data.motivo_salud : '';
    }

    var actualizado = actualizarFilaPorId_(SHEETS.PROYECTOS, 'proyecto_id', proyecto.proyecto_id, cambios);
    if (notaEstado) registrarEventoProyecto_(proyecto.proyecto_id, 'CAMBIO_ESTADO', contexto, notaEstado, '', '', '');
    return actualizado;
  },

  // --- Equipo ---------------------------------------------------------------
  gestionarIntegrante: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeGestionarProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'Solo el líder del proyecto o un administrador pueden gestionar el equipo.' };
    }
    if (data.accion === 'quitar') {
      if (!data.integrante_id) return errorValidacion_('integrante_id', 'Falta indicar el integrante.');
      var fila = buscarIntegranteProyecto_(data.integrante_id);
      if (fila && fila.rol_proyecto === 'LIDER') {
        var lideresActivos = leerFilasSeguro_(SHEETS.PROYECTO_INTEGRANTES).filter(function (i) {
          return i.proyecto_id === proyecto.proyecto_id && i.rol_proyecto === 'LIDER' && esVerdaderoProyecto_(i.activo);
        });
        if (lideresActivos.length <= 1) {
          return errorValidacion_('integrante_id', 'El proyecto necesita al menos un líder.');
        }
      }
      var quitado = actualizarFilaPorId_(SHEETS.PROYECTO_INTEGRANTES, 'integrante_id', data.integrante_id, { activo: false });
      registrarEventoProyecto_(proyecto.proyecto_id, 'ACTUALIZACION', contexto,
        'Se quitó del equipo a ' + (fila ? (fila.usuario_nombre || fila.usuario_email) : ''), '', '', '');
      return quitado;
    }
    var email = normalizarEmailProyecto_(data.usuario_email);
    if (!email) return errorValidacion_('usuario_email', 'Falta el correo del integrante.');
    var rol = ['LIDER', 'INTEGRANTE', 'COLABORADOR', 'OBSERVADOR'].indexOf(data.rol_proyecto) !== -1
      ? data.rol_proyecto : 'INTEGRANTE';
    var existente = leerFilasSeguro_(SHEETS.PROYECTO_INTEGRANTES).filter(function (i) {
      return i.proyecto_id === proyecto.proyecto_id && normalizarEmailProyecto_(i.usuario_email) === email;
    })[0];
    if (existente) {
      var reactivado = actualizarFilaPorId_(SHEETS.PROYECTO_INTEGRANTES, 'integrante_id', existente.integrante_id, {
        rol_proyecto: rol, responsabilidad: data.responsabilidad || existente.responsabilidad || '', activo: true
      });
      registrarEventoProyecto_(proyecto.proyecto_id, 'ACTUALIZACION', contexto,
        (data.usuario_nombre || email) + ' se une al equipo como ' + rol, '', '', '');
      return reactivado;
    }
    var nuevo = agregarIntegrante_(proyecto.proyecto_id, email, data.usuario_nombre || '', rol, data.responsabilidad || '', contexto);
    registrarEventoProyecto_(proyecto.proyecto_id, 'ACTUALIZACION', contexto,
      (data.usuario_nombre || email) + ' se une al equipo como ' + rol, '', '', '');
    encolarNotificacionApp_(email, 'PROYECTO_INTEGRANTE', 'Te agregaron a un proyecto',
      'Ahora participas en "' + proyecto.nombre + '" como ' + rol + '.', 'proyectos', 'Ver proyecto', 72);
    return nuevo;
  },

  // --- Hitos ------------------------------------------------------------
  gestionarHito: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeGestionarProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'Solo el líder del proyecto o un administrador pueden gestionar hitos.' };
    }
    if (data.accion === 'eliminar') {
      if (!data.hito_id) return errorValidacion_('hito_id', 'Falta indicar el hito.');
      var tareasDelHito = leerFilasSeguro_(SHEETS.ACTIVIDADES).filter(function (a) { return a.hito_id === data.hito_id; });
      if (tareasDelHito.length > 0) {
        return errorValidacion_('hito_id', 'Este hito tiene tareas asociadas; muévelas antes de eliminarlo.');
      }
      return eliminarFilaHito_(data.hito_id);
    }
    if (data.hito_id) {
      var cambios = { fecha_creacion: undefined };
      ['nombre', 'descripcion', 'fecha_objetivo', 'estado', 'orden'].forEach(function (campo) {
        if (data[campo] !== undefined) cambios[campo] = data[campo];
      });
      delete cambios.fecha_creacion;
      return actualizarFilaPorId_(SHEETS.PROYECTO_HITOS, 'hito_id', data.hito_id, cambios);
    }
    var nombre = String(data.nombre || '').trim();
    if (!nombre) return errorValidacion_('nombre', 'El nombre del hito es obligatorio.');
    var totalHitos = leerFilasSeguro_(SHEETS.PROYECTO_HITOS).filter(function (h) { return h.proyecto_id === proyecto.proyecto_id; }).length;
    var hito = {
      hito_id: Utilities.getUuid(),
      proyecto_id: proyecto.proyecto_id,
      nombre: nombre,
      descripcion: data.descripcion || '',
      fecha_objetivo: data.fecha_objetivo || '',
      estado: 'PENDIENTE',
      orden: data.orden !== undefined ? data.orden : totalHitos,
      fecha_creacion: new Date().toISOString()
    };
    agregarFila_(SHEETS.PROYECTO_HITOS, hito);
    return hito;
  },

  // --- Tareas: wrapper delgado sobre Actividades.gs (la decision central) --
  // No reimplementa NADA del motor: enriquece los datos (proyecto_id,
  // hito_id, area del proyecto, supervisor = lider del proyecto salvo que
  // se indique otro) y delega en Actividades.crear. El resto del ciclo de
  // vida de la tarea (check-in, bloqueo, validacion, reasignar...) sigue
  // usando las acciones de Actividades.gs que YA EXISTEN, sin pasar por aca.
  crearTarea: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    var rol = rolEnProyecto_(proyecto.proyecto_id, contexto);
    if (!(contexto.rol === 'ADM' || rol === 'LIDER' || rol === 'INTEGRANTE' || rol === 'COLABORADOR')) {
      return { _forbidden: true, message: 'No puedes crear tareas en este proyecto.' };
    }
    if (data.hito_id) {
      var hito = leerFilasSeguro_(SHEETS.PROYECTO_HITOS).filter(function (h) { return h.hito_id === data.hito_id; })[0];
      if (!hito || hito.proyecto_id !== proyecto.proyecto_id) {
        return errorValidacion_('hito_id', 'El hito no pertenece a este proyecto.');
      }
    }
    // v9.4 (Fase 2): dependencia opcional, solo dentro del mismo proyecto.
    // Es informativa (§I: "nada mueve fechas ni cierra cosas solo") --
    // listarTareas la usa para marcar "potencialmente comprometida" cuando
    // la tarea de la que se depende esta atrasada.
    if (data.depende_de) {
      var dependencia = leerFilasSeguro_(SHEETS.ACTIVIDADES).filter(function (a) { return a.actividad_id === data.depende_de; })[0];
      if (!dependencia || dependencia.proyecto_id !== proyecto.proyecto_id) {
        return errorValidacion_('depende_de', 'La tarea de la que depende debe ser del mismo proyecto.');
      }
    }
    var enriquecido = {};
    for (var k in data) enriquecido[k] = data[k];
    enriquecido.proyecto = proyecto.nombre; // compat: campo de texto libre ya existente en ACTIVIDADES
    enriquecido.proyecto_id = proyecto.proyecto_id;
    enriquecido.hito_id = data.hito_id || '';
    if (!enriquecido.area_id) enriquecido.area_id = proyecto.area_id;
    // El lider del proyecto es el supervisor por defecto de sus tareas --
    // asi puedeGestionar_/puedeSupervisar_ (Actividades.gs) le dan control
    // sobre la tarea SIN tener que estar en JEFATURAS como jefe formal del
    // responsable. Integracion limpia: cero cambios a los permisos de
    // Actividades.gs.
    if (!enriquecido.supervisor_email) enriquecido.supervisor_email = proyecto.lider_email;
    var tarea = Actividades.crear(enriquecido, contexto);
    if (tarea && (tarea._validationError || tarea._forbidden)) return tarea;
    registrarEventoProyecto_(proyecto.proyecto_id, 'ACTUALIZACION', contexto,
      'Nueva tarea: ' + tarea.titulo, 'ACTIVIDAD', tarea.actividad_id, '');
    return tarea;
  },

  // Lectura de las tareas del proyecto -- bypassa el alcance por JEFATURAS
  // de Actividades.listar() a proposito (mismo criterio que
  // Gerencia.getPanelGerenciaActividades: una vista transversal usa su
  // PROPIO gate, la membresia del proyecto, no el de "Mi trabajo").
  listarTareas: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeVerProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
    }
    var tareas = leerFilasSeguro_(SHEETS.ACTIVIDADES)
      .filter(function (a) {
        var activa = a.activa === true || a.activa === 'TRUE' || a.activa === 1;
        return activa && a.proyecto_id === proyecto.proyecto_id;
      });
    var porId = {};
    tareas.forEach(function (a) { porId[a.actividad_id] = a; });
    return tareas.map(function (a) {
      a.semaforo = semaforoActividad_(a).codigo;
      a.semaforo_etiqueta = semaforoActividad_(a).etiqueta;
      // v9.4: bandera derivada, no persistida -- se recalcula cada vez que
      // se lee (§I: "nada mueve fechas ni cierra cosas solo").
      if (a.depende_de) {
        var dependencia = porId[a.depende_de];
        a.dependencia_titulo = dependencia ? dependencia.titulo : '';
        a.dependencia_comprometida = !!dependencia && semaforoActividad_(dependencia).codigo === 'atrasada';
      }
      return a;
    });
  },

  // --- La sala --------------------------------------------------------------
  listarSala: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeVerProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
    }
    return leerFilasSeguro_(SHEETS.PROYECTO_EVENTOS)
      .filter(function (e) { return e.proyecto_id === proyecto.proyecto_id; })
      .sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
  },

  // Publicar en la sala: actualizacion, comentario, decision, reunion,
  // bloqueo o solicitud del lider -- todo es un PROYECTO_EVENTOS, solo
  // cambia el 'tipo' (§7 de la propuesta). Observadores no publican.
  publicarEnSala: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    var rol = rolEnProyecto_(proyecto.proyecto_id, contexto);
    if (!(contexto.rol === 'ADM' || (rol && rol !== 'OBSERVADOR'))) {
      return { _forbidden: true, message: 'No puedes publicar en este proyecto.' };
    }
    var tipo = ['ACTUALIZACION', 'COMENTARIO', 'DECISION', 'REUNION', 'BLOQUEO', 'SOLICITUD_LIDER']
      .indexOf(data.tipo) !== -1 ? data.tipo : 'COMENTARIO';
    if (tipo === 'SOLICITUD_LIDER' && rol !== 'LIDER' && contexto.rol !== 'ADM') {
      return { _forbidden: true, message: 'Solo el líder puede publicar una solicitud.' };
    }
    var cuerpo = String(data.cuerpo || '').trim();
    if (!cuerpo) return errorValidacion_('cuerpo', 'Escribe algo antes de publicar.');

    var evento = registrarEventoProyecto_(proyecto.proyecto_id, tipo, contexto,
      data.titulo || '', data.ref_tipo || '', data.ref_id || '', cuerpo, data.menciones);
    notificarSala_(proyecto, evento, contexto);
    return evento;
  },

  // Convierte un evento de la sala (tipicamente un COMENTARIO) en una tarea
  // real -- reusa crearTarea (que a su vez reusa Actividades.crear).
  // Ejemplo del §7 de la propuesta: "Necesitamos corregir el documento" →
  // tarea "Revisar documento", responsable Juan, fecha 15/08.
  convertirEventoEnTarea: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!data.titulo) return errorValidacion_('titulo', 'Falta el título de la tarea.');
    var tarea = Proyectos.crearTarea({
      proyecto_id: proyecto.proyecto_id,
      hito_id: data.hito_id || '',
      titulo: data.titulo,
      descripcion: data.descripcion || '',
      responsable_email: data.responsable_email,
      responsable_nombre: data.responsable_nombre || '',
      fecha_compromiso: data.fecha_compromiso,
      prioridad: data.prioridad,
      origen: 'SOLICITUD'
    }, contexto);
    if (tarea && (tarea._validationError || tarea._forbidden)) return tarea;
    if (data.evento_id) {
      actualizarFilaPorId_(SHEETS.PROYECTO_EVENTOS, 'evento_id', data.evento_id, {
        ref_tipo: 'ACTIVIDAD', ref_id: tarea.actividad_id
      });
    }
    return tarea;
  },

  // --- Entregables (Fase 2 de la propuesta): flujo aprobar/observar -------
  // Quien puede crear/editar/marcar-entregado: LIDER/INTEGRANTE/COLABORADOR
  // del proyecto o ADM (mismo circulo que crea tareas). Revisar (aprobar u
  // observar) es exclusivo del LIDER/ADM -- ver revisarEntregable.
  gestionarEntregable: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    var rol = rolEnProyecto_(proyecto.proyecto_id, contexto);
    var puedeGestionar = contexto.rol === 'ADM' || rol === 'LIDER' || rol === 'INTEGRANTE' || rol === 'COLABORADOR';
    if (!puedeGestionar) return { _forbidden: true, message: 'No puedes gestionar entregables en este proyecto.' };

    if (data.accion === 'eliminar') {
      if (!data.entregable_id) return errorValidacion_('entregable_id', 'Falta indicar el entregable.');
      var paraEliminar = buscarEntregable_(data.entregable_id);
      if (paraEliminar && paraEliminar.estado !== 'PENDIENTE') {
        return errorValidacion_('entregable_id', 'Solo se puede eliminar un entregable que aun no se ha marcado como entregado.');
      }
      return actualizarFilaPorId_(SHEETS.PROYECTO_ENTREGABLES, 'entregable_id', data.entregable_id, { estado: 'CANCELADO' });
    }

    if (data.accion === 'marcarEntregado') {
      if (!data.entregable_id) return errorValidacion_('entregable_id', 'Falta indicar el entregable.');
      var entregable = buscarEntregable_(data.entregable_id);
      if (!entregable || entregable.proyecto_id !== proyecto.proyecto_id) {
        return errorValidacion_('entregable_id', 'Entregable no encontrado.');
      }
      // Solo el responsable (o LIDER/ADM en su lugar) marca la entrega --
      // evita que cualquier integrante cierre el compromiso de otro.
      var esResponsable = normalizarEmailProyecto_(entregable.responsable_email) === normalizarEmailProyecto_(contexto.email);
      if (!esResponsable && contexto.rol !== 'ADM' && rol !== 'LIDER') {
        return { _forbidden: true, message: 'Solo el responsable del entregable puede marcarlo como entregado.' };
      }
      var marcado = actualizarFilaPorId_(SHEETS.PROYECTO_ENTREGABLES, 'entregable_id', data.entregable_id, {
        estado: 'ENTREGADO',
        url_evidencia: data.url_evidencia || entregable.url_evidencia || '',
        fecha_entrega_real: new Date().toISOString()
      });
      registrarEventoProyecto_(proyecto.proyecto_id, 'ENTREGABLE', contexto,
        'Entregable "' + entregable.nombre + '" listo para revisión', 'ENTREGABLE', data.entregable_id, '');
      notificarLideresProyecto_(proyecto, contexto, 'Entregable listo para revisar',
        entregable.nombre + ' está listo para tu revisión.');
      return marcado;
    }

    if (data.entregable_id) {
      var cambios = {};
      ['nombre', 'descripcion', 'hito_id', 'responsable_email', 'fecha_comprometida'].forEach(function (campo) {
        if (data[campo] !== undefined) cambios[campo] = data[campo];
      });
      return actualizarFilaPorId_(SHEETS.PROYECTO_ENTREGABLES, 'entregable_id', data.entregable_id, cambios);
    }

    var nombre = String(data.nombre || '').trim();
    if (!nombre) return errorValidacion_('nombre', 'El nombre del entregable es obligatorio.');
    var responsable = normalizarEmailProyecto_(data.responsable_email);
    if (!responsable) return errorValidacion_('responsable_email', 'Falta el responsable del entregable.');
    if (!data.fecha_comprometida) return errorValidacion_('fecha_comprometida', 'La fecha comprometida es obligatoria.');
    var nuevo = {
      entregable_id: Utilities.getUuid(),
      proyecto_id: proyecto.proyecto_id,
      hito_id: data.hito_id || '',
      nombre: nombre,
      descripcion: data.descripcion || '',
      responsable_email: responsable,
      fecha_comprometida: data.fecha_comprometida,
      estado: 'PENDIENTE',
      url_evidencia: '',
      fecha_entrega_real: '',
      revisado_por: '',
      resultado_revision: '',
      observaciones: '',
      fecha_creacion: new Date().toISOString()
    };
    agregarFila_(SHEETS.PROYECTO_ENTREGABLES, nuevo);
    registrarEventoProyecto_(proyecto.proyecto_id, 'ENTREGABLE', contexto, 'Nuevo entregable: ' + nombre, 'ENTREGABLE', nuevo.entregable_id, '');
    return nuevo;
  },

  // Aprobar u observar (devolver con motivo) un entregable ya marcado como
  // ENTREGADO -- exclusivo del LIDER/ADM, mismo criterio que puedeGestionarProyecto_.
  // Un entregable OBSERVADO no tiene estado terminal propio: el responsable
  // puede volver a marcarEntregado tras corregir (mismo espiritu que
  // "devolver con motivo" en el resto de SIGSO).
  revisarEntregable: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeGestionarProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'Solo el líder del proyecto o un administrador pueden revisar entregables.' };
    }
    var entregable = buscarEntregable_(data.entregable_id);
    if (!entregable || entregable.proyecto_id !== proyecto.proyecto_id) {
      return errorValidacion_('entregable_id', 'Entregable no encontrado.');
    }
    if (entregable.estado !== 'ENTREGADO') {
      return errorValidacion_('entregable_id', 'Solo se puede revisar un entregable que ya fue marcado como entregado.');
    }
    var resultado = data.resultado === 'OBSERVADO' ? 'OBSERVADO' : 'APROBADO';
    if (resultado === 'OBSERVADO' && !String(data.observaciones || '').trim()) {
      return errorValidacion_('observaciones', 'Observar un entregable exige indicar el motivo.');
    }
    var revisado = actualizarFilaPorId_(SHEETS.PROYECTO_ENTREGABLES, 'entregable_id', data.entregable_id, {
      estado: resultado, revisado_por: contexto.email || '', resultado_revision: resultado,
      observaciones: data.observaciones || ''
    });
    registrarEventoProyecto_(proyecto.proyecto_id, 'ENTREGABLE', contexto,
      'Entregable "' + entregable.nombre + '": ' + (resultado === 'APROBADO' ? 'aprobado' : 'observado') +
        (data.observaciones ? '. ' + data.observaciones : ''), 'ENTREGABLE', data.entregable_id, '');
    encolarNotificacionApp_(entregable.responsable_email,
      'PROYECTO_ENTREGABLE', resultado === 'APROBADO' ? 'Entregable aprobado' : 'Entregable observado',
      entregable.nombre + (data.observaciones ? ': ' + data.observaciones : ''), 'proyectos', 'Ver proyecto', 72);
    return revisado;
  },

  // --- Riesgos (Fase 3 de la propuesta) -------------------------------------
  // nivel se DERIVA de probabilidad x impacto (calcularNivelRiesgo_) -- nunca
  // se pide a mano, para que no quede desalineado del cruce real.
  gestionarRiesgo: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    var rol = rolEnProyecto_(proyecto.proyecto_id, contexto);
    var puedeGestionar = contexto.rol === 'ADM' || rol === 'LIDER' || rol === 'INTEGRANTE' || rol === 'COLABORADOR';
    if (!puedeGestionar) return { _forbidden: true, message: 'No puedes gestionar riesgos en este proyecto.' };

    if (data.accion === 'eliminar') {
      if (!data.riesgo_id) return errorValidacion_('riesgo_id', 'Falta indicar el riesgo.');
      return actualizarFilaPorId_(SHEETS.PROYECTO_RIESGOS, 'riesgo_id', data.riesgo_id, { estado: 'CERRADO' });
    }
    if (data.riesgo_id) {
      var actual = buscarRiesgo_(data.riesgo_id);
      if (!actual) return errorValidacion_('riesgo_id', 'Riesgo no encontrado.');
      var cambios = {};
      ['descripcion', 'responsable_email', 'mitigacion', 'estado'].forEach(function (campo) {
        if (data[campo] !== undefined) cambios[campo] = data[campo];
      });
      if (data.probabilidad !== undefined) cambios.probabilidad = data.probabilidad;
      if (data.impacto !== undefined) cambios.impacto = data.impacto;
      if (data.probabilidad !== undefined || data.impacto !== undefined) {
        cambios.nivel = calcularNivelRiesgo_(cambios.probabilidad || actual.probabilidad, cambios.impacto || actual.impacto);
      }
      return actualizarFilaPorId_(SHEETS.PROYECTO_RIESGOS, 'riesgo_id', data.riesgo_id, cambios);
    }

    var descripcion = String(data.descripcion || '').trim();
    if (!descripcion) return errorValidacion_('descripcion', 'La descripción del riesgo es obligatoria.');
    var probabilidad = ['BAJA', 'MEDIA', 'ALTA'].indexOf(data.probabilidad) !== -1 ? data.probabilidad : 'MEDIA';
    var impacto = ['BAJA', 'MEDIA', 'ALTA'].indexOf(data.impacto) !== -1 ? data.impacto : 'MEDIA';
    var riesgo = {
      riesgo_id: Utilities.getUuid(),
      proyecto_id: proyecto.proyecto_id,
      descripcion: descripcion,
      probabilidad: probabilidad,
      impacto: impacto,
      nivel: calcularNivelRiesgo_(probabilidad, impacto),
      responsable_email: normalizarEmailProyecto_(data.responsable_email) || proyecto.lider_email,
      mitigacion: data.mitigacion || '',
      estado: 'ABIERTO',
      fecha_creacion: new Date().toISOString()
    };
    agregarFila_(SHEETS.PROYECTO_RIESGOS, riesgo);
    registrarEventoProyecto_(proyecto.proyecto_id, 'RIESGO', contexto,
      'Riesgo registrado (' + riesgo.nivel + '): ' + descripcion, 'RIESGO', riesgo.riesgo_id, '');
    return riesgo;
  },

  // --- Resumen ejecutivo del portafolio (Fase 3) ----------------------------
  // Reusa Proyectos.listar (misma visibilidad: ADM/GERENCIA ven todo, el
  // resto solo sus proyectos) -- cero logica de permisos nueva. Carga por
  // persona pondera por tamano (S/M/L/XL, ya existe en ACTIVIDADES): "muchos
  // L/XL" es sobrecarga real, un conteo plano no lo distingue (§L.3).
  getResumenPortafolio: function (contexto) {
    var proyectos = Proyectos.listar({}, contexto);
    var activos = proyectos.filter(function (p) { return p.estado !== 'CERRADO' && p.estado !== 'CANCELADO'; });
    var porSalud = { normal: 0, riesgo: 0, critico: 0 };
    activos.forEach(function (p) { porSalud[p.salud] = (porSalud[p.salud] || 0) + 1; });

    var ahora = new Date();
    var proximosACerrar = activos.filter(function (p) {
      if (!p.fecha_objetivo) return false;
      var dias = (new Date(p.fecha_objetivo) - ahora) / 86400000;
      return dias >= 0 && dias <= 14;
    });
    var sinActualizacionReciente = activos.filter(function (p) {
      if (!p.ultima_actualizacion) return false;
      return (ahora - new Date(p.ultima_actualizacion)) / 86400000 >= 7;
    });

    // Carga: solo tareas activas y no terminales de proyectos VISIBLES y
    // ACTIVOS (cerrados/cancelados no representan trabajo vigente).
    var idsActivos = {};
    activos.forEach(function (p) { idsActivos[p.proyecto_id] = true; });
    var pesoTamano = { S: 1, M: 2, L: 3, XL: 5 };
    var cargaPorPersona = {};
    leerFilasSeguro_(SHEETS.ACTIVIDADES).forEach(function (a) {
      var activa = a.activa === true || a.activa === 'TRUE' || a.activa === 1;
      if (!activa || !a.proyecto_id || !idsActivos[a.proyecto_id] || esEstadoTerminal_(a.estado)) return;
      var email = a.responsable_email || '(sin responsable)';
      if (!cargaPorPersona[email]) {
        cargaPorPersona[email] = { email: email, nombre: a.responsable_nombre || email, total_tareas: 0, carga_ponderada: 0 };
      }
      cargaPorPersona[email].total_tareas += 1;
      cargaPorPersona[email].carga_ponderada += pesoTamano[a.tamano] || 2;
    });

    return {
      total_proyectos: activos.length,
      por_salud: porSalud,
      proximos_a_cerrar: proximosACerrar.length,
      sin_actualizacion_reciente: sinActualizacionReciente.length,
      carga_por_persona: Object.keys(cargaPorPersona).map(function (email) { return cargaPorPersona[email]; })
        .sort(function (x, y) { return y.carga_ponderada - x.carga_ponderada; })
    };
  }
};

// --- estados y prioridades ---------------------------------------------

var PROYECTOS_ESTADOS = {
  PLANIFICACION: 'PLANIFICACION',
  ACTIVO: 'ACTIVO',
  EN_PAUSA: 'EN_PAUSA',
  EN_REVISION: 'EN_REVISION',
  CERRADO: 'CERRADO',
  CANCELADO: 'CANCELADO'
};

// --- permisos (gate fino: membresia en PROYECTO_INTEGRANTES) -----------

function normalizarEmailProyecto_(email) {
  return String(email || '').trim().toLowerCase();
}

function esVerdaderoProyecto_(valor) {
  return valor === true || valor === 'TRUE' || valor === 1;
}

function proyectosDelUsuario_(email) {
  var normalizado = normalizarEmailProyecto_(email);
  return leerFilasSeguro_(SHEETS.PROYECTO_INTEGRANTES)
    .filter(function (i) { return normalizarEmailProyecto_(i.usuario_email) === normalizado && esVerdaderoProyecto_(i.activo); })
    .map(function (i) { return i.proyecto_id; });
}

function rolEnProyecto_(proyectoId, contexto) {
  var email = normalizarEmailProyecto_(contexto && contexto.email);
  var fila = leerFilasSeguro_(SHEETS.PROYECTO_INTEGRANTES).filter(function (i) {
    return i.proyecto_id === proyectoId && normalizarEmailProyecto_(i.usuario_email) === email && esVerdaderoProyecto_(i.activo);
  })[0];
  return fila ? fila.rol_proyecto : '';
}

// Lectura: ADM/GERENCIA ven todo (GERENCIA de solo lectura); el resto solo
// si es integrante (cualquier rol, incluido OBSERVADOR).
function puedeVerProyecto_(proyecto, contexto) {
  if (!contexto) return false;
  if (contexto.rol === 'ADM' || contexto.rol === 'GERENCIA') return true;
  return !!rolEnProyecto_(proyecto.proyecto_id, contexto);
}

// Gestion (editar proyecto, equipo, hitos): LIDER del proyecto o ADM.
function puedeGestionarProyecto_(proyecto, contexto) {
  if (!contexto) return false;
  if (contexto.rol === 'ADM') return true;
  if (contexto.rol === 'GERENCIA') return false; // solo lectura, siempre.
  return rolEnProyecto_(proyecto.proyecto_id, contexto) === 'LIDER';
}

// --- helpers internos ----------------------------------------------------

function buscarProyecto_(proyectoId) {
  if (!proyectoId) return null;
  var filas = leerFilasSeguro_(SHEETS.PROYECTOS);
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].proyecto_id === proyectoId) return filas[i];
  }
  return null;
}

function buscarIntegranteProyecto_(integranteId) {
  var filas = leerFilasSeguro_(SHEETS.PROYECTO_INTEGRANTES);
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].integrante_id === integranteId) return filas[i];
  }
  return null;
}

function agregarIntegrante_(proyectoId, email, nombre, rolProyecto, responsabilidad, contexto) {
  var integrante = {
    integrante_id: Utilities.getUuid(),
    proyecto_id: proyectoId,
    usuario_email: normalizarEmailProyecto_(email),
    usuario_nombre: nombre || '',
    rol_proyecto: rolProyecto,
    responsabilidad: responsabilidad || '',
    activo: true,
    agregado_por: (contexto && contexto.email) || '',
    fecha_creacion: new Date().toISOString()
  };
  agregarFila_(SHEETS.PROYECTO_INTEGRANTES, integrante);
  return integrante;
}

function buscarEntregable_(entregableId) {
  if (!entregableId) return null;
  var filas = leerFilasSeguro_(SHEETS.PROYECTO_ENTREGABLES);
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].entregable_id === entregableId) return filas[i];
  }
  return null;
}

function buscarRiesgo_(riesgoId) {
  if (!riesgoId) return null;
  var filas = leerFilasSeguro_(SHEETS.PROYECTO_RIESGOS);
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].riesgo_id === riesgoId) return filas[i];
  }
  return null;
}

// Matriz de riesgo 3x3 simple (BAJA/MEDIA/ALTA x BAJA/MEDIA/ALTA). El
// producto de pesos evita que "probabilidad alta + impacto bajo" y
// "probabilidad baja + impacto alto" queden en niveles distintos sin razon.
function calcularNivelRiesgo_(probabilidad, impacto) {
  var peso = { BAJA: 1, MEDIA: 2, ALTA: 3 };
  var score = (peso[probabilidad] || 2) * (peso[impacto] || 2);
  if (score >= 6) return 'ALTA';
  if (score >= 3) return 'MEDIA';
  return 'BAJA';
}

// Notifica a los LIDER(es) activos del proyecto, salvo quien dispara la
// accion (mismo criterio que notificarSala_ para SOLICITUD_LIDER).
function notificarLideresProyecto_(proyecto, contexto, titulo, mensaje) {
  leerFilasSeguro_(SHEETS.PROYECTO_INTEGRANTES).forEach(function (i) {
    if (i.proyecto_id === proyecto.proyecto_id && i.rol_proyecto === 'LIDER' && esVerdaderoProyecto_(i.activo) &&
      normalizarEmailProyecto_(i.usuario_email) !== normalizarEmailProyecto_(contexto.email)) {
      encolarNotificacionApp_(i.usuario_email, 'PROYECTO_ENTREGABLE', titulo, mensaje, 'proyectos', 'Ver proyecto', 72);
    }
  });
}

function eliminarFilaHito_(hitoId) {
  // No hay borrado fisico estandar en SheetsRepo (solo actualizarFilaPorId_/
  // agregarFila_) -- se marca el estado como CANCELADO, mismo criterio que
  // "activa=false" en el resto de SIGSO (nunca se borra una fila).
  return actualizarFilaPorId_(SHEETS.PROYECTO_HITOS, 'hito_id', hitoId, { estado: 'CANCELADO' });
}

function registrarEventoProyecto_(proyectoId, tipo, contexto, cuerpoOTitulo, refTipo, refId, cuerpo, menciones) {
  // Firma flexible: registrarEventoProyecto_(id, tipo, contexto, titulo, ref_tipo, ref_id, cuerpo, menciones)
  var evento = {
    evento_id: Utilities.getUuid(),
    proyecto_id: proyectoId,
    tipo: tipo,
    autor_email: (contexto && contexto.email) || '',
    autor_nombre: (contexto && contexto.nombre) || '',
    titulo: cuerpoOTitulo || '',
    cuerpo: cuerpo || '',
    ref_tipo: refTipo || '',
    ref_id: refId || '',
    menciones: menciones ? (Array.isArray(menciones) ? menciones.join(',') : menciones) : '',
    timestamp: new Date().toISOString()
  };
  agregarFila_(SHEETS.PROYECTO_EVENTOS, evento);
  actualizarFilaPorId_(SHEETS.PROYECTOS, 'proyecto_id', proyectoId, { ultima_actualizacion: evento.timestamp });
  return evento;
}

// Notifica a los mencionados (@correo) y, si es SOLICITUD_LIDER, a todo el
// equipo activo salvo el autor. Notificacion viva + correo (agrupado por el
// canal existente), nunca un canal nuevo.
function notificarSala_(proyecto, evento, contexto) {
  var destinatarios = {};
  (evento.menciones || '').split(',').forEach(function (email) {
    var normalizado = normalizarEmailProyecto_(email);
    if (normalizado) destinatarios[normalizado] = true;
  });
  if (evento.tipo === 'SOLICITUD_LIDER') {
    leerFilasSeguro_(SHEETS.PROYECTO_INTEGRANTES).forEach(function (i) {
      if (i.proyecto_id === proyecto.proyecto_id && esVerdaderoProyecto_(i.activo) &&
        normalizarEmailProyecto_(i.usuario_email) !== normalizarEmailProyecto_(contexto.email)) {
        destinatarios[normalizarEmailProyecto_(i.usuario_email)] = true;
      }
    });
  }
  var titulo = evento.tipo === 'SOLICITUD_LIDER' ? 'Solicitud del líder en ' + proyecto.nombre
    : 'Actividad en ' + proyecto.nombre;
  Object.keys(destinatarios).forEach(function (email) {
    encolarNotificacionApp_(email, 'PROYECTO_SALA', titulo,
      (evento.titulo || evento.cuerpo || '').slice(0, 140), 'proyectos', 'Ver sala', 72);
  });
}

// --- avance y salud (§J de la propuesta: explicable, no caja negra) -----

// Avance derivado: % de tareas activas TERMINADAS sobre el total activo.
// Vacio (sin tareas) devuelve null -- no 0%, que se leeria como "sin avance"
// en vez de "todavia no hay nada que medir".
function calcularAvanceProyecto_(tareas) {
  var activas = tareas.filter(function (a) { return a.activa === true || a.activa === 'TRUE' || a.activa === 1; });
  if (activas.length === 0) return null;
  var terminadas = activas.filter(function (a) { return a.estado === 'TERMINADA'; });
  return Math.round((terminadas.length / activas.length) * 1000) / 10;
}

// Calcula la salud on-read a partir de senales objetivas y devuelve el
// codigo + los motivos en texto plano (nunca una caja negra). Reusa
// semaforoActividad_ (Actividades.gs) por tarea. salud_override permite una
// correccion manual excepcional, siempre con motivo visible.
function calcularSaludProyecto_(proyecto, tareas, hitos, entregables) {
  if (proyecto.salud_override) {
    var etiquetas = { critico: 'Crítico', riesgo: 'En riesgo', normal: 'Normal' };
    return {
      codigo: proyecto.salud_override,
      etiqueta: etiquetas[proyecto.salud_override] || proyecto.salud_override,
      motivos: [proyecto.salud_override_motivo || 'Fijado manualmente.']
    };
  }
  if (proyecto.estado === PROYECTOS_ESTADOS.CERRADO || proyecto.estado === PROYECTOS_ESTADOS.CANCELADO) {
    return { codigo: 'normal', etiqueta: 'Normal', motivos: [] };
  }

  var activas = tareas.filter(function (a) { return a.activa === true || a.activa === 'TRUE' || a.activa === 1; });
  var motivosCriticos = [], motivosRiesgo = [];
  var ahora = new Date();

  var hitosVencidos = (hitos || []).filter(function (h) {
    return h.estado !== 'COMPLETADO' && h.estado !== 'CANCELADO' && h.fecha_objetivo && new Date(h.fecha_objetivo) < ahora;
  });
  if (hitosVencidos.length > 0) motivosCriticos.push(hitosVencidos.length + ' hito(s) vencido(s)');

  var tareasAtrasadas = activas.filter(function (a) { return semaforoActividad_(a).codigo === 'atrasada'; });
  var criticasAtrasadas = tareasAtrasadas.filter(function (a) { return ['P1', 'P2'].indexOf(a.prioridad) !== -1; });
  if (criticasAtrasadas.length > 0) motivosCriticos.push(criticasAtrasadas.length + ' tarea(s) crítica(s) atrasada(s)');
  else if (tareasAtrasadas.length > 0) motivosRiesgo.push(tareasAtrasadas.length + ' tarea(s) atrasada(s)');

  var bloqueadas = activas.filter(function (a) { return a.estado === 'BLOQUEADA'; });
  var feriados = obtenerFeriados_();
  var bloqueoEstancado = bloqueadas.filter(function (a) {
    return a.bloqueo_desde && Utils.horasHabilesEntre(a.bloqueo_desde, ahora, { feriados: feriados }) / 9 >= 2;
  });
  if (bloqueoEstancado.length > 0) motivosCriticos.push(bloqueoEstancado.length + ' bloqueo(s) estancado(s) (2+ días hábiles)');
  else if (bloqueadas.length > 0) motivosRiesgo.push(bloqueadas.length + ' tarea(s) bloqueada(s)');

  var sinActualizar = activas.filter(function (a) {
    if (!a.ultima_actualizacion) return false;
    return Utils.horasHabilesEntre(a.ultima_actualizacion, ahora, { feriados: feriados }) / 9 >= 5;
  });
  if (sinActualizar.length > 0) motivosRiesgo.push(sinActualizar.length + ' tarea(s) sin actualizar hace 5+ días hábiles');

  // v9.4 (Fase 2, §J de la propuesta): "entregable observado/vencido" como
  // señal de riesgo. APROBADO/CANCELADO son estados que ya no aportan
  // riesgo; el resto (PENDIENTE/ENTREGADO/OBSERVADO) sigue vigente.
  var entregablesVigentes = (entregables || []).filter(function (e) { return e.estado !== 'APROBADO' && e.estado !== 'CANCELADO'; });
  var entregablesVencidos = entregablesVigentes.filter(function (e) {
    return e.fecha_comprometida && new Date(e.fecha_comprometida) < ahora;
  });
  if (entregablesVencidos.length > 0) motivosRiesgo.push(entregablesVencidos.length + ' entregable(s) vencido(s)');
  var entregablesObservados = entregablesVigentes.filter(function (e) { return e.estado === 'OBSERVADO'; });
  if (entregablesObservados.length > 0) motivosRiesgo.push(entregablesObservados.length + ' entregable(s) observado(s)');

  if (motivosCriticos.length > 0) {
    return { codigo: 'critico', etiqueta: 'Crítico', motivos: motivosCriticos.concat(motivosRiesgo) };
  }
  if (motivosRiesgo.length > 0) {
    return { codigo: 'riesgo', etiqueta: 'En riesgo', motivos: motivosRiesgo };
  }
  return { codigo: 'normal', etiqueta: 'Normal', motivos: [] };
}

// "Requiere tu atencion" (§12 de la propuesta): lo que un lider necesita ver
// sin tener que ir a buscarlo.
function calcularRequiereAtencion_(tareas, hitos, integrantes) {
  var ahora = new Date();
  var activas = tareas.filter(function (a) { return a.activa === true || a.activa === 'TRUE' || a.activa === 1; });
  var vencidas = activas.filter(function (a) { return semaforoActividad_(a).codigo === 'atrasada'; });
  var bloqueadas = activas.filter(function (a) { return a.estado === 'BLOQUEADA'; });
  var hitosAtrasados = (hitos || []).filter(function (h) {
    return h.estado !== 'COMPLETADO' && h.estado !== 'CANCELADO' && h.fecha_objetivo && new Date(h.fecha_objetivo) < ahora;
  });
  return {
    tareas_vencidas: vencidas.length,
    tareas_bloqueadas: bloqueadas.length,
    hitos_atrasados: hitosAtrasados.length,
    total_integrantes: (integrantes || []).length
  };
}
