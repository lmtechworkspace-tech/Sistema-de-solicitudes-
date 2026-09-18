'use strict';

/**
 * index.js — punto de arranque del backend Node de SIGSO.
 *
 * Escucha SOLO en 127.0.0.1: el servidor nunca se expone directo a internet,
 * siempre queda detras del proxy inverso (Caddy) que resuelve TLS con el
 * dominio. Asi el firewall solo abre 80/443 y este proceso no es alcanzable
 * desde afuera aunque el puerto quede abierto por error.
 */

const { crearServidor, VERSION_API } = require('./app');
const { abrirDbProduccion } = require('../db');
const Notificaciones = require('../logica/notificaciones');
const Novedades = require('../logica/novedades');
const Pausas = require('../logica/pausas');
const Actividades = require('../logica/actividades');
const Calidad = require('../logica/calidadSgc');
const Personas = require('../logica/personasSgc');
const NoConformidades = require('../logica/noConformidadesSgc');
const Auditorias = require('../logica/auditoriasSgc');
const Quejas = require('../logica/quejasSgc');
const Proveedores = require('../logica/proveedoresSgc');

const PORT = Number(process.env.SIGSO_PORT || 3000);
const db = abrirDbProduccion();
const server = crearServidor(db);

server.listen(PORT, '127.0.0.1', () => {
  console.log('SIGSO API ' + VERSION_API + ' escuchando en 127.0.0.1:' + PORT);
});

// A-12 / equivalente de procesarColaCorreoTrigger (backend/backoffice/
// Triggers.gs, cada 5 min): no hay Triggers de Apps Script en Node, asi que
// esta es la unica forma de que la cola de correo (PENDIENTE_REINTENTO) se
// entregue sola sin depender de que llegue otra peticion HTTP.
const INTERVALO_COLA_CORREO_MS = 5 * 60 * 1000;
const intervaloColaCorreo = setInterval(() => {
  Notificaciones.procesarColaCorreo(db).catch((err) => {
    console.error('error procesando la cola de correo:', err);
  });
  // Pausas: los tres avisos por horario se evaluan en cada tick de 5 min --
  // deciden solos si toca segun la hora local de la pausa (mismo grano que
  // los triggers de 5 min del .gs). Idempotentes (flags por pausa / dedup).
  Pausas.enviarRecordatorios(db).catch((err) => { console.error('error en recordatorios de pausas:', err); });
  Pausas.enviarSegundosAvisos(db).catch((err) => { console.error('error en segundos avisos de pausas:', err); });
  Pausas.escalarPausasSinIniciar(db).catch((err) => { console.error('error escalando pausas:', err); });
}, INTERVALO_COLA_CORREO_MS);
intervaloColaCorreo.unref();

// Equivalentes de los triggers diarios de backend/backoffice/Triggers.gs
// (detectarPatronesTrigger 09:00, enviarDigestJefaturaTrigger 18:00). Sin
// cron en Node: se revisa en el mismo grano de 5 min si la hora local cayo
// en la ventana [HH:00, HH:05) -- como el proceso corre con
// TZ=America/Santiago (ver systemd), getHours() ya da la hora de Chile
// directo. Llamar de mas dentro de esa ventana no duplica nada: el dedup
// diario de cada funcion (LOG_SISTEMA para patrones, claveDia_ en el evento
// para el digest) ya lo hace idempotente.
function enVentanaDiaria_(ahora, hora) {
  return ahora.getHours() === hora && ahora.getMinutes() < 5;
}
const intervaloTriggersDiarios = setInterval(() => {
  const ahora = new Date();
  if (enVentanaDiaria_(ahora, 9)) {
    Notificaciones.detectarPatrones(db).catch((err) => {
      console.error('error detectando patrones:', err);
    });
  }
  if (enVentanaDiaria_(ahora, 18)) {
    Notificaciones.enviarDigestJefatura(db).catch((err) => {
      console.error('error enviando el digest de Jefatura:', err);
    });
  }
  // Recordatorio diario de novedades pendientes de acuse (09:00 America/
  // Santiago). Dedup por evento+dia (NOVEDAD_RECORDATORIO:fecha), igual que
  // los otros: llamarlo de mas dentro de la ventana no duplica correos.
  if (enVentanaDiaria_(ahora, 9)) {
    Novedades.recordatorioPendientes(db).catch((err) => {
      console.error('error enviando el recordatorio de novedades:', err);
    });
    // Actividades: digest diario de alertas por persona (§4.6), mismo pase de
    // las 09:00 que el resto (presupuesto de triggers en 0 en el .gs). Dedup
    // por (evento+dia) via ventana de 24h -> idempotente si se revisa de mas.
    Actividades.enviarAlertasActividades(db).catch((err) => {
      console.error('error enviando alertas de actividades:', err);
    });
    // SGC: recordatorio diario de acuses pendientes + revisiones a 12 meses
    // (PRO-01), mismo pase de las 09:00. Dedup via enviarCorreoModulo.
    Calidad.recordatorioPendientes(db).catch((err) => {
      console.error('error enviando el recordatorio del SGC:', err);
    });
    // SGC Fase 2b: evaluaciones de competencia por vencer/vencidas, horas de
    // formacion bajo meta y eficacia de capacitacion pendiente. Cadencia
    // real (semanal/semestral) la decide el dedup por clave de evento.
    Personas.recordatorioCompetencias(db).catch((err) => {
      console.error('error enviando el recordatorio de competencias del SGC:', err);
    });
    // SGC Fase 3a (PRO-06): no conformidades con plazo vencido -- escala a
    // Direccion desde el dia 5. Dedup diario via enviarCorreoModulo.
    NoConformidades.recordatorioVencidas(db).catch((err) => {
      console.error('error enviando el recordatorio de no conformidades vencidas:', err);
    });
    // SGC Fase 3b (PRO-03): informes de auditoría fuera de plazo, NC sin
    // redactar, auditorías próximas y procesos sin auditar en 12 meses.
    // Cadencia real (diaria/semanal) la decide el dedup de cada aviso.
    Auditorias.recordatorioPendientes(db).catch((err) => {
      console.error('error enviando el recordatorio de auditorías del SGC:', err);
    });
    // SGC Fase 4 (PRO-07): resolución y seguimiento de quejas vencidos (30
    // días corridos, no hábiles). Dedup diario via enviarCorreoModulo.
    Quejas.recordatorioPendientes(db).catch((err) => {
      console.error('error enviando el recordatorio de quejas del SGC:', err);
    });
    // SGC Fase 5a (PRO-04): proveedores con evaluación anual vencida (o
    // nunca evaluados) y proveedores reprobados. Dedup diario.
    Proveedores.recordatorioPendientes(db).catch((err) => {
      console.error('error enviando el recordatorio de proveedores del SGC:', err);
    });
  }
  // Pausas: programar las del dia (06:00), resumen de fin de dia (20:00),
  // cierre automatico nocturno (23:00). Reporte periodico: semanal los lunes
  // 08:00, mensual el dia 1 a las 08:00. Todos idempotentes/dedup por dia.
  if (enVentanaDiaria_(ahora, 6)) {
    try { Pausas.programarDelDia(db, new Date(), { email: 'sistema' }); } catch (err) { console.error('error programando pausas del dia:', err); }
  }
  if (enVentanaDiaria_(ahora, 20)) {
    Pausas.enviarResumenDiario(db).catch((err) => { console.error('error en resumen diario de pausas:', err); });
  }
  if (enVentanaDiaria_(ahora, 23)) {
    try { Pausas.cerrarPausasAbiertas(db); } catch (err) { console.error('error cerrando pausas del dia:', err); }
  }
  if (enVentanaDiaria_(ahora, 8) && ahora.getDay() === 1) {
    Pausas.enviarReportePeriodico(db, 'semanal').catch((err) => { console.error('error en reporte semanal de pausas:', err); });
  }
  if (enVentanaDiaria_(ahora, 8) && ahora.getDate() === 1) {
    Pausas.enviarReportePeriodico(db, 'mensual').catch((err) => { console.error('error en reporte mensual de pausas:', err); });
  }
}, INTERVALO_COLA_CORREO_MS);
intervaloTriggersDiarios.unref();

// Apagado ordenado cuando systemd manda SIGTERM (en cada despliegue/restart).
process.on('SIGTERM', () => {
  console.log('SIGTERM recibido, cerrando servidor...');
  clearInterval(intervaloColaCorreo);
  clearInterval(intervaloTriggersDiarios);
  server.close(() => process.exit(0));
});
