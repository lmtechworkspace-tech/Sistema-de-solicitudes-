'use strict';

/**
 * Prueba de portabilidad: la parte PDF de MatrizCobertura.gs
 * (descargarEvidencia), corrida contra evidenciaClausulaSgc.js. La lógica
 * de datos (getDetalle) ya está probada en
 * matriz-cobertura-sgc-porteo.test.js -- aquí solo se prueba que el PDF se
 * genere correctamente y que el guardia de acceso/validación se respete.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('../logica/calidadSgc');
const Evidencia = require('../logica/evidenciaClausulaSgc');

const TABLAS = [
  'SGC_DOCUMENTOS', 'SGC_DOC_VERSIONES', 'SGC_DOC_DESTINATARIOS', 'SGC_DOC_ACUSES', 'SGC_ROLES',
  'SGC_NC', 'SGC_AUDITORIAS', 'SGC_AUD_HALLAZGOS', 'SGC_PROVEEDORES', 'SGC_PROVEEDOR_EVALUACIONES',
  'SGC_REVISIONES', 'SGC_REVISION_ACUERDOS', 'SGC_OBJETIVOS', 'SGC_INDICADOR_LECTURAS',
  'SGC_PERSONAS', 'SGC_DESCRIPTORES', 'SGC_EVALUACIONES', 'SGC_INDUCCIONES',
  'SGC_CAPACITACIONES', 'SGC_CAPACITACION_ASISTENTES', 'SGC_PERSONA_DOCUMENTOS',
  'NOVEDADES', 'ACTIVIDADES', 'ACTIVIDADES_BITACORA', 'JEFATURAS', 'CONFIG_FERIADOS', 'SGC_COBERTURA_HISTORICO',
  'LOG_SISTEMA', 'LOG_NOTIFICACIONES', 'NOTIFICACIONES_APP', 'CONFIG_NOTIFICACIONES', 'CAT_AREAS'
];
function db_() {
  const db = abrirDb_();
  TABLAS.forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}

const CTX_ENCARGADO = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const CTX_OPERATIVO = { email: 'operativo@homepymes.cl', nombre: 'Operativo', rol: 'DEV' };
const CTX_ADM = { email: 'admin@homepymes.cl', nombre: 'Admin', rol: 'ADM' };

function sembrarRoles(db) {
  Calidad.gestionarRol(db, { usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADM);
  Calidad.gestionarRol(db, { usuario_email: 'operativo@homepymes.cl', rol_sgc: 'OPERATIVO' }, CTX_ADM);
}
function pdfValido_(base64) {
  return Buffer.from(base64, 'base64').slice(0, 4).toString('ascii') === '%PDF';
}
function ncBase_(id) {
  return { nc_id: id, activa: true, origen: 'INTERNA', tipo: 'NO_CONFORMIDAD', estado: 'ABIERTA', fecha_deteccion: '2026-01-01T00:00:00.000Z' };
}

test('descargarEvidencia: codigo invalido devuelve _validationError (nunca dibuja un PDF)', async () => {
  const db = db_();
  sembrarRoles(db);
  const res = await Evidencia.descargarEvidencia(db, { codigo: 'no-existe' }, CTX_ENCARGADO);
  assert.equal(res._validationError, true);
});

test('descargarEvidencia: sin acceso al SGC devuelve _forbidden (nunca dibuja un PDF)', async () => {
  const db = db_();
  sembrarRoles(db);
  const res = await Evidencia.descargarEvidencia(db, { codigo: '10.2' }, { rol: 'DEV', email: 'nadie@x.cl' });
  assert.equal(res._forbidden, true);
});

test('descargarEvidencia: clausula FALTANTE (sin NC) genera un PDF real con el nombre correcto', async () => {
  const db = db_();
  sembrarRoles(db);

  const res = await Evidencia.descargarEvidencia(db, { codigo: '10.2' }, CTX_ENCARGADO);

  assert.ok(!res._validationError, JSON.stringify(res));
  assert.ok(pdfValido_(res.pdf_base64));
  assert.equal(res.filename, 'SIGSO-Evidencia-10.2.pdf');
});

test('descargarEvidencia: clausula con evidencia real (NC cerrada y eficaz) tambien genera un PDF valido', async () => {
  const db = db_();
  sembrarRoles(db);
  agregarFila_(db, 'SGC_NC', Object.assign(ncBase_('NC-1'), {
    descripcion: 'Entrega tardía a cliente', estado: 'CERRADA', responsable_email: 'sgc@homepymes.cl', eficacia_resultado: 'EFICAZ'
  }));

  const res = await Evidencia.descargarEvidencia(db, { codigo: '10.2' }, CTX_ENCARGADO);

  assert.ok(pdfValido_(res.pdf_base64));
});
