'use strict';

/**
 * Prueba de portabilidad: los mismos escenarios de datos de
 * actividades-porteo.test.js (generarReporte/generarActaReunion), más la
 * capa nueva que agrega este módulo: que descargarReporte/descargarActa
 * conviertan esos datos en un PDF real (base64 con magic bytes %PDF) y
 * respeten el nombre de archivo que ya generaba ReporteActividades.gs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const A = require('../logica/actividades');
const Reporte = require('../logica/reporteActividades');
// Este archivo prueba la versión pdfkit, que sigue siendo el RESPALDO cuando no hay
// Chromium (ver documentoV2.js); la versión v2 se prueba en documento-v2.test.js.
require('../logica/documentoV2').disponible = () => false;

const CTX_MARCELO = { email: 'marcelo@rld.cl', nombre: 'Marcelo Gonzalez', rol: 'DEV' };
const CTX_ADM = { email: 'admin@rld.cl', nombre: 'Admin', rol: 'ADM' };

function jefatura(over) {
  return Object.assign({ jefatura_id: 'JEF-' + Math.random().toString(36).slice(2), jefe_email: 'barbara@rld.cl', subordinado_email: 'marcelo@rld.cl', activo: true }, over);
}

function db_() {
  const db = abrirDb_();
  ['ACTIVIDADES', 'ACTIVIDADES_BITACORA', 'JEFATURAS', 'CONFIG_FERIADOS', 'LOG_NOTIFICACIONES', 'NOTIFICACIONES_APP', 'USUARIOS']
    .forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  sembrarTabla_(db, 'CAT_AREAS', COLUMNAS.CAT_AREAS, [['AREA-1', 'Contabilidad', '', true]]);
  agregarFila_(db, 'JEFATURAS', jefatura({ jefatura_id: 'JEF-marcelo' }));
  return db;
}
function diasAtras(n) { return new Date(Date.now() - n * 24 * 3600 * 1000).toISOString(); }
function diasAdelante(n) { return new Date(Date.now() + n * 24 * 3600 * 1000).toISOString(); }
function crearGer(db, over) {
  return A.crear(db, Object.assign({ titulo: 'Actividad', fecha_compromiso: diasAdelante(10), area_id: 'AREA-1', prioridad: 'P3' }, over), CTX_MARCELO);
}
function pdfValido_(base64) {
  return Buffer.from(base64, 'base64').slice(0, 4).toString('ascii') === '%PDF';
}

test('descargarReporte: tipo invalido devuelve _validationError (nunca dibuja un PDF)', async () => {
  const db = db_();
  const res = await Reporte.descargarReporte(db, { tipo: 'raro' }, CTX_ADM);
  assert.equal(res._validationError, true);
});

test('descargarReporte estado_actual: PDF valido con el nombre de archivo esperado', async () => {
  const db = db_();
  crearGer(db, { titulo: 'Uno' });
  crearGer(db, { titulo: 'Dos' });

  const res = await Reporte.descargarReporte(db, { tipo: 'estado_actual' }, CTX_ADM);

  assert.ok(!res._validationError, JSON.stringify(res));
  assert.ok(pdfValido_(res.pdf_base64));
  assert.match(res.filename, /^SIGSO-reporte-estado_actual-\d{4}-\d{2}-\d{2}\.pdf$/);
});

test('descargarReporte cumplimiento_periodo: PDF valido con datos reales (resumen no vacio)', async () => {
  const db = db_();
  const at = crearGer(db, { titulo: 'A tiempo', fecha_compromiso: diasAtras(1) });
  actualizarFilaPorId_(db, 'ACTIVIDADES', 'actividad_id', at.actividad_id, { estado: 'TERMINADA', fecha_terminada: diasAtras(2) });
  crearGer(db, { titulo: 'Vencida', fecha_compromiso: diasAtras(3) });

  const res = await Reporte.descargarReporte(db, { tipo: 'cumplimiento_periodo', desde: diasAtras(30), hasta: new Date().toISOString() }, CTX_ADM);

  assert.ok(pdfValido_(res.pdf_base64));
});

test('descargarReporte carga_capacidad: PDF valido', async () => {
  const db = db_();
  crearGer(db, { titulo: 'Plan' });
  crearGer(db, { titulo: 'Emerg', origen: 'EMERGENTE' });

  const res = await Reporte.descargarReporte(db, { tipo: 'carga_capacidad', desde: diasAtras(30), hasta: new Date().toISOString() }, CTX_ADM);

  assert.ok(pdfValido_(res.pdf_base64));
});

test('descargarReporte sin filas: no rompe, genera igual el PDF (rama "sin datos")', async () => {
  const db = db_();
  const res = await Reporte.descargarReporte(db, { tipo: 'estado_actual' }, CTX_ADM);
  assert.ok(!res._validationError);
  assert.ok(pdfValido_(res.pdf_base64));
});

test('descargarActa: PDF valido con el nombre de archivo esperado, con y sin datos', async () => {
  const db = db_();
  crearGer(db, { titulo: 'Vencio', fecha_compromiso: diasAtras(2) });
  const b = crearGer(db, { titulo: 'Bloqueada' });
  actualizarFilaPorId_(db, 'ACTIVIDADES', 'actividad_id', b.actividad_id, { estado: 'BLOQUEADA', bloqueo_motivo: 'Esperando' });

  const res = await Reporte.descargarActa(db, {}, CTX_ADM);

  assert.ok(pdfValido_(res.pdf_base64));
  assert.match(res.filename, /^SIGSO-acta-reunion-\d{4}-\d{2}-\d{2}\.pdf$/);

  // Sin actividades en ninguna categoria -- las 4 secciones caen en la
  // rama "Nada que reportar", no debe romper el render.
  const dbVacia = db_();
  const resVacia = await Reporte.descargarActa(dbVacia, {}, CTX_ADM);
  assert.ok(pdfValido_(resVacia.pdf_base64));
});
