'use strict';

/**
 * Prueba de portabilidad: los escenarios de Jefatura.getPanel de backend/
 * test/jefatura.test.js, corridos contra jefatura.js. No se porta el test de
 * Dashboard.getData con rol JEFATURA (ya cubierto en dashboard-porteo.test.js).
 * Notificaciones.enviarDigestJefatura se porta aparte, en
 * notificaciones-digest-jefatura-porteo.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Jefatura = require('../logica/jefatura');

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  sembrarTabla_(db, 'USUARIOS', COLUMNAS.USUARIOS, [
    ['U1', 'Vanessa Reyes', 'vanessa@rld.cl', 'RLD', 'DEV', true, '', 'sistema'],
    ['U2', 'Juan Dominguez', 'juan@rld.cl', 'RLD', 'DEV', true, '', 'sistema'],
    ['U3', 'Lisseth Jefa', 'lisseth@rld.cl', 'RLD', 'JEFATURA', true, '', 'sistema']
  ]);
  return db;
}

function seedJefatura(db, overrides) {
  const base = Object.assign(
    { jefatura_id: 'JEF-' + Math.random().toString(36).slice(2), jefe_email: 'lisseth@rld.cl', subordinado_email: 'vanessa@rld.cl', activo: true },
    overrides
  );
  agregarFila_(db, 'JEFATURAS', base);
  return base;
}

function seedSolicitud(db, overrides, subestados) {
  const base = Object.assign(
    {
      solicitud_id: 'SOL-2026-RLD-0001', empresa_id: 'RLD', plataforma: 'GDE', plataforma_nombre: 'GDE',
      modulo: 'LIQ', modulo_nombre: 'Liquidaciones', tipo: 'ERR', tipo_nombre: 'Error / Bug',
      solicitante_nombre: 'Vanessa Reyes', solicitante_cargo: 'Analista', solicitante_email: 'vanessa@rld.cl',
      es_cliente: false, estado_derivado: 'S02', prioridad_derivada: 'P2', dedup_hash: 'x',
      fecha_creacion: new Date().toISOString(), creado_por: 'vanessa@rld.cl',
      desarrollador_asignado: '', atencion_directa: false
    },
    overrides
  );
  agregarFila_(db, 'SOLICITUDES', base);
  (subestados || ['S02']).forEach((estado, idx) => {
    agregarFila_(db, 'SUBSOLICITUDES', {
      subsolicitud_id: base.solicitud_id + '-0' + (idx + 1), solicitud_id: base.solicitud_id, numero_item: idx + 1,
      titulo: 'Item', descripcion: 'Descripcion', prioridad: base.prioridad_derivada, estado: estado,
      sla_objetivo_horas: 24, fecha_creacion: base.fecha_creacion, desarrollador_asignado: base.desarrollador_asignado,
      tipo: base.tipo, tipo_nombre: base.tipo_nombre, modulo: base.modulo, modulo_nombre: base.modulo_nombre
    });
  });
  return base;
}

function seedSubConResponsable(db, solicitudId, numero, titulo, responsable) {
  agregarFila_(db, 'SUBSOLICITUDES', {
    subsolicitud_id: solicitudId + '-0' + numero, solicitud_id: solicitudId, numero_item: numero,
    titulo: titulo, descripcion: 'x', estado: 'S02', prioridad: 'P2', sla_objetivo_horas: 24,
    fecha_creacion: new Date().toISOString(), desarrollador_asignado: responsable
  });
}

test('Jefatura.getPanel solo incluye solicitudes de personas a cargo (solicitante o resolutor)', () => {
  const db = dbConSchema();
  seedJefatura(db, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0002', solicitante_email: 'otro@rld.cl', desarrollador_asignado: 'otro-dev@rld.cl' });

  const panel = Jefatura.getPanel(db, {}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });
  assert.deepEqual(panel.items.map((i) => i.solicitud_id), ['SOL-2026-RLD-0001']);
});

test('Jefatura.getPanel (§0) incluye a la persona a cargo tanto si reporta como si resuelve', () => {
  const db = dbConSchema();
  seedJefatura(db, { subordinado_email: 'vanessa@rld.cl' });
  seedJefatura(db, { jefatura_id: 'JEF-2', subordinado_email: 'juan@rld.cl' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl', desarrollador_asignado: 'juan@rld.cl' });

  const panel = Jefatura.getPanel(db, {}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });
  assert.equal(panel.items.length, 1);
  assert.equal(panel.items[0].persona_solicitante, 'vanessa@rld.cl');
  assert.equal(panel.items[0].persona_resolutor, 'juan@rld.cl');
});

test('Jefatura.getPanel considera la asignacion por ITEM (subsolicitud), no solo la de la solicitud', () => {
  const db = dbConSchema();
  seedJefatura(db, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'nadie-a-cargo@rld.cl', desarrollador_asignado: '' }, ['S02']);
  const { actualizarFilaPorId_ } = require('../db/sqliteRepo');
  actualizarFilaPorId_(db, 'SUBSOLICITUDES', 'subsolicitud_id', 'SOL-2026-RLD-0001-01', { desarrollador_asignado: 'vanessa@rld.cl' });

  const panel = Jefatura.getPanel(db, {}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });
  assert.equal(panel.items.length, 1);
  assert.equal(panel.items[0].persona_resolutor, 'vanessa@rld.cl');
});

test('Jefatura.getPanel: un jefe sin equipo (o inactivo) obtiene un panel vacio, no un error', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl' });

  const sinRelaciones = Jefatura.getPanel(db, {}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });
  assert.equal(sinRelaciones.items.length, 0);
  assert.equal(sinRelaciones.equipo.length, 0);

  seedJefatura(db, { subordinado_email: 'vanessa@rld.cl', activo: false });
  const relacionInactiva = Jefatura.getPanel(db, {}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });
  assert.equal(relacionInactiva.items.length, 0);
});

test('Jefatura.getPanel excluye atenciones directas (mismo criterio que Gerencia, §1.6)', () => {
  const db = dbConSchema();
  seedJefatura(db, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl', atencion_directa: true }, ['S09']);

  const panel = Jefatura.getPanel(db, {}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });
  assert.equal(panel.items.length, 0);
});

test('Jefatura.getPanel calcula KPIs basicos del equipo', () => {
  const db = dbConSchema();
  seedJefatura(db, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl', estado_derivado: 'S02' }, ['S02']);
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0002', solicitante_email: 'vanessa@rld.cl', estado_derivado: 'S09' }, ['S09']);

  const panel = Jefatura.getPanel(db, {}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });
  assert.equal(panel.kpis.total_equipo, 2);
  assert.equal(panel.kpis.abiertas, 1);
});

test('Jefatura.getPanel (§4) "hoy" cuenta las nuevas del equipo creadas hoy', () => {
  const db = dbConSchema();
  seedJefatura(db, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl', fecha_creacion: new Date().toISOString() });
  const hace10Dias = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0002', solicitante_email: 'vanessa@rld.cl', fecha_creacion: hace10Dias });

  const panel = Jefatura.getPanel(db, {}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });
  assert.equal(panel.hoy.resumen.nuevas, 1);
  assert.equal(panel.hoy.nuevas[0].solicitud_id, 'SOL-2026-RLD-0001');
});

test('Jefatura.getPanel (§4) "hoy" cuenta cerradas y avanzadas via HISTORIAL_ESTADOS, una vez por item', () => {
  const db = dbConSchema();
  seedJefatura(db, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl', estado_derivado: 'S09' }, ['S09']);
  const ahora = new Date().toISOString();
  agregarFila_(db, 'HISTORIAL_ESTADOS', { historial_id: 'h1', solicitud_id: 'SOL-2026-RLD-0001', subsolicitud_id: 'SOL-2026-RLD-0001-01', estado_anterior: '', estado_nuevo: 'S01', usuario: 'sistema', comentario: '', timestamp: ahora });
  agregarFila_(db, 'HISTORIAL_ESTADOS', { historial_id: 'h2', solicitud_id: 'SOL-2026-RLD-0001', subsolicitud_id: 'SOL-2026-RLD-0001-01', estado_anterior: 'S01', estado_nuevo: 'S02', usuario: 'sistema', comentario: '', timestamp: ahora });
  agregarFila_(db, 'HISTORIAL_ESTADOS', { historial_id: 'h3', solicitud_id: 'SOL-2026-RLD-0001', subsolicitud_id: 'SOL-2026-RLD-0001-01', estado_anterior: 'S02', estado_nuevo: 'S09', usuario: 'sistema', comentario: '', timestamp: ahora });

  const panel = Jefatura.getPanel(db, {}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });
  assert.equal(panel.hoy.resumen.avanzaron, 1, 'dos transiciones el mismo dia cuentan como un solo item que avanzo');
  assert.equal(panel.hoy.resumen.cerradas, 1);
});

test('Jefatura.getPanel (§4) "requieren accion" son items ESPERANDO_VALIDACION donde el solicitante es de mi equipo', () => {
  const db = dbConSchema();
  seedJefatura(db, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl', estado_derivado: 'S08', fecha_comprometida: '2020-01-01T18:00' }, ['S08']);
  const { actualizarFilaPorId_ } = require('../db/sqliteRepo');
  actualizarFilaPorId_(db, 'SUBSOLICITUDES', 'subsolicitud_id', 'SOL-2026-RLD-0001-01', { fecha_comprometida: '2020-01-01T18:00', fecha_terminada: '2020-01-05T10:00:00.000Z' });

  const panel = Jefatura.getPanel(db, {}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });
  assert.equal(panel.hoy.resumen.requieren_accion, 1);
});

test('Jefatura.getPanel (§5) desglosa por cada persona del equipo', () => {
  const db = dbConSchema();
  seedJefatura(db, { subordinado_email: 'vanessa@rld.cl' });
  seedJefatura(db, { jefatura_id: 'JEF-2', subordinado_email: 'juan@rld.cl' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl', estado_derivado: 'S02' }, ['S02']);
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0002', solicitante_email: 'otro@rld.cl', desarrollador_asignado: 'juan@rld.cl', estado_derivado: 'S05' }, ['S05']);

  const panel = Jefatura.getPanel(db, {}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });
  const vanessa = panel.por_persona.find((p) => p.email === 'vanessa@rld.cl');
  const juan = panel.por_persona.find((p) => p.email === 'juan@rld.cl');
  assert.equal(vanessa.solicitadas_total, 1);
  assert.equal(juan.asignadas_total, 1);
  assert.equal(juan.nombre, 'Juan Dominguez');
});

test('Jefatura.getPanel (§6) agrupa la carga del equipo por modulo y tipo', () => {
  const db = dbConSchema();
  seedJefatura(db, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl', modulo_nombre: 'Liquidaciones', tipo_nombre: 'Error / Bug' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0002', solicitante_email: 'vanessa@rld.cl', modulo_nombre: 'Liquidaciones', tipo_nombre: 'Error / Bug' });

  const panel = Jefatura.getPanel(db, {}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });
  assert.equal(panel.carga.por_modulo[0].etiqueta, 'Liquidaciones');
  assert.equal(panel.carga.por_modulo[0].cantidad, 2);
});

// --- el arreglo real de esDelEquipoJefatura_ (v4.2, ver jefatura.js) -------

test('el panel NO cuenta un item reasignado FUERA del equipo, aunque la cabecera sea de los mios', () => {
  const db = dbConSchema();
  seedJefatura(db, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'fuera@rld.cl', desarrollador_asignado: 'vanessa@rld.cl' }, []);
  seedSubConResponsable(db, 'SOL-2026-RLD-0001', 1, 'Item de Vanessa', 'vanessa@rld.cl');
  seedSubConResponsable(db, 'SOL-2026-RLD-0001', 2, 'Item del ajeno', 'ajeno@rld.cl');

  const panel = Jefatura.getPanel(db, {}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });
  assert.deepEqual(panel.items.map((i) => i.titulo), ['Item de Vanessa'], 'el item del ajeno no es trabajo de este equipo');

  const sumaPorPersona = panel.por_persona.reduce((s, p) => s + p.asignadas_abiertas, 0);
  assert.equal(panel.kpis.abiertas, sumaPorPersona, 'la banda y la tabla por persona no pueden contar cosas distintas');
});

test('un item SIN responsable propio sigue contando por el de la cabecera', () => {
  const db = dbConSchema();
  seedJefatura(db, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0002', solicitante_email: 'fuera@rld.cl', desarrollador_asignado: 'vanessa@rld.cl' }, []);
  seedSubConResponsable(db, 'SOL-2026-RLD-0002', 1, 'Item sin responsable propio', '');

  const panel = Jefatura.getPanel(db, {}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });
  assert.deepEqual(panel.items.map((i) => i.titulo), ['Item sin responsable propio']);
});
