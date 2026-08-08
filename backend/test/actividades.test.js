'use strict';

// v7.0 Fase 1 (documentacion/SIGSO-v7.0-propuesta-modulo-gestion-operacional.md):
// nucleo del modulo de Gestion Operacional -- CRUD, maquina de estados (§4.3),
// bitacora unificada y permisos por JEFATURAS (RN-707/708/709).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function seedJefatura(ctx, overrides) {
  const base = Object.assign(
    { jefatura_id: 'JEF-' + Math.random().toString(36).slice(2), jefe_email: 'barbara@rld.cl', subordinado_email: 'marcelo@rld.cl', activo: true },
    overrides
  );
  const fila = ctx.COLUMNAS.JEFATURAS.map((col) => base[col]);
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('JEFATURAS').appendRow(fila);
  return base;
}

// RN-700/701: toda actividad exige supervisor; por defecto es el jefe segun
// JEFATURAS. Se siembra a marcelo bajo barbara y a otro bajo un jefe
// DISTINTO (no barbara) -- asi cualquier test puede crear actividades para
// si mismo sin fijar supervisor_email a mano, y el test de RN-709 (barbara
// NO puede crear para alguien fuera de su equipo) sigue siendo valido.
function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'ACTIVIDADES', ctx.COLUMNAS.ACTIVIDADES);
  seedSheet(ctx, 'ACTIVIDADES_BITACORA', ctx.COLUMNAS.ACTIVIDADES_BITACORA);
  seedSheet(ctx, 'JEFATURAS', ctx.COLUMNAS.JEFATURAS);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Marcelo Gonzalez', 'marcelo@rld.cl', 'RLD', 'DEV', true, '', 'sistema'],
    ['U2', 'Barbara Alvarez', 'barbara@rld.cl', 'RLD', 'JEFATURA', true, '', 'sistema'],
    ['U3', 'Otro Ajeno', 'otro@rld.cl', 'RLD', 'DEV', true, '', 'sistema']
  ]);
  seedJefatura(ctx, { jefatura_id: 'JEF-marcelo', jefe_email: 'barbara@rld.cl', subordinado_email: 'marcelo@rld.cl' });
  seedJefatura(ctx, { jefatura_id: 'JEF-otro', jefe_email: 'otro-jefe@rld.cl', subordinado_email: 'otro@rld.cl' });
  return ctx;
}

const CTX_MARCELO = { email: 'marcelo@rld.cl', nombre: 'Marcelo Gonzalez', rol: 'DEV' };
const CTX_BARBARA = { email: 'barbara@rld.cl', nombre: 'Barbara Alvarez', rol: 'JEFATURA' };
const CTX_OTRO = { email: 'otro@rld.cl', nombre: 'Otro Ajeno', rol: 'DEV' };
const CTX_ADM = { email: 'admin@rld.cl', nombre: 'Admin', rol: 'ADM' };

// --- creacion: RN-700/701/709/710 -------------------------------------------

test('crear (PROPIA): el propio responsable confirma en el mismo acto', () => {
  const ctx = loadConSchema();
  seedJefatura(ctx);
  const actividad = ctx.Actividades.crear(
    { titulo: 'Editar 3 videos de testimonios', fecha_compromiso: '2026-08-14', origen: 'PROPIA' },
    CTX_MARCELO
  );
  assert.equal(actividad.responsable_email, 'marcelo@rld.cl');
  assert.equal(actividad.supervisor_email, 'barbara@rld.cl'); // RN-701: jefe por defecto
  assert.equal(actividad.estado, 'NO_INICIADA');
  assert.equal(actividad.fecha_compromiso, '2026-08-14');
  assert.ok(actividad.confirmada_en, 'debe confirmarse de inmediato');
});

test('crear (ASIGNADA por el supervisor): queda pendiente de confirmar (RN-710)', () => {
  const ctx = loadConSchema();
  seedJefatura(ctx);
  const actividad = ctx.Actividades.crear(
    { titulo: 'Cierre contable julio', responsable_email: 'marcelo@rld.cl', fecha_propuesta: '2026-08-20', origen: 'ASIGNADA' },
    CTX_BARBARA
  );
  assert.equal(actividad.fecha_propuesta, '2026-08-20');
  assert.equal(actividad.fecha_compromiso, '', 'no hay compromiso hasta que el responsable confirme');
  assert.equal(actividad.confirmada_en, '');
});

test('crear: un supervisor NO puede crear actividades fuera de su equipo (RN-709)', () => {
  const ctx = loadConSchema();
  seedJefatura(ctx); // barbara -> marcelo, NO barbara -> otro
  const resultado = ctx.Actividades.crear(
    { titulo: 'Algo', responsable_email: 'otro@rld.cl', fecha_compromiso: '2026-08-20' },
    CTX_BARBARA
  );
  assert.equal(resultado._forbidden, true);
});

test('crear: ADM puede crear para cualquiera', () => {
  const ctx = loadConSchema();
  const actividad = ctx.Actividades.crear(
    { titulo: 'Algo', responsable_email: 'otro@rld.cl', fecha_compromiso: '2026-08-20' },
    CTX_ADM
  );
  assert.equal(actividad.responsable_email, 'otro@rld.cl');
});

test('crear: sin titulo o sin fecha de compromiso, error de validacion', () => {
  const ctx = loadConSchema();
  const sinTitulo = ctx.Actividades.crear({ fecha_compromiso: '2026-08-20' }, CTX_MARCELO);
  assert.equal(sinTitulo._validationError, true);
  const sinFecha = ctx.Actividades.crear({ titulo: 'Algo' }, CTX_MARCELO);
  assert.equal(sinFecha._validationError, true);
});

// --- confirmacion (§4.3.1, RN-711) ------------------------------------------

test('confirmar: el responsable confirma la fecha propuesta', () => {
  const ctx = loadConSchema();
  seedJefatura(ctx);
  const actividad = ctx.Actividades.crear(
    { titulo: 'Cierre contable', responsable_email: 'marcelo@rld.cl', fecha_propuesta: '2026-08-20' },
    CTX_BARBARA
  );
  const confirmada = ctx.Actividades.confirmar({ actividad_id: actividad.actividad_id }, CTX_MARCELO);
  assert.equal(confirmada.fecha_compromiso, '2026-08-20');
  assert.ok(confirmada.confirmada_en);
});

test('confirmar: el responsable puede contraproponer otra fecha (RN-711, no es rechazo)', () => {
  const ctx = loadConSchema();
  seedJefatura(ctx);
  const actividad = ctx.Actividades.crear(
    { titulo: 'Cierre contable', responsable_email: 'marcelo@rld.cl', fecha_propuesta: '2026-08-20' },
    CTX_BARBARA
  );
  const confirmada = ctx.Actividades.confirmar(
    { actividad_id: actividad.actividad_id, fecha_compromiso: '2026-08-25', motivo: 'Necesito mas tiempo' },
    CTX_MARCELO
  );
  assert.equal(confirmada.fecha_compromiso, '2026-08-25');
});

test('confirmar: solo el responsable puede confirmar', () => {
  const ctx = loadConSchema();
  seedJefatura(ctx);
  const actividad = ctx.Actividades.crear(
    { titulo: 'Cierre contable', responsable_email: 'marcelo@rld.cl', fecha_propuesta: '2026-08-20' },
    CTX_BARBARA
  );
  const resultado = ctx.Actividades.confirmar({ actividad_id: actividad.actividad_id }, CTX_BARBARA);
  assert.equal(resultado._forbidden, true);
});

// --- el check-in (§4.4, RN-702, RN-704, RN-705) -----------------------------

test('checkin "sin_cambio": respuesta legitima, mueve ultima_actualizacion (RN-705)', () => {
  const ctx = loadConSchema();
  const actividad = ctx.Actividades.crear({ titulo: 'Brochure', fecha_compromiso: '2026-08-14' }, CTX_MARCELO);
  const actualizado = ctx.Actividades.checkin({ actividad_id: actividad.actividad_id, tipo: 'sin_cambio' }, CTX_MARCELO);
  assert.equal(actualizado.estado, 'EN_CURSO');
  // RN-705: el check-in ES lo unico que mueve ultima_actualizacion -- se
  // verifica que quedo seteada (no que cambio de valor, que en ejecuciones
  // rapidas puede caer dentro del mismo milisegundo que la creacion).
  assert.ok(actualizado.ultima_actualizacion);
});

test('checkin: solo el responsable puede actualizar su actividad (RN-702)', () => {
  const ctx = loadConSchema();
  const actividad = ctx.Actividades.crear({ titulo: 'Brochure', fecha_compromiso: '2026-08-14' }, CTX_MARCELO);
  const resultado = ctx.Actividades.checkin({ actividad_id: actividad.actividad_id, tipo: 'sin_cambio' }, CTX_BARBARA);
  assert.equal(resultado._forbidden, true);
});

test('checkin "bloqueo" exige motivo (RN-704) y pasa a BLOQUEADA', () => {
  const ctx = loadConSchema();
  const actividad = ctx.Actividades.crear({ titulo: 'Videos testimoniales', fecha_compromiso: '2026-08-14' }, CTX_MARCELO);
  const sinMotivo = ctx.Actividades.checkin({ actividad_id: actividad.actividad_id, tipo: 'bloqueo' }, CTX_MARCELO);
  assert.equal(sinMotivo._validationError, true);

  const bloqueada = ctx.Actividades.checkin(
    { actividad_id: actividad.actividad_id, tipo: 'bloqueo', bloqueo_motivo: 'Esperando aprobacion de Contabilidad', bloqueo_responsable_email: 'otro@rld.cl' },
    CTX_MARCELO
  );
  assert.equal(bloqueada.estado, 'BLOQUEADA');
  assert.equal(bloqueada.bloqueo_motivo, 'Esperando aprobacion de Contabilidad');
  assert.ok(bloqueada.bloqueo_desde);

  const desbloqueada = ctx.Actividades.checkin({ actividad_id: actividad.actividad_id, tipo: 'desbloqueo' }, CTX_MARCELO);
  assert.equal(desbloqueada.estado, 'EN_CURSO');
  assert.equal(desbloqueada.bloqueo_motivo, '');
});

test('checkin "listo": sin requiere_validacion cierra directo; con ella pasa a EN_REVISION', () => {
  const ctx = loadConSchema();
  const directa = ctx.Actividades.crear({ titulo: 'Ficha de credenciales', fecha_compromiso: '2026-08-14' }, CTX_MARCELO);
  const cerrada = ctx.Actividades.checkin({ actividad_id: directa.actividad_id, tipo: 'listo' }, CTX_MARCELO);
  assert.equal(cerrada.estado, 'TERMINADA');
  assert.ok(cerrada.fecha_terminada);

  const conValidacion = ctx.Actividades.crear(
    { titulo: 'Informe mensual', fecha_compromiso: '2026-08-14', requiere_validacion: true },
    CTX_MARCELO
  );
  const enRevision = ctx.Actividades.checkin({ actividad_id: conValidacion.actividad_id, tipo: 'listo' }, CTX_MARCELO);
  assert.equal(enRevision.estado, 'EN_REVISION');
  assert.equal(enRevision.fecha_terminada, '');
});

test('checkin sobre actividad cerrada devuelve error de validacion', () => {
  const ctx = loadConSchema();
  const actividad = ctx.Actividades.crear({ titulo: 'Algo', fecha_compromiso: '2026-08-14' }, CTX_MARCELO);
  ctx.Actividades.checkin({ actividad_id: actividad.actividad_id, tipo: 'listo' }, CTX_MARCELO);
  const resultado = ctx.Actividades.checkin({ actividad_id: actividad.actividad_id, tipo: 'sin_cambio' }, CTX_MARCELO);
  assert.equal(resultado._validationError, true);
});

// --- validacion del supervisor ---------------------------------------------

test('validar: el supervisor aprueba (EN_REVISION -> TERMINADA)', () => {
  const ctx = loadConSchema();
  seedJefatura(ctx);
  const actividad = ctx.Actividades.crear(
    { titulo: 'Informe mensual', fecha_compromiso: '2026-08-14', requiere_validacion: true },
    CTX_MARCELO
  );
  ctx.Actividades.checkin({ actividad_id: actividad.actividad_id, tipo: 'listo' }, CTX_MARCELO);
  const aprobada = ctx.Actividades.validar({ actividad_id: actividad.actividad_id, aprobar: true }, CTX_BARBARA);
  assert.equal(aprobada.estado, 'TERMINADA');
});

test('validar: el supervisor devuelve (EN_REVISION -> EN_CURSO)', () => {
  const ctx = loadConSchema();
  seedJefatura(ctx);
  const actividad = ctx.Actividades.crear(
    { titulo: 'Informe mensual', fecha_compromiso: '2026-08-14', requiere_validacion: true },
    CTX_MARCELO
  );
  ctx.Actividades.checkin({ actividad_id: actividad.actividad_id, tipo: 'listo' }, CTX_MARCELO);
  const devuelta = ctx.Actividades.validar({ actividad_id: actividad.actividad_id, aprobar: false, motivo: 'Falta el anexo' }, CTX_BARBARA);
  assert.equal(devuelta.estado, 'EN_CURSO');
});

test('validar: solo el supervisor asignado (o ADM) puede validar', () => {
  const ctx = loadConSchema();
  seedJefatura(ctx);
  const actividad = ctx.Actividades.crear(
    { titulo: 'Informe mensual', fecha_compromiso: '2026-08-14', requiere_validacion: true },
    CTX_MARCELO
  );
  ctx.Actividades.checkin({ actividad_id: actividad.actividad_id, tipo: 'listo' }, CTX_MARCELO);
  const resultado = ctx.Actividades.validar({ actividad_id: actividad.actividad_id, aprobar: true }, CTX_OTRO);
  assert.equal(resultado._forbidden, true);
});

// --- reprogramacion (RN-703) ------------------------------------------------

test('reprogramar exige motivo e incrementa el contador', () => {
  const ctx = loadConSchema();
  const actividad = ctx.Actividades.crear({ titulo: 'Algo', fecha_compromiso: '2026-08-14' }, CTX_MARCELO);
  const sinMotivo = ctx.Actividades.reprogramar({ actividad_id: actividad.actividad_id, fecha_compromiso: '2026-08-20' }, CTX_MARCELO);
  assert.equal(sinMotivo._validationError, true);

  const reprogramada = ctx.Actividades.reprogramar(
    { actividad_id: actividad.actividad_id, fecha_compromiso: '2026-08-20', motivo: 'Cambio de prioridades' },
    CTX_MARCELO
  );
  assert.equal(reprogramada.fecha_compromiso, '2026-08-20');
  assert.equal(reprogramada.reprogramaciones, 1);
});

// --- cancelacion -------------------------------------------------------------

test('cancelar exige motivo y es terminal', () => {
  const ctx = loadConSchema();
  const actividad = ctx.Actividades.crear({ titulo: 'Algo', fecha_compromiso: '2026-08-14' }, CTX_MARCELO);
  const sinMotivo = ctx.Actividades.cancelar({ actividad_id: actividad.actividad_id }, CTX_MARCELO);
  assert.equal(sinMotivo._validationError, true);

  const cancelada = ctx.Actividades.cancelar({ actividad_id: actividad.actividad_id, motivo: 'Ya no aplica' }, CTX_MARCELO);
  assert.equal(cancelada.estado, 'CANCELADA');
});

// --- RN-713: recurrencia -----------------------------------------------------

test('RN-713: al cerrar una actividad MENSUAL nace la siguiente instancia', () => {
  const ctx = loadConSchema();
  const actividad = ctx.Actividades.crear(
    { titulo: 'Cierre contable', fecha_compromiso: '2026-08-14', recurrencia: 'MENSUAL' },
    CTX_MARCELO
  );
  ctx.Actividades.checkin({ actividad_id: actividad.actividad_id, tipo: 'listo' }, CTX_MARCELO);

  const todas = ctx.Actividades.listar({}, CTX_MARCELO);
  assert.equal(todas.length, 2, 'debe existir la cerrada y la nueva instancia');
  const siguiente = todas.find((a) => a.actividad_id !== actividad.actividad_id);
  assert.equal(siguiente.estado, 'NO_INICIADA');
  assert.equal(siguiente.recurrencia_origen_id, actividad.actividad_id);
  assert.equal(siguiente.fecha_compromiso, '2026-09-14T00:00:00.000Z');
});

test('sin recurrencia, cerrar una actividad no genera ninguna nueva', () => {
  const ctx = loadConSchema();
  const actividad = ctx.Actividades.crear({ titulo: 'Algo', fecha_compromiso: '2026-08-14' }, CTX_MARCELO);
  ctx.Actividades.checkin({ actividad_id: actividad.actividad_id, tipo: 'listo' }, CTX_MARCELO);
  const todas = ctx.Actividades.listar({}, CTX_MARCELO);
  assert.equal(todas.length, 1);
});

// --- alcance de lectura: RN-707/708 ------------------------------------------

test('listar: el colaborador solo ve las suyas', () => {
  const ctx = loadConSchema();
  ctx.Actividades.crear({ titulo: 'Mia', fecha_compromiso: '2026-08-14' }, CTX_MARCELO);
  ctx.Actividades.crear({ titulo: 'Ajena', fecha_compromiso: '2026-08-14' }, CTX_OTRO);
  const vistaMarcelo = ctx.Actividades.listar({}, CTX_MARCELO);
  assert.deepEqual(vistaMarcelo.map((a) => a.titulo), ['Mia']);
});

test('listar: el supervisor ve las de su equipo (JEFATURAS), no las de fuera', () => {
  const ctx = loadConSchema();
  seedJefatura(ctx); // barbara -> marcelo
  ctx.Actividades.crear({ titulo: 'De mi equipo', fecha_compromiso: '2026-08-14' }, CTX_MARCELO);
  ctx.Actividades.crear({ titulo: 'Fuera de mi equipo', fecha_compromiso: '2026-08-14' }, CTX_OTRO);
  const vistaBarbara = ctx.Actividades.listar({}, CTX_BARBARA);
  assert.deepEqual(vistaBarbara.map((a) => a.titulo), ['De mi equipo']);
});

test('listar: ADM ve todas', () => {
  const ctx = loadConSchema();
  ctx.Actividades.crear({ titulo: 'Una', fecha_compromiso: '2026-08-14' }, CTX_MARCELO);
  ctx.Actividades.crear({ titulo: 'Otra', fecha_compromiso: '2026-08-14' }, CTX_OTRO);
  const vistaAdm = ctx.Actividades.listar({}, CTX_ADM);
  assert.equal(vistaAdm.length, 2);
});

test('obtenerDetalle: rechaza el acceso a quien no tiene alcance sobre la actividad', () => {
  const ctx = loadConSchema();
  const actividad = ctx.Actividades.crear({ titulo: 'Mia', fecha_compromiso: '2026-08-14' }, CTX_MARCELO);
  const resultado = ctx.Actividades.obtenerDetalle({ actividad_id: actividad.actividad_id }, CTX_OTRO);
  assert.equal(resultado._forbidden, true);
});

test('obtenerDetalle: incluye la bitacora ordenada', () => {
  const ctx = loadConSchema();
  const actividad = ctx.Actividades.crear({ titulo: 'Mia', fecha_compromiso: '2026-08-14' }, CTX_MARCELO);
  ctx.Actividades.checkin({ actividad_id: actividad.actividad_id, tipo: 'sin_cambio' }, CTX_MARCELO);
  const detalle = ctx.Actividades.obtenerDetalle({ actividad_id: actividad.actividad_id }, CTX_MARCELO);
  assert.equal(detalle.actividad.actividad_id, actividad.actividad_id);
  assert.deepEqual(detalle.bitacora.map((b) => b.tipo), ['CREADA', 'CHECKIN_SIN_CAMBIO']);
});
