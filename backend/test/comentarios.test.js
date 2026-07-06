'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'COMENTARIOS', ctx.COLUMNAS.COMENTARIOS);
  return ctx;
}

function seedSolicitud(ctx) {
  const datos = { solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', estado_derivado: 'S02' };
  const fila = ctx.COLUMNAS.SOLICITUDES.map((col) => (datos[col] !== undefined ? datos[col] : ''));
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SOLICITUDES').appendRow(fila);
}

test('agregarComentario escribe el comentario con el usuario del contexto', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);

  const resultado = ctx.Comentarios.agregarComentario(
    { solicitud_id: 'SOL-2026-HP-0001', texto: 'Se reviso el caso' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );

  assert.equal(resultado.usuario, 'analista@homepymes.cl');
  assert.equal(resultado.es_interno, false);

  const comentarios = ctx.leerFilas_('COMENTARIOS');
  assert.equal(comentarios.length, 1);
  assert.equal(comentarios[0].texto, 'Se reviso el caso');
});

test('agregarComentario acepta es_interno=true', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);

  const resultado = ctx.Comentarios.agregarComentario(
    { solicitud_id: 'SOL-2026-HP-0001', texto: 'Nota interna', es_interno: true },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );

  assert.equal(resultado.es_interno, true);
});

test('agregarComentario rechaza texto vacio', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);

  const resultado = ctx.Comentarios.agregarComentario(
    { solicitud_id: 'SOL-2026-HP-0001', texto: '   ' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );

  assert.equal(resultado._validationError, true);
});

test('agregarComentario responde error de validacion si la solicitud no existe', () => {
  const ctx = loadConSchema();
  const resultado = ctx.Comentarios.agregarComentario(
    { solicitud_id: 'SOL-2026-HP-9999', texto: 'texto' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(resultado._validationError, true);
});
