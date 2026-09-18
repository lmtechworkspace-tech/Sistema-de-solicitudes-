'use strict';

/**
 * Prueba de portabilidad: SGC ISO 9001 Fase 4 (PRO-07, quejas) -- mismos
 * escenarios de quejas-backoffice.test.js, corridos contra
 * backend/logica/quejasSgc.js. La Parte 1 (registro público) no está
 * portada aún: las quejas se siembran directo en la tabla, igual que el
 * `.gs` original (equivalente a lo que dejaría Quejas.crear del Intake).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('../logica/calidadSgc');
const NoConformidades = require('../logica/noConformidadesSgc');
const Quejas = require('../logica/quejasSgc');
const Resend = require('../logica/resend');

const TABLAS = [
  'SGC_QUEJAS', 'SGC_NC', 'SGC_ROLES', 'ACTIVIDADES', 'ACTIVIDADES_BITACORA', 'JEFATURAS',
  'CONFIG_FERIADOS', 'LOG_SISTEMA', 'LOG_NOTIFICACIONES', 'NOTIFICACIONES_APP',
  'CONFIG_NOTIFICACIONES', 'CAT_AREAS'
];
function db_() {
  const db = abrirDb_();
  TABLAS.forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }

function conMockCorreo(t) {
  process.env.RESEND_API_KEY = 're_test_key';
  const mock = t.mock.method(Resend, 'enviarCorreoResend_', async () => ({ id: 'x' }));
  t.after(() => { delete process.env.RESEND_API_KEY; });
  return mock;
}

const CTX_SGC = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const CTX_INVESTIGADOR = { email: 'investigador@homepymes.cl', nombre: 'Investigador', rol: 'DEV' };
const CTX_AJENO = { email: 'ajeno@homepymes.cl', nombre: 'Ajeno', rol: 'DEV' };
const CTX_ADM = { email: 'admin@homepymes.cl', nombre: 'Admin', rol: 'ADM' };

// El investigador es de PREVENCION y la queja es de CONTABILIDAD: asi el
// escenario base NO tiene conflicto de interes, y el conflicto se prueba aparte.
function sembrar(db) {
  Calidad.gestionarRol(db, { usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADM);
  Calidad.gestionarRol(db, { usuario_email: 'investigador@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'PREVENCION' }, CTX_ADM);
  Calidad.gestionarRol(db, { usuario_email: 'contabilidad@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'CONTABILIDAD' }, CTX_ADM);
}

// Se siembra la fila directamente (equivalente a lo que dejaria
// Quejas.crear del lado Intake, que no esta portado en este incremento).
function crearQueja(db, overrides) {
  const queja = Object.assign({
    queja_id: crypto.randomUUID(), correlativo: 'Q-2026-001',
    nombre_completo: 'María González', empresa: 'Constructora XYZ', rut: '11.111.111-1',
    email: 'maria@xyz.cl', telefono: '+56911111111', tipo: 'QUEJA', area: 'CONTABILIDAD',
    descripcion: 'El informe de renta llegó con más de una semana de atraso respecto a lo comprometido.',
    canal: 'WEB', fecha_envio: new Date().toISOString(),
    fecha_recepcion: '', procede: '', motivo_no_procede: '', registrado_por: '',
    investigador_email: '', resultado_investigacion: '', valida: '',
    accion_implementada: '', nc_id: '', resolucion_plazo: '', fecha_resolucion: '', responsable_resolucion: '',
    fecha_notificacion: '', revisado_por: '',
    seguimiento_plazo: '', fecha_seguimiento: '', cliente_conforme: '',
    estado: 'RECIBIDA',
    fecha_cierre: '', cerrada_por: '', fecha_creacion: new Date().toISOString(), activa: true
  }, overrides);
  agregarFila_(db, 'SGC_QUEJAS', queja);
  return queja;
}

// Recorre el ciclo hasta EN_RESOLUCION, listo para probar la resolucion.
function avanzarHastaResolucion(db, overrides) {
  const queja = crearQueja(db, overrides);
  Quejas.registrarRecepcion(db, { queja_id: queja.queja_id, procede: true }, CTX_SGC);
  Quejas.registrarInvestigacion(db, { queja_id: queja.queja_id, investigador_email: 'investigador@homepymes.cl' }, CTX_SGC);
  Quejas.registrarResultado(db, { queja_id: queja.queja_id, resultado_investigacion: 'Se confirmó el atraso con el cliente.', valida: true }, CTX_INVESTIGADOR);
  return queja;
}

// --- el ciclo completo, en orden --------------------------------------------

test('el ciclo completo: recepcion -> investigacion -> resolucion -> notificacion -> seguimiento -> cierre', async () => {
  const db = db_();
  sembrar(db);
  const queja = crearQueja(db);

  assert.equal((await Quejas.registrarRecepcion(db, { queja_id: queja.queja_id, procede: true }, CTX_SGC)).estado, 'EN_INVESTIGACION');
  assert.equal(Quejas.registrarInvestigacion(db, { queja_id: queja.queja_id, investigador_email: 'investigador@homepymes.cl' }, CTX_SGC).investigador_email, 'investigador@homepymes.cl');
  const investigada = await Quejas.registrarResultado(db, { queja_id: queja.queja_id, resultado_investigacion: 'Se confirmó el atraso.', valida: true }, CTX_INVESTIGADOR);
  assert.equal(investigada.estado, 'EN_RESOLUCION');
  assert.ok(investigada.resolucion_plazo);

  const resuelta = Quejas.registrarResolucion(db, { queja_id: queja.queja_id, accion_implementada: 'Se reforzó el equipo de renta y se ajustó el cronograma.' }, CTX_SGC);
  assert.equal(resuelta.estado, 'RESUELTA');

  const notificada = await Quejas.registrarNotificacion(db, { queja_id: queja.queja_id, revisado_por: 'admin@homepymes.cl' }, CTX_SGC);
  assert.equal(notificada.estado, 'NOTIFICADA');
  assert.ok(notificada.seguimiento_plazo);

  const cerrada = Quejas.registrarSeguimiento(db, { queja_id: queja.queja_id, cliente_conforme: true }, CTX_SGC);
  assert.equal(cerrada.estado, 'CERRADA');
  assert.ok(cerrada.fecha_cierre);
});

test('un cliente no conforme REABRE el caso, no lo cierra', async () => {
  const db = db_();
  sembrar(db);
  const queja = avanzarHastaResolucion(db);
  Quejas.registrarResolucion(db, { queja_id: queja.queja_id, accion_implementada: 'Se hizo X.' }, CTX_SGC);
  await Quejas.registrarNotificacion(db, { queja_id: queja.queja_id, revisado_por: 'admin@homepymes.cl' }, CTX_SGC);
  const reabierta = Quejas.registrarSeguimiento(db, { queja_id: queja.queja_id, cliente_conforme: false }, CTX_SGC);
  assert.equal(reabierta.estado, 'REABIERTA');
  assert.equal(reabierta.fecha_cierre, '');
});

test('si no procede, se cierra directo con el motivo (sin pasar por investigacion)', async (t) => {
  conMockCorreo(t);
  const db = db_();
  sembrar(db);
  const queja = crearQueja(db);
  const r = await Quejas.registrarRecepcion(db, { queja_id: queja.queja_id, procede: false, motivo_no_procede: 'Servicio suspendido por falta de pago.' }, CTX_SGC);
  assert.equal(r.estado, 'NO_PROCEDE');
  assert.ok(r.fecha_cierre);
  const destinos = filas(db, 'LOG_NOTIFICACIONES').map((n) => n.destinatario);
  assert.ok(destinos.includes('maria@xyz.cl'));
});

test('si la investigacion concluye que no es valida, se cierra con justificacion', async () => {
  const db = db_();
  sembrar(db);
  const queja = crearQueja(db);
  await Quejas.registrarRecepcion(db, { queja_id: queja.queja_id, procede: true }, CTX_SGC);
  Quejas.registrarInvestigacion(db, { queja_id: queja.queja_id, investigador_email: 'investigador@homepymes.cl' }, CTX_SGC);
  const sinJustificar = await Quejas.registrarResultado(db, { queja_id: queja.queja_id, resultado_investigacion: 'No se encontró evidencia.', valida: false }, CTX_INVESTIGADOR);
  assert.equal(sinJustificar._validationError, true);

  const noValida = await Quejas.registrarResultado(db, {
    queja_id: queja.queja_id, resultado_investigacion: 'No se encontró evidencia.', valida: false,
    justificacion: 'El plazo comprometido con el cliente era distinto al que reclama.'
  }, CTX_INVESTIGADOR);
  assert.equal(noValida.estado, 'NO_VALIDA');
  assert.ok(noValida.fecha_cierre);
});

// --- conflicto de interes (PRO-07 §6.2) --------------------------------------

test('el investigador no puede ser del area que origino la queja', async () => {
  const db = db_();
  sembrar(db);
  const queja = crearQueja(db); // area CONTABILIDAD
  await Quejas.registrarRecepcion(db, { queja_id: queja.queja_id, procede: true }, CTX_SGC);
  const r = Quejas.registrarInvestigacion(db, { queja_id: queja.queja_id, investigador_email: 'contabilidad@homepymes.cl' }, CTX_SGC);
  assert.equal(r._validationError, true);
  assert.match(r.message, /propio trabajo/);
});

test('un investigador de otra area si puede investigar', async () => {
  const db = db_();
  sembrar(db);
  const queja = crearQueja(db);
  await Quejas.registrarRecepcion(db, { queja_id: queja.queja_id, procede: true }, CTX_SGC);
  const r = Quejas.registrarInvestigacion(db, { queja_id: queja.queja_id, investigador_email: 'investigador@homepymes.cl' }, CTX_SGC);
  assert.equal(r.investigador_email, 'investigador@homepymes.cl');
});

// --- la cadena hasta "Mi trabajo" --------------------------------------------

test('la queja se puede convertir en no conformidad, y de ahi sigue hasta una ACTIVIDAD real', async () => {
  const db = db_();
  sembrar(db);
  const queja = avanzarHastaResolucion(db);

  const convertida = Quejas.convertirEnNc(db, { queja_id: queja.queja_id, responsable_email: 'contabilidad@homepymes.cl' }, CTX_SGC);
  assert.ok(convertida.nc);
  assert.equal(convertida.nc.fuente, 'QUEJA');
  assert.equal(convertida.nc.origen_ref, queja.queja_id);
  assert.equal(convertida.nc.area_id, 'CONTABILIDAD');

  const conAccion = await NoConformidades.registrarCorreccion(db, { nc_id: convertida.nc.nc_id, descripcion: 'Reforzar el equipo de renta.' }, CTX_SGC);
  const tarea = filas(db, 'ACTIVIDADES').find((a) => a.actividad_id === conAccion.correccion_actividad_id);
  assert.ok(tarea);
  assert.equal(tarea.responsable_email, 'contabilidad@homepymes.cl');

  const detalle = Quejas.getDetalle(db, { queja_id: queja.queja_id }, CTX_SGC);
  assert.match(detalle.nc_correlativo, /^NC-\d{4}-\d{3}$/);
});

test('una queja no se convierte dos veces en no conformidad', async () => {
  const db = db_();
  sembrar(db);
  const queja = avanzarHastaResolucion(db);
  Quejas.convertirEnNc(db, { queja_id: queja.queja_id, responsable_email: 'contabilidad@homepymes.cl' }, CTX_SGC);
  const segunda = Quejas.convertirEnNc(db, { queja_id: queja.queja_id, responsable_email: 'contabilidad@homepymes.cl' }, CTX_SGC);
  assert.equal(segunda._validationError, true);
});

// --- plazos: 30 DIAS CORRIDOS, no habiles ------------------------------------

test('el plazo de resolucion son 30 dias CORRIDOS desde que se valida, no habiles', async () => {
  const db = db_();
  sembrar(db);
  const queja = crearQueja(db);
  await Quejas.registrarRecepcion(db, { queja_id: queja.queja_id, procede: true }, CTX_SGC);
  Quejas.registrarInvestigacion(db, { queja_id: queja.queja_id, investigador_email: 'investigador@homepymes.cl' }, CTX_SGC);
  const investigada = await Quejas.registrarResultado(db, { queja_id: queja.queja_id, resultado_investigacion: 'Confirmado.', valida: true }, CTX_INVESTIGADOR);
  const dias = Math.round((new Date(investigada.resolucion_plazo) - new Date()) / 86400000);
  assert.ok(dias >= 29 && dias <= 31, `plazo inesperado: ${dias} dias`);
});

test('el plazo de seguimiento son 30 dias CORRIDOS desde la notificacion', async () => {
  const db = db_();
  sembrar(db);
  const queja = avanzarHastaResolucion(db);
  Quejas.registrarResolucion(db, { queja_id: queja.queja_id, accion_implementada: 'Se hizo X.' }, CTX_SGC);
  const notificada = await Quejas.registrarNotificacion(db, { queja_id: queja.queja_id, revisado_por: 'admin@homepymes.cl' }, CTX_SGC);
  const dias = Math.round((new Date(notificada.seguimiento_plazo) - new Date()) / 86400000);
  assert.ok(dias >= 29 && dias <= 31, `plazo inesperado: ${dias} dias`);
});

// --- avisos con plazo vencido ------------------------------------------------

test('aviso: resolucion vencida llega al Encargado SGC', async (t) => {
  conMockCorreo(t);
  const db = db_();
  sembrar(db);
  const queja = avanzarHastaResolucion(db);
  actualizarFilaPorId_(db, 'SGC_QUEJAS', 'queja_id', queja.queja_id, { resolucion_plazo: '2020-01-01T00:00:00.000Z' });
  const r = await Quejas.recordatorioPendientes(db);
  assert.ok(r.avisos >= 1);
  const destinos = filas(db, 'LOG_NOTIFICACIONES').map((n) => n.destinatario);
  assert.ok(destinos.includes('sgc@homepymes.cl'));
});

test('aviso: seguimiento vencido llega al Encargado SGC', async (t) => {
  conMockCorreo(t);
  const db = db_();
  sembrar(db);
  const queja = avanzarHastaResolucion(db);
  Quejas.registrarResolucion(db, { queja_id: queja.queja_id, accion_implementada: 'X.' }, CTX_SGC);
  await Quejas.registrarNotificacion(db, { queja_id: queja.queja_id, revisado_por: 'admin@homepymes.cl' }, CTX_SGC);
  actualizarFilaPorId_(db, 'SGC_QUEJAS', 'queja_id', queja.queja_id, { seguimiento_plazo: '2020-01-01T00:00:00.000Z' });
  const r = await Quejas.recordatorioPendientes(db);
  assert.ok(r.avisos >= 1);
});

test('aviso: no se repite el mismo dia', async (t) => {
  conMockCorreo(t);
  const db = db_();
  sembrar(db);
  const queja = avanzarHastaResolucion(db);
  actualizarFilaPorId_(db, 'SGC_QUEJAS', 'queja_id', queja.queja_id, { resolucion_plazo: '2020-01-01T00:00:00.000Z' });
  await Quejas.recordatorioPendientes(db);
  assert.equal((await Quejas.recordatorioPendientes(db)).avisos, 0);
});

// --- permisos y visibilidad ---------------------------------------------------

test('el investigador asignado ve su queja aunque no gobierne el SGC; un tercero no', async () => {
  const db = db_();
  sembrar(db);
  const queja = crearQueja(db);
  await Quejas.registrarRecepcion(db, { queja_id: queja.queja_id, procede: true }, CTX_SGC);
  Quejas.registrarInvestigacion(db, { queja_id: queja.queja_id, investigador_email: 'investigador@homepymes.cl' }, CTX_SGC);

  assert.ok(Quejas.getDetalle(db, { queja_id: queja.queja_id }, CTX_INVESTIGADOR).queja);
  assert.equal(Quejas.getDetalle(db, { queja_id: queja.queja_id }, CTX_AJENO)._forbidden, true);
  assert.equal(Quejas.listar(db, {}, CTX_AJENO).quejas.length, 0);
});

test('solo el Encargado SGC gestiona el ciclo; el investigador solo registra el resultado', async () => {
  const db = db_();
  sembrar(db);
  const queja = crearQueja(db);
  assert.equal((await Quejas.registrarRecepcion(db, { queja_id: queja.queja_id, procede: true }, CTX_INVESTIGADOR))._forbidden, true);
  await Quejas.registrarRecepcion(db, { queja_id: queja.queja_id, procede: true }, CTX_SGC);
  assert.equal(Quejas.registrarInvestigacion(db, { queja_id: queja.queja_id, investigador_email: 'investigador@homepymes.cl' }, CTX_INVESTIGADOR)._forbidden, true);
});

test('una queja se anula con motivo, nunca se borra', () => {
  const db = db_();
  sembrar(db);
  const queja = crearQueja(db);
  assert.equal(Quejas.anular(db, { queja_id: queja.queja_id }, CTX_SGC)._validationError, true);
  const anulada = Quejas.anular(db, { queja_id: queja.queja_id, motivo: 'Duplicada.' }, CTX_SGC);
  assert.equal(anulada.estado, 'ANULADA');
  assert.equal(filas(db, 'SGC_QUEJAS').length, 1);
});

// --- indicadores (Objetivo de Calidad N°2, DOC-07: "< 2% de reclamos") ------

test('los indicadores separan quejas, felicitaciones y consultas del año', () => {
  const db = db_();
  sembrar(db);
  crearQueja(db, { queja_id: 'q1', correlativo: 'Q-2026-001', tipo: 'QUEJA' });
  crearQueja(db, { queja_id: 'q2', correlativo: 'Q-2026-002', tipo: 'FELICITACION' });
  crearQueja(db, { queja_id: 'q3', correlativo: 'Q-2026-003', tipo: 'CONSULTA' });
  const ind = Quejas.listar(db, {}, CTX_SGC).indicadores;
  assert.equal(ind.total_anio, 3);
  assert.equal(ind.quejas_anio, 1);
  assert.equal(ind.felicitaciones_anio, 1);
  assert.equal(ind.consultas_anio, 1);
});
