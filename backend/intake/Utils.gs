/**
 * Utils.gs — Utils.horasHabilesEntre(inicio, fin, opciones) (§10).
 *
 * Jornada habil: L-V 09:00-18:00, zona horaria del proyecto
 * (America/Santiago, appsscript.json). El calculo se hace en hora local
 * usando Intl.DateTimeFormat para resolver el offset de la zona en cada
 * instante -- nunca se hardcodea UTC-3/UTC-4, para que el horario de
 * verano de Chile (cuando aplique) se resuelva solo, igual que pide la
 * especificacion. Intl con soporte de timeZone esta disponible tanto en el
 * runtime V8 de Apps Script como en Node con ICU completo (por eso se
 * puede probar con node:test sin mocks adicionales).
 *
 * opciones:
 *   - feriados: array de 'YYYY-MM-DD' (hora local) a excluir.
 *   - pausas: array de { inicio, fin } (Date o ISO string) a excluir del
 *     conteo -- p.ej. los intervalos en que una subsolicitud estuvo en S06.
 *   - timezone: default America/Santiago.
 *   - horaInicioJornada / horaFinJornada: default 9 / 18.
 */

var Utils = {
  horasHabilesEntre: function (inicio, fin, opciones) {
    var opts = opciones || {};
    var tz = opts.timezone || 'America/Santiago';
    var horaInicioJornada = opts.horaInicioJornada !== undefined ? opts.horaInicioJornada : 9;
    var horaFinJornada = opts.horaFinJornada !== undefined ? opts.horaFinJornada : 18;
    var feriadosSet = {};
    (opts.feriados || []).forEach(function (f) {
      feriadosSet[f] = true;
    });

    var inicioDate = aFecha_(inicio);
    var finDate = aFecha_(fin);
    // Fecha invalida (celda vacia o mal pegada a mano): se cuenta como 0
    // horas en vez de tirar una excepcion mas adentro. Ver la nota identica
    // en backend/backoffice/Utils.gs.
    if (isNaN(inicioDate.getTime()) || isNaN(finDate.getTime())) {
      return 0;
    }
    if (finDate <= inicioDate) {
      return 0;
    }

    var brutas = horasHabilesBrutas_(inicioDate, finDate, feriadosSet, tz, horaInicioJornada, horaFinJornada);

    var pausadas = (opts.pausas || []).reduce(function (acc, pausa) {
      var pausaInicio = maxFecha_(aFecha_(pausa.inicio), inicioDate);
      var pausaFin = minFecha_(aFecha_(pausa.fin), finDate);
      if (pausaFin <= pausaInicio) {
        return acc;
      }
      return acc + horasHabilesBrutas_(pausaInicio, pausaFin, feriadosSet, tz, horaInicioJornada, horaFinJornada);
    }, 0);

    var resultado = brutas - pausadas;
    return resultado < 0 ? 0 : resultado;
  }
};

function aFecha_(valor) {
  return valor instanceof Date ? valor : new Date(valor);
}

function maxFecha_(a, b) {
  return a > b ? a : b;
}

function minFecha_(a, b) {
  return a < b ? a : b;
}

// Offset de `tz` respecto de UTC, en minutos, para el instante `fecha`
// (positivo = tz adelantada respecto de UTC). Se recalcula por instante
// para que el horario de verano de la zona se resuelva solo.

// Construir un Intl.DateTimeFormat es caro y estos son SIEMPRE los mismos
// dos, por zona horaria. Se cachean: son objetos sin estado, reusarlos es
// seguro y es para lo que existen.
//
// Antes se construia uno nuevo en cada llamada, y horasHabilesBrutas_ los
// pide cuatro veces por cada DIA del rango que mide. Con eso, el panel de
// Gerencia gastaba 14,9 segundos de CPU en 900 subsolicitudes.
var _fmtOffset_ = {};
var _fmtDia_ = {};

function formateadorOffset_(tz) {
  if (!_fmtOffset_[tz]) {
    _fmtOffset_[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }
  return _fmtOffset_[tz];
}

function formateadorDia_(tz) {
  if (!_fmtDia_[tz]) {
    _fmtDia_[tz] = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
    });
  }
  return _fmtDia_[tz];
}

function offsetMinutos_(fecha, tz) {
  var dtf = formateadorOffset_(tz);
  var partes = dtf.formatToParts(fecha).reduce(function (acc, p) {
    acc[p.type] = p.value;
    return acc;
  }, {});
  var hora = partes.hour === '24' ? 0 : Number(partes.hour);
  var comoUtc = Date.UTC(
    Number(partes.year), Number(partes.month) - 1, Number(partes.day),
    hora, Number(partes.minute), Number(partes.second)
  );
  return (comoUtc - fecha.getTime()) / 60000;
}

// 'YYYY-MM-DD' del dia calendario local (en tz) al que pertenece `fecha`.
function claveDia_(fecha, tz) {
  // Fecha invalida: Intl.DateTimeFormat.format lanza RangeError. Ver la nota
  // identica en backend/backoffice/Utils.gs.
  if (!(fecha instanceof Date) || isNaN(fecha.getTime())) {
    return '';
  }
  var dtf = formateadorDia_(tz);
  return dtf.format(fecha); // en-CA formatea como YYYY-MM-DD
}

// Convierte una hora de reloj local (hora:minuto de un dia calendario dado
// en tz) al instante UTC correspondiente. Iteracion de punto fijo (2
// pasadas) para resolver correctamente el offset incluso el dia del cambio
// de horario de verano.
// El inicio y el fin de jornada de un dia dado son SIEMPRE el mismo
// instante. Se memoizan por (dia, hora, minuto, zona): hoy se recalculan
// para CADA subsolicitud que cruce ese dia, y son cientos.
//
// La clave incluye la zona porque el mismo dia y hora dan instantes
// distintos en zonas distintas.
var _instanteLocal_ = {};

function instanteLocal_(claveDia, hora, minuto, tz) {
  var clave = tz + '|' + claveDia + '|' + hora + '|' + minuto;
  var guardado = _instanteLocal_[clave];
  if (guardado !== undefined) return new Date(guardado);
  var partes = claveDia.split('-').map(Number);
  var aproximado = new Date(Date.UTC(partes[0], partes[1] - 1, partes[2], hora, minuto, 0));
  var offset1 = offsetMinutos_(aproximado, tz);
  var candidato = new Date(aproximado.getTime() - offset1 * 60000);
  var offset2 = offsetMinutos_(candidato, tz);
  var resultado = aproximado.getTime() - offset2 * 60000;
  _instanteLocal_[clave] = resultado;
  // Se devuelve un Date NUEVO cada vez: quien llama podria mutarlo, y un
  // Date compartido convertiria el cache en una fuente de errores raros.
  return new Date(resultado);
}

function diaSemanaClave_(claveDia) {
  var partes = claveDia.split('-').map(Number);
  return new Date(Date.UTC(partes[0], partes[1] - 1, partes[2])).getUTCDay(); // 0=domingo .. 6=sabado
}

function esDiaHabil_(claveDia, feriadosSet) {
  var diaSemana = diaSemanaClave_(claveDia);
  var esFinDeSemana = diaSemana === 0 || diaSemana === 6;
  return !esFinDeSemana && !feriadosSet[claveDia];
}

function siguienteDiaClave_(claveDia) {
  var partes = claveDia.split('-').map(Number);
  var siguiente = new Date(Date.UTC(partes[0], partes[1] - 1, partes[2] + 1));
  return siguiente.toISOString().slice(0, 10);
}

function horasHabilesBrutas_(inicioDate, finDate, feriadosSet, tz, horaInicioJornada, horaFinJornada) {
  var totalMinutos = 0;
  var claveActual = claveDia_(inicioDate, tz);
  var claveFin = claveDia_(finDate, tz);

  while (true) {
    if (esDiaHabil_(claveActual, feriadosSet)) {
      var inicioJornada = instanteLocal_(claveActual, horaInicioJornada, 0, tz);
      var finJornada = instanteLocal_(claveActual, horaFinJornada, 0, tz);
      var desde = maxFecha_(inicioJornada, inicioDate);
      var hasta = minFecha_(finJornada, finDate);
      if (hasta > desde) {
        totalMinutos += (hasta.getTime() - desde.getTime()) / 60000;
      }
    }
    if (claveActual === claveFin) {
      break;
    }
    claveActual = siguienteDiaClave_(claveActual);
  }

  return totalMinutos / 60;
}
