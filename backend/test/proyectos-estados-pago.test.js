'use strict';

/**
 * Fase H item 2 (Camino B, 2026-09-23): avance financiero -- estados/hitos de
 * pago (Proyectos.gestionarEstadoPago/listarEstadosPago). Ver
 * documentacion/SIGSO-Proyectos-2.0-auditoria-y-propuesta.md §13/§18.
 *
 * Lo que estos tests protegen, por orden de importancia:
 *  1. Solo quien GESTIONA el proyecto (líder/ADM) puede escribir estados de
 *     pago -- es una declaración financiera de gestión, no un dato operativo.
 *  2. Un estado_pago_id de OTRO proyecto no se puede tocar solo por conocer
 *     su id (mismo vector que gestionarRiesgo/gestionarControlAvance).
 *  3. Validación de campos obligatorios/rango y el orden de inserción.
 *  4. actualizar() valida presupuesto_monto/presupuesto_moneda como par.
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
  'PROYECTO_ESTADOS_PAGO', 'ACTIVIDADES', 'ACTIVIDADES_BITACORA', 'CAT_AREAS'
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

test('gestionarEstadoPago: el líder registra un estado de pago', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const r = Proyectos.gestionarEstadoPago(db, {
    proyecto_id: proyecto.proyecto_id, nombre: 'Anticipo', fecha_proyectada: '2026-09-01', monto_proyectado: 1000000
  }, CTX_LEO);
  assert.ok(r.estado_pago_id);
  assert.equal(r.nombre, 'Anticipo');
  assert.equal(r.monto_proyectado, 1000000);
  assert.equal(r.estado, 'proyectado');
  assert.equal(r.orden, 0);
  assert.equal(r.registrado_por, 'leo@rld.cl');
  assert.equal(filas(db, 'PROYECTO_ESTADOS_PAGO').length, 1);
});

test('gestionarEstadoPago: monto_real/fecha_real y estado son opcionales al crear', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const r = Proyectos.gestionarEstadoPago(db, {
    proyecto_id: proyecto.proyecto_id, nombre: 'Hito 1', fecha_proyectada: '2026-09-15', monto_proyectado: 500000
  }, CTX_LEO);
  assert.equal(r.fecha_real, '');
  assert.equal(r.monto_real, '');
  assert.equal(r.estado, 'proyectado');
});

test('gestionarEstadoPago: se puede marcar como facturado/pagado con monto y fecha real', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const creado = Proyectos.gestionarEstadoPago(db, {
    proyecto_id: proyecto.proyecto_id, nombre: 'Anticipo', fecha_proyectada: '2026-09-01', monto_proyectado: 1000000
  }, CTX_LEO);
  const editado = Proyectos.gestionarEstadoPago(db, {
    proyecto_id: proyecto.proyecto_id, estado_pago_id: creado.estado_pago_id,
    nombre: 'Anticipo', fecha_proyectada: '2026-09-01', monto_proyectado: 1000000,
    fecha_real: '2026-09-05', monto_real: 980000, estado: 'pagado'
  }, CTX_LEO);
  assert.equal(editado.estado_pago_id, creado.estado_pago_id, 'mismo id: se editó, no se creó otro');
  assert.equal(editado.estado, 'pagado');
  assert.equal(editado.monto_real, 980000);
  assert.equal(editado.fecha_real, '2026-09-05');
  assert.equal(filas(db, 'PROYECTO_ESTADOS_PAGO').length, 1);
});

test('gestionarEstadoPago: sucesivos quedan con orden ascendente por inserción', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const a = Proyectos.gestionarEstadoPago(db, { proyecto_id: proyecto.proyecto_id, nombre: 'Anticipo', fecha_proyectada: '2026-09-01', monto_proyectado: 100 }, CTX_LEO);
  const b = Proyectos.gestionarEstadoPago(db, { proyecto_id: proyecto.proyecto_id, nombre: 'Avance 50%', fecha_proyectada: '2026-09-15', monto_proyectado: 200 }, CTX_LEO);
  const c = Proyectos.gestionarEstadoPago(db, { proyecto_id: proyecto.proyecto_id, nombre: 'Entrega final', fecha_proyectada: '2026-10-01', monto_proyectado: 300 }, CTX_LEO);
  assert.deepEqual([a.orden, b.orden, c.orden], [0, 1, 2]);
});

test('gestionarEstadoPago: valida nombre/fecha_proyectada/monto_proyectado obligatorios y montos >= 0', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  assert.equal(Proyectos.gestionarEstadoPago(db, { proyecto_id: proyecto.proyecto_id, fecha_proyectada: '2026-09-01', monto_proyectado: 100 }, CTX_LEO)._validationError, true, 'sin nombre');
  assert.equal(Proyectos.gestionarEstadoPago(db, { proyecto_id: proyecto.proyecto_id, nombre: 'X', monto_proyectado: 100 }, CTX_LEO)._validationError, true, 'sin fecha proyectada');
  assert.equal(Proyectos.gestionarEstadoPago(db, { proyecto_id: proyecto.proyecto_id, nombre: 'X', fecha_proyectada: '2026-09-01' }, CTX_LEO)._validationError, true, 'sin monto proyectado');
  assert.equal(Proyectos.gestionarEstadoPago(db, { proyecto_id: proyecto.proyecto_id, nombre: 'X', fecha_proyectada: '2026-09-01', monto_proyectado: -5 }, CTX_LEO)._validationError, true, 'monto proyectado negativo');
  assert.equal(Proyectos.gestionarEstadoPago(db, { proyecto_id: proyecto.proyecto_id, nombre: 'X', fecha_proyectada: '2026-09-01', monto_proyectado: 100, monto_real: -1 }, CTX_LEO)._validationError, true, 'monto real negativo');
  assert.equal(filas(db, 'PROYECTO_ESTADOS_PAGO').length, 0);
});

// --- permisos ------------------------------------------------------------------

test('gestionarEstadoPago: un integrante SIN rol de líder no puede escribir estados de pago', () => {
  const db = db_();
  const proyecto = armarProyectoConMarcelo(db);
  const r = Proyectos.gestionarEstadoPago(db, { proyecto_id: proyecto.proyecto_id, nombre: 'Anticipo', fecha_proyectada: '2026-09-01', monto_proyectado: 100 }, CTX_MARCELO);
  assert.equal(r._forbidden, true);
  assert.equal(filas(db, 'PROYECTO_ESTADOS_PAGO').length, 0);
});

test('gestionarEstadoPago: ADM sí puede, GERENCIA no (mismo criterio que gestionarControlAvance)', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const adm = Proyectos.gestionarEstadoPago(db, { proyecto_id: proyecto.proyecto_id, nombre: 'Anticipo', fecha_proyectada: '2026-09-01', monto_proyectado: 100 }, CTX_ADM);
  assert.ok(adm.estado_pago_id);
  const ger = Proyectos.gestionarEstadoPago(db, { proyecto_id: proyecto.proyecto_id, nombre: 'Avance', fecha_proyectada: '2026-09-02', monto_proyectado: 100 }, CTX_GERENCIA);
  assert.equal(ger._forbidden, true);
});

test('listarEstadosPago: cualquier integrante ve los estados de pago; un ajeno no', () => {
  const db = db_();
  const proyecto = armarProyectoConMarcelo(db);
  Proyectos.gestionarEstadoPago(db, { proyecto_id: proyecto.proyecto_id, nombre: 'Anticipo', fecha_proyectada: '2026-09-01', monto_proyectado: 100 }, CTX_LEO);

  const paraMarcelo = Proyectos.listarEstadosPago(db, { proyecto_id: proyecto.proyecto_id }, CTX_MARCELO);
  assert.equal(paraMarcelo.estados.length, 1);

  const paraAjeno = Proyectos.listarEstadosPago(db, { proyecto_id: proyecto.proyecto_id }, CTX_OTRO);
  assert.equal(paraAjeno._forbidden, true);
});

test('listarEstadosPago: incluye presupuesto_monto/presupuesto_moneda del proyecto', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  Proyectos.actualizar(db, { proyecto_id: proyecto.proyecto_id, presupuesto_monto: 5000000, presupuesto_moneda: 'CLP' }, CTX_LEO);
  const res = Proyectos.listarEstadosPago(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(res.presupuesto_monto, 5000000);
  assert.equal(res.presupuesto_moneda, 'CLP');
});

// --- eliminar / seguridad cruzada -----------------------------------------------

test('gestionarEstadoPago: eliminar un estado de pago lo quita', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const ep = Proyectos.gestionarEstadoPago(db, { proyecto_id: proyecto.proyecto_id, nombre: 'Anticipo', fecha_proyectada: '2026-09-01', monto_proyectado: 100 }, CTX_LEO);
  const res = Proyectos.gestionarEstadoPago(db, { proyecto_id: proyecto.proyecto_id, accion: 'eliminar', estado_pago_id: ep.estado_pago_id }, CTX_LEO);
  assert.equal(res.eliminado, true);
  assert.equal(filas(db, 'PROYECTO_ESTADOS_PAGO').length, 0);
});

test('SEGURIDAD: un estado_pago_id de OTRO proyecto no se puede eliminar solo por conocer su id', () => {
  const db = db_();
  const proyectoA = crearProyectoBase(db, { nombre: 'Proyecto A' });
  const proyectoB = crearProyectoBase(db, { nombre: 'Proyecto B' });
  const epDeA = Proyectos.gestionarEstadoPago(db, { proyecto_id: proyectoA.proyecto_id, nombre: 'Anticipo', fecha_proyectada: '2026-09-01', monto_proyectado: 100 }, CTX_LEO);

  const res = Proyectos.gestionarEstadoPago(db, {
    proyecto_id: proyectoB.proyecto_id, accion: 'eliminar', estado_pago_id: epDeA.estado_pago_id
  }, CTX_LEO);
  assert.equal(res._validationError, true, 'debe rechazarse: el estado de pago no pertenece al proyecto declarado');
  assert.equal(filas(db, 'PROYECTO_ESTADOS_PAGO').length, 1, 'el estado de pago de A sigue intacto');
});

test('SEGURIDAD: un estado_pago_id de OTRO proyecto no se puede editar solo por conocer su id', () => {
  const db = db_();
  const proyectoA = crearProyectoBase(db, { nombre: 'Proyecto A' });
  const proyectoB = crearProyectoBase(db, { nombre: 'Proyecto B' });
  const epDeA = Proyectos.gestionarEstadoPago(db, { proyecto_id: proyectoA.proyecto_id, nombre: 'Anticipo', fecha_proyectada: '2026-09-01', monto_proyectado: 100 }, CTX_LEO);

  const res = Proyectos.gestionarEstadoPago(db, {
    proyecto_id: proyectoB.proyecto_id, estado_pago_id: epDeA.estado_pago_id,
    nombre: 'Secuestrado', fecha_proyectada: '2026-09-01', monto_proyectado: 999
  }, CTX_LEO);
  assert.equal(res._validationError, true, 'debe rechazarse: el estado de pago no pertenece al proyecto declarado');
  const intacto = filas(db, 'PROYECTO_ESTADOS_PAGO').find((e) => e.estado_pago_id === epDeA.estado_pago_id);
  assert.equal(intacto.nombre, 'Anticipo', 'no se modificó desde el proyecto ajeno');
});

// --- actualizar (presupuesto en PROYECTOS) --------------------------------------

test('actualizar: presupuesto_monto exige presupuesto_moneda y viceversa', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  assert.equal(Proyectos.actualizar(db, { proyecto_id: proyecto.proyecto_id, presupuesto_monto: 100 }, CTX_LEO)._validationError, true, 'monto sin moneda');
  assert.equal(Proyectos.actualizar(db, { proyecto_id: proyecto.proyecto_id, presupuesto_monto: -5, presupuesto_moneda: 'CLP' }, CTX_LEO)._validationError, true, 'monto negativo');
  assert.equal(Proyectos.actualizar(db, { proyecto_id: proyecto.proyecto_id, presupuesto_monto: 100, presupuesto_moneda: 'USD' }, CTX_LEO)._validationError, true, 'moneda inválida');
});

test('actualizar: guarda centro_costo y presupuesto_monto/moneda correctamente', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const r = Proyectos.actualizar(db, { proyecto_id: proyecto.proyecto_id, centro_costo: 'CC-102', presupuesto_monto: 3500, presupuesto_moneda: 'UF' }, CTX_LEO);
  assert.equal(r.centro_costo, 'CC-102');
  assert.equal(r.presupuesto_monto, 3500);
  assert.equal(r.presupuesto_moneda, 'UF');
});
