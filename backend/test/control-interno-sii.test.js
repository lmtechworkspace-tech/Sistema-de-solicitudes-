'use strict';

/**
 * "Enviar a SIGSO" desde el SII (2026-10-01): F29 → Informe y pago de IVA,
 * RCV ventas → Facturación (folio por folio), RCV compras → Acuse de recibo.
 * Se revisa antes de aplicar y se aplica solo lo marcado, siempre con los
 * valores que el servidor vuelve a leer.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const CI = require('../logica/controlInterno');
const S = require('../logica/controlInternoSII');

const ADM = { email: 'admin@homepymes.cl', rol: 'ADM', modulos: [] };
const conModulo = (email) => ({ email, rol: 'DEV', modulos: ['control_interno'] });
const FRANCISCA = conModulo('francisca@homepymes.cl');
const LECTORA = conModulo('lectora@homepymes.cl');
const VANESSA = conModulo('vanessa@homepymes.cl');
const rechazado = (r) => !!r && (r._forbidden === true || r.ok === false);

function crear() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  ['Constructora Andes SpA', 'Pyme Sur Ltda'].forEach((n, i) => agregarFila_(db, 'CAT_CLIENTES', {
    cliente_id: 'CLI-' + (i + 1), razon_social: n, rut: '7' + i + '.111.111-1', codigo_cliente: 'HP-00' + i, contacto: '', correo: '', telefono: '',
    representante_legal: '', direccion: '', estado: 'ACTIVO', bloqueo: '', activo: true
  }));
  CI.guardarMiembros(db, { depto: 'CONTABILIDAD', miembros: [{ email: FRANCISCA.email, rol: 'REGISTRA' }, { email: LECTORA.email, rol: 'LECTURA' }] }, ADM);
  CI.guardarMiembros(db, { depto: 'RRHH', miembros: [{ email: VANESSA.email, rol: 'REGISTRA' }] }, ADM);
  return db;
}

const F29 = [
  'Formulario 29 - Declaración mensual y pago simultáneo de impuestos',
  'RUT 70.111.111-1   Período Tributario 2026-09   Folio 8765432101', 'Fecha de presentación 20/10/2026',
  'Código\tGlosa\tValor', '538\tTOTAL DÉBITOS\t1.900.000', '537\tTOTAL CRÉDITOS\t1.200.000', '89\tIMP. DETERM. IVA\t700.000',
  '48\tIMPUESTO ÚNICO 2a CATEGORÍA (Art. 42 N°1)\t86.818', '151\tRETENCIÓN TASA 13,75% SOBRE RENTAS DEL ART. 42 N°2\t55.000',
  '563\tBASE IMPONIBLE\t10.000.000', '115\tTASA PPM\t0,25', '62\tPPM NETO DETERMINADO\t25.000', '91\tTOTAL A PAGAR DENTRO DEL PLAZO LEGAL\t866.818'
].join('\n');
const ENC_V = 'Nro;Tipo Doc;Tipo Venta;Rut cliente;Razon Social;Folio;Fecha Docto;Fecha Recepcion;Fecha Acuse Recibo;Fecha Reclamo;Monto Exento;Monto Neto;Monto IVA;Monto total';
const VENTAS = [ENC_V,
  '1;33;Del Giro;76123456-7;CONSTRUCTORA X SPA;1001;05/09/2026;05/09/2026 10:00:00;;;0;1000000;190000;1190000',
  '2;33;Del Giro;77222333-4;OBRAS Y SA;1002;12/09/2026;;;;0;500000;95000;595000',
  '3;61;Del Giro;76123456-7;CONSTRUCTORA X SPA;55;20/09/2026;;;;0;100000;19000;119000'].join('\n');
const ENC_C = 'Nro;Tipo Doc;Tipo Compra;RUT Proveedor;Razon Social;Folio;Fecha Docto;Fecha Recepcion;Fecha Acuse;Monto Exento;Monto Neto;Monto IVA Recuperable;Monto Iva No Recuperable;Codigo IVA No Rec.;Monto Total';
const COMPRAS = [ENC_C,
  '1;33;Del Giro;76999888-1;FERRETERIA A;501;02/09/2026;02/09/2026;03/09/2026;0;100000;19000;0;;119000',
  '2;33;Del Giro;76999888-1;FERRETERIA A;502;10/09/2026;10/09/2026;;0;200000;38000;0;;238000',
  '3;61;Del Giro;76999888-1;FERRETERIA A;77;15/09/2026;15/09/2026;16/09/2026;0;50000;9500;0;;59500'].join('\n');

test('lee el F29: códigos, RUT, período, folio y fecha de presentación', () => {
  const l = S.leer_(F29, '');
  assert.equal(l.fuente, 'f29');
  assert.equal(l.rut, '70.111.111-1');
  assert.equal(l.periodo, '2026-M09');
  assert.equal(l.fecha_presentacion, '2026-10-20');
  assert.deepEqual(l.codigos, { 48: 86818, 62: 25000, 89: 700000, 91: 866818, 115: 0.25, 151: 55000, 537: 1200000, 538: 1900000, 563: 10000000 }, 'la glosa "Art. 42 N°2" no confunde el valor');
  // Casillas con corchetes, código y valor en líneas separadas.
  const l2 = S.leerF29_('F29\n[91]\n1.234\n[62] $ 500');
  assert.deepEqual(l2.codigos, { 91: 1234, 62: 500 });
});

test('lee el RCV: CSV de ventas y compras (RUT y mes del nombre del archivo) y el resumen de la página', () => {
  const v = S.leer_(VENTAS, 'RCV_VENTA_70111111-1_202609.csv');
  assert.deepEqual([v.fuente, v.tipo, v.nivel, v.rut, v.periodo, v.documentos.length], ['rcv', 'ventas', 'detalle', '70111111-1', '2026-M09', 3]);
  assert.deepEqual(v.documentos[0], { tipo_doc: 33, folio: '1001', fecha: '2026-09-05', acuse: '', rut: '76123456-7', razon_social: 'CONSTRUCTORA X SPA', exento: 0, neto: 1000000, iva: 190000, total: 1190000 });
  const c = S.leer_(COMPRAS, 'detalle.csv');
  assert.deepEqual([c.tipo, c.rut, c.periodo], ['compras', '', '2026-M09'], 'sin nombre útil: el mes sale de las fechas y el RUT no se adivina del cuerpo');
  const r = S.leer_('Registro de Compras\nTipo Documento\tTotal Documentos\tMonto Exento\tMonto Neto\tMonto IVA Recuperable\tMonto Total\nFactura Electrónica (33)\t12\t0\t1.000.000\t190.000\t1.190.000', '');
  assert.deepEqual([r.tipo, r.nivel, r.resumen[0].documentos, r.resumen[0].iva, r.resumen[0].total], ['compras', 'resumen', 12, 190000, 1190000]);
  assert.equal(S.leer_('Bienvenido a Mi SII', ''), null);
});

test('F29 contra Informe y pago de IVA: compara, aplica solo lo marcado y crea la fila si falta', () => {
  const db = crear();
  // Sin fila: se ofrece crearla.
  let r = S.revisar(db, { texto: F29 }, FRANCISCA);
  assert.equal(r.ok, true, r.message);
  assert.equal(r.cliente.cliente_id, 'CLI-1', 'reconocido por el RUT de la página');
  assert.equal(r.comparacion.registro_id, '');
  assert.equal(r.comparacion.campos.find((k) => k.columna === 'monto_pago').sii, 866818);
  assert.ok(r.comparacion.info.some((k) => k.codigo === 89));
  // Con fila: lo vacío, lo igual y lo distinto.
  const fila = CI.guardar(db, { matriz: 'IVA', periodo: '2026-M09', cliente_id: 'CLI-1', datos: { monto_pago: 866818, monto_impuesto_unico: 0, monto_pre_iva: 650000 } }, FRANCISCA).registro;
  r = S.revisar(db, { texto: F29 }, FRANCISCA);
  const est = {};
  r.comparacion.campos.forEach((k) => { est[k.columna] = k.estado; });
  assert.deepEqual(est, { monto_pago: 'igual', tasa_ppm: 'vacio', ventas_ppm: 'vacio', monto_ppm: 'vacio', retencion_honorario: 'vacio', monto_impuesto_unico: 'distinto', fecha_declaracion: 'vacio' });
  assert.ok(r.comparacion.info.some((k) => /Pre-IVA/.test(k.glosa) && k.valor === 650000));
  // Aplicar solo algunas columnas; lo de la pantalla no se usa como valor.
  const a = S.aplicar(db, { texto: F29, usar: ['monto_ppm', 'monto_impuesto_unico', 'fecha_declaracion'], valores: { monto_ppm: 1 } }, FRANCISCA);
  assert.equal(a.ok, true, a.message);
  const d = CI.getRegistro(db, { registro_id: fila.registro_id }, FRANCISCA);
  assert.equal(d.registro.datos.monto_ppm, 25000);
  assert.equal(d.registro.datos.monto_impuesto_unico, 86818);
  assert.equal(d.registro.datos.fecha_declaracion, '2026-10-20');
  assert.equal(d.registro.datos.tasa_ppm, undefined, 'lo no marcado no se toca');
  assert.ok(d.historial.some((h) => h.accion === 'SII' && /F29/.test(h.detalle)));
  // Otro cliente sin fila: se crea con lo marcado.
  const a2 = S.aplicar(db, { texto: F29, cliente_id: 'CLI-2', usar: ['monto_pago'] }, FRANCISCA);
  assert.match(a2.message, /Fila creada/);
});

test('RCV ventas contra Facturación: folio por folio; agrega los que faltan con mandante y montos', () => {
  const db = crear();
  CI.guardar(db, { matriz: 'FACTURACION', periodo: '2026-M09', cliente_id: 'CLI-1', datos: { folio_documento: 1001, tipo_documento: 'FE', monto_total: 1190000 } }, FRANCISCA);
  CI.guardar(db, { matriz: 'FACTURACION', periodo: '2026-M09', cliente_id: 'CLI-1', datos: { folio_documento: 55, tipo_documento: 'NC', monto_total: 100000 } }, FRANCISCA);
  CI.guardar(db, { matriz: 'FACTURACION', periodo: '2026-M09', cliente_id: 'CLI-1', datos: { folio_documento: 999, tipo_documento: 'FE', monto_total: 5000 } }, FRANCISCA);
  const r = S.revisar(db, { texto: VENTAS, nombre: 'RCV_VENTA_70.111.111-1_202609.csv' }, FRANCISCA);
  assert.equal(r.ok, true, r.message);
  const c = r.comparacion;
  assert.equal(c.iguales, 1);
  assert.deepEqual(c.faltan.map((k) => [k.folio, k.tipo]), [['1002', 'FE']]);
  assert.deepEqual(c.distintos.map((k) => [k.folio, k.sii, k.matriz]), [['55', 119000, 100000]]);
  assert.deepEqual(c.sobran.map((k) => k.folio), ['999']);
  const a = S.aplicar(db, { texto: VENTAS, nombre: 'RCV_VENTA_70.111.111-1_202609.csv', crear: ['1002', '1001'] }, FRANCISCA);
  assert.equal(a.creadas, 1, 'solo se agregan los que de verdad faltan');
  const nueva = CI.listar(db, { matriz: 'FACTURACION', periodo: '2026-M09' }, FRANCISCA).registros.find((k) => k.datos.folio_documento === 1002);
  assert.deepEqual([nueva.datos.empresa_mandante, nueva.datos.rut_empresa_mandante, nueva.datos.monto_neto, nueva.datos.monto_total], ['OBRAS Y SA', '77222333-4', 500000, 595000]);
  assert.match(nueva.observaciones, /Registro de Ventas del SII/);
});

test('RCV compras contra Acuse de recibo: cantidad e IVA de facturas y de notas de crédito', () => {
  const db = crear();
  const r = S.revisar(db, { texto: COMPRAS, nombre: 'detalle.csv', cliente_id: 'CLI-2' }, FRANCISCA);
  assert.equal(r.ok, true, r.message);
  const v = {};
  r.comparacion.campos.forEach((k) => { v[k.columna] = k.sii; });
  assert.deepEqual(v, { cantidad_documentos: 2, monto_iva: 57000, cantidad_documentos_n_c: 1, monto_iva_n_c: 9500 });
  assert.equal(r.comparacion.info[0].valor, 1, 'un documento sin fecha de acuse');
  const a = S.aplicar(db, { texto: COMPRAS, nombre: 'detalle.csv', cliente_id: 'CLI-2', usar: ['cantidad_documentos', 'monto_iva', 'cantidad_documentos_n_c', 'monto_iva_n_c'] }, FRANCISCA);
  assert.equal(a.ok, true, a.message);
  const fila = CI.listar(db, { matriz: 'ACUSE', periodo: '2026-M09' }, FRANCISCA).registros[0];
  assert.deepEqual([fila.cliente_id, fila.datos.cantidad_documentos, fila.datos.monto_iva], ['CLI-2', 2, 57000]);
});

test('falta el cliente o el mes; permisos de Contabilidad', () => {
  const db = crear();
  const r = S.revisar(db, { texto: COMPRAS, nombre: 'detalle.csv' }, FRANCISCA);
  assert.equal(r.falta, 'cliente');
  assert.equal(S.aplicar(db, { texto: COMPRAS, nombre: 'detalle.csv', usar: ['monto_iva'] }, FRANCISCA).ok, false);
  // Solo lectura: revisa, no aplica.
  assert.equal(S.revisar(db, { texto: F29 }, LECTORA).ok, true);
  assert.ok(rechazado(S.aplicar(db, { texto: F29, usar: ['monto_pago'] }, LECTORA)));
  // RR.HH. no ve Contabilidad; sin módulo, nada.
  assert.ok(rechazado(S.revisar(db, { texto: F29 }, VANESSA)));
  assert.ok(rechazado(S.revisar(db, { texto: F29 }, { email: 'x@homepymes.cl', rol: 'DEV', modulos: [] })));
  assert.equal(S.revisar(db, { texto: 'hola' }, FRANCISCA).ok, false);
});
