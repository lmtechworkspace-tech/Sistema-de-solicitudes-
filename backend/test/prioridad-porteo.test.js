'use strict';

/**
 * Prueba de portabilidad: los mismos escenarios de backend/test/
 * prioridad.test.js (actualizarPrioridad + asignarResponsables_), corridos
 * contra backend/logica/solicitudesBackoffice.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const SolicitudesBO = require('../logica/solicitudesBackoffice');

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  sembrarTabla_(db, 'CONFIG_SLA', COLUMNAS.CONFIG_SLA, [['P1', 2], ['P2', 24], ['P3', 72], ['P4', 120], ['P5', '']]);
  return db;
}

function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }

function seedSubsolicitud(db, overrides) {
  const base = Object.assign(
    {
      subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001',
      titulo: 'Titulo', descripcion: 'Descripcion', impacto: 'DEGRADACION_IMPORTANTE',
      prioridad: 'P2', estado: 'S03', sla_objetivo_horas: 24, fecha_creacion: new Date().toISOString()
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

const JUSTIFICACION_VALIDA = 'Se reevalua por nuevo impacto reportado';

test('actualizarPrioridad (RN-007): Analista puede cambiar la prioridad con justificacion valida y queda en historial', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db);

  const resultado = SolicitudesBO.actualizarPrioridad(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', prioridad_nueva: 'P1', justificacion: JUSTIFICACION_VALIDA },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );

  assert.equal(resultado.prioridad_anterior, 'P2');
  assert.equal(resultado.prioridad_nueva, 'P1');
  assert.equal(resultado.prioridad_derivada_padre, 'P1');

  const subsolicitudes = filas(db, 'SUBSOLICITUDES');
  assert.equal(subsolicitudes[0].prioridad, 'P1');
  assert.equal(subsolicitudes[0].sla_objetivo_horas, 2);

  const historial = filas(db, 'HISTORIAL_PRIORIDAD');
  assert.equal(historial.length, 1);
  assert.equal(historial[0].prioridad_anterior, 'P2');
  assert.equal(historial[0].prioridad_nueva, 'P1');
});

test('actualizarPrioridad (RN-007): se puede modificar mas de una vez, sin tope', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db);

  SolicitudesBO.actualizarPrioridad(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', prioridad_nueva: 'P1', justificacion: JUSTIFICACION_VALIDA },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  const segundo = SolicitudesBO.actualizarPrioridad(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', prioridad_nueva: 'P3', justificacion: JUSTIFICACION_VALIDA },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );

  assert.equal(segundo.prioridad_anterior, 'P1');
  assert.equal(segundo.prioridad_nueva, 'P3');
  assert.equal(filas(db, 'HISTORIAL_PRIORIDAD').length, 2);
});

test('actualizarPrioridad (RN-007): exige justificacion de al menos 20 caracteres', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db);

  const resultado = SolicitudesBO.actualizarPrioridad(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', prioridad_nueva: 'P1', justificacion: 'muy corta' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(resultado._validationError, true);
});

test('actualizarPrioridad (RN-008): el Desarrollador no puede modificar la prioridad', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db);

  const resultado = SolicitudesBO.actualizarPrioridad(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', prioridad_nueva: 'P1', justificacion: JUSTIFICACION_VALIDA },
    { email: 'dev@homepymes.cl', rol: 'DEV' }
  );
  assert.equal(resultado._forbidden, true);
});

test('actualizarPrioridad rechaza un valor de prioridad invalido', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db);

  const resultado = SolicitudesBO.actualizarPrioridad(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', prioridad_nueva: 'P9', justificacion: JUSTIFICACION_VALIDA },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(resultado._validationError, true);
});

test('actualizarPrioridad (RN-009): solo Admin puede fijar orden_atencion', () => {
  const db = dbConSchema();
  seedSolicitud(db);

  const comoAnalista = SolicitudesBO.actualizarPrioridad(db,
    { solicitud_id: 'SOL-2026-HP-0001', orden_atencion: 1 },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(comoAnalista._forbidden, true);

  const comoAdmin = SolicitudesBO.actualizarPrioridad(db,
    { solicitud_id: 'SOL-2026-HP-0001', orden_atencion: 1 },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );
  assert.equal(comoAdmin.orden_atencion, 1);
  assert.equal(filas(db, 'SOLICITUDES')[0].orden_atencion, 1);
});

test('actualizarPrioridad: Analista puede asignar el desarrollador responsable', () => {
  const db = dbConSchema();
  seedSolicitud(db);

  const resultado = SolicitudesBO.actualizarPrioridad(db,
    { solicitud_id: 'SOL-2026-HP-0001', desarrollador_asignado: 'dev@homepymes.cl' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );

  assert.equal(resultado.desarrollador_asignado, 'dev@homepymes.cl');
  assert.equal(filas(db, 'SOLICITUDES')[0].desarrollador_asignado, 'dev@homepymes.cl');
});

test('actualizarPrioridad: el Desarrollador no puede asignar responsables (RN-008 style)', () => {
  const db = dbConSchema();
  seedSolicitud(db);

  const resultado = SolicitudesBO.actualizarPrioridad(db,
    { solicitud_id: 'SOL-2026-HP-0001', desarrollador_asignado: 'dev@homepymes.cl' },
    { email: 'dev@homepymes.cl', rol: 'DEV' }
  );
  assert.equal(resultado._forbidden, true);
});

test('actualizarPrioridad: solo Admin puede reasignar el analista responsable', () => {
  const db = dbConSchema();
  seedSolicitud(db);

  const comoAnalista = SolicitudesBO.actualizarPrioridad(db,
    { solicitud_id: 'SOL-2026-HP-0001', analista_asignado: 'otro-analista@homepymes.cl' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(comoAnalista._forbidden, true);

  const comoAdmin = SolicitudesBO.actualizarPrioridad(db,
    { solicitud_id: 'SOL-2026-HP-0001', analista_asignado: 'otro-analista@homepymes.cl' },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );
  assert.equal(comoAdmin.analista_asignado, 'otro-analista@homepymes.cl');
});

test('actualizarPrioridad: Analista puede asignar el desarrollador de una subsolicitud puntual (§13.3 v1.0)', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-01' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-02' });

  const resultado = SolicitudesBO.actualizarPrioridad(db,
    { solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-02', desarrollador_asignado: 'dev-b@homepymes.cl' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );

  assert.equal(resultado.subsolicitud_id, 'SOL-2026-HP-0001-02');
  assert.equal(resultado.desarrollador_asignado, 'dev-b@homepymes.cl');

  const subsolicitudes = filas(db, 'SUBSOLICITUDES');
  const sub1 = subsolicitudes.find((s) => s.subsolicitud_id === 'SOL-2026-HP-0001-01');
  const sub2 = subsolicitudes.find((s) => s.subsolicitud_id === 'SOL-2026-HP-0001-02');
  assert.equal(sub2.desarrollador_asignado, 'dev-b@homepymes.cl');
  assert.equal(sub1.desarrollador_asignado, '');
  assert.equal(filas(db, 'SOLICITUDES')[0].desarrollador_asignado, '');
});

test('actualizarPrioridad (asignacion por subsolicitud): responde error de validacion si la subsolicitud no existe', () => {
  const db = dbConSchema();
  seedSolicitud(db);

  const resultado = SolicitudesBO.actualizarPrioridad(db,
    { solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-9999-01', desarrollador_asignado: 'dev@homepymes.cl' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(resultado._validationError, true);
});

test('actualizarPrioridad (asignacion): responde error de validacion si la solicitud no existe', () => {
  const db = dbConSchema();
  const resultado = SolicitudesBO.actualizarPrioridad(db,
    { solicitud_id: 'SOL-2026-HP-9999', desarrollador_asignado: 'dev@homepymes.cl' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(resultado._validationError, true);
});
