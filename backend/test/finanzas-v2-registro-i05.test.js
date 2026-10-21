'use strict';

/**
 * Finanzas · corrección v2, I05 (2026-10-20): registro rápido y reutilización.
 * Obligaciones de Control interno (IVA, imposiciones) como fuente del pago,
 * con id + versión, pagos parciales y aviso si la fuente cambia; duplicar sin
 * copiar referencia ni vínculos; vista previa de plantillas que reconoce lo ya
 * generado; orden sobre el conjunto completo. Datos inventados.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparar } = require('./_finanzasPrueba');
const { agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const Op = require('../logica/finanzasOperaciones');
const Av = require('../logica/finanzasAvisos');

function filaCi(db, id, matriz, periodo, datos, cli) {
  agregarFila_(db, 'CI_REGISTROS', { registro_id: id, depto: 'contabilidad', matriz, periodo, cliente_id: cli || 'CL-1', cliente_nombre: 'ANDES MONTAJES INDUSTRIALES SPA', cliente_rut: '76.086.428-5',
    fecha: '', estado: 'PENDIENTE', responsable_email: '', datos, observaciones: '', creado_por: 'x', fecha_creacion: '2026-09-02T10:00:00Z', actualizado_por: 'x', fecha_actualizacion: '2026-09-02T10:00:00Z', activa: true });
}
const base = (o) => Object.assign({ empresa: 'HomePymes', medio: 'TRANSFERENCIA', fecha: '2026-09-12', sentido: 'SALIDA', tipo: 'FONDO_PAGADO', subtipo: 'PAGO_OBLIGACION' }, o);

test('I05.5 · obligaciones de Control interno: datos precompletados, id + versión, pagos parciales y sin repetir el evento', (t) => {
  const { db, ctx, D } = preparar(t);
  filaCi(db, 'CI-IVA-1', 'IVA', '2026-M08', { monto_pago: 300000, quien_realiza: 'Francisca' });
  filaCi(db, 'CI-IMP-1', 'PAGO_IMPOSICIONES', '2026-M08', { total_pago_intereses: '$152.340' }, 'CL-2');
  filaCi(db, 'CI-IVA-OTRO', 'IVA', '2026-M07', { monto_pago: 10 });
  const f = Op.fuentesObligacion(db, D({ periodo: '2026-08' }), ctx);
  assert.deepEqual(f.fuentes.map((x) => [x.matriz, x.concepto, x.destino, x.periodo_obligacion, x.monto_esperado]).sort(),
    [['IVA', 'IVA', 'SII (F29)', '2026-08', 300000], ['PAGO_IMPOSICIONES', 'Imposiciones', 'Previred', '2026-08', 152340]]);
  const iva = f.fuentes.find((x) => x.matriz === 'IVA');
  const origen = { tipo: 'CONTROL_INTERNO', registro_id: iva.fuente_id };
  const datos = base({ monto: 100000, cliente_id: iva.cliente_id, cuenta: iva.concepto, periodo_obligacion: iva.periodo_obligacion, destino: iva.destino, accion: 'PAGAR_OBLIGACION', origen, confirmar: true });
  const a = Op.guardar(db, D(Object.assign({ idempotency_key: 'k-iva-1' }, datos)), ctx);
  assert.ok(a.id, a.message);
  // Reintento con la misma clave: el mismo resultado (no repite el evento).
  assert.equal(Op.guardar(db, D(Object.assign({ idempotency_key: 'k-iva-1' }, datos)), ctx).id, a.id);
  // Pago parcial legítimo y otro pago de la misma obligación.
  let g = Op.fuentesObligacion(db, D({ periodo: '2026-08' }), ctx).fuentes.find((x) => x.matriz === 'IVA');
  assert.deepEqual([g.registrado, g.pendiente], [100000, 200000]);
  // Aviso antes de confirmar: el segundo pago supera lo esperado.
  const av = Av.revisarOperacion(db, D(base({ monto: 250000, origen, cliente_id: 'CL-1', cuenta: 'IVA' })), ctx);
  assert.ok(av.avisos.some((x) => x.nivel === 'alerta' && /obligación de \$300\.000/.test(x.texto)));
  const b = Op.guardar(db, D(Object.assign({ idempotency_key: 'k-iva-2' }, datos, { monto: 200000 })), ctx);
  assert.ok(b.id);
  g = Op.fuentesObligacion(db, D({ periodo: '2026-08' }), ctx).fuentes.find((x) => x.matriz === 'IVA');
  assert.deepEqual([g.registrado, g.pendiente, g.operaciones.length], [300000, 0, 2]);
  const det = Op.detalle(db, D({ id: a.id }), ctx);
  assert.deepEqual([det.origen.registro_id, det.origen.version, det.origen.monto_esperado], ['CI-IVA-1', '2026-09-02T10:00:00Z', 300000]);
  assert.equal(det.fuente_cambio, null);
  // La obligación cambia después: lo confirmado NO se toca; el detalle avisa.
  actualizarFilaPorId_(db, 'CI_REGISTROS', 'registro_id', 'CI-IVA-1', { datos: { monto_pago: 320000 }, fecha_actualizacion: '2026-09-20T09:00:00Z' });
  const det2 = Op.detalle(db, D({ id: a.id }), ctx);
  assert.equal(det2.monto, 100000);
  assert.match(det2.fuente_cambio.texto, /cambió en Control interno .*\$300\.000 → \$320\.000/);
  // Un origen que no existe se rechaza.
  assert.ok(Op.guardar(db, D(base({ monto: 1, origen: { tipo: 'CONTROL_INTERNO', registro_id: 'no-existe' }, cliente_id: 'CL-1', cuenta: 'IVA' })), ctx)._validationError);
});

test('I05.2 · duplicar: borrador con lo reutilizable, sin referencia, vínculos ni origen', (t) => {
  const { db, ctx, D } = preparar(t);
  const a = Op.guardar(db, D(base({ monto: 90000, referencia: 'TRF-777', tercero: 'Previred', distribuciones: [
    { monto: 60000, tipo: 'FONDO_PAGADO', subtipo: 'PAGO_OBLIGACION', cuenta: 'Imposiciones', cliente_id: 'CL-1', periodo_obligacion: '2026-08', destino: 'Obra Norte' },
    { monto: 30000, tipo: 'FONDO_PAGADO', subtipo: 'PAGO_OBLIGACION', cuenta: 'Imposiciones', cliente_id: 'CL-2', periodo_obligacion: '2026-08' }], confirmar: true })), ctx);
  const d = Op.duplicar(db, D({ id: a.id, fecha: '2026-10-12', idempotency_key: 'dup-1' }), ctx);
  const o = Op.detalle(db, D({ id: d.id }), ctx);
  assert.deepEqual([o.estado, o.conciliacion, o.referencia, o.fecha, o.monto, o.distribuciones.length, o.origen.tipo, o.origen.de],
    ['BORRADOR', 'SIN_BANCO', '', '2026-10-12', 90000, 2, 'DUPLICADO', a.id]);
  assert.equal(o.distribuciones[0].destino, 'Obra Norte', 'conserva los datos de negocio');
  assert.equal(Op.duplicar(db, D({ id: a.id, fecha: '2026-10-12', idempotency_key: 'dup-1' }), ctx).id, d.id, 'reintento sin duplicar dos veces');
});

test('I05.5 · plantillas: vista previa por instancia, reconoce lo generado y muestra diferencias sin sobrescribir', (t) => {
  const { db, ctx, D } = preparar(t);
  const op = { empresa: 'HomePymes', sentido: 'SALIDA', medio: 'TRANSFERENCIA', monto: '450000', tipo: 'EGRESO', cuenta: 'Arriendo Mensual', tercero: 'Inmobiliaria' };
  const p1 = Op.guardarPerfil(db, D({ tipo: 'PLANTILLA', nombre: 'Arriendo oficina', dia: 10, operacion: op }), ctx);
  Op.guardarPerfil(db, D({ tipo: 'PLANTILLA', nombre: 'Honorarios Andes A', dia: 5, operacion: { empresa: 'HomePymes', sentido: 'ENTRADA', monto: '100000', tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' } }), ctx);
  Op.guardarPerfil(db, D({ tipo: 'PLANTILLA', nombre: 'Honorarios Andes B', dia: 20, operacion: { empresa: 'HomePymes', sentido: 'ENTRADA', monto: '50000', tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' } }), ctx);
  let v = Op.previsualizarPlantillas(db, D({ periodo: '2026-11' }), ctx);
  assert.deepEqual([v.crear, v.existen], [3, 0]);
  assert.equal(v.instancias.find((i) => i.nombre === 'Arriendo oficina').fecha, '2026-11-10');
  Op.generarDePlantillas(db, D({ periodo: '2026-11' }), ctx);
  // La plantilla cambia de monto: la vista previa lo muestra; generar de nuevo no duplica ni sobrescribe.
  Op.guardarPerfil(db, D({ tipo: 'PLANTILLA', id: p1.id, nombre: 'Arriendo oficina', dia: 10, operacion: Object.assign({}, op, { monto: '470000' }) }), ctx);
  v = Op.previsualizarPlantillas(db, D({ periodo: '2026-11' }), ctx);
  assert.deepEqual([v.crear, v.existen], [0, 3]);
  assert.deepEqual(v.instancias.find((i) => i.nombre === 'Arriendo oficina').existe.diferencias, ['monto $450.000 → $470.000']);
  const r = Op.generarDePlantillas(db, D({ periodo: '2026-11' }), ctx);
  assert.equal(r.resultados.filter((x) => x.repetida).length, 3);
  const l = Op.listar(db, D({ periodo: '2026-11' }), ctx);
  assert.equal(l.operaciones.length, 3, 'dos plantillas del mismo cliente conviven sin confundirse');
  assert.equal(l.operaciones.find((o) => o.tercero === 'Inmobiliaria').monto, 450000, 'no sobrescribe');
});

test('I05.2 · el orden se aplica al conjunto completo, no a la página', (t) => {
  const { db, ctx, D } = preparar(t);
  [5000, 90000, 1000, 40000].forEach((m, i) => Op.guardar(db, D({ empresa: 'HomePymes', medio: 'EFECTIVO', fecha: '2026-09-0' + (i + 1), sentido: 'SALIDA', monto: m, tipo: 'EGRESO', cuenta: 'Caja Chica', confirmar: true }), ctx));
  const l = Op.listar(db, D({ periodo: '2026-09', orden: 'monto', dir: 'desc', por_pagina: 10, pagina: 1 }), ctx);
  assert.deepEqual(l.operaciones.map((o) => o.monto), [90000, 40000, 5000, 1000]);
});

test('I08.3 · «Sin cuenta asignada» es un filtro distinto de «Todas las cuentas»', (t) => {
  const { db, ctx, D } = preparar(t);
  const B = require('../logica/finanzasBoveda');
  const op = (k, monto) => Op.guardar(db, D(base({ idempotency_key: k, monto, tipo: 'EGRESO', cuenta: 'Sueldos', tercero: 'Inmobiliaria ' + k })), ctx);
  const a = op('sc-1', 1000), b = op('sc-2', 2000);
  assert.ok(a.id && b.id);
  B.dbFin().prepare('UPDATE FIN_OPERACIONES SET cuenta_ref = ? WHERE id = ?').run('cta-x', b.id);
  const ids = (cuenta_ref) => Op.listar(db, D({ periodo: '2026-09', cuenta_ref }), ctx).operaciones.map((o) => o.id).sort();
  assert.deepEqual(ids(''), [a.id, b.id].sort());
  assert.deepEqual(ids('__SIN_CUENTA__'), [a.id]);
  assert.deepEqual(ids('cta-x'), [b.id]);
});
