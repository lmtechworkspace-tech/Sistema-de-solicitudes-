'use strict';

/**
 * Prueba de portabilidad: los mismos escenarios de
 * backend/test/orden-trabajo.test.js (contra OrdenTrabajo.gs), corridos
 * contra el puerto Node (backend/logica/ordenTrabajo.js).
 *
 * DIVERGENCIA DOCUMENTADA (ver la cabecera de ordenTrabajo.js): el .gs
 * embebía las capturas de pantalla como imagen (base64, leída de Drive).
 * Node no tiene acceso a Drive -- el escenario "la imagen se embebe como
 * data URI" no aplica; se reemplaza por "la imagen aparece como enlace,
 * igual que un documento" (mismo criterio que ya usan las otras pruebas de
 * portabilidad cuando el estado real difiere del .gs: se adapta, no se
 * fuerza).
 *
 * Los tests de armarVista_ prueban DATOS (qué entra al render), no el
 * contenido binario del PDF -- separación deliberada en ordenTrabajo.js
 * para no acoplar los tests a cómo pdfkit codifica el texto.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const OrdenTrabajo = require('../logica/ordenTrabajo');

const ADMIN = { rol: 'ADM', email: 'admin@homepymes.cl' };

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}

function seedSolicitud(db, subOverrides) {
  agregarFila_(db, 'SOLICITUDES', {
    solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', empresa_nombre: 'HomePymes',
    plataforma: 'ERP', plataforma_nombre: 'ERP', modulo: 'Facturacion', tipo: 'ERR',
    solicitante_nombre: 'Juan Perez', solicitante_email: 'juan@homepymes.cl',
    estado_derivado: 'S05', prioridad_derivada: 'P1', fecha_creacion: new Date().toISOString()
  });
  agregarFila_(db, 'SUBSOLICITUDES', Object.assign({
    subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001', numero_item: 1,
    titulo: 'Corregir el calculo del IVA', descripcion: 'El total sale mal',
    resultado_esperado: 'Que sume bien', prioridad: 'P1', estado: 'S05',
    url_modulo: 'https://erp.gde.cl/facturacion', usuario_prueba: 'demo', ref_credencial: 'ver 1Password',
    fecha_creacion: new Date().toISOString()
  }, subOverrides || {}));
}

function seedArchivo(db, overrides) {
  agregarFila_(db, 'ARCHIVOS', Object.assign({
    archivo_id: 'ARCH-1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    nombre_original: 'archivo', url: 'https://ejemplo/archivo', tipo_mime: 'application/octet-stream',
    tamano_bytes: 8, fecha_subida: new Date().toISOString()
  }, overrides || {}));
}

test('OrdenTrabajo.descargar devuelve el PDF en base64 y el nombre del archivo; exige solicitud_id', async () => {
  const db = dbConSchema();
  seedSolicitud(db);

  const res = await OrdenTrabajo.descargar(db, { solicitud_id: 'SOL-2026-HP-0001' }, ADMIN);

  assert.ok(!res._validationError, JSON.stringify(res));
  assert.ok(res.pdf_base64 && res.pdf_base64.length > 0);
  assert.equal(res.filename, 'OT-SOL-2026-HP-0001.pdf');
  // El PDF generado es un PDF real (magic bytes %PDF), no un buffer vacio.
  assert.equal(Buffer.from(res.pdf_base64, 'base64').slice(0, 4).toString('ascii'), '%PDF');

  const vacio = await OrdenTrabajo.descargar(db, {}, ADMIN);
  assert.equal(vacio._validationError, true);
});

test('OrdenTrabajo.descargar con una solicitud inexistente devuelve _validationError (no lanza, no genera un PDF vacio)', async () => {
  const db = dbConSchema();
  const res = await OrdenTrabajo.descargar(db, { solicitud_id: 'SOL-NO-EXISTE' }, ADMIN);
  assert.equal(res._validationError, true);
});

test('armarVista_ trae la ficha, el item y la URL como enlace real (no texto plano)', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  const SolicitudesBO = require('../logica/solicitudesBackoffice');
  const detalle = SolicitudesBO.getDetalle(db, 'SOL-2026-HP-0001', ADMIN);

  const vista = OrdenTrabajo.armarVista_(detalle);

  assert.equal(vista.meta.referencia, 'SOL-2026-HP-0001');
  assert.equal(vista.items.length, 1);
  const item = vista.items[0];
  assert.equal(item.titulo, 'Corregir el calculo del IVA');
  assert.equal(item.prioridad, 'P1');
  assert.equal(item.estadoLabel, 'En desarrollo'); // S05
  assert.deepEqual(
    item.accesos.find((a) => a[0] === 'URL principal')[1],
    { texto: 'https://erp.gde.cl/facturacion', link: 'https://erp.gde.cl/facturacion' }
  );
  assert.ok(item.detalles.some((d) => d[0] === 'Fecha comprometida'));
});

// v7.6: ficha resumen + campos que antes se omitian (contexto, frecuencia,
// personas afectadas, area, responsable, tipo).
test('v7.6: la vista trae contexto operativo completo (antes ausente en la OT)', () => {
  const db = dbConSchema();
  seedSolicitud(db, {
    contexto: 'Al cambiar los banners no deja guardar',
    frecuencia: 'SIEMPRE', personas_afectadas: '2000',
    area_nombre: 'INGRESOS ADM', modulo_nombre: 'INGRESOS ADM',
    tipo_nombre: 'Error / Bug', desarrollador_asignado: 'leo@rld.cl'
  });
  const SolicitudesBO = require('../logica/solicitudesBackoffice');
  const detalle = SolicitudesBO.getDetalle(db, 'SOL-2026-HP-0001', ADMIN);
  const item = OrdenTrabajo.armarVista_(detalle).items[0];

  assert.equal(item.campos.contexto, 'Al cambiar los banners no deja guardar');
  assert.equal(item.tipo, 'Error / Bug');
  assert.ok(item.detalles.some((d) => d[0] === 'Frecuencia' && d[1] === 'SIEMPRE'));
  assert.ok(item.detalles.some((d) => d[0] === 'Personas afectadas' && d[1] === '2000'));
  assert.ok(item.detalles.some((d) => d[0] === 'Área' && d[1] === 'INGRESOS ADM'));
  assert.ok(item.detalles.some((d) => d[0] === 'Responsable asignado' && d[1] === 'leo@rld.cl'));
});

test('Los documentos del item quedan como enlace (nunca embebidos)', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedArchivo(db, { archivo_id: 'DOC-1', nombre_original: 'requisitos.pdf', tipo_mime: 'application/pdf', url: 'https://drive.google.com/file/d/doc-1/view' });
  seedArchivo(db, { archivo_id: 'DOC-2', nombre_original: 'planilla.xlsx', tipo_mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', url: 'https://drive.google.com/file/d/doc-2/view' });

  const SolicitudesBO = require('../logica/solicitudesBackoffice');
  const detalle = SolicitudesBO.getDetalle(db, 'SOL-2026-HP-0001', ADMIN);
  const item = OrdenTrabajo.armarVista_(detalle).items[0];

  assert.equal(item.documentos.length, 2);
  assert.equal(item.imagenes.length, 0);
  assert.ok(item.documentos.some((d) => d.nombre === 'requisitos.pdf' && d.link === 'https://drive.google.com/file/d/doc-1/view'));
});

// Divergencia documentada (ver cabecera del archivo): reemplaza el
// escenario "se embebe como data URI base64" del .gs.
test('DIVERGENCIA vs .gs: una imagen del item queda como enlace, no embebida (Node no tiene acceso a Drive)', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedArchivo(db, { archivo_id: 'IMG-1', nombre_original: 'captura.png', tipo_mime: 'image/png', url: 'https://drive.google.com/file/d/img-1/view' });

  const SolicitudesBO = require('../logica/solicitudesBackoffice');
  const detalle = SolicitudesBO.getDetalle(db, 'SOL-2026-HP-0001', ADMIN);
  const item = OrdenTrabajo.armarVista_(detalle).items[0];

  assert.equal(item.imagenes.length, 1);
  assert.equal(item.imagenes[0].nombre, 'captura.png');
  assert.equal(item.imagenes[0].link, 'https://drive.google.com/file/d/img-1/view');
  assert.equal(item.documentos.length, 0);
});

test('Los adjuntos a nivel de solicitud (sin subsolicitud_id) tambien salen en la vista', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedArchivo(db, { archivo_id: 'GEN-1', subsolicitud_id: '', nombre_original: 'contrato-general.docx', tipo_mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', url: 'https://drive/contrato' });

  const SolicitudesBO = require('../logica/solicitudesBackoffice');
  const detalle = SolicitudesBO.getDetalle(db, 'SOL-2026-HP-0001', ADMIN);
  const vista = OrdenTrabajo.armarVista_(detalle);

  assert.ok(vista.adjuntosGenerales);
  assert.equal(vista.adjuntosGenerales.documentos.length, 1);
  assert.equal(vista.adjuntosGenerales.documentos[0].nombre, 'contrato-general.docx');
});

test('Sin adjuntos de solicitud, adjuntosGenerales queda null (no un bloque vacio)', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  const SolicitudesBO = require('../logica/solicitudesBackoffice');
  const detalle = SolicitudesBO.getDetalle(db, 'SOL-2026-HP-0001', ADMIN);
  assert.equal(OrdenTrabajo.armarVista_(detalle).adjuntosGenerales, null);
});

test('estadoLabel_ traduce el codigo a la etiqueta legible', () => {
  assert.equal(OrdenTrabajo.estadoLabel_('S05'), 'En desarrollo');
  assert.equal(OrdenTrabajo.estadoLabel_('S09'), 'Cerrada');
  assert.equal(OrdenTrabajo.estadoLabel_('CODIGO-RARO'), 'CODIGO-RARO');
});
