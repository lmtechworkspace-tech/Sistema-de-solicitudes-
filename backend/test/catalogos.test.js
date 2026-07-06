'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadIntakeProject, seedSheet } = require('./helpers/gasSandbox');

test('Catalogos.getAll devuelve solo entradas activas de cada catalogo', () => {
  const ctx = loadIntakeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });

  seedSheet(ctx, 'CAT_EMPRESAS', ctx.COLUMNAS.CAT_EMPRESAS, [
    ['HP', 'HomePymes', 'https://drive.mock/logo-hp.png', true],
    ['RLD', 'RLD', 'https://drive.mock/logo-rld.png', true],
    ['OLD', 'Empresa dada de baja', '', false]
  ]);
  seedSheet(ctx, 'CAT_PLATAFORMAS', ctx.COLUMNAS.CAT_PLATAFORMAS, [
    ['ERP', 'ERP', 'HP', 'https://erp.hp.cl', true]
  ]);
  seedSheet(ctx, 'CAT_MODULOS', ctx.COLUMNAS.CAT_MODULOS, [
    ['FACT', 'Facturacion', 'ERP', true],
    ['LEGACY', 'Modulo viejo', 'ERP', false]
  ]);
  seedSheet(ctx, 'CAT_TIPOS', ctx.COLUMNAS.CAT_TIPOS, [
    ['ERR', 'Error', 'P2', true],
    ['MOD', 'Modificacion', 'P3', true]
  ]);

  const catalogos = ctx.Catalogos.getAll();

  assert.equal(catalogos.empresas.length, 2);
  assert.ok(catalogos.empresas.every((e) => e.activo === true));
  assert.equal(catalogos.plataformas.length, 1);
  assert.equal(catalogos.modulos.length, 1);
  assert.equal(catalogos.modulos[0].modulo_id, 'FACT');
  assert.equal(catalogos.tipos.length, 2);
});

test('doPost action=getCatalogos responde ok:true con los catalogos activos', () => {
  const ctx = loadIntakeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'CAT_EMPRESAS', ctx.COLUMNAS.CAT_EMPRESAS, [['HP', 'HomePymes', '', true]]);
  seedSheet(ctx, 'CAT_PLATAFORMAS', ctx.COLUMNAS.CAT_PLATAFORMAS, []);
  seedSheet(ctx, 'CAT_MODULOS', ctx.COLUMNAS.CAT_MODULOS, []);
  seedSheet(ctx, 'CAT_TIPOS', ctx.COLUMNAS.CAT_TIPOS, []);

  const output = ctx.doPost({
    postData: { contents: JSON.stringify({ action: 'getCatalogos', data: {} }) }
  });
  const parsed = JSON.parse(output.getContent());

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.empresas.length, 1);
});
