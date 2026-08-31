'use strict';

// v11 (Reingeniería Cronograma, P1): "Control: Baseline · Plan/Esperado/Real ·
// Salud · Historial · Workload". Estos tests verifican las piezas de
// backend de esa fase: congelar línea base (evento BASELINE en
// PROYECTO_EVENTOS, sin hoja/columna nueva), Plan/Esperado/Real + desviación
// por tarea en obtenerRendimiento, el score numérico ponderado de
// calcularSaludProyecto_ (via getDetalle/listar), y reprogramarTarea
// (delega en Actividades.reprogramar, deja el evento REPROGRAMACION
// legible para el historial).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'fake-drive-root' } });
  ['PROYECTOS', 'PROYECTO_INTEGRANTES', 'PROYECTO_HITOS', 'PROYECTO_EVENTOS',
    'PROYECTO_ENTREGABLES', 'PROYECTO_RIESGOS', 'PROYECTO_PLANTILLAS',
    'PROYECTO_PLANTILLA_HITOS', 'SOLICITUDES', 'ACTIVIDADES', 'ACTIVIDADES_BITACORA',
    'JEFATURAS', 'LOG_NOTIFICACIONES', 'CONFIG_FERIADOS', 'NOTIFICACIONES_APP', 'CAT_AREAS']
    .forEach((h) => seedSheet(ctx, h, ctx.COLUMNAS[h]));
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

// Nota RN-710: como quien crea (Leo) no es el responsable (Marcelo), la
// fecha nace "propuesta" hasta que Marcelo la confirma -- si no,
// fecha_compromiso queda vacío y los tests de Plan/Esperado/Real o
// reprogramar no tendrían nada que medir. Se confirma en el mismo helper
// para que cada test parta de un plan ya vigente, como en el uso real.
function armarProyectoConTarea(ctx, overridesTarea) {
  const proyecto = ctx.Proyectos.crear({
    nombre: 'Migración ERP', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01'
  }, CTX_LEO);
  ctx.Proyectos.gestionarIntegrante({
    proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE'
  }, CTX_LEO);
  const fechaCompromiso = (overridesTarea && 'fecha_compromiso' in overridesTarea) ? overridesTarea.fecha_compromiso : '2026-09-20';
  const tarea = ctx.Proyectos.crearTarea(Object.assign({
    proyecto_id: proyecto.proyecto_id, titulo: 'Levantar requerimientos',
    responsable_email: 'marcelo@rld.cl', fecha_compromiso: fechaCompromiso
  }, overridesTarea || {}), CTX_LEO);
  if (fechaCompromiso) {
    ctx.Actividades.confirmar({ actividad_id: tarea.actividad_id, fecha_compromiso: fechaCompromiso }, CTX_MARCELO);
    tarea.fecha_compromiso = fechaCompromiso;
  }
  return { proyecto, tarea };
}

test('congelarBaseline: exclusivo del líder/ADM; guarda un evento BASELINE con la foto de fechas', () => {
  const ctx = loadConSchema();
  const { proyecto, tarea } = armarProyectoConTarea(ctx);

  const rechazado = ctx.Proyectos.congelarBaseline({ proyecto_id: proyecto.proyecto_id }, CTX_MARCELO);
  assert.equal(rechazado._forbidden, true, 'un integrante sin ser líder no puede congelar');

  const r = ctx.Proyectos.congelarBaseline({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(r.ok, true);
  assert.equal(r.total_tareas, 1);

  const eventos = ctx.leerFilas_('PROYECTO_EVENTOS').filter((e) => e.proyecto_id === proyecto.proyecto_id && e.tipo === 'BASELINE');
  assert.equal(eventos.length, 1);
  const snapshot = JSON.parse(eventos[0].cuerpo);
  assert.equal(snapshot.tareas[0].actividad_id, tarea.actividad_id);
  assert.equal(snapshot.tareas[0].fecha_fin, '2026-09-20');
});

test('congelarBaseline: la más reciente es la vigente en obtenerRendimiento; re-congelar no borra la anterior de PROYECTO_EVENTOS', () => {
  const ctx = loadConSchema();
  const { proyecto, tarea } = armarProyectoConTarea(ctx);

  ctx.Proyectos.congelarBaseline({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  // Reprograma la tarea (cambia el plan) y vuelve a congelar.
  ctx.Actividades.reprogramar({ actividad_id: tarea.actividad_id, fecha_compromiso: '2026-10-05', motivo: 'Cliente pidió más tiempo' }, CTX_LEO);
  ctx.Proyectos.congelarBaseline({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);

  const eventos = ctx.leerFilas_('PROYECTO_EVENTOS').filter((e) => e.proyecto_id === proyecto.proyecto_id && e.tipo === 'BASELINE');
  assert.equal(eventos.length, 2, 'ambas fotos quedan, no se pisan');

  const rendimiento = ctx.Proyectos.obtenerRendimiento({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const fila = rendimiento.plan_seguimiento.filter((t) => t.actividad_id === tarea.actividad_id)[0];
  assert.equal(fila.baseline_fin, '2026-10-05', 'la baseline vigente es la MÁS RECIENTE');
  assert.equal(fila.plan_fin, '2026-10-05', 'el plan actual también refleja la reprogramación');
  assert.ok(rendimiento.baseline, 'el resumen de baseline viaja aparte (timestamp/autor)');
});

test('obtenerRendimiento: Plan/Esperado/Real por tarea, para TODA tarea activa (no solo con meta_cantidad)', () => {
  const ctx = loadConSchema();
  const ahora = new Date();
  const inicio = new Date(ahora.getTime() - 10 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const fin = new Date(ahora.getTime() + 10 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { proyecto, tarea } = armarProyectoConTarea(ctx, { fecha_compromiso: fin });
  // fecha_creacion la pone Actividades.crear como "ahora" -- para testear un
  // Esperado ~50% forzamos fecha_creacion vía escritura directa a la hoja.
  ctx.actualizarFilaPorId_('ACTIVIDADES', 'actividad_id', tarea.actividad_id, { fecha_creacion: inicio });

  const sinAvance = ctx.Proyectos.obtenerRendimiento({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const filaSinAvance = sinAvance.plan_seguimiento.filter((t) => t.actividad_id === tarea.actividad_id)[0];
  assert.ok(filaSinAvance.avance_esperado_pct > 40 && filaSinAvance.avance_esperado_pct < 60, 'a mitad de camino, esperado ronda 50%');
  assert.equal(filaSinAvance.avance_real_pct, 0, 'NO_INICIADA sin avance_pct explícito: real=0 (inequívoco, no inventado)');

  // Real explícito vía checkin de avance.
  ctx.Actividades.checkin({ actividad_id: tarea.actividad_id, tipo: 'avance', avance_pct: 20 }, CTX_MARCELO);
  const conAvance = ctx.Proyectos.obtenerRendimiento({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const filaConAvance = conAvance.plan_seguimiento.filter((t) => t.actividad_id === tarea.actividad_id)[0];
  assert.equal(filaConAvance.avance_real_pct, 20);
  assert.ok(filaConAvance.desviacion_pp < 0, 'va por debajo de lo esperado (20% real vs ~50% esperado) -> desviación negativa');
});

test('obtenerRendimiento: tarea aún pendiente de confirmar (RN-710, sin fecha_compromiso), Esperado es null (no se inventa)', () => {
  const ctx = loadConSchema();
  const proyecto = ctx.Proyectos.crear({
    nombre: 'Migración ERP', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01'
  }, CTX_LEO);
  ctx.Proyectos.gestionarIntegrante({
    proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE'
  }, CTX_LEO);
  // Leo (no Marcelo) crea la tarea -> RN-710: nace con fecha PROPUESTA, no
  // confirmada -- fecha_compromiso queda vacío hasta que Marcelo confirme.
  const tarea = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Por confirmar',
    responsable_email: 'marcelo@rld.cl', fecha_compromiso: '2026-09-20'
  }, CTX_LEO);
  const r = ctx.Proyectos.obtenerRendimiento({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const fila = r.plan_seguimiento.filter((t) => t.actividad_id === tarea.actividad_id)[0];
  assert.equal(fila.plan_fin, '', 'sin confirmar, no hay fecha_compromiso todavía');
  assert.equal(fila.avance_esperado_pct, null);
  assert.equal(fila.desviacion_pp, null);
});

test('salud: expone un score numérico 0-100 ponderado, consistente con los motivos; normal = 100', () => {
  const ctx = loadConSchema();
  const { proyecto } = armarProyectoConTarea(ctx);
  const sano = ctx.Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(sano.salud, 'normal');
  assert.equal(sano.salud_score, 100);
  assert.deepEqual(toPlain(sano.salud_desglose), []);

  // Tarea P1 atrasada -> crítico, con score < 100 y desglose que lo explica.
  // Leo crea para Marcelo (RN-710: nace propuesta) -- Marcelo confirma esa
  // misma fecha para que quede realmente comprometida y vencida.
  const vencida = ctx.Proyectos.crearTarea({
    proyecto_id: proyecto.proyecto_id, titulo: 'Urgente', responsable_email: 'marcelo@rld.cl',
    prioridad: 'P1', fecha_compromiso: '2020-01-01'
  }, CTX_LEO);
  ctx.Actividades.confirmar({ actividad_id: vencida.actividad_id, fecha_compromiso: '2020-01-01' }, CTX_MARCELO);
  const critico = ctx.Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(critico.salud, 'critico');
  assert.ok(critico.salud_score < 100);
  assert.equal(critico.salud_score, 100 - 12, 'una tarea crítica atrasada pesa 12 puntos (SALUD_PESOS_)');
  assert.equal(critico.salud_desglose.length, 1);
  assert.equal(critico.salud_desglose[0].factor, 'tarea_critica_atrasada');
});

test('salud_override: no calcula score (null) -- es una corrección manual, no una medición', () => {
  const ctx = loadConSchema();
  const { proyecto } = armarProyectoConTarea(ctx);
  ctx.actualizarFilaPorId_('PROYECTOS', 'proyecto_id', proyecto.proyecto_id, { salud_override: 'critico', salud_override_motivo: 'Cliente pausó el proyecto' });
  const detalle = ctx.Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(detalle.salud, 'critico');
  assert.equal(detalle.salud_score, null);
});

test('reprogramarTarea: delega en Actividades.reprogramar; el líder del proyecto puede (es supervisor por defecto); un ajeno no', () => {
  const ctx = loadConSchema();
  const { proyecto, tarea } = armarProyectoConTarea(ctx);

  const rechazado = ctx.Proyectos.reprogramarTarea({
    proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, fecha_compromiso: '2026-10-01', motivo: 'x'
  }, CTX_OTRO);
  assert.equal(rechazado._forbidden, true, 'un ajeno al proyecto ni siquiera puede intentarlo (no ve el proyecto)');

  const sinMotivo = ctx.Proyectos.reprogramarTarea({
    proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, fecha_compromiso: '2026-10-01'
  }, CTX_LEO);
  assert.equal(sinMotivo._validationError, true, 'toda reprogramación exige motivo (RN-703)');

  const ok = ctx.Proyectos.reprogramarTarea({
    proyecto_id: proyecto.proyecto_id, actividad_id: tarea.actividad_id, fecha_compromiso: '2026-10-01', motivo: 'Cliente pidió más tiempo'
  }, CTX_LEO);
  assert.equal(ok.fecha_compromiso, '2026-10-01');

  // El historial (listarBitacora) expone fecha_anterior/fecha_nueva listas
  // para pintar "antes → después" sin que el frontend toque JSON.
  const bitacora = ctx.Proyectos.listarBitacora({ proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  const evento = bitacora.filter((b) => b.tipo === 'REPROGRAMACION')[0];
  assert.ok(evento, 'el evento de reprogramación aparece en la bitácora del proyecto');
  assert.equal(evento.fecha_anterior, '2026-09-20');
  assert.equal(evento.fecha_nueva, '2026-10-01');
  assert.equal(evento.nota, 'Cliente pidió más tiempo');
});

test('reprogramarTarea: rechaza una tarea de OTRO proyecto (defensa en profundidad, aunque Actividades.reprogramar la encontraría igual)', () => {
  const ctx = loadConSchema();
  const { tarea } = armarProyectoConTarea(ctx);
  const otroProyecto = ctx.Proyectos.crear({
    nombre: 'Otro proyecto', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-12-01'
  }, CTX_LEO);
  const r = ctx.Proyectos.reprogramarTarea({
    proyecto_id: otroProyecto.proyecto_id, actividad_id: tarea.actividad_id, fecha_compromiso: '2026-10-01', motivo: 'x'
  }, CTX_LEO);
  assert.equal(r._validationError, true);
});
