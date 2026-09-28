'use strict';

/**
 * Mejoras de control de proyectos (2026-09-28):
 *  1. Eliminar proyecto (borrado lógico con confirmación y motivo).
 *  2. Plan vs real: inicio de plan, inicio real y término real de cada tarea.
 *  3. Costos con respaldo: documento tributario, desglose, archivo y resumen.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, leerFilas_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Proyectos = require('../logica/proyectos');
const Actividades = require('../logica/actividades');
const Utils = require('../logica/utils');

const CTX_LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV' };
const CTX_MARCELO = { email: 'marcelo@rld.cl', nombre: 'Marcelo Integrante', rol: 'DEV' };
const CTX_ADM = { email: 'admin@rld.cl', nombre: 'Admin', rol: 'ADM' };
const HOY = Utils.claveDia_(new Date(), 'America/Santiago');
const MANANA = Utils.claveDia_(new Date(Date.now() + 2 * 86400000), 'America/Santiago');

function db_() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function armar(db) {
  const p = Proyectos.crear(db, { codigo: 'ISO-TEST', nombre: 'Certificación de prueba', fecha_inicio: '2026-05-01', fecha_objetivo: '2026-12-31' }, CTX_LEO);
  Proyectos.gestionarIntegrante(db, { proyecto_id: p.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  return p;
}
function tarea(db, id) { return leerFilas_(db, 'ACTIVIDADES', COLUMNAS.ACTIVIDADES).find((a) => a.actividad_id === id); }

// ===== 1. Eliminar proyecto =====================================================

test('eliminar: pide escribir el código o nombre y un motivo; solo líder o ADM', () => {
  const db = db_();
  const p = armar(db);
  assert.equal(Proyectos.eliminar(db, { proyecto_id: p.proyecto_id, confirmacion: 'otro', motivo: 'x' }, CTX_LEO)._validationError, true);
  assert.equal(Proyectos.eliminar(db, { proyecto_id: p.proyecto_id, confirmacion: 'ISO-TEST', motivo: '' }, CTX_LEO)._validationError, true);
  assert.equal(Proyectos.eliminar(db, { proyecto_id: p.proyecto_id, confirmacion: 'ISO-TEST', motivo: 'x' }, CTX_MARCELO)._forbidden, true);
  const r = Proyectos.eliminar(db, { proyecto_id: p.proyecto_id, confirmacion: 'certificación de prueba', motivo: 'Creado por error' }, CTX_ADM);
  assert.equal(r.eliminado, true);
});

test('eliminar: el proyecto y sus tareas dejan de verse en todo SIGSO, pero no se borran', () => {
  const db = db_();
  const p = armar(db);
  const t = Proyectos.crearTarea(db, { proyecto_id: p.proyecto_id, titulo: 'Tarea', responsable_email: 'leo@rld.cl', fecha_compromiso: '2020-01-01' }, CTX_LEO);
  Proyectos.eliminar(db, { proyecto_id: p.proyecto_id, confirmacion: 'ISO-TEST', motivo: 'Duplicado' }, CTX_LEO);
  assert.equal(Proyectos.listar(db, {}, CTX_LEO).length, 0);
  assert.equal(Proyectos.getDetalle(db, { proyecto_id: p.proyecto_id }, CTX_LEO)._validationError, true, 'no se abre por enlace');
  assert.equal(Proyectos.crearTarea(db, { proyecto_id: p.proyecto_id, titulo: 'Otra', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-12-01' }, CTX_LEO)._validationError, true);
  assert.equal(Proyectos.listarMisTareas(db, {}, CTX_LEO).tareas.length, 0);
  assert.ok(tarea(db, t.actividad_id), 'la tarea sigue guardada');
  const fila = leerFilas_(db, 'PROYECTOS', COLUMNAS.PROYECTOS)[0];
  assert.equal(fila.activa, false);
  assert.ok(leerFilas_(db, 'LOG_SISTEMA', COLUMNAS.LOG_SISTEMA).some((l) => l.contexto === 'PROYECTO_ELIMINADO'));
});

// ===== 2. Plan vs real ==========================================================

test('plan vs real: el inicio de plan propio manda sobre la fecha de creación', () => {
  const db = db_();
  const p = armar(db);
  const t = Proyectos.crearTarea(db, { proyecto_id: p.proyecto_id, titulo: 'Histórica', responsable_email: 'leo@rld.cl', fecha_inicio_plan: '2026-05-12', fecha_compromiso: '2026-05-15' }, CTX_LEO);
  const plan = Proyectos.obtenerRendimiento(db, { proyecto_id: p.proyecto_id }, CTX_LEO).plan_seguimiento.find((x) => x.actividad_id === t.actividad_id);
  assert.equal(plan.plan_inicio, '2026-05-12');
  assert.equal(plan.plan_fin, '2026-05-15');
});

test('plan vs real: se editan inicio de plan, inicio real y término real, con validaciones', () => {
  const db = db_();
  const p = armar(db);
  const t = Proyectos.crearTarea(db, { proyecto_id: p.proyecto_id, titulo: 'T', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-06-30' }, CTX_LEO);
  const base = { proyecto_id: p.proyecto_id, actividad_id: t.actividad_id };
  assert.equal(Proyectos.editarTarea(db, Object.assign({ fecha_inicio_plan: '2026-07-10' }, base), CTX_LEO)._validationError, true, 'inicio de plan después del término');
  assert.equal(Proyectos.editarTarea(db, Object.assign({ fecha_inicio_real: MANANA }, base), CTX_LEO)._validationError, true, 'inicio real futuro');
  assert.equal(Proyectos.editarTarea(db, Object.assign({ fecha_terminada: '2026-06-20' }, base), CTX_LEO)._validationError, true, 'término real sin estar terminada');
  Proyectos.editarTarea(db, Object.assign({ fecha_inicio_plan: '2026-06-01', fecha_inicio_real: '2026-06-03' }, base), CTX_LEO);
  Proyectos.actualizarTarea(db, Object.assign({ accion: 'listo', dia: '2026-06-25' }, base), CTX_LEO);
  assert.equal(Proyectos.editarTarea(db, Object.assign({ fecha_terminada: '2026-06-01' }, base), CTX_LEO)._validationError, true, 'término antes del inicio real');
  Proyectos.editarTarea(db, Object.assign({ fecha_terminada: '2026-06-28' }, base), CTX_LEO);
  const a = tarea(db, t.actividad_id);
  assert.deepEqual([a.fecha_inicio_plan, a.fecha_compromiso, a.fecha_inicio_real, a.fecha_terminada], ['2026-06-01', '2026-06-30', '2026-06-03', '2026-06-28']);
  const plan = Proyectos.obtenerRendimiento(db, { proyecto_id: p.proyecto_id }, CTX_LEO).plan_seguimiento[0];
  assert.equal(plan.fecha_inicio_real, '2026-06-03', 'el inicio real guardado manda sobre el derivado');
  assert.equal(plan.fecha_fin_real, '2026-06-28');
});

test('plan vs real: el inicio real se registra solo la primera vez que se trabaja la tarea', () => {
  const db = db_();
  const p = armar(db);
  const t = Proyectos.crearTarea(db, { proyecto_id: p.proyecto_id, titulo: 'T', responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-12-01' }, CTX_LEO);
  Actividades.confirmar(db, { actividad_id: t.actividad_id }, CTX_MARCELO);
  assert.equal(tarea(db, t.actividad_id).fecha_inicio_real, '');
  Proyectos.actualizarTarea(db, { proyecto_id: p.proyecto_id, actividad_id: t.actividad_id, accion: 'avance', avance_pct: 20, dia: '2026-09-01' }, CTX_MARCELO);
  assert.equal(tarea(db, t.actividad_id).fecha_inicio_real, '2026-09-01');
  Proyectos.actualizarTarea(db, { proyecto_id: p.proyecto_id, actividad_id: t.actividad_id, accion: 'avance', avance_pct: 50 }, CTX_MARCELO);
  assert.equal(tarea(db, t.actividad_id).fecha_inicio_real, '2026-09-01', 'no se pisa con el día de un avance posterior');
});

// ===== 3. Costos con respaldo =====================================================

test('costos: un pago "pagado" exige fecha y monto de pago', () => {
  const db = db_();
  const p = armar(db);
  const base = { proyecto_id: p.proyecto_id, nombre: 'Cuota 1', fecha_proyectada: '2026-05-12', monto_proyectado: 1000, estado: 'pagado' };
  assert.equal(Proyectos.gestionarEstadoPago(db, base, CTX_LEO)._validationError, true);
  assert.equal(Proyectos.gestionarEstadoPago(db, Object.assign({ fecha_real: '2026-05-15' }, base), CTX_LEO)._validationError, true);
  assert.ok(Proyectos.gestionarEstadoPago(db, Object.assign({ fecha_real: '2026-05-15', monto_real: 1000 }, base), CTX_LEO).estado_pago_id);
});

test('costos: guarda documento, desglose y respaldo del proyecto; resume comprometido, pagado y saldo', () => {
  const db = db_();
  const p = armar(db);
  agregarFila_(db, 'PROYECTO_DOCUMENTOS', { documento_id: 'doc-1', proyecto_id: p.proyecto_id, nombre: 'Factura N°534', categoria: 'CONTRATO', activo: true });
  agregarFila_(db, 'PROYECTO_DOCUMENTOS', { documento_id: 'doc-ajeno', proyecto_id: 'otro', nombre: 'Ajeno', categoria: 'OTRO', activo: true });
  Proyectos.actualizar(db, { proyecto_id: p.proyecto_id, presupuesto_monto: 3000, presupuesto_moneda: 'CLP' }, CTX_LEO);
  const bien = { proyecto_id: p.proyecto_id, nombre: 'Cuota 1/3', proveedor: 'PRT Auditores', documento_numero: '534', fecha_documento: '2026-05-12',
    monto_neto: 840, monto_impuesto: 160, fecha_proyectada: '2026-05-12', monto_proyectado: 1000, estado: 'pagado', fecha_real: '2026-05-15', monto_real: 1000, documento_id: 'doc-1' };
  assert.equal(Proyectos.gestionarEstadoPago(db, Object.assign({}, bien, { documento_id: 'doc-ajeno' }), CTX_LEO)._validationError, true, 'respaldo de otro proyecto');
  const e = Proyectos.gestionarEstadoPago(db, bien, CTX_LEO);
  assert.deepEqual([e.proveedor, e.documento_numero, e.fecha_documento, e.monto_neto, e.monto_impuesto], ['PRT Auditores', '534', '2026-05-12', 840, 160]);
  Proyectos.gestionarEstadoPago(db, { proyecto_id: p.proyecto_id, nombre: 'Cuota 2/3', fecha_proyectada: '2026-06-01', monto_proyectado: 1000, estado: 'facturado' }, CTX_LEO);
  Proyectos.gestionarEstadoPago(db, { proyecto_id: p.proyecto_id, nombre: 'Cuota 3/3', fecha_proyectada: '2026-07-01', monto_proyectado: 1000 }, CTX_LEO);
  const l = Proyectos.listarEstadosPago(db, { proyecto_id: p.proyecto_id }, CTX_LEO);
  assert.equal(l.estados[0].documento_nombre, 'Factura N°534');
  assert.equal(l.documentos.length, 1, 'solo los documentos de este proyecto para elegir respaldo');
  const r = l.resumen;
  assert.deepEqual([r.presupuesto, r.comprometido, r.pagado, r.facturado_por_pagar, r.por_pagar, r.sin_comprometer, r.ejecucion_pct], [3000, 3000, 1000, 1000, 2000, 0, 33.3]);
  assert.equal(r.proximo_pago.nombre, 'Cuota 2/3');
});
