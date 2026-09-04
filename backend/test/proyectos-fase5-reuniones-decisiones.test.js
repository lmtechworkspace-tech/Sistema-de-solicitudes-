'use strict';

// v13 (Fase 5, "reuniones formales" + "registro de decisiones" + "riesgo vs
// problema"): eleva los eventos REUNION/DECISION de texto libre de la Sala a
// entidades estructuradas, y agrega "materializar" a Riesgos.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'fake-drive-root' } });
  ['PROYECTOS', 'PROYECTO_INTEGRANTES', 'PROYECTO_HITOS', 'PROYECTO_EVENTOS',
    'PROYECTO_ENTREGABLES', 'PROYECTO_RIESGOS', 'PROYECTO_PLANTILLAS',
    'PROYECTO_PLANTILLA_HITOS', 'PROYECTO_DOCUMENTOS', 'PROYECTO_DOC_VERSIONES',
    'PROYECTO_REUNIONES', 'PROYECTO_REUNION_ACUERDOS', 'PROYECTO_DECISIONES',
    'SOLICITUDES', 'ACTIVIDADES', 'ACTIVIDADES_BITACORA',
    'JEFATURAS', 'LOG_NOTIFICACIONES', 'CONFIG_FERIADOS', 'NOTIFICACIONES_APP', 'CAT_AREAS']
    .forEach((h) => seedSheet(ctx, h, ctx.COLUMNAS[h]));
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Leo Lider', 'leo@rld.cl', 'RLD', 'DEV', true, '', 'sistema'],
    ['U2', 'Marcelo Integrante', 'marcelo@rld.cl', 'RLD', 'DEV', true, '', 'sistema'],
    ['U3', 'Otro Ajeno', 'otro@rld.cl', 'RLD', 'DEV', true, '', 'sistema']
  ]);
  return ctx;
}

const CTX_LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV' };
const CTX_MARCELO = { email: 'marcelo@rld.cl', nombre: 'Marcelo Integrante', rol: 'DEV' };
const CTX_OTRO = { email: 'otro@rld.cl', nombre: 'Otro Ajeno', rol: 'DEV' };

function armarProyecto(ctx) {
  const proyecto = ctx.Proyectos.crear({
    nombre: 'Estandarización comercial', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01'
  }, CTX_LEO);
  ctx.Proyectos.gestionarIntegrante({
    proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE'
  }, CTX_LEO);
  return proyecto;
}

// --- Reuniones --------------------------------------------------------------

test('gestionarReunion (crear): exige título; nace con sus acuerdos iniciales y postea un evento en la Sala', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);

  const sinTitulo = ctx.Proyectos.gestionarReunion({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(sinTitulo._validationError, true);

  const reunion = ctx.Proyectos.gestionarReunion({
    proyecto_id: proyecto.proyecto_id, titulo: 'Kickoff comercial', objetivo: 'Alinear alcance',
    participantes: ['leo@rld.cl', 'Cliente ACME (externo)'],
    acuerdos: ['Definir estados CRM', 'Enviar propuesta de flujo']
  }, CTX_LEO);
  assert.equal(reunion.titulo, 'Kickoff comercial');

  const listado = ctx.Proyectos.listarReuniones({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(listado.length, 1);
  assert.equal(listado[0].acuerdos.length, 2);
  assert.deepEqual(toPlain(listado[0].participantes), ['leo@rld.cl', 'Cliente ACME (externo)']);

  const sala = ctx.Proyectos.listarSala({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const eventoReunion = sala.filter((e) => e.tipo === 'REUNION')[0];
  assert.ok(eventoReunion, 'debe quedar un evento REUNION en la Sala');
  assert.equal(eventoReunion.ref_tipo, 'REUNION');
});

test('gestionarReunion: un OBSERVADOR no puede crear reuniones', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  ctx.Proyectos.gestionarIntegrante({ proyecto_id: proyecto.proyecto_id, usuario_email: 'otro@rld.cl', rol_proyecto: 'OBSERVADOR' }, CTX_LEO);
  const rechazado = ctx.Proyectos.gestionarReunion({ proyecto_id: proyecto.proyecto_id, titulo: 'Reunión' }, CTX_OTRO);
  assert.equal(rechazado._forbidden, true);
});

test('agregarAcuerdoReunion + convertirAcuerdoEnTarea: crea la tarea y deja la traza en el acuerdo', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const reunion = ctx.Proyectos.gestionarReunion({ proyecto_id: proyecto.proyecto_id, titulo: 'Seguimiento' }, CTX_LEO);
  const acuerdo = ctx.Proyectos.agregarAcuerdoReunion({
    proyecto_id: proyecto.proyecto_id, reunion_id: reunion.reunion_id, texto: 'Actualizar manual interno'
  }, CTX_LEO);
  assert.equal(acuerdo.ref_id, '');

  const tarea = ctx.Proyectos.convertirAcuerdoEnTarea({
    proyecto_id: proyecto.proyecto_id, acuerdo_id: acuerdo.acuerdo_id,
    responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-09-01'
  }, CTX_LEO);
  assert.ok(tarea.actividad_id);
  assert.equal(tarea.titulo, 'Actualizar manual interno');
  assert.match(tarea.descripcion, /Seguimiento/);

  const listado = ctx.Proyectos.listarReuniones({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const acuerdoActualizado = listado[0].acuerdos[0];
  assert.equal(acuerdoActualizado.ref_tipo, 'ACTIVIDAD');
  assert.equal(acuerdoActualizado.ref_id, tarea.actividad_id);

  const otraVez = ctx.Proyectos.convertirAcuerdoEnTarea({
    proyecto_id: proyecto.proyecto_id, acuerdo_id: acuerdo.acuerdo_id,
    responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-09-01'
  }, CTX_LEO);
  assert.equal(otraVez._validationError, true, 'un acuerdo ya convertido no se puede convertir de nuevo');
});

test('eliminarAcuerdoReunion: solo si NO se convirtió en tarea', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const reunion = ctx.Proyectos.gestionarReunion({ proyecto_id: proyecto.proyecto_id, titulo: 'Seguimiento' }, CTX_LEO);
  const acuerdoLibre = ctx.Proyectos.agregarAcuerdoReunion({ proyecto_id: proyecto.proyecto_id, reunion_id: reunion.reunion_id, texto: 'Uno' }, CTX_LEO);
  const acuerdoConvertido = ctx.Proyectos.agregarAcuerdoReunion({ proyecto_id: proyecto.proyecto_id, reunion_id: reunion.reunion_id, texto: 'Dos' }, CTX_LEO);
  ctx.Proyectos.convertirAcuerdoEnTarea({
    proyecto_id: proyecto.proyecto_id, acuerdo_id: acuerdoConvertido.acuerdo_id, responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01'
  }, CTX_LEO);

  const rechazado = ctx.Proyectos.eliminarAcuerdoReunion({ proyecto_id: proyecto.proyecto_id, acuerdo_id: acuerdoConvertido.acuerdo_id }, CTX_LEO);
  assert.equal(rechazado._validationError, true);

  const ok = ctx.Proyectos.eliminarAcuerdoReunion({ proyecto_id: proyecto.proyecto_id, acuerdo_id: acuerdoLibre.acuerdo_id }, CTX_LEO);
  assert.equal(ok.ok, true);
  const listado = ctx.Proyectos.listarReuniones({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(listado[0].acuerdos.length, 1);
});

test('gestionarReunion (eliminar): rechaza si algún acuerdo ya se convirtió en tarea; borra completo si no', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const reunionConTarea = ctx.Proyectos.gestionarReunion({ proyecto_id: proyecto.proyecto_id, titulo: 'Con tarea', acuerdos: ['A'] }, CTX_LEO);
  const [acuerdo] = ctx.Proyectos.listarReuniones({ proyecto_id: proyecto.proyecto_id }, CTX_LEO)[0].acuerdos;
  ctx.Proyectos.convertirAcuerdoEnTarea({ proyecto_id: proyecto.proyecto_id, acuerdo_id: acuerdo.acuerdo_id, responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);

  const rechazado = ctx.Proyectos.gestionarReunion({ proyecto_id: proyecto.proyecto_id, accion: 'eliminar', reunion_id: reunionConTarea.reunion_id }, CTX_LEO);
  assert.equal(rechazado._validationError, true);

  const reunionLibre = ctx.Proyectos.gestionarReunion({ proyecto_id: proyecto.proyecto_id, titulo: 'Sin tarea', acuerdos: ['B'] }, CTX_LEO);
  const eliminado = ctx.Proyectos.gestionarReunion({ proyecto_id: proyecto.proyecto_id, accion: 'eliminar', reunion_id: reunionLibre.reunion_id }, CTX_LEO);
  assert.equal(eliminado.ok, true);
  const listado = ctx.Proyectos.listarReuniones({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(listado.length, 1, 'solo queda la reunión con tarea');
});

// --- Decisiones ---------------------------------------------------------

test('gestionarDecision: crear/editar/eliminar (soft-delete) + postea evento en la Sala', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);

  const sinDescripcion = ctx.Proyectos.gestionarDecision({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(sinDescripcion._validationError, true);

  const decision = ctx.Proyectos.gestionarDecision({
    proyecto_id: proyecto.proyecto_id, descripcion: 'Usar CRM nuevo para el piloto',
    contexto: 'El CRM actual no soporta los nuevos estados', impacto: 'Retrasa el piloto 1 semana',
    responsable_email: 'leo@rld.cl'
  }, CTX_LEO);
  assert.equal(decision.descripcion, 'Usar CRM nuevo para el piloto');

  const editada = ctx.Proyectos.gestionarDecision({
    proyecto_id: proyecto.proyecto_id, decision_id: decision.decision_id, impacto: 'Retrasa el piloto 2 semanas'
  }, CTX_LEO);
  assert.equal(editada.impacto, 'Retrasa el piloto 2 semanas');
  assert.equal(editada.descripcion, 'Usar CRM nuevo para el piloto', 'editar impacto no borra el resto');

  const sala = ctx.Proyectos.listarSala({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(sala.filter((e) => e.tipo === 'DECISION').length, 1);

  const eliminada = ctx.Proyectos.gestionarDecision({ proyecto_id: proyecto.proyecto_id, accion: 'eliminar', decision_id: decision.decision_id }, CTX_LEO);
  assert.equal(eliminada.activo, false);
  const listado = ctx.Proyectos.listarDecisiones({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(listado.length, 0);
});

test('gestionarDecision: sin responsable explícito, cae en el líder del proyecto', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const decision = ctx.Proyectos.gestionarDecision({ proyecto_id: proyecto.proyecto_id, descripcion: 'Decisión sin responsable' }, CTX_LEO);
  assert.equal(decision.responsable_email, 'leo@rld.cl');
});

// --- Documentos asociados a Reunión/Decisión (Fase 4 extendida) ---------

test('gestionarDocumento: ref_tipo REUNION/DECISION exige que pertenezcan al MISMO proyecto', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const otroProyecto = ctx.Proyectos.crear({ nombre: 'Otro', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01' }, CTX_LEO);
  const reunionAjena = ctx.Proyectos.gestionarReunion({ proyecto_id: otroProyecto.proyecto_id, titulo: 'De otro proyecto' }, CTX_LEO);
  const decisionAjena = ctx.Proyectos.gestionarDecision({ proyecto_id: otroProyecto.proyecto_id, descripcion: 'De otro proyecto' }, CTX_LEO);
  const PDF_B64 = Buffer.from('%PDF-1.4 x').toString('base64');

  const rechazadoReunion = ctx.Proyectos.gestionarDocumento({
    proyecto_id: proyecto.proyecto_id, nombre: 'Doc', nombre_archivo: 'a.pdf', contenido_base64: PDF_B64,
    ref_tipo: 'REUNION', ref_id: reunionAjena.reunion_id
  }, CTX_LEO);
  assert.equal(rechazadoReunion._validationError, true);

  const rechazadoDecision = ctx.Proyectos.gestionarDocumento({
    proyecto_id: proyecto.proyecto_id, nombre: 'Doc', nombre_archivo: 'a.pdf', contenido_base64: PDF_B64,
    ref_tipo: 'DECISION', ref_id: decisionAjena.decision_id
  }, CTX_LEO);
  assert.equal(rechazadoDecision._validationError, true);

  const reunionPropia = ctx.Proyectos.gestionarReunion({ proyecto_id: proyecto.proyecto_id, titulo: 'Propia' }, CTX_LEO);
  const aceptado = ctx.Proyectos.gestionarDocumento({
    proyecto_id: proyecto.proyecto_id, nombre: 'Doc', nombre_archivo: 'a.pdf', contenido_base64: PDF_B64,
    ref_tipo: 'REUNION', ref_id: reunionPropia.reunion_id
  }, CTX_LEO);
  assert.equal(aceptado.ref_tipo, 'REUNION');
});

// --- Riesgo -> Problema (materializar) -----------------------------------

test('gestionarRiesgo: materializar cambia ABIERTO->MATERIALIZADO; no aplica a un riesgo ya cerrado', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const riesgo = ctx.Proyectos.gestionarRiesgo({
    proyecto_id: proyecto.proyecto_id, descripcion: 'El proveedor puede fallar', probabilidad: 'ALTA', impacto: 'ALTA'
  }, CTX_LEO);

  const materializado = ctx.Proyectos.gestionarRiesgo({ proyecto_id: proyecto.proyecto_id, accion: 'materializar', riesgo_id: riesgo.riesgo_id }, CTX_LEO);
  assert.equal(materializado.estado, 'MATERIALIZADO');

  const otraVez = ctx.Proyectos.gestionarRiesgo({ proyecto_id: proyecto.proyecto_id, accion: 'materializar', riesgo_id: riesgo.riesgo_id }, CTX_LEO);
  assert.equal(otraVez._validationError, true, 'ya no está ABIERTO, no se puede materializar de nuevo');

  const sala = ctx.Proyectos.listarSala({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.ok(sala.some((e) => /materializado/i.test(e.titulo)));
});

test('gestionarRiesgo: el edit genérico NO puede mover el estado a mano (solo eliminar/materializar)', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const riesgo = ctx.Proyectos.gestionarRiesgo({
    proyecto_id: proyecto.proyecto_id, descripcion: 'Riesgo', probabilidad: 'MEDIA', impacto: 'MEDIA'
  }, CTX_LEO);
  const editado = ctx.Proyectos.gestionarRiesgo({
    proyecto_id: proyecto.proyecto_id, riesgo_id: riesgo.riesgo_id, estado: 'MATERIALIZADO', descripcion: 'Riesgo editado'
  }, CTX_LEO);
  assert.equal(editado.estado, 'ABIERTO', 'el intento de fijar estado a mano se ignora');
  assert.equal(editado.descripcion, 'Riesgo editado', 'el resto de la edición sí se aplica');
});
