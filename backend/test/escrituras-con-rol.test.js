'use strict';

/**
 * Ninguna acción que ESCRIBE se queda sin control de rol por descuido.
 *
 * Hermano de `acciones-con-porton.test.js`, y complementario: aquel cubre el
 * control de MÓDULO, que es lo único que comprueba el router (`doPost`). El
 * módulo dice a qué pantalla entra la cuenta; no dice quién puede escribir en
 * ella. Eso lo decide cada handler por su cuenta, uno por uno, 124 veces.
 *
 * Un reparto así funciona mientras nadie olvide su parte, y el olvido no hace
 * ruido: la acción responde `ok`, escribe, y nadie se entera hasta que alguien
 * escribe donde no debía.
 *
 * Medido al escribir este test (2026-09-06): de 262 acciones, 124 escriben.
 * Las 124 comprueban algo. Este test existe para que la número 125 no pueda
 * entrar sin comprobar nada.
 *
 * QUÉ COMPRUEBA, Y QUÉ NO. Es un cedazo sobre el CÓDIGO FUENTE, no una prueba
 * de comportamiento: verifica que en el camino de la acción aparezca ALGUNA
 * comprobación de permiso, no que esa comprobación sea la correcta ni que
 * cubra todas sus ramas. Detecta el olvido completo, que es el fallo que de
 * verdad se cuela. Un gate mal escrito necesita su propio test, y los módulos
 * los tienen.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'backoffice');

/**
 * Acciones que ESCRIBEN y no comprueban rol, con el motivo de cada una.
 *
 * La regla para entrar aquí: la escritura está acotada a la propia fila de
 * quien llama, y el alcance sale de `contexto`, nunca de un identificador
 * enviado por el navegador. Si la acción puede tocar la fila de otra persona,
 * no pertenece a esta lista por mucho que hoy nadie lo haga.
 */
const ESCRIBEN_SIN_ROL_A_PROPOSITO = {
  // Escribe `ultima_visita_sala` en la fila de integrante del PROPIO llamador
  // (se busca por contexto.email); si no es integrante devuelve
  // {actualizado:false} sin tocar nada. Un rol no añadiría nada.
  marcarSalaVisitadaProyecto: 'sella la fila propia, buscada por contexto.email'
};

/** Ayudantes que SON el control de permiso, cada uno con su convención. */
const GATE = new RegExp([
  'contexto\\.rol',                 // comprobación directa
  '\\brol\\s*===',
  '_forbidden',                     // la respuesta de un portero
  'guarda[A-Z][A-Za-z0-9]*_',       // guardaAdminPausas_, guardaCoordinadorPausa_
  'puede[A-Z][A-Za-z0-9]*_',        // puedeVerDetalle_, puedeGestionar_, ...
  'es[A-Z][A-Za-z0-9]*_\\s*\\(\\s*contexto', // esEncargadoSgc_(contexto)
  'exigir[A-Z][A-Za-z0-9]*_'
].join('|'));

/** Lo que cuenta como escribir en la hoja. */
const ESCRIBE = /agregarFila_|actualizarFilaPorId_|actualizarFila_|eliminarFila|borrarFila|appendRow|setValues|guardarFila_/;

const fuentes = {};
fs.readdirSync(DIR).filter((f) => f.endsWith('.gs')).forEach((f) => {
  fuentes[f] = fs.readFileSync(path.join(DIR, f), 'utf8');
});

/** Cuerpo de la primera función que case, delimitado contando llaves. */
function cuerpoDe(patron) {
  const nombres = Object.keys(fuentes);
  for (let k = 0; k < nombres.length; k++) {
    const s = fuentes[nombres[k]];
    const m = s.match(patron);
    if (!m) continue;
    let i = s.indexOf('{', m.index + m[0].length - 1);
    if (i === -1) i = s.indexOf('{', m.index);
    if (i === -1) continue;
    let n = 0;
    let j = i;
    for (; j < s.length; j++) {
      if (s[j] === '{') n++;
      else if (s[j] === '}') { n--; if (n === 0) break; }
    }
    return { archivo: nombres[k], texto: s.slice(i, j + 1) };
  }
  return null;
}

function accionesDelRouter() {
  const code = fuentes['Code.gs'];
  const desde = code.indexOf('var BACKOFFICE_ACTIONS');
  const tabla = code.slice(desde, code.indexOf('\n};', desde));
  const salida = [];
  tabla.split('\n').forEach((l) => {
    const m = l.match(/^\s{2}([A-Za-z0-9_]+)\s*:\s*([A-Za-z0-9_.]+)\s*,?\s*$/);
    if (m) salida.push({ accion: m[1], handler: m[2] });
  });
  return salida;
}

/**
 * Código que recorre una acción: el handler del router más, si delega, el
 * método del módulo al que llama. El gate suele estar en el segundo, no en el
 * primero -- mirar solo el handler daría 124 falsos positivos.
 */
function codigoDeLaAccion(a) {
  const h = cuerpoDe(new RegExp('function\\s+' + a.handler.replace(/\./g, '\\.') + '\\s*\\('));
  if (!h) return null;
  let texto = h.texto;
  const d = texto.match(/\b([A-Z][A-Za-z0-9]*)\.([a-zA-Z0-9_]+)\s*\(/);
  if (d) {
    const sub = cuerpoDe(new RegExp(
      '\\b' + d[1] + '\\.' + d[2] + '\\s*=\\s*function\\s*\\(' +
      '|(?:^|\\n)\\s{2,6}' + d[2] + '\\s*:\\s*function\\s*\\('
    ));
    if (sub) texto += '\n' + sub.texto;
  }
  return texto;
}

test('toda acción del router se puede localizar en el fuente', () => {
  // El resto del archivo no vale nada si el analizador deja de encontrar los
  // handlers: contaría cero escrituras y pasaría siempre.
  const perdidas = accionesDelRouter().filter((a) => codigoDeLaAccion(a) === null);
  assert.deepEqual(perdidas.map((a) => a.accion), [],
    'si el analizador no encuentra un handler, este test se vuelve ciego');
});

test('el analizador ve un número de escrituras coherente', () => {
  // Segunda red contra la ceguera: si un refactor cambiara los nombres de
  // agregarFila_/actualizarFilaPorId_, ESCRIBE dejaría de casar con nada y el
  // test seguiría en verde sin comprobar ya nada.
  const escriben = accionesDelRouter().filter((a) => ESCRIBE.test(codigoDeLaAccion(a) || ''));
  assert.ok(escriben.length >= 120,
    'se contaron ' + escriben.length + ' acciones de escritura; el 2026-09-06 ' +
    'eran 124. Una caída así significa que el detector dejó de reconocer las ' +
    'escrituras, no que el sistema haya dejado de escribir. El piso está en 120 ' +
    'y no en 90: perder UNO de los seis patrones ya tiene que doler.');
});

test('ninguna acción escribe sin comprobar permiso', () => {
  const sinGate = [];
  accionesDelRouter().forEach((a) => {
    const texto = codigoDeLaAccion(a);
    if (!texto || !ESCRIBE.test(texto)) return;
    if (GATE.test(texto)) return;
    if (ESCRIBEN_SIN_ROL_A_PROPOSITO[a.accion]) return;
    sinGate.push(a.accion + ' (' + a.handler + ')');
  });

  assert.deepEqual(sinGate, [],
    'Estas acciones escriben en la hoja sin comprobar quién llama:\n  ' +
    sinGate.join('\n  ') +
    '\n\nO le pones un control de permiso, o la agregas a ' +
    'ESCRIBEN_SIN_ROL_A_PROPOSITO con el motivo escrito. La lista es corta a ' +
    'propósito: cada entrada es una puerta que alguien decidió dejar abierta.');
});

test('la lista de excepciones no acumula entradas muertas', () => {
  // Una excepción que ya no corresponde a ninguna acción es peor que
  // inútil: da la impresión de que se revisó algo que ya no existe.
  const vivas = {};
  accionesDelRouter().forEach((a) => { vivas[a.accion] = true; });
  const muertas = Object.keys(ESCRIBEN_SIN_ROL_A_PROPOSITO).filter((n) => !vivas[n]);
  assert.deepEqual(muertas, [], 'excepciones de acciones que ya no existen');
});
