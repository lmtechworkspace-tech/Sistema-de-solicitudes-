'use strict';

/**
 * v6.0 (mejoras post-P5): #6 tendencia semanal de cumplimiento (Gerencia +
 * coordinador comparten calcularReportePausas_) y #7 historial/racha de
 * participacion por trabajador (para el coordinador).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

const ADMIN = { rol: 'ADM', email: 'admin@homepymes.cl' };
const COORD = { rol: 'SOLICITANTE', email: 'amarlla@hp.cl' };

function hoy() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function diasAtras(n) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(Date.now() - n * 24 * 3600 * 1000));
}

function load(opts) {
  opts = opts || {};
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'PAUSAS_CONFIG', ctx.COLUMNAS.PAUSAS_CONFIG, [['HP', '09:30', '1,2,3,4,5', 10, 15, 80, 60, true]]);
  seedSheet(ctx, 'PAUSAS_COORDINADORES', ctx.COLUMNAS.PAUSAS_COORDINADORES, [
    ['CO-1', 'HP', 'Amarlla', 'amarlla@hp.cl', 'titular', true]
  ]);
  seedSheet(ctx, 'PAUSAS_TRABAJADORES', ctx.COLUMNAS.PAUSAS_TRABAJADORES, opts.trabajadores || [
    ['T1', 'HP', 'Juan', 'juan@hp.cl', 'Bodega', 'Operario', true, '2026-01-01']
  ]);
  seedSheet(ctx, 'PAUSAS_PROGRAMADAS', ctx.COLUMNAS.PAUSAS_PROGRAMADAS, opts.pausas || []);
  seedSheet(ctx, 'PAUSAS_ASISTENCIA', ctx.COLUMNAS.PAUSAS_ASISTENCIA, opts.asistencia || []);
  seedSheet(ctx, 'PAUSAS_LOG', ctx.COLUMNAS.PAUSAS_LOG);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [['U1', 'Admin', 'admin@homepymes.cl', 'HP', 'ADM', true, '', 'sistema']]);
  seedSheet(ctx, 'CUENTAS_PORTAL', ctx.COLUMNAS.CUENTAS_PORTAL, []);
  return ctx;
}

// --- #6 tendencia -------------------------------------------------------

test('tendencia: calcularReportePausas_ trae 8 semanas y refleja realizadas/no_realizadas de esta semana', () => {
  const ctx = load({
    pausas: [
      ['PA-1', 'HP', hoy(), '09:30', '', '', '', 'Realizada', 10, ''],
      ['PA-2', 'HP', hoy(), '09:30', '', '', '', 'No_realizada', 10, '']
    ]
  });
  const res = ctx.Pausas.getReporteGerencia({}, ADMIN);
  assert.equal(res.tendencia.length, 8);
  const ultima = res.tendencia[res.tendencia.length - 1];
  assert.equal(ultima.realizadas, 1);
  assert.equal(ultima.no_realizadas, 1);
  assert.equal(ultima.pct_cumplimiento, 50);
});

test('tendencia: una pausa Cancelada no cuenta ni como realizada ni como no_realizada', () => {
  const ctx = load({ pausas: [['PA-1', 'HP', hoy(), '09:30', '', '', '', 'Cancelada', 10, '']] });
  const res = ctx.Pausas.getReporteGerencia({}, ADMIN);
  const ultima = res.tendencia[res.tendencia.length - 1];
  assert.equal(ultima.realizadas, 0);
  assert.equal(ultima.no_realizadas, 0);
  assert.equal(ultima.pct_cumplimiento, null);
});

test('tendencia: tambien viaja en el reporte del coordinador (getReporteCumplimiento)', () => {
  const ctx = load({ pausas: [['PA-1', 'HP', hoy(), '09:30', '', '', '', 'Realizada', 10, '']] });
  const res = ctx.Pausas.getReporteCumplimiento({}, ADMIN);
  assert.ok(Array.isArray(res.tendencia));
  assert.equal(res.tendencia.length, 8);
});

// --- #7 roster + historial -----------------------------------------------

test('listarRosterCoordinador: ADM ve el roster activo de todas las empresas con config', () => {
  const ctx = load({
    trabajadores: [
      ['T1', 'HP', 'Juan', 'juan@hp.cl', 'Bodega', 'Operario', true, '2026-01-01'],
      ['T2', 'HP', 'Ana', 'ana@hp.cl', 'Ventas', 'Vendedora', false, '2026-01-01'] // inactiva
    ]
  });
  const res = ctx.Pausas.listarRosterCoordinador({}, ADMIN);
  assert.equal(res.roster.length, 1);
  assert.equal(res.roster[0].trabajador_id, 'T1');
});

test('listarRosterCoordinador: sin empresas a cargo devuelve sin_empresa', () => {
  const ctx = load();
  const res = ctx.Pausas.listarRosterCoordinador({}, { rol: 'SOLICITANTE', email: 'nadie@hp.cl' });
  assert.equal(res.sin_empresa, true);
});

test('getHistorialTrabajador: calcula racha actual y maxima sobre pausas resueltas', () => {
  const ctx = load({
    pausas: [
      ['PA-1', 'HP', diasAtras(5), '09:30', '', '', '', 'Realizada', 10, ''],
      ['PA-2', 'HP', diasAtras(4), '09:30', '', '', '', 'Realizada', 10, ''],
      ['PA-3', 'HP', diasAtras(3), '09:30', '', '', '', 'No_realizada', 10, ''],
      ['PA-4', 'HP', diasAtras(2), '09:30', '', '', '', 'Realizada', 10, ''],
      ['PA-5', 'HP', diasAtras(1), '09:30', '', '', '', 'Realizada', 10, '']
    ],
    asistencia: [
      ['R1', 'PA-1', 'T1', 'juan@hp.cl', diasAtras(5) + 'T09:35:00Z', 'participo', '', '', true, 'autoservicio'],
      ['R2', 'PA-2', 'T1', 'juan@hp.cl', diasAtras(4) + 'T09:35:00Z', 'participo', '', '', true, 'autoservicio'],
      // PA-3: Juan no registro nada (pendiente) -- y la pausa quedo No_realizada.
      ['R4', 'PA-4', 'T1', 'juan@hp.cl', diasAtras(2) + 'T09:35:00Z', 'participo', '', '', true, 'autoservicio'],
      ['R5', 'PA-5', 'T1', 'juan@hp.cl', diasAtras(1) + 'T09:35:00Z', 'participo', '', '', true, 'autoservicio']
    ]
  });
  const res = ctx.Pausas.getHistorialTrabajador({ trabajador_id: 'T1' }, ADMIN);
  assert.equal(res.resumen.total_pausas, 5);
  assert.equal(res.resumen.participaciones, 4);
  assert.equal(res.resumen.pendientes, 1);
  assert.equal(res.resumen.racha_actual, 2); // PA-4, PA-5
  assert.equal(res.resumen.racha_maxima, 2); // PA-1,PA-2 tambien es 2
  assert.equal(res.detalle[0].fecha, diasAtras(1)); // mas reciente primero
});

test('getHistorialTrabajador: exige trabajador_id y rechaza si no coordina esa empresa', () => {
  const ctx = load();
  assert.equal(ctx.Pausas.getHistorialTrabajador({}, ADMIN)._validationError, true);
  const otraEmpresa = load({ trabajadores: [['T9', 'RLD', 'Pedro', 'pedro@rld.cl', 'Bodega', 'Op', true, '2026-01-01']] });
  const res = otraEmpresa.Pausas.getHistorialTrabajador({ trabajador_id: 'T9' }, { rol: 'SOLICITANTE', email: 'amarlla@hp.cl' });
  assert.equal(res._forbidden, true);
});
