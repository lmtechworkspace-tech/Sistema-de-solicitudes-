'use strict';

/**
 * SIGSO v2, Módulo 8C — Personas v2 (PersonasPanelSgc): panel con inducción
 * por ítem, evaluación según la regla, e inducciones en lote.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Panel = require('../logica/personasPanelSgc');
const Personas = require('../logica/personasSgc');

const ADM = { rol: 'ADM', email: 'admin@x.cl' };
const JEFA = { rol: 'DEV', email: 'jefa@x.cl' };
const OTRO = { rol: 'DEV', email: 'otro@x.cl' };
const ITEMS = Panel.ITEMS;

function db_() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function persona(db, id, o) {
  agregarFila_(db, 'SGC_PERSONAS', Object.assign({
    persona_id: id, usuario_email: id + '@x.cl', nombre: 'Persona ' + id, cargo: 'Analista', tipo: 'INT',
    jefatura_email: '', fecha_ingreso: '2024-03-01T00:00:00.000Z', estado: 'ACTIVO', activa: true
  }, o || {}));
  ITEMS.forEach((item, i) => agregarFila_(db, 'SGC_INDUCCIONES', { induccion_id: id + '-' + i, persona_id: id, item, fecha: '', relator_email: '', estado: 'PENDIENTE', observaciones: '' }));
}
function inducciones(db, id) { return leerFilas_(db, 'SGC_INDUCCIONES', COLUMNAS.SGC_INDUCCIONES).filter((i) => i.persona_id === id); }
function hoyMas(dias) {
  const h = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
  return new Date(Date.UTC(+h.slice(0, 4), +h.slice(5, 7) - 1, +h.slice(8, 10) + dias)).toISOString().slice(0, 10);
}

test('Panel: inducción por ítem, evaluación según la regla y alertas', () => {
  const db = db_();
  persona(db, 'A');
  persona(db, 'B');
  agregarFila_(db, 'SGC_EVALUACIONES', { evaluacion_id: 'E1', persona_id: 'A', fecha: '', promedio_responsabilidades: 3.5, promedio_habilidades: 4, requiere_capacitacion: true, proxima_evaluacion: '' });
  agregarFila_(db, 'SGC_EVALUACIONES', { evaluacion_id: 'E2', persona_id: 'B', fecha: '2026-01-10', promedio_responsabilidades: 2.75, promedio_habilidades: 3, requiere_capacitacion: true, proxima_evaluacion: '2027-01-10' });
  const r = Panel.getPanel(db, {}, ADM);
  const a = r.personas.find((p) => p.persona_id === 'A');
  const b = r.personas.find((p) => p.persona_id === 'B');
  assert.equal(a.induccion.length, 5);
  assert.equal(a.induccion_pendientes, 5);
  assert.equal(a.evaluacion.requiere_capacitacion, false, '3,5 y 4 no requieren según la regla (< 3)');
  assert.equal(a.evaluacion.difiere_de_regla, true);
  assert.ok(a.alertas.indexOf('evaluacion_sin_fecha') !== -1);
  assert.equal(b.evaluacion.requiere_capacitacion, true);
  assert.equal(r.resumen.requiere_capacitacion, 1);
  assert.equal(r.resumen.evaluaciones_difieren, 1);
  assert.equal(r.resumen.induccion_items_pendientes, 10);
  assert.equal(a.puede_registrar_induccion, true);
});

test('Registrar inducciones en lote con la fecha indicada (sin correr el día)', () => {
  const db = db_();
  persona(db, 'A');
  persona(db, 'B');
  const r = Panel.registrarEnLote(db, { registros: [
    { persona_id: 'A', items: ITEMS, fecha: '2024-03-01' },
    { persona_id: 'B', items: ['Organigrama', 'Política de Calidad'], fecha: '2025-05-20' }
  ] }, ADM);
  assert.equal(r.aplicados, 7);
  assert.equal(r.personas, 2);
  const a = inducciones(db, 'A');
  assert.ok(a.every((i) => i.estado === 'COMPLETADA' && String(i.fecha).slice(0, 10) === '2024-03-01'));
  assert.equal(a[0].relator_email, 'admin@x.cl');
  assert.equal(inducciones(db, 'B').filter((i) => i.estado === 'COMPLETADA').length, 2);
  assert.equal(Panel.getPanel(db, {}, ADM).resumen.induccion_completa, 1);
});

test('El lote rechaza fecha futura, sin fecha, ítem desconocido y vacío', () => {
  const db = db_();
  persona(db, 'A');
  assert.equal(Panel.registrarEnLote(db, { registros: [{ persona_id: 'A', items: ['Organigrama'], fecha: hoyMas(1) }] }, ADM)._validationError, true);
  assert.equal(Panel.registrarEnLote(db, { registros: [{ persona_id: 'A', items: ['Organigrama'], fecha: '' }] }, ADM)._validationError, true);
  assert.equal(Panel.registrarEnLote(db, { registros: [{ persona_id: 'A', items: ['Otra cosa'], fecha: '2025-01-01' }] }, ADM)._validationError, true);
  assert.equal(Panel.registrarEnLote(db, { registros: [] }, ADM)._validationError, true);
  assert.ok(inducciones(db, 'A').every((i) => i.estado === 'PENDIENTE'));
  // Hoy sí vale.
  assert.equal(Panel.registrarEnLote(db, { registros: [{ persona_id: 'A', items: ['Organigrama'], fecha: hoyMas(0) }] }, ADM).aplicados, 1);
});

test('La jefatura registra solo a su equipo; otros no pueden', () => {
  const db = db_();
  persona(db, 'MIA', { jefatura_email: 'jefa@x.cl' });
  persona(db, 'AJENA', { jefatura_email: 'otra@x.cl' });
  const r = Panel.registrarEnLote(db, { registros: [
    { persona_id: 'MIA', items: ['Organigrama'], fecha: '2025-01-01' },
    { persona_id: 'AJENA', items: ['Organigrama'], fecha: '2025-01-01' }
  ] }, JEFA);
  assert.equal(r.aplicados, 1);
  assert.equal(r.fallas.length, 1);
  assert.equal(inducciones(db, 'AJENA')[0].estado, 'PENDIENTE');
  assert.equal(Panel.registrarEnLote(db, { registros: [{ persona_id: 'MIA', items: ['Política de Calidad'], fecha: '2025-01-01' }] }, OTRO).aplicados, 0);
  const vista = Panel.getPanel(db, {}, JEFA);
  assert.deepEqual(vista.personas.map((p) => p.persona_id), ['MIA'], 'la jefa ve solo a su equipo');
});

test('Ficha sin la fila de un ítem: el lote la crea y la registra', () => {
  const db = db_();
  agregarFila_(db, 'SGC_PERSONAS', { persona_id: 'V', usuario_email: 'v@x.cl', nombre: 'Vieja', estado: 'ACTIVO', activa: true, fecha_ingreso: '2020-01-01' });
  const r = Panel.registrarEnLote(db, { registros: [{ persona_id: 'V', items: ['Organigrama'], fecha: '2020-01-01' }] }, ADM);
  assert.equal(r.aplicados, 1);
  assert.equal(inducciones(db, 'V')[0].estado, 'COMPLETADA');
});

test('registrarInduccion (uno a uno) también rechaza fecha futura', () => {
  const db = db_();
  persona(db, 'A');
  const r = Personas.registrarInduccion(db, { persona_id: 'A', induccion_id: 'A-0', estado: 'COMPLETADA', fecha: hoyMas(3) + 'T12:00:00.000Z' }, ADM);
  assert.equal(r._validationError, true);
});
