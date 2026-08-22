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

// v7.4b: para agregarFila_/agregarFilas_ -- un simple append NUNCA cambia
// los encabezados existentes, asi que en vez de invalidar todo el cache (lo
// que forzaria una relectura de la hoja en la SIGUIENTE escritura al mismo
// destino -- costoso en un bucle que escribe muchas filas seguidas, p.ej.
// LOG_NOTIFICACIONES una vez por correo), el cache se RECONSTRUYE con datos
// que ya tenemos en memoria (encabezados + lo que habia + lo que se acaba
// de escribir) -- SIN releer la hoja. Reconstruye en vez de "extender
// condicionalmente" a proposito: en los tests, el arnes de gasSandbox
// instrumenta appendRow para invalidar el cache en cualquier escritura
// directa al mock (necesario para que seedSheet no deje datos viejos, ver
// gasSandbox.js), asi que el cache puede haber quedado vacio ENTRE que se
// leyo `datos` y este punto -- reconstruir siempre deja un cache correcto
// sin importar que paso mientras tanto, y en Apps Script real (sin ese
// arnes) el resultado es identico.
function fijarCacheHoja_(nombreHoja, hoja, encabezados, valoresPrevios, filasNuevas) {
  _cacheHojas_[nombreHoja] = { hoja: hoja, encabezados: encabezados, valores: valoresPrevios.concat(filasNuevas) };
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
    // v7.4b: antes, una hoja con SOLO el encabezado (sin filas de datos
    // aun, ultimaFila===1) se trataba igual que una hoja realmente vacia
    // (encabezados: []) -- inofensivo para leerFilas_ (0 filas de todos
    // modos), pero agregarFila_/agregarFilas_ SI necesitan el encabezado
    // real para escribir alineado desde la primera fila de datos. Ahora
    // solo se considera "sin encabezado" cuando la hoja no tiene ni
    // siquiera una columna (ultimaCol < 1).
    cacheado = (ultimaCol < 1)
      ? { hoja: hoja, encabezados: [], valores: [] }
      : (function () {
          var valores = hoja.getRange(1, 1, Math.max(ultimaFila, 1), ultimaCol).getValues();
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

// v7.4b (hallazgo real, Novedades v6.7/v6.8): antes se escribia por
// POSICION segun COLUMNAS[nombreHoja] (el esquema del CODIGO), asumiendo
// que coincide exactamente con el orden fisico de columnas de la hoja. Si
// una fase agrega un campo nuevo al esquema pero la hoja de una instalacion
// existente nunca actualiza su fila de encabezados (el Instalador solo crea
// hojas NUEVAS, no sincroniza las que ya existen), appendRow sigue
// escribiendo el mismo ANCHO de columnas nuevo bajo encabezados viejos --
// cada valor queda UNA columna corrido respecto de lo que su encabezado
// dice, y el ultimo campo del esquema (activa, en el caso real que motivo
// esto) queda invisible para las lecturas (que si son por NOMBRE de
// encabezado). El sintoma: se "publica" bien, pero nunca aparece en el feed.
//
// Ahora se escribe por el mismo criterio que ya usan las lecturas y
// actualizarFilaPorId_ (reescribirFila_): segun los encabezados REALES de
// la hoja. Si un campo del esquema no tiene encabezado todavia, su valor
// simplemente NO se escribe (en vez de correr y corromper las columnas
// siguientes) -- una hoja desincronizada pierde ESE campo puntual, pero
// nunca desalinea el resto.
function agregarFila_(nombreHoja, objetoFila) {
  var datos = leerHojaConEncabezados_(nombreHoja); // pasa por el cache de ejecucion (v6.9)
  var encabezados = datos.encabezados;
  var columnas = encabezados.length ? encabezados : COLUMNAS[nombreHoja];
  var fila = columnas.map(function (col) {
    return (col && objetoFila[col] !== undefined) ? objetoFila[col] : '';
  });
  datos.hoja.appendRow(fila);
  fijarCacheHoja_(nombreHoja, datos.hoja, datos.encabezados, datos.valores, [fila]); // v7.4b: sin releer
  return objetoFila;
}

function leerFilas_(nombreHoja) {
  return leerHojaConEncabezados_(nombreHoja).filas;
}

// v7.1 (notificaciones vivas): escritura por LOTE -- una sola llamada a
// Sheets (getRange().setValues()) en vez de N appendRow. Un evento de pausa
// para toda la empresa encola una notificacion por trabajador; con appendRow
// eso eran 40-80 round-trips a Sheets dentro del trigger. Mismo contrato que
// agregarFila_ (mapea por COLUMNAS[nombreHoja], default '' para lo ausente).
function agregarFilas_(nombreHoja, objetosFila) {
  if (!objetosFila || !objetosFila.length) return objetosFila;
  var datos = leerHojaConEncabezados_(nombreHoja); // pasa por el cache de ejecucion (v6.9)
  var encabezados = datos.encabezados;
  var columnas = encabezados.length ? encabezados : COLUMNAS[nombreHoja];
  var matriz = objetosFila.map(function (obj) {
    return columnas.map(function (col) {
      return (col && obj[col] !== undefined) ? obj[col] : '';
    });
  });
  datos.hoja.getRange(datos.hoja.getLastRow() + 1, 1, matriz.length, columnas.length).setValues(matriz);
  fijarCacheHoja_(nombreHoja, datos.hoja, datos.encabezados, datos.valores, matriz); // v7.4b: sin releer
  return objetosFila;
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

/**
 * Compara la planilla REAL contra el esquema que espera el codigo
 * (COLUMNAS) y devuelve lo que falta.
 *
 * POR QUE EXISTE. Cada version que agrega una columna deja la planilla en
 * produccion con el encabezado viejo hasta que alguien corre
 * actualizarEsquema en el proyecto Setup. Cuando eso no pasa, los datos que
 * se peguen entran CORRIDOS de columna y el sintoma aparece lejos de la
 * causa: pantallas vacias, sin ningun error. Ya ocurrio una vez.
 *
 * No arregla nada -- solo mira. El arreglo sigue siendo actualizarEsquema,
 * que es quien tiene permiso para tocar la estructura.
 *
 * Es una operacion cara (una lectura por hoja), asi que se llama a demanda
 * desde Administracion, nunca en el camino de una peticion normal.
 */
function diagnosticarEsquema_() {
  var faltanHojas = [];
  var faltanColumnas = [];

  Object.keys(COLUMNAS).forEach(function (nombre) {
    var esperadas = COLUMNAS[nombre];
    var reales;
    try {
      reales = leerHojaConEncabezados_(nombre).encabezados || [];
    } catch (err) {
      faltanHojas.push(nombre);
      return;
    }
    // Una hoja existente pero sin encabezado cuenta como ausente: no se
    // puede escribir en ella de forma alineada.
    if (!reales.join('')) {
      faltanHojas.push(nombre);
      return;
    }
    var ausentes = esperadas.filter(function (col) { return reales.indexOf(col) === -1; });
    if (ausentes.length) {
      faltanColumnas.push({ hoja: nombre, columnas: ausentes });
    }
  });

  return {
    al_dia: faltanHojas.length === 0 && faltanColumnas.length === 0,
    hojas_faltantes: faltanHojas,
    columnas_faltantes: faltanColumnas,
    // Lo que hay que hacer si algo falta, dicho una sola vez y en un solo
    // lugar: la pantalla no tiene que saberlo.
    accion: (faltanHojas.length || faltanColumnas.length)
      ? 'Ejecuta actualizarEsquema en el proyecto SETUP de Apps Script.'
      : ''
  };
}
