'use strict';

// v3.0 (Fase 2.1, hallazgo real de produccion): responderConsulta y
// validarCierre avisaban SIEMPRE al buzon por defecto (EMAIL_DESARROLLO,
// Leo) sin importar a quien estaba ruteado el item -- tenia sentido cuando
// Leo era el unico desarrollador, pero ahora que el ruteo por area (Fase 1)
// asigna cada item a un responsable distinto, el aviso debe llegarle a ESE
// responsable, no siempre a Leo.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadIntakeProject, seedSheet } = require('./helpers/gasSandbox');

const BUZON_DEFECTO = 'lestay@rld.cl';

function loadConSchema() {
  const ctx = loadIntakeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'SUBSOLICITUDES', ctx.COLUMNAS.SUBSOLICITUDES);
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'COMENTARIOS', ctx.COLUMNAS.COMENTARIOS);
  return ctx;
}

function seedSolicitud(ctx, overrides) {
  const base = Object.assign(
    {
      solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', plataforma: 'ERP', modulo: 'Facturacion',
      tipo: 'ERR', solicitante_nombre: 'Juan', solicitante_cargo: 'Analista', solicitante_email: 'juan@homepymes.cl',
      estado_derivado: 'S05', prioridad_derivada: 'P2', dedup_hash: 'x', desarrollador_asignado: '',
      estimacion_total_horas: 4, fecha_creacion: new Date().toISOString(), creado_por: 'juan@homepymes.cl'
    },
    overrides
  );
  const fila = ctx.COLUMNAS.SOLICITUDES.map((col) => (base[col] !== undefined ? base[col] : ''));
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SOLICITUDES').appendRow(fila);
  return base;
}

function seedSubsolicitud(ctx, overrides) {
  const base = Object.assign(
    {
      subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001', numero_item: 1,
      titulo: 't', descripcion: 'd', prioridad: 'P2', estado: 'S06',
      sla_objetivo_horas: 24, fecha_creacion: new Date().toISOString(), desarrollador_asignado: ''
    },
    overrides
  );
  const fila = ctx.COLUMNAS.SUBSOLICITUDES.map((col) => (base[col] !== undefined ? base[col] : ''));
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SUBSOLICITUDES').appendRow(fila);
  return base;
}

function destinatariosDe(ctx, evento) {
  return ctx.leerFilas_('LOG_NOTIFICACIONES')
    .filter((n) => n.evento.indexOf(evento) === 0)
    .map((n) => n.destinatario);
}

test('responderConsulta (v3.0): avisa al responsable del item, no al buzon por defecto', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { desarrollador_asignado: 'homepymes89@gmail.com' });
  seedSubsolicitud(ctx, { desarrollador_asignado: 'homepymes89@gmail.com' });

  ctx.Solicitudes.responderConsulta({
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    email: 'juan@homepymes.cl', texto: 'aqui la info que pediste'
  });

  const destinatarios = destinatariosDe(ctx, 'RESPUESTA_SOLICITANTE');
  assert.deepEqual(destinatarios, ['homepymes89@gmail.com']);
});

test('responderConsulta (v3.0): sin subsolicitud_id, avisa a todos los responsables distintos de la solicitud', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { desarrollador_asignado: 'a@rld.cl' });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-01', desarrollador_asignado: 'a@rld.cl' });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-02', numero_item: 2, desarrollador_asignado: 'b@rld.cl' });

  ctx.Solicitudes.responderConsulta({
    solicitud_id: 'SOL-2026-HP-0001', email: 'juan@homepymes.cl', texto: 'respuesta general'
  });

  const destinatarios = destinatariosDe(ctx, 'RESPUESTA_SOLICITANTE').sort();
  assert.deepEqual(destinatarios, ['a@rld.cl', 'b@rld.cl']);
});

test('responderConsulta (v3.0): sin ruteo (item sin desarrollador_asignado), cae al buzon por defecto', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx);

  ctx.Solicitudes.responderConsulta({
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    email: 'juan@homepymes.cl', texto: 'info'
  });

  assert.deepEqual(destinatariosDe(ctx, 'RESPUESTA_SOLICITANTE'), [BUZON_DEFECTO]);
});

test('validarCierre (v3.0): avisa al responsable del item, no al buzon por defecto', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { desarrollador_asignado: 'homepymes89@gmail.com' });
  seedSubsolicitud(ctx, { estado: 'S08', desarrollador_asignado: 'homepymes89@gmail.com' });

  ctx.Solicitudes.validarCierre({
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    email: 'juan@homepymes.cl', accion: 'confirmar'
  });

  assert.deepEqual(destinatariosDe(ctx, 'VALIDACION_SOLICITANTE'), ['homepymes89@gmail.com']);
});

test('validarCierre (v3.0): sin ruteo, cae al buzon por defecto (retrocompatible)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S08' });

  ctx.Solicitudes.validarCierre({
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    email: 'juan@homepymes.cl', accion: 'reabrir', comentario: 'falta algo'
  });

  assert.deepEqual(destinatariosDe(ctx, 'VALIDACION_SOLICITANTE'), [BUZON_DEFECTO]);
});
