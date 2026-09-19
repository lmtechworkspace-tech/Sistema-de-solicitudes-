'use strict';

/**
 * Prueba de portabilidad: los escenarios de canales-alerta.test.js y
 * enviar-alerta.test.js (contra Notificaciones.gs), corridos contra
 * backend/logica/notificaciones.js (Fase 3a del plan post-migración).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Notificaciones = require('../logica/notificaciones');
const Resend = require('../logica/resend');

const ADMIN = { rol: 'ADM', email: 'admin@homepymes.cl' };
const NO_ADMIN = { rol: 'DEV', email: 'juan@hp.cl' };

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
function conApiKey(t) {
  process.env.RESEND_API_KEY = 're_test_key';
  t.after(() => { delete process.env.RESEND_API_KEY; });
}
function mockEnvioOk(t) {
  return t.mock.method(Resend, 'enviarCorreoResend_', async () => ({ id: 'fake-resend-id' }));
}

// ===== Canales de alerta ====================================================

test('sin registro, el correo de una categoría está ENCENDIDO (default, no rompe nada)', async (t) => {
  conApiKey(t); mockEnvioOk(t);
  const db = dbConSchema();
  const r = await Notificaciones.enviarCorreoModulo(db, { solicitudId: 'SOL-1', destinatario: 'leo@rld.cl', evento: 'PAUSA_RECORDATORIO', asunto: 'Asunto', cuerpo: 'Cuerpo' });
  assert.equal(r.enviado, true);
});

test('guardarCanalAlerta apaga PAUSAS -> enviarCorreoModulo ya NO manda ese evento', async (t) => {
  conApiKey(t); mockEnvioOk(t);
  const db = dbConSchema();
  Notificaciones.guardarCanalAlerta(db, { clave: 'PAUSAS', activo: false }, ADMIN);
  const r = await Notificaciones.enviarCorreoModulo(db, { solicitudId: 'SOL-1', destinatario: 'leo@rld.cl', evento: 'PAUSA_ULTIMA_LLAMADA', asunto: 'Asunto', cuerpo: 'Cuerpo' });
  assert.equal(r.enviado, false);
  assert.equal(r.motivo, 'canal_desactivado');
});

test('apagar PAUSAS no afecta a otras categorías (NOVEDADES sigue enviando)', async (t) => {
  conApiKey(t); mockEnvioOk(t);
  const db = dbConSchema();
  Notificaciones.guardarCanalAlerta(db, { clave: 'PAUSAS', activo: false }, ADMIN);
  const r = await Notificaciones.enviarCorreoModulo(db, { solicitudId: 'NOV-1', destinatario: 'leo@rld.cl', evento: 'NOVEDAD_PUBLICADA', asunto: 'Asunto', cuerpo: 'Cuerpo' });
  assert.equal(r.enviado, true);
});

test('los avisos al SOLICITANTE EXTERNO nunca se bloquean (no tienen categoría) -- via encolarCorreo_/notificarCambioEstado', async (t) => {
  const db = dbConSchema();
  ['PAUSAS', 'ACTIVIDADES', 'NOVEDADES', 'SOLICITUDES', 'SLA', 'REPORTES'].forEach((c) => Notificaciones.guardarCanalAlerta(db, { clave: c, activo: false }, ADMIN));
  agregarFila_(db, 'SOLICITUDES', { solicitud_id: 'SOL-1', solicitante_email: 'cliente@externo.cl', solicitante_nombre: 'Cliente', estado_derivado: 'S05' });
  const r = Notificaciones.notificarCambioEstado(db, 'SOL-1', 'SOL-1-01', 'S02', 'S05');
  assert.equal(r.encolado, true);
  assert.equal(filas(db, 'LOG_NOTIFICACIONES').length, 1);
});

test('listarCanalesAlerta es ADM-only y trae las 6 categorías con tiene_en_vivo', () => {
  const db = dbConSchema();
  assert.equal(Notificaciones.listarCanalesAlerta(db, {}, NO_ADMIN)._forbidden, true);

  const r = Notificaciones.listarCanalesAlerta(db, {}, ADMIN);
  assert.equal(r.canales.length, 6);
  const pausas = r.canales.find((c) => c.clave === 'PAUSAS');
  assert.equal(pausas.tiene_en_vivo, true);
  assert.equal(pausas.correo_activo, true);
  const sla = r.canales.find((c) => c.clave === 'SLA');
  assert.equal(sla.tiene_en_vivo, false);
});

test('guardarCanalAlerta es ADM-only, hace upsert y rechaza una clave desconocida', () => {
  const db = dbConSchema();
  assert.equal(Notificaciones.guardarCanalAlerta(db, { clave: 'PAUSAS', activo: false }, NO_ADMIN)._forbidden, true);
  assert.equal(Notificaciones.guardarCanalAlerta(db, { clave: 'INVENTADO', activo: false }, ADMIN)._validationError, true);

  Notificaciones.guardarCanalAlerta(db, { clave: 'PAUSAS', activo: false }, ADMIN);
  Notificaciones.guardarCanalAlerta(db, { clave: 'PAUSAS', activo: true }, ADMIN); // upsert: no duplica
  const config = filas(db, 'CONFIG_NOTIFICACIONES').filter((f) => f.notif_id === 'CANAL_CORREO_PAUSAS');
  assert.equal(config.length, 1);
  assert.equal(config[0].activo, true);
});

// ===== Enviar alerta manual =================================================

function seedDirectorio(db) {
  agregarFila_(db, 'USUARIOS', { usuario_id: 'U1', nombre: 'Admin', email: 'admin@homepymes.cl', empresa_id: 'HP', rol: 'ADM', activo: true, creado_por: 'seed' });
  agregarFila_(db, 'USUARIOS', { usuario_id: 'U2', nombre: 'Ana Dev', email: 'ana@homepymes.cl', empresa_id: 'HP', rol: 'DEV', activo: true, creado_por: 'seed' });
  agregarFila_(db, 'USUARIOS', { usuario_id: 'U3', nombre: 'Ex', email: 'ex@homepymes.cl', empresa_id: 'HP', rol: 'DEV', activo: false, creado_por: 'seed' });
  agregarFila_(db, 'CUENTAS_PORTAL', {
    cuenta_id: 'CTA-1', usuario: 'leo', nombre: 'Leo Estay', cargo: 'Dev', hash_password: 'hash', salt: 'sal',
    emails: JSON.stringify(['leo@rld.cl']), rol: 'DEV', modulos: JSON.stringify(['bandeja']), empresa_id: 'RLD',
    activo: true, debe_cambiar_password: false, ultimo_acceso: '', creado_por: 'seed'
  });
}
const BASE_ALERTA = { titulo: 'Auditoría ISO 9001', mensaje: 'Martes 15, 9:00.' };

test('enviarAlertaManual es ADM-only', async () => {
  const db = dbConSchema();
  assert.equal((await Notificaciones.enviarAlertaManual(db, BASE_ALERTA, NO_ADMIN))._forbidden, true);
});

test('TODOS: encola alerta en vivo y manda correo a todo el personal activo (menos inactivos)', async (t) => {
  conApiKey(t); mockEnvioOk(t);
  const db = dbConSchema();
  seedDirectorio(db);
  const r = await Notificaciones.enviarAlertaManual(db, Object.assign({ audiencia_tipo: 'TODOS' }, BASE_ALERTA), ADMIN);
  assert.equal(r.ok, true);
  assert.equal(r.destinatarios, 3); // admin+ana (HP activos) + leo (portal activo); ex inactivo fuera
  assert.equal(filas(db, 'NOTIFICACIONES_APP').length, 3);
  const notif = filas(db, 'NOTIFICACIONES_APP')[0];
  assert.equal(notif.tipo, 'ALERTA_ADMIN');
  assert.match(notif.titulo, /Auditoría ISO 9001/);
});

test('EMPRESA: filtra por empresa_id', async (t) => {
  conApiKey(t); mockEnvioOk(t);
  const db = dbConSchema();
  seedDirectorio(db);
  const r = await Notificaciones.enviarAlertaManual(db, Object.assign({ audiencia_tipo: 'EMPRESA', empresa_id: 'RLD' }, BASE_ALERTA), ADMIN);
  assert.equal(r.destinatarios, 1);
  assert.equal(filas(db, 'NOTIFICACIONES_APP')[0].destinatario_email, 'leo@rld.cl');
});

test('SELECCION: solo los correos elegidos', async (t) => {
  conApiKey(t); mockEnvioOk(t);
  const db = dbConSchema();
  seedDirectorio(db);
  const r = await Notificaciones.enviarAlertaManual(db, Object.assign({ audiencia_tipo: 'SELECCION', destinatarios: ['ana@homepymes.cl'] }, BASE_ALERTA), ADMIN);
  assert.equal(r.destinatarios, 1);
});

test('solo en vivo (por_correo=false): encola pero NO manda correo', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();
  seedDirectorio(db);
  const r = await Notificaciones.enviarAlertaManual(db, Object.assign({ audiencia_tipo: 'TODOS', por_correo: false }, BASE_ALERTA), ADMIN);
  assert.equal(r.correo, 0);
  assert.equal(mock.mock.callCount(), 0);
  assert.equal(filas(db, 'NOTIFICACIONES_APP').length, 3);
});

test('solo correo (por_en_vivo=false): manda correo pero NO encola en vivo', async (t) => {
  conApiKey(t); mockEnvioOk(t);
  const db = dbConSchema();
  seedDirectorio(db);
  const r = await Notificaciones.enviarAlertaManual(db, Object.assign({ audiencia_tipo: 'TODOS', por_en_vivo: false }, BASE_ALERTA), ADMIN);
  assert.equal(r.en_vivo, 0);
  assert.equal(filas(db, 'NOTIFICACIONES_APP').length, 0);
  assert.equal(r.correo, 3);
});

test('valida título, mensaje y al menos un canal', async () => {
  const db = dbConSchema();
  seedDirectorio(db);
  assert.equal((await Notificaciones.enviarAlertaManual(db, { titulo: 'x', mensaje: 'hola' }, ADMIN))._validationError, true);
  assert.equal((await Notificaciones.enviarAlertaManual(db, { titulo: 'Titulo ok', mensaje: '' }, ADMIN))._validationError, true);
  assert.equal((await Notificaciones.enviarAlertaManual(db, Object.assign({ por_correo: false, por_en_vivo: false }, BASE_ALERTA), ADMIN))._validationError, true);
});

test('ALERTA_ADMIN nunca se bloquea aunque el Admin haya apagado todos los canales de correo', async (t) => {
  conApiKey(t); mockEnvioOk(t);
  const db = dbConSchema();
  seedDirectorio(db);
  ['PAUSAS', 'ACTIVIDADES', 'NOVEDADES', 'SOLICITUDES', 'SLA', 'REPORTES'].forEach((c) => Notificaciones.guardarCanalAlerta(db, { clave: c, activo: false }, ADMIN));
  const r = await Notificaciones.enviarAlertaManual(db, Object.assign({ audiencia_tipo: 'TODOS' }, BASE_ALERTA), ADMIN);
  assert.equal(r.correo, 3);
});

test('getDirectorioAlerta es ADM-only y trae personas + empresas', () => {
  const db = dbConSchema();
  seedDirectorio(db);
  assert.equal(Notificaciones.getDirectorioAlerta(db, {}, NO_ADMIN)._forbidden, true);
  const dir = Notificaciones.getDirectorioAlerta(db, {}, ADMIN);
  assert.equal(dir.personas.length, 3);
  assert.equal(dir.empresas.length, 2);
  assert.ok(dir.empresas.includes('HP') && dir.empresas.includes('RLD'));
});

test('registra la alerta en LOG_SISTEMA para trazabilidad', async (t) => {
  conApiKey(t); mockEnvioOk(t);
  const db = dbConSchema();
  seedDirectorio(db);
  await Notificaciones.enviarAlertaManual(db, Object.assign({ audiencia_tipo: 'TODOS' }, BASE_ALERTA), ADMIN);
  const logs = filas(db, 'LOG_SISTEMA').filter((l) => l.contexto === 'ALERTA_ADMIN');
  assert.equal(logs.length, 1);
  assert.match(logs[0].mensaje, /admin@homepymes\.cl/);
});

// ===== Reporte ejecutivo a pedido ===========================================

test('enviarReporteGerenciaAhora es ADM-only y manda a GERENCIA+ADM de cada empresa con usuarios', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();
  agregarFila_(db, 'USUARIOS', { usuario_id: 'U1', nombre: 'Gerente HP', email: 'gerente@hp.cl', empresa_id: 'HP', rol: 'GERENCIA', activo: true, creado_por: 'seed' });
  agregarFila_(db, 'USUARIOS', { usuario_id: 'U2', nombre: 'Admin HP', email: 'admin@hp.cl', empresa_id: 'HP', rol: 'ADM', activo: true, creado_por: 'seed' });
  agregarFila_(db, 'USUARIOS', { usuario_id: 'U3', nombre: 'Dev HP', email: 'dev@hp.cl', empresa_id: 'HP', rol: 'DEV', activo: true, creado_por: 'seed' });

  assert.equal((await Notificaciones.enviarReporteGerenciaAhora(db, {}, NO_ADMIN))._forbidden, true);

  const r = await Notificaciones.enviarReporteGerenciaAhora(db, {}, ADMIN);
  assert.equal(r.total, 2); // gerente + admin, no el DEV
  assert.equal(r.enviados, 2);
  assert.equal(mock.mock.callCount(), 2);
});
