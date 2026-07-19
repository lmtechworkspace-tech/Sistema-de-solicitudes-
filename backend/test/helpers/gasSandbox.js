'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createGasGlobals } = require('../mocks/gas-globals');

/**
 * Carga uno o mas archivos .gs en un contexto vm con los globals de Apps
 * Script simulados, y devuelve ese contexto (con doPost/doGet/etc. definidos
 * como funciones globales, tal como los ve Apps Script en produccion).
 *
 * @param {string[]} filePaths rutas absolutas de los .gs a cargar, en orden
 * @param {object} [options] ver createGasGlobals()
 */
function loadGasProject(filePaths, options) {
  const globals = createGasGlobals(options);
  const context = Object.assign({}, globals);
  vm.createContext(context);
  for (const filePath of filePaths) {
    const code = fs.readFileSync(filePath, 'utf8');
    vm.runInContext(code, context, { filename: filePath });
  }
  return context;
}

/**
 * Crea (o reutiliza) una hoja dentro del SpreadsheetApp mock de un contexto
 * ya cargado, escribe la fila de headers y opcionalmente filas de datos.
 * Util para dejar el "estado inicial" de Sheets que un test necesita sin
 * pasar por el instalador real.
 */
function seedSheet(ctx, sheetName, headers, rows) {
  const ss = ctx.SpreadsheetApp.openById('fake-sheet-id');
  const sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  sheet.appendRow(headers);
  (rows || []).forEach((row) => sheet.appendRow(row));
  return sheet;
}

// Orden de carga: cada archivo puede depender de globals definidos por el
// anterior (Constantes antes de SheetsRepo, SheetsRepo antes de Correlativo
// y Solicitudes, etc.), igual que Apps Script concatena todos los .gs de un
// proyecto en un unico scope global.
const INTAKE_FILES_EN_ORDEN = [
  'Config.gs',
  'Constantes.gs',
  'SheetsRepo.gs',
  'Correlativo.gs',
  'Utils.gs',
  'Cumplimiento.gs',
  'Notificaciones.gs',
  'Solicitudes.gs',
  'Catalogos.gs',
  'DriveRepo.gs',
  'Drive.gs',
  // v3.3: identidad de la plataforma (login/sesiones).
  'Portal.gs',
  'Code.gs'
];

function loadIntakeProject(options) {
  const dir = path.join(__dirname, '..', '..', 'intake');
  return loadGasProject(INTAKE_FILES_EN_ORDEN.map((f) => path.join(dir, f)), options);
}

const BACKOFFICE_FILES_EN_ORDEN = [
  'Config.gs',
  'Constantes.gs',
  'SheetsRepo.gs',
  'Utils.gs',
  'Cumplimiento.gs',
  'DriveRepo.gs',
  'Notificaciones.gs',
  'Documentos.gs',
  'Solicitudes.gs',
  'Dashboard.gs',
  'Gerencia.gs',
  'Comentarios.gs',
  'Catalogos.gs',
  'Auth.gs',
  // v3.3: administracion de cuentas de la plataforma (solo ADM).
  'CuentasPortal.gs',
  'Triggers.gs',
  'Code.gs'
];

function loadBackofficeProject(options) {
  const dir = path.join(__dirname, '..', '..', 'backoffice');
  const opts = Object.assign({ htmlDir: dir }, options);
  return loadGasProject(BACKOFFICE_FILES_EN_ORDEN.map((f) => path.join(dir, f)), opts);
}

/**
 * Los objetos/arrays creados por codigo ejecutado dentro de un contexto vm
 * pertenecen a un "realm" distinto del de Node: assert.deepStrictEqual los
 * considera diferentes aunque el contenido sea identico (distinto
 * Array.prototype/Object.prototype). Esta funcion los normaliza a
 * estructuras del realm de Node para poder compararlos con assert/strict.
 * Solo sirve para datos planos (strings, numeros, arrays, objetos), que es
 * todo lo que este proyecto mueve entre vm y Node.
 */
function toPlain(valor) {
  return JSON.parse(JSON.stringify(valor));
}

module.exports = { loadGasProject, seedSheet, loadIntakeProject, loadBackofficeProject, toPlain };
