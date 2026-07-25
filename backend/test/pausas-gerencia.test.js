'use strict';

/**
 * v6.0 (modulo Pausas Activas, Fase P5): reporte de cumplimiento para el Panel
 * de Gerencia (todas las empresas) + reportes periodicos por correo con PDF
 * adjunto (a Gerencia + prevencionistas).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

const GERENCIA = { rol: 'GERENCIA', email: 'gerente@homepymes.cl' };
const DEV = { rol: 'DEV', email: 'dev@homepymes.cl' };

function hoyClave() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function load() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'PAUSAS_CONFIG', ctx.COLUMNAS.PAUSAS_CONFIG, [
    ['HP', '09:30', '1,2,3,4,5', 10, 15, 80, 60, true],
    ['RLD', '10:00', '1,2,3,4,5', 10, 15, 80, 60, true]
  ]);
  seedSheet(ctx, 'PAUSAS_COORDINADORES', ctx.COLUMNAS.PAUSAS_COORDINADORES, [
    ['CO-1', 'HP', 'Amarlla', 'amarlla@hp.cl', 'titular', true]
  ]);
  seedSheet(ctx, 'PAUSAS_TRABAJADORES', ctx.COLUMNAS.PAUSAS_TRABAJADORES, [
    ['T1', 'HP', 'Juan', 'juan@hp.cl', 'Bodega', 'Operario', true, '2026-01-01']
  ]);
  const hoy = hoyClave();
  seedSheet(ctx, 'PAUSAS_PROGRAMADAS', ctx.COLUMNAS.PAUSAS_PROGRAMADAS, [
    ['PA-1', 'HP', hoy, '09:30', '', '', '', 'Realizada', 10, ''],
    ['PA-2', 'RLD', hoy, '10:00', '', '', '', 'No_realizada', 10, 'sin gente']
  ]);
  seedSheet(ctx, 'PAUSAS_ASISTENCIA', ctx.COLUMNAS.PAUSAS_ASISTENCIA, [
    ['R1', 'PA-1', 'T1', 'juan@hp.cl', hoy + 'T09:35:00Z', 'participo', '', '', true, 'autoservicio']
  ]);
  seedSheet(ctx, 'PAUSAS_LOG', ctx.COLUMNAS.PAUSAS_LOG);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Gerente', 'gerente@homepymes.cl', 'HP', 'GERENCIA', true, '', 'sistema']
  ]);
  return ctx;
}

test('getReporteGerencia agrega TODAS las empresas para GERENCIA', () => {
  const ctx = load();
  const res = ctx.Pausas.getReporteGerencia({}, GERENCIA);
  // 1 realizada (HP) + 1 no realizada (RLD) => cumplimiento 50%.
  assert.equal(res.kpis.programadas, 2);
  assert.equal(res.kpis.realizadas, 1);
  assert.equal(res.kpis.no_realizadas, 1);
  assert.equal(res.kpis.pct_cumplimiento, 50);
  assert.equal(res.kpis.participaciones, 1);
});

test('getReporteGerencia acepta filtro por empresa', () => {
  const ctx = load();
  const res = ctx.Pausas.getReporteGerencia({ empresa_id: 'HP' }, GERENCIA);
  assert.equal(res.kpis.programadas, 1);
  assert.equal(res.kpis.realizadas, 1);
  assert.equal(res.kpis.pct_cumplimiento, 100);
});

test('getReporteGerencia no expone datos a un rol que no es GERENCIA/ADM', () => {
  const ctx = load();
  const res = ctx.Pausas.getReporteGerencia({}, DEV);
  assert.equal(res.sin_datos, true);
});

test('enviarReporteSemanalPausas manda correo HTML con PDF adjunto a Gerencia + prevencionistas', () => {
  const ctx = load();
  const res = ctx.Pausas.enviarReporteSemanalPausas();
  assert.equal(res.periodo, 'semanal');
  // gerente (USUARIOS) + amarlla (coordinadora) = 2.
  assert.equal(res.correos_enviados, 2);
  const dests = ctx.MailApp._enviados.map((e) => e.destinatario).sort();
  assert.deepEqual(dests, ['amarlla@hp.cl', 'gerente@homepymes.cl']);
  const primero = ctx.MailApp._enviados[0];
  assert.ok(primero.opciones.htmlBody.indexOf('SIGSO') !== -1);
  // Lleva el PDF adjunto.
  assert.ok(primero.opciones.attachments && primero.opciones.attachments.length === 1);
});

test('enviarReporteMensualPausas usa la etiqueta mensual', () => {
  const ctx = load();
  const res = ctx.Pausas.enviarReporteMensualPausas();
  assert.equal(res.periodo, 'mensual');
  assert.ok(res.correos_enviados >= 1);
});
