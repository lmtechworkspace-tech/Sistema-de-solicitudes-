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
      (esLote
        ? 'Ya aparecen en tu bandeja del Backoffice.'
        : 'Adjuntamos la orden de trabajo (PDF) con todo lo necesario para ejecutarla. Ya aparece en tu bandeja del Backoffice.') +
      pieCorreoBackoffice_();

    // v5.2 (correos profesionales + OT adjunta): cuerpo HTML branded, y para
    // una solicitud UNICA se adjunta el PDF de la Orden de Trabajo -- Leo
    // recibe el correo profesional + su hoja de pega en un solo mensaje. En
    // lote no se adjunta (adjuntar N PDFs no es viable); las OT quedan en el
    // sistema. El texto plano (`cuerpo`) sigue como fallback.
    var listadoHtml = '<ul style="margin:8px 0 12px;padding-left:20px;">' + derivadas.map(function (d) {
      var titulo = d.solicitud && d.solicitud.titulo ? ' — ' + escaparHtmlCorreo_(d.solicitud.titulo) : '';
      var item = d.subsolicitud_id ? ' (ítem ' + escaparHtmlCorreo_(d.subsolicitud_id) + ')' : '';
      return '<li style="margin-bottom:4px;"><strong>' + escaparHtmlCorreo_(d.solicitud_id) + '</strong>' + item + titulo + '</li>';
    }).join('') + '</ul>';
    var cuerpoHtml =
      '<p style="margin:0 0 12px;">Estimado/a:</p>' +
      '<p style="margin:0 0 4px;">' + (esLote
        ? 'Se han derivado <strong>' + ids.length + '</strong> solicitudes a tu bandeja:'
        : 'Se ha derivado la siguiente solicitud a tu bandeja:') + '</p>' +
      listadoHtml +
      '<table style="border-collapse:collapse;font-size:14px;margin:4px 0 4px;">' +
      filaDetalleCorreo_('Derivada por', usuario) +
      filaDetalleCorreo_('Motivo', motivo) +
      '</table>';
    var pieHtml = esLote
      ? '📋 Ya aparecen en tu bandeja del Backoffice.'
      : '📎 Adjuntamos la <strong>orden de trabajo (PDF)</strong> con todo lo necesario para ejecutarla — descripción, contexto, accesos y capturas.';

    var opcionesNuevo = { htmlBody: plantillaCorreoHtml_(esLote ? 'Solicitudes derivadas' : 'Solicitud derivada', cuerpoHtml, { pie: pieHtml }) };
    if (!esLote) {
      var adjunto = generarAdjuntoOt_(ids[0], usuario);
      if (adjunto) opcionesNuevo.attachments = [adjunto];
    }

    // El evento incluye los ids para que la deduplicacion no confunda dos
    // derivaciones distintas hechas con poca diferencia de tiempo.
    var evento = 'DERIVACION:' + ids.join(',');
    var avisoNuevo = enviarCorreo_(ids[0], responsableNuevo, evento, asunto, cuerpo, undefined, opcionesNuevo);

    // Acuse al responsable anterior: solo si es una persona distinta y hay
    // uno solo (en un lote mixto no hay "un" anterior a quien avisarle).
    var anteriores = derivadas
      .map(function (d) { return d.responsable_anterior; })
      .filter(function (email, i, todos) {
        return email && email !== responsableNuevo && todos.indexOf(email) === i;
      });
    var cuerpoAnteriorHtml =
      '<p style="margin:0 0 4px;">' +
      (esLote ? 'Las siguientes solicitudes fueron derivadas' : 'La siguiente solicitud fue derivada') +
      ' a <strong>' + escaparHtmlCorreo_(responsableNuevo) + '</strong>:</p>' +
      listadoHtml +
      '<table style="border-collapse:collapse;font-size:14px;">' +
      filaDetalleCorreo_('Derivada por', usuario) +
      filaDetalleCorreo_('Motivo', motivo) +
      '</table>';
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
        pieCorreoBackoffice_(),
        undefined,
        { htmlBody: plantillaCorreoHtml_('Solicitud fuera de tu bandeja', cuerpoAnteriorHtml, {
          pie: 'Ya no aparece' + (esLote ? 'n' : '') + ' en tu bandeja.'
        }) }
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
      // v5.2 (fix, hallazgo real: el primer envio salio "muy basico" -- traia
      // el resumen tecnico de Dashboard.getData en vez de los KPIs del
      // Reporte Ejecutivo real). Gerencia.getPanel trae exactamente los mismos
      // datos que ya usa el bloque "Reporte ejecutivo (simple)" del panel web
      // (gerencia.js: renderReporteEjecutivo_) -- mismo contenido, dos canales.
      var panel = Gerencia.getPanel({ empresa_id: empresaId }, { rol: 'ADM', email: '' });
      var asunto = 'SIGSO — Reporte ejecutivo (' + empresaId + ')';
      var cuerpo = formatearCuerpoEjecutivo_(panel) + '\n\nEnviado a pedido desde el Panel de Gerencia.' + pieCorreoBackoffice_();
      var claveEvento = 'REPORTE_EJECUTIVO_MANUAL:' + empresaId + ':' + Utilities.getUuid();
      obtenerEmailsPorRol_(empresaId, ['GERENCIA', 'ADM']).forEach(function (email) {
        resultados.push(enviarCorreo_('REPORTE:' + empresaId, email, claveEvento, asunto, cuerpo));
      });
    });
    return { enviados: resultados.filter(function (r) { return r.enviado; }).length, total: resultados.length };
  },

  // v5.2 (Fase B, §4.2): version PROGRAMADA del reporte ejecutivo -- llega
  // a Gerencia SOLA, sin que el Admin tenga que acordarse de apretar
  // "Enviar a Gerencia ahora". No reusa enviarReporteProgramado_ (esa arma
  // el cuerpo con Dashboard.getData, que no trae cumplimiento/semaforo) --
  // usa Gerencia.getPanel, igual que el envio manual de arriba, con la misma
  // dedup "1 vez por dia" que enviarResumenSemanal/enviarReporteMensual.
  enviarReporteEjecutivoSemanal: function () {
    var empresas = {};
    leerFilas_(SHEETS.USUARIOS).forEach(function (u) { empresas[u.empresa_id] = true; });

    var resultados = [];
    Object.keys(empresas).forEach(function (empresaId) {
      var panel = Gerencia.getPanel({ empresa_id: empresaId }, { rol: 'ADM', email: '' });
      var asunto = 'SIGSO - REPORTE EJECUTIVO SEMANAL (' + empresaId + ')';
      var cuerpo = formatearCuerpoEjecutivo_(panel);
      var claveEvento = 'REPORTE_EJECUTIVO_SEMANAL:' + claveDia_(new Date(), 'America/Santiago');
      obtenerEmailsPorRol_(empresaId, ['GERENCIA', 'ADM']).forEach(function (email) {
        resultados.push(enviarCorreo_('REPORTE:' + empresaId, email, claveEvento, asunto, cuerpo, VENTANA_DEDUP_SLA_VENCIDO_MINUTOS));
      });
    });
    return resultados;
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

  // v7.0 (Fase 4, §4.6): un correo diario por persona con TODAS sus alertas
  // de Actividades agrupadas (regla de oro, aprendida de Novedades: nunca un
  // correo por actividad). Actividades.calcularAlertas() hace el calculo
  // puro; aca solo se formatea y se envia -- igual separacion que
  // enviarDigestJefatura (dominio en su modulo, correo en Notificaciones).
  // Sin trigger propio (presupuesto en 0, §4.6): Triggers.gs la cuelga del
  // trigger diario de las 09:00, en try/catch.
  enviarAlertasActividades: function () {
    var porPersona = Actividades.calcularAlertas();
    var resultados = [];
    var notifs = []; // v7.1: se encolan todas en LOTE al final.
    Object.keys(porPersona).forEach(function (email) {
      var d = porPersona[email];
      var total = d.sin_novedad.length + d.sin_confirmar.length + d.compromiso_proximo.length +
        d.vencidas.length + d.bloqueo_estancado.length;
      if (!total) return;
      var asunto = 'SIGSO — Actividades: ' + total + (total === 1 ? ' pendiente' : ' pendientes');
      var cuerpo = formatearAlertasActividades_(d);
      var claveEvento = 'ALERTAS_ACTIVIDADES:' + claveDia_(new Date(), 'America/Santiago');
      resultados.push(Object.assign(
        { email: email, total: total },
        enviarCorreo_('ALERTAS_ACTIVIDADES', email, claveEvento, asunto, cuerpo, VENTANA_DEDUP_SLA_VENCIDO_MINUTOS,
          { htmlBody: plantillaCorreoHtml_('Actividades pendientes', formatearAlertasActividadesHtml_(d)) })
      ));
      notifs.push({
        destinatario: email, tipo: 'ALERTAS_ACTIVIDADES',
        titulo: 'Tienes ' + total + (total === 1 ? ' actividad pendiente' : ' actividades pendientes'),
        mensaje: 'Revisa tu digest diario: vencidas, sin confirmar, bloqueadas o sin novedad reciente.',
        modulo_id: 'mi_trabajo', texto_accion: 'Ver Mi trabajo', vidaHoras: 24
      });
    });
    encolarNotificacionAppLote_(notifs);
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
        // v5.2: la cola tambien manda en HTML branded (a partir del texto
        // guardado). Es la que entrega el aviso de cambio de estado al
        // solicitante (Fase 10.2), asi que tiene que verse igual de profesional.
        MailApp.sendEmail(n.destinatario, asunto, cuerpo, {
          name: 'SIGSO — HomePymes / RLD',
          htmlBody: htmlAutoDesdeTexto_(asunto, cuerpo)
        });
        actualizarFilaPorId_(SHEETS.LOG_NOTIFICACIONES, 'log_id', n.log_id, { resultado: 'ENVIADO' });
        invalidarIndiceDedup_(); // v6.9: una fila paso a ENVIADO
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

// v7.0 (Fase 4): secciones del digest de alertas de Actividades, en el
// orden en que mas urge leerlas -- lo bloqueado y lo vencido primero, "sin
// novedad" al final (es el mas suave, un recordatorio).
var ACTIVIDADES_SECCIONES_ALERTA_ = [
  { clave: 'bloqueo_estancado', titulo: 'BLOQUEADAS HACE VARIOS DIAS' },
  { clave: 'vencidas', titulo: 'VENCIDAS' },
  { clave: 'compromiso_proximo', titulo: 'A PUNTO DE VENCER' },
  { clave: 'sin_confirmar', titulo: 'ASIGNADAS SIN CONFIRMAR' },
  { clave: 'sin_novedad', titulo: 'SIN NOVEDAD RECIENTE' }
];

function resumirActividadAlerta_(a) {
  return a.titulo + ' (' + (a.responsable_nombre || a.responsable_email) +
    (a.fecha_compromiso ? ', vence ' + fechaCortaCorreo_(a.fecha_compromiso) : '') + ')';
}

function fechaCortaCorreo_(iso) {
  var f = new Date(iso);
  if (isNaN(f.getTime())) return '';
  return ('0' + f.getUTCDate()).slice(-2) + '/' + ('0' + (f.getUTCMonth() + 1)).slice(-2);
}

function formatearAlertasActividades_(porTipo) {
  var bloques = ACTIVIDADES_SECCIONES_ALERTA_
    .filter(function (s) { return porTipo[s.clave].length; })
    .map(function (s) {
      return s.titulo + '\n' + porTipo[s.clave].map(function (a) { return '- ' + resumirActividadAlerta_(a); }).join('\n');
    });
  return 'Tienes actividades que necesitan atencion:\n\n' + bloques.join('\n\n') +
    '\n\nEntra a SIGSO para verlas.' + pieCorreoBackoffice_();
}

function formatearAlertasActividadesHtml_(porTipo) {
  var bloques = ACTIVIDADES_SECCIONES_ALERTA_
    .filter(function (s) { return porTipo[s.clave].length; })
    .map(function (s) {
      var items = porTipo[s.clave].map(function (a) {
        return '<li style="margin:4px 0;">' + escaparHtmlCorreo_(resumirActividadAlerta_(a)) + '</li>';
      }).join('');
      return '<p style="font-weight:600;margin:16px 0 4px;">' + escaparHtmlCorreo_(s.titulo) + '</p>' +
        '<ul style="margin:0;padding-left:20px;">' + items + '</ul>';
    });
  return '<p>Tienes actividades que necesitan atención:</p>' + bloques.join('');
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
// v6.9 (rendimiento): indice del dedup, armado UNA vez por ejecucion.
//
// Antes, cada correo a enviar recorria LOG_NOTIFICACIONES ENTERA para saber
// si ya se habia mandado. En un envio masivo (recordatorio diario de
// Novedades, derivacion en lote, alertas de SLA) eso era una lectura por
// destinatario -- y esa hoja SOLO CRECE, porque guarda toda notificacion
// historica. Ahora se lee una vez y se mantiene en memoria.
var _indiceDedup_ = null;

function claveDedup_(solicitudId, evento, destinatario) {
  return String(solicitudId) + '||' + String(evento) + '||' + String(destinatario);
}

function invalidarIndiceDedup_() {
  _indiceDedup_ = null;
}

// clave -> timestamp (ms) del ENVIADO mas reciente.
function indiceDedup_() {
  if (_indiceDedup_) return _indiceDedup_;
  var indice = {};
  leerFilas_(SHEETS.LOG_NOTIFICACIONES).forEach(function (fila) {
    if (fila.resultado !== 'ENVIADO') return;
    var clave = claveDedup_(fila.solicitud_id, fila.evento, fila.destinatario);
    var momento = new Date(fila.timestamp).getTime();
    if (!indice[clave] || momento > indice[clave]) indice[clave] = momento;
  });
  _indiceDedup_ = indice;
  return indice;
}

function yaNotificadoRecientemente_(solicitudId, evento, destinatario, ventanaMinutos) {
  var ventana = ventanaMinutos || VENTANA_DEDUP_MINUTOS;
  var ultimoEnvio = indiceDedup_()[claveDedup_(solicitudId, evento, destinatario)];
  if (!ultimoEnvio) return false;
  return ((new Date().getTime() - ultimoEnvio) / 60000) < ventana;
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
  // v6.9: mantener el indice al dia en vez de releer la hoja. Sin esto, un
  // segundo intento del MISMO correo dentro de la misma ejecucion no se
  // deduplicaria (antes se releia la hoja y si aparecia).
  if (resultado === 'ENVIADO') {
    indiceDedup_()[claveDedup_(solicitudId, evento, destinatario)] = new Date().getTime();
  }
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

// v5.2 (§4.1/§4.2): mismo texto para el envio manual (enviarReporteEjecutivoAhora)
// y el programado (enviarReporteEjecutivoSemanal) -- un solo lugar donde
// cambiar el formato del reporte ejecutivo. Recibe un panel de
// Gerencia.getPanel (no Dashboard.getData): trae cumplimiento/semaforo, que
// es justamente lo que Gerencia pidio ver ("basico y de un vistazo", no un
// resumen tecnico de conteos). Mismo contenido que gerencia.js:
// renderReporteEjecutivo_ -- misma logica, dos canales (correo y PDF).
function formatearCuerpoEjecutivo_(panel) {
  var kpis = panel.kpis || {};
  var items = panel.items || [];
  var atrasadas = items.filter(function (i) { return i.cumplimiento.codigo === 'ATRASADA_DESARROLLADOR'; }).length;
  var enRiesgo = items.filter(function (i) { return i.cumplimiento.codigo === 'EN_RIESGO'; }).length;

  var semaforo = atrasadas > 0
    ? '🔴 Hay solicitudes atrasadas que necesitan atención'
    : (enRiesgo > 0 ? '🟡 Al día, pero hay ítems cerca de vencer' : '🟢 Todo al día');

  var cumplimientoTxt = (kpis.pct_cumplimiento_desarrollador === null || kpis.pct_cumplimiento_desarrollador === undefined)
    ? '—' : kpis.pct_cumplimiento_desarrollador + '%';

  var lineas = [
    (kpis.atrasadas_activas || 0) + ' solicitud(es) ya pasaron su fecha comprometida y siguen sin entregarse.',
    (kpis.esperando_validacion || 0) + ' ítem(s) están listos y esperan que el solicitante confirme que quedaron bien.',
    (kpis.sin_comprometer || 0) + ' solicitud(es) todavía no tienen fecha comprometida por el equipo.'
  ];
  if (cumplimientoTxt !== '—') {
    lineas.push('De lo entregado, el ' + cumplimientoTxt + ' se entregó a tiempo.');
  }

  return 'Reporte ejecutivo SIGSO\n\n' +
    semaforo + '\n\n' +
    'Cumplimiento: ' + cumplimientoTxt + '\n' +
    'Atrasadas: ' + (kpis.atrasadas_activas || 0) + '\n' +
    'Por validar: ' + (kpis.esperando_validacion || 0) + '\n\n' +
    'Qué necesita tu atención:\n' +
    lineas.map(function (l) { return '- ' + l; }).join('\n');
}

// v7.5 (canales de alerta configurables desde Admin): con las alertas EN
// VIVO (v7.1-v7.4) ya cubriendo varios eventos, el correo de algunos se
// volvio redundante -- el ejemplo real que motivo esto es Pausas activas.
// Este catalogo agrupa los ~25 eventos de correo en 6 CATEGORIAS que el
// Admin puede apagar/encender por correo desde Administracion > Canales de
// alerta, sin tocar codigo. La granularidad es por categoria (no por evento
// suelto: seria un muro de switches tecnicos).
//
// `tiene_en_vivo`: si esa categoria ADEMAS del correo dispara una alerta en
// pantalla (Pausas/Actividades/Novedades lo hacen desde v7.1-v7.4). Apagar
// el correo de esas es SEGURO (la alerta en vivo queda). Las de solo-correo
// (SLA, derivacion, reportes) se pueden apagar igual, pero apagarlas =
// nadie se entera -- el panel del Admin lo advierte.
//
// IMPORTANTE (seguridad de datos): los avisos al SOLICITANTE EXTERNO
// (compromiso de fecha, recordatorio de validacion, cambio de estado, acuse)
// NO estan en ninguna categoria a proposito -- esa gente nunca tiene SIGSO
// abierto, el correo es su UNICO canal, asi que nunca se bloquean (ver
// categoriaDeEvento_ -> null -> siempre se envia).
var CANALES_ALERTA = [
  { clave: 'PAUSAS', nombre: 'Pausas activas', tiene_en_vivo: true,
    descripcion: 'Recordatorio, "¡es ahora!" y avisos de coordinación de las pausas.',
    prefijos: ['PAUSA'] },
  { clave: 'ACTIVIDADES', nombre: 'Mi trabajo / Actividades', tiene_en_vivo: true,
    descripcion: 'Pedidos de actualización y el resumen diario de tus actividades.',
    prefijos: ['PEDIR_ACTUALIZACION_ACTIVIDAD', 'ALERTAS_ACTIVIDADES'] },
  { clave: 'NOVEDADES', nombre: 'Novedades', tiene_en_vivo: true,
    descripcion: 'Avisos y logros publicados, novedades por aprobar y recordatorios de acuse.',
    prefijos: ['NOVEDAD'] },
  { clave: 'SOLICITUDES', nombre: 'Solicitudes (equipo)', tiene_en_vivo: false,
    descripcion: 'Derivaciones a tu bandeja y avisos de documento listo. Hoy solo por correo.',
    prefijos: ['DERIVACION', 'DOC_LISTO', 'FALLO_DOCUMENTO'] },
  { clave: 'SLA', nombre: 'SLA y vencimientos (equipo)', tiene_en_vivo: false,
    descripcion: 'SLA próximo o vencido, fecha comprometida en riesgo y alertas de patrón. Hoy solo por correo.',
    prefijos: ['SLA_PROXIMO', 'SLA_VENCIDO', 'FECHA_EN_RIESGO', 'ALERTA_PATRON'] },
  { clave: 'REPORTES', nombre: 'Reportes', tiene_en_vivo: false,
    descripcion: 'Reporte ejecutivo, resumen semanal/mensual y digest de jefatura. Hoy solo por correo.',
    prefijos: ['RESUMEN_SEMANAL', 'REPORTE_MENSUAL', 'REPORTE_EJECUTIVO', 'DIGEST_JEFATURA'] }
];

// Devuelve la clave de categoria de un evento, o null si no pertenece a
// ninguna (evento desconocido/nuevo, o aviso al solicitante externo) -- en
// cuyo caso NUNCA se bloquea (default seguro).
function categoriaDeEvento_(evento) {
  var ev = String(evento || '');
  for (var i = 0; i < CANALES_ALERTA.length; i++) {
    var prefijos = CANALES_ALERTA[i].prefijos;
    for (var j = 0; j < prefijos.length; j++) {
      if (ev.indexOf(prefijos[j]) === 0) return CANALES_ALERTA[i].clave;
    }
  }
  return null;
}

// Lee CONFIG_NOTIFICACIONES.activo del registro CANAL_CORREO_<clave>. Sin
// registro (o sin hoja) = ENCENDIDO -- reproduce el comportamiento previo,
// no rompe nada; el registro se crea recien cuando el Admin apaga uno.
function canalCorreoActivo_(clave) {
  var filas;
  try { filas = leerFilas_(SHEETS.CONFIG_NOTIFICACIONES); } catch (err) { return true; }
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].notif_id === 'CANAL_CORREO_' + clave) {
      var v = filas[i].activo;
      return !(v === false || v === 'FALSE' || v === 0 || v === '0');
    }
  }
  return true;
}

function correoActivoParaEvento_(evento) {
  var clave = categoriaDeEvento_(evento);
  if (!clave) return true; // desconocido o aviso al solicitante externo: siempre se envia
  return canalCorreoActivo_(clave);
}

// v7.5: Administracion > Canales de alerta -- que categorias mandan correo.
// ADM-only. `tiene_en_vivo` alimenta la advertencia del panel ("apagar esto
// = nadie se entera" cuando NO tiene alerta en vivo de respaldo).
function listarCanalesAlerta_(contexto) {
  if (!contexto || contexto.rol !== 'ADM') {
    return { _forbidden: true, message: 'Solo un Administrador puede configurar los canales de alerta.' };
  }
  return {
    canales: CANALES_ALERTA.map(function (c) {
      return {
        clave: c.clave, nombre: c.nombre, descripcion: c.descripcion,
        tiene_en_vivo: c.tiene_en_vivo, correo_activo: canalCorreoActivo_(c.clave)
      };
    })
  };
}

function guardarCanalAlerta_(contexto, clave, activo) {
  if (!contexto || contexto.rol !== 'ADM') {
    return { _forbidden: true, message: 'Solo un Administrador puede configurar los canales de alerta.' };
  }
  var conocido = CANALES_ALERTA.some(function (c) { return c.clave === clave; });
  if (!conocido) return errorValidacion_('clave', 'Canal de alerta desconocido.');
  var valor = (activo === true || activo === 'true' || activo === 1 || activo === '1');
  var notifId = 'CANAL_CORREO_' + clave;
  var actualizado = actualizarFilaPorId_(SHEETS.CONFIG_NOTIFICACIONES, 'notif_id', notifId, { activo: valor });
  if (!actualizado) {
    agregarFila_(SHEETS.CONFIG_NOTIFICACIONES, {
      notif_id: notifId, evento: 'Canal de correo: ' + clave,
      rol_destinatario: '', emails_extra: '', activo: valor
    });
  }
  return { ok: true, clave: clave, correo_activo: valor };
}

// v7.5 Fase 2: "Enviar alerta" desde Administracion -- un megafono manual del
// Admin a quien elija, por alerta EN VIVO y/o CORREO. Distinto de Novedades
// (feed durable con acuse y aprobacion): esto es inmediato y directo. Nace del
// feedback real: "poder enviar alertas desde el Admin, en caso que no tengan
// SIGSO abierto" -- el correo es el canal que alcanza a quien esta offline.
// Los canales los elige el Admin en CADA envio, asi que NO lo limitan los
// interruptores de "Canales de alerta" (evento ALERTA_ADMIN sin categoria ->
// correoActivoParaEvento_ devuelve true -> nunca se bloquea).

// Personal ACTIVO con identidad en SIGSO (USUARIOS Google + CUENTAS_PORTAL),
// deduplicado por email. Mismo cruce que listarPermisosNotificacionesSO_.
function directorioPersonalActivo_() {
  var personas = {};
  leerFilasSeguro_(SHEETS.USUARIOS).forEach(function (u) {
    if (!esVerdaderoPausas_(u.activo) || !u.email) return;
    personas[String(u.email).toLowerCase()] = { email: u.email, nombre: u.nombre || u.email, empresa_id: u.empresa_id || '' };
  });
  leerFilasSeguro_(SHEETS.CUENTAS_PORTAL).forEach(function (c) {
    if (!esVerdaderoPausas_(c.activo)) return;
    parsearListaPortal_(c.emails).forEach(function (email) {
      var correo = String(email || '').trim();
      if (!correo) return;
      var clave = correo.toLowerCase();
      if (!personas[clave]) personas[clave] = { email: correo, nombre: c.nombre || correo, empresa_id: c.empresa_id || '' };
    });
  });
  return Object.keys(personas).map(function (k) { return personas[k]; });
}

// Datos para poblar los selectores del formulario "Enviar alerta". ADM-only.
function getDirectorioAlerta_(contexto) {
  if (!contexto || contexto.rol !== 'ADM') {
    return { _forbidden: true, message: 'Solo un Administrador puede enviar alertas.' };
  }
  var personas = directorioPersonalActivo_();
  var empresas = {};
  personas.forEach(function (p) { if (p.empresa_id) empresas[p.empresa_id] = true; });
  return {
    personas: personas.sort(function (a, b) { return String(a.nombre).localeCompare(String(b.nombre)); }),
    empresas: Object.keys(empresas).sort()
  };
}

// Envia la alerta manual. audiencia_tipo: 'TODOS' | 'EMPRESA' | 'SELECCION'.
function enviarAlertaManual_(contexto, data) {
  if (!contexto || contexto.rol !== 'ADM') {
    return { _forbidden: true, message: 'Solo un Administrador puede enviar alertas.' };
  }
  data = data || {};
  var titulo = String(data.titulo || '').trim();
  var mensaje = String(data.mensaje || '').trim();
  if (titulo.length < 3) return errorValidacion_('titulo', 'Escribe un título (mínimo 3 caracteres).');
  if (mensaje.length < 3) return errorValidacion_('mensaje', 'Escribe el mensaje de la alerta.');
  var porCorreo = data.por_correo !== false;
  var porEnVivo = data.por_en_vivo !== false;
  if (!porCorreo && !porEnVivo) return errorValidacion_('canales', 'Elige al menos un canal (en vivo o correo).');

  var todos = directorioPersonalActivo_();
  var tipo = data.audiencia_tipo || 'TODOS';
  var destinatarios;
  if (tipo === 'EMPRESA') {
    var emp = String(data.empresa_id || '');
    destinatarios = todos.filter(function (p) { return p.empresa_id === emp; });
  } else if (tipo === 'SELECCION') {
    var elegidos = {};
    (Array.isArray(data.destinatarios) ? data.destinatarios : []).forEach(function (e) { elegidos[String(e).toLowerCase()] = true; });
    destinatarios = todos.filter(function (p) { return elegidos[p.email.toLowerCase()]; });
  } else {
    destinatarios = todos;
  }
  if (!destinatarios.length) return errorValidacion_('audiencia', 'No hay destinatarios para esa audiencia.');

  // UUID en el evento: nunca se deduplica contra otro envio ni contra los
  // interruptores de canales (ALERTA_ADMIN no tiene categoria).
  var evento = 'ALERTA_ADMIN:' + Utilities.getUuid();
  var enVivo = 0, correo = 0;

  if (porEnVivo) {
    var r = encolarNotificacionAppLote_(destinatarios.map(function (p) {
      return { destinatario: p.email, tipo: 'ALERTA_ADMIN', titulo: titulo, mensaje: mensaje, modulo_id: '', texto_accion: '', vidaHoras: 72 };
    }));
    enVivo = (r && r.encolado) || 0;
  }
  if (porCorreo) {
    var cuerpoHtml = plantillaCorreoHtml_(titulo, '<p>' + escaparHtmlCorreo_(mensaje).replace(/\n/g, '<br>') + '</p>');
    destinatarios.forEach(function (p) {
      var res = enviarCorreo_('ALERTA_ADMIN', p.email, evento, 'SIGSO — ' + titulo, mensaje, undefined, { htmlBody: cuerpoHtml });
      if (res.enviado) correo++;
    });
  }

  try {
    agregarFila_(SHEETS.LOG_SISTEMA, {
      log_id: Utilities.getUuid(), timestamp: new Date().toISOString(), contexto: 'ALERTA_ADMIN',
      mensaje: contexto.email + ' → ' + destinatarios.length + ' persona(s) [' +
        (porEnVivo ? 'en vivo' : '') + (porEnVivo && porCorreo ? '+' : '') + (porCorreo ? 'correo' : '') + ']: ' + titulo,
      ref: evento
    });
  } catch (err) { /* trazabilidad best-effort */ }

  return { ok: true, destinatarios: destinatarios.length, en_vivo: enVivo, correo: correo };
}

// v5.2 (correos profesionales): `opciones` es opcional y solo agrega lo nuevo
// -- { htmlBody, attachments }. El `cuerpo` de texto plano SIEMPRE se manda
// como fallback (clientes sin HTML lo leen igual). Los callers viejos que
// pasan `ventanaMinutos` posicional no cambian: `opciones` va al final.
function enviarCorreo_(solicitudId, destinatario, evento, asunto, cuerpo, ventanaMinutos, opciones) {
  if (!destinatario) {
    return { enviado: false, motivo: 'sin_destinatario' };
  }
  // v7.5: si el Admin apago el correo de la categoria de este evento, no se
  // manda (la alerta en vivo, si la hay, es una cola aparte y no se toca).
  if (!correoActivoParaEvento_(evento)) {
    return { enviado: false, motivo: 'canal_desactivado' };
  }
  if (yaNotificadoRecientemente_(solicitudId, evento, destinatario, ventanaMinutos)) {
    return { enviado: false, motivo: 'deduplicado' };
  }
  try {
    var opcionesEnvio = { name: 'SIGSO — HomePymes / RLD' };
    // Si el caller trae un HTML propio (p.ej. la derivacion, con su tabla y
    // adjunto), se respeta. Si no, se genera uno branded a partir del texto
    // plano -- asi TODAS las alertas se ven profesionales sin reescribir cada
    // una. El texto plano sigue viajando como fallback.
    opcionesEnvio.htmlBody = (opciones && opciones.htmlBody) ? opciones.htmlBody : htmlAutoDesdeTexto_(asunto, cuerpo);
    if (opciones && opciones.attachments) opcionesEnvio.attachments = opciones.attachments;
    MailApp.sendEmail(destinatario, asunto, cuerpo, opcionesEnvio);
    registrarNotificacion_(solicitudId, 'EMAIL', destinatario, evento, 'ENVIADO', 0);
    return { enviado: true };
  } catch (err) {
    registrarNotificacion_(solicitudId, 'EMAIL', destinatario, evento, 'PENDIENTE_REINTENTO', 1);
    logError_(err, 'Notificaciones.enviarCorreo:' + evento + ':' + solicitudId);
    return { enviado: false, motivo: 'error_envio' };
  }
}

// v7.6 (correos "corporativo sobrio"): plantilla HTML branded, con estilos
// INLINE (los clientes de correo -- Gmail/Outlook/movil -- ignoran <style> y
// CSS externo; solo respetan estilos inline). Misma paleta institucional
// (navy + grises) que la Orden de Trabajo (OrdenTrabajo.gs) para que todo lo
// que sale de SIGSO se vea de la misma casa. `cuerpoHtml` es el contenido ya
// formateado (parrafos/listas/tablas). `opts.pie` permite un texto de accion
// destacado bajo el cuerpo.
function plantillaCorreoHtml_(titulo, cuerpoHtml, opts) {
  opts = opts || {};
  var pie = opts.pie
    ? '<div style="background:#F8FAFC;border:1px solid #E5E7EB;border-left:3px solid #14213D;padding:12px 16px;margin:20px 0 0;font-size:14px;color:#1F2937;">' +
      opts.pie + '</div>'
    : '';
  return '<div style="margin:0;padding:0;background:#EEF1F6;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1F6;padding:32px 0;">' +
    '<tr><td align="center">' +
    '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #E5E7EB;font-family:Arial,Helvetica,sans-serif;">' +
    // Cabecera institucional: sello + marca (mismo lenguaje visual que la OT).
    '<tr><td style="background:#14213D;padding:22px 28px;">' +
    '<table cellpadding="0" cellspacing="0" role="presentation"><tr>' +
    '<td style="width:34px;height:34px;background:#ffffff;text-align:center;vertical-align:middle;font-family:Georgia,\'Times New Roman\',serif;font-weight:bold;font-size:17px;color:#14213D;">S</td>' +
    '<td style="padding-left:12px;vertical-align:middle;">' +
    '<div style="color:#ffffff;font-family:Georgia,\'Times New Roman\',serif;font-size:19px;font-weight:bold;letter-spacing:0.3px;">SIGSO</div>' +
    '<div style="color:#AEB8CC;font-size:11px;letter-spacing:0.3px;">Sistema de Gestión de Solicitudes</div>' +
    '</td></tr></table>' +
    '</td></tr>' +
    // Categoria del correo (eyebrow), separada de la marca.
    '<tr><td style="padding:14px 28px;background:#F8FAFC;border-bottom:1px solid #E5E7EB;">' +
    '<span style="display:inline-block;width:3px;height:12px;background:#14213D;margin-right:8px;"></span>' +
    '<span style="font-size:12px;font-weight:bold;letter-spacing:0.8px;color:#374151;text-transform:uppercase;">' + escaparHtmlCorreo_(titulo) + '</span>' +
    '</td></tr>' +
    // Cuerpo
    '<tr><td style="padding:26px 28px;color:#1F2937;font-size:15px;line-height:1.6;">' +
    cuerpoHtml +
    pie +
    '</td></tr>' +
    // Pie institucional
    '<tr><td style="padding:16px 28px;background:#F8FAFC;border-top:1px solid #E5E7EB;color:#6B7280;font-size:12px;line-height:1.6;">' +
    'Mensaje automático del sistema SIGSO. Por favor no respondas directamente a este correo.<br>' +
    'Equipo SIGSO — HomePymes / RLD' +
    '</td></tr>' +
    '</table></td></tr></table></div>';
}

// Fila etiqueta/valor para el bloque "DETALLE" de los correos HTML.
function filaDetalleCorreo_(etiqueta, valor) {
  return '<tr>' +
    '<td style="padding:4px 14px 4px 0;color:#6B7280;white-space:nowrap;vertical-align:top;">' + escaparHtmlCorreo_(etiqueta) + '</td>' +
    '<td style="padding:4px 0;">' + escaparHtmlCorreo_(valor) + '</td>' +
    '</tr>';
}

function escaparHtmlCorreo_(valor) {
  return String(valor === undefined || valor === null ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// v5.2 (correos profesionales): convierte un cuerpo de texto plano en el HTML
// branded, para las alertas que no traen un HTML propio. Quita el pie de
// texto plano (la plantilla ya pone su propio pie institucional), escapa el
// contenido y convierte los saltos de linea en <br>. El titulo del encabezado
// sale del asunto sin el prefijo "SIGSO".
function htmlAutoDesdeTexto_(asunto, textoPlano) {
  var texto = String(textoPlano || '');
  // Corta el pie de texto plano (pieCorreoBackoffice_) si esta presente.
  var corte = texto.indexOf('\n--------------------------------------------------');
  if (corte !== -1) texto = texto.slice(0, corte);
  var cuerpoHtml = '<p style="margin:0;">' +
    escaparHtmlCorreo_(texto.trim()).replace(/\n/g, '<br>') +
    '</p>';
  var titulo = String(asunto || 'Notificación').replace(/^SIGSO\s*[—-]\s*/, '').trim() || 'Notificación';
  return plantillaCorreoHtml_(titulo, cuerpoHtml);
}

// v5.2 (OT adjunta al derivar): genera el PDF de la OT como adjunto. Si la
// generacion falla (Drive/permiso/imagen), NO bloquea el correo -- se manda
// sin adjunto (el PDF igual es descargable desde el sistema) y se registra el
// error. Devuelve el Blob o null.
function generarAdjuntoOt_(solicitudId, usuario) {
  try {
    return OrdenTrabajo.generar(solicitudId, { rol: 'ADM', email: usuario || '' });
  } catch (err) {
    logError_(err, 'Notificaciones.generarAdjuntoOt:' + solicitudId);
    return null;
  }
}

// v7.1 (documentacion/SIGSO-v7.1-notificaciones-vivas.md): "espejo del
// correo" -- cada evento que ya dispara enviarCorreo_ puede ademas encolar
// una notificacion "en vivo" para que el destinatario la vea como toast/modal
// mientras trabaja, sin depender de que revise el correo. UNA sola decision
// (este evento se notifica) con DOS canales de salida.
//
// No reutiliza yaNotificadoRecientemente_ (esa dedup es por email+ventana, ya
// resuelta en enviarCorreo_ del mismo evento) -- aqui basta con no duplicar
// silenciosamente si el caller llama dos veces por error, lo cual no es un
// riesgo real dado que cada caller ya llama una sola vez por evento.
//
// `vidaHoras` (default 72h) define expira_en: pasado ese tiempo el polling
// (sincronizarNotificacionesApp_) deja de devolverla aunque siga sin leerse
// -- evita que una alerta de hace semanas reaparezca como "nueva" si el
// usuario no abrio SIGSO en mucho tiempo.
function encolarNotificacionApp_(destinatario, tipo, titulo, mensaje, moduloId, textoAccion, vidaHoras) {
  if (!destinatario) return { encolado: false, motivo: 'sin_destinatario' };
  var r = encolarNotificacionAppLote_([{
    destinatario: destinatario, tipo: tipo, titulo: titulo, mensaje: mensaje,
    modulo_id: moduloId, texto_accion: textoAccion, vidaHoras: vidaHoras
  }]);
  return r.encolado > 0 ? { encolado: true } : { encolado: false, motivo: 'error_encolado' };
}

// v7.1 (B5, rendimiento): encola VARIAS notificaciones en una sola escritura.
// `items` es un arreglo de { destinatario, tipo, titulo, mensaje, modulo_id,
// texto_accion, vidaHoras }. Lo usan los flujos que notifican a muchas
// personas a la vez (recordatorio de pausa a todo el roster, digest diario de
// actividades), donde antes se hacia un appendRow por persona.
//
// Nunca debe tumbar el flujo que la llama: si la hoja no existe aun
// (instalacion vieja sin re-correr el Instalador) o falla la escritura, el
// correo -- el canal confiable -- ya salio o sale igual.
function encolarNotificacionAppLote_(items) {
  if (!items || !items.length) return { encolado: 0 };
  try {
    var ahora = new Date();
    var filas = items
      .filter(function (it) { return it && it.destinatario; })
      .map(function (it) {
        var expira = new Date(ahora.getTime() + (it.vidaHoras || 72) * 60 * 60 * 1000);
        return {
          notif_id: Utilities.getUuid(),
          destinatario_email: it.destinatario,
          tipo: it.tipo,
          titulo: it.titulo,
          mensaje: it.mensaje || '',
          modulo_id: it.modulo_id || '',
          texto_accion: it.texto_accion || '',
          leida: 'FALSE',
          creada_en: ahora.toISOString(),
          expira_en: expira.toISOString()
        };
      });
    if (!filas.length) return { encolado: 0 };
    agregarFilas_(SHEETS.NOTIFICACIONES_APP, filas);
    return { encolado: filas.length };
  } catch (err) {
    logError_(err, 'Notificaciones.encolarNotificacionAppLote');
    return { encolado: 0 };
  }
}

// v7.1 (B6, "marcar todas leidas"): pasa a leida=TRUE todas las no-leidas del
// usuario de la sesion, en una sola pasada (evita N requests desde el
// cliente). Silencioso si la hoja no existe.
function marcarTodasNotificacionesAppLeidas_(contexto) {
  var datos;
  try { datos = leerHojaConEncabezados_(SHEETS.NOTIFICACIONES_APP); } catch (err) { return { actualizadas: 0 }; }
  var idxDest = datos.encabezados.indexOf('destinatario_email');
  var idxLeida = datos.encabezados.indexOf('leida');
  if (idxDest === -1 || idxLeida === -1) return { actualizadas: 0 };
  var n = 0;
  for (var i = 1; i < datos.valores.length; i++) {
    if (String(datos.valores[i][idxDest]) === contexto.email && String(datos.valores[i][idxLeida]) !== 'TRUE') {
      datos.hoja.getRange(i + 1, idxLeida + 1).setValue('TRUE');
      n++;
    }
  }
  if (n) invalidarCacheHoja_(SHEETS.NOTIFICACIONES_APP);
  return { actualizadas: n };
}

// v7.1 (B5, purga): borra las filas ya leidas o vencidas para que la hoja no
// crezca sin limite (cada sincronizacion lee la hoja completa). Lo llama un
// trigger diario ya existente (Triggers.gs), no uno nuevo. Lee una vez y
// borra de abajo hacia arriba para no correr los indices.
function purgarNotificacionesApp_() {
  var datos;
  try { datos = leerHojaConEncabezados_(SHEETS.NOTIFICACIONES_APP); } catch (err) { return { borradas: 0 }; }
  var idxLeida = datos.encabezados.indexOf('leida');
  var idxExpira = datos.encabezados.indexOf('expira_en');
  var ahora = Date.now();
  var borradas = 0;
  for (var i = datos.valores.length - 1; i >= 1; i--) {
    var leida = idxLeida !== -1 && String(datos.valores[i][idxLeida]) === 'TRUE';
    var vencida = idxExpira !== -1 && datos.valores[i][idxExpira] &&
      new Date(datos.valores[i][idxExpira]).getTime() <= ahora;
    if (leida || vencida) {
      datos.hoja.deleteRow(i + 1);
      borradas++;
    }
  }
  if (borradas) invalidarCacheHoja_(SHEETS.NOTIFICACIONES_APP);
  return { borradas: borradas };
}

// v7.3 (notificaciones vivas, Nivel 0): guarda el ULTIMO estado de
// Notification.permission que reporto el navegador de quien hizo la
// llamada -- 'granted' | 'denied' | 'default'. Upsert por email (no es
// historico). Sin gate de modulo (como ping): cualquier sesion valida puede
// reportar SU propio estado. Se llama al cargar SIGSO y cada vez que el
// permiso cambia (ver notificaciones-vivas.js).
//
// Nunca debe tumbar la carga de SIGSO: si la hoja NOTIF_PERMISOS_SO aun no
// existe (instalacion vieja sin re-correr el Instalador tras este cambio),
// se ignora en silencio -- mismo criterio que encolarNotificacionAppLote_.
function reportarPermisoNotificacionesSO_(contexto, permiso) {
  var valor = String(permiso || '').trim();
  if (['granted', 'denied', 'default'].indexOf(valor) === -1) {
    return errorValidacion_('permiso', 'Valor de permiso invalido.');
  }
  try {
    var fila = { email: contexto.email, permiso: valor, actualizado_en: new Date().toISOString() };
    var actualizado = actualizarFilaPorId_(SHEETS.NOTIF_PERMISOS_SO, 'email', contexto.email, fila);
    if (!actualizado) agregarFila_(SHEETS.NOTIF_PERMISOS_SO, fila);
  } catch (err) { /* hoja no existe todavia -- no romper la carga de SIGSO */ }
  return { ok: true };
}

// v7.3 (Nivel 0): panel de Administracion -- "quien nunca acepto el permiso
// del navegador" (la causa mas probable de "a unos les llega la alerta y a
// otros no", ver el feedback real que motivo esto). Cruza el personal
// ACTIVO (USUARIOS + CUENTAS_PORTAL) con lo ultimo reportado en
// NOTIF_PERMISOS_SO -- si nunca reporto nada, aparece como 'sin_datos' (aun
// no cargo SIGSO con esta version, o tiene el navegador cerrado). ADM-only.
function listarPermisosNotificacionesSO_(contexto) {
  if (contexto.rol !== 'ADM') {
    return { _forbidden: true, message: 'Solo un Administrador puede ver el estado de las alertas.' };
  }
  var permisoPorEmail = {};
  leerFilasSeguro_(SHEETS.NOTIF_PERMISOS_SO).forEach(function (p) {
    permisoPorEmail[String(p.email).toLowerCase()] = p;
  });

  var personas = {}; // email(lower) -> { email, nombre, origen }
  leerFilasSeguro_(SHEETS.USUARIOS).forEach(function (u) {
    if (!esVerdaderoPausas_(u.activo) || !u.email) return;
    personas[String(u.email).toLowerCase()] = { email: u.email, nombre: u.nombre || u.email, origen: 'Backoffice (Google)' };
  });
  leerFilasSeguro_(SHEETS.CUENTAS_PORTAL).forEach(function (c) {
    if (!esVerdaderoPausas_(c.activo)) return;
    parsearListaPortal_(c.emails).forEach(function (email) {
      var correo = String(email || '').trim();
      if (!correo) return;
      var clave = correo.toLowerCase();
      if (!personas[clave]) personas[clave] = { email: correo, nombre: c.nombre || correo, origen: 'Plataforma (portal)' };
    });
  });

  var lista = Object.keys(personas).map(function (clave) {
    var persona = personas[clave];
    var reportado = permisoPorEmail[clave];
    return {
      email: persona.email,
      nombre: persona.nombre,
      origen: persona.origen,
      permiso: reportado ? reportado.permiso : 'sin_datos',
      actualizado_en: reportado ? reportado.actualizado_en : ''
    };
  });
  // Los que faltan activar primero (sin_datos, luego denied, luego default);
  // granted al final -- son los que YA estan bien, no necesitan atencion.
  var ORDEN = { sin_datos: 0, denied: 1, default: 2, granted: 3 };
  lista.sort(function (a, b) {
    var diff = ORDEN[a.permiso] - ORDEN[b.permiso];
    return diff !== 0 ? diff : String(a.nombre).localeCompare(String(b.nombre));
  });
  return { personas: lista };
}

// v7.1: polling del cliente (cada 2-3 min, ver notificaciones-vivas.js). Solo
// las no leidas y no vencidas del usuario de la sesion -- nunca recibe un
// email como parametro, sale de contexto.email (misma identidad ya resuelta
// por Google Session o portal_token, igual criterio que Perfiles.gs).
function sincronizarNotificacionesApp_(contexto) {
  var ahora = Date.now();
  var pendientes = leerFilasSeguro_(SHEETS.NOTIFICACIONES_APP).filter(function (n) {
    return n.destinatario_email === contexto.email &&
      String(n.leida) !== 'TRUE' &&
      (!n.expira_en || new Date(n.expira_en).getTime() > ahora);
  });
  pendientes.sort(function (a, b) { return new Date(b.creada_en) - new Date(a.creada_en); });
  return {
    notificaciones: pendientes.map(function (n) {
      return {
        notif_id: n.notif_id,
        tipo: n.tipo,
        titulo: n.titulo,
        mensaje: n.mensaje,
        modulo_id: n.modulo_id,
        texto_accion: n.texto_accion,
        creada_en: n.creada_en
      };
    })
  };
}

// v7.1: marcar como leida/descartada. Solo el propio destinatario puede
// marcarla (evita que un notif_id adivinado silencie la alerta de otra
// persona) -- si no matchea, no hace nada (silencioso, es un "dismiss", no
// una operacion que deba fallar ruidosamente en el cliente).
function marcarNotificacionAppLeida_(contexto, notifId) {
  if (!notifId) return { actualizado: false };
  var fila = leerFilasSeguro_(SHEETS.NOTIFICACIONES_APP).filter(function (n) {
    return n.notif_id === notifId;
  })[0];
  if (!fila || fila.destinatario_email !== contexto.email) {
    return { actualizado: false };
  }
  actualizarFilaPorId_(SHEETS.NOTIFICACIONES_APP, 'notif_id', notifId, { leida: 'TRUE' });
  return { actualizado: true };
}
