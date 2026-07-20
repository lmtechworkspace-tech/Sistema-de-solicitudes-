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
  actualizarEstado: function (data, contexto, opciones) {
    var opts = opciones || {};
    // P6 (v2.0, Sprint 2): Gerencia ve todo, no toca nada -- "confundir 'ver
    // todo' con 'poder tocar todo'" es justo el riesgo que el propio
    // documento de mejoras advierte evitar.
    if (contexto.rol === 'GERENCIA' && !opts.sistemaAutomatico) {
      return { _forbidden: true, message: 'El rol Gerencia es de solo lectura: no puede cambiar estados.' };
    }
    var subsolicitud = buscarSubsolicitud_(data.subsolicitud_id);
    if (!subsolicitud) {
      return errorValidacion_('subsolicitud_id', 'Subsolicitud no encontrada: ' + data.subsolicitud_id);
    }

    var estadoActual = subsolicitud.estado;
    // Fase 10.1: cualquier estado es un destino valido (ver nota en
    // Constantes.gs) -- solo se exige que exista y que sea distinto del
    // actual. El unico rol resuelve el acceso (contexto ya viene de un
    // usuario activo en USUARIOS, Code.gs); no hay restriccion adicional.
    if (!ESTADOS.hasOwnProperty(data.estado_nuevo)) {
      return errorValidacion_('estado_nuevo', 'Estado invalido: ' + data.estado_nuevo);
    }
    if (data.estado_nuevo === estadoActual) {
      return errorValidacion_('estado_nuevo', 'La subsolicitud ya esta en ese estado.');
    }
    // RN-201 (v2.0, Sprint 1): "Cerrada" (S09) ya no es un destino libre para
    // el gestor -- lo fija el solicitante desde Consultar Estado
    // (Solicitudes.validarCierre, backend/intake) o el cierre automatico por
    // inactividad (Triggers.cerrarInactivosTrigger). Unica excepcion: una
    // consulta tecnica (tipo CON) SI puede cerrarla directo el gestor, porque
    // no hay nada que "validar" -- es una respuesta, no una entrega.
    if (data.estado_nuevo === ESTADOS.S09 && !opts.sistemaAutomatico && !esConsultaTecnica_(subsolicitud)) {
      return {
        _forbidden: true,
        message: 'Solo el solicitante puede confirmar el cierre (o el cierre automatico por inactividad). Mueve el item a Terminada para que quede listo para su validacion.'
      };
    }
    var comentario = data.comentario || '';
    if (comentarioObligatorioParaCambio_(estadoActual, data.estado_nuevo) && comentario.trim() === '') {
      return errorValidacion_('comentario', 'Esta transicion exige un comentario con el motivo.');
    }

    // Una sola lectura de las hermanas: sirve tanto para RN-015 (necesita
    // titulo/descripcion) como para recalcular el estado derivado del padre
    // mas abajo (necesita el estado de cada una) -- antes eran 2 lecturas
    // separadas de la misma hoja (Fase 10.2, "el cambio de estado tarda
    // mucho": cada leerFilas_ es un viaje de ida y vuelta a Sheets).
    var hermanas = obtenerSubsolicitudesDeSolicitud_(subsolicitud.solicitud_id);

    // RN-015: no se pasa a S04 con subsolicitudes sin titulo/descripcion.
    if (data.estado_nuevo === ESTADOS.S04) {
      var incompleta = hermanas.find(function (s) {
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
    var cambiosSubsolicitud = { estado: data.estado_nuevo };
    // v2.1 (Fase A, §2.2 "dos relojes"): entrar a Terminada (S08) detiene el
    // reloj del desarrollador; salir de Terminada (reabrir) lo reanuda -- si
    // no se limpiara, un item reabierto seguiria mostrandose como "esperando
    // validacion del solicitante" con una fecha_terminada vieja.
    if (data.estado_nuevo === ESTADOS.S08) {
      cambiosSubsolicitud.fecha_terminada = timestamp;
    } else if (estadoActual === ESTADOS.S08) {
      cambiosSubsolicitud.fecha_terminada = '';
    }
    actualizarFilaPorId_(SHEETS.SUBSOLICITUDES, 'subsolicitud_id', data.subsolicitud_id, cambiosSubsolicitud);

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

    // Ya sabemos exactamente que cambio (esta subsolicitud, a data.estado_nuevo)
    // asi que se recalcula con los datos que ya tenemos en memoria (hermanas)
    // en vez de releer toda la hoja de nuevo via recalcularEstadoDerivado_.
    var estadosActualizados = hermanas.map(function (s) {
      return s.subsolicitud_id === data.subsolicitud_id ? data.estado_nuevo : s.estado;
    });
    var estadoDerivado = calcularEstadoDerivado_(estadosActualizados);
    actualizarFilaPorId_(SHEETS.SOLICITUDES, 'solicitud_id', subsolicitud.solicitud_id, {
      estado_derivado: estadoDerivado
    });

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
   * v2.1 (Fase A, §3): el desarrollador confirma/fija la fecha comprometida
   * por item -- es la definitiva ("dos promesas", documentacion/SIGSO-v2.1-
   * plazos-y-control.md §2.1); la propuesta del solicitante (fecha_propuesta)
   * es solo informativa. Re-comprometer (ya existia una fecha_comprometida)
   * exige un motivo, igual que RN-007 con la prioridad, porque es la
   * evidencia que el Panel de Gerencia (Fase C) necesita para mostrar el
   * "resbalon" (HISTORIAL_COMPROMISO).
   */
  comprometerFecha: function (data, contexto) {
    if (contexto.rol === 'GERENCIA') {
      return { _forbidden: true, message: 'El rol Gerencia es de solo lectura: no puede comprometer fechas.' };
    }
    if (!data.subsolicitud_id) {
      return errorValidacion_('subsolicitud_id', 'Falta indicar el item.');
    }
    if (!data.fecha_comprometida || isNaN(new Date(data.fecha_comprometida).getTime())) {
      return errorValidacion_('fecha_comprometida', 'Indica una fecha (y hora) valida para comprometerte.');
    }

    var subsolicitud = buscarSubsolicitud_(data.subsolicitud_id);
    if (!subsolicitud) {
      return errorValidacion_('subsolicitud_id', 'Subsolicitud no encontrada: ' + data.subsolicitud_id);
    }

    var esReCompromiso = !!subsolicitud.fecha_comprometida;
    if (esReCompromiso && (!data.motivo || data.motivo.trim().length < 20)) {
      return errorValidacion_('motivo', 'Para mover una fecha ya comprometida debes indicar el motivo (minimo 20 caracteres).');
    }

    var timestamp = new Date().toISOString();
    actualizarFilaPorId_(SHEETS.SUBSOLICITUDES, 'subsolicitud_id', data.subsolicitud_id, {
      fecha_comprometida: data.fecha_comprometida,
      comprometida_por: contexto.email
    });

    if (esReCompromiso) {
      agregarFila_(SHEETS.HISTORIAL_COMPROMISO, {
        historial_id: Utilities.getUuid(),
        subsolicitud_id: data.subsolicitud_id,
        solicitud_id: subsolicitud.solicitud_id,
        fecha_anterior: subsolicitud.fecha_comprometida,
        fecha_nueva: data.fecha_comprometida,
        motivo: data.motivo,
        usuario: contexto.email,
        timestamp: timestamp
      });
    }

    // v2.1 (Fase D, §8): avisa al solicitante -- "maneja expectativas, sin
    // pedir su aprobacion" (la fecha del desarrollador es la definitiva).
    var solicitudParaAviso = buscarSolicitudPorId_(subsolicitud.solicitud_id);
    if (solicitudParaAviso) {
      Notificaciones.avisarCompromisoFecha(
        solicitudParaAviso,
        Object.assign({}, subsolicitud, { fecha_comprometida: data.fecha_comprometida }),
        data.fecha_comprometida
      );
    }

    return {
      subsolicitud_id: data.subsolicitud_id,
      solicitud_id: subsolicitud.solicitud_id,
      fecha_comprometida: data.fecha_comprometida,
      comprometida_por: contexto.email,
      re_compromiso: esReCompromiso
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
  // v3.1 (§2): derivar el trabajo de un responsable a otro. La mecanica de
  // escritura ya existia (asignarResponsables_, alcanzable desde
  // actualizarPrioridad), pero sin UI, sin registro y sin aviso: nadie sabia
  // quien movio que, ni el nuevo responsable se enteraba. Esta accion agrega
  // esas tres piezas y es la que usa el frontend.
  //
  // Acepta tres formas:
  //   { solicitud_id, subsolicitud_id, responsable_nuevo, motivo }  -> un item
  //   { solicitud_id, responsable_nuevo, motivo }                   -> todos los items
  //   { solicitud_ids: [...], responsable_nuevo, motivo }           -> lote
  derivarSolicitud: function (data, contexto) {
    // P6: Gerencia es de solo lectura.
    if (contexto.rol === 'GERENCIA') {
      return { _forbidden: true, message: 'Gerencia tiene acceso de solo lectura.' };
    }
    if (!data.responsable_nuevo) {
      return errorValidacion_('responsable_nuevo', 'Indica a quien se deriva.');
    }
    // Mismo criterio que RN-007 (justificacion de prioridad): una derivacion
    // sin motivo no sirve como registro. Se pide menos texto que en prioridad
    // (10 vs 20) porque aqui el motivo suele ser corto y concreto
    // ("corresponde a Leo", "me voy de vacaciones").
    var motivo = String(data.motivo || '').trim();
    if (motivo.length < 10) {
      return errorValidacion_('motivo', 'El motivo debe tener al menos 10 caracteres.');
    }

    var ids = data.solicitud_ids !== undefined
      ? data.solicitud_ids
      : (data.solicitud_id ? [data.solicitud_id] : []);
    if (!ids.length) {
      return errorValidacion_('solicitud_id', 'Falta indicar la solicitud.');
    }
    // El lote deriva solicitudes completas; derivar "un item de cada una" no
    // tiene sentido operativo y complicaria la validacion de permisos.
    if (data.solicitud_ids !== undefined && data.subsolicitud_id !== undefined) {
      return errorValidacion_('subsolicitud_id', 'La derivacion en lote es por solicitud completa, no por item.');
    }

    // Dos pasadas a proposito. Si se validara mientras se escribe, un id malo
    // a mitad de un lote de 40 dejaria las 20 primeras ya movidas y el
    // llamador recibiendo un error -- media bandeja migrada y nadie sabe cual
    // mitad. Aqui no se escribe nada hasta que TODAS pasan la validacion.
    var planes = [];
    for (var i = 0; i < ids.length; i++) {
      var plan = planificarDerivacion_(ids[i], data.subsolicitud_id, contexto);
      if (plan._validationError || plan._forbidden) {
        return plan;
      }
      planes.push(plan);
    }

    var timestamp = new Date().toISOString();
    var derivadas = planes.map(function (plan) {
      return aplicarDerivacion_(plan, data.responsable_nuevo, motivo, contexto, timestamp);
    });

    // El aviso va agrupado: derivar 40 solicitudes no debe producir 40
    // correos. El registro, en cambio, ya quedo fila por fila.
    Notificaciones.notificarDerivacion(derivadas, data.responsable_nuevo, motivo, contexto.email);

    return {
      responsable_nuevo: data.responsable_nuevo,
      motivo: motivo,
      derivadas: derivadas.map(function (d) { return d.solicitud_id; }),
      total: derivadas.length
    };
  },

  getDetalle: function (solicitudId, contexto) {
    if (!solicitudId) {
      return errorValidacion_('solicitud_id', 'Falta indicar el numero de solicitud.');
    }
    var solicitud = buscarSolicitudPorId_(solicitudId);
    if (!solicitud) {
      return errorValidacion_('solicitud_id', 'No existe una solicitud con ese numero.');
    }

    // v4.2: a diferencia de Gerencia (ve cualquier solicitud), Jefatura solo
    // puede abrir el detalle de una solicitud de SU equipo -- getSolicitudDetalle
    // acepta el modulo 'jefatura' (Code.gs, MODULO_POR_ACCION) pero el modulo
    // por si solo no basta: sin este guardia, un jefe podria pedir CUALQUIER
    // solicitud_id y verla igual. Mismo criterio de equipo que Jefatura.getPanel
    // (esDelEquipoJefaturaSolicitud_), para que "es de mi equipo" no tenga dos
    // implementaciones que puedan divergir.
    if (contexto && contexto.rol === 'JEFATURA') {
      var equipoJefe = obtenerEquipoJefe_(contexto.email);
      var equipoJefeSet = {};
      equipoJefe.forEach(function (email) { equipoJefeSet[email] = true; });
      var subsolicitudesParaGuardia = obtenerSubsolicitudesDeSolicitud_(solicitudId);
      if (!esDelEquipoJefaturaSolicitud_(solicitud, subsolicitudesParaGuardia, equipoJefeSet)) {
        return { _forbidden: true, message: 'Esa solicitud no pertenece a tu equipo.' };
      }
    }

    // v2.1 (Fase B): el semaforo de cumplimiento (§6) se calcula aqui, no se
    // guarda -- se deriva de fecha_comprometida/fecha_terminada/estado en el
    // momento de pedir el detalle (Cumplimiento.gs). Se agrega a una copia
    // del objeto, sin mutar lo que devuelve obtenerSubsolicitudesDeSolicitud_
    // (otras funciones -- actualizarEstado, actualizarPrioridad -- reusan esa
    // lectura sin esperar un campo calculado).
    var subsolicitudes = obtenerSubsolicitudesDeSolicitud_(solicitudId).map(function (sub) {
      return Object.assign({}, sub, { cumplimiento: Cumplimiento.clasificar(sub) });
    });
    // Fase 10.1: cualquier estado es un destino valido para cualquier rol
    // (ver nota en Constantes.gs) -- el selector ofrece los 11 estados
    // menos el actual, marcando cuales piden comentario obligatorio para
    // que el frontend muestre el campo antes de intentar aplicar el cambio.
    var rolActual = contexto ? contexto.rol : '';
    // v4.2: Jefatura es de solo lectura, igual que Gerencia (P6).
    var esSoloLectura = rolActual === 'GERENCIA' || rolActual === 'JEFATURA';
    var transicionesPorSubsolicitud = {};
    subsolicitudes.forEach(function (sub) {
      // P6: Gerencia (y Jefatura, v4.2) son de solo lectura -- no se les
      // ofrece ningun destino (el selector de "Cambiar estado a..." queda
      // vacio en el frontend).
      transicionesPorSubsolicitud[sub.subsolicitud_id] = esSoloLectura ? [] : Object.keys(ESTADOS)
        // RN-201: "Cerrada" no se ofrece al gestor salvo consulta tecnica
        // (ver nota identica en Solicitudes.actualizarEstado).
        .filter(function (estado) {
          if (estado === sub.estado) return false;
          if (estado === ESTADOS.S09 && !esConsultaTecnica_(sub)) return false;
          return true;
        })
        .map(function (estado) {
          return { estado: estado, comentario_obligatorio: comentarioObligatorioParaCambio_(sub.estado, estado) };
        });
    });
    var historialEstados = leerFilas_(SHEETS.HISTORIAL_ESTADOS)
      .filter(function (h) { return h.solicitud_id === solicitudId; })
      .sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });
    var historialPrioridad = leerFilas_(SHEETS.HISTORIAL_PRIORIDAD)
      .filter(function (h) { return h.solicitud_id === solicitudId; })
      .sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });
    // v2.1 (Fase C, §7 drill-down): "resbalones" de fecha comprometida --
    // linea de tiempo propuesta -> comprometida -> re-compromisos -> etc.
    var historialCompromiso = leerFilas_(SHEETS.HISTORIAL_COMPROMISO)
      .filter(function (h) { return h.solicitud_id === solicitudId; })
      .sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });
    // v3.1 (§2.3): quien movio el trabajo, cuando y por que. Se lee con
    // tolerancia porque la hoja es nueva: una instalacion que todavia no la
    // tiene debe seguir abriendo el detalle sin errores.
    var historialAsignacion = [];
    try {
      historialAsignacion = leerFilas_(SHEETS.HISTORIAL_ASIGNACION)
        .filter(function (h) { return h.solicitud_id === solicitudId; })
        .sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });
    } catch (err) {
      historialAsignacion = [];
    }
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
      historial_compromiso: historialCompromiso,
      historial_asignacion: historialAsignacion,
      comentarios: comentarios,
      archivos: archivos,
      rol_actual: rolActual,
      // v3.1 (§2.6): destinatarios posibles del selector "Derivar". Se reusa
      // la misma lista de DEV/ANA activos que ya arma el Dashboard.
      responsables: esSoloLectura ? [] : obtenerResponsablesActivos_(),
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

// Fase 10.1/10.2: con el selector de estado abierto a los 11 destinos (ver
// nota en Constantes.gs), esta funcion es el unico control que queda -- exige
// dejar un motivo por escrito (HISTORIAL_ESTADOS.comentario) para los
// movimientos donde perder ese rastro seria un problema real:
//  - Esperando informacion (S06): el comentario ES la pregunta que
//    Consultar Estado le muestra al solicitante (Solicitudes.responderConsulta,
//    backend/intake) -- sin este requisito, Leo puede dejar el item en S06
//    sin ninguna pregunta registrada y esa funcionalidad queda inutil.
//  - Rechazar (S10) o Cancelar (S11): siempre hay que decir por que.
//  - Cerrar sin pasar por Terminada (S08): un cierre directo es una
//    excepcion al flujo normal (RF-F08 consulta tecnica, o cualquier otro
//    cierre anticipado) y merece una nota de que paso.
//  - Reabrir algo que ya estaba cerrado/rechazado/cancelado: es la unica
//    vez que se "deshace" una decision previa (RN-012/013).
// RN-201: la unica "entrega" que el gestor puede cerrar directo sin pasar
// por la validacion del solicitante es una consulta tecnica (tipo CON,
// TIPOS_INICIALES en backend/setup/Instalador.gs) -- ahi no hay nada que
// entregar/validar, es una respuesta.
function esConsultaTecnica_(subsolicitud) {
  return subsolicitud.tipo === 'CON';
}

function comentarioObligatorioParaCambio_(estadoActual, estadoNuevo) {
  if (estadoNuevo === ESTADOS.S06) return true;
  if (estadoNuevo === ESTADOS.S10 || estadoNuevo === ESTADOS.S11) return true;
  if (estadoNuevo === ESTADOS.S09 && estadoActual !== ESTADOS.S08) return true;
  if (ESTADOS_CERRADOS.indexOf(estadoActual) !== -1) return true;
  return false;
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

// v3.1 (§2), pasada 1 de 2: resuelve y valida UNA derivacion sin escribir
// nada. Devuelve el "plan" (que solicitud, que items, quien la tenia) o un
// objeto de error/forbidden que el llamador propaga tal cual.
function planificarDerivacion_(solicitudId, subsolicitudId, contexto) {
  var solicitud = buscarSolicitudPorId_(solicitudId);
  if (!solicitud) {
    return errorValidacion_('solicitud_id', 'No existe una solicitud con ese numero: ' + solicitudId);
  }

  var esItemPuntual = subsolicitudId !== undefined && subsolicitudId !== '';
  var items = obtenerSubsolicitudesDeSolicitud_(solicitudId);
  if (esItemPuntual) {
    items = items.filter(function (s) { return s.subsolicitud_id === subsolicitudId; });
    if (!items.length) {
      return errorValidacion_('subsolicitud_id', 'Subsolicitud no encontrada: ' + subsolicitudId);
    }
  }

  // §2.4: un Desarrollador solo puede traspasar SU trabajo. Analista y Admin
  // pueden mover cualquiera (el Analista es el dueno del flujo).
  if (contexto.rol === 'DEV') {
    var ajeno = items.filter(function (s) {
      return responsableDeItem_(s, solicitud) !== contexto.email;
    });
    if (ajeno.length) {
      return {
        _forbidden: true,
        message: 'Solo puedes derivar solicitudes asignadas a ti (' + solicitudId + ').'
      };
    }
  }

  return {
    solicitud: solicitud,
    solicitudId: solicitudId,
    subsolicitudId: esItemPuntual ? subsolicitudId : '',
    items: items,
    anterior: esItemPuntual
      ? responsableDeItem_(items[0], solicitud)
      : (solicitud.desarrollador_asignado || '')
  };
}

// Pasada 2 de 2: escribe. Solo se llama con planes ya validados.
function aplicarDerivacion_(plan, responsableNuevo, motivo, contexto, timestamp) {
  var solicitudId = plan.solicitudId;
  var subsolicitudId = plan.subsolicitudId;
  var items = plan.items;
  var anterior = plan.anterior;

  items.forEach(function (item) {
    actualizarFilaPorId_(SHEETS.SUBSOLICITUDES, 'subsolicitud_id', item.subsolicitud_id, {
      desarrollador_asignado: responsableNuevo
    });
  });
  // Al derivar la solicitud completa se mueve tambien el responsable "por
  // defecto" de la cabecera; al derivar un item suelto NO, porque el resto
  // de los items siguen siendo de quien estaban.
  if (!subsolicitudId) {
    actualizarFilaPorId_(SHEETS.SOLICITUDES, 'solicitud_id', solicitudId, {
      desarrollador_asignado: responsableNuevo
    });
  }

  agregarFila_(SHEETS.HISTORIAL_ASIGNACION, {
    historial_id: Utilities.getUuid(),
    solicitud_id: solicitudId,
    subsolicitud_id: subsolicitudId || '',
    responsable_anterior: anterior,
    responsable_nuevo: responsableNuevo,
    motivo: motivo,
    usuario: contexto.email,
    timestamp: timestamp
  });

  return {
    solicitud_id: solicitudId,
    subsolicitud_id: subsolicitudId || '',
    responsable_anterior: anterior,
    responsable_nuevo: responsableNuevo,
    solicitud: plan.solicitud,
    items: items.map(function (s) { return s.subsolicitud_id; })
  };
}

// Quien trabaja un item: su propio asignado, o el de la cabecera si el item
// no tiene uno propio (mismo criterio que el auto-scope del Dashboard).
function responsableDeItem_(item, solicitud) {
  return item.desarrollador_asignado || solicitud.desarrollador_asignado || '';
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
