'use strict';

/**
 * Prueba de portabilidad: los mismos escenarios de backend/test/
 * utils-horas-habiles-cache.test.js (memoizacion de Intl.DateTimeFormat e
 * instanteLocal_), corridos contra backend/logica/utils.js. Fija lo que
 * hace que sea rapido (los objetos caros se reusan) y, sobre todo, que el
 * resultado NO cambia por memoizar.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Utils = require('../logica/utils');

test('los formateadores de Intl se construyen una sola vez por zona', () => {
  const a = Utils.formateadorOffset_('America/Santiago');
  const b = Utils.formateadorOffset_('America/Santiago');
  assert.equal(a, b, 'debe devolverse la MISMA instancia');

  const otra = Utils.formateadorOffset_('UTC');
  assert.notEqual(a, otra, 'cada zona necesita el suyo');

  const d1 = Utils.formateadorDia_('America/Santiago');
  assert.equal(d1, Utils.formateadorDia_('America/Santiago'));
});

test('instanteLocal_ memoiza pero devuelve un Date nuevo cada vez', () => {
  const a = Utils.instanteLocal_('2026-03-10', 9, 0, 'America/Santiago');
  const b = Utils.instanteLocal_('2026-03-10', 9, 0, 'America/Santiago');

  assert.equal(a.getTime(), b.getTime(), 'el mismo dia y hora es el mismo instante');
  assert.notEqual(a, b, 'pero deben ser objetos distintos');

  a.setFullYear(1999);
  const c = Utils.instanteLocal_('2026-03-10', 9, 0, 'America/Santiago');
  assert.equal(c.getTime(), b.getTime(), 'mutar el devuelto no puede contaminar el cache');
});

test('el resultado del calculo NO cambio con la memoizacion', () => {
  const H = Utils.horasHabilesEntre;

  assert.equal(H('2026-03-10T12:00:00Z', '2026-03-10T21:00:00Z'), 9);

  const vieSabDomLun = H('2026-03-13T12:00:00Z', '2026-03-16T21:00:00Z');
  assert.equal(vieSabDomLun, 18, 'viernes completo + lunes completo, sin sabado ni domingo');

  const conFeriado = H('2026-03-10T12:00:00Z', '2026-03-11T21:00:00Z', { feriados: ['2026-03-11'] });
  assert.equal(conFeriado, 9, 'el dia feriado no aporta horas');

  assert.equal(H('2026-03-10T21:00:00Z', '2026-03-10T12:00:00Z'), 0);
  assert.equal(H('', '2026-03-10T12:00:00Z'), 0);
});

test('llamar doscientas veces da exactamente lo mismo que llamar una', () => {
  const H = Utils.horasHabilesEntre;
  const esperado = H('2026-01-05T12:00:00Z', '2026-09-05T21:00:00Z');
  for (let i = 0; i < 200; i++) {
    assert.equal(H('2026-01-05T12:00:00Z', '2026-09-05T21:00:00Z'), esperado);
  }
});
