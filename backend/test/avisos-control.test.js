'use strict';

/**
 * Avisos de control programados (Plan de control, P8): estado de cada aviso
 * con los criterios de los indicadores, configuración por gerencia, envío el
 * día elegido y al 100 %, una sola vez por período.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const A = require('../logica/avisosControl');

const GER = { email: 'gerencia@homepymes.cl', rol: 'GERENCIA', modulos: [] };
const DEV = { email: 'dev@homepymes.cl', rol: 'DEV', modulos: [] };
let n = 0;
function crear() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  agregarFila_(db, 'USUARIOS', { usuario_id: 'U1', nombre: 'Francisca', email: 'fran@homepymes.cl', rol: 'DEV', activo: true });
  agregarFila_(db, 'USUARIOS', { usuario_id: 'U2', nombre: 'Gerente', email: GER.email, rol: 'GERENCIA', activo: true });
  return db;
}
function fila(db, matriz, periodo, cliente, datos, estado) {
  agregarFila_(db, 'CI_REGISTROS', { registro_id: 'R' + (++n), depto: matriz === 'REMUNERACIONES' ? 'RRHH' : 'CONTABILIDAD', matriz, periodo, cliente_nombre: cliente,
    estado: estado || 'PENDIENTE', responsable_email: 'fran@homepymes.cl', datos: datos || {}, activa: true });
}

test('estado del F29: período anterior, declarados por fecha y lo que falta con su responsable', () => {
  const db = crear();
  fila(db, 'IVA', '2026-M10', 'Ferretería Sur', { fecha_declaracion: '2026-11-12' }, 'TERMINADO');
  fila(db, 'IVA', '2026-M10', 'Taller Vega', {});
  fila(db, 'IVA', '2026-M10', 'Anulado SA', {}, 'ANULADO');
  fila(db, 'IVA', '2026-M11', 'Del mes que corre', {});
  const e = A.estado(db, 'IVA_F29', '2026-11-18');
  assert.equal(e.periodo, '2026-M10');
  assert.equal(e.total, 2, 'lo anulado no cuenta');
  assert.equal(e.hechos, 1);
  assert.deepEqual(e.faltan, [{ cliente: 'Taller Vega', responsable: 'Francisca' }]);
  assert.equal(e.vence, '2026-11-20');
  const t = A.textoEstado_(e, '2026-11-18');
  assert.match(t, /F29 \(IVA\) de octubre 2026: 1 de 2 listos \(50 %\)\. Vence el 20 nov\./);
  assert.match(t, /Faltan:\n  • Taller Vega — Francisca/);
});

test('cotizaciones por mes de la remuneración y convenios con cuotas vencidas', () => {
  const db = crear();
  fila(db, 'REMUNERACIONES', '2026-M10', 'A', { fecha_recepcion_informacion: '2026-10-28', fecha_declaracion: '2026-11-08' });
  fila(db, 'REMUNERACIONES', '2026-M11', 'B', { fecha_recepcion_informacion: '2026-11-02' }); // mes de la remuneración: octubre
  const c = A.estado(db, 'COTIZACIONES', '2026-11-09');
  assert.equal(c.periodo, '2026-M10');
  assert.equal(c.total, 2);
  assert.equal(c.hechos, 1);
  fila(db, 'CONVENIOS', '2026-M11', 'X', {}, 'CON_VENCIDAS');
  fila(db, 'CONVENIOS', '2026-M11', 'Y', {}, 'AL_DIA');
  fila(db, 'CONVENIOS', '2026-M11', 'Z', {}, 'SIN_CONVENIO');
  const v = A.estado(db, 'CONVENIOS', '2026-11-05');
  assert.equal(v.total, 2);
  assert.deepEqual(v.faltan.map((f) => f.cliente), ['X']);
  assert.match(A.textoEstado_(v, '2026-11-05'), /1 de 2 clientes con convenio tienen cuotas vencidas/);
});

test('gerencia configura; el día elegido sale una vez, y al 100 % otra vez', async (t) => {
  const Resend = require('../logica/resend');
  const orig = Resend.enviarCorreoResend_;
  const enviados = [];
  Resend.enviarCorreoResend_ = async (m) => { enviados.push(m.subject); return { id: 'x' }; };
  t.after(() => { Resend.enviarCorreoResend_ = orig; });
  const db = crear();
  assert.ok(A.listar(db, {}, DEV)._forbidden);
  assert.ok(A.guardar(db, { clave: 'IVA_F29', activo: true, dia: 31, destinatarios: [GER.email] }, GER)._validationError);
  assert.ok(A.guardar(db, { clave: 'IVA_F29', activo: true, dia: 18, destinatarios: [] }, GER)._validationError);
  A.guardar(db, { clave: 'IVA_F29', activo: true, dia: 18, destinatarios: [GER.email], avisar_100: true }, GER);
  const l = A.listar(db, {}, GER);
  const iva = l.avisos.find((x) => x.clave === 'IVA_F29');
  assert.equal(iva.activo, true);
  assert.equal(iva.dia, 18);
  assert.ok(l.no_disponibles.some((x) => /Prebalances/.test(x.titulo)));
  fila(db, 'IVA', '2026-M10', 'Ferretería Sur', { fecha_declaracion: '2026-11-12' }, 'TERMINADO');
  fila(db, 'IVA', '2026-M10', 'Taller Vega', {});
  assert.deepEqual(await A.revisarDiario(db, { hoy: '2026-11-17' }), [], 'otro día no sale nada');
  await A.revisarDiario(db, { hoy: '2026-11-18' });
  await A.revisarDiario(db, { hoy: '2026-11-18' });
  assert.deepEqual(enviados, ['SIGSO — F29 (IVA): 1 de 2 listos'], 'una sola vez por período');
  // Se completa: al día siguiente llega el aviso del 100 %, una vez.
  agregarFila_(db, 'CI_REGISTROS', { registro_id: 'R-OK', depto: 'CONTABILIDAD', matriz: 'IVA', periodo: '2026-M10', cliente_nombre: 'Taller Vega 2', estado: 'TERMINADO', datos: { fecha_declaracion: '2026-11-19' }, activa: true });
  const { leerFilas_ } = require('../db/sqliteRepo');
  const pend = leerFilas_(db, 'CI_REGISTROS', COLUMNAS.CI_REGISTROS).find((r) => r.cliente_nombre === 'Taller Vega');
  require('../db/sqliteRepo').actualizarFilaPorId_(db, 'CI_REGISTROS', 'registro_id', pend.registro_id, { datos: { fecha_declaracion: '2026-11-19' }, estado: 'TERMINADO' });
  await A.revisarDiario(db, { hoy: '2026-11-19' });
  await A.revisarDiario(db, { hoy: '2026-11-20' });
  assert.deepEqual(enviados, ['SIGSO — F29 (IVA): 1 de 2 listos', 'SIGSO — F29 (IVA): ¡listo al 100 %!']);
});
