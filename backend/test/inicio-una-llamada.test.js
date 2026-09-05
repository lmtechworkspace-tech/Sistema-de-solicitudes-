'use strict';

/**
 * M-02: la pantalla de Inicio en una sola llamada.
 *
 * Inicio pedía hasta siete cosas a la vez. En Apps Script cada llamada es un
 * viaje de 300 ms a 2 s, así que la primera pantalla que ve todo el mundo
 * tardaba segundos en asentarse.
 *
 * Lo que se prueba aquí es lo que puede romperse de forma silenciosa:
 *
 *   · Que una fuente que falla NO se lleve a las demás. El frontend envolvía
 *     cada llamada en su propio .catch justamente para eso; al juntarlas, esa
 *     garantía se movió al servidor y hay que sostenerla.
 *   · Que los permisos no se relajen. Juntar varias consultas bajo una acción
 *     sin gate propio sería la forma más fácil de abrir una puerta sin darse
 *     cuenta.
 *
 * NOVEDADES no entra en esta acción a propósito: su feed ya lo pide el badge
 * del menú lateral y el cliente lo memoiza con un TTL. Traerlo aquí haría que
 * el servidor calculara lo mismo dos veces.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function ctxBase() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'x', SIGSO_DRIVE_ROOT_FOLDER_ID: 'y' } });
  Object.keys(ctx.COLUMNAS).forEach((h) => { try { seedSheet(ctx, h, ctx.COLUMNAS[h]); } catch (e) {} });
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Ada Admin', 'adm@x.cl', 'HP', 'ADM', true, '', 'sistema'],
    ['U2', 'Dev Uno', 'dev@x.cl', 'HP', 'DEV', true, '', 'sistema']
  ]);
  return ctx;
}

const ADM = { email: 'adm@x.cl', nombre: 'Ada Admin', rol: 'ADM' };
const TODOS = ['mi_trabajo', 'calidad', 'bandeja', 'jefatura', 'pausas'];

test('solo trae los bloques que se piden', () => {
  const ctx = ctxBase();
  const r = toPlain(ctx.Inicio.getResumen({ bloques: ['mi_trabajo', 'pausas'] }, ADM));

  assert.deepEqual(Object.keys(r.bloques).sort(), ['mi_trabajo', 'pausas']);
  assert.equal(r.bloques.calidad, undefined, 'no debe traer lo que nadie pidió');
});

test('sin lista de bloques no trae ninguno', () => {
  // Un Inicio que adivina qué mostrar es un Inicio que se equivoca, y además
  // pagaría seis consultas para tirarlas.
  const ctx = ctxBase();
  assert.deepEqual(toPlain(ctx.Inicio.getResumen({}, ADM)).bloques, {});
  assert.deepEqual(toPlain(ctx.Inicio.getResumen(null, ADM)).bloques, {});
});

test('cada bloque llega con la misma forma que tenía su acción suelta', () => {
  const ctx = ctxBase();
  const r = toPlain(ctx.Inicio.getResumen({ bloques: TODOS }, ADM));

  TODOS.forEach((b) => {
    assert.ok(r.bloques[b], 'falta el bloque ' + b);
    assert.equal(typeof r.bloques[b].ok, 'boolean',
      'cada bloque tiene que traer {ok, data} como traía su acción: así los ' +
      'pintores del frontend no cambian');
  });
});

test('una fuente que revienta NO se lleva a las demás', () => {
  const ctx = ctxBase();
  // Se rompe una a propósito. Antes, cada llamada tenía su propio .catch en
  // el frontend; al juntarlas, si esto no se aísla, un error en las pausas
  // deja a la persona sin tareas, sin novedades y sin tablero.
  ctx.Pausas.getPausaHoyTrabajador = function () { throw new Error('fallo simulado'); };

  const r = toPlain(ctx.Inicio.getResumen({ bloques: TODOS }, ADM));

  assert.equal(r.bloques.pausas.ok, false, 'la que falló se marca como fallida');
  assert.ok(r.bloques.mi_trabajo.ok, 'y las demás llegan igual');
  assert.ok(r.bloques.calidad.ok);
  assert.ok(r.bloques.bandeja.ok);
});

test('un bloque rechazado por permisos vuelve como {ok:false}, no como datos', () => {
  const ctx = ctxBase();
  // Se simula el rechazo que el propio módulo produce para quien no puede.
  ctx.Jefatura.getPanel = function () { return { _forbidden: true, message: 'No tienes acceso.' }; };

  const r = toPlain(ctx.Inicio.getResumen({ bloques: ['jefatura', 'calidad'] }, ADM));

  assert.equal(r.bloques.jefatura.ok, false);
  assert.equal(r.bloques.jefatura.data, undefined, 'un rechazo no puede traer datos adjuntos');
  assert.ok(r.bloques.calidad.ok, 'y no contamina al resto');
});

test('getInicio NO decide permisos: delega en quien ya los decidía', () => {
  // Es la garantía que impide que juntar seis consultas abra una puerta. Se
  // comprueba que cada bloque pasa por la función del módulo, con su contexto.
  const ctx = ctxBase();
  const vistos = [];
  ['Actividades.listar', 'Calidad.listarDocumentos', 'Dashboard.getData',
    'Jefatura.getPanel', 'Pausas.getPausaHoyTrabajador'].forEach((ruta) => {
    const [obj, met] = ruta.split('.');
    const original = ctx[obj][met];
    ctx[obj][met] = function (data, contexto) {
      vistos.push({ ruta, email: contexto && contexto.email, rol: contexto && contexto.rol });
      return original.apply(this, arguments);
    };
  });

  toPlain(ctx.Inicio.getResumen({ bloques: TODOS }, ADM));

  assert.equal(vistos.length, 5, 'los cinco bloques deben delegar');
  vistos.forEach((v) => {
    assert.equal(v.email, 'adm@x.cl', v.ruta + ' recibió otro email');
    assert.equal(v.rol, 'ADM', v.ruta + ' recibió otro rol: el contexto debe pasar intacto');
  });
});

test('mi_trabajo se pide con el correo de quien mira, no con el de otro', () => {
  const ctx = ctxBase();
  let recibido = null;
  const original = ctx.Actividades.listar;
  ctx.Actividades.listar = function (data, contexto) { recibido = data; return original.apply(this, arguments); };

  toPlain(ctx.Inicio.getResumen({ bloques: ['mi_trabajo'] }, { email: 'dev@x.cl', rol: 'DEV' }));

  assert.equal(recibido.responsable_email, 'dev@x.cl');
});
