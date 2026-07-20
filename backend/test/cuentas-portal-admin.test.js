'use strict';

/**
 * v4.0 Frente 5 -- administracion al 100% de las cuentas de la plataforma:
 * renombrar el usuario de login, asignar una clave elegida por el Admin (en
 * vez de una al azar) y eliminar la cuenta de verdad (no solo desactivarla).
 *
 * Lo mas critico que se cubre:
 *  - renombrar exige el mismo formato/unicidad que crear, y el login viejo
 *    deja de servir mientras el nuevo funciona de inmediato;
 *  - asignar_password deja entrar con la clave EXACTA que eligio el Admin
 *    (no una generada);
 *  - eliminar borra la fila de CUENTAS_PORTAL y, ademas, cualquier sesion
 *    viva de esa cuenta -- un token que ya circulaba no debe seguir
 *    funcionando solo porque no le toco expirar todavia.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadIntakeProject, loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

const ADMIN = { email: 'admin@homepymes.cl', rol: 'ADM' };

function loadIntake() {
  const ctx = loadIntakeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  ['SOLICITUDES', 'SUBSOLICITUDES', 'CUENTAS_PORTAL', 'SESIONES_PORTAL'].forEach((h) =>
    seedSheet(ctx, h, ctx.COLUMNAS[h]));
  return ctx;
}

function loadBackoffice() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'CUENTAS_PORTAL', ctx.COLUMNAS.CUENTAS_PORTAL);
  seedSheet(ctx, 'SESIONES_PORTAL', ctx.COLUMNAS.SESIONES_PORTAL);
  return ctx;
}

// Crea la cuenta con el codigo REAL del Backoffice (bo) y copia la fila
// completa a la hoja del sandbox de Intake (ctxIntake) -- el mismo viaje que
// hace el dato en produccion (dos proyectos, una planilla). A diferencia del
// helper de portal.test.js, aqui bo se pasa por fuera para poder aplicar mas
// operaciones (renombrar/asignar/eliminar) sobre la MISMA hoja despues.
function crearCuentaReal(bo, ctxIntake, datos) {
  const res = bo.CuentasPortal.gestionar(Object.assign({ operacion: 'crear' }, datos), ADMIN);
  assert.ok(!res._validationError, JSON.stringify(res));
  const fila = bo.leerFilas_('CUENTAS_PORTAL').find((f) => f.cuenta_id === res.cuenta_id);
  ctxIntake.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('CUENTAS_PORTAL')
    .appendRow(ctxIntake.COLUMNAS.CUENTAS_PORTAL.map((col) => (fila[col] !== undefined ? fila[col] : '')));
  return res;
}

// Copia el estado ACTUAL de una fila de CUENTAS_PORTAL desde bo hacia
// ctxIntake (reemplaza la fila existente) -- simula que ambos proyectos leen
// la misma planilla real tras una operacion de administracion.
function sincronizarCuenta(bo, ctxIntake, cuentaId) {
  const fila = bo.leerFilas_('CUENTAS_PORTAL').find((f) => f.cuenta_id === cuentaId);
  const hoja = ctxIntake.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('CUENTAS_PORTAL');
  const filas = ctxIntake.leerFilas_('CUENTAS_PORTAL');
  const idx = filas.findIndex((f) => f.cuenta_id === cuentaId);
  const encabezados = ctxIntake.COLUMNAS.CUENTAS_PORTAL;
  hoja.getRange(idx + 2, 1, 1, encabezados.length)
    .setValues([encabezados.map((col) => (fila[col] !== undefined ? fila[col] : ''))]);
}

test('renombrar: exige formato valido, rechaza usuario en uso, y el login sigue solo con el nuevo', () => {
  const bo = loadBackoffice();
  const intake = loadIntake();
  const creada = crearCuentaReal(bo, intake, { usuario: 'cpena', nombre: 'Camila', emails: 'c@gde.cl' });
  crearCuentaReal(bo, intake, { usuario: 'lvilchez', nombre: 'Lisseth', emails: 'l@gde.cl' });

  assert.equal(bo.CuentasPortal.gestionar(
    { operacion: 'renombrar', cuenta_id: creada.cuenta_id, usuario: 'lvilchez' }, ADMIN
  )._validationError, true, 'usuario ya en uso por otra cuenta');

  assert.equal(bo.CuentasPortal.gestionar(
    { operacion: 'renombrar', cuenta_id: creada.cuenta_id, usuario: 'ab' }, ADMIN
  )._validationError, true, 'menos de 3 caracteres');

  const ok = bo.CuentasPortal.gestionar(
    { operacion: 'renombrar', cuenta_id: creada.cuenta_id, usuario: 'CPenaNuevo' }, ADMIN
  );
  assert.equal(ok.usuario, 'cpenanuevo', 'se normaliza a minusculas');

  sincronizarCuenta(bo, intake, creada.cuenta_id);
  assert.equal(intake.Portal.login({ usuario: 'cpena', password: creada.password_temporal })._forbidden, true);
  const relogin = intake.Portal.login({ usuario: 'cpenanuevo', password: creada.password_temporal });
  assert.ok(relogin.token, 'el usuario nuevo entra con la misma clave');
});

test('asignar_password: exige minimo 8, y deja entrar con la clave EXACTA elegida por el Admin', () => {
  const bo = loadBackoffice();
  const intake = loadIntake();
  const creada = crearCuentaReal(bo, intake, { usuario: 'cpena', nombre: 'Camila', emails: 'c@gde.cl' });

  assert.equal(bo.CuentasPortal.gestionar(
    { operacion: 'asignar_password', cuenta_id: creada.cuenta_id, password: 'corta' }, ADMIN
  )._validationError, true);

  const res = bo.CuentasPortal.gestionar(
    { operacion: 'asignar_password', cuenta_id: creada.cuenta_id, password: 'ClaveElegidaPorElAdmin' }, ADMIN
  );
  assert.equal(res.password, 'ClaveElegidaPorElAdmin');

  sincronizarCuenta(bo, intake, creada.cuenta_id);
  // La temporal generada al crear deja de servir; la elegida por el Admin si.
  assert.equal(intake.Portal.login({ usuario: 'cpena', password: creada.password_temporal })._forbidden, true);
  const login = intake.Portal.login({ usuario: 'cpena', password: 'ClaveElegidaPorElAdmin' });
  assert.ok(login.token);
});

test('eliminar: borra la cuenta de verdad y mata cualquier sesion viva, no solo la desactiva', () => {
  const bo = loadBackoffice();
  const intake = loadIntake();
  const creada = crearCuentaReal(bo, intake, { usuario: 'cpena', nombre: 'Camila', emails: 'c@gde.cl' });

  const { token } = intake.Portal.login({ usuario: 'cpena', password: creada.password_temporal });
  assert.ok(token);
  // La sesion tambien vive (copiada) en la hoja del Backoffice, como en
  // produccion (misma planilla) -- se sincroniza para simular eso.
  const filaSesion = intake.leerFilas_('SESIONES_PORTAL').find((s) => s.token === token);
  bo.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SESIONES_PORTAL')
    .appendRow(bo.COLUMNAS.SESIONES_PORTAL.map((col) => (filaSesion[col] !== undefined ? filaSesion[col] : '')));

  const res = bo.CuentasPortal.gestionar({ operacion: 'eliminar', cuenta_id: creada.cuenta_id }, ADMIN);
  assert.equal(res.eliminada, true);
  assert.equal(bo.leerFilas_('CUENTAS_PORTAL').length, 0);
  assert.equal(bo.leerFilas_('SESIONES_PORTAL').length, 0, 'la sesion viva tambien se borra');

  assert.equal(bo.CuentasPortal.listar({}, ADMIN).cuentas.length, 0);
  assert.equal(bo.CuentasPortal.gestionar(
    { operacion: 'eliminar', cuenta_id: creada.cuenta_id }, ADMIN
  )._validationError, true, 'eliminar de nuevo no encuentra la cuenta');
});

test('solo ADM puede renombrar/asignar_password/eliminar', () => {
  const bo = loadBackoffice();
  const intake = loadIntake();
  const creada = crearCuentaReal(bo, intake, { usuario: 'cpena', nombre: 'Camila', emails: 'c@gde.cl' });
  const NO_ADMIN = { email: 'dev@rld.cl', rol: 'DEV' };

  ['renombrar', 'asignar_password', 'eliminar'].forEach((operacion) => {
    const res = bo.CuentasPortal.gestionar(
      { operacion: operacion, cuenta_id: creada.cuenta_id, usuario: 'x', password: 'algolargo123' }, NO_ADMIN
    );
    assert.equal(res._forbidden, true, operacion + ' debe rechazar a un rol distinto de ADM');
  });
});
