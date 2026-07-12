'use strict';

// v3.0 (Fase 3, documentacion/SIGSO-v3.0-multi-responsable-y-control.md §4):
// "Mis solicitudes" -- el solicitante pide un codigo de un solo uso a su
// correo (CacheService, sin hoja nueva), lo verifica, y ve la lista COMPLETA
// de sus solicitudes (no una a la vez como el flujo viejo de numero+correo),
// con resumen y el semaforo del solicitante (dias sin validar un Terminada).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadIntakeProject, seedSheet } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadIntakeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'SUBSOLICITUDES', ctx.COLUMNAS.SUBSOLICITUDES);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  return ctx;
}

function seedSolicitud(ctx, overrides) {
  const base = Object.assign(
    {
      solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', empresa_nombre: 'HomePymes',
      plataforma: 'ERP', modulo: 'Facturacion', tipo: 'ERR', es_cliente: false, correo_cliente: '',
      solicitante_nombre: 'Juan', solicitante_cargo: 'Analista', solicitante_email: 'juan@homepymes.cl',
      estado_derivado: 'S05', prioridad_derivada: 'P2', dedup_hash: 'x',
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
      titulo: 't', descripcion: 'd', prioridad: 'P2', estado: 'S05',
      sla_objetivo_horas: 24, fecha_creacion: new Date().toISOString()
    },
    overrides
  );
  const fila = ctx.COLUMNAS.SUBSOLICITUDES.map((col) => (base[col] !== undefined ? base[col] : ''));
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SUBSOLICITUDES').appendRow(fila);
  return base;
}

function ultimoCodigoEnviado(ctx) {
  const filas = ctx.leerFilas_('LOG_NOTIFICACIONES').filter((n) => n.evento.indexOf('CODIGO_ACCESO:') === 0);
  const ultimo = filas[filas.length - 1];
  return ultimo.evento.split(':')[1];
}

test('solicitarCodigoAcceso: siempre responde ok y encola el envio del correo', () => {
  const ctx = loadConSchema();
  const resultado = ctx.Solicitudes.solicitarCodigoAcceso({ email: 'juan@homepymes.cl' });

  assert.equal(resultado.ok, true);
  assert.equal(ctx.leerFilas_('LOG_NOTIFICACIONES').filter((n) => n.evento.indexOf('CODIGO_ACCESO:') === 0).length, 1);
});

test('solicitarCodigoAcceso: responde ok igual aunque el correo no tenga solicitudes (no revela nada)', () => {
  const ctx = loadConSchema();
  const resultado = ctx.Solicitudes.solicitarCodigoAcceso({ email: 'nadie@homepymes.cl' });
  assert.equal(resultado.ok, true);
});

test('misSolicitudes: con el codigo correcto, devuelve la lista completa del correo', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001' });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001' });
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0002', estado_derivado: 'S09' });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0002-01', solicitud_id: 'SOL-2026-HP-0002', estado: 'S09' });

  ctx.Solicitudes.solicitarCodigoAcceso({ email: 'juan@homepymes.cl' });
  const codigo = ultimoCodigoEnviado(ctx);

  const resultado = ctx.Solicitudes.misSolicitudes({ email: 'juan@homepymes.cl', codigo: codigo });

  assert.equal(resultado.resumen.total, 2);
  assert.equal(resultado.resumen.abiertas, 1);
  assert.equal(resultado.solicitudes.length, 2);
  const ids = resultado.solicitudes.map((s) => s.solicitud_id).sort();
  assert.deepEqual(ids, ['SOL-2026-HP-0001', 'SOL-2026-HP-0002']);
});

test('misSolicitudes: rechaza un codigo incorrecto', () => {
  const ctx = loadConSchema();
  ctx.Solicitudes.solicitarCodigoAcceso({ email: 'juan@homepymes.cl' });

  const resultado = ctx.Solicitudes.misSolicitudes({ email: 'juan@homepymes.cl', codigo: '000000' });

  assert.equal(resultado._forbidden, true);
});

test('misSolicitudes: el codigo es de un solo uso (no sirve dos veces)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx);
  ctx.Solicitudes.solicitarCodigoAcceso({ email: 'juan@homepymes.cl' });
  const codigo = ultimoCodigoEnviado(ctx);

  const primero = ctx.Solicitudes.misSolicitudes({ email: 'juan@homepymes.cl', codigo: codigo });
  const segundo = ctx.Solicitudes.misSolicitudes({ email: 'juan@homepymes.cl', codigo: codigo });

  assert.equal(primero.resumen.total, 1);
  assert.equal(segundo._forbidden, true);
});

test('misSolicitudes: incluye tambien las solicitudes donde el correo es el cliente (es_cliente)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-HP-0003', solicitante_email: 'otra@rld.cl',
    es_cliente: true, correo_cliente: 'cliente@empresa.cl'
  });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0003-01', solicitud_id: 'SOL-2026-HP-0003' });

  ctx.Solicitudes.solicitarCodigoAcceso({ email: 'cliente@empresa.cl' });
  const codigo = ultimoCodigoEnviado(ctx);
  const resultado = ctx.Solicitudes.misSolicitudes({ email: 'cliente@empresa.cl', codigo: codigo });

  assert.equal(resultado.resumen.total, 1);
  assert.equal(resultado.solicitudes[0].solicitud_id, 'SOL-2026-HP-0003');
});

test('misSolicitudes: semaforo del solicitante -- item Terminada sin validar muestra dias_esperando_max', () => {
  const ctx = loadConSchema();
  var haceTresDiasHabiles = new Date();
  haceTresDiasHabiles.setDate(haceTresDiasHabiles.getDate() - 5); // margen amplio, cruza fin de semana
  seedSolicitud(ctx, { estado_derivado: 'S08' });
  seedSubsolicitud(ctx, {
    estado: 'S08', fecha_comprometida: haceTresDiasHabiles.toISOString(),
    fecha_terminada: haceTresDiasHabiles.toISOString()
  });

  ctx.Solicitudes.solicitarCodigoAcceso({ email: 'juan@homepymes.cl' });
  const codigo = ultimoCodigoEnviado(ctx);
  const resultado = ctx.Solicitudes.misSolicitudes({ email: 'juan@homepymes.cl', codigo: codigo });

  assert.equal(resultado.solicitudes[0].items_pendientes_validar, 1);
  assert.ok(resultado.solicitudes[0].dias_esperando_max > 0);
});

test('estadoPublico (v3.0): cada subsolicitud incluye cumplimiento (semaforo del solicitante)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S05' });

  const resultado = ctx.Solicitudes.estadoPublico('SOL-2026-HP-0001', 'juan@homepymes.cl');

  assert.ok(resultado.subsolicitudes[0].cumplimiento);
  assert.equal(typeof resultado.subsolicitudes[0].cumplimiento.codigo, 'string');
});

test('doPost action=solicitarCodigoAcceso y misSolicitudes responden ok:true de punta a punta', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx);

  const respPedido = ctx.doPost({
    postData: { contents: JSON.stringify({ action: 'solicitarCodigoAcceso', data: { email: 'juan@homepymes.cl' } }) }
  });
  assert.equal(JSON.parse(respPedido.getContent()).ok, true);

  const codigo = ultimoCodigoEnviado(ctx);
  const respLista = ctx.doPost({
    postData: { contents: JSON.stringify({ action: 'misSolicitudes', data: { email: 'juan@homepymes.cl', codigo: codigo } }) }
  });
  const parsed = JSON.parse(respLista.getContent());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.solicitudes.length, 1);
});
