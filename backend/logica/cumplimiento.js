'use strict';

/**
 * cumplimiento.js — puerto de backend/backoffice/Cumplimiento.gs: "dos
 * relojes" y los dos ejes que se derivan de ellos. NO son estados nuevos de
 * la maquina (S01-S11 no cambia) -- son clasificaciones calculadas sobre
 * fecha_comprometida/fecha_terminada/estado/sla_objetivo_horas.
 *
 *  - Cumplimiento.clasificar mide contra fecha_comprometida (la promesa del
 *    desarrollador). Reloj del desarrollador: corre desde que se compromete
 *    -> se detiene al entrar a Terminada (S08). Reloj del solicitante:
 *    empieza en fecha_terminada -> se detiene al cerrar (S09). Un item
 *    pasado de fecha pero YA en S08 no es atraso del desarrollador -- es
 *    "esperando validacion" del solicitante.
 *  - Sla.medir mide contra sla_objetivo_horas desde fecha_creacion (tiempo
 *    de respuesta por prioridad). Eje DISTINTO a proposito (ver la nota
 *    identica en el .gs): un item puede estar "Terminada" segun Cumplimiento
 *    y "Fuera de plazo" segun Sla al mismo tiempo, y ambos son ciertos.
 */

const { ESTADOS, ESTADOS_CERRADOS, ESTADOS_EXCLUIDOS_DERIVACION } = require('./constantesSolicitudes');
const { leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Utils = require('./utils');

// Jornada por defecto de Utils.horasHabilesEntre (09:00-18:00) = 9 horas.
// "Menos de 1 dia habil restante" se mide contra esto.
const CUMPLIMIENTO_HORAS_JORNADA = 9;

const CUMPLIMIENTO_ETIQUETA = {
  EN_PLAZO: { emoji: '🟢', texto: 'En plazo' },
  EN_RIESGO: { emoji: '🟡', texto: 'En riesgo' },
  ATRASADA_DESARROLLADOR: { emoji: '🔴', texto: 'Atrasada (desarrollador)' },
  ESPERANDO_VALIDACION: { emoji: '🔵', texto: 'Esperando validación (solicitante)' },
  SIN_COMPROMISO: { emoji: '⚪', texto: 'Sin comprometer' },
  CERRADA_A_TIEMPO: { emoji: '✅', texto: 'Cerrada a tiempo' },
  CERRADA_CON_ATRASO: { emoji: '❌', texto: 'Cerrada con atraso' }
};

function redondear1Decimal_(numero) {
  return Math.round(numero * 10) / 10;
}

// Historico, para cuando el item ya esta cerrado/rechazado/cancelado.
function clasificarCerrada_(subsolicitud) {
  if (!subsolicitud.fecha_comprometida) return 'SIN_COMPROMISO';
  // Cierre directo sin pasar por Terminada (consulta tecnica, RN-201): no
  // hubo reloj de desarrollador que evaluar, no se le atribuye atraso.
  if (!subsolicitud.fecha_terminada) return 'CERRADA_A_TIEMPO';
  const aTiempo = new Date(subsolicitud.fecha_terminada) <= new Date(subsolicitud.fecha_comprometida);
  return aTiempo ? 'CERRADA_A_TIEMPO' : 'CERRADA_CON_ATRASO';
}

/**
 * @param {object} subsolicitud fila de SUBSOLICITUDES.
 * @param {Date} [ahora] inyectable para tests; por defecto new Date().
 */
function clasificar(subsolicitud, ahora) {
  const momento = ahora || new Date();
  const esCerrada = ESTADOS_CERRADOS.indexOf(subsolicitud.estado) !== -1;

  let codigo;
  let diasEsperando = null;

  if (esCerrada) {
    codigo = clasificarCerrada_(subsolicitud);
  } else if (!subsolicitud.fecha_comprometida) {
    codigo = 'SIN_COMPROMISO';
  } else if (subsolicitud.estado === ESTADOS.S08) {
    codigo = 'ESPERANDO_VALIDACION';
    diasEsperando = subsolicitud.fecha_terminada
      ? redondear1Decimal_(Utils.horasHabilesEntre(subsolicitud.fecha_terminada, momento) / CUMPLIMIENTO_HORAS_JORNADA)
      : 0;
  } else if (momento > new Date(subsolicitud.fecha_comprometida)) {
    codigo = 'ATRASADA_DESARROLLADOR';
  } else if (Utils.horasHabilesEntre(momento, subsolicitud.fecha_comprometida) < CUMPLIMIENTO_HORAS_JORNADA) {
    codigo = 'EN_RIESGO';
  } else {
    codigo = 'EN_PLAZO';
  }

  const etiqueta = CUMPLIMIENTO_ETIQUETA[codigo];
  return { codigo: codigo, etiqueta: etiqueta.texto, emoji: etiqueta.emoji, dias_esperando: diasEsperando };
}

// --- Eje SLA de respuesta (A-08/A-09) -------------------------------------

// A-08: "proximo a vencer" = 80% del SLA objetivo ya consumido y aun no vencido.
const SLA_UMBRAL_RIESGO = 0.8;

/**
 * @param {object} subsolicitud fila de SUBSOLICITUDES.
 * @param {object} [opciones] {feriados, ahora}.
 * @return {null|{objetivo_horas, transcurridas_horas, restantes_horas, ratio, situacion}}
 *   null cuando NO hay SLA vigente: rechazado/cancelado (S10/S11), cerrado
 *   (S09), o sin sla_objetivo_horas (P5, atencion directa).
 */
function medir(subsolicitud, opciones) {
  const opts = opciones || {};
  if (ESTADOS_EXCLUIDOS_DERIVACION.indexOf(subsolicitud.estado) !== -1 || subsolicitud.estado === ESTADOS.S09) {
    return null;
  }
  let objetivo = subsolicitud.sla_objetivo_horas;
  if (objetivo === '' || objetivo === undefined || objetivo === null) return null;
  objetivo = Number(objetivo);
  const transcurridas = Utils.horasHabilesEntre(subsolicitud.fecha_creacion, opts.ahora || new Date(), { feriados: opts.feriados });
  const ratio = transcurridas / objetivo;
  return {
    objetivo_horas: objetivo, transcurridas_horas: transcurridas, restantes_horas: objetivo - transcurridas,
    ratio: ratio, situacion: ratio > 1 ? 'FUERA_DE_PLAZO' : (ratio >= SLA_UMBRAL_RIESGO ? 'EN_RIESGO' : 'EN_PLAZO')
  };
}

/** Atajo: 'FUERA_DE_PLAZO' | 'EN_RIESGO' | 'EN_PLAZO' | null (no aplica). */
function situacion(subsolicitud, opciones) {
  const medicion = medir(subsolicitud, opciones);
  return medicion ? medicion.situacion : null;
}

/**
 * Situacion de una SOLICITUD completa = la PEOR de sus items. No se deriva
 * del item con menos horas restantes: con objetivos distintos por
 * prioridad, "menos horas restantes" y "mas SLA consumido" no son el mismo
 * item (un P4 con 20h de 120 ya va en riesgo; un P1 con 0,5h de 2 sigue en plazo).
 */
function peorSituacion(situaciones) {
  const orden = ['FUERA_DE_PLAZO', 'EN_RIESGO', 'EN_PLAZO'];
  for (const s of orden) {
    if (situaciones.indexOf(s) !== -1) return s;
  }
  return null;
}

function obtenerFeriados(db) {
  return leerFilas_(db, 'CONFIG_FERIADOS', COLUMNAS.CONFIG_FERIADOS).map((f) => f.fecha);
}

module.exports = {
  clasificar, medir, situacion, peorSituacion, obtenerFeriados,
  SLA_UMBRAL_RIESGO, CUMPLIMIENTO_ETIQUETA
};
