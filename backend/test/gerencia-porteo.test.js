'use strict';

/**
 * Prueba de portabilidad: los mismos escenarios de backend/test/
 * gerencia.test.js (Gerencia.getPanel), corridos contra
 * backend/logica/gerencia.js. El ultimo test del original ("rol_actual
 * viaja fresco incluso cuando el panel viene del cache") se adapta: sin
 * capa de cache (ver la nota en gerencia.js), rol_actual SIEMPRE es fresco
 * -- se prueba esa garantia directamente, sin el angulo de cache.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Gerencia = require('../logica/gerencia');

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}

function seedHistorialEstado(db, overrides) {
  const base = Object.assign(
    { historial_id: 'H-' + Math.random().toString(36).slice(2), solicitud_id: 'SOL-2026-HP-0001', subsolicitud_id: 'SOL-2026-HP-0001-01', estado_anterior: '', estado_nuevo: 'S01', usuario: 'sistema', comentario: '', timestamp: '2026-07-01T10:00:00.000Z' },
    overrides
  );
  agregarFila_(db, 'HISTORIAL_ESTADOS', base);
  return base;
}

function seedSolicitud(db, overrides) {
  const base = Object.assign(
    {
      solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', plataforma: 'ERP', modulo: 'Facturacion',
      tipo: 'ERR', solicitante_nombre: 'Juan Perez', solicitante_email: 'juan@homepymes.cl',
      estado_derivado: 'S05', prioridad_derivada: 'P2', dedup_hash: 'x', estimacion_total_horas: 4,
      fecha_creacion: '2026-07-01T10:00:00.000Z', creado_por: 'juan@homepymes.cl'
    },
    overrides
  );
  agregarFila_(db, 'SOLICITUDES', base);
  return base;
}

function seedSubsolicitud(db, overrides) {
  const base = Object.assign(
    {
      subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001', numero_item: 1,
      titulo: 'Titulo', descripcion: 'Desc', prioridad: 'P2', estado: 'S05', tipo: 'ERR', tipo_nombre: 'Error / Bug',
      fecha_creacion: '2026-07-01T10:00:00.000Z', fecha_comprometida: '', fecha_terminada: '', comprometida_por: ''
    },
    overrides
  );
  agregarFila_(db, 'SUBSOLICITUDES', base);
  return base;
}

// Fecha comprometida que NO vence, en formato local ('YYYY-MM-DDTHH:mm').
function fechaComprometidaFutura_(diasDesdeHoy) {
  const d = new Date();
  d.setHours(18, 0, 0, 0);
  d.setDate(d.getDate() + (diasDesdeHoy || 30));
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mm + '-' + dd + 'T18:00';
}

// Bug confirmado por la auditoria de modulos (2026-09): coincideFiltros_
// se llamaba aqui con 3 argumentos en vez de 4 (faltaba
// titulosPorSolicitud) -- el filtro `busqueda` nunca encontraba
// coincidencias por titulo de item en el Panel de Gerencia, aunque el
// mismo filtro en el Dashboard si funciona.
test('Gerencia.getPanel: el filtro busqueda SI encuentra por titulo de item (igual que en el Dashboard)', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001' });
  seedSubsolicitud(db, {
    subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001',
    titulo: 'No cargan las facturas de exportacion'
  });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0002' });
  seedSubsolicitud(db, {
    subsolicitud_id: 'SOL-2026-HP-0002-01', solicitud_id: 'SOL-2026-HP-0002',
    titulo: 'El reporte de ventas sale vacio'
  });

  const panel = Gerencia.getPanel(db, { busqueda: 'exportacion' }, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  assert.equal(panel.items.length, 1, 'debe encontrar el item por su titulo, no solo por campos de la solicitud');
  assert.equal(panel.items[0].solicitud_id, 'SOL-2026-HP-0001');
});

test('Gerencia.getPanel (v2.1): agrupa items con su semaforo de cumplimiento', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { fecha_comprometida: fechaComprometidaFutura_() });

  const panel = Gerencia.getPanel(db, {}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });

  assert.equal(panel.items.length, 1);
  assert.equal(panel.items[0].subsolicitud_id, 'SOL-2026-HP-0001-01');
  assert.equal(panel.items[0].cumplimiento.codigo, 'EN_PLAZO');
});

test('Gerencia.getPanel (v2.1): KPIs -- sin comprometer y atrasadas activas', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-01' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-02', numero_item: 2, fecha_comprometida: '2026-01-01T18:00' });

  const panel = Gerencia.getPanel(db, {}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });

  assert.equal(panel.kpis.sin_comprometer, 1);
  assert.equal(panel.kpis.atrasadas_activas, 1);
});

test('Gerencia.getPanel (v2.1): % cumplimiento del desarrollador solo cuenta lo entregado', () => {
  const db = dbConSchema();
  seedSolicitud(db, { estado_derivado: 'S09' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', estado: 'S09', fecha_comprometida: '2026-08-05T18:00', fecha_terminada: '2026-08-01T10:00:00.000Z' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-02', numero_item: 2, estado: 'S09', fecha_comprometida: '2026-08-05T18:00', fecha_terminada: '2026-08-10T10:00:00.000Z' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-03', numero_item: 3, estado: 'S02' });

  const panel = Gerencia.getPanel(db, {}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  assert.equal(panel.kpis.pct_cumplimiento_desarrollador, 50);
});

test('Gerencia.getPanel (v2.1): esperando validacion incluye promedio de dias', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { estado: 'S08', fecha_comprometida: '2026-08-05T18:00', fecha_terminada: '2026-07-01T10:00:00.000Z' });

  const panel = Gerencia.getPanel(db, {}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  assert.equal(panel.kpis.esperando_validacion, 1);
  assert.ok(panel.kpis.esperando_validacion_promedio_dias > 0);
});

test('Gerencia.getPanel (v2.1): resbalon -- re-compromiso queda visible en fecha_original y re_compromisos', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { fecha_comprometida: '2026-08-10T18:00' });
  agregarFila_(db, 'HISTORIAL_COMPROMISO', {
    historial_id: 'H1', subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001',
    fecha_anterior: '2026-08-05T18:00', fecha_nueva: '2026-08-10T18:00',
    motivo: 'El cliente amplio el alcance del item', usuario: 'dev@homepymes.cl', timestamp: '2026-07-15T10:00:00.000Z'
  });

  const panel = Gerencia.getPanel(db, {}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  assert.equal(panel.items[0].fecha_original, '2026-08-05T18:00');
  assert.equal(panel.items[0].re_compromisos, 1);
});

test('Gerencia.getPanel (v2.1): filtro por desarrollador (a nivel item)', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', desarrollador_asignado: 'dev1@homepymes.cl' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-02', numero_item: 2, desarrollador_asignado: 'dev2@homepymes.cl' });

  const panel = Gerencia.getPanel(db, { desarrollador: 'dev1@homepymes.cl' }, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  assert.equal(panel.items.length, 1);
  assert.equal(panel.items[0].subsolicitud_id, 'SOL-2026-HP-0001-01');
});

test('Gerencia.getPanel (v2.1): filtro por empresa reutiliza coincideFiltros_ de Dashboard.gs', () => {
  const db = dbConSchema();
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0001', empresa_id: 'RLD' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-RLD-0001-01', solicitud_id: 'SOL-2026-RLD-0001', numero_item: 1 });

  const panel = Gerencia.getPanel(db, { empresa_id: 'RLD' }, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  assert.equal(panel.items.length, 1);
  assert.equal(panel.items[0].empresa_id, 'RLD');
});

test('Gerencia.getPanel (v3.0): dias_abierta y dias_desarrollador de un item activo, comprometido', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { fecha_creacion: '2026-07-01T10:00:00.000Z', fecha_comprometida: fechaComprometidaFutura_() });

  const panel = Gerencia.getPanel(db, {}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  const item = panel.items[0];
  assert.ok(item.dias_abierta > 0);
  assert.ok(item.dias_desarrollador >= 0);
});

test('Gerencia.getPanel (v3.0): dias_desarrollador es null si el item aun no tiene fecha comprometida', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db);

  const panel = Gerencia.getPanel(db, {}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  assert.equal(panel.items[0].dias_desarrollador, null);
  assert.ok(panel.items[0].dias_abierta > 0);
});

test('Gerencia.getPanel (v3.0): semaforo_solicitante es null salvo cuando el item esta ESPERANDO_VALIDACION', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { fecha_comprometida: fechaComprometidaFutura_() });

  const panel = Gerencia.getPanel(db, {}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  assert.equal(panel.items[0].cumplimiento.codigo, 'EN_PLAZO');
  assert.equal(panel.items[0].semaforo_solicitante, null);
});

test('Gerencia.getPanel (v3.0): semaforo_solicitante rojo cuando lleva >= 5 dias esperando validacion', () => {
  const db = dbConSchema();
  seedSolicitud(db, { estado_derivado: 'S08' });
  seedSubsolicitud(db, { estado: 'S08', fecha_comprometida: '2026-06-20T18:00', fecha_terminada: '2026-06-20T18:00:00.000Z' });

  const panel = Gerencia.getPanel(db, {}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  const item = panel.items[0];
  assert.equal(item.cumplimiento.codigo, 'ESPERANDO_VALIDACION');
  assert.ok(item.cumplimiento.dias_esperando >= 5);
  assert.equal(item.semaforo_solicitante.codigo, 'CERCA_CIERRE_AUTOMATICO');
});

test('Gerencia.getPanel (UI-1): resuelve desarrollador_nombre desde USUARIOS (y tolera hoja ausente)', () => {
  const db = dbConSchema();
  sembrarTabla_(db, 'USUARIOS', COLUMNAS.USUARIOS, [['U1', 'Dev Uno', 'dev1@homepymes.cl', 'HP', 'DEV', true, '', 'sistema']]);
  seedSolicitud(db);
  seedSubsolicitud(db, { desarrollador_asignado: 'dev1@homepymes.cl' });

  const panel = Gerencia.getPanel(db, {}, { rol: 'GERENCIA', email: 'g@homepymes.cl' });
  assert.equal(panel.items[0].desarrollador_nombre, 'Dev Uno');

  const db2 = dbConSchema();
  seedSolicitud(db2);
  seedSubsolicitud(db2, { desarrollador_asignado: 'x@homepymes.cl' });
  const panel2 = Gerencia.getPanel(db2, {}, { rol: 'GERENCIA', email: 'g@homepymes.cl' });
  assert.equal(panel2.items[0].desarrollador_nombre, '');
});

test('Gerencia.getPanel (v3.0): semaforo_solicitante verde cuando recien se entrego (< 1 dia esperando)', () => {
  const db = dbConSchema();
  seedSolicitud(db, { estado_derivado: 'S08' });
  const haceUnRato = new Date();
  haceUnRato.setHours(haceUnRato.getHours() - 1);
  seedSubsolicitud(db, { estado: 'S08', fecha_comprometida: '2026-06-20T18:00', fecha_terminada: haceUnRato.toISOString() });

  const panel = Gerencia.getPanel(db, {}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  const item = panel.items[0];
  assert.equal(item.cumplimiento.codigo, 'ESPERANDO_VALIDACION');
  assert.equal(item.semaforo_solicitante.codigo, 'RECIEN_ENTREGADO');
});

test('Gerencia.getPanel (v3.1): las atenciones directas no entran al semaforo', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { fecha_comprometida: fechaComprometidaFutura_() });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-HP-0002', estado_derivado: 'S09', atencion_directa: true });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0002-01', solicitud_id: 'SOL-2026-HP-0002', estado: 'S09' });

  const panel = Gerencia.getPanel(db, {}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  assert.equal(panel.items.length, 1, 'solo el item de la solicitud normal');
  assert.equal(panel.items[0].solicitud_id, 'SOL-2026-HP-0001');
  assert.equal(panel.kpis.sin_comprometer, 0, 'no debe inflar "sin comprometer"');
  assert.equal(panel.atenciones_directas, 1);
});

test('Gerencia.getPanel (v4.1, G1): expone descripcion/resultado_esperado/plataforma_nombre/area_nombre', () => {
  const db = dbConSchema();
  seedSolicitud(db, { plataforma: 'ERP', plataforma_nombre: 'ERP Contable' });
  seedSubsolicitud(db, { descripcion: 'El boton de guardar no responde', resultado_esperado: 'Que guarde el formulario sin error', area: 'CONTA', area_nombre: 'Contabilidad' });

  const panel = Gerencia.getPanel(db, {}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  const item = panel.items[0];
  assert.equal(item.descripcion, 'El boton de guardar no responde');
  assert.equal(item.resultado_esperado, 'Que guarde el formulario sin error');
  assert.equal(item.plataforma_nombre, 'ERP Contable');
  assert.equal(item.area_nombre, 'Contabilidad');
});

test('Gerencia.getPanel (v4.1, G1): "que deberia pasar" queda vacio en modo Rapido (nunca undefined)', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { resultado_esperado: '' });

  const panel = Gerencia.getPanel(db, {}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  assert.equal(panel.items[0].resultado_esperado, '');
});

test('Gerencia.getPanel (v4.1, G2): recurrencia agrupa por Modulo x Tipo, cuenta y % del total', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  const hoy = new Date().toISOString();
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', modulo_nombre: 'Facturacion', tipo_nombre: 'Error / Bug', fecha_creacion: hoy });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-02', numero_item: 2, modulo_nombre: 'Facturacion', tipo_nombre: 'Error / Bug', fecha_creacion: hoy });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-03', numero_item: 3, modulo_nombre: 'Dashboard', tipo_nombre: 'Mejora', fecha_creacion: hoy });

  const panel = Gerencia.getPanel(db, {}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  assert.equal(panel.recurrencia.length, 2);
  const facturacionError = panel.recurrencia.find((r) => r.modulo_nombre === 'Facturacion' && r.tipo_nombre === 'Error / Bug');
  assert.equal(facturacionError.cantidad, 2);
  assert.equal(facturacionError.pct_total, Math.round((2 / 3) * 1000) / 10);
  assert.equal(panel.recurrencia[0].cantidad, 2);
});

test('Gerencia.getPanel (v4.1, G2): tendencia compara la cantidad del grupo vs el periodo anterior', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  const hace45 = new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString();
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', modulo_nombre: 'Facturacion', tipo_nombre: 'Error / Bug', fecha_creacion: hace45 });
  const hoy = new Date().toISOString();
  ['02', '03', '04'].forEach((n, idx) => {
    seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-' + n, numero_item: idx + 2, modulo_nombre: 'Facturacion', tipo_nombre: 'Error / Bug', fecha_creacion: hoy });
  });

  const panel = Gerencia.getPanel(db, {}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  const grupo = panel.recurrencia.find((r) => r.modulo_nombre === 'Facturacion' && r.tipo_nombre === 'Error / Bug');
  assert.equal(grupo.cantidad, 3, 'solo cuenta el periodo actual (ultimos 30 dias)');
  assert.equal(grupo.tendencia, 2, '3 actuales - 1 anterior');
});

test('Gerencia.getPanel (v4.1, G2): reaperturas cuentan transiciones desde un estado cerrado hacia uno abierto', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { estado: 'S05' });
  seedHistorialEstado(db, { estado_anterior: '', estado_nuevo: 'S01', timestamp: '2026-07-01T10:00:00.000Z' });
  seedHistorialEstado(db, { estado_anterior: 'S08', estado_nuevo: 'S09', timestamp: '2026-07-05T10:00:00.000Z' });
  seedHistorialEstado(db, { estado_anterior: 'S09', estado_nuevo: 'S05', timestamp: '2026-07-06T10:00:00.000Z' });

  const panel = Gerencia.getPanel(db, {}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  assert.equal(panel.items[0].reaperturas, 1);
});

test('Gerencia.getPanel (v4.1, G3): tendencia trae 6 meses con creadas/cerradas/cumplimiento', () => {
  const db = dbConSchema();
  seedSolicitud(db, { estado_derivado: 'S09' });
  seedSubsolicitud(db, { estado: 'S09', fecha_comprometida: '2026-08-05T18:00', fecha_terminada: '2026-08-01T10:00:00.000Z' });

  const panel = Gerencia.getPanel(db, {}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  assert.equal(panel.tendencia.length, 6);
});

test('Gerencia.getPanel (v4.1, G4): ciclo por etapa mide dias habiles entre la primera vez que se entro a cada estado', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', estado: 'S02' });
  seedHistorialEstado(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_anterior: '', estado_nuevo: 'S01', timestamp: '2026-07-06T09:00:00.000Z' });
  seedHistorialEstado(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_anterior: 'S01', estado_nuevo: 'S02', timestamp: '2026-07-09T09:00:00.000Z' });

  const panel = Gerencia.getPanel(db, {}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  assert.equal(panel.ciclo_por_etapa.length, 8, 'S01..S09 son 8 transiciones');
  const s01s02 = panel.ciclo_por_etapa.find((c) => c.estado_desde === 'S01' && c.estado_hasta === 'S02');
  assert.equal(s01s02.muestras, 1);
  assert.equal(s01s02.dias_promedio, 3);
  const sinDatos = panel.ciclo_por_etapa.find((c) => c.estado_desde === 'S02' && c.estado_hasta === 'S03');
  assert.equal(sinDatos.dias_promedio, null);
  assert.equal(sinDatos.muestras, 0);
});

test('Gerencia.getPanel (v4.1, G4): usa la PRIMERA vez que entro a cada estado (un rebote no infla el promedio)', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', estado: 'S02' });
  seedHistorialEstado(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_anterior: '', estado_nuevo: 'S01', timestamp: '2026-07-06T09:00:00.000Z' });
  seedHistorialEstado(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_anterior: 'S01', estado_nuevo: 'S02', timestamp: '2026-07-07T09:00:00.000Z' });
  seedHistorialEstado(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_anterior: 'S02', estado_nuevo: 'S01', timestamp: '2026-07-08T09:00:00.000Z' });
  seedHistorialEstado(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', estado_anterior: 'S01', estado_nuevo: 'S02', timestamp: '2026-07-20T09:00:00.000Z' });

  const panel = Gerencia.getPanel(db, {}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  const s01s02 = panel.ciclo_por_etapa.find((c) => c.estado_desde === 'S01' && c.estado_hasta === 'S02');
  assert.equal(s01s02.muestras, 1, 'una sola muestra: la primera vez que entro a S02');
  assert.equal(s01s02.dias_promedio, 1);
});

test('Gerencia.getPanel (v4.1, G6): carga agrupa por empresa/plataforma/area', () => {
  const db = dbConSchema();
  seedSolicitud(db, { empresa_id: 'HP', plataforma_nombre: 'ERP Contable' });
  seedSolicitud(db, { solicitud_id: 'SOL-2026-RLD-0001', empresa_id: 'RLD', plataforma_nombre: 'Hoja de ruta' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', area_nombre: 'Contabilidad' });
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-RLD-0001-01', solicitud_id: 'SOL-2026-RLD-0001', area_nombre: 'Operaciones' });

  const panel = Gerencia.getPanel(db, {}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  assert.equal(panel.carga.por_empresa.length, 2);
  assert.ok(panel.carga.por_empresa.every((c) => c.cantidad === 1));
  assert.ok(panel.carga.por_plataforma.some((c) => c.etiqueta === 'ERP Contable'));
  assert.ok(panel.carga.por_area.some((c) => c.etiqueta === 'Operaciones'));
});

test('Gerencia.getPanel (v4.1, G7): kpis.comparativo trae el delta vs el periodo anterior', () => {
  const db = dbConSchema();
  seedSolicitud(db, { estado_derivado: 'S09' });
  const hace45 = new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString();
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', fecha_creacion: hace45, fecha_comprometida: '2020-01-01T18:00' });
  const hoy = new Date().toISOString();
  ['02', '03', '04'].forEach((n, idx) => {
    seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-' + n, numero_item: idx + 2, fecha_creacion: hoy, fecha_comprometida: '2020-01-01T18:00' });
  });

  const panel = Gerencia.getPanel(db, {}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  assert.equal(panel.kpis.comparativo.atrasadas_activas, 2, '3 actuales - 1 anterior');
});

test('Gerencia.getPanel: con período elegido, el comparativo resta la ventana ANTERIOR (no repite el valor actual)', () => {
  const db = dbConSchema();
  seedSolicitud(db, { estado_derivado: 'S09' });
  // 1 atrasada creada en agosto (ventana anterior) y 3 en septiembre (período).
  seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-01', fecha_creacion: '2026-08-10T10:00:00.000Z', fecha_comprometida: '2020-01-01T18:00' });
  ['02', '03', '04'].forEach((n, idx) => {
    seedSubsolicitud(db, { subsolicitud_id: 'SOL-2026-HP-0001-' + n, numero_item: idx + 2, fecha_creacion: '2026-09-10T10:00:00.000Z', fecha_comprometida: '2020-01-01T18:00' });
  });
  const panel = Gerencia.getPanel(db, { desde: '2026-09-01', hasta: '2026-09-30' }, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  assert.equal(panel.items.length, 3, 'items sigue recortado al período');
  assert.equal(panel.kpis.atrasadas_activas, 3);
  assert.equal(panel.kpis.comparativo.atrasadas_activas, 2, '3 del período - 1 de la ventana anterior (antes daba 3)');
});

test('Gerencia.getPanel (v4.1, G7): comparativo es null (no cero) cuando falta dato en un lado', () => {
  const db = dbConSchema();
  seedSolicitud(db, { estado_derivado: 'S09' });
  const hoy = new Date().toISOString();
  seedSubsolicitud(db, { fecha_creacion: hoy, estado: 'S09', fecha_comprometida: '2026-08-05T18:00', fecha_terminada: '2026-08-01T10:00:00.000Z' });

  const panel = Gerencia.getPanel(db, {}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  assert.equal(panel.kpis.comparativo.pct_cumplimiento_desarrollador, null);
});

test('Gerencia.getPanel (v4.1): sin HISTORIAL_ESTADOS (instalacion vieja), G2/G4 no revientan y quedan en cero', () => {
  const db = abrirDb_();
  ['SOLICITUDES', 'SUBSOLICITUDES', 'HISTORIAL_COMPROMISO', 'CONFIG_FERIADOS'].forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  seedSolicitud(db);
  seedSubsolicitud(db);

  const panel = Gerencia.getPanel(db, {}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  assert.equal(panel.items[0].reaperturas, 0);
  assert.ok(panel.ciclo_por_etapa.every((c) => c.muestras === 0));
});

// Adaptado del test v5.2 original: sin capa de cache, rol_actual siempre
// refleja al llamador actual (nunca hay un valor cacheado del que "prestarlo").
test('Gerencia.getPanel: rol_actual siempre refleja al llamador actual, aunque los filtros sean identicos', () => {
  const db = dbConSchema();
  seedSolicitud(db);
  seedSubsolicitud(db);

  const primero = Gerencia.getPanel(db, {}, { rol: 'ADM', email: 'admin@homepymes.cl' });
  assert.equal(primero.rol_actual, 'ADM');

  const segundo = Gerencia.getPanel(db, {}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  assert.equal(segundo.rol_actual, 'GERENCIA');
});
