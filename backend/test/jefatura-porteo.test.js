'use strict';

/**
 * Prueba de portabilidad: el CRUD de Jefatura (backend/test/jefatura.test.js,
 * seccion "CRUD de JEFATURAS") + el guardia de acceso de getDetalle,
 * corridos contra backend/logica/jefatura.js + solicitudesBackoffice.js.
 * NO se porta Jefatura.getPanel (ver la nota en jefatura.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Jefatura = require('../logica/jefatura');
const SolicitudesBO = require('../logica/solicitudesBackoffice');

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}

function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }

function seedJefatura(db, overrides) {
  const base = Object.assign(
    { jefatura_id: 'JEF-' + Math.random().toString(36).slice(2), jefe_email: 'lisseth@rld.cl', subordinado_email: 'vanessa@rld.cl', activo: true },
    overrides
  );
  agregarFila_(db, 'JEFATURAS', base);
  return base;
}

function seedSolicitud(db, overrides, subDevs) {
  const base = Object.assign(
    {
      solicitud_id: 'SOL-2026-RLD-0001', empresa_id: 'RLD', plataforma: 'GDE',
      tipo: 'ERR', solicitante_nombre: 'Vanessa Reyes', solicitante_email: 'vanessa@rld.cl',
      estado_derivado: 'S02', prioridad_derivada: 'P2', dedup_hash: 'x',
      fecha_creacion: new Date().toISOString(), creado_por: 'vanessa@rld.cl',
      desarrollador_asignado: '', atencion_directa: false
    },
    overrides
  );
  agregarFila_(db, 'SOLICITUDES', base);
  (subDevs || ['']).forEach((dev, idx) => {
    agregarFila_(db, 'SUBSOLICITUDES', {
      subsolicitud_id: base.solicitud_id + '-0' + (idx + 1), solicitud_id: base.solicitud_id, numero_item: idx + 1,
      titulo: 'Item ' + (idx + 1), descripcion: 'Desc', estado: 'S02', prioridad: 'P2',
      fecha_creacion: base.fecha_creacion, desarrollador_asignado: dev
    });
  });
  return base;
}

test('Jefatura.gestionar (crear): rechaza si quien pide no es ADM', () => {
  const db = dbConSchema();
  const resultado = Jefatura.gestionar(db,
    { operacion: 'crear', jefe_email: 'lisseth@rld.cl', subordinado_email: 'vanessa@rld.cl' },
    { rol: 'JEFATURA', email: 'lisseth@rld.cl' }
  );
  assert.equal(resultado._forbidden, true);
});

test('Jefatura.gestionar (crear): ADM crea la relacion, rechaza duplicados y auto-jefatura', () => {
  const db = dbConSchema();
  const creada = Jefatura.gestionar(db,
    { operacion: 'crear', jefe_email: 'Lisseth@RLD.cl', subordinado_email: 'Vanessa@RLD.cl' },
    { rol: 'ADM', email: 'admin@rld.cl' }
  );
  assert.equal(creada.jefe_email, 'lisseth@rld.cl', 'normaliza a minusculas');

  const duplicada = Jefatura.gestionar(db,
    { operacion: 'crear', jefe_email: 'lisseth@rld.cl', subordinado_email: 'vanessa@rld.cl' },
    { rol: 'ADM', email: 'admin@rld.cl' }
  );
  assert.equal(duplicada._validationError, true);

  const autoJefatura = Jefatura.gestionar(db,
    { operacion: 'crear', jefe_email: 'x@rld.cl', subordinado_email: 'x@rld.cl' },
    { rol: 'ADM', email: 'admin@rld.cl' }
  );
  assert.equal(autoJefatura._validationError, true);
});

test('Jefatura.gestionar (eliminar/activar): ADM puede desactivar y eliminar una relacion', () => {
  const db = dbConSchema();
  const jefatura = seedJefatura(db, {});

  const desactivada = Jefatura.gestionar(db,
    { operacion: 'activar', jefatura_id: jefatura.jefatura_id, activo: false },
    { rol: 'ADM', email: 'admin@rld.cl' }
  );
  assert.equal(desactivada.activo, false);

  const eliminada = Jefatura.gestionar(db, { operacion: 'eliminar', jefatura_id: jefatura.jefatura_id }, { rol: 'ADM', email: 'admin@rld.cl' });
  assert.equal(eliminada.eliminada, true);
  assert.equal(filas(db, 'JEFATURAS').length, 0);
});

test('Jefatura.listar exige ADM', () => {
  const db = dbConSchema();
  seedJefatura(db, {});
  assert.equal(Jefatura.listar(db, {}, { rol: 'DEV' })._forbidden, true);
  assert.equal(Jefatura.listar(db, {}, { rol: 'ADM' }).length, 1);
});

test('Solicitudes.getDetalle: Jefatura SI puede abrir el detalle de una solicitud de su equipo, de solo lectura', () => {
  const db = dbConSchema();
  seedJefatura(db, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl' });

  const detalle = SolicitudesBO.getDetalle(db, 'SOL-2026-RLD-0001', { email: 'lisseth@rld.cl', rol: 'JEFATURA' });

  assert.equal(detalle._forbidden, undefined);
  assert.equal(detalle.solicitud.solicitud_id, 'SOL-2026-RLD-0001');
  assert.equal(detalle.responsables.length, 0);
  assert.equal(detalle.transiciones_por_subsolicitud['SOL-2026-RLD-0001-01'].length, 0);
});

test('Solicitudes.getDetalle: Jefatura NO puede abrir el detalle de una solicitud fuera de su equipo', () => {
  const db = dbConSchema();
  seedJefatura(db, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'otro@rld.cl', desarrollador_asignado: 'otro-dev@rld.cl' });

  const detalle = SolicitudesBO.getDetalle(db, 'SOL-2026-RLD-0001', { email: 'lisseth@rld.cl', rol: 'JEFATURA' });
  assert.equal(detalle._forbidden, true);
});

// El unico vinculo con el equipo es un ITEM suelto (la cabecera es de un
// ajeno) -- si el recorrido de subsolicitudes de esDelEquipoJefaturaSolicitud_
// estuviera roto, este es el caso que lo detecta (con la cabecera tambien
// del equipo, el test pasaria igual aunque el recorrido no funcionara).
test('Jefatura puede abrir una solicitud donde solo un ITEM suelto (no la cabecera) es de su equipo', () => {
  const db = dbConSchema();
  seedJefatura(db, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(db, {
    solicitud_id: 'SOL-2026-RLD-0003', solicitante_email: 'fuera@rld.cl', desarrollador_asignado: 'ajeno@rld.cl'
  }, ['ajeno@rld.cl', 'vanessa@rld.cl']);

  const detalle = SolicitudesBO.getDetalle(db, 'SOL-2026-RLD-0003', { email: 'lisseth@rld.cl', rol: 'JEFATURA' });
  assert.notEqual(detalle._forbidden, true, 'la jefa sigue pudiendo abrir la solicitud');
});
