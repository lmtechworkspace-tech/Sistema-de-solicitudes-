'use strict';

/**
 * Prueba de portabilidad: los mismos escenarios de
 * backend/test/comentarios.test.js (contra Comentarios.gs), corridos
 * contra backend/logica/comentarios.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Comentarios = require('../logica/comentarios');

function dbConSchema() {
  const db = abrirDb_();
  ['SOLICITUDES', 'COMENTARIOS'].forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function seedSolicitud(db) {
  agregarFila_(db, 'SOLICITUDES', { solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', estado_derivado: 'S02' });
}

test('agregarComentario escribe el comentario con el usuario del contexto', () => {
  const db = dbConSchema();
  seedSolicitud(db);

  const resultado = Comentarios.agregarComentario(db, { solicitud_id: 'SOL-2026-HP-0001', texto: 'Se revisó el caso' }, { email: 'analista@homepymes.cl', rol: 'ANA' });

  assert.equal(resultado.usuario, 'analista@homepymes.cl');
  assert.equal(resultado.es_interno, false);
  const comentarios = leerFilas_(db, 'COMENTARIOS', COLUMNAS.COMENTARIOS);
  assert.equal(comentarios.length, 1);
  assert.equal(comentarios[0].texto, 'Se revisó el caso');
});

test('agregarComentario acepta es_interno=true', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  const resultado = Comentarios.agregarComentario(db, { solicitud_id: 'SOL-2026-HP-0001', texto: 'Nota interna', es_interno: true }, { email: 'analista@homepymes.cl', rol: 'ANA' });
  assert.equal(resultado.es_interno, true);
});

test('agregarComentario rechaza texto vacío', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  const resultado = Comentarios.agregarComentario(db, { solicitud_id: 'SOL-2026-HP-0001', texto: '   ' }, { email: 'analista@homepymes.cl', rol: 'ANA' });
  assert.equal(resultado._validationError, true);
});

test('agregarComentario responde error de validación si la solicitud no existe', () => {
  const db = dbConSchema();
  const resultado = Comentarios.agregarComentario(db, { solicitud_id: 'SOL-2026-HP-9999', texto: 'texto' }, { email: 'analista@homepymes.cl', rol: 'ANA' });
  assert.equal(resultado._validationError, true);
});

// P6 (v2.0, Sprint 2): Gerencia es de solo lectura -- ni comentar.
test('agregarComentario rechaza al rol GERENCIA (solo lectura, P6)', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  const resultado = Comentarios.agregarComentario(db, { solicitud_id: 'SOL-2026-HP-0001', texto: 'Intento de comentario' }, { email: 'gerente@homepymes.cl', rol: 'GERENCIA' });
  assert.equal(resultado._forbidden, true);
  assert.equal(leerFilas_(db, 'COMENTARIOS', COLUMNAS.COMENTARIOS).length, 0);
});
