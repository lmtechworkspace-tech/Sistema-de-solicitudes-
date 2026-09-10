/**
 * Perf.gs — medición de dónde se va el tiempo de cada request, en PRODUCCIÓN.
 *
 * POR QUE EXISTE. "SIGSO va lento" tiene dos causas que se arreglan distinto:
 *
 *   A) Acceso al dato. Cada getRange().getValues() / openById() es un viaje
 *      real a Sheets (~50-200 ms). Si aquí se va el grueso, una base de datos
 *      de verdad (Firestore/SQLite) ayudaría.
 *   B) Cola de ejecución. La implementación "por token" corre como UNA sola
 *      cuenta de Google, y Apps Script serializa las ejecuciones de una misma
 *      cuenta. Con varias personas a la vez, la que queda atrás espera en
 *      cola. Cambiar de base de datos NO toca esto.
 *
 * No se puede decidir una migración de ~38.000 líneas por intuición. Esto
 * mide, en cada respuesta real, cuánto fue trabajo del servidor y cuánto de
 * ese trabajo fue I/O a Sheets. El frontend (api.js) resta eso del round-trip
 * total: lo que sobra es red + cola + arranque en frío. Si ese sobrante
 * crece con la concurrencia -> es la cola (causa B).
 *
 * COSTE. Unas pocas llamadas a Date.now() y ~5 enteros extra en el JSON de
 * respuesta (~60 bytes). El frontend no los mira para pintar nada. Cero
 * escrituras nuevas, cero triggers nuevos. Quitar la medición = borrar este
 * archivo y tres líneas en Code.gs + los envoltorios de SheetsRepo.gs.
 *
 * AISLAMIENTO CON LOS TESTS. El snapshot solo se arma si perfMarcarInicio_()
 * corrió antes -- y eso solo pasa en doPost / ejecutarAccionBackoffice, los
 * puntos de entrada reales. Los tests que llaman a un handler directo no lo
 * disparan, así que su respuesta no lleva `_timing`. Los que van por doPost sí
 * lo llevan; ningún test compara la forma exacta de la respuesta (todos son
 * campo a campo), así que no rompe nada.
 */

var _perfT0_ = 0;
var _perfIoMs_ = 0;
var _perfIoOps_ = 0;
var _perfIoLecturas_ = 0;
var _perfIoEscrituras_ = 0;

/**
 * Marca el inicio de una request y pone los contadores a cero. Cada ejecución
 * de Apps Script arranca con un contexto JS nuevo, así que estas variables
 * nunca sobreviven a la request; el reset explícito es solo para el caso de
 * los tests, que reusan el mismo proceso entre un doPost y otro.
 */
function perfMarcarInicio_() {
  _perfT0_ = Date.now();
  _perfIoMs_ = 0;
  _perfIoOps_ = 0;
  _perfIoLecturas_ = 0;
  _perfIoEscrituras_ = 0;
}

/**
 * Envuelve UNA operación de I/O a Sheets y le suma el tiempo al acumulador.
 * `tipo` es 'lectura' o 'escritura'. Devuelve lo que devuelva `fn`.
 *
 * Se llama solo desde SheetsRepo.gs, en los 5 sitios donde de verdad hay un
 * viaje a Sheets (abrir el libro, leer un rango, y las tres formas de
 * escribir). El cache de ejecución (_cacheHojas_) hace que la mayoría de las
 * llamadas a leerFilas_ NO lleguen aquí -- que es justo lo que se quiere
 * medir: el I/O real, no los aciertos de cache.
 */
function perfMedirIO_(tipo, fn) {
  if (!_perfT0_) return fn(); // fuera de una request instrumentada: sin coste
  var t = Date.now();
  try {
    return fn();
  } finally {
    _perfIoMs_ += (Date.now() - t);
    _perfIoOps_ += 1;
    if (tipo === 'escritura') _perfIoEscrituras_ += 1;
    else _perfIoLecturas_ += 1;
  }
}

/**
 * El resumen que se pega en la respuesta, o null si esta request no viene de
 * un punto de entrada real (tests que llaman handlers directos).
 *
 *   server_ms     entrada a doPost -> justo antes de serializar la respuesta
 *   io_ms         de ese server_ms, cuánto fue viajes a Sheets
 *   io_ops        cuántos viajes (lecturas + escrituras)
 *   io_lecturas   de esos, cuántos fueron lectura
 *   io_escrituras y cuántos escritura
 *
 * El frontend calcula: overhead = round_trip_real - server_ms. Ese overhead
 * es red + cola + dispatch. Comparando overhead contra la hora del día y la
 * cantidad de llamadas simultáneas se ve si la cola es el problema.
 */
function perfSnapshot_() {
  if (!_perfT0_) return null;
  return {
    server_ms: Date.now() - _perfT0_,
    io_ms: _perfIoMs_,
    io_ops: _perfIoOps_,
    io_lecturas: _perfIoLecturas_,
    io_escrituras: _perfIoEscrituras_
  };
}
