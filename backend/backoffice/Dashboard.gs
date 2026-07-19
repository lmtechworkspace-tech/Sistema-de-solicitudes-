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
  if (contexto.rol === 'DEV') {
    return Object.assign({}, filtros, { vistaDev: contexto.email });
  }
  // ADM/GERENCIA: por defecto ven todo (sin acotar); si eligen una bandeja
  // puntual desde el selector "¿Que bandeja ver?" del Dashboard, se acota a
  // esa persona -- mismo mecanismo de filtrado (vistaDev) que ya usa
  // coincideFiltros_ para el auto-scope del Desarrollador.
  if (filtros.verBandeja) {
    return Object.assign({}, filtros, { vistaDev: filtros.verBandeja });
  }
  return filtros;
}

// v3.0 (Fase 2): solo ADM/GERENCIA ven el selector de bandeja -- son los
// unicos perfiles que pueden mirar la bandeja de otra persona (§5, §8 de la
// especificacion). Un responsable individual ya esta auto-acotado a la
// suya (aplicarAmbitoRol_) y no necesita elegir entre una lista.
function agregarResponsablesSiCorresponde_(datos, contexto) {
  if (contexto && (contexto.rol === 'ADM' || contexto.rol === 'GERENCIA')) {
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

  var solicitudes = leerFilas_(SHEETS.SOLICITUDES).filter(function (s) {
    return coincideFiltros_(s, filtros, idsAsignadosPorItem);
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

  return {
    resumen: {
      total_abiertas: abiertas.length,
      criticas_activas: abiertas.filter(function (s) { return s.prioridad_derivada === 'P1'; }).length,
      sla_vencido: subsolicitudes.filter(function (sub) { return estaVencidoSla_(sub, feriados); }).length,
      del_dia: solicitudes.filter(function (s) { return claveDia_(new Date(s.fecha_creacion), 'America/Santiago') === hoy; }).length,
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
    recientes: solicitudes
      .slice()
      .sort(function (a, b) { return new Date(b.fecha_creacion) - new Date(a.fecha_creacion); })
      // Fase 10.1: se sube de 20 a RECIENTES_LIMITE para que la busqueda por
      // texto (cliente, dashboard.js) tenga un universo util donde buscar;
      // sigue siendo una lista acotada, no un listado completo paginado.
      .slice(0, RECIENTES_LIMITE)
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
          sla_restante_horas: slaRestanteHoras_(itemsDeEstaSolicitud, feriados),
          // Fase 10.1: campos para la busqueda por texto en el Dashboard.
          solicitante_nombre: s.solicitante_nombre || '',
          solicitante_email: s.solicitante_email || '',
          // P5 (v2.0, Sprint 3): "respuesta recibida" -- alguno de los items
          // de esta solicitud esta "esperando informacion" (S06) y el
          // solicitante ya respondio (badge, para no depender solo del correo).
          respuesta_pendiente: itemsDeEstaSolicitud.some(function (sub) {
            return respuestaPendienteLectura_(sub, historial, comentariosPublicos);
          })
        };
      })
  };
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
