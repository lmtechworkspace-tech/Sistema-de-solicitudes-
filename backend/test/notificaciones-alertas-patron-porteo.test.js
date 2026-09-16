'use strict';

/**
 * Prueba de portabilidad: los escenarios de "Triggers.detectarPatrones"
 * de backend/test/triggers.test.js (P7, v2.0 Sprint 3), corridos contra
 * notificaciones.js + Dashboard.calcularAlertasPatron_ (ya portado, ahora
 * exportado y reusado -- nunca duplicado).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Notificaciones = require('../logica/notificaciones');
const Resend = require('../logica/resend');

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  agregarFila_(db, 'USUARIOS', {
    usuario_id: 'U1', nombre: 'Gerente Demo', email: 'gerente@homepymes.cl', empresa_id: 'HP',
    rol: 'GERENCIA', activo: true, ultimo_acceso: '', creado_por: 'sistema'
  });
  return db;
}

function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }

function seedSolicitudCierre(db, overrides) {
  const base = Object.assign(
    {
      solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', plataforma: 'ERP', modulo: 'Facturacion',
      tipo: 'ERROR', es_cliente: false, solicitante_nombre: 'Juan Perez', solicitante_email: 'juan@homepymes.cl',
      estado_derivado: 'S08', prioridad_derivada: 'P2', dedup_hash: 'x',
      fecha_creacion: new Date().toISOString(), creado_por: 'juan@homepymes.cl'
    },
    overrides
  );
  agregarFila_(db, 'SOLICITUDES', base);
  return base;
}

function seedSubsolicitudPatron(db, overrides) {
  const base = Object.assign(
    {
      subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001', titulo: 'Titulo',
      descripcion: 'Descripcion', prioridad: 'P2', estado: 'S02', modulo: 'MOD_X', tipo: 'ERR',
      fecha_creacion: new Date().toISOString()
    },
    overrides
  );
  agregarFila_(db, 'SUBSOLICITUDES', base);
  return base;
}

function seedPatronCompleto(db) {
  seedSolicitudCierre(db, { solicitud_id: 'SOL-2026-HP-0001', solicitante_email: 'juan@homepymes.cl' });
  seedSolicitudCierre(db, { solicitud_id: 'SOL-2026-HP-0002', solicitante_email: 'ana@homepymes.cl' });
  seedSolicitudCierre(db, { solicitud_id: 'SOL-2026-HP-0003', solicitante_email: 'ana@homepymes.cl' });
  seedSubsolicitudPatron(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001' });
  seedSubsolicitudPatron(db, { subsolicitud_id: 'SOL-2026-HP-0002-01', solicitud_id: 'SOL-2026-HP-0002' });
  seedSubsolicitudPatron(db, { subsolicitud_id: 'SOL-2026-HP-0003-01', solicitud_id: 'SOL-2026-HP-0003' });
}

function conApiKey(t) {
  process.env.RESEND_API_KEY = 're_test_key';
  t.after(() => { delete process.env.RESEND_API_KEY; });
}

function mockEnvioOk(t) {
  return t.mock.method(Resend, 'enviarCorreoResend_', async () => ({ id: 'fake-resend-id' }));
}

test('detectarPatrones avisa por correo y registra en LOG_SISTEMA cuando supera el umbral', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();
  seedPatronCompleto(db);

  const resultado = await Notificaciones.detectarPatrones(db);

  assert.equal(resultado.avisados, 1);
  const logs = filas(db, 'LOG_SISTEMA').filter((l) => l.contexto === 'ALERTA_PATRON');
  assert.equal(logs.length, 1);
  assert.equal(mock.mock.callCount(), 1);
  assert.equal(mock.mock.calls[0].arguments[0].to[0], 'gerente@homepymes.cl');
});

test('detectarPatrones no reenvia el mismo patron el mismo dia (dedup via LOG_SISTEMA)', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();
  seedPatronCompleto(db);

  await Notificaciones.detectarPatrones(db);
  const segundaCorrida = await Notificaciones.detectarPatrones(db);

  assert.equal(segundaCorrida.avisados, 0);
  assert.equal(mock.mock.callCount(), 1, 'no debe reenviar el mismo dia');
});

test('detectarPatrones no avisa si no se alcanza el umbral (menos de 3 reportes o menos de 2 solicitantes)', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();
  // Solo 2 reportes: no alcanza PATRON_CANTIDAD_MINIMA (3).
  seedSolicitudCierre(db, { solicitud_id: 'SOL-2026-HP-0001', solicitante_email: 'juan@homepymes.cl' });
  seedSolicitudCierre(db, { solicitud_id: 'SOL-2026-HP-0002', solicitante_email: 'ana@homepymes.cl' });
  seedSubsolicitudPatron(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001' });
  seedSubsolicitudPatron(db, { subsolicitud_id: 'SOL-2026-HP-0002-01', solicitud_id: 'SOL-2026-HP-0002' });

  const resultado = await Notificaciones.detectarPatrones(db);

  assert.equal(resultado.avisados, 0);
  assert.equal(mock.mock.callCount(), 0);
});

test('notificarPatron avisa a GERENCIA y ADM activos, no a otros roles', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();
  agregarFila_(db, 'USUARIOS', {
    usuario_id: 'U2', nombre: 'Admin Demo', email: 'admin@homepymes.cl', empresa_id: 'HP',
    rol: 'ADM', activo: true, ultimo_acceso: '', creado_por: 'sistema'
  });
  agregarFila_(db, 'USUARIOS', {
    usuario_id: 'U3', nombre: 'Dev Demo', email: 'dev@homepymes.cl', empresa_id: 'HP',
    rol: 'DEV', activo: true, ultimo_acceso: '', creado_por: 'sistema'
  });
  agregarFila_(db, 'USUARIOS', {
    usuario_id: 'U4', nombre: 'Gerente Inactivo', email: 'inactivo@homepymes.cl', empresa_id: 'HP',
    rol: 'GERENCIA', activo: false, ultimo_acceso: '', creado_por: 'sistema'
  });

  await Notificaciones.notificarPatron(db, { modulo: 'Facturacion', tipo: 'Error', cantidad: 5, solicitantes_distintos: 3 });

  const destinatarios = mock.mock.calls.map((c) => c.arguments[0].to[0]).sort();
  assert.deepEqual(destinatarios, ['admin@homepymes.cl', 'gerente@homepymes.cl']);
});
