'use strict';

/**
 * servidor.js — levanta la API de SIGSO sobre una base de demostración o de
 * piloto (puerto 3099), con la misma protección de carpeta.
 *
 *   node backend/herramientas/finanzas-demo/servidor.js <carpeta>
 *
 * El frontend local debe apuntar a http://127.0.0.1:3099 (frontend/js/config.js):
 * ese cambio es SOLO local y nunca se sube (ver el plan de publicación).
 */

const G = require('./guardia');
G.usarCarpeta(process.argv[2]);
require(G.RAIZ + '/server/index.js');
