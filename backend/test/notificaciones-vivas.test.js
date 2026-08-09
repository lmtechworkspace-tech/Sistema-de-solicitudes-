'use strict';

/**
 * v7.1 (documentacion/SIGSO-v7.1-notificaciones-vivas.md): cola de
 * notificaciones "en vivo" -- espejo de enviarCorreo_ para un toast/modal en
 * pantalla. Cubre el helper de encolado, el polling del cliente
 * (sincronizarNotificacionesApp_), marcar leida, y los hooks reales en
 * Pausas (recordatorio/ultima llamada/aviso coordinador) y Actividades
 * (pedirActualizacion + alertas diarias) -- prueba de que el canal es
 * transversal, no exclusivo de un modulo.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function load() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'NOTIFICACIONES_APP', ctx.COLUMNAS.NOTIFICACIONES_APP, []);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  return ctx;
}

test('encolarNotificacionApp_ escribe una fila no leida con expiracion futura', () => {
  const ctx = load();
  const r = ctx.encolarNotificacionApp_('ana@hp.cl', 'PRUEBA', 'Título', 'Mensaje', 'pausas', 'Ver', 6);
  assert.equal(r.encolado, true);

  const filas = ctx.leerFilas_('NOTIFICACIONES_APP');
  assert.equal(filas.length, 1);
  assert.equal(filas[0].destinatario_email, 'ana@hp.cl');
  assert.equal(filas[0].tipo, 'PRUEBA');
  assert.equal(filas[0].leida, 'FALSE');
  assert.ok(new Date(filas[0].expira_en).getTime() > Date.now());
});

test('encolarNotificacionApp_ sin destinatario no escribe nada', () => {
  const ctx = load();
  const r = ctx.encolarNotificacionApp_('', 'PRUEBA', 'x', 'y');
  assert.equal(r.encolado, false);
  assert.equal(ctx.leerFilas_('NOTIFICACIONES_APP').length, 0);
});

test('encolarNotificacionApp_ no rompe el flujo si la hoja no existe (instalacion vieja)', () => {
  // v7.1: instalaciones que no re-corrieron el Instalador aun no tienen
  // NOTIFICACIONES_APP -- el correo (canal confiable) no debe verse afectado.
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  const r = ctx.encolarNotificacionApp_('ana@hp.cl', 'PRUEBA', 'x', 'y');
  assert.equal(r.encolado, false);
  assert.equal(r.motivo, 'error_encolado');
});

test('sincronizarNotificacionesApp_ devuelve solo las no leidas y no vencidas del destinatario de la sesion', () => {
  const ctx = load();
  ctx.encolarNotificacionApp_('ana@hp.cl', 'A', 'Para Ana', '', 'mi_trabajo', '', 6);
  ctx.encolarNotificacionApp_('juan@hp.cl', 'B', 'Para Juan', '', 'mi_trabajo', '', 6);
  ctx.encolarNotificacionApp_('ana@hp.cl', 'C', 'Vencida de Ana', '', 'mi_trabajo', '', -1);

  const resp = ctx.sincronizarNotificacionesApp_({ email: 'ana@hp.cl' });
  assert.equal(resp.notificaciones.length, 1);
  assert.equal(resp.notificaciones[0].titulo, 'Para Ana');
});

test('sincronizarNotificacionesApp_ no revienta si la hoja no existe todavia', () => {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  const resp = ctx.sincronizarNotificacionesApp_({ email: 'ana@hp.cl' });
  assert.equal(resp.notificaciones.length, 0);
});

test('marcarNotificacionAppLeida_ solo la marca si el contexto es el propio destinatario', () => {
  const ctx = load();
  ctx.encolarNotificacionApp_('ana@hp.cl', 'A', 'Para Ana', '');
  const notifId = ctx.leerFilas_('NOTIFICACIONES_APP')[0].notif_id;

  const otro = ctx.marcarNotificacionAppLeida_({ email: 'juan@hp.cl' }, notifId);
  assert.equal(otro.actualizado, false);
  assert.equal(ctx.leerFilas_('NOTIFICACIONES_APP')[0].leida, 'FALSE');

  const propio = ctx.marcarNotificacionAppLeida_({ email: 'ana@hp.cl' }, notifId);
  assert.equal(propio.actualizado, true);
  assert.equal(ctx.leerFilas_('NOTIFICACIONES_APP')[0].leida, 'TRUE');

  // Ya marcada: sincronizar deja de devolverla.
  assert.equal(ctx.sincronizarNotificacionesApp_({ email: 'ana@hp.cl' }).notificaciones.length, 0);
});

test('handleSincronizarNotificacionesApp_ / handleMarcarNotificacionAppLeida_ responden ok:true', () => {
  const ctx = load();
  ctx.encolarNotificacionApp_('ana@hp.cl', 'A', 'Para Ana', '');
  const r1 = ctx.handleSincronizarNotificacionesApp_({}, { email: 'ana@hp.cl' });
  const body1 = JSON.parse(r1.getContent());
  assert.equal(body1.ok, true);
  assert.equal(body1.data.notificaciones.length, 1);

  const notifId = body1.data.notificaciones[0].notif_id;
  const r2 = ctx.handleMarcarNotificacionAppLeida_({ notif_id: notifId }, { email: 'ana@hp.cl' });
  const body2 = JSON.parse(r2.getContent());
  assert.equal(body2.ok, true);
  assert.equal(body2.data.actualizado, true);
});

test('sincronizarNotificacionesApp / marcarNotificacionAppLeida no tienen gate de modulo (MODULO_POR_ACCION)', () => {
  const ctx = load();
  assert.equal(ctx.MODULO_POR_ACCION.sincronizarNotificacionesApp, undefined);
  assert.equal(ctx.MODULO_POR_ACCION.marcarNotificacionAppLeida, undefined);
  assert.equal(typeof ctx.BACKOFFICE_ACTIONS.sincronizarNotificacionesApp, 'function');
  assert.equal(typeof ctx.BACKOFFICE_ACTIONS.marcarNotificacionAppLeida, 'function');
});

// ---- Hooks reales: Pausas (el caso que detono el pedido) ------------------

function loadPausas() {
  function hoyClave() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
  }
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'NOTIFICACIONES_APP', ctx.COLUMNAS.NOTIFICACIONES_APP, []);
  seedSheet(ctx, 'PAUSAS_CONFIG', ctx.COLUMNAS.PAUSAS_CONFIG, [
    ['HP', '09:30', '1,2,3,4,5', 10, 15, 80, 60, true]
  ]);
  seedSheet(ctx, 'PAUSAS_COORDINADORES', ctx.COLUMNAS.PAUSAS_COORDINADORES, [
    ['CO-1', 'HP', 'Amarlla', 'amarlla@hp.cl', 'titular', true]
  ]);
  seedSheet(ctx, 'PAUSAS_TRABAJADORES', ctx.COLUMNAS.PAUSAS_TRABAJADORES, [
    ['T1', 'HP', 'Juan', 'juan@hp.cl', 'Bodega', 'Operario', true, '2026-01-01']
  ]);
  seedSheet(ctx, 'PAUSAS_PROGRAMADAS', ctx.COLUMNAS.PAUSAS_PROGRAMADAS,
    [['PA-1', 'HP', hoyClave(), '09:30', '', '', '', 'Programada', 10, '']]);
  seedSheet(ctx, 'PAUSAS_ASISTENCIA', ctx.COLUMNAS.PAUSAS_ASISTENCIA, []);
  seedSheet(ctx, 'PAUSAS_LOG', ctx.COLUMNAS.PAUSAS_LOG);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, []);
  seedSheet(ctx, 'CUENTAS_PORTAL', ctx.COLUMNAS.CUENTAS_PORTAL, []);
  seedSheet(ctx, 'SESIONES_PORTAL', ctx.COLUMNAS.SESIONES_PORTAL, []);
  return ctx;
}

test('Pausas.enviarRecordatoriosPausas encola una notificacion en vivo por cada correo enviado', () => {
  const ctx = loadPausas();
  ctx.Pausas.enviarRecordatoriosPausas({ ahoraMin: 1439 });
  const notifs = ctx.leerFilas_('NOTIFICACIONES_APP');
  // roster (1 trabajador) + coordinadora = 2, mismo total que MailApp._enviados.
  assert.equal(notifs.length, ctx.MailApp._enviados.length);
  assert.ok(notifs.every((n) => n.tipo === 'PAUSA_RECORDATORIO' && n.modulo_id === 'pausas'));
});

test('Pausas.enviarSegundosAvisosPausas encola "ultima llamada" (trabajadores+coordinadora) y "aviso coordinador" por separado', () => {
  const ctx = loadPausas();
  ctx.Pausas.enviarSegundosAvisosPausas({ ahoraMin: 570 }); // 09:30
  const notifs = ctx.leerFilas_('NOTIFICACIONES_APP');
  // "ultima llamada" va a destinatariosRecordatorio_ (roster + coordinadoras):
  // Juan + Amarlla = 2. "aviso coordinador" es aparte, solo coordinadoras: 1.
  const ultimaLlamada = notifs.filter((n) => n.tipo === 'PAUSA_ULTIMA_LLAMADA');
  const avisoCoord = notifs.filter((n) => n.tipo === 'PAUSA_AVISO_COORDINADOR');
  assert.equal(ultimaLlamada.length, 2);
  assert.equal(avisoCoord.length, 1);
  assert.equal(avisoCoord[0].modulo_id, 'pausas_coordinacion');
  assert.equal(avisoCoord[0].destinatario_email, 'amarlla@hp.cl');
});

// ---- Hooks reales: Actividades (prueba de transversalidad) ----------------

function loadActividades() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'NOTIFICACIONES_APP', ctx.COLUMNAS.NOTIFICACIONES_APP, []);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'JEFATURAS', ctx.COLUMNAS.JEFATURAS, [
    ['J1', 'jefe@hp.cl', 'ana@hp.cl', true]
  ]);
  seedSheet(ctx, 'ACTIVIDADES', ctx.COLUMNAS.ACTIVIDADES, [[
    'ACT-1', 'Tarea de prueba', 'desc', 'PROPIA', '',
    'ana@hp.cl', 'Ana', 'jefe@hp.cl',
    '', '', '', 'P3', 'EN_CURSO', 'M',
    '', '', new Date().toISOString(), '',
    'NINGUNA', '', '', '',
    'VERDE', '', '', '',
    '', new Date().toISOString(), 0,
    new Date().toISOString(), 'ana@hp.cl', 'TRUE'
  ]]);
  seedSheet(ctx, 'ACTIVIDADES_BITACORA', ctx.COLUMNAS.ACTIVIDADES_BITACORA, []);
  return ctx;
}

test('Actividades.pedirActualizacion encola una notificacion en vivo para el responsable (mi_trabajo)', () => {
  const ctx = loadActividades();
  const r = ctx.Actividades.pedirActualizacion(
    { actividad_id: 'ACT-1', nota: 'porfa actualiza' },
    { rol: 'JEFATURA', email: 'jefe@hp.cl' }
  );
  assert.equal(r.enviado, true);

  const notifs = ctx.leerFilas_('NOTIFICACIONES_APP');
  assert.equal(notifs.length, 1);
  assert.equal(notifs[0].destinatario_email, 'ana@hp.cl');
  assert.equal(notifs[0].modulo_id, 'mi_trabajo');
  assert.equal(notifs[0].tipo, 'PEDIR_ACTUALIZACION_ACTIVIDAD');
});
