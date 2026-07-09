'use strict';

// v2.1 (Fase D, documentacion/SIGSO-v2.1-plazos-y-control.md §8): avisos
// que armonizan con la cola de correo ya existente -- compromiso de fecha
// al solicitante, alerta "en riesgo" al desarrollador/gerencia, y
// recordatorio de validacion pendiente antes del cierre automatico.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'SUBSOLICITUDES', ctx.COLUMNAS.SUBSOLICITUDES);
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS);
  seedSheet(ctx, 'HISTORIAL_COMPROMISO', ctx.COLUMNAS.HISTORIAL_COMPROMISO);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'CONFIG_FERIADOS', ctx.COLUMNAS.CONFIG_FERIADOS);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Gerente Uno', 'gerencia@homepymes.cl', 'HP', 'GERENCIA', true, '', 'sistema']
  ]);
  return ctx;
}

function seedSolicitud(ctx, overrides) {
  const base = Object.assign(
    {
      solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', plataforma: 'ERP', modulo: 'Facturacion',
      tipo: 'ERR', es_cliente: false, solicitante_nombre: 'Juan Perez', solicitante_email: 'juan@homepymes.cl',
      estado_derivado: 'S05', prioridad_derivada: 'P2', dedup_hash: 'x',
      fecha_creacion: new Date().toISOString(), creado_por: 'juan@homepymes.cl'
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
      titulo: 'Titulo', descripcion: 'Desc', prioridad: 'P2', estado: 'S05',
      fecha_creacion: new Date().toISOString(),
      fecha_comprometida: '', fecha_terminada: '', comprometida_por: ''
    },
    overrides
  );
  const fila = ctx.COLUMNAS.SUBSOLICITUDES.map((col) => (base[col] !== undefined ? base[col] : ''));
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SUBSOLICITUDES').appendRow(fila);
  return base;
}

const DEV = { email: 'dev@homepymes.cl', rol: 'DEV' };

test('comprometerFecha (v2.1 Fase D): avisa al solicitante al comprometer una fecha', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx);

  ctx.Solicitudes.comprometerFecha(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', fecha_comprometida: '2026-08-05T18:00' },
    DEV
  );

  const avisos = ctx.leerFilas_('LOG_NOTIFICACIONES').filter((n) => n.evento.indexOf('COMPROMISO_FECHA:') === 0);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].destinatario, 'juan@homepymes.cl');
  assert.ok(ctx.GmailApp._enviados[0].cuerpo.indexOf('2026-08-05') !== -1);
});

test('comprometerFecha (v2.1 Fase D): un re-compromiso a otra fecha genera un aviso nuevo (no lo deduplica contra el anterior)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { fecha_comprometida: '2026-08-05T18:00' });

  ctx.Solicitudes.comprometerFecha(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', fecha_comprometida: '2026-08-10T18:00', motivo: 'El cliente amplio el alcance del item' },
    DEV
  );

  const avisos = ctx.leerFilas_('LOG_NOTIFICACIONES').filter((n) => n.evento.indexOf('COMPROMISO_FECHA:') === 0);
  assert.equal(avisos.length, 1);
  assert.ok(avisos[0].evento.indexOf('2026-08-10T18:00') !== -1);
});

test('Triggers.verificarFechasComprometidas (v2.1 Fase D): avisa cuando un item esta EN_RIESGO', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  // Muy cerca de su compromiso (menos de 1 dia habil) y aun no entregado.
  const ahora = new Date();
  const enUnaHora = new Date(ahora.getTime() + 60 * 60 * 1000).toISOString();
  seedSubsolicitud(ctx, { estado: 'S05', fecha_comprometida: enUnaHora });

  const resultado = ctx.Triggers.verificarFechasComprometidas();

  assert.equal(resultado.avisados, 1);
  const avisos = ctx.leerFilas_('LOG_NOTIFICACIONES').filter((n) => n.evento.indexOf('FECHA_EN_RIESGO:') === 0);
  assert.ok(avisos.length >= 1);
});

test('Triggers.verificarFechasComprometidas (v2.1 Fase D): NO avisa si esta en plazo o sin comprometer', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-01', fecha_comprometida: '' });
  seedSubsolicitud(ctx, {
    subsolicitud_id: 'SOL-2026-HP-0001-02', numero_item: 2,
    fecha_comprometida: '2026-12-31T18:00'
  });

  const resultado = ctx.Triggers.verificarFechasComprometidas();

  assert.equal(resultado.avisados, 0);
});

test('Triggers.recordarValidacionPendiente (v2.1 Fase D): recuerda al solicitante entre el umbral y el cierre automatico', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S08' });
  const hace3DiasHabiles = new Date();
  hace3DiasHabiles.setDate(hace3DiasHabiles.getDate() - 5); // suficiente margen habil
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS, [
    ['H1', 'SOL-2026-HP-0001', 'SOL-2026-HP-0001-01', 'S07', 'S08', 'dev@homepymes.cl', '', hace3DiasHabiles.toISOString()]
  ]);

  const resultado = ctx.Triggers.recordarValidacionPendiente();

  assert.equal(resultado.recordados, 1);
  const avisos = ctx.leerFilas_('LOG_NOTIFICACIONES').filter((n) => n.evento.indexOf('RECORDATORIO_VALIDACION:') === 0);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].destinatario, 'juan@homepymes.cl');
});

test('Triggers.recordarValidacionPendiente (v2.1 Fase D): NO recuerda si recien entro a Terminada (antes del umbral)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S08' });
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS, [
    ['H1', 'SOL-2026-HP-0001', 'SOL-2026-HP-0001-01', 'S07', 'S08', 'dev@homepymes.cl', '', new Date().toISOString()]
  ]);

  const resultado = ctx.Triggers.recordarValidacionPendiente();

  assert.equal(resultado.recordados, 0);
});
