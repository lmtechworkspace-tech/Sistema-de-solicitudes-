/**
 * Proyectos.gs — v9.0 MVP Fase 1.
 * documentacion/SIGSO-v9.0-propuesta-modulo-gestion-proyectos.md.
 *
 * Modulo de Gestion de Proyectos Internos. Decision central de la propuesta
 * (§0): las TAREAS de un proyecto NO son una entidad nueva -- son
 * ACTIVIDADES (Actividades.gs, motor de Gestion Operacional v7.0), extendida
 * con proyecto_id/hito_id. Este archivo es la capa contenedora + sala de
 * trabajo encima de ese motor ya probado: nunca reimplementa check-in,
 * estados, bloqueos, semaforo o reasignacion -- llama a Actividades.* tal
 * cual, con datos enriquecidos.
 *
 * Patron de permisos (igual que Actividades/Jefatura/Novedades): el modulo
 * 'proyectos' es el gate GRUESO (MODULO_POR_ACCION, Code.gs); la membresia
 * en PROYECTO_INTEGRANTES es el gate FINO (quien ve/edita que proyecto).
 * ADM y GERENCIA ven todo (GERENCIA de solo lectura, igual criterio que el
 * resto de SIGSO).
 *
 * Trazabilidad: PROYECTO_EVENTOS es la sala -- una sola tabla append-only
 * tipada, mismo espiritu que ACTIVIDADES_BITACORA (no HISTORIAL_* x N).
 */

// v10 (Fase D, "adjuntos por proyecto"): mismo tope que Calidad.gs/Novedades.gs.
var MAX_ADJUNTO_PROYECTO_BYTES = 10 * 1024 * 1024;

// Mismas firmas binarias que Perfiles.gs (detectarMimeImagen_) -- esa
// funcion vive dentro del IIFE de Perfiles y no es global, asi que se
// copia aca en vez de exportarla solo para este uso.
var FIRMAS_IMAGEN_PROYECTO_ = [
  { mime: 'image/jpeg', firma: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/png', firma: [0x89, 0x50, 0x4E, 0x47] }
];
function esWebpProyecto_(bytes) {
  if (!bytes || bytes.length < 12) return false;
  var riff = [0x52, 0x49, 0x46, 0x46], webp = [0x57, 0x45, 0x42, 0x50];
  for (var i = 0; i < 4; i++) {
    if ((bytes[i] & 0xFF) !== riff[i]) return false;
    if ((bytes[8 + i] & 0xFF) !== webp[i]) return false;
  }
  return true;
}
function detectarMimeImagenProyecto_(bytes) {
  if (!bytes || !bytes.length) return null;
  for (var i = 0; i < FIRMAS_IMAGEN_PROYECTO_.length; i++) {
    var candidato = FIRMAS_IMAGEN_PROYECTO_[i];
    var coincide = true;
    for (var j = 0; j < candidato.firma.length; j++) {
      if ((bytes[j] & 0xFF) !== candidato.firma[j]) { coincide = false; break; }
    }
    if (coincide) return candidato.mime;
  }
  return esWebpProyecto_(bytes) ? 'image/webp' : null;
}

var Proyectos = {
  // --- Portafolio ----------------------------------------------------------
  // ADM/GERENCIA ven todos los proyectos activos; el resto ve solo los
  // proyectos donde es integrante (cualquier rol_proyecto). Cada proyecto
  // sale con su salud calculada y motivos (§J de la propuesta).
  listar: function (filtros, contexto) {
    var todos = leerFilasSeguro_(SHEETS.PROYECTOS).filter(function (p) {
      return p.activa === true || p.activa === 'TRUE' || p.activa === 1;
    });
    var vePropios = contexto.rol !== 'ADM' && contexto.rol !== 'GERENCIA';
    var misProyectos = vePropios ? proyectosDelUsuario_(contexto.email) : null;

    var visibles = todos.filter(function (p) {
      return !vePropios || misProyectos.indexOf(p.proyecto_id) !== -1;
    });
    if (filtros && filtros.estado) {
      visibles = visibles.filter(function (p) { return p.estado === filtros.estado; });
    }
    if (filtros && filtros.area_id) {
      visibles = visibles.filter(function (p) { return p.area_id === filtros.area_id; });
    }

    var todasActividades = leerFilasSeguro_(SHEETS.ACTIVIDADES);
    var todosIntegrantes = leerFilasSeguro_(SHEETS.PROYECTO_INTEGRANTES);
    var todosHitos = leerFilasSeguro_(SHEETS.PROYECTO_HITOS);
    var todosEntregables = leerFilasSeguro_(SHEETS.PROYECTO_ENTREGABLES);

    return visibles.map(function (p) {
      var tareas = todasActividades.filter(function (a) { return a.proyecto_id === p.proyecto_id; });
      var hitos = todosHitos.filter(function (h) { return h.proyecto_id === p.proyecto_id; });
      var entregables = todosEntregables.filter(function (e) { return e.proyecto_id === p.proyecto_id; });
      var integrantes = todosIntegrantes.filter(function (i) {
        return i.proyecto_id === p.proyecto_id && esVerdaderoProyecto_(i.activo);
      });
      var salud = calcularSaludProyecto_(p, tareas, hitos, entregables);
      return {
        proyecto_id: p.proyecto_id,
        codigo: p.codigo,
        nombre: p.nombre,
        descripcion: p.descripcion,
        lider_email: p.lider_email,
        estado: p.estado,
        prioridad: p.prioridad,
        fecha_inicio: p.fecha_inicio,
        fecha_objetivo: p.fecha_objetivo,
        ultima_actualizacion: p.ultima_actualizacion,
        avance_pct: calcularAvanceProyecto_(tareas),
        // v12.5: cumplimiento de plazos de las tareas del proyecto. Es
        // distinto del avance: avance dice CUANTO se hizo, esto dice si lo
        // que se hizo llego a tiempo.
        cumplimiento_tareas: calcularCumplimientoTareasProyecto_(tareas),
        total_integrantes: integrantes.length,
        // v10 (Fase A, "tarjetas con mas pulso"): quien esta en el equipo,
        // para pintar avatares en la tarjeta del portafolio sin que el
        // frontend tenga que pedir el detalle de cada proyecto solo para
        // eso. Ya esta filtrado arriba (activo=true, este proyecto) -- cero
        // lecturas de hoja adicionales. El lider primero, es quien mas
        // identifica al proyecto de un vistazo.
        integrantes: integrantes
          .slice()
          .sort(function (a, b) { return (a.rol_proyecto === 'LIDER' ? -1 : 0) - (b.rol_proyecto === 'LIDER' ? -1 : 0); })
          .map(function (i) { return { email: i.usuario_email, nombre: i.usuario_nombre || i.usuario_email }; }),
        total_tareas: tareas.filter(function (a) { return a.activa === true || a.activa === 'TRUE' || a.activa === 1; }).length,
        salud: salud.codigo,
        salud_etiqueta: salud.etiqueta,
        salud_motivos: salud.motivos
      };
    }).sort(function (a, b) {
      var orden = { critico: 0, riesgo: 1, normal: 2 };
      var porSalud = orden[a.salud] - orden[b.salud];
      if (porSalud !== 0) return porSalud;
      return new Date(b.ultima_actualizacion || 0) - new Date(a.ultima_actualizacion || 0);
    });
  },

  // v10 (Fase B, propuesta 03 "Mi trabajo en proyectos"): TODAS mis tareas y
  // entregables pendientes, de TODOS mis proyectos, en un solo lugar --
  // antes había que entrar proyecto por proyecto para saber qué te toca.
  // Deliberadamente NO reusa Actividades.listar (mezclaria actividades
  // sueltas de "Mi trabajo" con las de proyecto); filtra ACTIVIDADES
  // directo, acotado a proyecto_id no vacío.
  listarMisTareas: function (data, contexto) {
    var email = normalizarEmailProyecto_(contexto.email);
    var misProyectos = {};
    proyectosDelUsuario_(contexto.email).forEach(function (id) { misProyectos[id] = true; });
    var esAdmGerencia = contexto.rol === 'ADM' || contexto.rol === 'GERENCIA';

    var proyectosPorId = {};
    leerFilasSeguro_(SHEETS.PROYECTOS).forEach(function (p) { proyectosPorId[p.proyecto_id] = p; });

    function esMiaYVisible(proyectoId, responsableEmail) {
      if (normalizarEmailProyecto_(responsableEmail) !== email) return false;
      return esAdmGerencia || misProyectos[proyectoId];
    }

    var tareas = leerFilasSeguro_(SHEETS.ACTIVIDADES).filter(function (a) {
      var activa = a.activa === true || a.activa === 'TRUE' || a.activa === 1;
      return activa && a.proyecto_id && esMiaYVisible(a.proyecto_id, a.responsable_email);
    }).map(function (a) {
      var s = semaforoActividad_(a);
      var proyecto = proyectosPorId[a.proyecto_id];
      return {
        actividad_id: a.actividad_id, titulo: a.titulo, estado: a.estado,
        prioridad: a.prioridad, fecha_compromiso: a.fecha_compromiso,
        avance_pct: a.avance_pct, bloqueo_motivo: a.bloqueo_motivo,
        fecha_propuesta: a.fecha_propuesta, confirmada_en: a.confirmada_en,
        semaforo: s.codigo, semaforo_etiqueta: s.etiqueta,
        proyecto_id: a.proyecto_id,
        proyecto_nombre: proyecto ? proyecto.nombre : '(proyecto eliminado)',
        // v10 (Fase G2): meta cuantificable opcional (ver Actividades.crear).
        meta_cantidad: a.meta_cantidad, meta_unidad: a.meta_unidad
      };
    }).sort(function (a, b) {
      var orden = { atrasada: 0, riesgo: 1, pendiente: 2, bloqueada: 3, 'al-dia': 4, revision: 5, terminada: 6, cancelada: 7 };
      var oa = orden[a.semaforo] === undefined ? 9 : orden[a.semaforo];
      var ob = orden[b.semaforo] === undefined ? 9 : orden[b.semaforo];
      if (oa !== ob) return oa - ob;
      return new Date(a.fecha_compromiso || '9999-12-31') - new Date(b.fecha_compromiso || '9999-12-31');
    });

    // Entregables PENDIENTES/OBSERVADOS (APROBADO/CANCELADO ya no requieren
    // accion de su responsable -- mismo criterio que la salud del proyecto,
    // ver calcularSaludProyecto_).
    var entregables = leerFilasSeguro_(SHEETS.PROYECTO_ENTREGABLES).filter(function (e) {
      return e.estado !== 'APROBADO' && e.estado !== 'CANCELADO' && esMiaYVisible(e.proyecto_id, e.responsable_email);
    }).map(function (e) {
      var proyecto = proyectosPorId[e.proyecto_id];
      return {
        entregable_id: e.entregable_id, nombre: e.nombre, estado: e.estado,
        fecha_comprometida: e.fecha_comprometida,
        proyecto_id: e.proyecto_id, proyecto_nombre: proyecto ? proyecto.nombre : '(proyecto eliminado)'
      };
    }).sort(function (a, b) { return new Date(a.fecha_comprometida || '9999-12-31') - new Date(b.fecha_comprometida || '9999-12-31'); });

    return { tareas: tareas, entregables: entregables };
  },

  // v10 (Fase C, propuesta 05 "vista calendario"): fechas comprometidas de
  // tareas, hitos y entregables de TODOS los proyectos visibles, en un solo
  // pedido -- filtrar por proyecto o "solo lo mío" lo hace el frontend
  // sobre esta misma lista (mismo criterio que buscar/ordenar/agrupar el
  // portafolio en Fase A: son pocos items, no vale la pena un viaje de red
  // por cada combinacion de filtro). Mismo alcance de "quien ve que
  // proyecto" que listar() (portafolio).
  listarCalendario: function (data, contexto) {
    var proyectosActivos = leerFilasSeguro_(SHEETS.PROYECTOS).filter(function (p) {
      return p.activa === true || p.activa === 'TRUE' || p.activa === 1;
    });
    var vePropios = contexto.rol !== 'ADM' && contexto.rol !== 'GERENCIA';
    var misProyectos = vePropios ? proyectosDelUsuario_(contexto.email) : null;
    var visibles = proyectosActivos.filter(function (p) {
      return !vePropios || misProyectos.indexOf(p.proyecto_id) !== -1;
    });
    var proyectosPorId = {};
    visibles.forEach(function (p) { proyectosPorId[p.proyecto_id] = p; });

    var items = [];
    leerFilasSeguro_(SHEETS.ACTIVIDADES).forEach(function (a) {
      var activa = a.activa === true || a.activa === 'TRUE' || a.activa === 1;
      if (!activa || !a.fecha_compromiso || !proyectosPorId[a.proyecto_id]) return;
      var s = semaforoActividad_(a);
      items.push({
        tipo: 'tarea', fecha: a.fecha_compromiso, titulo: a.titulo,
        responsable_email: a.responsable_email,
        semaforo: s.codigo, semaforo_etiqueta: s.etiqueta,
        proyecto_id: a.proyecto_id, proyecto_nombre: proyectosPorId[a.proyecto_id].nombre
      });
    });
    leerFilasSeguro_(SHEETS.PROYECTO_HITOS).forEach(function (h) {
      if (!h.fecha_objetivo || !proyectosPorId[h.proyecto_id]) return;
      items.push({
        tipo: 'hito', fecha: h.fecha_objetivo, titulo: h.nombre, estado: h.estado,
        proyecto_id: h.proyecto_id, proyecto_nombre: proyectosPorId[h.proyecto_id].nombre
      });
    });
    // Entregables ya cerrados (aprobados/cancelados) no aportan nada a un
    // calendario de "que viene" -- mismo criterio que listarMisTareas.
    leerFilasSeguro_(SHEETS.PROYECTO_ENTREGABLES).forEach(function (e) {
      if (!e.fecha_comprometida || e.estado === 'APROBADO' || e.estado === 'CANCELADO' || !proyectosPorId[e.proyecto_id]) return;
      items.push({
        tipo: 'entregable', fecha: e.fecha_comprometida, titulo: e.nombre, estado: e.estado,
        responsable_email: e.responsable_email,
        proyecto_id: e.proyecto_id, proyecto_nombre: proyectosPorId[e.proyecto_id].nombre
      });
    });

    return {
      items: items.sort(function (a, b) { return new Date(a.fecha) - new Date(b.fecha); }),
      proyectos: visibles.map(function (p) { return { proyecto_id: p.proyecto_id, nombre: p.nombre }; })
    };
  },

  // --- Detalle de un proyecto (Resumen / Sala / Tareas / Hitos / Equipo) --
  getDetalle: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeVerProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
    }
    var tareas = leerFilasSeguro_(SHEETS.ACTIVIDADES).filter(function (a) { return a.proyecto_id === proyecto.proyecto_id; });
    var hitos = leerFilasSeguro_(SHEETS.PROYECTO_HITOS).filter(function (h) { return h.proyecto_id === proyecto.proyecto_id; })
      .sort(function (a, b) { return (Number(a.orden) || 0) - (Number(b.orden) || 0); });
    var integrantes = leerFilasSeguro_(SHEETS.PROYECTO_INTEGRANTES)
      .filter(function (i) { return i.proyecto_id === proyecto.proyecto_id && esVerdaderoProyecto_(i.activo); });
    // v9.4 (Fase 2/3): entregables y riesgos. No se filtran por estado --
    // igual criterio que hitos (CANCELADO/CERRADO siguen visibles con su
    // badge, nunca se ocultan datos existentes).
    var entregables = leerFilasSeguro_(SHEETS.PROYECTO_ENTREGABLES).filter(function (e) { return e.proyecto_id === proyecto.proyecto_id; });
    var riesgos = leerFilasSeguro_(SHEETS.PROYECTO_RIESGOS).filter(function (r) { return r.proyecto_id === proyecto.proyecto_id; });
    var salud = calcularSaludProyecto_(proyecto, tareas, hitos, entregables);

    return {
      proyecto: proyecto,
      rol_actual: rolEnProyecto_(proyecto.proyecto_id, contexto),
      // v9.2: capacidad de gestion resuelta en el backend (no reimplementada
      // en el frontend). Cubre al LIDER del proyecto Y al ADM (que puede
      // gestionar cualquier proyecto aunque no sea integrante) -- antes el
      // frontend solo miraba rol_actual==='LIDER', dejando al ADM sin
      // controles en proyectos ajenos. GERENCIA siempre false (solo lectura).
      puede_gestionar: puedeGestionarProyecto_(proyecto, contexto),
      integrantes: integrantes,
      hitos: hitos.map(function (h) {
        var tareasHito = tareas.filter(function (a) { return a.hito_id === h.hito_id; });
        return {
          hito_id: h.hito_id, nombre: h.nombre, descripcion: h.descripcion,
          fecha_objetivo: h.fecha_objetivo, estado: h.estado, orden: h.orden,
          total_tareas: tareasHito.length,
          avance_pct: calcularAvanceProyecto_(tareasHito)
        };
      }),
      entregables: entregables,
      riesgos: riesgos,
      avance_pct: calcularAvanceProyecto_(tareas),
      // v10 (Fase G3, "los numeros de rendimiento"): mismo calculo que ya
      // usa el portafolio (Proyectos.listar) -- antes solo se veia ahi, un
      // proyecto abierto no traia su propio numero de "entregas a tiempo".
      cumplimiento_tareas: calcularCumplimientoTareasProyecto_(tareas),
      salud: salud.codigo,
      salud_etiqueta: salud.etiqueta,
      salud_motivos: salud.motivos,
      requiere_atencion: calcularRequiereAtencion_(tareas, hitos, integrantes),
      // v10 (Fase D, propuesta 09 "resumen diario"): "que se movio" desde la
      // ULTIMA VEZ que ESTA persona vio la Sala -- null si nunca la visito
      // (primera vez: no hay "desde" que mostrar, seria ruido).
      resumen_desde_ultima_visita: calcularResumenVisitaProyecto_(proyecto, contexto, integrantes, tareas)
    };
  },

  // v10 (auditoría G, 2026-08-30): abrir un proyecto pedía 3 acciones por
  // separado (getDetalle + listarTareas + listarSala). Apps Script las
  // ejecuta EN SERIE y cada una re-abre la planilla y re-lee las hojas (el
  // cache _cacheHojas_ es POR EJECUCIÓN, no sobrevive entre requests). Esta
  // acción las junta en UNA sola ejecución: las 3 comparten el cache, así
  // ACTIVIDADES se lee una vez en vez de dos, y es 1 viaje de red en vez de
  // 3. Reusa los métodos tal cual (cero lógica nueva, cero permiso nuevo --
  // cada uno revalida por su cuenta, barato con el cache caliente).
  getDetalleCompleto: function (data, contexto) {
    var detalle = Proyectos.getDetalle(data, contexto);
    if (detalle && (detalle._forbidden || detalle._validationError)) return detalle;
    return {
      detalle: detalle,
      tareas: Proyectos.listarTareas(data, contexto),
      sala: Proyectos.listarSala(data, contexto)
    };
  },

  // Actualiza "cuando vi la Sala por ultima vez" a ahora mismo -- lo llama
  // el frontend al abrir la pestaña Sala (marcar como leido). Sin fila de
  // integrante (ADM/GERENCIA mirando sin ser miembros) no hay donde guardarlo:
  // no es un error, simplemente esas cuentas nunca ven el resumen "desde tu
  // ultima visita" (tiene sentido: no son "su" proyecto).
  marcarSalaVisitada: function (data, contexto) {
    var proyecto = buscarProyecto_(data && data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    var integrante = leerFilasSeguro_(SHEETS.PROYECTO_INTEGRANTES).filter(function (i) {
      return i.proyecto_id === proyecto.proyecto_id &&
        normalizarEmailProyecto_(i.usuario_email) === normalizarEmailProyecto_(contexto.email) && esVerdaderoProyecto_(i.activo);
    })[0];
    if (!integrante) return { actualizado: false };
    actualizarFilaPorId_(SHEETS.PROYECTO_INTEGRANTES, 'integrante_id', integrante.integrante_id, {
      ultima_visita_sala: new Date().toISOString()
    });
    return { actualizado: true };
  },

  // --- CRUD del proyecto ---------------------------------------------------
  crear: function (data, contexto) {
    var nombre = String(data.nombre || '').trim();
    if (!nombre) return errorValidacion_('nombre', 'El nombre es obligatorio.');
    var liderEmail = normalizarEmailProyecto_(data.lider_email || contexto.email);
    if (!liderEmail) return errorValidacion_('lider_email', 'Falta el líder del proyecto.');
    if (!data.fecha_inicio) return errorValidacion_('fecha_inicio', 'La fecha de inicio es obligatoria.');
    if (!data.fecha_objetivo) return errorValidacion_('fecha_objetivo', 'La fecha objetivo es obligatoria.');

    // v10 (Fase D, propuesta 10 "Solicitud -> Proyecto"): se valida ANTES de
    // crear nada -- una solicitud inexistente o ya convertida no debe dejar
    // un proyecto huerfano a medio crear.
    var solicitudOrigen = null;
    if (data.solicitud_id) {
      solicitudOrigen = leerFilasSeguro_(SHEETS.SOLICITUDES).filter(function (s) { return s.solicitud_id === data.solicitud_id; })[0];
      if (!solicitudOrigen) return errorValidacion_('solicitud_id', 'La solicitud de origen no existe.');
      if (solicitudOrigen.proyecto_id) {
        return errorValidacion_('solicitud_id', 'Esa solicitud ya se convirtió en el proyecto ' + solicitudOrigen.proyecto_id + '.');
      }
    }

    var ahora = new Date();
    var proyecto = {
      proyecto_id: Utilities.getUuid(),
      codigo: String(data.codigo || '').trim(),
      nombre: nombre,
      descripcion: data.descripcion || '',
      objetivo: data.objetivo || '',
      resultado_esperado: data.resultado_esperado || '',
      lider_email: liderEmail,
      area_id: data.area_id || '',
      cliente_id: data.cliente_id || '',
      categoria: data.categoria || '',
      prioridad: ORDEN_PRIORIDAD.indexOf(data.prioridad) !== -1 ? data.prioridad : PRIORIDAD_POR_DEFECTO,
      estado: PROYECTOS_ESTADOS.PLANIFICACION,
      fecha_inicio: data.fecha_inicio,
      fecha_objetivo: data.fecha_objetivo,
      fecha_cierre_real: '',
      salud_override: '',
      salud_override_motivo: '',
      ultima_actualizacion: ahora.toISOString(),
      creado_por: contexto.email || '',
      fecha_creacion: ahora.toISOString(),
      activa: true,
      // v10 (Fase D, propuesta 10 "Solicitud -> Proyecto"): solo
      // trazabilidad -- de donde salio este proyecto, si vino de convertir
      // una solicitud. Nunca se usa para permisos ni cambia nada del ciclo
      // de vida de la solicitud original.
      solicitud_origen_id: data.solicitud_id || ''
    };
    agregarFila_(SHEETS.PROYECTOS, proyecto);

    // El lider queda como integrante LIDER automaticamente (RN implicita:
    // todo proyecto tiene al menos un LIDER con acceso). Si quien crea es
    // otra persona (p.ej. ADM armando el proyecto para un tercero), tambien
    // queda como INTEGRANTE para poder seguir configurandolo.
    agregarIntegrante_(proyecto.proyecto_id, liderEmail, data.lider_nombre || '', 'LIDER', '', contexto);
    if (normalizarEmailProyecto_(contexto.email) !== liderEmail) {
      agregarIntegrante_(proyecto.proyecto_id, contexto.email, contexto.nombre || '', 'INTEGRANTE', 'Creador del proyecto', contexto);
    }
    // v10 (Fase D): enlace de vuelta -- la solicitud original queda marcada
    // con el proyecto que salio de ella (para "ya se convirtió" y para el
    // enlace desde su propia pantalla). El solicitante NO se agrega como
    // integrante: PROYECTO_INTEGRANTES exige una identidad real de SIGSO
    // (login Google o cuenta de portal), y el solicitante de un ticket
    // puede ser un contacto externo sin ninguna de las dos -- agregarlo a
    // ciegas seria un permiso, no una cortesia.
    if (solicitudOrigen) {
      actualizarFilaPorId_(SHEETS.SOLICITUDES, 'solicitud_id', solicitudOrigen.solicitud_id, { proyecto_id: proyecto.proyecto_id });
      registrarEventoProyecto_(proyecto.proyecto_id, 'ACTUALIZACION', contexto,
        'Proyecto creado a partir de la solicitud ' + solicitudOrigen.solicitud_id +
          (solicitudOrigen.solicitante_nombre ? ' (solicitante: ' + solicitudOrigen.solicitante_nombre + ')' : ''),
        '', '', '');
    }
    // v10 (Fase C, propuesta 07 "plantillas de proyecto"): si se pidio crear
    // desde una plantilla, se clonan sus hitos (solo estructura --
    // nombre/descripcion/orden, nunca fechas) al proyecto nuevo. Una
    // plantilla inexistente o ya desactivada se ignora en silencio: es un
    // dato secundario, nunca debe bloquear la creacion del proyecto.
    if (data.plantilla_id) {
      var plantillaUsada = buscarPlantilla_(data.plantilla_id);
      if (plantillaUsada) {
        leerFilasSeguro_(SHEETS.PROYECTO_PLANTILLA_HITOS)
          .filter(function (h) { return h.plantilla_id === plantillaUsada.plantilla_id; })
          .sort(function (a, b) { return (Number(a.orden) || 0) - (Number(b.orden) || 0); })
          .forEach(function (h, indice) {
            agregarFila_(SHEETS.PROYECTO_HITOS, {
              hito_id: Utilities.getUuid(), proyecto_id: proyecto.proyecto_id,
              nombre: h.nombre, descripcion: h.descripcion || '', fecha_objetivo: '',
              estado: 'PENDIENTE', orden: indice, fecha_creacion: ahora.toISOString()
            });
          });
        registrarEventoProyecto_(proyecto.proyecto_id, 'ACTUALIZACION', contexto,
          'Proyecto creado desde la plantilla "' + plantillaUsada.nombre + '"', '', '', '');
      }
    }
    registrarEventoProyecto_(proyecto.proyecto_id, 'ACTUALIZACION', contexto, 'Proyecto creado', '', '', '');
    return proyecto;
  },

  // v10 (Fase C, propuesta 07): guarda la ESTRUCTURA de hitos de un proyecto
  // ya existente (nombre/descripcion/orden -- nunca fechas ni datos reales)
  // para poder arrancar los proximos proyectos parecidos desde ahi. Los
  // entregables quedan fuera a proposito: gestionarEntregable siempre exige
  // un responsable y una fecha real, asi que no hay forma de clonarlos "sin
  // datos" -- se crean a mano en el proyecto nuevo, como siempre. Puede
  // convertirlo en plantilla quien puede gestionar el proyecto origen
  // (mismo circulo que gestiona hitos: LIDER del proyecto o ADM).
  guardarComoPlantilla: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeGestionarProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'Solo el líder del proyecto o un administrador pueden guardarlo como plantilla.' };
    }
    var nombre = String(data.nombre || '').trim();
    if (!nombre) return errorValidacion_('nombre', 'El nombre de la plantilla es obligatorio.');

    var plantilla = {
      plantilla_id: Utilities.getUuid(), nombre: nombre, descripcion: data.descripcion || '',
      creado_por: contexto.email || '', fecha_creacion: new Date().toISOString(), activa: true
    };
    agregarFila_(SHEETS.PROYECTO_PLANTILLAS, plantilla);

    var hitos = leerFilasSeguro_(SHEETS.PROYECTO_HITOS)
      .filter(function (h) { return h.proyecto_id === proyecto.proyecto_id; })
      .sort(function (a, b) { return (Number(a.orden) || 0) - (Number(b.orden) || 0); });
    hitos.forEach(function (h, indice) {
      agregarFila_(SHEETS.PROYECTO_PLANTILLA_HITOS, {
        plantilla_hito_id: Utilities.getUuid(), plantilla_id: plantilla.plantilla_id,
        nombre: h.nombre, descripcion: h.descripcion || '', orden: indice
      });
    });
    plantilla.total_hitos = hitos.length;
    return plantilla;
  },

  // Solo plantillas activas -- no hay UI de borrado en este MVP (la
  // propuesta solo pide "guardar" y "crear desde una plantilla", no un
  // mantenedor completo); si hiciera falta limpiar una vieja, un ADM puede
  // poner activa=false directo en la hoja.
  listarPlantillas: function (data, contexto) {
    var hitosPorPlantilla = {};
    leerFilasSeguro_(SHEETS.PROYECTO_PLANTILLA_HITOS).forEach(function (h) {
      hitosPorPlantilla[h.plantilla_id] = (hitosPorPlantilla[h.plantilla_id] || 0) + 1;
    });
    return leerFilasSeguro_(SHEETS.PROYECTO_PLANTILLAS)
      .filter(function (p) { return esVerdaderoProyecto_(p.activa); })
      .map(function (p) {
        return {
          plantilla_id: p.plantilla_id, nombre: p.nombre, descripcion: p.descripcion,
          total_hitos: hitosPorPlantilla[p.plantilla_id] || 0
        };
      })
      .sort(function (a, b) { return a.nombre.localeCompare(b.nombre); });
  },

  actualizar: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeGestionarProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'Solo el líder del proyecto o un administrador pueden editarlo.' };
    }
    var camposEditables = [
      'nombre', 'descripcion', 'objetivo', 'resultado_esperado', 'area_id',
      'cliente_id', 'categoria', 'fecha_inicio', 'fecha_objetivo', 'codigo'
    ];
    var cambios = { ultima_actualizacion: new Date().toISOString() };
    camposEditables.forEach(function (campo) {
      if (data[campo] !== undefined) cambios[campo] = data[campo];
    });
    if (data.prioridad && ORDEN_PRIORIDAD.indexOf(data.prioridad) !== -1) cambios.prioridad = data.prioridad;

    var notaEstado = '';
    if (data.estado && data.estado !== proyecto.estado) {
      if (Object.keys(PROYECTOS_ESTADOS).indexOf(data.estado) === -1) {
        return errorValidacion_('estado', 'Estado de proyecto inválido.');
      }
      // Cerrar es un PROCESO, no un toggle (§30 de la propuesta): exige un
      // motivo/resumen de cierre, igual que cancelar una actividad exige
      // motivo. El detalle rico del checklist de cierre queda para Fase 3;
      // por ahora se deja trazado en la sala.
      if (data.estado === PROYECTOS_ESTADOS.CERRADO) {
        if (!String(data.motivo || '').trim()) {
          return errorValidacion_('motivo', 'Cerrar un proyecto exige un resumen de cierre.');
        }
        cambios.fecha_cierre_real = new Date().toISOString();
      }
      cambios.estado = data.estado;
      notaEstado = 'Estado: ' + proyecto.estado + ' → ' + data.estado + (data.motivo ? '. ' + data.motivo : '');
    }

    if (data.salud_override !== undefined) {
      // Correccion manual excepcional (§J): exige motivo, queda en la sala.
      if (data.salud_override && !String(data.motivo_salud || '').trim()) {
        return errorValidacion_('motivo_salud', 'Fijar la salud manualmente exige un motivo.');
      }
      cambios.salud_override = data.salud_override || '';
      cambios.salud_override_motivo = data.salud_override ? data.motivo_salud : '';
    }

    var actualizado = actualizarFilaPorId_(SHEETS.PROYECTOS, 'proyecto_id', proyecto.proyecto_id, cambios);
    if (notaEstado) registrarEventoProyecto_(proyecto.proyecto_id, 'CAMBIO_ESTADO', contexto, notaEstado, '', '', '');
    return actualizado;
  },

  // --- Equipo ---------------------------------------------------------------
  gestionarIntegrante: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeGestionarProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'Solo el líder del proyecto o un administrador pueden gestionar el equipo.' };
    }
    if (data.accion === 'quitar') {
      if (!data.integrante_id) return errorValidacion_('integrante_id', 'Falta indicar el integrante.');
      var fila = buscarIntegranteProyecto_(data.integrante_id);
      if (fila && fila.rol_proyecto === 'LIDER') {
        var lideresActivos = leerFilasSeguro_(SHEETS.PROYECTO_INTEGRANTES).filter(function (i) {
          return i.proyecto_id === proyecto.proyecto_id && i.rol_proyecto === 'LIDER' && esVerdaderoProyecto_(i.activo);
        });
        if (lideresActivos.length <= 1) {
          return errorValidacion_('integrante_id', 'El proyecto necesita al menos un líder.');
        }
      }
      var quitado = actualizarFilaPorId_(SHEETS.PROYECTO_INTEGRANTES, 'integrante_id', data.integrante_id, { activo: false });
      registrarEventoProyecto_(proyecto.proyecto_id, 'ACTUALIZACION', contexto,
        'Se quitó del equipo a ' + (fila ? (fila.usuario_nombre || fila.usuario_email) : ''), '', '', '');
      return quitado;
    }
    var email = normalizarEmailProyecto_(data.usuario_email);
    if (!email) return errorValidacion_('usuario_email', 'Falta el correo del integrante.');
    var rol = ['LIDER', 'INTEGRANTE', 'COLABORADOR', 'OBSERVADOR'].indexOf(data.rol_proyecto) !== -1
      ? data.rol_proyecto : 'INTEGRANTE';
    var existente = leerFilasSeguro_(SHEETS.PROYECTO_INTEGRANTES).filter(function (i) {
      return i.proyecto_id === proyecto.proyecto_id && normalizarEmailProyecto_(i.usuario_email) === email;
    })[0];
    if (existente) {
      var reactivado = actualizarFilaPorId_(SHEETS.PROYECTO_INTEGRANTES, 'integrante_id', existente.integrante_id, {
        rol_proyecto: rol, responsabilidad: data.responsabilidad || existente.responsabilidad || '', activo: true
      });
      registrarEventoProyecto_(proyecto.proyecto_id, 'ACTUALIZACION', contexto,
        (data.usuario_nombre || email) + ' se une al equipo como ' + rol, '', '', '');
      return reactivado;
    }
    var nuevo = agregarIntegrante_(proyecto.proyecto_id, email, data.usuario_nombre || '', rol, data.responsabilidad || '', contexto);
    registrarEventoProyecto_(proyecto.proyecto_id, 'ACTUALIZACION', contexto,
      (data.usuario_nombre || email) + ' se une al equipo como ' + rol, '', '', '');
    encolarNotificacionApp_(email, 'PROYECTO_INTEGRANTE', 'Te agregaron a un proyecto',
      'Ahora participas en "' + proyecto.nombre + '" como ' + rol + '.', 'proyectos', 'Ver proyecto', 72);
    return nuevo;
  },

  // --- Hitos ------------------------------------------------------------
  gestionarHito: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeGestionarProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'Solo el líder del proyecto o un administrador pueden gestionar hitos.' };
    }
    if (data.accion === 'eliminar') {
      if (!data.hito_id) return errorValidacion_('hito_id', 'Falta indicar el hito.');
      var tareasDelHito = leerFilasSeguro_(SHEETS.ACTIVIDADES).filter(function (a) { return a.hito_id === data.hito_id; });
      if (tareasDelHito.length > 0) {
        return errorValidacion_('hito_id', 'Este hito tiene tareas asociadas; muévelas antes de eliminarlo.');
      }
      return eliminarFilaHito_(data.hito_id);
    }
    if (data.hito_id) {
      var cambios = { fecha_creacion: undefined };
      ['nombre', 'descripcion', 'fecha_objetivo', 'estado', 'orden'].forEach(function (campo) {
        if (data[campo] !== undefined) cambios[campo] = data[campo];
      });
      delete cambios.fecha_creacion;
      return actualizarFilaPorId_(SHEETS.PROYECTO_HITOS, 'hito_id', data.hito_id, cambios);
    }
    var nombre = String(data.nombre || '').trim();
    if (!nombre) return errorValidacion_('nombre', 'El nombre del hito es obligatorio.');
    var totalHitos = leerFilasSeguro_(SHEETS.PROYECTO_HITOS).filter(function (h) { return h.proyecto_id === proyecto.proyecto_id; }).length;
    var hito = {
      hito_id: Utilities.getUuid(),
      proyecto_id: proyecto.proyecto_id,
      nombre: nombre,
      descripcion: data.descripcion || '',
      fecha_objetivo: data.fecha_objetivo || '',
      estado: 'PENDIENTE',
      orden: data.orden !== undefined ? data.orden : totalHitos,
      fecha_creacion: new Date().toISOString()
    };
    agregarFila_(SHEETS.PROYECTO_HITOS, hito);
    return hito;
  },

  // --- Tareas: wrapper delgado sobre Actividades.gs (la decision central) --
  // No reimplementa NADA del motor: enriquece los datos (proyecto_id,
  // hito_id, area del proyecto, supervisor = lider del proyecto salvo que
  // se indique otro) y delega en Actividades.crear. El resto del ciclo de
  // vida de la tarea (check-in, bloqueo, validacion, reasignar...) sigue
  // usando las acciones de Actividades.gs que YA EXISTEN, sin pasar por aca.
  crearTarea: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    var rol = rolEnProyecto_(proyecto.proyecto_id, contexto);
    if (!(contexto.rol === 'ADM' || rol === 'LIDER' || rol === 'INTEGRANTE' || rol === 'COLABORADOR')) {
      return { _forbidden: true, message: 'No puedes crear tareas en este proyecto.' };
    }
    if (data.hito_id) {
      var hito = leerFilasSeguro_(SHEETS.PROYECTO_HITOS).filter(function (h) { return h.hito_id === data.hito_id; })[0];
      if (!hito || hito.proyecto_id !== proyecto.proyecto_id) {
        return errorValidacion_('hito_id', 'El hito no pertenece a este proyecto.');
      }
    }
    // v9.4 (Fase 2): dependencia opcional, solo dentro del mismo proyecto.
    // Es informativa (§I: "nada mueve fechas ni cierra cosas solo") --
    // listarTareas la usa para marcar "potencialmente comprometida" cuando
    // la tarea de la que se depende esta atrasada.
    if (data.depende_de) {
      var dependencia = leerFilasSeguro_(SHEETS.ACTIVIDADES).filter(function (a) { return a.actividad_id === data.depende_de; })[0];
      if (!dependencia || dependencia.proyecto_id !== proyecto.proyecto_id) {
        return errorValidacion_('depende_de', 'La tarea de la que depende debe ser del mismo proyecto.');
      }
    }
    var enriquecido = {};
    for (var k in data) enriquecido[k] = data[k];
    enriquecido.proyecto = proyecto.nombre; // compat: campo de texto libre ya existente en ACTIVIDADES
    enriquecido.proyecto_id = proyecto.proyecto_id;
    enriquecido.hito_id = data.hito_id || '';
    if (!enriquecido.area_id) enriquecido.area_id = proyecto.area_id;
    // El lider del proyecto es el supervisor por defecto de sus tareas --
    // asi puedeGestionar_/puedeSupervisar_ (Actividades.gs) le dan control
    // sobre la tarea SIN tener que estar en JEFATURAS como jefe formal del
    // responsable. Integracion limpia: cero cambios a los permisos de
    // Actividades.gs.
    if (!enriquecido.supervisor_email) enriquecido.supervisor_email = proyecto.lider_email;
    var tarea = Actividades.crear(enriquecido, contexto);
    if (tarea && (tarea._validationError || tarea._forbidden)) return tarea;
    registrarEventoProyecto_(proyecto.proyecto_id, 'ACTUALIZACION', contexto,
      'Nueva tarea: ' + tarea.titulo, 'ACTIVIDAD', tarea.actividad_id, '');
    return tarea;
  },

  // Lectura de las tareas del proyecto -- bypassa el alcance por JEFATURAS
  // de Actividades.listar() a proposito (mismo criterio que
  // Gerencia.getPanelGerenciaActividades: una vista transversal usa su
  // PROPIO gate, la membresia del proyecto, no el de "Mi trabajo").
  listarTareas: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeVerProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
    }
    var tareas = leerFilasSeguro_(SHEETS.ACTIVIDADES)
      .filter(function (a) {
        var activa = a.activa === true || a.activa === 'TRUE' || a.activa === 1;
        return activa && a.proyecto_id === proyecto.proyecto_id;
      });
    var porId = {};
    tareas.forEach(function (a) { porId[a.actividad_id] = a; });
    return tareas.map(function (a) {
      a.semaforo = semaforoActividad_(a).codigo;
      a.semaforo_etiqueta = semaforoActividad_(a).etiqueta;
      // v9.4: bandera derivada, no persistida -- se recalcula cada vez que
      // se lee (§I: "nada mueve fechas ni cierra cosas solo").
      if (a.depende_de) {
        var dependencia = porId[a.depende_de];
        a.dependencia_titulo = dependencia ? dependencia.titulo : '';
        a.dependencia_comprometida = !!dependencia && semaforoActividad_(dependencia).codigo === 'atrasada';
      }
      return a;
    });
  },

  // v10 (Fase E, propuesta "Carta Gantt de Dedicación"): la bitácora de
  // TODAS las tareas del proyecto, para dibujar la grilla día × tarea con
  // lo que el check-in YA registra (misma ACTIVIDADES_BITACORA que "Mi
  // trabajo" usa para su propio historial) -- cero dato nuevo, cero doble
  // digitación. La interpretación de cada tipo (CHECKIN_AVANCE -> "P",
  // ENTREGA -> "F", etc.) la hace el frontend, igual que ya interpreta
  // TIPO_EVENTO_ETIQUETA o HITO_ESTADO_ETIQUETA -- son mapas de
  // presentación sobre un enum fijo, no una regla de negocio nueva.
  listarBitacora: function (data, contexto) {
    var proyecto = buscarProyecto_(data && data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeVerProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
    }
    var idsTarea = {};
    leerFilasSeguro_(SHEETS.ACTIVIDADES).forEach(function (a) {
      if (a.proyecto_id === proyecto.proyecto_id) idsTarea[a.actividad_id] = true;
    });
    return leerFilasSeguro_(SHEETS.ACTIVIDADES_BITACORA)
      .filter(function (b) { return idsTarea[b.actividad_id]; })
      .map(function (b) {
        return {
          actividad_id: b.actividad_id, tipo: b.tipo, nota: b.nota, horas: horasDeBitacora_(b),
          timestamp: b.timestamp, autor_nombre: b.autor_nombre || b.autor_email
        };
      })
      .sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });
  },

  // v10 (Fase G3, "vista transversal por recurso"): la bitácora de TODAS
  // mis tareas de proyecto, de TODOS mis proyectos -- mismo alcance que
  // listarMisTareas (soy el responsable, y ADM/GERENCIA o integrante de
  // ese proyecto). Alimenta "Mi dedicación": la misma Carta Gantt de
  // Dedicación de un proyecto, cruzando todos los proyectos donde trabajo.
  listarMiBitacora: function (data, contexto) {
    var email = normalizarEmailProyecto_(contexto.email);
    var misProyectos = {};
    proyectosDelUsuario_(contexto.email).forEach(function (id) { misProyectos[id] = true; });
    var esAdmGerencia = contexto.rol === 'ADM' || contexto.rol === 'GERENCIA';
    var idsTarea = {};
    leerFilasSeguro_(SHEETS.ACTIVIDADES).forEach(function (a) {
      var activa = a.activa === true || a.activa === 'TRUE' || a.activa === 1;
      if (!activa || !a.proyecto_id) return;
      if (normalizarEmailProyecto_(a.responsable_email) !== email) return;
      if (!esAdmGerencia && !misProyectos[a.proyecto_id]) return;
      idsTarea[a.actividad_id] = true;
    });
    return leerFilasSeguro_(SHEETS.ACTIVIDADES_BITACORA)
      .filter(function (b) { return idsTarea[b.actividad_id]; })
      .map(function (b) {
        return {
          actividad_id: b.actividad_id, tipo: b.tipo, nota: b.nota, horas: horasDeBitacora_(b),
          timestamp: b.timestamp, autor_nombre: b.autor_nombre || b.autor_email
        };
      })
      .sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });
  },

  // v10 (Fase G3, "los números de rendimiento"): unidades/día y horas/
  // unidad, derivados de la MISMA bitácora y las MISMAS tareas con meta
  // cuantificable que ya alimentan la Carta de Dedicación -- nada se mide
  // aparte. Deliberadamente NO incluye "capacidad usada vs disponible":
  // eso exigiría una jornada esperada por persona que hoy no existe en
  // ningún lado de Proyectos/Actividades, y adivinar un número (ej. "8
  // horas") sería inventar una política que nadie pidió -- mismo criterio
  // que ya se aplicó en la Fase G1 (no se calcula "hito a tiempo" porque
  // PROYECTO_HITOS no registra CUÁNDO se completó, solo su estado actual).
  obtenerRendimiento: function (data, contexto) {
    var proyecto = buscarProyecto_(data && data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeVerProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
    }
    var tareas = leerFilasSeguro_(SHEETS.ACTIVIDADES).filter(function (a) {
      var activa = a.activa === true || a.activa === 'TRUE' || a.activa === 1;
      return activa && a.proyecto_id === proyecto.proyecto_id;
    });
    var idsTarea = {};
    tareas.forEach(function (a) { idsTarea[a.actividad_id] = true; });

    // Horas totales y dias distintos con check-in, por tarea -- del mismo
    // JSON libre 'datos' que listarBitacora ya sabe leer.
    var horasPorTarea = {}, diasPorTarea = {};
    leerFilasSeguro_(SHEETS.ACTIVIDADES_BITACORA).forEach(function (b) {
      if (!idsTarea[b.actividad_id]) return;
      var horas = Number(horasDeBitacora_(b)) || 0;
      if (horas) horasPorTarea[b.actividad_id] = (horasPorTarea[b.actividad_id] || 0) + horas;
      var f = new Date(b.timestamp);
      if (isNaN(f.getTime())) return;
      var clave = f.toISOString().slice(0, 10);
      (diasPorTarea[b.actividad_id] = diasPorTarea[b.actividad_id] || {})[clave] = true;
    });

    var porTarea = tareas.filter(function (a) { return a.meta_cantidad; }).map(function (a) {
      var horas = horasPorTarea[a.actividad_id] || 0;
      var dias = Object.keys(diasPorTarea[a.actividad_id] || {}).length;
      // unidades/dia y horas/unidad solo se calculan sobre una tarea
      // TERMINADA -- antes de eso, la meta no esta cumplida y dividir por
      // "lo hecho hasta ahora" seria adivinar cuanto de la meta representa
      // el avance parcial (no hay un %-de-meta, solo un avance_pct genérico).
      var terminada = a.estado === 'TERMINADA';
      return {
        actividad_id: a.actividad_id, titulo: a.titulo, estado: a.estado,
        meta_cantidad: a.meta_cantidad, meta_unidad: a.meta_unidad,
        horas_totales: horas ? Math.round(horas * 10) / 10 : '',
        dias_trabajados: dias,
        unidades_por_dia: (terminada && dias > 0) ? Math.round((a.meta_cantidad / dias) * 10) / 10 : '',
        horas_por_unidad: (terminada && horas > 0) ? Math.round((horas / a.meta_cantidad) * 100) / 100 : ''
      };
    });

    var conRitmo = porTarea.filter(function (t) { return t.unidades_por_dia !== ''; });
    var horasTotalesProyecto = Object.keys(horasPorTarea).reduce(function (s, k) { return s + horasPorTarea[k]; }, 0);

    return {
      por_tarea: porTarea,
      promedio_unidades_dia: conRitmo.length
        ? Math.round((conRitmo.reduce(function (s, t) { return s + t.unidades_por_dia; }, 0) / conRitmo.length) * 10) / 10
        : null,
      horas_totales_proyecto: horasTotalesProyecto ? Math.round(horasTotalesProyecto * 10) / 10 : 0,
      tareas_sin_avance: tareas.filter(function (a) { return a.estado === 'NO_INICIADA'; }).length,
      cumplimiento_tareas: calcularCumplimientoTareasProyecto_(tareas)
    };
  },

  // --- La sala --------------------------------------------------------------
  listarSala: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeVerProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
    }
    return leerFilasSeguro_(SHEETS.PROYECTO_EVENTOS)
      .filter(function (e) { return e.proyecto_id === proyecto.proyecto_id; })
      .sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
  },

  // Publicar en la sala: actualizacion, comentario, decision, reunion,
  // bloqueo o solicitud del lider -- todo es un PROYECTO_EVENTOS, solo
  // cambia el 'tipo' (§7 de la propuesta). Observadores no publican.
  publicarEnSala: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    var rol = rolEnProyecto_(proyecto.proyecto_id, contexto);
    if (!(contexto.rol === 'ADM' || (rol && rol !== 'OBSERVADOR'))) {
      return { _forbidden: true, message: 'No puedes publicar en este proyecto.' };
    }
    var tipo = ['ACTUALIZACION', 'COMENTARIO', 'DECISION', 'REUNION', 'BLOQUEO', 'SOLICITUD_LIDER']
      .indexOf(data.tipo) !== -1 ? data.tipo : 'COMENTARIO';
    if (tipo === 'SOLICITUD_LIDER' && rol !== 'LIDER' && contexto.rol !== 'ADM') {
      return { _forbidden: true, message: 'Solo el líder puede publicar una solicitud.' };
    }
    var cuerpo = String(data.cuerpo || '').trim();
    if (!cuerpo) return errorValidacion_('cuerpo', 'Escribe algo antes de publicar.');

    var evento = registrarEventoProyecto_(proyecto.proyecto_id, tipo, contexto,
      data.titulo || '', data.ref_tipo || '', data.ref_id || '', cuerpo, data.menciones);
    notificarSala_(proyecto, evento, contexto);
    return evento;
  },

  // Convierte un evento de la sala (tipicamente un COMENTARIO) en una tarea
  // real -- reusa crearTarea (que a su vez reusa Actividades.crear).
  // Ejemplo del §7 de la propuesta: "Necesitamos corregir el documento" →
  // tarea "Revisar documento", responsable Juan, fecha 15/08.
  convertirEventoEnTarea: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!data.titulo) return errorValidacion_('titulo', 'Falta el título de la tarea.');
    var tarea = Proyectos.crearTarea({
      proyecto_id: proyecto.proyecto_id,
      hito_id: data.hito_id || '',
      titulo: data.titulo,
      descripcion: data.descripcion || '',
      responsable_email: data.responsable_email,
      responsable_nombre: data.responsable_nombre || '',
      fecha_compromiso: data.fecha_compromiso,
      prioridad: data.prioridad,
      origen: 'SOLICITUD'
    }, contexto);
    if (tarea && (tarea._validationError || tarea._forbidden)) return tarea;
    if (data.evento_id) {
      actualizarFilaPorId_(SHEETS.PROYECTO_EVENTOS, 'evento_id', data.evento_id, {
        ref_tipo: 'ACTIVIDAD', ref_id: tarea.actividad_id
      });
    }
    return tarea;
  },

  // v10 (Fase D, propuesta 08 "adjuntos por proyecto"): una zona de
  // archivos por proyecto, "enlazable desde la sala" -- en vez de una hoja
  // nueva solo para metadata de archivos, el adjunto ES un evento mas de la
  // Sala (tipo ARCHIVO, ref_id = id del archivo en Drive): aparece en el
  // feed como cualquier otra novedad, con su autor y su fecha, sin
  // duplicar "quien publico que y cuando" en dos tablas distintas. Mismo
  // circulo que puede crear tareas (LIDER/INTEGRANTE/COLABORADOR o ADM).
  subirAdjunto: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    var rol = rolEnProyecto_(proyecto.proyecto_id, contexto);
    if (!(contexto.rol === 'ADM' || rol === 'LIDER' || rol === 'INTEGRANTE' || rol === 'COLABORADOR')) {
      return { _forbidden: true, message: 'No puedes subir archivos a este proyecto.' };
    }
    if (!data.nombre_archivo) return errorValidacion_('nombre_archivo', 'Falta el nombre del archivo.');
    var bytes;
    try {
      bytes = Utilities.base64Decode(data.contenido_base64);
    } catch (err) {
      return errorValidacion_('contenido_base64', 'El archivo no es base64 válido.');
    }
    if (!bytes.length) return errorValidacion_('contenido_base64', 'El archivo está vacío.');
    if (bytes.length > MAX_ADJUNTO_PROYECTO_BYTES) {
      return errorValidacion_('contenido_base64',
        'El archivo supera el tamaño máximo (' + Math.round(MAX_ADJUNTO_PROYECTO_BYTES / (1024 * 1024)) + ' MB).');
    }
    // Reusa los mismos detectores de tipo por firma binaria que ya prueban
    // Calidad.gs (documentos) y Perfiles.gs (imagenes) -- ni la extension
    // ni el mime que manda el navegador se toman en cuenta, asi un
    // ejecutable renombrado no pasa.
    var mime = mimeArchivoSgc_(bytes, data.nombre_archivo) || detectarMimeImagenProyecto_(bytes);
    if (!mime) {
      return errorValidacion_('contenido_base64', 'Formato no admitido. Se aceptan PDF, Word, Excel, PowerPoint, JPG, PNG o WebP.');
    }
    var carpeta = obtenerCarpetaProyecto_(proyecto);
    var archivoDrive = carpeta.createFile(Utilities.newBlob(bytes, mime, data.nombre_archivo));
    var evento = registrarEventoProyecto_(proyecto.proyecto_id, 'ARCHIVO', contexto,
      data.nombre_archivo, 'ARCHIVO', archivoDrive.getId(), data.comentario || '');
    return evento;
  },

  // Sirve el archivo por backend (nunca la carpeta directo): re-valida el
  // acceso al proyecto en cada descarga, mismo criterio que
  // Novedades.descargarAdjunto/Calidad.descargarDocumento.
  descargarAdjunto: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeVerProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
    }
    var evento = leerFilasSeguro_(SHEETS.PROYECTO_EVENTOS).filter(function (e) {
      return e.evento_id === data.evento_id && e.proyecto_id === proyecto.proyecto_id && e.tipo === 'ARCHIVO';
    })[0];
    if (!evento) return errorValidacion_('evento_id', 'Archivo no encontrado.');
    var archivo;
    try {
      archivo = DriveApp.getFileById(evento.ref_id);
    } catch (err) {
      return errorValidacion_('evento_id', 'El archivo ya no está disponible en Drive.');
    }
    var blob = archivo.getBlob();
    return {
      contenido_base64: Utilities.base64Encode(blob.getBytes()),
      nombre_archivo: evento.titulo,
      mime: blob.getContentType()
    };
  },

  // --- Entregables (Fase 2 de la propuesta): flujo aprobar/observar -------
  // Quien puede crear/editar/marcar-entregado: LIDER/INTEGRANTE/COLABORADOR
  // del proyecto o ADM (mismo circulo que crea tareas). Revisar (aprobar u
  // observar) es exclusivo del LIDER/ADM -- ver revisarEntregable.
  gestionarEntregable: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    var rol = rolEnProyecto_(proyecto.proyecto_id, contexto);
    var puedeGestionar = contexto.rol === 'ADM' || rol === 'LIDER' || rol === 'INTEGRANTE' || rol === 'COLABORADOR';
    if (!puedeGestionar) return { _forbidden: true, message: 'No puedes gestionar entregables en este proyecto.' };

    if (data.accion === 'eliminar') {
      if (!data.entregable_id) return errorValidacion_('entregable_id', 'Falta indicar el entregable.');
      var paraEliminar = buscarEntregable_(data.entregable_id);
      if (paraEliminar && paraEliminar.estado !== 'PENDIENTE') {
        return errorValidacion_('entregable_id', 'Solo se puede eliminar un entregable que aun no se ha marcado como entregado.');
      }
      return actualizarFilaPorId_(SHEETS.PROYECTO_ENTREGABLES, 'entregable_id', data.entregable_id, { estado: 'CANCELADO' });
    }

    if (data.accion === 'marcarEntregado') {
      if (!data.entregable_id) return errorValidacion_('entregable_id', 'Falta indicar el entregable.');
      var entregable = buscarEntregable_(data.entregable_id);
      if (!entregable || entregable.proyecto_id !== proyecto.proyecto_id) {
        return errorValidacion_('entregable_id', 'Entregable no encontrado.');
      }
      // Solo el responsable (o LIDER/ADM en su lugar) marca la entrega --
      // evita que cualquier integrante cierre el compromiso de otro.
      var esResponsable = normalizarEmailProyecto_(entregable.responsable_email) === normalizarEmailProyecto_(contexto.email);
      if (!esResponsable && contexto.rol !== 'ADM' && rol !== 'LIDER') {
        return { _forbidden: true, message: 'Solo el responsable del entregable puede marcarlo como entregado.' };
      }
      var marcado = actualizarFilaPorId_(SHEETS.PROYECTO_ENTREGABLES, 'entregable_id', data.entregable_id, {
        estado: 'ENTREGADO',
        url_evidencia: data.url_evidencia || entregable.url_evidencia || '',
        fecha_entrega_real: new Date().toISOString()
      });
      registrarEventoProyecto_(proyecto.proyecto_id, 'ENTREGABLE', contexto,
        'Entregable "' + entregable.nombre + '" listo para revisión', 'ENTREGABLE', data.entregable_id, '');
      notificarLideresProyecto_(proyecto, contexto, 'Entregable listo para revisar',
        entregable.nombre + ' está listo para tu revisión.');
      return marcado;
    }

    if (data.entregable_id) {
      var cambios = {};
      ['nombre', 'descripcion', 'hito_id', 'responsable_email', 'fecha_comprometida'].forEach(function (campo) {
        if (data[campo] !== undefined) cambios[campo] = data[campo];
      });
      return actualizarFilaPorId_(SHEETS.PROYECTO_ENTREGABLES, 'entregable_id', data.entregable_id, cambios);
    }

    var nombre = String(data.nombre || '').trim();
    if (!nombre) return errorValidacion_('nombre', 'El nombre del entregable es obligatorio.');
    var responsable = normalizarEmailProyecto_(data.responsable_email);
    if (!responsable) return errorValidacion_('responsable_email', 'Falta el responsable del entregable.');
    if (!data.fecha_comprometida) return errorValidacion_('fecha_comprometida', 'La fecha comprometida es obligatoria.');
    var nuevo = {
      entregable_id: Utilities.getUuid(),
      proyecto_id: proyecto.proyecto_id,
      hito_id: data.hito_id || '',
      nombre: nombre,
      descripcion: data.descripcion || '',
      responsable_email: responsable,
      fecha_comprometida: data.fecha_comprometida,
      estado: 'PENDIENTE',
      url_evidencia: '',
      fecha_entrega_real: '',
      revisado_por: '',
      resultado_revision: '',
      observaciones: '',
      fecha_creacion: new Date().toISOString()
    };
    agregarFila_(SHEETS.PROYECTO_ENTREGABLES, nuevo);
    registrarEventoProyecto_(proyecto.proyecto_id, 'ENTREGABLE', contexto, 'Nuevo entregable: ' + nombre, 'ENTREGABLE', nuevo.entregable_id, '');
    return nuevo;
  },

  // Aprobar u observar (devolver con motivo) un entregable ya marcado como
  // ENTREGADO -- exclusivo del LIDER/ADM, mismo criterio que puedeGestionarProyecto_.
  // Un entregable OBSERVADO no tiene estado terminal propio: el responsable
  // puede volver a marcarEntregado tras corregir (mismo espiritu que
  // "devolver con motivo" en el resto de SIGSO).
  revisarEntregable: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeGestionarProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'Solo el líder del proyecto o un administrador pueden revisar entregables.' };
    }
    var entregable = buscarEntregable_(data.entregable_id);
    if (!entregable || entregable.proyecto_id !== proyecto.proyecto_id) {
      return errorValidacion_('entregable_id', 'Entregable no encontrado.');
    }
    if (entregable.estado !== 'ENTREGADO') {
      return errorValidacion_('entregable_id', 'Solo se puede revisar un entregable que ya fue marcado como entregado.');
    }
    var resultado = data.resultado === 'OBSERVADO' ? 'OBSERVADO' : 'APROBADO';
    if (resultado === 'OBSERVADO' && !String(data.observaciones || '').trim()) {
      return errorValidacion_('observaciones', 'Observar un entregable exige indicar el motivo.');
    }
    var revisado = actualizarFilaPorId_(SHEETS.PROYECTO_ENTREGABLES, 'entregable_id', data.entregable_id, {
      estado: resultado, revisado_por: contexto.email || '', resultado_revision: resultado,
      observaciones: data.observaciones || ''
    });
    registrarEventoProyecto_(proyecto.proyecto_id, 'ENTREGABLE', contexto,
      'Entregable "' + entregable.nombre + '": ' + (resultado === 'APROBADO' ? 'aprobado' : 'observado') +
        (data.observaciones ? '. ' + data.observaciones : ''), 'ENTREGABLE', data.entregable_id, '');
    encolarNotificacionApp_(entregable.responsable_email,
      'PROYECTO_ENTREGABLE', resultado === 'APROBADO' ? 'Entregable aprobado' : 'Entregable observado',
      entregable.nombre + (data.observaciones ? ': ' + data.observaciones : ''), 'proyectos', 'Ver proyecto', 72);
    return revisado;
  },

  // --- Riesgos (Fase 3 de la propuesta) -------------------------------------
  // nivel se DERIVA de probabilidad x impacto (calcularNivelRiesgo_) -- nunca
  // se pide a mano, para que no quede desalineado del cruce real.
  gestionarRiesgo: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    var rol = rolEnProyecto_(proyecto.proyecto_id, contexto);
    var puedeGestionar = contexto.rol === 'ADM' || rol === 'LIDER' || rol === 'INTEGRANTE' || rol === 'COLABORADOR';
    if (!puedeGestionar) return { _forbidden: true, message: 'No puedes gestionar riesgos en este proyecto.' };

    if (data.accion === 'eliminar') {
      if (!data.riesgo_id) return errorValidacion_('riesgo_id', 'Falta indicar el riesgo.');
      return actualizarFilaPorId_(SHEETS.PROYECTO_RIESGOS, 'riesgo_id', data.riesgo_id, { estado: 'CERRADO' });
    }
    if (data.riesgo_id) {
      var actual = buscarRiesgo_(data.riesgo_id);
      if (!actual) return errorValidacion_('riesgo_id', 'Riesgo no encontrado.');
      var cambios = {};
      ['descripcion', 'responsable_email', 'mitigacion', 'estado'].forEach(function (campo) {
        if (data[campo] !== undefined) cambios[campo] = data[campo];
      });
      if (data.probabilidad !== undefined) cambios.probabilidad = data.probabilidad;
      if (data.impacto !== undefined) cambios.impacto = data.impacto;
      if (data.probabilidad !== undefined || data.impacto !== undefined) {
        cambios.nivel = calcularNivelRiesgo_(cambios.probabilidad || actual.probabilidad, cambios.impacto || actual.impacto);
      }
      return actualizarFilaPorId_(SHEETS.PROYECTO_RIESGOS, 'riesgo_id', data.riesgo_id, cambios);
    }

    var descripcion = String(data.descripcion || '').trim();
    if (!descripcion) return errorValidacion_('descripcion', 'La descripción del riesgo es obligatoria.');
    var probabilidad = ['BAJA', 'MEDIA', 'ALTA'].indexOf(data.probabilidad) !== -1 ? data.probabilidad : 'MEDIA';
    var impacto = ['BAJA', 'MEDIA', 'ALTA'].indexOf(data.impacto) !== -1 ? data.impacto : 'MEDIA';
    var riesgo = {
      riesgo_id: Utilities.getUuid(),
      proyecto_id: proyecto.proyecto_id,
      descripcion: descripcion,
      probabilidad: probabilidad,
      impacto: impacto,
      nivel: calcularNivelRiesgo_(probabilidad, impacto),
      responsable_email: normalizarEmailProyecto_(data.responsable_email) || proyecto.lider_email,
      mitigacion: data.mitigacion || '',
      estado: 'ABIERTO',
      fecha_creacion: new Date().toISOString()
    };
    agregarFila_(SHEETS.PROYECTO_RIESGOS, riesgo);
    registrarEventoProyecto_(proyecto.proyecto_id, 'RIESGO', contexto,
      'Riesgo registrado (' + riesgo.nivel + '): ' + descripcion, 'RIESGO', riesgo.riesgo_id, '');
    return riesgo;
  },

  // --- Resumen ejecutivo del portafolio (Fase 3) ----------------------------
  // Reusa Proyectos.listar (misma visibilidad: ADM/GERENCIA ven todo, el
  // resto solo sus proyectos) -- cero logica de permisos nueva. Carga por
  // persona pondera por tamano (S/M/L/XL, ya existe en ACTIVIDADES): "muchos
  // L/XL" es sobrecarga real, un conteo plano no lo distingue (§L.3).
  getResumenPortafolio: function (contexto) {
    var proyectos = Proyectos.listar({}, contexto);
    var activos = proyectos.filter(function (p) { return p.estado !== 'CERRADO' && p.estado !== 'CANCELADO'; });
    var porSalud = { normal: 0, riesgo: 0, critico: 0 };
    activos.forEach(function (p) { porSalud[p.salud] = (porSalud[p.salud] || 0) + 1; });

    var ahora = new Date();
    var proximosACerrar = activos.filter(function (p) {
      if (!p.fecha_objetivo) return false;
      var dias = (new Date(p.fecha_objetivo) - ahora) / 86400000;
      return dias >= 0 && dias <= 14;
    });
    var sinActualizacionReciente = activos.filter(function (p) {
      if (!p.ultima_actualizacion) return false;
      return (ahora - new Date(p.ultima_actualizacion)) / 86400000 >= 7;
    });

    // Carga: solo tareas activas y no terminales de proyectos VISIBLES y
    // ACTIVOS (cerrados/cancelados no representan trabajo vigente).
    var idsActivos = {};
    activos.forEach(function (p) { idsActivos[p.proyecto_id] = true; });
    var pesoTamano = { S: 1, M: 2, L: 3, XL: 5 };
    var cargaPorPersona = {};
    leerFilasSeguro_(SHEETS.ACTIVIDADES).forEach(function (a) {
      var activa = a.activa === true || a.activa === 'TRUE' || a.activa === 1;
      if (!activa || !a.proyecto_id || !idsActivos[a.proyecto_id] || esEstadoTerminal_(a.estado)) return;
      var email = a.responsable_email || '(sin responsable)';
      if (!cargaPorPersona[email]) {
        cargaPorPersona[email] = { email: email, nombre: a.responsable_nombre || email, total_tareas: 0, carga_ponderada: 0 };
      }
      cargaPorPersona[email].total_tareas += 1;
      cargaPorPersona[email].carga_ponderada += pesoTamano[a.tamano] || 2;
    });

    return {
      total_proyectos: activos.length,
      por_salud: porSalud,
      proximos_a_cerrar: proximosACerrar.length,
      sin_actualizacion_reciente: sinActualizacionReciente.length,
      carga_por_persona: Object.keys(cargaPorPersona).map(function (email) { return cargaPorPersona[email]; })
        .sort(function (x, y) { return y.carga_ponderada - x.carga_ponderada; })
    };
  },

  // v10 (Fase D, propuesta 11 "reporte PDF del proyecto"): un PDF de una
  // pagina con salud, avance, hitos, riesgos y proximos vencimientos --
  // reusa el MISMO motor de documentos que la Orden de Trabajo y el reporte
  // de Pausas (docChromeOt_/docSeccionOt_/celdaLabelFicha_/celdaValorFicha_/
  // escaparHtml_/chipPrioridadOt_, definidos en OrdenTrabajo.gs -- mismo
  // proyecto de Apps Script, mismo scope global, nada que importar). Quien
  // puede VER el proyecto puede exportarlo (es un reporte de solo lectura,
  // no una accion de gestion).
  descargarReporte: function (data, contexto) {
    var proyecto = buscarProyecto_(data && data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeVerProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
    }
    var detalle = Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, contexto);
    var tareas = Proyectos.listarTareas({ proyecto_id: proyecto.proyecto_id }, contexto);
    // v10 (Fase G4, "valor y salida ejecutiva"): el reporte ahora tambien
    // cuenta COMO se llego al avance -- el rendimiento (Fase G3) y las
    // ultimas marcas de la bitacora (la Carta de Dedicación, en forma de
    // reporte: un registro cronologico, no la grilla interactiva dia x
    // tarea, que existe para trabajar el dia a dia, no para imprimirse).
    var tareasPorId = {};
    tareas.forEach(function (a) { tareasPorId[a.actividad_id] = a; });
    var rendimiento = Proyectos.obtenerRendimiento({ proyecto_id: proyecto.proyecto_id }, contexto);
    var bitacoraReciente = Proyectos.listarBitacora({ proyecto_id: proyecto.proyecto_id }, contexto).slice(-15).reverse();
    var html = construirHtmlReporteProyecto_(detalle, tareas, rendimiento, bitacoraReciente, tareasPorId);
    var pdf = Utilities.newBlob(html, 'text/html', 'Reporte-' + proyecto.proyecto_id + '.html').getAs('application/pdf');
    pdf.setName('Reporte - ' + proyecto.nombre + '.pdf');
    return {
      pdf_base64: Utilities.base64Encode(pdf.getBytes()),
      filename: pdf.getName()
    };
  }
};

// --- reporte PDF: construccion del HTML (Fase D, propuesta 11) -----------

var PROYECTOS_SALUD_LABEL_PDF = { normal: 'Normal', riesgo: 'En riesgo', critico: 'Crítico' };
var PROYECTOS_ESTADO_LABEL_PDF = {
  PLANIFICACION: 'Planificación', ACTIVO: 'Activo', EN_PAUSA: 'En pausa',
  EN_REVISION: 'En revisión', CERRADO: 'Cerrado', CANCELADO: 'Cancelado'
};

// Los helpers de fecha del PDF de la OT (fechaCortaOt_) truncan un ISO
// completo -- para una fecha de proyecto (sin hora que importe) alcanza con
// el dia. Se queda local a este archivo, no vale la pena generalizarlo.
function fechaCortaPdfProyecto_(valor) {
  if (!valor) return '—';
  try { return Utilities.formatDate(new Date(valor), 'America/Santiago', 'dd-MM-yyyy'); }
  catch (err) { return String(valor).slice(0, 10); }
}

function construirHtmlReporteProyecto_(detalle, tareas, rendimiento, bitacoraReciente, tareasPorId) {
  var cuerpo = fichaProyectoPdf_(detalle) +
    seccionHitosPdf_(detalle.hitos || []) +
    seccionRiesgosPdf_(detalle.riesgos || []) +
    seccionVencimientosPdf_(tareas || []) +
    seccionRendimientoPdf_(rendimiento) +
    seccionBitacoraPdf_(bitacoraReciente || [], tareasPorId || {});
  var p = detalle.proyecto;
  return docChromeOt_({ tipoDoc: 'Reporte de proyecto', referencia: p.codigo || p.nombre }, cuerpo);
}

function fichaProyectoPdf_(detalle) {
  var p = detalle.proyecto;
  var filas = [
    ['Líder', escaparHtml_(p.lider_email || '—'), 'Estado', escaparHtml_(PROYECTOS_ESTADO_LABEL_PDF[p.estado] || p.estado)],
    ['Salud', escaparHtml_(PROYECTOS_SALUD_LABEL_PDF[detalle.salud] || detalle.salud), 'Avance', (detalle.avance_pct === null ? '—' : detalle.avance_pct + '%')],
    ['Inicio', fechaCortaPdfProyecto_(p.fecha_inicio), 'Fecha objetivo', fechaCortaPdfProyecto_(p.fecha_objetivo)]
  ];
  var cuerpoFilas = filas.map(function (f) {
    return '<tr>' +
      '<td style="' + celdaLabelFicha_() + '">' + f[0] + '</td>' +
      '<td style="' + celdaValorFicha_() + '">' + f[1] + '</td>' +
      '<td style="' + celdaLabelFicha_() + '">' + f[2] + '</td>' +
      '<td style="' + celdaValorFicha_() + '">' + f[3] + '</td>' +
    '</tr>';
  }).join('');
  var motivos = (detalle.salud_motivos && detalle.salud_motivos.length)
    ? '<div style="margin:0 0 16px;font-size:11px;color:' + DOC.MUTED + ';">' + escaparHtml_(detalle.salud_motivos.join(' · ')) + '</div>'
    : '<div style="margin:0 0 16px;"></div>';
  return '<table width="100%" style="border-collapse:collapse;border:1px solid ' + DOC.HAIRLINE + ';margin:0 0 6px;font-size:12px;">' + cuerpoFilas + '</table>' + motivos;
}

function seccionHitosPdf_(hitos) {
  if (!hitos.length) return '';
  var filas = hitos.map(function (h) {
    return '<tr>' +
      '<td style="' + celdaValorFicha_() + '">' + escaparHtml_(h.nombre) + '</td>' +
      '<td style="' + celdaValorFicha_() + '">' + escaparHtml_(HITO_ESTADO_LABEL_PDF_[h.estado] || h.estado) + '</td>' +
      '<td style="' + celdaValorFicha_() + '">' + fechaCortaPdfProyecto_(h.fecha_objetivo) + '</td>' +
    '</tr>';
  }).join('');
  return docSeccionOt_('Hitos') +
    '<table width="100%" style="border-collapse:collapse;border:1px solid ' + DOC.HAIRLINE + ';margin:0 0 18px;font-size:12px;">' + filas + '</table>';
}
var HITO_ESTADO_LABEL_PDF_ = { PENDIENTE: 'Pendiente', EN_CURSO: 'En curso', COMPLETADO: 'Completado', CANCELADO: 'Cancelado' };

function seccionRiesgosPdf_(riesgos) {
  var abiertos = riesgos.filter(function (r) { return r.estado !== 'CERRADO'; });
  if (!abiertos.length) return '';
  var filas = abiertos.map(function (r) {
    return '<tr>' +
      '<td style="' + celdaValorFicha_() + '">' + escaparHtml_(r.descripcion) + '</td>' +
      '<td style="' + celdaValorFicha_() + '">' + escaparHtml_(r.nivel) + '</td>' +
    '</tr>';
  }).join('');
  return docSeccionOt_('Riesgos abiertos') +
    '<table width="100%" style="border-collapse:collapse;border:1px solid ' + DOC.HAIRLINE + ';margin:0 0 18px;font-size:12px;">' + filas + '</table>';
}

// Top 8: las que mas urgen primero (mismo orden de prioridad de semaforo
// que listarMisTareas), no todas -- un reporte de una pagina no es un
// volcado completo de la base de datos.
var VENCIMIENTOS_PDF_ORDEN_ = { atrasada: 0, riesgo: 1, pendiente: 2, bloqueada: 3, 'al-dia': 4, revision: 5 };
function seccionVencimientosPdf_(tareas) {
  var pendientes = tareas.filter(function (a) { return a.estado !== 'TERMINADA' && a.estado !== 'CANCELADA'; })
    .sort(function (a, b) {
      var oa = VENCIMIENTOS_PDF_ORDEN_[a.semaforo] === undefined ? 9 : VENCIMIENTOS_PDF_ORDEN_[a.semaforo];
      var ob = VENCIMIENTOS_PDF_ORDEN_[b.semaforo] === undefined ? 9 : VENCIMIENTOS_PDF_ORDEN_[b.semaforo];
      if (oa !== ob) return oa - ob;
      return new Date(a.fecha_compromiso || '9999-12-31') - new Date(b.fecha_compromiso || '9999-12-31');
    })
    .slice(0, 8);
  if (!pendientes.length) return '';
  var filas = pendientes.map(function (a) {
    return '<tr>' +
      '<td style="' + celdaValorFicha_() + '">' + escaparHtml_(a.titulo) + '</td>' +
      '<td style="' + celdaValorFicha_() + '">' + escaparHtml_(a.responsable_nombre || a.responsable_email || '—') + '</td>' +
      '<td style="' + celdaValorFicha_() + '">' + fechaCortaPdfProyecto_(a.fecha_compromiso) + '</td>' +
    '</tr>';
  }).join('');
  return docSeccionOt_('Próximos vencimientos') +
    '<table width="100%" style="border-collapse:collapse;border:1px solid ' + DOC.HAIRLINE + ';font-size:12px;">' + filas + '</table>';
}

// v10 (Fase G4, "valor y salida ejecutiva"): "el rendimiento" del reporte
// -- mismo cálculo que ya usa la pestaña Cronograma > Dedicación (Fase G3),
// cero número nuevo. Sin nada que medir todavía (proyecto recién creado),
// no se agrega una sección vacía.
function seccionRendimientoPdf_(rendimiento) {
  if (!rendimiento) return '';
  var c = rendimiento.cumplimiento_tareas || {};
  var tieneRitmo = rendimiento.promedio_unidades_dia !== null && rendimiento.promedio_unidades_dia !== undefined;
  var resumen = '<tr>' +
      '<td style="' + celdaLabelFicha_() + '">Entregas a tiempo</td>' +
      '<td style="' + celdaValorFicha_() + '">' + (c.entregadas ? (c.a_tiempo + ' de ' + c.entregadas) : '—') + '</td>' +
      '<td style="' + celdaLabelFicha_() + '">Horas registradas</td>' +
      '<td style="' + celdaValorFicha_() + '">' + (rendimiento.horas_totales_proyecto || '—') + '</td>' +
    '</tr>' +
    '<tr>' +
      '<td style="' + celdaLabelFicha_() + '">Ritmo promedio</td>' +
      '<td style="' + celdaValorFicha_() + '">' + (tieneRitmo ? rendimiento.promedio_unidades_dia + '/día' : '—') + '</td>' +
      '<td style="' + celdaLabelFicha_() + '">Tareas sin arrancar</td>' +
      '<td style="' + celdaValorFicha_() + '">' + rendimiento.tareas_sin_avance + '</td>' +
    '</tr>';
  var seccion = docSeccionOt_('Rendimiento') +
    '<table width="100%" style="border-collapse:collapse;border:1px solid ' + DOC.HAIRLINE + ';margin:0 0 12px;font-size:12px;">' + resumen + '</table>';

  if (!rendimiento.por_tarea.length) return seccion;
  var filasTarea = rendimiento.por_tarea.map(function (t) {
    return '<tr>' +
      '<td style="' + celdaValorFicha_() + '">' + escaparHtml_(t.titulo) + '</td>' +
      '<td style="' + celdaValorFicha_() + '">' + escaparHtml_(t.meta_cantidad + (t.meta_unidad ? ' ' + t.meta_unidad : '')) + '</td>' +
      '<td style="' + celdaValorFicha_() + '">' + (t.unidades_por_dia !== '' ? t.unidades_por_dia + '/día' : '—') + '</td>' +
    '</tr>';
  }).join('');
  return seccion +
    '<table width="100%" style="border-collapse:collapse;border:1px solid ' + DOC.HAIRLINE + ';margin:0 0 18px;font-size:12px;">' + filasTarea + '</table>';
}

// v10 (Fase G4): "la carta" del reporte -- un registro cronológico de la
// bitácora, en vez de replicar la grilla interactiva día × tarea (esa
// existe para trabajar el día a día en pantalla, no para un PDF impreso).
// Reusa Proyectos.listarBitacora tal cual, sin reinterpretar el tipo -- el
// reporte solo traduce la etiqueta, no juzga estados (eso es lo que ya
// hace la Carta de Dedicación en pantalla).
var BITACORA_TIPO_LABEL_PDF_ = {
  CREADA: 'Asignada', CHECKIN_AVANCE: 'Avance', CHECKIN_SIN_CAMBIO: 'Sin cambios',
  DESBLOQUEO: 'Se destrabó', BLOQUEO: 'Bloqueada', ENTREGA: 'Entregada', VALIDACION: 'Revisión'
};
function seccionBitacoraPdf_(bitacora, tareasPorId) {
  if (!bitacora.length) return '';
  var filas = bitacora.map(function (b) {
    var tarea = tareasPorId[b.actividad_id];
    return '<tr>' +
      '<td style="' + celdaValorFicha_() + '">' + fechaCortaPdfProyecto_(b.timestamp) + '</td>' +
      '<td style="' + celdaValorFicha_() + '">' + escaparHtml_(tarea ? tarea.titulo : '—') + '</td>' +
      '<td style="' + celdaValorFicha_() + '">' + escaparHtml_(BITACORA_TIPO_LABEL_PDF_[b.tipo] || b.tipo) + (b.horas ? ' (' + b.horas + 'h)' : '') + '</td>' +
    '</tr>';
  }).join('');
  return docSeccionOt_('Actividad reciente') +
    '<table width="100%" style="border-collapse:collapse;border:1px solid ' + DOC.HAIRLINE + ';font-size:12px;">' + filas + '</table>';
}

// --- estados y prioridades ---------------------------------------------

var PROYECTOS_ESTADOS = {
  PLANIFICACION: 'PLANIFICACION',
  ACTIVO: 'ACTIVO',
  EN_PAUSA: 'EN_PAUSA',
  EN_REVISION: 'EN_REVISION',
  CERRADO: 'CERRADO',
  CANCELADO: 'CANCELADO'
};

// --- permisos (gate fino: membresia en PROYECTO_INTEGRANTES) -----------

function normalizarEmailProyecto_(email) {
  return String(email || '').trim().toLowerCase();
}

function esVerdaderoProyecto_(valor) {
  return valor === true || valor === 'TRUE' || valor === 1;
}

function proyectosDelUsuario_(email) {
  var normalizado = normalizarEmailProyecto_(email);
  return leerFilasSeguro_(SHEETS.PROYECTO_INTEGRANTES)
    .filter(function (i) { return normalizarEmailProyecto_(i.usuario_email) === normalizado && esVerdaderoProyecto_(i.activo); })
    .map(function (i) { return i.proyecto_id; });
}

function rolEnProyecto_(proyectoId, contexto) {
  var email = normalizarEmailProyecto_(contexto && contexto.email);
  var fila = leerFilasSeguro_(SHEETS.PROYECTO_INTEGRANTES).filter(function (i) {
    return i.proyecto_id === proyectoId && normalizarEmailProyecto_(i.usuario_email) === email && esVerdaderoProyecto_(i.activo);
  })[0];
  return fila ? fila.rol_proyecto : '';
}

// Lectura: ADM/GERENCIA ven todo (GERENCIA de solo lectura); el resto solo
// si es integrante (cualquier rol, incluido OBSERVADOR).
function puedeVerProyecto_(proyecto, contexto) {
  if (!contexto) return false;
  if (contexto.rol === 'ADM' || contexto.rol === 'GERENCIA') return true;
  return !!rolEnProyecto_(proyecto.proyecto_id, contexto);
}

// Gestion (editar proyecto, equipo, hitos): LIDER del proyecto o ADM.
function puedeGestionarProyecto_(proyecto, contexto) {
  if (!contexto) return false;
  if (contexto.rol === 'ADM') return true;
  if (contexto.rol === 'GERENCIA') return false; // solo lectura, siempre.
  return rolEnProyecto_(proyecto.proyecto_id, contexto) === 'LIDER';
}

// --- helpers internos ----------------------------------------------------

// v10 (Fase G2/G3): las horas dedicadas ese dia viajan dentro del JSON
// libre 'datos' de ACTIVIDADES_BITACORA (igual que avance_pct/confianza) --
// un solo lugar donde parsearlas, usado por listarBitacora, listarMiBitacora
// y obtenerRendimiento.
function horasDeBitacora_(fila) {
  if (!fila || !fila.datos) return undefined;
  try {
    var d = JSON.parse(fila.datos);
    return (d && d.horas !== undefined) ? d.horas : undefined;
  } catch (e) {
    return undefined; // dato viejo o corrupto: se ignora
  }
}

function buscarProyecto_(proyectoId) {
  if (!proyectoId) return null;
  var filas = leerFilasSeguro_(SHEETS.PROYECTOS);
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].proyecto_id === proyectoId) return filas[i];
  }
  return null;
}

// v10 (Fase C): solo plantillas activas -- una desactivada se trata igual
// que "no existe" (crear() la ignora en silencio, ver comentario ahi).
function buscarPlantilla_(plantillaId) {
  if (!plantillaId) return null;
  var filas = leerFilasSeguro_(SHEETS.PROYECTO_PLANTILLAS);
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].plantilla_id === plantillaId && esVerdaderoProyecto_(filas[i].activa)) return filas[i];
  }
  return null;
}

function buscarIntegranteProyecto_(integranteId) {
  var filas = leerFilasSeguro_(SHEETS.PROYECTO_INTEGRANTES);
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].integrante_id === integranteId) return filas[i];
  }
  return null;
}

function agregarIntegrante_(proyectoId, email, nombre, rolProyecto, responsabilidad, contexto) {
  var integrante = {
    integrante_id: Utilities.getUuid(),
    proyecto_id: proyectoId,
    usuario_email: normalizarEmailProyecto_(email),
    usuario_nombre: nombre || '',
    rol_proyecto: rolProyecto,
    responsabilidad: responsabilidad || '',
    activo: true,
    agregado_por: (contexto && contexto.email) || '',
    fecha_creacion: new Date().toISOString()
  };
  agregarFila_(SHEETS.PROYECTO_INTEGRANTES, integrante);
  return integrante;
}

function buscarEntregable_(entregableId) {
  if (!entregableId) return null;
  var filas = leerFilasSeguro_(SHEETS.PROYECTO_ENTREGABLES);
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].entregable_id === entregableId) return filas[i];
  }
  return null;
}

function buscarRiesgo_(riesgoId) {
  if (!riesgoId) return null;
  var filas = leerFilasSeguro_(SHEETS.PROYECTO_RIESGOS);
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].riesgo_id === riesgoId) return filas[i];
  }
  return null;
}

// Matriz de riesgo 3x3 simple (BAJA/MEDIA/ALTA x BAJA/MEDIA/ALTA). El
// producto de pesos evita que "probabilidad alta + impacto bajo" y
// "probabilidad baja + impacto alto" queden en niveles distintos sin razon.
function calcularNivelRiesgo_(probabilidad, impacto) {
  var peso = { BAJA: 1, MEDIA: 2, ALTA: 3 };
  var score = (peso[probabilidad] || 2) * (peso[impacto] || 2);
  if (score >= 6) return 'ALTA';
  if (score >= 3) return 'MEDIA';
  return 'BAJA';
}

// Notifica a los LIDER(es) activos del proyecto, salvo quien dispara la
// accion (mismo criterio que notificarSala_ para SOLICITUD_LIDER).
function notificarLideresProyecto_(proyecto, contexto, titulo, mensaje) {
  leerFilasSeguro_(SHEETS.PROYECTO_INTEGRANTES).forEach(function (i) {
    if (i.proyecto_id === proyecto.proyecto_id && i.rol_proyecto === 'LIDER' && esVerdaderoProyecto_(i.activo) &&
      normalizarEmailProyecto_(i.usuario_email) !== normalizarEmailProyecto_(contexto.email)) {
      encolarNotificacionApp_(i.usuario_email, 'PROYECTO_ENTREGABLE', titulo, mensaje, 'proyectos', 'Ver proyecto', 72);
    }
  });
}

function eliminarFilaHito_(hitoId) {
  // No hay borrado fisico estandar en SheetsRepo (solo actualizarFilaPorId_/
  // agregarFila_) -- se marca el estado como CANCELADO, mismo criterio que
  // "activa=false" en el resto de SIGSO (nunca se borra una fila).
  return actualizarFilaPorId_(SHEETS.PROYECTO_HITOS, 'hito_id', hitoId, { estado: 'CANCELADO' });
}

function registrarEventoProyecto_(proyectoId, tipo, contexto, cuerpoOTitulo, refTipo, refId, cuerpo, menciones) {
  // Firma flexible: registrarEventoProyecto_(id, tipo, contexto, titulo, ref_tipo, ref_id, cuerpo, menciones)
  var evento = {
    evento_id: Utilities.getUuid(),
    proyecto_id: proyectoId,
    tipo: tipo,
    autor_email: (contexto && contexto.email) || '',
    autor_nombre: (contexto && contexto.nombre) || '',
    titulo: cuerpoOTitulo || '',
    cuerpo: cuerpo || '',
    ref_tipo: refTipo || '',
    ref_id: refId || '',
    menciones: menciones ? (Array.isArray(menciones) ? menciones.join(',') : menciones) : '',
    timestamp: new Date().toISOString()
  };
  agregarFila_(SHEETS.PROYECTO_EVENTOS, evento);
  actualizarFilaPorId_(SHEETS.PROYECTOS, 'proyecto_id', proyectoId, { ultima_actualizacion: evento.timestamp });
  return evento;
}

// Notifica a los mencionados (@correo) y, si es SOLICITUD_LIDER, a todo el
// equipo activo salvo el autor. Notificacion viva + correo (agrupado por el
// canal existente), nunca un canal nuevo.
function notificarSala_(proyecto, evento, contexto) {
  var destinatarios = {};
  (evento.menciones || '').split(',').forEach(function (email) {
    var normalizado = normalizarEmailProyecto_(email);
    if (normalizado) destinatarios[normalizado] = true;
  });
  if (evento.tipo === 'SOLICITUD_LIDER') {
    leerFilasSeguro_(SHEETS.PROYECTO_INTEGRANTES).forEach(function (i) {
      if (i.proyecto_id === proyecto.proyecto_id && esVerdaderoProyecto_(i.activo) &&
        normalizarEmailProyecto_(i.usuario_email) !== normalizarEmailProyecto_(contexto.email)) {
        destinatarios[normalizarEmailProyecto_(i.usuario_email)] = true;
      }
    });
  }
  var titulo = evento.tipo === 'SOLICITUD_LIDER' ? 'Solicitud del líder en ' + proyecto.nombre
    : 'Actividad en ' + proyecto.nombre;
  Object.keys(destinatarios).forEach(function (email) {
    encolarNotificacionApp_(email, 'PROYECTO_SALA', titulo,
      (evento.titulo || evento.cuerpo || '').slice(0, 140), 'proyectos', 'Ver sala', 72);
  });
}

// --- avance y salud (§J de la propuesta: explicable, no caja negra) -----

// Avance derivado: % de tareas activas TERMINADAS sobre el total activo.
// Vacio (sin tareas) devuelve null -- no 0%, que se leeria como "sin avance"
// en vez de "todavia no hay nada que medir".
// v12.5: cumplimiento de plazos de las tareas de un proyecto.
//
// MISMA REGLA que el motor de reportes del frontend (SigsoReportes.
// agruparCumplimiento): solo cuenta lo ENTREGADO que ademas tenia fecha de
// compromiso. Una tarea sin comprometer no es un incumplimiento -- no hay
// promesa que romper todavia -- y contarla hundiria el porcentaje de un
// proyecto que recien parte.
//
// Devuelve pct = null (y no 0) cuando no hay ninguna entrega medible: son
// cosas distintas y no pueden verse iguales en un reporte.
function calcularCumplimientoTareasProyecto_(tareas) {
  var activas = (tareas || []).filter(function (a) {
    return a.activa === true || a.activa === 'TRUE' || a.activa === 1;
  });
  var entregadas = activas.filter(function (a) {
    return a.fecha_terminada && a.fecha_compromiso;
  });
  var aTiempo = entregadas.filter(function (a) {
    return new Date(a.fecha_terminada) <= new Date(a.fecha_compromiso);
  });
  return {
    total: activas.length,
    entregadas: entregadas.length,
    a_tiempo: aTiempo.length,
    sin_comprometer: activas.filter(function (a) { return !a.fecha_compromiso; }).length,
    pct: entregadas.length
      ? Math.round((aTiempo.length / entregadas.length) * 1000) / 10
      : null
  };
}
function calcularAvanceProyecto_(tareas) {
  var activas = tareas.filter(function (a) { return a.activa === true || a.activa === 'TRUE' || a.activa === 1; });
  if (activas.length === 0) return null;
  var terminadas = activas.filter(function (a) { return a.estado === 'TERMINADA'; });
  return Math.round((terminadas.length / activas.length) * 1000) / 10;
}

// Calcula la salud on-read a partir de senales objetivas y devuelve el
// codigo + los motivos en texto plano (nunca una caja negra). Reusa
// semaforoActividad_ (Actividades.gs) por tarea. salud_override permite una
// correccion manual excepcional, siempre con motivo visible.
function calcularSaludProyecto_(proyecto, tareas, hitos, entregables) {
  if (proyecto.salud_override) {
    var etiquetas = { critico: 'Crítico', riesgo: 'En riesgo', normal: 'Normal' };
    return {
      codigo: proyecto.salud_override,
      etiqueta: etiquetas[proyecto.salud_override] || proyecto.salud_override,
      motivos: [proyecto.salud_override_motivo || 'Fijado manualmente.']
    };
  }
  if (proyecto.estado === PROYECTOS_ESTADOS.CERRADO || proyecto.estado === PROYECTOS_ESTADOS.CANCELADO) {
    return { codigo: 'normal', etiqueta: 'Normal', motivos: [] };
  }

  var activas = tareas.filter(function (a) { return a.activa === true || a.activa === 'TRUE' || a.activa === 1; });
  var motivosCriticos = [], motivosRiesgo = [];
  var ahora = new Date();

  var hitosVencidos = (hitos || []).filter(function (h) {
    return h.estado !== 'COMPLETADO' && h.estado !== 'CANCELADO' && h.fecha_objetivo && new Date(h.fecha_objetivo) < ahora;
  });
  if (hitosVencidos.length > 0) motivosCriticos.push(hitosVencidos.length + ' hito(s) vencido(s)');

  var tareasAtrasadas = activas.filter(function (a) { return semaforoActividad_(a).codigo === 'atrasada'; });
  var criticasAtrasadas = tareasAtrasadas.filter(function (a) { return ['P1', 'P2'].indexOf(a.prioridad) !== -1; });
  if (criticasAtrasadas.length > 0) motivosCriticos.push(criticasAtrasadas.length + ' tarea(s) crítica(s) atrasada(s)');
  else if (tareasAtrasadas.length > 0) motivosRiesgo.push(tareasAtrasadas.length + ' tarea(s) atrasada(s)');

  var bloqueadas = activas.filter(function (a) { return a.estado === 'BLOQUEADA'; });
  var feriados = obtenerFeriados_();
  var bloqueoEstancado = bloqueadas.filter(function (a) {
    return a.bloqueo_desde && Utils.horasHabilesEntre(a.bloqueo_desde, ahora, { feriados: feriados }) / 9 >= 2;
  });
  if (bloqueoEstancado.length > 0) motivosCriticos.push(bloqueoEstancado.length + ' bloqueo(s) estancado(s) (2+ días hábiles)');
  else if (bloqueadas.length > 0) motivosRiesgo.push(bloqueadas.length + ' tarea(s) bloqueada(s)');

  var sinActualizar = activas.filter(function (a) {
    if (!a.ultima_actualizacion) return false;
    return Utils.horasHabilesEntre(a.ultima_actualizacion, ahora, { feriados: feriados }) / 9 >= 5;
  });
  if (sinActualizar.length > 0) motivosRiesgo.push(sinActualizar.length + ' tarea(s) sin actualizar hace 5+ días hábiles');

  // v9.4 (Fase 2, §J de la propuesta): "entregable observado/vencido" como
  // señal de riesgo. APROBADO/CANCELADO son estados que ya no aportan
  // riesgo; el resto (PENDIENTE/ENTREGADO/OBSERVADO) sigue vigente.
  var entregablesVigentes = (entregables || []).filter(function (e) { return e.estado !== 'APROBADO' && e.estado !== 'CANCELADO'; });
  var entregablesVencidos = entregablesVigentes.filter(function (e) {
    return e.fecha_comprometida && new Date(e.fecha_comprometida) < ahora;
  });
  if (entregablesVencidos.length > 0) motivosRiesgo.push(entregablesVencidos.length + ' entregable(s) vencido(s)');
  var entregablesObservados = entregablesVigentes.filter(function (e) { return e.estado === 'OBSERVADO'; });
  if (entregablesObservados.length > 0) motivosRiesgo.push(entregablesObservados.length + ' entregable(s) observado(s)');

  if (motivosCriticos.length > 0) {
    return { codigo: 'critico', etiqueta: 'Crítico', motivos: motivosCriticos.concat(motivosRiesgo) };
  }
  if (motivosRiesgo.length > 0) {
    return { codigo: 'riesgo', etiqueta: 'En riesgo', motivos: motivosRiesgo };
  }
  return { codigo: 'normal', etiqueta: 'Normal', motivos: [] };
}

// "Requiere tu atencion" (§12 de la propuesta): lo que un lider necesita ver
// sin tener que ir a buscarlo.
function calcularRequiereAtencion_(tareas, hitos, integrantes) {
  var ahora = new Date();
  var activas = tareas.filter(function (a) { return a.activa === true || a.activa === 'TRUE' || a.activa === 1; });
  var vencidas = activas.filter(function (a) { return semaforoActividad_(a).codigo === 'atrasada'; });
  var bloqueadas = activas.filter(function (a) { return a.estado === 'BLOQUEADA'; });
  var hitosAtrasados = (hitos || []).filter(function (h) {
    return h.estado !== 'COMPLETADO' && h.estado !== 'CANCELADO' && h.fecha_objetivo && new Date(h.fecha_objetivo) < ahora;
  });
  return {
    tareas_vencidas: vencidas.length,
    tareas_bloqueadas: bloqueadas.length,
    hitos_atrasados: hitosAtrasados.length,
    total_integrantes: (integrantes || []).length
  };
}

// v10 (Fase D, propuesta 09 "resumen diario del proyecto"): "que se movio"
// desde la ultima vez que ESTA persona (contexto.email) vio la Sala. No
// reinventa deteccion de cambios: los eventos de la Sala (PROYECTO_EVENTOS)
// YA registran comentarios, bloqueos, entregables aprobados/observados,
// riesgos, etc. con su fecha real -- alcanza con contar los que quedaron
// DESPUES de ultima_visita_sala. "Tareas completadas/bloqueadas" se sacan
// aparte de ACTIVIDADES.ultima_actualizacion porque terminar/bloquear una
// tarea no siempre genera un evento propio en la Sala.
function calcularResumenVisitaProyecto_(proyecto, contexto, integrantes, tareas) {
  var miIntegrante = integrantes.filter(function (i) {
    return normalizarEmailProyecto_(i.usuario_email) === normalizarEmailProyecto_(contexto && contexto.email);
  })[0];
  if (!miIntegrante || !miIntegrante.ultima_visita_sala) return null;
  var desde = miIntegrante.ultima_visita_sala;
  // >= y no > : algo que cambio en el MISMO instante en que se marco la
  // visita (p.ej. el usuario marca "vi la sala" y en el acto hace un
  // check-in) debe seguir contando -- un digest de menos entrena a
  // ignorarlo mas rapido que uno de mas.
  var desdeMs = new Date(desde).getTime();

  var eventos = leerFilasSeguro_(SHEETS.PROYECTO_EVENTOS).filter(function (e) {
    return e.proyecto_id === proyecto.proyecto_id && new Date(e.timestamp).getTime() >= desdeMs;
  });
  var tareasCompletadas = tareas.filter(function (a) {
    return a.estado === 'TERMINADA' && a.ultima_actualizacion && new Date(a.ultima_actualizacion).getTime() >= desdeMs;
  }).length;
  var tareasBloqueadas = tareas.filter(function (a) {
    return a.estado === 'BLOQUEADA' && a.ultima_actualizacion && new Date(a.ultima_actualizacion).getTime() >= desdeMs;
  }).length;
  var entregablesAprobados = eventos.filter(function (e) {
    return e.tipo === 'ENTREGABLE' && /aprobado/.test(e.titulo || '');
  }).length;

  return {
    desde: desde,
    eventos_sala: eventos.length,
    tareas_completadas: tareasCompletadas,
    tareas_bloqueadas: tareasBloqueadas,
    entregables_aprobados: entregablesAprobados
  };
}
