'use strict';

/**
 * Prueba de portabilidad: SGC ISO 9001 Fase 5a (PRO-04, proveedores) --
 * mismos escenarios de proveedores.test.js, corridos contra
 * backend/logica/proveedoresSgc.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('../logica/calidadSgc');
const Proveedores = require('../logica/proveedoresSgc');
const Resend = require('../logica/resend');

const TABLAS = ['SGC_PROVEEDORES', 'SGC_PROVEEDOR_EVALUACIONES', 'SGC_ROLES', 'LOG_SISTEMA', 'LOG_NOTIFICACIONES', 'NOTIFICACIONES_APP', 'CONFIG_NOTIFICACIONES'];
function db_() {
  const db = abrirDb_();
  TABLAS.forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }

function conMockCorreo(t) {
  process.env.RESEND_API_KEY = 're_test_key';
  const mock = t.mock.method(Resend, 'enviarCorreoResend_', async () => ({ id: 'x' }));
  t.after(() => { delete process.env.RESEND_API_KEY; });
  return mock;
}

const CTX_ENCARGADO = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const CTX_OPERATIVO = { email: 'operativo@homepymes.cl', nombre: 'Operativo', rol: 'DEV' };
const CTX_GERENCIA = { email: 'gerencia@homepymes.cl', nombre: 'Gerencia', rol: 'GERENCIA' };
const CTX_ADM = { email: 'admin@homepymes.cl', nombre: 'Admin', rol: 'ADM' };

function sembrarRoles(db) {
  Calidad.gestionarRol(db, { usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADM);
  Calidad.gestionarRol(db, { usuario_email: 'operativo@homepymes.cl', rol_sgc: 'OPERATIVO' }, CTX_ADM);
}

function crearProveedor(db, overrides, contexto) {
  return Proveedores.guardar(db, Object.assign({
    nombre: 'Insumos Oficina SpA', rut: '76.111.111-1', producto_servicio: 'Artículos de oficina'
  }, overrides), contexto || CTX_ENCARGADO);
}

function notas(valor) {
  return { calidad: valor, plazo_entrega: valor, costos: valor, tiempo_respuesta: valor, precio: valor, postventa: valor };
}

// --- alta y listado maestro -------------------------------------------------

test('guardar: exige nombre y producto/servicio (las dos primeras columnas del FO-PRO-04-01)', () => {
  const db = db_();
  sembrarRoles(db);
  assert.equal(crearProveedor(db, { nombre: '' })._validationError, true);
  assert.equal(crearProveedor(db, { producto_servicio: '' })._validationError, true);
  assert.equal(crearProveedor(db, { email: 'no-es-correo' })._validationError, true);

  const p = crearProveedor(db);
  assert.equal(p.nombre, 'Insumos Oficina SpA');
  assert.equal(p.estado, 'SIN_EVALUAR');
});

test('guardar: el RUT no se repite -- duplicarlo partiria el historial en dos fichas', () => {
  const db = db_();
  sembrarRoles(db);
  crearProveedor(db);
  const dup = crearProveedor(db, { nombre: 'Otro nombre, mismo RUT' });
  assert.equal(dup._validationError, true);
});

test('guardar: solo el Encargado SGC (o ADM) mantiene el listado', () => {
  const db = db_();
  sembrarRoles(db);
  assert.equal(crearProveedor(db, {}, CTX_OPERATIVO)._forbidden, true);
  assert.equal(crearProveedor(db, { rut: '77.999.999-9' }, CTX_ADM).nombre, 'Insumos Oficina SpA');
});

// --- el corte de PRO-04 §6.2 ------------------------------------------------

test('evaluar: 5.0 REPRUEBA -- el procedimiento dice "inferior o igual a 5.0"', async () => {
  const db = db_();
  sembrarRoles(db);
  const p = crearProveedor(db);
  const r = await Proveedores.evaluar(db, Object.assign({ proveedor_id: p.proveedor_id }, notas(5)), CTX_ENCARGADO);
  assert.equal(r.evaluacion.promedio, 5);
  assert.equal(r.evaluacion.aprobado, false);
  assert.equal(r.proveedor.estado, 'REPROBADO');
  assert.equal(r.evaluacion.resultado, 'REGULAR');
});

test('evaluar: por encima de 5.0 aprueba, y la escala cualitativa sigue a PRO-04', async () => {
  const db = db_();
  sembrarRoles(db);

  const p1 = crearProveedor(db, { rut: '1-1' });
  const bueno = await Proveedores.evaluar(db, Object.assign({ proveedor_id: p1.proveedor_id }, notas(8)), CTX_ENCARGADO);
  assert.equal(bueno.evaluacion.aprobado, true);
  assert.equal(bueno.evaluacion.resultado, 'BUENO');
  assert.equal(bueno.proveedor.estado, 'APROBADO');

  const p2 = crearProveedor(db, { rut: '2-2' });
  const malo = await Proveedores.evaluar(db, Object.assign({ proveedor_id: p2.proveedor_id }, notas(3)), CTX_ENCARGADO);
  assert.equal(malo.evaluacion.resultado, 'MALO');
  assert.equal(malo.evaluacion.aprobado, false);

  const p3 = crearProveedor(db, { rut: '3-3' });
  const regular = await Proveedores.evaluar(db, Object.assign({ proveedor_id: p3.proveedor_id }, notas(6)), CTX_ENCARGADO);
  assert.equal(regular.evaluacion.resultado, 'REGULAR');
  assert.equal(regular.evaluacion.aprobado, true);
});

test('evaluar: promedia los SEIS criterios de PRO-04, no un subconjunto', async () => {
  const db = db_();
  sembrarRoles(db);
  const p = crearProveedor(db);
  const r = await Proveedores.evaluar(db, {
    proveedor_id: p.proveedor_id, calidad: 10, plazo_entrega: 8, costos: 6, tiempo_respuesta: 4, precio: 2, postventa: 6
  }, CTX_ENCARGADO);
  assert.equal(r.evaluacion.promedio, 6);
  assert.equal(r.evaluacion.calidad, 10);
  assert.equal(r.evaluacion.postventa, 6);
});

test('evaluar: exige calificar los seis criterios, en escala 1 a 10', async () => {
  const db = db_();
  sembrarRoles(db);
  const p = crearProveedor(db);
  const incompleta = await Proveedores.evaluar(db, { proveedor_id: p.proveedor_id, calidad: 8 }, CTX_ENCARGADO);
  assert.equal(incompleta._validationError, true);
  const fueraDeEscala = await Proveedores.evaluar(db, Object.assign({ proveedor_id: p.proveedor_id }, notas(11)), CTX_ENCARGADO);
  assert.equal(fueraDeEscala._validationError, true);
  const cero = await Proveedores.evaluar(db, Object.assign({ proveedor_id: p.proveedor_id }, notas(0)), CTX_ENCARGADO);
  assert.equal(cero._validationError, true);
});

// --- el proveedor unico ------------------------------------------------------

test('evaluar: reprobar a un proveedor UNICO pide reunión de mejora, no desecharlo', async () => {
  const db = db_();
  sembrarRoles(db);
  const normal = crearProveedor(db, { rut: '1-1' });
  const unico = crearProveedor(db, { rut: '2-2', nombre: 'Certificadora', es_unico: true });

  const rNormal = await Proveedores.evaluar(db, Object.assign({ proveedor_id: normal.proveedor_id }, notas(3)), CTX_ENCARGADO);
  const rUnico = await Proveedores.evaluar(db, Object.assign({ proveedor_id: unico.proveedor_id }, notas(3)), CTX_ENCARGADO);

  assert.equal(rNormal.consecuencia, 'DESECHAR');
  assert.equal(rUnico.consecuencia, 'REUNION_MEJORA');
  assert.equal(rNormal.proveedor.estado, 'REPROBADO');
  assert.equal(rUnico.proveedor.estado, 'REPROBADO');
});

test('evaluar: el aviso de reprobación dice qué corresponde hacer segun sea único o no', async (t) => {
  const mock = conMockCorreo(t);
  const db = db_();
  sembrarRoles(db);
  const unico = crearProveedor(db, { nombre: 'Certificadora', es_unico: true });
  await Proveedores.evaluar(db, Object.assign({ proveedor_id: unico.proveedor_id }, notas(2)), CTX_ENCARGADO);

  assert.equal(mock.mock.callCount(), 1, 'debe avisar al Encargado SGC');
  const enviado = mock.mock.calls[0].arguments[0];
  assert.equal(enviado.to[0], 'sgc@homepymes.cl');
  assert.match(String(enviado.text), /ÚNICO/i);
  assert.match(String(enviado.text), /reunión/i);
  assert.doesNotMatch(String(enviado.text), /dejar de comprarle/i);
});

// --- el listado maestro se mantiene solo ------------------------------------

test('evaluar: actualiza el "Resultado evaluación" y el "Estatus" del listado maestro', async () => {
  const db = db_();
  sembrarRoles(db);
  const p = crearProveedor(db);
  await Proveedores.evaluar(db, Object.assign({ proveedor_id: p.proveedor_id, fecha: '2026-03-01T00:00:00.000Z' }, notas(9)), CTX_ENCARGADO);

  const listado = Proveedores.listar(db, {}, CTX_ENCARGADO);
  const fila = listado.proveedores[0];
  assert.equal(fila.estado, 'APROBADO');
  assert.equal(fila.ultima_evaluacion_promedio, 9);
  assert.equal(fila.ultima_evaluacion_resultado, 'BUENO');
  assert.equal(String(fila.proxima_evaluacion).slice(0, 7), '2027-03');
});

test('evaluar dos veces: manda la ULTIMA evaluación, y el historial se conserva', async () => {
  const db = db_();
  sembrarRoles(db);
  const p = crearProveedor(db);
  await Proveedores.evaluar(db, Object.assign({ proveedor_id: p.proveedor_id, fecha: '2025-01-10T00:00:00.000Z' }, notas(9)), CTX_ENCARGADO);
  await Proveedores.evaluar(db, Object.assign({ proveedor_id: p.proveedor_id, fecha: '2026-01-10T00:00:00.000Z' }, notas(4)), CTX_ENCARGADO);

  const detalle = Proveedores.getDetalle(db, { proveedor_id: p.proveedor_id }, CTX_ENCARGADO);
  assert.equal(detalle.evaluaciones.length, 2);
  assert.equal(detalle.evaluaciones[0].promedio, 4);
  assert.equal(detalle.proveedor.estado, 'REPROBADO');
});

// --- alertas ----------------------------------------------------------------

test('recordatorio: avisa por el proveedor nunca evaluado, no solo por el vencido', async (t) => {
  conMockCorreo(t);
  const db = db_();
  sembrarRoles(db);
  crearProveedor(db);

  const r = await Proveedores.recordatorioPendientes(db);
  assert.equal(r.vencidos, 1);

  const correos = filas(db, 'LOG_NOTIFICACIONES').filter((n) => String(n.evento || '').indexOf('SGC_PROVEEDOR_EVAL_VENCIDA') === 0);
  assert.equal(correos.length, 1);
  assert.match(String(correos[0].destinatario), /sgc@homepymes\.cl/);
});

test('recordatorio: un proveedor evaluado hace poco NO genera aviso', async (t) => {
  conMockCorreo(t);
  const db = db_();
  sembrarRoles(db);
  const p = crearProveedor(db);
  await Proveedores.evaluar(db, Object.assign({ proveedor_id: p.proveedor_id }, notas(8)), CTX_ENCARGADO);

  const r = await Proveedores.recordatorioPendientes(db);
  assert.equal(r.vencidos, 0);
  assert.equal(r.reprobados, 0);
});

test('recordatorio: no se repite el mismo día', async (t) => {
  conMockCorreo(t);
  const db = db_();
  sembrarRoles(db);
  crearProveedor(db);

  await Proveedores.recordatorioPendientes(db);
  await Proveedores.recordatorioPendientes(db);

  const correos = filas(db, 'LOG_NOTIFICACIONES').filter((n) => String(n.evento || '').indexOf('SGC_PROVEEDOR_EVAL_VENCIDA') === 0);
  assert.equal(correos.length, 1);
});

// --- permisos y baja ---------------------------------------------------------

test('listar: Gerencia puede consultar (es entrada de la revisión por la dirección) pero no gestionar', () => {
  const db = db_();
  sembrarRoles(db);
  crearProveedor(db);
  const vista = Proveedores.listar(db, {}, CTX_GERENCIA);
  assert.ok(!vista._forbidden);
  assert.equal(vista.puede_gestionar, false);
  assert.equal(vista.proveedores.length, 1);
});

test('listar: el personal operativo no accede al listado de proveedores', () => {
  const db = db_();
  sembrarRoles(db);
  crearProveedor(db);
  assert.equal(Proveedores.listar(db, {}, CTX_OPERATIVO)._forbidden, true);
});

test('desactivar: exige motivo y NO borra -- las evaluaciones siguen siendo evidencia', async () => {
  const db = db_();
  sembrarRoles(db);
  const p = crearProveedor(db);
  await Proveedores.evaluar(db, Object.assign({ proveedor_id: p.proveedor_id }, notas(8)), CTX_ENCARGADO);

  assert.equal(Proveedores.desactivar(db, { proveedor_id: p.proveedor_id, motivo: 'corto' }, CTX_ENCARGADO)._validationError, true);
  Proveedores.desactivar(db, { proveedor_id: p.proveedor_id, motivo: 'Dejó de operar en el país.' }, CTX_ENCARGADO);

  assert.equal(Proveedores.listar(db, {}, CTX_ENCARGADO).proveedores.length, 0);
  assert.equal(filas(db, 'SGC_PROVEEDOR_EVALUACIONES').length, 1);
});

test('indicadores: separan aprobados, reprobados, sin evaluar y únicos reprobados', async () => {
  const db = db_();
  sembrarRoles(db);
  const a = crearProveedor(db, { rut: '1-1' });
  const b = crearProveedor(db, { rut: '2-2' });
  const u = crearProveedor(db, { rut: '3-3', es_unico: true });
  crearProveedor(db, { rut: '4-4' });

  await Proveedores.evaluar(db, Object.assign({ proveedor_id: a.proveedor_id }, notas(9)), CTX_ENCARGADO);
  await Proveedores.evaluar(db, Object.assign({ proveedor_id: b.proveedor_id }, notas(2)), CTX_ENCARGADO);
  await Proveedores.evaluar(db, Object.assign({ proveedor_id: u.proveedor_id }, notas(2)), CTX_ENCARGADO);

  const ind = Proveedores.listar(db, {}, CTX_ENCARGADO).indicadores;
  assert.equal(ind.total, 4);
  assert.equal(ind.aprobados, 1);
  assert.equal(ind.reprobados, 2);
  assert.equal(ind.sin_evaluar, 1);
  assert.equal(ind.unicos_reprobados, 1);
});
