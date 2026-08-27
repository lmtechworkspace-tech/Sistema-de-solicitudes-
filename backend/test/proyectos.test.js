'use strict';

// v9.0 (documentacion/SIGSO-v9.0-propuesta-modulo-gestion-proyectos.md):
// modulo de Gestion de Proyectos Internos. Decision central de la propuesta:
// las tareas de un proyecto SON ACTIVIDADES (extendida con proyecto_id/
// hito_id) -- estos tests verifican tanto el CRUD/permisos propio del
// modulo (Proyectos.*) como que crearTarea/listarTareas realmente delegan
// en el motor de Actividades.gs en vez de reimplementarlo.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'fake-drive-root' } });
  seedSheet(ctx, 'PROYECTOS', ctx.COLUMNAS.PROYECTOS);
  seedSheet(ctx, 'PROYECTO_INTEGRANTES', ctx.COLUMNAS.PROYECTO_INTEGRANTES);
  seedSheet(ctx, 'PROYECTO_HITOS', ctx.COLUMNAS.PROYECTO_HITOS);
  seedSheet(ctx, 'PROYECTO_EVENTOS', ctx.COLUMNAS.PROYECTO_EVENTOS);
  seedSheet(ctx, 'PROYECTO_ENTREGABLES', ctx.COLUMNAS.PROYECTO_ENTREGABLES);
  seedSheet(ctx, 'PROYECTO_RIESGOS', ctx.COLUMNAS.PROYECTO_RIESGOS);
  seedSheet(ctx, 'PROYECTO_PLANTILLAS', ctx.COLUMNAS.PROYECTO_PLANTILLAS);
  seedSheet(ctx, 'PROYECTO_PLANTILLA_HITOS', ctx.COLUMNAS.PROYECTO_PLANTILLA_HITOS);
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'ACTIVIDADES', ctx.COLUMNAS.ACTIVIDADES);
  seedSheet(ctx, 'ACTIVIDADES_BITACORA', ctx.COLUMNAS.ACTIVIDADES_BITACORA);
  seedSheet(ctx, 'JEFATURAS', ctx.COLUMNAS.JEFATURAS);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'CONFIG_FERIADOS', ctx.COLUMNAS.CONFIG_FERIADOS);
  seedSheet(ctx, 'NOTIFICACIONES_APP', ctx.COLUMNAS.NOTIFICACIONES_APP);
  seedSheet(ctx, 'CAT_AREAS', ctx.COLUMNAS.CAT_AREAS);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Leo Lider', 'leo@rld.cl', 'RLD', 'DEV', true, '', 'sistema'],
    ['U2', 'Marcelo Integrante', 'marcelo@rld.cl', 'RLD', 'DEV', true, '', 'sistema'],
    ['U3', 'Otro Ajeno', 'otro@rld.cl', 'RLD', 'DEV', true, '', 'sistema']
  ]);
  return ctx;
}

const CTX_LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV' };
const CTX_MARCELO = { email: 'marcelo@rld.cl', nombre: 'Marcelo Integrante', rol: 'DEV' };
const CTX_OTRO = { email: 'otro@rld.cl', nombre: 'Otro Ajeno', rol: 'DEV' };
const CTX_ADM = { email: 'admin@rld.cl', nombre: 'Admin', rol: 'ADM' };
const CTX_GERENCIA = { email: 'gerencia@rld.cl', nombre: 'Gerencia', rol: 'GERENCIA' };

function crearProyectoBase(ctx, overrides) {
  return ctx.Proyectos.crear(Object.assign({
    nombre: 'Migración ERP', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-10-01'
  }, overrides), CTX_LEO);
}

test('crear: exige nombre, fecha_inicio y fecha_objetivo; el creador queda como LIDER', () => {
  const ctx = loadConSchema();
  const sinNombre = ctx.Proyectos.crear({ fecha_inicio: '2026-08-01', fecha_objetivo: '2026-10-01' }, CTX_LEO);
  assert.equal(sinNombre._validationError, true);

  const proyecto = crearProyectoBase(ctx);
  assert.equal(proyecto.lider_email, 'leo@rld.cl');
  assert.equal(proyecto.estado, 'PLANIFICACION');
  assert.equal(proyecto.activa, true);

  const integrantes = ctx.leerFilas_('PROYECTO_INTEGRANTES').filter((i) => i.proyecto_id === proyecto.proyecto_id);
  assert.equal(integrantes.length, 1);
  assert.equal(integrantes[0].rol_proyecto, 'LIDER');
  assert.equal(integrantes[0].usuario_email, 'leo@rld.cl');
});

test('crear: si ADM lo crea para otro lider, ADM tambien queda como integrante', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({
    nombre: 'Portal clientes', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-09-01', lider_email: 'leo@rld.cl'
  }, CTX_ADM);
  const integrantes = ctx.leerFilas_('PROYECTO_INTEGRANTES').filter((i) => i.proyecto_id === proyecto.proyecto_id);
  assert.equal(integrantes.length, 2);
  const roles = integrantes.map((i) => i.usuario_email + ':' + i.rol_proyecto).sort();
  assert.deepEqual(roles, ['admin@rld.cl:INTEGRANTE', 'leo@rld.cl:LIDER']);
});

test('listar (portafolio): un integrante solo ve sus proyectos; ADM/GERENCIA ven todos', () => {
  const ctx = loadConSchema();
  const propio = crearProyectoBase(ctx, { nombre: 'Proyecto de Leo' });
  crearProyectoBase(ctx, { nombre: 'Proyecto ajeno', lider_email: 'otro@rld.cl' });

  const comoOtro = ctx.Proyectos.listar({}, CTX_OTRO);
  assert.equal(comoOtro.length, 1);
  assert.equal(comoOtro[0].nombre, 'Proyecto ajeno');

  // Leo ve AMBOS: el suyo (LIDER) y "Proyecto ajeno" (quedó como INTEGRANTE
  // por haberlo creado el, aunque el lider sea otro -- ver Proyectos.crear).
  const comoLeo = ctx.Proyectos.listar({}, CTX_LEO);
  assert.equal(comoLeo.length, 2);
  assert.ok(comoLeo.some((p) => p.proyecto_id === propio.proyecto_id));

  assert.equal(ctx.Proyectos.listar({}, CTX_ADM).length, 2);
  assert.equal(ctx.Proyectos.listar({}, CTX_GERENCIA).length, 2);
});

// v10 (Fase A, "tarjetas con mas pulso"): el portafolio trae quien esta en
// el equipo, para pintar avatares sin pedir el detalle de cada proyecto.
test('listar (portafolio): expone integrantes {email, nombre}, con el LIDER primero', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx, { lider_nombre: 'Leo Lider' });
  ctx.Proyectos.gestionarIntegrante({
    proyecto_id: proyecto.proyecto_id, accion: 'agregar',
    usuario_email: 'marcelo@rld.cl', usuario_nombre: 'Marcelo Integrante', rol_proyecto: 'INTEGRANTE'
  }, CTX_LEO);

  const listado = ctx.Proyectos.listar({}, CTX_LEO).find((p) => p.proyecto_id === proyecto.proyecto_id);
  assert.equal(listado.integrantes.length, 2);
  assert.equal(listado.integrantes[0].email, 'leo@rld.cl');
  assert.equal(listado.integrantes[0].nombre, 'Leo Lider');
  assert.equal(listado.integrantes[1].email, 'marcelo@rld.cl');
});

test('gestionarIntegrante: el LIDER agrega integrantes; un INTEGRANTE no puede', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);

  const agregado = ctx.Proyectos.gestionarIntegrante({
    proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl',
    usuario_nombre: 'Marcelo Integrante', rol_proyecto: 'INTEGRANTE'
  }, CTX_LEO);
  assert.equal(agregado.rol_proyecto, 'INTEGRANTE');

  const rechazado = ctx.Proyectos.gestionarIntegrante({
    proyecto_id: proyecto.proyecto_id, usuario_email: 'otro@rld.cl', rol_proyecto: 'OBSERVADOR'
  }, CTX_MARCELO);
  assert.equal(rechazado._forbidden, true);
});

test('gestionarIntegrante: no se puede quitar al unico LIDER del proyecto', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  const lider = ctx.leerFilas_('PROYECTO_INTEGRANTES').filter((i) => i.proyecto_id === proyecto.proyecto_id)[0];
  const resultado = ctx.Proyectos.gestionarIntegrante({
    proyecto_id: proyecto.proyecto_id, accion: 'quitar', integrante_id: lider.integrante_id
  }, CTX_LEO);
  assert.equal(resultado._validationError, true);
});

test('getDetalle: un OBSERVADOR ve el proyecto (rol_actual=OBSERVADOR) pero un ajeno no puede', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  ctx.Proyectos.gestionarIntegrante({
    proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'OBSERVADOR'
  }, CTX_LEO);

  const detalleObservador = ctx.Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, CTX_MARCELO);
  assert.equal(detalleObservador.rol_actual, 'OBSERVADOR');
  assert.equal(detalleObservador.salud, 'normal');

  const rechazado = ctx.Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, CTX_OTRO);
  assert.equal(rechazado._forbidden, true);
});

test('getDetalle: puede_gestionar es true para LIDER y ADM, false para INTEGRANTE/OBSERVADOR/GERENCIA', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  ctx.Proyectos.gestionarIntegrante({
    proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE'
  }, CTX_LEO);

  // LIDER del proyecto.
  assert.equal(ctx.Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, CTX_LEO).puede_gestionar, true);
  // ADM: gestiona cualquier proyecto aunque NO sea integrante.
  assert.equal(ctx.Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, CTX_ADM).puede_gestionar, true);
  // INTEGRANTE (no lider): no gestiona.
  assert.equal(ctx.Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, CTX_MARCELO).puede_gestionar, false);
  // GERENCIA: ve todo pero es solo lectura.
  assert.equal(ctx.Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, CTX_GERENCIA).puede_gestionar, false);
});

test('actualizar: cerrar un proyecto exige motivo y fija fecha_cierre_real', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  const sinMotivo = ctx.Proyectos.actualizar({ proyecto_id: proyecto.proyecto_id, estado: 'CERRADO' }, CTX_LEO);
  assert.equal(sinMotivo._validationError, true);

  const cerrado = ctx.Proyectos.actualizar({
    proyecto_id: proyecto.proyecto_id, estado: 'CERRADO', motivo: 'Entregado y aprobado por el cliente.'
  }, CTX_LEO);
  assert.equal(cerrado.estado, 'CERRADO');
  assert.ok(cerrado.fecha_cierre_real);
});

// --- la decision central: las tareas SON ACTIVIDADES ------------------

test('crearTarea: delega en Actividades.crear (la tarea aparece en la hoja ACTIVIDADES, con proyecto_id)', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  // El responsable de una tarea debe ser integrante del proyecto (mismo
  // criterio que RN-709 en Actividades.gs, aplicado al circulo del
  // proyecto): asignar a alguien fuera del equipo se rechaza a proposito.
  ctx.Proyectos.gestionarIntegrante({
    proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE'
  }, CTX_LEO);
  const tarea = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Levantar requerimientos',
    responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-08-20'
  }, CTX_LEO);
  assert.ok(tarea.actividad_id, 'debe devolver una actividad real');
  assert.equal(tarea.proyecto_id, proyecto.proyecto_id);
  assert.equal(tarea.proyecto, proyecto.nombre);
  // El lider del proyecto queda como supervisor por defecto -- asi
  // puedeGestionar_ (Actividades.gs) le da control SIN estar en JEFATURAS.
  assert.equal(tarea.supervisor_email, 'leo@rld.cl');

  const enHojaActividades = ctx.leerFilas_('ACTIVIDADES').filter((a) => a.actividad_id === tarea.actividad_id);
  assert.equal(enHojaActividades.length, 1);
  assert.equal(enHojaActividades[0].proyecto_id, proyecto.proyecto_id);

  // Y el motor de Actividades sigue intacto: el check-in funciona igual.
  const avanzada = ctx.Actividades.checkin({ actividad_id: tarea.actividad_id, tipo: 'avance', avance_pct: 40 }, CTX_MARCELO);
  assert.equal(avanzada.estado, 'EN_CURSO');
  assert.equal(avanzada.avance_pct, 40);
});

test('crearTarea: un OBSERVADOR no puede crear tareas', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  ctx.Proyectos.gestionarIntegrante({
    proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'OBSERVADOR'
  }, CTX_LEO);
  const rechazado = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Algo', responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-08-20'
  }, CTX_MARCELO);
  assert.equal(rechazado._forbidden, true);
});

test('listarTareas: lee ACTIVIDADES filtrando por proyecto_id, acotado a integrantes (bypasa el alcance de JEFATURAS)', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  ctx.Proyectos.gestionarIntegrante({
    proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE'
  }, CTX_LEO);
  ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Tarea 1', responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-08-20'
  }, CTX_LEO);
  // Actividad suelta, sin proyecto -- no debe aparecer en la lista del proyecto.
  ctx.Actividades.crear({ titulo: 'Suelta', fecha_compromiso: '2026-08-20' }, CTX_MARCELO);

  const tareas = ctx.Proyectos.listarTareas({ proyecto_id: proyecto.proyecto_id }, CTX_MARCELO);
  assert.equal(tareas.length, 1);
  assert.equal(tareas[0].titulo, 'Tarea 1');
  assert.ok(tareas[0].semaforo, 'debe traer el semaforo calculado (reuso de Actividades.gs)');

  // Otro (ajeno, NO integrante, NO en JEFATURAS de nadie) no puede leer.
  const rechazado = ctx.Proyectos.listarTareas({ proyecto_id: proyecto.proyecto_id }, CTX_OTRO);
  assert.equal(rechazado._forbidden, true);
});

// v10 (Fase B, "Mi trabajo en proyectos"): tareas + entregables propios de
// TODOS mis proyectos en una sola llamada, sin tener que abrir cada uno.
test('listarMisTareas: junta tareas propias de VARIOS proyectos, ordenadas por urgencia; no trae las de otra persona', () => {
  const ctx = loadConSchema();
  const p1 = crearProyectoBase(ctx, { nombre: 'Proyecto 1' });
  const p2 = crearProyectoBase(ctx, { nombre: 'Proyecto 2' });
  ctx.Proyectos.gestionarIntegrante({ proyecto_id: p1.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  ctx.Proyectos.gestionarIntegrante({ proyecto_id: p2.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);

  const t1 = ctx.Proyectos.crearTarea({
    proyecto_id: p1.proyecto_id, titulo: 'Tarea al día', responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-12-01'
  }, CTX_LEO);
  const t2 = ctx.Proyectos.crearTarea({
    proyecto_id: p2.proyecto_id, titulo: 'Tarea atrasada', responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2020-01-01'
  }, CTX_LEO);
  // De Leo -- no debe aparecer en la lista de Marcelo.
  ctx.Proyectos.crearTarea({
    proyecto_id: p1.proyecto_id, titulo: 'Tarea de Leo', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-08-20'
  }, CTX_LEO);
  // RN-710: como las asigna un tercero (Leo), la fecha queda "propuesta" hasta
  // que Marcelo confirma -- recien ahi cuenta como fecha_compromiso real.
  ctx.Actividades.confirmar({ actividad_id: t1.actividad_id }, CTX_MARCELO);
  ctx.Actividades.confirmar({ actividad_id: t2.actividad_id }, CTX_MARCELO);

  const mias = ctx.Proyectos.listarMisTareas({}, CTX_MARCELO);
  assert.equal(mias.tareas.length, 2);
  // La atrasada (semaforo mas urgente) va primero, sin importar el orden de creacion.
  assert.equal(mias.tareas[0].titulo, 'Tarea atrasada');
  assert.equal(mias.tareas[0].proyecto_nombre, 'Proyecto 2');
  assert.equal(mias.tareas[1].titulo, 'Tarea al día');
});

test('listarMisTareas: entregables pendientes propios, pero no los ya APROBADOS', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  const pendiente = ctx.Proyectos.gestionarEntregable({
    proyecto_id: proyecto.proyecto_id, accion: 'crear', nombre: 'Manual de usuario',
    responsable_email: 'leo@rld.cl', fecha_comprometida: '2026-09-01'
  }, CTX_LEO);
  const aprobado = ctx.Proyectos.gestionarEntregable({
    proyecto_id: proyecto.proyecto_id, accion: 'crear', nombre: 'Diagrama de arquitectura',
    responsable_email: 'leo@rld.cl', fecha_comprometida: '2026-09-01'
  }, CTX_LEO);
  ctx.Proyectos.gestionarEntregable({ proyecto_id: proyecto.proyecto_id, accion: 'marcarEntregado', entregable_id: aprobado.entregable_id }, CTX_LEO);
  ctx.Proyectos.revisarEntregable({ proyecto_id: proyecto.proyecto_id, entregable_id: aprobado.entregable_id }, CTX_LEO);

  const mias = ctx.Proyectos.listarMisTareas({}, CTX_LEO);
  assert.equal(mias.entregables.length, 1);
  assert.equal(mias.entregables[0].nombre, 'Manual de usuario');
});

// --- calendario (Fase C) --------------------------------------------------

test('listarCalendario: junta hitos, tareas y entregables de los proyectos visibles, ordenados por fecha; no trae los de un proyecto ajeno', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  ctx.Proyectos.gestionarIntegrante({ proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  ctx.Proyectos.gestionarHito({ proyecto_id: proyecto.proyecto_id, nombre: 'Cierre de levantamiento', fecha_objetivo: '2026-09-10' }, CTX_LEO);
  const tarea = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Tarea de Marcelo', responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-09-05'
  }, CTX_LEO);
  // RN-710: la asigna un tercero (Leo) -- fecha "propuesta" hasta que
  // Marcelo confirma; sin confirmar no tiene fecha_compromiso que mostrar.
  ctx.Actividades.confirmar({ actividad_id: tarea.actividad_id }, CTX_MARCELO);
  ctx.Proyectos.gestionarEntregable({
    proyecto_id: proyecto.proyecto_id, accion: 'crear', nombre: 'Acta de cierre',
    responsable_email: 'leo@rld.cl', fecha_comprometida: '2026-09-20'
  }, CTX_LEO);
  // Un entregable ya aprobado no debe aparecer -- ya no aporta a "que viene".
  const paraAprobar = ctx.Proyectos.gestionarEntregable({
    proyecto_id: proyecto.proyecto_id, accion: 'crear', nombre: 'Diagrama viejo',
    responsable_email: 'leo@rld.cl', fecha_comprometida: '2026-08-15'
  }, CTX_LEO);
  ctx.Proyectos.gestionarEntregable({ proyecto_id: proyecto.proyecto_id, accion: 'marcarEntregado', entregable_id: paraAprobar.entregable_id }, CTX_LEO);
  ctx.Proyectos.revisarEntregable({ proyecto_id: proyecto.proyecto_id, entregable_id: paraAprobar.entregable_id }, CTX_LEO);

  const cal = ctx.Proyectos.listarCalendario({}, CTX_MARCELO);
  assert.equal(cal.items.length, 3);
  assert.deepEqual(toPlain(cal.items.map((i) => i.titulo)), ['Tarea de Marcelo', 'Cierre de levantamiento', 'Acta de cierre']);
  assert.deepEqual(toPlain(cal.items.map((i) => i.tipo)), ['tarea', 'hito', 'entregable']);
  assert.equal(cal.proyectos.length, 1);

  // Un ajeno (no integrante de ningun proyecto) no ve nada.
  const calOtro = ctx.Proyectos.listarCalendario({}, CTX_OTRO);
  assert.equal(calOtro.items.length, 0);
  assert.equal(calOtro.proyectos.length, 0);
});

test('listarCalendario: ADM y GERENCIA ven los items de TODOS los proyectos, aunque no sean integrantes', () => {
  const ctx = loadConSchema();
  const p1 = crearProyectoBase(ctx, { nombre: 'Proyecto 1' });
  const p2 = crearProyectoBase(ctx, { nombre: 'Proyecto 2', lider_email: 'marcelo@rld.cl', lider_nombre: 'Marcelo Integrante' });
  ctx.Proyectos.gestionarHito({ proyecto_id: p1.proyecto_id, nombre: 'Hito 1', fecha_objetivo: '2026-09-01' }, CTX_LEO);
  ctx.Proyectos.gestionarHito({ proyecto_id: p2.proyecto_id, nombre: 'Hito 2', fecha_objetivo: '2026-09-02' }, CTX_MARCELO);

  const calAdm = ctx.Proyectos.listarCalendario({}, CTX_ADM);
  assert.equal(calAdm.items.length, 2);
  assert.equal(calAdm.proyectos.length, 2);

  const calGerencia = ctx.Proyectos.listarCalendario({}, CTX_GERENCIA);
  assert.equal(calGerencia.items.length, 2);
});

// --- hitos ---------------------------------------------------------------

test('gestionarHito: crear y asociar tareas; no se puede eliminar un hito con tareas', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  const hito = ctx.Proyectos.gestionarHito({ proyecto_id: proyecto.proyecto_id, nombre: 'Levantamiento' }, CTX_LEO);
  assert.equal(hito.estado, 'PENDIENTE');

  ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, hito_id: hito.hito_id, titulo: 'Entrevistar usuarios',
    responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-08-15'
  }, CTX_LEO);

  const rechazado = ctx.Proyectos.gestionarHito({ proyecto_id: proyecto.proyecto_id, accion: 'eliminar', hito_id: hito.hito_id }, CTX_LEO);
  assert.equal(rechazado._validationError, true);

  const detalle = ctx.Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(detalle.hitos.length, 1);
  assert.equal(detalle.hitos[0].total_tareas, 1);
});

// --- la sala ---------------------------------------------------------------

test('publicarEnSala: comentario visible en la sala; SOLICITUD_LIDER solo la publica el lider', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  ctx.Proyectos.gestionarIntegrante({
    proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE'
  }, CTX_LEO);

  const comentario = ctx.Proyectos.publicarEnSala({
    proyecto_id: proyecto.proyecto_id, tipo: 'COMENTARIO', cuerpo: 'Finalicé la primera versión.'
  }, CTX_MARCELO);
  assert.equal(comentario.tipo, 'COMENTARIO');

  const rechazado = ctx.Proyectos.publicarEnSala({
    proyecto_id: proyecto.proyecto_id, tipo: 'SOLICITUD_LIDER', cuerpo: 'Acelera esto.'
  }, CTX_MARCELO);
  assert.equal(rechazado._forbidden, true);

  const solicitud = ctx.Proyectos.publicarEnSala({
    proyecto_id: proyecto.proyecto_id, tipo: 'SOLICITUD_LIDER', cuerpo: 'Por favor valida los datos mañana antes de las 12:00.'
  }, CTX_LEO);
  assert.equal(solicitud.tipo, 'SOLICITUD_LIDER');

  // La sala incluye TODO lo que pasa en el proyecto -- tambien "Proyecto
  // creado" y "se une al equipo" (crear/gestionarIntegrante ya publican en
  // la sala), no solo lo publicado manualmente aca.
  const sala = ctx.Proyectos.listarSala({ proyecto_id: proyecto.proyecto_id }, CTX_MARCELO);
  assert.equal(sala.length, 4);
  const tipos = sala.map((e) => e.tipo).sort();
  assert.deepEqual(tipos, ['ACTUALIZACION', 'ACTUALIZACION', 'COMENTARIO', 'SOLICITUD_LIDER']);

  // La solicitud del lider notifica al resto del equipo (espejo del correo).
  const notifs = ctx.leerFilas_('NOTIFICACIONES_APP').filter((n) => n.destinatario_email === 'marcelo@rld.cl');
  assert.ok(notifs.length >= 1);
});

test('convertirEventoEnTarea: "Necesitamos corregir el documento" se convierte en una tarea real', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  const evento = ctx.Proyectos.publicarEnSala({
    proyecto_id: proyecto.proyecto_id, tipo: 'COMENTARIO', cuerpo: 'Necesitamos corregir el documento.'
  }, CTX_LEO);

  const tarea = ctx.Proyectos.convertirEventoEnTarea({
    proyecto_id: proyecto.proyecto_id, evento_id: evento.evento_id,
    titulo: 'Revisar documento', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-08-15'
  }, CTX_LEO);
  assert.ok(tarea.actividad_id);

  const eventoActualizado = ctx.leerFilas_('PROYECTO_EVENTOS').filter((e) => e.evento_id === evento.evento_id)[0];
  assert.equal(eventoActualizado.ref_tipo, 'ACTIVIDAD');
  assert.equal(eventoActualizado.ref_id, tarea.actividad_id);
});

// --- salud del proyecto: explicable, con motivos (§J de la propuesta) ---

test('salud: normal cuando no hay tareas atrasadas/bloqueadas', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Tarea al día', responsable_email: 'leo@rld.cl',
    fecha_compromiso: '2026-12-01'
  }, CTX_LEO);
  const detalle = ctx.Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(detalle.salud, 'normal');
  assert.deepEqual(toPlain(detalle.salud_motivos), []);
});

test('salud: critico cuando una tarea P1 esta atrasada, con el motivo explicito', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Tarea urgente atrasada', responsable_email: 'leo@rld.cl',
    prioridad: 'P1', fecha_compromiso: '2020-01-01'
  }, CTX_LEO);
  const detalle = ctx.Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(detalle.salud, 'critico');
  assert.ok(detalle.salud_motivos.some((m) => m.indexOf('crítica') !== -1), 'el motivo debe mencionar la tarea critica');
});

test('salud: salud_override exige motivo y queda reflejado en la salida', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  const sinMotivo = ctx.Proyectos.actualizar({ proyecto_id: proyecto.proyecto_id, salud_override: 'critico' }, CTX_LEO);
  assert.equal(sinMotivo._validationError, true);

  ctx.Proyectos.actualizar({
    proyecto_id: proyecto.proyecto_id, salud_override: 'critico', motivo_salud: 'Cliente canceló el contrato temporalmente.'
  }, CTX_LEO);
  const detalle = ctx.Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(detalle.salud, 'critico');
  assert.deepEqual(toPlain(detalle.salud_motivos), ['Cliente canceló el contrato temporalmente.']);
});

// --- avance derivado -------------------------------------------------------

test('avance_pct del proyecto se deriva de las tareas terminadas (no es un campo manual)', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  const t1 = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Tarea 1', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-12-01'
  }, CTX_LEO);
  ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Tarea 2', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-12-01'
  }, CTX_LEO);

  ctx.Actividades.checkin({ actividad_id: t1.actividad_id, tipo: 'listo' }, CTX_LEO);

  const detalle = ctx.Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(detalle.avance_pct, 50);
});

// --- v9.4 (Fase 2/3): entregables (aprobar/observar) -----------------------

test('gestionarEntregable: crear exige nombre/responsable/fecha; marcarEntregado solo lo hace el responsable (o lider/ADM)', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  ctx.Proyectos.gestionarIntegrante({
    proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE'
  }, CTX_LEO);
  // Otro tambien es integrante (no lider, no responsable del entregable) --
  // aisla el rechazo especifico de "no eres el responsable" del gate general
  // de acceso al proyecto.
  ctx.Proyectos.gestionarIntegrante({
    proyecto_id: proyecto.proyecto_id, usuario_email: 'otro@rld.cl', rol_proyecto: 'COLABORADOR'
  }, CTX_LEO);

  const sinNombre = ctx.Proyectos.gestionarEntregable({
    proyecto_id: proyecto.proyecto_id, responsable_email: 'marcelo@rld.cl', fecha_comprometida: '2026-09-01'
  }, CTX_LEO);
  assert.equal(sinNombre._validationError, true);

  const entregable = ctx.Proyectos.gestionarEntregable({
    proyecto_id: proyecto.proyecto_id, nombre: 'Manual de usuario', responsable_email: 'marcelo@rld.cl', fecha_comprometida: '2026-09-01'
  }, CTX_LEO);
  assert.equal(entregable.estado, 'PENDIENTE');

  // Otro es integrante del proyecto pero NO es el responsable del
  // entregable ni el lider -> rechazado especificamente por eso.
  const rechazado = ctx.Proyectos.gestionarEntregable({
    proyecto_id: proyecto.proyecto_id, accion: 'marcarEntregado', entregable_id: entregable.entregable_id
  }, CTX_OTRO);
  assert.equal(rechazado._forbidden, true);

  const marcado = ctx.Proyectos.gestionarEntregable({
    proyecto_id: proyecto.proyecto_id, accion: 'marcarEntregado', entregable_id: entregable.entregable_id, url_evidencia: 'https://drive/doc'
  }, CTX_MARCELO);
  assert.equal(marcado.estado, 'ENTREGADO');
  assert.ok(marcado.fecha_entrega_real);
});

test('revisarEntregable: exclusivo del lider/ADM; observar exige motivo; aprobar no', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  ctx.Proyectos.gestionarIntegrante({
    proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE'
  }, CTX_LEO);
  const entregable = ctx.Proyectos.gestionarEntregable({
    proyecto_id: proyecto.proyecto_id, nombre: 'Manual de usuario', responsable_email: 'marcelo@rld.cl', fecha_comprometida: '2026-09-01'
  }, CTX_LEO);

  const antesDeEntregar = ctx.Proyectos.revisarEntregable({ proyecto_id: proyecto.proyecto_id, entregable_id: entregable.entregable_id }, CTX_LEO);
  assert.equal(antesDeEntregar._validationError, true, 'no se puede revisar antes de que este ENTREGADO');

  ctx.Proyectos.gestionarEntregable({ proyecto_id: proyecto.proyecto_id, accion: 'marcarEntregado', entregable_id: entregable.entregable_id }, CTX_MARCELO);

  const rechazado = ctx.Proyectos.revisarEntregable({
    proyecto_id: proyecto.proyecto_id, entregable_id: entregable.entregable_id, resultado: 'APROBADO'
  }, CTX_MARCELO);
  assert.equal(rechazado._forbidden, true, 'solo el lider/ADM revisa');

  const sinMotivo = ctx.Proyectos.revisarEntregable({
    proyecto_id: proyecto.proyecto_id, entregable_id: entregable.entregable_id, resultado: 'OBSERVADO'
  }, CTX_LEO);
  assert.equal(sinMotivo._validationError, true);

  const observado = ctx.Proyectos.revisarEntregable({
    proyecto_id: proyecto.proyecto_id, entregable_id: entregable.entregable_id, resultado: 'OBSERVADO', observaciones: 'Falta el capítulo 3.'
  }, CTX_LEO);
  assert.equal(observado.estado, 'OBSERVADO');

  // El responsable corrige y vuelve a marcar entregado -> puede revisarse de nuevo.
  ctx.Proyectos.gestionarEntregable({ proyecto_id: proyecto.proyecto_id, accion: 'marcarEntregado', entregable_id: entregable.entregable_id }, CTX_MARCELO);
  const aprobado = ctx.Proyectos.revisarEntregable({
    proyecto_id: proyecto.proyecto_id, entregable_id: entregable.entregable_id, resultado: 'APROBADO'
  }, CTX_LEO);
  assert.equal(aprobado.estado, 'APROBADO');
});

test('salud: un entregable vencido u observado agrega motivo de riesgo', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  const entregable = ctx.Proyectos.gestionarEntregable({
    proyecto_id: proyecto.proyecto_id, nombre: 'Informe vencido', responsable_email: 'leo@rld.cl', fecha_comprometida: '2020-01-01'
  }, CTX_LEO);
  const detalle = ctx.Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(detalle.salud, 'riesgo');
  assert.ok(detalle.salud_motivos.some((m) => m.indexOf('entregable') !== -1));
});

// --- v9.4 (Fase 3): riesgos --------------------------------------------------

test('gestionarRiesgo: crear deriva el nivel de probabilidad x impacto; editar recalcula; eliminar cierra', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);

  const sinDescripcion = ctx.Proyectos.gestionarRiesgo({ proyecto_id: proyecto.proyecto_id, probabilidad: 'ALTA', impacto: 'ALTA' }, CTX_LEO);
  assert.equal(sinDescripcion._validationError, true);

  const riesgo = ctx.Proyectos.gestionarRiesgo({
    proyecto_id: proyecto.proyecto_id, descripcion: 'El proveedor puede atrasarse', probabilidad: 'ALTA', impacto: 'ALTA'
  }, CTX_LEO);
  assert.equal(riesgo.nivel, 'ALTA');

  const editado = ctx.Proyectos.gestionarRiesgo({
    proyecto_id: proyecto.proyecto_id, riesgo_id: riesgo.riesgo_id, probabilidad: 'BAJA', impacto: 'BAJA'
  }, CTX_LEO);
  assert.equal(editado.nivel, 'BAJA');

  const eliminado = ctx.Proyectos.gestionarRiesgo({ proyecto_id: proyecto.proyecto_id, accion: 'eliminar', riesgo_id: riesgo.riesgo_id }, CTX_LEO);
  assert.equal(eliminado.estado, 'CERRADO');
});

// --- v9.4 (Fase 2): dependencias tarea<->tarea -------------------------------

test('crearTarea: depende_de debe ser una tarea del MISMO proyecto', () => {
  const ctx = loadConSchema();
  const proyectoA = crearProyectoBase(ctx, { nombre: 'Proyecto A' });
  const proyectoB = crearProyectoBase(ctx, { nombre: 'Proyecto B' });
  const tareaB = ctx.Proyectos.crearTarea({
    proyecto_id: proyectoB.proyecto_id, titulo: 'Tarea de B', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-08-20'
  }, CTX_LEO);

  const rechazada = ctx.Proyectos.crearTarea({
    proyecto_id: proyectoA.proyecto_id, titulo: 'Tarea de A', responsable_email: 'leo@rld.cl',
    fecha_compromiso: '2026-08-20', depende_de: tareaB.actividad_id
  }, CTX_LEO);
  assert.equal(rechazada._validationError, true);
});

test('listarTareas: dependencia_comprometida es true cuando la tarea de la que se depende esta atrasada', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  const base = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Diseño', responsable_email: 'leo@rld.cl', fecha_compromiso: '2020-01-01'
  }, CTX_LEO); // vencida a proposito -> atrasada
  const dependiente = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Implementación', responsable_email: 'leo@rld.cl',
    fecha_compromiso: '2026-12-01', depende_de: base.actividad_id
  }, CTX_LEO);

  const tareas = ctx.Proyectos.listarTareas({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const fila = tareas.find((t) => t.actividad_id === dependiente.actividad_id);
  assert.equal(fila.dependencia_comprometida, true);
  assert.equal(fila.dependencia_titulo, 'Diseño');

  // Al día -> no comprometida.
  const otraBase = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Al día', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-12-01'
  }, CTX_LEO);
  const otroDependiente = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Depende de al día', responsable_email: 'leo@rld.cl',
    fecha_compromiso: '2026-12-01', depende_de: otraBase.actividad_id
  }, CTX_LEO);
  const tareas2 = ctx.Proyectos.listarTareas({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(tareas2.find((t) => t.actividad_id === otroDependiente.actividad_id).dependencia_comprometida, false);
});

// --- v9.4 (Fase 3): resumen ejecutivo del portafolio -------------------------

test('getResumenPortafolio: agrega por salud y calcula carga por persona ponderada por tamano', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx, { nombre: 'Portafolio' });
  ctx.Proyectos.actualizar({ proyecto_id: proyecto.proyecto_id, estado: 'ACTIVO' }, CTX_LEO);
  ctx.Proyectos.gestionarIntegrante({
    proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE'
  }, CTX_LEO);
  ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Tarea S', responsable_email: 'marcelo@rld.cl',
    fecha_compromiso: '2026-12-01', tamano: 'S'
  }, CTX_LEO);
  ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Tarea XL', responsable_email: 'marcelo@rld.cl',
    fecha_compromiso: '2026-12-01', tamano: 'XL'
  }, CTX_LEO);

  const resumen = ctx.Proyectos.getResumenPortafolio(CTX_LEO);
  assert.equal(resumen.total_proyectos, 1);
  assert.equal(resumen.por_salud.normal, 1);
  const cargaMarcelo = resumen.carga_por_persona.find((c) => c.email === 'marcelo@rld.cl');
  assert.equal(cargaMarcelo.total_tareas, 2);
  assert.equal(cargaMarcelo.carga_ponderada, 6); // S=1 + XL=5
});

// --- plantillas de proyecto (Fase C) ---------------------------------------

test('guardarComoPlantilla: exclusivo del lider/ADM; copia los hitos (nombre/descripcion/orden), nunca fechas', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  ctx.Proyectos.gestionarIntegrante({ proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  ctx.Proyectos.gestionarHito({ proyecto_id: proyecto.proyecto_id, nombre: 'Levantamiento', descripcion: 'Entrevistas iniciales', fecha_objetivo: '2026-09-01' }, CTX_LEO);
  ctx.Proyectos.gestionarHito({ proyecto_id: proyecto.proyecto_id, nombre: 'Cierre', fecha_objetivo: '2026-10-01' }, CTX_LEO);

  const rechazado = ctx.Proyectos.guardarComoPlantilla({ proyecto_id: proyecto.proyecto_id, nombre: 'Certificación tipo' }, CTX_MARCELO);
  assert.equal(rechazado._forbidden, true);

  const sinNombre = ctx.Proyectos.guardarComoPlantilla({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(sinNombre._validationError, true);

  const plantilla = ctx.Proyectos.guardarComoPlantilla({ proyecto_id: proyecto.proyecto_id, nombre: 'Certificación tipo' }, CTX_LEO);
  assert.equal(plantilla.total_hitos, 2);

  const listado = ctx.Proyectos.listarPlantillas({}, CTX_LEO);
  assert.equal(listado.length, 1);
  assert.equal(listado[0].nombre, 'Certificación tipo');
  assert.equal(listado[0].total_hitos, 2);
});

test('crear (con plantilla_id): clona los hitos de la plantilla, sin fecha_objetivo y en PENDIENTE; una plantilla inexistente no rompe la creacion', () => {
  const ctx = loadConSchema();
  const origen = crearProyectoBase(ctx, { nombre: 'Certificación ISO 2025' });
  ctx.Proyectos.gestionarHito({ proyecto_id: origen.proyecto_id, nombre: 'Levantamiento', descripcion: 'Entrevistas iniciales', fecha_objetivo: '2026-09-01' }, CTX_LEO);
  ctx.Proyectos.gestionarHito({ proyecto_id: origen.proyecto_id, nombre: 'Auditoría interna', fecha_objetivo: '2026-10-01' }, CTX_LEO);
  const plantilla = ctx.Proyectos.guardarComoPlantilla({ proyecto_id: origen.proyecto_id, nombre: 'Certificación tipo' }, CTX_LEO);

  const nuevo = crearProyectoBase(ctx, { nombre: 'Certificación ISO 2026', plantilla_id: plantilla.plantilla_id });
  const detalle = ctx.Proyectos.getDetalle({ proyecto_id: nuevo.proyecto_id }, CTX_LEO);
  assert.equal(detalle.hitos.length, 2);
  assert.deepEqual(toPlain(detalle.hitos.map((h) => h.nombre)), ['Levantamiento', 'Auditoría interna']);
  detalle.hitos.forEach((h) => {
    assert.equal(h.fecha_objetivo, '');
    assert.equal(h.estado, 'PENDIENTE');
  });

  // Una plantilla que no existe (o ya se desactivo) no debe romper la
  // creacion del proyecto -- es un dato secundario, se ignora en silencio.
  const otro = crearProyectoBase(ctx, { nombre: 'Proyecto sin plantilla real', plantilla_id: 'no-existe' });
  assert.equal(otro._validationError, undefined);
  const detalleOtro = ctx.Proyectos.getDetalle({ proyecto_id: otro.proyecto_id }, CTX_LEO);
  assert.equal(detalleOtro.hitos.length, 0);
});

// --- reporte PDF (Fase D) --------------------------------------------------

test('descargarReporte: exige poder VER el proyecto; el PDF trae hitos, riesgos abiertos y proximos vencimientos', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  ctx.Proyectos.gestionarHito({ proyecto_id: proyecto.proyecto_id, nombre: 'Levantamiento inicial', fecha_objetivo: '2026-09-01' }, CTX_LEO);
  ctx.Proyectos.gestionarRiesgo({
    proyecto_id: proyecto.proyecto_id, descripcion: 'El proveedor externo puede atrasar la entrega',
    probabilidad: 'ALTA', impacto: 'ALTA', responsable_email: 'leo@rld.cl'
  }, CTX_LEO);
  ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Tarea urgente y atrasada', responsable_email: 'leo@rld.cl', fecha_compromiso: '2020-01-01'
  }, CTX_LEO);

  const rechazado = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id }, CTX_OTRO);
  assert.equal(rechazado._forbidden, true);

  const res = ctx.Proyectos.descargarReporte({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.ok(res.pdf_base64 && res.pdf_base64.length > 0);
  assert.match(res.filename, /\.pdf$/);

  // El mock de Utilities.newBlob().getAs('application/pdf') no convierte de
  // verdad -- conserva el HTML como bytes, asi que decodificar el base64
  // alcanza para verificar que el reporte trae los datos correctos.
  const html = Buffer.from(res.pdf_base64, 'base64').toString('utf8');
  assert.match(html, /Levantamiento inicial/);
  assert.match(html, /El proveedor externo puede atrasar la entrega/);
  assert.match(html, /Tarea urgente y atrasada/);
});

// --- Solicitud -> Proyecto (Fase D) ----------------------------------------

function seedSolicitud(ctx, overrides) {
  const sol = Object.assign({
    solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', empresa_nombre: 'HomePymes',
    solicitante_nombre: 'Juan Pérez', solicitante_email: 'juan@homepymes.cl',
    estado_derivado: 'S05', fecha_creacion: new Date().toISOString()
  }, overrides || {});
  ctx.agregarFila_('SOLICITUDES', sol);
  return sol;
}

test('crear (con solicitud_id): marca la solicitud como convertida, registra el enlace y no deja convertirla dos veces', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx);

  const inexistente = crearProyectoBase(ctx, { nombre: 'X', solicitud_id: 'NO-EXISTE' });
  assert.equal(inexistente._validationError, true);

  const proyecto = crearProyectoBase(ctx, { nombre: 'Migración desde ticket', solicitud_id: 'SOL-2026-HP-0001' });
  assert.equal(proyecto._validationError, undefined);
  assert.equal(proyecto.solicitud_origen_id, 'SOL-2026-HP-0001');

  const solicitud = ctx.leerFilasSeguro_('SOLICITUDES').find((s) => s.solicitud_id === 'SOL-2026-HP-0001');
  assert.equal(solicitud.proyecto_id, proyecto.proyecto_id);

  const detalle = ctx.Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(detalle.puede_gestionar, true); // sanity: el proyecto quedo usable de verdad

  // Convertir la MISMA solicitud otra vez debe rechazarse (ya tiene proyecto_id).
  const dosVeces = crearProyectoBase(ctx, { nombre: 'Otra vez', solicitud_id: 'SOL-2026-HP-0001' });
  assert.equal(dosVeces._validationError, true);
});

// --- resumen diario / "que se movio desde tu ultima visita" (Fase D) ------

test('marcarSalaVisitada + resumen_desde_ultima_visita: primera vez es null; despues cuenta lo nuevo', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);

  const antes = ctx.Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(antes.resumen_desde_ultima_visita, null);

  const marcado = ctx.Proyectos.marcarSalaVisitada({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(marcado.actualizado, true);

  // ADM sin fila de integrante: no rompe, simplemente no tiene donde guardarlo.
  const marcadoAdm = ctx.Proyectos.marcarSalaVisitada({ proyecto_id: proyecto.proyecto_id }, CTX_ADM);
  assert.equal(marcadoAdm.actualizado, false);

  // Actividad DESPUES de la visita: un comentario, una tarea propia que se
  // completa, otra que se bloquea, y un entregable aprobado.
  ctx.Proyectos.publicarEnSala({ proyecto_id: proyecto.proyecto_id, tipo: 'COMENTARIO', cuerpo: 'Avanzamos bien' }, CTX_LEO);

  const tareaListo = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Tarea que se completa', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01'
  }, CTX_LEO);
  ctx.Actividades.checkin({ actividad_id: tareaListo.actividad_id, tipo: 'listo' }, CTX_LEO);

  const tareaBloqueada = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Tarea que se bloquea', responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-09-01'
  }, CTX_LEO);
  ctx.Actividades.checkin({ actividad_id: tareaBloqueada.actividad_id, tipo: 'bloqueo', bloqueo_motivo: 'Esperando acceso' }, CTX_LEO);

  const entregable = ctx.Proyectos.gestionarEntregable({
    proyecto_id: proyecto.proyecto_id, accion: 'crear', nombre: 'Manual', responsable_email: 'leo@rld.cl', fecha_comprometida: '2026-09-01'
  }, CTX_LEO);
  ctx.Proyectos.gestionarEntregable({ proyecto_id: proyecto.proyecto_id, accion: 'marcarEntregado', entregable_id: entregable.entregable_id }, CTX_LEO);
  ctx.Proyectos.revisarEntregable({ proyecto_id: proyecto.proyecto_id, entregable_id: entregable.entregable_id }, CTX_LEO);

  const despues = ctx.Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const resumen = despues.resumen_desde_ultima_visita;
  assert.ok(resumen);
  assert.equal(resumen.tareas_completadas, 1);
  assert.equal(resumen.tareas_bloqueadas, 1);
  assert.equal(resumen.entregables_aprobados, 1);
  assert.ok(resumen.eventos_sala >= 3);
});

// --- adjuntos por proyecto (Fase D) ----------------------------------------

const PDF_B64 = Buffer.from('%PDF-1.4 contenido de prueba').toString('base64');
const BASURA_B64 = Buffer.from('esto no es un documento').toString('base64');

test('subirAdjunto: exige poder crear tareas en el proyecto; valida el tipo de archivo por firma; aparece en la Sala', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  ctx.Proyectos.gestionarIntegrante({ proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'OBSERVADOR' }, CTX_LEO);

  const sinPermiso = ctx.Proyectos.subirAdjunto({
    proyecto_id: proyecto.proyecto_id, nombre_archivo: 'manual.pdf', contenido_base64: PDF_B64
  }, CTX_MARCELO); // OBSERVADOR: no puede subir
  assert.equal(sinPermiso._forbidden, true);

  const basura = ctx.Proyectos.subirAdjunto({
    proyecto_id: proyecto.proyecto_id, nombre_archivo: 'virus.pdf', contenido_base64: BASURA_B64
  }, CTX_LEO);
  assert.equal(basura._validationError, true);

  const evento = ctx.Proyectos.subirAdjunto({
    proyecto_id: proyecto.proyecto_id, nombre_archivo: 'manual.pdf', contenido_base64: PDF_B64
  }, CTX_LEO);
  assert.equal(evento.tipo, 'ARCHIVO');
  assert.equal(evento.titulo, 'manual.pdf');
  assert.ok(evento.ref_id);

  const sala = ctx.Proyectos.listarSala({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const archivos = sala.filter((e) => e.tipo === 'ARCHIVO');
  assert.equal(archivos.length, 1);
  assert.equal(archivos[0].titulo, 'manual.pdf');
});

test('descargarAdjunto: devuelve el contenido a quien puede VER el proyecto; rechaza a un ajeno y un evento_id inexistente', () => {
  const ctx = loadConSchema();
  const proyecto = crearProyectoBase(ctx);
  const evento = ctx.Proyectos.subirAdjunto({
    proyecto_id: proyecto.proyecto_id, nombre_archivo: 'manual.pdf', contenido_base64: PDF_B64
  }, CTX_LEO);

  const ajeno = ctx.Proyectos.descargarAdjunto({ proyecto_id: proyecto.proyecto_id, evento_id: evento.evento_id }, CTX_OTRO);
  assert.equal(ajeno._forbidden, true);

  const noExiste = ctx.Proyectos.descargarAdjunto({ proyecto_id: proyecto.proyecto_id, evento_id: 'no-existe' }, CTX_LEO);
  assert.equal(noExiste._validationError, true);

  const descarga = ctx.Proyectos.descargarAdjunto({ proyecto_id: proyecto.proyecto_id, evento_id: evento.evento_id }, CTX_LEO);
  assert.equal(descarga.nombre_archivo, 'manual.pdf');
  assert.equal(Buffer.from(descarga.contenido_base64, 'base64').toString('utf8'), '%PDF-1.4 contenido de prueba');
});
