'use strict';

// v2.1 (Fase A, documentacion/SIGSO-v2.1-plazos-y-control.md): "dos
// promesas, dos relojes". Estos tests cubren lo que crearSolicitud (Intake,
// ver backend/test/solicitudes.test.js) no puede: la parte que solo existe
// en Backoffice -- comprometerFecha (el desarrollador fija/ajusta la fecha
// comprometida por item, con motivo obligatorio al re-comprometer) y el
// sellado automatico de fecha_terminada al entrar/salir de "Terminada" (S08),
// que es lo que detiene/reanuda el reloj del desarrollador.

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
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS);
  return ctx;
}

function seedSubsolicitud(ctx, overrides) {
  const base = Object.assign(
    {
      subsolicitud_id: 'SOL-2026-HP-0001-01',
      solicitud_id: 'SOL-2026-HP-0001',
      titulo: 'Titulo',
      descripcion: 'Descripcion',
      impacto: 'DEGRADACION_IMPORTANTE',
      prioridad: 'P2',
      estado: 'S03',
      sla_objetivo_horas: 24,
      fecha_creacion: new Date().toISOString(),
      fecha_propuesta: '2026-08-01T18:00',
      fecha_comprometida: '',
      fecha_terminada: '',
      comprometida_por: ''
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

const DEV = { email: 'dev@homepymes.cl', rol: 'DEV' };
const GERENCIA = { email: 'gerencia@homepymes.cl', rol: 'GERENCIA' };

test('comprometerFecha (v2.1): el desarrollador fija la fecha comprometida por primera vez, sin exigir motivo', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx);

  const resultado = ctx.Solicitudes.comprometerFecha(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', fecha_comprometida: '2026-08-05T18:00' },
    DEV
  );

  assert.equal(resultado.fecha_comprometida, '2026-08-05T18:00');
  assert.equal(resultado.re_compromiso, false);
  assert.equal(resultado.comprometida_por, 'dev@homepymes.cl');

  const subsolicitud = ctx.leerFilas_('SUBSOLICITUDES')[0];
  assert.equal(subsolicitud.fecha_comprometida, '2026-08-05T18:00');
  assert.equal(subsolicitud.comprometida_por, 'dev@homepymes.cl');
  // Primer compromiso: no hay "resbalon" que registrar (§5 de la spec).
  assert.equal(ctx.leerFilas_('HISTORIAL_COMPROMISO').length, 0);
});

test('comprometerFecha (v2.1): re-comprometer exige motivo (>=20 caracteres) y queda en HISTORIAL_COMPROMISO', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { fecha_comprometida: '2026-08-05T18:00', comprometida_por: 'dev@homepymes.cl' });

  const sinMotivo = ctx.Solicitudes.comprometerFecha(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', fecha_comprometida: '2026-08-10T18:00' },
    DEV
  );
  assert.equal(sinMotivo._validationError, true);
  assert.ok(sinMotivo.fields.some((f) => f.campo === 'motivo'));

  const resultado = ctx.Solicitudes.comprometerFecha(
    {
      subsolicitud_id: 'SOL-2026-HP-0001-01',
      fecha_comprometida: '2026-08-10T18:00',
      motivo: 'El cliente amplio el alcance del item'
    },
    DEV
  );
  assert.equal(resultado.re_compromiso, true);

  const historial = ctx.leerFilas_('HISTORIAL_COMPROMISO');
  assert.equal(historial.length, 1);
  assert.equal(historial[0].fecha_anterior, '2026-08-05T18:00');
  assert.equal(historial[0].fecha_nueva, '2026-08-10T18:00');
  assert.equal(historial[0].motivo, 'El cliente amplio el alcance del item');
  assert.equal(historial[0].usuario, 'dev@homepymes.cl');
});

test('comprometerFecha (v2.1): Gerencia es de solo lectura, no puede comprometer fechas', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx);

  const resultado = ctx.Solicitudes.comprometerFecha(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', fecha_comprometida: '2026-08-05T18:00' },
    GERENCIA
  );

  assert.equal(resultado._forbidden, true);
  assert.equal(ctx.leerFilas_('SUBSOLICITUDES')[0].fecha_comprometida, '');
});

test('comprometerFecha (v2.1): rechaza una fecha invalida o un item inexistente', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx);

  const fechaInvalida = ctx.Solicitudes.comprometerFecha(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', fecha_comprometida: 'no-es-una-fecha' },
    DEV
  );
  assert.equal(fechaInvalida._validationError, true);

  const itemInexistente = ctx.Solicitudes.comprometerFecha(
    { subsolicitud_id: 'NO-EXISTE', fecha_comprometida: '2026-08-05T18:00' },
    DEV
  );
  assert.equal(itemInexistente._validationError, true);
});

test('actualizarEstado (v2.1): marcar Terminada (S08) sella fecha_terminada -- detiene el reloj del desarrollador', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S07', fecha_comprometida: '2026-08-05T18:00' });

  ctx.Solicitudes.actualizarEstado({ subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S08' }, DEV);

  const subsolicitud = ctx.leerFilas_('SUBSOLICITUDES')[0];
  assert.equal(subsolicitud.estado, 'S08');
  assert.ok(subsolicitud.fecha_terminada);
});

test('actualizarEstado (v2.1): reabrir un item que estaba Terminada limpia fecha_terminada -- reanuda el reloj', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, {
    estado: 'S08',
    fecha_comprometida: '2026-08-05T18:00',
    fecha_terminada: '2026-08-04T12:00:00.000Z'
  });

  ctx.Solicitudes.actualizarEstado(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S05', comentario: 'Faltaba un caso de prueba' },
    DEV
  );

  const subsolicitud = ctx.leerFilas_('SUBSOLICITUDES')[0];
  assert.equal(subsolicitud.estado, 'S05');
  assert.equal(subsolicitud.fecha_terminada, '');
});

test('actualizarEstado (v2.1): transiciones que no tocan S08 no modifican fecha_terminada', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S03', fecha_terminada: '' });

  ctx.Solicitudes.actualizarEstado({ subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S04' }, DEV);

  assert.equal(ctx.leerFilas_('SUBSOLICITUDES')[0].fecha_terminada, '');
});
