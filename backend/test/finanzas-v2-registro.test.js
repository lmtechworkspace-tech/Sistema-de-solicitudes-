'use strict';

/**
 * Finanzas v2 (2026-10-20), fases 2 y 3: registro operativo, pegado desde
 * Excel, conciliación con el banco. Casos T03, T17, T18, T28, T33, T45.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparar, versionDe, cartola } = require('./_finanzasPrueba');
const F = require('../logica/finanzasBancos');
const Op = require('../logica/finanzasOperaciones');
const Conc = require('../logica/finanzasConciliacion');
const H = require('../logica/finanzasHechos');
const T = require('../logica/finanzasTablero');

const base = { empresa: 'HomePymes', sentido: 'SALIDA', medio: 'TRANSFERENCIA', tipo: 'EGRESO', cuenta: 'Servidores y Sistemas' };
const suma = (hs, campo) => hs.reduce((s, h) => s + h[campo], 0);

test('borrador: se guarda incompleto, dice qué le falta y no cuenta; confirmar exige todo', (t) => {
  const { db, ctx, D } = preparar(t);
  const b = Op.guardar(db, D({ empresa: 'HomePymes', fecha: '2026-08-05', sentido: 'ENTRADA', monto: '500.000', tipo: 'FONDO_RECIBIDO' }), ctx);
  assert.equal(b.estado, 'BORRADOR');
  assert.ok(b.faltantes.some((f) => /cliente/i.test(f.mensaje)), 'falta el cliente');
  assert.equal(H.todos_().length, 0, 'un borrador no es un hecho');
  const c = Op.guardar(db, D({ id: b.id, expected_version: b.version, empresa: 'HomePymes', fecha: '2026-08-05', sentido: 'ENTRADA', monto: '500.000', tipo: 'FONDO_RECIBIDO', confirmar: true }), ctx);
  assert.ok(c._validationError, 'no se confirma incompleta');
  const ok = Op.guardar(db, D({ id: b.id, expected_version: b.version, empresa: 'HomePymes', fecha: '2026-08-05', sentido: 'ENTRADA', monto: '500.000', tipo: 'FONDO_RECIBIDO', cuenta: 'Imposiciones', cliente_id: 'CL-2', confirmar: true }), ctx);
  assert.equal(ok.estado, 'CONFIRMADA');
  const hs = H.todos_();
  assert.equal(hs.length, 1);
  assert.deepEqual([hs[0].fuente, hs[0].abono, hs[0].clasif.tipo, hs[0].sin_banco], ['REGISTRO', 500000, 'FONDO_RECIBIDO', true]);
});

test('T03 · dos operaciones legítimas iguales se conservan: dos pagos de 120 = gasto 240 (nunca 360 ni 120)', (t) => {
  const { db, ctx, D } = preparar(t);
  const a = Op.guardar(db, D(Object.assign({ fecha: '2026-08-10', monto: 120, confirmar: true }, base)), ctx);
  const b = Op.guardar(db, D(Object.assign({ fecha: '2026-08-10', monto: 120, confirmar: true }, base)), ctx);
  assert.notEqual(a.id, b.id);
  assert.equal(b.duplicados.length, 1, 'avisa del posible duplicado, pero no lo bloquea');
  // El banco trae los dos cargos; uno se concilia con cada operación.
  F.importarCartola(db, D({ filas: cartola([['10/08/2026', 'PAGO PROVEEDORES', 120, 0, '1'], ['10/08/2026', 'PAGO PROVEEDORES', 120, 0, '2']]), empresa: 'HomePymes' }), ctx);
  const movs = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos;
  assert.equal(movs.length, 2, 'dos cargos iguales del banco no se fusionan (distinto documento y saldo)');
  Conc.conciliar(db, D({ movimientos: [movs[0].id], operaciones: [a.id] }), ctx);
  Conc.conciliar(db, D({ movimientos: [movs[1].id], operaciones: [b.id] }), ctx);
  const t0 = T.calcular_(db, '2026-08', '');
  assert.equal(t0.mes.egresos, 240);
});

test('T28 · registro primero: la cartola propone conciliar; clasificar aparte se bloquea; conciliado cuenta una vez', (t) => {
  const { db, ctx, D } = preparar(t);
  const op = Op.guardar(db, D({ empresa: 'HomePymes', fecha: '2026-08-04', sentido: 'ENTRADA', medio: 'TRANSFERENCIA', monto: 357000, tercero: 'Andes Montajes', tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1', confirmar: true }), ctx);
  assert.equal(T.calcular_(db, '2026-08', '').mes.ingresos, 357000, 'antes del banco ya cuenta (registrado)');
  F.importarCartola(db, D({ filas: cartola([['05/08/2026', 'TRANSFER DE ANDES MONTAJE', 0, 357000, '9']]), empresa: 'HomePymes' }), ctx);
  const m = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos[0];
  assert.equal(m.sugerencia.operacion_candidata, op.id, 'propone la operación registrada');
  // Ahora hay un movimiento PENDIENTE y una operación confirmada: el ingreso sigue en 357.000 (el pendiente no suma).
  assert.equal(T.calcular_(db, '2026-08', '').mes.ingresos, 357000);
  const r = F.clasificar(db, D({ items: [{ id: m.id, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' }] }), ctx);
  assert.equal(r.errores[0].codigo, 'CONCILIAR', 'clasificarlo aparte contaría dos veces');
  const cand = Conc.candidatos(db, D({ movimiento_id: m.id }), ctx);
  assert.equal(cand.candidatos[0].operacion_id, op.id);
  assert.equal(cand.empate, false);
  const c = Conc.conciliar(db, D({ movimientos: [{ id: m.id, expected_version: m.version }], operaciones: [{ id: op.id, expected_version: 1 }] }), ctx);
  assert.ok(c.grupo_id);
  const hs = H.todos_();
  assert.equal(hs.length, 1, 'un solo hecho');
  assert.deepEqual([hs[0].fuente, hs[0].clasif.cliente_id, hs[0].clasif.tipo], ['BANCO', 'CL-1', 'INGRESO']);
  assert.equal(T.calcular_(db, '2026-08', '').mes.ingresos, 357000);
  // Deshacer: el movimiento vuelve a pendiente y la operación a «falta el banco».
  assert.ok(Conc.desconciliar(db, D({ grupo_id: c.grupo_id, motivo: 'prueba' }), ctx).grupo_id);
  assert.equal(Op.porId_(op.id).conciliacion, 'SIN_BANCO');
  assert.equal(F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos[0].estado, 'PENDIENTE');
  assert.equal(Conc.vinculosDe_({ operacion_id: op.id })[0].estado, 'DESHECHA', 'el vínculo queda en la historia');
});

test('T28 · banco primero: un movimiento ya clasificado se puede vincular a su operación y se cuenta una vez', (t) => {
  const { db, ctx, D } = preparar(t);
  F.importarCartola(db, D({ filas: cartola([['05/08/2026', 'PAGO CUENTAS VIA INTERNET', 210000, 0, '7']]), empresa: 'HomePymes' }), ctx);
  const m = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos[0];
  F.clasificar(db, D({ items: [{ id: m.id, tipo: 'FONDO_PAGADO', cuenta: 'Imposiciones', cliente_id: 'CL-2' }] }), ctx);
  const op = Op.guardar(db, D({ empresa: 'HomePymes', fecha: '2026-08-05', sentido: 'SALIDA', monto: 210000, tipo: 'FONDO_PAGADO', subtipo: 'PAGO_OBLIGACION', cuenta: 'Imposiciones', cliente_id: 'CL-2', periodo_obligacion: '2026-07', destino: 'Obra Norte', confirmar: true }), ctx);
  // Corrección v2 (I01 / C01): antes esta prueba esperaba 420.000 («se ve dos veces»), que era justamente el
  // doble conteo. Ahora es un posible duplicado: cuenta el banco y la operación queda aparte, pendiente de identidad.
  assert.equal(suma(H.todos_(), 'cargo'), 210000, 'antes de conciliar cuenta UNA vez (el banco)');
  assert.equal(H.conflictos_({}).length, 1, 'la operación queda como posible duplicado');
  assert.equal(op.coincidencias_banco.length, 1, 'y se avisó al guardarla');
  Conc.conciliar(db, D({ movimientos: [m.id], operaciones: [op.id] }), ctx);
  const hs = H.todos_();
  assert.equal(suma(hs, 'cargo'), 210000);
  assert.deepEqual([hs[0].clasif.periodo_obligacion, hs[0].clasif.destino], ['2026-07', 'Obra Norte'], 'el contexto de la operación queda en el banco');
});

test('T17 · conciliación todo o nada: montos que no calzan no tocan nada; uno contra varios con partes exactas', (t) => {
  const { db, ctx, D } = preparar(t);
  F.importarCartola(db, D({ filas: cartola([['05/08/2026', 'TRANSFER DE PANADERIA SOL', 0, 619000, '5']]), empresa: 'HomePymes' }), ctx);
  const m = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos[0];
  const o1 = Op.guardar(db, D({ empresa: 'HomePymes', fecha: '2026-08-05', sentido: 'ENTRADA', monto: 119000, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-3', confirmar: true }), ctx);
  const o2 = Op.guardar(db, D({ empresa: 'HomePymes', fecha: '2026-08-05', sentido: 'ENTRADA', monto: 400000, tipo: 'FONDO_RECIBIDO', cuenta: 'Imposiciones', cliente_id: 'CL-3', confirmar: true }), ctx);
  const mal = Conc.conciliar(db, D({ movimientos: [m.id], operaciones: [o1.id, o2.id] }), ctx);
  assert.ok(mal._validationError && /diferencia/.test(mal.message));
  assert.equal(Op.porId_(o1.id).conciliacion, 'SIN_BANCO', 'nada cambió');
  assert.equal(F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos[0].estado, 'PENDIENTE');
  const o3 = Op.guardar(db, D({ empresa: 'HomePymes', fecha: '2026-08-05', sentido: 'ENTRADA', monto: 100000, tipo: 'FONDO_RECIBIDO', cuenta: 'IVA', cliente_id: 'CL-3', confirmar: true }), ctx);
  const ok = Conc.conciliar(db, D({ movimientos: [m.id], operaciones: [o1.id, o2.id, o3.id] }), ctx);
  assert.equal(ok.monto, 619000);
  const mv = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos[0];
  assert.equal(mv.clasif.partes.length, 3);
  assert.equal(mv.clasif.partes.reduce((s, p) => s + p.monto, 0), 619000);
  const t0 = T.calcular_(db, '2026-08', '');
  assert.deepEqual([t0.mes.ingresos, t0.mes.fondos_recibidos], [119000, 500000], 'T13: la parte propia y la del cliente no se mezclan');
});

test('T18 · edición simultánea: la segunda versión vieja recibe conflicto y no pisa', (t) => {
  const { db, ctx, D } = preparar(t);
  const a = Op.guardar(db, D(Object.assign({ fecha: '2026-08-10', monto: 120 }, base)), ctx);
  const b1 = Op.guardar(db, D(Object.assign({ id: a.id, expected_version: 1, fecha: '2026-08-10', monto: 130 }, base)), ctx);
  assert.equal(b1.version, 2);
  const b2 = Op.guardar(db, D(Object.assign({ id: a.id, expected_version: 1, fecha: '2026-08-10', monto: 999 }, base)), ctx);
  assert.equal(b2.codigo, 'CONFLICTO_VERSION');
  assert.equal(Op.porId_(a.id).monto, 130);
  // Lote: cada operación es su grupo; una con versión vieja no impide las demás.
  const c = Op.guardar(db, D(Object.assign({ fecha: '2026-08-11', monto: 50 }, base)), ctx);
  const r = Op.accionLote(db, D({ accion: 'CONFIRMAR', ids: [a.id, c.id], versiones: { [a.id]: 1, [c.id]: versionDe('FIN_OPERACIONES', c.id) } }), ctx);
  assert.deepEqual(r.resultados.map((x) => x.ok), [false, true]);
  assert.equal(r.resultados[0].codigo, 'CONFLICTO_VERSION');
});

test('anular y descartar: un borrador nunca confirmado se descarta; una confirmada se anula con motivo y no cuenta', (t) => {
  const { db, ctx, D } = preparar(t);
  const b = Op.guardar(db, D(Object.assign({ fecha: '2026-08-10', monto: 120 }, base)), ctx);
  assert.equal(Op.accionLote(db, D({ accion: 'DESCARTAR', ids: [b.id], versiones: { [b.id]: versionDe('FIN_OPERACIONES', b.id) } }), ctx).hechos, 1);
  assert.equal(Op.porId_(b.id), null);
  const c = Op.guardar(db, D(Object.assign({ fecha: '2026-08-10', monto: 120, confirmar: true }, base)), ctx);
  assert.ok(Op.accionLote(db, D({ accion: 'DESCARTAR', ids: [c.id], versiones: { [c.id]: versionDe('FIN_OPERACIONES', c.id) } }), ctx).resultados[0].ok === false, 'una confirmada no se descarta');
  assert.ok(Op.accionLote(db, D({ accion: 'ANULAR', ids: [c.id], versiones: { [c.id]: versionDe('FIN_OPERACIONES', c.id) } }), ctx)._validationError, 'anular pide motivo');
  Op.accionLote(db, D({ accion: 'ANULAR', ids: [c.id], motivo: 'se registró dos veces', versiones: { [c.id]: versionDe('FIN_OPERACIONES', c.id) } }), ctx);
  assert.equal(Op.porId_(c.id).estado, 'ANULADA');
  assert.equal(H.todos_().length, 0);
});

test('T33 · pegado desde Excel: error por fila, cliente por RUT/nombre, token del contenido y sin duplicar al repetir', (t) => {
  const { db, ctx, D } = preparar(t);
  const filas = [
    ['05/08/2026', 'Marcela Fuentes', '76.543.210-3', 'ingreso', 'Servicio Mensual', '119.000', ''],
    ['06/08/2026', 'Constructora Norte', 'CONSTRUCTORA NORTE SPA', 'fondo recibido', 'Imposiciones', '500.000', ''],
    ['31/02/2026', 'Error de fecha', 'CONSTRUCTORA NORTE SPA', 'gasto', 'Sueldos', '', '1.5'],
    ['07/08/2026', 'Desconocido', 'NO EXISTE SPA', 'ingreso', 'Servicio Mensual', '10.000', '']
  ];
  const mapeo = { 0: 'fecha', 1: 'tercero', 2: 'cliente', 3: 'tipo', 4: 'concepto', 5: 'entrada', 6: 'salida' };
  const rev = Op.revisarPegado(db, D({ filas, mapeo, empresa: 'HomePymes' }), ctx);
  assert.deepEqual([rev.validas, rev.con_errores], [2, 2]);
  assert.ok(rev.revision[2].errores.fecha && rev.revision[2].errores.salida, 'fecha y monto con su motivo');
  assert.ok(/No encuentro el cliente/.test(rev.revision[3].errores.cliente), 'nunca un cliente por parecido');
  assert.equal(rev.revision[0].datos.cliente_id, 'CL-3', 'cliente por RUT');
  assert.equal(rev.totales.entradas, 619000);
  const otro = Op.publicarPegado(db, D({ filas: filas.slice(0, 2), mapeo, empresa: 'HomePymes', token: rev.token }), ctx);
  assert.equal(otro.codigo, 'CONFLICTO_VERSION', 'si cambió lo pegado, hay que revisar de nuevo');
  const pub = Op.publicarPegado(db, D({ filas, mapeo, empresa: 'HomePymes', token: rev.token, seleccion: [0, 1, 2], como: 'BORRADOR' }), ctx);
  assert.deepEqual([pub.publicadas, pub.errores], [2, 1]);
  const otra = Op.publicarPegado(db, D({ filas, mapeo, empresa: 'HomePymes', token: rev.token, seleccion: [0, 1], como: 'BORRADOR' }), ctx);
  assert.equal(otra.repetidas, 2, 'publicar dos veces el mismo contenido no duplica');
  const l = Op.listar(db, D({ periodo: '2026-08' }), ctx);
  assert.equal(l.total, 2);
  assert.equal(l.operaciones[0].origen.tipo, 'PEGADO', 'conserva la procedencia');
});

test('T45 · efectivo no espera cartola; una compensación aplica a facturas pero no es caja', (t) => {
  const { db, ctx, D } = preparar(t);
  const ef = Op.guardar(db, D({ empresa: 'HomePymes', fecha: '2026-08-03', sentido: 'ENTRADA', medio: 'EFECTIVO', monto: 50000, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1', confirmar: true }), ctx);
  assert.equal(Op.porId_(ef.id).conciliacion, 'NO_APLICA');
  const co = Op.guardar(db, D({ empresa: 'HomePymes', fecha: '2026-08-03', sentido: 'ENTRADA', medio: 'COMPENSACION', monto: 30000, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1', confirmar: true }), ctx);
  assert.equal(Op.porId_(co.id).conciliacion, 'NO_APLICA');
  const hs = H.todos_();
  assert.deepEqual(hs.map((h) => h.caja), [true, false]);
  assert.equal(Conc.conciliar(db, D({ movimientos: ['x'], operaciones: [ef.id] }), ctx)._validationError, true);
  const P = require('../logica/finanzasPresupuesto');
  assert.equal(P.real_(2026, '', 'CASH_GROSS')['INGRESO|Servicio Mensual'][7], 50000, 'la compensación no entra a la caja');
});

test('plantillas recurrentes: crean BORRADORES del mes una sola vez', (t) => {
  const { db, ctx, D } = preparar(t);
  const p = Op.guardarPerfil(db, D({ tipo: 'PLANTILLA', nombre: 'Arriendo oficina', dia: 31, operacion: Object.assign({ monto: '450.000' }, base, { cuenta: 'Arriendo Mensual' }) }), ctx);
  assert.ok(p.id);
  const g = Op.generarDePlantillas(db, D({ periodo: '2026-02' }), ctx);
  assert.equal(g.resultados.length, 1);
  const o = Op.porId_(g.resultados[0].id);
  assert.deepEqual([o.estado, o.fecha], ['BORRADOR', '2026-02-28'], 'día 31 en febrero → último día');
  assert.equal(Op.generarDePlantillas(db, D({ periodo: '2026-02' }), ctx).resultados[0].repetida, true);
});
