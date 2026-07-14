/**
 * SheetsRepo.gs — acceso de bajo nivel a las hojas de Google Sheets.
 *
 * Mapea entre los headers REALES de cada hoja (fila 1) y objetos JS, para que
 * el resto del backend no conozca posiciones de columna. La lectura es POR
 * NOMBRE de encabezado (no por posicion): tolera que la hoja tenga columnas
 * extra, en distinto orden, o que le falte alguna respecto del esquema del
 * codigo. Antes se leia un ancho fijo (COLUMNAS.length) por posicion, y
 * cualquier desalineacion entre el codigo desplegado y la hoja rompia la
 * lectura (getRange fuera de rango -> excepcion) o desalineaba los datos.
 *
 * Rendimiento: SpreadsheetApp.openById es una de las operaciones mas lentas
 * de Apps Script. Se abre UNA sola vez por ejecucion (memo en variable de
 * modulo, que Apps Script reinicia en cada doPost) en vez de en cada lectura.
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

// Lee la hoja completa una sola vez y devuelve todo lo que las demas
// funciones necesitan: la hoja, los encabezados reales (trim), la matriz de
// valores (incluye la fila de headers) y las filas ya mapeadas a objetos por
// nombre de encabezado. Evita releer/remapear en cada helper.
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
// aun no la tenga -- preserva el contrato previo (los consumidores nunca
// reciben undefined en una columna conocida).
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
  // indiceFilaValores 0 es el header; la fila de datos i-esima esta en la
  // fila (i+1) de la hoja (1-indexed).
  datos.hoja.getRange(indiceFilaValores + 1, 1, 1, datos.encabezados.length).setValues([filaNueva]);
  return objetoActualizado;
}

// Duplicado de backend/backoffice/SheetsRepo.gs (RN-201, Sprint 1 v2.0):
// Solicitudes.validarCierre es la primera funcion de Intake que necesita
// ACTUALIZAR una fila existente en vez de solo agregar/leer.
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

// §12.4 (v2.0, Sprint 4, blindaje de la abstraccion de datos): generaliza
// actualizarFilaPorId_ para hojas que se identifican por una CLAVE
// COMPUESTA (p.ej. COUNTERS, keyed por empresa_id+anio, no por una sola
// columna) -- ver la nota en incrementarContadorCorrelativo_ mas abajo.
function actualizarFilaPorFiltro_(nombreHoja, predicado, cambios) {
  var datos = leerHojaConEncabezados_(nombreHoja);
  for (var i = 1; i < datos.valores.length; i++) {
    if (predicado(datos.filas[i - 1])) {
      return reescribirFila_(datos, i, cambios);
    }
  }
  return null;
}

// §12.4: la unica logica que antes tocaba Sheets directamente fuera de
// este archivo (Correlativo.gs, C-12/§5.4) vive ahora aqui -- Correlativo.gs
// solo coordina el LockService y el formato del numero (SOL-AAAA-EMPRESA-NNNN),
// sin llamar a SpreadsheetApp. Si algun dia se migra la persistencia (§11
// de la especificacion v2.0, Firestore), esta es la unica capa a reescribir.
function incrementarContadorCorrelativo_(empresaId, anio) {
  var actual = leerFilas_(SHEETS.COUNTERS).find(function (f) {
    return String(f.empresa_id) === String(empresaId) && Number(f.anio) === anio;
  });
  var nuevoNumero = (actual ? Number(actual.ultimo_numero) : 0) + 1;

  if (actual) {
    actualizarFilaPorFiltro_(SHEETS.COUNTERS, function (f) {
      return String(f.empresa_id) === String(empresaId) && Number(f.anio) === anio;
    }, { ultimo_numero: nuevoNumero });
  } else {
    agregarFila_(SHEETS.COUNTERS, { empresa_id: empresaId, anio: anio, ultimo_numero: nuevoNumero });
  }

  return nuevoNumero;
}
