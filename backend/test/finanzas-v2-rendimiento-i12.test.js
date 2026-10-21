'use strict';

/**
 * Finanzas · corrección v2, I12 (2026-10-21): cachés que reflejan cambios
 * válidos. Una caché armada dentro de una transacción revertida no se reutiliza;
 * otra conexión que escribe invalida; el catálogo cambia solo cuando cambia;
 * la cartera y el informe memorizados ven una escritura nueva; al cerrar la
 * última sesión el servidor olvida las cifras descifradas. Datos inventados.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { preparar } = require('./_finanzasPrueba');
const Base = require('../logica/finanzasBase');
const B = require('../logica/finanzasBoveda');
const H = require('../logica/finanzasHechos');
const Op = require('../logica/finanzasOperaciones');
const Cat = require('../logica/finanzasCatalogos');
const C = require('../logica/finanzasCobranza');
const R = require('../logica/finanzasReportes');

const op = (db, D, ctx, o) => Op.guardar(db, D(Object.assign({ empresa: 'HomePymes', medio: 'EFECTIVO', confirmar: true, fecha: '2026-08-05', sentido: 'ENTRADA', tipo: 'INGRESO', cuenta: 'Servicio Mensual' }, o)), ctx);
const montos = () => H.todos_().filter((h) => h.fuente === 'REGISTRO').map((h) => h.abono).sort((a, b) => a - b);

test('I12.2 · una caché armada dentro de una transacción revertida no se reutiliza', (t) => {
  const { db, ctx, D } = preparar(t);
  op(db, D, ctx, { monto: 100 });
  assert.deepEqual(montos(), [100]);
  // Dentro de una transacción: se guarda 777, se arma la caché con ese dato y la transacción se revierte.
  Base.transaccion_(() => {
    op(db, D, ctx, { monto: 777 });
    assert.deepEqual(montos(), [100, 777], 'dentro de la transacción se ve');
    return { _validationError: true, message: 'revertir' };
  });
  // Otra escritura confirmada reutiliza el mismo número de revisión: la caché de adentro no debe servir.
  op(db, D, ctx, { monto: 200 });
  assert.deepEqual(montos(), [100, 200], 'nunca aparece el 777 revertido');
});

test('I12.2 · otra conexión que escribe cambia la revisión y el catálogo se relee', (t) => {
  const { db, ctx, D, dir } = preparar(t);
  op(db, D, ctx, { monto: 100 });
  const antes = Base.revision_();
  const nombreAntes = Cat.lista_('MEDIO', { todos: true })[0].nombre;
  const otra = new DatabaseSync(path.join(dir, 'finanzas.db'));
  t.after(() => otra.close());
  const r = otra.prepare("SELECT id, datos FROM FIN_CATALOGO WHERE tipo = 'MEDIO' ORDER BY orden LIMIT 1").get();
  const datos = JSON.parse(r.datos); datos.nombre = nombreAntes + ' (editado por otra conexión)';
  otra.prepare("UPDATE FIN_CATALOGO SET datos = ?, version = version + 1, actualizado_en = ? WHERE tipo = 'MEDIO' AND id = ?").run(JSON.stringify(datos), new Date().toISOString(), r.id);
  assert.notEqual(Base.revision_(), antes, 'la revisión durable ve la escritura de otra conexión');
  assert.equal(Cat.lista_('MEDIO', { todos: true })[0].nombre, nombreAntes + ' (editado por otra conexión)');
});

test('I12.2 · el catálogo no se rearma por escrituras ajenas a él; la cartera y el informe memorizados ven lo nuevo', (t) => {
  const { db, ctx, D } = preparar(t);
  const a = Cat.lista_('CONCEPTO', { todos: true });
  op(db, D, ctx, { monto: 100 });
  assert.equal(Cat.lista_('CONCEPTO', { todos: true }).length, a.length);
  C.guardarFacturas_(db, 'HomePymes', [{ tipo_doc: 33, folio: '1', fecha: '2026-08-01', cliente_id: 'CL-1', total: 1000 }], 'rcv', 'prueba');
  const c1 = C.cartera_(db);
  assert.equal(C.cartera_(db), c1, 'sin cambios, la misma cartera (memorizada)');
  C.guardarFacturas_(db, 'HomePymes', [{ tipo_doc: 33, folio: '2', fecha: '2026-08-02', cliente_id: 'CL-1', total: 2000 }], 'rcv', 'prueba');
  assert.equal(C.cartera_(db).get('CL-1').facturas.length, 2, 'una escritura nueva se ve');
  const r1 = R.reporte_(db, { periodo: '2026-08' });
  assert.equal(R.reporte_(db, { periodo: '2026-08' }), r1, 'el informe memorizado');
  op(db, D, ctx, { monto: 500 });
  assert.equal(R.reporte_(db, { periodo: '2026-08' }).metrics.ingresos, r1.metrics.ingresos + 500);
  assert.throws(() => { r1.metrics.ingresos = 0; }, TypeError, 'nadie puede modificar un resultado compartido');
});

test('I12.2 · al cerrar la última sesión, el servidor olvida las cifras descifradas', (t) => {
  const { db, ctx, D } = preparar(t);
  op(db, D, ctx, { monto: 100 });
  H.todos_();
  assert.ok(B.memoria_().textos_descifrados > 0);
  // Quedan dos sesiones abiertas (las dos cuentas de prueba): cerrar una no basta.
  B.salir(db, D({}), ctx);
  B.dbFin().prepare('UPDATE FIN_SESIONES SET cerrada = 1').run();
  B.salir(db, D({}), ctx);
  assert.equal(B.memoria_().textos_descifrados, 0);
  assert.equal(B.sesionesAbiertas_(), 0);
});
