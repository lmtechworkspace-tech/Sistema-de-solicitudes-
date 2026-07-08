/**
 * Cumplimiento.gs — v2.1 (Fase B, documentacion/SIGSO-v2.1-plazos-y-control.md
 * §2.2 y §6): "dos relojes" y el semaforo de cumplimiento que se deriva de
 * ellos. No son estados nuevos de la maquina (S01-S11 no cambia) -- es una
 * clasificacion calculada a partir de fecha_comprometida/fecha_terminada/
 * estado, reutilizando el motor de horas habiles ya existente (Utils.gs).
 *
 *  - Reloj del desarrollador: corre desde que se compromete -> se detiene al
 *    entrar a "Terminada" (S08, fecha_terminada). Mide si entrego a tiempo.
 *  - Reloj del solicitante: empieza en fecha_terminada -> se detiene al
 *    cerrar (S09). Mide cuanto tarda en validar lo que ya le entregaron.
 *
 * Por eso un item pasado de fecha pero YA en S08 no se clasifica como
 * atraso del desarrollador: se clasifica "esperando validacion" (del
 * solicitante) -- el requisito explicito del cliente de no culpar a Leo por
 * solicitudes que el solicitante nunca prueba.
 */

// Jornada por defecto de Utils.horasHabilesEntre (09:00-18:00) = 9 horas.
// "Menos de 1 dia habil restante" (§6, umbral de "en riesgo") se mide contra
// esto -- no se re-declara el horario de jornada aqui, solo el umbral.
var CUMPLIMIENTO_HORAS_JORNADA = 9;

var CUMPLIMIENTO_ETIQUETA = {
  EN_PLAZO: { emoji: '🟢', texto: 'En plazo' },
  EN_RIESGO: { emoji: '🟡', texto: 'En riesgo' },
  ATRASADA_DESARROLLADOR: { emoji: '🔴', texto: 'Atrasada (desarrollador)' },
  ESPERANDO_VALIDACION: { emoji: '🔵', texto: 'Esperando validación (solicitante)' },
  SIN_COMPROMISO: { emoji: '⚪', texto: 'Sin comprometer' },
  CERRADA_A_TIEMPO: { emoji: '✅', texto: 'Cerrada a tiempo' },
  CERRADA_CON_ATRASO: { emoji: '❌', texto: 'Cerrada con atraso' }
};

var Cumplimiento = {
  /**
   * @param {object} subsolicitud fila de SUBSOLICITUDES (estado,
   *   fecha_comprometida, fecha_terminada).
   * @param {Date} [ahora] inyectable para tests; por defecto new Date().
   * @return {{codigo: string, etiqueta: string, emoji: string, dias_esperando: (number|null)}}
   */
  clasificar: function (subsolicitud, ahora) {
    var momento = ahora || new Date();
    var esCerrada = ESTADOS_CERRADOS.indexOf(subsolicitud.estado) !== -1;

    var codigo;
    var diasEsperando = null;

    if (esCerrada) {
      codigo = clasificarCerrada_(subsolicitud);
    } else if (!subsolicitud.fecha_comprometida) {
      // Aun no revisada/comprometida (§6): cola sin comprometer.
      codigo = 'SIN_COMPROMISO';
    } else if (subsolicitud.estado === ESTADOS.S08) {
      // Reloj del desarrollador detenido; corre el del solicitante.
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

    var etiqueta = CUMPLIMIENTO_ETIQUETA[codigo];
    return {
      codigo: codigo,
      etiqueta: etiqueta.texto,
      emoji: etiqueta.emoji,
      dias_esperando: diasEsperando
    };
  }
};

// §6: historico, para cuando el item ya esta cerrado/rechazado/cancelado.
function clasificarCerrada_(subsolicitud) {
  if (!subsolicitud.fecha_comprometida) {
    return 'SIN_COMPROMISO';
  }
  // Cierre directo sin pasar por Terminada (p.ej. consulta tecnica, RN-201):
  // no hubo reloj de desarrollador que evaluar, no se le atribuye atraso.
  if (!subsolicitud.fecha_terminada) {
    return 'CERRADA_A_TIEMPO';
  }
  var aTiempo = new Date(subsolicitud.fecha_terminada) <= new Date(subsolicitud.fecha_comprometida);
  return aTiempo ? 'CERRADA_A_TIEMPO' : 'CERRADA_CON_ATRASO';
}

function redondear1Decimal_(numero) {
  return Math.round(numero * 10) / 10;
}
