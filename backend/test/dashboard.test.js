'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'SUBSOLICITUDES', ctx.COLUMNAS.SUBSOLICITUDES);
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS);
  seedSheet(ctx, 'CONFIG_FERIADOS', ctx.COLUMNAS.CONFIG_FERIADOS);
  return ctx;
}

function seedSolicitud(ctx, overrides, subestados) {
  const base = Object.assign(
    {
      solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', plataforma: 'ERP', modulo: 'Facturacion',
      tipo: 'ERR', solicitante_nombre: 'Juan', solicitante_cargo: 'Analista', solicitante_email: 'juan@homepymes.cl',
      es_cliente: false, empresa_cliente: '', cliente_mandante: '', cliente_obra: '',
      contacto_cliente: '', correo_cliente: '', telefono_cliente: '', urgencia_cliente: '',
      estado_derivado: 'S02', prioridad_derivada: 'P2', orden_atencion: '',
      doc_estado: '', doc_reintentos: 0, url_doc: '', url_pdf: '', version_documento: 0, url_pdf_historial: '',
      dedup_hash: 'x', estimacion_total_horas: 4, horas_reales: '', observaciones_generales: '',
      resumen_whatsapp: '', fecha_creacion: new Date().toISOString(), creado_por: 'juan@homepymes.cl'
    },
    overrides
  );
  const fila = ctx.COLUMNAS.SOLICITUDES.map((col) => base[col]);
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SOLICITUDES').appendRow(fila);

  (subestados || ['S02']).forEach((estado, idx) => {
    const subFila = ctx.COLUMNAS.SUBSOLICITUDES.map((col) => ({
      subsolicitud_id: base.solicitud_id + '-0' + (idx + 1), solicitud_id: base.solicitud_id, numero_item: idx + 1,
      titulo: 't', descripcion: 'd', contexto: '', resultado_esperado: '', impacto: '',
      prioridad: base.prioridad_derivada, estado: estado, url_modulo: '', usuario_prueba: '',
      ref_credencial: '', centro_costos: '', url_video: '', observaciones: '',
      sla_objetivo_horas: 24, estimacion_horas: '', horas_reales: '', fecha_creacion: base.fecha_creacion
    }[col]));
    ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SUBSOLICITUDES').appendRow(subFila);
  });

  return base;
}

test('Dashboard.getData calcula el resumen general (abiertas, criticas, del dia)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001', prioridad_derivada: 'P1', estado_derivado: 'S02' }, ['S02']);
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0002', prioridad_derivada: 'P3', estado_derivado: 'S09' }, ['S09']);

  const datos = ctx.Dashboard.getData({}, { rol: 'ADM', email: 'admin@homepymes.cl' });

  assert.equal(datos.resumen.total_abiertas, 1);
  assert.equal(datos.resumen.criticas_activas, 1);
  assert.equal(datos.resumen.del_dia, 2);
});

test('Dashboard.getData agrupa por empresa/plataforma/estado/prioridad', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP' });
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-RLD-0001', empresa_id: 'RLD' });

  const datos = ctx.Dashboard.getData({}, { rol: 'ADM' });
  const empresas = toPlain(datos.por_empresa.map((e) => e.clave)).sort();
  assert.deepEqual(empresas, ['HP', 'RLD']);
});

test('Dashboard.getData detecta SLA vencido en subsolicitudes abiertas', () => {
  const ctx = loadConSchema();
  // 10 dias calendario garantiza superar 24 horas habiles sin importar
  // en que dia de la semana caiga "ahora" en el momento del test.
  const hace10Dias = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001', fecha_creacion: hace10Dias }, ['S02']);

  const datos = ctx.Dashboard.getData({}, { rol: 'ADM' });
  assert.equal(datos.resumen.sla_vencido, 1);
});

test('Dashboard.getData respeta los filtros (empresa_id)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP' });
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-RLD-0001', empresa_id: 'RLD' });

  const datos = ctx.Dashboard.getData({ empresa_id: 'HP' }, { rol: 'ADM' });
  assert.equal(datos.recientes.length, 1);
  assert.equal(datos.recientes[0].empresa_id, 'HP');
});

test('Dashboard.getData (DEV sin asignaciones) usa como respaldo los estados de trabajo activo', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001', estado_derivado: 'S02' }, ['S02']);
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0002', estado_derivado: 'S05' }, ['S05']);

  const datosAdmin = ctx.Dashboard.getData({}, { rol: 'ADM', email: 'admin@homepymes.cl' });
  const datosDev = ctx.Dashboard.getData({}, { rol: 'DEV', email: 'dev@homepymes.cl' });

  assert.equal(datosAdmin.recientes.length, 2);
  assert.equal(datosDev.recientes.length, 1);
  assert.equal(datosDev.recientes[0].solicitud_id, 'SOL-2026-HP-0002');
});

test('Dashboard.getData (DEV) ve las solicitudes asignadas a el aunque no esten en estado activo', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001', estado_derivado: 'S02', desarrollador_asignado: 'dev@homepymes.cl' }, ['S02']);
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0002', estado_derivado: 'S05', desarrollador_asignado: 'otro-dev@homepymes.cl' }, ['S05']);

  const datosDev = ctx.Dashboard.getData({}, { rol: 'DEV', email: 'dev@homepymes.cl' });

  const ids = datosDev.recientes.map((r) => r.solicitud_id).sort();
  assert.deepEqual(ids, ['SOL-2026-HP-0001']);
});

test('Dashboard.getData (DEV) ve solicitudes donde solo una subsolicitud (no la solicitud completa) esta asignada a el (§13.3 v1.0)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001', estado_derivado: 'S02' }, ['S02']);
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0002', estado_derivado: 'S02' }, ['S02']);

  ctx.actualizarFilaPorId_(ctx.SHEETS.SUBSOLICITUDES, 'subsolicitud_id', 'SOL-2026-HP-0001-01', {
    desarrollador_asignado: 'dev@homepymes.cl'
  });

  const datosDev = ctx.Dashboard.getData({}, { rol: 'DEV', email: 'dev@homepymes.cl' });

  const ids = datosDev.recientes.map((r) => r.solicitud_id).sort();
  assert.deepEqual(ids, ['SOL-2026-HP-0001']);
});

test('Dashboard.getData usa el cache en la segunda llamada (C-13)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001' });

  const primera = ctx.Dashboard.getData({}, { rol: 'ADM' });
  // Se agrega una solicitud nueva DESPUES de la primera llamada: si el
  // cache funciona, la segunda llamada no deberia reflejarla todavia.
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0002' });
  const segunda = ctx.Dashboard.getData({}, { rol: 'ADM' });

  assert.equal(primera.resumen.del_dia, segunda.resumen.del_dia);
});

test('Dashboard.getData recalcula tras expirar el cache', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001' });
  ctx.Dashboard.getData({}, { rol: 'ADM', email: 'admin@homepymes.cl' });

  ctx.CacheService.getScriptCache().remove('dashboard_kpis::ADM:admin@homepymes.cl::{}');
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0002' });
  const datos = ctx.Dashboard.getData({}, { rol: 'ADM', email: 'admin@homepymes.cl' });

  assert.equal(datos.resumen.del_dia, 2);
});
