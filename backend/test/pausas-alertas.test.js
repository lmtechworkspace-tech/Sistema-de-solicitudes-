'use strict';

/**
 * v6.0 (modulo Pausas Activas, Fase P4): alertas. Recordatorio a los
 * trabajadores/coordinadoras cuando la pausa del dia se acerca, y resumen de
 * fin de dia a coordinadoras + admin. Todo en correo HTML branded, con dedup.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function hoyClave() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function load(opts) {
  opts = opts || {};
  var scriptProperties = { SIGSO_SHEET_ID: 'fake-sheet-id' };
  if (opts.sitioPublico !== undefined) scriptProperties.SIGSO_SITIO_PUBLICO = opts.sitioPublico;
  const ctx = loadBackofficeProject({ scriptProperties: scriptProperties });
  seedSheet(ctx, 'PAUSAS_CONFIG', ctx.COLUMNAS.PAUSAS_CONFIG, [
    ['HP', opts.hora || '09:30', '1,2,3,4,5', 10, opts.anticip === undefined ? 15 : opts.anticip, 80, 60, true]
  ]);
  seedSheet(ctx, 'PAUSAS_COORDINADORES', ctx.COLUMNAS.PAUSAS_COORDINADORES, [
    ['CO-1', 'HP', 'Amarlla', 'amarlla@hp.cl', 'titular', true]
  ]);
  seedSheet(ctx, 'PAUSAS_TRABAJADORES', ctx.COLUMNAS.PAUSAS_TRABAJADORES, [
    ['T1', 'HP', 'Juan', 'juan@hp.cl', 'Bodega', 'Operario', true, '2026-01-01'],
    ['T2', 'HP', 'Ana', 'ana@hp.cl', 'Ventas', 'Vendedora', true, '2026-01-01']
  ]);
  seedSheet(ctx, 'PAUSAS_PROGRAMADAS', ctx.COLUMNAS.PAUSAS_PROGRAMADAS,
    opts.pausaHoy === false ? [] : [['PA-1', 'HP', hoyClave(), opts.hora || '09:30', '', '', '', opts.estado || 'Programada', 10, '']]);
  seedSheet(ctx, 'PAUSAS_ASISTENCIA', ctx.COLUMNAS.PAUSAS_ASISTENCIA, opts.asistencia || []);
  seedSheet(ctx, 'PAUSAS_LOG', ctx.COLUMNAS.PAUSAS_LOG);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Admin', 'admin@homepymes.cl', 'HP', 'ADM', true, '', 'sistema']
  ]);
  seedSheet(ctx, 'CUENTAS_PORTAL', ctx.COLUMNAS.CUENTAS_PORTAL, opts.cuentasPortal || []);
  seedSheet(ctx, 'SESIONES_PORTAL', ctx.COLUMNAS.SESIONES_PORTAL, []);
  return ctx;
}

test('recordatorio: dentro de la ventana envia a roster + coordinadora y marca Recordatorio_enviado', () => {
  const ctx = load();
  // ahoraMin muy alto => siempre dentro de la ventana (ahora >= hora - anticip).
  const res = ctx.Pausas.enviarRecordatoriosPausas({ ahoraMin: 1439 });
  assert.equal(res.pausas_avisadas, 1);
  // 2 trabajadores + 1 coordinadora = 3 correos.
  assert.equal(res.correos_enviados, 3);
  const dests = ctx.MailApp._enviados.map((e) => e.destinatario).sort();
  assert.deepEqual(dests, ['amarlla@hp.cl', 'ana@hp.cl', 'juan@hp.cl']);
  // Correo HTML branded.
  assert.ok(ctx.MailApp._enviados[0].opciones.htmlBody.indexOf('SIGSO') !== -1);
  // La pausa quedó marcada como recordada.
  const p = ctx.Pausas.listarProgramadas({}, { rol: 'ADM', email: 'a@a.cl' })[0];
  assert.equal(p.estado, 'Recordatorio_enviado');
});

test('recordatorio: fuera de la ventana (aun falta mucho) no envia nada', () => {
  const ctx = load({ hora: '23:59', anticip: 5 });
  // A medianoche (ahoraMin 0) faltan casi 24h => no toca.
  const res = ctx.Pausas.enviarRecordatoriosPausas({ ahoraMin: 0 });
  assert.equal(res.pausas_avisadas, 0);
  assert.equal(ctx.MailApp._enviados.length, 0);
});

test('recordatorio: es idempotente (no reenvia si ya se marco Recordatorio_enviado)', () => {
  const ctx = load();
  ctx.Pausas.enviarRecordatoriosPausas({ ahoraMin: 1439 });
  const antes = ctx.MailApp._enviados.length;
  const res2 = ctx.Pausas.enviarRecordatoriosPausas({ ahoraMin: 1439 });
  assert.equal(res2.pausas_avisadas, 0);
  assert.equal(ctx.MailApp._enviados.length, antes);
});

test('recordatorio: sin pausa hoy no hace nada', () => {
  const ctx = load({ pausaHoy: false });
  const res = ctx.Pausas.enviarRecordatoriosPausas({ ahoraMin: 1439 });
  assert.equal(res.pausas_avisadas, 0);
});

test('resumen diario: envia a coordinadora + admin con el estado y la participacion', () => {
  const ctx = load({
    estado: 'Realizada',
    asistencia: [
      ['R1', 'PA-1', 'T1', 'juan@hp.cl', hoyClave() + 'T09:35:00Z', 'participo', '', '', true, 'autoservicio']
    ]
  });
  const res = ctx.Pausas.enviarResumenDiarioPausas();
  assert.equal(res.pausas, 1);
  // coordinadora (amarlla) + admin (admin@homepymes.cl) = 2.
  assert.equal(res.correos_enviados, 2);
  const dests = ctx.MailApp._enviados.map((e) => e.destinatario).sort();
  assert.deepEqual(dests, ['admin@homepymes.cl', 'amarlla@hp.cl']);
  // El cuerpo menciona el estado y la participación.
  assert.ok(ctx.MailApp._enviados[0].opciones.htmlBody.indexOf('Realizada') !== -1);
});

test('resumen diario: una pausa Cancelada no genera resumen', () => {
  const ctx = load({ estado: 'Cancelada' });
  const res = ctx.Pausas.enviarResumenDiarioPausas();
  assert.equal(res.pausas, 0);
  assert.equal(ctx.MailApp._enviados.length, 0);
});

// v6.0 (Pausas P4.1): el recordatorio incluye un enlace magico PERSONAL --
// entra directo al modulo "Pausas activas" sin pedir clave -- cuando el
// destinatario tiene cuenta del portal Y el sitio publico esta configurado.
test('recordatorio: incluye un enlace magico personal cuando el destinatario tiene cuenta y hay sitio publico', () => {
  const ctx = load({
    sitioPublico: 'https://ejemplo.github.io/sigso/',
    cuentasPortal: [
      ['CTA-1', 'juan', 'Juan', '', 'hash', 'salt', JSON.stringify(['juan@hp.cl']), 'SOLICITANTE', JSON.stringify(['pausas']), 'HP', true, false, '', 'admin']
    ]
  });
  const res = ctx.Pausas.enviarRecordatoriosPausas({ ahoraMin: 1439 });
  assert.equal(res.correos_enviados, 3);
  const paraJuan = ctx.MailApp._enviados.find((e) => e.destinatario === 'juan@hp.cl');
  assert.ok(paraJuan.opciones.htmlBody.indexOf('href="https://ejemplo.github.io/sigso/plataforma.html?token=') !== -1);
  // El HTML escapa "&" a "&amp;" (valido en HTML); el texto plano no.
  assert.ok(paraJuan.opciones.htmlBody.indexOf('&amp;modulo=pausas') !== -1);
  assert.ok(paraJuan.cuerpo.indexOf('https://ejemplo.github.io/sigso/plataforma.html?token=') !== -1);
  assert.ok(paraJuan.cuerpo.indexOf('&modulo=pausas') !== -1);
  // Se creo una sesion de enlace magico real (SESIONES_PORTAL).
  const sesiones = ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SESIONES_PORTAL')
    .getDataRange().getValues().slice(1);
  assert.equal(sesiones.length, 1);

  // Ana no tiene cuenta del portal: su correo sale sin boton, sin romper nada.
  const paraAna = ctx.MailApp._enviados.find((e) => e.destinatario === 'ana@hp.cl');
  assert.ok(paraAna.opciones.htmlBody.indexOf('href="https://ejemplo.github.io/sigso/plataforma.html') === -1);
});

// --- v6.0 (mejora #5): segundo aviso -----------------------------------------

test('segundo aviso: en la hora exacta manda "ultima llamada" al roster y avisa a la coordinadora', () => {
  const ctx = load();
  const res = ctx.Pausas.enviarSegundosAvisosPausas({ ahoraMin: 9 * 60 + 30 }); // 09:30 = hora_programada
  assert.equal(res.ultima_llamada, 3); // 2 trabajadores + 1 coordinadora
  assert.equal(res.aviso_coordinadora, 1);
  assert.equal(ctx.MailApp._enviados.length, 4);
  const p = ctx.Pausas.listarProgramadas({}, { rol: 'ADM', email: 'a@a.cl' })[0];
  assert.equal(String(p.ultima_llamada_enviada), 'true');
  assert.equal(String(p.aviso_coordinador_enviado), 'true');
});

test('segundo aviso: antes de la hora programada no manda nada', () => {
  const ctx = load();
  const res = ctx.Pausas.enviarSegundosAvisosPausas({ ahoraMin: 9 * 60 }); // 09:00, faltan 30 min
  assert.equal(res.ultima_llamada, 0);
  assert.equal(res.aviso_coordinadora, 0);
  assert.equal(ctx.MailApp._enviados.length, 0);
});

test('segundo aviso: es idempotente (no reenvia una vez marcado)', () => {
  const ctx = load();
  ctx.Pausas.enviarSegundosAvisosPausas({ ahoraMin: 9 * 60 + 30 });
  const antes = ctx.MailApp._enviados.length;
  const res2 = ctx.Pausas.enviarSegundosAvisosPausas({ ahoraMin: 9 * 60 + 30 });
  assert.equal(res2.ultima_llamada, 0);
  assert.equal(res2.aviso_coordinadora, 0);
  assert.equal(ctx.MailApp._enviados.length, antes);
});

test('segundo aviso: una pausa ya En_curso no recibe aviso a la coordinadora (ya la inicio)', () => {
  const ctx = load({ estado: 'En_curso' });
  const res = ctx.Pausas.enviarSegundosAvisosPausas({ ahoraMin: 9 * 60 + 30 });
  assert.equal(res.ultima_llamada, 0);
  assert.equal(res.aviso_coordinadora, 0);
});

test('recordatorio: sin sitio publico configurado, no arma enlace (correo sigue saliendo)', () => {
  const ctx = load({
    sitioPublico: '',
    cuentasPortal: [
      ['CTA-1', 'juan', 'Juan', '', 'hash', 'salt', JSON.stringify(['juan@hp.cl']), 'SOLICITANTE', JSON.stringify(['pausas']), 'HP', true, false, '', 'admin']
    ]
  });
  const res = ctx.Pausas.enviarRecordatoriosPausas({ ahoraMin: 1439 });
  assert.equal(res.correos_enviados, 3);
  const paraJuan = ctx.MailApp._enviados.find((e) => e.destinatario === 'juan@hp.cl');
  assert.ok(paraJuan.opciones.htmlBody.indexOf('href="http') === -1);
  // No crea sesiones de enlace magico si no hay a donde apuntar.
  const sesiones = ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SESIONES_PORTAL')
    .getDataRange().getValues().slice(1);
  assert.equal(sesiones.length, 0);
});
