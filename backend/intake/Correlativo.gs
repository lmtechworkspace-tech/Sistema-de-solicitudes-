/**
 * Correlativo.gs — generacion del numero de solicitud (C-12, §5.4).
 *
 * Formato SOL-[AÑO]-[EMPRESA]-[NNNN]. Fuente unica: hoja COUNTERS, keyed por
 * (empresa_id, anio). LockService serializa lectura+incremento+escritura
 * para que dos solicitudes simultaneas de la misma empresa no reciban el
 * mismo numero (RN-003: el numero es inmutable y unico).
 */

function generarId_(empresaId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var anio = new Date().getFullYear();
    var hoja = obtenerHoja_(SHEETS.COUNTERS);
    var columnas = COLUMNAS.COUNTERS;
    var ultimaFila = hoja.getLastRow();
    var filaEncontrada = -1;
    var ultimoNumero = 0;

    if (ultimaFila >= 2) {
      var valores = hoja.getRange(2, 1, ultimaFila - 1, columnas.length).getValues();
      for (var i = 0; i < valores.length; i++) {
        if (String(valores[i][0]) === String(empresaId) && Number(valores[i][1]) === anio) {
          filaEncontrada = i + 2; // +1 por header, +1 por indice base-1
          ultimoNumero = Number(valores[i][2]) || 0;
          break;
        }
      }
    }

    var nuevoNumero = ultimoNumero + 1;
    if (filaEncontrada === -1) {
      hoja.appendRow([empresaId, anio, nuevoNumero]);
    } else {
      hoja.getRange(filaEncontrada, 3, 1, 1).setValue(nuevoNumero);
    }

    var numeroFormateado = ('0000' + nuevoNumero).slice(-4);
    return 'SOL-' + anio + '-' + empresaId + '-' + numeroFormateado;
  } finally {
    lock.releaseLock();
  }
}
