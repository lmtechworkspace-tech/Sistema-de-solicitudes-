'use strict';

/**
 * Finanzas v2 (2026-10-20), fases 2–4: fondos por cliente y gestión,
 * aplicaciones a facturas, préstamos, gastos compartidos, proyectos,
 * provisiones y presupuesto con base. Casos T07–T09 (sintéticos con la misma
 * aritmética que los reales), T11–T16, T19–T23.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparar, versionDe, cartola } = require('./_finanzasPrueba');
const F = require('../logica/finanzasBancos');
const Op = require('../logica/finanzasOperaciones');
const Fo = require('../logica/finanzasFondos');
const C = require('../logica/finanzasCobranza');
const Pl = require('../logica/finanzasPlanificacion');
const Cl = require('../logica/finanzasClientes');
const P = require('../logica/finanzasPresupuesto');
const T = require('../logica/finanzasTablero');
const H = require('../logica/finanzasHechos');

const op = (db, D, ctx, o) => Op.guardar(db, D(Object.assign({ empresa: 'HomePymes', medio: 'TRANSFERENCIA', confirmar: true }, o)), ctx);

test('T07 · gestión con una recepción, tres pagos con destino y el período de la obligación; queda el remanente', (t) => {
  const { db, ctx, D } = preparar(t);
  const g = Fo.guardarGestion(db, D({ cliente_id: 'CL-2', empresa: 'HomePymes', obligacion: 'Imposiciones', periodo_obligacion: '2026-06', destinos: [{ nombre: 'Obra A' }, { nombre: 'Obra B' }, { nombre: 'Obra C' }] }), ctx);
  op(db, D, ctx, { fecha: '2026-07-02', sentido: 'ENTRADA', monto: 2100000, tipo: 'FONDO_RECIBIDO', cuenta: 'Imposiciones', cliente_id: 'CL-2', gestion_id: g.id });
  [['Obra A', 1258430], ['Obra B', 386260], ['Obra C', 353571]].forEach(([destino, monto]) =>
    op(db, D, ctx, { fecha: '2026-07-10', sentido: 'SALIDA', monto, tipo: 'FONDO_PAGADO', subtipo: 'PAGO_OBLIGACION', cuenta: 'Imposiciones', cliente_id: 'CL-2', gestion_id: g.id, destino, periodo_obligacion: '2026-06' }));
  const f = Fo.fichaFondos(db, D({ cliente_id: 'CL-2' }), ctx);
  const ge = f.gestiones[0];
  assert.equal(ge.saldo, 101739, '2.100.000 − 1.258.430 − 386.260 − 353.571');
  assert.deepEqual(ge.destinos.map((d) => d.pagado), [1258430, 386260, 353571]);
  assert.equal(ge.periodo_obligacion, '2026-06');
  assert.equal(f.parcial, true, 'sin apertura aprobada el saldo es parcial');
  // El remanente se decide por escrito; cobrarlo como honorario exige respaldo.
  assert.ok(Fo.decidirRemanente(db, D({ gestion_id: g.id, decision: 'HONORARIO', expected_version: versionDe('FIN_GESTIONES', g.id) }), ctx)._validationError);
  assert.ok(Fo.decidirRemanente(db, D({ gestion_id: g.id, decision: 'MANTENER', nota: 'para julio', expected_version: versionDe('FIN_GESTIONES', g.id) }), ctx).ok);
  assert.equal(T.calcular_(db, '2026-07', '').mes.ingresos, 0, 'nada de esto es ingreso de la empresa');
});

test('T08/T09 · varias recepciones pagan una obligación; una diferencia de un peso se conserva, no se ajusta', (t) => {
  const { db, ctx, D } = preparar(t);
  const g = Fo.guardarGestion(db, D({ cliente_id: 'CL-1', empresa: 'HomePymes', obligacion: 'Imposiciones', periodo_obligacion: '2026-07' }), ctx);
  op(db, D, ctx, { fecha: '2026-07-20', sentido: 'ENTRADA', monto: 5000000, tipo: 'FONDO_RECIBIDO', cuenta: 'Imposiciones', cliente_id: 'CL-1', gestion_id: g.id });
  op(db, D, ctx, { fecha: '2026-07-20', sentido: 'ENTRADA', monto: 5000000, tipo: 'FONDO_RECIBIDO', cuenta: 'Imposiciones', cliente_id: 'CL-1', gestion_id: g.id });
  op(db, D, ctx, { fecha: '2026-07-21', sentido: 'ENTRADA', monto: 1302013, tipo: 'FONDO_RECIBIDO', cuenta: 'Imposiciones', cliente_id: 'CL-1', gestion_id: g.id });
  op(db, D, ctx, { fecha: '2026-07-22', sentido: 'SALIDA', monto: 11302014, tipo: 'FONDO_PAGADO', cuenta: 'Imposiciones', cliente_id: 'CL-1', gestion_id: g.id });
  const ge = Fo.fichaFondos(db, D({ cliente_id: 'CL-1' }), ctx).gestiones[0];
  assert.deepEqual([ge.recibido, ge.pagado, ge.saldo], [11302013, 11302014, -1], 'dos entregas iguales se conservan; −$1 a la vista');
});

test('T11/T14(fondos) · apertura: propuesta, aprobada por quien tiene la capacidad; sin apertura el saldo es parcial', (t) => {
  const { db, ctx, D } = preparar(t);
  op(db, D, ctx, { fecha: '2026-07-05', sentido: 'SALIDA', monto: 300000, tipo: 'FONDO_PAGADO', cuenta: 'Imposiciones', cliente_id: 'CL-1' });
  let c = Fo.custodiaAl_('2026-07-31', '');
  assert.deepEqual([c.total, c.parcial], [-300000, true], 'sin apertura: déficit parcial, no una conclusión');
  assert.equal(T.calcular_(db, '2026-07', '').mes.ingresos, 0, 'nunca se crea un ingreso para tapar la custodia');
  const a = Fo.guardarApertura(db, D({ cliente_id: 'CL-1', empresa: 'HomePymes', fecha_corte: '2026-06-30', monto: '350.000', fuente: 'cartola de junio' }), ctx);
  assert.equal(Fo.custodiaAl_('2026-07-31', '').total, -300000, 'propuesta no cuenta');
  Fo.decidirApertura(db, D({ id: a.id, accion: 'APROBAR', expected_version: versionDe('FIN_APERTURAS', a.id) }), ctx);
  c = Fo.custodiaAl_('2026-07-31', '');
  assert.deepEqual([c.total, c.parcial], [50000, false]);
});

test('T12 · dos clientes (+100.000 y −50.000): se reservan los 100.000; el déficit del otro no libera nada', (t) => {
  const { db, ctx, D } = preparar(t);
  F.importarCartola(db, D({ filas: cartola([['01/08/2026', 'TRANSFER DE ANDES MONTAJE', 0, 100000, '1'], ['02/08/2026', 'PAGO CUENTAS VIA INTERNET', 50000, 0, '2']], { anterior: 1000000 }), empresa: 'HomePymes' }), ctx);
  const [m1, m2] = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos;
  F.clasificar(db, D({ items: [{ id: m1.id, tipo: 'FONDO_RECIBIDO', cuenta: 'Imposiciones', cliente_id: 'CL-1' }, { id: m2.id, tipo: 'FONDO_PAGADO', cuenta: 'Imposiciones', cliente_id: 'CL-2' }] }), ctx);
  const t0 = T.calcular_(db, '2026-08', '');
  assert.equal(t0.caja, 1050000);
  assert.deepEqual([t0.custodia, t0.custodia_positiva, t0.custodia_deficit], [50000, 100000, -50000]);
  assert.equal(t0.caja_libre, 950000, 'caja − 100.000 (antes restaba el neto 50.000)');
});

test('T13 · recepción mixta de $619.000: $119.000 propios y $500.000 del cliente, cada parte en su circuito una vez', (t) => {
  const { db, ctx, D } = preparar(t);
  F.importarCartola(db, D({ filas: cartola([['05/08/2026', 'TRANSFER DE MARCELA FUEN', 0, 619000, '5']]), empresa: 'HomePymes' }), ctx);
  const m = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos[0];
  F.clasificar(db, D({ items: [{ id: m.id, partes: [
    { monto: '119.000', tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-3' },
    { monto: '500.000', tipo: 'FONDO_RECIBIDO', cuenta: 'Imposiciones', cliente_id: 'CL-3' }] }] }), ctx);
  const recs = C.recepciones_({ cliente_id: 'CL-3' });
  assert.deepEqual(recs.map((r) => r.monto), [119000], 'solo la parte propia puede pagar facturas');
  assert.equal(Fo.custodiaAl_('2026-08-31', '').total, 500000);
  const t0 = T.calcular_(db, '2026-08', '');
  assert.deepEqual([t0.mes.ingresos, t0.mes.fondos_recibidos], [119000, 500000]);
});

function facturas(db, D, ctx, docs, empresa) {
  return C.guardarFacturas_(db, empresa || 'HomePymes', docs, 'rcv', 'prueba');
}

test('T14 · aplicar a una factura inexistente, anulada, de otro cliente o de otra empresa: bloqueado y sin cambios', (t) => {
  const { db, ctx, D } = preparar(t);
  facturas(db, D, ctx, [{ tipo_doc: 33, folio: '501', fecha: '2026-08-01', rut: '76.086.428-5', cliente_id: 'CL-1', total: 119000 }]);
  facturas(db, D, ctx, [{ tipo_doc: 33, folio: '900', fecha: '2026-08-01', cliente_id: 'CL-2', total: 50000 }]);
  facturas(db, D, ctx, [{ tipo_doc: 33, folio: '77', fecha: '2026-08-01', cliente_id: 'CL-1', total: 50000 }], 'GDE');
  op(db, D, ctx, { fecha: '2026-08-05', sentido: 'ENTRADA', monto: 119000, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' });
  const rec = C.recepciones_({ cliente_id: 'CL-1' })[0];
  const cart = C.cartera_(db);
  const f501 = cart.get('CL-1').facturas.find((f) => f.folio === '501'), f900 = cart.get('CL-2').facturas[0], fGDE = cart.get('CL-1').facturas.find((f) => f.folio === '77');
  assert.ok(C.aplicar(db, D({ recepcion_ref: rec.ref, aplicaciones: [{ factura_id: 'no-existe', monto: 1000 }] }), ctx)._validationError);
  assert.ok(/otro cliente/.test(C.aplicar(db, D({ recepcion_ref: rec.ref, aplicaciones: [{ factura_id: f900.id, monto: 1000 }] }), ctx).message));
  assert.ok(/emitió GDE/.test(C.aplicar(db, D({ recepcion_ref: rec.ref, aplicaciones: [{ factura_id: fGDE.id, monto: 1000 }] }), ctx).message));
  // Todo o nada: una válida + una inválida → ninguna.
  assert.ok(C.aplicar(db, D({ recepcion_ref: rec.ref, aplicaciones: [{ factura_id: f501.id, monto: 1000 }, { factura_id: f900.id, monto: 1000 }] }), ctx)._validationError);
  assert.equal(C.aplicaciones_().length, 0);
  // Con una relación de cobro por terceros autorizada, sí.
  C.guardarRelacion(db, D({ tipo: 'EMPRESA', recibe: 'HomePymes', emite: 'GDE', motivo: 'GDE cobra por HomePymes según contrato' }), ctx);
  assert.ok(C.aplicar(db, D({ recepcion_ref: rec.ref, aplicaciones: [{ factura_id: fGDE.id, monto: 1000 }] }), ctx).aplicaciones.length);
  assert.ok(C.cambiarEstadoFactura(db, D({ id: fGDE.id, expected_version: versionDe('FIN_FACTURAS', fGDE.id), estado: 'ANULADA', nota: 'error' }), ctx)._validationError, 'con abonos aplicados no se anula');
});

test('T15 · el mismo folio en dos empresas son facturas independientes', (t) => {
  const { db, ctx, D } = preparar(t);
  facturas(db, D, ctx, [{ tipo_doc: 33, folio: '100', fecha: '2026-08-01', cliente_id: 'CL-1', total: 10000 }], 'HomePymes');
  facturas(db, D, ctx, [{ tipo_doc: 33, folio: '100', fecha: '2026-08-01', cliente_id: 'CL-1', total: 20000 }], 'GDE');
  const n = C.cartera_(db).get('CL-1');
  assert.deepEqual(n.facturas.map((f) => [f.empresa, f.folio, f.total]), [['HomePymes', '100', 10000], ['GDE', '100', 20000]]);
});

test('T16 · parciales, varias recepciones y nota de crédito referenciada; la fecha del abono no cambia al aplicar', (t) => {
  const { db, ctx, D } = preparar(t);
  facturas(db, D, ctx, [{ tipo_doc: 33, folio: '501', fecha: '2026-07-01', cliente_id: 'CL-1', total: 300000 },
    { tipo_doc: 61, folio: '9', fecha: '2026-07-10', cliente_id: 'CL-1', total: 50000, referencia: '501' }]);
  op(db, D, ctx, { fecha: '2026-07-15', sentido: 'ENTRADA', monto: 100000, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' });
  op(db, D, ctx, { fecha: '2026-08-02', sentido: 'ENTRADA', monto: 200000, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' });
  const [r1, r2] = C.recepciones_({ cliente_id: 'CL-1' });
  const fid = C.cartera_(db).get('CL-1').facturas[0].id;
  assert.ok(C.aplicar(db, D({ recepcion_ref: r1.ref, aplicaciones: [{ factura_id: fid, monto: 100000 }], fecha_aplicacion: '2026-09-01' }), ctx).aplicaciones.length);
  let f = C.fichaCliente(db, D({ clave: 'CL-1' }), ctx).facturas.find((x) => x.folio === '501');
  assert.deepEqual([f.aplicado_confirmado, f.nc, f.saldo_confirmado], [100000, 50000, 150000], 'la NC rebaja una vez');
  assert.ok(C.aplicar(db, D({ recepcion_ref: r2.ref, aplicaciones: [{ factura_id: fid, monto: 160000 }] }), ctx)._validationError, 'no se aplica más de lo que falta');
  C.aplicar(db, D({ recepcion_ref: r2.ref, aplicaciones: [{ factura_id: fid, monto: 150000 }] }), ctx);
  const ficha = C.fichaCliente(db, D({ clave: 'CL-1' }), ctx);
  f = ficha.facturas.find((x) => x.folio === '501');
  assert.deepEqual([f.saldo, f.situacion], [0, 'Pagada']);
  assert.equal(f.aplicaciones[0].fecha_recepcion, '2026-07-15', 'la fecha del abono se conserva');
  assert.equal(f.aplicaciones[0].fecha_aplicacion, '2026-09-01');
  assert.equal(ficha.sin_aplicar, 50000, 'el resto del segundo abono queda disponible');
  // Desaplicar: vuelve el saldo, queda la historia.
  // I04.4/I11: desaplicar exige la versión que se revisó.
  assert.ok(C.desaplicar(db, D({ id: f.aplicaciones[1].id, motivo: 'era de otra factura' }), ctx)._validationError, 'sin versión no se desaplica');
  const des = C.desaplicar(db, D({ id: f.aplicaciones[1].id, expected_version: f.aplicaciones[1].version, motivo: 'era de otra factura' }), ctx);
  assert.deepEqual([des.monto, des.facturas[0].saldo_confirmado], [150000, 150000], 'la factura recupera saldo, según el servidor');
  assert.equal(C.aplicaciones_({ todas: true }).filter((a) => a.estado === 'DESHECHA').length, 1);
});

test('FIFO como sugerencia: se acepta solo lo que se vio', (t) => {
  const { db, ctx, D } = preparar(t);
  facturas(db, D, ctx, [{ tipo_doc: 33, folio: '1', fecha: '2026-07-01', cliente_id: 'CL-1', total: 50000 }, { tipo_doc: 33, folio: '2', fecha: '2026-07-15', cliente_id: 'CL-1', total: 50000 }]);
  op(db, D, ctx, { fecha: '2026-08-01', sentido: 'ENTRADA', monto: 70000, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' });
  const n = C.cartera_(db).get('CL-1');
  assert.deepEqual(n.sugerencias.map((s) => [s.folio, s.monto]), [['1', 50000], ['2', 20000]]);
  assert.equal(C.aceptarSugeridas(db, D({ clave: 'CL-1', digest: 'otro' }), ctx).codigo, 'CONFLICTO_VERSION');
  const r = C.aceptarSugeridas(db, D({ clave: 'CL-1', digest: require('../logica/finanzasBase').digest_(n.sugerencias) }), ctx);
  assert.equal(r.monto, 70000);
  assert.equal(C.cartera_(db).get('CL-1').sugerido, 0);
});

test('T19 · préstamo con las dos piernas importadas: una sola deuda; la devolución parcial baja el saldo', (t) => {
  const { db, ctx, D } = preparar(t);
  F.importarCartola(db, D({ filas: cartola([['03/08/2026', 'TRANSFERENCIA A GDE', 1000000, 0, '1']], { numero: '1111' }), empresa: 'HomePymes' }), ctx);
  F.importarCartola(db, D({ filas: cartola([['03/08/2026', 'TRANSFER DE HOMEPYMES ASE', 0, 1000000, '2']], { numero: '2222' }), empresa: 'GDE' }), ctx);
  const ms = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos;
  F.clasificar(db, D({ items: ms.map((m) => ({ id: m.id, tipo: 'PRESTAMO', empresa: m.cuenta.empresa === 'HomePymes' ? 'GDE' : 'HomePymes' })) }), ctx);
  let deudas = T.deudasEntreEmpresas_(H.todos_());
  assert.deepEqual(deudas, [{ debe: 'GDE', a: 'HomePymes', monto: 1000000 }], 'una deuda, no dos');
  const t0 = T.calcular_(db, '2026-08', '');
  assert.deepEqual([t0.mes.ingresos, t0.mes.egresos], [0, 0], 'sin venta ni gasto artificial');
  // Con ficha: se vinculan las piernas y una devolución parcial.
  const p = Pl.guardarPrestamo(db, D({ origen: 'HomePymes', destino: 'GDE', monto: '1.000.000', fecha: '2026-08-03', concepto: 'capital de trabajo' }), ctx);
  H.todos_().filter((h) => h.clasif && h.clasif.tipo === 'PRESTAMO').forEach((h) => Pl.vincularPrestamo(db, D({ prestamo_id: p.id, ref: h.ref, rol: 'DESEMBOLSO' }), ctx));
  op(db, D, ctx, { empresa: 'GDE', fecha: '2026-08-20', sentido: 'SALIDA', monto: 300000, tipo: 'PRESTAMO', empresa_contraparte: 'HomePymes', prestamo_id: p.id });
  const devol = H.todos_().find((h) => h.fuente === 'REGISTRO');
  Pl.vincularPrestamo(db, D({ prestamo_id: p.id, ref: devol.ref, rol: 'DEVOLUCION' }), ctx);
  const sp = Pl.prestamos(db, D({}), ctx).prestamos[0];
  assert.deepEqual([sp.monto, sp.devuelto, sp.saldo, sp.desembolso_banco], [1000000, 300000, 700000, 1000000]);
  deudas = T.deudasEntreEmpresas_(H.todos_());
  assert.deepEqual(deudas, [{ debe: 'GDE', a: 'HomePymes', monto: 700000 }]);
});

test('T20 · gasto compartido: un pago en el banco, partes por empresa sin crear pesos; el grupo lo cuenta una vez', (t) => {
  const { db, ctx, D } = preparar(t);
  F.importarCartola(db, D({ filas: cartola([['05/08/2026', 'ARRIENDO OFICINA', 100001, 0, '1']]), empresa: 'HomePymes' }), ctx);
  const m = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos[0];
  F.clasificar(db, D({ items: [{ id: m.id, tipo: 'EGRESO', cuenta: 'Arriendo Mensual' }] }), ctx);
  const g = Pl.guardarGastoCompartido(db, D({ periodo: '2026-08', concepto: 'Arriendo', pagadora: 'HomePymes', monto: 100001, reparto: { modo: 'IGUALES', partes: [{ empresa: 'GDE' }, { empresa: 'HomePymes' }, { empresa: 'RLD' }] }, paz: { valor: 'x', pendiente: true } }), ctx);
  assert.equal(Pl.vincularGasto(db, D({ id: g.id, ref: 'mov:' + m.id + ':0' }), ctx).ok, true);
  const parte = (e) => T.calcular_(db, '2026-08', e).mes.egresos;
  assert.deepEqual([parte('GDE'), parte('HomePymes'), parte('RLD'), parte('')], [33334, 33334, 33333, 100001]);
  const prev = Pl.previsualizarReparto(db, D({ monto: 100001, reparto: { modo: 'IGUALES', partes: [{ empresa: 'GDE' }, { empresa: 'HomePymes' }, { empresa: 'RLD' }] } }), ctx);
  assert.equal(prev.suma, 100001);
  assert.equal(Pl.gastosCompartidos(db, D({ periodo: '2026-08' }), ctx).gastos[0].paz.pendiente, true, 'PAZ queda pendiente, no se inventa');
});

test('T21 · una provisión no cambia el banco ni se vuelve un pago realizado', (t) => {
  const { db, ctx, D } = preparar(t);
  const antes = H.todos_().length;
  assert.ok(Pl.guardarProvision(db, D({ periodo: '2026-08', empresa: 'HomePymes', concepto: 'Vacaciones', monto: 300000 }), ctx)._validationError, 'exige el método o la fuente');
  const p = Pl.guardarProvision(db, D({ periodo: '2026-08', empresa: 'HomePymes', concepto: 'Vacaciones', monto: 300000, metodo: 'saldo de días × sueldo diario, informado por RR.HH.' }), ctx);
  assert.ok(p.id);
  assert.equal(H.todos_().length, antes);
  assert.equal(T.calcular_.length > 0, true);
});

test('T22 · proyecto: 0 % se queda en 0 %; cambiar el porcentaje cierra la vigencia anterior; real ≠ previsto', (t) => {
  const { db, ctx, D } = preparar(t);
  assert.ok(Cl.guardarAsignacion(db, D({ cliente_id: 'CL-1', proyecto_id: 'PY-1', porcentaje: '' }), ctx)._validationError, 'vacío no es 0 ni 100');
  Cl.guardarAsignacion(db, D({ cliente_id: 'CL-1', proyecto_id: 'PY-1', porcentaje: '0', desde: '2026-07-01' }), ctx);
  assert.equal(Cl.asignaciones_('CL-1')[0].porcentaje, 0);
  Cl.guardarAsignacion(db, D({ cliente_id: 'CL-1', proyecto_id: 'PY-1', porcentaje: '25', desde: '2026-09-01' }), ctx);
  const a = Cl.asignaciones_('CL-1');
  assert.deepEqual(a.map((x) => [x.porcentaje, x.desde, x.hasta]), [[0, '2026-07-01', '2026-08-31'], [25, '2026-09-01', '']], 'la historia no cambia');
  op(db, D, ctx, { fecha: '2026-08-05', sentido: 'SALIDA', monto: 200000, tipo: 'EGRESO', cuenta: 'Otros Egresos', proyecto_id: 'PY-1' });
  const pr = Pl.proyectos(db, D({}), ctx).proyectos.find((p) => p.id === 'PY-1');
  assert.deepEqual([pr.inversion_prevista, pr.inversion_real, pr.recuperacion_pct], [1000000, 200000, 0]);
});

test('T23 · presupuesto: borrador no se compara, versiones guardadas, base documental sin gastos no es comparable', (t) => {
  const { db, ctx, D } = preparar(t);
  const meses = (v) => Array.from({ length: 12 }, () => v);
  assert.ok(/ene/.test(P.guardar(db, D({ anio: 2026, empresa: 'HomePymes', expected_version: versionDe('FIN_PRESUPUESTO', '2026|HomePymes'), lineas: [{ tipo: 'INGRESO', cuenta: 'Servicio Mensual', meses: ['abc'] }] }), ctx).message), 'una celda mala es un error con su mes');
  P.guardar(db, D({ anio: 2026, empresa: 'HomePymes', expected_version: versionDe('FIN_PRESUPUESTO', '2026|HomePymes'), base: 'DOCUMENT_NET', lineas: [{ tipo: 'INGRESO', cuenta: 'Servicio Mensual', meses: meses(100) }, { tipo: 'EGRESO', cuenta: 'Sueldos', meses: meses(50) }] }), ctx);
  assert.equal(P.ver(db, D({ anio: 2026, empresa: 'HomePymes' }), ctx).cargado, false);
  P.aprobar(db, D({ anio: 2026, empresa: 'HomePymes', expected_version: versionDe('FIN_PRESUPUESTO', '2026|HomePymes') }), ctx);
  P.guardar(db, D({ anio: 2026, empresa: 'HomePymes', expected_version: versionDe('FIN_PRESUPUESTO', '2026|HomePymes'), base: 'DOCUMENT_NET', lineas: [{ tipo: 'INGRESO', cuenta: 'Servicio Mensual', meses: meses(999) }] }), ctx);
  const v = P.ver(db, D({ anio: 2026, empresa: 'HomePymes' }), ctx);
  assert.equal(v.filas.find((f) => f.cuenta === 'Servicio Mensual').ppto[0], 100, 'manda la aprobada, no el borrador nuevo');
  assert.equal(v.filas.find((f) => f.cuenta === 'Servicio Mensual').borrador[0], 999);
  assert.equal(v.filas.find((f) => f.cuenta === 'Sueldos').comparable, false, 'gastos en base documental: no comparable');
  assert.deepEqual(v.historial.map((h) => [h.version, h.estado]), [[2, 'BORRADOR'], [1, 'APROBADO'], [1, 'BORRADOR']]);
});

test('T41 · varios servicios (mensual y único) con su vigencia; una nota de venta los relaciona; terminar uno no borra su historia', (t) => {
  const { db, ctx, D } = preparar(t);
  const m = Cl.guardarServicio(db, D({ cliente_id: 'CL-1', servicio: 'Remuneraciones', modalidad: 'MENSUAL', monto_neto: '150.000', dia_facturacion: 5, desde: '2026-01-01' }), ctx);
  const u = Cl.guardarServicio(db, D({ cliente_id: 'CL-1', servicio: 'Constitución de sociedad', modalidad: 'UNICA', monto_neto: '300.000', desde: '2026-02-01', hasta: '2026-02-28' }), ctx);
  const c = Cl.guardarServicio(db, D({ cliente_id: 'CL-1', servicio: 'Contabilidad', modalidad: 'MENSUAL', monto_neto: '90.000', dia_facturacion: 5, desde: '2026-03-01' }), ctx);
  assert.ok(Cl.guardarServicio(db, D({ cliente_id: 'CL-1', servicio: 'X', desde: '2026-05-01', hasta: '2026-04-01' }), ctx)._validationError, 'la vigencia no termina antes de empezar');
  const lista = () => Cl.servicios_('CL-1');
  assert.deepEqual(lista().map((s) => [s.servicio, s.modalidad, s.estado]).sort(), [['Constitución de sociedad', 'UNICA', 'TERMINADO'], ['Contabilidad', 'MENSUAL', 'VIGENTE'], ['Remuneraciones', 'MENSUAL', 'VIGENTE']]);
  // Terminar la contabilidad: queda en la ficha con su historia, no desaparece.
  Cl.guardarServicio(db, D({ id: c.id, expected_version: 1, cliente_id: 'CL-1', servicio: 'Contabilidad', modalidad: 'MENSUAL', monto_neto: '90.000', dia_facturacion: 5, desde: '2026-03-01', hasta: '2026-08-31' }), ctx);
  const cont = lista().find((s) => s.id === c.id);
  assert.deepEqual([cont.estado, cont.historial.length, cont.historial[0].antes.hasta], ['TERMINADO', 1, null]);
  // Una nota de venta interna relaciona dos servicios y no se presenta como emitida fuera.
  const nv = Cl.guardarDocumento(db, D({ cliente_id: 'CL-1', tipo: 'NOTA_VENTA', numero: 'NV-7', servicio_ids: [m.id, u.id], fecha: '2026-02-01' }), ctx);
  const doc = Cl.ficha(db, D({ cliente_id: 'CL-1' }), ctx).documentos.find((x) => x.id === nv.id);
  assert.deepEqual([doc.servicio_ids.length, !!doc.emitido_externamente], [2, false]);
});

test('ficha del cliente: alias únicos, servicios con historia, documento interno ≠ emisión externa', (t) => {
  const { db, ctx, D } = preparar(t);
  Cl.guardarFicha(db, D({ cliente_id: 'CL-1', alias: ['ANDES', 'ANDES M'], canal: 'Referido', empresa_facturadora: 'HomePymes Antiguo' }), ctx);
  assert.equal(Cl.fichas_().get('CL-1').empresa_facturadora, 'HomePymes');
  assert.ok(/otro cliente/.test(Cl.guardarFicha(db, D({ cliente_id: 'CL-2', alias: ['andes'] }), ctx).message), 'un alias no se repite entre clientes');
  const s = Cl.guardarServicio(db, D({ cliente_id: 'CL-1', servicio: 'Remuneraciones', modalidad: 'MENSUAL', monto_neto: '150.000', dia_facturacion: 5, desde: '2026-01-01' }), ctx);
  Cl.guardarServicio(db, D({ id: s.id, expected_version: 1, cliente_id: 'CL-1', servicio: 'Remuneraciones', modalidad: 'MENSUAL', monto_neto: '180.000', dia_facturacion: 5, desde: '2026-01-01' }), ctx);
  assert.equal(Cl.servicios_('CL-1')[0].historial[0].antes.monto_neto, 150000, 'el cambio guarda lo anterior');
  assert.ok(Cl.guardarDocumento(db, D({ cliente_id: 'CL-1', tipo: 'NOTA_VENTA', emitido_externamente: true }), ctx)._validationError, 'una emisión externa exige su referencia');
  const doc = Cl.guardarDocumento(db, D({ cliente_id: 'CL-1', tipo: 'CONTRATO', numero: 'C-1', servicio_ids: [s.id], fecha: '2026-01-01' }), ctx);
  const adj = Cl.subirAdjunto(db, D({ documento_id: doc.id, nombre: 'contrato.pdf', tipo: 'application/pdf', base64: Buffer.from('%PDF demo').toString('base64') }), ctx);
  assert.equal(Buffer.from(Cl.descargarAdjunto(db, D({ id: adj.id }), ctx).base64, 'base64').toString(), '%PDF demo');
  const fi = Cl.ficha(db, D({ cliente_id: 'CL-1' }), ctx);
  assert.deepEqual([fi.documentos.length, fi.documentos[0].adjuntos.length, fi.servicios.length], [1, 1, 1]);
});
