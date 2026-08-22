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

// v6.0 Fase P4: el recordatorio de pausa va en el bucket de 5 min para que
// salga a tiempo (segun min_anticipacion de cada empresa) sin un trigger a una
// hora fija que no serviria para varias horas de pausa.
// v6.0 (mejora #5): segundo aviso (ultima llamada + avisar a la coordinadora)
// va en el mismo bucket de 5 min -- necesita revisar seguido si ya llego la
// hora exacta de cada pausa, igual que el recordatorio de arriba.
var FUNCIONES_TRIGGER_CADA_5_MIN = ['procesarColaDocumentosTrigger', 'procesarColaCorreoTrigger', 'refrescarCacheTrigger', 'enviarRecordatoriosPausasTrigger', 'enviarSegundosAvisosPausasTrigger'];

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

  // v5.2 (Fase B, §4.2): reporte ejecutivo a Gerencia -- lunes 09:00, igual
  // que el resumen semanal (a Analista/Admin). Son destinatarios y formato
  // distintos (Gerencia quiere "numeros grandes", no el resumen tecnico),
  // por eso es un trigger propio en vez de sumar el rol a uno existente.
  if (existentes.indexOf('enviarReporteEjecutivoSemanalTrigger') === -1) {
    ScriptApp.newTrigger('enviarReporteEjecutivoSemanalTrigger').timeBased()
      .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).create();
    creados.push('enviarReporteEjecutivoSemanalTrigger');
  }

  // v4.2 (§4): "al finalizar el dia poder ver que ocurrio en su
  // departamento" -- fin de jornada, 18:00, diario.
  if (existentes.indexOf('enviarDigestJefaturaTrigger') === -1) {
    ScriptApp.newTrigger('enviarDigestJefaturaTrigger').timeBased().atHour(18).everyDays(1).create();
    creados.push('enviarDigestJefaturaTrigger');
  }

  // v6.0 Fase P1: crea la pausa activa del dia por cada empresa configurada.
  // Temprano (06:00) para que ya exista cuando salga el recordatorio (P4) y
  // cuando la coordinadora entre a operarla. Es idempotente: si ya existe la
  // del dia, no duplica (ver Pausas.programarDelDia).
  if (existentes.indexOf('programarPausasDiariasTrigger') === -1) {
    ScriptApp.newTrigger('programarPausasDiariasTrigger').timeBased().atHour(6).everyDays(1).create();
    creados.push('programarPausasDiariasTrigger');
  }

  // v6.0 Fase P4: resumen de fin de dia de las pausas (a coordinadoras + admin),
  // 19:00, despues de la jornada.
  if (existentes.indexOf('enviarResumenPausasDiarioTrigger') === -1) {
    ScriptApp.newTrigger('enviarResumenPausasDiarioTrigger').timeBased().atHour(19).everyDays(1).create();
    creados.push('enviarResumenPausasDiarioTrigger');
  }

  // v6.0 (mejora): cierre automatico de pausas que quedaron abiertas al final
  // del dia (la coordinadora nunca las abrio o las abrio y no las cerro).
  // 23:00, despues del resumen diario (19:00) -- asi el resumen todavia
  // refleja el estado real "en curso"/"pendiente" y este trigger resuelve lo
  // que quedo colgado antes de que empiece el dia siguiente.
  if (existentes.indexOf('cerrarPausasAbiertasDelDiaTrigger') === -1) {
    ScriptApp.newTrigger('cerrarPausasAbiertasDelDiaTrigger').timeBased().atHour(23).everyDays(1).create();
    creados.push('cerrarPausasAbiertasDelDiaTrigger');
  }

  // v6.0 Fase P5: reporte periodico de pausas a Gerencia + prevencionistas
  // (correo HTML + PDF). Semanal lunes 08:00, mensual dia 1 a las 08:00.
  if (existentes.indexOf('enviarReporteSemanalPausasTrigger') === -1) {
    ScriptApp.newTrigger('enviarReporteSemanalPausasTrigger').timeBased()
      .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
    creados.push('enviarReporteSemanalPausasTrigger');
  }
  if (existentes.indexOf('enviarReporteMensualPausasTrigger') === -1) {
    ScriptApp.newTrigger('enviarReporteMensualPausasTrigger').timeBased().onMonthDay(1).atHour(8).create();
    creados.push('enviarReporteMensualPausasTrigger');
  }

  // v6.5 Fase 2 (Novedades): el recordatorio diario NO tiene un trigger de
  // tiempo propio -- Apps Script limita a 20 triggers de tiempo por script
  // (cuenta estandar) y ya estaban los 20 usados. En vez de eso, se cuelga
  // de recordarValidacionPendienteTrigger (09:00 diario, ver mas abajo):
  // mismo horario, sin gastar un slot nuevo.

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

// v5.2 (Fase B, §4.2): ver Notificaciones.enviarReporteEjecutivoSemanal().
function enviarReporteEjecutivoSemanalTrigger() {
  return Notificaciones.enviarReporteEjecutivoSemanal();
}

// v4.2 (§4): ver Notificaciones.enviarDigestJefatura().
function enviarDigestJefaturaTrigger() {
  return Notificaciones.enviarDigestJefatura();
}

// v6.0 Fase P1: ver Pausas.programarDelDia(). El trigger corre sin contexto de
// usuario (lo dispara el sistema), asi que no pasa `contexto` -- el log queda
// atribuido a "sistema".
function programarPausasDiariasTrigger() {
  return Pausas.programarDelDia(new Date());
}

// v6.0 Fase P4: recordatorio a los trabajadores/coordinadoras de la pausa que
// se acerca (segun min_anticipacion). Corre cada 5 min; ver
// Pausas.enviarRecordatoriosPausas().
function enviarRecordatoriosPausasTrigger() {
  return Pausas.enviarRecordatoriosPausas();
}

// v6.0 (mejora #5): segundo aviso -- "ultima llamada" a los trabajadores +
// aviso a la coordinadora de que es hora de iniciar. Ver
// Pausas.enviarSegundosAvisosPausas().
function enviarSegundosAvisosPausasTrigger() {
  var resultado = Pausas.enviarSegundosAvisosPausas();
  // v7.2 (Bloque A, mejora A8 "resiliencia del coordinador"): sin trigger
  // propio (limite de 20 ya copado, ver FUNCIONES_TRIGGER_CADA_5_MIN) --
  // colgada de este mismo slot de 5 min, que es el que ya revisa el estado
  // de las pausas del dia. En try/catch: si la escalada fallara, no debe
  // tumbar el segundo aviso, que es el dueno real de este slot.
  try {
    Pausas.escalarPausasSinIniciar();
  } catch (err) {
    logError_(err, 'Triggers.enviarSegundosAvisosPausasTrigger:escalarPausasSinIniciar');
  }
  return resultado;
}

// v6.0 Fase P4: resumen de fin de dia de las pausas. Ver
// Pausas.enviarResumenDiarioPausas().
function enviarResumenPausasDiarioTrigger() {
  return Pausas.enviarResumenDiarioPausas();
}

// v6.0 Fase P5: reportes periodicos de pausas (correo + PDF) a Gerencia +
// prevencionistas. Ver Pausas.enviarReporteSemanalPausas/Mensual.
function enviarReporteSemanalPausasTrigger() {
  return Pausas.enviarReporteSemanalPausas();
}

function enviarReporteMensualPausasTrigger() {
  return Pausas.enviarReporteMensualPausas();
}

// v6.0 (mejora): cierre automatico de pausas abiertas al final del dia. Ver
// Pausas.cerrarPausasAbiertasDelDia().
function cerrarPausasAbiertasDelDiaTrigger() {
  return Pausas.cerrarPausasAbiertasDelDia();
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
/**
 * Presupuesto de tiempo del pase diario.
 *
 * Apps Script corta una ejecucion a los 6 minutos. De este unico slot cuelgan
 * el mantenimiento y diez avisos, y hasta ahora corrian en cascada sin mirar
 * el reloj: si el tiempo se agotaba, la ejecucion moria a medias -- sin pasar
 * por ningun catch, sin registro, y con los ultimos avisos sin ejecutar.
 *
 * Se reservan 5 de los 6 minutos para EMPEZAR trabajos nuevos. El minuto que
 * queda es el margen para que termine el ultimo que alcanzo a arrancar.
 *
 * ALCANCE HONESTO: esto evita la cascada ("arrancar el aviso 8 en el minuto
 * 5:55"), no evita que un solo aviso se demore mas que todo el presupuesto.
 * Para eso haria falta que cada aviso supiera abortarse a si mismo.
 */
var MS_PRESUPUESTO_PASE = 5 * 60 * 1000;

// Donde arrancar la proxima vez. Sin esto, un presupuesto que siempre se
// agota en el mismo punto convertiria "fallo silencioso" en algo peor: los
// ultimos avisos de la lista no correrian NUNCA. Rotando, todos se atienden.
var CLAVE_ROTACION_PASE = 'SIGSO_PASE_DIARIO_DESDE';

// Los avisos que comparten este slot, en su orden historico. Cada uno ya
// existe como funcion propia para poder forzarlo a mano desde el editor.
var AVISOS_DEL_PASE_DIARIO = [
  ['recordatorio_novedades', enviarRecordatorioNovedadesTrigger],
  ['alertas_actividades', enviarAlertasActividadesTrigger],
  ['recordatorio_calidad', enviarRecordatorioCalidadTrigger],
  ['recordatorio_competencias', enviarRecordatorioCompetenciasTrigger],
  ['avisos_nc_vencidas', enviarAvisosNcVencidasTrigger],
  ['avisos_auditorias', enviarAvisosAuditoriasTrigger],
  ['avisos_quejas', enviarAvisosQuejasTrigger],
  ['avisos_proveedores', enviarAvisosProveedoresTrigger],
  ['avisos_revision', enviarAvisosRevisionTrigger],
  ['avisos_objetivos', enviarAvisosObjetivosTrigger]
];

function recordarValidacionPendienteTrigger() {
  var inicio = Date.now();

  // MANTENIMIENTO PRIMERO (H-03) y siempre, fuera del presupuesto: es barato,
  // acotado, y es lo que impide que las hojas crezcan sin freno. Con las
  // purgas al final, el dia que el tiempo se agotara se perderia justo lo que
  // contiene el crecimiento -- y esas hojas, al crecer, hacen mas lento todo
  // lo demas.
  try {
    mantenimientoDiarioTrigger();
  } catch (err) {
    logError_(err, 'Triggers.recordarValidacionPendienteTrigger:mantenimientoDiarioTrigger');
  }

  // El dueno real de este slot: corre siempre, antes que los invitados.
  var resultado = Triggers.recordarValidacionPendiente();

  // Los diez avisos que se cuelgan de aqui (limite de 20 triggers copado),
  // bajo presupuesto y rotando.
  resultado.pase = ejecutarAvisosDelPase_(inicio);

  return resultado;
}

/**
 * Corre los avisos mientras quede presupuesto, empezando donde se quedo el
 * pase anterior. Lo que no alcanza a correr queda REGISTRADO: el problema de
 * antes no era que faltara tiempo, era que nadie se enteraba.
 */
function ejecutarAvisosDelPase_(inicio) {
  var total = AVISOS_DEL_PASE_DIARIO.length;
  var desde = leerDesdePase_(total);
  var corridos = [];
  var omitidos = [];

  for (var i = 0; i < total; i++) {
    var par = AVISOS_DEL_PASE_DIARIO[(desde + i) % total];
    if (Date.now() - inicio > MS_PRESUPUESTO_PASE) {
      omitidos.push(par[0]);
      continue;
    }
    // El try/catch por aviso se mantiene: que uno falle no debe impedir los
    // que vienen detras. Un fallo cuenta como "corrido" -- ya tuvo su turno,
    // y repetirlo manana antes que los demas seria castigar al resto.
    try {
      par[1]();
    } catch (err) {
      logError_(err, 'Triggers.paseDiario:' + par[0]);
    }
    corridos.push(par[0]);
  }

  // Si algo quedo fuera, manana se arranca por ahi. Si corrio todo, se vuelve
  // al orden natural para que el pase sea predecible.
  guardarDesdePase_(omitidos.length ? (desde + corridos.length) % total : 0);

  if (omitidos.length) {
    try {
      agregarFila_(SHEETS.LOG_SISTEMA, {
        log_id: Utilities.getUuid(),
        timestamp: new Date().toISOString(),
        contexto: 'PASE_DIARIO_INCOMPLETO',
        mensaje: 'Se agoto el presupuesto de tiempo. Sin ejecutar: ' + omitidos.join(', ') +
          '. Se retomaran manana desde ahi.',
        ref: 'PASE_DIARIO'
      });
    } catch (err) { /* trazabilidad best-effort */ }
  }

  return {
    corridos: corridos,
    omitidos: omitidos,
    ms: Date.now() - inicio
  };
}

function leerDesdePase_(total) {
  try {
    var valor = Number(PropertiesService.getScriptProperties().getProperty(CLAVE_ROTACION_PASE));
    return (valor >= 0 && valor < total) ? valor : 0;
  } catch (err) {
    return 0;
  }
}

function guardarDesdePase_(valor) {
  try {
    PropertiesService.getScriptProperties().setProperty(CLAVE_ROTACION_PASE, String(valor));
  } catch (err) { /* sin Script Properties: el pase igual corre, sin rotar */ }
}

// v6.5 Fase 2: ver Novedades.recordatorioPendientes(). Se deja como funcion
// nombrada (en vez de inline) para poder ejecutarla manualmente desde el
// editor de Apps Script si hace falta probarla o forzarla fuera de horario.
function enviarRecordatorioNovedadesTrigger() {
  return Novedades.recordatorioPendientes();
}

// v7.0 (Fase 4): ver Notificaciones.enviarAlertasActividades(). Nombrada
// igual que enviarRecordatorioNovedadesTrigger, mismo motivo: poder
// forzarla a mano desde el editor de Apps Script.
function enviarAlertasActividadesTrigger() {
  return Notificaciones.enviarAlertasActividades();
}

// v10.0 Fase 1b (SGC ISO 9001): ver Calidad.recordatorioPendientes().
// Nombrada igual que las anteriores y por el mismo motivo: poder forzarla a
// mano desde el editor de Apps Script sin esperar a las 09:00.
function enviarRecordatorioCalidadTrigger() {
  return Calidad.recordatorioPendientes();
}

// v10.0 Fase 2b: ver Personas.recordatorioCompetencias(). Nombrada igual
// que las anteriores, mismo motivo: poder forzarla a mano desde el editor.
function enviarRecordatorioCompetenciasTrigger() {
  return Personas.recordatorioCompetencias();
}

// v10.0 Fase 3a: ver NoConformidades.recordatorioVencidas(). Nombrada igual
// que las anteriores, mismo motivo: poder forzarla a mano desde el editor.
function enviarAvisosNcVencidasTrigger() {
  return NoConformidades.recordatorioVencidas();
}

// v10.0 Fase 3b: ver Auditorias.recordatorioPendientes(). Nombrada igual
// que las anteriores, mismo motivo: poder forzarla a mano desde el editor.
function enviarAvisosAuditoriasTrigger() {
  return Auditorias.recordatorioPendientes();
}

// v10.0 Fase 4: ver Quejas.recordatorioPendientes(). Nombrada igual que
// las anteriores, mismo motivo: poder forzarla a mano desde el editor.
function enviarAvisosQuejasTrigger() {
  return Quejas.recordatorioPendientes();
}

// v10.0 Fase 5a: ver Proveedores.recordatorioPendientes(). Mismo criterio de
// nombre que las anteriores, para poder forzarla a mano desde el editor.
function enviarAvisosProveedoresTrigger() {
  return Proveedores.recordatorioPendientes();
}

// v10.0 Fase 5b: ver RevisionDireccion.recordatorioPendientes().
function enviarAvisosRevisionTrigger() {
  return RevisionDireccion.recordatorioPendientes();
}

// v10.0 Fase 6a: ver Objetivos.alertarLecturasPendientes(). Avisa cuando un
// periodo ya cerro y su objetivo sigue sin medirse.
function enviarAvisosObjetivosTrigger() {
  return Objetivos.alertarLecturasPendientes();
}


// Mantenimiento diario de las hojas que crecen sin freno. Agrupado en una
// sola funcion para que corra COMPLETO o no corra: si quedara repartido, un
// corte por tiempo dejaria unas hojas purgadas y otras no, sin forma de
// saber cuales. Cada purga va en su propio try/catch -- que falle una no
// debe impedir las demas.
//
// Se puede ejecutar a mano desde el editor de Apps Script.
function mantenimientoDiarioTrigger() {
  var resumen = {};
  [
    ['notificaciones_app', purgarNotificacionesApp_],
    ['sesiones_portal', purgarSesionesExpiradas_],
    ['log_notificaciones', purgarLogNotificaciones_],
    ['log_sistema', purgarLogSistema_]
  ].forEach(function (par) {
    try {
      resumen[par[0]] = par[1]().borradas;
    } catch (err) {
      resumen[par[0]] = null;
      logError_(err, 'Triggers.mantenimientoDiario:' + par[0]);
    }
  });
  Logger.log('Mantenimiento diario: ' + JSON.stringify(resumen));
  return resumen;
}

// v7.1 (notificaciones vivas, B5): ver purgarNotificacionesApp_(). Nombrada
// para poder forzarla a mano desde el editor de Apps Script.
function purgarNotificacionesAppTrigger() {
  return purgarNotificacionesApp_();
}

// Ver purgarSesionesExpiradas_ (CuentasPortal.gs). Nombrada igual que el
// resto para poder forzarla a mano desde el editor de Apps Script.
function purgarSesionesExpiradasTrigger() {
  return purgarSesionesExpiradas_();
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
// ya en S09, o sin SLA definido -- P5).
//
// v6.1: delega en Sla.medir (Cumplimiento.gs), que es la unica fuente de
// verdad del eje SLA -- este umbral del 80% (A-08) es el mismo que ahora usa
// la Bandeja para el grupo "En riesgo", asi que no puede vivir en dos partes.
function ratioSlaConsumido_(subsolicitud, feriados) {
  var medicion = Sla.medir(subsolicitud, { feriados: feriados });
  return medicion ? medicion.ratio : null;
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
