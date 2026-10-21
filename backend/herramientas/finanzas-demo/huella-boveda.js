'use strict';

/**
 * huella-boveda.js — huella verificable de una bóveda de Finanzas, para comparar
 * un respaldo con su restauración (QA-R22 / T27). Descifra TODOS los registros
 * cifrados: con otra llave, falla.
 *
 *   SIGSO_FINANZAS_LLAVE=... node backend/herramientas/finanzas-demo/huella-boveda.js <carpeta con sigso.db y finanzas.db>
 *
 * Imprime conteos y una huella SHA-256 del contenido (cierres, adjuntos, bitácora,
 * reporte del último mes cerrado), sin importes ni datos: dos carpetas con la
 * misma huella tienen el mismo contenido.
 *
 * ¡Ojo! Abrir la bóveda puede completar su esquema: córrelo SIEMPRE sobre
 * copias (el respaldo y la restauración), nunca sobre /opt/sigso/data.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dir = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(path.join(dir, 'finanzas.db'))) { console.error('Uso: huella-boveda.js <carpeta con finanzas.db>'); process.exit(1); }
if (/\/opt\/sigso/i.test(dir.split(path.sep).join('/'))) { console.error('No sobre la carpeta de producción: usa una copia.'); process.exit(1); }
if (!process.env.SIGSO_FINANZAS_LLAVE) { console.error('Falta SIGSO_FINANZAS_LLAVE (la misma del respaldo).'); process.exit(1); }
process.env.SIGSO_DB_PATH = path.join(dir, 'sigso.db');
process.env.SIGSO_FINANZAS_DB_PATH = path.join(dir, 'finanzas.db');
const RAIZ = path.resolve(__dirname, '../..');
const B = require(RAIZ + '/logica/finanzasBoveda');
const db = require(RAIZ + '/db').abrirDbProduccion();
const d = B.dbFin();
const sha = (x) => crypto.createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const out = { tablas: {}, descifrados: 0, fallos_descifrado: 0 };
const detalle = {};
d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'FIN_%' ORDER BY name").all().forEach((t) => {
  out.tablas[t.name] = d.prepare('SELECT COUNT(*) AS n FROM ' + t.name).get().n;
  const cols = d.prepare('PRAGMA table_info(' + t.name + ')').all().map((c) => c.name);
  if (cols.indexOf('datos') === -1 || t.name === 'FIN_CATALOGO') return; // el catálogo no va cifrado
  const h = crypto.createHash('sha256');
  d.prepare('SELECT datos FROM ' + t.name + ' ORDER BY rowid').all().forEach((r) => {
    try { h.update(B.descifrar(r.datos)); out.descifrados++; } catch (e) { out.fallos_descifrado++; }
  });
  detalle[t.name] = h.digest('hex');
});
try {
  const cierres = d.prepare('SELECT periodo, version FROM FIN_CIERRE_VERSIONES ORDER BY periodo, version').all();
  out.cierres = cierres.length;
  const ultimo = cierres.length ? cierres[cierres.length - 1].periodo : '';
  if (ultimo) detalle.reporte_ultimo_cierre = sha(require(RAIZ + '/logica/finanzasReportes').reporte_(db, { periodo: ultimo }).metrics);
  out.adjuntos = out.tablas.FIN_ADJUNTOS || 0;
  out.bitacora_integra = B.verificarCadena_ ? !!(B.verificarCadena_().ok !== undefined ? B.verificarCadena_().ok : B.verificarCadena_()) : null;
  out.cuentas_portal = db.prepare('SELECT COUNT(*) AS n FROM CUENTAS_PORTAL').get().n;
} catch (e) { out.error = e.message; }
out.huella = sha(detalle);
console.log(JSON.stringify(out, null, 1));
