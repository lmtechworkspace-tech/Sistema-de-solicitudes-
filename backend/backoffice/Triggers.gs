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

// §17.4 v1.0: reportes programados, ver Notificaciones.gs.
function enviarResumenSemanalTrigger() {
  return Notificaciones.enviarResumenSemanal();
}

function enviarReporteMensualTrigger() {
  return Notificaciones.enviarReporteMensual();
}

// A-07 (§16.3 v1.0): recorre las subsolicitudes abiertas y dispara A-08
// (SLA >= 80%) o A-09 (SLA > 100%) segun corresponda. No persiste un flag
// de "vencido" (se mantiene el calculo al vuelo ya usado por el Dashboard,
// ver RECONCILIACION-v1.0.md) -- solo envia las alertas.
function verificarSLAsTrigger() {
  return Triggers.verificarSLAs();
}

// RN-201/RF-208: dias habiles que un item puede quedar en "Terminada" (S08)
// sin que el solicitante lo valide antes de cerrarlo solo. 5 dias habiles
// (una semana laboral) -- suficiente margen para que el solicitante revise
// sin dejar items "Terminada" acumulandose indefinidamente sin auditoria.
var DIAS_HABILES_CIERRE_AUTOMATICO = 5;

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
        var ultimaEntradaS08 = historial
          .filter(function (h) { return h.subsolicitud_id === sub.subsolicitud_id && h.estado_nuevo === ESTADOS.S08; })
          .sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); })[0];
        if (!ultimaEntradaS08) {
          return;
        }
        var diasHabiles = Utils.horasHabilesEntre(ultimaEntradaS08.timestamp, new Date(), { feriados: feriados }) / 9;
        if (diasHabiles < DIAS_HABILES_CIERRE_AUTOMATICO) {
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
