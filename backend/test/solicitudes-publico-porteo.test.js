'use strict';

/**
 * Prueba de portabilidad: los escenarios de backend/test/estado-publico.test.js
 * (solo estadoPublico -- responderConsulta/editarSubsolicitud/eliminarArchivo/
 * validarCierre quedan pendientes) y backend/test/mis-solicitudes.test.js +
 * los de misSolicitudes con token de backend/test/portal.test.js, corridos
 * contra solicitudesPublico.js.
 */

const test = require('node:test');
const { beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const SolicitudesPublico = require('../logica/solicitudesPublico');
const CuentasPortal = require('../logica/cuentasPortal');
const Portal = require('../logica/portal');
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
      solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', empresa_nombre: 'HomePymes',
      plataforma: 'ERP', modulo: 'Facturacion', tipo: 'ERROR', es_cliente: false, correo_cliente: '',
      solicitante_nombre: 'Juan Perez', solicitante_cargo: 'Analista', solicitante_email: 'juan@homepymes.cl',
      estado_derivado: 'S02', prioridad_derivada: 'P2', dedup_hash: 'x',
      estimacion_total_horas: 4, fecha_creacion: new Date().toISOString(), creado_por: 'juan@homepymes.cl',
      doc_estado: '', url_pdf: ''
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

test('estadoPublico devuelve el estado cuando el correo coincide con el solicitante', (t) => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db);

  const resultado = SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-0001', 'juan@homepymes.cl');

  assert.equal(resultado.solicitud_id, 'SOL-2026-HP-0001');
  assert.equal(resultado.estado_derivado, 'S02');
  assert.equal(resultado.subsolicitudes.length, 1);
  assert.equal(resultado.subsolicitudes[0].titulo, 'No cargan las facturas');
});

test('estadoPublico expone pregunta_pendiente cuando el item esta esperando informacion (S06)', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { estado: 'S06' });
  agregarFila_(db, 'HISTORIAL_ESTADOS', {
    historial_id: 'h1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    estado_anterior: 'S03', estado_nuevo: 'S06', usuario: 'dev@homepymes.cl',
    comentario: '¿Cual es el numero de factura afectado?', timestamp: new Date().toISOString()
  });

  const item = SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-0001', 'juan@homepymes.cl').subsolicitudes[0];

  assert.equal(item.pregunta_pendiente, '¿Cual es el numero de factura afectado?');
  assert.equal(item.subsolicitud_id, 'SOL-2026-HP-0001-01');
});

test('estadoPublico incluye el detalle que el solicitante escribio, para expandir cada item', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, {
    descripcion: 'Al abrir el modulo aparece pantalla en blanco',
    resultado_esperado: 'Deberia mostrar la lista de facturas',
    contexto: 'Empezo despues de la actualizacion del martes',
    modulo_nombre: 'Facturacion Electronica'
  });

  const item = SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-0001', 'juan@homepymes.cl').subsolicitudes[0];

  assert.equal(item.descripcion, 'Al abrir el modulo aparece pantalla en blanco');
  assert.equal(item.resultado_esperado, 'Deberia mostrar la lista de facturas');
  assert.equal(item.contexto, 'Empezo despues de la actualizacion del martes');
  assert.equal(item.modulo_nombre, 'Facturacion Electronica');
});

test('estadoPublico expone los adjuntos que el solicitante subio, por item (Fase 1)', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db);
  agregarFila_(db, 'ARCHIVOS', {
    archivo_id: 'a1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    nombre_original: 'captura.png', url: 'https://drive/x', tipo_mime: 'image/png',
    tamano_bytes: 1234, fecha_subida: new Date().toISOString()
  });
  agregarFila_(db, 'ARCHIVOS', {
    archivo_id: 'a2', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-99',
    nombre_original: 'otro.pdf', url: 'https://drive/y', tipo_mime: 'application/pdf',
    tamano_bytes: 5, fecha_subida: new Date().toISOString()
  });

  const item = SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-0001', 'juan@homepymes.cl').subsolicitudes[0];
  assert.equal(item.archivos.length, 1);
  assert.equal(item.archivos[0].nombre_original, 'captura.png');
  assert.equal(item.archivos[0].url, 'https://drive/x');
  assert.equal(item.archivos[0].tipo_mime, 'image/png');
});

test('estadoPublico no rompe si la tabla ARCHIVOS no existe (tolerante)', () => {
  const db = abrirDb_();
  ['SOLICITUDES', 'SUBSOLICITUDES', 'HISTORIAL_ESTADOS'].forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  seedSolicitud(db);
  seedSubsolicitud(db);
  const item = SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-0001', 'juan@homepymes.cl').subsolicitudes[0];
  assert.ok(Array.isArray(item.archivos));
  assert.equal(item.archivos.length, 0);
});

test('estadoPublico no rompe si la tabla HISTORIAL_ESTADOS no existe (tolerante)', () => {
  const db = abrirDb_();
  ['SOLICITUDES', 'SUBSOLICITUDES', 'ARCHIVOS'].forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  seedSolicitud(db);
  seedSubsolicitud(db);
  const resultado = SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-0001', 'juan@homepymes.cl');
  assert.ok(Array.isArray(resultado.historial));
  assert.equal(resultado.historial.length, 0);
});

test('estadoPublico expone el historial de estados en orden cronologico', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db);
  agregarFila_(db, 'HISTORIAL_ESTADOS', {
    historial_id: 'h1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    estado_anterior: '', estado_nuevo: 'S01', usuario: 'sistema', comentario: '',
    timestamp: '2026-01-01T00:00:00.000Z'
  });
  agregarFila_(db, 'HISTORIAL_ESTADOS', {
    historial_id: 'h2', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    estado_anterior: 'S01', estado_nuevo: 'S02', usuario: 'dev@rld.cl', comentario: 'motivo interno',
    timestamp: '2026-01-02T00:00:00.000Z'
  });

  const historial = SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-0001', 'juan@homepymes.cl').historial;
  assert.equal(historial.length, 2);
  assert.equal(historial[0].estado_nuevo, 'S01');
  assert.equal(historial[0].actor, 'sistema');
  assert.equal(historial[1].estado_nuevo, 'S02');
  assert.equal(historial[1].actor, 'equipo');
});

test('estadoPublico NUNCA expone el correo de staff ni un comentario interno en el historial', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db);
  agregarFila_(db, 'HISTORIAL_ESTADOS', {
    historial_id: 'h1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    estado_anterior: 'S02', estado_nuevo: 'S10', usuario: 'dev@rld.cl',
    comentario: 'motivo interno de rechazo que no debe llegar al cliente',
    timestamp: '2026-01-03T00:00:00.000Z'
  });

  const historial = SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-0001', 'juan@homepymes.cl').historial;
  assert.equal(historial.length, 1);
  assert.equal(historial[0].actor, 'equipo');
  assert.equal(historial[0].comentario, '');
  assert.equal(JSON.stringify(historial).includes('dev@rld.cl'), false);
  assert.equal(JSON.stringify(historial).includes('motivo interno'), false);
});

test('estadoPublico SI expone el comentario del historial cuando lo escribio el propio solicitante', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { estado: 'S08' });
  agregarFila_(db, 'HISTORIAL_ESTADOS', {
    historial_id: 'h1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    estado_anterior: 'S08', estado_nuevo: 'S05', usuario: 'juan@homepymes.cl',
    comentario: 'Todavia falta el reporte de exportacion',
    timestamp: '2026-01-04T00:00:00.000Z'
  });

  const historial = SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-0001', 'juan@homepymes.cl').historial;
  assert.equal(historial[0].actor, 'tu');
  assert.equal(historial[0].comentario, 'Todavia falta el reporte de exportacion');
});

// Fuga de privacidad confirmada por la auditoria de modulos (2026-09):
// historialPublico_ comparaba h.usuario tambien contra
// solicitud.solicitante_email (el empleado que presento la solicitud), no
// solo contra quien esta mirando ahora mismo -- un cliente externo
// (es_cliente, entra por correo_cliente) podia ver un comentario interno
// del EMPLEADO etiquetado como si fuera un comentario propio ("tu").
test('estadoPublico NUNCA etiqueta como "tu" el comentario del empleado cuando quien mira es el cliente externo', () => {
  const db = dbConSchema();
  seedSolicitud(db, {
    es_cliente: true, correo_cliente: 'cliente@empresa.cl', solicitante_email: 'juan@homepymes.cl'
  });
  seedSubsolicitud(db, { estado: 'S08' });
  // El evento lo escribio el EMPLEADO (solicitante_email), con un
  // comentario que podria ser interno.
  agregarFila_(db, 'HISTORIAL_ESTADOS', {
    historial_id: 'h1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    estado_anterior: 'S08', estado_nuevo: 'S05', usuario: 'juan@homepymes.cl',
    comentario: 'nota interna: revisar con el cliente antes de prometer fecha',
    timestamp: '2026-01-04T00:00:00.000Z'
  });

  // El CLIENTE mira su propio historial (correo_cliente, no solicitante_email).
  const historial = SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-0001', 'cliente@empresa.cl').historial;
  assert.equal(historial[0].actor, 'equipo', 'el evento del empleado NO es "tu" para el cliente');
  assert.equal(historial[0].comentario, '', 'el comentario del empleado no se expone al cliente');

  // El propio EMPLEADO, mirando su solicitud, SI ve su comentario como suyo.
  const historialEmpleado = SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-0001', 'juan@homepymes.cl').historial;
  assert.equal(historialEmpleado[0].actor, 'tu');
  assert.equal(historialEmpleado[0].comentario, 'nota interna: revisar con el cliente antes de prometer fecha');
});

test('estadoPublico compara el correo sin distinguir mayusculas/espacios', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db);

  const resultado = SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-0001', '  JUAN@HomePymes.CL  ');
  assert.equal(resultado.solicitud_id, 'SOL-2026-HP-0001');
});

test('estadoPublico tambien acepta el correo del cliente cuando es_cliente=true', () => {
  const db = dbConSchema();
  seedSolicitud(db, { es_cliente: true, correo_cliente: 'cliente@empresa.cl' });
  seedSubsolicitud(db);

  const resultado = SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-0001', 'cliente@empresa.cl');
  assert.equal(resultado.solicitud_id, 'SOL-2026-HP-0001');
});

test('estadoPublico responde forbidden si el correo no coincide', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db);

  const resultado = SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-0001', 'otro@correo.cl');
  assert.equal(resultado._forbidden, true);
});

test('estadoPublico (P2) expone posicion_cola: cuenta solo abiertas de la MISMA empresa con prioridad igual o mas critica', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001', prioridad_derivada: 'P3', estado_derivado: 'S02', fecha_creacion: '2026-01-05T10:00:00.000Z' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0002', prioridad_derivada: 'P1', estado_derivado: 'S02', fecha_creacion: '2026-01-01T10:00:00.000Z' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0003', prioridad_derivada: 'P3', estado_derivado: 'S02', fecha_creacion: '2026-01-10T10:00:00.000Z' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0004', prioridad_derivada: 'P3', estado_derivado: 'S02', fecha_creacion: '2026-01-02T10:00:00.000Z' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0005', prioridad_derivada: 'P1', estado_derivado: 'S09', fecha_creacion: '2026-01-01T10:00:00.000Z' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0001', empresa_id: 'RLD', prioridad_derivada: 'P1', estado_derivado: 'S02', fecha_creacion: '2026-01-01T10:00:00.000Z' });

  const resultado = SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-0001', 'juan@homepymes.cl');
  assert.equal(resultado.posicion_cola, 2);
});

test('estadoPublico (P2) posicion_cola es null si la solicitud ya esta cerrada', () => {
  const db = dbConSchema();
  seedSolicitud(db, { estado_derivado: 'S09' });
  seedSubsolicitud(db, { estado: 'S09' });

  const resultado = SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-0001', 'juan@homepymes.cl');
  assert.equal(resultado.posicion_cola, null);
});

test('estadoPublico: una solicitud inexistente responde IGUAL que una ajena (no se puede enumerar)', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db);
  const inexistente = SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-9999', 'juan@homepymes.cl');
  const ajena = SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-0001', 'otro@correo.cl');
  assert.equal(inexistente._forbidden, true);
  assert.equal(ajena._forbidden, true);
  assert.equal(inexistente.message, ajena.message, 'el mensaje no debe delatar si el numero existe');
});

test('estadoPublico responde error de validacion si falta solicitud_id o email', () => {
  const db = dbConSchema();
  assert.equal(SolicitudesPublico.estadoPublico(db, '', 'a@b.cl')._validationError, true);
  assert.equal(SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-0001', '')._validationError, true);
});

test('estadoPublico corta tras demasiados intentos fallidos y se reinicia con un acierto', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db);

  for (let i = 0; i < 10; i++) {
    SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-9999', 'juan@homepymes.cl');
  }
  const bloqueado = SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-0001', 'juan@homepymes.cl');
  assert.equal(bloqueado._forbidden, true, 'tras 10 fallos, hasta el par correcto queda frenado');

  const otroOk = SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-0001', 'JUAN2@homepymes.cl');
  assert.equal(otroOk._forbidden, true, 'ese correo no es dueño, pero por permisos -- no por el freno');
});

test('estadoPublico: un acierto limpia los intentos fallidos previos del dueño', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db);

  for (let i = 0; i < 5; i++) {
    SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-9999', 'juan@homepymes.cl');
  }
  assert.equal(SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-0001', 'juan@homepymes.cl').solicitud_id, 'SOL-2026-HP-0001');
  for (let i = 0; i < 5; i++) {
    SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-9999', 'juan@homepymes.cl');
  }
  assert.equal(SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-0001', 'juan@homepymes.cl').solicitud_id, 'SOL-2026-HP-0001');
});

test('estadoPublico expone cumplimiento (semaforo del solicitante) por item', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { estado: 'S05' });

  const resultado = SolicitudesPublico.estadoPublico(db, 'SOL-2026-HP-0001', 'juan@homepymes.cl');

  assert.ok(resultado.subsolicitudes[0].cumplimiento);
  assert.equal(typeof resultado.subsolicitudes[0].cumplimiento.codigo, 'string');
});

// --- "Mis solicitudes": correo + codigo -----------------------------------

function conApiKey(t) {
  process.env.RESEND_API_KEY = 're_test_key';
  t.after(() => { delete process.env.RESEND_API_KEY; });
}

function mockEnvioOk(t) {
  return t.mock.method(Resend, 'enviarCorreoResend_', async () => ({ id: 'fake-resend-id' }));
}

function ultimoCodigoEnviado(db) {
  const log = filas(db, 'LOG_NOTIFICACIONES').filter((n) => n.evento.indexOf('CODIGO_ACCESO:') === 0);
  return log[log.length - 1].evento.split(':')[1];
}

test('solicitarCodigoAcceso: siempre responde ok y manda el correo con el codigo', async (t) => {
  conApiKey(t);
  const mock = mockEnvioOk(t);
  const db = dbConSchema();

  const resultado = await SolicitudesPublico.solicitarCodigoAcceso(db, { email: 'juan@homepymes.cl' });

  assert.equal(resultado.ok, true);
  assert.equal(mock.mock.callCount(), 1);
  const log = filas(db, 'LOG_NOTIFICACIONES').filter((n) => n.evento.indexOf('CODIGO_ACCESO:') === 0);
  assert.equal(log.length, 1);
});

test('solicitarCodigoAcceso: responde ok igual aunque el correo no tenga solicitudes (no revela nada)', async (t) => {
  conApiKey(t);
  mockEnvioOk(t);
  const db = dbConSchema();
  const resultado = await SolicitudesPublico.solicitarCodigoAcceso(db, { email: 'nadie@homepymes.cl' });
  assert.equal(resultado.ok, true);
});

test('misSolicitudes: con el codigo correcto, devuelve la lista completa del correo', async (t) => {
  conApiKey(t);
  mockEnvioOk(t);
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0002', estado_derivado: 'S09' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0002-01', solicitud_id: 'SOL-2026-HP-0002', estado: 'S09' });

  await SolicitudesPublico.solicitarCodigoAcceso(db, { email: 'juan@homepymes.cl' });
  const codigo = ultimoCodigoEnviado(db);

  const resultado = SolicitudesPublico.misSolicitudes(db, { email: 'juan@homepymes.cl', codigo: codigo });

  assert.equal(resultado.resumen.total, 2);
  assert.equal(resultado.resumen.abiertas, 1);
  assert.equal(resultado.solicitudes.length, 2);
  const ids = resultado.solicitudes.map((s) => s.solicitud_id).sort();
  assert.deepEqual(ids, ['SOL-2026-HP-0001', 'SOL-2026-HP-0002']);
});

test('misSolicitudes: rechaza un codigo incorrecto', async (t) => {
  conApiKey(t);
  mockEnvioOk(t);
  const db = dbConSchema();
  await SolicitudesPublico.solicitarCodigoAcceso(db, { email: 'juan@homepymes.cl' });

  const resultado = SolicitudesPublico.misSolicitudes(db, { email: 'juan@homepymes.cl', codigo: '000000' });
  assert.equal(resultado._forbidden, true);
});

test('misSolicitudes: el codigo es de un solo uso (no sirve dos veces)', async (t) => {
  conApiKey(t);
  mockEnvioOk(t);
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db);
  await SolicitudesPublico.solicitarCodigoAcceso(db, { email: 'juan@homepymes.cl' });
  const codigo = ultimoCodigoEnviado(db);

  const primero = SolicitudesPublico.misSolicitudes(db, { email: 'juan@homepymes.cl', codigo: codigo });
  const segundo = SolicitudesPublico.misSolicitudes(db, { email: 'juan@homepymes.cl', codigo: codigo });

  assert.equal(primero.resumen.total, 1);
  assert.equal(segundo._forbidden, true);
});

test('misSolicitudes: incluye tambien las solicitudes donde el correo es el cliente (es_cliente)', async (t) => {
  conApiKey(t);
  mockEnvioOk(t);
  const db = dbConSchema();
  seedSolicitud(db, {
    solicitud_id: 'SOL-2026-HP-0003', solicitante_email: 'otra@rld.cl',
    es_cliente: true, correo_cliente: 'cliente@empresa.cl'
  });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0003-01', solicitud_id: 'SOL-2026-HP-0003' });

  await SolicitudesPublico.solicitarCodigoAcceso(db, { email: 'cliente@empresa.cl' });
  const codigo = ultimoCodigoEnviado(db);
  const resultado = SolicitudesPublico.misSolicitudes(db, { email: 'cliente@empresa.cl', codigo: codigo });

  assert.equal(resultado.resumen.total, 1);
  assert.equal(resultado.solicitudes[0].solicitud_id, 'SOL-2026-HP-0003');
});

test('misSolicitudes: semaforo del solicitante -- item Terminada sin validar muestra dias_esperando_max', async (t) => {
  conApiKey(t);
  mockEnvioOk(t);
  const db = dbConSchema();
  const haceTresDiasHabiles = new Date();
  haceTresDiasHabiles.setDate(haceTresDiasHabiles.getDate() - 5);
  seedSolicitud(db, { estado_derivado: 'S08' });
  seedSubsolicitud(db, {
    estado: 'S08',
    fecha_comprometida: haceTresDiasHabiles.toISOString(),
    fecha_terminada: haceTresDiasHabiles.toISOString()
  });

  await SolicitudesPublico.solicitarCodigoAcceso(db, { email: 'juan@homepymes.cl' });
  const codigo = ultimoCodigoEnviado(db);
  const resultado = SolicitudesPublico.misSolicitudes(db, { email: 'juan@homepymes.cl', codigo: codigo });

  assert.equal(resultado.solicitudes[0].items_pendientes_validar, 1);
  assert.ok(resultado.solicitudes[0].dias_esperando_max > 0);
});

// --- "Mis solicitudes" con sesion de plataforma (token) --------------------

const ADMIN = { email: 'admin@homepymes.cl', rol: 'ADM' };

test('misSolicitudes con token junta las solicitudes de TODOS los correos de la cuenta', () => {
  const db = dbConSchema();
  const creada = CuentasPortal.gestionar(db, {
    operacion: 'crear', usuario: 'cpena', nombre: 'Camila', cargo: 'Jefa',
    emails: 'camila@gde.cl, camila.pena@gmail.com', rol: 'SOLICITANTE'
  }, ADMIN);
  assert.ok(!creada._validationError, JSON.stringify(creada));

  seedSolicitud(db, { solicitud_id: 'SOL-2026-GDE-0001', empresa_id: 'GDE', solicitante_email: 'camila@gde.cl' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-GDE-0002', empresa_id: 'GDE', solicitante_email: 'camila.pena@gmail.com' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-GDE-0003', empresa_id: 'GDE', solicitante_email: 'otra.persona@gde.cl' });

  const { token } = Portal.login(db, { usuario: 'cpena', password: creada.password_temporal });
  const res = SolicitudesPublico.misSolicitudes(db, { token: token });

  const ids = res.solicitudes.map((s) => s.solicitud_id).sort();
  assert.deepEqual(ids, ['SOL-2026-GDE-0001', 'SOL-2026-GDE-0002']);
  const porId = {};
  res.solicitudes.forEach((s) => { porId[s.solicitud_id] = s.email_coincidente; });
  assert.equal(porId['SOL-2026-GDE-0001'], 'camila@gde.cl');
  assert.equal(porId['SOL-2026-GDE-0002'], 'camila.pena@gmail.com');
});

test('misSolicitudes con token invalido es forbidden; el camino correo+codigo sigue vivo', async (t) => {
  conApiKey(t);
  mockEnvioOk(t);
  const db = dbConSchema();
  assert.equal(SolicitudesPublico.misSolicitudes(db, { token: 'no-existe' })._forbidden, true);

  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001', solicitante_email: 'juan@homepymes.cl' });
  await SolicitudesPublico.solicitarCodigoAcceso(db, { email: 'juan@homepymes.cl' });
  const codigo = ultimoCodigoEnviado(db);
  const res = SolicitudesPublico.misSolicitudes(db, { email: 'juan@homepymes.cl', codigo: codigo });
  assert.equal(res.solicitudes.length, 1);
});
