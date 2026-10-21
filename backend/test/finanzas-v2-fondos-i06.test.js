'use strict';

/**
 * Finanzas · corrección v2, I06 (2026-10-20): fondos, aperturas y remanentes.
 * VYE (saldo 0), sugerencia de gestión y gestión creada desde un movimiento sin
 * contar dos veces, aperturas en lote con vista previa e incidentes, cero
 * conocido vs. desconocido, corrección por versión, política de una o dos
 * personas, reasignación entre clientes bloqueada y conversión del remanente
 * en honorario sin abono bancario ficticio. Datos inventados.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparar, versionDe } = require('./_finanzasPrueba');
const Op = require('../logica/finanzasOperaciones');
const Fo = require('../logica/finanzasFondos');
const Cat = require('../logica/finanzasCatalogos');
const C = require('../logica/finanzasCobranza');

const op = (db, D, ctx, o) => Op.guardar(db, D(Object.assign({ empresa: 'HomePymes', medio: 'TRANSFERENCIA', confirmar: true }, o)), ctx);

test('I06.5 · VYE: $5.000.000 + $2.074.824 − $7.074.824 = $0', (t) => {
  const { db, ctx, D } = preparar(t);
  const g = Fo.guardarGestion(db, D({ cliente_id: 'CL-3', empresa: 'HomePymes', obligacion: 'Imposiciones', periodo_obligacion: '2026-07' }), ctx);
  op(db, D, ctx, { fecha: '2026-07-05', sentido: 'ENTRADA', monto: 5000000, tipo: 'FONDO_RECIBIDO', cuenta: 'Imposiciones', cliente_id: 'CL-3', gestion_id: g.id });
  op(db, D, ctx, { fecha: '2026-07-08', sentido: 'ENTRADA', monto: 2074824, tipo: 'FONDO_RECIBIDO', cuenta: 'Imposiciones', cliente_id: 'CL-3', gestion_id: g.id });
  op(db, D, ctx, { fecha: '2026-07-10', sentido: 'SALIDA', monto: 7074824, tipo: 'FONDO_PAGADO', subtipo: 'PAGO_OBLIGACION', cuenta: 'Imposiciones', cliente_id: 'CL-3', gestion_id: g.id, destino: 'Previred' });
  const ge = Fo.fichaFondos(db, D({ cliente_id: 'CL-3' }), ctx).gestiones[0];
  assert.deepEqual([ge.recibido, ge.pagado, ge.saldo], [7074824, 7074824, 0]);
});

test('I06.2 · lo sin gestión sugiere la gestión que calza y se puede crear una desde el movimiento, sin contar dos veces', (t) => {
  const { db, ctx, D } = preparar(t);
  const g = Fo.guardarGestion(db, D({ cliente_id: 'CL-1', empresa: 'HomePymes', obligacion: 'Imposiciones', periodo_obligacion: '2026-08' }), ctx);
  op(db, D, ctx, { fecha: '2026-08-03', sentido: 'ENTRADA', monto: 300000, tipo: 'FONDO_RECIBIDO', cuenta: 'Imposiciones', cliente_id: 'CL-1', periodo_obligacion: '2026-08' });
  op(db, D, ctx, { fecha: '2026-08-04', sentido: 'ENTRADA', monto: 80000, tipo: 'FONDO_RECIBIDO', cuenta: 'IVA', cliente_id: 'CL-1', periodo_obligacion: '2026-07', destino: 'F29 julio' });
  let f = Fo.fichaFondos(db, D({ cliente_id: 'CL-1' }), ctx);
  assert.equal(f.saldo, 380000);
  assert.equal(f.filtros.sin_asignacion, 2);
  const imp = f.sin_gestion.piezas.find((p) => p.concepto === 'Imposiciones'), iva = f.sin_gestion.piezas.find((p) => p.concepto === 'IVA');
  assert.equal(imp.sugerencias[0].gestion_id, g.id);
  assert.deepEqual(imp.sugerencias[0].motivos, ['misma obligación', 'mismo período', 'misma empresa']);
  assert.equal(iva.sugerencias.length, 0, 'no se sugiere una gestión de otra obligación');
  const r = Fo.gestionDesdePieza(db, D({ ref: iva.ref, cliente_id: 'CL-1', idempotency_key: 'gp-1' }), ctx);
  assert.ok(r.gestion_id, r.message);
  f = Fo.fichaFondos(db, D({ cliente_id: 'CL-1' }), ctx);
  const nueva = f.gestiones.find((x) => x.id === r.gestion_id);
  assert.deepEqual([nueva.obligacion, nueva.periodo_obligacion, nueva.recibido, nueva.destinos[0].nombre], ['IVA', '2026-07', 80000, 'F29 julio']);
  assert.equal(f.saldo, 380000, 'asignar no hace desaparecer ni duplica dinero');
  assert.equal(f.filtros.sin_asignacion, 1);
});

test('I06.3 · aperturas en lote: vista previa, incidentes, totales por empresa, cero conocido y corrección por versión', (t) => {
  const { db, ctx, ctx2, D, D2 } = preparar(t);
  const filas = [['RUT cliente', 'Empresa', 'Fecha de corte', 'Monto', 'Moneda', 'Fuente'],
    ['76.086.428-5', 'HomePymes', '2026-07-31', '150.000', 'CLP', 'Planilla SIGECO al 31-07'],
    ['CONSTRUCTORA NORTE SPA', 'HomePymes', '2026-07-31', '0', 'CLP', 'Cliente nuevo: confirma que no tenía saldo'],
    ['76.086.428-5', 'HomePymes', '2026-07-31', '150.000', 'CLP', 'repetida'],
    ['99.999.999-9', 'GDE', '2026-07-31', '10.000', 'CLP', 'x fuente'],
    ['76.543.210-3', 'GDE', '2026-07-31', '5.000', 'USD', 'cartola']];
  const r = Fo.revisarAperturas(db, D({ filas }), ctx);
  assert.deepEqual([r.aceptadas, r.incidentes], [2, 3]);
  assert.deepEqual(r.totales_por_empresa, { HomePymes: 150000 });
  assert.match(r.revision[2].errores[0], /Repetida: igual a la fila 2/);
  assert.match(r.revision[3].errores[0], /Cliente no encontrado/);
  assert.match(r.revision[4].errores.join(' '), /Solo pesos/);
  assert.match(r.revision[1].avisos[0], /cero conocido/);
  assert.equal(Fo.proponerAperturas(db, D({ filas, token: 'otro' }), ctx).codigo, 'CONFLICTO_VERSION');
  const p = Fo.proponerAperturas(db, D({ filas, token: r.token, idempotency_key: 'ap-1' }), ctx);
  assert.equal(p.propuestas, 2);
  // Ya propuestas: una segunda carga las marca como solapadas.
  assert.equal(Fo.revisarAperturas(db, D({ filas }), ctx).aceptadas, 0);
  // Cero conocido: con la apertura de $0 aprobada, el saldo de Constructora deja de ser parcial.
  const ap = Fo.aperturas_({}).find((a) => a.cliente_id === 'CL-2');
  Fo.decidirApertura(db, D({ id: ap.id, accion: 'APROBAR', expected_version: versionDe('FIN_APERTURAS', ap.id) }), ctx);
  const f2 = Fo.fichaFondos(db, D({ cliente_id: 'CL-2' }), ctx);
  assert.deepEqual([f2.apertura, f2.parcial], ['CONOCIDA', false]);
  // Corrección de una aprobada: nueva versión propuesta; la anterior sigue vigente hasta aprobar la nueva.
  const a1 = Fo.aperturas_({}).find((a) => a.cliente_id === 'CL-1');
  Fo.decidirApertura(db, D({ id: a1.id, accion: 'APROBAR', expected_version: versionDe('FIN_APERTURAS', a1.id) }), ctx);
  const cr = Fo.corregirApertura(db, D({ id: a1.id, expected_version: versionDe('FIN_APERTURAS', a1.id), monto: '175.000', motivo: 'Faltaba un depósito de junio' }), ctx);
  assert.equal(cr.reemplaza, a1.id);
  assert.equal(Fo.custodiaAl_('2026-08-31', '').clientes.find((c) => c.cliente_id === 'CL-1').saldo, 150000, 'sigue la vigente');
  // Política «dos personas»: quien propuso no aprueba; otra persona sí.
  Cat.guardar(db, D({ tipo: 'PARAMETRO', id: 'aperturas_dos_personas', nombre: 'Saldos iniciales: dos personas', valor: 1, expected_version: (Cat.lista_('PARAMETRO', { todos: true }).find((y) => y.id === 'aperturas_dos_personas') || {}).version }), ctx);
  assert.equal(Fo.decidirApertura(db, D({ id: cr.id, accion: 'APROBAR', expected_version: versionDe('FIN_APERTURAS', cr.id) }), ctx).codigo, 'PERMISO');
  assert.equal(Fo.decidirApertura(db, D2({ id: cr.id, accion: 'APROBAR', expected_version: versionDe('FIN_APERTURAS', cr.id) }), ctx2).estado, 'APROBADA');
  const todas = Fo.aperturas_({}).filter((a) => a.cliente_id === 'CL-1');
  assert.deepEqual(todas.map((a) => a.estado).sort(), ['APROBADA', 'REEMPLAZADA']);
  assert.equal(Fo.custodiaAl_('2026-08-31', '').clientes.find((c) => c.cliente_id === 'CL-1').saldo, 175000);
  const pol = Fo.fondos(db, D({}), ctx).politica;
  assert.equal(pol.dos_personas, true);
  assert.deepEqual(pol.aprobadores.sort(), ['Persona Dos', 'Persona Uno']);
});

test('I06.4 · remanente: decidir no mueve dinero; convertir en honorario sale de custodia y queda como cobro propio, sin banco', (t) => {
  const { db, ctx, D } = preparar(t);
  const g = Fo.guardarGestion(db, D({ cliente_id: 'CL-1', empresa: 'HomePymes', obligacion: 'Imposiciones', periodo_obligacion: '2026-06', solicitado: '2.100.000' }), ctx);
  op(db, D, ctx, { fecha: '2026-06-02', sentido: 'ENTRADA', monto: 2100000, tipo: 'FONDO_RECIBIDO', cuenta: 'Imposiciones', cliente_id: 'CL-1', gestion_id: g.id });
  [1258430, 386260, 353571].forEach((m, i) => op(db, D, ctx, { fecha: '2026-06-1' + i, sentido: 'SALIDA', monto: m, tipo: 'FONDO_PAGADO', subtipo: 'PAGO_OBLIGACION', cuenta: 'Imposiciones', cliente_id: 'CL-1', gestion_id: g.id, destino: 'Obra ' + (i + 1), periodo_obligacion: '2026-06' }));
  let ge = Fo.fichaFondos(db, D({ cliente_id: 'CL-1' }), ctx).gestiones[0];
  assert.equal(ge.saldo, 101739);
  assert.ok(ge.banderas.remanente_sin_decidir);
  // Reasignar a otro cliente: no habilitado.
  const otra = Fo.guardarGestion(db, D({ cliente_id: 'CL-2', empresa: 'HomePymes', obligacion: 'Imposiciones', periodo_obligacion: '2026-06' }), ctx);
  assert.match(Fo.reasignar(db, D({ desde: g.id, hacia: otra.id, monto: 1000, motivo: 'prueba' }), ctx).message, /MISMO cliente/);
  const v = Fo.fichaFondos(db, D({ cliente_id: 'CL-1' }), ctx).gestiones[0].version;
  assert.ok(Fo.decidirRemanente(db, D({ gestion_id: g.id, decision: 'HONORARIO', nota: 'Acordado', expected_version: v }), ctx)._validationError, 'honorario exige respaldo');
  Fo.decidirRemanente(db, D({ gestion_id: g.id, decision: 'HONORARIO', respaldo: 'Correo del cliente 30-06', expected_version: v }), ctx);
  ge = Fo.fichaFondos(db, D({ cliente_id: 'CL-1' }), ctx).gestiones[0];
  assert.deepEqual([ge.saldo, ge.remanente_estado], [101739, 'PENDIENTE_DE_REGISTRO'], 'la intención no mueve dinero');
  const r = Fo.convertirRemanente(db, D({ gestion_id: g.id, expected_version: ge.version, fecha: '2026-07-01', idempotency_key: 'cv-1' }), ctx);
  assert.equal(r.monto, 101739);
  ge = Fo.fichaFondos(db, D({ cliente_id: 'CL-1' }), ctx).gestiones[0];
  assert.deepEqual([ge.saldo, ge.remanente_estado, ge.devuelto], [0, 'EJECUTADA', 101739]);
  const ing = Op.detalle(db, D({ id: r.ingreso_id }), ctx);
  assert.deepEqual([ing.medio, ing.conciliacion, ing.sentido, ing.distribuciones[0].tipo, ing.origen.par], ['COMPENSACION', 'NO_APLICA', 'ENTRADA', 'INGRESO', r.salida_id]);
  // El cobro propio puede aplicarse a una factura (no es un abono bancario nuevo).
  assert.ok(C.recepciones_({ cliente_id: 'CL-1' }).some((x) => x.monto === 101739 && x.caja === false));
  // Reintento: no duplica.
  assert.equal(Fo.convertirRemanente(db, D({ gestion_id: g.id, expected_version: ge.version - 1, fecha: '2026-07-01', idempotency_key: 'cv-1' }), ctx).ingreso_id, r.ingreso_id);
});
