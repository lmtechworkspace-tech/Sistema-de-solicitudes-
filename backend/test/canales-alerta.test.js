'use strict';

/**
 * v7.5 (canales de alerta configurables desde Admin): con las alertas EN
 * VIVO ya cubriendo Pausas/Actividades/Novedades, el Admin puede apagar el
 * CORREO de esas categorias (la alerta en pantalla queda). Nace del feedback
 * real: "las alertas de SIGSO ya llegan, para pausas activas quiza el correo
 * ya no es necesario". El gate vive en enviarCorreo_ (unico punto de salida).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

const ADMIN = { rol: 'ADM', email: 'admin@homepymes.cl' };
const NO_ADMIN = { rol: 'SOLICITANTE', email: 'juan@hp.cl' };

function load() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'CONFIG_NOTIFICACIONES', ctx.COLUMNAS.CONFIG_NOTIFICACIONES, []);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES, []);
  return ctx;
}

test('sin registro, el correo de una categoria esta ENCENDIDO (default, no rompe nada)', () => {
  const ctx = load();
  const r = ctx.enviarCorreo_('SOL-1', 'leo@rld.cl', 'PAUSA_RECORDATORIO', 'Asunto', 'Cuerpo');
  assert.equal(r.enviado, true);
  assert.equal(ctx.GmailApp._enviados.length, 1);
});

test('guardarCanalAlerta_ apaga PAUSAS -> enviarCorreo_ ya NO manda ese evento', () => {
  const ctx = load();
  ctx.guardarCanalAlerta_(ADMIN, 'PAUSAS', false);
  const r = ctx.enviarCorreo_('SOL-1', 'leo@rld.cl', 'PAUSA_ULTIMA_LLAMADA', 'Asunto', 'Cuerpo');
  assert.equal(r.enviado, false);
  assert.equal(r.motivo, 'canal_desactivado');
  assert.equal(ctx.GmailApp._enviados.length, 0);
});

test('apagar PAUSAS no afecta a otras categorias (NOVEDADES sigue enviando)', () => {
  const ctx = load();
  ctx.guardarCanalAlerta_(ADMIN, 'PAUSAS', false);
  const r = ctx.enviarCorreo_('NOV-1', 'leo@rld.cl', 'NOVEDAD_PUBLICADA', 'Asunto', 'Cuerpo');
  assert.equal(r.enviado, true);
  assert.equal(ctx.GmailApp._enviados.length, 1);
});

test('los avisos al SOLICITANTE EXTERNO nunca se bloquean (no tienen categoria)', () => {
  const ctx = load();
  // Aunque el Admin apague TODO lo apagable, un evento sin categoria
  // (compromiso de fecha / recordatorio de validacion) siempre sale: esa
  // gente no tiene SIGSO, el correo es su unico canal.
  ['PAUSAS', 'ACTIVIDADES', 'NOVEDADES', 'SOLICITUDES', 'SLA', 'REPORTES'].forEach((c) => {
    ctx.guardarCanalAlerta_(ADMIN, c, false);
  });
  assert.equal(ctx.categoriaDeEvento_('COMPROMISO_FECHA:sub-1:2026-09-01'), null);
  const r = ctx.enviarCorreo_('SOL-1', 'cliente@externo.cl', 'COMPROMISO_FECHA:sub-1:2026-09-01', 'Asunto', 'Cuerpo');
  assert.equal(r.enviado, true);
});

test('categoriaDeEvento_ mapea por prefijo (con o sin sufijo de id)', () => {
  const ctx = load();
  assert.equal(ctx.categoriaDeEvento_('PAUSA_AVISO_COORDINADOR'), 'PAUSAS');
  assert.equal(ctx.categoriaDeEvento_('ALERTAS_ACTIVIDADES'), 'ACTIVIDADES');
  assert.equal(ctx.categoriaDeEvento_('NOVEDAD_EN_REVISION:abc'), 'NOVEDADES');
  assert.equal(ctx.categoriaDeEvento_('DERIVACION:SOL-1,SOL-2'), 'SOLICITUDES');
  assert.equal(ctx.categoriaDeEvento_('SLA_VENCIDO:sub-9'), 'SLA');
  assert.equal(ctx.categoriaDeEvento_('REPORTE_EJECUTIVO_SEMANAL:2026-08-12'), 'REPORTES');
  assert.equal(ctx.categoriaDeEvento_('EVENTO_DESCONOCIDO'), null);
});

test('listarCanalesAlerta_ es ADM-only y trae las 6 categorias con tiene_en_vivo', () => {
  const ctx = load();
  assert.equal(ctx.listarCanalesAlerta_(NO_ADMIN)._forbidden, true);

  const r = ctx.listarCanalesAlerta_(ADMIN);
  assert.equal(r.canales.length, 6);
  const pausas = r.canales.filter((c) => c.clave === 'PAUSAS')[0];
  assert.equal(pausas.tiene_en_vivo, true);
  assert.equal(pausas.correo_activo, true); // default
  const sla = r.canales.filter((c) => c.clave === 'SLA')[0];
  assert.equal(sla.tiene_en_vivo, false); // solo-correo, se advierte en el panel
});

test('guardarCanalAlerta_ es ADM-only, hace upsert y rechaza una clave desconocida', () => {
  const ctx = load();
  assert.equal(ctx.guardarCanalAlerta_(NO_ADMIN, 'PAUSAS', false)._forbidden, true);
  assert.equal(ctx.guardarCanalAlerta_(ADMIN, 'INVENTADO', false)._validationError, true);

  ctx.guardarCanalAlerta_(ADMIN, 'PAUSAS', false);
  ctx.guardarCanalAlerta_(ADMIN, 'PAUSAS', true); // upsert: no duplica
  const filas = ctx.leerFilas_('CONFIG_NOTIFICACIONES').filter((f) => f.notif_id === 'CANAL_CORREO_PAUSAS');
  assert.equal(filas.length, 1);
  assert.equal(ctx.canalCorreoActivo_('PAUSAS'), true);
});

test('handleListarCanalesAlerta_ / handleGuardarCanalAlerta_ responden ok:true y aplican', () => {
  const ctx = load();
  const r1 = JSON.parse(ctx.handleGuardarCanalAlerta_({ clave: 'REPORTES', activo: false }, ADMIN).getContent());
  assert.equal(r1.ok, true);
  assert.equal(ctx.canalCorreoActivo_('REPORTES'), false);

  const r2 = JSON.parse(ctx.handleListarCanalesAlerta_({}, ADMIN).getContent());
  assert.equal(r2.ok, true);
  assert.equal(r2.data.canales.length, 6);
});

test('canalesAlerta no tienen gate propio de rol en MODULO_POR_ACCION pero exigen administracion', () => {
  const ctx = load();
  assert.equal(ctx.MODULO_POR_ACCION.listarCanalesAlerta, 'administracion');
  assert.equal(ctx.MODULO_POR_ACCION.guardarCanalAlerta, 'administracion');
});
