'use strict';

/**
 * Prueba de portabilidad: los mismos escenarios de backend/test/
 * busqueda-bandeja.test.js (busqueda unificada de la Bandeja, v6.3),
 * corridos contra dashboard.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Dashboard = require('../logica/dashboard');

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}

function seedSolicitud(db, overrides, tituloItem) {
  const base = Object.assign(
    {
      solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', empresa_nombre: 'HomePymes',
      plataforma: 'INT_GDE', plataforma_nombre: 'Intranet GDE', modulo: 'MOD_FACTURACION',
      tipo: 'ERR', solicitante_nombre: 'Juan Pérez', solicitante_cargo: 'Analista', solicitante_email: 'juan@homepymes.cl',
      estado_derivado: 'S02', prioridad_derivada: 'P2', dedup_hash: 'x', estimacion_total_horas: 4,
      fecha_creacion: new Date().toISOString(), creado_por: 'juan@homepymes.cl'
    },
    overrides
  );
  agregarFila_(db, 'SOLICITUDES', base);
  agregarFila_(db, 'SUBSOLICITUDES', {
    subsolicitud_id: base.solicitud_id + '-01', solicitud_id: base.solicitud_id, numero_item: 1,
    titulo: tituloItem, descripcion: 'd', prioridad: base.prioridad_derivada, estado: base.estado_derivado,
    sla_objetivo_horas: 24, fecha_creacion: base.fecha_creacion, modulo: base.modulo, tipo: base.tipo
  });
  return base;
}

function sembrarEscenario_(db) {
  seedSolicitud(db, {
    solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', empresa_nombre: 'HomePymes',
    modulo: 'MOD_FACTURACION', solicitante_nombre: 'Juan Pérez', solicitante_email: 'juan@homepymes.cl'
  }, 'Incorporar duración de la capacitación');
  seedSolicitud(db, {
    solicitud_id: 'SOL-2026-RLD-0002', empresa_id: 'RLD', empresa_nombre: 'RLD',
    plataforma: 'RLD_GDE', plataforma_nombre: 'GDE', modulo: 'MOD_LIQUIDACIONES',
    solicitante_nombre: 'Camila Soto', solicitante_email: 'camila@rld.cl'
  }, 'Error al exportar liquidaciones');
}

function buscar_(db, termino) {
  const datos = Dashboard.getData(db, { busqueda: termino }, { rol: 'ADM', email: 'adm@hp.cl' });
  return datos.recientes.map((r) => r.solicitud_id).sort();
}

test('busqueda por ID de solicitud', () => {
  const db = dbConSchema();
  sembrarEscenario_(db);
  assert.deepEqual(buscar_(db, 'RLD-0002'), ['SOL-2026-RLD-0002']);
});

test('busqueda por TITULO del item (vive en SUBSOLICITUDES, no en SOLICITUDES)', () => {
  const db = dbConSchema();
  sembrarEscenario_(db);
  assert.deepEqual(buscar_(db, 'capacitación'), ['SOL-2026-HP-0001']);
  assert.deepEqual(buscar_(db, 'liquidaciones'), ['SOL-2026-RLD-0002']);
});

test('busqueda por nombre del solicitante', () => {
  const db = dbConSchema();
  sembrarEscenario_(db);
  assert.deepEqual(buscar_(db, 'camila'), ['SOL-2026-RLD-0002']);
});

test('busqueda por correo del solicitante', () => {
  const db = dbConSchema();
  sembrarEscenario_(db);
  assert.deepEqual(buscar_(db, 'juan@homepymes.cl'), ['SOL-2026-HP-0001']);
});

test('busqueda por empresa (codigo y nombre)', () => {
  const db = dbConSchema();
  sembrarEscenario_(db);
  assert.deepEqual(buscar_(db, 'RLD'), ['SOL-2026-RLD-0002']);
  assert.deepEqual(buscar_(db, 'HomePymes'), ['SOL-2026-HP-0001']);
});

test('busqueda por modulo', () => {
  const db = dbConSchema();
  sembrarEscenario_(db);
  assert.deepEqual(buscar_(db, 'MOD_LIQUIDACIONES'), ['SOL-2026-RLD-0002']);
});

test('busqueda sin coincidencias devuelve lista vacia (no todas)', () => {
  const db = dbConSchema();
  sembrarEscenario_(db);
  assert.deepEqual(buscar_(db, 'zzzz-no-existe'), []);
});

test('busqueda insensible a mayusculas y con espacios sobrantes', () => {
  const db = dbConSchema();
  sembrarEscenario_(db);
  assert.deepEqual(buscar_(db, '  CaMiLa  '), ['SOL-2026-RLD-0002']);
});

test('busqueda vacia no filtra nada', () => {
  const db = dbConSchema();
  sembrarEscenario_(db);
  assert.equal(buscar_(db, '').length, 2);
});

test('recientes[].texto_busqueda contiene todos los campos buscables', () => {
  const db = dbConSchema();
  sembrarEscenario_(db);
  const datos = Dashboard.getData(db, {}, { rol: 'ADM', email: 'adm@hp.cl' });
  const fila = datos.recientes.filter((r) => r.solicitud_id === 'SOL-2026-HP-0001')[0];

  assert.ok(fila.texto_busqueda, 'la fila debe traer texto_busqueda para el filtrado en vivo');
  ['sol-2026-hp-0001', 'capacitación', 'juan pérez', 'juan@homepymes.cl', 'hp', 'homepymes', 'mod_facturacion']
    .forEach((fragmento) => {
      assert.ok(fila.texto_busqueda.indexOf(fragmento) !== -1, 'texto_busqueda deberia contener "' + fragmento + '", fue: ' + fila.texto_busqueda);
    });
});

test('CLIENTE y SERVIDOR devuelven lo mismo: filtrar texto_busqueda == filtrar en el backend', () => {
  const db = dbConSchema();
  sembrarEscenario_(db);
  const todas = Dashboard.getData(db, {}, { rol: 'ADM', email: 'adm@hp.cl' }).recientes;

  ['capacitación', 'camila', 'RLD', 'MOD_LIQUIDACIONES', 'juan@homepymes.cl', 'zzzz'].forEach((termino) => {
    const enCliente = todas.filter((r) => r.texto_busqueda.indexOf(termino.trim().toLowerCase()) !== -1).map((r) => r.solicitud_id).sort();
    const enServidor = buscar_(db, termino);
    assert.deepEqual(enCliente, enServidor, 'divergen para el termino "' + termino + '"');
  });
});

test('busqueda + filtro de empresa se combinan (AND), no se pisan', () => {
  const db = dbConSchema();
  sembrarEscenario_(db);
  const conAmbos = Dashboard.getData(db, { busqueda: 'liquidaciones', empresa_id: 'HP' }, { rol: 'ADM', email: 'adm@hp.cl' });
  assert.deepEqual(conAmbos.recientes.map((r) => r.solicitud_id), [], 'el item de liquidaciones es de RLD: acotado a HP no debe aparecer');
});

test('el filtro `solicitante` del Panel de Gerencia NO se ensancha con el cambio', () => {
  const db = dbConSchema();
  sembrarEscenario_(db);
  const porTitulo = Dashboard.getData(db, { solicitante: 'capacitación' }, { rol: 'ADM', email: 'adm@hp.cl' });
  assert.deepEqual(porTitulo.recientes.map((r) => r.solicitud_id), [], '`solicitante` no debe encontrar por titulo');

  const porNombre = Dashboard.getData(db, { solicitante: 'juan' }, { rol: 'ADM', email: 'adm@hp.cl' });
  assert.deepEqual(porNombre.recientes.map((r) => r.solicitud_id), ['SOL-2026-HP-0001']);
});
