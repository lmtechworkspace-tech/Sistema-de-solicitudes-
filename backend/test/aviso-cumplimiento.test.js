'use strict';

/**
 * Aviso semanal del índice de cumplimiento (Plan de control, P4): a quién le
 * llega qué, el mes que se informa, la marcha blanca de gerencia, una vez por
 * semana y solo Administración lo ve antes o lo manda a mano.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const A = require('../logica/avisoCumplimiento');

const ANA = 'ana@homepymes.cl';
const BETO = 'beto@homepymes.cl';
const JEFE = 'jefe@homepymes.cl';
const GER = 'gerencia@homepymes.cl';
const LUNES = '2026-11-16';

function crear() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  [[ANA, 'Ana Pérez', 'DEV'], [BETO, 'Beto Ríos', 'DEV'], [JEFE, 'Jefa Uno', 'DEV'], [GER, 'Gerente', 'GERENCIA']].forEach(([email, nombre, rol], i) =>
    agregarFila_(db, 'USUARIOS', { usuario_id: 'U' + i, nombre, email, rol, activo: true }));
  agregarFila_(db, 'JEFATURAS', { jefatura_id: 'J1', jefe_email: JEFE, subordinado_email: ANA, activo: true });
  agregarFila_(db, 'JEFATURAS', { jefatura_id: 'J2', jefe_email: JEFE, subordinado_email: BETO, activo: true });
  return db;
}
let n = 0;
function tarea(db, campos) {
  agregarFila_(db, 'ACTIVIDADES', Object.assign({ actividad_id: 'T' + (++n), titulo: 'Tarea ' + n, responsable_email: ANA, estado: 'EN_CURSO', activa: true,
    fecha_creacion: '2026-11-02T12:00:00.000Z', fecha_compromiso: '', fecha_terminada: '' }, campos));
}
function sembrarAna(db) {
  ['03', '04', '05'].forEach((d) => tarea(db, { titulo: 'Cerrada ' + d, fecha_compromiso: '2026-11-' + d + 'T00:00:00.000Z', estado: 'TERMINADA', fecha_terminada: '2026-11-' + d }));
  tarea(db, { titulo: 'Contrato de Montajes', fecha_compromiso: '2026-11-09T00:00:00.000Z' });
  tarea(db, { titulo: 'Finiquito de Taller Vega', fecha_compromiso: '2026-11-18T00:00:00.000Z' });
  tarea(db, { titulo: 'Ordenar carpeta', fecha_creacion: '2026-10-01T12:00:00.000Z' });
}

test('el mes que se informa: la primera semana va el mes anterior, cerrado', () => {
  assert.deepEqual(A.periodos_('2026-12-07'), { actual: '2026-12', principal: '2026-11', comparar: '2026-10', cerrado: true });
  assert.deepEqual(A.periodos_('2026-11-16'), { actual: '2026-11', principal: '2026-11', comparar: '2026-10', cerrado: false });
  assert.equal(A.lunesDe_('2026-11-19'), '2026-11-16');
  assert.equal(A.lunesDe_('2026-11-16'), '2026-11-16');
});

test('la persona recibe su índice, lo que vence esta semana, lo atrasado, lo dormido y lo sin fecha', () => {
  const db = crear(); sembrarAna(db);
  const avisos = A.armarAvisos(db, { hoy: LUNES });
  const ana = avisos.find((a) => a.destinatario === ANA && a.evento === A.EVENTO.PERSONA);
  assert.ok(ana, 'Ana recibe su aviso');
  assert.match(ana.cuerpo, /^Hola Ana:/);
  // 72 %: A 3 de 4 a tiempo (75 %) y D 2 de 3 abiertas con movimiento (una dormida).
  assert.match(ana.cuerpo, /Tu índice de cumplimiento de noviembre 2026, hasta hoy: 72 %/);
  assert.match(ana.cuerpo, /Vence esta semana:\n  • Finiquito de Taller Vega — 18 nov/);
  assert.match(ana.cuerpo, /Atrasado[^\n]*\n  • Contrato de Montajes — venció el 9 nov \(hace 7 días\)/);
  assert.match(ana.cuerpo, /Tareas dormidas[^\n]*\n  • Ordenar carpeta/);
  assert.match(ana.cuerpo, /Tareas sin fecha[^\n]*\n  • Ordenar carpeta/);
  assert.match(ana.asunto, /72 % · 2 pendientes/);
  assert.equal(ana.notif.modulo_id, 'mi_trabajo');
  assert.ok(!avisos.some((a) => a.destinatario === BETO && a.evento === A.EVENTO.PERSONA), 'Beto no tiene nada que medir: no le llega nada');
});

test('la jefatura recibe a su equipo en orden alfabético; gerencia recién desde el fin de la marcha blanca', () => {
  const db = crear(); sembrarAna(db);
  tarea(db, { responsable_email: BETO, titulo: 'Atrasada de Beto', fecha_compromiso: '2026-11-10T00:00:00.000Z' });
  const avisos = A.armarAvisos(db, { hoy: LUNES });
  const jefe = avisos.find((a) => a.destinatario === JEFE && a.evento === A.EVENTO.JEFATURA);
  assert.ok(jefe);
  assert.ok(jefe.cuerpo.indexOf('Ana Pérez') < jefe.cuerpo.indexOf('Beto Ríos'), 'orden alfabético, no ranking');
  assert.match(jefe.cuerpo, /Ana Pérez: 72 %[^\n]*1 atrasada/);
  assert.ok(!avisos.some((a) => a.evento === A.EVENTO.GERENCIA), 'el lunes 16 todavía es marcha blanca');
  const despues = A.armarAvisos(db, { hoy: A.GERENCIA_DESDE });
  const ger = despues.find((a) => a.destinatario === GER && a.evento === A.EVENTO.GERENCIA);
  assert.ok(ger, 'desde el 23 llega a gerencia');
  assert.match(ger.cuerpo, /Índice promedio/);
  assert.match(ger.cuerpo, /Las deudas más antiguas:\n  • Ana Pérez — Contrato de Montajes/);
});

test('se envía una sola vez por semana y queda en la campana', async (t) => {
  const Resend = require('../logica/resend');
  const orig = Resend.enviarCorreoResend_;
  const enviados = [];
  Resend.enviarCorreoResend_ = async (m) => { enviados.push(m.to[0]); return { id: 'x' }; };
  t.after(() => { Resend.enviarCorreoResend_ = orig; });
  const db = crear(); sembrarAna(db);
  const r1 = await A.enviarAvisoSemanal(db, { hoy: LUNES });
  const r2 = await A.enviarAvisoSemanal(db, { hoy: LUNES });
  assert.ok(r1.avisos >= 2);
  assert.ok(r2.resultados.every((x) => x.motivo === 'deduplicado'), 'la segunda vuelta no repite nada');
  assert.equal(enviados.length, r1.avisos, 'cada correo salió una sola vez');
  const log = leerFilas_(db, 'LOG_NOTIFICACIONES', COLUMNAS.LOG_NOTIFICACIONES).filter((f) => f.solicitud_id === 'CUMPLIMIENTO:' + LUNES);
  assert.equal(log.length, r1.avisos, 'un registro por aviso, no dos');
  const campana = leerFilas_(db, 'NOTIFICACIONES_APP', COLUMNAS.NOTIFICACIONES_APP).filter((f) => String(f.tipo).indexOf('CUMPLIMIENTO_') === 0);
  assert.equal(campana.length, r1.avisos);
});

test('solo Administración ve los avisos antes o los manda a mano', async () => {
  const db = crear(); sembrarAna(db);
  assert.ok(A.previsualizar(db, {}, { email: ANA, rol: 'DEV' })._forbidden);
  assert.ok((await A.enviarAhora(db, {}, { email: GER, rol: 'GERENCIA' }))._forbidden);
  const vista = A.previsualizar(db, { hoy: LUNES }, { email: 'adm@homepymes.cl', rol: 'ADM' });
  assert.ok(vista.avisos.some((a) => a.evento === A.EVENTO.GERENCIA), 'la vista previa muestra también el de gerencia');
  assert.equal(vista.semana, LUNES);
});
