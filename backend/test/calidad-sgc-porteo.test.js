'use strict';

/**
 * Prueba de portabilidad: SGC ISO 9001, incremento 1 (Fase 1 + Fase 1b) --
 * escenarios de calidad.test.js + accesos-sgc.test.js + calidad-enlaces.test.js,
 * corridos contra backend/logica/calidadSgc.js.
 *
 * Adaptaciones (R2 no configurado, mismo criterio que Novedades/Pausas/
 * Proyectos):
 *  - crearDoc() de prueba YA NO adjunta un archivo por defecto (el .gs
 *    original si lo hacia) -- la mayoria de las reglas (permisos, visibilidad,
 *    acuse, busqueda, revision) no dependen del archivo. Los tests que SI
 *    prueban la carga de archivos ahora verifican el gate de R2 en vez de un
 *    mime real.
 *  - nuevaVersion SIEMPRE exige contenido_base64 en el .gs -> queda
 *    efectivamente bloqueada hasta que exista R2; se prueba que las
 *    validaciones PREVIAS al archivo (permiso, version duplicada) siguen
 *    intactas, y que el intento con archivo cae en el gate.
 *  - descargarDocumento: el log de descarga en LOG_SISTEMA solo se escribia
 *    tras servir los bytes reales -- no se prueba (no hay bytes que servir
 *    todavia). Se prueba que el orden de guardias (forbidden antes que el
 *    gate de archivo) se mantiene.
 *  - Personas.listarCapacitaciones (accesos-sgc.test.js) pertenece a un
 *    incremento futuro (Personas.gs) -- ese escenario no se porta aqui.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('../logica/calidadSgc');
const Actividades = require('../logica/actividades');
const Resend = require('../logica/resend');

const TABLAS = [
  'SGC_DOCUMENTOS', 'SGC_DOC_VERSIONES', 'SGC_DOC_DESTINATARIOS', 'SGC_ROLES', 'SGC_DOC_ACUSES',
  'LOG_SISTEMA', 'LOG_NOTIFICACIONES', 'NOTIFICACIONES_APP', 'CONFIG_NOTIFICACIONES',
  'CAT_AREAS', 'USUARIOS', 'CUENTAS_PORTAL', 'JEFATURAS'
];
function db_() {
  const db = abrirDb_();
  TABLAS.forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }

const CTX_ENCARGADO = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const CTX_DIRECTOR = { email: 'director@homepymes.cl', nombre: 'Director', rol: 'DEV' };
const CTX_PREVENCION = { email: 'prevencion@homepymes.cl', nombre: 'Prevencionista', rol: 'DEV' };
const CTX_CONTABILIDAD = { email: 'conta@homepymes.cl', nombre: 'Analista Contab.', rol: 'DEV' };
const CTX_AUDITOR = { email: 'auditor@externo.cl', nombre: 'Auditor', rol: 'DEV' };
const CTX_ADM = { email: 'admin@homepymes.cl', nombre: 'Admin', rol: 'ADM' };

const PDF_B64 = Buffer.from('%PDF-1.4 contenido de prueba').toString('base64');

function sembrarRoles(db) {
  Calidad.gestionarRol(db, { usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADM);
  Calidad.gestionarRol(db, { usuario_email: 'director@homepymes.cl', rol_sgc: 'DIRECCION' }, CTX_ADM);
  Calidad.gestionarRol(db, { usuario_email: 'prevencion@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'PREVENCION' }, CTX_ADM);
  Calidad.gestionarRol(db, { usuario_email: 'conta@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'CONTABILIDAD' }, CTX_ADM);
}
// A diferencia del .gs, NO adjunta archivo por defecto (R2 gateado).
function crearDoc(db, overrides, contexto) {
  return Calidad.crearDocumento(db, Object.assign({ codigo: 'DOC-01', nombre: 'Manual de Calidad', tipo: 'DOC', visibilidad: 'TODOS' }, overrides), contexto || CTX_ENCARGADO);
}

// ===== carga y control de versiones =========================================

test('crearDocumento: exige codigo/nombre/tipo/visibilidad validos; codigo unico; solo Encargado/ADM', () => {
  const db = db_();
  sembrarRoles(db);
  assert.equal(crearDoc(db, { codigo: '' })._validationError, true);
  assert.equal(crearDoc(db, { nombre: '' })._validationError, true);
  assert.equal(crearDoc(db, { tipo: 'INVENTADO' })._validationError, true);
  assert.equal(crearDoc(db, { visibilidad: 'CUALQUIERA' })._validationError, true);
  const doc = crearDoc(db);
  assert.equal(doc.codigo, 'DOC-01');
  assert.equal(doc.estado, 'VIGENTE');
  assert.equal(doc.version_vigente, 'v01');
  assert.equal(doc.archivo_id, '', 'sin archivo por defecto (R2 gateado)');

  const duplicado = crearDoc(db, { nombre: 'Otro con el mismo código' });
  assert.equal(duplicado._validationError, true);

  assert.equal(crearDoc(db, { codigo: 'DOC-99' }, CTX_PREVENCION)._forbidden, true);
  assert.equal(crearDoc(db, { codigo: 'DOC-02' }, CTX_ADM).codigo, 'DOC-02');
});

test('archivos: gateados por R2 -- crear/actualizar/nuevaVersion con contenido_base64 devuelven el error claro', () => {
  const db = db_();
  sembrarRoles(db);
  const conArchivo = crearDoc(db, { codigo: 'PRO-01', nombre_archivo: 'p.pdf', contenido_base64: PDF_B64 });
  assert.equal(conArchivo._validationError, true);
  assert.match(conArchivo.message, /almacenamiento/i);

  const doc = crearDoc(db, { codigo: 'PRO-02' });
  const actConArchivo = Calidad.actualizarDocumento(db, { documento_id: doc.documento_id, nombre_archivo: 'x.pdf', contenido_base64: PDF_B64 }, CTX_ENCARGADO);
  assert.equal(actConArchivo._validationError, true);
  assert.match(actConArchivo.message, /almacenamiento/i);
});

test('actualizarDocumento: editar metadata sin tocar el archivo funciona igual (no depende de R2)', () => {
  const db = db_();
  sembrarRoles(db);
  const doc = crearDoc(db);
  const actualizado = Calidad.actualizarDocumento(db, { documento_id: doc.documento_id, nombre: 'Manual de Calidad (rev. redacción)' }, CTX_ENCARGADO);
  assert.equal(actualizado.nombre, 'Manual de Calidad (rev. redacción)');
  assert.equal(actualizado.archivo_id, doc.archivo_id);
});

test('actualizarDocumento: si alguien YA confirmo esa version, el archivo no se reemplaza (guardia anterior al gate de R2)', async () => {
  const db = db_();
  sembrarRoles(db);
  const doc = crearDoc(db, { requiere_acuse: true });
  await Calidad.acusarDocumento(db, { documento_id: doc.documento_id }, CTX_PREVENCION);
  const rechazo = Calidad.actualizarDocumento(db, { documento_id: doc.documento_id, nombre_archivo: 'otro.pdf', contenido_base64: PDF_B64 }, CTX_ENCARGADO);
  assert.equal(rechazo._validationError, true);
  assert.match(rechazo.message, /nueva/i);
});

test('actualizarDocumento: solo el Encargado SGC puede adjuntar (guardia de permiso, no de R2)', () => {
  const db = db_();
  sembrarRoles(db);
  const doc = crearDoc(db);
  const rechazo = Calidad.actualizarDocumento(db, { documento_id: doc.documento_id, nombre_archivo: 'manual.pdf', contenido_base64: PDF_B64 }, CTX_PREVENCION);
  assert.equal(rechazo._forbidden, true);
});

test('nuevaVersion: permiso y version-duplicada se validan antes del archivo; con archivo cae en el gate de R2', () => {
  const db = db_();
  sembrarRoles(db);
  const doc = crearDoc(db);
  assert.equal(Calidad.nuevaVersion(db, { documento_id: doc.documento_id, version: 'v02' }, CTX_PREVENCION)._forbidden, true);
  assert.equal(Calidad.nuevaVersion(db, { documento_id: doc.documento_id, version: doc.version_vigente }, CTX_ENCARGADO)._validationError, true, 'repetir la vigente se rechaza sin necesitar archivo');
  assert.equal(Calidad.nuevaVersion(db, { documento_id: doc.documento_id, version: 'v02' }, CTX_ENCARGADO)._validationError, true, 'sin contenido_base64 tambien se rechaza');
  const conArchivo = Calidad.nuevaVersion(db, { documento_id: doc.documento_id, version: 'v02', nombre_archivo: 'v2.pdf', contenido_base64: PDF_B64 }, CTX_ENCARGADO);
  assert.equal(conArchivo._validationError, true);
  assert.match(conArchivo.message, /almacenamiento/i);
});

test('proxima_revision se calcula a 12 meses de la vigencia (PRO-01), no se pide a mano', () => {
  const db = db_();
  sembrarRoles(db);
  const doc = crearDoc(db, { fecha_vigencia: '2026-06-01T00:00:00.000Z' });
  assert.equal(new Date(doc.proxima_revision).getUTCFullYear(), 2027);
  assert.equal(new Date(doc.proxima_revision).getUTCMonth(), 5);
});

// ===== control de acceso: el corazon del modulo =============================

test('visibilidad TODOS: lo ve cualquier persona del SGC', () => {
  const db = db_();
  sembrarRoles(db);
  crearDoc(db, { codigo: 'DOC-06', nombre: 'Política de Calidad', visibilidad: 'TODOS' });
  [CTX_PREVENCION, CTX_CONTABILIDAD, CTX_DIRECTOR].forEach((quien) => {
    assert.equal(Calidad.listarDocumentos(db, {}, quien).documentos.length, 1);
  });
});

test('visibilidad AREA: solo lo ve quien pertenece a esa area', () => {
  const db = db_();
  sembrarRoles(db);
  crearDoc(db, { codigo: 'PRO-12', visibilidad: 'AREA', area_id: 'PREVENCION' });
  assert.equal(Calidad.listarDocumentos(db, {}, CTX_PREVENCION).documentos.length, 1);
  assert.equal(Calidad.listarDocumentos(db, {}, CTX_CONTABILIDAD).documentos.length, 0);
});

test('visibilidad SELECCION: solo lo ven las personas indicadas', () => {
  const db = db_();
  sembrarRoles(db);
  crearDoc(db, { codigo: 'FO-PRO-02-01', visibilidad: 'SELECCION', destinatarios: ['conta@homepymes.cl'] });
  assert.equal(Calidad.listarDocumentos(db, {}, CTX_CONTABILIDAD).documentos.length, 1);
  assert.equal(Calidad.listarDocumentos(db, {}, CTX_PREVENCION).documentos.length, 0);
});

test('un documento OBSOLETO se retira de circulacion para el personal, pero el SGC lo conserva', () => {
  const db = db_();
  sembrarRoles(db);
  const doc = crearDoc(db, { codigo: 'PRO-09', visibilidad: 'TODOS' });
  assert.equal(Calidad.listarDocumentos(db, {}, CTX_PREVENCION).documentos.length, 1);
  Calidad.actualizarDocumento(db, { documento_id: doc.documento_id, estado: 'OBSOLETO' }, CTX_ENCARGADO);
  assert.equal(Calidad.listarDocumentos(db, {}, CTX_PREVENCION).documentos.length, 0);
  assert.equal(Calidad.listarDocumentos(db, {}, CTX_ENCARGADO).documentos.length, 1);
  assert.equal(filas(db, 'SGC_DOCUMENTOS').length, 1, 'nunca se borra la fila');
});

test('Direccion y Gerencia ven todo el SGC; el personal operativo no', () => {
  const db = db_();
  sembrarRoles(db);
  crearDoc(db, { codigo: 'PRO-20', visibilidad: 'AREA', area_id: 'CONTABILIDAD' });
  assert.equal(Calidad.listarDocumentos(db, {}, CTX_DIRECTOR).documentos.length, 1);
  assert.equal(Calidad.listarDocumentos(db, {}, { email: 'gerencia@homepymes.cl', rol: 'GERENCIA' }).documentos.length, 1);
  assert.equal(Calidad.listarDocumentos(db, {}, CTX_PREVENCION).documentos.length, 0);
});

test('auditor externo: ve todo mientras su acceso este vigente, y deja de verlo al expirar', () => {
  const db = db_();
  sembrarRoles(db);
  crearDoc(db, { codigo: 'PRO-30', visibilidad: 'AREA', area_id: 'CONTABILIDAD' });
  const enUnMes = new Date(Date.now() + 30 * 86400000).toISOString();
  Calidad.gestionarRol(db, { usuario_email: 'auditor@externo.cl', rol_sgc: 'AUDITOR_EXTERNO', vigencia_hasta: enUnMes }, CTX_ADM);
  assert.equal(Calidad.listarDocumentos(db, {}, CTX_AUDITOR).documentos.length, 1);
  const ayer = new Date(Date.now() - 86400000).toISOString();
  Calidad.gestionarRol(db, { usuario_email: 'auditor@externo.cl', rol_sgc: 'AUDITOR_EXTERNO', vigencia_hasta: ayer }, CTX_ADM);
  assert.equal(Calidad.listarDocumentos(db, {}, CTX_AUDITOR).documentos.length, 0);
});

test('getDocumento respeta la misma visibilidad que el listado; descargarDocumento tambien (guardias antes del gate)', () => {
  const db = db_();
  sembrarRoles(db);
  const doc = crearDoc(db, { codigo: 'PRO-40', visibilidad: 'AREA', area_id: 'CONTABILIDAD' });
  assert.equal(Calidad.getDocumento(db, { documento_id: doc.documento_id }, CTX_PREVENCION)._forbidden, true);
  assert.equal(Calidad.descargarDocumento(db, { documento_id: doc.documento_id }, CTX_PREVENCION)._forbidden, true, 'esconder el boton no basta');
  // Quien SI puede ver, pero sin archivo cargado -> error de validacion propio (no forbidden).
  const propio = Calidad.descargarDocumento(db, { documento_id: doc.documento_id }, CTX_CONTABILIDAD);
  assert.equal(propio._validationError, true);
  assert.match(propio.message, /archivo/i);
});

test('descargar una version ANTERIOR queda reservado a quien gobierna el SGC (guardia previa al archivo)', () => {
  const db = db_();
  sembrarRoles(db);
  const doc = crearDoc(db, { visibilidad: 'TODOS' });
  // Se siembra una version historica directo (sin pasar por nuevaVersion,
  // que esta bloqueada por R2) -- el dato que importa para esta regla es que
  // EXISTA la version, no como llego.
  agregarFila_(db, 'SGC_DOC_VERSIONES', { version_id: 'V-OLD', documento_id: doc.documento_id, version: 'v00', cambios: '', archivo_id: '', archivo_nombre: '', archivo_mime: '', subido_por: '', fecha: new Date().toISOString(), vigente: false });
  assert.equal(Calidad.descargarDocumento(db, { documento_id: doc.documento_id, version_id: 'V-OLD' }, CTX_PREVENCION)._forbidden, true);
  const comoGestor = Calidad.descargarDocumento(db, { documento_id: doc.documento_id, version_id: 'V-OLD' }, CTX_ENCARGADO);
  assert.equal(comoGestor._validationError, true, 'pasa la guardia de gobierna, cae en "sin archivo" (v00 no tiene)');
});

test('cambiar la visibilidad reescribe los destinatarios, sin dejar filas huerfanas', () => {
  const db = db_();
  sembrarRoles(db);
  const doc = crearDoc(db, { visibilidad: 'SELECCION', destinatarios: ['conta@homepymes.cl'] });
  assert.equal(Calidad.listarDocumentos(db, {}, CTX_CONTABILIDAD).documentos.length, 1);
  Calidad.actualizarDocumento(db, { documento_id: doc.documento_id, visibilidad: 'SELECCION', destinatarios: ['prevencion@homepymes.cl'] }, CTX_ENCARGADO);
  assert.equal(Calidad.listarDocumentos(db, {}, CTX_CONTABILIDAD).documentos.length, 0);
  assert.equal(Calidad.listarDocumentos(db, {}, CTX_PREVENCION).documentos.length, 1);
});

test('listarDocumentos marca la revision vencida a los 12 meses', () => {
  const db = db_();
  sembrarRoles(db);
  crearDoc(db, { codigo: 'DOC-99', fecha_vigencia: '2020-01-01T00:00:00.000Z', visibilidad: 'TODOS' });
  const fila = Calidad.listarDocumentos(db, {}, CTX_ENCARGADO).documentos[0];
  assert.equal(fila.revision_vencida, true);
});

test('sin rol en SGC_ROLES la persona ve solo lo de acceso general (default seguro)', () => {
  const db = db_();
  sembrarRoles(db);
  crearDoc(db, { codigo: 'DOC-A', visibilidad: 'TODOS' });
  crearDoc(db, { codigo: 'PRO-B', visibilidad: 'AREA', area_id: 'CONTABILIDAD' });
  const desconocido = { email: 'nadie@homepymes.cl', rol: 'DEV' };
  const r = Calidad.listarDocumentos(db, {}, desconocido);
  assert.equal(r.documentos.length, 1);
  assert.equal(r.documentos[0].codigo, 'DOC-A');
  assert.equal(r.puede_gestionar, false);
  assert.equal(r.rol_sgc, 'OPERATIVO');
});

// ===== acuse de recibo (Fase 1b) =============================================

test('acuse: solo se le exige a quien realmente ve el documento', () => {
  const db = db_();
  sembrarRoles(db);
  const doc = crearDoc(db, { codigo: 'PRO-50', visibilidad: 'AREA', area_id: 'PREVENCION' });
  const cumplimiento = Calidad.getCumplimiento(db, { documento_id: doc.documento_id }, CTX_ENCARGADO);
  assert.deepEqual(cumplimiento.pendientes, ['prevencion@homepymes.cl']);
});

test('acuse: el auditor externo y quien cargo el documento quedan fuera de la obligacion', () => {
  const db = db_();
  sembrarRoles(db);
  Calidad.gestionarRol(db, { usuario_email: 'auditor@externo.cl', rol_sgc: 'AUDITOR_EXTERNO' }, CTX_ADM);
  const doc = crearDoc(db, { codigo: 'DOC-70', visibilidad: 'TODOS' });
  const pendientes = Calidad.getCumplimiento(db, { documento_id: doc.documento_id }, CTX_ENCARGADO).pendientes;
  assert.ok(pendientes.indexOf('auditor@externo.cl') === -1);
  assert.ok(pendientes.indexOf('sgc@homepymes.cl') === -1);
  assert.ok(pendientes.indexOf('prevencion@homepymes.cl') !== -1);
});

test('acuse: confirmar mueve a la persona de pendiente a confirmado, y es idempotente', async () => {
  const db = db_();
  sembrarRoles(db);
  const doc = crearDoc(db, { codigo: 'DOC-71', visibilidad: 'TODOS' });
  assert.equal(Calidad.listarDocumentos(db, {}, CTX_PREVENCION).pendientes_de_acuse, 1);
  await Calidad.acusarDocumento(db, { documento_id: doc.documento_id }, CTX_PREVENCION);
  await Calidad.acusarDocumento(db, { documento_id: doc.documento_id }, CTX_PREVENCION);
  assert.equal(filas(db, 'SGC_DOC_ACUSES').length, 1);
  assert.equal(Calidad.listarDocumentos(db, {}, CTX_PREVENCION).pendientes_de_acuse, 0);
  const c = Calidad.getCumplimiento(db, { documento_id: doc.documento_id }, CTX_ENCARGADO);
  assert.equal(c.confirmados.length, 1);
  assert.equal(c.confirmados[0].usuario_email, 'prevencion@homepymes.cl');
});

test('acuse: no se puede confirmar un documento que no se puede ver', async () => {
  const db = db_();
  sembrarRoles(db);
  const doc = crearDoc(db, { codigo: 'PRO-73', visibilidad: 'AREA', area_id: 'PREVENCION' });
  assert.equal((await Calidad.acusarDocumento(db, { documento_id: doc.documento_id }, CTX_CONTABILIDAD))._forbidden, true);
});

test('acuse: un documento sin acuse exigido no aparece como pendiente de nadie', async () => {
  const db = db_();
  sembrarRoles(db);
  const doc2 = crearDoc(db, { codigo: 'FO-80', visibilidad: 'TODOS', requiere_acuse: false });
  assert.equal(Calidad.listarDocumentos(db, {}, CTX_PREVENCION).pendientes_de_acuse, 0);
  assert.equal((await Calidad.acusarDocumento(db, { documento_id: doc2.documento_id }, CTX_PREVENCION))._validationError, true);
});

test('getCumplimiento es solo para quien gobierna el SGC', () => {
  const db = db_();
  sembrarRoles(db);
  const doc = crearDoc(db, { codigo: 'DOC-81', visibilidad: 'TODOS' });
  assert.equal(Calidad.getCumplimiento(db, { documento_id: doc.documento_id }, CTX_PREVENCION)._forbidden, true);
});

// ===== motor diario de vencimientos =========================================

function conMockCorreo(t) {
  process.env.RESEND_API_KEY = 're_test_key';
  const mock = t.mock.method(Resend, 'enviarCorreoResend_', async () => ({ id: 'x' }));
  t.after(() => { delete process.env.RESEND_API_KEY; });
  return mock;
}

test('recordatorio diario: un solo correo por persona con todos sus pendientes juntos; no se repite el mismo dia', async (t) => {
  const mock = conMockCorreo(t);
  const db = db_();
  sembrarRoles(db);
  crearDoc(db, { codigo: 'DOC-90', nombre: 'Manual', visibilidad: 'TODOS' });
  crearDoc(db, { codigo: 'DOC-91', nombre: 'Politica', visibilidad: 'TODOS' });
  crearDoc(db, { codigo: 'PRO-92', nombre: 'Proc. Prevencion', visibilidad: 'AREA', area_id: 'PREVENCION' });

  const r = await Calidad.recordatorioPendientes(db);
  assert.ok(r.acuses >= 1);
  const aPrevencion = mock.mock.calls.filter((c) => c.arguments[0].to[0] === 'prevencion@homepymes.cl');
  assert.equal(aPrevencion.length, 1, 'un solo correo agrupado, no uno por documento');
  const aContabilidad = mock.mock.calls.filter((c) => c.arguments[0].to[0] === 'conta@homepymes.cl');
  assert.equal(aContabilidad.length, 1);

  mock.mock.resetCalls();
  await Calidad.recordatorioPendientes(db);
  assert.equal(mock.mock.callCount(), 0, 'forzar la pasada dos veces el mismo dia no debe reenviar');
});

test('recordatorio diario: avisa al Encargado SGC de la revision a 12 meses; al dia no genera aviso', async (t) => {
  const mock = conMockCorreo(t);
  const db = db_();
  sembrarRoles(db);
  crearDoc(db, { codigo: 'DOC-94', visibilidad: 'TODOS', fecha_vigencia: '2020-01-01T00:00:00.000Z' });
  const r = await Calidad.recordatorioPendientes(db);
  assert.ok(r.revisiones >= 1);
  assert.ok(mock.mock.calls.some((c) => c.arguments[0].to[0] === 'sgc@homepymes.cl'));

  const db2 = db_();
  sembrarRoles(db2);
  const enSeisMeses = new Date(Date.now() + 180 * 86400000).toISOString();
  crearDoc(db2, { codigo: 'DOC-95', visibilidad: 'TODOS', fecha_vigencia: enSeisMeses });
  const r2 = await Calidad.recordatorioPendientes(db2);
  assert.equal(r2.revisiones, 0);
});

// ===== busqueda (v15.0) ======================================================

function sembrarParaBuscar(db) {
  sembrarRoles(db);
  crearDoc(db, { codigo: 'PRO-03', nombre: 'Auditorías Internas', tipo: 'PRO', visibilidad: 'TODOS' });
  crearDoc(db, { codigo: 'FO-PRO-03-04', nombre: 'Lista de Verificación de Auditoría', tipo: 'FO', visibilidad: 'TODOS' });
  crearDoc(db, { codigo: 'INS-02', nombre: 'Respaldo de Información', tipo: 'INS', visibilidad: 'TODOS', descripcion: 'Cómo respaldar los archivos del servidor cada semana.' });
}
function buscar(db, termino) {
  return Calidad.listarDocumentos(db, { busqueda: termino }, CTX_ENCARGADO).documentos.map((d) => d.codigo).sort();
}

test('busqueda documental: ignora acentos; varias palabras como Y; por tipo; por descripcion; por codigo', () => {
  const db = db_();
  sembrarParaBuscar(db);
  assert.deepEqual(buscar(db, 'auditoria'), ['FO-PRO-03-04', 'PRO-03']);
  assert.deepEqual(buscar(db, 'auditoría'), ['FO-PRO-03-04', 'PRO-03']);
  assert.deepEqual(buscar(db, 'lista auditoria'), ['FO-PRO-03-04']);
  assert.deepEqual(buscar(db, 'auditoria inexistente'), []);
  assert.deepEqual(buscar(db, 'procedimiento'), ['PRO-03']);
  assert.deepEqual(buscar(db, 'formulario'), ['FO-PRO-03-04']);
  assert.deepEqual(buscar(db, 'servidor'), ['INS-02']);
  assert.deepEqual(buscar(db, 'FO-PRO-03-04'), ['FO-PRO-03-04']);
});

// ===== Accesos SGC (accesos-sgc.test.js) =====================================

function dbAccesos_() {
  const db = db_();
  agregarFila_(db, 'CAT_AREAS', { area_id: 'PREVENCION', nombre: 'Prevención', activo: true });
  agregarFila_(db, 'CAT_AREAS', { area_id: 'ADMIN', nombre: 'Administración', activo: true });
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'CTA-1', usuario: 'ana', nombre: 'Ana Torres', emails: JSON.stringify(['ana@homepymes.cl']), activo: true, hash_password: '', salt: '', rol: 'DEV', modulos: JSON.stringify([]), empresa_id: '', debe_cambiar_password: false, ultimo_acceso: '', creado_por: 'seed' });
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'CTA-2', usuario: 'bruno', nombre: 'Bruno Díaz', emails: JSON.stringify(['bruno@homepymes.cl']), activo: true, hash_password: '', salt: '', rol: 'DEV', modulos: JSON.stringify([]), empresa_id: '', debe_cambiar_password: false, ultimo_acceso: '', creado_por: 'seed' });
  return db;
}
const CTX_ANA = { email: 'ana@homepymes.cl', nombre: 'Ana', rol: '' };
function sembrarEncargado(db) { Calidad.gestionarRol(db, { usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADM); }

test('Accesos: asignar un rol es admin-only -- ni siquiera el Encargado SGC puede', () => {
  const db = dbAccesos_();
  sembrarEncargado(db);
  assert.equal(Calidad.gestionarRol(db, { usuario_email: 'ana@homepymes.cl', rol_sgc: 'OPERATIVO' }, CTX_ENCARGADO)._forbidden, true);
  const ok = Calidad.gestionarRol(db, { usuario_email: 'ana@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'PREVENCION' }, CTX_ADM);
  assert.ok(ok.rol_id);
});

test('Accesos: el panel (listarAccesos) es admin-only y cruza cuentas con su rol', () => {
  const db = dbAccesos_();
  sembrarEncargado(db);
  Calidad.gestionarRol(db, { usuario_email: 'ana@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'PREVENCION' }, CTX_ADM);
  assert.equal(Calidad.listarAccesos(db, {}, CTX_ENCARGADO)._forbidden, true);
  assert.equal(Calidad.listarAccesos(db, {}, CTX_ANA)._forbidden, true);
  const panel = Calidad.listarAccesos(db, {}, CTX_ADM);
  const ana = panel.cuentas.find((c) => c.email === 'ana@homepymes.cl');
  assert.equal(ana.rol_sgc, 'OPERATIVO');
  assert.equal(ana.area_id, 'PREVENCION');
  const bruno = panel.cuentas.find((c) => c.email === 'bruno@homepymes.cl');
  assert.equal(bruno.rol_sgc, '');
  assert.ok(panel.areas.length >= 2);
  assert.ok(panel.roles.some((r) => r.clave === 'ENCARGADO_SGC'));
});

test('Accesos: un operativo de un area ve los generales + los de su area, no los de otra', () => {
  const db = dbAccesos_();
  sembrarEncargado(db);
  Calidad.gestionarRol(db, { usuario_email: 'ana@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'PREVENCION' }, CTX_ADM);
  Calidad.crearDocumento(db, { codigo: 'DOC-GEN', nombre: 'Manual general', tipo: 'DOC', visibilidad: 'TODOS' }, CTX_ENCARGADO);
  Calidad.crearDocumento(db, { codigo: 'PRO-PREV', nombre: 'Procedimiento de prevención', tipo: 'PRO', visibilidad: 'AREA', area_id: 'PREVENCION' }, CTX_ENCARGADO);
  Calidad.crearDocumento(db, { codigo: 'PRO-ADM', nombre: 'Procedimiento admin', tipo: 'PRO', visibilidad: 'AREA', area_id: 'ADMIN' }, CTX_ENCARGADO);
  const previa = Calidad.previsualizarAcceso(db, { email: 'ana@homepymes.cl' }, CTX_ADM);
  assert.deepEqual(previa.documentos.map((d) => d.codigo).sort(), ['DOC-GEN', 'PRO-PREV']);
  assert.equal(previa.personas_scope, 'solo su propia ficha');
});

test('Accesos: previsualizar refleja que el operativo NO alcanza las secciones de gobierno', () => {
  const db = dbAccesos_();
  sembrarEncargado(db);
  Calidad.gestionarRol(db, { usuario_email: 'ana@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'PREVENCION' }, CTX_ADM);
  const previa = Calidad.previsualizarAcceso(db, { email: 'ana@homepymes.cl' }, CTX_ADM);
  assert.equal(previa.secciones.documentos, true);
  assert.equal(previa.secciones.personas, true);
  ['proveedores', 'revision', 'objetivos', 'cobertura', 'capacitaciones', 'accesos'].forEach((k) => assert.equal(previa.secciones[k], false));
});

test('Accesos: listarDocumentos entrega secciones_visibles acotado para el operativo y con accesos solo para el admin', () => {
  const db = dbAccesos_();
  sembrarEncargado(db);
  Calidad.gestionarRol(db, { usuario_email: 'ana@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'PREVENCION' }, CTX_ADM);
  const opera = Calidad.listarDocumentos(db, {}, CTX_ANA).secciones_visibles;
  assert.equal(opera.accesos, false);
  assert.equal(opera.proveedores, false);
  const admin = Calidad.listarDocumentos(db, {}, CTX_ADM).secciones_visibles;
  assert.equal(admin.accesos, true);
  assert.equal(admin.proveedores, true);
});

test('Accesos: quitar un rol lo desactiva y la persona vuelve a ver solo lo general', () => {
  const db = dbAccesos_();
  sembrarEncargado(db);
  const asignado = Calidad.gestionarRol(db, { usuario_email: 'ana@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'PREVENCION' }, CTX_ADM);
  Calidad.crearDocumento(db, { codigo: 'PRO-PREV', nombre: 'Proc prevención', tipo: 'PRO', visibilidad: 'AREA', area_id: 'PREVENCION' }, CTX_ENCARGADO);
  let previa = Calidad.previsualizarAcceso(db, { email: 'ana@homepymes.cl' }, CTX_ADM);
  assert.ok(previa.documentos.some((d) => d.codigo === 'PRO-PREV'));
  Calidad.gestionarRol(db, { accion: 'quitar', rol_id: asignado.rol_id }, CTX_ADM);
  previa = Calidad.previsualizarAcceso(db, { email: 'ana@homepymes.cl' }, CTX_ADM);
  assert.equal(previa.documentos.some((d) => d.codigo === 'PRO-PREV'), false);
  assert.equal(previa.rol_sgc, '');
});

test('Centro de Control: getMatrizDistribucion y getDocumentosConfidenciales son admin-only', () => {
  const db = dbAccesos_();
  sembrarEncargado(db);
  assert.equal(Calidad.getMatrizDistribucion(db, {}, CTX_ENCARGADO)._forbidden, true);
  assert.equal(Calidad.getDocumentosConfidenciales(db, {}, CTX_ENCARGADO)._forbidden, true);
  assert.equal(Calidad.getMatrizDistribucion(db, {}, CTX_ANA)._forbidden, true);
});

test('Centro de Control: la matriz marca confirmado/pendiente/no-corresponde correctamente', async () => {
  const db = dbAccesos_();
  sembrarEncargado(db);
  Calidad.gestionarRol(db, { usuario_email: 'ana@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'PREVENCION' }, CTX_ADM);
  Calidad.crearDocumento(db, { codigo: 'DOC-GEN', nombre: 'Manual general', tipo: 'DOC', visibilidad: 'TODOS' }, CTX_ENCARGADO);
  Calidad.crearDocumento(db, { codigo: 'PRO-ADM', nombre: 'Procedimiento admin', tipo: 'PRO', visibilidad: 'AREA', area_id: 'ADMIN' }, CTX_ENCARGADO);
  const docGen = filas(db, 'SGC_DOCUMENTOS').find((d) => d.codigo === 'DOC-GEN');
  await Calidad.acusarDocumento(db, { documento_id: docGen.documento_id }, CTX_ANA);

  const matriz = Calidad.getMatrizDistribucion(db, {}, CTX_ADM);
  const cols = matriz.documentos.map((d) => d.codigo);
  const iGen = cols.indexOf('DOC-GEN');
  const iAdm = cols.indexOf('PRO-ADM');
  const filaAna = matriz.personas.find((p) => p.email === 'ana@homepymes.cl');
  assert.equal(filaAna.celdas[iGen].estado, 'confirmado');
  assert.equal(filaAna.celdas[iAdm].estado, 'no');
  const filaBruno = matriz.personas.find((p) => p.email === 'bruno@homepymes.cl');
  assert.equal(filaBruno.celdas[iGen].estado, 'pendiente');
});

test('Centro de Control: confidenciales lista exactamente quien esta en cada documento SELECCION', () => {
  const db = dbAccesos_();
  sembrarEncargado(db);
  Calidad.crearDocumento(db, { codigo: 'FO-CONF', nombre: 'Formulario confidencial', tipo: 'FO', visibilidad: 'SELECCION', destinatarios: ['ana@homepymes.cl'] }, CTX_ENCARGADO);
  Calidad.crearDocumento(db, { codigo: 'DOC-GEN', nombre: 'Manual general', tipo: 'DOC', visibilidad: 'TODOS' }, CTX_ENCARGADO);
  const conf = Calidad.getDocumentosConfidenciales(db, {}, CTX_ADM);
  assert.equal(conf.length, 1);
  assert.equal(conf[0].codigo, 'FO-CONF');
  assert.deepEqual(conf[0].destinatarios.map((d) => d.email), ['ana@homepymes.cl']);
});

test('Centro de Control: la previsualizacion marca confidencial/confirmado por documento y cuenta pendientes', async () => {
  const db = dbAccesos_();
  sembrarEncargado(db);
  Calidad.gestionarRol(db, { usuario_email: 'ana@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'PREVENCION' }, CTX_ADM);
  Calidad.crearDocumento(db, { codigo: 'FO-CONF', nombre: 'Formulario confidencial', tipo: 'FO', visibilidad: 'SELECCION', destinatarios: ['ana@homepymes.cl'] }, CTX_ENCARGADO);
  Calidad.crearDocumento(db, { codigo: 'DOC-GEN', nombre: 'Manual general', tipo: 'DOC', visibilidad: 'TODOS' }, CTX_ENCARGADO);
  let previa = Calidad.previsualizarAcceso(db, { email: 'ana@homepymes.cl' }, CTX_ADM);
  let conf = previa.documentos.find((d) => d.codigo === 'FO-CONF');
  const gen = previa.documentos.find((d) => d.codigo === 'DOC-GEN');
  assert.equal(conf.confidencial, true);
  assert.equal(gen.confidencial, false);
  assert.equal(conf.confirmado, false);
  assert.equal(previa.pendientes_acuse, 2);

  const docConf = filas(db, 'SGC_DOCUMENTOS').find((d) => d.codigo === 'FO-CONF');
  await Calidad.acusarDocumento(db, { documento_id: docConf.documento_id }, CTX_ANA);
  previa = Calidad.previsualizarAcceso(db, { email: 'ana@homepymes.cl' }, CTX_ADM);
  conf = previa.documentos.find((d) => d.codigo === 'FO-CONF');
  assert.equal(conf.confirmado, true);
  assert.equal(previa.pendientes_acuse, 1);
});

test('Centro de Control: avisa cuando la cuenta ademas es ADM/GERENCIA de SIGSO', () => {
  const db = dbAccesos_();
  sembrarEncargado(db);
  agregarFila_(db, 'USUARIOS', { usuario_id: 'U1', nombre: 'Gerente', email: 'gerente@homepymes.cl', empresa_id: 'HP', rol: 'GERENCIA', activo: true, ultimo_acceso: '', creado_por: 'seed' });
  const previaOperativa = Calidad.previsualizarAcceso(db, { email: 'ana@homepymes.cl' }, CTX_ADM);
  assert.equal(previaOperativa.acceso_amplio_sistema, false);
  const previaGerencia = Calidad.previsualizarAcceso(db, { email: 'gerente@homepymes.cl' }, CTX_ADM);
  assert.equal(previaGerencia.rol_sistema, 'GERENCIA');
  assert.equal(previaGerencia.acceso_amplio_sistema, true);
});

// ===== enlaces de consulta online (v16.5) ===================================

test('el esquema de SGC_DOCUMENTOS incluye la columna enlaces', () => {
  assert.ok(COLUMNAS.SGC_DOCUMENTOS.indexOf('enlaces') !== -1);
});

test('crearDocumento guarda los enlaces y getDocumento los devuelve ya parseados', () => {
  const db = db_();
  sembrarRoles(db);
  const doc = crearDoc(db, { enlaces: [{ titulo: 'Excel en Drive', url: 'https://docs.google.com/spreadsheets/d/abc/edit' }, { titulo: '', url: 'http://intranet.local/plan.xlsx' }] });
  const detalle = Calidad.getDocumento(db, { documento_id: doc.documento_id }, CTX_ENCARGADO);
  assert.equal(detalle.documento.enlaces.length, 2);
  assert.equal(detalle.documento.enlaces[0].titulo, 'Excel en Drive');
});

test('los enlaces con esquema peligroso o vacios se descartan; los duplicados se colapsan', () => {
  const db = db_();
  sembrarRoles(db);
  const doc = crearDoc(db, { enlaces: [{ titulo: 'Malicioso', url: 'javascript:alert(1)' }, { titulo: 'Data', url: 'data:text/html,<script>1</script>' }, { titulo: 'Vacío', url: '' }, { titulo: 'Bueno', url: 'https://ok.example/doc' }] });
  const detalle = Calidad.getDocumento(db, { documento_id: doc.documento_id }, CTX_ENCARGADO);
  assert.equal(detalle.documento.enlaces.length, 1);
  assert.equal(detalle.documento.enlaces[0].url, 'https://ok.example/doc');

  const doc2 = crearDoc(db, { codigo: 'DOC-DUP', enlaces: [{ titulo: 'A', url: 'https://misma.example/x' }, { titulo: 'B', url: 'https://misma.example/x' }] });
  const detalle2 = Calidad.getDocumento(db, { documento_id: doc2.documento_id }, CTX_ENCARGADO);
  assert.equal(detalle2.documento.enlaces.length, 1);
});

test('actualizarDocumento reemplaza los enlaces y el listado expone el conteo; sin enlaces devuelve arreglo vacio', () => {
  const db = db_();
  sembrarRoles(db);
  const doc = crearDoc(db, { enlaces: [{ titulo: 'Uno', url: 'https://a.example/1' }] });
  Calidad.actualizarDocumento(db, { documento_id: doc.documento_id, enlaces: [{ titulo: 'Dos', url: 'https://a.example/2' }, { titulo: 'Tres', url: 'https://a.example/3' }] }, CTX_ENCARGADO);
  const detalle = Calidad.getDocumento(db, { documento_id: doc.documento_id }, CTX_ENCARGADO);
  assert.equal(detalle.documento.enlaces.length, 2);
  assert.equal(detalle.documento.enlaces[0].url, 'https://a.example/2');
  const fila = Calidad.listarDocumentos(db, {}, CTX_ENCARGADO).documentos.find((d) => d.documento_id === doc.documento_id);
  assert.equal(fila.enlaces_n, 2);

  const doc2 = crearDoc(db, { codigo: 'DOC-SIN' });
  const detalle2 = Calidad.getDocumento(db, { documento_id: doc2.documento_id }, CTX_ENCARGADO);
  assert.ok(Array.isArray(detalle2.documento.enlaces) && detalle2.documento.enlaces.length === 0);
});

// ===== acoplamiento con Actividades (RN-709, desgateado) ====================

test('acoplamiento: gobiernaSgc_ ahora resuelve de verdad -- el Encargado SGC puede crear una actividad marcada sgc_origen_tipo para un ajeno', () => {
  const db = db_();
  sembrarTablasActividades_(db);
  sembrarRoles(db);
  const actividad = Actividades.crear(db, {
    titulo: 'Corregir hallazgo', responsable_email: 'prevencion@homepymes.cl', fecha_compromiso: '2026-09-01', sgc_origen_tipo: 'NC_CORRECCION'
  }, CTX_ENCARGADO);
  assert.ok(actividad.actividad_id, 'el gobierno del SGC debe conceder el cuarto circulo de RN-709');
  assert.equal(actividad._forbidden, undefined);
});
function sembrarTablasActividades_(db) {
  ['ACTIVIDADES', 'ACTIVIDADES_BITACORA', 'JEFATURAS'].forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
}
