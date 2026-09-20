'use strict';

/**
 * Prueba de portabilidad: SGC ISO 9001 Fase 3b (PRO-03, auditoría interna)
 * -- mismos escenarios de auditorias.test.js, corridos contra
 * backend/logica/auditoriasSgc.js. Sin adaptaciones de R2: el módulo no
 * toca archivos.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, leerFilas_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('../logica/calidadSgc');
const NoConformidades = require('../logica/noConformidadesSgc');
const Auditorias = require('../logica/auditoriasSgc');
const Resend = require('../logica/resend');

const TABLAS = [
  'SGC_AUDITORIAS', 'SGC_AUD_HALLAZGOS', 'SGC_NC', 'SGC_ROLES', 'ACTIVIDADES', 'ACTIVIDADES_BITACORA',
  'JEFATURAS', 'CONFIG_FERIADOS', 'LOG_SISTEMA', 'LOG_NOTIFICACIONES', 'NOTIFICACIONES_APP',
  'CONFIG_NOTIFICACIONES', 'CAT_AREAS'
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

const CTX_SGC = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const CTX_AUDITOR = { email: 'auditor@homepymes.cl', nombre: 'Auditor', rol: 'DEV' };
const CTX_AUDITADO = { email: 'auditado@homepymes.cl', nombre: 'Auditado', rol: 'DEV' };
const CTX_AJENO = { email: 'ajeno@homepymes.cl', nombre: 'Ajeno', rol: 'DEV' };
const CTX_COAUDITOR = { email: 'coauditor@homepymes.cl', nombre: 'Coauditor', rol: 'DEV' };
const CTX_ADM = { email: 'admin@homepymes.cl', nombre: 'Admin', rol: 'ADM' };

// El auditor es de CONTABILIDAD y el area auditada es RRHH: el escenario
// base NO tiene conflicto de interes; el conflicto se prueba aparte.
function sembrar(db) {
  Calidad.gestionarRol(db, { usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADM);
  Calidad.gestionarRol(db, { usuario_email: 'auditor@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'CONTABILIDAD' }, CTX_ADM);
  Calidad.gestionarRol(db, { usuario_email: 'auditado@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'RRHH' }, CTX_ADM);
  Calidad.gestionarRol(db, { usuario_email: 'coauditor@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'PREVENCION' }, CTX_ADM);
}

function programar(db, overrides) {
  return Auditorias.programar(db, Object.assign({
    proceso: 'Gestión de personas', area_id: 'RRHH', auditor_email: 'auditor@homepymes.cl',
    clausulas: ['7.2', '7.5'], fecha_programada: '2026-09-01T12:00:00.000Z'
  }, overrides), CTX_SGC);
}
function planificar(db, aud, overrides) {
  return Auditorias.planificar(db, Object.assign({
    auditoria_id: aud.auditoria_id, objetivo: 'Verificar la competencia del personal del área.',
    alcance: 'Fichas y evaluaciones del período 2026.', criterios: 'ISO 9001:2015, PRO-02.',
    auditados: ['auditado@homepymes.cl'], fecha_ejecucion: '2026-09-15T12:00:00.000Z'
  }, overrides), CTX_SGC);
}
function verificar(db, aud, overrides) {
  return Auditorias.registrarHallazgo(db, Object.assign({
    auditoria_id: aud.auditoria_id, clausula: '7.2',
    aspecto_verificado: 'Evaluaciones de competencia del período.',
    evidencia: 'Se revisaron 8 fichas.', resultado: 'CONFORME'
  }, overrides), CTX_AUDITOR);
}

// --- la cadena completa ------------------------------------------------------

test('la cadena llega hasta "Mi trabajo": auditoria -> hallazgo -> NC -> actividad', async () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  const hallazgo = verificar(db, aud, { resultado: 'NO_CONFORMIDAD', descripcion: 'Tres personas del área no tienen evaluación de competencia vigente.' });

  const convertido = Auditorias.convertirHallazgoEnNc(db, { hallazgo_id: hallazgo.hallazgo_id }, CTX_SGC);
  assert.ok(convertido.nc, 'debe crear la no conformidad');
  assert.equal(convertido.nc.fuente, 'AUDITORIA_INTERNA');
  assert.equal(convertido.nc.origen_ref, hallazgo.hallazgo_id);
  assert.equal(convertido.nc.area_id, 'RRHH');
  assert.equal(convertido.nc.responsable_email, 'auditado@homepymes.cl');
  assert.equal(convertido.nc.referencia_normativa, '7.2');

  const conAccion = await NoConformidades.registrarCorreccion(db, { nc_id: convertido.nc.nc_id, descripcion: 'Evaluar a las tres personas esta semana.' }, CTX_SGC);
  assert.ok(conAccion.correccion_actividad_id);
  const actividad = filas(db, 'ACTIVIDADES').find((a) => a.actividad_id === conAccion.correccion_actividad_id);
  assert.equal(actividad.responsable_email, 'auditado@homepymes.cl');
  assert.equal(actividad.sgc_origen_tipo, 'NC_CORRECCION');
});

test('el vinculo es bidireccional: el hallazgo muestra su NC en el detalle', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  const hallazgo = verificar(db, aud, { resultado: 'NO_CONFORMIDAD', descripcion: 'Falta evidencia de competencia.' });
  Auditorias.convertirHallazgoEnNc(db, { hallazgo_id: hallazgo.hallazgo_id }, CTX_SGC);

  const detalle = Auditorias.getDetalle(db, { auditoria_id: aud.auditoria_id }, CTX_SGC);
  const enDetalle = detalle.hallazgos[0];
  assert.ok(enDetalle.nc_id);
  assert.match(enDetalle.nc_correlativo, /^NC-\d{4}-\d{3}$/);
  assert.equal(enDetalle.nc_estado, 'ABIERTA');
});

test('un hallazgo no se convierte dos veces en no conformidad', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  const hallazgo = verificar(db, aud, { resultado: 'NO_CONFORMIDAD', descripcion: 'Falta evidencia.' });
  Auditorias.convertirHallazgoEnNc(db, { hallazgo_id: hallazgo.hallazgo_id }, CTX_SGC);
  const segunda = Auditorias.convertirHallazgoEnNc(db, { hallazgo_id: hallazgo.hallazgo_id }, CTX_SGC);
  assert.equal(segunda._validationError, true);
  assert.equal(filas(db, 'SGC_NC').length, 1);
});

test('un hallazgo CONFORME no se convierte en no conformidad', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  const hallazgo = verificar(db, aud);
  const r = Auditorias.convertirHallazgoEnNc(db, { hallazgo_id: hallazgo.hallazgo_id }, CTX_SGC);
  assert.equal(r._validationError, true);
});

// --- la regla que obliga a recorrer la cadena ------------------------------

test('no se puede cerrar la auditoria con hallazgos de no conformidad sin levantar', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  verificar(db, aud, { resultado: 'NO_CONFORMIDAD', descripcion: 'Sin evaluaciones vigentes.' });
  Auditorias.cerrarEjecucion(db, { auditoria_id: aud.auditoria_id }, CTX_AUDITOR);
  Auditorias.emitirInforme(db, { auditoria_id: aud.auditoria_id, conclusion: 'El proceso presenta desviaciones.' }, CTX_AUDITOR);

  const bloqueada = Auditorias.cerrar(db, { auditoria_id: aud.auditoria_id }, CTX_SGC);
  assert.equal(bloqueada._validationError, true);
  assert.match(bloqueada.message, /7\.2/);

  const hallazgo = filas(db, 'SGC_AUD_HALLAZGOS')[0];
  Auditorias.convertirHallazgoEnNc(db, { hallazgo_id: hallazgo.hallazgo_id }, CTX_SGC);
  const cerrada = Auditorias.cerrar(db, { auditoria_id: aud.auditoria_id }, CTX_SGC);
  assert.equal(cerrada.estado, 'CERRADA');
});

test('una OBSERVACION no bloquea el cierre (no toda desviacion es no conformidad)', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  verificar(db, aud, { resultado: 'OBSERVACION', descripcion: 'El registro se lleva en dos planillas.' });
  Auditorias.cerrarEjecucion(db, { auditoria_id: aud.auditoria_id }, CTX_AUDITOR);
  Auditorias.emitirInforme(db, { auditoria_id: aud.auditoria_id, conclusion: 'Conforme con observaciones.' }, CTX_AUDITOR);
  assert.equal(Auditorias.cerrar(db, { auditoria_id: aud.auditoria_id }, CTX_SGC).estado, 'CERRADA');
});

test('el resumen anticipa cuantas NC faltan, antes de intentar cerrar', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  verificar(db, aud, { resultado: 'NO_CONFORMIDAD', descripcion: 'Una.' });
  verificar(db, aud, { clausula: '7.5', resultado: 'NO_CONFORMIDAD', descripcion: 'Otra.' });
  const detalle = Auditorias.getDetalle(db, { auditoria_id: aud.auditoria_id }, CTX_SGC);
  assert.equal(detalle.resumen.no_conformidades, 2);
  assert.equal(detalle.resumen.nc_pendientes, 2);
});

// --- conflicto de interes (§9.2.2 c) ---------------------------------------

test('nadie audita su propia area', () => {
  const db = db_();
  sembrar(db);
  const r = programar(db, { auditor_email: 'auditado@homepymes.cl' });
  assert.equal(r._validationError, true);
  assert.match(r.message, /propio trabajo/);
});

test('el auditor no puede estar en la lista de auditados', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  const r = planificar(db, aud, { auditados: ['auditado@homepymes.cl', 'auditor@homepymes.cl'] });
  assert.equal(r._validationError, true);
  assert.match(r.message, /si mismo|sí mismo/);
});

test('un auditor de otra area si puede auditar', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  assert.equal(aud.estado, 'PROGRAMADA');
  assert.equal(aud.auditor_email, 'auditor@homepymes.cl');
});

// --- el ciclo y su orden ----------------------------------------------------

test('el ciclo completo recorre programada -> planificada -> ejecutada -> informada -> cerrada', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  assert.equal(aud.estado, 'PROGRAMADA');
  assert.match(aud.correlativo, /^AI-2026-001$/);

  assert.equal(planificar(db, aud).estado, 'PLANIFICADA');
  verificar(db, aud);
  assert.equal(Auditorias.cerrarEjecucion(db, { auditoria_id: aud.auditoria_id }, CTX_AUDITOR).estado, 'EJECUTADA');
  assert.equal(Auditorias.emitirInforme(db, { auditoria_id: aud.auditoria_id, conclusion: 'El proceso cumple los requisitos verificados.' }, CTX_AUDITOR).estado, 'INFORMADA');
  assert.equal(Auditorias.cerrar(db, { auditoria_id: aud.auditoria_id }, CTX_SGC).estado, 'CERRADA');
});

test('no se registran hallazgos antes de planificar', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  const r = verificar(db, aud);
  assert.equal(r._validationError, true);
  assert.match(r.message, /planifica/i);
});

test('no se cierra la ejecucion sin lista de verificacion', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  const r = Auditorias.cerrarEjecucion(db, { auditoria_id: aud.auditoria_id }, CTX_AUDITOR);
  assert.equal(r._validationError, true);
});

test('el informe se emite despues de ejecutar, no antes', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  verificar(db, aud);
  const r = Auditorias.emitirInforme(db, { auditoria_id: aud.auditoria_id, conclusion: 'X' }, CTX_AUDITOR);
  assert.equal(r._validationError, true);
});

test('emitido el informe, la lista de verificacion queda cerrada', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  verificar(db, aud);
  Auditorias.cerrarEjecucion(db, { auditoria_id: aud.auditoria_id }, CTX_AUDITOR);
  Auditorias.emitirInforme(db, { auditoria_id: aud.auditoria_id, conclusion: 'Conforme.' }, CTX_AUDITOR);
  const r = verificar(db, aud, { clausula: '7.5' });
  assert.equal(r._validationError, true);
});

test('el plazo del informe son 10 dias HABILES desde la ejecucion', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  verificar(db, aud);
  const ejecutada = Auditorias.cerrarEjecucion(db, { auditoria_id: aud.auditoria_id }, CTX_AUDITOR);
  const dias = Math.round((new Date(ejecutada.informe_plazo) - new Date()) / 86400000);
  assert.ok(dias >= 12 && dias <= 20, `plazo inesperado: ${dias} días corridos`);
});

// --- lista de verificacion ---------------------------------------------------

test('una clausula CONFORME tambien se registra: es evidencia de que se reviso', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  verificar(db, aud);
  const detalle = Auditorias.getDetalle(db, { auditoria_id: aud.auditoria_id }, CTX_SGC);
  assert.equal(detalle.resumen.verificaciones, 1);
  assert.equal(detalle.resumen.conformes, 1);
  assert.equal(detalle.hallazgos[0].clausula_titulo, 'Competencia');
});

test('un hallazgo no conforme exige descripcion', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  const r = verificar(db, aud, { resultado: 'NO_CONFORMIDAD', descripcion: '  ' });
  assert.equal(r._validationError, true);
});

test('la clausula tiene que existir en la norma', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  const r = verificar(db, aud, { clausula: '99.9' });
  assert.equal(r._validationError, true);
});

test('los hallazgos se ordenan por numero de clausula, no por texto', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db, { clausulas: ['7.2', '9.2', '10.2'] });
  planificar(db, aud);
  verificar(db, aud, { clausula: '10.2' });
  verificar(db, aud, { clausula: '9.2' });
  verificar(db, aud, { clausula: '7.2' });
  const detalle = Auditorias.getDetalle(db, { auditoria_id: aud.auditoria_id }, CTX_SGC);
  assert.deepEqual(detalle.hallazgos.map((h) => h.clausula), ['7.2', '9.2', '10.2']);
});

test('un hallazgo ya convertido en NC no cambia de resultado', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  const hallazgo = verificar(db, aud, { resultado: 'NO_CONFORMIDAD', descripcion: 'Falta.' });
  Auditorias.convertirHallazgoEnNc(db, { hallazgo_id: hallazgo.hallazgo_id }, CTX_SGC);
  const r = Auditorias.registrarHallazgo(db, {
    auditoria_id: aud.auditoria_id, hallazgo_id: hallazgo.hallazgo_id,
    clausula: '7.2', aspecto_verificado: 'Otro texto.', resultado: 'CONFORME'
  }, CTX_SGC);
  assert.equal(r._validationError, true);
});

test('un hallazgo con NC no se puede eliminar', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  const hallazgo = verificar(db, aud, { resultado: 'NO_CONFORMIDAD', descripcion: 'Falta.' });
  Auditorias.convertirHallazgoEnNc(db, { hallazgo_id: hallazgo.hallazgo_id }, CTX_SGC);
  assert.equal(Auditorias.eliminarHallazgo(db, { hallazgo_id: hallazgo.hallazgo_id }, CTX_SGC)._validationError, true);
});

// --- permisos ----------------------------------------------------------------

test('el auditor asignado registra hallazgos aunque no gobierne el SGC', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  const h = verificar(db, aud);
  assert.ok(h.hallazgo_id);
});

test('un tercero no registra hallazgos en una auditoria ajena', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  const r = Auditorias.registrarHallazgo(db, { auditoria_id: aud.auditoria_id, clausula: '7.2', aspecto_verificado: 'X', resultado: 'CONFORME' }, CTX_AJENO);
  assert.equal(r._forbidden, true);
});

// Bypass confirmado por la auditoria de modulos (2026-09): el permiso se
// validaba contra data.auditoria_id, pero la edicion buscaba el hallazgo
// SOLO por data.hallazgo_id -- un auditor de SU auditoria podia mandar SU
// auditoria_id (para pasar el permiso) junto con el hallazgo_id de OTRA
// auditoria de la que no es auditor, y editarlo.
test('SEGURIDAD: un auditor no puede editar el hallazgo de una auditoria ajena mandando su PROPIA auditoria_id', () => {
  const db = db_();
  sembrar(db);

  const audA = programar(db, { area_id: 'RRHH', auditor_email: 'auditor@homepymes.cl' });
  planificar(db, audA);
  const hallazgoA = verificar(db, audA); // registrado por CTX_AUDITOR, auditor de audA

  const audB = programar(db, {
    area_id: 'CONTABILIDAD', auditor_email: 'coauditor@homepymes.cl', clausulas: ['7.5']
  });
  Auditorias.planificar(db, {
    auditoria_id: audB.auditoria_id, objetivo: 'Verificar EPP.', alcance: 'Registros 2026.',
    criterios: 'ISO 9001:2015.', auditados: ['auditado@homepymes.cl'], fecha_ejecucion: '2026-09-16T12:00:00.000Z'
  }, CTX_SGC);
  const hallazgoB = Auditorias.registrarHallazgo(db, {
    auditoria_id: audB.auditoria_id, clausula: '7.5', aspecto_verificado: 'EPP entregado.',
    evidencia: 'Registros revisados.', resultado: 'CONFORME'
  }, { email: 'coauditor@homepymes.cl', nombre: 'Coauditor', rol: 'DEV' });

  // CTX_AUDITOR es auditor de audA, NO de audB -- manda auditoria_id de SU
  // auditoria (pasa el permiso) pero el hallazgo_id es el de audB.
  const ataque = Auditorias.registrarHallazgo(db, {
    auditoria_id: audA.auditoria_id, hallazgo_id: hallazgoB.hallazgo_id,
    clausula: '7.5', aspecto_verificado: 'MODIFICADO POR UN TERCERO', resultado: 'NO_CONFORMIDAD',
    descripcion: 'intento de edicion cruzada'
  }, CTX_AUDITOR);
  assert.equal(ataque._validationError, true, 'debe rechazarse: el hallazgo no pertenece a audA');

  const hallazgoBTrasElAtaque = filas(db, 'SGC_AUD_HALLAZGOS').find((h) => h.hallazgo_id === hallazgoB.hallazgo_id);
  assert.equal(hallazgoBTrasElAtaque.aspecto_verificado, 'EPP entregado.', 'el hallazgo de audB no cambio');
  assert.equal(hallazgoBTrasElAtaque.resultado, 'CONFORME', 'el resultado de audB no cambio');
});

test('el auditado ve la auditoria de su area, el ajeno no', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  assert.ok(Auditorias.getDetalle(db, { auditoria_id: aud.auditoria_id }, CTX_AUDITADO).auditoria);
  assert.equal(Auditorias.getDetalle(db, { auditoria_id: aud.auditoria_id }, CTX_AJENO)._forbidden, true);
  assert.equal(Auditorias.listar(db, {}, CTX_AJENO).auditorias.length, 0);
});

test('solo el Encargado SGC levanta la no conformidad, no el auditor', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  const hallazgo = verificar(db, aud, { resultado: 'NO_CONFORMIDAD', descripcion: 'Falta.' });
  assert.equal(Auditorias.convertirHallazgoEnNc(db, { hallazgo_id: hallazgo.hallazgo_id }, CTX_AUDITOR)._forbidden, true);
});

test('una auditoria se anula con motivo, nunca se borra', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  assert.equal(Auditorias.anular(db, { auditoria_id: aud.auditoria_id }, CTX_SGC)._validationError, true);
  const anulada = Auditorias.anular(db, { auditoria_id: aud.auditoria_id, motivo: 'Duplicada.' }, CTX_SGC);
  assert.equal(anulada.estado, 'ANULADA');
  assert.equal(filas(db, 'SGC_AUDITORIAS').length, 1);
});

// --- indicadores y avisos ----------------------------------------------------

test('el % de cumplimiento del programa anual cuenta ejecutadas sobre programadas', () => {
  const db = db_();
  sembrar(db);
  const anio = new Date().getFullYear();
  const a1 = programar(db, { fecha_programada: `${anio}-03-01T12:00:00.000Z`, proceso: 'Uno' });
  programar(db, { fecha_programada: `${anio}-06-01T12:00:00.000Z`, proceso: 'Dos' });
  planificar(db, a1, { fecha_ejecucion: `${anio}-03-15T12:00:00.000Z` });
  verificar(db, a1);
  Auditorias.cerrarEjecucion(db, { auditoria_id: a1.auditoria_id }, CTX_AUDITOR);

  const ind = Auditorias.listar(db, {}, CTX_SGC).indicadores;
  assert.equal(ind.programadas, 2);
  assert.equal(ind.ejecutadas, 1);
  assert.equal(ind.pct_cumplimiento, 50);
});

test('aviso: el informe fuera del plazo de 10 dias habiles llega al auditor y al Encargado', async (t) => {
  conMockCorreo(t);
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  verificar(db, aud);
  Auditorias.cerrarEjecucion(db, { auditoria_id: aud.auditoria_id }, CTX_AUDITOR);
  actualizarFilaPorId_(db, 'SGC_AUDITORIAS', 'auditoria_id', aud.auditoria_id, { informe_plazo: '2020-01-01T00:00:00.000Z' });

  const r = await Auditorias.recordatorioPendientes(db);
  assert.ok(r.avisos >= 2, 'auditor y Encargado SGC');
  const destinos = filas(db, 'LOG_NOTIFICACIONES').map((n) => n.destinatario);
  assert.ok(destinos.includes('auditor@homepymes.cl'));
  assert.ok(destinos.includes('sgc@homepymes.cl'));
});

test('aviso: no se repite el mismo dia', async (t) => {
  conMockCorreo(t);
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  verificar(db, aud);
  Auditorias.cerrarEjecucion(db, { auditoria_id: aud.auditoria_id }, CTX_AUDITOR);
  actualizarFilaPorId_(db, 'SGC_AUDITORIAS', 'auditoria_id', aud.auditoria_id, { informe_plazo: '2020-01-01T00:00:00.000Z' });
  await Auditorias.recordatorioPendientes(db);
  assert.equal((await Auditorias.recordatorioPendientes(db)).avisos, 0);
});

test('aviso: un proceso sin auditar en 12 meses le llega al Encargado SGC', async (t) => {
  conMockCorreo(t);
  const db = db_();
  sembrar(db);
  const aud = programar(db, { fecha_programada: '2024-01-10T12:00:00.000Z' });
  planificar(db, aud, { fecha_ejecucion: '2024-01-20T12:00:00.000Z' });
  verificar(db, aud);
  Auditorias.cerrarEjecucion(db, { auditoria_id: aud.auditoria_id }, CTX_AUDITOR);
  actualizarFilaPorId_(db, 'SGC_AUDITORIAS', 'auditoria_id', aud.auditoria_id, { fecha_ejecucion: '2024-01-20T12:00:00.000Z', informe_plazo: '' });

  const r = await Auditorias.recordatorioPendientes(db);
  assert.equal(r.sin_auditar, 1);
  const destinos = filas(db, 'LOG_NOTIFICACIONES').map((n) => n.destinatario);
  assert.ok(destinos.includes('sgc@homepymes.cl'));
});

test('un proceso con auditoria programada a futuro no cuenta como atrasado', async (t) => {
  conMockCorreo(t);
  const db = db_();
  sembrar(db);
  const vieja = programar(db, { fecha_programada: '2024-01-10T12:00:00.000Z' });
  planificar(db, vieja, { fecha_ejecucion: '2024-01-20T12:00:00.000Z' });
  verificar(db, vieja);
  Auditorias.cerrarEjecucion(db, { auditoria_id: vieja.auditoria_id }, CTX_AUDITOR);
  actualizarFilaPorId_(db, 'SGC_AUDITORIAS', 'auditoria_id', vieja.auditoria_id, { fecha_ejecucion: '2024-01-20T12:00:00.000Z', informe_plazo: '' });
  programar(db, { fecha_programada: '2026-11-01T12:00:00.000Z' });

  assert.equal((await Auditorias.recordatorioPendientes(db)).sin_auditar, 0);
});

// --- validaciones de entrada ------------------------------------------------

test('programar exige proceso, fecha, auditor y al menos una clausula', () => {
  const db = db_();
  sembrar(db);
  assert.equal(programar(db, { proceso: '  ' })._validationError, true);
  assert.equal(programar(db, { fecha_programada: '' })._validationError, true);
  assert.equal(programar(db, { auditor_email: '' })._validationError, true);
  assert.equal(programar(db, { clausulas: [] })._validationError, true);
  assert.equal(programar(db, { clausulas: ['inventada'] })._validationError, true);
});

test('planificar exige objetivo, alcance y fecha de ejecucion', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  assert.equal(planificar(db, aud, { objetivo: '' })._validationError, true);
  assert.equal(planificar(db, aud, { alcance: '' })._validationError, true);
  assert.equal(planificar(db, aud, { fecha_ejecucion: '' })._validationError, true);
});

test('el informe exige conclusion escrita', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  verificar(db, aud);
  Auditorias.cerrarEjecucion(db, { auditoria_id: aud.auditoria_id }, CTX_AUDITOR);
  assert.equal(Auditorias.emitirInforme(db, { auditoria_id: aud.auditoria_id, conclusion: '  ' }, CTX_AUDITOR)._validationError, true);
});

test('una celda de clausulas corrupta no tumba el listado', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  actualizarFilaPorId_(db, 'SGC_AUDITORIAS', 'auditoria_id', aud.auditoria_id, { clausulas: 'esto no es json', auditados: '{roto' });
  const listado = Auditorias.listar(db, {}, CTX_SGC);
  assert.equal(listado.auditorias.length, 1);
  assert.equal(listado.auditorias[0].clausulas.length, 0);
});

// --- equipo auditor, entrevistados y catalogo de preguntas ------------------

test('el equipo auditor (coauditores) tambien puede registrar hallazgos', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud, { coauditores: ['coauditor@homepymes.cl'] });
  const h = Auditorias.registrarHallazgo(db, { auditoria_id: aud.auditoria_id, clausula: '7.5', aspecto_verificado: 'Control documental.', resultado: 'CONFORME' }, CTX_COAUDITOR);
  assert.ok(h.hallazgo_id);
});

test('un coauditor tampoco puede auditar su propia area', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  const r = Auditorias.planificar(db, {
    auditoria_id: aud.auditoria_id, objetivo: 'X', alcance: 'Y', auditados: [],
    coauditores: ['coauditor@homepymes.cl'], fecha_ejecucion: '2026-09-15T12:00:00.000Z'
  }, CTX_SGC);
  assert.ok(r.auditoria_id, 'sin conflicto de area, planifica normal');
  const r2 = Auditorias.planificar(db, {
    auditoria_id: aud.auditoria_id, objetivo: 'X', alcance: 'Y',
    auditados: ['coauditor@homepymes.cl'], coauditores: ['coauditor@homepymes.cl'],
    fecha_ejecucion: '2026-09-15T12:00:00.000Z'
  }, CTX_SGC);
  assert.equal(r2._validationError, true);
});

test('un tercero fuera del equipo auditor no puede registrar hallazgos', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud, { coauditores: ['coauditor@homepymes.cl'] });
  const r = Auditorias.registrarHallazgo(db, { auditoria_id: aud.auditoria_id, clausula: '7.2', aspecto_verificado: 'X', resultado: 'CONFORME' }, CTX_AJENO);
  assert.equal(r._forbidden, true);
});

test('el informe registra a las personas entrevistadas', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  verificar(db, aud);
  Auditorias.cerrarEjecucion(db, { auditoria_id: aud.auditoria_id }, CTX_AUDITOR);
  Auditorias.emitirInforme(db, {
    auditoria_id: aud.auditoria_id, conclusion: 'Conforme.',
    personas_entrevistadas: ['Lisseth Vilchez - Encargada de Administración', 'Vanessa Sepúlveda - Analista de RRHH']
  }, CTX_AUDITOR);
  const detalle = Auditorias.getDetalle(db, { auditoria_id: aud.auditoria_id }, CTX_SGC);
  assert.deepEqual(detalle.auditoria.personas_entrevistadas, ['Lisseth Vilchez - Encargada de Administración', 'Vanessa Sepúlveda - Analista de RRHH']);
});

test('el detalle trae el catalogo de preguntas de verificacion, sacado del FO-PRO-03-04 real', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  const detalle = Auditorias.getDetalle(db, { auditoria_id: aud.auditoria_id }, CTX_SGC);
  assert.ok(detalle.preguntas_catalogo['7.2'].length > 0);
  assert.match(detalle.preguntas_catalogo['7.2'][0], /¿/);
  assert.equal(detalle.preguntas_catalogo['4.4'].length, 0);

  const listado = Auditorias.listar(db, {}, CTX_SGC);
  assert.ok(listado.clausulas_catalogo.length > 0);
});

test('el informe trae el resumen de NC con punto normativo y evidencia objetiva (FO-PRO-03-02)', () => {
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  const h = verificar(db, aud, { clausula: '7.5', resultado: 'NO_CONFORMIDAD', descripcion: 'Falta el listado maestro actualizado.', evidencia: 'Revisión de la carpeta compartida.' });
  Auditorias.convertirHallazgoEnNc(db, { hallazgo_id: h.hallazgo_id }, CTX_SGC);

  const detalle = Auditorias.getDetalle(db, { auditoria_id: aud.auditoria_id }, CTX_SGC);
  assert.equal(detalle.informe_resumen_nc.length, 1);
  assert.equal(detalle.informe_resumen_nc[0].punto_normativo, '7.5');
  assert.equal(detalle.informe_resumen_nc[0].evidencia_objetiva, 'Revisión de la carpeta compartida.');
  assert.match(detalle.informe_resumen_nc[0].nc_correlativo, /^NC-\d{4}-\d{3}$/);
});

// --- plazo de 15 dias habiles para redactar la NC (PRO-03 §6.5) -------------

test('aviso: hallazgos de no conformidad sin redactar fuera del plazo de 15 dias habiles', async (t) => {
  conMockCorreo(t);
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  verificar(db, aud, { resultado: 'NO_CONFORMIDAD', descripcion: 'Sin evidencia.' });
  Auditorias.cerrarEjecucion(db, { auditoria_id: aud.auditoria_id }, CTX_AUDITOR);
  Auditorias.emitirInforme(db, { auditoria_id: aud.auditoria_id, conclusion: 'Con desviaciones.' }, CTX_AUDITOR);
  actualizarFilaPorId_(db, 'SGC_AUDITORIAS', 'auditoria_id', aud.auditoria_id, { informe_fecha: '2020-01-01T00:00:00.000Z' });

  const r = await Auditorias.recordatorioPendientes(db);
  assert.ok(r.avisos >= 2, 'auditado y Encargado SGC');
  const destinos = filas(db, 'LOG_NOTIFICACIONES').map((n) => n.destinatario);
  assert.ok(destinos.includes('auditado@homepymes.cl'));
  assert.ok(destinos.includes('sgc@homepymes.cl'));
});

test('aviso de NC sin redactar: no se dispara si ya no quedan hallazgos pendientes', async (t) => {
  conMockCorreo(t);
  const db = db_();
  sembrar(db);
  const aud = programar(db);
  planificar(db, aud);
  const h = verificar(db, aud, { resultado: 'NO_CONFORMIDAD', descripcion: 'Sin evidencia.' });
  Auditorias.cerrarEjecucion(db, { auditoria_id: aud.auditoria_id }, CTX_AUDITOR);
  Auditorias.emitirInforme(db, { auditoria_id: aud.auditoria_id, conclusion: 'Con desviaciones.' }, CTX_AUDITOR);
  actualizarFilaPorId_(db, 'SGC_AUDITORIAS', 'auditoria_id', aud.auditoria_id, { informe_fecha: '2020-01-01T00:00:00.000Z' });
  Auditorias.convertirHallazgoEnNc(db, { hallazgo_id: h.hallazgo_id }, CTX_SGC);

  await Auditorias.recordatorioPendientes(db);
  const destinos = filas(db, 'LOG_NOTIFICACIONES').filter((n) => String(n.evento || '').indexOf('SGC_AUD_NC_PENDIENTE') === 0);
  assert.equal(destinos.length, 0);
});
