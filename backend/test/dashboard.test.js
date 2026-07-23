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
  seedSheet(ctx, 'COMENTARIOS', ctx.COLUMNAS.COMENTARIOS);
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
      sla_objetivo_horas: 24, estimacion_horas: '', horas_reales: '', fecha_creacion: base.fecha_creacion,
      // P7 (v2.0, Sprint 3): calcularAlertasPatron_ agrupa por (modulo, tipo)
      // a nivel de subsolicitud -- se reutilizan los mismos valores de la
      // solicitud como default de conveniencia para los tests existentes.
      modulo: base.modulo, tipo: base.tipo
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

// P6 (v2.0, Sprint 2): filtro por solicitante, para Gerencia (o cualquier
// rol) sin depender de cruzar con otra planilla. Se usa ADM (bandeja sin
// acotar) para probar el filtro en si mismo, sin mezclarlo con el
// auto-scope por rol (ver los tests de v4.1.1 mas abajo).
test('Dashboard.getData (P6) respeta el filtro solicitante -- coincidencia parcial por nombre o correo', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001', solicitante_nombre: 'Juan Perez', solicitante_email: 'juan@homepymes.cl' });
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0002', solicitante_nombre: 'Camila Pena', solicitante_email: 'camila@homepymes.cl' });

  const porNombre = ctx.Dashboard.getData({ solicitante: 'juan' }, { rol: 'ADM' });
  assert.equal(porNombre.recientes.length, 1);
  assert.equal(porNombre.recientes[0].solicitud_id, 'SOL-2026-HP-0001');

  const porCorreo = ctx.Dashboard.getData({ solicitante: 'camila@homepymes.cl' }, { rol: 'ADM' });
  assert.equal(porCorreo.recientes.length, 1);
  assert.equal(porCorreo.recientes[0].solicitud_id, 'SOL-2026-HP-0002');
});

// v4.1.1: hallazgo real -- Felipe (GERENCIA) tenia ademas el modulo
// "bandeja" habilitado y desde ahi veia TODAS las solicitudes, no solo las
// que le llegan a el. Solo ADM debe ver la bandeja sin acotar por defecto;
// cualquier otro rol (Gerencia incluida) queda auto-acotado a su propio
// correo, igual que ya pasaba con DEV. Gerencia sigue viendo todo desde el
// Panel de Gerencia (Gerencia.getPanel), que no se toca aca.
test('Dashboard.getData (v4.1.1) GERENCIA en "Bandeja de trabajo" solo ve lo asignado a su propio correo', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001', desarrollador_asignado: 'gerencia@rld.cl' }, ['S02']);
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0002', desarrollador_asignado: 'otro@rld.cl' }, ['S02']);

  const datos = ctx.Dashboard.getData({}, { rol: 'GERENCIA', email: 'gerencia@rld.cl' });

  const ids = datos.recientes.map((r) => r.solicitud_id).sort();
  assert.deepEqual(ids, ['SOL-2026-HP-0001']);
});

// v4.1.1: este es el escenario EXACTO del bug reportado -- Felipe
// (GERENCIA) no tenia ninguna solicitud asignada a su correo, pero las
// solicitudes P1 "Sin asignar" en estado activo (S02, dentro de
// ESTADOS_TRABAJO_DEV) igual le aparecian en su bandeja, por el respaldo
// de huerfanas pensado solo para el DEV. Sin nada asignado, su bandeja
// debe quedar vacia (no mostrar el trabajo huerfano de todo el mundo).
test('Dashboard.getData (v4.1.1) GERENCIA sin nada asignado NO ve las huerfanas activas sin asignar (a diferencia del DEV)', () => {
  const ctx = loadConSchema();
  // S05 (en desarrollo) esta dentro de ESTADOS_TRABAJO_DEV -- es la que
  // dispara el respaldo de huerfanas para el DEV.
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001', prioridad_derivada: 'P1', estado_derivado: 'S05' }, ['S05']);

  const datosGerencia = ctx.Dashboard.getData({}, { rol: 'GERENCIA', email: 'gerencia@rld.cl' });
  const datosDev = ctx.Dashboard.getData({}, { rol: 'DEV', email: 'dev@homepymes.cl' });

  assert.equal(datosGerencia.recientes.length, 0);
  assert.equal(datosDev.recientes.length, 1, 'el DEV si conserva el respaldo original (Fase 2)');
});

test('Dashboard.getData (v4.1.1) ADM sigue viendo todas las solicitudes sin acotar', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001', desarrollador_asignado: 'gerencia@rld.cl' }, ['S02']);
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0002', desarrollador_asignado: 'otro@rld.cl' }, ['S02']);

  const datos = ctx.Dashboard.getData({}, { rol: 'ADM', email: 'admin@homepymes.cl' });

  const ids = datos.recientes.map((r) => r.solicitud_id).sort();
  assert.deepEqual(ids, ['SOL-2026-HP-0001', 'SOL-2026-HP-0002']);
});

// v4.1.1: solo ADM recibe la lista de responsables (el selector "Ver
// bandeja de" en el frontend depende de datos.responsables para mostrarse
// -- ver dashboard.js:renderSelectorBandeja_).
test('Dashboard.getData (v4.1.1) solo ADM recibe datos.responsables -- Gerencia ya no ve el selector de bandeja', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001' }, ['S02']);

  const datosAdm = ctx.Dashboard.getData({}, { rol: 'ADM', email: 'admin@homepymes.cl' });
  const datosGerencia = ctx.Dashboard.getData({}, { rol: 'GERENCIA', email: 'gerencia@rld.cl' });

  assert.ok(Array.isArray(datosAdm.responsables));
  assert.equal(datosGerencia.responsables, undefined);
});

// P5 (v2.0, Sprint 3): badge "respuesta recibida" -- el item sigue en S06
// pero el solicitante ya respondio despues de la ultima pregunta.
test('Dashboard.getData (P5) marca respuesta_pendiente cuando hay un comentario publico posterior a la ultima entrada a S06', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001' }, ['S06']);
  ctx.agregarFila_('HISTORIAL_ESTADOS', {
    historial_id: 'h1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    estado_anterior: 'S03', estado_nuevo: 'S06', usuario: 'dev@homepymes.cl', comentario: '¿Que factura?',
    timestamp: '2026-01-01T10:00:00.000Z'
  });
  ctx.agregarFila_('COMENTARIOS', {
    comentario_id: 'c1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    usuario: 'juan@homepymes.cl', texto: 'La N-4521', es_interno: false, timestamp: '2026-01-02T10:00:00.000Z'
  });

  const datos = ctx.Dashboard.getData({}, { rol: 'ADM' });
  assert.equal(datos.recientes[0].respuesta_pendiente, true);
});

test('Dashboard.getData (P5) NO marca respuesta_pendiente si el comentario es ANTERIOR a la ultima entrada a S06', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001' }, ['S06']);
  ctx.agregarFila_('COMENTARIOS', {
    comentario_id: 'c1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    usuario: 'juan@homepymes.cl', texto: 'Comentario viejo', es_interno: false, timestamp: '2026-01-01T10:00:00.000Z'
  });
  ctx.agregarFila_('HISTORIAL_ESTADOS', {
    historial_id: 'h1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    estado_anterior: 'S03', estado_nuevo: 'S06', usuario: 'dev@homepymes.cl', comentario: '¿Que factura?',
    timestamp: '2026-01-02T10:00:00.000Z'
  });

  const datos = ctx.Dashboard.getData({}, { rol: 'ADM' });
  assert.equal(datos.recientes[0].respuesta_pendiente, false);
});

// P7 (v2.0, Sprint 3): alertas de patron.
test('Dashboard.getData (P7) detecta un patron: >=3 reportes del mismo (modulo,tipo) con >=2 solicitantes distintos', () => {
  const ctx = loadConSchema();
  const hoy = new Date().toISOString();
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-HP-0001', solicitante_email: 'juan@homepymes.cl', modulo: 'MOD_X', tipo: 'ERR', fecha_creacion: hoy
  }, ['S02']);
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-HP-0002', solicitante_email: 'ana@homepymes.cl', modulo: 'MOD_X', tipo: 'ERR', fecha_creacion: hoy
  }, ['S02']);
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-HP-0003', solicitante_email: 'ana@homepymes.cl', modulo: 'MOD_X', tipo: 'ERR', fecha_creacion: hoy
  }, ['S02']);

  const datos = ctx.Dashboard.getData({}, { rol: 'ADM' });
  assert.equal(datos.alertas_patron.length, 1);
  assert.equal(datos.alertas_patron[0].cantidad, 3);
  assert.equal(datos.alertas_patron[0].solicitantes_distintos, 2);
});

test('Dashboard.getData (P7) NO reporta un patron con menos de 2 solicitantes distintos', () => {
  const ctx = loadConSchema();
  const hoy = new Date().toISOString();
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-HP-0001', solicitante_email: 'juan@homepymes.cl', modulo: 'MOD_X', tipo: 'ERR', fecha_creacion: hoy
  }, ['S02']);
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-HP-0002', solicitante_email: 'juan@homepymes.cl', modulo: 'MOD_X', tipo: 'ERR', fecha_creacion: hoy
  }, ['S02']);
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-HP-0003', solicitante_email: 'juan@homepymes.cl', modulo: 'MOD_X', tipo: 'ERR', fecha_creacion: hoy
  }, ['S02']);

  const datos = ctx.Dashboard.getData({}, { rol: 'ADM' });
  assert.equal(datos.alertas_patron.length, 0);
});

test('Dashboard.getData enriquece recientes con cantidad_items, sla_restante_horas y asignado_a (Fase 10)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-HP-0001', desarrollador_asignado: 'dev@homepymes.cl', fecha_creacion: new Date().toISOString()
  }, ['S02', 'S05']);

  const datos = ctx.Dashboard.getData({}, { rol: 'ADM' });

  assert.equal(datos.recientes[0].cantidad_items, 2);
  assert.equal(datos.recientes[0].asignado_a, 'dev@homepymes.cl');
  assert.ok(datos.recientes[0].sla_restante_horas > 0); // recien creada, SLA de 24h aun no vence
});

test('Dashboard.getData incluye solicitante_nombre/email en recientes para la busqueda por texto (Fase 10.1)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitante_nombre: 'Camila Pena', solicitante_email: 'camila@homepymes.cl' });

  const datos = ctx.Dashboard.getData({}, { rol: 'ADM' });

  assert.equal(datos.recientes[0].solicitante_nombre, 'Camila Pena');
  assert.equal(datos.recientes[0].solicitante_email, 'camila@homepymes.cl');
});

test('Dashboard.getData: sla_restante_horas es null si ningun item tiene SLA activo', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001' }, ['S09']); // cerrada: excluida del SLA

  const datos = ctx.Dashboard.getData({}, { rol: 'ADM' });
  assert.equal(datos.recientes[0].sla_restante_horas, null);
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

test('Dashboard.getData NO se cae si una solicitud tiene fecha_creacion vacia o mal formada (dato pegado a mano)', () => {
  const ctx = loadConSchema();
  // Fila valida + fila con fecha vacia + fila con fecha basura (como las que
  // quedan al pegar datos manualmente en el Sheets).
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001' });
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-GDE-0005', fecha_creacion: '' });
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-GDE-0006', fecha_creacion: 'SOL-2026-GDE-[N1]' });

  // Antes esto lanzaba RangeError (Intl.format sobre fecha invalida) y el
  // dashboard entero quedaba en blanco. Ahora debe responder con las 3.
  const datos = ctx.Dashboard.getData({}, { rol: 'ADM', email: 'admin@homepymes.cl' });
  assert.equal(datos.recientes.length, 3);
  assert.ok(datos.resumen.total_abiertas >= 1);
});

// v3.1 (§1.6): una atencion directa se crea y se cierra en el mismo instante
// (se resolvio ANTES de registrarse), asi que su "tiempo de resolucion" es
// ~0. Si contara, hundiria el promedio y daria una lectura falsa de la
// capacidad real del equipo.
test('Dashboard (v3.1): las atenciones directas no entran al tiempo promedio de resolucion', () => {
  // Cierra una solicitud en HISTORIAL_ESTADOS (lo que lee tiempoPromedioResolucion_).
  function seedCierre(ctx, solicitudId, timestamp, estadoAnterior) {
    ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('HISTORIAL_ESTADOS').appendRow(
      ctx.COLUMNAS.HISTORIAL_ESTADOS.map((col) => ({
        historial_id: 'H-' + solicitudId, solicitud_id: solicitudId, subsolicitud_id: '',
        estado_anterior: estadoAnterior, estado_nuevo: 'S09', usuario: 'ana@homepymes.cl',
        comentario: '', timestamp: timestamp
      }[col] || ''))
    );
  }
  // Lunes 09:00 -> martes 09:00 hora de Santiago = 9 horas habiles.
  const CREADA = '2026-07-06T13:00:00.000Z';
  const CERRADA = '2026-07-07T13:00:00.000Z';
  const contexto = { rol: 'ADM', email: 'admin@homepymes.cl' };

  // Escenario A: solo una solicitud normal cerrada.
  const soloNormal = loadConSchema();
  seedSolicitud(soloNormal, { estado_derivado: 'S09', fecha_creacion: CREADA }, ['S09']);
  seedCierre(soloNormal, 'SOL-2026-HP-0001', CERRADA, 'S08');
  const promedioBase = soloNormal.Dashboard.getData({}, contexto).tiempo_promedio_resolucion_horas;
  assert.equal(promedioBase, 9, 'la solicitud normal si debe contar');

  // Escenario B: la misma, mas una atencion directa (creada y cerrada a la vez).
  const conAtencion = loadConSchema();
  seedSolicitud(conAtencion, { estado_derivado: 'S09', fecha_creacion: CREADA }, ['S09']);
  seedCierre(conAtencion, 'SOL-2026-HP-0001', CERRADA, 'S08');
  seedSolicitud(conAtencion, {
    solicitud_id: 'SOL-2026-HP-0002', estado_derivado: 'S09',
    fecha_creacion: CERRADA, atencion_directa: true
  }, ['S09']);
  seedCierre(conAtencion, 'SOL-2026-HP-0002', CERRADA, '');

  const datos = conAtencion.Dashboard.getData({}, contexto);
  assert.equal(
    datos.tiempo_promedio_resolucion_horas, promedioBase,
    'el promedio no debe moverse al agregar una atencion directa'
  );
  // Pero se cuentan aparte: cuanto se resuelve fuera del proceso.
  assert.equal(datos.resumen.atenciones_directas, 1);
});

// v5.2 (Fase B, §3.4): "pauta de trabajo por lote" -- getData es a nivel de
// SOLICITUD (no trae los campos que Leo necesita para ejecutar); esta accion
// es a nivel de ITEM, como la OT individual de detalle.js.
test('Dashboard.getPautaDesarrollador (v5.2 Fase B) trae solo los items abiertos del desarrollador, con los campos de ejecucion', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-HP-0001', desarrollador_asignado: 'leo@rld.cl', prioridad_derivada: 'P2'
  }, ['S05']);
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-HP-0002', desarrollador_asignado: 'otra@rld.cl', prioridad_derivada: 'P1'
  }, ['S02']);
  // Cerrada: no debe aparecer en la pauta aunque sea de Leo.
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-HP-0003', desarrollador_asignado: 'leo@rld.cl', prioridad_derivada: 'P3'
  }, ['S09']);
  ctx.actualizarFilaPorId_(ctx.SHEETS.SUBSOLICITUDES, 'subsolicitud_id', 'SOL-2026-HP-0001-01', {
    url_modulo: 'https://x.cl/modulo', usuario_prueba: 'demo', ref_credencial: 'ver 1Password'
  });

  const pauta = ctx.Dashboard.getPautaDesarrollador({ desarrollador: 'leo@rld.cl' }, { rol: 'ADM', email: 'admin@homepymes.cl' });

  assert.equal(pauta.desarrollador, 'leo@rld.cl');
  assert.equal(pauta.items.length, 1);
  assert.equal(pauta.items[0].solicitud_id, 'SOL-2026-HP-0001');
  assert.equal(pauta.items[0].url_modulo, 'https://x.cl/modulo');
  assert.equal(pauta.items[0].usuario_prueba, 'demo');
  // v5.2 (Fase D, §5): la sesion de planificacion llama comprometerFecha por
  // item -- necesita el ID real, no solo solicitud_id + numero_item.
  assert.equal(pauta.items[0].subsolicitud_id, 'SOL-2026-HP-0001-01');
});

test('Dashboard.getPautaDesarrollador (v5.2 Fase B) ordena P1 antes que P2 y exige el parametro desarrollador', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-HP-0001', desarrollador_asignado: 'leo@rld.cl', prioridad_derivada: 'P2'
  }, ['S05']);
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-HP-0002', desarrollador_asignado: 'leo@rld.cl', prioridad_derivada: 'P1'
  }, ['S02']);

  const pauta = ctx.Dashboard.getPautaDesarrollador({ desarrollador: 'leo@rld.cl' }, { rol: 'ADM', email: 'admin@homepymes.cl' });
  assert.equal(pauta.items[0].solicitud_id, 'SOL-2026-HP-0002');
  assert.equal(pauta.items[1].solicitud_id, 'SOL-2026-HP-0001');

  const error = ctx.Dashboard.getPautaDesarrollador({}, { rol: 'ADM', email: 'admin@homepymes.cl' });
  assert.equal(error._validationError, true);
});
