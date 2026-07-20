/**
 * Triggers.gs — instalacion de triggers de tiempo (§13/§16.3 v1.0):
 *   A-04 cola de documentos, A-12 cola de correo (Fase 4);
 *   A-07 verificacion de SLAs, A-08/09 alertas de SLA, A-10 refresco de
 *   cache, A-11 suspension de inactivos (Fase 7).
 * Se ejecuta UNA VEZ al instalar el sistema ("configurarTriggers() se
 * ejecuta una sola vez en la instalacion", §13 v1.1). Es idempotente: si
 * un trigger ya existe (por nombre de funcion), no lo duplica.
 *
 * ScriptApp.newTrigger() exige el nombre de una funcion global (no un
 * metodo de Documentos/Notificaciones/Auth/Dashboard): por eso los
 * wrappers de abajo.
 *
 * v1.0 (AUTO-011, "limpiarSesionesExpiradas") se retira explicitamente en
 * v1.1 §13: "al no haber sesiones propias, no hay tokens que limpiar" — no
 * se implementa ese trigger.
 */

var FUNCIONES_TRIGGER_CADA_5_MIN = ['procesarColaDocumentosTrigger', 'procesarColaCorreoTrigger', 'refrescarCacheTrigger'];

function configurarTriggers() {
  var existentes = ScriptApp.getProjectTriggers().map(function (t) {
    return t.getHandlerFunction();
  });
  var creados = [];

  FUNCIONES_TRIGGER_CADA_5_MIN.forEach(function (nombreFuncion) {
    if (existentes.indexOf(nombreFuncion) === -1) {
      ScriptApp.newTrigger(nombreFuncion).timeBased().everyMinutes(MINUTOS_ENTRE_CORRIDAS).create();
      creados.push(nombreFuncion);
    }
  });

  // A-07 (§16.3 v1.0): diario 09:00 America/Santiago (Config.gs fija esa
  // zona horaria para el proyecto completo).
  if (existentes.indexOf('verificarSLAsTrigger') === -1) {
    ScriptApp.newTrigger('verificarSLAsTrigger').timeBased().atHour(9).everyDays(1).create();
    creados.push('verificarSLAsTrigger');
  }

  // A-11 (§16.3 v1.0): semanal, lunes 08:00.
  if (existentes.indexOf('suspenderInactivosTrigger') === -1) {
    ScriptApp.newTrigger('suspenderInactivosTrigger').timeBased()
      .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
    creados.push('suspenderInactivosTrigger');
  }

  // RN-201/RF-208 (v2.0, Sprint 1): diario 09:00, igual que verificarSLAs --
  // cierra por inactividad los items "Terminada" que el solicitante nunca
  // valido (ver Triggers.cerrarInactivosPorValidacion mas abajo).
  if (existentes.indexOf('cerrarInactivosTrigger') === -1) {
    ScriptApp.newTrigger('cerrarInactivosTrigger').timeBased().atHour(9).everyDays(1).create();
    creados.push('cerrarInactivosTrigger');
  }

  // P7 (v2.0, Sprint 3): diario 09:00 -- ver Triggers.detectarPatrones.
  if (existentes.indexOf('detectarPatronesTrigger') === -1) {
    ScriptApp.newTrigger('detectarPatronesTrigger').timeBased().atHour(9).everyDays(1).create();
    creados.push('detectarPatronesTrigger');
  }

  // v2.1 (Fase D, §8): "en riesgo" -- misma cadencia que verificarSLAsTrigger
  // (diario 09:00), analoga en espiritu a esa alerta pero sobre la fecha
  // comprometida en vez del SLA automatico.
  if (existentes.indexOf('verificarFechasComprometidasTrigger') === -1) {
    ScriptApp.newTrigger('verificarFechasComprometidasTrigger').timeBased().atHour(9).everyDays(1).create();
    creados.push('verificarFechasComprometidasTrigger');
  }

  // v2.1 (Fase D, §8): recordatorio de validacion pendiente -- mismo horario,
  // corre ANTES de que cerrarInactivosTrigger cierre automaticamente.
  if (existentes.indexOf('recordarValidacionPendienteTrigger') === -1) {
    ScriptApp.newTrigger('recordarValidacionPendienteTrigger').timeBased().atHour(9).everyDays(1).create();
    creados.push('recordarValidacionPendienteTrigger');
  }

  // §17.4 v1.0: resumen semanal (lunes 09:00) y reporte mensual (dia 1).
  if (existentes.indexOf('enviarResumenSemanalTrigger') === -1) {
    ScriptApp.newTrigger('enviarResumenSemanalTrigger').timeBased()
      .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).create();
    creados.push('enviarResumenSemanalTrigger');
  }
  if (existentes.indexOf('enviarReporteMensualTrigger') === -1) {
    ScriptApp.newTrigger('enviarReporteMensualTrigger').timeBased().onMonthDay(1).atHour(9).create();
    creados.push('enviarReporteMensualTrigger');
  }

  // v4.2 (§4): "al finalizar el dia poder ver que ocurrio en su
  // departamento" -- fin de jornada, 18:00, diario.
  if (existentes.indexOf('enviarDigestJefaturaTrigger') === -1) {
    ScriptApp.newTrigger('enviarDigestJefaturaTrigger').timeBased().atHour(18).everyDays(1).create();
    creados.push('enviarDigestJefaturaTrigger');
  }

  return creados;
}

var MINUTOS_ENTRE_CORRIDAS = 5;

function procesarColaDocumentosTrigger() {
  return Documentos.procesarColaDocumentos();
}

function procesarColaCorreoTrigger() {
  return Notificaciones.procesarColaCorreo();
}

// A-10 (§13 v1.1): mantiene el cache del dashboard siempre tibio,
// refrescandolo antes de que expire su TTL (CACHE_TTL_SEGUNDOS, Dashboard.gs
// = 300s = 5 min, de ahi la cadencia elegida en vez de los 30 min de v1.0).
function refrescarCacheTrigger() {
  return Dashboard.refrescarCache();
}

// A-11 (RN-029): ver Auth.suspenderInactivos().
function suspenderInactivosTrigger() {
  return Auth.suspenderInactivos();
}

// RN-201/RF-208 (v2.0, Sprint 1): ver Triggers.cerrarInactivosPorValidacion().
function cerrarInactivosTrigger() {
  return Triggers.cerrarInactivosPorValidacion();
}

// P7 (v2.0, Sprint 3): ver Triggers.detectarPatrones().
function detectarPatronesTrigger() {
  return Triggers.detectarPatrones();
}

// §17.4 v1.0: reportes programados, ver Notificaciones.gs.
function enviarResumenSemanalTrigger() {
  return Notificaciones.enviarResumenSemanal();
}

function enviarReporteMensualTrigger() {
  return Notificaciones.enviarReporteMensual();
}

// v4.2 (§4): ver Notificaciones.enviarDigestJefatura().
function enviarDigestJefaturaTrigger() {
  return Notificaciones.enviarDigestJefatura();
}

// A-07 (§16.3 v1.0): recorre las subsolicitudes abiertas y dispara A-08
// (SLA >= 80%) o A-09 (SLA > 100%) segun corresponda. No persiste un flag
// de "vencido" (se mantiene el calculo al vuelo ya usado por el Dashboard,
// ver RECONCILIACION-v1.0.md) -- solo envia las alertas.
function verificarSLAsTrigger() {
  return Triggers.verificarSLAs();
}

// v2.1 (Fase D, §8): ver Triggers.verificarFechasComprometidas().
function verificarFechasComprometidasTrigger() {
  return Triggers.verificarFechasComprometidas();
}

// v2.1 (Fase D, §8): ver Triggers.recordarValidacionPendiente().
function recordarValidacionPendienteTrigger() {
  return Triggers.recordarValidacionPendiente();
}

// RN-201/RF-208: dias habiles que un item puede quedar en "Terminada" (S08)
// sin que el solicitante lo valide antes de cerrarlo solo. 5 dias habiles
// (una semana laboral) -- suficiente margen para que el solicitante revise
// sin dejar items "Terminada" acumulandose indefinidamente sin auditoria.
var DIAS_HABILES_CIERRE_AUTOMATICO = 5;

// v2.1 (Fase D, §8): recordar ANTES de que actue el cierre automatico --
// deja margen real para que el solicitante reaccione al aviso (2 de los 5
// dias habiles de plazo) sin ser tan temprano que se sienta prematuro.
var UMBRAL_RECORDATORIO_DIAS_HABILES = 2;

var Triggers = {
  verificarSLAs: function () {
    var feriados = obtenerFeriados_();
    var resumen = { proximos: 0, vencidos: 0 };

    leerFilas_(SHEETS.SUBSOLICITUDES).forEach(function (subsolicitud) {
      var ratio = ratioSlaConsumido_(subsolicitud, feriados);
      if (ratio === null) {
        return;
      }
      var solicitud = buscarSolicitudPorId_(subsolicitud.solicitud_id);
      if (!solicitud) {
        return;
      }
      if (ratio > 1) {
        Notificaciones.alertaSLAVencido(subsolicitud, solicitud);
        resumen.vencidos++;
      } else if (ratio >= 0.8) {
        Notificaciones.alertaSLAProximo(subsolicitud, solicitud);
        resumen.proximos++;
      }
    });

    return resumen;
  },

  // RN-201/RF-208: recorre los items en "Terminada" (S08) y cierra
  // automaticamente (S09) los que llevan >= DIAS_HABILES_CIERRE_AUTOMATICO
  // dias habiles sin que el solicitante los haya validado (confirmado o
  // reabierto) desde Consultar Estado. Usa la ultima transicion HACIA S08 en
  // HISTORIAL_ESTADOS como punto de partida -- si Leo lo reabrio y lo volvio
  // a terminar, el conteo arranca de nuevo desde esa ultima vez.
  cerrarInactivosPorValidacion: function () {
    var feriados = obtenerFeriados_();
    var historial = leerFilas_(SHEETS.HISTORIAL_ESTADOS);
    var cerrados = [];

    leerFilas_(SHEETS.SUBSOLICITUDES)
      .filter(function (s) { return s.estado === ESTADOS.S08; })
      .forEach(function (sub) {
        var diasHabiles = diasHabilesEnTerminada_(sub, historial, feriados);
        if (diasHabiles === null || diasHabiles < DIAS_HABILES_CIERRE_AUTOMATICO) {
          return;
        }
        var resultado = Solicitudes.actualizarEstado(
          {
            subsolicitud_id: sub.subsolicitud_id,
            estado_nuevo: ESTADOS.S09,
            comentario: 'Cierre automatico: sin validacion del solicitante tras ' + DIAS_HABILES_CIERRE_AUTOMATICO + ' dias habiles en Terminada (RN-201).'
          },
          { email: 'sistema@sigso', rol: 'ADM' },
          { sistemaAutomatico: true }
        );
        if (!resultado._validationError && !resultado._forbidden) {
          cerrados.push(sub.subsolicitud_id);
        }
      });

    return { cerrados: cerrados.length, ids: cerrados };
  },

  // v2.1 (Fase D, §8): analoga a verificarSLAs pero sobre la fecha
  // comprometida (Cumplimiento.gs, Fase B) en vez del SLA automatico --
  // avisa mientras un item esta "en riesgo" (< 1 dia habil de su fecha
  // comprometida y aun no entregado). Reutiliza el semaforo ya calculado,
  // no reimplementa la logica de fechas.
  verificarFechasComprometidas: function () {
    var avisados = 0;
    leerFilas_(SHEETS.SUBSOLICITUDES).forEach(function (subsolicitud) {
      if (!subsolicitud.fecha_comprometida) {
        return;
      }
      var cumplimiento = Cumplimiento.clasificar(subsolicitud);
      if (cumplimiento.codigo !== 'EN_RIESGO') {
        return;
      }
      var solicitud = buscarSolicitudPorId_(subsolicitud.solicitud_id);
      if (!solicitud) {
        return;
      }
      Notificaciones.alertaFechaEnRiesgo(subsolicitud, solicitud);
      avisados++;
    });
    return { avisados: avisados };
  },

  // v2.1 (Fase D, §8): recordatorio al solicitante ANTES de que
  // cerrarInactivosPorValidacion cierre automaticamente (RN-201) -- entre
  // UMBRAL_RECORDATORIO_DIAS_HABILES y DIAS_HABILES_CIERRE_AUTOMATICO dias
  // en Terminada sin validar.
  recordarValidacionPendiente: function () {
    var feriados = obtenerFeriados_();
    var historial = leerFilas_(SHEETS.HISTORIAL_ESTADOS);
    var recordados = [];

    leerFilas_(SHEETS.SUBSOLICITUDES)
      .filter(function (s) { return s.estado === ESTADOS.S08; })
      .forEach(function (sub) {
        var diasHabiles = diasHabilesEnTerminada_(sub, historial, feriados);
        if (diasHabiles === null || diasHabiles < UMBRAL_RECORDATORIO_DIAS_HABILES || diasHabiles >= DIAS_HABILES_CIERRE_AUTOMATICO) {
          return;
        }
        var solicitud = buscarSolicitudPorId_(sub.solicitud_id);
        if (!solicitud) {
          return;
        }
        Notificaciones.recordarValidacionPendiente(sub, solicitud, Math.round(diasHabiles * 10) / 10);
        recordados.push(sub.subsolicitud_id);
      });

    return { recordados: recordados.length, ids: recordados };
  },

  // P7: recorre las alertas de patron vigentes (Dashboard.calcularAlertasPatron_,
  // mismo umbral que se muestra en el Dashboard) y avisa por correo las que
  // no se hayan avisado ya HOY (dedup via LOG_SISTEMA, contexto
  // ALERTA_PATRON, ref = modulo||tipo) -- evita mandar el mismo aviso cada
  // dia mientras el patron siga activo sin que nadie lo resuelva.
  detectarPatrones: function () {
    var hoy = claveDia_(new Date(), 'America/Santiago');
    var yaAvisadosHoy = {};
    leerFilas_(SHEETS.LOG_SISTEMA).forEach(function (log) {
      if (log.contexto === 'ALERTA_PATRON' && claveDia_(new Date(log.timestamp), 'America/Santiago') === hoy) {
        yaAvisadosHoy[log.ref] = true;
      }
    });

    var avisados = [];
    calcularAlertasPatron_().forEach(function (alerta) {
      var clave = alerta.modulo + '||' + alerta.tipo;
      if (yaAvisadosHoy[clave]) {
        return;
      }
      Notificaciones.notificarPatron(alerta);
      agregarFila_(SHEETS.LOG_SISTEMA, {
        log_id: Utilities.getUuid(),
        timestamp: new Date().toISOString(),
        contexto: 'ALERTA_PATRON',
        mensaje: alerta.modulo + ' acumula ' + alerta.cantidad + ' reportes de tipo ' + alerta.tipo +
          ' (' + alerta.solicitantes_distintos + ' solicitantes distintos) en los ultimos ' + PATRON_VENTANA_DIAS + ' dias.',
        ref: clave
      });
      avisados.push(clave);
    });

    return { avisados: avisados.length, patrones: avisados };
  }
};

// Devuelve null si la subsolicitud no aplica (cerrada/rechazada/cancelada,
// ya en S09, o sin SLA definido -- P5): mismo criterio que
// Dashboard.estaVencidoSla_.
function ratioSlaConsumido_(subsolicitud, feriados) {
  if (ESTADOS_EXCLUIDOS_DERIVACION.indexOf(subsolicitud.estado) !== -1 || subsolicitud.estado === ESTADOS.S09) {
    return null;
  }
  if (subsolicitud.sla_objetivo_horas === '' || subsolicitud.sla_objetivo_horas === undefined || subsolicitud.sla_objetivo_horas === null) {
    return null;
  }
  var transcurridas = Utils.horasHabilesEntre(subsolicitud.fecha_creacion, new Date(), { feriados: feriados });
  return transcurridas / Number(subsolicitud.sla_objetivo_horas);
}

// RN-201/RF-208 + v2.1 (Fase D): dias habiles desde la ULTIMA vez que el
// item entro a "Terminada" (S08) -- compartido por cerrarInactivosPorValidacion
// y recordarValidacionPendiente para no calcular esto dos veces con
// criterios distintos. null si nunca hay una entrada a S08 en el historial
// (no deberia pasar para un item que hoy esta en S08, pero se cubre igual).
function diasHabilesEnTerminada_(subsolicitud, historial, feriados) {
  var ultimaEntradaS08 = historial
    .filter(function (h) { return h.subsolicitud_id === subsolicitud.subsolicitud_id && h.estado_nuevo === ESTADOS.S08; })
    .sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); })[0];
  if (!ultimaEntradaS08) {
    return null;
  }
  return Utils.horasHabilesEntre(ultimaEntradaS08.timestamp, new Date(), { feriados: feriados }) / 9;
}
