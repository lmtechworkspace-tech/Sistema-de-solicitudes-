'use strict';

/**
 * Prueba de portabilidad: los escenarios de backend/test/notificaciones.test.js
 * (envio real via Gmail/MailApp en el .gs), corridos contra notificaciones.js
 * con Resend como transporte. El envio real se mockea (Resend.enviarCorreoResend_)
 * -- ningun test de este archivo toca la red.
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
  return db;
}

// Todas las pruebas fijan RESEND_API_KEY (sin esto, enviarCorreo_ nunca
// intenta la red real -- ver el test dedicado a ese caso al final).
function conApiKey(t) {
  process.env.RESEND_API_KEY = 're_test_key';
  t.after(() => { delete process.env.RESEND_API_KEY; });
}

function mockEnvioOk(t) {
  return t.mock.method(Resend, 'enviarCorreoResend_', async () => ({ id: 'fake-resend-id' }));
}

function mockEnvioFalla(t) {
  return t.mock.method(Resend, 'enviarCorreoResend_', async () => { throw new Error('Resend respondio 429: rate limited'); });
}

test('enviarAcuseRecibo envia el correo por Resend y lo registra ENVIADO', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();

  const resultado = await Notificaciones.enviarAcuseRecibo(db, {
    solicitud_id: 'SOL-2026-HP-0001', solicitante_nombre: 'Juan', solicitante_email: 'juan@x.cl', resumen_whatsapp: 'r'
  });

  assert.equal(resultado.enviado, true);
  assert.equal(mock.mock.callCount(), 1);
  assert.deepEqual(mock.mock.calls[0].arguments[0].to, ['juan@x.cl']);

  const log = leerFilas_(db, 'LOG_NOTIFICACIONES', COLUMNAS.LOG_NOTIFICACIONES);
  assert.equal(log.length, 1);
  assert.equal(log[0].evento, 'ACUSE_RECIBO');
  assert.equal(log[0].resultado, 'ENVIADO');
});

test('enviarAcuseRecibo copia el cc opcional (Fase 9)', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();

  await Notificaciones.enviarAcuseRecibo(db, {
    solicitud_id: 'SOL-2026-HP-0002', solicitante_nombre: 'Juan', solicitante_email: 'juan@x.cl',
    resumen_whatsapp: 'r', cc: 'copia@x.cl'
  });

  assert.deepEqual(mock.mock.calls[0].arguments[0].cc, ['copia@x.cl']);
});

test('v7.6: enviarAcuseRecibo trae HTML branded con marca SIGSO, sin duplicar el pie de texto plano', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();

  await Notificaciones.enviarAcuseRecibo(db, {
    solicitud_id: 'SOL-2026-HP-0003', solicitante_nombre: 'Juan', solicitante_email: 'juan@x.cl',
    resumen_whatsapp: 'r', empresa_id: 'HP', prioridad: 'P2', total_items: 1
  });

  const payload = mock.mock.calls[0].arguments[0];
  assert.match(payload.html, /SIGSO/);
  assert.match(payload.html, /Confirmamos la recepci/);
  assert.equal(payload.html.indexOf('--------------------------------------------------'), -1, 'el HTML no debe repetir el pie de texto plano');
  assert.match(payload.text, /--------------------------------------------------/, 'el texto plano SI conserva su propio pie institucional');
});

test('el mismo evento para la misma solicitud se deduplica dentro de 30 minutos (RN-026)', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();
  const datos = { solicitud_id: 'SOL-2026-HP-0001', solicitante_nombre: 'Juan', solicitante_email: 'juan@x.cl', resumen_whatsapp: 'r' };

  await Notificaciones.enviarAcuseRecibo(db, datos);
  const segundo = await Notificaciones.enviarAcuseRecibo(db, datos);

  assert.equal(segundo.enviado, false);
  assert.equal(segundo.motivo, 'deduplicado');
  assert.equal(mock.mock.callCount(), 1, 'no debe reenviar el correo');
});

test('enviarAvisoDesarrollo avisa al buzon de desarrollo (Leo) con el motivo', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();

  await Notificaciones.enviarAvisoDesarrollo(db,
    { solicitud_id: 'SOL-2026-HP-0001', prioridad: 'P2', resumen_whatsapp: 'r' },
    'solicitud de cliente'
  );

  const payload = mock.mock.calls[0].arguments[0];
  assert.deepEqual(payload.to, ['lestay@rld.cl']);
  assert.match(payload.text, /solicitud de cliente/);

  const log = leerFilas_(db, 'LOG_NOTIFICACIONES', COLUMNAS.LOG_NOTIFICACIONES);
  assert.equal(log[0].evento, 'AVISO_DESARROLLO');
});

test('enviarAvisoDesarrollo marca ALERTA P1 en el asunto cuando la prioridad es P1', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();

  await Notificaciones.enviarAvisoDesarrollo(db,
    { solicitud_id: 'SOL-2026-HP-0002', prioridad: 'P1', resumen_whatsapp: 'r' },
    'prioridad critica P1'
  );

  assert.match(mock.mock.calls[0].arguments[0].subject, /ALERTA P1/);
});

test('enviarCorreo_ encola para reintento si Resend falla (A-12)', async (t) => {
  conApiKey(t);
  mockEnvioFalla(t);
  const db = dbConSchema();

  const resultado = await Notificaciones.enviarAcuseRecibo(db, {
    solicitud_id: 'SOL-2026-HP-0001', solicitante_nombre: 'Juan', solicitante_email: 'juan@x.cl', resumen_whatsapp: 'r'
  });

  assert.equal(resultado.enviado, false);
  assert.equal(resultado.motivo, 'error_envio');
  const log = leerFilas_(db, 'LOG_NOTIFICACIONES', COLUMNAS.LOG_NOTIFICACIONES);
  assert.equal(log[0].resultado, 'PENDIENTE_REINTENTO');
  assert.equal(Number(log[0].reintentos), 1);
});

test('notificarCambioEstado (Fase 10.2) ENCOLA el correo sin intentar un envio inmediato', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();
  agregarFila_(db, 'SOLICITUDES', Object.assign(
    Object.fromEntries(COLUMNAS.SOLICITUDES.map((c) => [c, ''])),
    { solicitud_id: 'SOL-2026-HP-0001', solicitante_email: 'juan@x.cl', empresa_id: 'HP' }
  ));

  const resultado = Notificaciones.notificarCambioEstado(db, 'SOL-2026-HP-0001', 'SOL-2026-HP-0001-01', 'S02', 'S03');

  assert.equal(resultado.encolado, true);
  assert.equal(mock.mock.callCount(), 0, 'no debe llamar a Resend de inmediato');

  const log = leerFilas_(db, 'LOG_NOTIFICACIONES', COLUMNAS.LOG_NOTIFICACIONES);
  assert.equal(log.length, 1);
  assert.equal(log[0].destinatario, 'juan@x.cl');
  assert.equal(log[0].resultado, 'PENDIENTE_REINTENTO');
  assert.equal(Number(log[0].reintentos), 0);
  assert.ok(log[0].asunto.indexOf('SOL-2026-HP-0001') !== -1);
});

test('procesarColaCorreo entrega el correo real de un cambio de estado encolado', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();
  agregarFila_(db, 'SOLICITUDES', Object.assign(
    Object.fromEntries(COLUMNAS.SOLICITUDES.map((c) => [c, ''])),
    { solicitud_id: 'SOL-2026-HP-0001', solicitante_email: 'juan@x.cl', empresa_id: 'HP' }
  ));
  Notificaciones.notificarCambioEstado(db, 'SOL-2026-HP-0001', 'SOL-2026-HP-0001-01', 'S02', 'S03');

  const resultado = await Notificaciones.procesarColaCorreo(db);

  assert.equal(resultado[0].resultado, 'ENVIADO');
  assert.equal(mock.mock.callCount(), 1);
  assert.deepEqual(mock.mock.calls[0].arguments[0].to, ['juan@x.cl']);

  const log = leerFilas_(db, 'LOG_NOTIFICACIONES', COLUMNAS.LOG_NOTIFICACIONES);
  assert.equal(log[0].resultado, 'ENVIADO');
});

test('procesarColaCorreo reintenta notificaciones pendientes y las marca ENVIADO', async (t) => {
  conApiKey(t);
  mockEnvioOk(t);
  const db = dbConSchema();
  agregarFila_(db, 'LOG_NOTIFICACIONES', {
    log_id: 'log-1', timestamp: new Date().toISOString(), solicitud_id: 'SOL-2026-HP-0001',
    canal: 'EMAIL', destinatario: 'juan@x.cl', evento: 'ACUSE_RECIBO', resultado: 'PENDIENTE_REINTENTO',
    reintentos: 1, asunto: 'Asunto pendiente', cuerpo: 'Cuerpo pendiente'
  });

  const resultado = await Notificaciones.procesarColaCorreo(db);

  assert.equal(resultado[0].resultado, 'ENVIADO');
  const log = leerFilas_(db, 'LOG_NOTIFICACIONES', COLUMNAS.LOG_NOTIFICACIONES);
  assert.equal(log[0].resultado, 'ENVIADO');
});

test('procesarColaCorreo marca FALLIDO tras alcanzar el maximo de reintentos', async (t) => {
  conApiKey(t);
  mockEnvioFalla(t);
  const db = dbConSchema();
  agregarFila_(db, 'LOG_NOTIFICACIONES', {
    log_id: 'log-1', timestamp: new Date().toISOString(), solicitud_id: 'SOL-2026-HP-0001',
    canal: 'EMAIL', destinatario: 'juan@x.cl', evento: 'ACUSE_RECIBO', resultado: 'PENDIENTE_REINTENTO',
    reintentos: 2, asunto: 'Asunto pendiente', cuerpo: 'Cuerpo pendiente'
  });

  await Notificaciones.procesarColaCorreo(db);

  const log = leerFilas_(db, 'LOG_NOTIFICACIONES', COLUMNAS.LOG_NOTIFICACIONES);
  assert.equal(log[0].resultado, 'FALLIDO');
  assert.equal(Number(log[0].reintentos), 3);
});

test('procesarColaCorreo no toca filas FALLIDO ni ENVIADO (ya salieron de la cola)', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();
  agregarFila_(db, 'LOG_NOTIFICACIONES', {
    log_id: 'log-fallido', timestamp: new Date().toISOString(), solicitud_id: 'SOL-1', canal: 'EMAIL',
    destinatario: 'a@x.cl', evento: 'X', resultado: 'FALLIDO', reintentos: 3, asunto: 'a', cuerpo: 'a'
  });
  agregarFila_(db, 'LOG_NOTIFICACIONES', {
    log_id: 'log-enviado', timestamp: new Date().toISOString(), solicitud_id: 'SOL-2', canal: 'EMAIL',
    destinatario: 'b@x.cl', evento: 'Y', resultado: 'ENVIADO', reintentos: 0, asunto: 'b', cuerpo: 'b'
  });

  const resultado = await Notificaciones.procesarColaCorreo(db);

  assert.equal(resultado.length, 0);
  assert.equal(mock.mock.callCount(), 0);
});

// Caso propio del puerto a Node (no existia en el .gs): sin RESEND_API_KEY
// configurada, enviarCorreo_ no debe lanzar ni bloquear -- se comporta igual
// que cualquier otro fallo transitorio, quedando en cola para cuando la key
// este configurada.
test('sin RESEND_API_KEY configurada, enviarCorreo_ encola en vez de fallar', async () => {
  delete process.env.RESEND_API_KEY;
  const db = dbConSchema();

  const resultado = await Notificaciones.enviarAcuseRecibo(db, {
    solicitud_id: 'SOL-2026-HP-0001', solicitante_nombre: 'Juan', solicitante_email: 'juan@x.cl', resumen_whatsapp: 'r'
  });

  assert.equal(resultado.enviado, false);
  assert.equal(resultado.motivo, 'error_envio');
  const log = leerFilas_(db, 'LOG_NOTIFICACIONES', COLUMNAS.LOG_NOTIFICACIONES);
  assert.equal(log[0].resultado, 'PENDIENTE_REINTENTO');
});

test('listarLogs exige rol ADM', (t) => {
  const db = dbConSchema();
  const resultado = Notificaciones.listarLogs(db, {}, { rol: 'DEV', email: 'dev@x.cl' });
  assert.equal(resultado._forbidden, true);
});

test('listarLogs devuelve los logs mas recientes primero, respetando el limite', (t) => {
  const db = dbConSchema();
  agregarFila_(db, 'LOG_NOTIFICACIONES', {
    log_id: 'l1', timestamp: '2026-01-01T00:00:00.000Z', solicitud_id: 'S1', canal: 'EMAIL',
    destinatario: 'a@x.cl', evento: 'X', resultado: 'ENVIADO', reintentos: 0, asunto: '', cuerpo: ''
  });
  agregarFila_(db, 'LOG_NOTIFICACIONES', {
    log_id: 'l2', timestamp: '2026-02-01T00:00:00.000Z', solicitud_id: 'S2', canal: 'EMAIL',
    destinatario: 'b@x.cl', evento: 'Y', resultado: 'ENVIADO', reintentos: 0, asunto: '', cuerpo: ''
  });

  const resultado = Notificaciones.listarLogs(db, { limite: 1 }, { rol: 'ADM', email: 'adm@x.cl' });

  assert.equal(resultado.length, 1);
  assert.equal(resultado[0].log_id, 'l2');
});
