'use strict';

/**
 * xlsxZip.js — escritor de ZIP (DEFLATE) mínimo usado por libroProyecto.js
 * en vez de Utilities.zip (Apps Script). Prueba de ida y vuelta: lo que
 * construirZip_ arma, leerZip_ (o cualquier lector ZIP estándar) lo puede
 * leer de vuelta byte a byte.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { construirZip_, leerZip_ } = require('../logica/xlsxZip');

test('construirZip_/leerZip_: ida y vuelta de una entrada de texto', () => {
  const zip = construirZip_([{ nombre: 'hola.txt', contenido: 'Hola, mundo' }]);
  assert.equal(zip[0], 0x50); assert.equal(zip[1], 0x4b); // firma "PK"
  const entradas = leerZip_(zip);
  assert.equal(entradas.length, 1);
  assert.equal(entradas[0].nombre, 'hola.txt');
  assert.equal(entradas[0].contenido.toString('utf8'), 'Hola, mundo');
});

test('construirZip_/leerZip_: varias entradas, nombres con subcarpeta, contenido con acentos/símbolos', () => {
  const entradasIn = [
    { nombre: '[Content_Types].xml', contenido: '<Types/>' },
    { nombre: 'xl/worksheets/sheet1.xml', contenido: '<worksheet>Avance ◆ 100% — año</worksheet>' },
    { nombre: 'xl/styles.xml', contenido: 'x'.repeat(5000) } // fuerza compresión real, no solo un byte
  ];
  const zip = construirZip_(entradasIn);
  const entradasOut = leerZip_(zip);
  assert.equal(entradasOut.length, entradasIn.length);
  entradasIn.forEach((esperada, i) => {
    assert.equal(entradasOut[i].nombre, esperada.nombre);
    assert.equal(entradasOut[i].contenido.toString('utf8'), esperada.contenido);
  });
});

test('construirZip_: contenido vacío no rompe la entrada', () => {
  const zip = construirZip_([{ nombre: 'vacio.xml', contenido: '' }]);
  const entradas = leerZip_(zip);
  assert.equal(entradas[0].contenido.length, 0);
});
