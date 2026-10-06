'use strict';

/**
 * finanzas-boveda.js — herramienta de servidor de la bóveda de Finanzas
 * (backend/logica/finanzasBoveda.js). Es la ÚNICA forma de hacer lo que a
 * propósito no tiene pantalla. Se corre por SSH en el VPS:
 *
 *   node backend/scripts/finanzas-boveda.js llave
 *       Genera una llave nueva (32 bytes, base64) para SIGSO_FINANZAS_LLAVE.
 *       Guárdala TAMBIÉN fuera del servidor (gestor de contraseñas): si se
 *       pierde, los datos cifrados de la bóveda no se pueden recuperar.
 *
 *   node backend/scripts/finanzas-boveda.js reiniciar <usuario>
 *       Borra el autenticador de esa persona (cambió o perdió el teléfono) y
 *       cierra sus sesiones. La próxima vez vuelve a registrarlo con su
 *       contraseña de SIGSO.
 *
 *   node backend/scripts/finanzas-boveda.js verificar
 *       Recorre la bitácora encadenada y dice si alguien la editó a mano.
 *
 * Lee la configuración de /etc/sigso/finanzas.env (el mismo archivo que el
 * servicio carga con EnvironmentFile=) si existe; si no, de las variables
 * de entorno del momento.
 */

const fs = require('node:fs');
const crypto = require('node:crypto');

function cargarEnv_(archivo) {
  if (!fs.existsSync(archivo)) return;
  fs.readFileSync(archivo, 'utf8').split(/\r?\n/).forEach((linea) => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(linea);
    if (m && !linea.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}

function main(argv) {
  cargarEnv_(process.env.SIGSO_FINANZAS_ENV || '/etc/sigso/finanzas.env');
  const [orden, arg] = argv;
  if (orden === 'llave') {
    console.log(crypto.randomBytes(32).toString('base64'));
    return 0;
  }
  const B = require('../logica/finanzasBoveda');
  if (orden === 'verificar') {
    const r = B.verificarCadena_();
    console.log(r.ok ? 'Bitácora íntegra: ' + r.filas + ' entradas.' : 'ATENCIÓN: la bitácora fue alterada en la entrada ' + r.rota_en + '.');
    return r.ok ? 0 : 2;
  }
  if (orden === 'reiniciar' && arg) {
    const { abrirDbProduccion } = require('../db');
    const { leerFilas_ } = require('../db/sqliteRepo');
    const { COLUMNAS } = require('../db/schema');
    const db = abrirDbProduccion();
    const cuenta = leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL)
      .find((c) => String(c.usuario).toLowerCase() === String(arg).toLowerCase());
    if (!cuenta) { console.error('No existe la cuenta ' + arg); return 1; }
    const n = B.reiniciarAutenticador_(cuenta.cuenta_id, 'reinicio desde el servidor');
    console.log(n ? 'Autenticador de ' + cuenta.nombre + ' reiniciado.' : cuenta.nombre + ' no tenía autenticador.');
    return 0;
  }
  console.log('Uso: node backend/scripts/finanzas-boveda.js llave | verificar | reiniciar <usuario>');
  return 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { main, cargarEnv_ };
