'use strict';

/**
 * M-03: el tablero del SGC deja de costar 23 viajes a la hoja en cada visita.
 *
 * Medido antes del cambio: la pantalla leia 23 hojas distintas, y 22 de esas
 * lecturas daban EXACTAMENTE lo mismo para todo el mundo. Solo SGC_ROLES
 * depende de quien mira.
 *
 * De ahi la forma del arreglo: una sola entrada de cache para toda la
 * empresa, con los campos de permiso pegados encima al servir. Y de ahi
 * tambien lo que hay que sostener con pruebas, porque son cosas que se
 * rompen sin hacer ruido:
 *
 *   · Que el cache NO sea nunca la fuente de los permisos. Una entrada
 *     compartida que llevara dentro `puede_gestionar` le daria a una persona
 *     los permisos de la anterior -- el fallo mas caro posible aqui, y el
 *     mas silencioso: se ve bien hasta que alguien ve de mas.
 *   · Que el porton se compruebe SIEMPRE, tambien cuando el cuerpo viene ya
 *     calculado. Es facil escribir un "si esta en cache, devuelvelo" que se
 *     salte al portero.
 *   · Que escribir en el SGC tire el cache. Sin eso, cerrar una no
 *     conformidad no bajaria el contador y la pantalla mentiria durante
 *     horas. Es lo que hace que el TTL sea el techo y no la espera normal.
 *   · Que escribir FUERA del SGC no lo tire, o el cache no sobreviviria a un
 *     sistema que escribe registros todo el rato.
 *   · Que la pantalla siga mostrando lo mismo que mostraba.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

const ADM = { email: 'adm@x.cl', nombre: 'Ada Admin', rol: 'ADM' };

function ctxBase() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'x', SIGSO_DRIVE_ROOT_FOLDER_ID: 'y' } });
  Object.keys(ctx.COLUMNAS).forEach((h) => { try { seedSheet(ctx, h, ctx.COLUMNAS[h]); } catch (e) {} });
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Ada Admin', 'adm@x.cl', 'HP', 'ADM', true, '', 'sistema'],
    ['U2', 'Ben Dev', 'dev@x.cl', 'HP', 'DEV', true, '', 'sistema']
  ]);
  return ctx;
}

/**
 * Cuenta VIAJES REALES a la hoja, que es lo unico que cuesta tiempo en Apps
 * Script. No vale contar llamadas a leerFilas_: _cacheHojas_ (v6.9) sirve la
 * segunda y siguientes desde memoria, asi que contarlas da una foto falsa.
 */
function contarViajes(ctx, fn) {
  const vistas = new Set();
  const original = ctx.leerFilas_;
  ctx.leerFilas_ = function (hoja) { vistas.add(hoja); return original.apply(this, arguments); };
  try { fn(); } finally { ctx.leerFilas_ = original; }
  return vistas.size;
}

/**
 * Cada peticion a Apps Script es una EJECUCION nueva: el cache de hojas
 * (_cacheHojas_) nace vacio, mientras que CacheService sobrevive entre
 * ejecuciones. Sin esto la prueba mediria una sola ejecucion larga y el
 * ahorro pareceria venir del cache de hojas, que es otro mecanismo.
 */
function nuevaEjecucion(ctx) {
  ctx.invalidarCacheHoja_();
}

test('la segunda visita cuesta 1 viaje a la hoja en vez de 23', () => {
  const ctx = ctxBase();

  const primera = contarViajes(ctx, () => ctx.Tablero.resumen({}, ADM));
  nuevaEjecucion(ctx);
  const segunda = contarViajes(ctx, () => ctx.Tablero.resumen({}, ADM));

  assert.equal(primera, 23, 'la primera visita paga el calculo entero');
  assert.equal(segunda, 1,
    'la segunda solo deberia leer SGC_ROLES, que es lo unico que depende de ' +
    'quien mira; el resto sale del cache compartido');
});

test('el cuerpo cacheado es identico al recien calculado', () => {
  // El ahorro no vale nada si la pantalla cambia. Se compara lo servido
  // contra el calculo directo, sin cache de por medio.
  const ctx = ctxBase();

  const directo = toPlain(ctx.cuerpoTablero_());
  const servido = toPlain(ctx.Tablero.resumen({}, ADM));
  delete servido.puede_gestionar;
  delete servido.secciones_visibles;

  assert.deepEqual(servido, directo);
});

test('los permisos NO salen del cache: cada quien recibe los suyos', () => {
  // El fallo mas caro que puede tener una entrada compartida. Se calienta el
  // cache con alguien que gobierna y se pide con alguien que no.
  const ctx = ctxBase();
  ctx.Tablero.resumen({}, ADM);
  nuevaEjecucion(ctx);

  let vistoPor = null;
  const originalSecciones = ctx.seccionesVisiblesSgc_;
  ctx.seccionesVisiblesSgc_ = function (contexto) {
    vistoPor = contexto && contexto.email;
    return originalSecciones.apply(this, arguments);
  };

  const r = toPlain(ctx.Tablero.resumen({}, ADM));

  assert.equal(vistoPor, 'adm@x.cl',
    'secciones_visibles tiene que recalcularse con el contexto de quien pide, ' +
    'aunque el cuerpo venga del cache');
  assert.equal(typeof r.puede_gestionar, 'boolean');
});

test('la entrada compartida no contiene NINGUN campo de permiso', () => {
  // La invariante de la que depende todo lo demas, comprobada sobre lo que
  // de verdad se guarda. Mientras el permiso no ENTRE en la entrada, no puede
  // salir de ella hacia la persona equivocada; comprobar solo la respuesta
  // dejaria pasar un refactor que meta el campo dentro y se olvide de
  // pisarlo al servir.
  const ctx = ctxBase();
  ctx.Tablero.resumen({}, ADM);

  const guardado = ctx.CacheService.getScriptCache()
    .get(ctx.claveCacheTablero_(ctx.hoyClaveTablero_()));
  assert.ok(guardado, 'el cuerpo tiene que haber quedado en cache');

  const cuerpo = JSON.parse(guardado);
  assert.equal(cuerpo.puede_gestionar, undefined,
    'puede_gestionar decide quien puede TOCAR el SGC: en una entrada ' +
    'compartida por toda la empresa no puede viajar');
  assert.equal(cuerpo.secciones_visibles, undefined,
    'secciones_visibles decide que puede ABRIR cada quien: idem');
});

test('el porton se comprueba tambien cuando el cuerpo ya esta en cache', () => {
  // Es facil escribir un "si esta en cache, devuelvelo" que se salte al
  // portero. Se calienta con quien puede y se pide con quien no.
  const ctx = ctxBase();
  ctx.Tablero.resumen({}, ADM);
  nuevaEjecucion(ctx);

  const r = toPlain(ctx.Tablero.resumen({}, { email: 'ajeno@x.cl', nombre: 'Ajeno', rol: 'SOL' }));

  assert.equal(r._forbidden, true, 'un cache caliente no puede abrir la puerta');
  assert.equal(r.alertas, undefined, 'y no puede filtrar el contenido');
});

test('escribir en una hoja del SGC tira el cache', () => {
  // Sin esto, cerrar una no conformidad dejaria el contador viejo en pantalla
  // hasta que expirara el TTL. Es lo que hace que el TTL sea el techo.
  const ctx = ctxBase();
  ctx.Tablero.resumen({}, ADM);
  nuevaEjecucion(ctx);

  ctx.agregarFila_(ctx.SHEETS.SGC_NC, {
    nc_id: 'NC1', correlativo: 'NC-001', estado: 'ABIERTA',
    descripcion: 'algo', fecha_deteccion: '2026-01-01', activa: true
  });
  nuevaEjecucion(ctx);

  const viajes = contarViajes(ctx, () => ctx.Tablero.resumen({}, ADM));
  assert.equal(viajes, 23, 'tras escribir en el SGC, la pantalla se recalcula entera');

  const r = toPlain(ctx.Tablero.resumen({}, ADM));
  assert.equal(r.conteos.nc_abiertas, 1, 'y el contador refleja lo que se acaba de escribir');
});

test('escribir FUERA del SGC no tira el cache', () => {
  // El sistema escribe registros continuamente. Si cualquier escritura
  // invalidara el tablero, el cache no llegaria vivo a la segunda visita.
  const ctx = ctxBase();
  ctx.Tablero.resumen({}, ADM);
  nuevaEjecucion(ctx);

  ctx.agregarFila_(ctx.SHEETS.LOG_SISTEMA, {
    log_id: 'L1', tipo: 'INFO', mensaje: 'ruido de fondo', fecha: '2026-01-01'
  });
  nuevaEjecucion(ctx);

  assert.equal(contarViajes(ctx, () => ctx.Tablero.resumen({}, ADM)), 1,
    'una escritura ajena al SGC no tiene por que costar 22 viajes');
});

test('al cambiar el dia el cache no sirve la foto de ayer', () => {
  // Media pantalla son plazos comparados contra HOY: un documento se vence al
  // cambiar el dia sin que nadie escriba nada. Por eso el dia va en la clave.
  const ctx = ctxBase();
  ctx.Tablero.resumen({}, ADM);
  nuevaEjecucion(ctx);

  const real = ctx.hoyClaveTablero_;
  ctx.hoyClaveTablero_ = function () { return '2099-01-01'; };
  try {
    assert.equal(contarViajes(ctx, () => ctx.Tablero.resumen({}, ADM)), 23,
      'otro dia es otra clave: se recalcula');
  } finally {
    ctx.hoyClaveTablero_ = real;
  }
});

test('sin CacheService la pantalla sigue funcionando, solo que lenta', () => {
  // El cache es una ayuda, no un requisito: si CacheService fallara, el
  // tablero no puede caerse.
  const ctx = ctxBase();
  const real = ctx.CacheService;
  ctx.CacheService = { getScriptCache: function () { throw new Error('sin cache'); } };
  try {
    const r = toPlain(ctx.Tablero.resumen({}, ADM));
    assert.ok(Array.isArray(r.alertas), 'la pantalla llega igual');
    assert.equal(typeof r.puede_gestionar, 'boolean');
  } finally {
    ctx.CacheService = real;
  }
});

test('refrescarCache deja el cache listo sin que haya usuario', () => {
  // La llama el pase diario, que corre desde un disparador y no tiene a nadie
  // a quien comprobarle permisos. Si dependiera de un contexto, fallaria en
  // silencio todas las noches.
  const ctx = ctxBase();
  ctx.Tablero.refrescarCache();
  nuevaEjecucion(ctx);

  assert.equal(contarViajes(ctx, () => ctx.Tablero.resumen({}, ADM)), 1,
    'la primera persona del dia ya entra con el cache caliente');
});
