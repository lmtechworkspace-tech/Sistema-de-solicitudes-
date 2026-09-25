'use strict';

/**
 * SIGSO v2, Módulo 8B — Control documental (ControlDocumentalSgc) y las
 * alertas por documento que expone listarDocumentosSgc.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('../logica/calidadSgc');
const Control = require('../logica/controlDocumentalSgc');

const ADM = { rol: 'ADM', email: 'admin@x.cl' };
const DEV = { rol: 'DEV', email: 'x@x.cl' };

function db_() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function doc(db, id, o) {
  agregarFila_(db, 'SGC_DOCUMENTOS', Object.assign({
    documento_id: id, codigo: id, nombre: 'Doc ' + id, tipo: 'PRO', estado: 'VIGENTE', version_vigente: 'v01',
    visibilidad: 'TODOS', activa: true, clausulas_iso: '[]', enlaces: '[]', proxima_revision: '2099-01-01',
    revisado_por: 'Ana', aprobado_por: 'Beto', archivo_id: 'sgc/x.pdf'
  }, o || {}));
}
function fila(db, id) { return leerFilas_(db, 'SGC_DOCUMENTOS', COLUMNAS.SGC_DOCUMENTOS).find((d) => d.documento_id === id); }

test('Alertas: sin aprobación, sin copia controlada, norma externa obsoleta y revisión próxima', () => {
  const db = db_();
  doc(db, 'OK');
  doc(db, 'SINAPR', { revisado_por: '', aprobado_por: '' });
  doc(db, 'ENLACE', { archivo_id: '', enlaces: JSON.stringify([{ titulo: '', url: 'https://docs.google.com/document/d/abc/edit?usp=sharing' }]) });
  doc(db, 'LEY', { tipo: 'EXTERNO', estado: 'OBSOLETO', revisado_por: '', aprobado_por: '', archivo_id: '' });
  doc(db, 'REV', { proxima_revision: new Date(Date.now() - 86400000 * 3).toISOString() });
  doc(db, 'OBS', { estado: 'OBSOLETO', revisado_por: '', archivo_id: '' });
  const r = Control.getControl(db, {}, ADM);
  const ids = (g) => r.grupos[g].map((x) => x.documento_id);
  assert.deepEqual(ids('sin_aprobacion'), ['SINAPR']);
  assert.deepEqual(ids('sin_copia'), ['ENLACE']);
  assert.equal(r.grupos.sin_copia[0].enlace_editable, true);
  assert.deepEqual(ids('externo_fuera'), ['LEY']);
  assert.deepEqual(ids('revision'), ['REV']);
  assert.ok(r.grupos.revision[0].dias < 0);
  assert.deepEqual(r.firmantes, ['Ana', 'Beto']);
  const lista = Calidad.listarDocumentos(db, {}, ADM).documentos;
  assert.deepEqual(lista.find((d) => d.documento_id === 'SINAPR').control, ['sin_aprobacion']);
  assert.deepEqual(lista.find((d) => d.documento_id === 'OK').control, []);
});

test('Solo quien gobierna ve el control; el personal no recibe alertas', () => {
  const db = db_();
  doc(db, 'SINAPR', { revisado_por: '' });
  assert.equal(Control.getControl(db, {}, DEV)._forbidden, true);
  const lista = Calidad.listarDocumentos(db, {}, DEV).documentos;
  lista.forEach((d) => assert.deepEqual(d.control, []));
});

test('Registrar revisión y aprobación en lote deja la fecha y limpia la alerta', async () => {
  const db = db_();
  doc(db, 'A', { revisado_por: '', aprobado_por: '' });
  doc(db, 'B', { revisado_por: '', aprobado_por: '' });
  const r = await Control.actualizarEnLote(db, { documento_ids: ['A', 'B'], cambios: { revisado_por: ' Ana ', aprobado_por: 'Rogelio Álvarez' } }, ADM);
  assert.equal(r.aplicados, 2);
  assert.equal(r.control.sin_aprobacion, 0);
  assert.equal(fila(db, 'A').revisado_por, 'Ana');
  assert.equal(fila(db, 'B').aprobado_por, 'Rogelio Álvarez');
  assert.ok(fila(db, 'A').fecha_aprobacion);
});

test('El lote valida: sin documentos, sin cambios, campos vacíos, campos no permitidos, permisos', async () => {
  const db = db_();
  doc(db, 'A', { revisado_por: '' });
  assert.equal((await Control.actualizarEnLote(db, { documento_ids: [], cambios: { revisado_por: 'Ana' } }, ADM))._validationError, true);
  assert.equal((await Control.actualizarEnLote(db, { documento_ids: ['A'], cambios: { nombre: 'Otro' } }, ADM))._validationError, true);
  assert.equal((await Control.actualizarEnLote(db, { documento_ids: ['A'], cambios: { revisado_por: '  ' } }, ADM))._validationError, true);
  assert.equal((await Control.actualizarEnLote(db, { documento_ids: ['A'], cambios: { revisado_por: 'Ana' } }, DEV))._forbidden, true);
  assert.equal(fila(db, 'A').nombre, 'Doc A');
});

test('Devolver a vigente las normas externas en lote', async () => {
  const db = db_();
  doc(db, 'LEY1', { tipo: 'EXTERNO', estado: 'OBSOLETO' });
  doc(db, 'LEY2', { tipo: 'EXTERNO', estado: 'OBSOLETO' });
  const r = await Control.actualizarEnLote(db, { documento_ids: ['LEY1', 'LEY2'], cambios: { estado: 'VIGENTE' } }, ADM);
  assert.equal(r.aplicados, 2);
  assert.equal(r.control.externo_fuera, 0);
  assert.equal(fila(db, 'LEY1').estado, 'VIGENTE');
});

test('Editar "Aprobado por" registra la fecha de aprobación', async () => {
  const db = db_();
  doc(db, 'A', { aprobado_por: '' });
  await Calidad.actualizarDocumento(db, { documento_id: 'A', aprobado_por: 'Beto' }, ADM);
  assert.ok(fila(db, 'A').fecha_aprobacion);
});
