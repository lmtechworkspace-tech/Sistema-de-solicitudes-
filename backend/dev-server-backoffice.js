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
  // v7.1: notificaciones "en vivo" demo -- una para el shell Google
  // (admin@homepymes.cl) y otra para el shell del portal (leo@rld.cl), asi
  // se puede ver el modal/toast al cargar app.html/plataforma.html en local.
  seedSheet(ctx, 'NOTIFICACIONES_APP', ctx.COLUMNAS.NOTIFICACIONES_APP, [
    ['NOTIF-DEMO-1', USUARIO_POR_DEFECTO, 'PRUEBA', 'Notificación de prueba',
      'Esto es una notificación en vivo de ejemplo (v7.1).', 'mi_trabajo', 'Ver Mi trabajo',
      'FALSE', new Date().toISOString(), new Date(Date.now() + 6 * 3600 * 1000).toISOString()],
    ['NOTIF-DEMO-2', 'leo@rld.cl', 'PAUSA_RECORDATORIO', 'Pausa activa de hoy',
      'Tu pausa activa es a las 09:30.', 'pausas', 'Ver pausas activas',
      'FALSE', new Date().toISOString(), new Date(Date.now() + 6 * 3600 * 1000).toISOString()]
  ]);
  // v3.3: cuentas de la plataforma, para probar el CRUD en admin.html.
  // P3: la MISMA cuenta/sesion fija que siembra backend/dev-server.js
  // (en produccion ambos proyectos leen la misma planilla; en local son
  // hojas separadas, asi que el token se fija por convencion).
  seedSheet(ctx, 'CUENTAS_PORTAL', ctx.COLUMNAS.CUENTAS_PORTAL, [
    ['CTA-DEMO-3', 'leo', 'Leo Estay', 'Desarrollador', 'hash-no-usado-aqui', 'sal',
      JSON.stringify(['leo@rld.cl']),
      'DEV', JSON.stringify(['nueva_solicitud', 'mis_solicitudes', 'bandeja', 'mi_trabajo']),
      'RLD', true, false, '', 'dev-server'],
    // P4: cuenta ADM con todos los modulos, para probar Administracion.
    ['CTA-DEMO-4', 'ladmin', 'Luis Admin', 'Administrador', 'hash-no-usado-aqui', 'sal',
      JSON.stringify(['luis@rld.cl']),
      'ADM', JSON.stringify(['nueva_solicitud', 'mis_solicitudes', 'bandeja', 'gerencia', 'administracion', 'pausas', 'pausas_coordinacion', 'mi_trabajo']),
      'RLD', true, false, '', 'dev-server'],
    // Cuenta GERENCIA SIN modulo bandeja -- prueba que el detalle de solo
    // lectura se vea desde el Panel de Gerencia sin ese modulo (ver Code.gs,
    // MODULO_POR_ACCION.getSolicitudDetalle acepta 'bandeja' O 'gerencia').
    ['CTA-DEMO-5', 'fgerente', 'Felipe Gerente', 'Gerente General', 'hash-no-usado-aqui', 'sal',
      JSON.stringify(['gerencia@rld.cl']),
      'GERENCIA', JSON.stringify(['nueva_solicitud', 'mis_solicitudes', 'gerencia']),
      'RLD', true, false, '', 'dev-server'],
    // v4.2: cuenta JEFATURA, para probar "Mi Departamento" en local -- su
    // equipo se siembra en JEFATURAS mas abajo (demo1@hp.cl).
    ['CTA-DEMO-6', 'ljefe', 'Lisseth Jefa', 'Jefa de Area', 'hash-no-usado-aqui', 'sal',
      JSON.stringify(['jefe@homepymes.cl']),
      'JEFATURA', JSON.stringify(['nueva_solicitud', 'mis_solicitudes', 'jefatura']),
      'HP', true, false, '', 'dev-server']
  ]);
  seedSheet(ctx, 'SESIONES_PORTAL', ctx.COLUMNAS.SESIONES_PORTAL, [
    ['dev-token-leo', 'CTA-DEMO-3', new Date(Date.now() + 12 * 3600 * 1000).toISOString(), new Date().toISOString()],
    ['dev-token-admin', 'CTA-DEMO-4', new Date(Date.now() + 12 * 3600 * 1000).toISOString(), new Date().toISOString()],
    ['dev-token-gerencia', 'CTA-DEMO-5', new Date(Date.now() + 12 * 3600 * 1000).toISOString(), new Date().toISOString()],
    ['dev-token-jefatura', 'CTA-DEMO-6', new Date(Date.now() + 12 * 3600 * 1000).toISOString(), new Date().toISOString()]
  ]);
  // v4.2: relacion jefe->subordinado -- demo1@hp.cl es quien reporta
  // SOL-2026-HP-0001 (sembrarSolicitudesDemo_ mas abajo), asi "Mi
  // Departamento" tiene algo real que mostrar.
  seedSheet(ctx, 'JEFATURAS', ctx.COLUMNAS.JEFATURAS, [
    ['JEF-DEMO-1', 'jefe@homepymes.cl', 'demo1@hp.cl', true],
    // v7.0 (Fase 3): leo@rld.cl tambien reporta a jefe@homepymes.cl, para
    // que "Actividades del equipo" tenga las 2 actividades demo de ACT-DEMO-*
    // que ver en local (ver mas abajo).
    ['JEF-DEMO-2', 'jefe@homepymes.cl', 'leo@rld.cl', true]
  ]);
  // v6.0: modulo de Pausas Activas (Fase P0) -- hojas vacias para probar el
  // CRUD de configuracion en local (crear escribe con agregarFila_, que exige
  // que la hoja exista).
  // Config demo con todos los dias (1..7) para que "Programar hoy" cree la
  // pausa sin importar en que dia se pruebe en local.
  seedSheet(ctx, 'PAUSAS_CONFIG', ctx.COLUMNAS.PAUSAS_CONFIG, [
    ['HP', '09:30', '1,2,3,4,5,6,7', 10, 15, 80, 60, true]
  ]);
  seedSheet(ctx, 'PAUSAS_COORDINADORES', ctx.COLUMNAS.PAUSAS_COORDINADORES);
  seedSheet(ctx, 'PAUSAS_TRABAJADORES', ctx.COLUMNAS.PAUSAS_TRABAJADORES, [
    ['TRB-1', 'HP', 'Juan Pérez', 'juan@hp.cl', 'Bodega', 'Operario', true, '2026-01-01'],
    ['TRB-2', 'HP', 'Ana Díaz', 'ana@hp.cl', 'Ventas', 'Vendedora', true, '2026-01-01']
  ]);
  // Pausa demo de HOY para probar el registro del trabajador (P2) en local.
  // Se calcula en la zona del proyecto (igual que claveDia_ en el backend),
  // no en UTC, para que coincida con "hoy" segun America/Santiago.
  var hoyPausa = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  seedSheet(ctx, 'PAUSAS_PROGRAMADAS', ctx.COLUMNAS.PAUSAS_PROGRAMADAS, [
    ['PA-DEMO-1', 'HP', hoyPausa, '09:30', '', '', '', 'Programada', 10, '']
  ]);
  seedSheet(ctx, 'PAUSAS_ASISTENCIA', ctx.COLUMNAS.PAUSAS_ASISTENCIA);
  seedSheet(ctx, 'PAUSAS_LOG', ctx.COLUMNAS.PAUSAS_LOG);
  // v6.4: foto de perfil. Se siembra VACIA a proposito, para poder probar el
  // camino "usuario sin foto -> avatar de iniciales" que es el estado
  // inicial de todo el mundo.
  seedSheet(ctx, 'PERFILES', ctx.COLUMNAS.PERFILES);
  seedSheet(ctx, 'COMENTARIOS', ctx.COLUMNAS.COMENTARIOS);
  seedSheet(ctx, 'NOVEDADES', ctx.COLUMNAS.NOVEDADES);
  seedSheet(ctx, 'NOVEDADES_LECTURAS', ctx.COLUMNAS.NOVEDADES_LECTURAS);
  seedSheet(ctx, 'NOVEDADES_HISTORIAL', ctx.COLUMNAS.NOVEDADES_HISTORIAL);
  seedSheet(ctx, 'NOVEDADES_AUDIENCIA', ctx.COLUMNAS.NOVEDADES_AUDIENCIA);
  // v7.0 (Fase 2): "Mi trabajo". Una actividad ya en curso y otra pendiente
  // de confirmar (asignada por ladmin) para ver ambos flujos en local.
  seedSheet(ctx, 'ACTIVIDADES', ctx.COLUMNAS.ACTIVIDADES, [
    ['ACT-DEMO-1', 'Editar 3 videos de testimonios — campaña agosto', '',
      'PROPIA', '', 'leo@rld.cl', 'Leo Estay', 'jefe@homepymes.cl',
      'AREA_PLAT', '', '', 'P2', 'EN_CURSO', 'L',
      '', new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(), new Date().toISOString(), false,
      'NINGUNA', '', '', '',
      'VERDE', '', '', '', '',
      new Date().toISOString(), 0,
      new Date().toISOString(), 'leo@rld.cl', true],
    ['ACT-DEMO-2', 'Cierre contable de julio', '',
      'ASIGNADA', '', 'leo@rld.cl', 'Leo Estay', 'jefe@homepymes.cl',
      'AREA_CONTA', '', '', 'P3', 'NO_INICIADA', 'M',
      new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(), '', '', false,
      'MENSUAL', '', '', '',
      'VERDE', '', '', '', '',
      new Date().toISOString(), 0,
      new Date().toISOString(), 'jefe@homepymes.cl', true],
    // v7.0 (Fase 5): un par extra para ver el panel de Gerencia con datos
    // reales -- una P1 vencida (criticas + heatmap en rojo) y una bloqueada
    // hace dias (KPI "Bloqueadas ahora" + fila de bloqueo estancado).
    ['ACT-DEMO-3', 'Migrar reporte de ventas al nuevo ERP', '',
      'ASIGNADA', '', 'leo@rld.cl', 'Leo Estay', 'jefe@homepymes.cl',
      'AREA_PLAT', '', '', 'P1', 'EN_CURSO', 'L',
      '', new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(), new Date(Date.now() - 6 * 24 * 3600 * 1000).toISOString(), false,
      'NINGUNA', '', '', '',
      'ROJA', '', '', '', '',
      new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString(), 0,
      new Date(Date.now() - 6 * 24 * 3600 * 1000).toISOString(), 'jefe@homepymes.cl', true],
    ['ACT-DEMO-4', 'Conciliar cuentas por cobrar de clientes RLD', '',
      'PROPIA', '', 'leo@rld.cl', 'Leo Estay', 'jefe@homepymes.cl',
      'AREA_CONTA', '', '', 'P2', 'BLOQUEADA', 'M',
      '', new Date(Date.now() + 4 * 24 * 3600 * 1000).toISOString(), new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(), false,
      'NINGUNA', '', '', '',
      'AMARILLA', '', 'Esperando acceso al nuevo portal bancario', 'jefe@homepymes.cl', new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
      new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(), 0,
      new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(), 'leo@rld.cl', true]
  ]);
  seedSheet(ctx, 'ACTIVIDADES_BITACORA', ctx.COLUMNAS.ACTIVIDADES_BITACORA);
  // v6.1 (Fase 4): DOCUMENTOS demo (las capturas ya las siembra
  // sembrarSolicitudesDemo_ mas abajo). Hacen falta para ver la lista de
  // archivos con metadata -- formato, peso y fecha --, que es justo lo que un
  // PDF/Excel necesita y una miniatura no puede mostrar.
  seedSheet(ctx, 'ARCHIVOS', ctx.COLUMNAS.ARCHIVOS, [
    ['ARC-DEMO-1', 'SOL-2026-HP-0001', 'SOL-2026-HP-0001-01',
      'FORMATO REGISTRO CAPACITACION ACTUAL.pdf', 'https://drive.google.com/file/d/demo1/view',
      'application/pdf', 2516582, new Date().toISOString()],
    // Adjunto a nivel de SOLICITUD (sin subsolicitud_id): sale en la ficha
    // izquierda, no dentro del item.
    ['ARC-DEMO-2', 'SOL-2026-HP-0001', '',
      'Planilla horas estimadas.xlsx', 'https://drive.google.com/file/d/demo2/view',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 45120,
      new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()]
  ]);
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
    ['U4', 'Gerente Demo', 'gerente@homepymes.cl', 'HP', 'GERENCIA', true, '', 'sistema'],
    // v4.2: para probar "Mi Departamento" con login Google (?actuar_como=jefe@homepymes.cl).
    ['U5', 'Jefe Demo', 'jefe@homepymes.cl', 'HP', 'JEFATURA', true, '', 'sistema']
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
    { id: 'SOL-2026-RLD-0003', empresa: 'RLD', plataforma: 'RLD_GDE', modulo: 'MOD_LIQ', tipo: 'ERR', prioridad: 'P1', estado: 'S09', dias: 2, atencionDirecta: true },
    // v6.1: una solicitud EN RIESGO (>= 80% del SLA consumido y sin vencer)
    // para poder ver el KPI, el grupo ambar y el chip sin tener que esperar a
    // que una demo envejezca. El sla se elige chico a proposito para que el
    // ratio caiga en la ventana de riesgo con pocas horas habiles corridas.
    { id: 'SOL-2026-HP-0003', empresa: 'HP', plataforma: 'INT_GDE', modulo: 'MOD_DASH', tipo: 'ERR', prioridad: 'P2', estado: 'S05', dias: 3, sla: 11, dev: 'leo@rld.cl' }
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
      sla_objetivo_horas: item.sla || 24, estimacion_horas: 8, horas_reales: '', fecha_creacion: fecha,
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
