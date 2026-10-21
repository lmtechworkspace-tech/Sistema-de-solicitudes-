'use strict';

/**
 * Finanzas · corrección v2, I08.6 (2026-10-20): estación de pendientes.
 * Reúne tareas que ya existen (registro por completar, operaciones sin banco,
 * movimientos sin clasificar…) sin copiar operaciones, con orden explicable;
 * quien solo consulta ve lo mismo. Datos inventados.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparar, versionDe } = require('./_finanzasPrueba');
const Op = require('../logica/finanzasOperaciones');
const P = require('../logica/finanzasPendientes');
const B = require('../logica/finanzasBoveda');

const base = (o) => Object.assign({ empresa: 'HomePymes', medio: 'TRANSFERENCIA', fecha: '2026-09-12', sentido: 'SALIDA', tipo: 'EGRESO', cuenta: 'Sueldos' }, o);

test('I08.6 · pendientes desde su origen, sin copias, con orden explicable y visibles para quien consulta', (t) => {
  const { db, ctx, ctx2, D, D2 } = preparar(t, { soloLectura: true });
  // Un borrador incompleto (sin cuenta de gasto) y una operación confirmada sin su banco.
  const borr = Op.guardar(db, D(base({ idempotency_key: 'p-1', monto: 5000, tercero: 'Ferretería', cuenta: '', fecha: '2026-09-02' })), ctx);
  const conf = Op.guardar(db, D(base({ idempotency_key: 'p-2', monto: 80000, tercero: 'Inmobiliaria', confirmar: true, fecha: '2026-09-20' })), ctx);
  assert.ok(borr.id && conf.id, borr.message || conf.message);
  const antes = B.dbFin().prepare('SELECT COUNT(*) AS n FROM FIN_OPERACIONES').get().n;

  const r = P.pendientes(db, D({}), ctx);
  assert.deepEqual(r.fuentes_con_error, []);
  const datos = r.items.find((x) => x.tipo === 'DATOS'), sinBanco = r.items.find((x) => x.tipo === 'SIN_BANCO');
  assert.ok(datos && datos.id === 'op:' + borr.id && /Ferretería/.test(datos.motivo));
  assert.equal(datos.accion.vista, 'registro');
  assert.ok(sinBanco && sinBanco.importe === -80000 && sinBanco.accion.vista === 'conciliacion');
  // No crea filas: la lista se calcula desde el origen.
  assert.equal(B.dbFin().prepare('SELECT COUNT(*) AS n FROM FIN_OPERACIONES').get().n, antes);
  // Orden: a igual «bloquea cierre», lo más antiguo primero.
  assert.ok(r.items.indexOf(datos) < r.items.indexOf(sinBanco));
  assert.match(r.orden, /impide cerrar/);
  // Filtro por tipo y conteos por tipo.
  assert.deepEqual(P.pendientes(db, D({ tipo: 'SIN_BANCO' }), ctx).items.map((x) => x.tipo), ['SIN_BANCO']);
  assert.equal(r.por_tipo.DATOS, 1);
  // Quien solo consulta ve lo mismo (las acciones abren pantallas donde rigen sus permisos).
  const r2 = P.pendientes(db, D2({}), ctx2);
  assert.deepEqual(r2.items.map((x) => x.id), r.items.map((x) => x.id));
  // Resuelto en su origen, sale de la lista.
  const an = Op.accionLote(db, D({ accion: 'ANULAR', ids: [borr.id], motivo: 'registro de prueba', versiones: { [borr.id]: versionDe('FIN_OPERACIONES', borr.id) } }), ctx);
  assert.ok(!an._validationError, an.message);
  assert.ok(!P.pendientes(db, D({}), ctx).items.some((x) => x.id === 'op:' + borr.id));
});
