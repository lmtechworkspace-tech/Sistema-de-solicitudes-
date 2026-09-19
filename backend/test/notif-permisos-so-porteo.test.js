'use strict';

/**
 * Prueba de portabilidad: los mismos escenarios de
 * backend/test/notif-permisos-so.test.js (contra Notificaciones.gs),
 * corridos contra backend/logica/notificaciones.js (Fase 3a).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Notificaciones = require('../logica/notificaciones');

const ADMIN = { rol: 'ADM', email: 'admin@homepymes.cl' };
const NO_ADMIN = { rol: 'SOLICITANTE', email: 'juan@hp.cl' };

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  agregarFila_(db, 'USUARIOS', { usuario_id: 'U1', nombre: 'Admin', email: 'admin@homepymes.cl', empresa_id: 'HP', rol: 'ADM', activo: true, creado_por: 'sistema' });
  agregarFila_(db, 'USUARIOS', { usuario_id: 'U2', nombre: 'Dev Inactivo', email: 'inactivo@homepymes.cl', empresa_id: 'HP', rol: 'DEV', activo: false, creado_por: 'sistema' });
  agregarFila_(db, 'CUENTAS_PORTAL', {
    cuenta_id: 'CTA-1', usuario: 'leo', nombre: 'Leo Estay', cargo: 'Desarrollador', hash_password: 'hash', salt: 'sal',
    emails: JSON.stringify(['leo@rld.cl']), rol: 'DEV', modulos: JSON.stringify(['mi_trabajo']), empresa_id: 'RLD',
    activo: true, debe_cambiar_password: false, ultimo_acceso: '', creado_por: 'dev-server'
  });
  return db;
}
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }

test('reportarPermisoNotificacionesSO crea la fila si no existe', () => {
  const db = dbConSchema();
  const r = Notificaciones.reportarPermisoNotificacionesSO(db, { permiso: 'granted' }, { email: 'leo@rld.cl' });
  assert.equal(r.ok, true);
  const registros = filas(db, 'NOTIF_PERMISOS_SO');
  assert.equal(registros.length, 1);
  assert.equal(registros[0].email, 'leo@rld.cl');
  assert.equal(registros[0].permiso, 'granted');
});

test('reportarPermisoNotificacionesSO es upsert (no duplica al reportar de nuevo)', () => {
  const db = dbConSchema();
  Notificaciones.reportarPermisoNotificacionesSO(db, { permiso: 'default' }, { email: 'leo@rld.cl' });
  Notificaciones.reportarPermisoNotificacionesSO(db, { permiso: 'granted' }, { email: 'leo@rld.cl' });
  const registros = filas(db, 'NOTIF_PERMISOS_SO');
  assert.equal(registros.length, 1);
  assert.equal(registros[0].permiso, 'granted');
});

test('reportarPermisoNotificacionesSO rechaza un valor inválido', () => {
  const db = dbConSchema();
  const r = Notificaciones.reportarPermisoNotificacionesSO(db, { permiso: 'algo_raro' }, { email: 'leo@rld.cl' });
  assert.equal(r._validationError, true);
});

test('listarPermisosNotificacionesSO es ADM-only', () => {
  const db = dbConSchema();
  assert.equal(Notificaciones.listarPermisosNotificacionesSO(db, {}, NO_ADMIN)._forbidden, true);
});

test('listarPermisosNotificacionesSO cruza staff activo + cuentas de portal activas, marca "sin_datos" a quien nunca reportó', () => {
  const db = dbConSchema();
  const r = Notificaciones.listarPermisosNotificacionesSO(db, {}, ADMIN);
  const emails = r.personas.map((p) => p.email);
  assert.ok(emails.includes('admin@homepymes.cl'));
  assert.ok(emails.includes('leo@rld.cl'));
  assert.ok(!emails.includes('inactivo@homepymes.cl'));

  const leo = r.personas.find((p) => p.email === 'leo@rld.cl');
  assert.equal(leo.permiso, 'sin_datos');
  assert.equal(leo.origen, 'Plataforma (portal)');
});

test('listarPermisosNotificacionesSO ordena sin_datos/denied/default antes que granted', () => {
  const db = dbConSchema();
  Notificaciones.reportarPermisoNotificacionesSO(db, { permiso: 'granted' }, { email: 'admin@homepymes.cl' });
  const r = Notificaciones.listarPermisosNotificacionesSO(db, {}, ADMIN);
  const permisos = r.personas.map((p) => p.permiso);
  assert.ok(permisos.indexOf('sin_datos') < permisos.indexOf('granted'));
});

test('reportarPermisoNotificacionesSO no rompe si la tabla aun no existe (instalacion vieja)', () => {
  const db = abrirDb_();
  // A proposito: NO se siembra NOTIF_PERMISOS_SO (simula la tabla ausente).
  Object.keys(COLUMNAS).filter((h) => h !== 'NOTIF_PERMISOS_SO').forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  const r = Notificaciones.reportarPermisoNotificacionesSO(db, { permiso: 'granted' }, { email: 'leo@rld.cl' });
  assert.equal(r.ok, true);
});
