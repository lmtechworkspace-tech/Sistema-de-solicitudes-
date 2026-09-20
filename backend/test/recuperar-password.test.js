'use strict';

/**
 * Fase "Recuperar contraseña" (documento "Arquitectura de Accesos",
 * 2026-09-19, punto 3 del orden acordado): no existía ningún flujo de
 * "olvidé mi contraseña" en SIGSO -- solo reseteo manual por un Admin.
 * Cubre solicitarRecuperacion (anti-enumeración + límite persistido +
 * envío real por Resend, mockeado) y restablecerPassword (token de un
 * solo uso, expiración, cierre de sesiones).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, leerFilas_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const CuentasPortal = require('../logica/cuentasPortal');
const Sesiones = require('../logica/sesiones');
const Hash = require('../logica/passwordHash');
const Resend = require('../logica/resend');
const RecuperarPassword = require('../logica/recuperarPassword');

const ADMIN = { email: 'admin@homepymes.cl', rol: 'ADM' };

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}
function conApiKey(t) {
  process.env.RESEND_API_KEY = 're_test_key';
  t.after(() => { delete process.env.RESEND_API_KEY; });
}
function mockEnvioOk(t) {
  return t.mock.method(Resend, 'enviarCorreoResend_', async () => ({ id: 'fake-resend-id' }));
}
function crearCuenta(db, overrides) {
  const r = CuentasPortal.gestionar(db, Object.assign({
    operacion: 'crear', usuario: 'leo', nombre: 'Leo', emails: 'leo@rld.cl', rol: 'DEV'
  }, overrides), ADMIN);
  return CuentasPortal.listar(db, {}, ADMIN).cuentas.find((c) => c.usuario === (overrides && overrides.usuario || 'leo'));
}
function tokenDelMock_(mock) {
  const cuerpo = mock.mock.calls[0].arguments[0].text || mock.mock.calls[0].arguments[0].html || '';
  const m = /reset=([^\s<]+)/.exec(cuerpo);
  return m ? decodeURIComponent(m[1]) : null;
}

// --- solicitarRecuperacion ------------------------------------------------

test('solicitarRecuperacion: responde IGUAL si la cuenta existe o no (anti-enumeración)', async (t) => {
  conApiKey(t);
  mockEnvioOk(t);
  const db = dbConSchema();
  crearCuenta(db);

  const conCuenta = await RecuperarPassword.solicitarRecuperacion(db, { identificador: 'leo' });
  const sinCuenta = await RecuperarPassword.solicitarRecuperacion(db, { identificador: 'no-existe' });
  assert.deepEqual(conCuenta, sinCuenta);
});

test('solicitarRecuperacion: el TIEMPO de respuesta tampoco delata si la cuenta existe', async (t) => {
  conApiKey(t);
  mockEnvioOk(t);
  const db = dbConSchema();
  crearCuenta(db);

  const antesConCuenta = Date.now();
  await RecuperarPassword.solicitarRecuperacion(db, { identificador: 'leo' });
  const msConCuenta = Date.now() - antesConCuenta;

  const antesSinCuenta = Date.now();
  await RecuperarPassword.solicitarRecuperacion(db, { identificador: 'fantasma-timing' });
  const msSinCuenta = Date.now() - antesSinCuenta;

  // Sin el piso de tiempo, "sin cuenta" responde casi al instante (no hay
  // await a Resend) mientras "con cuenta" espera el envio real -- ambos
  // deberian tardar aprox. lo mismo (el piso configurado).
  assert.ok(msSinCuenta >= 350, 'sin cuenta deberia tardar tambien, no responder al instante: ' + msSinCuenta + 'ms');
});

test('solicitarRecuperacion: identificador vacío responde igual, no revienta', async () => {
  const db = dbConSchema();
  const r = await RecuperarPassword.solicitarRecuperacion(db, {});
  assert.equal(r.ok, true);
  assert.equal(leerFilas_(db, 'RESETS_PASSWORD', COLUMNAS.RESETS_PASSWORD).length, 0);
});

test('solicitarRecuperacion: cuenta real por USUARIO crea un token y envía el correo', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();
  crearCuenta(db);

  await RecuperarPassword.solicitarRecuperacion(db, { identificador: 'leo' });

  assert.equal(mock.mock.callCount(), 1);
  assert.deepEqual(mock.mock.calls[0].arguments[0].to, ['leo@rld.cl']);
  const filas = leerFilas_(db, 'RESETS_PASSWORD', COLUMNAS.RESETS_PASSWORD);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].usado, false);
});

test('solicitarRecuperacion: cuenta real por CORREO (no usuario) también funciona', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();
  crearCuenta(db);

  await RecuperarPassword.solicitarRecuperacion(db, { identificador: 'LEO@rld.cl' }); // mayúsculas a propósito
  assert.equal(mock.mock.callCount(), 1);
});

test('solicitarRecuperacion: el token NUNCA se guarda en claro', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();
  crearCuenta(db);

  await RecuperarPassword.solicitarRecuperacion(db, { identificador: 'leo' });
  const token = tokenDelMock_(mock);
  assert.ok(token, 'debe haber un token en el enlace');

  const fila = leerFilas_(db, 'RESETS_PASSWORD', COLUMNAS.RESETS_PASSWORD)[0];
  assert.notEqual(fila.token_hash, token, 'la fila no debe guardar el token crudo');
  assert.equal(fila.token_hash, Hash.hashToken(token));
});

test('solicitarRecuperacion: cuenta INACTIVA no crea token ni manda correo', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();
  crearCuenta(db);
  const cuenta = CuentasPortal.listar(db, {}, ADMIN).cuentas.find((c) => c.usuario === 'leo');
  actualizarFilaPorId_(db, 'CUENTAS_PORTAL', 'cuenta_id', cuenta.cuenta_id, { activo: false });

  await RecuperarPassword.solicitarRecuperacion(db, { identificador: 'leo' });
  assert.equal(mock.mock.callCount(), 0);
  assert.equal(leerFilas_(db, 'RESETS_PASSWORD', COLUMNAS.RESETS_PASSWORD).length, 0);
});

test('solicitarRecuperacion: límite persistido -- pasado el tope, no crea más tokens ni manda más correos', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();
  crearCuenta(db);

  for (let i = 0; i < 5; i++) {
    await RecuperarPassword.solicitarRecuperacion(db, { identificador: 'leo' });
  }

  // El límite del módulo es 3 por hora -- las 2 siguientes no deben sumar fila ni correo.
  assert.equal(mock.mock.callCount(), 3);
  assert.equal(leerFilas_(db, 'RESETS_PASSWORD', COLUMNAS.RESETS_PASSWORD).length, 3);
});

// --- restablecerPassword ---------------------------------------------------

async function pedirYObtenerToken_(t, db, identificador) {
  const mock = mockEnvioOk(t);
  await RecuperarPassword.solicitarRecuperacion(db, { identificador: identificador || 'leo' });
  return tokenDelMock_(mock);
}

test('restablecerPassword: con un token válido, cambia la clave y el login funciona con la nueva', async (t) => {
  conApiKey(t);
  const db = dbConSchema();
  crearCuenta(db);
  const token = await pedirYObtenerToken_(t, db);

  const r = await RecuperarPassword.restablecerPassword(db, { token, password_nueva: 'ClaveNueva123' });
  assert.equal(r.ok, true);

  const cuenta = CuentasPortal.listar(db, {}, ADMIN).cuentas.find((c) => c.usuario === 'leo');
  const filaCompleta = leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL).find((c) => c.cuenta_id === cuenta.cuenta_id);
  assert.equal(Hash.coincide('ClaveNueva123', filaCompleta.salt, filaCompleta.hash_password), true);
});

test('restablecerPassword: el token queda marcado usado y no sirve una segunda vez', async (t) => {
  conApiKey(t);
  const db = dbConSchema();
  crearCuenta(db);
  const token = await pedirYObtenerToken_(t, db);

  await RecuperarPassword.restablecerPassword(db, { token, password_nueva: 'ClaveNueva123' });
  const segundaVez = await RecuperarPassword.restablecerPassword(db, { token, password_nueva: 'OtraClave456' });
  assert.equal(segundaVez._forbidden, true);
});

test('restablecerPassword: token vencido es rechazado', async (t) => {
  conApiKey(t);
  const db = dbConSchema();
  crearCuenta(db);
  const token = await pedirYObtenerToken_(t, db);

  const fila = leerFilas_(db, 'RESETS_PASSWORD', COLUMNAS.RESETS_PASSWORD)[0];
  actualizarFilaPorId_(db, 'RESETS_PASSWORD', 'reset_id', fila.reset_id, { expira: new Date(Date.now() - 1000).toISOString() });

  const r = await RecuperarPassword.restablecerPassword(db, { token, password_nueva: 'ClaveNueva123' });
  assert.equal(r._forbidden, true);
  assert.match(r.message, /expir/i);
});

test('restablecerPassword: token inventado/inexistente es rechazado', async () => {
  const db = dbConSchema();
  const r = await RecuperarPassword.restablecerPassword(db, { token: 'token-que-nunca-existio', password_nueva: 'ClaveNueva123' });
  assert.equal(r._forbidden, true);
});

test('restablecerPassword: exige contraseña de al menos 8 caracteres', async (t) => {
  conApiKey(t);
  const db = dbConSchema();
  crearCuenta(db);
  const token = await pedirYObtenerToken_(t, db);

  const r = await RecuperarPassword.restablecerPassword(db, { token, password_nueva: 'corta' });
  assert.equal(r._validationError, true);
});

test('restablecerPassword: cierra TODAS las sesiones activas de la cuenta', async (t) => {
  conApiKey(t);
  const db = dbConSchema();
  crearCuenta(db);
  const cuenta = CuentasPortal.listar(db, {}, ADMIN).cuentas.find((c) => c.usuario === 'leo');
  const tokenSesion = Sesiones.crearSesion(db, cuenta.cuenta_id);
  assert.ok(Sesiones.resolverCuentaPorToken(db, tokenSesion), 'la sesión debe estar viva antes del reset');

  const token = await pedirYObtenerToken_(t, db);
  await RecuperarPassword.restablecerPassword(db, { token, password_nueva: 'ClaveNueva123' });

  assert.equal(Sesiones.resolverCuentaPorToken(db, tokenSesion), null, 'la sesión vieja debe quedar revocada');
});
