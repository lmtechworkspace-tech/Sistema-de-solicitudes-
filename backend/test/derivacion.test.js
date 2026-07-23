'use strict';

/**
 * v3.1 (§2) — derivacion de solicitudes entre responsables.
 *
 * Lo que se cubre aqui es justamente lo que la reasignacion vieja NO tenia:
 * registro en HISTORIAL_ASIGNACION, motivo obligatorio, permisos por rol y
 * un lote que no pierde trazabilidad.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

const LEO = 'leo@rld.cl';
const LUIS = 'control_luis@rld.cl';
const ANALISTA = 'analista@homepymes.cl';

function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'SUBSOLICITUDES', ctx.COLUMNAS.SUBSOLICITUDES);
  seedSheet(ctx, 'HISTORIAL_ASIGNACION', ctx.COLUMNAS.HISTORIAL_ASIGNACION);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS);
  return ctx;
}

// Crea una solicitud con `cantidadItems` items, todos asignados a `responsable`.
function seedSolicitud(ctx, solicitudId, responsable, cantidadItems) {
  const hoja = ctx.SpreadsheetApp.openById('fake-sheet-id');
  const datos = {
    solicitud_id: solicitudId, empresa_id: 'HP', plataforma: 'ERP', modulo: 'Facturacion',
    tipo: 'ERR', titulo: 'Titulo de ' + solicitudId,
    solicitante_nombre: 'Juan', solicitante_email: 'juan@homepymes.cl',
    estado_derivado: 'S02', prioridad_derivada: 'P2',
    desarrollador_asignado: responsable, fecha_creacion: '2026-01-01T10:00:00.000Z'
  };
  hoja.getSheetByName('SOLICITUDES')
    .appendRow(ctx.COLUMNAS.SOLICITUDES.map((col) => (datos[col] !== undefined ? datos[col] : '')));

  for (let i = 1; i <= (cantidadItems || 1); i++) {
    const sub = {
      subsolicitud_id: solicitudId + '-0' + i, solicitud_id: solicitudId, numero_item: i,
      titulo: 'Item ' + i, descripcion: 'Desc', estado: 'S02', prioridad: 'P2',
      desarrollador_asignado: responsable, fecha_creacion: '2026-01-01T10:00:00.000Z'
    };
    hoja.getSheetByName('SUBSOLICITUDES')
      .appendRow(ctx.COLUMNAS.SUBSOLICITUDES.map((col) => (sub[col] !== undefined ? sub[col] : '')));
  }
}

function historial(ctx) {
  return ctx.leerFilas_('HISTORIAL_ASIGNACION');
}

test('derivar una solicitud completa mueve todos sus items y la cabecera', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, 'SOL-2026-HP-0001', LUIS, 2);

  const res = ctx.Solicitudes.derivarSolicitud(
    { solicitud_id: 'SOL-2026-HP-0001', responsable_nuevo: LEO, motivo: 'corresponde a Leo, fin de la fase de pruebas' },
    { email: ANALISTA, rol: 'ANA' }
  );

  assert.equal(res.total, 1);
  const items = ctx.leerFilas_('SUBSOLICITUDES');
  assert.equal(items.length, 2);
  items.forEach((item) => assert.equal(item.desarrollador_asignado, LEO));
  assert.equal(ctx.leerFilas_('SOLICITUDES')[0].desarrollador_asignado, LEO);
});

test('derivar deja registro en HISTORIAL_ASIGNACION con el anterior, el nuevo y el motivo', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, 'SOL-2026-HP-0001', LUIS, 1);

  ctx.Solicitudes.derivarSolicitud(
    { solicitud_id: 'SOL-2026-HP-0001', responsable_nuevo: LEO, motivo: 'corresponde a Leo, fin de la fase de pruebas' },
    { email: ANALISTA, rol: 'ANA' }
  );

  const filas = historial(ctx);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].solicitud_id, 'SOL-2026-HP-0001');
  assert.equal(filas[0].responsable_anterior, LUIS);
  assert.equal(filas[0].responsable_nuevo, LEO);
  assert.equal(filas[0].usuario, ANALISTA);
  assert.match(filas[0].motivo, /corresponde a Leo/);
  // Solicitud completa -> subsolicitud_id vacio (§2.3).
  assert.equal(filas[0].subsolicitud_id, '');
});

test('derivar un item puntual no toca a los hermanos ni la cabecera', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, 'SOL-2026-HP-0001', LUIS, 2);

  ctx.Solicitudes.derivarSolicitud(
    {
      solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
      responsable_nuevo: LEO, motivo: 'este item es de base de datos'
    },
    { email: ANALISTA, rol: 'ANA' }
  );

  const items = ctx.leerFilas_('SUBSOLICITUDES');
  assert.equal(items.find((s) => s.subsolicitud_id === 'SOL-2026-HP-0001-01').desarrollador_asignado, LEO);
  assert.equal(items.find((s) => s.subsolicitud_id === 'SOL-2026-HP-0001-02').desarrollador_asignado, LUIS);
  // La cabecera sigue reflejando al responsable por defecto del resto.
  assert.equal(ctx.leerFilas_('SOLICITUDES')[0].desarrollador_asignado, LUIS);
  assert.equal(historial(ctx)[0].subsolicitud_id, 'SOL-2026-HP-0001-01');
});

test('el motivo es obligatorio (minimo 10 caracteres)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, 'SOL-2026-HP-0001', LUIS, 1);

  const res = ctx.Solicitudes.derivarSolicitud(
    { solicitud_id: 'SOL-2026-HP-0001', responsable_nuevo: LEO, motivo: 'porque' },
    { email: ANALISTA, rol: 'ANA' }
  );

  assert.equal(res._validationError, true);
  assert.equal(historial(ctx).length, 0);
  // Y no alcanzo a mover nada.
  assert.equal(ctx.leerFilas_('SUBSOLICITUDES')[0].desarrollador_asignado, LUIS);
});

test('un DEV puede derivar lo suyo', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, 'SOL-2026-HP-0001', LUIS, 1);

  const res = ctx.Solicitudes.derivarSolicitud(
    { solicitud_id: 'SOL-2026-HP-0001', responsable_nuevo: LEO, motivo: 'me voy de vacaciones la proxima semana' },
    { email: LUIS, rol: 'DEV' }
  );

  assert.equal(res.total, 1);
  assert.equal(ctx.leerFilas_('SUBSOLICITUDES')[0].desarrollador_asignado, LEO);
});

test('un DEV NO puede derivar trabajo ajeno', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, 'SOL-2026-HP-0001', LEO, 1);

  const res = ctx.Solicitudes.derivarSolicitud(
    { solicitud_id: 'SOL-2026-HP-0001', responsable_nuevo: LUIS, motivo: 'me la quiero llevar a mi bandeja' },
    { email: LUIS, rol: 'DEV' }
  );

  assert.equal(res._forbidden, true);
  assert.equal(historial(ctx).length, 0);
  assert.equal(ctx.leerFilas_('SUBSOLICITUDES')[0].desarrollador_asignado, LEO);
});

test('Gerencia es de solo lectura: no puede derivar', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, 'SOL-2026-HP-0001', LUIS, 1);

  const res = ctx.Solicitudes.derivarSolicitud(
    { solicitud_id: 'SOL-2026-HP-0001', responsable_nuevo: LEO, motivo: 'deberia estar con Leo' },
    { email: 'gerencia@homepymes.cl', rol: 'GERENCIA' }
  );

  assert.equal(res._forbidden, true);
  assert.equal(historial(ctx).length, 0);
});

// §2.6: la migracion de control_luis -> Leo. Agrupar el aviso no es motivo
// para agrupar el registro: tiene que quedar una fila por solicitud.
test('la derivacion en lote escribe una fila de historial por solicitud', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, 'SOL-2026-HP-0001', LUIS, 1);
  seedSolicitud(ctx, 'SOL-2026-HP-0002', LUIS, 1);
  seedSolicitud(ctx, 'SOL-2026-HP-0003', LUIS, 1);

  const res = ctx.Solicitudes.derivarSolicitud(
    {
      solicitud_ids: ['SOL-2026-HP-0001', 'SOL-2026-HP-0002', 'SOL-2026-HP-0003'],
      responsable_nuevo: LEO, motivo: 'traspaso de la bandeja de pruebas a Leo'
    },
    { email: ANALISTA, rol: 'ANA' }
  );

  assert.equal(res.total, 3);
  assert.equal(historial(ctx).length, 3);
  ctx.leerFilas_('SUBSOLICITUDES').forEach((s) => assert.equal(s.desarrollador_asignado, LEO));
});

// Preferible a dejar media bandeja movida sin que nadie sepa cual mitad.
test('un id invalido aborta el lote completo sin dejar nada a medias', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, 'SOL-2026-HP-0001', LUIS, 1);

  const res = ctx.Solicitudes.derivarSolicitud(
    {
      solicitud_ids: ['SOL-2026-HP-0001', 'SOL-2026-HP-9999'],
      responsable_nuevo: LEO, motivo: 'traspaso de la bandeja de pruebas a Leo'
    },
    { email: ANALISTA, rol: 'ANA' }
  );

  assert.equal(res._validationError, true);
  assert.match(res.message, /SOL-2026-HP-9999/);
  // Nada escrito: ni la primera, que era valida. Se valida todo el lote antes
  // de tocar una sola fila.
  assert.equal(historial(ctx).length, 0);
  assert.equal(ctx.leerFilas_('SUBSOLICITUDES')[0].desarrollador_asignado, LUIS);
  assert.equal(ctx.leerFilas_('SOLICITUDES')[0].desarrollador_asignado, LUIS);
});

test('el lote es por solicitud completa, no acepta subsolicitud_id', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, 'SOL-2026-HP-0001', LUIS, 1);

  const res = ctx.Solicitudes.derivarSolicitud(
    {
      solicitud_ids: ['SOL-2026-HP-0001'], subsolicitud_id: 'SOL-2026-HP-0001-01',
      responsable_nuevo: LEO, motivo: 'traspaso de la bandeja de pruebas'
    },
    { email: ANALISTA, rol: 'ANA' }
  );

  assert.equal(res._validationError, true);
});

test('getDetalle expone historial_asignacion y los responsables disponibles', () => {
  const ctx = loadConSchema();
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS);
  seedSheet(ctx, 'HISTORIAL_PRIORIDAD', ctx.COLUMNAS.HISTORIAL_PRIORIDAD);
  seedSheet(ctx, 'HISTORIAL_COMPROMISO', ctx.COLUMNAS.HISTORIAL_COMPROMISO);
  seedSheet(ctx, 'COMENTARIOS', ctx.COLUMNAS.COMENTARIOS);
  seedSheet(ctx, 'ARCHIVOS', ctx.COLUMNAS.ARCHIVOS);
  seedSolicitud(ctx, 'SOL-2026-HP-0001', LUIS, 1);

  ctx.Solicitudes.derivarSolicitud(
    { solicitud_id: 'SOL-2026-HP-0001', responsable_nuevo: LEO, motivo: 'corresponde a Leo, fin de las pruebas' },
    { email: ANALISTA, rol: 'ANA' }
  );

  const detalle = ctx.Solicitudes.getDetalle('SOL-2026-HP-0001', { email: ANALISTA, rol: 'ANA' });
  assert.equal(detalle.historial_asignacion.length, 1);
  assert.equal(detalle.historial_asignacion[0].responsable_nuevo, LEO);
  assert.ok(Array.isArray(detalle.responsables));
});

// v5.2 (correos profesionales + OT adjunta): la derivacion manda correo HTML
// y, para una solicitud UNICA, adjunta el PDF de la Orden de Trabajo.
function loadConSchemaCompleto() {
  const ctx = loadConSchema();
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS);
  seedSheet(ctx, 'HISTORIAL_PRIORIDAD', ctx.COLUMNAS.HISTORIAL_PRIORIDAD);
  seedSheet(ctx, 'HISTORIAL_COMPROMISO', ctx.COLUMNAS.HISTORIAL_COMPROMISO);
  seedSheet(ctx, 'COMENTARIOS', ctx.COLUMNAS.COMENTARIOS);
  seedSheet(ctx, 'ARCHIVOS', ctx.COLUMNAS.ARCHIVOS);
  return ctx;
}

test('derivar UNA solicitud manda correo HTML al nuevo responsable con la OT adjunta', () => {
  const ctx = loadConSchemaCompleto();
  seedSolicitud(ctx, 'SOL-2026-HP-0001', LUIS, 1);

  ctx.Solicitudes.derivarSolicitud(
    { solicitud_id: 'SOL-2026-HP-0001', responsable_nuevo: LEO, motivo: 'corresponde a Leo, fin de las pruebas' },
    { email: ANALISTA, rol: 'ANA' }
  );

  const alNuevo = ctx.GmailApp._enviados.find((e) => e.destinatario === LEO);
  assert.ok(alNuevo, 'debe haber un correo al nuevo responsable');
  // Correo profesional: viaja el HTML branded.
  assert.ok(alNuevo.opciones.htmlBody, 'debe traer htmlBody');
  assert.match(alNuevo.opciones.htmlBody, /SIGSO/);
  // El texto plano sigue como fallback.
  assert.match(alNuevo.cuerpo, /Se ha derivado/);
  // La OT va adjunta (1 PDF).
  assert.ok(alNuevo.opciones.attachments && alNuevo.opciones.attachments.length === 1);
  assert.equal(alNuevo.opciones.attachments[0].getName(), 'OT-SOL-2026-HP-0001.pdf');
});

test('derivar en LOTE manda correo HTML sin adjuntos (adjuntar N PDFs no es viable)', () => {
  const ctx = loadConSchemaCompleto();
  seedSolicitud(ctx, 'SOL-2026-HP-0001', LUIS, 1);
  seedSolicitud(ctx, 'SOL-2026-HP-0002', LUIS, 1);

  ctx.Solicitudes.derivarSolicitud(
    { solicitud_ids: ['SOL-2026-HP-0001', 'SOL-2026-HP-0002'], responsable_nuevo: LEO, motivo: 'migracion masiva a Leo del equipo' },
    { email: ANALISTA, rol: 'ANA' }
  );

  const alNuevo = ctx.GmailApp._enviados.find((e) => e.destinatario === LEO);
  assert.ok(alNuevo, 'debe haber un correo al nuevo responsable');
  assert.ok(alNuevo.opciones.htmlBody, 'debe traer htmlBody');
  assert.ok(!alNuevo.opciones.attachments || alNuevo.opciones.attachments.length === 0, 'sin adjuntos en lote');
});
