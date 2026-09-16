'use strict';

/**
 * Prueba de portabilidad: los escenarios de backend/test/maquina-estados.
 * test.js que NO dependen de getDetalle (no portado todavia -- necesita
 * Sla.gs/Cumplimiento.gs/Jefatura.gs), corridos contra
 * backend/logica/solicitudesBackoffice.js.
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
      prioridad: 'P2', estado: 'S01', sla_objetivo_horas: 24, fecha_creacion: new Date().toISOString()
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
      estado_derivado: 'S01', prioridad_derivada: 'P2', dedup_hash: 'x',
      fecha_creacion: new Date().toISOString(), creado_por: 'juan@homepymes.cl'
    },
    overrides
  );
  agregarFila_(db, 'SOLICITUDES', base);
  return base;
}

test('actualizarEstado aplica una transicion valida y registra HISTORIAL_ESTADOS', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db, { estado: 'S01' });

  const resultado = SolicitudesBO.actualizarEstado(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S02' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );

  assert.equal(resultado.estado_anterior, 'S01');
  assert.equal(resultado.estado_nuevo, 'S02');
  assert.equal(resultado.estado_derivado_padre, 'S02');

  const historial = filas(db, 'HISTORIAL_ESTADOS');
  assert.equal(historial.length, 1);
  assert.equal(historial[0].usuario, 'analista@homepymes.cl');
});

test('actualizarEstado rechaza un estado_nuevo que no existe', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db, { estado: 'S01' });

  const resultado = SolicitudesBO.actualizarEstado(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S99' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(resultado._validationError, true);
});

test('actualizarEstado rechaza fijar el mismo estado en el que ya esta', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db, { estado: 'S03' });

  const resultado = SolicitudesBO.actualizarEstado(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S03' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(resultado._validationError, true);
});

test('actualizarEstado (Fase 10.1, "Leo hace todo"): cualquier rol puede saltar a cualquier estado', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db, { estado: 'S01' });

  const resultado = SolicitudesBO.actualizarEstado(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S05' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(resultado.estado_nuevo, 'S05');
});

test('actualizarEstado exige comentario obligatorio al pasar a "esperando informacion" (S06)', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db, { estado: 'S03' });

  const sinComentario = SolicitudesBO.actualizarEstado(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S06' },
    { email: 'dev@homepymes.cl', rol: 'DEV' }
  );
  assert.equal(sinComentario._validationError, true);

  const conComentario = SolicitudesBO.actualizarEstado(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S06', comentario: '¿Cual es el numero de factura afectado?' },
    { email: 'dev@homepymes.cl', rol: 'DEV' }
  );
  assert.equal(conComentario.estado_nuevo, 'S06');
});

test('actualizarEstado exige comentario para Rechazar (S10)', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db, { estado: 'S03' });

  const sinComentario = SolicitudesBO.actualizarEstado(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S10' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(sinComentario._validationError, true);

  const conComentario = SolicitudesBO.actualizarEstado(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S10', comentario: 'No es un bug, es comportamiento esperado' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(conComentario.estado_nuevo, 'S10');
});

test('actualizarEstado exige comentario para Cancelar (S11)', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db, { estado: 'S03' });

  const resultado = SolicitudesBO.actualizarEstado(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S11' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(resultado._validationError, true);
});

test('actualizarEstado (RN-201): exige comentario al cerrar directo (S09) sin pasar por Terminada, aun siendo consulta tecnica', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db, { estado: 'S02', tipo: 'CON' });

  const sinComentario = SolicitudesBO.actualizarEstado(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S09' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(sinComentario._validationError, true);

  const conComentario = SolicitudesBO.actualizarEstado(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S09', comentario: 'Respuesta: se explico el uso del modulo.' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(conComentario.estado_nuevo, 'S09');
});

test('actualizarEstado (RN-201): el gestor NO puede cerrar (S09) un item que no es consulta tecnica, ni desde Terminada', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db, { estado: 'S08', tipo: 'ERR' });

  const resultado = SolicitudesBO.actualizarEstado(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S09' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(resultado._forbidden, true);
  assert.equal(filas(db, 'SUBSOLICITUDES')[0].estado, 'S08');
});

test('actualizarEstado (RN-201): una consulta tecnica (CON) SI puede cerrarla directo el gestor desde Terminada', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db, { estado: 'S08', tipo: 'CON' });

  const resultado = SolicitudesBO.actualizarEstado(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S09' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(resultado.estado_nuevo, 'S09');
});

test('actualizarEstado (RN-201): el cierre automatico por inactividad si puede cerrar un item que no es consulta tecnica', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db, { estado: 'S08', tipo: 'ERR' });

  const resultado = SolicitudesBO.actualizarEstado(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S09', comentario: 'Cierre automatico de prueba' },
    { email: 'sistema@sigso', rol: 'ADM' },
    { sistemaAutomatico: true }
  );
  assert.equal(resultado.estado_nuevo, 'S09');
});

test('actualizarEstado (P6): el rol GERENCIA no puede cambiar ningun estado', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db, { estado: 'S01' });

  const resultado = SolicitudesBO.actualizarEstado(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S02' },
    { email: 'gerente@homepymes.cl', rol: 'GERENCIA' }
  );
  assert.equal(resultado._forbidden, true);
  assert.equal(filas(db, 'SUBSOLICITUDES')[0].estado, 'S01');
});

test('actualizarEstado aplica RN-015: no pasa a S04 si alguna subsolicitud hermana no tiene titulo/descripcion', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', estado: 'S03' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-02', estado: 'S03', titulo: '', descripcion: '' });

  const resultado = SolicitudesBO.actualizarEstado(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S04' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(resultado._validationError, true);
});

test('estado_derivado del padre es el minimo entre subsolicitudes activas (§8.2)', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', estado: 'S05' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-02', estado: 'S07' });

  SolicitudesBO.recalcularEstadoDerivado_(db, 'SOL-2026-HP-0001');
  assert.equal(filas(db, 'SOLICITUDES')[0].estado_derivado, 'S05');
});

test('estado_derivado ignora subsolicitudes rechazadas/canceladas (§8.2)', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', estado: 'S08' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-02', estado: 'S10' });

  SolicitudesBO.recalcularEstadoDerivado_(db, 'SOL-2026-HP-0001');
  assert.equal(filas(db, 'SOLICITUDES')[0].estado_derivado, 'S08');
});

test('estado_derivado pasa a S09 solo si TODAS las hijas no rechazadas estan en S09', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', estado: 'S09' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-02', estado: 'S11' });

  SolicitudesBO.recalcularEstadoDerivado_(db, 'SOL-2026-HP-0001');
  assert.equal(filas(db, 'SOLICITUDES')[0].estado_derivado, 'S09');
});

test('estado_derivado pasa a S10 si todas las hijas estan rechazadas/canceladas con al menos una S10', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', estado: 'S10' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-02', estado: 'S11' });

  SolicitudesBO.recalcularEstadoDerivado_(db, 'SOL-2026-HP-0001');
  assert.equal(filas(db, 'SOLICITUDES')[0].estado_derivado, 'S10');
});

test('reabrir un ticket cerrado (S09) exige comentario, sin importar el rol (Fase 10.1)', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db, { estado: 'S09' });

  const sinComentario = SolicitudesBO.actualizarEstado(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S05' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(sinComentario._validationError, true);

  const conComentario = SolicitudesBO.actualizarEstado(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S05', comentario: 'Se detecto que el problema persiste' },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(conComentario.estado_nuevo, 'S05');
});

test('reabrir un ticket rechazado (S10) exige comentario', () => {
  const db = dbConSchema();
  seedSolicitud(db); seedSubsolicitud(db, { estado: 'S10' });

  const sinComentario = SolicitudesBO.actualizarEstado(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S03' },
    { email: 'dev@homepymes.cl', rol: 'DEV' }
  );
  assert.equal(sinComentario._validationError, true);

  const conComentario = SolicitudesBO.actualizarEstado(db,
    { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_nuevo: 'S03', comentario: 'Se reevaluo el alcance, si corresponde' },
    { email: 'dev@homepymes.cl', rol: 'DEV' }
  );
  assert.equal(conComentario.estado_nuevo, 'S03');
});
