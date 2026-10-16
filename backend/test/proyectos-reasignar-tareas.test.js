'use strict';

/**
 * Auditoría Proyectos + Mi trabajo (16-10-2026), Etapa 1 "destrabar".
 * Decisiones del dueño:
 *  - reasignar dentro del proyecto es un TRASPASO: conserva estado, avance y
 *    fecha comprometida;
 *  - reasignan el líder (cualquier tarea) y el propio responsable (las suyas),
 *    también en lote ("Pasar a…");
 *  - quien recibe debe ser integrante activo y no observador.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Proyectos = require('../logica/proyectos');
const Actividades = require('../logica/actividades');

const CTX_LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV' };
const CTX_LUIS = { email: 'luis@rld.cl', nombre: 'Luis Integrante', rol: 'DEV' };
const CTX_VALE = { email: 'vale@rld.cl', nombre: 'Vale Colaboradora', rol: 'DEV' };
const CTX_OTRO = { email: 'otro@rld.cl', nombre: 'Otro Ajeno', rol: 'DEV' };

const TABLAS = [
  'PROYECTOS', 'PROYECTO_INTEGRANTES', 'PROYECTO_HITOS', 'PROYECTO_EVENTOS',
  'PROYECTO_ENTREGABLES', 'PROYECTO_RIESGOS', 'PROYECTO_PLANTILLAS', 'PROYECTO_PLANTILLA_HITOS',
  'PROYECTO_DOCUMENTOS', 'PROYECTO_DOC_VERSIONES', 'PROYECTO_REUNIONES', 'PROYECTO_REUNION_ACUERDOS',
  'PROYECTO_DECISIONES', 'SOLICITUDES', 'ACTIVIDADES', 'ACTIVIDADES_BITACORA', 'JEFATURAS',
  'LOG_NOTIFICACIONES', 'CONFIG_FERIADOS', 'NOTIFICACIONES_APP', 'CAT_AREAS'
];

function armar() {
  const db = abrirDb_();
  TABLAS.forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  const proyecto = Proyectos.crear(db, { nombre: 'Estandarización comercial', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-31' }, CTX_LEO);
  const pid = proyecto.proyecto_id;
  Proyectos.gestionarIntegrante(db, { proyecto_id: pid, usuario_email: 'luis@rld.cl', usuario_nombre: 'Luis Integrante', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  Proyectos.gestionarIntegrante(db, { proyecto_id: pid, usuario_email: 'vale@rld.cl', usuario_nombre: 'Vale Colaboradora', rol_proyecto: 'COLABORADOR' }, CTX_LEO);
  Proyectos.gestionarIntegrante(db, { proyecto_id: pid, usuario_email: 'obs@rld.cl', usuario_nombre: 'Obs', rol_proyecto: 'OBSERVADOR' }, CTX_LEO);
  const t = (titulo, resp) => Proyectos.crearTarea(db, { proyecto_id: pid, titulo, responsable_email: resp, fecha_compromiso: '2026-12-01' }, CTX_LEO);
  const a = t('Levantar procesos', 'luis@rld.cl');
  const b = t('Matriz de clientes', 'luis@rld.cl');
  const c = t('Guion comercial', 'leo@rld.cl');
  Actividades.confirmar(db, { actividad_id: a.actividad_id }, CTX_LUIS);
  Actividades.checkin(db, { actividad_id: a.actividad_id, tipo: 'avance', avance_pct: 40 }, CTX_LUIS);
  return { db, pid, a, b, c };
}
const tarea = (db, id) => leerFilas_(db, 'ACTIVIDADES', COLUMNAS.ACTIVIDADES).find((x) => x.actividad_id === id);
const bitacora = (db, id) => leerFilas_(db, 'ACTIVIDADES_BITACORA', COLUMNAS.ACTIVIDADES_BITACORA).filter((x) => x.actividad_id === id);

test('el responsable traspasa sus tareas en lote: conserva estado y avance, deja traza y avisa a quien recibe', () => {
  const { db, pid, a, b } = armar();
  const r = Proyectos.reasignarTareas(db, { proyecto_id: pid, actividad_ids: [a.actividad_id, b.actividad_id], responsable_email: 'vale@rld.cl', motivo: 'Las ejecuta Vale' }, CTX_LUIS);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.reasignadas, 2);
  const ta = tarea(db, a.actividad_id);
  assert.equal(ta.responsable_email, 'vale@rld.cl');
  assert.equal(ta.responsable_nombre, 'Vale Colaboradora');
  assert.equal(ta.estado, 'EN_CURSO');
  assert.equal(Number(ta.avance_pct), 40);
  assert.ok(ta.confirmada_en);
  const traza = bitacora(db, a.actividad_id).find((x) => x.tipo === 'REASIGNACION');
  assert.ok(traza, 'queda la reasignación en la bitácora');
  assert.equal(traza.nota, 'Las ejecuta Vale');
  const avisos = leerFilas_(db, 'NOTIFICACIONES_APP', COLUMNAS.NOTIFICACIONES_APP).filter((n) => n.destinatario_email === 'vale@rld.cl' && n.tipo === 'PROYECTO_TAREAS_REASIGNADAS');
  assert.equal(avisos.length, 1, 'un solo aviso por lote');

  // Y ya puede cambiarles el estado como responsable.
  const listo = Proyectos.actualizarTarea(db, { proyecto_id: pid, actividad_id: b.actividad_id, accion: 'listo' }, CTX_VALE);
  assert.equal(listo.ok, true, JSON.stringify(listo));
});

test('un integrante no puede mover tareas de otra persona; el lote no escribe nada', () => {
  const { db, pid, a, c } = armar();
  const r = Proyectos.reasignarTareas(db, { proyecto_id: pid, actividad_ids: [a.actividad_id, c.actividad_id], responsable_email: 'vale@rld.cl' }, CTX_LUIS);
  assert.equal(r._forbidden, true);
  assert.equal(tarea(db, a.actividad_id).responsable_email, 'luis@rld.cl', 'todo o nada');
});

test('el líder reasigna cualquier tarea; quien recibe debe ser integrante activo y no observador', () => {
  const { db, pid, c, a } = armar();
  assert.equal(Proyectos.reasignarTareas(db, { proyecto_id: pid, actividad_ids: [a.actividad_id], responsable_email: 'obs@rld.cl' }, CTX_LEO)._validationError, true);
  assert.equal(Proyectos.reasignarTareas(db, { proyecto_id: pid, actividad_ids: [a.actividad_id], responsable_email: 'otro@rld.cl' }, CTX_LEO)._validationError, true);
  const r = Proyectos.reasignarTareas(db, { proyecto_id: pid, actividad_ids: JSON.stringify([a.actividad_id, c.actividad_id]), responsable_email: 'vale@rld.cl' }, CTX_LEO);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(tarea(db, c.actividad_id).responsable_email, 'vale@rld.cl');
  assert.equal(Proyectos.reasignarTareas(db, { proyecto_id: pid, actividad_ids: [a.actividad_id], responsable_email: 'vale@rld.cl' }, CTX_OTRO)._forbidden, true);
});

test('una tarea cerrada no se reasigna y frena el lote completo', () => {
  const { db, pid, a, b } = armar();
  Proyectos.actualizarTarea(db, { proyecto_id: pid, actividad_id: b.actividad_id, accion: 'listo' }, CTX_LUIS);
  const r = Proyectos.reasignarTareas(db, { proyecto_id: pid, actividad_ids: [a.actividad_id, b.actividad_id], responsable_email: 'vale@rld.cl' }, CTX_LUIS);
  assert.equal(r._validationError, true);
  assert.equal(tarea(db, a.actividad_id).responsable_email, 'luis@rld.cl');
});

test('quien recibe deja de figurar como colaborador de la tarea', () => {
  const { db, pid, a } = armar();
  Proyectos.editarTarea(db, { proyecto_id: pid, actividad_id: a.actividad_id, colaboradores_emails: ['vale@rld.cl'] }, CTX_LEO);
  Proyectos.reasignarTareas(db, { proyecto_id: pid, actividad_ids: [a.actividad_id], responsable_email: 'vale@rld.cl' }, CTX_LUIS);
  assert.deepEqual(JSON.parse(tarea(db, a.actividad_id).colaboradores_emails), []);
});

test('editarTarea: un colaborador de la tarea no puede reasignarla (solo líder o responsable)', () => {
  const { db, pid, a } = armar();
  Proyectos.editarTarea(db, { proyecto_id: pid, actividad_id: a.actividad_id, colaboradores_emails: ['vale@rld.cl'] }, CTX_LEO);
  const r = Proyectos.editarTarea(db, { proyecto_id: pid, actividad_id: a.actividad_id, responsable_email: 'vale@rld.cl' }, CTX_VALE);
  assert.equal(r._forbidden, true);
});

test('el líder del proyecto puede aprobar una tarea en revisión aunque no sea su supervisor', () => {
  const { db, pid } = armar();
  const t = Proyectos.crearTarea(db, { proyecto_id: pid, titulo: 'Con revisión', responsable_email: 'luis@rld.cl', fecha_compromiso: '2026-12-01', requiere_validacion: true, supervisor_email: 'otro@rld.cl' }, CTX_LEO);
  Proyectos.actualizarTarea(db, { proyecto_id: pid, actividad_id: t.actividad_id, accion: 'listo' }, CTX_LUIS);
  assert.equal(tarea(db, t.actividad_id).estado, 'EN_REVISION');
  assert.equal(Actividades.validar(db, { actividad_id: t.actividad_id }, CTX_VALE)._forbidden, true);
  const ok = Actividades.validar(db, { actividad_id: t.actividad_id }, CTX_LEO);
  assert.equal(ok.estado, 'TERMINADA', JSON.stringify(ok));
});

test('listarMisTareas trae fecha_terminada (Mi trabajo: "Terminadas esta semana")', () => {
  const { db, pid, a } = armar();
  Proyectos.actualizarTarea(db, { proyecto_id: pid, actividad_id: a.actividad_id, accion: 'listo' }, CTX_LUIS);
  const mia = Proyectos.listarMisTareas(db, {}, CTX_LUIS).tareas.find((x) => x.actividad_id === a.actividad_id);
  assert.ok(mia.fecha_terminada, 'debe venir la fecha de término');
});
