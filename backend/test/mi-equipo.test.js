'use strict';

/**
 * SIGSO v2, Módulo 4B — Mi departamento centrado en las personas
 * (MiEquipo.getMiEquipo): todo el trabajo de cada persona del equipo, solo
 * del equipo configurado en JEFATURAS (también para un ADM).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const MiEquipo = require('../logica/miEquipo');
const Utils = require('../logica/utils');

const JEFE = { rol: 'DEV', email: 'jefe@x.cl' };

function db_() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  agregarFila_(db, 'JEFATURAS', { jefatura_id: 'J1', jefe_email: 'jefe@x.cl', subordinado_email: 'ana@x.cl', activo: true });
  return db;
}
function tarea(db, o) {
  agregarFila_(db, 'ACTIVIDADES', Object.assign({ activa: true, estado: 'EN_CURSO', fecha_creacion: new Date().toISOString(), responsable_email: 'ana@x.cl' }, o));
}

test('Sin equipo responde vacío; un ADM sin equipo tampoco ve a toda la empresa', () => {
  const db = db_();
  tarea(db, { actividad_id: 'A1', titulo: 'x' });
  assert.deepEqual(MiEquipo.getMiEquipo(db, {}, { rol: 'ADM', email: 'otro@x.cl' }).personas, []);
});

test('Trae las tareas de proyecto y personales de cada persona, con semáforo y por confirmar', () => {
  const db = db_();
  agregarFila_(db, 'PROYECTOS', { proyecto_id: 'P1', nombre: 'Proyecto uno', activa: true });
  tarea(db, { actividad_id: 'A1', titulo: 'De proyecto atrasada', proyecto_id: 'P1', fecha_compromiso: '2026-01-01' });
  tarea(db, { actividad_id: 'A2', titulo: 'Personal por confirmar', fecha_propuesta: '2099-01-01' });
  tarea(db, { actividad_id: 'A3', titulo: 'Terminada', estado: 'TERMINADA', fecha_terminada: new Date().toISOString() });
  tarea(db, { actividad_id: 'A4', titulo: 'De otro', responsable_email: 'otro@x.cl' });
  const r = MiEquipo.getMiEquipo(db, {}, JEFE);
  assert.equal(r.personas.length, 1);
  const ana = r.personas[0];
  assert.equal(ana.tareas.abiertas, 2);
  assert.equal(ana.tareas.atrasadas, 1);
  assert.equal(ana.tareas.por_confirmar, 1);
  assert.equal(ana.tareas.terminadas_7d, 1);
  assert.equal(ana.tareas.lista[0].actividad_id, 'A1', 'lo atrasado primero');
  assert.equal(ana.tareas.lista[0].proyecto_nombre, 'Proyecto uno');
  assert.equal(ana.tareas.lista[1].personal, true);
});

test('Horas de la semana: el REGISTRO_DIA manda sobre el check-in del mismo día; solo cuenta lo que registró la persona', () => {
  const db = db_();
  tarea(db, { actividad_id: 'A1', titulo: 'T' });
  const hoy = Utils.claveDia_(new Date(), 'America/Santiago');
  const ts = new Date().toISOString();
  agregarFila_(db, 'ACTIVIDADES_BITACORA', { bitacora_id: 'B1', actividad_id: 'A1', tipo: 'CHECKIN_AVANCE', autor_email: 'ana@x.cl', timestamp: ts, datos: JSON.stringify({ horas: 5 }) });
  agregarFila_(db, 'ACTIVIDADES_BITACORA', { bitacora_id: 'B2', actividad_id: 'A1', tipo: 'REGISTRO_DIA', autor_email: 'ana@x.cl', timestamp: ts, datos: JSON.stringify({ dia: hoy, horas: 3 }) });
  agregarFila_(db, 'ACTIVIDADES_BITACORA', { bitacora_id: 'B3', actividad_id: 'A1', tipo: 'CHECKIN_AVANCE', autor_email: 'jefe@x.cl', timestamp: ts, datos: JSON.stringify({ horas: 9 }) });
  const ana = MiEquipo.getMiEquipo(db, {}, JEFE).personas[0];
  assert.equal(ana.horas.ultimos_7d, 3);
  assert.equal(ana.horas.por_dia.find((d) => d.hoy).horas, 3);
});

test('Solicitudes: ítems a su cargo y lo que pidió y espera validar', () => {
  const db = db_();
  agregarFila_(db, 'SOLICITUDES', { solicitud_id: 'S1', empresa_id: 'HP', estado_derivado: 'S05', fecha_creacion: new Date().toISOString(), desarrollador_asignado: '', solicitante_email: 'cli@x.cl' });
  agregarFila_(db, 'SUBSOLICITUDES', { subsolicitud_id: 'S1-01', solicitud_id: 'S1', numero_item: 1, estado: 'S05', desarrollador_asignado: 'ana@x.cl', prioridad: 'P3', sla_objetivo_horas: 24, fecha_creacion: new Date().toISOString() });
  agregarFila_(db, 'SOLICITUDES', { solicitud_id: 'S2', empresa_id: 'HP', estado_derivado: 'S08', fecha_creacion: new Date().toISOString(), solicitante_email: 'ana@x.cl' });
  agregarFila_(db, 'SUBSOLICITUDES', { subsolicitud_id: 'S2-01', solicitud_id: 'S2', numero_item: 1, estado: 'S08', prioridad: 'P3', sla_objetivo_horas: 24, fecha_creacion: new Date().toISOString() });
  const s = MiEquipo.getMiEquipo(db, {}, JEFE).personas[0].solicitudes;
  assert.equal(s.a_cargo, 1);
  assert.equal(s.pedidas_abiertas, 1);
  assert.equal(s.por_validar, 1);
});
