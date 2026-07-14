'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadIntakeProject, seedSheet } = require('./helpers/gasSandbox');

// PNG 1x1 real (firma de bytes valida) y un PDF minimo real, para probar
// deteccion de MIME por firma en vez de confiar en lo que declara el cliente.
const PNG_1X1_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function loadConSchema() {
  const ctx = loadIntakeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'root-folder-id' }
  });
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'ARCHIVOS', ctx.COLUMNAS.ARCHIVOS);
  return ctx;
}

function seedSolicitud(ctx, overrides) {
  const base = Object.assign(
    {
      solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', plataforma: 'ERP', modulo: 'Facturacion',
      tipo: 'ERROR', es_cliente: false, empresa_cliente: '', contacto_cliente: '', correo_cliente: '',
      solicitante_nombre: 'Juan Perez', solicitante_email: 'juan@homepymes.cl',
      estado_derivado: 'S02', prioridad_derivada: 'P2', orden_atencion: '',
      doc_estado: '', doc_reintentos: 0, url_doc: '', url_pdf: '',
      version_documento: 0, url_pdf_historial: '',
      dedup_hash: 'x', estimacion_total_horas: 4, horas_reales: '', resumen_whatsapp: '',
      fecha_creacion: new Date().toISOString(), creado_por: 'juan@homepymes.cl'
    },
    overrides
  );
  const fila = ctx.COLUMNAS.SOLICITUDES.map((col) => base[col]);
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SOLICITUDES').appendRow(fila);
  return base;
}

test('subirArchivo guarda el archivo y registra su metadata en ARCHIVOS', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);

  const resultado = ctx.Drive.subirArchivo({
    solicitud_id: 'SOL-2026-HP-0001',
    nombre_archivo: 'foto.png',
    contenido_base64: PNG_1X1_BASE64
  });

  assert.equal(resultado.tipo_mime, 'image/png');
  assert.ok(resultado.url.startsWith('https://drive.mock/'));

  const archivos = ctx.leerFilas_('ARCHIVOS');
  assert.equal(archivos.length, 1);
  assert.equal(archivos[0].solicitud_id, 'SOL-2026-HP-0001');
  assert.equal(archivos[0].nombre_original, 'foto.png');
});

test('subirArchivo detecta el tipo real por firma de bytes, no por el nombre declarado', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);

  // Se declara "documento.pdf" pero el contenido real es un PNG.
  const resultado = ctx.Drive.subirArchivo({
    solicitud_id: 'SOL-2026-HP-0001',
    nombre_archivo: 'documento.pdf',
    contenido_base64: PNG_1X1_BASE64
  });

  assert.equal(resultado.tipo_mime, 'image/png');
});

test('subirArchivo rechaza un archivo cuyo tipo no se reconoce por firma', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);

  const textoPlano = Buffer.from('esto no es una imagen ni un pdf').toString('base64');
  const resultado = ctx.Drive.subirArchivo({
    solicitud_id: 'SOL-2026-HP-0001',
    nombre_archivo: 'archivo.txt',
    contenido_base64: textoPlano
  });

  assert.equal(resultado._validationError, true);
});

test('subirArchivo rechaza una imagen que supera el limite de 5 MB', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);

  const firmaPng = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const relleno = Buffer.alloc(6 * 1024 * 1024, 0);
  const contenido = Buffer.concat([firmaPng, relleno]).toString('base64');

  const resultado = ctx.Drive.subirArchivo({
    solicitud_id: 'SOL-2026-HP-0001',
    nombre_archivo: 'grande.png',
    contenido_base64: contenido
  });

  assert.equal(resultado._validationError, true);
});

test('subirArchivo detecta XLSX por firma ZIP (documentando la ambiguedad con cualquier .zip)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);

  const firmaZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
  const resultado = ctx.Drive.subirArchivo({
    solicitud_id: 'SOL-2026-HP-0001',
    nombre_archivo: 'reporte.xlsx',
    contenido_base64: firmaZip.toString('base64')
  });

  assert.equal(resultado.tipo_mime, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});

test('subirArchivo rechaza la 6ta imagen del MISMO item (max 5 por item), pero la deja subir en otro item', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);

  for (let i = 0; i < 5; i++) {
    const r = ctx.Drive.subirArchivo({
      solicitud_id: 'SOL-2026-HP-0001',
      subsolicitud_id: 'SOL-2026-HP-0001-01',
      nombre_archivo: 'foto' + i + '.png',
      contenido_base64: PNG_1X1_BASE64
    });
    assert.ok(!r._validationError, 'la imagen ' + i + ' deberia aceptarse');
  }

  // 6ta imagen en el MISMO item -> rechazada.
  const sexta = ctx.Drive.subirArchivo({
    solicitud_id: 'SOL-2026-HP-0001',
    subsolicitud_id: 'SOL-2026-HP-0001-01',
    nombre_archivo: 'foto5.png',
    contenido_base64: PNG_1X1_BASE64
  });
  assert.equal(sexta._validationError, true);

  // La misma imagen en OTRO item -> aceptada (el limite es por item, no por solicitud).
  const otroItem = ctx.Drive.subirArchivo({
    solicitud_id: 'SOL-2026-HP-0001',
    subsolicitud_id: 'SOL-2026-HP-0001-02',
    nombre_archivo: 'foto-otro.png',
    contenido_base64: PNG_1X1_BASE64
  });
  assert.ok(!otroItem._validationError);
});

test('subirArchivo rechaza el 4to documento del mismo item (max 3 por item)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  const pdfMinimo = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]).toString('base64');

  for (let i = 0; i < 3; i++) {
    const r = ctx.Drive.subirArchivo({
      solicitud_id: 'SOL-2026-HP-0001',
      subsolicitud_id: 'SOL-2026-HP-0001-01',
      nombre_archivo: 'doc' + i + '.pdf',
      contenido_base64: pdfMinimo
    });
    assert.ok(!r._validationError);
  }

  const cuarto = ctx.Drive.subirArchivo({
    solicitud_id: 'SOL-2026-HP-0001',
    subsolicitud_id: 'SOL-2026-HP-0001-01',
    nombre_archivo: 'doc3.pdf',
    contenido_base64: pdfMinimo
  });

  assert.equal(cuarto._validationError, true);
});

test('subirArchivo aplica el tope global por solicitud (30 imagenes) aun repartidas en varios items', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  // 30 imagenes en 6 items (5 c/u) llenan el tope global -> la 31a se rechaza.
  for (let item = 1; item <= 6; item++) {
    const subId = 'SOL-2026-HP-0001-0' + item;
    for (let i = 0; i < 5; i++) {
      const r = ctx.Drive.subirArchivo({
        solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: subId,
        nombre_archivo: 'f' + item + i + '.png', contenido_base64: PNG_1X1_BASE64
      });
      assert.ok(!r._validationError);
    }
  }
  const extra = ctx.Drive.subirArchivo({
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-07',
    nombre_archivo: 'extra.png', contenido_base64: PNG_1X1_BASE64
  });
  assert.equal(extra._validationError, true);
});

test('subirArchivo detecta docx/doc/xls por extension cuando la firma es ZIP/OLE', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]).toString('base64');
  const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).toString('base64');

  const docx = ctx.Drive.subirArchivo({
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    nombre_archivo: 'contrato.docx', contenido_base64: zip
  });
  assert.equal(docx.tipo_mime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

  const xls = ctx.Drive.subirArchivo({
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    nombre_archivo: 'planilla.xls', contenido_base64: ole
  });
  assert.equal(xls.tipo_mime, 'application/vnd.ms-excel');

  const doc = ctx.Drive.subirArchivo({
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-02',
    nombre_archivo: 'carta.doc', contenido_base64: ole
  });
  assert.equal(doc.tipo_mime, 'application/msword');
});

test('subirArchivo rechaza un .zip suelto (firma ZIP pero extension no permitida)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]).toString('base64');

  const resultado = ctx.Drive.subirArchivo({
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    nombre_archivo: 'archivos.zip', contenido_base64: zip
  });
  assert.equal(resultado._validationError, true);
});

test('subirArchivo responde error de validacion si la solicitud no existe', () => {
  const ctx = loadConSchema();
  const resultado = ctx.Drive.subirArchivo({
    solicitud_id: 'SOL-2026-HP-9999',
    nombre_archivo: 'foto.png',
    contenido_base64: PNG_1X1_BASE64
  });
  assert.equal(resultado._validationError, true);
});

test('subirArchivo responde error de validacion si faltan datos obligatorios', () => {
  const ctx = loadConSchema();
  assert.equal(ctx.Drive.subirArchivo({})._validationError, true);
});

test('doPost action=subirArchivo responde ok:true end-to-end', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);

  const output = ctx.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'subirArchivo',
        data: { solicitud_id: 'SOL-2026-HP-0001', nombre_archivo: 'foto.png', contenido_base64: PNG_1X1_BASE64 }
      })
    }
  });
  const parsed = JSON.parse(output.getContent());

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.tipo_mime, 'image/png');
});

test('carpetas de la misma solicitud se reutilizan (idempotente) en subidas sucesivas', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);

  ctx.Drive.subirArchivo({ solicitud_id: 'SOL-2026-HP-0001', nombre_archivo: 'a.png', contenido_base64: PNG_1X1_BASE64 });
  ctx.Drive.subirArchivo({ solicitud_id: 'SOL-2026-HP-0001', nombre_archivo: 'b.png', contenido_base64: PNG_1X1_BASE64 });

  const raiz = ctx.DriveApp.getFolderById('root-folder-id');
  const iterSolicitudes = raiz.getFoldersByName('SIGSO_Solicitudes');
  assert.ok(iterSolicitudes.hasNext());
  const carpetaSolicitudes = iterSolicitudes.next();
  assert.equal(iterSolicitudes.hasNext(), false, 'no debe duplicar la carpeta SIGSO_Solicitudes');

  const solicitud = ctx.leerFilas_('SOLICITUDES')[0];
  const carpetaAdjuntos = ctx.obtenerCarpetaAdjuntos_(solicitud);
  assert.ok(carpetaAdjuntos.getFilesByName('a.png').hasNext());
  assert.ok(carpetaAdjuntos.getFilesByName('b.png').hasNext());
  void carpetaSolicitudes;
});
