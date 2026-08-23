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
  conectarInvalidacionDeCache_(context);
  return context;
}

/**
 * v6.9: SheetsRepo cachea cada hoja por ejecucion, e invalida ese cache en
 * toda escritura que pase por el repo. En PRODUCCION eso basta (no existe
 * ninguna escritura fuera del repo). Pero los TESTS si escriben directo en
 * el mock (seedSheet y varios helpers locales usan appendRow), y esa via no
 * pasa por el repo: sin este puente, un test que siembra filas DESPUES de
 * una lectura veria datos viejos.
 *
 * Se instrumenta el mock una sola vez aqui, en vez de tocar ~30 archivos de
 * test: cualquier mutacion directa invalida esa hoja, igual que haria el
 * repo. Modela la realidad ("la hoja cambio"), no la esconde.
 */
function conectarInvalidacionDeCache_(context) {
  const ss = context.SpreadsheetApp && context.SpreadsheetApp._spreadsheet;
  if (!ss) return;

  const invalidar = (nombre) => {
    // El proyecto Setup no carga SheetsRepo: ahi no hay cache que invalidar.
    if (typeof context.invalidarCacheHoja_ === 'function') context.invalidarCacheHoja_(nombre);
  };

  const instrumentar = (hoja, nombre) => {
    if (!hoja || hoja.__invalidaCache) return hoja;
    ['appendRow', 'deleteRow', 'deleteRows', 'clear', 'clearContents'].forEach((metodo) => {
      if (typeof hoja[metodo] !== 'function') return;
      const original = hoja[metodo].bind(hoja);
      hoja[metodo] = function () {
        const salida = original.apply(null, arguments);
        invalidar(nombre);
        return salida;
      };
    });
    const getRangeOriginal = hoja.getRange.bind(hoja);
    hoja.getRange = function () {
      const rango = getRangeOriginal.apply(null, arguments);
      if (rango && typeof rango.setValues === 'function') {
        const setValuesOriginal = rango.setValues.bind(rango);
        rango.setValues = function (valores) {
          const salida = setValuesOriginal(valores);
          invalidar(nombre);
          return salida;
        };
      }
      return rango;
    };
    hoja.__invalidaCache = true;
    return hoja;
  };

  ss.getSheets().forEach((hoja) => instrumentar(hoja, hoja.getName()));
  const insertarOriginal = ss.insertSheet.bind(ss);
  ss.insertSheet = (nombre) => instrumentar(insertarOriginal(nombre), nombre);
  const obtenerOriginal = ss.getSheetByName.bind(ss);
  ss.getSheetByName = (nombre) => instrumentar(obtenerOriginal(nombre), nombre);
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
  // v10.0 Fase 4 (PRO-07): formulario publico de quejas.
  'Quejas.gs',
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
  // v5.2 (mejora OT): genera la OT en PDF; usa Solicitudes.getDetalle y
  // DriveApp, asi que carga despues de Solicitudes.
  'OrdenTrabajo.gs',
  'Dashboard.gs',
  'Gerencia.gs',
  // v4.2: panel de Jefatura -- Solicitudes.gs (getDetalle) usa sus helpers
  // de equipo (esDelEquipoJefaturaSolicitud_) solo en tiempo de ejecucion,
  // asi que el orden de carga entre ambos no importa.
  'Jefatura.gs',
  // v6.0: modulo de Pausas Activas (Fase P0: config administrable por ADM).
  // Aditivo; no depende de otros modulos en tiempo de carga.
  'Pausas.gs',
  'Comentarios.gs',
  'Catalogos.gs',
  'Auth.gs',
  // v3.3: administracion de cuentas de la plataforma (solo ADM).
  'CuentasPortal.gs',
  // v6.4: foto de perfil (hoja PERFILES + originales privados en Drive).
  'Perfiles.gs',
  // v6.5: modulo Novedades (hojas NOVEDADES + NOVEDADES_LECTURAS).
  'Novedades.gs',
  // v7.0 (Fase 1): modulo de Gestion Operacional. Usa obtenerEquipoJefe_/
  // jefeDeSubordinado_ de Jefatura.gs (ya cargado) solo en tiempo de
  // ejecucion, asi que basta con cargar despues.
  'Actividades.gs',
  // v7.0 (Fase 5): PDF de los reportes/acta de reunion -- usa
  // Actividades.generarReporte/generarActaReunion (ya cargado) y
  // escaparHtml_/formatearFechaLegible_/fechaCortaOt_ de OrdenTrabajo.gs.
  'ReporteActividades.gs',
  // v9.0 (Modulo de Proyectos): capa contenedora sobre Actividades.gs (ya
  // cargado) -- crearTarea/listarTareas llaman Actividades.crear/
  // semaforoActividad_ solo en tiempo de ejecucion, asi que basta con
  // cargar despues. Usa tambien encolarNotificacionApp_ (Notificaciones.gs)
  // y obtenerFeriados_ (Dashboard.gs), ambos ya cargados arriba.
  'Proyectos.gs',
  // v10.0 (Modulo SGC ISO 9001, Fase 1): repositorio documental controlado.
  // Usa obtenerCarpetaCalidad_ (DriveRepo.gs) y agregarFila_/leerFilasSeguro_
  // (SheetsRepo.gs), ambos ya cargados arriba.
  'Calidad.gs',
  // v10.0 Fase 2a (PRO-02): ficha del trabajador. Usa helpers de Calidad.gs
  // (rolSgc_, gobiernaSgc_, subirArchivoSgc_...) y de Jefatura.gs
  // (obtenerEquipoJefe_, jefeDeSubordinado_), ambos ya cargados arriba.
  'Personas.gs',
  // v10.0 Fase 3a (PRO-06): no conformidades. Usa Actividades.crear y
  // semaforoActividad_ (Actividades.gs, ya cargado) para que la correccion
  // y la accion correctiva SEAN actividades de "Mi trabajo", y los helpers
  // de dia habil de Utils.gs.
  'NoConformidades.gs',
  'Auditorias.gs',
  // v10.0 Fase 4 (PRO-07): quejas. Usa NoConformidades.crear (ya cargado)
  // para el eslabon queja -> NC, y los mismos helpers de Calidad.gs.
  'Quejas.gs',
  // v10.0 Fase 5a (PRO-04): proveedores externos. Reutiliza los helpers de
  // Calidad.gs (roles/permisos) y encargadosSgc_ de Auditorias.gs.
  'Proveedores.gs',
  // v10.0 Fase 5b (PRO-05): usa crearTareaSgc_/tareaResumen_ de
  // NoConformidades.gs y los resumenes de proveedores, quejas y auditorias.
  'RevisionDireccion.gs',
  // v10.0 Fase 6a (DOC-07): objetivos de calidad. Usa
  // horasFormacionPorPersonaSgc_ de Personas.gs y encargadosSgc_ de
  // Auditorias.gs, asi que va despues de ambos.
  'Objetivos.gs',
  // v11.0 Fase 1 (§4.3): alcance y exclusiones. Va ANTES de
  // MatrizCobertura.gs porque esta lo consulta (alcanceVigente_,
  // exclusionesVigentesPorClausula_) para saber que se excluyo del alcance.
  'Alcance.gs',
  // v11.0 Fase 2 (§4.1/§4.2): contexto y partes interesadas. Va antes de
  // MatrizCobertura.gs por lo mismo que Alcance.gs: esta lo consulta.
  'Contexto.gs',
  // v11.0 Fase 3 (§6.1): riesgos y oportunidades. Usa crearTareaSgc_ y
  // tareaResumen_ de NoConformidades.gs, y factoresContextoActivos_ /
  // mesesDesde_ de Contexto.gs -- por eso va despues de ambos.
  'Riesgos.gs',
  // v11.0 Fase 4 (§4.4): procesos del SGC. Usa valorarRiesgo_ de
  // Riesgos.gs para mostrar los riesgos de cada proceso, y mesesDesde_
  // de Contexto.gs.
  'Procesos.gs',
  // v10.0 Fase 6b: matriz de cobertura ISO. Usa CLAUSULAS_ISO9001 de
  // Auditorias.gs y datos de casi todos los modulos SGC ya cargados.
  // v11.0 Fase 6 (§9.1.1): indicadores de proceso. Reutiliza de
  // Objetivos.gs los catalogos, periodosDelAnio_ y cumpleMeta_, y de
  // Procesos.gs el mapa -- por eso va despues de ambos.
  'Indicadores.gs',
  'MatrizCobertura.gs',
  // v11.0 Fase 7: el tablero del SGC. Va al final de los modulos del SGC
  // porque consulta a casi todos: MatrizCobertura, Alcance, Riesgos,
  // Procesos, Contexto e Indicadores.
  'Tablero.gs',
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
