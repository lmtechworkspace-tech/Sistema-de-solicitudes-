'use strict';

/**
 * Prueba de portabilidad: escenarios de proyectos.test.js +
 * proyectos-p2-subtareas-impacto.test.js + proyectos-fase2-dashboard.test.js +
 * proyectos-fase5-reuniones-decisiones.test.js (sin el caso de documentos,
 * R2-gated) + proyectos-ruta-critica.test.js + proyectos-fechas-coherentes.test.js,
 * corridos contra backend/logica/proyectos.js (incremento 1).
 *
 * Adaptaciones:
 *  - errorValidacion_ en Node usa {campo, message} (singular), no
 *    {fields:[{campo,...}]} como el .gs -- mismo criterio que el resto del
 *    porteo (actividades.js/pausas.js).
 *  - descargarReporte/descargarLibro/gestionarDocumento/adjuntos/Cronograma
 *    avanzado quedan fuera (PDF/R2/incremento 2), probados en el test del
 *    router (gate con error de validacion).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Proyectos = require('../logica/proyectos');
const Actividades = require('../logica/actividades');

const CTX_LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV' };
const CTX_MARCELO = { email: 'marcelo@rld.cl', nombre: 'Marcelo Integrante', rol: 'DEV' };
const CTX_OTRO = { email: 'otro@rld.cl', nombre: 'Otro Ajeno', rol: 'DEV' };
const CTX_ADM = { email: 'admin@rld.cl', nombre: 'Admin', rol: 'ADM' };
const CTX_GERENCIA = { email: 'gerencia@rld.cl', nombre: 'Gerencia', rol: 'GERENCIA' };

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
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
function diasDesdeHoy(n) { return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10); }

function crearProyectoBase(db, over) {
  return Proyectos.crear(db, Object.assign({ nombre: 'Migración ERP', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-10-01' }, over), CTX_LEO);
}
function armarProyectoConMarcelo(db) {
  const proyecto = crearProyectoBase(db);
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  return proyecto;
}

// ===== CRUD del proyecto ====================================================

test('crear: exige nombre/fechas; el creador queda como LIDER', () => {
  const db = db_();
  assert.equal(Proyectos.crear(db, { fecha_inicio: '2026-08-01', fecha_objetivo: '2026-10-01' }, CTX_LEO)._validationError, true);
  const proyecto = crearProyectoBase(db);
  assert.equal(proyecto.lider_email, 'leo@rld.cl');
  assert.equal(proyecto.estado, 'PLANIFICACION');
  assert.equal(proyecto.activa, true);
  const integrantes = filas(db, 'PROYECTO_INTEGRANTES').filter((i) => i.proyecto_id === proyecto.proyecto_id);
  assert.equal(integrantes.length, 1);
  assert.equal(integrantes[0].rol_proyecto, 'LIDER');
});

test('crear: si ADM lo crea para otro lider, ADM tambien queda como integrante', () => {
  const db = db_();
  const proyecto = Proyectos.crear(db, { nombre: 'Portal clientes', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-09-01', lider_email: 'leo@rld.cl' }, CTX_ADM);
  const integrantes = filas(db, 'PROYECTO_INTEGRANTES').filter((i) => i.proyecto_id === proyecto.proyecto_id);
  assert.equal(integrantes.length, 2);
  assert.deepEqual(integrantes.map((i) => i.usuario_email + ':' + i.rol_proyecto).sort(), ['admin@rld.cl:INTEGRANTE', 'leo@rld.cl:LIDER']);
});

test('crear rechaza un proyecto que termina antes de empezar; acepta un solo dia', () => {
  const db = db_();
  const r = Proyectos.crear(db, { nombre: 'Al revés', fecha_inicio: '2026-12-01', fecha_objetivo: '2026-01-01' }, CTX_LEO);
  assert.equal(r._validationError, true);
  assert.equal(r.campo, 'fecha_objetivo');
  assert.ok(Proyectos.crear(db, { nombre: 'De un día', fecha_inicio: '2026-03-10', fecha_objetivo: '2026-03-10' }, CTX_LEO).proyecto_id);
});

test('actualizar valida la combinacion resultante, no el campo que llega; no toca fechas sigue funcionando', () => {
  const db = db_();
  const p = crearProyectoBase(db, { fecha_inicio: '2026-06-01', fecha_objetivo: '2026-09-01' });
  assert.equal(Proyectos.actualizar(db, { proyecto_id: p.proyecto_id, fecha_objetivo: '2026-02-01' }, CTX_LEO)._validationError, true);
  assert.equal(Proyectos.actualizar(db, { proyecto_id: p.proyecto_id, fecha_inicio: '2026-11-01' }, CTX_LEO)._validationError, true);
  const ambas = Proyectos.actualizar(db, { proyecto_id: p.proyecto_id, fecha_inicio: '2027-01-01', fecha_objetivo: '2027-06-01' }, CTX_LEO);
  assert.equal(ambas._validationError, undefined);
  const fila = filas(db, 'PROYECTOS').find((x) => x.proyecto_id === p.proyecto_id);
  assert.equal(String(fila.fecha_inicio).slice(0, 10), '2027-01-01');
  const sinTocar = Proyectos.actualizar(db, { proyecto_id: p.proyecto_id, descripcion: 'nueva' }, CTX_LEO);
  assert.equal(sinTocar._validationError, undefined);
});

test('actualizar: cerrar un proyecto exige motivo y fija fecha_cierre_real', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  assert.equal(Proyectos.actualizar(db, { proyecto_id: proyecto.proyecto_id, estado: 'CERRADO' }, CTX_LEO)._validationError, true);
  const cerrado = Proyectos.actualizar(db, { proyecto_id: proyecto.proyecto_id, estado: 'CERRADO', motivo: 'Entregado y aprobado.' }, CTX_LEO);
  assert.equal(cerrado.estado, 'CERRADO');
  assert.ok(cerrado.fecha_cierre_real);
});

// ===== portafolio ===========================================================

test('listar: un integrante solo ve sus proyectos; ADM/GERENCIA ven todos', () => {
  const db = db_();
  const propio = crearProyectoBase(db, { nombre: 'Proyecto de Leo' });
  crearProyectoBase(db, { nombre: 'Proyecto ajeno', lider_email: 'otro@rld.cl' });
  const comoOtro = Proyectos.listar(db, {}, CTX_OTRO);
  assert.equal(comoOtro.length, 1);
  const comoLeo = Proyectos.listar(db, {}, CTX_LEO);
  assert.equal(comoLeo.length, 2);
  assert.ok(comoLeo.some((p) => p.proyecto_id === propio.proyecto_id));
  assert.equal(Proyectos.listar(db, {}, CTX_ADM).length, 2);
  assert.equal(Proyectos.listar(db, {}, CTX_GERENCIA).length, 2);
});

test('listar: expone integrantes {email,nombre} con el LIDER primero', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db, { lider_nombre: 'Leo Lider' });
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', usuario_nombre: 'Marcelo Integrante', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  const listado = Proyectos.listar(db, {}, CTX_LEO).find((p) => p.proyecto_id === proyecto.proyecto_id);
  assert.equal(listado.integrantes.length, 2);
  assert.equal(listado.integrantes[0].email, 'leo@rld.cl');
  assert.equal(listado.integrantes[1].email, 'marcelo@rld.cl');
});

// ===== integrantes ===========================================================

test('gestionarIntegrante: el LIDER agrega; un INTEGRANTE no puede; no se puede quitar al unico LIDER', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const agregado = Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  assert.equal(agregado.rol_proyecto, 'INTEGRANTE');
  assert.equal(Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'otro@rld.cl' }, CTX_MARCELO)._forbidden, true);
  const lider = filas(db, 'PROYECTO_INTEGRANTES').find((i) => i.proyecto_id === proyecto.proyecto_id && i.rol_proyecto === 'LIDER');
  assert.equal(Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, accion: 'quitar', integrante_id: lider.integrante_id }, CTX_LEO)._validationError, true);
});

// ===== detalle ===============================================================

test('getDetalle: un OBSERVADOR ve el proyecto pero un ajeno no puede', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'OBSERVADOR' }, CTX_LEO);
  const detalleObservador = Proyectos.getDetalle(db, { proyecto_id: proyecto.proyecto_id }, CTX_MARCELO);
  assert.equal(detalleObservador.rol_actual, 'OBSERVADOR');
  assert.equal(detalleObservador.salud, 'normal');
  assert.equal(Proyectos.getDetalle(db, { proyecto_id: proyecto.proyecto_id }, CTX_OTRO)._forbidden, true);
});

test('getDetalle: puede_gestionar true para LIDER/ADM, false para INTEGRANTE/GERENCIA', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  assert.equal(Proyectos.getDetalle(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO).puede_gestionar, true);
  assert.equal(Proyectos.getDetalle(db, { proyecto_id: proyecto.proyecto_id }, CTX_ADM).puede_gestionar, true);
  assert.equal(Proyectos.getDetalle(db, { proyecto_id: proyecto.proyecto_id }, CTX_MARCELO).puede_gestionar, false);
  assert.equal(Proyectos.getDetalle(db, { proyecto_id: proyecto.proyecto_id }, CTX_GERENCIA).puede_gestionar, false);
});

test('getDetalleCompleto: junta detalle+tareas+sala; rechaza a un ajeno', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Tarea 1', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);
  Proyectos.publicarEnSala(db, { proyecto_id: proyecto.proyecto_id, tipo: 'COMENTARIO', cuerpo: 'Hola equipo' }, CTX_LEO);
  assert.equal(Proyectos.getDetalleCompleto(db, { proyecto_id: proyecto.proyecto_id }, CTX_OTRO)._forbidden, true);
  const completo = Proyectos.getDetalleCompleto(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(completo.tareas.length, 1);
  assert.ok(completo.sala.some((e) => e.cuerpo === 'Hola equipo'));
});

test('avance_pct del proyecto se deriva de tareas terminadas', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const t1 = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'T1', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-12-01' }, CTX_LEO);
  Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'T2', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-12-01' }, CTX_LEO);
  Actividades.checkin(db, { actividad_id: t1.actividad_id, tipo: 'listo' }, CTX_LEO);
  assert.equal(Proyectos.getDetalle(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO).avance_pct, 50);
});

// ===== dashboard (Fase 2): avance_esperado + requiere_atencion ============

test('getDetalle: avance_esperado_pct lineal; null si el plan esta invertido', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db, { fecha_inicio: diasDesdeHoy(-10), fecha_objetivo: diasDesdeHoy(10) });
  const detalle = Proyectos.getDetalle(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.ok(detalle.avance_esperado_pct > 40 && detalle.avance_esperado_pct < 60);
  const invertido = crearProyectoBase(db, { nombre: 'Invertido', fecha_inicio: diasDesdeHoy(5), fecha_objetivo: diasDesdeHoy(5) });
  assert.equal(Proyectos.getDetalle(db, { proyecto_id: invertido.proyecto_id }, CTX_LEO).avance_esperado_pct, null);
});

test('getDetalle: requiere_atencion mantiene contadores + items accionables; vacio si nada pendiente', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db, { fecha_inicio: diasDesdeHoy(-30), fecha_objetivo: diasDesdeHoy(30) });
  Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Firmar contrato', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(-3), prioridad: 'P1' }, CTX_LEO);
  Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Actualizar wiki', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(-2), prioridad: 'P4' }, CTX_LEO);
  const bloqueada = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Integrar API', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(10) }, CTX_LEO);
  Actividades.checkin(db, { actividad_id: bloqueada.actividad_id, tipo: 'bloqueo', bloqueo_motivo: 'Esperando credenciales' }, CTX_LEO);
  Proyectos.gestionarHito(db, { proyecto_id: proyecto.proyecto_id, nombre: 'Kickoff', fecha_objetivo: diasDesdeHoy(-5) }, CTX_LEO);
  Proyectos.gestionarRiesgo(db, { proyecto_id: proyecto.proyecto_id, descripcion: 'El proveedor puede fallar', probabilidad: 'ALTA', impacto: 'ALTA' }, CTX_LEO);
  Proyectos.gestionarRiesgo(db, { proyecto_id: proyecto.proyecto_id, descripcion: 'Riesgo menor', probabilidad: 'BAJA', impacto: 'BAJA' }, CTX_LEO);

  const at = Proyectos.getDetalle(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO).requiere_atencion;
  assert.equal(at.tareas_vencidas, 2);
  assert.equal(at.tareas_bloqueadas, 1);
  assert.equal(at.hitos_atrasados, 1);
  assert.equal(at.tareas_criticas_atrasadas, 1);
  assert.equal(at.riesgos_altos, 1);
  assert.deepEqual(at.items.map((i) => i.tipo).sort(), ['hito_atrasado', 'riesgo_alto', 'tarea_bloqueada', 'tarea_critica_atrasada', 'tarea_vencida']);
  assert.equal(at.items.filter((i) => i.titulo === 'Firmar contrato').length, 1);

  const sano = crearProyectoBase(db, { nombre: 'Sano', fecha_inicio: diasDesdeHoy(-5), fecha_objetivo: diasDesdeHoy(30) });
  Proyectos.crearTarea(db, { proyecto_id: sano.proyecto_id, titulo: 'Todo a tiempo', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(15) }, CTX_LEO);
  const atSano = Proyectos.getDetalle(db, { proyecto_id: sano.proyecto_id }, CTX_LEO).requiere_atencion;
  assert.deepEqual(atSano.items, []);
  assert.equal(atSano.items_total, 0);
});

// ===== tareas: la decision central -- son ACTIVIDADES =====================

test('crearTarea: delega en Actividades.crear; el check-in del motor sigue funcionando', () => {
  const db = db_();
  const proyecto = armarProyectoConMarcelo(db);
  const tarea = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Levantar requerimientos', responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-08-20' }, CTX_LEO);
  assert.ok(tarea.actividad_id);
  assert.equal(tarea.proyecto_id, proyecto.proyecto_id);
  assert.equal(tarea.proyecto, proyecto.nombre);
  assert.equal(tarea.supervisor_email, 'leo@rld.cl');
  assert.equal(filas(db, 'ACTIVIDADES').filter((a) => a.actividad_id === tarea.actividad_id).length, 1);
  const avanzada = Actividades.checkin(db, { actividad_id: tarea.actividad_id, tipo: 'avance', avance_pct: 40 }, CTX_MARCELO);
  assert.equal(avanzada.estado, 'EN_CURSO');
  assert.equal(avanzada.avance_pct, 40);
});

test('crearTarea: un OBSERVADOR no puede crear tareas', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'OBSERVADOR' }, CTX_LEO);
  assert.equal(Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Algo', responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-08-20' }, CTX_MARCELO)._forbidden, true);
});

test('listarTareas: filtra por proyecto_id, acotado a integrantes; rechaza a un ajeno', () => {
  const db = db_();
  const proyecto = armarProyectoConMarcelo(db);
  Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Tarea 1', responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-08-20' }, CTX_LEO);
  Actividades.crear(db, { titulo: 'Suelta', fecha_compromiso: '2026-08-20' }, CTX_MARCELO);
  const tareas = Proyectos.listarTareas(db, { proyecto_id: proyecto.proyecto_id }, CTX_MARCELO);
  assert.equal(tareas.length, 1);
  assert.ok(tareas[0].semaforo);
  assert.equal(Proyectos.listarTareas(db, { proyecto_id: proyecto.proyecto_id }, CTX_OTRO)._forbidden, true);
});

test('crearTarea: colaboradores se filtran a integrantes; listarTareas los expone con nombre', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', usuario_nombre: 'Marcelo', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  const tarea = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Compartida', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01', colaboradores_emails: ['marcelo@rld.cl', 'ajeno@rld.cl'] }, CTX_LEO);
  assert.deepEqual(JSON.parse(tarea.colaboradores_emails), ['marcelo@rld.cl']);
  const t = Proyectos.listarTareas(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO).find((x) => x.actividad_id === tarea.actividad_id);
  assert.equal(t.colaboradores[0].email, 'marcelo@rld.cl');
  assert.equal(t.colaboradores[0].nombre, 'Marcelo');
});

test('editarTarea: quien trabaja la tarea puede editar aunque no gestione el proyecto', () => {
  const db = db_();
  const proyecto = armarProyectoConMarcelo(db);
  const tarea = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'T', responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-08-20' }, CTX_LEO);
  const editado = Proyectos.editarTarea(db, { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, titulo: 'T editada' }, CTX_MARCELO);
  assert.equal(editado.titulo, 'T editada');
  assert.equal(Proyectos.editarTarea(db, { proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, titulo: 'x' }, CTX_OTRO)._forbidden, true);
});

test('crearTarea: depende_de debe ser del MISMO proyecto', () => {
  const db = db_();
  const proyectoA = crearProyectoBase(db, { nombre: 'A' });
  const proyectoB = crearProyectoBase(db, { nombre: 'B' });
  const tareaB = Proyectos.crearTarea(db, { proyecto_id: proyectoB.proyecto_id, titulo: 'De B', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-08-20' }, CTX_LEO);
  assert.equal(Proyectos.crearTarea(db, { proyecto_id: proyectoA.proyecto_id, titulo: 'De A', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-08-20', depende_de: tareaB.actividad_id }, CTX_LEO)._validationError, true);
});

test('listarTareas: dependencia_comprometida true si la base esta atrasada', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const base = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Diseño', responsable_email: 'leo@rld.cl', fecha_compromiso: '2020-01-01' }, CTX_LEO);
  const dependiente = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Impl', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-12-01', depende_de: base.actividad_id }, CTX_LEO);
  const fila = Proyectos.listarTareas(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO).find((t) => t.actividad_id === dependiente.actividad_id);
  assert.equal(fila.dependencia_comprometida, true);
  assert.equal(fila.dependencia_titulo, 'Diseño');
});

// ===== subtareas con rollup + impacto de dependencia (P2) ==================

test('crearTarea con tarea_padre_id: exige mismo proyecto y prohíbe un tercer nivel', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const padre = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Padre', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);
  assert.equal(Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Hija', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01', tarea_padre_id: 'no-existe' }, CTX_LEO)._validationError, true);
  const hija = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Hija', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01', tarea_padre_id: padre.actividad_id }, CTX_LEO);
  assert.ok(hija.actividad_id);
  assert.equal(Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Nieta', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01', tarea_padre_id: hija.actividad_id }, CTX_LEO)._validationError, true);
});

test('listarTareas: rollup de avance se calcula on-read; sin hijas, cero regresion', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const padre = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Padre', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);
  const h1 = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'H1', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01', tarea_padre_id: padre.actividad_id }, CTX_LEO);
  const h2 = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'H2', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01', tarea_padre_id: padre.actividad_id }, CTX_LEO);
  Actividades.checkin(db, { actividad_id: h1.actividad_id, tipo: 'listo' }, CTX_LEO);
  const tareas = Proyectos.listarTareas(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const filaPadre = tareas.find((t) => t.actividad_id === padre.actividad_id);
  assert.equal(filaPadre.subtareas_total, 2);
  assert.equal(filaPadre.avance_rollup_pct, 50);
  const filaHija = tareas.find((t) => t.actividad_id === h2.actividad_id);
  assert.equal(filaHija.es_subtarea, true);
  assert.equal(filaHija.padre_titulo, 'Padre');
  assert.equal(filaHija.subtareas_total, undefined);

  const suelta = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Suelta', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);
  const filaSuelta = Proyectos.listarTareas(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO).find((t) => t.actividad_id === suelta.actividad_id);
  assert.equal(filaSuelta.subtareas_total, undefined);
  assert.equal(filaSuelta.es_subtarea, false);
});

test('listarTareas: impacto_dependientes cuenta transitivamente (A<-B<-C), tope 3 titulos; 0 si nadie depende', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const a = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'A', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);
  const b = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'B', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-05', depende_de: a.actividad_id }, CTX_LEO);
  const c = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'C', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-10', depende_de: b.actividad_id }, CTX_LEO);
  const tareas = Proyectos.listarTareas(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(tareas.find((t) => t.actividad_id === a.actividad_id).impacto_dependientes, 2);
  assert.equal(tareas.find((t) => t.actividad_id === b.actividad_id).impacto_dependientes, 1);
  assert.equal(tareas.find((t) => t.actividad_id === c.actividad_id).impacto_dependientes, 0);
});

// ===== ruta critica (CPM) ===================================================

test('ruta critica: cadena unica es critica de punta a punta; paralelas -- solo la larga es critica', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const a = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'A', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(10) }, CTX_LEO);
  const b = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'B', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(20), depende_de: a.actividad_id }, CTX_LEO);
  const c = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'C', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(30), depende_de: b.actividad_id }, CTX_LEO);
  let tareas = Proyectos.listarTareas(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(tareas.find((t) => t.actividad_id === a.actividad_id).es_critica, true);
  assert.equal(tareas.find((t) => t.actividad_id === c.actividad_id).es_critica, true);

  const db2 = db_();
  const p2 = crearProyectoBase(db2);
  const x = Proyectos.crearTarea(db2, { proyecto_id: p2.proyecto_id, titulo: 'X', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(10) }, CTX_LEO);
  Proyectos.crearTarea(db2, { proyecto_id: p2.proyecto_id, titulo: 'corta', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(20), depende_de: x.actividad_id }, CTX_LEO);
  const larga = Proyectos.crearTarea(db2, { proyecto_id: p2.proyecto_id, titulo: 'larga', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(40), depende_de: x.actividad_id }, CTX_LEO);
  tareas = Proyectos.listarTareas(db2, { proyecto_id: p2.proyecto_id }, CTX_LEO);
  assert.equal(tareas.find((t) => t.actividad_id === larga.actividad_id).es_critica, true);
  const corta = tareas.find((t) => t.titulo === 'corta');
  assert.equal(corta.es_critica, false);
  assert.ok(corta.holgura_dias > 0.5);
});

test('ruta critica: sin dependencias nada es critico (holgura null); aislada nunca es critica', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const x = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'X', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(10) }, CTX_LEO);
  const tareas = Proyectos.listarTareas(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(tareas.find((t) => t.actividad_id === x.actividad_id).es_critica, false);
  assert.equal(tareas.find((t) => t.actividad_id === x.actividad_id).holgura_dias, null);
});

test('ruta critica AUDITORIA: una CANCELADA sale de la red; una TERMINADA nunca es critica', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const a = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'A', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(5) }, CTX_LEO);
  const b = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'B larga', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(60), depende_de: a.actividad_id }, CTX_LEO);
  Actividades.cancelar(db, { actividad_id: b.actividad_id, motivo: 'ya no' }, CTX_LEO);
  let tareas = Proyectos.listarTareas(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(tareas.find((t) => t.actividad_id === b.actividad_id).es_critica, false);
  assert.equal(tareas.find((t) => t.actividad_id === a.actividad_id).impacto_dependientes, 0);

  const db2 = db_();
  const p2 = crearProyectoBase(db2);
  const a2 = Proyectos.crearTarea(db2, { proyecto_id: p2.proyecto_id, titulo: 'A', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(5) }, CTX_LEO);
  const b2 = Proyectos.crearTarea(db2, { proyecto_id: p2.proyecto_id, titulo: 'B', responsable_email: 'leo@rld.cl', fecha_compromiso: diasDesdeHoy(20), depende_de: a2.actividad_id }, CTX_LEO);
  Actividades.checkin(db2, { actividad_id: b2.actividad_id, tipo: 'listo' }, CTX_LEO);
  tareas = Proyectos.listarTareas(db2, { proyecto_id: p2.proyecto_id }, CTX_LEO);
  assert.equal(tareas.find((t) => t.actividad_id === b2.actividad_id).es_critica, false);
  assert.equal(tareas.find((t) => t.actividad_id === a2.actividad_id).impacto_dependientes, 0);
});

// ===== hitos =================================================================

test('gestionarHito: crea; no se puede eliminar un hito con tareas', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const hito = Proyectos.gestionarHito(db, { proyecto_id: proyecto.proyecto_id, nombre: 'Levantamiento' }, CTX_LEO);
  assert.equal(hito.estado, 'PENDIENTE');
  Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, hito_id: hito.hito_id, titulo: 'Entrevistar', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-08-15' }, CTX_LEO);
  assert.equal(Proyectos.gestionarHito(db, { proyecto_id: proyecto.proyecto_id, accion: 'eliminar', hito_id: hito.hito_id }, CTX_LEO)._validationError, true);
  const detalle = Proyectos.getDetalle(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(detalle.hitos[0].total_tareas, 1);
});

// ===== la sala ===============================================================

test('publicarEnSala: comentario visible; SOLICITUD_LIDER solo la publica el lider; notifica al equipo', () => {
  const db = db_();
  const proyecto = armarProyectoConMarcelo(db);
  const comentario = Proyectos.publicarEnSala(db, { proyecto_id: proyecto.proyecto_id, tipo: 'COMENTARIO', cuerpo: 'Finalicé la v1.' }, CTX_MARCELO);
  assert.equal(comentario.tipo, 'COMENTARIO');
  assert.equal(Proyectos.publicarEnSala(db, { proyecto_id: proyecto.proyecto_id, tipo: 'SOLICITUD_LIDER', cuerpo: 'Acelera.' }, CTX_MARCELO)._forbidden, true);
  Proyectos.publicarEnSala(db, { proyecto_id: proyecto.proyecto_id, tipo: 'SOLICITUD_LIDER', cuerpo: 'Valida mañana.' }, CTX_LEO);
  const sala = Proyectos.listarSala(db, { proyecto_id: proyecto.proyecto_id }, CTX_MARCELO);
  assert.equal(sala.length, 4); // crear + gestionarIntegrante + comentario + solicitud
  const notifs = filas(db, 'NOTIFICACIONES_APP').filter((n) => n.destinatario_email === 'marcelo@rld.cl');
  assert.ok(notifs.length >= 1);
});

test('convertirEventoEnTarea: convierte un comentario en tarea real y deja la traza en el evento', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const evento = Proyectos.publicarEnSala(db, { proyecto_id: proyecto.proyecto_id, tipo: 'COMENTARIO', cuerpo: 'Corregir el documento.' }, CTX_LEO);
  const tarea = Proyectos.convertirEventoEnTarea(db, { proyecto_id: proyecto.proyecto_id, evento_id: evento.evento_id, titulo: 'Revisar documento', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-08-15' }, CTX_LEO);
  assert.ok(tarea.actividad_id);
  const eventoActualizado = filas(db, 'PROYECTO_EVENTOS').find((e) => e.evento_id === evento.evento_id);
  assert.equal(eventoActualizado.ref_tipo, 'ACTIVIDAD');
  assert.equal(eventoActualizado.ref_id, tarea.actividad_id);
});

test('marcarSalaVisitada: actualiza ultima_visita_sala del integrante; no falla sin fila propia', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const r = Proyectos.marcarSalaVisitada(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(r.actualizado, true);
  assert.equal(Proyectos.marcarSalaVisitada(db, { proyecto_id: proyecto.proyecto_id }, CTX_ADM).actualizado, false);
});

// ===== salud =================================================================

test('salud: normal sin problemas; critico con P1 atrasada; override exige motivo', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Al día', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-12-01' }, CTX_LEO);
  assert.equal(Proyectos.getDetalle(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO).salud, 'normal');

  const db2 = db_();
  const p2 = crearProyectoBase(db2);
  Proyectos.crearTarea(db2, { proyecto_id: p2.proyecto_id, titulo: 'Urgente atrasada', responsable_email: 'leo@rld.cl', prioridad: 'P1', fecha_compromiso: '2020-01-01' }, CTX_LEO);
  const detalle2 = Proyectos.getDetalle(db2, { proyecto_id: p2.proyecto_id }, CTX_LEO);
  assert.equal(detalle2.salud, 'critico');
  assert.ok(detalle2.salud_motivos.some((m) => m.indexOf('crítica') !== -1));

  assert.equal(Proyectos.actualizar(db, { proyecto_id: proyecto.proyecto_id, salud_override: 'critico' }, CTX_LEO)._validationError, true);
  Proyectos.actualizar(db, { proyecto_id: proyecto.proyecto_id, salud_override: 'critico', motivo_salud: 'Cliente canceló.' }, CTX_LEO);
  const detalle = Proyectos.getDetalle(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(detalle.salud, 'critico');
  assert.deepEqual(detalle.salud_motivos, ['Cliente canceló.']);
});

test('salud: un entregable vencido u observado agrega motivo de riesgo', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  Proyectos.gestionarEntregable(db, { proyecto_id: proyecto.proyecto_id, nombre: 'Informe vencido', responsable_email: 'leo@rld.cl', fecha_comprometida: '2020-01-01' }, CTX_LEO);
  const detalle = Proyectos.getDetalle(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(detalle.salud, 'riesgo');
  assert.ok(detalle.salud_motivos.some((m) => m.indexOf('entregable') !== -1));
});

// ===== entregables ===========================================================

test('gestionarEntregable: crear exige nombre/responsable/fecha; marcarEntregado solo el responsable/lider/ADM', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'otro@rld.cl', rol_proyecto: 'COLABORADOR' }, CTX_LEO);
  assert.equal(Proyectos.gestionarEntregable(db, { proyecto_id: proyecto.proyecto_id, responsable_email: 'marcelo@rld.cl', fecha_comprometida: '2026-09-01' }, CTX_LEO)._validationError, true);
  const entregable = Proyectos.gestionarEntregable(db, { proyecto_id: proyecto.proyecto_id, nombre: 'Manual', responsable_email: 'marcelo@rld.cl', fecha_comprometida: '2026-09-01' }, CTX_LEO);
  assert.equal(entregable.estado, 'PENDIENTE');
  assert.equal(Proyectos.gestionarEntregable(db, { proyecto_id: proyecto.proyecto_id, accion: 'marcarEntregado', entregable_id: entregable.entregable_id }, CTX_OTRO)._forbidden, true);
  const marcado = Proyectos.gestionarEntregable(db, { proyecto_id: proyecto.proyecto_id, accion: 'marcarEntregado', entregable_id: entregable.entregable_id, url_evidencia: 'https://drive/doc' }, CTX_MARCELO);
  assert.equal(marcado.estado, 'ENTREGADO');
});

test('revisarEntregable: exclusivo del lider/ADM; observar exige motivo; se puede reintentar tras observado', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  const entregable = Proyectos.gestionarEntregable(db, { proyecto_id: proyecto.proyecto_id, nombre: 'Manual', responsable_email: 'marcelo@rld.cl', fecha_comprometida: '2026-09-01' }, CTX_LEO);
  assert.equal(Proyectos.revisarEntregable(db, { proyecto_id: proyecto.proyecto_id, entregable_id: entregable.entregable_id }, CTX_LEO)._validationError, true);
  Proyectos.gestionarEntregable(db, { proyecto_id: proyecto.proyecto_id, accion: 'marcarEntregado', entregable_id: entregable.entregable_id }, CTX_MARCELO);
  assert.equal(Proyectos.revisarEntregable(db, { proyecto_id: proyecto.proyecto_id, entregable_id: entregable.entregable_id, resultado: 'APROBADO' }, CTX_MARCELO)._forbidden, true);
  assert.equal(Proyectos.revisarEntregable(db, { proyecto_id: proyecto.proyecto_id, entregable_id: entregable.entregable_id, resultado: 'OBSERVADO' }, CTX_LEO)._validationError, true);
  const observado = Proyectos.revisarEntregable(db, { proyecto_id: proyecto.proyecto_id, entregable_id: entregable.entregable_id, resultado: 'OBSERVADO', observaciones: 'Falta cap 3.' }, CTX_LEO);
  assert.equal(observado.estado, 'OBSERVADO');
  Proyectos.gestionarEntregable(db, { proyecto_id: proyecto.proyecto_id, accion: 'marcarEntregado', entregable_id: entregable.entregable_id }, CTX_MARCELO);
  const aprobado = Proyectos.revisarEntregable(db, { proyecto_id: proyecto.proyecto_id, entregable_id: entregable.entregable_id, resultado: 'APROBADO' }, CTX_LEO);
  assert.equal(aprobado.estado, 'APROBADO');
});

// ===== riesgos ================================================================

test('gestionarRiesgo: nivel se deriva de prob x impacto; editar recalcula; eliminar cierra; materializar', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  assert.equal(Proyectos.gestionarRiesgo(db, { proyecto_id: proyecto.proyecto_id, probabilidad: 'ALTA', impacto: 'ALTA' }, CTX_LEO)._validationError, true);
  const riesgo = Proyectos.gestionarRiesgo(db, { proyecto_id: proyecto.proyecto_id, descripcion: 'El proveedor puede atrasarse', probabilidad: 'ALTA', impacto: 'ALTA' }, CTX_LEO);
  assert.equal(riesgo.nivel, 'ALTA');
  const editado = Proyectos.gestionarRiesgo(db, { proyecto_id: proyecto.proyecto_id, riesgo_id: riesgo.riesgo_id, probabilidad: 'BAJA', impacto: 'BAJA' }, CTX_LEO);
  assert.equal(editado.nivel, 'BAJA');
  const eliminado = Proyectos.gestionarRiesgo(db, { proyecto_id: proyecto.proyecto_id, accion: 'eliminar', riesgo_id: riesgo.riesgo_id }, CTX_LEO);
  assert.equal(eliminado.estado, 'CERRADO');

  const otro = Proyectos.gestionarRiesgo(db, { proyecto_id: proyecto.proyecto_id, descripcion: 'Riesgo real', probabilidad: 'ALTA', impacto: 'ALTA' }, CTX_LEO);
  const materializado = Proyectos.gestionarRiesgo(db, { proyecto_id: proyecto.proyecto_id, accion: 'materializar', riesgo_id: otro.riesgo_id }, CTX_LEO);
  assert.equal(materializado.estado, 'MATERIALIZADO');
  assert.equal(Proyectos.gestionarRiesgo(db, { proyecto_id: proyecto.proyecto_id, accion: 'materializar', riesgo_id: otro.riesgo_id }, CTX_LEO)._validationError, true);
});

// ===== plantillas =============================================================

test('guardarComoPlantilla: exclusivo lider/ADM; copia hitos sin fechas; crear con plantilla_id las clona', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  Proyectos.gestionarHito(db, { proyecto_id: proyecto.proyecto_id, nombre: 'Levantamiento', descripcion: 'Entrevistas', fecha_objetivo: '2026-09-01' }, CTX_LEO);
  Proyectos.gestionarHito(db, { proyecto_id: proyecto.proyecto_id, nombre: 'Cierre', fecha_objetivo: '2026-10-01' }, CTX_LEO);
  assert.equal(Proyectos.guardarComoPlantilla(db, { proyecto_id: proyecto.proyecto_id, nombre: 'Tipo' }, CTX_MARCELO)._forbidden, true);
  const plantilla = Proyectos.guardarComoPlantilla(db, { proyecto_id: proyecto.proyecto_id, nombre: 'Certificación tipo' }, CTX_LEO);
  assert.equal(plantilla.total_hitos, 2);
  assert.equal(Proyectos.listarPlantillas(db).length, 1);

  const nuevo = crearProyectoBase(db, { nombre: 'ISO 2026', plantilla_id: plantilla.plantilla_id });
  const detalle = Proyectos.getDetalle(db, { proyecto_id: nuevo.proyecto_id }, CTX_LEO);
  assert.equal(detalle.hitos.length, 2);
  detalle.hitos.forEach((h) => { assert.equal(h.fecha_objetivo, ''); assert.equal(h.estado, 'PENDIENTE'); });

  const otro = crearProyectoBase(db, { nombre: 'Sin plantilla real', plantilla_id: 'no-existe' });
  assert.equal(otro._validationError, undefined);
});

// ===== mis tareas / calendario / mi bitacora ================================

test('listarMisTareas: junta tareas de VARIOS proyectos ordenadas por urgencia; colaborador soy_responsable=false', () => {
  const db = db_();
  const p1 = crearProyectoBase(db, { nombre: 'P1' });
  const p2 = crearProyectoBase(db, { nombre: 'P2' });
  Proyectos.gestionarIntegrante(db, { proyecto_id: p1.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  Proyectos.gestionarIntegrante(db, { proyecto_id: p2.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  const t1 = Proyectos.crearTarea(db, { proyecto_id: p1.proyecto_id, titulo: 'Al día', responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-12-01' }, CTX_LEO);
  const t2 = Proyectos.crearTarea(db, { proyecto_id: p2.proyecto_id, titulo: 'Atrasada', responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2020-01-01' }, CTX_LEO);
  Proyectos.crearTarea(db, { proyecto_id: p1.proyecto_id, titulo: 'De Leo', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-08-20' }, CTX_LEO);
  Actividades.confirmar(db, { actividad_id: t1.actividad_id }, CTX_MARCELO);
  Actividades.confirmar(db, { actividad_id: t2.actividad_id }, CTX_MARCELO);

  const mias = Proyectos.listarMisTareas(db, {}, CTX_MARCELO);
  assert.equal(mias.tareas.length, 2);
  assert.equal(mias.tareas[0].titulo, 'Atrasada');

  const colab = Proyectos.crearTarea(db, { proyecto_id: p1.proyecto_id, titulo: 'Colaborada', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01', colaboradores_emails: ['marcelo@rld.cl'] }, CTX_LEO);
  const miasColab = Proyectos.listarMisTareas(db, {}, CTX_MARCELO).tareas.find((t) => t.actividad_id === colab.actividad_id);
  assert.equal(miasColab.soy_responsable, false);
});

test('listarMisTareas: entregables pendientes propios, sin los ya APROBADOS', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const pendiente = Proyectos.gestionarEntregable(db, { proyecto_id: proyecto.proyecto_id, nombre: 'Manual', responsable_email: 'leo@rld.cl', fecha_comprometida: '2026-09-01' }, CTX_LEO);
  const aprobado = Proyectos.gestionarEntregable(db, { proyecto_id: proyecto.proyecto_id, nombre: 'Diagrama', responsable_email: 'leo@rld.cl', fecha_comprometida: '2026-09-01' }, CTX_LEO);
  Proyectos.gestionarEntregable(db, { proyecto_id: proyecto.proyecto_id, accion: 'marcarEntregado', entregable_id: aprobado.entregable_id }, CTX_LEO);
  Proyectos.revisarEntregable(db, { proyecto_id: proyecto.proyecto_id, entregable_id: aprobado.entregable_id }, CTX_LEO);
  const mias = Proyectos.listarMisTareas(db, {}, CTX_LEO);
  assert.equal(mias.entregables.length, 1);
  assert.equal(mias.entregables[0].nombre, 'Manual');
});

test('listarCalendario: junta hitos/tareas/entregables ordenados por fecha; ADM/GERENCIA ven todo', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  Proyectos.gestionarHito(db, { proyecto_id: proyecto.proyecto_id, nombre: 'Cierre levantamiento', fecha_objetivo: '2026-09-10' }, CTX_LEO);
  const tarea = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'De Marcelo', responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-09-05' }, CTX_LEO);
  Actividades.confirmar(db, { actividad_id: tarea.actividad_id }, CTX_MARCELO);
  Proyectos.gestionarEntregable(db, { proyecto_id: proyecto.proyecto_id, nombre: 'Acta', responsable_email: 'leo@rld.cl', fecha_comprometida: '2026-09-20' }, CTX_LEO);

  const cal = Proyectos.listarCalendario(db, {}, CTX_MARCELO);
  assert.equal(cal.items.length, 3);
  assert.deepEqual(cal.items.map((i) => i.tipo), ['tarea', 'hito', 'entregable']);
  assert.equal(Proyectos.listarCalendario(db, {}, CTX_OTRO).items.length, 0);

  const p2 = crearProyectoBase(db, { nombre: 'P2', lider_email: 'marcelo@rld.cl' });
  Proyectos.gestionarHito(db, { proyecto_id: p2.proyecto_id, nombre: 'Hito 2', fecha_objetivo: '2026-09-02' }, CTX_MARCELO);
  assert.equal(Proyectos.listarCalendario(db, {}, CTX_ADM).proyectos.length, 2);
  assert.equal(Proyectos.listarCalendario(db, {}, CTX_GERENCIA).items.length, 4);
});

test('listarBitacora/listarMiBitacora: solo de tareas del proyecto/mias, acotado a integrante', () => {
  const db = db_();
  const proyecto = armarProyectoConMarcelo(db);
  const tarea = Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'T', responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-08-20' }, CTX_LEO);
  Actividades.checkin(db, { actividad_id: tarea.actividad_id, tipo: 'avance' }, CTX_MARCELO);
  assert.equal(Proyectos.listarBitacora(db, { proyecto_id: proyecto.proyecto_id }, CTX_MARCELO).length >= 1, true);
  assert.equal(Proyectos.listarBitacora(db, { proyecto_id: proyecto.proyecto_id }, CTX_OTRO)._forbidden, true);
  assert.equal(Proyectos.listarMiBitacora(db, {}, CTX_MARCELO).length >= 1, true);
  assert.equal(Proyectos.listarMiBitacora(db, {}, CTX_OTRO).length, 0);
});

// ===== reuniones + acuerdos (Fase 5) =========================================

test('gestionarReunion: exige titulo; nace con acuerdos iniciales y postea evento en la sala; OBSERVADOR no puede', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'otro@rld.cl', rol_proyecto: 'OBSERVADOR' }, CTX_LEO);
  assert.equal(Proyectos.gestionarReunion(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO)._validationError, true);
  assert.equal(Proyectos.gestionarReunion(db, { proyecto_id: proyecto.proyecto_id, titulo: 'X' }, CTX_OTRO)._forbidden, true);
  const reunion = Proyectos.gestionarReunion(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Kickoff', objetivo: 'Alinear', participantes: ['leo@rld.cl', 'Cliente ACME'], acuerdos: ['Def estados', 'Enviar propuesta'] }, CTX_LEO);
  const listado = Proyectos.listarReuniones(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(listado[0].acuerdos.length, 2);
  const eventoReunion = Proyectos.listarSala(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO).find((e) => e.tipo === 'REUNION');
  assert.equal(eventoReunion.ref_id, reunion.reunion_id);
});

test('agregarAcuerdoReunion + convertirAcuerdoEnTarea: crea tarea, deja traza; no se convierte dos veces', () => {
  const db = db_();
  const proyecto = armarProyectoConMarcelo(db);
  const reunion = Proyectos.gestionarReunion(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Seguimiento' }, CTX_LEO);
  const acuerdo = Proyectos.agregarAcuerdoReunion(db, { proyecto_id: proyecto.proyecto_id, reunion_id: reunion.reunion_id, texto: 'Actualizar manual' }, CTX_LEO);
  const tarea = Proyectos.convertirAcuerdoEnTarea(db, { proyecto_id: proyecto.proyecto_id, acuerdo_id: acuerdo.acuerdo_id, responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);
  assert.equal(tarea.titulo, 'Actualizar manual');
  assert.match(tarea.descripcion, /Seguimiento/);
  const listado = Proyectos.listarReuniones(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(listado[0].acuerdos[0].ref_id, tarea.actividad_id);
  assert.equal(Proyectos.convertirAcuerdoEnTarea(db, { proyecto_id: proyecto.proyecto_id, acuerdo_id: acuerdo.acuerdo_id, responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO)._validationError, true);
});

test('eliminarAcuerdoReunion: solo si NO se convirtio en tarea', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const reunion = Proyectos.gestionarReunion(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Seguimiento' }, CTX_LEO);
  const libre = Proyectos.agregarAcuerdoReunion(db, { proyecto_id: proyecto.proyecto_id, reunion_id: reunion.reunion_id, texto: 'Uno' }, CTX_LEO);
  const convertido = Proyectos.agregarAcuerdoReunion(db, { proyecto_id: proyecto.proyecto_id, reunion_id: reunion.reunion_id, texto: 'Dos' }, CTX_LEO);
  Proyectos.convertirAcuerdoEnTarea(db, { proyecto_id: proyecto.proyecto_id, acuerdo_id: convertido.acuerdo_id, responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);
  assert.equal(Proyectos.eliminarAcuerdoReunion(db, { proyecto_id: proyecto.proyecto_id, acuerdo_id: convertido.acuerdo_id }, CTX_LEO)._validationError, true);
  assert.equal(Proyectos.eliminarAcuerdoReunion(db, { proyecto_id: proyecto.proyecto_id, acuerdo_id: libre.acuerdo_id }, CTX_LEO).ok, true);
});

test('gestionarReunion (eliminar): rechaza si algun acuerdo ya es tarea; borra completo si no', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const conTarea = Proyectos.gestionarReunion(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Con tarea', acuerdos: ['A'] }, CTX_LEO);
  const [acuerdo] = Proyectos.listarReuniones(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO)[0].acuerdos;
  Proyectos.convertirAcuerdoEnTarea(db, { proyecto_id: proyecto.proyecto_id, acuerdo_id: acuerdo.acuerdo_id, responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01' }, CTX_LEO);
  assert.equal(Proyectos.gestionarReunion(db, { proyecto_id: proyecto.proyecto_id, accion: 'eliminar', reunion_id: conTarea.reunion_id }, CTX_LEO)._validationError, true);
  const libre = Proyectos.gestionarReunion(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Sin tarea', acuerdos: ['B'] }, CTX_LEO);
  assert.equal(Proyectos.gestionarReunion(db, { proyecto_id: proyecto.proyecto_id, accion: 'eliminar', reunion_id: libre.reunion_id }, CTX_LEO).ok, true);
  assert.equal(Proyectos.listarReuniones(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO).length, 1);
});

// ===== decisiones =============================================================

test('gestionarDecision: crear/editar/eliminar (soft-delete); postea evento en la sala; sin responsable cae en el lider', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  assert.equal(Proyectos.gestionarDecision(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO)._validationError, true);
  const decision = Proyectos.gestionarDecision(db, { proyecto_id: proyecto.proyecto_id, descripcion: 'Usar CRM nuevo', contexto: 'El actual no soporta', impacto: 'Retrasa 1 semana', responsable_email: 'leo@rld.cl' }, CTX_LEO);
  const editada = Proyectos.gestionarDecision(db, { proyecto_id: proyecto.proyecto_id, decision_id: decision.decision_id, impacto: 'Retrasa 2 semanas' }, CTX_LEO);
  assert.equal(editada.impacto, 'Retrasa 2 semanas');
  assert.equal(editada.descripcion, 'Usar CRM nuevo');
  assert.equal(Proyectos.listarSala(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO).filter((e) => e.tipo === 'DECISION').length, 1);
  const eliminada = Proyectos.gestionarDecision(db, { proyecto_id: proyecto.proyecto_id, accion: 'eliminar', decision_id: decision.decision_id }, CTX_LEO);
  assert.equal(eliminada.activo, false);
  assert.equal(Proyectos.listarDecisiones(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO).length, 0);

  const sinResp = Proyectos.gestionarDecision(db, { proyecto_id: proyecto.proyecto_id, descripcion: 'Sin responsable' }, CTX_LEO);
  assert.equal(sinResp.responsable_email, 'leo@rld.cl');
});

// ===== resumen de portafolio ==================================================

test('getResumenPortafolio: agrega por salud; carga por persona ponderada por tamano', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db, { nombre: 'Portafolio' });
  Proyectos.actualizar(db, { proyecto_id: proyecto.proyecto_id, estado: 'ACTIVO' }, CTX_LEO);
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'S', responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-12-01', tamano: 'S' }, CTX_LEO);
  Proyectos.crearTarea(db, { proyecto_id: proyecto.proyecto_id, titulo: 'XL', responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-12-01', tamano: 'XL' }, CTX_LEO);
  const resumen = Proyectos.getResumenPortafolio(db, CTX_LEO);
  assert.equal(resumen.total_proyectos, 1);
  assert.equal(resumen.por_salud.normal, 1);
  const cargaMarcelo = resumen.carga_por_persona.find((c) => c.email === 'marcelo@rld.cl');
  assert.equal(cargaMarcelo.total_tareas, 2);
  assert.equal(cargaMarcelo.carga_ponderada, 6);
});

// ===== acoplamiento con Actividades (RN-709, desgateado) ====================

test('acoplamiento: un integrante del proyecto puede crear una actividad para otro integrante del MISMO proyecto (via Actividades.crear directo)', () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  // Leo (LIDER del proyecto, no jefe formal de Marcelo en JEFATURAS) crea una
  // actividad para Marcelo directo con Actividades.crear, marcada con el
  // proyecto -- el circulo del proyecto debe conceder ahora que Proyectos
  // esta portado (antes, en actividades.js solo, esto se habria rechazado).
  const actividad = Actividades.crear(db, { titulo: 'Tarea directa', responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-09-01', proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.ok(actividad.actividad_id, 'el circulo de confianza del proyecto debe conceder');
  assert.equal(actividad._forbidden, undefined);
});
