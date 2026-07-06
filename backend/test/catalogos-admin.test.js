'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'CAT_EMPRESAS', ctx.COLUMNAS.CAT_EMPRESAS);
  seedSheet(ctx, 'CAT_PLATAFORMAS', ctx.COLUMNAS.CAT_PLATAFORMAS);
  seedSheet(ctx, 'CAT_MODULOS', ctx.COLUMNAS.CAT_MODULOS);
  seedSheet(ctx, 'CAT_TIPOS', ctx.COLUMNAS.CAT_TIPOS);
  return ctx;
}

test('Catalogos.guardar (Admin) crea una empresa nueva', () => {
  const ctx = loadConSchema();
  const resultado = ctx.Catalogos.guardar(
    { tipo: 'EMPRESA', registro: { empresa_id: 'HP', nombre: 'HomePymes', logo: 'https://x.cl/logo.png', activo: true } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );

  assert.equal(resultado.empresa_id, 'HP');
  const empresas = ctx.leerFilas_('CAT_EMPRESAS');
  assert.equal(empresas.length, 1);
  assert.equal(empresas[0].logo, 'https://x.cl/logo.png');
});

test('Catalogos.guardar (Admin) actualiza una empresa existente en vez de duplicarla', () => {
  const ctx = loadConSchema();
  ctx.Catalogos.guardar(
    { tipo: 'EMPRESA', registro: { empresa_id: 'HP', nombre: 'HomePymes', logo: '', activo: true } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );
  ctx.Catalogos.guardar(
    { tipo: 'EMPRESA', registro: { empresa_id: 'HP', nombre: 'HomePymes', logo: '', activo: false } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );

  const empresas = ctx.leerFilas_('CAT_EMPRESAS');
  assert.equal(empresas.length, 1);
  assert.equal(empresas[0].activo, false);
});

test('Catalogos.guardar rechaza EMPRESA/PLATAFORMA para el rol Analista', () => {
  const ctx = loadConSchema();
  const resultado = ctx.Catalogos.guardar(
    { tipo: 'EMPRESA', registro: { empresa_id: 'HP', nombre: 'HomePymes', activo: true } },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(resultado._forbidden, true);
});

test('Catalogos.guardar permite MODULO/TIPO para el rol Analista (nivel basico)', () => {
  const ctx = loadConSchema();
  const resultado = ctx.Catalogos.guardar(
    { tipo: 'MODULO', registro: { modulo_id: 'MOD_X', nombre: 'Modulo X', plataforma_id: 'ERP', activo: true } },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(resultado.modulo_id, 'MOD_X');
});

test('Catalogos.guardar responde error de validacion sin el identificador del registro', () => {
  const ctx = loadConSchema();
  const resultado = ctx.Catalogos.guardar(
    { tipo: 'EMPRESA', registro: { nombre: 'Sin id' } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );
  assert.equal(resultado._validationError, true);
});

test('Catalogos.guardar responde error de validacion para un tipo desconocido', () => {
  const ctx = loadConSchema();
  const resultado = ctx.Catalogos.guardar(
    { tipo: 'INVALIDO', registro: { id: 'x' } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );
  assert.equal(resultado._validationError, true);
});

test('Catalogos.listar devuelve activos e inactivos (a diferencia de getAll)', () => {
  const ctx = loadConSchema();
  ctx.Catalogos.guardar(
    { tipo: 'EMPRESA', registro: { empresa_id: 'HP', nombre: 'HomePymes', logo: '', activo: true } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );
  ctx.Catalogos.guardar(
    { tipo: 'EMPRESA', registro: { empresa_id: 'OLD', nombre: 'De baja', logo: '', activo: false } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );

  const lista = ctx.Catalogos.listar({ tipo: 'EMPRESA' }, { email: 'admin@homepymes.cl', rol: 'ADM' });
  assert.equal(lista.length, 2);
});

test('doPost action=guardarCatalogo responde ok:true end-to-end', () => {
  const ctx = loadConSchema();
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Admin', 'admin@homepymes.cl', 'HP', 'ADM', true, '', 'sistema']
  ]);
  ctx.Session = { getActiveUser: () => ({ getEmail: () => 'admin@homepymes.cl' }) };

  const output = ctx.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'guardarCatalogo',
        data: { tipo: 'TIPO', registro: { tipo_id: 'ERR', nombre: 'Error', prioridad_default: 'P2', activo: true } }
      })
    }
  });
  const parsed = JSON.parse(output.getContent());

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.tipo_id, 'ERR');
});
