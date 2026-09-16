'use strict';

/**
 * Prueba de portabilidad: los escenarios de backend/test/derivacion.test.js
 * que NO dependen de getDetalle ni del correo HTML+PDF adjunto (ninguno de
 * los dos portado todavia -- ver notas en solicitudesBackoffice.js y
 * notificaciones.js), corridos contra solicitudesBackoffice.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const SolicitudesBO = require('../logica/solicitudesBackoffice');

const LEO = 'leo@rld.cl';
const LUIS = 'control_luis@rld.cl';
const ANALISTA = 'analista@homepymes.cl';

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}

function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }

// Crea una solicitud con `cantidadItems` items, todos asignados a `responsable`.
function seedSolicitud(db, solicitudId, responsable, cantidadItems) {
  agregarFila_(db, 'SOLICITUDES', {
    solicitud_id: solicitudId, empresa_id: 'HP', plataforma: 'ERP', modulo: 'Facturacion',
    tipo: 'ERR', solicitante_nombre: 'Juan', solicitante_email: 'juan@homepymes.cl',
    estado_derivado: 'S02', prioridad_derivada: 'P2', desarrollador_asignado: responsable,
    fecha_creacion: '2026-01-01T10:00:00.000Z', dedup_hash: solicitudId
  });
  for (let i = 1; i <= (cantidadItems || 1); i++) {
    agregarFila_(db, 'SUBSOLICITUDES', {
      subsolicitud_id: solicitudId + '-0' + i, solicitud_id: solicitudId, numero_item: i,
      titulo: 'Item ' + i, descripcion: 'Desc', estado: 'S02', prioridad: 'P2',
      desarrollador_asignado: responsable, fecha_creacion: '2026-01-01T10:00:00.000Z'
    });
  }
}

function historial(db) { return filas(db, 'HISTORIAL_ASIGNACION'); }

test('derivar una solicitud completa mueve todos sus items y la cabecera', () => {
  const db = dbConSchema();
  seedSolicitud(db, 'SOL-2026-HP-0001', LUIS, 2);

  const res = SolicitudesBO.derivarSolicitud(db,
    { solicitud_id: 'SOL-2026-HP-0001', responsable_nuevo: LEO, motivo: 'corresponde a Leo, fin de la fase de pruebas' },
    { email: ANALISTA, rol: 'ANA' }
  );

  assert.equal(res.total, 1);
  const items = filas(db, 'SUBSOLICITUDES');
  assert.equal(items.length, 2);
  items.forEach((item) => assert.equal(item.desarrollador_asignado, LEO));
  assert.equal(filas(db, 'SOLICITUDES')[0].desarrollador_asignado, LEO);
});

test('derivar deja registro en HISTORIAL_ASIGNACION con el anterior, el nuevo y el motivo', () => {
  const db = dbConSchema();
  seedSolicitud(db, 'SOL-2026-HP-0001', LUIS, 1);

  SolicitudesBO.derivarSolicitud(db,
    { solicitud_id: 'SOL-2026-HP-0001', responsable_nuevo: LEO, motivo: 'corresponde a Leo, fin de la fase de pruebas' },
    { email: ANALISTA, rol: 'ANA' }
  );

  const filasHist = historial(db);
  assert.equal(filasHist.length, 1);
  assert.equal(filasHist[0].solicitud_id, 'SOL-2026-HP-0001');
  assert.equal(filasHist[0].responsable_anterior, LUIS);
  assert.equal(filasHist[0].responsable_nuevo, LEO);
  assert.equal(filasHist[0].usuario, ANALISTA);
  assert.match(filasHist[0].motivo, /corresponde a Leo/);
  assert.equal(filasHist[0].subsolicitud_id, '');
});

test('derivar un item puntual no toca a los hermanos ni la cabecera', () => {
  const db = dbConSchema();
  seedSolicitud(db, 'SOL-2026-HP-0001', LUIS, 2);

  SolicitudesBO.derivarSolicitud(db, {
    solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    responsable_nuevo: LEO, motivo: 'este item es de base de datos'
  }, { email: ANALISTA, rol: 'ANA' });

  const items = filas(db, 'SUBSOLICITUDES');
  assert.equal(items.find((s) => s.subsolicitud_id === 'SOL-2026-HP-0001-01').desarrollador_asignado, LEO);
  assert.equal(items.find((s) => s.subsolicitud_id === 'SOL-2026-HP-0001-02').desarrollador_asignado, LUIS);
  assert.equal(filas(db, 'SOLICITUDES')[0].desarrollador_asignado, LUIS);
  assert.equal(historial(db)[0].subsolicitud_id, 'SOL-2026-HP-0001-01');
});

test('el motivo es obligatorio (minimo 10 caracteres)', () => {
  const db = dbConSchema();
  seedSolicitud(db, 'SOL-2026-HP-0001', LUIS, 1);

  const res = SolicitudesBO.derivarSolicitud(db,
    { solicitud_id: 'SOL-2026-HP-0001', responsable_nuevo: LEO, motivo: 'porque' },
    { email: ANALISTA, rol: 'ANA' }
  );

  assert.equal(res._validationError, true);
  assert.equal(historial(db).length, 0);
  assert.equal(filas(db, 'SUBSOLICITUDES')[0].desarrollador_asignado, LUIS);
});

test('un DEV puede derivar lo suyo', () => {
  const db = dbConSchema();
  seedSolicitud(db, 'SOL-2026-HP-0001', LUIS, 1);

  const res = SolicitudesBO.derivarSolicitud(db,
    { solicitud_id: 'SOL-2026-HP-0001', responsable_nuevo: LEO, motivo: 'me voy de vacaciones la proxima semana' },
    { email: LUIS, rol: 'DEV' }
  );

  assert.equal(res.total, 1);
  assert.equal(filas(db, 'SUBSOLICITUDES')[0].desarrollador_asignado, LEO);
});

test('un DEV NO puede derivar trabajo ajeno', () => {
  const db = dbConSchema();
  seedSolicitud(db, 'SOL-2026-HP-0001', LEO, 1);

  const res = SolicitudesBO.derivarSolicitud(db,
    { solicitud_id: 'SOL-2026-HP-0001', responsable_nuevo: LUIS, motivo: 'me la quiero llevar a mi bandeja' },
    { email: LUIS, rol: 'DEV' }
  );

  assert.equal(res._forbidden, true);
  assert.equal(historial(db).length, 0);
  assert.equal(filas(db, 'SUBSOLICITUDES')[0].desarrollador_asignado, LEO);
});

test('Gerencia es de solo lectura: no puede derivar', () => {
  const db = dbConSchema();
  seedSolicitud(db, 'SOL-2026-HP-0001', LUIS, 1);

  const res = SolicitudesBO.derivarSolicitud(db,
    { solicitud_id: 'SOL-2026-HP-0001', responsable_nuevo: LEO, motivo: 'deberia estar con Leo' },
    { email: 'gerencia@homepymes.cl', rol: 'GERENCIA' }
  );

  assert.equal(res._forbidden, true);
  assert.equal(historial(db).length, 0);
});

test('la derivacion en lote escribe una fila de historial por solicitud', () => {
  const db = dbConSchema();
  seedSolicitud(db, 'SOL-2026-HP-0001', LUIS, 1);
  seedSolicitud(db, 'SOL-2026-HP-0002', LUIS, 1);
  seedSolicitud(db, 'SOL-2026-HP-0003', LUIS, 1);

  const res = SolicitudesBO.derivarSolicitud(db, {
    solicitud_ids: ['SOL-2026-HP-0001', 'SOL-2026-HP-0002', 'SOL-2026-HP-0003'],
    responsable_nuevo: LEO, motivo: 'traspaso de la bandeja de pruebas a Leo'
  }, { email: ANALISTA, rol: 'ANA' });

  assert.equal(res.total, 3);
  assert.equal(historial(db).length, 3);
  filas(db, 'SUBSOLICITUDES').forEach((s) => assert.equal(s.desarrollador_asignado, LEO));
});

test('un id invalido aborta el lote completo sin dejar nada a medias', () => {
  const db = dbConSchema();
  seedSolicitud(db, 'SOL-2026-HP-0001', LUIS, 1);

  const res = SolicitudesBO.derivarSolicitud(db, {
    solicitud_ids: ['SOL-2026-HP-0001', 'SOL-2026-HP-9999'],
    responsable_nuevo: LEO, motivo: 'traspaso de la bandeja de pruebas a Leo'
  }, { email: ANALISTA, rol: 'ANA' });

  assert.equal(res._validationError, true);
  assert.match(res.message, /SOL-2026-HP-9999/);
  assert.equal(historial(db).length, 0);
  assert.equal(filas(db, 'SUBSOLICITUDES')[0].desarrollador_asignado, LUIS);
  assert.equal(filas(db, 'SOLICITUDES')[0].desarrollador_asignado, LUIS);
});

test('el lote es por solicitud completa, no acepta subsolicitud_id', () => {
  const db = dbConSchema();
  seedSolicitud(db, 'SOL-2026-HP-0001', LUIS, 1);

  const res = SolicitudesBO.derivarSolicitud(db, {
    solicitud_ids: ['SOL-2026-HP-0001'], subsolicitud_id: 'SOL-2026-HP-0001-01',
    responsable_nuevo: LEO, motivo: 'traspaso de la bandeja de pruebas'
  }, { email: ANALISTA, rol: 'ANA' });

  assert.equal(res._validationError, true);
});
