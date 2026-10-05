'use strict';

/**
 * Revisión del módulo de RR.HH. con su planilla real y la reunión con el área
 * (2026-10-05):
 *  - el MES DE LA REMUNERACIÓN: la información de los sueldos de un mes llega
 *    entre el 27 y el 10 del siguiente; del día 20 en adelante es ese mes, antes
 *    del 20 el mes anterior;
 *  - la Agenda con las fechas del área: información hasta el día 5 (pedida el 28 y
 *    recordada el 2-3), imposiciones el 10 y el 13, informe de plataformas a
 *    Facturación (primeros 5 días) e impuesto único a Contabilidad (5-7 y 13);
 *  - la propuesta corregida llega sola a lo que nadie editó, nunca a lo editado;
 *  - el cruce IVA ↔ impuesto único usa Remuneraciones si la matriz 3 %-IUSC no
 *    tiene el mes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const CI = require('../logica/controlInterno');
const A = require('../logica/agendaDepto');
const { periodoRemuneracion_ } = require('../logica/controlInternoMatrices');

const ADM = { email: 'admin@homepymes.cl', rol: 'ADM', modulos: [] };
const FRANCISCA = { email: 'francisca@homepymes.cl', rol: 'DEV', modulos: ['control_interno'] };

function crear() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  ['Constructora Andes SpA', 'Pyme Sur Ltda', 'Servicios Norte SpA'].forEach((n, i) => agregarFila_(db, 'CAT_CLIENTES', {
    cliente_id: 'CLI-' + (i + 1), razon_social: n, rut: '7' + i + '.111.111-1', codigo_cliente: 'HP-00' + i, contacto: 'María', correo: '', telefono: '+56 9 1111 222' + i,
    representante_legal: '', direccion: '', estado: 'ACTIVO', bloqueo: '', activo: true
  }));
  CI.guardarMiembros(db, { depto: 'CONTABILIDAD', miembros: [{ email: FRANCISCA.email, rol: 'REGISTRA' }] }, ADM);
  return db;
}
const rem = (db, cliente, recepcion, extra) => {
  const r = CI.guardar(db, { matriz: 'REMUNERACIONES', cliente_id: cliente, datos: Object.assign({ fecha_recepcion_informacion: recepcion, cantidad: 3, valor_imposiciones: 100000 }, extra || {}) }, ADM);
  assert.equal(r.ok, true, r.message);
  return r;
};

test('mes de la remuneración: del 20 en adelante es ese mes; antes del 20, el anterior', () => {
  assert.equal(periodoRemuneracion_({ datos: { fecha_recepcion_informacion: '2026-09-28' }, periodo: '2026-M09' }), '2026-M09');
  assert.equal(periodoRemuneracion_({ datos: { fecha_recepcion_informacion: '2026-10-03' }, periodo: '2026-M10' }), '2026-M09');
  assert.equal(periodoRemuneracion_({ datos: { fecha_recepcion_informacion: '2026-01-08' } }), '2025-M12', 'enero vuelve a diciembre del año anterior');
  assert.equal(periodoRemuneracion_({ datos: { fecha_recepcion_informacion: '2026-10-20' } }), '2026-M10');
  assert.equal(periodoRemuneracion_({ datos: {}, periodo: '2026-M07' }), '2026-M07', 'sin fecha, el mes de la fila');
});

test('agenda de RR.HH.: la información de septiembre se pide hasta el 5 de octubre y la que llega en octubre cuenta', () => {
  const db = crear();
  // Sueldos de agosto: llegaron el 2 y el 3 de septiembre (los dos clientes).
  rem(db, 'CLI-1', '2026-09-02'); rem(db, 'CLI-2', '2026-09-03');
  // Sueldos de septiembre: CLI-1 ya envió (el 1 de octubre); CLI-2 todavía no.
  rem(db, 'CLI-1', '2026-10-01', { valor_imposiciones: 250000 }); rem(db, 'CLI-1', '2026-09-29', { valor_imposiciones: 50000 });
  const obl = A.obligaciones_(db, 'RRHH');
  const asis = obl.find((o) => o.clave === 'ASISTENCIA');
  assert.deepEqual(asis.regla, { tipo: 'mensual', mes: 1, dia: 5, habil: true });
  assert.ok(obl.some((o) => o.clave === 'INFORME_PLATAFORMAS') && obl.some((o) => o.clave === 'IMPUESTO_UNICO_CONTABILIDAD'), 'los dos informes internos');
  // 5 de octubre de 2026 (lunes): último día para la información de septiembre.
  const h = A.calcularHoy_(db, 'RRHH', '2026-10-05');
  const g = h.grupos.find((x) => x.clave === 'ASISTENCIA' && x.periodo === '2026-M09');
  assert.ok(g, 'la información de septiembre vence hoy');
  assert.equal(g.fecha_limite, '2026-10-05');
  assert.deepEqual(g.filas.map((f) => f.cliente_id), ['CLI-2'], 'solo falta CLI-2: lo que CLI-1 envió el 29-09 y el 01-10 es de septiembre');
  assert.equal(g.filas[0].escalon.id, 'R3');
  assert.match(g.filas[0].mensaje.texto, /no se podrán declarar/);
  // Los internos del día 5: el informe de plataformas para Facturación.
  assert.ok(h.grupos.some((x) => x.clave === 'INFORME_PLATAFORMAS'));
  // 9 de octubre (viernes, 2 hábiles antes del martes 13): recordatorio de imposiciones de septiembre
  // con el monto de los sueldos de septiembre (no los de agosto, que llegaron en septiembre).
  const h2 = A.calcularHoy_(db, 'RRHH', '2026-10-08');
  const p = h2.grupos.find((x) => x.clave === 'PREVIRED' && x.periodo === '2026-M09');
  assert.ok(p, 'recordatorio de imposiciones de septiembre');
  assert.equal(p.fecha_limite, '2026-10-13');
  const f1 = p.filas.find((f) => f.cliente_id === 'CLI-1');
  assert.equal(f1.vars.monto, '$300.000', 'septiembre: 250.000 + 50.000');
  assert.ok(!p.filas.some((f) => f.cliente_id === 'CLI-2'), 'CLI-2 no tiene sueldos de septiembre todavía');
  // Imposiciones pagadas (fecha de pago en la matriz): ya no se le recuerda.
  const fila = CI.consultar_(db, 'CI_REGISTROS', { matriz: 'REMUNERACIONES', activa: true }).find((r) => r.datos.fecha_recepcion_informacion === '2026-10-01');
  CI.guardar(db, { registro_id: fila.registro_id, datos: { f_pago_imposiciones: '2026-10-09' } }, ADM);
  const h3 = A.calcularHoy_(db, 'RRHH', '2026-10-13');
  assert.ok(!(h3.grupos.find((x) => x.clave === 'PREVIRED' && x.periodo === '2026-M09') || { filas: [] }).filas.some((f) => f.cliente_id === 'CLI-1'));
});

test('agenda: la propuesta corregida reemplaza solo lo que nadie editó', () => {
  const db = crear();
  // Como estaba en producción antes de la revisión: ASISTENCIA al último día del mes; PREVIRED editada por la jefatura.
  const vieja = { clave: 'ASISTENCIA', depto: 'RRHH', nombre: 'Asistencia y novedades del mes', descripcion: '', tipo: 'CLIENTE', fuente: 'asistencia',
    regla: JSON.stringify({ tipo: 'mensual', mes: 0, dia: 'ultimo', habil: true }), escalones: JSON.stringify([{ id: 'R1', offset: -5, canal: 'CORREO', texto: 'x' }]),
    sin_recordatorio: '', sin_respuesta: '', proceso: '', orden: 1, origen: 'PROPUESTA', creado_por: 'sistema', fecha_creacion: '', actualizado_por: '', fecha_actualizacion: '', activa: true };
  agregarFila_(db, 'DEP_OBLIGACIONES', Object.assign({ obligacion_id: 'O1' }, vieja));
  agregarFila_(db, 'DEP_OBLIGACIONES', Object.assign({ obligacion_id: 'O2' }, vieja, { clave: 'PREVIRED', fuente: 'previred', actualizado_por: 'jefa@homepymes.cl',
    regla: JSON.stringify({ tipo: 'mensual', mes: 1, dia: 12, habil: true }) }));
  const obl = A.obligaciones_(db, 'RRHH', true);
  assert.equal(obl.find((o) => o.clave === 'ASISTENCIA').regla.dia, 5, 'sin editar: toma las fechas nuevas');
  assert.equal(obl.find((o) => o.clave === 'PREVIRED').regla.dia, 12, 'editada por la jefatura: se respeta');
  assert.equal(leerFilas_(db, 'DEP_OBLIGACIONES', COLUMNAS.DEP_OBLIGACIONES).filter((o) => o.clave === 'ASISTENCIA').length, 1, 'no duplica');
  void actualizarFilaPorId_;
});

test('cruce IVA ↔ impuesto único: sin la matriz 3 %-IUSC del mes, usa Remuneraciones (por mes de la remuneración)', () => {
  const db = crear();
  const ago = '2026-M08';
  CI.guardar(db, { matriz: 'IVA', periodo: ago, cliente_id: 'CLI-2', datos: { monto_pago: 10000 } }, FRANCISCA);
  // Sueldos de agosto de CLI-2 en dos obras: llegaron el 28-08 y el 03-09. Uno de julio (02-08) no cuenta.
  rem(db, 'CLI-2', '2026-08-28', { monto_iusc: 40000 });
  rem(db, 'CLI-2', '2026-09-03', { monto_iusc: 15000 });
  rem(db, 'CLI-2', '2026-08-02', { monto_iusc: 99999 });
  const l = CI.listar(db, { matriz: 'IVA', periodo: ago }, FRANCISCA);
  const a = (l.alertas || []).find((x) => x.clave === 'iusc');
  assert.ok(a, 'avisa el impuesto único que RR.HH. tiene y Contabilidad no');
  assert.match(a.texto, /Remuneraciones/);
  assert.deepEqual(a.items[0].usar, { monto_impuesto_unico: 55000 });
  // Si la matriz 3 %-IUSC tiene el mes, manda ella.
  CI.guardar(db, { matriz: 'IUSC', cliente_id: 'CLI-2', datos: { monto_iusc: 61000, estado: 'LISTO' }, periodo: ago }, ADM);
  const l2 = CI.listar(db, { matriz: 'IVA', periodo: ago }, FRANCISCA);
  assert.deepEqual((l2.alertas || []).find((x) => x.clave === 'iusc').items[0].usar, { monto_impuesto_unico: 61000 });
});
