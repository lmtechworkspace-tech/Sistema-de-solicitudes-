'use strict';

/**
 * v7.2 (Bloque A): mejoras de Pausas Activas / Coordinacion de pausas.
 *  - A1 "pasar lista grupal": registrarAsistenciaGrupal (coordinador).
 *  - A4 "rachas por area" (equipo, nunca individual -- RN-708).
 *  - A6 micro-encuesta de bienestar (animo, 1..5, opcional, agregada).
 *  - A7 distinguir "no se hizo" (empresa) de "sin registro" (persona) --
 *    cubierto en pausas-tendencia-historial.test.js.
 *  - A8 "resiliencia del coordinador": escalarPausasSinIniciar.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

const ADMIN = { rol: 'ADM', email: 'admin@homepymes.cl' };
const COORD = { rol: 'SOLICITANTE', email: 'amarlla@hp.cl' };

function hoy() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function load(opts) {
  opts = opts || {};
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'NOTIFICACIONES_APP', ctx.COLUMNAS.NOTIFICACIONES_APP, []);
  seedSheet(ctx, 'PAUSAS_CONFIG', ctx.COLUMNAS.PAUSAS_CONFIG, opts.config || [
    ['HP', '09:30', '1,2,3,4,5', 10, 15, 80, 60, true]
  ]);
  seedSheet(ctx, 'PAUSAS_COORDINADORES', ctx.COLUMNAS.PAUSAS_COORDINADORES, [
    ['CO-1', 'HP', 'Amarlla', 'amarlla@hp.cl', 'titular', true]
  ]);
  seedSheet(ctx, 'PAUSAS_TRABAJADORES', ctx.COLUMNAS.PAUSAS_TRABAJADORES, opts.trabajadores || [
    ['T1', 'HP', 'Juan', 'juan@hp.cl', 'Bodega', 'Operario', true, '2026-01-01'],
    ['T2', 'HP', 'Ana', 'ana@hp.cl', 'Bodega', 'Operaria', true, '2026-01-01'],
    ['T3', 'HP', 'Luis', 'luis@hp.cl', 'Ventas', 'Vendedor', true, '2026-01-01']
  ]);
  seedSheet(ctx, 'PAUSAS_PROGRAMADAS', ctx.COLUMNAS.PAUSAS_PROGRAMADAS, opts.pausas || []);
  seedSheet(ctx, 'PAUSAS_ASISTENCIA', ctx.COLUMNAS.PAUSAS_ASISTENCIA, opts.asistencia || []);
  seedSheet(ctx, 'PAUSAS_LOG', ctx.COLUMNAS.PAUSAS_LOG);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [['U1', 'Admin', 'admin@homepymes.cl', 'HP', 'ADM', true, '', 'sistema']]);
  seedSheet(ctx, 'CUENTAS_PORTAL', ctx.COLUMNAS.CUENTAS_PORTAL, []);
  seedSheet(ctx, 'SESIONES_PORTAL', ctx.COLUMNAS.SESIONES_PORTAL, []);
  return ctx;
}

// ---- A1: pasar lista grupal -----------------------------------------------

test('registrarAsistenciaGrupal marca varios trabajadores en un solo envio', () => {
  const ctx = load({ pausas: [['PA-1', 'HP', hoy(), '09:30', '', '', '', 'En_curso', 10, '']] });
  const res = ctx.Pausas.registrarAsistenciaGrupal({
    pausa_id: 'PA-1',
    registros: [
      { trabajador_id: 'T1', estado: 'participo' },
      { trabajador_id: 'T2', estado: 'no_participo', motivo: 'Estaba en terreno' },
      { trabajador_id: 'T3', estado: 'participo' }
    ]
  }, COORD);
  assert.equal(res.actualizados, 3);
  assert.equal(res.omitidos, 0);
  const filas = ctx.leerFilas_('PAUSAS_ASISTENCIA');
  assert.equal(filas.length, 3);
  assert.ok(filas.every((f) => f.origen === 'pasada_lista'));
  const ana = filas.filter((f) => f.email === 'ana@hp.cl')[0];
  assert.equal(ana.estado, 'no_participo');
  assert.equal(ana.motivo, 'Estaba en terreno');
});

test('registrarAsistenciaGrupal NO pisa el autorregistro previo del trabajador, salvo sobrescribir:true', () => {
  const ctx = load({
    pausas: [['PA-1', 'HP', hoy(), '09:30', '', '', '', 'En_curso', 10, '']],
    asistencia: [['R1', 'PA-1', 'T1', 'juan@hp.cl', new Date().toISOString(), 'participo', '', '', true, 'autoservicio', '']]
  });
  const res = ctx.Pausas.registrarAsistenciaGrupal({
    pausa_id: 'PA-1',
    registros: [{ trabajador_id: 'T1', estado: 'no_participo', motivo: 'x' }]
  }, COORD);
  assert.equal(res.omitidos, 1);
  assert.equal(res.actualizados, 0);
  assert.equal(ctx.leerFilas_('PAUSAS_ASISTENCIA')[0].estado, 'participo'); // sigue el autorregistro

  const conSobrescribir = ctx.Pausas.registrarAsistenciaGrupal({
    pausa_id: 'PA-1', sobrescribir: true,
    registros: [{ trabajador_id: 'T1', estado: 'no_participo', motivo: 'x' }]
  }, COORD);
  assert.equal(conSobrescribir.actualizados, 1);
  assert.equal(ctx.leerFilas_('PAUSAS_ASISTENCIA')[0].estado, 'no_participo');
});

test('registrarAsistenciaGrupal exige que quien llama coordine esa empresa', () => {
  const ctx = load({ pausas: [['PA-1', 'HP', hoy(), '09:30', '', '', '', 'En_curso', 10, '']] });
  const res = ctx.Pausas.registrarAsistenciaGrupal({
    pausa_id: 'PA-1', registros: [{ trabajador_id: 'T1', estado: 'participo' }]
  }, { rol: 'SOLICITANTE', email: 'nadie@otra.cl' });
  assert.equal(res._forbidden, true);
});

test('registrarAsistenciaGrupal rechaza si la pausa ya no es registrable', () => {
  const ctx = load({ pausas: [['PA-1', 'HP', hoy(), '09:30', '', '', '', 'Realizada', 10, '']] });
  const res = ctx.Pausas.registrarAsistenciaGrupal({
    pausa_id: 'PA-1', registros: [{ trabajador_id: 'T1', estado: 'participo' }]
  }, COORD);
  assert.equal(res._validationError, true);
});

// ---- A6: micro-encuesta de bienestar --------------------------------------

test('registrarAsistencia guarda "animo" (1..5) si viene valido, y lo deja vacio si no', () => {
  const ctx = load({ pausas: [['PA-1', 'HP', hoy(), '09:30', '', '', '', 'En_curso', 10, '']] });
  ctx.Pausas.registrarAsistencia({ estado: 'participo', confirmacion: true, animo: 4 }, { email: 'juan@hp.cl' });
  assert.equal(ctx.leerFilas_('PAUSAS_ASISTENCIA')[0].animo, 4);

  const ctx2 = load({ pausas: [['PA-1', 'HP', hoy(), '09:30', '', '', '', 'En_curso', 10, '']] });
  ctx2.Pausas.registrarAsistencia({ estado: 'participo', confirmacion: true }, { email: 'juan@hp.cl' });
  assert.equal(ctx2.leerFilas_('PAUSAS_ASISTENCIA')[0].animo, '');

  const ctx3 = load({ pausas: [['PA-1', 'HP', hoy(), '09:30', '', '', '', 'En_curso', 10, '']] });
  ctx3.Pausas.registrarAsistencia({ estado: 'participo', confirmacion: true, animo: 9 }, { email: 'juan@hp.cl' });
  assert.equal(ctx3.leerFilas_('PAUSAS_ASISTENCIA')[0].animo, ''); // fuera de rango -- se ignora, no rompe
});

test('calcularReportePausas_ expone animo_promedio agregado, nunca por persona', () => {
  const ctx = load({
    pausas: [['PA-1', 'HP', hoy(), '09:30', '', '', '', 'Realizada', 10, '']],
    asistencia: [
      ['R1', 'PA-1', 'T1', 'juan@hp.cl', new Date().toISOString(), 'participo', '', '', true, 'autoservicio', 4],
      ['R2', 'PA-1', 'T2', 'ana@hp.cl', new Date().toISOString(), 'participo', '', '', true, 'autoservicio', 2]
    ]
  });
  const res = ctx.Pausas.getReporteGerencia({}, ADMIN);
  assert.equal(res.kpis.animo_promedio, 3);
  // El reporte agregado no debe filtrar el "animo" por persona en ningun lado.
  assert.ok(!JSON.stringify(res).includes('juan@hp.cl'));
});

test('calcularReportePausas_ da animo_promedio null si nadie respondio la encuesta', () => {
  const ctx = load({
    pausas: [['PA-1', 'HP', hoy(), '09:30', '', '', '', 'Realizada', 10, '']],
    asistencia: [['R1', 'PA-1', 'T1', 'juan@hp.cl', new Date().toISOString(), 'participo', '', '', true, 'autoservicio', '']]
  });
  const res = ctx.Pausas.getReporteGerencia({}, ADMIN);
  assert.equal(res.kpis.animo_promedio, null);
});

// ---- A4: rachas de equipo por area -----------------------------------------

test('calcularRachasPorArea_ (via getReporteGerencia) premia al EQUIPO, no a personas', () => {
  const ctx = load({
    pausas: [
      ['PA-1', 'HP', '2026-08-01', '09:30', '', '', '', 'Realizada', 10, ''],
      ['PA-2', 'HP', '2026-08-02', '09:30', '', '', '', 'Realizada', 10, '']
    ],
    asistencia: [
      // Bodega (T1, T2): ambos participan las 2 pausas -> 100% -> racha 2.
      ['R1', 'PA-1', 'T1', 'juan@hp.cl', '2026-08-01T09:35:00Z', 'participo', '', '', true, 'autoservicio', ''],
      ['R2', 'PA-1', 'T2', 'ana@hp.cl', '2026-08-01T09:35:00Z', 'participo', '', '', true, 'autoservicio', ''],
      ['R3', 'PA-2', 'T1', 'juan@hp.cl', '2026-08-02T09:35:00Z', 'participo', '', '', true, 'autoservicio', ''],
      ['R4', 'PA-2', 'T2', 'ana@hp.cl', '2026-08-02T09:35:00Z', 'participo', '', '', true, 'autoservicio', '']
      // Ventas (T3): nunca participa -> 0% -> racha 0.
    ]
  });
  const res = ctx.Pausas.getReporteGerencia({ desde: '2026-08-01', hasta: '2026-08-02' }, ADMIN);
  const bodega = res.rachas_area.filter((r) => r.area === 'Bodega')[0];
  const ventas = res.rachas_area.filter((r) => r.area === 'Ventas')[0];
  assert.equal(bodega.racha_actual, 2);
  assert.equal(bodega.roster, 2);
  assert.equal(ventas.racha_actual, 0);
  assert.equal(ventas.roster, 1);
});

test('calcularRachasPorArea_: una pausa No_realizada no corta la racha del area', () => {
  const ctx = load({
    trabajadores: [['T1', 'HP', 'Juan', 'juan@hp.cl', 'Bodega', 'Operario', true, '2026-01-01']],
    pausas: [
      ['PA-1', 'HP', '2026-08-01', '09:30', '', '', '', 'Realizada', 10, ''],
      ['PA-2', 'HP', '2026-08-02', '09:30', '', '', '', 'No_realizada', 10, ''],
      ['PA-3', 'HP', '2026-08-03', '09:30', '', '', '', 'Realizada', 10, '']
    ],
    asistencia: [
      ['R1', 'PA-1', 'T1', 'juan@hp.cl', '2026-08-01T09:35:00Z', 'participo', '', '', true, 'autoservicio', ''],
      ['R3', 'PA-3', 'T1', 'juan@hp.cl', '2026-08-03T09:35:00Z', 'participo', '', '', true, 'autoservicio', '']
    ]
  });
  const res = ctx.Pausas.getReporteGerencia({ desde: '2026-08-01', hasta: '2026-08-03' }, ADMIN);
  const bodega = res.rachas_area.filter((r) => r.area === 'Bodega')[0];
  assert.equal(bodega.racha_actual, 2); // PA-1 y PA-3 cuentan; PA-2 se salta
});

// ---- A8: resiliencia del coordinador (escalada a Admin) -------------------

test('escalarPausasSinIniciar avisa a ADM si nadie inicio la pausa pasado el margen, una sola vez', () => {
  const ctx = load({ pausas: [['PA-1', 'HP', hoy(), '09:30', '', '', '', 'Recordatorio_enviado', 10, '']] });
  // 9:30 = minuto 570. Con margen default 30, a las 10:05 (605) ya escala.
  const res1 = ctx.Pausas.escalarPausasSinIniciar({ ahoraMin: 605 });
  assert.equal(res1.pausas_escaladas, 1);
  assert.equal(ctx.MailApp._enviados.some((e) => e.destinatario === 'admin@homepymes.cl'), true);
  assert.equal(ctx.leerFilas_('PAUSAS_PROGRAMADAS')[0].escalada_admin_enviada, true);
  assert.equal(ctx.leerFilas_('NOTIFICACIONES_APP').some((n) => n.tipo === 'PAUSA_ESCALADA_ADMIN'), true);

  // Segunda corrida: no debe reenviar (ya escalada).
  const antes = ctx.MailApp._enviados.length;
  const res2 = ctx.Pausas.escalarPausasSinIniciar({ ahoraMin: 610 });
  assert.equal(res2.pausas_escaladas, 0);
  assert.equal(ctx.MailApp._enviados.length, antes);
});

test('escalarPausasSinIniciar no hace nada si aun no pasa el margen, o si la pausa ya se inicio', () => {
  const ctx = load({ pausas: [['PA-1', 'HP', hoy(), '09:30', '', '', '', 'Recordatorio_enviado', 10, '']] });
  const res = ctx.Pausas.escalarPausasSinIniciar({ ahoraMin: 575 }); // solo 5 min despues
  assert.equal(res.pausas_escaladas, 0);

  const ctx2 = load({ pausas: [['PA-1', 'HP', hoy(), '09:30', '', '', '', 'En_curso', 10, '']] });
  const res2 = ctx2.Pausas.escalarPausasSinIniciar({ ahoraMin: 605 });
  assert.equal(res2.pausas_escaladas, 0); // ya la iniciaron -- no es "sin iniciar"
});

test('enviarSegundosAvisosPausasTrigger llama tambien la escalada sin romper el segundo aviso', () => {
  const ctx = load({ pausas: [['PA-1', 'HP', hoy(), '09:30', '', '', '', 'Programada', 10, '']] });
  const res = ctx.enviarSegundosAvisosPausasTrigger();
  assert.equal(typeof res.ultima_llamada, 'number'); // sigue devolviendo el resultado del segundo aviso
});
