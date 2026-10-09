'use strict';

/**
 * D-005 (auditoría de Codex del ecosistema de clientes), tanda 2: defectos P2 del
 * servidor. Datos FICTICIOS, base en memoria, sin correos reales.
 *   E1-5 subidas simultáneas no superan el tope.
 *   E2-5 el aviso de fecha es por ítem y por fecha.
 *   E2-6 Gerencia ve toda la cola (solo lectura).
 *   E2-7 el reporte reconstruye el estado al corte (reaperturas, cambios posteriores).
 *   E2-8 un compromiso de día vence al fin de la jornada de Chile.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');

delete process.env.RESEND_API_KEY;

function db_() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  return db;
}
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');

test('E1-5: dos subidas simultáneas al último cupo — solo una lo toma', async (t) => {
  const db = db_();
  agregarFila_(db, 'SOLICITUDES', { solicitud_id: 'SOL-A', empresa_id: 'HP', solicitante_email: 'cli@demo.cl', fecha_creacion: '2026-10-01T12:00:00Z' });
  agregarFila_(db, 'SUBSOLICITUDES', { subsolicitud_id: 'SOL-A-01', solicitud_id: 'SOL-A', numero_item: 1, titulo: 'Ítem', estado: 'S05' });
  // Tope por ítem de documentos: 3. Ya hay 2.
  [1, 2].forEach((n) => agregarFila_(db, 'ARCHIVOS', { archivo_id: 'a' + n, solicitud_id: 'SOL-A', subsolicitud_id: 'SOL-A-01', nombre_original: n + '.pdf', tipo_mime: 'application/pdf', tamano_bytes: 10, fecha_subida: '2026-10-01T12:00:00Z', subido_por: '' }));
  const Alm = require('../logica/almacenamiento');
  const orig = Alm.subirArchivo_;
  let soltar; const espera = new Promise((r) => { soltar = r; });
  let subidas = 0;
  Alm.subirArchivo_ = async (clave) => { subidas++; await espera; return { ok: true, clave }; };
  t.after(() => { Alm.subirArchivo_ = orig; });
  const Archivos = require('../logica/archivosSolicitud');
  const pedir = () => Archivos.subirArchivo(db, { solicitud_id: 'SOL-A', subsolicitud_id: 'SOL-A-01', email: 'cli@demo.cl', nombre_archivo: 'x.pdf', contenido_base64: PDF });
  const p1 = pedir(), p2 = pedir();
  await new Promise((r) => setImmediate(r));
  soltar();
  const [r1, r2] = await Promise.all([p1, p2]);
  const ok = [r1, r2].filter((r) => r && r.archivo_id).length;
  assert.equal(ok, 1, 'una sola entra: ' + JSON.stringify([r1, r2]));
  assert.equal(subidas, 1, 'la otra ni siquiera sube al almacenamiento');
  assert.equal(leerFilas_(db, 'ARCHIVOS', COLUMNAS.ARCHIVOS).length, 3);
  // Si la subida falla, el cupo se libera.
  const db2 = db_();
  agregarFila_(db2, 'SOLICITUDES', { solicitud_id: 'SOL-B', empresa_id: 'HP', solicitante_email: 'cli@demo.cl' });
  Alm.subirArchivo_ = async () => ({ ok: false, message: 'almacenamiento caído (prueba)' });
  const f = await Archivos.subirArchivo(db2, { solicitud_id: 'SOL-B', email: 'cli@demo.cl', nombre_archivo: 'x.pdf', contenido_base64: PDF });
  assert.ok(!f.archivo_id);
  Alm.subirArchivo_ = async (clave) => ({ ok: true, clave });
  const g = await Archivos.subirArchivo(db2, { solicitud_id: 'SOL-B', email: 'cli@demo.cl', nombre_archivo: 'x.pdf', contenido_base64: PDF });
  assert.ok(g.archivo_id, 'tras el fallo, el cupo volvió');
});

test('E2-5: fechas de dos ítems de la misma solicitud → dos avisos; reintentar el mismo → no se duplica', async (t) => {
  const db = db_();
  const Resend = require('../logica/resend');
  const orig = Resend.enviarCorreoResend_;
  const enviados = [];
  Resend.enviarCorreoResend_ = async (m) => { enviados.push(m.subject + ' | ' + m.text.match(/Ítem: (\S+)/)[1]); return { id: 'x' }; };
  t.after(() => { Resend.enviarCorreoResend_ = orig; });
  const N = require('../logica/notificaciones');
  const sol = { solicitud_id: 'SOL-C', solicitante_email: 'cli@demo.cl', solicitante_nombre: 'Cliente Demo' };
  await N.avisarCompromisoFecha(db, sol, { subsolicitud_id: 'SOL-C-01', titulo: 'A' }, '2026-10-20');
  await N.avisarCompromisoFecha(db, sol, { subsolicitud_id: 'SOL-C-02', titulo: 'B' }, '2026-10-21');
  assert.equal(enviados.length, 2, 'cada ítem tiene su aviso');
  const r = await N.avisarCompromisoFecha(db, sol, { subsolicitud_id: 'SOL-C-01', titulo: 'A' }, '2026-10-20');
  assert.equal(r.motivo, 'deduplicado', 'el mismo aviso no se repite');
  await N.avisarCompromisoFecha(db, sol, { subsolicitud_id: 'SOL-C-01', titulo: 'A' }, '2026-10-23');
  assert.equal(enviados.length, 3, 'un nuevo compromiso del mismo ítem sí se avisa');
});

test('E2-6: Gerencia ve toda la cola y la de cada departamento, siempre en solo lectura', () => {
  const db = db_();
  const Dashboard = require('../logica/dashboard');
  const GER = { rol: 'GERENCIA', email: 'ger@demo.cl' };
  agregarFila_(db, 'SOLICITUDES', { solicitud_id: 'SOL-D', empresa_id: 'HP', estado_derivado: 'S05', prioridad_derivada: 'P3', fecha_creacion: new Date().toISOString(), solicitante_email: 'cli@demo.cl' });
  [['SOL-D-01', 'uno@demo.cl', 'RRHH'], ['SOL-D-02', 'dos@demo.cl', 'CONTABILIDAD'], ['SOL-D-03', '', 'RRHH']].forEach(([id, a, d], i) =>
    agregarFila_(db, 'SUBSOLICITUDES', { subsolicitud_id: id, solicitud_id: 'SOL-D', numero_item: i + 1, titulo: 'Ítem ' + i, estado: 'S05', prioridad: 'P3', desarrollador_asignado: a, depto: d, sla_objetivo_horas: 72, fecha_creacion: new Date().toISOString() }));
  const g = Dashboard.getCola(db, {}, GER);
  assert.deepEqual(g.items.map((i) => i.subsolicitud_id).sort(), ['SOL-D-01', 'SOL-D-02', 'SOL-D-03']);
  assert.equal(g.solo_lectura, true);
  assert.ok(g.items.every((i) => !i.puede_tomar && !i.puede_asignar), 'no toma ni reparte');
  const rrhh = Dashboard.getCola(db, { depto: 'RRHH' }, GER);
  assert.ok(!rrhh._forbidden, 'puede mirar la cola de un departamento');
  assert.deepEqual(rrhh.items.map((i) => i.subsolicitud_id).sort(), ['SOL-D-01', 'SOL-D-03']);
  assert.equal(rrhh.solo_lectura, true);
});

test('E2-7: resuelto → reabierto → resuelto; y una cancelación posterior no borra el pasado', () => {
  const db = db_();
  const R = require('../logica/reporteSolicitudes');
  agregarFila_(db, 'SUBSOLICITUDES', { subsolicitud_id: 'SOL-E-01', solicitud_id: 'SOL-E', numero_item: 1, titulo: 'Contrato', estado: 'S11', prioridad: 'P3', depto: 'RRHH', sla_objetivo_horas: 24, fecha_creacion: '2026-08-03T13:00:00Z' });
  [['S01', 'S05', '2026-08-03T14:00:00Z'], ['S05', 'S08', '2026-08-10T15:00:00Z'], ['S08', 'S05', '2026-09-02T15:00:00Z'], ['S05', 'S08', '2026-09-21T15:00:00Z'], ['S08', 'S11', '2026-10-05T15:00:00Z']]
    .forEach(([a, n, ts], k) => agregarFila_(db, 'HISTORIAL_ESTADOS', { historial_id: 'h' + k, solicitud_id: 'SOL-E', subsolicitud_id: 'SOL-E-01', estado_anterior: a, estado_nuevo: n, usuario: 'eq@demo.cl', timestamp: ts }));
  const lista = R.pedidos_(db).lista;
  const ago = R.agregar_(lista, '2026-M08', new Date('2026-08-31T23:00:00Z'));
  assert.equal(ago.resueltos, 1, 'agosto conserva su resolución aunque hoy esté cancelado');
  assert.equal(ago.abiertos, 0);
  const sep15 = R.agregar_(lista, '2026-M09', new Date('2026-09-15T23:00:00Z'));
  assert.equal(sep15.abiertos, 1, 'reabierto: a mediados de septiembre estaba abierto');
  assert.equal(sep15.atrasados, 1, 'y atrasado (sin contar el tiempo en que estuvo resuelto)');
  const sep = R.agregar_(lista, '2026-M09', new Date('2026-09-30T23:00:00Z'));
  assert.equal(sep.resueltos, 1, 'la segunda resolución cuenta en septiembre');
  assert.equal(sep.abiertos, 0);
  const oct = R.agregar_(lista, '2026-M10', new Date('2026-10-31T23:00:00Z'));
  assert.equal(oct.abiertos, 0, 'cancelado en octubre');
});

test('E2-8: un compromiso de DÍA vence a las 18:00 de Chile, no a la medianoche UTC', () => {
  const C = require('../logica/cumplimiento');
  const U = require('../logica/utils');
  assert.equal(U.venceCompromiso_('2026-10-20').toISOString(), '2026-10-20T21:00:00.000Z');
  assert.equal(U.venceCompromiso_('2026-10-20T15:30:00-03:00').toISOString(), '2026-10-20T18:30:00.000Z', 'con hora: tal cual');
  const item = { estado: 'S05', fecha_comprometida: '2026-10-20' };
  assert.notEqual(C.clasificar(item, new Date('2026-10-20T13:00:00Z')).codigo, 'ATRASADA_DESARROLLADOR', 'a las 10:00 del mismo día no está atrasado');
  assert.notEqual(C.clasificar(item, new Date('2026-10-20T20:30:00Z')).codigo, 'ATRASADA_DESARROLLADOR', 'a las 17:30 tampoco');
  assert.equal(C.clasificar(item, new Date('2026-10-20T21:30:00Z')).codigo, 'ATRASADA_DESARROLLADOR', 'a las 18:30 sí');
  assert.equal(C.clasificar({ estado: 'S09', fecha_comprometida: '2026-10-20', fecha_terminada: '2026-10-20T20:00:00Z' }).codigo, 'CERRADA_A_TIEMPO', 'terminado ese día por la tarde: a tiempo');
});

test('revisión T2-1: tomarlo en septiembre y cancelarlo en octubre no cambia el reporte de agosto', () => {
  const db = db_();
  const R = require('../logica/reporteSolicitudes');
  const { actualizarFilaPorId_ } = require('../db/sqliteRepo');
  agregarFila_(db, 'SUBSOLICITUDES', { subsolicitud_id: 'SOL-F-01', solicitud_id: 'SOL-F', numero_item: 1, titulo: 'Contrato', estado: 'S01', prioridad: 'P3', depto: 'RRHH', sla_objetivo_horas: 72, fecha_creacion: '2026-08-20T13:00:00Z' });
  const corte = R.finDePeriodo_ ? R.finDePeriodo_('2026-M08') : new Date('2026-09-01T03:59:59Z');
  const agosto = () => R.agregar_(R.pedidos_(db).lista, '2026-M08', corte);
  const antes = agosto();
  agregarFila_(db, 'HISTORIAL_ESTADOS', { historial_id: 't1', solicitud_id: 'SOL-F', subsolicitud_id: 'SOL-F-01', estado_anterior: 'S01', estado_nuevo: 'S05', usuario: 'eq@demo.cl', timestamp: '2026-09-03T14:00:00Z' });
  agregarFila_(db, 'HISTORIAL_ESTADOS', { historial_id: 't2', solicitud_id: 'SOL-F', subsolicitud_id: 'SOL-F-01', estado_anterior: 'S05', estado_nuevo: 'S11', usuario: 'eq@demo.cl', timestamp: '2026-10-02T14:00:00Z' });
  actualizarFilaPorId_(db, 'SUBSOLICITUDES', 'subsolicitud_id', 'SOL-F-01', { estado: 'S11' });
  assert.deepEqual(agosto(), antes, 'agosto queda igual');
  assert.equal(antes.recibidos, 1); assert.equal(antes.tomados, 0); assert.equal(antes.rechazados, 0); assert.equal(antes.abiertos, 1);
  const oct = R.agregar_(R.pedidos_(db).lista, '2026-M10', new Date('2026-10-31T12:00:00Z'));
  assert.equal(oct.abiertos, 0, 'en octubre ya no está abierto');
});

test('revisión T2-1: el mes de Chile termina a medianoche local también en invierno (UTC−4)', () => {
  const R = require('../logica/reporteSolicitudes');
  if (!R.finDePeriodo_) return;
  assert.equal(R.finDePeriodo_('2026-M06').toISOString(), '2026-07-01T03:59:59.000Z', 'junio: UTC−4');
  assert.equal(R.finDePeriodo_('2026-M11').toISOString(), '2026-12-01T02:59:59.000Z', 'noviembre: UTC−3');
});

test('revisión T2-2: la cola entrega el instante de vencimiento calculado en Chile', () => {
  const db = db_();
  const Dashboard = require('../logica/dashboard');
  agregarFila_(db, 'SOLICITUDES', { solicitud_id: 'SOL-G', empresa_id: 'HP', estado_derivado: 'S05', prioridad_derivada: 'P3', fecha_creacion: new Date().toISOString(), solicitante_email: 'cli@demo.cl' });
  agregarFila_(db, 'SUBSOLICITUDES', { subsolicitud_id: 'SOL-G-01', solicitud_id: 'SOL-G', numero_item: 1, titulo: 'X', estado: 'S05', prioridad: 'P3', desarrollador_asignado: 'adm@demo.cl', fecha_comprometida: '2026-10-20', sla_objetivo_horas: 72, fecha_creacion: new Date().toISOString() });
  const it = Dashboard.getCola(db, {}, { rol: 'ADM', email: 'adm@demo.cl' }).items[0];
  assert.equal(it.vence_compromiso, '2026-10-20T21:00:00.000Z');
});

test('revisión T2 H1: cambiar hoy la prioridad (plazo) y el responsable no reescribe agosto', () => {
  const db = db_();
  sembrarTabla_(db, 'CONFIG_SLA', COLUMNAS.CONFIG_SLA, [['P1', 2], ['P2', 24], ['P3', 100], ['P4', 120], ['P5', '']]);
  const R = require('../logica/reporteSolicitudes');
  const BO = require('../logica/solicitudesBackoffice');
  const ADM = { rol: 'ADM', email: 'adm@demo.cl', emails: ['adm@demo.cl'] };
  agregarFila_(db, 'SOLICITUDES', { solicitud_id: 'SOL-H', empresa_id: 'HP', fecha_creacion: '2026-08-03T13:00:00Z', solicitante_email: 'cli@demo.cl' });
  agregarFila_(db, 'SUBSOLICITUDES', { subsolicitud_id: 'SOL-H-01', solicitud_id: 'SOL-H', numero_item: 1, titulo: 'Contrato', estado: 'S08', prioridad: 'P3', depto: 'RRHH', sla_objetivo_horas: 100, desarrollador_asignado: 'ana@demo.cl', fecha_creacion: '2026-08-03T13:00:00Z' });
  [['S01', 'S05', '2026-08-03T14:00:00Z'], ['S05', 'S08', '2026-08-10T15:00:00Z']].forEach(([a, n, ts], k) =>
    agregarFila_(db, 'HISTORIAL_ESTADOS', { historial_id: 'hh' + k, solicitud_id: 'SOL-H', subsolicitud_id: 'SOL-H-01', estado_anterior: a, estado_nuevo: n, usuario: 'ana@demo.cl', timestamp: ts }));
  const agosto = () => R.reporte(db, { depto: 'RRHH', periodo: '2026-M08' }, ADM);
  const antes = agosto();
  assert.equal(antes.total.a_tiempo, 1, 'resuelto a tiempo con el plazo de 100 h');
  assert.deepEqual(antes.por_persona.map((x) => x.clave), ['ana@demo.cl']);
  let r = BO.actualizarPrioridad(db, { subsolicitud_id: 'SOL-H-01', prioridad_nueva: 'P1', justificacion: 'Lo pidió gerencia por un reclamo del cliente' }, ADM);
  assert.ok(!r._forbidden && !r._validationError, JSON.stringify(r));
  r = BO.actualizarPrioridad(db, { solicitud_id: 'SOL-H', subsolicitud_id: 'SOL-H-01', desarrollador_asignado: 'beto@demo.cl' }, ADM);
  assert.ok(!r._forbidden && !r._validationError, JSON.stringify(r));
  const despues = agosto();
  assert.equal(despues.total.a_tiempo, 1, 'agosto sigue «a tiempo» aunque hoy el plazo sea 2 h');
  assert.equal(despues.total.con_dato_actual, 0, 'con historial completo no hay datos de hoy');
  assert.deepEqual(despues.por_persona.map((x) => x.clave), ['ana@demo.cl'], 'y sigue siendo de Ana');
  const h = leerFilas_(db, 'HISTORIAL_PRIORIDAD', COLUMNAS.HISTORIAL_PRIORIDAD)[0];
  assert.equal(String(h.sla_anterior_horas), '100'); assert.equal(String(h.sla_nuevo_horas), '2');
  assert.equal(leerFilas_(db, 'HISTORIAL_ASIGNACION', COLUMNAS.HISTORIAL_ASIGNACION).length, 1, 'la reasignación queda anotada');
});
