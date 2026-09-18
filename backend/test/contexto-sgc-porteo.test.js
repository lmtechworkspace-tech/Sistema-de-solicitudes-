'use strict';

/**
 * Prueba de portabilidad: SGC ISO 9001 v11.0 Fase 2 (contexto de la
 * organización §4.1 + partes interesadas §4.2) -- mismos escenarios de
 * contexto.test.js, corridos contra backend/logica/contextoSgc.js,
 * incluido su efecto en backend/logica/matrizCoberturaSgc.js (que ya deja
 * de usar los stubs de Contexto en este incremento).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, leerFilas_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('../logica/calidadSgc');
const Contexto = require('../logica/contextoSgc');
const MatrizCobertura = require('../logica/matrizCoberturaSgc');

const TABLAS = [
  'SGC_CONTEXTO', 'SGC_PARTES_INTERESADAS', 'SGC_ALCANCE', 'SGC_EXCLUSIONES',
  'SGC_ROLES', 'SGC_DOCUMENTOS', 'SGC_DOC_VERSIONES', 'SGC_DOC_DESTINATARIOS',
  'SGC_DOC_ACUSES', 'SGC_PERSONAS', 'SGC_DESCRIPTORES', 'SGC_PERSONA_DOCUMENTOS',
  'SGC_INDUCCIONES', 'SGC_EVALUACIONES', 'SGC_CAPACITACIONES',
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
function clausula(db, codigo) {
  return MatrizCobertura.listar(db, {}, ENC).clausulas.find((c) => c.codigo === codigo);
}
function envejecerContexto(db, fecha) {
  filas(db, 'SGC_CONTEXTO').forEach((f) => actualizarFilaPorId_(db, 'SGC_CONTEXTO', 'factor_id', f.factor_id, { fecha_ultima_revision: fecha }));
}

// --- 1. Nada se siembra solo -------------------------------------------------

test('sin contexto cargado se OFRECEN las propuestas, pero la planilla sigue vacía', () => {
  const db = db_();
  sembrarRoles(db);
  const r = Contexto.obtener(db, {}, ENC);

  assert.equal(r.factores.length, 0);
  assert.equal(r.partes.length, 0);
  assert.equal(r.propuesta_foda.length, 24);
  assert.equal(r.propuesta_partes.length, 4);
  assert.equal(filas(db, 'SGC_CONTEXTO').length, 0);
  assert.equal(filas(db, 'SGC_PARTES_INTERESADAS').length, 0);
});

test('el FODA sembrado tiene los cuatro cuadrantes del DOC-02, con sus cantidades', () => {
  const db = db_();
  sembrarRoles(db);
  assert.equal(Contexto.sembrarFoda(db, {}, ENC).total, 24);

  const r = Contexto.obtener(db, {}, ENC);
  assert.deepEqual(r.resumen.por_tipo, { FORTALEZA: 7, OPORTUNIDAD: 6, DEBILIDAD: 7, AMENAZA: 4 });

  const internos = r.factores.filter((f) => f.origen === 'INTERNO');
  assert.equal(internos.length, 14);
  assert.ok(r.factores.every((f) => (f.tipo === 'FORTALEZA' || f.tipo === 'DEBILIDAD') === (f.origen === 'INTERNO')));
});

test('los factores se pueden citar por código corto', () => {
  const db = db_();
  sembrarRoles(db);
  Contexto.sembrarFoda(db, {}, ENC);
  const r = Contexto.obtener(db, {}, ENC);

  const d3 = r.factores.find((f) => f.codigo === 'D3');
  assert.ok(d3);
  assert.match(d3.descripcion, /contratos formales/i);
});

test('no se siembra dos veces', () => {
  const db = db_();
  sembrarRoles(db);
  Contexto.sembrarFoda(db, {}, ENC);
  assert.match(Contexto.sembrarFoda(db, {}, ENC).message, /ya está cargado/i);
  assert.equal(filas(db, 'SGC_CONTEXTO').length, 24);
});

test('solo el Encargado del SGC edita el contexto, pero cualquiera lo lee', () => {
  const db = db_();
  sembrarRoles(db);
  assert.equal(Contexto.sembrarFoda(db, {}, OPERATIVO)._forbidden, true);
  assert.equal(Contexto.sembrarPartes(db, {}, OPERATIVO)._forbidden, true);
  assert.equal(filas(db, 'SGC_CONTEXTO').length, 0);

  assert.equal(Contexto.obtener(db, {}, OPERATIVO).puede_gestionar, false);
  assert.ok(Array.isArray(Contexto.obtener(db, {}, OPERATIVO).factores));
});

// --- 2. Partes interesadas ---------------------------------------------------

test('las partes sembradas son las del DOC-04, con sus seis columnas reales', () => {
  const db = db_();
  sembrarRoles(db);
  assert.equal(Contexto.sembrarPartes(db, {}, ENC).total, 4);

  const partes = Contexto.obtener(db, {}, ENC).partes;
  assert.deepEqual(partes.map((p) => p.nombre), ['Clientes (Pymes y Contratistas)', 'Alta Dirección', 'Colaboradores Internos', 'Proveedores (Plataformas)']);
  assert.ok(partes.every((p) => p.necesidades && p.expectativa && p.efecto_sgc && p.impacto && p.influencia));
});

test('los campos de seguimiento van vacíos: el DOC-04 no los trae', () => {
  const db = db_();
  sembrarRoles(db);
  Contexto.sembrarPartes(db, {}, ENC);
  const partes = Contexto.obtener(db, {}, ENC).partes;

  assert.ok(partes.every((p) => p.metodo_seguimiento === ''));
  assert.ok(partes.every((p) => p.frecuencia_seguimiento === ''));
  assert.ok(partes.every((p) => p.responsable_email === ''));
});

test('una parte interesada sin necesidades no se guarda', () => {
  const db = db_();
  sembrarRoles(db);
  const r = Contexto.guardarParte(db, { nombre: 'Municipalidad', impacto: 'Alto', influencia: 'Bajo' }, ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /necesidades o requisitos/i);
});

test('el impacto y la influencia solo aceptan Alto, Medio o Bajo', () => {
  const db = db_();
  sembrarRoles(db);
  assert.match(Contexto.guardarParte(db, { nombre: 'X', necesidades: 'y', impacto: 'Altísimo', influencia: 'Alto' }, ENC).message, /Alto, Medio o Bajo/);

  const ok = Contexto.guardarParte(db, { nombre: 'X', necesidades: 'y', impacto: 'alto', influencia: 'MEDIO' }, ENC);
  assert.equal(ok.ok, true);
  assert.equal(Contexto.obtener(db, {}, ENC).partes[0].impacto, 'Alto');
});

// --- 3. Numeración y edición -------------------------------------------------

test('un factor nuevo sigue la numeración de su cuadrante, no la global', () => {
  const db = db_();
  sembrarRoles(db);
  Contexto.sembrarFoda(db, {}, ENC);

  const r = Contexto.guardarFactor(db, { tipo: 'DEBILIDAD', descripcion: 'Factor nuevo.' }, ENC);
  const creado = Contexto.obtener(db, {}, ENC).factores.find((f) => f.factor_id === r.factor_id);
  assert.equal(creado.codigo, 'D8');

  const r2 = Contexto.guardarFactor(db, { tipo: 'AMENAZA', descripcion: 'Otro factor.' }, ENC);
  const creado2 = Contexto.obtener(db, {}, ENC).factores.find((f) => f.factor_id === r2.factor_id);
  assert.equal(creado2.codigo, 'A5');
});

test('un factor superado se conserva y deja de contar', () => {
  const db = db_();
  sembrarRoles(db);
  Contexto.sembrarFoda(db, {}, ENC);
  const d1 = Contexto.obtener(db, {}, ENC).factores.find((f) => f.codigo === 'D1');

  Contexto.guardarFactor(db, { factor_id: d1.factor_id, tipo: 'DEBILIDAD', descripcion: d1.descripcion, estado: 'SUPERADO' }, ENC);

  const r = Contexto.obtener(db, {}, ENC);
  assert.equal(r.resumen.por_tipo.DEBILIDAD, 6);
  assert.equal(r.resumen.superados, 1);
  assert.equal(r.factores.length, 24);
});

test('el tipo tiene que ser uno de los cuatro cuadrantes', () => {
  const db = db_();
  sembrarRoles(db);
  assert.match(Contexto.guardarFactor(db, { tipo: 'RIESGO', descripcion: 'x' }, ENC).message, /fortaleza, oportunidad, debilidad o amenaza/i);
});

// --- 4. Seguimiento y revisión: el corazón de §4.1 y §4.2 --------------------

test('4.1 y 4.2 pasan de faltante a completo al cargar el contexto', () => {
  const db = db_();
  sembrarRoles(db);
  assert.equal(clausula(db, '4.1').estado, 'FALTANTE');
  assert.equal(clausula(db, '4.2').estado, 'FALTANTE');

  Contexto.sembrarFoda(db, {}, ENC);
  Contexto.sembrarPartes(db, {}, ENC);

  assert.equal(clausula(db, '4.1').estado, 'COMPLETO');
  assert.equal(clausula(db, '4.2').estado, 'COMPLETO');
});

test('un contexto sin revisar degrada 4.1 aunque esté completo', () => {
  const db = db_();
  sembrarRoles(db);
  Contexto.sembrarFoda(db, {}, ENC);
  Contexto.sembrarPartes(db, {}, ENC);
  assert.equal(clausula(db, '4.1').estado, 'COMPLETO');

  envejecerContexto(db, '2024-01-15');

  const d = MatrizCobertura.getDetalle(db, { codigo: '4.1' }, ENC);
  assert.equal(d.estado, 'PARCIAL');
  assert.match(d.nota, /última revisión tiene \d+ meses/i);
});

test('la vigencia se mide por la fecha MÁS ANTIGUA, no la más reciente', () => {
  const db = db_();
  sembrarRoles(db);
  Contexto.sembrarFoda(db, {}, ENC);
  Contexto.sembrarPartes(db, {}, ENC);
  envejecerContexto(db, '2024-01-15');

  const parte = filas(db, 'SGC_PARTES_INTERESADAS')[0];
  actualizarFilaPorId_(db, 'SGC_PARTES_INTERESADAS', 'parte_id', parte.parte_id, { fecha_ultima_revision: new Date().toISOString().slice(0, 10) });

  assert.equal(Contexto.obtener(db, {}, ENC).resumen.revision_vencida, true);
  assert.equal(clausula(db, '4.1').estado, 'PARCIAL');
});

test('registrar la revisión deja constancia sin tener que cambiar nada', () => {
  const db = db_();
  sembrarRoles(db);
  Contexto.sembrarFoda(db, {}, ENC);
  Contexto.sembrarPartes(db, {}, ENC);
  envejecerContexto(db, '2024-01-15');
  assert.equal(clausula(db, '4.1').estado, 'PARCIAL');

  const r = Contexto.registrarRevision(db, {}, ENC);
  assert.equal(r.ok, true);

  assert.equal(clausula(db, '4.1').estado, 'COMPLETO');
  assert.equal(clausula(db, '4.2').estado, 'COMPLETO');
  assert.equal(Contexto.obtener(db, {}, ENC).resumen.revision_vencida, false);

  const partes = filas(db, 'SGC_PARTES_INTERESADAS');
  const hoy = new Date().toISOString().slice(0, 10);
  assert.ok(partes.every((p) => String(p.fecha_ultima_revision).slice(0, 10) === hoy));
});

test('no se registra una revisión de algo que no existe', () => {
  const db = db_();
  sembrarRoles(db);
  assert.match(Contexto.registrarRevision(db, {}, ENC).message, /nada que revisar/i);
});

test('un FODA al que le falta un cuadrante entero no cierra 4.1', () => {
  const db = db_();
  sembrarRoles(db);
  Contexto.sembrarPartes(db, {}, ENC);
  Contexto.guardarFactor(db, { tipo: 'FORTALEZA', descripcion: 'Única fortaleza.' }, ENC);

  const d = MatrizCobertura.getDetalle(db, { codigo: '4.1' }, ENC);
  assert.equal(d.estado, 'PARCIAL');
  assert.match(d.nota, /oportunidad/i);
  assert.match(d.nota, /debilidad/i);
  assert.match(d.nota, /amenaza/i);
});

test('una parte sin requisitos escritos mantiene 4.2 en parcial', () => {
  const db = db_();
  sembrarRoles(db);
  Contexto.sembrarPartes(db, {}, ENC);
  assert.equal(clausula(db, '4.2').estado, 'COMPLETO');

  const parte = filas(db, 'SGC_PARTES_INTERESADAS')[0];
  actualizarFilaPorId_(db, 'SGC_PARTES_INTERESADAS', 'parte_id', parte.parte_id, { necesidades: '' });

  const d = MatrizCobertura.getDetalle(db, { codigo: '4.2' }, ENC);
  assert.equal(d.estado, 'PARCIAL');
  assert.match(d.nota, /sin necesidades o requisitos/i);
});
