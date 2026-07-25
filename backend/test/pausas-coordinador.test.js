'use strict';

/**
 * v6.0 (modulo Pausas Activas, Fase P3): el coordinador (prevencionista) opera
 * la pausa del dia (iniciar / finalizar / no realizada), ve la participacion
 * en vivo y consulta su propio reporte de cumplimiento. Todo acotado a la(s)
 * empresa(s) donde es coordinador activo; un ADM puede con todas.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

const AMARLLA = { email: 'amarlla@hp.cl', rol: 'DEV', via_portal: true, modulos: ['pausas_coordinacion'] };
const AJENA = { email: 'otra@rld.cl', rol: 'DEV', via_portal: true, modulos: ['pausas_coordinacion'] };
const ADMIN = { rol: 'ADM', email: 'admin@homepymes.cl' };

function hoyClave() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function load(opts) {
  opts = opts || {};
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'PAUSAS_CONFIG', ctx.COLUMNAS.PAUSAS_CONFIG, [
    ['HP', '09:30', '1,2,3,4,5', 10, 15, 80, 60, true]
  ]);
  seedSheet(ctx, 'PAUSAS_COORDINADORES', ctx.COLUMNAS.PAUSAS_COORDINADORES, [
    ['CO-1', 'HP', 'Amarlla', 'amarlla@hp.cl', 'titular', true]
  ]);
  seedSheet(ctx, 'PAUSAS_TRABAJADORES', ctx.COLUMNAS.PAUSAS_TRABAJADORES, [
    ['T1', 'HP', 'Juan', 'juan@hp.cl', 'Bodega', 'Operario', true, '2026-01-01'],
    ['T2', 'HP', 'Ana', 'ana@hp.cl', 'Ventas', 'Vendedora', true, '2026-01-01']
  ]);
  const pausas = [];
  if (opts.pausaHoy !== false) {
    pausas.push(['PA-1', 'HP', hoyClave(), '09:30', '', '', '', opts.estado || 'Programada', 10, '']);
  }
  (opts.pausasExtra || []).forEach((p) => pausas.push(p));
  seedSheet(ctx, 'PAUSAS_PROGRAMADAS', ctx.COLUMNAS.PAUSAS_PROGRAMADAS, pausas);
  seedSheet(ctx, 'PAUSAS_ASISTENCIA', ctx.COLUMNAS.PAUSAS_ASISTENCIA, opts.asistencia || []);
  seedSheet(ctx, 'PAUSAS_LOG', ctx.COLUMNAS.PAUSAS_LOG);
  return ctx;
}

test('getPanelCoordinador trae la pausa de hoy con la participacion en vivo', () => {
  const ctx = load({
    asistencia: [
      ['R1', 'PA-1', 'T1', 'juan@hp.cl', '2026-01-01T09:35:00Z', 'participo', '', '', true, 'autoservicio']
    ]
  });
  const res = ctx.Pausas.getPanelCoordinador({}, AMARLLA);
  assert.equal(res.pausas.length, 1);
  const p = res.pausas[0];
  assert.equal(p.estado, 'Programada');
  assert.equal(p.participacion.total_roster, 2);
  assert.equal(p.participacion.n_participaron, 1);
  assert.equal(p.participacion.n_pendientes, 1); // Ana aun no registra
});

test('getPanelCoordinador informa si no coordina ninguna empresa', () => {
  const ctx = load();
  const res = ctx.Pausas.getPanelCoordinador({}, AJENA);
  assert.equal(res.sin_empresa, true);
});

test('iniciar pasa la pausa a En_curso y guarda hora de inicio y coordinador', () => {
  const ctx = load();
  const res = ctx.Pausas.gestionarPausaCoordinador({ operacion: 'iniciar', pausa_id: 'PA-1' }, AMARLLA);
  assert.equal(res.estado, 'En_curso');
  assert.ok(res.hora_inicio_real);
  assert.equal(res.coordinador_email, 'amarlla@hp.cl');
});

test('finalizar (desde En_curso) pasa a Realizada con hora de fin y observaciones', () => {
  const ctx = load({ estado: 'En_curso' });
  const res = ctx.Pausas.gestionarPausaCoordinador({ operacion: 'finalizar', pausa_id: 'PA-1', observaciones: 'todo ok' }, AMARLLA);
  assert.equal(res.estado, 'Realizada');
  assert.ok(res.hora_fin);
  assert.equal(res.observaciones, 'todo ok');
});

test('no se puede finalizar una pausa que no esta En_curso (Programada)', () => {
  const ctx = load(); // Programada
  const res = ctx.Pausas.gestionarPausaCoordinador({ operacion: 'finalizar', pausa_id: 'PA-1' }, AMARLLA);
  assert.equal(res._validationError, true);
});

test('marcar no_realizada exige motivo y deja el motivo en observaciones', () => {
  const ctx = load();
  assert.equal(ctx.Pausas.gestionarPausaCoordinador({ operacion: 'no_realizada', pausa_id: 'PA-1' }, AMARLLA)._validationError, true);
  const res = ctx.Pausas.gestionarPausaCoordinador({ operacion: 'no_realizada', pausa_id: 'PA-1', motivo: 'emergencia' }, AMARLLA);
  assert.equal(res.estado, 'No_realizada');
  assert.equal(res.observaciones, 'emergencia');
});

test('un coordinador de otra empresa no puede operar la pausa (forbidden)', () => {
  const ctx = load();
  const res = ctx.Pausas.gestionarPausaCoordinador({ operacion: 'iniciar', pausa_id: 'PA-1' }, AJENA);
  assert.equal(res._forbidden, true);
});

test('el ADM puede operar cualquier pausa', () => {
  const ctx = load();
  const res = ctx.Pausas.gestionarPausaCoordinador({ operacion: 'iniciar', pausa_id: 'PA-1' }, ADMIN);
  assert.equal(res.estado, 'En_curso');
});

test('getReporteCumplimiento calcula KPIs, motivos y participacion por area', () => {
  const hoy = hoyClave();
  const ctx = load({
    estado: 'Realizada',
    pausasExtra: [
      ['PA-2', 'HP', '2026-07-10', '09:30', '', '', '', 'No_realizada', 10, 'sin gente'],
      ['PA-3', 'HP', '2026-07-11', '09:30', '', '', '', 'Cancelada', 10, '']
    ],
    asistencia: [
      ['R1', 'PA-1', 'T1', 'juan@hp.cl', hoy + 'T09:35:00Z', 'participo', '', '', true, 'autoservicio'],
      ['R2', 'PA-1', 'T2', 'ana@hp.cl', hoy + 'T09:36:00Z', 'no_participo', 'En reunión', '', false, 'autoservicio']
    ]
  });
  const res = ctx.Pausas.getReporteCumplimiento({ desde: '2026-07-01', hasta: '2026-12-31' }, AMARLLA);
  assert.equal(res.kpis.programadas, 3);
  assert.equal(res.kpis.realizadas, 1);
  assert.equal(res.kpis.no_realizadas, 1);
  assert.equal(res.kpis.canceladas, 1);
  // cumplimiento = realizadas / (realizadas + no_realizadas) = 1/2 = 50%
  assert.equal(res.kpis.pct_cumplimiento, 50);
  assert.equal(res.kpis.participaciones, 1);
  assert.equal(res.kpis.justificaciones, 1);
  assert.equal(res.motivos[0].motivo, 'En reunión');
  assert.equal(res.por_area[0].area, 'Bodega'); // Juan participó, área Bodega
});

test('los reportes y el panel son ADM-only/coordinador (via router), no de cualquiera', () => {
  const ctx = load();
  // Sin ser coordinador ni ADM -> sin empresa (no ve nada).
  assert.equal(ctx.Pausas.getReporteCumplimiento({}, AJENA).sin_empresa, true);
});
