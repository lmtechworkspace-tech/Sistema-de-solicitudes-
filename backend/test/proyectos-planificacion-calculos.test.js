'use strict';

/**
 * Refactor "Planificación" (2026-09-23), Etapa 2 — modelo de datos y
 * cálculos centralizados. Ver documentacion (brief del dueño, secciones
 * 5-9 y 45): las mismas funciones deben alimentar plataforma, Excel y PDF,
 * así que se prueban como unidades puras, independientes del ciclo de vida
 * completo de una tarea.
 *
 * Casos mínimos pedidos textualmente en el encargo (§45):
 *  A: plan 01/09-10/09, real 01/09-10/09 -> 0 días.
 *  B: plan 01/09-10/09, real 01/09-13/09 -> +3 días.
 *  C: plan 01/09-10/09, real 01/09-08/09 -> -2 días.
 *  D: plan 01/09-10/09, sin fecha real -> según "hoy" sea antes o después
 *     del 10/09, y según el avance, ATRASADA / EN_RIESGO / EN_PLAZO.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Proyectos = require('../logica/proyectos');

// --- calcularDuracionDias_ / calcularDesviacionPlazoDias_ (Casos A/B/C) -----

test('calcularDesviacionPlazoDias_: Caso A -- terminó exactamente en la fecha plan -> 0 días', () => {
  assert.equal(Proyectos.calcularDesviacionPlazoDias_('2026-09-10', '2026-09-10'), 0);
});

test('calcularDesviacionPlazoDias_: Caso B -- terminó 3 días después del plan -> +3 días (atraso)', () => {
  assert.equal(Proyectos.calcularDesviacionPlazoDias_('2026-09-10', '2026-09-13'), 3);
});

test('calcularDesviacionPlazoDias_: Caso C -- terminó 2 días antes del plan -> -2 días (adelanto)', () => {
  assert.equal(Proyectos.calcularDesviacionPlazoDias_('2026-09-10', '2026-09-08'), -2);
});

test('calcularDesviacionPlazoDias_: sin fecha plan o sin fecha real, no hay desviación que calcular (null, no 0)', () => {
  assert.equal(Proyectos.calcularDesviacionPlazoDias_('', '2026-09-10'), null);
  assert.equal(Proyectos.calcularDesviacionPlazoDias_('2026-09-10', ''), null);
  assert.equal(Proyectos.calcularDesviacionPlazoDias_(null, null), null);
});

test('calcularDuracionDias_: cuenta días de calendario entre dos fechas', () => {
  assert.equal(Proyectos.calcularDuracionDias_('2026-09-01', '2026-09-10'), 9);
  assert.equal(Proyectos.calcularDuracionDias_('2026-09-10', '2026-09-01'), -9);
});

// --- calcularDesviacionAvancePp_ --------------------------------------------

test('calcularDesviacionAvancePp_: esperado 60, real 45 -> -15pp (bajo lo esperado)', () => {
  assert.equal(Proyectos.calcularDesviacionAvancePp_(60, 45), -15);
});

test('calcularDesviacionAvancePp_: esperado 20, real 80 -> +60pp (sobre lo esperado)', () => {
  assert.equal(Proyectos.calcularDesviacionAvancePp_(20, 80), 60);
});

test('calcularDesviacionAvancePp_: sin esperado o sin real calculable, no inventa un número', () => {
  assert.equal(Proyectos.calcularDesviacionAvancePp_(null, 80), null);
  assert.equal(Proyectos.calcularDesviacionAvancePp_(60, null), null);
});

// --- calcularEstadoPlazo_ (Caso D + completadas) ----------------------------

test('calcularEstadoPlazo_: una tarea con fecha_terminada es COMPLETADA sin importar si llegó tarde (estado != desviación)', () => {
  const tareaTardia = { fecha_compromiso: '2026-09-10', fecha_terminada: '2026-09-13' };
  assert.equal(Proyectos.calcularEstadoPlazo_(tareaTardia, 100, 100), 'COMPLETADA');
});

test('calcularEstadoPlazo_: sin fecha_compromiso -> SIN_FECHA (no se puede evaluar plazo)', () => {
  assert.equal(Proyectos.calcularEstadoPlazo_({ fecha_compromiso: '', fecha_terminada: '' }, null, null), 'SIN_FECHA');
});

test('calcularEstadoPlazo_: Caso D -- sin fecha real, la fecha plan ya pasó -> ATRASADA', () => {
  const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const tarea = { fecha_compromiso: ayer, fecha_terminada: '' };
  assert.equal(Proyectos.calcularEstadoPlazo_(tarea, 100, 50), 'ATRASADA');
});

test('calcularEstadoPlazo_: Caso D -- fecha plan lejos todavía y avance normal -> EN_PLAZO', () => {
  const enUnMes = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const tarea = { fecha_compromiso: enUnMes, fecha_terminada: '' };
  assert.equal(Proyectos.calcularEstadoPlazo_(tarea, 20, 18), 'EN_PLAZO');
});

test('calcularEstadoPlazo_: Caso D -- fecha plan cerca (dentro del umbral) Y avance muy por debajo -> EN_RIESGO', () => {
  const mañana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const tarea = { fecha_compromiso: mañana, fecha_terminada: '' };
  // esperado 90, real 50 -> -40pp, supera el déficit de riesgo (15pp)
  assert.equal(Proyectos.calcularEstadoPlazo_(tarea, 90, 50), 'EN_RIESGO');
});

test('calcularEstadoPlazo_: fecha plan cerca pero avance dentro de lo esperado -> EN_PLAZO, no EN_RIESGO', () => {
  const mañana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const tarea = { fecha_compromiso: mañana, fecha_terminada: '' };
  assert.equal(Proyectos.calcularEstadoPlazo_(tarea, 90, 88), 'EN_PLAZO');
});

test('calcularEstadoPlazo_: fecha plan lejos (fuera del umbral de días) nunca es EN_RIESGO aunque el avance esté muy bajo', () => {
  const enUnMes = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const tarea = { fecha_compromiso: enUnMes, fecha_terminada: '' };
  assert.equal(Proyectos.calcularEstadoPlazo_(tarea, 90, 10), 'EN_PLAZO');
});

// --- calcularFechaInicioReal_ (derivado de la bitácora, nunca inventado) ---

function registroDia_(actividadId, dia, estadoDia) {
  return { actividad_id: actividadId, tipo: 'REGISTRO_DIA', timestamp: dia + 'T13:00:00.000Z', datos: JSON.stringify({ dia, estado_dia: estadoDia }) };
}

test('calcularFechaInicioReal_: toma el primer día con trabajo REAL (en_proceso), no el día "asignado"', () => {
  const bitacora = [
    registroDia_('T1', '2026-09-01', 'asignado'),
    registroDia_('T1', '2026-09-03', 'en_proceso'),
    registroDia_('T1', '2026-09-05', 'finalizado')
  ];
  assert.equal(Proyectos.calcularFechaInicioReal_('T1', bitacora), '2026-09-03');
});

test('calcularFechaInicioReal_: sin ningún registro real, devuelve null (nunca inventa una fecha)', () => {
  const bitacora = [registroDia_('T1', '2026-09-01', 'asignado'), registroDia_('T1', '2026-09-02', 'planificado')];
  assert.equal(Proyectos.calcularFechaInicioReal_('T1', bitacora), null);
});

test('calcularFechaInicioReal_: sin bitácora en absoluto, devuelve null', () => {
  assert.equal(Proyectos.calcularFechaInicioReal_('T1', []), null);
});

test('calcularFechaInicioReal_: solo mira la bitácora de LA tarea pedida, no mezcla con otras', () => {
  const bitacora = [
    registroDia_('T1', '2026-09-10', 'en_proceso'),
    registroDia_('T2', '2026-09-01', 'en_proceso')
  ];
  assert.equal(Proyectos.calcularFechaInicioReal_('T1', bitacora), '2026-09-10');
});
