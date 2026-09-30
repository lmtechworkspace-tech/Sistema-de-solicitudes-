'use strict';

/**
 * Directorio de Personas, Fase 3 (2026-09-30): el SELECTOR de personas.
 *
 * Donde antes había que escribir un correo a mano, se busca a la persona por
 * nombre, RUT o cargo. El componente vive en frontend/js/directorio.js y se
 * aplica solo a todo `input[data-persona]`; por dentro se sigue guardando el
 * correo (el input original queda oculto con su mismo name).
 *
 * El componente mide y escucha el DOM, así que aquí se fija por fuente (mismo
 * criterio que proyectos-permisos-espejo.test.js): que exista, que conserve el
 * correo como valor, y que los campos de asignación lo usen.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const JS = path.join(__dirname, '..', '..', 'frontend', 'js');
const leer = (f) => fs.readFileSync(path.join(JS, f), 'utf8');

test('el selector existe, se aplica solo y busca en el directorio', () => {
  const d = leer('directorio.js');
  assert.match(d, /function mejorarCampo\(/);
  assert.match(d, /input\[data-persona\]/, 'se aplica a los campos marcados');
  assert.match(d, /new MutationObserver\(/, 'también a los que aparecen después (drawers)');
  assert.match(d, /'buscarDirectorioPersonas'/);
});

test('por dentro se sigue guardando el correo: el input original queda oculto con su name', () => {
  const d = leer('directorio.js');
  assert.match(d, /original\.type = 'hidden'/);
  assert.match(d, /original\.value = p\.emails\[0\]/, 'elegir a alguien guarda su correo');
  assert.match(d, /esCorreo_\(texto\) \? texto\.toLowerCase\(\) : ''/, 'un correo completo vale tal cual (externos)');
  assert.match(d, /setCustomValidity\(/, 'un texto que no es nadie no se guarda en silencio');
});

// Cada campo donde se asigna a alguien. Si se agrega uno nuevo escribiendo el
// correo a mano, hay que sumarlo aquí con data-persona.
const CAMPOS = [
  ['admin-vistas-v2.js', 'responsable_email'], ['admin-vistas-v2.js', 'jefe_email'], ['admin-vistas-v2.js', 'subordinado_email'],
  ['calidad-ficha-v2.js', 'jefatura_email'], ['calidad-ficha-v2.js', 'subrogante_email'], ['calidad-ficha-v2.js', 'relator_email'],
  ['calidad-medicion-v2.js', 'responsable_email'],
  ['calidad-mejora-v2.js', 'responsable_email'], ['calidad-mejora-v2.js', 'investigador_email'], ['calidad-mejora-v2.js', 'revisado_por'],
  ['calidad-mejora-v2.js', 'auditor_email'], ['calidad-mejora-v2.js', 'director_email'],
  ['calidad-operacion-v2.js', 'responsable_email'], ['calidad-operacion-v2.js', 'liberado_por'],
  ['calidad-sistema-v2.js', 'responsable_email'],
  ['jefatura-vistas-v2.js', 'responsable_nuevo'],
  ['proyectos-v2/equipo.js', 'usuario_email']
];

test('los campos de asignación usan el selector (no un correo escrito a mano)', () => {
  const sinSelector = [];
  CAMPOS.forEach(([archivo, nombre]) => {
    const lineas = leer(archivo).split('\n').filter((l) =>
      (l.includes('name="' + nombre + '"') || l.includes("input('" + nombre + "'")) && /type="email"/.test(l));
    if (!lineas.length) sinSelector.push(archivo + ' → ' + nombre + ' (no se encontró el campo)');
    lineas.filter((l) => !/data-persona/.test(l)).forEach(() => sinSelector.push(archivo + ' → ' + nombre));
  });
  assert.deepEqual(sinSelector, []);
});
