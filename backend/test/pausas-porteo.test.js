'use strict';

/**
 * Prueba de portabilidad: los escenarios de los 11 archivos backend/test/
 * pausas*.test.js, consolidados y corridos contra backend/logica/pausas.js.
 *
 * Adaptaciones documentadas respecto del .gs:
 *  - EVIDENCIA (foto al finalizar) y PDF descargables: bloqueados por R2. Se
 *    prueba que devuelven el error R2/PDF, y que finalizar SIN evidencia
 *    funciona igual.
 *  - ENLACE MAGICO en los correos: no portado -> los correos salen igual, sin
 *    el boton. No se testea el enlace.
 *  - "hora como celda Date": en SQLite la hora se guarda como string, no hay
 *    coercion a Date -> se prueba que 'HH:mm' se preserva (el caso Date es
 *    especifico de Sheets, igual criterio que fechaHoraCelda_ en Solicitudes).
 *  - Correos via mock de Resend (destinatarios/conteo).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Pausas = require('../logica/pausas');
const Resend = require('../logica/resend');
const { claveDia_ } = require('../logica/utils');

const ADMIN = { rol: 'ADM', email: 'admin@homepymes.cl' };
const DEV = { rol: 'DEV', email: 'dev@homepymes.cl' };
const GERENCIA = { rol: 'GERENCIA', email: 'gerente@homepymes.cl' };

function dbBase() {
  const db = abrirDb_();
  ['PAUSAS_CONFIG', 'PAUSAS_COORDINADORES', 'PAUSAS_TRABAJADORES', 'PAUSAS_PROGRAMADAS',
    'PAUSAS_ASISTENCIA', 'PAUSAS_LOG', 'CAT_EMPRESAS', 'USUARIOS', 'CUENTAS_PORTAL', 'LOG_NOTIFICACIONES', 'NOTIFICACIONES_APP']
    .forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
function hoy_() { return claveDia_(new Date(), 'America/Santiago'); }

function conMock(t) {
  process.env.RESEND_API_KEY = 're_test_key';
  const mock = t.mock.method(Resend, 'enviarCorreoResend_', async () => ({ id: 'x' }));
  t.after(() => { delete process.env.RESEND_API_KEY; });
  return mock;
}
function destinatarios(mock) { return mock.mock.calls.map((c) => c.arguments[0].to[0]); }

// ==== PAUSAS_CONFIG / coordinadores / trabajadores (pausas.test.js) ========

test('guardarConfig crea la config y normaliza hora/dias', () => {
  const db = dbBase();
  const res = Pausas.guardarConfig(db, { empresa_id: 'HP', hora_habitual: '9:30', dias_semana: '3,1,1,5', duracion_min: 10, min_anticipacion: 15, umbral_verde: 80, umbral_amarillo: 60 }, ADMIN);
  assert.ok(!res._validationError && !res._forbidden, JSON.stringify(res));
  assert.equal(res.hora_habitual, '09:30');
  assert.equal(res.dias_semana, '1,3,5');
  assert.equal(Pausas.listarConfig(db, {}, ADMIN).length, 1);
});

test('la hora HH:mm se preserva al listar (en SQLite no hay coercion a Date)', () => {
  const db = dbBase();
  Pausas.guardarConfig(db, { empresa_id: 'HP', hora_habitual: '09:30', dias_semana: '1,2,3,4,5', duracion_min: 10 }, ADMIN);
  assert.equal(Pausas.listarConfig(db, {}, ADMIN)[0].hora_habitual, '09:30');
});

test('guardarConfig hace UPSERT por empresa_id', () => {
  const db = dbBase();
  Pausas.guardarConfig(db, { empresa_id: 'HP', hora_habitual: '09:00', duracion_min: 5 }, ADMIN);
  Pausas.guardarConfig(db, { empresa_id: 'HP', hora_habitual: '10:00', duracion_min: 8 }, ADMIN);
  const f = Pausas.listarConfig(db, {}, ADMIN);
  assert.equal(f.length, 1);
  assert.equal(f[0].hora_habitual, '10:00');
});

test('guardarConfig rechaza hora, dias, duracion y umbrales invalidos', () => {
  const db = dbBase();
  assert.equal(Pausas.guardarConfig(db, { empresa_id: 'HP', hora_habitual: '25:00' }, ADMIN)._validationError, true);
  assert.equal(Pausas.guardarConfig(db, { empresa_id: 'HP', dias_semana: '1,9' }, ADMIN)._validationError, true);
  assert.equal(Pausas.guardarConfig(db, { empresa_id: 'HP', duracion_min: -3 }, ADMIN)._validationError, true);
  assert.equal(Pausas.guardarConfig(db, { empresa_id: 'HP', umbral_verde: 60, umbral_amarillo: 80 }, ADMIN)._validationError, true);
});

test('la configuracion de pausas es ADM-only', () => {
  const db = dbBase();
  assert.equal(Pausas.listarConfig(db, {}, DEV)._forbidden, true);
  assert.equal(Pausas.guardarConfig(db, { empresa_id: 'HP' }, DEV)._forbidden, true);
});

test('gestionarCoordinador crea titular y reemplazo, valida tipo, rechaza correo/duplicado, desactiva y elimina', () => {
  const db = dbBase();
  const t = Pausas.gestionarCoordinador(db, { operacion: 'crear', empresa_id: 'HP', nombre: 'Cami', email: 'cami@hp.cl', tipo: 'titular' }, ADMIN);
  assert.ok(t.coord_id);
  assert.ok(Pausas.gestionarCoordinador(db, { operacion: 'crear', empresa_id: 'HP', nombre: 'Ana', email: 'ana@hp.cl', tipo: 'reemplazo' }, ADMIN).coord_id);
  assert.equal(Pausas.gestionarCoordinador(db, { operacion: 'crear', empresa_id: 'HP', nombre: 'X', email: 'x@hp.cl', tipo: 'raro' }, ADMIN)._validationError, true);
  assert.equal(Pausas.gestionarCoordinador(db, { operacion: 'crear', empresa_id: 'HP', nombre: 'Y', email: 'no-mail', tipo: 'titular' }, ADMIN)._validationError, true);
  assert.equal(Pausas.gestionarCoordinador(db, { operacion: 'crear', empresa_id: 'HP', nombre: 'Cami2', email: 'cami@hp.cl', tipo: 'titular' }, ADMIN)._validationError, true);
  assert.equal(Pausas.gestionarCoordinador(db, { operacion: 'activar', coord_id: t.coord_id, activo: false }, ADMIN).activo, false);
  assert.equal(Pausas.gestionarCoordinador(db, { operacion: 'eliminar', coord_id: t.coord_id }, ADMIN).eliminada, true);
});

test('gestionarTrabajador crea con area/cargo + fecha_ingreso, rechaza duplicado activo, elimina', () => {
  const db = dbBase();
  const t = Pausas.gestionarTrabajador(db, { operacion: 'crear', empresa_id: 'HP', nombre: 'Juan', email: 'juan@hp.cl', area: 'Bodega', cargo: 'Op' }, ADMIN);
  assert.ok(t.trabajador_id);
  assert.ok(t.fecha_ingreso);
  assert.equal(Pausas.gestionarTrabajador(db, { operacion: 'crear', empresa_id: 'HP', nombre: 'Juan2', email: 'juan@hp.cl' }, ADMIN)._validationError, true);
  assert.equal(Pausas.gestionarTrabajador(db, { operacion: 'eliminar', trabajador_id: t.trabajador_id }, ADMIN).eliminado, true);
});

test('las operaciones dejan traza en PAUSAS_LOG', () => {
  const db = dbBase();
  Pausas.guardarConfig(db, { empresa_id: 'HP', hora_habitual: '09:00' }, ADMIN);
  assert.ok(filas(db, 'PAUSAS_LOG').length >= 1);
});

// ==== roster: sembrar / asignar modulo (pausas-mejoras.test.js) ============

function seedCuenta(db, over) {
  agregarFila_(db, 'CUENTAS_PORTAL', Object.assign({
    cuenta_id: crypto.randomUUID ? crypto.randomUUID() : String(Math.random()), usuario: 'u', nombre: 'N', cargo: 'C',
    hash_password: 'h', salt: 's', emails: JSON.stringify(['a@hp.cl']), rol: 'DEV', modulos: JSON.stringify([]),
    empresa_id: 'HP', activo: true, debe_cambiar_password: false, ultimo_acceso: '', creado_por: 'seed'
  }, over));
}
const crypto = require('node:crypto');

test('sembrarRosterDesdeCuentas crea una fila por correo de cada cuenta activa; no duplica; ignora inactivas; ADM-only', () => {
  const db = dbBase();
  seedCuenta(db, { cuenta_id: 'c1', emails: JSON.stringify(['a@hp.cl', 'b@hp.cl']) });
  seedCuenta(db, { cuenta_id: 'c2', emails: JSON.stringify(['a@hp.cl']) }); // a duplicado
  seedCuenta(db, { cuenta_id: 'c3', emails: JSON.stringify(['c@hp.cl']), activo: false }); // inactiva
  seedCuenta(db, { cuenta_id: 'c4', emails: JSON.stringify(['d@otra.cl']), empresa_id: 'GDE' }); // otra empresa
  const r = Pausas.sembrarRosterDesdeCuentas(db, { empresa_id: 'HP' }, ADMIN);
  assert.equal(r.creados, 2); // a y b
  // segunda corrida no duplica
  assert.equal(Pausas.sembrarRosterDesdeCuentas(db, { empresa_id: 'HP' }, ADMIN).creados, 0);
  assert.equal(Pausas.sembrarRosterDesdeCuentas(db, { empresa_id: 'HP' }, DEV)._forbidden, true);
  assert.equal(Pausas.sembrarRosterDesdeCuentas(db, {}, ADMIN)._validationError, true);
});

test('asignarModuloPausasRoster agrega "pausas" a cuentas que matchean y reporta las sin cuenta; ADM-only', () => {
  const db = dbBase();
  Pausas.gestionarTrabajador(db, { operacion: 'crear', empresa_id: 'HP', nombre: 'A', email: 'a@hp.cl' }, ADMIN);
  Pausas.gestionarTrabajador(db, { operacion: 'crear', empresa_id: 'HP', nombre: 'Z', email: 'z@hp.cl' }, ADMIN); // sin cuenta
  seedCuenta(db, { cuenta_id: 'c1', emails: JSON.stringify(['a@hp.cl']), modulos: JSON.stringify(['bandeja']) });
  const r = Pausas.asignarModuloPausasRoster(db, { empresa_id: 'HP' }, ADMIN);
  assert.equal(r.cuentas_actualizadas, 1);
  assert.ok(r.sin_cuenta.includes('z@hp.cl'));
  const cuenta = filas(db, 'CUENTAS_PORTAL').find((c) => c.cuenta_id === 'c1');
  assert.ok(JSON.parse(cuenta.modulos).includes('pausas'));
  assert.equal(Pausas.asignarModuloPausasRoster(db, { empresa_id: 'HP' }, DEV)._forbidden, true);
});

// ==== programacion + estados (pausas-programacion.test.js) =================

function seedConfig(db, over) {
  Pausas.guardarConfig(db, Object.assign({ empresa_id: 'HP', hora_habitual: '10:00', dias_semana: '1,2,3,4,5,6,7', duracion_min: 10, min_anticipacion: 15, umbral_verde: 80 }, over), ADMIN);
}

test('programarDelDia crea la pausa del dia cuando aplica; idempotente; respeta dias_semana; ignora inactivas', () => {
  const db = dbBase();
  seedConfig(db);
  const r = Pausas.programarDelDia(db, new Date(), ADMIN);
  assert.equal(r.total_creadas, 1);
  assert.equal(Pausas.programarDelDia(db, new Date(), ADMIN).total_creadas, 0); // idempotente
  // dia que no aplica
  const db2 = dbBase();
  const hoyIso = new Date().getDay() === 0 ? 7 : new Date().getDay();
  const otroDia = String(hoyIso === 1 ? 2 : 1);
  seedConfig(db2, { dias_semana: otroDia });
  assert.equal(Pausas.programarDelDia(db2, new Date(), ADMIN).total_creadas, 0);
  // inactiva
  const db3 = dbBase();
  seedConfig(db3, { activo: false });
  assert.equal(Pausas.programarDelDia(db3, new Date(), ADMIN).total_creadas, 0);
});

test('programarDelDiaAdmin exige ADM; listarProgramadas filtra y es ADM-only', () => {
  const db = dbBase();
  seedConfig(db);
  assert.equal(Pausas.programarDelDiaAdmin(db, {}, DEV)._forbidden, true);
  Pausas.programarDelDiaAdmin(db, {}, ADMIN);
  assert.equal(Pausas.listarProgramadas(db, { empresa_id: 'HP' }, ADMIN).length, 1);
  assert.equal(Pausas.listarProgramadas(db, { estado: 'Cancelada' }, ADMIN).length, 0);
  assert.equal(Pausas.listarProgramadas(db, {}, DEV)._forbidden, true);
});

test('cancelar pasa a Cancelada y no se puede cancelar dos veces', () => {
  const db = dbBase();
  seedConfig(db);
  const p = Pausas.programarDelDia(db, new Date(), ADMIN).creadas[0];
  assert.equal(Pausas.gestionarPausaProgramada(db, { operacion: 'cancelar', pausa_id: p.pausa_id, motivo: 'x' }, ADMIN).estado, 'Cancelada');
  assert.equal(Pausas.gestionarPausaProgramada(db, { operacion: 'cancelar', pausa_id: p.pausa_id }, ADMIN)._validationError, true);
});

test('reprogramar cambia fecha/hora de una Programada y rechaza fecha mal formada; no reprograma una Cancelada', () => {
  const db = dbBase();
  seedConfig(db);
  const p = Pausas.programarDelDia(db, new Date(), ADMIN).creadas[0];
  assert.equal(Pausas.gestionarPausaProgramada(db, { operacion: 'reprogramar', pausa_id: p.pausa_id, fecha: '2026/01/01' }, ADMIN)._validationError, true);
  const ok = Pausas.gestionarPausaProgramada(db, { operacion: 'reprogramar', pausa_id: p.pausa_id, hora_programada: '11:30' }, ADMIN);
  assert.equal(ok.hora_programada, '11:30');
  Pausas.gestionarPausaProgramada(db, { operacion: 'cancelar', pausa_id: p.pausa_id, motivo: 'x' }, ADMIN);
  assert.equal(Pausas.gestionarPausaProgramada(db, { operacion: 'reprogramar', pausa_id: p.pausa_id, hora_programada: '12:00' }, ADMIN)._validationError, true);
});

test('crear_manual agrega una pausa puntual y rechaza duplicado vivo y fecha invalida; ADM-only', () => {
  const db = dbBase();
  assert.equal(Pausas.gestionarPausaProgramada(db, { operacion: 'crear_manual', empresa_id: 'HP', fecha: 'mal' }, ADMIN)._validationError, true);
  const ok = Pausas.gestionarPausaProgramada(db, { operacion: 'crear_manual', empresa_id: 'HP', fecha: '2026-12-01', hora_programada: '10:00' }, ADMIN);
  assert.ok(ok.pausa_id);
  assert.equal(Pausas.gestionarPausaProgramada(db, { operacion: 'crear_manual', empresa_id: 'HP', fecha: '2026-12-01' }, ADMIN)._validationError, true);
  assert.equal(Pausas.gestionarPausaProgramada(db, { operacion: 'crear_manual', empresa_id: 'HP', fecha: '2026-12-02' }, DEV)._forbidden, true);
});

// ==== registro del trabajador (pausas-trabajador.test.js) =================

function seedRosterYPausaHoy(db) {
  seedConfig(db);
  Pausas.gestionarTrabajador(db, { operacion: 'crear', empresa_id: 'HP', nombre: 'Juan', email: 'juan@hp.cl', area: 'Bodega' }, ADMIN);
  return Pausas.programarDelDia(db, new Date(), ADMIN).creadas[0];
}
const CTX_JUAN = { rol: 'DEV', email: 'juan@hp.cl' };

test('getPausaHoyTrabajador devuelve la pausa de hoy sin registro; sin empresa; sin pausa', () => {
  const db = dbBase();
  seedRosterYPausaHoy(db);
  const r = Pausas.getPausaHoyTrabajador(db, {}, CTX_JUAN);
  assert.equal(r.empresa_id, 'HP');
  assert.ok(r.pausa);
  assert.equal(r.mi_registro, null);
  assert.equal(Pausas.getPausaHoyTrabajador(db, {}, { rol: 'DEV', email: 'nadie@x.cl' }).sin_empresa, true);
  const db2 = dbBase();
  seedConfig(db2);
  Pausas.gestionarTrabajador(db2, { operacion: 'crear', empresa_id: 'HP', nombre: 'J', email: 'juan@hp.cl' }, ADMIN);
  assert.equal(Pausas.getPausaHoyTrabajador(db2, {}, CTX_JUAN).pausa, null);
});

test('registrarAsistencia: "participe" exige confirmacion; "no_participo" exige motivo; upsert; rechaza estado invalido', () => {
  const db = dbBase();
  seedRosterYPausaHoy(db);
  assert.equal(Pausas.registrarAsistencia(db, { estado: 'participo' }, CTX_JUAN)._validationError, true);
  assert.equal(Pausas.registrarAsistencia(db, { estado: 'no_participo' }, CTX_JUAN)._validationError, true);
  assert.equal(Pausas.registrarAsistencia(db, { estado: 'raro', confirmacion: true }, CTX_JUAN)._validationError, true);
  const noPude = Pausas.registrarAsistencia(db, { estado: 'no_participo', motivo: 'reunion' }, CTX_JUAN);
  assert.equal(noPude.estado, 'no_participo');
  const participe = Pausas.registrarAsistencia(db, { estado: 'participo', confirmacion: true }, CTX_JUAN);
  assert.equal(participe.estado, 'participo');
  assert.equal(filas(db, 'PAUSAS_ASISTENCIA').length, 1); // upsert, no duplica
});

test('registrarAsistencia guarda animo 1..5 valido y lo deja vacio si no', () => {
  const db = dbBase();
  seedRosterYPausaHoy(db);
  Pausas.registrarAsistencia(db, { estado: 'participo', confirmacion: true, animo: 4 }, CTX_JUAN);
  assert.equal(filas(db, 'PAUSAS_ASISTENCIA')[0].animo, 4);
  Pausas.registrarAsistencia(db, { estado: 'participo', confirmacion: true, animo: 9 }, CTX_JUAN);
  assert.equal(filas(db, 'PAUSAS_ASISTENCIA')[0].animo, '');
});

test('no se puede registrar si la pausa ya no es registrable (Realizada)', () => {
  const db = dbBase();
  const p = seedRosterYPausaHoy(db);
  Pausas.gestionarPausaCoordinador(db, { operacion: 'iniciar', pausa_id: p.pausa_id }, ADMIN);
  Pausas.gestionarPausaCoordinador(db, { operacion: 'finalizar', pausa_id: p.pausa_id }, ADMIN);
  assert.equal(Pausas.registrarAsistencia(db, { estado: 'participo', confirmacion: true }, CTX_JUAN)._validationError, true);
});

test('la empresa se resuelve desde CUENTAS_PORTAL si el trabajador no esta en el roster', () => {
  const db = dbBase();
  seedConfig(db);
  Pausas.programarDelDia(db, new Date(), ADMIN);
  seedCuenta(db, { cuenta_id: 'c1', emails: JSON.stringify(['portal@hp.cl']), empresa_id: 'HP' });
  const r = Pausas.getPausaHoyTrabajador(db, {}, { rol: 'DEV', email: 'portal@hp.cl' });
  assert.equal(r.empresa_id, 'HP');
  assert.ok(r.pausa);
});

// ==== coordinador (pausas-coordinador.test.js) ============================

function seedCoord(db, email) {
  Pausas.gestionarCoordinador(db, { operacion: 'crear', empresa_id: 'HP', nombre: 'Coord', email: email || 'coord@hp.cl', tipo: 'titular' }, ADMIN);
}
const CTX_COORD = { rol: 'DEV', email: 'coord@hp.cl' };

test('getPanelCoordinador trae la pausa de hoy con participacion en vivo; sin_empresa si no coordina', () => {
  const db = dbBase();
  const p = seedRosterYPausaHoy(db);
  seedCoord(db);
  Pausas.registrarAsistencia(db, { estado: 'participo', confirmacion: true }, CTX_JUAN);
  const panel = Pausas.getPanelCoordinador(db, {}, CTX_COORD);
  assert.equal(panel.pausas.length, 1);
  assert.equal(panel.pausas[0].participacion.n_participaron, 1);
  assert.equal(Pausas.getPanelCoordinador(db, {}, { rol: 'DEV', email: 'nadie@x.cl' }).sin_empresa, true);
});

test('iniciar -> En_curso con hora/coordinador; finalizar -> Realizada; no se finaliza una Programada', () => {
  const db = dbBase();
  const p = seedRosterYPausaHoy(db);
  seedCoord(db);
  assert.equal(Pausas.gestionarPausaCoordinador(db, { operacion: 'finalizar', pausa_id: p.pausa_id }, CTX_COORD)._validationError, true);
  const ini = Pausas.gestionarPausaCoordinador(db, { operacion: 'iniciar', pausa_id: p.pausa_id }, CTX_COORD);
  assert.equal(ini.estado, 'En_curso');
  assert.ok(ini.hora_inicio_real);
  const fin = Pausas.gestionarPausaCoordinador(db, { operacion: 'finalizar', pausa_id: p.pausa_id, observaciones: 'ok' }, CTX_COORD);
  assert.equal(fin.estado, 'Realizada');
  assert.ok(fin.hora_fin);
});

test('finalizar con evidencia queda bloqueado por R2; sin evidencia funciona', () => {
  const db = dbBase();
  const p = seedRosterYPausaHoy(db);
  Pausas.gestionarPausaCoordinador(db, { operacion: 'iniciar', pausa_id: p.pausa_id }, ADMIN);
  const conFoto = Pausas.gestionarPausaCoordinador(db, { operacion: 'finalizar', pausa_id: p.pausa_id, evidencia_base64: 'AAAA' }, ADMIN);
  assert.equal(conFoto._validationError, true);
  assert.match(conFoto.message, /evidencia/i);
  // la pausa NO se finalizo (sigue En_curso), se puede finalizar sin foto
  const fin = Pausas.gestionarPausaCoordinador(db, { operacion: 'finalizar', pausa_id: p.pausa_id }, ADMIN);
  assert.equal(fin.estado, 'Realizada');
});

test('no_realizada exige motivo; coordinador de otra empresa no opera; ADM opera cualquiera', () => {
  const db = dbBase();
  const p = seedRosterYPausaHoy(db);
  seedCoord(db);
  assert.equal(Pausas.gestionarPausaCoordinador(db, { operacion: 'no_realizada', pausa_id: p.pausa_id }, CTX_COORD)._validationError, true);
  assert.equal(Pausas.gestionarPausaCoordinador(db, { operacion: 'iniciar', pausa_id: p.pausa_id }, { rol: 'DEV', email: 'otra@x.cl' })._forbidden, true);
  const nr = Pausas.gestionarPausaCoordinador(db, { operacion: 'no_realizada', pausa_id: p.pausa_id, motivo: 'nadie vino' }, ADMIN);
  assert.equal(nr.estado, 'No_realizada');
});

test('registrarAsistenciaGrupal marca varios, no pisa autorregistro salvo sobrescribir, exige coordinar, rechaza no registrable', () => {
  const db = dbBase();
  const p = seedRosterYPausaHoy(db);
  const t2 = Pausas.gestionarTrabajador(db, { operacion: 'crear', empresa_id: 'HP', nombre: 'Ana', email: 'ana@hp.cl' }, ADMIN);
  const tJuan = filas(db, 'PAUSAS_TRABAJADORES').find((t) => t.email === 'juan@hp.cl');
  seedCoord(db);
  // juan se autoregistra participando
  Pausas.registrarAsistencia(db, { estado: 'participo', confirmacion: true }, CTX_JUAN);
  const r = Pausas.registrarAsistenciaGrupal(db, { pausa_id: p.pausa_id, registros: [
    { trabajador_id: tJuan.trabajador_id, estado: 'no_participo', motivo: 'x' }, // debe omitirse (autoservicio)
    { trabajador_id: t2.trabajador_id, estado: 'participo' }
  ] }, CTX_COORD);
  assert.equal(r.actualizados, 1);
  assert.equal(r.omitidos, 1);
  // sobrescribir
  const r2 = Pausas.registrarAsistenciaGrupal(db, { pausa_id: p.pausa_id, sobrescribir: true, registros: [{ trabajador_id: tJuan.trabajador_id, estado: 'no_participo', motivo: 'x' }] }, CTX_COORD);
  assert.equal(r2.actualizados, 1);
  assert.equal(Pausas.registrarAsistenciaGrupal(db, { pausa_id: p.pausa_id, registros: [{ trabajador_id: t2.trabajador_id, estado: 'participo' }] }, { rol: 'DEV', email: 'otra@x.cl' })._forbidden, true);
});

// ==== reportes: cumplimiento / gerencia / tendencia / rachas ==============

function seedPausaResuelta(db, fecha, estado, empresaId) {
  const id = crypto.randomUUID();
  agregarFila_(db, 'PAUSAS_PROGRAMADAS', {
    pausa_id: id, empresa_id: empresaId || 'HP', fecha: fecha, hora_programada: '10:00', hora_inicio_real: '', hora_fin: '',
    coordinador_email: '', estado: estado, duracion_min: 10, observaciones: '', ultima_llamada_enviada: '', aviso_coordinador_enviado: '', evidencia_url: '', escalada_admin_enviada: ''
  });
  return id;
}
function seedAsistencia(db, pausaId, email, estado, animo) {
  agregarFila_(db, 'PAUSAS_ASISTENCIA', {
    registro_id: crypto.randomUUID(), pausa_id: pausaId, trabajador_id: '', email: email, fecha_hora_registro: new Date().toISOString(),
    estado: estado, motivo: estado === 'no_participo' ? 'motivo x' : '', comentario: '', confirmacion: estado === 'participo', origen: 'autoservicio', animo: animo === undefined ? '' : animo
  });
}

test('getReporteCumplimiento calcula KPIs, motivos, por_area, clima_emocional', () => {
  const db = dbBase();
  seedConfig(db);
  seedCoord(db);
  Pausas.gestionarTrabajador(db, { operacion: 'crear', empresa_id: 'HP', nombre: 'Juan', email: 'juan@hp.cl', area: 'Bodega' }, ADMIN);
  const p = seedPausaResuelta(db, hoy_(), 'Realizada');
  seedAsistencia(db, p, 'juan@hp.cl', 'participo', 4);
  seedAsistencia(db, p, 'ana@hp.cl', 'no_participo');
  const rep = Pausas.getReporteCumplimiento(db, {}, CTX_COORD);
  assert.equal(rep.kpis.realizadas, 1);
  assert.equal(rep.kpis.participaciones, 1);
  assert.equal(rep.kpis.justificaciones, 1);
  assert.equal(rep.kpis.animo_promedio, 4);
  assert.ok(rep.motivos.length >= 1);
  assert.equal(rep.clima_emocional.respuestas, 1);
  assert.ok(Array.isArray(rep.tendencia));
  assert.equal(rep.tendencia.length, 8);
});

test('getReporteGerencia agrega TODAS las empresas; filtra por empresa; no expone a otros roles', () => {
  const db = dbBase();
  seedConfig(db, { empresa_id: 'HP' });
  seedConfig(db, { empresa_id: 'GDE' });
  seedPausaResuelta(db, hoy_(), 'Realizada', 'HP');
  seedPausaResuelta(db, hoy_(), 'No_realizada', 'GDE');
  const todas = Pausas.getReporteGerencia(db, {}, GERENCIA);
  assert.equal(todas.kpis.programadas, 2);
  const soloHp = Pausas.getReporteGerencia(db, { empresa_id: 'HP' }, GERENCIA);
  assert.equal(soloHp.kpis.programadas, 1);
  assert.equal(Pausas.getReporteGerencia(db, {}, DEV).sin_datos, true);
});

test('descargar PDF (cumplimiento y gerencia) queda bloqueado por R2, tras validar el acceso', () => {
  const db = dbBase();
  seedConfig(db); seedCoord(db);
  assert.equal(Pausas.descargarReporteCumplimientoPdf(db, {}, CTX_COORD)._validationError, true);
  assert.equal(Pausas.descargarReporteGerenciaPdf(db, {}, GERENCIA)._validationError, true);
  // sin acceso, el mensaje es el de acceso (no el de PDF)
  assert.equal(Pausas.descargarReporteCumplimientoPdf(db, {}, { rol: 'DEV', email: 'nadie@x.cl' })._validationError, true);
});

test('calcularRachasPorArea premia al EQUIPO y una No_realizada no corta la racha', () => {
  const db = dbBase();
  seedConfig(db, { umbral_verde: 50 });
  Pausas.gestionarTrabajador(db, { operacion: 'crear', empresa_id: 'HP', nombre: 'A', email: 'a@hp.cl', area: 'Bodega' }, ADMIN);
  Pausas.gestionarTrabajador(db, { operacion: 'crear', empresa_id: 'HP', nombre: 'B', email: 'b@hp.cl', area: 'Bodega' }, ADMIN);
  const p1 = seedPausaResuelta(db, '2026-01-05', 'Realizada');
  seedAsistencia(db, p1, 'a@hp.cl', 'participo'); seedAsistencia(db, p1, 'b@hp.cl', 'participo');
  seedPausaResuelta(db, '2026-01-06', 'No_realizada'); // no corta
  const p3 = seedPausaResuelta(db, '2026-01-07', 'Realizada');
  seedAsistencia(db, p3, 'a@hp.cl', 'participo'); seedAsistencia(db, p3, 'b@hp.cl', 'participo');
  const rep = Pausas.getReporteGerencia(db, { desde: '2026-01-01', hasta: '2026-01-31' }, ADMIN);
  const bodega = rep.rachas_area.find((r) => r.area === 'Bodega');
  assert.ok(bodega);
  assert.equal(bodega.racha_actual, 2);
});

// ==== roster coordinador + historial (pausas-tendencia-historial) =========

test('listarRosterCoordinador: ADM ve el roster activo de empresas con config; sin_empresa si no coordina', () => {
  const db = dbBase();
  seedConfig(db);
  Pausas.gestionarTrabajador(db, { operacion: 'crear', empresa_id: 'HP', nombre: 'Juan', email: 'juan@hp.cl' }, ADMIN);
  assert.equal(Pausas.listarRosterCoordinador(db, {}, ADMIN).roster.length, 1);
  assert.equal(Pausas.listarRosterCoordinador(db, {}, { rol: 'DEV', email: 'nadie@x.cl' }).sin_empresa, true);
});

test('getHistorialTrabajador: racha actual/maxima sobre resueltas; sin_registro corta; exige trabajador_id y coordinar', () => {
  const db = dbBase();
  seedConfig(db);
  const t = Pausas.gestionarTrabajador(db, { operacion: 'crear', empresa_id: 'HP', nombre: 'Juan', email: 'juan@hp.cl' }, ADMIN);
  const p1 = seedPausaResuelta(db, '2026-01-05', 'Realizada'); seedAsistencia(db, p1, 'juan@hp.cl', 'participo');
  const p2 = seedPausaResuelta(db, '2026-01-06', 'Realizada'); // juan no registra -> sin_registro corta
  const p3 = seedPausaResuelta(db, '2026-01-07', 'Realizada'); seedAsistencia(db, p3, 'juan@hp.cl', 'participo');
  const h = Pausas.getHistorialTrabajador(db, { trabajador_id: t.trabajador_id, desde: '2026-01-01', hasta: '2026-01-31' }, ADMIN);
  assert.equal(h.resumen.participaciones, 2);
  assert.equal(h.resumen.sin_registro, 1);
  assert.equal(h.resumen.racha_actual, 1); // solo la ultima
  assert.equal(h.resumen.racha_maxima, 1);
  assert.equal(Pausas.getHistorialTrabajador(db, {}, ADMIN)._validationError, true);
  assert.equal(Pausas.getHistorialTrabajador(db, { trabajador_id: t.trabajador_id }, { rol: 'DEV', email: 'nadie@x.cl' })._forbidden, true);
});

// ==== triggers de correo (pausas-alertas / reprogramar / mejoras) =========

test('recordatorio: dentro de la ventana envia a roster+coordinadora y marca Recordatorio_enviado; idempotente', async (t) => {
  const mock = conMock(t);
  const db = dbBase();
  seedConfig(db, { hora_habitual: '10:00', min_anticipacion: 15 });
  Pausas.gestionarTrabajador(db, { operacion: 'crear', empresa_id: 'HP', nombre: 'Juan', email: 'juan@hp.cl' }, ADMIN);
  seedCoord(db);
  Pausas.programarDelDia(db, new Date(), ADMIN);
  // dentro de la ventana: ahora = 09:50 (10:00 - 15 = 09:45 <= 09:50)
  const r = await Pausas.enviarRecordatorios(db, { ahoraMin: 9 * 60 + 50 });
  assert.equal(r.pausas_avisadas, 1);
  assert.deepEqual(destinatarios(mock).sort(), ['coord@hp.cl', 'juan@hp.cl']);
  assert.equal(filas(db, 'PAUSAS_PROGRAMADAS')[0].estado, 'Recordatorio_enviado');
  mock.mock.resetCalls();
  await Pausas.enviarRecordatorios(db, { ahoraMin: 9 * 60 + 55 }); // idempotente: ya no esta Programada
  assert.equal(mock.mock.callCount(), 0);
});

test('recordatorio: fuera de la ventana no envia nada', async (t) => {
  const mock = conMock(t);
  const db = dbBase();
  seedConfig(db, { hora_habitual: '10:00', min_anticipacion: 15 });
  Pausas.gestionarTrabajador(db, { operacion: 'crear', empresa_id: 'HP', nombre: 'J', email: 'j@hp.cl' }, ADMIN);
  Pausas.programarDelDia(db, new Date(), ADMIN);
  const r = await Pausas.enviarRecordatorios(db, { ahoraMin: 9 * 60 }); // 09:00 < 09:45
  assert.equal(r.pausas_avisadas, 0);
  assert.equal(mock.mock.callCount(), 0);
});

test('segundo aviso: en la hora manda ultima llamada + avisa a la coordinadora; idempotente; En_curso no re-avisa', async (t) => {
  const mock = conMock(t);
  const db = dbBase();
  seedConfig(db, { hora_habitual: '10:00' });
  Pausas.gestionarTrabajador(db, { operacion: 'crear', empresa_id: 'HP', nombre: 'J', email: 'j@hp.cl' }, ADMIN);
  seedCoord(db);
  Pausas.programarDelDia(db, new Date(), ADMIN);
  const r = await Pausas.enviarSegundosAvisos(db, { ahoraMin: 10 * 60 });
  assert.equal(r.ultima_llamada, 2); // cuenta destinatarios: roster (j) + coordinadora
  assert.equal(r.aviso_coordinadora, 1);
  mock.mock.resetCalls();
  const r2 = await Pausas.enviarSegundosAvisos(db, { ahoraMin: 10 * 60 + 5 });
  assert.equal(r2.ultima_llamada, 0);
  assert.equal(r2.aviso_coordinadora, 0);
});

test('escalarPausasSinIniciar avisa a ADM pasado el margen, una sola vez; no antes', async (t) => {
  const mock = conMock(t);
  const db = dbBase();
  seedConfig(db, { hora_habitual: '10:00' });
  agregarFila_(db, 'USUARIOS', { usuario_id: 'U1', nombre: 'Admin', email: 'admin@hp.cl', empresa_id: 'HP', rol: 'ADM', activo: true, ultimo_acceso: '', creado_por: 'seed' });
  Pausas.programarDelDia(db, new Date(), ADMIN);
  const antes = await Pausas.escalarPausasSinIniciar(db, { ahoraMin: 10 * 60 + 10, margenMin: 30 }); // 10:10 < 10:30
  assert.equal(antes.pausas_escaladas, 0);
  const r = await Pausas.escalarPausasSinIniciar(db, { ahoraMin: 10 * 60 + 40, margenMin: 30 });
  assert.equal(r.pausas_escaladas, 1);
  assert.ok(destinatarios(mock).includes('admin@hp.cl'));
  const r2 = await Pausas.escalarPausasSinIniciar(db, { ahoraMin: 10 * 60 + 45, margenMin: 30 });
  assert.equal(r2.pausas_escaladas, 0); // una sola vez
});

test('reprogramar tras el recordatorio devuelve a Programada, limpia flags, y el recordatorio vuelve a salir', async (t) => {
  const mock = conMock(t);
  const db = dbBase();
  seedConfig(db, { hora_habitual: '10:00', min_anticipacion: 15 });
  Pausas.gestionarTrabajador(db, { operacion: 'crear', empresa_id: 'HP', nombre: 'J', email: 'j@hp.cl' }, ADMIN);
  const p = Pausas.programarDelDia(db, new Date(), ADMIN).creadas[0];
  await Pausas.enviarRecordatorios(db, { ahoraMin: 9 * 60 + 50 });
  assert.equal(filas(db, 'PAUSAS_PROGRAMADAS')[0].estado, 'Recordatorio_enviado');
  const re = Pausas.gestionarPausaProgramada(db, { operacion: 'reprogramar', pausa_id: p.pausa_id, hora_programada: '11:00' }, ADMIN);
  assert.equal(re.estado, 'Programada');
  mock.mock.resetCalls();
  const r = await Pausas.enviarRecordatorios(db, { ahoraMin: 10 * 60 + 50 }); // 11:00 - 15 = 10:45 <= 10:50
  assert.equal(r.pausas_avisadas, 1);
});

test('resumen diario: envia a coordinadora + admin; una Cancelada no genera resumen', async (t) => {
  const mock = conMock(t);
  const db = dbBase();
  seedConfig(db);
  seedCoord(db);
  agregarFila_(db, 'USUARIOS', { usuario_id: 'U1', nombre: 'Admin', email: 'admin@hp.cl', empresa_id: 'HP', rol: 'ADM', activo: true, ultimo_acceso: '', creado_por: 'seed' });
  seedPausaResuelta(db, hoy_(), 'Realizada');
  const r = await Pausas.enviarResumenDiario(db);
  assert.equal(r.pausas, 1);
  assert.ok(destinatarios(mock).includes('coord@hp.cl'));
  assert.ok(destinatarios(mock).includes('admin@hp.cl'));
  // cancelada no cuenta
  const db2 = dbBase();
  seedConfig(db2); seedCoord(db2);
  seedPausaResuelta(db2, hoy_(), 'Cancelada');
  const r2 = await Pausas.enviarResumenDiario(db2);
  assert.equal(r2.pausas, 0);
});

test('enviarReportePeriodico manda a Gerencia+ADM+coordinadoras, con etiqueta semanal/mensual', async (t) => {
  const mock = conMock(t);
  const db = dbBase();
  seedConfig(db);
  seedCoord(db);
  agregarFila_(db, 'USUARIOS', { usuario_id: 'U1', nombre: 'Ger', email: 'ger@hp.cl', empresa_id: 'HP', rol: 'GERENCIA', activo: true, ultimo_acceso: '', creado_por: 'seed' });
  const sem = await Pausas.enviarReportePeriodico(db, 'semanal');
  assert.equal(sem.periodo, 'semanal');
  assert.ok(destinatarios(mock).includes('ger@hp.cl'));
  assert.ok(destinatarios(mock).includes('coord@hp.cl'));
  const men = await Pausas.enviarReportePeriodico(db, 'mensual');
  assert.equal(men.periodo, 'mensual');
});

// ==== cierre automatico (pausas-mejoras.test.js) ==========================

test('cerrarPausasAbiertas: En_curso->Realizada, Programada/Recordatorio_enviado->No_realizada; no toca terminales/Suspendida/otro dia', () => {
  const db = dbBase();
  const enCurso = seedPausaResuelta(db, hoy_(), 'En_curso');
  const prog = seedPausaResuelta(db, hoy_(), 'Programada', 'GDE');
  const record = seedPausaResuelta(db, hoy_(), 'Recordatorio_enviado', 'RLD');
  const suspendida = seedPausaResuelta(db, hoy_(), 'Suspendida', 'X1');
  const otroDia = seedPausaResuelta(db, '2020-01-01', 'Programada', 'X2');
  const r = Pausas.cerrarPausasAbiertas(db);
  assert.equal(r.cerradas, 3);
  const byId = {};
  filas(db, 'PAUSAS_PROGRAMADAS').forEach((p) => { byId[p.pausa_id] = p.estado; });
  assert.equal(byId[enCurso], 'Realizada');
  assert.equal(byId[prog], 'No_realizada');
  assert.equal(byId[record], 'No_realizada');
  assert.equal(byId[suspendida], 'Suspendida');
  assert.equal(byId[otroDia], 'Programada');
});
