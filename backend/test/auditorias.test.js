'use strict';

// v10.0 Fase 3b (documentacion/SIGSO-v10.0-propuesta-modulo-sgc-iso9001.md):
// auditoria interna (PRO-03, ISO 9001 §9.2). Es la otra mitad del motor de
// mejora: el mecanismo por el que la organizacion encuentra sus propios
// problemas antes de que se los encuentre el auditor de certificacion.
//
// Lo que protegen estos tests, en orden de importancia:
//  1. QUE LA CADENA LLEGUE HASTA EL FINAL: auditoria -> hallazgo -> no
//     conformidad -> actividad en "Mi trabajo". Si se corta en el hallazgo,
//     la auditoria es un acta que nadie ejecuta, que es como mueren los SGC
//     de papel.
//  2. Que no se pueda CERRAR una auditoria con hallazgos de no conformidad
//     sin levantar. Es la regla que obliga a que la cadena se recorra.
//  3. El conflicto de interes (§9.2.2 c): nadie audita su propia area ni se
//     audita a si mismo. Es lo que hace creible la auditoria interna.
//  4. Que el orden del ciclo se respete y que los plazos sean en dias
//     habiles.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'raiz' }
  });
  seedSheet(ctx, 'SGC_AUDITORIAS', ctx.COLUMNAS.SGC_AUDITORIAS);
  seedSheet(ctx, 'SGC_AUD_HALLAZGOS', ctx.COLUMNAS.SGC_AUD_HALLAZGOS);
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
    ['U2', 'Auditor', 'auditor@homepymes.cl', 'HP', 'DEV', true, '', 'sistema'],
    ['U3', 'Auditado', 'auditado@homepymes.cl', 'HP', 'DEV', true, '', 'sistema'],
    ['U4', 'Ajeno', 'ajeno@homepymes.cl', 'HP', 'DEV', true, '', 'sistema']
  ]);
  return ctx;
}

const CTX_SGC = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const CTX_AUDITOR = { email: 'auditor@homepymes.cl', nombre: 'Auditor', rol: 'DEV' };
const CTX_AUDITADO = { email: 'auditado@homepymes.cl', nombre: 'Auditado', rol: 'DEV' };
const CTX_AJENO = { email: 'ajeno@homepymes.cl', nombre: 'Ajeno', rol: 'DEV' };
const CTX_ADM = { email: 'admin@homepymes.cl', nombre: 'Admin', rol: 'ADM' };

// El auditor es de CONTABILIDAD y el area auditada es RRHH: asi el
// escenario base NO tiene conflicto de interes y el conflicto se prueba
// aparte, a proposito.
function sembrar(ctx) {
  ctx.Calidad.gestionarRol({ usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADM);
  ctx.Calidad.gestionarRol({
    usuario_email: 'auditor@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'CONTABILIDAD'
  }, CTX_ADM);
  ctx.Calidad.gestionarRol({
    usuario_email: 'auditado@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'RRHH'
  }, CTX_ADM);
}

function programar(ctx, overrides) {
  return ctx.Auditorias.programar(Object.assign({
    proceso: 'Gestión de personas',
    area_id: 'RRHH',
    auditor_email: 'auditor@homepymes.cl',
    clausulas: ['7.2', '7.5'],
    fecha_programada: '2026-09-01T12:00:00.000Z'
  }, overrides), CTX_SGC);
}

function planificar(ctx, aud, overrides) {
  return ctx.Auditorias.planificar(Object.assign({
    auditoria_id: aud.auditoria_id,
    objetivo: 'Verificar la competencia del personal del área.',
    alcance: 'Fichas y evaluaciones del período 2026.',
    criterios: 'ISO 9001:2015, PRO-02.',
    auditados: ['auditado@homepymes.cl'],
    fecha_ejecucion: '2026-09-15T12:00:00.000Z'
  }, overrides), CTX_SGC);
}

function verificar(ctx, aud, overrides) {
  return ctx.Auditorias.registrarHallazgo(Object.assign({
    auditoria_id: aud.auditoria_id,
    clausula: '7.2',
    aspecto_verificado: 'Evaluaciones de competencia del período.',
    evidencia: 'Se revisaron 8 fichas.',
    resultado: 'CONFORME'
  }, overrides), CTX_AUDITOR);
}

// --- la cadena completa: es lo que hace que la auditoria sirva de algo -----

test('la cadena llega hasta "Mi trabajo": auditoria -> hallazgo -> NC -> actividad', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  planificar(ctx, aud);
  const hallazgo = verificar(ctx, aud, {
    resultado: 'NO_CONFORMIDAD',
    descripcion: 'Tres personas del área no tienen evaluación de competencia vigente.'
  });

  const convertido = ctx.Auditorias.convertirHallazgoEnNc({ hallazgo_id: hallazgo.hallazgo_id }, CTX_SGC);
  assert.ok(convertido.nc, 'debe crear la no conformidad');
  assert.equal(convertido.nc.fuente, 'AUDITORIA_INTERNA');
  assert.equal(convertido.nc.origen_ref, hallazgo.hallazgo_id, 'la NC debe apuntar al hallazgo');
  assert.equal(convertido.nc.area_id, 'RRHH');
  // Por defecto la asume el auditado: es quien responde por el proceso.
  assert.equal(convertido.nc.responsable_email, 'auditado@homepymes.cl');

  // Y desde ahi sigue el ciclo de la Fase 3a hasta una tarea real.
  const conAccion = ctx.NoConformidades.registrarCorreccion({
    nc_id: convertido.nc.nc_id, descripcion: 'Evaluar a las tres personas esta semana.'
  }, CTX_SGC);
  assert.ok(conAccion.correccion_actividad_id, 'la corrección debe ser una ACTIVIDAD real');
  const actividad = ctx.leerFilas_('ACTIVIDADES')
    .find(a => a.actividad_id === conAccion.correccion_actividad_id);
  assert.equal(actividad.responsable_email, 'auditado@homepymes.cl');
  assert.equal(actividad.sgc_origen_tipo, 'NC_CORRECCION');
});

test('el vinculo es bidireccional: el hallazgo muestra su NC en el detalle', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  planificar(ctx, aud);
  const hallazgo = verificar(ctx, aud, {
    resultado: 'NO_CONFORMIDAD', descripcion: 'Falta evidencia de competencia.'
  });
  ctx.Auditorias.convertirHallazgoEnNc({ hallazgo_id: hallazgo.hallazgo_id }, CTX_SGC);

  const detalle = ctx.Auditorias.getDetalle({ auditoria_id: aud.auditoria_id }, CTX_SGC);
  const enDetalle = detalle.hallazgos[0];
  assert.ok(enDetalle.nc_id);
  assert.match(enDetalle.nc_correlativo, /^NC-\d{4}-\d{3}$/);
  assert.equal(enDetalle.nc_estado, 'ABIERTA');
});

test('un hallazgo no se convierte dos veces en no conformidad', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  planificar(ctx, aud);
  const hallazgo = verificar(ctx, aud, {
    resultado: 'NO_CONFORMIDAD', descripcion: 'Falta evidencia.'
  });
  ctx.Auditorias.convertirHallazgoEnNc({ hallazgo_id: hallazgo.hallazgo_id }, CTX_SGC);
  const segunda = ctx.Auditorias.convertirHallazgoEnNc({ hallazgo_id: hallazgo.hallazgo_id }, CTX_SGC);
  assert.equal(segunda._validationError, true);
  assert.equal(ctx.leerFilas_('SGC_NC').length, 1);
});

test('un hallazgo CONFORME no se convierte en no conformidad', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  planificar(ctx, aud);
  const hallazgo = verificar(ctx, aud);
  const r = ctx.Auditorias.convertirHallazgoEnNc({ hallazgo_id: hallazgo.hallazgo_id }, CTX_SGC);
  assert.equal(r._validationError, true);
});

// --- la regla que obliga a recorrer la cadena ------------------------------

test('no se puede cerrar la auditoria con hallazgos de no conformidad sin levantar', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  planificar(ctx, aud);
  verificar(ctx, aud, { resultado: 'NO_CONFORMIDAD', descripcion: 'Sin evaluaciones vigentes.' });
  ctx.Auditorias.cerrarEjecucion({ auditoria_id: aud.auditoria_id }, CTX_AUDITOR);
  ctx.Auditorias.emitirInforme({ auditoria_id: aud.auditoria_id, conclusion: 'El proceso presenta desviaciones.' }, CTX_AUDITOR);

  const bloqueada = ctx.Auditorias.cerrar({ auditoria_id: aud.auditoria_id }, CTX_SGC);
  assert.equal(bloqueada._validationError, true);
  assert.match(bloqueada.message, /7\.2/, 'el mensaje debe decir QUE cláusula falta');

  const hallazgo = ctx.leerFilas_('SGC_AUD_HALLAZGOS')[0];
  ctx.Auditorias.convertirHallazgoEnNc({ hallazgo_id: hallazgo.hallazgo_id }, CTX_SGC);
  const cerrada = ctx.Auditorias.cerrar({ auditoria_id: aud.auditoria_id }, CTX_SGC);
  assert.equal(cerrada.estado, 'CERRADA');
});

test('una OBSERVACION no bloquea el cierre (no toda desviacion es no conformidad)', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  planificar(ctx, aud);
  verificar(ctx, aud, { resultado: 'OBSERVACION', descripcion: 'El registro se lleva en dos planillas.' });
  ctx.Auditorias.cerrarEjecucion({ auditoria_id: aud.auditoria_id }, CTX_AUDITOR);
  ctx.Auditorias.emitirInforme({ auditoria_id: aud.auditoria_id, conclusion: 'Conforme con observaciones.' }, CTX_AUDITOR);
  assert.equal(ctx.Auditorias.cerrar({ auditoria_id: aud.auditoria_id }, CTX_SGC).estado, 'CERRADA');
});

test('el resumen anticipa cuantas NC faltan, antes de intentar cerrar', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  planificar(ctx, aud);
  verificar(ctx, aud, { resultado: 'NO_CONFORMIDAD', descripcion: 'Una.' });
  verificar(ctx, aud, { clausula: '7.5', resultado: 'NO_CONFORMIDAD', descripcion: 'Otra.' });
  const detalle = ctx.Auditorias.getDetalle({ auditoria_id: aud.auditoria_id }, CTX_SGC);
  assert.equal(detalle.resumen.no_conformidades, 2);
  assert.equal(detalle.resumen.nc_pendientes, 2);
});

// --- conflicto de interes (§9.2.2 c) ---------------------------------------

test('nadie audita su propia area', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  // El auditado es de RRHH: no puede auditar RRHH.
  const r = programar(ctx, { auditor_email: 'auditado@homepymes.cl' });
  assert.equal(r._validationError, true);
  assert.match(r.message, /propio trabajo/);
});

test('el auditor no puede estar en la lista de auditados', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  const r = planificar(ctx, aud, { auditados: ['auditado@homepymes.cl', 'auditor@homepymes.cl'] });
  assert.equal(r._validationError, true);
  assert.match(r.message, /si mismo|sí mismo/);
});

test('un auditor de otra area si puede auditar', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  assert.equal(aud.estado, 'PROGRAMADA');
  assert.equal(aud.auditor_email, 'auditor@homepymes.cl');
});

// --- el ciclo y su orden ----------------------------------------------------

test('el ciclo completo recorre programada -> planificada -> ejecutada -> informada -> cerrada', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  assert.equal(aud.estado, 'PROGRAMADA');
  assert.match(aud.correlativo, /^AI-2026-001$/);

  assert.equal(planificar(ctx, aud).estado, 'PLANIFICADA');
  verificar(ctx, aud);
  assert.equal(ctx.Auditorias.cerrarEjecucion({ auditoria_id: aud.auditoria_id }, CTX_AUDITOR).estado, 'EJECUTADA');
  assert.equal(ctx.Auditorias.emitirInforme({
    auditoria_id: aud.auditoria_id, conclusion: 'El proceso cumple los requisitos verificados.'
  }, CTX_AUDITOR).estado, 'INFORMADA');
  assert.equal(ctx.Auditorias.cerrar({ auditoria_id: aud.auditoria_id }, CTX_SGC).estado, 'CERRADA');
});

test('no se registran hallazgos antes de planificar', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  const r = verificar(ctx, aud);
  assert.equal(r._validationError, true);
  assert.match(r.message, /planifica/i);
});

test('no se cierra la ejecucion sin lista de verificacion', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  planificar(ctx, aud);
  const r = ctx.Auditorias.cerrarEjecucion({ auditoria_id: aud.auditoria_id }, CTX_AUDITOR);
  assert.equal(r._validationError, true);
});

test('el informe se emite despues de ejecutar, no antes', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  planificar(ctx, aud);
  verificar(ctx, aud);
  const r = ctx.Auditorias.emitirInforme({ auditoria_id: aud.auditoria_id, conclusion: 'X' }, CTX_AUDITOR);
  assert.equal(r._validationError, true);
});

test('emitido el informe, la lista de verificacion queda cerrada', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  planificar(ctx, aud);
  verificar(ctx, aud);
  ctx.Auditorias.cerrarEjecucion({ auditoria_id: aud.auditoria_id }, CTX_AUDITOR);
  ctx.Auditorias.emitirInforme({ auditoria_id: aud.auditoria_id, conclusion: 'Conforme.' }, CTX_AUDITOR);
  const r = verificar(ctx, aud, { clausula: '7.5' });
  assert.equal(r._validationError, true);
});

test('el plazo del informe son 10 dias HABILES desde la ejecucion', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  planificar(ctx, aud);
  verificar(ctx, aud);
  const ejecutada = ctx.Auditorias.cerrarEjecucion({ auditoria_id: aud.auditoria_id }, CTX_AUDITOR);
  const dias = Math.round((new Date(ejecutada.informe_plazo) - new Date()) / 86400000);
  // 10 hábiles caen entre 13 y 15 corridos según el día de la semana (y más
  // si hay feriados); lo que se protege es que NO sean 10 corridos.
  assert.ok(dias >= 12 && dias <= 20, `plazo inesperado: ${dias} días corridos`);
});

// --- lista de verificacion ---------------------------------------------------

test('una clausula CONFORME tambien se registra: es evidencia de que se reviso', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  planificar(ctx, aud);
  verificar(ctx, aud);
  const detalle = ctx.Auditorias.getDetalle({ auditoria_id: aud.auditoria_id }, CTX_SGC);
  assert.equal(detalle.resumen.verificaciones, 1);
  assert.equal(detalle.resumen.conformes, 1);
  assert.equal(detalle.hallazgos[0].clausula_titulo, 'Competencia');
});

test('un hallazgo no conforme exige descripcion', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  planificar(ctx, aud);
  const r = verificar(ctx, aud, { resultado: 'NO_CONFORMIDAD', descripcion: '  ' });
  assert.equal(r._validationError, true);
});

test('la clausula tiene que existir en la norma', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  planificar(ctx, aud);
  const r = verificar(ctx, aud, { clausula: '99.9' });
  assert.equal(r._validationError, true);
});

test('los hallazgos se ordenan por numero de clausula, no por texto', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx, { clausulas: ['7.2', '9.2', '10.2'] });
  planificar(ctx, aud);
  verificar(ctx, aud, { clausula: '10.2' });
  verificar(ctx, aud, { clausula: '9.2' });
  verificar(ctx, aud, { clausula: '7.2' });
  const detalle = ctx.Auditorias.getDetalle({ auditoria_id: aud.auditoria_id }, CTX_SGC);
  // Ordenando como texto, "10.2" quedaría primero.
  assert.deepEqual(detalle.hallazgos.map(h => h.clausula), ['7.2', '9.2', '10.2']);
});

test('un hallazgo ya convertido en NC no cambia de resultado', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  planificar(ctx, aud);
  const hallazgo = verificar(ctx, aud, { resultado: 'NO_CONFORMIDAD', descripcion: 'Falta.' });
  ctx.Auditorias.convertirHallazgoEnNc({ hallazgo_id: hallazgo.hallazgo_id }, CTX_SGC);
  const r = ctx.Auditorias.registrarHallazgo({
    auditoria_id: aud.auditoria_id, hallazgo_id: hallazgo.hallazgo_id,
    clausula: '7.2', aspecto_verificado: 'Otro texto.', resultado: 'CONFORME'
  }, CTX_SGC);
  assert.equal(r._validationError, true);
});

test('un hallazgo con NC no se puede eliminar', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  planificar(ctx, aud);
  const hallazgo = verificar(ctx, aud, { resultado: 'NO_CONFORMIDAD', descripcion: 'Falta.' });
  ctx.Auditorias.convertirHallazgoEnNc({ hallazgo_id: hallazgo.hallazgo_id }, CTX_SGC);
  assert.equal(ctx.Auditorias.eliminarHallazgo({ hallazgo_id: hallazgo.hallazgo_id }, CTX_SGC)._validationError, true);
});

// --- permisos ----------------------------------------------------------------

test('el auditor asignado registra hallazgos aunque no gobierne el SGC', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  planificar(ctx, aud);
  const h = verificar(ctx, aud);
  assert.ok(h.hallazgo_id, 'el auditor tiene que poder auditar');
});

test('un tercero no registra hallazgos en una auditoria ajena', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  planificar(ctx, aud);
  const r = ctx.Auditorias.registrarHallazgo({
    auditoria_id: aud.auditoria_id, clausula: '7.2',
    aspecto_verificado: 'X', resultado: 'CONFORME'
  }, CTX_AJENO);
  assert.equal(r._forbidden, true);
});

test('el auditado ve la auditoria de su area, el ajeno no', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  planificar(ctx, aud);
  assert.ok(ctx.Auditorias.getDetalle({ auditoria_id: aud.auditoria_id }, CTX_AUDITADO).auditoria);
  assert.equal(ctx.Auditorias.getDetalle({ auditoria_id: aud.auditoria_id }, CTX_AJENO)._forbidden, true);
  assert.equal(ctx.Auditorias.listar({}, CTX_AJENO).auditorias.length, 0);
});

test('solo el Encargado SGC levanta la no conformidad, no el auditor', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  planificar(ctx, aud);
  const hallazgo = verificar(ctx, aud, { resultado: 'NO_CONFORMIDAD', descripcion: 'Falta.' });
  assert.equal(
    ctx.Auditorias.convertirHallazgoEnNc({ hallazgo_id: hallazgo.hallazgo_id }, CTX_AUDITOR)._forbidden,
    true
  );
});

test('una auditoria se anula con motivo, nunca se borra', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  assert.equal(ctx.Auditorias.anular({ auditoria_id: aud.auditoria_id }, CTX_SGC)._validationError, true);
  const anulada = ctx.Auditorias.anular({ auditoria_id: aud.auditoria_id, motivo: 'Duplicada.' }, CTX_SGC);
  assert.equal(anulada.estado, 'ANULADA');
  assert.equal(ctx.leerFilas_('SGC_AUDITORIAS').length, 1,
    'borrar una auditoría es justo lo que un auditor busca que no se pueda');
});

// --- indicadores y avisos ----------------------------------------------------

test('el % de cumplimiento del programa anual cuenta ejecutadas sobre programadas', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const anio = new Date().getFullYear();
  const a1 = programar(ctx, { fecha_programada: `${anio}-03-01T12:00:00.000Z`, proceso: 'Uno' });
  programar(ctx, { fecha_programada: `${anio}-06-01T12:00:00.000Z`, proceso: 'Dos' });
  planificar(ctx, a1, { fecha_ejecucion: `${anio}-03-15T12:00:00.000Z` });
  verificar(ctx, a1);
  ctx.Auditorias.cerrarEjecucion({ auditoria_id: a1.auditoria_id }, CTX_AUDITOR);

  const ind = ctx.Auditorias.listar({}, CTX_SGC).indicadores;
  assert.equal(ind.programadas, 2);
  assert.equal(ind.ejecutadas, 1);
  assert.equal(ind.pct_cumplimiento, 50);
});

test('aviso: el informe fuera del plazo de 10 dias habiles llega al auditor y al Encargado', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  planificar(ctx, aud);
  verificar(ctx, aud);
  ctx.Auditorias.cerrarEjecucion({ auditoria_id: aud.auditoria_id }, CTX_AUDITOR);
  // Se fuerza el vencimiento del plazo.
  ctx.actualizarFilaPorId_('SGC_AUDITORIAS', 'auditoria_id', aud.auditoria_id, {
    informe_plazo: '2020-01-01T00:00:00.000Z'
  });

  const r = ctx.Auditorias.recordatorioPendientes();
  assert.ok(r.avisos >= 2, 'auditor y Encargado SGC');
  const destinos = ctx.leerFilas_('LOG_NOTIFICACIONES').map(n => n.destinatario);
  assert.ok(destinos.includes('auditor@homepymes.cl'));
  assert.ok(destinos.includes('sgc@homepymes.cl'));
});

test('aviso: no se repite el mismo dia', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  planificar(ctx, aud);
  verificar(ctx, aud);
  ctx.Auditorias.cerrarEjecucion({ auditoria_id: aud.auditoria_id }, CTX_AUDITOR);
  ctx.actualizarFilaPorId_('SGC_AUDITORIAS', 'auditoria_id', aud.auditoria_id, {
    informe_plazo: '2020-01-01T00:00:00.000Z'
  });
  ctx.Auditorias.recordatorioPendientes();
  assert.equal(ctx.Auditorias.recordatorioPendientes().avisos, 0);
});

test('aviso: un proceso sin auditar en 12 meses le llega al Encargado SGC', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx, { fecha_programada: '2024-01-10T12:00:00.000Z' });
  planificar(ctx, aud, { fecha_ejecucion: '2024-01-20T12:00:00.000Z' });
  verificar(ctx, aud);
  ctx.Auditorias.cerrarEjecucion({ auditoria_id: aud.auditoria_id }, CTX_AUDITOR);
  // cerrarEjecucion pone la fecha del plan; se deja explícitamente vieja.
  ctx.actualizarFilaPorId_('SGC_AUDITORIAS', 'auditoria_id', aud.auditoria_id, {
    fecha_ejecucion: '2024-01-20T12:00:00.000Z', informe_plazo: ''
  });

  const r = ctx.Auditorias.recordatorioPendientes();
  assert.equal(r.sin_auditar, 1);
  const destinos = ctx.leerFilas_('LOG_NOTIFICACIONES').map(n => n.destinatario);
  assert.ok(destinos.includes('sgc@homepymes.cl'));
});

test('un proceso con auditoria programada a futuro no cuenta como atrasado', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const vieja = programar(ctx, { fecha_programada: '2024-01-10T12:00:00.000Z' });
  planificar(ctx, vieja, { fecha_ejecucion: '2024-01-20T12:00:00.000Z' });
  verificar(ctx, vieja);
  ctx.Auditorias.cerrarEjecucion({ auditoria_id: vieja.auditoria_id }, CTX_AUDITOR);
  ctx.actualizarFilaPorId_('SGC_AUDITORIAS', 'auditoria_id', vieja.auditoria_id, {
    fecha_ejecucion: '2024-01-20T12:00:00.000Z', informe_plazo: ''
  });
  // Mismo proceso, ya reprogramado: el programa anual justamente sirve para esto.
  programar(ctx, { fecha_programada: '2026-11-01T12:00:00.000Z' });

  assert.equal(ctx.Auditorias.recordatorioPendientes().sin_auditar, 0);
});

// --- validaciones de entrada ------------------------------------------------

test('programar exige proceso, fecha, auditor y al menos una clausula', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  assert.equal(programar(ctx, { proceso: '  ' })._validationError, true);
  assert.equal(programar(ctx, { fecha_programada: '' })._validationError, true);
  assert.equal(programar(ctx, { auditor_email: '' })._validationError, true);
  assert.equal(programar(ctx, { clausulas: [] })._validationError, true);
  assert.equal(programar(ctx, { clausulas: ['inventada'] })._validationError, true);
});

test('planificar exige objetivo, alcance y fecha de ejecucion', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  assert.equal(planificar(ctx, aud, { objetivo: '' })._validationError, true);
  assert.equal(planificar(ctx, aud, { alcance: '' })._validationError, true);
  assert.equal(planificar(ctx, aud, { fecha_ejecucion: '' })._validationError, true);
});

test('el informe exige conclusion escrita', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  planificar(ctx, aud);
  verificar(ctx, aud);
  ctx.Auditorias.cerrarEjecucion({ auditoria_id: aud.auditoria_id }, CTX_AUDITOR);
  assert.equal(ctx.Auditorias.emitirInforme({ auditoria_id: aud.auditoria_id, conclusion: '  ' }, CTX_AUDITOR)._validationError, true);
});

test('una celda de clausulas corrupta no tumba el listado', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const aud = programar(ctx);
  ctx.actualizarFilaPorId_('SGC_AUDITORIAS', 'auditoria_id', aud.auditoria_id, {
    clausulas: 'esto no es json', auditados: '{roto'
  });
  const listado = ctx.Auditorias.listar({}, CTX_SGC);
  assert.equal(listado.auditorias.length, 1);
  // Los arreglos vienen del sandbox (otro realm), así que se compara el
  // largo y no la referencia del prototipo.
  assert.equal(listado.auditorias[0].clausulas.length, 0);
});
