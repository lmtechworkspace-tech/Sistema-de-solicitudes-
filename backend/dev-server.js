'use strict';

/**
 * dev-server.js — servidor HTTP local SOLO para desarrollo del frontend.
 *
 * No se despliega nunca: en produccion el backend es Apps Script
 * (backend/intake, backend/backoffice). Este script carga el mismo
 * Code.gs real de Intake dentro del sandbox vm que usan los tests
 * (backend/test/helpers/gasSandbox.js), con una planilla en memoria
 * pre-cargada con catalogos de ejemplo, y lo expone por HTTP para que
 * frontend/js/config.js pueda apuntar aqui mientras se prueba en el
 * navegador (ver documentacion/fases/FASE-03-frontend-publico.md).
 *
 * Uso: node backend/dev-server.js  (puerto 8787 por defecto)
 */

const http = require('http');
const { loadIntakeProject, seedSheet } = require('./test/helpers/gasSandbox');

const PUERTO = process.env.PORT || 8787;

function construirContexto() {
  const ctx = loadIntakeProject({
    scriptProperties: {
      SIGSO_SHEET_ID: 'dev-sheet',
      SIGSO_TIMEZONE: 'America/Santiago',
      SIGSO_DRIVE_ROOT_FOLDER_ID: 'dev-drive-root'
    }
  });

  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'SUBSOLICITUDES', ctx.COLUMNAS.SUBSOLICITUDES);
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS);
  seedSheet(ctx, 'COUNTERS', ctx.COLUMNAS.COUNTERS);
  seedSheet(ctx, 'ARCHIVOS', ctx.COLUMNAS.ARCHIVOS);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'COMENTARIOS', ctx.COLUMNAS.COMENTARIOS);
  seedSheet(ctx, 'HISTORIAL_COMPROMISO', ctx.COLUMNAS.HISTORIAL_COMPROMISO);
  // P12 (v2.0, Sprint 3): switch global de aviso a Leo -- activo=true
  // reproduce el comportamiento de siempre en local.
  seedSheet(ctx, 'CONFIG_NOTIFICACIONES', ctx.COLUMNAS.CONFIG_NOTIFICACIONES, [
    ['AVISO_LEO', 'AVISO_DESARROLLO', '', '', true]
  ]);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Analista Demo', 'analista@homepymes.cl', 'HP', 'ANA', true, '', 'sistema'],
    ['U2', 'Dev Demo', 'dev@homepymes.cl', 'HP', 'DEV', true, '', 'sistema']
  ]);
  seedSheet(ctx, 'CONFIG_SLA', ctx.COLUMNAS.CONFIG_SLA, [
    ['P1', 2], ['P2', 24], ['P3', 72], ['P4', 120], ['P5', '']
  ]);
  seedSheet(ctx, 'CAT_EMPRESAS', ctx.COLUMNAS.CAT_EMPRESAS, [
    ['HP', 'HomePymes', '', true],
    ['GDE', 'GDE', '', true],
    ['RLD', 'RLD', '', true]
  ]);
  // Idea 1: cartera demo de clientes GDE/HomePymes para probar el buscador
  // del formulario (razon social/rut/codigo/contacto/correo/telefono + un
  // bloqueado y un inactivo para ver los badges).
  seedSheet(ctx, 'CAT_CLIENTES', ctx.COLUMNAS.CAT_CLIENTES, [
    ['CLI-78193514K', 'CBMD Construcciones SpA', '78.193.514-K', 'HP-209-1', 'Benjamin Munoz', 'cesarbenjaminm@gmail.com', '56883596985', 'Cesar Benjamin Munoz Diaz', 'Av. Recoleta 6109', 'Inactivo', 'Activo', true],
    ['CLI-768972176', 'Alfacorp SpA', '76.897.217-6', 'HP-013-1', 'Manuel Alfaro', 'contacto.alfacorp1@gmail.com', '955309287', 'Manuel Enrique Alfaro Reyes', 'Eduardo Llanos 33, Nunoa', 'Activo', 'Activo', true],
    ['CLI-763534570', 'Constructora San Pablo SpA', '76.353.457-K', 'HP-016-1', 'Pablo Cuevas', 'pablo.cuevas@sanpablospa.com', '56975881868', 'Pablo Andres Cuevas Romero', 'Cond Polo Manquehue', 'Activo', 'Activo', true],
    ['CLI-774301747', 'Shen Long SpA', '77.430.174-7', 'HC-063-2', 'Enrique Isla', 'shenlong.spa@gmail.com', '56994690272', 'Enrique Llefri Isla Gaspar', 'Herrera 98, Santiago', 'Inactivo', 'Bloqueado', true],
    ['CLI-774664874', 'VyE Construcciones SpA', '77.466.487-4', 'HP-078-1', 'Mauricio Venegas', 'm.venegas1984@gmail.com', '961704796', 'Daphne Hidalgo Guajardo', 'Av Grecia 1938, Nunoa', 'Activo', 'Activo', true]
  ]);
  // Plataformas y modulos reales de RF-007/RF-008 (doc 3 de v1.0), no
  // inventados: sirven para probar el formulario con datos representativos.
  seedSheet(ctx, 'CAT_PLATAFORMAS', ctx.COLUMNAS.CAT_PLATAFORMAS, [
    ['INT_GDE', 'Intranet GDE', 'HP', '', true],
    ['HP_DIG', 'HomePymes Digital', 'HP', '', true],
    ['RLD_GI', 'Gestion Integral', 'RLD', '', true],
    ['RLD_AUD', 'Auditoria', 'RLD', '', true],
    ['RLD_GDE', 'GDE', 'RLD', '', true]
  ]);
  seedSheet(ctx, 'CAT_MODULOS', ctx.COLUMNAS.CAT_MODULOS, [
    ['MOD_DASH', 'Dashboard', 'INT_GDE', '', true],
    ['MOD_CHARLA', 'Charla Diaria', 'INT_GDE', '', true],
    ['MOD_AST', 'AST', 'INT_GDE', '', true],
    // Ejemplo de jerarquia de 2 niveles (post-Fase 8): modulo principal +
    // submodulos, para probar la cascada del formulario en local.
    ['MOD_GENDOC', 'Generador Documental', 'RLD_GDE', '', true],
    ['MOD_GENDOC_GEN', 'Generar Documento', 'RLD_GDE', 'MOD_GENDOC', true],
    ['MOD_GENDOC_FIRMA', 'Firma R Generador', 'RLD_GDE', 'MOD_GENDOC', true],
    ['MOD_LIQ', 'Liquidaciones', 'RLD_GDE', '', true],
    ['MOD_VAC', 'Vacaciones', 'RLD_GDE', '', true],
    // Ejemplo de jerarquia de 4 niveles real (Prevencion > Gestion
    // Preventiva > Charlas > Registro de charlas), para probar el 4to
    // select (sub-item) en local.
    ['MOD_PREV', 'Prevencion', 'RLD_GDE', '', true],
    ['MOD_PREV_GESTPREV', 'Gestion Preventiva', 'RLD_GDE', 'MOD_PREV', true],
    ['MOD_PREV_CHARLAS', 'Charlas', 'RLD_GDE', 'MOD_PREV_GESTPREV', true],
    ['MOD_PREV_CHARLAS_REG', 'Registro de charlas', 'RLD_GDE', 'MOD_PREV_CHARLAS', true],
    ['MOD_PREV_CHARLAS_HIST', 'Historico', 'RLD_GDE', 'MOD_PREV_CHARLAS', true]
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
  // v3.0 (Fase 1): areas -> responsable, para ver el selector en el
  // formulario y probar el ruteo del aviso. area_id | nombre | correo | activo.
  seedSheet(ctx, 'CAT_AREAS', ctx.COLUMNAS.CAT_AREAS, [
    ['AREA_PLAT', 'Plataformas / sistemas', 'leo@rld.cl', true],
    ['AREA_CONTA', 'Contabilidad', 'luis@rld.cl', true],
    ['AREA_RRHH', 'Recursos Humanos', 'rrhh@rld.cl', true]
  ]);

  return ctx;
}

const ctx = construirContexto();

const servidor = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not_found' }));
    return;
  }

  let cuerpo = '';
  req.on('data', (chunk) => { cuerpo += chunk; });
  req.on('end', () => {
    const evento = { postData: { contents: cuerpo, type: 'text/plain' } };
    let salida;
    try {
      salida = ctx.doPost(evento);
    } catch (err) {
      console.error('[dev-server] error inesperado:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'internal' }));
      return;
    }
    const accion = JSON.parse(cuerpo || '{}').action;
    console.log('[dev-server]', new Date().toISOString(), accion);
    // v3.0 (Fase 3): en local no hay bandeja de correo real -- se imprime el
    // codigo de un solo uso en la consola para poder probar "Mis solicitudes"
    // sin depender de Gmail (MailApp esta mockeado, no envia nada real).
    if (accion === 'solicitarCodigoAcceso') {
      const eventos = ctx.leerFilas_('LOG_NOTIFICACIONES').filter((n) => n.evento.indexOf('CODIGO_ACCESO:') === 0);
      const ultimo = eventos[eventos.length - 1];
      if (ultimo) {
        console.log('[dev-server] codigo de acceso generado:', ultimo.evento.split(':')[1]);
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(salida.getContent());
  });
});

servidor.listen(PUERTO, () => {
  console.log('SIGSO dev-server (Intake) escuchando en http://localhost:' + PUERTO);
  console.log('Solo para desarrollo local del frontend. No se despliega.');
});
