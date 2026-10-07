'use strict';

/**
 * Finanzas, Etapa 2 (2026-10-06): cartolas del banco. Cartola FICTICIA con el
 * mismo formato del Excel del BCI (encabezado, resumen y movimientos desde la
 * fila 18). Se prueba la lectura, el cuadre de saldos, que no se duplique al
 * subirla otra vez, las sugerencias, el aprendizaje y que nada quede en claro.
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

// Arma las filas como las entrega lector-xlsx.js (celdas de texto, con huecos).
function cartola(movs, opciones) {
  opciones = opciones || {};
  const anterior = opciones.anterior != null ? opciones.anterior : 1000000;
  let saldo = anterior;
  const filas = [];
  filas[1] = [' Cartola de cuenta corriente'];
  filas[2] = ['Empresa', null, null, null, 'EMPRESA DEMO SPA', null, null, null, 'Ejecutivo', null, 'X'];
  filas[3] = ['N° de cuenta', null, null, null, opciones.numero || '11112222', null, null, null, 'Periodo', null, '01-08-2026 al 31-08-2026'];
  const lineas = movs.map((m) => {
    saldo = saldo - (m[2] || 0) + (m[3] || 0);
    return [m[0], null, 'OF CENTRA', null, null, m[1], null, m[4] || '100', null, m[2] ? m[2].toLocaleString('es-CL') : null, m[3] ? m[3].toLocaleString('es-CL') : null, (opciones.romperSaldo ? saldo + 1 : saldo).toLocaleString('es-CL')];
  });
  const cargos = movs.reduce((s, m) => s + (m[2] || 0), 0), abonos = movs.reduce((s, m) => s + (m[3] || 0), 0);
  filas[8] = ['Periodo', null, null, null, 'Saldo Anterior', null, 'Total Cargos y Cheques', null, 'Total Abonos y Depósitos', null, 'Saldo Contable Final del Periodo'];
  filas[9] = ['01-08-2026 al 31-08-2026', null, null, null, anterior.toLocaleString('es-CL'), null, cargos.toLocaleString('es-CL'), null, abonos.toLocaleString('es-CL'), null, (anterior - cargos + abonos).toLocaleString('es-CL')];
  filas[17] = ['Fecha', null, 'Sucursal', null, null, 'Descripción', null, 'N° Documento', null, 'Cheques y otros cargos', 'Depósitos y Abono', 'Saldo diario'];
  lineas.forEach((l, i) => { filas[18 + i] = l; });
  return filas;
}
const MOVS = [
  ['01/08/2026', 'TRANSFER DE ANDES MONTAJE', 0, 500000, '9001'],
  ['02/08/2026', 'PAGO CUENTAS VIA INTERNET', 480000, 0, '801'],
  ['03/08/2026', 'TRANSFER DE CONSTRUCTORA', 0, 120000, '9002'],
  ['05/08/2026', 'COMISION UNICA POR PLAN (CUOTA 1)', 6075, 0, '1'],
  ['06/08/2026', 'TRANSFER DE HOMEPYMES ASE', 0, 300000, '9003'],
  ['07/08/2026', 'TRANSFER DE HOMECONSULTING', 0, 200000, '9004'],
  ['08/08/2026', 'DEPOSITO EN EFECTIVO POR CAJA', 0, 45000, '2']
];

function preparar(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigso-finb-'));
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
  return { db, ctx, D, sesion };
}

test('lee la cartola del BCI: encabezado, montos con punto de miles y saldos que cuadran', () => {
  const c = F.leerCartola(cartola(MOVS));
  assert.equal(c.error, undefined);
  assert.equal(c.numero, '11112222');
  assert.equal(c.titular, 'EMPRESA DEMO SPA');
  assert.deepEqual([c.desde, c.hasta], ['2026-08-01', '2026-08-31']);
  assert.equal(c.movimientos.length, 7);
  assert.deepEqual(c.movimientos[1], { fila: 20, fecha: '2026-08-02', glosa: 'PAGO CUENTAS VIA INTERNET', doc: '801', cargo: 480000, abono: 0, saldo: 1020000 });
  assert.equal(c.cuadra, true);
  assert.equal(F.monto_('1.234.567'), 1234567);
  assert.equal(F.monto_(''), 0);
});

test('detecta una cartola alterada o incompleta y un formato desconocido', () => {
  const rota = F.leerCartola(cartola(MOVS, { romperSaldo: true }));
  assert.equal(rota.cuadra, false);
  assert.match(rota.errores[0], /saldo no sigue/);
  const incompleta = cartola(MOVS); incompleta.splice(20, 1);
  assert.equal(F.leerCartola(incompleta).cuadra, false);
  assert.ok(F.leerCartola([['hola']]).error);
});

test('sugerencias: comisión, traspaso propio, préstamo con otra empresa, cliente por nombre y glosas sin pista', (t) => {
  const { db } = preparar(t);
  const ctx = { reglas: new Map(), tipoPorCliente: new Map(), clientes: [
    { id: 'CL-1', nombre: 'ANDES MONTAJES INDUSTRIALES SPA', n: 'ANDES MONTAJES INDUSTRIALES SPA' },
    { id: 'CL-2', nombre: 'CONSTRUCTORA NORTE SPA', n: 'CONSTRUCTORA NORTE SPA' }], empresa: 'HomePymes' };
  const s = (glosa, cargo, abono) => F.sugerir_({ glosa, cargo, abono }, ctx);
  assert.deepEqual([s('COMISION UNICA POR PLAN (CUOTA 1)', 6075, 0).tipo, s('COMISION UNICA POR PLAN (CUOTA 1)', 6075, 0).certeza], ['EGRESO', 'alta']);
  assert.equal(s('TRANSFER DE HOMEPYMES ASE', 0, 1).tipo, 'TRASPASO');
  assert.deepEqual([s('TRANSFER DE HOMECONSULTING', 0, 1).tipo, s('TRANSFER DE HOMECONSULTING', 0, 1).empresa], ['PRESTAMO', 'Homeconsulting']);
  const andes = s('TRANSFER DE ANDES MONTAJE', 0, 500000);
  assert.deepEqual([andes.cliente_id, andes.certeza], ['CL-1', 'media']);
  assert.equal(s('TRANSFER DE CONSTRUCTORA', 0, 1).cliente_id, '', 'nombre genérico: no adivina');
  assert.equal(s('PAGO CUENTAS VIA INTERNET', 1, 0).certeza, 'baja');
  assert.ok(F.esGenerica_('PAGO CUENTAS VIA INTERNET'));
  assert.ok(!F.esGenerica_('TRANSFER DE ANDES MONTAJE'));
  void db;
});

test('importar: pide la empresa de una cuenta nueva, guarda cifrado y no duplica al subirla otra vez', (t) => {
  const { db, ctx, D } = preparar(t);
  const filas = cartola(MOVS);
  const rev = F.revisarCartola(db, D({ filas }), ctx);
  assert.equal(rev.cuadra, true);
  assert.equal(rev.nuevas, 7);
  assert.equal(rev.cuenta_conocida, null);
  assert.equal(rev.ultimos4, '2222');
  assert.ok(F.importarCartola(db, D({ filas }), ctx)._validationError, 'sin empresa no importa');
  const imp = F.importarCartola(db, D({ filas, empresa: 'HomePymes', nombre_archivo: 'cartola.xlsx' }), ctx);
  assert.equal(imp.nuevas, 7);
  const otra = F.importarCartola(db, D({ filas }), ctx);
  assert.deepEqual([otra.nuevas, otra.repetidas], [0, 7], 'la cuenta ya se conoce y nada se repite');
  // Nada en claro en el archivo.
  B.dbFin().exec('PRAGMA wal_checkpoint(FULL)');
  const crudo = fs.readFileSync(process.env.SIGSO_FINANZAS_DB_PATH);
  assert.ok(!crudo.includes('ANDES MONTAJE'));
  assert.ok(!crudo.includes('11112222'));
  assert.ok(!crudo.includes('EMPRESA DEMO'));
  // Una cartola que no cuadra no se importa.
  assert.ok(F.importarCartola(db, D({ filas: cartola(MOVS, { romperSaldo: true, numero: '99990000' }), empresa: 'HomePymes' }), ctx)._validationError);
});

test('clasificar: valida el sentido y el cliente, aprende la glosa y la vuelve a sugerir el mes siguiente', (t) => {
  const { db, ctx, D } = preparar(t);
  F.importarCartola(db, D({ filas: cartola(MOVS), empresa: 'HomePymes' }), ctx);
  const mv = F.movimientos(db, D({ periodo: '2026-08' }), ctx);
  const por = (g) => mv.movimientos.find((m) => m.glosa === g);
  const andes = por('TRANSFER DE ANDES MONTAJE'), pago = por('PAGO CUENTAS VIA INTERNET');
  const malo = F.clasificar(db, D({ items: [{ id: andes.id, tipo: 'EGRESO', cuenta: 'Sueldos' }] }), ctx);
  assert.equal(malo.hechos, 0);
  assert.match(malo.errores[0].mensaje, /no puede ser plata que entra/);
  assert.match(F.clasificar(db, D({ items: [{ id: andes.id, tipo: 'FONDO_RECIBIDO', cuenta: 'Imposiciones' }] }), ctx).errores[0].mensaje, /cliente/);
  const ok = F.clasificar(db, D({ items: [
    { id: andes.id, tipo: 'FONDO_RECIBIDO', cuenta: 'Imposiciones', cliente_id: 'CL-1', nota: 'imposiciones de agosto' },
    { id: pago.id, tipo: 'FONDO_PAGADO', cuenta: 'Imposiciones', cliente_id: 'CL-1' }
  ] }), ctx);
  assert.deepEqual([ok.hechos, ok.reglas], [2, 1], 'PAGO CUENTAS es genérica: no se vuelve regla');
  // La cuenta corriente del cliente: recibió 500.000, se pagaron 480.000 por él.
  const rb = F.resumenBancos(db, D({}), ctx);
  assert.deepEqual(rb.fondos.map((f) => [f.cliente_id, f.recibido, f.pagado, f.saldo]), [['CL-1', 500000, 480000, 20000]]);
  // Mes siguiente, misma glosa: sale sola con certeza alta y se confirma en lote.
  const sep = MOVS.slice(0, 1).map((m) => ['03/09/2026', m[1], 0, 610000, '9100']);
  F.importarCartola(db, D({ filas: cartola(sep, { anterior: 1384925 }) }), ctx);
  const sug = F.movimientos(db, D({ periodo: '2026-09' }), ctx).movimientos[0].sugerencia;
  assert.deepEqual([sug.tipo, sug.cliente_id, sug.certeza], ['FONDO_RECIBIDO', 'CL-1', 'alta']);
  const lote = F.confirmarSugeridas(db, D({ periodo: '2026-09' }), ctx);
  void lote;
  assert.equal(lote.hechos, 1);
  assert.equal(F.movimientos(db, D({ periodo: '2026-09' }), ctx).resumen.FONDO_RECIBIDO, 610000);
});

test('aprender de la planilla SIGECO: empareja por monto y fecha y deja sugerencias, sin confirmar nada', (t) => {
  const { db, ctx, D } = preparar(t);
  F.importarCartola(db, D({ filas: cartola(MOVS), empresa: 'HomePymes' }), ctx);
  const serial = (iso) => String((Date.parse(iso) - Date.UTC(1899, 11, 30)) / 864e5);
  const planilla = [
    ['FECHA', 'BANCO', 'EMPRESA', 'TIPO', 'CLIENTE / GLOSA', 'DETALLE', 'INGRESO', 'EGRESO', 'SALDO', 'ORIGEN', 'OBSERVACIONES'],
    [serial('2026-08-02'), 'BCI', 'HomePymes Antiguo', 'Ingreso', 'CONSTRUCTORA NORTE SPA', 'pago junio', '120000', '', '', 'Manual', ''],
    [serial('2026-08-02'), 'BCI', 'HomePymes', 'Egreso', 'ANDES MONTAJES INDUSTRIALES SPA', 'IVA JULIO', '', '480000', '', 'Manual', '']
  ];
  const r = F.aprenderPlanilla(db, D({ filas: planilla }), ctx);
  // Las dos glosas son genéricas («CONSTRUCTORA», «PAGO CUENTAS»): sugerencia sí, regla no.
  assert.deepEqual([r.emparejados, r.con_cliente, r.reglas], [2, 2, 0]);
  const mv = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos;
  const cons = mv.find((m) => m.glosa === 'TRANSFER DE CONSTRUCTORA').sugerencia;
  assert.deepEqual([cons.cliente_id, cons.tipo, cons.certeza], ['CL-2', 'FONDO_RECIBIDO', 'media']);
  const pago = mv.find((m) => m.glosa === 'PAGO CUENTAS VIA INTERNET').sugerencia;
  assert.deepEqual([pago.cliente_id, pago.tipo, pago.cuenta, pago.nota], ['CL-1', 'FONDO_PAGADO', 'IVA', 'IVA JULIO']);
  assert.ok(mv.every((m) => m.estado === 'PENDIENTE'), 'nada se confirma solo');
});

test('solo lectura (Rogelio): ve los movimientos pero no importa ni clasifica; y todo pasa por la bóveda', (t) => {
  const { db, ctx, D, sesion } = preparar(t);
  F.importarCartola(db, D({ filas: cartola(MOVS), empresa: 'HomePymes' }), ctx);
  process.env.SIGSO_FINANZAS_SOLO_LECTURA = 'c-2';
  const ctx2 = { cuenta_id: 'c-2', email: 'dos@demo.cl' };
  const tok2 = sesion('c-2');
  assert.equal(F.movimientos(db, { boveda_token: tok2, periodo: '2026-08' }, ctx2).movimientos.length, 7);
  assert.ok(F.importarCartola(db, { boveda_token: tok2, filas: cartola(MOVS) }, ctx2)._forbidden);
  assert.ok(F.clasificar(db, { boveda_token: tok2, items: [{ id: 'x' }] }, ctx2)._forbidden);
  // Sin bóveda abierta, nada; y fuera de la lista, "no existe".
  assert.equal(F.movimientos(db, { periodo: '2026-08' }, ctx).boveda_cerrada, true);
  assert.equal(F.movimientos(db, D({}), { cuenta_id: 'otra', email: 'x@y.cl' })._noEncontrado, true);
  assert.equal(B.verificarCadena_().ok, true);
});

test('una glosa cortada que calza con varios clientes se aprende, pero nunca como «segura»', (t) => {
  const { db, ctx, D } = preparar(t);
  agregarFila_(db, 'CAT_CLIENTES', { cliente_id: 'CL-4', razon_social: 'ANDES MONTAJES DEL SUR SPA', rut: '76.000.004-4', activo: true });
  F.importarCartola(db, D({ filas: cartola(MOVS), empresa: 'HomePymes' }), ctx);
  const andes = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos.find((m) => m.glosa === 'TRANSFER DE ANDES MONTAJE');
  assert.equal(andes.sugerencia.cliente_id, '', 'dos clientes empiezan igual: no adivina');
  F.clasificar(db, D({ items: [{ id: andes.id, tipo: 'FONDO_RECIBIDO', cuenta: 'Imposiciones', cliente_id: 'CL-1' }] }), ctx);
  F.importarCartola(db, D({ filas: cartola([['03/09/2026', 'TRANSFER DE ANDES MONTAJE', 0, 610000, '9100']], { anterior: 1384925 }) }), ctx);
  const sug = F.movimientos(db, D({ periodo: '2026-09' }), ctx).movimientos[0].sugerencia;
  assert.deepEqual([sug.cliente_id, sug.certeza], ['CL-1', 'media']);
  assert.match(sug.motivo, /varios clientes/);
  assert.equal(F.confirmarSugeridas(db, D({ periodo: '2026-09' }), ctx).hechos, 0, '«Confirmar las seguras» no la toca');
});
