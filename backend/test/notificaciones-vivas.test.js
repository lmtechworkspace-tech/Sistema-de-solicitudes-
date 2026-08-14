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

function makeEventBO(body) {
  return { postData: { contents: JSON.stringify(body), type: 'text/plain' } };
}

// v9.0f: reproduce el flujo REAL reportado -- acceso por el portal (token),
// no llamando las funciones internas directo (eso ya no distingue si el
// bug esta en como doPost resuelve la identidad del token). Sesion de
// portal, "marcar todas" via doPost, y una sincronizacion nueva (como
// recargar la pagina) para confirmar que no vuelve.
function loadPortalConSesion() {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' },
    activeUserEmail: ''
  });
  seedSheet(ctx, 'NOTIFICACIONES_APP', ctx.COLUMNAS.NOTIFICACIONES_APP, []);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'CUENTAS_PORTAL', ctx.COLUMNAS.CUENTAS_PORTAL, [
    ['CTA-1', 'lisseth', 'Lisseth Vilchez', 'Gestor técnico', 'hash-x', 'sal-x',
      JSON.stringify(['Lisseth.Vilchez@GrupoB.cl']), 'DEV',
      JSON.stringify(['nueva_solicitud', 'mis_solicitudes', 'bandeja', 'mi_trabajo', 'proyectos', 'pausas']),
      'HP', true, false, '', 'test']
  ]);
  seedSheet(ctx, 'SESIONES_PORTAL', ctx.COLUMNAS.SESIONES_PORTAL, [
    ['token-lisseth', 'CTA-1', new Date(Date.now() + 3600000).toISOString(), new Date().toISOString()]
  ]);
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
  assert.equal(ctx.MODULO_POR_ACCION.marcarTodasNotificacionesAppLeidas, undefined);
  assert.equal(typeof ctx.BACKOFFICE_ACTIONS.sincronizarNotificacionesApp, 'function');
  assert.equal(typeof ctx.BACKOFFICE_ACTIONS.marcarNotificacionAppLeida, 'function');
  assert.equal(typeof ctx.BACKOFFICE_ACTIONS.marcarTodasNotificacionesAppLeidas, 'function');
});

test('v9.0g: sincronizarNotificacionesApp_/marcarTodas_/purgar tratan leida=true (booleano real) igual que \'TRUE\' (string)', () => {
  // Sheets no siempre devuelve el mismo tipo para una celda escrita como el
  // string 'TRUE' -- si la columna llega a tener formato de casilla
  // (checkbox), getValues() la devuelve como booleano real `true`. La
  // comparacion vieja (String(valor) !== 'TRUE') fallaba en ese caso:
  // String(true) es 'true' (minuscula), nunca 'TRUE' -- una fila realmente
  // leida se seguia contando como pendiente.
  const ctx = load();
  ctx.encolarNotificacionApp_('ana@hp.cl', 'A', 'Ya leida (booleano)', '');
  ctx.encolarNotificacionApp_('ana@hp.cl', 'B', 'Pendiente', '');
  const filas = ctx.leerFilas_('NOTIFICACIONES_APP');
  // Simula lo que Sheets devolveria con la columna en formato casilla:
  // se pisa el valor crudo con el booleano JS `true`, no el string.
  ctx.actualizarFilaPorId_('NOTIFICACIONES_APP', 'notif_id', filas[0].notif_id, { leida: true });

  const sync = ctx.sincronizarNotificacionesApp_({ email: 'ana@hp.cl' });
  assert.equal(sync.notificaciones.length, 1);
  assert.equal(sync.notificaciones[0].titulo, 'Pendiente');

  // marcarTodas no debe re-marcar (ni fallar) sobre la que ya esta leida con
  // booleano real -- solo actualiza la pendiente real.
  const r = ctx.marcarTodasNotificacionesAppLeidas_({ email: 'ana@hp.cl' });
  assert.equal(r.actualizadas, 1);

  // Y la purga la reconoce como "ya leida" (booleano) para poder borrarla.
  const p = ctx.purgarNotificacionesApp_();
  assert.equal(p.borradas, 2);
});

// ---- v7.1 Bloque B: escritura por lote, marcar todas, purga --------------

test('encolarNotificacionAppLote_ escribe varias filas en una sola pasada', () => {
  const ctx = load();
  const r = ctx.encolarNotificacionAppLote_([
    { destinatario: 'a@hp.cl', tipo: 'X', titulo: 'T1', mensaje: '', modulo_id: 'pausas', texto_accion: 'V', vidaHoras: 6 },
    { destinatario: 'b@hp.cl', tipo: 'X', titulo: 'T2' },
    { destinatario: '', tipo: 'X', titulo: 'ignorada' } // sin destinatario -> se salta
  ]);
  assert.equal(r.encolado, 2);
  assert.equal(ctx.leerFilas_('NOTIFICACIONES_APP').length, 2);
});

test('marcarTodasNotificacionesAppLeidas_ marca solo las del destinatario de la sesion', () => {
  const ctx = load();
  ctx.encolarNotificacionAppLote_([
    { destinatario: 'ana@hp.cl', tipo: 'X', titulo: 'A1' },
    { destinatario: 'ana@hp.cl', tipo: 'X', titulo: 'A2' },
    { destinatario: 'juan@hp.cl', tipo: 'X', titulo: 'J1' }
  ]);
  const r = ctx.marcarTodasNotificacionesAppLeidas_({ email: 'ana@hp.cl' });
  assert.equal(r.actualizadas, 2);
  assert.equal(ctx.sincronizarNotificacionesApp_({ email: 'ana@hp.cl' }).notificaciones.length, 0);
  assert.equal(ctx.sincronizarNotificacionesApp_({ email: 'juan@hp.cl' }).notificaciones.length, 1);
});

test('v9.0e: encolar/sincronizar/marcar-leida no dependen de mayusculas/espacios en el correo', () => {
  // Bug real (feedback usuario): "marcar todas" no persistia -- las
  // comparaciones de destinatario_email eran case-sensitive, y algun
  // llamador encolaba el correo con distinta capitalizacion/espacios a como
  // llega contexto.email en la sesion (Google/portal), asi que la fila
  // nunca calzaba al marcar leida: al recargar, la notificacion "ya vista"
  // volvia a aparecer como pendiente.
  const ctx = load();
  ctx.encolarNotificacionApp_('  Ana@HP.cl ', 'A', 'Para Ana', '');
  // Se guarda ya normalizado (minuscula, sin espacios).
  assert.equal(ctx.leerFilas_('NOTIFICACIONES_APP')[0].destinatario_email, 'ana@hp.cl');

  // La sesion trae el correo con otra capitalizacion (tipico de un login
  // Google que ya normaliza distinto, o un dato tecleado por un Admin).
  const sesion = { email: 'ANA@hp.cl' };
  assert.equal(ctx.sincronizarNotificacionesApp_(sesion).notificaciones.length, 1);

  const r = ctx.marcarTodasNotificacionesAppLeidas_(sesion);
  assert.equal(r.actualizadas, 1);
  assert.equal(ctx.sincronizarNotificacionesApp_(sesion).notificaciones.length, 0);
  // Y tras "recargar la pagina" (una sincronizacion nueva), sigue sin volver.
  assert.equal(ctx.sincronizarNotificacionesApp_({ email: 'ana@hp.cl' }).notificaciones.length, 0);
});

test('v9.0e: marcarNotificacionAppLeida_ tambien tolera distinta capitalizacion del correo', () => {
  const ctx = load();
  ctx.encolarNotificacionApp_('Juan@HP.cl', 'A', 'Para Juan', '');
  const notifId = ctx.leerFilas_('NOTIFICACIONES_APP')[0].notif_id;
  const r = ctx.marcarNotificacionAppLeida_({ email: ' juan@hp.cl ' }, notifId);
  assert.equal(r.actualizado, true);
  assert.equal(ctx.leerFilas_('NOTIFICACIONES_APP')[0].leida, 'TRUE');
});

test('v9.0f: flujo real via el portal (token) -- "marcar todas" via doPost persiste, y una sincronizacion nueva (recargar la pagina) no las vuelve a traer', () => {
  const ctx = loadPortalConSesion();
  // El primer correo de la cuenta trae mayusculas/espacios distintos a como
  // otro modulo pudo haber encolado la notificacion -- exactamente el
  // escenario reportado.
  ctx.encolarNotificacionApp_('lisseth.vilchez@grupob.cl', 'PROYECTO_INTEGRANTE',
    'Te agregaron a un proyecto', 'Ahora participas en "X".', 'proyectos', 'Ver proyecto', 72);
  ctx.encolarNotificacionApp_(' Lisseth.Vilchez@GrupoB.cl ', 'PAUSA_RECORDATORIO',
    'Pausa activa de hoy', 'Tu pausa es a las 12:00.', 'pausas', 'Ver pausas activas', 6);

  const datos = { portal_token: 'token-lisseth' };

  const sync1 = JSON.parse(ctx.doPost(makeEventBO({ action: 'sincronizarNotificacionesApp', data: datos })).getContent());
  assert.equal(sync1.ok, true, JSON.stringify(sync1).slice(0, 200));
  assert.equal(sync1.data.notificaciones.length, 2);

  const marcar = JSON.parse(ctx.doPost(makeEventBO({ action: 'marcarTodasNotificacionesAppLeidas', data: datos })).getContent());
  assert.equal(marcar.ok, true, JSON.stringify(marcar).slice(0, 200));
  assert.equal(marcar.data.actualizadas, 2);

  // "Recargar la pagina": una sincronizacion COMPLETAMENTE NUEVA, misma
  // sesion de portal. Si el bug reportado sigue vivo, esto vuelve a traer
  // las 2 notificaciones.
  const sync2 = JSON.parse(ctx.doPost(makeEventBO({ action: 'sincronizarNotificacionesApp', data: datos })).getContent());
  assert.equal(sync2.ok, true, JSON.stringify(sync2).slice(0, 200));
  assert.equal(sync2.data.notificaciones.length, 0, JSON.stringify(sync2.data.notificaciones));
});

test('purgarNotificacionesApp_ borra las leidas y las vencidas, conserva las vivas', () => {
  const ctx = load();
  ctx.encolarNotificacionAppLote_([
    { destinatario: 'ana@hp.cl', tipo: 'X', titulo: 'viva', vidaHoras: 6 },
    { destinatario: 'ana@hp.cl', tipo: 'X', titulo: 'vencida', vidaHoras: -1 },
    { destinatario: 'ana@hp.cl', tipo: 'X', titulo: 'a-leer', vidaHoras: 6 }
  ]);
  // marca "a-leer" como leida
  const filas = ctx.leerFilas_('NOTIFICACIONES_APP');
  const idLeer = filas.filter((f) => f.titulo === 'a-leer')[0].notif_id;
  ctx.marcarNotificacionAppLeida_({ email: 'ana@hp.cl' }, idLeer);

  const r = ctx.purgarNotificacionesApp_();
  assert.equal(r.borradas, 2); // vencida + leida
  const quedan = ctx.leerFilas_('NOTIFICACIONES_APP');
  assert.equal(quedan.length, 1);
  assert.equal(quedan[0].titulo, 'viva');
});

test('purgarNotificacionesApp_ / marcarTodas no revientan si la hoja no existe', () => {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  assert.equal(ctx.purgarNotificacionesApp_().borradas, 0);
  assert.equal(ctx.marcarTodasNotificacionesAppLeidas_({ email: 'x@y.cl' }).actualizadas, 0);
});

test('purgarNotificacionesAppTrigger se cuelga del recordatorio diario sin romperlo', () => {
  const ctx = load();
  // La hoja existe (load la crea) -> el trigger no debe lanzar.
  assert.doesNotThrow(function () { ctx.purgarNotificacionesAppTrigger(); });
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
