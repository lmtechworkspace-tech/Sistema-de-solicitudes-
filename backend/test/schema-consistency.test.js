'use strict';

/**
 * backend/intake/Constantes.gs, backend/backoffice/Constantes.gs y
 * backend/setup/Instalador.gs duplican el mismo esquema de columnas porque
 * son proyectos Apps Script separados (ver nota en backend/intake/Config.gs).
 * Este test es la red de seguridad que impide que las tres copias diverjan
 * silenciosamente.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadGasProject, toPlain } = require('./helpers/gasSandbox');

function cargarEsquemas() {
  const intakeDir = path.join(__dirname, '..', 'intake');
  const backofficeDir = path.join(__dirname, '..', 'backoffice');
  const setupDir = path.join(__dirname, '..', 'setup');

  const ctxIntake = loadGasProject([path.join(intakeDir, 'Constantes.gs')]);
  const ctxBackoffice = loadGasProject([path.join(backofficeDir, 'Constantes.gs')]);
  const ctxSetup = loadGasProject([
    path.join(setupDir, 'Config.gs'),
    path.join(setupDir, 'Instalador.gs')
  ]);

  return {
    intake: toPlain(ctxIntake.COLUMNAS),
    backoffice: toPlain(ctxBackoffice.COLUMNAS),
    setup: toPlain(ctxSetup.ESQUEMA_HOJAS)
  };
}

test('COLUMNAS de Intake, Backoffice y ESQUEMA_HOJAS de Instalador son identicos', () => {
  const { intake, backoffice, setup } = cargarEsquemas();

  const nombresIntake = Object.keys(intake).sort();
  assert.deepEqual(nombresIntake, Object.keys(backoffice).sort(), 'Intake y Backoffice deben declarar las mismas hojas');
  assert.deepEqual(nombresIntake, Object.keys(setup).sort(), 'Intake e Instalador deben declarar las mismas hojas');

  nombresIntake.forEach((nombreHoja) => {
    assert.deepEqual(intake[nombreHoja], backoffice[nombreHoja], 'columnas divergentes (Intake vs Backoffice) en ' + nombreHoja);
    assert.deepEqual(intake[nombreHoja], setup[nombreHoja], 'columnas divergentes (Intake vs Instalador) en ' + nombreHoja);
  });
});

/**
 * H-04: la version viaja en CUATRO copias (los tres proyectos Apps Script y
 * el frontend) porque no hay forma de compartir codigo entre ellos. Toda la
 * utilidad de la marca depende de que sean el mismo valor: si divergen, la
 * plataforma avisaria un desfase que no existe -- o peor, callaria uno real.
 */
test('VERSION_SIGSO es la misma en los tres proyectos y en el frontend', () => {
  const fs = require('node:fs');
  const raiz = path.join(__dirname, '..', '..');

  function leerVersion(archivo, patron) {
    const src = fs.readFileSync(path.join(raiz, archivo), 'utf8');
    const m = src.match(patron);
    assert.ok(m, 'no se encontró la versión en ' + archivo);
    return m[1];
  }

  const versiones = {
    'backend/backoffice/Config.gs': leerVersion('backend/backoffice/Config.gs', /var VERSION_SIGSO = '([^']+)'/),
    'backend/intake/Config.gs': leerVersion('backend/intake/Config.gs', /var VERSION_SIGSO = '([^']+)'/),
    'backend/setup/Config.gs': leerVersion('backend/setup/Config.gs', /var VERSION_SIGSO = '([^']+)'/),
    'frontend/js/config.js': leerVersion('frontend/js/config.js', /VERSION:\s*'([^']+)'/)
  };

  const distintos = [...new Set(Object.values(versiones))];
  assert.equal(distintos.length, 1,
    'las versiones divergieron: ' + JSON.stringify(versiones, null, 2));
});
