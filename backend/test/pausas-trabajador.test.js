'use strict';

/**
 * v6.0 (modulo Pausas Activas, Fase P2): registro del trabajador. Un
 * trabajador entra (tipicamente por enlace magico) al modulo 'pausas', ve la
 * pausa de hoy y declara "participe" (con checkbox) o "no pude" (con motivo).
 * El valor probatorio es el trio: identidad autenticada (email del contexto) +
 * timestamp del servidor + declaracion. Sin firma dibujada.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

// El trabajador entra por portal: contexto con email + modulo 'pausas'.
const JUAN = { email: 'juan@hp.cl', rol: 'DEV', via_portal: true, modulos: ['pausas'] };
const SIN_EMPRESA = { email: 'nadie@ext.cl', rol: 'DEV', via_portal: true, modulos: ['pausas'] };

function hoyClave() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function load(opts) {
  opts = opts || {};
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'PAUSAS_TRABAJADORES', ctx.COLUMNAS.PAUSAS_TRABAJADORES,
    opts.sinRoster ? [] : [['TRB-1', 'HP', 'Juan Perez', 'juan@hp.cl', 'Bodega', 'Operario', true, '2026-01-01']]);
  seedSheet(ctx, 'CUENTAS_PORTAL', ctx.COLUMNAS.CUENTAS_PORTAL, []);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, []);
  seedSheet(ctx, 'PAUSAS_ASISTENCIA', ctx.COLUMNAS.PAUSAS_ASISTENCIA);
  seedSheet(ctx, 'PAUSAS_LOG', ctx.COLUMNAS.PAUSAS_LOG);
  const pausas = [];
  if (opts.pausaHoy !== false) {
    pausas.push(['PA-1', 'HP', hoyClave(), '09:30', '', '', '', opts.estado || 'Programada', 10, '']);
  }
  seedSheet(ctx, 'PAUSAS_PROGRAMADAS', ctx.COLUMNAS.PAUSAS_PROGRAMADAS, pausas);
  return ctx;
}

test('getPausaHoyTrabajador devuelve la pausa de hoy y que aun no hay registro', () => {
  const ctx = load();
  const res = ctx.Pausas.getPausaHoyTrabajador({}, JUAN);
  assert.equal(res.empresa_id, 'HP');
  assert.ok(res.pausa);
  assert.equal(res.pausa.hora_programada, '09:30');
  assert.equal(res.registrable, true);
  assert.equal(res.mi_registro, null);
});

test('getPausaHoyTrabajador informa cuando no se puede resolver la empresa', () => {
  const ctx = load();
  const res = ctx.Pausas.getPausaHoyTrabajador({}, SIN_EMPRESA);
  assert.equal(res.sin_empresa, true);
});

test('getPausaHoyTrabajador sin pausa hoy devuelve pausa null', () => {
  const ctx = load({ pausaHoy: false });
  const res = ctx.Pausas.getPausaHoyTrabajador({}, JUAN);
  assert.equal(res.pausa, null);
  assert.equal(res.registrable, false);
});

test('registrarAsistencia "participe" exige la declaracion (confirmacion)', () => {
  const ctx = load();
  const sinConfirmar = ctx.Pausas.registrarAsistencia({ estado: 'participo' }, JUAN);
  assert.equal(sinConfirmar._validationError, true);

  const ok = ctx.Pausas.registrarAsistencia({ estado: 'participo', confirmacion: true }, JUAN);
  assert.ok(!ok._validationError, JSON.stringify(ok));
  assert.equal(ok.estado, 'participo');
  assert.equal(ok.confirmacion, true);
  assert.equal(ok.email, 'juan@hp.cl');
  assert.equal(ok.trabajador_id, 'TRB-1');
  assert.ok(ok.fecha_hora_registro); // timestamp del servidor
  assert.equal(ok.origen, 'autoservicio');
});

test('registrarAsistencia "no_participo" exige motivo', () => {
  const ctx = load();
  assert.equal(ctx.Pausas.registrarAsistencia({ estado: 'no_participo' }, JUAN)._validationError, true);
  const ok = ctx.Pausas.registrarAsistencia({ estado: 'no_participo', motivo: 'En terreno' }, JUAN);
  assert.equal(ok.estado, 'no_participo');
  assert.equal(ok.motivo, 'En terreno');
  assert.equal(ok.confirmacion, false);
});

test('registrarAsistencia es upsert: corregir "no pude" -> "participe" no duplica', () => {
  const ctx = load();
  ctx.Pausas.registrarAsistencia({ estado: 'no_participo', motivo: 'reunion' }, JUAN);
  ctx.Pausas.registrarAsistencia({ estado: 'participo', confirmacion: true }, JUAN);

  const filas = ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('PAUSAS_ASISTENCIA')
    .getDataRange().getValues().slice(1);
  assert.equal(filas.length, 1);
  const res = ctx.Pausas.getPausaHoyTrabajador({}, JUAN);
  assert.equal(res.mi_registro.estado, 'participo');
});

test('registrarAsistencia rechaza estado invalido y falta de pausa hoy', () => {
  const ctx = load();
  assert.equal(ctx.Pausas.registrarAsistencia({ estado: 'quizas' }, JUAN)._validationError, true);

  const sinPausa = load({ pausaHoy: false });
  assert.equal(sinPausa.Pausas.registrarAsistencia({ estado: 'participo', confirmacion: true }, JUAN)._validationError, true);
});

test('no se puede registrar si la pausa ya no es registrable (Realizada)', () => {
  const ctx = load({ estado: 'Realizada' });
  const res = ctx.Pausas.registrarAsistencia({ estado: 'participo', confirmacion: true }, JUAN);
  assert.equal(res._validationError, true);
  assert.equal(ctx.Pausas.getPausaHoyTrabajador({}, JUAN).registrable, false);
});

test('la empresa se resuelve desde CUENTAS_PORTAL si el trabajador no esta en el roster', () => {
  const ctx = load({ sinRoster: true });
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('CUENTAS_PORTAL').appendRow(
    ctx.COLUMNAS.CUENTAS_PORTAL.map((c) => ({
      cuenta_id: 'CTA-9', usuario: 'juan', nombre: 'Juan', cargo: '',
      emails: JSON.stringify(['juan@hp.cl']), rol: 'SOLICITANTE', modulos: JSON.stringify(['pausas']),
      empresa_id: 'HP', activo: true
    }[c] !== undefined ? {
      cuenta_id: 'CTA-9', usuario: 'juan', nombre: 'Juan', cargo: '',
      emails: JSON.stringify(['juan@hp.cl']), rol: 'SOLICITANTE', modulos: JSON.stringify(['pausas']),
      empresa_id: 'HP', activo: true
    }[c] : ''))
  );
  const res = ctx.Pausas.getPausaHoyTrabajador({}, JUAN);
  assert.equal(res.empresa_id, 'HP');
  assert.ok(res.pausa);
});
