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
