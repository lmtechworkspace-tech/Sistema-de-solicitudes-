/**
 * Notificaciones.gs — App Gestion: cambio de estado, aviso al desarrollador
 * y alerta de fallo de documento (A-05, A-06), alertas de SLA (A-08/09,
 * Fase 7), mas la cola de reintentos por cuota (A-12). Duplica el nucleo de
 * envio/dedup con backend/intake/Notificaciones.gs (ver nota de
 * duplicacion en Config.gs).
 */

var VENTANA_DEDUP_MINUTOS = 30;
// RN-027: "SLA vencido notifica 1 vez/dia" -- se aproxima con una ventana
// deslizante de 24h (mas simple que anclar al dia calendario de Chile, y
// cumple igual la intencion de no saturar de correos).
var VENTANA_DEDUP_SLA_VENCIDO_MINUTOS = 24 * 60;
var MAX_REINTENTOS_CORREO = 3;

var Notificaciones = {
  // Fase 10.2 (optimizacion, feedback real: "el cambio de estado tarda
  // mucho"): a diferencia del resto de enviarCorreo_ (que intenta enviar en
  // el momento), este correo se ENCOLA directo -- actualizarEstado ya no
  // espera el envio sincrono a Gmail (el mayor costo de tiempo de esa
  // accion). Lo entrega procesarColaCorreoTrigger, que ya corre cada 5 min
  // (Triggers.gs); la demora maxima es esa ventana, nunca inmediata pero
  // tampoco un problema real para un aviso informativo de cambio de estado.
  notificarCambioEstado: function (solicitudId, subsolicitudId, estadoAnterior, estadoNuevo) {
    var solicitud = buscarSolicitudPorId_(solicitudId);
    if (!solicitud) {
      return { enviado: false, motivo: 'solicitud_no_encontrada' };
    }
    if (!solicitud.solicitante_email) {
      return { enviado: false, motivo: 'sin_destinatario' };
    }
    var asunto = 'SIGSO — Actualización de su solicitud ' + solicitudId;
    var cuerpo =
      'Estimado/a ' + (solicitud.solicitante_nombre || '') + ':\n\n' +
      'Le informamos que su solicitud ha registrado un cambio de estado en el sistema.\n\n' +
      'DETALLE\n' +
      '- N° de solicitud: ' + solicitudId + '\n' +
      '- Estado anterior: ' + formatearEstado_(estadoAnterior) + '\n' +
      '- Estado nuevo: ' + formatearEstado_(estadoNuevo) + '\n\n' +
      'Puede revisar el detalle completo en la página de Consultar Estado del sistema.' +
      pieCorreoBackoffice_();
    var evento = 'CAMBIO_ESTADO:' + subsolicitudId + ':' + estadoNuevo;
    if (yaNotificadoRecientemente_(solicitudId, evento, solicitud.solicitante_email)) {
      return { enviado: false, motivo: 'deduplicado' };
    }
    registrarNotificacion_(solicitudId, 'EMAIL', solicitud.solicitante_email, evento, 'PENDIENTE_REINTENTO', 0, asunto, cuerpo);
    return { encolado: true };
  },

  // v3.1 (§2.5): sin este aviso la derivacion es invisible y el trabajo se
  // pierde -- quien lo recibe no tiene forma de enterarse salvo mirando su
  // bandeja por casualidad.
  //
  // `derivadas` es la lista que devuelve derivarUna_ (una entrada por
  // solicitud). El aviso al nuevo responsable va AGRUPADO: derivar 40
  // solicitudes de una vez no debe producir 40 correos. El registro en
  // HISTORIAL_ASIGNACION, en cambio, ya quedo fila por fila.
  notificarDerivacion: function (derivadas, responsableNuevo, motivo, usuario) {
    if (!derivadas || !derivadas.length || !responsableNuevo) {
      return { enviado: false, motivo: 'sin_destinatario' };
    }

    var ids = derivadas.map(function (d) { return d.solicitud_id; });
    var esLote = ids.length > 1;
    var listado = derivadas.map(function (d) {
      var titulo = d.solicitud && d.solicitud.titulo ? ' — ' + d.solicitud.titulo : '';
      var item = d.subsolicitud_id ? ' (ítem ' + d.subsolicitud_id + ')' : '';
      return '- ' + d.solicitud_id + item + titulo;
    }).join('\n');

    var asunto = esLote
      ? 'SIGSO — Se te derivaron ' + ids.length + ' solicitudes'
      : 'SIGSO — Se te derivó la solicitud ' + ids[0];
    var cuerpo =
      'Estimado/a:\n\n' +
      (esLote
        ? 'Se han derivado ' + ids.length + ' solicitudes a tu bandeja:'
        : 'Se ha derivado la siguiente solicitud a tu bandeja:') + '\n\n' +
      listado + '\n\n' +
      'DETALLE\n' +
      '- Derivada por: ' + usuario + '\n' +
      '- Motivo: ' + motivo + '\n\n' +
      'Ya aparece' + (esLote ? 'n' : '') + ' en tu bandeja del Backoffice.' +
      pieCorreoBackoffice_();

    // El evento incluye los ids para que la deduplicacion no confunda dos
    // derivaciones distintas hechas con poca diferencia de tiempo.
    var evento = 'DERIVACION:' + ids.join(',');
    var avisoNuevo = enviarCorreo_(ids[0], responsableNuevo, evento, asunto, cuerpo);

    // Acuse al responsable anterior: solo si es una persona distinta y hay
    // uno solo (en un lote mixto no hay "un" anterior a quien avisarle).
    var anteriores = derivadas
      .map(function (d) { return d.responsable_anterior; })
      .filter(function (email, i, todos) {
        return email && email !== responsableNuevo && todos.indexOf(email) === i;
      });
    var avisosAnterior = anteriores.map(function (email) {
      return enviarCorreo_(
        ids[0], email, 'DERIVACION_SALIDA:' + ids.join(','),
        esLote
          ? 'SIGSO — ' + ids.length + ' solicitudes salieron de tu bandeja'
          : 'SIGSO — La solicitud ' + ids[0] + ' salió de tu bandeja',
        'Estimado/a:\n\n' +
        (esLote ? 'Las siguientes solicitudes fueron derivadas' : 'La siguiente solicitud fue derivada') +
        ' a ' + responsableNuevo + ':\n\n' + listado + '\n\n' +
        'DETALLE\n' +
        '- Derivada por: ' + usuario + '\n' +
        '- Motivo: ' + motivo + '\n\n' +
        'Ya no aparece' + (esLote ? 'n' : '') + ' en tu bandeja.' +
        pieCorreoBackoffice_()
      );
    });

    return { nuevo: avisoNuevo, anteriores: avisosAnterior };
  },

  notificarDesarrollador: function (solicitud) {
    var destinatarios = obtenerEmailsPorRol_(solicitud.empresa_id, ['DEV']);
    return destinatarios.map(function (email) {
      var asunto = 'SIGSO - Documento listo: ' + solicitud.solicitud_id;
      var cuerpo = 'El documento de la solicitud ' + solicitud.solicitud_id + ' ya esta generado: ' + solicitud.url_pdf;
      return enviarCorreo_(solicitud.solicitud_id, email, 'DOC_LISTO', asunto, cuerpo);
    });
  },

  // A-08 (§13/17.4 v1.0): SLA >= 80% y aun no vencido. Llamada desde
  // Triggers.verificarSLAs() (diario 09:00).
  alertaSLAProximo: function (subsolicitud, solicitud) {
    var destinatarios = obtenerEmailsPorRol_(solicitud.empresa_id, ['ANA', 'ADM']);
    return destinatarios.map(function (email) {
      var asunto = 'SIGSO - SLA proximo a vencer: ' + subsolicitud.subsolicitud_id;
      var cuerpo =
        'La subsolicitud ' + subsolicitud.subsolicitud_id + ' (solicitud ' + solicitud.solicitud_id +
        ') ya supero el 80% de su SLA objetivo (' + subsolicitud.sla_objetivo_horas + ' horas habiles).';
      return enviarCorreo_(solicitud.solicitud_id, email, 'SLA_PROXIMO:' + subsolicitud.subsolicitud_id, asunto, cuerpo);
    });
  },

  // A-09 (§13/17.4 v1.0): SLA > 100%. RN-027: como mucho 1 email por dia
  // por destinatario mientras la subsolicitud siga vencida.
  alertaSLAVencido: function (subsolicitud, solicitud) {
    var destinatarios = obtenerEmailsPorRol_(solicitud.empresa_id, ['ANA', 'ADM']);
    return destinatarios.map(function (email) {
      var asunto = 'SIGSO - SLA VENCIDO: ' + subsolicitud.subsolicitud_id;
      var cuerpo =
        'La subsolicitud ' + subsolicitud.subsolicitud_id + ' (solicitud ' + solicitud.solicitud_id +
        ') supero su SLA objetivo (' + subsolicitud.sla_objetivo_horas + ' horas habiles).';
      return enviarCorreo_(
        solicitud.solicitud_id, email, 'SLA_VENCIDO:' + subsolicitud.subsolicitud_id, asunto, cuerpo,
        VENTANA_DEDUP_SLA_VENCIDO_MINUTOS
      );
    });
  },

  // v2.1 (Fase D, §8): avisa al solicitante cuando el desarrollador se
  // compromete (o re-compromete) a una fecha -- "maneja expectativas, sin
  // pedir su aprobacion" (la fecha del desarrollador es la definitiva, ver
  // §2.1 de la especificacion). El evento incluye la fecha nueva para que
  // un re-compromiso a una fecha distinta genere un aviso nuevo (no lo
  // deduplica contra el aviso del compromiso anterior).
  avisarCompromisoFecha: function (solicitud, subsolicitud, fechaComprometida) {
    if (!solicitud.solicitante_email) {
      return { enviado: false, motivo: 'sin_destinatario' };
    }
    var asunto = 'SIGSO — Fecha comprometida para su solicitud ' + solicitud.solicitud_id;
    var cuerpo =
      'Estimado/a ' + (solicitud.solicitante_nombre || '') + ':\n\n' +
      'Le informamos que el equipo responsable ha comprometido una fecha de ' +
      'entrega para el siguiente ítem de su solicitud:\n\n' +
      'DETALLE\n' +
      '- Ítem: ' + subsolicitud.subsolicitud_id + ' — ' + subsolicitud.titulo + '\n' +
      '- Solicitud: ' + solicitud.solicitud_id + '\n' +
      '- Fecha comprometida de entrega: ' + String(fechaComprometida).replace('T', ' ') + '\n\n' +
      'Le avisaremos cuando el trabajo esté terminado para su validación.' +
      pieCorreoBackoffice_();
    var evento = 'COMPROMISO_FECHA:' + subsolicitud.subsolicitud_id + ':' + fechaComprometida;
    return enviarCorreo_(solicitud.solicitud_id, solicitud.solicitante_email, evento, asunto, cuerpo);
  },

  // v2.1 (Fase D, §8): "en riesgo" (< 1 dia habil de la fecha comprometida,
  // ver Cumplimiento.gs) -- analoga a alertaSLAProximo (A-08) pero sobre la
  // fecha comprometida, no el SLA automatico. Va al desarrollador asignado
  // del item (si lo hay) y a Gerencia/Admin de la empresa.
  alertaFechaEnRiesgo: function (subsolicitud, solicitud) {
    var destinatarios = obtenerEmailsPorRol_(solicitud.empresa_id, ['GERENCIA', 'ADM']);
    var desarrollador = subsolicitud.desarrollador_asignado || solicitud.desarrollador_asignado;
    if (desarrollador && destinatarios.indexOf(desarrollador) === -1) {
      destinatarios.push(desarrollador);
    }
    var asunto = 'SIGSO - Fecha comprometida en riesgo: ' + subsolicitud.subsolicitud_id;
    var cuerpo =
      'El item ' + subsolicitud.subsolicitud_id + ' (solicitud ' + solicitud.solicitud_id +
      ') se acerca a su fecha comprometida (' + String(subsolicitud.fecha_comprometida).replace('T', ' ') +
      ') y todavia no se entrega (Terminada).';
    return destinatarios.map(function (email) {
      return enviarCorreo_(
        solicitud.solicitud_id, email, 'FECHA_EN_RIESGO:' + subsolicitud.subsolicitud_id, asunto, cuerpo,
        VENTANA_DEDUP_SLA_VENCIDO_MINUTOS
      );
    });
  },

  // v2.1 (Fase D, §8): recordatorio al solicitante mientras un item lleva
  // dias en "Terminada" (S08) sin que lo valide, ANTES de que actue el
  // cierre automatico (RN-201, DIAS_HABILES_CIERRE_AUTOMATICO). Se envia a
  // lo mas 1 vez/dia mientras siga pendiente (mismo patron que alertaSLAVencido).
  recordarValidacionPendiente: function (subsolicitud, solicitud, diasHabilesEsperando) {
    if (!solicitud.solicitante_email) {
      return { enviado: false, motivo: 'sin_destinatario' };
    }
    var asunto = 'SIGSO — Ítem pendiente de su validación: ' + subsolicitud.subsolicitud_id;
    var cuerpo =
      'Estimado/a ' + (solicitud.solicitante_nombre || '') + ':\n\n' +
      'Le recordamos que el siguiente ítem de su solicitud está terminado y ' +
      'pendiente de su validación:\n\n' +
      'DETALLE\n' +
      '- Ítem: ' + subsolicitud.subsolicitud_id + ' — ' + subsolicitud.titulo + '\n' +
      '- Solicitud: ' + solicitud.solicitud_id + '\n' +
      '- Días hábiles esperando su revisión: ' + diasHabilesEsperando + '\n\n' +
      'ACCIÓN REQUERIDA\n' +
      'Ingrese a Consultar Estado para confirmar que quedó resuelto, o para ' +
      'indicarnos si algo falta. Si no hay respuesta, el ítem se cerrará ' +
      'automáticamente a los ' + DIAS_HABILES_CIERRE_AUTOMATICO + ' días hábiles ' +
      'desde que se marcó como Terminado.' +
      pieCorreoBackoffice_();
    return enviarCorreo_(
      solicitud.solicitud_id, solicitud.solicitante_email, 'RECORDATORIO_VALIDACION:' + subsolicitud.subsolicitud_id, asunto, cuerpo,
      VENTANA_DEDUP_SLA_VENCIDO_MINUTOS
    );
  },

  // §17.4 v1.0: "Resumen semanal" — lunes 09:00, a Admin+Analista, con los
  // KPIs de Dashboard.getData ya calculados (Fase 5), uno por empresa.
  enviarResumenSemanal: function () {
    return enviarReporteProgramado_('RESUMEN_SEMANAL', ['ANA', 'ADM'], function (kpis) {
      return 'Resumen semanal SIGSO\n\n' +
        'Solicitudes abiertas: ' + kpis.resumen.total_abiertas + '\n' +
        'Criticas activas (P1): ' + kpis.resumen.criticas_activas + '\n' +
        'Subsolicitudes con SLA vencido: ' + kpis.resumen.sla_vencido + '\n' +
        'Ingresadas hoy: ' + kpis.resumen.del_dia + '\n';
    });
  },

  // §17.4 v1.0: "Reporte mensual" — dia 1, a Admin+Analista+Desarrollador,
  // con tendencia y tiempo promedio de resolucion.
  enviarReporteMensual: function () {
    return enviarReporteProgramado_('REPORTE_MENSUAL', ['ANA', 'ADM', 'DEV'], function (kpis) {
      return 'Reporte mensual SIGSO\n\n' +
        'Solicitudes abiertas: ' + kpis.resumen.total_abiertas + '\n' +
        'Tiempo promedio de resolucion (horas habiles): ' + kpis.tiempo_promedio_resolucion_horas + '\n' +
        'Tendencia (ultimos 6 meses, ingresadas/resueltas): ' + JSON.stringify(kpis.tendencia_mensual) + '\n';
    });
  },

  // v5.2 (§4.2, propuesta de adopcion): envio MANUAL del reporte ejecutivo --
  // complementa (no reemplaza) enviarResumenSemanal/enviarReporteMensual, que
  // siguen corriendo por trigger. La clave de evento usa un UUID (no la
  // "clave del dia" que usa enviarReporteProgramado_): nunca se deduplica
  // contra el envio semanal/mensual ni contra un envio manual anterior del
  // mismo dia -- si el Admin lo pide, sale SI o SI, no "ya se envio hoy".
  // Solo callable por ADM (Code.gs valida el rol antes de llegar aca).
  enviarReporteEjecutivoAhora: function (data, contexto) {
    if (!contexto || contexto.rol !== 'ADM') {
      return { _forbidden: true, message: 'Solo un Administrador puede enviar el reporte a Gerencia.' };
    }
    var empresas = {};
    leerFilas_(SHEETS.USUARIOS).forEach(function (u) { empresas[u.empresa_id] = true; });

    var resultados = [];
    Object.keys(empresas).forEach(function (empresaId) {
      var kpis = Dashboard.getData({ empresa_id: empresaId }, { rol: 'ADM', email: '' });
      var asunto = 'SIGSO — Reporte ejecutivo (' + empresaId + ')';
      var cuerpo =
        'Reporte ejecutivo SIGSO\n\n' +
        'Solicitudes abiertas: ' + kpis.resumen.total_abiertas + '\n' +
        'Criticas activas (P1): ' + kpis.resumen.criticas_activas + '\n' +
        'Subsolicitudes con SLA vencido: ' + kpis.resumen.sla_vencido + '\n' +
        'Ingresadas hoy: ' + kpis.resumen.del_dia + '\n\n' +
        'Enviado a pedido desde el Panel de Gerencia.' +
        pieCorreoBackoffice_();
      var claveEvento = 'REPORTE_EJECUTIVO_MANUAL:' + empresaId + ':' + Utilities.getUuid();
      obtenerEmailsPorRol_(empresaId, ['GERENCIA', 'ADM']).forEach(function (email) {
        resultados.push(enviarCorreo_('REPORTE:' + empresaId, email, claveEvento, asunto, cuerpo));
      });
    });
    return { enviados: resultados.filter(function (r) { return r.enviado; }).length, total: resultados.length };
  },

  // v4.2 (§4, documentacion/SIGSO-v4.2-propuestas-modulo-jefatura.md): "al
  // finalizar el dia poder ver que ocurrio en su departamento" -- lo que la
  // jefatura pidio explicitamente. Un correo por jefe activo, al final de
  // la jornada (Triggers.gs: enviarDigestJefaturaTrigger, 18:00), con el
  // mismo resumen "hoy" que ve en su panel. No manda nada si el jefe no
  // tiene equipo o si hoy no paso nada de relevancia -- un digest siempre
  // vacio entrena a la gente a ignorarlo.
  enviarDigestJefatura: function () {
    var jefes = {};
    leerFilasSeguro_(SHEETS.JEFATURAS).forEach(function (j) {
      var activo = j.activo === true || j.activo === 'TRUE' || j.activo === 1;
      if (activo) jefes[j.jefe_email] = true;
    });

    var resultados = [];
    Object.keys(jefes).forEach(function (jefeEmail) {
      var panel = Jefatura.getPanel({}, { email: jefeEmail, rol: 'JEFATURA' });
      var r = panel.hoy.resumen;
      var huboAlgo = r.nuevas > 0 || r.avanzaron > 0 || r.cerradas > 0 || r.en_riesgo > 0 || r.requieren_accion > 0;
      if (!huboAlgo) {
        resultados.push({ jefe: jefeEmail, enviado: false, motivo: 'sin_novedades' });
        return;
      }
      var asunto = 'SIGSO — Hoy en tu departamento (' + r.nuevas + ' nuevas, ' + r.cerradas + ' cerradas)';
      var cuerpo =
        'Resumen del día en tu departamento:\n\n' +
        '- Nuevas solicitudes: ' + r.nuevas + '\n' +
        '- Avanzaron de estado: ' + r.avanzaron + '\n' +
        '- Se cerraron: ' + r.cerradas + '\n' +
        '- En riesgo o vencidas: ' + r.en_riesgo + '\n' +
        '- Esperan validación de tu equipo: ' + r.requieren_accion + '\n\n' +
        (panel.hoy.nuevas.length ? 'NUEVAS\n' + listarItems_(panel.hoy.nuevas) + '\n\n' : '') +
        (panel.hoy.cerradas.length ? 'CERRADAS HOY\n' + listarItems_(panel.hoy.cerradas) + '\n\n' : '') +
        (panel.hoy.en_riesgo_o_vencidas.length ? 'EN RIESGO O VENCIDAS\n' + listarItems_(panel.hoy.en_riesgo_o_vencidas) + '\n\n' : '') +
        (panel.hoy.requieren_accion.length ? 'ESPERANDO VALIDACIÓN DE TU EQUIPO\n' + listarItems_(panel.hoy.requieren_accion) + '\n\n' : '') +
        'Puedes ver el detalle completo en tu Panel de Jefatura.' +
        pieCorreoBackoffice_();
      var claveEvento = 'DIGEST_JEFATURA:' + claveDia_(new Date(), 'America/Santiago');
      resultados.push(Object.assign(
        { jefe: jefeEmail },
        enviarCorreo_('DIGEST_JEFATURA', jefeEmail, claveEvento, asunto, cuerpo, VENTANA_DEDUP_SLA_VENCIDO_MINUTOS)
      ));
    });
    return resultados;
  },

  alertarAdminFalloDocumento: function (solicitud, ref) {
    var destinatarios = obtenerEmailsPorRol_(solicitud.empresa_id, ['ADM']);
    return destinatarios.map(function (email) {
      var asunto = 'SIGSO - Fallo generando documento: ' + solicitud.solicitud_id;
      var cuerpo =
        'La generacion de documento fallo ' + MAX_REINTENTOS_CORREO + ' veces para ' +
        solicitud.solicitud_id + '. Referencia de log: ' + ref;
      return enviarCorreo_(solicitud.solicitud_id, email, 'FALLO_DOCUMENTO', asunto, cuerpo);
    });
  },

  // P7 (v2.0, Sprint 3): avisa a Gerencia/Admin cuando un (modulo, tipo)
  // supera el umbral de patron (Dashboard.calcularAlertasPatron_). No usa
  // un solicitud_id real (es un aviso agregado, no de una solicitud
  // puntual) -- el "solicitud_id" del log es un tag descriptivo, mismo
  // criterio que ya usa enviarReporteProgramado_ para los reportes.
  notificarPatron: function (alerta) {
    var destinatarios = leerFilas_(SHEETS.USUARIOS)
      .filter(function (u) {
        var activo = u.activo === true || u.activo === 'TRUE' || u.activo === 1;
        return activo && (u.rol === 'GERENCIA' || u.rol === 'ADM');
      })
      .map(function (u) { return u.email; });
    var asunto = 'SIGSO - Patron detectado: ' + alerta.modulo + ' / ' + alerta.tipo;
    var cuerpo =
      'El modulo "' + alerta.modulo + '" acumula ' + alerta.cantidad + ' reportes de tipo "' + alerta.tipo +
      '" en los ultimos ' + PATRON_VENTANA_DIAS + ' dias, de ' + alerta.solicitantes_distintos +
      ' solicitantes distintos.\n\nPosible causa raiz -- no lo trates como casos aislados.';
    return destinatarios.map(function (email) {
      return enviarCorreo_('PATRON:' + alerta.modulo + ':' + alerta.tipo, email, 'ALERTA_PATRON:' + alerta.modulo + ':' + alerta.tipo, asunto, cuerpo);
    });
  },

  // A-12: reintenta notificaciones marcadas PENDIENTE_REINTENTO (fallo de
  // cuota u otro error transitorio de Gmail), hasta 3 intentos.
  // RF-019 (§12.6 v1.0): vista de logs de automatizaciones en admin.html.
  // Solo Admin, mas recientes primero.
  listarLogs: function (data, contexto) {
    if (contexto.rol !== 'ADM') {
      return { _forbidden: true, message: 'Solo un Administrador puede ver los logs de automatizaciones.' };
    }
    var limite = (data && data.limite) ? Number(data.limite) : 100;
    return leerFilas_(SHEETS.LOG_NOTIFICACIONES)
      .slice()
      .sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); })
      .slice(0, limite);
  },

  procesarColaCorreo: function () {
    var pendientes = leerFilas_(SHEETS.LOG_NOTIFICACIONES).filter(function (n) {
      return n.resultado === 'PENDIENTE_REINTENTO' && Number(n.reintentos) < MAX_REINTENTOS_CORREO;
    });

    return pendientes.map(function (n) {
      try {
        // Fase 10.2: si el item viene de una notificacion encolada a
        // proposito (notificarCambioEstado), n.asunto/n.cuerpo tienen el
        // contenido real. Si viene de un fallo genuino de otro tipo de
        // correo (que no guarda asunto/cuerpo), se usa el texto generico de
        // siempre.
        var asunto = n.asunto || ('[Reintento] ' + n.evento);
        var cuerpo = n.cuerpo || ('Reintento de notificacion para ' + n.solicitud_id);
        MailApp.sendEmail(n.destinatario, asunto, cuerpo);
        actualizarFilaPorId_(SHEETS.LOG_NOTIFICACIONES, 'log_id', n.log_id, { resultado: 'ENVIADO' });
        return { log_id: n.log_id, resultado: 'ENVIADO' };
      } catch (err) {
        var reintentos = Number(n.reintentos) + 1;
        actualizarFilaPorId_(SHEETS.LOG_NOTIFICACIONES, 'log_id', n.log_id, {
          reintentos: reintentos,
          resultado: reintentos >= MAX_REINTENTOS_CORREO ? 'FALLIDO' : 'PENDIENTE_REINTENTO'
        });
        return { log_id: n.log_id, resultado: 'ERROR' };
      }
    });
  }
};

// Pie comun de los correos formales (v3.0, mejora de redaccion). Duplicado
// deliberado con backend/intake/Notificaciones.gs (proyectos Apps Script
// separados, misma nota de duplicacion de siempre).
function pieCorreoBackoffice_() {
  return '\n\n' +
    '--------------------------------------------------\n' +
    'Este es un mensaje automatico del sistema SIGSO.\n' +
    'Por favor no responda directamente a este correo.\n' +
    'Equipo SIGSO — HomePymes / RLD';
}

// v4.2: formatea la lista compacta de items (Jefatura.resumirItem_) para el
// cuerpo de texto plano del digest.
function listarItems_(items) {
  return items.map(function (i) {
    return '- ' + i.solicitud_id + '-' + i.numero_item + ' — ' + i.titulo +
      ' (' + i.solicitante_nombre + ', ' + i.semaforo + ')';
  }).join('\n');
}

function formatearEstado_(codigo) {
  var etiquetas = {
    S01: 'Nueva', S02: 'Recibida', S03: 'En revision', S04: 'Aprobada',
    S05: 'En desarrollo', S06: 'Esperando informacion', S07: 'En pruebas',
    S08: 'Terminada', S09: 'Cerrada', S10: 'Rechazada', S11: 'Cancelada'
  };
  return etiquetas[codigo] || codigo;
}

function obtenerEmailsPorRol_(empresaId, roles) {
  return leerFilas_(SHEETS.USUARIOS)
    .filter(function (u) {
      var activo = u.activo === true || u.activo === 'TRUE' || u.activo === 1;
      return activo && u.empresa_id === empresaId && roles.indexOf(u.rol) !== -1;
    })
    .map(function (u) {
      return u.email;
    });
}

// RN-026 deduplica por (solicitud, evento, destinatario): ver la nota
// identica en backend/intake/Notificaciones.gs.
function yaNotificadoRecientemente_(solicitudId, evento, destinatario, ventanaMinutos) {
  var ahora = new Date().getTime();
  var ventana = ventanaMinutos || VENTANA_DEDUP_MINUTOS;
  return leerFilas_(SHEETS.LOG_NOTIFICACIONES).some(function (fila) {
    if (
      fila.solicitud_id !== solicitudId ||
      fila.evento !== evento ||
      fila.destinatario !== destinatario ||
      fila.resultado !== 'ENVIADO'
    ) {
      return false;
    }
    var minutosTranscurridos = (ahora - new Date(fila.timestamp).getTime()) / 60000;
    return minutosTranscurridos < ventana;
  });
}

// asunto/cuerpo son opcionales: solo los usa el camino de encolado directo
// (notificarCambioEstado, Fase 10.2) para que procesarColaCorreo pueda
// enviar el contenido real en vez de un texto generico de reintento.
function registrarNotificacion_(solicitudId, canal, destinatario, evento, resultado, reintentos, asunto, cuerpo) {
  agregarFila_(SHEETS.LOG_NOTIFICACIONES, {
    log_id: Utilities.getUuid(),
    timestamp: new Date().toISOString(),
    solicitud_id: solicitudId,
    canal: canal,
    destinatario: destinatario,
    evento: evento,
    resultado: resultado,
    reintentos: reintentos || 0,
    asunto: asunto || '',
    cuerpo: cuerpo || ''
  });
}

// Un reporte por empresa (Dashboard.getData ya filtra por empresa_id
// cuando se pasa en filtros); el "solicitud_id" del log es un tag, no un FK
// real (LOG_NOTIFICACIONES no fuerza esa relacion). La ventana de dedup
// evita reenvios si el trigger corre dos veces el mismo dia.
function enviarReporteProgramado_(evento, roles, formatearCuerpo) {
  var empresas = {};
  leerFilas_(SHEETS.USUARIOS).forEach(function (u) { empresas[u.empresa_id] = true; });

  var resultados = [];
  Object.keys(empresas).forEach(function (empresaId) {
    var kpis = Dashboard.getData({ empresa_id: empresaId }, { rol: 'ADM', email: '' });
    var asunto = 'SIGSO - ' + evento.replace(/_/g, ' ') + ' (' + empresaId + ')';
    var cuerpo = formatearCuerpo(kpis);
    var claveEvento = evento + ':' + claveDia_(new Date(), 'America/Santiago');
    obtenerEmailsPorRol_(empresaId, roles).forEach(function (email) {
      resultados.push(enviarCorreo_('REPORTE:' + empresaId, email, claveEvento, asunto, cuerpo, VENTANA_DEDUP_SLA_VENCIDO_MINUTOS));
    });
  });
  return resultados;
}

function enviarCorreo_(solicitudId, destinatario, evento, asunto, cuerpo, ventanaMinutos) {
  if (!destinatario) {
    return { enviado: false, motivo: 'sin_destinatario' };
  }
  if (yaNotificadoRecientemente_(solicitudId, evento, destinatario, ventanaMinutos)) {
    return { enviado: false, motivo: 'deduplicado' };
  }
  try {
    MailApp.sendEmail(destinatario, asunto, cuerpo);
    registrarNotificacion_(solicitudId, 'EMAIL', destinatario, evento, 'ENVIADO', 0);
    return { enviado: true };
  } catch (err) {
    registrarNotificacion_(solicitudId, 'EMAIL', destinatario, evento, 'PENDIENTE_REINTENTO', 1);
    logError_(err, 'Notificaciones.enviarCorreo:' + evento + ':' + solicitudId);
    return { enviado: false, motivo: 'error_envio' };
  }
}
