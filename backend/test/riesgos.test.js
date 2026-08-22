'use strict';

// v11.0 Fase 3 — riesgos y oportunidades (§6.1).
//
// Lo que protegen estos tests, por orden de importancia:
//  1. Que la magnitud y su banda se CALCULEN. Es la mitad del valor de la
//     fase: en el DOC-08 original 7 de las 32 valoraciones no coinciden con
//     su propia tabla de criterios, y calculandolas deja de ser posible.
//  2. Que los bordes de banda (2,5 · 10 · 25) caigan del lado correcto. La
//     tabla del documento usa el limite INFERIOR inclusivo, y ahi es donde
//     estan casi todas las discrepancias.
//  3. Que en una OPORTUNIDAD la lectura se invierta: magnitud alta es buena
//     y "mejora" significa SUBIR. Sin esto media matriz se muestra al reves.
//  4. Que la accion de tratamiento sea una ACTIVIDAD del motor existente y
//     no un tercer sistema de tareas.
//  5. Que §6.1 no se de por cumplida solo por tener la matriz: la norma pide
//     abordar los riesgos, no listarlos.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'raiz' }
  });
  [
    'SGC_RIESGOS', 'SGC_CONTEXTO', 'SGC_PARTES_INTERESADAS', 'SGC_ALCANCE', 'SGC_EXCLUSIONES',
    'SGC_ROLES', 'SGC_DOCUMENTOS', 'SGC_DOC_VERSIONES', 'SGC_DOC_DESTINATARIOS', 'SGC_DOC_ACUSES',
    'SGC_PERSONAS', 'SGC_DESCRIPTORES', 'SGC_PERSONA_DOCUMENTOS', 'SGC_INDUCCIONES',
    'SGC_EVALUACIONES', 'SGC_CAPACITACIONES', 'SGC_CAPACITACION_ASISTENTES', 'SGC_NC',
    'SGC_AUDITORIAS', 'SGC_AUD_HALLAZGOS', 'SGC_QUEJAS', 'SGC_PROVEEDORES',
    'SGC_PROVEEDOR_EVALUACIONES', 'SGC_REVISIONES', 'SGC_REVISION_ACUERDOS', 'SGC_OBJETIVOS',
    'SGC_INDICADOR_LECTURAS', 'ACTIVIDADES', 'ACTIVIDADES_BITACORA', 'NOVEDADES',
    'LOG_SISTEMA', 'USUARIOS', 'CUENTAS_PORTAL', 'AREAS'
  ].forEach((hoja) => { if (ctx.COLUMNAS[hoja]) seedSheet(ctx, hoja, ctx.COLUMNAS[hoja]); });

  seedSheet(ctx, 'SGC_ROLES', ctx.COLUMNAS.SGC_ROLES, [
    ['R1', 'sgc@homepymes.cl', 'ENCARGADO_SGC', '', '', true, new Date().toISOString()],
    ['R2', 'operativo@homepymes.cl', 'OPERATIVO', 'CONTABILIDAD', '', true, new Date().toISOString()]
  ]);
  return ctx;
}

const ENC = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const OPERATIVO = { email: 'operativo@homepymes.cl', nombre: 'Operativo', rol: 'DEV' };

function clausula(ctx, codigo) {
  return ctx.MatrizCobertura.listar({}, ENC).clausulas.filter((c) => c.codigo === codigo)[0];
}

// --- 1. El cálculo: el corazón de la fase -----------------------------------

test('la magnitud es probabilidad × impacto y la banda sale de la tabla de criterios', () => {
  const ctx = loadConSchema();
  assert.deepEqual(toPlain(ctx.valorarRiesgo_(0.5, 10)), { magnitud: 5, banda: 'Moderado', tono: 'info' });
  assert.deepEqual(toPlain(ctx.valorarRiesgo_(1.0, 25)), { magnitud: 25, banda: 'Crítico', tono: 'critico' });
  assert.deepEqual(toPlain(ctx.valorarRiesgo_(0.1, 1)), { magnitud: 0.1, banda: 'Insignificante', tono: 'neutro' });
  assert.deepEqual(toPlain(ctx.valorarRiesgo_(1.0, 50)), { magnitud: 50, banda: 'Crítico', tono: 'critico' });
});

test('los bordes de banda caen del lado inferior, como dice la tabla del DOC-08', () => {
  const ctx = loadConSchema();
  // "Alto: 10 ≤ X > 25" y "Crítico: 25 ≤ X ≥ 50": el <= va del lado bajo.
  assert.equal(ctx.valorarRiesgo_(1.0, 10).banda, 'Alto', '10 es Alto, no Moderado');
  assert.equal(ctx.valorarRiesgo_(1.0, 25).banda, 'Crítico', '25 es Crítico, no Alto');
  assert.equal(ctx.valorarRiesgo_(0.1, 25).banda, 'Moderado', '2,5 es Moderado, no Bajo');
  // Y justo por debajo de cada borde:
  assert.equal(ctx.valorarRiesgo_(0.5, 10).banda, 'Moderado', '5 sigue siendo Moderado');
  assert.equal(ctx.valorarRiesgo_(0.5, 25).banda, 'Alto', '12,5 sigue siendo Alto');
});

test('una valoración incompleta no inventa una magnitud', () => {
  const ctx = loadConSchema();
  assert.equal(ctx.valorarRiesgo_('', 10), null);
  assert.equal(ctx.valorarRiesgo_(0.5, ''), null);
  assert.equal(ctx.valorarRiesgo_(0, 10), null);
});

test('las siete valoraciones que el DOC-08 rotula mal se corrigen solas', () => {
  const ctx = loadConSchema();
  // Rotulos tal como vienen en el documento.
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
  [].concat(toPlain(ctx.RIESGOS_PROPUESTOS_DOC08), toPlain(ctx.OPORTUNIDADES_PROPUESTAS_DOC08))
    .forEach((r) => {
      if (ctx.valorarRiesgo_(r.probabilidad, r.impacto).banda !== docInherente[r.codigo]) {
        discrepancias.push(r.codigo + ' inherente');
      }
      if (ctx.valorarRiesgo_(r.probabilidad_residual, r.impacto_residual).banda !== docResidual[r.codigo]) {
        discrepancias.push(r.codigo + ' residual');
      }
    });

  assert.deepEqual(discrepancias.sort(), [
    'O1 inherente', 'O2 residual', 'O4 inherente', 'O5 residual',
    'R10 inherente', 'R4 residual', 'R6 residual'
  ].sort(), 'si este set cambia, alguien tocó la escala o los datos del documento');

  // La más clara de todas: 0,1 × 10 = 1, que es "Bajo" en cualquier lectura
  // de la tabla, y el documento lo rotula "Moderado".
  assert.equal(ctx.valorarRiesgo_(0.1, 10).banda, 'Bajo');
});

// --- 2. Oportunidades: la lectura invertida ---------------------------------

test('en una oportunidad, una magnitud alta NO se pinta de rojo', () => {
  const ctx = loadConSchema();
  const alto = ctx.valorarRiesgo_(1.0, 25);
  assert.equal(ctx.tonoValoracion_(alto, 'RIESGO'), 'critico');
  assert.equal(ctx.tonoValoracion_(alto, 'OPORTUNIDAD'), 'ok',
    'una oportunidad crítica es la mejor que hay, no la peor');
});

test('en una oportunidad, "mejora" significa que la magnitud SUBE', () => {
  const ctx = loadConSchema();
  ctx.Riesgos.sembrarDesdeDoc08({}, ENC);
  const d = ctx.Riesgos.listar({}, ENC);

  const o1 = d.oportunidades.filter((o) => o.codigo === 'O1')[0];
  assert.equal(o1.inherente.magnitud, 25);
  assert.equal(o1.residual.magnitud, 50);
  assert.equal(o1.mejora, true, 'la oportunidad pasó de 25 a 50: eso es mejorar');
  assert.equal(o1.favorable, true);

  const r3 = d.riesgos.filter((r) => r.codigo === 'R3')[0];
  assert.equal(r3.inherente.magnitud, 25);
  assert.equal(r3.residual.magnitud, 5);
  assert.equal(r3.mejora, true, 'el riesgo bajó de 25 a 5: eso también es mejorar');
  assert.equal(r3.favorable, false);

  const r8 = d.riesgos.filter((r) => r.codigo === 'R8')[0];
  assert.equal(r8.mejora, false, 'R8 queda igual tras los controles');
});

// --- 3. Siembra y enlace con el contexto ------------------------------------

test('se siembran los 16 registros del DOC-08', () => {
  const ctx = loadConSchema();
  const r = ctx.Riesgos.sembrarDesdeDoc08({}, ENC);
  assert.equal(r.total, 16);

  const d = ctx.Riesgos.listar({}, ENC);
  assert.equal(d.riesgos.length, 11);
  assert.equal(d.oportunidades.length, 5);
  assert.match(ctx.Riesgos.sembrarDesdeDoc08({}, ENC).message, /ya está cargada/i);
});

test('cada riesgo se enlaza al factor del FODA que lo origina', () => {
  const ctx = loadConSchema();
  ctx.Contexto.sembrarFoda({}, ENC);
  const r = ctx.Riesgos.sembrarDesdeDoc08({}, ENC);

  assert.equal(r.enlazados, 16, 'los 16 tienen su factor en el DOC-02');

  const d = ctx.Riesgos.listar({}, ENC);
  const r3 = d.riesgos.filter((x) => x.codigo === 'R3')[0];
  assert.match(r3.factor_contexto, /^D3 —/,
    'R3 (contratos formales) sale de la debilidad D3 del FODA');
});

test('sin el FODA cargado la matriz se carga igual, solo que sin enlaces', () => {
  const ctx = loadConSchema();
  const r = ctx.Riesgos.sembrarDesdeDoc08({}, ENC);
  assert.equal(r.total, 16);
  assert.equal(r.enlazados, 0, 'no se inventa un factor que no existe');
  assert.equal(ctx.Riesgos.listar({}, ENC).riesgos[0].factor_contexto, '');
});

// --- 4. La acción es una Actividad ------------------------------------------

test('la acción de tratamiento se crea como ACTIVIDAD, no como una tarea nueva', () => {
  const ctx = loadConSchema();
  ctx.Riesgos.sembrarDesdeDoc08({}, ENC);
  const r3 = ctx.Riesgos.listar({}, ENC).riesgos.filter((x) => x.codigo === 'R3')[0];

  const antes = ctx.leerFilasSeguro_(ctx.SHEETS.ACTIVIDADES).length;
  const r = ctx.Riesgos.asignarAccion({
    riesgo_id: r3.riesgo_id, responsable_email: 'jefe@homepymes.cl', fecha_compromiso: '2026-09-30'
  }, ENC);
  assert.equal(r.ok, true);

  const actividades = ctx.leerFilasSeguro_(ctx.SHEETS.ACTIVIDADES);
  assert.equal(actividades.length, antes + 1);
  const act = actividades.filter((a) => a.actividad_id === r.actividad_id)[0];
  assert.equal(act.sgc_origen_tipo, 'RIESGO_SGC', 'queda trazada al riesgo');
  assert.equal(act.sgc_origen_id, r3.riesgo_id);
  assert.equal(act.responsable_email, 'jefe@homepymes.cl');
  assert.match(act.titulo, /^Riesgo R3:/);

  // Y el riesgo pasa a TRATADO.
  const despues = ctx.Riesgos.listar({}, ENC).riesgos.filter((x) => x.codigo === 'R3')[0];
  assert.equal(despues.estado, 'TRATADO');
  assert.ok(despues.tarea, 'la tarjeta muestra el estado de la actividad');
});

test('no se asigna dos veces ni sin responsable o fecha', () => {
  const ctx = loadConSchema();
  ctx.Riesgos.sembrarDesdeDoc08({}, ENC);
  const r3 = ctx.Riesgos.listar({}, ENC).riesgos.filter((x) => x.codigo === 'R3')[0];

  assert.match(ctx.Riesgos.asignarAccion({ riesgo_id: r3.riesgo_id }, ENC).message, /responsable/i);
  assert.match(
    ctx.Riesgos.asignarAccion({ riesgo_id: r3.riesgo_id, responsable_email: 'a@b.cl' }, ENC).message,
    /fecha comprometida/i);

  ctx.Riesgos.asignarAccion({ riesgo_id: r3.riesgo_id, responsable_email: 'a@b.cl', fecha_compromiso: '2026-09-30' }, ENC);
  assert.match(
    ctx.Riesgos.asignarAccion({ riesgo_id: r3.riesgo_id, responsable_email: 'c@d.cl', fecha_compromiso: '2026-10-30' }, ENC).message,
    /ya tiene una actividad/i);
});

// --- 5. Validaciones ---------------------------------------------------------

test('la probabilidad y el impacto tienen que estar en la escala del DOC-08', () => {
  const ctx = loadConSchema();
  const base = { clase: 'RIESGO', factor: 'f', descripcion: 'd', impacto: 10 };
  assert.match(ctx.Riesgos.guardar(Object.assign({}, base, { probabilidad: 0.7 }), ENC).message, /escala/i);
  assert.match(ctx.Riesgos.guardar({ clase: 'RIESGO', factor: 'f', descripcion: 'd', probabilidad: 0.5, impacto: 7 }, ENC).message, /escala/i);
  assert.equal(ctx.Riesgos.guardar(Object.assign({}, base, { probabilidad: 0.5 }), ENC).ok, true);
});

test('media revaloración no se guarda: con un solo valor no hay magnitud', () => {
  const ctx = loadConSchema();
  const r = ctx.Riesgos.guardar({
    clase: 'RIESGO', factor: 'f', descripcion: 'd', probabilidad: 0.5, impacto: 10,
    probabilidad_residual: 0.1
  }, ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /necesita probabilidad e impacto/i);
});

test('un riesgo recién identificado puede quedarse sin revaloración', () => {
  const ctx = loadConSchema();
  const r = ctx.Riesgos.guardar({
    clase: 'RIESGO', factor: 'Nuevo', descripcion: 'Riesgo recién detectado', probabilidad: 1.0, impacto: 25
  }, ENC);
  assert.equal(r.ok, true);
  const x = ctx.Riesgos.listar({}, ENC).riesgos[0];
  assert.equal(x.residual, null, 'todavía no se ha tratado, y eso es válido');
  assert.equal(x.mejora, null);
});

test('el código correlativo va por clase', () => {
  const ctx = loadConSchema();
  ctx.Riesgos.sembrarDesdeDoc08({}, ENC);
  ctx.Riesgos.guardar({ clase: 'RIESGO', factor: 'f', descripcion: 'd', probabilidad: 0.5, impacto: 10 }, ENC);
  ctx.Riesgos.guardar({ clase: 'OPORTUNIDAD', factor: 'o', descripcion: 'd', probabilidad: 0.5, impacto: 10 }, ENC);

  const d = ctx.Riesgos.listar({}, ENC);
  assert.ok(d.riesgos.some((x) => x.codigo === 'R12'), 'el DOC-08 traía 11 riesgos');
  assert.ok(d.oportunidades.some((x) => x.codigo === 'O6'), 'y 5 oportunidades');
});

test('solo el Encargado del SGC edita la matriz', () => {
  const ctx = loadConSchema();
  assert.equal(ctx.Riesgos.sembrarDesdeDoc08({}, OPERATIVO)._forbidden, true);
  assert.equal(ctx.Riesgos.guardar({ clase: 'RIESGO', factor: 'f', descripcion: 'd', probabilidad: 0.5, impacto: 10 }, OPERATIVO)._forbidden, true);
  assert.equal(ctx.leerFilasSeguro_(ctx.SHEETS.SGC_RIESGOS).length, 0);

  // Y a diferencia del contexto, un operativo tampoco la LEE: expone
  // debilidades del negocio que no corresponde repartir.
  assert.equal(ctx.Riesgos.listar({}, OPERATIVO)._forbidden, true);
});

// --- 6. Efecto en la matriz de cobertura ------------------------------------

test('6.1 pasa de faltante a parcial al cargar la matriz, y dice qué falta', () => {
  const ctx = loadConSchema();
  assert.equal(clausula(ctx, '6.1').estado, 'FALTANTE');

  ctx.Riesgos.sembrarDesdeDoc08({}, ENC);

  const d = ctx.MatrizCobertura.getDetalle({ codigo: '6.1' }, ENC);
  assert.equal(d.estado, 'PARCIAL', 'tener la matriz no es haber abordado los riesgos');
  assert.match(d.nota, /ninguna acción está asignada como actividad/i);
  assert.match(d.resumen, /11 riesgos y 5 oportunidades/);
});

test('6.1 se cierra cuando las acciones están asignadas', () => {
  const ctx = loadConSchema();
  ctx.Riesgos.sembrarDesdeDoc08({}, ENC);
  const r3 = ctx.Riesgos.listar({}, ENC).riesgos.filter((x) => x.codigo === 'R3')[0];
  ctx.Riesgos.asignarAccion({
    riesgo_id: r3.riesgo_id, responsable_email: 'jefe@homepymes.cl', fecha_compromiso: '2026-09-30'
  }, ENC);

  assert.equal(clausula(ctx, '6.1').estado, 'COMPLETO');
});

test('un riesgo alto sin revalorar mantiene 6.1 en parcial', () => {
  const ctx = loadConSchema();
  ctx.Riesgos.sembrarDesdeDoc08({}, ENC);
  const r3 = ctx.Riesgos.listar({}, ENC).riesgos.filter((x) => x.codigo === 'R3')[0];
  ctx.Riesgos.asignarAccion({
    riesgo_id: r3.riesgo_id, responsable_email: 'jefe@homepymes.cl', fecha_compromiso: '2026-09-30'
  }, ENC);
  assert.equal(clausula(ctx, '6.1').estado, 'COMPLETO');

  // Se le quita la revaloración a un riesgo crítico.
  ctx.actualizarFilaPorId_(ctx.SHEETS.SGC_RIESGOS, 'riesgo_id', r3.riesgo_id,
    { probabilidad_residual: '', impacto_residual: '' });

  const d = ctx.MatrizCobertura.getDetalle({ codigo: '6.1' }, ENC);
  assert.equal(d.estado, 'PARCIAL');
  assert.match(d.nota, /sin revaloración tras los controles/i);
});

test('una matriz sin revisar en más de un año degrada 6.1', () => {
  const ctx = loadConSchema();
  ctx.Riesgos.sembrarDesdeDoc08({}, ENC);
  const r3 = ctx.Riesgos.listar({}, ENC).riesgos.filter((x) => x.codigo === 'R3')[0];
  ctx.Riesgos.asignarAccion({
    riesgo_id: r3.riesgo_id, responsable_email: 'jefe@homepymes.cl', fecha_compromiso: '2026-09-30'
  }, ENC);
  assert.equal(clausula(ctx, '6.1').estado, 'COMPLETO');

  ctx.leerFilasSeguro_(ctx.SHEETS.SGC_RIESGOS).forEach((x) => {
    ctx.actualizarFilaPorId_(ctx.SHEETS.SGC_RIESGOS, 'riesgo_id', x.riesgo_id,
      { fecha_ultima_revision: '2024-02-01' });
  });

  assert.equal(clausula(ctx, '6.1').estado, 'PARCIAL');
  assert.match(ctx.MatrizCobertura.getDetalle({ codigo: '6.1' }, ENC).nota, /última revisión tiene \d+ meses/i);

  ctx.Riesgos.registrarRevision({}, ENC);
  assert.equal(clausula(ctx, '6.1').estado, 'COMPLETO');
});
