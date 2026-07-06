'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'SUBSOLICITUDES', ctx.COLUMNAS.SUBSOLICITUDES);
  seedSheet(ctx, 'HISTORIAL_PRIORIDAD', ctx.COLUMNAS.HISTORIAL_PRIORIDAD);
  seedSheet(ctx, 'CONFIG_SLA', ctx.COLUMNAS.CONFIG_SLA, [
    ['P1', 2], ['P2', 24], ['P3', 72], ['P4', 120], ['P5', '']
  ]);
  return ctx;
}

function seedSubsolicitud(ctx, overrides) {
  const base = Object.assign(
    {
      subsolicitud_id: 'SOL-2026-HP-0001-01',
      solicitud_id: 'SOL-2026-HP-0001',
      titulo: 'Titulo', descripcion: 'Descripcion',
      impacto: 'DEGRADACION_IMPORTANTE', urgencia_cliente: '',
      prioridad: 'P2', estado: 'S03', ref_credencial: '',
      sla_objetivo_horas: 24, fecha_creacion: new Date().toISOString()
    },
    overrides
  );
  const fila = ctx.COLUMNAS.SUBSOLICITUDES.map((col) => base[col]);
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SUBSOLICITUDES').appendRow(fila);
  return base;
}

function seedSolicitud(ctx, overrides) {
  const base = Object.assign(
    {
      solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', plataforma: 'ERP', modulo: 'Facturacion',
      tipo: 'ERROR', es_cliente: false, empresa_cliente: '', contacto_cliente: '', correo_cliente: '',
      solicitante_nombre: 'Juan Perez', solicitante_email: 'juan@homepymes.cl',
      estado_derivado: 'S03', prioridad_derivada: 'P2', orden_atencion: '',
      doc_estado: '', url_doc: '', url_pdf: '', dedup_hash: 'x',
      estimacion_total_horas: 4, horas_reales: '', resumen_whatsapp: '',
      fecha_creacion: new Date().toISOString(), creado_por: 'juan@homepymes.cl'
    },
    overrides
  );
  const fila = ctx.COLUMNAS.SOLICITUDES.map((col) => base[col]);
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SOLICITUDES').appendRow(fila);
  return base;
}

const JUSTIFICACION_VALIDA = 'Se reevalua por nuevo impacto reportado';

test('actualizarPrioridad (RN-007): Analista puede cambiar la prioridad con justificacion valida y queda en historial', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx);

  const resultado = ctx.Solicitudes.actualizarPrioridad(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', prioridad_nueva: 'P1', justificacion: JUSTIFICACION_VALIDA },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );

  assert.equal(resultado.prioridad_anterior, 'P2');
  assert.equal(resultado.prioridad_nueva, 'P1');
  assert.equal(resultado.prioridad_derivada_padre, 'P1');

  const subsolicitudes = ctx.leerFilas_('SUBSOLICITUDES');
  assert.equal(subsolicitudes[0].prioridad, 'P1');
  assert.equal(subsolicitudes[0].sla_objetivo_horas, 2);

  const historial = ctx.leerFilas_('HISTORIAL_PRIORIDAD');
  assert.equal(historial.length, 1);
  assert.equal(historial[0].prioridad_anterior, 'P2');
  assert.equal(historial[0].prioridad_nueva, 'P1');
});

test('actualizarPrioridad (RN-007): se puede modificar mas de una vez, sin tope', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx);

  ctx.Solicitudes.actualizarPrioridad(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', prioridad_nueva: 'P1', justificacion: JUSTIFICACION_VALIDA },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  const segundo = ctx.Solicitudes.actualizarPrioridad(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', prioridad_nueva: 'P3', justificacion: JUSTIFICACION_VALIDA },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );

  assert.equal(segundo.prioridad_anterior, 'P1');
  assert.equal(segundo.prioridad_nueva, 'P3');
  assert.equal(ctx.leerFilas_('HISTORIAL_PRIORIDAD').length, 2);
});

test('actualizarPrioridad (RN-007): exige justificacion de al menos 20 caracteres', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx);

  const resultado = ctx.Solicitudes.actualizarPrioridad(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', prioridad_nueva: 'P1', justificacion: 'muy corta' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );

  assert.equal(resultado._validationError, true);
});

test('actualizarPrioridad (RN-008): el Desarrollador no puede modificar la prioridad', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx);

  const resultado = ctx.Solicitudes.actualizarPrioridad(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', prioridad_nueva: 'P1', justificacion: JUSTIFICACION_VALIDA },
    { email: 'dev@homepymes.cl', rol: 'DEV' }
  );

  assert.equal(resultado._forbidden, true);
});

test('actualizarPrioridad rechaza un valor de prioridad invalido', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx);

  const resultado = ctx.Solicitudes.actualizarPrioridad(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', prioridad_nueva: 'P9', justificacion: JUSTIFICACION_VALIDA },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );

  assert.equal(resultado._validationError, true);
});

test('actualizarPrioridad (RN-009): solo Admin puede fijar orden_atencion', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);

  const comoAnalista = ctx.Solicitudes.actualizarPrioridad(
    { solicitud_id: 'SOL-2026-HP-0001', orden_atencion: 1 },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(comoAnalista._forbidden, true);

  const comoAdmin = ctx.Solicitudes.actualizarPrioridad(
    { solicitud_id: 'SOL-2026-HP-0001', orden_atencion: 1 },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );
  assert.equal(comoAdmin.orden_atencion, 1);

  const solicitudes = ctx.leerFilas_('SOLICITUDES');
  assert.equal(solicitudes[0].orden_atencion, 1);
});

test('actualizarPrioridad: Analista puede asignar el desarrollador responsable', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);

  const resultado = ctx.Solicitudes.actualizarPrioridad(
    { solicitud_id: 'SOL-2026-HP-0001', desarrollador_asignado: 'dev@homepymes.cl' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );

  assert.equal(resultado.desarrollador_asignado, 'dev@homepymes.cl');
  const solicitudes = ctx.leerFilas_('SOLICITUDES');
  assert.equal(solicitudes[0].desarrollador_asignado, 'dev@homepymes.cl');
});

test('actualizarPrioridad: el Desarrollador no puede asignar responsables (RN-008 style)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);

  const resultado = ctx.Solicitudes.actualizarPrioridad(
    { solicitud_id: 'SOL-2026-HP-0001', desarrollador_asignado: 'dev@homepymes.cl' },
    { email: 'dev@homepymes.cl', rol: 'DEV' }
  );

  assert.equal(resultado._forbidden, true);
});

test('actualizarPrioridad: solo Admin puede reasignar el analista responsable', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);

  const comoAnalista = ctx.Solicitudes.actualizarPrioridad(
    { solicitud_id: 'SOL-2026-HP-0001', analista_asignado: 'otro-analista@homepymes.cl' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(comoAnalista._forbidden, true);

  const comoAdmin = ctx.Solicitudes.actualizarPrioridad(
    { solicitud_id: 'SOL-2026-HP-0001', analista_asignado: 'otro-analista@homepymes.cl' },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );
  assert.equal(comoAdmin.analista_asignado, 'otro-analista@homepymes.cl');
});

test('actualizarPrioridad: Analista puede asignar el desarrollador de una subsolicitud puntual (§13.3 v1.0)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-01' });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-02' });

  const resultado = ctx.Solicitudes.actualizarPrioridad(
    { solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-02', desarrollador_asignado: 'dev-b@homepymes.cl' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );

  assert.equal(resultado.subsolicitud_id, 'SOL-2026-HP-0001-02');
  assert.equal(resultado.desarrollador_asignado, 'dev-b@homepymes.cl');

  const subsolicitudes = ctx.leerFilas_('SUBSOLICITUDES');
  const sub1 = subsolicitudes.find((s) => s.subsolicitud_id === 'SOL-2026-HP-0001-01');
  const sub2 = subsolicitudes.find((s) => s.subsolicitud_id === 'SOL-2026-HP-0001-02');
  assert.equal(sub2.desarrollador_asignado, 'dev-b@homepymes.cl');
  assert.equal(sub1.desarrollador_asignado, '');

  // La solicitud "por defecto" no se toca cuando la asignacion es puntual.
  const solicitudes = ctx.leerFilas_('SOLICITUDES');
  assert.equal(solicitudes[0].desarrollador_asignado, '');
});

test('actualizarPrioridad (asignacion por subsolicitud): responde error de validacion si la subsolicitud no existe', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);

  const resultado = ctx.Solicitudes.actualizarPrioridad(
    { solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-9999-01', desarrollador_asignado: 'dev@homepymes.cl' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );

  assert.equal(resultado._validationError, true);
});

test('actualizarPrioridad (asignacion): responde error de validacion si la solicitud no existe', () => {
  const ctx = loadConSchema();
  const resultado = ctx.Solicitudes.actualizarPrioridad(
    { solicitud_id: 'SOL-2026-HP-9999', desarrollador_asignado: 'dev@homepymes.cl' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(resultado._validationError, true);
});
