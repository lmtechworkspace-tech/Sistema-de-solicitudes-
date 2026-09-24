'use strict';

/**
 * SIGSO v2, Módulo 3A — cola de la Bandeja por ÍTEM (Dashboard.getCola) y
 * la corrección del KPI "Sin asignar" de la bandeja clásica.
 *
 * El hallazgo que motiva esto: se asigna POR ÍTEM, pero el KPI clásico
 * contaba el campo de la solicitud (que nadie actualiza al asignar ítems) y
 * marcaba solicitudes con todos sus ítems asignados como "sin asignar".
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Dashboard = require('../logica/dashboard');

const ADM = { rol: 'ADM', email: 'admin@x.cl' };
const DEV = { rol: 'DEV', email: 'dev@x.cl' };
const GER = { rol: 'GERENCIA', email: 'ger@x.cl' };

function db_() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}
function sol(db, id, cabecera, items) {
  agregarFila_(db, 'SOLICITUDES', {
    solicitud_id: id, empresa_id: 'HP', estado_derivado: items[0].estado, prioridad_derivada: 'P3',
    fecha_creacion: new Date().toISOString(), desarrollador_asignado: cabecera || '', solicitante_email: 'cli@x.cl'
  });
  items.forEach((it, i) => agregarFila_(db, 'SUBSOLICITUDES', Object.assign({
    subsolicitud_id: id + '-0' + (i + 1), solicitud_id: id, numero_item: i + 1, titulo: 'Ítem ' + (i + 1),
    prioridad: 'P3', sla_objetivo_horas: 72, fecha_creacion: new Date().toISOString()
  }, it)));
}

test('getCola lista ítems (no solicitudes) y cuenta los KPIs sobre ítems', () => {
  const db = db_();
  sol(db, 'SOL-1', '', [{ estado: 'S01', desarrollador_asignado: 'dev@x.cl' }, { estado: 'S05', desarrollador_asignado: 'otro@x.cl', fecha_comprometida: '2026-12-01' }]);
  sol(db, 'SOL-2', '', [{ estado: 'S02' }]);
  sol(db, 'SOL-3', '', [{ estado: 'S08', desarrollador_asignado: 'dev@x.cl' }]);
  const r = Dashboard.getCola(db, {}, ADM);
  assert.equal(r.items.length, 4);
  assert.equal(r.resumen.abiertos, 3, 'S08 (terminada, por validar) no cuenta como abierto');
  assert.equal(r.resumen.por_revisar, 2, 'S01 y S02 sin triar');
  assert.equal(r.resumen.sin_asignar, 1, 'solo el ítem sin responsable propio ni de la solicitud');
  assert.equal(r.resumen.sin_fecha, 2);
  assert.equal(r.resumen.por_validar, 1);
});

test('getCola: el responsable de la solicitud se hereda al ítem sin responsable propio', () => {
  const db = db_();
  sol(db, 'SOL-1', 'dev@x.cl', [{ estado: 'S02' }]);
  const r = Dashboard.getCola(db, {}, ADM);
  assert.equal(r.items[0].asignado, 'dev@x.cl');
  assert.equal(r.items[0].asignado_heredado, true);
  assert.equal(r.resumen.sin_asignar, 0);
});

test('getCola: un DEV ve lo suyo (propio o heredado) y los huérfanos en trabajo; no lo de otros', () => {
  const db = db_();
  sol(db, 'SOL-1', '', [{ estado: 'S01', desarrollador_asignado: 'dev@x.cl' }, { estado: 'S05', desarrollador_asignado: 'otro@x.cl' }]);
  sol(db, 'SOL-2', 'dev@x.cl', [{ estado: 'S02' }]);
  sol(db, 'SOL-3', '', [{ estado: 'S05' }]); // huérfano en trabajo
  sol(db, 'SOL-4', '', [{ estado: 'S01' }]); // huérfano sin triar: no es de trabajo
  const ids = Dashboard.getCola(db, {}, DEV).items.map((i) => i.subsolicitud_id).sort();
  assert.deepEqual(ids, ['SOL-1-01', 'SOL-2-01', 'SOL-3-01']);
});

test('getCola: ADM puede ver la bandeja de una persona; Gerencia es solo lectura sin responsables', () => {
  const db = db_();
  sol(db, 'SOL-1', '', [{ estado: 'S05', desarrollador_asignado: 'dev@x.cl' }, { estado: 'S05', desarrollador_asignado: 'otro@x.cl' }]);
  assert.deepEqual(Dashboard.getCola(db, { verBandeja: 'otro@x.cl' }, ADM).items.map((i) => i.subsolicitud_id), ['SOL-1-02']);
  const g = Dashboard.getCola(db, {}, GER);
  assert.equal(g.solo_lectura, true);
  assert.deepEqual(g.responsables, []);
});

test('KPI clásico "Sin asignar": una solicitud con todos sus ítems asignados NO cuenta', () => {
  const db = db_();
  sol(db, 'SOL-1', '', [{ estado: 'S02', desarrollador_asignado: 'dev@x.cl' }, { estado: 'S05', desarrollador_asignado: 'otro@x.cl' }]);
  sol(db, 'SOL-2', '', [{ estado: 'S02' }]);
  const r = Dashboard.getData(db, {}, ADM);
  assert.equal(r.resumen.sin_asignar, 1, 'solo SOL-2 tiene un ítem sin nadie');
  const fila = r.recientes.find((x) => x.solicitud_id === 'SOL-1');
  assert.equal(fila.asignado_a, 'dev@x.cl', 'la fila muestra al responsable de sus ítems');
});

test('Un responsable que no es correo (texto de plantilla) cuenta como sin asignar', () => {
  const db = db_();
  sol(db, 'SOL-1', '[CORREO_LEO]', [{ estado: 'S02' }, { estado: 'S05' }]);
  const r = Dashboard.getCola(db, {}, ADM);
  assert.equal(r.resumen.sin_asignar, 2, 'nadie recibe "[CORREO_LEO]"');
  assert.equal(r.items[0].asignado, '');
  assert.equal(Dashboard.getData(db, {}, ADM).resumen.sin_asignar, 1);
});

// Módulo 3B: "Solicitudes a tu cargo" en Mi trabajo e Inicio.
test('solo_mios: solo lo ABIERTO asignado a mí (propio o heredado), sin huérfanos, para cualquier rol', () => {
  const db = db_();
  sol(db, 'SOL-1', '', [{ estado: 'S01', desarrollador_asignado: 'dev@x.cl' }, { estado: 'S05', desarrollador_asignado: 'otro@x.cl' }]);
  sol(db, 'SOL-2', 'dev@x.cl', [{ estado: 'S02' }, { estado: 'S08' }, { estado: 'S09' }]);
  sol(db, 'SOL-3', '', [{ estado: 'S05' }]); // huérfano en trabajo: la bandeja DEV lo muestra, "a tu cargo" no
  const ids = (ctx) => Dashboard.getCola(db, { solo_mios: true }, ctx).items.map((i) => i.subsolicitud_id).sort();
  assert.deepEqual(ids(DEV), ['SOL-1-01', 'SOL-2-01']);
  assert.deepEqual(ids({ rol: 'ADM', email: 'dev@x.cl' }), ['SOL-1-01', 'SOL-2-01'], 'ADM: lo suyo, no toda la bandeja');
  assert.deepEqual(ids(ADM), []);
  assert.deepEqual(Dashboard.getCola(db, { solo_mios: true }, DEV).responsables, []);
});

test('getInicio entrega el bloque mis_items (sin depender del módulo Bandeja)', () => {
  const Inicio = require('../logica/inicio');
  const db = db_();
  sol(db, 'SOL-1', '', [{ estado: 'S03', desarrollador_asignado: 'dev@x.cl' }]);
  const r = Inicio.getResumen(db, { bloques: ['mis_items'] }, Object.assign({ modulos: [] }, DEV));
  assert.equal(r.bloques.mis_items.ok, true);
  assert.deepEqual(r.bloques.mis_items.data.items.map((i) => i.subsolicitud_id), ['SOL-1-01']);
});
