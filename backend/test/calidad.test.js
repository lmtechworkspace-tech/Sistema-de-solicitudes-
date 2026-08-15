'use strict';

// v10.0 (documentacion/SIGSO-v10.0-propuesta-modulo-sgc-iso9001.md):
// modulo SGC ISO 9001, Fase 1 -- repositorio documental controlado.
//
// Lo que estos tests protegen, en orden de importancia para la norma:
//  1. QUE VE CADA QUIEN. El control de acceso a los documentos es un
//     requisito de ISO 9001, no una preferencia de producto: que una
//     persona vea un documento que no le corresponde -- o peor, uno
//     OBSOLETO -- es un hallazgo de auditoria.
//  2. Que un documento obsoleto se archive y NO se borre (trazabilidad).
//  3. Que el codigo (DOC-01, PRO-07...) sea unico: es la identidad del
//     documento en el listado maestro.
//  4. Que solo se acepten formatos reales, validados por bytes.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'raiz' } });
  seedSheet(ctx, 'SGC_DOCUMENTOS', ctx.COLUMNAS.SGC_DOCUMENTOS);
  seedSheet(ctx, 'SGC_DOC_VERSIONES', ctx.COLUMNAS.SGC_DOC_VERSIONES);
  seedSheet(ctx, 'SGC_DOC_DESTINATARIOS', ctx.COLUMNAS.SGC_DOC_DESTINATARIOS);
  seedSheet(ctx, 'SGC_ROLES', ctx.COLUMNAS.SGC_ROLES);
  seedSheet(ctx, 'LOG_SISTEMA', ctx.COLUMNAS.LOG_SISTEMA);
  return ctx;
}

// Contextos. Ojo: el rol de SIGSO y el rol del SGC son cosas distintas --
// esa separacion es justamente la decision de diseño (no se crean roles
// globales nuevos), asi que conviene probarla con roles base variados.
const CTX_ENCARGADO = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const CTX_DIRECTOR = { email: 'director@homepymes.cl', nombre: 'Director', rol: 'DEV' };
const CTX_PREVENCION = { email: 'prevencion@homepymes.cl', nombre: 'Prevencionista', rol: 'DEV' };
const CTX_CONTABILIDAD = { email: 'conta@homepymes.cl', nombre: 'Analista Contab.', rol: 'DEV' };
const CTX_AUDITOR = { email: 'auditor@externo.cl', nombre: 'Auditor', rol: 'DEV' };
const CTX_ADM = { email: 'admin@homepymes.cl', nombre: 'Admin', rol: 'ADM' };

// PDF minimo valido: la validacion es por BYTES (%PDF), no por extension.
const PDF_B64 = Buffer.from('%PDF-1.4 contenido de prueba').toString('base64');
const DOCX_B64 = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00]).toString('base64');
const XLSX_B64 = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x99, 0x01]).toString('base64');
const BASURA_B64 = Buffer.from('esto no es un documento').toString('base64');

function sembrarRoles(ctx) {
  ctx.Calidad.gestionarRol({ usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADM);
  ctx.Calidad.gestionarRol({ usuario_email: 'director@homepymes.cl', rol_sgc: 'DIRECCION' }, CTX_ADM);
  ctx.Calidad.gestionarRol({ usuario_email: 'prevencion@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'PREVENCION' }, CTX_ADM);
  ctx.Calidad.gestionarRol({ usuario_email: 'conta@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'CONTABILIDAD' }, CTX_ADM);
}

function crearDoc(ctx, overrides, contexto) {
  return ctx.Calidad.crearDocumento(Object.assign({
    codigo: 'DOC-01', nombre: 'Manual de Calidad', tipo: 'DOC', visibilidad: 'TODOS',
    nombre_archivo: 'manual.pdf', contenido_base64: PDF_B64
  }, overrides), contexto || CTX_ENCARGADO);
}

// --- carga y control de versiones -----------------------------------------

test('crearDocumento: exige codigo, nombre, tipo y visibilidad validos', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);

  assert.equal(crearDoc(ctx, { codigo: '' })._validationError, true);
  assert.equal(crearDoc(ctx, { nombre: '' })._validationError, true);
  assert.equal(crearDoc(ctx, { tipo: 'INVENTADO' })._validationError, true);
  assert.equal(crearDoc(ctx, { visibilidad: 'CUALQUIERA' })._validationError, true);

  const doc = crearDoc(ctx);
  assert.equal(doc.codigo, 'DOC-01');
  assert.equal(doc.estado, 'VIGENTE');
  assert.equal(doc.version_vigente, 'v01');
  assert.ok(doc.archivo_id, 'debe quedar el archivo en Drive');
});

test('crearDocumento: el codigo es unico -- es la identidad en el listado maestro', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  crearDoc(ctx);
  const duplicado = crearDoc(ctx, { nombre: 'Otro documento con el mismo codigo' });
  assert.equal(duplicado._validationError, true);
});

test('crearDocumento: solo el Encargado SGC (o ADM) puede cargar; el personal no', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  assert.equal(crearDoc(ctx, {}, CTX_PREVENCION)._forbidden, true);
  assert.equal(crearDoc(ctx, { codigo: 'DOC-02' }, CTX_ADM).codigo, 'DOC-02');
});

test('archivos: acepta PDF, Word y Excel validados por BYTES; rechaza cualquier otra cosa', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);

  assert.equal(crearDoc(ctx, { codigo: 'PRO-01', nombre_archivo: 'p.pdf', contenido_base64: PDF_B64 }).archivo_mime, 'application/pdf');
  assert.equal(
    crearDoc(ctx, { codigo: 'PRO-02', nombre_archivo: 'p.docx', contenido_base64: DOCX_B64 }).archivo_mime,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
  assert.equal(
    crearDoc(ctx, { codigo: 'PRO-03', nombre_archivo: 'p.xlsx', contenido_base64: XLSX_B64 }).archivo_mime,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );

  const basura = crearDoc(ctx, { codigo: 'PRO-04', nombre_archivo: 'virus.pdf', contenido_base64: BASURA_B64 });
  assert.equal(basura._validationError, true, 'renombrar a .pdf no debe alcanzar: se valida el contenido');
});

test('nuevaVersion: la anterior se archiva (no se borra) y la vigente pasa a ser la nueva', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const doc = crearDoc(ctx);

  const actualizado = ctx.Calidad.nuevaVersion({
    documento_id: doc.documento_id, version: 'v02', cambios: 'Se actualizo el alcance.',
    nombre_archivo: 'manual-v2.pdf', contenido_base64: PDF_B64
  }, CTX_ENCARGADO);
  assert.equal(actualizado.version_vigente, 'v02');

  const versiones = ctx.leerFilas_('SGC_DOC_VERSIONES').filter((v) => v.documento_id === doc.documento_id);
  assert.equal(versiones.length, 2, 'la version anterior debe conservarse para trazabilidad');
  const vigentes = versiones.filter((v) => v.vigente === true || v.vigente === 'TRUE');
  assert.equal(vigentes.length, 1);
  assert.equal(vigentes[0].version, 'v02');

  // Repetir la version vigente no tiene sentido y se rechaza.
  assert.equal(ctx.Calidad.nuevaVersion({
    documento_id: doc.documento_id, version: 'v02', nombre_archivo: 'x.pdf', contenido_base64: PDF_B64
  }, CTX_ENCARGADO)._validationError, true);
});

test('proxima_revision se calcula a 12 meses de la vigencia (PRO-01), no se pide a mano', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const doc = crearDoc(ctx, { fecha_vigencia: '2026-06-01T00:00:00.000Z' });
  assert.equal(new Date(doc.proxima_revision).getUTCFullYear(), 2027);
  assert.equal(new Date(doc.proxima_revision).getUTCMonth(), 5); // junio
});

// --- control de acceso: el corazon del modulo ------------------------------

test('visibilidad TODOS: lo ve cualquier persona del SGC', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  crearDoc(ctx, { codigo: 'DOC-06', nombre: 'Política de Calidad', visibilidad: 'TODOS' });

  [CTX_PREVENCION, CTX_CONTABILIDAD, CTX_DIRECTOR].forEach((quien) => {
    const r = ctx.Calidad.listarDocumentos({}, quien);
    assert.equal(r.documentos.length, 1, 'todos deben ver un documento de acceso general');
  });
});

test('visibilidad AREA: solo lo ve quien pertenece a esa area', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  crearDoc(ctx, { codigo: 'PRO-12', nombre: 'Procedimiento de Prevención', visibilidad: 'AREA', area_id: 'PREVENCION' });

  assert.equal(ctx.Calidad.listarDocumentos({}, CTX_PREVENCION).documentos.length, 1);
  assert.equal(ctx.Calidad.listarDocumentos({}, CTX_CONTABILIDAD).documentos.length, 0,
    'contabilidad no debe ver un procedimiento de prevencion');
});

test('visibilidad SELECCION: solo lo ven las personas indicadas', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  crearDoc(ctx, {
    codigo: 'FO-PRO-02-01', nombre: 'Descriptor de Cargo', visibilidad: 'SELECCION',
    destinatarios: ['conta@homepymes.cl']
  });

  assert.equal(ctx.Calidad.listarDocumentos({}, CTX_CONTABILIDAD).documentos.length, 1);
  assert.equal(ctx.Calidad.listarDocumentos({}, CTX_PREVENCION).documentos.length, 0);
});

test('un documento OBSOLETO se retira de circulacion para el personal, pero el SGC lo conserva', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const doc = crearDoc(ctx, { codigo: 'PRO-09', nombre: 'Procedimiento antiguo', visibilidad: 'TODOS' });

  assert.equal(ctx.Calidad.listarDocumentos({}, CTX_PREVENCION).documentos.length, 1);

  ctx.Calidad.actualizarDocumento({ documento_id: doc.documento_id, estado: 'OBSOLETO' }, CTX_ENCARGADO);

  assert.equal(ctx.Calidad.listarDocumentos({}, CTX_PREVENCION).documentos.length, 0,
    'el personal no debe poder toparse con una version que ya no rige');
  assert.equal(ctx.Calidad.listarDocumentos({}, CTX_ENCARGADO).documentos.length, 1,
    'el Encargado SGC si debe seguir viendolo');
  assert.equal(ctx.leerFilas_('SGC_DOCUMENTOS').length, 1, 'nunca se borra la fila (trazabilidad)');
});

test('Direccion y Gerencia ven todo el SGC; el personal operativo no', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  crearDoc(ctx, { codigo: 'PRO-20', visibilidad: 'AREA', area_id: 'CONTABILIDAD' });

  assert.equal(ctx.Calidad.listarDocumentos({}, CTX_DIRECTOR).documentos.length, 1);
  assert.equal(ctx.Calidad.listarDocumentos({}, { email: 'gerencia@homepymes.cl', rol: 'GERENCIA' }).documentos.length, 1);
  assert.equal(ctx.Calidad.listarDocumentos({}, CTX_PREVENCION).documentos.length, 0);
});

test('auditor externo: ve todo mientras su acceso este vigente, y deja de verlo al expirar', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  crearDoc(ctx, { codigo: 'PRO-30', visibilidad: 'AREA', area_id: 'CONTABILIDAD' });

  const enUnMes = new Date(Date.now() + 30 * 86400000).toISOString();
  ctx.Calidad.gestionarRol({
    usuario_email: 'auditor@externo.cl', rol_sgc: 'AUDITOR_EXTERNO', vigencia_hasta: enUnMes
  }, CTX_ADM);
  assert.equal(ctx.Calidad.listarDocumentos({}, CTX_AUDITOR).documentos.length, 1);

  // Vencido: el acceso temporal expira SOLO, sin depender de acordarse de
  // desactivarlo (§D de la propuesta v10.0).
  const ayer = new Date(Date.now() - 86400000).toISOString();
  ctx.Calidad.gestionarRol({
    usuario_email: 'auditor@externo.cl', rol_sgc: 'AUDITOR_EXTERNO', vigencia_hasta: ayer
  }, CTX_ADM);
  assert.equal(ctx.Calidad.listarDocumentos({}, CTX_AUDITOR).documentos.length, 0);
});

test('getDocumento y descargarDocumento respetan la misma visibilidad que el listado', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const doc = crearDoc(ctx, { codigo: 'PRO-40', visibilidad: 'AREA', area_id: 'CONTABILIDAD' });

  assert.equal(ctx.Calidad.getDocumento({ documento_id: doc.documento_id }, CTX_PREVENCION)._forbidden, true);
  assert.equal(ctx.Calidad.descargarDocumento({ documento_id: doc.documento_id }, CTX_PREVENCION)._forbidden, true,
    'esconder el boton no basta: el servidor debe rechazar la descarga');

  const bajada = ctx.Calidad.descargarDocumento({ documento_id: doc.documento_id }, CTX_CONTABILIDAD);
  assert.ok(bajada.contenido_base64);
  assert.equal(bajada.mime, 'application/pdf');
});

test('descargar una version ANTERIOR queda reservado a quien gobierna el SGC', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const doc = crearDoc(ctx, { visibilidad: 'TODOS' });
  ctx.Calidad.nuevaVersion({
    documento_id: doc.documento_id, version: 'v02', nombre_archivo: 'v2.pdf', contenido_base64: PDF_B64
  }, CTX_ENCARGADO);

  const anterior = ctx.leerFilas_('SGC_DOC_VERSIONES')
    .filter((v) => v.documento_id === doc.documento_id && v.version === 'v01')[0];

  assert.equal(ctx.Calidad.descargarDocumento({
    documento_id: doc.documento_id, version_id: anterior.version_id
  }, CTX_PREVENCION)._forbidden, true);

  assert.ok(ctx.Calidad.descargarDocumento({
    documento_id: doc.documento_id, version_id: anterior.version_id
  }, CTX_ENCARGADO).contenido_base64);
});

test('cambiar la visibilidad reescribe los destinatarios, sin dejar filas huerfanas', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const doc = crearDoc(ctx, { visibilidad: 'SELECCION', destinatarios: ['conta@homepymes.cl'] });
  assert.equal(ctx.Calidad.listarDocumentos({}, CTX_CONTABILIDAD).documentos.length, 1);

  ctx.Calidad.actualizarDocumento({
    documento_id: doc.documento_id, visibilidad: 'SELECCION', destinatarios: ['prevencion@homepymes.cl']
  }, CTX_ENCARGADO);

  assert.equal(ctx.Calidad.listarDocumentos({}, CTX_CONTABILIDAD).documentos.length, 0,
    'quien salio de la lista deja de verlo');
  assert.equal(ctx.Calidad.listarDocumentos({}, CTX_PREVENCION).documentos.length, 1);
});

test('la descarga queda registrada en LOG_SISTEMA (auditoria §15.2)', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const doc = crearDoc(ctx, { visibilidad: 'TODOS' });
  ctx.Calidad.descargarDocumento({ documento_id: doc.documento_id }, CTX_PREVENCION);

  const logs = ctx.leerFilas_('LOG_SISTEMA').filter((l) => l.contexto === 'SGC_DOC_DESCARGADO');
  assert.equal(logs.length, 1);
  assert.ok(logs[0].mensaje.indexOf('prevencion@homepymes.cl') !== -1);
});

test('listarDocumentos marca la revision vencida a los 12 meses', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  crearDoc(ctx, { codigo: 'DOC-99', fecha_vigencia: '2020-01-01T00:00:00.000Z', visibilidad: 'TODOS' });
  const fila = ctx.Calidad.listarDocumentos({}, CTX_ENCARGADO).documentos[0];
  assert.equal(fila.revision_vencida, true);
});

test('sin rol en SGC_ROLES la persona ve solo lo de acceso general (default seguro)', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  crearDoc(ctx, { codigo: 'DOC-A', visibilidad: 'TODOS' });
  crearDoc(ctx, { codigo: 'PRO-B', visibilidad: 'AREA', area_id: 'CONTABILIDAD' });

  const desconocido = { email: 'nadie@homepymes.cl', rol: 'DEV' };
  const r = ctx.Calidad.listarDocumentos({}, desconocido);
  assert.equal(r.documentos.length, 1);
  assert.equal(r.documentos[0].codigo, 'DOC-A');
  assert.equal(r.puede_gestionar, false);
  assert.equal(r.rol_sgc, 'OPERATIVO');
});
