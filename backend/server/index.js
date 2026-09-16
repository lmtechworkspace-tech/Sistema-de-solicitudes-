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

const PORT = Number(process.env.SIGSO_PORT || 3000);
const server = crearServidor();

server.listen(PORT, '127.0.0.1', () => {
  console.log('SIGSO API ' + VERSION_API + ' escuchando en 127.0.0.1:' + PORT);
});

// Apagado ordenado cuando systemd manda SIGTERM (en cada despliegue/restart).
process.on('SIGTERM', () => {
  console.log('SIGTERM recibido, cerrando servidor...');
  server.close(() => process.exit(0));
});
