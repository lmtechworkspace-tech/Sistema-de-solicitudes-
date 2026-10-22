'use strict';

/**
 * Finanzas v5.3 · revisar el mes desde la planilla: los pasos, los nombres parecidos, el cierre con lo anotado en la
 * planilla y el aviso en la campana al enviar a revisión y al devolver con observaciones.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparar, cartola } = require('./_finanzasPrueba');
const F = require('../logica/finanzasBancos');
const H = require('../logica/finanzasHoja');
const Rv = require('../logica/finanzasRevision');
const C = require('../logica/finanzasCierre');
const B = require('../logica/finanzasBoveda');
const { leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');

function base(t) {
  const p = preparar(t);
  const { db, ctx, D } = p;
  F.importarCartola(db, D({ empresa: 'HomePymes', filas: cartola([
    ['02/09/2026', 'TRANSFER DE LUIS ARMANDO', 0, 1077, '1'], ['03/09/2026', 'PAGO CUENTAS VIA INTERNET', 1077, 0, '2'],
    ['10/09/2026', 'TRASPASO FONDOS OTRO BANCO', 500000, 0, '3']], { periodo: '01-09-2026 al 30-09-2026' }) }), ctx);
  const cuenta = B.dbFin().prepare('SELECT id FROM FIN_CUENTAS').get().id;
  const g = (campos) => { const r = H.guardar(db, D({ cuenta_ref: cuenta, campos }), ctx); assert.ok(!r._validationError, r.message); return r; };
  return Object.assign(p, { cuenta, g });
}

test('parecidos · el mismo cliente escrito distinto se junta; nombres distintos no', () => {
  const p = Rv.parecidos_([
    { nombre: 'ARMANDO LAEL', grupo: 'Z' }, { nombre: 'ARMANDO LAEL' }, { nombre: 'CONST ARMANDO Y LAEL', grupo: 'Z' },
    { nombre: 'CONSTRUCTORA MELO SPA' }, { nombre: 'CONST MELO' }, { nombre: 'VICTOR ARENAS' }, { nombre: 'ARENAS SPA' }]);
  assert.equal(p.length, 2);
  assert.deepEqual(p[0].nombres.map((n) => n.nombre).sort(), ['ARMANDO LAEL', 'CONST ARMANDO Y LAEL']);
  assert.equal(p[0].sugerido, 'ARMANDO LAEL', 'el más usado');
  assert.deepEqual(p[1].nombres.map((n) => n.nombre).sort(), ['CONST MELO', 'CONSTRUCTORA MELO SPA']);
});

test('revisión · pasos de la planilla, aviso de nombres, y el cierre acepta lo anotado en la planilla', (t) => {
  const { db, ctx, D, cuenta, g } = base(t);
  let r = Rv.revision(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx);
  assert.ok(!r._validationError, r.message);
  assert.equal(r.pasos.find((p) => p.id === 'falta').n, 3);
  assert.equal(r.listo, false);
  g({ fecha: '2026-09-02', monto: 1077, nombre: 'ARMANDO LAEL', obs: 'IVA', grupo: 'Z' });
  g({ fecha: '2026-09-03', monto: -1077, nombre: 'CONST ARMANDO Y LAEL', obs: 'IVA', grupo: 'Z' });
  g({ fecha: '2026-09-10', monto: -500000, nombre: 'BARBARA ALVAREZ', obs: 'ABONO' });
  r = Rv.revision(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx);
  assert.equal(r.pasos.find((p) => p.id === 'falta').ok, true);
  assert.equal(r.pasos.find((p) => p.id === 'completar').n, 1, 'el sueldo sin plan de cuenta');
  assert.ok(r.avisos.find((a) => a.id === 'nombres'));
  assert.equal(r.parecidos[0].nombres.length, 2);
  assert.equal(C.verificar_('2026-09').pasos.find((p) => p.id === 'revisado').ok, true, 'lo anotado en la planilla cuenta como revisado');
  const fila = H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx).filas.find((f) => f.monto === -500000);
  H.guardar(db, D({ id: fila.id, expected_version: fila.version, campos: { plan: 'Sueldos' } }), ctx);
  r = Rv.revision(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx);
  assert.equal(r.listo, true, r.pasos.filter((p) => !p.ok).map((p) => p.titulo).join(', '));
  assert.equal(r.cierre.estado, 'ABIERTO');
  assert.deepEqual(r.puede, { enviar: true, revisar: true, editar: true });
});

test('revisión · enviar avisa a quien revisa y devolver avisa a quien lo envió', (t) => {
  const { db, ctx, ctx2, D, D2, cuenta, g } = base(t);
  g({ fecha: '2026-09-02', monto: 1077, nombre: 'ARMANDO LAEL', obs: 'IVA', grupo: 'Z' });
  g({ fecha: '2026-09-03', monto: -1077, nombre: 'ARMANDO LAEL', obs: 'IVA', grupo: 'Z' });
  g({ fecha: '2026-09-10', monto: -500000, nombre: 'SUELDOS', obs: 'ABONO', plan: 'Sueldos' });
  const e = C.enviarRevision(db, D({ periodo: '2026-09', nota: 'listo' }), ctx);
  assert.ok(!e._validationError, e.message);
  const notifs = () => leerFilas_(db, 'NOTIFICACIONES_APP', COLUMNAS.NOTIFICACIONES_APP);
  assert.deepEqual(notifs().map((n) => n.destinatario_email), ['dos@demo.cl'], 'avisa a la otra persona con acceso de cierre, no a quien envió');
  assert.match(notifs()[0].titulo, /listo para revisión/);
  assert.doesNotMatch(notifs()[0].mensaje, /\$/, 'el aviso no lleva montos');
  C.observar(db, D2({ periodo: '2026-09', observacion: 'Falta revisar el grupo Z' }), ctx2);
  assert.deepEqual(notifs().map((n) => n.destinatario_email).sort(), ['dos@demo.cl', 'uno@demo.cl']);
  assert.equal(Rv.revision(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx).cierre.estado, 'OBSERVADO');
});
