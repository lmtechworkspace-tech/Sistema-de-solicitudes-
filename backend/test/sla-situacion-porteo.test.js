'use strict';

/**
 * Prueba de portabilidad: las secciones 1 y 2 de backend/test/
 * sla-situacion.test.js (Sla.medir/situacion/peorSituacion), corridas
 * contra backend/logica/cumplimiento.js. NO se porta la seccion 3
 * (Dashboard.getData / Solicitudes.getDetalle): ninguno de los dos esta
 * portado todavia (ver notas en solicitudesBackoffice.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Cumplimiento = require('../logica/cumplimiento');

const MIERCOLES_9AM = '2026-07-22T09:00:00.000-04:00';

function subDePrueba(overrides) {
  return Object.assign(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001', estado: 'S02', sla_objetivo_horas: 10, fecha_creacion: MIERCOLES_9AM },
    overrides
  );
}

test('Sla.situacion: EN_PLAZO mientras se consumio menos del 80% del SLA', () => {
  const situacion = Cumplimiento.situacion(subDePrueba({ sla_objetivo_horas: 10 }), { ahora: new Date('2026-07-22T14:00:00.000-04:00') });
  assert.equal(situacion, 'EN_PLAZO');
});

test('Sla.situacion: EN_RIESGO exactamente en el umbral A-08 del 80%', () => {
  assert.equal(Cumplimiento.SLA_UMBRAL_RIESGO, 0.8, 'el umbral A-08 debe seguir siendo 80%');
  const situacion = Cumplimiento.situacion(subDePrueba({ sla_objetivo_horas: 10 }), { ahora: new Date('2026-07-22T17:00:00.000-04:00') });
  assert.equal(situacion, 'EN_RIESGO');
});

test('Sla.situacion: EN_RIESGO tambien justo antes de vencer (99%), no FUERA_DE_PLAZO', () => {
  const situacion = Cumplimiento.situacion(subDePrueba({ sla_objetivo_horas: 9 }), { ahora: new Date('2026-07-22T17:54:00.000-04:00') });
  assert.equal(situacion, 'EN_RIESGO');
});

test('Sla.situacion: FUERA_DE_PLAZO al pasar el 100% del SLA', () => {
  const situacion = Cumplimiento.situacion(subDePrueba({ sla_objetivo_horas: 10 }), { ahora: new Date('2026-07-23T17:00:00.000-04:00') });
  assert.equal(situacion, 'FUERA_DE_PLAZO');
});

test('Sla.medir devuelve horas restantes negativas cuando ya vencio', () => {
  const medicion = Cumplimiento.medir(subDePrueba({ sla_objetivo_horas: 2 }), { ahora: new Date('2026-07-22T17:00:00.000-04:00') });
  assert.equal(medicion.situacion, 'FUERA_DE_PLAZO');
  assert.ok(medicion.restantes_horas < 0, 'restantes_horas deberia ser negativo, fue ' + medicion.restantes_horas);
  assert.ok(medicion.ratio > 1, 'ratio deberia superar 1, fue ' + medicion.ratio);
});

test('Sla.medir: null para un item ya cerrado (S09) -- su reloj se detuvo', () => {
  assert.equal(Cumplimiento.medir(subDePrueba({ estado: 'S09' })), null);
});

test('Sla.medir: null para rechazada (S10) y cancelada (S11)', () => {
  assert.equal(Cumplimiento.medir(subDePrueba({ estado: 'S10' })), null);
  assert.equal(Cumplimiento.medir(subDePrueba({ estado: 'S11' })), null);
});

test('Sla.medir: null sin sla_objetivo_horas (P5 / atencion directa)', () => {
  assert.equal(Cumplimiento.medir(subDePrueba({ sla_objetivo_horas: '' })), null);
  assert.equal(Cumplimiento.medir(subDePrueba({ sla_objetivo_horas: null })), null);
  assert.equal(Cumplimiento.medir(subDePrueba({ sla_objetivo_horas: undefined })), null);
});

test('Sla.medir: un item TERMINADA (S08) sigue midiendo SLA -- "Terminada + Fuera de plazo" es un estado real', () => {
  const medicion = Cumplimiento.medir(subDePrueba({ estado: 'S08', sla_objetivo_horas: 2 }), { ahora: new Date('2026-07-22T17:00:00.000-04:00') });
  assert.notEqual(medicion, null, 'S08 no debe excluirse del eje SLA');
  assert.equal(medicion.situacion, 'FUERA_DE_PLAZO');
});

test('Sla.peorSituacion: una solicitud toma la PEOR situacion de sus items, no la del que tiene menos horas', () => {
  assert.equal(Cumplimiento.peorSituacion(['EN_PLAZO', 'EN_RIESGO']), 'EN_RIESGO');
  assert.equal(Cumplimiento.peorSituacion(['EN_RIESGO', 'FUERA_DE_PLAZO']), 'FUERA_DE_PLAZO');
  assert.equal(Cumplimiento.peorSituacion(['EN_PLAZO', 'EN_PLAZO']), 'EN_PLAZO');
  assert.equal(Cumplimiento.peorSituacion([null, null]), null);
  assert.equal(Cumplimiento.peorSituacion([]), null);
});
