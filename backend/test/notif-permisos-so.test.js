'use strict';

/**
 * v7.3 (notificaciones vivas, Nivel 0): estado del permiso de notificacion
 * del navegador (Notification.permission), reportado por dispositivo y
 * visible para el Admin -- ver documentacion/SIGSO-v7.1-notificaciones-
 * vivas.md. Nace del feedback real: "a algunos les llega la alerta y a
 * otros no" -- la causa mas probable es que nunca aceptaron el permiso del
 * navegador.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

const ADMIN = { rol: 'ADM', email: 'admin@homepymes.cl' };
const NO_ADMIN = { rol: 'SOLICITANTE', email: 'juan@hp.cl' };

function load() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'NOTIF_PERMISOS_SO', ctx.COLUMNAS.NOTIF_PERMISOS_SO, []);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Admin', 'admin@homepymes.cl', 'HP', 'ADM', true, '', 'sistema'],
    ['U2', 'Dev Inactivo', 'inactivo@homepymes.cl', 'HP', 'DEV', false, '', 'sistema']
  ]);
  seedSheet(ctx, 'CUENTAS_PORTAL', ctx.COLUMNAS.CUENTAS_PORTAL, [
    ['CTA-1', 'leo', 'Leo Estay', 'Desarrollador', 'hash', 'sal',
      JSON.stringify(['leo@rld.cl']), 'DEV', JSON.stringify(['mi_trabajo']), 'RLD', true, false, '', 'dev-server']
  ]);
  return ctx;
}

test('reportarPermisoNotificacionesSO_ crea la fila si no existe', () => {
  const ctx = load();
  const r = ctx.reportarPermisoNotificacionesSO_({ email: 'leo@rld.cl' }, 'granted');
  assert.equal(r.ok, true);
  const filas = ctx.leerFilas_('NOTIF_PERMISOS_SO');
  assert.equal(filas.length, 1);
  assert.equal(filas[0].email, 'leo@rld.cl');
  assert.equal(filas[0].permiso, 'granted');
});

test('reportarPermisoNotificacionesSO_ es upsert (no duplica al reportar de nuevo)', () => {
  const ctx = load();
  ctx.reportarPermisoNotificacionesSO_({ email: 'leo@rld.cl' }, 'default');
  ctx.reportarPermisoNotificacionesSO_({ email: 'leo@rld.cl' }, 'granted');
  const filas = ctx.leerFilas_('NOTIF_PERMISOS_SO');
  assert.equal(filas.length, 1);
  assert.equal(filas[0].permiso, 'granted');
});

test('reportarPermisoNotificacionesSO_ rechaza un valor invalido', () => {
  const ctx = load();
  const r = ctx.reportarPermisoNotificacionesSO_({ email: 'leo@rld.cl' }, 'algo_raro');
  assert.equal(r._validationError, true);
});

test('listarPermisosNotificacionesSO_ es ADM-only', () => {
  const ctx = load();
  const r = ctx.listarPermisosNotificacionesSO_(NO_ADMIN);
  assert.equal(r._forbidden, true);
});

test('listarPermisosNotificacionesSO_ cruza staff activo + cuentas de portal activas, marca "sin_datos" a quien nunca reporto', () => {
  const ctx = load();
  const r = ctx.listarPermisosNotificacionesSO_(ADMIN);
  const emails = r.personas.map((p) => p.email);
  assert.ok(emails.includes('admin@homepymes.cl'));
  assert.ok(emails.includes('leo@rld.cl'));
  assert.ok(!emails.includes('inactivo@homepymes.cl')); // usuario inactivo, no aparece

  const leo = r.personas.filter((p) => p.email === 'leo@rld.cl')[0];
  assert.equal(leo.permiso, 'sin_datos');
  assert.equal(leo.origen, 'Plataforma (portal)');
});

test('listarPermisosNotificacionesSO_ ordena sin_datos/denied/default antes que granted', () => {
  const ctx = load();
  ctx.reportarPermisoNotificacionesSO_({ email: 'admin@homepymes.cl' }, 'granted');
  const r = ctx.listarPermisosNotificacionesSO_(ADMIN);
  const permisos = r.personas.map((p) => p.permiso);
  const idxSinDatos = permisos.indexOf('sin_datos');
  const idxGranted = permisos.indexOf('granted');
  assert.ok(idxSinDatos < idxGranted);
});

test('handleReportarPermisoNotificacionesSO_ / handleListarPermisosNotificacionesSO_ responden ok:true', () => {
  const ctx = load();
  const r1 = ctx.handleReportarPermisoNotificacionesSO_({ permiso: 'denied' }, { email: 'juan@hp.cl' });
  assert.equal(JSON.parse(r1.getContent()).ok, true);

  const r2 = ctx.handleListarPermisosNotificacionesSO_({}, ADMIN);
  const body2 = JSON.parse(r2.getContent());
  assert.equal(body2.ok, true);
  assert.ok(Array.isArray(body2.data.personas));
});

test('reportarPermisoNotificacionesSO no tiene gate de modulo; listarPermisosNotificacionesSO exige administracion', () => {
  const ctx = load();
  assert.equal(ctx.MODULO_POR_ACCION.reportarPermisoNotificacionesSO, undefined);
  assert.equal(ctx.MODULO_POR_ACCION.listarPermisosNotificacionesSO, 'administracion');
});

test('reportarPermisoNotificacionesSO_ no rompe la carga de SIGSO si la hoja aun no existe (instalacion vieja)', () => {
  // Mismo criterio que encolarNotificacionAppLote_: instalacion vieja sin
  // re-correr el Instalador tras v7.3 -- no debe tumbar el resto de la carga.
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  // A proposito: NO se siembra NOTIF_PERMISOS_SO (simula la hoja ausente).
  const r = ctx.reportarPermisoNotificacionesSO_({ email: 'leo@rld.cl' }, 'granted');
  assert.equal(r.ok, true);
});
