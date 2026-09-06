'use strict';

/**
 * La foto periódica de la cobertura ISO (v12.8).
 *
 * La cobertura era lo ÚNICO del SGC que no dejaba rastro en el tiempo: se
 * calculaba siempre contra el presente y se tiraba. Así, Calidad no podía
 * responder "¿cómo veníamos hace tres meses?" — que es justo lo que pregunta
 * una revisión por la dirección (§9.3) y lo que le dice a un auditor si el
 * sistema avanza o solo existe.
 *
 * Lo que se sostiene aquí es lo que rompería la serie sin hacer ruido:
 *
 *   · Que la foto sea IDEMPOTENTE. La llama el pase diario, que corre todos
 *     los días. Sin la compuerta, la hoja crecería 365 filas al año en vez de
 *     52 y el gráfico tendría siete puntos iguales por semana.
 *   · Que el número archivado sea EL MISMO que muestra el tablero. Un
 *     histórico que no cuadra con la pantalla de hoy no es evidencia, es una
 *     segunda versión de la verdad.
 *   · Que el histórico tenga el MISMO portón que la matriz. Quien no puede
 *     ver la cobertura de hoy tampoco puede ver la de hace tres meses.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

const ADM = { email: 'adm@x.cl', nombre: 'Ada Admin', rol: 'ADM' };
const AJENO = { email: 'ajeno@x.cl', nombre: 'Ajeno', rol: 'SOL' };

function ctxBase() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'x', SIGSO_DRIVE_ROOT_FOLDER_ID: 'y' } });
  Object.keys(ctx.COLUMNAS).forEach((h) => { try { seedSheet(ctx, h, ctx.COLUMNAS[h]); } catch (e) {} });
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Ada Admin', 'adm@x.cl', 'HP', 'ADM', true, '', 'sistema']
  ]);
  return ctx;
}

const fotos = (ctx) => ctx.leerFilas_('SGC_COBERTURA_HISTORICO');

test('la hoja del histórico existe en los tres esquemas', () => {
  // Sin esto el Instalador no la crearía y archivarFoto escribiría al vacío.
  const ctx = ctxBase();
  assert.ok(ctx.COLUMNAS.SGC_COBERTURA_HISTORICO, 'falta en COLUMNAS');
  assert.equal(ctx.SHEETS.SGC_COBERTURA_HISTORICO, 'SGC_COBERTURA_HISTORICO');
  // El test de consistencia de esquema cubre que las tres copias coincidan.
});

test('archivar dos veces la misma semana escribe UNA sola fila', () => {
  // La compuerta que hace que colgarlo del pase diario no llene la hoja.
  const ctx = ctxBase();

  const primera = toPlain(ctx.MatrizCobertura.archivarFoto());
  const segunda = toPlain(ctx.MatrizCobertura.archivarFoto());

  assert.equal(primera.escrita, true);
  assert.equal(segunda.escrita, false, 'la segunda del mismo período no escribe');
  assert.equal(fotos(ctx).length, 1);
});

test('el período es el LUNES de la semana', () => {
  // Se eligió una fecha y no un número de semana ISO: los números traen sus
  // propios bordes (la 53, el cambio de año) y una fecha no. Además ordena
  // sola y se lee sin explicarla, que importa cuando la hoja es evidencia.
  const ctx = ctxBase();
  // 2026-09-05 es sábado; su lunes es el 2026-08-31.
  assert.equal(ctx.lunesDeLaSemana_(new Date('2026-09-05T12:00:00Z')), '2026-08-31');
  assert.equal(ctx.lunesDeLaSemana_(new Date('2026-08-31T00:00:00Z')), '2026-08-31', 'el lunes es su propio lunes');
  assert.equal(ctx.lunesDeLaSemana_(new Date('2026-09-06T23:00:00Z')), '2026-08-31',
    'el domingo pertenece a la semana que ACABA, no a la que empieza');
  assert.equal(ctx.lunesDeLaSemana_(new Date('2026-09-07T00:00:00Z')), '2026-09-07', 'y el lunes siguiente ya es otra');
});

test('lo archivado es EXACTAMENTE lo que muestra la matriz de hoy', () => {
  // Un histórico que no cuadra con la pantalla de hoy no es evidencia: es una
  // segunda versión de la verdad, y entonces no se puede creer ninguna.
  const ctx = ctxBase();
  const hoy = toPlain(ctx.matrizCalculada_());
  ctx.MatrizCobertura.archivarFoto();

  const fila = fotos(ctx)[0];
  assert.equal(Number(fila.pct_listo), hoy.resumen.pct_listo);
  assert.equal(Number(fila.aplicables), hoy.resumen.aplicables);
  assert.equal(Number(fila.completo), hoy.resumen.completo);
  assert.equal(Number(fila.parcial), hoy.resumen.parcial);
  assert.equal(Number(fila.faltante), hoy.resumen.faltante);
  assert.equal(Number(fila.no_aplica), hoy.resumen.no_aplica);
});

test('se guarda el desglose de los siete capítulos de la norma', () => {
  // Es el corte con el que un auditor recorre la ISO 9001. Sin él, la serie
  // diría que el sistema avanzó pero no dónde.
  const ctx = ctxBase();
  ctx.MatrizCobertura.archivarFoto();
  const fila = fotos(ctx)[0];

  const porCapitulo = {};
  toPlain(ctx.saludPorCapitulo_(toPlain(ctx.matrizCalculada_()).clausulas))
    .forEach((c) => { porCapitulo[c.numero] = c.pct; });

  ['4', '5', '6', '7', '8', '9', '10'].forEach((n) => {
    assert.equal(Number(fila['cap_' + n]), porCapitulo[n],
      'el capítulo ' + n + ' se archivó con otro valor del que calcula la matriz');
  });
});

test('el histórico llega ordenado de lo más antiguo a lo más nuevo', () => {
  // Un gráfico de tendencia con los puntos desordenados dibuja una línea que
  // sube y baja sin que nada haya pasado.
  const ctx = ctxBase();
  const cols = ctx.COLUMNAS.SGC_COBERTURA_HISTORICO;
  const fila = (periodo, pct) => cols.map((c) => {
    if (c === 'cobertura_id') return 'C-' + periodo;
    if (c === 'periodo') return periodo;
    if (c === 'fecha') return periodo;
    if (c === 'pct_listo') return pct;
    if (c === 'aplicables') return 28;
    return 0;
  });
  seedSheet(ctx, 'SGC_COBERTURA_HISTORICO', cols, [
    fila('2026-03-02', 40), fila('2026-01-05', 20), fila('2026-02-02', 30)
  ]);

  const r = toPlain(ctx.MatrizCobertura.listarHistorico({}, ADM));
  assert.deepEqual(r.fotos.map((f) => f.periodo), ['2026-01-05', '2026-02-02', '2026-03-02']);
  assert.deepEqual(r.fotos.map((f) => f.pct_listo), [20, 30, 40]);
});

test('el histórico trae también el valor de HOY, sin esperar al lunes', () => {
  // Si la pantalla solo mostrara lo archivado, entre el lunes y el lunes
  // siguiente estaría enseñando una foto vieja como si fuera el presente.
  const ctx = ctxBase();
  const r = toPlain(ctx.MatrizCobertura.listarHistorico({}, ADM));
  assert.equal(r.actual.pct_listo, toPlain(ctx.matrizCalculada_()).resumen.pct_listo);
});

test('el histórico tiene el MISMO portón que la matriz', () => {
  // Quien no puede ver la cobertura de hoy tampoco puede ver la de hace tres
  // meses: es el mismo dato, solo que fechado.
  const ctx = ctxBase();
  const r = toPlain(ctx.MatrizCobertura.listarHistorico({}, AJENO));
  assert.equal(r._forbidden, true);
  assert.equal(r.fotos, undefined, 'un rechazo no puede traer datos adjuntos');
});

test('la acción está declarada con su módulo, no queda abierta por omisión', () => {
  // MODULO_POR_ACCION es permisivo POR OMISIÓN: una acción ausente de esa
  // tabla no tiene control de módulo. Olvidarla ahí es la forma más fácil de
  // abrir una puerta sin darse cuenta.
  const ctx = ctxBase();
  assert.equal(typeof ctx.BACKOFFICE_ACTIONS.listarCoberturaHistoricoSgc, 'function');
  assert.deepEqual(toPlain(ctx.MODULO_POR_ACCION.listarCoberturaHistoricoSgc), ['calidad', 'gerencia'],
    'el mismo módulo que la matriz de cobertura');
});

test('el trigger del pase diario está enganchado y es el que archiva', () => {
  const ctx = ctxBase();
  const nombres = toPlain(ctx.AVISOS_DEL_PASE_DIARIO).map((par) => par[0]);
  assert.ok(nombres.indexOf('foto_cobertura_iso') !== -1,
    'sin esto la foto no se toma nunca: los 20 triggers de tiempo están copados ' +
    'y esta es la única vía');

  ctx.archivarCoberturaIsoTrigger();
  assert.equal(fotos(ctx).length, 1);
  ctx.archivarCoberturaIsoTrigger();
  assert.equal(fotos(ctx).length, 1, 'correr el pase otro día de la misma semana no duplica');
});
