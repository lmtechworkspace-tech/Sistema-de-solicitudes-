'use strict';

/**
 * Finanzas · corrección v2, I07 (2026-10-20): cargas, migración y reglas.
 * Montos de planilla (miles como texto, errores de fórmula, otras monedas),
 * corregir / apartar / recuperar filas dentro de SIGSO sin tocar el original,
 * cuadro de control por hoja, perfiles de mapeo con versión y reglas con
 * alcance, vigencia, evidencia y vista previa de impacto. Datos inventados.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { preparar, cartola } = require('./_finanzasPrueba');
const F = require('../logica/finanzasBancos');
const Ca = require('../logica/finanzasCargas');
const Rg = require('../logica/finanzasReglas');
const Op = require('../logica/finanzasOperaciones');

function libro(hojas) { return { nombre: 'libro.xlsx', hash: crypto.createHash('sha256').update(JSON.stringify(hojas)).digest('hex'), hojas }; }
const SIGECO = () => [
  { nombre: 'CATÁLOGOS', filas: [['EMPRESAS', '', 'PLAN DE CUENTAS', 'TIPO'], ['GDE', '', 'Servicio Mensual', 'Ingreso']] },
  { nombre: 'CLIENTES', filas: [['ID', 'RUT', 'RAZÓN SOCIAL', 'EMPRESA FACTURADORA', 'ESTADO'], ['C001', '76.086.428-5', 'ANDES MONTAJES INDUSTRIALES SPA', 'HomePymes', 'Activo'], ['C002', '99.999.999-9', 'NORTE CON RUT MAL ESCRITO', 'GDE', 'Activo']] },
  { nombre: 'FACTURAS', filas: [['N° FACTURA', 'FECHA EMISIÓN', 'ID CLIENTE', 'CLIENTE', 'EMPRESA EMISORA', 'TOTAL'], ['10', '46200', 'C001', 'ANDES', 'HomePymes', '1.500'], ['11', '46201', 'C001', 'ANDES', 'HomePymes', '#REF!'], ['12', '46202', 'C001', 'ANDES', 'HomePymes', 'US$ 300']] },
  { nombre: 'PAGOS', filas: [['FECHA PAGO', 'ID CLIENTE'], []] },
  { nombre: 'MOVIMIENTOS', filas: [['FECHA', 'MES (AAAA-MM)', 'EMPRESA', 'TIPO', 'CUENTA', 'DETALLE', 'MONTO'], []] }
];

test('I07.3 · montos: miles como texto, error de fórmula y otra moneda nunca se vuelven cero ni CLP', () => {
  assert.deepEqual(Ca.monto_('1.500'), { ok: true, valor: 1500 }, '«1.500» son mil quinientos, no 1,5');
  assert.equal(Ca.monto_('1500').valor, 1500);
  assert.equal(Ca.monto_('-2.500.000').valor, -2500000);
  assert.match(Ca.monto_('#REF!').error, /error de fórmula/);
  assert.match(Ca.monto_('#DIV/0!').error, /error de fórmula/);
  const u = Ca.monto_('US$ 300');
  assert.deepEqual([u.ok, u.moneda], [false, 'USD']);
  assert.match(u.error, /fuera del consolidado/);
  assert.equal(Ca.monto_('UF 3,2').moneda, 'UF');
  assert.equal(Ca.monto_('$ 1.500').valor, 1500, 'el «$» chileno sí es CLP');
});

test('I07.2 · corregir una fila en SIGSO (el original se conserva), apartarla y recuperarla; repetir no duplica', (t) => {
  const { db, ctx, D } = preparar(t);
  const c = Ca.cargar(db, D(libro(SIGECO())), ctx);
  assert.deepEqual(Ca.publicar(db, D({ lote_id: c.lote_id, hoja: 'CLIENTES' }), ctx).resultado, { PUBLICADA: 1, INCIDENCIA: 1 });
  // Corregir el RUT de la fila 3 (columna 1): queda «por publicar» y al publicar se toma la corrección.
  const r = Ca.corregirFila(db, D({ lote_id: c.lote_id, hoja: 'CLIENTES', fila: 3, cambios: { 1: '77.123.456-1' }, motivo: 'RUT mal escrito' }), ctx);
  assert.equal(r.estado, 'PENDIENTE');
  assert.deepEqual(Ca.publicar(db, D({ lote_id: c.lote_id, hoja: 'CLIENTES' }), ctx).resultado, { PUBLICADA: 1 });
  const dq = Ca.dondeQuedo(db, D({ lote_id: c.lote_id, hoja: 'CLIENTES', fila: 3 }), ctx);
  assert.equal(dq.valores[1], '99.999.999-9', 'el valor original del archivo no se modifica');
  assert.equal(dq.estado, 'PUBLICADA');
  // Una fila publicada no se corrige aquí.
  assert.ok(Ca.corregirFila(db, D({ lote_id: c.lote_id, hoja: 'CLIENTES', fila: 3, cambios: { 1: 'x' } }), ctx)._validationError);
  // Apartar exige motivo, no se reintenta al publicar y se puede recuperar.
  assert.ok(Ca.corregirFila(db, D({ lote_id: c.lote_id, hoja: 'FACTURAS', fila: 3, accion: 'APARTAR' }), ctx)._validationError);
  Ca.corregirFila(db, D({ lote_id: c.lote_id, hoja: 'FACTURAS', fila: 3, accion: 'APARTAR', motivo: 'Falta la planilla corregida' }), ctx);
  const pub = Ca.publicar(db, D({ lote_id: c.lote_id, hoja: 'FACTURAS' }), ctx).resultado;
  assert.equal(pub.APARTADA, undefined, 'lo apartado no se publica');
  assert.ok(!Ca.fuente(db, D({ lote_id: c.lote_id, hoja: 'FACTURAS' }), ctx).filas.some((f) => f.fila === 3 && f.estado !== 'APARTADA'));
  assert.equal(Ca.corregirFila(db, D({ lote_id: c.lote_id, hoja: 'FACTURAS', fila: 3, accion: 'RECUPERAR' }), ctx).estado, 'PENDIENTE');
  // Repetir la publicación no duplica facturas.
  const antes = require('../logica/finanzasCobranza').facturas(db, D({ estado: 'todas' }), ctx).facturas.length;
  Ca.publicar(db, D({ lote_id: c.lote_id, hoja: 'FACTURAS' }), ctx);
  Ca.publicar(db, D({ lote_id: c.lote_id, hoja: 'FACTURAS' }), ctx);
  assert.equal(require('../logica/finanzasCobranza').facturas(db, D({ estado: 'todas' }), ctx).facturas.length, antes);
});

test('I07.5 · cuadro de control: cantidades e importes por hoja, con motivos agrupados', (t) => {
  const { db, ctx, D } = preparar(t);
  const c = Ca.cargar(db, D(libro(SIGECO())), ctx);
  ['CATÁLOGOS', 'CLIENTES', 'FACTURAS'].forEach((h) => Ca.publicar(db, D({ lote_id: c.lote_id, hoja: h }), ctx));
  const q = Ca.cuadroControl(db, D({ lote_id: c.lote_id }), ctx);
  const fac = q.hojas.find((h) => h.hoja === 'FACTURAS');
  assert.equal(fac.leidas, 3);
  assert.equal(fac.columna_monto, 'TOTAL');
  assert.equal(fac.montos_no_leibles, 2, 'el #REF! y el US$ no se suman como si fueran pesos');
  assert.equal(fac.por_estado.INCIDENCIA, 2, 'esas dos filas quedan como incidencia con su motivo');
  const folios = require('../logica/finanzasCobranza').facturas(db, D({ estado: 'todas' }), ctx).facturas.map((f) => [f.folio, f.total]);
  assert.deepEqual(folios, [['10', 1500]], 'no se crean facturas en $0 desde un error de fórmula o un monto en dólares');
  assert.ok(fac.importe_leido === 1500);
  assert.ok(fac.motivos.length >= 1);
  assert.equal(q.totales.leidas, q.hojas.reduce((s, h) => s + h.leidas, 0));
  assert.equal(q.totales.leidas, Object.values(q.totales).slice(1).reduce((s, n) => s + n, 0), 'cada fila leída está en exactamente un estado');
});

test('I07.2 · perfil de mapeo: guarda encabezado, ejemplo y versión', (t) => {
  const { db, ctx, D } = preparar(t);
  const a = Op.guardarPerfil(db, D({ tipo: 'MAPEO', nombre: 'Excel cobranzas', mapeo: { 0: 'fecha', 1: 'monto' }, primera_fila_titulos: true, encabezado: ['Fecha', 'Monto'], ejemplo: ['01-10-2026', '1.000'] }), ctx);
  Op.guardarPerfil(db, D({ tipo: 'MAPEO', id: a.id, nombre: 'Excel cobranzas', mapeo: { 0: 'fecha', 2: 'monto' }, primera_fila_titulos: true, encabezado: ['Fecha', 'Cliente', 'Monto'] }), ctx);
  const m = Op.perfiles(db, D({}), ctx).mapeos.find((x) => x.id === a.id);
  assert.deepEqual([m.version, m.encabezado], [2, ['Fecha', 'Cliente', 'Monto']]);
});

test('I07.6 · reglas: alcance, vigencia y evidencia; vista previa del impacto; nada global desde una glosa genérica', (t) => {
  const { db, ctx, D } = preparar(t);
  F.importarCartola(db, D({ filas: cartola([['05/08/2026', 'TRANSFER DE LUZ DEL VALLE', 45000, 0, '1'], ['06/08/2026', 'PAGO CUENTAS VIA INTERNET', 10000, 0, '2']]), empresa: 'HomePymes' }), ctx);
  const clasif = { tipo: 'EGRESO', cuenta: 'Cuentas Básicas' };
  assert.match(Rg.crearRegla(db, D({ glosa: 'PAGO CUENTAS VIA INTERNET', clasif, previsualizar: true }), ctx).message, /genérica/);
  const fuera = Rg.crearRegla(db, D({ glosa: 'TRANSFER DE LUZ DEL VALLE', clasif, alcance: { empresa: 'GDE' }, previsualizar: true }), ctx);
  assert.equal(fuera.impacto.pendientes, 1);
  assert.equal(fuera.impacto.cambian.length, 0, 'con alcance GDE no toca un movimiento de HomePymes');
  const pv = Rg.crearRegla(db, D({ glosa: 'TRANSFER DE LUZ DEL VALLE', clasif, alcance: { empresa: 'HomePymes', sentido: 'cargo' }, vigencia: { desde: '2026-01-01' }, previsualizar: true }), ctx);
  assert.equal(pv.impacto.cambian.length, 1);
  assert.match(pv.impacto.cambian[0].despues, /Cuentas Básicas/);
  assert.ok(Rg.crearRegla(db, D({ glosa: 'TRANSFER DE LUZ DEL VALLE', clasif, alcance: { empresa: 'HomePymes' } }), ctx)._validationError, 'sin evidencia no se guarda');
  const ok = Rg.crearRegla(db, D({ glosa: 'TRANSFER DE LUZ DEL VALLE', clasif, alcance: { empresa: 'HomePymes', sentido: 'cargo' }, vigencia: { desde: '2026-01-01' }, evidencia: 'Contrato de luz de la oficina' }), ctx);
  assert.equal(ok.cambiadas, 1);
  const r = Rg.listar(db, D({}), ctx).reglas.find((x) => x.glosa === 'TRANSFER DE LUZ DEL VALLE');
  assert.deepEqual([r.alcance.empresa, r.alcance.sentido, r.vigencia.desde, r.evidencia, r.creada_por], ['HomePymes', 'cargo', '2026-01-01', 'Contrato de luz de la oficina', 'Persona Uno']);
  assert.ok(Rg.crearRegla(db, D({ glosa: 'TRANSFER DE LUZ DEL VALLE', clasif, evidencia: 'x y z' }), ctx)._validationError, 'una glosa con regla se edita, no se duplica');
  // Vigencia: fuera de ella la regla no aplica.
  assert.equal(F.reglaAplica_({ vigencia: { hasta: '2026-07-31' } }, { fecha: '2026-08-05' }, { empresa: 'HomePymes' }, 'cargo'), false);
  // Cambiar el alcance (editar) recalcula solo lo pendiente.
  const ed = Rg.guardarRegla(db, D({ id: r.id, alcance: { empresa: 'GDE' }, expected_version: r.version }), ctx);
  assert.equal(ed.cambiadas, 1);
});
