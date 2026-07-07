'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'SUBSOLICITUDES', ctx.COLUMNAS.SUBSOLICITUDES);
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS);
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
      urgencia_cliente: '',
      prioridad: 'P2',
      estado: 'S01',
      ref_credencial: '',
      sla_objetivo_horas: 24,
      fecha_creacion: new Date().toISOString()
    },
    overrides
  );
  const fila = ctx.COLUMNAS.SUBSOLICITUDES.map((col) => base[col]);
  const ss = ctx.SpreadsheetApp.openById('fake-sheet-id');
  ss.getSheetByName('SUBSOLICITUDES').appendRow(fila);
  return base;
}

function seedSolicitud(ctx, overrides) {
  const base = Object.assign(
    {
      solicitud_id: 'SOL-2026-HP-0001',
      empresa_id: 'HP',
      plataforma: 'ERP',
      modulo: 'Facturacion',
      tipo: 'ERROR',
      es_cliente: false,
      empresa_cliente: '',
      contacto_cliente: '',
      correo_cliente: '',
      solicitante_nombre: 'Juan Perez',
      solicitante_email: 'juan@homepymes.cl',
      estado_derivado: 'S01',
      prioridad_derivada: 'P2',
      orden_atencion: '',
      doc_estado: '',
      url_doc: '',
      url_pdf: '',
      dedup_hash: 'x',
      estimacion_total_horas: 4,
      horas_reales: '',
      resumen_whatsapp: '',
      fecha_creacion: new Date().toISOString(),
      creado_por: 'juan@homepymes.cl'
    },
    overrides
  );
  const fila = ctx.COLUMNAS.SOLICITUDES.map((col) => base[col]);
  const ss = ctx.SpreadsheetApp.openById('fake-sheet-id');
  ss.getSheetByName('SOLICITUDES').appendRow(fila);
  return base;
}

test('actualizarEstado aplica una transicion valida y registra HISTORIAL_ESTADOS', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S01' });

  const resultado = ctx.Solicitudes.actualizarEstado(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S02' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );

  assert.equal(resultado.estado_anterior, 'S01');
  assert.equal(resultado.estado_nuevo, 'S02');
  assert.equal(resultado.estado_derivado_padre, 'S02');

  const historial = ctx.leerFilas_('HISTORIAL_ESTADOS');
  assert.equal(historial.length, 1);
  assert.equal(historial[0].usuario, 'analista@homepymes.cl');
});

test('actualizarEstado rechaza una transicion no permitida por la tabla de estados', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S01' });

  const resultado = ctx.Solicitudes.actualizarEstado(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S09' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );

  assert.equal(resultado._validationError, true);
});

test('actualizarEstado (Fase 10.1, "Leo hace todo"): cualquier rol de Backoffice puede aplicar transiciones de trabajo normal', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S04' });

  // Antes S04 -> S05 era exclusivo de DEV; ahora cualquier rol registrado
  // (ANA/DEV/ADM) puede aplicarla -- el permiso es "esta activo en
  // USUARIOS", no "tiene el rol exacto de ese paso".
  const resultado = ctx.Solicitudes.actualizarEstado(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S05' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );

  assert.equal(resultado.estado_nuevo, 'S05');
});

test('actualizarEstado exige comentario obligatorio al pasar a "esperando informacion" (S06)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S03' });

  // El comentario ES la pregunta que el solicitante vera en Consultar Estado.
  const sinComentario = ctx.Solicitudes.actualizarEstado(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S06' },
    { email: 'dev@homepymes.cl', rol: 'DEV' }
  );
  assert.equal(sinComentario._validationError, true);

  const conComentario = ctx.Solicitudes.actualizarEstado(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S06', comentario: '¿Cual es el numero de factura afectado?' },
    { email: 'dev@homepymes.cl', rol: 'DEV' }
  );
  assert.equal(conComentario.estado_nuevo, 'S06');
});

test('actualizarEstado exige comentario cuando la transicion lo requiere (rechazo con motivo)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S03' });

  const sinComentario = ctx.Solicitudes.actualizarEstado(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S10' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(sinComentario._validationError, true);

  const conComentario = ctx.Solicitudes.actualizarEstado(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S10', comentario: 'No es un bug, es comportamiento esperado' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(conComentario.estado_nuevo, 'S10');
});

test('actualizarEstado aplica RN-015: no pasa a S04 si alguna subsolicitud hermana no tiene titulo/descripcion', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-01', estado: 'S03' });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-02', estado: 'S03', titulo: '', descripcion: '' });

  const resultado = ctx.Solicitudes.actualizarEstado(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S04' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );

  assert.equal(resultado._validationError, true);
});

test('estado_derivado del padre es el minimo entre subsolicitudes activas (§8.2)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-01', estado: 'S05' });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-02', estado: 'S07' });

  ctx.recalcularEstadoDerivado_('SOL-2026-HP-0001');
  const solicitudes = ctx.leerFilas_('SOLICITUDES');
  assert.equal(solicitudes[0].estado_derivado, 'S05');
});

test('estado_derivado ignora subsolicitudes rechazadas/canceladas (§8.2)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-01', estado: 'S08' });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-02', estado: 'S10' });

  ctx.recalcularEstadoDerivado_('SOL-2026-HP-0001');
  const solicitudes = ctx.leerFilas_('SOLICITUDES');
  assert.equal(solicitudes[0].estado_derivado, 'S08');
});

test('estado_derivado pasa a S09 solo si TODAS las hijas no rechazadas estan en S09', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-01', estado: 'S09' });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-02', estado: 'S11' });

  ctx.recalcularEstadoDerivado_('SOL-2026-HP-0001');
  const solicitudes = ctx.leerFilas_('SOLICITUDES');
  assert.equal(solicitudes[0].estado_derivado, 'S09');
});

test('estado_derivado pasa a S10 si todas las hijas estan rechazadas/canceladas con al menos una S10', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-01', estado: 'S10' });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-02', estado: 'S11' });

  ctx.recalcularEstadoDerivado_('SOL-2026-HP-0001');
  const solicitudes = ctx.leerFilas_('SOLICITUDES');
  assert.equal(solicitudes[0].estado_derivado, 'S10');
});

test('consulta tecnica (RF-F08): S02 puede cerrarse directo a S09 con comentario', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { tipo: 'CONSULTA' });
  seedSubsolicitud(ctx, { estado: 'S02' });

  const resultado = ctx.Solicitudes.actualizarEstado(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S09', comentario: 'Respuesta: se explico el uso del modulo.' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );

  assert.equal(resultado.estado_nuevo, 'S09');
});

test('S09 solo lo reabre Admin y exige justificacion (RN-012/013)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S09' });

  const comoAnalista = ctx.Solicitudes.actualizarEstado(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S05', comentario: 'motivo valido con mas de veinte caracteres' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(comoAnalista._forbidden, true);

  const comoAdminSinComentario = ctx.Solicitudes.actualizarEstado(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S05' },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );
  assert.equal(comoAdminSinComentario._validationError, true);

  const comoAdmin = ctx.Solicitudes.actualizarEstado(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S05', comentario: 'Se detecto que el problema persiste' },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );
  assert.equal(comoAdmin.estado_nuevo, 'S05');
});
