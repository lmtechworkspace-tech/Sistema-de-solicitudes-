'use strict';

/**
 * Preferencias por cuenta (2026-10-05): los fijados de la barra lateral se
 * guardan en la cuenta, solo los ve y cambia su dueña, hasta 8, sin repetir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const P = require('../logica/preferencias');
const { ejecutarAccion } = require('../server/router');

const ANA = { cuenta_id: 'C-ANA', email: 'ana@homepymes.cl', rol: 'DEV' };
const LUIS = { cuenta_id: 'C-LUIS', email: 'luis@homepymes.cl', rol: 'ADM' };
const fij = (modulo, item, nombre) => ({ modulo, item, nombre, ruta: 'Contabilidad' });

function crear() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  return db;
}

test('fijados: null hasta que la persona elige; luego los suyos y de nadie más', () => {
  const db = crear();
  assert.equal(P.obtener(db, {}, ANA).fijados, null, 'nunca eligió: la barra propone');
  const r = P.guardarFijados(db, { fijados: [fij('dep_contabilidad', 'conv', 'Seguimiento de cuotas TGR'), fij('bandeja', '', 'Bandeja')] }, ANA);
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(P.obtener(db, {}, ANA).fijados.map((f) => f.nombre), ['Seguimiento de cuotas TGR', 'Bandeja']);
  assert.equal(P.obtener(db, {}, LUIS).fijados, null, 'otra cuenta no ve los de Ana');
  // Cambiar el orden reemplaza la lista (no agrega una segunda fila).
  P.guardarFijados(db, { fijados: [fij('bandeja', '', 'Bandeja'), fij('dep_contabilidad', 'conv', 'Seguimiento de cuotas TGR')] }, ANA);
  assert.deepEqual(P.obtener(db, {}, ANA).fijados.map((f) => f.modulo), ['bandeja', 'dep_contabilidad']);
  // Una lista vacía es una elección y se respeta.
  P.guardarFijados(db, { fijados: [] }, ANA);
  assert.deepEqual(P.obtener(db, {}, ANA).fijados, []);
});

test('fijados: hasta 8, sin repetir, y solo lo que es un destino válido', () => {
  const db = crear();
  const nueve = Array.from({ length: 9 }, (_, i) => fij('calidad', 'item' + i, 'Pantalla ' + i));
  assert.match(P.guardarFijados(db, { fijados: nueve }, ANA).message, /Hasta 8/);
  const r = P.guardarFijados(db, { fijados: [
    fij('calidad', 'riesgos', 'Riesgos'), fij('calidad', 'riesgos', 'Riesgos otra vez'),
    { modulo: 'javascript:alert(1)', item: '', nombre: 'malo' }, { modulo: 'bandeja', item: '', nombre: '' }, 'texto suelto'
  ] }, ANA);
  assert.deepEqual(r.fijados.map((f) => f.nombre), ['Riesgos']);
  assert.match(P.guardarFijados(db, {}, ANA).message, /No llegó/);
});

test('fijados: sin sesión no se leen ni se guardan', async () => {
  const db = crear();
  assert.equal(P.obtener(db, {}, {})._forbidden, true);
  assert.equal(P.guardarFijados(db, { fijados: [] }, null)._forbidden, true);
  const r = await ejecutarAccion(db, 'obtenerPreferencias', { portal_token: 'no-existe' });
  assert.equal(r.status, 403);
});
