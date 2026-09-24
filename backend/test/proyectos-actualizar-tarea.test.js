'use strict';

/**
 * Proyectos v2 — "Actualizar tarea" unificado (Proyectos.actualizarTarea).
 * Una sola acción compone el check-in (estado/avance de la tarea) y el
 * registro del día (horas y cómo fue el día). Contrato verificado:
 *  - las horas quedan SOLO en el REGISTRO_DIA (nunca también en el check-in);
 *  - reportar avance sin horas conserva las horas ya cargadas ese día;
 *  - una validación que falla no deja escrituras a medias;
 *  - permisos: el líder puede registrar el día pero no cambiar el avance de
 *    una tarea que no trabaja; un ajeno no puede nada.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Proyectos = require('../logica/proyectos');
const Utils = require('../logica/utils');

const CTX_LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV' };
const CTX_MARCELO = { email: 'marcelo@rld.cl', nombre: 'Marcelo Integrante', rol: 'DEV' };
const CTX_OTRO = { email: 'otro@rld.cl', nombre: 'Otro Ajeno', rol: 'DEV' };

const TABLAS = [
  'PROYECTOS', 'PROYECTO_INTEGRANTES', 'PROYECTO_HITOS', 'PROYECTO_EVENTOS',
  'PROYECTO_ENTREGABLES', 'PROYECTO_RIESGOS', 'PROYECTO_PLANTILLAS', 'PROYECTO_PLANTILLA_HITOS',
  'PROYECTO_DOCUMENTOS', 'PROYECTO_DOC_VERSIONES', 'PROYECTO_REUNIONES', 'PROYECTO_REUNION_ACUERDOS',
  'PROYECTO_DECISIONES', 'SOLICITUDES', 'ACTIVIDADES', 'ACTIVIDADES_BITACORA', 'JEFATURAS',
  'LOG_NOTIFICACIONES', 'CONFIG_FERIADOS', 'NOTIFICACIONES_APP', 'CAT_AREAS'
];

const HOY = Utils.claveDia_(new Date(), 'America/Santiago');
const MANANA = Utils.claveDia_(new Date(Date.now() + 2 * 86400000), 'America/Santiago');

function armar() {
  const db = abrirDb_();
  TABLAS.forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  const proyecto = Proyectos.crear(db, { nombre: 'Marketing', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-31' }, CTX_LEO);
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  const tarea = Proyectos.crearTarea(db, {
    proyecto_id: proyecto.proyecto_id, titulo: 'Diseñar campaña', responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-12-01'
  }, CTX_LEO);
  return { db, proyecto, tarea };
}

function filasBitacora(db, actividadId) {
  return leerFilas_(db, 'ACTIVIDADES_BITACORA', COLUMNAS.ACTIVIDADES_BITACORA).filter((b) => b.actividad_id === actividadId);
}
function tareaActual(db, actividadId) {
  return leerFilas_(db, 'ACTIVIDADES', COLUMNAS.ACTIVIDADES).find((a) => a.actividad_id === actividadId);
}

test('avance + horas: la tarea pasa a EN_CURSO con su avance y las horas quedan SOLO en el registro del día', () => {
  const { db, proyecto, tarea } = armar();
  const r = Proyectos.actualizarTarea(db, {
    proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, accion: 'avance', avance_pct: 40, horas: 3, nota: 'Boceto listo'
  }, CTX_MARCELO);
  assert.equal(r.ok, true, JSON.stringify(r));
  const t = tareaActual(db, tarea.actividad_id);
  assert.equal(t.estado, 'EN_CURSO');
  assert.equal(Number(t.avance_pct), 40);

  const filas = filasBitacora(db, tarea.actividad_id);
  const checkin = filas.find((b) => b.tipo === 'CHECKIN_AVANCE');
  const dia = filas.find((b) => b.tipo === 'REGISTRO_DIA');
  assert.ok(checkin, 'debe quedar el check-in');
  assert.ok(dia, 'debe quedar el registro del día');
  assert.equal(JSON.parse(checkin.datos || '{}').horas, undefined, 'el check-in no lleva horas');
  const d = JSON.parse(dia.datos);
  assert.equal(d.dia, HOY);
  assert.equal(Number(d.horas), 3);
  assert.equal(d.estado_dia, 'en_proceso');
  assert.equal(checkin.nota, 'Boceto listo');
  assert.equal(dia.nota, '', 'la nota no se duplica en el registro del día');
});

test('solo horas (sin acción): registra el día y NO toca el estado de la tarea ni crea check-in', () => {
  const { db, proyecto, tarea } = armar();
  const r = Proyectos.actualizarTarea(db, { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, horas: 2, nota: 'Reunión con cliente' }, CTX_MARCELO);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(tareaActual(db, tarea.actividad_id).estado, 'NO_INICIADA');
  const filas = filasBitacora(db, tarea.actividad_id);
  assert.equal(filas.filter((b) => b.tipo.indexOf('CHECKIN') === 0).length, 0);
  const dia = filas.find((b) => b.tipo === 'REGISTRO_DIA');
  assert.equal(Number(JSON.parse(dia.datos).horas), 2);
  assert.equal(dia.nota, 'Reunión con cliente');
});

test('reportar avance sin horas conserva las horas que el día ya tenía', () => {
  const { db, proyecto, tarea } = armar();
  Proyectos.actualizarTarea(db, { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, horas: 3 }, CTX_MARCELO);
  const r = Proyectos.actualizarTarea(db, { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, accion: 'avance', avance_pct: 60 }, CTX_MARCELO);
  assert.equal(r.ok, true, JSON.stringify(r));
  const registros = filasBitacora(db, tarea.actividad_id).filter((b) => b.tipo === 'REGISTRO_DIA');
  assert.equal(registros.length, 1, 'mismo día = mismo registro (upsert)');
  assert.equal(Number(JSON.parse(registros[0].datos).horas), 3);
});

test('listo: la tarea termina y el día queda "finalizado"', () => {
  const { db, proyecto, tarea } = armar();
  const r = Proyectos.actualizarTarea(db, { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, accion: 'listo', horas: 1 }, CTX_MARCELO);
  assert.equal(r.ok, true, JSON.stringify(r));
  const t = tareaActual(db, tarea.actividad_id);
  assert.equal(t.estado, 'TERMINADA');
  assert.ok(t.fecha_terminada);
  const dia = filasBitacora(db, tarea.actividad_id).find((b) => b.tipo === 'REGISTRO_DIA');
  assert.equal(JSON.parse(dia.datos).estado_dia, 'finalizado');
});

test('bloqueo sin motivo: error y NADA escrito (ni check-in, ni registro, ni cambio de estado)', () => {
  const { db, proyecto, tarea } = armar();
  const antes = filasBitacora(db, tarea.actividad_id).length;
  const r = Proyectos.actualizarTarea(db, { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, accion: 'bloqueo', horas: 2 }, CTX_MARCELO);
  assert.equal(r._validationError, true);
  assert.equal(filasBitacora(db, tarea.actividad_id).length, antes);
  assert.equal(tareaActual(db, tarea.actividad_id).estado, 'NO_INICIADA');
});

test('bloqueo con motivo: tarea BLOQUEADA y día "bloqueado" con el mismo motivo', () => {
  const { db, proyecto, tarea } = armar();
  const r = Proyectos.actualizarTarea(db, {
    proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, accion: 'bloqueo', bloqueo_motivo: 'Falta aprobación del cliente'
  }, CTX_MARCELO);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(tareaActual(db, tarea.actividad_id).estado, 'BLOQUEADA');
  const d = JSON.parse(filasBitacora(db, tarea.actividad_id).find((b) => b.tipo === 'REGISTRO_DIA').datos);
  assert.equal(d.estado_dia, 'bloqueado');
  assert.equal(d.bloqueo_motivo, 'Falta aprobación del cliente');
});

test('validaciones: día futuro, horas fuera de rango, avance fuera de rango, nada que actualizar', () => {
  const { db, proyecto, tarea } = armar();
  const base = { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id };
  assert.equal(Proyectos.actualizarTarea(db, Object.assign({ horas: 2, dia: MANANA }, base), CTX_MARCELO)._validationError, true);
  assert.equal(Proyectos.actualizarTarea(db, Object.assign({ horas: 30 }, base), CTX_MARCELO)._validationError, true);
  assert.equal(Proyectos.actualizarTarea(db, Object.assign({ accion: 'avance', avance_pct: 140 }, base), CTX_MARCELO)._validationError, true);
  assert.equal(Proyectos.actualizarTarea(db, Object.assign({}, base), CTX_MARCELO)._validationError, true);
  assert.equal(Proyectos.actualizarTarea(db, Object.assign({ accion: 'inventada' }, base), CTX_MARCELO)._validationError, true);
  assert.equal(filasBitacora(db, tarea.actividad_id).filter((b) => b.tipo !== 'CREADA').length, 0, 'ningún intento inválido escribió');
});

test('permisos: el líder registra el día pero no cambia el avance de una tarea ajena; un externo no puede nada', () => {
  const { db, proyecto, tarea } = armar();
  const base = { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id };
  assert.equal(Proyectos.actualizarTarea(db, Object.assign({ horas: 1 }, base), CTX_LEO).ok, true);
  assert.equal(Proyectos.actualizarTarea(db, Object.assign({ accion: 'avance', avance_pct: 10 }, base), CTX_LEO)._forbidden, true);
  assert.equal(Proyectos.actualizarTarea(db, Object.assign({ horas: 1 }, base), CTX_OTRO)._forbidden, true);
});

test('una tarea cerrada no acepta más cambios de avance', () => {
  const { db, proyecto, tarea } = armar();
  const base = { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id };
  Proyectos.actualizarTarea(db, Object.assign({ accion: 'listo' }, base), CTX_MARCELO);
  assert.equal(Proyectos.actualizarTarea(db, Object.assign({ accion: 'avance', avance_pct: 50 }, base), CTX_MARCELO)._validationError, true);
});

// --- Mi trabajo v2: compromisos personales (actividades SIN proyecto) ---------
const Actividades = require('../logica/actividades');
const CTX_ADM = { email: 'adm@rld.cl', nombre: 'Admin', rol: 'ADM' };

function armarPersonal() {
  const base = armar();
  const compromiso = Actividades.crear(base.db, { titulo: 'Preparar informe mensual', fecha_compromiso: '2026-12-15', origen: 'PROPIA' }, CTX_MARCELO);
  assert.ok(compromiso && compromiso.actividad_id, JSON.stringify(compromiso));
  return Object.assign(base, { compromiso });
}

test('compromiso personal: "Actualizar tarea" sin proyecto registra avance y horas (horas solo en el registro del día)', () => {
  const { db, compromiso } = armarPersonal();
  const r = Proyectos.actualizarTarea(db, { actividad_id: compromiso.actividad_id, accion: 'avance', avance_pct: 50, horas: 1.5 }, CTX_MARCELO);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(tareaActual(db, compromiso.actividad_id).estado, 'EN_CURSO');
  const filas = filasBitacora(db, compromiso.actividad_id);
  const dia = filas.find((b) => b.tipo === 'REGISTRO_DIA');
  assert.ok(dia, 'debe quedar el registro del día');
  assert.equal(Number(JSON.parse(dia.datos).horas), 1.5);
  assert.equal(JSON.parse(filas.find((b) => b.tipo === 'CHECKIN_AVANCE').datos || '{}').horas, undefined);
});

test('compromiso personal: un ajeno no puede; ADM (supervisa) registra el día pero no cambia el avance', () => {
  const { db, compromiso } = armarPersonal();
  const ajeno = Proyectos.actualizarTarea(db, { actividad_id: compromiso.actividad_id, horas: 1 }, CTX_OTRO);
  assert.equal(ajeno._forbidden, true);
  const adm = Proyectos.actualizarTarea(db, { actividad_id: compromiso.actividad_id, horas: 2 }, CTX_ADM);
  assert.equal(adm.ok, true, JSON.stringify(adm));
  const admAvance = Proyectos.actualizarTarea(db, { actividad_id: compromiso.actividad_id, accion: 'avance', avance_pct: 10 }, CTX_ADM);
  assert.equal(admAvance._forbidden, true);
});

test('sin proyecto_id, una tarea DE proyecto usa su propio proyecto y sus permisos', () => {
  const { db, tarea } = armar();
  const r = Proyectos.actualizarTarea(db, { actividad_id: tarea.actividad_id, horas: 1 }, CTX_MARCELO);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(Proyectos.actualizarTarea(db, { actividad_id: tarea.actividad_id, horas: 1 }, CTX_OTRO)._forbidden, true);
});

test('listarMisTareas: los compromisos personales solo aparecen con incluir_personales', () => {
  const { db, compromiso, tarea } = armarPersonal();
  const sinFlag = Proyectos.listarMisTareas(db, {}, CTX_MARCELO).tareas.map((t) => t.actividad_id);
  assert.ok(sinFlag.indexOf(tarea.actividad_id) !== -1);
  assert.equal(sinFlag.indexOf(compromiso.actividad_id), -1);
  const conFlag = Proyectos.listarMisTareas(db, { incluir_personales: true }, CTX_MARCELO).tareas;
  const personal = conFlag.find((t) => t.actividad_id === compromiso.actividad_id);
  assert.ok(personal, 'el compromiso debe aparecer');
  assert.equal(personal.personal, true);
  assert.equal(personal.proyecto_id, '');
  // Siempre personal: el ADM no ve el compromiso de otro en SU Mi trabajo.
  const delAdm = Proyectos.listarMisTareas(db, { incluir_personales: true }, CTX_ADM).tareas;
  assert.equal(delAdm.filter((t) => t.actividad_id === compromiso.actividad_id).length, 0);
});
