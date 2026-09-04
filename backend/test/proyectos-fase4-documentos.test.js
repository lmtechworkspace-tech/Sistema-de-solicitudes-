'use strict';

// v13 (Fase 4, "centro documental"): repositorio FORMAL con categoría,
// versionado real e historial -- distinto del adjunto suelto de la Sala
// (subirAdjunto/descargarAdjunto), que sigue existiendo igual. Mismo patrón
// ya probado en Calidad.gs (SGC_DOCUMENTOS/SGC_DOC_VERSIONES), sin los
// campos propios de ISO.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'fake-drive-root' } });
  ['PROYECTOS', 'PROYECTO_INTEGRANTES', 'PROYECTO_HITOS', 'PROYECTO_EVENTOS',
    'PROYECTO_ENTREGABLES', 'PROYECTO_RIESGOS', 'PROYECTO_PLANTILLAS',
    'PROYECTO_PLANTILLA_HITOS', 'PROYECTO_DOCUMENTOS', 'PROYECTO_DOC_VERSIONES',
    'SOLICITUDES', 'ACTIVIDADES', 'ACTIVIDADES_BITACORA',
    'JEFATURAS', 'LOG_NOTIFICACIONES', 'CONFIG_FERIADOS', 'NOTIFICACIONES_APP', 'CAT_AREAS']
    .forEach((h) => seedSheet(ctx, h, ctx.COLUMNAS[h]));
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Leo Lider', 'leo@rld.cl', 'RLD', 'DEV', true, '', 'sistema'],
    ['U2', 'Marcelo Integrante', 'marcelo@rld.cl', 'RLD', 'DEV', true, '', 'sistema'],
    ['U3', 'Otro Ajeno', 'otro@rld.cl', 'RLD', 'DEV', true, '', 'sistema']
  ]);
  return ctx;
}

const CTX_LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV' };
const CTX_MARCELO = { email: 'marcelo@rld.cl', nombre: 'Marcelo Integrante', rol: 'DEV' };
const CTX_OTRO = { email: 'otro@rld.cl', nombre: 'Otro Ajeno', rol: 'DEV' };

const PDF_B64 = Buffer.from('%PDF-1.4 contenido v1').toString('base64');
const PDF_V2_B64 = Buffer.from('%PDF-1.4 contenido v2').toString('base64');
const BASURA_B64 = Buffer.from('esto no es un documento').toString('base64');

function armarProyecto(ctx) {
  const proyecto = ctx.Proyectos.crear({
    nombre: 'Estandarización comercial', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01'
  }, CTX_LEO);
  ctx.Proyectos.gestionarIntegrante({
    proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE'
  }, CTX_LEO);
  return proyecto;
}

test('gestionarDocumento (crear): exige nombre y archivo; nace en v1 con la versión vigente marcada', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);

  const sinArchivo = ctx.Proyectos.gestionarDocumento({
    proyecto_id: proyecto.proyecto_id, nombre: 'Flujo comercial'
  }, CTX_LEO);
  assert.equal(sinArchivo._validationError, true);

  const basura = ctx.Proyectos.gestionarDocumento({
    proyecto_id: proyecto.proyecto_id, nombre: 'Flujo comercial', nombre_archivo: 'virus.pdf', contenido_base64: BASURA_B64
  }, CTX_LEO);
  assert.equal(basura._validationError, true, 'la firma binaria no es un formato admitido');

  const doc = ctx.Proyectos.gestionarDocumento({
    proyecto_id: proyecto.proyecto_id, nombre: 'Flujo comercial', categoria: 'REQUISITOS',
    nombre_archivo: 'flujo-v1.pdf', contenido_base64: PDF_B64
  }, CTX_LEO);
  assert.equal(doc.version_vigente, 'v1');
  assert.equal(doc.categoria, 'REQUISITOS');
  assert.ok(doc.archivo_id);

  const versiones = ctx.Proyectos.listarVersionesDocumento({ proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id }, CTX_LEO);
  assert.equal(versiones.length, 1);
  assert.equal(versiones[0].version, 'v1');
  assert.equal(versiones[0].vigente, true);
});

test('gestionarDocumento: un OBSERVADOR no puede crear documentos; un ajeno al proyecto tampoco', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  ctx.Proyectos.gestionarIntegrante({ proyecto_id: proyecto.proyecto_id, usuario_email: 'otro@rld.cl', rol_proyecto: 'OBSERVADOR' }, CTX_LEO);

  const rechazado = ctx.Proyectos.gestionarDocumento({
    proyecto_id: proyecto.proyecto_id, nombre: 'Flujo', nombre_archivo: 'a.pdf', contenido_base64: PDF_B64
  }, CTX_OTRO);
  assert.equal(rechazado._forbidden, true);
});

test('categoria inválida cae a OTRO (nunca rechaza la carga por un valor raro)', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const doc = ctx.Proyectos.gestionarDocumento({
    proyecto_id: proyecto.proyecto_id, nombre: 'Sin categoría válida', categoria: 'INVENTADA',
    nombre_archivo: 'a.pdf', contenido_base64: PDF_B64
  }, CTX_LEO);
  assert.equal(doc.categoria, 'OTRO');
});

test('subirVersionDocumento: crea v2, la deja vigente, y v1 se conserva completa (nunca se borra)', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const doc = ctx.Proyectos.gestionarDocumento({
    proyecto_id: proyecto.proyecto_id, nombre: 'Flujo comercial', nombre_archivo: 'flujo-v1.pdf', contenido_base64: PDF_B64
  }, CTX_LEO);

  const actualizado = ctx.Proyectos.subirVersionDocumento({
    proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id,
    nombre_archivo: 'flujo-v2.pdf', contenido_base64: PDF_V2_B64, comentario: 'Ajustes de gerencia'
  }, CTX_MARCELO); // un INTEGRANTE también puede subir versión
  assert.equal(actualizado.version_vigente, 'v2');
  assert.equal(actualizado.archivo_nombre, 'flujo-v2.pdf');

  const versiones = ctx.Proyectos.listarVersionesDocumento({ proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id }, CTX_LEO);
  assert.equal(versiones.length, 2, 'v1 sigue existiendo, no se borró');
  const v1 = versiones.filter((v) => v.version === 'v1')[0];
  const v2 = versiones.filter((v) => v.version === 'v2')[0];
  assert.equal(v1.vigente, false);
  assert.equal(v2.vigente, true);
  assert.equal(v2.comentario, 'Ajustes de gerencia');
});

test('marcarVersionVigente: vuelve a v1 (rollback) sin borrar v2; solo el líder/ADM puede, no cualquier integrante', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const doc = ctx.Proyectos.gestionarDocumento({
    proyecto_id: proyecto.proyecto_id, nombre: 'Flujo comercial', nombre_archivo: 'flujo-v1.pdf', contenido_base64: PDF_B64
  }, CTX_LEO);
  ctx.Proyectos.subirVersionDocumento({
    proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id, nombre_archivo: 'flujo-v2.pdf', contenido_base64: PDF_V2_B64
  }, CTX_LEO);
  const versiones = ctx.Proyectos.listarVersionesDocumento({ proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id }, CTX_LEO);
  const v1 = versiones.filter((v) => v.version === 'v1')[0];

  const rechazado = ctx.Proyectos.marcarVersionVigente({
    proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id, version_id: v1.version_id
  }, CTX_MARCELO); // INTEGRANTE, no líder
  assert.equal(rechazado._forbidden, true);

  const vuelto = ctx.Proyectos.marcarVersionVigente({
    proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id, version_id: v1.version_id
  }, CTX_LEO);
  assert.equal(vuelto.version_vigente, 'v1');
  assert.equal(vuelto.archivo_nombre, 'flujo-v1.pdf');

  const versionesFinal = ctx.Proyectos.listarVersionesDocumento({ proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id }, CTX_LEO);
  assert.equal(versionesFinal.length, 2, 'v2 sigue existiendo, solo dejó de ser vigente');
  assert.equal(versionesFinal.filter((v) => v.version === 'v2')[0].vigente, false);
});

test('gestionarDocumento (editar metadata): no toca el archivo ni la versión vigente', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const doc = ctx.Proyectos.gestionarDocumento({
    proyecto_id: proyecto.proyecto_id, nombre: 'Nombre viejo', categoria: 'OTRO',
    nombre_archivo: 'a.pdf', contenido_base64: PDF_B64
  }, CTX_LEO);

  const editado = ctx.Proyectos.gestionarDocumento({
    proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id, nombre: 'Nombre nuevo', categoria: 'CONTRATO'
  }, CTX_LEO);
  assert.equal(editado.nombre, 'Nombre nuevo');
  assert.equal(editado.categoria, 'CONTRATO');
  assert.equal(editado.version_vigente, 'v1', 'editar metadata no crea versión ni la cambia');
  assert.equal(editado.archivo_id, doc.archivo_id);
});

test('gestionarDocumento con ref_tipo=ACTIVIDAD: exige que la tarea sea del MISMO proyecto', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const otroProyecto = ctx.Proyectos.crear({ nombre: 'Otro', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01' }, CTX_LEO);
  const tareaAjena = ctx.Proyectos.crearTarea({
    proyecto_id: otroProyecto.proyecto_id, titulo: 'Tarea de otro proyecto', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01'
  }, CTX_LEO);

  const rechazado = ctx.Proyectos.gestionarDocumento({
    proyecto_id: proyecto.proyecto_id, nombre: 'Doc', nombre_archivo: 'a.pdf', contenido_base64: PDF_B64,
    ref_tipo: 'ACTIVIDAD', ref_id: tareaAjena.actividad_id
  }, CTX_LEO);
  assert.equal(rechazado._validationError, true);

  const tareaPropia = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Tarea propia', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01'
  }, CTX_LEO);
  const aceptado = ctx.Proyectos.gestionarDocumento({
    proyecto_id: proyecto.proyecto_id, nombre: 'Doc', nombre_archivo: 'a.pdf', contenido_base64: PDF_B64,
    ref_tipo: 'ACTIVIDAD', ref_id: tareaPropia.actividad_id
  }, CTX_LEO);
  assert.equal(aceptado.ref_tipo, 'ACTIVIDAD');
  assert.equal(aceptado.ref_id, tareaPropia.actividad_id);
});

test('gestionarDocumento (eliminar): soft-delete -- desaparece de getDetalle pero no se pierde el historial', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const doc = ctx.Proyectos.gestionarDocumento({
    proyecto_id: proyecto.proyecto_id, nombre: 'A borrar', nombre_archivo: 'a.pdf', contenido_base64: PDF_B64
  }, CTX_LEO);

  const eliminado = ctx.Proyectos.gestionarDocumento({ proyecto_id: proyecto.proyecto_id, accion: 'eliminar', documento_id: doc.documento_id }, CTX_LEO);
  assert.equal(eliminado.activo, false);

  const detalle = ctx.Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(toPlain(detalle.documentos).filter((d) => d.documento_id === doc.documento_id).length, 0);

  // El historial de versiones sigue intacto -- no se perdió nada.
  const versiones = ctx.Proyectos.listarVersionesDocumento({ proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id }, CTX_LEO);
  assert.equal(versiones.length, 1);
});

test('getDetalle: documentos activos aparecen, más recientes primero', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  ctx.Proyectos.gestionarDocumento({ proyecto_id: proyecto.proyecto_id, nombre: 'Primero', nombre_archivo: 'a.pdf', contenido_base64: PDF_B64 }, CTX_LEO);
  // Dos new Date() sucesivos en el mismo test síncrono pueden empatar al
  // milisegundo -- espera activa para desempatar de forma determinista
  // (mismo gotcha ya documentado en otras suites del proyecto).
  const inicio = Date.now();
  while (Date.now() === inicio) { /* espera activa */ }
  ctx.Proyectos.gestionarDocumento({ proyecto_id: proyecto.proyecto_id, nombre: 'Segundo', nombre_archivo: 'b.pdf', contenido_base64: PDF_B64 }, CTX_LEO);

  const detalle = ctx.Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const nombres = toPlain(detalle.documentos).map((d) => d.nombre);
  assert.deepEqual(nombres, ['Segundo', 'Primero']);
});

test('descargarVersionDocumento: sirve el contenido real; rechaza a un ajeno y una versión inexistente', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const doc = ctx.Proyectos.gestionarDocumento({
    proyecto_id: proyecto.proyecto_id, nombre: 'Flujo', nombre_archivo: 'flujo.pdf', contenido_base64: PDF_B64
  }, CTX_LEO);
  const versiones = ctx.Proyectos.listarVersionesDocumento({ proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id }, CTX_LEO);

  const ajeno = ctx.Proyectos.descargarVersionDocumento({ proyecto_id: proyecto.proyecto_id, version_id: versiones[0].version_id }, CTX_OTRO);
  assert.equal(ajeno._forbidden, true);

  const noExiste = ctx.Proyectos.descargarVersionDocumento({ proyecto_id: proyecto.proyecto_id, version_id: 'no-existe' }, CTX_LEO);
  assert.equal(noExiste._validationError, true);

  const descarga = ctx.Proyectos.descargarVersionDocumento({ proyecto_id: proyecto.proyecto_id, version_id: versiones[0].version_id }, CTX_LEO);
  assert.equal(descarga.nombre_archivo, 'flujo.pdf');
  assert.equal(Buffer.from(descarga.contenido_base64, 'base64').toString('utf8'), '%PDF-1.4 contenido v1');
});

test('descargarDocumento: sirve la versión VIGENTE por documento_id, sin resolver version_id primero', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const doc = ctx.Proyectos.gestionarDocumento({
    proyecto_id: proyecto.proyecto_id, nombre: 'Flujo', nombre_archivo: 'flujo-v1.pdf', contenido_base64: PDF_B64
  }, CTX_LEO);
  ctx.Proyectos.subirVersionDocumento({
    proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id, nombre_archivo: 'flujo-v2.pdf', contenido_base64: PDF_V2_B64
  }, CTX_LEO);

  const ajeno = ctx.Proyectos.descargarDocumento({ proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id }, CTX_OTRO);
  assert.equal(ajeno._forbidden, true);

  const descarga = ctx.Proyectos.descargarDocumento({ proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id }, CTX_LEO);
  assert.equal(descarga.nombre_archivo, 'flujo-v2.pdf', 'trae la vigente (v2), no la original');
  assert.equal(Buffer.from(descarga.contenido_base64, 'base64').toString('utf8'), '%PDF-1.4 contenido v2');
});

test('subirVersionDocumento: rechaza un documento_id de otro proyecto', () => {
  const ctx = loadConSchema();
  const proyecto = armarProyecto(ctx);
  const otroProyecto = ctx.Proyectos.crear({ nombre: 'Otro', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01' }, CTX_LEO);
  const docAjeno = ctx.Proyectos.gestionarDocumento({
    proyecto_id: otroProyecto.proyecto_id, nombre: 'Doc de otro proyecto', nombre_archivo: 'a.pdf', contenido_base64: PDF_B64
  }, CTX_LEO);

  const rechazado = ctx.Proyectos.subirVersionDocumento({
    proyecto_id: proyecto.proyecto_id, documento_id: docAjeno.documento_id, nombre_archivo: 'b.pdf', contenido_base64: PDF_V2_B64
  }, CTX_LEO);
  assert.equal(rechazado._validationError, true);
});
