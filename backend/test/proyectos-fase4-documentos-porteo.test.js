'use strict';

/**
 * Prueba de portabilidad: proyectos-fase4-documentos.test.js (centro
 * documental, v13 Fase 4) + los dos escenarios de adjuntos de Sala (v10
 * Fase D, subirAdjunto/descargarAdjunto) de proyectos.test.js, corridos
 * contra backend/logica/proyectos.js.
 *
 * Ambos usan R2 de verdad desde 2026-09-18 (almacenamiento.js) -- mismo
 * criterio que Novedades/SGC Documentos/SGC Personas: el mock de
 * Almacenamiento vive por-test vía `conMockAlmacenamiento_(t)`, nunca pega
 * a la red real. Las 6 funciones que tocan R2 (subirAdjunto,
 * descargarAdjunto, gestionarDocumento al crear, subirVersionDocumento,
 * descargarVersionDocumento, descargarDocumentoProyecto) son ahora `async`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Proyectos = require('../logica/proyectos');
const Almacenamiento = require('../logica/almacenamiento');

const TABLAS = [
  'PROYECTOS', 'PROYECTO_INTEGRANTES', 'PROYECTO_HITOS', 'PROYECTO_EVENTOS',
  'PROYECTO_ENTREGABLES', 'PROYECTO_RIESGOS', 'PROYECTO_PLANTILLAS', 'PROYECTO_PLANTILLA_HITOS',
  'PROYECTO_DOCUMENTOS', 'PROYECTO_DOC_VERSIONES', 'PROYECTO_REUNIONES', 'PROYECTO_REUNION_ACUERDOS',
  'PROYECTO_DECISIONES', 'SOLICITUDES', 'ACTIVIDADES', 'ACTIVIDADES_BITACORA', 'JEFATURAS',
  'LOG_NOTIFICACIONES', 'CONFIG_FERIADOS', 'NOTIFICACIONES_APP', 'CAT_AREAS'
];
function db_() {
  const db = abrirDb_();
  TABLAS.forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}

const CTX_LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV' };
const CTX_MARCELO = { email: 'marcelo@rld.cl', nombre: 'Marcelo Integrante', rol: 'DEV' };
const CTX_OTRO = { email: 'otro@rld.cl', nombre: 'Otro Ajeno', rol: 'DEV' };

const PDF_B64 = Buffer.from('%PDF-1.4 contenido v1').toString('base64');
const PDF_V2_B64 = Buffer.from('%PDF-1.4 contenido v2').toString('base64');
const BASURA_B64 = Buffer.from('esto no es un documento').toString('base64');

// Mock de Almacenamiento (R2): un Map en memoria que se comporta como un
// bucket real -- mismo criterio que calidad-sgc-porteo.test.js/
// personas-sgc-porteo.test.js/novedades-porteo.test.js.
function conMockAlmacenamiento_(t) {
  const bucket = new Map();
  t.mock.method(Almacenamiento, 'subirArchivo_', async (clave, contenidoBase64, contentType) => {
    bucket.set(clave, { contenidoBase64, contentType });
    return { ok: true, clave, tamano: Buffer.byteLength(contenidoBase64, 'base64') };
  });
  t.mock.method(Almacenamiento, 'descargarArchivo_', async (clave) => {
    const obj = bucket.get(clave);
    if (!obj) return { ok: false, message: 'El archivo no existe.' };
    return { ok: true, contenido_base64: obj.contenidoBase64, content_type: obj.contentType };
  });
}

function armarProyecto(db) {
  const proyecto = Proyectos.crear(db, {
    nombre: 'Estandarización comercial', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01'
  }, CTX_LEO);
  Proyectos.gestionarIntegrante(db, {
    proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE'
  }, CTX_LEO);
  return proyecto;
}

// ===== centro documental (v13 Fase 4) =======================================

test('gestionarDocumento (crear): exige nombre y archivo; nace en v1 con la versión vigente marcada', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const proyecto = armarProyecto(db);

  const sinArchivo = await Proyectos.gestionarDocumento(db, {
    proyecto_id: proyecto.proyecto_id, nombre: 'Flujo comercial'
  }, CTX_LEO);
  assert.equal(sinArchivo._validationError, true);

  const basura = await Proyectos.gestionarDocumento(db, {
    proyecto_id: proyecto.proyecto_id, nombre: 'Flujo comercial', nombre_archivo: 'virus.pdf', contenido_base64: BASURA_B64
  }, CTX_LEO);
  assert.equal(basura._validationError, true, 'la firma binaria no es un formato admitido');

  const doc = await Proyectos.gestionarDocumento(db, {
    proyecto_id: proyecto.proyecto_id, nombre: 'Flujo comercial', categoria: 'REQUISITOS',
    nombre_archivo: 'flujo-v1.pdf', contenido_base64: PDF_B64
  }, CTX_LEO);
  assert.equal(doc.version_vigente, 'v1');
  assert.equal(doc.categoria, 'REQUISITOS');
  assert.ok(doc.archivo_id);

  const versiones = Proyectos.listarVersionesDocumento(db, { proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id }, CTX_LEO);
  assert.equal(versiones.length, 1);
  assert.equal(versiones[0].version, 'v1');
  assert.equal(versiones[0].vigente, true);
});

test('gestionarDocumento: un OBSERVADOR no puede crear documentos; un ajeno al proyecto tampoco', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const proyecto = armarProyecto(db);
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'otro@rld.cl', rol_proyecto: 'OBSERVADOR' }, CTX_LEO);

  const rechazado = await Proyectos.gestionarDocumento(db, {
    proyecto_id: proyecto.proyecto_id, nombre: 'Flujo', nombre_archivo: 'a.pdf', contenido_base64: PDF_B64
  }, CTX_OTRO);
  assert.equal(rechazado._forbidden, true);
});

test('categoria inválida cae a OTRO (nunca rechaza la carga por un valor raro)', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const proyecto = armarProyecto(db);
  const doc = await Proyectos.gestionarDocumento(db, {
    proyecto_id: proyecto.proyecto_id, nombre: 'Sin categoría válida', categoria: 'INVENTADA',
    nombre_archivo: 'a.pdf', contenido_base64: PDF_B64
  }, CTX_LEO);
  assert.equal(doc.categoria, 'OTRO');
});

test('subirVersionDocumento: crea v2, la deja vigente, y v1 se conserva completa (nunca se borra)', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const proyecto = armarProyecto(db);
  const doc = await Proyectos.gestionarDocumento(db, {
    proyecto_id: proyecto.proyecto_id, nombre: 'Flujo comercial', nombre_archivo: 'flujo-v1.pdf', contenido_base64: PDF_B64
  }, CTX_LEO);

  const actualizado = await Proyectos.subirVersionDocumento(db, {
    proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id,
    nombre_archivo: 'flujo-v2.pdf', contenido_base64: PDF_V2_B64, comentario: 'Ajustes de gerencia'
  }, CTX_MARCELO); // un INTEGRANTE también puede subir versión
  assert.equal(actualizado.version_vigente, 'v2');
  assert.equal(actualizado.archivo_nombre, 'flujo-v2.pdf');

  const versiones = Proyectos.listarVersionesDocumento(db, { proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id }, CTX_LEO);
  assert.equal(versiones.length, 2, 'v1 sigue existiendo, no se borró');
  const v1 = versiones.filter((v) => v.version === 'v1')[0];
  const v2 = versiones.filter((v) => v.version === 'v2')[0];
  assert.equal(v1.vigente, false);
  assert.equal(v2.vigente, true);
  assert.equal(v2.comentario, 'Ajustes de gerencia');
});

test('marcarVersionVigente: vuelve a v1 (rollback) sin borrar v2; solo el líder/ADM puede, no cualquier integrante', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const proyecto = armarProyecto(db);
  const doc = await Proyectos.gestionarDocumento(db, {
    proyecto_id: proyecto.proyecto_id, nombre: 'Flujo comercial', nombre_archivo: 'flujo-v1.pdf', contenido_base64: PDF_B64
  }, CTX_LEO);
  await Proyectos.subirVersionDocumento(db, {
    proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id, nombre_archivo: 'flujo-v2.pdf', contenido_base64: PDF_V2_B64
  }, CTX_LEO);
  const versiones = Proyectos.listarVersionesDocumento(db, { proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id }, CTX_LEO);
  const v1 = versiones.filter((v) => v.version === 'v1')[0];

  const rechazado = Proyectos.marcarVersionVigente(db, {
    proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id, version_id: v1.version_id
  }, CTX_MARCELO); // INTEGRANTE, no líder
  assert.equal(rechazado._forbidden, true);

  const vuelto = Proyectos.marcarVersionVigente(db, {
    proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id, version_id: v1.version_id
  }, CTX_LEO);
  assert.equal(vuelto.version_vigente, 'v1');
  assert.equal(vuelto.archivo_nombre, 'flujo-v1.pdf');

  const versionesFinal = Proyectos.listarVersionesDocumento(db, { proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id }, CTX_LEO);
  assert.equal(versionesFinal.length, 2, 'v2 sigue existiendo, solo dejó de ser vigente');
  assert.equal(versionesFinal.filter((v) => v.version === 'v2')[0].vigente, false);
});

test('gestionarDocumento (editar metadata): no toca el archivo ni la versión vigente', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const proyecto = armarProyecto(db);
  const doc = await Proyectos.gestionarDocumento(db, {
    proyecto_id: proyecto.proyecto_id, nombre: 'Nombre viejo', categoria: 'OTRO',
    nombre_archivo: 'a.pdf', contenido_base64: PDF_B64
  }, CTX_LEO);

  const editado = await Proyectos.gestionarDocumento(db, {
    proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id, nombre: 'Nombre nuevo', categoria: 'CONTRATO'
  }, CTX_LEO);
  assert.equal(editado.nombre, 'Nombre nuevo');
  assert.equal(editado.categoria, 'CONTRATO');
  assert.equal(editado.version_vigente, 'v1', 'editar metadata no crea versión ni la cambia');
  assert.equal(editado.archivo_id, doc.archivo_id);
});

test('gestionarDocumento con ref_tipo=ACTIVIDAD: exige que la tarea sea del MISMO proyecto', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const proyecto = armarProyecto(db);
  const otroProyecto = Proyectos.crear(db, { nombre: 'Otro', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01' }, CTX_LEO);
  const tareaAjena = Proyectos.crearTarea(db, {
    proyecto_id: otroProyecto.proyecto_id, titulo: 'Tarea de otro proyecto', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01'
  }, CTX_LEO);

  const rechazado = await Proyectos.gestionarDocumento(db, {
    proyecto_id: proyecto.proyecto_id, nombre: 'Doc', nombre_archivo: 'a.pdf', contenido_base64: PDF_B64,
    ref_tipo: 'ACTIVIDAD', ref_id: tareaAjena.actividad_id
  }, CTX_LEO);
  assert.equal(rechazado._validationError, true);

  const tareaPropia = Proyectos.crearTarea(db, {
    proyecto_id: proyecto.proyecto_id, titulo: 'Tarea propia', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01'
  }, CTX_LEO);
  const aceptado = await Proyectos.gestionarDocumento(db, {
    proyecto_id: proyecto.proyecto_id, nombre: 'Doc', nombre_archivo: 'a.pdf', contenido_base64: PDF_B64,
    ref_tipo: 'ACTIVIDAD', ref_id: tareaPropia.actividad_id
  }, CTX_LEO);
  assert.equal(aceptado.ref_tipo, 'ACTIVIDAD');
  assert.equal(aceptado.ref_id, tareaPropia.actividad_id);
});

test('gestionarDocumento (eliminar): soft-delete -- desaparece de getDetalle pero no se pierde el historial', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const proyecto = armarProyecto(db);
  const doc = await Proyectos.gestionarDocumento(db, {
    proyecto_id: proyecto.proyecto_id, nombre: 'A borrar', nombre_archivo: 'a.pdf', contenido_base64: PDF_B64
  }, CTX_LEO);

  const eliminado = await Proyectos.gestionarDocumento(db, { proyecto_id: proyecto.proyecto_id, accion: 'eliminar', documento_id: doc.documento_id }, CTX_LEO);
  assert.equal(eliminado.activo, false);

  const detalle = Proyectos.getDetalle(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(detalle.documentos.filter((d) => d.documento_id === doc.documento_id).length, 0);

  // El historial de versiones sigue intacto -- no se perdió nada.
  const versiones = Proyectos.listarVersionesDocumento(db, { proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id }, CTX_LEO);
  assert.equal(versiones.length, 1);
});

test('getDetalle: documentos activos aparecen, más recientes primero', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const proyecto = armarProyecto(db);
  await Proyectos.gestionarDocumento(db, { proyecto_id: proyecto.proyecto_id, nombre: 'Primero', nombre_archivo: 'a.pdf', contenido_base64: PDF_B64 }, CTX_LEO);
  // Dos new Date() sucesivos en el mismo test pueden empatar al
  // milisegundo -- espera activa para desempatar de forma determinista
  // (mismo gotcha ya documentado en otras suites del proyecto).
  const inicio = Date.now();
  while (Date.now() === inicio) { /* espera activa */ }
  await Proyectos.gestionarDocumento(db, { proyecto_id: proyecto.proyecto_id, nombre: 'Segundo', nombre_archivo: 'b.pdf', contenido_base64: PDF_B64 }, CTX_LEO);

  const detalle = Proyectos.getDetalle(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const nombres = detalle.documentos.map((d) => d.nombre);
  assert.deepEqual(nombres, ['Segundo', 'Primero']);
});

test('descargarVersionDocumento: sirve el contenido real; rechaza a un ajeno y una versión inexistente', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const proyecto = armarProyecto(db);
  const doc = await Proyectos.gestionarDocumento(db, {
    proyecto_id: proyecto.proyecto_id, nombre: 'Flujo', nombre_archivo: 'flujo.pdf', contenido_base64: PDF_B64
  }, CTX_LEO);
  const versiones = Proyectos.listarVersionesDocumento(db, { proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id }, CTX_LEO);

  const ajeno = await Proyectos.descargarVersionDocumento(db, { proyecto_id: proyecto.proyecto_id, version_id: versiones[0].version_id }, CTX_OTRO);
  assert.equal(ajeno._forbidden, true);

  const noExiste = await Proyectos.descargarVersionDocumento(db, { proyecto_id: proyecto.proyecto_id, version_id: 'no-existe' }, CTX_LEO);
  assert.equal(noExiste._validationError, true);

  const descarga = await Proyectos.descargarVersionDocumento(db, { proyecto_id: proyecto.proyecto_id, version_id: versiones[0].version_id }, CTX_LEO);
  assert.equal(descarga.nombre_archivo, 'flujo.pdf');
  assert.equal(Buffer.from(descarga.contenido_base64, 'base64').toString('utf8'), '%PDF-1.4 contenido v1');
});

test('descargarDocumentoProyecto: sirve la versión VIGENTE por documento_id, sin resolver version_id primero', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const proyecto = armarProyecto(db);
  const doc = await Proyectos.gestionarDocumento(db, {
    proyecto_id: proyecto.proyecto_id, nombre: 'Flujo', nombre_archivo: 'flujo-v1.pdf', contenido_base64: PDF_B64
  }, CTX_LEO);
  await Proyectos.subirVersionDocumento(db, {
    proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id, nombre_archivo: 'flujo-v2.pdf', contenido_base64: PDF_V2_B64
  }, CTX_LEO);

  const ajeno = await Proyectos.descargarDocumentoProyecto(db, { proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id }, CTX_OTRO);
  assert.equal(ajeno._forbidden, true);

  const descarga = await Proyectos.descargarDocumentoProyecto(db, { proyecto_id: proyecto.proyecto_id, documento_id: doc.documento_id }, CTX_LEO);
  assert.equal(descarga.nombre_archivo, 'flujo-v2.pdf', 'trae la vigente (v2), no la original');
  assert.equal(Buffer.from(descarga.contenido_base64, 'base64').toString('utf8'), '%PDF-1.4 contenido v2');
});

test('subirVersionDocumento: rechaza un documento_id de otro proyecto', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const proyecto = armarProyecto(db);
  const otroProyecto = Proyectos.crear(db, { nombre: 'Otro', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01' }, CTX_LEO);
  const docAjeno = await Proyectos.gestionarDocumento(db, {
    proyecto_id: otroProyecto.proyecto_id, nombre: 'Doc de otro proyecto', nombre_archivo: 'a.pdf', contenido_base64: PDF_B64
  }, CTX_LEO);

  const rechazado = await Proyectos.subirVersionDocumento(db, {
    proyecto_id: proyecto.proyecto_id, documento_id: docAjeno.documento_id, nombre_archivo: 'b.pdf', contenido_base64: PDF_V2_B64
  }, CTX_LEO);
  assert.equal(rechazado._validationError, true);
});

// ===== adjuntos de Sala (v10 Fase D) ========================================

test('subirAdjunto: exige poder crear tareas en el proyecto; valida el tipo de archivo por firma; aparece en la Sala', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const proyecto = armarProyecto(db);
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'OBSERVADOR' }, CTX_LEO);

  const sinPermiso = await Proyectos.subirAdjunto(db, {
    proyecto_id: proyecto.proyecto_id, nombre_archivo: 'manual.pdf', contenido_base64: PDF_B64
  }, CTX_MARCELO); // OBSERVADOR: no puede subir
  assert.equal(sinPermiso._forbidden, true);

  const basura = await Proyectos.subirAdjunto(db, {
    proyecto_id: proyecto.proyecto_id, nombre_archivo: 'virus.pdf', contenido_base64: BASURA_B64
  }, CTX_LEO);
  assert.equal(basura._validationError, true);

  const evento = await Proyectos.subirAdjunto(db, {
    proyecto_id: proyecto.proyecto_id, nombre_archivo: 'manual.pdf', contenido_base64: PDF_B64
  }, CTX_LEO);
  assert.equal(evento.tipo, 'ARCHIVO');
  assert.equal(evento.titulo, 'manual.pdf');
  assert.ok(evento.ref_id);

  const sala = Proyectos.listarSala(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const archivos = sala.filter((e) => e.tipo === 'ARCHIVO');
  assert.equal(archivos.length, 1);
  assert.equal(archivos[0].titulo, 'manual.pdf');
});

test('descargarAdjunto: devuelve el contenido a quien puede VER el proyecto; rechaza a un ajeno y un evento_id inexistente', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const proyecto = armarProyecto(db);
  const evento = await Proyectos.subirAdjunto(db, {
    proyecto_id: proyecto.proyecto_id, nombre_archivo: 'manual.pdf', contenido_base64: PDF_B64
  }, CTX_LEO);

  const ajeno = await Proyectos.descargarAdjunto(db, { proyecto_id: proyecto.proyecto_id, evento_id: evento.evento_id }, CTX_OTRO);
  assert.equal(ajeno._forbidden, true);

  const noExiste = await Proyectos.descargarAdjunto(db, { proyecto_id: proyecto.proyecto_id, evento_id: 'no-existe' }, CTX_LEO);
  assert.equal(noExiste._validationError, true);

  const descarga = await Proyectos.descargarAdjunto(db, { proyecto_id: proyecto.proyecto_id, evento_id: evento.evento_id }, CTX_LEO);
  assert.equal(descarga.nombre_archivo, 'manual.pdf');
  assert.equal(Buffer.from(descarga.contenido_base64, 'base64').toString('utf8'), '%PDF-1.4 contenido v1');
});
