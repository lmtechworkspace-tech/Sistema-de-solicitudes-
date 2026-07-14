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
    ['FACT', 'Facturacion', 'ERP', '', true],
    ['LEGACY', 'Modulo viejo', 'ERP', '', false]
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

test('Catalogos.getClientes devuelve los clientes activos, con estado/bloqueo informativos', () => {
  const ctx = loadIntakeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'CAT_CLIENTES', ctx.COLUMNAS.CAT_CLIENTES, [
    ['CLI-1', 'Constructora Uno SpA', '76.111.111-1', 'HP-001-1', 'Juan Uno', 'juan@uno.cl', '111', 'Rep Uno', 'Calle 1', 'Activo', 'Activo', true],
    ['CLI-2', 'Bloqueada Dos SpA', '76.222.222-2', 'HP-002-1', 'Ana Dos', 'ana@dos.cl', '222', 'Rep Dos', 'Calle 2', 'Inactivo', 'Bloqueado', true],
    ['CLI-3', 'Baja Total', '76.333.333-3', 'HP-003-1', '', '', '', '', '', 'Activo', 'Activo', false]
  ]);

  const clientes = ctx.Catalogos.getClientes();
  // El de activo=false no aparece; estado/bloqueo NO filtran (el bloqueado si aparece).
  assert.equal(clientes.length, 2);
  const bloqueada = clientes.find((c) => c.cliente_id === 'CLI-2');
  assert.equal(bloqueada.bloqueo, 'Bloqueado');
  assert.equal(bloqueada.razon_social, 'Bloqueada Dos SpA');
  assert.equal(bloqueada.rut, '76.222.222-2');
});

test('Catalogos.getClientes devuelve [] si la hoja CAT_CLIENTES no existe (instalacion previa)', () => {
  const ctx = loadIntakeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  // No se siembra CAT_CLIENTES.
  const clientes = ctx.Catalogos.getClientes();
  assert.ok(Array.isArray(clientes));
  assert.equal(clientes.length, 0);
});

test('doPost action=getClientes responde ok:true con los clientes activos', () => {
  const ctx = loadIntakeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'CAT_CLIENTES', ctx.COLUMNAS.CAT_CLIENTES, [
    ['CLI-1', 'Constructora Uno SpA', '76.111.111-1', 'HP-001-1', 'Juan Uno', 'juan@uno.cl', '111', 'Rep Uno', 'Calle 1', 'Activo', 'Activo', true]
  ]);
  const output = ctx.doPost({ postData: { contents: JSON.stringify({ action: 'getClientes', data: {} }) } });
  const parsed = JSON.parse(output.getContent());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.length, 1);
  assert.equal(parsed.data[0].razon_social, 'Constructora Uno SpA');
});
