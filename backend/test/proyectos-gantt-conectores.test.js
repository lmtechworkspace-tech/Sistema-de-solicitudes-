'use strict';

/**
 * G-01: los conectores de dependencia del Gantt.
 *
 * El dibujo mide el DOM y vive en el navegador, así que no se puede ejercitar
 * desde el sandbox. Lo que SÍ se puede fijar aquí es la invariante que, si se
 * rompe, no falla nada visible pero deja el Gantt inutilizable:
 *
 *   La capa SVG de conectores se pinta ENCIMA de las barras (z-index 2) para
 *   que la punta de flecha toque el borde de la barra. Si pierde
 *   `pointer-events: none`, se come el mousedown del handle de resize y
 *   arrastrar para reprogramar deja de funcionar — sin error, sin síntoma,
 *   solo un gesto que ya no responde.
 *
 * Mismo criterio de test-que-lee-el-fuente que fuentes-texto.test.js y
 * proyectos-permisos-espejo.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const CSS = fs.readFileSync(path.join(RAIZ, 'frontend/css/components.css'), 'utf8');
const JS = fs.readFileSync(path.join(RAIZ, 'frontend/js/proyectos.js'), 'utf8');

function bloqueCss(selector) {
  const i = CSS.indexOf(selector + ' {');
  if (i === -1) return null;
  const fin = CSS.indexOf('}', i);
  return CSS.slice(i, fin + 1);
}

test('la capa de conectores no intercepta el mouse', () => {
  const bloque = bloqueCss('.sigso-py-gantt-deps');
  assert.ok(bloque, 'falta la regla .sigso-py-gantt-deps');
  assert.match(
    bloque, /pointer-events:\s*none/,
    'Sin pointer-events:none la capa SVG se come el mousedown del handle de ' +
    'resize y arrastrar una barra para reprogramarla deja de funcionar, sin ' +
    'ningún error visible.'
  );
});

test('los conectores se dibujan midiendo, no con la altura de fila copiada del CSS', () => {
  assert.match(JS, /function dibujarConectoresGantt_/, 'falta dibujarConectoresGantt_');
  const i = JS.indexOf('function dibujarConectoresGantt_');
  const cuerpo = JS.slice(i, JS.indexOf('\n  }', i));
  assert.match(
    cuerpo, /getBoundingClientRect/,
    'El trazado tiene que MEDIR el DOM. La altura de fila vive en el CSS en ' +
    'rem; replicarla aquí en píxeles la desincroniza al primer retoque de estilo.'
  );
  assert.doesNotMatch(
    cuerpo, /2\.9\s*\*\s*16|46\.4|\bALTO_FILA\b/,
    'Parece haberse colado una altura de fila fija en el JS.'
  );
});

test('el toggle de dependencias solo existe si hay dependencias que dibujar', () => {
  // Mismo criterio que la ruta crítica: sin ninguna dependencia declarada, un
  // botón que no puede mostrar nada es ruido.
  assert.match(
    JS, /var dependenciasBtn = hayRutaCritica/,
    'El botón de Dependencias debe colgar de hayRutaCritica, igual que el de Ruta crítica.'
  );
});

test('la barra del Gantt publica lo que el trazado necesita', () => {
  // data-act para localizarla, data-dep para saber de quién depende. Antes
  // solo el handle de resize llevaba data-act, y ese únicamente existe si la
  // tarea es editable: las no editables quedaban fuera del grafo.
  assert.match(JS, /data-act="' \+ Componentes\.escaparHtml\(a\.actividad_id\)/,
    'la barra debe llevar data-act');
  assert.match(JS, /a\.depende_de \? ' data-dep="'/,
    'la barra debe llevar data-dep cuando hay dependencia');
});
