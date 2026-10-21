'use strict';

/**
 * codigo.js — código TOTP actual de un usuario de una base de demostración o de
 * piloto (los secretos los generó preparar-*.js en esa carpeta).
 *
 *   node backend/herramientas/finanzas-demo/codigo.js <carpeta> <usuario>
 */

const fs = require('node:fs');
const path = require('node:path');
const G = require('./guardia');

const dir = G.usarCarpeta(process.argv[2]);
const B = require(G.RAIZ + '/logica/finanzasBoveda');
const sec = JSON.parse(fs.readFileSync(path.join(dir, 'secretos.json'), 'utf8'))[process.argv[3] || ''];
if (!sec) { console.error('Usuario desconocido en esta base.'); process.exit(1); }
const ahora = Date.now();
console.log(B.codigoTotp(sec, B.contadorActual_(ahora)) + ' (quedan ' + (30 - Math.floor(ahora / 1000) % 30) + ' s)');
