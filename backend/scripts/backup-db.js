'use strict';

/**
 * backup-db.js — respaldo diario de la base de producción SIGSO
 * (/opt/sigso/data/sigso.db). Corre por systemd timer (sigso-backup.timer,
 * configurado a mano en el VPS -- no es código, no se despliega por git,
 * ver documentacion/HANDOFF-MIGRACION-NODE.md §10.2).
 *
 * Riesgo que resuelve: el archivo no tenía NINGÚN respaldo -- ni timer, ni
 * crontab, ni copia en otro lado. Un disco corrupto se llevaba 284 clientes
 * reales, las cuentas de staff y todo lo escrito desde la migración.
 *
 * Usa `VACUUM INTO` (SQLite 3.27+, disponible en node:sqlite sin depender
 * del binario `sqlite3` -- no está instalado en el VPS y no valía la pena
 * agregar una dependencia de sistema solo para esto) para tomar una foto
 * consistente de la base mientras el servicio sigue escribiendo: mismo
 * mecanismo que usa `sqlite3 db ".backup"` por debajo.
 *
 * Guarda una copia local (retención de 14 días, se podan las más viejas en
 * cada corrida) y la sube a R2 (mismo bucket que ya usan los adjuntos,
 * clave `backups/sigso-<fecha>.db`) -- sin R2 configurado (dev/local), el
 * respaldo local igual se escribe, solo se avisa que no se subió.
 */

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const Almacenamiento = require('../logica/almacenamiento');

const RETENCION_DIAS = 14;

function claveDiaSantiago_(fecha) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(fecha || new Date());
}

function respaldarLocal_(dbPath, backupDir, fecha) {
  if (!fs.existsSync(dbPath)) throw new Error('No existe la base: ' + dbPath);
  fs.mkdirSync(backupDir, { recursive: true });
  const archivo = path.join(backupDir, 'sigso-' + fecha + '.db');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec("VACUUM INTO '" + archivo.replace(/'/g, "''") + "'");
  } finally {
    db.close();
  }
  return archivo;
}

// Poda copias locales de mas de `retencionDias` -- por mtime del archivo de
// respaldo, no por la fecha en el nombre (asi funciona igual si algun dia
// se restaura o se copia a mano). Solo toca archivos con el patron exacto
// `sigso-YYYY-MM-DD.db`, nunca borra nada mas de la carpeta.
function limpiarAntiguos_(backupDir, retencionDias) {
  const limite = Date.now() - retencionDias * 24 * 3600 * 1000;
  let borrados = 0;
  fs.readdirSync(backupDir).forEach((nombre) => {
    if (!/^sigso-\d{4}-\d{2}-\d{2}\.db$/.test(nombre)) return;
    const ruta = path.join(backupDir, nombre);
    if (fs.statSync(ruta).mtimeMs < limite) { fs.unlinkSync(ruta); borrados++; }
  });
  return borrados;
}

async function subirAR2_(archivoLocal, fecha) {
  if (!Almacenamiento.disponible_()) return { subido: false, motivo: 'r2_no_configurado' };
  const contenidoBase64 = fs.readFileSync(archivoLocal).toString('base64');
  const clave = 'backups/sigso-' + fecha + '.db';
  const resultado = await Almacenamiento.subirArchivo_(clave, contenidoBase64, 'application/x-sqlite3');
  if (!resultado.ok) throw new Error('No se pudo subir el respaldo a R2: ' + resultado.message);
  return { subido: true, clave };
}

async function ejecutar_(opciones) {
  const fecha = claveDiaSantiago_(opciones.fecha);
  const archivoLocal = respaldarLocal_(opciones.dbPath, opciones.backupDir, fecha);
  const tamano = fs.statSync(archivoLocal).size;
  const borrados = limpiarAntiguos_(opciones.backupDir, opciones.retencionDias || RETENCION_DIAS);
  const r2 = await subirAR2_(archivoLocal, fecha);
  return { archivoLocal, tamano, borrados, r2 };
}

async function main() {
  const resultado = await ejecutar_({
    dbPath: process.env.SIGSO_DB_PATH || '/opt/sigso/data/sigso.db',
    backupDir: process.env.SIGSO_BACKUP_DIR || '/opt/sigso/backups'
  });
  console.log('Respaldo OK:', JSON.stringify(resultado));
  if (!resultado.r2.subido) console.warn('Aviso: no se subio a R2 (' + resultado.r2.motivo + ').');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fallo el respaldo:', err);
    process.exit(1);
  });
}

module.exports = { ejecutar_, claveDiaSantiago_, respaldarLocal_, limpiarAntiguos_, subirAR2_ };
