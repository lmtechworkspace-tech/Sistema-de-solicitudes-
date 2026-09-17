'use strict';

/**
 * Prueba de portabilidad: escenarios de backend/test/actividades.test.js y
 * gerencia-actividades.test.js, corridos contra backend/logica/actividades.js.
 *
 * Adaptaciones:
 *  - Correos via mock de Resend (pedirActualizacion, enviarAlertasActividades).
 *  - Los PDF (descargarReporteActividadesPdf/descargarActaReunionPdf) quedan
 *    bloqueados por R2/motor-PDF -> se prueban en el test del router.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const A = require('../logica/actividades');
const Resend = require('../logica/resend');

const CTX_MARCELO = { email: 'marcelo@rld.cl', nombre: 'Marcelo Gonzalez', rol: 'DEV' };
const CTX_BARBARA = { email: 'barbara@rld.cl', nombre: 'Barbara Alvarez', rol: 'JEFATURA' };
const CTX_OTRO = { email: 'otro@rld.cl', nombre: 'Otro Ajeno', rol: 'DEV' };
const CTX_ADM = { email: 'admin@rld.cl', nombre: 'Admin', rol: 'ADM' };

function jefatura(over) {
  return Object.assign({ jefatura_id: 'JEF-' + Math.random().toString(36).slice(2), jefe_email: 'barbara@rld.cl', subordinado_email: 'marcelo@rld.cl', activo: true }, over);
}

function db_() {
  const db = abrirDb_();
  ['ACTIVIDADES', 'ACTIVIDADES_BITACORA', 'JEFATURAS', 'CONFIG_FERIADOS', 'LOG_NOTIFICACIONES', 'NOTIFICACIONES_APP', 'USUARIOS']
    .forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  sembrarTabla_(db, 'CAT_AREAS', COLUMNAS.CAT_AREAS, [
    ['AREA-1', 'Contabilidad', '', true],
    ['AREA-2', 'Marketing', '', true]
  ]);
  [jefatura({ jefatura_id: 'JEF-marcelo' }),
    jefatura({ jefatura_id: 'JEF-otro', jefe_email: 'otro-jefe@rld.cl', subordinado_email: 'otro@rld.cl' }),
    jefatura({ jefatura_id: 'JEF-javiera', subordinado_email: 'javiera@rld.cl' })]
    .forEach((j) => agregarFila_(db, 'JEFATURAS', j));
  return db;
}
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
function diasAtras(n) { return new Date(Date.now() - n * 24 * 3600 * 1000).toISOString(); }
function diasAdelante(n) { return new Date(Date.now() + n * 24 * 3600 * 1000).toISOString(); }

function conMock(t) {
  process.env.RESEND_API_KEY = 're_test_key';
  const mock = t.mock.method(Resend, 'enviarCorreoResend_', async () => ({ id: 'x' }));
  t.after(() => { delete process.env.RESEND_API_KEY; });
  return mock;
}

// ===== creacion (RN-700/701/709/710) =======================================

test('crear (PROPIA): el propio responsable confirma en el mismo acto', () => {
  const db = db_();
  const a = A.crear(db, { titulo: 'Cierre', fecha_compromiso: '2026-09-30' }, CTX_MARCELO);
  assert.equal(a.estado, 'NO_INICIADA');
  assert.equal(a.fecha_compromiso, '2026-09-30');
  assert.equal(a.fecha_propuesta, '');
  assert.ok(a.confirmada_en);
  assert.equal(a.supervisor_email, 'barbara@rld.cl'); // jefe por JEFATURAS
});

test('crear (ASIGNADA por el supervisor): queda pendiente de confirmar (RN-710)', () => {
  const db = db_();
  const a = A.crear(db, { titulo: 'Cierre', responsable_email: 'marcelo@rld.cl', fecha_propuesta: '2026-09-30' }, CTX_BARBARA);
  assert.equal(a.fecha_propuesta, '2026-09-30');
  assert.equal(a.fecha_compromiso, '');
  assert.equal(a.confirmada_en, '');
});

test('crear: un supervisor NO puede crear actividades fuera de su equipo (RN-709)', () => {
  const db = db_();
  const r = A.crear(db, { titulo: 'X', responsable_email: 'otro@rld.cl', fecha_propuesta: '2026-09-30' }, CTX_BARBARA);
  assert.equal(r._forbidden, true);
});

test('crear: ADM puede crear para cualquiera', () => {
  const db = db_();
  const a = A.crear(db, { titulo: 'X', responsable_email: 'otro@rld.cl', fecha_propuesta: '2026-09-30' }, CTX_ADM);
  assert.equal(a.responsable_email, 'otro@rld.cl');
});

test('crear: sin titulo o sin fecha, error de validacion', () => {
  const db = db_();
  assert.equal(A.crear(db, { fecha_compromiso: '2026-09-30' }, CTX_MARCELO)._validationError, true);
  assert.equal(A.crear(db, { titulo: 'X' }, CTX_MARCELO)._validationError, true);
});

test('crear: acoplamiento gateado -- proyecto_id/sgc no habilitan crear para un ajeno todavia (solo restringe)', () => {
  const db = db_();
  const r1 = A.crear(db, { titulo: 'T', responsable_email: 'otro@rld.cl', fecha_propuesta: '2026-09-30', proyecto_id: 'PRJ-1' }, CTX_MARCELO);
  assert.equal(r1._forbidden, true, 'sin Proyectos portado, la membresia de proyecto no concede');
  const r2 = A.crear(db, { titulo: 'T', responsable_email: 'otro@rld.cl', fecha_propuesta: '2026-09-30', sgc_origen_tipo: 'NC_CORRECCION' }, CTX_MARCELO);
  assert.equal(r2._forbidden, true, 'sin SGC portado, el gobierno del SGC no concede');
});

test('crear: meta_cantidad/meta_unidad y colaboradores', () => {
  const db = db_();
  const a = A.crear(db, { titulo: 'Con meta', fecha_compromiso: '2026-09-30', meta_cantidad: '16', meta_unidad: ' imagenes ', colaboradores_emails: ['A@RLD.cl', 'marcelo@rld.cl', 'a@rld.cl', 'b@rld.cl'] }, CTX_MARCELO);
  assert.equal(a.meta_cantidad, 16);
  assert.equal(a.meta_unidad, 'imagenes');
  assert.deepEqual(JSON.parse(a.colaboradores_emails), ['a@rld.cl', 'b@rld.cl']); // normaliza, dedup, excluye al responsable
  const b = A.crear(db, { titulo: 'Sin meta', fecha_compromiso: '2026-09-30' }, CTX_MARCELO);
  assert.equal(b.meta_cantidad, '');
  assert.equal(b.meta_unidad, '');
});

// ===== confirmar ============================================================

test('confirmar: el responsable confirma la fecha propuesta', () => {
  const db = db_();
  const a = A.crear(db, { titulo: 'X', responsable_email: 'marcelo@rld.cl', fecha_propuesta: '2026-09-30' }, CTX_BARBARA);
  const c = A.confirmar(db, { actividad_id: a.actividad_id }, CTX_MARCELO);
  assert.equal(c.fecha_compromiso, '2026-09-30');
  assert.equal(c.fecha_propuesta, '');
  assert.ok(c.confirmada_en);
});

test('confirmar: contrapropuesta (RN-711, no es rechazo)', () => {
  const db = db_();
  const a = A.crear(db, { titulo: 'X', responsable_email: 'marcelo@rld.cl', fecha_propuesta: '2026-09-30' }, CTX_BARBARA);
  const c = A.confirmar(db, { actividad_id: a.actividad_id, fecha_compromiso: '2026-10-05', motivo: 'carga' }, CTX_MARCELO);
  assert.equal(c.fecha_compromiso, '2026-10-05');
});

test('confirmar: solo el responsable; y no dos veces', () => {
  const db = db_();
  const a = A.crear(db, { titulo: 'X', responsable_email: 'marcelo@rld.cl', fecha_propuesta: '2026-09-30' }, CTX_BARBARA);
  assert.equal(A.confirmar(db, { actividad_id: a.actividad_id }, CTX_BARBARA)._forbidden, true);
  A.confirmar(db, { actividad_id: a.actividad_id }, CTX_MARCELO);
  assert.equal(A.confirmar(db, { actividad_id: a.actividad_id }, CTX_MARCELO)._validationError, true);
});

// ===== check-in =============================================================

test('checkin "sin_cambio": legitimo, mueve ultima_actualizacion y arranca EN_CURSO', () => {
  const db = db_();
  const a = A.crear(db, { titulo: 'X', fecha_compromiso: '2026-09-30' }, CTX_MARCELO);
  const r = A.checkin(db, { actividad_id: a.actividad_id, tipo: 'sin_cambio' }, CTX_MARCELO);
  assert.equal(r.estado, 'EN_CURSO');
});

test('checkin: solo responsable o colaborador (RN-702)', () => {
  const db = db_();
  const a = A.crear(db, { titulo: 'X', fecha_compromiso: '2026-09-30' }, CTX_MARCELO);
  assert.equal(A.checkin(db, { actividad_id: a.actividad_id, tipo: 'sin_cambio' }, CTX_OTRO)._forbidden, true);
});

test('checkin "bloqueo" exige motivo (RN-704) y pasa a BLOQUEADA', () => {
  const db = db_();
  const a = A.crear(db, { titulo: 'X', fecha_compromiso: '2026-09-30' }, CTX_MARCELO);
  assert.equal(A.checkin(db, { actividad_id: a.actividad_id, tipo: 'bloqueo' }, CTX_MARCELO)._validationError, true);
  const r = A.checkin(db, { actividad_id: a.actividad_id, tipo: 'bloqueo', bloqueo_motivo: 'Falta insumo' }, CTX_MARCELO);
  assert.equal(r.estado, 'BLOQUEADA');
  assert.equal(r.bloqueo_motivo, 'Falta insumo');
});

test('checkin "listo": sin validacion cierra; con validacion pasa a EN_REVISION', () => {
  const db = db_();
  const a1 = A.crear(db, { titulo: 'X', fecha_compromiso: '2026-09-30' }, CTX_MARCELO);
  assert.equal(A.checkin(db, { actividad_id: a1.actividad_id, tipo: 'listo' }, CTX_MARCELO).estado, 'TERMINADA');
  const a2 = A.crear(db, { titulo: 'Y', fecha_compromiso: '2026-09-30', requiere_validacion: true }, CTX_MARCELO);
  assert.equal(A.checkin(db, { actividad_id: a2.actividad_id, tipo: 'listo' }, CTX_MARCELO).estado, 'EN_REVISION');
});

test('checkin: horas opcionales 0-24 quedan en la bitacora; fuera de rango error', () => {
  const db = db_();
  const a = A.crear(db, { titulo: 'X', fecha_compromiso: '2026-09-30' }, CTX_MARCELO);
  A.checkin(db, { actividad_id: a.actividad_id, tipo: 'avance', horas: 3 }, CTX_MARCELO);
  const bit = filas(db, 'ACTIVIDADES_BITACORA').filter((b) => b.tipo === 'CHECKIN_AVANCE');
  assert.equal(JSON.parse(bit[bit.length - 1].datos).horas, 3);
  assert.equal(A.checkin(db, { actividad_id: a.actividad_id, tipo: 'avance', horas: 30 }, CTX_MARCELO)._validationError, true);
});

test('checkin sobre actividad cerrada devuelve error', () => {
  const db = db_();
  const a = A.crear(db, { titulo: 'X', fecha_compromiso: '2026-09-30' }, CTX_MARCELO);
  A.checkin(db, { actividad_id: a.actividad_id, tipo: 'listo' }, CTX_MARCELO);
  assert.equal(A.checkin(db, { actividad_id: a.actividad_id, tipo: 'avance' }, CTX_MARCELO)._validationError, true);
});

test('checkin (RN-702 ampliada): un colaborador puede; un ajeno no; y el colaborador ve el detalle', () => {
  const db = db_();
  const a = A.crear(db, { titulo: 'X', fecha_compromiso: '2026-09-30', colaboradores_emails: ['colab@rld.cl'] }, CTX_MARCELO);
  assert.equal(A.checkin(db, { actividad_id: a.actividad_id, tipo: 'sin_cambio' }, { email: 'colab@rld.cl', rol: 'DEV' }).estado, 'EN_CURSO');
  assert.equal(A.checkin(db, { actividad_id: a.actividad_id, tipo: 'sin_cambio' }, { email: 'ajeno@rld.cl', rol: 'DEV' })._forbidden, true);
  assert.ok(A.obtenerDetalle(db, { actividad_id: a.actividad_id }, { email: 'colab@rld.cl', rol: 'DEV' }).actividad);
});

// ===== validar ==============================================================

test('validar: aprueba (EN_REVISION -> TERMINADA); devuelve (-> EN_CURSO); solo el supervisor', () => {
  const db = db_();
  const a = A.crear(db, { titulo: 'X', fecha_compromiso: '2026-09-30', requiere_validacion: true }, CTX_MARCELO);
  A.checkin(db, { actividad_id: a.actividad_id, tipo: 'listo' }, CTX_MARCELO);
  assert.equal(A.validar(db, { actividad_id: a.actividad_id }, CTX_OTRO)._forbidden, true);
  assert.equal(A.validar(db, { actividad_id: a.actividad_id, aprobar: false, motivo: 'falto' }, CTX_BARBARA).estado, 'EN_CURSO');
  A.checkin(db, { actividad_id: a.actividad_id, tipo: 'listo' }, CTX_MARCELO);
  assert.equal(A.validar(db, { actividad_id: a.actividad_id }, CTX_BARBARA).estado, 'TERMINADA');
});

// ===== reprogramar / cancelar ==============================================

test('reprogramar exige motivo e incrementa el contador', () => {
  const db = db_();
  const a = A.crear(db, { titulo: 'X', fecha_compromiso: '2026-09-30' }, CTX_MARCELO);
  assert.equal(A.reprogramar(db, { actividad_id: a.actividad_id, fecha_compromiso: '2026-10-10' }, CTX_MARCELO)._validationError, true);
  const r = A.reprogramar(db, { actividad_id: a.actividad_id, fecha_compromiso: '2026-10-10', motivo: 'x' }, CTX_MARCELO);
  assert.equal(r.reprogramaciones, 1);
  assert.equal(r.fecha_compromiso, '2026-10-10');
});

test('cancelar exige motivo y es terminal', () => {
  const db = db_();
  const a = A.crear(db, { titulo: 'X', fecha_compromiso: '2026-09-30' }, CTX_MARCELO);
  assert.equal(A.cancelar(db, { actividad_id: a.actividad_id }, CTX_MARCELO)._validationError, true);
  assert.equal(A.cancelar(db, { actividad_id: a.actividad_id, motivo: 'ya no' }, CTX_MARCELO).estado, 'CANCELADA');
  assert.equal(A.cancelar(db, { actividad_id: a.actividad_id, motivo: 'x' }, CTX_MARCELO)._validationError, true);
});

// ===== recurrencia (RN-713) ================================================

test('RN-713: al cerrar una MENSUAL nace la siguiente; sin recurrencia no', () => {
  const db = db_();
  const a = A.crear(db, { titulo: 'Mensual', fecha_compromiso: '2026-09-30', recurrencia: 'MENSUAL' }, CTX_MARCELO);
  A.checkin(db, { actividad_id: a.actividad_id, tipo: 'listo' }, CTX_MARCELO);
  const nuevas = filas(db, 'ACTIVIDADES').filter((x) => x.recurrencia_origen_id === a.actividad_id);
  assert.equal(nuevas.length, 1);
  assert.equal(new Date(nuevas[0].fecha_compromiso).getUTCMonth(), 9); // octubre (0-index)

  const b = A.crear(db, { titulo: 'Una vez', fecha_compromiso: '2026-09-30' }, CTX_MARCELO);
  A.checkin(db, { actividad_id: b.actividad_id, tipo: 'listo' }, CTX_MARCELO);
  assert.equal(filas(db, 'ACTIVIDADES').filter((x) => x.recurrencia_origen_id === b.actividad_id).length, 0);
});

// ===== listar / detalle / semaforo =========================================

test('listar: colaborador ve las suyas; supervisor las de su equipo; ADM todas', () => {
  const db = db_();
  A.crear(db, { titulo: 'De marcelo', fecha_compromiso: '2026-09-30' }, CTX_MARCELO);
  A.crear(db, { titulo: 'De otro', fecha_compromiso: '2026-09-30' }, CTX_OTRO);
  assert.equal(A.listar(db, {}, CTX_MARCELO).length, 1);
  assert.equal(A.listar(db, {}, CTX_BARBARA).length, 1); // solo marcelo/javiera son su equipo
  assert.equal(A.listar(db, {}, CTX_ADM).length, 2);
  assert.ok(A.listar(db, {}, CTX_ADM)[0].semaforo, 'trae semaforo calculado en el servidor');
});

test('obtenerDetalle: rechaza a quien no tiene alcance; e incluye bitacora ordenada', () => {
  const db = db_();
  const a = A.crear(db, { titulo: 'X', fecha_compromiso: '2026-09-30' }, CTX_MARCELO);
  A.checkin(db, { actividad_id: a.actividad_id, tipo: 'sin_cambio' }, CTX_MARCELO);
  assert.equal(A.obtenerDetalle(db, { actividad_id: a.actividad_id }, CTX_OTRO)._forbidden, true);
  const d = A.obtenerDetalle(db, { actividad_id: a.actividad_id }, CTX_MARCELO);
  assert.ok(d.bitacora.length >= 2);
});

test('panelEquipo: excluye al propio supervisor y arma la carga por persona', () => {
  const db = db_();
  A.crear(db, { titulo: 'De marcelo', fecha_compromiso: diasAtras(2), responsable_email: 'marcelo@rld.cl', supervisor_email: 'barbara@rld.cl' }, CTX_BARBARA);
  A.crear(db, { titulo: 'De barbara', fecha_compromiso: '2026-09-30' }, CTX_BARBARA);
  const panel = A.panelEquipo(db, {}, CTX_BARBARA);
  assert.ok(!panel.items.some((a) => a.responsable_email === 'barbara@rld.cl'));
  assert.equal(panel.por_persona[0].email, 'marcelo@rld.cl');
});

// ===== reasignar ============================================================

test('reasignar: mueve y deja pendiente de confirmar; rechaza fuera del equipo; exige motivo', () => {
  const db = db_();
  const a = A.crear(db, { titulo: 'X', responsable_email: 'marcelo@rld.cl', fecha_propuesta: '2026-09-30' }, CTX_BARBARA);
  A.confirmar(db, { actividad_id: a.actividad_id }, CTX_MARCELO);
  assert.equal(A.reasignar(db, { actividad_id: a.actividad_id, responsable_nuevo: 'javiera@rld.cl' }, CTX_BARBARA)._validationError, true);
  const r = A.reasignar(db, { actividad_id: a.actividad_id, responsable_nuevo: 'javiera@rld.cl', motivo: 'carga' }, CTX_BARBARA);
  assert.equal(r.responsable_email, 'javiera@rld.cl');
  assert.equal(r.estado, 'NO_INICIADA');
  assert.equal(r.confirmada_en, '');
  assert.equal(A.reasignar(db, { actividad_id: a.actividad_id, responsable_nuevo: 'otro@rld.cl', motivo: 'x' }, CTX_BARBARA)._forbidden, true);
});

// ===== pedirActualizacion (correo) =========================================

test('pedirActualizacion: envia correo al responsable, deja nota, y solo lo hace quien gestiona', async (t) => {
  const mock = conMock(t);
  const db = db_();
  const a = A.crear(db, { titulo: 'X', responsable_email: 'marcelo@rld.cl', fecha_propuesta: '2026-09-30' }, CTX_BARBARA);
  const r = await A.pedirActualizacion(db, { actividad_id: a.actividad_id, nota: 'como va?' }, CTX_BARBARA);
  assert.equal(r.enviado, true);
  assert.equal(mock.mock.calls[0].arguments[0].to[0], 'marcelo@rld.cl');
  assert.ok(filas(db, 'ACTIVIDADES_BITACORA').some((b) => b.tipo === 'COMENTARIO'));
  assert.equal((await A.pedirActualizacion(db, { actividad_id: a.actividad_id }, CTX_OTRO))._forbidden, true);
});

// ===== calcularAlertas (§4.6) ==============================================

test('calcularAlertas: "sin confirmar" avisa al supervisor pasado el umbral, no antes', () => {
  const db = db_();
  const a = A.crear(db, { titulo: 'X', responsable_email: 'marcelo@rld.cl', fecha_propuesta: '2026-09-30' }, CTX_BARBARA);
  assert.equal(A.calcularAlertas(db)['barbara@rld.cl'], undefined);
  actualizarFilaPorId_(db, 'ACTIVIDADES', 'actividad_id', a.actividad_id, { fecha_creacion: diasAtras(10) });
  const al = A.calcularAlertas(db);
  assert.equal(al['barbara@rld.cl'].sin_confirmar.length, 1);
  assert.equal(al['marcelo@rld.cl'], undefined);
});

test('calcularAlertas: "vencida" al supervisor', () => {
  const db = db_();
  A.crear(db, { titulo: 'R', fecha_compromiso: diasAtras(3) }, CTX_MARCELO);
  assert.equal(A.calcularAlertas(db)['barbara@rld.cl'].vencidas.length, 1);
});

test('calcularAlertas: "compromiso proximo" solo si la confianza no es VERDE', () => {
  const db = db_();
  const a = A.crear(db, { titulo: 'R', fecha_compromiso: diasAdelante(1) }, CTX_MARCELO);
  assert.equal((A.calcularAlertas(db)['barbara@rld.cl'] || {}).compromiso_proximo, undefined);
  A.checkin(db, { actividad_id: a.actividad_id, tipo: 'avance', confianza: 'AMARILLA' }, CTX_MARCELO);
  assert.equal(A.calcularAlertas(db)['barbara@rld.cl'].compromiso_proximo.length, 1);
});

test('calcularAlertas: "bloqueo estancado" al supervisor y a quien debe destrabar', () => {
  const db = db_();
  const a = A.crear(db, { titulo: 'R', fecha_compromiso: diasAdelante(60) }, CTX_MARCELO);
  A.checkin(db, { actividad_id: a.actividad_id, tipo: 'bloqueo', bloqueo_motivo: 'Espera', bloqueo_responsable_email: 'javiera@rld.cl' }, CTX_MARCELO);
  actualizarFilaPorId_(db, 'ACTIVIDADES', 'actividad_id', a.actividad_id, { bloqueo_desde: diasAtras(10) });
  const al = A.calcularAlertas(db);
  assert.equal(al['barbara@rld.cl'].bloqueo_estancado.length, 1);
  assert.equal(al['javiera@rld.cl'].bloqueo_estancado.length, 1);
});

test('calcularAlertas: "sin novedad" escalonado -- 1er ciclo solo colaborador, 2do suma supervisor', () => {
  const db = db_();
  const a = A.crear(db, { titulo: 'Lento', fecha_compromiso: diasAdelante(30) }, CTX_MARCELO);
  actualizarFilaPorId_(db, 'ACTIVIDADES', 'actividad_id', a.actividad_id, { ultima_actualizacion: diasAtras(8) });
  let al = A.calcularAlertas(db);
  assert.equal(al['marcelo@rld.cl'].sin_novedad.length, 1);
  assert.equal(al['barbara@rld.cl'], undefined);
  actualizarFilaPorId_(db, 'ACTIVIDADES', 'actividad_id', a.actividad_id, { ultima_actualizacion: diasAtras(20) });
  al = A.calcularAlertas(db);
  assert.equal(al['barbara@rld.cl'].sin_novedad.length, 1);
});

test('enviarAlertasActividades: un solo correo por persona; nada si no hay pendientes', async (t) => {
  const mock = conMock(t);
  const db = db_();
  A.crear(db, { titulo: 'Informe atrasado', fecha_compromiso: diasAtras(3) }, CTX_MARCELO);
  const res = await A.enviarAlertasActividades(db);
  const paraBarbara = res.find((r) => r.email === 'barbara@rld.cl');
  assert.equal(paraBarbara.enviado, true);
  assert.equal(mock.mock.calls.filter((c) => c.arguments[0].to[0] === 'barbara@rld.cl').length, 1);

  const db2 = db_();
  A.crear(db2, { titulo: 'Al dia', fecha_compromiso: diasAdelante(30) }, CTX_MARCELO);
  assert.equal((await A.enviarAlertasActividades(db2)).length, 0);
});

// ===== Panel de Gerencia / reportes / acta =================================

function crearGer(db, over) {
  return A.crear(db, Object.assign({ titulo: 'Actividad', fecha_compromiso: diasAdelante(10), area_id: 'AREA-1', prioridad: 'P3' }, over), CTX_MARCELO);
}

test('getPanelGerencia: KPIs de hoy y de periodo, areas, criticas y heatmap', () => {
  const db = db_();
  const t = crearGer(db, { titulo: 'Cerrada a tiempo', fecha_compromiso: diasAtras(1) });
  actualizarFilaPorId_(db, 'ACTIVIDADES', 'actividad_id', t.actividad_id, { estado: 'TERMINADA', fecha_terminada: diasAtras(2) });
  const b = crearGer(db, { titulo: 'Bloqueada', origen: 'EMERGENTE' });
  actualizarFilaPorId_(db, 'ACTIVIDADES', 'actividad_id', b.actividad_id, { estado: 'BLOQUEADA', bloqueo_desde: diasAtras(3) });
  crearGer(db, { titulo: 'P1 atrasada', prioridad: 'P1', fecha_compromiso: diasAtras(2) });

  const panel = A.getPanelGerencia(db, {}, CTX_ADM);
  assert.equal(panel.kpis.bloqueadas_actual, 1);
  assert.ok(panel.kpis.bloqueo_promedio_dias > 0);
  assert.equal(panel.kpis.pct_cumplidas_a_tiempo, 100);
  assert.ok(panel.kpis.pct_emergente > 0);
  assert.deepEqual(panel.areas.map((a) => a.area_id).sort(), ['AREA-1', 'AREA-2']);
  assert.deepEqual(panel.criticas.map((c) => c.titulo), ['P1 atrasada']);
  assert.equal(panel.criticas[0].semaforo, 'atrasada');
});

test('getPanelGerencia: filtro por area', () => {
  const db = db_();
  crearGer(db, { titulo: 'Conta', area_id: 'AREA-1' });
  crearGer(db, { titulo: 'Mkt', area_id: 'AREA-2' });
  assert.equal(A.getPanelGerencia(db, { area_id: 'AREA-2' }, CTX_ADM).kpis.carga_por_persona[0].total, 1);
});

test('getPanelGerencia: heatmap % cumplimiento de la semana actual', () => {
  const db = db_();
  const hoy = new Date().toISOString();
  const a = crearGer(db, { titulo: 'Esta semana', area_id: 'AREA-1', fecha_compromiso: hoy });
  actualizarFilaPorId_(db, 'ACTIVIDADES', 'actividad_id', a.actividad_id, { estado: 'TERMINADA', fecha_terminada: hoy });
  const fila = A.getPanelGerencia(db, {}, CTX_ADM).heatmap.find((h) => h.area_nombre === 'Contabilidad');
  assert.equal(fila.semanas.length, 6);
  assert.equal(fila.semanas[fila.semanas.length - 1].pct_cumplimiento, 100);
});

test('generarReporte: tipo invalido; estado_actual; cumplimiento_periodo; carga_capacidad', () => {
  const db = db_();
  assert.equal(A.generarReporte(db, { tipo: 'raro' }, CTX_ADM)._validationError, true);

  crearGer(db, { titulo: 'Uno' });
  crearGer(db, { titulo: 'Dos' });
  const est = A.generarReporte(db, { tipo: 'estado_actual' }, CTX_ADM);
  assert.equal(est.filas.length, 2);
  assert.ok(est.columnas.some((c) => c.campo === 'semaforo'));

  const db2 = db_();
  const at = crearGer(db2, { titulo: 'A tiempo', fecha_compromiso: diasAtras(1) });
  actualizarFilaPorId_(db2, 'ACTIVIDADES', 'actividad_id', at.actividad_id, { estado: 'TERMINADA', fecha_terminada: diasAtras(2) });
  crearGer(db2, { titulo: 'Vencida', fecha_compromiso: diasAtras(3) });
  const cump = A.generarReporte(db2, { tipo: 'cumplimiento_periodo', desde: diasAtras(30), hasta: new Date().toISOString() }, CTX_ADM);
  assert.equal(cump.resumen.comprometidas, 2);
  assert.equal(cump.resumen.cumplidas_a_tiempo, 1);
  assert.equal(cump.resumen.vencidas, 1);
  assert.equal(cump.resumen.pct_cumplimiento, 100);

  const db3 = db_();
  crearGer(db3, { titulo: 'Plan' });
  crearGer(db3, { titulo: 'Emerg', origen: 'EMERGENTE' });
  const carga = A.generarReporte(db3, { tipo: 'carga_capacidad', desde: diasAtras(30), hasta: new Date().toISOString() }, CTX_ADM);
  assert.equal(carga.filas.length, 1);
  assert.equal(carga.filas[0].pct_emergente, 50);
});

test('generarActaReunion: vencidas, bloqueadas (con motivo)', () => {
  const db = db_();
  crearGer(db, { titulo: 'Vencio', fecha_compromiso: diasAtras(2) });
  const b = crearGer(db, { titulo: 'Bloqueada' });
  actualizarFilaPorId_(db, 'ACTIVIDADES', 'actividad_id', b.actividad_id, { estado: 'BLOQUEADA', bloqueo_motivo: 'Esperando' });
  const acta = A.generarActaReunion(db, {}, CTX_ADM);
  assert.deepEqual(acta.vencidas.map((a) => a.titulo), ['Vencio']);
  assert.equal(acta.bloqueadas.length, 1);
  assert.equal(acta.bloqueadas[0].motivo, 'Esperando');
});
