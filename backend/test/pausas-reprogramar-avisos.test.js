'use strict';

/**
 * v13 (auditoría del módulo Pausas): reprogramar una pausa tiene que volver a
 * avisar.
 *
 * El defecto: el job de recordatorios sólo mira las pausas en estado
 * "Programada", y `reprogramarPausa_` sólo devolvía a ese estado las
 * SUSPENDIDA. Una pausa que ya había recibido su recordatorio quedaba clavada
 * en "Recordatorio_enviado"; al moverla de hora, el aviso de la hora NUEVA no
 * salía nunca y el único que había salido hablaba de la hora vieja. Se movía
 * la pausa y nadie se enteraba.
 *
 * Segunda capa: aunque el estado se reiniciara, el correo se deduplica por
 * (clave, evento, destinatario) en una ventana de 12h. Con la clave siendo el
 * pausa_id a secas, el aviso nuevo caía dentro de la ventana del viejo y se
 * descartaba en silencio. La clave ahora incluye fecha + hora.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function hoyClave() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function load() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
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
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Admin', 'admin@homepymes.cl', 'HP', 'ADM', true, '', 'sistema']
  ]);
  seedSheet(ctx, 'CUENTAS_PORTAL', ctx.COLUMNAS.CUENTAS_PORTAL, []);
  seedSheet(ctx, 'SESIONES_PORTAL', ctx.COLUMNAS.SESIONES_PORTAL, []);
  return ctx;
}

const ADM = { rol: 'ADM', email: 'admin@homepymes.cl', nombre: 'Admin' };

function reprogramarA(ctx, hora) {
  return ctx.Pausas.gestionarPausaProgramada(
    { operacion: 'reprogramar', pausa_id: 'PA-1', hora_programada: hora }, ADM);
}

test('reprogramar tras el recordatorio devuelve la pausa a Programada', () => {
  const ctx = load();
  ctx.Pausas.enviarRecordatoriosPausas({ ahoraMin: 560 });
  assert.equal(ctx.Pausas.listarProgramadas({}, ADM)[0].estado, 'Recordatorio_enviado');

  const res = reprogramarA(ctx, '16:00');
  assert.ok(!res.error, 'la reprogramación es válida en Recordatorio_enviado');
  assert.equal(ctx.Pausas.listarProgramadas({}, ADM)[0].estado, 'Programada',
    'si queda en Recordatorio_enviado, el job de recordatorios no la vuelve a mirar');
});

test('la hora nueva SÍ se avisa: el recordatorio vuelve a salir, y a todo el roster', () => {
  const ctx = load();
  ctx.Pausas.enviarRecordatoriosPausas({ ahoraMin: 560 });
  const antes = ctx.MailApp._enviados.length;
  assert.equal(antes, 2, 'trabajador + coordinadora reciben el aviso de las 09:30');

  reprogramarA(ctx, '16:00');
  const res = ctx.Pausas.enviarRecordatoriosPausas({ ahoraMin: 950 });

  assert.equal(res.pausas_avisadas, 1, 'la pausa movida vuelve a entrar al job');
  const nuevos = ctx.MailApp._enviados.slice(antes);
  assert.equal(nuevos.length, 2, 'el dedup de 12h no puede tapar el aviso de otro horario');
  assert.deepEqual(nuevos.map((e) => e.destinatario).sort(), ['amarlla@hp.cl', 'juan@hp.cl']);
  assert.ok(nuevos[0].asunto.indexOf('16:00') !== -1, 'el aviso nuevo anuncia la hora nueva');
});

test('reprogramar limpia los flags de los avisos atados a la hora vieja', () => {
  const ctx = load();
  ctx.Pausas.enviarRecordatoriosPausas({ ahoraMin: 560 });
  ctx.Pausas.enviarSegundosAvisosPausas({ ahoraMin: 570 });
  const p = ctx.Pausas.listarProgramadas({}, ADM)[0];
  assert.ok(p.ultima_llamada_enviada === true || p.ultima_llamada_enviada === 'TRUE',
    'la última llamada de las 09:30 quedó marcada');

  reprogramarA(ctx, '16:00');
  const q = ctx.Pausas.listarProgramadas({}, ADM)[0];
  assert.equal(q.ultima_llamada_enviada, false);
  assert.equal(q.aviso_coordinador_enviado, false);
  assert.equal(q.escalada_admin_enviada, false);
});

test('sin reprogramar, el recordatorio sigue saliendo UNA sola vez', () => {
  const ctx = load();
  const r1 = ctx.Pausas.enviarRecordatoriosPausas({ ahoraMin: 560 });
  const r2 = ctx.Pausas.enviarRecordatoriosPausas({ ahoraMin: 565 });
  assert.equal(r1.pausas_avisadas, 1);
  assert.equal(r2.pausas_avisadas, 0, 'la máquina de estados sigue siendo la guarda de idempotencia');
  assert.equal(ctx.MailApp._enviados.length, 2);
});
