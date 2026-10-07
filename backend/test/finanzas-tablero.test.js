'use strict';

/**
 * Finanzas, Etapa 4 (2026-10-06): tablero de gerencia e informe mensual.
 * Datos FICTICIOS. Lo central: el resultado no mezcla la plata de los
 * clientes, la caja sale del último saldo de cada cuenta, las cifras se
 * marcan provisorias si falta revisar, y el PDF lleva marca de agua y queda
 * en la bitácora.
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
const ReportePdf = require('../logica/reportePdf');

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigso-fint-'));
  const previo = { a: process.env.SIGSO_FINANZAS_DB_PATH, b: process.env.SIGSO_FINANZAS_LLAVE, c: process.env.SIGSO_FINANZAS_ACCESO };
  process.env.SIGSO_FINANZAS_DB_PATH = path.join(dir, 'finanzas.db');
  process.env.SIGSO_FINANZAS_LLAVE = crypto.randomBytes(32).toString('base64');
  process.env.SIGSO_FINANZAS_ACCESO = 'c-1';
  B.reiniciarParaPruebas_();
  t.after(() => {
    B.reiniciarParaPruebas_();
    const r = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
    r('SIGSO_FINANZAS_DB_PATH', previo.a); r('SIGSO_FINANZAS_LLAVE', previo.b); r('SIGSO_FINANZAS_ACCESO', previo.c);
  });
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'c-1', usuario: 'uno', nombre: 'Persona Uno', emails: '["uno@demo.cl"]', rol: 'DEV', modulos: '[]', activo: true });
  agregarFila_(db, 'CAT_CLIENTES', { cliente_id: 'CL-1', razon_social: 'ANDES MONTAJES SPA', rut: '76000001-1', activo: true });
  const tok = crypto.randomBytes(16).toString('hex');
  B.dbFin().prepare('INSERT INTO FIN_SESIONES (token_hash, cuenta_id, creada_en, ultimo_uso) VALUES (?,?,?,?)')
    .run(crypto.createHash('sha256').update(tok).digest('hex'), 'c-1', Date.now(), Date.now());
  const ctx = { cuenta_id: 'c-1', email: 'uno@demo.cl' };
  const D = (o) => Object.assign({ boveda_token: tok }, o);
  // HomePymes: julio y agosto. Homeconsulting: agosto.
  F.importarCartola(db, D({ empresa: 'HomePymes', filas: cartola('1111', [
    ['05/07/2026', 'TRANSFER DE ANDES MONTAJE', 0, 1000000], ['06/07/2026', 'PAGO CUENTAS VIA INTERNET', 900000, 0],
    ['07/07/2026', 'PAGO REMUNERACIONES', 300000, 0], ['08/07/2026', 'HONORARIOS X', 0, 500000],
    ['05/08/2026', 'HONORARIOS X', 0, 700000], ['09/08/2026', 'PAGO REMUNERACIONES', 300000, 0], ['10/08/2026', 'PREVIRED PROPIO', 100000, 0],
    ['20/08/2026', 'PAGO F29', 50000, 0], ['25/08/2026', 'SIN REVISAR', 0, 20000]
  ], 2000000) }), ctx);
  F.importarCartola(db, D({ empresa: 'Homeconsulting', filas: cartola('2222', [['03/08/2026', 'HONORARIOS Y', 0, 400000], ['04/08/2026', 'ARRIENDO', 100000, 0]], 50000) }), ctx);
  const todos = F.movimientos(db, D({ periodo: '2026-07' }), ctx).movimientos.concat(F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos);
  const id = (g, f) => todos.find((m) => m.glosa === g && m.fecha === f).id;
  const r = F.clasificar(db, D({ items: [
    { id: id('TRANSFER DE ANDES MONTAJE', '2026-07-05'), tipo: 'FONDO_RECIBIDO', cuenta: 'Imposiciones', cliente_id: 'CL-1' },
    { id: id('PAGO CUENTAS VIA INTERNET', '2026-07-06'), tipo: 'FONDO_PAGADO', cuenta: 'Imposiciones', cliente_id: 'CL-1' },
    { id: id('PAGO REMUNERACIONES', '2026-07-07'), tipo: 'EGRESO', cuenta: 'Sueldos' },
    { id: id('HONORARIOS X', '2026-07-08'), tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' },
    { id: id('HONORARIOS X', '2026-08-05'), tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' },
    { id: id('PAGO REMUNERACIONES', '2026-08-09'), tipo: 'EGRESO', cuenta: 'Sueldos' },
    { id: id('PREVIRED PROPIO', '2026-08-10'), tipo: 'EGRESO', cuenta: 'Imposiciones' },
    { id: id('PAGO F29', '2026-08-20'), tipo: 'EGRESO', cuenta: 'IVA' },
    { id: id('HONORARIOS Y', '2026-08-03'), tipo: 'INGRESO', cuenta: 'Servicio Mensual' },
    { id: id('ARRIENDO', '2026-08-04'), tipo: 'EGRESO', cuenta: 'Arriendo Mensual' }
  ] }), ctx);
  assert.equal(r.hechos, 10, JSON.stringify(r.errores));
  return { db, ctx, D };
}

test('el resultado no mezcla la plata de los clientes; caja, custodia y obligaciones del mes', (t) => {
  const { db, ctx, D } = preparar(t);
  const jul = T.tablero(db, D({ periodo: '2026-07', empresa: 'HomePymes' }), ctx);
  assert.deepEqual([jul.mes.ingresos, jul.mes.egresos, jul.mes.resultado], [500000, 300000, 200000], 'el fondo de 1.000.000 y su pago de 900.000 no cuentan');
  assert.deepEqual([jul.mes.fondos_recibidos, jul.mes.fondos_pagados, jul.custodia], [1000000, 900000, 100000]);
  assert.equal(jul.caja, 2000000 + 1000000 - 900000 - 300000 + 500000);
  assert.equal(jul.calidad.completo, true);
  const ago = T.tablero(db, D({ periodo: '2026-08', empresa: 'HomePymes' }), ctx);
  assert.deepEqual([ago.mes.ingresos, ago.mes.egresos, ago.mes.resultado], [700000, 450000, 250000]);
  assert.deepEqual(ago.gastos.map((g) => g.cuenta), ['Sueldos', 'Imposiciones', 'IVA']);
  assert.deepEqual(ago.obligaciones.map((o) => [o.fecha, o.estimado]), [['2026-09-09', 300000], ['2026-09-10', 100000], ['2026-09-20', 50000]]);
  assert.equal(ago.calidad.pendientes, 1, 'SIN REVISAR');
  assert.match(ago.lectura[0].texto, /provisorias/);
  assert.match(ago.lectura.map((l) => l.texto).join(' '), /resultado de agosto 2026 fue \$250\.000, \$50\.000 mejor que julio 2026/);
  assert.deepEqual(ago.serie.map((s) => s.periodo), ['2026-07', '2026-08']);
});

test('grupo: suma las empresas y compara cada una en la misma escala', (t) => {
  const { db, ctx, D } = preparar(t);
  const g = T.tablero(db, D({ periodo: '2026-08' }), ctx);
  assert.equal(g.empresa, '');
  assert.deepEqual(g.empresas.sort(), ['HomePymes', 'Homeconsulting']);
  assert.deepEqual([g.mes.ingresos, g.mes.egresos], [700000 + 400000, 450000 + 100000]);
  assert.equal(g.cuentas.length, 2);
  const hc = g.por_empresa.find((e) => e.empresa === 'Homeconsulting');
  assert.deepEqual(hc.serie.map((s) => s.resultado), [0, 300000]);
});

test('informe PDF: pasa por la bóveda, lleva marca de agua con el nombre y queda en la bitácora', async (t) => {
  const { db, ctx, D } = preparar(t);
  let recibido = null;
  t.mock.method(ReportePdf, 'generarPdfReporte', async (d, data) => { recibido = data; return { pdf_base64: 'eA==', filename: 'x.pdf' }; });
  const r = await T.informePdf(db, D({ html: '<div>informe</div>', css: '.a{}', titulo: 'Informe financiero agosto 2026 · Grupo' }), ctx);
  assert.equal(r.filename, 'x.pdf');
  assert.match(recibido.html, /CONFIDENCIAL · Persona Uno · \d{2}-\d{2}-\d{4}/);
  assert.match(recibido.css, /\.fin2-agua/);
  const bit = B.dbFin().prepare("SELECT detalle FROM FIN_BITACORA WHERE accion = 'DESCARGAR_INFORME'").get();
  assert.equal(bit.detalle, 'Informe financiero agosto 2026 · Grupo');
  assert.equal(T.informePdf(db, { html: 'x' }, ctx).boveda_cerrada, true, 'sin bóveda abierta no hay informe');
  assert.equal(T.informePdf(db, D({ html: 'x' }), { cuenta_id: 'otra', email: 'z@z.cl' })._noEncontrado, true);
});
