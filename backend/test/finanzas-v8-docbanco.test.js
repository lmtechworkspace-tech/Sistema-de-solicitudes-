'use strict';

/**
 * Finanzas v5.6 · paso 2 de la reunión: el historial de pagos de cuentas y las transferencias recibidas del BCI
 * completan la cartola. Cada fila se une con su movimiento y la planilla sugiere de quién es, con su respaldo.
 * Datos FICTICIOS (el formato real se calibra con un archivo del banco).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparar, cartola } = require('./_finanzasPrueba');
const F = require('../logica/finanzasBancos');
const H = require('../logica/finanzasHoja');
const Doc = require('../logica/finanzasDocBanco');
const C = require('../logica/finanzasCobranza');
const B = require('../logica/finanzasBoveda');

const PAGOS = [['Historial de Pagos de Cuentas'], [], ['Fecha de Pago', 'Empresa', 'Identificador', 'Monto', 'Estado'],
  ['04/09/2026', 'PREVIRED', '77.123.456-1', '$2.106.400', 'Pagado'],
  ['08/09/2026', 'SERVICIO DE IMPUESTOS INTERNOS', '76.543.210-3', '318.000', 'Pagado'],
  ['09/09/2026', 'PREVIRED', '12.345.678-5', '50.000', 'Pagado'],
  ['10/09/2026', 'PREVIRED', '77.123.456-1', '99.000', 'Rechazado']];
const TRANSF = [['Transferencias Recibidas'], ['Fecha', 'Nombre Origen', 'Rut Origen', 'Banco Origen', 'Monto'],
  ['02/09/2026', 'ANDES MONTAJES INDUSTRIALES SPA', '76.086.428-5', 'Banco de Chile', '357.000'],
  ['11/09/2026', 'LOGISTICA SUR SPA', '76.999.888-7', 'Santander', '1.500.000']];

function base(t) {
  const p = preparar(t);
  const { db, ctx, D } = p;
  F.importarCartola(db, D({ empresa: 'HomePymes', filas: cartola([
    ['02/09/2026', 'TRANSFER DE ANDES MONTAJ', 0, 357000, '1'], ['04/09/2026', 'PAGO CUENTAS VIA INTERNET', 2106400, 0, '2'],
    ['08/09/2026', 'PAGO CUENTAS VIA INTERNET', 318000, 0, '3'], ['09/09/2026', 'PAGO CUENTAS VIA INTERNET', 50000, 0, '4'],
    ['14/09/2026', 'TRANSFER DE LOGISTICA SU', 0, 1500000, '5']], { periodo: '01-09-2026 al 30-09-2026', anterior: 3000000 }) }), ctx);
  const cuenta = B.dbFin().prepare('SELECT id FROM FIN_CUENTAS').get().id;
  const hoja = () => H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx);
  return Object.assign(p, { cuenta, hoja });
}

test('documentos del banco · se reconocen por sus títulos; lo rechazado no cuenta; un archivo ajeno se explica', () => {
  const p = Doc.leer_(PAGOS);
  assert.equal(p.tipo, 'PAGOS_CUENTAS');
  assert.equal(p.filas.length, 3, 'el pago rechazado no se movió');
  assert.deepEqual([p.filas[0].monto, p.filas[0].rut, p.filas[0].obligacion.obs], [2106400, '77123456-1', 'IMPOSICIONES']);
  assert.equal(Doc.servicio_('SERVICIO DE IMPUESTOS INTERNOS').obs, 'IVA');
  const tr = Doc.leer_(TRANSF);
  assert.equal(tr.tipo, 'TRANSFERENCIAS');
  assert.deepEqual([tr.filas[1].nombre, tr.filas[1].rut, tr.filas[1].monto], ['LOGISTICA SUR SPA', '76999888-7', 1500000]);
  assert.match(Doc.leer_([['Fecha', 'Algo'], ['01/09/2026', 'x']]).error, /No reconozco/);
});

test('pagos de cuentas · cada «pago cuentas vía internet» queda con su cliente y su OBS (fondos del cliente), con su respaldo', (t) => {
  const { db, ctx, D, cuenta, hoja } = base(t);
  const rev = Doc.importar(db, D({ filas: PAGOS, nombre_archivo: 'pagos.xlsx', revisar: true }), ctx);
  assert.deepEqual([rev.tipo, rev.emparejados, rev.con_cliente], ['PAGOS_CUENTAS', 3, 2]);
  assert.equal(hoja().filas.filter((f) => f.sug_doc).length, 0, 'revisar no guarda');
  Doc.importar(db, D({ filas: PAGOS, nombre_archivo: 'pagos.xlsx' }), ctx);
  const h = hoja();
  const pr = h.filas.find((f) => f.monto === -2106400), sii = h.filas.find((f) => f.monto === -318000), otro = h.filas.find((f) => f.monto === -50000);
  assert.deepEqual([pr.sug_doc.nombre, pr.sug_doc.obs, pr.sug_doc.plan, pr.sug_doc.certeza], ['CONSTRUCTORA NORTE', 'IMPOSICIONES', 'Imposiciones', 'alta']);
  assert.match(pr.sug_doc.motivo, /imposiciones de CONSTRUCTORA NORTE SPA/);
  assert.deepEqual([sii.sug_doc.obs, sii.sug_doc.nombre], ['IVA', 'PANADERIA SOL DE MAYO']);
  assert.equal(otro.sug_doc.certeza, 'baja', 'RUT que no está en el maestro: se dice, no se inventa el cliente');
  const r = Doc.aceptar(db, D({ ids: [pr.id, sii.id, otro.id], cuenta_ref: cuenta, periodo: '2026-09' }), ctx);
  assert.equal(r.anotadas, 2, 'la de certeza baja no tiene nombre que poner');
  const h2 = hoja(), pr2 = h2.filas.find((f) => f.monto === -2106400);
  assert.deepEqual([pr2.nombre, pr2.obs, pr2.banco, pr2.que.k], ['CONSTRUCTORA NORTE', 'IMPOSICIONES', 'ok', 'fon'], 'no es ingreso ni gasto: dinero del cliente');
});

test('transferencias · con el RUT el cliente es seguro; quien no es cliente se propone por la factura que calza y se recuerda', (t) => {
  const { db, ctx, D, cuenta, hoja } = base(t);
  C.importarVentas(db, D({ texto: ['Nro;Tipo Doc;Tipo Venta;Rut cliente;Razon Social;Folio;Fecha Docto;Fecha Recepcion;Fecha Acuse Recibo;Fecha Reclamo;Monto Exento;Monto Neto;Monto IVA;Monto total',
    '1;33;Del Giro;76543210-3;PANADERIA SOL DE MAYO SPA;9016;01/09/2026;;;;0;1260504;239496;1500000'].join('\n'), nombre: 'RCV_VENTA_77000000-0_202609.csv', empresa: 'HomePymes' }), ctx);
  const imp = Doc.importar(db, D({ filas: TRANSF, nombre_archivo: 'transferencias.xlsx' }), ctx);
  assert.deepEqual([imp.emparejados, imp.con_cliente], [2, 1], 'la de Logística Sur se une aunque el banco la contabilizó 1 día hábil después');
  let h = hoja();
  const andes = h.filas.find((f) => f.monto === 357000), log = h.filas.find((f) => f.monto === 1500000);
  assert.deepEqual([andes.sug_doc.nombre, andes.sug_doc.certeza, andes.sug_doc.cliente_id], ['ANDES MONTAJES INDUSTRIALES', 'alta', 'CL-1']);
  assert.deepEqual([log.sug_doc.nombre, log.sug_doc.fact, log.sug_doc.certeza], ['PANADERIA SOL DE MAYO', '9016', 'media']);
  assert.match(log.sug_doc.motivo, /LOGISTICA SUR SPA.*no es cliente.*factura 9016/);
  Doc.aceptar(db, D({ ids: [log.id], cuenta_ref: cuenta, periodo: '2026-09' }), ctx);
  h = hoja();
  assert.deepEqual([h.filas.find((f) => f.monto === 1500000).fact, H.cobranza(db, D({ estado: 'todas' }), ctx).facturas.find((f) => f.folio === '9016').estado], ['9016', 'Pagada']);
  // El mes siguiente, el mismo RUT vuelve a pagar: SIGSO ya sabe por quién paga.
  F.importarCartola(db, D({ filas: cartola([['05/10/2026', 'TRANSFER DE LOGISTICA SU', 0, 420000, '9']], { periodo: '01-10-2026 al 31-10-2026', anterior: 4602600 }) }), ctx);
  Doc.importar(db, D({ filas: [['Fecha', 'Nombre Origen', 'Rut Origen', 'Monto'], ['05/10/2026', 'LOGISTICA SUR SPA', '76.999.888-7', '420.000']], nombre_archivo: 't-oct.xlsx' }), ctx);
  const oct = H.hoja(db, D({ periodo: '2026-10', cuenta_ref: cuenta }), ctx).filas.find((f) => f.monto === 420000);
  assert.deepEqual([oct.sug_doc.nombre, oct.sug_doc.certeza], ['PANADERIA SOL DE MAYO', 'alta']);
  assert.match(oct.sug_doc.motivo, /ya pagó antes por/);
});
