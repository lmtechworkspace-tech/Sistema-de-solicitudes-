'use strict';

/**
 * Finanzas, Etapa B (2026-10-07): «El mes, paso a paso». Los pasos se calculan
 * solos desde lo guardado (cartolas, detalle, revisión, cierre) y traen su fecha.
 * Datos FICTICIOS.
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
const M = require('../logica/finanzasMes');
const C = require('../logica/finanzasCierre');

function cartola(movs, desde, hasta, anterior) {
  let saldo = anterior;
  const filas = [];
  const periodo = desde + ' al ' + hasta;
  filas[2] = ['Empresa', null, null, null, 'EMPRESA DEMO SPA'];
  filas[3] = ['N° de cuenta', null, null, null, '11112222', null, null, null, 'Periodo', null, periodo];
  const cargos = movs.reduce((s, m) => s + (m[2] || 0), 0), abonos = movs.reduce((s, m) => s + (m[3] || 0), 0);
  filas[8] = ['Periodo', null, null, null, 'Saldo Anterior', null, 'Total Cargos y Cheques', null, 'Total Abonos y Depósitos', null, 'Saldo Contable Final del Periodo'];
  filas[9] = [periodo, null, null, null, anterior.toLocaleString('es-CL'), null, cargos.toLocaleString('es-CL'), null, abonos.toLocaleString('es-CL'), null, (anterior - cargos + abonos).toLocaleString('es-CL')];
  filas[17] = ['Fecha', null, 'Sucursal', null, null, 'Descripción', null, 'N° Documento', null, 'Cheques y otros cargos', 'Depósitos y Abono', 'Saldo diario'];
  movs.forEach((m, i) => {
    saldo = saldo - (m[2] || 0) + (m[3] || 0);
    filas[18 + i] = [m[0], null, 'OF CENTRA', null, null, m[1], null, String(100 + i), null, m[2] ? m[2].toLocaleString('es-CL') : null, m[3] ? m[3].toLocaleString('es-CL') : null, saldo.toLocaleString('es-CL')];
  });
  return filas;
}

function preparar(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigso-finmes-'));
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
  agregarFila_(db, 'CAT_CLIENTES', { cliente_id: 'CL-1', razon_social: 'ANDES MONTAJES INDUSTRIALES SPA', rut: '76.000.001-1', activo: true });
  const tok = crypto.randomBytes(16).toString('hex');
  B.dbFin().prepare('INSERT INTO FIN_SESIONES (token_hash, cuenta_id, creada_en, ultimo_uso) VALUES (?,?,?,?)')
    .run(crypto.createHash('sha256').update(tok).digest('hex'), 'c-1', Date.now(), Date.now());
  const ctx = { cuenta_id: 'c-1', email: 'uno@demo.cl' };
  const D = (o) => Object.assign({ boveda_token: tok }, o);
  return { db, ctx, D };
}

const paso = (r, id) => r.pasos.filter((p) => p.id === id)[0];

test('sin nada cargado: toca subir las cartolas, con su fecha', (t) => {
  const { db, ctx, D } = preparar(t);
  const r = M.elMes(db, D({ periodo: '2026-08' }), ctx);
  assert.equal(r.periodo, '2026-08');
  assert.equal(r.siguiente, 'cartolas');
  assert.equal(paso(r, 'cartolas').estado, 'ahora');
  assert.equal(paso(r, 'cartolas').plazo.fecha, '2026-09-03');
  assert.equal(paso(r, 'revisar').plazo.fecha, '2026-09-05');
  assert.equal(paso(r, 'excel').opcional, true);
  assert.ok(r.fechas.length > 0 && r.fechas.every((f, i, l) => i === 0 || l[i - 1].fecha <= f.fecha), 'fechas que vienen, en orden');
});

test('con la cartola completa: toca el detalle; revisado todo: toca cerrar; cerrado: listo', (t) => {
  const { db, ctx, D } = preparar(t);
  const movs = [['01/08/2026', 'TRANSFER DE ANDES MONTAJE', 0, 500000], ['20/08/2026', 'COMISION UNICA POR PLAN (CUOTA 1)', 6075, 0]];
  F.importarCartola(db, D({ filas: cartola(movs, '01-08-2026', '31-08-2026', 1000000), empresa: 'HomePymes' }), ctx);
  let r = M.elMes(db, D({ periodo: '2026-08' }), ctx);
  assert.equal(paso(r, 'cartolas').estado, 'hecho');
  assert.equal(r.siguiente, 'detalle');
  assert.deepEqual(paso(r, 'revisar').avance, { n: 0, total: 2 });
  assert.match(paso(r, 'revisar').detalle, /por revisar/);

  const ids = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos;
  F.clasificar(db, D({ items: ids.map((m) => (m.abono ? { id: m.id, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' } : { id: m.id, tipo: 'EGRESO', cuenta: 'Comisión Banco' })) }), ctx);
  r = M.elMes(db, D({ periodo: '2026-08' }), ctx);
  assert.equal(paso(r, 'revisar').estado, 'hecho');
  assert.equal(r.listo_para_cerrar, true);
  assert.equal(paso(r, 'detalle').estado, 'ahora', 'el detalle sigue recomendado aunque se pueda cerrar');

  const cierre = C.cerrar(db, D({ periodo: '2026-08' }), ctx);
  assert.ok(!cierre._validationError, JSON.stringify(cierre));
  r = M.elMes(db, D({ periodo: '2026-08' }), ctx);
  assert.equal(r.cerrado, true);
  assert.equal(paso(r, 'cerrar').estado, 'hecho');
});

test('el mes de trabajo es el último abierto con datos hasta el mes pasado', (t) => {
  const { db, ctx, D } = preparar(t);
  F.importarCartola(db, D({ filas: cartola([['05/07/2026', 'TRANSFER DE ANDES MONTAJE', 0, 1000]], '01-07-2026', '31-07-2026', 1000), empresa: 'HomePymes' }), ctx);
  assert.equal(M.mesDeTrabajo_('2026-10-07'), '2026-07');
  assert.equal(M.mesDeTrabajo_('2026-07-15'), '2026-06', 'un mes en curso no es todavía de trabajo');
  // Un movimiento suelto de junio (borde de la cartola) no le quita el lugar a julio, pero se avisa.
  F.importarCartola(db, D({ filas: cartola([['30/06/2026', 'TRANSFER DE ANDES MONTAJE', 0, 2000]], '30-06-2026', '30-06-2026', 5000), empresa: 'HomePymes' }), ctx);
  const r = M.elMes(db, D({}), ctx);
  assert.equal(r.periodo, M.mesDeTrabajo_(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())));
  assert.equal(M.mesDeTrabajo_('2026-10-07'), '2026-07');
  assert.deepEqual(M.elMes(db, D({ periodo: '2026-07' }), ctx).meses_atras.map((x) => [x.periodo, x.pendientes]), [['2026-06', 1]]);
});
