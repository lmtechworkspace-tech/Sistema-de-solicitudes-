'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function loadConSchema(options) {
  const ctx = loadBackofficeProject(Object.assign({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } }, options));
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'SUBSOLICITUDES', ctx.COLUMNAS.SUBSOLICITUDES);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Dev Uno', 'dev@homepymes.cl', 'HP', 'DEV', true, '', 'sistema'],
    ['U2', 'Admin Uno', 'admin@homepymes.cl', 'HP', 'ADM', true, '', 'sistema']
  ]);
  return ctx;
}

function seedSolicitudPendiente(ctx, overrides) {
  const base = Object.assign(
    {
      solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', plataforma: 'ERP', modulo: 'Facturacion',
      tipo: 'ERROR', es_cliente: false, empresa_cliente: '', contacto_cliente: '', correo_cliente: '',
      solicitante_nombre: 'Juan Perez', solicitante_email: 'juan@homepymes.cl',
      estado_derivado: 'S04', prioridad_derivada: 'P2', orden_atencion: '',
      doc_estado: 'PENDIENTE', doc_reintentos: 0, url_doc: '', url_pdf: '',
      version_documento: 0, url_pdf_historial: '',
      dedup_hash: 'x', estimacion_total_horas: 4, horas_reales: '', resumen_whatsapp: 'resumen',
      fecha_creacion: new Date().toISOString(), creado_por: 'juan@homepymes.cl'
    },
    overrides
  );
  const fila = ctx.COLUMNAS.SOLICITUDES.map((col) => base[col]);
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SOLICITUDES').appendRow(fila);

  const subFila = ctx.COLUMNAS.SUBSOLICITUDES.map((col) => ({
    subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001',
    titulo: 'Titulo', descripcion: 'Descripcion', impacto: '', urgencia_cliente: '',
    prioridad: 'P2', estado: 'S04', ref_credencial: '', sla_objetivo_horas: 24,
    fecha_creacion: new Date().toISOString()
  }[col]));
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SUBSOLICITUDES').appendRow(subFila);

  return base;
}

test('procesarColaDocumentos genera el Doc/PDF, marca LISTO y notifica al desarrollador', () => {
  const ctx = loadConSchema({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'root-1' } });
  seedSolicitudPendiente(ctx);

  const resultado = ctx.Documentos.procesarColaDocumentos();

  assert.equal(resultado.length, 1);
  assert.equal(resultado[0].resultado, 'LISTO');

  const solicitud = ctx.leerFilas_('SOLICITUDES')[0];
  assert.equal(solicitud.doc_estado, 'LISTO');
  assert.equal(Number(solicitud.version_documento), 1);
  assert.ok(solicitud.url_pdf.startsWith('https://drive.mock/'));
  assert.ok(solicitud.url_doc.startsWith('https://docs.mock/'));

  assert.equal(ctx.GmailApp._enviados.length, 1);
  assert.match(ctx.GmailApp._enviados[0].destinatario, /dev@homepymes\.cl/);
});

test('procesarColaDocumentos versiona el PDF y conserva la URL anterior en el historial', () => {
  const ctx = loadConSchema({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'root-1' } });
  seedSolicitudPendiente(ctx);

  ctx.Documentos.procesarColaDocumentos();
  const primeraUrl = ctx.leerFilas_('SOLICITUDES')[0].url_pdf;

  // Reaprobacion: se vuelve a marcar PENDIENTE (simula actualizarEstado -> S04).
  ctx.actualizarFilaPorId_('SOLICITUDES', 'solicitud_id', 'SOL-2026-HP-0001', { doc_estado: 'PENDIENTE' });
  ctx.Documentos.procesarColaDocumentos();

  const solicitud = ctx.leerFilas_('SOLICITUDES')[0];
  assert.equal(Number(solicitud.version_documento), 2);
  assert.notEqual(solicitud.url_pdf, primeraUrl);

  const historial = JSON.parse(solicitud.url_pdf_historial);
  assert.deepEqual(historial, [primeraUrl]);
});

test('procesarColaDocumentos marca ERROR y reintenta hasta 3 veces, luego alerta al Admin', () => {
  // Sin SIGSO_DRIVE_ROOT_FOLDER_ID, generarDocumento_ falla siempre (simula
  // un fallo real de generacion/permiso de Drive).
  const ctx = loadConSchema({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSolicitudPendiente(ctx);

  const r1 = ctx.Documentos.procesarColaDocumentos();
  assert.equal(r1[0].resultado, 'ERROR');
  assert.equal(ctx.leerFilas_('SOLICITUDES')[0].doc_reintentos, 1);
  assert.equal(ctx.GmailApp._enviados.length, 0, 'no se alerta al admin antes del 3er fallo');

  ctx.Documentos.procesarColaDocumentos();
  assert.equal(ctx.leerFilas_('SOLICITUDES')[0].doc_reintentos, 2);

  ctx.Documentos.procesarColaDocumentos();
  const solicitud = ctx.leerFilas_('SOLICITUDES')[0];
  assert.equal(solicitud.doc_reintentos, 3);
  assert.equal(solicitud.doc_estado, 'ERROR');
  assert.equal(ctx.GmailApp._enviados.length, 1, 'se alerta al admin justo en el 3er fallo');
  assert.match(ctx.GmailApp._enviados[0].destinatario, /admin@homepymes\.cl/);

  // Un 4to intento ya no debe procesar esta solicitud (tope de reintentos).
  const r4 = ctx.Documentos.procesarColaDocumentos();
  assert.equal(r4.length, 0);
});

test('procesarColaDocumentos ignora solicitudes sin doc_estado pendiente/error', () => {
  const ctx = loadConSchema({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'root-1' } });
  seedSolicitudPendiente(ctx, { doc_estado: 'LISTO' });

  const resultado = ctx.Documentos.procesarColaDocumentos();
  assert.equal(resultado.length, 0);
});
