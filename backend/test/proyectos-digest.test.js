'use strict';

// v10 (Fase D, propuestas 09 "resumen diario del proyecto" + 12
// "notificaciones agrupadas"): Notificaciones.enviarResumenDiarioProyectos
// junta las novedades de la Sala de cada proyecto desde la ultima corrida y
// manda UNA notificacion (app + correo) al lider -- nunca una por evento.
// Sin trigger propio: se cuelga del pase diario ya existente (Triggers.gs).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

const CLAVE_ULTIMA_CORRIDA = 'SIGSO_PROY_DIGEST_ULTIMA_CORRIDA';

function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'PROYECTOS', ctx.COLUMNAS.PROYECTOS);
  seedSheet(ctx, 'PROYECTO_INTEGRANTES', ctx.COLUMNAS.PROYECTO_INTEGRANTES);
  seedSheet(ctx, 'PROYECTO_HITOS', ctx.COLUMNAS.PROYECTO_HITOS);
  seedSheet(ctx, 'PROYECTO_EVENTOS', ctx.COLUMNAS.PROYECTO_EVENTOS);
  seedSheet(ctx, 'PROYECTO_ENTREGABLES', ctx.COLUMNAS.PROYECTO_ENTREGABLES);
  seedSheet(ctx, 'PROYECTO_RIESGOS', ctx.COLUMNAS.PROYECTO_RIESGOS);
  seedSheet(ctx, 'PROYECTO_PLANTILLAS', ctx.COLUMNAS.PROYECTO_PLANTILLAS);
  seedSheet(ctx, 'PROYECTO_PLANTILLA_HITOS', ctx.COLUMNAS.PROYECTO_PLANTILLA_HITOS);
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'ACTIVIDADES', ctx.COLUMNAS.ACTIVIDADES);
  seedSheet(ctx, 'ACTIVIDADES_BITACORA', ctx.COLUMNAS.ACTIVIDADES_BITACORA);
  seedSheet(ctx, 'JEFATURAS', ctx.COLUMNAS.JEFATURAS);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'CONFIG_FERIADOS', ctx.COLUMNAS.CONFIG_FERIADOS);
  seedSheet(ctx, 'NOTIFICACIONES_APP', ctx.COLUMNAS.NOTIFICACIONES_APP);
  seedSheet(ctx, 'CAT_AREAS', ctx.COLUMNAS.CAT_AREAS);
  return ctx;
}

const CTX_LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV' };

function crearProyectoBase(ctx, overrides) {
  return ctx.Proyectos.crear(Object.assign({
    nombre: 'Migración ERP', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-10-01'
  }, overrides), CTX_LEO);
}

// Sin esto, la PRIMERA corrida real del test se llevaria puesto el evento
// "Proyecto creado" (la primera corrida sin marca guardada mira las
// ultimas 24h) -- se fija la marca directo, sin pasar por la funcion real
// (que ademas mandaria un correo/notificacion de mas y pisaria el dedup
// diario que el segundo test necesita usar limpio).
function marcarCorridaAhora(ctx) {
  ctx.PropertiesService.getScriptProperties().setProperty(CLAVE_ULTIMA_CORRIDA, new Date().toISOString());
}

// Espera activa a que el reloj real avance al menos 1ms -- necesario porque
// varias operaciones sincronas seguidas (crear el proyecto, marcar la
// corrida, publicar en la sala) pueden caer en el MISMO milisegundo de
// reloj real, y la comparacion de "desde cuando" es por timestamp exacto:
// sin este separador, un evento "nuevo" del test podria empatar con la
// marca de la corrida anterior y quedar del lado equivocado.
function esperarSiguienteMs() {
  var inicio = Date.now();
  while (Date.now() === inicio) { /* espera activa, solo para tests */ }
}

test('enviarResumenDiarioProyectos: agrupa las novedades de un proyecto en UNA notificacion app + UN correo al lider', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  esperarSiguienteMs();
  marcarCorridaAhora(ctx);
  esperarSiguienteMs();

  ctx.Proyectos.publicarEnSala({ proyecto_id: proyecto.proyecto_id, tipo: 'COMENTARIO', cuerpo: 'Avance del día' }, CTX_LEO);
  ctx.Proyectos.publicarEnSala({ proyecto_id: proyecto.proyecto_id, tipo: 'DECISION', cuerpo: 'Se decide postergar el cierre' }, CTX_LEO);

  const resultados = ctx.Notificaciones.enviarResumenDiarioProyectos();
  assert.equal(resultados.length, 1);
  assert.equal(resultados[0].eventos, 2);

  // UN solo correo (no uno por evento) al lider.
  const correos = ctx.GmailApp._enviados.filter((c) => c.destinatario === 'leo@rld.cl');
  assert.equal(correos.length, 1);
  assert.match(correos[0].asunto, /Migración ERP/);
  assert.match(correos[0].cuerpo, /Comentario/);
  assert.match(correos[0].cuerpo, /Decisión/);

  // UNA sola notificacion en la app, agrupada.
  const notifs = ctx.leerFilasSeguro_('NOTIFICACIONES_APP').filter((n) => n.destinatario_email === 'leo@rld.cl');
  assert.equal(notifs.length, 1);
  assert.match(notifs[0].titulo, /2 novedades en Migración ERP/);
});

test('enviarResumenDiarioProyectos: sin novedades desde la ultima corrida, no manda nada', () => {
  const ctx = loadConSchema();
  crearProyectoBase(ctx);
  esperarSiguienteMs();
  marcarCorridaAhora(ctx);

  const sinNovedades = ctx.Notificaciones.enviarResumenDiarioProyectos();
  assert.equal(sinNovedades.length, 0);
  assert.equal(ctx.GmailApp._enviados.length, 0);
});

test('enviarResumenDiarioProyectos: no duplica el correo del mismo día aunque haya una novedad nueva', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  // Se deja pasar la corrida inicial (se lleva el evento "Proyecto creado"
  // -- correcto: la primera corrida sin marca guardada mira las ultimas
  // 24h, no encuentra "nada" solo porque el proyecto es nuevo).
  const primeraCorrida = ctx.Notificaciones.enviarResumenDiarioProyectos();
  assert.equal(primeraCorrida.length, 1);
  assert.equal(ctx.GmailApp._enviados.length, 1);

  // Novedad nueva, MISMO día: el calculo la encuentra, pero el dedup diario
  // de enviarCorreo_ (mismo criterio que RN-027 "SLA vencido, 1 vez/dia")
  // bloquea un SEGUNDO correo al mismo lider por el mismo proyecto hoy.
  ctx.Proyectos.publicarEnSala({ proyecto_id: proyecto.proyecto_id, tipo: 'COMENTARIO', cuerpo: 'Otra más' }, CTX_LEO);
  ctx.Notificaciones.enviarResumenDiarioProyectos();

  const correos = ctx.GmailApp._enviados.filter((c) => c.destinatario === 'leo@rld.cl');
  assert.equal(correos.length, 1);
});
