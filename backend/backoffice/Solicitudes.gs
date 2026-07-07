/**
 * Solicitudes.gs — maquina de estados (§8) y prioridad (§7.2, RN-007/008/009).
 *
 * Las transiciones y la prioridad se manejan a nivel de SUBSOLICITUD (cada
 * una tiene su propio estado y prioridad, §8.1); el estado y la prioridad
 * "del padre" (SOLICITUDES.estado_derivado / prioridad_derivada) son
 * siempre recalculados a partir de sus subsolicitudes, nunca escritos
 * directamente. Ver documentacion/fases/FASE-02-maquina-estados.md para el
 * porque de esta decision (router de §4.2 no distingue solicitud_id de
 * subsolicitud_id explicitamente).
 *
 * `contexto` = { email, rol } se resuelve en Code.gs a partir de la
 * identidad Google (Session) y la hoja USUARIOS antes de llegar aqui.
 */

var Solicitudes = {
  actualizarEstado: function (data, contexto) {
    var subsolicitud = buscarSubsolicitud_(data.subsolicitud_id);
    if (!subsolicitud) {
      return errorValidacion_('subsolicitud_id', 'Subsolicitud no encontrada: ' + data.subsolicitud_id);
    }

    var estadoActual = subsolicitud.estado;
    var transicion = buscarTransicion_(estadoActual, data.estado_nuevo);
    if (!transicion) {
      return errorValidacion_(
        'estado_nuevo',
        'Transicion no permitida: ' + estadoActual + ' -> ' + data.estado_nuevo
      );
    }
    if (transicion.roles.indexOf(contexto.rol) === -1) {
      return { _forbidden: true, message: 'El rol ' + contexto.rol + ' no puede aplicar esta transicion.' };
    }
    var comentario = data.comentario || '';
    if (transicion.comentarioObligatorio && comentario.trim() === '') {
      return errorValidacion_('comentario', 'Esta transicion exige un comentario con el motivo.');
    }

    // RN-015: no se pasa a S04 con subsolicitudes sin titulo/descripcion.
    if (data.estado_nuevo === ESTADOS.S04) {
      var incompleta = obtenerSubsolicitudesDeSolicitud_(subsolicitud.solicitud_id).find(function (s) {
        return !s.titulo || !s.descripcion;
      });
      if (incompleta) {
        return errorValidacion_(
          'subsolicitudes',
          'No se puede aprobar (S04): hay subsolicitudes sin titulo o descripcion (RN-015).'
        );
      }
    }

    var timestamp = new Date().toISOString();
    actualizarFilaPorId_(SHEETS.SUBSOLICITUDES, 'subsolicitud_id', data.subsolicitud_id, {
      estado: data.estado_nuevo
    });

    agregarFila_(SHEETS.HISTORIAL_ESTADOS, {
      historial_id: Utilities.getUuid(),
      solicitud_id: subsolicitud.solicitud_id,
      subsolicitud_id: data.subsolicitud_id,
      estado_anterior: estadoActual,
      estado_nuevo: data.estado_nuevo,
      usuario: contexto.email,
      comentario: comentario,
      timestamp: timestamp
    });

    var estadoDerivado = recalcularEstadoDerivado_(subsolicitud.solicitud_id);

    // C-04/§5.2: al aprobar (S04) se encola la generacion de documento; NO
    // se genera aqui (evita el riesgo de timeout de 6 min). El trigger de
    // tiempo (Documentos.procesarColaDocumentos, Triggers.gs) la procesa.
    if (data.estado_nuevo === ESTADOS.S04) {
      actualizarFilaPorId_(SHEETS.SOLICITUDES, 'solicitud_id', subsolicitud.solicitud_id, {
        doc_estado: 'PENDIENTE'
      });
    }

    Notificaciones.notificarCambioEstado(subsolicitud.solicitud_id, data.subsolicitud_id, estadoActual, data.estado_nuevo);

    return {
      subsolicitud_id: data.subsolicitud_id,
      solicitud_id: subsolicitud.solicitud_id,
      estado_anterior: estadoActual,
      estado_nuevo: data.estado_nuevo,
      estado_derivado_padre: estadoDerivado
    };
  },

  actualizarPrioridad: function (data, contexto) {
    if (contexto.rol !== 'ANA' && contexto.rol !== 'ADM') {
      // RN-008: el Desarrollador no modifica prioridad (ni asigna responsables).
      return { _forbidden: true, message: 'El rol ' + contexto.rol + ' no puede modificar la prioridad.' };
    }

    if (data.orden_atencion !== undefined) {
      // RN-009: el orden de atencion entre P1 simultaneos lo fija el Admin.
      if (contexto.rol !== 'ADM') {
        return { _forbidden: true, message: 'Solo Admin puede fijar orden_atencion (RN-009).' };
      }
      actualizarFilaPorId_(SHEETS.SOLICITUDES, 'solicitud_id', data.solicitud_id, {
        orden_atencion: data.orden_atencion
      });
      return { solicitud_id: data.solicitud_id, orden_atencion: data.orden_atencion };
    }

    // Asignacion de responsables (Actores, §5 v1.0): el Analista asigna al
    // Desarrollador que hara el trabajo; solo el Admin reasigna al propio
    // Analista responsable. No es una accion propia del router (§4.2), se
    // agrupa aqui por tocar los mismos campos "administrativos" de
    // SOLICITUDES que orden_atencion -- ver FASE-06-administracion.md.
    if (data.desarrollador_asignado !== undefined || data.analista_asignado !== undefined) {
      return asignarResponsables_(data, contexto);
    }

    if (ORDEN_PRIORIDAD.indexOf(data.prioridad_nueva) === -1) {
      return errorValidacion_('prioridad_nueva', 'Prioridad invalida: ' + data.prioridad_nueva);
    }
    if (!data.justificacion || data.justificacion.trim().length < 20) {
      // RN-007: justificacion minima de 20 caracteres.
      return errorValidacion_('justificacion', 'La justificacion debe tener al menos 20 caracteres.');
    }

    var subsolicitud = buscarSubsolicitud_(data.subsolicitud_id);
    if (!subsolicitud) {
      return errorValidacion_('subsolicitud_id', 'Subsolicitud no encontrada: ' + data.subsolicitud_id);
    }

    var prioridadAnterior = subsolicitud.prioridad;
    var slaHoras = obtenerSlaHoras_(data.prioridad_nueva);
    var timestamp = new Date().toISOString();

    actualizarFilaPorId_(SHEETS.SUBSOLICITUDES, 'subsolicitud_id', data.subsolicitud_id, {
      prioridad: data.prioridad_nueva,
      sla_objetivo_horas: slaHoras
    });

    agregarFila_(SHEETS.HISTORIAL_PRIORIDAD, {
      historial_id: Utilities.getUuid(),
      subsolicitud_id: data.subsolicitud_id,
      solicitud_id: subsolicitud.solicitud_id,
      prioridad_anterior: prioridadAnterior,
      prioridad_nueva: data.prioridad_nueva,
      justificacion: data.justificacion,
      usuario: contexto.email,
      timestamp: timestamp
    });

    var prioridadDerivada = recalcularPrioridadDerivada_(subsolicitud.solicitud_id);

    return {
      subsolicitud_id: data.subsolicitud_id,
      solicitud_id: subsolicitud.solicitud_id,
      prioridad_anterior: prioridadAnterior,
      prioridad_nueva: data.prioridad_nueva,
      prioridad_derivada_padre: prioridadDerivada
    };
  },

  /**
   * Detalle completo de una solicitud (§12.5, RF-018). El ambito por rol
   * ("segun ambito del rol", router §4.2) no esta acotado todavia -- no
   * existe un campo de asignacion de analista/desarrollador en el modelo
   * (ver RECONCILIACION-v1.0.md) -- asi que cualquier rol del Backoffice ya
   * autenticado puede ver cualquier solicitud. Se ajusta cuando exista esa
   * asignacion.
   */
  getDetalle: function (solicitudId, contexto) {
    if (!solicitudId) {
      return errorValidacion_('solicitud_id', 'Falta indicar el numero de solicitud.');
    }
    var solicitud = buscarSolicitudPorId_(solicitudId);
    if (!solicitud) {
      return errorValidacion_('solicitud_id', 'No existe una solicitud con ese numero.');
    }

    var subsolicitudes = obtenerSubsolicitudesDeSolicitud_(solicitudId);
    // Fase 10 (rediseno UX): el selector de estado del detalle solo debe
    // ofrecer transiciones que el backend realmente aceptaria para el rol
    // actual -- antes ofrecia los 11 estados y dejaba que el backend
    // rechazara. Se calcula aqui (mismo TRANSICIONES_VALIDAS que ya usa
    // actualizarEstado) para no duplicar la tabla en el frontend.
    var rolActual = contexto ? contexto.rol : '';
    var transicionesPorSubsolicitud = {};
    subsolicitudes.forEach(function (sub) {
      var opciones = TRANSICIONES_VALIDAS[sub.estado] || [];
      transicionesPorSubsolicitud[sub.subsolicitud_id] = opciones
        .filter(function (t) { return t.roles.indexOf(rolActual) !== -1; })
        .map(function (t) { return { estado: t.a, comentario_obligatorio: !!t.comentarioObligatorio }; });
    });
    var historialEstados = leerFilas_(SHEETS.HISTORIAL_ESTADOS)
      .filter(function (h) { return h.solicitud_id === solicitudId; })
      .sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });
    var historialPrioridad = leerFilas_(SHEETS.HISTORIAL_PRIORIDAD)
      .filter(function (h) { return h.solicitud_id === solicitudId; })
      .sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });
    var comentarios = leerFilas_(SHEETS.COMENTARIOS)
      .filter(function (c) { return c.solicitud_id === solicitudId; })
      .sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });
    // Fase 9 (hallazgo de datos reales): Leo necesita ver las capturas de
    // pantalla adjuntas, no solo texto -- getDetalle no las incluia.
    var archivos = leerFilas_(SHEETS.ARCHIVOS)
      .filter(function (a) { return a.solicitud_id === solicitudId; })
      .sort(function (a, b) { return new Date(a.fecha_subida) - new Date(b.fecha_subida); });

    return {
      solicitud: solicitud,
      subsolicitudes: subsolicitudes,
      historial_estados: historialEstados,
      historial_prioridad: historialPrioridad,
      comentarios: comentarios,
      archivos: archivos,
      rol_actual: rolActual,
      transiciones_por_subsolicitud: transicionesPorSubsolicitud
    };
  }
};

function errorValidacion_(campo, mensaje) {
  return { _validationError: true, message: mensaje, fields: [{ campo: campo, mensaje: mensaje }] };
}

// Duplicado de backend/intake/Solicitudes.gs (ver nota de duplicacion en
// Config.gs): Notificaciones.gs y Documentos.gs lo necesitan aqui tambien.
function buscarSolicitudPorId_(solicitudId) {
  var filas = leerFilas_(SHEETS.SOLICITUDES);
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].solicitud_id === solicitudId) {
      return filas[i];
    }
  }
  return null;
}

function buscarSubsolicitud_(subsolicitudId) {
  var filas = leerFilas_(SHEETS.SUBSOLICITUDES);
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].subsolicitud_id === subsolicitudId) {
      return filas[i];
    }
  }
  return null;
}

function obtenerSubsolicitudesDeSolicitud_(solicitudId) {
  return leerFilas_(SHEETS.SUBSOLICITUDES).filter(function (s) {
    return s.solicitud_id === solicitudId;
  });
}

function buscarTransicion_(estadoActual, estadoNuevo) {
  var opciones = TRANSICIONES_VALIDAS[estadoActual] || [];
  for (var i = 0; i < opciones.length; i++) {
    if (opciones[i].a === estadoNuevo) {
      return opciones[i];
    }
  }
  return null;
}

// §8.2: estado del padre = el MINIMO (menos avanzado) entre subsolicitudes
// no excluidas (S10/S11). Si todas las no excluidas estan en S09 -> S09. Si
// todas las subsolicitudes estan excluidas (S10/S11) -> S10 si hay alguna
// rechazada, si no S11 (ver supuesto documentado en FASE-02).
function calcularEstadoDerivado_(estadosSubsolicitudes) {
  var activas = estadosSubsolicitudes.filter(function (e) {
    return ESTADOS_EXCLUIDOS_DERIVACION.indexOf(e) === -1;
  });

  if (activas.length === 0) {
    return estadosSubsolicitudes.indexOf(ESTADOS.S10) !== -1 ? ESTADOS.S10 : ESTADOS.S11;
  }

  var todasS09 = activas.every(function (e) {
    return e === ESTADOS.S09;
  });
  if (todasS09) {
    return ESTADOS.S09;
  }

  return activas.reduce(function (masAtrasado, actual) {
    return ORDEN_ESTADOS.indexOf(actual) < ORDEN_ESTADOS.indexOf(masAtrasado) ? actual : masAtrasado;
  });
}

function recalcularEstadoDerivado_(solicitudId) {
  var estados = obtenerSubsolicitudesDeSolicitud_(solicitudId).map(function (s) {
    return s.estado;
  });
  var estadoDerivado = calcularEstadoDerivado_(estados);
  actualizarFilaPorId_(SHEETS.SOLICITUDES, 'solicitud_id', solicitudId, {
    estado_derivado: estadoDerivado
  });
  return estadoDerivado;
}

function prioridadMasCritica_(listaPrioridades) {
  return listaPrioridades.reduce(function (masCritica, actual) {
    return ORDEN_PRIORIDAD.indexOf(actual) < ORDEN_PRIORIDAD.indexOf(masCritica) ? actual : masCritica;
  }, 'P5');
}

function recalcularPrioridadDerivada_(solicitudId) {
  var prioridades = obtenerSubsolicitudesDeSolicitud_(solicitudId).map(function (s) {
    return s.prioridad;
  });
  var prioridadDerivada = prioridadMasCritica_(prioridades);
  actualizarFilaPorId_(SHEETS.SOLICITUDES, 'solicitud_id', solicitudId, {
    prioridad_derivada: prioridadDerivada
  });
  return prioridadDerivada;
}

function obtenerSlaHoras_(prioridad) {
  var filas = leerFilas_(SHEETS.CONFIG_SLA);
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].prioridad === prioridad) {
      return filas[i].sla_horas === '' ? '' : Number(filas[i].sla_horas);
    }
  }
  return '';
}

function asignarResponsables_(data, contexto) {
  if (!data.solicitud_id) {
    return errorValidacion_('solicitud_id', 'Falta indicar la solicitud.');
  }
  if (!buscarSolicitudPorId_(data.solicitud_id)) {
    return errorValidacion_('solicitud_id', 'No existe una solicitud con ese numero.');
  }

  // §13.3 v1.0: las subsolicitudes pueden trabajarse en paralelo por
  // distintos desarrolladores (§7.3); si viene subsolicitud_id, el
  // desarrollador se asigna a ese item puntual, no a la solicitud
  // completa (que sigue reflejando el responsable "por defecto").
  if (data.desarrollador_asignado !== undefined && data.subsolicitud_id !== undefined) {
    if (!buscarSubsolicitud_(data.subsolicitud_id)) {
      return errorValidacion_('subsolicitud_id', 'Subsolicitud no encontrada: ' + data.subsolicitud_id);
    }
    actualizarFilaPorId_(SHEETS.SUBSOLICITUDES, 'subsolicitud_id', data.subsolicitud_id, {
      desarrollador_asignado: data.desarrollador_asignado
    });
    return {
      solicitud_id: data.solicitud_id,
      subsolicitud_id: data.subsolicitud_id,
      desarrollador_asignado: data.desarrollador_asignado
    };
  }

  var cambios = {};
  if (data.desarrollador_asignado !== undefined) {
    cambios.desarrollador_asignado = data.desarrollador_asignado;
  }
  if (data.analista_asignado !== undefined) {
    // Solo Admin reasigna al Analista responsable (RN-030 style: el
    // Analista es "el dueno" del flujo, reasignarlo es una decision de
    // administracion, no de operacion diaria).
    if (contexto.rol !== 'ADM') {
      return { _forbidden: true, message: 'Solo Admin puede reasignar el Analista responsable.' };
    }
    cambios.analista_asignado = data.analista_asignado;
  }

  actualizarFilaPorId_(SHEETS.SOLICITUDES, 'solicitud_id', data.solicitud_id, cambios);
  return Object.assign({ solicitud_id: data.solicitud_id }, cambios);
}
