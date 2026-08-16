'use strict';

// v10.0 Fase 4 (documentacion/SIGSO-v10.0-propuesta-modulo-sgc-iso9001.md):
// quejas, felicitaciones y consultas (PRO-07), Partes 2 a 5 del
// FO-PRO-07-01. La Parte 1 (registro publico) se prueba en
// backend/test/quejas-intake.test.js; aca se prueba todo lo que pasa
// DESPUES de que la queja ya existe.
//
// Lo que protegen estos tests, en orden de importancia:
//  1. QUE LA CADENA LLEGUE HASTA EL FINAL cuando corresponde: queja ->
//     no conformidad -> actividad en "Mi trabajo" (mismo eslabon que ya
//     existe para auditoria -> hallazgo -> NC).
//  2. El conflicto de interes (PRO-07 §6.2): el investigador no puede ser
//     del area que origino la queja.
//  3. Que el ciclo respete el orden y que los plazos sean 30 dias
//     CORRIDOS (no habiles, a diferencia de PRO-03/PRO-06 -- es la
//     diferencia mas facil de romper por copiar y pegar del patron
//     anterior).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'raiz' }
  });
  seedSheet(ctx, 'SGC_QUEJAS', ctx.COLUMNAS.SGC_QUEJAS);
  seedSheet(ctx, 'SGC_NC', ctx.COLUMNAS.SGC_NC);
  seedSheet(ctx, 'SGC_ROLES', ctx.COLUMNAS.SGC_ROLES);
  seedSheet(ctx, 'ACTIVIDADES', ctx.COLUMNAS.ACTIVIDADES);
  seedSheet(ctx, 'ACTIVIDADES_BITACORA', ctx.COLUMNAS.ACTIVIDADES_BITACORA);
  seedSheet(ctx, 'JEFATURAS', ctx.COLUMNAS.JEFATURAS);
  seedSheet(ctx, 'CONFIG_FERIADOS', ctx.COLUMNAS.CONFIG_FERIADOS);
  seedSheet(ctx, 'LOG_SISTEMA', ctx.COLUMNAS.LOG_SISTEMA);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'NOTIFICACIONES_APP', ctx.COLUMNAS.NOTIFICACIONES_APP);
  seedSheet(ctx, 'CONFIG_NOTIFICACIONES', ctx.COLUMNAS.CONFIG_NOTIFICACIONES);
  seedSheet(ctx, 'CAT_AREAS', ctx.COLUMNAS.CAT_AREAS);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Encargado SGC', 'sgc@homepymes.cl', 'HP', 'DEV', true, '', 'sistema'],
    ['U2', 'Investigador', 'investigador@homepymes.cl', 'HP', 'DEV', true, '', 'sistema'],
    ['U3', 'Contabilidad', 'contabilidad@homepymes.cl', 'HP', 'DEV', true, '', 'sistema'],
    ['U4', 'Ajeno', 'ajeno@homepymes.cl', 'HP', 'DEV', true, '', 'sistema']
  ]);
  return ctx;
}

const CTX_SGC = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const CTX_INVESTIGADOR = { email: 'investigador@homepymes.cl', nombre: 'Investigador', rol: 'DEV' };
const CTX_AJENO = { email: 'ajeno@homepymes.cl', nombre: 'Ajeno', rol: 'DEV' };
const CTX_ADM = { email: 'admin@homepymes.cl', nombre: 'Admin', rol: 'ADM' };

// El investigador es de PREVENCION y la queja es de CONTABILIDAD: asi el
// escenario base NO tiene conflicto de interes, y el conflicto se prueba
// aparte, a proposito.
function sembrar(ctx) {
  ctx.Calidad.gestionarRol({ usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADM);
  ctx.Calidad.gestionarRol({
    usuario_email: 'investigador@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'PREVENCION'
  }, CTX_ADM);
  ctx.Calidad.gestionarRol({
    usuario_email: 'contabilidad@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'CONTABILIDAD'
  }, CTX_ADM);
}

// Se siembra la fila directamente (equivalente a lo que dejaria
// Quejas.crear del lado Intake, que se prueba aparte).
function crearQueja(ctx, overrides) {
  const queja = Object.assign({
    queja_id: ctx.Utilities.getUuid(),
    correlativo: 'Q-2026-001',
    nombre_completo: 'María González',
    empresa: 'Constructora XYZ',
    rut: '11.111.111-1',
    email: 'maria@xyz.cl',
    telefono: '+56911111111',
    tipo: 'QUEJA',
    area: 'CONTABILIDAD',
    descripcion: 'El informe de renta llegó con más de una semana de atraso respecto a lo comprometido.',
    canal: 'WEB',
    fecha_envio: new Date().toISOString(),
    fecha_recepcion: '', procede: '', motivo_no_procede: '', registrado_por: '',
    investigador_email: '', resultado_investigacion: '', valida: '',
    accion_implementada: '', nc_id: '', resolucion_plazo: '', fecha_resolucion: '', responsable_resolucion: '',
    fecha_notificacion: '', revisado_por: '',
    seguimiento_plazo: '', fecha_seguimiento: '', cliente_conforme: '',
    estado: 'RECIBIDA',
    fecha_cierre: '', cerrada_por: '', fecha_creacion: new Date().toISOString(), activa: true
  }, overrides);
  ctx.agregarFila_('SGC_QUEJAS', queja);
  return queja;
}

// Recorre el ciclo completo hasta EN_RESOLUCION, listo para probar la
// resolucion. Devuelve la queja sembrada.
function avanzarHastaResolucion(ctx, overrides) {
  const queja = crearQueja(ctx, overrides);
  ctx.Quejas.registrarRecepcion({ queja_id: queja.queja_id, procede: true }, CTX_SGC);
  ctx.Quejas.registrarInvestigacion({ queja_id: queja.queja_id, investigador_email: 'investigador@homepymes.cl' }, CTX_SGC);
  ctx.Quejas.registrarResultado({
    queja_id: queja.queja_id, resultado_investigacion: 'Se confirmó el atraso con el cliente.', valida: true
  }, CTX_INVESTIGADOR);
  return queja;
}

// --- el ciclo completo, en orden --------------------------------------------

test('el ciclo completo: recepcion -> investigacion -> resolucion -> notificacion -> seguimiento -> cierre', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const queja = crearQueja(ctx);

  assert.equal(ctx.Quejas.registrarRecepcion({ queja_id: queja.queja_id, procede: true }, CTX_SGC).estado, 'EN_INVESTIGACION');
  assert.equal(ctx.Quejas.registrarInvestigacion({
    queja_id: queja.queja_id, investigador_email: 'investigador@homepymes.cl'
  }, CTX_SGC).investigador_email, 'investigador@homepymes.cl');
  const investigada = ctx.Quejas.registrarResultado({
    queja_id: queja.queja_id, resultado_investigacion: 'Se confirmó el atraso.', valida: true
  }, CTX_INVESTIGADOR);
  assert.equal(investigada.estado, 'EN_RESOLUCION');
  assert.ok(investigada.resolucion_plazo, 'debe quedar el plazo de resolucion calculado');

  const resuelta = ctx.Quejas.registrarResolucion({
    queja_id: queja.queja_id, accion_implementada: 'Se reforzó el equipo de renta y se ajustó el cronograma.'
  }, CTX_SGC);
  assert.equal(resuelta.estado, 'RESUELTA');

  const notificada = ctx.Quejas.registrarNotificacion({
    queja_id: queja.queja_id, revisado_por: 'admin@homepymes.cl'
  }, CTX_SGC);
  assert.equal(notificada.estado, 'NOTIFICADA');
  assert.ok(notificada.seguimiento_plazo);

  const cerrada = ctx.Quejas.registrarSeguimiento({ queja_id: queja.queja_id, cliente_conforme: true }, CTX_SGC);
  assert.equal(cerrada.estado, 'CERRADA');
  assert.ok(cerrada.fecha_cierre);
});

test('un cliente no conforme REABRE el caso, no lo cierra', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const queja = avanzarHastaResolucion(ctx);
  ctx.Quejas.registrarResolucion({ queja_id: queja.queja_id, accion_implementada: 'Se hizo X.' }, CTX_SGC);
  ctx.Quejas.registrarNotificacion({ queja_id: queja.queja_id, revisado_por: 'admin@homepymes.cl' }, CTX_SGC);
  const reabierta = ctx.Quejas.registrarSeguimiento({ queja_id: queja.queja_id, cliente_conforme: false }, CTX_SGC);
  assert.equal(reabierta.estado, 'REABIERTA');
  assert.equal(reabierta.fecha_cierre, '', 'no se cierra si el cliente no quedo conforme');
});

test('si no procede, se cierra directo con el motivo (sin pasar por investigacion)', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const queja = crearQueja(ctx);
  const r = ctx.Quejas.registrarRecepcion({
    queja_id: queja.queja_id, procede: false, motivo_no_procede: 'Servicio suspendido por falta de pago.'
  }, CTX_SGC);
  assert.equal(r.estado, 'NO_PROCEDE');
  assert.ok(r.fecha_cierre);
  const destinos = ctx.leerFilas_('LOG_NOTIFICACIONES').map((n) => n.destinatario);
  assert.ok(destinos.includes('maria@xyz.cl'));
});

test('si la investigacion concluye que no es valida, se cierra con justificacion', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const queja = crearQueja(ctx);
  ctx.Quejas.registrarRecepcion({ queja_id: queja.queja_id, procede: true }, CTX_SGC);
  ctx.Quejas.registrarInvestigacion({ queja_id: queja.queja_id, investigador_email: 'investigador@homepymes.cl' }, CTX_SGC);
  const sinJustificar = ctx.Quejas.registrarResultado({
    queja_id: queja.queja_id, resultado_investigacion: 'No se encontró evidencia.', valida: false
  }, CTX_INVESTIGADOR);
  assert.equal(sinJustificar._validationError, true, 'exige justificacion si no es valida');

  const noValida = ctx.Quejas.registrarResultado({
    queja_id: queja.queja_id, resultado_investigacion: 'No se encontró evidencia.', valida: false,
    justificacion: 'El plazo comprometido con el cliente era distinto al que reclama.'
  }, CTX_INVESTIGADOR);
  assert.equal(noValida.estado, 'NO_VALIDA');
  assert.ok(noValida.fecha_cierre);
});

// --- conflicto de interes (PRO-07 §6.2) --------------------------------------

test('el investigador no puede ser del area que origino la queja', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const queja = crearQueja(ctx); // area CONTABILIDAD
  ctx.Quejas.registrarRecepcion({ queja_id: queja.queja_id, procede: true }, CTX_SGC);
  const r = ctx.Quejas.registrarInvestigacion({
    queja_id: queja.queja_id, investigador_email: 'contabilidad@homepymes.cl'
  }, CTX_SGC);
  assert.equal(r._validationError, true);
  assert.match(r.message, /propio trabajo/);
});

test('un investigador de otra area si puede investigar', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const queja = crearQueja(ctx);
  ctx.Quejas.registrarRecepcion({ queja_id: queja.queja_id, procede: true }, CTX_SGC);
  const r = ctx.Quejas.registrarInvestigacion({
    queja_id: queja.queja_id, investigador_email: 'investigador@homepymes.cl'
  }, CTX_SGC);
  assert.equal(r.investigador_email, 'investigador@homepymes.cl');
});

// --- la cadena hasta "Mi trabajo" --------------------------------------------

test('la queja se puede convertir en no conformidad, y de ahi sigue hasta una ACTIVIDAD real', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const queja = avanzarHastaResolucion(ctx);

  const convertida = ctx.Quejas.convertirEnNc({
    queja_id: queja.queja_id, responsable_email: 'contabilidad@homepymes.cl'
  }, CTX_SGC);
  assert.ok(convertida.nc);
  assert.equal(convertida.nc.fuente, 'QUEJA');
  assert.equal(convertida.nc.origen_ref, queja.queja_id);
  assert.equal(convertida.nc.area_id, 'CONTABILIDAD');

  const conAccion = ctx.NoConformidades.registrarCorreccion({
    nc_id: convertida.nc.nc_id, descripcion: 'Reforzar el equipo de renta.'
  }, CTX_SGC);
  const tarea = ctx.leerFilas_('ACTIVIDADES').find((a) => a.actividad_id === conAccion.correccion_actividad_id);
  assert.ok(tarea, 'la correccion debe existir como ACTIVIDAD real');
  assert.equal(tarea.responsable_email, 'contabilidad@homepymes.cl');

  const detalle = ctx.Quejas.getDetalle({ queja_id: queja.queja_id }, CTX_SGC);
  assert.match(detalle.nc_correlativo, /^NC-\d{4}-\d{3}$/);
});

test('una queja no se convierte dos veces en no conformidad', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const queja = avanzarHastaResolucion(ctx);
  ctx.Quejas.convertirEnNc({ queja_id: queja.queja_id, responsable_email: 'contabilidad@homepymes.cl' }, CTX_SGC);
  const segunda = ctx.Quejas.convertirEnNc({ queja_id: queja.queja_id, responsable_email: 'contabilidad@homepymes.cl' }, CTX_SGC);
  assert.equal(segunda._validationError, true);
});

// --- plazos: 30 DIAS CORRIDOS, no habiles ------------------------------------

test('el plazo de resolucion son 30 dias CORRIDOS desde que se valida, no habiles', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const queja = crearQueja(ctx);
  ctx.Quejas.registrarRecepcion({ queja_id: queja.queja_id, procede: true }, CTX_SGC);
  ctx.Quejas.registrarInvestigacion({ queja_id: queja.queja_id, investigador_email: 'investigador@homepymes.cl' }, CTX_SGC);
  const investigada = ctx.Quejas.registrarResultado({
    queja_id: queja.queja_id, resultado_investigacion: 'Confirmado.', valida: true
  }, CTX_INVESTIGADOR);
  const dias = Math.round((new Date(investigada.resolucion_plazo) - new Date()) / 86400000);
  // Si fueran dias habiles, 30 se estirarian a 40+ dias corridos segun
  // fines de semana. Aca deben ser exactamente 30 (+/-1 por horas).
  // El plazo cae a fin del dia 30 (23:59:59 UTC), asi que segun la hora
  // exacta en que corre el test puede redondear a 29, 30 o 31.
  assert.ok(dias >= 29 && dias <= 31, `plazo inesperado: ${dias} dias`);
});

test('el plazo de seguimiento son 30 dias CORRIDOS desde la notificacion', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const queja = avanzarHastaResolucion(ctx);
  ctx.Quejas.registrarResolucion({ queja_id: queja.queja_id, accion_implementada: 'Se hizo X.' }, CTX_SGC);
  const notificada = ctx.Quejas.registrarNotificacion({
    queja_id: queja.queja_id, revisado_por: 'admin@homepymes.cl'
  }, CTX_SGC);
  const dias = Math.round((new Date(notificada.seguimiento_plazo) - new Date()) / 86400000);
  // El plazo cae a fin del dia 30 (23:59:59 UTC), asi que segun la hora
  // exacta en que corre el test puede redondear a 29, 30 o 31.
  assert.ok(dias >= 29 && dias <= 31, `plazo inesperado: ${dias} dias`);
});

// --- avisos con plazo vencido ------------------------------------------------

test('aviso: resolucion vencida llega al Encargado SGC', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const queja = avanzarHastaResolucion(ctx);
  ctx.actualizarFilaPorId_('SGC_QUEJAS', 'queja_id', queja.queja_id, {
    resolucion_plazo: '2020-01-01T00:00:00.000Z'
  });
  const r = ctx.Quejas.recordatorioPendientes();
  assert.ok(r.avisos >= 1);
  const destinos = ctx.leerFilas_('LOG_NOTIFICACIONES').map((n) => n.destinatario);
  assert.ok(destinos.includes('sgc@homepymes.cl'));
});

test('aviso: seguimiento vencido llega al Encargado SGC', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const queja = avanzarHastaResolucion(ctx);
  ctx.Quejas.registrarResolucion({ queja_id: queja.queja_id, accion_implementada: 'X.' }, CTX_SGC);
  ctx.Quejas.registrarNotificacion({ queja_id: queja.queja_id, revisado_por: 'admin@homepymes.cl' }, CTX_SGC);
  ctx.actualizarFilaPorId_('SGC_QUEJAS', 'queja_id', queja.queja_id, {
    seguimiento_plazo: '2020-01-01T00:00:00.000Z'
  });
  const r = ctx.Quejas.recordatorioPendientes();
  assert.ok(r.avisos >= 1);
});

test('aviso: no se repite el mismo dia', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const queja = avanzarHastaResolucion(ctx);
  ctx.actualizarFilaPorId_('SGC_QUEJAS', 'queja_id', queja.queja_id, {
    resolucion_plazo: '2020-01-01T00:00:00.000Z'
  });
  ctx.Quejas.recordatorioPendientes();
  assert.equal(ctx.Quejas.recordatorioPendientes().avisos, 0);
});

// --- permisos y visibilidad ---------------------------------------------------

test('el investigador asignado ve su queja aunque no gobierne el SGC; un tercero no', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const queja = crearQueja(ctx);
  ctx.Quejas.registrarRecepcion({ queja_id: queja.queja_id, procede: true }, CTX_SGC);
  ctx.Quejas.registrarInvestigacion({ queja_id: queja.queja_id, investigador_email: 'investigador@homepymes.cl' }, CTX_SGC);

  assert.ok(ctx.Quejas.getDetalle({ queja_id: queja.queja_id }, CTX_INVESTIGADOR).queja);
  assert.equal(ctx.Quejas.getDetalle({ queja_id: queja.queja_id }, CTX_AJENO)._forbidden, true);
  assert.equal(ctx.Quejas.listar({}, CTX_AJENO).quejas.length, 0);
});

test('solo el Encargado SGC gestiona el ciclo; el investigador solo registra el resultado', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const queja = crearQueja(ctx);
  assert.equal(ctx.Quejas.registrarRecepcion({ queja_id: queja.queja_id, procede: true }, CTX_INVESTIGADOR)._forbidden, true);
  ctx.Quejas.registrarRecepcion({ queja_id: queja.queja_id, procede: true }, CTX_SGC);
  assert.equal(
    ctx.Quejas.registrarInvestigacion({ queja_id: queja.queja_id, investigador_email: 'investigador@homepymes.cl' }, CTX_INVESTIGADOR)._forbidden,
    true
  );
});

test('una queja se anula con motivo, nunca se borra', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const queja = crearQueja(ctx);
  assert.equal(ctx.Quejas.anular({ queja_id: queja.queja_id }, CTX_SGC)._validationError, true);
  const anulada = ctx.Quejas.anular({ queja_id: queja.queja_id, motivo: 'Duplicada.' }, CTX_SGC);
  assert.equal(anulada.estado, 'ANULADA');
  assert.equal(ctx.leerFilas_('SGC_QUEJAS').length, 1);
});

// --- indicadores (Objetivo de Calidad N°2, DOC-07: "< 2% de reclamos") ------

test('los indicadores separan quejas, felicitaciones y consultas del año', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  crearQueja(ctx, { queja_id: 'q1', correlativo: 'Q-2026-001', tipo: 'QUEJA' });
  crearQueja(ctx, { queja_id: 'q2', correlativo: 'Q-2026-002', tipo: 'FELICITACION' });
  crearQueja(ctx, { queja_id: 'q3', correlativo: 'Q-2026-003', tipo: 'CONSULTA' });
  const ind = ctx.Quejas.listar({}, CTX_SGC).indicadores;
  assert.equal(ind.total_anio, 3);
  assert.equal(ind.quejas_anio, 1);
  assert.equal(ind.felicitaciones_anio, 1);
  assert.equal(ind.consultas_anio, 1);
});
