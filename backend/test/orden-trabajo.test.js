'use strict';

/**
 * v5.2 (mejora OT): la Orden de Trabajo se genera en el servidor como PDF,
 * con las imagenes embebidas (base64, leidas de Drive) y las URLs como
 * enlaces reales -- lo que el print del navegador no lograba.
 *
 * El mock no hace la conversion real HTML->PDF (eso solo se ve tras
 * desplegar); estos tests verifican la LOGICA: que el HTML trae los datos
 * correctos, que las URLs quedan como <a>, que la imagen se pide a Drive y se
 * embebe en base64, y que descargar() devuelve el base64.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

const ADMIN = { rol: 'ADM', email: 'admin@homepymes.cl' };

function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'SUBSOLICITUDES', ctx.COLUMNAS.SUBSOLICITUDES);
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS);
  seedSheet(ctx, 'HISTORIAL_PRIORIDAD', ctx.COLUMNAS.HISTORIAL_PRIORIDAD);
  seedSheet(ctx, 'HISTORIAL_COMPROMISO', ctx.COLUMNAS.HISTORIAL_COMPROMISO);
  seedSheet(ctx, 'COMENTARIOS', ctx.COLUMNAS.COMENTARIOS);
  seedSheet(ctx, 'ARCHIVOS', ctx.COLUMNAS.ARCHIVOS);
  return ctx;
}

function seedSolicitud(ctx, subOverrides) {
  const sol = {
    solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', empresa_nombre: 'HomePymes',
    plataforma: 'ERP', modulo: 'Facturacion', tipo: 'ERR',
    solicitante_nombre: 'Juan Perez', solicitante_email: 'juan@homepymes.cl',
    estado_derivado: 'S05', prioridad_derivada: 'P1', fecha_creacion: new Date().toISOString()
  };
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SOLICITUDES')
    .appendRow(ctx.COLUMNAS.SOLICITUDES.map((c) => (sol[c] !== undefined ? sol[c] : '')));

  const sub = Object.assign({
    subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001', numero_item: 1,
    titulo: 'Corregir el calculo del IVA', descripcion: 'El total sale mal',
    resultado_esperado: 'Que sume bien', prioridad: 'P1', estado: 'S05',
    url_modulo: 'https://erp.gde.cl/facturacion', usuario_prueba: 'demo', ref_credencial: 'ver 1Password',
    fecha_creacion: new Date().toISOString()
  }, subOverrides || {});
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SUBSOLICITUDES')
    .appendRow(ctx.COLUMNAS.SUBSOLICITUDES.map((c) => (sub[c] !== undefined ? sub[c] : '')));
}

// Crea un archivo real en el mock de Drive y devuelve su url (para sembrar la
// fila de ARCHIVOS). Asi el generador de OT puede extraer el id de la url y
// leer el blob de vuelta con getFileById.
function seedImagen(ctx, subsolicitudId, bytesTexto) {
  const blob = ctx.Utilities.newBlob(bytesTexto || 'PNGDATA', 'image/png', 'captura.png');
  const archivo = ctx.DriveApp.getRootFolder().createFile(blob);
  const fila = {
    archivo_id: 'ARCH-1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: subsolicitudId,
    nombre_original: 'captura.png', url: archivo.getUrl(), tipo_mime: 'image/png',
    tamano_bytes: 8, fecha_subida: new Date().toISOString()
  };
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('ARCHIVOS')
    .appendRow(ctx.COLUMNAS.ARCHIVOS.map((c) => (fila[c] !== undefined ? fila[c] : '')));
}

test('OrdenTrabajo.descargar devuelve el PDF en base64 y el nombre del archivo', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);

  const res = ctx.OrdenTrabajo.descargar({ solicitud_id: 'SOL-2026-HP-0001' }, ADMIN);

  assert.ok(!res._validationError, JSON.stringify(res));
  assert.ok(res.pdf_base64 && res.pdf_base64.length > 0);
  assert.equal(res.filename, 'OT-SOL-2026-HP-0001.pdf');
  // exige el solicitud_id
  assert.equal(ctx.OrdenTrabajo.descargar({}, ADMIN)._validationError, true);
});

test('El HTML de la OT trae el ID, los datos del item y la URL como enlace <a> real', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);

  const html = ctx.OrdenTrabajo.generar('SOL-2026-HP-0001', ADMIN)._html;

  assert.match(html, /SOL-2026-HP-0001/);
  assert.match(html, /Corregir el calculo del IVA/);
  assert.match(html, /Que sume bien/); // resultado esperado
  assert.match(html, /demo/); // usuario de prueba
  // La URL va como enlace clicable, no como texto plano.
  assert.match(html, /<a href="https:\/\/erp\.gde\.cl\/facturacion"/);
  // Prioridad con color (badge).
  assert.match(html, /P1/);
});

test('La imagen del item se lee de Drive y se embebe como data URI base64', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedImagen(ctx, 'SOL-2026-HP-0001-01');

  const html = ctx.OrdenTrabajo.generar('SOL-2026-HP-0001', ADMIN)._html;

  assert.match(html, /<img src="data:image\/png;base64,/);
});

test('Si la imagen no se puede leer de Drive, la OT se genera igual (sin esa captura)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  // Fila de ARCHIVOS con una url cuyo id no existe en Drive -> getBlob falla.
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('ARCHIVOS').appendRow(
    ctx.COLUMNAS.ARCHIVOS.map((c) => ({
      archivo_id: 'ARCH-X', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
      nombre_original: 'rota.png', url: 'https://drive.google.com/file/d/no-existe/view',
      tipo_mime: 'image/png', tamano_bytes: 1, fecha_subida: new Date().toISOString()
    }[c] || ''))
  );

  const res = ctx.OrdenTrabajo.descargar({ solicitud_id: 'SOL-2026-HP-0001' }, ADMIN);
  assert.ok(res.pdf_base64 && res.pdf_base64.length > 0);
});

test('extraerIdDrive_ saca el id del formato real (/d/<id>/view) y del respaldo (ultimo segmento)', () => {
  const ctx = loadConSchema();
  assert.equal(ctx.extraerIdDrive_('https://drive.google.com/file/d/ABC123xyz/view?usp=drivesdk'), 'ABC123xyz');
  assert.equal(ctx.extraerIdDrive_('https://drive.mock/file/drive-7'), 'drive-7');
  assert.equal(ctx.extraerIdDrive_(''), '');
});
