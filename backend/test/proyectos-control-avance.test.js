'use strict';

/**
 * Fase H (Camino B, 2026-09-22): avance físico -- curva S de control manual
 * (Proyectos.gestionarControlAvance/listarControlAvance). Ver
 * documentacion/SIGSO-Proyectos-2.0-auditoria-y-propuesta.md §13/§18.
 *
 * Lo que estos tests protegen, por orden de importancia:
 *  1. Solo quien GESTIONA el proyecto (líder/ADM) puede escribir la curva --
 *     es una declaración de gestión, no un dato operativo de cualquiera.
 *  2. Un control_id de OTRO proyecto no se puede tocar solo por conocer su id
 *     (mismo vector que ya se cerró en gestionarRiesgo -- ver su comentario).
 *  3. Validación de rango (0-100) y upsert por fecha (no duplica).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Proyectos = require('../logica/proyectos');

const CTX_LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV' };
const CTX_MARCELO = { email: 'marcelo@rld.cl', nombre: 'Marcelo Integrante', rol: 'DEV' };
const CTX_OTRO = { email: 'otro@rld.cl', nombre: 'Otro Ajeno', rol: 'DEV' };
const CTX_ADM = { email: 'admin@rld.cl', nombre: 'Admin', rol: 'ADM' };
const CTX_GERENCIA = { email: 'gerencia@rld.cl', nombre: 'Gerencia', rol: 'GERENCIA' };

const TABLAS = [
  'PROYECTOS', 'PROYECTO_INTEGRANTES', 'PROYECTO_HITOS', 'PROYECTO_EVENTOS',
  'PROYECTO_ENTREGABLES', 'PROYECTO_RIESGOS', 'PROYECTO_CONTROL_AVANCE',
  'ACTIVIDADES', 'ACTIVIDADES_BITACORA', 'CAT_AREAS'
];

function db_() {
  const db = abrirDb_();
  TABLAS.forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }

function crearProyectoBase(db, over) {
  return Proyectos.crear(db, Object.assign({ nombre: 'Migración ERP', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-10-01' }, over), CTX_LEO);
}
function armarProyectoConMarcelo(db) {
  const proyecto = crearProyectoBase(db);
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  return proyecto;
}

// --- crear / editar ----------------------------------------------------------

test('gestionarControlAvance: el líder registra un punto de control', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const r = Proyectos.gestionarControlAvance(db, {
    proyecto_id: proyecto.proyecto_id, fecha: '2026-09-01', pct_proyectado: 20, pct_real: 15, nota: 'Arranque lento'
  }, CTX_LEO);
  assert.ok(r.control_id);
  assert.equal(r.pct_proyectado, 20);
  assert.equal(r.pct_real, 15);
  assert.equal(r.nota, 'Arranque lento');
  assert.equal(r.registrado_por, 'leo@rld.cl');
  assert.equal(filas(db, 'PROYECTO_CONTROL_AVANCE').length, 1);
});

test('gestionarControlAvance: pct_real es opcional (fecha futura, sin real todavía)', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const r = Proyectos.gestionarControlAvance(db, {
    proyecto_id: proyecto.proyecto_id, fecha: '2026-12-01', pct_proyectado: 80
  }, CTX_LEO);
  assert.equal(r.pct_proyectado, 80);
  assert.equal(r.pct_real, '');
});

test('gestionarControlAvance: UPSERT por fecha -- reeditar el mismo día actualiza, no duplica', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const primero = Proyectos.gestionarControlAvance(db, {
    proyecto_id: proyecto.proyecto_id, fecha: '2026-09-01', pct_proyectado: 20, pct_real: 15
  }, CTX_LEO);
  const segundo = Proyectos.gestionarControlAvance(db, {
    proyecto_id: proyecto.proyecto_id, fecha: '2026-09-01', pct_proyectado: 20, pct_real: 18, nota: 'Corrección'
  }, CTX_LEO);
  assert.equal(segundo.control_id, primero.control_id, 'mismo id: se actualizó, no se creó otro');
  assert.equal(segundo.pct_real, 18);
  assert.equal(filas(db, 'PROYECTO_CONTROL_AVANCE').length, 1, 'una sola fila para esa fecha');
});

test('gestionarControlAvance: valida rango 0-100 y fecha obligatoria', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  assert.equal(Proyectos.gestionarControlAvance(db, { proyecto_id: proyecto.proyecto_id, pct_proyectado: 50 }, CTX_LEO)._validationError, true, 'sin fecha');
  assert.equal(Proyectos.gestionarControlAvance(db, { proyecto_id: proyecto.proyecto_id, fecha: '2026-09-01', pct_proyectado: 150 }, CTX_LEO)._validationError, true, 'proyectado fuera de rango');
  assert.equal(Proyectos.gestionarControlAvance(db, { proyecto_id: proyecto.proyecto_id, fecha: '2026-09-01', pct_proyectado: 50, pct_real: -5 }, CTX_LEO)._validationError, true, 'real fuera de rango');
  assert.equal(filas(db, 'PROYECTO_CONTROL_AVANCE').length, 0);
});

// --- permisos ------------------------------------------------------------------

test('gestionarControlAvance: un integrante SIN rol de líder no puede escribir la curva', () => {
  const db = db_();
  const proyecto = armarProyectoConMarcelo(db);
  const r = Proyectos.gestionarControlAvance(db, { proyecto_id: proyecto.proyecto_id, fecha: '2026-09-01', pct_proyectado: 30 }, CTX_MARCELO);
  assert.equal(r._forbidden, true);
  assert.equal(filas(db, 'PROYECTO_CONTROL_AVANCE').length, 0);
});

test('gestionarControlAvance: ADM sí puede, GERENCIA no (mismo criterio que congelarBaseline)', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const adm = Proyectos.gestionarControlAvance(db, { proyecto_id: proyecto.proyecto_id, fecha: '2026-09-01', pct_proyectado: 10 }, CTX_ADM);
  assert.ok(adm.control_id);
  const ger = Proyectos.gestionarControlAvance(db, { proyecto_id: proyecto.proyecto_id, fecha: '2026-09-02', pct_proyectado: 10 }, CTX_GERENCIA);
  assert.equal(ger._forbidden, true);
});

test('listarControlAvance: cualquier integrante ve la curva; un ajeno no', () => {
  const db = db_();
  const proyecto = armarProyectoConMarcelo(db);
  Proyectos.gestionarControlAvance(db, { proyecto_id: proyecto.proyecto_id, fecha: '2026-09-01', pct_proyectado: 20, pct_real: 15 }, CTX_LEO);

  const paraMarcelo = Proyectos.listarControlAvance(db, { proyecto_id: proyecto.proyecto_id }, CTX_MARCELO);
  assert.equal(paraMarcelo.puntos.length, 1);

  const paraAjeno = Proyectos.listarControlAvance(db, { proyecto_id: proyecto.proyecto_id }, CTX_OTRO);
  assert.equal(paraAjeno._forbidden, true);
});

test('listarControlAvance: devuelve los puntos ordenados por fecha', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  Proyectos.gestionarControlAvance(db, { proyecto_id: proyecto.proyecto_id, fecha: '2026-09-15', pct_proyectado: 50 }, CTX_LEO);
  Proyectos.gestionarControlAvance(db, { proyecto_id: proyecto.proyecto_id, fecha: '2026-09-01', pct_proyectado: 10 }, CTX_LEO);
  Proyectos.gestionarControlAvance(db, { proyecto_id: proyecto.proyecto_id, fecha: '2026-09-08', pct_proyectado: 30 }, CTX_LEO);

  const res = Proyectos.listarControlAvance(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.deepEqual(res.puntos.map((p) => p.fecha), ['2026-09-01', '2026-09-08', '2026-09-15']);
});

// --- eliminar / seguridad cruzada -----------------------------------------------

test('gestionarControlAvance: eliminar un punto lo quita', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const punto = Proyectos.gestionarControlAvance(db, { proyecto_id: proyecto.proyecto_id, fecha: '2026-09-01', pct_proyectado: 20 }, CTX_LEO);
  const res = Proyectos.gestionarControlAvance(db, { proyecto_id: proyecto.proyecto_id, accion: 'eliminar', control_id: punto.control_id }, CTX_LEO);
  assert.equal(res.eliminado, true);
  assert.equal(filas(db, 'PROYECTO_CONTROL_AVANCE').length, 0);
});

test('SEGURIDAD: un control_id de OTRO proyecto no se puede eliminar solo por conocer su id', () => {
  const db = db_();
  const proyectoA = crearProyectoBase(db, { nombre: 'Proyecto A' });
  const proyectoB = crearProyectoBase(db, { nombre: 'Proyecto B' });
  const puntoDeA = Proyectos.gestionarControlAvance(db, { proyecto_id: proyectoA.proyecto_id, fecha: '2026-09-01', pct_proyectado: 20 }, CTX_LEO);

  // El llamador dice pertenecer a B (donde también es líder), pero manda el
  // control_id de A -- el permiso de "gestiona B" no debe alcanzar para
  // tocar un punto que en realidad vive en A.
  const res = Proyectos.gestionarControlAvance(db, {
    proyecto_id: proyectoB.proyecto_id, accion: 'eliminar', control_id: puntoDeA.control_id
  }, CTX_LEO);
  assert.equal(res._validationError, true, 'debe rechazarse: el punto no pertenece al proyecto declarado');
  assert.equal(filas(db, 'PROYECTO_CONTROL_AVANCE').length, 1, 'el punto de A sigue intacto');
});
