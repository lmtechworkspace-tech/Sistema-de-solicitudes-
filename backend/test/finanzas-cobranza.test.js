'use strict';

/**
 * Finanzas, Etapa 3 (2026-10-06): facturas y cobranza. Datos FICTICIOS.
 * Lo central: los pagos del banco cubren las facturas del cliente de la más
 * antigua a la más nueva, lo que sobra es saldo a favor (los "abonos" de la
 * planilla SIGECO), y la plata que el cliente manda para sus imposiciones NO
 * paga facturas.
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
const C = require('../logica/finanzasCobranza');

const ENC_V = 'Nro;Tipo Doc;Tipo Venta;Rut cliente;Razon Social;Folio;Fecha Docto;Fecha Recepcion;Fecha Acuse Recibo;Fecha Reclamo;Monto Exento;Monto Neto;Monto IVA;Monto total';
const VENTAS = [ENC_V,
  '1;33;Del Giro;76000001-1;ANDES MONTAJES SPA;501;01/07/2026;;;;0;100000;19000;119000',
  '2;33;Del Giro;76000001-1;ANDES MONTAJES SPA;502;01/08/2026;;;;0;100000;19000;119000',
  '3;33;Del Giro;76000002-2;NORTE OBRAS SPA;503;10/08/2026;;;;0;200000;38000;238000',
  '4;33;Del Giro;99999999-9;EMPRESA FUERA DE SIGSO;504;10/08/2026;;;;0;50000;9500;59500',
  '5;61;Del Giro;76000002-2;NORTE OBRAS SPA;30;15/08/2026;;;;0;50000;9500;59500'].join('\n');
const NOMBRE = 'RCV_VENTA_77000000-0_202608.csv';

// Cartola mínima con el formato del BCI (ver finanzas-bancos.test.js).
function cartola(movs, anterior) {
  let saldo = anterior || 0;
  const filas = [];
  filas[2] = ['Empresa', null, null, null, 'EMPRESA DEMO SPA'];
  filas[3] = ['N° de cuenta', null, null, null, '11112222', null, null, null, 'Periodo', null, '01-08-2026 al 31-08-2026'];
  const cargos = movs.reduce((s, m) => s + (m[2] || 0), 0), abonos = movs.reduce((s, m) => s + (m[3] || 0), 0);
  filas[8] = ['Periodo', null, null, null, 'Saldo Anterior', null, 'Total Cargos y Cheques', null, 'Total Abonos y Depósitos', null, 'Saldo Contable Final del Periodo'];
  filas[9] = ['x', null, null, null, String(anterior || 0), null, String(cargos), null, String(abonos), null, String((anterior || 0) - cargos + abonos)];
  filas[17] = ['Fecha', null, 'Sucursal', null, null, 'Descripción', null, 'N° Documento', null, 'Cheques y otros cargos', 'Depósitos y Abono', 'Saldo diario'];
  movs.forEach((m, i) => { saldo = saldo - (m[2] || 0) + (m[3] || 0); filas[18 + i] = [m[0], null, 'OF', null, null, m[1], null, String(i + 1), null, m[2] ? String(m[2]) : null, m[3] ? String(m[3]) : null, String(saldo)]; });
  return filas;
}

function preparar(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigso-finc-'));
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
  [['CL-1', 'ANDES MONTAJES SPA', '76.000.001-1'], ['CL-2', 'NORTE OBRAS SPA', '76000002-2']]
    .forEach((c) => agregarFila_(db, 'CAT_CLIENTES', { cliente_id: c[0], razon_social: c[1], rut: c[2], activo: true }));
  const tok = crypto.randomBytes(16).toString('hex');
  B.dbFin().prepare('INSERT INTO FIN_SESIONES (token_hash, cuenta_id, creada_en, ultimo_uso) VALUES (?,?,?,?)')
    .run(crypto.createHash('sha256').update(tok).digest('hex'), 'c-1', Date.now(), Date.now());
  const ctx = { cuenta_id: 'c-1', email: 'uno@demo.cl' };
  const D = (o) => Object.assign({ boveda_token: tok }, o);
  return { db, ctx, D };
}
function confirmar(db, D, ctx, glosa, clasif) {
  const m = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos.find((x) => x.glosa === glosa);
  const r = F.clasificar(db, D({ items: [Object.assign({ id: m.id }, clasif)] }), ctx);
  assert.equal(r.hechos, 1, JSON.stringify(r.errores));
}

test('Registro de Ventas del SII: reconoce clientes por RUT (con o sin puntos), recuerda la empresa del emisor y no duplica', (t) => {
  const { db, ctx, D } = preparar(t);
  const rev = C.revisarVentas(db, D({ texto: VENTAS, nombre: NOMBRE }), ctx);
  assert.deepEqual([rev.documentos, rev.facturas, rev.notas_credito, rev.nuevas, rev.sin_cliente], [5, 4, 1, 5, 1]);
  assert.deepEqual(rev.ejemplos_sin_cliente, ['EMPRESA FUERA DE SIGSO (99999999-9)']);
  assert.equal(rev.total, 119000 * 2 + 238000 + 59500 - 59500);
  assert.ok(C.revisarVentas(db, D({ texto: 'hola;mundo', nombre: 'x.csv' }), ctx)._validationError);
  const imp = C.importarVentas(db, D({ texto: VENTAS, nombre: NOMBRE, empresa: 'HomePymes' }), ctx);
  assert.deepEqual([imp.nuevas, imp.repetidas], [5, 0]);
  const otra = C.importarVentas(db, D({ texto: VENTAS, nombre: NOMBRE }), ctx);
  assert.deepEqual([otra.empresa, otra.nuevas, otra.repetidas], ['HomePymes', 0, 5], 'el RUT del emisor ya se sabe de qué empresa es');
  B.dbFin().exec('PRAGMA wal_checkpoint(FULL)');
  assert.ok(!fs.readFileSync(process.env.SIGSO_FINANZAS_DB_PATH).includes('ANDES MONTAJES'), 'cifrado');
});

test('cartera: los pagos cubren de la factura más antigua a la más nueva, lo que sobra es saldo a favor y las notas de crédito restan', (t) => {
  const { db, ctx, D } = preparar(t);
  C.importarVentas(db, D({ texto: VENTAS, nombre: NOMBRE, empresa: 'HomePymes' }), ctx);
  F.importarCartola(db, D({ empresa: 'HomePymes', filas: cartola([
    ['05/08/2026', 'TRANSFER DE ANDES MONTAJE', 0, 150000],
    ['06/08/2026', 'TRANSFER DE NORTE OBRAS', 0, 500000],
    ['07/08/2026', 'TRANSFER DE NORTE OBRAS', 0, 300000]
  ], 1000000) }), ctx);
  const movs = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos;
  F.clasificar(db, D({ items: [
    { id: movs[0].id, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' },
    { id: movs[1].id, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-2' },
    // Plata para sus imposiciones: es del cliente, no paga facturas.
    { id: movs[2].id, tipo: 'FONDO_RECIBIDO', cuenta: 'Imposiciones', cliente_id: 'CL-2' }
  ] }), ctx);
  const cb = C.cobranza(db, D({}), ctx);
  const andes = cb.clientes.find((c) => c.cliente_id === 'CL-1');
  const norte = cb.clientes.find((c) => c.cliente_id === 'CL-2');
  assert.deepEqual([andes.por_cobrar, andes.saldo_a_favor, andes.facturas_abiertas], [119000 * 2 - 150000, 0, 1]);
  // Norte: factura 238.000 - NC 59.500 = 178.500; pagó 500.000 → 321.500 a favor.
  assert.deepEqual([norte.por_cobrar, norte.saldo_a_favor], [0, 500000 + 59500 - 238000]);
  const fuera = cb.clientes.find((c) => !c.en_sigso);
  assert.deepEqual([fuera.cliente, fuera.por_cobrar], ['EMPRESA FUERA DE SIGSO', 59500]);
  const ficha = C.fichaCliente(db, D({ clave: 'CL-1' }), ctx);
  assert.deepEqual(ficha.facturas.map((f) => [f.folio, f.situacion, f.saldo]), [['502', 'Pago parcial', 88000], ['501', 'Pagada', 0]]);
  assert.equal(ficha.pagos.length, 1);
  assert.equal(cb.totales.por_cobrar, 88000 + 59500);
});

test('días de atraso y tramos desde el vencimiento (30 días); anular e incobrable salen de la cartera', (t) => {
  const { db, ctx, D } = preparar(t);
  C.importarVentas(db, D({ texto: VENTAS, nombre: NOMBRE, empresa: 'HomePymes' }), ctx);
  const m = C.cartera_(db, { hoy: '2026-10-06' });
  const f501 = m.get('CL-1').facturas.find((f) => f.folio === '501');
  assert.deepEqual([f501.vence, f501.dias, f501.situacion], ['2026-07-31', 67, 'Vencida']);
  assert.equal(m.get('CL-1').tramos.d61_90, 119000);
  const id = C.fichaCliente(db, D({ clave: 'CL-1' }), ctx).facturas.find((f) => f.folio === '501').id;
  assert.ok(C.cambiarEstadoFactura(db, D({ id, estado: 'ANULADA' }), ctx)._validationError, 'exige motivo');
  C.cambiarEstadoFactura(db, D({ id, estado: 'ANULADA', nota: 'emitida por error' }), ctx);
  assert.equal(C.cartera_(db).get('CL-1').facturas.length, 1);
  C.cambiarEstadoFactura(db, D({ id, estado: 'INCOBRABLE', nota: 'cliente quebró' }), ctx);
  const n = C.cartera_(db).get('CL-1');
  assert.deepEqual([n.incobrable, n.por_cobrar], [119000, 119000], 'la incobrable no suma a por cobrar');
});

test('planilla SIGECO: trae la hoja FACTURAS (cliente por nombre) y el SII la reemplaza si después llega el mismo folio', (t) => {
  const { db, ctx, D } = preparar(t);
  const serial = (iso) => String((Date.parse(iso) - Date.UTC(1899, 11, 30)) / 864e5);
  const filas = [
    ['N° FACTURA', 'FECHA EMISIÓN', 'ID CLIENTE', 'CLIENTE', 'EMPRESA EMISORA', 'CONCEPTO', 'NETO', 'IVA (19%)', 'TOTAL', 'FECHA VENCIMIENTO', 'ESTADO', 'OBSERVACIONES'],
    ['501.0', serial('2026-07-01'), 'C001', 'Andes Montajes SpA', 'HomePymes Antiguo', 'Servicio julio', '100000', '19000', '119000', '', 'Vencida', ''],
    ['900.0', serial('2026-07-02'), 'C009', 'Otro que no existe', 'HomePymes', 'x', '1', '0', '1', '', 'Anulada', '']
  ];
  const r = C.importarFacturasPlanilla(db, D({ filas }), ctx);
  assert.deepEqual([r.nuevas, r.sin_cliente], [1, 0], 'la anulada no se trae');
  assert.equal(C.cartera_(db).get('CL-1').facturas[0].origen, 'planilla');
  const imp = C.importarVentas(db, D({ texto: VENTAS, nombre: NOMBRE, empresa: 'HomePymes' }), ctx);
  assert.deepEqual([imp.nuevas, imp.actualizadas], [4, 1]);
  assert.equal(C.cartera_(db).get('CL-1').facturas.find((f) => f.folio === '501').origen, 'rcv');
});

test('Bancos sugiere el cliente cuando un ingreso sin nombre calza exacto con lo que falta de una factura', (t) => {
  const { db, ctx, D } = preparar(t);
  C.importarVentas(db, D({ texto: VENTAS, nombre: NOMBRE, empresa: 'HomePymes' }), ctx);
  F.importarCartola(db, D({ empresa: 'HomePymes', filas: cartola([['09/08/2026', 'ABONO POR TRF DESDE OTRO BANCO EN LINEA', 0, 178500] /* 238.000 - nota de crédito 59.500 */], 0) }), ctx);
  const s = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos[0].sugerencia;
  assert.deepEqual([s.tipo, s.cliente_id, s.certeza], ['INGRESO', 'CL-2', 'media']);
  assert.match(s.motivo, /factura N° 503/);
  void confirmar;
});
