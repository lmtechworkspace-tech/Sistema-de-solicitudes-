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
 * Rendimiento: el spreadsheet se abre UNA vez por ejecucion (memo de modulo),
 * y ADEMAS cada hoja se lee una sola vez por ejecucion (_cacheHojas_, v6.9).
 */

var _spreadsheetMemo_ = null;

// v6.9 (rendimiento): cache de lectura POR EJECUCION. En Apps Script cada
// getRange().getValues() es un round-trip real (~50-200 ms); el patron
// "leerFilas_ dentro de un bucle" (que existia en varios modulos) hacia
// cientos de round-trips por request. Aqui se guarda el bloque crudo de
// valores por hoja y se sirve de memoria mientras dure la ejecucion.
//
// POR QUE ES SEGURO: cada ejecucion de Apps Script arranca con un contexto
// JS nuevo, asi que este cache nunca sobrevive a la request (no puede
// servir datos de otro usuario ni quedar "viejo" entre llamadas). Dentro de
// la ejecucion, TODA escritura invalida la hoja tocada -- y en el Backoffice
// no existe ninguna escritura fuera de este archivo (verificado), asi que la
// invalidacion no tiene agujeros.
//
// Se cachea `valores` (el I/O caro) y NO los objetos de fila: `filas` se
// re-arma en cada llamada. Es CPU barata y evita que un modulo que mute una
// fila leida contamine lo que ven los demas.
var _cacheHojas_ = {};

/**
 * Descarta lo cacheado de una hoja (o de todas, sin argumento). Se llama
 * sola en cada escritura; es publica para casos que necesiten forzar una
 * lectura fresca -- ver incrementarContadorCorrelativo_ (Intake).
 */
function invalidarCacheHoja_(nombreHoja) {
  if (nombreHoja) {
    delete _cacheHojas_[nombreHoja];
  } else {
    _cacheHojas_ = {};
  }
}

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
  var cacheado = _cacheHojas_[nombreHoja];
  if (!cacheado) {
    var hoja = obtenerHoja_(nombreHoja);
    var ultimaFila = hoja.getLastRow();
    var ultimaCol = hoja.getLastColumn();
    cacheado = (ultimaFila < 2 || ultimaCol < 1)
      ? { hoja: hoja, encabezados: [], valores: [] }
      : (function () {
          var valores = hoja.getRange(1, 1, ultimaFila, ultimaCol).getValues();
          return {
            hoja: hoja,
            encabezados: valores[0].map(function (h) { return String(h).trim(); }),
            valores: valores
          };
        })();
    _cacheHojas_[nombreHoja] = cacheado;
  }

  // `filas` se re-arma siempre (objetos nuevos por llamada): asi ningun
  // modulo puede contaminar a otro mutando una fila leida.
  var columnasEsquema = COLUMNAS[nombreHoja] || [];
  var filas = cacheado.valores.slice(1).map(function (fila) {
    return mapearFila_(fila, cacheado.encabezados, columnasEsquema);
  });
  return {
    hoja: cacheado.hoja,
    encabezados: cacheado.encabezados,
    valores: cacheado.valores,
    filas: filas
  };
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
  invalidarCacheHoja_(nombreHoja); // v6.9: la hoja cambio, el cache ya no sirve
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
  invalidarCacheHoja_(datos.hoja.getName()); // v6.9
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
  if (borradas) invalidarCacheHoja_(nombreHoja); // v6.9
  return borradas;
}
