'use strict';

/**
 * Prueba de portabilidad: SGC ISO 9001 v11.0 Fase 1 (alcance y exclusiones,
 * §4.3) -- mismos escenarios de alcance.test.js, corridos contra
 * backend/logica/alcanceSgc.js, incluido su efecto en
 * backend/logica/matrizCoberturaSgc.js (que ya deja de usar el stub de
 * Alcance en este incremento).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, leerFilas_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('../logica/calidadSgc');
const Alcance = require('../logica/alcanceSgc');
const MatrizCobertura = require('../logica/matrizCoberturaSgc');

const TABLAS = [
  'SGC_ALCANCE', 'SGC_EXCLUSIONES', 'SGC_ROLES', 'SGC_DOCUMENTOS', 'SGC_DOC_VERSIONES',
  'SGC_DOC_DESTINATARIOS', 'SGC_DOC_ACUSES', 'SGC_PERSONAS', 'SGC_DESCRIPTORES',
  'SGC_PERSONA_DOCUMENTOS', 'SGC_INDUCCIONES', 'SGC_EVALUACIONES', 'SGC_CAPACITACIONES',
  'SGC_CAPACITACION_ASISTENTES', 'SGC_NC', 'SGC_AUDITORIAS', 'SGC_AUD_HALLAZGOS',
  'SGC_QUEJAS', 'SGC_PROVEEDORES', 'SGC_PROVEEDOR_EVALUACIONES', 'SGC_REVISIONES',
  'SGC_REVISION_ACUERDOS', 'SGC_OBJETIVOS', 'SGC_INDICADOR_LECTURAS', 'SGC_COBERTURA_HISTORICO',
  'NOVEDADES', 'ACTIVIDADES', 'LOG_SISTEMA'
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
function declararAlcance(db) {
  const propuesta = Alcance.obtener(db, {}, ENC).propuesta;
  const r = Alcance.guardar(db, propuesta, ENC);
  assert.equal(r.ok, true, 'el alcance propuesto debe poder guardarse tal cual');
  return propuesta;
}
function clausula(db, codigo) {
  return MatrizCobertura.listar(db, {}, ENC).clausulas.find((c) => c.codigo === codigo);
}

// --- 1. Nada se siembra solo -------------------------------------------------

test('sin alcance declarado se OFRECE la propuesta del DOC-01, pero no se guarda', () => {
  const db = db_();
  sembrarRoles(db);
  const r = Alcance.obtener(db, {}, ENC);

  assert.equal(r.alcance, null);
  assert.ok(r.propuesta);
  assert.equal(r.propuesta.exclusiones.length, 2);
  assert.deepEqual(r.propuesta.exclusiones.map((e) => e.clausula).sort(), ['7.1.5.2', '8.5.1 f']);
  assert.ok(r.propuesta.advertencias.length >= 1);
  assert.equal(filas(db, 'SGC_ALCANCE').length, 0);
});

test('solo el Encargado del SGC declara el alcance', () => {
  const db = db_();
  sembrarRoles(db);
  const propuesta = Alcance.obtener(db, {}, ENC).propuesta;

  const negado = Alcance.guardar(db, propuesta, OPERATIVO);
  assert.equal(negado._forbidden, true);
  assert.equal(filas(db, 'SGC_ALCANCE').length, 0);
  assert.equal(Alcance.obtener(db, {}, OPERATIVO).puede_gestionar, false);
});

test('la declaración de alcance y al menos un área son obligatorias', () => {
  const db = db_();
  sembrarRoles(db);
  assert.match(Alcance.guardar(db, { razon_social: 'X', areas: ['A'] }, ENC).message, /declaración de alcance/i);
  assert.match(Alcance.guardar(db, { declaracion: 'd', areas: ['A'] }, ENC).message, /razón social/i);
  assert.match(Alcance.guardar(db, { declaracion: 'd', razon_social: 'X', areas: [] }, ENC).message, /al menos un área/i);
});

// --- 2. Exclusiones ----------------------------------------------------------

test('una exclusión SIN justificación no se puede declarar', () => {
  const db = db_();
  sembrarRoles(db);
  declararAlcance(db);

  const r = Alcance.guardarExclusion(db, { clausula: '7.1.5.2', titulo: 'Trazabilidad' }, ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /justificación es obligatoria/i);
  assert.equal(filas(db, 'SGC_EXCLUSIONES').length, 0);
});

test('la exclusión tiene que corresponder a una cláusula real de la norma', () => {
  const db = db_();
  sembrarRoles(db);
  declararAlcance(db);

  assert.match(Alcance.guardarExclusion(db, { clausula: '99.9', justificacion: 'porque sí' }, ENC).message, /no corresponde a ningún capítulo/i);
  assert.match(Alcance.guardarExclusion(db, { clausula: 'sin formato', justificacion: 'porque sí' }, ENC).message, /formato esperado/i);
});

test('no se puede declarar dos veces la misma cláusula', () => {
  const db = db_();
  sembrarRoles(db);
  declararAlcance(db);
  assert.equal(Alcance.guardarExclusion(db, { clausula: '7.1.5.2', justificacion: 'x' }, ENC).ok, true);
  assert.match(Alcance.guardarExclusion(db, { clausula: '7.1.5.2', justificacion: 'otra' }, ENC).message, /ya está declarada/i);
});

test('la cláusula padre se deriva de los dos primeros segmentos', () => {
  assert.equal(Alcance.clausulaPadreIso_('7.1.5.2'), '7.1');
  assert.equal(Alcance.clausulaPadreIso_('8.5.1 f'), '8.5');
  assert.equal(Alcance.clausulaPadreIso_('8.5.1 f)'), '8.5');
  assert.equal(Alcance.clausulaPadreIso_('8.3'), '8.3');
  assert.equal(Alcance.clausulaPadreIso_('10.2'), '10.2');
  assert.equal(Alcance.clausulaPadreIso_(''), '');
  assert.equal(Alcance.clausulaPadreIso_('sin numeros'), '');
});

// --- 3. Efecto en la matriz de cobertura -------------------------------------

test('excluir una SUB-cláusula anota la cláusula padre pero NO la saca de la evaluación', () => {
  const db = db_();
  sembrarRoles(db);
  declararAlcance(db);

  const antes = clausula(db, '7.1');
  Alcance.guardarExclusion(db, { clausula: '7.1.5.2', titulo: 'Trazabilidad de las mediciones', justificacion: 'No se realizan mediciones con equipos trazables a patrones.' }, ENC);
  const despues = clausula(db, '7.1');

  assert.equal(despues.estado, antes.estado);
  assert.notEqual(despues.estado, 'NO_APLICA');
  assert.equal(despues.exclusiones, 1);

  const detalle = MatrizCobertura.getDetalle(db, { codigo: '7.1' }, ENC);
  assert.match(detalle.nota, /exclusión parcial/i);
  assert.match(detalle.nota, /7\.1\.5\.2/);
  assert.equal(detalle.exclusiones.length, 1);
  assert.equal(detalle.exclusiones[0].total, false);
});

test('excluir una cláusula COMPLETA la marca NO_APLICA y la saca del denominador', () => {
  const db = db_();
  sembrarRoles(db);
  declararAlcance(db);

  const antes = MatrizCobertura.listar(db, {}, ENC).resumen;
  assert.equal(antes.no_aplica, 0);
  assert.equal(antes.aplicables, antes.total);

  Alcance.guardarExclusion(db, { clausula: '8.3', titulo: 'Diseño y desarrollo', justificacion: 'La organización no diseña servicios nuevos: presta servicios definidos por el cliente.' }, ENC);

  assert.equal(clausula(db, '8.3').estado, 'NO_APLICA');

  const despues = MatrizCobertura.listar(db, {}, ENC).resumen;
  assert.equal(despues.no_aplica, 1);
  assert.equal(despues.aplicables, antes.total - 1);
  assert.equal(despues.faltante, antes.faltante - 1);

  const detalle = MatrizCobertura.getDetalle(db, { codigo: '8.3' }, ENC);
  assert.match(detalle.nota, /Exclusión declarada/i);
  assert.match(detalle.nota, /no diseña servicios nuevos/i);
});

test('retirar la exclusión devuelve la cláusula a la evaluación', () => {
  const db = db_();
  sembrarRoles(db);
  declararAlcance(db);
  const r = Alcance.guardarExclusion(db, { clausula: '8.3', justificacion: 'no se diseña' }, ENC);
  assert.equal(clausula(db, '8.3').estado, 'NO_APLICA');

  Alcance.anularExclusion(db, { exclusion_id: r.exclusion_id }, ENC);
  assert.notEqual(clausula(db, '8.3').estado, 'NO_APLICA');
  assert.equal(MatrizCobertura.listar(db, {}, ENC).resumen.no_aplica, 0);
});

test('4.3 pasa de faltante a evaluado cuando el alcance se declara', () => {
  const db = db_();
  sembrarRoles(db);

  const antes = clausula(db, '4.3');
  assert.equal(antes.estado, 'FALTANTE');
  assert.match(antes.resumen, /no está declarado/i);

  declararAlcance(db);

  const despues = clausula(db, '4.3');
  assert.notEqual(despues.estado, 'FALTANTE');
  assert.match(despues.resumen, /Alcance v01 declarado/);
});

test('una exclusión sin justificación en la planilla mantiene 4.3 en parcial', () => {
  const db = db_();
  sembrarRoles(db);
  declararAlcance(db);
  const alcanceId = filas(db, 'SGC_ALCANCE')[0].alcance_id;

  agregarFila_(db, 'SGC_EXCLUSIONES', {
    exclusion_id: 'EX-MANO', alcance_id: alcanceId, clausula: '8.3', clausula_padre: '8.3',
    titulo: 'Diseño', justificacion: '', creado_por: 'alguien', fecha_creacion: new Date().toISOString(), activa: true
  });

  const d = MatrizCobertura.getDetalle(db, { codigo: '4.3' }, ENC);
  assert.equal(d.estado, 'PARCIAL');
  assert.match(d.nota, /sin justificación/i);
});

test('la matriz declara contra qué edición de la norma está midiendo', () => {
  const db = db_();
  sembrarRoles(db);

  const sinDeclarar = MatrizCobertura.listar(db, {}, ENC).norma;
  assert.equal(sinDeclarar.declarada, false);
  assert.equal(sinDeclarar.version, '2015');

  declararAlcance(db);
  const declarada = MatrizCobertura.listar(db, {}, ENC).norma;
  assert.equal(declarada.declarada, true);
  assert.equal(declarada.codigo, 'ISO 9001');
});

test('no se acepta una edición de la norma que el sistema no sabe evaluar', () => {
  const db = db_();
  sembrarRoles(db);
  // Clonar: la propuesta es una constante compartida del módulo (misma
  // referencia en cada llamada, igual que en el .gs); mutarla directo
  // corromperia la semilla para el resto de los tests del proceso.
  const propuesta = Object.assign({}, Alcance.obtener(db, {}, ENC).propuesta);
  propuesta.norma_version = '2026';
  const r = Alcance.guardar(db, propuesta, ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /todavía no evalúa la edición 2026/i);
});

// --- 4. Versionado -----------------------------------------------------------

test('publicar una versión nueva conserva la anterior y arrastra las exclusiones', () => {
  const db = db_();
  sembrarRoles(db);
  const propuesta = declararAlcance(db);
  propuesta.exclusiones.forEach((e) => Alcance.guardarExclusion(db, e, ENC));
  assert.equal(Alcance.obtener(db, {}, ENC).exclusiones.length, 2);

  const nueva = Object.assign({}, propuesta, { declaracion: 'Alcance ampliado a servicios de tesorería.', justificacion_cambio: 'Se incorpora el servicio de tesorería a partir de 2027.' });
  const r = Alcance.nuevaVersion(db, nueva, ENC);
  assert.equal(r.ok, true);
  assert.equal(r.version, '02');

  const estado = Alcance.obtener(db, {}, ENC);
  assert.equal(estado.alcance.version, '02');
  assert.match(estado.alcance.declaracion, /tesorería/);
  assert.equal(estado.exclusiones.length, 2);
  assert.equal(estado.historial.length, 1);
  assert.equal(estado.historial[0].version, '01');
  assert.match(estado.historial[0].observaciones, /tesorería/);
});

test('publicar una versión nueva exige decir por qué cambia', () => {
  const db = db_();
  sembrarRoles(db);
  const propuesta = declararAlcance(db);
  const r = Alcance.nuevaVersion(db, Object.assign({}, propuesta), ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /por qué cambia/i);
  assert.equal(Alcance.obtener(db, {}, ENC).alcance.version, '01');
});

test('corregir el alcance NO crea una versión nueva', () => {
  const db = db_();
  sembrarRoles(db);
  const propuesta = declararAlcance(db);
  Alcance.guardar(db, Object.assign({}, propuesta, { rut: '78.194.394-0' }), ENC);

  const estado = Alcance.obtener(db, {}, ENC);
  assert.equal(estado.alcance.version, '01');
  assert.equal(estado.historial.length, 0);
  assert.equal(filas(db, 'SGC_ALCANCE').length, 1);
});

// --- 5. Los dos defectos de la matriz que esta fase corrige -------------------

test('5.1 dejó de caer al texto genérico: tiene evaluador propio', () => {
  const db = db_();
  sembrarRoles(db);
  const d = MatrizCobertura.getDetalle(db, { codigo: '5.1' }, ENC);

  assert.notEqual(d.resumen, 'Sin evidencia estructurada en el sistema.');
  assert.match(d.nota, /revisiones por la dirección/i);
  assert.match(d.resumen, /revisión\(es\) por la dirección/i);
});

test('5.1 mejora cuando la dirección deja hechos registrados', () => {
  const db = db_();
  sembrarRoles(db);
  const antes = clausula(db, '5.1');
  assert.equal(antes.estado, 'FALTANTE');

  agregarFila_(db, 'SGC_REVISIONES', {
    revision_id: 'REV-1', correlativo: 'RD-2026-01', anio: 2026, fecha_programada: '', aviso_plazo: '', fecha_convocatoria: '',
    fecha_reunion: '', asistentes: '[]', entradas: '[]', conclusiones: '', anexos: '', director_email: '',
    responsable_calidad_email: 'sgc@homepymes.cl', estado: 'CERRADA', fecha_cierre: '2026-08-01', cerrada_por: '',
    creada_por: '', fecha_creacion: new Date().toISOString(), activa: true
  });

  const despues = clausula(db, '5.1');
  assert.equal(despues.estado, 'PARCIAL');
  assert.ok(MatrizCobertura.getDetalle(db, { codigo: '5.1' }, ENC).evidencia.length >= 1);
});

test('la nota de 8.3 ya no sugiere que la cláusula pueda no aplicar por su cuenta', () => {
  const db = db_();
  sembrarRoles(db);
  const d = MatrizCobertura.getDetalle(db, { codigo: '8.3' }, ENC);

  assert.doesNotMatch(d.nota, /puede no aplicar/i);
  assert.match(d.nota, /exclusión/i);
  assert.match(d.nota, /4\.3/);
});
