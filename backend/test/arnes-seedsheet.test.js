'use strict';

/**
 * El arnés de pruebas, probado.
 *
 * `seedSheet` añadía la fila de encabezados en CADA llamada. Como el patrón
 * habitual de estos tests es sembrar todas las hojas de COLUMNAS y después
 * sembrar con datos las dos o tres que interesan, la segunda llamada dejaba
 * un encabezado haciéndose pasar por dato: un usuario con el correo "email",
 * una subsolicitud con el estado "estado".
 *
 * Casi siempre se caía sola —ningún filtro por correo, fecha o estado acepta
 * esos valores— y por eso pasó desapercibido en 17 archivos de test. Pero
 * cualquier lectura de hoja completa contaba una fila de más. Apareció
 * midiendo: un panel devolvía 51 ítems con 50 sembrados.
 *
 * Un arnés que miente es peor que un test que falta: todo lo que se apoya en
 * él hereda la mentira sin que nadie lo revise. De ahí este archivo.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function ctxLimpio() {
  return loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'x', SIGSO_DRIVE_ROOT_FOLDER_ID: 'y' } });
}

const ADA = ['U1', 'Ada Admin', 'ada@x.cl', 'HP', 'ADM', true, '', 'sistema'];
const BEN = ['U2', 'Ben Dev', 'ben@x.cl', 'HP', 'DEV', true, '', 'sistema'];

test('sembrar la misma hoja dos veces NO deja un encabezado como dato', () => {
  // El patrón exacto que usan los tests del repo.
  const ctx = ctxLimpio();
  Object.keys(ctx.COLUMNAS).forEach((h) => { try { seedSheet(ctx, h, ctx.COLUMNAS[h]); } catch (e) {} });
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [ADA]);

  const filas = ctx.leerFilas_('USUARIOS');
  assert.equal(filas.length, 1, 'una fila sembrada tiene que leerse como una fila');
  assert.equal(filas[0].email, 'ada@x.cl');
  assert.ok(!filas.some((f) => f.email === 'email'),
    'un usuario cuyo correo es la palabra "email" es la fila de encabezados colada como dato');
});

test('la segunda siembra AÑADE sus filas, no las pierde', () => {
  // La otra mitad: al dejar de escribir el encabezado no puede perderse lo
  // que sí es dato.
  const ctx = ctxLimpio();
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [ADA]);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [BEN]);

  const correos = ctx.leerFilas_('USUARIOS').map((f) => f.email).sort();
  assert.deepEqual(correos, ['ada@x.cl', 'ben@x.cl']);
});

test('una hoja nueva sí recibe sus encabezados', () => {
  // Si la guarda se pasara de lista y nunca escribiera el encabezado, las
  // filas no se podrían mapear a columnas y TODO devolvería objetos vacíos.
  const ctx = ctxLimpio();
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [ADA]);

  const filas = ctx.leerFilas_('USUARIOS');
  assert.equal(filas.length, 1);
  assert.equal(filas[0].nombre, 'Ada Admin', 'sin encabezados no habría nombres de campo');
});

test('sembrar sin filas deja la hoja vacía, no con una fila', () => {
  const ctx = ctxLimpio();
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS);

  assert.deepEqual(ctx.leerFilas_('USUARIOS'), []);
});
