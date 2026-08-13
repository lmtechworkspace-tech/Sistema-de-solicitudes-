'use strict';

/**
 * v7.5 Fase 2 (enviar alerta desde el Admin): un megáfono manual del Admin a
 * quien elija, por alerta EN VIVO y/o CORREO. Nace del feedback real: "poder
 * enviar alertas desde el Admin, en caso que no tengan SIGSO abierto" -- el
 * correo alcanza a quien está offline; la alerta en vivo, a quien lo tiene
 * abierto. Distinto de Novedades (feed durable con acuse).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

const ADMIN = { rol: 'ADM', email: 'admin@homepymes.cl' };
const NO_ADMIN = { rol: 'DEV', email: 'juan@hp.cl' };

function load() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'NOTIFICACIONES_APP', ctx.COLUMNAS.NOTIFICACIONES_APP, []);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES, []);
  seedSheet(ctx, 'LOG_SISTEMA', ctx.COLUMNAS.LOG_SISTEMA, []);
  seedSheet(ctx, 'CONFIG_NOTIFICACIONES', ctx.COLUMNAS.CONFIG_NOTIFICACIONES, []);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Admin', 'admin@homepymes.cl', 'HP', 'ADM', true, '', 'seed'],
    ['U2', 'Ana Dev', 'ana@homepymes.cl', 'HP', 'DEV', true, '', 'seed'],
    ['U3', 'Ex', 'ex@homepymes.cl', 'HP', 'DEV', false, '', 'seed']
  ]);
  seedSheet(ctx, 'CUENTAS_PORTAL', ctx.COLUMNAS.CUENTAS_PORTAL, [
    ['CTA-1', 'leo', 'Leo Estay', 'Dev', 'hash', 'sal',
      JSON.stringify(['leo@rld.cl']), 'DEV', JSON.stringify(['bandeja']), 'RLD', true, false, '', 'seed']
  ]);
  return ctx;
}

const base = { titulo: 'Auditoría ISO 9001', mensaje: 'Martes 15, 9:00.' };

test('enviarAlertaManual_ es ADM-only', () => {
  const ctx = load();
  assert.equal(ctx.enviarAlertaManual_(NO_ADMIN, base)._forbidden, true);
});

test('TODOS: encola alerta en vivo y manda correo a todo el personal activo (menos inactivos)', () => {
  const ctx = load();
  const r = ctx.enviarAlertaManual_(ADMIN, Object.assign({ audiencia_tipo: 'TODOS' }, base));
  assert.equal(r.ok, true);
  // admin@hp, ana@hp (HP activos) + leo@rld (portal activo) = 3; ex@hp inactivo excluido.
  assert.equal(r.destinatarios, 3);
  assert.equal(ctx.leerFilas_('NOTIFICACIONES_APP').length, 3);
  assert.equal(ctx.GmailApp._enviados.length, 3);
  const notif = ctx.leerFilas_('NOTIFICACIONES_APP')[0];
  assert.equal(notif.tipo, 'ALERTA_ADMIN');
  assert.ok(notif.titulo.indexOf('Auditoría ISO 9001') !== -1);
});

test('EMPRESA: filtra por empresa_id', () => {
  const ctx = load();
  const r = ctx.enviarAlertaManual_(ADMIN, Object.assign({ audiencia_tipo: 'EMPRESA', empresa_id: 'RLD' }, base));
  assert.equal(r.destinatarios, 1); // solo leo@rld
  assert.equal(ctx.leerFilas_('NOTIFICACIONES_APP')[0].destinatario_email, 'leo@rld.cl');
});

test('SELECCION: solo los correos elegidos', () => {
  const ctx = load();
  const r = ctx.enviarAlertaManual_(ADMIN, Object.assign(
    { audiencia_tipo: 'SELECCION', destinatarios: ['ana@homepymes.cl'] }, base));
  assert.equal(r.destinatarios, 1);
  assert.equal(ctx.GmailApp._enviados[0].destinatario, 'ana@homepymes.cl');
});

test('solo en vivo (por_correo=false): encola pero NO manda correo', () => {
  const ctx = load();
  const r = ctx.enviarAlertaManual_(ADMIN, Object.assign({ audiencia_tipo: 'TODOS', por_correo: false }, base));
  assert.equal(r.correo, 0);
  assert.equal(ctx.GmailApp._enviados.length, 0);
  assert.equal(ctx.leerFilas_('NOTIFICACIONES_APP').length, 3);
});

test('solo correo (por_en_vivo=false): manda correo pero NO encola en vivo', () => {
  const ctx = load();
  const r = ctx.enviarAlertaManual_(ADMIN, Object.assign({ audiencia_tipo: 'TODOS', por_en_vivo: false }, base));
  assert.equal(r.en_vivo, 0);
  assert.equal(ctx.leerFilas_('NOTIFICACIONES_APP').length, 0);
  assert.equal(ctx.GmailApp._enviados.length, 3);
});

test('valida titulo, mensaje y al menos un canal', () => {
  const ctx = load();
  assert.equal(ctx.enviarAlertaManual_(ADMIN, { titulo: 'x', mensaje: 'hola' })._validationError, true);
  assert.equal(ctx.enviarAlertaManual_(ADMIN, { titulo: 'Titulo ok', mensaje: '' })._validationError, true);
  assert.equal(ctx.enviarAlertaManual_(ADMIN, Object.assign({ por_correo: false, por_en_vivo: false }, base))._validationError, true);
});

test('ALERTA_ADMIN nunca se bloquea aunque el Admin haya apagado canales de correo', () => {
  const ctx = load();
  // Apagar TODOS los canales apagables no afecta el megafono manual.
  ['PAUSAS', 'ACTIVIDADES', 'NOVEDADES', 'SOLICITUDES', 'SLA', 'REPORTES'].forEach((c) => ctx.guardarCanalAlerta_(ADMIN, c, false));
  assert.equal(ctx.categoriaDeEvento_('ALERTA_ADMIN:abc'), null);
  const r = ctx.enviarAlertaManual_(ADMIN, Object.assign({ audiencia_tipo: 'TODOS' }, base));
  assert.equal(r.correo, 3);
});

test('getDirectorioAlerta_ es ADM-only y trae personas + empresas', () => {
  const ctx = load();
  assert.equal(ctx.getDirectorioAlerta_(NO_ADMIN)._forbidden, true);
  const dir = ctx.getDirectorioAlerta_(ADMIN);
  assert.equal(dir.personas.length, 3); // admin, ana, leo (ex inactivo fuera)
  // membresia (no deepEqual: el array viene de otro realm del sandbox vm).
  assert.equal(dir.empresas.length, 2);
  assert.ok(dir.empresas.indexOf('HP') !== -1 && dir.empresas.indexOf('RLD') !== -1);
});

test('registra la alerta en LOG_SISTEMA para trazabilidad', () => {
  const ctx = load();
  ctx.enviarAlertaManual_(ADMIN, Object.assign({ audiencia_tipo: 'TODOS' }, base));
  const logs = ctx.leerFilas_('LOG_SISTEMA').filter((l) => l.contexto === 'ALERTA_ADMIN');
  assert.equal(logs.length, 1);
  assert.ok(logs[0].mensaje.indexOf('admin@homepymes.cl') !== -1);
});

test('handlers responden ok:true y exigen administracion', () => {
  const ctx = load();
  const r1 = JSON.parse(ctx.handleGetDirectorioAlerta_({}, ADMIN).getContent());
  assert.equal(r1.ok, true);
  const r2 = JSON.parse(ctx.handleEnviarAlertaManual_(Object.assign({ audiencia_tipo: 'TODOS' }, base), ADMIN).getContent());
  assert.equal(r2.ok, true);
  assert.equal(ctx.MODULO_POR_ACCION.getDirectorioAlerta, 'administracion');
  assert.equal(ctx.MODULO_POR_ACCION.enviarAlertaManual, 'administracion');
});
