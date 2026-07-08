'use strict';

// v2.1 (Fase B, documentacion/SIGSO-v2.1-plazos-y-control.md §2.2, §6):
// "dos relojes" y el semaforo derivado de fecha_comprometida/fecha_terminada/
// estado. Cumplimiento.clasificar no escribe nada -- es puro, se prueba
// directo sin necesidad de Sheets (solo requiere Utils.gs + Constantes.gs,
// que loadBackofficeProject ya carga en orden).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject } = require('./helpers/gasSandbox');

function ctxLimpio() {
  return loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
}

function sub(overrides) {
  return Object.assign(
    { estado: 'S05', fecha_comprometida: '', fecha_terminada: '' },
    overrides
  );
}

test('Cumplimiento (v2.1): sin fecha_comprometida y aun activa -> SIN_COMPROMISO', () => {
  const ctx = ctxLimpio();
  const resultado = ctx.Cumplimiento.clasificar(sub({ estado: 'S02' }));
  assert.equal(resultado.codigo, 'SIN_COMPROMISO');
  assert.equal(resultado.dias_esperando, null);
});

test('Cumplimiento (v2.1): activa, comprometida y muy en el futuro -> EN_PLAZO', () => {
  const ctx = ctxLimpio();
  const ahora = new Date('2026-08-01T10:00:00-04:00');
  const resultado = ctx.Cumplimiento.clasificar(
    sub({ estado: 'S05', fecha_comprometida: '2026-08-20T18:00' }),
    ahora
  );
  assert.equal(resultado.codigo, 'EN_PLAZO');
});

test('Cumplimiento (v2.1): activa, a menos de 1 dia habil del compromiso -> EN_RIESGO', () => {
  const ctx = ctxLimpio();
  // Martes 10:00 -> compromiso el mismo dia 16:00 (menos de 9h habiles restantes).
  const ahora = new Date('2026-08-04T10:00:00-04:00');
  const resultado = ctx.Cumplimiento.clasificar(
    sub({ estado: 'S05', fecha_comprometida: '2026-08-04T16:00:00-04:00' }),
    ahora
  );
  assert.equal(resultado.codigo, 'EN_RIESGO');
});

test('Cumplimiento (v2.1): activa y ya paso la fecha comprometida (no entregada) -> ATRASADA_DESARROLLADOR', () => {
  const ctx = ctxLimpio();
  const ahora = new Date('2026-08-10T10:00:00-04:00');
  const resultado = ctx.Cumplimiento.clasificar(
    sub({ estado: 'S05', fecha_comprometida: '2026-08-05T18:00' }),
    ahora
  );
  assert.equal(resultado.codigo, 'ATRASADA_DESARROLLADOR');
});

test('Cumplimiento (v2.1): en Terminada (S08) pasado el compromiso -> ESPERANDO_VALIDACION, NO atraso del desarrollador', () => {
  const ctx = ctxLimpio();
  const ahora = new Date('2026-08-10T10:00:00-04:00');
  const resultado = ctx.Cumplimiento.clasificar(
    sub({
      estado: 'S08',
      fecha_comprometida: '2026-08-05T18:00',
      fecha_terminada: '2026-08-06T12:00:00-04:00'
    }),
    ahora
  );
  assert.equal(resultado.codigo, 'ESPERANDO_VALIDACION');
  assert.ok(resultado.dias_esperando > 0);
});

test('Cumplimiento (v2.1): cerrada (S09), entrego antes del compromiso -> CERRADA_A_TIEMPO', () => {
  const ctx = ctxLimpio();
  const resultado = ctx.Cumplimiento.clasificar(sub({
    estado: 'S09',
    fecha_comprometida: '2026-08-05T18:00',
    fecha_terminada: '2026-08-05T10:00:00-04:00'
  }));
  assert.equal(resultado.codigo, 'CERRADA_A_TIEMPO');
});

test('Cumplimiento (v2.1): cerrada (S09), entrego despues del compromiso -> CERRADA_CON_ATRASO', () => {
  const ctx = ctxLimpio();
  const resultado = ctx.Cumplimiento.clasificar(sub({
    estado: 'S09',
    fecha_comprometida: '2026-08-05T18:00',
    fecha_terminada: '2026-08-07T10:00:00-04:00'
  }));
  assert.equal(resultado.codigo, 'CERRADA_CON_ATRASO');
});

test('Cumplimiento (v2.1): cerrada sin fecha_comprometida (nunca se comprometio) -> SIN_COMPROMISO', () => {
  const ctx = ctxLimpio();
  const resultado = ctx.Cumplimiento.clasificar(sub({ estado: 'S09' }));
  assert.equal(resultado.codigo, 'SIN_COMPROMISO');
});

test('Cumplimiento (v2.1): cierre directo (consulta tecnica, sin pasar por Terminada) -> CERRADA_A_TIEMPO, sin culpar al desarrollador', () => {
  const ctx = ctxLimpio();
  const resultado = ctx.Cumplimiento.clasificar(sub({
    estado: 'S09',
    fecha_comprometida: '2026-08-05T18:00',
    fecha_terminada: ''
  }));
  assert.equal(resultado.codigo, 'CERRADA_A_TIEMPO');
});

test('Cumplimiento (v2.1): rechazada (S10) se trata igual que cerrada para la clasificacion historica', () => {
  const ctx = ctxLimpio();
  const resultado = ctx.Cumplimiento.clasificar(sub({
    estado: 'S10',
    fecha_comprometida: '2026-08-05T18:00',
    fecha_terminada: '2026-08-07T10:00:00-04:00'
  }));
  assert.equal(resultado.codigo, 'CERRADA_CON_ATRASO');
});
