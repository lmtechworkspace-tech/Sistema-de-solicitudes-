'use strict';

/**
 * Prueba de portabilidad: los mismos escenarios de backend/test/
 * cumplimiento.test.js (Cumplimiento.clasificar), corridos contra
 * backend/logica/cumplimiento.js. Funcion pura -- no necesita SQLite.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Cumplimiento = require('../logica/cumplimiento');
const { abrirDb_, sembrarTabla_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');

function sub(overrides) {
  return Object.assign({ estado: 'S05', fecha_comprometida: '', fecha_terminada: '' }, overrides);
}

test('sin fecha_comprometida y aun activa -> SIN_COMPROMISO', () => {
  const resultado = Cumplimiento.clasificar(sub({ estado: 'S02' }));
  assert.equal(resultado.codigo, 'SIN_COMPROMISO');
  assert.equal(resultado.dias_esperando, null);
});

test('activa, comprometida y muy en el futuro -> EN_PLAZO', () => {
  const ahora = new Date('2026-08-01T10:00:00-04:00');
  const resultado = Cumplimiento.clasificar(sub({ estado: 'S05', fecha_comprometida: '2026-08-20T18:00' }), ahora);
  assert.equal(resultado.codigo, 'EN_PLAZO');
});

test('activa, a menos de 1 dia habil del compromiso -> EN_RIESGO', () => {
  const ahora = new Date('2026-08-04T10:00:00-04:00');
  const resultado = Cumplimiento.clasificar(sub({ estado: 'S05', fecha_comprometida: '2026-08-04T16:00:00-04:00' }), ahora);
  assert.equal(resultado.codigo, 'EN_RIESGO');
});

test('activa y ya paso la fecha comprometida (no entregada) -> ATRASADA_DESARROLLADOR', () => {
  const ahora = new Date('2026-08-10T10:00:00-04:00');
  const resultado = Cumplimiento.clasificar(sub({ estado: 'S05', fecha_comprometida: '2026-08-05T18:00' }), ahora);
  assert.equal(resultado.codigo, 'ATRASADA_DESARROLLADOR');
});

test('en Terminada (S08) pasado el compromiso -> ESPERANDO_VALIDACION, NO atraso del desarrollador', () => {
  const ahora = new Date('2026-08-10T10:00:00-04:00');
  const resultado = Cumplimiento.clasificar(sub({
    estado: 'S08', fecha_comprometida: '2026-08-05T18:00', fecha_terminada: '2026-08-06T12:00:00-04:00'
  }), ahora);
  assert.equal(resultado.codigo, 'ESPERANDO_VALIDACION');
  assert.ok(resultado.dias_esperando > 0);
});

test('cerrada (S09), entrego antes del compromiso -> CERRADA_A_TIEMPO', () => {
  const resultado = Cumplimiento.clasificar(sub({
    estado: 'S09', fecha_comprometida: '2026-08-05T18:00', fecha_terminada: '2026-08-05T10:00:00-04:00'
  }));
  assert.equal(resultado.codigo, 'CERRADA_A_TIEMPO');
});

test('cerrada (S09), entrego despues del compromiso -> CERRADA_CON_ATRASO', () => {
  const resultado = Cumplimiento.clasificar(sub({
    estado: 'S09', fecha_comprometida: '2026-08-05T18:00', fecha_terminada: '2026-08-07T10:00:00-04:00'
  }));
  assert.equal(resultado.codigo, 'CERRADA_CON_ATRASO');
});

test('cerrada sin fecha_comprometida (nunca se comprometio) -> SIN_COMPROMISO', () => {
  const resultado = Cumplimiento.clasificar(sub({ estado: 'S09' }));
  assert.equal(resultado.codigo, 'SIN_COMPROMISO');
});

test('cierre directo (consulta tecnica, sin pasar por Terminada) -> CERRADA_A_TIEMPO, sin culpar al desarrollador', () => {
  const resultado = Cumplimiento.clasificar(sub({ estado: 'S09', fecha_comprometida: '2026-08-05T18:00', fecha_terminada: '' }));
  assert.equal(resultado.codigo, 'CERRADA_A_TIEMPO');
});

test('rechazada (S10) se trata igual que cerrada para la clasificacion historica', () => {
  const resultado = Cumplimiento.clasificar(sub({
    estado: 'S10', fecha_comprometida: '2026-08-05T18:00', fecha_terminada: '2026-08-07T10:00:00-04:00'
  }));
  assert.equal(resultado.codigo, 'CERRADA_CON_ATRASO');
});

test('obtenerFeriados lee solo las fechas de CONFIG_FERIADOS', () => {
  const db = abrirDb_();
  sembrarTabla_(db, 'CONFIG_FERIADOS', COLUMNAS.CONFIG_FERIADOS, [
    ['2026-09-18', 'Fiestas Patrias', 2026], ['2026-09-19', 'Glorias del Ejercito', 2026]
  ]);
  assert.deepEqual(Cumplimiento.obtenerFeriados(db), ['2026-09-18', '2026-09-19']);
});
