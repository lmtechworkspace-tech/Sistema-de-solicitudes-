'use strict';

/**
 * Control interno, etapa 2 (2026-10-01): ajustes de la reunión con Francisca.
 * Fórmulas del IVA (postergación y PPM) que no pisan lo escrito a mano,
 * "NO APLICA" que se arrastra al abrir el mes de Contabilización, clientes
 * nuevos del mes, alertas del IVA (recordatorio, postergación, impuesto único
 * de RR.HH.), mes sin año en 3 % e IUSC, anotaciones resueltas (azul en la
 * planilla), columnas sin uso y la matriz de servicios sin matriz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const CI = require('../logica/controlInterno');
const Rep = require('../logica/controlInternoReportes');
const Imp = require('../logica/controlInternoImportar');
const { matriz_, mesesDespuesHabil_, calculosIva_ } = require('../logica/controlInternoMatrices');

const ADM = { email: 'admin@homepymes.cl', rol: 'ADM', modulos: [] };
const FRANCISCA = { email: 'francisca@homepymes.cl', rol: 'DEV', modulos: ['control_interno'] };

function crear() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  ['Constructora Andes SpA', 'Pyme Sur Ltda', 'Servicios Norte SpA'].forEach((n, i) => agregarFila_(db, 'CAT_CLIENTES', {
    cliente_id: 'CLI-' + (i + 1), razon_social: n, rut: '7' + i + '.111.111-1', codigo_cliente: 'HP-00' + i, contacto: '', correo: '', telefono: '',
    representante_legal: '', direccion: '', estado: 'ACTIVO', bloqueo: '', activo: true
  }));
  CI.guardarMiembros(db, { depto: 'CONTABILIDAD', miembros: [{ email: FRANCISCA.email, rol: 'REGISTRA' }] }, ADM);
  return db;
}
const iva = (db, periodo, cliente, datos) => CI.guardar(db, { matriz: 'IVA', periodo, cliente_id: cliente, datos }, FRANCISCA);
const listar = (db, matriz, periodo) => CI.listar(db, { matriz, periodo }, FRANCISCA);

test('postergación: 2 meses después; sábado o domingo pasa al lunes; fin de mes', () => {
  assert.equal(mesesDespuesHabil_('2025-03-19', 2), '2025-05-19');
  assert.equal(mesesDespuesHabil_('2025-01-20', 2), '2025-03-20');
  assert.equal(mesesDespuesHabil_('2025-02-20', 2), '2025-04-21', '20-04-2025 era domingo');
  assert.equal(mesesDespuesHabil_('2025-12-31', 2), '2026-03-02', '28-02 → sábado → lunes 2-03');
  assert.equal(calculosIva_({ posterga_si_no: 'NO', fecha_realizacion_postergacion: '2025-03-19' }).fecha_vencimiento_postergacion, '');
});

test('PPM = ventas × tasa, con la tasa en % o como fracción de una celda con formato %', () => {
  assert.equal(calculosIva_({ tasa_ppm: 0.5, ventas_ppm: '14.305.000' }).monto_ppm, 71525);
  assert.equal(calculosIva_({ tasa_ppm: '1,5', ventas_ppm: 2000000 }).monto_ppm, 30000);
  assert.equal(calculosIva_({ tasa_ppm: 0.01, ventas_ppm: 1000000 }).monto_ppm, 10000, '0,01 = 1 %');
  assert.equal(calculosIva_({ tasa_ppm: 'NA', ventas_ppm: 1000000 }).monto_ppm, '');
});

test('las fórmulas se aplican al guardar, se recalculan y no pisan lo escrito a mano', () => {
  const db = crear();
  let r = iva(db, '2026-M09', 'CLI-1', { posterga_si_no: 'SI', fecha_realizacion_postergacion: '2026-10-20', tasa_ppm: 1, ventas_ppm: 3000000 });
  assert.equal(r.ok, true, r.message);
  let d = r.registro.datos;
  assert.equal(d.fecha_vencimiento_postergacion, '2026-12-21', '20-12-2026 es domingo');
  assert.equal(d.monto_ppm, 30000);
  assert.deepEqual(d._auto.sort(), ['fecha_vencimiento_postergacion', 'monto_ppm']);
  const id = r.registro.registro_id;
  // Cambian las ventas: se recalcula.
  d = CI.guardar(db, { registro_id: id, datos: { ventas_ppm: 4000000 } }, FRANCISCA).registro.datos;
  assert.equal(d.monto_ppm, 40000);
  // La persona escribe otro monto: ese manda, aunque cambien las ventas.
  d = CI.guardar(db, { registro_id: id, datos: { monto_ppm: 41234 } }, FRANCISCA).registro.datos;
  assert.equal(d.monto_ppm, 41234);
  assert.deepEqual(d._auto, ['fecha_vencimiento_postergacion']);
  d = CI.guardar(db, { registro_id: id, datos: { ventas_ppm: 5000000 } }, FRANCISCA).registro.datos;
  assert.equal(d.monto_ppm, 41234);
  // Ya no posterga: la fecha calculada se va.
  d = CI.guardar(db, { registro_id: id, datos: { posterga_si_no: 'NO' } }, FRANCISCA).registro.datos;
  assert.equal(d.fecha_vencimiento_postergacion, undefined);
  assert.equal(d._auto, undefined);
  // Un "NA" escrito a mano se respeta.
  r = iva(db, '2026-M09', 'CLI-2', { fecha_vencimiento_postergacion: 'NA' });
  d = CI.guardar(db, { registro_id: r.registro.registro_id, datos: { posterga_si_no: 'SI', fecha_realizacion_postergacion: '2026-10-20' } }, FRANCISCA).registro.datos;
  assert.equal(d.fecha_vencimiento_postergacion, 'NA');
});

test('Contabilización: al abrir el mes, lo que decía NO APLICA queda en NO APLICA (calculado)', () => {
  const db = crear();
  const r = CI.guardar(db, { matriz: 'CONTABILIZACION', periodo: '2026-M08', cliente_id: 'CLI-1', datos: {
    centralizaciones_compras: 'OK', centralizaciones_honorarios: 'NO APLICA', pagos_arriendo: 'NA', pagos_sueldos: 'OK', estado_final: 'OK'
  } }, FRANCISCA);
  assert.equal(r.ok, true, r.message);
  const a = CI.abrirPeriodo(db, { matriz: 'CONTABILIZACION', periodo: '2026-M09' }, FRANCISCA);
  assert.equal(a.ok, true, a.message);
  assert.equal(a.no_aplica, 2);
  assert.match(a.message, /2 casillas quedaron en NO APLICA/);
  const d = listar(db, 'CONTABILIZACION', '2026-M09').registros[0].datos;
  assert.equal(d.centralizaciones_honorarios, 'NO APLICA');
  assert.equal(d.pagos_arriendo, 'NA');
  assert.equal(d.centralizaciones_compras, undefined, 'lo que se hizo no se copia');
  assert.equal(d.estado_final, undefined);
  assert.deepEqual(d._auto.sort(), ['centralizaciones_honorarios', 'pagos_arriendo']);
});

test('clientes nuevos del mes: primera vez en la matriz; el primer mes con datos no cuenta', () => {
  const db = crear();
  CI.guardar(db, { matriz: 'FACTURACION', periodo: '2026-M07', cliente_id: 'CLI-1', datos: { folio_documento: 1 } }, FRANCISCA);
  assert.deepEqual(listar(db, 'FACTURACION', '2026-M07').nuevos, [], 'primer mes: nadie es "nuevo"');
  CI.guardar(db, { matriz: 'FACTURACION', periodo: '2026-M08', cliente_id: 'CLI-1', datos: { folio_documento: 2 } }, FRANCISCA);
  const n = CI.guardar(db, { matriz: 'FACTURACION', periodo: '2026-M08', cliente_id: 'CLI-2', datos: { folio_documento: 3 } }, FRANCISCA).registro.registro_id;
  const n2 = CI.guardar(db, { matriz: 'FACTURACION', periodo: '2026-M08', cliente_id: 'CLI-2', datos: { folio_documento: 4 } }, FRANCISCA).registro.registro_id;
  const l = listar(db, 'FACTURACION', '2026-M08');
  assert.deepEqual(l.nuevos.sort(), [n, n2].sort());
  assert.equal(l.nuevos_desde, '2026-M07');
  // El informe mensual los cuenta (por cliente, no por fila).
  const inf = Rep.informeMensual(db, { matriz: 'FACTURACION', periodo: '2026-M08' }, FRANCISCA);
  assert.equal(inf.resumen.clientes_nuevos, 1);
  assert.deepEqual(inf.clientes_nuevos, ['Pyme Sur Ltda']);
  assert.equal(inf.detalle.filter((f) => f.nuevo).length, 2);
});

test('3 % e IUSC: "MAYO" sin año es el último mayo que pasó, no el mes en que se importa', () => {
  const m = matriz_('IUSC');
  const hoy = CI.periodoActual_(), a = Number(hoy.slice(0, 4)), mm = Number(hoy.slice(6, 8));
  assert.equal(CI.periodoDeDatos_(m, { mes: 'MAYO' }), (mm >= 5 ? a : a - 1) + '-M05');
  assert.equal(CI.periodoDeDatos_(m, { mes: 'MAYO 2024' }), '2024-M05');
});

test('alertas del IVA: recordatorio pasado el 15, postergación por vencer e impuesto único de RR.HH.', () => {
  const db = crear();
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
  const pasado = CI.moverPeriodo_(CI.periodoActual_(), -2); // su 15 ya pasó
  iva(db, pasado, 'CLI-1', { monto_impuesto_unico: 50000 });
  iva(db, pasado, 'CLI-2', { monto_impuesto_unico: 30000, envio_correo_recordatorio: '2026-01-16' });
  const venceEn3 = new Date(Date.parse(hoy + 'T12:00:00Z') + 3 * 864e5).toISOString().slice(0, 10);
  iva(db, pasado, 'CLI-3', { posterga_si_no: 'SI', fecha_vencimiento_postergacion: venceEn3 });
  // RR.HH. informó impuesto único para CLI-3 en el mismo mes (con permiso de ADM).
  const rr = CI.guardar(db, { matriz: 'IUSC', cliente_id: 'CLI-3', datos: { monto_iusc: 77777, estado: 'LISTO' }, periodo: pasado }, ADM);
  assert.equal(rr.ok, true, rr.message);
  const l = listar(db, 'IVA', pasado);
  const por = {};
  (l.alertas || []).forEach((x) => { por[x.clave] = x; });
  assert.equal(por.recordatorio.items.length, 1);
  assert.equal(por.recordatorio.items[0].cliente, 'Constructora Andes SpA');
  assert.equal(por.postergacion.items.length, 1);
  assert.match(por.postergacion.items[0].texto, /vence el/);
  assert.equal(por.iusc.items.length, 1);
  assert.deepEqual(por.iusc.items[0].usar, { monto_impuesto_unico: 77777 });
  // Con un clic: "usar este monto" es un guardar normal; la alerta se va.
  CI.guardar(db, { registro_id: por.iusc.items[0].registro_id, datos: por.iusc.items[0].usar }, FRANCISCA);
  assert.ok(!(listar(db, 'IVA', pasado).alertas || []).some((x) => x.clave === 'iusc'));
});

test('anotaciones del SII: azul en la planilla = resuelta; la situación es vigente / resuelta', () => {
  assert.equal(Imp.esAzul_('9FC5E8'), true);
  assert.equal(Imp.esAzul_('6D9EEB'), true);
  assert.equal(Imp.esAzul_('B6D7A8'), false, 'verde: vigente');
  assert.equal(Imp.esAzul_('FF0000'), false);
  assert.equal(Imp.esAzul_('FFFFFF'), false);
  const filas = [[], ['', 'Realizado por:', '', 'Krishna'], ['', 'Última actualización', '', '2026-06-02'], [], [],
    ['', 'ALFACORP SPA'], [], ['', 'Notificaciones', '', '', '', '', 'Anotaciones'], [],
    ['', '2025-10-08', '', '', '', '', '2024-03-01'], ['', 'giro por rectificatoria', '', '', '', '', 'Según la información del SII…']];
  const colores = []; colores[10] = { 6: '9FC5E8' };
  const e = Imp.filasDeFichas_(filas, colores);
  assert.deepEqual(e.map((x) => [x.datos.tipo, x.datos.resuelta]), [['NOTIFICACIÓN', 'NO'], ['ANOTACIÓN', 'SI']]);
  assert.equal(Imp.filasDeFichas_(filas).every((x) => x.datos.resuelta === undefined), true, 'sin colores no se afirma nada');
  const m = matriz_('NOTIFICACIONES_SII');
  assert.equal(m.situacion({ resuelta: 'SI' }, m), 'RESUELTA');
  assert.equal(m.situacion({}, m), 'VIGENTE');
});

test('columnas sin uso y ayuda llegan a la pantalla; las hojas sin uso se marcan', () => {
  const db = crear();
  const cfg = CI.getConfig(db, {}, FRANCISCA);
  const fac = cfg.matrices.find((m) => m.clave === 'FACTURACION');
  assert.deepEqual(fac.columnas.filter((c) => c.sinUso).map((c) => c.clave), ['codigo', 'clasificacion_interna', 'enviar_cliente_obra']);
  assert.match(fac.columnas.find((c) => c.clave === 'eepp').ayuda, /estado de pago/);
  const ivaDef = cfg.matrices.find((m) => m.clave === 'IVA');
  const i = ivaDef.columnas.findIndex((c) => c.clave === 'tasa_ppm');
  assert.equal(ivaDef.columnas[i + 1].clave, 'ventas_ppm', 'la base del PPM va junto a la tasa');
  assert.deepEqual(cfg.matrices.filter((m) => m.sinUso).map((m) => m.clave).sort(), ['ARRIENDOS', 'IVA_CARTAS_PODER']);
});

test('servicios sin matriz: una fila por solicitud, mes desde la fecha de solicitud', () => {
  const db = crear();
  const r = CI.guardar(db, { matriz: 'OTROS_SERVICIOS', cliente_id: 'CLI-1', datos: { servicio: 'CARPETA TRIBUTARIA', fecha_solicitud: '2026-09-03', fecha_realizacion: '2026-09-04' } }, FRANCISCA);
  assert.equal(r.ok, true, r.message);
  assert.equal(r.registro.periodo, '2026-M09');
  assert.equal(r.registro.estado, 'EN_PROCESO');
  const r2 = CI.guardar(db, { registro_id: r.registro.registro_id, datos: { fecha_envio_cliente: '2026-09-05' } }, FRANCISCA);
  assert.equal(r2.registro.estado, 'TERMINADO');
});
