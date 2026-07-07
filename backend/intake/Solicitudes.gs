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
      var prioridad = derivarPrioridad_(item.impacto);
      var slaHoras = obtenerSlaHoras_(prioridad);
      var subId = solicitudId + '-' + ('0' + (idx + 1)).slice(-2);

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
        imagen_descripciones: JSON.stringify(item.imagen_descripciones || [])
      });

      return { subsolicitud_id: subId, prioridad: prioridad };
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
    // Aviso al equipo de desarrollo (Leo): cliente SIEMPRE (es prioridad
    // alta), interna solo si el solicitante lo pidio (avisar_leo), y
    // cualquier P1 sin importar el origen.
    var motivoAviso = data.es_cliente ? 'solicitud de cliente'
      : (prioridadDerivada === 'P1' ? 'prioridad critica P1'
        : (data.avisar_leo ? 'el solicitante pidio avisar' : ''));
    if (motivoAviso) {
      Notificaciones.enviarAvisoDesarrollo({
        solicitud_id: solicitudId,
        prioridad: prioridadDerivada,
        resumen_whatsapp: resumenWhatsapp
      }, motivoAviso);
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
        return {
          numero_item: s.numero_item,
          titulo: s.titulo,
          estado: s.estado,
          prioridad: s.prioridad,
          tipo_nombre: s.tipo_nombre || '',
          modulo_nombre: s.modulo_nombre || '',
          descripcion: s.descripcion || '',
          resultado_esperado: s.resultado_esperado || '',
          contexto: s.contexto || ''
        };
      });

    return {
      solicitud_id: solicitud.solicitud_id,
      estado_derivado: solicitud.estado_derivado,
      prioridad_derivada: solicitud.prioridad_derivada,
      fecha_creacion: solicitud.fecha_creacion,
      doc_estado: solicitud.doc_estado,
      url_pdf: solicitud.url_pdf,
      subsolicitudes: subsolicitudes
    };
  }
};

function errorValidacion_(campo, mensaje) {
  return { _validationError: true, message: mensaje, fields: [{ campo: campo, mensaje: mensaje }] };
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

function derivarPrioridad_(impacto) {
  return MAPA_IMPACTO_PRIORIDAD[impacto] || PRIORIDAD_POR_DEFECTO;
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
