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
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'PROYECTOS', ctx.COLUMNAS.PROYECTOS);
  seedSheet(ctx, 'PROYECTO_INTEGRANTES', ctx.COLUMNAS.PROYECTO_INTEGRANTES);
  seedSheet(ctx, 'PROYECTO_HITOS', ctx.COLUMNAS.PROYECTO_HITOS);
  seedSheet(ctx, 'PROYECTO_EVENTOS', ctx.COLUMNAS.PROYECTO_EVENTOS);
  seedSheet(ctx, 'PROYECTO_ENTREGABLES', ctx.COLUMNAS.PROYECTO_ENTREGABLES);
  seedSheet(ctx, 'PROYECTO_RIESGOS', ctx.COLUMNAS.PROYECTO_RIESGOS);
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
