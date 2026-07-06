/**
 * utils.js — helpers compartidos entre paginas (§2.4). Las etiquetas deben
 * coincidir con la tabla de estados de la especificacion (§8.1).
 */
var SIGSO_ESTADOS_LABEL = {
  S01: 'Nueva', S02: 'Recibida', S03: 'En revisión', S04: 'Aprobada',
  S05: 'En desarrollo', S06: 'Esperando información', S07: 'En pruebas',
  S08: 'Terminada', S09: 'Cerrada', S10: 'Rechazada', S11: 'Cancelada'
};

function formatearEstadoSigso(codigo) {
  return SIGSO_ESTADOS_LABEL[codigo] || codigo;
}
