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

// --- Eje SLA de respuesta (A-08/A-09, §13/§17.4) -----------------------
//
// OJO: este es un eje DISTINTO del semaforo de Cumplimiento de arriba, y
// confundirlos da numeros que no cuadran entre pantallas:
//
//  - Cumplimiento.clasificar mide contra fecha_comprometida (la promesa que
//    hizo Leo). Es el eje del Panel de Gerencia y de Jefatura: "entregamos
//    cuando dijimos que iba a estar".
//  - Sla mide contra sla_objetivo_horas desde fecha_creacion (el tiempo de
//    respuesta que corresponde por prioridad: P1 2h, P2 24h, P3 72h,
//    P4 120h). Es el eje de la Bandeja de trabajo y de los avisos
//    automaticos A-08/A-09.
//
// Los dos tienen que seguir separados (§6: un item pasado de fecha pero ya
// en S08 no es atraso del desarrollador). Lo que NO tiene que estar separado
// es la implementacion de cada eje: hasta v6.1 el eje SLA estaba triplicado
// (Dashboard.estaVencidoSla_, Dashboard.slaRestanteHoras_ y
// Triggers.ratioSlaConsumido_ repetian el mismo filtro de elegibilidad y la
// misma llamada a horasHabilesEntre). Sla.medir es ahora la unica
// implementacion y las tres delegan aca, asi la bandeja no puede decir
// "en riesgo" mientras el trigger nocturno dice "en plazo".

// A-08: "proximo a vencer" = 80% del SLA objetivo ya consumido y aun no
// vencido. El mismo umbral que ya usaba Triggers.verificarSLAs para decidir
// a quien le manda alertaSLAProximo -- no es un umbral nuevo de la bandeja.
var SLA_UMBRAL_RIESGO = 0.8;

var SLA_SITUACION_ETIQUETA = {
  EN_PLAZO: 'En plazo',
  EN_RIESGO: 'En riesgo',
  FUERA_DE_PLAZO: 'Fuera de plazo'
};

var Sla = {
  /**
   * Mide el SLA de respuesta de UN item.
   *
   * @param {object} subsolicitud fila de SUBSOLICITUDES (estado,
   *   fecha_creacion, sla_objetivo_horas).
   * @param {object} [opciones] {feriados, ahora} -- ahora es inyectable para
   *   tests; feriados se pasa ya leido para no releer la hoja por item.
   * @return {null|{objetivo_horas: number, transcurridas_horas: number,
   *   restantes_horas: number, ratio: number, situacion: string}}
   *   null cuando NO hay SLA vigente que evaluar: item rechazado/cancelado
   *   (S10/S11), ya cerrado (S09), o sin sla_objetivo_horas (P5, atencion
   *   directa). Mismo criterio de elegibilidad que tenian las tres copias.
   */
  medir: function (subsolicitud, opciones) {
    var opts = opciones || {};
    if (ESTADOS_EXCLUIDOS_DERIVACION.indexOf(subsolicitud.estado) !== -1 || subsolicitud.estado === ESTADOS.S09) {
      return null;
    }
    var objetivo = subsolicitud.sla_objetivo_horas;
    if (objetivo === '' || objetivo === undefined || objetivo === null) {
      return null;
    }
    objetivo = Number(objetivo);
    var transcurridas = Utils.horasHabilesEntre(
      subsolicitud.fecha_creacion, opts.ahora || new Date(), { feriados: opts.feriados });
    var ratio = transcurridas / objetivo;
    return {
      objetivo_horas: objetivo,
      transcurridas_horas: transcurridas,
      restantes_horas: objetivo - transcurridas,
      ratio: ratio,
      situacion: ratio > 1 ? 'FUERA_DE_PLAZO' : (ratio >= SLA_UMBRAL_RIESGO ? 'EN_RIESGO' : 'EN_PLAZO')
    };
  },

  /** Atajo: 'FUERA_DE_PLAZO' | 'EN_RIESGO' | 'EN_PLAZO' | null (no aplica). */
  situacion: function (subsolicitud, opciones) {
    var medicion = Sla.medir(subsolicitud, opciones);
    return medicion ? medicion.situacion : null;
  },

  /**
   * Situacion de una SOLICITUD completa = la PEOR de sus items.
   *
   * No se puede derivar del item con menos horas restantes: con objetivos
   * distintos por prioridad, "menos horas restantes" y "mas SLA consumido"
   * no son el mismo item (un P4 con 20 h de 120 ya va en riesgo; un P1 con
   * 0,5 h de 2 todavia esta en plazo).
   *
   * @param {Array<string|null>} situaciones
   * @return {string|null} null si ningun item tiene SLA vigente.
   */
  peorSituacion: function (situaciones) {
    var orden = ['FUERA_DE_PLAZO', 'EN_RIESGO', 'EN_PLAZO'];
    for (var i = 0; i < orden.length; i++) {
      if (situaciones.indexOf(orden[i]) !== -1) return orden[i];
    }
    return null;
  }
};
