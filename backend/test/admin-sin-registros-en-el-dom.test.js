'use strict';

/**
 * Administración no vuelve a meter registros dentro de un atributo HTML.
 *
 * QUÉ PASABA. Cada fila de las tablas de Administración llevaba el registro
 * ENTERO serializado en su atributo (`data-editar`, `data-cuenta`,
 * `data-editar-config-pausas`), escapando las comillas simples pero NO el
 * `&`. El navegador decodifica las entidades al leer un atributo, así que
 * cualquier valor con forma de entidad volvía distinto. Comprobado en un
 * navegador real:
 *
 *   guardado    "Bonos &amp; Comisiones"
 *   recuperado  "Bonos & Comisiones"
 *
 * Y no se quedaba en pantalla: al pinchar la fila el formulario se precargaba
 * con el valor corrompido, y al guardar se reescribía el catálogo con el
 * texto mal. Alguien que entra a cambiar el logo de una empresa le cambiaba
 * el nombre sin enterarse.
 *
 * No era XSS: las comillas simples sí se escapaban, y se verificó que un
 * `<script>` en el dato viaja como texto.
 *
 * EL ARREGLO fue quitar la vuelta por el DOM: en el atributo va un ÍNDICE y
 * los registros se quedan en memoria. Este test cuida que no vuelva, porque
 * es un patrón cómodo de reintroducir y el fallo no hace ningún ruido.
 *
 * POR QUÉ ADEMÁS HACE FALTA. Al arreglarlo dejé el cambio a medias: cambié
 * las LECTURAS a índice y en dos de las tres tablas la ESCRITURA siguió
 * emitiendo JSON. El resultado era `filasX_[NaN]` -> undefined, y el clic
 * dejaba de abrir el formulario sin un solo error en consola. Lo encontré
 * mirando el DOM en el navegador; este test lo habría dicho antes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ADMIN_JS = path.join(__dirname, '..', '..', 'frontend', 'js', 'admin.js');
const fuente = fs.readFileSync(ADMIN_JS, 'utf8');

test('ningún atributo de fila lleva un registro serializado', () => {
  // Se busca un JSON.stringify a poca distancia de un atributo data-*, que es
  // exactamente la forma del patrón que se elimino.
  const sospechosas = [];
  fuente.split('\n').forEach((linea, i) => {
    if (!/data-[a-z-]+\s*=/.test(linea)) return;
    if (!/JSON\.stringify/.test(linea)) return;
    sospechosas.push((i + 1) + ': ' + linea.trim().slice(0, 110));
  });

  assert.deepEqual(sospechosas, [],
    'Un registro serializado dentro de un atributo vuelve DISTINTO al leerlo: ' +
    'el navegador decodifica las entidades HTML. Guarda un índice y deja los ' +
    'registros en memoria.\n  ' + sospechosas.join('\n  '));
});

test('cada tabla que lee por índice tiene quien le llene el almacén', () => {
  // La mitad que se me quedó sin hacer. Leer por índice de un almacén que
  // nadie rellena da `undefined` y el clic deja de responder, en silencio.
  const almacenes = [];
  const re = /(filas[A-Za-z0-9_]*_)\[Number\(/g;
  let m;
  while ((m = re.exec(fuente)) !== null) {
    if (almacenes.indexOf(m[1]) === -1) almacenes.push(m[1]);
  }
  assert.ok(almacenes.length >= 2,
    'no se encontraron las lecturas por indice; el detector dejo de reconocer ' +
    'el patron y este test ya no comprueba nada');

  const sinAsignar = almacenes.filter((nombre) => {
    // Se busca una asignación que NO sea la declaración vacía inicial.
    const asignaciones = fuente.match(new RegExp('(?<!var )' + nombre + '\\s*=\\s*(?!\\[\\];)', 'g'));
    return !asignaciones || asignaciones.length === 0;
  });

  assert.deepEqual(sinAsignar, [],
    'Estos almacenes se leen por índice pero nadie los rellena, así que el ' +
    'clic en esa tabla no abriría nada: ' + sinAsignar.join(', '));
});

test('el índice del atributo lo escribe el propio map de la fila', () => {
  // Tercera red: que el atributo reciba de verdad la variable del índice y no
  // una constante. Con `data-editar="0"` fijo, todas las filas abririan el
  // primer registro -- un fallo peor que el original, porque parece que
  // funciona.
  const conIndice = fuente.match(/data-[a-z-]+="'\s*\+\s*indice\s*\+\s*'"/g) || [];
  assert.ok(conIndice.length >= 3,
    'se esperaban al menos las tres tablas (catalogos/usuarios, cuentas del ' +
    'portal y configuracion de pausas) escribiendo su indice; se encontraron ' +
    conIndice.length);
});
