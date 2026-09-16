'use strict';

/**
 * Prueba de portabilidad: los escenarios de
 * "Notificaciones.enviarDigestJefatura" de backend/test/jefatura.test.js,
 * corridos contra notificaciones.js (ahora que el envio real por Resend ya
 * esta conectado -- antes este digest quedaba fuera de
 * jefatura-panel-porteo.test.js precisamente por depender de eso).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Notificaciones = require('../logica/notificaciones');
const Resend = require('../logica/resend');

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  sembrarTabla_(db, 'USUARIOS', COLUMNAS.USUARIOS, [
    ['U1', 'Vanessa Reyes', 'vanessa@rld.cl', 'RLD', 'DEV', true, '', 'sistema'],
    ['U3', 'Lisseth Jefa', 'lisseth@rld.cl', 'RLD', 'JEFATURA', true, '', 'sistema']
  ]);
  return db;
}

function seedJefatura(db, overrides) {
  const base = Object.assign(
    { jefatura_id: 'JEF-' + Math.random().toString(36).slice(2), jefe_email: 'lisseth@rld.cl', subordinado_email: 'vanessa@rld.cl', activo: true },
    overrides
  );
  agregarFila_(db, 'JEFATURAS', base);
  return base;
}

function seedSolicitud(db, overrides, subestados) {
  const base = Object.assign(
    {
      solicitud_id: 'SOL-2026-RLD-0001', empresa_id: 'RLD', plataforma: 'GDE', plataforma_nombre: 'GDE',
      modulo: 'LIQ', modulo_nombre: 'Liquidaciones', tipo: 'ERR', tipo_nombre: 'Error / Bug',
      solicitante_nombre: 'Vanessa Reyes', solicitante_cargo: 'Analista', solicitante_email: 'vanessa@rld.cl',
      es_cliente: false, estado_derivado: 'S02', prioridad_derivada: 'P2', dedup_hash: 'x',
      fecha_creacion: new Date().toISOString(), creado_por: 'vanessa@rld.cl',
      desarrollador_asignado: '', atencion_directa: false
    },
    overrides
  );
  agregarFila_(db, 'SOLICITUDES', base);
  (subestados || ['S02']).forEach((estado, idx) => {
    agregarFila_(db, 'SUBSOLICITUDES', {
      subsolicitud_id: base.solicitud_id + '-0' + (idx + 1), solicitud_id: base.solicitud_id, numero_item: idx + 1,
      titulo: 'Item', descripcion: 'Descripcion', prioridad: base.prioridad_derivada, estado: estado,
      sla_objetivo_horas: 24, fecha_creacion: base.fecha_creacion, desarrollador_asignado: base.desarrollador_asignado,
      tipo: base.tipo, tipo_nombre: base.tipo_nombre, modulo: base.modulo, modulo_nombre: base.modulo_nombre
    });
  });
  return base;
}

function conApiKey(t) {
  process.env.RESEND_API_KEY = 're_test_key';
  t.after(() => { delete process.env.RESEND_API_KEY; });
}

function mockEnvioOk(t) {
  return t.mock.method(Resend, 'enviarCorreoResend_', async () => ({ id: 'fake-resend-id' }));
}

test('enviarDigestJefatura manda un correo por jefe con novedades hoy', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();
  seedJefatura(db, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl', fecha_creacion: new Date().toISOString() });

  const resultados = await Notificaciones.enviarDigestJefatura(db);

  assert.equal(resultados[0].enviado, true);
  assert.equal(mock.mock.callCount(), 1);
  assert.equal(mock.mock.calls[0].arguments[0].to[0], 'lisseth@rld.cl');
  assert.ok(mock.mock.calls[0].arguments[0].text.indexOf('SOL-2026-RLD-0001') !== -1);
});

test('enviarDigestJefatura NO manda correo si el jefe no tuvo ninguna novedad hoy', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();
  seedJefatura(db, { subordinado_email: 'vanessa@rld.cl' });
  // Solicitud vieja, sin transiciones ni riesgos hoy.
  seedSolicitud(db, {
    solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl',
    fecha_creacion: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(), estado_derivado: 'S02'
  }, ['S02']);

  const resultados = await Notificaciones.enviarDigestJefatura(db);

  assert.equal(resultados[0].enviado, false);
  assert.equal(resultados[0].motivo, 'sin_novedades');
  assert.equal(mock.mock.callCount(), 0);
});

test('enviarDigestJefatura no manda nada si no hay jefaturas activas', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();

  const resultados = await Notificaciones.enviarDigestJefatura(db);

  assert.deepEqual(resultados, []);
  assert.equal(mock.mock.callCount(), 0);
});

test('enviarDigestJefatura no manda un segundo correo el mismo dia (dedup diario, no solo 30 min)', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();
  seedJefatura(db, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl', fecha_creacion: new Date().toISOString() });

  const primero = await Notificaciones.enviarDigestJefatura(db);
  const segundo = await Notificaciones.enviarDigestJefatura(db);

  assert.equal(primero[0].enviado, true);
  assert.equal(segundo[0].enviado, false);
  assert.equal(segundo[0].motivo, 'deduplicado');
  assert.equal(mock.mock.callCount(), 1, 'no debe reenviar el digest el mismo dia');
});

test('enviarDigestJefatura ignora una relacion JEFATURAS inactiva', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();
  seedJefatura(db, { subordinado_email: 'vanessa@rld.cl', activo: false });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl', fecha_creacion: new Date().toISOString() });

  const resultados = await Notificaciones.enviarDigestJefatura(db);

  assert.deepEqual(resultados, []);
  assert.equal(mock.mock.callCount(), 0);
});
