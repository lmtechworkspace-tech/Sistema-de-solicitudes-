'use strict';

/**
 * Finanzas, Etapa 5 (2026-10-06): presupuesto, gastos compartidos, deudas
 * entre empresas y meses de caja. Datos FICTICIOS.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const B = require('../logica/finanzasBoveda');
const F = require('../logica/finanzasBancos');
const T = require('../logica/finanzasTablero');
const P = require('../logica/finanzasPresupuesto');

function cartola(numero, movs, anterior) {
  let saldo = anterior;
  const filas = [];
  filas[2] = ['Empresa', null, null, null, 'EMPRESA DEMO SPA'];
  filas[3] = ['N° de cuenta', null, null, null, numero, null, null, null, 'Periodo', null, 'x'];
  const c = movs.reduce((s, m) => s + (m[2] || 0), 0), a = movs.reduce((s, m) => s + (m[3] || 0), 0);
  filas[8] = ['Periodo', null, null, null, 'Saldo Anterior', null, 'Total Cargos y Cheques', null, 'Total Abonos y Depósitos', null, 'Saldo Contable Final del Periodo'];
  filas[9] = ['x', null, null, null, String(anterior), null, String(c), null, String(a), null, String(anterior - c + a)];
  filas[17] = ['Fecha', null, 'Sucursal', null, null, 'Descripción', null, 'N° Documento', null, 'Cheques y otros cargos', 'Depósitos y Abono', 'Saldo diario'];
  movs.forEach((m, i) => { saldo = saldo - (m[2] || 0) + (m[3] || 0); filas[18 + i] = [m[0], null, 'OF', null, null, m[1], null, String(i + 1), null, m[2] ? String(m[2]) : null, m[3] ? String(m[3]) : null, String(saldo)]; });
  return filas;
}

function preparar(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigso-finp-'));
  const previo = { a: process.env.SIGSO_FINANZAS_DB_PATH, b: process.env.SIGSO_FINANZAS_LLAVE, c: process.env.SIGSO_FINANZAS_ACCESO, d: process.env.SIGSO_FINANZAS_SOLO_LECTURA };
  process.env.SIGSO_FINANZAS_DB_PATH = path.join(dir, 'finanzas.db');
  process.env.SIGSO_FINANZAS_LLAVE = crypto.randomBytes(32).toString('base64');
  process.env.SIGSO_FINANZAS_ACCESO = 'c-1,c-2';
  delete process.env.SIGSO_FINANZAS_SOLO_LECTURA;
  B.reiniciarParaPruebas_();
  t.after(() => {
    B.reiniciarParaPruebas_();
    const r = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
    r('SIGSO_FINANZAS_DB_PATH', previo.a); r('SIGSO_FINANZAS_LLAVE', previo.b); r('SIGSO_FINANZAS_ACCESO', previo.c); r('SIGSO_FINANZAS_SOLO_LECTURA', previo.d);
  });
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'c-1', usuario: 'uno', nombre: 'Persona Uno', emails: '["uno@demo.cl"]', rol: 'DEV', modulos: '[]', activo: true });
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'c-2', usuario: 'dos', nombre: 'Persona Dos', emails: '["dos@demo.cl"]', rol: 'GERENCIA', modulos: '[]', activo: true });
  const sesion = (id) => {
    const tok = crypto.randomBytes(16).toString('hex');
    B.dbFin().prepare('INSERT INTO FIN_SESIONES (token_hash, cuenta_id, creada_en, ultimo_uso) VALUES (?,?,?,?)').run(crypto.createHash('sha256').update(tok).digest('hex'), id, Date.now(), Date.now());
    return tok;
  };
  const tok = sesion('c-1');
  const ctx = { cuenta_id: 'c-1', email: 'uno@demo.cl' };
  const D = (o) => Object.assign({ boveda_token: tok }, o);
  // Virtual Base paga el arriendo (400.000) y lo reparte entre 4; HomePymes le presta 100.000 a HomePrevise.
  F.importarCartola(db, D({ empresa: 'Virtual Base', filas: cartola('3333', [['05/08/2026', 'ARRIENDO OFICINA', 400000, 0]], 1000000) }), ctx);
  F.importarCartola(db, D({ empresa: 'HomePymes', filas: cartola('1111', [
    ['02/08/2026', 'HONORARIOS', 0, 900000], ['09/08/2026', 'SUELDOS', 500000, 0], ['12/08/2026', 'TRANSFER A HOMEPREVISE', 100000, 0]
  ], 2000000) }), ctx);
  const movs = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos;
  const id = (g) => movs.find((m) => m.glosa === g).id;
  const r = F.clasificar(db, D({ items: [
    { id: id('ARRIENDO OFICINA'), tipo: 'EGRESO', cuenta: 'Arriendo Mensual', reparto: ['GDE', 'HomePymes', 'HomePrevise', 'RLD'] },
    { id: id('HONORARIOS'), tipo: 'INGRESO', cuenta: 'Servicio Mensual' },
    { id: id('SUELDOS'), tipo: 'EGRESO', cuenta: 'Sueldos' },
    { id: id('TRANSFER A HOMEPREVISE'), tipo: 'PRESTAMO', empresa: 'HomePrevise' }
  ] }), ctx);
  assert.equal(r.hechos, 4, JSON.stringify(r.errores));
  return { db, ctx, D, sesion };
}

test('gasto compartido: cada empresa carga su parte, el grupo lo cuenta una sola vez, y quien no pagó le debe a quien pagó', (t) => {
  const { db, ctx, D } = preparar(t);
  const hp = T.tablero(db, D({ periodo: '2026-08', empresa: 'HomePymes' }), ctx);
  assert.deepEqual([hp.mes.ingresos, hp.mes.egresos], [900000, 500000 + 100000], 'sueldos + 1/4 del arriendo');
  assert.ok(hp.gastos.some((g) => g.cuenta === 'Arriendo Mensual (compartido)' && g.monto === 100000));
  const vb = T.tablero(db, D({ periodo: '2026-08', empresa: 'Virtual Base' }), ctx);
  assert.equal(vb.mes.egresos, 0, 'Virtual Base pagó pero no está en el reparto');
  const grupo = T.tablero(db, D({ periodo: '2026-08' }), ctx);
  assert.equal(grupo.mes.egresos, 900000, 'el arriendo cuenta una vez en el grupo');
  const deudas = grupo.entre_empresas.map((d) => [d.debe, d.a, d.monto]).sort();
  assert.deepEqual(deudas, [['GDE', 'Virtual Base', 100000], ['HomePrevise', 'HomePymes', 100000], ['HomePrevise', 'Virtual Base', 100000], ['HomePymes', 'Virtual Base', 100000], ['RLD', 'Virtual Base', 100000]].sort());
  assert.ok(hp.entre_empresas.every((d) => d.debe === 'HomePymes' || d.a === 'HomePymes'));
  assert.match(grupo.lectura.map((l) => l.texto).join(' '), /le debe/);
});

test('el reparto solo vale para gastos y con 2 o más empresas', (t) => {
  const { db, ctx, D } = preparar(t);
  const hon = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos.find((m) => m.glosa === 'HONORARIOS');
  F.clasificar(db, D({ items: [{ id: hon.id, tipo: 'INGRESO', cuenta: 'Servicio Mensual', reparto: ['GDE', 'RLD'] }] }), ctx);
  const sueldos = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos.find((m) => m.glosa === 'SUELDOS');
  F.clasificar(db, D({ items: [{ id: sueldos.id, tipo: 'EGRESO', cuenta: 'Sueldos', reparto: ['GDE', 'Inventada'] }] }), ctx);
  const mv = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos;
  assert.equal(mv.find((m) => m.glosa === 'HONORARIOS').clasif.reparto, undefined);
  assert.equal(mv.find((m) => m.glosa === 'SUELDOS').clasif.reparto, undefined);
});

test('presupuesto: se guarda por empresa, el grupo suma, y se compara con lo real del mes y del año', (t) => {
  const { db, ctx, D } = preparar(t);
  const meses = (v) => Array.from({ length: 12 }, () => v);
  assert.ok(P.guardar(db, D({ anio: 2026, empresa: '', lineas: [] }), ctx)._validationError, 'el presupuesto es por empresa');
  assert.ok(P.guardar(db, D({ anio: 2026, empresa: 'HomePymes', lineas: [{ tipo: 'EGRESO', cuenta: 'Inventada', meses: meses(1) }] }), ctx)._validationError);
  const g = P.guardar(db, D({ anio: 2026, empresa: 'HomePymes', lineas: [
    { tipo: 'INGRESO', cuenta: 'Servicio Mensual', meses: meses('1.000.000') },
    { tipo: 'EGRESO', cuenta: 'Sueldos', meses: meses(450000) },
    { tipo: 'EGRESO', cuenta: 'Arriendo Mensual', meses: meses(0) }
  ] }), ctx);
  assert.deepEqual([g.cuentas, g.ingresos_anio, g.egresos_anio], [2, 12000000, 5400000], 'texto con puntos se entiende; las líneas en cero no se guardan');
  P.guardar(db, D({ anio: 2026, empresa: 'GDE', lineas: [{ tipo: 'INGRESO', cuenta: 'Servicio Mensual', meses: meses(200000) }] }), ctx);
  const v = P.ver(db, D({ anio: 2026, empresa: 'HomePymes' }), ctx);
  const sm = v.filas.find((f) => f.tipo === 'INGRESO' && f.cuenta === 'Servicio Mensual');
  assert.deepEqual([sm.ppto[7], sm.real[7]], [1000000, 900000]);
  const arr = v.filas.find((f) => f.tipo === 'EGRESO' && f.cuenta === 'Arriendo Mensual');
  assert.equal(arr.real[7], 100000, 'la parte del arriendo compartido');
  assert.equal(P.ver(db, D({ anio: 2026 }), ctx).filas.find((f) => f.cuenta === 'Servicio Mensual').ppto[0], 1200000, 'grupo = suma');
  // El tablero lo usa en la serie y en la lectura.
  const tb = T.tablero(db, D({ periodo: '2026-08', empresa: 'HomePymes' }), ctx);
  assert.deepEqual([tb.serie[0].ppto_ingresos, tb.serie[0].ppto_egresos], [1000000, 450000]);
  assert.match(tb.lectura.map((l) => l.texto).join(' '), /90 % de lo presupuestado/);
  assert.match(tb.lectura.map((l) => l.texto).join(' '), /superaron el presupuesto: 133 %/);
});

test('meses de caja: caja libre (sin la plata de clientes) / gasto promedio de la empresa', (t) => {
  const { db, ctx, D } = preparar(t);
  const tb = T.tablero(db, D({ periodo: '2026-08', empresa: 'HomePymes' }), ctx);
  // Caja HomePymes al cierre: 2.000.000 + 900.000 - 500.000 - 100.000 = 2.300.000; gasto del mes 600.000.
  assert.deepEqual([tb.caja, tb.caja_libre, tb.gasto_promedio, tb.meses_caja], [2300000, 2300000, 600000, 3.8]);
  assert.match(tb.lectura.map((l) => l.texto).join(' '), /cubre 3,8 meses/);
});

test('solo lectura no puede guardar el presupuesto, pero sí verlo', (t) => {
  const { db, sesion } = preparar(t);
  process.env.SIGSO_FINANZAS_SOLO_LECTURA = 'c-2';
  const tok2 = sesion('c-2');
  const ctx2 = { cuenta_id: 'c-2', email: 'dos@demo.cl' };
  assert.ok(P.guardar(db, { boveda_token: tok2, anio: 2026, empresa: 'GDE', lineas: [] }, ctx2)._forbidden);
  assert.equal(P.ver(db, { boveda_token: tok2, anio: 2026 }, ctx2).anio, 2026);
});
