'use strict';

/**
 * Finanzas v2 (2026-10-20), fase 1: dinero y fechas estrictos, reparto sin
 * pesos de más, capacidades y solo lectura en TODAS las rutas, idempotencia,
 * catálogos con alias. Casos de aceptación T06, T20, T25 (parcial).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparar } = require('./_finanzasPrueba');
const Base = require('../logica/finanzasBase');
const Cat = require('../logica/finanzasCatalogos');
const Op = require('../logica/finanzasOperaciones');
const Cierre = require('../logica/finanzasCierre');
const F = require('../logica/finanzasBancos');

test('T06 · montos: se entienden o se rechazan con su motivo (nunca NaN ni cero encubierto)', () => {
  const v = (x) => Base.montoClp_(x);
  assert.equal(v('$10.000.000').valor, 10000000);
  assert.equal(v('10000000').valor, 10000000);
  assert.equal(v('1.234,50').valor, 1235);
  assert.equal(v('(1.234)').valor, -1234);
  assert.equal(v('-$1.234').valor, -1234);
  assert.equal(v(1234.4).valor, 1234);
  ['1.5', '1,234.56', '12.34', '1.2345', 'abc', '10.000.00'].forEach((x) => assert.equal(v(x).ok, false, x + ' debe rechazarse'));
  assert.equal(v('').ok, false, 'vacío no es cero');
  assert.equal(Base.montoClp_('', { vacioCero: true }).valor, 0);
  assert.equal(Base.montoExcel_('1.0E7'), 10000000, 'valor crudo de Excel con exponente');
  assert.equal(Base.montoExcel_('$1.000'), null);
});

test('T06 · fechas civiles validadas contra el calendario (febrero, fin de mes, serie de Excel)', () => {
  assert.equal(Base.fechaCivil_('31/02/2026'), '');
  assert.equal(Base.fechaCivil_('29/02/2028'), '2028-02-29');
  assert.equal(Base.fechaCivil_('29/02/2026'), '');
  assert.equal(Base.fechaCivil_('2026-07-31'), '2026-07-31');
  assert.equal(Base.fechaCivil_('45658'), '2025-01-01', 'serie de Excel');
  assert.equal(Base.fechaCivil_('46225.875'), '2026-07-22', 'serie con hora: se queda el día');
  assert.equal(Base.ultimoDia_('2026-02'), '2026-02-28');
  assert.equal(Base.ultimoDia_('2028-02'), '2028-02-29');
  assert.equal(Base.ultimoDia_('2026-09'), '2026-09-30');
  assert.equal(Base.periodo_('julio 2026'), '2026-07');
  assert.equal(Base.periodo_('JUL-26'), '2026-07');
  assert.equal(Base.periodo_('07/2026'), '2026-07');
  assert.equal(Base.periodo_('2026-13'), '');
  assert.equal(F.leerCartola([]).error !== undefined, true);
});

test('T20 · reparto determinista: $100.001 entre tres = 33.334 / 33.334 / 33.333 (suma exacta)', () => {
  assert.deepEqual(Base.repartir_(100001, [1, 1, 1]), [33334, 33334, 33333]);
  assert.deepEqual(Base.repartir_(100, [50, 25, 25]), [50, 25, 25]);
  assert.deepEqual(Base.repartir_(1, [1, 1]), [1, 0]);
  const p = F.partesReparto_({ modo: 'PORCENTAJE', partes: [{ empresa: 'GDE', valor: 33.33 }, { empresa: 'RLD', valor: 33.33 }, { empresa: 'HomePymes', valor: 33.34 }] }, 100001);
  assert.equal(p.reduce((s, x) => s + x.monto, 0), 100001);
  assert.equal(F.normalizarReparto_({ modo: 'PORCENTAJE', partes: [{ empresa: 'GDE', valor: 50 }, { empresa: 'RLD', valor: 40 }] }, 100).error.indexOf('100') !== -1, true);
  assert.ok(F.normalizarReparto_({ modo: 'FIJO', partes: [{ empresa: 'GDE', valor: '60' }, { empresa: 'RLD', valor: '30' }] }, 100).error);
  assert.deepEqual(F.normalizarReparto_({ modo: 'FIJO', partes: [{ empresa: 'GDE', valor: '60' }, { empresa: 'RLD', valor: '40' }] }, 100).reparto.partes.map((x) => x.valor), [60, 40]);
  assert.ok(F.normalizarReparto_({ modo: 'IGUALES', partes: [{ empresa: 'GDE' }, { empresa: 'GDE' }] }, 100).error, 'empresa repetida');
});

test('RUT: se normaliza, se marca si es inválido y se conserva el original', () => {
  const r = Base.rut_('76.086.428-5');
  assert.deepEqual([r.normal, r.original], ['76086428-5', '76.086.428-5']);
  assert.equal(typeof r.valido, 'boolean');
  assert.equal(Base.rut_('12.345.678-9').valido, false);
});

test('catálogos: alias resuelven a la empresa canónica, desactivar no borra la historia', (t) => {
  const { db, ctx, D } = preparar(t);
  assert.equal(Cat.empresa_('HomePymes Antiguo'), 'HomePymes');
  assert.equal(Cat.empresa_('ays'), 'HomePymes');
  assert.ok(Cat.conceptos_('EGRESO').indexOf('Gastos Compartidos (prorrateo)') !== -1);
  assert.deepEqual(Cat.conceptos_('PROVISION'), ['Vacaciones', 'Años de Servicio']);
  const r = Cat.guardar(db, D({ tipo: 'CONCEPTO', id: 'Patente Comercial', nombre: 'Patente Comercial', grupo: 'EGRESO', activo: false, expected_version: (Cat.lista_('CONCEPTO', { todos: true }).find((y) => y.id === 'Patente Comercial') || {}).version }), ctx);
  assert.equal(r.activo, false);
  assert.equal(Cat.conceptos_('EGRESO').indexOf('Patente Comercial'), -1, 'ya no se ofrece');
  assert.ok(Cat.buscar_('CONCEPTO', 'Patente Comercial'), 'pero se encuentra para leer la historia');
  assert.ok(Cat.guardar(db, D({ tipo: 'CONCEPTO', id: 'Patente Comercial', nombre: 'Patente Comercial', grupo: 'INGRESO', expected_version: (Cat.lista_('CONCEPTO', { todos: true }).find((y) => y.id === 'Patente Comercial') || {}).version }), ctx)._validationError, 'un concepto usado no cambia de grupo');
  assert.equal(Cat.param_('vencimiento_dias', 0), 30);
});

test('T25 · solo lectura: no escribe por ninguna ruta (registro, lote, pegado, paralelo, cierre, catálogo)', (t) => {
  const { db, ctx2, D2 } = preparar(t, { soloLectura: true });
  const comprobar = (r, ruta) => assert.ok(r && r._forbidden && /solo lectura/.test(r.message), ruta + ' debe rechazarse');
  comprobar(Op.guardar(db, D2({ empresa: 'HomePymes', fecha: '2026-08-01', sentido: 'ENTRADA', monto: 1000, tipo: 'INGRESO', cuenta: 'Servicio Mensual' }), ctx2), 'guardar operación');
  comprobar(Op.accionLote(db, D2({ accion: 'ANULAR', ids: ['x'], motivo: 'prueba' }), ctx2), 'lote');
  comprobar(Op.revisarPegado(db, D2({ filas: [['1']], mapeo: { 0: 'monto' } }), ctx2), 'pegado');
  comprobar(Cierre.paralelo(db, D2({ banco: [['FECHA', 'INGRESO', 'EGRESO']] }), ctx2), 'paralelo (antes escribía)');
  comprobar(Cierre.cerrar(db, D2({ periodo: '2026-08' }), ctx2), 'cerrar');
  comprobar(Cat.guardar(db, D2({ tipo: 'CANAL', nombre: 'X' }), ctx2), 'catálogo');
  comprobar(F.confirmarSugeridas(db, D2({ periodo: '2026-08' }), ctx2), 'confirmar sugeridas');
  assert.deepEqual(Base.capacidades_(ctx2), ['CONSULTAR', 'EXPORTAR']);
});

test('capacidades finas: quien no tiene CONCILIAR no concilia, aunque registre', (t) => {
  const { db, ctx, D } = preparar(t, { capacidades: 'c-1:CONSULTAR|REGISTRAR' });
  assert.ok(Op.guardar(db, D({ empresa: 'HomePymes', fecha: '2026-08-01', sentido: 'ENTRADA', monto: 1000 }), ctx).id, 'registra un borrador');
  const r = require('../logica/finanzasConciliacion').conciliar(db, D({ movimientos: ['a'], operaciones: ['b'] }), ctx);
  assert.ok(r._forbidden && r.codigo === 'PERMISO');
  const c = Op.guardar(db, D({ empresa: 'HomePymes', fecha: '2026-08-01', sentido: 'ENTRADA', monto: 1000, tipo: 'INGRESO', cuenta: 'Servicio Mensual', confirmar: true }), ctx);
  assert.ok(c._forbidden, 'confirmar exige CONFIRMAR');
});

test('idempotencia: la misma clave con el mismo contenido devuelve lo mismo; con otro, conflicto', (t) => {
  const { db, ctx, D } = preparar(t);
  const op = { empresa: 'HomePymes', fecha: '2026-08-01', sentido: 'ENTRADA', monto: '119.000', tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1', idempotency_key: 'k-1' };
  const a = Op.guardar(db, D(op), ctx);
  const b = Op.guardar(db, D(op), ctx);
  assert.equal(a.id, b.id);
  assert.equal(b.repetido, true);
  const c = Op.guardar(db, D(Object.assign({}, op, { monto: '120.000' })), ctx);
  assert.equal(c.codigo, 'IDEMPOTENCIA');
  assert.equal(Op.listar(db, D({ periodo: '2026-08' }), ctx).total, 1, 'un solo registro');
});
