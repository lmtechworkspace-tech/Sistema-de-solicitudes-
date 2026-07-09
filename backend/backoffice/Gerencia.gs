/**
 * Gerencia.gs — v2.1 (Fase C, documentacion/SIGSO-v2.1-plazos-y-control.md §7):
 * Panel de Control de Gerencia. Es una VISTA sobre datos que ya existen
 * (SOLICITUDES/SUBSOLICITUDES + el semaforo de Cumplimiento.gs, Fase B) --
 * no agrega columnas ni estados nuevos, solo agrega/agrupa lo calculado.
 *
 * Gerencia.getPanel(filtros, contexto) devuelve, para cada item activo o
 * cerrado que matchea los filtros:
 *  - los datos minimos para la carta Gantt-lite (fecha_creacion como
 *    "inicio" visual, fecha_comprometida como "fin", fecha_original si hubo
 *    re-compromiso -- el "resbalon", §7C),
 *  - el semaforo (Cumplimiento.clasificar, ya existente de la Fase B),
 *  - los datos para agrupar/filtrar (empresa, tipo, desarrollador,
 *    solicitante).
 * Mas la banda de KPIs (§7A) agregados sobre ese mismo conjunto filtrado.
 *
 * Reutiliza coincideFiltros_ (Dashboard.gs) para los filtros que ya existen
 * (empresa/solicitante/prioridad/estado) y le agrega los propios de este
 * panel (desarrollador, tipo, periodo) -- todo vive en el mismo scope global
 * (Apps Script concatena los .gs de un proyecto), no hace falta importarlo.
 */

var Gerencia = {
  getPanel: function (filtros, contexto) {
    var filtrosBase = filtros || {};
    var feriados = obtenerFeriados_();

    var solicitudes = leerFilas_(SHEETS.SOLICITUDES).filter(function (s) {
      return coincideFiltros_(s, filtrosBase, {});
    });
    var solicitudPorId = {};
    solicitudes.forEach(function (s) { solicitudPorId[s.solicitud_id] = s; });

    var historialCompromiso = leerFilas_(SHEETS.HISTORIAL_COMPROMISO);
    var lineasBase = lineaBasePorItem_(historialCompromiso);
    var reCompromisosPorItem = contarPorSubsolicitud_(historialCompromiso);

    var items = leerFilas_(SHEETS.SUBSOLICITUDES)
      .filter(function (sub) {
        return solicitudPorId[sub.solicitud_id] && coincideFiltroItem_(sub, solicitudPorId[sub.solicitud_id], filtrosBase);
      })
      .map(function (sub) {
        var solicitud = solicitudPorId[sub.solicitud_id];
        var cumplimiento = Cumplimiento.clasificar(sub);
        return {
          subsolicitud_id: sub.subsolicitud_id,
          solicitud_id: sub.solicitud_id,
          titulo: sub.titulo,
          numero_item: sub.numero_item,
          empresa_id: solicitud.empresa_id,
          tipo_nombre: sub.tipo_nombre || sub.tipo || '',
          modulo_nombre: sub.modulo_nombre || sub.modulo || '',
          estado: sub.estado,
          prioridad: sub.prioridad,
          es_cliente: !!solicitud.es_cliente,
          desarrollador_asignado: sub.desarrollador_asignado || solicitud.desarrollador_asignado || '',
          solicitante_nombre: solicitud.solicitante_nombre,
          solicitante_email: solicitud.solicitante_email,
          fecha_creacion: sub.fecha_creacion,
          fecha_comprometida: sub.fecha_comprometida || '',
          fecha_terminada: sub.fecha_terminada || '',
          // §7C: la "fecha original" (linea base, antes del primer
          // re-compromiso) hace visible el resbalon en la carta Gantt.
          fecha_original: lineasBase[sub.subsolicitud_id] || sub.fecha_comprometida || '',
          re_compromisos: reCompromisosPorItem[sub.subsolicitud_id] || 0,
          cumplimiento: cumplimiento
        };
      });

    return {
      kpis: calcularKpisGerencia_(items),
      items: items
    };
  }
};

// §7A: banda de KPIs -- se calcula sobre el MISMO conjunto ya filtrado que
// devuelve items (Gerencia ve el panel filtrado, no dos universos distintos).
function calcularKpisGerencia_(items) {
  var entregados = items.filter(function (i) { return !!i.fecha_terminada && !!i.fecha_comprometida; });
  var entregadosATiempo = entregados.filter(function (i) {
    return new Date(i.fecha_terminada) <= new Date(i.fecha_comprometida);
  });

  var esperandoValidacion = items.filter(function (i) { return i.cumplimiento.codigo === 'ESPERANDO_VALIDACION'; });
  var atrasadasActivas = items.filter(function (i) { return i.cumplimiento.codigo === 'ATRASADA_DESARROLLADOR'; });
  var cerradasConAtraso = items.filter(function (i) { return i.cumplimiento.codigo === 'CERRADA_CON_ATRASO'; });
  var sinComprometer = items.filter(function (i) { return i.cumplimiento.codigo === 'SIN_COMPROMISO'; });

  var diasAtraso = atrasadasActivas.map(function (i) {
    return Utils.horasHabilesEntre(i.fecha_comprometida, new Date()) / 9;
  }).concat(cerradasConAtraso.map(function (i) {
    return Utils.horasHabilesEntre(i.fecha_comprometida, i.fecha_terminada) / 9;
  }));

  return {
    pct_cumplimiento_desarrollador: entregados.length === 0
      ? null
      : Math.round((entregadosATiempo.length / entregados.length) * 1000) / 10,
    atrasadas_activas: atrasadasActivas.length,
    esperando_validacion: esperandoValidacion.length,
    esperando_validacion_promedio_dias: promedio_(esperandoValidacion.map(function (i) { return i.cumplimiento.dias_esperando || 0; })),
    atraso_promedio_dias: promedio_(diasAtraso),
    sin_comprometer: sinComprometer.length
  };
}

function promedio_(numeros) {
  if (numeros.length === 0) return 0;
  var suma = numeros.reduce(function (acc, n) { return acc + n; }, 0);
  return Math.round((suma / numeros.length) * 10) / 10;
}

// Primera fila de HISTORIAL_COMPROMISO (por timestamp) de cada item ->
// fecha_anterior es la linea base original (§5/§7C). Si un item nunca fue
// re-comprometido no aparece aqui; getPanel usa fecha_comprometida como su
// propia linea base en ese caso (no hubo resbalon que mostrar).
function lineaBasePorItem_(historialCompromiso) {
  var porItem = {};
  historialCompromiso.forEach(function (h) {
    var actual = porItem[h.subsolicitud_id];
    if (!actual || new Date(h.timestamp) < new Date(actual.timestamp)) {
      porItem[h.subsolicitud_id] = h;
    }
  });
  var resultado = {};
  Object.keys(porItem).forEach(function (subId) {
    resultado[subId] = porItem[subId].fecha_anterior;
  });
  return resultado;
}

function contarPorSubsolicitud_(historialCompromiso) {
  var contadores = {};
  historialCompromiso.forEach(function (h) {
    contadores[h.subsolicitud_id] = (contadores[h.subsolicitud_id] || 0) + 1;
  });
  return contadores;
}

// Filtros propios de este panel (§7B: "filtros por desarrollador, empresa,
// tipo, solicitante, periodo") que no existen en Dashboard.coincideFiltros_
// (esa funcion filtra a nivel SOLICITUD; estos son a nivel ITEM).
function coincideFiltroItem_(sub, solicitud, filtros) {
  if (filtros.desarrollador) {
    var asignado = sub.desarrollador_asignado || solicitud.desarrollador_asignado || '';
    if (asignado !== filtros.desarrollador) return false;
  }
  if (filtros.tipo && sub.tipo !== filtros.tipo) return false;
  if (filtros.desde && new Date(sub.fecha_creacion) < new Date(filtros.desde)) return false;
  if (filtros.hasta && new Date(sub.fecha_creacion) > new Date(filtros.hasta)) return false;
  return true;
}
