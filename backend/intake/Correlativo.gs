/**
 * Correlativo.gs — generacion del numero de solicitud (C-12, §5.4).
 *
 * Formato SOL-[AÑO]-[EMPRESA]-[NNNN]. Fuente unica: hoja COUNTERS, keyed por
 * (empresa_id, anio). LockService serializa lectura+incremento+escritura
 * para que dos solicitudes simultaneas de la misma empresa no reciban el
 * mismo numero (RN-003: el numero es inmutable y unico).
 *
 * §12.4 (v2.0, Sprint 4, blindaje de la abstraccion de datos): este
 * archivo ya NO toca SpreadsheetApp/getRange/appendRow directamente --
 * ese acceso vive en SheetsRepo.gs (incrementarContadorCorrelativo_), que
 * es la unica capa autorizada a hablar con Sheets. Aqui solo se coordina
 * el lock (una preocupacion de concurrencia, no de persistencia) y el
 * formato final del numero.
 */

function generarId_(empresaId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var anio = new Date().getFullYear();
    var nuevoNumero = incrementarContadorCorrelativo_(empresaId, anio);
    var numeroFormateado = ('0000' + nuevoNumero).slice(-4);
    return 'SOL-' + anio + '-' + empresaId + '-' + numeroFormateado;
  } finally {
    lock.releaseLock();
  }
}
