'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, toPlain } = require('./helpers/gasSandbox');

const TODOS_LOS_TRIGGERS = [
  'cerrarInactivosTrigger', 'enviarReporteMensualTrigger', 'enviarResumenSemanalTrigger', 'procesarColaCorreoTrigger',
  'procesarColaDocumentosTrigger', 'refrescarCacheTrigger', 'suspenderInactivosTrigger', 'verificarSLAsTrigger'
];

test('configurarTriggers instala los 8 triggers de tiempo de §13/§16.3 (Fase 4 + Fase 7 + Sprint 1 v2.0)', () => {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  const creados = toPlain(ctx.configurarTriggers());

  assert.deepEqual(creados.sort(), TODOS_LOS_TRIGGERS);

  const nombres = ctx.ScriptApp.getProjectTriggers().map((t) => t.getHandlerFunction()).sort();
  assert.deepEqual(nombres, TODOS_LOS_TRIGGERS);
});

test('configurarTriggers es idempotente: correrla dos veces no duplica triggers', () => {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  ctx.configurarTriggers();
  const segundaCorrida = toPlain(ctx.configurarTriggers());

  assert.deepEqual(segundaCorrida, []);
  assert.equal(ctx.ScriptApp.getProjectTriggers().length, TODOS_LOS_TRIGGERS.length);
});

// RN-201/RF-208 (v2.0, Sprint 1): cierre automatico por inactividad.
function loadConSchemaCierre() {
  const { seedSheet } = require('./helpers/gasSandbox');
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'SUBSOLICITUDES', ctx.COLUMNAS.SUBSOLICITUDES);
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS);
  seedSheet(ctx, 'CONFIG_FERIADOS', ctx.COLUMNAS.CONFIG_FERIADOS);
  return ctx;
}

function seedSolicitudCierre(ctx, overrides) {
  const base = Object.assign(
    {
      solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', plataforma: 'ERP', modulo: 'Facturacion',
      tipo: 'ERROR', es_cliente: false, solicitante_nombre: 'Juan Perez', solicitante_email: 'juan@homepymes.cl',
      estado_derivado: 'S08', prioridad_derivada: 'P2', dedup_hash: 'x',
      fecha_creacion: new Date().toISOString(), creado_por: 'juan@homepymes.cl'
    },
    overrides
  );
  const fila = ctx.COLUMNAS.SOLICITUDES.map((col) => (base[col] === undefined ? '' : base[col]));
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SOLICITUDES').appendRow(fila);
  return base;
}

function seedSubsolicitudCierre(ctx, overrides) {
  const base = Object.assign(
    {
      subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001', titulo: 'Titulo',
      descripcion: 'Descripcion', prioridad: 'P2', estado: 'S08', tipo: 'ERR',
      fecha_creacion: new Date().toISOString()
    },
    overrides
  );
  const fila = ctx.COLUMNAS.SUBSOLICITUDES.map((col) => (base[col] === undefined ? '' : base[col]));
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SUBSOLICITUDES').appendRow(fila);
  return base;
}

test('Triggers.cerrarInactivosPorValidacion cierra un item Terminada con mas de 5 dias habiles sin validar', () => {
  const ctx = loadConSchemaCierre();
  seedSolicitudCierre(ctx);
  seedSubsolicitudCierre(ctx);
  ctx.agregarFila_('HISTORIAL_ESTADOS', {
    historial_id: 'h1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    estado_anterior: 'S07', estado_nuevo: 'S08', usuario: 'analista@homepymes.cl', comentario: '',
    // 10 dias corridos atras: sobran de sobra los 5 dias habiles exigidos.
    timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
  });

  const resultado = ctx.Triggers.cerrarInactivosPorValidacion();

  assert.equal(resultado.cerrados, 1);
  const subsolicitudes = ctx.leerFilas_('SUBSOLICITUDES');
  assert.equal(subsolicitudes[0].estado, 'S09');
});

test('Triggers.cerrarInactivosPorValidacion NO cierra un item Terminada reciente (aun dentro del plazo)', () => {
  const ctx = loadConSchemaCierre();
  seedSolicitudCierre(ctx);
  seedSubsolicitudCierre(ctx);
  ctx.agregarFila_('HISTORIAL_ESTADOS', {
    historial_id: 'h1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    estado_anterior: 'S07', estado_nuevo: 'S08', usuario: 'analista@homepymes.cl', comentario: '',
    timestamp: new Date().toISOString()
  });

  const resultado = ctx.Triggers.cerrarInactivosPorValidacion();

  assert.equal(resultado.cerrados, 0);
  const subsolicitudes = ctx.leerFilas_('SUBSOLICITUDES');
  assert.equal(subsolicitudes[0].estado, 'S08');
});
