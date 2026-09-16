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
  ESTADOS, ESTADOS_CERRADOS, ORDEN_PRIORIDAD, PRIORIDAD_ETIQUETA, PRIORIDAD_EMOJI,
  MAPA_IMPACTO_PRIORIDAD, PRIORIDAD_POR_DEFECTO, EMAIL_DESARROLLO
};
