'use strict';

/**
 * D-005 (auditoría de Codex del ecosistema de clientes, 2026-10-08), tanda 1:
 * defectos P1 de la Bandeja. Datos FICTICIOS, base en memoria, sin correos.
 *   E2-1 una sola regla de escritura por ítem (LECTURA, JEFATURA global).
 *   E2-2 la conversación respeta esa regla y la relación solicitud/ítem.
 *   E2-3 el SLA de la cola no corre mientras se espera al solicitante (S06).
 *   E2-4 la respuesta pendiente se calcula por ítem y por autor.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Hash = require('../logica/passwordHash');
const Cumplimiento = require('../logica/cumplimiento');
const { ejecutarAccion } = require('../server/router');

const CLAVE = 'Clave-Demo-123';

function preparar() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  sembrarTabla_(db, 'CONFIG_SLA', COLUMNAS.CONFIG_SLA, [['P1', 2], ['P2', 24], ['P3', 72], ['P4', 120], ['P5', '']]);
  const cuenta = (id, usuario, rol, email) => {
    const salt = Hash.generarSalt();
    agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: id, usuario, nombre: usuario, emails: JSON.stringify([email]), rol, modulos: '["bandeja"]',
      empresa_id: 'HP', activo: true, salt, hash_password: Hash.hashPassword(CLAVE, salt), debe_cambiar_password: false });
  };
  cuenta('C-LEC', 'lectora', 'SOLICITANTE', 'lectora@demo.cl');   // LECTURA en RRHH, con un ítem asignado
  cuenta('C-JEF', 'jefa', 'JEFATURA', 'jefa@demo.cl');            // jefatura global de su equipo
  cuenta('C-SUB', 'subordinado', 'DEV', 'subordinado@demo.cl');   // del equipo de la jefa
  cuenta('C-DEV', 'planta', 'DEV', 'planta@demo.cl');             // personal de planta (D-001)
  cuenta('C-JRR', 'jefarrhh', 'SOLICITANTE', 'jefarrhh@demo.cl'); // JEFATURA del departamento RRHH
  cuenta('C-GER', 'gerencia', 'GERENCIA', 'gerencia@demo.cl');
  cuenta('C-ADM', 'admin', 'ADM', 'admin@demo.cl');
  agregarFila_(db, 'CI_MIEMBROS', { miembro_id: 'm1', depto: 'RRHH', usuario_email: 'lectora@demo.cl', rol: 'LECTURA', activa: true });
  agregarFila_(db, 'CI_MIEMBROS', { miembro_id: 'm2', depto: 'RRHH', usuario_email: 'jefarrhh@demo.cl', rol: 'JEFATURA', activa: true });
  agregarFila_(db, 'JEFATURAS', { jefatura_id: 'j1', jefe_email: 'jefa@demo.cl', subordinado_email: 'subordinado@demo.cl', activo: true });
  const sol = (id, email) => agregarFila_(db, 'SOLICITUDES', { solicitud_id: id, empresa_id: 'HP', empresa_nombre: 'HP', solicitante_nombre: 'Cliente', solicitante_email: email, estado_derivado: 'S05', prioridad_derivada: 'P3', fecha_creacion: '2026-10-01T12:00:00Z' });
  const item = (sub, id, asignado, depto, extra) => agregarFila_(db, 'SUBSOLICITUDES', Object.assign({ subsolicitud_id: sub, solicitud_id: id, numero_item: Number(sub.slice(-1)), titulo: 'Ítem ' + sub, descripcion: 'Descripción de prueba suficientemente larga.', estado: 'S05', prioridad: 'P3', desarrollador_asignado: asignado, depto: depto || '', tipo: 'MEJ', sla_objetivo_horas: 72, fecha_creacion: '2026-10-01T12:00:00Z' }, extra || {}));
  sol('SOL-R', 'cliente@demo.cl'); item('SOL-R-1', 'SOL-R', 'lectora@demo.cl', 'RRHH');         // RRHH, asignado a la LECTURA
  sol('SOL-E', 'cliente@demo.cl'); item('SOL-E-1', 'SOL-E', 'subordinado@demo.cl', '');           // del equipo de la jefa
  sol('SOL-O', 'otro@demo.cl'); item('SOL-O-1', 'SOL-O', 'planta@demo.cl', 'CONTABILIDAD');       // ajeno a la jefa
  return db;
}
async function login(db, usuario) {
  const r = await ejecutarAccion(db, 'portalLogin', { usuario, password: CLAVE }, { ip: '10.0.0.1' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data.token;
}
const llamar = (db, accion, token, extra) => ejecutarAccion(db, accion, Object.assign({ portal_token: token }, extra || {}), { ip: '10.0.0.9' });
const estadoDe = (db, id) => leerFilas_(db, 'SUBSOLICITUDES', COLUMNAS.SUBSOLICITUDES).find((s) => s.subsolicitud_id === id).estado;
const FECHA = { fecha_comprometida: '2026-10-20T18:00:00-03:00' };

test('E2-1: LECTURA no escribe aunque tenga el ítem asignado; la JEFATURA del depto sí', async () => {
  const db = preparar();
  const tLec = await login(db, 'lectora');
  const tJrr = await login(db, 'jefarrhh');
  for (const [accion, extra] of [['actualizarEstado', { estado_nuevo: 'S08', comentario: 'listo' }], ['comprometerFecha', FECHA],
    ['editarContenidoSubsolicitud', { titulo: 'Nuevo', descripcion: 'Descripción de prueba suficientemente larga.' }]]) {
    const r = await llamar(db, accion, tLec, Object.assign({ subsolicitud_id: 'SOL-R-1' }, extra));
    assert.equal(r.status, 403, accion + ': ' + JSON.stringify(r.body));
  }
  assert.equal(estadoDe(db, 'SOL-R-1'), 'S05', 'sin cambios');
  assert.equal((await llamar(db, 'comprometerFecha', tJrr, Object.assign({ subsolicitud_id: 'SOL-R-1' }, FECHA))).status, 200, 'la jefatura del departamento sí');
});

test('E2-1: una JEFATURA global escribe en lo de su equipo, no en lo ajeno; la planta sigue cubriendo (D-001)', async () => {
  const db = preparar();
  const tJef = await login(db, 'jefa');
  const tDev = await login(db, 'planta');
  assert.equal((await llamar(db, 'comprometerFecha', tJef, Object.assign({ subsolicitud_id: 'SOL-E-1' }, FECHA))).status, 200, 'de su equipo');
  const ajeno = await llamar(db, 'comprometerFecha', tJef, Object.assign({ subsolicitud_id: 'SOL-O-1' }, FECHA));
  assert.equal(ajeno.status, 403, JSON.stringify(ajeno.body));
  const deriva = await llamar(db, 'derivarSolicitud', tJef, { solicitud_id: 'SOL-O', responsable_nuevo: 'jefa@demo.cl', motivo: 'Me lo llevo para revisarlo' });
  assert.equal(deriva.status, 403, 'tampoco deriva lo ajeno');
  const cubre = await llamar(db, 'comprometerFecha', tDev, Object.assign({ subsolicitud_id: 'SOL-E-1', motivo: 'El cliente pidió cambiar la fecha', motivo_cambio: 'El cliente pidió cambiar la fecha' }, FECHA, { fecha_comprometida: '2026-10-22T18:00:00-03:00' }));
  assert.equal(cubre.status, 200, 'la planta cubre a un compañero: ' + JSON.stringify(cubre.body));
});

test('E2-2: la conversación respeta la regla de escritura y la relación solicitud/ítem', async () => {
  const db = preparar();
  const tLec = await login(db, 'lectora');
  const tJef = await login(db, 'jefa');
  const tGer = await login(db, 'gerencia');
  const tDev = await login(db, 'planta');
  const antes = leerFilas_(db, 'COMENTARIOS', COLUMNAS.COMENTARIOS).length;
  assert.equal((await llamar(db, 'agregarComentario', tLec, { solicitud_id: 'SOL-R', subsolicitud_id: 'SOL-R-1', texto: 'hola' })).status, 403, 'LECTURA');
  assert.equal((await llamar(db, 'agregarComentario', tLec, { solicitud_id: 'SOL-O', texto: 'hola' })).status, 403, 'SOLICITANTE en solicitud ajena');
  assert.equal((await llamar(db, 'agregarComentario', tJef, { solicitud_id: 'SOL-O', texto: 'hola' })).status, 403, 'JEFATURA fuera de su equipo');
  assert.equal((await llamar(db, 'agregarComentario', tGer, { solicitud_id: 'SOL-E', texto: 'hola' })).status, 403, 'GERENCIA');
  assert.equal((await llamar(db, 'agregarComentario', tDev, { solicitud_id: 'SOL-E', subsolicitud_id: 'SOL-O-1', texto: 'hola' })).status, 400, 'ítem de otra solicitud');
  assert.equal(leerFilas_(db, 'COMENTARIOS', COLUMNAS.COMENTARIOS).length, antes, 'ningún comentario nuevo');
  const ok = await llamar(db, 'agregarComentario', tJef, { solicitud_id: 'SOL-E', subsolicitud_id: 'SOL-E-1', texto: 'Nota', es_interno: 'false' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.es_interno, false, '«false» en texto no se vuelve nota interna');
});

test('E2-3: mientras espera al solicitante (S06) el SLA de la cola no se consume', () => {
  const sub = { subsolicitud_id: 'X-1', estado: 'S05', sla_objetivo_horas: 24, fecha_creacion: '2026-10-05T12:00:00Z' }; // lunes 09:00 Santiago
  const historial = [
    { subsolicitud_id: 'X-1', estado_nuevo: 'S06', timestamp: '2026-10-05T14:00:00Z' }, // 2 h de trabajo y pasa a esperar
    { subsolicitud_id: 'X-1', estado_nuevo: 'S05', timestamp: '2026-10-08T14:00:00Z' }  // vuelve el jueves
  ];
  const conPausa = Cumplimiento.medir(sub, { feriados: [], historial, ahora: new Date('2026-10-08T15:00:00Z') });
  const sinPausa = Cumplimiento.medir(sub, { feriados: [], ahora: new Date('2026-10-08T15:00:00Z') });
  assert.equal(conPausa.transcurridas_horas, 3, 'solo cuentan las 2 h antes de esperar + 1 h después');
  assert.ok(sinPausa.transcurridas_horas > 20, 'antes se contaban los días de espera');
  // Todavía esperando: las horas no avanzan.
  const esperando = Object.assign({}, sub, { estado: 'S06' });
  const h1 = Cumplimiento.medir(esperando, { feriados: [], historial: historial.slice(0, 1), ahora: new Date('2026-10-06T15:00:00Z') });
  const h2 = Cumplimiento.medir(esperando, { feriados: [], historial: historial.slice(0, 1), ahora: new Date('2026-10-07T15:00:00Z') });
  assert.equal(h1.transcurridas_horas, h2.transcurridas_horas);
  // Terminado (S08): el reloj se detiene en la fecha en que se terminó.
  const terminado = Object.assign({}, sub, { estado: 'S08', fecha_terminada: '2026-10-05T15:00:00Z' });
  assert.equal(Cumplimiento.medir(terminado, { feriados: [], ahora: new Date('2026-10-09T15:00:00Z') }).transcurridas_horas, 3);
});

test('E2-4: un movimiento del equipo en el ítem B no atiende lo que el solicitante escribió en A', async () => {
  const db = preparar();
  agregarFila_(db, 'SUBSOLICITUDES', { subsolicitud_id: 'SOL-E-2', solicitud_id: 'SOL-E', numero_item: 2, titulo: 'Ítem B', estado: 'S05', prioridad: 'P3', desarrollador_asignado: 'subordinado@demo.cl', tipo: 'MEJ', sla_objetivo_horas: 72, fecha_creacion: '2026-10-01T12:00:00Z' });
  agregarFila_(db, 'COMENTARIOS', { comentario_id: 'c1', solicitud_id: 'SOL-E', subsolicitud_id: 'SOL-E-1', usuario: 'cliente@demo.cl', texto: '¿Cómo va?', es_interno: false, timestamp: '2026-10-07T12:00:00Z' });
  agregarFila_(db, 'HISTORIAL_ESTADOS', { historial_id: 'h1', solicitud_id: 'SOL-E', subsolicitud_id: 'SOL-E-2', estado_anterior: 'S05', estado_nuevo: 'S05', usuario: 'subordinado@demo.cl', timestamp: '2026-10-07T13:00:00Z' });
  agregarFila_(db, 'COMENTARIOS', { comentario_id: 'c2', solicitud_id: 'SOL-E', subsolicitud_id: 'SOL-E-1', usuario: 'subordinado@demo.cl', texto: 'Nota interna', es_interno: true, timestamp: '2026-10-07T14:00:00Z' });
  const tAdm = await login(db, 'admin');
  const cola = (await llamar(db, 'getColaSolicitudes', tAdm, { verBandeja: '' })).body.data;
  const items = (cola.items || cola.solicitudes || []).concat(...(cola.solicitudes || []).map((s) => s.items || []));
  const a = items.find((x) => x.subsolicitud_id === 'SOL-E-1');
  assert.ok(a, 'el ítem A está en la cola: ' + JSON.stringify(Object.keys(cola)));
  assert.equal(a.respuesta_pendiente, true, 'A sigue pendiente: lo de B y la nota interna no lo atienden');
  agregarFila_(db, 'COMENTARIOS', { comentario_id: 'c3', solicitud_id: 'SOL-E', subsolicitud_id: 'SOL-E-1', usuario: 'subordinado@demo.cl', texto: 'Va bien, mañana te lo entrego', es_interno: false, timestamp: '2026-10-07T15:00:00Z' });
  const cola2 = (await llamar(db, 'getColaSolicitudes', tAdm, { verBandeja: '' })).body.data;
  const items2 = (cola2.items || cola2.solicitudes || []).concat(...(cola2.solicitudes || []).map((s) => s.items || []));
  assert.equal(items2.find((x) => x.subsolicitud_id === 'SOL-E-1').respuesta_pendiente, false, 'una respuesta pública en A sí la atiende');
});

// --- Revisión de Codex de la Tanda 1 (hallazgos 1, 2 y 5) ---------------------------
function conAnalistas(db) {
  const salt = Hash.generarSalt();
  [['C-ANL', 'analistalec', 'analistalec@demo.cl'], ['C-ANA', 'analista', 'analista@demo.cl']].forEach(([id, u, e]) =>
    agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: id, usuario: u, nombre: u, emails: JSON.stringify([e]), rol: 'ANA', modulos: '["bandeja"]',
      empresa_id: 'HP', activo: true, salt, hash_password: Hash.hashPassword(CLAVE, salt), debe_cambiar_password: false }));
  agregarFila_(db, 'CI_MIEMBROS', { miembro_id: 'm3', depto: 'RRHH', usuario_email: 'analistalec@demo.cl', rol: 'LECTURA', activa: true });
}
const itemDe = (db, id) => leerFilas_(db, 'SUBSOLICITUDES', COLUMNAS.SUBSOLICITUDES).find((s) => s.subsolicitud_id === id);

test('revisión T1-1: ANA con LECTURA no cambia prioridad ni reasigna; ANA sin esa membresía y ADM sí', async () => {
  const db = preparar(); conAnalistas(db);
  const tLec = await login(db, 'analistalec');
  const prio = { subsolicitud_id: 'SOL-R-1', prioridad_nueva: 'P1', justificacion: 'Lo pidió gerencia por un reclamo del cliente' };
  let r = await llamar(db, 'actualizarPrioridad', tLec, prio);
  assert.equal(r.status, 403, JSON.stringify(r.body));
  r = await llamar(db, 'actualizarPrioridad', tLec, { solicitud_id: 'SOL-R', subsolicitud_id: 'SOL-R-1', desarrollador_asignado: 'analistalec@demo.cl' });
  assert.equal(r.status, 403, 'reasignar ítem: ' + JSON.stringify(r.body));
  r = await llamar(db, 'actualizarPrioridad', tLec, { solicitud_id: 'SOL-R', desarrollador_asignado: 'analistalec@demo.cl' });
  assert.equal(r.status, 403, 'reasignar solicitud: ' + JSON.stringify(r.body));
  assert.equal(itemDe(db, 'SOL-R-1').prioridad, 'P3');
  assert.equal(itemDe(db, 'SOL-R-1').desarrollador_asignado, 'lectora@demo.cl');
  assert.equal(leerFilas_(db, 'HISTORIAL_PRIORIDAD', COLUMNAS.HISTORIAL_PRIORIDAD).length, 0);
  r = await llamar(db, 'actualizarPrioridad', tLec, { solicitud_id: 'SOL-E', subsolicitud_id: 'SOL-R-1', desarrollador_asignado: 'x@demo.cl' });
  assert.notEqual(r.status, 200, 'el ítem debe ser de esa solicitud');
  assert.equal((await llamar(db, 'actualizarPrioridad', await login(db, 'analista'), prio)).status, 200, 'ANA sin LECTURA conserva su autoridad');
  assert.equal((await llamar(db, 'actualizarPrioridad', await login(db, 'admin'), Object.assign({}, prio, { prioridad_nueva: 'P2' }))).status, 200);
});

test('revisión T1-2: Gerencia con membresía de trabajo no toma ítems de la cola (sin cambios a medias)', async () => {
  const db = preparar();
  agregarFila_(db, 'CI_MIEMBROS', { miembro_id: 'm4', depto: 'RRHH', usuario_email: 'gerencia@demo.cl', rol: 'REGISTRA', activa: true });
  agregarFila_(db, 'SUBSOLICITUDES', { subsolicitud_id: 'SOL-R-2', solicitud_id: 'SOL-R', numero_item: 2, titulo: 'Libre', descripcion: 'Descripción de prueba suficientemente larga.', estado: 'S01', prioridad: 'P3', desarrollador_asignado: '', depto: 'RRHH', tipo: 'MEJ', sla_objetivo_horas: 72, fecha_creacion: '2026-10-01T12:00:00Z' });
  const antesHist = leerFilas_(db, 'HISTORIAL_ESTADOS', COLUMNAS.HISTORIAL_ESTADOS).length;
  const r = await llamar(db, 'tomarItemSolicitud', await login(db, 'gerencia'), { subsolicitud_id: 'SOL-R-2' });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(itemDe(db, 'SOL-R-2').desarrollador_asignado, '');
  assert.equal(itemDe(db, 'SOL-R-2').estado, 'S01');
  assert.equal(leerFilas_(db, 'HISTORIAL_ESTADOS', COLUMNAS.HISTORIAL_ESTADOS).length, antesHist);
});

test('revisión T1-5: en S06, la respuesta pública del equipo en ESE ítem atiende al solicitante; en otro ítem o interna, no', async () => {
  const db = preparar();
  require('../db/sqliteRepo').actualizarFilaPorId_(db, 'SUBSOLICITUDES', 'subsolicitud_id', 'SOL-E-1', { estado: 'S06' });
  agregarFila_(db, 'SUBSOLICITUDES', { subsolicitud_id: 'SOL-E-2', solicitud_id: 'SOL-E', numero_item: 2, titulo: 'Ítem B', estado: 'S05', prioridad: 'P3', desarrollador_asignado: 'subordinado@demo.cl', tipo: 'MEJ', sla_objetivo_horas: 72, fecha_creacion: '2026-10-01T12:00:00Z' });
  agregarFila_(db, 'HISTORIAL_ESTADOS', { historial_id: 'h6', solicitud_id: 'SOL-E', subsolicitud_id: 'SOL-E-1', estado_anterior: 'S05', estado_nuevo: 'S06', usuario: 'subordinado@demo.cl', timestamp: '2026-10-07T11:00:00Z' });
  agregarFila_(db, 'COMENTARIOS', { comentario_id: 'k1', solicitud_id: 'SOL-E', subsolicitud_id: 'SOL-E-1', usuario: 'cliente@demo.cl', texto: 'Aquí va el dato', es_interno: false, timestamp: '2026-10-07T12:00:00Z' });
  const tAdm = await login(db, 'admin');
  const pendiente = async () => {
    const c = (await llamar(db, 'getColaSolicitudes', tAdm, { verBandeja: '' })).body.data;
    const its = (c.items || c.solicitudes || []).concat(...(c.solicitudes || []).map((s) => s.items || []));
    return its.find((x) => x.subsolicitud_id === 'SOL-E-1').respuesta_pendiente;
  };
  assert.equal(await pendiente(), true, 'el solicitante respondió');
  agregarFila_(db, 'COMENTARIOS', { comentario_id: 'k2', solicitud_id: 'SOL-E', subsolicitud_id: 'SOL-E-2', usuario: 'subordinado@demo.cl', texto: 'Esto es de B', es_interno: false, timestamp: '2026-10-07T12:30:00Z' });
  agregarFila_(db, 'COMENTARIOS', { comentario_id: 'k3', solicitud_id: 'SOL-E', subsolicitud_id: 'SOL-E-1', usuario: 'subordinado@demo.cl', texto: 'Nota interna', es_interno: true, timestamp: '2026-10-07T12:45:00Z' });
  assert.equal(await pendiente(), true, 'B y la nota interna no atienden A');
  agregarFila_(db, 'COMENTARIOS', { comentario_id: 'k4', solicitud_id: 'SOL-E', subsolicitud_id: 'SOL-E-1', usuario: 'subordinado@demo.cl', texto: 'Gracias, con eso sigo', es_interno: false, timestamp: '2026-10-07T13:00:00Z' });
  assert.equal(await pendiente(), false, 'respuesta pública en A');
});
