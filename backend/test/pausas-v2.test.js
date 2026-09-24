'use strict';

/**
 * SIGSO v2, Módulo 5A — Coordinación de pausas:
 *  - cualquiera de la lista puede iniciar la pausa pasada la tolerancia;
 *  - el panel de coordinación trae últimos días, quién inicia y la señal de
 *    ánimo (Mal / Muy mal en 14 días).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Pausas = require('../logica/pausas');
const { claveDia_ } = require('../logica/utils');

const TZ = 'America/Santiago';
function hoy_() { return claveDia_(new Date(), TZ); }
function haceDias_(n) { return claveDia_(new Date(Date.now() - n * 86400000), TZ); }

function db_() {
  const db = abrirDb_();
  ['PAUSAS_CONFIG', 'PAUSAS_COORDINADORES', 'PAUSAS_TRABAJADORES', 'PAUSAS_PROGRAMADAS',
    'PAUSAS_ASISTENCIA', 'PAUSAS_LOG', 'CAT_EMPRESAS', 'USUARIOS', 'CUENTAS_PORTAL', 'LOG_NOTIFICACIONES', 'NOTIFICACIONES_APP']
    .forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  agregarFila_(db, 'PAUSAS_CONFIG', { empresa_id: 'HP', hora_habitual: '12:00', dias_semana: '1,2,3,4,5', duracion_min: 10, activo: true });
  agregarFila_(db, 'PAUSAS_COORDINADORES', { coord_id: 'C1', empresa_id: 'HP', nombre: 'Coord', email: 'coord@x.cl', tipo: 'titular', activo: true });
  agregarFila_(db, 'PAUSAS_TRABAJADORES', { trabajador_id: 'T1', empresa_id: 'HP', nombre: 'Ana', email: 'ana@x.cl', activo: true });
  agregarFila_(db, 'PAUSAS_TRABAJADORES', { trabajador_id: 'T2', empresa_id: 'HP', nombre: 'Beto', email: 'beto@x.cl', activo: true });
  return db;
}
function pausa(db, id, fecha, o) {
  agregarFila_(db, 'PAUSAS_PROGRAMADAS', Object.assign({ pausa_id: id, empresa_id: 'HP', fecha: fecha, hora_programada: '12:00', estado: 'Programada', duracion_min: 10 }, o || {}));
}
const ANA = { rol: 'DEV', email: 'ana@x.cl' };

test('Un participante NO puede iniciar antes de la tolerancia; después sí, y queda registrado quién', () => {
  const db = db_();
  pausa(db, 'P1', hoy_());
  const antes = Pausas.iniciarPausaParticipante(db, { ahoraMin: 12 * 60 + 3 }, ANA);
  assert.ok(antes._validationError, 'a las 12:03 todavía es turno de la coordinación');
  assert.match(antes.message, /12:05/);
  const r = Pausas.iniciarPausaParticipante(db, { ahoraMin: 12 * 60 + 6 }, ANA);
  assert.equal(r.estado, 'En_curso');
  const fila = leerFilas_(db, 'PAUSAS_PROGRAMADAS', COLUMNAS.PAUSAS_PROGRAMADAS)[0];
  assert.equal(fila.iniciada_por, 'ana@x.cl');
  assert.ok(fila.hora_inicio_real);
  assert.ok(Pausas.iniciarPausaParticipante(db, { ahoraMin: 12 * 60 + 7 }, ANA)._validationError, 'ya está en curso');
});

test('Quien no está en la lista no puede iniciarla', () => {
  const db = db_();
  pausa(db, 'P1', hoy_());
  assert.equal(Pausas.iniciarPausaParticipante(db, { ahoraMin: 13 * 60 }, { rol: 'DEV', email: 'otro@x.cl' })._forbidden, true);
});

test('La coordinación al iniciar queda como iniciada_por', async () => {
  const db = db_();
  pausa(db, 'P1', hoy_());
  await Pausas.gestionarPausaCoordinador(db, { pausa_id: 'P1', operacion: 'iniciar' }, { rol: 'DEV', email: 'coord@x.cl' });
  assert.equal(leerFilas_(db, 'PAUSAS_PROGRAMADAS', COLUMNAS.PAUSAS_PROGRAMADAS)[0].iniciada_por, 'coord@x.cl');
});

test('Panel de coordinación: últimos días, quién inicia y señal de ánimo (Mal/Muy mal en 14 días)', () => {
  const db = db_();
  pausa(db, 'H1', haceDias_(3), { estado: 'Realizada', hora_inicio_real: new Date().toISOString(), coordinador_email: 'coord@x.cl' });
  pausa(db, 'H2', haceDias_(2), { estado: 'Realizada', hora_inicio_real: new Date().toISOString(), iniciada_por: 'ana@x.cl' });
  pausa(db, 'H3', haceDias_(1), { estado: 'No_realizada' });
  pausa(db, 'H0', haceDias_(30), { estado: 'Realizada' });
  agregarFila_(db, 'PAUSAS_ASISTENCIA', { registro_id: 'R1', pausa_id: 'H1', email: 'ana@x.cl', estado: 'participo', animo: 1 });
  agregarFila_(db, 'PAUSAS_ASISTENCIA', { registro_id: 'R2', pausa_id: 'H2', email: 'ana@x.cl', estado: 'participo', animo: 2 });
  agregarFila_(db, 'PAUSAS_ASISTENCIA', { registro_id: 'R3', pausa_id: 'H2', email: 'beto@x.cl', estado: 'participo', animo: 5 });
  agregarFila_(db, 'PAUSAS_ASISTENCIA', { registro_id: 'R4', pausa_id: 'H0', email: 'beto@x.cl', estado: 'participo', animo: 1 });
  const d = Pausas.getPanelCoordinador(db, {}, { rol: 'DEV', email: 'coord@x.cl' });
  assert.deepEqual(d.ultimos_dias.map((x) => x.estado), ['Realizada', 'Realizada', 'Realizada', 'No_realizada'], 'orden cronológico');
  assert.equal(d.ultimos_dias[2].pct_participacion, 100);
  assert.deepEqual(d.quien_inicia.map((q) => [q.email, q.cantidad]).sort(), [['ana@x.cl', 1], ['coord@x.cl', 1]]);
  assert.equal(d.animo_alertas.length, 1, 'Beto: su "Muy mal" es de hace 30 días, no cuenta');
  assert.equal(d.animo_alertas[0].nombre, 'Ana');
  assert.equal(d.animo_alertas[0].bajos, 2);
});

test('getPausaHoyTrabajador dice si la persona puede iniciarla y desde qué hora', () => {
  const db = db_();
  pausa(db, 'P1', hoy_(), { hora_programada: '00:00' });
  const r = Pausas.getPausaHoyTrabajador(db, {}, ANA);
  assert.equal(r.en_lista, true);
  assert.equal(r.iniciar_desde, '00:05');
  assert.equal(typeof r.puede_iniciar, 'boolean');
});

// Módulo 5B: el trabajador ve su propio historial.
test('getMiHistorialPausas: historial propio (participación, racha); fuera de la lista responde sin_lista', () => {
  const db = db_();
  pausa(db, 'H1', haceDias_(3), { estado: 'Realizada' });
  pausa(db, 'H2', haceDias_(2), { estado: 'Realizada' });
  pausa(db, 'H3', haceDias_(1), { estado: 'No_realizada' });
  agregarFila_(db, 'PAUSAS_ASISTENCIA', { registro_id: 'R1', pausa_id: 'H1', email: 'ana@x.cl', estado: 'no_participo', motivo: 'En reunión' });
  agregarFila_(db, 'PAUSAS_ASISTENCIA', { registro_id: 'R2', pausa_id: 'H2', email: 'ana@x.cl', estado: 'participo' });
  const r = Pausas.getMiHistorialPausas(db, {}, ANA);
  assert.equal(r.resumen.participaciones, 1);
  assert.equal(r.resumen.justificaciones, 1);
  assert.equal(r.resumen.no_aplica, 1);
  assert.equal(r.resumen.racha_actual, 1);
  assert.equal(Pausas.getMiHistorialPausas(db, {}, { rol: 'DEV', email: 'otro@x.cl' }).sin_lista, true);
});
