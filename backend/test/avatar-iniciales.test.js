'use strict';

/**
 * v6.4: Componentes.avatar / Componentes.iniciales (frontend/js/components.js).
 *
 * Se prueba desde aqui porque `npm test` corre backend/test/*.test.js y esta
 * logica merece red: sustituyo dos implementaciones duplicadas
 * (plataforma.js iniciales_ y admin.js inicialesCuenta_) que no manejaban
 * particulas ni acentos, y las iniciales son lo que ve TODO usuario que aun
 * no subio una foto.
 *
 * components.js se carga en un vm con un stub minimo de DOM: lo unico que
 * necesita del navegador es document.createElement para escapar HTML.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function cargarComponentes() {
  const codigo = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'js', 'components.js'), 'utf8'
  );
  const sandbox = {
    document: {
      createElement() {
        return {
          textContent: '',
          get innerHTML() {
            return String(this.textContent)
              .replace(/&/g, '&amp;').replace(/</g, '&lt;')
              .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
          }
        };
      },
      // components.js registra listeners globales al cargarse (lightbox,
      // avisos). Aqui no se ejercitan: basta con que no reviente.
      addEventListener() {},
      getElementById() { return null; },
      querySelector() { return null; },
      body: { appendChild() {}, classList: { add() {}, remove() {} } }
    },
    window: { addEventListener() {} }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(codigo, sandbox);
  return sandbox.window.Componentes;
}

const Componentes = cargarComponentes();

test('iniciales: nombre y apellido', () => {
  assert.equal(Componentes.iniciales('Juan Pérez'), 'JP');
});

test('iniciales: un solo nombre usa una sola letra', () => {
  assert.equal(Componentes.iniciales('Leo'), 'L');
});

test('iniciales: nombre compuesto toma las dos primeras palabras significativas', () => {
  // "María José Pérez" -> MJ. Las implementaciones viejas tomaban primera y
  // ULTIMA, devolviendo "MP" y perdiendo el nombre compuesto.
  assert.equal(Componentes.iniciales('María José Pérez'), 'MJ');
  assert.equal(Componentes.iniciales('Juan Carlos'), 'JC');
});

test('iniciales: conserva el acento en la letra mostrada', () => {
  assert.equal(Componentes.iniciales('Ángela Ñuñez'), 'ÁÑ');
});

test('iniciales: salta particulas ("de", "la", "van"...)', () => {
  assert.equal(Componentes.iniciales('Juan de la Cruz'), 'JC');
  assert.equal(Componentes.iniciales('Ludwig van Beethoven'), 'LB');
  assert.equal(Componentes.iniciales('José de Santa María'), 'JS');
});

test('iniciales: espacios sobrantes no afectan', () => {
  assert.equal(Componentes.iniciales('   Camila    Soto  '), 'CS');
});

test('iniciales: sin nombre devuelve un marcador, no una cadena vacia', () => {
  ['', null, undefined, '   ', '---'].forEach((valor) => {
    assert.equal(Componentes.iniciales(valor), '?', 'fallo con: ' + JSON.stringify(valor));
  });
});

test('iniciales: un correo suelto se convierte en iniciales legibles', () => {
  // Hay identidades sin nombre cargado; mostrar "?" seria peor.
  assert.equal(Componentes.iniciales('j.perez@homepymes.cl'), 'JP');
  assert.equal(Componentes.iniciales('camila@rld.cl'), 'C');
});

test('avatar sin foto pinta iniciales y NO incluye ninguna etiqueta img', () => {
  const html = Componentes.avatar({ nombre: 'Juan Pérez' });
  assert.match(html, /JP/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /sigso-avatar--md/, 'tamano por defecto');
});

test('avatar con foto pinta la miniatura y deja las iniciales debajo como respaldo', () => {
  const html = Componentes.avatar(
    { nombre: 'Camila Soto', foto: 'data:image/png;base64,AAA' }, { tam: 'xl' }
  );
  assert.match(html, /<img src="data:image\/png;base64,AAA"/);
  assert.match(html, /sigso-avatar--xl/);
  // Si el data URI estuviese corrupto, onerror retira la imagen y quedan las
  // iniciales que ya estan en el DOM: nunca se ve un icono roto.
  assert.match(html, /onerror/);
  assert.match(html, /CS/);
});

test('avatar escapa el nombre: no se puede inyectar HTML por el titulo', () => {
  const html = Componentes.avatar({ nombre: '<img src=x onerror=alert(1)>' });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img/);
});

test('avatar escapa la URL de la foto', () => {
  const html = Componentes.avatar({ nombre: 'X', foto: '" onerror="alert(1)' });
  assert.doesNotMatch(html, /" onerror="alert\(1\)/);
});
