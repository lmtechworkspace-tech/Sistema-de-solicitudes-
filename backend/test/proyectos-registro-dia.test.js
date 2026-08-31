'use strict';

// v11 (Reingeniería Cronograma, P0): el REGISTRO DEL DÍA -- la celda diaria
// de la Carta Gantt convertida en unidad de información editable. Vive como
// un tipo REGISTRO_DIA dentro de ACTIVIDADES_BITACORA (sin columnas nuevas),
// con upsert por (tarea, día), historial de edición e integración con
// listarBitacora/listarMiBitacora y el PDF. Estos tests verifican el contrato
// completo: creación, edición (upsert + historial), validaciones, permisos y
// que la lectura expone el estado-del-día explícito.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'fake-drive-root' } });
  ['PROYECTOS', 'PROYECTO_INTEGRANTES', 'PROYECTO_HITOS', 'PROYECTO_EVENTOS',
    'PROYECTO_ENTREGABLES', 'PROYECTO_RIESGOS', 'PROYECTO_PLANTILLAS',
    'PROYECTO_PLANTILLA_HITOS', 'SOLICITUDES', 'ACTIVIDADES', 'ACTIVIDADES_BITACORA',
    'JEFATURAS', 'LOG_NOTIFICACIONES', 'CONFIG_FERIADOS', 'NOTIFICACIONES_APP', 'CAT_AREAS']
    .forEach((h) => seedSheet(ctx, h, ctx.COLUMNAS[h]));
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Leo Lider', 'leo@rld.cl', 'RLD', 'DEV', true, '', 'sistema'],
    ['U2', 'Marcelo Integrante', 'marcelo@rld.cl', 'RLD', 'DEV', true, '', 'sistema'],
    ['U3', 'Otro Ajeno', 'otro@rld.cl', 'RLD', 'DEV', true, '', 'sistema'],
    ['U4', 'Cami Colab', 'cami@rld.cl', 'RLD', 'DEV', true, '', 'sistema']
  ]);
  return ctx;
}

const CTX_LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV' };
const CTX_MARCELO = { email: 'marcelo@rld.cl', nombre: 'Marcelo Integrante', rol: 'DEV' };
const CTX_OTRO = { email: 'otro@rld.cl', nombre: 'Otro Ajeno', rol: 'DEV' };
const CTX_CAMI = { email: 'cami@rld.cl', nombre: 'Cami Colab', rol: 'DEV' };

// Un día pasado seguro (el backend rechaza días futuros).
const AYER = (function () {
  const d = new Date(Date.now() - 24 * 3600 * 1000);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
})();
const HOY = (function () {
  const d = new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
})();
const MANANA = (function () {
  const d = new Date(Date.now() + 2 * 24 * 3600 * 1000);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
})();

function armarProyectoConTarea(ctx, opciones) {
  opciones = opciones || {};
  const proyecto = ctx.Proyectos.crear({
    nombre: 'Marketing', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01'
  }, CTX_LEO);
  ctx.Proyectos.gestionarIntegrante({
    proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE'
  }, CTX_LEO);
  if (opciones.conColaborador) {
    ctx.Proyectos.gestionarIntegrante({
      proyecto_id: proyecto.proyecto_id, usuario_email: 'cami@rld.cl', rol_proyecto: 'INTEGRANTE'
    }, CTX_LEO);
  }
  const tarea = ctx.Proyectos.crearTarea(Object.assign({
    proyecto_id: proyecto.proyecto_id, titulo: 'Diseñar campaña',
    responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-09-20'
  }, opciones.conColaborador ? { colaboradores_emails: ['cami@rld.cl'] } : {}), CTX_LEO);
  return { proyecto, tarea };
}

test('guardarRegistroDia: crea un REGISTRO_DIA y listarBitacora expone estado_dia/horas/traza', () => {
  const ctx = loadConSchema();
  const { proyecto, tarea } = armarProyectoConTarea(ctx);

  const r = ctx.Proyectos.guardarRegistroDia({
    proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id,
    dia: AYER, estado_dia: 'en_proceso', horas: 4, nota: 'Avancé el brief'
  }, CTX_MARCELO);
  assert.equal(r.ok, true);
  assert.equal(r.editado, false);

  const filas = ctx.leerFilas_('ACTIVIDADES_BITACORA').filter((b) => b.tipo === 'REGISTRO_DIA');
  assert.equal(filas.length, 1, 'una sola fila REGISTRO_DIA');

  const bitacora = ctx.Proyectos.listarBitacora({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const reg = bitacora.filter((b) => b.tipo === 'REGISTRO_DIA')[0];
  assert.ok(reg, 'listarBitacora devuelve el registro');
  assert.equal(reg.estado_dia, 'en_proceso');
  assert.equal(reg.horas, 4);
  assert.equal(reg.dia, AYER);
  assert.equal(reg.nota, 'Avancé el brief');
  assert.equal(reg.editado_por, 'marcelo@rld.cl');
  assert.equal(reg.ediciones, 0, 'sin ediciones previas todavía');
});

test('guardarRegistroDia: re-guardar el mismo día es UPSERT y acumula historial', () => {
  const ctx = loadConSchema();
  const { proyecto, tarea } = armarProyectoConTarea(ctx);

  ctx.Proyectos.guardarRegistroDia({
    proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id,
    dia: AYER, estado_dia: 'en_proceso', horas: 4, nota: 'v1'
  }, CTX_MARCELO);
  const r2 = ctx.Proyectos.guardarRegistroDia({
    proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id,
    dia: AYER, estado_dia: 'finalizado', horas: 6, nota: 'v2'
  }, CTX_MARCELO);
  assert.equal(r2.editado, true);

  const filas = ctx.leerFilas_('ACTIVIDADES_BITACORA').filter((b) => b.tipo === 'REGISTRO_DIA');
  assert.equal(filas.length, 1, 'sigue siendo UNA fila (upsert, no duplica)');

  const bitacora = ctx.Proyectos.listarBitacora({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const reg = bitacora.filter((b) => b.tipo === 'REGISTRO_DIA')[0];
  assert.equal(reg.estado_dia, 'finalizado');
  assert.equal(reg.horas, 6);
  assert.equal(reg.nota, 'v2');
  assert.equal(reg.ediciones, 1, 'una versión anterior guardada en el historial');

  // El historial conserva la versión anterior (antes→después).
  const datos = JSON.parse(filas[0].datos);
  assert.equal(datos.ediciones.length, 1);
  assert.equal(datos.ediciones[0].estado_dia, 'en_proceso');
  assert.equal(datos.ediciones[0].horas, 4);
  assert.equal(datos.ediciones[0].nota, 'v1');
});

test('guardarRegistroDia: valida estado, horas, día futuro y motivo de bloqueo', () => {
  const ctx = loadConSchema();
  const { proyecto, tarea } = armarProyectoConTarea(ctx);
  const base = { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, dia: AYER };

  assert.equal(ctx.Proyectos.guardarRegistroDia(Object.assign({}, base, { estado_dia: 'inventado' }), CTX_MARCELO)._validationError, true);
  assert.equal(ctx.Proyectos.guardarRegistroDia(Object.assign({}, base, { estado_dia: 'en_proceso', horas: 99 }), CTX_MARCELO)._validationError, true);
  assert.equal(ctx.Proyectos.guardarRegistroDia(Object.assign({}, base, { estado_dia: 'bloqueado' }), CTX_MARCELO)._validationError, true, 'bloqueado sin motivo se rechaza');
  assert.equal(ctx.Proyectos.guardarRegistroDia({ proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, dia: MANANA, estado_dia: 'planificado' }, CTX_MARCELO)._validationError, true, 'día futuro se rechaza');

  // Bloqueado CON motivo sí pasa.
  const ok = ctx.Proyectos.guardarRegistroDia(Object.assign({}, base, { estado_dia: 'bloqueado', bloqueo_motivo: 'Falta aprobación del cliente' }), CTX_MARCELO);
  assert.equal(ok.ok, true);
  // Y hoy es un día válido.
  const okHoy = ctx.Proyectos.guardarRegistroDia({ proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, dia: HOY, estado_dia: 'en_proceso' }, CTX_MARCELO);
  assert.equal(okHoy.ok, true);
});

test('guardarRegistroDia: permisos -- responsable, colaborador y líder pueden; un ajeno no', () => {
  const ctx = loadConSchema();
  const { proyecto, tarea } = armarProyectoConTarea(ctx, { conColaborador: true });
  const base = { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, dia: AYER, estado_dia: 'en_proceso' };

  assert.equal(ctx.Proyectos.guardarRegistroDia(base, CTX_MARCELO).ok, true, 'responsable puede');
  assert.equal(ctx.Proyectos.guardarRegistroDia(base, CTX_CAMI).ok, true, 'colaborador puede');
  assert.equal(ctx.Proyectos.guardarRegistroDia(base, CTX_LEO).ok, true, 'líder del proyecto puede');
  assert.equal(ctx.Proyectos.guardarRegistroDia(base, CTX_OTRO)._forbidden, true, 'un ajeno al proyecto no puede');
});

test('guardarRegistroDia: listarMiBitacora incluye mis registros con estado_dia', () => {
  const ctx = loadConSchema();
  const { proyecto, tarea } = armarProyectoConTarea(ctx);
  ctx.Proyectos.guardarRegistroDia({
    proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id,
    dia: AYER, estado_dia: 'entregado', horas: 3
  }, CTX_MARCELO);

  const mia = ctx.Proyectos.listarMiBitacora({}, CTX_MARCELO);
  const reg = mia.filter((b) => b.tipo === 'REGISTRO_DIA')[0];
  assert.ok(reg, 'mi dedicación cruza el registro');
  assert.equal(reg.estado_dia, 'entregado');
  assert.equal(reg.horas, 3);
});
