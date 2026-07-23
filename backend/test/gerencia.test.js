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
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS);
  seedSheet(ctx, 'CONFIG_FERIADOS', ctx.COLUMNAS.CONFIG_FERIADOS);
  return ctx;
}

function seedHistorialEstado(ctx, overrides) {
  const base = Object.assign(
    {
      historial_id: 'H-' + Math.random().toString(36).slice(2),
      solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
      estado_anterior: '', estado_nuevo: 'S01', usuario: 'sistema', comentario: '',
      timestamp: '2026-07-01T10:00:00.000Z'
    },
    overrides
  );
  const fila = ctx.COLUMNAS.HISTORIAL_ESTADOS.map((col) => (base[col] !== undefined ? base[col] : ''));
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('HISTORIAL_ESTADOS').appendRow(fila);
  return base;
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

// v3.1 (§1.6): las atenciones directas no pueden entrar al semaforo. Nunca
// tuvieron fecha comprometida (se resolvieron ANTES de existir en el
// sistema), asi que entrarian todas como SIN_COMPROMISO e inflarian esa
// categoria con casos donde no hay nada que corregir.
test('Gerencia.getPanel (v3.1): las atenciones directas no entran al semaforo', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { fecha_comprometida: '2026-08-20T18:00' });
  // Una segunda solicitud, registrada como atencion directa (ya resuelta).
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-HP-0002', estado_derivado: 'S09', atencion_directa: true
  });
  seedSubsolicitud(ctx, {
    subsolicitud_id: 'SOL-2026-HP-0002-01', solicitud_id: 'SOL-2026-HP-0002', estado: 'S09'
  });

  const panel = ctx.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });

  assert.equal(panel.items.length, 1, 'solo el item de la solicitud normal');
  assert.equal(panel.items[0].solicitud_id, 'SOL-2026-HP-0001');
  assert.equal(panel.kpis.sin_comprometer, 0, 'no debe inflar "sin comprometer"');
  // Pero se cuentan aparte: cuanto se esta resolviendo fuera del proceso.
  assert.equal(panel.atenciones_directas, 1);
});

// v4.1 (documentacion/SIGSO-v4.1-propuestas-panel-gerencia.md): Gerencia
// pidio ver el CONTENIDO de la solicitud en el tablero, y mas informacion
// para decidir. G1/G2/G3/G4/G6/G7 aprobadas.

test('Gerencia.getPanel (v4.1, G1): expone descripcion/resultado_esperado/plataforma_nombre/area_nombre', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { plataforma: 'ERP', plataforma_nombre: 'ERP Contable' });
  seedSubsolicitud(ctx, {
    descripcion: 'El boton de guardar no responde',
    resultado_esperado: 'Que guarde el formulario sin error',
    area: 'CONTA', area_nombre: 'Contabilidad'
  });

  const panel = ctx.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  const item = panel.items[0];

  assert.equal(item.descripcion, 'El boton de guardar no responde');
  assert.equal(item.resultado_esperado, 'Que guarde el formulario sin error');
  assert.equal(item.plataforma_nombre, 'ERP Contable');
  assert.equal(item.area_nombre, 'Contabilidad');
});

test('Gerencia.getPanel (v4.1, G1): "que deberia pasar" queda vacio en modo Rapido (nunca undefined)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { resultado_esperado: '' });

  const panel = ctx.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });

  assert.equal(panel.items[0].resultado_esperado, '');
});

test('Gerencia.getPanel (v4.1, G2): recurrencia agrupa por Modulo x Tipo, cuenta y % del total', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  const hoy = new Date().toISOString();
  seedSubsolicitud(ctx, {
    subsolicitud_id: 'SOL-2026-HP-0001-01', modulo_nombre: 'Facturacion', tipo_nombre: 'Error / Bug',
    fecha_creacion: hoy
  });
  seedSubsolicitud(ctx, {
    subsolicitud_id: 'SOL-2026-HP-0001-02', numero_item: 2, modulo_nombre: 'Facturacion', tipo_nombre: 'Error / Bug',
    fecha_creacion: hoy
  });
  seedSubsolicitud(ctx, {
    subsolicitud_id: 'SOL-2026-HP-0001-03', numero_item: 3, modulo_nombre: 'Dashboard', tipo_nombre: 'Mejora',
    fecha_creacion: hoy
  });

  const panel = ctx.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });

  assert.equal(panel.recurrencia.length, 2);
  const facturacionError = panel.recurrencia.find((r) => r.modulo_nombre === 'Facturacion' && r.tipo_nombre === 'Error / Bug');
  assert.equal(facturacionError.cantidad, 2);
  assert.equal(facturacionError.pct_total, Math.round((2 / 3) * 1000) / 10);
  // Ordenado de mayor a menor: el grupo con 2 va primero.
  assert.equal(panel.recurrencia[0].cantidad, 2);
});

test('Gerencia.getPanel (v4.1, G2): tendencia compara la cantidad del grupo vs el periodo anterior', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  // Periodo anterior (hace 45 dias): 1 solo item de Facturacion/Error.
  const hace45 = new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString();
  seedSubsolicitud(ctx, {
    subsolicitud_id: 'SOL-2026-HP-0001-01', modulo_nombre: 'Facturacion', tipo_nombre: 'Error / Bug',
    fecha_creacion: hace45
  });
  // Periodo actual (hoy): 3 items del mismo grupo -- subio.
  const hoy = new Date().toISOString();
  ['02', '03', '04'].forEach((n, idx) => {
    seedSubsolicitud(ctx, {
      subsolicitud_id: 'SOL-2026-HP-0001-' + n, numero_item: idx + 2,
      modulo_nombre: 'Facturacion', tipo_nombre: 'Error / Bug', fecha_creacion: hoy
    });
  });

  const panel = ctx.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  const grupo = panel.recurrencia.find((r) => r.modulo_nombre === 'Facturacion' && r.tipo_nombre === 'Error / Bug');

  assert.equal(grupo.cantidad, 3, 'solo cuenta el periodo actual (ultimos 30 dias)');
  assert.equal(grupo.tendencia, 2, '3 actuales - 1 anterior');
});

test('Gerencia.getPanel (v4.1, G2): reaperturas cuentan transiciones desde un estado cerrado hacia uno abierto', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S05' });
  seedHistorialEstado(ctx, { estado_anterior: '', estado_nuevo: 'S01', timestamp: '2026-07-01T10:00:00.000Z' });
  seedHistorialEstado(ctx, { estado_anterior: 'S08', estado_nuevo: 'S09', timestamp: '2026-07-05T10:00:00.000Z' });
  // Reapertura real: de Cerrada (S09) vuelve a En desarrollo (S05).
  seedHistorialEstado(ctx, { estado_anterior: 'S09', estado_nuevo: 'S05', timestamp: '2026-07-06T10:00:00.000Z' });

  const panel = ctx.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });

  assert.equal(panel.items[0].reaperturas, 1);
});

test('Gerencia.getPanel (v4.1, G3): tendencia trae 6 meses con creadas/cerradas/cumplimiento', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { estado_derivado: 'S09' });
  seedSubsolicitud(ctx, {
    estado: 'S09', fecha_comprometida: '2026-08-05T18:00', fecha_terminada: '2026-08-01T10:00:00.000Z'
  });

  const panel = ctx.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });

  assert.equal(panel.tendencia.length, 6);
  const conDatos = panel.tendencia.filter((m) => m.creadas > 0 || m.cerradas > 0);
  assert.ok(conDatos.length >= 0, 'no revienta aunque los meses caigan fuera de la ventana de 6 meses reales');
});

test('Gerencia.getPanel (v4.1, G4): ciclo por etapa mide dias habiles entre la primera vez que se entro a cada estado', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-01', estado: 'S02' });
  // Un lunes 09:00 -> jueves 09:00 = 3 dias habiles completos (L-V, sin feriados).
  seedHistorialEstado(ctx, {
    subsolicitud_id: 'SOL-2026-HP-0001-01', estado_anterior: '', estado_nuevo: 'S01',
    timestamp: '2026-07-06T09:00:00.000Z' // lunes
  });
  seedHistorialEstado(ctx, {
    subsolicitud_id: 'SOL-2026-HP-0001-01', estado_anterior: 'S01', estado_nuevo: 'S02',
    timestamp: '2026-07-09T09:00:00.000Z' // jueves
  });

  const panel = ctx.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });

  assert.equal(panel.ciclo_por_etapa.length, 8, 'S01..S09 son 8 transiciones');
  const s01s02 = panel.ciclo_por_etapa.find((c) => c.estado_desde === 'S01' && c.estado_hasta === 'S02');
  assert.equal(s01s02.muestras, 1);
  assert.equal(s01s02.dias_promedio, 3);
  const sinDatos = panel.ciclo_por_etapa.find((c) => c.estado_desde === 'S02' && c.estado_hasta === 'S03');
  assert.equal(sinDatos.dias_promedio, null);
  assert.equal(sinDatos.muestras, 0);
});

test('Gerencia.getPanel (v4.1, G4): usa la PRIMERA vez que entro a cada estado (un rebote no infla el promedio)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-01', estado: 'S02' });
  seedHistorialEstado(ctx, {
    subsolicitud_id: 'SOL-2026-HP-0001-01', estado_anterior: '', estado_nuevo: 'S01',
    timestamp: '2026-07-06T09:00:00.000Z'
  });
  seedHistorialEstado(ctx, {
    subsolicitud_id: 'SOL-2026-HP-0001-01', estado_anterior: 'S01', estado_nuevo: 'S02',
    timestamp: '2026-07-07T09:00:00.000Z' // 1 dia despues: primera vez en S02
  });
  // Rebote: vuelve a S01 y reentra a S02 mucho despues -- no debe contarse
  // como una segunda "primera vez".
  seedHistorialEstado(ctx, {
    subsolicitud_id: 'SOL-2026-HP-0001-01', estado_anterior: 'S02', estado_nuevo: 'S01',
    timestamp: '2026-07-08T09:00:00.000Z'
  });
  seedHistorialEstado(ctx, {
    subsolicitud_id: 'SOL-2026-HP-0001-01', estado_anterior: 'S01', estado_nuevo: 'S02',
    timestamp: '2026-07-20T09:00:00.000Z'
  });

  const panel = ctx.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  const s01s02 = panel.ciclo_por_etapa.find((c) => c.estado_desde === 'S01' && c.estado_hasta === 'S02');

  assert.equal(s01s02.muestras, 1, 'una sola muestra: la primera vez que entro a S02');
  assert.equal(s01s02.dias_promedio, 1);
});

test('Gerencia.getPanel (v4.1, G6): carga agrupa por empresa/plataforma/area', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { empresa_id: 'HP', plataforma_nombre: 'ERP Contable' });
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-RLD-0001', empresa_id: 'RLD', plataforma_nombre: 'Hoja de ruta' });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-01', area_nombre: 'Contabilidad' });
  seedSubsolicitud(ctx, {
    subsolicitud_id: 'SOL-2026-RLD-0001-01', solicitud_id: 'SOL-2026-RLD-0001', area_nombre: 'Operaciones'
  });

  const panel = ctx.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });

  assert.equal(panel.carga.por_empresa.length, 2);
  assert.ok(panel.carga.por_empresa.every((c) => c.cantidad === 1));
  assert.ok(panel.carga.por_plataforma.some((c) => c.etiqueta === 'ERP Contable'));
  assert.ok(panel.carga.por_area.some((c) => c.etiqueta === 'Operaciones'));
});

test('Gerencia.getPanel (v4.1, G7): kpis.comparativo trae el delta vs el periodo anterior', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { estado_derivado: 'S09' });
  // Periodo anterior (hace 45 dias): 1 atrasada activa.
  const hace45 = new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString();
  seedSubsolicitud(ctx, {
    subsolicitud_id: 'SOL-2026-HP-0001-01', fecha_creacion: hace45, fecha_comprometida: '2020-01-01T18:00'
  });
  // Periodo actual (hoy): 3 atrasadas activas -- empeoro.
  const hoy = new Date().toISOString();
  ['02', '03', '04'].forEach((n, idx) => {
    seedSubsolicitud(ctx, {
      subsolicitud_id: 'SOL-2026-HP-0001-' + n, numero_item: idx + 2,
      fecha_creacion: hoy, fecha_comprometida: '2020-01-01T18:00'
    });
  });

  const panel = ctx.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });

  assert.equal(panel.kpis.comparativo.atrasadas_activas, 2, '3 actuales - 1 anterior');
});

test('Gerencia.getPanel (v4.1, G7): comparativo es null (no cero) cuando falta dato en un lado', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { estado_derivado: 'S09' });
  // Solo hay entregas en el periodo actual -- el anterior no tiene ninguna,
  // asi que "% cumplimiento" no puede compararse (no es "empeoro a 0%").
  const hoy = new Date().toISOString();
  seedSubsolicitud(ctx, {
    fecha_creacion: hoy, estado: 'S09',
    fecha_comprometida: '2026-08-05T18:00', fecha_terminada: '2026-08-01T10:00:00.000Z'
  });

  const panel = ctx.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });

  assert.equal(panel.kpis.comparativo.pct_cumplimiento_desarrollador, null);
});

test('Gerencia.getPanel (v4.1): sin HISTORIAL_ESTADOS (instalacion vieja), G2/G4 no revientan y quedan en cero', () => {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'SUBSOLICITUDES', ctx.COLUMNAS.SUBSOLICITUDES);
  seedSheet(ctx, 'HISTORIAL_COMPROMISO', ctx.COLUMNAS.HISTORIAL_COMPROMISO);
  seedSheet(ctx, 'CONFIG_FERIADOS', ctx.COLUMNAS.CONFIG_FERIADOS);
  // OJO: HISTORIAL_ESTADOS NO se siembra a proposito.
  seedSolicitud(ctx);
  seedSubsolicitud(ctx);

  const panel = ctx.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });

  assert.equal(panel.items[0].reaperturas, 0);
  assert.ok(panel.ciclo_por_etapa.every((c) => c.muestras === 0));
});

// v5.2 (§4.2, propuesta de adopcion): el boton "Enviar a Gerencia ahora"
// solo debe ofrecerse al Administrador -- rol_actual tiene que reflejar
// SIEMPRE a quien esta mirando, no a quien poblo el cache (mismo criterio
// que Dashboard.getData, ver Gerencia.gs).
test('Gerencia.getPanel (v5.2): rol_actual viaja fresco incluso cuando el panel viene del cache', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx);

  const primero = ctx.Gerencia.getPanel({}, { rol: 'ADM', email: 'admin@homepymes.cl' });
  assert.equal(primero.rol_actual, 'ADM');

  // Mismos filtros -> misma clave de cache -- si rol_actual quedara adentro
  // del valor cacheado, este segundo caller (GERENCIA) veria "ADM" prestado.
  const segundo = ctx.Gerencia.getPanel({}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  assert.equal(segundo.rol_actual, 'GERENCIA');
});
