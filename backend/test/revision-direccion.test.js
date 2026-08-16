'use strict';

// v10.0 Fase 5b — revision por la direccion (PRO-05, §9.3).
//
// Lo que protegen estos tests:
//  1. Que el sistema PRELLENE las entradas que puede responder solo con sus
//     datos (acuerdos previos, quejas, NC, auditorias, proveedores). Es lo
//     que evita que la revision sea "juntar carpetas la semana antes".
//  2. Que las 13 entradas de §9.3.2 sean obligatorias: dejar una en blanco
//     es exactamente el hallazgo que un auditor levanta.
//  3. Que los acuerdos SEAN actividades reales de "Mi trabajo".
//  4. Que no se pueda cerrar sin acuerdos (§9.3.3 exige decisiones) ni sin
//     conclusiones (PRO-05 §6.2).
//  5. Que el plazo de convocatoria sean 10 dias HABILES hacia atras.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'raiz' }
  });
  ['SGC_REVISIONES', 'SGC_REVISION_ACUERDOS', 'SGC_ROLES', 'SGC_NC', 'SGC_AUDITORIAS',
    'SGC_AUD_HALLAZGOS', 'SGC_QUEJAS', 'SGC_PROVEEDORES', 'SGC_PROVEEDOR_EVALUACIONES',
    'ACTIVIDADES', 'ACTIVIDADES_BITACORA', 'LOG_SISTEMA', 'LOG_NOTIFICACIONES',
    'NOTIFICACIONES_APP', 'CONFIG_NOTIFICACIONES', 'CONFIG_FERIADOS', 'USUARIOS', 'JEFATURAS']
    .forEach((h) => seedSheet(ctx, h, ctx.COLUMNAS[h]));
  return ctx;
}

const CTX_ENCARGADO = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const CTX_GERENCIA = { email: 'gerencia@homepymes.cl', nombre: 'Gerencia', rol: 'GERENCIA' };
const CTX_OPERATIVO = { email: 'operativo@homepymes.cl', nombre: 'Operativo', rol: 'DEV' };
const CTX_ADM = { email: 'admin@homepymes.cl', nombre: 'Admin', rol: 'ADM' };

function sembrarRoles(ctx) {
  ctx.Calidad.gestionarRol({ usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADM);
  ctx.Calidad.gestionarRol({ usuario_email: 'operativo@homepymes.cl', rol_sgc: 'OPERATIVO' }, CTX_ADM);
}

function programar(ctx, overrides, contexto) {
  return ctx.RevisionDireccion.programar(Object.assign({
    fecha_programada: '2026-11-20T00:00:00.000Z',
    director_email: 'director@homepymes.cl'
  }, overrides), contexto || CTX_ENCARGADO);
}

// Las 13 observaciones completas, para los tests que no prueban validacion.
function entradasCompletas(texto) {
  const salida = {};
  for (let i = 1; i <= 13; i++) salida[i] = (texto || 'Observación del tema ') + i;
  return salida;
}

function registrarActa(ctx, revision, overrides) {
  return ctx.RevisionDireccion.registrarActa(Object.assign({
    revision_id: revision.revision_id,
    fecha_reunion: '2026-11-20T00:00:00.000Z',
    asistentes: [{ nombre: 'Rogelio Álvarez', cargo: 'Director' }],
    entradas: entradasCompletas(),
    conclusiones: 'El SGC es adecuado y eficaz; hay recursos para las mejoras propuestas.'
  }, overrides), CTX_ENCARGADO);
}

// --- programar y convocar ---------------------------------------------------

test('programar: correlativo por año y plazo de convocatoria 10 días HÁBILES antes', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);

  const r = programar(ctx);
  assert.equal(r.correlativo, 'RD-2026-01');
  assert.equal(r.estado, 'PROGRAMADA');

  // 2026-11-20 es viernes. Restando días HÁBILES (no corridos, que darían
  // 2026-11-10) el plazo cae en 2026-11-05.
  //
  // Son 11 días hábiles hacia atrás y no 10 porque el día de partida se
  // resuelve en la zona horaria del sistema (America/Santiago), donde la
  // medianoche UTC del 20 todavía es el 19 — la misma convención que usa
  // sumarDiasHabilesSgc_ en el resto de SIGSO. Para un plazo de "avisar con
  // AL MENOS 10 días hábiles" quedar un día antes es el lado seguro.
  assert.equal(String(r.aviso_plazo).slice(0, 10), '2026-11-05');
  assert.ok(new Date(r.aviso_plazo) < new Date(r.fecha_programada),
    'el plazo de aviso siempre va antes de la reunión');

  const segunda = programar(ctx, { fecha_programada: '2026-12-01T00:00:00.000Z' });
  assert.equal(segunda.correlativo, 'RD-2026-02');
});

test('programar: exige fecha válida y solo la maneja el Encargado SGC', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  assert.equal(programar(ctx, { fecha_programada: '' })._validationError, true);
  assert.equal(programar(ctx, { fecha_programada: 'no-es-fecha' })._validationError, true);
  assert.equal(programar(ctx, {}, CTX_OPERATIVO)._forbidden, true);
});

test('convocar: manda la agenda con los 13 temas de la norma y exige destinatarios', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const r = programar(ctx);

  assert.equal(ctx.RevisionDireccion.convocar({
    revision_id: r.revision_id, asistentes: [{ nombre: 'X', cargo: 'Y' }], correos: []
  }, CTX_ENCARGADO)._validationError, true, 'sin correos no se cumple PRO-05 §6');

  const ok = ctx.RevisionDireccion.convocar({
    revision_id: r.revision_id,
    asistentes: [{ nombre: 'Rogelio Álvarez', cargo: 'Director' }],
    correos: ['director@homepymes.cl', 'gerencia@homepymes.cl']
  }, CTX_ENCARGADO);

  assert.equal(ok.estado, 'CONVOCADA');
  assert.equal(ctx.MailApp._enviados.length, 2);
  const cuerpo = String(ctx.MailApp._enviados[0].cuerpo);
  assert.match(cuerpo, /El estado de las acciones de las revisiones por la dirección previas/);
  assert.match(cuerpo, /13\. El desempeño de los proveedores externos/);
});

test('convocar: acepta los asistentes como texto "Nombre - Cargo" por línea', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const r = programar(ctx);
  const ok = ctx.RevisionDireccion.convocar({
    revision_id: r.revision_id,
    asistentes: 'Rogelio Álvarez - Director\nBárbara Álvarez - Gerente de Administración',
    correos: ['director@homepymes.cl']
  }, CTX_ENCARGADO);

  const guardados = JSON.parse(ok.asistentes);
  assert.equal(guardados.length, 2);
  assert.equal(guardados[1].nombre, 'Bárbara Álvarez');
  assert.equal(guardados[1].cargo, 'Gerente de Administración');
});

// --- el prellenado automático (lo distintivo de la fase) --------------------

test('resumen automático: la primera revisión declara que no hay acuerdos previos', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const r = programar(ctx);

  const resumen = ctx.RevisionDireccion.getResumenAutomatico({ revision_id: r.revision_id }, CTX_ENCARGADO).resumen;
  assert.match(resumen[1], /primera revisión/i);
});

test('resumen automático: item 7 resume las quejas del período con su conformidad', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  seedSheet(ctx, 'SGC_QUEJAS', ctx.COLUMNAS.SGC_QUEJAS, [
    ['Q1', 'Q-2026-001', 'Cliente A', '', '', 'a@x.cl', '', 'QUEJA', 'CONTABILIDAD', 'd', 'WEB',
      '2026-03-01T00:00:00.000Z', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
      '2026-05-01T00:00:00.000Z', true, 'CERRADA', '', '', '2026-03-01T00:00:00.000Z', true],
    ['Q2', 'Q-2026-002', 'Cliente B', '', '', 'b@x.cl', '', 'FELICITACION', 'RRHH', 'd', 'WEB',
      '2026-04-01T00:00:00.000Z', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
      '', '', 'RECIBIDA', '', '', '2026-04-01T00:00:00.000Z', true]
  ]);
  const r = programar(ctx);

  const resumen = ctx.RevisionDireccion.getResumenAutomatico({ revision_id: r.revision_id }, CTX_ENCARGADO).resumen;
  assert.match(resumen[7], /2 mensajes/);
  assert.match(resumen[7], /1 quejas/);
  assert.match(resumen[7], /1 felicitaciones/);
  assert.match(resumen[7], /1 de 1 clientes quedaron conformes/);
});

test('resumen automático: items 10, 12 y 13 traen NC, auditorías y proveedores', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);

  // Una NC cerrada y eficaz, del periodo.
  seedSheet(ctx, 'SGC_NC', ctx.COLUMNAS.SGC_NC, [
    ['NC1', 'NC-2026-001', 'AUDITORIA', '', '9.2', 'desc', 'CALIDAD', 'x@y.cl',
      '2026-02-01T00:00:00.000Z', 'r@y.cl', 'CERRADA', 1, '', '', '', '', '', '', '', '', '',
      '', '', '', '', '', '', '', 'EFICAZ', '', '2026-06-01T00:00:00.000Z', 'x@y.cl',
      '2026-02-01T00:00:00.000Z', true]
  ]);
  seedSheet(ctx, 'SGC_AUDITORIAS', ctx.COLUMNAS.SGC_AUDITORIAS, [
    ['AUD1', 'AI-2026-01', 2026, 'CALIDAD', 'Proceso X', '', 'aud@y.cl', '', '', '', '', '',
      '2026-05-01T00:00:00.000Z', '', '2026-05-10T00:00:00.000Z', 'CERRADA', '', '', '', '', '', '',
      'x@y.cl', '2026-01-01T00:00:00.000Z', true]
  ]);
  seedSheet(ctx, 'SGC_AUD_HALLAZGOS', ctx.COLUMNAS.SGC_AUD_HALLAZGOS, [
    ['H1', 'AUD1', '9.2', 'algo', 'ev', 'NO_CONFORMIDAD', 'desc', 'NC1', 'aud@y.cl',
      '2026-05-10T00:00:00.000Z', true],
    ['H2', 'AUD1', '9.3', 'otra', 'ev', 'CONFORME', '', '', 'aud@y.cl',
      '2026-05-10T00:00:00.000Z', true]
  ]);
  seedSheet(ctx, 'SGC_PROVEEDORES', ctx.COLUMNAS.SGC_PROVEEDORES, [
    ['P1', 'Proveedor Bueno', '1-1', 'Insumos', '', '', '', '', false, 'APROBADO',
      '2026-02-01', 9, 'BUENO', '2027-02-01', 'x@y.cl', '2026-01-01T00:00:00.000Z', true],
    ['P2', 'Proveedor Malo', '2-2', 'Servicios', '', '', '', '', false, 'REPROBADO',
      '2026-02-01', 3, 'MALO', '2027-02-01', 'x@y.cl', '2026-01-01T00:00:00.000Z', true]
  ]);

  const r = programar(ctx);
  const resumen = ctx.RevisionDireccion.getResumenAutomatico({ revision_id: r.revision_id }, CTX_ENCARGADO).resumen;

  assert.match(resumen[10], /1 no conformidades/);
  assert.match(resumen[10], /1 cerradas/);
  assert.match(resumen[10], /1 verificaron su acción correctiva como eficaz/);

  assert.match(resumen[12], /1 auditoría\(s\), 1 ejecutada/);
  assert.match(resumen[12], /2 hallazgos/);
  assert.match(resumen[12], /1 fueron no conformidades/);

  assert.match(resumen[13], /2 proveedores/);
  assert.match(resumen[13], /1 aprobados/);
  assert.match(resumen[13], /1 reprobados/);
  assert.match(resumen[13], /requieren decisión de la Dirección/);
});

test('resumen automático: sin datos lo dice explícitamente, no deja el tema en blanco', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const r = programar(ctx);
  const resumen = ctx.RevisionDireccion.getResumenAutomatico({ revision_id: r.revision_id }, CTX_ENCARGADO).resumen;

  assert.match(resumen[7], /no se recibieron quejas/i);
  assert.match(resumen[10], /no se levantaron no conformidades/i);
  assert.match(resumen[12], /no se registraron auditorías/i);
  assert.match(resumen[13], /No hay proveedores externos registrados/i);
});

test('el catálogo declara qué entradas resuelve el sistema y cuál espera a la Fase 6', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const r = programar(ctx);
  const detalle = ctx.RevisionDireccion.getDetalle({ revision_id: r.revision_id }, CTX_ENCARGADO);

  assert.equal(detalle.catalogo_entradas.length, 13, 'las 13 entradas de §9.3.2');
  const auto = detalle.catalogo_entradas.filter((e) => e.auto).map((e) => e.numero);
  assert.deepEqual(toPlain(auto), [1, 7, 10, 12, 13]);

  const objetivos = detalle.catalogo_entradas.filter((e) => e.numero === 8)[0];
  assert.match(objetivos.pendiente_fase, /objetivos de calidad/i,
    'el ítem 8 debe quedar declarado como pendiente, no como si no aplicara');
});

// --- el acta ----------------------------------------------------------------

test('registrarActa: las 13 entradas son obligatorias (§9.3.2)', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const r = programar(ctx);

  const incompletas = entradasCompletas();
  delete incompletas[4];
  const fallo = registrarActa(ctx, r, { entradas: incompletas });
  assert.equal(fallo._validationError, true);
  assert.match(fallo.message, /4/, 'debe decir cuál falta');

  assert.equal(registrarActa(ctx, r, { asistentes: [] })._validationError, true);
  assert.equal(registrarActa(ctx, r).estado, 'REALIZADA');
});

test('registrarActa: guarda las 13 observaciones y se leen de vuelta en orden', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const r = programar(ctx);
  registrarActa(ctx, r);

  const detalle = ctx.RevisionDireccion.getDetalle({ revision_id: r.revision_id }, CTX_ENCARGADO);
  assert.equal(detalle.entradas.length, 13);
  assert.equal(detalle.entradas[0].numero, 1);
  assert.equal(detalle.entradas[12].observaciones, 'Observación del tema 13');
  assert.equal(detalle.revision.entradas_completas, 13);
});

// --- acuerdos = actividades --------------------------------------------------

test('registrarAcuerdo: crea una ACTIVIDAD real para el responsable', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const r = programar(ctx);
  registrarActa(ctx, r);

  const resultado = ctx.RevisionDireccion.registrarAcuerdo({
    revision_id: r.revision_id,
    tipo: 'RECURSOS',
    observaciones: 'Contratar un prevencionista adicional para el segundo semestre.',
    responsable_email: 'barbara@homepymes.cl',
    plazo: '2027-03-31T00:00:00.000Z'
  }, CTX_ENCARGADO);

  assert.ok(!resultado._validationError, resultado.message || '');
  assert.ok(resultado.tarea, 'debe crear la actividad');
  assert.equal(resultado.tarea.responsable_email, 'barbara@homepymes.cl');

  // Existe de verdad en ACTIVIDADES, con la marca de origen del SGC.
  const act = ctx.leerFilas_('ACTIVIDADES').filter((a) => a.actividad_id === resultado.acuerdo.actividad_id)[0];
  assert.ok(act, 'la actividad debe existir en la hoja');
  assert.equal(act.sgc_origen_tipo, 'REVISION_ACUERDO');
  assert.equal(act.sgc_origen_id, r.revision_id);
  assert.match(String(act.titulo), /Acuerdo de revisión por la dirección/);
});

test('registrarAcuerdo: exige tipo válido, responsable y plazo (columnas del formulario)', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const r = programar(ctx);
  const base = {
    revision_id: r.revision_id, tipo: 'MEJORA',
    observaciones: 'Una descripción suficientemente larga.',
    responsable_email: 'x@y.cl', plazo: '2027-01-31T00:00:00.000Z'
  };

  assert.equal(ctx.RevisionDireccion.registrarAcuerdo(
    Object.assign({}, base, { tipo: 'INVENTADO' }), CTX_ENCARGADO)._validationError, true);
  assert.equal(ctx.RevisionDireccion.registrarAcuerdo(
    Object.assign({}, base, { responsable_email: '' }), CTX_ENCARGADO)._validationError, true);
  assert.equal(ctx.RevisionDireccion.registrarAcuerdo(
    Object.assign({}, base, { plazo: '' }), CTX_ENCARGADO)._validationError, true);
  assert.equal(ctx.RevisionDireccion.registrarAcuerdo(
    Object.assign({}, base, { observaciones: 'corto' }), CTX_ENCARGADO)._validationError, true);

  assert.ok(!ctx.RevisionDireccion.registrarAcuerdo(base, CTX_ENCARGADO)._validationError);
});

// --- cierre -----------------------------------------------------------------

test('cerrar: no se puede sin acuerdos -- §9.3.3 exige decisiones y acciones', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const r = programar(ctx);
  registrarActa(ctx, r);

  const sinAcuerdos = ctx.RevisionDireccion.cerrar({ revision_id: r.revision_id }, CTX_ENCARGADO);
  assert.equal(sinAcuerdos._validationError, true);
  assert.match(sinAcuerdos.message, /9\.3\.3/);

  ctx.RevisionDireccion.registrarAcuerdo({
    revision_id: r.revision_id, tipo: 'MEJORA',
    observaciones: 'Mejorar el control documental del SGC.',
    responsable_email: 'x@y.cl', plazo: '2027-01-31T00:00:00.000Z'
  }, CTX_ENCARGADO);

  assert.equal(ctx.RevisionDireccion.cerrar({ revision_id: r.revision_id }, CTX_ENCARGADO).estado, 'CERRADA');
});

test('cerrar: exige acta previa y conclusiones (PRO-05 §6.2)', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const r = programar(ctx);

  assert.equal(ctx.RevisionDireccion.cerrar({ revision_id: r.revision_id }, CTX_ENCARGADO)._validationError,
    true, 'sin acta no se cierra');

  registrarActa(ctx, r, { conclusiones: '' });
  ctx.RevisionDireccion.registrarAcuerdo({
    revision_id: r.revision_id, tipo: 'MEJORA',
    observaciones: 'Una mejora concreta y suficientemente descrita.',
    responsable_email: 'x@y.cl', plazo: '2027-01-31T00:00:00.000Z'
  }, CTX_ENCARGADO);

  const sinConclusiones = ctx.RevisionDireccion.cerrar({ revision_id: r.revision_id }, CTX_ENCARGADO);
  assert.equal(sinConclusiones._validationError, true);
  assert.match(sinConclusiones.message, /adecuado y eficaz/);
});

// --- la revisión siguiente ve la anterior ------------------------------------

test('resumen automático: el item 1 reporta los acuerdos de la revisión anterior y si se cumplieron', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);

  const anterior = programar(ctx, { fecha_programada: '2025-11-20T00:00:00.000Z' });
  registrarActa(ctx, anterior, { fecha_reunion: '2025-11-20T00:00:00.000Z' });
  ctx.RevisionDireccion.registrarAcuerdo({
    revision_id: anterior.revision_id, tipo: 'MEJORA',
    observaciones: 'Acuerdo del año pasado que quedó pendiente.',
    responsable_email: 'x@y.cl', plazo: '2026-06-30T00:00:00.000Z'
  }, CTX_ENCARGADO);
  ctx.RevisionDireccion.cerrar({ revision_id: anterior.revision_id }, CTX_ENCARGADO);

  const actual = programar(ctx);
  const resumen = ctx.RevisionDireccion.getResumenAutomatico({ revision_id: actual.revision_id }, CTX_ENCARGADO).resumen;

  assert.match(resumen[1], /RD-2025-01/);
  assert.match(resumen[1], /1 acuerdo\(s\)/);
  assert.match(resumen[1], /0 cumplido\(s\)/);
  assert.match(resumen[1], /1 pendiente\(s\)/);
});

// --- alertas y permisos ------------------------------------------------------

test('recordatorio: avisa que falta convocar cuando se pasó el plazo de 10 días hábiles', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  // Reunion pasado mañana: el plazo de convocatoria ya venció.
  const pronto = new Date(Date.now() + 2 * 86400000).toISOString();
  programar(ctx, { fecha_programada: pronto });

  const r = ctx.RevisionDireccion.recordatorioPendientes();
  assert.equal(r.convocatoria_pendiente, 1);

  const correos = ctx.leerFilas_('LOG_NOTIFICACIONES')
    .filter((n) => String(n.evento || '').indexOf('SGC_REVISION_CONVOCAR') === 0);
  assert.equal(correos.length, 1);
});

test('recordatorio: si nunca hubo revisión, la frecuencia está vencida (no "al día")', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);

  const r = ctx.RevisionDireccion.recordatorioPendientes();
  assert.equal(r.frecuencia_vencida, true);

  const vista = ctx.RevisionDireccion.listar({}, CTX_ENCARGADO);
  assert.equal(vista.vigencia.vencida, true);
  assert.equal(vista.vigencia.ultima_fecha, '');
});

test('listar: Gerencia puede leer la revisión (la ejecuta la Dirección) pero no gestionarla', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  programar(ctx);

  const vista = ctx.RevisionDireccion.listar({}, CTX_GERENCIA);
  assert.ok(!vista._forbidden);
  assert.equal(vista.puede_gestionar, false);
  assert.equal(vista.revisiones.length, 1);

  assert.equal(ctx.RevisionDireccion.listar({}, CTX_OPERATIVO)._forbidden, true);
});

test('anular: exige motivo y saca la revisión del listado sin borrarla', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const r = programar(ctx);

  assert.equal(ctx.RevisionDireccion.anular({ revision_id: r.revision_id, motivo: 'no' }, CTX_ENCARGADO)._validationError, true);
  ctx.RevisionDireccion.anular({ revision_id: r.revision_id, motivo: 'Se reprograma para el próximo año.' }, CTX_ENCARGADO);

  assert.equal(ctx.RevisionDireccion.listar({}, CTX_ENCARGADO).revisiones.length, 0);
  assert.equal(ctx.leerFilas_('SGC_REVISIONES').length, 1, 'la fila se conserva');
});
