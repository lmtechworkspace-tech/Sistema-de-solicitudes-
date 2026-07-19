'use strict';

/**
 * dev-server-backoffice.js — servidor HTTP local SOLO para desarrollo del
 * Backoffice (app.html). No se despliega nunca (ver dev-server.js, su
 * contraparte de Intake, para el mismo criterio).
 *
 * En produccion Apps Script resuelve la identidad automaticamente
 * (Session.getActiveUser()) antes de que el codigo del Web App se ejecute
 * -- no hay pantalla de login propia (C-03). Para poder probar distintos
 * roles en local, este servidor lee el usuario a simular desde el query
 * string de la URL (?actuar_como=email), nunca de un header o del body:
 * asi el contrato de transporte real (§4.1, sin headers custom) queda
 * intacto y no hay que tocar el frontend de produccion para probarlo.
 *
 * Uso: node backend/dev-server-backoffice.js  (puerto 8788 por defecto)
 * Luego, para probar como Analista: apuntar BACKOFFICE_URL a
 * http://localhost:8788?actuar_como=analista@homepymes.cl
 */

const http = require('http');
const { loadBackofficeProject, seedSheet } = require('./test/helpers/gasSandbox');

const PUERTO = process.env.PORT || 8788;
const USUARIO_POR_DEFECTO = 'admin@homepymes.cl';

function construirContexto() {
  const ctx = loadBackofficeProject({
    scriptProperties: {
      SIGSO_SHEET_ID: 'dev-sheet',
      SIGSO_TIMEZONE: 'America/Santiago',
      SIGSO_DRIVE_ROOT_FOLDER_ID: 'dev-drive-root'
    },
    activeUserEmail: USUARIO_POR_DEFECTO
  });

  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'SUBSOLICITUDES', ctx.COLUMNAS.SUBSOLICITUDES);
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS);
  seedSheet(ctx, 'HISTORIAL_PRIORIDAD', ctx.COLUMNAS.HISTORIAL_PRIORIDAD);
  seedSheet(ctx, 'HISTORIAL_COMPROMISO', ctx.COLUMNAS.HISTORIAL_COMPROMISO);
  seedSheet(ctx, 'HISTORIAL_ASIGNACION', ctx.COLUMNAS.HISTORIAL_ASIGNACION);
  // v3.3: cuentas de la plataforma, para probar el CRUD en admin.html.
  // P3: la MISMA cuenta/sesion fija que siembra backend/dev-server.js
  // (en produccion ambos proyectos leen la misma planilla; en local son
  // hojas separadas, asi que el token se fija por convencion).
  seedSheet(ctx, 'CUENTAS_PORTAL', ctx.COLUMNAS.CUENTAS_PORTAL, [
    ['CTA-DEMO-3', 'leo', 'Leo Estay', 'Desarrollador', 'hash-no-usado-aqui', 'sal',
      JSON.stringify(['leo@rld.cl']),
      'DEV', JSON.stringify(['nueva_solicitud', 'mis_solicitudes', 'bandeja']),
      'RLD', true, false, '', 'dev-server']
  ]);
  seedSheet(ctx, 'SESIONES_PORTAL', ctx.COLUMNAS.SESIONES_PORTAL, [
    ['dev-token-leo', 'CTA-DEMO-3', new Date(Date.now() + 12 * 3600 * 1000).toISOString(), new Date().toISOString()]
  ]);
  seedSheet(ctx, 'COMENTARIOS', ctx.COLUMNAS.COMENTARIOS);
  seedSheet(ctx, 'ARCHIVOS', ctx.COLUMNAS.ARCHIVOS);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'LOG_SISTEMA', ctx.COLUMNAS.LOG_SISTEMA);
  seedSheet(ctx, 'CONFIG_NOTIFICACIONES', ctx.COLUMNAS.CONFIG_NOTIFICACIONES, [
    ['AVISO_LEO', 'AVISO_DESARROLLO', '', '', true]
  ]);
  seedSheet(ctx, 'CONFIG_FERIADOS', ctx.COLUMNAS.CONFIG_FERIADOS);
  seedSheet(ctx, 'CONFIG_SLA', ctx.COLUMNAS.CONFIG_SLA, [
    ['P1', 2], ['P2', 24], ['P3', 72], ['P4', 120], ['P5', '']
  ]);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Analista Demo', 'analista@homepymes.cl', 'HP', 'ANA', true, '', 'sistema'],
    ['U2', 'Dev Demo', 'dev@homepymes.cl', 'HP', 'DEV', true, '', 'sistema'],
    ['U3', 'Admin Demo', 'admin@homepymes.cl', 'HP', 'ADM', true, '', 'sistema'],
    // P6 (v2.0, Sprint 2): rol de solo lectura, para probar el panel en local.
    ['U4', 'Gerente Demo', 'gerente@homepymes.cl', 'HP', 'GERENCIA', true, '', 'sistema']
  ]);
  seedSheet(ctx, 'CAT_EMPRESAS', ctx.COLUMNAS.CAT_EMPRESAS, [
    ['HP', 'HomePymes', '', true],
    ['RLD', 'RLD', '', true]
  ]);
  seedSheet(ctx, 'CAT_PLATAFORMAS', ctx.COLUMNAS.CAT_PLATAFORMAS, [
    ['INT_GDE', 'Intranet GDE', 'HP', '', true],
    ['RLD_GDE', 'GDE', 'RLD', '', true]
  ]);
  seedSheet(ctx, 'CAT_MODULOS', ctx.COLUMNAS.CAT_MODULOS, [
    ['MOD_CHARLA', 'Charla Diaria', 'INT_GDE', '', true],
    ['MOD_LIQ', 'Liquidaciones', 'RLD_GDE', '', true]
  ]);
  seedSheet(ctx, 'CAT_TIPOS', ctx.COLUMNAS.CAT_TIPOS, [
    ['ERR', 'Error / Bug', 'P2', true, true],
    ['MOD', 'Modificacion', 'P3', true, false],
    ['MEJ', 'Mejora', 'P3', true, false],
    ['DES', 'Desarrollo', 'P4', true, false],
    ['NMO', 'Nuevo Modulo', 'P5', true, false],
    ['MIG', 'Migracion', 'P2', true, true],
    ['CON', 'Consulta Tecnica', 'P4', true, false]
  ]);
  // v3.0 (Fase 1): areas -> responsable, para el CRUD en Administracion.
  seedSheet(ctx, 'CAT_AREAS', ctx.COLUMNAS.CAT_AREAS, [
    ['AREA_PLAT', 'Plataformas / sistemas', 'leo@rld.cl', true],
    ['AREA_CONTA', 'Contabilidad', 'luis@rld.cl', true]
  ]);

  sembrarSolicitudesDemo_(ctx);
  return ctx;
}

function sembrarSolicitudesDemo_(ctx) {
  const ahora = new Date();
  const demo = [
    { id: 'SOL-2026-HP-0001', empresa: 'HP', plataforma: 'INT_GDE', modulo: 'MOD_CHARLA', tipo: 'ERR', prioridad: 'P1', estado: 'S02', dias: 0 },
    { id: 'SOL-2026-HP-0002', empresa: 'HP', plataforma: 'INT_GDE', modulo: 'MOD_DASH', tipo: 'MEJ', prioridad: 'P3', estado: 'S05', dias: 3, dev: 'leo@rld.cl' },
    { id: 'SOL-2026-RLD-0001', empresa: 'RLD', plataforma: 'RLD_GDE', modulo: 'MOD_LIQ', tipo: 'MOD', prioridad: 'P2', estado: 'S07', dias: 6, dev: 'leo@rld.cl' },
    { id: 'SOL-2026-RLD-0002', empresa: 'RLD', plataforma: 'RLD_GDE', modulo: 'MOD_VAC', tipo: 'CON', prioridad: 'P4', estado: 'S09', dias: 15 },
    // v3.1: una atencion directa, para poder ver la insignia del detalle y
    // el KPI de Gerencia sin tener que crear una a mano cada vez.
    { id: 'SOL-2026-RLD-0003', empresa: 'RLD', plataforma: 'RLD_GDE', modulo: 'MOD_LIQ', tipo: 'ERR', prioridad: 'P1', estado: 'S09', dias: 2, atencionDirecta: true }
  ];

  demo.forEach((item, idx) => {
    const fecha = new Date(ahora.getTime() - item.dias * 24 * 60 * 60 * 1000).toISOString();
    const solicitud = {
      solicitud_id: item.id, empresa_id: item.empresa, plataforma: item.plataforma, modulo: item.modulo,
      tipo: item.tipo, solicitante_nombre: 'Solicitante Demo ' + (idx + 1), solicitante_cargo: 'Jefe de Area',
      solicitante_email: 'demo' + (idx + 1) + '@' + item.empresa.toLowerCase() + '.cl',
      es_cliente: false, empresa_cliente: '', cliente_mandante: '', cliente_obra: '',
      contacto_cliente: '', correo_cliente: '', telefono_cliente: '', urgencia_cliente: '',
      estado_derivado: item.estado, prioridad_derivada: item.prioridad, orden_atencion: '',
      doc_estado: '', doc_reintentos: 0, url_doc: '', url_pdf: '', version_documento: 0, url_pdf_historial: '',
      dedup_hash: 'demo-' + idx, estimacion_total_horas: 8, horas_reales: '', observaciones_generales: '',
      resumen_whatsapp: '', fecha_creacion: fecha, creado_por: 'demo' + (idx + 1) + '@' + item.empresa.toLowerCase() + '.cl',
      cc: idx === 0 ? 'copia@homepymes.cl' : '',
      atencion_directa: !!item.atencionDirecta,
      desarrollador_asignado: item.dev || ''
    };
    ctx.SpreadsheetApp.openById('dev-sheet').getSheetByName('SOLICITUDES')
      .appendRow(ctx.COLUMNAS.SOLICITUDES.map((col) => solicitud[col]));

    // Fase 9: el primer item demo lleva los campos reales (URLs multiples,
    // credencial, CC) para poder ver el panel de detalle rediseñado
    // (detalle.js) tal como lo veria Leo, sin tener que crear una solicitud
    // real a mano cada vez.
    const esDemoRico = idx === 0;
    const subsolicitud = {
      subsolicitud_id: item.id + '-01', solicitud_id: item.id, numero_item: 1,
      titulo: 'Item de ejemplo ' + (idx + 1), descripcion: 'Descripcion de ejemplo para ' + item.id,
      contexto: '', resultado_esperado: '', impacto: '', prioridad: item.prioridad, estado: item.estado,
      url_modulo: esDemoRico ? 'https://integral.rld.cl/pages/ejemplo.php' : '',
      usuario_prueba: esDemoRico ? 'z4nunoa' : '',
      ref_credencial: esDemoRico ? 'Ver gestor de credenciales del equipo, entrada "z4nunoa"' : '',
      centro_costos: esDemoRico ? 'CC-01' : '', url_video: '', observaciones: '',
      sla_objetivo_horas: 24, estimacion_horas: 8, horas_reales: '', fecha_creacion: fecha,
      urls_adicionales: esDemoRico ? JSON.stringify([
        { titulo: 'Modal de validacion', url: 'https://integral.rld.cl/modal_validacion.php?id=1' },
        { titulo: 'Documento generado', url: 'https://integral.rld.cl/doc_generado.php?id=1' }
      ]) : '',
      atencion_resuelto_por: item.atencionDirecta ? 'Leo' : '',
      atencion_fecha_resolucion: item.atencionDirecta ? fecha : '',
      atencion_detalle: item.atencionDirecta ? 'Se reinicio el servicio de liquidaciones y se limpio la cola atascada' : '',
      desarrollador_asignado: item.dev || ''
    };
    ctx.SpreadsheetApp.openById('dev-sheet').getSheetByName('SUBSOLICITUDES')
      .appendRow(ctx.COLUMNAS.SUBSOLICITUDES.map((col) => subsolicitud[col]));

    ctx.SpreadsheetApp.openById('dev-sheet').getSheetByName('HISTORIAL_ESTADOS').appendRow([
      'hist-' + idx, item.id, item.id + '-01', '', 'S01', 'sistema', 'Solicitud creada', fecha
    ]);

    if (esDemoRico) {
      ctx.SpreadsheetApp.openById('dev-sheet').getSheetByName('ARCHIVOS').appendRow([
        'archivo-demo-1', item.id, '', 'captura_general.png', 'https://drive.google.com/demo-general', 'image/png', 12345, fecha
      ]);
      ctx.SpreadsheetApp.openById('dev-sheet').getSheetByName('ARCHIVOS').appendRow([
        'archivo-demo-2', item.id, item.id + '-01', 'captura_item.png', 'https://drive.google.com/demo-item', 'image/png', 12345, fecha
      ]);
    }
  });
}

function fijarUsuarioActivo_(ctx, email) {
  ctx.Session = { getActiveUser: () => ({ getEmail: () => email }) };
}

const ctx = construirContexto();

const servidor = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not_found' }));
    return;
  }

  const consulta = new URL(req.url, 'http://localhost').searchParams;
  const actuarComo = consulta.get('actuar_como') || USUARIO_POR_DEFECTO;
  fijarUsuarioActivo_(ctx, actuarComo);

  let cuerpo = '';
  req.on('data', (chunk) => { cuerpo += chunk; });
  req.on('end', () => {
    const evento = { postData: { contents: cuerpo, type: 'text/plain' } };
    let salida;
    try {
      salida = ctx.doPost(evento);
    } catch (err) {
      console.error('[dev-server-backoffice] error inesperado:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'internal' }));
      return;
    }
    console.log('[dev-server-backoffice]', new Date().toISOString(), actuarComo, JSON.parse(cuerpo || '{}').action);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(salida.getContent());
  });
});

servidor.listen(PUERTO, () => {
  console.log('SIGSO dev-server (Backoffice) escuchando en http://localhost:' + PUERTO);
  console.log('Usuarios demo: analista@homepymes.cl (ANA), dev@homepymes.cl (DEV), admin@homepymes.cl (ADM)');
  console.log('Solo para desarrollo local. No se despliega.');
});
