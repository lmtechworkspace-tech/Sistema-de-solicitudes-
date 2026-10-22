'use strict';

/**
 * Finanzas v3 · registro diario: anotar en SIGSO lo que hoy se anota en el Excel BANCOS, y que la cartola,
 * al llegar, se una sola con lo anotado (sin duplicar ni perder la clasificación o el grupo).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparar, cartola } = require('./_finanzasPrueba');
const F = require('../logica/finanzasBancos');
const Lb = require('../logica/finanzasLibro');
const R = require('../logica/finanzasRegistro');
const B = require('../logica/finanzasBoveda');

function base(t) {
  const p = preparar(t);
  const { db, ctx, D } = p;
  // Agosto con cartola: crea la cuenta del banco.
  F.importarCartola(db, D({ empresa: 'HomePymes', filas: cartola([['04/08/2026', 'TRANSFER DE ELECTRICA PACIF', 0, 88000, '1']]) }), ctx);
  const cuenta = B.dbFin().prepare('SELECT id FROM FIN_CUENTAS').get().id;
  return Object.assign(p, { cuenta });
}
const SEP = { periodo: '01-09-2026 al 30-09-2026' };
const linea = (lb, alias) => lb.lineas.find((l) => l.planilla && l.planilla.alias === alias);

test('registro · se anota sin cartola, clasifica por la OBS y la cartola después se une sola con lo anotado', (t) => {
  const { db, ctx, D, cuenta } = base(t);
  const r = R.registrar(db, D({ cuenta_ref: cuenta, filas: [
    { fecha: '02-09-2026', monto: '200.000', alias: 'ANDES MONTAJES', obs: 'ABONO' },
    { fecha: '2026-09-03', monto: 3000000, alias: 'CONSTRUCTORA NORTE', obs: 'IMPOSICIONES' },
    { fecha: '2026-09-05', monto: -2950000, alias: 'CONSTRUCTORA NORTE', plan: 'imposiciones', glosa: 'Pago en línea Previred' },
    { fecha: '2026-09-10', monto: -400000, alias: 'ARRIENDO', plan: 'ARRIENDO', obs: 'ABONO' }
  ] }), ctx);
  assert.equal(r.anotadas, 4);
  assert.equal(r.esperando_cartola, 4, 'sin cartola de septiembre, quedan esperándola');
  assert.equal(r.clasificadas, 4, 'la OBS y el plan alcanzan para clasificar las 4');
  let lb = Lb.libro(db, D({ periodo: '2026-09' }), ctx);
  assert.deepEqual(lb.estado_banco, { ok: 0, esperando: 4, falta_anotar: 0 });
  assert.equal(linea(lb, 'ANDES MONTAJES').categoria, 'ABONO');
  assert.equal(linea(lb, 'ARRIENDO').cuenta_concepto, 'Arriendo Mensual');
  assert.equal(lb.lineas.filter((l) => l.categoria === 'FONDOS').length, 2);
  assert.ok(lb.planes.indexOf('IMPOSICIONES') !== -1 && lb.obs.indexOf('ABONO RENTA') !== -1, 'el libro trae las listas para anotar rápido');

  // Grupo de fondos de Norte: 3.000.000 − 2.950.000 = 50.000, y la OBS de cierre ABONO lo cobra como honorario.
  const norte = lb.lineas.filter((l) => l.planilla && l.planilla.alias === 'CONSTRUCTORA NORTE');
  const g = Lb.agrupar(db, D({ ids: norte.map((l) => l.id), versiones: Object.fromEntries(norte.map((l) => [l.id, l.version])), cliente_id: 'CL-2', obligacion: 'Imposiciones', periodo_obligacion: '2026-08', remanente: 'ABONO' }), ctx);
  assert.ok(!g._validationError, g.message);
  assert.deepEqual([g.asignadas, g.honorario, g.saldo], [2, 50000, 0]);
  const idsAntes = lb.lineas.map((l) => l.id).sort();

  // Llega la cartola de septiembre (Andes con un día de diferencia) y trae un cargo que nadie anotó.
  const c = F.importarCartola(db, D({ filas: cartola([
    ['03/09/2026', 'TRANSFER DE ANDES MONTAJE', 0, 200000, '11'],
    ['03/09/2026', 'TRANSFER DE CONSTRUCTORA NORTE', 0, 3000000, '12'],
    ['05/09/2026', 'PAGO EN LINEA PREVIRED', 2950000, 0, '13'],
    ['10/09/2026', 'PAGO EN INTERNET', 400000, 0, '14'],
    ['15/09/2026', 'COMISION MANTENCION', 12345, 0, '15']
  ], SEP) }), ctx);
  assert.equal(c.nuevas, 5);
  assert.equal(c.unidas, 4);
  lb = Lb.libro(db, D({ periodo: '2026-09' }), ctx);
  assert.equal(lb.lineas.length, 5, 'no se duplica: lo anotado y el banco son la misma fila');
  assert.deepEqual(lb.estado_banco, { ok: 4, esperando: 0, falta_anotar: 1 });
  assert.deepEqual(lb.lineas.filter((l) => l.planilla).map((l) => l.id).sort(), idsAntes, 'las filas anotadas conservan su id (y con eso su clasificación y su grupo)');
  const andes = linea(lb, 'ANDES MONTAJES');
  assert.equal(andes.fecha, '2026-09-03', 'la fecha pasa a ser la del banco');
  assert.ok(andes.verificado && andes.unida);
  assert.ok(linea(lb, 'CONSTRUCTORA NORTE').grupo, 'el grupo sigue');
  assert.ok(lb.cartola, 'el mes ya cuadra contra la cartola');

  // Anotar lo que falta: sin decir cuál, se une con el movimiento del banco del mismo monto.
  const r2 = R.registrar(db, D({ cuenta_ref: cuenta, filas: [{ fecha: '15-09-2026', monto: -12345, alias: 'COMISION', plan: 'COMISION', obs: 'ABONO' }] }), ctx);
  assert.deepEqual([r2.en_banco, r2.esperando_cartola, r2.clasificadas], [1, 0, 1]);
  lb = Lb.libro(db, D({ periodo: '2026-09' }), ctx);
  assert.deepEqual(lb.estado_banco, { ok: 5, esperando: 0, falta_anotar: 0 });
  assert.equal(lb.por_revisar, 0);
  assert.equal(linea(lb, 'COMISION').cuenta_concepto, 'Comisión Banco');
});

test('registro · corregir reclasifica, el grupo protege sus filas y borrar respeta el banco', (t) => {
  const { db, ctx, D, cuenta } = base(t);
  R.registrar(db, D({ cuenta_ref: cuenta, filas: [
    { fecha: '2026-09-02', monto: 200000, alias: 'ANDES MONTAJES', obs: 'ABONO' },
    { fecha: '2026-09-03', monto: 500000, alias: 'PANADERIA SOL', obs: 'IVA' },
    { fecha: '2026-09-04', monto: 77000, alias: 'QUIEN SERA', obs: 'ABONO' }
  ] }), ctx);
  let lb = Lb.libro(db, D({ periodo: '2026-09' }), ctx);
  const q = linea(lb, 'QUIEN SERA');
  assert.equal(q.estado, 'PENDIENTE', 'un nombre que SIGSO no conoce queda por revisar');

  // ABONO → ABONO RENTA: se reclasifica como renta.
  const a = linea(lb, 'ANDES MONTAJES');
  const e = R.editar(db, D({ id: a.id, expected_version: a.version, alias: 'ANDES MONTAJES', obs: 'ABONO RENTA', plan: '', glosa: '' }), ctx);
  assert.ok(e.reclasificada && e.clasificada, e.message);
  lb = Lb.libro(db, D({ periodo: '2026-09' }), ctx);
  assert.equal(linea(lb, 'ANDES MONTAJES').categoria, 'ABONO RENTA');
  // Versión vieja = conflicto.
  assert.equal(R.editar(db, D({ id: a.id, expected_version: a.version, alias: 'ANDES MONTAJES', obs: 'ABONO' }), ctx).codigo, 'CONFLICTO_VERSION');
  // Sin cartola se puede corregir el monto.
  const a2 = linea(lb, 'ANDES MONTAJES');
  R.editar(db, D({ id: a2.id, expected_version: a2.version, alias: 'ANDES MONTAJES', obs: 'ABONO RENTA', monto: 210000 }), ctx);
  assert.equal(linea(Lb.libro(db, D({ periodo: '2026-09' }), ctx), 'ANDES MONTAJES').monto, 210000);

  // En un grupo, no se cambia la OBS ni se borra sin sacarla antes.
  const p = linea(lb, 'PANADERIA SOL');
  Lb.agrupar(db, D({ ids: [p.id], versiones: { [p.id]: p.version }, cliente_id: 'CL-3', obligacion: 'IVA', periodo_obligacion: '2026-08' }), ctx);
  const p2 = linea(Lb.libro(db, D({ periodo: '2026-09' }), ctx), 'PANADERIA SOL');
  assert.ok(R.editar(db, D({ id: p2.id, expected_version: p2.version, alias: 'PANADERIA SOL', obs: 'ABONO' }), ctx)._validationError);
  assert.ok(R.eliminar(db, D({ id: p2.id, expected_version: p2.version }), ctx)._validationError);
  assert.equal(Lb.sacarDeGrupo(db, D({ ids: [p2.id] }), ctx).sacadas, 1);
  const p3 = linea(Lb.libro(db, D({ periodo: '2026-09' }), ctx), 'PANADERIA SOL');
  assert.ok(!p3.grupo && p3.categoria === 'FONDOS', 'fuera del grupo sigue siendo plata del cliente');
  assert.equal(R.eliminar(db, D({ id: p3.id, expected_version: p3.version }), ctx).borrada, true);

  // Una fila ya en el banco: borrar solo quita la anotación.
  F.importarCartola(db, D({ filas: cartola([['04/09/2026', 'TRANSFER DE ALGUIEN', 0, 77000, '21']], SEP) }), ctx);
  const q2 = linea(Lb.libro(db, D({ periodo: '2026-09' }), ctx), 'QUIEN SERA');
  assert.ok(q2.verificado);
  assert.equal(R.eliminar(db, D({ id: q2.id, expected_version: q2.version }), ctx).anotacion_borrada, true);
  lb = Lb.libro(db, D({ periodo: '2026-09' }), ctx);
  assert.equal(lb.estado_banco.falta_anotar, 1);
  assert.equal(lb.lineas.length, 2);
});

test('registro · valida lo anotado y no escribe en un mes sin cuenta', (t) => {
  const { db, ctx, D, cuenta } = base(t);
  assert.ok(R.registrar(db, D({ cuenta_ref: cuenta, filas: [{ fecha: '', monto: 1, alias: 'X' }] }), ctx)._validationError);
  assert.ok(R.registrar(db, D({ cuenta_ref: cuenta, filas: [{ fecha: '2026-09-01', monto: 0, alias: 'X' }] }), ctx)._validationError);
  assert.ok(R.registrar(db, D({ cuenta_ref: cuenta, filas: [{ fecha: '2026-09-01', monto: 5, alias: 'X', obs: 'CUALQUIERA' }] }), ctx)._validationError);
  assert.ok(R.registrar(db, D({ cuenta_ref: 'no-existe', filas: [{ fecha: '2026-09-01', monto: 5, alias: 'X' }] }), ctx)._validationError);
  // Una fila mala no deja a medias las buenas.
  const r = R.registrar(db, D({ cuenta_ref: cuenta, filas: [{ fecha: '2026-09-01', monto: 5, alias: 'X' }, { fecha: '2026-09-02', monto: 'abc', alias: 'Y' }] }), ctx);
  assert.match(r.message, /Fila 2/);
  assert.equal(Lb.libro(db, D({ periodo: '2026-09' }), ctx).lineas.length, 0);
});
