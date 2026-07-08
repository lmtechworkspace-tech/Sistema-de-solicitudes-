/**
 * SheetsRepo.gs — acceso de bajo nivel a las hojas de Google Sheets.
 *
 * Mapea entre arrays de columnas (COLUMNAS en Constantes.gs) y objetos JS,
 * para que el resto del backend (Solicitudes.gs, Catalogos.gs, etc.) no
 * conozca posiciones de columna. La fila 1 de cada hoja son los headers,
 * escritos por el instalador (backend/setup/Instalador.gs).
 */

function obtenerHoja_(nombreHoja) {
  var ss = SpreadsheetApp.openById(getConfig_().sheetId);
  var hoja = ss.getSheetByName(nombreHoja);
  if (!hoja) {
    throw new Error(
      'Hoja no encontrada: ' + nombreHoja + '. Ejecuta el instalador (backend/setup) primero.'
    );
  }
  return hoja;
}

function agregarFila_(nombreHoja, objetoFila) {
  var hoja = obtenerHoja_(nombreHoja);
  var columnas = COLUMNAS[nombreHoja];
  var fila = columnas.map(function (col) {
    return objetoFila[col] !== undefined ? objetoFila[col] : '';
  });
  hoja.appendRow(fila);
  return objetoFila;
}

function leerFilas_(nombreHoja) {
  var hoja = obtenerHoja_(nombreHoja);
  var columnas = COLUMNAS[nombreHoja];
  var ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) {
    return [];
  }
  var valores = hoja.getRange(2, 1, ultimaFila - 1, columnas.length).getValues();
  return valores.map(function (fila) {
    var obj = {};
    columnas.forEach(function (col, idx) {
      obj[col] = fila[idx];
    });
    return obj;
  });
}

// Duplicado de backend/backoffice/SheetsRepo.gs (RN-201, Sprint 1 v2.0):
// Solicitudes.validarCierre es la primera funcion de Intake que necesita
// ACTUALIZAR una fila existente en vez de solo agregar/leer.
function actualizarFilaPorId_(nombreHoja, columnaId, valorId, cambios) {
  var hoja = obtenerHoja_(nombreHoja);
  var columnas = COLUMNAS[nombreHoja];
  var indiceColumnaId = columnas.indexOf(columnaId);
  var ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) {
    return null;
  }

  var rango = hoja.getRange(2, 1, ultimaFila - 1, columnas.length);
  var valores = rango.getValues();

  for (var i = 0; i < valores.length; i++) {
    if (String(valores[i][indiceColumnaId]) === String(valorId)) {
      var objetoActual = {};
      columnas.forEach(function (col, idx) {
        objetoActual[col] = valores[i][idx];
      });
      var objetoActualizado = Object.assign({}, objetoActual, cambios);
      var filaActualizada = columnas.map(function (col) {
        return objetoActualizado[col] !== undefined ? objetoActualizado[col] : '';
      });
      hoja.getRange(i + 2, 1, 1, columnas.length).setValues([filaActualizada]);
      return objetoActualizado;
    }
  }

  return null;
}
