'use strict';

/**
 * Prueba de portabilidad: los mismos escenarios de backend/test/
 * utils-horas-habiles.test.js, corridos contra backend/logica/utils.js.
 * Puerto casi verbatim (el .gs original ya era JS puro), asi que los mismos
 * casos deben dar exactamente el mismo resultado.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Utils = require('../logica/utils');

const TZ = 'America/Santiago';

test('un dia laboral completo (09:00-18:00) cuenta 9 horas', () => {
  const inicio = Utils.instanteLocal_('2026-07-06', 9, 0, TZ);
  const fin = Utils.instanteLocal_('2026-07-06', 18, 0, TZ);
  assert.equal(Utils.horasHabilesEntre(inicio, fin, { timezone: TZ }), 9);
});

test('un intervalo dentro de la jornada del mismo dia se cuenta completo', () => {
  const inicio = Utils.instanteLocal_('2026-07-06', 10, 0, TZ);
  const fin = Utils.instanteLocal_('2026-07-06', 12, 30, TZ);
  assert.equal(Utils.horasHabilesEntre(inicio, fin, { timezone: TZ }), 2.5);
});

test('horas fuera de jornada (antes de 09:00 o despues de 18:00) no cuentan', () => {
  const inicio = Utils.instanteLocal_('2026-07-06', 6, 0, TZ);
  const fin = Utils.instanteLocal_('2026-07-06', 20, 0, TZ);
  assert.equal(Utils.horasHabilesEntre(inicio, fin, { timezone: TZ }), 9);
});

test('cruce de fin de semana: solo cuentan las horas habiles de los dias laborales', () => {
  const viernes17 = Utils.instanteLocal_('2026-07-10', 17, 0, TZ);
  const lunes10 = Utils.instanteLocal_('2026-07-13', 10, 0, TZ);
  assert.equal(Utils.horasHabilesEntre(viernes17, lunes10, { timezone: TZ }), 2);
});

test('los feriados de CONFIG_FERIADOS se excluyen del conteo', () => {
  const lunes9 = Utils.instanteLocal_('2026-09-14', 9, 0, TZ);
  const martes18 = Utils.instanteLocal_('2026-09-15', 18, 0, TZ);
  assert.equal(Utils.horasHabilesEntre(lunes9, martes18, { timezone: TZ, feriados: [] }), 18);
  assert.equal(Utils.horasHabilesEntre(lunes9, martes18, { timezone: TZ, feriados: ['2026-09-15'] }), 9);
});

test('las pausas (S06) se restan del total de horas habiles', () => {
  const inicio = Utils.instanteLocal_('2026-07-06', 9, 0, TZ);
  const fin = Utils.instanteLocal_('2026-07-06', 18, 0, TZ);
  const pausaInicio = Utils.instanteLocal_('2026-07-06', 11, 0, TZ);
  const pausaFin = Utils.instanteLocal_('2026-07-06', 13, 0, TZ);

  const horas = Utils.horasHabilesEntre(inicio, fin, { timezone: TZ, pausas: [{ inicio: pausaInicio, fin: pausaFin }] });
  assert.equal(horas, 7);
});

test('una pausa fuera de jornada (ej. de noche) no resta horas habiles', () => {
  const inicio = Utils.instanteLocal_('2026-07-06', 9, 0, TZ);
  const fin = Utils.instanteLocal_('2026-07-07', 18, 0, TZ);
  const pausaInicio = Utils.instanteLocal_('2026-07-06', 20, 0, TZ);
  const pausaFin = Utils.instanteLocal_('2026-07-06', 23, 0, TZ);

  const horas = Utils.horasHabilesEntre(inicio, fin, { timezone: TZ, pausas: [{ inicio: pausaInicio, fin: pausaFin }] });
  assert.equal(horas, 18);
});

test('el calculo cruza correctamente el cambio de horario de verano (fin del DST en abril)', () => {
  const offsetAntes = Utils.offsetMinutos_(new Date('2026-04-01T12:00:00Z'), TZ);
  const offsetDespues = Utils.offsetMinutos_(new Date('2026-04-10T12:00:00Z'), TZ);
  assert.notEqual(offsetAntes, offsetDespues, 'el fixture asume que Chile cambia de horario entre estas fechas');

  const viernes = Utils.instanteLocal_('2026-04-03', 14, 0, TZ);
  const lunes = Utils.instanteLocal_('2026-04-06', 11, 0, TZ);
  assert.equal(Utils.horasHabilesEntre(viernes, lunes, { timezone: TZ }), 6);
});

test('si fin es anterior o igual a inicio, devuelve 0', () => {
  const inicio = Utils.instanteLocal_('2026-07-06', 12, 0, TZ);
  const fin = Utils.instanteLocal_('2026-07-06', 10, 0, TZ);
  assert.equal(Utils.horasHabilesEntre(inicio, fin, { timezone: TZ }), 0);
  assert.equal(Utils.horasHabilesEntre(inicio, inicio, { timezone: TZ }), 0);
});

test('acepta fechas como string ISO ademas de objetos Date', () => {
  const inicio = Utils.instanteLocal_('2026-07-06', 9, 0, TZ).toISOString();
  const fin = Utils.instanteLocal_('2026-07-06', 11, 0, TZ).toISOString();
  assert.equal(Utils.horasHabilesEntre(inicio, fin, { timezone: TZ }), 2);
});
