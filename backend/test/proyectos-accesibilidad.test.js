'use strict';

/**
 * P-04 y la alternativa por teclado del Gantt.
 *
 * Estas dos cosas se rompen SIN QUE NADIE LO NOTE mirando la pantalla: el
 * texto alternativo es invisible, y el botón de reprogramar puede seguir
 * dibujándose aunque su manejador deje de alcanzarlo. Por eso se fijan aquí,
 * con el mismo criterio de test-que-lee-el-fuente que fuentes-texto.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const JS = fs.readFileSync(path.join(RAIZ, 'frontend/js/proyectos.js'), 'utf8');
const CSS = fs.readFileSync(path.join(RAIZ, 'frontend/css/components.css'), 'utf8');

test('los avatares del portafolio tienen texto alternativo del equipo', () => {
  // Componentes.avatar marca cada pieza con aria-hidden a propósito (el nombre
  // suele estar escrito al lado). En la tarjeta del portafolio NO lo está: los
  // avatares son la única representación del equipo, así que el grupo entero
  // necesita anunciarse como una sola imagen con su etiqueta.
  assert.match(JS, /class="sigso-py-card__avatares" role="img" aria-label=/,
    'el grupo de avatares debe ser un role="img" con aria-label');
  assert.match(JS, /function etiquetaEquipo_/, 'falta el helper que arma la etiqueta');

  const i = JS.indexOf('function etiquetaEquipo_');
  const cuerpo = JS.slice(i, JS.indexOf('\n  }', i));
  assert.match(cuerpo, /Sin equipo asignado/,
    'un proyecto sin integrantes también tiene que decir algo');
  assert.doesNotMatch(cuerpo, /MAX_AVATARES_TARJETA/,
    'la etiqueta nombra a TODOS: el recorte a cuatro existe por espacio visual, ' +
    'y ese límite no tiene por qué trasladarse a quien escucha');
});

test('el Gantt ofrece reprogramar sin arrastrar', () => {
  // Arrastrar el borde de una barra era la ÚNICA forma de reprogramar desde la
  // vista Plan. El botón reusa la clase y el manejador de Dedicación: mismo
  // modal, cero lógica nueva.
  assert.match(JS, /js-py-ded-reprogramar sigso-py-gantt-reprog/,
    'el botón del Gantt debe reusar la clase del de Dedicación');
});

test('el manejador de reprogramar alcanza LAS DOS vistas', () => {
  // El botón se dibujaba en el Gantt pero el manejador solo escuchaba en
  // .sigso-py-ded-scroll: el botón existía y no hacía nada. Un fallo mudo.
  const i = JS.indexOf("'.sigso-py-ded-scroll', '.sigso-py-gantt-scroll'");
  assert.ok(i !== -1,
    'el manejador tiene que engancharse a los dos contenedores scrollables, ' +
    'no solo al de Dedicación');
});

test('el botón de reprogramar del Gantt cumple el mínimo de área táctil', () => {
  const i = CSS.indexOf('.sigso-py-gantt-reprog {');
  assert.ok(i !== -1, 'falta la regla del botón del Gantt');
  const bloque = CSS.slice(i, CSS.indexOf('}', i));
  assert.match(bloque, /min-width:\s*24px/, '24x24 es el mínimo recomendado');
  assert.match(bloque, /min-height:\s*24px/);
  assert.match(bloque, /flex:\s*0 0 auto/,
    'sin esto un título largo lo comprime hasta desaparecer');
});
