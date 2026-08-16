'use strict';

// v10.0 Fase 3a (documentacion/SIGSO-v10.0-propuesta-modulo-sgc-iso9001.md):
// no conformidades y acciones correctivas (PRO-06). Es el motor de mejora
// del SGC y lo que la auditoria de certificacion revisa con mas
// profundidad (§10.2 de la norma).
//
// Lo que protegen estos tests, en orden de importancia:
//  1. QUE LA CORRECCION Y LA ACCION CORRECTIVA SEAN ACTIVIDADES REALES.
//     Es la decision central de la fase: si dejaran de crearse en
//     ACTIVIDADES, al responsable no le llegarian a "Mi trabajo" y el
//     modulo se volveria una pantalla que nadie abre.
//  2. Que el orden del ciclo se respete: sin causa raiz no hay accion
//     correctiva (si no, es una correccion disfrazada que ataca el sintoma).
//  3. Que una eficacia negativa REABRA con un ciclo nuevo en vez de cerrar.
//  4. Que los plazos sean en dias habiles (10/20/60), no corridos.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'raiz' }
  });
  seedSheet(ctx, 'SGC_NC', ctx.COLUMNAS.SGC_NC);
  seedSheet(ctx, 'SGC_ROLES', ctx.COLUMNAS.SGC_ROLES);
  seedSheet(ctx, 'ACTIVIDADES', ctx.COLUMNAS.ACTIVIDADES);
  seedSheet(ctx, 'ACTIVIDADES_BITACORA', ctx.COLUMNAS.ACTIVIDADES_BITACORA);
  seedSheet(ctx, 'JEFATURAS', ctx.COLUMNAS.JEFATURAS);
  seedSheet(ctx, 'CONFIG_FERIADOS', ctx.COLUMNAS.CONFIG_FERIADOS);
  seedSheet(ctx, 'LOG_SISTEMA', ctx.COLUMNAS.LOG_SISTEMA);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'NOTIFICACIONES_APP', ctx.COLUMNAS.NOTIFICACIONES_APP);
  seedSheet(ctx, 'CONFIG_NOTIFICACIONES', ctx.COLUMNAS.CONFIG_NOTIFICACIONES);
  seedSheet(ctx, 'CAT_AREAS', ctx.COLUMNAS.CAT_AREAS);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Encargado SGC', 'sgc@homepymes.cl', 'HP', 'DEV', true, '', 'sistema'],
    ['U2', 'Responsable', 'resp@homepymes.cl', 'HP', 'DEV', true, '', 'sistema'],
    ['U3', 'Ajeno', 'ajeno@homepymes.cl', 'HP', 'DEV', true, '', 'sistema']
  ]);
  return ctx;
}

const CTX_SGC = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const CTX_RESP = { email: 'resp@homepymes.cl', nombre: 'Responsable', rol: 'DEV' };
const CTX_AJENO = { email: 'ajeno@homepymes.cl', nombre: 'Ajeno', rol: 'DEV' };
const CTX_ADM = { email: 'admin@homepymes.cl', nombre: 'Admin', rol: 'ADM' };

function sembrar(ctx) {
  ctx.Calidad.gestionarRol({ usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADM);
  ctx.Calidad.gestionarRol({ usuario_email: 'resp@homepymes.cl', rol_sgc: 'OPERATIVO' }, CTX_ADM);
}

function crearNc(ctx, overrides) {
  return ctx.NoConformidades.crear(Object.assign({
    descripcion: 'Se entregaron liquidaciones fuera del plazo comprometido.',
    fuente: 'PROCESO',
    responsable_email: 'resp@homepymes.cl',
    area_id: 'RRHH'
  }, overrides), CTX_SGC);
}

// --- la decision central: correccion y AC son ACTIVIDADES ------------------

test('la correccion se crea como ACTIVIDAD real, asignada al responsable', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const nc = crearNc(ctx);

  const actualizada = ctx.NoConformidades.registrarCorreccion({
    nc_id: nc.nc_id, descripcion: 'Reenviar las liquidaciones pendientes hoy mismo.'
  }, CTX_SGC);
  assert.ok(actualizada.correccion_actividad_id, 'debe quedar vinculada a una actividad');
  assert.equal(actualizada.estado, 'EN_CORRECCION');

  // Y esa actividad existe DE VERDAD en la hoja que alimenta "Mi trabajo".
  const tarea = ctx.leerFilas_('ACTIVIDADES')
    .filter((a) => a.actividad_id === actualizada.correccion_actividad_id)[0];
  assert.ok(tarea, 'la actividad debe existir en ACTIVIDADES');
  assert.equal(tarea.responsable_email, 'resp@homepymes.cl');
  assert.equal(tarea.sgc_origen_tipo, 'NC_CORRECCION');
  assert.equal(tarea.sgc_origen_id, nc.nc_id);
  assert.ok(tarea.titulo.indexOf(nc.correlativo) !== -1, 'el titulo debe identificar la NC');
});

test('el responsable la ve en "Mi trabajo" y puede hacer check-in como con cualquier tarea', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const nc = crearNc(ctx);
  const conCorreccion = ctx.NoConformidades.registrarCorreccion({
    nc_id: nc.nc_id, descripcion: 'Reenviar liquidaciones.'
  }, CTX_SGC);

  // Esta es la prueba de que la decision central funciona: la accion
  // correctiva aparece en la misma lista que todo su otro trabajo.
  const mias = ctx.Actividades.listar({}, CTX_RESP);
  const lista = mias.actividades || mias;
  assert.ok(lista.some((a) => a.actividad_id === conCorreccion.correccion_actividad_id),
    'la correccion debe aparecer en Mi trabajo del responsable');

  // Y el motor de siempre funciona sobre ella, sin nada especial del SGC.
  const avanzada = ctx.Actividades.checkin({
    actividad_id: conCorreccion.correccion_actividad_id, tipo: 'avance', avance_pct: 50
  }, CTX_RESP);
  assert.equal(avanzada.estado, 'EN_CURSO');
  assert.equal(avanzada.avance_pct, 50);
});

test('el detalle de la NC refleja el estado REAL de la actividad, no una copia', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const nc = crearNc(ctx);
  const conC = ctx.NoConformidades.registrarCorreccion({
    nc_id: nc.nc_id, descripcion: 'Reenviar.'
  }, CTX_SGC);

  ctx.Actividades.checkin({ actividad_id: conC.correccion_actividad_id, tipo: 'listo' }, CTX_RESP);

  const detalle = ctx.NoConformidades.getDetalle({ nc_id: nc.nc_id }, CTX_SGC);
  assert.equal(detalle.correccion_actividad.terminada, true,
    'si la persona la termino en Mi trabajo, la NC debe verlo sin que nadie lo copie a mano');
  assert.equal(detalle.resumen.correccion_terminada, true);
});

// --- el orden del ciclo ----------------------------------------------------

test('sin causa raiz no se puede definir la accion correctiva', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const nc = crearNc(ctx);

  const sinCausa = ctx.NoConformidades.registrarAccion({
    nc_id: nc.nc_id, descripcion: 'Cambiar el procedimiento.'
  }, CTX_SGC);
  assert.equal(sinCausa._validationError, true,
    'sin causa raiz la "accion correctiva" ataca el sintoma');

  ctx.NoConformidades.registrarCausa({
    nc_id: nc.nc_id,
    porque_1: 'No se reviso el calendario de cierre.',
    causa_raiz: 'No hay un control de plazos antes del cierre mensual.'
  }, CTX_SGC);

  const conCausa = ctx.NoConformidades.registrarAccion({
    nc_id: nc.nc_id, descripcion: 'Incorporar checklist de plazos al cierre mensual.'
  }, CTX_SGC);
  assert.ok(conCausa.accion_actividad_id);
  assert.equal(conCausa.estado, 'EN_ACCION');
});

test('el analisis de causa exige el primer por que y la causa raiz', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const nc = crearNc(ctx);
  assert.equal(ctx.NoConformidades.registrarCausa({
    nc_id: nc.nc_id, causa_raiz: 'Algo'
  }, CTX_SGC)._validationError, true);
  assert.equal(ctx.NoConformidades.registrarCausa({
    nc_id: nc.nc_id, porque_1: 'Algo'
  }, CTX_SGC)._validationError, true);
});

test('la accion correctiva tambien es una ACTIVIDAD, con su propio origen', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const nc = crearNc(ctx);
  ctx.NoConformidades.registrarCausa({
    nc_id: nc.nc_id, porque_1: 'X', causa_raiz: 'Falta control de plazos.'
  }, CTX_SGC);
  const conAccion = ctx.NoConformidades.registrarAccion({
    nc_id: nc.nc_id, descripcion: 'Checklist de plazos.'
  }, CTX_SGC);

  const tarea = ctx.leerFilas_('ACTIVIDADES')
    .filter((a) => a.actividad_id === conAccion.accion_actividad_id)[0];
  assert.equal(tarea.sgc_origen_tipo, 'NC_ACCION');
  assert.equal(tarea.sgc_origen_id, nc.nc_id);
  assert.equal(tarea.prioridad, 'P2', 'una NC abierta no compite de igual a igual con el resto');
});

// --- eficacia y reapertura --------------------------------------------------

test('eficacia positiva cierra la NC; exige explicar como se verifico', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const nc = crearNc(ctx);
  ctx.NoConformidades.registrarCausa({ nc_id: nc.nc_id, porque_1: 'X', causa_raiz: 'Y' }, CTX_SGC);
  ctx.NoConformidades.registrarAccion({ nc_id: nc.nc_id, descripcion: 'Accion.' }, CTX_SGC);

  // No se puede verificar antes de implementar.
  assert.equal(ctx.NoConformidades.verificarEficacia({
    nc_id: nc.nc_id, resultado: 'EFICAZ', observaciones: 'ok'
  }, CTX_SGC)._validationError, true);

  ctx.NoConformidades.cerrarEtapa({ nc_id: nc.nc_id, etapa: 'ACCION' }, CTX_SGC);

  // Sin explicar como se verifico, no hay evidencia de que se reviso.
  assert.equal(ctx.NoConformidades.verificarEficacia({
    nc_id: nc.nc_id, resultado: 'EFICAZ'
  }, CTX_SGC)._validationError, true);

  const cerrada = ctx.NoConformidades.verificarEficacia({
    nc_id: nc.nc_id, resultado: 'EFICAZ',
    observaciones: 'Se revisaron los cierres de 2 meses siguientes: sin atrasos.'
  }, CTX_SGC);
  assert.equal(cerrada.estado, 'CERRADA');
  assert.ok(cerrada.fecha_cierre);
});

test('eficacia negativa REABRE con un ciclo nuevo en vez de cerrar', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const nc = crearNc(ctx);
  ctx.NoConformidades.registrarCausa({ nc_id: nc.nc_id, porque_1: 'X', causa_raiz: 'Y' }, CTX_SGC);
  ctx.NoConformidades.registrarAccion({ nc_id: nc.nc_id, descripcion: 'Primer intento.' }, CTX_SGC);
  ctx.NoConformidades.cerrarEtapa({ nc_id: nc.nc_id, etapa: 'ACCION' }, CTX_SGC);

  const reabierta = ctx.NoConformidades.verificarEficacia({
    nc_id: nc.nc_id, resultado: 'NO_EFICAZ',
    observaciones: 'Volvio a ocurrir en el cierre siguiente.'
  }, CTX_SGC);
  assert.equal(reabierta.estado, 'EN_ACCION');
  assert.equal(reabierta.ciclo, 2, 'debe arrancar un ciclo nuevo');
  assert.equal(reabierta.accion_actividad_id, '', 'se libera para poder definir otra accion');

  // Y se puede definir una accion correctiva nueva sobre el mismo caso.
  const segundoIntento = ctx.NoConformidades.registrarAccion({
    nc_id: nc.nc_id, descripcion: 'Segundo intento, con control automatico.'
  }, CTX_SGC);
  assert.ok(segundoIntento.accion_actividad_id);
  // La actividad del primer intento NO se borro: es historia.
  const tareas = ctx.leerFilas_('ACTIVIDADES').filter((a) => a.sgc_origen_id === nc.nc_id);
  assert.equal(tareas.filter((a) => a.sgc_origen_tipo === 'NC_ACCION').length, 2);
});

// --- plazos en dias habiles -------------------------------------------------

test('los plazos son en DIAS HABILES y saltan fin de semana', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  // Viernes 2026-08-07. +10 dias habiles = viernes 2026-08-21 (saltando 2
  // fines de semana), no el 17 que daria el calendario corrido.
  const nc = crearNc(ctx, { fecha_deteccion: '2026-08-07T12:00:00.000Z' });
  const plazo = new Date(nc.correccion_plazo);
  assert.equal(plazo.toISOString().slice(0, 10), '2026-08-21');
});

test('los feriados configurados tambien corren el plazo', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  // Se declara feriado el lunes siguiente: el plazo se corre un dia mas.
  ctx.agregarFila_('CONFIG_FERIADOS', { fecha: '2026-08-10', nombre: 'Feriado de prueba', anio: 2026 });
  const nc = crearNc(ctx, { fecha_deteccion: '2026-08-07T12:00:00.000Z' });
  assert.equal(new Date(nc.correccion_plazo).toISOString().slice(0, 10), '2026-08-24');
});

test('el plazo de la eficacia arranca cuando se implementa la accion, no antes', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const nc = crearNc(ctx);
  ctx.NoConformidades.registrarCausa({ nc_id: nc.nc_id, porque_1: 'X', causa_raiz: 'Y' }, CTX_SGC);
  ctx.NoConformidades.registrarAccion({ nc_id: nc.nc_id, descripcion: 'A.' }, CTX_SGC);

  const antes = ctx.NoConformidades.getDetalle({ nc_id: nc.nc_id }, CTX_SGC).nc;
  assert.equal(antes.eficacia_plazo, '', 'sin implementar, no hay reloj de eficacia');

  const cerrada = ctx.NoConformidades.cerrarEtapa({
    nc_id: nc.nc_id, etapa: 'ACCION', fecha: '2026-08-07T12:00:00.000Z'
  }, CTX_SGC);
  assert.ok(cerrada.eficacia_plazo, 'al implementarla arranca el reloj de 60 dias habiles');
  assert.equal(cerrada.estado, 'EN_VERIFICACION');
});

// --- correlativo, permisos y trazabilidad -----------------------------------

test('el correlativo es legible y correlativo por ano', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const a = crearNc(ctx, { fecha_deteccion: '2026-03-01T12:00:00.000Z' });
  const b = crearNc(ctx, { fecha_deteccion: '2026-04-01T12:00:00.000Z' });
  assert.equal(a.correlativo, 'NC-2026-001');
  assert.equal(b.correlativo, 'NC-2026-002');
});

test('solo el Encargado SGC o ADM registran y gestionan no conformidades', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  assert.equal(ctx.NoConformidades.crear({
    descripcion: 'X', fuente: 'PROCESO', responsable_email: 'resp@homepymes.cl'
  }, CTX_RESP)._forbidden, true);

  const nc = crearNc(ctx);
  assert.equal(ctx.NoConformidades.registrarCorreccion({
    nc_id: nc.nc_id, descripcion: 'X'
  }, CTX_RESP)._forbidden, true);
});

test('el responsable ve SU no conformidad; alguien ajeno no', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const nc = crearNc(ctx);

  assert.ok(ctx.NoConformidades.getDetalle({ nc_id: nc.nc_id }, CTX_RESP).nc,
    'el responsable debe poder ver la suya');
  assert.equal(ctx.NoConformidades.getDetalle({ nc_id: nc.nc_id }, CTX_AJENO)._forbidden, true);
  assert.equal(ctx.NoConformidades.listar({}, CTX_AJENO).no_conformidades.length, 0);
  assert.equal(ctx.NoConformidades.listar({}, CTX_RESP).no_conformidades.length, 1);
});

test('anular exige motivo y NO borra la fila', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const nc = crearNc(ctx);
  assert.equal(ctx.NoConformidades.anular({ nc_id: nc.nc_id }, CTX_SGC)._validationError, true);

  const anulada = ctx.NoConformidades.anular({ nc_id: nc.nc_id, motivo: 'Duplicada de NC-2026-001.' }, CTX_SGC);
  assert.equal(anulada.estado, 'ANULADA');
  assert.equal(ctx.leerFilas_('SGC_NC').length, 1, 'borrar una NC es justo lo que un auditor busca que no se pueda');
});

test('crear exige descripcion, fuente valida y responsable', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  assert.equal(ctx.NoConformidades.crear({ fuente: 'PROCESO', responsable_email: 'a@b.cl' }, CTX_SGC)._validationError, true);
  assert.equal(ctx.NoConformidades.crear({ descripcion: 'X', fuente: 'INVENTADA', responsable_email: 'a@b.cl' }, CTX_SGC)._validationError, true);
  assert.equal(ctx.NoConformidades.crear({ descripcion: 'X', fuente: 'PROCESO' }, CTX_SGC)._validationError, true);
});

// --- referencia normativa (v10.0 Tanda A, fidelidad con FO-PRO-06-01) ------
// El formulario real trae este campo en "1.- Generalidades", y el informe
// de auditoria (FO-PRO-03-02) lo pide como "Punto normativo" del resumen.

test('referencia_normativa es opcional al crear una NC manual', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const sinRef = crearNc(ctx);
  assert.equal(sinRef.referencia_normativa, '');
  const conRef = crearNc(ctx, { referencia_normativa: '7.5' });
  assert.equal(conRef.referencia_normativa, '7.5');
});

test('referencia_normativa se puede completar o corregir al registrar la causa', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const nc = crearNc(ctx);
  const actualizada = ctx.NoConformidades.registrarCausa({
    nc_id: nc.nc_id, porque_1: 'X', causa_raiz: 'Y', referencia_normativa: '8.5'
  }, CTX_SGC);
  assert.equal(actualizada.referencia_normativa, '8.5');
});

test('el resumen y el detalle de la NC muestran la referencia normativa', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  crearNc(ctx, { referencia_normativa: '7.2' });
  const listado = ctx.NoConformidades.listar({}, CTX_SGC);
  assert.equal(listado.no_conformidades[0].referencia_normativa, '7.2');
});

// --- indicadores (§9.1 de la especificacion) --------------------------------

test('los indicadores cuentan abiertas, cerradas, vencidas y % de eficacia', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  // Una que se cierra bien.
  const ok = crearNc(ctx);
  ctx.NoConformidades.registrarCausa({ nc_id: ok.nc_id, porque_1: 'X', causa_raiz: 'Y' }, CTX_SGC);
  ctx.NoConformidades.registrarAccion({ nc_id: ok.nc_id, descripcion: 'A.' }, CTX_SGC);
  ctx.NoConformidades.cerrarEtapa({ nc_id: ok.nc_id, etapa: 'ACCION' }, CTX_SGC);
  ctx.NoConformidades.verificarEficacia({
    nc_id: ok.nc_id, resultado: 'EFICAZ', observaciones: 'Verificado.'
  }, CTX_SGC);
  // Una vencida (detectada hace mucho, sin avanzar).
  crearNc(ctx, { descripcion: 'Vieja sin resolver', fecha_deteccion: '2020-01-01T00:00:00.000Z' });

  const ind = ctx.NoConformidades.listar({}, CTX_SGC).indicadores;
  assert.equal(ind.cerradas, 1);
  assert.equal(ind.abiertas, 1);
  assert.equal(ind.vencidas, 1);
  assert.equal(ind.pct_eficacia_positiva, 100);
  assert.ok(ind.dias_promedio_resolucion !== null);
});

test('el % de eficacia cuenta verificaciones, no NC: cerrar al segundo intento da 50%', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const nc = crearNc(ctx);
  ctx.NoConformidades.registrarCausa({ nc_id: nc.nc_id, porque_1: 'X', causa_raiz: 'Y' }, CTX_SGC);

  function intentar(descripcion, resultado) {
    ctx.NoConformidades.registrarAccion({ nc_id: nc.nc_id, descripcion: descripcion }, CTX_SGC);
    ctx.NoConformidades.cerrarEtapa({ nc_id: nc.nc_id, etapa: 'ACCION' }, CTX_SGC);
    return ctx.NoConformidades.verificarEficacia({
      nc_id: nc.nc_id, resultado: resultado, observaciones: 'Revisado.'
    }, CTX_SGC);
  }
  intentar('Charla al equipo.', 'NO_EFICAZ');
  intentar('Bloqueo en el sistema.', 'EFICAZ');

  const ind = ctx.NoConformidades.listar({}, CTX_SGC).indicadores;
  // Dos verificaciones, una eficaz. Contando por NC daria 100% y el
  // indicador diria que nunca falla nada.
  assert.equal(ind.pct_eficacia_positiva, 50);
  assert.equal(ind.cerradas, 1);
});

// --- avisos con escalado ----------------------------------------------------

test('aviso de vencida: llega al responsable y al Encargado SGC, agrupado', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  crearNc(ctx, { fecha_deteccion: '2020-01-01T00:00:00.000Z' });
  crearNc(ctx, { descripcion: 'Otra vieja', fecha_deteccion: '2020-02-01T00:00:00.000Z' });

  const r = ctx.NoConformidades.recordatorioVencidas();
  assert.ok(r.avisos >= 2);

  const correos = ctx.leerFilas_('LOG_NOTIFICACIONES')
    .filter((l) => String(l.evento || '').indexOf('SGC_NC_VENCIDA') === 0);
  const alResponsable = correos.filter((c) => c.destinatario === 'resp@homepymes.cl');
  assert.equal(alResponsable.length, 1, 'UN correo con las dos, no uno por NC');
  assert.ok(correos.some((c) => c.destinatario === 'sgc@homepymes.cl'));
});

test('aviso de vencida: ESCALA a Direccion cuando lleva varios dias vencida', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  ctx.Calidad.gestionarRol({ usuario_email: 'director@homepymes.cl', rol_sgc: 'DIRECCION' }, CTX_ADM);
  crearNc(ctx, { fecha_deteccion: '2020-01-01T00:00:00.000Z' });

  const r = ctx.NoConformidades.recordatorioVencidas();
  assert.ok(r.escaladas >= 1, 'una NC vencida hace anos debe escalar');
  const correos = ctx.leerFilas_('LOG_NOTIFICACIONES')
    .filter((l) => String(l.evento || '').indexOf('SGC_NC_VENCIDA') === 0);
  assert.ok(correos.some((c) => c.destinatario === 'director@homepymes.cl'),
    'si el responsable no actua, el aviso no puede morir ahi');
});

test('aviso de vencida: una NC dentro de plazo no genera nada', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  crearNc(ctx); // detectada hoy -> 10 dias habiles por delante
  const r = ctx.NoConformidades.recordatorioVencidas();
  assert.equal(r.avisos, 0);
});

test('aviso de vencida: no se repite el mismo dia', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  crearNc(ctx, { fecha_deteccion: '2020-01-01T00:00:00.000Z' });
  ctx.NoConformidades.recordatorioVencidas();
  const primera = ctx.leerFilas_('LOG_NOTIFICACIONES').length;
  ctx.NoConformidades.recordatorioVencidas();
  assert.equal(ctx.leerFilas_('LOG_NOTIFICACIONES').length, primera);
});
