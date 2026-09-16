'use strict';

/**
 * Prueba de portabilidad: los mismos escenarios de backend/test/
 * dashboard.test.js (Dashboard.getData/getPautaDesarrollador), corridos
 * contra backend/logica/dashboard.js. NO se portan los 2 tests de cache
 * (C-13): ese modulo no porta la capa de CacheService (ver la nota en
 * dashboard.js) -- recalcular en SQLite es barato, no hay nada que cachear.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, actualizarFilaPorId_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Dashboard = require('../logica/dashboard');

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}

function seedSolicitud(db, overrides, subestados) {
  const base = Object.assign(
    {
      solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', plataforma: 'ERP', modulo: 'Facturacion',
      tipo: 'ERR', solicitante_nombre: 'Juan', solicitante_cargo: 'Analista', solicitante_email: 'juan@homepymes.cl',
      estado_derivado: 'S02', prioridad_derivada: 'P2', dedup_hash: 'x', estimacion_total_horas: 4,
      fecha_creacion: new Date().toISOString(), creado_por: 'juan@homepymes.cl'
    },
    overrides
  );
  agregarFila_(db, 'SOLICITUDES', base);
  (subestados || ['S02']).forEach((estado, idx) => {
    agregarFila_(db, 'SUBSOLICITUDES', {
      subsolicitud_id: base.solicitud_id + '-0' + (idx + 1), solicitud_id: base.solicitud_id, numero_item: idx + 1,
      titulo: 't', descripcion: 'd', prioridad: base.prioridad_derivada, estado: estado,
      sla_objetivo_horas: 24, fecha_creacion: base.fecha_creacion, modulo: base.modulo, tipo: base.tipo
    });
  });
  return base;
}

test('Dashboard.getData calcula el resumen general (abiertas, criticas, del dia)', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001', prioridad_derivada: 'P1', estado_derivado: 'S02' }, ['S02']);
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0002', prioridad_derivada: 'P3', estado_derivado: 'S09' }, ['S09']);

  const datos = Dashboard.getData(db, {}, { rol: 'ADM', email: 'admin@homepymes.cl' });

  assert.equal(datos.resumen.total_abiertas, 1);
  assert.equal(datos.resumen.criticas_activas, 1);
  assert.equal(datos.resumen.del_dia, 2);
});

test('Dashboard.getData agrupa por empresa/plataforma/estado/prioridad', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0001', empresa_id: 'RLD' });

  const datos = Dashboard.getData(db, {}, { rol: 'ADM' });
  const empresas = datos.por_empresa.map((e) => e.clave).sort();
  assert.deepEqual(empresas, ['HP', 'RLD']);
});

test('Dashboard.getData detecta SLA vencido en subsolicitudes abiertas', () => {
  const db = dbConSchema();
  const hace10Dias = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001', fecha_creacion: hace10Dias }, ['S02']);

  const datos = Dashboard.getData(db, {}, { rol: 'ADM' });
  assert.equal(datos.resumen.sla_vencido, 1);
});

test('Dashboard.getData respeta los filtros (empresa_id)', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0001', empresa_id: 'RLD' });

  const datos = Dashboard.getData(db, { empresa_id: 'HP' }, { rol: 'ADM' });
  assert.equal(datos.recientes.length, 1);
  assert.equal(datos.recientes[0].empresa_id, 'HP');
});

test('Dashboard.getData (P6) respeta el filtro solicitante -- coincidencia parcial por nombre o correo', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001', solicitante_nombre: 'Juan Perez', solicitante_email: 'juan@homepymes.cl' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0002', solicitante_nombre: 'Camila Pena', solicitante_email: 'camila@homepymes.cl' });

  const porNombre = Dashboard.getData(db, { solicitante: 'juan' }, { rol: 'ADM' });
  assert.equal(porNombre.recientes.length, 1);
  assert.equal(porNombre.recientes[0].solicitud_id, 'SOL-2026-HP-0001');

  const porCorreo = Dashboard.getData(db, { solicitante: 'camila@homepymes.cl' }, { rol: 'ADM' });
  assert.equal(porCorreo.recientes.length, 1);
  assert.equal(porCorreo.recientes[0].solicitud_id, 'SOL-2026-HP-0002');
});

test('Dashboard.getData (v4.1.1) GERENCIA en "Bandeja de trabajo" solo ve lo asignado a su propio correo', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001', desarrollador_asignado: 'gerencia@rld.cl' }, ['S02']);
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0002', desarrollador_asignado: 'otro@rld.cl' }, ['S02']);

  const datos = Dashboard.getData(db, {}, { rol: 'GERENCIA', email: 'gerencia@rld.cl' });
  const ids = datos.recientes.map((r) => r.solicitud_id).sort();
  assert.deepEqual(ids, ['SOL-2026-HP-0001']);
});

test('Dashboard.getData (v4.1.1) GERENCIA sin nada asignado NO ve las huerfanas activas sin asignar (a diferencia del DEV)', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001', prioridad_derivada: 'P1', estado_derivado: 'S05' }, ['S05']);

  const datosGerencia = Dashboard.getData(db, {}, { rol: 'GERENCIA', email: 'gerencia@rld.cl' });
  const datosDev = Dashboard.getData(db, {}, { rol: 'DEV', email: 'dev@homepymes.cl' });

  assert.equal(datosGerencia.recientes.length, 0);
  assert.equal(datosDev.recientes.length, 1, 'el DEV si conserva el respaldo original (Fase 2)');
});

test('Dashboard.getData (v4.1.1) ADM sigue viendo todas las solicitudes sin acotar', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001', desarrollador_asignado: 'gerencia@rld.cl' }, ['S02']);
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0002', desarrollador_asignado: 'otro@rld.cl' }, ['S02']);

  const datos = Dashboard.getData(db, {}, { rol: 'ADM', email: 'admin@homepymes.cl' });
  const ids = datos.recientes.map((r) => r.solicitud_id).sort();
  assert.deepEqual(ids, ['SOL-2026-HP-0001', 'SOL-2026-HP-0002']);
});

test('Dashboard.getData (v4.1.1) solo ADM recibe datos.responsables', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001' }, ['S02']);

  const datosAdm = Dashboard.getData(db, {}, { rol: 'ADM', email: 'admin@homepymes.cl' });
  const datosGerencia = Dashboard.getData(db, {}, { rol: 'GERENCIA', email: 'gerencia@rld.cl' });

  assert.ok(Array.isArray(datosAdm.responsables));
  assert.equal(datosGerencia.responsables, undefined);
});

test('Dashboard.getData (P5) marca respuesta_pendiente cuando hay un comentario publico posterior a la ultima entrada a S06', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001' }, ['S06']);
  agregarFila_(db, 'HISTORIAL_ESTADOS', {
    historial_id: 'h1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    estado_anterior: 'S03', estado_nuevo: 'S06', usuario: 'dev@homepymes.cl', comentario: '¿Que factura?', timestamp: '2026-01-01T10:00:00.000Z'
  });
  agregarFila_(db, 'COMENTARIOS', {
    comentario_id: 'c1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    usuario: 'juan@homepymes.cl', texto: 'La N-4521', es_interno: false, timestamp: '2026-01-02T10:00:00.000Z'
  });

  const datos = Dashboard.getData(db, {}, { rol: 'ADM' });
  assert.equal(datos.recientes[0].respuesta_pendiente, true);
});

test('Dashboard.getData (P5) NO marca respuesta_pendiente si el comentario es ANTERIOR a la ultima entrada a S06', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001' }, ['S06']);
  agregarFila_(db, 'COMENTARIOS', {
    comentario_id: 'c1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    usuario: 'juan@homepymes.cl', texto: 'Comentario viejo', es_interno: false, timestamp: '2026-01-01T10:00:00.000Z'
  });
  agregarFila_(db, 'HISTORIAL_ESTADOS', {
    historial_id: 'h1', solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01',
    estado_anterior: 'S03', estado_nuevo: 'S06', usuario: 'dev@homepymes.cl', comentario: '¿Que factura?', timestamp: '2026-01-02T10:00:00.000Z'
  });

  const datos = Dashboard.getData(db, {}, { rol: 'ADM' });
  assert.equal(datos.recientes[0].respuesta_pendiente, false);
});

test('Dashboard.getData (P7) detecta un patron: >=3 reportes del mismo (modulo,tipo) con >=2 solicitantes distintos', () => {
  const db = dbConSchema();
  const hoy = new Date().toISOString();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001', solicitante_email: 'juan@homepymes.cl', modulo: 'MOD_X', tipo: 'ERR', fecha_creacion: hoy }, ['S02']);
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0002', solicitante_email: 'ana@homepymes.cl', modulo: 'MOD_X', tipo: 'ERR', fecha_creacion: hoy }, ['S02']);
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0003', solicitante_email: 'ana@homepymes.cl', modulo: 'MOD_X', tipo: 'ERR', fecha_creacion: hoy }, ['S02']);

  const datos = Dashboard.getData(db, {}, { rol: 'ADM' });
  assert.equal(datos.alertas_patron.length, 1);
  assert.equal(datos.alertas_patron[0].cantidad, 3);
  assert.equal(datos.alertas_patron[0].solicitantes_distintos, 2);
});

test('Dashboard.getData (P7) NO reporta un patron con menos de 2 solicitantes distintos', () => {
  const db = dbConSchema();
  const hoy = new Date().toISOString();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001', solicitante_email: 'juan@homepymes.cl', modulo: 'MOD_X', tipo: 'ERR', fecha_creacion: hoy }, ['S02']);
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0002', solicitante_email: 'juan@homepymes.cl', modulo: 'MOD_X', tipo: 'ERR', fecha_creacion: hoy }, ['S02']);
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0003', solicitante_email: 'juan@homepymes.cl', modulo: 'MOD_X', tipo: 'ERR', fecha_creacion: hoy }, ['S02']);

  const datos = Dashboard.getData(db, {}, { rol: 'ADM' });
  assert.equal(datos.alertas_patron.length, 0);
});

test('Dashboard.getData enriquece recientes con cantidad_items, sla_restante_horas y asignado_a', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001', desarrollador_asignado: 'dev@homepymes.cl', fecha_creacion: new Date().toISOString() }, ['S02', 'S05']);

  const datos = Dashboard.getData(db, {}, { rol: 'ADM' });
  assert.equal(datos.recientes[0].cantidad_items, 2);
  assert.equal(datos.recientes[0].asignado_a, 'dev@homepymes.cl');
  assert.ok(datos.recientes[0].sla_restante_horas > 0);
});

test('Dashboard.getData incluye solicitante_nombre/email en recientes para la busqueda por texto', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitante_nombre: 'Camila Pena', solicitante_email: 'camila@homepymes.cl' });

  const datos = Dashboard.getData(db, {}, { rol: 'ADM' });
  assert.equal(datos.recientes[0].solicitante_nombre, 'Camila Pena');
  assert.equal(datos.recientes[0].solicitante_email, 'camila@homepymes.cl');
});

test('Dashboard.getData: sla_restante_horas es null si ningun item tiene SLA activo', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001' }, ['S09']);

  const datos = Dashboard.getData(db, {}, { rol: 'ADM' });
  assert.equal(datos.recientes[0].sla_restante_horas, null);
});

test('Dashboard.getData (DEV sin asignaciones) usa como respaldo los estados de trabajo activo', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001', estado_derivado: 'S02' }, ['S02']);
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0002', estado_derivado: 'S05' }, ['S05']);

  const datosAdmin = Dashboard.getData(db, {}, { rol: 'ADM', email: 'admin@homepymes.cl' });
  const datosDev = Dashboard.getData(db, {}, { rol: 'DEV', email: 'dev@homepymes.cl' });

  assert.equal(datosAdmin.recientes.length, 2);
  assert.equal(datosDev.recientes.length, 1);
  assert.equal(datosDev.recientes[0].solicitud_id, 'SOL-2026-HP-0002');
});

test('Dashboard.getData (DEV) ve las solicitudes asignadas a el aunque no esten en estado activo', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001', estado_derivado: 'S02', desarrollador_asignado: 'dev@homepymes.cl' }, ['S02']);
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0002', estado_derivado: 'S05', desarrollador_asignado: 'otro-dev@homepymes.cl' }, ['S05']);

  const datosDev = Dashboard.getData(db, {}, { rol: 'DEV', email: 'dev@homepymes.cl' });
  const ids = datosDev.recientes.map((r) => r.solicitud_id).sort();
  assert.deepEqual(ids, ['SOL-2026-HP-0001']);
});

test('Dashboard.getData (DEV) ve solicitudes donde solo una subsolicitud (no la solicitud completa) esta asignada a el', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001', estado_derivado: 'S02' }, ['S02']);
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0002', estado_derivado: 'S02' }, ['S02']);

  actualizarFilaPorId_(db, 'SUBSOLICITUDES', 'subsolicitud_id', 'SOL-2026-HP-0001-01', { desarrollador_asignado: 'dev@homepymes.cl' });

  const datosDev = Dashboard.getData(db, {}, { rol: 'DEV', email: 'dev@homepymes.cl' });
  const ids = datosDev.recientes.map((r) => r.solicitud_id).sort();
  assert.deepEqual(ids, ['SOL-2026-HP-0001']);
});

test('Dashboard.getData NO se cae si una solicitud tiene fecha_creacion vacia o mal formada', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-GDE-0005', fecha_creacion: '' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-GDE-0006', fecha_creacion: 'SOL-2026-GDE-[N1]' });

  const datos = Dashboard.getData(db, {}, { rol: 'ADM', email: 'admin@homepymes.cl' });
  assert.equal(datos.recientes.length, 3);
  assert.ok(datos.resumen.total_abiertas >= 1);
});

test('Dashboard (v3.1): las atenciones directas no entran al tiempo promedio de resolucion', () => {
  function seedCierre(db, solicitudId, timestamp, estadoAnterior) {
    agregarFila_(db, 'HISTORIAL_ESTADOS', {
      historial_id: 'H-' + solicitudId, solicitud_id: solicitudId, subsolicitud_id: '',
      estado_anterior: estadoAnterior, estado_nuevo: 'S09', usuario: 'ana@homepymes.cl', comentario: '', timestamp: timestamp
    });
  }
  const CREADA = '2026-07-06T13:00:00.000Z';
  const CERRADA = '2026-07-07T13:00:00.000Z';
  const contexto = { rol: 'ADM', email: 'admin@homepymes.cl' };

  const soloNormal = dbConSchema();
  seedSolicitud(soloNormal, { estado_derivado: 'S09', fecha_creacion: CREADA }, ['S09']);
  seedCierre(soloNormal, 'SOL-2026-HP-0001', CERRADA, 'S08');
  const promedioBase = Dashboard.getData(soloNormal, {}, contexto).tiempo_promedio_resolucion_horas;
  assert.equal(promedioBase, 9, 'la solicitud normal si debe contar');

  const conAtencion = dbConSchema();
  seedSolicitud(conAtencion, { estado_derivado: 'S09', fecha_creacion: CREADA }, ['S09']);
  seedCierre(conAtencion, 'SOL-2026-HP-0001', CERRADA, 'S08');
  seedSolicitud(conAtencion, { solicitud_id: 'SOL-2026-HP-0002', estado_derivado: 'S09', fecha_creacion: CERRADA, atencion_directa: true }, ['S09']);
  seedCierre(conAtencion, 'SOL-2026-HP-0002', CERRADA, '');

  const datos = Dashboard.getData(conAtencion, {}, contexto);
  assert.equal(datos.tiempo_promedio_resolucion_horas, promedioBase, 'el promedio no debe moverse al agregar una atencion directa');
  assert.equal(datos.resumen.atenciones_directas, 1);
});

test('Dashboard.getPautaDesarrollador trae solo los items abiertos del desarrollador, con los campos de ejecucion', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001', desarrollador_asignado: 'leo@rld.cl', prioridad_derivada: 'P2' }, ['S05']);
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0002', desarrollador_asignado: 'otra@rld.cl', prioridad_derivada: 'P1' }, ['S02']);
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0003', desarrollador_asignado: 'leo@rld.cl', prioridad_derivada: 'P3' }, ['S09']);
  actualizarFilaPorId_(db, 'SUBSOLICITUDES', 'subsolicitud_id', 'SOL-2026-HP-0001-01', {
    url_modulo: 'https://x.cl/modulo', usuario_prueba: 'demo', ref_credencial: 'ver 1Password'
  });

  const pauta = Dashboard.getPautaDesarrollador(db, { desarrollador: 'leo@rld.cl' }, { rol: 'ADM', email: 'admin@homepymes.cl' });

  assert.equal(pauta.desarrollador, 'leo@rld.cl');
  assert.equal(pauta.items.length, 1);
  assert.equal(pauta.items[0].solicitud_id, 'SOL-2026-HP-0001');
  assert.equal(pauta.items[0].url_modulo, 'https://x.cl/modulo');
  assert.equal(pauta.items[0].usuario_prueba, 'demo');
  assert.equal(pauta.items[0].subsolicitud_id, 'SOL-2026-HP-0001-01');
});

test('Dashboard.getPautaDesarrollador ordena P1 antes que P2 y exige el parametro desarrollador', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001', desarrollador_asignado: 'leo@rld.cl', prioridad_derivada: 'P2' }, ['S05']);
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0002', desarrollador_asignado: 'leo@rld.cl', prioridad_derivada: 'P1' }, ['S02']);

  const pauta = Dashboard.getPautaDesarrollador(db, { desarrollador: 'leo@rld.cl' }, { rol: 'ADM', email: 'admin@homepymes.cl' });
  assert.equal(pauta.items[0].solicitud_id, 'SOL-2026-HP-0002');
  assert.equal(pauta.items[1].solicitud_id, 'SOL-2026-HP-0001');

  const error = Dashboard.getPautaDesarrollador(db, {}, { rol: 'ADM', email: 'admin@homepymes.cl' });
  assert.equal(error._validationError, true);
});
