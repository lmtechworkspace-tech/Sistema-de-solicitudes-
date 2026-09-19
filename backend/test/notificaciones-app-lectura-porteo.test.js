'use strict';

/**
 * Prueba de portabilidad: el lado de LECTURA de notificaciones "en vivo"
 * (Fase 3b, 2026-09-19) -- sincronizar (polling del cliente), marcar leída,
 * marcar todas leídas -- corrido contra notificacionesApp.js. Escenarios
 * adaptados de backend/test/notificaciones-vivas.test.js (el .gs, vía
 * gasSandbox), incluidos los dos bugs reales que motivaron la
 * normalización de correo (v9.0e) y la tolerancia a `leida` booleano
 * (v9.0g).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const NotifApp = require('../logica/notificacionesApp');

function db_() {
  const db = abrirDb_();
  sembrarTabla_(db, 'NOTIFICACIONES_APP', COLUMNAS.NOTIFICACIONES_APP, []);
  return db;
}
function encolar(db, destinatario, titulo, vidaHoras) {
  return NotifApp.encolarLote(db, [{ destinatario, tipo: 'PRUEBA', titulo, vidaHoras }]);
}

test('sincronizar: devuelve solo las no leídas y no vencidas del destinatario de la sesión', () => {
  const db = db_();
  encolar(db, 'ana@hp.cl', 'Para Ana', 6);
  encolar(db, 'juan@hp.cl', 'Para Juan', 6);
  encolar(db, 'ana@hp.cl', 'Vencida de Ana', -1);

  const resp = NotifApp.sincronizar(db, {}, { email: 'ana@hp.cl' });
  assert.equal(resp.notificaciones.length, 1);
  assert.equal(resp.notificaciones[0].titulo, 'Para Ana');
});

test('sincronizar: no revienta si la tabla no tiene filas', () => {
  const db = db_();
  const resp = NotifApp.sincronizar(db, {}, { email: 'ana@hp.cl' });
  assert.equal(resp.notificaciones.length, 0);
});

test('marcarLeida: solo la marca si el contexto es el propio destinatario', () => {
  const db = db_();
  encolar(db, 'ana@hp.cl', 'Para Ana');
  const notifId = require('../db/sqliteRepo').leerFilas_(db, 'NOTIFICACIONES_APP', COLUMNAS.NOTIFICACIONES_APP)[0].notif_id;

  const otro = NotifApp.marcarLeida(db, { notif_id: notifId }, { email: 'juan@hp.cl' });
  assert.equal(otro.actualizado, false);

  const propio = NotifApp.marcarLeida(db, { notif_id: notifId }, { email: 'ana@hp.cl' });
  assert.equal(propio.actualizado, true);

  assert.equal(NotifApp.sincronizar(db, {}, { email: 'ana@hp.cl' }).notificaciones.length, 0);
});

test('marcarTodasLeidas: marca solo las del destinatario de la sesión', () => {
  const db = db_();
  encolar(db, 'ana@hp.cl', 'A1');
  encolar(db, 'ana@hp.cl', 'A2');
  encolar(db, 'juan@hp.cl', 'J1');

  const r = NotifApp.marcarTodasLeidas(db, {}, { email: 'ana@hp.cl' });
  assert.equal(r.actualizadas, 2);
  assert.equal(NotifApp.sincronizar(db, {}, { email: 'ana@hp.cl' }).notificaciones.length, 0);
  assert.equal(NotifApp.sincronizar(db, {}, { email: 'juan@hp.cl' }).notificaciones.length, 1);
});

test('v9.0e: encolar/sincronizar/marcar no dependen de mayúsculas/espacios en el correo', () => {
  const db = db_();
  encolar(db, '  Ana@HP.cl ', 'Para Ana');
  const sesion = { email: 'ANA@hp.cl' };
  assert.equal(NotifApp.sincronizar(db, {}, sesion).notificaciones.length, 1);

  const r = NotifApp.marcarTodasLeidas(db, {}, sesion);
  assert.equal(r.actualizadas, 1);
  assert.equal(NotifApp.sincronizar(db, {}, { email: 'ana@hp.cl' }).notificaciones.length, 0);
});

test('v9.0e: marcarLeida también tolera distinta capitalización del correo', () => {
  const db = db_();
  encolar(db, 'Juan@HP.cl', 'Para Juan');
  const notifId = require('../db/sqliteRepo').leerFilas_(db, 'NOTIFICACIONES_APP', COLUMNAS.NOTIFICACIONES_APP)[0].notif_id;
  const r = NotifApp.marcarLeida(db, { notif_id: notifId }, { email: ' juan@hp.cl ' });
  assert.equal(r.actualizado, true);
});

test('v9.0g: sincronizar/marcarTodas tratan leida=true (booleano real) igual que \'TRUE\' (string)', () => {
  const db = db_();
  encolar(db, 'ana@hp.cl', 'Ya leída (booleano)');
  encolar(db, 'ana@hp.cl', 'Pendiente');
  const { leerFilas_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
  const filas = leerFilas_(db, 'NOTIFICACIONES_APP', COLUMNAS.NOTIFICACIONES_APP);
  actualizarFilaPorId_(db, 'NOTIFICACIONES_APP', 'notif_id', filas[0].notif_id, { leida: true });

  const sync = NotifApp.sincronizar(db, {}, { email: 'ana@hp.cl' });
  assert.equal(sync.notificaciones.length, 1);
  assert.equal(sync.notificaciones[0].titulo, 'Pendiente');

  const r = NotifApp.marcarTodasLeidas(db, {}, { email: 'ana@hp.cl' });
  assert.equal(r.actualizadas, 1, 'no debe re-marcar la que ya estaba leída con booleano real');
});

test('marcarLeida: sin notif_id no hace nada', () => {
  const db = db_();
  assert.equal(NotifApp.marcarLeida(db, {}, { email: 'ana@hp.cl' }).actualizado, false);
});
