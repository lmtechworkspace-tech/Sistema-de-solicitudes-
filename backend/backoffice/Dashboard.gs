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
var RECIENTES_LIMITE = 50;

// P7 (v2.0, Sprint 3): umbral de "patron" -- "veo un error... con distintos
// [usuarios]... si se repite con distintos en distintas empresas, no es un
// caso aislado, hay un problema en el codigo". Conservador a proposito
// (RN de la propuesta): mejor perder algun patron real al principio que
// saturar con falsos positivos por modulos mal parametrizados.
var PATRON_VENTANA_DIAS = 7;
var PATRON_CANTIDAD_MINIMA = 3;
var PATRON_SOLICITANTES_MINIMOS = 2;

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
    // v2.1 (Fase C): rol_actual viaja en la respuesta (no en el cache -- la
    // clave de cache ya incluye rol+email, pero se agrega despues de leer
    // para no depender de una llamada aparte solo para conocer el rol) --
    // el frontend lo usa para decidir si ofrece el Panel de Gerencia.
    if (cacheado) {
      var datosCacheados = JSON.parse(cacheado);
      datosCacheados.rol_actual = contexto ? contexto.rol : '';
      // v3.0 (Fase 2): igual que rol_actual, se agrega DESPUES del cache --
      // no depende de los filtros/resultados cacheados, solo de USUARIOS.
      agregarResponsablesSiCorresponde_(datosCacheados, contexto);
      return datosCacheados;
    }

    var datos = calcularKpis_(filtrosEfectivos);
    cache.put(claveCache, JSON.stringify(datos), CACHE_TTL_SEGUNDOS);
    datos.rol_actual = contexto ? contexto.rol : '';
    agregarResponsablesSiCorresponde_(datos, contexto);
    return datos;
  },

  // A-10 (Fase 7 la conecta a un trigger de tiempo): fuerza el recalculo
  // del dashboard sin filtros, refrescando el cache antes de que expire.
  refrescarCache: function () {
    var datos = calcularKpis_({});
    CacheService.getScriptCache().put('dashboard_kpis::{}', JSON.stringify(datos), CACHE_TTL_SEGUNDOS);
    return datos;
  },

  // v5.2 (Fase B, §3.4): "pauta de trabajo por lote" -- TODOS los items
  // abiertos de un desarrollador, para imprimir UNA sola hoja en vez de una
  // Orden de Trabajo suelta por solicitud. A diferencia de `recientes` (que
  // getData ya arma), esto es a nivel de ITEM (subsolicitud), con los mismos
  // campos que ya usa la OT individual (detalle.js: renderOtImprimir_) --
  // getData no los trae porque es un resumen por SOLICITUD, no por item.
  getPautaDesarrollador: function (data, contexto) {
    var desarrollador = data && data.desarrollador;
    if (!desarrollador) {
      return errorValidacion_('desarrollador', 'Falta indicar el desarrollador.');
    }
    var solicitudPorId = {};
    leerFilas_(SHEETS.SOLICITUDES).forEach(function (s) { solicitudPorId[s.solicitud_id] = s; });

    var items = leerFilas_(SHEETS.SUBSOLICITUDES)
      .filter(function (sub) {
        var solicitud = solicitudPorId[sub.solicitud_id];
        if (!solicitud) return false;
        var asignado = sub.desarrollador_asignado || solicitud.desarrollador_asignado || '';
        return asignado === desarrollador && ESTADOS_CERRADOS.indexOf(sub.estado) === -1;
      })
      .map(function (sub) {
        var solicitud = solicitudPorId[sub.solicitud_id];
        return {
          // v5.2 (Fase D, §5): la sesion de planificacion necesita el ID real
          // del item para poder llamar Solicitudes.comprometerFecha por fila
          // -- getPautaDesarrollador es la unica fuente de este listado, no
          // tenia por que traerlo antes de que hiciera falta escribir.
          subsolicitud_id: sub.subsolicitud_id,
          solicitud_id: sub.solicitud_id,
          numero_item: sub.numero_item,
          titulo: sub.titulo,
          descripcion: sub.descripcion,
          resultado_esperado: sub.resultado_esperado || '',
          prioridad: sub.prioridad,
          estado: sub.estado,
          fecha_comprometida: sub.fecha_comprometida || '',
          url_modulo: sub.url_modulo || '',
          usuario_prueba: sub.usuario_prueba || '',
          ref_credencial: sub.ref_credencial || '',
          empresa_nombre: solicitud.empresa_nombre || solicitud.empresa_id,
          solicitante_nombre: solicitud.solicitante_nombre
        };
      })
      // P1 primero; a igual prioridad, quien tiene fecha comprometida mas
      // proxima primero (sin fecha, al final del grupo) -- el orden en que
      // Leo deberia atacarlas, no el orden de creacion.
      .sort(function (a, b) {
        if (a.prioridad !== b.prioridad) return a.prioridad.localeCompare(b.prioridad);
        if (!a.fecha_comprometida) return 1;
        if (!b.fecha_comprometida) return -1;
        return new Date(a.fecha_comprometida) - new Date(b.fecha_comprometida);
      });

    return { desarrollador: desarrollador, items: items };
  }
};

function aplicarAmbitoRol_(filtros, contexto) {
  if (!contexto) {
    return filtros;
  }
  // v3.0 (Fase 2, refuerzo de acceso): el auto-scope de un responsable
  // individual (Gestor tecnico) a su propia bandeja ya NO se cancela si
  // ademas filtra por estado -- antes "!filtros.estado" dejaba ver TODAS
  // las solicitudes de cualquier estado con solo agregar ese filtro, lo que
  // contradice "cada responsable ve solo lo suyo" (documentacion/SIGSO-
  // v3.0-multi-responsable-y-control.md §5).
  //
  // v4.1.1 (hallazgo real: Gerencia con modulo "bandeja" veia TODAS las
  // solicitudes ahi, no solo las suyas). Solo ADM ve la bandeja completa
  // sin acotar por defecto. Cualquier otro rol (DEV, ANA, GERENCIA...)
  // queda SIEMPRE auto-acotado a su propia bandeja en "Bandeja de trabajo"
  // -- ignorando incluso un eventual filtros.verBandeja, porque ese
  // selector ya no se le ofrece a nadie fuera de ADM (ver
  // agregarResponsablesSiCorresponde_). Gerencia sigue viendo TODAS las
  // solicitudes desde el Panel de Gerencia (Gerencia.getPanel), que es una
  // vista de solo lectura aparte y no se toca aca.
  if (contexto.rol !== 'ADM') {
    var filtrosAcotados = Object.assign({}, filtros, { vistaDev: contexto.email });
    // coincideFiltros_ tiene un respaldo pensado para el DEV (§4.2): si
    // todavia no tiene nada asignado, ve las solicitudes activas sin
    // asignar (S04-S07) de CUALQUIERA, para que su bandeja no se vea vacia
    // antes de que exista asignacion real. Ese respaldo NO debe aplicar a
    // los demas roles auto-acotados (GERENCIA, ANA...): sin nada asignado,
    // terminarian viendo igual todas las solicitudes activas sin
    // responsable de todo el mundo -- el mismo bug que se esta
    // corrigiendo, solo que por otra puerta.
    if (contexto.rol !== 'DEV') {
      filtrosAcotados.sinRespaldoHuerfanas = true;
    }
    return filtrosAcotados;
  }
  // ADM: por defecto ve todo (sin acotar); si elige una bandeja puntual
  // desde el selector "¿Que bandeja ver?" del Dashboard, se acota a esa
  // persona -- mismo mecanismo de filtrado (vistaDev) que ya usa
  // coincideFiltros_ para el auto-scope del Desarrollador.
  if (filtros.verBandeja) {
    return Object.assign({}, filtros, { vistaDev: filtros.verBandeja });
  }
  return filtros;
}

// v4.1.1: solo ADM ve el selector de bandeja -- es el unico perfil que
// puede mirar la bandeja de otra persona. Gerencia ya no aparece aca: su
// bandeja de trabajo quedo auto-acotada a la propia (aplicarAmbitoRol_) y
// para ver el resto de las solicitudes tiene el Panel de Gerencia, no este
// selector.
function agregarResponsablesSiCorresponde_(datos, contexto) {
  if (contexto && contexto.rol === 'ADM') {
    datos.responsables = obtenerResponsablesActivos_();
  }
}

// Personas que pueden tener una bandeja propia (Gestor/Analista o Gestor
// tecnico, activos) -- son quienes CAT_AREAS.responsable_email puede
// apuntar. ADM/GERENCIA no aparecen: no son destino de ruteo, son quienes
// consultan la bandeja de otros.
function obtenerResponsablesActivos_() {
  var filas;
  try {
    filas = leerFilas_(SHEETS.USUARIOS);
  } catch (err) {
    return [];
  }
  return filas
    .filter(function (u) {
      var activo = u.activo === true || u.activo === 'TRUE' || u.activo === 1;
      return activo && (u.rol === 'DEV' || u.rol === 'ANA');
    })
    .map(function (u) { return { email: u.email, nombre: u.nombre || u.email }; })
    .sort(function (a, b) { return a.nombre.localeCompare(b.nombre); });
}

function calcularKpis_(filtros) {
  var feriados = obtenerFeriados_();

  // SUBSOLICITUDES se lee UNA sola vez y se reusa (antes se leia dos veces:
  // para el auto-scope del DEV y para el detalle de las recientes). Cada
  // lectura es una operacion cara sobre Sheets.
  var todasSubsolicitudes = leerFilas_(SHEETS.SUBSOLICITUDES);

  // Para la vista del DEV hace falta saber, ANTES de filtrar, si alguna
  // subsolicitud (no solo la solicitud completa) esta asignada a el
  // (§13.3 v1.0: asignacion tambien existe por item).
  var idsAsignadosPorItem = {};
  if (filtros.vistaDev) {
    todasSubsolicitudes.forEach(function (sub) {
      if (sub.desarrollador_asignado === filtros.vistaDev) {
        idsAsignadosPorItem[sub.solicitud_id] = true;
      }
    });
  }

  // v6.3: indice de titulos por solicitud, para que la busqueda del servidor
  // pueda mirar el TITULO del item (que vive en SUBSOLICITUDES) y no solo los
  // campos de SOLICITUDES. Se arma sobre la lectura de SUBSOLICITUDES que ya
  // esta en memoria -- misma tecnica que idsAsignadosPorItem, sin coste extra
  // de lecturas de Sheets.
  var titulosPorSolicitud = {};
  todasSubsolicitudes.forEach(function (sub) {
    if (!titulosPorSolicitud[sub.solicitud_id]) titulosPorSolicitud[sub.solicitud_id] = [];
    if (sub.titulo) titulosPorSolicitud[sub.solicitud_id].push(sub.titulo);
  });

  var solicitudes = leerFilas_(SHEETS.SOLICITUDES).filter(function (s) {
    return coincideFiltros_(s, filtros, idsAsignadosPorItem, titulosPorSolicitud);
  });
  var idsSolicitudes = {};
  solicitudes.forEach(function (s) { idsSolicitudes[s.solicitud_id] = true; });

  var subsolicitudes = todasSubsolicitudes.filter(function (sub) {
    return idsSolicitudes[sub.solicitud_id];
  });

  var historial = leerFilas_(SHEETS.HISTORIAL_ESTADOS).filter(function (h) {
    return idsSolicitudes[h.solicitud_id];
  });

  // P5 (v2.0, Sprint 3): comentarios publicos (es_interno=false) para
  // detectar "respuesta recibida" -- ver respuestaPendienteLectura_ mas abajo.
  var comentariosPublicos = leerFilas_(SHEETS.COMENTARIOS).filter(function (c) {
    return idsSolicitudes[c.solicitud_id] && !c.es_interno;
  });

  var abiertas = solicitudes.filter(function (s) {
    return ESTADOS_CERRADOS.indexOf(s.estado_derivado) === -1;
  });

  var hoy = claveDia_(new Date(), 'America/Santiago');

  // Fase 10.2 (rediseno "Bandeja de trabajo"): mapa email->nombre para
  // mostrar al responsable por nombre en vez de correo crudo (misma fuente
  // que obtenerResponsablesActivos_, sin filtrar por rol/activo -- aca
  // interesa CUALQUIER responsable ya asignado, este activo o no).
  var nombrePorEmail = {};
  try {
    leerFilas_(SHEETS.USUARIOS).forEach(function (u) { nombrePorEmail[u.email] = u.nombre || u.email; });
  } catch (err) { /* USUARIOS puede no existir en algunas instalaciones */ }

  // Ultimo movimiento por solicitud (max timestamp de HISTORIAL_ESTADOS, o
  // la fecha de creacion si nunca cambio de estado) -- "dias sin movimiento"
  // es la señal que hoy no existe: una solicitud puede estar "en plazo" y
  // llevar semanas parada sin que ningun otro indicador se ponga en rojo.
  var ultimoMovimientoPorSolicitud = {};
  historial.forEach(function (h) {
    var actual = ultimoMovimientoPorSolicitud[h.solicitud_id];
    if (!actual || new Date(h.timestamp) > new Date(actual)) {
      ultimoMovimientoPorSolicitud[h.solicitud_id] = h.timestamp;
    }
  });

  // v6.1 (gestion preventiva de SLA): el eje SLA se mide UNA sola vez por
  // item y se reutiliza para los KPIs y para la lista. Antes se calculaba dos
  // veces (una para resumen.sla_vencido sobre toda la hoja, otra dentro del
  // .map() de recientes), y ahora hace falta tambien para ORDENAR por
  // urgencia antes de recortar -- calcularlo tres veces no era opcion.
  var medicionPorSub = {};
  var situacionesPorSolicitud = {};
  var itemsPorSolicitud = {};
  subsolicitudes.forEach(function (sub) {
    var medicion = Sla.medir(sub, { feriados: feriados });
    medicionPorSub[sub.subsolicitud_id] = medicion;
    if (!itemsPorSolicitud[sub.solicitud_id]) {
      itemsPorSolicitud[sub.solicitud_id] = [];
      situacionesPorSolicitud[sub.solicitud_id] = [];
    }
    itemsPorSolicitud[sub.solicitud_id].push(sub);
    situacionesPorSolicitud[sub.solicitud_id].push(medicion ? medicion.situacion : null);
  });

  function situacionSlaDe_(solicitudId) {
    return Sla.peorSituacion(situacionesPorSolicitud[solicitudId] || []);
  }

  // v6.1: se enriquece TODA la lista antes de ordenar y recortar. Recortar
  // primero (como hacia hasta v6.0, top-50 por fecha_creacion) dejaba fuera
  // solicitudes atrasadas antiguas, y entonces el KPI decia 7 y la lista
  // mostraba 4 -- el contador y lo que se ve tienen que ser lo mismo.
  var recientesTodas = solicitudes.map(function (s) {
    // Fase 10 (rediseno UX): Leo debe entender una solicitud en <10s
    // desde la fila, sin entrar al detalle -- cantidad de items y SLA
    // restante son los dos datos que mas faltaban.
    var itemsDeEstaSolicitud = itemsPorSolicitud[s.solicitud_id] || [];
    var ultimoMovimiento = ultimoMovimientoPorSolicitud[s.solicitud_id] || s.fecha_creacion;
    return {
      solicitud_id: s.solicitud_id, empresa_id: s.empresa_id, plataforma: s.plataforma,
      modulo: s.modulo, estado_derivado: s.estado_derivado, prioridad_derivada: s.prioridad_derivada,
      fecha_creacion: s.fecha_creacion, asignado_a: s.desarrollador_asignado || '',
      // Fase 10.2: nombre del responsable (no el correo) y el titulo del
      // PRIMER item -- "GDE_GDE_PREVENCION_..." (el codigo del catalogo)
      // no dice de que se trata; el titulo que el solicitante escribio si.
      asignado_nombre: s.desarrollador_asignado ? (nombrePorEmail[s.desarrollador_asignado] || s.desarrollador_asignado) : '',
      titulo_item: itemsDeEstaSolicitud.length ? itemsDeEstaSolicitud[0].titulo : '',
      // Solo se expone la fecha comprometida cuando es univoca (1 item) --
      // con varios items, cada uno puede tener la suya y mostrar una sola
      // seria enganoso; el detalle es donde se ve cada una por separado.
      fecha_comprometida: itemsDeEstaSolicitud.length === 1 ? (itemsDeEstaSolicitud[0].fecha_comprometida || '') : '',
      dias_sin_movimiento: Math.floor((Date.now() - new Date(ultimoMovimiento).getTime()) / (24 * 3600 * 1000)),
      cantidad_items: itemsDeEstaSolicitud.length,
      sla_restante_horas: slaRestanteHoras_(itemsDeEstaSolicitud, feriados, medicionPorSub),
      // v6.1: situacion del plazo como dato propio, separado del estado del
      // flujo -- una solicitud puede estar "Terminada" (estado) y "Fuera de
      // plazo" (situacion) a la vez, y antes eso no se podia expresar.
      // null = sin SLA vigente que evaluar (cerrada, P5, atencion directa).
      situacion_sla: situacionSlaDe_(s.solicitud_id),
      // Fase 10.1: campos para la busqueda por texto en el Dashboard.
      solicitante_nombre: s.solicitante_nombre || '',
      solicitante_email: s.solicitante_email || '',
      // v6.3: el MISMO texto que usa coincideFiltros_ para filtrar en el
      // servidor. El navegador filtra en vivo contra esta cadena, asi que
      // escribir en el buscador y pulsar "Actualizar" no pueden dar
      // resultados distintos: comparan lo mismo contra lo mismo.
      texto_busqueda: textoBusquedaSolicitud_(s, titulosPorSolicitud),
      // P5 (v2.0, Sprint 3): "respuesta recibida" -- alguno de los items
      // de esta solicitud esta "esperando informacion" (S06) y el
      // solicitante ya respondio (badge, para no depender solo del correo).
      respuesta_pendiente: itemsDeEstaSolicitud.some(function (sub) {
        return respuestaPendienteLectura_(sub, historial, comentariosPublicos);
      })
    };
  });

  return {
    resumen: {
      total_abiertas: abiertas.length,
      criticas_activas: abiertas.filter(function (s) { return s.prioridad_derivada === 'P1'; }).length,
      sla_vencido: subsolicitudes.filter(function (sub) {
        var m = medicionPorSub[sub.subsolicitud_id];
        return !!m && m.situacion === 'FUERA_DE_PLAZO';
      }).length,
      // v6.1 (A-08): items que ya consumieron >= 80% de su SLA objetivo y
      // todavia NO vencen. Es el mismo umbral con el que Triggers.verificarSLAs
      // manda alertaSLAProximo -- hasta v6.0 la bandeja solo sabia de lo ya
      // vencido, o sea que solo avisaba cuando ya era tarde.
      en_riesgo: subsolicitudes.filter(function (sub) {
        var m = medicionPorSub[sub.subsolicitud_id];
        return !!m && m.situacion === 'EN_RIESGO';
      }).length,
      del_dia: solicitudes.filter(function (s) { return claveDia_(new Date(s.fecha_creacion), 'America/Santiago') === hoy; }).length,
      // Fase 10.2: reemplaza a "Ingresadas hoy" como KPI accionable de la
      // bandeja (casi siempre 0, no orienta el trabajo) -- "sin asignar" SI
      // es shortlist de a quien hay que ponerle nombre.
      sin_asignar: abiertas.filter(function (s) { return !s.desarrollador_asignado; }).length,
      // v3.1 (§1.6): se excluyen de los promedios, pero se cuentan aparte --
      // "cuantas urgencias se estan resolviendo fuera del proceso" es un dato
      // de gestion por si mismo, no solo ruido que sacar de los KPIs.
      atenciones_directas: solicitudes.filter(esAtencionDirecta_).length
    },
    por_empresa: agruparYContar_(solicitudes, 'empresa_id'),
    por_plataforma: agruparYContar_(solicitudes, 'plataforma'),
    por_tipo: agruparYContar_(solicitudes, 'tipo'),
    por_estado: agruparYContar_(solicitudes, 'estado_derivado'),
    por_prioridad: agruparYContar_(solicitudes, 'prioridad_derivada'),
    top_modulos: topN_(agruparYContar_(solicitudes, 'modulo'), TOP_MODULOS_CANTIDAD),
    tiempo_promedio_resolucion_horas: tiempoPromedioResolucion_(solicitudes, historial, feriados),
    tendencia_mensual: tendenciaMensual_(solicitudes, historial, MESES_TENDENCIA),
    // P7 (v2.0, Sprint 3): alertas de patron -- siempre globales (todas las
    // empresas/modulos), sin importar los filtros activos del dashboard,
    // porque el valor esta justo en ver un patron que cruza empresas
    // ("si se repite con distintos en distintas empresas, no es un caso
    // aislado"). Ver Triggers.detectarPatrones (Triggers.gs) para el aviso
    // por correo equivalente.
    alertas_patron: calcularAlertasPatron_(),
    // v6.1: la lista se ORDENA POR URGENCIA (no por fecha de creacion) antes
    // de recortar a RECIENTES_LIMITE. Es lo que hace que el contador del KPI y
    // la cantidad de filas visibles coincidan: si algo esta fuera de plazo o en
    // riesgo entra en la ventana por definicion, aunque sea una solicitud
    // antigua (antes quedaba fuera del top-50 por fecha y el KPI decia 7
    // mientras la lista mostraba 4).
    recientes: recientesTodas
      .slice()
      .sort(function (a, b) { return ordenUrgencia_(a) - ordenUrgencia_(b); })
      .slice(0, RECIENTES_LIMITE),
    // v6.1: para poder decir en pantalla "mostrando las 50 mas urgentes de
    // 128" en vez de dar a entender que la bandeja es todo lo que hay.
    total_solicitudes: recientesTodas.length,
    recientes_truncado: recientesTodas.length > RECIENTES_LIMITE
  };
}

// v6.1: clave de orden de la bandeja. Menor = mas arriba. La bandeja es una
// COLA DE TRABAJO, no un registro cronologico: lo que decide el orden es
// "cuanto corre" y no "cuando entro". La fecha de creacion queda solo como
// desempate dentro del mismo nivel de urgencia.
//
// Ademas es lo que garantiza la coherencia KPI -> filtro -> filas: al recortar
// a RECIENTES_LIMITE, todo lo vencido y en riesgo queda dentro de la ventana
// antes que cualquier cosa sana.
var ORDEN_SITUACION_SLA = { FUERA_DE_PLAZO: 0, EN_RIESGO: 1, EN_PLAZO: 2 };

function ordenUrgencia_(fila) {
  var cerrada = ESTADOS_CERRADOS.indexOf(fila.estado_derivado) !== -1;
  // Las cerradas siempre al fondo: ya no son trabajo pendiente (la UI las
  // deja colapsadas en su propio <details>).
  var nivel = cerrada ? 9 : (fila.situacion_sla ? ORDEN_SITUACION_SLA[fila.situacion_sla] : 3);
  // Dentro del mismo nivel: menos horas restantes primero. Sin SLA vigente
  // (null) no hay reloj, va detras de las que si lo tienen.
  var restantes = fila.sla_restante_horas === null || fila.sla_restante_horas === undefined
    ? Number.MAX_SAFE_INTEGER
    : fila.sla_restante_horas;
  // Se combina en un solo numero (nivel domina, luego horas, luego fecha
  // desc) para que Array.sort sea estable y facil de razonar.
  return nivel * 1e15 + restantes * 1e6 - new Date(fila.fecha_creacion).getTime() / 1e6;
}

// P5: true si el item sigue "esperando informacion" (S06) Y ya existe un
// comentario publico posterior a la ULTIMA vez que entro a S06 -- es decir,
// el solicitante ya respondio la pregunta y Leo todavia no movio el estado.
function respuestaPendienteLectura_(subsolicitud, historial, comentariosPublicos) {
  if (subsolicitud.estado !== ESTADOS.S06) {
    return false;
  }
  var entradasS06 = historial.filter(function (h) {
    return h.subsolicitud_id === subsolicitud.subsolicitud_id && h.estado_nuevo === ESTADOS.S06;
  });
  if (entradasS06.length === 0) {
    return false;
  }
  var ultimaEntradaS06 = entradasS06.reduce(function (masReciente, h) {
    return new Date(h.timestamp) > new Date(masReciente.timestamp) ? h : masReciente;
  });
  return comentariosPublicos.some(function (c) {
    return (c.subsolicitud_id === subsolicitud.subsolicitud_id || !c.subsolicitud_id) &&
      c.solicitud_id === subsolicitud.solicitud_id &&
      new Date(c.timestamp) > new Date(ultimaEntradaS06.timestamp);
  });
}

// Minimo (mas urgente) de horas habiles restantes de SLA entre los items
// activos de la solicitud; null si ninguno tiene SLA vigente (todos
// cerrados/excluidos o sin sla_objetivo_horas, ej. P5). Negativo = vencido.
//
// v6.1: la elegibilidad y el calculo salen de Sla.medir (Cumplimiento.gs) --
// unica fuente de verdad del eje SLA. Acepta mediciones ya calculadas para
// no volver a llamar a horasHabilesEntre por item (calcularKpis_ las computa
// una sola vez para toda la hoja).
function slaRestanteHoras_(items, feriados, medicionPorSub) {
  var restantes = items
    .map(function (sub) {
      var medicion = medicionPorSub && medicionPorSub[sub.subsolicitud_id] !== undefined
        ? medicionPorSub[sub.subsolicitud_id]
        : Sla.medir(sub, { feriados: feriados });
      return medicion ? medicion.restantes_horas : null;
    })
    .filter(function (h) { return h !== null; });
  if (restantes.length === 0) return null;
  return Math.round(Math.min.apply(null, restantes) * 10) / 10;
}

// v6.3: UNICA definicion de "que texto es buscable en una solicitud".
//
// El buscador de la Bandeja tenia dos comportamientos distintos: en cliente
// miraba varios campos y en el servidor SOLO solicitante, asi que un texto
// que casaba con el titulo mostraba resultados y al pulsar "Actualizar" los
// hacia desaparecer. La causa de fondo era tener DOS definiciones de buscar.
//
// Ahora hay una sola, aqui. El blob que arma esta funcion se usa para dos
// cosas y por eso no puede divergir:
//   1. lo consulta coincideFiltros_ cuando llega filtros.busqueda, y
//   2. viaja en recientes[].texto_busqueda para que el filtrado en vivo del
//      navegador compare contra EXACTAMENTE la misma cadena, sin
//      reimplementar nada.
//
// El titulo vive en SUBSOLICITUDES, no en SOLICITUDES, asi que se recibe ya
// indexado (calcularKpis_ arma el indice con la lectura de SUBSOLICITUDES
// que de todos modos ya hace: no cuesta lecturas extra de Sheets).
function textoBusquedaSolicitud_(solicitud, titulosPorSolicitud) {
  var titulos = (titulosPorSolicitud && titulosPorSolicitud[solicitud.solicitud_id]) || [];
  return [
    solicitud.solicitud_id,
    titulos.join(' '),
    solicitud.solicitante_nombre,
    solicitud.solicitante_email,
    solicitud.empresa_id,
    solicitud.empresa_nombre,
    solicitud.plataforma,
    solicitud.plataforma_nombre,
    solicitud.modulo
  ].join(' ').toLowerCase();
}

function coincideFiltros_(solicitud, filtros, idsAsignadosPorItem, titulosPorSolicitud) {
  if (filtros.empresa_id && solicitud.empresa_id !== filtros.empresa_id) return false;
  if (filtros.estado && solicitud.estado_derivado !== filtros.estado) return false;
  if (filtros.prioridad && solicitud.prioridad_derivada !== filtros.prioridad) return false;
  if (filtros.plataforma && solicitud.plataforma !== filtros.plataforma) return false;
  // v6.3: busqueda general de la Bandeja. Es un filtro DISTINTO de
  // `solicitante` (abajo) a proposito: el Panel de Gerencia tiene un campo
  // rotulado "Solicitante" y ahi ensanchar la busqueda a titulos/modulos
  // seria incorrecto -- quien escribe en un campo que dice "Solicitante"
  // espera que filtre por solicitante. Por eso conviven los dos.
  if (filtros.busqueda) {
    var termino = String(filtros.busqueda).trim().toLowerCase();
    if (termino && textoBusquedaSolicitud_(solicitud, titulosPorSolicitud).indexOf(termino) === -1) {
      return false;
    }
  }
  // P6 (v2.0, Sprint 2): filtro por solicitante -- Gerencia necesita
  // responder "¿de que son todos esos tickets que manda Juan?" sin
  // depender de Leo. Coincidencia parcial, sin distinguir mayus/minus,
  // contra nombre O correo (quien busca puede saber cualquiera de los dos).
  if (filtros.solicitante) {
    var buscado = String(filtros.solicitante).trim().toLowerCase();
    var nombre = String(solicitud.solicitante_nombre || '').toLowerCase();
    var email = String(solicitud.solicitante_email || '').toLowerCase();
    if (nombre.indexOf(buscado) === -1 && email.indexOf(buscado) === -1) return false;
  }
  if (filtros.vistaDev) {
    // Asignado a nivel solicitud (rol "por defecto") o a nivel de alguna
    // subsolicitud puntual (§13.3 v1.0, trabajo en paralelo por item).
    var asignadaAMi = solicitud.desarrollador_asignado === filtros.vistaDev ||
      (idsAsignadosPorItem && idsAsignadosPorItem[solicitud.solicitud_id]);
    // v4.1.1: el respaldo de "huerfanas activas sin asignar" es solo para
    // el DEV (ver aplicarAmbitoRol_) -- para el resto de los roles
    // auto-acotados, sin asignacion real no hay nada que mostrar.
    var activaSinAsignar = !filtros.sinRespaldoHuerfanas &&
      !solicitud.desarrollador_asignado && ESTADOS_TRABAJO_DEV.indexOf(solicitud.estado_derivado) !== -1;
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
//
// v6.1: delega en Sla.medir (Cumplimiento.gs) -- antes repetia aqui el mismo
// filtro de elegibilidad que slaRestanteHoras_ y Triggers.ratioSlaConsumido_.
function estaVencidoSla_(subsolicitud, feriados) {
  return Sla.situacion(subsolicitud, { feriados: feriados }) === 'FUERA_DE_PLAZO';
}

// v3.1 (§1.5/§1.6): la marca viene del Sheets, donde un booleano puede
// llegar como true, 'TRUE' o 1 segun como se haya escrito la celda (mismo
// criterio que obtenerRolUsuario_ con `activo`).
function esAtencionDirecta_(solicitud) {
  var valor = solicitud && solicitud.atencion_directa;
  return valor === true || valor === 'TRUE' || valor === 1;
}

// Tiempo promedio (horas habiles) entre creacion y el momento en que la
// solicitud llego a S09 (Cerrada), tomado de HISTORIAL_ESTADOS -- no se
// agrega una columna fecha_cierre nueva (RECONCILIACION-v1.0.md).
function tiempoPromedioResolucion_(solicitudes, historial, feriados) {
  var tiempos = [];
  solicitudes.forEach(function (solicitud) {
    if (solicitud.estado_derivado !== ESTADOS.S09) return;
    // v3.1 (§1.6): las atenciones directas se crean y cierran en el mismo
    // instante (se resolvieron ANTES de registrarse), asi que su "tiempo de
    // resolucion" es ~0. Contarlas hundiria este promedio y daria una
    // lectura falsa de la capacidad real del equipo.
    if (esAtencionDirecta_(solicitud)) return;
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

// P7: agrupa subsolicitudes recientes (ultimos PATRON_VENTANA_DIAS, sin
// contar rechazadas/canceladas) por (modulo, tipo) y devuelve solo los
// grupos que superan el umbral -- misma logica que usa el trigger diario
// (Triggers.detectarPatrones) para el correo, pero esta version es "al
// vuelo" para mostrar en el Dashboard sin esperar al trigger.
function calcularAlertasPatron_() {
  var ahora = new Date().getTime();
  var ventanaMs = PATRON_VENTANA_DIAS * 24 * 60 * 60 * 1000;
  var solicitudPorId = {};
  leerFilas_(SHEETS.SOLICITUDES).forEach(function (s) { solicitudPorId[s.solicitud_id] = s; });

  var grupos = {};
  leerFilas_(SHEETS.SUBSOLICITUDES).forEach(function (sub) {
    // Sin modulo/tipo no hay forma de agrupar de forma confiable (RN del
    // propio P7: se apoya en la categorizacion estructurada, no en texto libre).
    if (!sub.modulo || !sub.tipo) return;
    if (ESTADOS_EXCLUIDOS_DERIVACION.indexOf(sub.estado) !== -1) return;
    if (ahora - new Date(sub.fecha_creacion).getTime() > ventanaMs) return;
    var solicitud = solicitudPorId[sub.solicitud_id];
    if (!solicitud) return;

    var clave = sub.modulo + '||' + sub.tipo;
    if (!grupos[clave]) {
      grupos[clave] = {
        modulo: sub.modulo_nombre || sub.modulo,
        tipo: sub.tipo_nombre || sub.tipo,
        cantidad: 0,
        solicitantes: {}
      };
    }
    grupos[clave].cantidad++;
    grupos[clave].solicitantes[solicitud.solicitante_email] = true;
  });

  return Object.keys(grupos)
    .map(function (clave) {
      var g = grupos[clave];
      return {
        modulo: g.modulo,
        tipo: g.tipo,
        cantidad: g.cantidad,
        solicitantes_distintos: Object.keys(g.solicitantes).length
      };
    })
    .filter(function (g) {
      return g.cantidad >= PATRON_CANTIDAD_MINIMA && g.solicitantes_distintos >= PATRON_SOLICITANTES_MINIMOS;
    })
    .sort(function (a, b) { return b.cantidad - a.cantidad; });
}

function claveMes_(fechaIso) {
  var fecha = new Date(fechaIso);
  return fecha.getFullYear() + '-' + ('0' + (fecha.getMonth() + 1)).slice(-2);
}
