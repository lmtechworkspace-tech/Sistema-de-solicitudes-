'use strict';

/**
 * Finanzas, Etapa C (2026-10-07): avisos antes de guardar. Datos FICTICIOS.
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
const P = require('../logica/finanzasPagadores');
const A = require('../logica/finanzasAvisos');

function cartola(movs) {
  let saldo = 1000000;
  const filas = [];
  const periodo = '01-08-2026 al 31-08-2026';
  filas[2] = ['Empresa', null, null, null, 'EMPRESA DEMO SPA'];
  filas[3] = ['N° de cuenta', null, null, null, '11112222', null, null, null, 'Periodo', null, periodo];
  const cargos = movs.reduce((s, m) => s + (m[2] || 0), 0), abonos = movs.reduce((s, m) => s + (m[3] || 0), 0);
  filas[8] = ['Periodo', null, null, null, 'Saldo Anterior', null, 'Total Cargos y Cheques', null, 'Total Abonos y Depósitos', null, 'Saldo Contable Final del Periodo'];
  filas[9] = [periodo, null, null, null, '1.000.000', null, cargos.toLocaleString('es-CL'), null, abonos.toLocaleString('es-CL'), null, (1000000 - cargos + abonos).toLocaleString('es-CL')];
  filas[17] = ['Fecha', null, 'Sucursal', null, null, 'Descripción', null, 'N° Documento', null, 'Cheques y otros cargos', 'Depósitos y Abono', 'Saldo diario'];
  movs.forEach((m, i) => {
    saldo = saldo - (m[2] || 0) + (m[3] || 0);
    filas[18 + i] = [m[0], null, 'OF CENTRA', null, null, m[1], null, String(100 + i), null, m[2] ? m[2].toLocaleString('es-CL') : null, m[3] ? m[3].toLocaleString('es-CL') : null, saldo.toLocaleString('es-CL')];
  });
  return filas;
}
function detalle(movs) {
  return [['Fecha Transacción', 'Fecha Contable', 'Descripción', 'Egreso', 'Ingreso', 'Saldo']]
    .concat(movs.map((m) => [m[0], m[0], m[1], m[2] ? '-' + m[2].toLocaleString('es-CL') : '', m[3] ? m[3].toLocaleString('es-CL') : '', '0']));
}
const AGOSTO = [
  ['03/08/2026', 'TRANSFER DE CONSTRUCTORA', 0, 120000],
  ['04/08/2026', 'TRANSFER DE JUAN PEREZ SO', 0, 300000],
  ['05/08/2026', 'PAGO CUENTAS VIA INTERNET', 120000, 0],
  ['06/08/2026', 'TRANSFER DE ANDES MONTAJE', 0, 500000],
  ['20/08/2026', 'TRANSFER DE ANDES MONTAJE', 0, 500000]
];

function preparar(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigso-finav-'));
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
  [['CL-1', 'ANDES MONTAJES INDUSTRIALES SPA'], ['CL-2', 'CONSTRUCTORA NORTE SPA'], ['CL-3', 'CONSTRUCTORA SUR LTDA']]
    .forEach((c) => agregarFila_(db, 'CAT_CLIENTES', { cliente_id: c[0], razon_social: c[1], rut: '', activo: true }));
  const tok = crypto.randomBytes(16).toString('hex');
  B.dbFin().prepare('INSERT INTO FIN_SESIONES (token_hash, cuenta_id, creada_en, ultimo_uso) VALUES (?,?,?,?)')
    .run(crypto.createHash('sha256').update(tok).digest('hex'), 'c-1', Date.now(), Date.now());
  const ctx = { cuenta_id: 'c-1', email: 'uno@demo.cl' };
  const D = (o) => Object.assign({ boveda_token: tok }, o);
  F.importarCartola(db, D({ filas: cartola(AGOSTO), empresa: 'HomePymes' }), ctx);
  P.importarDetalle(db, D({ filas: detalle([['04/08/2026', 'Transferencia recibida de Juan Pérez Soto', 0, 300000], ['05/08/2026', 'Pago en línea Previred', 120000, 0]]), nombre_archivo: 'Cuenta_11112222.xlsx' }), ctx);
  const movs = () => F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos;
  const id = (glosa, i) => movs().filter((m) => m.glosa === glosa)[i || 0].id;
  const revisar = (items) => A.revisarAntes(db, D({ items }), ctx);
  const textos = (r, i) => r.items[i || 0].avisos.map((a) => a.nivel + ': ' + a.texto);
  return { db, ctx, D, movs, id, revisar, textos };
}

test('pagador que nunca ha pagado por ese cliente: alerta; desconocido: solo info', (t) => {
  const { revisar, id, textos } = preparar(t);
  const juan = id('TRANSFER DE JUAN PEREZ SO');
  let r = revisar([{ id: juan, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-2' }]);
  assert.equal(r.alertas, 0);
  assert.match(textos(r).join('|'), /^info: Es la primera vez que aparece Juan Pérez Soto/);
  P.registrarPagador_('Juan Pérez Soto', 'CL-3', 'CONSTRUCTORA SUR LTDA', 'persona');
  r = revisar([{ id: juan, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-2' }]);
  assert.equal(r.alertas, 1);
  assert.match(textos(r)[0], /ha pagado antes por CONSTRUCTORA SUR LTDA \(1\), nunca por CONSTRUCTORA NORTE SPA/);
  assert.equal(revisar([{ id: juan, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-3' }]).alertas, 0);
});

test('Previred marcado como otra cosa, y custodia que queda en negativo', (t) => {
  const { db, ctx, D, revisar, id, textos } = preparar(t);
  const prev = id('PAGO CUENTAS VIA INTERNET');
  let r = revisar([{ id: prev, tipo: 'EGRESO', cuenta: 'Otros Egresos' }]);
  assert.match(textos(r).join('|'), /alerta: El banco dice que fue un pago a Previred/);
  assert.equal(revisar([{ id: prev, tipo: 'EGRESO', cuenta: 'Imposiciones' }]).alertas, 0, 'imposiciones propias de la empresa: bien');
  r = revisar([{ id: prev, tipo: 'FONDO_PAGADO', cuenta: 'Imposiciones', cliente_id: 'CL-2' }]);
  assert.equal(r.alertas, 0, 'sin ningún registro previo solo informa (puede ser saldo inicial)');
  assert.match(textos(r).join('|'), /^info: No hay registro de plata de CONSTRUCTORA NORTE SPA en custodia/);
  // Con algo registrado pero no alcanza: alerta.
  F.clasificar(db, D({ items: [{ id: id('TRANSFER DE CONSTRUCTORA'), partes: [
    { monto: 20000, tipo: 'FONDO_RECIBIDO', cuenta: 'Imposiciones', cliente_id: 'CL-2' }, { monto: 100000, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-2' }] }] }), ctx);
  r = revisar([{ id: prev, tipo: 'FONDO_PAGADO', cuenta: 'Imposiciones', cliente_id: 'CL-2' }]);
  assert.match(textos(r).join('|'), /alerta: CONSTRUCTORA NORTE SPA tiene \$20\.000 en custodia; con este pago queda en −\$100\.000/);
  // Cuando se registra lo que mandó el cliente, ya no avisa.
  F.clasificar(db, D({ items: [{ id: id('TRANSFER DE CONSTRUCTORA'), tipo: 'FONDO_RECIBIDO', cuenta: 'Imposiciones', cliente_id: 'CL-2' }] }), ctx);
  assert.equal(revisar([{ id: prev, tipo: 'FONDO_PAGADO', cuenta: 'Imposiciones', cliente_id: 'CL-2' }]).alertas, 0);
  // En un lote, lo que el cliente manda en el mismo lote cuenta para su pago.
  P.registrarPagador_('Juan Pérez Soto', 'CL-3', 'CONSTRUCTORA SUR LTDA', 'persona');
  const juan = id('TRANSFER DE JUAN PEREZ SO');
  assert.match(textos(revisar([{ id: prev, tipo: 'FONDO_PAGADO', cuenta: 'Imposiciones', cliente_id: 'CL-3' }])).join('|'), /No hay registro de plata de CONSTRUCTORA SUR/);
  const lote = revisar([{ id: juan, tipo: 'FONDO_RECIBIDO', cuenta: 'Imposiciones', cliente_id: 'CL-3' }, { id: prev, tipo: 'FONDO_PAGADO', cuenta: 'Imposiciones', cliente_id: 'CL-3' }]);
  assert.equal(lote.alertas, 0);
  assert.ok(!textos(lote, 1).join('|').includes('custodia'), 'en el lote ya se ve lo que mandó');
});

test('pago doble del mismo cliente en el mes, e ingreso sin cliente', (t) => {
  const { db, ctx, D, revisar, id, textos, movs } = preparar(t);
  const a1 = id('TRANSFER DE ANDES MONTAJE', 0), a2 = id('TRANSFER DE ANDES MONTAJE', 1);
  F.clasificar(db, D({ items: [{ id: a1, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' }] }), ctx);
  const r = revisar([{ id: a2, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' }]);
  assert.match(textos(r).join('|'), /ya tiene un pago de \$500\.000 \(Servicio Mensual\) el 06-08 de este mes/);
  // En lote: los dos a la vez también se detectan.
  const r2 = revisar([{ id: a1, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' }, { id: a2, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' }]);
  assert.equal(r2.alertas, 1);
  assert.match(textos(revisar([{ id: a2, tipo: 'INGRESO', cuenta: 'Otros Ingresos' }])).join('|'), /Ingreso sin cliente/);
  // Revisar no guarda nada.
  assert.equal(movs().filter((m) => m.id === a2)[0].estado, 'PENDIENTE');
});

test('lo anotado en el Excel BANCOS distinto de lo que se marca', (t) => {
  const { db, ctx, D, revisar, id, textos } = preparar(t);
  P.guardarAlias(db, D({ alias: [{ alias: 'ANDES', clase: 'cliente', cliente_id: 'CL-1' }] }), ctx);
  const cuenta = F.resumenBancos(db, D({}), ctx).cuentas[0].id;
  P.aprenderExcelBancos(db, D({ cuenta, filas: [['FECHA', 'DETALLE', 'TOTAL', 'PLAN DE CUENTA', 'OBS', 'DETALLE BANCO'], ['06/08/2026', 'ANDES', '500.000', 'INGRESOS', 'IMPOSICIONES', 'TRANSFER DE ANDES MONTAJE']] }), ctx);
  const r = revisar([{ id: id('TRANSFER DE ANDES MONTAJE', 0), tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' }]);
  assert.match(textos(r).join('|'), /En el Excel BANCOS lo anotaron como «Fondo de cliente recibido · Imposiciones» \(ANDES · IMPOSICIONES\)/);
});
