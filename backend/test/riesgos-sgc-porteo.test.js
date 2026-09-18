'use strict';

/**
 * Prueba de portabilidad: SGC ISO 9001 v11.0 Fase 3 (riesgos y
 * oportunidades, §6.1) -- mismos escenarios de riesgos.test.js, corridos
 * contra backend/logica/riesgosSgc.js, incluido su efecto en
 * backend/logica/matrizCoberturaSgc.js (que ya deja de usar el stub de
 * Riesgos en este incremento).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, leerFilas_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('../logica/calidadSgc');
const Contexto = require('../logica/contextoSgc');
const Riesgos = require('../logica/riesgosSgc');
const MatrizCobertura = require('../logica/matrizCoberturaSgc');

const TABLAS = [
  'SGC_RIESGOS', 'SGC_CONTEXTO', 'SGC_PARTES_INTERESADAS', 'SGC_ALCANCE', 'SGC_EXCLUSIONES',
  'SGC_ROLES', 'SGC_DOCUMENTOS', 'SGC_DOC_VERSIONES', 'SGC_DOC_DESTINATARIOS', 'SGC_DOC_ACUSES',
  'SGC_PERSONAS', 'SGC_DESCRIPTORES', 'SGC_PERSONA_DOCUMENTOS', 'SGC_INDUCCIONES',
  'SGC_EVALUACIONES', 'SGC_CAPACITACIONES', 'SGC_CAPACITACION_ASISTENTES', 'SGC_NC',
  'SGC_AUDITORIAS', 'SGC_AUD_HALLAZGOS', 'SGC_QUEJAS', 'SGC_PROVEEDORES',
  'SGC_PROVEEDOR_EVALUACIONES', 'SGC_REVISIONES', 'SGC_REVISION_ACUERDOS', 'SGC_OBJETIVOS',
  'SGC_INDICADOR_LECTURAS', 'SGC_COBERTURA_HISTORICO', 'ACTIVIDADES', 'ACTIVIDADES_BITACORA', 'NOVEDADES', 'LOG_SISTEMA'
];
function db_() {
  const db = abrirDb_();
  TABLAS.forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }

const CTX_ADM = { email: 'admin@homepymes.cl', nombre: 'Admin', rol: 'ADM' };
const ENC = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const OPERATIVO = { email: 'operativo@homepymes.cl', nombre: 'Operativo', rol: 'DEV' };

function sembrarRoles(db) {
  Calidad.gestionarRol(db, { usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADM);
  Calidad.gestionarRol(db, { usuario_email: 'operativo@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'CONTABILIDAD' }, CTX_ADM);
}
function clausula(db, codigo) {
  return MatrizCobertura.listar(db, {}, ENC).clausulas.find((c) => c.codigo === codigo);
}

// --- 1. El cálculo: el corazón de la fase -----------------------------------

test('la magnitud es probabilidad × impacto y la banda sale de la tabla de criterios', () => {
  assert.deepEqual(Riesgos.valorarRiesgo_(0.5, 10), { magnitud: 5, banda: 'Moderado', tono: 'info' });
  assert.deepEqual(Riesgos.valorarRiesgo_(1.0, 25), { magnitud: 25, banda: 'Crítico', tono: 'critico' });
  assert.deepEqual(Riesgos.valorarRiesgo_(0.1, 1), { magnitud: 0.1, banda: 'Insignificante', tono: 'neutro' });
  assert.deepEqual(Riesgos.valorarRiesgo_(1.0, 50), { magnitud: 50, banda: 'Crítico', tono: 'critico' });
});

test('los bordes de banda caen del lado inferior, como dice la tabla del DOC-08', () => {
  assert.equal(Riesgos.valorarRiesgo_(1.0, 10).banda, 'Alto');
  assert.equal(Riesgos.valorarRiesgo_(1.0, 25).banda, 'Crítico');
  assert.equal(Riesgos.valorarRiesgo_(0.1, 25).banda, 'Moderado');
  assert.equal(Riesgos.valorarRiesgo_(0.5, 10).banda, 'Moderado');
  assert.equal(Riesgos.valorarRiesgo_(0.5, 25).banda, 'Alto');
});

test('una valoración incompleta no inventa una magnitud', () => {
  assert.equal(Riesgos.valorarRiesgo_('', 10), null);
  assert.equal(Riesgos.valorarRiesgo_(0.5, ''), null);
  assert.equal(Riesgos.valorarRiesgo_(0, 10), null);
});

test('las siete valoraciones que el DOC-08 rotula mal se corrigen solas', () => {
  const docInherente = {
    R1: 'Moderado', R2: 'Moderado', R3: 'Crítico', R4: 'Alto', R5: 'Alto', R6: 'Alto',
    R7: 'Moderado', R8: 'Alto', R9: 'Moderado', R10: 'Moderado', R11: 'Crítico',
    O1: 'Alto', O2: 'Alto', O3: 'Alto', O4: 'Alto', O5: 'Crítico'
  };
  const docResidual = {
    R1: 'Bajo', R2: 'Bajo', R3: 'Moderado', R4: 'Bajo', R5: 'Bajo', R6: 'Bajo',
    R7: 'Moderado', R8: 'Alto', R9: 'Bajo', R10: 'Bajo', R11: 'Moderado',
    O1: 'Crítico', O2: 'Alto', O3: 'Alto', O4: 'Crítico', O5: 'Alto'
  };

  const discrepancias = [];
  [].concat(Riesgos.RIESGOS_PROPUESTOS_DOC08, Riesgos.OPORTUNIDADES_PROPUESTAS_DOC08).forEach((r) => {
    if (Riesgos.valorarRiesgo_(r.probabilidad, r.impacto).banda !== docInherente[r.codigo]) discrepancias.push(r.codigo + ' inherente');
    if (Riesgos.valorarRiesgo_(r.probabilidad_residual, r.impacto_residual).banda !== docResidual[r.codigo]) discrepancias.push(r.codigo + ' residual');
  });

  assert.deepEqual(discrepancias.sort(), [
    'O1 inherente', 'O2 residual', 'O4 inherente', 'O5 residual', 'R10 inherente', 'R4 residual', 'R6 residual'
  ].sort());

  assert.equal(Riesgos.valorarRiesgo_(0.1, 10).banda, 'Bajo');
});

// --- 2. Oportunidades: la lectura invertida ---------------------------------

test('en una oportunidad, una magnitud alta NO se pinta de rojo', () => {
  const alto = Riesgos.valorarRiesgo_(1.0, 25);
  assert.equal(Riesgos.tonoValoracion_(alto, 'RIESGO'), 'critico');
  assert.equal(Riesgos.tonoValoracion_(alto, 'OPORTUNIDAD'), 'ok');
});

test('en una oportunidad, "mejora" significa que la magnitud SUBE', () => {
  const db = db_();
  sembrarRoles(db);
  Riesgos.sembrarDesdeDoc08(db, {}, ENC);
  const d = Riesgos.listar(db, {}, ENC);

  const o1 = d.oportunidades.find((o) => o.codigo === 'O1');
  assert.equal(o1.inherente.magnitud, 25);
  assert.equal(o1.residual.magnitud, 50);
  assert.equal(o1.mejora, true);
  assert.equal(o1.favorable, true);

  const r3 = d.riesgos.find((r) => r.codigo === 'R3');
  assert.equal(r3.inherente.magnitud, 25);
  assert.equal(r3.residual.magnitud, 5);
  assert.equal(r3.mejora, true);
  assert.equal(r3.favorable, false);

  const r8 = d.riesgos.find((r) => r.codigo === 'R8');
  assert.equal(r8.mejora, false);
});

// --- 3. Siembra y enlace con el contexto ------------------------------------

test('se siembran los 16 registros del DOC-08', () => {
  const db = db_();
  sembrarRoles(db);
  const r = Riesgos.sembrarDesdeDoc08(db, {}, ENC);
  assert.equal(r.total, 16);

  const d = Riesgos.listar(db, {}, ENC);
  assert.equal(d.riesgos.length, 11);
  assert.equal(d.oportunidades.length, 5);
  assert.match(Riesgos.sembrarDesdeDoc08(db, {}, ENC).message, /ya está cargada/i);
});

test('cada riesgo se enlaza al factor del FODA que lo origina', () => {
  const db = db_();
  sembrarRoles(db);
  Contexto.sembrarFoda(db, {}, ENC);
  const r = Riesgos.sembrarDesdeDoc08(db, {}, ENC);

  assert.equal(r.enlazados, 16);

  const d = Riesgos.listar(db, {}, ENC);
  const r3 = d.riesgos.find((x) => x.codigo === 'R3');
  assert.match(r3.factor_contexto, /^D3 —/);
});

test('sin el FODA cargado la matriz se carga igual, solo que sin enlaces', () => {
  const db = db_();
  sembrarRoles(db);
  const r = Riesgos.sembrarDesdeDoc08(db, {}, ENC);
  assert.equal(r.total, 16);
  assert.equal(r.enlazados, 0);
  assert.equal(Riesgos.listar(db, {}, ENC).riesgos[0].factor_contexto, '');
});

// --- 4. La acción es una Actividad ------------------------------------------

test('la acción de tratamiento se crea como ACTIVIDAD, no como una tarea nueva', async () => {
  const db = db_();
  sembrarRoles(db);
  Riesgos.sembrarDesdeDoc08(db, {}, ENC);
  const r3 = Riesgos.listar(db, {}, ENC).riesgos.find((x) => x.codigo === 'R3');

  const antes = filas(db, 'ACTIVIDADES').length;
  const r = await Riesgos.asignarAccion(db, { riesgo_id: r3.riesgo_id, responsable_email: 'jefe@homepymes.cl', fecha_compromiso: '2026-09-30' }, ENC);
  assert.equal(r.ok, true);

  const actividades = filas(db, 'ACTIVIDADES');
  assert.equal(actividades.length, antes + 1);
  const act = actividades.find((a) => a.actividad_id === r.actividad_id);
  assert.equal(act.sgc_origen_tipo, 'RIESGO_SGC');
  assert.equal(act.sgc_origen_id, r3.riesgo_id);
  assert.equal(act.responsable_email, 'jefe@homepymes.cl');
  assert.match(act.titulo, /^Riesgo R3:/);

  const despues = Riesgos.listar(db, {}, ENC).riesgos.find((x) => x.codigo === 'R3');
  assert.equal(despues.estado, 'TRATADO');
  assert.ok(despues.tarea);
});

test('no se asigna dos veces ni sin responsable o fecha', async () => {
  const db = db_();
  sembrarRoles(db);
  Riesgos.sembrarDesdeDoc08(db, {}, ENC);
  const r3 = Riesgos.listar(db, {}, ENC).riesgos.find((x) => x.codigo === 'R3');

  assert.match((await Riesgos.asignarAccion(db, { riesgo_id: r3.riesgo_id }, ENC)).message, /responsable/i);
  assert.match((await Riesgos.asignarAccion(db, { riesgo_id: r3.riesgo_id, responsable_email: 'a@b.cl' }, ENC)).message, /fecha comprometida/i);

  await Riesgos.asignarAccion(db, { riesgo_id: r3.riesgo_id, responsable_email: 'a@b.cl', fecha_compromiso: '2026-09-30' }, ENC);
  assert.match((await Riesgos.asignarAccion(db, { riesgo_id: r3.riesgo_id, responsable_email: 'c@d.cl', fecha_compromiso: '2026-10-30' }, ENC)).message, /ya tiene una actividad/i);
});

// --- 5. Validaciones ---------------------------------------------------------

test('la probabilidad y el impacto tienen que estar en la escala del DOC-08', () => {
  const db = db_();
  sembrarRoles(db);
  const base = { clase: 'RIESGO', factor: 'f', descripcion: 'd', impacto: 10 };
  assert.match(Riesgos.guardar(db, Object.assign({}, base, { probabilidad: 0.7 }), ENC).message, /escala/i);
  assert.match(Riesgos.guardar(db, { clase: 'RIESGO', factor: 'f', descripcion: 'd', probabilidad: 0.5, impacto: 7 }, ENC).message, /escala/i);
  assert.equal(Riesgos.guardar(db, Object.assign({}, base, { probabilidad: 0.5 }), ENC).ok, true);
});

test('media revaloración no se guarda: con un solo valor no hay magnitud', () => {
  const db = db_();
  sembrarRoles(db);
  const r = Riesgos.guardar(db, { clase: 'RIESGO', factor: 'f', descripcion: 'd', probabilidad: 0.5, impacto: 10, probabilidad_residual: 0.1 }, ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /necesita probabilidad e impacto/i);
});

test('un riesgo recién identificado puede quedarse sin revaloración', () => {
  const db = db_();
  sembrarRoles(db);
  const r = Riesgos.guardar(db, { clase: 'RIESGO', factor: 'Nuevo', descripcion: 'Riesgo recién detectado', probabilidad: 1.0, impacto: 25 }, ENC);
  assert.equal(r.ok, true);
  const x = Riesgos.listar(db, {}, ENC).riesgos[0];
  assert.equal(x.residual, null);
  assert.equal(x.mejora, null);
});

test('el código correlativo va por clase', () => {
  const db = db_();
  sembrarRoles(db);
  Riesgos.sembrarDesdeDoc08(db, {}, ENC);
  Riesgos.guardar(db, { clase: 'RIESGO', factor: 'f', descripcion: 'd', probabilidad: 0.5, impacto: 10 }, ENC);
  Riesgos.guardar(db, { clase: 'OPORTUNIDAD', factor: 'o', descripcion: 'd', probabilidad: 0.5, impacto: 10 }, ENC);

  const d = Riesgos.listar(db, {}, ENC);
  assert.ok(d.riesgos.some((x) => x.codigo === 'R12'));
  assert.ok(d.oportunidades.some((x) => x.codigo === 'O6'));
});

test('solo el Encargado del SGC edita la matriz', () => {
  const db = db_();
  sembrarRoles(db);
  assert.equal(Riesgos.sembrarDesdeDoc08(db, {}, OPERATIVO)._forbidden, true);
  assert.equal(Riesgos.guardar(db, { clase: 'RIESGO', factor: 'f', descripcion: 'd', probabilidad: 0.5, impacto: 10 }, OPERATIVO)._forbidden, true);
  assert.equal(filas(db, 'SGC_RIESGOS').length, 0);

  assert.equal(Riesgos.listar(db, {}, OPERATIVO)._forbidden, true);
});

// --- 6. Efecto en la matriz de cobertura ------------------------------------

test('6.1 pasa de faltante a parcial al cargar la matriz, y dice qué falta', () => {
  const db = db_();
  sembrarRoles(db);
  assert.equal(clausula(db, '6.1').estado, 'FALTANTE');

  Riesgos.sembrarDesdeDoc08(db, {}, ENC);

  const d = MatrizCobertura.getDetalle(db, { codigo: '6.1' }, ENC);
  assert.equal(d.estado, 'PARCIAL');
  assert.match(d.nota, /ninguna acción está asignada como actividad/i);
  assert.match(d.resumen, /11 riesgos y 5 oportunidades/);
});

test('6.1 se cierra cuando las acciones están asignadas', async () => {
  const db = db_();
  sembrarRoles(db);
  Riesgos.sembrarDesdeDoc08(db, {}, ENC);
  const r3 = Riesgos.listar(db, {}, ENC).riesgos.find((x) => x.codigo === 'R3');
  await Riesgos.asignarAccion(db, { riesgo_id: r3.riesgo_id, responsable_email: 'jefe@homepymes.cl', fecha_compromiso: '2026-09-30' }, ENC);

  assert.equal(clausula(db, '6.1').estado, 'COMPLETO');
});

test('un riesgo alto sin revalorar mantiene 6.1 en parcial', async () => {
  const db = db_();
  sembrarRoles(db);
  Riesgos.sembrarDesdeDoc08(db, {}, ENC);
  const r3 = Riesgos.listar(db, {}, ENC).riesgos.find((x) => x.codigo === 'R3');
  await Riesgos.asignarAccion(db, { riesgo_id: r3.riesgo_id, responsable_email: 'jefe@homepymes.cl', fecha_compromiso: '2026-09-30' }, ENC);
  assert.equal(clausula(db, '6.1').estado, 'COMPLETO');

  actualizarFilaPorId_(db, 'SGC_RIESGOS', 'riesgo_id', r3.riesgo_id, { probabilidad_residual: '', impacto_residual: '' });

  const d = MatrizCobertura.getDetalle(db, { codigo: '6.1' }, ENC);
  assert.equal(d.estado, 'PARCIAL');
  assert.match(d.nota, /sin revaloración tras los controles/i);
});

test('una matriz sin revisar en más de un año degrada 6.1', async () => {
  const db = db_();
  sembrarRoles(db);
  Riesgos.sembrarDesdeDoc08(db, {}, ENC);
  const r3 = Riesgos.listar(db, {}, ENC).riesgos.find((x) => x.codigo === 'R3');
  await Riesgos.asignarAccion(db, { riesgo_id: r3.riesgo_id, responsable_email: 'jefe@homepymes.cl', fecha_compromiso: '2026-09-30' }, ENC);
  assert.equal(clausula(db, '6.1').estado, 'COMPLETO');

  filas(db, 'SGC_RIESGOS').forEach((x) => actualizarFilaPorId_(db, 'SGC_RIESGOS', 'riesgo_id', x.riesgo_id, { fecha_ultima_revision: '2024-02-01' }));

  assert.equal(clausula(db, '6.1').estado, 'PARCIAL');
  assert.match(MatrizCobertura.getDetalle(db, { codigo: '6.1' }, ENC).nota, /última revisión tiene \d+ meses/i);

  Riesgos.registrarRevision(db, {}, ENC);
  assert.equal(clausula(db, '6.1').estado, 'COMPLETO');
});
