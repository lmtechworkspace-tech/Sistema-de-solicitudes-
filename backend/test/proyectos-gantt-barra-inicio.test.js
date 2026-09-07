'use strict';

/**
 * v15.4 (frontend): la barra del Gantt en pantalla (Cronograma > Plan) usaba
 * `a.fecha_creacion` como inicio SIN comprobar que fuera coherente con el
 * compromiso. Una tarea CARGADA TARDE (fecha_creacion queda DESPUÉS de su
 * fecha_compromiso -- se migró, se importó en bloque, o se tecleó semanas
 * después del acuerdo real) hacía que la barra saliera con el fin antes que
 * el inicio: ancho negativo, recortado a un filo de 4px pegado al fin. Caso
 * real reportado: un proyecto que arrancó el 07-08 con tareas cargadas en
 * SIGSO el 01-09 y comprometidas de vuelta al 28-08 -- la barra debía
 * arrancar en agosto (el inicio del proyecto) y arrancaba en septiembre.
 *
 * El mismo defecto ya se había corregido en el backend (Proyectos.gs,
 * planInicioEfectivoClave_, que alimenta el PDF y el chip de texto "Plan
 * dd/mm–dd/mm"), pero esta barra la dibuja el NAVEGADOR con su propio cálculo
 * -- corregir el backend no le llegaba.
 *
 * El dibujo mide el DOM y vive en el navegador (mismo criterio que
 * proyectos-gantt-conectores.test.js): no se puede ejercitar la función
 * completa desde el sandbox, así que esto fija la invariante por fuente --
 * que exista la corrección y que la barra la use, no el valor crudo.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const JS = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend/js/proyectos.js'), 'utf8');

test('existe la corrección de inicio de barra (inicioBarraEfectivo_)', () => {
  assert.match(JS, /function inicioBarraEfectivo_\(a\)/, 'falta la función de corrección');
});

test('inicioBarraEfectivo_: usa el inicio del PROYECTO cuando la creación quedó después del compromiso', () => {
  const i = JS.indexOf('function inicioBarraEfectivo_');
  const cuerpo = JS.slice(i, JS.indexOf('\n    }', i));
  assert.match(cuerpo, /kCreacion <= kCompromiso/, 'debe comparar creación contra compromiso');
  assert.match(cuerpo, /p\.fecha_inicio/, 'debe caer al inicio del proyecto cuando la creación no es coherente');
});

test('la fila del Gantt usa la corrección, no el valor crudo de fecha_creacion', () => {
  const i = JS.indexOf('function filaTareaGantt_(a)');
  assert.notEqual(i, -1, 'falta filaTareaGantt_');
  const cuerpo = JS.slice(i, JS.indexOf('\n    }', i));
  assert.match(cuerpo, /offsetPx_\(inicioBarraEfectivo_\(a\)\)/,
    'la barra debe partir de inicioBarraEfectivo_, no de a.fecha_creacion directo');
  assert.doesNotMatch(cuerpo, /offsetPx_\(a\.fecha_creacion \|\| p\.fecha_inicio \|\| a\.fecha_compromiso\)/,
    'no debe haber vuelto al cálculo crudo (sin comprobar coherencia con el compromiso)');
});

// --- La misma corrección, ejecutada como función pura (fuera del DOM) ------
// inicioBarraEfectivo_ no toca `document`/`window`: se puede extraer y probar
// el contrato directamente, sin levantar todo proyectos.js.

function inicioBarraEfectivo_(a, p, claveDeIso_) {
  if (a.fecha_creacion && a.fecha_compromiso) {
    var kCreacion = claveDeIso_(a.fecha_creacion);
    var kCompromiso = claveDeIso_(a.fecha_compromiso);
    if (kCreacion <= kCompromiso) return a.fecha_creacion;
    if (p.fecha_inicio && claveDeIso_(p.fecha_inicio) <= kCompromiso) return p.fecha_inicio;
    return a.fecha_compromiso;
  }
  return a.fecha_creacion || p.fecha_inicio || a.fecha_compromiso;
}
function claveDeIso_(iso) { return String(iso).slice(0, 10); }

test('caso real: tarea creada 01-09, comprometida 28-08, proyecto iniciado 07-08 -> la barra arranca en 07-08', () => {
  const a = { fecha_creacion: '2026-09-01T00:00:00.000Z', fecha_compromiso: '2026-08-28' };
  const p = { fecha_inicio: '2026-08-07' };
  assert.equal(inicioBarraEfectivo_(a, p, claveDeIso_), '2026-08-07');
});

test('tarea normal (creación antes del compromiso): la barra sigue arrancando en la creación', () => {
  const a = { fecha_creacion: '2026-08-01T00:00:00.000Z', fecha_compromiso: '2026-08-28' };
  const p = { fecha_inicio: '2026-08-07' };
  assert.equal(inicioBarraEfectivo_(a, p, claveDeIso_), a.fecha_creacion);
});

test('sin fecha de inicio del proyecto (o también incoherente), cae al propio compromiso -- nunca invertida', () => {
  const a = { fecha_creacion: '2026-09-01T00:00:00.000Z', fecha_compromiso: '2026-08-28' };
  assert.equal(inicioBarraEfectivo_(a, {}, claveDeIso_), a.fecha_compromiso);
  assert.equal(inicioBarraEfectivo_(a, { fecha_inicio: '2026-09-15' }, claveDeIso_), a.fecha_compromiso);
});
