'use strict';

// v11.0 Fase 6 — indicadores de proceso (§9.1.1).
//
// Lo que protegen estos tests, por orden de importancia:
//  1. LA NO REGRESION DE LA FASE 6a. Las lecturas de indicador viven en la
//     misma hoja que las de objetivo. Si alguna se colara en el tablero de
//     objetivos, ese tablero -- que es evidencia de §6.2 -- empezaria a
//     mentir. Era el riesgo real de esta fase.
//  2. Que el veredicto tenga tres estados y que la tolerancia sea siempre
//     MAS LAXA que la meta: al reves no existiria zona de alerta.
//  3. Que el veredicto quede CONGELADO en la lectura. Bajar la meta el año
//     que viene no puede reescribir lo que se midio este.
//  4. Que la clave de periodo respete la frecuencia: un indicador semestral
//     no acepta una lectura de marzo.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'raiz' }
  });
  [
    'SGC_INDICADORES', 'SGC_INDICADOR_LECTURAS', 'SGC_OBJETIVOS', 'SGC_PROCESOS',
    'SGC_PROCESO_PASOS', 'SGC_RIESGOS', 'SGC_CONTEXTO', 'SGC_PARTES_INTERESADAS',
    'SGC_ALCANCE', 'SGC_EXCLUSIONES', 'SGC_ROLES', 'SGC_DOCUMENTOS', 'SGC_DOC_VERSIONES',
    'SGC_DOC_DESTINATARIOS', 'SGC_DOC_ACUSES', 'SGC_PERSONAS', 'SGC_DESCRIPTORES',
    'SGC_PERSONA_DOCUMENTOS', 'SGC_INDUCCIONES', 'SGC_EVALUACIONES', 'SGC_CAPACITACIONES',
    'SGC_CAPACITACION_ASISTENTES', 'SGC_NC', 'SGC_AUDITORIAS', 'SGC_AUD_HALLAZGOS',
    'SGC_QUEJAS', 'SGC_PROVEEDORES', 'SGC_PROVEEDOR_EVALUACIONES', 'SGC_REVISIONES',
    'SGC_REVISION_ACUERDOS', 'ACTIVIDADES', 'ACTIVIDADES_BITACORA', 'NOVEDADES',
    'LOG_SISTEMA', 'LOG_NOTIFICACIONES', 'NOTIFICACIONES_APP', 'CONFIG_NOTIFICACIONES',
    'USUARIOS', 'CUENTAS_PORTAL', 'AREAS'
  ].forEach((h) => { if (ctx.COLUMNAS[h]) seedSheet(ctx, h, ctx.COLUMNAS[h]); });

  seedSheet(ctx, 'SGC_ROLES', ctx.COLUMNAS.SGC_ROLES, [
    ['R1', 'sgc@homepymes.cl', 'ENCARGADO_SGC', '', '', true, new Date().toISOString()],
    ['R2', 'operativo@homepymes.cl', 'OPERATIVO', 'CONTABILIDAD', '', true, new Date().toISOString()]
  ]);
  return ctx;
}

const ENC = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const OPERATIVO = { email: 'operativo@homepymes.cl', nombre: 'Operativo', rol: 'DEV' };
const ANIO = new Date().getFullYear();

function crearIndicador(ctx, extra) {
  return ctx.Indicadores.guardar(Object.assign({
    nombre: 'Cumplimiento de plazos',
    formula: 'entregas a tiempo / entregas totales × 100',
    meta_operador: 'MAYOR_IGUAL', meta_valor: 90, tolerancia_valor: 85,
    frecuencia: 'MENSUAL', unidad: 'PORCENTAJE'
  }, extra || {}), ENC);
}

// --- 1. No regresión de la Fase 6a ------------------------------------------

test('las lecturas de indicador NO se cuelan en el tablero de objetivos', () => {
  const ctx = loadConSchema();
  ctx.Objetivos.sembrarAnio({ anio: ANIO }, ENC);
  const antes = toPlain(ctx.Objetivos.listar({ anio: ANIO }, ENC).indicadores);

  const i = crearIndicador(ctx);
  ['M01', 'M02', 'M03'].forEach((p) => {
    ctx.Indicadores.registrarLectura({ indicador_id: i.indicador_id, periodo: ANIO + '-' + p, valor: 95 }, ENC);
  });

  const despues = ctx.Objetivos.listar({ anio: ANIO }, ENC);
  assert.deepEqual(toPlain(despues.indicadores), antes,
    'el tablero de objetivos es evidencia de §6.2: si cambia por esto, empieza a mentir');
  assert.ok(despues.objetivos.every((o) => !o.ultima_lectura),
    'ningún objetivo puede quedar "medido" por una lectura que no es suya');
});

test('un indicador que ALIMENTA un objetivo tampoco lo da por medido', () => {
  // Este es el caso peligroso de verdad: el indicador declara a qué objetivo
  // aporta, así que la tentación es copiarle el objetivo_id a la lectura.
  // Si se hiciera, el objetivo aparecería medido sin que nadie lo midiera, y
  // el tablero de §6.2 pasaría a decir que la organización está siguiendo un
  // objetivo que en realidad no está siguiendo.
  const ctx = loadConSchema();
  ctx.Objetivos.sembrarAnio({ anio: ANIO }, ENC);
  const objetivo = ctx.Objetivos.listar({ anio: ANIO }, ENC).objetivos[0];

  const i = crearIndicador(ctx, { objetivo_id: objetivo.objetivo_id, frecuencia: 'ANUAL', tolerancia_valor: '' });
  ctx.Indicadores.registrarLectura({ indicador_id: i.indicador_id, periodo: String(ANIO), valor: 95 }, ENC);

  const tablero = ctx.Objetivos.listar({ anio: ANIO }, ENC);
  assert.equal(tablero.objetivos.filter((o) => o.ultima_lectura).length, 0,
    'ningún objetivo puede quedar medido por la lectura de un indicador que lo alimenta');
  assert.equal(tablero.indicadores.sin_medir, 6);

  // Pero el vínculo sí se ve desde el lado del indicador.
  const listado = ctx.Indicadores.listar({}, ENC).indicadores[0];
  assert.match(listado.objetivo, /^OBJ-/);
});

test('una lectura de indicador nace sin objetivo_id, y por eso es invisible', () => {
  const ctx = loadConSchema();
  const i = crearIndicador(ctx);
  ctx.Indicadores.registrarLectura({ indicador_id: i.indicador_id, periodo: ANIO + '-M01', valor: 95 }, ENC);

  const l = ctx.leerFilasSeguro_(ctx.SHEETS.SGC_INDICADOR_LECTURAS)[0];
  assert.equal(l.objetivo_id, '', 'todo el tablero de objetivos cruza por objetivo_id');
  assert.equal(l.indicador_id, i.indicador_id);
});

test('el aviso de lecturas pendientes de objetivos sigue mirando solo objetivos', () => {
  const ctx = loadConSchema();
  const i = crearIndicador(ctx);
  ctx.Indicadores.registrarLectura({ indicador_id: i.indicador_id, periodo: ANIO + '-M01', valor: 95 }, ENC);
  assert.deepEqual(toPlain(ctx.Objetivos.alertarLecturasPendientes()), [],
    'sin objetivos sembrados no hay nada pendiente, aunque haya lecturas de indicador');
});

// --- 2. Los tres veredictos --------------------------------------------------

test('la tolerancia crea el escalón intermedio', () => {
  const ctx = loadConSchema();
  const i = crearIndicador(ctx);   // meta ≥90, tolerancia 85

  const casos = [[95, 'CUMPLE'], [90, 'CUMPLE'], [87, 'ALERTA'], [85, 'ALERTA'], [84, 'NO_CUMPLE'], [40, 'NO_CUMPLE']];
  casos.forEach((c, idx) => {
    const r = ctx.Indicadores.registrarLectura({
      indicador_id: i.indicador_id, periodo: ANIO + '-M0' + (idx + 1), valor: c[0]
    }, ENC);
    assert.equal(r.veredicto, c[1], 'valor ' + c[0]);
  });
});

test('sin tolerancia solo hay cumple y no cumple', () => {
  const ctx = loadConSchema();
  const i = crearIndicador(ctx, { tolerancia_valor: '' });
  assert.equal(ctx.Indicadores.registrarLectura({ indicador_id: i.indicador_id, periodo: ANIO + '-M01', valor: 87 }, ENC).veredicto,
    'NO_CUMPLE', 'sin tolerancia definida no hay zona de alerta');
});

test('la tolerancia tiene que ser más laxa que la meta', () => {
  const ctx = loadConSchema();
  // Meta "≥ 90" con tolerancia 95: todo lo que pasara la tolerancia ya habría
  // cumplido la meta, así que la zona de alerta no existiría.
  let r = ctx.Indicadores.guardar({
    nombre: 'X', formula: 'f', meta_operador: 'MAYOR_IGUAL', meta_valor: 90,
    tolerancia_valor: 95, frecuencia: 'MENSUAL'
  }, ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /más laxa/i);

  // Y al revés con un operador "menor que": ahí lo laxo es un número MAYOR.
  r = ctx.Indicadores.guardar({
    nombre: 'Reclamos', formula: 'f', meta_operador: 'MENOR', meta_valor: 2,
    tolerancia_valor: 1, frecuencia: 'MENSUAL'
  }, ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /mayor que 2/);

  r = ctx.Indicadores.guardar({
    nombre: 'Reclamos', formula: 'f', meta_operador: 'MENOR', meta_valor: 2,
    tolerancia_valor: 3, frecuencia: 'MENSUAL'
  }, ENC);
  assert.equal(r.ok, true, 'con "menor que", una tolerancia mayor sí es más laxa');
});

test('un indicador de "menor que" evalúa al revés', () => {
  const ctx = loadConSchema();
  const i = ctx.Indicadores.guardar({
    nombre: 'Reclamos sobre total de servicios', formula: 'reclamos / servicios × 100',
    meta_operador: 'MENOR', meta_valor: 2, tolerancia_valor: 3,
    frecuencia: 'MENSUAL', unidad: 'PORCENTAJE'
  }, ENC);

  assert.equal(ctx.Indicadores.registrarLectura({ indicador_id: i.indicador_id, periodo: ANIO + '-M01', valor: 1.5 }, ENC).veredicto, 'CUMPLE');
  assert.equal(ctx.Indicadores.registrarLectura({ indicador_id: i.indicador_id, periodo: ANIO + '-M02', valor: 2.5 }, ENC).veredicto, 'ALERTA');
  assert.equal(ctx.Indicadores.registrarLectura({ indicador_id: i.indicador_id, periodo: ANIO + '-M03', valor: 8 }, ENC).veredicto, 'NO_CUMPLE');
});

// --- 3. El veredicto queda congelado ----------------------------------------

test('bajar la meta no reescribe lo que ya se midió', () => {
  const ctx = loadConSchema();
  const i = crearIndicador(ctx);
  ctx.Indicadores.registrarLectura({ indicador_id: i.indicador_id, periodo: ANIO + '-M01', valor: 60 }, ENC);

  const antes = ctx.leerFilasSeguro_(ctx.SHEETS.SGC_INDICADOR_LECTURAS)[0];
  assert.equal(antes.origen, 'NO_CUMPLE');

  ctx.Indicadores.guardar({
    indicador_id: i.indicador_id, nombre: 'Cumplimiento de plazos', formula: 'f',
    meta_operador: 'MAYOR_IGUAL', meta_valor: 50, frecuencia: 'MENSUAL'
  }, ENC);

  const despues = ctx.leerFilasSeguro_(ctx.SHEETS.SGC_INDICADOR_LECTURAS)[0];
  assert.equal(despues.origen, 'NO_CUMPLE',
    'lo que se midió con la meta de entonces tiene que seguir diciendo lo mismo');
});

// --- 4. Períodos y cálculo ---------------------------------------------------

test('la clave de período tiene que corresponder a la frecuencia', () => {
  const ctx = loadConSchema();
  const i = crearIndicador(ctx, { frecuencia: 'SEMESTRAL', tolerancia_valor: '' });

  const r = ctx.Indicadores.registrarLectura({ indicador_id: i.indicador_id, periodo: ANIO + '-M03', valor: 95 }, ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /no corresponde a la frecuencia semestral/i);

  assert.equal(ctx.Indicadores.registrarLectura({ indicador_id: i.indicador_id, periodo: ANIO + '-S1', valor: 95 }, ENC).ok, true);
});

test('el numerador y el denominador se guardan aparte y derivan el valor', () => {
  const ctx = loadConSchema();
  const i = crearIndicador(ctx);
  const r = ctx.Indicadores.registrarLectura({
    indicador_id: i.indicador_id, periodo: ANIO + '-M01', numerador: 45, denominador: 50
  }, ENC);

  assert.equal(r.valor, 90);
  const l = ctx.leerFilasSeguro_(ctx.SHEETS.SGC_INDICADOR_LECTURAS)[0];
  assert.equal(Number(l.numerador), 45);
  assert.equal(Number(l.denominador), 50);
  // Sin las dos partes, un 90% no se puede auditar: ¿90% de qué?
});

test('el denominador cero se rechaza en vez de producir infinito', () => {
  const ctx = loadConSchema();
  const i = crearIndicador(ctx);
  const r = ctx.Indicadores.registrarLectura({
    indicador_id: i.indicador_id, periodo: ANIO + '-M01', numerador: 1, denominador: 0
  }, ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /no puede ser cero/i);
});

test('volver a medir el mismo período reemplaza y conserva la anterior', () => {
  const ctx = loadConSchema();
  const i = crearIndicador(ctx);
  ctx.Indicadores.registrarLectura({ indicador_id: i.indicador_id, periodo: ANIO + '-M01', valor: 95 }, ENC);
  ctx.Indicadores.registrarLectura({ indicador_id: i.indicador_id, periodo: ANIO + '-M01', valor: 70 }, ENC);

  const todas = ctx.leerFilasSeguro_(ctx.SHEETS.SGC_INDICADOR_LECTURAS);
  const activas = todas.filter((l) => ctx.esVerdaderoSgc_(l.activa));
  assert.equal(activas.length, 1);
  assert.equal(Number(activas[0].valor), 70);
  assert.equal(todas.length, 2, 'la anterior se conserva anulada, no se borra');
});

// --- 5. Validaciones y permisos ---------------------------------------------

test('un indicador sin fórmula no se guarda', () => {
  const ctx = loadConSchema();
  const r = ctx.Indicadores.guardar({
    nombre: 'Algo', meta_operador: 'MAYOR_IGUAL', meta_valor: 90, frecuencia: 'MENSUAL'
  }, ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /cómo se calcula/i);
});

test('el código correlativo se asigna solo', () => {
  const ctx = loadConSchema();
  crearIndicador(ctx);
  const segundo = crearIndicador(ctx, { nombre: 'Otro' });
  const lista = ctx.Indicadores.listar({}, ENC).indicadores;
  assert.deepEqual(toPlain(lista).map((x) => x.codigo).sort(), ['IND-01', 'IND-02']);
  assert.ok(segundo.ok);
});

test('solo el Encargado define y mide', () => {
  const ctx = loadConSchema();
  assert.equal(ctx.Indicadores.guardar({ nombre: 'X', formula: 'f', meta_operador: 'MAYOR_IGUAL', meta_valor: 1, frecuencia: 'ANUAL' }, OPERATIVO)._forbidden, true);
  const i = crearIndicador(ctx);
  assert.equal(ctx.Indicadores.registrarLectura({ indicador_id: i.indicador_id, periodo: ANIO + '-M01', valor: 95 }, OPERATIVO)._forbidden, true);
  assert.equal(ctx.Indicadores.listar({}, OPERATIVO)._forbidden, true);
});

// --- 6. Efecto en la matriz --------------------------------------------------

test('9.1 exige indicadores de proceso, no solo los objetivos', () => {
  const ctx = loadConSchema();
  ctx.Objetivos.sembrarAnio({ anio: ANIO }, ENC);

  let d = ctx.MatrizCobertura.getDetalle({ codigo: '9.1' }, ENC);
  assert.match(d.nota, /no hay indicadores de proceso definidos/i,
    'medir solo los seis objetivos corporativos deja los procesos sin medición');

  crearIndicador(ctx);
  d = ctx.MatrizCobertura.getDetalle({ codigo: '9.1' }, ENC);
  assert.match(d.nota, /nunca medido/i, 'definirlo no es medirlo');
  assert.match(d.resumen, /1 indicador\(es\) de proceso/);
});

test('el tablero cuenta cuántos procesos del mapa quedan sin indicador', () => {
  const ctx = loadConSchema();
  ctx.Procesos.sembrarMapa({}, ENC);

  let r = ctx.Indicadores.listar({}, ENC).resumen;
  assert.equal(r.procesos_mapa, 14);
  assert.equal(r.procesos_sin_indicador, 14, 'es la medida de la debilidad D1 del FODA');

  const proceso = ctx.Procesos.listar({}, ENC).mapa.filter((p) => p.codigo === 'PA-05')[0];
  crearIndicador(ctx, { proceso_id: proceso.proceso_id });

  r = ctx.Indicadores.listar({}, ENC).resumen;
  assert.equal(r.procesos_sin_indicador, 13);
});
