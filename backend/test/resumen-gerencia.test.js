'use strict';

/**
 * SIGSO v2, Módulo 4A — Resumen ejecutivo de Gerencia (ResumenGerencia).
 * Junta solicitudes, proyectos, tareas, personas y pausas; muestra el atraso
 * con AMBAS medidas (SLA y fecha comprometida) y solo lo ve Gerencia.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const ResumenGerencia = require('../logica/resumenGerencia');

const GER = { rol: 'GERENCIA', email: 'ger@x.cl', modulos: ['gerencia'] };

function db_() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}
function sol(db, id, items, creada) {
  const fecha = creada || new Date().toISOString();
  agregarFila_(db, 'SOLICITUDES', {
    solicitud_id: id, empresa_id: 'HP', empresa_nombre: 'HomePymes', estado_derivado: items[0].estado,
    prioridad_derivada: 'P3', fecha_creacion: fecha, solicitante_email: 'cli@x.cl'
  });
  items.forEach((it, i) => agregarFila_(db, 'SUBSOLICITUDES', Object.assign({
    subsolicitud_id: id + '-0' + (i + 1), solicitud_id: id, numero_item: i + 1, titulo: 'Ítem ' + (i + 1),
    prioridad: 'P3', sla_objetivo_horas: 24, fecha_creacion: fecha
  }, it)));
}

test('Solo Gerencia (rol ADM/GERENCIA o módulo gerencia) ve el resumen', () => {
  const db = db_();
  assert.equal(ResumenGerencia.getResumen(db, {}, { rol: 'DEV', email: 'd@x.cl', modulos: [] })._forbidden, true);
  assert.ok(ResumenGerencia.getResumen(db, {}, { rol: 'DEV', email: 'd@x.cl', modulos: ['gerencia'] }).solicitudes);
  assert.ok(ResumenGerencia.getResumen(db, {}, GER).solicitudes);
});

test('Solicitudes: ve TODA la cola (no solo lo suyo) y muestra ambas medidas de atraso', () => {
  const db = db_();
  const vieja = new Date(Date.now() - 70 * 86400000).toISOString();
  sol(db, 'SOL-1', [{ estado: 'S05', desarrollador_asignado: 'dev@x.cl', prioridad: 'P1' }], vieja);        // fuera de SLA, sin fecha
  sol(db, 'SOL-2', [{ estado: 'S05', desarrollador_asignado: 'otro@x.cl', fecha_comprometida: '2026-01-10' }], vieja); // vencida vs compromiso
  sol(db, 'SOL-3', [{ estado: 'S09', fecha_terminada: new Date().toISOString() }]);
  const r = ResumenGerencia.getResumen(db, {}, GER).solicitudes;
  assert.equal(r.ok, true);
  const s = r.data;
  assert.equal(s.resumen.abiertos, 2, 'Gerencia ve ítems asignados a otros');
  assert.equal(s.resumen.fuera_de_plazo, 2, 'medida SLA');
  assert.equal(s.resumen.sin_fecha, 1, 'sin fecha comprometida');
  assert.equal(s.atrasadas_compromiso, 1, 'medida contra fecha comprometida');
  assert.equal(s.abiertos_mas_60, 2);
  assert.equal(s.cerrados_30, 1);
  assert.deepEqual(s.criticos.map((i) => i.subsolicitud_id), ['SOL-1-01']);
});

test('Personas: suma tareas abiertas e ítems abiertos por responsable', () => {
  const db = db_();
  sol(db, 'SOL-1', [{ estado: 'S05', desarrollador_asignado: 'dev@x.cl' }]);
  agregarFila_(db, 'ACTIVIDADES', { actividad_id: 'A1', titulo: 'T', responsable_email: 'dev@x.cl', estado: 'EN_CURSO', activa: true, fecha_creacion: new Date().toISOString() });
  agregarFila_(db, 'ACTIVIDADES', { actividad_id: 'A2', titulo: 'T2', responsable_email: 'dev@x.cl', estado: 'TERMINADA', activa: true, fecha_creacion: new Date().toISOString() });
  const r = ResumenGerencia.getResumen(db, {}, GER).personas;
  assert.equal(r.ok, true);
  const dev = r.data.find((p) => p.email === 'dev@x.cl');
  assert.equal(dev.tareas, 1);
  assert.equal(dev.items, 1);
});

test('Una parte que falla no tumba el resumen', () => {
  const db = db_();
  const Proyectos = require('../logica/proyectos');
  const original = Proyectos.listar;
  Proyectos.listar = () => { throw new Error('boom'); };
  try {
    const r = ResumenGerencia.getResumen(db, {}, GER);
    assert.equal(r.proyectos.ok, false);
    assert.equal(r.solicitudes.ok, true);
  } finally { Proyectos.listar = original; }
});
