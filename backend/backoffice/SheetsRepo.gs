/**
 * SheetsRepo.gs — acceso de bajo nivel a las hojas de Google Sheets.
 * Duplicado deliberado de backend/intake/SheetsRepo.gs (ver nota en
 * Config.gs). Agrega actualizarFilaPorId_, que Intake tambien tiene (Sprint 1).
 *
 * Lectura POR NOMBRE de encabezado (no por posicion): tolera columnas extra,
 * en distinto orden, o que falte alguna respecto del esquema del codigo. Ver
 * la nota identica en backend/intake/SheetsRepo.gs. Antes se leia un ancho
 * fijo (COLUMNAS.length) por posicion, y cualquier desalineacion entre el
 * codigo desplegado y la hoja rompia la lectura (getRange fuera de rango) o
 * desalineaba los datos.
 *
 * Rendimiento: el spreadsheet se abre UNA vez por ejecucion (memo de modulo).
 */

var _spreadsheetMemo_ = null;

function obtenerSpreadsheet_() {
  if (!_spreadsheetMemo_) {
    _spreadsheetMemo_ = SpreadsheetApp.openById(getConfig_().sheetId);
  }
  return _spreadsheetMemo_;
}

function obtenerHoja_(nombreHoja) {
  var hoja = obtenerSpreadsheet_().getSheetByName(nombreHoja);
  if (!hoja) {
    throw new Error(
      'Hoja no encontrada: ' + nombreHoja + '. Ejecuta el instalador (backend/setup) primero.'
    );
  }
  return hoja;
}

function leerHojaConEncabezados_(nombreHoja) {
  var hoja = obtenerHoja_(nombreHoja);
  var ultimaFila = hoja.getLastRow();
  var ultimaCol = hoja.getLastColumn();
  if (ultimaFila < 2 || ultimaCol < 1) {
    return { hoja: hoja, encabezados: [], valores: [], filas: [] };
  }
  var valores = hoja.getRange(1, 1, ultimaFila, ultimaCol).getValues();
  var encabezados = valores[0].map(function (h) { return String(h).trim(); });
  var columnasEsquema = COLUMNAS[nombreHoja] || [];
  var filas = valores.slice(1).map(function (fila) {
    return mapearFila_(fila, encabezados, columnasEsquema);
  });
  return { hoja: hoja, encabezados: encabezados, valores: valores, filas: filas };
}

// Garantiza que toda columna del esquema exista (default '') aunque la hoja
// aun no la tenga -- preserva el contrato previo (nunca undefined en columna
// conocida).
function mapearFila_(fila, encabezados, columnasEsquema) {
  var obj = {};
  columnasEsquema.forEach(function (col) { obj[col] = ''; });
  encabezados.forEach(function (col, idx) {
    if (col) { obj[col] = fila[idx]; }
  });
  return obj;
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
  return leerHojaConEncabezados_(nombreHoja).filas;
}

// Reescribe una fila conservando las columnas que el codigo no conoce (el
// ancho real de la hoja): solo pisa las celdas cuyo encabezado esta en
// `objetoActualizado`. Devuelve el objeto actualizado, o null si no existe.
function reescribirFila_(datos, indiceFilaValores, cambios) {
  var filaActual = datos.valores[indiceFilaValores];
  var objetoActual = mapearFila_(filaActual, datos.encabezados, []);
  var objetoActualizado = Object.assign({}, objetoActual, cambios);
  var filaNueva = datos.encabezados.map(function (col, idx) {
    return (col && objetoActualizado[col] !== undefined) ? objetoActualizado[col] : filaActual[idx];
  });
  datos.hoja.getRange(indiceFilaValores + 1, 1, 1, datos.encabezados.length).setValues([filaNueva]);
  return objetoActualizado;
}

/**
 * Busca por columna id, aplica los cambios de `cambios` sobre esa fila y la
 * reescribe (por nombre de encabezado). Devuelve el objeto actualizado, o
 * null si no existe.
 */
function actualizarFilaPorId_(nombreHoja, columnaId, valorId, cambios) {
  var datos = leerHojaConEncabezados_(nombreHoja);
  var idxCol = datos.encabezados.indexOf(columnaId);
  if (idxCol === -1) {
    return null;
  }
  for (var i = 1; i < datos.valores.length; i++) {
    if (String(datos.valores[i][idxCol]) === String(valorId)) {
      return reescribirFila_(datos, i, cambios);
    }
  }
  return null;
}

// v4.0 Frente 5: borra TODAS las filas cuyo valor de columnaId coincida
// (no solo la primera) -- lo usa CuentasPortal.eliminar para la cuenta en
// CUENTAS_PORTAL y, de paso, cualquier sesion viva de esa cuenta en
// SESIONES_PORTAL (una cuenta eliminada no debe seguir operando con el
// token que ya tenia en el navegador). Borra de abajo hacia arriba para
// que eliminar una fila no corra los indices de las que faltan.
function eliminarFilasPorId_(nombreHoja, columnaId, valorId) {
  var datos = leerHojaConEncabezados_(nombreHoja);
  var idxCol = datos.encabezados.indexOf(columnaId);
  if (idxCol === -1) return 0;
  var borradas = 0;
  for (var i = datos.valores.length - 1; i >= 1; i--) {
    if (String(datos.valores[i][idxCol]) === String(valorId)) {
      datos.hoja.deleteRow(i + 1);
      borradas++;
    }
  }
  return borradas;
}
