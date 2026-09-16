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
}, INTERVALO_COLA_CORREO_MS);
intervaloColaCorreo.unref();

// Equivalente de enviarDigestJefaturaTrigger (backend/backoffice/Triggers.gs,
// diario a las 18:00 America/Santiago). Sin cron en Node: se revisa en el
// mismo grano de 5 min si la hora local cayo en la ventana [18:00, 18:05) --
// como el proceso corre con TZ=America/Santiago (ver systemd), getHours()
// ya da la hora de Chile directo. Llamar de mas dentro de esa ventana no
// duplica nada: el dedup diario de enviarDigestJefatura (evento con
// claveDia_) ya lo hace idempotente.
const intervaloDigestJefatura = setInterval(() => {
  const ahora = new Date();
  if (ahora.getHours() === 18 && ahora.getMinutes() < 5) {
    Notificaciones.enviarDigestJefatura(db).catch((err) => {
      console.error('error enviando el digest de Jefatura:', err);
    });
  }
}, INTERVALO_COLA_CORREO_MS);
intervaloDigestJefatura.unref();

// Apagado ordenado cuando systemd manda SIGTERM (en cada despliegue/restart).
process.on('SIGTERM', () => {
  console.log('SIGTERM recibido, cerrando servidor...');
  clearInterval(intervaloColaCorreo);
  clearInterval(intervaloDigestJefatura);
  server.close(() => process.exit(0));
});
