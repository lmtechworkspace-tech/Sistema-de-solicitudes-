'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadIntakeProject, loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function loadIntakeConSchema() {
  const ctx = loadIntakeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Analista Uno', 'analista@homepymes.cl', 'HP', 'ANA', true, '', 'sistema'],
    ['U2', 'Dev Uno', 'dev@homepymes.cl', 'HP', 'DEV', true, '', 'sistema'],
    ['U3', 'Analista Inactivo', 'inactivo@homepymes.cl', 'HP', 'ANA', false, '', 'sistema']
  ]);
  return ctx;
}

function loadBackofficeConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U2', 'Dev Uno', 'dev@homepymes.cl', 'HP', 'DEV', true, '', 'sistema']
  ]);
  return ctx;
}

test('enviarAcuseRecibo envia el correo y lo registra en LOG_NOTIFICACIONES', () => {
  const ctx = loadIntakeConSchema();
  const resultado = ctx.Notificaciones.enviarAcuseRecibo({
    solicitud_id: 'SOL-2026-HP-0001', solicitante_nombre: 'Juan', solicitante_email: 'juan@x.cl', resumen_whatsapp: 'r'
  });

  assert.equal(resultado.enviado, true);
  assert.equal(ctx.GmailApp._enviados.length, 1);
  assert.equal(ctx.GmailApp._enviados[0].destinatario, 'juan@x.cl');

  const log = ctx.leerFilas_('LOG_NOTIFICACIONES');
  assert.equal(log.length, 1);
  assert.equal(log[0].evento, 'ACUSE_RECIBO');
  assert.equal(log[0].resultado, 'ENVIADO');
});

test('enviarAcuseRecibo copia el cc opcional (Fase 9, hallazgo de datos reales)', () => {
  const ctx = loadIntakeConSchema();
  ctx.Notificaciones.enviarAcuseRecibo({
    solicitud_id: 'SOL-2026-HP-0002', solicitante_nombre: 'Juan', solicitante_email: 'juan@x.cl',
    resumen_whatsapp: 'r', cc: 'copia@x.cl'
  });

  assert.equal(ctx.GmailApp._enviados[0].opciones.cc, 'copia@x.cl');
});

test('el mismo evento para la misma solicitud se deduplica dentro de 30 minutos (RN-026)', () => {
  const ctx = loadIntakeConSchema();
  const datos = { solicitud_id: 'SOL-2026-HP-0001', solicitante_nombre: 'Juan', solicitante_email: 'juan@x.cl', resumen_whatsapp: 'r' };

  ctx.Notificaciones.enviarAcuseRecibo(datos);
  const segundo = ctx.Notificaciones.enviarAcuseRecibo(datos);

  assert.equal(segundo.enviado, false);
  assert.equal(segundo.motivo, 'deduplicado');
  assert.equal(ctx.GmailApp._enviados.length, 1, 'no debe reenviar el correo');
});

test('enviarAvisoDesarrollo avisa al buzon de desarrollo (Leo) con el motivo', () => {
  const ctx = loadIntakeConSchema();
  ctx.Notificaciones.enviarAvisoDesarrollo(
    { solicitud_id: 'SOL-2026-HP-0001', prioridad: 'P2', resumen_whatsapp: 'r' },
    'solicitud de cliente'
  );

  assert.equal(ctx.GmailApp._enviados.length, 1);
  assert.equal(ctx.GmailApp._enviados[0].destinatario, 'lestay@rld.cl');
  assert.ok(ctx.GmailApp._enviados[0].cuerpo.indexOf('solicitud de cliente') !== -1);

  const log = ctx.leerFilas_('LOG_NOTIFICACIONES');
  assert.equal(log[0].evento, 'AVISO_DESARROLLO');
});

test('enviarAvisoDesarrollo marca ALERTA P1 en el asunto cuando la prioridad es P1', () => {
  const ctx = loadIntakeConSchema();
  ctx.Notificaciones.enviarAvisoDesarrollo(
    { solicitud_id: 'SOL-2026-HP-0002', prioridad: 'P1', resumen_whatsapp: 'r' },
    'prioridad critica P1'
  );

  assert.ok(ctx.GmailApp._enviados[0].asunto.indexOf('ALERTA P1') !== -1);
});

test('enviarCorreo_ encola para reintento si GmailApp falla (cuota, A-12)', () => {
  const ctx = loadIntakeConSchema();
  ctx.GmailApp._forzarFallo(() => true);

  const resultado = ctx.Notificaciones.enviarAcuseRecibo({
    solicitud_id: 'SOL-2026-HP-0001', solicitante_nombre: 'Juan', solicitante_email: 'juan@x.cl', resumen_whatsapp: 'r'
  });

  assert.equal(resultado.enviado, false);
  assert.equal(resultado.motivo, 'error_envio');
  const log = ctx.leerFilas_('LOG_NOTIFICACIONES');
  assert.equal(log[0].resultado, 'PENDIENTE_REINTENTO');
});

test('notificarCambioEstado (Backoffice) envia al solicitante registrado en la solicitud', () => {
  const ctx = loadBackofficeConSchema();
  const fila = ctx.COLUMNAS.SOLICITUDES.map((col) => ({
    solicitud_id: 'SOL-2026-HP-0001', solicitante_email: 'juan@x.cl', empresa_id: 'HP'
  }[col] || ''));
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SOLICITUDES').appendRow(fila);

  const resultado = ctx.Notificaciones.notificarCambioEstado('SOL-2026-HP-0001', 'SOL-2026-HP-0001-01', 'S02', 'S03');

  assert.equal(resultado.enviado, true);
  assert.equal(ctx.GmailApp._enviados[0].destinatario, 'juan@x.cl');
});

test('procesarColaCorreo reintenta notificaciones pendientes y las marca ENVIADO', () => {
  const ctx = loadBackofficeConSchema();
  ctx.registrarNotificacion_('SOL-2026-HP-0001', 'EMAIL', 'juan@x.cl', 'ACUSE_RECIBO', 'PENDIENTE_REINTENTO', 1);

  const resultado = ctx.Notificaciones.procesarColaCorreo();

  assert.equal(resultado[0].resultado, 'ENVIADO');
  const log = ctx.leerFilas_('LOG_NOTIFICACIONES');
  assert.equal(log[0].resultado, 'ENVIADO');
});

test('procesarColaCorreo marca FALLIDO tras alcanzar el maximo de reintentos', () => {
  const ctx = loadBackofficeConSchema();
  ctx.GmailApp._forzarFallo(() => true);
  ctx.registrarNotificacion_('SOL-2026-HP-0001', 'EMAIL', 'juan@x.cl', 'ACUSE_RECIBO', 'PENDIENTE_REINTENTO', 2);

  ctx.Notificaciones.procesarColaCorreo();

  const log = ctx.leerFilas_('LOG_NOTIFICACIONES');
  assert.equal(log[0].resultado, 'FALLIDO');
  assert.equal(Number(log[0].reintentos), 3);
});
