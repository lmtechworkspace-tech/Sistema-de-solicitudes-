'use strict';

/**
 * H-06: los archivos de codigo tienen que ser TEXTO.
 *
 * Perfiles.gs llevaba un byte nulo crudo dentro de una cadena (el centinela
 * de "esta persona no tiene foto"). JavaScript lo aceptaba sin chistar, pero
 * las consecuencias eran reales y silenciosas:
 *
 *   · Git marcaba el archivo como BINARIO: sin diferencias por linea, sin
 *     `git blame`, y sin poder resolver un conflicto a mano.
 *   · `grep -rn` lo saltaba imprimiendo "Binary file ... matches" en vez de
 *     la linea. Cualquier busqueda por el codigo lo ignoraba en silencio.
 *   · Y con un despliegue que consiste en copiar y pegar, un byte invisible
 *     no tiene ninguna garantia de sobrevivir el viaje por el portapapeles.
 *
 * El arreglo fue escribirlo como secuencia de escape, que produce
 * exactamente el mismo valor en ejecucion. Este test existe para que no
 * vuelva a colarse uno.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');

const CARPETAS = [
  'backend/intake',
  'backend/backoffice',
  'backend/setup',
  'frontend/js',
  'frontend/css',
  // Los propios tests entran al barrido: este control nacio de un byte nulo
  // que se colo al escribir ESTE archivo.
  'backend/test'
];

function fuentes() {
  const encontrados = [];
  CARPETAS.forEach((carpeta) => {
    const dir = path.join(RAIZ, carpeta);
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir)
      .filter((f) => /\.(gs|js|css)$/.test(f))
      .forEach((f) => encontrados.push(path.join(carpeta, f)));
  });
  return encontrados;
}

test('ningun archivo de codigo trae bytes de control crudos', () => {
  const archivos = fuentes();
  assert.ok(archivos.length > 40, 'el barrido debe encontrar los fuentes: ' + archivos.length);

  const culpables = [];
  archivos.forEach((relativo) => {
    const contenido = fs.readFileSync(path.join(RAIZ, relativo), 'utf8');
    for (let i = 0; i < contenido.length; i++) {
      const codigo = contenido.charCodeAt(i);
      // Se permiten tabulador (9), salto de linea (10) y retorno (13):
      // son los que estructuran el propio archivo.
      const permitido = codigo === 9 || codigo === 10 || codigo === 13;
      if (codigo < 32 && !permitido) {
        const linea = contenido.slice(0, i).split('\n').length;
        culpables.push(relativo + ':' + linea + ' (byte ' + codigo + ')');
        break;
      }
    }
  });

  assert.deepEqual(culpables, [],
    'un byte de control crudo vuelve el archivo binario para Git y lo hace invisible a grep. ' +
    'Si hace falta ese valor, se escribe como secuencia de escape.');
});

test('el centinela de "sin foto" sigue valiendo lo mismo tras escribirlo como escape', () => {
  // Lo que se cambio fue la REPRESENTACION en el archivo, no el valor: si
  // alguien "limpiara" el escape a otra cosa, el cache de miniaturas dejaria
  // de reconocer las entradas ya guardadas.
  const src = fs.readFileSync(path.join(RAIZ, 'backend/backoffice/Perfiles.gs'), 'utf8');
  const m = src.match(/var SIN_FOTO = '([^']*)';/);
  assert.ok(m, 'debe existir la constante SIN_FOTO');

  // Se evalua el literal tal como esta escrito en el archivo.
  const valor = eval("'" + m[1] + "'");
  assert.equal(valor, '\u0000', 'el valor en ejecución tiene que seguir siendo el carácter nulo');
  assert.equal(valor.length, 1);
});
