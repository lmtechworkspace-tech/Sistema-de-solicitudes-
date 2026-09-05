'use strict';

/**
 * El panel de Gerencia tardaba 14,9 SEGUNDOS de CPU con 900 subsolicitudes, y
 * `Utils.horasHabilesEntre` se llevaba el 100% de ese tiempo.
 *
 * La causa era construir un `Intl.DateTimeFormat` nuevo en cada resolución de
 * zona horaria. horasHabilesBrutas_ recorre el rango día por día y pide cuatro
 * de esos por día, así que una subsolicitud de enero mirada en septiembre
 * costaba unas mil construcciones. Por novecientas subsolicitudes, casi un
 * millón.
 *
 * Memoizando los formateadores y los instantes de jornada quedó 37× más
 * rápido, con el mismo resultado.
 *
 * NO se mide tiempo aquí: un test de milisegundos es inestable y falla por el
 * ruido de la máquina. Se fija lo que hace que sea rápido -- que los objetos
 * caros se reusen -- y, sobre todo, que el resultado NO cambió.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject } = require('./helpers/gasSandbox');

function ctxUtils() {
  return loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'x', SIGSO_DRIVE_ROOT_FOLDER_ID: 'y' } });
}

test('los formateadores de Intl se construyen una sola vez por zona', () => {
  const ctx = ctxUtils();
  assert.equal(typeof ctx.formateadorOffset_, 'function', 'falta el formateador memoizado de offset');
  assert.equal(typeof ctx.formateadorDia_, 'function', 'falta el formateador memoizado de día');

  const a = ctx.formateadorOffset_('America/Santiago');
  const b = ctx.formateadorOffset_('America/Santiago');
  assert.equal(a, b, 'debe devolverse la MISMA instancia: construir uno nuevo es lo que costaba los segundos');

  const otra = ctx.formateadorOffset_('UTC');
  assert.notEqual(a, otra, 'cada zona necesita el suyo');

  const d1 = ctx.formateadorDia_('America/Santiago');
  assert.equal(d1, ctx.formateadorDia_('America/Santiago'));
});

test('instanteLocal_ memoiza pero devuelve un Date nuevo cada vez', () => {
  const ctx = ctxUtils();
  const a = ctx.instanteLocal_('2026-03-10', 9, 0, 'America/Santiago');
  const b = ctx.instanteLocal_('2026-03-10', 9, 0, 'America/Santiago');

  assert.equal(a.getTime(), b.getTime(), 'el mismo día y hora es el mismo instante');
  assert.notEqual(a, b,
    'pero deben ser objetos distintos: un Date compartido que alguien mute ' +
    'convertiría el caché en una fuente de errores raros');

  a.setFullYear(1999);
  const c = ctx.instanteLocal_('2026-03-10', 9, 0, 'America/Santiago');
  assert.equal(c.getTime(), b.getTime(), 'mutar el devuelto no puede contaminar el caché');
});

test('el resultado del cálculo NO cambió con la memoización', () => {
  const ctx = ctxUtils();
  const H = ctx.Utils.horasHabilesEntre;

  // Un martes 09:00 a las 18:00 del mismo día: la jornada completa.
  assert.equal(H('2026-03-10T12:00:00Z', '2026-03-10T21:00:00Z'), 9);

  // Cruce de fin de semana: viernes a lunes cuenta solo los hábiles.
  const vieSabDomLun = H('2026-03-13T12:00:00Z', '2026-03-16T21:00:00Z');
  assert.equal(vieSabDomLun, 18, 'viernes completo + lunes completo, sin sábado ni domingo');

  // Un feriado se excluye.
  const conFeriado = H('2026-03-10T12:00:00Z', '2026-03-11T21:00:00Z', { feriados: ['2026-03-11'] });
  assert.equal(conFeriado, 9, 'el día feriado no aporta horas');

  // Fin anterior al inicio, y fecha inválida: cero, sin lanzar.
  assert.equal(H('2026-03-10T21:00:00Z', '2026-03-10T12:00:00Z'), 0);
  assert.equal(H('', '2026-03-10T12:00:00Z'), 0);
});

test('llamar doscientas veces da exactamente lo mismo que llamar una', () => {
  // Es la garantía que importa del caché: que no acumule estado que altere
  // resultados a partir de la segunda vuelta.
  const ctx = ctxUtils();
  const H = ctx.Utils.horasHabilesEntre;
  const esperado = H('2026-01-05T12:00:00Z', '2026-09-05T21:00:00Z');
  for (let i = 0; i < 200; i++) {
    assert.equal(H('2026-01-05T12:00:00Z', '2026-09-05T21:00:00Z'), esperado);
  }
});
