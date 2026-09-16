'use strict';

/**
 * Prueba de portabilidad: los mismos escenarios de backend/test/
 * bandeja.test.js (auto-scope por rol de Dashboard.getData + el veto de
 * "solo tu propio trabajo" para una cuenta del portal normalizada a DEV),
 * corridos contra dashboard.js + solicitudesBackoffice.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Dashboard = require('../logica/dashboard');
const SolicitudesBO = require('../logica/solicitudesBackoffice');

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
      tipo: 'ERR', solicitante_nombre: 'Juan', solicitante_cargo: 'Analista', solicitante_email: 'juan@homepymes.cl',
      estado_derivado: 'S05', prioridad_derivada: 'P2', dedup_hash: 'x', estimacion_total_horas: 4,
      fecha_creacion: new Date().toISOString(), creado_por: 'juan@homepymes.cl'
    },
    overrides
  );
  agregarFila_(db, 'SOLICITUDES', base);
  return base;
}

function seedSubsolicitud(db, overrides) {
  const base = Object.assign(
    { subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001', numero_item: 1, titulo: 't', descripcion: 'd', prioridad: 'P2', estado: 'S05', sla_objetivo_horas: 24, fecha_creacion: new Date().toISOString() },
    overrides
  );
  agregarFila_(db, 'SUBSOLICITUDES', base);
  return base;
}

test('Dashboard.getData (v3.0): un DEV ve solo su bandeja aunque ademas filtre por estado', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001', desarrollador_asignado: 'dev@homepymes.cl', estado_derivado: 'S05' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001', estado: 'S05' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0002', desarrollador_asignado: 'otro@homepymes.cl', estado_derivado: 'S05' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0002-01', solicitud_id: 'SOL-2026-HP-0002', estado: 'S05' });

  const datos = Dashboard.getData(db, { estado: 'S05' }, { rol: 'DEV', email: 'dev@homepymes.cl' });
  assert.deepEqual(datos.recientes.map((r) => r.solicitud_id), ['SOL-2026-HP-0001']);
});

test('Dashboard.getData (v3.0): ADM ve todo por defecto (sin bandeja elegida)', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001', desarrollador_asignado: 'dev1@homepymes.cl' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0002', desarrollador_asignado: 'dev2@homepymes.cl' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0002-01', solicitud_id: 'SOL-2026-HP-0002' });

  const datos = Dashboard.getData(db, {}, { rol: 'ADM', email: 'admin@homepymes.cl' });
  assert.equal(datos.recientes.length, 2);
});

test('Dashboard.getData (v3.0): ADM elige "verBandeja" y ve solo esa persona', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001', desarrollador_asignado: 'dev1@homepymes.cl' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0002', desarrollador_asignado: 'dev2@homepymes.cl' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0002-01', solicitud_id: 'SOL-2026-HP-0002' });

  const datos = Dashboard.getData(db, { verBandeja: 'dev2@homepymes.cl' }, { rol: 'ADM', email: 'admin@homepymes.cl' });
  assert.deepEqual(datos.recientes.map((r) => r.solicitud_id), ['SOL-2026-HP-0002']);
});

test('Dashboard.getData (v4.1.1): GERENCIA ignora "verBandeja" -- siempre ve solo la suya', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001', desarrollador_asignado: 'dev1@homepymes.cl' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001' });

  const datos = Dashboard.getData(db, { verBandeja: 'dev1@homepymes.cl' }, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  assert.equal(datos.recientes.length, 0);
});

test('Dashboard.getData (v4.1.1): expone "responsables" (DEV/ANA activos) solo para ADM', () => {
  const db = dbConSchema();
  sembrarTabla_(db, 'USUARIOS', COLUMNAS.USUARIOS, [
    ['U1', 'Dev Uno', 'dev1@homepymes.cl', 'HP', 'DEV', true, '', 'sistema'],
    ['U2', 'Analista Dos', 'ana2@homepymes.cl', 'HP', 'ANA', true, '', 'sistema'],
    ['U3', 'Inactivo', 'x@homepymes.cl', 'HP', 'DEV', false, '', 'sistema'],
    ['U4', 'Admin Uno', 'admin@homepymes.cl', 'HP', 'ADM', true, '', 'sistema']
  ]);

  const datosAdmin = Dashboard.getData(db, {}, { rol: 'ADM', email: 'admin@homepymes.cl' });
  const datosGerencia = Dashboard.getData(db, {}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  const datosDev = Dashboard.getData(db, {}, { rol: 'DEV', email: 'dev1@homepymes.cl' });

  const emailsAdmin = datosAdmin.responsables.map((r) => r.email).sort();
  assert.deepEqual(emailsAdmin, ['ana2@homepymes.cl', 'dev1@homepymes.cl']);
  assert.equal(datosGerencia.responsables, undefined);
  assert.equal(datosDev.responsables, undefined);
});

test('Dashboard.getData (v3.0): sin la hoja USUARIOS, "responsables" queda vacio sin romper', () => {
  const db = abrirDb_();
  ['SOLICITUDES', 'SUBSOLICITUDES', 'HISTORIAL_ESTADOS', 'CONFIG_FERIADOS', 'COMENTARIOS'].forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  const datos = Dashboard.getData(db, {}, { rol: 'ADM', email: 'admin@homepymes.cl' });
  assert.equal(datos.responsables.length, 0);
});

// --- cuenta del portal con bandeja: escribir SOLO lo suyo -----------------

function ctxPortal(email) {
  return { email: email || 'portal@homepymes.cl', rol: 'DEV', rol_origen: 'SOLICITANTE', via_portal: true };
}
function ctxPlantilla(email) {
  return { email: email || 'portal@homepymes.cl', rol: 'DEV' };
}

function seedItemAjeno(db) {
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0009', desarrollador_asignado: 'ajeno@homepymes.cl' });
  return seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0009-01', solicitud_id: 'SOL-2026-HP-0009', desarrollador_asignado: 'ajeno@homepymes.cl', titulo: 'Trabajo del ajeno' });
}

test('cuenta del portal: no puede tocar un item que no tiene asignado', async () => {
  const db = dbConSchema();
  seedItemAjeno(db);

  const estado = SolicitudesBO.actualizarEstado(db, { subsolicitud_id: 'SOL-2026-HP-0009-01', estado_nuevo: 'S07', comentario: 'x' }, ctxPortal());
  const fecha = await SolicitudesBO.comprometerFecha(db, { subsolicitud_id: 'SOL-2026-HP-0009-01', fecha_comprometida: '2099-01-01' }, ctxPortal());
  const edicion = SolicitudesBO.editarContenidoSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0009-01', titulo: 'REESCRITO', descripcion: 'Descripcion larga suficiente para pasar la validacion de longitud.' }, ctxPortal());

  assert.equal(estado._forbidden, true, 'no puede cambiar el estado de un item ajeno');
  assert.equal(fecha._forbidden, true, 'no puede comprometer fecha en un item ajeno');
  assert.equal(edicion._forbidden, true, 'no puede reescribir el contenido de un item ajeno');

  const fila = filas(db, 'SUBSOLICITUDES')[0];
  assert.equal(fila.estado, 'S05');
  assert.equal(fila.titulo, 'Trabajo del ajeno');
  assert.equal(fila.fecha_comprometida, '');
});

test('cuenta del portal: SI puede con lo suyo -- el arreglo no la deja sin trabajo', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0010', desarrollador_asignado: 'portal@homepymes.cl' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0010-01', solicitud_id: 'SOL-2026-HP-0010', desarrollador_asignado: 'portal@homepymes.cl' });

  const r = SolicitudesBO.actualizarEstado(db, { subsolicitud_id: 'SOL-2026-HP-0010-01', estado_nuevo: 'S07', comentario: 'avanzo lo mio' }, ctxPortal());

  assert.notEqual(r._forbidden, true, 'sobre su propio item tiene que poder');
  assert.equal(filas(db, 'SUBSOLICITUDES')[0].estado, 'S07');
});

test('el personal de plantilla NO cambia: sigue pudiendo cubrir a un companero', () => {
  const db = dbConSchema();
  seedItemAjeno(db);

  const r = SolicitudesBO.actualizarEstado(db, { subsolicitud_id: 'SOL-2026-HP-0009-01', estado_nuevo: 'S07', comentario: 'cubro a mi companero' }, ctxPlantilla());

  assert.notEqual(r._forbidden, true);
  assert.equal(filas(db, 'SUBSOLICITUDES')[0].estado, 'S07');
});
