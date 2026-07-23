'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'SUBSOLICITUDES', ctx.COLUMNAS.SUBSOLICITUDES);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'CONFIG_FERIADOS', ctx.COLUMNAS.CONFIG_FERIADOS);
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS);
  seedSheet(ctx, 'COMENTARIOS', ctx.COLUMNAS.COMENTARIOS);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Analista Uno', 'analista@homepymes.cl', 'HP', 'ANA', true, '', 'sistema'],
    ['U2', 'Admin Uno', 'admin@homepymes.cl', 'HP', 'ADM', true, '', 'sistema'],
    ['U3', 'Dev Uno', 'dev@homepymes.cl', 'HP', 'DEV', true, '', 'sistema']
  ]);
  return ctx;
}

function seedSolicitud(ctx, overrides) {
  const base = Object.assign(
    {
      solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', plataforma: 'ERP', modulo: 'Facturacion',
      tipo: 'ERR', solicitante_nombre: 'Juan', solicitante_cargo: 'Analista', solicitante_email: 'juan@homepymes.cl',
      es_cliente: false, empresa_cliente: '', cliente_mandante: '', cliente_obra: '',
      contacto_cliente: '', correo_cliente: '', telefono_cliente: '', urgencia_cliente: '',
      estado_derivado: 'S03', prioridad_derivada: 'P2', orden_atencion: '',
      doc_estado: '', doc_reintentos: 0, url_doc: '', url_pdf: '', version_documento: 0, url_pdf_historial: '',
      dedup_hash: 'x', estimacion_total_horas: 4, horas_reales: '', observaciones_generales: '',
      resumen_whatsapp: '', fecha_creacion: new Date().toISOString(), creado_por: 'juan@homepymes.cl'
    },
    overrides
  );
  const fila = ctx.COLUMNAS.SOLICITUDES.map((col) => base[col]);
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SOLICITUDES').appendRow(fila);
  return base;
}

function seedSubsolicitud(ctx, overrides) {
  const base = Object.assign(
    {
      subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001', numero_item: 1,
      titulo: 't', descripcion: 'd', contexto: '', resultado_esperado: '', impacto: '',
      prioridad: 'P2', estado: 'S03', url_modulo: '', usuario_prueba: '', ref_credencial: '',
      centro_costos: '', url_video: '', observaciones: '', sla_objetivo_horas: 24,
      estimacion_horas: '', horas_reales: '', fecha_creacion: new Date().toISOString()
    },
    overrides
  );
  const fila = ctx.COLUMNAS.SUBSOLICITUDES.map((col) => base[col]);
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SUBSOLICITUDES').appendRow(fila);
  return base;
}

// 10 dias calendario garantiza superar cualquier umbral de horas habiles
// (24h = SLA de P2) sin importar en que dia de la semana caiga "ahora".
const HACE_10_DIAS = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

test('Triggers.verificarSLAs (A-07) dispara alertaSLAVencido cuando el SLA ya se supero (A-09)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { fecha_creacion: HACE_10_DIAS, sla_objetivo_horas: 24 });

  ctx.Triggers.verificarSLAs();

  const log = ctx.leerFilas_('LOG_NOTIFICACIONES');
  const eventos = log.map((l) => l.evento);
  assert.ok(eventos.some((e) => e.indexOf('SLA_VENCIDO:SOL-2026-HP-0001-01') === 0));
  // ANA + ADM de la empresa (RF: "email a analista y admin"), no al DEV.
  const destinatarios = log.filter((l) => l.evento.indexOf('SLA_VENCIDO') === 0).map((l) => l.destinatario).sort();
  assert.deepEqual(destinatarios, ['admin@homepymes.cl', 'analista@homepymes.cl']);
});

test('Triggers.verificarSLAs (A-07) dispara alertaSLAProximo cuando el SLA esta al 80-99% (A-08)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);

  // Se deriva sla_objetivo_horas a partir de las horas habiles ya
  // transcurridas (calculadas con la misma funcion real), en vez de un
  // valor fijo: asi el ratio objetivo (~90%) es independiente del dia de
  // la semana en que corra la prueba.
  const inicio = new Date(Date.now() - 96 * 60 * 60 * 1000).toISOString();
  const transcurridas = ctx.Utils.horasHabilesEntre(inicio, new Date(), { feriados: [] });
  const objetivo = transcurridas / 0.9;
  seedSubsolicitud(ctx, { fecha_creacion: inicio, sla_objetivo_horas: objetivo });

  ctx.Triggers.verificarSLAs();

  const log = ctx.leerFilas_('LOG_NOTIFICACIONES');
  const vencido = log.some((l) => l.evento.indexOf('SLA_VENCIDO') === 0);
  const proximo = log.some((l) => l.evento.indexOf('SLA_PROXIMO') === 0);
  assert.equal(vencido, false);
  assert.equal(proximo, true);
});

test('Triggers.verificarSLAs no alerta subsolicitudes ya cerradas, rechazadas o sin SLA (P5)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-01', fecha_creacion: HACE_10_DIAS, estado: 'S09' });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-02', fecha_creacion: HACE_10_DIAS, estado: 'S10' });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-03', fecha_creacion: HACE_10_DIAS, sla_objetivo_horas: '' });

  ctx.Triggers.verificarSLAs();

  assert.equal(ctx.leerFilas_('LOG_NOTIFICACIONES').length, 0);
});

test('RN-027: alertaSLAVencido no reenvia el mismo dia (maximo 1 vez/dia por destinatario)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { fecha_creacion: HACE_10_DIAS });

  ctx.Triggers.verificarSLAs();
  ctx.Triggers.verificarSLAs();

  const enviados = ctx.leerFilas_('LOG_NOTIFICACIONES').filter((l) => l.resultado === 'ENVIADO' && l.evento.indexOf('SLA_VENCIDO') === 0);
  // 2 destinatarios (analista+admin), cada uno solo 1 vez pese a las 2 corridas.
  assert.equal(enviados.length, 2);
});

test('Auth.suspenderInactivos (A-11, RN-029) desactiva usuarios con mas de 90 dias sin acceso', () => {
  const ctx = loadConSchema();
  const hace100Dias = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
  const hace10Dias = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  ctx.actualizarFilaPorId_(ctx.SHEETS.USUARIOS, 'email', 'analista@homepymes.cl', { ultimo_acceso: hace100Dias });
  ctx.actualizarFilaPorId_(ctx.SHEETS.USUARIOS, 'email', 'dev@homepymes.cl', { ultimo_acceso: hace10Dias });
  // admin@homepymes.cl queda con ultimo_acceso vacio (nunca accedio).

  const suspendidos = toPlain(ctx.Auth.suspenderInactivos());

  assert.deepEqual(suspendidos, ['analista@homepymes.cl']);
  const usuarios = ctx.leerFilas_('USUARIOS');
  assert.equal(usuarios.find((u) => u.email === 'analista@homepymes.cl').activo, false);
  assert.equal(usuarios.find((u) => u.email === 'dev@homepymes.cl').activo, true);
  assert.equal(usuarios.find((u) => u.email === 'admin@homepymes.cl').activo, true);
});

test('doPost (Backoffice) actualiza USUARIOS.ultimo_acceso en cada request autenticado (soporte de RN-029)', () => {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' },
    activeUserEmail: 'admin@homepymes.cl'
  });
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Admin Uno', 'admin@homepymes.cl', 'HP', 'ADM', true, '', 'sistema']
  ]);

  ctx.doPost({ postData: { contents: JSON.stringify({ action: 'ping', data: {} }) } });

  const usuario = ctx.leerFilas_('USUARIOS')[0];
  assert.ok(usuario.ultimo_acceso);
  assert.ok(new Date(usuario.ultimo_acceso).getTime() <= Date.now());
});

test('Notificaciones.enviarResumenSemanal (§17.4) envia a Analista+Admin de cada empresa con datos de Dashboard', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001' });
  seedSubsolicitud(ctx);

  const resultados = ctx.Notificaciones.enviarResumenSemanal();

  assert.equal(resultados.length, 2);
  const destinatarios = resultados.map((r) => r).length; // sanity: se llamo por cada destinatario
  assert.ok(destinatarios > 0);
  const log = ctx.leerFilas_('LOG_NOTIFICACIONES').filter((l) => l.evento.indexOf('RESUMEN_SEMANAL') === 0);
  const roles = log.map((l) => l.destinatario).sort();
  assert.deepEqual(roles, ['admin@homepymes.cl', 'analista@homepymes.cl']);
});

test('Notificaciones.enviarReporteMensual (§17.4) envia tambien al Desarrollador', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001' });
  seedSubsolicitud(ctx);

  ctx.Notificaciones.enviarReporteMensual();

  const log = ctx.leerFilas_('LOG_NOTIFICACIONES').filter((l) => l.evento.indexOf('REPORTE_MENSUAL') === 0);
  const destinatarios = log.map((l) => l.destinatario).sort();
  assert.deepEqual(destinatarios, ['admin@homepymes.cl', 'analista@homepymes.cl', 'dev@homepymes.cl']);
});

test('Notificaciones.enviarReporteEjecutivoSemanal (v5.2 Fase B, §4.2) llega solo a GERENCIA+ADM, sin depender de un boton', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx);
  ctx.agregarFila_(ctx.SHEETS.USUARIOS, {
    usuario_id: 'U4', nombre: 'Gerente Uno', email: 'gerente@homepymes.cl', empresa_id: 'HP',
    rol: 'GERENCIA', activo: true, ultimo_acceso: '', creado_por: 'sistema'
  });

  const resultados = ctx.Notificaciones.enviarReporteEjecutivoSemanal();

  assert.equal(resultados.length, 2);
  const log = ctx.leerFilas_('LOG_NOTIFICACIONES').filter((l) => l.evento.indexOf('REPORTE_EJECUTIVO_SEMANAL') === 0);
  const destinatarios = log.map((l) => l.destinatario).sort();
  assert.deepEqual(destinatarios, ['admin@homepymes.cl', 'gerente@homepymes.cl']);
  // No va al Analista/Desarrollador -- eso lo sigue cubriendo el resumen
  // semanal/mensual de siempre (roles distintos, mismo trigger no aplica).
  assert.ok(!destinatarios.includes('analista@homepymes.cl'));
});

test('Notificaciones.enviarReporteEjecutivoSemanal (v5.2 Fase B) no reenvia el mismo dia (misma ventana de dedup que resumen semanal)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx);

  ctx.Notificaciones.enviarReporteEjecutivoSemanal();
  const segunda = ctx.Notificaciones.enviarReporteEjecutivoSemanal();

  const enviados = segunda.filter((r) => r.enviado);
  assert.equal(enviados.length, 0);
});

test('Notificaciones.enviarReporteEjecutivoAhora (v5.2 §4.2) exige rol ADM', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx);

  const resultado = ctx.Notificaciones.enviarReporteEjecutivoAhora({}, { rol: 'GERENCIA', email: 'gerente@homepymes.cl' });

  assert.equal(resultado._forbidden, true);
  assert.equal(ctx.leerFilas_('LOG_NOTIFICACIONES').length, 0);
});

test('Notificaciones.enviarReporteEjecutivoAhora (v5.2 §4.2) envia YA a Gerencia+Admin, sin esperar el trigger', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001' });
  seedSubsolicitud(ctx);
  ctx.agregarFila_(ctx.SHEETS.USUARIOS, {
    usuario_id: 'U4', nombre: 'Gerente Uno', email: 'gerente@homepymes.cl', empresa_id: 'HP',
    rol: 'GERENCIA', activo: true, ultimo_acceso: '', creado_por: 'sistema'
  });

  const resultado = ctx.Notificaciones.enviarReporteEjecutivoAhora({}, { rol: 'ADM', email: 'admin@homepymes.cl' });

  assert.equal(resultado.enviados, 2);
  const log = ctx.leerFilas_('LOG_NOTIFICACIONES').filter((l) => l.evento.indexOf('REPORTE_EJECUTIVO_MANUAL') === 0);
  const destinatarios = log.map((l) => l.destinatario).sort();
  assert.deepEqual(destinatarios, ['admin@homepymes.cl', 'gerente@homepymes.cl']);
});

test('Notificaciones.enviarReporteEjecutivoAhora (v5.2 §4.2) nunca se deduplica contra un envio previo del mismo dia', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx);

  ctx.Notificaciones.enviarReporteEjecutivoAhora({}, { rol: 'ADM', email: 'admin@homepymes.cl' });
  const segundo = ctx.Notificaciones.enviarReporteEjecutivoAhora({}, { rol: 'ADM', email: 'admin@homepymes.cl' });

  // 2 destinatarios (analista? no -- solo GERENCIA/ADM; aca solo admin@ existe)
  // por corrida: si se dedujera, el segundo envio saldria con enviado:false.
  assert.equal(segundo.enviados, segundo.total);
});

test('Notificaciones.listarLogs (RF-019) exige rol Admin y devuelve los mas recientes primero', () => {
  const ctx = loadConSchema();
  ctx.agregarFila_(ctx.SHEETS.LOG_NOTIFICACIONES, {
    log_id: '1', timestamp: '2026-01-01T00:00:00.000Z', solicitud_id: 'S1', canal: 'EMAIL',
    destinatario: 'a@x.cl', evento: 'E1', resultado: 'ENVIADO', reintentos: 0
  });
  ctx.agregarFila_(ctx.SHEETS.LOG_NOTIFICACIONES, {
    log_id: '2', timestamp: '2026-02-01T00:00:00.000Z', solicitud_id: 'S2', canal: 'EMAIL',
    destinatario: 'b@x.cl', evento: 'E2', resultado: 'ENVIADO', reintentos: 0
  });

  const comoAnalista = ctx.Notificaciones.listarLogs({}, { rol: 'ANA' });
  assert.equal(comoAnalista._forbidden, true);

  const comoAdmin = ctx.Notificaciones.listarLogs({}, { rol: 'ADM' });
  assert.equal(comoAdmin.length, 2);
  assert.equal(comoAdmin[0].log_id, '2');
});
