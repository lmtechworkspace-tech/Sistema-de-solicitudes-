'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadIntakeProject, seedSheet } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadIntakeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'SUBSOLICITUDES', ctx.COLUMNAS.SUBSOLICITUDES);
  return ctx;
}

function seedSolicitud(ctx, overrides) {
  const base = Object.assign(
    {
      solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', plataforma: 'ERP', modulo: 'Facturacion',
      tipo: 'ERROR', es_cliente: false, empresa_cliente: '', contacto_cliente: '', correo_cliente: '',
      solicitante_nombre: 'Juan Perez', solicitante_email: 'juan@homepymes.cl',
      estado_derivado: 'S02', prioridad_derivada: 'P2', orden_atencion: '',
      doc_estado: '', url_doc: '', url_pdf: '', dedup_hash: 'x',
      estimacion_total_horas: 4, horas_reales: '', resumen_whatsapp: '',
      fecha_creacion: new Date().toISOString(), creado_por: 'juan@homepymes.cl'
    },
    overrides
  );
  const fila = ctx.COLUMNAS.SOLICITUDES.map((col) => base[col]);
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SOLICITUDES').appendRow(fila);
  return base;
}

function seedSubsolicitud(ctx, overrides) {
  const base = Object.assign(
    {
      subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001',
      titulo: 'No cargan las facturas', descripcion: 'desc', impacto: 'DEGRADACION_IMPORTANTE',
      urgencia_cliente: '', prioridad: 'P2', estado: 'S02', ref_credencial: '',
      sla_objetivo_horas: 24, fecha_creacion: new Date().toISOString()
    },
    overrides
  );
  const fila = ctx.COLUMNAS.SUBSOLICITUDES.map((col) => base[col]);
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SUBSOLICITUDES').appendRow(fila);
  return base;
}

test('estadoPublico devuelve el estado cuando el correo coincide con el solicitante', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx);

  const resultado = ctx.Solicitudes.estadoPublico('SOL-2026-HP-0001', 'juan@homepymes.cl');

  assert.equal(resultado.solicitud_id, 'SOL-2026-HP-0001');
  assert.equal(resultado.estado_derivado, 'S02');
  assert.equal(resultado.subsolicitudes.length, 1);
  assert.equal(resultado.subsolicitudes[0].titulo, 'No cargan las facturas');
});

test('estadoPublico incluye el detalle que el solicitante escribio, para expandir cada item', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, {
    descripcion: 'Al abrir el modulo aparece pantalla en blanco',
    resultado_esperado: 'Deberia mostrar la lista de facturas',
    contexto: 'Empezo despues de la actualizacion del martes',
    modulo_nombre: 'Facturacion Electronica'
  });

  const item = ctx.Solicitudes.estadoPublico('SOL-2026-HP-0001', 'juan@homepymes.cl').subsolicitudes[0];

  assert.equal(item.descripcion, 'Al abrir el modulo aparece pantalla en blanco');
  assert.equal(item.resultado_esperado, 'Deberia mostrar la lista de facturas');
  assert.equal(item.contexto, 'Empezo despues de la actualizacion del martes');
  assert.equal(item.modulo_nombre, 'Facturacion Electronica');
});

test('estadoPublico compara el correo sin distinguir mayusculas/espacios', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx);

  const resultado = ctx.Solicitudes.estadoPublico('SOL-2026-HP-0001', '  JUAN@HomePymes.CL  ');
  assert.equal(resultado.solicitud_id, 'SOL-2026-HP-0001');
});

test('estadoPublico tambien acepta el correo del cliente cuando es_cliente=true', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { es_cliente: true, correo_cliente: 'cliente@empresa.cl' });
  seedSubsolicitud(ctx);

  const resultado = ctx.Solicitudes.estadoPublico('SOL-2026-HP-0001', 'cliente@empresa.cl');
  assert.equal(resultado.solicitud_id, 'SOL-2026-HP-0001');
});

test('estadoPublico responde forbidden si el correo no coincide', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx);

  const resultado = ctx.Solicitudes.estadoPublico('SOL-2026-HP-0001', 'otro@correo.cl');
  assert.equal(resultado._forbidden, true);
});

test('estadoPublico responde error de validacion si la solicitud no existe', () => {
  const ctx = loadConSchema();
  const resultado = ctx.Solicitudes.estadoPublico('SOL-2026-HP-9999', 'juan@homepymes.cl');
  assert.equal(resultado._validationError, true);
});

test('estadoPublico responde error de validacion si falta solicitud_id o email', () => {
  const ctx = loadConSchema();
  assert.equal(ctx.Solicitudes.estadoPublico('', 'a@b.cl')._validationError, true);
  assert.equal(ctx.Solicitudes.estadoPublico('SOL-2026-HP-0001', '')._validationError, true);
});

test('doPost action=consultarEstado responde ok:true con el estado cuando el correo coincide', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx);

  const output = ctx.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'consultarEstado',
        data: { solicitud_id: 'SOL-2026-HP-0001', email: 'juan@homepymes.cl' }
      })
    }
  });
  const parsed = JSON.parse(output.getContent());

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.estado_derivado, 'S02');
});

test('doPost action=consultarEstado responde forbidden cuando el correo no coincide', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx);

  const output = ctx.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'consultarEstado',
        data: { solicitud_id: 'SOL-2026-HP-0001', email: 'nada@que.ver' }
      })
    }
  });
  const parsed = JSON.parse(output.getContent());

  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, 'forbidden');
});
