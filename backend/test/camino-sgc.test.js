'use strict';

/**
 * SIGSO v2, Módulo 8A — Camino a la certificación (CaminoSgc): próximo paso
 * por cláusula y sugerencias de etiquetas ISO que el encargado confirma.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const CaminoSgc = require('../logica/caminoSgc');

const ADM = { rol: 'ADM', email: 'admin@x.cl' };

function db_() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function doc(db, id, codigo, nombre, clausulas) {
  agregarFila_(db, 'SGC_DOCUMENTOS', {
    documento_id: id, codigo: codigo, nombre: nombre, tipo: 'DOC', estado: 'VIGENTE', version_vigente: 'v01',
    visibilidad: 'TODOS', activa: true, clausulas_iso: JSON.stringify(clausulas || []), fecha_creacion: new Date().toISOString()
  });
}

test('Lo ve quien supervisa el SGC; solo quien lo gobierna recibe sugerencias', () => {
  const db = db_();
  doc(db, 'D1', 'DOC-06', 'Política de Calidad');
  assert.equal(CaminoSgc.getCamino(db, {}, { rol: 'DEV', email: 'x@x.cl' })._forbidden, true);
  assert.ok(CaminoSgc.getCamino(db, {}, ADM).clausulas.length >= 28);
  assert.equal(CaminoSgc.getCamino(db, {}, ADM).sugerencias.length, 1);
  const ger = CaminoSgc.getCamino(db, {}, { rol: 'GERENCIA', email: 'g@x.cl' });
  assert.equal(ger.puede_etiquetar, false);
  assert.deepEqual(ger.sugerencias, []);
});

test('Cada cláusula trae su próximo paso y la sección que lo resuelve', () => {
  const r = CaminoSgc.getCamino(db_(), {}, ADM);
  const c92 = r.clausulas.find((c) => c.codigo === '9.2');
  assert.equal(c92.seccion, 'auditorias');
  assert.ok(c92.paso.length > 10);
  assert.equal(r.capitulos.length, 7);
});

test('Sugiere etiquetas por el nombre del documento sin falsos positivos', () => {
  const db = db_();
  doc(db, 'D1', 'DOC-06', 'Política de Calidad');
  doc(db, 'D2', 'PRO-05', 'Procedimiento de revisión por la dirección');
  doc(db, 'D3', 'DOC-12', 'Documentos servicios a clientes — Prevención de riesgos');
  doc(db, 'D4', 'DOC-00', 'Misión y Visión');
  doc(db, 'D5', 'DOC-07', 'Objetivos de Calidad', ['6.2']);
  const s = CaminoSgc.getCamino(db, {}, ADM).sugerencias;
  const de = (c) => (s.find((x) => x.codigo === c) || { sugeridas: [] }).sugeridas;
  assert.deepEqual(de('DOC-06'), ['5.2']);
  assert.deepEqual(de('PRO-05'), ['9.3'], '"revisión" no es "visión"');
  assert.deepEqual(de('DOC-12'), ['8.2'], '"prevención de riesgos" no es la matriz de riesgos');
  assert.deepEqual(de('DOC-00'), ['5.1']);
  assert.deepEqual(de('DOC-07'), [], 'ya tenía su etiqueta');
});

test('Aplicar etiquetas suma a las existentes y sube la cobertura (5.2 pasa a completa)', async () => {
  const db = db_();
  doc(db, 'D1', 'DOC-06', 'Política de Calidad', ['7.5']);
  const antes = CaminoSgc.getCamino(db, {}, ADM).clausulas.find((c) => c.codigo === '5.2').estado;
  const r = await CaminoSgc.aplicarEtiquetas(db, { items: [{ documento_id: 'D1', clausulas: ['5.2'] }] }, ADM);
  assert.equal(r.aplicados, 1);
  const fila = leerFilas_(db, 'SGC_DOCUMENTOS', COLUMNAS.SGC_DOCUMENTOS)[0];
  assert.deepEqual(JSON.parse(fila.clausulas_iso).sort(), ['5.2', '7.5']);
  assert.equal(antes, 'FALTANTE');
  assert.equal(CaminoSgc.getCamino(db, {}, ADM).clausulas.find((c) => c.codigo === '5.2').estado, 'COMPLETO');
  assert.equal((await CaminoSgc.aplicarEtiquetas(db, { items: [{ documento_id: 'D1', clausulas: ['5.2'] }] }, { rol: 'DEV', email: 'x@x.cl' }))._forbidden, true);
});

test('Acuses por documento: quién falta, separando a quien no tiene cuenta activa', () => {
  const db = db_();
  doc(db, 'D1', 'DOC-06', 'Política de Calidad');
  const fila = leerFilas_(db, 'SGC_DOCUMENTOS', COLUMNAS.SGC_DOCUMENTOS)[0];
  const { actualizarFilaPorId_ } = require('../db/sqliteRepo');
  actualizarFilaPorId_(db, 'SGC_DOCUMENTOS', 'documento_id', fila.documento_id, { requiere_acuse: true });
  ['ana@x.cl', 'beto@x.cl', 'carla@x.cl'].forEach((e, i) => agregarFila_(db, 'SGC_ROLES', { rol_id: 'R' + i, usuario_email: e, rol_sgc: 'OPERATIVO', activo: true }));
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'C1', emails: JSON.stringify(['ana@x.cl']), activo: true, ultimo_acceso: '2026-09-01' });
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'C2', emails: JSON.stringify(['beto@x.cl']), activo: true, ultimo_acceso: '' });
  agregarFila_(db, 'SGC_DOC_ACUSES', { acuse_id: 'A1', documento_id: 'D1', version: 'v01', usuario_email: 'ana@x.cl', acusado_en: '2026-09-02' });
  const a = CaminoSgc.getCamino(db, {}, ADM).acuses[0];
  assert.equal(a.confirmados, 1);
  assert.deepEqual(a.pendientes, [{ email: 'beto@x.cl', nunca_entro: true }]);
  assert.deepEqual(a.sin_cuenta, ['carla@x.cl']);
});

test('El efecto de las sugerencias se simula sin tocar los datos', () => {
  const db = db_();
  doc(db, 'D1', 'DOC-06', 'Política de Calidad');
  const r = CaminoSgc.getCamino(db, {}, ADM);
  assert.ok(r.efecto_sugerencias.pct_listo > r.resumen.pct_listo);
  assert.ok(r.efecto_sugerencias.mejoran.some((m) => m.codigo === '5.2' && m.despues === 'COMPLETO'));
  const fila = leerFilas_(db, 'SGC_DOCUMENTOS', COLUMNAS.SGC_DOCUMENTOS)[0];
  assert.deepEqual(JSON.parse(fila.clausulas_iso), [], 'la simulación se revierte');
  assert.equal(CaminoSgc.getCamino(db, {}, ADM).resumen.pct_listo, r.resumen.pct_listo);
});

test('Plazo de acuse por día de Chile: ayer es "hace 1 día" a cualquier hora', () => {
  const db = db_();
  const Calidad = require('../logica/calidadSgc');
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
  const ayer = new Date(Date.UTC(+hoy.slice(0, 4), +hoy.slice(5, 7) - 1, +hoy.slice(8, 10) - 1)).toISOString().slice(0, 10);
  doc(db, 'D1', 'DOC-06', 'Política de Calidad');
  const { actualizarFilaPorId_ } = require('../db/sqliteRepo');
  actualizarFilaPorId_(db, 'SGC_DOCUMENTOS', 'documento_id', 'D1', { requiere_acuse: true, fecha_limite_acuse: ayer });
  assert.equal(Calidad.listarDocumentos(db, {}, ADM).documentos[0].dias_para_acuse, -1);
  actualizarFilaPorId_(db, 'SGC_DOCUMENTOS', 'documento_id', 'D1', { fecha_limite_acuse: ayer + 'T00:00:00.000Z' });
  assert.equal(Calidad.listarDocumentos(db, {}, ADM).documentos[0].dias_para_acuse, -1);
});
