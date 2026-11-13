'use strict';

/**
 * Reunión semanal de coordinación (Plan de control, P5): agenda automática,
 * causa y cobertura obligatorias para cerrar, acuerdos como tareas, acta por
 * correo, compromisos que vuelven a vencer y permisos.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const RC = require('../logica/reunionCoordinacion');

const SGC = { email: 'luis@homepymes.cl', rol: 'DEV', modulos: [] };
const JEFE = { email: 'jefa@homepymes.cl', rol: 'DEV', modulos: [] };
const OTRA = { email: 'otra@homepymes.cl', rol: 'DEV', modulos: [] };
const ANA = 'ana@homepymes.cl';

function crear() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  agregarFila_(db, 'SGC_ROLES', { rol_id: 'R1', usuario_email: SGC.email, rol_sgc: 'ENCARGADO_SGC', activo: true });
  [[ANA, 'Ana Pérez'], [JEFE.email, 'Jefa Uno'], [SGC.email, 'Luis']].forEach(([e, n], i) => agregarFila_(db, 'USUARIOS', { usuario_id: 'U' + i, nombre: n, email: e, rol: 'DEV', activo: true }));
  agregarFila_(db, 'JEFATURAS', { jefatura_id: 'J1', jefe_email: JEFE.email, subordinado_email: ANA, activo: true });
  return db;
}
function tarea(db, campos) {
  const id = 'T' + Math.random().toString(36).slice(2, 8);
  agregarFila_(db, 'ACTIVIDADES', Object.assign({ actividad_id: id, titulo: 'Tarea', responsable_email: ANA, estado: 'EN_CURSO', activa: true,
    fecha_creacion: '2026-11-01T12:00:00.000Z', fecha_compromiso: '', fecha_terminada: '' }, campos));
  return id;
}

test('la agenda trae atrasos (fecha original), lo de la semana y las NC vencidas', () => {
  const db = crear();
  const atrasada = tarea(db, { titulo: 'Contrato de Montajes', fecha_compromiso: '2026-11-09T00:00:00.000Z' });
  // Reprogramada por la misma persona: sigue atrasada contra el 05.
  const reprog = tarea(db, { titulo: 'Finiquito', fecha_compromiso: '2026-11-30T00:00:00.000Z' });
  agregarFila_(db, 'ACTIVIDADES_BITACORA', { bitacora_id: 'B1', actividad_id: reprog, tipo: 'REPROGRAMACION', autor_email: ANA,
    datos: JSON.stringify({ fecha_anterior: '2026-11-05T00:00:00.000Z', fecha_nueva: '2026-11-30T00:00:00.000Z' }), timestamp: '2026-11-04T12:00:00.000Z' });
  tarea(db, { titulo: 'Anexos', fecha_compromiso: '2026-11-19T00:00:00.000Z' });
  tarea(db, { titulo: 'Terminada', fecha_compromiso: '2026-11-03T00:00:00.000Z', estado: 'TERMINADA', fecha_terminada: '2026-11-03' });
  agregarFila_(db, 'SGC_NC', { nc_id: 'N1', correlativo: 'NC-AP-2026-02', responsable_email: ANA, estado: 'EN_ACCION', accion_plazo: '2026-11-10', accion_fecha_cierre: '', activa: true });
  const items = RC.armarAgenda_(db, '2026-11-16');
  const de = (t) => items.find((i) => i.titulo === t);
  assert.equal(de('Contrato de Montajes').tipo, 'ATRASO');
  assert.equal(de('Contrato de Montajes').dias, 7);
  assert.equal(de('Finiquito').tipo, 'ATRASO', 'reprogramarse a uno mismo no lo saca de la agenda');
  assert.equal(de('Finiquito').meta, '2026-11-05');
  assert.equal(de('Anexos').tipo, 'SEMANA');
  assert.ok(!de('Terminada'));
  assert.ok(items.some((i) => i.origen === 'NC' && /NC-AP-2026-02 · Acción correctiva/.test(i.titulo)));
  assert.ok(atrasada);
});

test('no se cierra sin causa y cobertura de cada atraso ni sin asistencia; el acta sale por correo', async (t) => {
  const Resend = require('../logica/resend');
  const orig = Resend.enviarCorreoResend_;
  const enviados = [];
  Resend.enviarCorreoResend_ = async (m) => { enviados.push({ to: m.to[0], texto: m.text }); return { id: 'x' }; };
  t.after(() => { Resend.enviarCorreoResend_ = orig; });
  const db = crear();
  tarea(db, { titulo: 'Contrato de Montajes', fecha_compromiso: '2026-11-09T00:00:00.000Z' });
  const r = RC.crear(db, { fecha: '2026-11-16' }, SGC);
  assert.ok(r.reunion.reunion_id);
  assert.match(r.reunion.correlativo, /^RC-2026-01$/);
  assert.ok(r.reunion.participantes.some((p) => p.email === JEFE.email), 'las jefaturas quedan invitadas');
  assert.ok(RC.crear(db, {}, SGC)._validationError, 'una reunión abierta a la vez');
  const v = RC.obtener(db, { reunion_id: r.reunion.reunion_id }, SGC);
  const item = v.items.find((i) => i.tipo === 'ATRASO');
  assert.equal(v.pendientes_de_explicar, 1);
  let c = await RC.cerrar(db, { reunion_id: r.reunion.reunion_id }, SGC);
  assert.match(c.message, /1 atraso no tiene su causa/);
  assert.ok(RC.guardarItem(db, { item_id: item.item_id, causa: 'INVENTADA' }, SGC)._validationError);
  RC.guardarItem(db, { item_id: item.item_id, causa: 'FALTA_INFO_CLIENTE', como_se_cubre: 'Se pide el contrato al cliente', nueva_fecha: '2026-11-20' }, SGC);
  c = await RC.cerrar(db, { reunion_id: r.reunion.reunion_id }, SGC);
  assert.match(c.message, /quiénes asistieron/);
  RC.guardarAsistencia(db, { reunion_id: r.reunion.reunion_id, participantes: [{ email: JEFE.email, asistio: true }, { email: SGC.email, asistio: true }] }, SGC);
  const acuerdo = await RC.agregarAcuerdo(db, { reunion_id: r.reunion.reunion_id, texto: 'Llamar al cliente por el contrato', responsable_email: ANA, fecha_compromiso: '2026-11-18' }, SGC);
  assert.ok(acuerdo.actividad_id, JSON.stringify(acuerdo));
  const act = leerFilas_(db, 'ACTIVIDADES', COLUMNAS.ACTIVIDADES).find((a) => a.actividad_id === acuerdo.actividad_id);
  assert.equal(act.sgc_origen_tipo, 'REUNION_COORD');
  c = await RC.cerrar(db, { reunion_id: r.reunion.reunion_id, minuta: 'Se revisó la semana.' }, SGC);
  assert.equal(c.reunion.estado, 'CERRADA');
  assert.match(c.acta, /Por qué: Falta información del cliente\. Cómo se cubre: Se pide el contrato al cliente · nueva fecha 20 nov/);
  assert.match(c.acta, /Acuerdos[^\n]*\n  • Llamar al cliente por el contrato — Ana Pérez, para el 18 nov/);
  assert.match(c.acta, /Causas de esta semana: Falta información del cliente \(1\)/);
  assert.ok(enviados.some((e) => e.to === JEFE.email));
  assert.ok(RC.guardarItem(db, { item_id: item.item_id, causa: 'OLVIDO' }, SGC)._validationError, 'cerrada no se toca');
  // La estadística de causas.
  const l = RC.listar(db, {}, SGC);
  assert.deepEqual(l.estadistica.causas.map((x) => [x.clave, x.n]), [['FALTA_INFO_CLIENTE', 1]]);
  // La semana siguiente: el compromiso volvió a vencer y sigue abierto → COMPROMISO.
  const sig = RC.armarAgenda_(db, '2026-11-23');
  const comp = sig.find((i) => i.titulo === 'Contrato de Montajes');
  assert.equal(comp.tipo, 'COMPROMISO');
  assert.match(comp.detalle, /se comprometió para el 20 nov/);
});

test('permisos: conduce Control/gerencia, la jefatura solo ve, el resto no entra', () => {
  const db = crear();
  assert.ok(RC.crear(db, {}, JEFE)._forbidden);
  assert.ok(RC.listar(db, {}, OTRA)._forbidden);
  assert.equal(RC.listar(db, {}, JEFE).puede_gestionar, false);
  assert.equal(RC.listar(db, {}, { email: 'g@h.cl', rol: 'GERENCIA', modulos: [] }).puede_gestionar, true);
});
