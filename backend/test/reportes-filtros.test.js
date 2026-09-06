'use strict';

/**
 * Los filtros del motor de reportes.
 *
 * Hasta ahora el motor sabía DIBUJAR filtros y LEERLOS, pero no aplicarlos:
 * cada módulo se las arreglaba dentro de sus propios cuerpos. Por eso
 * Gerencia, Jefatura y Proyectos declaraban `filtros: []` — no había con qué.
 *
 * Estas funciones son puras (no tocan el DOM), así que se pueden EJECUTAR de
 * verdad en vez de leer el fuente, que es lo que hacen las otras pruebas de
 * frontend. Se ejercita el módulo tal cual lo carga el navegador.
 *
 * Lo que se sostiene aquí es lo que rompería un número sin avisar:
 *
 *   · Que "este trimestre" signifique lo mismo en todos los módulos. Si
 *     Gerencia y Jefatura lo resolvieran por su cuenta, un jefe y Gerencia
 *     verían cifras distintas del mismo equipo y nadie sabría cuál creer.
 *   · Que el corte no se vaya un día por el huso horario. Las fechas se
 *     comparan como texto ISO justamente para eso.
 *   · Que un ítem SIN la fecha por la que se corta no se cuele dentro del
 *     rango: no se puede afirmar que cae en un rango que no tiene.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..');

function cargarMotor() {
  const codigo = fs.readFileSync(path.join(RAIZ, 'frontend/js/reportes.js'), 'utf8');
  const ventana = {};
  const contexto = vm.createContext({
    window: ventana, document: undefined, console,
    Date, Math, Object, Array, String, Number, JSON, isNaN
  });
  vm.runInContext(codigo, contexto);
  return ventana.SigsoReportes;
}

const M = cargarMotor();

// Los objetos que vuelven del vm traen el prototipo de OTRO realm, asi que
// deepEqual los rechaza aunque su contenido sea identico. Es la misma trampa
// que resuelve toPlain() en gasSandbox: se aplanan antes de comparar.
const plano = (v) => JSON.parse(JSON.stringify(v));

// Un 15 de mayo: mes 05, trimestre abril-junio, año 2026.
const HOY = '2026-05-15';

test('el motor expone los filtros aplicables', () => {
  assert.equal(typeof M.rangoDePeriodo, 'function');
  assert.equal(typeof M.filtrarItems, 'function');
  assert.equal(typeof M.opcionesDeItems, 'function');
});

test('cada período se traduce al rango que la gente espera', () => {
  assert.deepEqual(plano(M.rangoDePeriodo('mes', HOY)), { desde: '2026-05-01', hasta: '2026-05-31' });
  assert.deepEqual(plano(M.rangoDePeriodo('trimestre', HOY)), { desde: '2026-04-01', hasta: '2026-06-30' },
    'el trimestre es el CALENDARIO (abr-jun), no los últimos tres meses');
  assert.deepEqual(plano(M.rangoDePeriodo('anio', HOY)), { desde: '2026-01-01', hasta: '2026-12-31' });
});

test('"todo" y un período desconocido no cortan nada', () => {
  // Un período que no se entiende no puede convertirse en un rango
  // inventado: dejaría el reporte vacío y parecería que no hay datos.
  assert.deepEqual(plano(M.rangoDePeriodo('todo', HOY)), { desde: '', hasta: '' });
  assert.deepEqual(plano(M.rangoDePeriodo('', HOY)), { desde: '', hasta: '' });
  assert.deepEqual(plano(M.rangoDePeriodo('quincena', HOY)), { desde: '', hasta: '' });
});

test('los meses cortos y los bisiestos salen bien', () => {
  assert.equal(M.rangoDePeriodo('mes', '2026-02-10').hasta, '2026-02-28');
  assert.equal(M.rangoDePeriodo('mes', '2028-02-10').hasta, '2028-02-29', '2028 es bisiesto');
  assert.equal(M.rangoDePeriodo('mes', '2026-04-10').hasta, '2026-04-30');
  assert.equal(M.rangoDePeriodo('trimestre', '2026-01-05').hasta, '2026-03-31');
  assert.equal(M.rangoDePeriodo('trimestre', '2026-12-31').desde, '2026-10-01');
});

test('el primer y el último día del mes CAEN dentro del mes', () => {
  // El fallo clásico de comparar con objetos Date: un ítem del día 1 se va al
  // mes anterior porque el navegador está en otro huso. Por eso se compara
  // como texto ISO.
  const items = [
    { id: 'primero', fecha_creacion: '2026-05-01T00:00:00.000Z' },
    { id: 'ultimo', fecha_creacion: '2026-05-31T23:59:59.000Z' },
    { id: 'antes', fecha_creacion: '2026-04-30T23:00:00.000Z' },
    { id: 'despues', fecha_creacion: '2026-06-01T01:00:00.000Z' }
  ];
  const r = M.filtrarItems(items, { periodo: 'mes' }, { campoFecha: 'fecha_creacion', hoy: HOY });
  assert.deepEqual(r.map((i) => i.id), ['primero', 'ultimo']);
});

test('un ítem sin la fecha por la que se corta queda fuera', () => {
  // No se puede afirmar que cae dentro de un rango que no tiene. Colarlo
  // inflaría el total del período con ítems que no le pertenecen.
  const items = [
    { id: 'con', fecha_terminada: '2026-05-10' },
    { id: 'sin', fecha_terminada: '' },
    { id: 'nulo', fecha_terminada: null }
  ];
  const r = M.filtrarItems(items, { periodo: 'mes' }, { campoFecha: 'fecha_terminada', hoy: HOY });
  assert.deepEqual(r.map((i) => i.id), ['con']);
});

test('sin período, un ítem sin fecha NO se pierde', () => {
  // La otra mitad de la regla anterior: si nadie pidió un corte por fecha,
  // que le falte una fecha no puede ser motivo para desaparecer.
  const items = [{ id: 'sin', fecha_terminada: '' }, { id: 'con', fecha_terminada: '2020-01-01' }];
  const r = M.filtrarItems(items, { periodo: 'todo' }, { campoFecha: 'fecha_terminada', hoy: HOY });
  assert.equal(r.length, 2);
});

test('un desde/hasta escrito a mano manda sobre el período', () => {
  const items = [
    { id: 'a', fecha_creacion: '2026-05-10' },
    { id: 'b', fecha_creacion: '2026-01-10' }
  ];
  const r = M.filtrarItems(items,
    { periodo: 'mes', desde: '2026-01-01', hasta: '2026-01-31' },
    { campoFecha: 'fecha_creacion', hoy: HOY });
  assert.deepEqual(r.map((i) => i.id), ['b'], 'si la persona escribió fechas, son las suyas');
});

test('área, responsable y estado filtran por el campo que el reporte declara', () => {
  const items = [
    { id: 'a', area_nombre: 'Soporte', desarrollador_nombre: 'Ada', estado: 'S04' },
    { id: 'b', area_nombre: 'Soporte', desarrollador_nombre: 'Ben', estado: 'S04' },
    { id: 'c', area_nombre: 'Ventas', desarrollador_nombre: 'Ada', estado: 'S09' }
  ];
  const campos = { area: 'area_nombre', responsable: 'desarrollador_nombre', estado: 'estado' };

  assert.deepEqual(M.filtrarItems(items, { area: 'Soporte' }, { campos }).map((i) => i.id), ['a', 'b']);
  assert.deepEqual(M.filtrarItems(items, { responsable: 'Ada' }, { campos }).map((i) => i.id), ['a', 'c']);
  assert.deepEqual(M.filtrarItems(items, { area: 'Soporte', responsable: 'Ada' }, { campos }).map((i) => i.id), ['a'],
    'dos filtros se acumulan, no se reemplazan');
});

test('un filtro sin valor no filtra', () => {
  // "Todas" en el select llega como cadena vacía. Si eso filtrara, elegir
  // "Todas" dejaría la pantalla en blanco.
  const items = [{ id: 'a', area_nombre: 'Soporte' }, { id: 'b', area_nombre: '' }];
  const campos = { area: 'area_nombre' };
  assert.equal(M.filtrarItems(items, { area: '' }, { campos }).length, 2);
  assert.equal(M.filtrarItems(items, {}, { campos }).length, 2);
});

test('las opciones de los selects salen de los datos, sin repetidos y ordenadas', () => {
  // Se sacan de los ítems y no de un catálogo para que no aparezca un área
  // sin nada que mostrar: elegirla daría un reporte vacío que parece un error.
  const items = [
    { area_nombre: 'Soporte' }, { area_nombre: 'Ventas' },
    { area_nombre: 'Soporte' }, { area_nombre: '' }, { area_nombre: 'Álava' }
  ];
  const o = plano(M.opcionesDeItems(items, { area: 'area_nombre' }));
  assert.deepEqual(o.area, [
    { valor: 'Álava', texto: 'Álava' },
    { valor: 'Soporte', texto: 'Soporte' },
    { valor: 'Ventas', texto: 'Ventas' }
  ], 'sin repetidos, sin vacíos y ordenadas con criterio español');
});

test('filtrar no toca la lista original', () => {
  // Los reportes comparten los ítems del panel: si filtrar los mutara, abrir
  // un reporte con filtro dejaría a los demás viendo un subconjunto.
  const items = [{ id: 'a', area_nombre: 'Soporte' }, { id: 'b', area_nombre: 'Ventas' }];
  M.filtrarItems(items, { area: 'Soporte' }, { campos: { area: 'area_nombre' } });
  assert.equal(items.length, 2);
});

test('sin período elegido, el desplegable marca "Todo" y no la primera opción', () => {
  // Un <select> siempre tiene algo seleccionado. Si se dejara al navegador
  // elegir, el desplegable diría "Este mes" mientras el reporte muestra todo:
  // quien lo lea creería estar viendo un corte que nunca se aplicó. Y como
  // rangoDePeriodo('todo') no corta nada, lo que se ve coincide con lo que pasa.
  const html = M.pintarFiltros({ filtros: ['periodo'] }, {}, {});
  const marcada = html.match(/<option value="([^"]+)" selected>/);
  assert.ok(marcada, 'alguna opción tiene que quedar marcada');
  assert.equal(marcada[1], 'todo');
});

test('"Todo" no se anuncia como un corte en la cabecera del documento', () => {
  // No dejó nada fuera: listarlo sería ensuciar la cabecera con una promesa
  // de recorte que no existe.
  const r = { filtros: ['periodo'] };
  assert.deepEqual(plano(M.filtrosParaCabecera(r, {}, { periodo: 'todo' })), []);
  assert.deepEqual(plano(M.filtrosParaCabecera(r, {}, { periodo: 'mes' })),
    [{ etiqueta: 'Período', valor: 'Este mes' }]);
});

test('el reporte puede afinar el nombre del período, y se usa en los dos lados', () => {
  // "Período" a secas deja adivinando por cuál de las fechas corta. El nombre
  // afinado tiene que salir igual en el formulario y en la cabecera, o el
  // documento diría una cosa y la pantalla otra.
  const r = { filtros: ['periodo'], etiquetaPeriodo: 'Ítems creados en' };
  assert.match(M.pintarFiltros(r, {}, {}), /Ítems creados en/);
  assert.equal(plano(M.filtrosParaCabecera(r, {}, { periodo: 'mes' }))[0].etiqueta, 'Ítems creados en');
});
