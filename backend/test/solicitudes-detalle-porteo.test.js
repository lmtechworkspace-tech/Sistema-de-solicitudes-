'use strict';

/**
 * Prueba de portabilidad: los mismos escenarios de backend/test/
 * solicitudes-detalle.test.js (getDetalle + editarContenidoSubsolicitud),
 * corridos contra backend/logica/solicitudesBackoffice.js. No se porta
 * "doPost action=getSolicitudDetalle end-to-end": esa integracion HTTP se
 * prueba aparte (backend/test/server-solicitudes.test.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, actualizarFilaPorId_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const SolicitudesBO = require('../logica/solicitudesBackoffice');

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}

function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }

function seedSolicitud(db) {
  agregarFila_(db, 'SOLICITUDES', {
    solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', plataforma: 'ERP', modulo: 'Facturacion',
    tipo: 'ERR', solicitante_nombre: 'Juan', solicitante_cargo: 'Analista', solicitante_email: 'juan@homepymes.cl',
    estado_derivado: 'S02', prioridad_derivada: 'P2', dedup_hash: 'x',
    fecha_creacion: new Date().toISOString(), creado_por: 'juan@homepymes.cl'
  });
  agregarFila_(db, 'SUBSOLICITUDES', {
    subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001', numero_item: 1,
    titulo: 'Titulo', descripcion: 'Desc', estado: 'S02', prioridad: 'P2', fecha_creacion: new Date().toISOString()
  });
}

test('getDetalle devuelve solicitud, subsolicitudes, historial y comentarios', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  agregarFila_(db, 'HISTORIAL_ESTADOS', {
    historial_id: 'H1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    estado_anterior: '', estado_nuevo: 'S01', usuario: 'sistema', comentario: 'Creada', timestamp: '2026-01-01T10:00:00.000Z'
  });
  agregarFila_(db, 'HISTORIAL_ESTADOS', {
    historial_id: 'H2', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    estado_anterior: 'S01', estado_nuevo: 'S02', usuario: 'analista@homepymes.cl', comentario: 'Recibida', timestamp: '2026-01-02T10:00:00.000Z'
  });

  const detalle = SolicitudesBO.getDetalle(db, 'SOL-2026-HP-0001');

  assert.equal(detalle.solicitud.solicitud_id, 'SOL-2026-HP-0001');
  assert.equal(detalle.subsolicitudes.length, 1);
  assert.equal(detalle.historial_estados.length, 2);
  assert.equal(detalle.historial_estados[0].estado_nuevo, 'S01');
  assert.equal(detalle.historial_estados[1].estado_nuevo, 'S02');
  assert.equal(detalle.comentarios.length, 0);
  assert.equal(detalle.archivos.length, 0);
});

// NO PORTADO IGUAL A PROPOSITO (ver la nota en fechaHoraCelda_,
// solicitudesBackoffice.js): el original probaba un bug de Sheets (una
// celda de fecha-hora vuelve como Date al leerla, y se serializaba en UTC).
// Ese bug de origen no existe en SQLite -- aqui se prueba que un string ISO
// normal (lo que TODO el codigo de este proyecto realmente pasa) se
// preserva tal cual, sin que fechaHoraCelda_ le toque nada.
test('getDetalle preserva fecha_comprometida (string ISO) tal cual, sin tocarla', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  actualizarFilaPorId_(db, 'SUBSOLICITUDES', 'subsolicitud_id', 'SOL-2026-HP-0001-01', {
    fecha_comprometida: '2026-07-24T09:30'
  });

  const detalle = SolicitudesBO.getDetalle(db, 'SOL-2026-HP-0001');
  assert.equal(detalle.subsolicitudes[0].fecha_comprometida, '2026-07-24T09:30');
});

test('getDetalle (v2.1) agrega cumplimiento a cada subsolicitud', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  const detalle = SolicitudesBO.getDetalle(db, 'SOL-2026-HP-0001');
  assert.equal(detalle.subsolicitudes[0].cumplimiento.codigo, 'SIN_COMPROMISO');
});

test('getDetalle incluye los archivos de la solicitud (Fase 9, para la galeria del panel)', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  agregarFila_(db, 'ARCHIVOS', { archivo_id: 'A1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: '', nombre_original: 'general.png', url: 'https://drive/general', tipo_mime: 'image/png', tamano_bytes: 1000, fecha_subida: '2026-01-01T10:00:00.000Z' });
  agregarFila_(db, 'ARCHIVOS', { archivo_id: 'A2', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01', nombre_original: 'item.png', url: 'https://drive/item', tipo_mime: 'image/png', tamano_bytes: 1000, fecha_subida: '2026-01-01T10:00:00.000Z' });
  agregarFila_(db, 'ARCHIVOS', { archivo_id: 'A3', solicitud_id: 'SOL-2026-HP-9999', subsolicitud_id: '', nombre_original: 'otra.png', url: 'https://drive/otra', tipo_mime: 'image/png', tamano_bytes: 1000, fecha_subida: '2026-01-01T10:00:00.000Z' });

  const detalle = SolicitudesBO.getDetalle(db, 'SOL-2026-HP-0001');

  assert.equal(detalle.archivos.length, 2);
  assert.ok(detalle.archivos.some((a) => a.archivo_id === 'A1' && !a.subsolicitud_id));
  assert.ok(detalle.archivos.some((a) => a.archivo_id === 'A2' && a.subsolicitud_id === 'SOL-2026-HP-0001-01'));
});

test('getDetalle ofrece los 11 estados menos el actual (y menos Cerrada, RN-201), iguales para cualquier rol', () => {
  const db = dbConSchema();
  seedSolicitud(db); // subsolicitud en S02, tipo ERR (no es consulta tecnica)

  const comoAnalista = SolicitudesBO.getDetalle(db, 'SOL-2026-HP-0001', { rol: 'ANA', email: 'a@a.cl' });
  const comoDev = SolicitudesBO.getDetalle(db, 'SOL-2026-HP-0001', { rol: 'DEV', email: 'd@d.cl' });

  const opcionesAna = comoAnalista.transiciones_por_subsolicitud['SOL-2026-HP-0001-01'];
  const estadosAna = opcionesAna.map((o) => o.estado).sort();
  assert.equal(estadosAna.length, 9);
  assert.ok(estadosAna.indexOf('S02') === -1, 'no debe ofrecer el estado actual como destino');
  assert.ok(estadosAna.indexOf('S09') === -1, 'no debe ofrecer Cerrada: la fija el solicitante (RN-201)');

  const opcionesDev = comoDev.transiciones_por_subsolicitud['SOL-2026-HP-0001-01'];
  const estadosDev = opcionesDev.map((o) => o.estado).sort();
  assert.deepEqual(estadosDev, estadosAna);

  const s10 = opcionesAna.find((o) => o.estado === 'S10');
  const s03 = opcionesAna.find((o) => o.estado === 'S03');
  assert.equal(s10.comentario_obligatorio, true);
  assert.equal(s03.comentario_obligatorio, false);
});

test('getDetalle (P6): al rol GERENCIA no se le ofrece ninguna transicion (solo lectura)', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  const detalle = SolicitudesBO.getDetalle(db, 'SOL-2026-HP-0001', { rol: 'GERENCIA', email: 'g@x.cl' });
  assert.equal(detalle.transiciones_por_subsolicitud['SOL-2026-HP-0001-01'].length, 0);
});

test('getDetalle responde error de validacion si la solicitud no existe', () => {
  const db = dbConSchema();
  const detalle = SolicitudesBO.getDetalle(db, 'SOL-2026-HP-9999');
  assert.equal(detalle._validationError, true);
});

test('editarContenidoSubsolicitud (staff) corrige el item y deja traza, sin limite de estado', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  actualizarFilaPorId_(db, 'SUBSOLICITUDES', 'subsolicitud_id', 'SOL-2026-HP-0001-01', { estado: 'S05' });

  const r = SolicitudesBO.editarContenidoSubsolicitud(db, {
    subsolicitud_id: 'SOL-2026-HP-0001-01', titulo: 'Titulo corregido por Leo',
    descripcion: 'Descripcion corregida por el equipo', contexto: 'ctx', resultado_esperado: ''
  }, { rol: 'DEV', email: 'dev@homepymes.cl' });

  assert.equal(r.ok, true);
  assert.ok(r.cambios >= 1);
  const sub = filas(db, 'SUBSOLICITUDES')[0];
  assert.equal(sub.titulo, 'Titulo corregido por Leo');
  assert.equal(sub.descripcion, 'Descripcion corregida por el equipo');

  const com = filas(db, 'COMENTARIOS');
  assert.equal(com.length, 1);
  assert.equal(com[0].es_interno, true);
  assert.equal(com[0].usuario, 'dev@homepymes.cl');
  assert.match(com[0].texto, /Corrigió el contenido/);
});

test('editarContenidoSubsolicitud rechaza roles de solo lectura y textos vacios', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  assert.equal(SolicitudesBO.editarContenidoSubsolicitud(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', titulo: 'abc', descripcion: 'abcdef' },
    { rol: 'GERENCIA', email: 'g@x.cl' }
  )._forbidden, true);
  assert.equal(SolicitudesBO.editarContenidoSubsolicitud(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', titulo: 'a', descripcion: 'abcdef' },
    { rol: 'ADM', email: 'a@x.cl' }
  )._validationError, true);
});
