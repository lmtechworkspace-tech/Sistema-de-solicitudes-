'use strict';

/**
 * Pruebas de backend/scripts/backup-db.js (Fase 0 del plan post-migración:
 * la base de producción no tenía ningún respaldo). Nunca pega a R2 real --
 * mismo patrón conMockAlmacenamiento_ que el resto del proyecto.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const Almacenamiento = require('../logica/almacenamiento');
const Backup = require('../scripts/backup-db');

function crearDbTemporal_() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigso-backup-test-'));
  const dbPath = path.join(dir, 'sigso.db');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE X (id INTEGER)');
  db.exec('INSERT INTO X VALUES (1)');
  db.close();
  return { dir, dbPath };
}

function conMockAlmacenamiento_(t, disponible) {
  const bucket = new Map();
  t.mock.method(Almacenamiento, 'disponible_', () => disponible !== false);
  t.mock.method(Almacenamiento, 'subirArchivo_', async (clave, contenidoBase64, contentType) => {
    bucket.set(clave, { contenidoBase64, contentType });
    return { ok: true, clave, tamano: Buffer.byteLength(contenidoBase64, 'base64') };
  });
  return bucket;
}

test('ejecutar_: escribe el respaldo local con VACUUM INTO, restaurable y con datos reales', async (t) => {
  const { dir, dbPath } = crearDbTemporal_();
  const backupDir = path.join(dir, 'backups');
  const bucket = conMockAlmacenamiento_(t);

  const res = await Backup.ejecutar_({ dbPath, backupDir, fecha: new Date('2026-09-19T12:00:00Z') });

  assert.ok(fs.existsSync(res.archivoLocal));
  assert.ok(res.tamano > 0);

  // El respaldo es una base SQLite de verdad, con los datos adentro (no
  // solo bytes copiados) -- se puede abrir y leer.
  const restaurada = new DatabaseSync(res.archivoLocal, { readOnly: true });
  const filas = restaurada.prepare('SELECT id FROM X').all();
  restaurada.close();
  assert.equal(filas.length, 1);
  assert.equal(filas[0].id, 1);

  assert.equal(res.r2.subido, true);
  assert.equal(res.r2.clave, 'backups/sigso-2026-09-19.db');
  assert.ok(bucket.has('backups/sigso-2026-09-19.db'));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('ejecutar_: sin R2 configurado, el respaldo local igual se escribe (no revienta)', async (t) => {
  const { dir, dbPath } = crearDbTemporal_();
  const backupDir = path.join(dir, 'backups');
  conMockAlmacenamiento_(t, false);

  const res = await Backup.ejecutar_({ dbPath, backupDir, fecha: new Date('2026-09-19T12:00:00Z') });

  assert.ok(fs.existsSync(res.archivoLocal));
  assert.equal(res.r2.subido, false);
  assert.equal(res.r2.motivo, 'r2_no_configurado');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('ejecutar_: si falla la subida a R2, lanza (no se pierde el respaldo local ya escrito, pero el llamador se entera)', async (t) => {
  const { dir, dbPath } = crearDbTemporal_();
  const backupDir = path.join(dir, 'backups');
  t.mock.method(Almacenamiento, 'disponible_', () => true);
  t.mock.method(Almacenamiento, 'subirArchivo_', async () => ({ ok: false, message: 'R2 respondio 500' }));

  await assert.rejects(
    Backup.ejecutar_({ dbPath, backupDir, fecha: new Date('2026-09-19T12:00:00Z') }),
    /R2 respondio 500/
  );
  // El respaldo local se escribio antes del intento de subida -- no se pierde.
  assert.ok(fs.existsSync(path.join(backupDir, 'sigso-2026-09-19.db')));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('ejecutar_: sin base de datos en la ruta indicada, lanza un error claro', async () => {
  await assert.rejects(
    Backup.ejecutar_({ dbPath: path.join(os.tmpdir(), 'sigso-no-existe-' + Date.now() + '.db'), backupDir: os.tmpdir() }),
    /No existe la base/
  );
});

test('limpiarAntiguos_: borra copias locales de mas de RETENCION_DIAS, respeta las recientes y lo que no matchea el patron', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigso-backup-retencion-'));
  const vieja = path.join(dir, 'sigso-2020-01-01.db');
  const reciente = path.join(dir, 'sigso-2026-09-19.db');
  const otroArchivo = path.join(dir, 'otra-cosa.txt');
  fs.writeFileSync(vieja, 'x');
  fs.writeFileSync(reciente, 'x');
  fs.writeFileSync(otroArchivo, 'x');
  const antiguo = (Date.now() - 30 * 24 * 3600 * 1000) / 1000;
  fs.utimesSync(vieja, antiguo, antiguo);
  const viejoTambien = (Date.now() - 30 * 24 * 3600 * 1000) / 1000;
  fs.utimesSync(otroArchivo, viejoTambien, viejoTambien);

  const borrados = Backup.limpiarAntiguos_(dir, 14);

  assert.equal(borrados, 1);
  assert.ok(!fs.existsSync(vieja));
  assert.ok(fs.existsSync(reciente));
  assert.ok(fs.existsSync(otroArchivo)); // nunca toca archivos que no matchean el patron

  fs.rmSync(dir, { recursive: true, force: true });
});

test('claveDiaSantiago_: formatea en horario de Chile, YYYY-MM-DD', () => {
  assert.equal(Backup.claveDiaSantiago_(new Date('2026-09-19T12:00:00Z')), '2026-09-19');
  // 2026-01-01T02:00:00Z son las 23:00 del 2025-12-31 en Santiago (UTC-3).
  assert.equal(Backup.claveDiaSantiago_(new Date('2026-01-01T02:00:00Z')), '2025-12-31');
});
