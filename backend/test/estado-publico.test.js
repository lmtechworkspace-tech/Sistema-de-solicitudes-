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

test('estadoPublico expone pregunta_pendiente cuando el item esta esperando informacion (S06)', () => {
  const ctx = loadConSchema();
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS);
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S06' });
  ctx.agregarFila_('HISTORIAL_ESTADOS', {
    historial_id: 'h1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    estado_anterior: 'S03', estado_nuevo: 'S06', usuario: 'dev@homepymes.cl',
    comentario: '¿Cual es el numero de factura afectado?', timestamp: new Date().toISOString()
  });

  const item = ctx.Solicitudes.estadoPublico('SOL-2026-HP-0001', 'juan@homepymes.cl').subsolicitudes[0];

  assert.equal(item.pregunta_pendiente, '¿Cual es el numero de factura afectado?');
  assert.equal(item.subsolicitud_id, 'SOL-2026-HP-0001-01');
});

test('responderConsulta agrega un comentario publico cuando el correo coincide', () => {
  const ctx = loadConSchema();
  seedSheet(ctx, 'COMENTARIOS', ctx.COLUMNAS.COMENTARIOS);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S06' });

  const resultado = ctx.Solicitudes.responderConsulta({
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    email: 'juan@homepymes.cl', texto: 'La factura N-4521'
  });

  assert.equal(resultado.ok, true);
  const comentarios = ctx.leerFilas_('COMENTARIOS');
  assert.equal(comentarios.length, 1);
  assert.equal(comentarios[0].usuario, 'juan@homepymes.cl');
  assert.equal(comentarios[0].texto, 'La factura N-4521');
  assert.equal(comentarios[0].es_interno, false);
});

test('responderConsulta rechaza si el correo no coincide con el registrado', () => {
  const ctx = loadConSchema();
  seedSheet(ctx, 'COMENTARIOS', ctx.COLUMNAS.COMENTARIOS);
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S06' });

  const resultado = ctx.Solicitudes.responderConsulta({
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    email: 'otro@correo.cl', texto: 'La factura N-4521'
  });

  assert.equal(resultado._forbidden, true);
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

test('estadoPublico expone los adjuntos que el solicitante subio, por item (Fase 1)', () => {
  const ctx = loadConSchema();
  seedSheet(ctx, 'ARCHIVOS', ctx.COLUMNAS.ARCHIVOS);
  seedSolicitud(ctx);
  seedSubsolicitud(ctx);
  ctx.agregarFila_('ARCHIVOS', {
    archivo_id: 'a1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    nombre_original: 'captura.png', url: 'https://drive/x', tipo_mime: 'image/png',
    tamano_bytes: 1234, fecha_subida: new Date().toISOString()
  });
  // Adjunto de OTRO item de la misma solicitud: no debe aparecer en este.
  ctx.agregarFila_('ARCHIVOS', {
    archivo_id: 'a2', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-99',
    nombre_original: 'otro.pdf', url: 'https://drive/y', tipo_mime: 'application/pdf',
    tamano_bytes: 5, fecha_subida: new Date().toISOString()
  });

  const item = ctx.Solicitudes.estadoPublico('SOL-2026-HP-0001', 'juan@homepymes.cl').subsolicitudes[0];
  assert.equal(item.archivos.length, 1);
  assert.equal(item.archivos[0].nombre_original, 'captura.png');
  assert.equal(item.archivos[0].url, 'https://drive/x');
  assert.equal(item.archivos[0].tipo_mime, 'image/png');
});

test('estadoPublico no rompe si la hoja ARCHIVOS no existe (tolerante)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx);
  const item = ctx.Solicitudes.estadoPublico('SOL-2026-HP-0001', 'juan@homepymes.cl').subsolicitudes[0];
  assert.ok(Array.isArray(item.archivos));
  assert.equal(item.archivos.length, 0);
});

// Fase 1 ("editar solicitud"): el solicitante corrige un item mal llenado.
test('editarSubsolicitud actualiza los campos y deja traza mientras el item es editable', () => {
  const ctx = loadConSchema();
  seedSheet(ctx, 'COMENTARIOS', ctx.COLUMNAS.COMENTARIOS);
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S02', titulo: 'titulo malo', descripcion: 'desc vieja' });

  const r = ctx.Solicitudes.editarSubsolicitud({
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01', email: 'juan@homepymes.cl',
    titulo: 'Título corregido', descripcion: 'Descripción corregida y más clara', contexto: 'nuevo contexto', resultado_esperado: ''
  });
  assert.equal(r.ok, true);
  assert.ok(r.cambios >= 1);

  const sub = ctx.leerFilas_('SUBSOLICITUDES')[0];
  assert.equal(sub.titulo, 'Título corregido');
  assert.equal(sub.descripcion, 'Descripción corregida y más clara');
  assert.equal(sub.contexto, 'nuevo contexto');

  const comentarios = ctx.leerFilas_('COMENTARIOS');
  assert.equal(comentarios.length, 1);
  assert.equal(comentarios[0].es_interno, true);
  assert.equal(comentarios[0].usuario, 'juan@homepymes.cl');
  assert.match(comentarios[0].texto, /corrigió el ítem/);
});

test('editarSubsolicitud rechaza si el item ya está en desarrollo (S05)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S05' });
  const r = ctx.Solicitudes.editarSubsolicitud({
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01', email: 'juan@homepymes.cl',
    titulo: 'Otro título', descripcion: 'Otra descripción larga'
  });
  assert.equal(r._validationError, true);
});

test('editarSubsolicitud rechaza correo que no coincide, y valida largos mínimos', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S02' });
  assert.equal(ctx.Solicitudes.editarSubsolicitud({
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01', email: 'otro@correo.cl',
    titulo: 'x', descripcion: 'y'
  })._forbidden, true);
  assert.equal(ctx.Solicitudes.editarSubsolicitud({
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01', email: 'juan@homepymes.cl',
    titulo: 'x', descripcion: 'descripción válida'
  })._validationError, true, 'título muy corto');
});

test('eliminarArchivo quita el adjunto de la solicitud y deja traza', () => {
  const ctx = loadConSchema();
  seedSheet(ctx, 'ARCHIVOS', ctx.COLUMNAS.ARCHIVOS);
  seedSheet(ctx, 'COMENTARIOS', ctx.COLUMNAS.COMENTARIOS);
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S02' });
  ctx.agregarFila_('ARCHIVOS', {
    archivo_id: 'a1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    nombre_original: 'malo.png', url: 'https://drive.google.com/file/d/ABC123/view',
    tipo_mime: 'image/png', tamano_bytes: 10, fecha_subida: new Date().toISOString()
  });

  const r = ctx.Solicitudes.eliminarArchivo({
    solicitud_id: 'SOL-2026-HP-0001', archivo_id: 'a1', email: 'juan@homepymes.cl'
  });
  assert.equal(r.ok, true);
  assert.equal(ctx.leerFilas_('ARCHIVOS').length, 0, 'la fila del adjunto se borró');

  const item = ctx.Solicitudes.estadoPublico('SOL-2026-HP-0001', 'juan@homepymes.cl').subsolicitudes[0];
  assert.equal(item.archivos.length, 0, 'ya no aparece en el detalle');
  const com = ctx.leerFilas_('COMENTARIOS');
  assert.equal(com.length, 1);
  assert.match(com[0].texto, /quitó el adjunto/);
});

test('eliminarArchivo rechaza correo ajeno y adjunto de ítem ya en desarrollo', () => {
  const ctx = loadConSchema();
  seedSheet(ctx, 'ARCHIVOS', ctx.COLUMNAS.ARCHIVOS);
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S05' });
  ctx.agregarFila_('ARCHIVOS', {
    archivo_id: 'a1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    nombre_original: 'x.png', url: 'u', tipo_mime: 'image/png', tamano_bytes: 1,
    fecha_subida: new Date().toISOString()
  });
  assert.equal(ctx.Solicitudes.eliminarArchivo({
    solicitud_id: 'SOL-2026-HP-0001', archivo_id: 'a1', email: 'otro@correo.cl'
  })._forbidden, true);
  assert.equal(ctx.Solicitudes.eliminarArchivo({
    solicitud_id: 'SOL-2026-HP-0001', archivo_id: 'a1', email: 'juan@homepymes.cl'
  })._validationError, true, 'ítem en desarrollo: no se puede quitar');
  assert.equal(ctx.leerFilas_('ARCHIVOS').length, 1, 'el adjunto sigue ahí');
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

// P2 (v2.0, Sprint 2): "cuantas hay antes que yo" -- posicion en la cola,
// sin exponer el contenido de las demas solicitudes.
test('estadoPublico (P2) expone posicion_cola: cuenta solo abiertas de la MISMA empresa con prioridad igual o mas critica', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-HP-0001', prioridad_derivada: 'P3', estado_derivado: 'S02',
    fecha_creacion: '2026-01-05T10:00:00.000Z'
  });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001' });
  // Mas critica (P1) y anterior: cuenta.
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-HP-0002', prioridad_derivada: 'P1', estado_derivado: 'S02',
    fecha_creacion: '2026-01-01T10:00:00.000Z'
  });
  // Misma prioridad (P3) pero creada DESPUES: no cuenta.
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-HP-0003', prioridad_derivada: 'P3', estado_derivado: 'S02',
    fecha_creacion: '2026-01-10T10:00:00.000Z'
  });
  // Misma prioridad (P3) y anterior: cuenta.
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-HP-0004', prioridad_derivada: 'P3', estado_derivado: 'S02',
    fecha_creacion: '2026-01-02T10:00:00.000Z'
  });
  // Mas critica pero YA CERRADA: no cuenta.
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-HP-0005', prioridad_derivada: 'P1', estado_derivado: 'S09',
    fecha_creacion: '2026-01-01T10:00:00.000Z'
  });
  // Mas critica pero de OTRA empresa: no cuenta.
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-RLD-0001', empresa_id: 'RLD', prioridad_derivada: 'P1', estado_derivado: 'S02',
    fecha_creacion: '2026-01-01T10:00:00.000Z'
  });

  const resultado = ctx.Solicitudes.estadoPublico('SOL-2026-HP-0001', 'juan@homepymes.cl');
  assert.equal(resultado.posicion_cola, 2);
});

test('estadoPublico (P2) posicion_cola es null si la solicitud ya esta cerrada/rechazada/cancelada', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { estado_derivado: 'S09' });
  seedSubsolicitud(ctx, { estado: 'S09' });

  const resultado = ctx.Solicitudes.estadoPublico('SOL-2026-HP-0001', 'juan@homepymes.cl');
  assert.equal(resultado.posicion_cola, null);
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

// RN-201/RF-206/207 (v2.0, Sprint 1): validacion/cierre por el solicitante.
test('validarCierre (confirmar) cierra un item Terminada y recalcula el estado derivado del padre', () => {
  const ctx = loadConSchema();
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S08' });

  const resultado = ctx.Solicitudes.validarCierre({
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    email: 'juan@homepymes.cl', accion: 'confirmar'
  });

  assert.equal(resultado.estado_nuevo, 'S09');
  const subsolicitudes = ctx.leerFilas_('SUBSOLICITUDES');
  assert.equal(subsolicitudes[0].estado, 'S09');
  const solicitudes = ctx.leerFilas_('SOLICITUDES');
  assert.equal(solicitudes[0].estado_derivado, 'S09');
  const historial = ctx.leerFilas_('HISTORIAL_ESTADOS');
  assert.equal(historial.length, 1);
  assert.equal(historial[0].usuario, 'juan@homepymes.cl');
});

test('validarCierre (reabrir) exige comentario y vuelve el item a En desarrollo (S05)', () => {
  const ctx = loadConSchema();
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S08' });

  const sinComentario = ctx.Solicitudes.validarCierre({
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    email: 'juan@homepymes.cl', accion: 'reabrir'
  });
  assert.equal(sinComentario._validationError, true);

  const conComentario = ctx.Solicitudes.validarCierre({
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    email: 'juan@homepymes.cl', accion: 'reabrir', comentario: 'El boton de exportar sigue sin funcionar'
  });
  assert.equal(conComentario.estado_nuevo, 'S05');
  const subsolicitudes = ctx.leerFilas_('SUBSOLICITUDES');
  assert.equal(subsolicitudes[0].estado, 'S05');
});

test('validarCierre rechaza si el item no esta en Terminada (S08)', () => {
  const ctx = loadConSchema();
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS);
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S05' });

  const resultado = ctx.Solicitudes.validarCierre({
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    email: 'juan@homepymes.cl', accion: 'confirmar'
  });

  assert.equal(resultado._validationError, true);
});

test('validarCierre rechaza si el correo no coincide con el registrado', () => {
  const ctx = loadConSchema();
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S08' });

  const resultado = ctx.Solicitudes.validarCierre({
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    email: 'otro@correo.cl', accion: 'confirmar'
  });

  assert.equal(resultado._forbidden, true);
});

test('doPost action=validarCierre responde ok:true y cierra el item', () => {
  const ctx = loadConSchema();
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSolicitud(ctx);
  seedSubsolicitud(ctx, { estado: 'S08' });

  const output = ctx.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'validarCierre',
        data: { solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01', email: 'juan@homepymes.cl', accion: 'confirmar' }
      })
    }
  });
  const parsed = JSON.parse(output.getContent());

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.estado_nuevo, 'S09');
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
