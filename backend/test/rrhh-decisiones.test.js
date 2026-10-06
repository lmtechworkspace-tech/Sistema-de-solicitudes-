'use strict';

/**
 * Decisiones del dueño tras la revisión de RR.HH. (2026-10-05):
 *  D1/D2/D6 matrices sin uso al Archivo (21; «Subsanar moras presuntas» sigue);
 *  D2 informe de impuesto único para Contabilidad desde Remuneraciones;
 *  D3 informe de plataformas para Facturación y Cobranzas;
 *  D4 indicador «clientes que envían la información a tiempo (día 5)»;
 *  D5 «Ya cumplió» en Previred anota la fecha de pago de imposiciones.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const CI = require('../logica/controlInterno');
const A = require('../logica/agendaDepto');
const IND = require('../logica/indicadoresDepto');
const INF = require('../logica/rrhhInformes');
const { MATRICES } = require('../logica/controlInternoMatrices');

const ADM = { email: 'admin@homepymes.cl', rol: 'ADM', modulos: [] };
const LISSETH = { email: 'lisseth@homepymes.cl', rol: 'DEV', modulos: [] };
const FRANCISCA = { email: 'francisca@homepymes.cl', rol: 'DEV', modulos: [] };
const COBRA = { email: 'cobranzas@homepymes.cl', rol: 'DEV', modulos: [] };
const OTRO = { email: 'prevencion@homepymes.cl', rol: 'DEV', modulos: [] };

function crear() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  ['Constructora Andes SpA', 'Pyme Sur Ltda', 'Servicios Norte SpA', 'Obras Centro SpA', 'Montajes Este SpA', 'Ingeniería Oeste SpA'].forEach((n, i) => agregarFila_(db, 'CAT_CLIENTES', {
    cliente_id: 'CLI-' + (i + 1), razon_social: n, rut: '7' + i + '.111.111-1', codigo_cliente: 'HP-00' + i, contacto: 'María', correo: '', telefono: '+56 9 1111 222' + i,
    representante_legal: '', direccion: '', estado: 'ACTIVO', bloqueo: '', activo: true
  }));
  CI.guardarMiembros(db, { depto: 'RRHH', miembros: [{ email: LISSETH.email, rol: 'REGISTRA' }] }, ADM);
  CI.guardarMiembros(db, { depto: 'CONTABILIDAD', miembros: [{ email: FRANCISCA.email, rol: 'REGISTRA' }] }, ADM);
  CI.guardarMiembros(db, { depto: 'COBRANZAS', miembros: [{ email: COBRA.email, rol: 'REGISTRA' }] }, ADM);
  CI.guardarMiembros(db, { depto: 'PREVENCION', miembros: [{ email: OTRO.email, rol: 'REGISTRA' }] }, ADM);
  return db;
}
const rem = (db, cliente, recepcion, extra) => {
  const r = CI.guardar(db, { matriz: 'REMUNERACIONES', cliente_id: cliente, datos: Object.assign({ fecha_recepcion_informacion: recepcion, cantidad: 3, valor_imposiciones: 100000 }, extra || {}) }, ADM);
  assert.equal(r.ok, true, r.message);
  return r;
};

test('D1/D2/D6: 21 matrices de RR.HH. al Archivo con su motivo; «Subsanar moras presuntas» sigue visible', () => {
  const de = (c) => MATRICES.find((m) => m.clave === c);
  const sin = MATRICES.filter((m) => m.depto === 'RRHH' && m.sinUso);
  assert.equal(sin.length, 21);
  assert.ok(sin.every((m) => m.motivoSinUso), 'cada una dice por qué');
  ['LRE', 'IUSC', 'SENCE', 'CLAVE_AFC'].forEach((c) => assert.ok(de(c).sinUso, c));
  ['REMUNERACIONES', 'PLATAFORMAS', 'RLE_FINIQUITOS', 'ANEXOS', 'MORAS_PRESUNTAS', 'CAPACITACION'].forEach((c) => assert.ok(de(c) && !de(c).sinUso, c));
});

test('D2: impuesto único por cliente y mes de la remuneración, cruzado con el IVA de Contabilidad', () => {
  const db = crear();
  // Sueldos de septiembre: CLI-1 en dos obras (llegan el 28-09 y el 03-10); CLI-2 una obra; uno de agosto no cuenta.
  rem(db, 'CLI-1', '2026-09-28', { nombre_obra: 'Obra A', monto_iusc: 30000, '3%_prestamo_solidario': 900, fecha_envio_liquidacion: '2026-10-08' });
  rem(db, 'CLI-1', '2026-10-03', { nombre_obra: 'Obra B', monto_iusc: 12000, '3%_prestamo_solidario': 300 });
  rem(db, 'CLI-2', '2026-10-02', { nombre_obra: 'Única', monto_iusc: 5000, fecha_envio_liquidacion: '2026-10-09' });
  rem(db, 'CLI-3', '2026-09-03', { monto_iusc: 77777 });
  CI.guardar(db, { matriz: 'IVA', periodo: '2026-M09', cliente_id: 'CLI-1', datos: { monto_impuesto_unico: 42000 } }, FRANCISCA);
  CI.guardar(db, { matriz: 'IVA', periodo: '2026-M09', cliente_id: 'CLI-2', datos: { monto_impuesto_unico: 4000 } }, FRANCISCA);
  const r = INF.impuestoUnico(db, { periodo: '2026-M09' }, FRANCISCA);
  assert.equal(r.periodo, '2026-M09');
  const c1 = r.filas.find((f) => f.cliente_id === 'CLI-1'), c2 = r.filas.find((f) => f.cliente_id === 'CLI-2');
  assert.equal(c1.iusc, 42000); assert.equal(c1.tres, 1200); assert.equal(c1.obras, 2); assert.equal(c1.trabajadores, 6);
  assert.equal(c1.cruce, 'IGUAL'); assert.equal(c1.completo, false, 'una obra sin liquidación enviada');
  assert.equal(c2.cruce, 'DISTINTO'); assert.equal(c2.completo, true);
  assert.ok(!r.filas.some((f) => f.cliente_id === 'CLI-3'), 'lo del 03-09 es de agosto');
  assert.equal(r.totales.iusc, 47000); assert.equal(r.totales.distintos, 1);
  assert.deepEqual(r.sin_informacion, ['Servicios Norte SpA'], 'tuvo sueldos en agosto y aún no envía los de septiembre');
  // Permisos: RR.HH. y Contabilidad sí; Cobranzas y otra área no.
  assert.ok(!INF.impuestoUnico(db, { periodo: '2026-M09' }, LISSETH)._forbidden);
  assert.equal(INF.impuestoUnico(db, { periodo: '2026-M09' }, COBRA)._forbidden, true);
  assert.equal(INF.impuestoUnico(db, { periodo: '2026-M09' }, OTRO)._forbidden, true);
});

test('D3: plataformas por cliente y plataforma; el cobro suma y el total del mes toma el mayor', () => {
  const db = crear();
  const sube = (cli, plat, fecha, cobro, mes, fin) => {
    const g = CI.guardar(db, { matriz: 'PLATAFORMAS', cliente_id: cli, datos: { plataforma: plat, fecha_subida: fecha, obras: 'Obra A', empresa_principal: 'Minera X',
      cantidad_trabajadores_le_subio_doc_periodo_cobro: cobro, cantidad_trabajadores_mes: mes, cantidad_trabajadores_finiquitados_mes: fin } }, LISSETH);
    assert.equal(g.ok, true, g.message);
  };
  sube('CLI-1', 'SIGA', '2026-09-04', 10, 25, 2);
  sube('CLI-1', 'SIGA', '2026-09-20', 5, 27, 3);
  sube('CLI-1', 'Acreditasys', '2026-09-10', 7, 7, 0);
  sube('CLI-2', 'SIGA', '2026-10-01', 9, 9, 0);
  const r = INF.plataformas(db, { periodo: '2026-M09' }, COBRA);
  assert.equal(r.filas.length, 2);
  const siga = r.filas.find((f) => f.plataforma === 'SIGA');
  assert.equal(siga.cobro, 15); assert.equal(siga.trabajadores_mes, 27); assert.equal(siga.finiquitados, 3); assert.equal(siga.subidas, 2);
  assert.equal(siga.ultima_subida, '2026-09-20');
  assert.equal(r.totales.cobro, 22); assert.equal(r.totales.clientes, 1);
  assert.equal(INF.plataformas(db, { periodo: '2026-M09' }, FRANCISCA)._forbidden, true, 'Contabilidad no lo ve');
});

test('D4: clientes que envían la información a tiempo (primera recepción hasta el día 5)', () => {
  const db = crear();
  // Sueldos de septiembre (plazo: lunes 5 de octubre). 4 a tiempo, 2 tarde (uno manda una obra a tiempo y otra tarde: cuenta la primera).
  rem(db, 'CLI-1', '2026-09-29'); rem(db, 'CLI-2', '2026-10-02'); rem(db, 'CLI-3', '2026-10-05');
  rem(db, 'CLI-4', '2026-10-01'); rem(db, 'CLI-4', '2026-10-09');
  rem(db, 'CLI-5', '2026-10-07'); rem(db, 'CLI-6', '2026-10-09');
  const c = IND.contexto_(db, '2026-M09'); c.hoy = '2026-10-20';
  const r = IND.calcularArea_(db, 'RRHH', '2026-M09', c);
  const k = r.kpis.find((x) => x.clave === 'informacion_a_tiempo');
  assert.ok(k, 'el indicador está');
  assert.equal(Math.round(k.valor), 67);
  assert.equal(k.estado, 'alerta');
  assert.deepEqual(r.detalle.informacion_tarde.map((x) => x.cliente).sort(), ['Ingeniería Oeste SpA', 'Montajes Este SpA']);
  // Sueldos de octubre: el plazo (5 de noviembre) no vence. Solo CLI-1 envió: el mes está abierto, no se juzga.
  rem(db, 'CLI-1', '2026-10-30');
  const c2 = IND.contexto_(db, '2026-M10'); c2.hoy = '2026-11-03';
  const k2 = IND.calcularArea_(db, 'RRHH', '2026-M10', c2).kpis.find((x) => x.clave === 'informacion_a_tiempo');
  assert.equal(k2.valor, 100); assert.equal(k2.estado, 'info'); assert.equal(k2.preliminar, true);
  // Vencido el plazo, los 5 que tuvieron sueldos en septiembre y no enviaron octubre cuentan como tarde.
  c2.hoy = '2026-11-20';
  const r3 = IND.calcularArea_(db, 'RRHH', '2026-M10', c2);
  const k3 = r3.kpis.find((x) => x.clave === 'informacion_a_tiempo');
  assert.equal(Math.round(k3.valor), 17, '1 de 6');
  assert.equal(k3.estado, 'critico');
  assert.equal(r3.detalle.informacion_tarde.filter((x) => x.recibida === 'Sin enviar').length, 5);
});

test('D5: «Ya cumplió» en el recordatorio de Previred anota la fecha de pago y deja de recordar', () => {
  const db = crear();
  rem(db, 'CLI-1', '2026-09-28'); rem(db, 'CLI-1', '2026-10-02');
  rem(db, 'CLI-2', '2026-10-02');
  const prev = A.obligaciones_(db, 'RRHH').find((o) => o.clave === 'PREVIRED');
  const r = A.responder(db, { obligacion_id: prev.obligacion_id, periodo: '2026-M09', item_clave: 'CLI-1', cliente_id: 'CLI-1', cliente_nombre: 'Constructora Andes SpA', respuesta: 'CUMPLIO' }, LISSETH);
  assert.equal(r.ok, true, r.message);
  assert.match(r.message, /2 filas/);
  const filas = CI.consultar_(db, 'CI_REGISTROS', { matriz: 'REMUNERACIONES', activa: true });
  assert.ok(filas.filter((f) => f.cliente_id === 'CLI-1').every((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.datos.f_pago_imposiciones)));
  assert.ok(filas.filter((f) => f.cliente_id === 'CLI-2').every((f) => !f.datos.f_pago_imposiciones), 'solo el cliente que respondió');
  const h = A.calcularHoy_(db, 'RRHH', '2026-10-13');
  const g = h.grupos.find((x) => x.clave === 'PREVIRED' && x.periodo === '2026-M09');
  assert.deepEqual(g.filas.map((f) => f.cliente_id), ['CLI-2']);
  // Otra respuesta no toca la matriz.
  const r2 = A.responder(db, { obligacion_id: prev.obligacion_id, periodo: '2026-M09', item_clave: 'CLI-2', respuesta: 'CONFIRMO' }, LISSETH);
  assert.equal(r2.ok, true);
  assert.ok(CI.consultar_(db, 'CI_REGISTROS', { matriz: 'REMUNERACIONES', activa: true }).filter((f) => f.cliente_id === 'CLI-2').every((f) => !f.datos.f_pago_imposiciones));
});
