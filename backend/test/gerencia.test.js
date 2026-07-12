'use strict';

// v2.1 (Fase C, documentacion/SIGSO-v2.1-plazos-y-control.md §7): Panel de
// Control de Gerencia. Gerencia.getPanel es solo lectura -- agrupa datos
// que ya existen (SOLICITUDES/SUBSOLICITUDES) usando el semaforo de
// Cumplimiento.gs (Fase B), sin escribir nada.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'SUBSOLICITUDES', ctx.COLUMNAS.SUBSOLICITUDES);
  seedSheet(ctx, 'HISTORIAL_COMPROMISO', ctx.COLUMNAS.HISTORIAL_COMPROMISO);
  seedSheet(ctx, 'CONFIG_FERIADOS', ctx.COLUMNAS.CONFIG_FERIADOS);
  return ctx;
}

function seedSolicitud(ctx, overrides) {
  const base = Object.assign(
    {
      solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', plataforma: 'ERP', modulo: 'Facturacion',
      tipo: 'ERR', es_cliente: false, empresa_cliente: '', contacto_cliente: '', correo_cliente: '',
      solicitante_nombre: 'Juan Perez', solicitante_email: 'juan@homepymes.cl',
      estado_derivado: 'S05', prioridad_derivada: 'P2', orden_atencion: '',
      doc_estado: '', url_doc: '', url_pdf: '', dedup_hash: 'x',
      estimacion_total_horas: 4, horas_reales: '', resumen_whatsapp: '',
      fecha_creacion: '2026-07-01T10:00:00.000Z', creado_por: 'juan@homepymes.cl'
    },
    overrides
  );
  const fila = ctx.COLUMNAS.SOLICITUDES.map((col) => (base[col] !== undefined ? base[col] : ''));
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SOLICITUDES').appendRow(fila);
  return base;
}

function seedSubsolicitud(ctx, overrides) {
  const base = Object.assign(
    {
      subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001', numero_item: 1,
      titulo: 'Titulo', descripcion: 'Desc', impacto: 'DEGRADACION_IMPORTANTE',
      prioridad: 'P2', estado: 'S05', tipo: 'ERR', tipo_nombre: 'Error / Bug',
      fecha_creacion: '2026-07-01T10:00:00.000Z',
      fecha_comprometida: '', fecha_terminada: '', comprometida_por: ''
    },
    overrides
  );
  const fila = ctx.COLUMNAS.SUBSOLICITUDES.map((col) => (base[col] !== undefined ? base[col] : ''));
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SUBSOLICITUDES').appendRow(fila);
  return base;
}

test('Gerencia.getPanel (v2.1): agrupa items con su semaforo de cumplimiento', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { fecha_comprometida: '2026-08-20T18:00' });

  const panel = ctx.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });

  assert.equal(panel.items.length, 1);
  assert.equal(panel.items[0].subsolicitud_id, 'SOL-2026-HP-0001-01');
  assert.equal(panel.items[0].cumplimiento.codigo, 'EN_PLAZO');
});

test('Gerencia.getPanel (v2.1): KPIs -- sin comprometer y atrasadas activas', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-01' }); // sin fecha_comprometida
  seedSubsolicitud(ctx, {
    subsolicitud_id: 'SOL-2026-HP-0001-02', numero_item: 2,
    fecha_comprometida: '2026-01-01T18:00' // muy en el pasado -> atrasada
  });

  const panel = ctx.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });

  assert.equal(panel.kpis.sin_comprometer, 1);
  assert.equal(panel.kpis.atrasadas_activas, 1);
});

test('Gerencia.getPanel (v2.1): % cumplimiento del desarrollador solo cuenta lo entregado', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { estado_derivado: 'S09' });
  // Entregada a tiempo.
  seedSubsolicitud(ctx, {
    subsolicitud_id: 'SOL-2026-HP-0001-01', estado: 'S09',
    fecha_comprometida: '2026-08-05T18:00', fecha_terminada: '2026-08-01T10:00:00.000Z'
  });
  // Entregada con atraso.
  seedSubsolicitud(ctx, {
    subsolicitud_id: 'SOL-2026-HP-0001-02', numero_item: 2, estado: 'S09',
    fecha_comprometida: '2026-08-05T18:00', fecha_terminada: '2026-08-10T10:00:00.000Z'
  });
  // Sin comprometer todavia -- no cuenta ni de un lado ni del otro.
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-03', numero_item: 3, estado: 'S02' });

  const panel = ctx.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });

  assert.equal(panel.kpis.pct_cumplimiento_desarrollador, 50);
});

test('Gerencia.getPanel (v2.1): esperando validacion incluye promedio de dias', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, {
    estado: 'S08', fecha_comprometida: '2026-08-05T18:00',
    fecha_terminada: '2026-07-01T10:00:00.000Z'
  });

  const panel = ctx.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });

  assert.equal(panel.kpis.esperando_validacion, 1);
  assert.ok(panel.kpis.esperando_validacion_promedio_dias > 0);
});

test('Gerencia.getPanel (v2.1): resbalon -- re-compromiso queda visible en fecha_original y re_compromisos', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { fecha_comprometida: '2026-08-10T18:00' });
  seedSheet(ctx, 'HISTORIAL_COMPROMISO', ctx.COLUMNAS.HISTORIAL_COMPROMISO, [
    ['H1', 'SOL-2026-HP-0001-01', 'SOL-2026-HP-0001', '2026-08-05T18:00', '2026-08-10T18:00', 'El cliente amplio el alcance del item', 'dev@homepymes.cl', '2026-07-15T10:00:00.000Z']
  ]);

  const panel = ctx.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });

  assert.equal(panel.items[0].fecha_original, '2026-08-05T18:00');
  assert.equal(panel.items[0].re_compromisos, 1);
});

test('Gerencia.getPanel (v2.1): filtro por desarrollador (a nivel item)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-01', desarrollador_asignado: 'dev1@homepymes.cl' });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-02', numero_item: 2, desarrollador_asignado: 'dev2@homepymes.cl' });

  const panel = ctx.Gerencia.getPanel({ desarrollador: 'dev1@homepymes.cl' }, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });

  assert.equal(panel.items.length, 1);
  assert.equal(panel.items[0].subsolicitud_id, 'SOL-2026-HP-0001-01');
});

test('Gerencia.getPanel (v2.1): filtro por empresa reutiliza coincideFiltros_ de Dashboard.gs', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP' });
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-RLD-0001', empresa_id: 'RLD' });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001' });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-RLD-0001-01', solicitud_id: 'SOL-2026-RLD-0001', numero_item: 1 });

  const panel = ctx.Gerencia.getPanel({ empresa_id: 'RLD' }, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });

  assert.equal(panel.items.length, 1);
  assert.equal(panel.items[0].empresa_id, 'RLD');
});

// v3.0 (Fase 4, documentacion/SIGSO-v3.0-multi-responsable-y-control.md §6):
// columnas del tablero de seguimiento (reemplaza la Carta Gantt como vista
// principal) + semaforo propio del solicitante.

test('Gerencia.getPanel (v3.0): dias_abierta y dias_desarrollador de un item activo, comprometido', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  const ahora = new Date('2026-07-10T10:00:00.000Z');
  seedSubsolicitud(ctx, {
    fecha_creacion: '2026-07-01T10:00:00.000Z',
    fecha_comprometida: '2026-08-20T18:00'
  });

  const panel = ctx.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  const item = panel.items[0];

  assert.ok(item.dias_abierta > 0);
  assert.ok(item.dias_desarrollador >= 0);
});

test('Gerencia.getPanel (v3.0): dias_desarrollador es null si el item aun no tiene fecha comprometida', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx); // sin fecha_comprometida

  const panel = ctx.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });

  assert.equal(panel.items[0].dias_desarrollador, null);
  assert.ok(panel.items[0].dias_abierta > 0);
});

test('Gerencia.getPanel (v3.0): semaforo_solicitante es null salvo cuando el item esta ESPERANDO_VALIDACION', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { fecha_comprometida: '2026-08-20T18:00' }); // EN_PLAZO, no ESPERANDO_VALIDACION

  const panel = ctx.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });

  assert.equal(panel.items[0].cumplimiento.codigo, 'EN_PLAZO');
  assert.equal(panel.items[0].semaforo_solicitante, null);
});

test('Gerencia.getPanel (v3.0): semaforo_solicitante rojo cuando lleva >= 5 dias esperando validacion', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { estado_derivado: 'S08' });
  seedSubsolicitud(ctx, {
    estado: 'S08', fecha_comprometida: '2026-06-20T18:00',
    fecha_terminada: '2026-06-20T18:00:00.000Z'
  });

  const panel = ctx.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  const item = panel.items[0];

  assert.equal(item.cumplimiento.codigo, 'ESPERANDO_VALIDACION');
  assert.ok(item.cumplimiento.dias_esperando >= 5);
  assert.equal(item.semaforo_solicitante.codigo, 'CERCA_CIERRE_AUTOMATICO');
});

test('Gerencia.getPanel (UI-1): resuelve desarrollador_nombre desde USUARIOS (y tolera hoja ausente)', () => {
  const ctx = loadConSchema();
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Dev Uno', 'dev1@homepymes.cl', 'HP', 'DEV', true, '', 'sistema']
  ]);
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { desarrollador_asignado: 'dev1@homepymes.cl' });

  const panel = ctx.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'g@homepymes.cl' });
  assert.equal(panel.items[0].desarrollador_nombre, 'Dev Uno');

  // Sin la hoja USUARIOS (instalacion fresca/tests) no debe romper.
  const ctx2 = loadConSchema();
  seedSolicitud(ctx2);
  seedSubsolicitud(ctx2, { desarrollador_asignado: 'x@homepymes.cl' });
  const panel2 = ctx2.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'g@homepymes.cl' });
  assert.equal(panel2.items[0].desarrollador_nombre, '');
});

test('Gerencia.getPanel (v3.0): semaforo_solicitante verde cuando recien se entrego (< 1 dia esperando)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { estado_derivado: 'S08' });
  const haceUnRato = new Date();
  haceUnRato.setHours(haceUnRato.getHours() - 1);
  seedSubsolicitud(ctx, {
    estado: 'S08', fecha_comprometida: '2026-06-20T18:00',
    fecha_terminada: haceUnRato.toISOString()
  });

  const panel = ctx.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  const item = panel.items[0];

  assert.equal(item.cumplimiento.codigo, 'ESPERANDO_VALIDACION');
  assert.equal(item.semaforo_solicitante.codigo, 'RECIEN_ENTREGADO');
});
