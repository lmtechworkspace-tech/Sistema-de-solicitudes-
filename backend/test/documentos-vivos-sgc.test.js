'use strict';

/**
 * Documentos del SGC escritos en SIGSO (documentosVivosSgc.js, 2026-09-29):
 * marcado del texto, versión vigente vs borrador, publicación de versión nueva,
 * documentos armados con los datos del módulo y el control documental (un
 * documento con texto en SIGSO ya tiene copia controlada).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('../logica/calidadSgc');
const DV = require('../logica/documentosVivosSgc');

const TABLAS = ['SGC_DOCUMENTOS', 'SGC_DOC_VERSIONES', 'SGC_DOC_DESTINATARIOS', 'SGC_ROLES', 'SGC_DOC_ACUSES',
  'LOG_SISTEMA', 'SGC_CONTEXTO', 'SGC_PARTES_INTERESADAS', 'SGC_RIESGOS', 'SGC_PROCESOS', 'SGC_PROCESO_PASOS',
  'SGC_OBJETIVOS', 'SGC_PROVEEDORES', 'CAT_AREAS', 'USUARIOS', 'CUENTAS_PORTAL', 'JEFATURAS'];
const ADM = { email: 'adm@x.cl', rol: 'ADM' };
const OPERATIVO = { email: 'op@x.cl', rol: 'OPERATIVO' };

function db_() {
  const db = abrirDb_();
  TABLAS.forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
function doc_(db, o) {
  const d = Object.assign({
    documento_id: 'D' + Math.random().toString(36).slice(2, 8), codigo: 'PRO-09', nombre: 'Procedimiento de prueba', descripcion: '',
    tipo: 'PRO', area_id: 'CALIDAD', version_vigente: 'v01', estado: 'VIGENTE', visibilidad: 'TODOS',
    fecha_vigencia: '2026-06-01T00:00:00.000Z', proxima_revision: '2027-06-01T00:00:00.000Z',
    elaborado_por: 'Responsable del SGC', revisado_por: 'Encargada de administración', aprobado_por: 'Encargada de administración',
    archivo_id: '', archivo_nombre: '', archivo_mime: '', creado_por: 'adm@x.cl', fecha_creacion: '2026-06-01T00:00:00.000Z', activa: true,
    requiere_acuse: false, fecha_limite_acuse: '', clausulas_iso: '[]', emisor: '', clase_externa: '', enlaces: '[]',
    fecha_aprobacion: '', contenido: '', contenido_borrador: '', contenido_fuente: '', enlace_drive: ''
  }, o || {});
  agregarFila_(db, 'SGC_DOCUMENTOS', d);
  return d;
}
const CONTENIDO = {
  secciones: [
    { titulo: 'OBJETIVO', texto: 'Establecer la metodología.' },
    { titulo: 'DESCRIPCIÓN DEL PROCEDIMIENTO', texto: '### 6.1 Recepción\nPárrafo uno\ncontinúa.\n\n- viñeta a\n- viñeta b\n\na) opción\nb) otra\n\n| Col 1 | Col 2 |\n|---|---|\n| x | **y** |' }
  ],
  control_cambios: [{ version: '01', fecha: 'Junio 2026', descripcion: 'Primera edición' }]
};

test('textoAHtml_: párrafos, viñetas, listas con marca, subtítulos, tablas y negrita; nunca HTML crudo', () => {
  const h = DV.textoAHtml_(CONTENIDO.secciones[1].texto + '\n\n<script>alert(1)</script>');
  assert.match(h, /<h3>6\.1 Recepción<\/h3>/);
  assert.match(h, /<p>Párrafo uno<br>continúa\.<\/p>/);
  assert.match(h, /<ul><li>viñeta a<\/li><li>viñeta b<\/li><\/ul>/);
  assert.match(h, /<span class="marca">a\)<\/span> opción/);
  assert.match(h, /<th>Col 1<\/th>/);
  assert.match(h, /<td><b>y<\/b><\/td>/);
  assert.doesNotMatch(h, /<script>/);
  assert.match(h, /&lt;script&gt;/);
});

test('guardar sin confirmaciones corrige la versión vigente en el lugar y queda copia en el historial', () => {
  const db = db_();
  const d = doc_(db);
  const r = DV.guardarContenido(db, { documento_id: d.documento_id, contenido: CONTENIDO, enlace_drive: 'https://docs.google.com/document/d/abc/edit' }, ADM);
  assert.equal(r.modo, 'vigente');
  const fila = filas(db, 'SGC_DOCUMENTOS').find((x) => x.documento_id === d.documento_id);
  assert.equal(JSON.parse(fila.contenido).secciones.length, 2);
  assert.equal(fila.enlace_drive, 'https://docs.google.com/document/d/abc/edit');
  const v = filas(db, 'SGC_DOC_VERSIONES').filter((x) => x.documento_id === d.documento_id);
  assert.equal(v.length, 1);
  assert.equal(JSON.parse(v[0].contenido).secciones[0].titulo, 'OBJETIVO');
  // Ahora el documento tiene copia controlada (el texto en SIGSO).
  assert.equal(Calidad.escritoEnSigso_(fila), true);
  assert.ok(Calidad.alertasControlSgc_(fila).indexOf('sin_copia') === -1);
});

test('con la versión vigente ya confirmada, lo editado queda como borrador y se publica como versión nueva', () => {
  const db = db_();
  const d = doc_(db, { contenido: JSON.stringify(CONTENIDO) });
  agregarFila_(db, 'SGC_DOC_ACUSES', { acuse_id: 'A1', documento_id: d.documento_id, version: 'v01', usuario_email: 'op@x.cl', acusado_en: '2026-07-01' });
  const nuevo = JSON.parse(JSON.stringify(CONTENIDO));
  nuevo.secciones[0].texto = 'Texto corregido.';
  const r = DV.guardarContenido(db, { documento_id: d.documento_id, contenido: nuevo }, ADM);
  assert.equal(r.modo, 'borrador');
  let fila = filas(db, 'SGC_DOCUMENTOS').find((x) => x.documento_id === d.documento_id);
  assert.equal(JSON.parse(fila.contenido).secciones[0].texto, 'Establecer la metodología.');
  assert.equal(JSON.parse(fila.contenido_borrador).secciones[0].texto, 'Texto corregido.');

  assert.equal(DV.publicarBorrador(db, { documento_id: d.documento_id, version: 'v01', cambios: 'x' }, ADM).campo, 'version');
  assert.equal(DV.publicarBorrador(db, { documento_id: d.documento_id, version: 'v02' }, ADM).campo, 'cambios');
  const p = DV.publicarBorrador(db, { documento_id: d.documento_id, version: 'v02', cambios: 'Se corrige el objetivo', fecha_vigencia: '2026-09-29T00:00:00.000Z' }, ADM);
  assert.equal(p.version, 'v02');
  fila = filas(db, 'SGC_DOCUMENTOS').find((x) => x.documento_id === d.documento_id);
  assert.equal(fila.version_vigente, 'v02');
  assert.equal(fila.contenido_borrador, '');
  const c = JSON.parse(fila.contenido);
  assert.equal(c.secciones[0].texto, 'Texto corregido.');
  assert.deepEqual(c.control_cambios.map((x) => x.version), ['01', '02']);
  const vs = filas(db, 'SGC_DOC_VERSIONES').filter((x) => x.documento_id === d.documento_id);
  assert.equal(vs.filter((x) => x.vigente === true || x.vigente === 'TRUE').length, 1);
});

test('solo quien gobierna el SGC edita; un externo no se redacta; el enlace debe ser de Google', () => {
  const db = db_();
  const d = doc_(db);
  assert.equal(DV.guardarContenido(db, { documento_id: d.documento_id, contenido: CONTENIDO }, OPERATIVO)._forbidden, true);
  const ext = doc_(db, { codigo: 'ISO 9001:2015', tipo: 'EXTERNO' });
  assert.equal(DV.guardarContenido(db, { documento_id: ext.documento_id, contenido: CONTENIDO }, ADM)._validationError, true);
  assert.equal(DV.guardarContenido(db, { documento_id: d.documento_id, enlace_drive: 'https://ejemplo.com/x' }, ADM).campo, 'enlace_drive');
});

test('getContenido: documento con texto, plantilla para uno vacío y portada con firmas en un procedimiento', () => {
  const db = db_();
  const vacio = doc_(db);
  const g0 = DV.getContenido(db, { documento_id: vacio.documento_id }, ADM);
  assert.equal(g0.tiene_contenido, false);
  assert.deepEqual(g0.plantilla.secciones.map((s) => s.titulo), DV.SECCIONES_PROCEDIMIENTO);
  const con = doc_(db, { codigo: 'PRO-08', contenido: JSON.stringify(CONTENIDO) });
  const g = DV.getContenido(db, { documento_id: con.documento_id }, ADM);
  assert.equal(g.tiene_contenido, true);
  assert.match(g.html, /class="portada"/);
  assert.match(g.html, /1\. OBJETIVO/);
  assert.match(g.html, /3\. CONTROL DE CAMBIOS/);
  assert.match(g.cabecera, /PROCEDIMIENTO/);
  assert.match(g.cabecera, /Versión: <b>01<\/b>/);
});

test('documentos armados con datos: FODA desde Contexto y DOC-10 desde los procesos de servicio', () => {
  const db = db_();
  [['FORTALEZA', 1, 'Servicio integral'], ['AMENAZA', 5, 'Cambio climático']].forEach(([tipo, n, t], i) => agregarFila_(db, 'SGC_CONTEXTO', {
    factor_id: 'F' + i, tipo, origen: tipo === 'AMENAZA' ? 'EXTERNO' : 'INTERNO', numero: n, descripcion: t, estado: 'VIGENTE', observaciones: '',
    fecha_identificacion: '2026-06-01', fecha_ultima_revision: '2026-09-01', revisado_por: '', creado_por: '', fecha_creacion: '', activa: true
  }));
  const foda = doc_(db, { codigo: 'DOC-02', tipo: 'DOC', nombre: 'Análisis FODA' });
  const g = DV.getContenido(db, { documento_id: foda.documento_id }, ADM);
  assert.equal(g.fuente, 'FODA');
  assert.equal(g.tiene_contenido, true);
  assert.match(g.html, /Cambio climático/);
  assert.match(g.html, /FORTALEZAS \(INTERNO\)/);
  assert.equal(Calidad.escritoEnSigso_(foda), true);

  agregarFila_(db, 'SGC_PROCESOS', { proceso_id: 'S1', codigo: 'SRV-CON-01', nombre: 'Facturas', tipo: 'OPERATIVO', nivel: 'SERVICIO', proceso_padre_id: 'PO-04',
    area: 'Contabilidad', objetivo: '', alcance: '', responsable_email: '', entradas: '', actividades: '', salidas: '', clientes: '', proveedores: '', recursos: '',
    documentos: 'DOC-10', clausulas_iso: '', estado: 'VIGENTE', observaciones: '', fecha_ultima_revision: '', revisado_por: '', creado_por: '', fecha_creacion: '', activa: true });
  agregarFila_(db, 'SGC_PROCESO_PASOS', { paso_id: 'P1', proceso_id: 'S1', numero: 1, nombre: 'Recepción de solicitud', responsable: 'Asistente de Contabilidad',
    input: 'Orden de compra', actividades: 'Recibir solicitud', evidencias: 'Correo', output: 'Solicitud recibida', observaciones: '', creado_por: '', fecha_creacion: '', activa: true });
  const d10 = doc_(db, { codigo: 'DOC-10', tipo: 'DOC', nombre: 'Documentos servicios a clientes Contabilidad' });
  const g10 = DV.getContenido(db, { documento_id: d10.documento_id }, ADM);
  assert.equal(g10.fuente, 'SERVICIOS');
  assert.match(g10.html, /<h2>Facturas<\/h2>/);
  assert.match(g10.html, /Asistente de Contabilidad/);

  // "TEXTO" fuerza a escribirlo a mano aunque el código tenga fuente de datos.
  const texto = doc_(db, { codigo: 'DOC-03', tipo: 'DOC', nombre: 'Mapa', contenido_fuente: 'TEXTO' });
  assert.equal(DV.getContenido(db, { documento_id: texto.documento_id }, ADM).fuente, '');
});
