'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadGasProject } = require('./helpers/gasSandbox');

function loadUtils() {
  return loadGasProject([path.join(__dirname, '..', 'backoffice', 'Utils.gs')]);
}

const TZ = 'America/Santiago';

test('un dia laboral completo (09:00-18:00) cuenta 9 horas', () => {
  const ctx = loadUtils();
  const inicio = ctx.instanteLocal_('2026-07-06', 9, 0, TZ); // lunes
  const fin = ctx.instanteLocal_('2026-07-06', 18, 0, TZ);
  assert.equal(ctx.Utils.horasHabilesEntre(inicio, fin, { timezone: TZ }), 9);
});

test('un intervalo dentro de la jornada del mismo dia se cuenta completo', () => {
  const ctx = loadUtils();
  const inicio = ctx.instanteLocal_('2026-07-06', 10, 0, TZ);
  const fin = ctx.instanteLocal_('2026-07-06', 12, 30, TZ);
  assert.equal(ctx.Utils.horasHabilesEntre(inicio, fin, { timezone: TZ }), 2.5);
});

test('horas fuera de jornada (antes de 09:00 o despues de 18:00) no cuentan', () => {
  const ctx = loadUtils();
  const inicio = ctx.instanteLocal_('2026-07-06', 6, 0, TZ); // antes de jornada
  const fin = ctx.instanteLocal_('2026-07-06', 20, 0, TZ); // despues de jornada
  assert.equal(ctx.Utils.horasHabilesEntre(inicio, fin, { timezone: TZ }), 9);
});

test('cruce de fin de semana: solo cuentan las horas habiles de los dias laborales', () => {
  const ctx = loadUtils();
  const viernes17 = ctx.instanteLocal_('2026-07-10', 17, 0, TZ); // viernes
  const lunes10 = ctx.instanteLocal_('2026-07-13', 10, 0, TZ); // lunes
  // 1h viernes (17-18) + 1h lunes (9-10) = 2h; sabado y domingo no cuentan.
  assert.equal(ctx.Utils.horasHabilesEntre(viernes17, lunes10, { timezone: TZ }), 2);
});

test('los feriados de CONFIG_FERIADOS se excluyen del conteo', () => {
  const ctx = loadUtils();
  const lunes9 = ctx.instanteLocal_('2026-09-14', 9, 0, TZ); // lunes
  const martes18 = ctx.instanteLocal_('2026-09-15', 18, 0, TZ); // martes
  const feriados = ['2026-09-15'];
  // Sin feriado serian 18h (2 dias completos); con el martes feriado, 9h.
  assert.equal(ctx.Utils.horasHabilesEntre(lunes9, martes18, { timezone: TZ, feriados: [] }), 18);
  assert.equal(ctx.Utils.horasHabilesEntre(lunes9, martes18, { timezone: TZ, feriados: feriados }), 9);
});

test('las pausas (S06) se restan del total de horas habiles', () => {
  const ctx = loadUtils();
  const inicio = ctx.instanteLocal_('2026-07-06', 9, 0, TZ);
  const fin = ctx.instanteLocal_('2026-07-06', 18, 0, TZ);
  const pausaInicio = ctx.instanteLocal_('2026-07-06', 11, 0, TZ);
  const pausaFin = ctx.instanteLocal_('2026-07-06', 13, 0, TZ);

  const horas = ctx.Utils.horasHabilesEntre(inicio, fin, {
    timezone: TZ,
    pausas: [{ inicio: pausaInicio, fin: pausaFin }]
  });

  assert.equal(horas, 7); // 9h brutas - 2h de pausa
});

test('una pausa fuera de jornada (ej. de noche) no resta horas habiles', () => {
  const ctx = loadUtils();
  const inicio = ctx.instanteLocal_('2026-07-06', 9, 0, TZ);
  const fin = ctx.instanteLocal_('2026-07-07', 18, 0, TZ);
  const pausaInicio = ctx.instanteLocal_('2026-07-06', 20, 0, TZ);
  const pausaFin = ctx.instanteLocal_('2026-07-06', 23, 0, TZ);

  const horas = ctx.Utils.horasHabilesEntre(inicio, fin, {
    timezone: TZ,
    pausas: [{ inicio: pausaInicio, fin: pausaFin }]
  });

  assert.equal(horas, 18); // 2 dias completos, la pausa nocturna no se solapa con la jornada
});

test('el calculo cruza correctamente el cambio de horario de verano (fin del DST en abril)', () => {
  const ctx = loadUtils();
  // Comprobamos primero que el offset de la zona efectivamente cambia entre estas fechas.
  const offsetAntes = ctx.offsetMinutos_(new Date('2026-04-01T12:00:00Z'), TZ);
  const offsetDespues = ctx.offsetMinutos_(new Date('2026-04-10T12:00:00Z'), TZ);
  assert.notEqual(offsetAntes, offsetDespues, 'el fixture asume que Chile cambia de horario entre estas fechas');

  const viernes = ctx.instanteLocal_('2026-04-03', 14, 0, TZ); // viernes, antes del cambio
  const lunes = ctx.instanteLocal_('2026-04-06', 11, 0, TZ); // lunes, despues del cambio
  // 4h viernes (14-18) + 2h lunes (9-11) = 6h, sin importar el cambio de horario en el fin de semana.
  assert.equal(ctx.Utils.horasHabilesEntre(viernes, lunes, { timezone: TZ }), 6);
});

test('si fin es anterior o igual a inicio, devuelve 0', () => {
  const ctx = loadUtils();
  const inicio = ctx.instanteLocal_('2026-07-06', 12, 0, TZ);
  const fin = ctx.instanteLocal_('2026-07-06', 10, 0, TZ);
  assert.equal(ctx.Utils.horasHabilesEntre(inicio, fin, { timezone: TZ }), 0);
  assert.equal(ctx.Utils.horasHabilesEntre(inicio, inicio, { timezone: TZ }), 0);
});

test('acepta fechas como string ISO ademas de objetos Date', () => {
  const ctx = loadUtils();
  const inicio = ctx.instanteLocal_('2026-07-06', 9, 0, TZ).toISOString();
  const fin = ctx.instanteLocal_('2026-07-06', 11, 0, TZ).toISOString();
  assert.equal(ctx.Utils.horasHabilesEntre(inicio, fin, { timezone: TZ }), 2);
});
