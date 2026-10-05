'use strict';

/**
 * constantesSolicitudes.js — puerto de la parte de backend/intake/
 * Constantes.gs que usa la maquina de estados y prioridades. Compartido:
 * cualquier modulo futuro que toque Solicitudes (actualizarEstado, bandeja,
 * reportes) importa de aqui, igual que en Apps Script todo el proyecto
 * comparte el mismo Constantes.gs.
 */

const ESTADOS = {
  S01: 'S01', S02: 'S02', S03: 'S03', S04: 'S04', S05: 'S05',
  S06: 'S06', S07: 'S07', S08: 'S08', S09: 'S09', S10: 'S10', S11: 'S11'
};

const ESTADOS_CERRADOS = [ESTADOS.S09, ESTADOS.S10, ESTADOS.S11];

// Nombres de los estados para lo que sale del servidor (correos, avisos). Los
// mismos de frontend/js/utils.js (SIGSO_ESTADOS_LABEL): un correo nunca debe
// mostrar "S01". Etapa 3 (2026-10-05): S05/S06/S08 pasan a llamarse como lo
// que ven las personas (En curso, Esperando respuesta, Resuelta).
const ETIQUETA_ESTADO = {
  S01: 'Nueva', S02: 'Recibida', S03: 'En revisión', S04: 'Aprobada',
  S05: 'En curso', S06: 'Esperando respuesta', S07: 'En pruebas',
  S08: 'Resuelta', S09: 'Cerrada', S10: 'Rechazada', S11: 'Cancelada'
};

// Etapa 3 (decisión del dueño 2026-10-05): las personas ven CINCO estados
// (más Rechazada y Cancelada); los 11 códigos siguen por dentro, así que el
// historial y los reportes no cambian. "Recibida", "En revisión", "Aprobada"
// y "En pruebas" son detalle de En curso (lo usa Desarrollo / TI).
const ESTADO_VISIBLE = {
  S01: 'NUEVA', S02: 'EN_CURSO', S03: 'EN_CURSO', S04: 'EN_CURSO', S05: 'EN_CURSO',
  S06: 'ESPERANDO', S07: 'EN_CURSO', S08: 'RESUELTA', S09: 'CERRADA', S10: 'RECHAZADA', S11: 'CANCELADA'
};
const ETIQUETA_VISIBLE = {
  NUEVA: 'Nueva', EN_CURSO: 'En curso', ESPERANDO: 'Esperando respuesta', RESUELTA: 'Resuelta',
  CERRADA: 'Cerrada', RECHAZADA: 'Rechazada', CANCELADA: 'Cancelada'
};
function estadoVisible_(codigo) { return ESTADO_VISIBLE[codigo] || ''; }
function etiquetaVisible_(codigo) { return ETIQUETA_VISIBLE[ESTADO_VISIBLE[codigo]] || codigo || ''; }

// Backoffice (§8.2): estado_derivado del padre = el minimo (menos avanzado)
// entre subsolicitudes NO excluidas (S10/S11).
const ORDEN_ESTADOS = [
  ESTADOS.S01, ESTADOS.S02, ESTADOS.S03, ESTADOS.S04, ESTADOS.S05,
  ESTADOS.S06, ESTADOS.S07, ESTADOS.S08, ESTADOS.S09
];
const ESTADOS_EXCLUIDOS_DERIVACION = [ESTADOS.S10, ESTADOS.S11];

const ORDEN_PRIORIDAD = ['P1', 'P2', 'P3', 'P4', 'P5'];

const PRIORIDAD_ETIQUETA = {
  P1: 'Critica', P2: 'Alta', P3: 'Media', P4: 'Baja', P5: 'Planificada'
};
const PRIORIDAD_EMOJI = {
  P1: '🔴', P2: '🟠', P3: '🟡', P4: '🟢', P5: '🔵'
};

// RN-006: el impacto (no el origen ni la urgencia del cliente) determina la
// prioridad automatica.
const MAPA_IMPACTO_PRIORIDAD = {
  SISTEMA_CAIDO: 'P1',
  PERDIDA_DATOS: 'P1',
  BLOQUEO_OPERATIVO: 'P1',
  DEGRADACION_IMPORTANTE: 'P2',
  PARCIAL_CON_WORKAROUND: 'P3',
  PLANIFICADO: 'P5'
};

const PRIORIDAD_POR_DEFECTO = 'P4';

// Buzon por defecto cuando un area no tiene responsable configurado.
const EMAIL_DESARROLLO = 'lestay@rld.cl';

module.exports = {
  ESTADOS, ESTADOS_CERRADOS, ETIQUETA_ESTADO, ORDEN_ESTADOS, ESTADOS_EXCLUIDOS_DERIVACION,
  ESTADO_VISIBLE, ETIQUETA_VISIBLE, estadoVisible_, etiquetaVisible_,
  ORDEN_PRIORIDAD, PRIORIDAD_ETIQUETA, PRIORIDAD_EMOJI,
  MAPA_IMPACTO_PRIORIDAD, PRIORIDAD_POR_DEFECTO, EMAIL_DESARROLLO
};
