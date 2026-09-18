'use strict';

/**
 * utils.js — puerto de backend/backoffice/Utils.gs (Utils.horasHabilesEntre).
 *
 * Puerto CASI verbatim a proposito: el .gs ya era JavaScript puro (Date +
 * Intl.DateTimeFormat, sin ninguna llamada a la API de Apps Script) --
 * la propia nota del archivo original explica que por eso ya se probaba con
 * node:test sin mocks. No hay nada que adaptar salvo el envoltorio module.
 * exports.
 *
 * Jornada habil: L-V 09:00-18:00, zona horaria del proyecto (America/
 * Santiago por defecto). El offset se resuelve por instante via Intl, nunca
 * hardcodeado, para que el horario de verano de Chile se resuelva solo.
 */

function aFecha_(valor) {
  return valor instanceof Date ? valor : new Date(valor);
}

function maxFecha_(a, b) {
  return a > b ? a : b;
}

function minFecha_(a, b) {
  return a < b ? a : b;
}

// Construir un Intl.DateTimeFormat es caro y estos son SIEMPRE los mismos
// dos, por zona horaria -- se cachean (ver la nota de rendimiento original:
// sin esto, el panel de Gerencia gastaba 14,9s de CPU en 900 subsolicitudes).
const _fmtOffset_ = {};
const _fmtDia_ = {};

function formateadorOffset_(tz) {
  if (!_fmtOffset_[tz]) {
    _fmtOffset_[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }
  return _fmtOffset_[tz];
}

function formateadorDia_(tz) {
  if (!_fmtDia_[tz]) {
    _fmtDia_[tz] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  return _fmtDia_[tz];
}

function offsetMinutos_(fecha, tz) {
  const dtf = formateadorOffset_(tz);
  const partes = dtf.formatToParts(fecha).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const hora = partes.hour === '24' ? 0 : Number(partes.hour);
  const comoUtc = Date.UTC(Number(partes.year), Number(partes.month) - 1, Number(partes.day), hora, Number(partes.minute), Number(partes.second));
  return (comoUtc - fecha.getTime()) / 60000;
}

function claveDia_(fecha, tz) {
  if (!(fecha instanceof Date) || isNaN(fecha.getTime())) return '';
  return formateadorDia_(tz).format(fecha); // en-CA formatea como YYYY-MM-DD
}

// Convierte una hora de reloj local al instante UTC correspondiente.
// Iteracion de punto fijo (2 pasadas) para resolver el offset incluso el
// dia del cambio de horario de verano. Memoizado por (dia, hora, minuto,
// zona): se recalcularia para cada subsolicitud que cruce ese dia.
const _instanteLocal_ = {};

function instanteLocal_(claveDia, hora, minuto, tz) {
  const clave = tz + '|' + claveDia + '|' + hora + '|' + minuto;
  const guardado = _instanteLocal_[clave];
  if (guardado !== undefined) return new Date(guardado);
  const partes = claveDia.split('-').map(Number);
  const aproximado = new Date(Date.UTC(partes[0], partes[1] - 1, partes[2], hora, minuto, 0));
  const offset1 = offsetMinutos_(aproximado, tz);
  const candidato = new Date(aproximado.getTime() - offset1 * 60000);
  const offset2 = offsetMinutos_(candidato, tz);
  const resultado = aproximado.getTime() - offset2 * 60000;
  _instanteLocal_[clave] = resultado;
  // Date NUEVO cada vez: un Date compartido que alguien mute convertiria el
  // cache en una fuente de errores raros.
  return new Date(resultado);
}

function diaSemanaClave_(claveDia) {
  const partes = claveDia.split('-').map(Number);
  return new Date(Date.UTC(partes[0], partes[1] - 1, partes[2])).getUTCDay(); // 0=domingo .. 6=sabado
}

function esDiaHabil_(claveDia, feriadosSet) {
  const diaSemana = diaSemanaClave_(claveDia);
  const esFinDeSemana = diaSemana === 0 || diaSemana === 6;
  return !esFinDeSemana && !feriadosSet[claveDia];
}

function siguienteDiaClave_(claveDia) {
  const partes = claveDia.split('-').map(Number);
  const siguiente = new Date(Date.UTC(partes[0], partes[1] - 1, partes[2] + 1));
  return siguiente.toISOString().slice(0, 10);
}

function horasHabilesBrutas_(inicioDate, finDate, feriadosSet, tz, horaInicioJornada, horaFinJornada) {
  let totalMinutos = 0;
  let claveActual = claveDia_(inicioDate, tz);
  const claveFin = claveDia_(finDate, tz);

  while (true) {
    if (esDiaHabil_(claveActual, feriadosSet)) {
      const inicioJornada = instanteLocal_(claveActual, horaInicioJornada, 0, tz);
      const finJornada = instanteLocal_(claveActual, horaFinJornada, 0, tz);
      const desde = maxFecha_(inicioJornada, inicioDate);
      const hasta = minFecha_(finJornada, finDate);
      if (hasta > desde) totalMinutos += (hasta.getTime() - desde.getTime()) / 60000;
    }
    if (claveActual === claveFin) break;
    claveActual = siguienteDiaClave_(claveActual);
  }
  return totalMinutos / 60;
}

/**
 * opciones: { feriados: ['YYYY-MM-DD', ...], pausas: [{inicio,fin}, ...],
 *   timezone, horaInicioJornada, horaFinJornada }.
 */
function horasHabilesEntre(inicio, fin, opciones) {
  const opts = opciones || {};
  const tz = opts.timezone || 'America/Santiago';
  const horaInicioJornada = opts.horaInicioJornada !== undefined ? opts.horaInicioJornada : 9;
  const horaFinJornada = opts.horaFinJornada !== undefined ? opts.horaFinJornada : 18;
  const feriadosSet = {};
  (opts.feriados || []).forEach((f) => { feriadosSet[f] = true; });

  const inicioDate = aFecha_(inicio);
  const finDate = aFecha_(fin);
  if (isNaN(inicioDate.getTime()) || isNaN(finDate.getTime())) return 0;
  if (finDate <= inicioDate) return 0;

  const brutas = horasHabilesBrutas_(inicioDate, finDate, feriadosSet, tz, horaInicioJornada, horaFinJornada);

  const pausadas = (opts.pausas || []).reduce((acc, pausa) => {
    const pausaInicio = maxFecha_(aFecha_(pausa.inicio), inicioDate);
    const pausaFin = minFecha_(aFecha_(pausa.fin), finDate);
    if (pausaFin <= pausaInicio) return acc;
    return acc + horasHabilesBrutas_(pausaInicio, pausaFin, feriadosSet, tz, horaInicioJornada, horaFinJornada);
  }, 0);

  const resultado = brutas - pausadas;
  return resultado < 0 ? 0 : resultado;
}

// Puerto de sumarDiasHabilesSgc_ (backend/backoffice/NoConformidades.gs) --
// generico, no especifico de NC: lo necesitan varios modulos del SGC
// (NoConformidades/Auditorias/Quejas/RevisionDireccion, PRO-06/03/07/05
// hablan todos de plazos en DIAS HABILES, no horas). Se centraliza aca para
// que el primero que lo necesito no lo duplique en los que vienen.
// Devuelve el FIN de ese dia habil (23:59:59 UTC) para que "vence hoy" no
// se lea como vencido a las 00:01.
function sumarDiasHabiles_(desde, dias, opciones) {
  const inicio = aFecha_(desde);
  if (isNaN(inicio.getTime())) return '';
  const opts = opciones || {};
  const tz = opts.timezone || 'America/Santiago';
  const feriadosSet = {};
  (opts.feriados || []).forEach((f) => { feriadosSet[typeof f === 'string' ? f.slice(0, 10) : claveDia_(aFecha_(f), tz)] = true; });

  let clave = claveDia_(inicio, tz);
  let restantes = dias;
  let guarda = 0;
  while (restantes > 0 && guarda < 1000) {
    clave = siguienteDiaClave_(clave);
    if (esDiaHabil_(clave, feriadosSet)) restantes--;
    guarda++;
  }
  const partes = clave.split('-').map(Number);
  return new Date(Date.UTC(partes[0], partes[1] - 1, partes[2], 23, 59, 59)).toISOString();
}

// Espejo exacto de siguienteDiaClave_: aritmetica UTC pura y toISOString,
// NO claveDia_ -- volver a formatear con zona horaria aca descontaria un
// dia extra en husos al oeste de UTC (la clave es una etiqueta de dia, no
// un instante que haya que reinterpretar).
function anteriorDiaClave_(claveDia) {
  const partes = claveDia.split('-').map(Number);
  const anterior = new Date(Date.UTC(partes[0], partes[1] - 1, partes[2] - 1));
  return anterior.toISOString().slice(0, 10);
}

// Puerto de restarDiasHabilesSgc_ (backend/backoffice/RevisionDireccion.gs)
// -- inverso de sumarDiasHabiles_, hace falta para plazos que se cuentan
// hacia ATRAS desde una fecha (ej. "avisar 10 dias habiles ANTES de la
// reunion", PRO-05 §6). Devuelve el INICIO de ese dia habil (00:00:00 UTC).
function restarDiasHabiles_(desde, dias, opciones) {
  const inicio = aFecha_(desde);
  if (isNaN(inicio.getTime())) return '';
  const opts = opciones || {};
  const tz = opts.timezone || 'America/Santiago';
  const feriadosSet = {};
  (opts.feriados || []).forEach((f) => { feriadosSet[typeof f === 'string' ? f.slice(0, 10) : claveDia_(aFecha_(f), tz)] = true; });

  let clave = claveDia_(inicio, tz);
  let restantes = dias;
  let guarda = 0;
  while (restantes > 0 && guarda < 1000) {
    clave = anteriorDiaClave_(clave);
    if (esDiaHabil_(clave, feriadosSet)) restantes--;
    guarda++;
  }
  const partes = clave.split('-').map(Number);
  return new Date(Date.UTC(partes[0], partes[1] - 1, partes[2], 0, 0, 0)).toISOString();
}

module.exports = {
  horasHabilesEntre,
  claveDia_,
  sumarDiasHabiles_, restarDiasHabiles_, esDiaHabil_, siguienteDiaClave_, anteriorDiaClave_, diaSemanaClave_,
  // Expuestos para los tests de memoizacion (mismo motivo que en el .gs).
  formateadorOffset_, formateadorDia_, offsetMinutos_, instanteLocal_
};
