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

// v6.9 (rendimiento): cache de lectura POR EJECUCION -- ver la nota extensa
// en backend/backoffice/SheetsRepo.gs. Cada getRange().getValues() es un
// round-trip real; aqui cada hoja se lee una sola vez por ejecucion y toda
// escritura invalida la hoja tocada. El contexto JS de Apps Script es nuevo
// en cada ejecucion, asi que este cache nunca cruza requests.
var _cacheHojas_ = {};

/**
 * Descarta lo cacheado de una hoja (o de todas, sin argumento). Lo llama
 * sola cada escritura; ademas incrementarContadorCorrelativo_ la usa para
 * forzar lectura fresca dentro del lock (ver la nota ahi: el correlativo NO
 * puede leerse de cache, o dos solicitudes tomarian el mismo numero).
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

// Lee la hoja completa una sola vez y devuelve todo lo que las demas
// funciones necesitan: la hoja, los encabezados reales (trim), la matriz de
// valores (incluye la fila de headers) y las filas ya mapeadas a objetos por
// nombre de encabezado. Evita releer/remapear en cada helper.
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
  // indiceFilaValores 0 es el header; la fila de datos i-esima esta en la
  // fila (i+1) de la hoja (1-indexed).
  datos.hoja.getRange(indiceFilaValores + 1, 1, 1, datos.encabezados.length).setValues([filaNueva]);
  invalidarCacheHoja_(datos.hoja.getName()); // v6.9
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
  // v6.9 (CRITICO): el cache de lectura NO puede aplicar aqui. Esta funcion
  // corre dentro del LockService (ver Correlativo.gs) justamente para que
  // lectura+incremento+escritura sean atomicos: si el numero actual saliera
  // de un cache poblado ANTES de tomar el lock, dos solicitudes podrian
  // calcular el mismo correlativo y romper RN-003 (numero unico e inmutable).
  // Se fuerza la lectura fresca descartando el cache de COUNTERS.
  invalidarCacheHoja_(SHEETS.COUNTERS);
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
