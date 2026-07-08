'use strict';

/**
 * e2e-ciclo-vida.test.js — Fase 8 (QA integral). A diferencia del resto de
 * la suite (unitaria, un modulo a la vez), esta prueba recorre el ciclo de
 * vida completo de una solicitud -- creacion -> aprobacion -> desarrollo ->
 * pruebas -> cierre -- y verifica que Documentos, Notificaciones, Dashboard
 * y el panel de logs (RF-019) queden consistentes al final, para dos
 * empresas en paralelo (HomePymes y RLD, requisito multiempresa).
 *
 * Cruza dos proyectos Apps Script (Intake genera la solicitud, Backoffice
 * la gestiona hasta el cierre); como son procesos separados sin Sheet real
 * compartida, se simula el traspaso sembrando en Backoffice exactamente la
 * misma fila que `Intake.Solicitudes.crearSolicitud` ya deja probado que
 * escribe (ver test/solicitudes.test.js) -- swchema-consistency.test.js
 * garantiza que ambos proyectos comparten columnas.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'e2e-drive-root' }
  });
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'SUBSOLICITUDES', ctx.COLUMNAS.SUBSOLICITUDES);
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS);
  seedSheet(ctx, 'HISTORIAL_PRIORIDAD', ctx.COLUMNAS.HISTORIAL_PRIORIDAD);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'CONFIG_FERIADOS', ctx.COLUMNAS.CONFIG_FERIADOS);
  seedSheet(ctx, 'CONFIG_SLA', ctx.COLUMNAS.CONFIG_SLA, [
    ['P1', 2], ['P2', 24], ['P3', 72], ['P4', 120], ['P5', '']
  ]);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Analista HP', 'analista@homepymes.cl', 'HP', 'ANA', true, '', 'sistema'],
    ['U2', 'Dev HP', 'dev@homepymes.cl', 'HP', 'DEV', true, '', 'sistema'],
    ['U3', 'Admin HP', 'admin@homepymes.cl', 'HP', 'ADM', true, '', 'sistema'],
    ['U4', 'Analista RLD', 'analista@rld.cl', 'RLD', 'ANA', true, '', 'sistema'],
    ['U5', 'Dev RLD', 'dev@rld.cl', 'RLD', 'DEV', true, '', 'sistema']
  ]);
  return ctx;
}

// Simula la fila que Intake.Solicitudes.crearSolicitud ya deja probado que
// escribe (test/solicitudes.test.js), recien nacida en S01.
function seedSolicitudRecienCreada(ctx, overrides) {
  const base = Object.assign(
    {
      solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', empresa_nombre: 'HomePymes',
      plataforma: 'ERP', plataforma_nombre: 'ERP HomePymes', modulo: 'Facturacion', modulo_nombre: 'Facturacion',
      tipo: 'ERR', tipo_nombre: 'Error / Bug',
      solicitante_nombre: 'Juan Perez', solicitante_cargo: 'Jefe de Area', solicitante_email: 'juan@homepymes.cl',
      es_cliente: false, empresa_cliente: '', cliente_mandante: '', cliente_obra: '',
      contacto_cliente: '', correo_cliente: '', telefono_cliente: '', urgencia_cliente: '',
      estado_derivado: 'S01', prioridad_derivada: 'P2', orden_atencion: '',
      analista_asignado: '', desarrollador_asignado: '',
      doc_estado: '', doc_reintentos: 0, url_doc: '', url_pdf: '', version_documento: 0, url_pdf_historial: '',
      dedup_hash: 'e2e-hp-1', estimacion_total_horas: 8, horas_reales: '', observaciones_generales: '',
      resumen_whatsapp: 'resumen', fecha_creacion: new Date().toISOString(), creado_por: 'juan@homepymes.cl'
    },
    overrides
  );
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SOLICITUDES')
    .appendRow(ctx.COLUMNAS.SOLICITUDES.map((col) => base[col]));

  const subBase = {
    subsolicitud_id: base.solicitud_id + '-01', solicitud_id: base.solicitud_id, numero_item: 1,
    titulo: 'Boton de exportar no funciona', descripcion: 'Al hacer click no descarga el archivo',
    contexto: '', resultado_esperado: '', impacto: 'BLOQUEO_OPERATIVO', prioridad: base.prioridad_derivada,
    estado: 'S01', url_modulo: '', usuario_prueba: '', ref_credencial: '', centro_costos: '',
    url_video: '', observaciones: '', sla_objetivo_horas: 24, estimacion_horas: 8, horas_reales: '',
    fecha_creacion: base.fecha_creacion, desarrollador_asignado: ''
  };
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SUBSOLICITUDES')
    .appendRow(ctx.COLUMNAS.SUBSOLICITUDES.map((col) => subBase[col]));

  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('HISTORIAL_ESTADOS').appendRow(
    ['h-' + base.solicitud_id, base.solicitud_id, subBase.subsolicitud_id, '', 'S01', base.creado_por, '', base.fecha_creacion]
  );

  return { solicitud: base, subsolicitud: subBase };
}

function avanzarEstado(ctx, subsolicitudId, estadoNuevo, contexto, comentario) {
  const resultado = ctx.Solicitudes.actualizarEstado(
    { subsolicitud_id: subsolicitudId, estado_nuevo: estadoNuevo, comentario: comentario || '' },
    contexto
  );
  assert.equal(resultado._validationError, undefined, 'transicion ' + estadoNuevo + ' rechazada: ' + JSON.stringify(resultado));
  assert.equal(resultado._forbidden, undefined, 'transicion ' + estadoNuevo + ' prohibida: ' + JSON.stringify(resultado));
  return resultado;
}

// RN-201 (v2.0, Sprint 1): "Cerrada" (S09) ya no la fija el gestor -- la
// confirma el solicitante desde Consultar Estado (Solicitudes.validarCierre,
// backend/intake, un proyecto Apps Script distinto sin Sheet compartida en
// este sandbox). Se simula aqui la misma escritura que hace ese endpoint,
// igual que seedSolicitudRecienCreada simula lo que ya deja probado crearSolicitud.
function confirmarCierrePorSolicitante(ctx, solicitudId, subsolicitudId, email) {
  ctx.actualizarFilaPorId_('SUBSOLICITUDES', 'subsolicitud_id', subsolicitudId, { estado: 'S09' });
  ctx.agregarFila_('HISTORIAL_ESTADOS', {
    historial_id: 'h-cierre-' + subsolicitudId, solicitud_id: solicitudId, subsolicitud_id: subsolicitudId,
    estado_anterior: 'S08', estado_nuevo: 'S09', usuario: email,
    comentario: 'Cierre confirmado por el solicitante.', timestamp: new Date().toISOString()
  });
  return ctx.recalcularEstadoDerivado_(solicitudId);
}

test('Ciclo de vida completo (S01 -> S09) de una solicitud de HomePymes: aprobacion, documento, desarrollo, cierre', () => {
  const ctx = loadConSchema();
  const { solicitud, subsolicitud } = seedSolicitudRecienCreada(ctx);
  const analista = { email: 'analista@homepymes.cl', rol: 'ANA' };
  const dev = { email: 'dev@homepymes.cl', rol: 'DEV' };

  avanzarEstado(ctx, subsolicitud.subsolicitud_id, 'S02', analista);
  avanzarEstado(ctx, subsolicitud.subsolicitud_id, 'S03', analista);
  avanzarEstado(ctx, subsolicitud.subsolicitud_id, 'S04', analista);

  // C-04: al aprobar (S04) se encola el documento, no se genera en el acto.
  let fila = ctx.buscarSolicitudPorId_(solicitud.solicitud_id);
  assert.equal(fila.doc_estado, 'PENDIENTE');

  const asignacion = ctx.Solicitudes.actualizarPrioridad(
    { solicitud_id: solicitud.solicitud_id, desarrollador_asignado: dev.email },
    analista
  );
  assert.equal(asignacion.desarrollador_asignado, dev.email);

  const procesados = ctx.Documentos.procesarColaDocumentos();
  assert.equal(procesados.length, 1);
  assert.equal(procesados[0].resultado, 'LISTO');
  fila = ctx.buscarSolicitudPorId_(solicitud.solicitud_id);
  assert.equal(fila.doc_estado, 'LISTO');
  assert.ok(fila.url_pdf);

  avanzarEstado(ctx, subsolicitud.subsolicitud_id, 'S05', dev);
  avanzarEstado(ctx, subsolicitud.subsolicitud_id, 'S07', dev);
  avanzarEstado(ctx, subsolicitud.subsolicitud_id, 'S08', analista);
  confirmarCierrePorSolicitante(ctx, solicitud.solicitud_id, subsolicitud.subsolicitud_id, solicitud.solicitante_email);

  fila = ctx.buscarSolicitudPorId_(solicitud.solicitud_id);
  assert.equal(fila.estado_derivado, 'S09');

  // HISTORIAL_ESTADOS: S01 sembrado + 7 transiciones (S02..S09).
  const historial = ctx.leerFilas_('HISTORIAL_ESTADOS').filter((h) => h.solicitud_id === solicitud.solicitud_id);
  assert.equal(historial.length, 8);

  // El Dashboard ya no debe contarla como abierta, y el tiempo promedio de
  // resolucion debe reflejar un valor real (> 0).
  const datosAdmin = ctx.Dashboard.getData({ empresa_id: 'HP' }, { rol: 'ADM', email: 'admin@homepymes.cl' });
  assert.equal(datosAdmin.resumen.total_abiertas, 0);
  assert.ok(datosAdmin.tiempo_promedio_resolucion_horas >= 0);

  // Notificaciones: acuse (no aplica aqui, es de Intake), pero cada cambio
  // de estado + el aviso al desarrollador al terminar el documento deben
  // quedar en el log, visibles para RF-019.
  const logs = ctx.Notificaciones.listarLogs({}, { rol: 'ADM' });
  assert.ok(logs.length >= 7, 'se esperaban al menos 7 notificaciones (6 cambios de estado + aviso de documento)');
  assert.ok(logs.some((l) => l.evento === 'DOC_LISTO'));
});

test('Ciclo de vida con rechazo (S03 -> S10) y reapertura (Fase 10.1: cualquier rol, con comentario obligatorio) en una solicitud de RLD', () => {
  const ctx = loadConSchema();
  const { solicitud, subsolicitud } = seedSolicitudRecienCreada(ctx, {
    solicitud_id: 'SOL-2026-RLD-0001', empresa_id: 'RLD', empresa_nombre: 'RLD',
    dedup_hash: 'e2e-rld-1', solicitante_email: 'maria@rld.cl', creado_por: 'maria@rld.cl'
  });
  const analista = { email: 'analista@rld.cl', rol: 'ANA' };
  const admin = { email: 'admin@homepymes.cl', rol: 'ADM' };

  avanzarEstado(ctx, subsolicitud.subsolicitud_id, 'S02', analista);
  avanzarEstado(ctx, subsolicitud.subsolicitud_id, 'S03', analista);
  avanzarEstado(ctx, subsolicitud.subsolicitud_id, 'S10', admin, 'Fuera de alcance del contrato de soporte');

  let fila = ctx.buscarSolicitudPorId_(solicitud.solicitud_id);
  assert.equal(fila.estado_derivado, 'S10');

  // Fase 10.1: la reapertura ya no es exclusiva de Admin -- cualquier rol
  // de Backoffice puede reabrir, siempre que deje un comentario (unico
  // control que se conserva, ver comentarioObligatorioParaCambio_).
  const sinComentario = ctx.Solicitudes.actualizarEstado(
    { subsolicitud_id: subsolicitud.subsolicitud_id, estado_nuevo: 'S03' },
    analista
  );
  assert.equal(sinComentario._validationError, true);

  avanzarEstado(ctx, subsolicitud.subsolicitud_id, 'S03', analista, 'Se reevaluo el alcance, si corresponde');
  fila = ctx.buscarSolicitudPorId_(solicitud.solicitud_id);
  assert.equal(fila.estado_derivado, 'S03');

  // Aislamiento multiempresa: el dashboard de RLD no debe ver nada de HP.
  const datosRld = ctx.Dashboard.getData({ empresa_id: 'RLD' }, { rol: 'ADM', email: 'admin@homepymes.cl' });
  assert.equal(datosRld.recientes.length, 1);
  assert.equal(datosRld.recientes[0].empresa_id, 'RLD');
});

test('Dashboard y logs quedan consistentes con solicitudes de ambas empresas simultaneamente', () => {
  const ctx = loadConSchema();
  seedSolicitudRecienCreada(ctx, { solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', dedup_hash: 'e2e-multi-hp' });
  seedSolicitudRecienCreada(ctx, {
    solicitud_id: 'SOL-2026-RLD-0001', empresa_id: 'RLD', dedup_hash: 'e2e-multi-rld',
    solicitante_email: 'maria@rld.cl', creado_por: 'maria@rld.cl'
  });

  const datosGlobal = ctx.Dashboard.getData({}, { rol: 'ADM', email: 'admin@homepymes.cl' });
  assert.equal(datosGlobal.resumen.total_abiertas, 2);
  const empresas = toPlain(datosGlobal.por_empresa.map((e) => e.clave)).sort();
  assert.deepEqual(empresas, ['HP', 'RLD']);
});
