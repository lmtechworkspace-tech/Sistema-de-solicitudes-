'use strict';

/**
 * Prueba de portabilidad: los escenarios de editarSubsolicitud/eliminarArchivo/
 * responderConsulta/validarCierre de backend/test/estado-publico.test.js, mas
 * la seccion "cerrar_directo" de backend/test/atencion-directa.test.js,
 * corridos contra solicitudesPublico.js.
 */

const test = require('node:test');
const { beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const SolicitudesPublico = require('../logica/solicitudesPublico');
const Resend = require('../logica/resend');
const Cache = require('../logica/cacheEfimero');

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}

function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }

function seedSolicitud(db, overrides) {
  const base = Object.assign(
    {
      solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', plataforma: 'ERP', modulo: 'Facturacion',
      tipo: 'ERROR', es_cliente: false, correo_cliente: '',
      solicitante_nombre: 'Juan Perez', solicitante_cargo: 'Analista', solicitante_email: 'juan@homepymes.cl',
      estado_derivado: 'S02', prioridad_derivada: 'P2', dedup_hash: 'x', atencion_directa: false,
      estimacion_total_horas: 4, fecha_creacion: new Date().toISOString(), creado_por: 'juan@homepymes.cl'
    },
    overrides
  );
  agregarFila_(db, 'SOLICITUDES', base);
  return base;
}

function seedSubsolicitud(db, overrides) {
  const base = Object.assign(
    {
      subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001', numero_item: 1,
      titulo: 'No cargan las facturas', descripcion: 'desc', impacto: 'DEGRADACION_IMPORTANTE',
      prioridad: 'P2', estado: 'S02', sla_objetivo_horas: 24, fecha_creacion: new Date().toISOString()
    },
    overrides
  );
  agregarFila_(db, 'SUBSOLICITUDES', base);
  return base;
}

beforeEach(() => { Cache.limpiarTodo_(); });

function conApiKey(t) {
  process.env.RESEND_API_KEY = 're_test_key';
  t.after(() => { delete process.env.RESEND_API_KEY; });
}

function mockEnvioOk(t) {
  return t.mock.method(Resend, 'enviarCorreoResend_', async () => ({ id: 'fake-resend-id' }));
}

// --- editarSubsolicitud -----------------------------------------------------

test('editarSubsolicitud actualiza los campos y deja traza mientras el item es editable', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { estado: 'S02', titulo: 'titulo malo', descripcion: 'desc vieja' });

  const r = SolicitudesPublico.editarSubsolicitud(db, {
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01', email: 'juan@homepymes.cl',
    titulo: 'Título corregido', descripcion: 'Descripción corregida y más clara', contexto: 'nuevo contexto', resultado_esperado: ''
  });
  assert.equal(r.ok, true);
  assert.ok(r.cambios >= 1);

  const sub = filas(db, 'SUBSOLICITUDES')[0];
  assert.equal(sub.titulo, 'Título corregido');
  assert.equal(sub.descripcion, 'Descripción corregida y más clara');
  assert.equal(sub.contexto, 'nuevo contexto');

  const comentarios = filas(db, 'COMENTARIOS');
  assert.equal(comentarios.length, 1);
  assert.equal(comentarios[0].es_interno, true);
  assert.equal(comentarios[0].usuario, 'juan@homepymes.cl');
  assert.match(comentarios[0].texto, /corrigió el ítem/);
});

test('editarSubsolicitud rechaza si el item ya está en desarrollo (S05)', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { estado: 'S05' });
  const r = SolicitudesPublico.editarSubsolicitud(db, {
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01', email: 'juan@homepymes.cl',
    titulo: 'Otro título', descripcion: 'Otra descripción larga'
  });
  assert.equal(r._validationError, true);
});

test('editarSubsolicitud rechaza correo que no coincide, y valida largos mínimos', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { estado: 'S02' });
  assert.equal(SolicitudesPublico.editarSubsolicitud(db, {
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01', email: 'otro@correo.cl',
    titulo: 'x', descripcion: 'y'
  })._forbidden, true);
  assert.equal(SolicitudesPublico.editarSubsolicitud(db, {
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01', email: 'juan@homepymes.cl',
    titulo: 'x', descripcion: 'descripción válida'
  })._validationError, true, 'título muy corto');
});

// --- eliminarArchivo ---------------------------------------------------------

test('eliminarArchivo quita el adjunto de la solicitud y deja traza', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { estado: 'S02' });
  agregarFila_(db, 'ARCHIVOS', {
    archivo_id: 'a1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    nombre_original: 'malo.png', url: 'https://drive.google.com/file/d/ABC123/view',
    tipo_mime: 'image/png', tamano_bytes: 10, fecha_subida: new Date().toISOString()
  });

  const r = SolicitudesPublico.eliminarArchivo(db, {
    solicitud_id: 'SOL-2026-HP-0001', archivo_id: 'a1', email: 'juan@homepymes.cl'
  });
  assert.equal(r.ok, true);
  assert.equal(filas(db, 'ARCHIVOS').length, 0, 'la fila del adjunto se borró');

  const item = SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-0001', 'juan@homepymes.cl').subsolicitudes[0];
  assert.equal(item.archivos.length, 0, 'ya no aparece en el detalle');
  const com = filas(db, 'COMENTARIOS');
  assert.equal(com.length, 1);
  assert.match(com[0].texto, /quitó el adjunto/);
});

test('eliminarArchivo rechaza correo ajeno y adjunto de ítem ya en desarrollo', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { estado: 'S05' });
  agregarFila_(db, 'ARCHIVOS', {
    archivo_id: 'a1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    nombre_original: 'x.png', url: 'u', tipo_mime: 'image/png', tamano_bytes: 1,
    fecha_subida: new Date().toISOString()
  });
  assert.equal(SolicitudesPublico.eliminarArchivo(db, {
    solicitud_id: 'SOL-2026-HP-0001', archivo_id: 'a1', email: 'otro@correo.cl'
  })._forbidden, true);
  assert.equal(SolicitudesPublico.eliminarArchivo(db, {
    solicitud_id: 'SOL-2026-HP-0001', archivo_id: 'a1', email: 'juan@homepymes.cl'
  })._validationError, true, 'ítem en desarrollo: no se puede quitar');
  assert.equal(filas(db, 'ARCHIVOS').length, 1, 'el adjunto sigue ahí');
});

// --- responderConsulta -------------------------------------------------------

test('responderConsulta agrega un comentario publico cuando el correo coincide', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { estado: 'S06' });

  const resultado = await SolicitudesPublico.responderConsulta(db, {
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    email: 'juan@homepymes.cl', texto: 'La factura N-4521'
  });

  assert.equal(resultado.ok, true);
  const comentarios = filas(db, 'COMENTARIOS');
  assert.equal(comentarios.length, 1);
  assert.equal(comentarios[0].usuario, 'juan@homepymes.cl');
  assert.equal(comentarios[0].texto, 'La factura N-4521');
  assert.equal(comentarios[0].es_interno, false);
  assert.equal(mock.mock.callCount(), 1, 'avisa al responsable del item');
});

test('responderConsulta rechaza si el correo no coincide con el registrado', async () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { estado: 'S06' });

  const resultado = await SolicitudesPublico.responderConsulta(db, {
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    email: 'otro@correo.cl', texto: 'La factura N-4521'
  });

  assert.equal(resultado._forbidden, true);
});

// --- validarCierre: confirmar / reabrir -------------------------------------

test('validarCierre (confirmar) cierra un item Terminada y recalcula el estado derivado del padre', async (t) => {
  conApiKey(t);
  mockEnvioOk(t);
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { estado: 'S08' });

  const resultado = await SolicitudesPublico.validarCierre(db, {
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    email: 'juan@homepymes.cl', accion: 'confirmar'
  });

  assert.equal(resultado.estado_nuevo, 'S09');
  assert.equal(filas(db, 'SUBSOLICITUDES')[0].estado, 'S09');
  assert.equal(filas(db, 'SOLICITUDES')[0].estado_derivado, 'S09');
  const historial = filas(db, 'HISTORIAL_ESTADOS');
  assert.equal(historial.length, 1);
  assert.equal(historial[0].usuario, 'juan@homepymes.cl');
});

test('validarCierre (reabrir) exige comentario y vuelve el item a En desarrollo (S05)', async (t) => {
  conApiKey(t);
  mockEnvioOk(t);
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { estado: 'S08' });

  const sinComentario = await SolicitudesPublico.validarCierre(db, {
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    email: 'juan@homepymes.cl', accion: 'reabrir'
  });
  assert.equal(sinComentario._validationError, true);

  const conComentario = await SolicitudesPublico.validarCierre(db, {
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    email: 'juan@homepymes.cl', accion: 'reabrir', comentario: 'El boton de exportar sigue sin funcionar'
  });
  assert.equal(conComentario.estado_nuevo, 'S05');
  assert.equal(filas(db, 'SUBSOLICITUDES')[0].estado, 'S05');
});

test('validarCierre rechaza si el item no esta en Terminada (S08)', async () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { estado: 'S05' });

  const resultado = await SolicitudesPublico.validarCierre(db, {
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    email: 'juan@homepymes.cl', accion: 'confirmar'
  });

  assert.equal(resultado._validationError, true);
});

test('validarCierre rechaza si el correo no coincide con el registrado', async () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { estado: 'S08' });

  const resultado = await SolicitudesPublico.validarCierre(db, {
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    email: 'otro@correo.cl', accion: 'confirmar'
  });

  assert.equal(resultado._forbidden, true);
});

// --- validarCierre: cerrar_directo (v3.1 §1.3B) -----------------------------

const ATENCION_OK = {
  resuelto_por: 'Leo',
  fecha_resolucion: '2026-01-15T10:30',
  detalle: 'Se reinicio el servicio de facturacion y se limpio la cola atascada'
};

function seedSolicitudAbierta(db, estadoItem) {
  seedSolicitud(db, { estado_derivado: estadoItem });
  seedSubsolicitud(db, { estado: estadoItem });
  return { solicitudId: 'SOL-2026-HP-0001', subId: 'SOL-2026-HP-0001-01' };
}

test('cerrar_directo cierra un item desde cualquier estado abierto', async (t) => {
  conApiKey(t);
  mockEnvioOk(t);
  for (const estado of ['S02', 'S05', 'S06']) {
    const db = dbConSchema();
    const { solicitudId, subId } = seedSolicitudAbierta(db, estado);

    const res = await SolicitudesPublico.validarCierre(db, {
      solicitud_id: solicitudId, subsolicitud_id: subId,
      email: 'juan@homepymes.cl', accion: 'cerrar_directo', atencion_directa: ATENCION_OK
    });

    assert.equal(res.estado_nuevo, 'S09', 'desde ' + estado + ' deberia cerrar');
    assert.equal(res.estado_anterior, estado);
    assert.equal(filas(db, 'SUBSOLICITUDES')[0].estado, 'S09');
  }
});

test('cerrar_directo guarda el registro en el item y en el historial', async (t) => {
  conApiKey(t);
  mockEnvioOk(t);
  const db = dbConSchema();
  const { solicitudId, subId } = seedSolicitudAbierta(db, 'S05');

  await SolicitudesPublico.validarCierre(db, {
    solicitud_id: solicitudId, subsolicitud_id: subId,
    email: 'juan@homepymes.cl', accion: 'cerrar_directo', atencion_directa: ATENCION_OK
  });

  const sub = filas(db, 'SUBSOLICITUDES')[0];
  assert.equal(sub.atencion_resuelto_por, 'Leo');
  assert.match(sub.atencion_detalle, /reinicio el servicio/);

  const historial = filas(db, 'HISTORIAL_ESTADOS');
  const ultima = historial[historial.length - 1];
  assert.equal(ultima.estado_nuevo, 'S09');
  assert.match(ultima.comentario, /Atencion directa/);
  assert.equal(ultima.usuario, 'juan@homepymes.cl');
});

test('cerrar_directo tambien exige los tres campos del registro', async (t) => {
  conApiKey(t);
  mockEnvioOk(t);
  const db = dbConSchema();
  const { solicitudId, subId } = seedSolicitudAbierta(db, 'S05');

  const res = await SolicitudesPublico.validarCierre(db, {
    solicitud_id: solicitudId, subsolicitud_id: subId,
    email: 'juan@homepymes.cl', accion: 'cerrar_directo'
  });

  assert.equal(res._validationError, true);
  assert.equal(filas(db, 'SUBSOLICITUDES')[0].estado, 'S05', 'no debe cerrar');
});

test('cerrar_directo no aplica a un item ya cerrado', async (t) => {
  conApiKey(t);
  mockEnvioOk(t);
  const db = dbConSchema();
  const { solicitudId, subId } = seedSolicitudAbierta(db, 'S09');

  const res = await SolicitudesPublico.validarCierre(db, {
    solicitud_id: solicitudId, subsolicitud_id: subId,
    email: 'juan@homepymes.cl', accion: 'cerrar_directo', atencion_directa: ATENCION_OK
  });

  assert.equal(res._validationError, true);
  assert.match(res.message, /ya esta cerrado/);
});

test('cerrar_directo respeta la verificacion de correo del solicitante', async (t) => {
  conApiKey(t);
  mockEnvioOk(t);
  const db = dbConSchema();
  const { solicitudId, subId } = seedSolicitudAbierta(db, 'S05');

  const res = await SolicitudesPublico.validarCierre(db, {
    solicitud_id: solicitudId, subsolicitud_id: subId,
    email: 'otro@homepymes.cl', accion: 'cerrar_directo', atencion_directa: ATENCION_OK
  });

  assert.equal(res._forbidden, true);
  assert.equal(filas(db, 'SUBSOLICITUDES')[0].estado, 'S05');
});

// Sin distinguir la accion, el correo anunciaria "Ítem reabierto", que es
// exactamente lo contrario de lo que paso.
test('el aviso de un cierre directo no dice "reabierto"', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();
  const { solicitudId, subId } = seedSolicitudAbierta(db, 'S05');

  await SolicitudesPublico.validarCierre(db, {
    solicitud_id: solicitudId, subsolicitud_id: subId,
    email: 'juan@homepymes.cl', accion: 'cerrar_directo', atencion_directa: ATENCION_OK
  });

  const payload = mock.mock.calls[mock.mock.calls.length - 1].arguments[0];
  assert.match(payload.subject, /atención directa/i);
  assert.equal(/reabierto/i.test(payload.subject), false);
  assert.equal(/reabri/i.test(payload.text), false);
});

// La marca atencion_directa existe para excluir de los KPIs a lo que se crea
// y cierra en el mismo instante. Una solicitud que vivio dias en el sistema
// tiene un tiempo real que SI debe medirse, aunque el desenlace fuera por
// telefono.
test('un cierre directo NO marca la solicitud como atencion_directa', async (t) => {
  conApiKey(t);
  mockEnvioOk(t);
  const db = dbConSchema();
  const { solicitudId, subId } = seedSolicitudAbierta(db, 'S05');

  await SolicitudesPublico.validarCierre(db, {
    solicitud_id: solicitudId, subsolicitud_id: subId,
    email: 'juan@homepymes.cl', accion: 'cerrar_directo', atencion_directa: ATENCION_OK
  });

  assert.equal(filas(db, 'SOLICITUDES')[0].atencion_directa, false);
});
