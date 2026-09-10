'use strict';

/**
 * La medicion de rendimiento (Perf.gs) pega un `_timing` en cada respuesta
 * que sale por un punto de entrada real (doPost / ejecutarAccionBackoffice),
 * y NO en las respuestas de un handler llamado directo por un test.
 *
 * POR QUE ESTE TEST. El `_timing` es el dato con el que se va a decidir si
 * SIGSO necesita cambiar de base de datos o solo destrabar la cola de
 * ejecucion. Si un refactor lo dejara siempre en cero, o lo colara en las
 * respuestas de los tests (rompiendo aserciones de forma), o dejara de
 * contar los viajes a Sheets, la medicion mentiria en silencio -- que es
 * justo lo que se quiere evitar.
 *
 * QUE FIJA:
 *   · doPost -> la respuesta lleva `_timing` con los cinco campos numericos.
 *   · un handler llamado directo -> su retorno NO lleva `_timing` (aislamiento
 *     de los 1547 tests que asumen la forma vieja).
 *   · una accion que de verdad lee una hoja -> io_ops y io_lecturas > 0.
 *   · dos requests seguidas -> los contadores se resetean (no se acumulan).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function makeEvent(body) {
  return { postData: { contents: JSON.stringify(body), type: 'text/plain' } };
}

function cargar() {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' },
    activeUserEmail: 'ana@homepymes.cl'
  });
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Ana', 'ana@homepymes.cl', 'HP', 'ANA', true, '', 'sistema']
  ]);
  return ctx;
}

test('doPost adjunta _timing con los cinco campos numericos', () => {
  const ctx = cargar();
  const parsed = JSON.parse(ctx.doPost(makeEvent({ action: 'ping', data: {} })).getContent());

  assert.equal(parsed.ok, true, 'la respuesta normal sigue igual');
  assert.ok(parsed._timing, 'ping salio por doPost: debe traer _timing');
  ['server_ms', 'io_ms', 'io_ops', 'io_lecturas', 'io_escrituras'].forEach((k) => {
    assert.equal(typeof parsed._timing[k], 'number', k + ' debe ser numerico');
    assert.ok(parsed._timing[k] >= 0, k + ' no puede ser negativo');
  });
  assert.ok(parsed._timing.io_ms <= parsed._timing.server_ms + 1,
    'el I/O es una PARTE del tiempo de servidor, nunca mas');
});

test('un handler llamado directo NO lleva _timing', () => {
  // Es el aislamiento del que dependen los tests que ya existian: llaman al
  // metodo del modulo y comparan la forma del retorno. perfSnapshot_ devuelve
  // null si perfMarcarInicio_ no corrio (y solo corre en doPost).
  const ctx = cargar();
  seedSheet(ctx, 'CAT_MODULOS', ctx.COLUMNAS.CAT_MODULOS, [['M1', 'Facturacion', '', '', true]]);
  const r = ctx.Catalogos.listar({ tipo: 'MODULO' }, { email: 'ana@homepymes.cl', rol: 'ANA' });
  assert.equal(r && r._timing, undefined, 'sin pasar por doPost no hay _timing');
});

test('una accion que lee una hoja cuenta el viaje', () => {
  const ctx = cargar();
  seedSheet(ctx, 'CAT_MODULOS', ctx.COLUMNAS.CAT_MODULOS, [['M1', 'Facturacion', '', '', true]]);

  // La PRIMERA request de una sesion escribe USUARIOS.ultimo_acceso (RN-029,
  // con throttle de 10 min). Se hace una llamada de calentamiento para que la
  // medida no arrastre esa escritura: asi el conteo refleja solo el trabajo
  // de listarCatalogo.
  ctx.doPost(makeEvent({ action: 'ping', data: {} }));

  const parsed = JSON.parse(ctx.doPost(makeEvent({
    action: 'listarCatalogo', data: { tipo: 'MODULO' }
  })).getContent());

  assert.equal(parsed.ok, true);
  assert.ok(parsed._timing.io_lecturas >= 1,
    'listarCatalogo abre el libro y lee CAT_MODULOS: io_lecturas tiene que contarlo');
  assert.equal(parsed._timing.io_escrituras, 0,
    'listar no escribe (y ultimo_acceso ya se escribio en el ping de calentamiento)');
  assert.ok(parsed._timing.io_ops === parsed._timing.io_lecturas + parsed._timing.io_escrituras,
    'io_ops = lecturas + escrituras');
});

test('los contadores se resetean entre requests, no se acumulan', () => {
  const ctx = cargar();
  seedSheet(ctx, 'CAT_MODULOS', ctx.COLUMNAS.CAT_MODULOS, [['M1', 'Facturacion', '', '', true]]);

  const a = JSON.parse(ctx.doPost(makeEvent({ action: 'listarCatalogo', data: { tipo: 'MODULO' } })).getContent());
  const b = JSON.parse(ctx.doPost(makeEvent({ action: 'listarCatalogo', data: { tipo: 'MODULO' } })).getContent());

  // La segunda no puede reportar el doble de viajes que la primera: si
  // perfMarcarInicio_ no reseteara, b.io_ops arrastraria los de a.
  assert.ok(b._timing.io_ops <= a._timing.io_ops,
    'segunda request: ' + b._timing.io_ops + ' viajes vs ' + a._timing.io_ops +
    ' de la primera -- si sube, los contadores se estan acumulando');
});

test('SheetsRepo no se cae si Perf.gs no esta en el proyecto', () => {
  // El paquete de deploy incluye Perf.gs como archivo NUEVO a crear a mano.
  // Ese paso se puede saltar. medirIoRepo_ tiene que degradar a un paso
  // directo, no a un ReferenceError en cada lectura.
  const ctx = cargar();
  const original = ctx.perfMedirIO_;
  try {
    ctx.perfMedirIO_ = undefined; // simula "Perf.gs no pegado"
    seedSheet(ctx, 'CAT_MODULOS', ctx.COLUMNAS.CAT_MODULOS, [['M1', 'Facturacion', '', '', true]]);
    const filas = ctx.leerFilas_('CAT_MODULOS');
    assert.equal(filas.length, 1, 'la lectura funciona igual sin Perf.gs');
  } finally {
    ctx.perfMedirIO_ = original;
  }
});
