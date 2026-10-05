/**
 * utils.js — helpers compartidos entre paginas (§2.4). Las etiquetas deben
 * coincidir con la tabla de estados de la especificacion (§8.1).
 */
var SIGSO_ESTADOS_LABEL = {
  S01: 'Nueva', S02: 'Recibida', S03: 'En revisión', S04: 'Aprobada',
  S05: 'En curso', S06: 'Esperando respuesta', S07: 'En pruebas',
  S08: 'Resuelta', S09: 'Cerrada', S10: 'Rechazada', S11: 'Cancelada'
};

function formatearEstadoSigso(codigo) {
  return SIGSO_ESTADOS_LABEL[codigo] || codigo;
}

// Solicitudes, etapa 3 (2026-10-05): lo que ven las personas son CINCO
// estados (más Rechazada y Cancelada); los 11 códigos siguen por dentro.
// "Recibida", "En revisión", "Aprobada" y "En pruebas" son detalle de
// En curso, que solo muestra Desarrollo / TI. Mismo criterio que
// backend/logica/constantesSolicitudes.js (ESTADO_VISIBLE).
var SIGSO_ESTADO_VISIBLE = {
  S01: 'NUEVA', S02: 'EN_CURSO', S03: 'EN_CURSO', S04: 'EN_CURSO', S05: 'EN_CURSO',
  S06: 'ESPERANDO', S07: 'EN_CURSO', S08: 'RESUELTA', S09: 'CERRADA', S10: 'RECHAZADA', S11: 'CANCELADA'
};
var SIGSO_ETIQUETA_VISIBLE = {
  NUEVA: 'Nueva', EN_CURSO: 'En curso', ESPERANDO: 'Esperando respuesta', RESUELTA: 'Resuelta',
  CERRADA: 'Cerrada', RECHAZADA: 'Rechazada', CANCELADA: 'Cancelada'
};
function estadoVisibleSigso(codigo) { return SIGSO_ESTADO_VISIBLE[codigo] || ''; }
function formatearEstadoVisibleSigso(codigo) {
  return SIGSO_ETIQUETA_VISIBLE[SIGSO_ESTADO_VISIBLE[codigo]] || formatearEstadoSigso(codigo);
}
