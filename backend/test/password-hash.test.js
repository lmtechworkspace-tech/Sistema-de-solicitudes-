'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Hash = require('../logica/passwordHash');

test('hashPassword es determinista para la misma clave y sal', () => {
  const salt = Hash.generarSalt();
  assert.equal(Hash.hashPassword('clave-123', salt), Hash.hashPassword('clave-123', salt));
});

test('hashPassword nunca guarda la clave en claro dentro del hash', () => {
  const hash = Hash.hashPassword('secreto-obvio', 's1');
  assert.equal(hash.includes('secreto-obvio'), false);
});

test('la sal distinta produce hashes distintos para la misma clave', () => {
  assert.notEqual(Hash.hashPassword('a', 's1'), Hash.hashPassword('a', 's2'));
});

test('la clave distinta produce hashes distintos con la misma sal', () => {
  assert.notEqual(Hash.hashPassword('a', 's1'), Hash.hashPassword('b', 's1'));
});

test('coincide() acepta la clave correcta y rechaza cualquier otra', () => {
  const salt = Hash.generarSalt();
  const hash = Hash.hashPassword('clave-correcta', salt);
  assert.equal(Hash.coincide('clave-correcta', salt, hash), true);
  assert.equal(Hash.coincide('clave-incorrecta', salt, hash), false);
  assert.equal(Hash.coincide('clave-correcta', 'otra-sal', hash), false);
});

test('generarClaveTemporal produce 10 caracteres sin 0/O/1/l/I', () => {
  for (let i = 0; i < 20; i++) {
    const clave = Hash.generarClaveTemporal();
    assert.equal(clave.length, 10);
    assert.doesNotMatch(clave, /[0O1lI]/);
  }
});

test('generarToken produce valores distintos cada vez', () => {
  const a = Hash.generarToken();
  const b = Hash.generarToken();
  assert.notEqual(a, b);
});
