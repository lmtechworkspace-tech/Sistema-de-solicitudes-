/**
 * Quejas.gs (Backoffice) — v10.0 Fase 4, PRO-07.
 *
 * Las Partes 2 a 5 del FO-PRO-07-01, sobre la fila que ya creó el
 * formulario público (Intake/Quejas.gs, Parte 1). Mismo patrón de "una
 * fila = un formulario completo" que SGC_NC y SGC_AUDITORIAS: partirlo
 * obligaría a reconstruir el caso con joins para responder la pregunta que
 * siempre se hace ("muéstreme esta queja de punta a punta").
 *
 * El ciclo, en el orden que impone PRO-07:
 *
 *   RECIBIDA ──registrar recepción──► EN_INVESTIGACION ──investigar──► EN_RESOLUCION
 *      │                                    │                              │
 *   (Parte 1,                          NO_VALIDA (cierra)            RESUELTA
 *    ya la llenó                       si no procede                      │
 *    el cliente)                       NO_PROCEDE (cierra)          NOTIFICADA
 *                                                                          │
 *                                                                   CERRADA / REABIERTA
 *
 * DOS DECISIONES QUE VALE LA PENA EXPLICAR
 *
 * 1) El investigador NO puede ser del área que originó la queja (PRO-07
 *    §6.2: "la investigación deberá ser realizada por una o varias
 *    personas que no hayan participado en las actividades que dieron
 *    origen a la queja"). Es el mismo principio de imparcialidad que ya
 *    se aplica en auditoría interna (§9.2.2), y se valida igual: contra
 *    el área del rol SGC de la persona.
 *
 * 2) Cuando la resolución requiere abrir una no conformidad, se crea con
 *    NoConformidades.crear (fuente QUEJA, origen_ref = queja_id) -- mismo
 *    eslabón que ya conecta auditoría → hallazgo → NC. Desde ahí sigue el
 *    ciclo normal de la Fase 3a hasta una ACTIVIDAD real en "Mi trabajo".
 */

var Quejas = {

  listar: function (data, contexto) {
    var filtros = data || {};
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    var email = normalizarEmailSgc_(contexto.email);

    var todas = leerFilasSeguro_(SHEETS.SGC_QUEJAS).filter(esActivoSgc_);
    // Una queja no es un documento público: quien gobierna el SGC (y
    // Dirección/Gerencia) ve todas; el investigador asignado ve la suya.
    var visibles = todas.filter(function (q) {
      if (veTodoSgc_(contexto, rol, gobierna)) return true;
      return normalizarEmailSgc_(q.investigador_email) === email;
    });

    if (filtros.estado) {
      visibles = visibles.filter(function (q) { return q.estado === filtros.estado; });
    }
    if (filtros.abiertas) {
      visibles = visibles.filter(function (q) { return ESTADOS_QUEJA_ABIERTOS.indexOf(q.estado) !== -1; });
    }

    var ahora = new Date();
    return {
      puede_gestionar: gobierna,
      indicadores: indicadoresQueja_(todas, ahora),
      quejas: visibles.map(function (q) { return resumenQueja_(q, ahora); })
        .sort(function (a, b) { return new Date(b.fecha_envio || 0) - new Date(a.fecha_envio || 0); })
    };
  },

  getDetalle: function (data, contexto) {
    var queja = buscarQueja_(data.queja_id);
    if (!queja) return errorValidacion_('queja_id', 'Queja no encontrada.');
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    var email = normalizarEmailSgc_(contexto.email);
    if (!veTodoSgc_(contexto, rol, gobierna) && normalizarEmailSgc_(queja.investigador_email) !== email) {
      return { _forbidden: true, message: 'No tienes acceso a esta queja.' };
    }
    var nc = queja.nc_id ? leerFilasSeguro_(SHEETS.SGC_NC).filter(function (n) { return n.nc_id === queja.nc_id; })[0] : null;

    return {
      queja: queja,
      puede_gestionar: gobierna,
      puede_investigar: gobierna || normalizarEmailSgc_(queja.investigador_email) === email,
      resumen: resumenQueja_(queja, new Date()),
      nc_correlativo: nc ? nc.correlativo : '',
      nc_estado: nc ? nc.estado : ''
    };
  },

  // --- 2) Registro interno: ¿procede? -----------------------------------------
  registrarRecepcion: function (data, contexto) {
    var queja = buscarQueja_(data.queja_id);
    if (!queja) return errorValidacion_('queja_id', 'Queja no encontrada.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden registrar la recepción.' };
    }
    if (queja.estado !== 'RECIBIDA') {
      return errorValidacion_('queja_id', 'Esta queja ya fue procesada.');
    }
    var procede = esVerdaderoSgc_(data.procede);
    if (!procede && !String(data.motivo_no_procede || '').trim()) {
      return errorValidacion_('motivo_no_procede', 'Si no procede, explica por qué (fuera de plazo, servicio suspendido, etc.).');
    }
    var ahora = new Date().toISOString();
    var actualizada = actualizarFilaPorId_(SHEETS.SGC_QUEJAS, 'queja_id', queja.queja_id, {
      fecha_recepcion: ahora,
      procede: procede,
      motivo_no_procede: procede ? '' : String(data.motivo_no_procede || '').trim(),
      registrado_por: normalizarEmailSgc_(contexto.email),
      estado: procede ? 'EN_INVESTIGACION' : 'NO_PROCEDE',
      fecha_cierre: procede ? '' : ahora,
      cerrada_por: procede ? '' : normalizarEmailSgc_(contexto.email)
    });
    registrarLogSgc_('SGC_QUEJA_RECEPCION', queja.correlativo + ': ' + (procede ? 'procede' : 'no procede'), contexto);
    if (!procede) {
      enviarCorreo_('SGC_QUEJA', queja.email, 'SGC_QUEJA_NO_PROCEDE:' + queja.queja_id,
        'HomePymes — Sobre tu mensaje ' + queja.correlativo,
        'Hola ' + queja.nombre_completo + ',\n\nRevisamos tu mensaje (' + queja.correlativo + ') y no corresponde ' +
        'procesarlo como queja formal.\n\nMotivo: ' + actualizada.motivo_no_procede,
        null, { htmlBody: plantillaCorreoHtml_('Sobre tu mensaje',
          '<p>Hola ' + escaparHtmlCorreo_(queja.nombre_completo) + ',</p>' +
          '<p>Revisamos tu mensaje (<strong>' + escaparHtmlCorreo_(queja.correlativo) + '</strong>) y no corresponde procesarlo como queja formal.</p>' +
          '<p><strong>Motivo:</strong> ' + escaparHtmlCorreo_(actualizada.motivo_no_procede) + '</p>') });
    }
    return actualizada;
  },

  // --- 3) Investigación (imparcialidad: PRO-07 §6.2) --------------------------
  registrarInvestigacion: function (data, contexto) {
    var queja = buscarQueja_(data.queja_id);
    if (!queja) return errorValidacion_('queja_id', 'Queja no encontrada.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden asignar la investigación.' };
    }
    if (queja.estado !== 'EN_INVESTIGACION') {
      return errorValidacion_('queja_id', 'Esta queja no está en etapa de investigación.');
    }
    var investigador = normalizarEmailSgc_(data.investigador_email);
    if (!investigador) return errorValidacion_('investigador_email', 'Asigna quién investiga.');
    var conflicto = investigadorConConflicto_(investigador, queja.area);
    if (conflicto) return conflicto;

    return actualizarFilaPorId_(SHEETS.SGC_QUEJAS, 'queja_id', queja.queja_id, {
      investigador_email: investigador
    });
  },

  // Se separa de la asignación: el Encargado SGC asigna primero, y el
  // investigador (o el propio Encargado) vuelve después con el resultado
  // -- no siempre se sabe de entrada si va a ser válida o no.
  registrarResultado: function (data, contexto) {
    var queja = buscarQueja_(data.queja_id);
    if (!queja) return errorValidacion_('queja_id', 'Queja no encontrada.');
    if (!puedeInvestigarQueja_(queja, contexto)) {
      return { _forbidden: true, message: 'Solo el investigador asignado o el Encargado SGC pueden registrar el resultado.' };
    }
    if (queja.estado !== 'EN_INVESTIGACION') {
      return errorValidacion_('queja_id', 'Esta queja no está en etapa de investigación.');
    }
    if (!queja.investigador_email) {
      return errorValidacion_('queja_id', 'Primero asigna quién investiga.');
    }
    var resultado = String(data.resultado_investigacion || '').trim();
    if (!resultado) return errorValidacion_('resultado_investigacion', 'Describe el resultado de la investigación.');
    var valida = esVerdaderoSgc_(data.valida);
    var ahora = new Date();

    var cambios = {
      resultado_investigacion: resultado,
      valida: valida,
      estado: valida ? 'EN_RESOLUCION' : 'NO_VALIDA'
    };
    if (valida) {
      // PRO-07: 30 días CORRIDOS desde la validación hasta el cierre.
      cambios.resolucion_plazo = sumarDiasCorridosQueja_(ahora, DIAS_RESOLUCION_QUEJA);
    } else {
      if (!String(data.justificacion || '').trim()) {
        return errorValidacion_('justificacion', 'Si la queja no es válida, explica por qué: se adjunta a la respuesta del cliente.');
      }
      cambios.accion_implementada = String(data.justificacion || '').trim();
      cambios.fecha_cierre = ahora.toISOString();
      cambios.cerrada_por = normalizarEmailSgc_(contexto.email);
    }
    var actualizada = actualizarFilaPorId_(SHEETS.SGC_QUEJAS, 'queja_id', queja.queja_id, cambios);
    registrarLogSgc_('SGC_QUEJA_INVESTIGADA', queja.correlativo + ': ' + (valida ? 'válida' : 'no válida'), contexto);

    if (!valida) {
      enviarCorreo_('SGC_QUEJA', queja.email, 'SGC_QUEJA_NO_VALIDA:' + queja.queja_id,
        'HomePymes — Resultado de tu mensaje ' + queja.correlativo,
        'Hola ' + queja.nombre_completo + ',\n\nRevisamos tu mensaje (' + queja.correlativo + ') y, tras la investigación, ' +
        'no encontramos elementos que la validen.\n\n' + cambios.accion_implementada,
        null, { htmlBody: plantillaCorreoHtml_('Resultado de tu mensaje',
          '<p>Hola ' + escaparHtmlCorreo_(queja.nombre_completo) + ',</p>' +
          '<p>Revisamos tu mensaje (<strong>' + escaparHtmlCorreo_(queja.correlativo) + '</strong>) y, tras la investigación, no encontramos elementos que la validen.</p>' +
          '<p>' + escaparHtmlCorreo_(cambios.accion_implementada) + '</p>') });
    }
    return actualizada;
  },

  // --- 4) Resolución (plazo 30 días CORRIDOS desde la validación) -------------
  registrarResolucion: function (data, contexto) {
    var queja = buscarQueja_(data.queja_id);
    if (!queja) return errorValidacion_('queja_id', 'Queja no encontrada.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden registrar la resolución.' };
    }
    if (queja.estado !== 'EN_RESOLUCION') {
      return errorValidacion_('queja_id', 'Esta queja no está en etapa de resolución.');
    }
    var accion = String(data.accion_implementada || '').trim();
    if (!accion) return errorValidacion_('accion_implementada', 'Describe la acción o corrección implementada.');

    return actualizarFilaPorId_(SHEETS.SGC_QUEJAS, 'queja_id', queja.queja_id, {
      accion_implementada: accion,
      fecha_resolucion: data.fecha_resolucion || new Date().toISOString(),
      responsable_resolucion: normalizarEmailSgc_(contexto.email),
      estado: 'RESUELTA'
    });
  },

  // El eslabón que conecta con la Fase 3a: mismo patrón que el hallazgo de
  // auditoría que se convierte en no conformidad.
  convertirEnNc: function (data, contexto) {
    var queja = buscarQueja_(data.queja_id);
    if (!queja) return errorValidacion_('queja_id', 'Queja no encontrada.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden levantar no conformidades.' };
    }
    if (queja.nc_id) return errorValidacion_('queja_id', 'Esta queja ya tiene su no conformidad.');
    if (ESTADOS_QUEJA_ABIERTOS.indexOf(queja.estado) === -1) {
      return errorValidacion_('queja_id', 'La queja tiene que estar en curso para levantar una no conformidad.');
    }
    var responsable = normalizarEmailSgc_(data.responsable_email) || normalizarEmailSgc_(queja.investigador_email);
    if (!responsable) return errorValidacion_('responsable_email', 'Asigna un responsable para la no conformidad.');

    var nc = NoConformidades.crear({
      descripcion: queja.descripcion,
      fuente: 'QUEJA',
      origen_ref: queja.queja_id,
      area_id: queja.area,
      responsable_email: responsable,
      fecha_deteccion: queja.fecha_envio
    }, contexto);
    if (nc && (nc._validationError || nc._forbidden)) return nc;

    actualizarFilaPorId_(SHEETS.SGC_QUEJAS, 'queja_id', queja.queja_id, { nc_id: nc.nc_id });
    registrarLogSgc_('SGC_QUEJA_A_NC', queja.correlativo + ' -> ' + nc.correlativo, contexto);
    return { queja_id: queja.queja_id, nc: nc };
  },

  // --- 5) Notificación y seguimiento -------------------------------------------
  registrarNotificacion: function (data, contexto) {
    var queja = buscarQueja_(data.queja_id);
    if (!queja) return errorValidacion_('queja_id', 'Queja no encontrada.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden notificar al cliente.' };
    }
    if (queja.estado !== 'RESUELTA') {
      return errorValidacion_('queja_id', 'Primero registra la resolución.');
    }
    var revisadoPor = normalizarEmailSgc_(data.revisado_por);
    if (!revisadoPor) return errorValidacion_('revisado_por', 'Indica quién revisó y aprobó la respuesta.');

    var ahora = new Date();
    var actualizada = actualizarFilaPorId_(SHEETS.SGC_QUEJAS, 'queja_id', queja.queja_id, {
      fecha_notificacion: ahora.toISOString(),
      revisado_por: revisadoPor,
      // PRO-07: seguimiento 30 días CORRIDOS después de la respuesta final.
      seguimiento_plazo: sumarDiasCorridosQueja_(ahora, DIAS_SEGUIMIENTO_QUEJA),
      estado: 'NOTIFICADA'
    });
    registrarLogSgc_('SGC_QUEJA_NOTIFICADA', queja.correlativo, contexto);

    enviarCorreo_('SGC_QUEJA', queja.email, 'SGC_QUEJA_RESPUESTA:' + queja.queja_id,
      'HomePymes — Respuesta a tu mensaje ' + queja.correlativo,
      'Hola ' + queja.nombre_completo + ',\n\nEsto es lo que hicimos con tu mensaje (' + queja.correlativo + '):\n\n' +
      queja.accion_implementada,
      null, { htmlBody: plantillaCorreoHtml_('Respuesta a tu mensaje',
        '<p>Hola ' + escaparHtmlCorreo_(queja.nombre_completo) + ',</p>' +
        '<p>Esto es lo que hicimos con tu mensaje (<strong>' + escaparHtmlCorreo_(queja.correlativo) + '</strong>):</p>' +
        '<p>' + escaparHtmlCorreo_(queja.accion_implementada) + '</p>') });
    return actualizada;
  },

  registrarSeguimiento: function (data, contexto) {
    var queja = buscarQueja_(data.queja_id);
    if (!queja) return errorValidacion_('queja_id', 'Queja no encontrada.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden registrar el seguimiento.' };
    }
    if (queja.estado !== 'NOTIFICADA') {
      return errorValidacion_('queja_id', 'Primero notifica la respuesta al cliente.');
    }
    var conforme = esVerdaderoSgc_(data.cliente_conforme);
    var ahora = new Date().toISOString();
    if (conforme) {
      var cerrada = actualizarFilaPorId_(SHEETS.SGC_QUEJAS, 'queja_id', queja.queja_id, {
        fecha_seguimiento: ahora, cliente_conforme: true,
        estado: 'CERRADA', fecha_cierre: ahora, cerrada_por: normalizarEmailSgc_(contexto.email)
      });
      registrarLogSgc_('SGC_QUEJA_CERRADA', queja.correlativo, contexto);
      return cerrada;
    }
    // No conforme: se reabre. Igual que una NC con eficacia negativa, no se
    // borra nada de lo anterior -- queda en el log y en la fila.
    var reabierta = actualizarFilaPorId_(SHEETS.SGC_QUEJAS, 'queja_id', queja.queja_id, {
      fecha_seguimiento: ahora, cliente_conforme: false, estado: 'REABIERTA'
    });
    registrarLogSgc_('SGC_QUEJA_REABIERTA', queja.correlativo, contexto);
    return reabierta;
  },

  anular: function (data, contexto) {
    var queja = buscarQueja_(data.queja_id);
    if (!queja) return errorValidacion_('queja_id', 'Queja no encontrada.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden anular una queja.' };
    }
    var motivo = String(data.motivo || '').trim();
    if (!motivo) return errorValidacion_('motivo', 'Explica por qué se anula: queda en el registro.');
    if (queja.estado === 'CERRADA') {
      return errorValidacion_('queja_id', 'Una queja cerrada no se anula.');
    }
    var anulada = actualizarFilaPorId_(SHEETS.SGC_QUEJAS, 'queja_id', queja.queja_id, {
      estado: 'ANULADA', fecha_cierre: new Date().toISOString(), cerrada_por: normalizarEmailSgc_(contexto.email)
    });
    registrarLogSgc_('SGC_QUEJA_ANULADA', queja.correlativo + ': ' + motivo, contexto);
    return anulada;
  }
};

// --- avisos diarios ---------------------------------------------------------
// Cuelga del trigger de las 09:00 (Triggers.gs), sin gastar un slot nuevo.
//
// Dos plazos, ambos en dias CORRIDOS (a diferencia de PRO-03/PRO-06 que usan
// dias habiles -- PRO-07 lo especifica asi explicitamente):
//   resolucion vencida (30d corridos desde validar) -> Encargado SGC, diario
//   seguimiento vencido (30d corridos desde notificar) -> Encargado SGC, diario
Quejas.recordatorioPendientes = function () {
  var todas = leerFilasSeguro_(SHEETS.SGC_QUEJAS).filter(esActivoSgc_);
  var ahora = new Date();
  var hoy = ahora.toISOString().slice(0, 10);
  var encargados = encargadosSgc_();
  var avisos = 0;

  function avisarVencidas_(lista, clave, tituloCorreo, etiquetaPlazo) {
    if (!lista.length) return;
    var items = lista.map(function (q) {
      return '<li><strong>' + escaparHtmlCorreo_(q.correlativo) + '</strong> — ' +
        escaparHtmlCorreo_(q.nombre_completo) + '</li>';
    }).join('');
    var texto = 'Estas quejas tienen ' + etiquetaPlazo + ' vencido:\n' +
      lista.map(function (q) { return '- ' + q.correlativo + ' (' + q.nombre_completo + ')'; }).join('\n') +
      '\n\nEntra a SIGSO > Calidad > Quejas.';
    var html = plantillaCorreoHtml_(tituloCorreo,
      '<p>Estas quejas tienen <strong>' + escaparHtmlCorreo_(etiquetaPlazo) + '</strong> vencido:</p>' +
      '<ul style="margin:0 0 12px 18px;padding:0;">' + items + '</ul>');
    encargados.forEach(function (email) {
      var r = enviarCorreo_('SGC_QUEJA', email, clave + ':' + hoy, 'SIGSO - ' + tituloCorreo, texto, null, { htmlBody: html });
      if (r && r.enviado) avisos++;
      encolarNotificacionApp_(email, 'SGC_QUEJA', tituloCorreo, lista.length + ' queja(s) con plazo vencido.', 'calidad', 'Ver quejas', 72);
    });
  }

  avisarVencidas_(
    todas.filter(function (q) { return q.estado === 'EN_RESOLUCION' && q.resolucion_plazo && new Date(q.resolucion_plazo) < ahora; }),
    'SGC_QUEJA_RESOLUCION_VENCIDA', 'Quejas con plazo de resolución vencido', 'el plazo de resolución (30 días corridos)'
  );
  avisarVencidas_(
    todas.filter(function (q) { return q.estado === 'NOTIFICADA' && q.seguimiento_plazo && new Date(q.seguimiento_plazo) < ahora; }),
    'SGC_QUEJA_SEGUIMIENTO_VENCIDO', 'Quejas con seguimiento pendiente', 'el plazo de seguimiento (30 días corridos)'
  );

  return { avisos: avisos };
};

// --- constantes -------------------------------------------------------------

var ESTADOS_QUEJA_ABIERTOS = ['RECIBIDA', 'EN_INVESTIGACION', 'EN_RESOLUCION', 'RESUELTA', 'NOTIFICADA', 'REABIERTA'];
// PRO-07 §6.1 c.4: desde la validacion hasta el cierre, maximo 30 dias
// CORRIDOS (no habiles -- el procedimiento lo especifica asi, a diferencia
// de PRO-03/PRO-06).
var DIAS_RESOLUCION_QUEJA = 30;
// PRO-07 §6.1 c.7: seguimiento 30 dias corridos desde la respuesta final.
var DIAS_SEGUIMIENTO_QUEJA = 30;

// --- helpers ------------------------------------------------------------------

function buscarQueja_(quejaId) {
  if (!quejaId) return null;
  var filas = leerFilasSeguro_(SHEETS.SGC_QUEJAS);
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].queja_id === quejaId && esActivoSgc_(filas[i])) return filas[i];
  }
  return null;
}

function puedeInvestigarQueja_(queja, contexto) {
  if (gobiernaSgc_(contexto, rolSgc_(contexto))) return true;
  return normalizarEmailSgc_(queja.investigador_email) === normalizarEmailSgc_(contexto && contexto.email);
}

// PRO-07 §6.2: "la investigación deberá ser realizada por una o varias
// personas que no hayan participado en las actividades que dieron origen a
// la queja". Se valida contra el área declarada en el rol SGC -- mismo
// principio que el conflicto de interés de auditoría interna (§9.2.2).
function investigadorConConflicto_(investigadorEmail, areaQueja) {
  if (!areaQueja) return null;
  if (areaSgc_({ email: investigadorEmail }) === areaQueja) {
    return errorValidacion_('investigador_email',
      'Esa persona pertenece al área que originó la queja: no puede investigar su propio trabajo (PRO-07 §6.2).');
  }
  return null;
}

// Dias CORRIDOS (no habiles): PRO-07 los especifica asi, a diferencia de
// PRO-03/PRO-06. Fin del dia (23:59:59 UTC) para que "vence hoy" cuente
// como vencido recien despues, igual criterio que sumarDiasHabilesSgc_.
function sumarDiasCorridosQueja_(desde, dias) {
  var f = new Date(desde);
  if (isNaN(f.getTime())) return '';
  var r = new Date(f.getTime());
  r.setDate(r.getDate() + dias);
  r.setUTCHours(23, 59, 59, 0);
  return r.toISOString();
}

function plazoActualQueja_(queja) {
  if (queja.estado === 'EN_RESOLUCION') return { etapa: 'Resolución', plazo: queja.resolucion_plazo };
  if (queja.estado === 'NOTIFICADA') return { etapa: 'Seguimiento', plazo: queja.seguimiento_plazo };
  return { etapa: '', plazo: '' };
}

function resumenQueja_(queja, ahora) {
  var venc = plazoActualQueja_(queja);
  var dias = venc.plazo ? Math.ceil((new Date(venc.plazo) - ahora) / 86400000) : null;
  return {
    queja_id: queja.queja_id,
    correlativo: queja.correlativo,
    nombre_completo: queja.nombre_completo,
    empresa: queja.empresa,
    tipo: queja.tipo,
    area: queja.area,
    canal: queja.canal,
    descripcion: queja.descripcion,
    fecha_envio: queja.fecha_envio,
    estado: queja.estado,
    investigador_email: queja.investigador_email,
    etapa_actual: venc.etapa,
    plazo_actual: venc.plazo,
    dias_para_plazo: dias,
    vencida: dias !== null && dias < 0 && ESTADOS_QUEJA_ABIERTOS.indexOf(queja.estado) !== -1,
    tiene_nc: !!queja.nc_id
  };
}

// Indicadores que responde el Objetivo de Calidad N°2 (DOC-07: "< 2% de
// reclamos sobre total de servicios") y lo que la revision por la
// direccion (Fase 5) va a necesitar mostrar.
function indicadoresQueja_(todas, ahora) {
  var anio = ahora.getFullYear();
  var delAnio = todas.filter(function (q) {
    var f = new Date(q.fecha_envio);
    return !isNaN(f.getTime()) && f.getFullYear() === anio;
  });
  var abiertas = todas.filter(function (q) { return ESTADOS_QUEJA_ABIERTOS.indexOf(q.estado) !== -1; });
  var vencidas = abiertas.filter(function (q) {
    var venc = plazoActualQueja_(q);
    return venc.plazo && new Date(venc.plazo) < ahora;
  });
  return {
    total_anio: delAnio.length,
    quejas_anio: delAnio.filter(function (q) { return q.tipo === 'QUEJA' || q.tipo === 'RECLAMACION'; }).length,
    felicitaciones_anio: delAnio.filter(function (q) { return q.tipo === 'FELICITACION'; }).length,
    consultas_anio: delAnio.filter(function (q) { return q.tipo === 'CONSULTA'; }).length,
    abiertas: abiertas.length,
    vencidas: vencidas.length,
    cerradas: todas.filter(function (q) { return q.estado === 'CERRADA'; }).length
  };
}
