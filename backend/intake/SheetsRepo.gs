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
