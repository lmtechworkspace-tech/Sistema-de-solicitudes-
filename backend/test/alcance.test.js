'use strict';

// v11.0 Fase 1 — alcance del SGC y exclusiones (§4.3 de la norma).
//
// Lo que protegen estos tests, por orden de importancia para el auditor:
//  1. Que una exclusion NO se pueda declarar sin justificacion. §4.3 pide
//     explicar por que la clausula no aplica: una exclusion sin justificar
//     no es una exclusion, es una clausula incumplida con otro nombre.
//  2. Que excluir una SUB-clausula (7.1.5.2) no saque de la evaluacion a la
//     clausula entera (7.1). Ese era el vacio que motivo la fase, y
//     degradar 7.1 a "no aplica" seria peor que no tener la funcion.
//  3. Que una clausula excluida salga del DENOMINADOR del porcentaje.
//     Contarla como faltante castiga a la organizacion por una exclusion
//     legitima; contarla como completa le regala un punto que no trabajo.
//  4. Que nada se siembre solo: sin alcance declarado el sistema OFRECE la
//     propuesta del DOC-01, pero no la guarda hasta que alguien la confirma.
//  5. Que publicar una version nueva conserve la anterior y ARRASTRE las
//     exclusiones -- si no, publicar dejaria a la organizacion sin
//     exclusiones declaradas de un dia para otro.
//  6. Los dos defectos de la matriz que esta fase corrige: 5.1 tenia que
//     dejar de caer al texto generico, y la nota de 8.3 tenia que dejar de
//     sugerir que la clausula "puede no aplicar".

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'raiz' }
  });
  [
    'SGC_ALCANCE', 'SGC_EXCLUSIONES', 'SGC_ROLES', 'SGC_DOCUMENTOS', 'SGC_DOC_VERSIONES',
    'SGC_DOC_DESTINATARIOS', 'SGC_DOC_ACUSES', 'SGC_PERSONAS', 'SGC_DESCRIPTORES',
    'SGC_PERSONA_DOCUMENTOS', 'SGC_INDUCCIONES', 'SGC_EVALUACIONES', 'SGC_CAPACITACIONES',
    'SGC_CAPACITACION_ASISTENTES', 'SGC_NC', 'SGC_AUDITORIAS', 'SGC_AUD_HALLAZGOS',
    'SGC_QUEJAS', 'SGC_PROVEEDORES', 'SGC_PROVEEDOR_EVALUACIONES', 'SGC_REVISIONES',
    'SGC_REVISION_ACUERDOS', 'SGC_OBJETIVOS', 'SGC_INDICADOR_LECTURAS',
    'NOVEDADES', 'LOG_SISTEMA', 'USUARIOS', 'CUENTAS_PORTAL'
  ].forEach((hoja) => seedSheet(ctx, hoja, ctx.COLUMNAS[hoja]));

  seedSheet(ctx, 'SGC_ROLES', ctx.COLUMNAS.SGC_ROLES, [
    ['R1', 'sgc@homepymes.cl', 'ENCARGADO_SGC', '', '', true, new Date().toISOString()],
    ['R2', 'operativo@homepymes.cl', 'OPERATIVO', 'CONTABILIDAD', '', true, new Date().toISOString()]
  ]);
  return ctx;
}

const ENC = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const OPERATIVO = { email: 'operativo@homepymes.cl', nombre: 'Operativo', rol: 'DEV' };

function declararAlcance(ctx) {
  const propuesta = ctx.Alcance.obtener({}, ENC).propuesta;
  const r = ctx.Alcance.guardar(propuesta, ENC);
  assert.equal(r.ok, true, 'el alcance propuesto debe poder guardarse tal cual');
  return propuesta;
}

function clausula(ctx, codigo) {
  return ctx.MatrizCobertura.listar({}, ENC).clausulas.filter((c) => c.codigo === codigo)[0];
}

// --- 1. Nada se siembra solo -------------------------------------------------

test('sin alcance declarado se OFRECE la propuesta del DOC-01, pero no se guarda', () => {
  const ctx = loadConSchema();
  const r = ctx.Alcance.obtener({}, ENC);

  assert.equal(r.alcance, null, 'no puede haber un alcance guardado que nadie declaró');
  assert.ok(r.propuesta, 'debe ofrecerse la propuesta transcrita del DOC-01');
  assert.equal(r.propuesta.exclusiones.length, 2, 'el DOC-01 declara dos exclusiones');
  assert.deepEqual(
    toPlain(r.propuesta.exclusiones).map((e) => e.clausula).sort(),
    ['7.1.5.2', '8.5.1 f'],
    'son exactamente las del manual, no unas inventadas'
  );
  // La ambiguedad de Fase 0 (cuatro areas o cinco) viaja con la propuesta en
  // vez de resolverse por cuenta del sistema.
  assert.ok(r.propuesta.advertencias.length >= 1);

  // Y la planilla sigue vacía.
  assert.equal(ctx.leerFilasSeguro_(ctx.SHEETS.SGC_ALCANCE).length, 0);
});

test('solo el Encargado del SGC declara el alcance', () => {
  const ctx = loadConSchema();
  const propuesta = ctx.Alcance.obtener({}, ENC).propuesta;

  const negado = ctx.Alcance.guardar(propuesta, OPERATIVO);
  assert.equal(negado._forbidden, true);
  assert.equal(ctx.leerFilasSeguro_(ctx.SHEETS.SGC_ALCANCE).length, 0);

  // Pero leerlo sí es de todos: §4.3 pide que esté disponible.
  assert.equal(ctx.Alcance.obtener({}, OPERATIVO).puede_gestionar, false);
});

test('la declaración de alcance y al menos un área son obligatorias', () => {
  const ctx = loadConSchema();
  assert.match(ctx.Alcance.guardar({ razon_social: 'X', areas: ['A'] }, ENC).message, /declaración de alcance/i);
  assert.match(ctx.Alcance.guardar({ declaracion: 'd', areas: ['A'] }, ENC).message, /razón social/i);
  assert.match(ctx.Alcance.guardar({ declaracion: 'd', razon_social: 'X', areas: [] }, ENC).message, /al menos un área/i);
});

// --- 2. Exclusiones ----------------------------------------------------------

test('una exclusión SIN justificación no se puede declarar', () => {
  const ctx = loadConSchema();
  declararAlcance(ctx);

  const r = ctx.Alcance.guardarExclusion({ clausula: '7.1.5.2', titulo: 'Trazabilidad' }, ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /justificación es obligatoria/i);
  assert.equal(ctx.leerFilasSeguro_(ctx.SHEETS.SGC_EXCLUSIONES).length, 0);
});

test('la exclusión tiene que corresponder a una cláusula real de la norma', () => {
  const ctx = loadConSchema();
  declararAlcance(ctx);

  assert.match(
    ctx.Alcance.guardarExclusion({ clausula: '99.9', justificacion: 'porque sí' }, ENC).message,
    /no corresponde a ningún capítulo/i
  );
  assert.match(
    ctx.Alcance.guardarExclusion({ clausula: 'sin formato', justificacion: 'porque sí' }, ENC).message,
    /formato esperado/i
  );
});

test('no se puede declarar dos veces la misma cláusula', () => {
  const ctx = loadConSchema();
  declararAlcance(ctx);
  assert.equal(ctx.Alcance.guardarExclusion({ clausula: '7.1.5.2', justificacion: 'x' }, ENC).ok, true);
  assert.match(
    ctx.Alcance.guardarExclusion({ clausula: '7.1.5.2', justificacion: 'otra' }, ENC).message,
    /ya está declarada/i
  );
});

test('la cláusula padre se deriva de los dos primeros segmentos', () => {
  const ctx = loadConSchema();
  assert.equal(ctx.clausulaPadreIso_('7.1.5.2'), '7.1');
  assert.equal(ctx.clausulaPadreIso_('8.5.1 f'), '8.5');
  assert.equal(ctx.clausulaPadreIso_('8.5.1 f)'), '8.5');
  assert.equal(ctx.clausulaPadreIso_('8.3'), '8.3', 'una cláusula ya de primer nivel es su propio padre');
  assert.equal(ctx.clausulaPadreIso_('10.2'), '10.2');
  assert.equal(ctx.clausulaPadreIso_(''), '');
  assert.equal(ctx.clausulaPadreIso_('sin numeros'), '');
});

// --- 3. Efecto en la matriz de cobertura -------------------------------------

test('excluir una SUB-cláusula anota la cláusula padre pero NO la saca de la evaluación', () => {
  const ctx = loadConSchema();
  declararAlcance(ctx);

  const antes = clausula(ctx, '7.1');
  ctx.Alcance.guardarExclusion({
    clausula: '7.1.5.2', titulo: 'Trazabilidad de las mediciones',
    justificacion: 'No se realizan mediciones con equipos trazables a patrones.'
  }, ENC);
  const despues = clausula(ctx, '7.1');

  assert.equal(despues.estado, antes.estado,
    '7.1 sigue aplicando entera menos ese pedazo: su estado no puede cambiar');
  assert.notEqual(despues.estado, 'NO_APLICA');
  assert.equal(despues.exclusiones, 1, 'pero la exclusión queda visible en la fila');

  const detalle = ctx.MatrizCobertura.getDetalle({ codigo: '7.1' }, ENC);
  assert.match(detalle.nota, /exclusión parcial/i);
  assert.match(detalle.nota, /7\.1\.5\.2/);
  assert.equal(detalle.exclusiones.length, 1);
  assert.equal(detalle.exclusiones[0].total, false);
});

test('excluir una cláusula COMPLETA la marca NO_APLICA y la saca del denominador', () => {
  const ctx = loadConSchema();
  declararAlcance(ctx);

  const antes = ctx.MatrizCobertura.listar({}, ENC).resumen;
  assert.equal(antes.no_aplica, 0);
  assert.equal(antes.aplicables, antes.total);

  ctx.Alcance.guardarExclusion({
    clausula: '8.3', titulo: 'Diseño y desarrollo',
    justificacion: 'La organización no diseña servicios nuevos: presta servicios definidos por el cliente.'
  }, ENC);

  const c83 = clausula(ctx, '8.3');
  assert.equal(c83.estado, 'NO_APLICA');

  const despues = ctx.MatrizCobertura.listar({}, ENC).resumen;
  assert.equal(despues.no_aplica, 1);
  assert.equal(despues.aplicables, antes.total - 1, 'sale del denominador, no cuenta como faltante');
  assert.equal(despues.faltante, antes.faltante - 1);

  const detalle = ctx.MatrizCobertura.getDetalle({ codigo: '8.3' }, ENC);
  assert.match(detalle.nota, /Exclusión declarada/i);
  assert.match(detalle.nota, /no diseña servicios nuevos/i,
    'la justificación viaja hasta la pantalla del auditor');
});

test('retirar la exclusión devuelve la cláusula a la evaluación', () => {
  const ctx = loadConSchema();
  declararAlcance(ctx);
  const r = ctx.Alcance.guardarExclusion({ clausula: '8.3', justificacion: 'no se diseña' }, ENC);
  assert.equal(clausula(ctx, '8.3').estado, 'NO_APLICA');

  ctx.Alcance.anularExclusion({ exclusion_id: r.exclusion_id }, ENC);
  assert.notEqual(clausula(ctx, '8.3').estado, 'NO_APLICA');
  assert.equal(ctx.MatrizCobertura.listar({}, ENC).resumen.no_aplica, 0);
});

test('4.3 pasa de faltante a evaluado cuando el alcance se declara', () => {
  const ctx = loadConSchema();

  const antes = clausula(ctx, '4.3');
  assert.equal(antes.estado, 'FALTANTE');
  assert.match(antes.resumen, /no está declarado/i);

  declararAlcance(ctx);

  const despues = clausula(ctx, '4.3');
  assert.notEqual(despues.estado, 'FALTANTE');
  assert.match(despues.resumen, /Alcance v01 declarado/);
});

test('una exclusión sin justificación en la planilla mantiene 4.3 en parcial', () => {
  const ctx = loadConSchema();
  declararAlcance(ctx);
  const alcanceId = ctx.leerFilasSeguro_(ctx.SHEETS.SGC_ALCANCE)[0].alcance_id;

  // Se escribe directo en la hoja: el camino por la API lo impide, pero
  // alguien puede editar la planilla a mano y 4.3 tiene que notarlo.
  ctx.agregarFila_(ctx.SHEETS.SGC_EXCLUSIONES, {
    exclusion_id: 'EX-MANO', alcance_id: alcanceId, clausula: '8.3',
    clausula_padre: '8.3', titulo: 'Diseño', justificacion: '',
    creado_por: 'alguien', fecha_creacion: new Date().toISOString(), activa: true
  });

  const d = ctx.MatrizCobertura.getDetalle({ codigo: '4.3' }, ENC);
  assert.equal(d.estado, 'PARCIAL');
  assert.match(d.nota, /sin justificación/i);
});

test('la matriz declara contra qué edición de la norma está midiendo', () => {
  const ctx = loadConSchema();

  const sinDeclarar = ctx.MatrizCobertura.listar({}, ENC).norma;
  assert.equal(sinDeclarar.declarada, false, 'sin alcance, la norma es la del sistema');
  assert.equal(sinDeclarar.version, '2015');

  declararAlcance(ctx);
  const declarada = ctx.MatrizCobertura.listar({}, ENC).norma;
  assert.equal(declarada.declarada, true, 'con alcance, la norma la declara la organización');
  assert.equal(declarada.codigo, 'ISO 9001');
});

test('no se acepta una edición de la norma que el sistema no sabe evaluar', () => {
  const ctx = loadConSchema();
  const propuesta = ctx.Alcance.obtener({}, ENC).propuesta;
  propuesta.norma_version = '2026';
  const r = ctx.Alcance.guardar(propuesta, ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /todavía no evalúa la edición 2026/i);
});

// --- 4. Versionado -----------------------------------------------------------

test('publicar una versión nueva conserva la anterior y arrastra las exclusiones', () => {
  const ctx = loadConSchema();
  const propuesta = declararAlcance(ctx);
  propuesta.exclusiones.forEach((e) => ctx.Alcance.guardarExclusion(e, ENC));
  assert.equal(ctx.Alcance.obtener({}, ENC).exclusiones.length, 2);

  const nueva = Object.assign({}, propuesta, {
    declaracion: 'Alcance ampliado a servicios de tesorería.',
    justificacion_cambio: 'Se incorpora el servicio de tesorería a partir de 2027.'
  });
  const r = ctx.Alcance.nuevaVersion(nueva, ENC);
  assert.equal(r.ok, true);
  assert.equal(r.version, '02');

  const estado = ctx.Alcance.obtener({}, ENC);
  assert.equal(estado.alcance.version, '02');
  assert.match(estado.alcance.declaracion, /tesorería/);
  assert.equal(estado.exclusiones.length, 2,
    'publicar una versión no puede dejar a la organización sin exclusiones declaradas');
  assert.equal(estado.historial.length, 1);
  assert.equal(estado.historial[0].version, '01');
  assert.match(estado.historial[0].observaciones, /tesorería/);
});

test('publicar una versión nueva exige decir por qué cambia', () => {
  const ctx = loadConSchema();
  const propuesta = declararAlcance(ctx);
  const r = ctx.Alcance.nuevaVersion(Object.assign({}, propuesta), ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /por qué cambia/i);
  assert.equal(ctx.Alcance.obtener({}, ENC).alcance.version, '01', 'nada se publicó');
});

test('corregir el alcance NO crea una versión nueva', () => {
  const ctx = loadConSchema();
  const propuesta = declararAlcance(ctx);
  ctx.Alcance.guardar(Object.assign({}, propuesta, { rut: '78.194.394-0' }), ENC);

  const estado = ctx.Alcance.obtener({}, ENC);
  assert.equal(estado.alcance.version, '01');
  assert.equal(estado.historial.length, 0, 'una corrección de tipeo no archiva nada');
  assert.equal(ctx.leerFilasSeguro_(ctx.SHEETS.SGC_ALCANCE).length, 1);
});

// --- 5. Los dos defectos de la matriz que esta fase corrige -------------------

test('5.1 dejó de caer al texto genérico: tiene evaluador propio', () => {
  const ctx = loadConSchema();
  const d = ctx.MatrizCobertura.getDetalle({ codigo: '5.1' }, ENC);

  assert.notEqual(d.resumen, 'Sin evidencia estructurada en el sistema.',
    'era la única de las 28 sin evaluador ni nota');
  assert.match(d.nota, /revisiones por la dirección/i,
    'y la nota tiene que decir QUÉ falta, como el resto de las cláusulas');
  assert.match(d.resumen, /revisión\(es\) por la dirección/i);
});

test('5.1 mejora cuando la dirección deja hechos registrados', () => {
  const ctx = loadConSchema();
  const antes = clausula(ctx, '5.1');
  assert.equal(antes.estado, 'FALTANTE');

  ctx.agregarFila_(ctx.SHEETS.SGC_REVISIONES, {
    revision_id: 'REV-1', correlativo: 'RD-2026-01', estado: 'CERRADA',
    fecha_cierre: '2026-08-01', responsable_calidad_email: 'sgc@homepymes.cl', activa: true
  });

  const despues = clausula(ctx, '5.1');
  assert.equal(despues.estado, 'PARCIAL', 'un acta cerrada ya es evidencia de liderazgo');
  assert.ok(ctx.MatrizCobertura.getDetalle({ codigo: '5.1' }, ENC).evidencia.length >= 1);
});

test('la nota de 8.3 ya no sugiere que la cláusula pueda no aplicar por su cuenta', () => {
  const ctx = loadConSchema();
  const d = ctx.MatrizCobertura.getDetalle({ codigo: '8.3' }, ENC);

  // El DOC-01 declara que 8.3 SÍ aplica; las únicas exclusiones son 7.1.5.2 y
  // 8.5.1 f). La nota anterior insinuaba lo contrario y contradecía al manual.
  assert.doesNotMatch(d.nota, /puede no aplicar/i);
  assert.match(d.nota, /exclusión/i, 'ahora apunta al lugar donde esa decisión se toma');
  assert.match(d.nota, /4\.3/, 'y a la cláusula que la exige');
});
