'use strict';

/**
 * credenciales-boveda.js — herramienta de servidor de la bóveda de
 * Credenciales (backend/logica/credenciales.js). Es la ÚNICA forma de hacer lo
 * que a propósito no tiene pantalla. Se corre por SSH en el VPS:
 *
 *   node backend/scripts/credenciales-boveda.js reiniciar <usuario>
 *       Borra el autenticador de esa persona (cambió o perdió el teléfono) y
 *       cierra sus sesiones de la bóveda. Al volver a «Credenciales» le pide
 *       su contraseña de SIGSO y le muestra la clave nueva para Google
 *       Authenticator. Queda en la bitácora.
 *
 *   node backend/scripts/credenciales-boveda.js verificar
 *       Recorre la bitácora encadenada y dice si alguien la editó a mano.
 *
 * Lee la configuración de /etc/sigso/finanzas.env (la llave de Credenciales se
 * deriva de la de Finanzas) igual que finanzas-boveda.js.
 */

const { cargarEnv_ } = require('./finanzas-boveda');

function main(argv) {
  cargarEnv_(process.env.SIGSO_FINANZAS_ENV || '/etc/sigso/finanzas.env');
  const [orden, arg] = argv;
  const C = require('../logica/credenciales');
  if (orden === 'verificar') {
    const r = C.verificarCadena_();
    console.log(r.ok ? 'Bitácora íntegra: ' + r.filas + ' entradas.' : 'ATENCIÓN: la bitácora fue alterada en la entrada ' + r.rota_en + '.');
    return r.ok ? 0 : 2;
  }
  if (orden === 'reiniciar' && arg) {
    const { abrirDbProduccion } = require('../db');
    const { leerFilas_ } = require('../db/sqliteRepo');
    const { COLUMNAS } = require('../db/schema');
    const db = abrirDbProduccion();
    const buscado = String(arg).trim().toLowerCase();
    const cuenta = leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL)
      .find((c) => String(c.usuario || '').toLowerCase() === buscado || String(c.emails || '').toLowerCase().split(/[,;\s]+/).indexOf(buscado) !== -1);
    if (!cuenta) { console.error('No existe la cuenta ' + arg); return 1; }
    const n = C.reiniciarAutenticador_(cuenta.cuenta_id, 'reinicio desde el servidor (cambio de teléfono)', cuenta.nombre);
    console.log(n ? 'Autenticador de Credenciales de ' + cuenta.nombre + ' reiniciado.' : cuenta.nombre + ' no tenía autenticador de Credenciales.');
    return 0;
  }
  console.log('Uso: node backend/scripts/credenciales-boveda.js verificar | reiniciar <usuario o correo>');
  return 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { main };
