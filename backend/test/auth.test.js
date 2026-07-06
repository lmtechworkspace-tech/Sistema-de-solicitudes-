'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function loadConSchema(usuarios) {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, usuarios || []);
  return ctx;
}

test('gestionarUsuario (Admin) crea un usuario nuevo', () => {
  const ctx = loadConSchema();
  const resultado = ctx.Auth.gestionarUsuario(
    { email: 'nuevo@homepymes.cl', nombre: 'Nuevo', empresa_id: 'HP', rol: 'ANA' },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );

  assert.equal(resultado.email, 'nuevo@homepymes.cl');
  assert.equal(resultado.activo, true);
  const usuarios = ctx.leerFilas_('USUARIOS');
  assert.equal(usuarios.length, 1);
});

test('gestionarUsuario rechaza si quien llama no es Admin', () => {
  const ctx = loadConSchema();
  const resultado = ctx.Auth.gestionarUsuario(
    { email: 'nuevo@homepymes.cl', empresa_id: 'HP', rol: 'ANA' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(resultado._forbidden, true);
});

test('gestionarUsuario edita un usuario existente en vez de duplicarlo', () => {
  const ctx = loadConSchema([
    ['U1', 'Ana', 'ana@homepymes.cl', 'HP', 'ANA', true, '', 'sistema']
  ]);
  const resultado = ctx.Auth.gestionarUsuario(
    { email: 'ana@homepymes.cl', nombre: 'Ana Actualizada' },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );

  assert.equal(resultado.nombre, 'Ana Actualizada');
  assert.equal(ctx.leerFilas_('USUARIOS').length, 1);
});

test('gestionarUsuario (RN-030): no permite desactivar al ultimo Admin activo de una empresa', () => {
  const ctx = loadConSchema([
    ['U1', 'Admin Uno', 'admin1@homepymes.cl', 'HP', 'ADM', true, '', 'sistema']
  ]);
  const resultado = ctx.Auth.gestionarUsuario(
    { email: 'admin1@homepymes.cl', activo: false },
    { email: 'otro-admin@homepymes.cl', rol: 'ADM' }
  );
  assert.equal(resultado._validationError, true);
});

test('gestionarUsuario (RN-030): permite desactivar un Admin si queda otro activo', () => {
  const ctx = loadConSchema([
    ['U1', 'Admin Uno', 'admin1@homepymes.cl', 'HP', 'ADM', true, '', 'sistema'],
    ['U2', 'Admin Dos', 'admin2@homepymes.cl', 'HP', 'ADM', true, '', 'sistema']
  ]);
  const resultado = ctx.Auth.gestionarUsuario(
    { email: 'admin1@homepymes.cl', activo: false },
    { email: 'admin2@homepymes.cl', rol: 'ADM' }
  );
  assert.equal(resultado.activo, false);
});

test('gestionarUsuario (RN-030): tambien aplica al bajar el rol de Admin a otro rol', () => {
  const ctx = loadConSchema([
    ['U1', 'Admin Uno', 'admin1@homepymes.cl', 'HP', 'ADM', true, '', 'sistema']
  ]);
  const resultado = ctx.Auth.gestionarUsuario(
    { email: 'admin1@homepymes.cl', rol: 'ANA' },
    { email: 'otro@homepymes.cl', rol: 'ADM' }
  );
  assert.equal(resultado._validationError, true);
});

test('gestionarUsuario responde error de validacion si falta empresa_id al crear', () => {
  const ctx = loadConSchema();
  const resultado = ctx.Auth.gestionarUsuario(
    { email: 'nuevo@homepymes.cl', rol: 'ANA' },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );
  assert.equal(resultado._validationError, true);
});

test('listarUsuarios (Admin) devuelve todos los usuarios', () => {
  const ctx = loadConSchema([
    ['U1', 'Ana', 'ana@homepymes.cl', 'HP', 'ANA', true, '', 'sistema'],
    ['U2', 'Dev', 'dev@homepymes.cl', 'HP', 'DEV', false, '', 'sistema']
  ]);
  const lista = ctx.Auth.listarUsuarios({}, { email: 'admin@homepymes.cl', rol: 'ADM' });
  assert.equal(lista.length, 2);
});

test('listarUsuarios rechaza roles distintos de Admin', () => {
  const ctx = loadConSchema();
  const resultado = ctx.Auth.listarUsuarios({}, { email: 'analista@homepymes.cl', rol: 'ANA' });
  assert.equal(resultado._forbidden, true);
});

test('doPost action=gestionarUsuario responde ok:true end-to-end', () => {
  const ctx = loadConSchema([
    ['U1', 'Admin', 'admin@homepymes.cl', 'HP', 'ADM', true, '', 'sistema']
  ]);
  ctx.Session = { getActiveUser: () => ({ getEmail: () => 'admin@homepymes.cl' }) };

  const output = ctx.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'gestionarUsuario',
        data: { email: 'nuevo@homepymes.cl', nombre: 'Nuevo', empresa_id: 'HP', rol: 'DEV' }
      })
    }
  });
  const parsed = JSON.parse(output.getContent());

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.email, 'nuevo@homepymes.cl');
});
