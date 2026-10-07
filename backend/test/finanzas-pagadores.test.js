'use strict';

/**
 * Finanzas, Etapa A (2026-10-07): pagadores de terceros, dividir transferencias,
 * el detalle del banco («Mis Movimientos») y el Excel BANCOS. Todo con datos
 * FICTICIOS con el mismo formato de los archivos del BCI y de la planilla.
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

// Cartola del BCI como la entrega lector-xlsx.js.
function cartola(movs, mes, anterior) {
  let saldo = anterior;
  const filas = [];
  const periodo = '01-' + mes + '-2026 al 30-' + mes + '-2026';
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
// «Mis Movimientos»: Fecha Transacción | Fecha Contable | Descripción | Egreso | Ingreso | Saldo
function detalle(movs) {
  return [['Mis Movimientos'], [], ['Fecha Transacción', 'Fecha Contable', 'Descripción', 'Egreso', 'Ingreso', 'Saldo']]
    .concat(movs.map((m) => [m[0], m[0], m[1], m[2] ? '-' + m[2].toLocaleString('es-CL') : '', m[3] ? m[3].toLocaleString('es-CL') : '', '0']));
}
// Hoja AYS - BCI del Excel BANCOS.
function excelBancos(filas) {
  return [['BANCOS 2026'], ['FECHA', 'DETALLE', 'UNITARIO', 'TOTAL', 'SALDO', 'PLAN DE CUENTA', 'OBS', 'DETALLE BANCO']]
    .concat(filas.map((f) => [f[0], f[1], '', f[2].toLocaleString('es-CL'), '', f[3] || '', f[4] || '', f[5] || '']));
}

const AGOSTO = [
  ['03/08/2026', 'TRANSFER DE CONSTRUCTORA', 0, 120000],
  ['04/08/2026', 'TRANSFER DE JUAN PEREZ SO', 0, 300000],
  ['05/08/2026', 'PAGO CUENTAS VIA INTERNET', 120000, 0],
  ['06/08/2026', 'TRANSFER DE ANDES MONTAJE', 0, 500000]
];

function preparar(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigso-finp-'));
  const previo = { a: process.env.SIGSO_FINANZAS_DB_PATH, b: process.env.SIGSO_FINANZAS_LLAVE, c: process.env.SIGSO_FINANZAS_ACCESO, d: process.env.SIGSO_FINANZAS_SOLO_LECTURA };
  process.env.SIGSO_FINANZAS_DB_PATH = path.join(dir, 'finanzas.db');
  process.env.SIGSO_FINANZAS_LLAVE = crypto.randomBytes(32).toString('base64');
  process.env.SIGSO_FINANZAS_ACCESO = 'c-1,c-2';
  process.env.SIGSO_FINANZAS_SOLO_LECTURA = 'c-2';
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
  [['CL-1', 'ANDES MONTAJES INDUSTRIALES SPA', '76.000.001-1'], ['CL-2', 'CONSTRUCTORA NORTE SPA', '76.000.002-2'], ['CL-3', 'CONSTRUCTORA SUR LTDA', '76.000.003-3']]
    .forEach((c) => agregarFila_(db, 'CAT_CLIENTES', { cliente_id: c[0], razon_social: c[1], rut: c[2], activo: true }));
  const sesion = (cuentaId) => {
    const tok = crypto.randomBytes(16).toString('hex');
    B.dbFin().prepare('INSERT INTO FIN_SESIONES (token_hash, cuenta_id, creada_en, ultimo_uso) VALUES (?,?,?,?)')
      .run(crypto.createHash('sha256').update(tok).digest('hex'), cuentaId, Date.now(), Date.now());
    return tok;
  };
  const tok1 = sesion('c-1');
  const ctx = { cuenta_id: 'c-1', email: 'uno@demo.cl' };
  const D = (o) => Object.assign({ boveda_token: tok1 }, o);
  const imp = F.importarCartola(db, D({ filas: cartola(AGOSTO, '08', 1000000), empresa: 'HomePymes', nombre_archivo: 'cartola.xlsx' }), ctx);
  assert.equal(imp.nuevas, 4);
  const movs = () => F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos;
  const por = (glosa) => movs().filter((m) => m.glosa === glosa)[0];
  return { db, ctx, D, sesion, movs, por };
}

test('lee la descripción del banco: quién transfirió, a quién y si fue Previred, SII o Tesorería', () => {
  assert.deepEqual(P.analizarDescripcion_('Transferencia recibida de Juan Pérez Soto'), { pagador: 'Juan Pérez Soto', medio: 'TRANSFERENCIA' });
  assert.equal(P.analizarDescripcion_('Transferencia enviada a Homeconsulting Spa').destinatario, 'Homeconsulting Spa');
  assert.equal(P.analizarDescripcion_('Pago en línea Previred').medio, 'PREVIRED');
  assert.equal(P.analizarDescripcion_('Depósito en efectivo').medio, 'EFECTIVO');
  const d = P.leerDetalle(detalle([['04/08/2026', 'Transferencia recibida de Juan Pérez Soto', 0, 300000]]));
  assert.equal(d.movimientos.length, 1);
  assert.deepEqual([d.movimientos[0].fecha, d.movimientos[0].abono, d.movimientos[0].pagador], ['2026-08-04', 300000, 'Juan Pérez Soto']);
  assert.ok(P.leerDetalle([['hola']]).error);
});

test('detalle del banco: pone el nombre completo, nunca adivina un pagador desconocido y aprende al confirmar', (t) => {
  const { db, ctx, D, por } = preparar(t);
  const r = P.importarDetalle(db, D({ filas: detalle([
    ['04/08/2026', 'Transferencia recibida de Juan Pérez Soto', 0, 300000],
    ['05/08/2026', 'Pago en línea Previred', 120000, 0],
    ['03/08/2026', 'Transferencia recibida de Constructora Norte SpA', 0, 120000],
    ['20/08/2026', 'Transferencia recibida de Alguien Más', 0, 999]
  ]), nombre_archivo: 'MisMovimientos_Cuenta_11112222.xlsx' }), ctx);
  assert.deepEqual([r.emparejados, r.sin_cartola, r.cuenta.ultimos4], [3, 1, '2222']);

  const juan = por('TRANSFER DE JUAN PEREZ SO');
  assert.equal(juan.detalle.pagador, 'Juan Pérez Soto');
  assert.equal(juan.sugerencia.certeza, 'baja', 'un tercero desconocido no se da por seguro');
  assert.equal(juan.sugerencia.cliente_id || '', '');
  // El que transfiere es el propio cliente (el nombre de la cartola era genérico).
  const norte = por('TRANSFER DE CONSTRUCTORA');
  assert.deepEqual([norte.sugerencia.cliente_id, norte.sugerencia.certeza], ['CL-2', 'media']);
  // Previred: concepto Imposiciones y el cliente que mandó exactamente ese monto días antes.
  const prev = por('PAGO CUENTAS VIA INTERNET');
  assert.deepEqual([prev.sugerencia.tipo, prev.sugerencia.cuenta, prev.sugerencia.cliente_id], ['FONDO_PAGADO', 'Imposiciones', 'CL-2']);

  // Confirmar: Juan Pérez pagó por Constructora Sur → la próxima vez se propone.
  const c = F.clasificar(db, D({ items: [{ id: juan.id, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-3' }] }), ctx);
  assert.equal(c.hechos, 1);
  assert.equal(c.reglas, 0, 'con pagador conocido no se aprende una regla por glosa');
  const sug = P.sugerirConPagador_({ abono: 1, detalle: { pagador: 'JUAN PEREZ SOTO' } }, Object.assign(P.contextoPagadores_(), { tipoPorCliente: new Map(), clientes: [] }), {});
  assert.deepEqual([sug.cliente_id, sug.certeza], ['CL-3', 'media']);

  // Nada en claro en el archivo.
  B.dbFin().exec('PRAGMA wal_checkpoint(FULL)');
  const crudo = fs.readFileSync(process.env.SIGSO_FINANZAS_DB_PATH);
  assert.ok(!crudo.includes('Juan P'));
  assert.ok(!crudo.includes('Previred'));
});

test('un pagador que paga por varios clientes: opciones, nunca uno elegido solo', (t) => {
  preparar(t);
  const ctx = () => Object.assign(P.contextoPagadores_(), { tipoPorCliente: new Map(), clientes: [] });
  const m = { abono: 1, detalle: { pagador: 'Kraken Ltda' } };
  assert.equal(P.sugerirConPagador_(m, ctx(), {}).certeza, 'baja');
  P.registrarPagador_('Kraken Ltda', 'CL-1', 'ANDES MONTAJES INDUSTRIALES SPA', 'persona');
  P.registrarPagador_('KRAKEN LTDA', 'CL-2', 'CONSTRUCTORA NORTE SPA', 'persona');
  P.registrarPagador_('Kraken Ltda', 'CL-2', 'CONSTRUCTORA NORTE SPA', 'persona');
  const s = P.sugerirConPagador_(m, ctx(), {});
  assert.equal(s.certeza, 'baja');
  assert.equal(s.cliente_id, undefined);
  assert.deepEqual(s.opciones.map((o) => [o.cliente_id, o.veces]), [['CL-2', 2], ['CL-1', 1]], 'el que más ha pagado primero');
});

test('dividir: las partes deben sumar el total y cada una queda en su cliente', (t) => {
  const { db, ctx, D, por, movs } = preparar(t);
  const andes = por('TRANSFER DE ANDES MONTAJE');
  const mal = F.clasificar(db, D({ items: [{ id: andes.id, partes: [
    { monto: '300.000', tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' },
    { monto: 100000, tipo: 'FONDO_RECIBIDO', cuenta: 'Imposiciones', cliente_id: 'CL-1' }] }] }), ctx);
  assert.equal(mal.hechos, 0);
  assert.match(mal.errores[0].mensaje, /suman \$400\.000/);
  const ok = F.clasificar(db, D({ items: [{ id: andes.id, nota: 'honorario + imposiciones', partes: [
    { monto: '300.000', tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' },
    { monto: 200000, tipo: 'FONDO_RECIBIDO', cuenta: 'Imposiciones', cliente_id: 'CL-1' }] }] }), ctx);
  assert.equal(ok.hechos, 1);
  const m = movs().filter((x) => x.id === andes.id)[0];
  assert.equal(m.clasif.partes.length, 2);
  assert.deepEqual(m.clasif.partes.map((p) => p.monto), [300000, 200000]);
  // Piezas: el resumen y los fondos ven cada parte por su lado.
  const piezas = P.piezas_({ abono: 500000, cargo: 0, clasif: m.clasif });
  assert.equal(piezas.length, 2);
  const fondos = F.resumenBancos(db, D({}), ctx).fondos;
  assert.equal(fondos.filter((f) => f.cliente === 'ANDES MONTAJES INDUSTRIALES SPA')[0].recibido, 200000, 'solo la parte de fondos cuenta como custodia');
});

test('Excel BANCOS: enseñar nombres cortos, sugerir lo que anotaron y aprender quién paga por quién', (t) => {
  const { db, ctx, D, por, sesion } = preparar(t);
  // Primero el detalle: así se sabe quién transfirió.
  P.importarDetalle(db, D({ filas: detalle([['04/08/2026', 'Transferencia recibida de Juan Pérez Soto', 0, 300000]]), nombre_archivo: 'Cuenta_11112222.xlsx' }), ctx);
  const filas = excelBancos([
    ['04/08/2026', 'SUR', 300000, 'INGRESOS', 'ABONO', 'TRANSFER DE JUAN PEREZ SO'],
    ['06/08/2026', 'ANDES', 500000, 'INGRESOS', 'IMPOSICIONES', 'TRANSFER DE ANDES MONTAJE'],
    ['05/08/2026', 'GASTO RARO', -120000, '', '', 'PAGO CUENTAS VIA INTERNET']
  ]);
  const rev = P.revisarExcelBancos(db, D({ filas }), ctx);
  assert.equal(rev.filas, 3);
  const n = (a) => rev.nombres.filter((x) => x.alias === a)[0];
  assert.deepEqual([n('ANDES').propuesta.clase, n('ANDES').propuesta.cliente_id], ['cliente', 'CL-1'], 'un nombre que calza con un solo cliente se propone');
  assert.equal(n('GASTO RARO').propuesta, null);

  // Rogelio (solo lectura) no puede enseñar.
  const tok2 = sesion('c-2');
  assert.ok(P.guardarAlias(db, { boveda_token: tok2, alias: [{ alias: 'SUR', clase: 'cliente', cliente_id: 'CL-3' }] }, { cuenta_id: 'c-2', email: 'dos@demo.cl' })._forbidden ||
    P.guardarAlias(db, { boveda_token: tok2, alias: [] }, { cuenta_id: 'c-2', email: 'dos@demo.cl' }).ok === false);

  const g = P.guardarAlias(db, D({ alias: [{ alias: 'SUR', clase: 'cliente', cliente_id: 'CL-3' }, { alias: 'ANDES', clase: 'cliente', cliente_id: 'CL-1' }, { alias: 'X', clase: 'cliente', cliente_id: 'NO-EXISTE' }] }), ctx);
  assert.equal(g.guardados, 2);
  assert.equal(g.errores.length, 1);
  assert.equal(P.revisarExcelBancos(db, D({ filas }), ctx).nombres.filter((x) => x.alias === 'SUR')[0].actual.cliente_id, 'CL-3', 'queda enseñado para el mes siguiente');

  const cuenta = F.resumenBancos(db, D({}), ctx).cuentas[0].id;
  const a = P.aprenderExcelBancos(db, D({ filas, cuenta }), ctx);
  assert.deepEqual([a.filas, a.emparejadas, a.nombres_sin_ensenar, a.pagadores_aprendidos], [3, 3, 1, 1]);

  const juan = por('TRANSFER DE JUAN PEREZ SO');
  assert.deepEqual([juan.sugerencia.tipo, juan.sugerencia.cuenta, juan.sugerencia.cliente_id, juan.sugerencia.certeza], ['INGRESO', 'Servicio Mensual', 'CL-3', 'media']);
  assert.equal(juan.planilla.alias, 'SUR');
  assert.equal(juan.estado, 'PENDIENTE', 'el Excel sugiere, nunca confirma');
  const andes = por('TRANSFER DE ANDES MONTAJE');
  assert.deepEqual([andes.sugerencia.tipo, andes.sugerencia.cuenta], ['FONDO_RECIBIDO', 'Imposiciones']);
  // Juan Pérez quedó como pagador de Constructora Sur.
  const sug = P.sugerirConPagador_({ abono: 1, detalle: { pagador: 'Juan Pérez Soto' } }, Object.assign(P.contextoPagadores_(), { tipoPorCliente: new Map(), clientes: [] }), {});
  assert.equal(sug.cliente_id, 'CL-3');
});
