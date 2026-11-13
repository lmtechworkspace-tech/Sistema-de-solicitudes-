'use strict';

/**
 * Índice de cumplimiento por responsable (Plan de control y certificación,
 * P3). Las reglas que el dueño aprobó: fecha original, reprogramación solo
 * si la hizo otra persona antes de vencer, entrega antes que validación,
 * bloqueo por otro neutro, lo que vence hoy no es atraso, mínimo 3 casos por
 * componente, señales de tareas sin fecha y dormidas, y quién ve qué.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const R = require('../logica/cumplimientoResponsables');

const ANA = 'ana@homepymes.cl';
const JEFE = 'jefe@homepymes.cl';
const OTRO = 'otro@homepymes.cl';
const HOY = '2026-11-20';

function crear() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  [[ANA, 'Ana'], [JEFE, 'Jefa'], [OTRO, 'Otro']].forEach(([email, nombre], i) =>
    agregarFila_(db, 'USUARIOS', { usuario_id: 'U' + i, nombre, email, rol: 'DEV', activo: true }));
  agregarFila_(db, 'JEFATURAS', { jefatura_id: 'J1', jefe_email: JEFE, subordinado_email: ANA, activo: true });
  return db;
}
let n = 0;
function tarea(db, campos) {
  const id = 'T' + (++n);
  agregarFila_(db, 'ACTIVIDADES', Object.assign({
    actividad_id: id, titulo: 'Tarea ' + id, responsable_email: ANA, estado: 'EN_CURSO', activa: true,
    fecha_creacion: '2026-10-01T12:00:00.000Z', fecha_compromiso: '', fecha_terminada: '', requiere_validacion: false
  }, campos));
  return id;
}
function evento(db, actividadId, tipo, timestamp, autor, datos) {
  agregarFila_(db, 'ACTIVIDADES_BITACORA', { bitacora_id: 'B' + (++n), actividad_id: actividadId, tipo, autor_email: autor || ANA,
    datos: datos ? JSON.stringify(datos) : '', timestamp });
}
const comp = (r, k) => r.componentes.find((c) => c.clave === k);

test('la fecha de una tarea: día de plan tal cual, instante real en hora de Chile', () => {
  assert.equal(R.diaPlan_('2026-11-10T00:00:00.000Z'), '2026-11-10');
  assert.equal(R.diaPlan_('2026-11-10'), '2026-11-10');
  assert.equal(R.diaReal_('2026-11-11T02:30:00.000Z'), '2026-11-10', 'las 23:30 de Chile siguen siendo el día 10');
  assert.equal(R.diaReal_('2026-11-10'), '2026-11-10', 'un día suelto no se corre al anterior');
  assert.deepEqual(R.periodo_('2026-02'), { periodo: '2026-02', desde: '2026-02-01', hasta: '2026-02-28', ci: '2026-M02' });
});

test('se mide contra la fecha original: reprogramarse a uno mismo o tarde no borra el atraso', () => {
  const db = crear();
  // 1) Reprogramada por la misma persona antes de vencer: la meta sigue siendo el 05.
  const t1 = tarea(db, { fecha_compromiso: '2026-11-15T00:00:00.000Z', estado: 'TERMINADA', fecha_terminada: '2026-11-14T15:00:00.000Z' });
  evento(db, t1, 'REPROGRAMACION', '2026-11-03T12:00:00.000Z', ANA, { fecha_anterior: '2026-11-05T00:00:00.000Z', fecha_nueva: '2026-11-15T00:00:00.000Z' });
  // 2) Reprogramada por la jefatura antes de vencer: cuenta, y se cumplió a tiempo.
  const t2 = tarea(db, { fecha_compromiso: '2026-11-12T00:00:00.000Z', estado: 'TERMINADA', fecha_terminada: '2026-11-11T15:00:00.000Z' });
  evento(db, t2, 'REPROGRAMACION', '2026-11-04T12:00:00.000Z', JEFE, { fecha_anterior: '2026-11-06T00:00:00.000Z', fecha_nueva: '2026-11-12T00:00:00.000Z' });
  // 3) Reprogramada por la jefatura DESPUÉS de vencer: no cuenta.
  const t3 = tarea(db, { fecha_compromiso: '2026-11-18T00:00:00.000Z', estado: 'TERMINADA', fecha_terminada: '2026-11-17T15:00:00.000Z' });
  evento(db, t3, 'REPROGRAMACION', '2026-11-09T12:00:00.000Z', JEFE, { fecha_anterior: '2026-11-07T00:00:00.000Z', fecha_nueva: '2026-11-18T00:00:00.000Z' });
  // 4) Sin reprogramar, cumplida a tiempo.
  tarea(db, { fecha_compromiso: '2026-11-10T00:00:00.000Z', estado: 'TERMINADA', fecha_terminada: '2026-11-10' });

  const r = R.calcularPersona_(db, ANA, '2026-11', { hoy: HOY });
  const A = comp(r, 'A');
  const de = (id) => A.detalle.find((x) => x.actividad_id === id);
  assert.equal(de(t1).meta, '2026-11-05'); assert.equal(de(t1).estado, 'Tarde');
  assert.equal(de(t2).meta, '2026-11-12'); assert.equal(de(t2).estado, 'A tiempo');
  assert.equal(de(t3).meta, '2026-11-07'); assert.equal(de(t3).estado, 'Tarde');
  assert.equal(A.casos, 4); assert.equal(A.cumplidos, 2); assert.equal(A.pct, 50);
  assert.equal(r.senales.reprogramaciones, 3);
  assert.equal(r.senales.reprogramaciones_que_no_cuentan, 2);
});

test('con validación cuenta el día en que la persona entregó; lo que vence hoy no es atraso; bloqueo por otro es neutro', () => {
  const db = crear();
  const v = tarea(db, { fecha_compromiso: '2026-11-10T00:00:00.000Z', estado: 'TERMINADA', requiere_validacion: true, fecha_terminada: '2026-11-16T12:00:00.000Z' });
  evento(db, v, 'ENTREGA', '2026-11-09T18:00:00.000Z', ANA);
  const rev = tarea(db, { fecha_compromiso: '2026-11-11T00:00:00.000Z', estado: 'EN_REVISION', requiere_validacion: true });
  evento(db, rev, 'ENTREGA', '2026-11-12T18:00:00.000Z', ANA);
  tarea(db, { fecha_compromiso: HOY + 'T00:00:00.000Z' }); // vence hoy, abierta
  const atrasada = tarea(db, { fecha_compromiso: '2026-11-13T00:00:00.000Z' });
  const bloq = tarea(db, { fecha_compromiso: '2026-11-14T00:00:00.000Z', estado: 'BLOQUEADA', bloqueo_responsable_email: OTRO, bloqueo_desde: '2026-11-12T12:00:00.000Z' });
  tarea(db, { fecha_compromiso: '2026-11-03T00:00:00.000Z', estado: 'CANCELADA' });

  const A = comp(R.calcularPersona_(db, ANA, '2026-11', { hoy: HOY }), 'A');
  const de = (id) => A.detalle.find((x) => x.actividad_id === id);
  assert.equal(de(v).estado, 'A tiempo', 'entregó el 09 aunque la aprobaron el 16');
  assert.equal(de(rev).estado, 'Tarde', 'entregó el 12 con meta el 11');
  assert.equal(de(atrasada).estado, 'Atrasada');
  assert.equal(A.casos, 3, 'la de hoy, la bloqueada por otro y la cancelada no cuentan');
  assert.equal(A.neutras.length, 1); assert.equal(A.neutras[0].actividad_id, bloq);
});

test('tareas sin fecha y dormidas se muestran siempre y la reportabilidad descuenta las dormidas', () => {
  const db = crear();
  tarea(db, { titulo: 'Sin fecha' });
  tarea(db, { titulo: 'Por confirmar', fecha_propuesta: '2026-11-30', confirmada_en: '' });
  const dormida = tarea(db, { titulo: 'Olvidada', fecha_compromiso: '2026-12-15T00:00:00.000Z' });
  evento(db, dormida, 'AVANCE', '2026-10-20T12:00:00.000Z', ANA);
  const viva = tarea(db, { titulo: 'Con movimiento', fecha_compromiso: '2026-12-15T00:00:00.000Z' });
  evento(db, viva, 'AVANCE', '2026-11-18T12:00:00.000Z', ANA);

  const r = R.calcularPersona_(db, ANA, '2026-11', { hoy: HOY });
  assert.equal(r.senales.sin_fecha, 1, 'la que espera confirmación no cuenta como sin fecha');
  assert.ok(r.senales.detalle_dormidas.some((d) => d.actividad_id === dormida && d.sin_movimiento_desde === '2026-10-20'));
  assert.ok(!r.senales.detalle_dormidas.some((d) => d.actividad_id === viva));
  const D = comp(r, 'D');
  assert.equal(D.casos, 4, 'las 4 abiertas al corte');
  assert.equal(D.detalle.filter((x) => x.estado === 'Dormida').length, 3, 'creadas el 01-10 sin movimiento propio: 3 dormidas');
});

test('el índice pondera solo componentes con 3 casos o más; sin ninguno no hay número', () => {
  const db = crear();
  // A: 4 casos, 3 a tiempo (75 %).
  ['05', '06', '07', '09'].forEach((d, i) => tarea(db, { fecha_compromiso: '2026-11-' + d + 'T00:00:00.000Z', estado: 'TERMINADA', fecha_terminada: i < 3 ? '2026-11-' + d : '2026-11-19' }));
  // C: 3 acuses con plazo en el mes, 2 a tiempo... sin audiencia no cuentan (no hay SGC sembrado) → C no aplica.
  const r = R.calcularPersona_(db, ANA, '2026-11', { hoy: HOY });
  assert.equal(comp(r, 'A').pct, 75);
  assert.equal(comp(r, 'A').aplica, true);
  assert.equal(comp(r, 'B').aplica, false);
  assert.equal(r.indice, 75, 'solo A aplica: el índice es el de A');
  assert.equal(r.estado, 'alerta');
  const vacia = R.calcularPersona_(crear(), OTRO, '2026-11', { hoy: HOY });
  assert.equal(vacia.indice, null);
  assert.equal(vacia.estado, 'sin_dato');
  assert.match(vacia.explicacion, /Sin datos suficientes/);
});

test('no conformidades: cada etapa con plazo en el mes cuenta para su responsable', () => {
  const db = crear();
  agregarFila_(db, 'SGC_NC', { nc_id: 'N1', correlativo: 'NC-2026-001', responsable_email: ANA, estado: 'EN_ACCION', activa: true,
    correccion_plazo: '2026-11-05', correccion_fecha_cierre: '2026-11-04T15:00:00.000Z', accion_plazo: '2026-11-15', accion_fecha_cierre: '' });
  agregarFila_(db, 'SGC_NC', { nc_id: 'N2', correlativo: 'NC-2026-002', responsable_email: ANA, estado: 'EN_VERIFICACION', activa: true,
    eficacia_plazo: '2026-11-12', eficacia_fecha: '2026-11-13' });
  const C = comp(R.calcularPersona_(db, ANA, '2026-11', { hoy: HOY }), 'C');
  assert.equal(C.casos, 3);
  assert.deepEqual(C.detalle.map((x) => x.estado).sort(), ['A tiempo', 'Sin hacer', 'Tarde']);
  assert.equal(C.aplica, true); assert.equal(C.pct, 33.3);
});

test('reporte mensual: el autor responde al día hábil 3 y la jefatura al 5', () => {
  const db = crear();
  agregarFila_(db, 'CI_MIEMBROS', { miembro_id: 'M1', depto: 'RRHH', usuario_email: ANA, rol: 'REGISTRA', activa: true });
  agregarFila_(db, 'CI_MIEMBROS', { miembro_id: 'M2', depto: 'RRHH', usuario_email: JEFE, rol: 'JEFATURA', activa: true });
  // Reporte de octubre: vence el día hábil 3 de noviembre (autor) y el 5 (jefatura).
  agregarFila_(db, 'DEP_REPORTES', { reporte_id: 'RP1', depto: 'RRHH', periodo: '2026-M10', tipo: 'MENSUAL', estado: 'VALIDADO', activa: true,
    fecha_envio: '2026-11-03T20:00:00.000Z', fecha_validacion: '2026-11-12T20:00:00.000Z' });
  const ana = comp(R.calcularPersona_(db, ANA, '2026-11', { hoy: HOY }), 'D').detalle.find((x) => /Enviar el reporte/.test(x.tipo));
  const jefe = comp(R.calcularPersona_(db, JEFE, '2026-11', { hoy: HOY }), 'D').detalle.find((x) => /Validar el reporte/.test(x.tipo));
  assert.equal(ana.estado, 'A tiempo');
  assert.equal(jefe.estado, 'Tarde');
});

test('obligaciones del área: las tareas internas de la Agenda vencidas sin marcar cuentan para quien registra en el área', () => {
  const db = crear();
  agregarFila_(db, 'CI_MIEMBROS', { miembro_id: 'M1', depto: 'CONTABILIDAD', usuario_email: ANA, rol: 'REGISTRA', activa: true });
  agregarFila_(db, 'CI_MIEMBROS', { miembro_id: 'M2', depto: 'CONTABILIDAD', usuario_email: OTRO, rol: 'LECTURA', activa: true });
  require('../logica/agendaDepto').asegurarPropuesta_(db);
  const B = comp(R.calcularPersona_(db, ANA, '2026-11', { hoy: HOY }), 'B');
  assert.ok(B.casos >= 1);
  assert.ok(B.detalle.every((x) => x.area === 'Contabilidad' && x.fecha < HOY));
  assert.ok(B.detalle.some((x) => x.estado === 'Sin hacer'));
  assert.equal(comp(R.calcularPersona_(db, OTRO, '2026-11', { hoy: HOY }), 'B').casos, 0, 'quien solo lee el área no responde por ella');
  assert.equal(comp(R.calcularPersona_(db, ANA, '2026-07', { hoy: HOY }), 'B').casos, 0, 'antes de octubre de 2026 no había Agenda: no se mide');
});

test('quién ve qué: lo propio, el equipo de la jefatura y la empresa solo gerencia', () => {
  const db = crear();
  tarea(db, { fecha_compromiso: '2026-11-05T00:00:00.000Z', estado: 'TERMINADA', fecha_terminada: '2026-11-05' });
  const ctxAna = { email: ANA, rol: 'DEV', modulos: [] };
  const ctxJefe = { email: JEFE, rol: 'DEV', modulos: [] };
  const ctxOtro = { email: OTRO, rol: 'DEV', modulos: [] };
  const ctxGer = { email: 'gerencia@homepymes.cl', rol: 'GERENCIA', modulos: [] };
  assert.equal(R.getCumplimiento(db, { periodo: '2026-11' }, ctxAna).email, ANA);
  assert.equal(R.getCumplimiento(db, { email: ANA, periodo: '2026-11' }, ctxJefe).email, ANA);
  assert.ok(R.getCumplimiento(db, { email: ANA }, ctxOtro)._forbidden, 'un compañero no ve a otro');
  assert.ok(R.getCumplimiento(db, { alcance: 'empresa' }, ctxJefe)._forbidden);
  const eq = R.getCumplimiento(db, { alcance: 'equipo', periodo: '2026-11' }, ctxJefe);
  assert.deepEqual(eq.personas.map((p) => p.email), [ANA]);
  assert.equal(eq.personas[0].componentes.length, 4);
  assert.equal(eq.personas[0].detalle, undefined, 'la lista no trae el detalle');
  const emp = R.getCumplimiento(db, { alcance: 'empresa', periodo: '2026-11' }, ctxGer);
  assert.ok(Array.isArray(emp.personas));
  assert.ok('indice_promedio' in emp.resumen);
  // El encargado del SGC también ve la empresa.
  agregarFila_(db, 'SGC_ROLES', { rol_id: 'R1', usuario_email: OTRO, rol_sgc: 'ENCARGADO_SGC', activo: true });
  assert.ok(!R.getCumplimiento(db, { alcance: 'empresa' }, ctxOtro)._forbidden);
});

test('tendencia: la persona trae 6 meses de índice y la lista el índice del mes anterior', () => {
  const db = crear();
  ['03', '04', '05'].forEach((d) => tarea(db, { fecha_compromiso: '2026-10-' + d + 'T00:00:00.000Z', estado: 'TERMINADA', fecha_terminada: '2026-10-' + d }));
  // Las de noviembre nacen en noviembre: en octubre no existían (si no, octubre las vería abiertas y dormidas).
  ['03', '04', '05', '06'].forEach((d, i) => tarea(db, { fecha_creacion: '2026-11-01T12:00:00.000Z', fecha_compromiso: '2026-11-' + d + 'T00:00:00.000Z', estado: 'TERMINADA', fecha_terminada: i ? '2026-11-' + d : '2026-11-10' }));
  assert.equal(R.moverPeriodo_('2026-01', -1), '2025-12');
  assert.equal(R.moverPeriodo_('2026-11', 2), '2027-01');
  const ctxAna = { email: ANA, rol: 'DEV', modulos: [] };
  const r = R.getCumplimiento(db, { periodo: '2026-11' }, ctxAna);
  assert.equal(r.historial.length, 6);
  assert.equal(r.historial[0].periodo, '2026-06');
  assert.equal(r.historial[5].periodo, '2026-11');
  assert.equal(r.historial[4].indice, 100, 'octubre: 3 de 3 a tiempo');
  const eq = R.getCumplimiento(db, { alcance: 'equipo', periodo: '2026-11' }, { email: JEFE, rol: 'DEV', modulos: [] });
  assert.equal(eq.personas[0].indice_anterior, 100);
  assert.equal(eq.resumen.periodo_anterior, '2026-10');
  assert.equal(eq.resumen.reparto.alerta + eq.resumen.reparto.ok + eq.resumen.reparto.critico + eq.resumen.reparto.sin_dato, eq.personas.length);
});

test('la acción está registrada en el router', () => {
  const texto = require('node:fs').readFileSync(require.resolve('../server/router'), 'utf8');
  assert.match(texto, /getCumplimientoResponsables: \(db, data, contexto\) => CumplimientoResponsables\.getCumplimiento/);
  assert.doesNotThrow(() => require('../server/router'));
});
