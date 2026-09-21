'use strict';

/**
 * Prueba de portabilidad: incremento 2 de Proyectos (v11 Reingeniería
 * Cronograma) -- escenarios de proyectos-registro-dia.test.js +
 * proyectos-p1-control.test.js + proyectos-p3-analitica.test.js, corridos
 * contra backend/logica/proyectos.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, leerFilas_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Proyectos = require('../logica/proyectos');
const Actividades = require('../logica/actividades');

const CTX_LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV' };
const CTX_MARCELO = { email: 'marcelo@rld.cl', nombre: 'Marcelo Integrante', rol: 'DEV' };
const CTX_OTRO = { email: 'otro@rld.cl', nombre: 'Otro Ajeno', rol: 'DEV' };
const CTX_CAMI = { email: 'cami@rld.cl', nombre: 'Cami Colab', rol: 'DEV' };
const CTX_GERENCIA = { email: 'gerencia@rld.cl', nombre: 'Gerencia', rol: 'GERENCIA' };

const TABLAS = [
  'PROYECTOS', 'PROYECTO_INTEGRANTES', 'PROYECTO_HITOS', 'PROYECTO_EVENTOS',
  'PROYECTO_ENTREGABLES', 'PROYECTO_RIESGOS', 'PROYECTO_PLANTILLAS', 'PROYECTO_PLANTILLA_HITOS',
  'SOLICITUDES', 'ACTIVIDADES', 'ACTIVIDADES_BITACORA', 'JEFATURAS',
  'LOG_NOTIFICACIONES', 'CONFIG_FERIADOS', 'NOTIFICACIONES_APP', 'CAT_AREAS'
];
function db_() {
  const db = abrirDb_();
  TABLAS.forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }

function fmtDia_(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
const AYER = fmtDia_(new Date(Date.now() - 24 * 3600 * 1000));
const HOY = fmtDia_(new Date());
const MANANA = fmtDia_(new Date(Date.now() + 2 * 24 * 3600 * 1000));
function haceDias_(n) { return new Date(Date.now() - n * 24 * 3600 * 1000).toISOString(); }
// Fecha comprometida que NO vence, en formato AAAA-MM-DD (no hardcodear una
// fecha absoluta: con el tiempo real avanzando, una fecha fija queda en el
// pasado y "salud: normal" deja de serlo -- mismo criterio que AYER/HOY/
// MANANA de arriba).
function fechaFuturaP1_(dias) { return fmtDia_(new Date(Date.now() + (dias || 30) * 24 * 3600 * 1000)); }

function armarProyectoConTarea(db, opciones) {
  opciones = opciones || {};
  const proyecto = Proyectos.crear(db, { nombre: 'Marketing', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01' }, CTX_LEO);
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  if (opciones.conColaborador) {
    Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'cami@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  }
  const tarea = Proyectos.crearTarea(db, Object.assign({
    proyecto_id: proyecto.proyecto_id, titulo: 'Diseñar campaña', responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-09-20'
  }, opciones.conColaborador ? { colaboradores_emails: ['cami@rld.cl'] } : {}), CTX_LEO);
  return { proyecto, tarea };
}

// ===== guardarRegistroDia / eliminarRegistroDia (P0) ========================

test('guardarRegistroDia: crea un REGISTRO_DIA; listarBitacora expone estado_dia/horas/traza', () => {
  const db = db_();
  const { proyecto, tarea } = armarProyectoConTarea(db);
  const r = Proyectos.guardarRegistroDia(db, { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, dia: AYER, estado_dia: 'en_proceso', horas: 4, nota: 'Avancé el brief' }, CTX_MARCELO);
  assert.equal(r.ok, true);
  assert.equal(r.editado, false);
  assert.equal(filas(db, 'ACTIVIDADES_BITACORA').filter((b) => b.tipo === 'REGISTRO_DIA').length, 1);
  const reg = Proyectos.listarBitacora(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO).find((b) => b.tipo === 'REGISTRO_DIA');
  assert.equal(reg.estado_dia, 'en_proceso');
  assert.equal(reg.horas, 4);
  assert.equal(reg.dia, AYER);
  assert.equal(reg.editado_por, 'marcelo@rld.cl');
  assert.equal(reg.ediciones, 0);
});

test('guardarRegistroDia: re-guardar el mismo dia es UPSERT y acumula historial', () => {
  const db = db_();
  const { proyecto, tarea } = armarProyectoConTarea(db);
  Proyectos.guardarRegistroDia(db, { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, dia: AYER, estado_dia: 'en_proceso', horas: 4, nota: 'v1' }, CTX_MARCELO);
  const r2 = Proyectos.guardarRegistroDia(db, { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, dia: AYER, estado_dia: 'finalizado', horas: 6, nota: 'v2' }, CTX_MARCELO);
  assert.equal(r2.editado, true);
  const filasReg = filas(db, 'ACTIVIDADES_BITACORA').filter((b) => b.tipo === 'REGISTRO_DIA');
  assert.equal(filasReg.length, 1);
  const reg = Proyectos.listarBitacora(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO).find((b) => b.tipo === 'REGISTRO_DIA');
  assert.equal(reg.estado_dia, 'finalizado');
  assert.equal(reg.ediciones, 1);
  const datos = JSON.parse(filasReg[0].datos);
  assert.equal(datos.ediciones[0].estado_dia, 'en_proceso');
  assert.equal(datos.ediciones[0].horas, 4);
  assert.equal(datos.ediciones[0].nota, 'v1');
});

test('guardarRegistroDia: valida estado, horas, dia futuro y motivo de bloqueo', () => {
  const db = db_();
  const { proyecto, tarea } = armarProyectoConTarea(db);
  const base = { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, dia: AYER };
  assert.equal(Proyectos.guardarRegistroDia(db, Object.assign({}, base, { estado_dia: 'inventado' }), CTX_MARCELO)._validationError, true);
  assert.equal(Proyectos.guardarRegistroDia(db, Object.assign({}, base, { estado_dia: 'en_proceso', horas: 99 }), CTX_MARCELO)._validationError, true);
  assert.equal(Proyectos.guardarRegistroDia(db, Object.assign({}, base, { estado_dia: 'bloqueado' }), CTX_MARCELO)._validationError, true);
  assert.equal(Proyectos.guardarRegistroDia(db, { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, dia: MANANA, estado_dia: 'planificado' }, CTX_MARCELO)._validationError, true);
  const ok = Proyectos.guardarRegistroDia(db, Object.assign({}, base, { estado_dia: 'bloqueado', bloqueo_motivo: 'Falta aprobación' }), CTX_MARCELO);
  assert.equal(ok.ok, true);
  const okHoy = Proyectos.guardarRegistroDia(db, { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, dia: HOY, estado_dia: 'en_proceso' }, CTX_MARCELO);
  assert.equal(okHoy.ok, true);
});

test('guardarRegistroDia: permisos -- responsable, colaborador y lider pueden; un ajeno no', () => {
  const db = db_();
  const { proyecto, tarea } = armarProyectoConTarea(db, { conColaborador: true });
  const base = { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, dia: AYER, estado_dia: 'en_proceso' };
  assert.equal(Proyectos.guardarRegistroDia(db, base, CTX_MARCELO).ok, true);
  assert.equal(Proyectos.guardarRegistroDia(db, base, CTX_CAMI).ok, true);
  assert.equal(Proyectos.guardarRegistroDia(db, base, CTX_LEO).ok, true);
  assert.equal(Proyectos.guardarRegistroDia(db, base, CTX_OTRO)._forbidden, true);
});

test('guardarRegistroDia: listarMiBitacora incluye mis registros con estado_dia', () => {
  const db = db_();
  const { proyecto, tarea } = armarProyectoConTarea(db);
  Proyectos.guardarRegistroDia(db, { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, dia: AYER, estado_dia: 'entregado', horas: 3 }, CTX_MARCELO);
  const reg = Proyectos.listarMiBitacora(db, {}, CTX_MARCELO).find((b) => b.tipo === 'REGISTRO_DIA');
  assert.ok(reg);
  assert.equal(reg.estado_dia, 'entregado');
  assert.equal(reg.horas, 3);
});

test('eliminarRegistroDia: borra el REGISTRO_DIA de (tarea,dia) sin tocar otros', () => {
  const db = db_();
  const { proyecto, tarea } = armarProyectoConTarea(db);
  Proyectos.guardarRegistroDia(db, { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, dia: AYER, estado_dia: 'en_proceso', horas: 4 }, CTX_MARCELO);
  Proyectos.guardarRegistroDia(db, { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, dia: HOY, estado_dia: 'entregado', horas: 2 }, CTX_MARCELO);

  const r = Proyectos.eliminarRegistroDia(db, { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, dia: AYER }, CTX_MARCELO);
  assert.equal(r.ok, true);
  assert.equal(r.eliminado, true);
  const registros = filas(db, 'ACTIVIDADES_BITACORA').filter((b) => b.tipo === 'REGISTRO_DIA');
  assert.equal(registros.length, 1, 'queda solo el de HOY');
  const bitacora = Proyectos.listarBitacora(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(bitacora.filter((b) => b.tipo === 'REGISTRO_DIA' && b.dia === AYER).length, 0);
  assert.equal(bitacora.filter((b) => b.tipo === 'REGISTRO_DIA' && b.dia === HOY).length, 1);
});

test('eliminarRegistroDia: valida existencia y permisos', () => {
  const db = db_();
  const { proyecto, tarea } = armarProyectoConTarea(db);
  Proyectos.guardarRegistroDia(db, { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, dia: AYER, estado_dia: 'en_proceso', horas: 4 }, CTX_MARCELO);
  assert.equal(Proyectos.eliminarRegistroDia(db, { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, dia: HOY }, CTX_MARCELO)._validationError, true, 'dia sin registro');
  assert.equal(Proyectos.eliminarRegistroDia(db, { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, dia: AYER }, CTX_OTRO)._forbidden, true);
  assert.equal(Proyectos.eliminarRegistroDia(db, { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, dia: AYER }, CTX_LEO).ok, true);
});

// ===== congelarBaseline / obtenerRendimiento (P1) ===========================

function armarProyectoP1(db, overridesTarea) {
  const proyecto = Proyectos.crear(db, { nombre: 'Migración ERP', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01' }, CTX_LEO);
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  const fechaCompromiso = (overridesTarea && 'fecha_compromiso' in overridesTarea) ? overridesTarea.fecha_compromiso : fechaFuturaP1_();
  const tarea = Proyectos.crearTarea(db, Object.assign({ proyecto_id: proyecto.proyecto_id, titulo: 'Levantar requerimientos', responsable_email: 'marcelo@rld.cl', fecha_compromiso: fechaCompromiso }, overridesTarea || {}), CTX_LEO);
  if (fechaCompromiso) {
    Actividades.confirmar(db, { actividad_id: tarea.actividad_id, fecha_compromiso: fechaCompromiso }, CTX_MARCELO);
    tarea.fecha_compromiso = fechaCompromiso;
  }
  return { proyecto, tarea };
}

test('congelarBaseline: exclusivo lider/ADM; guarda evento BASELINE con la foto de fechas', () => {
  const db = db_();
  const { proyecto, tarea } = armarProyectoP1(db);
  assert.equal(Proyectos.congelarBaseline(db, { proyecto_id: proyecto.proyecto_id }, CTX_MARCELO)._forbidden, true);
  const r = Proyectos.congelarBaseline(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(r.ok, true);
  assert.equal(r.total_tareas, 1);
  const eventos = filas(db, 'PROYECTO_EVENTOS').filter((e) => e.proyecto_id === proyecto.proyecto_id && e.tipo === 'BASELINE');
  assert.equal(eventos.length, 1);
  const snapshot = JSON.parse(eventos[0].cuerpo);
  assert.equal(snapshot.tareas[0].actividad_id, tarea.actividad_id);
  assert.equal(snapshot.tareas[0].fecha_fin, fechaFuturaP1_());
});

test('congelarBaseline: la mas reciente es la vigente; re-congelar no borra la anterior', () => {
  const db = db_();
  const { proyecto, tarea } = armarProyectoP1(db);
  Proyectos.congelarBaseline(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  Actividades.reprogramar(db, { actividad_id: tarea.actividad_id, fecha_compromiso: '2026-10-05', motivo: 'Cliente pidió más tiempo' }, CTX_LEO);
  Proyectos.congelarBaseline(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(filas(db, 'PROYECTO_EVENTOS').filter((e) => e.proyecto_id === proyecto.proyecto_id && e.tipo === 'BASELINE').length, 2);
  const rendimiento = Proyectos.obtenerRendimiento(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const fila = rendimiento.plan_seguimiento.find((t) => t.actividad_id === tarea.actividad_id);
  assert.equal(fila.baseline_fin, '2026-10-05');
  assert.equal(fila.plan_fin, '2026-10-05');
  assert.ok(rendimiento.baseline);
});

test('obtenerRendimiento: Plan/Esperado/Real por tarea, para TODA tarea activa', () => {
  const db = db_();
  const ahora = new Date();
  const inicio = new Date(ahora.getTime() - 10 * 86400000).toISOString().slice(0, 10);
  const fin = new Date(ahora.getTime() + 10 * 86400000).toISOString().slice(0, 10);
  const { proyecto, tarea } = armarProyectoP1(db, { fecha_compromiso: fin });
  actualizarFilaPorId_(db, 'ACTIVIDADES', 'actividad_id', tarea.actividad_id, { fecha_creacion: inicio });

  const sinAvance = Proyectos.obtenerRendimiento(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const filaSinAvance = sinAvance.plan_seguimiento.find((t) => t.actividad_id === tarea.actividad_id);
  assert.ok(filaSinAvance.avance_esperado_pct > 40 && filaSinAvance.avance_esperado_pct < 60);
  assert.equal(filaSinAvance.avance_real_pct, 0);

  Actividades.checkin(db, { actividad_id: tarea.actividad_id, tipo: 'avance', avance_pct: 20 }, CTX_MARCELO);
  const conAvance = Proyectos.obtenerRendimiento(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const filaConAvance = conAvance.plan_seguimiento.find((t) => t.actividad_id === tarea.actividad_id);
  assert.equal(filaConAvance.avance_real_pct, 20);
  assert.ok(filaConAvance.desviacion_pp < 0);
});

test('obtenerRendimiento: tarea pendiente de confirmar (RN-710), Esperado es null', () => {
  const db = db_();
  const proyecto = Proyectos.crear(db, { nombre: 'Migración ERP', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01' }, CTX_LEO);
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  const tarea = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Por confirmar', responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-09-20' }, CTX_LEO);
  const r = Proyectos.obtenerRendimiento(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const fila = r.plan_seguimiento.find((t) => t.actividad_id === tarea.actividad_id);
  assert.equal(fila.plan_fin, '');
  assert.equal(fila.avance_esperado_pct, null);
  assert.equal(fila.desviacion_pp, null);
});

test('salud: expone score 0-100 ponderado consistente con los motivos; normal=100', () => {
  const db = db_();
  const { proyecto } = armarProyectoP1(db);
  const sano = Proyectos.getDetalle(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(sano.salud, 'normal');
  assert.equal(sano.salud_score, 100);
  assert.deepEqual(sano.salud_desglose, []);

  const vencida = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Urgente', responsable_email: 'marcelo@rld.cl', prioridad: 'P1', fecha_compromiso: '2020-01-01' }, CTX_LEO);
  Actividades.confirmar(db, { actividad_id: vencida.actividad_id, fecha_compromiso: '2020-01-01' }, CTX_MARCELO);
  const critico = Proyectos.getDetalle(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(critico.salud, 'critico');
  assert.equal(critico.salud_score, 100 - 12);
  assert.equal(critico.salud_desglose[0].factor, 'tarea_critica_atrasada');
});

test('salud_override: no calcula score (null)', () => {
  const db = db_();
  const { proyecto } = armarProyectoP1(db);
  actualizarFilaPorId_(db, 'PROYECTOS', 'proyecto_id', proyecto.proyecto_id, { salud_override: 'critico', salud_override_motivo: 'Cliente pausó el proyecto' });
  const detalle = Proyectos.getDetalle(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(detalle.salud, 'critico');
  assert.equal(detalle.salud_score, null);
});

test('reprogramarTarea: delega en Actividades.reprogramar; el lider puede; un ajeno no; rechaza de otro proyecto', () => {
  const db = db_();
  const { proyecto, tarea } = armarProyectoP1(db);
  assert.equal(Proyectos.reprogramarTarea(db, { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, fecha_compromiso: '2026-10-01', motivo: 'x' }, CTX_OTRO)._forbidden, true);
  assert.equal(Proyectos.reprogramarTarea(db, { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, fecha_compromiso: '2026-10-01' }, CTX_LEO)._validationError, true);
  const ok = Proyectos.reprogramarTarea(db, { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, fecha_compromiso: '2026-10-01', motivo: 'Cliente pidió más tiempo' }, CTX_LEO);
  assert.equal(ok.fecha_compromiso, '2026-10-01');
  const evento = Proyectos.listarBitacora(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO).find((b) => b.tipo === 'REPROGRAMACION');
  assert.equal(evento.fecha_anterior, fechaFuturaP1_());
  assert.equal(evento.fecha_nueva, '2026-10-01');

  const otroProyecto = Proyectos.crear(db, { nombre: 'Otro', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01' }, CTX_LEO);
  assert.equal(Proyectos.reprogramarTarea(db, { proyecto_id: otroProyecto.proyecto_id, actividad_id: tarea.actividad_id, fecha_compromiso: '2026-10-01', motivo: 'x' }, CTX_LEO)._validationError, true);
});

// ===== obtenerAnalitica / obtenerWorkloadPortafolio (P3) ====================

function armarProyectoP3(db) {
  const proyecto = Proyectos.crear(db, { nombre: 'Migración ERP', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01' }, CTX_LEO);
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  return proyecto;
}

test('obtenerAnalitica: lead/cycle time solo en tareas TERMINADAS; null si no ha terminado', () => {
  const db = db_();
  const proyecto = armarProyectoP3(db);
  const tarea = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Migrar BD', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);
  actualizarFilaPorId_(db, 'ACTIVIDADES', 'actividad_id', tarea.actividad_id, { fecha_creacion: haceDias_(10) });
  const creada = filas(db, 'ACTIVIDADES_BITACORA').filter((b) => b.actividad_id === tarea.actividad_id);
  actualizarFilaPorId_(db, 'ACTIVIDADES_BITACORA', 'bitacora_id', creada[0].bitacora_id, { timestamp: haceDias_(10) });
  Actividades.checkin(db, { actividad_id: tarea.actividad_id, tipo: 'avance', avance_pct: 40 }, CTX_LEO);
  const avanceFila = filas(db, 'ACTIVIDADES_BITACORA').filter((b) => b.tipo === 'CHECKIN_AVANCE')[0];
  actualizarFilaPorId_(db, 'ACTIVIDADES_BITACORA', 'bitacora_id', avanceFila.bitacora_id, { timestamp: haceDias_(6) });
  Actividades.checkin(db, { actividad_id: tarea.actividad_id, tipo: 'listo' }, CTX_LEO);

  const analitica = Proyectos.obtenerAnalitica(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const fila = analitica.por_tarea.find((t) => t.actividad_id === tarea.actividad_id);
  assert.ok(fila.lead_time_dias >= 9.9 && fila.lead_time_dias <= 10.1);
  assert.ok(fila.cycle_time_dias >= 5.9 && fila.cycle_time_dias <= 6.1);
  assert.ok(fila.cycle_time_dias < fila.lead_time_dias);

  const db2 = db_();
  const p2 = armarProyectoP3(db2);
  const enCurso = Proyectos.crearTarea(db2, { proyecto_id: p2.proyecto_id, titulo: 'En curso', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);
  Actividades.checkin(db2, { actividad_id: enCurso.actividad_id, tipo: 'avance', avance_pct: 20 }, CTX_LEO);
  const fila2 = Proyectos.obtenerAnalitica(db2, { proyecto_id: p2.proyecto_id }, CTX_LEO).por_tarea.find((t) => t.actividad_id === enCurso.actividad_id);
  assert.equal(fila2.lead_time_dias, null);
  assert.equal(fila2.cycle_time_dias, null);
});

test('obtenerAnalitica: tiempo en bloqueo suma cada ciclo; sigue contando si quedo bloqueada', () => {
  const db = db_();
  const proyecto = armarProyectoP3(db);
  const tarea = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Con bloqueos', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);
  Actividades.checkin(db, { actividad_id: tarea.actividad_id, tipo: 'bloqueo', bloqueo_motivo: 'Esperando acceso' }, CTX_LEO);
  const bloqueo1 = filas(db, 'ACTIVIDADES_BITACORA').filter((b) => b.tipo === 'BLOQUEO')[0];
  actualizarFilaPorId_(db, 'ACTIVIDADES_BITACORA', 'bitacora_id', bloqueo1.bitacora_id, { timestamp: haceDias_(5) });
  Actividades.checkin(db, { actividad_id: tarea.actividad_id, tipo: 'desbloqueo' }, CTX_LEO);
  const desbloqueo1 = filas(db, 'ACTIVIDADES_BITACORA').filter((b) => b.tipo === 'DESBLOQUEO')[0];
  actualizarFilaPorId_(db, 'ACTIVIDADES_BITACORA', 'bitacora_id', desbloqueo1.bitacora_id, { timestamp: haceDias_(3) });
  Actividades.checkin(db, { actividad_id: tarea.actividad_id, tipo: 'bloqueo', bloqueo_motivo: 'Otro impedimento' }, CTX_LEO);
  const bloqueos = filas(db, 'ACTIVIDADES_BITACORA').filter((b) => b.tipo === 'BLOQUEO');
  actualizarFilaPorId_(db, 'ACTIVIDADES_BITACORA', 'bitacora_id', bloqueos[1].bitacora_id, { timestamp: haceDias_(1) });

  const analitica = Proyectos.obtenerAnalitica(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const fila = analitica.por_tarea.find((t) => t.actividad_id === tarea.actividad_id);
  assert.ok(fila.tiempo_bloqueo_dias >= 2.8 && fila.tiempo_bloqueo_dias <= 3.2, 'tiempo_bloqueo_dias=' + fila.tiempo_bloqueo_dias);
});

test('obtenerAnalitica: tiempo en revision 0 sin requiere_validacion; mide entrega->validacion cuando si', () => {
  const db = db_();
  const proyecto = armarProyectoP3(db);
  const sinVal = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Sin validación', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);
  Actividades.checkin(db, { actividad_id: sinVal.actividad_id, tipo: 'listo' }, CTX_LEO);
  const filaSinVal = Proyectos.obtenerAnalitica(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO).por_tarea.find((t) => t.actividad_id === sinVal.actividad_id);
  assert.equal(filaSinVal.tiempo_revision_dias, 0);

  const conVal = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Con validación', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01', requiere_validacion: true }, CTX_LEO);
  Actividades.checkin(db, { actividad_id: conVal.actividad_id, tipo: 'listo' }, CTX_LEO);
  const entrega = filas(db, 'ACTIVIDADES_BITACORA').filter((b) => b.tipo === 'ENTREGA' && b.actividad_id === conVal.actividad_id)[0];
  actualizarFilaPorId_(db, 'ACTIVIDADES_BITACORA', 'bitacora_id', entrega.bitacora_id, { timestamp: haceDias_(2) });
  Actividades.validar(db, { actividad_id: conVal.actividad_id, aprobar: true }, CTX_LEO);
  const filaConVal = Proyectos.obtenerAnalitica(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO).por_tarea.find((t) => t.actividad_id === conVal.actividad_id);
  assert.ok(filaConVal.tiempo_revision_dias >= 1.9 && filaConVal.tiempo_revision_dias <= 2.1);
});

test('obtenerAnalitica: promedios/sumas solo sobre lo medible; exige poder VER el proyecto', () => {
  const db = db_();
  const proyecto = armarProyectoP3(db);
  const t1 = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'T1', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);
  Actividades.checkin(db, { actividad_id: t1.actividad_id, tipo: 'listo' }, CTX_LEO);
  Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'T2', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);
  const analitica = Proyectos.obtenerAnalitica(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.ok(analitica.lead_time_promedio_dias !== null);
  assert.equal(typeof analitica.tiempo_bloqueo_total_dias, 'number');
  assert.equal(Proyectos.obtenerAnalitica(db, { proyecto_id: proyecto.proyecto_id }, CTX_OTRO)._forbidden, true);
});

test('obtenerWorkloadPortafolio: cruza tareas/bitacora de todos los proyectos visibles; acota por membresia; GERENCIA ve todo', () => {
  const db = db_();
  const proyectoA = armarProyectoP3(db);
  const proyectoB = Proyectos.crear(db, { nombre: 'Otro proyecto', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01' }, CTX_LEO);
  const tareaA = Proyectos.crearTarea(db, { proyecto_id: proyectoA.proyecto_id, titulo: 'Tarea A', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);
  const tareaB = Proyectos.crearTarea(db, { proyecto_id: proyectoB.proyecto_id, titulo: 'Tarea B', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);
  Actividades.checkin(db, { actividad_id: tareaA.actividad_id, tipo: 'avance', horas: 3 }, CTX_LEO);
  Actividades.checkin(db, { actividad_id: tareaB.actividad_id, tipo: 'avance', horas: 2 }, CTX_LEO);

  const workload = Proyectos.obtenerWorkloadPortafolio(db, {}, CTX_LEO);
  assert.equal(workload.proyectos.length, 2);
  assert.deepEqual(workload.tareas.map((t) => t.titulo).sort(), ['Tarea A', 'Tarea B']);
  assert.equal(workload.bitacora.filter((b) => b.horas).length, 2);
  assert.equal(workload.tareas.find((t) => t.actividad_id === tareaA.actividad_id).proyecto_nombre, 'Migración ERP');

  const workloadMarcelo = Proyectos.obtenerWorkloadPortafolio(db, {}, CTX_MARCELO);
  assert.equal(workloadMarcelo.proyectos.length, 1);
  assert.equal(workloadMarcelo.proyectos[0].proyecto_id, proyectoA.proyecto_id);

  const workloadGerencia = Proyectos.obtenerWorkloadPortafolio(db, {}, CTX_GERENCIA);
  assert.equal(workloadGerencia.proyectos.length, 2);
});
