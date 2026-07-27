'use strict';

/**
 * v6.0 (modulo Pausas Activas, mejoras post-P5): tres cosas que cierran el
 * flujo operativo sin trabajo manual repetitivo:
 *  1. Siembra masiva del roster desde las cuentas del portal ya existentes.
 *  2. Asignacion masiva del modulo 'pausas' a las cuentas que matchean el
 *     roster (en vez de cuenta por cuenta en Cuentas plataforma).
 *  3. Cierre automatico de fin de dia de pausas que quedaron abiertas.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

const ADMIN = { rol: 'ADM', email: 'admin@homepymes.cl' };
const DEV = { rol: 'DEV', email: 'dev@homepymes.cl' };

function hoyClave() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function loadBase(opts) {
  opts = opts || {};
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'PAUSAS_CONFIG', ctx.COLUMNAS.PAUSAS_CONFIG, []);
  seedSheet(ctx, 'PAUSAS_COORDINADORES', ctx.COLUMNAS.PAUSAS_COORDINADORES, []);
  seedSheet(ctx, 'PAUSAS_TRABAJADORES', ctx.COLUMNAS.PAUSAS_TRABAJADORES, opts.trabajadores || []);
  seedSheet(ctx, 'PAUSAS_PROGRAMADAS', ctx.COLUMNAS.PAUSAS_PROGRAMADAS, opts.pausas || []);
  seedSheet(ctx, 'PAUSAS_ASISTENCIA', ctx.COLUMNAS.PAUSAS_ASISTENCIA, []);
  seedSheet(ctx, 'PAUSAS_LOG', ctx.COLUMNAS.PAUSAS_LOG);
  seedSheet(ctx, 'CUENTAS_PORTAL', ctx.COLUMNAS.CUENTAS_PORTAL, opts.cuentas || []);
  return ctx;
}

// fila de CUENTAS_PORTAL: cuenta_id, usuario, nombre, cargo, hash, salt,
// emails(JSON), rol, modulos(JSON), empresa_id, activo, debe_cambiar, ultimo, creado_por
function cuenta(id, nombre, emails, modulos, empresaId, activo) {
  return [id, id.toLowerCase(), nombre, 'Operario', 'hash', 'salt',
    JSON.stringify(emails), 'SOLICITANTE', JSON.stringify(modulos || []),
    empresaId, activo === undefined ? true : activo, false, '', 'admin'];
}

// --- sembrarRosterDesdeCuentas ---------------------------------------------

test('sembrarRosterDesdeCuentas crea una fila de roster por cada correo de cada cuenta activa de la empresa', () => {
  const ctx = loadBase({
    cuentas: [
      cuenta('CTA-1', 'Juan', ['juan@hp.cl'], [], 'HP'),
      cuenta('CTA-2', 'Ana', ['ana@hp.cl', 'ana2@hp.cl'], [], 'HP'),
      cuenta('CTA-3', 'Pedro', ['pedro@rld.cl'], [], 'RLD') // otra empresa, no debe entrar
    ]
  });
  const res = ctx.Pausas.sembrarRosterDesdeCuentas({ empresa_id: 'HP' }, ADMIN);
  assert.equal(res.creados, 3); // juan, ana, ana2
  const roster = ctx.Pausas.listarTrabajadores({}, ADMIN);
  assert.equal(roster.length, 3);
  assert.ok(roster.every((t) => t.empresa_id === 'HP'));
  assert.ok(roster.some((t) => t.email === 'juan@hp.cl' && t.nombre === 'Juan'));
});

test('sembrarRosterDesdeCuentas no duplica correos que ya estan en el roster', () => {
  const ctx = loadBase({
    trabajadores: [['T1', 'HP', 'Juan Viejo', 'juan@hp.cl', 'Bodega', 'Operario', true, '2026-01-01']],
    cuentas: [cuenta('CTA-1', 'Juan', ['juan@hp.cl'], [], 'HP')]
  });
  const res = ctx.Pausas.sembrarRosterDesdeCuentas({ empresa_id: 'HP' }, ADMIN);
  assert.equal(res.creados, 0);
  assert.equal(ctx.Pausas.listarTrabajadores({}, ADMIN).length, 1);
});

test('sembrarRosterDesdeCuentas ignora cuentas inactivas y exige empresa_id', () => {
  const ctx = loadBase({ cuentas: [cuenta('CTA-1', 'Juan', ['juan@hp.cl'], [], 'HP', false)] });
  const res = ctx.Pausas.sembrarRosterDesdeCuentas({ empresa_id: 'HP' }, ADMIN);
  assert.equal(res.creados, 0);
  assert.equal(ctx.Pausas.sembrarRosterDesdeCuentas({}, ADMIN)._validationError, true);
});

test('sembrarRosterDesdeCuentas es ADM-only', () => {
  const ctx = loadBase();
  assert.equal(ctx.Pausas.sembrarRosterDesdeCuentas({ empresa_id: 'HP' }, DEV)._forbidden, true);
});

// --- asignarModuloPausasRoster ----------------------------------------------

test('asignarModuloPausasRoster agrega "pausas" a las cuentas que matchean el roster y no lo tenian', () => {
  const ctx = loadBase({
    trabajadores: [
      ['T1', 'HP', 'Juan', 'juan@hp.cl', 'Bodega', 'Operario', true, '2026-01-01'],
      ['T2', 'HP', 'Ana', 'ana@hp.cl', 'Ventas', 'Vendedora', true, '2026-01-01']
    ],
    cuentas: [
      cuenta('CTA-1', 'Juan', ['juan@hp.cl'], ['bandeja'], 'HP'),
      cuenta('CTA-2', 'Ana', ['ana@hp.cl'], ['pausas'], 'HP') // ya lo tenia
    ]
  });
  const res = ctx.Pausas.asignarModuloPausasRoster({ empresa_id: 'HP' }, ADMIN);
  assert.equal(res.cuentas_actualizadas, 1); // solo Juan cambio
  assert.deepEqual(toPlain(res.sin_cuenta), []);

  const cuentas = ctx.CuentasPortal.listar({}, ADMIN).cuentas;
  const juan = cuentas.find((c) => c.cuenta_id === 'CTA-1');
  assert.ok(juan.modulos.indexOf('pausas') !== -1);
  assert.ok(juan.modulos.indexOf('bandeja') !== -1); // no se pierde lo que ya tenia
});

test('asignarModuloPausasRoster reporta los correos del roster sin cuenta del portal', () => {
  const ctx = loadBase({
    trabajadores: [['T1', 'HP', 'Juan', 'juan@hp.cl', 'Bodega', 'Operario', true, '2026-01-01']],
    cuentas: []
  });
  const res = ctx.Pausas.asignarModuloPausasRoster({ empresa_id: 'HP' }, ADMIN);
  assert.equal(res.cuentas_actualizadas, 0);
  assert.deepEqual(toPlain(res.sin_cuenta), ['juan@hp.cl']);
});

test('asignarModuloPausasRoster es ADM-only y exige empresa_id', () => {
  const ctx = loadBase();
  assert.equal(ctx.Pausas.asignarModuloPausasRoster({ empresa_id: 'HP' }, DEV)._forbidden, true);
  assert.equal(ctx.Pausas.asignarModuloPausasRoster({}, ADMIN)._validationError, true);
});

// --- cerrarPausasAbiertasDelDia ---------------------------------------------

function loadConPausas(pausas) {
  return loadBase({ pausas: pausas });
}

test('cerrarPausasAbiertasDelDia pasa una pausa En_curso a Realizada con nota de sistema', () => {
  const hoy = hoyClave();
  const ctx = loadConPausas([['PA-1', 'HP', hoy, '09:30', '2026-01-01T09:30:00Z', '', 'coord@hp.cl', 'En_curso', 10, '']]);
  const res = ctx.Pausas.cerrarPausasAbiertasDelDia();
  assert.equal(res.cerradas, 1);
  const p = ctx.Pausas.listarProgramadas({}, ADMIN)[0];
  assert.equal(p.estado, 'Realizada');
  assert.ok(p.hora_fin);
  assert.ok(p.observaciones.indexOf('Cerrada automáticamente') !== -1);
});

test('cerrarPausasAbiertasDelDia pasa una pausa Programada (nunca iniciada) a No_realizada', () => {
  const hoy = hoyClave();
  const ctx = loadConPausas([['PA-1', 'HP', hoy, '09:30', '', '', '', 'Programada', 10, '']]);
  const res = ctx.Pausas.cerrarPausasAbiertasDelDia();
  assert.equal(res.cerradas, 1);
  const p = ctx.Pausas.listarProgramadas({}, ADMIN)[0];
  assert.equal(p.estado, 'No_realizada');
  assert.ok(p.observaciones.indexOf('no inició la pausa') !== -1);
});

test('cerrarPausasAbiertasDelDia tambien cierra Recordatorio_enviado como No_realizada', () => {
  const hoy = hoyClave();
  const ctx = loadConPausas([['PA-1', 'HP', hoy, '09:30', '', '', '', 'Recordatorio_enviado', 10, '']]);
  const res = ctx.Pausas.cerrarPausasAbiertasDelDia();
  assert.equal(res.cerradas, 1);
  assert.equal(ctx.Pausas.listarProgramadas({}, ADMIN)[0].estado, 'No_realizada');
});

test('cerrarPausasAbiertasDelDia no toca pausas ya terminales ni Suspendida', () => {
  const hoy = hoyClave();
  const ctx = loadConPausas([
    ['PA-1', 'HP', hoy, '09:30', '', '', '', 'Realizada', 10, ''],
    ['PA-2', 'HP', hoy, '09:30', '', '', '', 'Cerrada', 10, ''],
    ['PA-3', 'HP', hoy, '09:30', '', '', '', 'No_realizada', 10, ''],
    ['PA-4', 'HP', hoy, '09:30', '', '', '', 'Cancelada', 10, ''],
    ['PA-5', 'HP', hoy, '09:30', '', '', '', 'Suspendida', 10, '']
  ]);
  const res = ctx.Pausas.cerrarPausasAbiertasDelDia();
  assert.equal(res.cerradas, 0);
});

test('cerrarPausasAbiertasDelDia no toca pausas de otro dia', () => {
  const ctx = loadConPausas([['PA-1', 'HP', '2020-01-01', '09:30', '', '', '', 'Programada', 10, '']]);
  const res = ctx.Pausas.cerrarPausasAbiertasDelDia();
  assert.equal(res.cerradas, 0);
});
