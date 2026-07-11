/**
 * Solicitudes.gs — Solicitudes.crearSolicitud(data), orden de operaciones
 * segun §5.1:
 *  1. Validar campos obligatorios y reglas de negocio (RN-001-005, §7.1).
 *  2. Deduplicacion por hash (RF-F06).
 *  3. Derivar prioridad automatica por impacto (RN-006, §7.2).
 *  4. Generar solicitud_id (Correlativo.gs).
 *  5. Escribir SOLICITUDES + SUBSOLICITUDES + HISTORIAL_ESTADOS (S01).
 *  6. (Archivos: Fase futura, subirArchivo es un endpoint aparte, §5.3).
 *  7. Generar resumen WhatsApp.
 *  8. Devolver { solicitud_id, resumen_whatsapp, estado }.
 *
 * Las alertas P1 y el acuse de recibo por Gmail (pasos restantes de §5.1)
 * quedan para la Fase 4 (Documentos y notificaciones): esta fase deja el
 * dato (prioridad_derivada, estado) listo para que esa cola los consuma.
 */

var Solicitudes = {
  crearSolicitud: function (data) {
    var errores = validarSolicitud_(data);
    if (errores.length > 0) {
      return {
        _validationError: true,
        message: 'La solicitud tiene datos invalidos o incompletos.',
        fields: errores
      };
    }

    var dedupHash = calcularHashDuplicado_(data);
    var duplicado = buscarDuplicadoAbierto_(dedupHash);

    var solicitudId = generarId_(data.empresa_id);
    var timestamp = new Date().toISOString();

    var subsolicitudesGuardadas = data.subsolicitudes.map(function (item, idx) {
      // P2 (v2.0, Sprint 2): la urgencia real no es solo lo que el
      // solicitante declara como impacto -- ciertos tipos son urgentes por
      // naturaleza (CAT_TIPOS.es_urgente), y toda solicitud de cliente ya
      // es urgente por defecto (RN-005, P4). derivarPrioridad_ nunca deja
      // que estas bajen de P2, aunque el impacto declarado sea menor.
      var esUrgentePorTipo = !!data.es_cliente || tipoEsUrgente_(item.tipo);
      var prioridad = derivarPrioridad_(item.impacto, esUrgentePorTipo);
      var slaHoras = obtenerSlaHoras_(prioridad);
      var subId = solicitudId + '-' + ('0' + (idx + 1)).slice(-2);

      // v3.0 (Fase 1): area por item (o la de la solicitud como default);
      // resolverResponsable_ traduce area -> correo del responsable (o el
      // buzon por defecto si no hay area configurada, preservando el
      // comportamiento previo). Ese responsable se rutea a
      // desarrollador_asignado -- asi el filtro "asignadas a mi" del
      // Backoffice ya funciona sin que nadie asigne a mano.
      var areaId = item.area || data.area || '';
      var responsable = resolverResponsable_(areaId);

      agregarFila_(SHEETS.SUBSOLICITUDES, {
        subsolicitud_id: subId,
        solicitud_id: solicitudId,
        numero_item: idx + 1,
        titulo: item.titulo,
        descripcion: item.descripcion,
        contexto: item.contexto || '',
        resultado_esperado: item.resultado_esperado || '',
        impacto: item.impacto || '',
        prioridad: prioridad,
        estado: ESTADOS.S01,
        url_modulo: item.url_modulo || '',
        usuario_prueba: item.usuario_prueba || '',
        ref_credencial: item.ref_credencial || '',
        centro_costos: item.centro_costos || '',
        url_video: item.url_video || '',
        observaciones: item.observaciones || '',
        sla_objetivo_horas: slaHoras,
        estimacion_horas: item.estimacion_horas || '',
        horas_reales: '',
        fecha_creacion: timestamp,
        urls_adicionales: JSON.stringify(item.urls_adicionales || []),
        // Fase 10: tipo/modulo se piden por item, no una sola vez por
        // solicitud (una solicitud real mezcla Error+Mejora+Nuevo modulo).
        tipo: item.tipo || '',
        tipo_nombre: resolverNombreCatalogo_(SHEETS.CAT_TIPOS, 'tipo_id', item.tipo),
        modulo: item.modulo || '',
        modulo_nombre: resolverNombreCatalogo_(SHEETS.CAT_MODULOS, 'modulo_id', item.modulo),
        // Reemplaza a estimacion_horas en el formulario publico (el
        // solicitante no puede estimar esfuerzo de desarrollo).
        frecuencia: item.frecuencia || '',
        personas_afectadas: item.personas_afectadas || '',
        // Array de strings: el indice i es la descripcion de la i-esima
        // imagen subida para este item (subirArchivo se llama despues de
        // crearSolicitud, en el mismo orden -- el archivo_id real no existe
        // todavia aqui, asi que no se puede indexar por archivo_id).
        imagen_descripciones: JSON.stringify(item.imagen_descripciones || []),
        // v2.1 (Fase A): fecha_propuesta es UNA sola por solicitud (lo que
        // pidio el solicitante), replicada como default en cada item -- el
        // desarrollador la desglosa/ajusta por item al comprometerse
        // (fecha_comprometida, ver Backoffice Solicitudes.comprometerFecha).
        fecha_propuesta: data.fecha_propuesta || '',
        fecha_comprometida: '',
        fecha_terminada: '',
        comprometida_por: '',
        // v3.0 (Fase 1): ruteo. area/area_nombre para mostrar a quien va;
        // desarrollador_asignado con el responsable resuelto (antes quedaba
        // vacio hasta que alguien asignaba a mano en el Backoffice).
        desarrollador_asignado: responsable,
        area: areaId,
        area_nombre: resolverNombreCatalogo_(SHEETS.CAT_AREAS, 'area_id', areaId)
      });

      return { subsolicitud_id: subId, prioridad: prioridad, responsable: responsable };
    });

    // Fase 10: SOLICITUDES.tipo/modulo (columnas existentes) se derivan del
    // primer item -- mantiene compatibilidad con dedup/resumen/Dashboard sin
    // tocarlos, aunque ya no reflejan "la verdad completa" cuando hay items
    // mixtos (el desglose real vive en SUBSOLICITUDES).
    var primerItem = data.subsolicitudes[0] || {};

    var prioridadDerivada = prioridadMasCritica_(
      subsolicitudesGuardadas.map(function (s) { return s.prioridad; })
    );
    var estimacionTotalHoras = data.subsolicitudes.reduce(function (acc, item) {
      return acc + (Number(item.estimacion_horas) || 0);
    }, 0);
    var resumenWhatsapp = generarResumenWhatsapp_(solicitudId, data, prioridadDerivada);

    agregarFila_(SHEETS.SOLICITUDES, {
      solicitud_id: solicitudId,
      empresa_id: data.empresa_id,
      empresa_nombre: resolverNombreCatalogo_(SHEETS.CAT_EMPRESAS, 'empresa_id', data.empresa_id),
      plataforma: data.plataforma,
      plataforma_nombre: resolverNombreCatalogo_(SHEETS.CAT_PLATAFORMAS, 'plataforma_id', data.plataforma),
      modulo: primerItem.modulo || '',
      modulo_nombre: resolverNombreCatalogo_(SHEETS.CAT_MODULOS, 'modulo_id', primerItem.modulo),
      tipo: primerItem.tipo || '',
      tipo_nombre: resolverNombreCatalogo_(SHEETS.CAT_TIPOS, 'tipo_id', primerItem.tipo),
      solicitante_nombre: data.solicitante_nombre,
      solicitante_cargo: data.solicitante_cargo,
      solicitante_email: data.solicitante_email,
      es_cliente: !!data.es_cliente,
      empresa_cliente: data.empresa_cliente || '',
      cliente_mandante: data.cliente_mandante || '',
      cliente_obra: data.cliente_obra || '',
      contacto_cliente: data.contacto_cliente || '',
      correo_cliente: data.correo_cliente || '',
      telefono_cliente: data.telefono_cliente || '',
      urgencia_cliente: data.urgencia_cliente || '',
      estado_derivado: ESTADOS.S01,
      prioridad_derivada: prioridadDerivada,
      orden_atencion: '',
      doc_estado: '',
      doc_reintentos: 0,
      url_doc: '',
      url_pdf: '',
      version_documento: 0,
      url_pdf_historial: '',
      dedup_hash: dedupHash,
      estimacion_total_horas: estimacionTotalHoras,
      horas_reales: '',
      observaciones_generales: data.observaciones_generales || '',
      resumen_whatsapp: resumenWhatsapp,
      fecha_creacion: timestamp,
      creado_por: data.solicitante_email,
      cc: data.cc || ''
    });

    agregarFila_(SHEETS.HISTORIAL_ESTADOS, {
      historial_id: Utilities.getUuid(),
      solicitud_id: solicitudId,
      subsolicitud_id: '',
      estado_anterior: '',
      estado_nuevo: ESTADOS.S01,
      usuario: 'sistema',
      comentario: 'Solicitud creada por el formulario publico.',
      timestamp: timestamp
    });

    // §5.1 pasos 6-7: acuse de recibo siempre al solicitante (con su cc).
    Notificaciones.enviarAcuseRecibo({
      solicitud_id: solicitudId,
      solicitante_nombre: data.solicitante_nombre,
      solicitante_email: data.solicitante_email,
      resumen_whatsapp: resumenWhatsapp,
      cc: data.cc || ''
    });
    // v3.0 (Fase 1, multi-responsable): el aviso ya no va a un buzon fijo
    // (Leo). Se avisa al RESPONSABLE ruteado de cada item (CAT_AREAS ->
    // responsable, o el buzon por defecto si no hay area configurada). Si
    // dos items caen en el mismo responsable, recibe un solo aviso (dedup
    // por destinatario en enviarCorreo_). Cambio de comportamiento respecto
    // de v2.x: antes una solicitud interna no urgente no avisaba a nadie
    // salvo opt-in; ahora, como la solicitud va dirigida a alguien concreto,
    // esa persona SIEMPRE se entera (esa es la razon de ser del ruteo).
    // P12 (v2.0, Sprint 3): el switch global (AVISO_LEO) sigue mandando -- si
    // Gerencia lo desactiva desde Administracion, no se avisa a nadie.
    if (avisoDesarrolloActivo_()) {
      var motivoAviso = data.es_cliente ? 'solicitud de cliente'
        : (prioridadDerivada === 'P1' ? 'prioridad critica P1' : 'nueva solicitud');
      var responsablesAvisados = {};
      subsolicitudesGuardadas.forEach(function (s) {
        if (!s.responsable || responsablesAvisados[s.responsable]) {
          return;
        }
        responsablesAvisados[s.responsable] = true;
        Notificaciones.enviarAvisoDesarrollo({
          solicitud_id: solicitudId,
          prioridad: prioridadDerivada,
          resumen_whatsapp: resumenWhatsapp
        }, motivoAviso, s.responsable);
      });
    }

    var respuesta = {
      solicitud_id: solicitudId,
      resumen_whatsapp: resumenWhatsapp,
      estado: ESTADOS.S01
    };
    if (duplicado) {
      // RF-F06: se avisa, no se bloquea la creacion de la solicitud.
      respuesta.posible_duplicado = { solicitud_id: duplicado.solicitud_id };
    }
    return respuesta;
  },

  /**
   * Consulta publica de estado por numero + verificacion de correo (§3.2,
   * §12.1). Version interina: compara el correo recibido contra el
   * registrado en la solicitud, sin token firmado. El magic link real
   * (token de un solo uso enviado por Gmail) es Fase 4 -- ahi este metodo
   * se endurece para exigir el token en vez de aceptar el correo en claro
   * (documentado en FASE-03-frontend-publico.md).
   */
  estadoPublico: function (solicitudId, email) {
    if (!solicitudId || !email) {
      return errorValidacion_('solicitud_id', 'Debes indicar el numero de solicitud y el correo.');
    }

    var solicitud = buscarSolicitudPorId_(solicitudId);
    if (!solicitud) {
      return errorValidacion_('solicitud_id', 'No existe una solicitud con ese numero.');
    }

    var coincide =
      compararEmail_(email, solicitud.solicitante_email) ||
      (!!solicitud.es_cliente && compararEmail_(email, solicitud.correo_cliente));
    if (!coincide) {
      return { _forbidden: true, message: 'El correo no coincide con el registrado para esta solicitud.' };
    }

    var subsolicitudes = leerFilas_(SHEETS.SUBSOLICITUDES)
      .filter(function (s) {
        return s.solicitud_id === solicitudId;
      })
      .map(function (s) {
        // El detalle publico incluye lo que el solicitante mismo escribio
        // (descripcion, resultado esperado, contexto) para que al expandir un
        // item vea de que se trata -- nunca datos internos de gestion.
        // subsolicitud_id se expone para poder responder (responderConsulta)
        // cuando el item esta "esperando informacion" (S06).
        return {
          subsolicitud_id: s.subsolicitud_id,
          numero_item: s.numero_item,
          titulo: s.titulo,
          estado: s.estado,
          prioridad: s.prioridad,
          tipo_nombre: s.tipo_nombre || '',
          modulo_nombre: s.modulo_nombre || '',
          // v3.0 (Fase 1): a que area va dirigido (nombre legible, nunca el
          // correo del responsable). Para que el solicitante sepa a quien
          // le llego su pedido.
          area_nombre: s.area_nombre || '',
          descripcion: s.descripcion || '',
          resultado_esperado: s.resultado_esperado || '',
          contexto: s.contexto || '',
          // v2.1 (Fase A): el solicitante ve lo que propuso y, una vez que
          // Leo se compromete, la fecha DEFINITIVA (esa es la oficial, no
          // la propuesta -- ver documentacion/SIGSO-v2.1-plazos-y-control.md §2.1).
          fecha_propuesta: s.fecha_propuesta || '',
          fecha_comprometida: s.fecha_comprometida || '',
          // Fase 10.1: si Leo pidio mas informacion (S06), el comentario con
          // el que hizo la transicion ES la pregunta -- se muestra aqui para
          // que el solicitante sepa que le estan pidiendo sin tener que
          // llamar/escribir aparte.
          pregunta_pendiente: s.estado === ESTADOS.S06 ? obtenerUltimaPreguntaEsperandoInfo_(s.subsolicitud_id) : ''
        };
      });

    return {
      solicitud_id: solicitud.solicitud_id,
      estado_derivado: solicitud.estado_derivado,
      prioridad_derivada: solicitud.prioridad_derivada,
      fecha_creacion: solicitud.fecha_creacion,
      doc_estado: solicitud.doc_estado,
      url_pdf: solicitud.url_pdf,
      // P2 (v2.0, Sprint 2): "cuantas hay antes que yo" -- posicion en la
      // cola de su propia empresa, sin exponer el contenido de las demas
      // (privacidad, requisito explicito de la reunion).
      posicion_cola: ESTADOS_CERRADOS.indexOf(solicitud.estado_derivado) === -1
        ? calcularPosicionCola_(solicitud)
        : null,
      subsolicitudes: subsolicitudes
    };
  },

  /**
   * Respuesta del solicitante a un pedido de informacion (Fase 10.1): se
   * agrega como comentario publico (es_interno=false), visible para Leo en
   * el panel de Backoffice (getDetalle ya lee COMENTARIOS). No cambia el
   * estado -- es Leo quien decide, al leer la respuesta, mover el item de
   * "esperando informacion" al siguiente paso.
   */
  responderConsulta: function (data) {
    if (!data.solicitud_id || !data.email || !data.texto || String(data.texto).trim() === '') {
      return errorValidacion_('texto', 'Debes indicar la solicitud, tu correo y una respuesta.');
    }

    var solicitud = buscarSolicitudPorId_(data.solicitud_id);
    if (!solicitud) {
      return errorValidacion_('solicitud_id', 'No existe una solicitud con ese numero.');
    }

    var coincide =
      compararEmail_(data.email, solicitud.solicitante_email) ||
      (!!solicitud.es_cliente && compararEmail_(data.email, solicitud.correo_cliente));
    if (!coincide) {
      return { _forbidden: true, message: 'El correo no coincide con el registrado para esta solicitud.' };
    }

    agregarFila_(SHEETS.COMENTARIOS, {
      comentario_id: Utilities.getUuid(),
      solicitud_id: data.solicitud_id,
      subsolicitud_id: data.subsolicitud_id || '',
      usuario: data.email,
      texto: data.texto,
      es_interno: false,
      timestamp: new Date().toISOString()
    });

    // P5 (v2.0, Sprint 3): cierra el ciclo "pedir informacion / responder"
    // -- hasta ahora Leo se enteraba de la respuesta solo si volvia a mirar
    // el panel. Sin esto la funcionalidad de S06 queda a medias (la
    // pregunta si se notifica, la respuesta no).
    Notificaciones.notificarRespuestaSolicitante(solicitud, data.subsolicitud_id || '', data.texto);

    return { ok: true };
  },

  /**
   * Validacion/cierre por el solicitante (RN-201, RF-206/207, v2.0 Sprint 1):
   * revierte el cierre libre del gestor -- "Cerrada" (S09) solo la fija el
   * solicitante desde Consultar Estado (o el cierre automatico por
   * inactividad, backend/backoffice/Triggers.gs), nunca el gestor
   * directamente (salvo consulta tecnica, ver esConsultaTecnica_ en
   * backend/backoffice/Solicitudes.gs).
   *
   * accion = 'confirmar' (queda Cerrada) | 'reabrir' (vuelve a En desarrollo,
   * con comentario obligatorio explicando que falta).
   */
  validarCierre: function (data) {
    if (!data.solicitud_id || !data.subsolicitud_id || !data.email || !data.accion) {
      return errorValidacion_('accion', 'Debes indicar la solicitud, el item, tu correo y la accion.');
    }
    if (data.accion !== 'confirmar' && data.accion !== 'reabrir') {
      return errorValidacion_('accion', 'Accion invalida: ' + data.accion);
    }

    var solicitud = buscarSolicitudPorId_(data.solicitud_id);
    if (!solicitud) {
      return errorValidacion_('solicitud_id', 'No existe una solicitud con ese numero.');
    }

    var coincide =
      compararEmail_(data.email, solicitud.solicitante_email) ||
      (!!solicitud.es_cliente && compararEmail_(data.email, solicitud.correo_cliente));
    if (!coincide) {
      return { _forbidden: true, message: 'El correo no coincide con el registrado para esta solicitud.' };
    }

    var subsolicitud = buscarSubsolicitud_(data.subsolicitud_id);
    if (!subsolicitud || subsolicitud.solicitud_id !== data.solicitud_id) {
      return errorValidacion_('subsolicitud_id', 'Item no encontrado en esta solicitud.');
    }
    if (subsolicitud.estado !== ESTADOS.S08) {
      return errorValidacion_('subsolicitud_id', 'Este item no esta pendiente de validacion (debe estar Terminada).');
    }
    if (data.accion === 'reabrir' && (!data.comentario || String(data.comentario).trim() === '')) {
      return errorValidacion_('comentario', 'Cuentanos que falta antes de reabrir el item.');
    }

    var estadoAnterior = subsolicitud.estado;
    var estadoNuevo = data.accion === 'confirmar' ? ESTADOS.S09 : ESTADOS.S05;
    var comentario = data.accion === 'confirmar'
      ? 'Cierre confirmado por el solicitante.'
      : 'Reabierto por el solicitante: ' + data.comentario;
    var timestamp = new Date().toISOString();

    actualizarFilaPorId_(SHEETS.SUBSOLICITUDES, 'subsolicitud_id', data.subsolicitud_id, { estado: estadoNuevo });
    agregarFila_(SHEETS.HISTORIAL_ESTADOS, {
      historial_id: Utilities.getUuid(),
      solicitud_id: data.solicitud_id,
      subsolicitud_id: data.subsolicitud_id,
      estado_anterior: estadoAnterior,
      estado_nuevo: estadoNuevo,
      usuario: data.email,
      comentario: comentario,
      timestamp: timestamp
    });

    var hermanas = leerFilas_(SHEETS.SUBSOLICITUDES).filter(function (s) {
      return s.solicitud_id === data.solicitud_id;
    });
    var estadosActualizados = hermanas.map(function (s) {
      return s.subsolicitud_id === data.subsolicitud_id ? estadoNuevo : s.estado;
    });
    var estadoDerivado = calcularEstadoDerivado_(estadosActualizados);
    actualizarFilaPorId_(SHEETS.SOLICITUDES, 'solicitud_id', data.solicitud_id, { estado_derivado: estadoDerivado });

    Notificaciones.notificarValidacionSolicitante(solicitud, subsolicitud, data.accion);

    return {
      subsolicitud_id: data.subsolicitud_id,
      solicitud_id: data.solicitud_id,
      estado_anterior: estadoAnterior,
      estado_nuevo: estadoNuevo,
      estado_derivado_padre: estadoDerivado
    };
  }
};

// Duplicado de backend/backoffice/Solicitudes.gs (RN-201): §8.2, estado del
// padre = el MINIMO (menos avanzado) entre subsolicitudes no excluidas.
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

function buscarSubsolicitud_(subsolicitudId) {
  var filas = leerFilas_(SHEETS.SUBSOLICITUDES);
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].subsolicitud_id === subsolicitudId) {
      return filas[i];
    }
  }
  return null;
}

// Ultimo comentario con el que Leo entro a S06 para este item (el mas
// reciente, por si volvio a pedir informacion mas de una vez).
function obtenerUltimaPreguntaEsperandoInfo_(subsolicitudId) {
  var eventos = leerFilas_(SHEETS.HISTORIAL_ESTADOS).filter(function (h) {
    return h.subsolicitud_id === subsolicitudId && h.estado_nuevo === ESTADOS.S06;
  });
  if (eventos.length === 0) return '';
  var masReciente = eventos.reduce(function (a, b) {
    return new Date(b.timestamp) > new Date(a.timestamp) ? b : a;
  });
  return masReciente.comentario || '';
}

function errorValidacion_(campo, mensaje) {
  return { _validationError: true, message: mensaje, fields: [{ campo: campo, mensaje: mensaje }] };
}

// P2: cuenta cuantas solicitudes ABIERTAS de la MISMA empresa estan
// "adelante" en la cola -- prioridad mas critica, o misma prioridad pero
// creada antes. No cruza empresas (la cola es la de tu propio equipo/Leo).
function calcularPosicionCola_(solicitud) {
  var indiceMiPrioridad = ORDEN_PRIORIDAD.indexOf(solicitud.prioridad_derivada);
  var miFecha = new Date(solicitud.fecha_creacion).getTime();
  return leerFilas_(SHEETS.SOLICITUDES).filter(function (otra) {
    if (otra.solicitud_id === solicitud.solicitud_id) return false;
    if (otra.empresa_id !== solicitud.empresa_id) return false;
    if (ESTADOS_CERRADOS.indexOf(otra.estado_derivado) !== -1) return false;
    var indiceOtra = ORDEN_PRIORIDAD.indexOf(otra.prioridad_derivada);
    if (indiceOtra < indiceMiPrioridad) return true;
    return indiceOtra === indiceMiPrioridad && new Date(otra.fecha_creacion).getTime() < miFecha;
  }).length;
}

function buscarSolicitudPorId_(solicitudId) {
  var filas = leerFilas_(SHEETS.SOLICITUDES);
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].solicitud_id === solicitudId) {
      return filas[i];
    }
  }
  return null;
}

function compararEmail_(a, b) {
  return !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function validarSolicitud_(data) {
  var errores = [];

  function requerido_(campo, valor) {
    if (valor === undefined || valor === null || String(valor).trim() === '') {
      errores.push({ campo: campo, mensaje: 'Campo obligatorio: ' + campo });
    }
  }

  // RN-002: sin empresa y plataforma no se puede enviar. modulo/tipo se
  // exigen por item (Fase 10, ver validacion de subsolicitudes mas abajo):
  // una solicitud real mezcla tipos y modulos distintos por item.
  requerido_('empresa_id', data.empresa_id);
  requerido_('plataforma', data.plataforma);

  // Necesario para notificaciones y magic link (§12.1); sin numero de RN
  // propio pero indispensable para que el resto del flujo funcione.
  requerido_('solicitante_nombre', data.solicitante_nombre);
  // RF-001 (v1.0): cargo del solicitante, campo base obligatorio del formulario.
  requerido_('solicitante_cargo', data.solicitante_cargo);
  requerido_('solicitante_email', data.solicitante_email);
  if (data.solicitante_email && !esEmailValido_(data.solicitante_email)) {
    errores.push({ campo: 'solicitante_email', mensaje: 'Formato de correo invalido' });
  }

  // RN-004: al menos una subsolicitud con titulo y descripcion.
  if (!Array.isArray(data.subsolicitudes) || data.subsolicitudes.length < 1) {
    errores.push({
      campo: 'subsolicitudes',
      mensaje: 'Debe incluir al menos una subsolicitud (RN-004)'
    });
  } else {
    data.subsolicitudes.forEach(function (item, idx) {
      if (!item || !item.titulo || String(item.titulo).trim() === '') {
        errores.push({
          campo: 'subsolicitudes[' + idx + '].titulo',
          mensaje: 'Titulo obligatorio (RN-004)'
        });
      }
      if (!item || !item.descripcion || String(item.descripcion).trim() === '') {
        errores.push({
          campo: 'subsolicitudes[' + idx + '].descripcion',
          mensaje: 'Descripcion obligatoria (RN-004)'
        });
      }
      // RN-002 (Fase 10): tipo y modulo se exigen por item, no una sola vez
      // por solicitud.
      if (!item || !item.tipo || String(item.tipo).trim() === '') {
        errores.push({
          campo: 'subsolicitudes[' + idx + '].tipo',
          mensaje: 'Tipo obligatorio (RN-002)'
        });
      }
      if (!item || !item.modulo || String(item.modulo).trim() === '') {
        errores.push({
          campo: 'subsolicitudes[' + idx + '].modulo',
          mensaje: 'Modulo obligatorio (RN-002)'
        });
      }
    });
  }

  // cc (Fase 9): opcional, pero si viene debe ser un correo valido.
  if (data.cc && !esEmailValido_(data.cc)) {
    errores.push({ campo: 'cc', mensaje: 'Formato de correo invalido' });
  }

  // v2.1 (Fase A, §4 de la especificacion): "para cuando lo necesitas" es
  // opcional en general, pero obligatoria -- CON hora -- para solicitudes
  // de cliente o con impacto critico (P1): ahi la hora importa porque se
  // puede resolver en horas/minutos. Para el resto, si viene, alcanza con
  // la fecha (sin hora).
  if (requiereFechaHoraPropuesta_(data)) {
    if (!data.fecha_propuesta || String(data.fecha_propuesta).trim() === '') {
      errores.push({
        campo: 'fecha_propuesta',
        mensaje: 'Indica para cuando necesitas esto resuelto (fecha y hora): es una solicitud de cliente o de impacto critico.'
      });
    } else if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(data.fecha_propuesta))) {
      errores.push({
        campo: 'fecha_propuesta',
        mensaje: 'Para esta solicitud tambien debes indicar la hora en que la necesitas.'
      });
    }
  } else if (data.fecha_propuesta && isNaN(new Date(data.fecha_propuesta).getTime())) {
    errores.push({ campo: 'fecha_propuesta', mensaje: 'Formato de fecha invalido' });
  }

  // RN-005: si es solicitud de cliente, empresa cliente + contacto + correo
  // son obligatorios.
  if (data.es_cliente) {
    requerido_('empresa_cliente', data.empresa_cliente);
    requerido_('contacto_cliente', data.contacto_cliente);
    requerido_('correo_cliente', data.correo_cliente);
    if (data.correo_cliente && !esEmailValido_(data.correo_cliente)) {
      errores.push({ campo: 'correo_cliente', mensaje: 'Formato de correo invalido (RN-005)' });
    }
  }

  return errores;
}

// P12: lee CONFIG_NOTIFICACIONES.activo para el registro AVISO_LEO. Si el
// registro no existe todavia (instalacion vieja sin el seed nuevo), se
// asume activo=true -- reproduce el comportamiento previo a Sprint 3, no
// rompe nada por default.
function avisoDesarrolloActivo_() {
  var filas;
  try {
    filas = leerFilas_(SHEETS.CONFIG_NOTIFICACIONES);
  } catch (err) {
    return true;
  }
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].notif_id === 'AVISO_LEO') {
      var valor = filas[i].activo;
      return valor === true || valor === 'TRUE' || valor === 1;
    }
  }
  return true;
}

// v2.1 (Fase A, §4): la hora importa cuando la solicitud puede resolverse en
// horas/minutos -- cliente (siempre) o cualquier item con impacto que
// deriva P1 (SISTEMA_CAIDO/PERDIDA_DATOS/BLOQUEO_OPERATIVO). No se usa
// derivarPrioridad_/es_urgente aqui: ese piso solo SUBE prioridad hacia P2,
// nunca baja un P1 real, asi que basta con mirar el impacto declarado.
function requiereFechaHoraPropuesta_(data) {
  if (data.es_cliente) return true;
  if (!Array.isArray(data.subsolicitudes)) return false;
  return data.subsolicitudes.some(function (item) {
    return !!item && MAPA_IMPACTO_PRIORIDAD[item.impacto] === 'P1';
  });
}

function esEmailValido_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Desnormalizacion deliberada (§13.2 v1.0 / §6 v1.1): resuelve el nombre
// legible de un catalogo para guardarlo junto al id/codigo en SOLICITUDES.
// Si el catalogo todavia no existe (instalacion incompleta) o el id no
// tiene match, no bloquea la creacion de la solicitud: devuelve '' y sigue.
function resolverNombreCatalogo_(nombreHoja, idCampo, valorId) {
  var filas;
  try {
    filas = leerFilas_(nombreHoja);
  } catch (err) {
    return '';
  }
  for (var i = 0; i < filas.length; i++) {
    if (filas[i][idCampo] === valorId) {
      return filas[i].nombre || '';
    }
  }
  return '';
}

// v3.0 (Fase 1): traduce un area (CAT_AREAS.area_id) al correo del
// responsable que la atiende. Si el area no existe/esta inactiva/sin correo,
// o la hoja CAT_AREAS todavia no existe (instalacion previa a v3.0), cae al
// buzon por defecto (EMAIL_DESARROLLO, Notificaciones.gs) -- asi todo sigue
// llegando a Leo hasta que se configuren las areas, sin romper nada.
function resolverResponsable_(areaId) {
  if (!areaId) {
    return EMAIL_DESARROLLO;
  }
  var filas;
  try {
    filas = leerFilas_(SHEETS.CAT_AREAS);
  } catch (err) {
    return EMAIL_DESARROLLO;
  }
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].area_id === areaId) {
      var activo = filas[i].activo === true || filas[i].activo === 'TRUE' || filas[i].activo === 1;
      if (activo && filas[i].responsable_email) {
        return filas[i].responsable_email;
      }
    }
  }
  return EMAIL_DESARROLLO;
}

// RF-F06: hash de (empresa+plataforma+modulo+solicitante+descripcion_item1).
// Fase 10: modulo ahora vive en el primer item, no a nivel raiz de data.
function calcularHashDuplicado_(data) {
  var primerItem = data.subsolicitudes[0] || {};
  var base = [
    data.empresa_id,
    data.plataforma,
    primerItem.modulo || '',
    String(data.solicitante_email || '').toLowerCase(),
    String(primerItem.descripcion || '').trim().toLowerCase()
  ].join('|');

  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, base, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    var hex = (b < 0 ? b + 256 : b).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

function buscarDuplicadoAbierto_(dedupHash) {
  var filas = leerFilas_(SHEETS.SOLICITUDES);
  for (var i = 0; i < filas.length; i++) {
    var fila = filas[i];
    if (fila.dedup_hash === dedupHash && ESTADOS_CERRADOS.indexOf(fila.estado_derivado) === -1) {
      return fila;
    }
  }
  return null;
}

// RN-006 sigue siendo la base (impacto declarado); P2 (Sprint 2) le agrega
// un piso: si el tipo es urgente por naturaleza o es solicitud de cliente,
// la prioridad nunca queda mas baja que P2 -- pero un impacto realmente
// critico (P1: sistema caido, perdida de datos, bloqueo operativo) sigue
// ganando, nunca se "diluye" a P2 por la regla de urgencia.
function derivarPrioridad_(impacto, esUrgente) {
  var base = MAPA_IMPACTO_PRIORIDAD[impacto] || PRIORIDAD_POR_DEFECTO;
  if (esUrgente && ORDEN_PRIORIDAD.indexOf(base) > ORDEN_PRIORIDAD.indexOf('P2')) {
    return 'P2';
  }
  return base;
}

// Resuelve CAT_TIPOS.es_urgente para un tipo_id dado. Si el catalogo aun no
// existe (instalacion incompleta) o el tipo no tiene match, no bloquea la
// creacion de la solicitud: se asume que no es urgente por tipo (el
// impacto declarado sigue derivando la prioridad igual).
function tipoEsUrgente_(tipoId) {
  var filas;
  try {
    filas = leerFilas_(SHEETS.CAT_TIPOS);
  } catch (err) {
    return false;
  }
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].tipo_id === tipoId) {
      var valor = filas[i].es_urgente;
      return valor === true || valor === 'TRUE' || valor === 1;
    }
  }
  return false;
}

function prioridadMasCritica_(listaPrioridades) {
  return listaPrioridades.reduce(function (masCritica, actual) {
    return ORDEN_PRIORIDAD.indexOf(actual) < ORDEN_PRIORIDAD.indexOf(masCritica) ? actual : masCritica;
  }, 'P5');
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

// Formato exacto de RF-015 (doc 3.5 de v1.0). Regla de multiples items
// (RF-F07, ya incorporada en v1.1 §20.4): con mas de un item se indica la
// cantidad en vez de listarlos, el detalle completo va en el correo.
// Fase 10: "Modulo" muestra el del primer item (modulo ya no es un campo
// unico de la solicitud); si hay varios tipos/modulos el detalle completo
// sigue estando en el correo/panel, no en este resumen corto.
function generarResumenWhatsapp_(solicitudId, data, prioridad) {
  var primerItem = data.subsolicitudes[0] || {};
  var resumen;
  if (data.subsolicitudes.length === 1) {
    resumen = String(primerItem.descripcion || '').slice(0, 150);
  } else {
    resumen = data.subsolicitudes.length + ' items — ver detalle en correo';
  }

  return [
    '📋 SOLICITUD N° ' + solicitudId,
    (PRIORIDAD_EMOJI[prioridad] || '') + ' PRIORIDAD: ' + (PRIORIDAD_ETIQUETA[prioridad] || prioridad),
    '🏢 Empresa: ' + data.empresa_id,
    '💻 Sistema: ' + data.plataforma,
    '📦 Modulo: ' + (primerItem.modulo || ''),
    '👤 Solicitante: ' + data.solicitante_nombre,
    '📝 Resumen: ' + resumen,
    '📧 Revisar correo para detalle completo.'
  ].join('\n');
}
