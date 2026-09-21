'use strict';

/**
 * Prueba de portabilidad: SGC ISO 9001 Fase 5b (PRO-05, revisión por la
 * dirección) -- mismos escenarios de revision-direccion.test.js, corridos
 * contra backend/logica/revisionDireccionSgc.js. Objetivos (Fase 6a) ya
 * está portado, así que el ítem 8 del catálogo se prueba resuelto (auto),
 * igual que el `.gs` original.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('../logica/calidadSgc');
const RevisionDireccion = require('../logica/revisionDireccionSgc');
const Resend = require('../logica/resend');

const TABLAS = [
  'SGC_REVISIONES', 'SGC_REVISION_ACUERDOS', 'SGC_ROLES', 'SGC_NC', 'SGC_AUDITORIAS',
  'SGC_AUD_HALLAZGOS', 'SGC_QUEJAS', 'SGC_PROVEEDORES', 'SGC_PROVEEDOR_EVALUACIONES',
  'SGC_OBJETIVOS', 'SGC_INDICADOR_LECTURAS', 'SGC_PERSONAS', 'SGC_CAPACITACIONES', 'SGC_CAPACITACION_ASISTENTES',
  'ACTIVIDADES', 'ACTIVIDADES_BITACORA', 'LOG_SISTEMA', 'LOG_NOTIFICACIONES',
  'NOTIFICACIONES_APP', 'CONFIG_NOTIFICACIONES', 'CONFIG_FERIADOS', 'JEFATURAS'
];
function db_() {
  const db = abrirDb_();
  TABLAS.forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }

function conMockCorreo(t) {
  process.env.RESEND_API_KEY = 're_test_key';
  const mock = t.mock.method(Resend, 'enviarCorreoResend_', async () => ({ id: 'x' }));
  t.after(() => { delete process.env.RESEND_API_KEY; });
  return mock;
}

const CTX_ENCARGADO = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const CTX_GERENCIA = { email: 'gerencia@homepymes.cl', nombre: 'Gerencia', rol: 'GERENCIA' };
const CTX_OPERATIVO = { email: 'operativo@homepymes.cl', nombre: 'Operativo', rol: 'DEV' };
const CTX_ADM = { email: 'admin@homepymes.cl', nombre: 'Admin', rol: 'ADM' };

function sembrarRoles(db) {
  Calidad.gestionarRol(db, { usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADM);
  Calidad.gestionarRol(db, { usuario_email: 'operativo@homepymes.cl', rol_sgc: 'OPERATIVO' }, CTX_ADM);
}

function programar(db, overrides, contexto) {
  return RevisionDireccion.programar(db, Object.assign({
    fecha_programada: '2026-11-20T00:00:00.000Z', director_email: 'director@homepymes.cl'
  }, overrides), contexto || CTX_ENCARGADO);
}

function entradasCompletas(texto) {
  const salida = {};
  for (let i = 1; i <= 13; i++) salida[i] = (texto || 'Observación del tema ') + i;
  return salida;
}

function registrarActa(db, revision, overrides) {
  return RevisionDireccion.registrarActa(db, Object.assign({
    revision_id: revision.revision_id, fecha_reunion: '2026-11-20T00:00:00.000Z',
    asistentes: [{ nombre: 'Rogelio Álvarez', cargo: 'Director' }], entradas: entradasCompletas(),
    conclusiones: 'El SGC es adecuado y eficaz; hay recursos para las mejoras propuestas.'
  }, overrides), CTX_ENCARGADO);
}

// --- programar y convocar ---------------------------------------------------

test('programar: correlativo por año y plazo de convocatoria 10 días HÁBILES antes', () => {
  const db = db_();
  sembrarRoles(db);

  const r = programar(db);
  assert.equal(r.correlativo, 'RD-2026-01');
  assert.equal(r.estado, 'PROGRAMADA');
  assert.equal(String(r.aviso_plazo).slice(0, 10), '2026-11-05');
  assert.ok(new Date(r.aviso_plazo) < new Date(r.fecha_programada));

  const segunda = programar(db, { fecha_programada: '2026-12-01T00:00:00.000Z' });
  assert.equal(segunda.correlativo, 'RD-2026-02');
});

test('programar: exige fecha válida y solo la maneja el Encargado SGC', () => {
  const db = db_();
  sembrarRoles(db);
  assert.equal(programar(db, { fecha_programada: '' })._validationError, true);
  assert.equal(programar(db, { fecha_programada: 'no-es-fecha' })._validationError, true);
  assert.equal(programar(db, {}, CTX_OPERATIVO)._forbidden, true);
});

test('convocar: manda la agenda con los 13 temas de la norma y exige destinatarios', async (t) => {
  const mock = conMockCorreo(t);
  const db = db_();
  sembrarRoles(db);
  const r = programar(db);

  assert.equal((await RevisionDireccion.convocar(db, { revision_id: r.revision_id, asistentes: [{ nombre: 'X', cargo: 'Y' }], correos: [] }, CTX_ENCARGADO))._validationError, true);

  const ok = await RevisionDireccion.convocar(db, {
    revision_id: r.revision_id, asistentes: [{ nombre: 'Rogelio Álvarez', cargo: 'Director' }],
    correos: ['director@homepymes.cl', 'gerencia@homepymes.cl']
  }, CTX_ENCARGADO);

  assert.equal(ok.estado, 'CONVOCADA');
  assert.equal(mock.mock.callCount(), 2);
  const cuerpo = String(mock.mock.calls[0].arguments[0].text);
  assert.match(cuerpo, /El estado de las acciones de las revisiones por la dirección previas/);
  assert.match(cuerpo, /13\. El desempeño de los proveedores externos/);
});

test('convocar: acepta los asistentes como texto "Nombre - Cargo" por línea', async (t) => {
  conMockCorreo(t);
  const db = db_();
  sembrarRoles(db);
  const r = programar(db);
  const ok = await RevisionDireccion.convocar(db, {
    revision_id: r.revision_id, asistentes: 'Rogelio Álvarez - Director\nBárbara Álvarez - Gerente de Administración',
    correos: ['director@homepymes.cl']
  }, CTX_ENCARGADO);

  const guardados = JSON.parse(ok.asistentes);
  assert.equal(guardados.length, 2);
  assert.equal(guardados[1].nombre, 'Bárbara Álvarez');
  assert.equal(guardados[1].cargo, 'Gerente de Administración');
});

// --- el prellenado automático (lo distintivo de la fase) --------------------

test('resumen automático: la primera revisión declara que no hay acuerdos previos', () => {
  const db = db_();
  sembrarRoles(db);
  const r = programar(db);
  const resumen = RevisionDireccion.getResumenAutomatico(db, { revision_id: r.revision_id }, CTX_ENCARGADO).resumen;
  assert.match(resumen[1], /primera revisión/i);
});

test('resumen automático: item 7 resume las quejas del período con su conformidad', () => {
  const db = db_();
  sembrarRoles(db);
  const { agregarFila_ } = require('../db/sqliteRepo');
  agregarFila_(db, 'SGC_QUEJAS', {
    queja_id: 'Q1', correlativo: 'Q-2026-001', nombre_completo: 'Cliente A', empresa: '', rut: '', email: 'a@x.cl',
    telefono: '', tipo: 'QUEJA', area: 'CONTABILIDAD', descripcion: 'd', canal: 'WEB',
    fecha_envio: '2026-03-01T00:00:00.000Z', fecha_recepcion: '', procede: '', motivo_no_procede: '', registrado_por: '',
    investigador_email: '', resultado_investigacion: '', valida: '', accion_implementada: '', nc_id: '',
    resolucion_plazo: '', fecha_resolucion: '', responsable_resolucion: '', fecha_notificacion: '', revisado_por: '',
    seguimiento_plazo: '2026-05-01T00:00:00.000Z', fecha_seguimiento: '2026-05-01T00:00:00.000Z', cliente_conforme: true,
    estado: 'CERRADA', fecha_cierre: '', cerrada_por: '', fecha_creacion: '2026-03-01T00:00:00.000Z', activa: true
  });
  agregarFila_(db, 'SGC_QUEJAS', {
    queja_id: 'Q2', correlativo: 'Q-2026-002', nombre_completo: 'Cliente B', empresa: '', rut: '', email: 'b@x.cl',
    telefono: '', tipo: 'FELICITACION', area: 'RRHH', descripcion: 'd', canal: 'WEB',
    fecha_envio: '2026-04-01T00:00:00.000Z', fecha_recepcion: '', procede: '', motivo_no_procede: '', registrado_por: '',
    investigador_email: '', resultado_investigacion: '', valida: '', accion_implementada: '', nc_id: '',
    resolucion_plazo: '', fecha_resolucion: '', responsable_resolucion: '', fecha_notificacion: '', revisado_por: '',
    seguimiento_plazo: '', fecha_seguimiento: '', cliente_conforme: '',
    estado: 'RECIBIDA', fecha_cierre: '', cerrada_por: '', fecha_creacion: '2026-04-01T00:00:00.000Z', activa: true
  });
  const r = programar(db);

  const resumen = RevisionDireccion.getResumenAutomatico(db, { revision_id: r.revision_id }, CTX_ENCARGADO).resumen;
  assert.match(resumen[7], /2 mensajes/);
  assert.match(resumen[7], /1 quejas/);
  assert.match(resumen[7], /1 felicitaciones/);
  assert.match(resumen[7], /1 de 1 clientes quedaron conformes/);
});

test('resumen automático: items 10, 12 y 13 traen NC, auditorías y proveedores', () => {
  const db = db_();
  sembrarRoles(db);
  const { agregarFila_ } = require('../db/sqliteRepo');

  agregarFila_(db, 'SGC_NC', {
    nc_id: 'NC1', correlativo: 'NC-2026-001', fuente: 'AUDITORIA_INTERNA', origen_ref: '', referencia_normativa: '9.2',
    descripcion: 'desc', area_id: 'CALIDAD', detectada_por: 'x@y.cl', fecha_deteccion: '2026-02-01T00:00:00.000Z',
    responsable_email: 'r@y.cl', estado: 'CERRADA', ciclo: 1,
    correccion_descripcion: '', correccion_actividad_id: '', correccion_plazo: '', correccion_fecha_cierre: '',
    porque_1: '', porque_2: '', porque_3: '', porque_4: '', porque_5: '', causa_raiz: '',
    accion_descripcion: '', accion_actividad_id: '', accion_plazo: '', accion_fecha_cierre: '',
    eficacia_plazo: '', eficacia_fecha: '', eficacia_resultado: 'EFICAZ', eficacia_observaciones: '',
    fecha_cierre: '2026-06-01T00:00:00.000Z', cerrada_por: 'x@y.cl', fecha_creacion: '2026-02-01T00:00:00.000Z', activa: true
  });
  agregarFila_(db, 'SGC_AUDITORIAS', {
    auditoria_id: 'AUD1', correlativo: 'AI-2026-01', anio: 2026, area_id: 'CALIDAD', proceso: 'Proceso X',
    clausulas: '', auditor_email: 'aud@y.cl', coauditores: '', auditados: '', objetivo: '', alcance: '', criterios: '',
    fecha_programada: '2026-05-01T00:00:00.000Z', fecha_plan: '', fecha_ejecucion: '2026-05-10T00:00:00.000Z',
    estado: 'CERRADA', informe_plazo: '', informe_fecha: '', informe_conclusion: '', personas_entrevistadas: '',
    fecha_cierre: '', cerrada_por: '', creada_por: 'x@y.cl', fecha_creacion: '2026-01-01T00:00:00.000Z', activa: true
  });
  agregarFila_(db, 'SGC_AUD_HALLAZGOS', {
    hallazgo_id: 'H1', auditoria_id: 'AUD1', clausula: '9.2', aspecto_verificado: 'algo', evidencia: 'ev',
    resultado: 'NO_CONFORMIDAD', descripcion: 'desc', nc_id: 'NC1', registrado_por: 'aud@y.cl',
    fecha_registro: '2026-05-10T00:00:00.000Z', activo: true
  });
  agregarFila_(db, 'SGC_AUD_HALLAZGOS', {
    hallazgo_id: 'H2', auditoria_id: 'AUD1', clausula: '9.3', aspecto_verificado: 'otra', evidencia: 'ev',
    resultado: 'CONFORME', descripcion: '', nc_id: '', registrado_por: 'aud@y.cl',
    fecha_registro: '2026-05-10T00:00:00.000Z', activo: true
  });
  agregarFila_(db, 'SGC_PROVEEDORES', {
    proveedor_id: 'P1', nombre: 'Proveedor Bueno', rut: '1-1', producto_servicio: 'Insumos', direccion: '', telefono: '',
    email: '', nombre_contacto: '', es_unico: false, estado: 'APROBADO', ultima_evaluacion_fecha: '2026-02-01',
    ultima_evaluacion_promedio: 9, ultima_evaluacion_resultado: 'BUENO', proxima_evaluacion: '2027-02-01',
    creado_por: 'x@y.cl', fecha_creacion: '2026-01-01T00:00:00.000Z', activa: true
  });
  agregarFila_(db, 'SGC_PROVEEDORES', {
    proveedor_id: 'P2', nombre: 'Proveedor Malo', rut: '2-2', producto_servicio: 'Servicios', direccion: '', telefono: '',
    email: '', nombre_contacto: '', es_unico: false, estado: 'REPROBADO', ultima_evaluacion_fecha: '2026-02-01',
    ultima_evaluacion_promedio: 3, ultima_evaluacion_resultado: 'MALO', proxima_evaluacion: '2027-02-01',
    creado_por: 'x@y.cl', fecha_creacion: '2026-01-01T00:00:00.000Z', activa: true
  });

  const r = programar(db);
  const resumen = RevisionDireccion.getResumenAutomatico(db, { revision_id: r.revision_id }, CTX_ENCARGADO).resumen;

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
  const db = db_();
  sembrarRoles(db);
  const r = programar(db);
  const resumen = RevisionDireccion.getResumenAutomatico(db, { revision_id: r.revision_id }, CTX_ENCARGADO).resumen;

  assert.match(resumen[7], /no se recibieron quejas/i);
  assert.match(resumen[10], /no se levantaron no conformidades/i);
  assert.match(resumen[12], /no se registraron auditorías/i);
  assert.match(resumen[13], /No hay proveedores externos registrados/i);
});

test('el catálogo declara qué entradas resuelve el sistema (item 8 ya resuelto por Objetivos, Fase 6a)', () => {
  const db = db_();
  sembrarRoles(db);
  const r = programar(db);
  const detalle = RevisionDireccion.getDetalle(db, { revision_id: r.revision_id }, CTX_ENCARGADO);

  assert.equal(detalle.catalogo_entradas.length, 13);
  const auto = detalle.catalogo_entradas.filter((e) => e.auto).map((e) => e.numero);
  assert.deepEqual(auto, [1, 7, 8, 10, 12, 13]);

  const objetivos = detalle.catalogo_entradas.find((e) => e.numero === 8);
  assert.equal(objetivos.pendiente_fase, undefined);
});

test('resumen automático: el item 8 trae el grado de logro de los objetivos de calidad', () => {
  const db = db_();
  sembrarRoles(db);
  const Objetivos = require('../logica/objetivosSgc');
  const anio = new Date('2026-11-20T00:00:00.000Z').getFullYear();
  Objetivos.sembrarAnio(db, { anio }, CTX_ENCARGADO);

  const r = programar(db);
  const resumen = RevisionDireccion.getResumenAutomatico(db, { revision_id: r.revision_id }, CTX_ENCARGADO).resumen;
  assert.match(resumen[8], /6 objetivos de calidad/);
});

// --- el acta ----------------------------------------------------------------

test('registrarActa: las 13 entradas son obligatorias (§9.3.2)', () => {
  const db = db_();
  sembrarRoles(db);
  const r = programar(db);

  const incompletas = entradasCompletas();
  delete incompletas[4];
  const fallo = registrarActa(db, r, { entradas: incompletas });
  assert.equal(fallo._validationError, true);
  assert.match(fallo.message, /4/);

  assert.equal(registrarActa(db, r, { asistentes: [] })._validationError, true);
  assert.equal(registrarActa(db, r).estado, 'REALIZADA');
});

test('registrarActa: guarda las 13 observaciones y se leen de vuelta en orden', () => {
  const db = db_();
  sembrarRoles(db);
  const r = programar(db);
  registrarActa(db, r);

  const detalle = RevisionDireccion.getDetalle(db, { revision_id: r.revision_id }, CTX_ENCARGADO);
  assert.equal(detalle.entradas.length, 13);
  assert.equal(detalle.entradas[0].numero, 1);
  assert.equal(detalle.entradas[12].observaciones, 'Observación del tema 13');
  assert.equal(detalle.revision.entradas_completas, 13);
});

// --- acuerdos = actividades --------------------------------------------------

test('registrarAcuerdo: crea una ACTIVIDAD real para el responsable', async () => {
  const db = db_();
  sembrarRoles(db);
  const r = programar(db);
  registrarActa(db, r);

  const resultado = await RevisionDireccion.registrarAcuerdo(db, {
    revision_id: r.revision_id, tipo: 'RECURSOS',
    observaciones: 'Contratar un prevencionista adicional para el segundo semestre.',
    responsable_email: 'barbara@homepymes.cl', plazo: '2027-03-31T00:00:00.000Z'
  }, CTX_ENCARGADO);

  assert.ok(!resultado._validationError, resultado.message || '');
  assert.ok(resultado.tarea);
  assert.equal(resultado.tarea.responsable_email, 'barbara@homepymes.cl');

  const act = filas(db, 'ACTIVIDADES').find((a) => a.actividad_id === resultado.acuerdo.actividad_id);
  assert.ok(act);
  assert.equal(act.sgc_origen_tipo, 'REVISION_ACUERDO');
  assert.equal(act.sgc_origen_id, r.revision_id);
  assert.match(String(act.titulo), /Acuerdo de revisión por la dirección/);
});

test('registrarAcuerdo: exige tipo válido, responsable y plazo (columnas del formulario)', async () => {
  const db = db_();
  sembrarRoles(db);
  const r = programar(db);
  const base = {
    revision_id: r.revision_id, tipo: 'MEJORA', observaciones: 'Una descripción suficientemente larga.',
    responsable_email: 'x@y.cl', plazo: '2027-01-31T00:00:00.000Z'
  };

  assert.equal((await RevisionDireccion.registrarAcuerdo(db, Object.assign({}, base, { tipo: 'INVENTADO' }), CTX_ENCARGADO))._validationError, true);
  assert.equal((await RevisionDireccion.registrarAcuerdo(db, Object.assign({}, base, { responsable_email: '' }), CTX_ENCARGADO))._validationError, true);
  assert.equal((await RevisionDireccion.registrarAcuerdo(db, Object.assign({}, base, { plazo: '' }), CTX_ENCARGADO))._validationError, true);
  assert.equal((await RevisionDireccion.registrarAcuerdo(db, Object.assign({}, base, { observaciones: 'corto' }), CTX_ENCARGADO))._validationError, true);

  assert.ok(!(await RevisionDireccion.registrarAcuerdo(db, base, CTX_ENCARGADO))._validationError);
});

// --- cierre -----------------------------------------------------------------

test('cerrar: no se puede sin acuerdos -- §9.3.3 exige decisiones y acciones', async () => {
  const db = db_();
  sembrarRoles(db);
  const r = programar(db);
  registrarActa(db, r);

  const sinAcuerdos = RevisionDireccion.cerrar(db, { revision_id: r.revision_id }, CTX_ENCARGADO);
  assert.equal(sinAcuerdos._validationError, true);
  assert.match(sinAcuerdos.message, /9\.3\.3/);

  await RevisionDireccion.registrarAcuerdo(db, {
    revision_id: r.revision_id, tipo: 'MEJORA', observaciones: 'Mejorar el control documental del SGC.',
    responsable_email: 'x@y.cl', plazo: '2027-01-31T00:00:00.000Z'
  }, CTX_ENCARGADO);

  assert.equal(RevisionDireccion.cerrar(db, { revision_id: r.revision_id }, CTX_ENCARGADO).estado, 'CERRADA');
});

test('cerrar: exige acta previa y conclusiones (PRO-05 §6.2)', async () => {
  const db = db_();
  sembrarRoles(db);
  const r = programar(db);

  assert.equal(RevisionDireccion.cerrar(db, { revision_id: r.revision_id }, CTX_ENCARGADO)._validationError, true);

  registrarActa(db, r, { conclusiones: '' });
  await RevisionDireccion.registrarAcuerdo(db, {
    revision_id: r.revision_id, tipo: 'MEJORA', observaciones: 'Una mejora concreta y suficientemente descrita.',
    responsable_email: 'x@y.cl', plazo: '2027-01-31T00:00:00.000Z'
  }, CTX_ENCARGADO);

  const sinConclusiones = RevisionDireccion.cerrar(db, { revision_id: r.revision_id }, CTX_ENCARGADO);
  assert.equal(sinConclusiones._validationError, true);
  assert.match(sinConclusiones.message, /adecuado y eficaz/);
});

// --- la revisión siguiente ve la anterior ------------------------------------

test('resumen automático: el item 1 reporta los acuerdos de la revisión anterior y si se cumplieron', async () => {
  const db = db_();
  sembrarRoles(db);

  const anterior = programar(db, { fecha_programada: '2025-11-20T00:00:00.000Z' });
  registrarActa(db, anterior, { fecha_reunion: '2025-11-20T00:00:00.000Z' });
  await RevisionDireccion.registrarAcuerdo(db, {
    revision_id: anterior.revision_id, tipo: 'MEJORA', observaciones: 'Acuerdo del año pasado que quedó pendiente.',
    responsable_email: 'x@y.cl', plazo: '2026-06-30T00:00:00.000Z'
  }, CTX_ENCARGADO);
  RevisionDireccion.cerrar(db, { revision_id: anterior.revision_id }, CTX_ENCARGADO);

  const actual = programar(db);
  const resumen = RevisionDireccion.getResumenAutomatico(db, { revision_id: actual.revision_id }, CTX_ENCARGADO).resumen;

  assert.match(resumen[1], /RD-2025-01/);
  assert.match(resumen[1], /1 acuerdo\(s\)/);
  assert.match(resumen[1], /0 cumplido\(s\)/);
  assert.match(resumen[1], /1 pendiente\(s\)/);
});

// --- alertas y permisos ------------------------------------------------------

test('recordatorio: avisa que falta convocar cuando se pasó el plazo de 10 días hábiles', async (t) => {
  conMockCorreo(t);
  const db = db_();
  sembrarRoles(db);
  const pronto = new Date(Date.now() + 2 * 86400000).toISOString();
  programar(db, { fecha_programada: pronto });

  const r = await RevisionDireccion.recordatorioPendientes(db);
  assert.equal(r.convocatoria_pendiente, 1);

  const correos = filas(db, 'LOG_NOTIFICACIONES').filter((n) => String(n.evento || '').indexOf('SGC_REVISION_CONVOCAR') === 0);
  assert.equal(correos.length, 1);
});

test('recordatorio: si nunca hubo revisión, la frecuencia está vencida (no "al día")', async (t) => {
  conMockCorreo(t);
  const db = db_();
  sembrarRoles(db);

  const r = await RevisionDireccion.recordatorioPendientes(db);
  assert.equal(r.frecuencia_vencida, true);

  const vista = RevisionDireccion.listar(db, {}, CTX_ENCARGADO);
  assert.equal(vista.vigencia.vencida, true);
  assert.equal(vista.vigencia.ultima_fecha, '');
});

test('listar: Gerencia puede leer la revisión (la ejecuta la Dirección) pero no gestionarla', () => {
  const db = db_();
  sembrarRoles(db);
  programar(db);

  const vista = RevisionDireccion.listar(db, {}, CTX_GERENCIA);
  assert.ok(!vista._forbidden);
  assert.equal(vista.puede_gestionar, false);
  assert.equal(vista.revisiones.length, 1);

  assert.equal(RevisionDireccion.listar(db, {}, CTX_OPERATIVO)._forbidden, true);
});

// Bug confirmado por la auditoria de modulos (2026-09): anular() era la
// UNICA de las 4 implementaciones del modulo (auditorias/NC/quejas/
// revision) que ademas de estado:'ANULADA' apagaba `activa` -- como
// buscarRevision_/listar() filtran por esActivo_, una revision anulada asi
// desaparecia por completo (ni listar() ni getDetalle la encontraban
// nunca mas), justo lo contrario del principio de trazabilidad ISO que
// calidadSgc.js declara explicitamente ("un documento OBSOLETO no se
// borra"). Las otras 3 SI siguen mostrando el registro anulado -- ahora
// esta tambien.
test('anular: exige motivo, NUNCA borra, y la revision SIGUE apareciendo (estado ANULADA), igual que auditorias/NC/quejas', () => {
  const db = db_();
  sembrarRoles(db);
  const r = programar(db);

  assert.equal(RevisionDireccion.anular(db, { revision_id: r.revision_id, motivo: 'no' }, CTX_ENCARGADO)._validationError, true);
  RevisionDireccion.anular(db, { revision_id: r.revision_id, motivo: 'Se reprograma para el próximo año.' }, CTX_ENCARGADO);

  const listado = RevisionDireccion.listar(db, {}, CTX_ENCARGADO).revisiones;
  assert.equal(listado.length, 1, 'la revision anulada debe seguir apareciendo en el listado');
  assert.equal(listado[0].estado, 'ANULADA');
  assert.equal(filas(db, 'SGC_REVISIONES').length, 1, 'nunca se borra la fila');

  const detalle = RevisionDireccion.getDetalle(db, { revision_id: r.revision_id }, CTX_ENCARGADO);
  assert.equal(detalle._validationError, undefined, 'getDetalle tiene que seguir encontrandola tambien');
});
