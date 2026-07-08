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
  seedSheet(ctx, 'ARCHIVOS', ctx.COLUMNAS.ARCHIVOS);
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
  assert.equal(detalle.archivos.length, 0);
});

// v2.1 (Fase B): getDetalle agrega el semaforo de cumplimiento por item
// (Cumplimiento.gs), sin fecha_comprometida el item activo es SIN_COMPROMISO.
test('getDetalle (v2.1) agrega cumplimiento a cada subsolicitud', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);

  const detalle = ctx.Solicitudes.getDetalle('SOL-2026-HP-0001');

  assert.equal(detalle.subsolicitudes[0].cumplimiento.codigo, 'SIN_COMPROMISO');
});

test('getDetalle incluye los archivos de la solicitud (Fase 9, para la galeria del panel de Leo)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  const hojaArchivos = ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('ARCHIVOS');
  hojaArchivos.appendRow(['A1', 'SOL-2026-HP-0001', '', 'general.png', 'https://drive/general', 'image/png', 1000, '2026-01-01T10:00:00.000Z']);
  hojaArchivos.appendRow(['A2', 'SOL-2026-HP-0001', 'SOL-2026-HP-0001-01', 'item.png', 'https://drive/item', 'image/png', 1000, '2026-01-01T10:00:00.000Z']);
  hojaArchivos.appendRow(['A3', 'SOL-2026-HP-9999', '', 'otra.png', 'https://drive/otra', 'image/png', 1000, '2026-01-01T10:00:00.000Z']);

  const detalle = ctx.Solicitudes.getDetalle('SOL-2026-HP-0001');

  assert.equal(detalle.archivos.length, 2);
  assert.ok(detalle.archivos.some((a) => a.archivo_id === 'A1' && !a.subsolicitud_id));
  assert.ok(detalle.archivos.some((a) => a.archivo_id === 'A2' && a.subsolicitud_id === 'SOL-2026-HP-0001-01'));
});

test('getDetalle ofrece los 11 estados menos el actual (y menos Cerrada, RN-201), iguales para cualquier rol (Fase 10.2 + Sprint 1 v2.0)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx); // subsolicitud en S02, tipo ERR (no es consulta tecnica)

  const comoAnalista = ctx.Solicitudes.getDetalle('SOL-2026-HP-0001', { rol: 'ANA', email: 'a@a.cl' });
  const comoDev = ctx.Solicitudes.getDetalle('SOL-2026-HP-0001', { rol: 'DEV', email: 'd@d.cl' });

  // Ya no hay grafo de "siguiente paso logico": el selector ofrece los
  // estados restantes (11 menos el actual, S02), iguales para cualquier rol
  // -- Leo necesita poder saltar a cualquiera para reflejar la realidad. La
  // unica excepcion es "Cerrada" (S09, RN-201): esa la fija el solicitante,
  // no el gestor, salvo que el item sea una consulta tecnica -- por eso son
  // 9 (11 menos el actual, menos S09) y no 10.
  const opcionesAna = comoAnalista.transiciones_por_subsolicitud['SOL-2026-HP-0001-01'];
  const estadosAna = Array.from(opcionesAna).map((o) => o.estado).sort();
  assert.equal(estadosAna.length, 9);
  assert.ok(estadosAna.indexOf('S02') === -1, 'no debe ofrecer el estado actual como destino');
  assert.ok(estadosAna.indexOf('S09') === -1, 'no debe ofrecer Cerrada: la fija el solicitante (RN-201)');

  const opcionesDev = comoDev.transiciones_por_subsolicitud['SOL-2026-HP-0001-01'];
  const estadosDev = Array.from(opcionesDev).map((o) => o.estado).sort();
  assert.deepEqual(estadosDev, estadosAna);

  // S10 (Rechazar) y S11 (Cancelar) deben venir marcados como
  // comentario_obligatorio; S03 (siguiente paso normal) no.
  var s10 = opcionesAna.find((o) => o.estado === 'S10');
  var s03 = opcionesAna.find((o) => o.estado === 'S03');
  assert.equal(s10.comentario_obligatorio, true);
  assert.equal(s03.comentario_obligatorio, false);
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
  seedSheet(ctx, 'ARCHIVOS', ctx.COLUMNAS.ARCHIVOS);
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
