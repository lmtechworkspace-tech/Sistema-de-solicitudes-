'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'SUBSOLICITUDES', ctx.COLUMNAS.SUBSOLICITUDES);
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS, [
    ['H1', 'SOL-2026-HP-0001', 'SOL-2026-HP-0001-01', '', 'S01', 'sistema', 'Creada', '2026-01-01T10:00:00.000Z'],
    ['H2', 'SOL-2026-HP-0001', 'SOL-2026-HP-0001-01', 'S01', 'S02', 'analista@homepymes.cl', 'Recibida', '2026-01-02T10:00:00.000Z']
  ]);
  seedSheet(ctx, 'HISTORIAL_PRIORIDAD', ctx.COLUMNAS.HISTORIAL_PRIORIDAD);
  seedSheet(ctx, 'COMENTARIOS', ctx.COLUMNAS.COMENTARIOS);
  return ctx;
}

function seedSolicitud(ctx) {
  const datos = {
    solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', plataforma: 'ERP', modulo: 'Facturacion',
    tipo: 'ERR', solicitante_nombre: 'Juan', solicitante_cargo: 'Analista', solicitante_email: 'juan@homepymes.cl',
    estado_derivado: 'S02', prioridad_derivada: 'P2', fecha_creacion: new Date().toISOString()
  };
  const fila = ctx.COLUMNAS.SOLICITUDES.map((col) => (datos[col] !== undefined ? datos[col] : ''));
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SOLICITUDES').appendRow(fila);

  const subFila = ctx.COLUMNAS.SUBSOLICITUDES.map((col) => ({
    subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001', numero_item: 1,
    titulo: 'Titulo', descripcion: 'Desc', estado: 'S02', prioridad: 'P2', fecha_creacion: new Date().toISOString()
  }[col] || ''));
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SUBSOLICITUDES').appendRow(subFila);
}

test('getDetalle devuelve solicitud, subsolicitudes, historial y comentarios', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);

  const detalle = ctx.Solicitudes.getDetalle('SOL-2026-HP-0001');

  assert.equal(detalle.solicitud.solicitud_id, 'SOL-2026-HP-0001');
  assert.equal(detalle.subsolicitudes.length, 1);
  assert.equal(detalle.historial_estados.length, 2);
  assert.equal(detalle.historial_estados[0].estado_nuevo, 'S01');
  assert.equal(detalle.historial_estados[1].estado_nuevo, 'S02');
  assert.equal(detalle.comentarios.length, 0);
});

test('getDetalle responde error de validacion si la solicitud no existe', () => {
  const ctx = loadConSchema();
  const detalle = ctx.Solicitudes.getDetalle('SOL-2026-HP-9999');
  assert.equal(detalle._validationError, true);
});

test('doPost action=getSolicitudDetalle responde ok:true end-to-end', () => {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' },
    activeUserEmail: 'admin@homepymes.cl'
  });
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'SUBSOLICITUDES', ctx.COLUMNAS.SUBSOLICITUDES);
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS);
  seedSheet(ctx, 'HISTORIAL_PRIORIDAD', ctx.COLUMNAS.HISTORIAL_PRIORIDAD);
  seedSheet(ctx, 'COMENTARIOS', ctx.COLUMNAS.COMENTARIOS);
  seedSolicitud(ctx);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Admin', 'admin@homepymes.cl', 'HP', 'ADM', true, '', 'sistema']
  ]);

  const output = ctx.doPost({
    postData: { contents: JSON.stringify({ action: 'getSolicitudDetalle', data: { solicitud_id: 'SOL-2026-HP-0001' } }) }
  });
  const parsed = JSON.parse(output.getContent());

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.solicitud.solicitud_id, 'SOL-2026-HP-0001');
});
