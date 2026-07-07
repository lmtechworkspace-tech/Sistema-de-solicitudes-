/**
 * Dashboard.gs — Dashboard.getData(filtros, contexto) (RF-017, §12.4 v1.0).
 *
 * Cache del dashboard vía CacheService (C-13, §5.5): los KPIs se
 * precalculan y se guardan en cache; si expiró (o nunca se calculó), esta
 * misma llamada cae a lectura directa de Sheets y repuebla el cache. No
 * hay una hoja DASHBOARD_CACHE (v1.1 la elimina explícitamente, §6).
 *
 * "Vista filtrada" del Desarrollador (§4.2, router; Actores §5 v1.0: "Ver
 * solicitudes asignadas a él"): usa `desarrollador_asignado` (Fase 6). Si
 * el Desarrollador no tiene ninguna solicitud asignada todavia, ve solo las
 * que estan en desarrollo activo (S04-S07) como respaldo -- para que el
 * dashboard no aparezca vacio antes de que exista asignacion real.
 */

var CACHE_TTL_SEGUNDOS = 300;
var ESTADOS_TRABAJO_DEV = [ESTADOS.S04, ESTADOS.S05, ESTADOS.S06, ESTADOS.S07];
var TOP_MODULOS_CANTIDAD = 5;
var MESES_TENDENCIA = 6;

var Dashboard = {
  getData: function (filtros, contexto) {
    var filtrosEfectivos = aplicarAmbitoRol_(filtros || {}, contexto);
    // La clave de cache incluye rol+email explicitos, no solo el JSON de
    // filtrosEfectivos: JSON.stringify omite claves con valor undefined
    // (p.ej. vistaDev:undefined si contexto.email faltara), lo que podria
    // colisionar la clave de un rol con la de otro.
    var claveCache = 'dashboard_kpis::' + (contexto ? contexto.rol + ':' + contexto.email : '') +
      '::' + JSON.stringify(filtrosEfectivos);

    var cache = CacheService.getScriptCache();
    var cacheado = cache.get(claveCache);
    if (cacheado) {
      return JSON.parse(cacheado);
    }

    var datos = calcularKpis_(filtrosEfectivos);
    cache.put(claveCache, JSON.stringify(datos), CACHE_TTL_SEGUNDOS);
    return datos;
  },

  // A-10 (Fase 7 la conecta a un trigger de tiempo): fuerza el recalculo
  // del dashboard sin filtros, refrescando el cache antes de que expire.
  refrescarCache: function () {
    var datos = calcularKpis_({});
    CacheService.getScriptCache().put('dashboard_kpis::{}', JSON.stringify(datos), CACHE_TTL_SEGUNDOS);
    return datos;
  }
};

function aplicarAmbitoRol_(filtros, contexto) {
  if (contexto && contexto.rol === 'DEV' && !filtros.estado) {
    return Object.assign({}, filtros, { vistaDev: contexto.email });
  }
  return filtros;
}

function calcularKpis_(filtros) {
  var feriados = obtenerFeriados_();

  // Para la vista del DEV hace falta saber, ANTES de filtrar, si alguna
  // subsolicitud (no solo la solicitud completa) esta asignada a el
  // (§13.3 v1.0: asignacion tambien existe por item).
  var idsAsignadosPorItem = {};
  if (filtros.vistaDev) {
    leerFilas_(SHEETS.SUBSOLICITUDES).forEach(function (sub) {
      if (sub.desarrollador_asignado === filtros.vistaDev) {
        idsAsignadosPorItem[sub.solicitud_id] = true;
      }
    });
  }

  var solicitudes = leerFilas_(SHEETS.SOLICITUDES).filter(function (s) {
    return coincideFiltros_(s, filtros, idsAsignadosPorItem);
  });
  var idsSolicitudes = {};
  solicitudes.forEach(function (s) { idsSolicitudes[s.solicitud_id] = true; });

  var subsolicitudes = leerFilas_(SHEETS.SUBSOLICITUDES).filter(function (sub) {
    return idsSolicitudes[sub.solicitud_id];
  });

  var historial = leerFilas_(SHEETS.HISTORIAL_ESTADOS).filter(function (h) {
    return idsSolicitudes[h.solicitud_id];
  });

  var abiertas = solicitudes.filter(function (s) {
    return ESTADOS_CERRADOS.indexOf(s.estado_derivado) === -1;
  });

  var hoy = claveDia_(new Date(), 'America/Santiago');

  return {
    resumen: {
      total_abiertas: abiertas.length,
      criticas_activas: abiertas.filter(function (s) { return s.prioridad_derivada === 'P1'; }).length,
      sla_vencido: subsolicitudes.filter(function (sub) { return estaVencidoSla_(sub, feriados); }).length,
      del_dia: solicitudes.filter(function (s) { return claveDia_(new Date(s.fecha_creacion), 'America/Santiago') === hoy; }).length
    },
    por_empresa: agruparYContar_(solicitudes, 'empresa_id'),
    por_plataforma: agruparYContar_(solicitudes, 'plataforma'),
    por_tipo: agruparYContar_(solicitudes, 'tipo'),
    por_estado: agruparYContar_(solicitudes, 'estado_derivado'),
    por_prioridad: agruparYContar_(solicitudes, 'prioridad_derivada'),
    top_modulos: topN_(agruparYContar_(solicitudes, 'modulo'), TOP_MODULOS_CANTIDAD),
    tiempo_promedio_resolucion_horas: tiempoPromedioResolucion_(solicitudes, historial, feriados),
    tendencia_mensual: tendenciaMensual_(solicitudes, historial, MESES_TENDENCIA),
    recientes: solicitudes
      .slice()
      .sort(function (a, b) { return new Date(b.fecha_creacion) - new Date(a.fecha_creacion); })
      .slice(0, 20)
      .map(function (s) {
        // Fase 10 (rediseno UX): Leo debe entender una solicitud en <10s
        // desde la fila, sin entrar al detalle -- cantidad de items y SLA
        // restante son los dos datos que mas faltaban.
        var itemsDeEstaSolicitud = subsolicitudes.filter(function (sub) { return sub.solicitud_id === s.solicitud_id; });
        return {
          solicitud_id: s.solicitud_id, empresa_id: s.empresa_id, plataforma: s.plataforma,
          modulo: s.modulo, estado_derivado: s.estado_derivado, prioridad_derivada: s.prioridad_derivada,
          fecha_creacion: s.fecha_creacion, asignado_a: s.desarrollador_asignado || '',
          cantidad_items: itemsDeEstaSolicitud.length,
          sla_restante_horas: slaRestanteHoras_(itemsDeEstaSolicitud, feriados)
        };
      })
  };
}

// Minimo (mas urgente) de horas habiles restantes de SLA entre los items
// activos de la solicitud; null si ninguno tiene SLA vigente (todos
// cerrados/excluidos o sin sla_objetivo_horas, ej. P5). Negativo = vencido.
function slaRestanteHoras_(items, feriados) {
  var restantes = items
    .filter(function (sub) {
      return ESTADOS_EXCLUIDOS_DERIVACION.indexOf(sub.estado) === -1 && sub.estado !== ESTADOS.S09 &&
        sub.sla_objetivo_horas !== '' && sub.sla_objetivo_horas !== undefined && sub.sla_objetivo_horas !== null;
    })
    .map(function (sub) {
      var transcurridas = Utils.horasHabilesEntre(sub.fecha_creacion, new Date(), { feriados: feriados });
      return Number(sub.sla_objetivo_horas) - transcurridas;
    });
  if (restantes.length === 0) return null;
  return Math.round(Math.min.apply(null, restantes) * 10) / 10;
}

function coincideFiltros_(solicitud, filtros, idsAsignadosPorItem) {
  if (filtros.empresa_id && solicitud.empresa_id !== filtros.empresa_id) return false;
  if (filtros.estado && solicitud.estado_derivado !== filtros.estado) return false;
  if (filtros.prioridad && solicitud.prioridad_derivada !== filtros.prioridad) return false;
  if (filtros.plataforma && solicitud.plataforma !== filtros.plataforma) return false;
  if (filtros.vistaDev) {
    // Asignado a nivel solicitud (rol "por defecto") o a nivel de alguna
    // subsolicitud puntual (§13.3 v1.0, trabajo en paralelo por item).
    var asignadaAMi = solicitud.desarrollador_asignado === filtros.vistaDev ||
      (idsAsignadosPorItem && idsAsignadosPorItem[solicitud.solicitud_id]);
    var activaSinAsignar = !solicitud.desarrollador_asignado && ESTADOS_TRABAJO_DEV.indexOf(solicitud.estado_derivado) !== -1;
    if (!asignadaAMi && !activaSinAsignar) return false;
  }
  return true;
}

function agruparYContar_(filas, campo) {
  var contadores = {};
  filas.forEach(function (fila) {
    var clave = fila[campo] || '(sin dato)';
    contadores[clave] = (contadores[clave] || 0) + 1;
  });
  return Object.keys(contadores).map(function (clave) {
    return { clave: clave, total: contadores[clave] };
  });
}

function topN_(agrupado, n) {
  return agrupado.slice().sort(function (a, b) { return b.total - a.total; }).slice(0, n);
}

function obtenerFeriados_() {
  return leerFilas_(SHEETS.CONFIG_FERIADOS).map(function (f) { return f.fecha; });
}

// §10/§7.4 (RN-019/020): vencida si ya supero su sla_objetivo_horas en
// horas habiles, sin contar subsolicitudes cerradas/rechazadas/canceladas
// ni las que ya llegaron a S09, ni las sin SLA (P5).
function estaVencidoSla_(subsolicitud, feriados) {
  if (ESTADOS_EXCLUIDOS_DERIVACION.indexOf(subsolicitud.estado) !== -1 || subsolicitud.estado === ESTADOS.S09) {
    return false;
  }
  if (subsolicitud.sla_objetivo_horas === '' || subsolicitud.sla_objetivo_horas === undefined || subsolicitud.sla_objetivo_horas === null) {
    return false;
  }
  var transcurridas = Utils.horasHabilesEntre(subsolicitud.fecha_creacion, new Date(), { feriados: feriados });
  return transcurridas > Number(subsolicitud.sla_objetivo_horas);
}

// Tiempo promedio (horas habiles) entre creacion y el momento en que la
// solicitud llego a S09 (Cerrada), tomado de HISTORIAL_ESTADOS -- no se
// agrega una columna fecha_cierre nueva (RECONCILIACION-v1.0.md).
function tiempoPromedioResolucion_(solicitudes, historial, feriados) {
  var tiempos = [];
  solicitudes.forEach(function (solicitud) {
    if (solicitud.estado_derivado !== ESTADOS.S09) return;
    var cierres = historial.filter(function (h) {
      return h.solicitud_id === solicitud.solicitud_id && h.estado_nuevo === ESTADOS.S09;
    });
    if (cierres.length === 0) return;
    var fechaCierre = cierres.reduce(function (masReciente, h) {
      return new Date(h.timestamp) > new Date(masReciente) ? h.timestamp : masReciente;
    }, cierres[0].timestamp);
    tiempos.push(Utils.horasHabilesEntre(solicitud.fecha_creacion, fechaCierre, { feriados: feriados }));
  });
  if (tiempos.length === 0) return 0;
  var suma = tiempos.reduce(function (acc, t) { return acc + t; }, 0);
  return Math.round((suma / tiempos.length) * 10) / 10;
}

function tendenciaMensual_(solicitudes, historial, meses) {
  var ahora = new Date();
  var claves = [];
  for (var i = meses - 1; i >= 0; i--) {
    var fecha = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
    claves.push(fecha.getFullYear() + '-' + ('0' + (fecha.getMonth() + 1)).slice(-2));
  }

  var ingresadasPorMes = {};
  solicitudes.forEach(function (s) {
    var clave = claveMes_(s.fecha_creacion);
    ingresadasPorMes[clave] = (ingresadasPorMes[clave] || 0) + 1;
  });

  var resueltasPorMes = {};
  historial.filter(function (h) { return h.estado_nuevo === ESTADOS.S09; }).forEach(function (h) {
    var clave = claveMes_(h.timestamp);
    resueltasPorMes[clave] = (resueltasPorMes[clave] || 0) + 1;
  });

  return claves.map(function (clave) {
    return { mes: clave, ingresadas: ingresadasPorMes[clave] || 0, resueltas: resueltasPorMes[clave] || 0 };
  });
}

function claveMes_(fechaIso) {
  var fecha = new Date(fechaIso);
  return fecha.getFullYear() + '-' + ('0' + (fecha.getMonth() + 1)).slice(-2);
}
