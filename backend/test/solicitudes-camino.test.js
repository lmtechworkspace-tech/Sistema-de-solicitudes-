'use strict';

/**
 * El camino del ítem (2026-10-07, decisiones del dueño tras los comentarios
 * de Leo): Recibido → Con fecha → En curso → Resuelto → Confirmado.
 *  - «Recibir y dar fecha» en un solo paso, para uno o varios ítems (D3, D4),
 *    con UN aviso a quien pidió.
 *  - Resolver sin haber recibido ni dado fecha completa lo que faltó (D2).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Solicitudes = require('../logica/solicitudes');
const BO = require('../logica/solicitudesBackoffice');

delete process.env.RESEND_API_KEY;

const LEO = 'lestay@rld.cl', PIDE = 'ventas@grupohb.cl', OTRO = 'otro@rld.cl';
function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  sembrarTabla_(db, 'CONFIG_SLA', COLUMNAS.CONFIG_SLA, [['P1', 2], ['P2', 24], ['P3', 72], ['P4', 120], ['P5', '']]);
  sembrarTabla_(db, 'CAT_EMPRESAS', COLUMNAS.CAT_EMPRESAS, [['HP', 'HomePymes', '', true, '']]);
  const vacio = (hoja) => Object.fromEntries(COLUMNAS[hoja].map((c) => [c, '']));
  [['Leo Estay', LEO, 'DEV'], ['Valentina Caballero', PIDE, 'SOLICITANTE'], ['Otro', OTRO, 'DEV']].forEach(([n, e, r]) => agregarFila_(db, 'CUENTAS_PORTAL',
    Object.assign(vacio('CUENTAS_PORTAL'), { cuenta_id: 'c-' + e, usuario: e.split('@')[0], nombre: n, emails: JSON.stringify([e]), rol: r, activo: true, empresa_id: 'HP' })));
  agregarFila_(db, 'CAT_AREAS', { area_id: 'AREA_DEV', nombre: 'DESARROLADOR_LEO', responsable_email: LEO, activo: true });
  return db;
}
const ctx = (email) => ({ email, rol: 'DEV', rol_origen: 'DEV' });
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
async function solicitudDeTres(db) {
  const r = await Solicitudes.crearSolicitud(db, {
    empresa_id: 'HP', asociada_plataforma: false, area: 'AREA_DEV', solicitante_nombre: 'Valentina Caballero', solicitante_cargo: 'Comercial', solicitante_email: PIDE,
    subsolicitudes: ['Mejora en el área de tareas', 'Alertas', 'Registro de llamadas'].map((t) => ({ titulo: t, descripcion: 'Detalle de ' + t + '.', tipo: 'MEJ', impacto: 'MEDIO' }))
  });
  assert.ok(r.solicitud_id, JSON.stringify(r));
  return r.solicitud_id;
}
const item = (db, id) => filas(db, 'SUBSOLICITUDES').find((s) => s.subsolicitud_id === id);

test('«Recibir y dar fecha» deja cada ítem Recibido con su fecha y manda UN aviso con todo', async () => {
  const db = dbConSchema();
  const sol = await solicitudDeTres(db);
  const antes = filas(db, 'LOG_NOTIFICACIONES').length;
  const r = await BO.recibirItems(db, { solicitud_id: sol, items: [
    { subsolicitud_id: sol + '-01', fecha_comprometida: '2026-10-15' }, { subsolicitud_id: sol + '-02', fecha_comprometida: '2026-10-20' }] }, ctx(LEO));
  assert.equal(r.recibidos, 2, JSON.stringify(r));
  assert.equal(item(db, sol + '-01').estado, 'S02');
  assert.equal(item(db, sol + '-01').fecha_comprometida, '2026-10-15');
  assert.equal(item(db, sol + '-02').fecha_comprometida, '2026-10-20');
  assert.equal(item(db, sol + '-03').estado, 'S01', 'el que no se eligió sigue Nuevo');
  const nuevos = filas(db, 'LOG_NOTIFICACIONES').slice(antes).filter((n) => n.destinatario === PIDE);
  assert.equal(nuevos.length, 1, 'un solo aviso a quien pidió: ' + nuevos.map((n) => n.evento).join(', '));
  assert.match(nuevos[0].asunto, /Leo Estay recibió tu solicitud/);
  assert.match(nuevos[0].cuerpo, /Mejora en el área de tareas: estará para el 15-10-2026/);
  assert.match(nuevos[0].cuerpo, /Alertas: estará para el 20-10-2026/);
  // Empezar después (Recibida → En curso) no repite el aviso de «en curso».
  BO.actualizarEstado(db, { subsolicitud_id: sol + '-01', estado_nuevo: 'S05', comentario: '' }, ctx(LEO));
  assert.equal(filas(db, 'LOG_NOTIFICACIONES').filter((n) => n.destinatario === PIDE && /^HITO:EN_CURSO/.test(n.evento)).length, 0);
});

test('«Recibir y dar fecha» pide la fecha, no mueve una fecha ya comprometida y no toca ítems cerrados ni ajenos', async () => {
  const db = dbConSchema();
  const sol = await solicitudDeTres(db);
  const sinFecha = await BO.recibirItems(db, { solicitud_id: sol, items: [{ subsolicitud_id: sol + '-01' }] }, ctx(LEO));
  assert.ok(sinFecha._validationError);
  await BO.comprometerFecha(db, { subsolicitud_id: sol + '-02', fecha_comprometida: '2026-10-12' }, ctx(LEO));
  await BO.recibirItems(db, { solicitud_id: sol, items: [{ subsolicitud_id: sol + '-02', fecha_comprometida: '2026-11-30' }] }, ctx(LEO));
  assert.equal(item(db, sol + '-02').fecha_comprometida, '2026-10-12', 'una fecha ya comprometida se mueve con motivo, no aquí');
  assert.equal(item(db, sol + '-02').estado, 'S02');
  BO.actualizarEstado(db, { subsolicitud_id: sol + '-03', estado_nuevo: 'S08', comentario: '' }, ctx(LEO));
  assert.ok((await BO.recibirItems(db, { solicitud_id: sol, items: [{ subsolicitud_id: sol + '-03', fecha_comprometida: '2026-10-15' }] }, ctx(LEO)))._validationError, 'resuelto: ya no se recibe');
  assert.ok((await BO.recibirItems(db, { solicitud_id: 'SOL-NO', items: [{ subsolicitud_id: sol + '-01', fecha_comprometida: '2026-10-15' }] }, ctx(LEO)))._validationError);
  assert.ok((await BO.recibirItems(db, { solicitud_id: sol, items: [] }, ctx(LEO)))._validationError);
  assert.ok((await BO.recibirItems(db, { solicitud_id: sol, items: [{ subsolicitud_id: sol + '-01', fecha_comprometida: '2026-10-15' }] }, { email: 'g@x.cl', rol: 'GERENCIA' }))._forbidden);
});

test('resolver sin haber recibido ni dado fecha completa lo que faltó (el caso de «Registro de llamadas»)', async () => {
  const db = dbConSchema();
  const sol = await solicitudDeTres(db);
  const r = BO.actualizarEstado(db, { subsolicitud_id: sol + '-03', estado_nuevo: 'S08', comentario: 'Listo el registro.', comentario_al_solicitante: true }, ctx(LEO));
  assert.deepEqual(r.completado, ['recepcion', 'fecha']);
  const it = item(db, sol + '-03');
  assert.equal(it.estado, 'S08');
  // D-005 E2-8: el día de CHILE (entre las 21:00 y las 24:00 el día UTC ya es mañana).
  assert.equal(it.fecha_comprometida, require('../logica/utils').claveDia_(new Date(), 'America/Santiago'));
  assert.equal(it.comprometida_por, LEO);
  const h = filas(db, 'HISTORIAL_ESTADOS').filter((x) => x.subsolicitud_id === sol + '-03').pop();
  assert.match(h.comentario, /Se completó al resolver \(mismo día\): recibido, fecha comprometida hoy/);
  // Con todo el camino hecho, no se completa nada.
  await BO.recibirItems(db, { solicitud_id: sol, items: [{ subsolicitud_id: sol + '-01', fecha_comprometida: '2026-10-15' }] }, ctx(LEO));
  BO.actualizarEstado(db, { subsolicitud_id: sol + '-01', estado_nuevo: 'S05', comentario: '' }, ctx(LEO));
  assert.deepEqual(BO.actualizarEstado(db, { subsolicitud_id: sol + '-01', estado_nuevo: 'S08', comentario: '' }, ctx(LEO)).completado, []);
  assert.equal(item(db, sol + '-01').fecha_comprometida, '2026-10-15');
});
