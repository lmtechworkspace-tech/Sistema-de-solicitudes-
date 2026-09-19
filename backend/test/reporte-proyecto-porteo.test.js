'use strict';

/**
 * Prueba de portabilidad: los DOS caminos de Proyectos.descargarReporte
 * (construirHtmlReporteProyecto_ + construirHtmlReporteConfigurado_ en el
 * .gs), corridos contra reporteProyecto.js. Prueba que el PDF se genere
 * sin romper en distintos estados de datos, y que el modo configurable
 * aplique los filtros de personas/estado/rango -- el "Avance por tarea" y
 * las secciones simplificadas son decisiones de diseño nuevas (ver
 * cabecera del módulo), no una réplica 1:1 del HTML del .gs, así que no se
 * prueba contra ese HTML sino contra el CONTENIDO (quién sale, quién no).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Proyectos = require('../logica/proyectos');
const Actividades = require('../logica/actividades');
const Reporte = require('../logica/reporteProyecto');

const CTX_LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV' };
const CTX_MARCELO = { email: 'marcelo@rld.cl', nombre: 'Marcelo Integrante', rol: 'DEV' };
const CTX_OTRO = { email: 'otro@rld.cl', nombre: 'Otro Ajeno', rol: 'DEV' };

const TABLAS = [
  'PROYECTOS', 'PROYECTO_INTEGRANTES', 'PROYECTO_HITOS', 'PROYECTO_EVENTOS',
  'PROYECTO_ENTREGABLES', 'PROYECTO_RIESGOS', 'PROYECTO_PLANTILLAS', 'PROYECTO_PLANTILLA_HITOS',
  'PROYECTO_DOCUMENTOS', 'PROYECTO_DOC_VERSIONES', 'PROYECTO_REUNIONES', 'PROYECTO_REUNION_ACUERDOS',
  'PROYECTO_DECISIONES', 'SOLICITUDES', 'ACTIVIDADES', 'ACTIVIDADES_BITACORA', 'JEFATURAS',
  'LOG_NOTIFICACIONES', 'CONFIG_FERIADOS', 'NOTIFICACIONES_APP', 'CAT_AREAS'
];
function db_() {
  const db = abrirDb_();
  TABLAS.forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function crearProyectoBase(db, over) {
  return Proyectos.crear(db, Object.assign({ nombre: 'Migración ERP', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-10-01' }, over), CTX_LEO);
}
function pdfValido_(base64) {
  return Buffer.from(base64, 'base64').slice(0, 4).toString('ascii') === '%PDF';
}

test('descargarReporte: config con gantt/workload/leyenda devuelve _validationError explicito, no un PDF a medias', async () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  for (const seccion of ['gantt', 'workload', 'leyenda']) {
    const res = await Reporte.descargarReporte(db, { proyecto_id: proyecto.proyecto_id, config: { secciones: ['ficha', seccion] } }, CTX_LEO);
    assert.equal(res._validationError, true, seccion + ' deberia rechazarse');
    assert.match(res.message, /todavía no está disponible/i);
  }
});

test('descargarReporte: proyecto inexistente devuelve _validationError (nunca dibuja un PDF)', async () => {
  const db = db_();
  const res = await Reporte.descargarReporte(db, { proyecto_id: 'NO-EXISTE' }, CTX_LEO);
  assert.equal(res._validationError, true);
});

test('descargarReporte: sin acceso al proyecto devuelve _forbidden (nunca dibuja un PDF)', async () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const res = await Reporte.descargarReporte(db, { proyecto_id: proyecto.proyecto_id }, CTX_OTRO);
  assert.equal(res._forbidden, true);
});

test('descargarReporte: proyecto recien creado (sin tareas/hitos/riesgos) genera un PDF valido', async () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const res = await Reporte.descargarReporte(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.ok(!res._validationError, JSON.stringify(res));
  assert.ok(pdfValido_(res.pdf_base64));
  assert.equal(res.filename, 'Reporte - Migración ERP.pdf');
});

test('descargarReporte: proyecto con tareas (en curso y terminada), hitos y riesgos genera un PDF valido', async () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);

  const t1 = Proyectos.crearTarea(db, {
    proyecto_id: proyecto.proyecto_id, titulo: 'Levantar requisitos', responsable_email: 'marcelo@rld.cl',
    fecha_compromiso: '2026-09-01', prioridad: 'P1', meta_cantidad: 10, meta_unidad: 'pantallas'
  }, CTX_LEO);
  Actividades.confirmar(db, { actividad_id: t1.actividad_id }, CTX_MARCELO);
  Actividades.checkin(db, { actividad_id: t1.actividad_id, nota: 'Avanzando', horas: 3 }, CTX_MARCELO);

  const t2 = Proyectos.crearTarea(db, {
    proyecto_id: proyecto.proyecto_id, titulo: 'Configurar ambiente', responsable_email: 'marcelo@rld.cl',
    fecha_compromiso: '2026-08-20', prioridad: 'P2'
  }, CTX_LEO);
  Actividades.confirmar(db, { actividad_id: t2.actividad_id }, CTX_MARCELO);
  Actividades.validar(db, { actividad_id: t2.actividad_id }, CTX_MARCELO);

  Proyectos.gestionarHito(db, { proyecto_id: proyecto.proyecto_id, nombre: 'Kickoff', fecha_objetivo: '2026-08-05' }, CTX_LEO);
  Proyectos.gestionarRiesgo(db, { proyecto_id: proyecto.proyecto_id, descripcion: 'Falta de disponibilidad del equipo cliente', probabilidad: 'ALTA', impacto: 'ALTA' }, CTX_LEO);

  const res = await Reporte.descargarReporte(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);

  assert.ok(!res._validationError, JSON.stringify(res));
  assert.ok(pdfValido_(res.pdf_base64));
});

// ===== Modo "Configurar informe" ============================================

test('normalizarConfig_: secciones vacias/invalidas caen a ["ficha"], nunca un PDF vacio', () => {
  assert.deepEqual(Reporte.normalizarConfig_({}).secciones, ['ficha']);
  assert.deepEqual(Reporte.normalizarConfig_({ secciones: ['no_existe'] }).secciones, ['ficha']);
  assert.deepEqual(Reporte.normalizarConfig_({ secciones: ['kpis', 'no_existe', 'salud'] }).secciones, ['kpis', 'salud']);
});

test('normalizarConfig_: normaliza personas a minusculas, rechaza estado invalido, valida el rango', () => {
  const c = Reporte.normalizarConfig_({ secciones: ['ficha'], personas: [' Marcelo@RLD.cl '], estado: 'invalido', rango: { desde: '2026-09-01', hasta: '2026-08-01' } });
  assert.deepEqual(c.personas, ['marcelo@rld.cl']);
  assert.equal(c.estado, '');
  assert.equal(c.rango, null); // desde > hasta -- invalido

  const c2 = Reporte.normalizarConfig_({ secciones: ['ficha'], estado: 'atrasadas', rango: { desde: '2026-08-01', hasta: '2026-09-01' } });
  assert.equal(c2.estado, 'atrasadas');
  assert.deepEqual(c2.rango, { desde: '2026-08-01', hasta: '2026-09-01' });
});

test('normalizarConfig_: sin config devuelve null (camino clasico)', () => {
  assert.equal(Reporte.normalizarConfig_(null), null);
  assert.equal(Reporte.normalizarConfig_(undefined), null);
});

test('filtrarTareas_: por personas, por estado abiertas/atrasadas', () => {
  const tareas = [
    { actividad_id: 'A1', responsable_email: 'marcelo@rld.cl', estado: 'EN_CURSO', semaforo: 'atrasada' },
    { actividad_id: 'A2', responsable_email: 'ana@rld.cl', estado: 'TERMINADA', semaforo: 'terminada' },
    { actividad_id: 'A3', responsable_email: 'marcelo@rld.cl', estado: 'EN_CURSO', semaforo: 'al-dia' }
  ];
  const soloMarcelo = Reporte.filtrarTareas_(tareas, { personas: ['marcelo@rld.cl'], estado: '' });
  assert.deepEqual(soloMarcelo.map((t) => t.actividad_id), ['A1', 'A3']);

  const abiertas = Reporte.filtrarTareas_(tareas, { personas: [], estado: 'abiertas' });
  assert.deepEqual(abiertas.map((t) => t.actividad_id), ['A1', 'A3']);

  const atrasadas = Reporte.filtrarTareas_(tareas, { personas: [], estado: 'atrasadas' });
  assert.deepEqual(atrasadas.map((t) => t.actividad_id), ['A1']);
});

function proyectoConfigurable_(db) {
  const proyecto = crearProyectoBase(db);
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'ana@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Tarea de Marcelo', responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-08-15', prioridad: 'P1' }, CTX_LEO);
  Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Tarea de Ana', responsable_email: 'ana@rld.cl', fecha_compromiso: '2026-09-15', prioridad: 'P2' }, CTX_LEO);
  Proyectos.gestionarRiesgo(db, { proyecto_id: proyecto.proyecto_id, descripcion: 'Riesgo alto', probabilidad: 'ALTA', impacto: 'ALTA' }, CTX_LEO);
  return proyecto;
}

test('descargarReporte configurado: portada+kpis+salud+desviaciones genera un PDF valido', async () => {
  const db = db_();
  const proyecto = proyectoConfigurable_(db);
  const res = await Reporte.descargarReporte(db, {
    proyecto_id: proyecto.proyecto_id, config: { secciones: ['portada', 'kpis', 'salud', 'desviaciones', 'riesgos'] }
  }, CTX_LEO);
  assert.ok(!res._validationError, JSON.stringify(res));
  assert.ok(pdfValido_(res.pdf_base64));
  assert.equal(res.filename, 'Reporte - Migración ERP.pdf'); // mismo nombre que el camino clasico
});

test('descargarReporte configurado: config vacia cae a ["ficha"] (nunca un PDF vacio)', async () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const res = await Reporte.descargarReporte(db, { proyecto_id: proyecto.proyecto_id, config: {} }, CTX_LEO);
  assert.ok(!res._validationError, JSON.stringify(res));
  assert.ok(pdfValido_(res.pdf_base64));
});

test('descargarReporte configurado: respeta el guardia de acceso de Proyectos.getDetalle', async () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const res = await Reporte.descargarReporte(db, { proyecto_id: proyecto.proyecto_id, config: { secciones: ['ficha'] } }, CTX_OTRO);
  assert.equal(res._forbidden, true);
});

test('descargarReporte configurado: con rango de fechas invalido (desde > hasta) sigue generando el PDF (cae a sin rango)', async () => {
  const db = db_();
  const proyecto = proyectoConfigurable_(db);
  const res = await Reporte.descargarReporte(db, {
    proyecto_id: proyecto.proyecto_id,
    config: { secciones: ['bitacora'], rango: { desde: '2026-12-01', hasta: '2026-01-01' } }
  }, CTX_LEO);
  assert.ok(!res._validationError, JSON.stringify(res));
  assert.ok(pdfValido_(res.pdf_base64));
});
