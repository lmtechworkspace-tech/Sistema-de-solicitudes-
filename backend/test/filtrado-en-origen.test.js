'use strict';

/**
 * Filtrado en origen (v12.7).
 *
 * MEDIDO antes del cambio: el panel de Gerencia pesa ~0,9 KB por ítem y
 * CacheService no guarda más de 100 KB. Pasados unos 109 ítems el panel deja
 * de cachearse por completo — Gerencia.gs ya lo decía: "si no cabe, se sirve
 * sin cachear" — y se recalcula entero en cada visita. Recortar en el
 * navegador no evita nada de eso: para cuando se recorta, el viaje ya se pagó.
 *
 * Así que el recorte pasó al servidor. Lo que hay que sostener con pruebas:
 *
 *   · Que el servidor corte EL MISMO DÍA que el motor en el navegador. La
 *     misma pregunta se puede responder ahora en dos sitios; dos respuestas
 *     distintas al mismo filtro es peor que no tener filtro. Antes el
 *     servidor comparaba con `new Date`, y `new Date('2026-05-01')` es
 *     medianoche UTC: un ítem creado el 1 de mayo a las 21:00 en Chile caía
 *     en el día siguiente y desaparecía de "este mes".
 *   · Que el filtro NO pueda ampliar lo que alguien ve. En Jefatura el
 *     aislamiento por equipo es una regla de acceso, no un corte elegible:
 *     un filtro solo puede quitar de lo que el jefe ya podía ver.
 *   · Que un filtro vacío siga trayendo todo.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

const ADM = { email: 'adm@x.cl', nombre: 'Ada Admin', rol: 'ADM' };
const JEFE = { email: 'jefe@x.cl', nombre: 'Jefa', rol: 'JEFATURA' };

// Las hojas que se siembran con datos se dejan fuera de la pasada inicial.
// Ya no hace falta para evitar la fila fantasma de encabezados —seedSheet la
// escribe una sola vez desde que se arregló, ver arnes-seedsheet.test.js—
// pero se mantiene porque hace evidente cuáles son las hojas que este archivo
// prepara de verdad y cuáles solo necesitan existir.
const SEMBRADAS_APARTE = ['SOLICITUDES', 'SUBSOLICITUDES', 'USUARIOS', 'JEFATURAS'];

function ctxBase() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'x', SIGSO_DRIVE_ROOT_FOLDER_ID: 'y' } });
  Object.keys(ctx.COLUMNAS).forEach((h) => {
    if (SEMBRADAS_APARTE.indexOf(h) !== -1) return;
    try { seedSheet(ctx, h, ctx.COLUMNAS[h]); } catch (e) {}
  });
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Ada Admin', 'adm@x.cl', 'HP', 'ADM', true, '', 'sistema'],
    ['U2', 'Ben Dev', 'ben@x.cl', 'HP', 'DEV', true, '', 'sistema'],
    ['U3', 'Cris Dev', 'cris@x.cl', 'HP', 'DEV', true, '', 'sistema'],
    ['U4', 'Jefa', 'jefe@x.cl', 'HP', 'JEFATURA', true, '', 'sistema']
  ]);
  return ctx;
}

/**
 * Siembra ítems. `fecha` va tal cual, para poder poner instantes de borde.
 */
function sembrar(ctx, filas) {
  const colS = ctx.COLUMNAS.SOLICITUDES;
  const colSub = ctx.COLUMNAS.SUBSOLICITUDES;
  const sol = [];
  const sub = [];
  filas.forEach((f, i) => {
    const sid = 'SOL-' + i;
    sol.push(colS.map((c) => {
      if (c === 'solicitud_id') return sid;
      if (c === 'empresa_id') return 'HP';
      if (c === 'solicitante_nombre') return 'Quien Pide';
      if (c === 'solicitante_email') return f.solicitante || 'pide@x.cl';
      if (c === 'fecha_creacion') return f.fecha;
      if (c === 'activa') return true;
      return '';
    }));
    sub.push(colSub.map((c) => {
      if (c === 'subsolicitud_id') return f.id;
      if (c === 'solicitud_id') return sid;
      if (c === 'titulo') return f.id;
      if (c === 'numero_item') return 1;
      if (c === 'area_nombre') return f.area || 'Soporte';
      if (c === 'estado') return 'S04';
      if (c === 'prioridad') return 'MEDIA';
      if (c === 'desarrollador_asignado') return f.dev || 'ben@x.cl';
      if (c === 'fecha_creacion') return f.fecha;
      if (c === 'fecha_comprometida') return '2026-12-31';
      if (c === 'activa') return true;
      return '';
    }));
  });
  seedSheet(ctx, 'SOLICITUDES', colS, sol);
  seedSheet(ctx, 'SUBSOLICITUDES', colSub, sub);
}

const ids = (r) => toPlain(r).items.map((i) => i.subsolicitud_id).sort();

test('el borde del mes NO se corre por el huso horario', () => {
  // El fallo que tenía comparar con `new Date`: un ítem creado el 1 de mayo a
  // las 21:00 en Chile son las 01:00 UTC del día 2, y `new Date('2026-05-01')`
  // es medianoche UTC. El ítem quedaba fuera de "mayo" sin que nadie lo notara.
  const ctx = ctxBase();
  sembrar(ctx, [
    { id: 'ABRIL-30', fecha: '2026-04-30T23:00:00.000Z' },
    { id: 'MAYO-1', fecha: '2026-05-01T00:30:00.000Z' },
    { id: 'MAYO-31', fecha: '2026-05-31T23:59:00.000Z' },
    { id: 'JUNIO-1', fecha: '2026-06-01T01:00:00.000Z' }
  ]);

  const r = ctx.Gerencia.getPanel({ desde: '2026-05-01', hasta: '2026-05-31' }, ADM);
  assert.deepEqual(ids(r), ['MAYO-1', 'MAYO-31'],
    'los dos días del borde tienen que caer DENTRO del mes que se pidió');
});

test('el servidor y el motor del navegador cortan exactamente lo mismo', () => {
  // La invariante que hace que mover el corte al servidor sea seguro. Si los
  // dos no coincidieran, el mismo filtro daría un total distinto según quién
  // lo calculó, y ninguno de los dos números sería creíble.
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const ventana = {};
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', '..', 'frontend/js/reportes.js'), 'utf8'),
    vm.createContext({ window: ventana, console, Date, Math, Object, Array, String, Number, JSON, isNaN })
  );
  const motor = ventana.SigsoReportes;

  const filas = [
    { id: 'A', fecha: '2026-04-30T23:00:00.000Z' },
    { id: 'B', fecha: '2026-05-01T00:30:00.000Z' },
    { id: 'C', fecha: '2026-05-15T12:00:00.000Z' },
    { id: 'D', fecha: '2026-05-31T23:59:00.000Z' },
    { id: 'E', fecha: '2026-06-01T01:00:00.000Z' }
  ];
  const ctx = ctxBase();
  sembrar(ctx, filas);

  const rango = motor.rangoDePeriodo('mes', '2026-05-15');
  const enServidor = ids(ctx.Gerencia.getPanel({ desde: rango.desde, hasta: rango.hasta }, ADM));
  const enCliente = motor
    .filtrarItems(filas.map((f) => ({ subsolicitud_id: f.id, fecha_creacion: f.fecha })),
      { periodo: 'mes' }, { campoFecha: 'fecha_creacion', hoy: '2026-05-15' })
    .map((i) => i.subsolicitud_id).sort();

  assert.deepEqual(enServidor, enCliente);
  assert.deepEqual(enServidor, ['B', 'C', 'D']);
});

test('sin filtro llega todo', () => {
  // Si un filtro ausente cortara algo, el panel normal mostraría de menos y
  // nadie tendría motivo para sospechar.
  const ctx = ctxBase();
  sembrar(ctx, [
    { id: 'A', fecha: '2020-01-01T00:00:00.000Z' },
    { id: 'B', fecha: '2026-05-15T00:00:00.000Z' }
  ]);
  assert.deepEqual(ids(ctx.Gerencia.getPanel({}, ADM)), ['A', 'B']);
});

test('el área se corta en el origen', () => {
  const ctx = ctxBase();
  sembrar(ctx, [
    { id: 'SOP-1', fecha: '2026-05-10T00:00:00.000Z', area: 'Soporte' },
    { id: 'VEN-1', fecha: '2026-05-10T00:00:00.000Z', area: 'Ventas' }
  ]);
  assert.deepEqual(ids(ctx.Gerencia.getPanel({ area: 'Ventas' }, ADM)), ['VEN-1']);
});

test('un ítem sin fecha queda fuera cuando se pide un rango, y dentro cuando no', () => {
  // No se puede afirmar que cae dentro de un rango que no tiene. Pero si nadie
  // pidió rango, que le falte la fecha no es motivo para desaparecer.
  const ctx = ctxBase();
  sembrar(ctx, [
    { id: 'CON', fecha: '2026-05-10T00:00:00.000Z' },
    { id: 'SIN', fecha: '' }
  ]);
  assert.deepEqual(ids(ctx.Gerencia.getPanel({ desde: '2026-05-01', hasta: '2026-05-31' }, ADM)), ['CON']);
  assert.deepEqual(ids(ctx.Gerencia.getPanel({}, ADM)), ['CON', 'SIN']);
});

// --- Jefatura --------------------------------------------------------------

function ctxJefatura() {
  const ctx = ctxBase();
  seedSheet(ctx, 'JEFATURAS', ctx.COLUMNAS.JEFATURAS, [
    ['J1', 'jefe@x.cl', 'ben@x.cl', true]
  ]);
  return ctx;
}

test('Jefatura aplica el filtro en el origen', () => {
  // getPanel recibía `filtros` y no los miraba: el panel viajaba entero y el
  // recorte se hacía después, cuando el viaje ya estaba pagado.
  const ctx = ctxJefatura();
  sembrar(ctx, [
    { id: 'VIEJO', fecha: '2020-01-01T00:00:00.000Z', dev: 'ben@x.cl' },
    { id: 'NUEVO', fecha: '2026-05-10T00:00:00.000Z', dev: 'ben@x.cl' }
  ]);

  assert.deepEqual(ids(ctx.Jefatura.getPanel({}, JEFE)), ['NUEVO', 'VIEJO']);
  assert.deepEqual(
    ids(ctx.Jefatura.getPanel({ desde: '2026-05-01', hasta: '2026-05-31' }, JEFE)),
    ['NUEVO']);
});

test('el filtro NO puede ampliar lo que un jefe ve', () => {
  // El aislamiento por equipo es una regla de ACCESO, no un corte que la
  // persona elige. Si el filtro se aplicara antes (o en vez) del aislamiento,
  // pedir a alguien de otro equipo lo traería: el fallo más caro posible aquí.
  const ctx = ctxJefatura();
  sembrar(ctx, [
    { id: 'MIO', fecha: '2026-05-10T00:00:00.000Z', dev: 'ben@x.cl' },
    { id: 'AJENO', fecha: '2026-05-10T00:00:00.000Z', dev: 'cris@x.cl' }
  ]);

  assert.deepEqual(ids(ctx.Jefatura.getPanel({}, JEFE)), ['MIO'],
    'de base, el jefe solo ve a su equipo');
  assert.deepEqual(ids(ctx.Jefatura.getPanel({ desarrollador: 'cris@x.cl' }, JEFE)), [],
    'pedir explícitamente a alguien de otro equipo no lo trae');
});

test('Jefatura filtra por responsable usando el CORREO', () => {
  // El desplegable muestra el nombre pero manda el correo: en el servidor las
  // personas se identifican por correo, y mandar el nombre no encontraría nada
  // — el reporte saldría vacío sin decir por qué.
  const ctx = ctxJefatura();
  seedSheet(ctx, 'JEFATURAS', ctx.COLUMNAS.JEFATURAS, [
    ['J1', 'jefe@x.cl', 'ben@x.cl', true],
    ['J2', 'jefe@x.cl', 'cris@x.cl', true]
  ]);
  sembrar(ctx, [
    { id: 'DE-BEN', fecha: '2026-05-10T00:00:00.000Z', dev: 'ben@x.cl' },
    { id: 'DE-CRIS', fecha: '2026-05-10T00:00:00.000Z', dev: 'cris@x.cl' }
  ]);

  assert.deepEqual(ids(ctx.Jefatura.getPanel({ desarrollador: 'ben@x.cl' }, JEFE)), ['DE-BEN']);
  assert.deepEqual(ids(ctx.Jefatura.getPanel({ desarrollador: 'Ben Dev' }, JEFE)), [],
    'el nombre NO es un identificador válido aquí');
});
