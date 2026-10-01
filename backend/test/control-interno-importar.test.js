'use strict';

/**
 * Importación de las planillas del Drive a Control interno (2026-10-01).
 * Hojas sintéticas con la misma forma que las reales: encabezados, fechas como
 * número de serie de Excel, "NA", listas de clientes pegadas abajo, etc.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const CI = require('../logica/controlInterno');
const Imp = require('../logica/controlInternoImportar');

const ADM = { email: 'admin@homepymes.cl', rol: 'ADM', modulos: [] };
const OTRO = { email: 'francisca@homepymes.cl', rol: 'DEV', modulos: ['control_interno'] };
// Serie de Excel: 46265 = 2026-08-31, 46280 = 2026-09-15, 45900 = 2025-08-31.
const SEP15 = '46280', AGO31 = '46265', AGO2025 = '45900';

function crear() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  agregarFila_(db, 'CAT_CLIENTES', { cliente_id: 'CLI-1', razon_social: 'ATON CONSTRUCCIONES SPA', rut: '76.841.123-4', codigo_cliente: 'HP-002-1', contacto: '', correo: '', telefono: '', representante_legal: '', direccion: '', estado: 'ACTIVO', bloqueo: '', activo: true });
  agregarFila_(db, 'CAT_CLIENTES', { cliente_id: 'CLI-2', razon_social: 'Pyme Sur Limitada', rut: '77.222.222-2', codigo_cliente: 'HC-010-1', contacto: '', correo: '', telefono: '', representante_legal: '', direccion: '', estado: 'ACTIVO', bloqueo: '', activo: true });
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'C1', usuario: 'ffeliu', nombre: 'Francisca Feliú', cargo: 'Asistente', emails: JSON.stringify(['francisca@homepymes.cl']), rol: 'DEV', modulos: '[]', empresa_id: 'HP', activo: true });
  return db;
}
const registros = (db, matriz) => leerFilas_(db, 'CI_REGISTROS', COLUMNAS.CI_REGISTROS).filter((r) => r.matriz === matriz);
const hojaIva = () => [
  ['', 'INFORME Y PAGO DE IVA'],
  [],
  ['N°', 'EMPRESA', 'RUT', 'CLASIFICACION', 'ESTATUS', 'RRHH', 'MONTO PRE IVA', 'FECHA PRE IVA', 'QUIEN REALIZA', 'POSTERGA SI - NO', 'FECHA DECLARACION', 'ENVIADO EL F29', 'OBS.'],
  ['1', 'Aton Construcciones SpA', '76.841.123-4', 'HP', 'WHATSAPP', 'SI', '1.250.000', AGO31, 'FRANCISCA', 'NO', SEP15, 'SI', 'ok'],
  ['2', 'Pyme Sur Ltda', '77222222-2', 'HC', 'enviar a wsp', 'No', '300000', AGO31, 'FRANCISCA', 'SI', '', '', ''],
  ['3', 'Cliente Nuevo SpA', '78.000.000-1', 'NA', 'NA', 'NA', 'NA', '', 'Paulette', '', '', '', ''],
  [],
  // Lista de clientes pegada abajo (pasa en Enero–Junio 2026): no son registros.
  ['', 'Otra Empresa SpA', '79.000.000-1']
];

test('las fechas, horas, montos y meses de las planillas se leen bien', () => {
  assert.equal(Imp.fecha_('46280'), '2026-09-15');
  assert.equal(Imp.fecha_('15/09/2026'), '2026-09-15');
  assert.equal(Imp.fecha_('NA'), '');
  assert.equal(Imp.hora_('0.5'), '12:00');
  assert.equal(Imp.hora_('46280.75'), '18:00');
  assert.equal(Imp.numero_('1.250.000'), 1250000);
  assert.equal(Imp.numero_('$ 300000'), 300000);
  assert.equal(Imp.periodoHoja_('SEPTIEMBRE 2026'), '2026-M09');
  assert.equal(Imp.periodoHoja_('AGOSTO25'), '2025-M08');
  assert.equal(Imp.periodoHoja_('CONVENIO JULIO 2026'), '2026-M07');
  assert.equal(Imp.periodoHoja_('SOLO RENTA 2026'), '');
});

test('solo el administrador importa', () => {
  const db = crear();
  assert.equal(Imp.importarHoja(db, { hoja: 'SEPTIEMBRE 2026', filas: hojaIva(), anio: '2026' }, OTRO)._forbidden, true);
});

test('IVA: reconoce la matriz, calza clientes por RUT, responsables por nombre y no toma la lista de abajo', () => {
  const db = crear();
  const sim = Imp.importarHoja(db, { archivo: 'iva.xlsx', hoja: 'SEPTIEMBRE 2026', filas: hojaIva(), anio: '2026', simular: true }, ADM);
  assert.equal(sim.matriz, 'IVA');
  assert.equal(sim.nuevas, 3);
  assert.equal(sim.sin_datos, 1, 'la fila con solo nombre y RUT no es un registro');
  assert.equal(sim.fuera_catalogo, 1);
  assert.deepEqual(sim.sin_cuenta, ['Paulette']);
  assert.equal(registros(db, 'IVA').length, 0, 'simular no escribe');

  const r = Imp.importarHoja(db, { archivo: 'iva.xlsx', hoja: 'SEPTIEMBRE 2026', filas: hojaIva(), anio: '2026' }, ADM);
  assert.equal(r.nuevas, 3);
  const regs = registros(db, 'IVA');
  const aton = regs.find((x) => x.cliente_id === 'CLI-1');
  assert.equal(aton.periodo, '2026-M09');
  assert.equal(aton.estado, 'CERRADO', 'F29 enviado');
  assert.equal(aton.datos.monto_pre_iva, 1250000);
  assert.equal(aton.datos.contacto, 'WhatsApp');
  assert.equal(aton.datos.rrhh, 'Sí');
  assert.equal(aton.responsable_email, 'francisca@homepymes.cl');
  const sur = regs.find((x) => x.cliente_id === 'CLI-2');
  assert.equal(sur.estado, 'POSTERGADO');
  assert.equal(sur.datos.contacto, 'WhatsApp');
  const nuevo = regs.find((x) => !x.cliente_id);
  assert.equal(nuevo.cliente_nombre, 'Cliente Nuevo SpA');
  assert.match(nuevo.observaciones, /Realizado por: Paulette/);
  assert.equal(nuevo.datos.clasificacion, '', 'NA queda vacío');

  // Volver a importar no duplica.
  const otra = Imp.importarHoja(db, { archivo: 'iva.xlsx', hoja: 'SEPTIEMBRE 2026', filas: hojaIva(), anio: '2026' }, ADM);
  assert.equal(otra.nuevas, 0);
  assert.equal(otra.ya_estaban, 3);
  assert.equal(registros(db, 'IVA').length, 3);
  assert.ok(CI.getRegistro(db, { registro_id: aton.registro_id }, ADM).historial.some((h) => h.accion === 'IMPORTADO'));
});

test('una hoja de otro año o sin mes no se importa', () => {
  const db = crear();
  assert.match(Imp.importarHoja(db, { hoja: 'SEPTIEMBRE 2025', filas: hojaIva(), anio: '2026' }, ADM).motivo, /2025/);
  assert.match(Imp.importarHoja(db, { hoja: 'SOLO RENTA 2026', filas: hojaIva(), anio: '2026' }, ADM).motivo, /mes y año/);
  assert.equal(Imp.importarHoja(db, { hoja: 'validador', filas: [['a', 'b']], anio: '2026' }, ADM).omitida, true);
});

test('RR.HH.: el cliente por código, el año por la fecha de recepción y la licencia sin el motivo', () => {
  const db = crear();
  const fin = Imp.importarHoja(db, { hoja: 'Finiquitos', anio: '2026', filas: [
    ['EMPRESA', 'Recepcion del requerimiento', 'Quien realiza', 'CAUSAL DE FINIQUITO', 'Nombre', 'Rut', 'Nº trabajadores', 'Mes y año', 'ENVIO DE LA DOC. AL CLIENTE'],
    ['HP-002-1 ATON CONSTRUCCIONES SPA 76.841.123-4', SEP15, 'Francisca Feliu', '159-4 Vencimiento del plazo convenido', 'Juan Pérez', '11.111.111-1', '1', 'sep', SEP15],
    ['HP-002-1 ATON CONSTRUCCIONES SPA 76.841.123-4', AGO2025, 'Francisca Feliu', 'Renuncia', 'Ana Soto', '22.222.222-2', '1', 'ago', AGO2025]
  ] }, ADM);
  assert.equal(fin.nuevas, 1);
  assert.equal(fin.otro_anio, 1);
  const f = registros(db, 'FINIQUITOS')[0];
  assert.equal(f.cliente_id, 'CLI-1');
  assert.equal(f.periodo, '2026-M09');
  assert.equal(f.estado, 'ENVIADO');
  assert.equal(f.datos.causal, '159-4 Vencimiento del plazo');

  Imp.importarHoja(db, { hoja: 'Licencias', anio: '2026', filas: [
    ['EMPRESA', 'Quien realiza', 'Obra', 'Nombre Personal', 'Rut Personal', 'Fecha Tramite', 'Fecha Inicio', 'Fecha Termino', 'Motivo', 'Institucion', 'Días Licencia', 'Fecha de envio al cliente', 'Estado'],
    ['HC-010-1 PYME SUR LIMITADA', 'Francisca', 'Obra 1', 'Pedro', '3.333.333-3', SEP15, SEP15, SEP15, 'diagnóstico reservado', 'Fonasa', '5', SEP15, 'Tramitada']
  ] }, ADM);
  const l = registros(db, 'LICENCIAS')[0];
  assert.equal(l.cliente_id, 'CLI-2');
  assert.equal(l.estado, 'TRAMITADA');
  assert.ok(!JSON.stringify(l).includes('diagnóstico'), 'el motivo médico no se importa');
});

test('convenios: los bloques repetidos pasan a una lista y el estado sale de las cuotas', () => {
  const db = crear();
  const enc = ['EMPRESA', 'RUT', 'QUIEN REALIZA', 'FECHA REALIZACION', 'CONVENIOS', 'CANTIDAD DE CONVENIOS'];
  const fila = ['Aton Construcciones', '76.841.123-4', 'FRANCISCA', SEP15, 'SI', '2'];
  [1, 2, 3].forEach((i) => {
    enc.push('FECHA QUE SE REALIZO EL CONVENIO ' + i, 'PIE DE COVENIO ' + i, 'MONTO TOTAL DEUDA ' + i, 'FOLIO CONVENIO ' + i, 'CUOTAS CANCEL' + (i === 3 ? 'D' : 'AD') + 'AS CONVENIO ' + i);
    fila.push(i < 3 ? SEP15 : 'NA', i < 3 ? '100000' : 'NA', i < 3 ? '900000' : 'NA', i < 3 ? 'F' + i : 'NA', i < 3 ? '3' : 'NA');
  });
  [1, 2, 3].forEach((i) => { enc.push('CUOTAS VENCIDAS CONVENIO ' + i); fila.push(i === 2 ? '2' : (i === 1 ? '0' : 'NA')); });
  [1, 2, 3].forEach((i) => { enc.push('TIPO DE CONVENIO ' + i); fila.push(i === 1 ? 'IVA RENTA' : (i === 2 ? 'RENTA' : 'NA')); });
  const r = Imp.importarHoja(db, { hoja: 'CONVENIO SEPTIEMBRE 2026', anio: '2026', filas: [enc, fila] }, ADM);
  assert.equal(r.nuevas, 1);
  const c = registros(db, 'CONVENIOS')[0];
  assert.equal(c.datos.convenios.length, 2);
  assert.equal(c.datos.convenios[0].tipo, 'IVA y Renta');
  assert.equal(c.datos.convenios[0].cuotas_pagadas, 3);
  assert.equal(c.estado, 'CON_VENCIDAS');
});

test('contabilización: el encabezado en dos niveles arma la checklist por bloque', () => {
  const db = crear();
  const grupo = ['CARTA PODER', '', '', '', '', '', 'CENTRALIZACIONES', '', '', '', '', 'PAGOS', '', '', '', ''];
  const enc = ['CODIGO', 'EMPRESA', 'RUT', 'CLASIFICACION INTERNA', 'QUIEN REALIZA', 'ASIENTO DE APERTURA', 'QUIEN REALIZA', 'FECHA REALIZACION', 'COMPRAS', 'BANCO', 'VENTAS', 'QUIEN REALIZA', 'FECHA REALIZACION', 'COMPRAS', 'ESTADO FINAL', 'OBS'];
  const fila = ['', 'Aton', '76.841.123-4', 'Sí', 'Francisca', 'OK', 'Francisca', SEP15, 'OK', 'No Aplica', 'Pendiente', 'Francisca', SEP15, 'OK', '', ''];
  const r = Imp.importarHoja(db, { hoja: 'SEPTIEMBRE 2026', anio: '2026', filas: [grupo, enc, fila] }, ADM);
  assert.equal(r.matriz, 'CONTABILIZACION');
  const c = registros(db, 'CONTABILIZACION')[0];
  assert.equal(c.datos.tareas.centralizaciones.items.Compras, 'OK');
  assert.equal(c.datos.tareas.centralizaciones.items.Banco, 'NO_APLICA');
  assert.equal(c.datos.tareas.centralizaciones.items.Ventas, 'PENDIENTE');
  assert.equal(c.datos.tareas.pagos.items.Compras, 'OK', 'las Compras de Pagos no se mezclan con las de Centralizaciones');
  assert.equal(c.datos.tareas.centralizaciones.quien, 'francisca@homepymes.cl');
  assert.equal(c.datos.tareas.centralizaciones.fecha, '2026-09-15');
  assert.equal(c.estado, 'EN_PROCESO');
});

test('las filas vacías con formato no cuentan para el límite', () => {
  const db = crear();
  const filas = hojaIva().concat(Array.from({ length: 20000 }, () => []));
  assert.equal(Imp.importarHoja(db, { hoja: 'SEPTIEMBRE 2026', filas, anio: '2026', simular: true }, ADM).nuevas, 3);
});
