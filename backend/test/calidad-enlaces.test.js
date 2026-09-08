'use strict';

// v16.5: enlaces de consulta online en los documentos del SGC. Para archivos
// grandes (un Excel de servicios a clientes de varios MB) es más cómodo verlos
// en su visor de Drive/web que descargarlos. Se guardan como metadato del
// documento (JSON [{titulo,url}]), SOLO http/https (un javascript:/data: sería
// un vector de inyección cuando el front los pinte como <a>).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'root-1' } });
  seedSheet(ctx, 'SGC_DOCUMENTOS', ctx.COLUMNAS.SGC_DOCUMENTOS);
  seedSheet(ctx, 'SGC_DOC_VERSIONES', ctx.COLUMNAS.SGC_DOC_VERSIONES);
  seedSheet(ctx, 'SGC_DOC_DESTINATARIOS', ctx.COLUMNAS.SGC_DOC_DESTINATARIOS);
  seedSheet(ctx, 'SGC_ROLES', ctx.COLUMNAS.SGC_ROLES);
  seedSheet(ctx, 'SGC_DOC_ACUSES', ctx.COLUMNAS.SGC_DOC_ACUSES);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Encargado', 'sgc@homepymes.cl', 'HP', 'DEV', true, '', 'sistema'],
    ['U2', 'Admin', 'admin@homepymes.cl', 'HP', 'ADM', true, '', 'sistema']
  ]);
  return ctx;
}

const CTX_ENCARGADO = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const CTX_ADM = { email: 'admin@homepymes.cl', nombre: 'Admin', rol: 'ADM' };

function sembrarRol(ctx) {
  ctx.Calidad.gestionarRol({ usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADM);
}

function crearDoc(ctx, overrides) {
  return ctx.Calidad.crearDocumento(Object.assign({
    codigo: 'DOC-01', nombre: 'Servicios a clientes', tipo: 'DOC', visibilidad: 'TODOS'
  }, overrides), CTX_ENCARGADO);
}

test('el esquema de SGC_DOCUMENTOS incluye la columna enlaces', () => {
  const ctx = loadConSchema();
  assert.ok(ctx.COLUMNAS.SGC_DOCUMENTOS.indexOf('enlaces') !== -1, 'falta la columna enlaces');
});

test('crearDocumento guarda los enlaces y getDocumento los devuelve ya parseados', () => {
  const ctx = loadConSchema();
  sembrarRol(ctx);
  const doc = crearDoc(ctx, {
    enlaces: [
      { titulo: 'Excel en Drive', url: 'https://docs.google.com/spreadsheets/d/abc/edit' },
      { titulo: '', url: 'http://intranet.local/plan.xlsx' }
    ]
  });
  const detalle = ctx.Calidad.getDocumento({ documento_id: doc.documento_id }, CTX_ENCARGADO);
  assert.equal(detalle.documento.enlaces.length, 2);
  assert.equal(detalle.documento.enlaces[0].titulo, 'Excel en Drive');
  assert.equal(detalle.documento.enlaces[0].url, 'https://docs.google.com/spreadsheets/d/abc/edit');
});

test('los enlaces con esquema peligroso (javascript:/data:) o vacíos se descartan', () => {
  const ctx = loadConSchema();
  sembrarRol(ctx);
  const doc = crearDoc(ctx, {
    enlaces: [
      { titulo: 'Malicioso', url: 'javascript:alert(1)' },
      { titulo: 'Data', url: 'data:text/html,<script>1</script>' },
      { titulo: 'Vacío', url: '' },
      { titulo: 'Bueno', url: 'https://ok.example/doc' }
    ]
  });
  const detalle = ctx.Calidad.getDocumento({ documento_id: doc.documento_id }, CTX_ENCARGADO);
  assert.equal(detalle.documento.enlaces.length, 1, 'solo el http/https sobrevive');
  assert.equal(detalle.documento.enlaces[0].url, 'https://ok.example/doc');
});

test('los enlaces duplicados se colapsan a uno', () => {
  const ctx = loadConSchema();
  sembrarRol(ctx);
  const doc = crearDoc(ctx, {
    enlaces: [
      { titulo: 'A', url: 'https://misma.example/x' },
      { titulo: 'B', url: 'https://misma.example/x' }
    ]
  });
  const detalle = ctx.Calidad.getDocumento({ documento_id: doc.documento_id }, CTX_ENCARGADO);
  assert.equal(detalle.documento.enlaces.length, 1);
});

test('actualizarDocumento reemplaza los enlaces y el listado expone el conteo', () => {
  const ctx = loadConSchema();
  sembrarRol(ctx);
  const doc = crearDoc(ctx, { enlaces: [{ titulo: 'Uno', url: 'https://a.example/1' }] });

  ctx.Calidad.actualizarDocumento({
    documento_id: doc.documento_id,
    enlaces: [
      { titulo: 'Dos', url: 'https://a.example/2' },
      { titulo: 'Tres', url: 'https://a.example/3' }
    ]
  }, CTX_ENCARGADO);

  const detalle = ctx.Calidad.getDocumento({ documento_id: doc.documento_id }, CTX_ENCARGADO);
  assert.equal(detalle.documento.enlaces.length, 2);
  assert.equal(detalle.documento.enlaces[0].url, 'https://a.example/2');

  const listado = ctx.Calidad.listarDocumentos({}, CTX_ENCARGADO);
  const fila = listado.documentos.filter((d) => d.documento_id === doc.documento_id)[0];
  assert.equal(fila.enlaces_n, 2, 'el listado trae el conteo de enlaces');
});

test('sin enlaces, getDocumento devuelve un arreglo vacío (no rompe)', () => {
  const ctx = loadConSchema();
  sembrarRol(ctx);
  const doc = crearDoc(ctx, {});
  const detalle = ctx.Calidad.getDocumento({ documento_id: doc.documento_id }, CTX_ENCARGADO);
  assert.ok(Array.isArray(detalle.documento.enlaces) && detalle.documento.enlaces.length === 0);
});
