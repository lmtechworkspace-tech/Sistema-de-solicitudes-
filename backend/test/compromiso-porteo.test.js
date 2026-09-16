'use strict';

/**
 * Prueba de portabilidad: los mismos escenarios de backend/test/
 * compromiso.test.js (comprometerFecha + sellado de fecha_terminada en
 * actualizarEstado), corridos contra backend/logica/solicitudesBackoffice.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const SolicitudesBO = require('../logica/solicitudesBackoffice');

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}

function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }

function seedSubsolicitud(db, overrides) {
  const base = Object.assign(
    {
      subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001',
      titulo: 'Titulo', descripcion: 'Descripcion', impacto: 'DEGRADACION_IMPORTANTE',
      prioridad: 'P2', estado: 'S03', sla_objetivo_horas: 24, fecha_creacion: new Date().toISOString(),
      fecha_propuesta: '2026-08-01T18:00', fecha_comprometida: '', fecha_terminada: '', comprometida_por: ''
    },
    overrides
  );
  agregarFila_(db, 'SUBSOLICITUDES', base);
  return base;
}

function seedSolicitud(db, overrides) {
  const base = Object.assign(
    {
      solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', plataforma: 'ERP', modulo: 'Facturacion',
      tipo: 'ERROR', solicitante_nombre: 'Juan Perez', solicitante_email: 'juan@homepymes.cl',
      estado_derivado: 'S03', prioridad_derivada: 'P2', dedup_hash: 'x',
      fecha_creacion: new Date().toISOString(), creado_por: 'juan@homepymes.cl'
    },
    overrides
  );
  agregarFila_(db, 'SOLICITUDES', base);
  return base;
}

const DEV = { email: 'dev@homepymes.cl', rol: 'DEV' };
const GERENCIA = { email: 'gerencia@homepymes.cl', rol: 'GERENCIA' };

test('comprometerFecha (v2.1): el desarrollador fija la fecha comprometida por primera vez, sin exigir motivo', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db);

  const resultado = SolicitudesBO.comprometerFecha(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', fecha_comprometida: '2026-08-05T18:00' }, DEV
  );

  assert.equal(resultado.fecha_comprometida, '2026-08-05T18:00');
  assert.equal(resultado.re_compromiso, false);
  assert.equal(resultado.comprometida_por, 'dev@homepymes.cl');

  const subsolicitud = filas(db, 'SUBSOLICITUDES')[0];
  assert.equal(subsolicitud.fecha_comprometida, '2026-08-05T18:00');
  assert.equal(subsolicitud.comprometida_por, 'dev@homepymes.cl');
  assert.equal(filas(db, 'HISTORIAL_COMPROMISO').length, 0);
});

test('comprometerFecha (v2.1): re-comprometer exige motivo (>=20 caracteres) y queda en HISTORIAL_COMPROMISO', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db, { fecha_comprometida: '2026-08-05T18:00', comprometida_por: 'dev@homepymes.cl' });

  const sinMotivo = SolicitudesBO.comprometerFecha(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', fecha_comprometida: '2026-08-10T18:00' }, DEV
  );
  assert.equal(sinMotivo._validationError, true);
  assert.ok(sinMotivo.fields.some((f) => f.campo === 'motivo'));

  const resultado = SolicitudesBO.comprometerFecha(db, {
    subsolicitud_id: 'SOL-2026-HP-0001-01', fecha_comprometida: '2026-08-10T18:00', motivo: 'El cliente amplio el alcance del item'
  }, DEV);
  assert.equal(resultado.re_compromiso, true);

  const historial = filas(db, 'HISTORIAL_COMPROMISO');
  assert.equal(historial.length, 1);
  assert.equal(historial[0].fecha_anterior, '2026-08-05T18:00');
  assert.equal(historial[0].fecha_nueva, '2026-08-10T18:00');
  assert.equal(historial[0].motivo, 'El cliente amplio el alcance del item');
  assert.equal(historial[0].usuario, 'dev@homepymes.cl');
});

test('comprometerFecha (v2.1): Gerencia es de solo lectura, no puede comprometer fechas', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db);

  const resultado = SolicitudesBO.comprometerFecha(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', fecha_comprometida: '2026-08-05T18:00' }, GERENCIA
  );
  assert.equal(resultado._forbidden, true);
  assert.equal(filas(db, 'SUBSOLICITUDES')[0].fecha_comprometida, '');
});

test('comprometerFecha (v2.1): rechaza una fecha invalida o un item inexistente', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db);

  const fechaInvalida = SolicitudesBO.comprometerFecha(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', fecha_comprometida: 'no-es-una-fecha' }, DEV
  );
  assert.equal(fechaInvalida._validationError, true);

  const itemInexistente = SolicitudesBO.comprometerFecha(db,
    { subsolicitud_id: 'NO-EXISTE', fecha_comprometida: '2026-08-05T18:00' }, DEV
  );
  assert.equal(itemInexistente._validationError, true);
});

test('actualizarEstado (v2.1): marcar Terminada (S08) sella fecha_terminada -- detiene el reloj del desarrollador', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db, { estado: 'S07', fecha_comprometida: '2026-08-05T18:00' });

  SolicitudesBO.actualizarEstado(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S08' }, DEV);

  const subsolicitud = filas(db, 'SUBSOLICITUDES')[0];
  assert.equal(subsolicitud.estado, 'S08');
  assert.ok(subsolicitud.fecha_terminada);
});

test('actualizarEstado (v2.1): reabrir un item que estaba Terminada limpia fecha_terminada -- reanuda el reloj', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db, {
    estado: 'S08', fecha_comprometida: '2026-08-05T18:00', fecha_terminada: '2026-08-04T12:00:00.000Z'
  });

  SolicitudesBO.actualizarEstado(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S05', comentario: 'Faltaba un caso de prueba' }, DEV
  );

  const subsolicitud = filas(db, 'SUBSOLICITUDES')[0];
  assert.equal(subsolicitud.estado, 'S05');
  assert.equal(subsolicitud.fecha_terminada, '');
});

test('actualizarEstado (v2.1): transiciones que no tocan S08 no modifican fecha_terminada', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db, { estado: 'S03', fecha_terminada: '' });

  SolicitudesBO.actualizarEstado(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S04' }, DEV);

  assert.equal(filas(db, 'SUBSOLICITUDES')[0].fecha_terminada, '');
});
