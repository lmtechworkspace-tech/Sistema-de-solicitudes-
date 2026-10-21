'use strict';

/**
 * guardia.js — protección común de las herramientas de demostración y piloto de
 * Finanzas (I14). Estas herramientas BORRAN y vuelven a crear sigso.db y
 * finanzas.db en una carpeta: jamás deben apuntar a una base real.
 *
 * Se niegan si:
 *   - NODE_ENV=production;
 *   - la carpeta es de servidor (/opt, /var, /srv, /etc) o es la de producción;
 *   - la carpeta está dentro del repositorio (una base no se versiona);
 *   - el nombre de la carpeta no dice «demo», «piloto» o «ensayo»;
 *   - ya hay una sigso.db con más de 5 cuentas (parece una base real).
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '../../..');
const RAIZ = path.resolve(__dirname, '../..'); // backend/

function carpetaSegura(dir) {
  if (!dir) throw new Error('Indica la carpeta de destino (fuera del repositorio), por ejemplo: C:/sigso-demo');
  const abs = path.resolve(dir);
  const p = abs.split(path.sep).join('/');
  if (process.env.NODE_ENV === 'production') throw new Error('NODE_ENV=production: estas herramientas solo arman bases de prueba.');
  if (/^\/(opt|var|srv|etc)\//i.test(p) || /\/opt\/sigso/i.test(p)) throw new Error('Ruta de servidor: ' + p);
  if ((abs + path.sep).toLowerCase().startsWith((REPO + path.sep).toLowerCase())) throw new Error('La carpeta está dentro del repositorio: una base no se versiona. Usa una carpeta fuera.');
  if (!/demo|piloto|ensayo/i.test(path.basename(abs))) throw new Error('El nombre de la carpeta debe decir «demo», «piloto» o «ensayo»: ' + path.basename(abs));
  const sigso = path.join(abs, 'sigso.db');
  if (fs.existsSync(sigso)) {
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(sigso, { readOnly: true });
    let n = 0;
    try { n = d.prepare('SELECT COUNT(*) AS n FROM CUENTAS_PORTAL').get().n; } catch (e) { /* sin tabla: base vacía */ }
    d.close();
    if (n > 5) throw new Error('sigso.db tiene ' + n + ' cuentas: parece una base real. No se toca.');
  }
  return abs;
}

/** Borra las bases de la carpeta (ya validada) y fija las variables para trabajar sobre ella. */
function prepararCarpeta(abs, extra) {
  fs.mkdirSync(abs, { recursive: true });
  ['sigso.db', 'finanzas.db', 'sigso.db-wal', 'sigso.db-shm', 'finanzas.db-wal', 'finanzas.db-shm'].forEach((f) => { try { fs.unlinkSync(path.join(abs, f)); } catch (e) { /* no estaba */ } });
  const crypto = require('node:crypto');
  const env = Object.assign({
    SIGSO_DB_PATH: path.join(abs, 'sigso.db'), SIGSO_FINANZAS_DB_PATH: path.join(abs, 'finanzas.db'),
    SIGSO_FINANZAS_LLAVE: crypto.randomBytes(32).toString('base64'), SIGSO_PORT: '3099'
  }, extra || {});
  Object.assign(process.env, env);
  fs.writeFileSync(path.join(abs, 'env.json'), JSON.stringify(env, null, 2));
  return env;
}

/** Usa una carpeta ya armada (lee su env.json), con la misma protección. */
function usarCarpeta(dir) {
  const abs = carpetaSegura(dir);
  const archivo = path.join(abs, 'env.json');
  if (!fs.existsSync(archivo)) throw new Error('No hay env.json en ' + abs + ': primero arma la base.');
  const env = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  Object.assign(process.env, env, { SIGSO_DB_PATH: path.join(abs, 'sigso.db'), SIGSO_FINANZAS_DB_PATH: path.join(abs, 'finanzas.db') });
  return abs;
}

module.exports = { carpetaSegura, prepararCarpeta, usarCarpeta, RAIZ, REPO };
