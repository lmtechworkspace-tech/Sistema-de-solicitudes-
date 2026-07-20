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
 * v4.1 (documentacion/SIGSO-v4.1-propuestas-panel-gerencia.md, G1/G2/G3/G4/
 * G6/G7 aprobadas): Gerencia pidio ver el CONTENIDO de la solicitud en el
 * tablero (no solo el proceso) y mas informacion para decidir. Se agrega:
 *  - G1: descripcion/resultado_esperado/plataforma_nombre/area_nombre en
 *    cada item (ya existian en la hoja, solo faltaba exponerlos).
 *  - G2: recurrencia por Modulo x Tipo (para detectar que se repite).
 *  - G3: tendencia mensual (creadas/cerradas/cumplimiento) ultimos 6 meses.
 *  - G4: tiempo de ciclo promedio por etapa (donde se atasca el flujo).
 *  - G6: carga por empresa/plataforma/area.
 *  - G7: cada KPI de la banda superior con su delta vs el periodo anterior.
 * Nada de esto toca el esquema: todos los campos ya existian.
 *
 * Reutiliza coincideFiltros_ (Dashboard.gs) para los filtros que ya existen
 * (empresa/solicitante/prioridad/estado) y le agrega los propios de este
 * panel (desarrollador, tipo, periodo) -- todo vive en el mismo scope global
 * (Apps Script concatena los .gs de un proyecto), no hace falta importarlo.
 */

// v3.0 (Fase 1, robustez): mismo TTL de cache que el Dashboard (§5.5, C-13).
// Antes getPanel releia TODAS las hojas en cada llamada sin cache -- al
// crecer las filas esa llamada se hacia pesada y disparaba el error "se
// perdio la conexion con Apps Script" al navegar el Panel de Gerencia.
var GERENCIA_CACHE_TTL_SEGUNDOS = 300;

// v4.1 (G7/G2/G3): ventana por defecto para "periodo actual vs anterior"
// cuando Gerencia no eligio fechas explicitas -- 30 dias corridos es un
// ciclo de gestion razonable (mensual) sin depender de que exista un
// selector de fecha en la UI todavia.
var GERENCIA_DIAS_VENTANA_DEFECTO = 30;

var Gerencia = {
  getPanel: function (filtros, contexto) {
    var filtrosBase = filtros || {};

    // Cache por filtros (Gerencia/ADM son solo lectura; el rol no cambia el
    // contenido, asi que no hace falta meterlo en la clave). Si expiro o
    // nunca se calculo, cae a la lectura completa de abajo y repuebla.
    var claveCache = 'gerencia_panel::' + JSON.stringify(filtrosBase);
    var cache = CacheService.getScriptCache();
    var cacheado = cache.get(claveCache);
    if (cacheado) {
      return JSON.parse(cacheado);
    }
    var datos = calcularPanelGerencia_(filtrosBase);
    // JSON grande: CacheService limita cada valor a 100 KB. Si el panel no
    // cabe (muchisimos items), se omite el cache y se sirve directo -- nunca
    // se rompe por intentar guardar algo demasiado grande.
    try {
      cache.put(claveCache, JSON.stringify(datos), GERENCIA_CACHE_TTL_SEGUNDOS);
    } catch (err) {
      // valor demasiado grande para el cache: se sirve sin cachear.
    }
    return datos;
  }
};

function calcularPanelGerencia_(filtrosBase) {
    var feriados = obtenerFeriados_();

    var solicitudes = leerFilas_(SHEETS.SOLICITUDES).filter(function (s) {
      return coincideFiltros_(s, filtrosBase, {});
    });
    var solicitudPorId = {};
    solicitudes.forEach(function (s) { solicitudPorId[s.solicitud_id] = s; });

    var historialCompromiso = leerFilas_(SHEETS.HISTORIAL_COMPROMISO);
    var lineasBase = lineaBasePorItem_(historialCompromiso);
    var reCompromisosPorItem = contarPorSubsolicitud_(historialCompromiso);

    // v4.1 (G2/G4): HISTORIAL_ESTADOS ya se leia en otras pantallas pero no
    // aca -- da las reaperturas (G2, "se cerro y volvio a abrirse") y el
    // tiempo de ciclo por etapa (G4, "donde se atasca"). Lectura tolerante
    // (mismo criterio que mapaNombresUsuarios_): sin la hoja, G2/G4 quedan
    // en cero en vez de tumbar todo el panel.
    var historialEstados = leerFilasSeguro_(SHEETS.HISTORIAL_ESTADOS);
    var reaperturasPorSub = contarReaperturasPorSubsolicitud_(historialEstados);

    var ahora = new Date();
    var nombrePorEmail = mapaNombresUsuarios_();

    // v3.1 (§1.6): las atenciones directas quedan FUERA del semaforo de
    // cumplimiento. Nunca tuvieron fecha comprometida (se resolvieron antes
    // de existir en el sistema), asi que medirlas contra un compromiso que no
    // existio no significa nada: entrarian todas como SIN_COMPROMISO e
    // inflarian esa categoria sin que haya nada que corregir. Se reportan
    // aparte, en su propio contador.
    var atencionesDirectas = solicitudes.filter(esAtencionDirecta_).length;

    var items = leerFilas_(SHEETS.SUBSOLICITUDES)
      .filter(function (sub) {
        var solicitud = solicitudPorId[sub.solicitud_id];
        return solicitud && !esAtencionDirecta_(solicitud) &&
          coincideFiltroItem_(sub, solicitud, filtrosBase);
      })
      .map(function (sub) {
        var solicitud = solicitudPorId[sub.solicitud_id];
        var cumplimiento = Cumplimiento.clasificar(sub, ahora);
        var cerrada = ESTADOS_CERRADOS.indexOf(sub.estado) !== -1;
        return {
          subsolicitud_id: sub.subsolicitud_id,
          solicitud_id: sub.solicitud_id,
          titulo: sub.titulo,
          numero_item: sub.numero_item,
          empresa_id: solicitud.empresa_id,
          // v4.1 (G6): nombre de plataforma/area para el desglose de carga
          // (ya viven en la fila, sin ellos "por plataforma" solo tendria
          // el codigo interno).
          plataforma_nombre: solicitud.plataforma_nombre || solicitud.plataforma || '',
          area_nombre: sub.area_nombre || sub.area || '',
          tipo_nombre: sub.tipo_nombre || sub.tipo || '',
          modulo_nombre: sub.modulo_nombre || sub.modulo || '',
          // v4.1 (G1): el contenido de la solicitud -- "¿Que pasa?" siempre
          // existe (obligatorio en ambos modos del formulario); "¿Que
          // deberia pasar?" solo si se lleno en modo Completo.
          descripcion: sub.descripcion || '',
          resultado_esperado: sub.resultado_esperado || '',
          estado: sub.estado,
          prioridad: sub.prioridad,
          es_cliente: !!solicitud.es_cliente,
          desarrollador_asignado: sub.desarrollador_asignado || solicitud.desarrollador_asignado || '',
          // UI-1 (§6): nombre legible del responsable para el tablero (el
          // correo sigue disponible en desarrollador_asignado).
          desarrollador_nombre: nombrePorEmail[sub.desarrollador_asignado || solicitud.desarrollador_asignado || ''] || '',
          solicitante_nombre: solicitud.solicitante_nombre,
          solicitante_email: solicitud.solicitante_email,
          fecha_creacion: sub.fecha_creacion,
          fecha_comprometida: sub.fecha_comprometida || '',
          fecha_terminada: sub.fecha_terminada || '',
          // §7C: la "fecha original" (linea base, antes del primer
          // re-compromiso) hace visible el resbalon en la carta Gantt.
          fecha_original: lineasBase[sub.subsolicitud_id] || sub.fecha_comprometida || '',
          re_compromisos: reCompromisosPorItem[sub.subsolicitud_id] || 0,
          // v4.1 (G2): cuantas veces este item se cerro y volvio a abrirse --
          // la medida de "se entrego mal", que el % de cumplimiento (que
          // solo mira la fecha) no captura.
          reaperturas: reaperturasPorSub[sub.subsolicitud_id] || 0,
          cumplimiento: cumplimiento,
          // v3.0 (Fase 4, §6.1): columnas del tablero de seguimiento -- se
          // calculan aca (no en el frontend) para que ordenar/agrupar por
          // ellas no dependa de recalcular fechas en el navegador.
          dias_abierta: diasHabilesRedondeado_(
            sub.fecha_creacion,
            cerrada ? (sub.fecha_terminada || sub.fecha_creacion) : ahora
          ),
          // Reloj del desarrollador (Cumplimiento.gs): solo corre desde que
          // hay fecha_comprometida -- antes de eso el item sigue "sin
          // comprometer" y no tiene sentido medirlo.
          dias_desarrollador: sub.fecha_comprometida
            ? diasHabilesRedondeado_(sub.fecha_comprometida, sub.fecha_terminada || (cerrada ? sub.fecha_comprometida : ahora))
            : null,
          // v3.0 (Fase 4, §6.2): semaforo PROPIO del solicitante (distinto
          // del semaforo de cumplimiento, que es del desarrollador) -- solo
          // aplica mientras el item esta Terminada esperando su validacion.
          semaforo_solicitante: semaforoSolicitante_(cumplimiento)
        };
      });

    // v4.1 (G2/G7): ventana de comparacion "periodo actual vs anterior".
    // Se recorta del mismo conjunto `items` (ya filtrado por empresa/tipo/
    // desarrollador/solicitante) por fecha_creacion -- si Gerencia no eligio
    // fechas, cae a los ultimos 30 dias vs los 30 anteriores a esos.
    var ventana = resolverVentanaPeriodo_(filtrosBase);
    var itemsVentanaActual = items.filter(function (i) {
      return dentroDeRango_(i.fecha_creacion, ventana.desde, ventana.hasta);
    });
    var itemsVentanaAnterior = items.filter(function (i) {
      return dentroDeRango_(i.fecha_creacion, ventana.desdeAnterior, ventana.hastaAnterior);
    });

    var kpis = calcularKpisGerencia_(items);
    // v4.1 (G7): cada KPI de la banda superior con su delta vs el periodo
    // anterior -- "100% de cumplimiento" no dice si veniamos de 60% o de
    // 100%, este numero si.
    kpis.comparativo = calcularComparativoKpis_(itemsVentanaActual, itemsVentanaAnterior);

    return {
      kpis: kpis,
      items: items,
      // v3.1 (§1.6): no entran al semaforo, pero Gerencia necesita saber
      // cuantas hubo -- es la medida de cuanto trabajo se esta resolviendo
      // fuera del proceso.
      atenciones_directas: atencionesDirectas,
      // v4.1 (G2): ranking Modulo x Tipo -- responde "que se nos repite" (la
      // pregunta que Gerencia hizo explicita), no solo "que hay".
      recurrencia: calcularRecurrencia_(itemsVentanaActual, itemsVentanaAnterior),
      // v4.1 (G3): panorama de 6 meses -- los KPIs de arriba son una foto,
      // esto dice si la tendencia mejora o empeora.
      tendencia: calcularTendenciaTemporal_(items),
      // v4.1 (G4): tiempo de ciclo por etapa -- donde se va el tiempo, no
      // solo cuanto tiempo lleva abierta.
      ciclo_por_etapa: calcularCicloPorEtapa_(items, historialEstados),
      // v4.1 (G6): distribucion de carga -- que sistema/area consume mas
      // solicitudes, insumo para decidir donde invertir.
      carga: calcularCarga_(items),
      ventana: {
        desde: ventana.desde.toISOString(),
        hasta: ventana.hasta.toISOString(),
        desde_anterior: ventana.desdeAnterior.toISOString(),
        hasta_anterior: ventana.hastaAnterior.toISOString()
      }
    };
}

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

// v4.1 (G7): delta simple (actual - anterior) por KPI. null si cualquiera de
// los dos lados no tiene dato (ej. pct_cumplimiento sin entregados) -- un
// delta contra null no significa nada y el frontend lo pinta como "—".
function calcularComparativoKpis_(itemsActuales, itemsAnteriores) {
  var actual = calcularKpisGerencia_(itemsActuales);
  var anterior = calcularKpisGerencia_(itemsAnteriores);
  function delta_(a, b) {
    if (a === null || a === undefined || b === null || b === undefined) return null;
    return Math.round((a - b) * 10) / 10;
  }
  return {
    pct_cumplimiento_desarrollador: delta_(actual.pct_cumplimiento_desarrollador, anterior.pct_cumplimiento_desarrollador),
    atrasadas_activas: delta_(actual.atrasadas_activas, anterior.atrasadas_activas),
    esperando_validacion: delta_(actual.esperando_validacion, anterior.esperando_validacion),
    atraso_promedio_dias: delta_(actual.atraso_promedio_dias, anterior.atraso_promedio_dias),
    sin_comprometer: delta_(actual.sin_comprometer, anterior.sin_comprometer)
  };
}

// v4.1 (G2): ranking Modulo x Tipo -- cuenta, % del total, tendencia (delta
// de cantidad vs el mismo grupo en el periodo anterior), dias promedio de
// resolucion (solo items cerrados) y reaperturas acumuladas del grupo.
// Ordenado de mayor a menor cantidad: lo que mas se repite queda primero.
function calcularRecurrencia_(itemsActuales, itemsAnteriores) {
  function claveGrupo_(i) {
    return (i.modulo_nombre || '(sin módulo)') + '␟' + (i.tipo_nombre || '(sin tipo)');
  }
  function agrupar_(items) {
    var grupos = {};
    items.forEach(function (i) {
      var clave = claveGrupo_(i);
      if (!grupos[clave]) grupos[clave] = [];
      grupos[clave].push(i);
    });
    return grupos;
  }
  var gruposActuales = agrupar_(itemsActuales);
  var gruposAnteriores = agrupar_(itemsAnteriores);
  var total = itemsActuales.length;

  return Object.keys(gruposActuales).map(function (clave) {
    var partes = clave.split('␟');
    var filas = gruposActuales[clave];
    var cerrados = filas.filter(function (i) {
      return ESTADOS_CERRADOS.indexOf(i.estado) !== -1 && i.fecha_terminada;
    });
    var diasResolucion = cerrados
      .map(function (i) { return i.dias_abierta; })
      .filter(function (d) { return d !== null && d !== undefined; });
    var reaperturas = filas.reduce(function (acc, i) { return acc + (i.reaperturas || 0); }, 0);
    var cantidadAnterior = (gruposAnteriores[clave] || []).length;

    return {
      modulo_nombre: partes[0],
      tipo_nombre: partes[1],
      cantidad: filas.length,
      pct_total: total === 0 ? 0 : Math.round((filas.length / total) * 1000) / 10,
      tendencia: filas.length - cantidadAnterior,
      dias_promedio_resolucion: diasResolucion.length === 0 ? null : promedio_(diasResolucion),
      reaperturas: reaperturas
    };
  }).sort(function (a, b) { return b.cantidad - a.cantidad; });
}

// v4.1 (G3): panorama mensual de los ultimos 6 meses -- creadas vs cerradas
// (si la brecha crece, la deuda esta creciendo) y % de cumplimiento por mes
// (si mejora o empeora en el tiempo, no solo el numero de hoy).
function calcularTendenciaTemporal_(items) {
  var MESES_VENTANA = 6;
  var ahora = new Date();
  var buckets = [];
  for (var i = MESES_VENTANA - 1; i >= 0; i--) {
    var fechaBucket = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
    buckets.push({
      anio: fechaBucket.getFullYear(),
      mes: fechaBucket.getMonth(),
      etiqueta: fechaBucket.toLocaleDateString('es-CL', { month: 'short', year: '2-digit' }),
      creadas: 0,
      cerradas: 0,
      entregados: 0,
      entregadosATiempo: 0
    });
  }
  function bucketDe_(fechaIso) {
    var f = new Date(fechaIso);
    for (var j = 0; j < buckets.length; j++) {
      if (buckets[j].anio === f.getFullYear() && buckets[j].mes === f.getMonth()) return buckets[j];
    }
    return null; // fuera de la ventana de 6 meses: no se grafica, no se descarta el item de otros calculos.
  }

  items.forEach(function (i) {
    var bCreacion = bucketDe_(i.fecha_creacion);
    if (bCreacion) bCreacion.creadas++;
    if (i.fecha_terminada) {
      var bCierre = bucketDe_(i.fecha_terminada);
      if (bCierre) {
        bCierre.cerradas++;
        if (i.fecha_comprometida) {
          bCierre.entregados++;
          if (new Date(i.fecha_terminada) <= new Date(i.fecha_comprometida)) bCierre.entregadosATiempo++;
        }
      }
    }
  });

  return buckets.map(function (b) {
    return {
      etiqueta: b.etiqueta,
      creadas: b.creadas,
      cerradas: b.cerradas,
      pct_cumplimiento: b.entregados === 0 ? null : Math.round((b.entregadosATiempo / b.entregados) * 1000) / 10
    };
  });
}

// v4.1 (G4): tiempo de ciclo promedio por cada transicion "canonica"
// (S01→S02, S02→S03, ..., S08→S09). Usa la PRIMERA vez que cada
// subsolicitud entro a cada estado (no cada rebote), para que un item que
// vuelve y avanza varias veces no infle el promedio con ruido -- es "cuanto
// tardo en llegar de una etapa a la siguiente la primera vez", que es lo que
// responde "donde se atasca el flujo".
function calcularCicloPorEtapa_(items, historialEstados) {
  var primeraVezPorSub = {};
  historialEstados.forEach(function (h) {
    if (!h.subsolicitud_id || !h.estado_nuevo) return;
    if (!primeraVezPorSub[h.subsolicitud_id]) primeraVezPorSub[h.subsolicitud_id] = {};
    var actual = primeraVezPorSub[h.subsolicitud_id][h.estado_nuevo];
    if (!actual || new Date(h.timestamp) < new Date(actual)) {
      primeraVezPorSub[h.subsolicitud_id][h.estado_nuevo] = h.timestamp;
    }
  });

  var idsRelevantes = {};
  items.forEach(function (i) { idsRelevantes[i.subsolicitud_id] = true; });

  var acumulado = {};
  for (var idx = 0; idx < ORDEN_ESTADOS.length - 1; idx++) {
    acumulado[ORDEN_ESTADOS[idx] + '_' + ORDEN_ESTADOS[idx + 1]] = { suma: 0, cuenta: 0 };
  }

  Object.keys(primeraVezPorSub).forEach(function (subId) {
    if (!idsRelevantes[subId]) return;
    var porEstado = primeraVezPorSub[subId];
    for (var i = 0; i < ORDEN_ESTADOS.length - 1; i++) {
      var desde = ORDEN_ESTADOS[i];
      var hasta = ORDEN_ESTADOS[i + 1];
      if (!porEstado[desde] || !porEstado[hasta]) continue;
      var dias = diasHabilesRedondeado_(porEstado[desde], porEstado[hasta]);
      if (dias < 0) continue; // dato sucio (timestamps invertidos): se ignora, no se resta.
      var clave = desde + '_' + hasta;
      acumulado[clave].suma += dias;
      acumulado[clave].cuenta += 1;
    }
  });

  return ORDEN_ESTADOS.slice(0, -1).map(function (desde, i) {
    var hasta = ORDEN_ESTADOS[i + 1];
    var bucket = acumulado[desde + '_' + hasta];
    return {
      estado_desde: desde,
      estado_hasta: hasta,
      dias_promedio: bucket.cuenta === 0 ? null : Math.round((bucket.suma / bucket.cuenta) * 10) / 10,
      muestras: bucket.cuenta
    };
  });
}

// v4.1 (G6): distribucion de carga por empresa/plataforma/area -- responde
// "que sistema nos consume mas equipo", insumo para decidir donde invertir.
// Ordenado de mayor a menor para que el mayor consumidor quede primero.
function calcularCarga_(items) {
  function agruparPorCampo_(campo, etiquetaVacia) {
    var conteo = {};
    items.forEach(function (i) {
      var clave = i[campo] || etiquetaVacia;
      conteo[clave] = (conteo[clave] || 0) + 1;
    });
    return Object.keys(conteo).map(function (clave) {
      return { etiqueta: clave, cantidad: conteo[clave] };
    }).sort(function (a, b) { return b.cantidad - a.cantidad; });
  }
  return {
    por_empresa: agruparPorCampo_('empresa_id', '(sin dato)'),
    por_plataforma: agruparPorCampo_('plataforma_nombre', '(sin dato)'),
    por_area: agruparPorCampo_('area_nombre', '(sin área)')
  };
}

// v4.1 (G2): reaperturas -- un item que se cerro (ESTADOS_CERRADOS) y volvio
// a un estado NO cerrado. Es la medida de "se entrego mal": el % de
// cumplimiento (que solo mira la fecha) no la captura, un cierre rapido
// pero que se reabre 3 veces igual cuenta como "a tiempo" ahi.
function contarReaperturasPorSubsolicitud_(historialEstados) {
  var contadores = {};
  historialEstados.forEach(function (h) {
    if (!h.subsolicitud_id) return;
    var veniaDeCerrado = ESTADOS_CERRADOS.indexOf(h.estado_anterior) !== -1;
    var siguioAbierto = ESTADOS_CERRADOS.indexOf(h.estado_nuevo) === -1;
    if (veniaDeCerrado && siguioAbierto) {
      contadores[h.subsolicitud_id] = (contadores[h.subsolicitud_id] || 0) + 1;
    }
  });
  return contadores;
}

// v4.1 (G2/G7): resuelve la ventana "periodo actual" (de filtros.desde/
// hasta si Gerencia los eligio, o los ultimos 30 dias por defecto) y la
// ventana "periodo anterior" (misma duracion, inmediatamente antes).
function resolverVentanaPeriodo_(filtrosBase) {
  var hasta = filtrosBase.hasta ? new Date(filtrosBase.hasta) : new Date();
  var desde = filtrosBase.desde
    ? new Date(filtrosBase.desde)
    : new Date(hasta.getTime() - GERENCIA_DIAS_VENTANA_DEFECTO * 24 * 3600 * 1000);
  var duracionMs = Math.max(hasta.getTime() - desde.getTime(), 0);
  var hastaAnterior = new Date(desde.getTime());
  var desdeAnterior = new Date(desde.getTime() - duracionMs);
  return { desde: desde, hasta: hasta, desdeAnterior: desdeAnterior, hastaAnterior: hastaAnterior };
}

function dentroDeRango_(fechaIso, desde, hasta) {
  if (!fechaIso) return false;
  var t = new Date(fechaIso).getTime();
  return t >= desde.getTime() && t <= hasta.getTime();
}

// UI-1 (§6): email -> nombre desde USUARIOS, tolerante a hoja ausente
// (tests/instalaciones frescas), mismo criterio que obtenerResponsablesActivos_.
function mapaNombresUsuarios_() {
  var filas;
  try {
    filas = leerFilas_(SHEETS.USUARIOS);
  } catch (err) {
    return {};
  }
  var mapa = {};
  filas.forEach(function (u) {
    if (u.email && u.nombre) mapa[u.email] = u.nombre;
  });
  return mapa;
}

function promedio_(numeros) {
  if (numeros.length === 0) return 0;
  var suma = numeros.reduce(function (acc, n) { return acc + n; }, 0);
  return Math.round((suma / numeros.length) * 10) / 10;
}

// v3.0 (Fase 4, §6.1): dias habiles entre dos fechas, redondeado a 1
// decimal (mismo criterio que Cumplimiento.gs) -- para las columnas "Dias
// abierta" / "Dias con el desarrollador" del tablero de seguimiento.
function diasHabilesRedondeado_(inicio, fin) {
  return Math.round((Utils.horasHabilesEntre(inicio, fin) / CUMPLIMIENTO_HORAS_JORNADA) * 10) / 10;
}

// v3.0 (Fase 4, §6.2): semaforo PROPIO del solicitante -- separado del
// semaforo de cumplimiento (que mide al desarrollador). Solo aplica
// mientras el item esta Terminada esperando validacion (ESPERANDO_
// VALIDACION); en cualquier otro estado no le corresponde a el todavia
// (o ya paso, si esta cerrada). Mismo umbral que el cierre automatico
// (RN-201, DIAS_HABILES_CIERRE_AUTOMATICO, Triggers.gs) para que "cerca
// del cierre" signifique lo mismo en todas partes del sistema.
function semaforoSolicitante_(cumplimiento) {
  if (cumplimiento.codigo !== 'ESPERANDO_VALIDACION') {
    return null;
  }
  var dias = cumplimiento.dias_esperando || 0;
  if (dias < 1) {
    return { codigo: 'RECIEN_ENTREGADO', emoji: '🟢', texto: 'Recién entregado' };
  }
  if (dias < DIAS_HABILES_CIERRE_AUTOMATICO) {
    return { codigo: 'ESPERANDO', emoji: '🟡', texto: 'Esperando validación' };
  }
  return { codigo: 'CERCA_CIERRE_AUTOMATICO', emoji: '🔴', texto: 'Cerca del cierre automático' };
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
